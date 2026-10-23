# Phase 8: Node Scripts + Heartbeat - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 8-Node Scripts + Heartbeat
**Areas discussed:** Distribution & install, Node↔queue transport, Cadence/rate-limit/bounds, Pilot & failure-mode proof

---

## Distribution & install

### How nodes receive + run shared scripts today (the EXEC-01 pattern)
| Option | Description | Selected |
|--------|-------------|----------|
| Pull from fileserver via cron | curl/wget bootstrap on cron | |
| Push from a control host | rsync/scp/Ansible push | |
| Git pull on each node | repo checkout pulled on schedule | |
| Let me point you to it | operator provides the real files | |

**User's choice (free text):** "every node runs crons that connect to the fileserver and downloads via scp" — then pointed to `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts`.
**Notes:** Read the live pattern: `bashScriptDownloader.sh` scp's `~/bashScripts/*` → `/lnd/bashScripts/`, `chmod +x`, runs `updateCrontab.sh`; a 30-min cron re-runs the downloader (self-update). `updateCrontab.sh` merges cron lines idempotently via `grep -Fxq`. `run_liquidity_manager.sh` is the closest analog (bash wrapper + Python `psycopg2` direct DB + `lncli` creds).

### Heartbeat scheduling
| Option | Description | Selected |
|--------|-------------|----------|
| Self-installing crontab entry | scp'd installer writes/updates a dedicated idempotent cron line | ✓ |
| Piggyback existing fetch cron | existing tick also invokes check-queue | |
| Operator adds the line manually | downloader lays scripts, operator pastes cron line | |

**User's choice:** Self-installing crontab entry.
**Notes:** Implemented as a new `CRON_JOB_N` line in `updateCrontab.sh`.

### Secret / credential delivery
| Option | Description | Selected |
|--------|-------------|----------|
| Pre-placed once, out-of-band | root-only env file the scripts source; scripts carry no secrets | ✓ |
| Delivered via the same scp fileserver | secret file scp'd alongside scripts | |
| You decide later (pilot = manual) | hand-place on pilot, defer fleet design | |

**User's choice:** Pre-placed once, out-of-band.
**Notes:** Same convention as existing `/lnd/id_rsa`, `/lnd/tls.cert`, `admin.macaroon`.

### Bootstrap
| Option | Description | Selected |
|--------|-------------|----------|
| Manual one-time bootstrap, then self-update | run downloader once, 30-min cron self-updates | ✓ |
| Bootstrap rides existing fetch cron | drop into the path the existing cron pulls | |
| Manual install, no self-update | install + updates both manual | |

**User's choice:** Manual one-time bootstrap, then self-update.

---

## Node↔queue transport

### Read jobs + write results
| Option | Description | Selected |
|--------|-------------|----------|
| Direct Postgres (match house style) | per-node DB role, node runs FOR UPDATE SKIP LOCKED itself | ✓ |
| Dashboard API endpoint | node calls HTTP claim/report; dashboard does the claim | |

**User's choice:** Direct Postgres.
**Notes:** Matches `aiLiquidityManager` (psycopg2). Dashboard holds zero node creds.

### Implementation language
| Option | Description | Selected |
|--------|-------------|----------|
| Pure bash (psql + openssl + lncli) | no Python runtime; matches CLAUDE.md §4 openssl freeze | |
| Bash wrapper + Python payload | mirror aiLiquidityManager (psycopg2 + hmac) | |
| You decide | planner picks; capture both constraints | ✓ |

**User's choice:** You decide.
**Notes:** Constraints regardless: reproduce canonical HMAC byte-identically, atomic claim, argv `lncli`.

### Own-pubkey scoping
| Option | Description | Selected |
|--------|-------------|----------|
| Postgres RLS + lncli getinfo | RLS hard-limits to own pubkey; pubkey from `lncli getinfo` | ✓ |
| Role grant + WHERE filter (discipline) | script-level filter, weaker | |
| Per-node filtered view/function | SECURITY DEFINER encapsulation | |

**User's choice:** Postgres RLS + `lncli getinfo`.

### Role model
| Option | Description | Selected |
|--------|-------------|----------|
| One PG role per node | RLS via current_user → pubkey | |
| One shared node role + session pubkey | shared role, `SET app.node_pubkey` per connection | ✓ |
| You decide / planner specs both | capture requirement, planner recommends | |

**User's choice:** One shared `nodemon_node` role + session pubkey.
**Notes:** Operator volunteered to create required DB objects; confirmed no new tables needed.

---

## Cadence/rate-limit/bounds

### Heartbeat cadence
| Option | Description | Selected |
|--------|-------------|----------|
| Every 5 min (fleet default) | `*/5`, reaper ~15 min | ✓ |
| Every 1 min | tighter latency, more connections | |
| Every 15 min | lighter load, slower turnaround | |

**User's choice:** Every 5 min → `NODEMON_CLAIMED_TIMEOUT_MS = 900000`.

### Write rate-limit shape
| Option | Description | Selected |
|--------|-------------|----------|
| 1 apply/tick + N/hour cap, derived | one per tick + hourly cap from command_executions | ✓ |
| 1 apply per tick only | implicit ≤12/hr, no cap | |
| Dedicated rate-limit table | new table | |

**User's choice:** 1 apply/tick + N/hour cap, derived (no new table).

### Hourly cap (N)
| Option | Description | Selected |
|--------|-------------|----------|
| 4 per hour | generous but bounded | ✓ |
| 2 per hour | tighter | |
| 12 per hour | effectively no throttle | |

**User's choice:** 4 per hour.

### Fee bounds confirmation
| Option | Description | Selected |
|--------|-------------|----------|
| Confirm as-is | ppm 0–5000, base 0–100000, CLTV 18–2016 | ✓ |
| I'll give real values | operator provides true bounds | |
| Planner derives from fleet data | pull from lsp_fee_policy | |

**User's choice:** Confirm as-is → remove the `[ASSUMED]` flag in `bounds.ts`.

---

## Pilot & failure-mode proof

### Pilot selection / live-apply safety
| Option | Description | Selected |
|--------|-------------|----------|
| Canary node + one low-stakes channel | small fee nudge then revert | ✓ |
| Any node, throwaway fee delta | +1 ppm on a channel you don't mind | |
| You'll name it at execution time | capture requirement, pin at live gate | |

**User's choice:** Canary node + one low-stakes channel (node/channel named at the execute-phase live gate).

### Failure-mode handling + recording
| Option | Description | Selected |
|--------|-------------|----------|
| Refuse-and-record, no lncli call | flip to failed with reason + audit; never apply bad job | ✓ |
| Refuse + local log only | skip + local log, no DB write-back | |
| You decide | planner specifies transitions per mode | |

**User's choice:** Refuse-and-record, no `lncli` call (fail-closed + auditable).

### Node-side sweeps
| Option | Description | Selected |
|--------|-------------|----------|
| Node runs expire + reaper each tick | self-contained; RLS scopes to own rows | ✓ |
| Claim only; dashboard owns sweeps | minimal node logic, off-node dependency | |

**User's choice:** Node runs expire + reaper each tick.

### Failure-mode proof method
| Option | Description | Selected |
|--------|-------------|----------|
| Seeded rows in a test nodemon DB | deterministic harness, no live-channel risk | ✓ |
| All five live on the pilot | most faithful, riskier | |
| You decide | planner designs harness | |

**User's choice:** Seeded rows in a test nodemon DB (happy path still live on the canary).

---

## Claude's Discretion

- Implementation language (pure-bash vs bash+Python) for `check-queue`/`apply-fee`, with hard constraints captured (canonical HMAC byte-identical, atomic claim, argv `lncli`).
- Exact `lncli updatechanpolicy` argv form, local logging format/location under `/lnd/nodemon`, per-payload self-update mechanism (md5 vs `--version`), and the precise RLS policy SQL.

## Deferred Ideas

- LDK fee application (enqueue is LND-only; no LDK rows reach the queue).
- Fleet-wide rollout beyond one pilot node (Phase 9 hardening).
- Dedicated `node_heartbeat`/liveness table (not required; status derived from existing tables).
- Dashboard-run sweeps (rejected in favor of node-run sweeps so the pilot is self-contained).
- Queued action types beyond `update_fee` (carried from Phase 6).
