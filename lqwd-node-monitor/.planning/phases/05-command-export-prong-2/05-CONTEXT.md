# Phase 5: Command Export (Prong 2) - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Give the operator **ready-to-run, fully-parameterized close/rebalance commands and pending-remediation runbooks** generated purely client/server-side from the frozen Phase 4 card contract — with **zero write path**. Exports cover `close_channel`, `rebalance`, and `remediate_pending` card actions (`update_fee` is explicitly NOT exported — fees are the Phase 6 signed-queue prong, project decision D3). Every export echoes full context (chan point, peer alias, capacity, timelock, limbo amount, age, attempts) plus safety notes, with params validated against strict type/range before rendering (no injection). LND nodes get `lncli` syntax; LDK nodes get `lncmd` syntax. Requirements: EXPORT-01, PENDING-03.

**Explicitly NOT this phase:** any DB write or queue row (Phase 6), any command execution (Phase 7), the rebalance request-table integration for the external AI-balancing service (deferred — write path), fee/`update_fee` export of any kind.

</domain>

<decisions>
## Implementation Decisions

### Export surface & copy flow
- **D-01:** **Inline expand on the card** — exportable cards (close/rebalance/remediate) carry an EXPORT control that expands the command block directly below the row, working identically on `/inbox` and the console Active Signals panel (one component, both surfaces — the Phase 4 D-08 "one engine, two views" pattern). Matches the operator-approved expand patterns (sweep fold, pending drill-in). No modal, no dedicated page.
- **D-02:** **Both copy modes:** every runnable command/step gets its own COPY button (copies the bare command), plus a copy-all button that grabs the entire annotated block.
- **D-03:** **No reveal gate** — expanding the card is the deliberate act; the command is inert text and the real gate is the operator running it on the node. No acknowledge step before the command renders.

### Command block anatomy
- **D-04:** **Self-documenting shell snippet:** the copy-all block carries the context echo (peer alias, capacity, timelock, limbo, age, attempts) as `#` comments above the command, so context travels into terminals and ops tickets. Per-command COPY grabs the bare command only.
- **D-05:** **Safety notes render twice:** as visible UI text on the expanded block AND as `#` comments inside the copy-all snippet (e.g. "coop close — funds available immediately; force close locks funds for the timelock").
- **D-06:** **Verify-step-first:** every export leads with a read-only verification command (e.g. `lncli getchaninfo <chan_id>` / a `pendingchannels` filter) as step 1, with the destructive command as step 2 — satisfies the chan_id echo-back criterion and the fleet's careful-ops culture.

### Rebalance tooling
- **D-07:** **Fleet reality:** rebalancing runs through a custom circular-rebalance script plus AI-driven balancing via an external service — NOT bos/rebalance-lnd. Phase 5 therefore renders an **honest placeholder block** for rebalance cards: full params (out/in peer, amount, direction) in the standard commented context block, with an explicit label "rebalance execution is operator/AI-managed — no generated command yet". No fake runnable command.
- **D-08:** **Future wiring deferred:** the operator wants this later wired to a request table the external balancing service reads from and initiates — that is a write path and lands at/after Phase 6 (see Deferred Ideas).

### Runbook depth (PENDING-03)
- **D-09:** **Key steps + script pointer** for the force-close-past-maturity restart procedure: the block lists the 3–5 critical steps (fleet coordination check, drain via wrapper, restart, verify) with the canonical node-side script (`01-safe-lnd-restart.sh` / drain-wrapper) as the reference — explicitly NOT an auto-restart and NOT a full duplicated runbook that could drift from the real script.
- **D-10:** **Stuck-sweep CPFP:** `lncli wallet bumpfee` rendered with the outpoint and the `suggestedSatPerVbyte` already computed on the `remediate_pending` card, plus a `#` comment reminding the operator to sanity-check the rate against current mempool conditions before running.

### Claude's Discretion
- Exact expanded-block layout, COPY-button styling/feedback, mono formatting — driven through the binding design skills (sketch-findings-nodemonitor + frontend-design).
- `lncmd` (LDK) close syntax and capability coverage — researcher verifies; where LDK has no equivalent command, render an honest "not supported on LDK — manual procedure" state (Phase 2 D-01 honesty pattern).
- Where capacity/timelock context values come from (card evidence vs an additional sanctioned read) — planner/researcher decide honoring AFM-001/002.
- Param validation mechanics before render (zod on the already-frozen action schemas is the natural shape — schema IS the contract, Phase 4 D-02).
- Aged-funding (`aged_funding`) remediation case rendering — researcher proposes from `_library` guidance within the D-09 key-steps+pointer pattern.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** Paths relative to the project root; `../` points into the parent `ClaudeCode/` workspace.

### Project planning (in-repo)
- `.planning/REQUIREMENTS.md` — EXPORT-01 + PENDING-03 acceptance criteria (verbatim command/runbook expectations)
- `.planning/ROADMAP.md` §"Phase 5" — goal + success criteria (zero write path, context echo, strict param validation)
- `.planning/phases/04-insight-engine/04-CONTEXT.md` — card schema decisions (D-02/D-03 frozen contract, D-14 visible suppression) this phase consumes
- `.planning/phases/04-insight-engine/04-SECURITY.md` — T-04-16: suppression nulls ALL write actions incl. `remediate_pending`; exports must respect nulled actions (nothing to export on flagged nodes)

### Card contract & data (in-repo, binding)
- `src/lib/insight/schema.ts` — the FROZEN action param schemas (`close_channel`, `rebalance`, `remediate_pending`) — the ONLY param source; exports render these, never invent values
- `src/lib/insight/types.ts` — inferred types
- `src/lib/insight/engine.ts` — `loadInsightView()` both surfaces already call; export attaches to its cards
- `src/lib/insight/guardrails.ts` — `WRITE_ACTION_TYPES` (now incl. `remediate_pending`); suppressed cards carry null actions
- `src/lib/config/backends.ts` — `backendFor(pubkey)` → `lncli` vs `lncmd` command flavor
- `src/lib/format/units.ts` — AFM-002 formatter for every sat value in context comments
- `src/components/insight/InsightCardRow.tsx` + `src/components/console/ActiveSignalsPanel.tsx` — the two card surfaces the expand attaches to

### Remediation procedure sources (parent workspace — reference, not duplicated)
- `../lqwdLogs/_library/scripts/01-safe-lnd-restart.sh` — the canonical safe-restart procedure D-09 points to
- `../lqwdLogs/_library/scripts/05-fleet-coordination.sh` — fleet-coordination step referenced in the restart runbook
- `../lqwdLogs/_library/scripts/07-bump-stuck-sweeps.sh` — CPFP/bumpfee pattern PENDING-03 mirrors
- `../lqwdLogs/_library/scripts/06-close-zero-coop-pairs.sh` — existing close-command conventions worth mirroring
- `../lqwdLogs/_library/operational-anti-patterns.md` — context for why restart is export-only (AP-11)

### Design / UI (binding)
- `.claude/skills/sketch-findings-nodemonitor/SKILL.md` — NOC Light theme, mono data, no icons-for-state; expanded block must match
- `.claude/skills/frontend-design/SKILL.md` — mandatory design guidance for all UI work

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`InsightCardRow` expanded states** — the suppressed/hysteresis state lines and params rendering give the visual grammar the export block extends
- **Sweep-fold / drill-in expand pattern** (`FleetPendingBoard`) — the operator-approved inline-expand interaction D-01 mirrors
- **`ExportButton`** (`src/components/console/ExportButton.tsx`) — Phase 3 CSV export; mono-uppercase outline-button voice for the EXPORT control (copy buttons need a thin client leaf, unlike this `<a download>`)
- **`backendFor()`** — per-node lnd/ldk resolution for command flavor
- **Frozen action schemas** — zod validation for D-06 param checks comes free from the contract

### Established Patterns
- Server Components compute, thin `"use client"` leaves own interaction state (copy buttons, expand state)
- Honest unsupported/no-data states rendered visibly, never hidden (Phase 2 D-01)
- AFM-002 single formatter for sat values; no raw numbers in UI text
- Pure modules with no-DB tests; command-string builders should be pure functions testable without warehouse access

### Integration Points
- Export expand attaches to insight cards on `/inbox` (`InsightCardList`/`InsightCardRow`) and the console Active Signals panel — same component both surfaces
- Command builders consume `card.suggestedAction.params` (frozen schema) + card evidence/node fields for context comments
- Suppression already upstream: flagged nodes' cards arrive with null actions — export control simply absent

</code_context>

<specifics>
## Specific Ideas

- Operator's rebalance directive (near-verbatim): "we have a circular rebalance custom script but we also use AI to create balancing — keep in mind we may want to put a placeholder and later wire it up to a request setup with a table for our other service to read from and initiate" — bounded for this phase by D-07 (honest placeholder) with the table integration deferred (D-08).
- The copied block should be paste-ready for both a node shell AND an ops ticket — context comments are the point, not decoration (D-04).

</specifics>

<deferred>
## Deferred Ideas

- **Rebalance request table** — a `nodemon` table the external AI-balancing service polls to initiate rebalances from approved intents. A write path: belongs at/after Phase 6 where the queue DB, approval states, and HMAC substrate exist. Candidate: extend the Phase 6 queue with a `rebalance_request` action type the external service claims.
- **Generated syntax for the custom circular-rebalance script** — once the operator wants the script's invocation rendered (instead of the placeholder), add it as a command template; needs the script's name/flags.

### Reviewed Todos (not folded)
- `ui-polish-fleet-console.md` — keyword match only; Phase-3 polish debt already addressed via sketches 001–003 and gap-closure plans. Second rejection (also reviewed in Phase 4). Not export scope.

</deferred>

---

*Phase: 5-Command Export (Prong 2)*
*Context gathered: 2026-06-12*
