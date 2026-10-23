---
quick_id: 260721-noc
slug: correct-ui-audit-findings-2026-07-21
branch: fix/ui-audit-260721
date: 2026-07-22
status: complete
---

# SUMMARY — Correct all UI audit findings (2026-07-21)

Executed every finding in `.planning/UI-AUDIT-2026-07-21.md` (~45, four parallel audit agents) plus two operator-directed asks (LND capitalization, VM/service/node type tag). Ran in waves: shared foundations → priority incident page (by hand, browser-verified) → three parallel worktree-isolated cluster agents over disjoint files → merge + integration verify.

## Result
- **Production build:** ✓ (all 19 routes compile).
- **Typecheck:** ✓ clean. **noc-guard:** ✓ v2 surfaces clean.
- **Tests:** 1455 passing, 0 new regressions. The 25 remaining failures are strictly pre-existing on the base branch (queue tests need a live Postgres; NavRailShell "view-tab toggle" cases already failed) — confirmed by stashing this work and re-running.
- **Visually verified in-browser:** incident detail, Ops home, Nodes board.

## What changed, by wave

### Wave 0 — foundations (`b3091a9`)
- **C1** — `service-display.ts` `humanize()` now acronym-aware (`lnd`→"LND", plus AI/HTLC/LSP/VM/RPC/…) + tests.
- **B8 tokens** — added `df-chrome-accent`, `df-brand-tint`, `df-caption` (globals.css + tokens.ts mirror).
- Shared primitives: `BoardError` (in-shell read-failure), `BoardEmpty`, `LayerTag` (VM/SERVICE/NODE/CHAIN/STORAGE), `FOCUS_RING`.

### Wave 1 — incident detail page + shared df components (`90dfecc`) — the priority
A1 two-column NOC layout (spine + sticky blast rail — kills ~60% dead width) · A2 BlastRadius rebuilt from a fixed 648px clipping SVG to responsive df-token HTML (truncate+title) · A3 blast nodes colored by their OWN severity (was hardcoded all-red) · A4 killed duplicate "detection chain" label · A5 distinct "why grouped" line (was echoing header + node name twice) · A6 no more "—" timestamp wall · A8 explicit severity words · A9 snoozed-critical banner sticky offset + gated wrapper · A10 kicker contrast · A11 focus rings · C2 layer type-tags. Tests updated.

### Wave 2 — three parallel clusters (worktrees, disjoint files)
- **Shell + Ops home** (`17db7b8`): B3 fleet ramp rolls all five layers (a downed host/service no longer shows all-green — the key correctness bug) · B4 top-bar breadcrumb (dead title/subtitle props now live) · B5 Ops h1/h2 semantics · B9 shell focus rings · B8 hero/rail/footer tokens · all-clear de-dup · square=stale dot fix · responsive top bar.
- **Node detail** (`6a95e97`,`6500115`,`b9d11ce`): B2 in-shell BoardError · B1 df-faint→df-muted (16 components) · B6 responsive mono StaleChart · B7 drop permanent "NO FRESH DATA"/empty-RestartHistory scaffolding · B8 EvidenceChart tokens · B10 free dense tables to full width · capacity un-truncate · unified back-nav · filled forwards active chip · dropped duplicated liquidity figures.
- **Boards** (`641a7da`,`aa9dad0`,`c0003b8`): F(a) keyboard/AT-accessible batch multi-select + ENQUEUE ALL (was mouse-only on a control-plane tool) · F(b) focusable node rows · B2 BoardError · B5 Nodes/Hosts headings · B1 contrast · shared BoardEmpty · single freshness location · truncated queue pubkeys · responsive `.syn` facet rail · `bg-border`→`bg-df-border` · "7d forwarding"→"7d earnings" sort/label.

### Wave 3 — integrate (`f078047`,`95a3386`,`08eee53`)
Merged the three cluster branches (clean, disjoint), ran full verify, removed worktrees.

## Notes / deferred
- Peers CSV export (E) was left as a deliberate visual omission — a working route needs lib/route files outside the node cluster's allowlist. Follow-up if desired.
- Pre-existing failures (queue = live Postgres; NavRailShell view-toggle) are untouched and out of scope.
</content>
