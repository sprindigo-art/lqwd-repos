---
phase: 10
plan: G1
subsystem: design-system / df-primitives
tags: [evidence-chart, recharts, fidelity-gap, ds-02, prototype-parity]
requires:
  - df/EvidenceChart (existing 5-layer chart)
  - df/StaleChart (honest-stale fallback)
  - lib/df/tokens (DF mirror)
  - lib/format/units (formatSats/formatBtc)
provides:
  - EvidenceChart with full 9-layer prototype grammar
  - EvidencePanel (evLabel + colored evValue + evNote chrome)
  - AreaMode 3-way area, time-or-quantity AxisLabel union
  - ChartMarker / ChartShade descriptors
affects:
  - df gallery (still compiles — additive props only)
tech-stack:
  added: []
  patterns:
    - pure deriveChartModel asserted in tests; panel/axis/Stale via renderToStaticMarkup
    - literal-hex DF colors in SVG attrs (no getComputedStyle)
key-files:
  created: []
  modified:
    - src/components/df/EvidenceChart.tsx
    - src/components/df/EvidenceChart.test.tsx
decisions:
  - EvidencePanel co-located in EvidenceChart.tsx (not a new file) — same module, smallest surface
  - evLabel literal #8A92A0 kept component-local (no exact DF token match)
metrics:
  duration: ~25m
  completed: 2026-06-24
---

# Phase 10 Plan G1: EvidenceChart Full-Fidelity Rebuild Summary

Rebuilt `df/EvidenceChart` from a ~5-layer plot to the locked prototype's full 9-layer `chart()` grammar — rendered projection, vertical marker, 3-way area, time-or-quantity axis, optional shade window — and added an exported `EvidencePanel` restoring the evLabel/evValue/evNote chrome the prototype wraps every chart in.

## What changed

All six gap targets closed against the prototype `chart()` spec (Ops Center v2 lines 472-517; Node Detail 429-448):

1. **Projection layer — now RENDERED.** `deriveChartModel` already built `model.projection`; the JSX never drew it. Added a second `<Line data={projection.data}>` with dashed `3 3`, `strokeWidth:1.5`, `opacity:.65`, starting at the last real point so the segments meet. The x-domain now extends to `series.length + projection.length - 1` (proto `N = series + proj`) via an explicit numeric `XAxis domain`, so projection indices land at the correct x.
2. **Marker layer — NEW.** `ChartMarker { atIndex, label }` → a vertical `<ReferenceLine x>` dashed `2 2` slate at `0.55` opacity with a top "lost"/"now" label (proto lines 506-509).
3. **Area is 3-way, not boolean.** `AreaMode = "above" | "under"` (legacy `boolean` still accepted; `true` → `"under"`). `"above"` sets the `<Area baseLine>` to the threshold value so only the exceedance fills; `"under"` fills to baseline. `"above"` without a threshold gracefully falls back to baseline fill.
4. **Time axis.** `AxisLabel` is now a discriminated union — `{kind:"time", value:string}` renders literal strings (`-30m`, `now`, `+6d`) verbatim; `{kind:"sats"|"btc"}` still routes through `units.ts`. Axis strip anchors start/middle/end (proto 513-515). Exported `formatAxisLabel` for unit testing.
5. **Evidence-panel chrome.** New exported `EvidencePanel` (co-located in EvidenceChart.tsx): `#FAFBFD` inset card, `evLabel` (left, `#8A92A0`) + bold colored `evValue` (right, accent or explicit color) + optional `evNote` caption (hero). Mirrors proto 152-160 / 305-310.
6. **Shade window (optional).** `ChartShade { from, to, label }` → a `<ReferenceArea x1..x2>` with `#C8770A12` fill + centered `#C8770A` label (Node Detail 434-435).

Existing threshold / band / area / line / last-dot layers and the StaleChart honest-stale fallback are all preserved. The band now carries its in-plot "peer median" caption (proto 486) via the ReferenceArea label, and defaults the caption when none is supplied.

## Deviations from Plan

None — plan executed as written. All work stayed within the two owned files; no new EvidencePanel.tsx file was created (the export is co-located in EvidenceChart.tsx, which the objective explicitly permitted as the first option).

## Component-local literal (noted per constraints)

`evLabel` uses the prototype's one-off caption gray `#8A92A0`, which has **no exact match** in the DF token mirror (`muted #6F7787` / `faint #9AA3B4` are close but not byte-identical). Per the constraint ("if you truly need a new global token, use a component-local fallback and note it"), it is kept as a component-local constant `EV_LABEL_COLOR` rather than adding a global token. `evNote` reuses `DF.faint` (exact proto `#9AA3B4`); axis ticks reuse `DF.faint`; shade colors are prototype literals (`#C8770A12` / `#C8770A`) with no DF equivalent.

## Backwards compatibility

- `area?: boolean` callers (the gallery fixtures pass `area: true`) still type-check and behave identically (`true` → `"under"`).
- Existing `axisLabels` with `{kind:"sats"}` still valid under the widened union.
- Existing tests' `toMatchObject` assertions on `model.band` / `model.area` still pass (additive keys only).
- Gallery (`src/app/(design)/design-system/*`) untouched and still compiles.

## Tests

Extended `EvidenceChart.test.tsx` (now covers all new layers):
- `deriveChartModel`: projection start-point + x-domain, marker descriptor, 3-way area resolution (above/under/boolean/above-without-threshold/omitted), shade descriptor, band default caption.
- `formatAxisLabel`: time verbatim vs sat/BTC via units.ts.
- `EvidencePanel` SSR: evLabel + colored evValue + evNote present; accent fallback; note omitted when absent.
- `EvidenceChart` SSR: literal time axis labels render.

## Self-check

- `CI=true npx vitest run --pool=forks --no-file-parallelism src/components/df` → **10 files, 47 tests passed**.
- `npm run lint:noc-guard` → **v2 surfaces clean** (exit 0).
- `npx eslint EvidenceChart.tsx EvidenceChart.test.tsx` → **exit 0, no diagnostics**.
- `next build` deliberately NOT run (hangs this env, per constraints).
- Pre-existing out-of-scope `src/lib/queue/*` Postgres failures untouched (not in `src/components/df`).

## Known Stubs

None. All new layers are wired to real props with graceful empty states (`undefined`/`null` descriptors render nothing).

## Success Criteria

- [x] projection + marker + area-mode + time-axis + evidence-panel chrome + shade rendered to prototype grammar
- [x] additive props; gallery still compiles; tests extended + green; lint:noc-guard exit 0; NO next build
- [x] only EvidenceChart (+ co-located EvidencePanel export) touched
- [x] 10-G1-SUMMARY.md committed on branch gap-g1
