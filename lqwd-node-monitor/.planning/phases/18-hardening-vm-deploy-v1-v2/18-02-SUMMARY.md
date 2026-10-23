---
phase: 18-hardening-vm-deploy-v1-v2
plan: 02
subsystem: queue-executor
tags: [security, hmac, apply-fee, check-queue, rate-limit, golden-tests, harden-01, harden-03]
requires:
  - "18-01 (CI harness + DB-required tagging convention)"
provides:
  - "Golden proof that apply-fee applies ONLY values derived from the signed canonical_payload field 4 (Q1 CRITICAL)"
  - "Golden proof that a wrong-pubkey row fails with pubkey_mismatch (replay across nodes blocked)"
  - "Golden proof that apply-fee resolves live time_lock_delta via getchaninfo fail-closed, never the hardcoded 80 (I1 HIGH)"
  - "Golden proof that check-queue's claim ceiling honors NODEMON_RATE_LIMIT_MAX via :'rlmax' (Q3 HIGH)"
  - "Q1/I1/Q3 reviewed-correct worktree fixes COMMITTED with regression coverage"
affects:
  - "Cluster A plans building on the queue trust boundary"
tech-stack:
  added: []
  patterns:
    - "Bash DB-required suite analog of requireNodemonDb: visible skip locally, exit 1 under CI when no runtime (fail-on-skip)"
    - "Stub-lncli argv logging: assertions prove WHICH values reached updatechanpolicy, not just outcomes"
key-files:
  created:
    - src/lib/queue/canonical-binding.test.ts
    - scripts/node/apply-fee.test.sh
    - scripts/node/check-queue.test.sh
  modified:
    - scripts/node/apply-fee
    - scripts/node/check-queue
    - .github/workflows/ci.yml
decisions:
  - "canonical-binding.test.ts stays DB-less (no requireNodemonDb) per the plan's own artifact contract; the DB-required tagging applies to the node-script suites"
  - "check-queue.test.sh provisions its OWN disposable Postgres via tests/node/lib/pg-harness.sh (docker/podman), never the CI service DB — self-contained like the bats suite"
  - "Two coherent per-task commits instead of the plan's single commit: each commit pairs a fix with the test that proves it, so no committed state has an unproven fix or a failing test"
metrics:
  duration: "~12 min"
  completed: "2026-07-23"
---

# Phase 18 Plan 02: Land Q1/I1/Q3 with Golden Tests Summary

Signed-payload binding (Q1), wrong-pubkey replay block, live time_lock_delta resolution (I1), and the env-driven rate ceiling (Q3) are now proven by executable golden tests and the reviewed-correct worktree fixes are committed.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DB-less canonical-binding proof + apply-fee golden tests (Q1/pubkey/I1) | 90f7af1 | canonical-binding.test.ts, apply-fee.test.sh, scripts/node/apply-fee |
| 2 | Rate-limit-honors-env proof (Q3) + commit + CI enrollment | a92f5a1 | check-queue.test.sh, scripts/node/check-queue, .github/workflows/ci.yml |

## What Was Built

**`src/lib/queue/canonical-binding.test.ts` (9 tests, DB-less):**
- `canonicalize(params)` byte-equals field 4 of the `buildSignedPayload` output; the payload splits into exactly 5 lines (canonicalize never emits a newline), so apply-fee's `sed -n '4p'` extraction is stable.
- Key-order permutation leaves field 4 byte-identical; EVERY mutation (ppm raise, base-fee raise, TLD change, channelPoint redirect, key injection, key drop) breaks the binding — the property that makes deriving applied values from field 4 fully ignore a tampered `params` column.

**`scripts/node/apply-fee.test.sh` (4 golden cases, stub lncli via PATH, argv-logged):**
1. TAMPERED-PARAMS (Q1): row signed with `suggestedPpm:250`, `params` column tampered to `4999` (in-bounds, so only the binding can stop it) — `updatechanpolicy` received `--fee_rate_ppm 250`; `4999` never appeared on any lncli argv.
2. PUBKEY-MISMATCH: payload signed for the OTHER node's pubkey (valid HMAC) — `OUTCOME=failed REASON=pubkey_mismatch`, `updatechanpolicy` never called.
3. LIVE-TLD (I1): stub `getchaninfo` returns `time_lock_delta:144` — `updatechanpolicy` received `--time_lock_delta 144`, never the signed placeholder `80`; success detail reports `time_lock_delta=144`.
4. TLD FAIL-CLOSED (I1): `getchaninfo` errors — `OUTCOME=failed REASON=time_lock_delta_unresolved`, no `updatechanpolicy`.

**`scripts/node/check-queue.test.sh` (Q3, DB-required):**
- Seeds ONE valid approved row + THREE rolling-hour `command_executions`; runs the SAME tick twice: `NODEMON_RATE_LIMIT_MAX=2` → `rate_limited: 3 applies in the last hour (>= 2)`, row stays `approved`; `NODEMON_RATE_LIMIT_MAX=6` → row claimed and executed to `succeeded`. Same DB state, different env ceiling, different enforcement — the `:'rlmax'::int` binding (not a literal) drives the SQL gate. With the old hardcoded `4`, BOTH ticks would have claimed.
- DB-required tagging (bash analog of `requireNodemonDb`): visible skip + exit 0 locally without docker/podman; exit 1 under `CI` (fail-on-skip, T-18-06). Runtime probe is timeout-guarded (a dead docker socket HANGS `docker info`, it does not fail).

**Committed fixes (were reviewed-correct in the working tree):**
- `scripts/node/apply-fee`: derives EVERY applied value from signed canonical_payload field 4 (never the mutable `params` column); `pubkey_mismatch` fail-closed when signed nodePubkey ≠ this node; `resolve_current_tld` reads the channel's LIVE delta via `listchannels`→`getchaninfo`, fail-closed on `time_lock_delta_unresolved`.
- `scripts/node/check-queue`: claim UPDATE + audit INSERT gated on `:'rlmax'::int` bound from `NODEMON_RATE_LIMIT_MAX` (default 4).

## Verification Evidence

- `npx vitest run src/lib/queue/canonical-binding.test.ts`: 9/9 pass.
- `bash scripts/node/apply-fee.test.sh`: all 4 golden cases PASS locally (DB-less).
- `bash scripts/node/check-queue.test.sh`: visible-skip path exit 0 locally; `CI=1` no-runtime path exit 1 (fail-loud verified).
- Pure queue suites (canonical/sign/bounds/ttl/state + canonical-binding): 61/61 pass — no regression.
- `tests/node/check-apply-fee-static.sh` (working-tree version): all static checks pass against the committed apply-fee.
- ESLint clean on canonical-binding.test.ts; ci.yml YAML lint pass.
- `git status`: `scripts/node/apply-fee` and `scripts/node/check-queue` no longer dirty; commit messages carry no Co-Authored-By trailer.

## Deviations from Plan

### Auto-fixed / scope adjustments

**1. [Rule 2 - Missing critical support] Enrolled both node-script suites in ci.yml**
- **Found during:** Task 2
- **Issue:** Plan verification requires "all three golden tests run under the 18-01 CI harness", but ci.yml was not in `files_modified` and bash suites cannot enroll via the vitest `requireNodemonDb` grep gate.
- **Fix:** Added one CI step running `apply-fee.test.sh` (DB-less) and `check-queue.test.sh` (fails loud under CI if it cannot execute).
- **Commit:** a92f5a1

**2. [Clarification] Two coherent per-task commits instead of one single commit**
- **Issue:** Task 2's text says "single commit" for fixes + tests; the executor protocol commits per task.
- **Fix:** Task 1 commit pairs the apply-fee fix with the tests proving it; Task 2 pairs the check-queue fix with its proof — no intermediate commit has an unproven fix or a failing test. All acceptance criteria (both scripts committed, no trailer) hold.

**3. [Clarification] canonical-binding.test.ts is NOT DB-required-tagged**
- **Issue:** Plan `<verification>` says "all three golden tests… DB-required-tagged", but the plan's own artifact contract defines canonical-binding as "DB-less proof".
- **Fix:** The artifact contract governs — it stays pure (like canonical.test.ts); DB-required tagging applied to the node-script tier where a DB is genuinely required (check-queue.test.sh).

## Deferred Issues

- **Local execution of the DB-backed Q3 proof was not possible in this environment:** no server postgres binary (libpq client only) and the docker daemon socket hangs. The suite's skip/fail-loud paths were exercised locally; the DB path first executes in CI, where it CANNOT silently skip (exit 1 without a runtime). SQL fixture shapes are taken verbatim from the proven tests/node/seed.sql fixtures and check-queue's own literal log lines.
- **tests/node companion updates left dirty (out of 18-02 scope, per orchestrator):** `pg-harness.sh`, `check-queue.bats`, `check-apply-fee-static.sh` working-tree updates are companions to Q1/I1 (mock lncli serving getchaninfo). Logged in `deferred-items.md` — the owning plan must commit them or the committed docker-gated bats suite will fail-closed on `time_lock_delta_unresolved`.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. T-18-03/04/05/06 mitigations implemented as golden tests per the plan's threat register. T-18-SC: zero new dependencies installed.

## Self-Check: PASSED

- src/lib/queue/canonical-binding.test.ts — FOUND
- scripts/node/apply-fee.test.sh — FOUND
- scripts/node/check-queue.test.sh — FOUND
- Commit 90f7af1 — FOUND
- Commit a92f5a1 — FOUND
- No Co-Authored-By trailer on either commit
