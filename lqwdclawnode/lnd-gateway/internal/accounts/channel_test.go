package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lnd"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/mock"
)

func TestChannelSlotReservation(t *testing.T) {
	store := NewMockStore()
	store.FaucetChannelCap = 2
	ctx := context.Background()

	// Register an agent
	agent, _, err := store.Register(ctx, "test-agent", "127.0.0.1")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	pubkey := "02" + "ab" + "cd" + "ef" + "01" + "23" + "45" + "67" + "89" + "ab" + "cd" + "ef" + "01" + "23" + "45" + "67" + "89" + "ab" + "cd" + "ef" + "01" + "23" + "45" + "67" + "89" + "ab" + "cd" + "ef" + "01" + "23" + "45" + "67"
	// That's 02 + 32 bytes hex = 66 chars total. Let's use a proper hex string.
	pubkey = "02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	nodeURI := pubkey + "@127.0.0.1:9735"

	// Test: ReserveChannelSlot succeeds when cap not reached, returns grant ID (UUID)
	grantID, err := store.ReserveChannelSlot(ctx, agent.ID, pubkey, nodeURI, 100000, 25000)
	if err != nil {
		t.Fatalf("ReserveChannelSlot: %v", err)
	}
	if grantID == "" {
		t.Fatal("expected non-empty grant ID")
	}

	// Verify grant exists via GetChannelGrantByID
	grant, err := store.GetChannelGrantByID(ctx, grantID)
	if err != nil {
		t.Fatalf("GetChannelGrantByID: %v", err)
	}
	if grant == nil {
		t.Fatal("expected grant, got nil")
	}
	if grant.Status != "pending" {
		t.Fatalf("expected status pending, got %s", grant.Status)
	}
	if grant.ChannelSize != 100000 {
		t.Fatalf("expected channel size 100000, got %d", grant.ChannelSize)
	}
}

func TestChannelSlotCapEnforcement(t *testing.T) {
	store := NewMockStore()
	store.FaucetChannelCap = 1
	ctx := context.Background()

	agent, _, _ := store.Register(ctx, "test-agent", "127.0.0.1")
	pubkey1 := "02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	pubkey2 := "03abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

	// First slot succeeds
	_, err := store.ReserveChannelSlot(ctx, agent.ID, pubkey1, pubkey1+"@127.0.0.1:9735", 100000, 25000)
	if err != nil {
		t.Fatalf("first reserve: %v", err)
	}

	// Second slot hits cap
	_, err = store.ReserveChannelSlot(ctx, agent.ID, pubkey2, pubkey2+"@127.0.0.1:9735", 100000, 25000)
	if err != ErrFaucetChannelCap {
		t.Fatalf("expected ErrFaucetChannelCap, got %v", err)
	}
}

func TestChannelSlotBanEnforcement(t *testing.T) {
	store := NewMockStore()
	store.FaucetChannelCap = 10
	ctx := context.Background()

	agent, _, _ := store.Register(ctx, "test-agent", "127.0.0.1")
	pubkey := "02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

	// Ban policy (2026-04-22): requires FaucetBanAfterFailures failures
	// before banning. Verify single failure does NOT ban, and that the
	// Nth failure does.
	for i := 1; i < FaucetBanAfterFailures; i++ {
		grantID, err := store.ReserveChannelSlot(ctx, agent.ID, pubkey, pubkey+"@127.0.0.1:9735", 100000, 25000)
		if err != nil {
			t.Fatalf("reserve #%d: %v", i, err)
		}
		if err := store.UpdateChannelStatus(ctx, grantID, "failed", "", "peer unreachable", 0); err != nil {
			t.Fatalf("UpdateChannelStatus fail #%d: %v", i, err)
		}
		// After each sub-threshold failure, agent must still be able to reserve.
		// This proves the new 3-strikes-before-ban contract holds.
	}

	// Final failure — this one trips the ban.
	grantID, err := store.ReserveChannelSlot(ctx, agent.ID, pubkey, pubkey+"@127.0.0.1:9735", 100000, 25000)
	if err != nil {
		t.Fatalf("final reserve: %v", err)
	}
	if err := store.UpdateChannelStatus(ctx, grantID, "failed", "", "peer unreachable", 0); err != nil {
		t.Fatalf("UpdateChannelStatus final fail: %v", err)
	}

	// Next reserve for same pubkey should now fail with ban.
	_, err = store.ReserveChannelSlot(ctx, agent.ID, pubkey, pubkey+"@127.0.0.1:9735", 100000, 25000)
	if err != ErrPubkeyBanned {
		t.Fatalf("expected ErrPubkeyBanned after %d failures, got %v", FaucetBanAfterFailures, err)
	}
}

// TestChannelSlotBanNotTriggeredByFirstFailure pins the core behavior change
// from 2026-04-22: a single transient failure must NOT ban the pubkey. This
// protects fresh agents from being locked out after a one-off reachability
// glitch during their first registration attempt.
func TestChannelSlotBanNotTriggeredByFirstFailure(t *testing.T) {
	store := NewMockStore()
	store.FaucetChannelCap = 10
	ctx := context.Background()
	agent, _, _ := store.Register(ctx, "test-agent", "127.0.0.1")
	pubkey := "02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

	// One failure — must NOT ban.
	grantID, _ := store.ReserveChannelSlot(ctx, agent.ID, pubkey, pubkey+"@127.0.0.1:9735", 100000, 25000)
	if err := store.UpdateChannelStatus(ctx, grantID, "failed", "", "transient: dial tcp timeout", 0); err != nil {
		t.Fatalf("fail #1: %v", err)
	}

	// Pubkey must be able to reserve again immediately.
	if _, err := store.ReserveChannelSlot(ctx, agent.ID, pubkey, pubkey+"@127.0.0.1:9735", 100000, 25000); err != nil {
		t.Fatalf("single failure should not ban; got %v", err)
	}

	// Guard: policy constant is actually > 1 so this test is meaningful.
	if FaucetBanAfterFailures <= 1 {
		t.Fatalf("FaucetBanAfterFailures must be >= 2 for this test to be meaningful; got %d", FaucetBanAfterFailures)
	}
}

// TestFailCategoryClassification pins the classifier output for each known
// error family. If LND's error text changes, this test should be updated at
// the same time as the handler it forces back in sync.
func TestFailCategoryClassification(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"connect peer", "connect_peer: dial tcp 1.2.3.4:9735: i/o timeout", "connect_peer_failed"},
		{"not online", "peer is not online", "connect_peer_failed"},
		{"reserve", "open_channel: rpc error: reserved wallet balance invalidated: transaction would leave insufficient funds for fee bumping anchor channels", "reserve_insufficient"},
		{"funding rejected", "received funding error from peer X: err=Channel request rejected", "funding_rejected"},
		{"timeout", "open_channel: context deadline exceeded", "timeout"},
		{"invalid pubkey", "invalid pubkey: not hex", "validation"},
		{"empty", "", ""},
		{"unknown", "totally new error LND might produce later", "unknown"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := FailCategory(c.in); got != c.want {
				t.Errorf("FailCategory(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestChannelStatusTransitions(t *testing.T) {
	store := NewMockStore()
	store.FaucetChannelCap = 10
	ctx := context.Background()

	agent, _, _ := store.Register(ctx, "test-agent", "127.0.0.1")
	pubkey := "02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

	// Reserve and transition to pending_open
	grantID, _ := store.ReserveChannelSlot(ctx, agent.ID, pubkey, pubkey+"@127.0.0.1:9735", 100000, 25000)
	err := store.UpdateChannelStatus(ctx, grantID, "pending_open", "abc123:0", "", 0)
	if err != nil {
		t.Fatalf("UpdateChannelStatus to pending_open: %v", err)
	}

	grant, _ := store.GetChannelGrantByID(ctx, grantID)
	if grant.Status != "pending_open" {
		t.Fatalf("expected status pending_open, got %s", grant.Status)
	}
	if grant.FundingTxID != "abc123:0" {
		t.Fatalf("expected funding_txid abc123:0, got %s", grant.FundingTxID)
	}

	// Transition to open
	err = store.UpdateChannelStatus(ctx, grantID, "open", "", "", 0)
	if err != nil {
		t.Fatalf("UpdateChannelStatus to open: %v", err)
	}
	grant, _ = store.GetChannelGrantByID(ctx, grantID)
	if grant.Status != "open" {
		t.Fatalf("expected status open, got %s", grant.Status)
	}
	if grant.OpenedAt == nil {
		t.Fatal("expected opened_at to be set")
	}
}

func TestChannelFailedSlotReleased(t *testing.T) {
	store := NewMockStore()
	store.FaucetChannelCap = 1
	ctx := context.Background()

	agent, _, _ := store.Register(ctx, "test-agent", "127.0.0.1")
	pubkey1 := "02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	pubkey2 := "03abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

	// Reserve slot 1
	grantID, _ := store.ReserveChannelSlot(ctx, agent.ID, pubkey1, pubkey1+"@127.0.0.1:9735", 100000, 25000)

	// Mark as failed -- slot released
	_ = store.UpdateChannelStatus(ctx, grantID, "failed", "", "peer unreachable", 0)

	// Now a different pubkey can reserve (failed grants don't count toward cap)
	_, err := store.ReserveChannelSlot(ctx, agent.ID, pubkey2, pubkey2+"@127.0.0.1:9735", 100000, 25000)
	if err != nil {
		t.Fatalf("expected reserve to succeed after failed slot released, got %v", err)
	}
}

func TestGetChannelGrant(t *testing.T) {
	store := NewMockStore()
	store.FaucetChannelCap = 10
	ctx := context.Background()

	agent, _, _ := store.Register(ctx, "test-agent", "127.0.0.1")
	pubkey := "02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

	// No grant yet
	grant, err := store.GetChannelGrant(ctx, agent.ID)
	if err != nil {
		t.Fatalf("GetChannelGrant: %v", err)
	}
	if grant != nil {
		t.Fatal("expected nil grant for new agent")
	}

	// Create a grant
	store.ReserveChannelSlot(ctx, agent.ID, pubkey, pubkey+"@127.0.0.1:9735", 100000, 25000)

	grant, err = store.GetChannelGrant(ctx, agent.ID)
	if err != nil {
		t.Fatalf("GetChannelGrant: %v", err)
	}
	if grant == nil {
		t.Fatal("expected grant, got nil")
	}
	if grant.AgentID != agent.ID {
		t.Fatalf("expected agent ID %s, got %s", agent.ID, grant.AgentID)
	}
}

func TestListPendingChannels(t *testing.T) {
	store := NewMockStore()
	store.FaucetChannelCap = 10
	ctx := context.Background()

	agent, _, _ := store.Register(ctx, "test-agent", "127.0.0.1")
	pubkey1 := "02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	pubkey2 := "03abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

	// Create two grants
	grantID1, _ := store.ReserveChannelSlot(ctx, agent.ID, pubkey1, pubkey1+"@127.0.0.1:9735", 100000, 25000)
	store.ReserveChannelSlot(ctx, agent.ID, pubkey2, pubkey2+"@127.0.0.1:9735", 100000, 25000)

	// Both should be pending
	pending, err := store.ListPendingChannels(ctx)
	if err != nil {
		t.Fatalf("ListPendingChannels: %v", err)
	}
	if len(pending) != 2 {
		t.Fatalf("expected 2 pending, got %d", len(pending))
	}

	// Mark one as open -- no longer pending
	store.UpdateChannelStatus(ctx, grantID1, "open", "", "", 0)
	pending, _ = store.ListPendingChannels(ctx)
	if len(pending) != 1 {
		t.Fatalf("expected 1 pending after open, got %d", len(pending))
	}
}

func TestClearPubkeyBan(t *testing.T) {
	store := NewMockStore()
	store.FaucetChannelCap = 10
	ctx := context.Background()

	agent, _, _ := store.Register(ctx, "test-agent", "127.0.0.1")
	pubkey := "02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

	// Fail FaucetBanAfterFailures times to trigger the ban.
	for i := 0; i < FaucetBanAfterFailures; i++ {
		grantID, rerr := store.ReserveChannelSlot(ctx, agent.ID, pubkey, pubkey+"@127.0.0.1:9735", 100000, 25000)
		if rerr != nil {
			t.Fatalf("reserve #%d: %v", i, rerr)
		}
		if uerr := store.UpdateChannelStatus(ctx, grantID, "failed", "", "peer unreachable", 0); uerr != nil {
			t.Fatalf("fail #%d: %v", i, uerr)
		}
	}

	// Banned
	_, err := store.ReserveChannelSlot(ctx, agent.ID, pubkey, pubkey+"@127.0.0.1:9735", 100000, 25000)
	if err != ErrPubkeyBanned {
		t.Fatalf("expected ErrPubkeyBanned, got %v", err)
	}

	// Clear ban
	err = store.ClearPubkeyBan(ctx, pubkey)
	if err != nil {
		t.Fatalf("ClearPubkeyBan: %v", err)
	}

	// Reserve should succeed now
	_, err = store.ReserveChannelSlot(ctx, agent.ID, pubkey, pubkey+"@127.0.0.1:9735", 100000, 25000)
	if err != nil {
		t.Fatalf("expected reserve to succeed after ban cleared, got %v", err)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 22 Plan 05 / CHO-04: AdminFaucetSummary pending-count extension.
// The summary response must surface pending_close_count and force_close_count
// derived from a live LND PendingChannels call, and must skip those keys
// gracefully when the LND lookup errors or no LND client is wired.
// ─────────────────────────────────────────────────────────────────────────────

// fakeLNDPendingOK returns the mock.PendingChannels() fixture unconditionally.
// Embeds lnd.Client so unimplemented methods panic if invoked (contract:
// AdminFaucetSummary must call PendingChannels and NO other RPC for this
// extension path).
type fakeLNDPendingOK struct {
	lnd.Client
}

func (f *fakeLNDPendingOK) PendingChannels(ctx context.Context) (map[string]any, error) {
	return mock.PendingChannels(), nil
}

// fakeLNDPendingErr always fails the PendingChannels RPC. Embeds lnd.Client
// so any method other than PendingChannels panics on invocation.
type fakeLNDPendingErr struct {
	lnd.Client
}

func (f *fakeLNDPendingErr) PendingChannels(ctx context.Context) (map[string]any, error) {
	return nil, errors.New("simulated LND outage")
}

// TestAdminFaucetSummaryPendingCounts asserts CHO-04: when the LND PendingChannels
// call succeeds, the summary response surfaces pending_close_count and
// force_close_count counted from the mock fixture (1 pending_closing,
// 1 pending_force_closing per Plan 22-02's mock).
func TestAdminFaucetSummaryPendingCounts(t *testing.T) {
	store := NewMockStore()
	ch := &ChannelHandlers{
		Store:      store,
		LND:        &fakeLNDPendingOK{},
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}

	req := httptest.NewRequest("GET", "/v1/internal/admin/faucet/summary", nil)
	req.Header.Set("Authorization", "Bearer test-admin-token")
	rec := httptest.NewRecorder()

	ch.AdminFaucetSummary(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	var resp struct {
		OK   bool           `json:"ok"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !resp.OK {
		t.Fatalf("ok=false body=%s", rec.Body.String())
	}

	// Mock fixture: 1 pending_closing, 1 pending_force_closing.
	// JSON numbers unmarshal into float64 via map[string]any.
	if got := resp.Data["pending_close_count"]; got != float64(1) {
		t.Errorf("pending_close_count=%v want 1 (got type %T)", got, got)
	}
	if got := resp.Data["force_close_count"]; got != float64(1) {
		t.Errorf("force_close_count=%v want 1 (got type %T)", got, got)
	}
}

// TestAdminFaucetSummaryPendingCountsAbsentOnLNDError asserts the graceful-
// degrade path: when LND.PendingChannels errors, the two count keys are
// ABSENT from the response rather than reported as zero. Operators seeing
// zero counts should be able to trust that the node truly has no
// pending-close channels; a silent zero on RPC failure would be a lie.
// The rest of the summary (total, by_status, config) must still surface.
func TestAdminFaucetSummaryPendingCountsAbsentOnLNDError(t *testing.T) {
	store := NewMockStore()
	ch := &ChannelHandlers{
		Store:      store,
		LND:        &fakeLNDPendingErr{},
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}

	req := httptest.NewRequest("GET", "/v1/internal/admin/faucet/summary", nil)
	req.Header.Set("Authorization", "Bearer test-admin-token")
	rec := httptest.NewRecorder()

	ch.AdminFaucetSummary(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	var resp struct {
		OK   bool           `json:"ok"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, present := resp.Data["pending_close_count"]; present {
		t.Errorf("pending_close_count should be absent when LND errors, got %v", resp.Data["pending_close_count"])
	}
	if _, present := resp.Data["force_close_count"]; present {
		t.Errorf("force_close_count should be absent when LND errors, got %v", resp.Data["force_close_count"])
	}
	// Existing summary fields must still be present.
	if _, present := resp.Data["by_status"]; !present {
		t.Errorf("by_status missing — LND error must not suppress the rest of the summary")
	}
	if _, present := resp.Data["config"]; !present {
		t.Errorf("config missing — LND error must not suppress the rest of the summary")
	}
}

// TestAdminFaucetSummaryPendingCountsAbsentWhenNoLND asserts that when the
// handler has no LND client wired (ch.LND == nil — e.g. pure mock-mode
// unit test setups), the count keys are absent and the summary still works.
// Mirrors the defensive ch.LND != nil guard used in channel_status's
// lookup branch.
func TestAdminFaucetSummaryPendingCountsAbsentWhenNoLND(t *testing.T) {
	store := NewMockStore()
	ch := &ChannelHandlers{
		Store:      store,
		LND:        nil,
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}

	req := httptest.NewRequest("GET", "/v1/internal/admin/faucet/summary", nil)
	req.Header.Set("Authorization", "Bearer test-admin-token")
	rec := httptest.NewRecorder()

	ch.AdminFaucetSummary(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if _, present := resp.Data["pending_close_count"]; present {
		t.Errorf("pending_close_count should be absent when ch.LND is nil")
	}
	if _, present := resp.Data["force_close_count"]; present {
		t.Errorf("force_close_count should be absent when ch.LND is nil")
	}
}
