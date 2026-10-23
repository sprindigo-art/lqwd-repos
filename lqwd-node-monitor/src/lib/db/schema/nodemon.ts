import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  timestamp,
  boolean,
  numeric,
  bigint,
  integer,
  index,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// =====================================================
// nodemon (local) — read-write queue schema
// =====================================================
// The ONLY Drizzle-owned (generate/migrate) schema (D-08). These three queue
// tables (commands / executions / audit) back the entire Phase 6 command-queue
// + approval flow and every downstream plan (signer, enqueue, claim, UI).
//
// State machine (RESEARCH §Pattern 4):
//   draft → pending_approval → approved → claimed → executing → succeeded | failed
//   terminal: rejected (from pending_approval),
//             expired (TTL fail-closed from any non-terminal pre-execution state)
//
// HMAC contract (CLAUDE.md §4 / D-12): the signed command id is generated
// app-side BEFORE insert (RESEARCH Pitfall 2 — NO defaultRandom on commands.id);
// the EXACT canonical signed string is stored VERBATIM in canonical_payload and
// the lowercase hex digest in signature_hex. The per-node secret lives ONLY in
// server env (NODEMON_HMAC_SECRET_<pubkey>) — there is NO secret column here
// (T-06-01): storing it would hand the key to the tampered-row threat HMAC
// defends against.
//
// Column names are snake_case in the DB ↔ camelCase TS fields per routing.ts.

// State pgEnum — EXACTLY these 10 values in this order (RESEARCH §Pattern 4).
// `withdrawn` (10th) is the D-01 operator-undo terminal (approved → withdrawn ONLY);
// the runtime enum is altered on the live nodemon DB via drizzle/nodemon/0002_*.sql.
export const commandState = pgEnum("command_state", [
  "draft",
  "pending_approval",
  "approved",
  "claimed",
  "executing",
  "succeeded",
  "failed",
  "rejected",
  "expired",
  "withdrawn",
]);

// -----------------------------------------------------
// commands — the signed, operator-approvable intent rows
// -----------------------------------------------------
export const commands = pgTable("commands", {
  // App-supplied UUID — signed BEFORE insert (RESEARCH Pitfall 2). NO defaultRandom().
  id: uuid("id").primaryKey(),
  nodePubkey: text("node_pubkey").notNull(),
  actionType: text("action_type").notNull(),
  // Frozen update_fee param object (src/lib/insight/schema.ts) — flat, canonicalizable.
  params: jsonb("params").notNull(),
  // The EXACT canonical signed string, stored VERBATIM (CLAUDE.md §4 — never re-serialized).
  canonicalPayload: text("canonical_payload").notNull(),
  // Lowercase hex HMAC-SHA256 digest of canonical_payload.
  signatureHex: text("signature_hex").notNull(),
  state: commandState("state").notNull().default("pending_approval"),
  // TTL — enqueue + NODEMON_TTL_HOURS (D-11). Reaper fail-closes past this (RESEARCH Pitfall 4).
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------
// command_executions — node-side execution outcomes written back per command
// -----------------------------------------------------
export const commandExecutions = pgTable("command_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  commandId: uuid("command_id")
    .notNull()
    .references(() => commands.id),
  outcome: text("outcome").notNull(), // "succeeded" | "failed"
  detail: text("detail"),
  executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow(),
});

// -----------------------------------------------------
// command_audit — append-only transition log (D-08, A5: no UPDATE/DELETE in app code)
// -----------------------------------------------------
export const commandAudit = pgTable("command_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  commandId: uuid("command_id").notNull(),
  fromState: text("from_state"), // NULL on initial enqueue
  toState: text("to_state").notNull(),
  actor: text("actor").notNull(), // "operator" | "executor"
  reason: text("reason"), // D-07 reject reason (nullable)
  staleAcknowledged: boolean("stale_acknowledged").default(false), // D-10
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

// =====================================================
// Phase 11 — full-stack telemetry read model (TEL-01/02/03)
// =====================================================
// Two dimension tables (low-churn, declared) + four append-history fact tables.
// Every fact row carries `collected_at` so staleness is DERIVED at read time
// (D-13) — we store RAW observed values ONLY (D-14): no blocks_behind, no
// severity, no stale flag lives here. Fact-table ids DO use defaultRandom():
// telemetry has NO HMAC (D-11), unlike commands.id (signed before insert).
// RLS / role-grants / seed rows are hand-authored psql artifacts (Plan 02,
// db/role-grants.sql + db/seed-dimensions.sql), NOT Drizzle-migrated.
//
// AFM-001 access pattern: the dominant read is DISTINCT-ON latest-per-entity
// ordered by collected_at DESC — so each fact table carries a composite
// (entity_key…, collected_at DESC) index plus a plain (collected_at) index to
// keep the retention prune (DELETE WHERE collected_at < …) cheap.

// -----------------------------------------------------
// hosts — dimension: one row per VM/host (D-03: a host runs 2+ nodes)
// -----------------------------------------------------
export const hosts = pgTable("hosts", {
  hostId: text("host_id").primaryKey(),
  hostname: text("hostname"),
  nodePubkeys: text("node_pubkeys").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// -----------------------------------------------------
// service_inventory — dimension: declared services per host (D-08 expected-set)
// -----------------------------------------------------
export const serviceInventory = pgTable("service_inventory", {
  id: uuid("id").primaryKey().defaultRandom(),
  hostId: text("host_id"),
  serviceName: text("service_name"),
  // node-scoped services only; NULL for host-level services
  nodePubkey: text("node_pubkey"),
  // "systemctl" | "pgrep" | "cron-mtime" | "native"
  detectionMethod: text("detection_method"),
  // unit name | pgrep pattern | n/a
  runningTarget: text("running_target"),
  artifactPath: text("artifact_path"),
  successPattern: text("success_pattern"),
  errorPattern: text("error_pattern"),
  // per-service freshness clock (D-17, RESEARCH Pitfall 1)
  expectedIntervalSeconds: integer("expected_interval_seconds"),
  // D-08 expected-set; false = declared-but-not-graded
  isExpected: boolean("is_expected"),
});

// -----------------------------------------------------
// host_metrics — fact: per-tick VM vitals (TEL-01)
// -----------------------------------------------------
export const hostMetrics = pgTable(
  "host_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id").notNull(), // RLS axis
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(), // D-13
    cpuPct: numeric("cpu_pct"),
    load1: numeric("load_1"),
    load5: numeric("load_5"),
    load15: numeric("load_15"),
    memTotalKb: bigint("mem_total_kb", { mode: "bigint" }),
    memAvailableKb: bigint("mem_available_kb", { mode: "bigint" }),
    swapTotalKb: bigint("swap_total_kb", { mode: "bigint" }),
    swapFreeKb: bigint("swap_free_kb", { mode: "bigint" }),
    uptimeSeconds: bigint("uptime_seconds", { mode: "bigint" }),
    netRxBytes: bigint("net_rx_bytes", { mode: "bigint" }),
    netTxBytes: bigint("net_tx_bytes", { mode: "bigint" }),
  },
  (t) => [
    index("host_metrics_host_collected_idx").on(t.hostId, t.collectedAt.desc()),
    index("host_metrics_collected_idx").on(t.collectedAt),
  ],
);

// -----------------------------------------------------
// host_storage — fact: per-mount disk usage (TEL-01, 1:N per tick)
// -----------------------------------------------------
export const hostStorage = pgTable(
  "host_storage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id").notNull(), // RLS axis
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(), // D-13
    mountPoint: text("mount_point"),
    totalBytes: bigint("total_bytes", { mode: "bigint" }),
    usedBytes: bigint("used_bytes", { mode: "bigint" }),
    availBytes: bigint("avail_bytes", { mode: "bigint" }),
    // Phase 15 (COL-03, research Open-Q4): ADDITIVE nullable inode columns —
    // nullable so pre-15 collectors + the shipped host-storage reader stay green.
    inodesTotal: bigint("inodes_total", { mode: "bigint" }),
    inodesUsed: bigint("inodes_used", { mode: "bigint" }),
    inodesFree: bigint("inodes_free", { mode: "bigint" }),
  },
  (t) => [
    index("host_storage_host_mount_collected_idx").on(
      t.hostId,
      t.mountPoint,
      t.collectedAt.desc(),
    ),
    index("host_storage_collected_idx").on(t.collectedAt),
  ],
);

// -----------------------------------------------------
// service_health — fact: two-axis service grading (TEL-02)
// -----------------------------------------------------
export const serviceHealth = pgTable(
  "service_health",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id").notNull(), // RLS axis
    serviceName: text("service_name"),
    nodePubkey: text("node_pubkey"),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(), // D-13
    running: boolean("running"), // RUNNING axis
    functioning: boolean("functioning"), // FUNCTIONING axis
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastArtifactMtime: timestamp("last_artifact_mtime", { withTimezone: true }),
    errorCount: integer("error_count"),
    detail: text("detail"),
  },
  (t) => [
    index("service_health_host_service_collected_idx").on(
      t.hostId,
      t.serviceName,
      t.collectedAt.desc(),
    ),
    index("service_health_collected_idx").on(t.collectedAt),
  ],
);

// -----------------------------------------------------
// chain_telemetry — fact: bitcoind chain/mempool vitals (TEL-03)
// -----------------------------------------------------
export const chainTelemetry = pgTable(
  "chain_telemetry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id").notNull(), // RLS axis
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(), // D-13
    blocks: bigint("blocks", { mode: "bigint" }),
    headers: bigint("headers", { mode: "bigint" }),
    verificationProgress: numeric("verification_progress"),
    ibd: boolean("ibd"),
    sizeOnDiskBytes: bigint("size_on_disk_bytes", { mode: "bigint" }),
    peerCount: integer("peer_count"),
    peersIn: integer("peers_in"),
    peersOut: integer("peers_out"),
    mempoolTxCount: integer("mempool_tx_count"),
    mempoolBytes: bigint("mempool_bytes", { mode: "bigint" }),
    mempoolMinFee: numeric("mempool_min_fee"),
  },
  (t) => [
    index("chain_telemetry_host_collected_idx").on(t.hostId, t.collectedAt.desc()),
    index("chain_telemetry_collected_idx").on(t.collectedAt),
  ],
);

// =====================================================
// Phase 15 — data-collection expansion (COL-01/02/03)
// =====================================================
// Eight new tables: raw log events + pattern aggregate + pattern config
// (dimension) + deep-VM scalar fact + three per-dimension child facts +
// pg_health counters. All mirror the Phase-11 fact shape above: uuid pk
// defaultRandom (telemetry has NO HMAC, D-11), host_id RLS axis,
// collected_at (D-13), RAW observed values ONLY (D-06b/D-14 — no severity /
// band / stale column; bands + suppression are derived at READ time).
// Child facts key their composite index (host_id, <dim>, collected_at DESC)
// per the hostStorage template — NOT (host_id, collected_at) — or the
// DISTINCT-ON reader collapses N children to 1 (RESEARCH Pitfall 4).
// classification stays plain text (NOT a pgEnum) so it is SQL-tunable (D-05).
// RLS / role-grants / seed rows are hand-authored psql artifacts
// (db/role-grants.sql + db/seed-log-patterns.sql), NOT Drizzle-migrated.

// -----------------------------------------------------
// service_log_events — fact: raw matched log lines + ±5 context (COL-01, D-01)
// -----------------------------------------------------
export const serviceLogEvents = pgTable(
  "service_log_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id").notNull(), // RLS axis
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(), // D-13
    serviceName: text("service_name"),
    nodePubkey: text("node_pubkey"), // nullable — host-level services
    level: text("level"),
    message: text("message"),
    // The ±5 surrounding lines, self-contained text (D-01 — Open-Q2 option (a): no child/join).
    contextLines: text("context_lines"),
    signature: text("signature").notNull(),
    classification: text("classification"),
    // NULLABLE read-time SUPPRESSION KEY: id of the log_patterns_config row the
    // collector matched at classify time (NULL for unmatched/"other" lines). The
    // reader joins log_patterns_config on this PK so `suppress` resolves per
    // matched PATTERN, never per coarse classification — the shared `benign`
    // class holds both suppress=true BP-rows and the suppress=false SQLSTATE
    // 40001 sibling, so a classification join would invert suppression and fan
    // out rows. Raw identity pointer, NOT a severity/verdict (D-04/D-14-safe).
    configId: uuid("config_id"),
    sourcePath: text("source_path"),
  },
  (t) => [
    index("service_log_events_host_collected_idx").on(t.hostId, t.collectedAt.desc()),
    index("service_log_events_collected_idx").on(t.collectedAt),
    // Backs exemplar-per-signature retention.
    index("service_log_events_host_signature_idx").on(t.hostId, t.signature),
  ],
);

// -----------------------------------------------------
// log_patterns — aggregate: per-signature rollup, D-03 ON CONFLICT upsert target
// -----------------------------------------------------
export const logPatterns = pgTable(
  "log_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id").notNull(), // RLS axis
    signature: text("signature").notNull(),
    serviceName: text("service_name"),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    lastSeen: timestamp("last_seen", { withTimezone: true }),
    countWindow: bigint("count_window", { mode: "bigint" }),
    sampleMessage: text("sample_message"),
    classification: text("classification"),
  },
  (t) => [
    // Backs the D-03 INSERT ... ON CONFLICT (host_id, signature) DO UPDATE upsert.
    unique("log_patterns_host_signature_unique").on(t.hostId, t.signature),
    index("log_patterns_host_last_seen_idx").on(t.hostId, t.lastSeen.desc()),
  ],
);

// -----------------------------------------------------
// log_patterns_config — DIMENSION: SQL-tunable pattern set (D-05/D-11)
// Mirrors serviceInventory: no collected_at, SELECT-only to the collector role;
// seeded out-of-band by db/seed-log-patterns.sql (Obsidian BP/AP transcription).
// -----------------------------------------------------
export const logPatternsConfig = pgTable("log_patterns_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchExpression: text("match_expression"),
  service: text("service"),
  level: text("level"),
  // ∈ {info, warn, critical} — plain text, SQL-tunable (D-05). Phase-16 re-derived
  // the classification from real fleet/canary logs; the opaque ap11/ap12 codes are
  // gone (AP-11 is a read-time RATE signature; AP-12 is a pg_health COUNTER
  // detector — D-04, ap12-advisory.ts). NOT a pgEnum so it stays UPDATE-tunable.
  classification: text("classification"),
  // Human-readable label (Phase-16, COL-06) — e.g. postgres-connection-exhaustion,
  // channel-reconnect — replacing the opaque ap11/ap12 codes for the Phase-17
  // AI/incident layer. Additive NULLABLE column applied OWNER-SIDE by
  // db/seed-log-patterns.sql (ADD COLUMN IF NOT EXISTS), NEVER drizzle-kit push —
  // this is a type-surface mirror only (T-16-04).
  category: text("category"),
  // Per-ROW read-time hide flag, resolved via service_log_events.config_id join
  // (never via classification — D-04 read-time tunability).
  suppress: boolean("suppress"),
  note: text("note"),
});

// -----------------------------------------------------
// host_metrics_ext — fact: deep-VM scalar vitals (COL-03)
// -----------------------------------------------------
export const hostMetricsExt = pgTable(
  "host_metrics_ext",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id").notNull(), // RLS axis
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(), // D-13
    ctxt: bigint("ctxt", { mode: "bigint" }),
    intr: bigint("intr", { mode: "bigint" }),
    cachedKb: bigint("cached_kb", { mode: "bigint" }),
    buffersKb: bigint("buffers_kb", { mode: "bigint" }),
    dirtyKb: bigint("dirty_kb", { mode: "bigint" }),
    writebackKb: bigint("writeback_kb", { mode: "bigint" }),
    slabKb: bigint("slab_kb", { mode: "bigint" }),
    sreclaimableKb: bigint("sreclaimable_kb", { mode: "bigint" }),
    pgfault: bigint("pgfault", { mode: "bigint" }),
    pgmajfault: bigint("pgmajfault", { mode: "bigint" }),
    pswpin: bigint("pswpin", { mode: "bigint" }),
    pswpout: bigint("pswpout", { mode: "bigint" }),
    oomKill: bigint("oom_kill", { mode: "bigint" }),
    tcpRetransSegs: bigint("tcp_retrans_segs", { mode: "bigint" }),
    tcpOutSegs: bigint("tcp_out_segs", { mode: "bigint" }),
    tcpInSegs: bigint("tcp_in_segs", { mode: "bigint" }),
    tcpActiveOpens: bigint("tcp_active_opens", { mode: "bigint" }),
    tcpAttemptFails: bigint("tcp_attempt_fails", { mode: "bigint" }),
    socketsTotal: integer("sockets_total"),
    tcpEstab: integer("tcp_estab"),
    tcpTimeWait: integer("tcp_time_wait"),
    fdAllocated: bigint("fd_allocated", { mode: "bigint" }),
    fdMax: bigint("fd_max", { mode: "bigint" }),
    procsRunning: integer("procs_running"),
    procsBlocked: integer("procs_blocked"),
    failedUnitsCount: integer("failed_units_count"),
    // nullable — honest no-data if chrony absent
    clockOffsetSeconds: numeric("clock_offset_seconds"),
    nproc: integer("nproc"),
    entropyAvail: integer("entropy_avail"),
    btime: bigint("btime", { mode: "bigint" }),
  },
  (t) => [
    index("host_metrics_ext_host_collected_idx").on(t.hostId, t.collectedAt.desc()),
    index("host_metrics_ext_collected_idx").on(t.collectedAt),
  ],
);

// -----------------------------------------------------
// host_cpu_core — CHILD fact: per-core jiffies (COL-03, key = core_index)
// -----------------------------------------------------
export const hostCpuCore = pgTable(
  "host_cpu_core",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id").notNull(), // RLS axis
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(), // D-13
    coreIndex: integer("core_index"),
    userJiffies: bigint("user_jiffies", { mode: "bigint" }),
    niceJiffies: bigint("nice_jiffies", { mode: "bigint" }),
    systemJiffies: bigint("system_jiffies", { mode: "bigint" }),
    idleJiffies: bigint("idle_jiffies", { mode: "bigint" }),
    iowaitJiffies: bigint("iowait_jiffies", { mode: "bigint" }),
    irqJiffies: bigint("irq_jiffies", { mode: "bigint" }),
    softirqJiffies: bigint("softirq_jiffies", { mode: "bigint" }),
    stealJiffies: bigint("steal_jiffies", { mode: "bigint" }),
    guestJiffies: bigint("guest_jiffies", { mode: "bigint" }),
  },
  (t) => [
    index("host_cpu_core_host_core_collected_idx").on(t.hostId, t.coreIndex, t.collectedAt.desc()),
    index("host_cpu_core_collected_idx").on(t.collectedAt),
  ],
);

// -----------------------------------------------------
// host_disk_io — CHILD fact: per-device /proc/diskstats counters (key = device)
// -----------------------------------------------------
export const hostDiskIo = pgTable(
  "host_disk_io",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id").notNull(), // RLS axis
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(), // D-13
    device: text("device"),
    readsCompleted: bigint("reads_completed", { mode: "bigint" }),
    sectorsRead: bigint("sectors_read", { mode: "bigint" }),
    writesCompleted: bigint("writes_completed", { mode: "bigint" }),
    sectorsWritten: bigint("sectors_written", { mode: "bigint" }),
    iosInProgress: bigint("ios_in_progress", { mode: "bigint" }),
    msDoingIo: bigint("ms_doing_io", { mode: "bigint" }),
  },
  (t) => [
    index("host_disk_io_host_device_collected_idx").on(t.hostId, t.device, t.collectedAt.desc()),
    index("host_disk_io_collected_idx").on(t.collectedAt),
  ],
);

// -----------------------------------------------------
// host_net_iface — CHILD fact: per-interface /proc/net/dev counters (key = iface)
// -----------------------------------------------------
export const hostNetIface = pgTable(
  "host_net_iface",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id").notNull(), // RLS axis
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(), // D-13
    iface: text("iface"),
    rxBytes: bigint("rx_bytes", { mode: "bigint" }),
    rxErrs: bigint("rx_errs", { mode: "bigint" }),
    rxDrop: bigint("rx_drop", { mode: "bigint" }),
    txBytes: bigint("tx_bytes", { mode: "bigint" }),
    txErrs: bigint("tx_errs", { mode: "bigint" }),
    txDrop: bigint("tx_drop", { mode: "bigint" }),
    txColls: bigint("tx_colls", { mode: "bigint" }),
  },
  (t) => [
    index("host_net_iface_host_iface_collected_idx").on(t.hostId, t.iface, t.collectedAt.desc()),
    index("host_net_iface_collected_idx").on(t.collectedAt),
  ],
);

// -----------------------------------------------------
// pg_health — fact: RAW Postgres counters (COL-02). Cumulative pg_stat_* values —
// Δ clamped ≥0 at READ across stats_reset boundaries (Pitfall 7); NO a/b verdict
// column stored (D-14 — AP-12 determinism is derived at read).
// -----------------------------------------------------
export const pgHealth = pgTable(
  "pg_health",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id").notNull(), // RLS axis
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(), // D-13
    datname: text("datname"),
    maxConnections: integer("max_connections"),
    activeConnections: integer("active_connections"),
    numbackends: integer("numbackends"),
    xactCommit: bigint("xact_commit", { mode: "bigint" }),
    xactRollback: bigint("xact_rollback", { mode: "bigint" }),
    deadlocks: bigint("deadlocks", { mode: "bigint" }),
    tooManyClientsCount: bigint("too_many_clients_count", { mode: "bigint" }),
    serialization40001Count: bigint("serialization_40001_count", { mode: "bigint" }),
    fatalCount: bigint("fatal_count", { mode: "bigint" }),
    blockedQueries: integer("blocked_queries"),
    slowQueryGt1s: integer("slow_query_gt_1s"),
    // Reset boundary for the read-time Δ clamp (Pitfall 7).
    statsReset: timestamp("stats_reset", { withTimezone: true }),
  },
  (t) => [
    index("pg_health_host_collected_idx").on(t.hostId, t.collectedAt.desc()),
    index("pg_health_collected_idx").on(t.collectedAt),
  ],
);

// =====================================================
// Phase 17 — incident lifecycle tracking (INC-02)
// =====================================================
// The ONLY new write surface for Phase 17 — tracking-only metadata (ack / owner /
// snooze + the D-06 mute baseline + D-07 open/clear epochs). NEVER a fleet write
// and holds NO credentials (INC-02 zero-write-path invariant). Drizzle-owned
// (generate/migrate against NODEMON_QUEUE_URL only — never a warehouse).
//
// Identity: one active tracked incident per `incident_key` (GroupedIncident.key =
// host_id | "unattributed") enforced by a partial-unique on (incident_key) WHERE
// cleared_at IS NULL (D-01). Recurrence-is-new falls out for free: clearing sets
// cleared_at so the next failure INSERTs a fresh active row (D-07 recurrence epoch).

// -----------------------------------------------------
// incident_tracking — ack/owner/snooze + mute baseline + open/clear epochs (INC-02)
// -----------------------------------------------------
export const incidentTracking = pgTable(
  "incident_tracking",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentKey: text("incident_key").notNull(), // GroupedIncident.key (host_id | "unattributed")
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    owner: text("owner"),
    snoozeUntil: timestamp("snooze_until", { withTimezone: true }),
    // D-06 mute baseline — snapshotted at ack/snooze so a broken-through critical clears mute.
    mutedAtSeverity: text("muted_at_severity"),
    mutedCriticalChildren: integer("muted_critical_children"),
    // D-07 resolution epoch — set on clear so the partial-unique lets the next failure INSERT fresh.
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
  },
  (t) => [
    // partial-unique: at most ONE active tracked incident per key (D-01 one-per-host).
    uniqueIndex("incident_tracking_active_key_uniq")
      .on(t.incidentKey)
      .where(sql`cleared_at IS NULL`),
    index("incident_tracking_key_idx").on(t.incidentKey),
  ],
);
