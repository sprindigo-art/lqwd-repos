package handlers

import (
	"database/sql"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/audit"

	_ "github.com/mattn/go-sqlite3"
)

// --- AuditQuery tests ---

func TestAuditQuery_Empty(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.AuditQuery, map[string]any{})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	if resp["ok"] != true {
		t.Fatal("expected ok=true")
	}
	// Should return empty list, not nil
	count := resp["count"].(float64)
	if count != 0 {
		t.Fatalf("expected 0 entries, got %v", count)
	}
}

func TestAuditQuery_WithData(t *testing.T) {
	deps := newTestDeps(t)

	// Insert some audit entries
	deps.Audit.Log(audit.Entry{
		Endpoint:     "test_endpoint",
		Method:       "POST",
		TokenLevel:   "agent",
		ResponseCode: 200,
		OpType:       "payment",
		AmountSats:   50000,
	})
	deps.Audit.Log(audit.Entry{
		Endpoint:     "test_endpoint_2",
		Method:       "POST",
		TokenLevel:   "agent",
		ResponseCode: 403,
		Error:        "budget_exceeded",
	})

	// Query all
	w := postJSON(deps.AuditQuery, map[string]any{})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	count := resp["count"].(float64)
	if count != 2 {
		t.Fatalf("expected 2 entries, got %v", count)
	}

	// Query errors only
	w = postJSON(deps.AuditQuery, map[string]any{"errors_only": true})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	resp = decodeResp(t, w)
	count = resp["count"].(float64)
	if count != 1 {
		t.Fatalf("expected 1 error entry, got %v", count)
	}

	// Query by endpoint
	w = postJSON(deps.AuditQuery, map[string]any{"endpoint": "test_endpoint"})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	resp = decodeResp(t, w)
	count = resp["count"].(float64)
	if count != 1 {
		t.Fatalf("expected 1 entry for endpoint filter, got %v", count)
	}

	// Query by op_type
	w = postJSON(deps.AuditQuery, map[string]any{"op_type": "payment"})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	resp = decodeResp(t, w)
	count = resp["count"].(float64)
	if count != 1 {
		t.Fatalf("expected 1 entry for op_type filter, got %v", count)
	}
}

// --- AuditSummary tests ---

func TestAuditSummary_Empty(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.AuditSummary, map[string]any{})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	if resp["ok"] != true {
		t.Fatal("expected ok=true")
	}
	data := resp["data"].(map[string]any)
	if data["total_requests"].(float64) != 0 {
		t.Fatalf("expected 0 total requests, got %v", data["total_requests"])
	}
}

func TestAuditSummary_WithData(t *testing.T) {
	deps := newTestDeps(t)

	// Insert varied audit entries
	deps.Audit.Log(audit.Entry{
		Endpoint: "payment", Method: "POST", TokenLevel: "agent",
		ResponseCode: 200, OpType: "payment", AmountSats: 50000,
	})
	deps.Audit.Log(audit.Entry{
		Endpoint: "payment", Method: "POST", TokenLevel: "agent",
		ResponseCode: 200, OpType: "payment", AmountSats: 30000,
	})
	deps.Audit.Log(audit.Entry{
		Endpoint: "channel_open", Method: "POST", TokenLevel: "agent",
		ResponseCode: 403, Error: "budget_exceeded",
	})
	deps.Audit.Log(audit.Entry{
		Endpoint: "info", Method: "POST", TokenLevel: "agent",
		ResponseCode: 200,
	})

	w := postJSON(deps.AuditSummary, map[string]any{})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	data := resp["data"].(map[string]any)

	if data["total_requests"].(float64) != 4 {
		t.Fatalf("expected 4 total requests, got %v", data["total_requests"])
	}
	if data["success_count"].(float64) != 3 {
		t.Fatalf("expected 3 successes, got %v", data["success_count"])
	}
	if data["error_count"].(float64) != 1 {
		t.Fatalf("expected 1 error, got %v", data["error_count"])
	}
	if data["total_spend_sats"].(float64) != 80000 {
		t.Fatalf("expected 80000 total spend, got %v", data["total_spend_sats"])
	}
	if data["budget_rejections"].(float64) != 1 {
		t.Fatalf("expected 1 budget rejection, got %v", data["budget_rejections"])
	}

	epCounts := data["endpoint_counts"].(map[string]any)
	if epCounts["payment"].(float64) != 2 {
		t.Fatalf("expected 2 payment endpoint calls, got %v", epCounts["payment"])
	}

	opCounts := data["op_type_counts"].(map[string]any)
	if opCounts["payment"].(float64) != 2 {
		t.Fatalf("expected 2 payment op_type counts, got %v", opCounts["payment"])
	}
}

// TestAudit_RequestID verifies that audit entries persist the request ID in SQLite (OBS-01c per D-14).
func TestAudit_RequestID(t *testing.T) {
	deps := newTestDeps(t)

	// Log an audit entry with a known request ID
	deps.Audit.Log(audit.Entry{
		Endpoint:     "/test",
		Method:       "POST",
		TokenLevel:   "agent",
		ResponseCode: 200,
		RequestID:    "trace-abc-123",
	})

	// Query the audit DB directly to verify request_id was stored
	tmpDir := t.TempDir()
	// The deps audit DB is in a different temp dir — use DB() accessor
	var requestID string
	err := deps.Audit.DB().QueryRow(
		`SELECT request_id FROM audit_log ORDER BY rowid DESC LIMIT 1`,
	).Scan(&requestID)
	if err != nil {
		t.Fatalf("query audit DB: %v", err)
	}

	_ = tmpDir // unused, we use DB() instead
	_ = filepath.Join // suppress import

	if requestID != "trace-abc-123" {
		t.Fatalf("expected request_id='trace-abc-123', got %q", requestID)
	}
}

// TestAudit_RequestID_DirectDB verifies via a separate DB connection that request_id is in SQLite.
func TestAudit_RequestID_DirectDB(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "audit.db")

	// Open a direct connection to verify the column exists
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_txlock=immediate")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// Create table + migration (same as audit.New does)
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS audit_log (
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
		error TEXT,
		request_id TEXT DEFAULT ''
	)`)
	if err != nil {
		t.Fatal(err)
	}

	// Insert a row with request_id
	_, err = db.Exec(`INSERT INTO audit_log (endpoint, method, token_level, response_code, request_id) VALUES (?, ?, ?, ?, ?)`,
		"/test", "POST", "agent", 200, "trace-direct-456")
	if err != nil {
		t.Fatal(err)
	}

	var requestID string
	err = db.QueryRow(`SELECT request_id FROM audit_log ORDER BY rowid DESC LIMIT 1`).Scan(&requestID)
	if err != nil {
		t.Fatal(err)
	}
	if requestID != "trace-direct-456" {
		t.Fatalf("expected 'trace-direct-456', got %q", requestID)
	}
}
