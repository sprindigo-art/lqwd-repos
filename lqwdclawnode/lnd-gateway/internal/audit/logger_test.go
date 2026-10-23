package audit

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/killswitch"
)

func TestPostHocBudget_EngagesKillSwitch(t *testing.T) {
	tmpDir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	ks := killswitch.New(filepath.Join(tmpDir, "ks"))

	auditLog, err := New(
		filepath.Join(tmpDir, "audit.db"),
		filepath.Join(tmpDir, "fallback.jsonl"),
		logger, ks, 100,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer auditLog.Close()

	// Log 60 sats (under limit)
	auditLog.Log(Entry{
		Endpoint: "payment", Method: "POST", TokenLevel: "agent",
		ResponseCode: 200, AmountSats: 60, OpType: "payment",
	})
	if ks.IsActive() {
		t.Fatal("kill switch should NOT be active after 60 sats (limit 100)")
	}

	// Log another 60 sats (total 120 > limit 100)
	auditLog.Log(Entry{
		Endpoint: "payment", Method: "POST", TokenLevel: "agent",
		ResponseCode: 200, AmountSats: 60, OpType: "payment",
	})
	if !ks.IsActive() {
		t.Fatal("kill switch should be active after 120 sats (limit 100)")
	}
}

func TestPostHocBudget_SkipsZeroAmount(t *testing.T) {
	tmpDir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	ks := killswitch.New(filepath.Join(tmpDir, "ks"))

	auditLog, err := New(
		filepath.Join(tmpDir, "audit.db"),
		filepath.Join(tmpDir, "fallback.jsonl"),
		logger, ks, 100,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer auditLog.Close()

	// Log a read-only entry (AmountSats=0)
	auditLog.Log(Entry{
		Endpoint: "info", Method: "POST", TokenLevel: "agent",
		ResponseCode: 200, AmountSats: 0,
	})
	if ks.IsActive() {
		t.Fatal("kill switch should NOT be active for zero-amount entries")
	}
}

func TestPostHocBudget_SkipsWhenNilKillSwitch(t *testing.T) {
	tmpDir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	auditLog, err := New(
		filepath.Join(tmpDir, "audit.db"),
		filepath.Join(tmpDir, "fallback.jsonl"),
		logger, nil, 100,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer auditLog.Close()

	// Should not panic with nil kill switch
	auditLog.Log(Entry{
		Endpoint: "payment", Method: "POST", TokenLevel: "agent",
		ResponseCode: 200, AmountSats: 200, OpType: "payment",
	})
	// No assertion needed — just verify no panic
}

func TestDailySpend_Excludes202(t *testing.T) {
	tmpDir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	auditLog, err := New(
		filepath.Join(tmpDir, "audit.db"),
		filepath.Join(tmpDir, "fallback.jsonl"),
		logger, nil, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer auditLog.Close()

	// Log a 202 Accepted entry (pending confirmation) — should NOT count toward daily spend
	auditLog.Log(Entry{
		Endpoint: "/v1/channels/open", Method: "POST", TokenLevel: "agent",
		ResponseCode: 202, AmountSats: 100_000, OpType: "channel_open",
	})

	spend, err := auditLog.DailySpend()
	if err != nil {
		t.Fatalf("DailySpend() error: %v", err)
	}
	if spend != 0 {
		t.Fatalf("DailySpend() = %d, want 0 (202 entries should be excluded)", spend)
	}

	// Log a 200 OK entry (confirmed execution) — SHOULD count toward daily spend
	auditLog.Log(Entry{
		Endpoint: "/v1/payments/send", Method: "POST", TokenLevel: "agent",
		ResponseCode: 200, AmountSats: 50_000, OpType: "payment",
	})

	spend, err = auditLog.DailySpend()
	if err != nil {
		t.Fatalf("DailySpend() error: %v", err)
	}
	if spend != 50_000 {
		t.Fatalf("DailySpend() = %d, want 50000 (only 200 OK entries should count)", spend)
	}
}

func TestPostHocBudget_SkipsWhenLimitZero(t *testing.T) {
	tmpDir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	ks := killswitch.New(filepath.Join(tmpDir, "ks"))

	auditLog, err := New(
		filepath.Join(tmpDir, "audit.db"),
		filepath.Join(tmpDir, "fallback.jsonl"),
		logger, ks, 0, // limit is 0 => disabled
	)
	if err != nil {
		t.Fatal(err)
	}
	defer auditLog.Close()

	auditLog.Log(Entry{
		Endpoint: "payment", Method: "POST", TokenLevel: "agent",
		ResponseCode: 200, AmountSats: 200, OpType: "payment",
	})
	if ks.IsActive() {
		t.Fatal("kill switch should NOT be active when maxDailySpendSats is 0 (disabled)")
	}
}
