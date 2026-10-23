package accounts

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Phase 21 (Agent A, 2026-04-22): time-limited ban tests.
//
// Covers:
//   (a) BanPubkeyUntil with a future time sets banned_until, does NOT set banned=TRUE.
//   (b) ReserveChannelSlot refuses while banned_until > now.
//   (c) ReserveChannelSlot permits after banned_until has passed.
//   (d) Permanent ban (banned=TRUE) still wins even when banned_until is nil.
//   (e) AdminBanPubkeyUntil accepts both Bearer and X-Admin-Token auth.
//   (f) parseBanDuration accepts "1h", "24h", "7d", "permanent"; rejects garbage.

// seedGrantForPubkey creates a minimal grant row so BanPubkeyUntil's
// UPDATE has a row to hit. Mirrors the real-world invariant that a
// pubkey has at least one grant in the table before it can be banned.
func seedGrantForPubkey(store *MockStore, agentID, pubkey string) string {
	store.mu.Lock()
	defer store.mu.Unlock()
	id := "seed-" + pubkey
	store.channels[id] = &ChannelGrant{
		ID:      id,
		AgentID: agentID,
		Pubkey:  pubkey,
		Status:  "failed",
	}
	return id
}

// (a) Time-ban sets BannedUntil, does NOT set Banned=true.
func TestBanPubkeyUntilSetsBannedUntilOnly(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()
	agent, _, _ := store.Register(ctx, "ban-agent-a", "127.0.0.1")
	pk := "02aabbccddee00112233445566778899aabbccddee00112233445566778899aabb"
	seedGrantForPubkey(store, agent.ID, pk)

	until := time.Now().Add(1 * time.Hour)
	if err := store.BanPubkeyUntil(ctx, pk, &until); err != nil {
		t.Fatalf("BanPubkeyUntil: %v", err)
	}

	// Phase 21.1: ban now stored in pubkeyBans map, not on grant rows.
	store.mu.RLock()
	defer store.mu.RUnlock()
	pb, ok := store.pubkeyBans[pk]
	if !ok {
		t.Fatalf("time-ban must upsert into pubkey_bans; no entry for %s", pk)
	}
	if pb.permanent {
		t.Errorf("time-ban must not set permanent=true; got permanent=true")
	}
	if pb.bannedUntil == nil {
		t.Errorf("time-ban must set banned_until; got nil")
	}
}

// (b) ReserveChannelSlot refuses while banned_until > now.
func TestReserveRefusesWhileTimeBannedActive(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()
	agent, _, _ := store.Register(ctx, "ban-agent-b", "127.0.0.1")
	pk := "03aabbccddee00112233445566778899aabbccddee00112233445566778899aabb"
	seedGrantForPubkey(store, agent.ID, pk)

	until := time.Now().Add(1 * time.Hour)
	if err := store.BanPubkeyUntil(ctx, pk, &until); err != nil {
		t.Fatalf("BanPubkeyUntil: %v", err)
	}

	_, err := store.ReserveChannelSlot(ctx, agent.ID, pk, pk+"@1.2.3.4:9735", 100_000, 25_000)
	if err != ErrPubkeyBanned {
		t.Fatalf("expected ErrPubkeyBanned while time-ban active; got %v", err)
	}
}

// (c) ReserveChannelSlot permits after banned_until has passed.
func TestReservePermittedAfterTimeBanExpires(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()
	agent, _, _ := store.Register(ctx, "ban-agent-c", "127.0.0.1")
	pk := "02112233445566778899aabbccddee00112233445566778899aabbccddee001122"
	seedGrantForPubkey(store, agent.ID, pk)

	// Set a ban 10ms in the future so the test doesn't need to sleep for long.
	until := time.Now().Add(10 * time.Millisecond)
	if err := store.BanPubkeyUntil(ctx, pk, &until); err != nil {
		t.Fatalf("BanPubkeyUntil: %v", err)
	}

	// While ban is active, reserve must fail.
	_, err := store.ReserveChannelSlot(ctx, agent.ID, pk, pk+"@1.2.3.4:9735", 100_000, 25_000)
	if err != ErrPubkeyBanned {
		t.Fatalf("expected ErrPubkeyBanned during active ban; got %v", err)
	}

	// Wait past the expiry.
	time.Sleep(30 * time.Millisecond)

	// After expiry, reserve must succeed.
	if _, err := store.ReserveChannelSlot(ctx, agent.ID, pk, pk+"@1.2.3.4:9735", 100_000, 25_000); err != nil {
		t.Fatalf("expected reserve to succeed after ban expiry; got %v", err)
	}
}

// (d) Permanent ban (Banned=true) still wins even when BannedUntil is nil.
func TestPermanentBanStillBlocksWhenBannedUntilNil(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()
	agent, _, _ := store.Register(ctx, "ban-agent-d", "127.0.0.1")
	pk := "03112233445566778899aabbccddee00112233445566778899aabbccddee001122"
	seedGrantForPubkey(store, agent.ID, pk)

	// Permanent ban via until=nil.
	if err := store.BanPubkeyUntil(ctx, pk, nil); err != nil {
		t.Fatalf("BanPubkeyUntil permanent: %v", err)
	}

	// Phase 21.1: permanent bans live in pubkeyBans as {permanent=true, bannedUntil=nil}
	store.mu.RLock()
	pb, ok := store.pubkeyBans[pk]
	store.mu.RUnlock()
	if !ok {
		t.Fatalf("permanent ban must upsert into pubkey_bans; no entry for %s", pk)
	}
	if !pb.permanent {
		t.Errorf("permanent ban must set permanent=true; got false")
	}
	if pb.bannedUntil != nil {
		t.Errorf("permanent ban must NOT set bannedUntil; got %v", pb.bannedUntil)
	}

	// Reserve must be rejected.
	_, err := store.ReserveChannelSlot(ctx, agent.ID, pk, pk+"@1.2.3.4:9735", 100_000, 25_000)
	if err != ErrPubkeyBanned {
		t.Fatalf("expected ErrPubkeyBanned for permanent ban; got %v", err)
	}
}

// Phase 21.1 regression (2026-04-22): banning a pubkey with NO existing
// grants must still persist and block a subsequent /register call. The
// original BanPubkeyUntil UPDATEd faucet_channels rows, which silently
// no-opped on net-new pubkeys — the gateway returned 200 but no ban
// was ever stored. pubkey_bans table now carries preemptive bans.
func TestBanPubkeyUntilWorksForNetNewPubkey(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()
	// Deliberately do NOT seed a grant for this pubkey.
	pk := "0299999999999999999999999999999999999999999999999999999999999999ff"

	until := time.Now().Add(2 * time.Hour)
	if err := store.BanPubkeyUntil(ctx, pk, &until); err != nil {
		t.Fatalf("BanPubkeyUntil on net-new pubkey: %v", err)
	}

	// Ban entry must exist in pubkey_bans.
	store.mu.RLock()
	pb, ok := store.pubkeyBans[pk]
	store.mu.RUnlock()
	if !ok {
		t.Fatalf("net-new pubkey ban must persist in pubkey_bans; no entry for %s", pk)
	}
	if pb.bannedUntil == nil || !pb.bannedUntil.After(time.Now()) {
		t.Errorf("bannedUntil should be future timestamp; got %v", pb.bannedUntil)
	}

	// First-ever /register attempt with this pubkey must be blocked by
	// the preemptive ban (this is the regression guard).
	agent, _, _ := store.Register(ctx, "fresh-agent", "127.0.0.1")
	_, err := store.ReserveChannelSlot(ctx, agent.ID, pk, pk+"@1.2.3.4:9735", 20_000, 1_354)
	if err != ErrPubkeyBanned {
		t.Fatalf("ReserveChannelSlot must block preemptively-banned net-new pubkey; got %v", err)
	}

	// ClearPubkeyBan must also clear the preemptive entry.
	if err := store.ClearPubkeyBan(ctx, pk); err != nil {
		t.Fatalf("ClearPubkeyBan: %v", err)
	}
	store.mu.RLock()
	_, stillBanned := store.pubkeyBans[pk]
	store.mu.RUnlock()
	if stillBanned {
		t.Errorf("ClearPubkeyBan must delete pubkey_bans entry; entry still present")
	}
	// After clearing, reserve succeeds.
	if _, err := store.ReserveChannelSlot(ctx, agent.ID, pk, pk+"@1.2.3.4:9735", 20_000, 1_354); err != nil {
		t.Fatalf("ReserveChannelSlot after unban: %v", err)
	}
}

// (e1) AdminBanPubkeyUntil accepts Authorization: Bearer.
func TestAdminBanPubkeyUntilAcceptsBearer(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()
	agent, _, _ := store.Register(ctx, "ban-agent-e1", "127.0.0.1")
	pk := "02aa11bb22cc33dd44ee55ff66001122334455667788990011223344556677889a"
	seedGrantForPubkey(store, agent.ID, pk)

	ch := &ChannelHandlers{
		Store:      store,
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}

	body := bytes.NewBufferString(`{"pubkey":"` + pk + `","duration":"1h"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/channel/ban", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-admin-token")
	rec := httptest.NewRecorder()

	ch.AdminBanPubkeyUntil(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with Bearer; got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["ok"] != true {
		t.Errorf("expected ok=true; got %v", resp["ok"])
	}
	data := resp["data"].(map[string]any)
	if data["permanent"] != false {
		t.Errorf("expected permanent=false for 1h; got %v", data["permanent"])
	}
	if data["banned_until"] == nil {
		t.Errorf("expected banned_until RFC3339 string for 1h; got nil")
	}

	// Bearer must NOT emit a deprecation warning.
	if w := rec.Header().Get("Warning"); w != "" {
		t.Errorf("Bearer auth must not trigger deprecation warning; got %q", w)
	}
}

// (e2) AdminBanPubkeyUntil accepts X-Admin-Token (legacy) with deprecation warning.
func TestAdminBanPubkeyUntilAcceptsLegacyXAdminToken(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()
	agent, _, _ := store.Register(ctx, "ban-agent-e2", "127.0.0.1")
	pk := "03bb22cc33dd44ee55ff66001122334455667788990011223344556677889aabbc"
	seedGrantForPubkey(store, agent.ID, pk)

	ch := &ChannelHandlers{
		Store:      store,
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}

	body := bytes.NewBufferString(`{"pubkey":"` + pk + `","duration":"permanent"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/channel/ban", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Admin-Token", "test-admin-token")
	rec := httptest.NewRecorder()

	ch.AdminBanPubkeyUntil(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with X-Admin-Token; got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)
	if data["permanent"] != true {
		t.Errorf("expected permanent=true; got %v", data["permanent"])
	}
	if data["banned_until"] != nil {
		t.Errorf("expected banned_until=null for permanent; got %v", data["banned_until"])
	}

	// Legacy header must emit the deprecation Warning.
	if w := rec.Header().Get("Warning"); w == "" {
		t.Errorf("expected deprecation Warning for X-Admin-Token path; got empty")
	}
}

// (e3) AdminBanPubkeyUntil rejects when no auth provided.
func TestAdminBanPubkeyUntilRejectsNoAuth(t *testing.T) {
	store := NewMockStore()
	ch := &ChannelHandlers{
		Store:      store,
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}
	pk := "02cc33dd44ee55ff66001122334455667788990011223344556677889aabbccdde"
	body := bytes.NewBufferString(`{"pubkey":"` + pk + `","duration":"1h"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/channel/ban", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	ch.AdminBanPubkeyUntil(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when no auth header; got %d: %s", rec.Code, rec.Body.String())
	}
}

// (f) parseBanDuration.
func TestParseBanDurationAcceptsValidForms(t *testing.T) {
	cases := []struct {
		in            string
		wantPermanent bool
		wantDur       time.Duration
	}{
		{"1h", false, 1 * time.Hour},
		{"24h", false, 24 * time.Hour},
		{"7d", false, 7 * 24 * time.Hour},
		{"30m", false, 30 * time.Minute},
		{"permanent", true, 0},
		{"PERMANENT", true, 0}, // case-insensitive
	}
	for _, c := range cases {
		t.Run(c.in, func(t *testing.T) {
			d, perm, err := parseBanDuration(c.in)
			if err != nil {
				t.Fatalf("parseBanDuration(%q) err=%v", c.in, err)
			}
			if perm != c.wantPermanent {
				t.Errorf("permanent: got %v want %v", perm, c.wantPermanent)
			}
			if d != c.wantDur {
				t.Errorf("duration: got %v want %v", d, c.wantDur)
			}
		})
	}
}

func TestParseBanDurationRejectsGarbage(t *testing.T) {
	garbage := []string{
		"",
		"garbage",
		"-1h",
		"0h",
		"0d",
		"-7d",
		"forever",
		"1x",
	}
	for _, g := range garbage {
		t.Run("reject/"+g, func(t *testing.T) {
			_, _, err := parseBanDuration(g)
			if err == nil {
				t.Errorf("parseBanDuration(%q) must reject; got nil err", g)
			}
		})
	}
}

// AdminBanPubkeyUntil end-to-end: bad duration → 400.
func TestAdminBanPubkeyUntilRejectsBadDuration(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()
	agent, _, _ := store.Register(ctx, "ban-agent-bad-dur", "127.0.0.1")
	pk := "02dd44ee55ff66001122334455667788990011223344556677889aabbccddeeff0"
	seedGrantForPubkey(store, agent.ID, pk)

	ch := &ChannelHandlers{
		Store:      store,
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}

	body := bytes.NewBufferString(`{"pubkey":"` + pk + `","duration":"garbage"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/channel/ban", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-admin-token")
	rec := httptest.NewRecorder()

	ch.AdminBanPubkeyUntil(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for bad duration; got %d: %s", rec.Code, rec.Body.String())
	}
}

// AdminBanPubkeyUntil end-to-end: invalid pubkey → 400.
func TestAdminBanPubkeyUntilRejectsInvalidPubkey(t *testing.T) {
	store := NewMockStore()
	ch := &ChannelHandlers{
		Store:      store,
		AdminToken: "test-admin-token",
		Logger:     slog.Default(),
	}
	body := bytes.NewBufferString(`{"pubkey":"not-a-pubkey","duration":"1h"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/channel/ban", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-admin-token")
	rec := httptest.NewRecorder()

	ch.AdminBanPubkeyUntil(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid pubkey; got %d: %s", rec.Code, rec.Body.String())
	}
}
