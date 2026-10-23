---
phase: 03-per-node-console-pending-monitor
verified: 2026-06-11T17:58:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 3: Per-Node Console + Pending Monitor — Verification Report

**Phase Goal:** Drill into one node's full operational detail and see every pending channel across the fleet — the read detail the fleet overview points at.
**Verified:** 2026-06-11T17:58:00Z
**Status:** passed
**Re-verification:** No — initial verification (the phase's internal 03-09 gate failure and 03-10..03-16 gap closure happened before this verification; the operator visual gate is recorded as APPROVED in 03-VALIDATION.md and is NOT re-flagged here)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Operator can drill into one node and view channels, fee report, liquidity, forwards, closes, and peers — LND and LDK through the same components | ✓ VERIFIED | `src/app/(overview)/[pubkey]/[tab]/page.tsx` (310 lines): PUBKEY_RE + TAB_KEYS 404 gauntlet (L156-158), per-tab dispatch with explicit comment "identical components for LND and LDK, zero branching" (L202) routing to ChannelsPanel/FeesPanel/LiquidityPanel/PeersPanel/PendingTabPanel (`StaticTabPanels.tsx`) and ForwardsPanel/ClosesPanel (`EventTabPanels.tsx`). Each panel awaits a real read-layer executor (`channelsTabData`, `feesTabData`, `liquidityTabData`, `peersTabData`, `forwardsTabData`, `closesTabData`). Backend appears only as a `"lnd" \| "ldk"` badge prop — no data-path branching. Redirect `/{pubkey}` → `/{pubkey}/scorecard` confirmed at `[pubkey]/page.tsx:28`. Dev-server probes recorded in 03-VALIDATION.md (8/8, incl. 307 redirect, 200 tabs, 404 invalids). |
| 2 | Operator can export any per-node table (channels, forwards, closes, fees) to CSV | ✓ VERIFIED | `EXPORTABLE_TABS = ["channels","forwards","closes","fees"]` (`src/lib/console/config.ts:53`); route handler `src/app/(overview)/[pubkey]/[tab]/export/route.ts` validates pubkey regex, exportable-tab whitelist, and window via `Object.prototype.hasOwnProperty.call` BEFORE any query (L61-64), then `assembleCsv` with per-table specs (`src/lib/csv/export.ts:125-128`). Full-window builders (`buildForwardsFullSql`, `buildClosesFullSql` — no LIMIT) exist in `src/lib/console/forwards.ts:122` / `closes.ts`. RFC-4180 serializer + `FORMULA_TRIGGER = /^[=+\-@\t\r]/` formula escape + filename sanitization in `src/lib/csv/serialize.ts:16,36`. ExportButton wired into both event panels. Live probe: 200 text/csv with `#` provenance first byte, sanitized filename (03-VALIDATION.md probe 7). |
| 3 | Operator sees all pending channels — opens, coop-closes, force-closes — per node and fleet-wide, with state, age, limbo balance, and sweep broadcast_attempts, from lnd_node_pending_channels + lnd_node_pending_sweeps | ✓ VERIFIED | Both tables typed in `src/lib/db/schema/routing.ts:232,274` incl. `channelState`, `limboBalance`, `broadcastAttempts`. Recency-filtered reader (`make_interval(hours => …)` at `src/lib/read/pending.ts:86-114`) excludes resolved residue; `buildPendingView` groups by verbatim channel_state, oldest-first, nests sweeps, keeps orphans. Fleet surface: `/pending` page (`currentPendingChannels` + `currentPendingSweeps` → `buildPendingView` → `PendingBoard scope=fleet`). Per-node surface: `PendingTabPanel` (`StaticTabPanels.tsx:366-376`) with the same reader scoped by pubkey. `PendingBoard` renders state sections, formatted unjudged age, limbo sats, and `sweep.broadcastAttempts` (L104). Overview carries the PENDING triage block + per-row pending counts from a separate `Promise.all` read (`page.tsx:228-230` — `loadFleetView` did not grow). Live golden run CONFIRMED 2/2 against the warehouse for all 10 nodes (03-VALIDATION.md §5: opens ≈ pending_channels, limboSum ≈ total_limbo_balance). |
| 4 | Every console and pending view carries a data-freshness indicator | ✓ VERIFIED | FreshnessStamp rendered: console 3-slot header (`[tab]/page.tsx:301`, in its own border-left slot per gap-3 fix), every static panel scoped to its own data (`StaticTabPanels.tsx:105,170,…,381` incl. PendingTabPanel), both event panels (`EventTabPanels.tsx:124,216`), `/pending` page (`pending/page.tsx:86`), and fleet queue-row meta slots (`(overview)/page.tsx:194`). |

**Score:** 4/4 truths verified

### Required Artifacts (16 plans, SDK `verify.artifacts`)

| Plan | Result | Details |
|------|--------|---------|
| 03-01 | 3/3 ✓ | config.ts, pending.ts (280 lines), routing.ts schema |
| 03-02 | 2/2 ✓ | serialize.ts (113) + serialize.test.ts (206) |
| 03-03 | 1/2 — superseded | `GradeBadge.tsx` missing `showPct` — INTENTIONAL: 03-12 replaced the D-14 dot+letter/showPct design after the operator rejected it at 03-09. Successor pattern `bg-status-ok-dim` tinted chip + pct-in-title-tooltip verified present (`GradeBadge.tsx:8-17,33-37`); `showPct` absent from all of src/ as required by 03-12. Not a gap. |
| 03-04 | 3/3 ✓ | forwards.ts (188), closes.ts (173), peers.ts (158) — all with tests |
| 03-05 | 3/3 ✓ | vendored tabs.tsx, PendingBoard.tsx, EventTable.tsx |
| 03-06 | 3/3 ✓ | [tab]/page.tsx (310), EventTabPanels.tsx, StaticTabPanels.tsx |
| 03-07 | 2/2 ✓ | export route.ts (exports GET), export.ts (169) |
| 03-08 | 1/2 — superseded | `(overview)/page.tsx` missing `pendingSummary` — INTENTIONAL: 03-13 replaced it with one `currentPendingChannels` read feeding strip total + per-node queue counts. Successor pattern verified (`page.tsx:5,228-230`). Not a gap. |
| 03-09 | 1/1 ✓ | 03-VALIDATION.md (`nyquist_compliant: true`, gate record) |
| 03-10 | 4/4 ✓ | globals.css (`--color-status-ok-dim`), layout.tsx fonts, (overview)/layout.tsx, CLAUDE.md |
| 03-11 | 2/2 ✓ | trends.ts (128) + trends.test.ts (102) |
| 03-12 | 4/4 ✓ | GradeBadge, CriticalChip, FreshnessStamp, OutlierMarker |
| 03-13 | 3/3 ✓ | Attention Queue page.tsx (`Needs attention`), PendingBoard, pending/page.tsx |
| 03-14 | 4/4 ✓ | Sparkline, EvidencePanel, ActiveSignalsPanel, ConsoleRail (all Server Components — `"use client"` grep clean over src/components/console/) |
| 03-15 | 3/3 ✓ | [tab]/page.tsx (`grid-cols-[1fr_auto_auto]` at L278), ConsoleTabs (pendingCount L50-52), ScorecardPanel |
| 03-16 | 1/1 ✓ | 03-VALIDATION.md gap-closure section + operator APPROVED verdict |

### Key Link Verification

SDK `verify.key-links`: 18/24 auto-verified. The 6 reported failures were all tooling artifacts or supersessions — each manually re-verified:

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| pending.ts | lnd_node_pending_channels | recency predicate | ✓ WIRED | `make_interval(hours =>` at pending.ts:86,94,108,114 (SDK choked on escaped regex) |
| golden-pending.test.ts | lnd_node_info | limbo cross-check | ✓ WIRED | `total_limbo_balance` at L61,69 |
| serialize.ts | OWASP CSV guidance | FORMULA_TRIGGER | ✓ WIRED | `FORMULA_TRIGGER = /^[=+\-@\t\r]/` at L16, applied at L36 |
| ScorecardPanel → GradeBadge | showPct | — | ✓ SUPERSEDED | showPct design removed by 03-12 (operator gap 2); successor chip+tooltip wiring verified (03-12 links 2/2 ✓) |
| [pubkey]/page.tsx → /scorecard | redirect( | ✓ WIRED | `redirect(\`/${pubkey}/scorecard\`)` at L28 |
| [tab]/page.tsx → src/lib/console | TabData | ✓ WIRED (superseded shape) | 03-15 rewrite loads via panel components: imports from `@/lib/console/config`, `@/lib/console/trends`; panels call `*TabData` executors |
| (overview)/page.tsx → pending.ts | Promise.all | ✓ WIRED | `Promise.all([loadFleetView…, currentPendingChannels(…)])` at L228-230 (03-13 supersession of pendingSummary) |
| 03-VALIDATION.md links (03-09, 03-16) | success criteria / verdict | ✓ WIRED | SDK can't treat a planning doc as "source"; manually confirmed: per-task ✅ statuses, `Gap-Closure Re-Verification` section, verbatim "approved" verdict |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Real Data | Status |
|----------|--------------|--------|-----------|--------|
| StaticTabPanels (channels/fees/liquidity/peers) | `data` | `*TabData(pubkey)` → shapers over `latestChannelsForNode` (DISTINCT ON discipline) | Yes | ✓ FLOWING |
| EventTabPanels (forwards/closes) | `data` | `forwardsTabData`/`closesTabData` → bound-int windowed SQL (ns-epoch ×1e9) | Yes | ✓ FLOWING |
| PendingBoard (both scopes) | `view` | `currentPendingChannels/Sweeps` → `buildPendingView` — verbatim render, no JSX math | Yes | ✓ FLOWING (live golden 2/2 on 10 nodes) |
| Scorecard tab (signals/rail/evidence) | `forwardsSeries`/`closesSeries` | `forwardsDailySeries`/`closesDailySeries` with `.catch(() => null)` degrade | Yes | ✓ FLOWING |
| Overview Attention Queue | `fleetView` + `pending` | `loadFleetView()` + `currentPendingChannels()` in Promise.all | Yes | ✓ FLOWING |

No hardcoded-empty props, no static returns found in any verified path.

### Behavioral Spot-Checks (run fresh by this verifier)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full no-DB test suite | `env -u ROUTING_VM_DATABASE_URL npx vitest run` | 27 files passed, 3 skipped (live golden skip-gate); 264 passed / 16 skipped | ✓ PASS |
| Typecheck | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Emoji/dot ban (gap 1/2 gates) | `grep -rn "🔴\|🟡\|🟢\|⚠\|◆" src/`; `grep rounded-full GradeBadge.tsx` | both empty | ✓ PASS |
| Micro-text / XSS / client-component bans | `text-[11px]`, `dangerouslySetInnerHTML`, `"use client"` in console/ | all empty | ✓ PASS |

Dev-server probes (8/8) and the live golden warehouse run (2/2, all 10 nodes) were not re-run here — they require live warehouse credentials and a running server; verbatim transcripts with per-node output are recorded in 03-VALIDATION.md §Gap-Closure Gate Results.

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist and no plan declares probe scripts — `find scripts -path '*/tests/probe-*.sh'` returns nothing; plan/summary greps for probe paths return nothing. The "probes" in this phase are ad-hoc dev-server curls documented verbatim in 03-VALIDATION.md. Step 7c: SKIPPED (no declared or conventional probe scripts).

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| NODE-01 | 03-03..06, 03-10..15 | Drill into one node: channels, fees, liquidity, forwards, closes, peers | ✓ SATISFIED | SC1 evidence above; 8-tab console fully wired |
| NODE-02 | 03-02, 03-06, 03-07 | CSV export of any per-node table | ✓ SATISFIED | SC2 evidence above; route + serializer + full-window builders |
| PENDING-01 | 03-01, 03-05, 03-06, 03-08, 03-13 | All pending channels per node + fleet-wide with state/age/limbo/broadcast_attempts | ✓ SATISFIED | SC3 evidence above; live golden invariants 2/2 |

No orphaned requirements: REQUIREMENTS.md maps exactly NODE-01, NODE-02, PENDING-01 to Phase 3 (all marked Complete); every plan's `requirements` field draws from this set.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | TBD/FIXME/XXX | none | Zero debt markers in src/ |
| — | — | TODO/HACK/placeholder | none | Only benign test comments about SQL `$1 placeholder` |
| src/lib/csv/serialize.ts | 55-81 | Provenance `#` lines bypass csvCell — comma in alias defeats formula escaping (03-REVIEW.md CR-01) | ⚠️ Warning | Real hole in the CSV-injection boundary, but narrow surface (aliases are the operator's own nodes today) and does not falsify any must-have as written (filename sanitization and data-cell escaping both hold). Recommend fixing per CR-01 before any untrusted-alias source lands. |
| src/app/(overview)/[pubkey]/[tab]/page.tsx | 166 | `rawWindow in WINDOW_PRESETS` accepts prototype-chain keys (`constructor` etc.) | ⚠️ Warning | Looked-up value (a function) — not the raw string — would reach the bind path and fail at query time into the caught TabError path; the security-critical export route uses `Object.prototype.hasOwnProperty.call` correctly (route.ts:64). Robustness fix: mirror the route's hasOwnProperty check. |
| src/lib/csv/serialize.test.ts | 145-159 | Tests CR/LF provenance breakout but not the comma vector | ℹ️ Info | Disconfirmation finding — companion to CR-01; add a comma-alias fixture with the fix. |

The 1-Critical/5-Warning/7-Info code review (03-REVIEW.md) is advisory per the phase contract; CR-01 and the `in`-operator finding are surfaced above as warnings with recommended follow-up, and do not block goal achievement.

### Human Verification Required

None. The operator visual gate — the only human-judgment item in this phase — already ran twice: FAILED at 03-09 (4 structured gaps), then APPROVED at 03-16 after gap closure, with the verbatim verdict and gap-by-gap disposition recorded in 03-VALIDATION.md §Operator Gap-Closure Re-Verification. CSV-in-spreadsheet and pending-vs-Grafana cross-checks were walked at the same checkpoints with no issues reported. No `<verify><human-check>` deferred blocks exist in any plan (all checkpoints were explicit checkpoint tasks, both resolved).

### Gaps Summary

No gaps. All four ROADMAP success criteria are observably true in the codebase, verified at exists/substantive/wired/data-flowing levels with the test battery re-run fresh by this verifier (264 passed, tsc clean, all security greps clean). The two SDK artifact-pattern misses (showPct, pendingSummary) are in-phase design supersessions: the original 03-03/03-08 implementations were rejected by the operator at the 03-09 visual gate and deliberately replaced by gap-closure plans 03-12/03-13, whose own must-haves verify green. Two warning-class review findings (CSV provenance comma escaping, `in`-operator window check on the page route) are recommended follow-ups but do not falsify any must-have or success criterion.

---

_Verified: 2026-06-11T17:58:00Z_
_Verifier: Claude (gsd-verifier)_
