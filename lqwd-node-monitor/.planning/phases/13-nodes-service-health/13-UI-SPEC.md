---
phase: 13
slug: nodes-service-health
status: approved
shadcn_initialized: true
preset: radix-nova
created: 2026-07-07
reviewed_at: 2026-07-07
updated: 2026-07-07
---

# Phase 13 — UI Design Contract · Nodes + Service Health

> Visual and interaction contract for the Lightning depth of the v2 redesign: the rebuilt
> **Nodes list** (NODE-03), the rebuilt **Node Detail** (NODE-04), the centerpiece per-node
> **two-axis service-health grid** (SVC-01), and **Service Detail** (SVC-02).
>
> **The design system is LOCKED.** This phase composes the Phase-10 "Data-Forward v2" tokens
> + primitives against the locked prototypes. It does **not** invent a new visual language and
> does **not** add new tokens or primitives. Where a value below looks specific, it is read off
> `src/lib/df/tokens.ts`, `src/app/globals.css` (the `--*-df-*` block), the Phase-12 contract
> (`12-UI-SPEC.md`), or the two locked prototype snapshots:
> - `.planning/phases/10-design-system-foundation/.prototype-snapshot/Node Detail.dc.html` (Node Detail + service grid — the visual source of truth for SVC-01 / NODE-04)
> - `.planning/phases/10-design-system-foundation/.prototype-snapshot/Ops Center - Data-Forward v2.dc.html` (sibling grammar)
> - `.planning/DESIGN-BRIEF-03-node-detail.md` (operator-authored intent brief)
>
> **Nodes list** and **Service Detail** have no dedicated prototype snapshot; they are derived
> from the locked system + the Phase-12 list/detail grammar and are marked with explicit
> **ASSUMPTIONS** for later operator confirmation (see end). None require a new token or primitive.

> **⚠ UPDATE 2026-07-07 — scope reconciliation (material change from the 6/6-approved baseline).**
> The prior approved revision framed Phase 13 as **purely read-only + advisory** ("no in-app
> mutation, no command emission anywhere in this phase"). Two operator-authored todos marked
> **`resolves_phase: 13`** (and STATE.md: "4 pending todos resolve there") introduce **one
> deliberate, human-gated write path** onto Node Detail:
> - `2026-06-23-node-detail-all-channels-fee-queue.md` — an **all-channels view** with a
>   per-channel **"Queue fee change"** action, independent of any AI recommendation (fixes the
>   08-04 LQWD-Ireland canary: rec-card-only enqueue caused 3× channel mis-targeting and no clean
>   revert path).
> - `2026-06-23-one-click-enqueue-approve.md` — operator decision (Option A): collapse
>   confirm-dialog + separate `/queue` approval into **one deliberate `enqueue+approve` gesture**
>   that signs once and lands the row directly as `approved`, preserving the full audit trail
>   (`∅ → pending_approval → approved`, actor `operator`).
>
> This is a **QUEUE-01/QUEUE-03 human-gated write to the `nodemon` queue DB** — **not** a node
> mutation and **not** an AI action. The safety boundary is unchanged and re-affirmed: the
> dashboard holds **zero node credentials**; the row is HMAC-signed server-side; the **node**
> re-verifies the HMAC, re-enforces param bounds node-side, and applies via atomic
> `FOR UPDATE SKIP LOCKED` claim. The AI layer still **never** emits or executes a command. The
> sections below now carry this write path; the load-bearing invariants section reconciles it.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn (already initialized — `components.json` present) |
| Preset | `radix-nova` (style), `baseColor: neutral`, `cssVariables: true` — unchanged from Phase 12 |
| Component library | radix (shadcn/ui on React 19) + bespoke `src/components/df/*` primitives |
| Icon library | lucide-react (`iconLibrary: lucide`) — state/layer/action icons permitted (D-06) |
| Font | IBM Plex Sans (`--font-df-sans`, body/headings) + IBM Plex Mono (`--font-df-mono`, all data/labels/pubkeys/timestamps) |

**Source of truth (read before implementing):**
- Tokens: `src/lib/df/tokens.ts` (TS mirror) + `src/app/globals.css` `--color-df-* / --radius-df-* / --shadow-df-*`
- Severity ramp API: `src/components/df/Severity.ts` (`severityVariants`, `severityAccent`, `severityIcon`, `severityLabel`)
- Two-axis read model (already shipped, Phase 11): `src/lib/read/service-health.ts`
  (`ServiceHealthState`, `deriveServiceHealth`, `COLLECTOR_WINDOW_MS`, `FUNCTIONING_GRACE`),
  `src/lib/read/chain-telemetry.ts` (bitcoind blocks-behind + bands), and the service relabel
  map `src/lib/overview/service-display.ts` (`SERVICE_DISPLAY`, `serviceDisplay()`).
- Queue write path (existing, Phase 6): `src/lib/queue/*` (`enqueue.ts`, `sign.ts`, `canonical.ts`,
  `bounds.ts` → `updateFeeBoundsSchema`, `transitions.ts` → `approve`, `claim.ts`), and the server
  actions `src/app/actions/queue.ts` (`enqueueCommand`, `approveCommand`, `enqueueBatch`).
  The one-click todo adds an **`enqueueAndApprove`** server action (signs once via `enqueue.ts`,
  lands `approved`, actor `operator`) — the ONE new action; no new primitive.
- Fee formatting: `src/lib/format/units.ts` (AFM-002 — the sole sat/BTC/msat/ppm path;
  `feeMsatToSat`, `formatSats`). No inline unit math anywhere.

**Reused primitives (do NOT rebuild — compose these):**
- `src/components/df/*`: `NavRailShell` · `SeverityHeroCard` · `SeverityCard` · `SeverityRow` ·
  `EvidenceChart` (+`EvidencePanel`) · `StaleChart` · **`TwoAxisPip`** · `FreshnessChip` · `PollAge` ·
  `AiReadPanel` · `CommandModal` (+`CommandPanel`) · `WhyChain` · `BlastRadius` · `CategoryIcon` · `ImplTag`.
- `src/components/queue/*` (the write path — reuse verbatim): **`EnqueuePreview`** (the ONE enqueue
  client leaf: expand → inert preview → deliberate CONFIRM; sends params only, never an HMAC) ·
  **`ApprovePanel`** · `QueueTimeline`.
- `src/components/console/*` (tables/tabs where the grammar already fits): `ConsoleTabs`,
  `EventTable`, `SummaryStrip`, `Sparkline`, `ExportButton`.
- Vendored `src/components/ui/*`: `table`, `sheet`, `dialog`, `badge`, `button`, `tooltip`,
  `checkbox`, `tabs`, `card`.

**Zero new dependency installs expected. No new `df/*` primitive.** The only new code surface is the
`enqueueAndApprove` server action (queue lib composition, not a UI primitive). If a need appears to
require a new primitive, **escalate** rather than invent (per the Phase-10 lock).

---

## Spacing Scale

Identical to the locked Phase-12 contract — the **4px layout grid** with a prototype-locked
2px micro scale *inside* primitives. New Phase-13 composition MUST use the grid below.

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, inline chip padding-y |
| sm | 8px | Compact element spacing, service-tile internal gaps, table cell padding-y |
| md | 12px | Default gap between service-grid tiles + node-list rows (`gap:12px`) |
| md+ | 16px | Card inner padding-y (`16–18px`), filter-row spacing, section gaps |
| lg | 24px | Section header spacing, page horizontal padding (`24–32px`) |
| xl | 32px | Page gutter (`padding:24px 32px`), top-bar horizontal padding |
| 2xl | 48px | Major vertical section breaks (VM vitals → service grid → Lightning) |
| 3xl | 64px | Page bottom padding (`padding-bottom:64px`) |

**Exceptions (locked, inherited — NOT introduced by this phase):** the prototypes use a
2px-refined micro scale for component-internal rhythm — observed in the Node Detail snapshot as
`padding:16px 18px 13px`, `padding:11px 18px`, `padding:3px 8px`, `padding:2px 7px`, and the
`TwoAxisPip` axis-box `px-2.5 py-2`. These are part of the locked Data-Forward v2 primitives and
are reused verbatim; they are NOT free choices for new layout code. The `EnqueuePreview` control
chrome (mono-uppercase-over-outline button, tight radius) is likewise reused verbatim.
Max content column width: **1180px** (`max-width:1180px; margin:0 auto`) — matches overview.

---

## Typography

Locked from the Data-Forward v2 prototypes + `--font-df-*`. Weight set is the locked
**400 / 500 / 600 / 700** (inherited from DS-01, not a per-phase choice). All numeric / data /
identifier text — pubkeys, chan_ids, counts, sats, ppm, %, timestamps, heartbeat ages, error
counts, fee-policy values — renders in **IBM Plex Mono with `tabular-nums`**; prose renders in
**IBM Plex Sans**.

| Role | Size | Weight | Line Height | Notes |
|------|------|--------|-------------|-------|
| Display (node header title) | 23px | 700 | 1.18 | `letter-spacing:-.02em` — node alias in the header |
| Heading (card / section title) | 15.5px | 600 | 1.3 | `letter-spacing:-.01em` — service-group headers, Lightning card titles, channels-table title |
| Body | 14.5px | 400 (600 emphasis spans) | 1.55–1.6 | AI-read prose, diagnostic "why" lines; max measure ~62–92ch |
| Secondary body | 13–13.5px | 400 | 1.5 | service-tile notes, log-line prose, safety footer, enqueue preview note |
| Label / meta | 11.5–12px | 500 | 1.4 | list filter chips, layer/role chips, freshness text, service-tile captions |
| Kicker / eyebrow | 10.5–11.5px | 700 | 1 | UPPERCASE, `letter-spacing:.06–.09em` — `INFRASTRUCTURE`, `LQWD SERVICES`, `VM VITALS`, `LIGHTNING`, `CHANNELS`, `ACTIVE SIGNALS`, `SERVICE HEALTH` section headers + severity labels + the enqueue control voice |
| Data / numeric | 9–24px | 600–700 | 1 | IBM Plex Mono, `tabular-nums` — vitals value (24px/700), evidence value (13–16px), axis-box caption (9px/700 in `TwoAxisPip`), pubkeys/chan_ids/timestamps + fee ppm/base_msat/cltv (mono, muted) |

**Rule (locked, from sketch-findings + DS-01):** mono carries data + identifiers + timestamps;
sans carries prose. **Never** set a node pubkey, chan_id, count, %, ppm, base_msat, cltv, sat
value, heartbeat age, or timestamp in sans.

---

## Color

60/30/10 split. **Two structurally separate axes (DS-01, non-negotiable):** navy is
**structure / action only**; the severity ramp is **state only** and appears nowhere as chrome.
The Node Detail prototype was verified to use exactly this palette (navy `#13284F`/`#33559B`,
severity `#E0392B`/`#C8770A`/`#0E8C84`/`#1E9E63`, neutrals `#9AA3B4`/`#6F7787`).

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#EEF1F5` (`df-bg`) | Page background |
| Secondary (30%) | `#FFFFFF` (`df-surface`) + `#FAFBFD` (`df-surface-sub`) | Cards, service tiles, evidence panels, list/channel rows; `#13284F` (`df-chrome`) for the nav rail + AI-read shell |
| Accent (10%) | `#1A3C79` (`df-brand`) / `#13284F` (`df-chrome`) | Structure + actions only (exhaustive list below) |
| Deliberate-write act | `#1A3C79` (`df-brand`) | The single **enqueue+approve CONFIRM** gesture — navy, per sketch-findings ("navy reserved for the focus ring + the CONFIRM act") and the `EnqueuePreview` chrome. **Not** a severity hue, **not** destructive-red. |
| Destructive (delete-red) | n/a this phase | **No destructive/delete action exists.** The one write path is a human-gated enqueue+approve to the queue DB (reversible before node claim per the withdraw affordance — see assumptions); it never directly mutates the node and holds no node credentials. |

**Accent (navy) reserved for — exhaustive list:**
- Left nav rail background + active rail item (`NavRailShell`)
- Primary action buttons ("Export fix", "Open runbook", "Investigate", "Copy command", CSV "Export")
- **The `EnqueuePreview` control + its deliberate `enqueue+approve` CONFIRM act** (the ONE write gesture)
- Links + expand/collapse toggles (row→detail links, tile-expand, channel-row "queue fee change" expand, "Show why", back-to-overview)
- Sortable-column active header indicator + active list/channel filter chip
- The "AI read" inline callout chrome (`#EEF2FA` wash, navy mark) + the AI-read panel shell (`#13284F`)
- Focus rings
- The zero-credential **read-only-to-the-node safety posture** chrome (`#EAEEF6` / navy shield) on Node Detail

Navy is **never** used to signal health/severity, and **never** to mark an at-risk row — at-risk
emphasis is the severity ramp (left accent bar + tint), not navy.

**Severity ramp (state axis — `df-*` tokens, separate from navy):**

| State | Accent (non-text) | Text (AA) | Tint | Border |
|-------|-------------------|-----------|------|--------|
| critical | `#E0392B` | `#E0392B` | `#FCEBEA` | `#F3D3D0` |
| warning | `#C8770A` | `#C8770A` | `#FBF0DD` | `#EFE0C5` |
| watch (teal) | `#0E8C84` | `#0E8C84` | `#E2F2EF` | `#C2E3DD` |
| healthy | `#1E9E63` (dots/bars) | `#1E7A4E` (text) | `#E7F4EC` | `#1E9E63` |
| **stale** | `#C8A23A` (dot) | `#A9912F` (text) | `#F7F0DC` | `#E9DCB6` |

**Stale is its own state (D-08), never rendered as critical and never faked-fresh.** Shape-distinct:
gold tint + clock/`CircleDashed` glyph + the `StaleChart` hatched "NO FRESH DATA" placeholder —
never a green dot, never an interpolated line. Applies to a stale node row, a stale service tile
(no heartbeat within `COLLECTOR_WINDOW_MS`), a stale evidence chart, **and a stale per-channel
fee baseline** (a channel whose last `lnd_node_channel_info` row is old — the 08-04 canary lag).

Neutral chart gray `#64748B` (`df-slate`) is the only color for threshold lines + peer-median
bands inside evidence charts (not a state color).

**Two-axis color law (SVC-01, locked in `TwoAxisPip`):** a service tile is **green only when
BOTH `running` AND `functioning` are true**. `running && !functioning` ("UP · NOT HEALTHY", the
up-but-dead state) MUST render with red tile chrome + a red "Functioning: no" axis box + a pulsing
alarm dot — unmistakably distinct from both green and from `!running` ("DOWN"). This precedence is
already implemented in `TwoAxisPip.combinedState()`; do not re-derive or soften it.

---

## Component Inventory & State Matrix

All compositions below are built from existing `df/*` (+ `console/*`, `queue/*`, `ui/*`) primitives.
No new UI primitive is introduced; the only new module is the `enqueueAndApprove` server action.

### Screen A — Nodes List (NODE-03) · route `src/app/(overview)/nodes/` *(ASSUMPTION: route)*

#### A1. `NodesShell` (page)
- Wraps `NavRailShell` (fixed 60px navy rail + sticky translucent top bar), same chrome as the
  overview. Top bar carries app title + a fleet freshness chip (`FreshnessChip` / `PollAge`,
  honest, never faked).
- Content column: `max-width:1180px`, ordered: page title + result count → `NodeFilters` →
  `NodesTable` → honest empty/stale states.

#### A2. `NodeFilters` (NODE-03)
- A row of toggle chips over three facets: **type** (All · LND routing · LDK/LSP) · **status**
  (All · Healthy · At-risk · Offline) · **stale** (a single "Stale only" toggle). Active chip =
  navy fill / white; inactive = hairline border, muted (identical grammar to `QueueFilters`).
- Pure view filter over the loaded node set; combinable; honest empty state when none match.

#### A3. `NodesTable` (NODE-03) — composes `ui/table` + `SeverityRow` grammar
- Sortable columns: alias, type, status/severity, active channels, local/remote liquidity ratio,
  30d forwarding (count + earned sats), last-seen freshness. Column header click toggles sort;
  active sort column shows a navy indicator (navy = structure, not state).
- **At-risk rows pop:** a critical/warning row carries a **left severity accent bar + severity
  tint** (via `severityAccent` / `severityVariants`), the row's worst-of severity label chip, and
  its one-line "why". Healthy rows are quiet (neutral surface, green dot). Stale rows use the gold
  stale treatment, never green.
- **Evidence in-row:** liquidity ratio as a compact bar; 30d forwarding as a `Sparkline`/mono
  figure — enough to justify attention, not a Grafana firehose.
- **Row → detail:** the whole row links to Node Detail (`/{pubkey}` — see routing note). Mono
  pubkey is truncated; alias is sans.
- States: `default` · `at-risk` (accent+tint) · `offline` · `stale` · `empty (filtered)`.

### Screen B — Node Detail (NODE-04) · route `src/app/(overview)/[pubkey]/` (rebuild)

> Visual source of truth: the locked **Node Detail.dc.html** snapshot + DESIGN-BRIEF-03.
> Top-to-bottom order below is prototype-locked; the **channels view (B8)** is the operator-todo
> addition and slots into the Lightning layer.

#### B1. `NodeDetailShell` (page) + `NodeHeader` (NODE-04)
- `NavRailShell` chrome. Header: node alias (23px/700 sans) + truncated **pubkey (mono)**, a
  role chip (`LND routing` / `LDK-LSP`), the **host it runs on** (links toward Phase-14 Host
  Detail — link may resolve later), an **overall health pill** (worst-of across all layers), and
  an honest freshness chip ("data fresh · 4s" / stale). A back-to-overview affordance.

#### B2. `VmVitals` (NODE-04) — composes `EvidenceChart` / `EvidencePanel` / `StaleChart`
- Compact evidence charts for this node's VM: CPU / memory / disk (disk with a projected
  time-to-full marker only when growth data is fresh/sufficient — honest, no projection on stale).
  Same chart style + `df-slate` threshold lines as the overview.

#### B3. `ServiceHealthGrid` (SVC-01) — **CENTERPIECE** — composes `TwoAxisPip` × N
- Two labeled groups under kicker headers: **`INFRASTRUCTURE`** (bitcoind, esplora, postgres —
  the infra deps) and **`LQWD SERVICES`** (the six custom: aiLiquidityManager, internalRebalancer,
  Monitoring, nodeAuditor, addressBalances, channelAcceptor). Service display names via
  `serviceDisplay().label` (never the raw machine key on screen).
- Each tile = one `TwoAxisPip` fed `{ running, functioning, name, heartbeat, lastRun, errorCount }`
  derived from `deriveServiceHealth()` (Phase-11 read model). Grid: responsive multi-column,
  `gap:12px`.
- **Green ONLY when both axes true.** The **"up but dead"** state (`running && !functioning`,
  e.g. the `addressBalances` showcase — heartbeat stale 2h, last run "failed · connection refused
  ×14") renders with red tile chrome + red Functioning box + pulsing alarm dot. A `!running`
  service is "DOWN"; a not-expected/no-data service reads honestly (stale/unknown), never
  green-by-default. Intentionally-paused-by-design states (e.g. aiLiquidityManager paused while
  bitcoind stalls) read as **watch** (teal), not false-red — represent via `functioning=false`
  only when it is genuinely degraded; otherwise a watch note.
- **Tile click → expand:** reveals that service's recent log lines + an inline `AiReadPanel` read
  (advisory-only). This is the in-page preview; the full surface is Service Detail (Screen C).

#### B4. `NodeLogsStream` (NODE-04) — composes `EventTable` + `AiReadPanel`
- A logs/events stream **filterable by service** (a chip per service, same relabel map). Each
  notable error can carry an inline AI explanation (what it means · needs attention now? · the
  dependency/impact path) — clearly labeled AI, dismissible, **never emits a runnable command**.

#### B5. `LightningState` (NODE-04) — composes `SeverityCard` / `EvidenceChart` + `console/*`
- The Lightning performance layer as overview-style evidence cards: channels (active/pending),
  local/remote liquidity, fee policy (ppm/base via the AFM-002 formatter), forwards + history,
  peers, pending HTLCs (flagged at-risk when the chain backend can't confirm). Reuse the existing
  `console/*` tables (`EventTable`, `SummaryStrip`, `ExportButton` for CSV) where they already fit.

#### B6. `NodeActiveSignals` (NODE-04) — composes `SeverityCard` + `WhyChain` + `CommandModal`
- This node's own incidents using the SAME card + why-chain + adaptive-action system as the
  overview. **Adaptive action (exactly one per signal):** `Export fix` (a real inert one-liner) /
  `Open runbook` (host-op steps) / `Investigate` (read-only drill). Export/runbook open the inert
  `CommandModal`; Investigate navigates read-only. **No in-app mutation from AI signals.**

#### B7. `ReadOnlySafetyPosture` (NODE-04) — composes the navy safety-footer chrome
- A visible posture strip (navy-washed + shield glyph) reaffirming zero stored node credentials.
  **Reconciled copy (see Copywriting):** NodeMonitor reads and ranks and **never directly changes
  this node**; a fee change is a **signed, operator-approved intent the node itself verifies and
  applies** (HMAC re-verify + node-side bounds + atomic claim); high-risk fixes still export as
  commands you run; the AI explains and never executes. Present on every Node Detail load.

#### B8. `NodeChannelsTable` (NODE-04 + operator-todo) — composes `ui/table` + `EnqueuePreview` + `FreshnessChip`
> Source: `2026-06-23-node-detail-all-channels-fee-queue.md` (resolves_phase 13). The
> AI-rec-only enqueue path caused 3× channel mis-targeting on the 08-04 canary; this gives the
> operator a direct, per-channel, no-AI-required fee-queue surface.
- Lists **all** channels for the node — per row: `chan_id` (mono, truncated), peer alias (sans),
  capacity, local/remote balance (mono + a compact ratio bar), **current fee policy**
  (ppm / base_msat / cltv via `units.ts`), active/inactive state.
- **Per-channel "Queue fee change" action (LND-backed rows only):** each row exposes a navy
  control that expands the existing **`EnqueuePreview`** leaf pre-targeted to THAT `chan_id` —
  independent of any AI recommendation. The operator can raise **or lower** ppm (fixing the
  canary's "no clean revert to ppm 1" gap). The client clamps to `updateFeeBoundsSchema` for UX;
  the CONFIRM act sends params only — `enqueueAndApprove` re-validates + **signs server-side**.
  The client never produces an HMAC.
- **Honest per-channel freshness (load-bearing — canary lesson):** the current-fee baseline shown
  in the row MUST carry an honest `collected_at`-derived freshness chip. When the channel's latest
  `lnd_node_channel_info` row is stale, the row shows the **stale** treatment and the enqueue
  preview surfaces a **"baseline may be stale"** warning so the operator never sets a fee off a
  wrong baseline. Never render a stale fee value as current.
- LDK/non-`update_fee`-eligible rows show the policy read-only (no queue action).
- Sortable/filterable by active/inactive; CSV via the existing `ExportButton` (read path).
- States: `default` · `inactive` · `stale-baseline` · `enqueue-open` (inert preview) ·
  `enqueued+approved` (row reflects the pending-approved intent + its withdraw affordance — see
  Interaction Contract) · `empty` (no channels).

### Screen C — Service Detail (SVC-02) · route `src/app/(overview)/[pubkey]/service/[service]/` *(ASSUMPTION: route)*

> No dedicated prototype; composed from the locked system + the Node Detail service-tile grammar.
> MUST render two variants from ONE component tree: **infra** (`bitcoind`) and **custom-service**
> (`addressBalances`), differing only in data + which evidence chart shows (bitcoind → chain
> blocks-behind via `chain-telemetry`; custom → last-run/error-count).

#### C1. `ServiceDetailShell` + `ServiceHeader` (SVC-02)
- `NavRailShell` chrome. Header: service display name (`serviceDisplay().label`) + its owning
  node/host (mono, links back), a **full-size two-axis health block** (the `TwoAxisPip` state,
  expanded), and an honest freshness chip.

#### C2. `ServiceVitals` (SVC-02) — composes `EvidenceChart` / `StaleChart`
- Heartbeat age, last-successful-run time, and error count over the window as mono figures +
  a trailing evidence chart. **Infra variant (bitcoind):** blocks-behind-tip + verificationprogress
  via `buildChainEvidence()` with its thresholds/bands. **Custom variant (addressBalances):**
  run-success/error-count series. Stale → `StaleChart` "NO FRESH DATA", never a faked line.

#### C3. `ServiceLogTail` (SVC-02) — composes `EventTable` + `AiReadPanel`
- A log tail for this one service, with the inline AI read (advisory-only) explaining the pattern.

#### C4. `RestartHistory` (SVC-02) — composes `EventTable` / `WhyChain`
- Restart/recovery timeline (when the process last cycled). Read-only; honest empty state when
  no restarts recorded.

#### C5. `Dependents` (SVC-02) — composes `BlastRadius` grammar
- What depends on this service (e.g. bitcoind → the nodes + services that share it) so the operator
  sees blast radius before acting.

#### C6. `VerifyFirstRunbook` (SVC-02) — composes `CommandModal` / `CommandPanel`
- A **unified verify-first runbook**: verify-the-symptom steps FIRST, then the remediation
  command(s) as inert copy-to-run. Infra variant references the safe coordinated-restart procedure
  (NOT an auto-restart); custom variant references the service-specific recovery. **Never executes.**

---

## Interaction Contract

| Interaction | Contract |
|-------------|----------|
| List filter (type/status/stale) | Pure view filter over the loaded node set; combinable; honest empty state when none match. Navy chips = structure, never a severity hue. |
| List sort | Column-header toggle; active column shows a navy indicator; sorting is view-only (no re-fetch required). |
| Row → Node Detail | Whole row links to `/{pubkey}`. No mutation. |
| Service tile → expand (Node Detail) | In-place reveal of recent logs + inline `AiReadPanel` read. No navigation. |
| Service tile / name → Service Detail | Links to the Service Detail screen for the full surface. |
| Logs filter by service | Chip toggles narrow the stream; view-only. |
| Node signal → expand | In-place `WhyChain` + AI-read callout + adaptive action. No navigation. |
| Adaptive action (Export fix / Open runbook) | Opens the inert `CommandModal` (copy-to-run). **No in-app mutation, no command emission** from the AI/signal path. |
| Adaptive action (Investigate) | Read-only navigation/drill; emits nothing. |
| **Channel row → "Queue fee change"** | Expands the `EnqueuePreview` leaf pre-targeted to that `chan_id` (LND rows only). Inert preview; raise OR lower ppm; edits clamp to `updateFeeBoundsSchema` client-side for UX only. **View-only until CONFIRM.** |
| **Enqueue + approve (CONFIRM)** | ONE deliberate gesture — the navy CONFIRM button IS the confirmation (the redundant `window.confirm` is dropped per the one-click todo). Calls **`enqueueAndApprove`**: server re-validates params, **signs once** (`enqueue.ts`), lands the row directly `approved`, records the full audit trail `∅ → pending_approval → approved` (actor `operator`). **The client never sends an HMAC.** Explicitly NOT auto-approve-on-enqueue and NOT bypass-the-queue — it collapses two operator clicks into one deliberate one. |
| **Stale-baseline guard** | If the channel's fee baseline is stale, the preview shows a "baseline may be stale" warning before CONFIRM is enabled/pressed; the operator is never allowed to silently set a fee off a stale read. |
| **Withdraw approved-but-unclaimed** *(assumption — confirm in planning)* | An operator affordance to cancel/withdraw an `approved` row **before the node claims it** (today an approved-unclaimed row can only clear via 24h TTL or a manual DB write). Preserves the audit trail. |
| CSV export (Lightning / channels tables) | Reuses the existing Phase-3 `ExportButton` client-side serializer; no write path. |
| Freshness | Every card/tile/row/channel shows an honest `collected_at`-derived stamp; stale renders as `stale`, never faked-fresh (D-08). |
| AI read (tiles/logs) | Advisory-only, clearly labeled AI, dismissible; MUST NOT render or emit any runnable command or signed param (re-affirmed Phase 16, HARDEN-03). The AI never produces the `params` that get signed — those come only from the deterministic engine or the operator's explicit channel edit. |

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Nodes-list section header | `NODES · <n>` (mono count, uppercase kicker) |
| Nodes-list at-risk row label | severity label via `severityLabel` (`CRITICAL` / `WARNING` / `WATCH`) — never an icon alone |
| Node Detail primary CTA (signals) | `Export fix` / `Open runbook` / `Investigate` — verb + noun, opens inert modal or read-only view |
| Service-grid group headers | `INFRASTRUCTURE` · `LQWD SERVICES` (uppercase kickers) |
| Two-axis tile states | `HEALTHY` (both) · `UP · NOT HEALTHY` (up-but-dead) · `DOWN` (not running) — verbatim from `TwoAxisPip.combinedState()`; axis boxes read `RUNNING` / `FUNCTIONING NORMALLY` with `yes` / `no` |
| Up-but-dead evidence example | `addressBalances can't reach its index DB — balances shown are ~2h stale; rebalance decisions would use stale data. Same dependency chain as the host-03 stall. Not customer-facing.` (AI-read voice example) |
| Channels-table section header | `CHANNELS · <n>` (mono count, uppercase kicker) |
| Channel row fee-queue action | `Queue fee change` (verb + noun; navy control, per-channel, no AI required) |
| Enqueue preview confirm | `Enqueue + approve` (the ONE deliberate write gesture) · sub-note: `Signs a fee intent this node verifies and applies. NodeMonitor holds no node credentials.` |
| Enqueue stale-baseline warning | `Baseline may be stale — this channel's last fee reading is <t> old. Confirm you're setting against the intended current policy before you queue.` |
| Enqueue success | `Queued + approved · fee intent for <chan_id short> awaits this node's next verified tick.` |
| Withdraw approved-unclaimed *(assumption)* | Action: `Withdraw` · confirm: `Pull this approved fee intent before the node claims it? The audit trail is preserved.` |
| Service Detail heading | `<service display name>` (e.g. `Address List Sync`, `bitcoind`) |
| Verify-first runbook lead | `Verify first` — symptom-confirmation steps precede any command |
| Node Detail safety posture | `Zero node credentials stored.` + `NodeMonitor reads and ranks; it never directly changes this node. A fee change is a signed intent the node itself verifies (HMAC), re-bounds-checks, and applies — you approve it here, the node runs it. High-risk fixes export as commands you run. The AI explains; it never executes.` |
| Empty state — Nodes list (filtered) | Heading: `No matching nodes.` · Body: `Clear the filter to see the full fleet.` |
| Empty state — Nodes list (all healthy) | Heading: `All nodes healthy.` · Body: `Every node is reporting fresh — nothing needs attention right now.` |
| Empty state — channels table | Heading: `No channels on this node.` · Body: `Nothing to queue a fee against yet.` |
| Empty state — logs stream | `No log events in this window.` |
| Empty state — restart history | `No restarts recorded for this service.` |
| Stale chip / placeholder | Chip: `STALE DATA` · Chart placeholder: `NO FRESH DATA` + `last good <t> ago` (never a faked value) |
| Stale service note | `Freshness · this service hasn't reported since <t>; shown as last-known, not current.` |
| Error state (read/telemetry unreachable) | `Couldn't load <node/service> telemetry.` + `The read model is unreachable — this is a data-source problem, not a node failure. Retry, or check the warehouse connection.` |
| Enqueue error (already-transitioned) | `This command is no longer pending approval — it was already approved, rejected, or expired. Reload the queue.` (verbatim from `queue.ts`) |
| Destructive confirmation | **No destructive/delete action.** The one write path is a human-gated `Enqueue + approve` whose single navy CONFIRM button IS the deliberate gesture (no separate `window.confirm`); it never mutates the node directly and is reversible before node claim via `Withdraw`. |

**Voice (from DESIGN-BRIEF-02/03 quality bar — Linear/Vercel/Stripe):** calm, confident, plain
operator language; lead with what needs attention and what to do; never alarmist, never faked
reassurance. Numbers in mono; prose in sans.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | existing vendored primitives only (`table`/`sheet`/`dialog`/`badge`/`button`/`tooltip`/`checkbox`/`tabs`/`card` already in `src/components/ui/`); no new adds expected | not required |
| third-party | none (`components.json` → `"registries": {}`) | not applicable |

No third-party registry is declared for this phase. If planning later requires one, the vetting
gate (`npx shadcn view … --registry …` + pattern scan) MUST run before it enters the contract.
This phase composes existing `df/*` + `console/*` + `queue/*` + already-vendored shadcn primitives;
the only new code is the `enqueueAndApprove` server action (queue lib composition, no dependency,
no primitive). **Zero new dependency installs expected.**

---

## Accessibility & Honesty Invariants (locked, must hold)

- AA text contrast: use the `-text` severity roles for text (e.g. `df-ok-text #1E7A4E`), the
  bright `-` roles for dots/bars only. `df-faint #9AA3B4` is **decorative only** — never body text.
- Severity is never conveyed by color alone: every state pairs color with a lucide glyph
  (`severityIcon`) and/or an uppercase mono label (`severityLabel`). The two-axis tiles pair color
  with the explicit `yes`/`no` axis boxes + `HEALTHY`/`UP · NOT HEALTHY`/`DOWN` label.
- Honest stale/no-data everywhere (D-08): `stale` is a first-class state; a service with no
  heartbeat inside `COLLECTOR_WINDOW_MS` reads stale, never green; a not-expected service reads
  honestly, never faked-fresh; **a stale per-channel fee baseline reads stale and warns before an
  enqueue** (canary lesson).
- **The two-axis contract is the phase's load-bearing invariant (SVC-01):** green requires BOTH
  axes; the up-but-dead state must be unmistakable. Do not collapse the two axes into one dot.
- **Write-path safety boundary (reconciled, load-bearing):** the one deliberate write is
  human-gated **enqueue+approve to the `nodemon` queue DB** — NOT a node mutation and NOT an AI
  action. The dashboard holds **zero node credentials**; params are re-validated + **HMAC-signed
  server-side** (client never sends a signature); the **node** re-verifies the HMAC, re-enforces
  bounds node-side, and applies via atomic `FOR UPDATE SKIP LOCKED` claim. `enqueueAndApprove`
  preserves the full audit trail (`∅ → pending_approval → approved`, actor `operator`). This is
  explicitly NOT auto-approve-on-enqueue and NOT queue-bypass (per the operator's Option-A decision).
- **AI stays advisory-only (D-04, project core value, re-affirmed Phase 16 HARDEN-03):** nothing
  the AI renders emits or executes a command; the AI never produces the signed `params`. The
  numeric fee params come only from the deterministic engine or the operator's explicit,
  bounds-clamped channel edit — never from the AI layer.

---

## Open Assumptions (for operator confirmation during planning)

Resolved from the locked design system + briefs + the two Phase-13 todos; none require a new
token/primitive. Flagged so the operator can confirm or redirect:

1. **Routes.** Nodes list assumed at `/(overview)/nodes`; Service Detail at
   `/(overview)/[pubkey]/service/[service]`. Node Detail rebuilds the existing `/(overview)/[pubkey]`
   (currently a redirect + `[tab]` sub-routes). (No prototype dictates URLs; these mirror the
   existing route grammar.)
2. **Nodes-list columns.** The evidence columns (alias, type, status, channels, liquidity ratio,
   30d forwarding, last-seen) are a reasonable default from NODE-03's "liquidity/forwarding
   evidence" + existing scorecard reads; exact set/order not prototype-locked.
3. **Service Detail layout.** Derived from the Node Detail service-tile grammar (no dedicated
   snapshot). The infra/custom variant split is required by SVC-02; the section order (health →
   vitals → log tail → restart history → dependents → runbook) is a sensible default.
4. **"Paused by design" services** (e.g. aiLiquidityManager paused while bitcoind stalls) are
   represented as **watch** (teal) with a note, not false-red — assumes the read model can express
   an intentional-degraded distinct from a failing heartbeat. Confirm the telemetry supports it;
   if not, fall back to a watch note over `functioning=true`.
5. **Per-channel fee-queue is IN SCOPE (todo `node-detail-all-channels-fee-queue`, resolves_phase 13).**
   Confirmed against STATE.md ("4 pending todos resolve there"). This reverses the prior spec's
   "purely read-only" framing to include the human-gated enqueue+approve write path. **Confirm the
   channels read has a fee-freshness source** honest enough to queue against (the 08-04 canary hit
   a Jan-14 snapshot as the "latest" row for a live channel) — either a fresher read or the honest
   stale warning above.
6. **Withdraw approved-but-unclaimed** (canary caveat): the todo says *consider* an operator
   cancel/withdraw for `approved`-but-unclaimed rows (today only 24h TTL or a manual DB write can
   clear one). Spec'd above as an assumption; **confirm whether it lands in Phase 13** or defers,
   and whether it needs a new `approved → withdrawn` transition (audit-preserving) in `transitions.ts`.
7. **`enqueueAndApprove` server action** (todo `one-click-enqueue-approve`, Option A): confirm it
   signs once via `enqueue.ts` and lands `approved` with actor `operator`, reusing
   `updateFeeBoundsSchema` + node-side re-verify unchanged. The redundant `window.confirm` in
   `EnqueuePreview` is dropped; the CONFIRM button is the deliberate gesture.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending (re-review required — write-path scope added since prior 6/6 approval)
