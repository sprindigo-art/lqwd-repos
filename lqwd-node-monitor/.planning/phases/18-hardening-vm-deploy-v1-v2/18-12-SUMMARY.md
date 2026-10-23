---
phase: 18-hardening-vm-deploy-v1-v2
plan: 12
subsystem: db-boot-config
tags: [hardening, vm-deploy, env-only-boot, fail-loud, HARDEN-02]
requires:
  - "18-07: role-probe boot health check (assertReadOnly/assertWritable)"
provides:
  - "scripts/env-only-boot-guard.sh: static guard forbidding hardcoded host literals on the app boot-config path"
  - "env.ts REQUIRED_BOOT_ENV_VARS + assertBootEnv(): single-source fail-loud boot-env contract"
  - ".env.example: complete VM-flip env contract (required DB URLs + optional app tunables)"
affects:
  - "src/lib/db/health.ts (boot health check)"
  - "npm run lint (adds lint:env-boot)"
tech-stack:
  added: []
  patterns:
    - "single-source-of-truth env contract: env.ts owns the boot-required var list; health.ts + .env.example consume it"
    - "static grep guard scoped to connection context (URL/@/quote/:port) to avoid prose false-positives"
key-files:
  created:
    - scripts/env-only-boot-guard.sh
  modified:
    - src/lib/db/env.ts
    - src/lib/db/health.ts
    - src/lib/db/health.test.ts
    - .env.example
    - package.json
decisions:
  - "Guard scoped to the DASHBOARD boot-config path (src/lib/db, src/lib/config, src/instrumentation.ts); node-side fileserver scripts excluded as a separate trust domain (legitimate loopback + env-overridable fleet host)."
  - "Match host tokens only in a connection context so prose ('no localhost default') never trips the guard."
  - "env.ts is the single source of truth for boot-required vars; health.ts calls assertBootEnv() instead of duplicating the requireEnv list."
metrics:
  duration: ~25m
  completed: 2026-07-27
---

# Phase 18 Plan 12: Env-Only Boot Guard + Fail-Loud Boot-Env Contract Summary

Closed HARDEN-02: the local→VM flip is provably config-only — a static guard forbids hardcoded host literals on the app boot-config path, env.ts is the single-source fail-loud boot-env contract, and a missing required var halts the boot health check by name.

## What was built

### Task 1 — Env-only boot guard + single-source boot-env contract (commit 6652aeb)
- **`scripts/env-only-boot-guard.sh`** — greps the dashboard's boot-config paths (`src/lib/db`, `src/lib/config`, `src/instrumentation.ts`) for hardcoded connection host/port literals (`localhost`, `127.0.0.1`, `0.0.0.0`, embedded `postgres://…@host`, dotted-IPv4 host:port). Exits non-zero on a hit, zero when clean. Patterns require a **connection context** (URL scheme, `@` authority, surrounding quote, or `:port`) so documentation prose like "no localhost default" does not trip it. Test fixtures (`*.test.ts[x]`) and `.env.example` are excluded by design.
- Wired into `npm run lint` via a new `lint:env-boot` script.
- **`src/lib/db/env.ts`** — added `REQUIRED_BOOT_ENV_VARS` (the three DB URLs) and `assertBootEnv()` as the single source of truth for the fail-loud env-only-boot contract. `requireEnv` already threw by name with no dev-DB fallback; this makes the boot-required set explicit and reusable.
- **`.env.example`** — added an "App tunables (OPTIONAL)" section documenting `NODE_BACKENDS`, `NODEMON_OPERATOR_ID`, `INSIGHT_LLM_ENABLED`, `AI_MODEL` so the VM-flip env contract is complete (nothing discovered by surprise on a VM boot).

### Task 2 — Boot health check fails loud on misconfig (commit 9822dba)
- **`src/lib/db/health.ts`** — `runStartupHealthCheck()` now calls `assertBootEnv()` (from env.ts) instead of an inline `requireEnv(...)` triple, so the boot-required list is single-sourced. A missing required DB URL still halts the boot LOUD, naming the specific var (thrown from `instrumentation.ts` → aborts `next start`).
- **`src/lib/db/health.test.ts`** — added a DB-less `assertBootEnv` suite: each required var, when absent, throws `Missing required env: <NAME>`; a fully-configured boot passes; and the contract asserts the exact required trio. Runs with no network (no singletons, no warehouse access).

## Verification

- `bash scripts/env-only-boot-guard.sh` → clean (exit 0); negative tests injecting `postgres://…@127.0.0.1:5432`, `localhost:5432`, and `@192.243.215.101:5432` into a boot-config path all trip it (exit 1).
- `npx vitest run src/lib/db/health` → 9 passed, 1 skipped (live-DB suite skips without warehouse access).
- `npx tsc --noEmit` → clean (whole project).
- `npm run lint:env-boot` → clean.

## Must-haves satisfied

- No `localhost`/`127.0.0.1`/hardcoded host literal on the app boot-config path — verified: the DB clients (`warehouse-routing.ts`, `warehouse-ldk.ts`, `nodemon.ts`) resolve every URL via `requireEnv`; the guard proves it and blocks regressions.
- A missing/misconfigured required env var fails the boot health check LOUD (throws by name), not a silent default — `assertBootEnv()` + the new test suite.
- The local→VM flip is config-only: pointing the env vars at VM endpoints requires no code change (no host literal exists to change).

## Deviations from Plan

**Scope of the guard's boot-config paths (documented decision, not a code change).**
- The plan's Task 1 listed "fileserver scripts, collector runners" among boot-config paths to grep. Those node-side bash scripts (`scripts/fileserver/deploy-env.sh` etc.) legitimately contain `127.0.0.1` (the node's OWN local postgres for the read-only probe — a genuine loopback, not a flip target) and an env-overridable fleet DB host (`NODEMON_DB` default). They run ON each node, provisioned out-of-band from a root-only `.nodemon.env`; the **dashboard never reads them at boot**, so they are not on the app's boot-config path. Including them would false-positive on correct-by-design node-local loopback. The guard is therefore scoped to the dashboard boot path (`src/lib/db`, `src/lib/config`, `src/instrumentation.ts`) — the exact code that resolves a connection target at `next start`. This is documented in the guard's header block. HARDEN-02 ("the app boots on a VM from env vars only") is fully covered by this scope.

No auto-fixed bugs (Rules 1–3): the DB clients already resolved URLs via `requireEnv` from a prior plan; env.ts already had no localhost fallback. This plan added the guard, the single-source contract, the docs, and the fail-loud test.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path, or trust-boundary surface introduced. Work hardens the existing deploy-config → running-app boundary (T-18-29 / T-18-30) exactly as the plan's threat model prescribes.

## Self-Check: PASSED

- `scripts/env-only-boot-guard.sh` — FOUND
- `src/lib/db/env.ts` (assertBootEnv / REQUIRED_BOOT_ENV_VARS) — FOUND
- commit 6652aeb — FOUND
- commit 9822dba — FOUND
