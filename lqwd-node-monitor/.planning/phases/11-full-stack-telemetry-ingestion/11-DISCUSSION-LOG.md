# Phase 11: Full-Stack Telemetry Ingestion - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 11-Full-Stack Telemetry Ingestion
**Areas discussed:** Read-model schema & history, Service-health signal source, Collector mechanism & cadence, Freshness & thresholds model

---

## Read-model schema & history

### Schema shape
| Option | Description | Selected |
|--------|-------------|----------|
| Per-domain tables | Typed host_metrics / service_health / chain_telemetry | ✓ |
| One generic time-series table | Single telemetry_samples (entity_key, signal_type, value) | |
| Hybrid | Generic samples + typed service_health | |

### History
| Option | Description | Selected |
|--------|-------------|----------|
| Append history + retention | Insert-per-tick, rolling window pruned by sweep; latest = DISTINCT-ON (AFM-001) | ✓ |
| Latest snapshot only | UPDATE-in-place; no trend/growth/sparkline | |
| Mixed per table | History only where a trend is consumed | |

### Entity key
| Option | Description | Selected |
|--------|-------------|----------|
| Explicit host_id + node_pubkey | hosts dimension maps host_id → pubkeys; supports multi-node hosts + rollup | ✓ |
| node_pubkey only | Reuse Phase-8 RLS key; can't represent shared hosts | |
| host_id only | Breaks per-pubkey RLS + per-node service health | |

### Write RLS
| Option | Description | Selected |
|--------|-------------|----------|
| Collector sets app.host_id, RLS allows own host | Extends Phase-8 physical boundary to a host axis | ✓ |
| One designated collector node per host | Simpler RLS but host telemetry stops if that node is down | |
| Decide in research/planning | Lock keying, defer SQL | |

**User's choice:** Per-domain tables; append history + retention; host_id + node_pubkey; collector-sets-host_id RLS.
**Notes:** Foundational read-model contract for Phases 12–15. AFM-001 reused for latest-per-entity. Exact RLS SQL extends db/role-grants.sql in research.

---

## Service-health signal source

### RUNNING axis
| Option | Description | Selected |
|--------|-------------|----------|
| systemctl is-active, fallback pgrep | Authoritative for systemd units; pgrep/cron-recency for cron services | ✓ |
| pgrep / process pattern for all | Uniform but noisier; can't tell stopped from never-installed | |
| Per-service map, decide in research | Lock the principle, defer methods | |

### FUNCTIONING — custom services
| Option | Description | Selected |
|--------|-------------|----------|
| Scrape existing artifacts | Log mtime + success/error markers + output files; zero service changes | ✓ |
| Heartbeat-file convention | Uniform status file; requires touching all 6 services | |
| Hybrid: scrape now, convention as target | Status file if present, else scrape | |

### FUNCTIONING — infra trio
| Option | Description | Selected |
|--------|-------------|----------|
| Native health probe per daemon | bitcoind RPC / pg_isready / esplora HTTP; catches "up but dead" | ✓ |
| Reuse RUNNING + lightweight liveness | Misses the headline failure mode | |
| bitcoind via chain telemetry, finalize in research | | |

### Expected set
| Option | Description | Selected |
|--------|-------------|----------|
| Declared expected-set per host/node | service_inventory dimension; missing expected → stale/down | ✓ |
| Auto-discover, report whatever found | Crashed service silently vanishes | |
| Fleet-wide static list, mark presence | Noisy — every node shows "absent" services | |

**User's choice:** systemctl+pgrep RUNNING; scrape-artifacts FUNCTIONING for custom; native probes for infra; declared expected-set.
**Notes:** Two-axis green only when both true; expected-set makes honest-stale (SC#4) provable. Researcher enumerates the 9 services + their artifact locations.

---

## Collector mechanism & cadence

### Packaging
| Option | Description | Selected |
|--------|-------------|----------|
| Separate collector script + own cron line | Isolates telemetry from the credentialed apply path | ✓ |
| Extend run_check-queue.sh | Couples read-only collection to the apply tick | |
| Decide in planning | | |

### Cadence
| Option | Description | Selected |
|--------|-------------|----------|
| Uniform */5, all signals each tick | One freshness expectation drives staleness | ✓ |
| Tiered cadence per signal type | Less load, more complexity | |
| Uniform */5 now, tune later | | |

### Runtime
| Option | Description | Selected |
|--------|-------------|----------|
| Python (psycopg2), mirror nodeAuditor | Clean data shaping; no HMAC needed (read-only obs) | ✓ |
| Pure bash (psql) | Awkward for log-parse + per-domain shaping | |
| Decide in planning | | |

### Scope
| Option | Description | Selected |
|--------|-------------|----------|
| Prove on Phase-8 pilot host, schema fleet-ready | Mirror Phase-8 one-canary discipline | ✓ |
| Fleet-wide rollout now | Multiplies live-deploy risk | |
| Pilot + 1-2 additional | | |

**User's choice:** Separate script + own cron; uniform */5; Python/psycopg2; prove on the single canary, schema fleet-ready.
**Notes:** Key insight — telemetry writes need no HMAC (RLS + least-priv role is the boundary), so the Phase-8 pure-bash rationale doesn't carry; Python is the better fit.

---

## Freshness & thresholds model

### Staleness
| Option | Description | Selected |
|--------|-------------|----------|
| Per-row collected_at + read-time threshold | Derived staleness, no stored flag; can't go out of sync | ✓ |
| Collector stamps a stale/fresh state | Stored flag lies when collector stops | |
| Hybrid: stored last-seen + derived | Strongest guarantee, more bookkeeping | |

### Thresholds
| Option | Description | Selected |
|--------|-------------|----------|
| Config/insight layer, applied at read time | Raw values stored; one source of truth; re-tune without re-ingest | ✓ |
| Baked onto row at ingest | Re-tuning only affects new rows; history freezes judgments | |
| Raw now, threshold config stubbed for 12+ | | |

### Read API
| Option | Description | Selected |
|--------|-------------|----------|
| Ship tables + collector + typed read helpers | Concrete, testable contract; screens just call it | ✓ |
| Tables + collector only | Read contract implicit; screens re-derive (drift risk) | |
| Read helpers for signals proven this phase | | |

### Verification
| Option | Description | Selected |
|--------|-------------|----------|
| Seeded-fixtures tests + live pilot proof | Deterministic edge cases + one real end-to-end | ✓ |
| Live pilot proof only | Can't reproduce stale/no-data/up-but-dead reliably | |
| Seeded-fixtures tests only | Doesn't prove real collection | |

**User's choice:** Derived read-time staleness; config-layer thresholds at read; ship full read API; seeded tests + live pilot proof.
**Notes:** Mirrors Phase-8 verification split. Never-reported host caught via the hosts dimension (zero rows → no-data).

---

## Claude's Discretion

- Exact retention-window duration; precise RLS policy SQL (extends db/role-grants.sql); per-service RUNNING method + FUNCTIONING parse rules for the 9 services; host-vitals commands; bitcoin-cli invocation + credential access; esplora/postgres functioning checks; table column layouts/indexes; storage time-to-full computation location (collector vs read helper).

## Deferred Ideas

- Service heartbeat-file convention (replace log-scraping) — requires touching the 6 services.
- Tiered collection cadence — left as a tunable knob.
- Fleet-wide rollout beyond the canary — Phase-16 hardening territory.
- AI / cross-layer correlation + root-cause grouping — Phase 15.
- The screens that render this read model — Phases 12–14.
