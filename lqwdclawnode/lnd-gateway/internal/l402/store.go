// Package l402 implements the L402 protocol for HTTP 402 Payment Required flows.
// Tokens are stored in SQLite with WAL mode for concurrent access.
package l402

import (
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// TokenStatus represents the lifecycle state of an L402 token.
type TokenStatus string

const (
	StatusPending  TokenStatus = "pending"  // Invoice issued, awaiting payment
	StatusPaid     TokenStatus = "paid"     // Invoice paid, token ready to use
	StatusConsumed TokenStatus = "consumed" // Token used (single-use)
	StatusExpired  TokenStatus = "expired"  // Token past TTL
)

// Token represents a stored L402 challenge/token.
type Token struct {
	PaymentHash string
	Macaroon    string // base64-encoded serialized macaroon
	Invoice     string // bolt11 invoice string
	Preimage    string // hex preimage (empty until paid)
	Endpoint    string // the endpoint this token is valid for
	AmountSats  int64
	Status      TokenStatus
	CreatedAt   time.Time
	ExpiresAt   time.Time
}

// Store manages L402 tokens in SQLite.
type Store struct {
	db     *sql.DB
	logger *slog.Logger
}

// NewStore creates an L402 token store backed by SQLite.
func NewStore(dbPath string, logger *slog.Logger) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0750); err != nil {
		return nil, fmt.Errorf("create l402 db dir: %w", err)
	}

	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000&_txlock=immediate")
	if err != nil {
		return nil, fmt.Errorf("open l402 db: %w", err)
	}

	// Serialize all access through a single connection — SQLite supports
	// only one writer at a time.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS l402_tokens (
			payment_hash TEXT PRIMARY KEY,
			macaroon     TEXT NOT NULL,
			invoice      TEXT NOT NULL,
			preimage     TEXT NOT NULL DEFAULT '',
			endpoint     TEXT NOT NULL,
			amount_sats  INTEGER NOT NULL,
			status       TEXT NOT NULL DEFAULT 'pending',
			created_at   TEXT NOT NULL DEFAULT (datetime('now')),
			expires_at   TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_l402_status ON l402_tokens(status);
		CREATE INDEX IF NOT EXISTS idx_l402_expires ON l402_tokens(expires_at);
	`); err != nil {
		db.Close()
		return nil, fmt.Errorf("create l402 table: %w", err)
	}

	return &Store{db: db, logger: logger}, nil
}

// CreateChallenge stores a new pending L402 token (challenge issued, awaiting payment).
func (s *Store) CreateChallenge(paymentHash, macaroon, invoice, endpoint string, amountSats int64, expiresAt time.Time) error {
	_, err := s.db.Exec(`
		INSERT INTO l402_tokens (payment_hash, macaroon, invoice, endpoint, amount_sats, status, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, paymentHash, macaroon, invoice, endpoint, amountSats, string(StatusPending), expiresAt.Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("create l402 challenge: %w", err)
	}
	return nil
}

// MarkPaid updates a pending token to paid status with the preimage.
func (s *Store) MarkPaid(paymentHash, preimage string) error {
	result, err := s.db.Exec(`
		UPDATE l402_tokens SET status = ?, preimage = ?
		WHERE payment_hash = ? AND status = ?
	`, string(StatusPaid), preimage, paymentHash, string(StatusPending))
	if err != nil {
		return fmt.Errorf("mark l402 paid: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("no pending token found for payment_hash %s", paymentHash)
	}
	return nil
}

// Consume atomically marks a paid token as consumed (single-use enforcement).
// Uses UPDATE...RETURNING to transition state and read back in a single statement —
// no interleaving window between state change and data read.
// Returns the token if valid, or an error if not found/already consumed/expired.
func (s *Store) Consume(paymentHash string) (*Token, error) {
	now := time.Now().Format(time.RFC3339)

	// Atomic: UPDATE + read-back in a single statement (per D-01, D-02).
	// If no row matches (wrong status, expired, not found), QueryRow returns sql.ErrNoRows.
	var t Token
	var status, createdAt, expiresAt string
	err := s.db.QueryRow(`
		UPDATE l402_tokens SET status = ?
		WHERE payment_hash = ? AND status = ? AND expires_at > ?
		RETURNING payment_hash, macaroon, invoice, preimage, endpoint, amount_sats, status, created_at, expires_at
	`, string(StatusConsumed), paymentHash, string(StatusPaid), now).Scan(
		&t.PaymentHash, &t.Macaroon, &t.Invoice, &t.Preimage,
		&t.Endpoint, &t.AmountSats, &status, &createdAt, &expiresAt,
	)

	if err == sql.ErrNoRows {
		// Diagnostic SELECT to determine why (per D-03: kept for L402 debugging)
		var diagStatus, diagExpires string
		diagErr := s.db.QueryRow(`
			SELECT payment_hash, status, expires_at FROM l402_tokens WHERE payment_hash = ?
		`, paymentHash).Scan(&t.PaymentHash, &diagStatus, &diagExpires)
		if diagErr == sql.ErrNoRows {
			return nil, fmt.Errorf("unknown payment_hash")
		}
		if diagErr != nil {
			return nil, fmt.Errorf("query token status: %w", diagErr)
		}
		exp, _ := time.Parse(time.RFC3339, diagExpires)
		if time.Now().After(exp) {
			s.db.Exec("UPDATE l402_tokens SET status = ? WHERE payment_hash = ?", string(StatusExpired), paymentHash)
			return nil, fmt.Errorf("token expired")
		}
		return nil, fmt.Errorf("token status is %s, expected paid", diagStatus)
	}
	if err != nil {
		return nil, fmt.Errorf("consume token: %w", err)
	}

	t.Status = TokenStatus(status)
	t.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	t.ExpiresAt, _ = time.Parse(time.RFC3339, expiresAt)

	return &t, nil
}

// Lookup retrieves a token by payment hash without modifying it.
func (s *Store) Lookup(paymentHash string) (*Token, error) {
	var t Token
	var status, createdAt, expiresAt string
	err := s.db.QueryRow(`
		SELECT payment_hash, macaroon, invoice, preimage, endpoint, amount_sats, status, created_at, expires_at
		FROM l402_tokens WHERE payment_hash = ?
	`, paymentHash).Scan(&t.PaymentHash, &t.Macaroon, &t.Invoice, &t.Preimage, &t.Endpoint, &t.AmountSats, &status, &createdAt, &expiresAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lookup l402 token: %w", err)
	}
	t.Status = TokenStatus(status)
	t.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	t.ExpiresAt, _ = time.Parse(time.RFC3339, expiresAt)
	return &t, nil
}

// Cleanup removes expired tokens in batches to avoid long write locks.
// Call periodically (e.g., every hour).
func (s *Store) Cleanup() (int64, error) {
	now := time.Now().Format(time.RFC3339)
	var total int64
	for {
		result, err := s.db.Exec(`DELETE FROM l402_tokens WHERE rowid IN (
			SELECT rowid FROM l402_tokens WHERE expires_at < ? LIMIT 1000
		)`, now)
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
