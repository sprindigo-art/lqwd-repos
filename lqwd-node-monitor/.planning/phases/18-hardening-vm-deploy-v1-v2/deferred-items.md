## From 18-02 (2026-07-23)

- **tests/node companion updates left dirty (out of scope):** `tests/node/lib/pg-harness.sh`, `tests/node/check-queue.bats`, and `tests/node/check-apply-fee-static.sh` carry uncommitted working-tree updates that are companions to the Q1/I1 fixes committed in 18-02 (mock lncli now serving listchannels/getchaninfo for live-TLD resolution; static gate asserting SIGNED_PARAMS/pubkey_mismatch/getchaninfo). Until they land, the COMMITTED bats suite's mock lncli cannot satisfy apply-fee's live-TLD resolution (the docker-gated bats tests would fail-closed on `time_lock_delta_unresolved`). The orchestrator scoped 18-02 to its 5 plan files; the owning plan (or a follow-up) must commit these three files. No CI impact today: the bats suite is docker-gated and not enrolled in ci.yml.

## From 18-03 (2026-07-23)

- **Pre-existing NavRailShell view-toggle test failures (out of scope):** `src/components/df/NavRailShell.test.tsx` has 4 failing "view-tab toggle" tests (expects `data-testid="view-toggle"` / `role="tab"` segments in the default render); the toggle exists in `NavRailShell.tsx` but only renders when `viewTabs` are supplied, and the test fixtures don't supply them (or the default-on behavior regressed in commit 17db7b8, the UI-audit shell rework). Fails identically before and independent of the 18-03 lib changes (which touch only `src/lib/insight`, `src/lib/read`, `src/lib/overview`). Owning surface: the UI-audit / components plan. Full-suite tally at 18-03 close: 1481 pass / 4 fail (these) / 57 skip.
  - **RESOLVED in 18-04:** these 4 tests were fixed as part of Task 1 — the toggle is deliberately default-off, so the fixtures now opt in via `showViewToggle: true`.

## From 18-04 (2026-07-27)

- **Pre-existing ESLint errors block `npm run lint` (out of scope):** `npm run lint` fails on 10 ESLint errors that exist verbatim on base 02f0a99 and are UNRELATED to the 18-04 df-faint sweep / NavRailShell honesty fixes. They live in files this plan did not create or behaviourally modify (e.g. `ServiceHealthGrid.tsx:138 nowMs = Date.now()`, untouched by 18-04). The rules are react-hooks v6 `react-hooks/purity` ("Cannot call impure function during render" — `Date.now()` / `new Date()` read directly in a component body), one `react-hooks` setState-in-effect, one legacy `react/no-deprecated` (`ReactDOM.render`), and one `@next/next/no-assign-module-variable`. Affected files: `ServiceHealthGrid.tsx`, `NodeSupportingServices.tsx`, `IncidentTrackingControls.tsx`, `OnHostNodes.tsx`, `HostCard.tsx`, `RefreshControl.tsx`, `NavRailShell.test.tsx` (react/no-children-prop in the test render helper). The new `scripts/df-faint-guard.sh` passes exit 0 on its own (`npm run lint:df-faint`), and every file 18-04 created or modified lints clean. Recommended follow-up: a hardening plan to inject `now` as a prop across these components (the PollAge/FreshnessChip pattern) and migrate the legacy `ReactDOM.render`.

## RESOLVED 2026-07-31

- **tests/node companion updates — COMMITTED.** The three files left dirty by 18-02
  (`tests/node/lib/pg-harness.sh`, `tests/node/check-queue.bats`,
  `tests/node/check-apply-fee-static.sh`) are now committed. The mock `lncli` serves
  `listchannels`/`getchaninfo` so apply-fee's live time_lock_delta resolution
  succeeds under the docker-gated bats suite, and the static gate asserts
  SIGNED_PARAMS / pubkey_mismatch / getchaninfo / time_lock_delta_unresolved.

- **18-10 live-DB self-approve proof — DONE.** `src/lib/queue/self-approve-guard.test.ts`
  ran against a real nodemon DB (test VM, PostgreSQL 14.23) and passed 7/7: self-approve
  rejected, operator-only edges rejected, all three legal executor edges allowed, and the
  dashboard approval path unaffected. Caveat: proven on PG 14.23, not production's 18.4.
  Migration 0005 is applied on the TEST server only — production still lacks it.
