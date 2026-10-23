---
phase: 04
slug: insight-engine
status: verified
threats_open: 0
asvs_level: 2
created: 2026-06-12
---

# Phase 04 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Insight Engine — deterministic detector pipeline producing severity-ranked
> recommendation cards under a frozen zod schema contract, an off-by-default LLM
> narration layer, and the `/inbox` + `/pending` UI surfaces. These cards are the
> hard contract Phase 5 (command export) and Phase 6 (signed write queue) consume,
> so every threat about params/actions reaching the signing or execution surface
> is load-bearing.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Warehouse → engine | Read-only Drizzle clients query `routing_vm` / `ldk-lspd-main` event-driven tables | Channel/forwarding/close rows (no secrets) |
| Engine → card contract | `InsightCardArraySchema.parse` final gate before any card renders or is persisted | Recommendation cards `{severity, node, target, signal, evidence, suggestedAction, params}` |
| Card → Phase 5/6 signing surface | `suggestedAction.params` become exported runbooks (P5) and HMAC-signed intents (P6) | Write params (fee ppm, channel point, sweep sat/vB) |
| Server → client (RSC → leaf) | Engine + AI SDK are `server-only`; client leaves call server actions only | Pre-formatted serializable card data; no DB clients, no API keys |
| LLM provider boundary | Off-by-default narration; card JSON in → prose out | Untrusted-delimited card data; plain-text prose (never params) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-04-01 | Elevation of privilege | LLM-provenance cards reaching signing surface | mitigate | D-12 `superRefine` in schema.ts; contract test asserts rejection | closed |
| T-04-02 | Tampering | Loose params into canonical(params) signing | mitigate | Discriminated union, `.strict()` every level, `investigate` carries `{}`, `asOf` ISO string | closed |
| T-04-04 | Tampering | deeplink open-redirect / href injection | mitigate | PUBKEY_RE + TAB_KEYS + WINDOW_PRESETS whitelists; relative-only; throws on violation | closed |
| T-04-05 | Tampering | Threshold fork drift | mitigate | D-13 reads `SCORECARD_CONFIG` at use-sites; config.test asserts no fork knobs | closed |
| T-04-06 | Tampering | SQL injection via cluster window param | mitigate | Drizzle `sql` template binding; shape test asserts bound param | closed |
| T-04-07 | Denial of service | Unbounded fleet scan | accept | Single windowed aggregate; GROUP BY bounded by ~26 nodes (see Accepted Risks) | closed |
| T-04-08 | Tampering | SQL injection via window param | mitigate | Bound `windowDays` via sql template | closed |
| T-04-09 | Information disclosure | server-only DB client leaking into client/test import graph | mitigate | Lazy-import executor pattern; top-level import test | closed |
| T-04-10 | Tampering | SQL injection via window params | mitigate | Bound params with `::int` casts | closed |
| T-04-11 | Elevation of privilege | Step-down emitting `update_fee` (auto-restoring crashed fees) | mitigate | `suggestedAction` hard-coded `investigate`; restoration target only in evidence | closed |
| T-04-12 | Tampering | `update_fee` params malformed for signing | mitigate | InsightCardSchema parse; six param fields required | closed |
| T-04-13 | Tampering | SQL injection via rebalance window/HAVING params | mitigate | Bound params; shape test asserts | closed |
| T-04-14 | Elevation of privilege | restart/remediate ever becoming auto-execute | mitigate | `remediate_pending` data-only (case enum fixed); P5 renders runbook; **now also withheld on flagged nodes** (see T-04-16) | closed |
| T-04-15 | Tampering | Unbounded rebalance amountSat param | mitigate | `rebalanceMaxAmountSat` cap (5M) in detect() | closed |
| T-04-16 | Elevation of privilege | Suppressed write params reaching Phase 5/6 | mitigate | **`applySuppression` nulls `suggestedAction` for ALL write types incl. `remediate_pending` (fix `a1f476f`)**; withheld type display-only; tests assert null on flagged, retained on clean | closed |
| T-04-17 | Tampering | Suppression disabled by config label edits | mitigate | Flag built from typed `tier1Breach`, not label matching; grep assertion | closed |
| T-04-18 | Tampering | SQL injection via hysteresis window param | mitigate | Bound param; shape test asserts | closed |
| T-04-19 | Tampering | Prompt injection via peer aliases | mitigate | Aliases delimited as data; plain-text output; narrative cannot write params | closed |
| T-04-20 | Elevation of privilege | LLM producing/altering numeric params | mitigate | `narrateCards` prose only — no parse path; ap12 cards locked `info`/null-action by superRefine | closed |
| T-04-21 | Tampering | Client-supplied cards as prompt input | mitigate | Server action recomputes via `loadInsightView()`; no card param; pubkey regex-validated | closed |
| T-04-22 | Information disclosure | ANTHROPIC_API_KEY in client bundle | mitigate | `server-only` on provider/narrative; lazy import behind env gate | closed |
| T-04-23 | Cross-site scripting | LLM output rendered as HTML | mitigate | Plain-text rendering; no `dangerouslySetInnerHTML`/markdown; grep clean | closed |
| T-04-24 | Elevation of privilege | Forged card shapes reaching render or P5/6 | mitigate | `InsightCardArraySchema.parse` final gate; engine test asserts forged card throws | closed |
| T-04-25 | Information disclosure | Engine (DB clients, env) leaking into client bundle | mitigate | `import "server-only"` on engine.ts | closed |
| T-04-26 | Denial of service | Detector failure cascading to page outage | mitigate | Per-read `degrade()` catch→fallback; fail-loud `console.error`; test asserts partial view | closed |
| T-04-27 | Cross-site scripting | Alias/channel-point strings in card rows | mitigate | React JSX text rendering (auto-escaped); no `dangerouslySetInnerHTML` | closed |
| T-04-28 | Tampering | Card deepLink as href | mitigate | Links built only by deeplink.ts (validated relative paths); rows render unmodified | closed |
| T-04-29 | Information disclosure | Suppressed write params visible in DOM | mitigate | `suggestedAction` null on suppressed cards; only withheld-type string renders | closed |
| T-04-30 | Tampering | Insight read executing before URL validation | mitigate | Read in post-gauntlet `Promise.all` after PUBKEY_RE/TAB_KEYS/WINDOW_PRESETS gauntlet | closed |
| T-04-31 | Denial of service | Insight engine failure breaking the console | mitigate | `.catch(() => null)` degrade — console renders without insight rows | closed |
| T-04-32 | Repudiation | Phase sign-off without live verification | mitigate | Blocking operator checkpoint (3 fixes before sign-off); SUMMARY + VERIFICATION record live golden 4/4 | closed |
| T-04-SC | Tampering | npm installs (zod, ai, @ai-sdk/anthropic) | mitigate | Package audit: `zod@3.25.76`, `ai@6.0.202`, `@ai-sdk/anthropic@3.0.83` — no install lifecycle scripts; lqwdclaw-proven | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-04-01 | T-04-07 | Fleet close-cluster scan is a single windowed aggregate (24h default) with `GROUP BY` bounded by fleet size (~26 nodes). No unbounded scan surface; matches the Phase 2 dimension precedent (T-02-05). | Joshua Jackson | 2026-06-12 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-12 | 33 | 32 | 1 | gsd-security-auditor (initial) |
| 2026-06-12 | 33 | 33 | 0 | orchestrator (after T-04-16 fix `a1f476f`) |

**Audit notes:** Initial audit found T-04-16 OPEN (BLOCKER) — `remediate_pending`
was absent from `WRITE_ACTION_TYPES`, so its live params survived D-14
suppression on AP-11-flagged nodes (also surfaced as code-review WR-02).
Operator decided (2026-06-12) to withhold it like all other writes; fix `a1f476f`
adds it to the set with suppression test coverage. Re-verified: full suite 496
passed, `tsc` clean, no `dangerouslySetInnerHTML`, all SQL builders bind params.
T-04-14's reliance on suppression now also holds.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter
