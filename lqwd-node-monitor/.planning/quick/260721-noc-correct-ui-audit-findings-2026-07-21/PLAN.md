---
quick_id: 260721-noc
slug: correct-ui-audit-findings-2026-07-21
branch: fix/ui-audit-260721
date: 2026-07-22
status: complete
---

# Correct all UI audit findings (2026-07-21)

Source of truth: `.planning/UI-AUDIT-2026-07-21.md` (~45 findings, file:line-cited). This plan groups them into **waves** and **disjoint file clusters** so parallel executors never edit the same file. Design system: Light NOC theme, navy `#1A3C79` = structure only, severity = state only, IBM Plex Mono = data, Saira = display headers, "instruments not bubbles."

## Wave 0 — Shared foundations (orchestrator, main tree, sequential)
Unblocks every cluster. Commit before Wave 1.
- **C1** — `service-display.ts`: acronym-aware `humanize()` (LND, AI, HTLC, LSP, VM, RPC, DB, CPU, IO) so `lnd`→"LND".
- **B8 (tokens)** — `globals.css`: add sanctioned `df-*` tokens to replace hex literals (caption gray, brand tint, blast-region hues) so clusters reference tokens not hex.
- **Shared primitives** — `src/components/df/BoardError.tsx` + `BoardEmpty.tsx` (render inside NavRailShell, df tokens) for B2/empty-state reuse; `layerTag()` helper (layer→`VM`/`SERVICE`/`NODE`/`CHAIN`/`STORAGE`) for C2; a shared `focusRing` class constant.

## Wave 1 — Priority: Incident page + shared df components (orchestrator, browser-verified)
Files: `incidents/[incidentKey]/page.tsx`, `BlastRadius.tsx`, `WhyChain.tsx`, `SeverityRow.tsx`, `incident-detail.ts`, `ai-band.ts`, `incident/*`.
- **A1** two-column NOC grid (spine + sticky rail). **A2** BlastRadius → responsive HTML/flex, truncate+title. **A3** color blast nodes by real severity (thread `c.severity`). **A4** kill duplicate "detection chain" label. **A5** drop/rewrite redundant AI-read line. **A6** handle empty timestamps. **A7** consistent width. **A8** severity word on why-chain/blast (not color-only). **A9** banner sticky offset + gate empty wrapper. **A10** Saira h1 + kicker contrast. **A11** focus rings. **A12** dedupe Home nav. **A13** lint nit. **C2** layer type-tag on blast targets + grouped children.
- Verify in browser at 1568px + narrow before commit.

## Wave 2 — Mechanical page clusters (parallel worktree executors; disjoint files)
### Cluster S — Shell + Ops home
Files: `NavRailShell.tsx`, `(overview)/page.tsx`, `RefreshControl.tsx`, `SeverityHeroCard.tsx`.
- **B3** fleet ramp across all 5 layers. **B4** wire title/subtitle into top-bar breadcrumb (or delete). **B5(ops)** h1 + section h2. **B9(shell)** focus rings on nav/toggle/refresh. **Ops D**: collapse triplicated all-clear copy; Saira display font on headlines; round dots for non-stale in vitals tally; top-bar `flex-wrap`/responsive collapse. **B8**: replace SeverityHeroCard/rail/footer hex with Wave-0 tokens.

### Cluster N — Node detail routes
Files: `[pubkey]/page.tsx` + `channels|forwards|peers|[tab]|service/[service]/page.tsx`, `NodeHeader.tsx`, `NodeDetailTabs.tsx`, `NodeSummaryStrip.tsx`, `VmVitals.tsx`, `NodeActiveSignals.tsx`, `NodeLogsStream.tsx`, `NodeSupportingServices.tsx`, `EvidenceChart.tsx`, `StaleChart.tsx`, `LiquidityGauge.tsx`.
- **B2(node)** use BoardError in every catch. **B1(node)** df-faint→df-muted for text. **B6** StaleChart responsive viewBox + mono font; unify chart width. **B7** omit deep-vitals when reader null; omit empty RestartHistory. **B8** EvidenceChart hex→tokens. **B10** free the channels/forwards/peers tables from the 1180 cap. **E**: un-truncate Capacity value; unify back-nav to `/nodes`; filled active window pill; add peers CSV export; drop duplicated liquidity figures; bump tiny-chart label legibility.

### Cluster B — Board routes
Files: `nodes|hosts|hosts/[hostId]|inbox|pending|queue/page.tsx`, `NodesTable.tsx`, `PendingBoard.tsx`, `FleetPendingBoard.tsx`, `InfoGroups.tsx`, `InboxTriage.tsx`, `HostCard.tsx`, `SeveritySpine.tsx`, plus `globals.css` `.syn` rule (coordinate: Wave 0 owns globals.css — leave `.syn` responsive edit to Cluster B as the ONLY board-owned globals rule).
- **B1(board)** df-faint→df-muted. **B2(board)** BoardError in catches. **B5(boards)** h1+description on nodes/hosts. **F**: focusable/AT batch select + ENQUEUE ALL (real buttons); focusable node row (stretched-link); single freshness location; shared BoardEmpty; truncate queue pubkeys; responsive inbox facet rail (`.syn` breakpoint); pair RefreshControl with freshness; fix "7d forwarding" sort/label; `bg-border`→`bg-df-border`.

## Wave 3 — Integrate & verify
- Merge worktrees. `npm run lint`, `npm test`, `npm run build`. Browser screenshots: incident, ops-home, nodes, inbox. Write SUMMARY.md, update STATE.md Quick Tasks table.

## Conflict guard
`globals.css` (Wave 0 + Cluster B `.syn` only), `service-display.ts` (Wave 0), incident/df-shared files (Wave 1) — Clusters S/N/B must NOT touch these. Shared components (SeverityRow, BoardError, BoardEmpty, layerTag) are consumed read-only by clusters.
</content>
</invoke>
