package lnd

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/mock"
)

// TestCloseChannel_StreamTimeoutPresent verifies that the CloseChannel gRPC
// implementation wraps stream.Recv() with a 60-second context deadline.
//
// The GRPCClient cannot be exercised against a live LND node in unit tests,
// so we assert the safety property by inspecting the implementation source.
// This guards against accidental removal of the timeout during refactors.
func TestCloseChannel_StreamTimeoutPresent(t *testing.T) {
	// Locate grpc.go relative to this test file.
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed — cannot locate source directory")
	}
	grpcPath := filepath.Join(filepath.Dir(thisFile), "grpc.go")

	data, err := os.ReadFile(grpcPath)
	if err != nil {
		t.Fatalf("cannot read grpc.go: %v", err)
	}
	src := string(data)

	// Requirement: CloseChannel must create a bounded context before calling
	// lightning.CloseChannel so that stream.Recv() cannot block indefinitely.
	checks := []struct {
		name    string
		pattern string
	}{
		{
			name:    "context.WithTimeout wrapping in CloseChannel",
			pattern: "context.WithTimeout(ctx, 60*time.Second)",
		},
		{
			name:    "timeout context assigned to closeCtx",
			pattern: "closeCtx, closeCancel := context.WithTimeout",
		},
		{
			name:    "defer closeCancel() to release resources",
			pattern: "defer closeCancel()",
		},
		{
			name:    "gRPC call uses closeCtx (not the original ctx)",
			pattern: "c.lightning.CloseChannel(closeCtx,",
		},
	}

	for _, c := range checks {
		if !strings.Contains(src, c.pattern) {
			t.Errorf("FAIL [%s]: grpc.go does not contain %q", c.name, c.pattern)
		}
	}
}

// TestPendingChannelsReturnsFiveKeys is the cross-layer shape assertion for
// the Phase 22 Stage A widening. It cross-checks mock.PendingChannels()
// against the same top-level contract (*GRPCClient).PendingChannels must honor
// — four per-bucket channel slices plus total_limbo_balance.
//
// The live gRPC wrapper cannot be unit-tested without an LND node; we assert
// its contract indirectly by (a) forcing the mock to the same shape and
// (b) grepping the wrapper source for the five key names. If either leg
// drifts, Phase 22's shared lndparse parser would start emitting empty state
// — the UAT-11 bug class we explicitly wrote this package to prevent.
func TestPendingChannelsReturnsFiveKeys(t *testing.T) {
	resp := mock.PendingChannels()
	data, ok := resp["data"].(map[string]any)
	if !ok {
		t.Fatal("mock.PendingChannels: data is not map[string]any")
	}
	wantKeys := []string{
		"pending_open_channels",
		"pending_closing_channels",
		"pending_force_closing_channels",
		"waiting_close_channels",
		"total_limbo_balance",
	}
	for _, k := range wantKeys {
		if _, exists := data[k]; !exists {
			t.Errorf("mock.PendingChannels: key %q missing", k)
		}
	}

	// Per-bucket type assertion: the three non-empty buckets must be
	// []map[string]any so the shared lndparse package can iterate them
	// directly without falling through the []any branch.
	for _, k := range []string{"pending_open_channels", "pending_closing_channels", "pending_force_closing_channels"} {
		if _, ok := data[k].([]map[string]any); !ok {
			t.Errorf("mock.PendingChannels: key %q is not []map[string]any (got %T)", k, data[k])
		}
	}
	if _, ok := data["total_limbo_balance"].(int64); !ok {
		t.Errorf("mock.PendingChannels: total_limbo_balance is not int64 (got %T)", data["total_limbo_balance"])
	}

	// Cross-check the live gRPC wrapper source emits all five keys — guards
	// against a future refactor that drops one bucket from the widened
	// shape and silently breaks downstream consumers.
	_, thisFile, _, ok2 := runtime.Caller(0)
	if !ok2 {
		t.Fatal("runtime.Caller failed — cannot locate source directory")
	}
	grpcSrc, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "grpc.go"))
	if err != nil {
		t.Fatalf("cannot read grpc.go: %v", err)
	}
	for _, k := range wantKeys {
		if !strings.Contains(string(grpcSrc), `"`+k+`"`) {
			t.Errorf("grpc.go PendingChannels does not emit key %q", k)
		}
	}
}
