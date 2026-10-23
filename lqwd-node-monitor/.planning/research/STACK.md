# Stack Research

**Domain:** Local-first Lightning Network node-operator control dashboard (multi-node LND + LDK/LSPD fleet)
**Researched:** 2026-06-05
**Confidence:** HIGH

## TL;DR — Keep or Change

The spec's stack is **correct for 2025/2026 and proven inside this very workspace** — `lqwdclaw/package.json` already ships Next 16, React 19, Tailwind v4, Drizzle 0.45, `postgres` 3.4, shadcn 4, and `ai` 6.0.x in production. **Keep every locked choice.** This research only pins versions and resolves the 5 open questions. The one place to be explicit (the spec said "e.g. Recharts"): **commit to Recharts 3.x** — it is the right call, not a placeholder.

| Spec choice | Verdict | Note |
|---|---|---|
| Next.js App Router + TS | **KEEP** | 16.2.7 current; matches lqwdclaw |
| React 19 | **KEEP** | 19.2.x; required by Next 16 |
| Drizzle ORM | **KEEP** | Hand-write schema from `drizzle-kit pull`, do NOT let it own/migrate the warehouses |
| `postgres` (postgres.js) driver | **KEEP** | Already in lqwdclaw; correct for a long-running VM app (NOT serverless) |
| Tailwind v4 + shadcn/ui | **KEEP** | shadcn fully GA on v4 + React 19; `npx shadcn@latest` (canary no longer needed) |
| Charts: "a React lib (e.g. Recharts)" | **KEEP → pin Recharts 3.x** | Native React 19 support; best fit for shadcn + time-series |
| HMAC signing (node crypto) | **KEEP** | Use hex + key-sorted canonical JSON; verify in bash via `openssl dgst` |
| Vercel AI SDK `getModel()`, default Claude | **KEEP** | `ai` 6.0.x + `@ai-sdk/anthropic` 3.0.x, `generateText` |

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js (App Router) | **16.2.7** (`16.1.6` to match lqwdclaw exactly) | UI + API + RSC | Already the workspace standard; Server Components fetch warehouse reads, Client Components host interactive controls/charts. Long-running `next start` on a VM (not serverless) sidesteps connection-pool churn. |
| React | **19.2.x** (`19.2.3` to match) | UI runtime | Mandated by Next 16. `react-dom` must match exactly. |
| TypeScript | **5.x** | Types | Strict mode, `@/` path alias — workspace convention. |
| Drizzle ORM | **0.45.2** (`^0.45.1` to match) | Typed SQL access | Workspace standard. Used here as a **typed query builder over existing tables**, not a schema owner (see §1). |
| drizzle-kit | **0.31.10** (`^0.31.9` to match) | `pull` introspection + `nodemon` migrations | Use `pull` once per warehouse to generate types; use `generate/migrate` ONLY for the new `nodemon` DB. |
| postgres (postgres.js) | **3.4.9** (`^3.4.8` to match) | Postgres driver | The driver lqwdclaw already pairs with Drizzle. Built-in pool, simple read-only config. Preferred over `node-postgres`/`pg` for this stack's consistency. |
| Tailwind CSS | **4.3.0** (`^4` to match) | Styling | v4 is GA and the workspace default; CSS-first `@theme` config, no `tailwind.config.js` needed. |
| @tailwindcss/postcss | **^4** | PostCSS plugin | Required Tailwind v4 integration (v4 moved the PostCSS plugin to its own package). |
| shadcn/ui (CLI `shadcn`) | **4.10.0** (`^4.0.2` to match) | Component primitives | Full Tailwind v4 + React 19 support; `forwardRef` removed, `@theme` supported. |
| Recharts | **3.8.1** | Time-series charts | Native React 19 peer support in v3; SVG, declarative, pairs cleanly with shadcn's `chart` block. See §2. |
| ai (Vercel AI SDK) | **6.0.197** (`^6.0.116` to match) | Optional LLM narrative | Same major as lqwdclaw; `generateText({ model, prompt })`. See §5. |
| @ai-sdk/anthropic | **3.0.81** (`^3.0.58` to match) | Default Claude provider | Matches lqwdclaw's `getModel()` pattern. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:crypto (built-in) | Node 20+ | HMAC-SHA256 command signing | Always — no dependency needed. `createHmac('sha256', secret).update(canonical).digest('hex')`. See §4. |
| zod | **^3.23** | Param validation for queue intents | Validate `update_fee` params (ppm/base bounds) before enqueue; mirror the gateway `Limits`. lqwd-node already uses zod 3.23. |
| class-variance-authority | **^0.7.1** | shadcn variant management | Comes with shadcn; keep version aligned. |
| clsx + tailwind-merge | **^2.1.1 / ^3.5.0** | `cn()` className helper | Workspace convention (`@/lib/utils`). |
| lucide-react | **^0.577** | Icons | shadcn default icon set; matches lqwdclaw. |
| tw-animate-css | **^1.4.0** | Animations under Tailwind v4 | v4-compatible replacement for the old `tailwindcss-animate`; lqwdclaw already uses it. |
| date-fns | **^3.x** | Time-bucketing for time-series panels | Forwarding/fee/liquidity charts need consistent day/hour bucketing without timezone surprises. Lighter than moment. |
| dotenv | **^17.3.1** | Local env loading | Config-driven DB URLs (local→VM flip is env-only). |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| drizzle-kit (`pull`) | Generate typed schema from existing warehouses | Run against `routing_vm` and `ldk-lspd-main` once; **copy** the output into hand-curated `schema.ts`, then delete generated migration files. Never run `push`/`migrate` against the warehouses. |
| drizzle-kit (`generate`/`migrate`) | Own the `nodemon` queue DB | This is the ONLY DB Drizzle manages migrations for. |
| ESLint 9 + eslint-config-next | Lint | Flat config, matches lqwdclaw. |
| Prettier 3.8.x | Format | 2-space, double quotes, printWidth 100 — workspace `.prettierrc`. |
| openssl (`dgst -sha256 -hmac`) | Bash-side HMAC verify on nodes | No extra install on Linux nodes; pairs with node crypto hex output. See §4. |

## Installation

```bash
# Core (matching lqwdclaw conventions)
npm install next@16.1.6 react@19.2.3 react-dom@19.2.3 \
  drizzle-orm postgres ai @ai-sdk/anthropic \
  recharts zod date-fns \
  class-variance-authority clsx tailwind-merge lucide-react tw-animate-css

# Dev
npm install -D typescript@^5 @types/node@^20 @types/react@^19 @types/react-dom@^19 \
  drizzle-kit dotenv eslint@^9 eslint-config-next@16.1.6 prettier \
  tailwindcss@^4 @tailwindcss/postcss@^4

# shadcn/ui (Tailwind v4 + React 19 — canary NO LONGER required)
npx shadcn@latest init
npx shadcn@latest add card table badge button dialog chart
```

---

## Open Questions Resolved

### §1 — Drizzle against existing, externally-managed warehouses (HIGH)

**Recommendation: hand-written typed schema seeded by a one-time `drizzle-kit pull`. Drizzle never owns, migrates, or `push`es the two warehouses.**

- Run `drizzle-kit pull` (a.k.a. introspect) once per warehouse to generate `schema.ts` + `relations.ts`. Then **copy the table definitions into a hand-curated, read-only schema file and delete the generated migration/meta artifacts.** This is Drizzle's own documented "existing project" workflow. The pull is a *bootstrap convenience*, not an ongoing sync.
- **Why hand-curated, not auto-introspect-on-each-run:** the warehouses are externally managed and event-driven; you want a stable, reviewed type surface that bakes in the workspace's hard-won query guardrails (`fee_msat/1000.0`, latest-per-`chan_id`, never `WHERE timestamp = MAX(timestamp)`). Auto-pull would happily regenerate types that invite the known DISTINCT-ON failure mode.
- **Three connections in one app — correct and supported.** Create three separate Drizzle instances, each from its own `postgres()` client:
  - `routingDb` → `routing_vm`, role `grafana_demo_ro`, **read-only**
  - `ldkDb` → `ldk-lspd-main`, role `grafana_demo_ro`, **read-only**
  - `nodemonDb` → new `nodemon` queue DB, **read-write** (the only DB Drizzle migrates)
  - Each gets its own typed schema object. Co-locate as `db/routing.ts`, `db/ldk.ts`, `db/nodemon.ts` and export named query functions (workspace convention: Drizzle-only queries, named exports).
- **Enforce read-only at the database, not in code.** The `grafana_demo_ro` role already has SELECT-only grants — rely on that as the real guarantee. Drizzle/postgres.js has no "read-only client" flag; the DB role is the safety boundary. (Optionally set `default_transaction_read_only` on the role for belt-and-suspenders.)
- **Connection pooling — this is a long-running VM/local app, NOT serverless.** The serverless pooling horror stories (idle connections never reclaimed, hundreds of cold-start pools) **do not apply** here. A single `next start` process holds stable pools. Recommended `postgres()` options per warehouse:
  ```ts
  postgres(url, { max: 5, idle_timeout: 30, connect_timeout: 10, prepare: false })
  ```
  - `max: 5` per warehouse is ample for a single-operator tool; keeps total warehouse load tiny.
  - `prepare: false` if the warehouse sits behind a transaction-mode pooler (PgBouncer); leave default (prepared statements on) for a direct connection — confirm which during Phase 1.
  - The `nodemon` DB can run `max: 5` too; its atomic-claim `UPDATE ... WHERE status='approved' RETURNING *` is a single round-trip and needs no special pooling.

### §2 — Chart library (HIGH)

**Recommendation: Recharts 3.8.1.** The spec's "e.g. Recharts" is the right instinct — commit to it.

| Lib | React 19 / App Router | Verdict for this dashboard |
|---|---|---|
| **Recharts 3.x** | **Native** — v3 peer deps list `react`, `react-dom`, AND `react-is` at `^19.0.0`. | **CHOOSE.** SVG, declarative, the exact lib shadcn's official `chart` component wraps. Best DX for fee/forwarding/liquidity time-series. |
| visx | Works, low-level | Too low-level — you'd rebuild axes/tooltips/legends. Pick only if you need bespoke viz. Not worth it here. |
| Tremor | React 19 OK | Opinionated dashboard kit, but overlaps/conflicts with shadcn + Tailwind v4 theming. Redundant given shadcn. Avoid. |
| ECharts (echarts-for-react) | Works via `'use client'` | Canvas, heavier, imperative option-object API, separate theming from Tailwind. Overkill for curated panels. Reserve only if you later need huge-dataset canvas perf. |

**Critical App Router gotchas:**
- **All Recharts components require `'use client'`.** Pattern: fetch in a Server Component, pass plain serializable data as props into a thin `"use client"` chart wrapper (e.g. `<FeeTrendChart data={...} />`). Never import Recharts into a Server Component.
- **`ResponsiveContainer` + SSR:** can flash/zero-size on first paint. Give the wrapper a fixed height (`h-72`) and/or render charts under `Suspense`; shadcn's `ChartContainer` already handles this.
- **The `react-is` override hack is OBSOLETE in v3.** It was only needed for Recharts 2.x on React 19. On Recharts 3.x do **not** add a `react-is` override — its peer range already covers React 19. (If you ever pin 2.x, you'd need `overrides: { "react-is": "^19" }`, but don't.)
- **Use shadcn's `chart` block** (`npx shadcn@latest add chart`) — it gives you a themed `ChartContainer`/`ChartTooltip` over Recharts that respects your `@theme` tokens, so the navy `#1A3C79` brand color flows in via CSS variables.

### §3 — Tailwind v4 + shadcn/ui status (HIGH)

**Fully GA and stable. No blockers.**
- shadcn/ui has **full official Tailwind v4 + React 19 support** in current releases (since the Feb 2025 v4 changelog). `@theme` and `@theme inline` are supported; `forwardRef`s removed; types adjusted for React 19.
- **`@canary` is no longer required** — use plain `npx shadcn@latest init`. (Older blog posts still say canary; that guidance is stale.)
- Tailwind v4 config is **CSS-first**: theme tokens live in `globals.css` under `@theme { --color-brand: #1A3C79; ... }` and `@import "tailwindcss";` — there is no `tailwind.config.js`. The PostCSS plugin moved to `@tailwindcss/postcss` (separate package, already in lqwdclaw devDeps).
- **Brand + dark theme:** set `class="dark"` on `<html>` (lqwdclaw pattern) and define navy `#1A3C79` as a CSS variable in `@theme`; feed it to shadcn `chart` config so charts inherit it. Do not hardcode Bitcoin orange.
- **Animations:** use `tw-animate-css` (already in lqwdclaw), NOT the deprecated `tailwindcss-animate` (incompatible with v4's engine).

### §4 — HMAC command signing: TS ↔ bash interop (HIGH)

**Recommendation: HMAC-SHA256, lowercase **hex** digest, over a **key-sorted canonical JSON** payload, verified node-side with `openssl dgst`.**

Node.js `crypto` wraps OpenSSL, so node-generated HMACs are byte-identical to `openssl dgst -hmac` output for the same key + bytes — the interop is exact as long as **both sides hash the same canonical string.**

**Dashboard (TypeScript) — sign:**
```ts
import { createHmac } from "node:crypto";

// Canonical: stable key order + no insignificant whitespace.
// Sort keys recursively; JSON.stringify with sorted replacer.
function canonical(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}
const payload = canonical({ action: "update_fee", chan_id, base_fee_msat, fee_ppm, nonce, ttl });
const sig = createHmac("sha256", perNodeSecret).update(payload, "utf8").digest("hex");
// store `payload` (or its exact field set) + `sig` in the commands row
```

**Node (bash) — verify:**
```bash
# $PAYLOAD must be the EXACT canonical string the dashboard signed.
expected=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$NODE_SECRET" -hex | awk '{print $2}')
[ "$expected" = "$ROW_SIG" ] || { echo "HMAC mismatch — refusing"; exit 1; }
```

**Interop rules (the whole game is getting both sides to hash identical bytes):**
- **Encoding: hex, lowercase.** Unambiguous across `openssl` (`-hex` / `awk '{print $2}'`) and node (`.digest('hex')`). Avoid base64 — `openssl`'s base64 line-wrapping and `=` padding cause subtle mismatches in shell.
- **Canonicalize before signing.** Sort object keys, no extra whitespace, fixed UTF-8. The node must reconstruct (or be handed) the *exact same* canonical string — simplest is to **store the canonical payload string itself** in the DB and sign that, so bash never has to re-serialize JSON (avoids `jq` ordering surprises).
- **Constant-time compare on the TS side** when the dashboard verifies anything: `crypto.timingSafeEqual(Buffer.from(a,'hex'), Buffer.from(b,'hex'))`. (Bash `[ = ]` is fine on the node — the secret is local and the threat is a tampered DB row, not a timing oracle.)
- **Bind a nonce + TTL into the signed payload** so a captured row can't be replayed after expiry (the spec's idempotency-key/expiry requirement). The node re-checks TTL after verifying HMAC.
- **Per-node shared secret**, never the dashboard's master — one secret per node pubkey, matching the spec's per-node signing.

### §5 — Vercel AI SDK for the optional narrative layer (HIGH)

**Recommendation: `ai` 6.0.x + `@ai-sdk/anthropic` 3.0.x, mirroring lqwdclaw's `getModel()` exactly.** This is a non-streaming, one-shot narration, so use **`generateText`** (not `streamText`).

```ts
// src/lib/ai/provider.ts  (mirror lqwdclaw)
import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export function getModel(): LanguageModel {
  const id = process.env.AI_MODEL ?? "claude-sonnet-4-5"; // default a Claude model
  return anthropic(id);
}

// narrate flagged cards
import { generateText } from "ai";
const { text } = await generateText({
  model: getModel(),
  system: NARRATIVE_SYSTEM_PROMPT,
  prompt: JSON.stringify(flaggedCards),
});
```

- **v6 shape (confirmed against lqwdclaw):** the type is `LanguageModel` (not `LanguageModelV1`). `generateText` returns `{ text, ... }`. Providers are called as factory functions: `anthropic(modelId)`.
- **Off by default**, gated behind an env flag / UI toggle — the deterministic recommendation cards stand alone and are the source of truth. The LLM only narrates; never let it produce the `params` that get signed/executed.
- **`AI_MODEL` env override** keeps it model-agnostic (workspace convention) — can swap to Gemini/OpenAI providers without code change since all three `@ai-sdk/*` providers are already vetted in lqwdclaw.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Recharts 3.x | ECharts (echarts-for-react) | Only if a single panel must render tens of thousands of points where SVG perf degrades — then isolate that one canvas chart. Not needed for curated operator panels. |
| Recharts 3.x | visx | Only for a bespoke custom visualization Recharts can't express. Costs you axes/tooltip/legend rebuild. |
| postgres.js (`postgres`) | node-postgres (`pg`) | If you specifically need `pg`-ecosystem tooling. But postgres.js already pairs with Drizzle in lqwdclaw — staying consistent avoids two driver mental models. |
| Hand-curated schema from `pull` | Live `drizzle-kit pull` each deploy | Never for these warehouses — they're externally owned and event-driven; auto-regen invites the DISTINCT-ON failure mode. |
| `generateText` | `streamText` | If you later want token-by-token streaming of the narrative into the UI. For one-shot per-node summaries, `generateText` is simpler. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `tailwindcss-animate` | Incompatible with Tailwind v4 engine | `tw-animate-css` (already in lqwdclaw) |
| `npx shadcn@canary` | Stale guidance; v4 + React 19 are GA | `npx shadcn@latest` |
| `react-is` override for charts | Obsolete on Recharts 3.x (was a 2.x-on-React-19 hack) | Recharts 3.8.x — no override |
| Drizzle `push`/`migrate` on warehouses | Would mutate externally-managed schemas you don't own | Hand-curated read-only schema; migrate only `nodemon` |
| base64 HMAC across the bash boundary | `openssl` base64 wrapping/padding causes shell mismatches | lowercase **hex** digest |
| Serverless-style pooling tuning (PgBouncer/Neon pooler assumptions) | This is a long-running VM/local app, not Lambda | Plain postgres.js pool, `max: 5`, rely on the DB role for read-only |
| Re-serializing JSON in bash with `jq` for HMAC | Key-order/whitespace drift breaks the signature | Sign and store the exact canonical string; bash hashes that string verbatim |
| `LanguageModelV1` type / `toDataStreamResponse` | v5 names, renamed in v6 | `LanguageModel`; `generateText` |

## Stack Patterns by Variant

**If a warehouse sits behind a transaction-mode pooler (PgBouncer) — confirm in Phase 1:**
- Set `prepare: false` on that `postgres()` client (prepared statements break in transaction pooling mode).
- Otherwise leave the default (prepared statements on) for a direct connection — faster.

**If the LLM narrative needs streaming into the UI later (Phase 8 hardening):**
- Switch the narration route to `streamText` + `@ai-sdk/react` `useChat`/`readStreamableValue`. Until then, `generateText` server-side is sufficient and simpler.

**If Recharts SSR causes layout flash:**
- Wrap chart hosts in `<Suspense>` and give fixed heights; or use shadcn `ChartContainer` which manages responsive sizing.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| next@16.x | react@19.2.x, react-dom@19.2.x | react-dom MUST equal react version |
| recharts@3.8.x | react@19, react-dom@19, react-is@19 | Native React 19 peer support; no override |
| tailwindcss@4.x | @tailwindcss/postcss@4.x, tw-animate-css@1.4.x | v4 PostCSS plugin is a separate package; CSS-first `@theme`, no JS config |
| shadcn@4.x | Tailwind v4, React 19 | Use `@latest`, not `@canary` |
| drizzle-orm@0.45.x | drizzle-kit@0.31.x, postgres@3.4.x | Same trio as lqwdclaw; `pull` for warehouses, `migrate` for nodemon only |
| ai@6.0.x | @ai-sdk/anthropic@3.0.x | `LanguageModel` type, `generateText`, provider factory call |
| node:crypto (Node 20+) | openssl `dgst -sha256 -hmac` | Byte-identical HMAC given same key + canonical bytes; use hex |

## Sources

- `lqwdclaw/package.json` (this workspace) — production-proven version set: Next 16.1.6, React 19.2.3, Drizzle 0.45.1, postgres 3.4.8, ai 6.0.116, shadcn 4.0.2, Tailwind v4. **HIGH** (authoritative local truth).
- npm registry (`npm view`) — current versions: next 16.2.7, react 19.2.7, drizzle-orm 0.45.2, drizzle-kit 0.31.10, postgres 3.4.9, tailwindcss 4.3.0, recharts 3.8.1, ai 6.0.197, @ai-sdk/anthropic 3.0.81, shadcn 4.10.0. **HIGH**.
- npm `recharts peerDependencies` — `react`/`react-dom`/`react-is` all `^19.0.0`. **HIGH** (settles the react-is question).
- https://ui.shadcn.com/docs/tailwind-v4 + https://ui.shadcn.com/docs/react-19 + Feb-2025 changelog — full v4/React-19 support, `@theme`, forwardRef removal. **HIGH**.
- https://orm.drizzle.team/docs/get-started/postgresql-existing — `drizzle-kit pull` introspection workflow for existing DBs. **HIGH**.
- https://github.com/recharts/recharts/wiki/3.0-migration-guide + release v3.0.0 — state rewrite, removed deps, React 19 line. **HIGH** (cross-checked with npm peer deps).
- https://nodejs.org/api/crypto.html — `createHmac`, `digest('hex')`, `timingSafeEqual` (OpenSSL-backed). **HIGH**.
- https://www.authgear.com/post/generate-verify-hmac-signatures/ + ssojet/mojoauth HMAC-SHA256 guides — canonical JSON + cross-language interop, openssl equivalence. **MEDIUM** (verified against Node docs).
- Workspace memory `failure_distinct_on_vs_max_timestamp` + `reference_lqwd_databases` — `fee_msat/1000.0`, latest-per-chan_id, `grafana_demo_ro` role, event-driven tables. **HIGH** (operator-confirmed).

---
*Stack research for: local-first Lightning node-operator control dashboard*
*Researched: 2026-06-05*
