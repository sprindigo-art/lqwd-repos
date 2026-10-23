# Phase 5: Command Export (Prong 2) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-12
**Phase:** 5-Command Export (Prong 2)
**Areas discussed:** Export surface & copy flow, Command block anatomy, Rebalance tooling, Runbook depth

---

## Export surface & copy flow

| Option | Description | Selected |
|--------|-------------|----------|
| Inline expand on card | EXPORT control expands a command block below the row — same on /inbox and console, matches sweep-fold/drill-in patterns | ✓ |
| Modal overlay | Command in a dialog (scorecard-modal precedent) | |
| Dedicated export page | Separate page aggregating all exportable actions | |

| Option | Description | Selected |
|--------|-------------|----------|
| One COPY per command | Each runnable command/step gets its own COPY button | |
| Copy whole block | Single COPY grabs the entire block | |
| Both | Per-command COPY buttons plus copy-all for the full annotated block | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| No gate — expand is enough | Expanding is the deliberate act; command is inert text, zero write path | ✓ |
| Soft acknowledge | ACKNOWLEDGE button before command text renders | |

**Notes:** Operator wants maximum copy flexibility (both modes) but no friction gates.

---

## Command block anatomy

| Option | Description | Selected |
|--------|-------------|----------|
| Comments in copied block | Context echo travels as `#` comments inside the copy-all snippet; per-command COPY stays bare | ✓ |
| UI chrome only | Context as styled card text outside the copyable area | |

| Option | Description | Selected |
|--------|-------------|----------|
| Both UI and comments | Safety notes visible on the block AND included as `#` comments in copy-all | ✓ |
| UI only | Safety notes as dashboard chrome only | |

| Option | Description | Selected |
|--------|-------------|----------|
| Verify step first | Read-only verification command as step 1, destructive command as step 2 | ✓ |
| Comment-only echo | chan_id only in context comments, no separate verify command | |

---

## Rebalance tooling

| Option | Description | Selected |
|--------|-------------|----------|
| bos rebalance | Balance of Satoshis syntax | |
| rebalance-lnd | Python rebalance-lnd script | |
| Custom LQWD script | Fleet-specific script | |
| No tool yet — you pick | Claude picks defensible default | |

**User's choice (free text):** "we have a circular rebalance custom script but we also use ai to create balancing so keep it in mind we may want to put a placeholder and later wire it up to a request set up with a table for our other service to read from and initiate"

| Option | Description | Selected |
|--------|-------------|----------|
| Honest placeholder block | Full params in the standard commented block, explicit "rebalance execution is operator/AI-managed — no generated command yet" label | ✓ |
| Custom script syntax | Generate the circular script's invocation | |
| bos rebalance fallback | Standard bos syntax as stand-in | |

**Notes:** Request-table integration identified as a write path → deferred to Phase 6+. lncmd (LDK) close syntax flagged as researcher territory, not asked.

---

## Runbook depth

| Option | Description | Selected |
|--------|-------------|----------|
| Key steps + script pointer | 3–5 critical steps with the canonical node-side script as reference | ✓ |
| Full inline runbook | Every step spelled out (drift risk vs the real script) | |
| Pointer only | Just the script name + context | |

| Option | Description | Selected |
|--------|-------------|----------|
| Card param + current-rate note | Engine's suggestedSatPerVbyte + mempool sanity-check comment | ✓ |
| Card param only | Render the rate as-is | |

---

## Todo cross-reference

`ui-polish-fleet-console.md` matched on weak keywords (score 0.7). Operator chose **Don't fold** — Phase-3 polish debt, already addressed via sketches and gap-closure plans; second rejection (also reviewed in Phase 4).

## Claude's Discretion

- Expanded-block layout, COPY-button styling/feedback (design skills binding)
- lncmd (LDK) close syntax/capability verification; honest "not supported" fallback
- Source of capacity/timelock context values (card evidence vs additional sanctioned read)
- Param validation mechanics (zod on frozen action schemas is the natural shape)
- aged_funding remediation case rendering (researcher proposes from _library guidance)

## Deferred Ideas

- **Rebalance request table** — nodemon table the external AI-balancing service polls to initiate rebalances; write path → Phase 6+ (queue substrate)
- **Custom circular-rebalance script syntax** — render the real invocation once the operator provides the script's name/flags
