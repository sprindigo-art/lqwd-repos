---
phase: 01-foundations-read-layer
slug: foundations-read-layer
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-09
---

# Phase 1 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (`register_authored_at_plan_time: true`). This audit
> VERIFIES each declared mitigation exists in shipped code — it does not scan for new threats.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| build output → client bundle | Tailwind/brand config + pure utilities ship to the client; must carry no secrets/DB strings. | brand tokens, pure number formatters |
| numeric source → display | Warehouse integer sats/msat → human strings; one wrong conversion corrupts every downstream figure. | sat / BTC / msat values |
| Next.js server → warehouses (192.243.215.101) | App authenticates as a read-only role and must never write to the externally-managed warehouses. | SELECT-only query traffic |
| server module → client bundle | DB connection strings / passwords must never reach a `"use client"` file or a prop. | DB URLs, role passwords |
| env / `.env.local` → source | Host URLs + role passwords live only in git-ignored env, never code. | credentials |
| per-backend rows → unified model | LND vs LDK column differences isolated to one mapper; an `any`-leak propagates wrong shapes app-wide. | node/channel rows |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-01-01 | Tampering (AFM-002) | `src/lib/format/units.ts` | mitigate | Single-source formatter; SATS_PER_BTC/MSAT_PER_SAT constants; reference-value + ±1% back-conversion tests | closed |
| T-01-02 | Information Disclosure | scaffold / `.env.example` | mitigate | `.env.example` names only; `.gitignore` excludes `.env.local`; no DB string in source | closed |
| T-01-03 | Tampering (npm supply chain) | npm installs | accept | In-workspace `lqwdclaw` lockfile provenance; RESEARCH audit zero [SLOP]/[SUS] | closed (accepted) |
| T-01-SC | Tampering (supply chain) | npm install | accept | Provenance via in-workspace production lockfile; no blocking checkpoint | closed (accepted) |
| T-02-01 | Tampering (warehouse write) | `dbRouting` / `dbLdk` | mitigate | Session-level `default_transaction_read_only: true` on both warehouse clients; boot write-probe asserts 25006/42501 (see Interim note) | closed |
| T-02-02 | Information Disclosure (cred leak) | `env.ts` / clients / `health.ts` | mitigate | `import "server-only"` first line on every DB/env module; no `NEXT_PUBLIC_`; health check logs no URLs/passwords | closed |
| T-02-03 | Elevation of Privilege | `db/role-grants.sql` | mitigate | Scoped `GRANT SELECT` on named tables (no blanket); `default_transaction_read_only`; A1 existence check; explicit no INSERT/UPDATE/DELETE | closed |
| T-02-04 | DoS (silent dev-DB fallback) | `env.ts` `requireEnv` | mitigate | Fail-loud `requireEnv` throws on missing var, no dev default; boot aborts | closed |
| T-02-05 | Information Disclosure (plaintext DB) | warehouse connection | accept | Warehouse has no SSL; `sslmode=prefer`; SELECT-only/low-value; SSH/VPN deferred to Phase 8 | closed (accepted) |
| T-02-SC | Tampering (supply chain) | npm installs | accept | No new packages in this plan; provenance from Plan 01 | closed (accepted) |
| T-03-01 | Tampering (AFM-001) | `src/lib/read/latest.ts` | mitigate | Single `DISTINCT ON (chan_id)` helper; `AND chan_id IS NOT NULL` (WR-01 fix); shape test forbids `MAX(` | closed |
| T-03-02 | Tampering (SQL injection) | `latestChannelsForNode` | mitigate | Drizzle `sql` tagged-template binding for `localPubkey`; test asserts `$1`, no concatenation | closed |
| T-03-03 | Tampering (warehouse mutation via tooling) | `drizzle-kit pull` | mitigate | Warehouse configs `PULL ONLY`; no migrate/generate; no committed pull artifacts | closed |
| T-03-04 | Information Disclosure ([ASSUMED] LDK columns) | `schema/ldk.ts` | mitigate | Live `information_schema` introspection recorded in `docs/LDK-INTROSPECTION.md`; schema columns trace to it | closed |
| T-03-SC | Tampering (supply chain) | npm installs | accept | No new packages; provenance from Plan 01 | closed (accepted) |
| T-04-01 | Tampering (model integrity) | `src/lib/read/nodes.ts` | mitigate | `mapLndNode`/`mapLdkNode` sole translation surface; typed rows, no `any`-leak; test asserts identical canonical key set | closed |
| T-04-02 | Information Disclosure (DB leak to client) | `src/app/(status)/page.tsx` | mitigate | Server Component (no `"use client"`); server-only DB imports; build fails if server-only reaches client bundle | closed |
| T-04-03 | Tampering (AFM-002 drift) | status page | mitigate | All sat/BTC via `formatSats`/`formatBtc`; raw sats in mapper; grep gate finds no inline conversion | closed |
| T-04-04 | Tampering ([ASSUMED] LDK columns) | `mapLdkNode` | mitigate | Maps only columns confirmed in `docs/LDK-INTROSPECTION.md` | closed |
| T-04-SC | Tampering (supply chain) | npm installs | accept | No new packages; provenance from Plan 01 | closed (accepted) |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

### Verification Evidence

| Threat ID | Evidence (file:line / command) |
|-----------|--------------------------------|
| T-01-01 | `src/lib/format/units.ts:4-19` (single formatter, 100_000_000 / 1_000); `src/lib/format/units.test.ts:8,42,47,50-52` (reference values 3359047565→33.5905, ±1% back-conversion) |
| T-01-02 | `.env.example:1-18` (names only, no values); `.gitignore:34` (`.env.local`); grep `NEXT_PUBLIC` in src → none |
| T-01-03 / T-01-SC | `package-lock.json` present; `01-RESEARCH.md:117-133` Package Legitimacy Audit, zero [SLOP]/[SUS] |
| T-02-01 | `warehouse-routing.ts:30` + `warehouse-ldk.ts:26` (`connection: { default_transaction_read_only: true }`); `health.ts:56-70,101-102` (write probe → 25006/42501 = PASS, write success throws); live boot check in 01-02-SUMMARY (both warehouses rejected 25006) |
| T-02-02 | `import "server-only"` first line: `env.ts:1`, `warehouse-routing.ts:1`, `warehouse-ldk.ts:1`, `nodemon.ts:1`, `health.ts:1`; no URL/password in any `console` call in `health.ts`; no `NEXT_PUBLIC` in src |
| T-02-03 | `db/role-grants.sql:27` (`default_transaction_read_only = on`), `:36-43,:72-77` (scoped `GRANT SELECT` named tables), `:63,:79` (no write grants), `:85-88` (`role_table_grants` verification); grep `GRANT SELECT ON ALL` → none |
| T-02-04 | `env.ts:11-17` (`requireEnv` throws on missing, no default); `instrumentation.ts:4-8` (boot abort); grep `localhost` in src/configs → none |
| T-02-05 | `.env.example:6,10` (`sslmode=prefer`); accepted-risk log below |
| T-02-SC / T-03-SC / T-04-SC | No new packages; provenance per Plan 01 |
| T-03-01 | `src/lib/read/latest.ts:24-36` (`DISTINCT ON (chan_id)`, `AND chan_id IS NOT NULL` WR-01 fix, `ORDER BY chan_id, timestamp DESC`); `latest.test.ts:18,28` (DISTINCT ON present, MAX absent); grep `max(` in latest.ts → none |
| T-03-02 | `src/lib/read/latest.ts:32` (`local_pubkey = ${localPubkey}` bound); `latest.test.ts:33-40` (asserts `$1`, params contains the injection string) |
| T-03-03 | `drizzle.routing.config.ts:1` + `drizzle.ldk.config.ts:1` (`PULL ONLY`); `drizzle.nodemon.config.ts:8` only migrate target; no `drizzle/` dir, `git ls-files` shows no tracked warehouse artifacts |
| T-03-04 | `docs/LDK-INTROSPECTION.md` (live `information_schema.columns` capture 2026-06-09); columns match `schema/ldk.ts:36-40` (is_channel_ready/usable, outbound/inbound_capacity_msat) |
| T-04-01 | `src/lib/read/nodes.ts:41-49,57-65,92-126` (typed `LndNodeRow`/`LdkNodeRow`, no `any`); grep `any` in nodes.ts → none; `nodes.test.ts:46,103` (both backends → identical canonical key set) |
| T-04-02 | `src/app/(status)/page.tsx:1-5` (server-only DB imports), no `"use client"`; grep → none |
| T-04-03 | `page.tsx:142,145,148` (`formatSats`/`formatBtc`); grep `1e8\|/1000\|100000000` in nodes.ts + page.tsx → none |
| T-04-04 | `nodes.ts:114-125` maps only LDK-INTROSPECTION-confirmed columns; balances via `feeMsatToSat` |

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-03 / T-01-SC | All packages in production use in sibling `lqwdclaw` (in-workspace lockfile provenance — strongest signal); RESEARCH Package Legitimacy Audit lists zero [SLOP]/[SUS]; `server-only`/`vitest` are first-party/well-known additions. | plan-time threat register | 2026-06-09 |
| AR-02 | T-02-05 | Warehouse host has no SSL; connections use `sslmode=prefer`. Read role is SELECT-only/low-value; transport encryption (SSH tunnel/VPN) deferred to HARDEN (Phase 8) per RESEARCH Security Domain. Interim dev path already runs over an SSH local-forward tunnel through the whitelisted Demo Grafana VM. | plan-time threat register | 2026-06-09 |
| AR-03 | T-02-SC / T-03-SC / T-04-SC | Plans 02–04 introduce no new packages; supply-chain provenance established in Plan 01. | plan-time threat register | 2026-06-09 |

*Accepted risks do not resurface in future audit runs.*

---

## Interim Access Note (T-02-01) — assessed, not a gap

The plan-time mitigation wrote read-only as enforced at a dedicated `nodemon_ro` role.
That role is **not yet provisioned**; per operator decision (01-02-SUMMARY "Checkpoint
Resolution") the warehouse read path currently authenticates as the existing
`grafana_demo_ro` role through an SSH local-forward tunnel.

**Effective mitigation is satisfied:** both warehouse clients set
`connection: { default_transaction_read_only: true }` (`warehouse-routing.ts:30`,
`warehouse-ldk.ts:26`), so every NodeMonitor warehouse session is read-only at the
session level — any write hits SQLSTATE 25006 regardless of role grants. The boot
health check verifies this live (write probe → 25006 on both warehouses, per
01-02-SUMMARY Verification Results). The `pgCode` helper walks Drizzle's `.cause`
chain (`health.ts:31-39`) so the wrapped 25006 is correctly detected. T-02-01's
**intent — NodeMonitor cannot write to the warehouses — is met today.**

**Carried-forward follow-ups (not blockers; durable role-level guarantee):**
1. Provision the dedicated `nodemon_ro` role via `db/role-grants.sql` (artifact ready, content verified) + whitelist the run-host IP, then drop the grafana bridge.
2. `REVOKE CREATE ON SCHEMA public FROM PUBLIC` on `routing_vm` + `ldk-lspd-main` — `grafana_demo_ro` (and any role) currently holds CREATE on `public`; existing data is already SELECT-only protected.

---

## Unregistered Flags

None. No `## Threat Flags` section is present in any Phase 1 SUMMARY (01-01 … 01-04),
and no new attack surface appeared during implementation without a mapped threat ID.
The 01-REVIEW.md findings (WR-01…WR-06, IN-01…IN-05) are correctness/robustness
findings; WR-01 (NULL `chan_id`) was fixed in code (`latest.ts:33`) and reinforces
T-03-01. No review finding constitutes an unmitigated declared threat.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-09 | 19 | 19 | 0 | gsd-security-auditor |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-09
