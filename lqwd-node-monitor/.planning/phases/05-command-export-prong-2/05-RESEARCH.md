# Phase 5: Command Export (Prong 2) - Research

**Researched:** 2026-06-12
**Domain:** Read-only command-string generation (lncli/LDK), inline-expand UI on the frozen Phase 4 card contract
**Confidence:** HIGH (lncli syntax verified against LND v0.20.1-beta source; card contract read from frozen code) / LOW only on `lncmd` (see Assumptions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Export surface & copy flow**
- **D-01:** **Inline expand on the card** — exportable cards (close/rebalance/remediate) carry an EXPORT control that expands the command block directly below the row, working identically on `/inbox` and the console Active Signals panel (one component, both surfaces — the Phase 4 D-08 "one engine, two views" pattern). Matches the operator-approved expand patterns (sweep fold, pending drill-in). No modal, no dedicated page.
- **D-02:** **Both copy modes:** every runnable command/step gets its own COPY button (copies the bare command), plus a copy-all button that grabs the entire annotated block.
- **D-03:** **No reveal gate** — expanding the card is the deliberate act; the command is inert text and the real gate is the operator running it on the node. No acknowledge step before the command renders.

**Command block anatomy**
- **D-04:** **Self-documenting shell snippet:** the copy-all block carries the context echo (peer alias, capacity, timelock, limbo, age, attempts) as `#` comments above the command, so context travels into terminals and ops tickets. Per-command COPY grabs the bare command only.
- **D-05:** **Safety notes render twice:** as visible UI text on the expanded block AND as `#` comments inside the copy-all snippet (e.g. "coop close — funds available immediately; force close locks funds for the timelock").
- **D-06:** **Verify-step-first:** every export leads with a read-only verification command (e.g. `lncli getchaninfo <chan_id>` / a `pendingchannels` filter) as step 1, with the destructive command as step 2 — satisfies the chan_id echo-back criterion and the fleet's careful-ops culture.

**Rebalance tooling**
- **D-07:** **Fleet reality:** rebalancing runs through a custom circular-rebalance script plus AI-driven balancing via an external service — NOT bos/rebalance-lnd. Phase 5 therefore renders an **honest placeholder block** for rebalance cards: full params (out/in peer, amount, direction) in the standard commented context block, with an explicit label "rebalance execution is operator/AI-managed — no generated command yet". No fake runnable command.
- **D-08:** **Future wiring deferred:** the operator wants this later wired to a request table the external balancing service reads from and initiates — that is a write path and lands at/after Phase 6 (see Deferred Ideas).

**Runbook depth (PENDING-03)**
- **D-09:** **Key steps + script pointer** for the force-close-past-maturity restart procedure: the block lists the 3–5 critical steps (fleet coordination check, drain via wrapper, restart, verify) with the canonical node-side script (`01-safe-lnd-restart.sh` / drain-wrapper) as the reference — explicitly NOT an auto-restart and NOT a full duplicated runbook that could drift from the real script.
- **D-10:** **Stuck-sweep CPFP:** `lncli wallet bumpfee` rendered with the outpoint and the `suggestedSatPerVbyte` already computed on the `remediate_pending` card, plus a `#` comment reminding the operator to sanity-check the rate against current mempool conditions before running.

### Claude's Discretion
- Exact expanded-block layout, COPY-button styling/feedback, mono formatting — driven through the binding design skills (sketch-findings-nodemonitor + frontend-design).
- `lncmd` (LDK) close syntax and capability coverage — researcher verifies; where LDK has no equivalent command, render an honest "not supported on LDK — manual procedure" state (Phase 2 D-01 honesty pattern).
- Where capacity/timelock context values come from (card evidence vs an additional sanctioned read) — planner/researcher decide honoring AFM-001/002.
- Param validation mechanics before render (zod on the already-frozen action schemas is the natural shape — schema IS the contract, Phase 4 D-02).
- Aged-funding (`aged_funding`) remediation case rendering — researcher proposes from `_library` guidance within the D-09 key-steps+pointer pattern.

### Deferred Ideas (OUT OF SCOPE)
- **Rebalance request table** — a `nodemon` table the external AI-balancing service polls to initiate rebalances from approved intents. A write path: belongs at/after Phase 6 where the queue DB, approval states, and HMAC substrate exist. Candidate: extend the Phase 6 queue with a `rebalance_request` action type the external service claims.
- **Generated syntax for the custom circular-rebalance script** — once the operator wants the script's invocation rendered (instead of the placeholder), add it as a command template; needs the script's name/flags.
- `ui-polish-fleet-console.md` todo — rejected twice; not export scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXPORT-01 | For closures and rebalances, operator gets a ready-to-run, fully-parameterized `lncli` (LND) / `lncmd` (LDK) command with context + safety notes (echoing peer alias, capacity, and timelock). Pure client-side string generation; no write path. | §Code Examples (verified `lncli closechannel` coop/force flags from v0.20.1-beta source); §lncmd Verdict (LDK has no public CLI — honest manual-procedure state); §Context Sourcing (capacity from rows already loaded by fee-signals; alias from fleet metadata; live CSV timelock via verify step — warehouse does not carry it); D-07 honest rebalance placeholder |
| PENDING-03 | For each stuck case, an exported remediation command/runbook: stuck sweep → `lncli wallet bumpfee`/CPFP with outpoint + suggested sat/vB; force-close past maturity → safe coordinated-restart procedure (drain-wrapper reference), NOT auto-restart; each export echoes context (chan point, peer, limbo, age, attempts) + safety notes. | §Code Examples (verified `wallet bumpfee`/`bumpforceclosefee`/`pendingsweeps` flags); §Remediation Runbooks (3 cases incl. proposed `aged_funding` runbook with verified 2016-block forget mechanism); stuck-pending cards already carry limbo/age/attempts/outpoint in `evidence.detail` — context echo needs no new reads |
</phase_requirements>

## Summary

This phase renders ready-to-run command blocks from the frozen Phase 4 `InsightCard` contract with zero write path. All inputs already exist: `card.suggestedAction.params` (the ONLY param source), `card.evidence.detail` (limbo/age/attempts/outpoint on pending cards), `card.node.backend` (lnd|ldk — already resolved on the card; components never call the server-only `backendFor()`). The work is (1) a pure, no-DB command-builder module with strict pre-render param validation, (2) a thin client leaf for expand + copy state, (3) wiring the shared export block into the two existing card surfaces, and (4) small detector-side `evidence.detail` enrichment so close/rebalance cards carry capacity/peer-alias context without any new query.

Every `lncli` flag the phase needs was verified directly against the LND **v0.20.1-beta** CLI source (the version pinned in the workspace's lnd-gateway): `closechannel` (coop + `--force`), `getchaninfo` (`--chan_id` / `--chan_point`), `pendingchannels`, `listchannels --peer`, `wallet bumpfee` (outpoint positional, `--sat_per_vbyte`), `wallet bumpforceclosefee` (channel_point positional — NOT the sweep outpoint), and `wallet pendingsweeps`. Two traps were found and documented: `bumpforceclosefee` takes a *channel_point* argument while the stuck-sweep card carries a *sweep outpoint* (so `wallet bumpfee <outpoint>` is the correct primary command, exactly matching card params), and the warehouse channel snapshot carries **no CSV timelock** (the "current timelock" echo must come honestly from the verify step's on-node output, not from invented data).

On the LDK side: `lncmd` does not exist in any public registry, documentation, or anywhere in the workspace outside NodeMonitor's own planning prose; `ldk-node`'s API (`close_channel`/`force_close_channel`) ships **no CLI** and no bumpfee/pendingsweeps equivalent, and the warehouse cannot supply LDK's required `user_channel_id`. The locked fallback applies: render the honest "not supported on LDK — manual procedure" state with full params echoed (Phase 2 D-01 honesty pattern). Note also that today every action-bearing detector hardcodes `backend: "lnd"` and `DEFAULT_BACKENDS` is empty, so the LDK branch is *currently unreachable at runtime* — it must still exist and be unit-tested, because `NODE_BACKENDS` can flip a node to `ldk` with zero code change.

**Primary recommendation:** Build `src/lib/export/` as a pure module (schema-validated params → regex-hardened interpolation → structured `ExportBlock` of verify-step + action-step + comment lines), computed in Server Components and handed as plain strings to one small `"use client"` expand/copy leaf mounted by both `InsightCardRow` and the console Active Signals row. No new dependencies. No DB reads at export time.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Card computation, suppression, params | Server (Phase 4 engine — unchanged) | — | `loadInsightView()` is the single computation; suppressed cards arrive with `suggestedAction: null` (T-04-16) |
| Param validation before render | Server (pure lib) | — | Re-parse via frozen `SuggestedActionSchema` + strict format regexes; fail → honest error state, never a partial command |
| Command-string building | Server (pure lib, no `server-only` import) | — | Pure functions over card fields; vitest-testable with zero DB |
| Context enrichment (capacity, peer alias) | Server (detector layer, data already in hand) | — | `evidence.detail` additions at detect time — zero new queries (see §Context Sourcing) |
| Expand/collapse + COPY interaction | Browser (one `"use client"` leaf) | — | Only UI state lives client-side; `FleetPendingBoard` is the approved precedent |
| Clipboard write | Browser (`navigator.clipboard`) | — | Secure-context API; no library |
| Command execution | **Nowhere** (operator's node shell) | — | Zero write path is the phase boundary; Phase 7 owns execution |
| DB writes | **None** | — | Explicitly out of scope (Phase 6) |

## Project Constraints (from CLAUDE.md)

- **GSD workflow enforcement** — all file changes via `/gsd-execute-phase` (or quick/debug); no direct edits.
- **Stack locked**: Next.js App Router + TS strict + Tailwind v4 + shadcn/ui; `@/` imports, named exports, Drizzle-only queries (this phase adds **no** queries).
- **Brand**: LQWD navy `#1A3C79`; **Light-first NOC theme** (no dark mode); severity color does state only — binding via `sketch-findings-nodemonitor` (no emoji/icons-for-state, IBM Plex Mono for data, hairline borders, tight radii) and `frontend-design` skill for all UI work.
- **Security**: Grade-A scan posture — no CRITICAL/HIGH; command rows here are inert text but params must be validated against strict type/range (no injection) per the phase success criteria.
- **Process**: no co-authored-by trailers; branch-per-task; parallel execution where possible.
- **Conventions carried from lqwdclaw**: functions < 30 lines, early returns, `??` for defaults, interfaces for props, Server Components by default with `"use client"` only for interactivity.

## Standard Stack

### Core

**No new packages.** Everything the phase needs is already installed and frozen by earlier phases:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | ^3.23 (installed) | Re-parse `suggestedAction` through the frozen `SuggestedActionSchema` before any string assembly | Schema IS the contract (Phase 4 D-02); `schema.ts` is a pure module explicitly designed for Phase 5 import [VERIFIED: src/lib/insight/schema.ts header comment] |
| react / next | 19.2.x / 16.x (installed) | Server-computed blocks + one client leaf | Existing surface pattern [VERIFIED: package.json] |
| vitest | installed (`npm test` = `vitest run`) | No-DB unit tests on pure builders | Project test convention [VERIFIED: package.json scripts, vitest.config.ts] |
| node `navigator.clipboard` (browser API) | — | COPY buttons | No dependency needed; plain text writes [CITED: developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText] |

### Supporting (existing in-repo modules — binding)

| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/lib/insight/schema.ts` + `types.ts` | Frozen param source | ONLY param source; never invent values |
| `src/lib/format/units.ts` (`formatSats`) | AFM-002 sat formatting | Comment lines and UI text ONLY — never inside the bare command string (commands need raw integers) |
| `src/components/console/ExportButton.tsx` | Mono-uppercase outline-button voice | Visual voice for the EXPORT control (the new control needs a client leaf, unlike this `<a download>`) |
| `src/components/console/FleetPendingBoard.tsx` | Operator-approved inline expand (`useState` drill-in) | The interaction grammar D-01 mirrors |
| `src/components/insight/NarrateButton.tsx` | The repo's first interactive client leaf | Pattern precedent for the copy-button leaf (plain-text output, mono labels) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Server-computed block strings passed to a dumb client leaf | Building strings inside the client component (builders are pure, so it's possible) | Client-side building forces the whole card into the client bundle and duplicates validation surface; server-computed strings keep the leaf minimal. "Pure client-side generation" in EXPORT-01 means *no DB/write path*, not literally browser-side execution. |
| `navigator.clipboard.writeText` | `copy-to-clipboard` npm package | Not needed; one API call + fallback message. Adding a package triggers the legitimacy gate for zero benefit. |
| `evidence.detail` enrichment for capacity/alias | New sanctioned read of `lnd_node_peer_info` at export time | Extra query violates the zero-new-reads posture and EXPORT-01's "no DB" framing; detail enrichment uses rows already loaded (see §Context Sourcing) |

**Installation:** none.

## Package Legitimacy Audit

This phase installs **no external packages**. No audit table required; slopcheck not run (nothing to check). Any plan task that proposes adding a dependency is out of contract with this research and must be re-gated.

## Architecture Patterns

### System Architecture Diagram

```
                         (existing, unchanged)
  warehouses ──► loadInsightView() ──► InsightCard[]  (suppression already nulls
                      │                    │           write actions on flagged
                      │   detector-side    │           nodes — T-04-16)
                      │   detail enrich    │
                      │   (capacity/alias) │
                      ▼                    ▼
            ┌──────────────────────────────────────────┐
            │ SERVER COMPONENTS (both surfaces)         │
            │  /inbox  InsightCardList → InsightCardRow │
            │  console [pubkey]/[tab] → ActiveSignals   │
            │                                           │
            │  card.suggestedAction !== null &&         │
            │  type ∈ {close_channel, rebalance,        │
            │          remediate_pending} ?             │
            │     buildExportBlock(card)  ── pure lib   │
            │        1. SuggestedActionSchema.parse     │
            │        2. format-regex gate per param     │
            │        3. branch backend lnd | ldk        │
            │        4. assemble verify-step +          │
            │           action-step + # comments        │
            │     → ExportBlock { steps[], copyAll }    │
            └───────────────┬──────────────────────────┘
                            │ plain serializable props
                            ▼
            ┌──────────────────────────────────────────┐
            │ "use client" CommandExport leaf           │
            │   EXPORT toggle (expand below row)        │
            │   per-step COPY (bare command)            │
            │   COPY ALL (annotated block)              │
            │   navigator.clipboard.writeText            │
            └───────────────┬──────────────────────────┘
                            ▼
              operator terminal / ops ticket (paste)
                    — NodeMonitor's involvement ends here —
```

### Recommended Project Structure

```
src/lib/export/
├── validate.ts          # format regexes + validateActionForExport() (zod re-parse + regex gate)
├── commands.ts          # per-action builders: buildCloseExport / buildRebalanceExport / buildRemediateExport
├── block.ts             # ExportBlock type {title, contextLines[], safetyLines[], steps:[{label, command|null, note}], copyAll}
├── sanitize.ts          # comment-line sanitizer for remote-controlled strings (aliases) — see Pitfall 2
└── *.test.ts            # no-DB vitest suites incl. injection-rejection cases
src/components/export/
└── CommandExport.tsx    # the ONE client leaf (expand state, copy buttons, copied feedback)
```

### Pattern 1: Validate-then-interpolate (never the reverse)

**What:** Every param crosses two gates before reaching a template literal: the frozen zod schema (shape/type), then a per-field format regex (content). Failure renders an honest "params failed validation — export withheld" state; no partial command ever renders.
**When to use:** Every builder, both backends.
**Example:**

```typescript
// Source: project PITFALLS.md Pitfall 7 + OWASP command-injection guidance;
// regexes match the fleet's own validation precedents (05-fleet-coordination.sh pubkey check)
const CHANNEL_POINT_RE = /^[0-9a-f]{64}:\d{1,5}$/;
const TXID_RE = /^[0-9a-f]{64}$/;
const PUBKEY_RE = /^[0-9a-f]{66}$/;
const CHAN_ID_RE = /^\d{1,20}$/;          // decimal SCID string from warehouse varchar

function safeSatPerVbyte(n: number | null): number | null {
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 5_000 ? n : null;
}
```

### Pattern 2: Verify-step-first block anatomy (D-04/D-05/D-06)

**What:** Every block = `# context comments` → `# safety comments` → step 1 read-only verify → step 2 action (or honest no-command state). Steps carry a bare `command` string (per-step COPY) and the whole assembly is also flattened into `copyAll`.
**Example (close, coop):**

```bash
# close_channel — coop close candidate
# node:      LQWD-Canada (lnd)
# peer:      <alias or 02ab…ef pubkey-truncated>   capacity: 50,000,000 sats
# chan_id:   895633969997611009    channel_point: 3f9a…d2:1
# safety: coop close — funds available ~immediately after confirm;
#         if active HTLCs exist the close WAITS until they resolve and the
#         channel shows disabled in listchannels until the close tx broadcasts.
# step 1 — verify (read-only; confirm chan_id + capacity + csv_delay on-node):
lncli getchaninfo --chan_id 895633969997611009
lncli listchannels --peer <remote_pubkey>   # csv_delay lives here, not in the warehouse
# step 2 — close:
lncli closechannel --funding_txid 3f9a…d2 --output_index 1
```

(The HTLC-wait safety wording is verified from the v0.20.1 `closechannel` help text; the `--funding_txid/--output_index` form mirrors the fleet's own `06-close-zero-coop-pairs.sh`.)

### Pattern 3: One shared leaf, two server mounts (D-01)

**What:** `InsightCardRow` (server) computes `buildExportBlock(card)` and mounts `<CommandExport block={…}/>` under the suggested-action box. The console path needs threading: `buildInsightSignals()` in `[pubkey]/[tab]/page.tsx` currently flattens cards to string-only `SignalRow`s — extend `SignalRow` with an optional serializable `exportBlock` field (or the card itself) so `ActiveSignalsPanel` (stays a Server Component) can mount the same leaf on insight rows.
**Why:** `ActiveSignalsPanel` must NOT become a client component; only the leaf owns state (the `FleetPendingBoard` precedent).

### Anti-Patterns to Avoid

- **Calling `backendFor()` in components** — it imports `server-only` and reads env; the backend is already on the card (`card.node.backend`). Use the card.
- **Rendering anything from `evidence.detail.withheldAction`** as an export — suppressed cards carry null actions structurally; the export control is simply absent (T-04-16/T-04-29).
- **Formatted numbers inside commands** — `formatSats` (commas) is for comments/UI only; the bare command interpolates raw integers.
- **Duplicating the restart runbook** — D-09: 3–5 key steps + pointer to `_library/scripts/01-safe-lnd-restart.sh`; a full copy drifts from the real script.
- **A fake rebalance command** — D-07: honest placeholder with full params; the circular-rebalance script's invocation is explicitly deferred.
- **Touching `src/lib/insight/schema.ts`** — adding `evidence.detail` *keys* is contract-safe (detail is an open `z.record`); changing the schema itself breaks the frozen contract test and requires a deliberate version bump. This phase needs zero schema changes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Action param shapes/types | A second param model for exports | `SuggestedActionSchema` / `z.infer` types from `schema.ts` | The frozen contract was designed for exactly this import; drift = signing-surface bugs in Phase 6 |
| Sat/BTC display | Inline `/1e8`, `toLocaleString` | `formatSats` from `units.ts` | AFM-002; a grep guard already blocks ad-hoc conversions |
| Latest/pending channel state | Any new SQL | Existing card `evidence.detail` + detector-side enrichment | Pending tables are resolved-residue minefields; readers are golden-tested (AFM-001) |
| Restart procedure text | Full runbook prose | Key steps + pointer to `01-safe-lnd-restart.sh` & `05-fleet-coordination.sh` | D-09; scripts are canonical and node-side |
| Clipboard | A clipboard npm package | `navigator.clipboard.writeText` | One call; avoids a needless dependency + legitimacy gate |
| Backend detection | Warehouse heuristics | `card.node.backend` (already resolved via the D-03 config map upstream) | LDK rows arrive in `lnd_*` table shapes; the warehouse cannot tell you the backend |

**Key insight:** Phase 4 deliberately pre-paid almost everything this phase needs — params, suppression, severity, backend, deep links, limbo/age/attempts detail. The export layer should be a *renderer with a validation gate*, not a data layer.

## lncmd Verdict & Context Sourcing (the four researcher mandates)

### 1. `lncmd` (LDK) capability coverage — verdict: render the honest unsupported state

- `lncmd` appears **nowhere** in the workspace outside NodeMonitor planning prose (verified: grep across `lqwdLogs/_library` scripts/runbooks and all repos — zero operational references). Project research already flagged it "unconfirmed — verify against current lncmd docs/source"; no such public docs/source exist. Web search finds no tool named `lncmd` for LDK [VERIFIED: workspace grep + web search 2026-06-12].
- `ldk-node` (the LDK reference node) exposes `close_channel(user_channel_id, counterparty_node_id)` and `force_close_channel(user_channel_id, counterparty_node_id, reason)` as **library API methods only — no CLI ships**, and there is no bumpfee/pendingsweeps equivalent [CITED: docs.rs/ldk-node Node API].
- Even if an operator-internal `lncmd` exists, the warehouse cannot supply LDK's `user_channel_id`, so a "fully-parameterized" LDK close command is **not honestly constructible** from card data today.
- **Prescription:** for `card.node.backend === "ldk"`, every action type renders the locked fallback — context echo + params in the standard commented block + visible label `not supported on LDK — manual procedure` + a note to coordinate with the LSPD operator. Unit-test this branch even though it is currently unreachable at runtime (all action-producing detectors hardcode `backend: "lnd"` and `DEFAULT_BACKENDS` is empty — but `NODE_BACKENDS` env can flip a node with no code change; known LDK alias: `LQwD-Lspd-ldk`).

### 2. Capacity / timelock / peer-alias context sourcing (AFM-001/002)

| Context field | Source | New query? |
|---------------|--------|-----------|
| limbo, age, attempts, outpoint, channelPoint | Already on `remediate_pending` cards in `evidence.detail` (`limboSat`, `ageHours`, `attempts`, `outpoint`, `channelPoint`) | No |
| chan_id echo-back | `close_channel.params.chanId` + verify step output | No |
| **capacity** (close cards) | `lnd_node_channel_info.capacity` is on the latest-channel rows the fee-signals detector **already loads** — add `capacitySat` (and optionally `localBalanceSat`) to `evidence.detail` at detect time | **No** (data in hand) |
| **peer alias** | Intra-fleet peers: the fleet view's pubkey→alias map already in the engine (`nodeMetaFromFleet`). Non-fleet peers: render truncated pubkey + honest `alias unknown` — most LQWD channels are intra-fleet | **No** (recommended). Option B — a sanctioned `lnd_node_peer_info` latest-alias read — adds a query and the table is cumulative-lifetime (stale-alias risk); not recommended |
| **current timelock (CSV)** | **Not in the warehouse.** `lnd_node_channel_info` has no `csv_delay`/timelock column (verified against `schema/routing.ts`), and `update_fee`'s `timeLockDelta` is a documented placeholder (LND default 80) — never echo it as truth | Verify step echoes it honestly: `lncli listchannels --peer <pubkey>` includes `csv_delay`; the block carries a comment `# csv_delay (force-close lock) is shown by step 1 — the warehouse does not carry it` |
| maturity (FC-past-maturity) | `blocksTilMaturity` already drove the card; `evidence.observed` = blocks past maturity | No |

**Prescription:** small, contract-safe detector enrichment (`evidence.detail` keys are an open record — no schema change, no version bump) + verify-step honesty for live-only values. This keeps EXPORT-01's "no DB at export time" literal.

### 3. `aged_funding` runbook (proposed, D-09 key-steps + pointer pattern)

`_library` has no dedicated stuck-open runbook (verified: only a template table row mentions PENDING_OPEN), so this is proposed from verified LND mechanics:

```bash
# remediate_pending — aged_funding (pending open stuck <ageHours>h, limbo <limboSat>)
# channel_point: <txid>:<idx>    peer: <alias|pubkey>
# step 1 — verify it is still pending and get the funding txid:
lncli pendingchannels   # filter: .pending_open_channels[] | select(.channel.channel_point == "<cp>")
# step 2 — check the funding tx on-chain/mempool (on the node or mempool.space):
#   bitcoin-cli getmempoolentry <funding_txid>   # gone from mempool = re-broadcast/CPFP territory
# step 3 — if WE initiated and the tx is underfee'd in mempool: CPFP via a
#   wallet-controlled output of the funding tx (usually the change output):
#   lncli wallet bumpfee --sat_per_vbyte <rate> <funding_txid>:<change_index>
# step 4 — if the PEER initiated: LND auto-forgets unconfirmed inbound channels
#   after 2016 blocks (~2 weeks); no local action usually required.
# DANGER: `lncli abandonchannel` exists but is dev-mode-gated
#   (--i_know_what_i_am_doing) and can LOSE FUNDS if the funding tx ever
#   confirms — intentionally NOT rendered as a runnable step.
```

Mechanics verified against v0.20.1-beta source: `DefaultMaxWaitNumBlocksFundingConf = 2016` and the timeout applies only to channels "not initiated by us" (`lncfg/dev.go`, `funding/manager.go`); `abandonchannel` flags and the dev-mode gate from `cmd/commands/commands.go`. The change-output index in step 3 cannot be known from card data — render it as a placeholder the operator fills from `lncli listunspent --min_confs=0`, with a comment saying exactly that (honesty over invention).

### 4. Exact lncli flags — all verified from `lightningnetwork/lnd` tag `v0.20.1-beta`, `cmd/commands/` [VERIFIED: source]

| Command | Verified shape (v0.20.1-beta) | Notes |
|---------|------------------------------|-------|
| `lncli closechannel` | `--funding_txid <txid> --output_index <n>` (or positional; or `--chan_point txid:idx` which overrides both); `--force`; coop-only fee controls: `--conf_target`, `--sat_per_vbyte`, `--max_fee_rate`, `--delivery_addr`; `--block` waits for 1 conf | `sat_per_byte` deprecated/hidden. Coop close with active HTLCs waits + disables channel (help text). Fleet convention (script 06) uses the `--funding_txid/--output_index` form — mirror it |
| `lncli getchaninfo` | positional `chan_id` (uint64 decimal SCID) or `--chan_id`; `--chan_point txid:idx` as fallback (`chan_id` wins if both) | `--chan_point` covers cards where `chanId` is null (pending-sourced targets) |
| `lncli pendingchannels` | no filters; only `--include_raw_tx` | Filtering is jq-side, mirroring fleet scripts |
| `lncli listchannels` | `--peer <66-hex-pubkey>` | Verify-step source for `csv_delay` + capacity echo-back |
| `lncli wallet bumpfee` | positional **outpoint** `txid:idx`; `--sat_per_vbyte` (starting rate), `--conf_target`, `--immediate`, `--budget`, `--deadline_delta` (requires budget) | `--force`/`sat_per_byte` deprecated/hidden. Sweep outpoints are sweeper-registered → this is RBF/fee-function steering; matches card params exactly |
| `lncli wallet bumpforceclosefee` | positional **channel_point** (not outpoint); `--conf_target`, `--sat_per_vbyte`, `--immediate`, `--budget`, `--deadline_delta` | Anchor-channel CPFP; `bumpclosefee` is the deprecated hidden alias. Card has the sweep outpoint, not necessarily the FC channel_point → render as secondary option only when `channelPoint` is known |
| `lncli wallet pendingsweeps` | no args | Verify step for stuck-sweep case (mirrors script 07's read) |

## Remediation Runbooks (PENDING-03 prescriptions)

| Case (`remediate_pending.params.case`) | Step 1 (verify) | Step 2 (action) | Safety notes |
|---|---|---|---|
| `bump_fee` (stuck sweep) | `lncli wallet pendingsweeps` + jq select on `<outpointTxid>:<idx>` — echoes attempts/amount on-node | `lncli wallet bumpfee --sat_per_vbyte <suggestedSatPerVbyte> <outpointTxid>:<idx>` | D-10 comment: sanity-check rate vs current mempool before running; note `--budget`/`--immediate` exist for stubborn sweeps; mention `bumpforceclosefee <channel_point>` as the anchor-channel alternative when the FC channel_point is known (script 07 lineage). `suggestedSatPerVbyte` null → render verify step + honest "no suggested rate — read requested_sat_per_vbyte from step 1" |
| `restart_procedure` (FC past maturity) | `lncli pendingchannels` jq filter on `<channelPoint>` — confirms limbo + blocks past maturity | **No runnable restart command.** Key steps: (1) coordinate fleet peers — `05-fleet-coordination.sh --target-pubkey <node> --action disable` on counterparties; (2) drain + stop via `01-safe-lnd-restart.sh --restart` (HTLC drain wrapper); (3) verify back: `lncli getinfo` synced_to_chain, then re-enable peers; (4) re-check `pendingchannels` maturity progression | AP-11 comment verbatim-in-spirit: "do NOT auto-restart; if a close-storm is in progress freeze and preserve logs first" — restart is export-only by design (T-04-14) |
| `aged_funding` (stuck open) | as proposed in §3 above | CPFP option with operator-filled change index | abandonchannel danger note; 2016-block auto-forget for non-initiator |

## Common Pitfalls

### Pitfall 1: Shell injection via params
**What goes wrong:** A malformed/poisoned param (channel_point with `;`, pubkey with `$(...)`) lands inside a snippet the operator pastes into a node shell as root-adjacent user.
**Why it happens:** Interpolation without a content gate; zod alone checks *type* (`z.string()`), not *format*.
**How to avoid:** The two-gate pattern (schema parse + per-field regex) before any template literal; failure → honest withheld state. Add explicit injection-rejection unit tests (param with `;`, newline, backtick, `$(`).
**Warning signs:** Any `${...}` in a builder whose value didn't pass a named regex.

### Pitfall 2: Remote-controlled aliases breaking out of `#` comments
**What goes wrong:** Peer aliases are *peer-chosen strings*. An alias containing a newline turns the rest of it into an executable line inside the copy-all snippet (`evil\nrm -rf ~/.lnd`).
**Why it happens:** D-04 puts aliases into shell comments; comments are only inert until a `\n`.
**How to avoid:** `sanitize.ts`: strip control chars/newlines and the shell-active set (`` ` ``, `$`, `\`) from any string rendered into a comment, or whitelist printable ASCII minus those; cap length. Mirrors the T-04-19 alias-as-data discipline. Test with a hostile alias fixture.
**Warning signs:** Any card-sourced string entering `copyAll` without passing the sanitizer.

### Pitfall 3: Inventing the timelock
**What goes wrong:** Echoing `timeLockDelta` (a documented placeholder = LND default 80) or a made-up CSV as "current timelock" — the operator trusts a wrong lock duration on a force close.
**How to avoid:** Warehouse carries no CSV; the verify step (`listchannels --peer`) is the only honest source — say so in a comment.
**Warning signs:** the string `80` appearing as a timelock anywhere in export output.

### Pitfall 4: `bumpforceclosefee` arg confusion
**What goes wrong:** Rendering the *sweep outpoint* as the argument to `bumpforceclosefee`, which takes a *channel_point* (verified v0.20.1 source). Fleet script 07 passes the outpoint — that pattern hits the WARN/fallback path in the script itself.
**How to avoid:** Primary command is `wallet bumpfee <outpoint>` (matches card params exactly); `bumpforceclosefee <channel_point>` only as the commented alternative when channelPoint is known.

### Pitfall 5: Export rendering on suppressed/non-action cards
**What goes wrong:** Export control appears on a card whose action was nulled (AP-11-flagged node) or on `investigate`/`update_fee` cards.
**How to avoid:** Gate = `suggestedAction !== null && type ∈ {close_channel, rebalance, remediate_pending}`. `update_fee` is Phase 6's prong (project D3) — never exported. Suppression is already structural upstream; add a unit test asserting no block builds from a suppressed fixture.

### Pitfall 6: Clipboard fails silently off secure contexts
**What goes wrong:** `navigator.clipboard` is undefined on plain-HTTP origins (VM deploy without TLS); COPY does nothing.
**How to avoid:** Feature-detect; on failure show the locked honest failure copy ("copy failed — select the text manually") rather than nothing. Localhost is a secure context, so dev is unaffected [CITED: MDN Clipboard API secure-context requirement].

### Pitfall 7: Console surface params leak-shape regression
**What goes wrong:** Threading full cards into `SignalRow` re-opens the T-04-29 question (suppressed params in DOM) on the console.
**How to avoid:** Suppressed cards have null actions structurally, so threading the card is safe — but prefer threading the *pre-built `ExportBlock`* (strings only, built after the gate) to keep the console DOM surface minimal and the leaf dumb.

### Pitfall 8: Formatted sats inside commands
**What goes wrong:** `formatSats(50000000)` → `"50,000,000"` interpolated into a command = broken/ambiguous CLI arg.
**How to avoid:** Raw integers in `command` strings; `formatSats` only in comment/UI lines. One unit test asserts no `,` in any bare command.

## Code Examples

Verified command templates the builders should emit (sources: LND v0.20.1-beta `cmd/commands/` + fleet scripts):

```bash
# close_channel — force variant safety comment (D-05, verified help text):
# force close broadcasts the latest commitment tx; settled funds are
# TIME-LOCKED for the CSV delay before they can be spent (see step 1 csv_delay).
lncli closechannel --funding_txid <txid> --output_index <idx> --force

# stuck sweep (PENDING-03, mirrors 07-bump-stuck-sweeps.sh):
lncli wallet pendingsweeps        # step 1 — find <txid>:<idx>, check broadcast_attempts
lncli wallet bumpfee --sat_per_vbyte <N> <txid>:<idx>   # step 2 — CPFP/RBF via sweeper

# chan_id echo-back (D-06):
lncli getchaninfo --chan_id <decimal_scid>      # when chanId present
lncli getchaninfo --chan_point <txid>:<idx>     # fallback when chanId is null
```

```typescript
// CommandExport leaf copy handler (pattern: NarrateButton precedent)
// Source: MDN Clipboard.writeText
async function copy(text: string, setState: (s: "copied" | "failed") => void) {
  try {
    if (!navigator.clipboard) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    setState("copied");
  } catch {
    setState("failed"); // locked honest failure copy; never silent
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `--sat_per_byte` | `--sat_per_vbyte` | LND 0.13+ (old flag hidden/deprecated in 0.20.1) | Builders emit only `sat_per_vbyte` |
| `bumpfee --force` | `bumpfee --immediate` | LND 0.18 sweeper rewrite | Never render `--force` on bumpfee |
| `wallet bumpclosefee` | `wallet bumpforceclosefee` | LND 0.18 (old cmd hidden, marked DEPRECATED) | Use the new name in the alternative line |
| Recharts/`react-is` overrides etc. | n/a this phase | — | No chart work in Phase 5 |

**Deprecated/outdated:** `lncli abandonchannel` is not deprecated but dev-gated (`--i_know_what_i_am_doing`) — render as a danger note, never a runnable step.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `lncmd` is an operator-internal LDK/LSPD CLI whose syntax is unknown; no honest runnable LDK command can be rendered this phase | lncmd Verdict | If the operator later supplies real syntax, the LDK branch upgrades from "manual procedure" to a template — additive change, low risk. [ASSUMED] |
| A2 | Warehouse `chan_id` (varchar) holds the decimal SCID lncli accepts | Code Examples | If it's hex/BOLT format, the `getchaninfo --chan_id` line mis-renders; `--chan_point` fallback still works. Cheap to confirm against one live row. [ASSUMED] |
| A3 | `suggestedSatPerVbyte` (= the sweep's `requested_sat_per_vbyte`) is an acceptable starting bump rate | Remediation Runbooks | D-10's mandatory sanity-check comment is the mitigation; operator validates against mempool. [ASSUMED] |
| A4 | The VM deploy will serve over a secure context (or localhost) so `navigator.clipboard` works | Pitfall 6 | Fallback failure copy keeps the feature honest either way. [ASSUMED] |
| A5 | Non-fleet peer aliases are acceptable to render as truncated pubkey + "alias unknown" (no `lnd_node_peer_info` read) | Context Sourcing | If the operator wants real aliases for external peers, add the sanctioned read later — isolated change. [ASSUMED] |

## Open Questions (RESOLVED)

1. **`lncmd` real syntax (operator-held knowledge)** — RESOLVED via the locked LDK honest-fallback (CONTEXT discretion grant). Plan 05-03 ships the honest "not supported — manual procedure" branch for LDK/LSPD nodes, so no runnable `lncmd` invocation is rendered this phase; the question is surfaced again at the plan 05-06 operator checkpoint, where the operator can supply real syntax. If supplied later, the template slot is an additive change (per A1).
2. **SCID format of warehouse `chan_id` (A2)** — RESOLVED by design. `chanId` is treated as SOFT in plans 05-01/05-03: the `CHAN_ID_RE` soft check plus the `--chan_point` fallback covers either encoding (decimal SCID or otherwise), so no rendered command depends on the decimal assumption holding. Optionally confirm one live `lnd_node_channel_info` row during execution as a cheap spot-check; not blocking.

## Environment Availability

Skipped — this phase is pure in-repo code (TS lib + components + tests). No new runtimes, services, or CLIs are required; `lncli` runs on the operator's nodes, never from this app. Node 20+/npm/vitest already in use.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (config: `vitest.config.ts`, carries the `@/` alias) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/lib/export` |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXPORT-01 | lncli close (coop + force) blocks: verified flags, raw-int params, context comments, verify-step-first | unit | `npx vitest run src/lib/export/commands.test.ts` | ❌ Wave 0 |
| EXPORT-01 | LDK branch renders honest "not supported — manual procedure" with params echoed | unit | same | ❌ Wave 0 |
| EXPORT-01 | Rebalance honest placeholder (no runnable command, full params) | unit | same | ❌ Wave 0 |
| EXPORT-01/PENDING-03 | Injection rejection: hostile channel_point/pubkey/alias fixtures → withheld state, never partial command | unit | `npx vitest run src/lib/export/validate.test.ts` | ❌ Wave 0 |
| PENDING-03 | bump_fee / restart_procedure / aged_funding blocks: outpoint + sat/vB echo, D-09 key-steps + script pointers, danger notes | unit | `npx vitest run src/lib/export/commands.test.ts` | ❌ Wave 0 |
| PENDING-03 | Suppressed card fixture → no export block (T-04-16 respected) | unit | same | ❌ Wave 0 |
| EXPORT-01 (detail enrichment) | Detector adds capacitySat/peerAlias to detail without schema change; contract test still green | unit | `npx vitest run src/lib/insight` | ✅ (extend existing detector tests + `schema.contract` stays untouched) |
| UI (D-01/D-02) | Expand + copy interaction, both surfaces | manual-only | operator visual gate (`ui_phase`/`ui_safety_gate` enabled in config) | — justification: interaction polish is operator-gated per project precedent (Phase 3 gate) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/export`
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green before `/gsd-verify-work`; operator visual gate for the expanded block on both surfaces

### Wave 0 Gaps
- [ ] `src/lib/export/validate.test.ts` — injection-rejection + format-regex coverage (EXPORT-01 AC3)
- [ ] `src/lib/export/commands.test.ts` — per-action block snapshots incl. LDK/placeholder/suppressed branches (EXPORT-01, PENDING-03)
- [ ] hostile-alias fixture for `sanitize.ts` (Pitfall 2)
- Framework install: none needed (vitest present)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | single-operator local tool, no auth in v1 (project scope) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | **yes** | zod frozen schema + per-field format regexes + comment-line sanitizer; reject-and-withhold on failure |
| V6 Cryptography | no (this phase) | HMAC signing is Phase 6; zero crypto here |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Param injection into rendered shell snippet (PITFALLS-7) | Tampering | validate-then-interpolate; named regexes; injection unit tests |
| Peer-alias comment breakout (remote-controlled string → executable line) | Tampering | `sanitize.ts` strips newlines/control/`` ` ``/`$`; alias rendered as data (T-04-19 lineage) |
| Suppressed write params reaching export DOM/snippet | Information disclosure / EoP | structural: actions already null upstream (T-04-16); export gate re-checks null; test fixture |
| Export becoming a write path (auto-run, request table) | Elevation of privilege | zero-write boundary is locked; rebalance request table explicitly deferred to ≥ Phase 6; restart never auto (T-04-14, AP-11 playbook) |
| Misleading safety data (invented timelock/fee) | Repudiation/poor accountability | verify-step-first honesty; no value rendered that the warehouse/card cannot truthfully supply |

## Sources

### Primary (HIGH confidence)
- `lightningnetwork/lnd` tag **v0.20.1-beta**, `cmd/commands/commands.go` + `walletrpc_active.go`, `funding/manager.go`, `lncfg/dev.go` (raw GitHub) — every CLI flag table entry; abandonchannel gate; 2016-block default
- In-repo frozen contract & consumers (read this session): `src/lib/insight/{schema,types,engine,guardrails}.ts`, `detectors/{stuck-pending,fee-signals,rebalance}.ts`, `src/lib/config/backends.ts`, `src/lib/db/schema/routing.ts`, `src/lib/format/units.ts`, `src/components/insight/{InsightCardRow,InsightCardList,NarrateButton}.tsx`, `src/components/console/{ActiveSignalsPanel,ExportButton,FleetPendingBoard}.tsx`, `src/app/(overview)/[pubkey]/[tab]/page.tsx`
- Fleet canon: `../lqwdLogs/_library/scripts/{01-safe-lnd-restart,05-fleet-coordination,06-close-zero-coop-pairs,07-bump-stuck-sweeps}.sh`, `operational-anti-patterns.md` §AP-11
- `.planning/phases/04-insight-engine/04-SECURITY.md` (T-04-14/16/19/29), `.planning/research/PITFALLS.md` (Pitfall 7)

### Secondary (MEDIUM confidence)
- docs.rs/ldk-node `Node` API — `close_channel`/`force_close_channel` signatures, no CLI, no bumpfee equivalent (WebFetch of official docs)
- MDN Clipboard API — secure-context requirement for `navigator.clipboard.writeText`

### Tertiary (LOW confidence)
- Web search for `lncmd` — absence-of-evidence finding, treated as a negative claim and cross-checked with full workspace grep (still LOW for "doesn't exist anywhere"; HIGH for "not publicly documented")

## Metadata

**Confidence breakdown:**
- lncli command syntax: HIGH — read from the exact pinned LND version's CLI source
- Card contract / integration points: HIGH — read from frozen in-repo code this session
- LDK/`lncmd` coverage: LOW on the tool's existence (operator-held); HIGH on the honest-fallback prescription (locked decision covers it)
- Context sourcing (capacity/alias/timelock): HIGH — schema columns verified; recommendation is zero-new-query
- aged_funding runbook: MEDIUM — LND mechanics verified from source; runbook composition is proposed (no `_library` precedent exists)

**Research date:** 2026-06-12
**Valid until:** ~2026-07-12 (stable: LND version pinned, contract frozen; re-check only if LND is upgraded or the operator supplies `lncmd` syntax)
