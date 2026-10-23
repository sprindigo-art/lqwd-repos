package accounts

import (
	"context"
	"encoding/base64"
	"fmt"
	"hash/fnv"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Schema SQL for agents and credit_ledger tables.
const schemaMigration = `
CREATE TABLE IF NOT EXISTS agents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    api_key_hash    TEXT NOT NULL UNIQUE,
    ip_address      TEXT NOT NULL,
    tier            INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    key_rotated_at  TIMESTAMPTZ,
    suspended_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_agents_ip_created ON agents(ip_address, created_at);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

CREATE TABLE IF NOT EXISTS credit_ledger (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        UUID NOT NULL REFERENCES agents(id),
    amount_sats     BIGINT NOT NULL,
    tx_type         TEXT NOT NULL,
    description     TEXT,
    idempotency_key TEXT UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_agent ON credit_ledger(agent_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_agent_created ON credit_ledger(agent_id, created_at);

ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'settled';
CREATE INDEX IF NOT EXISTS idx_credit_ledger_type_created ON credit_ledger(tx_type, created_at);

CREATE TABLE IF NOT EXISTS proxy_idempotency (
    idempotency_key TEXT NOT NULL,
    endpoint        TEXT NOT NULL,
    agent_id        UUID NOT NULL REFERENCES agents(id),
    reserve_id      UUID,
    status_code     INTEGER NOT NULL DEFAULT 0,
    response_body   TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (idempotency_key, endpoint, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_proxy_idemp_created ON proxy_idempotency(created_at);

CREATE TABLE IF NOT EXISTS faucet_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        UUID NOT NULL REFERENCES agents(id),
    pubkey          TEXT NOT NULL,
    node_uri        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    funding_txid    TEXT,
    output_index    INTEGER DEFAULT 0,
    channel_size    BIGINT NOT NULL,
    push_amount     BIGINT NOT NULL,
    fail_reason     TEXT,
    banned          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opened_at       TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    closed_reason   TEXT
);
CREATE INDEX IF NOT EXISTS idx_faucet_channels_agent ON faucet_channels(agent_id);
CREATE INDEX IF NOT EXISTS idx_faucet_channels_pubkey ON faucet_channels(pubkey);
CREATE INDEX IF NOT EXISTS idx_faucet_channels_status ON faucet_channels(status);

-- Phase 21 (2026-04-22): time-limited pubkey bans. NULL means "no
-- time-limited ban"; a future timestamp means the pubkey is banned
-- until then. The permanent boolean banned column still wins when set.
ALTER TABLE faucet_channels ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ NULL;

-- Phase 22 REN-04 (2026-04-24): funding_fee_rate_sat_vb -- sat/vB the
-- OpenChannel call passed to LND for the funding tx. Populated by
-- openChannelAsync from internal/feeestimate.Estimator.Current() right
-- after a successful OpenChannel response. Plan 22-03s CAS UPDATE
-- surfaces this column in /v1/internal/channel/status so agents see
-- the real funding fee rate, not a hardcoded placeholder. NULL for
-- rows that predate the populator or were opened with the estimator
-- disabled. Pre-revision note: this column was originally scoped to
-- Plan 22-03s schema migration, but this plan (the populator) can
-- only work if the column exists at INSERT/UPDATE time, so the DDL
-- lands here. Plan 22-03 is additive (adds channel_point alongside)
-- and uses the same idempotent ADD COLUMN IF NOT EXISTS pattern --
-- safe under Postgres idempotent-DDL semantics.
ALTER TABLE faucet_channels ADD COLUMN IF NOT EXISTS funding_fee_rate_sat_vb INT NULL;

-- Phase 22 CHO-01 (2026-04-24): channel_point -- the on-chain funding
-- outpoint (funding_txid:output_index) as LND reports it. Populated by
-- Plan 22-03 UpdateChannelStatusCAS on pending_open -> open transitions
-- so /v1/internal/channel/status can surface the authoritative outpoint
-- alongside the status. Idempotent ADD COLUMN IF NOT EXISTS matches
-- the Phase 21 banned_until and Phase 22 REN-04 patterns above.
ALTER TABLE faucet_channels ADD COLUMN IF NOT EXISTS channel_point TEXT NULL;

-- Phase 21.1 (2026-04-22): dedicated pubkey_bans table for operator-
-- issued bans. Needed because BanPubkeyUntil used to UPDATE
-- faucet_channels, but a pubkey with no existing grant row could not
-- be preemptively banned (UPDATE matched zero rows, silent no-op). The
-- table is authoritative for preemptive bans; ReserveChannelSlot
-- checks it BEFORE the faucet_channels fallback so net-new pubkeys
-- also get blocked. The existing 3-failure auto-ban path keeps
-- writing banned = TRUE onto the grant row (it always has one).
CREATE TABLE IF NOT EXISTS pubkey_bans (
    pubkey         TEXT PRIMARY KEY,
    banned_until   TIMESTAMPTZ NULL,
    permanent      BOOLEAN NOT NULL DEFAULT FALSE,
    banned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    banned_by      TEXT
);
CREATE INDEX IF NOT EXISTS idx_pubkey_bans_banned_until ON pubkey_bans(banned_until);
`

// PGStore implements AccountStore with a PostgreSQL connection pool.
type PGStore struct {
	pool               *pgxpool.Pool
	FaucetDailyCapSats int64
	FaucetChannelCap   int
	// FaucetPauseFilePath (Phase 21, 2026-04-22): when this file exists
	// on disk, ReserveChannelSlot returns ErrFaucetPaused. Wired from
	// config.FaucetPauseFilePath by main.go after construction.
	FaucetPauseFilePath string
}

// channelCapLockKey is the advisory lock key for channel faucet cap enforcement.
const channelCapLockKey = int64(0x4348464155434554)

// NewPGStore creates a new PGStore with the given database URL, daily faucet cap, and channel cap.
func NewPGStore(ctx context.Context, databaseURL string, faucetDailyCapSats int64, faucetChannelCap int) (*PGStore, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database URL: %w", err)
	}
	config.MinConns = 2
	config.MaxConns = 10

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	// Run schema migration
	if _, err := pool.Exec(ctx, schemaMigration); err != nil {
		pool.Close()
		return nil, fmt.Errorf("run schema migration: %w", err)
	}

	return &PGStore{pool: pool, FaucetDailyCapSats: faucetDailyCapSats, FaucetChannelCap: faucetChannelCap}, nil
}

// FaucetChannelCapValue returns the configured max number of active faucet
// channel grants. Satisfies the AccountStore interface for Phase 21's
// /v1/internal/admin/faucet/config endpoint so the agent can surface this
// value without reading /etc/lnd-gateway/env (not agent-readable).
func (s *PGStore) FaucetChannelCapValue() int {
	return s.FaucetChannelCap
}

// Register creates a new agent and credits the initial faucet grant atomically.
// The faucet cap check runs inside the transaction to prevent TOCTOU races
// where concurrent registrations could overshoot the daily cap.
func (s *PGStore) Register(ctx context.Context, name, ipAddr string) (*Agent, string, error) {
	rawKey, err := generateAPIKey()
	if err != nil {
		return nil, "", fmt.Errorf("generate API key: %w", err)
	}
	keyHash := sha256Hex(rawKey)
	agentID := uuid.New().String()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, "", fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Check faucet cap inside transaction to prevent TOCTOU race.
	// The handler also checks (fast-path rejection) but this is the authoritative check.
	now := time.Now().UTC()
	todayMidnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	var totalGranted int64
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_sats), 0)
		FROM credit_ledger WHERE tx_type = 'faucet_grant' AND created_at >= $1
	`, todayMidnight).Scan(&totalGranted)
	if err != nil {
		return nil, "", fmt.Errorf("check faucet cap: %w", err)
	}
	if totalGranted+int64(DefaultTier1GrantSats) > s.FaucetDailyCapSats {
		return nil, "", ErrFaucetCap
	}

	var agent Agent
	err = tx.QueryRow(ctx, `
		INSERT INTO agents (id, name, api_key_hash, ip_address, tier, status)
		VALUES ($1, $2, $3, $4, 1, 'active')
		RETURNING id, name, api_key_hash, ip_address, tier, status, created_at, key_rotated_at, suspended_at
	`, agentID, name, keyHash, ipAddr).Scan(
		&agent.ID, &agent.Name, &agent.APIKeyHash, &agent.IPAddress,
		&agent.Tier, &agent.Status, &agent.CreatedAt, &agent.KeyRotatedAt, &agent.SuspendedAt,
	)
	if err != nil {
		return nil, "", fmt.Errorf("insert agent: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO credit_ledger (agent_id, amount_sats, tx_type, description, idempotency_key)
		VALUES ($1, $2, 'faucet_grant', 'Tier 1 registration grant', $3)
	`, agentID, DefaultTier1GrantSats, "reg:"+agentID)
	if err != nil {
		return nil, "", fmt.Errorf("insert credit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, "", fmt.Errorf("commit transaction: %w", err)
	}

	return &agent, rawKey, nil
}

// Authenticate looks up an agent by API key hash. Returns nil if not found or suspended.
func (s *PGStore) Authenticate(ctx context.Context, apiKeyHash string) (*Agent, error) {
	var agent Agent
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, api_key_hash, ip_address, tier, status, created_at, key_rotated_at, suspended_at
		FROM agents WHERE api_key_hash = $1
	`, apiKeyHash).Scan(
		&agent.ID, &agent.Name, &agent.APIKeyHash, &agent.IPAddress,
		&agent.Tier, &agent.Status, &agent.CreatedAt, &agent.KeyRotatedAt, &agent.SuspendedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query agent: %w", err)
	}

	return &agent, nil
}

// Profile returns the agent's public profile with balance breakdown.
func (s *PGStore) Profile(ctx context.Context, agentID string) (*AgentProfile, error) {
	var profile AgentProfile
	err := s.pool.QueryRow(ctx, `
		SELECT a.id, a.name, a.tier, a.status, a.created_at,
		       COALESCE(SUM(CASE WHEN cl.tx_type != 'reserve' THEN cl.amount_sats ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN cl.tx_type = 'reserve' THEN ABS(cl.amount_sats) ELSE 0 END), 0),
		       COALESCE(SUM(cl.amount_sats), 0)
		FROM agents a
		LEFT JOIN credit_ledger cl ON cl.agent_id = a.id
		WHERE a.id = $1
		GROUP BY a.id, a.name, a.tier, a.status, a.created_at
	`, agentID).Scan(
		&profile.ID, &profile.Name, &profile.Tier, &profile.Status, &profile.CreatedAt,
		&profile.SettledSats, &profile.ReservedSats, &profile.AvailableSats,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query profile: %w", err)
	}

	profile.BalanceSats = profile.AvailableSats
	remaining, err := s.DailySpendRemaining(ctx, agentID, profile.Tier)
	if err != nil {
		return nil, fmt.Errorf("daily spend remaining: %w", err)
	}
	profile.DailySpendRemain = remaining

	return &profile, nil
}

// RotateKey generates a new API key and atomically replaces the old one.
// Uses optimistic concurrency: the current key hash must match.
func (s *PGStore) RotateKey(ctx context.Context, agentID, currentKeyHash string) (string, error) {
	newKey, err := generateAPIKey()
	if err != nil {
		return "", fmt.Errorf("generate new API key: %w", err)
	}
	newHash := sha256Hex(newKey)

	var returnedID string
	err = s.pool.QueryRow(ctx, `
		UPDATE agents SET api_key_hash = $1, key_rotated_at = NOW()
		WHERE id = $2 AND api_key_hash = $3
		RETURNING id
	`, newHash, agentID, currentKeyHash).Scan(&returnedID)
	if err == pgx.ErrNoRows {
		return "", fmt.Errorf("key rotation failed: agent not found or key hash mismatch (concurrent rotation?)")
	}
	if err != nil {
		return "", fmt.Errorf("rotate key: %w", err)
	}

	return newKey, nil
}

// CheckRegistrationLimit returns true if the IP has fewer than 3 registrations in the last hour.
func (s *PGStore) CheckRegistrationLimit(ctx context.Context, ipAddr string) (bool, error) {
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM agents
		WHERE ip_address = $1 AND created_at > NOW() - INTERVAL '1 hour'
	`, ipAddr).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check registration limit: %w", err)
	}
	return count < 3, nil
}

// ClaimTier2 upgrades an agent to Tier 2 with a 500 sat grant.
func (s *PGStore) ClaimTier2(ctx context.Context, agentID, providedName string) (*Tier2ClaimResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var name string
	var tier int
	var createdAt time.Time
	err = tx.QueryRow(ctx, `SELECT name, tier, created_at FROM agents WHERE id = $1`, agentID).Scan(&name, &tier, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("query agent: %w", err)
	}

	if time.Since(createdAt) < 1*time.Hour {
		return nil, ErrTooYoung
	}
	if !strings.EqualFold(name, providedName) {
		return nil, ErrNameMismatch
	}
	if tier >= 2 {
		return &Tier2ClaimResult{AlreadyClaimed: true, GrantSats: DefaultTier2GrantSats, NewTier: tier}, nil
	}

	// Check faucet cap inside transaction to prevent TOCTOU race
	now := time.Now().UTC()
	todayMidnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	var totalGranted int64
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_sats), 0)
		FROM credit_ledger WHERE tx_type = 'faucet_grant' AND created_at >= $1
	`, todayMidnight).Scan(&totalGranted)
	if err != nil {
		return nil, fmt.Errorf("check faucet cap: %w", err)
	}
	if totalGranted+int64(DefaultTier2GrantSats) > s.FaucetDailyCapSats {
		return nil, ErrFaucetCap
	}

	idemKey := "tier2_grant_" + agentID
	tag, err := tx.Exec(ctx, `
		INSERT INTO credit_ledger (agent_id, amount_sats, tx_type, description, status, idempotency_key)
		VALUES ($1, $2, 'faucet_grant', 'Tier 2 challenge grant', 'settled', $3)
		ON CONFLICT (idempotency_key) DO NOTHING
	`, agentID, DefaultTier2GrantSats, idemKey)
	if err != nil {
		return nil, fmt.Errorf("insert tier2 grant: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return &Tier2ClaimResult{AlreadyClaimed: true, GrantSats: DefaultTier2GrantSats, NewTier: 2}, nil
	}

	_, err = tx.Exec(ctx, `UPDATE agents SET tier = 2 WHERE id = $1`, agentID)
	if err != nil {
		return nil, fmt.Errorf("upgrade tier: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return &Tier2ClaimResult{AlreadyClaimed: false, GrantSats: DefaultTier2GrantSats, NewTier: 2}, nil
}

// Transactions returns paginated credit ledger entries for an agent.
func (s *PGStore) Transactions(ctx context.Context, agentID, cursor string, limit int) ([]TransactionEntry, string, error) {
	var rows pgx.Rows
	var err error

	if cursor == "" {
		rows, err = s.pool.Query(ctx, `
			SELECT id, amount_sats, tx_type, description, status, created_at
			FROM credit_ledger WHERE agent_id = $1
			ORDER BY created_at DESC, id DESC LIMIT $2
		`, agentID, limit)
	} else {
		decoded, decErr := base64.URLEncoding.DecodeString(cursor)
		if decErr != nil {
			return nil, "", fmt.Errorf("invalid cursor: %w", decErr)
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

		rows, err = s.pool.Query(ctx, `
			SELECT id, amount_sats, tx_type, description, status, created_at
			FROM credit_ledger WHERE agent_id = $1 AND (created_at, id) < ($2, $3)
			ORDER BY created_at DESC, id DESC LIMIT $4
		`, agentID, cursorTime, cursorID, limit)
	}
	if err != nil {
		return nil, "", fmt.Errorf("query transactions: %w", err)
	}
	defer rows.Close()

	var entries []TransactionEntry
	for rows.Next() {
		var e TransactionEntry
		if err := rows.Scan(&e.ID, &e.AmountSats, &e.TxType, &e.Description, &e.Status, &e.CreatedAt); err != nil {
			return nil, "", fmt.Errorf("scan transaction: %w", err)
		}
		entries = append(entries, e)
	}

	var nextCursor string
	if len(entries) == limit {
		last := entries[len(entries)-1]
		nextCursor = base64.URLEncoding.EncodeToString(
			[]byte(fmt.Sprintf("%d|%s", last.CreatedAt.UnixNano(), last.ID)),
		)
	}
	return entries, nextCursor, nil
}

// DailySpendRemaining returns how many sats the agent can still spend today.
func (s *PGStore) DailySpendRemaining(ctx context.Context, agentID string, tier int) (int64, error) {
	now := time.Now().UTC()
	todayMidnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	var dailySpent int64
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ABS(amount_sats)), 0)
		FROM credit_ledger WHERE agent_id = $1 AND tx_type = 'debit' AND created_at >= $2
	`, agentID, todayMidnight).Scan(&dailySpent)
	if err != nil {
		return 0, fmt.Errorf("query daily spend: %w", err)
	}

	cap := DailySpendCapForTier(tier)
	remaining := cap - dailySpent
	if remaining < 0 {
		remaining = 0
	}
	return remaining, nil
}

// CheckFaucetCap returns true if the grant would stay within the daily faucet cap.
func (s *PGStore) CheckFaucetCap(ctx context.Context, grantAmount int64) (bool, error) {
	now := time.Now().UTC()
	todayMidnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	var totalGranted int64
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_sats), 0)
		FROM credit_ledger WHERE tx_type = 'faucet_grant' AND created_at >= $1
	`, todayMidnight).Scan(&totalGranted)
	if err != nil {
		return false, fmt.Errorf("query faucet cap: %w", err)
	}
	return totalGranted+grantAmount <= s.FaucetDailyCapSats, nil
}

// ListAgents returns a paginated list of agents with optional search and sorting.
func (s *PGStore) ListAgents(ctx context.Context, search string, sortBy string, sortDir string, offset, limit int) ([]AgentListEntry, int, error) {
	// Validate sortBy against allowlist
	allowedSorts := map[string]string{
		"name":        "a.name",
		"tier":        "a.tier",
		"balance":     "balance_sats",
		"status":      "a.status",
		"created_at":  "a.created_at",
		"last_active": "last_active",
	}
	col, ok := allowedSorts[sortBy]
	if !ok {
		col = "a.created_at"
	}
	if sortDir != "asc" && sortDir != "desc" {
		sortDir = "desc"
	}

	baseQuery := `
		FROM agents a
		LEFT JOIN LATERAL (
			SELECT COALESCE(SUM(cl.amount_sats), 0) AS balance_sats,
			       MAX(cl.created_at) AS last_active
			FROM credit_ledger cl WHERE cl.agent_id = a.id
		) cl ON true
	`
	var whereClause string
	var args []any
	argIdx := 1
	if search != "" {
		whereClause = fmt.Sprintf(" WHERE a.name ILIKE $%d", argIdx)
		args = append(args, "%"+search+"%")
		argIdx++
	}

	// Count total
	var total int
	countQuery := "SELECT COUNT(*)" + baseQuery + whereClause
	err := s.pool.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count agents: %w", err)
	}

	// Fetch page
	selectQuery := fmt.Sprintf(`
		SELECT a.id, a.name, a.tier, cl.balance_sats, a.status, cl.last_active, a.created_at
		%s%s ORDER BY %s %s LIMIT $%d OFFSET $%d
	`, baseQuery, whereClause, col, sortDir, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list agents: %w", err)
	}
	defer rows.Close()

	var agents []AgentListEntry
	for rows.Next() {
		var e AgentListEntry
		if err := rows.Scan(&e.ID, &e.Name, &e.Tier, &e.BalanceSats, &e.Status, &e.LastActive, &e.CreatedAt); err != nil {
			return nil, 0, fmt.Errorf("scan agent: %w", err)
		}
		agents = append(agents, e)
	}
	return agents, total, nil
}

// ListAllChannelGrants returns a paginated list of channel grants with agent names and optional status filter.
func (s *PGStore) ListAllChannelGrants(ctx context.Context, status string, sortBy string, sortDir string, offset, limit int) ([]ChannelGrantEntry, int, error) {
	// Validate sortBy against allowlist
	allowedSorts := map[string]string{
		"created_at":       "fc.created_at",
		"status":           "fc.status",
		"channel_size_sats": "fc.channel_size",
		"push_amount_sats": "fc.push_amount",
		"banned":           "fc.banned",
		"agent_name":       "a.name",
	}
	col, ok := allowedSorts[sortBy]
	if !ok {
		col = "fc.created_at"
	}
	if sortDir != "asc" && sortDir != "desc" {
		sortDir = "desc"
	}

	baseFrom := ` FROM faucet_channels fc JOIN agents a ON a.id = fc.agent_id`
	var whereClause string
	var args []any
	argIdx := 1

	if status != "" {
		whereClause = fmt.Sprintf(" WHERE fc.status = $%d", argIdx)
		args = append(args, status)
		argIdx++
	}

	// Count total
	var total int
	countQuery := "SELECT COUNT(*)" + baseFrom + whereClause
	err := s.pool.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count channel grants: %w", err)
	}

	// Fetch page
	selectQuery := fmt.Sprintf(`
		SELECT fc.id, fc.agent_id, fc.pubkey, fc.node_uri, fc.status,
		       COALESCE(fc.funding_txid, ''), fc.output_index,
		       fc.channel_size, fc.push_amount, COALESCE(fc.fail_reason, ''),
		       fc.banned, fc.banned_until, fc.created_at, fc.opened_at, fc.closed_at, COALESCE(fc.closed_reason, ''),
		       fc.funding_fee_rate_sat_vb, fc.channel_point,
		       a.name
		%s%s ORDER BY %s %s LIMIT $%d OFFSET $%d
	`, baseFrom, whereClause, col, sortDir, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list channel grants: %w", err)
	}
	defer rows.Close()

	var entries []ChannelGrantEntry
	for rows.Next() {
		var e ChannelGrantEntry
		if err := rows.Scan(
			&e.ID, &e.AgentID, &e.Pubkey, &e.NodeURI, &e.Status,
			&e.FundingTxID, &e.OutputIndex,
			&e.ChannelSize, &e.PushAmount, &e.FailReason,
			&e.Banned, &e.BannedUntil, &e.CreatedAt, &e.OpenedAt, &e.ClosedAt, &e.ClosedReason,
			&e.FundingFeeRateSatVB, &e.ChannelPoint,
			&e.AgentName,
		); err != nil {
			return nil, 0, fmt.Errorf("scan channel grant: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, total, nil
}

// AggregateMetrics returns aggregate dashboard statistics including channel metrics.
func (s *PGStore) AggregateMetrics(ctx context.Context) (*AdminMetrics, error) {
	var m AdminMetrics
	err := s.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM agents),
			(SELECT COALESCE(SUM(amount_sats), 0) FROM credit_ledger WHERE tx_type IN ('faucet_grant', 'admin_grant')),
			(SELECT COUNT(*) FROM credit_ledger WHERE tx_type = 'debit'),
			(SELECT COALESCE(SUM(amount_sats), 0) FROM credit_ledger WHERE tx_type = 'faucet_grant' AND created_at >= DATE_TRUNC('day', NOW())),
			(SELECT COUNT(*) FROM faucet_channels WHERE status != 'failed'),
			(SELECT COUNT(*) FROM faucet_channels WHERE status = 'open'),
			(SELECT COALESCE(SUM(push_amount), 0) FROM faucet_channels WHERE status != 'failed'),
			$1 - (SELECT COUNT(*) FROM faucet_channels WHERE status != 'failed')
	`, s.FaucetChannelCap).Scan(
		&m.TotalAgents, &m.TotalCreditsGranted, &m.TotalL402Calls, &m.DailyFaucetSpend,
		&m.TotalChannelsOpened, &m.ActiveChannels, &m.TotalSatsPushed, &m.FaucetSlotsRemaining,
	)
	if err != nil {
		return nil, fmt.Errorf("aggregate metrics: %w", err)
	}
	return &m, nil
}

// TimeSeriesMetrics returns hourly bucketed metrics with zero-fill for the given range.
func (s *PGStore) TimeSeriesMetrics(ctx context.Context, rangeHours int) ([]TimePoint, error) {
	rows, err := s.pool.Query(ctx, `
		WITH buckets AS (
			SELECT generate_series(
				DATE_TRUNC('hour', NOW() - INTERVAL '1 hour' * $1),
				DATE_TRUNC('hour', NOW()),
				'1 hour'::interval
			) AS bucket
		)
		SELECT b.bucket,
		       COALESCE(SUM(CASE WHEN cl.tx_type IN ('faucet_grant', 'admin_grant') THEN cl.amount_sats ELSE 0 END), 0),
		       COALESCE(COUNT(CASE WHEN cl.tx_type = 'debit' THEN 1 END), 0)
		FROM buckets b
		LEFT JOIN credit_ledger cl ON DATE_TRUNC('hour', cl.created_at) = b.bucket
		GROUP BY b.bucket ORDER BY b.bucket
	`, rangeHours)
	if err != nil {
		return nil, fmt.Errorf("time series metrics: %w", err)
	}
	defer rows.Close()

	var points []TimePoint
	for rows.Next() {
		var p TimePoint
		if err := rows.Scan(&p.Bucket, &p.CreditsGranted, &p.L402Calls); err != nil {
			return nil, fmt.Errorf("scan time point: %w", err)
		}
		points = append(points, p)
	}
	return points, nil
}

// GrantCredits inserts an admin grant into the credit ledger for the given agent.
func (s *PGStore) GrantCredits(ctx context.Context, agentID string, amountSats int64, reason string) error {
	// Verify agent exists
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM agents WHERE id = $1)`, agentID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("check agent: %w", err)
	}
	if !exists {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO credit_ledger (agent_id, amount_sats, tx_type, description, status)
		VALUES ($1, $2, 'admin_grant', $3, 'settled')
	`, agentID, amountSats, reason)
	if err != nil {
		return fmt.Errorf("insert admin grant: %w", err)
	}
	return nil
}

// SuspendAgent sets the agent's status to suspended.
func (s *PGStore) SuspendAgent(ctx context.Context, agentID string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE agents SET status = 'suspended', suspended_at = NOW()
		WHERE id = $1 AND status = 'active'
	`, agentID)
	if err != nil {
		return fmt.Errorf("suspend agent: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("agent not found or already suspended: %s", agentID)
	}
	return nil
}

// UnsuspendAgent sets the agent's status back to active.
func (s *PGStore) UnsuspendAgent(ctx context.Context, agentID string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE agents SET status = 'active', suspended_at = NULL
		WHERE id = $1 AND status = 'suspended'
	`, agentID)
	if err != nil {
		return fmt.Errorf("unsuspend agent: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("agent not found or not suspended: %s", agentID)
	}
	return nil
}

// Close shuts down the connection pool.
func (s *PGStore) Close() {
	s.pool.Close()
}

// fnvHash returns an int64 FNV-1a hash of the given string, suitable for pg_advisory_xact_lock.
func fnvHash(s string) int64 {
	h := fnv.New64a()
	h.Write([]byte(s))
	return int64(h.Sum64())
}

// ReserveCredits atomically reserves credits for a proxy call using advisory lock + idempotency.
func (s *PGStore) ReserveCredits(ctx context.Context, req ReserveRequest) (*ReserveResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Advisory lock per agent to serialize concurrent reserves
	_, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, fnvHash(req.AgentID))
	if err != nil {
		return nil, fmt.Errorf("advisory lock: %w", err)
	}

	// Check idempotency
	var statusCode int
	var responseBody string
	err = tx.QueryRow(ctx, `
		SELECT status_code, response_body FROM proxy_idempotency
		WHERE idempotency_key = $1 AND endpoint = $2 AND agent_id = $3
	`, req.IdempotencyKey, req.Endpoint, req.AgentID).Scan(&statusCode, &responseBody)
	if err == nil {
		if statusCode > 0 {
			// Cached response available
			if commitErr := tx.Commit(ctx); commitErr != nil {
				return nil, fmt.Errorf("commit after cache hit: %w", commitErr)
			}
			return &ReserveResult{Cached: &CachedResponse{StatusCode: statusCode, ResponseBody: responseBody}}, nil
		}
		// In-flight reserve exists for this key
		return nil, fmt.Errorf("reserve already in-flight for idempotency key %s", req.IdempotencyKey)
	}
	if err != pgx.ErrNoRows {
		return nil, fmt.Errorf("check idempotency: %w", err)
	}

	// Check available balance
	var balance int64
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_sats), 0) FROM credit_ledger WHERE agent_id = $1
	`, req.AgentID).Scan(&balance)
	if err != nil {
		return nil, fmt.Errorf("check balance: %w", err)
	}
	if balance < req.AmountSats {
		return nil, ErrInsufficientCredits
	}

	// Insert reserve entry
	reserveID := uuid.New().String()
	_, err = tx.Exec(ctx, `
		INSERT INTO credit_ledger (id, agent_id, amount_sats, tx_type, description, status)
		VALUES ($1, $2, $3, 'reserve', $4, 'pending')
	`, reserveID, req.AgentID, -req.AmountSats, "Proxy: "+req.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("insert reserve: %w", err)
	}

	// Insert pending idempotency record
	_, err = tx.Exec(ctx, `
		INSERT INTO proxy_idempotency (idempotency_key, endpoint, agent_id, reserve_id, status_code, response_body, created_at)
		VALUES ($1, $2, $3, $4, 0, '', NOW())
	`, req.IdempotencyKey, req.Endpoint, req.AgentID, reserveID)
	if err != nil {
		return nil, fmt.Errorf("insert idempotency: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit reserve: %w", err)
	}
	return &ReserveResult{ReserveID: reserveID}, nil
}

// SettleReserve converts a pending reserve to a settled debit and caches the response.
func (s *PGStore) SettleReserve(ctx context.Context, reserveID, idempotencyKey, endpoint string, statusCode int, responseBody string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Delete reserve and get its details
	var agentID string
	var amount int64
	var desc string
	err = tx.QueryRow(ctx, `
		DELETE FROM credit_ledger WHERE id = $1 AND tx_type = 'reserve'
		RETURNING agent_id, ABS(amount_sats), description
	`, reserveID).Scan(&agentID, &amount, &desc)
	if err != nil {
		return fmt.Errorf("delete reserve: %w", err)
	}

	// Insert settled debit
	_, err = tx.Exec(ctx, `
		INSERT INTO credit_ledger (agent_id, amount_sats, tx_type, description, status)
		VALUES ($1, $2, 'debit', $3, 'settled')
	`, agentID, -amount, desc)
	if err != nil {
		return fmt.Errorf("insert debit: %w", err)
	}

	// Update idempotency cache with response
	_, err = tx.Exec(ctx, `
		UPDATE proxy_idempotency SET status_code = $1, response_body = $2
		WHERE idempotency_key = $3 AND endpoint = $4
	`, statusCode, responseBody, idempotencyKey, endpoint)
	if err != nil {
		return fmt.Errorf("update idempotency: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit settle: %w", err)
	}
	return nil
}

// RefundReserve deletes a pending reserve, restoring credits, and removes the idempotency record.
func (s *PGStore) RefundReserve(ctx context.Context, reserveID, idempotencyKey, endpoint string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `DELETE FROM credit_ledger WHERE id = $1 AND tx_type = 'reserve'`, reserveID)
	if err != nil {
		return fmt.Errorf("delete reserve: %w", err)
	}

	_, err = tx.Exec(ctx, `DELETE FROM proxy_idempotency WHERE idempotency_key = $1 AND endpoint = $2`, idempotencyKey, endpoint)
	if err != nil {
		return fmt.Errorf("delete idempotency: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit refund: %w", err)
	}
	return nil
}

// CleanupOrphanedReserves removes stale reserves and their idempotency records.
func (s *PGStore) CleanupOrphanedReserves(ctx context.Context, maxAge time.Duration) (int64, error) {
	cutoff := time.Now().Add(-maxAge)

	tag, err := s.pool.Exec(ctx, `
		DELETE FROM credit_ledger WHERE tx_type = 'reserve' AND created_at < $1
	`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("cleanup reserves: %w", err)
	}

	_, err = s.pool.Exec(ctx, `
		DELETE FROM proxy_idempotency WHERE status_code = 0 AND created_at < $1
	`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("cleanup idempotency: %w", err)
	}

	return tag.RowsAffected(), nil
}

// ReserveChannelSlot atomically reserves a channel faucet slot with advisory lock cap enforcement.
func (s *PGStore) ReserveChannelSlot(ctx context.Context, agentID, pubkey, nodeURI string, channelSize, pushAmount int64) (string, error) {
	// Phase 21: faucet pause check. When the pause flag file exists,
	// reject the reservation before taking any DB locks so an operator's
	// `touch /var/lib/lnd-gateway/faucet-paused` takes effect instantly
	// without needing any DB mutation or service restart.
	if s.FaucetPauseFilePath != "" {
		if _, statErr := os.Stat(s.FaucetPauseFilePath); statErr == nil {
			return "", ErrFaucetPaused
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Advisory lock for cap enforcement
	_, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, channelCapLockKey)
	if err != nil {
		return "", fmt.Errorf("advisory lock: %w", err)
	}

	// Check cap
	var count int
	err = tx.QueryRow(ctx, `SELECT COUNT(*) FROM faucet_channels WHERE status != 'failed'`).Scan(&count)
	if err != nil {
		return "", fmt.Errorf("count channels: %w", err)
	}
	if count >= s.FaucetChannelCap {
		return "", ErrFaucetChannelCap
	}

	// Check preemptive operator-issued ban (Phase 21.1, pubkey_bans
	// table). Covers pubkeys that have no existing faucet_channels
	// grant — i.e. operator bans a known-bad pubkey before they ever
	// call /register. The dedicated table is authoritative for bans
	// issued via /v1/internal/admin/channel/ban.
	var preempBanned bool
	err = tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM pubkey_bans
			WHERE pubkey = $1
			  AND (permanent = TRUE OR (banned_until IS NOT NULL AND banned_until > NOW()))
		)
	`, pubkey).Scan(&preempBanned)
	if err != nil {
		return "", fmt.Errorf("check pubkey_bans: %w", err)
	}
	if preempBanned {
		return "", ErrPubkeyBanned
	}

	// Check legacy / auto-ban on the grant row. A pubkey is banned if
	// either the permanent banned flag is set OR the time-limited
	// banned_until timestamp is in the future. Phase 21 (2026-04-22)
	// added the banned_until branch; the 3-failure auto-ban path
	// (UpdateChannelStatus) writes banned = TRUE here.
	var banned bool
	err = tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM faucet_channels
			WHERE pubkey = $1
			  AND (banned = TRUE OR (banned_until IS NOT NULL AND banned_until > NOW()))
		)
	`, pubkey).Scan(&banned)
	if err != nil {
		return "", fmt.Errorf("check ban: %w", err)
	}
	if banned {
		return "", ErrPubkeyBanned
	}

	// Insert grant
	grantID := uuid.New().String()
	_, err = tx.Exec(ctx, `
		INSERT INTO faucet_channels (id, agent_id, pubkey, node_uri, status, channel_size, push_amount)
		VALUES ($1, $2, $3, $4, 'pending', $5, $6)
	`, grantID, agentID, pubkey, nodeURI, channelSize, pushAmount)
	if err != nil {
		return "", fmt.Errorf("insert channel grant: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}
	return grantID, nil
}

// UpdateChannelStatus updates the status and related fields of a channel grant.
//
// "failed" path (2026-04-22 change): instead of banning the pubkey on the
// first failure, count the total 'failed' grants for this pubkey and only
// set banned=TRUE once the count reaches FaucetBanAfterFailures (3). This
// makes transient issues (firewall propagation, ConnectPeer retry races)
// self-recoverable rather than requiring operator unban.
func (s *PGStore) UpdateChannelStatus(ctx context.Context, grantID, status, fundingTxID, failReason string, outputIndex int) error {
	var err error
	switch status {
	case "failed":
		tx, beginErr := s.pool.Begin(ctx)
		if beginErr != nil {
			return fmt.Errorf("begin failure-update tx: %w", beginErr)
		}
		defer tx.Rollback(ctx)

		// Step 1: mark this grant failed and fetch its pubkey in one round trip.
		var pubkey string
		err = tx.QueryRow(ctx, `
			UPDATE faucet_channels
			SET status = 'failed', fail_reason = $1
			WHERE id = $2
			RETURNING pubkey
		`, failReason, grantID).Scan(&pubkey)
		if err != nil {
			return fmt.Errorf("mark grant failed: %w", err)
		}

		// Step 2: count total 'failed' grants for this pubkey. Includes the
		// row we just updated (same transaction snapshot).
		var failedCount int
		err = tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM faucet_channels
			WHERE pubkey = $1 AND status = 'failed'
		`, pubkey).Scan(&failedCount)
		if err != nil {
			return fmt.Errorf("count pubkey failures: %w", err)
		}

		// Step 3: if threshold reached, ban all grants for this pubkey.
		// Future channel-slot reservations will see banned=TRUE and be
		// rejected with ErrPubkeyBanned.
		if failedCount >= FaucetBanAfterFailures {
			_, err = tx.Exec(ctx, `
				UPDATE faucet_channels SET banned = TRUE WHERE pubkey = $1
			`, pubkey)
			if err != nil {
				return fmt.Errorf("ban pubkey after %d failures: %w", failedCount, err)
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit failure-update: %w", err)
		}
		return nil
	case "pending_open":
		_, err = s.pool.Exec(ctx, `
			UPDATE faucet_channels SET status = $1, funding_txid = $2, output_index = $3 WHERE id = $4
		`, status, fundingTxID, outputIndex, grantID)
	case "open":
		_, err = s.pool.Exec(ctx, `
			UPDATE faucet_channels SET status = $1, opened_at = NOW() WHERE id = $2
		`, status, grantID)
	case "closed":
		_, err = s.pool.Exec(ctx, `
			UPDATE faucet_channels SET status = $1, closed_at = NOW(), closed_reason = $2 WHERE id = $3
		`, status, failReason, grantID)
	default:
		_, err = s.pool.Exec(ctx, `
			UPDATE faucet_channels SET status = $1 WHERE id = $2
		`, status, grantID)
	}
	if err != nil {
		return fmt.Errorf("update channel status: %w", err)
	}
	return nil
}

// GetChannelGrant returns the most recent channel grant for an agent.
func (s *PGStore) GetChannelGrant(ctx context.Context, agentID string) (*ChannelGrant, error) {
	var g ChannelGrant
	err := s.pool.QueryRow(ctx, `
		SELECT id, agent_id, pubkey, node_uri, status, COALESCE(funding_txid, ''), output_index,
		       channel_size, push_amount, COALESCE(fail_reason, ''), banned, banned_until, created_at, opened_at, closed_at, COALESCE(closed_reason, ''),
		       funding_fee_rate_sat_vb, channel_point
		FROM faucet_channels WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1
	`, agentID).Scan(
		&g.ID, &g.AgentID, &g.Pubkey, &g.NodeURI, &g.Status, &g.FundingTxID, &g.OutputIndex,
		&g.ChannelSize, &g.PushAmount, &g.FailReason, &g.Banned, &g.BannedUntil, &g.CreatedAt, &g.OpenedAt, &g.ClosedAt, &g.ClosedReason,
		&g.FundingFeeRateSatVB, &g.ChannelPoint,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get channel grant: %w", err)
	}
	return &g, nil
}

// GetChannelGrantByID returns a channel grant by its ID.
func (s *PGStore) GetChannelGrantByID(ctx context.Context, grantID string) (*ChannelGrant, error) {
	var g ChannelGrant
	err := s.pool.QueryRow(ctx, `
		SELECT id, agent_id, pubkey, node_uri, status, COALESCE(funding_txid, ''), output_index,
		       channel_size, push_amount, COALESCE(fail_reason, ''), banned, banned_until, created_at, opened_at, closed_at, COALESCE(closed_reason, ''),
		       funding_fee_rate_sat_vb, channel_point
		FROM faucet_channels WHERE id = $1
	`, grantID).Scan(
		&g.ID, &g.AgentID, &g.Pubkey, &g.NodeURI, &g.Status, &g.FundingTxID, &g.OutputIndex,
		&g.ChannelSize, &g.PushAmount, &g.FailReason, &g.Banned, &g.BannedUntil, &g.CreatedAt, &g.OpenedAt, &g.ClosedAt, &g.ClosedReason,
		&g.FundingFeeRateSatVB, &g.ChannelPoint,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get channel grant by ID: %w", err)
	}
	return &g, nil
}

// ListPendingChannels returns all channel grants with pending or pending_open status.
func (s *PGStore) ListPendingChannels(ctx context.Context) ([]ChannelGrant, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, agent_id, pubkey, node_uri, status, COALESCE(funding_txid, ''), output_index,
		       channel_size, push_amount, COALESCE(fail_reason, ''), banned, banned_until, created_at, opened_at, closed_at, COALESCE(closed_reason, ''),
		       funding_fee_rate_sat_vb, channel_point
		FROM faucet_channels WHERE status IN ('pending', 'pending_open')
	`)
	if err != nil {
		return nil, fmt.Errorf("list pending channels: %w", err)
	}
	defer rows.Close()

	var grants []ChannelGrant
	for rows.Next() {
		var g ChannelGrant
		if err := rows.Scan(
			&g.ID, &g.AgentID, &g.Pubkey, &g.NodeURI, &g.Status, &g.FundingTxID, &g.OutputIndex,
			&g.ChannelSize, &g.PushAmount, &g.FailReason, &g.Banned, &g.BannedUntil, &g.CreatedAt, &g.OpenedAt, &g.ClosedAt, &g.ClosedReason,
			&g.FundingFeeRateSatVB, &g.ChannelPoint,
		); err != nil {
			return nil, fmt.Errorf("scan pending channel: %w", err)
		}
		grants = append(grants, g)
	}
	return grants, nil
}

// SetChannelFundingFeeRate persists the sat/vB used for the OpenChannel
// funding tx onto the grant row. Called from openChannelAsync right after
// OpenChannel returns a funding_txid. No-op for satVB <= 0 (defensive:
// keeps the column NULL when the estimator is disabled rather than
// recording a nonsensical "0 sat/vB" value).
//
// Phase 22 REN-04 populator — Plan 22-03's CAS UPDATE then propagates
// this column into the /v1/internal/channel/status response.
func (s *PGStore) SetChannelFundingFeeRate(ctx context.Context, grantID string, satVB int64) error {
	if satVB <= 0 {
		return nil
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE faucet_channels SET funding_fee_rate_sat_vb = $1 WHERE id = $2
	`, satVB, grantID)
	if err != nil {
		return fmt.Errorf("set funding_fee_rate_sat_vb: %w", err)
	}
	return nil
}

// UpdateChannelStatusCAS atomically transitions a grant from expectedStatus
// to newStatus only if the row's current status still matches expectedStatus.
// Returns (true, nil) when the UPDATE matched; (false, nil) when another
// writer (poller / concurrent request) already transitioned the row.
// Callers that see (false, nil) must re-read via GetChannelGrant to observe
// the authoritative current state.
//
// This is the Phase 22 D-01 CAS. Backing store is PostgreSQL — the
// single-statement UPDATE with a RowsAffected check replaces what D-01
// described as "SQLite BEGIN IMMEDIATE". No explicit transaction needed;
// Postgres row-level locks during UPDATE plus the authoritative WHERE
// status = expectedStatus predicate give exactly-one-winner semantics.
//
// channelPoint is written unconditionally on a match. fundingFeeRateSatVB
// is written only when non-nil (nil preserves the existing value). When
// newStatus is "open" or "closed", opened_at / closed_at are set to NOW()
// so the grant's lifecycle timestamps stay consistent with the status
// column.
//
// FM-1 mitigation (poller + inline-handler race): both writers go through
// this single CAS method so neither can clobber the other's channel_point
// or funding_fee_rate_sat_vb value.
func (s *PGStore) UpdateChannelStatusCAS(
	ctx context.Context,
	grantID, expectedStatus, newStatus, channelPoint string,
	fundingFeeRateSatVB *int64,
) (bool, error) {
	// Pick the right UPDATE shape based on (a) whether we also need to
	// write funding_fee_rate_sat_vb and (b) which timestamp to stamp
	// (opened_at vs closed_at). The WHERE clause is identical across all
	// branches — it's the authoritative CAS gate.
	var (
		result interface{ RowsAffected() int64 }
		err    error
	)
	switch {
	case newStatus == "open" && fundingFeeRateSatVB != nil:
		result, err = s.pool.Exec(ctx, `
			UPDATE faucet_channels
			SET status = $3, channel_point = $4, funding_fee_rate_sat_vb = $5, opened_at = NOW()
			WHERE id = $1 AND status = $2
		`, grantID, expectedStatus, newStatus, channelPoint, *fundingFeeRateSatVB)
	case newStatus == "open":
		result, err = s.pool.Exec(ctx, `
			UPDATE faucet_channels
			SET status = $3, channel_point = $4, opened_at = NOW()
			WHERE id = $1 AND status = $2
		`, grantID, expectedStatus, newStatus, channelPoint)
	case newStatus == "closed" && fundingFeeRateSatVB != nil:
		result, err = s.pool.Exec(ctx, `
			UPDATE faucet_channels
			SET status = $3, channel_point = $4, funding_fee_rate_sat_vb = $5, closed_at = NOW()
			WHERE id = $1 AND status = $2
		`, grantID, expectedStatus, newStatus, channelPoint, *fundingFeeRateSatVB)
	case newStatus == "closed":
		result, err = s.pool.Exec(ctx, `
			UPDATE faucet_channels
			SET status = $3, channel_point = $4, closed_at = NOW()
			WHERE id = $1 AND status = $2
		`, grantID, expectedStatus, newStatus, channelPoint)
	default:
		// Generic transition (no lifecycle timestamp). Covers future
		// status values (e.g. explicit "pending" resets) without forcing
		// the caller through a new API.
		if fundingFeeRateSatVB != nil {
			result, err = s.pool.Exec(ctx, `
				UPDATE faucet_channels
				SET status = $3, channel_point = $4, funding_fee_rate_sat_vb = $5
				WHERE id = $1 AND status = $2
			`, grantID, expectedStatus, newStatus, channelPoint, *fundingFeeRateSatVB)
		} else {
			result, err = s.pool.Exec(ctx, `
				UPDATE faucet_channels
				SET status = $3, channel_point = $4
				WHERE id = $1 AND status = $2
			`, grantID, expectedStatus, newStatus, channelPoint)
		}
	}
	if err != nil {
		return false, fmt.Errorf("cas update channel status: %w", err)
	}
	return result.RowsAffected() > 0, nil
}

// ClearPubkeyBan clears the banned flag for all grants matching the given pubkey.
// Also clears any time-limited ban (banned_until) for completeness, so unban
// is a true "remove all ban state for this pubkey" operation.
func (s *PGStore) ClearPubkeyBan(ctx context.Context, pubkey string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin clear ban tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Phase 21.1: delete from pubkey_bans (operator-issued bans)
	if _, err := tx.Exec(ctx, `DELETE FROM pubkey_bans WHERE pubkey = $1`, pubkey); err != nil {
		return fmt.Errorf("delete pubkey_bans: %w", err)
	}

	// Existing path: clear legacy bans on faucet_channels rows (3-failure auto-bans)
	if _, err := tx.Exec(ctx, `
		UPDATE faucet_channels
		SET banned = FALSE, banned_until = NULL
		WHERE pubkey = $1 AND (banned = TRUE OR banned_until IS NOT NULL)
	`, pubkey); err != nil {
		return fmt.Errorf("clear faucet_channels ban: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit clear ban: %w", err)
	}
	return nil
}

// BanPubkeyUntil upserts an operator-issued ban into the dedicated
// pubkey_bans table. Added 2026-04-22 (Phase 21, extended 21.1 same
// day). Semantics:
//   - until == nil: permanent ban. permanent = TRUE, banned_until NULL.
//   - until != nil: time-limited ban. permanent = FALSE, banned_until
//     = *until. ReserveChannelSlot's pubkey_bans check treats
//     banned_until > NOW() as an active ban and auto-expires it
//     otherwise.
//
// Works on ANY pubkey, whether it has a faucet_channels grant or not.
// This is the key difference from the original Phase 21 implementation,
// which UPDATEd faucet_channels and silently no-opped on net-new
// pubkeys. The 3-failure auto-ban path still writes banned = TRUE onto
// the failing grant row; ReserveChannelSlot checks both sources so
// legacy + preemptive bans co-exist.
func (s *PGStore) BanPubkeyUntil(ctx context.Context, pubkey string, until *time.Time) error {
	permanent := until == nil
	_, err := s.pool.Exec(ctx, `
		INSERT INTO pubkey_bans (pubkey, banned_until, permanent, banned_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (pubkey) DO UPDATE SET
			banned_until = EXCLUDED.banned_until,
			permanent = EXCLUDED.permanent,
			banned_at = NOW()
	`, pubkey, until, permanent)
	if err != nil {
		return fmt.Errorf("upsert pubkey_bans: %w", err)
	}
	return nil
}

// ResetIPRateLimit backdates recent agents from this IP address so the
// registration rate-limit counter (COUNT(*) WHERE ip_address = ? AND
// created_at > NOW() - INTERVAL '1 hour') no longer sees them. Returns
// the number of rows affected. The accompanying api_keys + agent rows
// remain valid; only the timestamp is shifted so the counter clears.
//
// Intended for operator-assisted recovery when iterative testing or a
// stuck agent has exhausted the 3/hr registration cap. Replaces the
// manual SQL recipe that operators had to run during the 2026-04-21 UAT.
func (s *PGStore) ResetIPRateLimit(ctx context.Context, ipAddr string) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE agents
		SET created_at = created_at - INTERVAL '2 hours'
		WHERE ip_address = $1 AND created_at > NOW() - INTERVAL '1 hour'
	`, ipAddr)
	if err != nil {
		return 0, fmt.Errorf("reset ip rate limit: %w", err)
	}
	return tag.RowsAffected(), nil
}

// Ensure PGStore implements AccountStore at compile time.
var _ AccountStore = (*PGStore)(nil)
