---
phase: 15-data-collection-expansion-logs-deep-vm-metrics
plan: 08
subsystem: ui-pages
tags: [col-01, col-03, un-stub, node-detail, service-detail, vm-vitals, logs, fail-soft]
requires:
  - "15-03 (getServiceLogEvents — benign-suppressed NodeLogLine stream)"
  - "15-04 (getHostMetricsExt — deep-VM view with D-14 read-time bands)"
  - "15-05 (wave-2 sibling; no direct import on these pages)"
provides:
  - "Node page /{pubkey}: real per-host log stream in NodeLogsStream (logs:[] stub replaced)"
  - "Node page /{pubkey}: three deep-metric VmVitals charts (per-core CPU busy, disk-I/O Δ, net errors+drops Δ) fed by getHostMetricsExt"
  - "Service page /{pubkey}/service/{service}: real per-service log tail in ServiceLogTail (logRows:[] stub replaced), validation-gated + hostId-keyed"
affects:
  - "15-09 (canary run performs the deferred visual verification of these surfaces)"
tech-stack:
  added: []
  patterns:
    - "Fail-soft per-section reads: reader view fetched with .catch(() => null), lines projected via ?? [] — honest empty, never a page crash"
    - "Deep-metric VmVitalChart entries ride the existing serializable-prop path; severity ONLY from D-14 read-time bands (steal/iowait, tcp retransmit) + hard-zero errs rule"
key-files:
  created: []
  modified:
    - src/app/(overview)/[pubkey]/page.tsx
    - src/app/(overview)/[pubkey]/service/[service]/page.tsx
    - src/components/node/VmVitals.tsx
decisions:
  - "Deep charts always render (3 panels) once a host resolves — an absent reader/table (0003 operator gate) or missing prior sample shows honest StaleChart 'NO FRESH DATA', not a hidden section"
  - "Net-errors chart severity = worst-of the banded tcpRetransmitRate (D-14) and a hard-zero errs/drops rule (any Δ>0 → warning); disk-I/O throughput is unbanded evidence (healthy accent when data exists)"
  - "VmVitalChart.key widened to string so deep-metric keys (cpu-cores/disk-io/net-errs) type-check; base keys unchanged"
metrics:
  duration: ~8m
  completed: 2026-07-14
---

# Phase 15 Plan 08: Un-stub Log UI + Deep VM Vitals Summary

**One-liner:** Both hardcoded log stubs (`logs: []` node page, `logRows: []` service page) replaced with the real benign-suppressed `getServiceLogEvents` stream, and `getHostMetricsExt` now feeds three deep-metric VmVitals charts — all fail-soft with honest stale/no-data states, validation gauntlet intact.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Wire real log feed into NodeLogsStream + deep VM vitals (node page) | b72d3fe | src/app/(overview)/[pubkey]/page.tsx, src/components/node/VmVitals.tsx |
| 2 | Wire real per-service log tail into ServiceLogTail (service page) | de0efd9 | src/app/(overview)/[pubkey]/service/[service]/page.tsx |
| 3 | Operator visual verification checkpoint | — (gate) | approved — visual check deferred to 15-09 canary (see below) |

## What Was Built

- **Node page (`/{pubkey}`), COL-01:** the `logs: []` stub is replaced with `getServiceLogEvents(resolved.hostId, null).catch(() => null)` → `logView?.lines ?? []`. Newest-first, benign-suppressed `NodeLogLine` rows straight from the Plan-03 reader (all ts/level formatting reader-side; message stays inert React-escaped text). Keyed by the RESOLVED hostId (Drift 3 — never the raw pubkey); a node with no resolvable host keeps the honest empty stream.
- **Node page, COL-03:** `getHostMetricsExt(vitalsHost.hostId).catch(() => null)` joins the existing vitals `Promise.all`; a new `buildDeepVitals` builder appends three `VmVitalChart` entries to the base CPU/Memory/Disk trio:
  - `cpu-cores` — per-core busy% profile (one point per core), value = peak busy%, severity = worst steal/iowait band across cores (D-14).
  - `disk-io` — per-device read+write bytes Δ (sectors ×512 upstream), value = total pre-formatted bytes, unbanded throughput evidence.
  - `net-errs` — per-iface errors+drops Δ, severity = worst-of banded tcpRetransmitRate + hard-zero errs rule (any Δ>0 → warning).
  Freshness is governed by the reader's `deriveStale` (D-13): absent table (0003 gate), stale host, or missing prior sample renders the honest `StaleChart` "NO FRESH DATA" panel — never faked freshness or an interpolated line.
- **Service page (`/{pubkey}/service/{service}`), COL-01:** the `logRows: []` stub is replaced with `getServiceLogEvents(hostId, canonicalService)` mapped to the `LOG_COLUMNS` `{time, level, message}` string-row shape (newest-first from the reader). The read sits strictly AFTER the PUBKEY_RE/SERVICE_SLUG_RE gauntlet (lines 123–125), hostId resolution (line 157) and canonical-service resolution (line 171) — the raw URL service segment never reaches the reader or SQL (T-15-01); both inputs are bound params in the reader.
- **Component change (deviation-driven):** `VmVitalChart.key` widened from the closed `"cpu" | "mem" | "disk"` union to `string` so the deep-metric keys type-check; no rendering logic changed, and no other consumer (hosts detail page) is affected.

## Verification

- `npx tsc --noEmit` — clean (no errors in either page or VmVitals).
- `grep -c "logs: \[\]" "src/app/(overview)/[pubkey]/page.tsx"` → 0; `grep -c "logRows: \[\]" ".../service/[service]/page.tsx"` → 0 (both stubs replaced).
- `getServiceLogEvents` present on both pages, fail-soft wrapped; node page call keyed by `resolved.hostId`, service page call at line 255 — textually after the gauntlet/resolution lines (123/125/157/171).
- `getHostMetricsExt` output feeds `VmVitalChart` entries via `buildDeepVitals`; `deriveStale` (through `ext.stale`) governs deep-metric freshness.
- No test suite references VmVitals — no regression surface; read-layer tests untouched.

## Task 3 Checkpoint Outcome

**Approved with visual check deferred to 15-09 canary.** The operator accepted the code-level verification now (tsc clean, stub greps zero, fail-soft honest states) and explicitly deferred the visual verification of real rendered logs / deep-VM charts to Plan 15-09's canary run, which orchestrates the DDL/grants/seed apply (migration 0003 operator gate) and a live `*/5` tick. Until that apply, both surfaces render their honest empty/stale states by design.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] VmVitalChart.key union widened to string**
- **Found during:** Task 1
- **Issue:** `VmVitalChart.key` was the closed union `"cpu" | "mem" | "disk"` — the new deep-metric chart keys (`cpu-cores`/`disk-io`/`net-errs`) failed to type-check, blocking the task.
- **Fix:** Widened `key` to `string` with a doc comment listing the base + deep keys; the key is only a React key / SVG id suffix, so widening is behavior-neutral.
- **Files modified:** src/components/node/VmVitals.tsx
- **Commit:** b72d3fe

**2. [Adaptation] Reader signature differs from the plan's sketch**
- **Found during:** Task 1/2
- **Issue:** The plan sketched `getServiceLogEvents(hostId, null, window).catch(() => [])`, but the shipped Plan-03 reader is `getServiceLogEvents(hostId, service?)` returning a `{ lines, asOf, stale }` view (fixed LIMIT 500, no window param).
- **Fix:** Wired as `.catch(() => null)` + `logView?.lines ?? []` (node page) and the same view projection mapped to LOG_COLUMNS rows (service page) — the fail-soft contract (broken reader → honest empty, never a crash) is preserved exactly.
- **Files modified:** both pages
- **Commits:** b72d3fe, de0efd9

## Authentication Gates

None.

## Known Stubs

- `restartEvents: WhyChainEvent[] = []` on the service page (Restart History section) — intentional and pre-existing: no sanctioned restart-history reader exists in the read model; not in this plan's scope and unchanged.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes. T-15-01 mitigated (reads after the gauntlet; hostId + canonicalService only, bound params); T-15-05/T-15-07 mitigated (messages rendered as inert React-escaped text via EventTable; no AI command emission on these surfaces).

## Self-Check: PASSED

- FOUND: src/app/(overview)/[pubkey]/page.tsx (contains getServiceLogEvents + getHostMetricsExt; logs:[] absent)
- FOUND: src/app/(overview)/[pubkey]/service/[service]/page.tsx (contains getServiceLogEvents; logRows:[] absent)
- FOUND: src/components/node/VmVitals.tsx (key: string)
- FOUND commits: b72d3fe, de0efd9
