// DS-01 single source of truth for Data-Forward v2 color/radius/shadow tokens in TS.
// This is the SSR-safe MIRROR of the `--color-df-* / --radius-df-* / --shadow-df-*`
// block in `src/app/globals.css` (verified byte-for-byte by `tokens.test.ts`).
//
// Why a TS mirror exists: Recharts renders to SVG attributes (fill/stroke) where
// CSS custom properties do NOT resolve SSR-safely — `getComputedStyle` is the
// known anti-pattern. Chart/severity consumers import these literal hexes instead.
//
// Keys are 1:1 with the CSS var names (camelCased): `--color-df-ok-text` → `okText`.
// Do NOT hand-edit a value here without editing globals.css in lock-step — the
// parity test fails on any drift in either direction.

export const DF = {
  // ── surfaces ──
  bg: "#EEF1F5",
  surface: "#FFFFFF",
  surfaceSub: "#FAFBFD",
  border: "#E4E7EE",
  borderSoft: "#ECEFF4",
  // ── ink ──
  ink: "#10131A",
  muted: "#6F7787",
  faint: "#9AA3B4", // DECORATIVE ONLY — fails 4.5:1 AND 3:1 as text
  // ── chrome (structure, never a health color) ──
  chrome: "#13284F",
  chromeAccent: "#2C4A7E", // lighter navy — rail avatar / chrome insets
  brand: "#1A3C79",
  brandTint: "#EAEEF6", // faint navy wash — safety footer / brand-tinted grounds
  slate: "#64748B", // neutral chart gray — threshold line + peer-median band (prototype #64748B)
  caption: "#8A92A0", // SVG chart caption/axis label gray (tokenizes EvidenceChart literal)
  // ── severity ramp (set-disjoint from chrome/brand) ──
  critical: "#E0392B",
  criticalTint: "#FCEBEA",
  criticalBorder: "#F3D3D0",
  warning: "#C8770A",
  warningTint: "#FBF0DD",
  warningBorder: "#EFE0C5",
  watch: "#0E8C84",
  watchTint: "#E2F2EF",
  watchBorder: "#C2E3DD",
  ok: "#1E9E63", // NON-TEXT role (dots/sparks/accents) — 3.43:1
  okText: "#1E7A4E", // AA-text role — 5.32:1
  okTint: "#E7F4EC",
  // ── stale / no-data (shape-distinct honest-stale) ──
  staleDot: "#C8A23A",
  staleText: "#A9912F",
  staleTint: "#F7F0DC",
  staleBorder: "#E9DCB6",
  // ── impl tags ──
  lnd: "#33559B",
  lndBg: "#EAEFF8",
  ldk: "#7A4FA3",
  ldkBg: "#F1EAF8",
  // ── radius ──
  pill: "6px",
  btn: "9px",
  card: "14px",
  cardLg: "18px",
  // ── shadow ──
  rest: "0 1px 3px rgba(16,19,26,.05)",
  hover: "0 10px 30px rgba(16,19,26,.10)",
} as const;
