---
phase: 14
slug: hosts-infra-monitoring
status: approved
shadcn_initialized: true
preset: radix-nova
created: 2026-07-13
reviewed_at: 2026-07-13
---

# Phase 14 — UI Design Contract · Hosts + Infra Monitoring

> Visual and interaction contract for the infrastructure layer: the **Hosts list** (HOST-01)
> and **Host Detail** (HOST-02). Per D-01, **there is no prototype snapshot for these screens —
> this spec IS the visual source of truth**, derived from the sibling grammar:
> - `.planning/phases/13-nodes-service-health/13-UI-SPEC.md` (list facets, single-scroll detail, section treatments)
> - `.planning/phases/10-design-system-foundation/.prototype-snapshot/Node Detail.dc.html` + `Ops Center - Data-Forward v2.dc.html` (grammar reference only)
> - `.planning/phases/14-hosts-infra-monitoring/14-CONTEXT.md` (D-01…D-16, all locked)
>
> **The design system is LOCKED (strict reuse, D-02) with exactly ONE scoped addition:** the
> **`ThresholdMeter`** primitive (D-03), specified in full below. No new tokens, no other new
> primitives, no new dependencies. Anything else missing gets composed from what exists or
> escalated to the operator — never invented.
>
> **This phase is read-only end to end.** No write path, no enqueue, no queue action, no AI
> command emission. The only "action" surfaces are the inert `CommandModal` runbook and
> read-only navigation (D-11; "Not in scope: any write path").
>
> **Blocking gate (D-04):** the operator must approve this spec before `/gsd-plan-phase 14` runs.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn (already initialized — `components.json` present) |
| Preset | `radix-nova` (style), `baseColor: neutral`, `cssVariables: true` — unchanged from Phases 12/13 |
| Component library | radix (shadcn/ui on React 19) + bespoke `src/components/df/*` primitives |
| Icon library | lucide-react (`iconLibrary: lucide`) |
| Font | IBM Plex Sans (`--font-df-sans`, prose) + IBM Plex Mono (`--font-df-mono`, all data/labels/ids/timestamps) |

**Source of truth (read before implementing):**
- Tokens: `src/lib/df/tokens.ts` (SSR-safe TS mirror) + `src/app/globals.css` `--color-df-* / --radius-df-* / --shadow-df-*`
- Severity API: `src/components/df/Severity.ts` (`severityVariants`, `severityAccent`, `severityIcon`, `severityLabel`)
- Read model (Phase 11, shipped — consume, never re-derive):
  `src/lib/read/host-metrics.ts` (`getLatestHostMetrics`, `HostMetricsView`, `deriveStale`),
  `src/lib/read/storage-growth.ts` (`computeStorageGrowth`, `StorageGrowth`, `StorageProjectionStatus`),
  `src/lib/read/chain-telemetry.ts` (bitcoind blocks-behind + bands),
  `src/lib/read/service-health.ts` (`ServiceHealthState`, `deriveServiceHealth`),
  `src/lib/read/telemetry-bands.ts` (read-time threshold bands — the D-13 days-to-full bands extend this)
- Overview machinery (Phase 12, shipped — reuse):
  `src/lib/overview/ownership.ts` (`buildOwnershipMap`), `src/lib/overview/incidents.ts`
  (`assembleIncidents`, `GroupedIncident`), `src/lib/overview/severity-map.ts` (`worstSeverity`,
  canonical per-source → 4-level ramp), `src/lib/overview/node-filter.ts` (`parseNodeFacets`
  facet grammar template), `src/lib/overview/service-display.ts` (`serviceDisplay()` — never
  render a raw machine key)

**Reused primitives (compose these — do NOT rebuild):**
- `src/components/df/*`: `NavRailShell` · `SeverityCard` · `SeverityRow` · `TwoAxisPip` ·
  `EvidenceChart` · `StaleChart` · `FreshnessChip` · `PollAge` · `CommandModal` · `WhyChain` ·
  `CategoryIcon` · `ImplTag`
- `src/components/console/Sparkline.tsx` — Host Detail VM-vitals sparklines
- Vendored `src/components/ui/*`: `card`, `tooltip`, `badge`, `button`, `table`, `dialog`

**The ONE new primitive (D-03): `ThresholdMeter`** — `src/components/df/ThresholdMeter.tsx`

| Aspect | Contract |
|--------|----------|
| What | A horizontal severity-ramp-colored fill meter: hairline track + colored fill proportional to a 0–100 % value. |
| Props | `{ pct: number; sev: Severity; stale?: boolean; label?: string; className?: string }` — **presentation-pure**: the caller computes `sev` from the read-time bands (`telemetry-bands` / D-13); the meter NEVER hardcodes or derives thresholds itself (the 12-10 lesson: a display component never computes health). |
| Geometry | Track height 6px, radius `df-pill` (6px), track `df-border-soft #ECEFF4`, fill = the severity **accent** hue (`#E0392B` / `#C8770A` / `#0E8C84` / `#1E9E63`). Fill width = `pct` literally (proportional truth, like the fleet-vitals bar). |
| Stale | `stale=true` renders the gold stale treatment (`df-stale-*` tint/border, no colored fill, hatched or dashed track) — never a green or red fill off old data. |
| A11y | Never color alone: the meter always renders adjacent to a mono numeric value (e.g. `82%`) and, when at-risk, the `severityLabel`. `role="meter"` + `aria-valuenow/min/max` + `aria-label`. |
| Consumers | HOST-01 card CPU/mem/disk meters AND HOST-02 storage volume rows — one shared primitive, both places. |
| Gates | Registers in the `/design-system` gallery (all severity states + stale + edge 0%/100%), ships with a vitest test, passes the same noc-guard/parity gates as every df primitive. No SVG chart internals needed — plain div/CSS, so CSS variables are safe. |

Zero new dependency installs. No other design-system change of any kind.

---

## Spacing Scale

Identical to the locked Phase-12/13 contract — the **4px layout grid**, with the prototype-locked
2px micro scale living only *inside* the reused primitives.

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, inline chip padding-y, meter↔value gap |
| sm | 8px | Compact element spacing, node-dot row gap, volume-row internal gaps |
| md | 12px | Gap between grid tiles / compact node rows (`gap:12px`) |
| md+ | 16px | Host-card grid gap, card inner padding-y (16–18px), filter-row spacing |
| lg | 24px | Section header spacing, page horizontal padding (24–32px) |
| xl | 32px | Page gutter (`padding:24px 32px`), top-bar horizontal padding |
| 2xl | 48px | Major vertical section breaks on Host Detail (incident → vitals → services → storage → nodes) |
| 3xl | 64px | Page bottom padding |

Exceptions: **none new.** Inherited (locked) primitive-internal micro-padding
(`TwoAxisPip` `px-2.5 py-2`, card `padding:16px 18px 13px`, etc.) is reused verbatim and is not
a free choice for new layout code. Max content column width: **1180px** (`margin:0 auto`) —
matches overview/Node Detail.

**Hosts-card grid (Claude's discretion, decided):** `grid-cols-1` below 768px,
`md:grid-cols-2` at ≥768px, gap 16px, inside the 1180px column. Cards are dense
(rollup + meters + trio + dots); never more than 2-up.

---

## Typography

Locked from DS-01 + the Phase-13 contract — not a per-phase choice. Weight set **400/500/600/700**.
All numeric/data/identifier text — host ids, %, GB, %/day rates, days-to-full, blocks-behind,
timestamps, freshness ages, counts — renders in **IBM Plex Mono with `tabular-nums`**; prose in
**IBM Plex Sans**.

| Role | Size | Weight | Line Height | Notes |
|------|------|--------|-------------|-------|
| Display (Host Detail header title) | 23px | 700 | 1.18 | `letter-spacing:-.02em` — host name in the detail header |
| Heading (card / section title) | 15.5px | 600 | 1.3 | `letter-spacing:-.01em` — host-card title, section card titles |
| Body | 14.5px | 400 (600 emphasis spans) | 1.55–1.6 | Incident "why" lines, driver line prose, runbook prose |
| Secondary body | 13–13.5px | 400 | 1.5 | Projection status copy, no-telemetry card body, safety notes |
| Label / meta | 11.5–12px | 500 | 1.4 | Facet chips, freshness text, meter captions, dot tooltips |
| Kicker / eyebrow | 10.5–11.5px | 700 | 1 | UPPERCASE, `letter-spacing:.06–.09em` — `HOSTS`, `VM VITALS`, `INFRASTRUCTURE`, `STORAGE VOLUMES`, `NODES ON THIS HOST` section headers + severity labels |
| Data / numeric | 9–24px | 600–700 | 1 | IBM Plex Mono `tabular-nums` — vitals value 24px/700 on detail; meter value 13px/600 on cards; `+0.4%/day`, `~45 days`, `>1 year`, GB figures, timestamps |

**Rule (locked):** mono carries data + identifiers + timestamps; sans carries prose. Never set a
host id, %, GB, rate, days-to-full figure, count, or timestamp in sans.

---

## Color

60/30/10 split, identical to Phases 12/13. **Two structurally separate axes (DS-01,
non-negotiable):** navy is **structure/action only**; the severity ramp is **state only** and
never appears as chrome.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#EEF1F5` (`df-bg`) | Page background |
| Secondary (30%) | `#FFFFFF` (`df-surface`) + `#FAFBFD` (`df-surface-sub`) | Host cards, section cards, volume rows, compact node rows; `#13284F` (`df-chrome`) for the nav rail |
| Accent (10%) | `#1A3C79` (`df-brand`) / `#13284F` (`df-chrome`) | Structure + navigation only (exhaustive list below) |
| Destructive | n/a this phase | **No destructive action and no write path exist in Phase 14.** |

**Accent (navy) reserved for — exhaustive list:**
- Left nav rail background + active rail item (`NavRailShell`), including the NEW **Hosts** rail entry
- Links + navigation affordances: host-card → Host Detail, node dot → Node Detail, on-host node
  row → Node Detail, infra tile → Service Detail, back-to-hosts, incident banner cross-links
- Runbook actions on the inert `CommandModal` (`Open runbook`, `Copy command`)
- Active facet chip fill (severity/stale filters) + active sort indicator
- Focus rings

Navy is **never** a health signal. Meter fills, card accents, dots, tints are the severity ramp only.

**Severity ramp (state axis — `df-*` tokens):**

| State | Accent (non-text) | Text (AA) | Tint | Border |
|-------|-------------------|-----------|------|--------|
| critical | `#E0392B` | `#E0392B` | `#FCEBEA` | `#F3D3D0` |
| warning | `#C8770A` | `#C8770A` | `#FBF0DD` | `#EFE0C5` |
| watch (teal) | `#0E8C84` | `#0E8C84` | `#E2F2EF` | `#C2E3DD` |
| healthy | `#1E9E63` (dots/fills) | `#1E7A4E` (text) | `#E7F4EC` | `#1E9E63` |
| **stale** | `#C8A23A` (dot) | `#A9912F` (text) | `#F7F0DC` | `#E9DCB6` |

**Threshold coloring law (HOST-01/D-03/D-13):** every `ThresholdMeter` fill takes its severity
from the **read-time band config** (`src/lib/read/telemetry-bands.ts` for CPU/mem/disk;
the new days-to-full bands for storage), mapped through the canonical `severity-map` ramp.
Days-to-full bands (D-13, read-time, re-tunable): **critical < 7d · warning < 30d · watch < 90d ·
healthy beyond.** No component hardcodes a threshold.

**Stale/no-data law (D-06/D-08):** a declared host with no telemetry renders as an explicit
stale/no-data card — gold treatment, hatched meters, `StaleChart` placeholders — never green,
never hidden. Never faked freshness anywhere. `#64748B` (`df-slate`) remains the only color for
threshold lines inside sparkline/evidence contexts (not a state color). `df-faint #9AA3B4` is
decorative only, never text.

**Two-axis color law (infra trio, locked in `TwoAxisPip`):** a service tile is green only when
BOTH `running` AND `functioning` are true; `running && !functioning` renders the unmistakable
red "UP · NOT HEALTHY" state. Precedence lives in `TwoAxisPip.combinedState()` — do not re-derive.

---

## Component Inventory & State Matrix

All compositions build from existing primitives + the ONE new `ThresholdMeter`.

### Screen A — Hosts List (HOST-01) · route `src/app/(overview)/hosts/page.tsx`

#### A1. `HostsShell` (page)
- `NavRailShell` chrome (fixed navy rail + sticky top bar), same as overview/nodes. A **Hosts**
  entry is added to the nav rail (lucide `Server` icon, placed after the Nodes entry —
  discretion, decided). Top bar carries the honest fleet freshness chip (`PollAge`).
- Content column `max-width:1180px`, ordered: page kicker + count (`HOSTS · <n>`) →
  `HostFilters` → `HostCardGrid` → honest empty state.
- **Fleet-shaped from day one (D-06):** enumerates ALL rows from the `hosts` dimension table.
  Hosts without telemetry render as A4 no-telemetry cards. Cards light up as rollout proceeds;
  no UI change at rollout time.

#### A2. `HostFilters` (D-08) — mirrors the Nodes-list facet grammar
- Toggle-chip row: **severity facet** (All · Critical · Warning · Watch · Healthy) + a single
  **"Stale only"** toggle. Active chip = navy fill/white text; inactive = hairline border, muted.
- **URL-param driven** via a `parseHostFacets` following the `parseNodeFacets` pattern
  (`src/lib/overview/node-filter.ts`): whitelist-parsed, invalid values silently widen the view.
- Default sort: **worst-first** (severity rank desc, stale grouped after at-risk, healthy last —
  ties by host id). Pure view filter; honest empty state when none match.

#### A3. `HostCard` — composes `SeverityCard` chrome + `ThresholdMeter` ×3 + `TwoAxisPip` ×3 + node dots
One card per host. Internal order, top to bottom:
1. **Header row:** host name (heading 15.5/600) + worst-of severity chip (`severityLabel`) +
   `FreshnessChip`. Card chrome takes the worst-of severity: left accent bar + tint via
   `severityVariants`/`severityAccent` (worst of infra + nodes + resources, composed on
   `severity-map.worstSeverity` — D-05).
2. **Driver line (D-05):** ONE plain-language line naming the worst contributor —
   `driven by: <contributor phrase>` (e.g. `driven by: bitcoind not functioning`). Sans,
   secondary-body size, severity text color. No per-source chip breakdown. Omitted when healthy.
3. **Resource meters:** three labeled `ThresholdMeter` rows — `CPU`, `MEM`, `DISK` — each:
   mono kicker label + meter + mono `%` value. Severity per meter from the read-time bands.
4. **Infra trio:** three compact `TwoAxisPip` tiles — bitcoind · esplora · postgres — display
   names via `serviceDisplay().label`. Two-axis law holds at card size.
5. **Node-health dots (D-07):** one severity-colored dot per on-host node (via
   `buildOwnershipMap`), 8px dots in a wrap row. Hover → `tooltip` with alias + status text
   (never color alone). Click → that node's `/(overview)/[pubkey]` detail (stops propagation).
6. Whole card body (outside dots) clicks through to Host Detail.
- States: `default/healthy` · `at-risk` (accent + tint + driver line) · `stale/no-telemetry` (A4) ·
  `hover` (shadow `df-hover`, cursor pointer).

#### A4. `HostCard` — no-telemetry variant (D-06)
- Gold stale treatment (`df-stale-*` tint/border), `STALE DATA` / `NO TELEMETRY` chip, hatched
  (stale) meters via `ThresholdMeter stale`, infra trio rendered as honest unknown (never green),
  no dots or dimmed dots if node identities are declared. Body copy per Copywriting Contract.
  Card still clicks through to Host Detail (which shows the same honest emptiness in full).

### Screen B — Host Detail (HOST-02) · route `src/app/(overview)/hosts/[hostId]/page.tsx`

> **Single-scroll, incident-first order (D-10):** header → incident banner (only when one
> exists) → VM vitals → infra services → storage volumes → on-host nodes. "What's wrong" leads;
> evidence follows. Section kickers uppercase mono per the type scale.

#### B1. `HostHeader`
- `NavRailShell` chrome. Header: host name (23px/700) + host id (mono, muted) + worst-of overall
  health pill + honest `FreshnessChip` ("data fresh · <t>" / stale) + back-to-hosts affordance.

#### B2. `HostIncidentBanner` (D-11) — composes `SeverityCard` + `WhyChain` + `CommandModal`
- Renders ONLY when `assembleIncidents` yields a host-keyed `GroupedIncident` for this host;
  **absent entirely when healthy** (no green banner, no placeholder).
- Shows: incident severity chrome, the root-cause driver line, affected children (grouped child
  alerts with their one-line whys), and the **verify-first runbook** via the inert
  `CommandModal` (`Verify first` steps, then copy-to-run commands — never executes).
- **No incident lifecycle here** (no ack/assign/snooze, no Incident Detail link — Phase 15
  activates the deep-link; leave no dead affordance in its place).

#### B3. `HostVitals` (kicker `VM VITALS`) — composes `Sparkline` + `ThresholdMeter` + `StaleChart`
- Three vitals panels — CPU / Memory / Disk — each: mono value (24px/700) + `ThresholdMeter` +
  a trailing `Sparkline` of recent history. Sparkline window: **24h at collector resolution,
  matching the Node Detail VM-vitals treatment** (discretion, decided — confirm against the
  shipped `VmVitals` window during planning).
- Stale host → `StaleChart` "NO FRESH DATA" placeholders + stale meters; never an interpolated
  line, never a projection.

#### B4. `HostInfraServices` (kicker `INFRASTRUCTURE`) — composes `TwoAxisPip` ×3
- Full-size two-axis tiles for bitcoind · esplora · postgres, fed from `deriveServiceHealth()`
  (+ `chain-telemetry` blocks-behind evidence for bitcoind). Green only when both axes true;
  up-but-dead unmistakable. Tile click → the Phase-13 Service Detail route
  `/(overview)/[pubkey]/service/[service]` where a node-scoped service page applies; where no
  node scope applies the tile is informational (no dead link).

#### B5. `StorageVolumes` (kicker `STORAGE VOLUMES`) — composes `ThresholdMeter` + mono data (D-13…D-16)
- **One dense glanceable row per volume (D-16):** mount/volume name (mono) + `ThresholdMeter`
  (used-% fill, severity from used-% bands) + current `%` (mono) + growth rate (mono, e.g.
  `+0.4%/day`) + the **projection line**. No per-volume sparkline/history chart this phase.
- **Projection severity (D-13):** the row's severity is the WORSE of (used-% band, days-to-full
  band): critical < 7d · warning < 30d · watch < 90d · healthy beyond — computed at read time
  via the `telemetry-bands` pattern, never in the component.
- **Projection rendering (D-15) — humanize rule (single tested function, discretion, decided):**
  - `daysToFull ≥ 365` → `>1 year` (healthy, calm — no rate alarm framing)
  - `90 ≤ d < 365` → `~{round(d/30)} months`
  - `28 ≤ d < 90` → `~{round(d)} days` (round to nearest 5, e.g. `~45 days`)
  - `7 ≤ d < 28` → `~{round(d/7)} weeks` (e.g. `~3 weeks`)
  - `d < 7` → `~{round(d)} days` (e.g. `~5 days`)
  - Never a calendar date, never decimal-precision long horizons.
- **Honest no-projection statuses (D-14) — one distinct copy per `StorageProjectionStatus`,**
  rendered in the projection slot (the row is NEVER silently hidden): see Copywriting Contract.
  `stale` status also flips the row to the stale treatment (gold, hatched meter).
- States per row: `healthy` · `watch/warning/critical` (band-driven) · `stale` ·
  `gathering` (insufficient-samples/window) · `not-growing` (flat-or-negative).

#### B6. `OnHostNodes` (kicker `NODES ON THIS HOST`) — composes compact `SeverityRow` (D-12)
- One compact row per on-host node (via `buildOwnershipMap`): **alias (sans) · `ImplTag` type ·
  worst-of severity chip · active channels (mono) · local/remote liquidity ratio (compact bar +
  mono) · 30d forwards (mono) · `FreshnessChip`** — the Phase-13 `SeverityRow` grammar trimmed
  (discretion, decided: drop sortable headers and the full evidence column set; keep the left
  severity accent + tint for at-risk rows).
- Row click → Node Detail `/(overview)/[pubkey]`. Empty state when the host declares no nodes.

---

## Interaction Contract

| Interaction | Contract |
|-------------|----------|
| Hosts facet filter (severity / stale) | URL-param driven (`parseHostFacets`, whitelist-parsed, invalid widens); pure view filter over the loaded host set; honest empty state. Navy chips = structure, never a severity hue. |
| Hosts sort | Default worst-first; view-only, no re-fetch. |
| Host card click | Card body → `/hosts/[hostId]`. Read-only navigation. |
| Node dot hover | Tooltip: alias + status label text (color never alone). |
| Node dot click | Deep-link to `/(overview)/[pubkey]`; stops propagation (does not trigger the card link). |
| Infra tile click (detail) | → Phase-13 Service Detail route where node-scoped; otherwise informational, no dead link. |
| On-host node row click | → Node Detail. Read-only. |
| Incident banner runbook | Opens the inert `CommandModal` — `Verify first` steps then copy-to-run commands. **Never executes; no write path exists this phase.** |
| Incident deep-link | NOT built (Phase 15). No disabled/dead "Open incident" affordance rendered. |
| Freshness | Every card/section/row carries an honest `collected_at`-derived stamp (`deriveStale`); stale renders stale, never faked-fresh. A no-telemetry host is explicit, never hidden (D-06). |
| Cross-links inbound | Overview incident rows + Node Detail host references deep-link to `/hosts/[hostId]` where natural. |
| Projection rows | Never hidden: every volume always shows either a projection or its honest status copy (D-14). |

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Hosts-list section header | `HOSTS · <n>` (mono count, uppercase kicker) |
| Driver line (card + incident) | `driven by: <worst contributor>` — e.g. `driven by: bitcoind not functioning` · `driven by: disk filling — ~5 days to full` · `driven by: 2 nodes critical` (plain language, one line, no chip breakdown) |
| Primary CTA (incident banner) | `Open runbook` (opens the inert verify-first `CommandModal`; secondary: `Copy command`) |
| Verify-first runbook lead | `Verify first` — symptom-confirmation steps precede any command |
| Severity labels | via `severityLabel` (`CRITICAL` / `WARNING` / `WATCH` / `HEALTHY`) — never an icon or color alone |
| Two-axis tile states | `HEALTHY` · `UP · NOT HEALTHY` · `DOWN` — verbatim from `TwoAxisPip.combinedState()` |
| Meter labels | `CPU` · `MEM` · `DISK` (uppercase mono kickers) + mono `%` value |
| Storage rate | `+0.4%/day` style (mono; sign always shown for positive growth) |
| Projection (ok, <365d) | `~45 days to full` / `~3 weeks to full` / `~5 days to full` (humanize rule in B5) |
| Projection (ok, ≥365d) | `>1 year to full` (calm, healthy) |
| Projection status — stale | `projection unavailable — data stale (<t> old)` (e.g. `…data stale (2h old)`) |
| Projection status — insufficient-samples / insufficient-window | `gathering data — projection in ~<N>h` |
| Projection status — flat-or-negative | `not growing` |
| No-telemetry host card | Heading: `No telemetry yet.` · Body: `Declared in the fleet — this host reports once its collector onboards. Shown honestly, never assumed healthy.` · Chip: `NO TELEMETRY` |
| Stale chip / placeholder | Chip: `STALE DATA` · Chart placeholder: `NO FRESH DATA` + `last good <t> ago` |
| Empty state — Hosts list (filtered) | Heading: `No matching hosts.` · Body: `Clear the filter to see all declared hosts.` |
| Empty state — on-host nodes | Heading: `No nodes on this host.` · Body: `This host runs infrastructure only.` |
| Empty state — storage volumes | `No storage volumes reported for this host.` |
| Error state (read unreachable) | `Couldn't load host telemetry.` + `The read model is unreachable — this is a data-source problem, not a host failure. Retry, or check the warehouse connection.` |
| Destructive confirmation | **None — no destructive action and no write path exist in Phase 14.** The runbook modal is inert copy-to-run only. |

**Voice (DESIGN-BRIEF-02 quality bar — Linear/Vercel/Stripe):** calm, confident, plain operator
language; lead with what needs attention and why; never alarmist, never faked reassurance.
A host card reads as a mini-incident summary, not a metrics dump. Numbers in mono; prose in sans.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | existing vendored primitives only (`card`/`tooltip`/`badge`/`button`/`table`/`dialog` already in `src/components/ui/`); no new adds expected | not required |
| third-party | none (`components.json` → `"registries": {}`) | not applicable — verified 2026-07-13 |

No third-party registry is declared. If planning later requires one, the vetting gate
(`npx shadcn view … --registry …` + pattern scan) MUST run before it enters the contract.
The only new component is the bespoke `ThresholdMeter` df primitive (hand-written, no registry,
no dependency). **Zero new dependency installs expected.**

---

## Accessibility & Honesty Invariants (locked, must hold)

- AA text contrast: `-text` severity roles for text, bright roles for fills/dots only;
  `df-faint` decorative only.
- Severity never by color alone: meters pair with mono % values + severity labels; dots pair
  with tooltips; tiles carry explicit `yes`/`no` axis boxes + state labels.
- **Honest stale/no-data everywhere (D-06/D-08/D-14):** a silent declared host reads no-data,
  never green, never hidden; a stale volume shows no projection; the operator always knows WHY
  a number is missing. Staleness derived at read time (`deriveStale`), never stored, never faked.
- **Thresholds live in read-time config only (D-13, P11 D-14):** no component hardcodes a band;
  `ThresholdMeter` receives severity, never computes it.
- **Zero write path (project core value, re-affirmed):** Phase 14 renders and links; it mutates
  nothing. The runbook modal is inert. No AI surface on these screens emits anything runnable.
- Engine/read order preserved: no `.sort` re-ranking of incident children; worst-first host sort
  is the only ordering this phase introduces, applied view-side.

---

## Open Assumptions (Claude's-discretion defaults — flag to operator at spec review)

All within D-01…D-16; none require a new token/primitive beyond D-03:

1. **Card grid**: 1-col <768px / 2-col ≥768px, gap 16px, in the 1180px column (density argues
   against 3-up).
2. **Compact node-row columns (D-12 trim)**: alias · type tag · severity · channels ·
   liquidity ratio · 30d forwards · freshness; no sortable headers.
3. **Vitals sparkline window**: 24h, matching Node Detail `VmVitals`; confirm the exact shipped
   window during planning and mirror it.
4. **Humanize bands** for projection copy as specified in B5 (reproduces the D-15 examples).
5. **Nav rail**: `Hosts` entry with lucide `Server` icon, after `Nodes`.
6. **Volume-row severity** = worse of used-% band and days-to-full band (keeps a 96%-full but
   flat volume visibly at-risk).

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending (blocking operator sign-off required before `/gsd-plan-phase 14` — D-04)
