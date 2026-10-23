# Phase 18: Hardening + VM Deploy (v1 + v2) — Context

**Gathered:** 2026-07-22
**Status:** Ready for planning
**Source:** PRD Express Path — `.planning/CODE-REVIEW-2026-07-22.md` (dual-engine review: Opus 4.8 + Fable 5, each 7 parallel subsystem reviewers with adversarial verification)

<domain>
## Phase Boundary

This phase makes the whole application production-grade in one pass and gates the first production deploy. The **dual-engine code review IS the HARDEN-01/HARDEN-03 security scan**: its findings are the CRITICAL/HIGH items that must reach zero ("Grade A") before deploy. Phase 18 therefore delivers:

1. **Remediate every verified CRITICAL/HIGH/impactful-MEDIUM finding** from the review to Grade-A (HARDEN-01, HARDEN-03).
2. **Re-affirm the core invariants** on all v1 + v2 surfaces: zero-write-path on read/display, the AI layer emits no executable params, warehouses read-only / nodemon RW-only, honest-stale (HARDEN-03).
3. **Validate the config-only local→VM flip** — boots from env vars only, no code changes, fail-loud health check (HARDEN-02).
4. **Close the queue test-coverage gap** — stand up an ephemeral Postgres in CI so the `src/lib/queue/*` claim/TTL/reaper proofs actually run (they are skipped today, so Cluster A regressions ship green).

**In scope:** the 7 remediation clusters (A–G) below + the CI Postgres harness + a final Grade-A re-scan + invariant re-affirmation + env-only boot check.

**Out of scope:** new features; the planned Teams webhook alerting (still design-intent); any change to the frozen recommendation-card schema or the locked Data-Forward token set beyond the `df-faint` legibility fix.

### Remediation status at planning time

The working tree already contains **correct-but-untested in-progress fixes** (uncommitted, authored via VS Code) — these need golden tests + commit, **NOT re-implementation**:
- **Q1 (CRITICAL):** `scripts/node/apply-fee` now derives every applied value from the signed `canonical_payload` (field 4) and adds a `pubkey_mismatch` replay check. Verified correct, no regression.
- **I1 (HIGH):** `apply-fee` resolves the channel's **live** `time_lock_delta` via `getchaninfo` (fail-closed), instead of applying the hardcoded placeholder `80`.
- **Q3 (HIGH):** `scripts/node/check-queue` binds the rate-limit ceiling to `:'rlmax'` from `NODEMON_RATE_LIMIT_MAX` (safe default 4).

These three are reviewed and safe to build on. Everything else in Clusters A–G is open.
</domain>

<decisions>
## Implementation Decisions

Each finding below is a **locked requirement** (fix + acceptance). File:line and full scenarios are in `.planning/CODE-REVIEW-2026-07-22.md`. Grouped into clusters for plan decomposition; sequence A→G (security trust-boundary first, then honest-stale, then the rest).

### Cluster 0 — Land the in-progress worktree fixes (do first)
- Add golden tests proving `apply-fee` **rejects** a tampered-`params` row (params ≠ signed), a **wrong-pubkey** row (replay), and applies only signed values; add a test that the rate limit honors `NODEMON_RATE_LIMIT_MAX`. Then commit Q1/I1/Q3.
- These tests require the CI Postgres harness (Cluster H) for the node-script integration path; unit-level canonical/bounds tests run DB-less.

### Cluster A — Queue trust boundary (HIGH; highest remaining risk)
- **Q5 — node-side TTL re-check:** `apply-fee` must parse the signed `expiresAt` (payload field 5), compare to now, and `fail_closed "ttl_expired"`. TTL is currently enforced only via the mutable `expires_at` DB column at claim time.
- **Q5b — commandId binding:** bind payload field 2 (`commandId`) to the claimed row id so a genuine `(payload,signature)` pair from an older approved command on the same node cannot be transplanted/replayed. (`apply-fee` must be passed the claimed id.)
- **Q2 — DB-role self-approve:** the `nodemon_node` role can `UPDATE ... SET state='approved'`; the approval gate lives only in app code. Add a `BEFORE UPDATE` trigger / role policy forbidding `pending_approval→approved` for the executor role. **Read the real `drizzle/nodemon` role-grant + RLS files first** — both engines inferred this without reading the grants; confirm before writing the trigger.
- **Q4 — commit1 double-apply guard:** `check-queue` never checks the claimed→executing commit before calling `apply-fee`; a DB blip applies the fee but leaves the row `claimed`, and the reaper later re-releases it → double-apply. Use `UPDATE … RETURNING id`, abort the tick if nothing flipped, make the audit insert conditional.
- **Q-idle — `\gset` sweep rollback:** an empty-queue tick under `ON_ERROR_STOP=1` can roll back the expire/reaper sweeps. Split sweeps into their own committed txn, or pre-seed `\set cand_id ''` and guard.
- Lower-priority same-cluster (fold in if cheap): secret off `openssl` argv (Q-secret), remove generic-secret fallback (Q7), single-source the reaper window (bash 15m vs TS 5m), rate-limit count filter on `outcome='succeeded'` (Q6).

### Cluster B — Honest-stale in the data layer (HIGH; wrong operator signals)
- **I-fee:** a failed 90d volume read degrades to `[]`, mapping every aged channel to `forwards90d=0` → confident `channel_close_candidate` cards with live `close_channel` params for actively-routing channels. Make `volumeRows` nullable; emit raise-only (no close/lower) when volume is absent; test null volume → zero close cards.
- **I-pg:** `ap12-advisory` ignores `PgHealthView.stale`/`collectedAt` and stamps `asOf = now`. Stamp from `collectedAt` (epoch sentinel when null); skip/badge `stale=true`.
- **D-svc:** `deriveServiceHealth` never falls back to `inventory_node_pubkey`, misattributing a declared-but-silent node-scoped service as host infra. Use `node_pubkey ?? inventory_node_pubkey`.
- **O-load:** `loadIncidents()` omits the freshness cutoff + surviving-pubkey filter `page.tsx` applies, so AI narration + mute baselines use a different incident set than the UI. Apply the same cutoff inside `loadIncidents()` (ideally one shared pipeline).
- **O-fee:** fee-summary emission path skips the `staleNodes` demotion the sibling paths apply. Apply the same stale demotion.

### Cluster C — Honest-stale in the UI / chrome (HIGH)
- **U2:** remove `NavRailShell` `DEFAULT_COUNTS` all-clear fallback (`{crit:0…ok:26}`) — incident/host-detail pages render a fabricated solid-green "26 ok" ramp during live criticals. Require real `counts` when `showFleetSummary`, or default it false.
- **U3:** remove the fake `LivePollPill` fallback ("Live · polled 0s ago") when `pollSinceMs` is undefined; render an honest "no data yet" stamp.
- **U1:** sweep meaning-bearing `text-df-faint` (~61 usages) → `text-df-muted`/`text-df-ink` on honest-state + safety-critical text; add a lint/grep guard forbidding `df-faint` on content text.
- Add `loading.tsx` + `error.tsx` under `(overview)`; fix the `FreshnessChip` `now`-prop hydration mismatch.

### Cluster D — AI advisory-only backstop (invariant re-affirmation, HARDEN-03)
- **AI2:** the fleet/node `narrate()` action returns LLM text without the `assertAdvisoryOnly` command-free gate that `narrateIncident` treats as non-negotiable. Route `narrateCards` output through `assertAdvisoryOnly`; withhold on failure.
- **AI1:** add `maxOutputTokens`/`temperature` to `narrateCards` (mirror `narrateIncident`'s 400 cap).
- **AI3:** add `narrate.test.ts` — flag-off short-circuit, pubkey rejection, server-recompute, advisory-only withholding.

### Cluster E — Export path (zero-write re-affirmation, HARDEN-03)
- **E-copy:** `comment()` applies the 120-char cap to static safety/runbook constants in `copyAll`, truncating safety guidance the UI shows in full. Don't cap trusted static constants; test `copyAll` contains them verbatim.
- **E1/E2:** unify gate-then-interpolate — route every interpolated identifier through one `safeToken(value, regex)` helper that withholds on mismatch (closes the "re-check at interpolation site" gap the header advertises but only `bumpFeeExport` implements).
- **I2:** `buildDeepLink()` throws on a malformed/uppercase warehouse pubkey inside `assembleCards` (outside `degrade()`), rejecting the whole insight view for `/inbox` + every console. Guard with `PUBKEY_RE` fallback or per-detector try/catch.

### Cluster F — DB read correctness / perf
- **health.ts (cross-engine conflict, resolved):** the boot read-only assertion verifies the **client session flag**, not the **role's grants** — a `25006` from `default_transaction_read_only` and a `42501` from missing TEMP privilege both pass even if the role can INSERT into real tables. Add a role-level probe (attempt a write the role should be denied independent of the session flag; target a real table, not TEMP).
- Bound the unbounded `DISTINCT ON`/`ROW_NUMBER` window scans (`latest.ts:31`, `pg-health.ts:133`, `host-metrics-ext.ts`) with a recency window + fallback (mirror PERF-01).
- Null-is-not-zero for `outgoing_fee_base_msat` (`latest.ts:139`); pin `TimeZone: "UTC"` on `dbNodemon` and use `now() AT TIME ZONE 'UTC'` (DB1).

### Cluster G — Collectors (Python + node wrappers)
- **C-iso:** wrap each service's grading in `try/except OSError` so one bad artifact degrades **one** service honestly (`functioning=False`) instead of blacking out the whole host's tick.
- **C1/C2/C4:** fix the day-roll/multi-rotation/`.zst` drain so the previous log file's unread tail (incl. `FATAL`/`too_many_clients`) is captured.
- **C5:** pin the fileserver host key on every ssh/scp self-update (`StrictHostKeyChecking=yes` + `UserKnownHostsFile`); ideally verify a signed/hashed payload before replacing root-executed code. Add `ConnectTimeout` + `flock` overlap guards.

### Cluster H — Test-coverage harness (cross-cutting, unblocks Cluster 0 + A)
- Stand up an **ephemeral Postgres in CI** (e.g. service container / testcontainer) with the `nodemon` schema so `src/lib/queue/*` (claim / enqueue / approve / TTL / reaper) and the node-script integration tests actually run and gate the deploy. Tag DB-requiring tests and **fail the pipeline if they are skipped** rather than passing green.

### HARDEN closeout (final plans)
- **HARDEN-01/03:** re-run the security scan (re-invoke the dual-engine review or the security-review tool) and confirm **zero CRITICAL/HIGH** across v1 + v2; re-affirm zero-write-path (grep battery) and AI-emits-no-commands (guardrails tests green on both narrate paths).
- **HARDEN-02:** validate the app boots on a VM from env vars only — no `localhost` literals, DB URLs / fileserver location / secrets all env-driven, boot health check fails loud on a misconfig.

### Claude's Discretion
- Plan decomposition granularity (one plan per cluster vs finer); exact test framework wiring for the CI Postgres; trigger vs RLS-policy mechanism for Q2 (decide after reading the grants); the precise `safeToken` signature; whether the reaper-window single-source lives in env or a shared constant.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Review source (the requirements)
- `.planning/CODE-REVIEW-2026-07-22.md` — every finding with severity, file:line, concrete scenario, and fix; the Fable cross-engine addendum + the one refuted finding + the health.ts conflict resolution.

### Invariants & project constraints
- `CLAUDE.md` (repo root) — the locked invariants (zero credentials, HMAC signing §4, read-only warehouses, honest-stale, design-token discipline), and the GSD workflow enforcement.
- `.planning/REQUIREMENTS.md` — HARDEN-01/02/03 acceptance text.
- `.planning/ROADMAP.md` §"Phase 18" — goal + success criteria.

### Primary code under change
- `scripts/node/apply-fee`, `scripts/node/check-queue` — queue executor (Clusters 0, A). Working tree has uncommitted Q1/I1/Q3 fixes.
- `drizzle/nodemon/` (migrations + role grants) — **read before Q2**.
- `src/lib/queue/*` — claim/enqueue/approve/ttl (Cluster A + H tests).
- `src/lib/insight/detectors/*`, `src/lib/read/*`, `src/lib/overview/*` — Clusters B, F.
- `src/lib/ai/*`, `src/app/actions/narrate.ts`, `src/lib/insight/guardrails.ts` — Cluster D.
- `src/lib/export/commands.ts` — Cluster E.
- `src/components/df/NavRailShell.tsx`, `FreshnessChip.tsx`, `globals.css` — Cluster C.
- `scripts/fileserver/collect_telemetry.py` + `run_*.sh` — Cluster G.
- `src/lib/db/health.ts` — Cluster F (health probe).

</canonical_refs>

<specifics>
## Specific Ideas

- The review already ran adversarial verification; **do not re-derive findings** — treat them as accepted and plan the fixes. One finding was refuted and dropped (`incidents.ts:568`); do not plan it.
- Q1/I1/Q3 are done-in-worktree — plan **tests + commit**, not re-implementation.
- Q2 rests on inferred (unread) role grants — the plan must include "read `drizzle/nodemon` grants first, confirm the gap, then choose trigger vs policy."
- The queue safety tests are the highest-leverage coverage gap; Cluster H gates whether Cluster 0/A regressions can be caught at all.
- HARDEN-01 = "no CRITICAL/HIGH remain" — the phase is not done until a re-scan is clean.

</specifics>

<deferred>
## Deferred Ideas

- Teams webhook alerting (design-intent, never built) — out of scope.
- Most LOW findings (dead code, minor a11y, log rotation) — capture as a backlog; fix opportunistically within the touching plan, but they do not gate Grade-A (only CRITICAL/HIGH do).
- Streaming CSV export / large-window row caps (perf LOWs) — backlog.

</deferred>

---

*Phase: 18-hardening-vm-deploy-v1-v2*
*Context gathered: 2026-07-22 via PRD Express Path (`.planning/CODE-REVIEW-2026-07-22.md`)*
