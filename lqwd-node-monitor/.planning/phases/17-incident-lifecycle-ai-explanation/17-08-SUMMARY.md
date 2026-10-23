---
phase: 17-incident-lifecycle-ai-explanation
plan: 08
subsystem: app/(overview) — Incident Detail RSC (INC-01)
tags: [incident-detail, INC-01, AIX-02, d-10, rsc, df-composition, render-test]

# Dependency graph
requires:
  - "loadIncidents() (Plan 04) — the shared server-only assembler; .key selection contract"
  - "buildWhyChain / buildBlastTargets / buildBlastRoot (Plan 01, incident-detail.ts)"
  - "buildBandLines (ai-band.ts) — the AIX-02 rationale line"
  - "loadActiveTracking + reconcileTracking (Plan 05 / Plan 02) — per-key tracking read + snoozed-critical count"
  - "IncidentTrackingControls / IncidentReadClient / SnoozedCriticalBanner (Plan 07)"
  - "WhyChain / BlastRadius / SeverityRow / FreshnessChip / NavRailShell + severityAccent/severityLabel (df/*)"
provides:
  - "the Incident Detail page at /(overview)/incidents/[incidentKey] (INC-01) composing df primitives in the locked D-10 order"
  - "a renderToStaticMarkup D-10 order + host-only-omits-blast render test"
affects: [17-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "hosts/[hostId] membership-gate precedent reused: shape-gate key → load in try → notFound() OUTSIDE try → honest read-only error copy"
    - "fail-soft tracking read (.catch → []) so a nodemon outage degrades controls/banner rather than 500ing the deterministic view"
    - "pure reconcileTracking() for the read-only snoozed-critical banner count (no write from the detail render)"
    - "async RSC awaited to its element then renderToStaticMarkup under node; shell + reads + client actions vi.mock'd"

key-files:
  created:
    - src/app/(overview)/incidents/[incidentKey]/page.tsx
    - src/app/(overview)/incidents/[incidentKey]/page.test.tsx
  modified: []

key-decisions:
  - "incidentKey shape-gated with the Plan-05 KEY_RE before any read; invalid key → notFound() (never echoed) satisfying T-17-08"
  - "snoozed-critical count derived via the PURE reconcileTracking (not reconcileAndGetView) — the detail render stays zero-write"
  - "child deep-links (D-11): use the child's own href (fee rows), else /{pubkey} for node children, else /hosts/{incidentKey} for host/bitcoind/service/storage children; no derivable source → plain row (no dead <a>)"
  - "verdict + header chip both read incident.severity (the rolled-up worst) — never re-graded"

requirements-completed: [INC-01, AIX-02]

# Metrics
duration: ~15min
completed: 2026-07-20
---

# Phase 17 Plan 08: Incident Detail RSC (INC-01) Summary

**The centerpiece Incident Detail view now reads ONE incident from the shared `loadIncidents()` loader by its `.key` and composes the locked df primitives in the D-10 region order — status header (severity chip + tracking controls) → AI read (verdict + AIX-02 rationale) → why-chain → blast-radius → collapsible deep-linked grouped children — with the non-dismissible snoozed-critical banner above the fold, an honest read-only error path, and `notFound()` outside the try; proven by a `renderToStaticMarkup` D-10 order test.**

## Performance
- **Duration:** ~15 min
- **Completed:** 2026-07-20
- **Tasks:** 2 (autonomous; Task 2 is a render test-after within the two-task plan)
- **Files created:** 2 (1 source + 1 test)

## Accomplishments
- **`incidents/[incidentKey]/page.tsx` (INC-01)** — `force-dynamic` / `revalidate = 0` Server Component. Shape-gates `incidentKey` (Plan-05 KEY_RE), loads in a try via `(await loadIncidents()).find(i => i.key === incidentKey)`, renders honest read-only copy on a total read failure, and calls `notFound()` OUTSIDE the try on a miss (never echoing the key — T-17-08). Reads the active tracking row for the key (fail-soft) and the fleet-wide snoozed-critical count via pure `reconcileTracking`. Composes the LOCKED D-10 order: (1) severity chip (`severityAccent`+`severityLabel`, never navy) + identity + `FreshnessChip` + `IncidentTrackingControls`; (2) `IncidentReadClient` with `worstSeverity` + `rationaleLine={buildBandLines([incident])[0]}`; (3) `WhyChain` (omitted at 0 events); (4) `BlastRadius` (omitted when `buildBlastTargets` is empty — host-only incident); (5) per-layer collapsible `<details>` of `SeverityRow` children, each deep-linked (D-11). Mounts `SnoozedCriticalBanner` sticky above the fold (D-04).
- **`page.test.tsx`** — awaits the async RSC to its element and `renderToStaticMarkup`s it (shell, both loaders, and the client-action modules mocked). Asserts the five regions in D-10 DOM order, that a fee-only (host-only) incident omits the blast region while keeping the why-chain, and that the header severity chip carries the `bg-df-critical` ramp class.

## Must-Haves Verified
- Reads ONE incident via `loadIncidents().find(i => i.key === incidentKey)`. ✓
- Renders D-10 order: status header → AI read → why-chain → blast-radius → grouped children (test-proven index order). ✓
- Unknown/invalid key → `notFound()` outside the try; a read failure → honest error copy that echoes no key. ✓
- Grouped children collapsible `<details>`, each child a real deep-link to its source (D-11). ✓

## Task Commits
| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Incident Detail page — D-10 composition + membership gate (INC-01) | 5a8ba15 (feat) | incidents/[incidentKey]/page.tsx |
| 2 | Incident Detail render test — D-10 order + not-found path | 3cb3906 (test) | incidents/[incidentKey]/page.test.tsx |

## Verification
- `npx vitest run "src/app/(overview)/incidents/[incidentKey]/page.test.tsx"` → 3 passed.
- `npx tsc --noEmit -p tsconfig.json` → no errors for the incident page or test.
- `npm run lint:noc-guard` → v2 surfaces clean; `npx eslint <page>` → clean.
- Source assertions (all present): `loadIncidents`, `i.key === incidentKey`, `notFound()`, `buildWhyChain`, `buildBlastTargets`, `IncidentReadClient`, `IncidentTrackingControls`, `SnoozedCriticalBanner`, `dynamic = "force-dynamic"`.
- Quick suite regression: `npx vitest run src/lib/overview src/lib/insight` → 467 passed / 4 skipped.

## TDD Gate Compliance
Task 2 carries `tdd="true"`, but the plan builds the page in Task 1 and adds its render test in Task 2 — so the test lands GREEN against pre-existing composition rather than through a failing-first RED gate. This is the plan's intended two-task structure (build-then-prove), not a skipped RED: there is no separate `feat` commit gated behind the test. A `test(...)` commit (3cb3906) follows the `feat(...)` page commit (5a8ba15).

## Deviations from Plan
None — plan executed as written. The AI-SPEC's suggested `[hostId]` segment was realized as `[incidentKey]` (the plan's own frontmatter path and the loader's `.key` contract), which is the sanctioned naming discretion noted in the UI-SPEC Open Questions.

## Threat Model Compliance
- **T-17-08 (Info Disclosure):** `incidentKey` shape-gated (KEY_RE) then membership-gated via `.find(i => i.key === incidentKey)` → `notFound()` outside the try; the error copy names no key. ✓
- **T-17-16 (Info hiding):** `SnoozedCriticalBanner` mounted here too (fleet-wide, non-dismissible); verdict + header chip read `incident.severity` (worst), never downgraded. ✓
- **T-17-09 (Tampering):** the render is read-only — `loadIncidents` is server-only assembled, `reconcileTracking` is pure (no write), tracking read is fail-soft; `force-dynamic`. ✓
- **T-17-SC:** zero new packages.

## Threat Flags
None — no new network endpoints, auth paths, file access, or schema surface. The page only reads existing loaders and mounts existing components.

## Known Stubs
None — the page is fully wired to the Plan 01/04/05/07 modules and df primitives; no placeholder data paths.

## Self-Check: PASSED
- FOUND: src/app/(overview)/incidents/[incidentKey]/page.tsx
- FOUND: src/app/(overview)/incidents/[incidentKey]/page.test.tsx
- FOUND commit 5a8ba15 (Task 1 feat), 3cb3906 (Task 2 test)

---
*Phase: 17-incident-lifecycle-ai-explanation*
*Completed: 2026-07-20*
