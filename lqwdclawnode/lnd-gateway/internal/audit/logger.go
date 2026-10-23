// Package audit provides SQLite-based audit logging with a JSON fallback.
package audit

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/killswitch"
	_ "github.com/mattn/go-sqlite3"
)

// Entry represents a single audit log entry.
type Entry struct {
	Timestamp    time.Time `json:"timestamp"`
	Endpoint     string    `json:"endpoint"`
	Method       string    `json:"method"`
	TokenLevel   string    `json:"token_level"`
	RequestBody  string    `json:"request_body,omitempty"`
	ResponseCode int       `json:"response_code"`
	ResponseBody string    `json:"response_body,omitempty"`
	AmountSats   int64     `json:"amount_sats,omitempty"`
	OpType       string    `json:"op_type,omitempty"` // payment, channel_open, onchain_send, rebalance
	IdempotKey   string    `json:"idempotency_key,omitempty"`
	Error        string    `json:"error,omitempty"`
	RequestID    string    `json:"request_id,omitempty"`
}

// Logger writes audit entries to SQLite with a JSON fallback file.
type Logger struct {
	db                *sql.DB
	fallbackPath      string
	fallbackMu        sync.Mutex
	logger            *slog.Logger
	killSwitch        *killswitch.KillSwitch
	maxDailySpendSats int64
}

// New creates a new audit logger. Creates the database and table if they don't exist.
// If ks is non-nil and maxDailySpendSats > 0, Log() will check daily spend after
// each write-bearing entry and engage the kill switch if the limit is exceeded.
func New(dbPath, fallbackPath string, logger *slog.Logger, ks *killswitch.KillSwitch, maxDailySpendSats int64) (*Logger, error) {
	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(dbPath), 0750); err != nil {
		return nil, fmt.Errorf("create audit db dir: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(fallbackPath), 0750); err != nil {
		return nil, fmt.Errorf("create fallback dir: %w", err)
	}

	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000&_txlock=immediate")
	if err != nil {
		return nil, fmt.Errorf("open audit db: %w", err)
	}

	// Serialize all access through a single connection — SQLite supports
	// only one writer at a time.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	// Create table
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS audit_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp TEXT NOT NULL DEFAULT (datetime('now')),
			endpoint TEXT NOT NULL,
			method TEXT NOT NULL DEFAULT 'POST',
			token_level TEXT NOT NULL DEFAULT 'agent',
			request_body TEXT,
			response_code INTEGER NOT NULL,
			response_body TEXT,
			amount_sats INTEGER DEFAULT 0,
			op_type TEXT,
			idempotency_key TEXT,
			error TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
		CREATE INDEX IF NOT EXISTS idx_audit_op_type ON audit_log(op_type);
		CREATE INDEX IF NOT EXISTS idx_audit_idempotency ON audit_log(idempotency_key);
	`); err != nil {
		db.Close()
		return nil, fmt.Errorf("create audit table: %w", err)
	}

	// Safe migration: add request_id column if not present
	_, err = db.Exec(`ALTER TABLE audit_log ADD COLUMN request_id TEXT DEFAULT ''`)
	if err != nil && !strings.Contains(err.Error(), "duplicate column") {
		db.Close()
		return nil, fmt.Errorf("add request_id column: %w", err)
	}

	return &Logger{
		db:                db,
		fallbackPath:      fallbackPath,
		logger:            logger,
		killSwitch:        ks,
		maxDailySpendSats: maxDailySpendSats,
	}, nil
}

// Log writes an audit entry. If SQLite fails, falls back to JSON append file.
func (l *Logger) Log(e Entry) {
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now().UTC()
	}

	_, err := l.db.Exec(`
		INSERT INTO audit_log (timestamp, endpoint, method, token_level, request_body, response_code, response_body, amount_sats, op_type, idempotency_key, error, request_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.Timestamp.Format(time.RFC3339),
		e.Endpoint,
		e.Method,
		e.TokenLevel,
		e.RequestBody,
		e.ResponseCode,
		e.ResponseBody,
		e.AmountSats,
		e.OpType,
		e.IdempotKey,
		e.Error,
		e.RequestID,
	)
	if err != nil {
		l.logger.Error("audit db write failed, using fallback", "error", err)
		l.writeFallback(e)
	}

	// Post-hoc budget safety net (per D-09)
	if e.AmountSats > 0 && l.killSwitch != nil && l.maxDailySpendSats > 0 {
		daily, err := l.DailySpend()
		if err != nil {
			l.logger.Error("post-hoc budget check failed", "error", err)
			return
		}
		if daily > l.maxDailySpendSats {
			l.killSwitch.Engage()
			l.logger.Error("BUDGET OVERRUN: kill switch engaged",
				"daily_spend_sats", daily,
				"limit_sats", l.maxDailySpendSats,
				"request_id", e.RequestID,
			)
		}
	}
}

// DailySpend returns the total amount_sats for outflow op_types in the last 24 hours.
func (l *Logger) DailySpend() (int64, error) {
	var total sql.NullInt64
	err := l.db.QueryRow(`
		SELECT COALESCE(SUM(amount_sats), 0) FROM audit_log
		WHERE op_type IN ('payment', 'channel_open', 'onchain_send', 'rebalance')
		AND response_code < 400
		AND response_code != 202
		AND timestamp > datetime('now', '-24 hours')
	`).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("query daily spend: %w", err)
	}
	return total.Int64, nil
}

// Recent returns the N most recent audit entries.
func (l *Logger) Recent(limit int) ([]Entry, error) {
	rows, err := l.db.Query(`
		SELECT timestamp, endpoint, method, token_level, request_body, response_code, amount_sats, op_type, idempotency_key, error
		FROM audit_log ORDER BY id DESC LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	return scanEntries(rows)
}

// scanEntries reads rows into Entry slices (closes rows when done).
func scanEntries(rows *sql.Rows) ([]Entry, error) {
	defer rows.Close()
	var entries []Entry
	for rows.Next() {
		var e Entry
		var ts string
		var reqBody, opType, idempotKey, errStr sql.NullString
		if err := rows.Scan(&ts, &e.Endpoint, &e.Method, &e.TokenLevel, &reqBody, &e.ResponseCode, &e.AmountSats, &opType, &idempotKey, &errStr); err != nil {
			return nil, err
		}
		e.Timestamp, _ = time.Parse(time.RFC3339, ts)
		e.RequestBody = reqBody.String
		e.OpType = opType.String
		e.IdempotKey = idempotKey.String
		e.Error = errStr.String
		entries = append(entries, e)
	}
	return entries, nil
}

// QueryFilter defines filters for querying audit entries.
type QueryFilter struct {
	Endpoint     string `json:"endpoint,omitempty"`
	OpType       string `json:"op_type,omitempty"`
	MinStatus    int    `json:"min_status,omitempty"`
	MaxStatus    int    `json:"max_status,omitempty"`
	Since        string `json:"since,omitempty"`         // RFC3339 timestamp
	Until        string `json:"until,omitempty"`         // RFC3339 timestamp
	ErrorsOnly   bool   `json:"errors_only,omitempty"`
	Limit        int    `json:"limit,omitempty"`
}

// Query returns audit entries matching the given filter.
func (l *Logger) Query(f QueryFilter) ([]Entry, error) {
	query := `SELECT timestamp, endpoint, method, token_level, request_body, response_code, amount_sats, op_type, idempotency_key, error FROM audit_log WHERE 1=1`
	var args []any

	if f.Endpoint != "" {
		query += ` AND endpoint = ?`
		args = append(args, f.Endpoint)
	}
	if f.OpType != "" {
		query += ` AND op_type = ?`
		args = append(args, f.OpType)
	}
	if f.MinStatus > 0 {
		query += ` AND response_code >= ?`
		args = append(args, f.MinStatus)
	}
	if f.MaxStatus > 0 {
		query += ` AND response_code <= ?`
		args = append(args, f.MaxStatus)
	}
	if f.Since != "" {
		query += ` AND timestamp >= ?`
		args = append(args, f.Since)
	}
	if f.Until != "" {
		query += ` AND timestamp <= ?`
		args = append(args, f.Until)
	}
	if f.ErrorsOnly {
		query += ` AND response_code >= 400`
	}

	query += ` ORDER BY id DESC`

	limit := f.Limit
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	query += ` LIMIT ?`
	args = append(args, limit)

	rows, err := l.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanEntries(rows)
}

// Summary returns aggregate statistics from the audit log.
type SummaryResult struct {
	TotalRequests     int64            `json:"total_requests"`
	SuccessCount      int64            `json:"success_count"`
	ErrorCount        int64            `json:"error_count"`
	SuccessRate       float64          `json:"success_rate_pct"`
	TotalSpendSats    int64            `json:"total_spend_sats"`
	DailySpendSats    int64            `json:"daily_spend_sats"`
	EndpointCounts    map[string]int64 `json:"endpoint_counts"`
	OpTypeCounts      map[string]int64 `json:"op_type_counts"`
	BudgetRejections  int64            `json:"budget_rejections"`
	RecentErrors      []Entry          `json:"recent_errors"`
}

// Summary computes aggregate stats over the given time range (RFC3339 strings, optional).
func (l *Logger) Summary(since, until string) (*SummaryResult, error) {
	s := &SummaryResult{
		EndpointCounts: make(map[string]int64),
		OpTypeCounts:   make(map[string]int64),
	}

	whereClause := "WHERE 1=1"
	var args []any
	if since != "" {
		whereClause += " AND timestamp >= ?"
		args = append(args, since)
	}
	if until != "" {
		whereClause += " AND timestamp <= ?"
		args = append(args, until)
	}

	// Total, success, error counts
	row := l.db.QueryRow(fmt.Sprintf(`
		SELECT
			COUNT(*),
			COALESCE(SUM(CASE WHEN response_code < 400 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN response_code >= 400 THEN 1 ELSE 0 END), 0)
		FROM audit_log %s`, whereClause), args...)
	if err := row.Scan(&s.TotalRequests, &s.SuccessCount, &s.ErrorCount); err != nil {
		return nil, fmt.Errorf("summary counts: %w", err)
	}
	if s.TotalRequests > 0 {
		s.SuccessRate = float64(s.SuccessCount) / float64(s.TotalRequests) * 100
	}

	// Total spend
	row = l.db.QueryRow(fmt.Sprintf(`
		SELECT COALESCE(SUM(amount_sats), 0) FROM audit_log
		%s AND op_type IN ('payment','channel_open','onchain_send','rebalance')
		AND response_code < 400`, whereClause), args...)
	if err := row.Scan(&s.TotalSpendSats); err != nil {
		return nil, fmt.Errorf("summary spend: %w", err)
	}

	// Daily spend (always last 24h)
	daily, err := l.DailySpend()
	if err != nil {
		return nil, err
	}
	s.DailySpendSats = daily

	// Endpoint counts
	rows, err := l.db.Query(fmt.Sprintf(`
		SELECT endpoint, COUNT(*) FROM audit_log %s GROUP BY endpoint ORDER BY COUNT(*) DESC`, whereClause), args...)
	if err != nil {
		return nil, fmt.Errorf("summary endpoints: %w", err)
	}
	for rows.Next() {
		var ep string
		var cnt int64
		if err := rows.Scan(&ep, &cnt); err != nil {
			rows.Close()
			return nil, err
		}
		s.EndpointCounts[ep] = cnt
	}
	rows.Close()

	// Op type counts
	rows, err = l.db.Query(fmt.Sprintf(`
		SELECT op_type, COUNT(*) FROM audit_log %s AND op_type IS NOT NULL AND op_type != '' GROUP BY op_type`, whereClause), args...)
	if err != nil {
		return nil, fmt.Errorf("summary op_types: %w", err)
	}
	for rows.Next() {
		var ot string
		var cnt int64
		if err := rows.Scan(&ot, &cnt); err != nil {
			rows.Close()
			return nil, err
		}
		s.OpTypeCounts[ot] = cnt
	}
	rows.Close()

	// Budget rejections (403 responses)
	row = l.db.QueryRow(fmt.Sprintf(`
		SELECT COUNT(*) FROM audit_log %s AND response_code = 403`, whereClause), args...)
	if err := row.Scan(&s.BudgetRejections); err != nil {
		return nil, fmt.Errorf("summary rejections: %w", err)
	}

	// Recent errors (last 10)
	errRows, err := l.db.Query(fmt.Sprintf(`
		SELECT timestamp, endpoint, method, token_level, request_body, response_code, amount_sats, op_type, idempotency_key, error
		FROM audit_log %s AND response_code >= 400 ORDER BY id DESC LIMIT 10`, whereClause), args...)
	if err != nil {
		return nil, fmt.Errorf("summary errors: %w", err)
	}
	s.RecentErrors, err = scanEntries(errRows)
	if err != nil {
		return nil, err
	}

	return s, nil
}

// Close closes the database connection.
func (l *Logger) Close() error {
	return l.db.Close()
}

// DB returns the underlying database connection for advanced queries.
func (l *Logger) DB() *sql.DB {
	return l.db
}

func (l *Logger) writeFallback(e Entry) {
	l.fallbackMu.Lock()
	defer l.fallbackMu.Unlock()

	f, err := os.OpenFile(l.fallbackPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0640)
	if err != nil {
		l.logger.Error("audit fallback file open failed", "error", err)
		return
	}
	defer f.Close()

	if err := json.NewEncoder(f).Encode(e); err != nil {
		l.logger.Error("audit fallback write failed", "error", err)
	}
}
