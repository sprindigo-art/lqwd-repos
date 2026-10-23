# Phase 6: Command Queue + Approval UI (Prong 1) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-15
**Phase:** 6-Command Queue + Approval UI (Prong 1)
**Areas discussed:** Enqueue flow, Approval & queue UI, Stale-data gate, Lifetime & secret design

---

## Enqueue flow

### Q1 — Where should the enqueue control live?
| Option | Description | Selected |
|--------|-------------|----------|
| Mirror Phase 5 expand | Inline-expand ENQUEUE control on update_fee cards, one component on /inbox + console Active Signals | ✓ |
| Inline button, no expand | Direct ENQUEUE button opening a small confirm | |
| You decide | Defer to research/planning | |

**User's choice:** Mirror Phase 5 expand

### Q2 — How much friction before the pending_approval row is written?
| Option | Description | Selected |
|--------|-------------|----------|
| Preview then confirm | Expand shows exact intent + CONFIRM ENQUEUE; nothing written until confirm | ✓ |
| One-click enqueue | Single click writes the row (with undo/toast) | |
| You decide | Defer to planning | |

**User's choice:** Preview then confirm

### Q3 — Can the operator adjust the proposed fee before enqueuing?
| Option | Description | Selected |
|--------|-------------|----------|
| Engine-locked | Queued value is exactly the deterministic suggestion, no edit | |
| Editable within bounds | Operator may nudge ppm within validated min/max; audit records override | ✓ |
| You decide | Defer to planning | |

**User's choice:** Editable within bounds
**Notes:** Makes the update_fee param bounds a Phase 6 design artifact (zod, mirroring the gateway Limits) — the same bounds Phase 7 re-enforces node-side. Overridden values must be flagged in the audit.

### Q4 — When is the HMAC signature computed and frozen?
| Option | Description | Selected |
|--------|-------------|----------|
| At enqueue | Sign over pubkey+command_id+action_type+canonical(params)+expires_at at row creation; store canonical string + hex digest; immutable | ✓ |
| At approval | Compute signature only on approval | |
| You decide | Defer to planning | |

**User's choice:** At enqueue
**Notes:** Compatible with editable-within-bounds — operator edits in preview, final params frozen + signed on confirm.

---

## Approval & queue UI

### Q1 — Where does the pending-approval queue live?
| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated /queue page | Standalone fleet-wide queue page with inline approval; parallels /inbox + /pending | ✓ |
| Section on /inbox | Fold into the triage inbox as a distinct block | |
| You decide | Defer to planning | |

**User's choice:** Dedicated /queue page

### Q2 — What does each row show, and how is "current policy" obtained?
| Option | Description | Selected |
|--------|-------------|----------|
| Live re-query diff | Re-query current fee policy at render; show current → proposed diff + freshness | ✓ |
| Enqueue snapshot | Show current policy snapshotted at enqueue | |
| You decide | Defer to planning | |

**User's choice:** Live re-query diff

### Q3 — How should approve and reject behave?
| Option | Description | Selected |
|--------|-------------|----------|
| Confirm + reason on reject | Approve = confirm; reject requires a reason into audit | |
| Confirm both, reason optional | Both confirm; rejection reason optional free text | ✓ |
| You decide | Defer to planning | |

**User's choice:** Confirm both, reason optional

### Q4 — Should the append-only audit be operator-visible this phase?
| Option | Description | Selected |
|--------|-------------|----------|
| Visible per-command timeline | Transition history (state, actor, timestamp, reason) inline on /queue | ✓ |
| Written but not surfaced | Audit populated + tested, no UI until later | |
| You decide | Defer to planning | |

**User's choice:** Visible per-command timeline

---

## Stale-data gate

### Q1 — What defines "stale," and how strict is the gate?
| Option | Description | Selected |
|--------|-------------|----------|
| Reuse freshness bands, hard block | Past stale band → APPROVE hard-disabled | |
| Reuse bands, warn + override | Warning + deliberate override | ✓ |
| Queue-specific tighter threshold | Stricter window just for fee approvals, hard-block | |

**User's choice:** Reuse bands, warn + override

### Q2 (reconciliation) — How heavy should the override be vs roadmap's "block on stale"?
| Option | Description | Selected |
|--------|-------------|----------|
| Type-to-confirm override | Type node alias / "APPROVE STALE"; audited | |
| Checkbox acknowledgement | Required "I acknowledge data is stale" checkbox unlocks APPROVE; audited | ✓ |
| Tighten roadmap to match | Keep simple override, edit the success criterion wording | |

**User's choice:** Checkbox acknowledgement
**Notes:** Raised because ROADMAP success-criterion 3 says "blocking approval on stale data." Resolution: blocked-by-default until an audited checkbox acknowledgement — the project's explicit interpretation of "block." Verifier should expect a checkbox-gated override, not an immovable lock.

---

## Lifetime & secret design

### Q1 — What governs expiry and the default TTL?
| Option | Description | Selected |
|--------|-------------|----------|
| 24h execution deadline from enqueue | expires_at = enqueue + 24h, signed once; hard execution deadline; fail-closed → expired; config-tunable | ✓ |
| Shorter (4–6h) | Tighter window; risk late approvals expire | |
| Two clocks | Separate approval deadline + execution TTL | |

**User's choice:** 24h execution deadline from enqueue

### Q2 — Where should the per-node HMAC secret live?
| Option | Description | Selected |
|--------|-------------|----------|
| Env var per node, keyed by pubkey | Server-only env secret per node; node side gets same via Phase 7 downloader; never in DB/bundle | ✓ |
| Secrets file (key-per-node) | Git-ignored pubkey → secret file/dir | |
| nodemon DB table | Per-node secrets in a table (weakens tampered-DB-row threat model) | |

**User's choice:** Env var per node, keyed by pubkey
**Notes:** This is the cross-phase format/location freeze Phase 7's downloader depends on. Matches the env-only config ethos (HARDEN-02).

### Q3 — How are post-approval states exercised/shown this phase?
| Option | Description | Selected |
|--------|-------------|----------|
| Test harness + read-only UI states | Stub drives claimed→executing→succeeded\|failed in tests; UI renders read-only; no fake-run control | ✓ |
| Operator "simulate" control too | Add a dev-only control to advance the lifecycle live | |
| You decide | Defer to planning | |

**User's choice:** Test harness + read-only UI states

### Q4 — How to handle the stale-claim reaper window (Phase 7 sets the interval)?
| Option | Description | Selected |
|--------|-------------|----------|
| Config placeholder, tune in Phase 7 | claimed_timeout = N × assumed_interval, provisional default, proven against simulated interval | ✓ |
| Pick a fixed default now | Commit to e.g. 15 min | |
| You decide | Defer to planning | |

**User's choice:** Config placeholder, tune in Phase 7

---

## Claude's Discretion

- Exact /queue layout, diff rendering, audit-timeline visual grammar, enqueue preview styling (via sketch-findings-nodemonitor + frontend-design).
- command_id / nonce idempotency-key generation and the canonical-JSON serializer implementation (honoring CLAUDE.md §4).
- Drizzle schema for the three nodemon tables (commands/executions/audit) + migration; SELECT … FOR UPDATE SKIP LOCKED + reaper mechanics.
- Where the live "current policy" read sources from (AFM-001 latest-state helper vs existing fee reader).
- Provisional numeric defaults for the 24h TTL and reaper window (within the locked shapes).

## Deferred Ideas

- Rebalance request table (carried from Phase 5) — future extension adding a rebalance_request action type the external balancing service claims.
- Queue action types beyond update_fee (queued closes/rebalances behind stricter gates) — v2/deferred.
- Operator dev-only "simulate execution" control — considered and rejected as throwaway UI.
- Scheduled recommendation refresh / background card computation — v2/deferred.
