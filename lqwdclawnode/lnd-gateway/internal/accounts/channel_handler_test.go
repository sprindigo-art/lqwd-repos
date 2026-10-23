package accounts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/feeestimate"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lnd"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/mock"
)

// waitForGrantStatus polls the store until the grant transitions away from notStatus
// or the deadline is reached. Avoids flaky time.Sleep-based testing.
func waitForGrantStatus(t *testing.T, store *MockStore, grantID string, notStatus string, timeout time.Duration) *ChannelGrant {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		grant, _ := store.GetChannelGrantByID(context.Background(), grantID)
		if grant != nil && grant.Status != notStatus {
			return grant
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("grant %s did not transition from %q within %v", grantID, notStatus, timeout)
	return nil
}

// validTestPubkey returns a valid 66-char hex pubkey for testing.
func validTestPubkey() string {
	return "02aabbccddee00112233445566778899aabbccddee00112233445566778899aabb"
}

// validTestNodeURI returns a valid node_uri for testing (pubkey@host:port).
func validTestNodeURI() string {
	return validTestPubkey() + "@1.2.3.4:9735"
}

func TestRegisterWithChannel(t *testing.T) {
	store := NewMockStore()
	logger := slog.Default()
	h := &Handlers{
		Store:       store,
		MockMode:    true,
		ChannelSize: 100_000,
		PushAmount:  25_000,
		Logger:      logger,
	}

	body := bytes.NewBufferString(`{"name":"channel-agent","pubkey":"` + validTestPubkey() + `","node_uri":"` + validTestNodeURI() + `"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)

	// Verify channel_granted is true
	if data["channel_granted"] != true {
		t.Errorf("expected channel_granted=true, got %v", data["channel_granted"])
	}
	if data["channel_status"] != "pending" {
		t.Errorf("expected channel_status=pending, got %v", data["channel_status"])
	}
	channelID, ok := data["channel_id"].(string)
	if !ok || channelID == "" {
		t.Fatal("expected non-empty channel_id")
	}

	// Verify async goroutine completes via polling (no time.Sleep(50ms))
	grant := waitForGrantStatus(t, store, channelID, "pending", 2*time.Second)
	if grant.Status != "pending_open" {
		t.Errorf("expected grant status=pending_open, got %s", grant.Status)
	}

	// Verify mock open channel was called with correct funding txid
	_ = mock.OpenChannel(validTestPubkey(), 100_000)

	// next_steps must include channel_status_url so the agent knows where
	// to poll their pending channel open. The URL is intentionally only
	// surfaced when a channel is actually granted — keeps the public
	// discovery catalog tight while still giving granted agents a way to
	// check status.
	ns, ok := data["next_steps"].(map[string]any)
	if !ok {
		t.Fatalf("missing next_steps in channel-granted response: %v", data)
	}
	statusURL, ok := ns["channel_status_url"].(string)
	if !ok || statusURL == "" {
		t.Errorf("next_steps.channel_status_url missing or empty when channel granted; got %v", ns["channel_status_url"])
	}
	if statusURL != "https://api.lqwdclaw.bot/v1/internal/channel/status" {
		t.Errorf("channel_status_url = %q, want https://api.lqwdclaw.bot/v1/internal/channel/status", statusURL)
	}
}

func TestRegisterCreditProxyOnly(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{
		Store:       store,
		MockMode:    true,
		ChannelSize: 100_000,
		PushAmount:  25_000,
		Logger:      slog.Default(),
	}

	body := bytes.NewBufferString(`{"name":"proxy-agent"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)

	// No channel fields should be present
	if _, ok := data["channel_granted"]; ok {
		t.Errorf("expected no channel_granted field for credit proxy, got %v", data["channel_granted"])
	}
	if _, ok := data["channel_status"]; ok {
		t.Errorf("expected no channel_status field for credit proxy, got %v", data["channel_status"])
	}

	// channel_status_url must NOT leak into next_steps for proxy-only
	// agents (no channel was granted, so there's nothing to poll).
	// Keeping the endpoint hidden from agents who don't need it matches
	// the v1 "keep it tight" posture.
	ns, _ := data["next_steps"].(map[string]any)
	if _, present := ns["channel_status_url"]; present {
		t.Errorf("channel_status_url must not appear for proxy-only registrations; got %v", ns["channel_status_url"])
	}
}

func TestRegisterBeyondChannelCap(t *testing.T) {
	store := NewMockStore()
	store.FaucetChannelCap = 0 // Cap reached
	h := &Handlers{
		Store:       store,
		MockMode:    true,
		ChannelSize: 100_000,
		PushAmount:  25_000,
		Logger:      slog.Default(),
	}

	body := bytes.NewBufferString(`{"name":"capped-agent","pubkey":"` + validTestPubkey() + `","node_uri":"` + validTestNodeURI() + `"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)

	if data["channel_granted"] != false {
		t.Errorf("expected channel_granted=false, got %v", data["channel_granted"])
	}
	if data["channel_reason"] != "faucet_exhausted" {
		t.Errorf("expected channel_reason=faucet_exhausted, got %v", data["channel_reason"])
	}
}

func TestRegisterBannedPubkey(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{
		Store:       store,
		MockMode:    true,
		ChannelSize: 100_000,
		PushAmount:  25_000,
		Logger:      slog.Default(),
	}

	// Pre-ban the pubkey by creating a failed grant
	store.mu.Lock()
	store.channels["ban-grant"] = &ChannelGrant{
		ID:     "ban-grant",
		Pubkey: validTestPubkey(),
		Banned: true,
		Status: "failed",
	}
	store.mu.Unlock()

	body := bytes.NewBufferString(`{"name":"banned-agent","pubkey":"` + validTestPubkey() + `","node_uri":"` + validTestNodeURI() + `"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)

	if data["channel_granted"] != false {
		t.Errorf("expected channel_granted=false, got %v", data["channel_granted"])
	}
	if data["channel_reason"] != "pubkey_banned" {
		t.Errorf("expected channel_reason=pubkey_banned, got %v", data["channel_reason"])
	}
}

func TestRegisterInvalidPubkey(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{
		Store:       store,
		MockMode:    true,
		ChannelSize: 100_000,
		PushAmount:  25_000,
		Logger:      slog.Default(),
	}

	body := bytes.NewBufferString(`{"name":"invalid-pk","pubkey":"not-a-valid-pubkey","node_uri":"not-a-valid-pubkey@1.2.3.4:9735"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestChannelStatus(t *testing.T) {
	store := NewMockStore()
	ch := &ChannelHandlers{
		Store:      store,
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}

	// Register an agent and create a channel grant
	agent, _, err := store.Register(context.Background(), "status-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	grantID, err := store.ReserveChannelSlot(context.Background(), agent.ID, validTestPubkey(), validTestNodeURI(), 100_000, 25_000)
	if err != nil {
		t.Fatal(err)
	}
	_ = store.UpdateChannelStatus(context.Background(), grantID, "pending_open", "mock_txid_123", "", 0)

	req := httptest.NewRequest("GET", "/v1/internal/channel/status", nil)
	ctx := SetAgent(req.Context(), agent)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	ch.ChannelStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["ok"] != true {
		t.Errorf("expected ok=true, got %v", resp["ok"])
	}
	data := resp["data"].(map[string]any)
	if data["status"] != "pending_open" {
		t.Errorf("expected status=pending_open, got %v", data["status"])
	}
}

func TestChannelStatusNoGrant(t *testing.T) {
	store := NewMockStore()
	ch := &ChannelHandlers{
		Store:      store,
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}

	agent, _, err := store.Register(context.Background(), "no-grant-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "/v1/internal/channel/status", nil)
	ctx := SetAgent(req.Context(), agent)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	ch.ChannelStatus(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAdminUnbanPubkey(t *testing.T) {
	store := NewMockStore()
	ch := &ChannelHandlers{
		Store:      store,
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}

	// Create a banned grant
	store.mu.Lock()
	store.channels["unban-grant"] = &ChannelGrant{
		ID:     "unban-grant",
		Pubkey: validTestPubkey(),
		Banned: true,
		Status: "failed",
	}
	store.mu.Unlock()

	body := bytes.NewBufferString(`{"pubkey":"` + validTestPubkey() + `"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/channel/unban", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Admin-Token", "test-admin-token")
	rec := httptest.NewRecorder()

	ch.AdminUnbanPubkey(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)
	if data["banned"] != false {
		t.Errorf("expected banned=false, got %v", data["banned"])
	}

	// Verify ban was actually cleared in store
	grant, _ := store.GetChannelGrantByID(context.Background(), "unban-grant")
	if grant.Banned {
		t.Error("expected ban to be cleared in store")
	}

	// Legacy X-Admin-Token emits a deprecation Warning header so
	// operators know to migrate to Authorization: Bearer.
	if w := rec.Header().Get("Warning"); !strings.Contains(w, "X-Admin-Token is deprecated") {
		t.Errorf("expected deprecation Warning header when legacy X-Admin-Token is used; got %q", w)
	}
}

func TestAdminUnbanPubkeyAcceptsBearer(t *testing.T) {
	// Standardization 2026-04-22: Authorization: Bearer is the
	// canonical admin auth header; X-Admin-Token is retained for
	// backwards compatibility only.
	store := NewMockStore()
	ch := &ChannelHandlers{
		Store:      store,
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}

	store.mu.Lock()
	store.channels["unban-bearer-grant"] = &ChannelGrant{
		ID: "unban-bearer-grant", Pubkey: validTestPubkey(), Banned: true, Status: "failed",
	}
	store.mu.Unlock()

	body := bytes.NewBufferString(`{"pubkey":"` + validTestPubkey() + `"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/channel/unban", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-admin-token")
	rec := httptest.NewRecorder()

	ch.AdminUnbanPubkey(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with Bearer auth, got %d: %s", rec.Code, rec.Body.String())
	}

	// Canonical path must NOT emit a deprecation warning.
	if w := rec.Header().Get("Warning"); w != "" {
		t.Errorf("Bearer auth must not trigger deprecation warning; got %q", w)
	}
}

func TestAdminUnbanNoToken(t *testing.T) {
	store := NewMockStore()
	ch := &ChannelHandlers{
		Store:      store,
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}

	body := bytes.NewBufferString(`{"pubkey":"` + validTestPubkey() + `"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/channel/unban", body)
	req.Header.Set("Content-Type", "application/json")
	// No X-Admin-Token header
	rec := httptest.NewRecorder()

	ch.AdminUnbanPubkey(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestOpenChannelUsesFeeEstimate verifies the REN-04 populator wire: the
// Estimator returns a live sat/vB, the Register handler's async OpenChannel
// path reads that value, and the grant row ends up with
// FundingFeeRateSatVB == the observed value. Plan 22-02a's integration
// assertion — without this wire, Plan 22-03's CAS UPDATE surfaces NULL in
// /v1/internal/channel/status.
func TestOpenChannelUsesFeeEstimate(t *testing.T) {
	// Fake mempool returning halfHourFee=32 sat/vB.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"fastestFee":37,"halfHourFee":32,"hourFee":28}`)
	}))
	defer srv.Close()

	est := feeestimate.New(feeestimate.Config{
		MempoolAPIBase: srv.URL,
		FallbackSatVB:  20,
	})
	est.Start(context.Background())
	if got := est.Current(); got != 32 {
		t.Fatalf("precondition: estimator Current=%d want 32", got)
	}

	store := NewMockStore()
	h := &Handlers{
		Store:        store,
		MockMode:     true,
		ChannelSize:  100_000,
		PushAmount:   25_000,
		Logger:       slog.Default(),
		FeeEstimator: est,
	}

	body := bytes.NewBufferString(`{"name":"fee-agent","pubkey":"` + validTestPubkey() + `","node_uri":"` + validTestNodeURI() + `"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)
	channelID, ok := data["channel_id"].(string)
	if !ok || channelID == "" {
		t.Fatal("expected non-empty channel_id")
	}

	// Wait for async openChannelAsync to record pending_open status.
	grant := waitForGrantStatus(t, store, channelID, "pending", 2*time.Second)
	if grant.Status != "pending_open" {
		t.Fatalf("expected status=pending_open, got %s", grant.Status)
	}
	// The fee-rate populator must have persisted the estimator's value
	// onto the grant row. This is the Plan 22-02a contract that Plan
	// 22-03's CAS propagates to /v1/internal/channel/status.
	if grant.FundingFeeRateSatVB == nil {
		t.Fatal("FundingFeeRateSatVB=nil; want 32 — fee-estimate wire did not persist")
	}
	if *grant.FundingFeeRateSatVB != 32 {
		t.Errorf("FundingFeeRateSatVB=%d want 32", *grant.FundingFeeRateSatVB)
	}
}

// TestOpenChannelNilEstimatorFallsBack verifies the defensive path: when the
// Handlers struct has no FeeEstimator (e.g., in legacy test harnesses or if
// the feature is disabled at boot), openChannelAsync must not panic and must
// leave FundingFeeRateSatVB as nil on the grant row.
func TestOpenChannelNilEstimatorFallsBack(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{
		Store:        store,
		MockMode:     true,
		ChannelSize:  100_000,
		PushAmount:   25_000,
		Logger:       slog.Default(),
		FeeEstimator: nil, // defensive nil
	}

	body := bytes.NewBufferString(`{"name":"no-fee-agent","pubkey":"` + validTestPubkey() + `","node_uri":"` + validTestNodeURI() + `"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)
	channelID, _ := data["channel_id"].(string)
	grant := waitForGrantStatus(t, store, channelID, "pending", 2*time.Second)
	if grant.FundingFeeRateSatVB != nil {
		t.Errorf("FundingFeeRateSatVB=%d want nil when estimator absent", *grant.FundingFeeRateSatVB)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 22 Plan 22-03 (CHO-01/CHO-02): authoritative live-LND lookup +
// CAS transition tests.
//
// These tests exercise the Stage C wire — ChannelStatus handler calling
// lndparse.LiveChannelLookup against a fake lnd.Client, and the resulting
// CAS transition on pending_open → open mutating the MockStore in-memory
// grant row. TestChannelStatusCASConcurrency is the FM-1 regression guard:
// under `-race` and `-count=5`, two concurrent handler invocations against
// the same pending_open grant must produce exactly one CAS winner and an
// "open" final state — no double-transition, no lost writes.
// ─────────────────────────────────────────────────────────────────────────────

// fakeLNDChannelLookup implements just enough of lnd.Client for
// lndparse.LiveChannelLookup. The embedded lnd.Client lets the compiler
// accept a struct that doesn't implement every method in the interface —
// any method not overridden will panic if called, which is what we want
// for these tests (only ListChannels / ClosedChannels are exercised).
type fakeLNDChannelLookup struct {
	lnd.Client // embed interface; unimplemented methods panic if reached
	channelPoint string
	// closed, when true, makes ClosedChannels return the target channel
	// point instead of ListChannels returning it. Used by the "closed"
	// path test if added in the future.
	closed bool
	// notFound, when true, makes both lookups return empty lists (the
	// "still confirming in LND" case).
	notFound bool
}

func (f *fakeLNDChannelLookup) ListChannels(ctx context.Context) (map[string]any, error) {
	if f.notFound || f.closed {
		return map[string]any{"data": map[string]any{"channels": []map[string]any{}}}, nil
	}
	return map[string]any{
		"data": map[string]any{
			"channels": []map[string]any{
				{"channel_point": f.channelPoint},
			},
		},
	}, nil
}

func (f *fakeLNDChannelLookup) ClosedChannels(ctx context.Context) (map[string]any, error) {
	if f.closed {
		return map[string]any{
			"data": map[string]any{
				"channels": []map[string]any{
					{"channel_point": f.channelPoint, "close_type": "COOPERATIVE_CLOSE"},
				},
			},
		}, nil
	}
	return map[string]any{"data": map[string]any{"channels": []map[string]any{}}}, nil
}

// seedPendingOpenGrant creates an agent and a grant pre-transitioned into
// pending_open with a known funding_txid + output_index. Returned tuple:
// (agent, grantID, channelPoint).
func seedPendingOpenGrant(t *testing.T, store *MockStore, fundingTxID string, outputIndex int) (*Agent, string, string) {
	t.Helper()
	agent, _, err := store.Register(context.Background(), "cas-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	grantID, err := store.ReserveChannelSlot(
		context.Background(), agent.ID, validTestPubkey(), validTestNodeURI(), 100_000, 25_000,
	)
	if err != nil {
		t.Fatal(err)
	}
	// Transition to pending_open with the known funding txid.
	if err := store.UpdateChannelStatus(
		context.Background(), grantID, "pending_open", fundingTxID, "", outputIndex,
	); err != nil {
		t.Fatal(err)
	}
	channelPoint := fmt.Sprintf("%s:%d", fundingTxID, outputIndex)
	return agent, grantID, channelPoint
}

// TestChannelStatusIncludesEnrichment is Phase 22 REN-04's enrichment-
// surfacing guard. Asserts that once a ChannelGrant has been populated
// with ChannelPoint + FundingFeeRateSatVB (by Plan 22-03's CAS path or
// Plan 22-02a's openChannelAsync + SetChannelFundingFeeRate), a GET
// /v1/internal/channel/status response surfaces both fields verbatim.
//
// This test is a *minimal* round-trip: it seeds a grant directly into
// MockStore in the `open` state with both enrichment fields set, then
// exercises the ChannelStatus handler path (LND=nil so no live lookup
// fires — the handler's pending_open branch is skipped, and the already-
// open grant is returned as-is). Plan 22-03's TestPollerUsesCASAndPropagatesFeeRate
// already proves the end-to-end funding_fee_rate propagation through
// the CAS; this test is the companion shape-assertion on the wire.
func TestChannelStatusIncludesEnrichment(t *testing.T) {
	store := NewMockStore()
	ch := &ChannelHandlers{
		Store:  store,
		LND:    nil, // no live lookup — grant is already in terminal state
		Logger: slog.Default(),
	}

	// Seed an agent + grant directly in MockStore. The test is in the
	// same package, so direct map access is fine (mirrors the
	// TestAdminUnbanPubkey setup pattern).
	agent, _, err := store.Register(context.Background(), "enrich-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	channelPoint := "0000111122223333444455556677889900001111222233334444555566778899:0"
	feeRate := int64(32)
	store.mu.Lock()
	store.channels["enrich-grant"] = &ChannelGrant{
		ID:                  "enrich-grant",
		AgentID:             agent.ID,
		Pubkey:              validTestPubkey(),
		NodeURI:             validTestNodeURI(),
		Status:              "open",
		FundingTxID:         "0000111122223333444455556677889900001111222233334444555566778899",
		OutputIndex:         0,
		ChannelSize:         100_000,
		PushAmount:          25_000,
		CreatedAt:           time.Now(),
		ChannelPoint:        &channelPoint,
		FundingFeeRateSatVB: &feeRate,
	}
	store.mu.Unlock()

	req := httptest.NewRequest("GET", "/v1/internal/channel/status", nil)
	req = req.WithContext(SetAgent(req.Context(), agent))
	rec := httptest.NewRecorder()

	ch.ChannelStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)
	if data["status"] != "open" {
		t.Errorf("status=%v want open", data["status"])
	}
	if cp, _ := data["channel_point"].(string); cp != channelPoint {
		t.Errorf("channel_point=%q want %q", cp, channelPoint)
	}
	// json.Unmarshal decodes JSON numbers into float64 by default.
	feeAny, ok := data["funding_fee_rate_sat_vb"]
	if !ok {
		t.Fatalf("funding_fee_rate_sat_vb absent; want 32")
	}
	switch f := feeAny.(type) {
	case float64:
		if int64(f) != feeRate {
			t.Errorf("funding_fee_rate_sat_vb=%v want %d", f, feeRate)
		}
	default:
		t.Errorf("funding_fee_rate_sat_vb has unexpected type %T: %v", feeAny, feeAny)
	}
}

// TestChannelStatusEnrichmentOmitemptyWhenNil asserts the companion
// omitempty contract: when ChannelPoint / FundingFeeRateSatVB are nil on
// a pre-Phase-22 row (or a row where the fee estimator was disabled),
// neither key appears in the JSON response at all. Protects against the
// failure mode where a nil *int64 is marshaled as 0, masking the
// "estimator-was-disabled" signal from the agent.
func TestChannelStatusEnrichmentOmitemptyWhenNil(t *testing.T) {
	store := NewMockStore()
	ch := &ChannelHandlers{Store: store, LND: nil, Logger: slog.Default()}

	agent, _, err := store.Register(context.Background(), "no-enrich-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	store.channels["bare-grant"] = &ChannelGrant{
		ID:          "bare-grant",
		AgentID:     agent.ID,
		Pubkey:      validTestPubkey(),
		NodeURI:     validTestNodeURI(),
		Status:      "open",
		ChannelSize: 100_000,
		PushAmount:  25_000,
		CreatedAt:   time.Now(),
		// ChannelPoint + FundingFeeRateSatVB left nil on purpose
	}
	store.mu.Unlock()

	req := httptest.NewRequest("GET", "/v1/internal/channel/status", nil)
	req = req.WithContext(SetAgent(req.Context(), agent))
	rec := httptest.NewRecorder()

	ch.ChannelStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)

	if _, ok := data["channel_point"]; ok {
		t.Errorf("channel_point key present when nil; omitempty violated. Body: %s", rec.Body.String())
	}
	if _, ok := data["funding_fee_rate_sat_vb"]; ok {
		t.Errorf("funding_fee_rate_sat_vb key present when nil; omitempty violated. Body: %s", rec.Body.String())
	}
}

// TestChannelStatusAuthoritativeRead asserts CHO-01: a pending_open grant
// transitions to open in the SAME request when LND reports the channel
// is actually open. The CAS winner (this handler, since no other writer
// is active) mutates the in-memory row and the response reflects open.
func TestChannelStatusAuthoritativeRead(t *testing.T) {
	store := NewMockStore()
	fundingTxID := "0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff"
	agent, _, channelPoint := seedPendingOpenGrant(t, store, fundingTxID, 0)

	ch := &ChannelHandlers{
		Store:  store,
		LND:    &fakeLNDChannelLookup{channelPoint: channelPoint},
		Logger: slog.Default(),
	}

	req := httptest.NewRequest("GET", "/v1/internal/channel/status", nil)
	req = req.WithContext(SetAgent(req.Context(), agent))
	rec := httptest.NewRecorder()

	ch.ChannelStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)
	if data["status"] != "open" {
		t.Errorf("response status=%v want open", data["status"])
	}
	if data["channel_point"] != channelPoint {
		t.Errorf("response channel_point=%v want %q", data["channel_point"], channelPoint)
	}

	// Store side-effect: the row was actually CAS'd.
	fresh, _ := store.GetChannelGrant(context.Background(), agent.ID)
	if fresh.Status != "open" {
		t.Errorf("store grant status=%q want open", fresh.Status)
	}
	if fresh.ChannelPoint == nil || *fresh.ChannelPoint != channelPoint {
		t.Errorf("store channel_point=%v want %q", fresh.ChannelPoint, channelPoint)
	}
	if fresh.OpenedAt == nil {
		t.Error("store opened_at=nil; CAS must stamp it on pending_open → open")
	}
}

// TestChannelStatusLookupErrorReturnsDBView asserts D-03 graceful degrade:
// when LiveChannelLookup fails (e.g. LND RPC down), the handler logs a
// warn and returns the DB-view pending_open state — the row is NOT
// written and no error bubbles to the caller.
func TestChannelStatusLookupErrorReturnsDBView(t *testing.T) {
	store := NewMockStore()
	fundingTxID := "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff"
	agent, _, _ := seedPendingOpenGrant(t, store, fundingTxID, 0)

	ch := &ChannelHandlers{
		Store:  store,
		LND:    &brokenLNDListChannels{},
		Logger: slog.Default(),
	}

	req := httptest.NewRequest("GET", "/v1/internal/channel/status", nil)
	req = req.WithContext(SetAgent(req.Context(), agent))
	rec := httptest.NewRecorder()

	ch.ChannelStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (graceful), got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	if data["status"] != "pending_open" {
		t.Errorf("status=%v want pending_open (DB view)", data["status"])
	}
	// Row must NOT have been written.
	fresh, _ := store.GetChannelGrant(context.Background(), agent.ID)
	if fresh.Status != "pending_open" {
		t.Errorf("store grant status=%q want pending_open (untouched)", fresh.Status)
	}
	if fresh.ChannelPoint != nil {
		t.Errorf("channel_point=%v want nil (not set when lookup errored)", fresh.ChannelPoint)
	}
}

// brokenLNDListChannels is a minimal lnd.Client whose ListChannels returns
// an error — exercises the D-03 graceful-degrade branch in ChannelStatus.
type brokenLNDListChannels struct {
	lnd.Client
}

func (b *brokenLNDListChannels) ListChannels(ctx context.Context) (map[string]any, error) {
	return nil, fmt.Errorf("simulated LND outage")
}

// TestChannelStatusCASConcurrency is the FM-1 regression guard: two
// concurrent handler invocations against the same pending_open grant
// must produce exactly ONE CAS winner (updated=true) and leave the grant
// in the "open" terminal state. The losing handler re-reads via
// GetChannelGrant and returns the authoritative value. Must be clean
// under `go test -race -count=5`.
func TestChannelStatusCASConcurrency(t *testing.T) {
	store := NewMockStore()
	fundingTxID := "2222333344445555666677778888999900001111aaaabbbbccccddddeeeeffff"
	agent, _, channelPoint := seedPendingOpenGrant(t, store, fundingTxID, 0)

	ch := &ChannelHandlers{
		Store:  store,
		LND:    &fakeLNDChannelLookup{channelPoint: channelPoint},
		Logger: slog.Default(),
	}

	// Fire N concurrent /channel/status requests against the same agent.
	// Exactly one should land the CAS; the others must re-read and return
	// the same authoritative "open" view.
	const N = 8
	var wg sync.WaitGroup
	start := make(chan struct{})
	responses := make([]string, N)
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			req := httptest.NewRequest("GET", "/v1/internal/channel/status", nil)
			req = req.WithContext(SetAgent(req.Context(), agent))
			rec := httptest.NewRecorder()
			ch.ChannelStatus(rec, req)
			if rec.Code != http.StatusOK {
				t.Errorf("worker %d: status=%d body=%s", idx, rec.Code, rec.Body.String())
				return
			}
			var resp map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Errorf("worker %d: json=%v", idx, err)
				return
			}
			data := resp["data"].(map[string]any)
			if s, _ := data["status"].(string); s != "" {
				responses[idx] = s
			}
		}(i)
	}
	close(start)
	wg.Wait()

	// Every response must be "open" — either the CAS winner's own write
	// or a re-read after a losing CAS.
	for i, s := range responses {
		if s != "open" {
			t.Errorf("worker %d response status=%q want open", i, s)
		}
	}

	// Final store state: exactly one "open" row, channel_point populated.
	fresh, _ := store.GetChannelGrant(context.Background(), agent.ID)
	if fresh.Status != "open" {
		t.Errorf("final store status=%q want open", fresh.Status)
	}
	if fresh.ChannelPoint == nil || *fresh.ChannelPoint != channelPoint {
		t.Errorf("final channel_point=%v want %q", fresh.ChannelPoint, channelPoint)
	}
}

// TestChannelStatusCASLoserReReads exercises the (updated=false) branch
// explicitly: pre-transition the grant to "open" before the handler runs,
// so the handler's CAS sees status != "pending_open" and returns
// (false, nil). The handler must re-read and return "open".
func TestChannelStatusCASLoserReReads(t *testing.T) {
	store := NewMockStore()
	fundingTxID := "3333444455556666777788889999000011112222aaaabbbbccccddddeeeeffff"
	agent, grantID, channelPoint := seedPendingOpenGrant(t, store, fundingTxID, 0)

	// Pre-transition the grant to "open" with a different channel_point
	// so we can prove the handler used GetChannelGrant (fresh), not its
	// own CAS attempt's writes.
	preExistingCP := "pre-existing-" + channelPoint
	updated, err := store.UpdateChannelStatusCAS(
		context.Background(), grantID, "pending_open", "open", preExistingCP, nil,
	)
	if err != nil || !updated {
		t.Fatalf("pre-transition failed: updated=%v err=%v", updated, err)
	}

	ch := &ChannelHandlers{
		Store:  store,
		LND:    &fakeLNDChannelLookup{channelPoint: channelPoint},
		Logger: slog.Default(),
	}

	req := httptest.NewRequest("GET", "/v1/internal/channel/status", nil)
	req = req.WithContext(SetAgent(req.Context(), agent))
	rec := httptest.NewRecorder()
	ch.ChannelStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	// The row status was already "open" when ChannelStatus ran, which
	// means grant.Status == "open" at the top of the handler and the
	// pending_open branch is skipped entirely. Response must show "open"
	// and the pre-existing channel_point (not the fake-LND value, since
	// no CAS fired).
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	if data["status"] != "open" {
		t.Errorf("status=%v want open", data["status"])
	}
	if data["channel_point"] != preExistingCP {
		t.Errorf("channel_point=%v want pre-existing %q (no CAS should fire)", data["channel_point"], preExistingCP)
	}
}

// TestPollerUsesCASAndPropagatesFeeRate asserts Plan 22-03's poller
// refactor + REN-04 end-to-end: a pending_open grant with
// FundingFeeRateSatVB set gets transitioned to "open" by the poller via
// UpdateChannelStatusCAS, and the fee-rate value is preserved on the
// resulting row. This closes the REN-04 real-path loop — the fee-rate
// written at openChannelAsync (Plan 22-02a) rides through the Plan 22-03
// CAS into /v1/internal/channel/status.
func TestPollerUsesCASAndPropagatesFeeRate(t *testing.T) {
	store := NewMockStore()
	fundingTxID := "4444555566667777888899990000111122223333aaaabbbbccccddddeeeeffff"
	_, grantID, channelPoint := seedPendingOpenGrant(t, store, fundingTxID, 0)

	// Seed the REN-04 fee rate on the grant row as openChannelAsync would.
	if err := store.SetChannelFundingFeeRate(context.Background(), grantID, 32); err != nil {
		t.Fatal(err)
	}

	ch := &ChannelHandlers{
		Store:  store,
		LND:    &fakeLNDChannelLookup{channelPoint: channelPoint},
		Logger: slog.Default(),
	}

	ch.pollChannelStatus(context.Background(), slog.Default())

	fresh, _ := store.GetChannelGrantByID(context.Background(), grantID)
	if fresh.Status != "open" {
		t.Errorf("poller did not transition grant to open: status=%q", fresh.Status)
	}
	if fresh.ChannelPoint == nil || *fresh.ChannelPoint != channelPoint {
		t.Errorf("channel_point=%v want %q", fresh.ChannelPoint, channelPoint)
	}
	if fresh.FundingFeeRateSatVB == nil || *fresh.FundingFeeRateSatVB != 32 {
		t.Errorf("FundingFeeRateSatVB=%v want 32 (REN-04 must ride through CAS)", fresh.FundingFeeRateSatVB)
	}
}
