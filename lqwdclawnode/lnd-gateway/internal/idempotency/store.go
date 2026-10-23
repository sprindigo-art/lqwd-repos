// Package idempotency prevents duplicate write operations via client-generated keys.
// Keys are stored in SQLite with a 24-hour TTL.
package idempotency

import (
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// Store manages idempotency keys and cached responses.
type Store struct {
	db     *sql.DB
	logger *slog.Logger
}

// CachedResponse is returned when a duplicate request is detected.
type CachedResponse struct {
	StatusCode   int
	ResponseBody string
}

// New creates an idempotency store backed by SQLite.
func New(dbPath string, logger *slog.Logger) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0750); err != nil {
		return nil, fmt.Errorf("create idempotency db dir: %w", err)
	}

	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000&_txlock=immediate")
	if err != nil {
		return nil, fmt.Errorf("open idempotency db: %w", err)
	}

	// Serialize all access through a single connection — SQLite supports
	// only one writer at a time.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS idempotency_keys (
			key TEXT PRIMARY KEY,
			endpoint TEXT NOT NULL,
			status_code INTEGER NOT NULL,
			response_body TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			expires_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_idemp_expires ON idempotency_keys(expires_at);
	`); err != nil {
		db.Close()
		return nil, fmt.Errorf("create idempotency table: %w", err)
	}

	return &Store{db: db, logger: logger}, nil
}

// CheckAndReserve atomically reserves an idempotency key or returns a cached response.
// Uses INSERT OR IGNORE to prevent race conditions — two concurrent requests
// with the same key will result in only one succeeding at the insert.
// Returns nil if the key was reserved (caller should proceed with the operation).
func (s *Store) CheckAndReserve(key, endpoint string) (*CachedResponse, error) {
	if key == "" {
		return nil, nil // No idempotency key provided — allow through
	}

	// First, clean up if expired
	s.db.Exec("DELETE FROM idempotency_keys WHERE key = ? AND endpoint = ? AND expires_at < ?",
		key, endpoint, time.Now().Format(time.RFC3339))

	// Atomically try to reserve this key with a pending placeholder (status_code=0).
	// INSERT OR IGNORE fails silently if key already exists (PK constraint).
	expiresAt := time.Now().Add(24 * time.Hour).Format(time.RFC3339)
	result, err := s.db.Exec(`
		INSERT OR IGNORE INTO idempotency_keys (key, endpoint, status_code, response_body, expires_at)
		VALUES (?, ?, 0, '', ?)
	`, key, endpoint, expiresAt)
	if err != nil {
		return nil, fmt.Errorf("reserve idempotency key: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 1 {
		// Successfully reserved — this is a new request, proceed
		return nil, nil
	}

	// Key already exists — check if it's for the same endpoint
	var statusCode int
	var responseBody string
	err = s.db.QueryRow(`
		SELECT status_code, response_body FROM idempotency_keys
		WHERE key = ? AND endpoint = ?
	`, key, endpoint).Scan(&statusCode, &responseBody)
	if err == sql.ErrNoRows {
		// Key exists but for a different endpoint — allow through
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read cached response: %w", err)
	}

	// status_code=0 means another request is still in progress (reserved but not stored yet)
	if statusCode == 0 {
		s.logger.Info("idempotency key in-flight — rejecting concurrent duplicate", "key", key)
		return &CachedResponse{
			StatusCode:   http.StatusConflict,
			ResponseBody: `{"ok":false,"error":"duplicate request in progress"}`,
		}, nil
	}

	s.logger.Info("idempotency hit — returning cached response", "key", key, "endpoint", endpoint)
	return &CachedResponse{
		StatusCode:   statusCode,
		ResponseBody: responseBody,
	}, nil
}

// Store records a response for an idempotency key with a 24-hour TTL.
func (s *Store) Store(key, endpoint string, statusCode int, responseBody string) error {
	if key == "" {
		return nil
	}

	expiresAt := time.Now().Add(24 * time.Hour).Format(time.RFC3339)
	_, err := s.db.Exec(`
		INSERT OR REPLACE INTO idempotency_keys (key, endpoint, status_code, response_body, expires_at)
		VALUES (?, ?, ?, ?, ?)
	`, key, endpoint, statusCode, responseBody, expiresAt)
	return err
}

// Release deletes a pending reservation (status_code=0) so a subsequent
// request with the same key can retry cleanly. Use this only when a
// reservation was created but the operation failed before any external
// side-effect — otherwise prefer Store() so retries see the failure
// outcome rather than re-executing.
//
// Deletes only pending rows (status_code=0) so a confirmed response is
// never lost by mistake.
func (s *Store) Release(key, endpoint string) error {
	if key == "" {
		return nil
	}
	_, err := s.db.Exec(`
		DELETE FROM idempotency_keys
		WHERE key = ? AND endpoint = ? AND status_code = 0
	`, key, endpoint)
	return err
}

// Cleanup removes expired keys in batches to avoid long write locks.
// Call periodically (e.g., every hour).
func (s *Store) Cleanup() (int64, error) {
	var total int64
	for {
		result, err := s.db.Exec(`DELETE FROM idempotency_keys WHERE rowid IN (
			SELECT rowid FROM idempotency_keys WHERE expires_at < datetime('now') LIMIT 1000
		)`)
		if err != nil {
			return total, err
		}
		n, _ := result.RowsAffected()
		total += n
		if n < 1000 {
			break
		}
		// Release write lock between batches so concurrent requests proceed.
		time.Sleep(100 * time.Millisecond)
	}
	return total, nil
}

// Close closes the database connection.
func (s *Store) Close() error {
	return s.db.Close()
}
