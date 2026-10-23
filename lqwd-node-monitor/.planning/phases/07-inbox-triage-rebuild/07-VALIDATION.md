---
phase: 7
slug: inbox-triage-rebuild
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-16
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4 (config carries the `@/` alias; plain node/ESM, no Next plugin — Phase-1 decision in STATE.md) |
| **Config file** | `vitest.config.*` (present per Phase 1; confirm path at Wave 0) |
| **Quick run command** | `npx vitest run <file> -t <name>` |
| **Full suite command** | `npm test` (`vitest run`) |
| **Estimated runtime** | ~10–20 seconds (pure modules); INBOX-04 integration test adds a live `nodemon` fixture round-trip |

---

## Sampling Rate

- **After every task commit:** Run the touched pure-module test (`triage`, `triage-facets`, or `queue.batch`).
- **After every plan wave:** Run `npm test` (full Vitest suite).
- **Before `/gsd:verify-work`:** Full suite green + live golden (`loadInsightView` still parses against the FROZEN card schema) + operator visual checkpoint (Phase 3/5/6 precedent) + a security grep (no `signature`/`canonicalPayload` crossing the action boundary; no `dangerouslySetInnerHTML`).
- **Max feedback latency:** ~20 seconds (pure-module quick run).

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| INBOX-01 | `partitionTriage` puts every critical+warn in the spine, only `info` in groups, suppressed in its own block, **no card dropped** (count in == count out) | unit (pure) | `npx vitest run src/lib/insight/triage.test.ts` | ❌ W0 | ⬜ pending |
| INBOX-01 | a `critical` card is never placed inside a fold/group | unit (pure) | `npx vitest run src/lib/insight/triage.test.ts -t critical` | ❌ W0 | ⬜ pending |
| INBOX-02 | `facetCounts` over the **unfiltered** set + `applyFacets` over search-param state; combined facets narrow; counts independent of active facets | unit (pure) | `npx vitest run src/lib/insight/triage-facets.test.ts` | ❌ W0 | ⬜ pending |
| INBOX-03 | drawer series mapping: fee/revenue→forwards, close→closes, else null (honest "no trend data" fallback) | unit (pure mapping fn) | `npx vitest run src/lib/insight/triage.test.ts -t series` | ❌ W0 | ⬜ pending |
| INBOX-04 | `enqueueBatch` best-effort: a row whose secret is missing yields `{ok:false,error}` verbatim while sibling rows return `{ok:true,id}`; `queued`/`skipped` tally correct; **no rollback** of good rows | integration (live `nodemon` fixture per Phase-6 `06-03`) or mocked `enqueue` unit | `npx vitest run src/app/actions/queue.batch.test.ts` | ❌ W0 | ⬜ pending |
| INBOX-04 | bulk never sends a signature/canonical payload; suppressed/LDK/non-fee cards are excluded from the selectable set | unit (affordance gate over a fixture card set) | `npx vitest run src/lib/queue/enqueue-props.test.ts` | check (Phase-6 may have one) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/insight/triage.test.ts` — partition + no-card-dropped invariant + critical-never-folded + series-mapping (INBOX-01, INBOX-03)
- [ ] `src/lib/insight/triage-facets.test.ts` — facet count/codec correctness over the unfiltered set (INBOX-02)
- [ ] `src/app/actions/queue.batch.test.ts` — best-effort tally + no-rollback (INBOX-04)
- [ ] Confirm `vitest.config` path + the `@/` alias resolves (Phase-1 established it; just verify)
- [ ] `src/components/ui/sheet.tsx` — vendor via `npx shadcn@latest add sheet` (Wave-0 prerequisite, not a test)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Critical + warn render as scannable rows above the fold; info folds into per-signal → per-node groups; suppressed block visible with verbatim reason | INBOX-01 | Visual partition + above-the-fold layout cannot be asserted by a unit test | Load `/inbox` against the live fleet dataset; confirm no flat list, no dropped card, suppressed reasons verbatim |
| Facet rail filters by severity/node/signal/action with live counts; facets combine; rail toggles off → full-width | INBOX-02 | Interactive filter + responsive layout | Toggle facets, confirm spine narrows and counts stay correct; collapse rail, confirm full-width |
| Card selection opens in-page drawer with full evidence + action affordance, no navigation; `?card=ID` deep-links/back-button/reload-safe | INBOX-03 | Drawer interaction + URL sync + back-button behavior | Select a card; verify drawer evidence (metric, observed vs threshold, window, freshness/trend); reload + back-button; embedded `EnqueuePreview`/`CommandExport`/runbook acts inline |
| Bulk `ENQUEUE ALL` + cross-node multi-select → aggregate confirm → rows land on `/queue`; tally names every skip verbatim | INBOX-04 | End-to-end write into the live `nodemon` queue + `/queue` surfacing | Trigger bulk-enqueue; confirm aggregate dialog scope copy; verify rows appear `pending_approval` on `/queue`; force a missing-secret node to confirm verbatim skip tally with good rows still queued |
| NOC Light design language (severity = state-only color, navy = structure/act-only, mono data, no icons-for-state) per sketch-005 winner E | Success Criterion 5 | Visual design-language conformance | Compare against `sketch-findings-nodemonitor` winner E; run the operator visual checkpoint |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 20s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-16 (plan-time strategy sign-off; `wave_0_complete` flips at execution)
