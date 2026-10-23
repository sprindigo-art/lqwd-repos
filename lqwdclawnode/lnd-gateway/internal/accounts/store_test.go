package accounts

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestGenerateAPIKeyPrefix(t *testing.T) {
	key, err := generateAPIKey()
	if err != nil {
		t.Fatalf("generateAPIKey: %v", err)
	}
	if len(key) != 48 {
		t.Errorf("expected key length 48, got %d", len(key))
	}
	if key[:5] != "lqwd_" {
		t.Errorf("expected key to start with lqwd_, got %s", key[:5])
	}
	// Verify all chars after prefix are base62
	for i, c := range key[5:] {
		if !((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
			t.Errorf("non-base62 char at position %d: %c", i+5, c)
		}
	}
}

func TestGenerateAPIKeyUniqueness(t *testing.T) {
	key1, err := generateAPIKey()
	if err != nil {
		t.Fatalf("generateAPIKey 1: %v", err)
	}
	key2, err := generateAPIKey()
	if err != nil {
		t.Fatalf("generateAPIKey 2: %v", err)
	}
	if key1 == key2 {
		t.Error("expected different keys on successive calls")
	}
}

func TestSha256Hex(t *testing.T) {
	got := sha256Hex("test")
	want := "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
	if got != want {
		t.Errorf("sha256Hex(\"test\") = %s, want %s", got, want)
	}
}

func TestNewPGStoreInvalidURL(t *testing.T) {
	_, err := NewPGStore(t.Context(), "not-a-valid-url", DefaultFaucetDailyCap, 100)
	if err == nil {
		t.Fatal("expected error for invalid DATABASE_URL, got nil")
	}
}

// TestSchemaMigrationIdempotent is the Phase 22 REN-03 idempotence guard.
//
// REN-03 ownership note: the `funding_fee_rate_sat_vb` DDL shipped in
// Plan 22-02a and `channel_point` shipped in Plan 22-03 — both via
// idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` clauses in the
// schema-migration constant (see store.go lines 85-108). This test is
// informational for Plan 22-06: a failure here would indicate a Plan
// 22-02a or Plan 22-03 regression, not a Plan 22-06 gap.
//
// Why skip: the accounts package has no Postgres test harness (no
// dockertest, no TestMain, no environment-driven connection). The
// idempotence property is guaranteed by Postgres's `ADD COLUMN IF NOT
// EXISTS` semantics — a schema-only SQL feature we do not override in
// our migration runner (PGStore.NewPGStore just pool.Exec's the constant
// once at boot, see store.go:162). The identical idempotent pattern has
// been exercised in production for Phase 21's `banned_until` column
// (store.go:85) across multiple gateway restarts since 2026-04-22 with
// no errors. Post-deploy manual verification: restart the gateway and
// confirm the logs show no "run schema migration" error on second boot.
//
// If a Postgres test harness is added to this package in the future,
// replace the Skip with:
//
//	pool := setupTestPG(t)
//	if _, err := pool.Exec(ctx, schemaMigration); err != nil { t.Fatal(err) }
//	if _, err := pool.Exec(ctx, schemaMigration); err != nil { t.Fatalf("second run: %v", err) }
//	// then verify columns exist via information_schema.columns
//
// Static sanity check (harness-free): confirm the two REN-owned columns
// both use the idempotent `ADD COLUMN IF NOT EXISTS` form in the
// migration constant. This catches the only failure mode a Plan 22-06
// regression could introduce — a future edit switching to a
// non-idempotent form (plain `ADD COLUMN`) would break restart safety.
func TestSchemaMigrationIdempotent(t *testing.T) {
	// Static sanity: the two Phase 22 columns use idempotent DDL.
	// Full Postgres-round-trip idempotence verified manually post-deploy.
	required := []string{
		"ADD COLUMN IF NOT EXISTS funding_fee_rate_sat_vb",
		"ADD COLUMN IF NOT EXISTS channel_point",
	}
	for _, frag := range required {
		if !strings.Contains(schemaMigration, frag) {
			t.Errorf("schemaMigration missing idempotent DDL fragment %q — REN-03 regression", frag)
		}
	}
	t.Skip("REN-03 round-trip idempotence relies on Postgres ALTER TABLE ... ADD COLUMN IF NOT EXISTS semantics; asserted manually post-deploy (restart gateway twice, confirm no 'run schema migration' error on second boot). No Postgres test harness in this package — static fragment check above guards against accidental switch to non-idempotent DDL.")
}

func TestRegister(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, rawKey, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if agent.ID == "" {
		t.Error("expected non-empty agent ID")
	}
	if agent.Name != "agent1" {
		t.Errorf("expected name agent1, got %s", agent.Name)
	}
	if len(rawKey) != 48 || rawKey[:5] != "lqwd_" {
		t.Errorf("expected raw key with lqwd_ prefix and length 48, got len=%d prefix=%s", len(rawKey), rawKey[:5])
	}
	if agent.Tier != 1 {
		t.Errorf("expected tier 1, got %d", agent.Tier)
	}
	if agent.Status != "active" {
		t.Errorf("expected status active, got %s", agent.Status)
	}
}

func TestRegisterAtomicCredit(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	profile, err := store.Profile(ctx, agent.ID)
	if err != nil {
		t.Fatalf("Profile: %v", err)
	}
	if profile.BalanceSats != 150 {
		t.Errorf("expected balance 150, got %d", profile.BalanceSats)
	}
}

func TestRegistrationRateLimit(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	// Register 3 agents from same IP
	for i := 0; i < 3; i++ {
		_, _, err := store.Register(ctx, "agent", "1.2.3.4")
		if err != nil {
			t.Fatalf("Register %d: %v", i+1, err)
		}
	}

	// 4th should be blocked by rate limit check
	allowed, err := store.CheckRegistrationLimit(ctx, "1.2.3.4")
	if err != nil {
		t.Fatalf("CheckRegistrationLimit: %v", err)
	}
	if allowed {
		t.Error("expected rate limit to block 4th registration from same IP")
	}

	// Different IP should still be allowed
	allowed, err = store.CheckRegistrationLimit(ctx, "5.6.7.8")
	if err != nil {
		t.Fatalf("CheckRegistrationLimit: %v", err)
	}
	if !allowed {
		t.Error("expected different IP to be allowed")
	}
}

func TestAuthenticate(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	_, rawKey, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	keyHash := sha256Hex(rawKey)
	agent, err := store.Authenticate(ctx, keyHash)
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if agent == nil {
		t.Fatal("expected agent, got nil")
	}
	if agent.Name != "agent1" {
		t.Errorf("expected name agent1, got %s", agent.Name)
	}
}

func TestAuthenticateInvalidKey(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, err := store.Authenticate(ctx, "nonexistent-hash")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if agent != nil {
		t.Error("expected nil for invalid key hash")
	}
}

func TestAuthenticateSuspended(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, rawKey, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Manually suspend the agent
	store.mu.Lock()
	store.agents[agent.ID].Status = "suspended"
	store.mu.Unlock()

	keyHash := sha256Hex(rawKey)
	result, err := store.Authenticate(ctx, keyHash)
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if result == nil {
		t.Fatal("expected agent returned even when suspended (middleware handles status)")
	}
	if result.Status != "suspended" {
		t.Errorf("expected status=suspended, got %s", result.Status)
	}
}

func TestProfile(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	profile, err := store.Profile(ctx, agent.ID)
	if err != nil {
		t.Fatalf("Profile: %v", err)
	}
	if profile == nil {
		t.Fatal("expected profile, got nil")
	}
	if profile.Name != "agent1" {
		t.Errorf("expected name agent1, got %s", profile.Name)
	}
	if profile.Tier != 1 {
		t.Errorf("expected tier 1, got %d", profile.Tier)
	}
	if profile.Status != "active" {
		t.Errorf("expected status active, got %s", profile.Status)
	}
	if profile.BalanceSats != 150 {
		t.Errorf("expected balance 150, got %d", profile.BalanceSats)
	}
	if profile.CreatedAt.IsZero() {
		t.Error("expected non-zero CreatedAt")
	}
}

func TestRotateKey(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, oldRawKey, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	oldHash := sha256Hex(oldRawKey)
	newRawKey, err := store.RotateKey(ctx, agent.ID, oldHash)
	if err != nil {
		t.Fatalf("RotateKey: %v", err)
	}
	if newRawKey == oldRawKey {
		t.Error("expected new key to differ from old key")
	}
	if len(newRawKey) != 48 || newRawKey[:5] != "lqwd_" {
		t.Errorf("new key format invalid: len=%d prefix=%s", len(newRawKey), newRawKey[:5])
	}

	// Old key should fail auth
	oldAgent, err := store.Authenticate(ctx, oldHash)
	if err != nil {
		t.Fatalf("Authenticate old: %v", err)
	}
	if oldAgent != nil {
		t.Error("expected nil for old key hash after rotation")
	}

	// New key should succeed
	newHash := sha256Hex(newRawKey)
	newAgent, err := store.Authenticate(ctx, newHash)
	if err != nil {
		t.Fatalf("Authenticate new: %v", err)
	}
	if newAgent == nil {
		t.Fatal("expected agent for new key hash")
	}
	if newAgent.ID != agent.ID {
		t.Errorf("expected same agent ID, got %s", newAgent.ID)
	}
}

func TestProfileBalanceBreakdown(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	profile, err := store.Profile(ctx, agent.ID)
	if err != nil {
		t.Fatalf("Profile: %v", err)
	}
	if profile.SettledSats != 150 {
		t.Errorf("expected SettledSats=150, got %d", profile.SettledSats)
	}
	if profile.ReservedSats != 0 {
		t.Errorf("expected ReservedSats=0, got %d", profile.ReservedSats)
	}
	if profile.AvailableSats != 150 {
		t.Errorf("expected AvailableSats=150, got %d", profile.AvailableSats)
	}
	if profile.BalanceSats != 150 {
		t.Errorf("expected BalanceSats=150 (backward compat), got %d", profile.BalanceSats)
	}
	if profile.DailySpendRemain != Tier1DailySpendCap {
		t.Errorf("expected DailySpendRemain=%d, got %d", Tier1DailySpendCap, profile.DailySpendRemain)
	}
}

func TestClaimTier2HappyPath(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Set CreatedAt to 2 hours ago
	store.mu.Lock()
	store.agents[agent.ID].CreatedAt = time.Now().Add(-2 * time.Hour)
	store.mu.Unlock()

	result, err := store.ClaimTier2(ctx, agent.ID, "agent1")
	if err != nil {
		t.Fatalf("ClaimTier2: %v", err)
	}
	if result.AlreadyClaimed {
		t.Error("expected AlreadyClaimed=false")
	}
	if result.GrantSats != 500 {
		t.Errorf("expected GrantSats=500, got %d", result.GrantSats)
	}
	if result.NewTier != 2 {
		t.Errorf("expected NewTier=2, got %d", result.NewTier)
	}

	// Verify balance includes both grants
	profile, err := store.Profile(ctx, agent.ID)
	if err != nil {
		t.Fatalf("Profile: %v", err)
	}
	if profile.AvailableSats != 650 {
		t.Errorf("expected AvailableSats=650, got %d", profile.AvailableSats)
	}
}

func TestClaimTier2TooYoung(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	_, err = store.ClaimTier2(ctx, agent.ID, "agent1")
	if err != ErrTooYoung {
		t.Errorf("expected ErrTooYoung, got %v", err)
	}
}

func TestClaimTier2NameMismatch(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	store.mu.Lock()
	store.agents[agent.ID].CreatedAt = time.Now().Add(-2 * time.Hour)
	store.mu.Unlock()

	_, err = store.ClaimTier2(ctx, agent.ID, "wrong-name")
	if err != ErrNameMismatch {
		t.Errorf("expected ErrNameMismatch, got %v", err)
	}
}

func TestClaimTier2AlreadyClaimed(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	store.mu.Lock()
	store.agents[agent.ID].CreatedAt = time.Now().Add(-2 * time.Hour)
	store.mu.Unlock()

	_, err = store.ClaimTier2(ctx, agent.ID, "agent1")
	if err != nil {
		t.Fatalf("ClaimTier2 first: %v", err)
	}

	result, err := store.ClaimTier2(ctx, agent.ID, "agent1")
	if err != nil {
		t.Fatalf("ClaimTier2 second: %v", err)
	}
	if !result.AlreadyClaimed {
		t.Error("expected AlreadyClaimed=true on second call")
	}
}

func TestTransactionsEmpty(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	entries, cursor, err := store.Transactions(ctx, agent.ID, "", 10)
	if err != nil {
		t.Fatalf("Transactions: %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("expected 1 entry (registration grant), got %d", len(entries))
	}
	if cursor != "" {
		t.Errorf("expected empty cursor, got %s", cursor)
	}
	if entries[0].TxType != "faucet_grant" {
		t.Errorf("expected tx_type=faucet_grant, got %s", entries[0].TxType)
	}
}

func TestTransactionsPagination(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Add more credit entries with distinct timestamps
	store.mu.Lock()
	for i := 0; i < 4; i++ {
		store.credits[agent.ID] = append(store.credits[agent.ID], creditEntry{
			ID:          fmt.Sprintf("tx-%d", i),
			AmountSats:  int64(10 + i),
			TxType:      "debit",
			Description: fmt.Sprintf("test debit %d", i),
			Status:      "settled",
			CreatedAt:   time.Now().Add(time.Duration(i+1) * time.Second),
		})
	}
	store.mu.Unlock()

	// First page: limit=2
	entries, cursor, err := store.Transactions(ctx, agent.ID, "", 2)
	if err != nil {
		t.Fatalf("Transactions page 1: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries on page 1, got %d", len(entries))
	}
	if cursor == "" {
		t.Fatal("expected non-empty cursor for page 2")
	}

	// Second page
	entries2, cursor2, err := store.Transactions(ctx, agent.ID, cursor, 2)
	if err != nil {
		t.Fatalf("Transactions page 2: %v", err)
	}
	if len(entries2) != 2 {
		t.Fatalf("expected 2 entries on page 2, got %d", len(entries2))
	}
	// Should be different from first page
	if entries2[0].ID == entries[0].ID {
		t.Error("page 2 should have different entries than page 1")
	}

	// Third page: should have 1 remaining
	entries3, cursor3, err := store.Transactions(ctx, agent.ID, cursor2, 2)
	if err != nil {
		t.Fatalf("Transactions page 3: %v", err)
	}
	if len(entries3) != 1 {
		t.Errorf("expected 1 entry on page 3, got %d", len(entries3))
	}
	if cursor3 != "" {
		t.Errorf("expected empty cursor on last page, got %s", cursor3)
	}
}

func TestDailySpendRemaining(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	remaining, err := store.DailySpendRemaining(ctx, agent.ID, 1)
	if err != nil {
		t.Fatalf("DailySpendRemaining: %v", err)
	}
	if remaining != Tier1DailySpendCap {
		t.Errorf("expected %d with no debits, got %d", Tier1DailySpendCap, remaining)
	}

	// Add a debit
	store.mu.Lock()
	store.credits[agent.ID] = append(store.credits[agent.ID], creditEntry{
		ID:         "debit-1",
		AmountSats: -30,
		TxType:     "debit",
		Status:     "settled",
		CreatedAt:  time.Now(),
	})
	store.mu.Unlock()

	remaining, err = store.DailySpendRemaining(ctx, agent.ID, 1)
	if err != nil {
		t.Fatalf("DailySpendRemaining after debit: %v", err)
	}
	if remaining != 70 {
		t.Errorf("expected 70, got %d", remaining)
	}
}

func TestCheckFaucetCapUnder(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	// Register creates a 150 sat grant, cap is 10000
	_, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	ok, err := store.CheckFaucetCap(ctx, 500)
	if err != nil {
		t.Fatalf("CheckFaucetCap: %v", err)
	}
	if !ok {
		t.Error("expected grant to be within cap")
	}
}

func TestCheckFaucetCapOver(t *testing.T) {
	store := NewMockStore()
	store.FaucetDailyCapSats = 200
	ctx := context.Background()

	_, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// 150 already granted + 100 = 250 > 200 cap
	ok, err := store.CheckFaucetCap(ctx, 100)
	if err != nil {
		t.Fatalf("CheckFaucetCap: %v", err)
	}
	if ok {
		t.Error("expected grant to exceed cap")
	}
}

func TestRotateKeyConcurrentSafety(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Try rotation with wrong key hash (simulates concurrent rotation)
	_, err = store.RotateKey(ctx, agent.ID, "wrong-hash-value")
	if err == nil {
		t.Fatal("expected error for wrong currentKeyHash")
	}
}

// --- Phase 13 Proxy Tests ---

func TestReserveCredits(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	result, err := store.ReserveCredits(ctx, ReserveRequest{
		AgentID:        agent.ID,
		AmountSats:     10,
		IdempotencyKey: "key1",
		Endpoint:       "node-stats",
		RequestID:      "req-1",
	})
	if err != nil {
		t.Fatalf("ReserveCredits: %v", err)
	}
	if result.ReserveID == "" {
		t.Error("expected non-empty ReserveID")
	}
	if result.Cached != nil {
		t.Error("expected Cached to be nil on fresh reserve")
	}

	// Verify balance reduced
	profile, err := store.Profile(ctx, agent.ID)
	if err != nil {
		t.Fatalf("Profile: %v", err)
	}
	if profile.AvailableSats != 140 {
		t.Errorf("expected available=140 after 10 sat reserve, got %d", profile.AvailableSats)
	}
	if profile.ReservedSats != 10 {
		t.Errorf("expected reserved=10, got %d", profile.ReservedSats)
	}
}

func TestReserveCreditsInsufficientBalance(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	_, err = store.ReserveCredits(ctx, ReserveRequest{
		AgentID:        agent.ID,
		AmountSats:     200,
		IdempotencyKey: "key-big",
		Endpoint:       "node-stats",
	})
	if err != ErrInsufficientCredits {
		t.Errorf("expected ErrInsufficientCredits, got %v", err)
	}
}

func TestSettleReserve(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	result, err := store.ReserveCredits(ctx, ReserveRequest{
		AgentID:        agent.ID,
		AmountSats:     10,
		IdempotencyKey: "key-settle",
		Endpoint:       "node-stats",
	})
	if err != nil {
		t.Fatalf("ReserveCredits: %v", err)
	}

	err = store.SettleReserve(ctx, result.ReserveID, "key-settle", "node-stats", 200, `{"ok":true}`)
	if err != nil {
		t.Fatalf("SettleReserve: %v", err)
	}

	// Verify: reserve gone, debit present, balance is 140
	profile, err := store.Profile(ctx, agent.ID)
	if err != nil {
		t.Fatalf("Profile: %v", err)
	}
	if profile.ReservedSats != 0 {
		t.Errorf("expected reserved=0 after settle, got %d", profile.ReservedSats)
	}
	if profile.AvailableSats != 140 {
		t.Errorf("expected available=140 after settle, got %d", profile.AvailableSats)
	}

	// Verify debit entry exists
	entries, _, err := store.Transactions(ctx, agent.ID, "", 10)
	if err != nil {
		t.Fatalf("Transactions: %v", err)
	}
	hasDebit := false
	for _, e := range entries {
		if e.TxType == "debit" && e.AmountSats == -10 && e.Status == "settled" {
			hasDebit = true
		}
	}
	if !hasDebit {
		t.Error("expected settled debit entry with -10 sats")
	}
}

func TestRefundReserve(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	result, err := store.ReserveCredits(ctx, ReserveRequest{
		AgentID:        agent.ID,
		AmountSats:     10,
		IdempotencyKey: "key-refund",
		Endpoint:       "node-stats",
	})
	if err != nil {
		t.Fatalf("ReserveCredits: %v", err)
	}

	err = store.RefundReserve(ctx, result.ReserveID, "key-refund", "node-stats")
	if err != nil {
		t.Fatalf("RefundReserve: %v", err)
	}

	// Balance should be back to 150
	profile, err := store.Profile(ctx, agent.ID)
	if err != nil {
		t.Fatalf("Profile: %v", err)
	}
	if profile.AvailableSats != 150 {
		t.Errorf("expected available=150 after refund, got %d", profile.AvailableSats)
	}
	if profile.ReservedSats != 0 {
		t.Errorf("expected reserved=0 after refund, got %d", profile.ReservedSats)
	}

	// Should be able to re-reserve with same key (idempotency cleared)
	result2, err := store.ReserveCredits(ctx, ReserveRequest{
		AgentID:        agent.ID,
		AmountSats:     10,
		IdempotencyKey: "key-refund",
		Endpoint:       "node-stats",
	})
	if err != nil {
		t.Fatalf("ReserveCredits after refund: %v", err)
	}
	if result2.ReserveID == "" {
		t.Error("expected successful re-reserve after refund")
	}
}

func TestReserveIdempotencyHit(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Reserve and settle
	result, err := store.ReserveCredits(ctx, ReserveRequest{
		AgentID:        agent.ID,
		AmountSats:     10,
		IdempotencyKey: "key-idemp",
		Endpoint:       "node-stats",
	})
	if err != nil {
		t.Fatalf("ReserveCredits: %v", err)
	}
	err = store.SettleReserve(ctx, result.ReserveID, "key-idemp", "node-stats", 200, `{"ok":true}`)
	if err != nil {
		t.Fatalf("SettleReserve: %v", err)
	}

	// Same idempotency key should return cached response
	result2, err := store.ReserveCredits(ctx, ReserveRequest{
		AgentID:        agent.ID,
		AmountSats:     10,
		IdempotencyKey: "key-idemp",
		Endpoint:       "node-stats",
	})
	if err != nil {
		t.Fatalf("ReserveCredits idempotency: %v", err)
	}
	if result2.Cached == nil {
		t.Fatal("expected cached response on idempotency hit")
	}
	if result2.Cached.StatusCode != 200 {
		t.Errorf("expected cached status=200, got %d", result2.Cached.StatusCode)
	}
	if result2.Cached.ResponseBody != `{"ok":true}` {
		t.Errorf("expected cached body, got %s", result2.Cached.ResponseBody)
	}

	// Balance should NOT be deducted again
	profile, err := store.Profile(ctx, agent.ID)
	if err != nil {
		t.Fatalf("Profile: %v", err)
	}
	if profile.AvailableSats != 140 {
		t.Errorf("expected available=140 (no double debit), got %d", profile.AvailableSats)
	}
}

func TestCleanupOrphanedReserves(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	result, err := store.ReserveCredits(ctx, ReserveRequest{
		AgentID:        agent.ID,
		AmountSats:     10,
		IdempotencyKey: "key-orphan",
		Endpoint:       "node-stats",
	})
	if err != nil {
		t.Fatalf("ReserveCredits: %v", err)
	}

	// Backdate the reserve entry and idempotency record
	store.mu.Lock()
	twoMinAgo := time.Now().Add(-2 * time.Minute)
	for i, c := range store.credits[agent.ID] {
		if c.ID == result.ReserveID {
			store.credits[agent.ID][i].CreatedAt = twoMinAgo
		}
	}
	lookupKey := agent.ID + "|key-orphan|node-stats"
	if entry, ok := store.idempotency[lookupKey]; ok {
		entry.CreatedAt = twoMinAgo
		store.idempotency[lookupKey] = entry
	}
	store.mu.Unlock()

	count, err := store.CleanupOrphanedReserves(ctx, 1*time.Minute)
	if err != nil {
		t.Fatalf("CleanupOrphanedReserves: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 orphan cleaned up, got %d", count)
	}

	// Balance should be restored
	profile, err := store.Profile(ctx, agent.ID)
	if err != nil {
		t.Fatalf("Profile: %v", err)
	}
	if profile.AvailableSats != 150 {
		t.Errorf("expected available=150 after cleanup, got %d", profile.AvailableSats)
	}
}

// --- Phase 15 Admin Dashboard Tests ---

func TestListAgents_FilterAndPaginate(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	// Register 3 agents
	store.Register(ctx, "alice", "1.2.3.4")
	store.Register(ctx, "bob", "1.2.3.4")
	store.Register(ctx, "charlie", "1.2.3.4")

	// List all, default sort
	agents, total, err := store.ListAgents(ctx, "", "created_at", "desc", 0, 10)
	if err != nil {
		t.Fatalf("ListAgents: %v", err)
	}
	if total != 3 {
		t.Errorf("expected total=3, got %d", total)
	}
	if len(agents) != 3 {
		t.Errorf("expected 3 agents, got %d", len(agents))
	}

	// Search by name
	agents, total, err = store.ListAgents(ctx, "ali", "created_at", "desc", 0, 10)
	if err != nil {
		t.Fatalf("ListAgents search: %v", err)
	}
	if total != 1 {
		t.Errorf("expected total=1 for search 'ali', got %d", total)
	}
	if len(agents) != 1 || agents[0].Name != "alice" {
		t.Errorf("expected alice, got %v", agents)
	}

	// Paginate
	agents, total, err = store.ListAgents(ctx, "", "created_at", "desc", 0, 2)
	if err != nil {
		t.Fatalf("ListAgents paginate: %v", err)
	}
	if total != 3 {
		t.Errorf("expected total=3, got %d", total)
	}
	if len(agents) != 2 {
		t.Errorf("expected 2 agents on page, got %d", len(agents))
	}

	// Page 2
	agents2, _, err := store.ListAgents(ctx, "", "created_at", "desc", 2, 2)
	if err != nil {
		t.Fatalf("ListAgents page 2: %v", err)
	}
	if len(agents2) != 1 {
		t.Errorf("expected 1 agent on page 2, got %d", len(agents2))
	}
}

func TestAggregateMetrics(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	// Register 2 agents (creates faucet_grant entries)
	agent1, _, _ := store.Register(ctx, "agent1", "1.2.3.4")
	store.Register(ctx, "agent2", "1.2.3.4")

	// Add a debit
	store.mu.Lock()
	store.credits[agent1.ID] = append(store.credits[agent1.ID], creditEntry{
		ID:         "debit-1",
		AmountSats: -10,
		TxType:     "debit",
		Status:     "settled",
		CreatedAt:  time.Now(),
	})
	store.mu.Unlock()

	metrics, err := store.AggregateMetrics(ctx)
	if err != nil {
		t.Fatalf("AggregateMetrics: %v", err)
	}
	if metrics.TotalAgents != 2 {
		t.Errorf("expected TotalAgents=2, got %d", metrics.TotalAgents)
	}
	if metrics.TotalCreditsGranted != 300 { // 150 * 2
		t.Errorf("expected TotalCreditsGranted=300, got %d", metrics.TotalCreditsGranted)
	}
	if metrics.TotalL402Calls != 1 {
		t.Errorf("expected TotalL402Calls=1, got %d", metrics.TotalL402Calls)
	}
	if metrics.DailyFaucetSpend != 300 { // both registration grants are today
		t.Errorf("expected DailyFaucetSpend=300, got %d", metrics.DailyFaucetSpend)
	}
}

func TestGrantCredits(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, _ := store.Register(ctx, "agent1", "1.2.3.4")

	err := store.GrantCredits(ctx, agent.ID, 1000, "Tier 3 bonus")
	if err != nil {
		t.Fatalf("GrantCredits: %v", err)
	}

	// Verify balance includes grant
	profile, err := store.Profile(ctx, agent.ID)
	if err != nil {
		t.Fatalf("Profile: %v", err)
	}
	if profile.BalanceSats != 1150 { // 150 + 1000
		t.Errorf("expected balance=1150, got %d", profile.BalanceSats)
	}

	// Grant to non-existent agent should fail
	err = store.GrantCredits(ctx, "nonexistent", 100, "test")
	if err == nil {
		t.Error("expected error for non-existent agent")
	}
}

func TestSuspendAgent_And_Unsuspend(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, _ := store.Register(ctx, "agent1", "1.2.3.4")

	// Suspend
	err := store.SuspendAgent(ctx, agent.ID)
	if err != nil {
		t.Fatalf("SuspendAgent: %v", err)
	}

	store.mu.RLock()
	if store.agents[agent.ID].Status != "suspended" {
		t.Errorf("expected status=suspended, got %s", store.agents[agent.ID].Status)
	}
	if store.agents[agent.ID].SuspendedAt == nil {
		t.Error("expected non-nil SuspendedAt")
	}
	store.mu.RUnlock()

	// Suspend again should fail
	err = store.SuspendAgent(ctx, agent.ID)
	if err == nil {
		t.Error("expected error suspending already-suspended agent")
	}

	// Unsuspend
	err = store.UnsuspendAgent(ctx, agent.ID)
	if err != nil {
		t.Fatalf("UnsuspendAgent: %v", err)
	}

	store.mu.RLock()
	if store.agents[agent.ID].Status != "active" {
		t.Errorf("expected status=active, got %s", store.agents[agent.ID].Status)
	}
	if store.agents[agent.ID].SuspendedAt != nil {
		t.Error("expected nil SuspendedAt after unsuspend")
	}
	store.mu.RUnlock()

	// Unsuspend again should fail
	err = store.UnsuspendAgent(ctx, agent.ID)
	if err == nil {
		t.Error("expected error unsuspending already-active agent")
	}
}

func TestReserveCreditsSpendCapIntegration(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Verify spend cap works alongside reserve
	remaining, err := store.DailySpendRemaining(ctx, agent.ID, 1)
	if err != nil {
		t.Fatalf("DailySpendRemaining: %v", err)
	}
	if remaining != Tier1DailySpendCap {
		t.Errorf("expected spend cap=%d, got %d", Tier1DailySpendCap, remaining)
	}

	// Reserve and settle
	result, err := store.ReserveCredits(ctx, ReserveRequest{
		AgentID:        agent.ID,
		AmountSats:     10,
		IdempotencyKey: "key-cap",
		Endpoint:       "node-stats",
	})
	if err != nil {
		t.Fatalf("ReserveCredits: %v", err)
	}
	err = store.SettleReserve(ctx, result.ReserveID, "key-cap", "node-stats", 200, `{"ok":true}`)
	if err != nil {
		t.Fatalf("SettleReserve: %v", err)
	}

	// Debit should reduce daily spend
	remaining, err = store.DailySpendRemaining(ctx, agent.ID, 1)
	if err != nil {
		t.Fatalf("DailySpendRemaining after: %v", err)
	}
	if remaining != Tier1DailySpendCap-10 {
		t.Errorf("expected spend remaining=%d, got %d", Tier1DailySpendCap-10, remaining)
	}
}

// --- Phase 15.1 Dashboard Polish Tests ---

// testPubkey generates a valid 66-char hex pubkey with the given prefix byte repeated.
func testPubkey(prefix string) string {
	return prefix + strings.Repeat("a", 64)
}

// testPubkey2 generates a valid 66-char hex pubkey with prefix and 'b' fill.
func testPubkey2(prefix string) string {
	return prefix + strings.Repeat("b", 64)
}

// testPubkey3 generates a valid 66-char hex pubkey with prefix and 'c' fill.
func testPubkey3(prefix string) string {
	return prefix + strings.Repeat("c", 64)
}

func TestTimeSeriesMetrics_MockStore(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Add a debit entry
	store.mu.Lock()
	store.credits[agent.ID] = append(store.credits[agent.ID], creditEntry{
		ID:         "debit-ts-1",
		AmountSats: -5,
		TxType:     "debit",
		Status:     "settled",
		CreatedAt:  time.Now(),
	})
	store.mu.Unlock()

	points, err := store.TimeSeriesMetrics(ctx, 24)
	if err != nil {
		t.Fatalf("TimeSeriesMetrics: %v", err)
	}

	// Should have 25 points (24 hours + current hour)
	if len(points) != 25 {
		t.Fatalf("expected 25 time points, got %d", len(points))
	}

	// Verify sorted by bucket ASC
	for i := 1; i < len(points); i++ {
		if !points[i].Bucket.After(points[i-1].Bucket) {
			t.Errorf("buckets not sorted ASC: [%d]=%v >= [%d]=%v", i-1, points[i-1].Bucket, i, points[i].Bucket)
		}
	}

	// The current hour bucket should have the grant and debit
	currentBucket := points[len(points)-1]
	if currentBucket.CreditsGranted != 150 { // registration faucet_grant
		t.Errorf("expected CreditsGranted=150 in current bucket, got %d", currentBucket.CreditsGranted)
	}
	if currentBucket.L402Calls != 1 { // debit entry
		t.Errorf("expected L402Calls=1 in current bucket, got %d", currentBucket.L402Calls)
	}

	// Earlier buckets should be zero-filled
	for i := 0; i < len(points)-1; i++ {
		if points[i].CreditsGranted != 0 {
			t.Errorf("expected zero CreditsGranted at bucket %d, got %d", i, points[i].CreditsGranted)
		}
		if points[i].L402Calls != 0 {
			t.Errorf("expected zero L402Calls at bucket %d, got %d", i, points[i].L402Calls)
		}
	}
}

func TestTimeSeriesMetrics_ZeroFill(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	// Empty store — no agents, no credits
	points, err := store.TimeSeriesMetrics(ctx, 24)
	if err != nil {
		t.Fatalf("TimeSeriesMetrics: %v", err)
	}

	if len(points) != 25 {
		t.Fatalf("expected 25 zero-filled time points, got %d", len(points))
	}

	// All should be zero
	for i, p := range points {
		if p.CreditsGranted != 0 {
			t.Errorf("expected zero CreditsGranted at %d, got %d", i, p.CreditsGranted)
		}
		if p.L402Calls != 0 {
			t.Errorf("expected zero L402Calls at %d, got %d", i, p.L402Calls)
		}
	}

	// Buckets should span from now-24h to now, truncated to hour
	now := time.Now().UTC()
	start := time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, time.UTC).Add(-24 * time.Hour)
	if !points[0].Bucket.Equal(start) {
		t.Errorf("expected first bucket=%v, got %v", start, points[0].Bucket)
	}
}

func TestListAllChannelGrants(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	// Register an agent and reserve 3 channel slots
	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	g1, err := store.ReserveChannelSlot(ctx, agent.ID, testPubkey("02"), testPubkey("02")+"@1.2.3.4:9735", 100000, 10000)
	if err != nil {
		t.Fatalf("ReserveChannelSlot 1: %v", err)
	}
	g2, err := store.ReserveChannelSlot(ctx, agent.ID, testPubkey2("03"), testPubkey2("03")+"@1.2.3.4:9735", 200000, 20000)
	if err != nil {
		t.Fatalf("ReserveChannelSlot 2: %v", err)
	}
	g3, err := store.ReserveChannelSlot(ctx, agent.ID, testPubkey3("02"), testPubkey3("02")+"@1.2.3.4:9735", 300000, 30000)
	if err != nil {
		t.Fatalf("ReserveChannelSlot 3: %v", err)
	}

	// Mark g3 as failed
	err = store.UpdateChannelStatus(ctx, g3, "failed", "", "connection refused", 0)
	if err != nil {
		t.Fatalf("UpdateChannelStatus: %v", err)
	}

	// List all with no filter
	entries, total, err := store.ListAllChannelGrants(ctx, "", "created_at", "desc", 0, 10)
	if err != nil {
		t.Fatalf("ListAllChannelGrants: %v", err)
	}
	if total != 3 {
		t.Errorf("expected total=3, got %d", total)
	}
	if len(entries) != 3 {
		t.Errorf("expected 3 entries, got %d", len(entries))
	}
	// Each entry should have AgentName populated
	for _, e := range entries {
		if e.AgentName == "" {
			t.Errorf("expected non-empty AgentName for grant %s", e.ID)
		}
	}

	// Filter by status=pending
	entries, total, err = store.ListAllChannelGrants(ctx, "pending", "created_at", "desc", 0, 10)
	if err != nil {
		t.Fatalf("ListAllChannelGrants pending: %v", err)
	}
	if total != 2 {
		t.Errorf("expected total=2 for pending filter, got %d", total)
	}

	// Paginate: offset=1, limit=1
	entries, total, err = store.ListAllChannelGrants(ctx, "", "created_at", "desc", 1, 1)
	if err != nil {
		t.Fatalf("ListAllChannelGrants paginate: %v", err)
	}
	if total != 3 {
		t.Errorf("expected total=3, got %d", total)
	}
	if len(entries) != 1 {
		t.Errorf("expected 1 entry, got %d", len(entries))
	}

	_ = g1
	_ = g2
}

func TestAggregateMetrics_WithChannels(t *testing.T) {
	store := NewMockStore()
	ctx := context.Background()

	agent, _, err := store.Register(ctx, "agent1", "1.2.3.4")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Reserve 3 channel slots
	g1, _ := store.ReserveChannelSlot(ctx, agent.ID, testPubkey("02"), testPubkey("02")+"@1.2.3.4:9735", 100000, 10000)
	g2, _ := store.ReserveChannelSlot(ctx, agent.ID, testPubkey2("03"), testPubkey2("03")+"@1.2.3.4:9735", 200000, 20000)
	g3, _ := store.ReserveChannelSlot(ctx, agent.ID, testPubkey3("02"), testPubkey3("02")+"@1.2.3.4:9735", 300000, 30000)

	// Mark g1 as open
	store.UpdateChannelStatus(ctx, g1, "open", "", "", 0)
	// g2 stays pending (non-failed)
	// Mark g3 as failed
	store.UpdateChannelStatus(ctx, g3, "failed", "", "connection refused", 0)

	metrics, err := store.AggregateMetrics(ctx)
	if err != nil {
		t.Fatalf("AggregateMetrics: %v", err)
	}

	// TotalChannelsOpened = non-failed = g1(open) + g2(pending) = 2
	if metrics.TotalChannelsOpened != 2 {
		t.Errorf("expected TotalChannelsOpened=2, got %d", metrics.TotalChannelsOpened)
	}
	// ActiveChannels = status==open = 1
	if metrics.ActiveChannels != 1 {
		t.Errorf("expected ActiveChannels=1, got %d", metrics.ActiveChannels)
	}
	// TotalSatsPushed = sum push_amount for non-failed = 10000 + 20000 = 30000
	if metrics.TotalSatsPushed != 30000 {
		t.Errorf("expected TotalSatsPushed=30000, got %d", metrics.TotalSatsPushed)
	}
	// FaucetSlotsRemaining = cap - non-failed = 100 - 2 = 98
	if metrics.FaucetSlotsRemaining != 98 {
		t.Errorf("expected FaucetSlotsRemaining=98, got %d", metrics.FaucetSlotsRemaining)
	}

	_ = g2
}
