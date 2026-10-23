# NodeMonitor — Security Re-Scan (Grade-A Deploy Gate)

**Date:** 2026-07-27
**Scope:** v1 + v2 surfaces — the full remediation set for the 2026-07-22 review (`CODE-REVIEW-2026-07-22.md`).
**Method:** Evidence-based re-scan against the MERGED code at base `69239ca` (phase 18 plans 18-02…18-10, 18-12 all merged). Each prior CRITICAL/HIGH was re-checked by reading the actual remediated source in this tree — NOT by trusting the plan SUMMARYs alone. Two repeatable invariants (zero-write-path, AI-emits-no-commands) were re-affirmed by runnable checks (`scripts/zero-write-grep.sh`; `guardrails.test.ts` both-path proofs).
**Result:** **GRADE A — ZERO CRITICAL / ZERO HIGH remaining across v1 + v2.**

The deploy gate is **satisfied** (PROJECT core value: no CRITICAL/HIGH before production deploy). One operator verification remains **deferred** (not a finding — a DB-required integration proof that runs under CI/operator DB, see §4).

---

## 1. Verdict

| Severity | Original count (2026-07-22) | Remaining (2026-07-27) |
|----------|----------------------------|------------------------|
| CRITICAL | 1 (Q1) | **0** |
| HIGH | 5 Opus (Q2, I1, C1, U1, Q3) + 8 confirmed Fable (D-svc, I-fee, I-pg, O-load, NavRail×2, copyAll, C-iso, commit1) | **0** |
| MEDIUM | many (hardening/test-coverage) | remaining MEDIUM/LOW are non-gating; the safety-relevant ones were folded into the HIGH remediations |
| LOW | many | non-gating; one net-new item logged below (pre-existing ESLint debt) |

**No new CRITICAL/HIGH was introduced by the remediation work.** No finding is routed to `--gaps`.

---

## 2. Prior CRITICAL / HIGH → now-fixed state (with code evidence)

### CRITICAL

| ID | Finding | Remediated? | Code evidence (this tree) |
|----|---------|-------------|---------------------------|
| **Q1** | Node applied lncli args from the unsigned `params` column; HMAC covered only `canonical_payload`. A DB-tamper attacker (no secret) edited in-bounds and the node applied it. | ✅ **FIXED** (18-02, hardened 18-09) | `scripts/node/apply-fee` L91–96: HMAC covers the 5 newline-joined `canonical_payload` fields (`nodePubkey\ncommandId\nactionType\ncanonicalParams\nexpiresAt`); L140 "jq reads the signed params substring so the bytes are HMAC-covered" — applied values now come from the signed bytes. Regression: `src/lib/queue/canonical-binding.test.ts`, `scripts/node/apply-fee.test.sh`. |

### HIGH — Opus ranked

| ID | Finding | Remediated? | Code evidence |
|----|---------|-------------|---------------|
| **Q5** (M, same class as Q1) | Signed `expiresAt`/`nodePubkey` never enforced node-side; TTL used the mutable `expires_at` column. | ✅ **FIXED** (18-09) | `apply-fee` L104–106 `pubkey_mismatch` fail-close on `SIGNED_PUBKEY != PUBKEY`; L117–134 "(a4) SIGNED expiresAt TTL re-check (Q5)" — signed expiry is the sole authority; commandId↔claimed-row binding (L113). |
| **Q2** | Executor role `nodemon_node` could `UPDATE ... SET state='approved'` at the DB — self-approve bypassing the operator gate. | ✅ **FIXED** (18-10) | `db/role-grants.sql` L169–199: `nodemon_node_transition_guard()` BEFORE UPDATE trigger, deny-by-default allow-list of executor-legal edges; `pending_approval → approved` explicitly forbidden (L191). Migration `drizzle/nodemon/0005_self_approve_guard.sql`. |
| **I1** | Hardcoded `timeLockDelta: 80` shipped to `updatechanpolicy` verbatim — silently rewrote any channel's CLTV not already at 80. | ✅ **FIXED** (18-02) | `apply-fee` L156–174: "(c2) PRESERVE the channel's ACTUAL time_lock_delta"; resolves LIVE TLD via `lncli getchaninfo` (L169–170), applies `--time_lock_delta "$CURRENT_TLD"` (L197), `time_lock_delta_unresolved` fail-close (L174). `src/lib/insight/detectors/fee-signals.ts` L50 marks the `80` default DISPLAY-ONLY. |
| **C1** | Postgres day-roll dropped the previous file's unread log tail (missed `FATAL`/`too_many_clients` read as "no errors"). | ✅ **FIXED** (18-08) | `scripts/fileserver/collect_telemetry.py`: correct rotation-boundary drain (day-roll, multi-rotation, `.zst` gap marker) — draining anchored by cursor inode/path + `offset>size` reset; `.zst` surfaces a persistent `ROTATION_GAP_MARKER` rather than silent `[]`. Coverage in `scripts/fileserver/test_extract.py`. |
| **U1** | Honest no-data/stale STATE text rendered in `df-faint` (documented as failing WCAG contrast) — the operator literally could not read "no data". | ✅ **FIXED** (18-04) | ~59-site `df-faint` content sweep routed state strings to `df-muted`/`df-stale-text`; build-time regression guard `scripts/df-faint-guard.sh` (executable, wired into `npm run lint:df-faint`) forbids sub-contrast tokens on content text via a `df-faint-ok` opt-out marker. |
| **Q3** | Per-node write rate-limit hardcoded `< 4`; `NODEMON_RATE_LIMIT_MAX` used only in a log line, never enforced. | ✅ **FIXED** (18-02) | `scripts/node/check-queue` L47 `RATE_LIMIT_MAX="${NODEMON_RATE_LIMIT_MAX:-4}"`, bound as psql var `-v rlmax=` (L195) and used in BOTH enforcement guards `:'rlmax'::int` (L180, L183) — enforcement and logging share one source. |

### HIGH — Fable cross-engine confirmed / Fable-unique

| ID | Finding | Remediated? | Code evidence |
|----|---------|-------------|---------------|
| **commit1** (`check-queue:201`) | `commit1` (claimed→executing) exit/row-count unchecked before `apply-fee` → a DB blip applies the fee but leaves the row `claimed`; reaper re-releases → double-apply. | ✅ **FIXED** (18-09) | `check-queue` L110/L126 `RETURNING id`; commit1 double-apply guard (`UPDATE ... RETURNING id` + conditional audit; abort before `apply-fee` on an unconfirmed flip). Idle-tick sweeps committed in their own txn. |
| **D-svc** (`service-health.ts:183`) | `deriveServiceHealth` attributed via observed `node_pubkey` only, never the fetched `inventory_node_pubkey` — a declared-but-silent node-scoped service misattributed to host infra and disappeared from the node grid. | ✅ **FIXED** (18-03) | `src/lib/read/service-health.ts` L181 `const nodePubkey = row.node_pubkey ?? row.inventory_node_pubkey;` in both branches. |
| **I-fee** (`fee-signals.ts:279`) | A failed 90d volume read degraded to `[]`, mapping every missing entry to `forwards90d=0` → a confident `channel_close_candidate` with live `close_channel` params on an actively-routing but aged channel. | ✅ **FIXED** (18-03) | `src/lib/insight/detectors/fee-signals.ts` L121 `forwards90d: number | null`; L147–151 "Volume UNKNOWN (failed 90d read — I-fee): raise-only degrade" (zero close/lower cards); L184–187 no fabricated `forwards90d` evidence when null. |
| **I-pg** (`ap12-advisory.ts:173`) | Ignored `PgHealthView.stale`/`collectedAt`, stamping `evidence.asOf = new Date()` — a 3-day-old critical pg_health sample rendered as fresh. | ✅ **FIXED** (18-03) | `src/lib/insight/detectors/ap12-advisory.ts` L183–185 `asOf` from the sample's OWN `collectedAt` (epoch sentinel when null); L88–89/L151–154 stale/undated views badged `detail.stale='true'`. |
| **O-load** (`load-incidents.ts:40`) | `loadIncidents()` omitted the 30-day freshness cutoff + surviving-pubkey filter `page.tsx` applies → AI narration + mute baseline operated on a different incident set than the operator saw. | ✅ **FIXED** (18-03) | `src/lib/overview/load-incidents.ts` L62–79: `applyFreshnessCutoff` on nodes/hosts/chain/services + `survivingPubkeys` filter, INTERNAL to `loadIncidents()` — one pipeline for render, narration, and mute baseline. |
| **NavRail** (`NavRailShell.tsx:57`) | `DEFAULT_COUNTS = {…ok:26}` + `showFleetSummary` default true → detail pages rendered a fabricated solid-green "26 ok" ramp during an active fleet-wide critical. | ✅ **FIXED** (18-04) | `src/components/df/NavRailShell.tsx` L475 `showFleetSummary && counts !== undefined` — summary renders ONLY when the page supplies real counts; `DEFAULT_COUNTS` removed; `loadFleetCounts()` feeds real counts to incident/host-detail pages. |
| **NavRail** (`NavRailShell.tsx:493`) | Undefined `pollSinceMs` fell back to a fake `LivePollPill` ("Live · polled 0s ago") on empty queue / null freshness. | ✅ **FIXED** (18-04) | `NavRailShell.tsx` L351–352, L492–494: honest "no data yet" stamp when NEITHER poll epoch is supplied; `LivePollPill` confined to explicit-prop use. |
| **copyAll** (`commands.ts:40`) | `comment()`'s 120-char cap truncated STATIC safety/runbook constants (`RESTART_KEY_STEPS`, `AGED_FUNDING_GUIDANCE`) in `copyAll` — the pasted artifact silently dropped safety guidance shown in full in the UI. | ✅ **FIXED** (18-06) | `src/lib/export/commands.ts` L66–70 trusted static constants rendered via `sanitizeCommentText(line, Infinity)` (control-stripped but UNCAPPED); card-sourced content stays capped. `safeToken()` (L47) is now the single gate-then-interpolate site for every exported identifier (E2). |
| **C-iso** (`collect_telemetry.py:1848`) | No per-service exception isolation in the grading loop — one uncaught `OSError` aborted the whole tick → zero rows for the host, masking which service broke. | ✅ **FIXED** (18-08) | `scripts/fileserver/collect_telemetry.py` L1300 `grade_inventory`, L1343 `except OSError as exc:` per inventory row → `_degraded_row(inv, detail="collector error")` (L1284) — one service degrades honestly, the host tick survives. |

**Also folded in during remediation (defense-in-depth, from the same clusters):** Q4 (single-source reaper window), Q6 (`outcome='succeeded'` rate-limit filter), Q7 (generic-secret fallback removed), C5 (host-key-pinned root self-update), C2/C4 (multi-rotation + `.zst` drain), AI2 (advisory-only backstop on the legacy `narrate()` path), I2 (per-detector `PUBKEY_RE` fail-soft), DB/read timezone + PERF-01 recency bounds + role-level read-only boot probe (18-07), and the honest-stale read-model demotions (18-03).

---

## 3. Re-affirmed invariants (repeatable checks — RUN and PASS, not skipped)

### 3.1 Zero-write-path (`scripts/zero-write-grep.sh`, wired into `npm run lint:zero-write`)
The read/display (`src/lib/read`) and command-EXPORT (`src/lib/export`) surfaces import NO write path:
- queue WRITE modules (`enqueue`/`claim`/`sign`/`canonical`/`withdraw`/`stub-executor`/`state`) — **none**;
- queue write server-actions (`@/app/actions/queue`) — **none** (those live only on the deliberate operator CONTROL affordances, e.g. `ApprovePanel`, `EnqueuePreview`, out of scope by design);
- node crypto signing (`createHmac`/`node:crypto`) — **none**;
- EXPORT held stricter (fully DB/queue/driver-free) — **clean**.

`sh scripts/zero-write-grep.sh` → **exit 0** on the current tree; verified **exit 1** on an injected write import (negative test). `@/lib/queue/bounds` (a pure Zod schema) is correctly NOT treated as a write path.

### 3.2 AI-emits-no-commands — both narrate paths gate through `assertAdvisoryOnly`
The 2026-07-22 AI2 gap (only `narrateIncident()` gated) is closed: Cluster D (18-05) wired the SAME `assertAdvisoryOnly` backstop into `narrateCards` (`src/lib/insight/narrative.ts` L108–111, withhold-on-fail). Proven by runnable tests:
- `src/app/actions/narrate.test.ts` "withholds a command-shaped generation via the advisory-only guardrail (T-18-07)" — the `narrate()` path;
- `src/app/actions/narrate-incident.test.ts` "withholds a command-shaped generation via assertAdvisoryOnly (T-17-02)" — the `narrateIncident()` path;
- `src/lib/insight/guardrails.test.ts` new "both narrate paths gate through assertAdvisoryOnly (AI2 remediation)" — structural pin (both modules import + call the shared gate and withhold) + behavioral proof (the shared gate withholds a command-shaped line for each path's output shape).
- `AiReadLine` shape carries no `action`/`params`/`command` key (`buildBandLines` `{ sev, head, body }` only) — re-asserted in `guardrails.test.ts`.

Run: `npx vitest run src/lib/insight/guardrails src/app/actions/narrate` → **60 passed, 0 skipped**.

---

## 4. Deferred operator verification (NOT a finding)

**18-10 self-approve-guard live-DB integration proof.** The Q2 fix (BEFORE UPDATE trigger `nodemon_node_transition_guard`) is present in `db/role-grants.sql` and shipped as migration `drizzle/nodemon/0005_self_approve_guard.sql`; its integration test `src/lib/queue/self-approve-guard.test.ts` is **DB-required** (`requireNodemonDb`) and therefore does NOT run in the DB-less floor. It must be executed once under CI/operator with the `nodemon` DB provisioned + migration `0005` applied, to prove at runtime that a `nodemon_node` session is denied `pending_approval → approved`. This is a standing CI/operator gate, not an open CRITICAL/HIGH — the deterministic trigger source is merged and reviewed.

---

## 5. Net-new LOW (non-gating)

| Sev | Item | Note |
|-----|------|------|
| LOW | Pre-existing ESLint debt — 10 errors + 27 warnings (`no-unused-vars`, in `triage.test.ts`, `read/pg-health.ts`, and others NOT touched by 18-11). | Pre-existing at base `69239ca`; unrelated to any CRITICAL/HIGH; does not affect the deploy gate. Track as lint cleanup, not a security finding. |

---

## 6. Deploy-gate conclusion

**Grade A confirmed** — zero CRITICAL, zero HIGH across v1 + v2 after all remediation, with direct code evidence for every prior severe finding and two repeatable invariants (zero-write-path, AI-no-commands) re-affirmed by green, non-skipped checks. The one outstanding item (§4) is a DB-required integration proof to run under CI/operator, not a residual defect. **NodeMonitor is clear to deploy per the PROJECT Grade-A gate.**
