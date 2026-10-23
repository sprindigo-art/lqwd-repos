---
phase: 13-nodes-service-health
plan: 09
subsystem: service-detail-ui
tags: [svc-02, service-detail, two-axis, honest-stale, verify-first, zero-write-path]
requires:
  - "src/lib/read/node-services.ts (resolveNodeServices — Plan 05)"
  - "src/lib/read/service-health.ts (ServiceHealthState / getServiceHealth)"
  - "src/lib/read/chain-telemetry.ts (getChainTelemetry / buildChainEvidence)"
  - "src/lib/overview/service-display.ts (serviceDisplay relabel)"
  - "df primitives: TwoAxisPip, NavRailShell, EvidenceChart/EvidencePanel, StaleChart, FreshnessChip, AiReadPanel, WhyChain, BlastRadius, CommandModal/CommandPanel"
provides:
  - "SVC-02 Service Detail route /(overview)/[pubkey]/service/[service]"
  - "src/components/service/* — six section leaves (C1–C6)"
affects:
  - "Node Detail service tiles (Plan 07/08) link to this surface"
tech-stack:
  added: []
  patterns:
    - "One component tree, two DATA variants (infra bitcoind vs custom service) — variant split lives ONLY in the data source + which evidence chart shows"
    - "Two-gate validation: PUBKEY_RE + service-slug format BEFORE any read; existence (service runs on this node) AFTER the read → notFound()"
    - "Honest-stale everywhere: StaleChart on stale, no fabricated trend line, honest empty states for log/restart"
key-files:
  created:
    - "src/app/(overview)/[pubkey]/service/[service]/page.tsx"
    - "src/components/service/ServiceDetailShell.tsx"
    - "src/components/service/ServiceVitals.tsx"
    - "src/components/service/ServiceLogTail.tsx"
    - "src/components/service/RestartHistory.tsx"
    - "src/components/service/Dependents.tsx"
    - "src/components/service/VerifyFirstRunbook.tsx"
  modified: []
decisions:
  - "No sanctioned history reader exists for chain-telemetry or service run-success in the current read model (Phase-11 telemetry is latest-snapshot). Rather than fabricate a 2-point line, ServiceVitals renders the latest value as the evidence and an honest 'Latest reading only — no retained history to trend' note; StaleChart on stale. Series prop is future-proofed so a real reader can pass ≥2 points later."
  - "Service segment validated by a FORMAT whitelist (SERVICE_SLUG_RE) before reads (never concatenated into SQL — reads are hostId-bound); existence is a second gate after the resolver."
  - "VerifyFirstRunbook builds its variant copy internally (infra = coordinated restart, NOT auto; custom = service recovery) so the C6 logic is self-contained and inert."
metrics:
  duration: "~40m"
  completed: "2026-07-08"
  tasks: 3
  files: 7
---

# Phase 13 Plan 09: Service Detail (SVC-02) Summary

SVC-02 Service Detail ships as one component tree with two honest data variants — infra (`bitcoind`, charting blocks-behind via chain-telemetry) and custom-service (`addressBalances`, charting run-success/error-count) — composing the shipped df/console primitives + the Plan-05 resolver with zero new primitive and zero write path.

## What was built

A new RSC route `/(overview)/[pubkey]/service/[service]` and six section leaves under `src/components/service/`:

- **C1 `ServiceDetailShell` + `ServiceHeader`** — `NavRailShell` chrome (nodes rail, no fake fleet-summary/view-toggle for a single-service surface); header shows the service DISPLAY name (`serviceDisplay().label`, never the raw key), the owning node (links back to Node Detail) + host id, a FULL-SIZE `TwoAxisPip` health block, and an honest `FreshnessChip`.
- **C2 `ServiceVitals`** — heartbeat age / last-successful-run / error count as mono figures + a trailing `EvidencePanel`. Infra shows blocks-behind (+ its D-14 band severity as the value color); custom shows the error-count. Stale → `EvidenceChart stale` → `StaleChart` "NO FRESH DATA"; fresh-but-no-history → honest note, never a faked line.
- **C3 `ServiceLogTail`** — `EventTable` log tail + inline dismissible advisory `AiReadPanel`. Imports NOTHING from the queue/command/sign layers; `AiReadLine` carries no action field.
- **C4 `RestartHistory`** — read-only `WhyChain` timeline with the verbatim "No restarts recorded for this service." empty state.
- **C5 `Dependents`** — `BlastRadius` diagram derived from the ownership containment (services' `(hostId, nodePubkey)` pairs); a host-level infra service fans out to every node on its host; node-scoped services render the honest empty state.
- **C6 `VerifyFirstRunbook`** — "Verify first" symptom-confirmation steps FIRST, THEN an inert `CommandModal` copy-to-run remediation. Infra = safe coordinated restart (explicitly NOT auto); custom = service recovery. Never executes, emits no signed param.

## Must-haves — evidence

- **One tree, two variants:** single `isInfra` branch in the route selects chain-telemetry vs service-health data (`page.tsx:128,184,309`); every section component is variant-agnostic. ✔
- **Full-size two-axis health block + heartbeat/last-run/error + honest freshness:** `ServiceHeader` renders `TwoAxisPip` at a 320px block + `FreshnessChip`; `ServiceVitals` renders the three mono figures. ✔
- **Infra charts blocks-behind; custom charts run-success/error-count; stale → NO FRESH DATA:** C2 evidence branch; `chartStale` drives `EvidenceChart stale` → `StaleChart`, never a fabricated line. ✔
- **Verify-first runbook lists verify steps before any command; never executes:** C6 renders the "Verify first" ordered list, then a `CommandModal` trigger; grep confirms no exec/queue/sign path. ✔

## Verification

- `npx tsc --noEmit` — clean after each task (3×).
- grep battery: no queue/enqueue/sign/exec import in `src/components/service/` (matches found are explanatory comments only); one-tree variant branch present; the route renders `serviceDisplay().label` (never a raw machine key) in all UI positions — the raw key appears only inside the inert `systemctl` command string.

## Deviations from Plan

### Auto-fixed / judgment calls

**1. [Rule 2 — honest data] No fabricated trend line for the C2 evidence chart**
- **Found during:** Task 1.
- **Issue:** The plan calls for C2 to "chart" blocks-behind / run-success, but the current read model (`chain-telemetry` + `service-health`) exposes only the LATEST snapshot — there is no sanctioned history reader, so a real ≥2-point series cannot be built.
- **Fix:** `ServiceVitals` composes `EvidenceChart`/`StaleChart` and renders: StaleChart on stale; the accent trend line when a ≥2-point `series` prop is supplied; otherwise the latest value (in `EvidencePanel`) plus an honest "Latest reading only — no retained history to trend." note. The `series` prop is future-proofed so a history reader (later phase) can pass real points with no component change. This upholds the load-bearing honesty invariant (never fake fresh telemetry) rather than plotting a fabricated flat line.
- **Files:** `src/components/service/ServiceVitals.tsx`, `src/app/(overview)/[pubkey]/service/[service]/page.tsx`.

**2. [Rule 3 — validation] Service segment format-validated before reads**
- The plan says validate the service "against the declared inventory / SERVICE_DISPLAY keys" before any read. Because the declared inventory is DB-sourced (dynamic), the pre-read gate is a format whitelist (`SERVICE_SLUG_RE`) — the service value is never concatenated into SQL (reads are hostId-bound). The actual existence check ("does this service run on this node?") runs after the resolver and `notFound()`s on miss. Same guarantee, correct ordering.

## Known Stubs

The log tail (C3) and restart history (C4) render honest empty states because the current read model has no log-tail or restart-history reader wired (Phase-11 telemetry is latest-snapshot). These are NOT fabricated — they show the verbatim "No log events in this window." / "No restarts recorded for this service." copy. The component props (`rows`, `events`) are the wiring point for a future reader; the plan's goal (the Service Detail surface renders honestly from one tree) is achieved. Similarly, C2's trend line is dormant until a history reader supplies `series` (see Deviation 1).

## Self-Check: PASSED

- Files: all 7 created files FOUND on disk.
- Commits: `5e5b476` (C1+C2), `882d782` (C3+C4+C5), `d3a302d` (C6) all present in `git log`.
- No file deletions across the three commits.
