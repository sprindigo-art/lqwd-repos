---
status: testing
phase: 18-hardening-vm-deploy-v1-v2
source:
  - 18-04-SUMMARY.md
  - 18-05-SUMMARY.md
  - 18-06-SUMMARY.md
  - 18-07-SUMMARY.md
  - 18-08-SUMMARY.md
  - 18-09-SUMMARY.md
  - 18-10-SUMMARY.md
  - 18-11-SUMMARY.md
  - 18-12-SUMMARY.md
started: 2026-07-27T11:20:00Z
updated: 2026-07-29T00:00:00Z
---

## Current Test

number: 2
name: Honest fleet counts — no fabricated all-clear
expected: |
  Open http://localhost:3000/ and note the top-bar fleet counts. Then open an
  incident detail page and a host detail page. Those pages must show REAL counts
  matching the Ops Center (criticals/warnings visible) — never a solid-green
  "all ok" ramp while the fleet has live criticals. If counts cannot be read at
  all, the summary is omitted entirely rather than faked.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: Stop any running dev server. Start fresh with `npm run dev`. App boots with no errors, boot health check passes (or fails loud by env-var name), and http://localhost:3001/ loads with live fleet data.
result: pass (both halves verified)
notes: |
  A 13-day-old orphaned dev server (PID 23499, started Jul 13 — predating ALL of
  Phase 18) was holding port 3000 + .next/dev/lock. Operator killed it; that stale
  process had been masking this behavior by staying booted from when the warehouses
  were reachable.

  On genuine cold start the boot health check FAILED LOUD and aborted the server:
  `Error: routing_vm: unreachable` at health.ts:51 via instrumentation.ts register().

  VERDICT: correct, designed behavior — NOT a defect and NOT a Phase 18 regression.
  - Root cause is environmental: all three DBs point at 192.243.215.101 and the
    operator's current IP is not on the allowlist (operator-confirmed).
  - `assertReachable`'s abort-boot throw was introduced in Phase 1 (commit 5f7aea9,
    feat(01-02)), long before Phase 18. Phase 18 only added the role-level read-only
    probe (18-07) and assertBootEnv (18-12) around it.
  - The app refused to serve rather than silently degrading to empty/stale data —
    the honest-failure posture HARDEN-01/03 exist to guarantee.

  RESUMED 2026-07-28 — warehouse access restored (192.243.215.101:5432 reachable).
  Cold start now boots clean: "Ready in 1061ms" with NO health-check error, meaning
  assertBootEnv passed and all three probes passed (routing_vm + ldk role-level
  read-only enforced, nodemon writable). GET / => 200, 247KB, real fleet data
  (LQWD-Australia/Canada/England/France/HongKong/India/Ireland...) with a genuine
  severity mix (stale/critical/warning/healthy) and no error markers.
  Both halves of this test are now verified.

### 2. Honest fleet counts — no fabricated all-clear
expected: Open an incident detail page and a host detail page while the fleet has at least one real critical/warning. The top-bar fleet summary shows REAL counts matching the Ops Center — never a solid-green "all ok" ramp. If counts can't be read at all, the summary is omitted entirely rather than showing a fake healthy bar.
result: [pending]

### 3. Honest freshness stamp — no fake "Live"
expected: Where a poll/fetch age is displayed, a real age shows (e.g. "polled 2m ago"). If no fetch epoch exists, it reads an honest "no data yet" — never "Live · polled 0s ago". No hydration flicker/mismatch warning in the browser console on load.
result: [pending]

### 4. Legible honest-state text (df-faint sweep)
expected: Across Ops Center, node detail, hosts and inbox, all meaning-bearing text — especially stale/no-data/empty-state messages and secondary labels — is clearly readable against the background. No washed-out grey text you have to squint at.
result: [pending]

### 5. In-shell loading + error boundaries
expected: On a slow load the overview shows an in-shell loading state with the nav rail still mounted (not a blank page). If a read fails, an in-shell error state appears that stays inside the app chrome and does NOT echo a raw stack trace or DB error string.
result: [pending]

### 6. Command export — full safety text, no truncation
expected: Open a recommendation card and use Copy All / command export. The copied text contains the complete safety/runbook guidance verbatim (restart-key steps, aged-funding guidance, coop-safety notes) — not cut off mid-sentence at ~120 chars. Every pubkey/channel identifier in the commands looks well-formed.
result: [pending]

### 7. Unknown channel base fee renders honestly
expected: In a node's channels table, a channel whose base fee is genuinely unknown displays "—" (em dash), not "0". A real zero still displays 0.
result: [pending]

### 8. Insight view resilience
expected: /inbox and the per-node console load and render cards normally. (Hardening: if one node's data were malformed, only that node's card would drop — the whole view would not go blank or error.)
result: [pending]

## Summary

total: 8
passed: 1
issues: 0

## Deferred / Operator-owned (not part of this UAT)

- 18-10 live-DB self-approve-guard integration proof — requires applying
  `drizzle/nodemon/0005_self_approve_guard.sql` to the nodemon DB, then running
  `src/lib/queue/self-approve-guard.test.ts` (DB-required, skips locally).
- 18-09 queue apply-fee golden path against a live node (canary), and the
  docker-gated bats suite for check-queue.
- `tests/node/*` companion files remain uncommitted (owned by a follow-up).
