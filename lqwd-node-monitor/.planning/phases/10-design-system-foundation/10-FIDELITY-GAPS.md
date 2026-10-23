# 10 — Visual Fidelity Gap Analysis

Per-primitive comparison of the locked prototype snapshots (`Ops Center - Data-Forward v2.dc.html`, `Node Detail.dc.html`, `support.js`) against the built `src/components/df/*` primitives. The operator's read — "similar but missing substantial detail" — is correct: the built set captures the *severity grammar and tokens* faithfully but collapses most of the prototype's **multi-part internal composition** (sparklines, delta chips, secondary-metric rows, evidence panels, blast-radius diagram, why-chain timeline, projection/marker/axis chart layers) down to single-line presentational shells.

Method: each prototype element was located in the HTML/JS, its full composition enumerated (sub-elements, spacing, typography, iconography, mini-charts, deltas, annotations), then graded against the matching built component.

---

### EvidenceChart — MAJOR

The prototype `chart()` grammar (`support.js`/Ops Center lines 472–517, Node Detail 429–448) is a hand-rolled SVG with **nine distinct layers**. The built `EvidenceChart` reproduces ~5 and drops or weakens the rest.

- **Prototype has (chart() element-by-element):**
  - **Peer-median band**: `rect` fill `#64748B1c` PLUS an inline `text` label (`fontSize:8`, slate) drawn at `x:P.l+3, y:yl-3` — the band carries a visible "peer median" caption inside the plot.
  - **Threshold line**: dashed `3 3` slate line from `P.l` to `W-P.r`, PLUS a right-anchored `text` label above it (`y:ty-3`, `textAnchor:'end'`).
  - **Area fill**: closed path to baseline; baseline is **conditional** — `(s.area==='above'&&s.threshold)?Y(threshold):Y(yMin)`. The Ops Center hero/rtr07 use `area:'above'` and `area:'under'` as *distinct* fills; storage/fee use under. So area is a 3-way (`'above'` / `'under'` / none), not a boolean.
  - **Projection**: dashed `3 3` accent polyline at `opacity:.65` continuing from the last real point (storage incident: `projection:[95.5,97,98.5,100]`).
  - **Main line**: 2px accent polyline, round caps/joins.
  - **Marker**: a vertical dashed `2 2` slate line at `X(atIndex)` from `P.t+2` to `H-P.b`, PLUS a centered `text` label above the plot (`y:P.t-2`) — e.g. `'lost'` at index 6 (rtr07), `'now'` markers on storage/fc/liq.
  - **Last dot**: `r:3` accent circle at the final point.
  - **Axis labels**: 1–3 `text` ticks along the bottom (`fontSize:8`, `#9AA3B4`) with start/middle/end anchoring — literal strings like `'-30m'`, `'-15m'`, `'now'`, `'14d'`, `'+6d'`, `'-7d'`.
  - **Header (panel chrome around the chart)**: every evidence panel pairs the chart with a label row — `evLabel` (e.g. "Minutes behind chain tip · last 30 min") on the left and a bold colored `evValue` (e.g. `+22m`, `DOWN`, `3.1×`) on the right; the hero panel also has an `evNote` caption line below (`fontSize:10.5px`, "Climbing since 14:08…").
  - **Node Detail variant** additionally has a **shade window** (`s.shade`): a `#C8770A12` rect spanning `X(from)..X(to)` with a centered orange label (the fee-drift window). And the Node Detail chart uses `width:'100%' + preserveAspectRatio:'none'`.
- **Built has:**
  - Recharts `ComposedChart` with: `ReferenceArea` band (no in-plot text label), `ReferenceLine` threshold with right label, `Area` (boolean only, always to baseline), 2px `Line`, projection model (derived but **not rendered** — see below), and an `activeDot` for the last point.
  - `axisLabels` are typed as `{kind:'sats'|'btc', value}` routed through `units.ts` — i.e. **numeric BTC/sat ticks only**.
- **Missing / simplified:**
  - **Projection is computed but never drawn.** `deriveChartModel` builds `model.projection`, but the JSX returns no `<Line>`/series for it. The dashed forecast continuation (a core "act before it fills" signal on the storage card) is absent on screen.
  - **No marker layer at all.** The vertical dashed marker + its label (`'lost'`, `'now'`) — the single most legible "this is the moment it broke" cue — is not implemented.
  - **No band text label.** The prototype prints "peer median" inside the band; built band is a silent shaded rect.
  - **Area is a boolean, not 3-way.** `area:'above'` (fill only the exceedance above the threshold) cannot be expressed — every area fills to baseline. The hero's "area above threshold" semantics are lost.
  - **No `evLabel` / `evValue` / `evNote` panel chrome.** The component renders only the plot; the surrounding evidence-panel header (label + bold colored value + note) — present on **every** prototype chart — lives nowhere in the primitive. The gallery wraps it in a bare bordered box with no header.
  - **Axis labels are sat/BTC-only.** The prototype's axis strings are *time* labels (`-30m`, `+6d`, `-7d`, `now`). The built `AxisLabel` type cannot represent them; it only formats quantities. So the actual prototype axis text is unrepresentable.
  - **No shade window** (Node Detail fee-drift shaded region + label).
  - **Fixed heights restricted to `104 | 58`.** Prototype charts are `362×104` (hero), `188×58` (inline), `204×62` / `1120×150` (Node Detail) — the width and the Node-Detail tall charts/`preserveAspectRatio:'none'` full-bleed behavior aren't parameterized.

---

### SeverityCard — MAJOR

The prototype has **no single "SeverityCard"** — it has a hero card and a queue-incident card, both far richer than the built shell. The built `SeverityCard` is a one-line `icon + kicker + title + optional body` strip.

- **Prototype incident card has (Ops Center 280–357):**
  - 6px left accent bar + tinted border + per-severity shadow (`critical → 0 6px 22px rgba(224,57,43,.10)`).
  - A **38×38 rounded icon tile** with `inc.wash` background and a stroked SVG glyph (`inc.iconD`) — a real leading icon block, not an inline 16px lucide.
  - Header row: mono **sev label chip** (white text on accent, `padding:3px 8px`) + a 15.5px semibold **title** + optional **STALE DATA pill** (gold, dashed, clock icon).
  - A **why** paragraph (`13.5px`, `max-width:64ch`).
  - A **meta row**: a layer chip (`inc.layer` on `#F1F4F8`), a freshness dot+label, and an expand toggle (`chevron + "Why-chain…"`).
  - A **212px inline evidence panel** on the right: `evLabel` + bold colored `evValue` + the chart.
  - An **expandable drawer** (`v2drop` animation): a 2-col grid with a **detection-chain timeline** (dot/line spine, mono timestamps, event text) and an **AI-read callout** (navy sparkle icon, "AI read · …"), plus a stale callout when stale, plus an export button.
  - A **collapsed hover-export** affordance (opacity .45 → 1 on hover).
- **Prototype hero card additionally has (127–228):** "Top priority" eyebrow + rule, a CRITICAL pulsing-dot chip (`v2pulse`), a "ROOT CAUSE · 3 nodes roll up" chip, a 23px headline, a 392px evidence panel, the **blast-radius SVG diagram**, a "Restart bitcoind…and all 3 clear" callout, footer toggle + primary action, and an expand grid with why-chain + 3 grouped-node rows.
- **Built has:** a flex card — 6px accent bar, tint bg/border (via `severityVariants`), one 16px lucide icon, an 11px mono kicker, a truncated title, and an optional `text-[13px]` children slot. Rest/hover shadow. That's the entire composition.
- **Missing / simplified:**
  - No icon **tile** (38×38 washed block) — just a bare inline glyph.
  - No sev-label **chip** (white-on-accent pill); the kicker is plain tinted mono text.
  - No **evidence panel** slot (label + value + chart) — the card cannot host the right-hand chart the prototype always pairs with it.
  - No **meta row** (layer chip, freshness dot, expand toggle).
  - No **expand drawer** (timeline / AI-read / children / export) — none of the expandable why-chain exists.
  - No **STALE pill**, no **per-severity shadow** (built uses one flat `shadow-df-rest`/`hover`), no **hover-reveal export**.
  - Title is `truncate`d single-line; prototype titles wrap to a 23px headline (hero) / 15.5px (queue).
  - **Net:** the built card is roughly the *header strip* of the prototype card with everything below the title removed.

---

### SeverityRow — MODERATE

- **Prototype "row" is the queue card** (above) — there is no thin tabular row in Ops Center. The closest thin rows are the **grouped-children rows** (213–223) and **healthy-node chips** (398–404). The built `SeverityRow` is a generic thin row that doesn't match either precisely.
- **Prototype grouped-child row has:** a small square accent dot (`8×8 radius 2px`), mono node id, a `kind` chip (`#F1F4F8`), a `note` string, and a right-aligned mono `detail` (`last good 22m ago`) in faint.
- **Built has:** leading round severity dot (`size-2 rounded-full`), a tinted mono sev label + icon, an identity slot, a right-aligned `affordance` ("open →"), and an optional mono evidence line below. Bottom border per row.
- **Missing / simplified:**
  - Dot is **round**; the prototype child-row dot is a **2px square** (and the queue/healthy dots vary). Shape detail dropped.
  - No **kind chip** / **note** / **detail** three-part columnar layout — the prototype row is a multi-column record (id · kind · note · detail), the built row is label + identity + one evidence line.
  - The built row injects a **sev label + icon** that the prototype child rows do **not** carry (they rely on the square dot only) — so it's not visually the same row.
  - `affordance "open →"` has no prototype analog on these rows (the prototype uses hover-export or whole-card click), so it's an invented element.

---

### TwoAxisPip — MODERATE

Maps the Node Detail service tile's *inner* two-axis block (154–187, logic 556–574) but drops the surrounding tile composition and several micro-details.

- **Prototype service tile has:**
  - A full **tile**: `border-left:4px solid accent`, tint bg (`#FCF1F0` when unhealthy), per-state shadow, `rounded-13px`, clickable `<a>` to Service Detail.
  - Header: service **name** (ellipsis) + a right-aligned **status chip** (`HEALTHY` / `UP · NOT HEALTHY` / `DOWN`) whose dot **pulses** (`nmpulse`) when in alarm.
  - **Two boxed sub-panels** ("Running" / "Functioning"), each a bordered inset (`#FAFBFD` or red tint when failing) with an uppercase 9px caption, a check/cross glyph, and `yes/no` text.
  - A **3-row footer** divided by a top border: `last heartbeat`, `last run` (e.g. "failed 41m ago"), `errors · 1h` — each a label/value pair with conditional value colors.
- **Built has:** the status chip (with pulsing dot? — **no**, static dot), two inline `Axis` glyphs (label + check/cross + yes/no, **not boxed**), and a footer with only `heartbeat` + `errors` (no "last run").
- **Missing / simplified:**
  - The two axes are **inline spans**, not the prototype's **boxed sub-panels** with their own captions, borders, and red-tint-on-failure background.
  - **No pulsing alarm dot** on the status chip (`nmpulse` animation dropped) — the urgent "up but dead" state loses its motion cue.
  - **No "last run" row** (e.g. "failed 41m ago" with red color) — only heartbeat + errors survive.
  - **No tile chrome**: no `border-left` accent, no per-state tint/shadow, no name header, no link — the pip is the inner block only, so a consumer must rebuild the entire tile.
  - Heartbeat "stale" coloring (gold `#A9912F` when `hb` contains "stale") isn't handled — built `heartbeat` is a plain string with no stale-aware color.

---

### FreshnessChip — MINOR

- **Prototype freshness cues are inline** (dot + "data fresh · 4s" / "stale 4h"), and the **STALE DATA pill** (Ops Center 292) is a small gold dashed pill with a clock icon + literal "STALE DATA".
- **Built has:** three honest branches — `no data yet`, fresh (round green dot + "data fresh · as of {stamp}"), stale (square gold dot + dashed border + clock + "STALE — data as of {stamp}"). This is a faithful, even **more rigorous**, honest-stale treatment.
- **Missing / simplified:**
  - Prototype freshness label is a **relative age** ("4s", "stale 4h"); built renders an **absolute UTC timestamp** ("as of 2026-06-24 13:42"). Different information shape — the prototype's glanceable "4s ago" recency is replaced by a wall-clock stamp.
  - Minor copy divergence ("STALE DATA" pill vs "STALE — data as of …"). Acceptable, but not byte-identical to the prototype pill.

---

### ImplTag — OK

- **Prototype** paints "Routing · LND" as a navy-on-`#EAEFF8` pill (Node Detail 88) — note the prototype label is the **full** `"Routing · LND"`, not just `LND`.
- **Built has:** `LND` on `#EAEFF8`/`#33559B`, `LDK` on `#F1EAF8`/`#7A4FA3` (the LDK hex is `[ASSUMED A2]`).
- **Missing / simplified:** built shows only `LND`/`LDK`, not the prototype's `"Routing · LND"` / `"LSP · LDK"` two-part label. Minor — the role word ("Routing"/"LSP") is dropped. Tokens and treatment are otherwise correct.

---

### AiReadPanel — MODERATE

- **Prototype "What needs you now" band has (94–124):**
  - Navy `#13284F` card, `rounded-16px`, big shadow.
  - Header: a 25×25 `#ffffff22` rounded tile with a **sparkle SVG**, an uppercase title, a **safety pill** ("AI · explains & ranks, never runs commands"), and a **dismiss ✕** button (`onDismissAi`).
  - Each advisory line: a **numbered tag** (`1`/`2`/`3`) in a colored `20×20` rounded square (`line.tagBg`/`line.tagColor`), then text where a **bold white head** (`line.head`, e.g. "host-03 bitcoind stalled…") is followed by a muted-blue **body** (`#CBD6EC`).
  - An **all-clear variant** (`aiCalm`): a green check tile + "Nothing needs you right now." sentence.
- **Built has:** navy band, sparkle tile, title, safety pill, a frozen footnote ("NodeMonitor runs nothing for you."), and lines rendered as a **severity dot + single inert paragraph**. Strong on the security framing (inert text, verbatim labels).
- **Missing / simplified:**
  - Lines use a **leading severity dot**, not the prototype's **numbered priority tag** (`1`/`2`/`3` colored square). The ranked-priority ordinal is gone.
  - No **head/body split** — the prototype bolds the lead clause in white and continues in muted blue; built renders one uniform `text-white/85` string.
  - **No dismiss ✕** affordance.
  - **No all-clear ("calm") variant** — the green-check "Nothing needs you right now" state isn't a mode of this component.
  - The frozen footnote ("NodeMonitor runs nothing for you.") is a built **addition** not in this prototype band (it's the modal's note copy) — extra, not a gap, but a divergence.

---

### NavRailShell — MODERATE

- **Prototype rail + top bar has (Ops Center 39–88):**
  - 60px navy rail, 32×32 white logo tile with a navy bordered square, **4 nav items** with the active one washed (`#ffffff1f`), a bottom-pinned `margin-top:auto` **32×32 avatar circle** (`#2C4A7E`).
  - Top bar: title + subtitle **plus** a **fleet ramp** (230px segmented severity bar via `sc-for ramp`), a **tally** ("4 crit · 1 warn · 2 watch · 19 ok"), a **Preview view-tab toggle** (Mid-incident / All clear), and a **"Live · polled 4s ago"** status pill with a green ring dot.
- **Built has:** 60px navy rail with logo tile, 4 lucide nav items (active washed), a sticky blurred top bar with title/subtitle and a generic `topBarEnd` slot. Active key is a prop (keeps it a Server Component).
- **Missing / simplified:**
  - **No bottom avatar** (`margin-top:auto` circle).
  - The rich top-bar contents — **fleet ramp**, **tally**, **view-tab toggle**, **live-poll pill** — are not built; they're delegated to a freeform `topBarEnd` slot, so none of that composition ships as a primitive.
  - Rail icons are lucide (`Activity/Zap/Server/Shield`); prototype uses bespoke inline SVGs (dashboard-grid, lightning-bolt, host-stack, shield). Close in spirit, not identical glyphs. The logo tile inner mark matches (navy bordered square).
  - Hover treatment: built uses `hover:bg-white/10`; prototype `#ffffff18`. Minor.

---

### CommandModal — MINOR / MODERATE

- **Prototype modal has (Ops Center 419–463 / Node Detail 391–420):**
  - Overlay `rgba(16,19,26,.42)` + `blur(3px)`, 580px card, big shadow.
  - Header: a **sev label chip** (white-on-accent), a **kicker** ("Exported command" / "Runbook · host operation" / "Investigate · read-only"), a **✕** close, the title, and an intent paragraph.
  - Conditional **runbook** block (numbered circular ordinals `#EEF2FA`/`#13284F`) + an optional **cmdLabel**.
  - Navy `#13284F` code block (`12.5px` mono, `#DCE4F4`, `white-space:pre`).
  - Copy button + a **note with an info ⓘ icon** ("Runs on your machine — never executed by NodeMonitor"). Copy label flips to "Copied ✓".
  - **Three command *types*** (`command` / `investigate` / `runbook`) each with distinct kicker / cmdLabel / note / primary-button copy (logic 757).
- **Built has:** Radix Dialog (580px), title + intent, runbook (numbered `#EEF2FA`/`#13284F` ordinals), optional cmdLabel, navy code block, copy button ("Copy command" → "Copied"), optional note. Inert-text security is solid.
- **Missing / simplified:**
  - **No sev-label chip** and **no kicker** in the header — the modal can't show "CRITICAL · Runbook · host operation" framing.
  - **No info ⓘ icon** beside the note.
  - **No command-type variants** — the prototype's three modes (exported command / read-only investigate / higher-risk runbook), each with tailored kicker/note/primary copy, collapse to one generic modal. The risk-tier framing (e.g. "Higher-risk host operation — review each step") isn't selectable.
  - Copy label is "Copied" vs prototype "Copied ✓". Minor.
  - The visual header chip/kicker row is the main fidelity loss; the body (runbook + code + copy) is faithful.

---

### StaleChart — OK

- **Prototype `staleChart()` (519–531):** `#F7F2E4` fill, 9px-step diagonal `#D9D2BC` stripes at .5 opacity clipped to a `rx:6` panel, `#E4D9B6` hairline border, bold `#8A7426` "NO FRESH DATA", `#A1924F` "last good 4h ago" sub-line.
- **Built has:** a near byte-identical port — same fill, stripe step/width/opacity, clip radius, border, both text lines and colors.
- **Missing / simplified:** Effectively none. The only nuance: prototype stale charts are sized to the slot they replace (`186×58`); the built `EvidenceChart` passes a fixed `width={188}` regardless of the real slot width, so a stale panel won't span a 362px hero slot. Cosmetic.

---

## Top fidelity gaps (ranked)

1. **EvidenceChart drops the marker + projection layers and the entire evidence-panel chrome.** The prototype chart always lives inside a panel with an `evLabel` + bold colored `evValue` (+`evNote` on hero), and the SVG carries a vertical dashed **marker with a label** ("lost", "now") and a dashed **projection** forecast. Built: projection is derived but **never rendered**, marker doesn't exist, and there's no label/value/note header at all. An operator sees a bare line where the prototype shows "gRPC reachability · DOWN" with a "lost" marker at the failure point.

2. **SeverityCard is only the header strip of the prototype card.** Prototype cards have a washed icon **tile**, a white-on-accent sev **chip**, a 212/392px **evidence panel**, a **meta row** (layer chip + freshness + expand toggle), and an **expand drawer** (why-chain timeline + AI-read callout + grouped children + export). Built renders icon + kicker + title + one text line. Everything below the title — the bulk of the card — is absent.

3. **The HERO card composition is entirely unbuilt** — including the **blast-radius SVG diagram** (`blastRadius()`, 533–558: host node → 3 target nodes with animated dashed `v2flow` edges, root-cause labels, HTLC-at-risk notes). No primitive renders it; it's the single most distinctive visual in the prototype and has zero coverage.

4. **The detection-chain / why-chain timeline is unbuilt.** Both prototype cards expand into a dot-and-line **timeline spine** (mono timestamps + event text, per-severity dot/line colors via `evColors`/`buildTimeline`). No `df/*` primitive provides it; the gallery never shows it.

5. **TwoAxisPip lost its boxed sub-panels, pulsing alarm dot, and "last run" row.** The two axes are inline spans instead of the prototype's two **bordered, tint-on-failure inset boxes**; the status chip's alarm dot **doesn't pulse** (`nmpulse` dropped); and the `last run` ("failed 41m ago", red) footer row is gone. The "up but dead" state reads less alarming than designed.

6. **CommandModal lost its sev-chip/kicker header and its three risk-tier variants.** No "CRITICAL · Runbook · host operation" chip+kicker, no info ⓘ note icon, and the three command modes (exported / investigate / runbook) — each with distinct framing copy — collapse to one generic modal.

7. **AiReadPanel lost the numbered priority tags, the head/body text split, the dismiss control, and the all-clear variant.** Ranked ordinals (`1`/`2`/`3` colored squares) become plain severity dots; the bold-white-lead + muted-blue-body typography becomes one uniform string; there's no ✕ dismiss and no green-check "Nothing needs you right now" mode.

8. **NavRailShell ships only the chrome skeleton.** The fleet **ramp bar**, **tally counts**, **view-tab toggle**, **live-poll pill**, and **bottom avatar** — all part of the prototype shell — are delegated to a freeform slot or omitted, so the operator-facing top-bar instrumentation isn't a reusable primitive.

9. **EvidenceChart area is boolean, not 3-way; axis labels are quantity-only.** `area:'above'` (fill only above the threshold) can't be expressed, and the axis-label type can't represent the prototype's **time** ticks (`-30m`, `+6d`, `now`) — only sats/BTC quantities. Plus the Node Detail **shade window** (fee-drift shaded region) has no equivalent.

10. **Smaller divergences:** SeverityRow uses a round dot + invented "open →" + sev-label where the prototype child row uses a 2px **square** dot and an `id · kind · note · detail` columnar record; FreshnessChip shows an absolute UTC stamp instead of the prototype's relative "4s ago"; ImplTag shows `LND`/`LDK` instead of `"Routing · LND"`/`"LSP · LDK"`.
