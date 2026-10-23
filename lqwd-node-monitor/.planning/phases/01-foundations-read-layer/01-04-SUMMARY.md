---
phase: 01-foundations-read-layer
plan: 04
subsystem: read-layer
tags: [unified-model, read-04, per-backend-boundary, lnd, ldk, afm-002, status-page, server-component]
requires:
  - "01-03 curated warehouse schemas (schema/routing.ts, schema/ldk.ts) + latestChannelsForNode()"
  - "01-01 AFM-002 formatter (@/lib/format/units) + vitest @/ alias"
  - "01-02 warehouse clients (dbRouting/dbLdk) + interim live grafana bridge"
provides:
  - "UnifiedNode model + mapLndNode/mapLdkNode — the SOLE per-backend translation surface (READ-04, D-10)"
  - "Typed LndNodeRow/LdkNodeRow inputs + UnifiedNodeWithExtras discriminated union (no any-leak)"
  - "Navy/dark fleet-status page (now the / route) rendering both fleets through the unified model + AFM-002"
affects:
  - "Phases 2/3 build the real UI on top of UnifiedNode (this page is intentionally trivial)"
  - "Any consumer of per-node data imports UnifiedNode — backend differences never leak past nodes.ts"
tech-stack:
  patterns:
    - "Per-backend boundary: mapLndNode/mapLdkNode are the only place LND vs LDK columns are mapped (D-10)"
    - "Balances stay RAW sats in the model; LDK msat normalized via AFM-002 feeMsatToSat, never inline math"
    - "Status page force-dynamic so npm run build does not prerender it against the live warehouse"
key-files:
  created:
    - "src/lib/read/nodes.ts (UnifiedNode + mapLndNode/mapLdkNode + typed rows + discriminated union)"
    - "src/lib/read/nodes.test.ts (no-DB unit test: both backends → identical UnifiedNode shape)"
    - "src/app/(status)/page.tsx (thin navy/dark Server Component status page)"
  modified: []
  deleted:
    - "src/app/page.tsx (Plan-01 placeholder; removed to resolve / route collision with the (status) group)"
decisions:
  - "D-10 honored: unified model designed against BOTH live warehouses; mapLndNode/mapLdkNode are the single per-backend translation surface; the rest of the app sees only UnifiedNode."
  - "LDK is single-node (the LSP itself): the status page aggregates lightning_channels into ONE UnifiedNode (no LSP-self-pubkey column exists; identified by alias) — local/remote = outbound/inbound capacity in msat → sat via AFM-002."
  - "Status page became the / route by removing the Plan-01 placeholder landing (a (status) route group adds no URL segment, so it collided with root page.tsx)."
metrics:
  duration: "~22 min"
  completed: "2026-06-09"
  tasks: 2
  files: 3
---

# Phase 1 Plan 04: UnifiedNode Per-Backend Boundary + Fleet-Status Page Summary

LND (`routing_vm`) and LDK (`ldk-lspd-main`) node data now normalize into one `UnifiedNode` model through a single per-backend translation surface (`mapLndNode` / `mapLdkNode`), and a thin navy/dark Server Component status page renders both fleets identically through that model + the AFM-002 formatter — the read layer visibly works end-to-end (READ-04).

## What Was Built

- **Task 1 — UnifiedNode model + mappers (TDD)** (RED `b26af10` → GREEN `b0c519a`): `src/lib/read/nodes.ts` exports `Backend`, `UnifiedNode`, typed `LndNodeRow`/`LdkNodeRow` inputs, a `UnifiedNodeWithExtras` discriminated union for backend-only extras (no `any` escape), and `mapLndNode`/`mapLdkNode` as the ONLY per-backend surface (D-10). LND balances stay RAW sats; LDK msat balances normalize to sats via the AFM-002 `feeMsatToSat` (the sole sanctioned msat→sat path — no inline math). Null counts/balances coerce to explicit `0`/`null`, never undefined. `nodes.test.ts` (no DB) feeds an LND fixture and an LDK fixture and asserts both yield the IDENTICAL `UnifiedNode` key set, that balances are not mis-converted, and that no `undefined` leaks.
- **Task 2 — Fleet-status page** (`46959b6`): `src/app/(status)/page.tsx`, a Server Component (no client directive) that reads `lnd_node_info` (all LND nodes) and aggregates `lightning_channels` into one LDK node server-side, maps both through `mapLndNode`/`mapLdkNode`, and renders a single navy `#1A3C79` dark table (backend, alias, short pubkey, active channels, local/remote sats, local BTC) with every sat/BTC value through `formatSats`/`formatBtc`, plus a data-freshness timestamp. Marked `force-dynamic` so the build renders it at request time, not against the live DB.

## Verification Results

- `npx tsc --noEmit` → clean (exit 0).
- `npx vitest run src/lib/read/nodes.test.ts` → 8/8 pass.
- `npx vitest run` (full) → **28 passed | 4 skipped** — live golden/integration tests skip cleanly without `ROUTING_VM_DATABASE_URL`; `nodes.test.ts` is pure and always runs.
- `npm run build` → exit 0; `/` is `ƒ (Dynamic)` (server-rendered on demand, NOT prerendered against the warehouse). Server-only DB import did not leak into a client bundle.
- `grep -n "1e8\|/ 1000\|/1000\|100000000" src/lib/read/nodes.ts` → nothing (formatter owns all conversion).
- `grep -rn "1e8\|/1000\|100000000" src/app/(status)/page.tsx` → nothing.
- `grep ": any\|as any" src/lib/read/nodes.ts` → no backend-field `any`-leak.
- Page is a Server Component (no `"use client"` directive); references navy `#1A3C79`, not `#F7931A`.
- `mapLdkNode` references only msat fields confirmed in `docs/LDK-INTROSPECTION.md`.

## TDD Gate Compliance

- Task 1: RED `b26af10` (`test(...)`, failing — module missing) precedes GREEN `b0c519a` (`feat(...)`, 8/8 passing). REFACTOR not needed. Gate satisfied.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `(status)` route group collided with the Plan-01 root `page.tsx` (`/`)**
- **Found during:** Task 2 `npm run build`
- **Issue:** A Next.js route group `(status)` adds NO URL segment, so `src/app/(status)/page.tsx` resolves to `/` — the same route as the existing Plan-01 placeholder `src/app/page.tsx`. The first build silently shadowed the status page (root "foundations online" page won `/`; the status page was unreachable and prerendered as static instead of dynamic).
- **Fix:** Removed the Plan-01 placeholder `src/app/page.tsx` (explicitly described in 01-01-SUMMARY as a no-data placeholder; "fleet UI lands in Phases 2+"). The `(status)` group's page now serves `/` cleanly as `ƒ (Dynamic)`. The plan's literal artifact path `src/app/(status)/page.tsx` is preserved.
- **Files modified:** deleted `src/app/page.tsx`; added `src/app/(status)/page.tsx`
- **Commit:** `46959b6`

### Other notes

- **LDK single-node aggregation (design call within plan scope):** the LDK warehouse is single-node (the LSP itself) and `lightning_channels` rows carry counterparty `peer_pubkey`, NOT an LND-style `local_pubkey` partition (docs/LDK-INTROSPECTION.md). The page therefore aggregates all channels into ONE `UnifiedNode` — `activeChannels` = usable-channel count, local/remote balances = summed outbound/inbound capacity (msat → sat via AFM-002). No LSP-self-pubkey column exists, so the node is identified by its alias label. This is the intended Phase-1 thin LDK deliverable; deeper LDK detail lands when later phases consume it.
- **`.planning/config.json`** showed an orchestrator-set `_auto_chain_active: false` flag change (not made by this plan) — left unstaged as out-of-scope.

## Authentication Gates

None — Task 1 is pure (no DB); Task 2 reads the live warehouses via the already-provisioned interim bridge (`.env.local`), no new credentials.

## Known Stubs

None. The LDK `pendingChannels: 0` is not a stub but an honest mapping — pending-channel state is not derivable from the four granted LDK columns (documented in `docs/LDK-INTROSPECTION.md`); the unified model exposes it as explicit `0` rather than fabricating a value.

## Notes for Downstream

- Import `UnifiedNode` + `mapLndNode`/`mapLdkNode` from `@/lib/read/nodes`. The rest of the app must NEVER branch on backend or touch backend-specific columns — those live only inside the two mappers (D-10). Backend-only extras go on `UnifiedNodeWithExtras`, never `any`.
- All sat/BTC/msat rendering stays on `@/lib/format/units` (AFM-002); the grep guard catches inline `/1e8` or `/1000`.
- The status page is intentionally trivial (Claude's-discretion UI). Phases 2/3 own the real fleet UI and may replace `/` — `UnifiedNode` is the stable contract they build on.
- Live reads require the SSH tunnel (`127.0.0.1:15432`) + local nodemon Docker (`:5433`) up; Next auto-loads `.env.local` for `build`/`start` (vitest/ad-hoc scripts do not — `set -a; . ./.env.local; set +a` for those).

## Self-Check: PASSED

Declared files exist (`src/lib/read/nodes.ts`, `nodes.test.ts`, `src/app/(status)/page.tsx`); deletion of `src/app/page.tsx` confirmed; task commits `b26af10`, `b0c519a`, `46959b6` present in git log.
