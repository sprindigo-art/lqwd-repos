# `tests/node/` — node-side executor proof harness (EXEC-02 / EXEC-03)

Deterministic proof harness for the Phase 8 node-side executor
(`scripts/node/check-queue` + `scripts/node/apply-fee`). It proves, against a
**staging / disposable** `nodemon` Postgres, that the bash executor is a faithful
port of the frozen Phase-6 queue modules (`claim.ts`, `stub-executor.ts`,
`sign.ts`, `bounds.ts`) — including all five failure modes, the bounds-violation
case, the overlapping-ticks no-double-apply guarantee, and genuine RLS
invisibility of wrong-pubkey rows.

> **STAGING DB ONLY.** Never point any harness DSN at the live `nodemon` queue
> DB. The autonomous bats suite stands up a throwaway Postgres and disposes it.

## Files

| File | Role |
|------|------|
| `seed.sql` | Inserts 6 deterministic rows (valid + 5 failure modes + bounds-violation). Run as the **admin** DSN. |
| `assert.sql` | Asserts `commands.state` + `command_audit` transitions per row. Run as the **admin** DSN (RLS-bypassing, sees all rows). |
| `hmac-vector.bats` | TS-to-bash HMAC byte-identity proof (Pitfall 1 + Pitfall 4). |
| `hmac-vector.sh` | Plain-shell sibling of `hmac-vector.bats` for hosts without `bats`. |
| `check-queue.bats` | Seeded behavioral suite: drives `check-queue` (node DSN), asserts (admin DSN), proves wrong-pubkey RLS invisibility + overlapping-ticks. |
| `lib/pg-harness.sh` | Disposable-Postgres lifecycle (docker/podman/pg_tmp) sourced by `check-queue.bats`. |
| `check-apply-fee-static.sh` | Static (no-DB) gate for `scripts/node/apply-fee`. |
| `check-check-queue-static.sh` | Static (no-DB) gate for `scripts/node/check-queue`. |

## Test runner

The `.bats` files use **bats-core** (https://github.com/bats-core/bats-core).
`bats` is an **OS / developer tool** — it is intentionally **NOT** added to
`package.json` (no `npm install`, no dependency-supply-chain surface). Install it
via your OS package manager (`brew install bats-core`, `apt install bats`, …).

On a host without `bats`, run the plain-shell sibling instead:

```bash
bash tests/node/hmac-vector.sh          # identical HMAC byte-identity proof
bash tests/node/check-apply-fee-static.sh
bash tests/node/check-check-queue-static.sh
```

## The TWO DB identities (why the EXEC-03 RLS proof needs both)

`FORCE ROW LEVEL SECURITY` is **bypassed for superusers and table owners**, so
the executor tick MUST run as the non-superuser `nodemon_node` role for RLS to
bite. The harness therefore uses two DISTINCT connections to the SAME staging
`nodemon` DB:

| Env var | Identity | Used by |
|---------|----------|---------|
| `NODEMON_TEST_ADMIN_DSN` | **privileged** owner/admin (bootstrap superuser) | `seed.sql` (it INSERTs into `commands`, which `nodemon_node` cannot) and `assert.sql` (it bypasses RLS to read all six rows and verify final state) |
| `NODEMON_TEST_NODE_DSN`  | the non-superuser **`nodemon_node`** role (the SAME role `db/role-grants.sql` creates in Plan 01) | `check-queue`'s tick and the wrong-pubkey RLS-invisibility query — so `FORCE RLS` actually scopes it |

> **`nodemon_node` MUST NOT be a superuser and MUST NOT own the queue tables**
> (Pitfall 6). `FORCE ROW LEVEL SECURITY` only enforces against non-superuser,
> non-owner roles. If `nodemon_node` owned the tables (or were a superuser), the
> pubkey scope would silently do nothing and the wrong-pubkey row would become
> visible — the proof would be hollow.

When the autonomous bats suite runs, `lib/pg-harness.sh` derives both DSNs for
you: the bootstrap `postgres` superuser is `NODEMON_TEST_ADMIN_DSN`, and it
applies the `nodemon_node` block of `db/role-grants.sql` to create
`NODEMON_TEST_NODE_DSN`. To run the SQL by hand against your own staging DB,
export both env vars first.

## The TEST HMAC secret

The seed signatures are computed under a single, documented TEST per-node secret
(NEVER a real secret, NEVER a live DSN — none appear anywhere in `tests/node/`):

```
NODEMON_HMAC_SECRET_<pubkey> = nodemon-test-secret-do-not-use-in-prod
```

i.e. the per-pubkey env-key form from `src/lib/queue/sign.ts` is
`NODEMON_HMAC_SECRET_02aaaa…aaaa`. The `apply-fee` verify resolves the secret
from `NODEMON_HMAC_SECRET` (the per-pubkey key, sourced by `check-queue` from the
root-only node env file in production). For the harness, export:

```bash
export NODEMON_HMAC_SECRET='nodemon-test-secret-do-not-use-in-prod'
```

### Regenerating `seed.sql` signatures

If the TEST secret, the param objects, or the pubkeys change, regenerate the six
`signature_hex` values with this generator (it reproduces `canonical.ts` +
`sign.ts` exactly — sorted-key canonical params, 5-field `\n` join, lowercase hex
HMAC):

```bash
node -e '
  const { createHmac } = require("node:crypto");
  const canon = v => v===null||typeof v!=="object" ? JSON.stringify(v)
    : Array.isArray(v) ? "["+v.map(canon).join(",")+"]"
    : "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canon(v[k])).join(",")+"}";
  const build = p => [p.nodePubkey,p.commandId,p.actionType,p.canonicalParams,p.expiresAt].join("\n");
  const SECRET="nodemon-test-secret-do-not-use-in-prod";
  const row=(id,pub,params,exp)=>{const cp=build({nodePubkey:pub,commandId:id,actionType:"update_fee",canonicalParams:canon(params),expiresAt:exp});
    console.log(id, createHmac("sha256",SECRET).update(cp,"utf8").digest("hex"));};
  // ...call row(...) per seed UUID with its params + expires_at...
'
```

## Run order (against a staging DB)

```bash
# 1) seed deterministic rows as the PRIVILEGED admin identity
psql -v ON_ERROR_STOP=1 "$NODEMON_TEST_ADMIN_DSN" -f tests/node/seed.sql

# 2) run the executor tick(s) as the NON-SUPERUSER nodemon_node identity
NODEMON_HMAC_SECRET='nodemon-test-secret-do-not-use-in-prod' \
  scripts/node/check-queue            # connects via the nodemon_node DSN

# 3) assert final state as the PRIVILEGED admin identity (RLS-bypassing)
psql -v ON_ERROR_STOP=1 "$NODEMON_TEST_ADMIN_DSN" -f tests/node/assert.sql
```

Or, fully autonomously (disposable Postgres, both DSNs derived for you):

```bash
bats tests/node/check-queue.bats
```

If no local Postgres mechanism (docker/podman/pg_tmp) is available, the bats
suite **skips** with an explicit message — and per the plan this makes the
wave-merge a **BLOCKING checkpoint**: a green static gate is **NOT** the same as
the five failure modes being proven. The static `.sh` gates prove SHAPE; the
seeded bats suite proves BEHAVIOR.
