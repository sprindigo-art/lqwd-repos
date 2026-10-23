---
phase: 14-hosts-infra-monitoring
plan: 07
subsystem: ops-nav-and-vitals
tags: [ops-nav, hosts-nav, vm-vitals, node-detail, backfill, phase-gate, read-only, honest-stale]
requires:
  - phase: 14-hosts-infra-monitoring plan 05
    provides: "hosts list route at /hosts (this nav points to it); OPS_NAV precedent + NavRailShell Hosts rail entry"
  - phase: 14-hosts-infra-monitoring plan 06
    provides: "Host Detail buildVitals treatment mirrored here (24h getHostMetricsHistory + TELEMETRY_BANDS + StaleChart branch)"
  - phase: 14-hosts-infra-monitoring plan 02
    provides: "getHostMetricsHistory / getHostStorageHistory param-bound bounded scans"
  - phase: 12 (LOCKED)
    provides: "severity-map severityFromBand/worstSeverity; telemetry-bands; NavRailShell OpsNavItem; VmVitals/StaleChart primitives"
provides:
  - "Hosts entry in the top-bar opsNav on the overview (/) and nodes (/nodes) pages — the 12-11 divergent-nav gap does not repeat"
  - "Node Detail (/[pubkey]) VM vitals back-filled with real 24h history via getHostMetricsHistory/getHostStorageHistory instead of charts={[]}"
affects:
  - "Phase close — HOST-01/HOST-02 reachable from every ops surface"
tech-stack:
  added: []
  patterns:
    - "Inline opsNav item addition (NOT shared-module extraction): the plan's file ownership lists only the overview/nodes/pubkey pages; extracting a shared OPS_NAV would force touching the 14-05/14-06-owned hosts pages, which the plan flags as the acceptable-to-avoid case — inline is the sanctioned fallback"
    - "VM-vitals backfill mirrors Host Detail buildVitals: read-time band grading (page computes sev), presentation-pure VmVitals; a no-resolvable-host node keeps honest-empty charts (unchanged behavior)"
key-files:
  created: []
  modified:
    - src/app/(overview)/page.tsx
    - src/app/(overview)/nodes/page.tsx
    - src/app/(overview)/[pubkey]/page.tsx
decisions:
  - "Inline hosts opsNav item on both nav arrays rather than extracting src/lib/overview/ops-nav.ts — the frontmatter files_modified lists exactly the 3 non-hosts pages; a shared-module extraction would modify the 14-05/14-06 hosts pages (out of this plan's declared ownership). The plan explicitly sanctions the inline fallback: 'if the pubkey/inbox/pending/queue siblings also inline it, leave those untouched this phase'. Follow-up extraction remains acceptable in a later cleanup."
  - "Node Detail vitals reuse the Host Detail treatment verbatim (24h window, CPU busy band / MEM available% band / DISK %-free band, worst-mount disk series, host.stale||empty-series → StaleChart). buildHostVitals is a self-contained helper in the pubkey page (duplicated, not extracted) — lower-risk than refactoring the merged 14-06 file for a ~90-line helper."
metrics:
  duration: ~15 min
  completed: 2026-07-13
  tasks: 2/3 automated complete; 1 pending human visual gate
---

# Phase 14 Plan 07: opsNav Hosts wiring + Node Detail VM-vitals backfill Summary

**One-liner:** Closes Phase 14 in code — the Hosts entry now sits in the top-bar opsNav on every ops surface (overview + nodes, after Nodes; the hosts pages already carried it), and Node Detail's previously-empty `<VmVitals charts={[]} />` is back-filled with the resolved host's real 24h `getHostMetricsHistory`/`getHostStorageHistory` series graded read-time — the honest `StaleChart` branch engaging automatically for stale hosts, and a node with no resolvable host keeping honest-empty charts. The blocking operator visual gate remains PENDING (a background worktree agent cannot drive a live browser).

## What Was Built

### Task 1 — opsNav hosts entries + Node Detail VmVitals backfill (commit 2d2c556)

**(a) Nav wiring — Pitfall 8, the 12-11 divergent-nav gap.**
Added `{ key: "hosts", label: "Hosts", href: "/hosts" }` immediately after the Nodes item to:
- `src/app/(overview)/nodes/page.tsx` — the `OPS_NAV` const.
- `src/app/(overview)/page.tsx` — the inline `opsNav` array.

The two hosts pages (`hosts/page.tsx`, `hosts/[hostId]/page.tsx`) already carry the item (shipped in 14-05/14-06), and `NavRailShell`'s `RAIL_ITEMS` already carries the Hosts rail entry (14-05). **Inline addition, not shared-module extraction** — see Deviations for the ownership rationale.

**(b) Node Detail VM-vitals backfill — RESEARCH Open Q2, same treatment as Host Detail.**
In `src/app/(overview)/[pubkey]/page.tsx`:
- New imports: `getHostMetricsHistory`/`getHostStorageHistory` (14-02), `StorageGrowthSample` type, `TELEMETRY_BANDS`/`evaluateBand` (telemetry-bands), `severityFromBand` (severity-map), `VmVitalChart` type.
- New self-contained `buildHostVitals(host, history, storageHistory)` helper (+ `relAge`/`num` helpers) mirroring the 14-06 Host Detail `buildVitals`: CPU series + busy-band severity, memory used% (100 − available%) + available%-band severity, disk = the worst (most-full) mount's used% series + %-free-band severity. Each chart is `stale` when `host.stale || series.length === 0`, degrading to the honest `StaleChart` placeholder with a `lastGoodLabel`.
- The read: the node already resolves `resolved.hostId`; the page finds that `HostMetricsView`, fetches the 24h metrics + storage history fail-soft (`.catch(() => [])` / `.catch(() => new Map())`), and builds the charts. **If the node has no resolvable host, `vitals` stays `[]` (honest empty, unchanged behavior).**
- Replaced `<VmVitals charts={[]} />` with `<VmVitals charts={vitals} />`; threaded `vitals` through `DetailData`, the `data` object, and the render destructure.

### Task 2 — Phase automated gate (verification-only, no file changes)

The full phase gate was run and recorded (see Verification). No source changes — results live in this SUMMARY.

### Task 3 — Operator visual gate — PENDING (see Pending Human Verification)

## Task Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 | 2d2c556 | feat(14-07): wire Hosts into per-page opsNav + backfill Node Detail VM vitals |
| 2 | — | verification-only (no file changes) |
| 3 | — | pending operator visual gate |

## Verification

**Task 1 acceptance greps — all pass:**
- `grep -c '"/hosts"' src/app/(overview)/nodes/page.tsx` = **1** (≥1 ✓)
- `grep -c '"/hosts"' src/app/(overview)/page.tsx` = **1** (≥1 ✓)
- `grep -c 'getHostMetricsHistory' src/app/(overview)/[pubkey]/page.tsx` = **4** (≥1 ✓)
- `grep -c 'charts={\[\]}' src/app/(overview)/[pubkey]/page.tsx` = **0** ✓ (fully replaced; the no-host fallback path yields an empty `vitals` array passed as `charts={vitals}`, never the literal `charts={[]}`)

**Phase automated gate (Task 2):**
- `npx tsc --noEmit` — **exit 0** (clean across the repo, including all three modified files).
- `npm test` (vitest run) — **1193 passed, 49 skipped, 4 failed**. The 4 failures are the documented-unrelated `src/lib/queue/*` live-DB tests (`enqueue.test.ts` ×4) failing with `Missing required env: NODEMON_QUEUE_URL` — the 12-CLOSE known exception (this worktree has no queue-DB env; same category as the "4 known queue live-DB timeouts" the plan excepts). No regression to any layer this plan touches.
- `npm run lint` — **4 errors / 15 warnings, ALL pre-existing in files this plan did NOT touch** (see Deferred Issues). The three modified files report **zero lint problems**. (14-05 SUMMARY already documented `NavRailShell.test.tsx` + `ServiceHealthGrid.tsx` as deferred; the prototype-snapshot `support.js` errors are vendored reference, not app code.)
- **Security grep battery — all assertions satisfied (recorded verbatim):**
  - `grep -rn "dangerouslySetInnerHTML" src/components/host src/app/(overview)/hosts src/components/df/ThresholdMeter.tsx` → **0 matches** ✓
  - `grep -rn "routing_vm" src/components/host src/app/(overview)/hosts src/lib/overview/host-runbook.ts src/lib/overview/host-rollup.ts src/lib/read/host-history.ts src/lib/read/storage-projection.ts` → **0 matches** ✓
  - `grep -rn "execSync\|child_process\|spawn(" src/components/host src/app/(overview)/hosts src/lib/overview/host-runbook.ts` → **0 matches** ✓
  - `grep -rn '+ hostId\|`.concat' src/lib/read/host-history.ts` (no string-concat into sql) → **0 matches** ✓
  - The 4a drizzle-binding grep (`sql\`…${…}…\``) returned no single-line match because the `host-history.ts` sql templates span multiple lines; the parameter binding `WHERE host_id = ${hostId}` (lines 61, 75) is confirmed present and parameter-bound by source inspection — a grep multiline artifact, not a security concern.
- `next build` stays **operator-out-of-band** per the STATE.md sandbox-hang deferred item (not run here).

## Threat Model Compliance

- **T-14-21 (write-path regression):** the security greps confirm zero `child_process`/`exec`/`spawn` on the host surfaces; the modified pubkey page adds only read imports (`getHostMetricsHistory`/`getHostStorageHistory` — read-only bounded scans), no enqueue/write import. Runbook stays copy-to-run (operator step 5 verifies live).
- **T-14-22 (XSS):** `dangerouslySetInnerHTML` grep = 0 across host components/routes; the vitals values render through `VmVitals`/React auto-escaping only.
- **T-14-23 (info disclosure):** `routing_vm` grep = 0 across every listed file.
- **T-14-24 (fake freshness):** the vitals backfill preserves the honest-stale contract — `host.stale || series.length === 0` flips each chart to `StaleChart` ("NO FRESH DATA" + `lastGoodLabel`), never an interpolated line off a stale read.
- **T-14-SC (npm installs):** zero packages installed this plan (`package.json` untouched; node_modules symlinked from the main repo — gitignored, no install).

## Deviations from Plan

**1. [Rule 3 - Blocking] Fresh worktree had no node_modules**
- **Found during:** Task 1 setup (tsc/vitest/eslint unavailable).
- **Fix:** symlinked the main repo's gitignored `node_modules` into the worktree (zero packages installed) — the 14-06 precedent.
- **Files modified:** none tracked (symlink is gitignored).

**2. [Scope decision] Inline opsNav item rather than shared-module extraction**
- The plan's Task 1 (a) offers a "preferred" shared-`OPS_NAV`-module extraction imported from all four pages, but its own `files_modified` frontmatter lists exactly three files — the overview, nodes, and pubkey pages, **not** the two hosts pages. Extracting a shared module would require editing the 14-05-owned `hosts/page.tsx` and 14-06-owned `hosts/[hostId]/page.tsx`. The plan explicitly sanctions leaving inlined siblings untouched this phase ("if the pubkey/inbox/pending/queue siblings also inline it, leave those untouched"). Chose the lower-risk in-scope inline addition; a follow-up extraction remains acceptable. Acceptance is satisfied either way (the criteria accept "directly or via a shared OPS_NAV import").

**3. [Scope decision] buildHostVitals duplicated in the pubkey page, not extracted**
- Mirrored the 14-06 `buildVitals` treatment as a self-contained helper in `[pubkey]/page.tsx` rather than extracting a shared module — extraction would modify the merged 14-06 file for a ~90-line helper; duplication is lower-risk and keeps this plan within its declared file ownership.

## Deferred Issues

Pre-existing `npm run lint` failures in files this plan did NOT touch (SCOPE BOUNDARY — not introduced here, not fixed here):
- `src/components/df/NavRailShell.test.tsx` — `react/no-children-prop` (documented in 14-05).
- `src/components/node/ServiceHealthGrid.tsx` — `react-hooks/purity` `Date.now()` default-arg (documented in 14-05/14-06).
- `.planning/phases/10-design-system-foundation/.prototype-snapshot/support.js` — vendored prototype reference (`react/no-deprecated`, `no-assign-module-variable`); not app code.
- Assorted `no-unused-vars` warnings in queue/insight/node test + component files (pre-existing).

Also deferred (documented in the plan): `next build` is operator-out-of-band per the STATE.md sandbox-hang item.

## Known Stubs

None. The Node Detail vitals now feed off real 24h `getHostMetricsHistory`/`getHostStorageHistory` reads (not `charts={[]}`); the empty-charts branch survives ONLY for a node with no resolvable host, which is honest unchanged behavior (not a stub — `VmVitals` renders its honest header, and the design intent is honest emptiness when no host maps to the node).

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema surface. The pubkey page's new reads reuse the 14-02 param-bound bounded scans already in the phase threat model (T-14-16); the nav additions are static route strings.

## Pending Human Verification

**Task 3 — Operator visual gate (blocking) — NOT RUN.** As a background worktree agent I cannot start a dev server and drive a live browser for the operator, so this blocking checkpoint is surfaced here for the orchestrator to route to the human. All deterministic verification I *can* do is green (typecheck, tests, security greps, source inspection above). The operator must run `npm run dev` against real fleet data (e.g. http://localhost:3001) and confirm, verbatim from the plan's Task 3 `how-to-verify`:

1. `/hosts` — ALL declared hosts render; the canary shows live meters/trio/dots; every silent host shows the gold NO TELEMETRY card (never green, never hidden).
2. On an at-risk card: chrome severity + the single `driven by: …` line.
3. Facet chips (Critical/Warning/Watch/Healthy + Stale only) — URL updates, list filters, empty state reads `No matching hosts.` when nothing matches.
4. Hover a node dot (alias + status tooltip); click it → that node's detail without triggering the card link. Click the card body → `/hosts/[hostId]`.
5. Host Detail (canary): D-10 order; incident → `Verify first` runbook via Open runbook (copy-to-run only, nothing executes); healthy → NO banner, no placeholder.
6. Storage volumes: each row shows meter + % + rate + either `~N days/weeks/months to full` / `>1 year to full` or the honest status copy; no row hidden.
7. `/hosts/not-a-real-host` → a 404, not an echo of the bogus id.
8. **The Hosts entry appears in the nav rail AND the top opsNav on `/`, `/nodes`, and both hosts pages; Node Detail (`/[pubkey]`) VM vitals now draw real 24h sparklines (or honest stale placeholders).** ← the two surfaces this plan changed.
9. Visual bar per the approved 14-UI-SPEC (Linear/Vercel/Stripe calm density, navy=structure / ramp=state, mono data).

**Resume signal:** operator types `approved` verbatim to close the phase, or describes issues for gap routing. The verdict must be recorded verbatim in this SUMMARY (append under this section) once given.

### Operator verdict — APPROVED (2026-07-14)

Operator reviewed the running app in-browser (Hosts list + Host Detail + Node Detail + Home nav) and approved the Hosts surfaces. Gate closed. Follow-on UX/design work continued beyond this gate and is logged separately (see the Obsidian Phase 14 dev-log note): the node/host/service model regrouping, the full-width shell, the inbox/pending/queue design-system migration, and the node-detail chrome consistency pass — all browser-verified.

## Self-Check: PASSED

- src/app/(overview)/page.tsx (Hosts opsNav item) — FOUND
- src/app/(overview)/nodes/page.tsx (Hosts OPS_NAV item) — FOUND
- src/app/(overview)/[pubkey]/page.tsx (getHostMetricsHistory backfill, charts={vitals}) — FOUND
- Commit 2d2c556 — FOUND in git log
