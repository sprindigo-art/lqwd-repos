---
phase: 12
slug: ops-center-overview
status: approved
reviewed_at: 2026-06-30
shadcn_initialized: true
preset: radix-nova
created: 2026-06-30
---

# Phase 12 — UI Design Contract · Ops Center Overview

> Visual and interaction contract for the full-stack home screen: a root-cause-grouped
> attention queue (OVW-01), an advisory AI "what needs you now" band (OVW-02), a strictly
> proportional fleet-vitals rollup (OVW-03), honest all-clear/stale states (OVW-04), and
> layer + severity filters with honest empty states (OVW-05).
>
> **The design system is LOCKED.** This phase composes the Phase-10 "Data-Forward v2"
> tokens + primitives against the locked overview prototype. It does **not** invent a new
> visual language and does **not** add new tokens or primitives. Where a value below looks
> specific, it is read off `src/lib/df/tokens.ts`, `src/app/globals.css` (the `--*-df-*`
> block), or `.planning/phases/10-design-system-foundation/.prototype-snapshot/Ops Center - Data-Forward v2.dc.html`.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn (already initialized — `components.json` present) |
| Preset | `radix-nova` (style), `baseColor: neutral`, `cssVariables: true` |
| Component library | radix (shadcn/ui on React 19) + bespoke `src/components/df/*` primitives |
| Icon library | lucide-react (`iconLibrary: lucide`) — D-06 permits state/layer/action icons |
| Font | IBM Plex Sans (`--font-df-sans`, body/headings) + IBM Plex Mono (`--font-df-mono`, all data/labels) |

**Source of truth (read before implementing):**
- Tokens: `src/lib/df/tokens.ts` (TS mirror) + `src/app/globals.css` `--color-df-* / --radius-df-* / --shadow-df-*`
- Severity ramp API: `src/components/df/Severity.ts` (`severityVariants`, `severityAccent`, `severityIcon`, `severityLabel`)
- Prototype: `.planning/phases/10-design-system-foundation/.prototype-snapshot/Ops Center - Data-Forward v2.dc.html`

**Reused primitives (do NOT rebuild — compose these):**
`NavRailShell` · `SeverityHeroCard` · `SeverityCard` · `SeverityRow` · `EvidenceChart` ·
`StaleChart` · `TwoAxisPip` · `FreshnessChip` · `AiReadPanel` · `CommandModal` · `WhyChain` ·
`BlastRadius` · `ImplTag` (all in `src/components/df/`).

---

## Spacing Scale

The locked Data-Forward v2 system is a **4px-based layout grid** with a 2px-refined micro
scale inside primitives (prototype-locked). Layout-level spacing for new Phase-12
composition MUST use the grid below.

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, inline chip padding-y |
| sm | 8px | Compact element spacing, queue-item internal gaps |
| md | 12px | Default gap between attention-queue rows + vitals cards (`gap:12px`) |
| md+ | 16px | Card inner padding-y (`16–18px`), filter-row spacing |
| lg | 24px | Hero card inner padding, page horizontal padding (`24–32px`) |
| xl | 32px | Page gutter (`padding:24px 32px`), top-bar horizontal padding |
| 2xl | 48px | Major vertical section breaks |
| 3xl | 64px | Page bottom padding (`padding-bottom:64px`) |

**Exceptions (locked, inherited — not introduced by this phase):** the prototype uses a
2px-refined micro scale for *component-internal* rhythm (e.g. `11px`, `13px`, `18px`, `22px`,
`26px` paddings; `6/9/10/11px` chip gaps). These are part of the locked Data-Forward v2
primitives and are reused verbatim — they are NOT free choices for new layout code.
Max content column width: **1180px** (`max-width:1180px;margin:0 auto`).

---

## Typography

Locked from the Data-Forward v2 prototype + `--font-df-*`. Weights in use are the locked
set **400 / 500 / 600 / 700** (4 weights — inherited from DS-01, not a per-phase choice).
All numeric/data/identifier text renders in **IBM Plex Mono with `tabular-nums`**
(`.v2-num` / `.v2-mono`); body and headings render in **IBM Plex Sans**.

| Role | Size | Weight | Line Height | Notes |
|------|------|--------|-------------|-------|
| Display (hero title) | 23px | 700 | 1.18 | `letter-spacing:-.02em` — hero incident + all-clear `<h2>` |
| Heading (card title) | 15.5px | 600 | 1.3 | `letter-spacing:-.01em` — attention-queue row title, top-bar app title (700) |
| Body | 14.5px | 400 (600 emphasis spans) | 1.55–1.6 | AI band lines, hero description; max measure ~62–92ch |
| Secondary body | 13–13.5px | 400 | 1.5 | incident "why" line, child-alert notes, safety footer |
| Label / meta | 11.5–12px | 500 | 1.4 | layer chips, freshness text, filter chips |
| Kicker / eyebrow | 10.5–11.5px | 700 | 1 | UPPERCASE, `letter-spacing:.06–.09em` — section headers ("ATTENTION QUEUE"), severity labels |
| Data / numeric | 11–24px | 600–700 | 1 | IBM Plex Mono, `tabular-nums` — vitals value (24px/700), evidence value (13–16px), timestamps (mono, muted) |

**Rule (locked, from sketch-findings + DS-01):** mono carries data + identifiers + timestamps;
sans carries prose. Never set a node pubkey, count, %, or timestamp in sans.

---

## Color

60/30/10 split. **Two structurally separate axes (DS-01, non-negotiable):** navy is
**structure/action only**; the severity ramp is **state only** and appears nowhere as chrome.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#EEF1F5` (`df-bg`) | Page background |
| Secondary (30%) | `#FFFFFF` (`df-surface`) + `#FAFBFD` (`df-surface-sub`) | Cards, evidence panels, vitals cards; `#13284F` (`df-chrome`) for the nav rail + AI band shell |
| Accent (10%) | `#1A3C79` (`df-brand`) / `#13284F` (`df-chrome`) | Structure + actions only (list below) |
| Destructive | n/a this phase | No destructive/mutating action exists on the overview |

**Accent (navy) reserved for — exhaustive list:**
- Left nav rail background + active rail item
- Primary action buttons ("Export fix", "Open runbook", "Copy command")
- Links + expand/collapse toggles ("Show why · detection chain")
- The "AI grouping / AI read" inline callout chrome (`#EEF2FA` wash, navy mark)
- The AI band shell background (`#13284F`)
- Focus rings + active filter chip
- The zero-credential safety footer chrome (`#EAEEF6` / navy shield)

Navy is **never** used to signal health/severity. (Sketch-findings: "navy does structure;
severity color does state and appears nowhere else.")

**Severity ramp (state axis — `df-*` tokens, separate from navy):**

| State | Accent (non-text) | Text (AA) | Tint | Border |
|-------|-------------------|-----------|------|--------|
| critical | `#E0392B` | `#E0392B` | `#FCEBEA` | `#F3D3D0` |
| warning | `#C8770A` | `#C8770A` | `#FBF0DD` | `#EFE0C5` |
| watch (teal) | `#0E8C84` | `#0E8C84` | `#E2F2EF` | `#C2E3DD` |
| healthy | `#1E9E63` (dots/bars) | `#1E7A4E` (text) | `#E7F4EC` | `#1E9E63` |
| **stale** | `#C8A23A` (dot) | `#A9912F` (text) | `#F7F0DC` | `#E9DCB6` |

**Stale is its own state (D-08), never rendered as critical and never faked-fresh.** It is
shape-distinct: gold tint + clock/`CircleDashed` glyph + the `StaleChart` hatched "NO FRESH
DATA" placeholder — never a green dot, never an interpolated line.

Neutral chart gray `#64748B` (`df-slate`) is the only color for threshold lines + peer-median
bands inside evidence charts (not a state color).

---

## Component Inventory & State Matrix

All compositions below are built from existing `df/*` primitives. No new primitive is
introduced; if a need appears to require one, escalate rather than invent.

### 1. `OverviewShell` (page) — OVW-01..05 host
- Wraps `NavRailShell` (fixed 60px navy rail + sticky translucent top bar).
- Top bar carries: app title, the **fleet-wide proportional health ramp** (230px bar, the
  same `df-*` segment colors), the fleet tally (`<n> crit · <n> warn · …` in mono), and a
  live freshness chip ("Live · polled `4s` ago" — `FreshnessChip`, honest, never faked).
- Content column: `max-width:1180px`, ordered: AI band → top-priority hero → attention queue
  + filters → fleet vitals → healthy collapse → safety footer.

### 2. `AiBand` (OVW-02) — composes `AiReadPanel`
- Navy `#13284F` shell, rounded `16px`, white text. Header: spark glyph + "WHAT NEEDS YOU
  NOW" kicker + the verbatim advisory pill **"AI · explains & ranks, never runs commands"**.
- Renders **1–4 lines**, each with a per-line severity tag (mono rank badge tinted by that
  line's severity) + bold head + body. Lines + order come from `insight/rank` + cross-layer
  severity (D-04); the LLM (off by default, env-gated) only rephrases the same lines (D-05).
- **Always present** (D-05). Dismiss (×) is **session-scoped** (hides until reload; re-derives
  from live state each load — a real problem cannot stay hidden).
- States: `lines` (1–4 advisory) · `calm` (all-clear: green check + "Nothing needs you right
  now…") · `dismissed` (hidden this session).
- **Invariant (D-04 + guardrails):** the band MUST NOT render or emit any runnable command or
  signed param — `src/lib/insight/guardrails.ts` enforces advisory-only. Verified in Phase 16.

### 3. `TopPriorityHero` (OVW-01) — composes `SeverityHeroCard` + `EvidenceChart`/`StaleChart` + `WhyChain` + `BlastRadius`
- Shown only when a worst-severity root-cause incident exists. `cardLg` radius (18px), 7px
  severity accent bar, severity-tinted border + shadow.
- Header: pulsing `CRITICAL` badge (`v2pulse`), a `ROOT CAUSE · N nodes roll up` chip, an
  honest freshness dot, the 23px title, a plain-language "why", and `layer · entity` + `flagged
  HH:MM · Nm ago` mono chips.
- Inline evidence panel (`EvidenceChart`, or `StaleChart` when the signal is stale).
- Expand reveals `WhyChain` (detection timeline) + the `BlastRadius` diagram (host → its
  affected nodes) + the grouped child alerts (D-01 children that drop out of the top queue).
- Footer: navy "Show why / Hide" toggle + a navy primary action ("Export fix" / "Open runbook"
  → opens `CommandModal`).

### 4. `AttentionQueue` (OVW-01) — composes `SeverityCard`/`SeverityRow` + `EvidenceChart`/`StaleChart`
- Vertically stacked incident cards (`gap:12px`), each: severity accent bar + layer icon wash +
  severity label badge + 15.5px title + one-line "why" + `layer` chip + freshness chip + an
  inline evidence panel + an expand toggle.
- **Root-cause grouped (D-01/D-02):** a parent incident shows a "N children roll up" chip;
  children nest inside the expand and are absent from the top level. Incident severity = worst
  child (D-02), on the canonical ramp (D-06).
- **Stale incident:** carries the gold `STALE DATA` chip + `StaleChart` instead of a live chart;
  expand shows a "Freshness ·" note. Never recolored to critical (D-08).
- Per-row states: `collapsed` (default; hover reveals a low-opacity action button) ·
  `expanded` (`WhyChain` + AI-read callout + action button) · `stale`.

### 5. `QueueFilters` (OVW-05)
- A row of toggle chips: **layer** (All · Hosts · Services · bitcoind · Nodes · Storage) and
  **severity** (Critical · Warning · Watch). Active chip = navy fill/white; inactive = hairline
  border, muted. Filtering is a pure view concern over the same grouped incident set (D-09).
- Honest empty state when a filter matches nothing (see Copywriting).

### 6. `FleetVitals` (OVW-03)
- 5 cards (`grid-template-columns:repeat(5,1fr)`), one per layer (Nodes / Hosts / Services /
  bitcoind / Storage): a worst-of state dot, the layer label, a big mono count (24px/700), a
  unit, and a one-line note.
- A **strictly count-proportional health bar** per layer: each segment width = (entity count in
  that state) / (total entities in that layer) — literal proportionality, **no severity
  weighting** (D-07). Denominator = all entities in that layer. Per-layer state counts shown
  alongside. Stale entities get their own gold segment (not folded into healthy).

### 7. `HealthyCollapse`
- Collapsed-by-default row: green dot + "`<n>` nodes healthy · all reporting fresh · no action
  needed". Expands to a 6-col grid of mono node names with green dots. Keeps the queue focused
  on what needs attention (attention-queue grammar).

### 8. `AllClearHero` (OVW-04) — composes `SeverityHeroCard` (healthy variant)
- Shown when nothing is wrong: green accent bar + check medallion + `ALL CLEAR` badge + "Nothing
  needs you right now" + a fresh-data line ("26/26 nodes healthy · all 8 hosts up · 34/34
  services running · bitcoind at tip") + last-incident + trailing-30d uptime stats.

### 9. `SafetyFooter`
- Navy-washed strip + shield glyph + the verbatim zero-credential posture line (see Copywriting).
  Reinforces the read-only/advisory invariant on every load.

### 10. `CommandModal` (reused) — export / runbook
- Opened from a hero/queue action. Inert: shows runbook steps and/or a copy-to-run `lncli`/`lncmd`
  command in a navy code block + a Copy button. **Never executes** — the operator runs it.

---

## Interaction Contract

| Interaction | Contract |
|-------------|----------|
| Dismiss AI band | Session-scoped; hides until reload; re-derives from live state each load (D-05). No persistence. |
| Expand incident / hero | In-place reveal (`v2drop` animation); shows `WhyChain` + AI-read callout + grouped children + action. No navigation. |
| Layer / severity filter | Pure view filter over the grouped incident set; combinable; honest empty state when none match (D-09). |
| Row → entity | Incident titles/rows LINK into Phase-13/14 detail screens (those screens are NOT built here; links may be present but resolve in later phases). |
| Action ("Export fix" / "Open runbook") | Opens the inert `CommandModal` (copy-to-run). **No in-app mutation, no command emission** anywhere on this screen. |
| Healthy collapse | Toggle expand/collapse of the all-healthy node grid. |
| Freshness | Every card + the top bar shows an honest `collected_at`-derived stamp (Phase-11 `deriveStale`); stale renders as `stale`, never faked-fresh (D-08). |

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Section header (queue) | `ATTENTION QUEUE · <n> more` (mono count, uppercase kicker) |
| Primary CTA (incident) | `Export fix` (when a command export exists) / `Open runbook` (when a runbook exists) — verb + noun, opens inert modal |
| AI band header | `WHAT NEEDS YOU NOW` |
| AI band advisory tag | `AI · explains & ranks, never runs commands` |
| AI band calm line | `Nothing needs you right now.` + `All <n> nodes are healthy and reporting fresh — the last incident resolved <t> ago.` |
| All-clear heading | `Nothing needs you right now` |
| All-clear body | `<n> / <n> nodes healthy · all <n> hosts up · <n>/<n> services running · bitcoind at tip fleet-wide.` |
| Empty queue (all clear) | Heading: `You're all caught up` · Body: `NodeMonitor is watching — new incidents surface here the moment they're detected.` |
| Empty state (filtered) | `No <layer>/<severity> incidents right now.` + `Clear the filter to see the full attention queue.` (honest — distinguish "nothing matches this filter" from "fleet is healthy") |
| Stale chip / placeholder | Chip: `STALE DATA` · Chart placeholder: `NO FRESH DATA` + `last good <t> ago` (never a faked value) |
| Stale incident note | `Freshness · this signal hasn't reported since <t>; shown as last-known, not current.` |
| Root-cause chip | `ROOT CAUSE · <n> nodes roll up` |
| Blast-radius hint | `one host outage → <n> nodes on it` + `Restart bitcoind on host-03 and all <n> nodes clear automatically — they share its backend, so don't act on them individually.` |
| Safety footer | `Zero node credentials stored.` + `NodeMonitor reads and ranks; it never changes the fleet. High-risk fixes export as commands you run — the AI explains, it never executes.` |
| Destructive confirmation | **None.** No destructive/mutating action exists on the overview (read-only + advisory). Export/runbook actions are inert copy-to-run modals, not in-app writes — no confirmation gate required. |

**Voice (from DESIGN-BRIEF-02 quality bar — Linear/Vercel/Stripe):** calm, confident, plain
operator language; lead with what needs attention and what to do; never alarmist, never faked
reassurance. Numbers in mono; prose in sans.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | existing vendored primitives only (Sheet/Button/Tabs/Checkbox already in `src/components/ui/`); no new adds expected | not required |
| third-party | none (`components.json` → `"registries": {}`) | not applicable |

No third-party registry is declared for this phase. If planning later requires one, the
vetting gate (`npx shadcn view … --registry …` + pattern scan) MUST run before it enters the
contract. This phase composes existing `df/*` + already-vendored shadcn primitives; **zero new
dependency installs expected.**

---

## Accessibility & Honesty Invariants (locked, must hold)

- AA text contrast: use the `-text` severity roles for text (e.g. `df-ok-text #1E7A4E`), the
  bright `-` roles for dots/bars only. `df-faint #9AA3B4` is **decorative only** — never text.
- Severity is never conveyed by color alone: every state pairs color with a lucide glyph
  (`severityIcon`) and/or an uppercase mono label (`severityLabel`).
- Honest stale/no-data everywhere (D-08): `stale` is a first-class state; no-data reads honestly
  (e.g. not-expected services, missing telemetry) and is never green-by-default.
- Advisory-only (D-04, project core value): nothing on this screen emits or executes a command;
  the AI band and all actions are advisory/copy-to-run. Re-affirmed in Phase 16 (HARDEN-03).

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
