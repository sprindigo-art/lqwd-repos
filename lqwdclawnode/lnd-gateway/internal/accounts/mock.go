package accounts

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// creditEntry represents an in-memory credit ledger entry.
type creditEntry struct {
	ID             string
	AmountSats     int64
	TxType         string
	Description    string
	Status         string
	IdempotencyKey string
	CreatedAt      time.Time
}

// idempEntry represents an in-memory proxy idempotency record.
type idempEntry struct {
	ReserveID    string
	StatusCode   int
	ResponseBody string
	CreatedAt    time.Time
}

// pubkeyBan is the MockStore mirror of the pubkey_bans table row.
type pubkeyBan struct {
	permanent   bool
	bannedUntil *time.Time
	bannedAt    time.Time
}

// MockStore implements AccountStore with in-memory maps for testing.
type MockStore struct {
	mu                 sync.RWMutex
	agents             map[string]*Agent          // keyed by agent ID
	keys               map[string]string          // keyed by api_key_hash -> agent ID
	credits            map[string][]creditEntry   // keyed by agent ID
	idempotency        map[string]idempEntry      // keyed by "agentID|key|endpoint"
	channels           map[string]*ChannelGrant   // keyed by grant ID
	pubkeyBans         map[string]pubkeyBan       // Phase 21.1: keyed by pubkey (operator-issued bans)
	FaucetDailyCapSats int64
	FaucetChannelCap   int
	// FaucetPauseFilePath (Phase 21, 2026-04-22): mirror of PGStore field.
	// When this file exists on disk, ReserveChannelSlot returns ErrFaucetPaused.
	FaucetPauseFilePath string
}

// NewMockStore creates a new in-memory MockStore.
func NewMockStore() *MockStore {
	return &MockStore{
		agents:             make(map[string]*Agent),
		keys:               make(map[string]string),
		credits:            make(map[string][]creditEntry),
		idempotency:        make(map[string]idempEntry),
		channels:           make(map[string]*ChannelGrant),
		pubkeyBans:         make(map[string]pubkeyBan),
		FaucetDailyCapSats: DefaultFaucetDailyCap,
		FaucetChannelCap:   100,
	}
}

// FaucetChannelCapValue returns the configured max number of active faucet
// channel grants. Satisfies the AccountStore interface for Phase 21's
// /v1/internal/admin/faucet/config endpoint.
func (m *MockStore) FaucetChannelCapValue() int {
	return m.FaucetChannelCap
}

// Register creates a new agent with a 150 sat faucet grant.
func (m *MockStore) Register(ctx context.Context, name, ipAddr string) (*Agent, string, error) {
	rawKey, err := generateAPIKey()
	if err != nil {
		return nil, "", fmt.Errorf("generate API key: %w", err)
	}
	keyHash := sha256Hex(rawKey)
	agentID := uuid.New().String()
	now := time.Now()

	agent := &Agent{
		ID:         agentID,
		Name:       name,
		APIKeyHash: keyHash,
		IPAddress:  ipAddr,
		Tier:       1,
		Status:     "active",
		CreatedAt:  now,
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	m.agents[agentID] = agent
	m.keys[keyHash] = agentID
	m.credits[agentID] = append(m.credits[agentID], creditEntry{
		ID:             uuid.New().String(),
		AmountSats:     DefaultTier1GrantSats,
		TxType:         "faucet_grant",
		Description:    "Tier 1 registration grant",
		Status:         "settled",
		IdempotencyKey: "reg:" + agentID,
		CreatedAt:      now,
	})

	return agent, rawKey, nil
}

// Authenticate looks up an agent by API key hash. Returns nil if not found.
// Returns the agent regardless of status — callers (middleware) decide how to handle suspended agents.
func (m *MockStore) Authenticate(ctx context.Context, apiKeyHash string) (*Agent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	agentID, ok := m.keys[apiKeyHash]
	if !ok {
		return nil, nil
	}
	agent, ok := m.agents[agentID]
	if !ok {
		return nil, nil
	}
	return agent, nil
}

// Profile returns the agent's profile with balance breakdown.
func (m *MockStore) Profile(ctx context.Context, agentID string) (*AgentProfile, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	agent, ok := m.agents[agentID]
	if !ok {
		return nil, nil
	}

	var settled, reserved, available int64
	for _, c := range m.credits[agentID] {
		if c.TxType == "reserve" {
			reserved += abs64(c.AmountSats)
		} else {
			settled += c.AmountSats
		}
		available += c.AmountSats
	}

	// Compute daily spend remaining
	now := time.Now().UTC()
	todayMidnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	var dailySpent int64
	for _, c := range m.credits[agentID] {
		if c.TxType == "debit" && c.CreatedAt.After(todayMidnight) {
			dailySpent += abs64(c.AmountSats)
		}
	}
	cap := DailySpendCapForTier(agent.Tier)
	remaining := cap - dailySpent
	if remaining < 0 {
		remaining = 0
	}

	return &AgentProfile{
		ID:               agent.ID,
		Name:             agent.Name,
		Tier:             agent.Tier,
		Status:           agent.Status,
		BalanceSats:      available,
		SettledSats:      settled,
		ReservedSats:     reserved,
		AvailableSats:    available,
		DailySpendRemain: remaining,
		CreatedAt:        agent.CreatedAt,
	}, nil
}

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// RotateKey generates a new API key and replaces the old one.
// Uses optimistic concurrency: currentKeyHash must match the agent's current hash.
func (m *MockStore) RotateKey(ctx context.Context, agentID, currentKeyHash string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	agent, ok := m.agents[agentID]
	if !ok {
		return "", fmt.Errorf("agent not found: %s", agentID)
	}
	if agent.APIKeyHash != currentKeyHash {
		return "", fmt.Errorf("key rotation failed: key hash mismatch (concurrent rotation?)")
	}

	newKey, err := generateAPIKey()
	if err != nil {
		return "", fmt.Errorf("generate new API key: %w", err)
	}
	newHash := sha256Hex(newKey)
	now := time.Now()

	// Remove old hash mapping, add new one
	delete(m.keys, currentKeyHash)
	m.keys[newHash] = agentID
	agent.APIKeyHash = newHash
	agent.KeyRotatedAt = &now

	return newKey, nil
}

// CheckRegistrationLimit returns true if the IP has fewer than 3 registrations in the last hour.
func (m *MockStore) CheckRegistrationLimit(ctx context.Context, ipAddr string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	oneHourAgo := time.Now().Add(-1 * time.Hour)
	count := 0
	for _, agent := range m.agents {
		if agent.IPAddress == ipAddr && agent.CreatedAt.After(oneHourAgo) {
			count++
		}
	}
	return count < 3, nil
}

// ClaimTier2 upgrades an agent to Tier 2 with a 500 sat grant.
func (m *MockStore) ClaimTier2(ctx context.Context, agentID, providedName string) (*Tier2ClaimResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	agent, ok := m.agents[agentID]
	if !ok {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}

	if time.Since(agent.CreatedAt) < 1*time.Hour {
		return nil, ErrTooYoung
	}
	if !strings.EqualFold(agent.Name, providedName) {
		return nil, ErrNameMismatch
	}
	if agent.Tier >= 2 {
		return &Tier2ClaimResult{AlreadyClaimed: true, GrantSats: DefaultTier2GrantSats, NewTier: agent.Tier}, nil
	}

	idemKey := "tier2_grant_" + agentID
	for _, c := range m.credits[agentID] {
		if c.IdempotencyKey == idemKey {
			return &Tier2ClaimResult{AlreadyClaimed: true, GrantSats: DefaultTier2GrantSats, NewTier: 2}, nil
		}
	}

	m.credits[agentID] = append(m.credits[agentID], creditEntry{
		ID:             uuid.New().String(),
		AmountSats:     DefaultTier2GrantSats,
		TxType:         "faucet_grant",
		Description:    "Tier 2 challenge grant",
		Status:         "settled",
		IdempotencyKey: idemKey,
		CreatedAt:      time.Now(),
	})
	agent.Tier = 2

	return &Tier2ClaimResult{AlreadyClaimed: false, GrantSats: DefaultTier2GrantSats, NewTier: 2}, nil
}

// Transactions returns paginated credit ledger entries for an agent.
func (m *MockStore) Transactions(ctx context.Context, agentID, cursor string, limit int) ([]TransactionEntry, string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	credits := m.credits[agentID]
	// Sort by CreatedAt DESC, ID DESC
	sorted := make([]creditEntry, len(credits))
	copy(sorted, credits)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].CreatedAt.Equal(sorted[j].CreatedAt) {
			return sorted[i].ID > sorted[j].ID
		}
		return sorted[i].CreatedAt.After(sorted[j].CreatedAt)
	})

	startIdx := 0
	if cursor != "" {
		decoded, err := base64.URLEncoding.DecodeString(cursor)
		if err != nil {
			return nil, "", fmt.Errorf("invalid cursor: %w", err)
		}
		parts := strings.SplitN(string(decoded), "|", 2)
		if len(parts) != 2 {
			return nil, "", fmt.Errorf("invalid cursor format")
		}
		var nanos int64
		if _, err := fmt.Sscanf(parts[0], "%d", &nanos); err != nil {
			return nil, "", fmt.Errorf("invalid cursor timestamp: %w", err)
		}
		cursorTime := time.Unix(0, nanos).UTC()
		cursorID := parts[1]

		for i, c := range sorted {
			if c.CreatedAt.Before(cursorTime) || (c.CreatedAt.Equal(cursorTime) && c.ID < cursorID) {
				startIdx = i
				break
			}
			if i == len(sorted)-1 {
				startIdx = len(sorted)
			}
		}
	}

	end := startIdx + limit
	if end > len(sorted) {
		end = len(sorted)
	}
	page := sorted[startIdx:end]

	entries := make([]TransactionEntry, len(page))
	for i, c := range page {
		entries[i] = TransactionEntry{
			ID:          c.ID,
			AmountSats:  c.AmountSats,
			TxType:      c.TxType,
			Description: c.Description,
			Status:      c.Status,
			CreatedAt:   c.CreatedAt,
		}
	}

	var nextCursor string
	if len(page) == limit && end < len(sorted) {
		last := page[len(page)-1]
		nextCursor = base64.URLEncoding.EncodeToString(
			[]byte(fmt.Sprintf("%d|%s", last.CreatedAt.UnixNano(), last.ID)),
		)
	}
	return entries, nextCursor, nil
}

// DailySpendRemaining returns how many sats the agent can still spend today.
func (m *MockStore) DailySpendRemaining(ctx context.Context, agentID string, tier int) (int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now().UTC()
	todayMidnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	var dailySpent int64
	for _, c := range m.credits[agentID] {
		if c.TxType == "debit" && c.CreatedAt.After(todayMidnight) {
			dailySpent += abs64(c.AmountSats)
		}
	}

	cap := DailySpendCapForTier(tier)
	remaining := cap - dailySpent
	if remaining < 0 {
		remaining = 0
	}
	return remaining, nil
}

// CheckFaucetCap returns true if the grant would stay within the daily faucet cap.
func (m *MockStore) CheckFaucetCap(ctx context.Context, grantAmount int64) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now().UTC()
	todayMidnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	var totalGranted int64
	for _, entries := range m.credits {
		for _, c := range entries {
			if c.TxType == "faucet_grant" && c.CreatedAt.After(todayMidnight) {
				totalGranted += c.AmountSats
			}
		}
	}
	return totalGranted+grantAmount <= m.FaucetDailyCapSats, nil
}

// ListAgents returns a filtered, sorted, paginated list of agents.
func (m *MockStore) ListAgents(ctx context.Context, search string, sortBy string, sortDir string, offset, limit int) ([]AgentListEntry, int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Collect all agents into list entries
	var all []AgentListEntry
	for _, agent := range m.agents {
		if search != "" && !strings.Contains(strings.ToLower(agent.Name), strings.ToLower(search)) {
			continue
		}
		var balance int64
		var lastActive *time.Time
		for _, c := range m.credits[agent.ID] {
			balance += c.AmountSats
			t := c.CreatedAt
			if lastActive == nil || t.After(*lastActive) {
				lastActive = &t
			}
		}
		all = append(all, AgentListEntry{
			ID:          agent.ID,
			Name:        agent.Name,
			Tier:        agent.Tier,
			BalanceSats: balance,
			Status:      agent.Status,
			LastActive:  lastActive,
			CreatedAt:   agent.CreatedAt,
		})
	}

	// Sort
	sort.Slice(all, func(i, j int) bool {
		var less bool
		switch sortBy {
		case "name":
			less = all[i].Name < all[j].Name
		case "tier":
			less = all[i].Tier < all[j].Tier
		case "balance":
			less = all[i].BalanceSats < all[j].BalanceSats
		case "status":
			less = all[i].Status < all[j].Status
		default:
			less = all[i].CreatedAt.Before(all[j].CreatedAt)
		}
		if sortDir == "desc" {
			return !less
		}
		return less
	})

	total := len(all)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return all[offset:end], total, nil
}

// AggregateMetrics returns aggregate dashboard statistics.
func (m *MockStore) AggregateMetrics(ctx context.Context) (*AdminMetrics, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now().UTC()
	todayMidnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	metrics := &AdminMetrics{
		TotalAgents: len(m.agents),
	}
	for _, entries := range m.credits {
		for _, c := range entries {
			switch c.TxType {
			case "faucet_grant", "admin_grant":
				metrics.TotalCreditsGranted += c.AmountSats
				if c.TxType == "faucet_grant" && c.CreatedAt.After(todayMidnight) {
					metrics.DailyFaucetSpend += c.AmountSats
				}
			case "debit":
				metrics.TotalL402Calls++
			}
		}
	}

	// Channel metrics
	for _, g := range m.channels {
		if g.Status != "failed" {
			metrics.TotalChannelsOpened++
			metrics.TotalSatsPushed += g.PushAmount
		}
		if g.Status == "open" {
			metrics.ActiveChannels++
		}
	}
	metrics.FaucetSlotsRemaining = m.FaucetChannelCap - metrics.TotalChannelsOpened

	return metrics, nil
}

// TimeSeriesMetrics returns hourly-bucketed data with zero-fill for mock store.
func (m *MockStore) TimeSeriesMetrics(ctx context.Context, rangeHours int) ([]TimePoint, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now().UTC()
	nowBucket := time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, time.UTC)
	start := nowBucket.Add(-time.Duration(rangeHours) * time.Hour)

	// Initialize all buckets with zero values
	buckets := make(map[time.Time]*TimePoint)
	for t := start; !t.After(nowBucket); t = t.Add(time.Hour) {
		tp := TimePoint{Bucket: t}
		buckets[t] = &tp
	}

	// Populate from credit entries
	for _, entries := range m.credits {
		for _, c := range entries {
			if c.CreatedAt.Before(start) {
				continue
			}
			ct := c.CreatedAt.UTC()
			bucket := time.Date(ct.Year(), ct.Month(), ct.Day(), ct.Hour(), 0, 0, 0, time.UTC)
			tp, ok := buckets[bucket]
			if !ok {
				continue
			}
			switch c.TxType {
			case "faucet_grant", "admin_grant":
				tp.CreditsGranted += c.AmountSats
			case "debit":
				tp.L402Calls++
			}
		}
	}

	// Convert to sorted slice
	points := make([]TimePoint, 0, len(buckets))
	for t := start; !t.After(nowBucket); t = t.Add(time.Hour) {
		points = append(points, *buckets[t])
	}
	return points, nil
}

// GrantCredits inserts an admin grant into the credit ledger.
func (m *MockStore) GrantCredits(ctx context.Context, agentID string, amountSats int64, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.agents[agentID]; !ok {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	m.credits[agentID] = append(m.credits[agentID], creditEntry{
		ID:          uuid.New().String(),
		AmountSats:  amountSats,
		TxType:      "admin_grant",
		Description: reason,
		Status:      "settled",
		CreatedAt:   time.Now(),
	})
	return nil
}

// SuspendAgent sets an agent's status to suspended.
func (m *MockStore) SuspendAgent(ctx context.Context, agentID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	agent, ok := m.agents[agentID]
	if !ok || agent.Status != "active" {
		return fmt.Errorf("agent not found or already suspended: %s", agentID)
	}
	now := time.Now()
	agent.Status = "suspended"
	agent.SuspendedAt = &now
	return nil
}

// UnsuspendAgent sets an agent's status back to active.
func (m *MockStore) UnsuspendAgent(ctx context.Context, agentID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	agent, ok := m.agents[agentID]
	if !ok || agent.Status != "suspended" {
		return fmt.Errorf("agent not found or not suspended: %s", agentID)
	}
	agent.Status = "active"
	agent.SuspendedAt = nil
	return nil
}

// Close is a no-op for the in-memory mock store.
func (m *MockStore) Close() {}

// ReserveCredits atomically reserves credits for a proxy call with idempotency.
func (m *MockStore) ReserveCredits(ctx context.Context, req ReserveRequest) (*ReserveResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	lookupKey := req.AgentID + "|" + req.IdempotencyKey + "|" + req.Endpoint

	// Check idempotency
	if entry, ok := m.idempotency[lookupKey]; ok {
		if entry.StatusCode > 0 {
			return &ReserveResult{Cached: &CachedResponse{StatusCode: entry.StatusCode, ResponseBody: entry.ResponseBody}}, nil
		}
		return nil, fmt.Errorf("reserve already in-flight for idempotency key %s", req.IdempotencyKey)
	}

	// Check available balance
	var balance int64
	for _, c := range m.credits[req.AgentID] {
		balance += c.AmountSats
	}
	if balance < req.AmountSats {
		return nil, ErrInsufficientCredits
	}

	// Create reserve
	reserveID := uuid.New().String()
	m.credits[req.AgentID] = append(m.credits[req.AgentID], creditEntry{
		ID:          reserveID,
		AmountSats:  -req.AmountSats,
		TxType:      "reserve",
		Description: "Proxy: " + req.Endpoint,
		Status:      "pending",
		CreatedAt:   time.Now(),
	})

	// Store idempotency record
	m.idempotency[lookupKey] = idempEntry{
		ReserveID: reserveID,
		StatusCode: 0,
		CreatedAt: time.Now(),
	}

	return &ReserveResult{ReserveID: reserveID}, nil
}

// SettleReserve converts a pending reserve to a settled debit and caches the response.
func (m *MockStore) SettleReserve(ctx context.Context, reserveID, idempotencyKey, endpoint string, statusCode int, responseBody string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Find and remove the reserve entry
	var foundAgent string
	var amount int64
	var desc string
	for agentID, entries := range m.credits {
		for i, c := range entries {
			if c.ID == reserveID && c.TxType == "reserve" {
				foundAgent = agentID
				amount = abs64(c.AmountSats)
				desc = c.Description
				m.credits[agentID] = append(entries[:i], entries[i+1:]...)
				break
			}
		}
		if foundAgent != "" {
			break
		}
	}
	if foundAgent == "" {
		return fmt.Errorf("reserve %s not found", reserveID)
	}

	// Insert settled debit
	m.credits[foundAgent] = append(m.credits[foundAgent], creditEntry{
		ID:          uuid.New().String(),
		AmountSats:  -amount,
		TxType:      "debit",
		Description: desc,
		Status:      "settled",
		CreatedAt:   time.Now(),
	})

	// Update idempotency entry
	lookupKey := foundAgent + "|" + idempotencyKey + "|" + endpoint
	if entry, ok := m.idempotency[lookupKey]; ok {
		entry.StatusCode = statusCode
		entry.ResponseBody = responseBody
		m.idempotency[lookupKey] = entry
	}

	return nil
}

// RefundReserve deletes a pending reserve and its idempotency record, restoring credits.
func (m *MockStore) RefundReserve(ctx context.Context, reserveID, idempotencyKey, endpoint string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Find and remove the reserve entry
	var foundAgent string
	for agentID, entries := range m.credits {
		for i, c := range entries {
			if c.ID == reserveID && c.TxType == "reserve" {
				foundAgent = agentID
				m.credits[agentID] = append(entries[:i], entries[i+1:]...)
				break
			}
		}
		if foundAgent != "" {
			break
		}
	}
	if foundAgent == "" {
		return fmt.Errorf("reserve %s not found", reserveID)
	}

	// Delete idempotency record
	lookupKey := foundAgent + "|" + idempotencyKey + "|" + endpoint
	delete(m.idempotency, lookupKey)

	return nil
}

// CleanupOrphanedReserves removes stale reserves and their idempotency records.
func (m *MockStore) CleanupOrphanedReserves(ctx context.Context, maxAge time.Duration) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	var count int64

	// Remove stale reserve entries
	for agentID, entries := range m.credits {
		var kept []creditEntry
		for _, c := range entries {
			if c.TxType == "reserve" && c.CreatedAt.Before(cutoff) {
				count++
			} else {
				kept = append(kept, c)
			}
		}
		m.credits[agentID] = kept
	}

	// Remove stale pending idempotency records
	for key, entry := range m.idempotency {
		if entry.StatusCode == 0 && entry.CreatedAt.Before(cutoff) {
			delete(m.idempotency, key)
		}
	}

	return count, nil
}

// ListAllChannelGrants returns paginated channel grants with agent names and optional status filter.
func (m *MockStore) ListAllChannelGrants(ctx context.Context, status string, sortBy string, sortDir string, offset, limit int) ([]ChannelGrantEntry, int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Collect all channel grants
	var all []ChannelGrantEntry
	for _, g := range m.channels {
		if status != "" && g.Status != status {
			continue
		}
		name := "Unknown"
		if agent, ok := m.agents[g.AgentID]; ok {
			name = agent.Name
		}
		all = append(all, ChannelGrantEntry{
			ChannelGrant: *g,
			AgentName:    name,
		})
	}

	// Sort
	sort.Slice(all, func(i, j int) bool {
		var less bool
		switch sortBy {
		case "status":
			less = all[i].Status < all[j].Status
		case "channel_size_sats":
			less = all[i].ChannelSize < all[j].ChannelSize
		case "push_amount_sats":
			less = all[i].PushAmount < all[j].PushAmount
		case "agent_name":
			less = all[i].AgentName < all[j].AgentName
		case "banned":
			less = !all[i].Banned && all[j].Banned
		default: // created_at
			less = all[i].CreatedAt.Before(all[j].CreatedAt)
		}
		if sortDir == "desc" {
			return !less
		}
		return less
	})

	total := len(all)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return all[offset:end], total, nil
}

// ReserveChannelSlot reserves a channel faucet slot with cap and ban enforcement.
func (m *MockStore) ReserveChannelSlot(ctx context.Context, agentID, pubkey, nodeURI string, channelSize, pushAmount int64) (string, error) {
	// Phase 21: faucet pause check. Mirrors PGStore. Done before taking
	// the mutex so a paused faucet short-circuits without contention.
	if m.FaucetPauseFilePath != "" {
		if _, statErr := os.Stat(m.FaucetPauseFilePath); statErr == nil {
			return "", ErrFaucetPaused
		}
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// Count non-failed grants
	count := 0
	for _, g := range m.channels {
		if g.Status != "failed" {
			count++
		}
	}
	if count >= m.FaucetChannelCap {
		return "", ErrFaucetChannelCap
	}

	now := time.Now()

	// Phase 21.1: operator-issued ban via pubkey_bans. Authoritative for
	// preemptive bans; works even for pubkeys with no existing grants.
	if pb, ok := m.pubkeyBans[pubkey]; ok {
		if pb.permanent {
			return "", ErrPubkeyBanned
		}
		if pb.bannedUntil != nil && pb.bannedUntil.After(now) {
			return "", ErrPubkeyBanned
		}
	}

	// Legacy / auto-ban on the grant row. Mirrors PGStore. The
	// 3-failure auto-ban path writes Banned = true here on failing grants.
	for _, g := range m.channels {
		if g.Pubkey != pubkey {
			continue
		}
		if g.Banned {
			return "", ErrPubkeyBanned
		}
		if g.BannedUntil != nil && g.BannedUntil.After(now) {
			return "", ErrPubkeyBanned
		}
	}

	grantID := uuid.New().String()
	m.channels[grantID] = &ChannelGrant{
		ID:          grantID,
		AgentID:     agentID,
		Pubkey:      pubkey,
		NodeURI:     nodeURI,
		Status:      "pending",
		ChannelSize: channelSize,
		PushAmount:  pushAmount,
		CreatedAt:   time.Now(),
	}
	return grantID, nil
}

// UpdateChannelStatus updates the status and related fields of a channel grant.
func (m *MockStore) UpdateChannelStatus(ctx context.Context, grantID, status, fundingTxID, failReason string, outputIndex int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	grant, ok := m.channels[grantID]
	if !ok {
		return fmt.Errorf("channel grant %s not found", grantID)
	}

	grant.Status = status
	switch status {
	case "failed":
		grant.FailReason = failReason
		// Mirror PGStore: ban only after FaucetBanAfterFailures failures.
		failedCount := 0
		for _, g := range m.channels {
			if g.Pubkey == grant.Pubkey && g.Status == "failed" {
				failedCount++
			}
		}
		if failedCount >= FaucetBanAfterFailures {
			for _, g := range m.channels {
				if g.Pubkey == grant.Pubkey {
					g.Banned = true
				}
			}
		}
	case "pending_open":
		grant.FundingTxID = fundingTxID
		grant.OutputIndex = outputIndex
	case "open":
		now := time.Now()
		grant.OpenedAt = &now
	case "closed":
		now := time.Now()
		grant.ClosedAt = &now
		grant.ClosedReason = failReason
	}
	return nil
}

// GetChannelGrant returns the most recent channel grant for an agent.
//
// Returns a COPY of the stored row, not the internal pointer. This matches
// PGStore semantics (which always scans into a fresh ChannelGrant) and
// prevents data races between callers reading the returned value and
// concurrent writers (e.g., UpdateChannelStatusCAS) mutating the map
// entry. Fixed 2026-04-24 (Plan 22-03) after TestChannelStatusCASConcurrency
// surfaced the shared-pointer race under `-race`.
func (m *MockStore) GetChannelGrant(ctx context.Context, agentID string) (*ChannelGrant, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var latest *ChannelGrant
	for _, g := range m.channels {
		if g.AgentID == agentID {
			if latest == nil || g.CreatedAt.After(latest.CreatedAt) {
				latest = g
			}
		}
	}
	if latest == nil {
		return nil, nil
	}
	copy := *latest
	return &copy, nil
}

// GetChannelGrantByID returns a channel grant by its ID.
//
// Returns a COPY of the stored row — same rationale as GetChannelGrant.
func (m *MockStore) GetChannelGrantByID(ctx context.Context, grantID string) (*ChannelGrant, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	grant, ok := m.channels[grantID]
	if !ok {
		return nil, nil
	}
	copy := *grant
	return &copy, nil
}

// ListPendingChannels returns all channel grants with pending or pending_open status.
func (m *MockStore) ListPendingChannels(ctx context.Context) ([]ChannelGrant, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var pending []ChannelGrant
	for _, g := range m.channels {
		if g.Status == "pending" || g.Status == "pending_open" {
			pending = append(pending, *g)
		}
	}
	return pending, nil
}

// SetChannelFundingFeeRate (Phase 22 REN-04) persists the sat/vB used for
// the funding tx onto the grant row. Mirrors PGStore: no-op on satVB <= 0;
// otherwise records a *int64 so the JSON-serialized grant row emits the
// numeric value when surfaced via /v1/internal/channel/status.
func (m *MockStore) SetChannelFundingFeeRate(ctx context.Context, grantID string, satVB int64) error {
	if satVB <= 0 {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	grant, ok := m.channels[grantID]
	if !ok {
		return fmt.Errorf("channel grant %s not found", grantID)
	}
	v := satVB
	grant.FundingFeeRateSatVB = &v
	return nil
}

// UpdateChannelStatusCAS (Phase 22 CHO-01/CHO-02) mirrors PGStore's CAS
// semantics in-memory. See store.go:UpdateChannelStatusCAS for the full
// contract. Key invariants:
//   - Returns (false, nil) — NOT an error — when the row is missing OR
//     when the row's current status != expectedStatus. This is the
//     "someone else transitioned" signal the handler uses to re-read.
//   - Returns (true, nil) when the in-memory row is mutated.
//   - channelPoint overwrites unconditionally on a match.
//   - fundingFeeRateSatVB overwrites only when non-nil.
//   - Stamps OpenedAt on "open" transitions, ClosedAt on "closed".
func (m *MockStore) UpdateChannelStatusCAS(
	ctx context.Context,
	grantID, expectedStatus, newStatus, channelPoint string,
	fundingFeeRateSatVB *int64,
) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	grant, ok := m.channels[grantID]
	if !ok {
		return false, nil // missing row — no-match, not error
	}
	if grant.Status != expectedStatus {
		return false, nil // someone else transitioned — re-read path
	}
	grant.Status = newStatus
	cp := channelPoint
	grant.ChannelPoint = &cp
	if fundingFeeRateSatVB != nil {
		v := *fundingFeeRateSatVB
		grant.FundingFeeRateSatVB = &v
	}
	now := time.Now()
	switch newStatus {
	case "open":
		grant.OpenedAt = &now
	case "closed":
		grant.ClosedAt = &now
	}
	return true, nil
}

// ClearPubkeyBan clears all ban state for the pubkey. Mirrors PGStore:
// deletes the pubkey_bans row AND clears banned / banned_until on any
// matching grant row so unban is a true "remove all ban state".
func (m *MockStore) ClearPubkeyBan(ctx context.Context, pubkey string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Phase 21.1: drop operator-issued ban
	delete(m.pubkeyBans, pubkey)

	// Legacy: clear auto-ban flags on grant rows
	for _, g := range m.channels {
		if g.Pubkey == pubkey {
			g.Banned = false
			g.BannedUntil = nil
		}
	}
	return nil
}

// BanPubkeyUntil upserts an operator-issued ban into the in-memory
// pubkey_bans map. Mirrors PGStore Phase 21.1 semantics: works for any
// pubkey regardless of whether it has existing grants, because the ban
// state is stored separately from channel_grants.
func (m *MockStore) BanPubkeyUntil(ctx context.Context, pubkey string, until *time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	entry := pubkeyBan{bannedAt: time.Now()}
	if until == nil {
		entry.permanent = true
	} else {
		u := *until
		entry.bannedUntil = &u
	}
	m.pubkeyBans[pubkey] = entry
	return nil
}

// ResetIPRateLimit backdates recent agents from this IP so the rate-limit
// counter clears. Returns number of rows affected. Mock version mirrors
// the PGStore UPDATE-with-time-shift approach by shifting the agent's
// CreatedAt into the past.
func (m *MockStore) ResetIPRateLimit(ctx context.Context, ipAddr string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var affected int64
	cutoff := time.Now().Add(-1 * time.Hour)
	shift := -2 * time.Hour
	for _, a := range m.agents {
		if a.IPAddress == ipAddr && a.CreatedAt.After(cutoff) {
			a.CreatedAt = a.CreatedAt.Add(shift)
			affected++
		}
	}
	return affected, nil
}

// Ensure MockStore implements AccountStore at compile time.
var _ AccountStore = (*MockStore)(nil)
