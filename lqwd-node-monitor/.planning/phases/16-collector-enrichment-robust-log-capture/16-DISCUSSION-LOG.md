# Phase 16: Collector Enrichment — Discussion Log

**Date:** 2026-07-15
**Mode:** discuss (default)
**Areas discussed:** all 4 selected (Classification re-derivation, Signal-vs-noise policy, Log-path discovery, Fleet rollout & isolation)

> Human-reference record of the discussion. Not consumed by downstream agents (they read CONTEXT.md).

## Area 1 — Classification re-derivation
- **Q: How to build the real log_patterns_config set?** → **Hybrid** (mine live signatures + cross-check Obsidian, operator categorizes the merged set). Rationale: canary proved the Obsidian-only seed doesn't match real LND errors.
- **Q: Taxonomy to categorize into?** → Operator directive: **clear 3-tier — info/benign, warn/attention, critical.** Drop `ap11`/`ap12` (unclear, unhelpful). Use human-readable category labels instead of codes.
- **Operator constraint (unprompted):** Obsidian is LOCAL — bootstrap-only; won't exist on VM. Ongoing tuning must be data-driven via SQL-tunable `log_patterns_config` + the `log_patterns` aggregate.

## Area 2 — Signal-vs-noise policy
- **Q: How to capture per tier without flooding?** → **Tier-driven** (info = count-only aggregate; warn = capped exemplars; critical = more + longer retention). Count always survives even for suppressed noise.

## Area 3 — Log-path discovery model
- **Q: How to populate/maintain service_inventory paths?** → **Recurring owner-side reconciler** (auto-registers daemon logs fleet-wide; collector stays SELECT-only).

## Area 4 — Fleet rollout & isolation
- **Q: How should collector changes roll out?** → **Version-gated canary rollout** (pin/promote; ends accidental splices before VM move).

## Forward-looking (operator question)
- **Q: cron → systemd services impact on collection?** → Discussed impact (detection cron-mtime→systemctl already supported; log source files→journald needs a journald source; systemd fixes lncli/env fragility). Decision: **out of Phase 16 scope** — operator will scope a SEPARATE agent task to review crons + conversion. Phase 16 builds a **source-agnostic capture cursor (D-09)** so the future journald source is a bolt-on.

## Deferred ideas
- Cron→systemd migration (separate future task).
- UI surfacing of tiers/categories (Phase 17).
