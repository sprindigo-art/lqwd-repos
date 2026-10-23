# Phase 1: Foundations + Read Layer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-07
**Phase:** 1-Foundations + Read Layer
**Areas discussed:** Warehouse access & pooler, Golden reference data, nodemon queue DB in Phase 1, LND+LDK unification

---

## Warehouse access & pooler

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated nodemon_ro role | Fresh least-privilege read-only role; independent audit/revocation | ✓ |
| Reuse grafana_demo_ro | Existing role, zero provisioning, shared with Grafana demo | |

| Option | Description | Selected |
|--------|-------------|----------|
| Probe pooler in Phase 1 | Detect pooler mode against live DB, set `prepare` accordingly | ✓ |
| No pooler / direct | Prepared statements on | |
| Transaction-mode pooler | Set `prepare:false` | |

**User's choice:** Dedicated `nodemon_ro` role; probe pooler in Phase 1.
**Notes:** Read-only enforced at DB role level; drizzle-kit never points push/migrate at warehouses.

---

## Golden reference data

| Option | Description | Selected |
|--------|-------------|----------|
| Canada + Tier M + edge node | Correctness anchor + representative + edge; validates math AND fleet range | ✓ |
| Canada + Tier M | Anchor + representative only | |
| Canada only | Single node; risks overfit to outlier | |

| Option | Description | Selected |
|--------|-------------|----------|
| Live cross-consistency invariant | DISTINCT-ON count ≈ lnd_node_info.active_channels + spot sat→BTC | ✓ |
| Frozen literal from reviews | Hardcoded review numbers; brittle | |
| Both | Live invariant + frozen snapshot | |

**User's choice:** Canada + a Tier M node + an edge node; live cross-consistency invariant.
**Notes:** User raised that Canada is an infra outlier (different Ubuntu, 128 GB, Tier XL). Resolved: the read layer reads the shared warehouse, not node OS, so Canada's infra is irrelevant to query/formatter correctness — it stays the correctness anchor; the Tier M + edge nodes exist for representativeness so the unified model isn't overfit. Proposed picks: Sweden (Tier M), India (edge) — confirm at plan time.

---

## nodemon queue DB in Phase 1

| Option | Description | Selected |
|--------|-------------|----------|
| Provision DB + RW role + client, defer tables | Meets three-client AC; queue tables in Phase 6 | ✓ |
| Fully defer nodemon to Phase 6 | Only two read clients in Phase 1 | |

| Option | Description | Selected |
|--------|-------------|----------|
| Local Postgres now, config-driven | Env-driven URL; relocates at Phase 6/7 | ✓ |
| On the warehouse VM | Immediately node-reachable | |
| Dedicated instance now | Cleanest isolation, most upfront infra | |

**User's choice:** Provision DB + RW role + wire client, defer tables; local Postgres now, config-driven.
**Notes:** nodemon is the only DB drizzle-kit ever migrates.

---

## LND+LDK unification

| Option | Description | Selected |
|--------|-------------|----------|
| Introspect both schemas first, then design union | Read-only drizzle-kit pull both warehouses → curate model | ✓ |
| LND-first with adapter seam | Build on routing_vm now, map LDK later | |

| Option | Description | Selected |
|--------|-------------|----------|
| LDK access available now | Design against both warehouses immediately | ✓ |
| Not yet — LND-first | Build LND-first, fold LDK later | |
| Not sure | Attempt, fall back | |

**User's choice:** Introspect both first; live LDK access available now.
**Notes:** User clarified concern about whether this means a new DB / replacing schemas. Resolved: `drizzle-kit pull` is read-only schema introspection that generates TypeScript code from the existing structure — it does not create/alter/drop anything in the warehouses and copies no rows. The app reads live from the two separate warehouses; no data is replicated locally. The only new DB is `nodemon` (write queue, local). Existing schemas are never modified.

---

## Claude's Discretion

- App scaffolding specifics (Next.js init, npm, `@/` alias, ESLint/Prettier) — match sibling `lqwdclaw`.
- Boot-time read-only verification mechanism (attempt-write-and-fail vs grant inspection) — "fail loudly" is the only requirement.
- Whether Phase 1 ships a minimal health/status page vs pure data-layer + tests — planner's call.

## Deferred Ideas

- nodemon queue tables + HMAC + state machine → Phase 6 (by design).
- Final nodemon hosting location (warehouse VM vs dedicated) → Phase 6/7 when node-reachability is needed.
