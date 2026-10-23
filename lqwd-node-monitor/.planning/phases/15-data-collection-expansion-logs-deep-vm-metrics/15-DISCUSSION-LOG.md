# Phase 15: Data Collection Expansion — Logs + Deep VM Metrics - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-14
**Phase:** 15-data-collection-expansion-logs-deep-vm-metrics
**Areas discussed:** Log capture scope & shape, Benign suppression + patterns, Schema layout, Volume ceiling & rollout

---

## Log capture scope & shape

### Log scope
| Option | Description | Selected |
|--------|-------------|----------|
| Matched error/warn only | Only pattern-matched lines; smallest volume, no context | |
| Matched + N context lines | Matched line ± N surrounding lines | ✓ |
| Broader bounded tail | Capped tail window regardless of match | |

### Event shape
| Option | Description | Selected |
|--------|-------------|----------|
| Raw events only | Single table; aggregate derived at read time | |
| Raw events + pattern table | Also maintain a log_patterns aggregate | ✓ |
| You decide | Default raw-only unless a query demands aggregate | |

### Context N
| Option | Description | Selected |
|--------|-------------|----------|
| ±2 lines | Modest context | |
| ±5 lines | Fuller stack traces / multi-line errors | ✓ |
| Before-only | Lead-up only, no trailing | |

### Pattern maintenance
| Option | Description | Selected |
|--------|-------------|----------|
| Collector upserts per tick | Aggregate always current; more collector logic | ✓ |
| Read-time materialization | Collector lean; aggregate computed on read | |
| You decide | Simpler option meeting AI-phase needs | |

**User's choice:** Matched + ±5 context lines; raw events + pattern table; collector upserts pattern rows per tick.
**Notes:** ±5 chosen to capture multi-line PG/LND errors. Pattern aggregate survives even when raw exemplars are evicted.

---

## Benign suppression + patterns

### Suppression placement
| Option | Description | Selected |
|--------|-------------|----------|
| Read-time filter (persist all) | Persist all matched lines tagged; filter at read; retunable without redeploy | ✓ |
| Collector-side (never persist benign) | Drop benign before insert; smallest storage; redeploy to retune | |
| You decide | Default read-time per D-14 RAW posture | |

### Pattern source
| Option | Description | Selected |
|--------|-------------|----------|
| Config table in nodemon | Tunable via SQL, seeded from Obsidian library | ✓ |
| Hardcoded in code | Simplest, version-controlled, redeploy to tune | |
| You decide | Weigh tunability vs simplicity | |

**User's choice:** Read-time filter (persist all, classification-tagged); pattern definitions in a nodemon config table.
**Notes:** Aligns with RAW-everything (D-14) and avoids fleet collector redeploys to retune benign rules.

---

## Schema layout

### VM metrics schema
| Option | Description | Selected |
|--------|-------------|----------|
| New host_metrics_ext fact | Separate join fact; no risk to shipped Phase 14 readers | ✓ |
| Extend host_metrics (wide) | One read, no join; doesn't fit per-core/per-device cardinality | |
| You decide | Likely hybrid | |

### PG schema
| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated pg_health fact | Typed counters + AP-12 flags; deterministic detection | ✓ |
| Fold postgres into service_log_events | One table; counters shoehorned | |
| You decide | Default pg_health fact + PG log lines to service_log_events | |

**User's choice:** New host_metrics_ext fact (hybrid with per-core/per-device child facts); dedicated pg_health fact. PG log lines still flow to service_log_events.
**Notes:** Avoids migration risk to Phase 14 VmVitals/host-detail readers.

---

## Volume ceiling & rollout

### Volume
| Option | Description | Selected |
|--------|-------------|----------|
| Cap ~200 lines/tick, 21d | Hard cap + dedupe; 21d retention | |
| Cap ~50 lines/tick, 21d | Tighter cap; risk truncating a real storm | |
| You decide | Per-signature cap + per-tick ceiling | |

**User's choice (free text):** "we dont want to have a ceilling, we can however strategize a way to remove the useless information at the cap and replace it with new data, but we dont want to lose examples of important information as this will help us improve and learn for future debug results."

### Eviction strategy (follow-up)
| Option | Description | Selected |
|--------|-------------|----------|
| Keep-N-exemplars per signature + count | Aggregate forever + N raw exemplars; evict redundant benign copies | |
| Tiered retention by classification | Window keyed by classification | |
| Both combined | Exemplars AND tiered windows | ✓ |
| You decide | Design around never-lose-a-distinct-important-signature | |

### Rollout
| Option | Description | Selected |
|--------|-------------|----------|
| Canary-first, prove, then roll together | Land on canary, prove end-to-end, then fleet | ✓ |
| Splice fleet-wide in this phase | All ~26 nodes now; higher blast radius | |
| You decide | Default canary-first | |

**User's choice:** No hard ceiling — priority-aware retention combining keep-N-exemplars per signature AND classification-tiered windows. Canary-first rollout.
**Notes:** Rare/distinct signatures are the training/debug material for node autonomy — never silently drop them; the log_patterns aggregate survives forever.

---

## Final steer (operator)

> "We are not going for easy we are going for the most robust comprehensive and future proof product to improve stability and identify key weaknesses to improve and shore up so nodes become autonomous. Obsidian is for reference to build out the concept but everything will be stored in DB for future service given accessibility."

Captured as the guiding principle in CONTEXT.md `<domain>` and D-11 (Obsidian = build-time reference only; everything DB-resident, zero runtime vault dependency).

## Claude's Discretion

- Exact host_metrics_ext scalar-vs-child split + column lists.
- Exact N (exemplars/signature) + per-classification retention windows.
- `/proc`/`/sys` source list per metric (confirm Ubuntu norms via research).
- Context-line linkage mechanism in service_log_events.
- Classification enum values beyond {benign, warn, ap11, ap12, critical, other}.

## Deferred Ideas

- Dashboard auto-refresh heartbeat (after collection lands).
- Fleet-wide collector splice (rollout step after canary proof).
- AIX-02 narration + infra→HTLC impact edge (Phase 16).
- Reviewed-not-folded todos: node-detail all-channels/fee-queue; ui-polish-fleet-console (both UI, out of scope).
