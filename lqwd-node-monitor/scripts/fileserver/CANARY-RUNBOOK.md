# CANARY-RUNBOOK — EXEC-03 live happy-path proof (operator procedure)

The one-and-only NodeMonitor procedure that touches a **real Lightning node**.
Run it on a **single operator-named low-stakes LND node + one low-importance
channel** (D-12). It proves, live, that an approved `update_fee` enqueued from
the dashboard is claimed by the node-side `check-queue`, HMAC-verified,
bounds-checked, applied via `lncli updatechanpolicy`, reported `succeeded`,
confirmed on-node, then **reverted** — and that a modified executor actually
re-pulls on the next self-update tick (D-04 / EXEC-01).

> **Blast radius is bounded by design:** one channel, a small nudge, a mandatory
> revert, and a blocking human gate. Apply only to a channel you are comfortable
> nudging by a few ppm/msat.

## Conventions used below

Fill these in at the gate — they are **placeholders, never hardcoded**:

| Placeholder | Meaning |
|-------------|---------|
| `<CANARY_NODE>` | the low-stakes LND node you are proving on (ssh target / host) |
| `<PUBKEY>` | that node's `identity_pubkey` (from `lncli getinfo`) |
| `<CHAN_ID>` | the low-importance channel's `chan_id` (numeric short channel id) |
| `<CHAN_POINT>` | that channel's `funding_txid:output_index` |
| `<NEW_PPM>` / `<NEW_BASE_MSAT>` | the small nudged fee values (well inside D-11 bounds: ppm 0–5000, base 0–100000 msat, CLTV 18–2016) |

LND auth flags below are written `--tlscertpath`/`--macaroonpath` as
**[ASSUMED]** (RESEARCH A1); **CONFIRM-BUILD step 2 settles the exact spelling**
before any live apply.

---

## 1. PRE-FLIGHT — one-time bootstrap (D-04, D-03, D-07)

Do this once on `<CANARY_NODE>`. After this, the existing ~30-min downloader
cron and the `*/5` `run_check-queue.sh` runner keep everything current
(D-04 self-update).

**1a. Create the executor role + RLS on the nodemon DB (Plan 01).**
Run the `nodemon_node` role + Row-Level-Security section of `db/role-grants.sql`
against the `nodemon` queue DB as a DB owner/superuser (NOT as `nodemon_node`):

```bash
# from the dashboard host / a psql box that can reach the nodemon DB
psql "postgres://<owner>@<nodemon-host>:5432/nodemon" -f db/role-grants.sql
# Replace <generated-strong-password> in role-grants.sql with an operator secret
# FIRST; it goes ONLY into the node's root-only env file (step 1b), never source.
```

Then run the verification query at the bottom of `db/role-grants.sql` and
confirm `nodemon_node` shows **SELECT/UPDATE/INSERT only** — any DELETE/TRUNCATE
row is a misconfiguration. Separately confirm `nodemon_node` does **not** own
the three queue tables (Pitfall 6 — owner bypasses RLS).

**1b. Pre-place the root-only secret env file `.nodemon.env` (D-03).**
Out-of-band (provisioning / scp by hand as root), place the per-node secret +
DB DSN on the canary. The executors `source` this file; it is **NEVER** carried
in the scp distribution channel.

```bash
# ON <CANARY_NODE>, as root — create /lnd/nodemon/.nodemon.env
sudo install -m 600 -o root -g root /dev/null /lnd/nodemon/.nodemon.env
sudo tee /lnd/nodemon/.nodemon.env >/dev/null <<'ENV'
NODEMON_HMAC_SECRET_<PUBKEY>=<per-node-hmac-secret-frozen-in-phase-6>
NODEMON_NODE_DSN=postgres://nodemon_node:<generated-strong-password>@<nodemon-host>:5432/nodemon
NODEMON_CLAIMED_TIMEOUT_MS=900000   # 15 min reaper window (D-09, 3x the */5 tick)
ENV
sudo chmod 600 /lnd/nodemon/.nodemon.env   # root-only, same convention as /lnd/id_rsa
```

Confirm: `sudo ls -l /lnd/nodemon/.nodemon.env` shows `-rw------- root root`.

**1c. Copy the scripts to the fileserver.**
Put the version-controlled copies onto the fileserver in the two established
folders (README "Deploy layout"):

```bash
# from this repo root, to the fileserver (use the fleet REMOTE_* values)
scp -P <REMOTE_PORT> -i /lnd/id_rsa \
  scripts/node/check-queue scripts/node/apply-fee \
  <REMOTE_USER>@<REMOTE_SERVER>:~/nodemon/
scp -P <REMOTE_PORT> -i /lnd/id_rsa \
  scripts/fileserver/run_check-queue.sh scripts/fileserver/nodemonDownload.sh \
  <REMOTE_USER>@<REMOTE_SERVER>:~/bashScripts/
```

**1d. Splice `CRON_JOB_11` into the live `updateCrontab.sh`.**
On the fileserver, paste the two pieces from
`scripts/fileserver/updateCrontab.snippet.sh` into the live `updateCrontab.sh`:
piece (a) the `CRON_JOB_11` constant after `CRON_JOB_10`; piece (b) the
`grep -Fxq` merge block before the final `crontab "${TEMP_CRON_FILE}"` load.
The resulting line is:

```
*/5 * * * * /lnd/bashScripts/run_check-queue.sh >> /lnd/nodemon/check-queue.log 2>&1
```

`grep -Fxq` makes the merge idempotent (re-running never duplicates the line).

**1e. Run the downloader once by hand on the canary (D-04).**
This is the one-time manual bootstrap; from here the cron self-updates.

```bash
# ON <CANARY_NODE>
sudo /lnd/bashScripts/nodemonDownload.sh     # pulls ~/nodemon/* -> /lnd/nodemon, chmod +x
/lnd/bashScripts/updateCrontab.sh            # merges the */5 CRON_JOB_11 line
crontab -l | grep run_check-queue            # confirm the */5 line is present exactly once
ls -l /lnd/nodemon/check-queue /lnd/nodemon/apply-fee   # both present + executable
```

**Pre-flight DONE when:** role+RLS run and verified, `.nodemon.env` is
root-only on the canary, both executors are executable under `/lnd/nodemon`,
and the `*/5` crontab line is present exactly once.

---

## 2. CONFIRM-BUILD — resolve A1/A2 on the pilot LND build

Settle the two MEDIUM open questions BEFORE any live apply.

**2a. Confirm the exact global-flag spelling (A1).**

```bash
# ON <CANARY_NODE>
lncli updatechanpolicy --help
lncli --help | grep -E 'tls|macaroon'
```

Record whether the build wants `--tlscertpath`/`--macaroonpath` (the [ASSUMED]
form in `apply-fee`) or `--tls-cert`/`--macaroon`. Note it in step 5.

**2b. Capture the FULL before-policy, including inbound-fee fields (A2 / lnd#8614).**

```bash
# ON <CANARY_NODE> — capture EVERYTHING; you will diff this after apply + after revert
lncli getchaninfo <CHAN_ID> | tee /tmp/canary-before.json
```

From `/tmp/canary-before.json` record, for **this node's side** of the channel:
`base_fee_msat`, `fee_rate_milli_msat` (a.k.a. `fee_rate_ppm`/`fee_rate`),
`time_lock_delta`, **and** the inbound-fee fields
(`inbound_fee_base_msat`, `inbound_fee_rate_milli_msat`). These are the
original values you will restore in REVERT, and the inbound-fee baseline for the
lnd#8614 before/after check.

**Confirm-build DONE when:** the flag spelling is recorded and the full
before-policy (outbound + inbound fee fields) is captured to
`/tmp/canary-before.json`.

---

## 3. LIVE-APPLY — enqueue → approve → tick → confirm on-node

**3a. Enqueue a SMALL `update_fee` from the dashboard.**
In the dashboard, open the recommendation card / `/inbox` for `<CANARY_NODE>`'s
`<CHAN_ID>`, set a **small** nudge (`<NEW_PPM>` / `<NEW_BASE_MSAT>`, comfortably
inside the D-11 bounds), and enqueue it. The dashboard signs the row
(`canonical_payload` + `signature_hex`).

**3b. Approve it in `/queue`.**
Open `/queue`, find the new `pending_approval` row for `<CHAN_ID>`, and approve
it. State flips to `approved`.

**3c. Let one `*/5` tick run (or run the runner by hand).**

```bash
# ON <CANARY_NODE> — either wait for the next */5 cron, or force a tick now:
/lnd/bashScripts/run_check-queue.sh
tail -n 40 /lnd/nodemon/check-queue.log     # expect: claim -> verify -> apply -> succeeded
```

**3d. Confirm `succeeded` in the dashboard.**
In `/queue` (and the `QueueTimeline`), confirm the row reached `succeeded` with
a `command_executions` row and the `approved → claimed → executing → succeeded`
`command_audit` transitions.

**3e. Confirm the new policy is LIVE on-node + inbound fees UNCHANGED (A2).**

```bash
# ON <CANARY_NODE>
lncli getchaninfo <CHAN_ID> | tee /tmp/canary-after.json
diff <(jq -S . /tmp/canary-before.json) <(jq -S . /tmp/canary-after.json)
```

Confirm: this node's `base_fee_msat` / `fee_rate` now match `<NEW_BASE_MSAT>` /
`<NEW_PPM>`, **and** the inbound-fee fields are **identical** to
`/tmp/canary-before.json`. If inbound-fee fields changed, the pilot build
exhibits lnd#8614 — record it for step 5 (apply-fee must then pass inbound fees
through explicitly).

**Live-apply DONE when:** the dashboard shows `succeeded` and on-node
`getchaninfo` shows the new outbound policy with inbound-fee fields unchanged.

---

## 4. REVERT — restore the original policy (D-12)

Undo the nudge so the canary is left exactly as found.

**4a. Enqueue + approve a second `update_fee` restoring the captured originals.**
From the dashboard, enqueue an `update_fee` on `<CHAN_ID>` using the ORIGINAL
values recorded in step 2b (the `base_fee_msat` / `fee_rate_ppm` /
`time_lock_delta` from `/tmp/canary-before.json`); approve it in `/queue`.

**4b. Tick + confirm reverted on-node.**

```bash
# ON <CANARY_NODE>
/lnd/bashScripts/run_check-queue.sh
lncli getchaninfo <CHAN_ID> | tee /tmp/canary-reverted.json
diff <(jq -S . /tmp/canary-before.json) <(jq -S . /tmp/canary-reverted.json)
```

**Revert DONE when:** the `diff` is empty (or only the expected
`last_update`/timestamp differs) — the channel policy matches the original
before-state.

---

## 5. RECORD — fold A1/A2 findings back into `apply-fee`

Write down the confirmed facts so the executor can be corrected if reality
differs from the `[ASSUMED]` markers:

- **Flag spelling (A1):** record the confirmed global auth flags. If the build
  uses `--tls-cert`/`--macaroon` instead of the `[ASSUMED]`
  `--tlscertpath`/`--macaroonpath`, update `apply-fee`'s argv accordingly and
  re-deploy via the self-update rail.
- **Inbound-fee behavior (A2 / lnd#8614):** record whether the pilot build left
  inbound-fee fields unchanged. If it **reset** them, fold the inbound-fee
  passthrough into `apply-fee`'s argv per **Plan-02 Task 2(d)** (pass
  `--inbound_base_fee_msat` / `--inbound_fee_rate_ppm` from the captured policy).
- **Capture for the SUMMARY:** named `<CANARY_NODE>` + `<PUBKEY>`, `<CHAN_ID>` /
  `<CHAN_POINT>`, the apply→revert outcome, the confirmed flag spelling, and the
  inbound-fee note.

**Record DONE when:** the flag spelling + inbound-fee behavior are written into
the plan SUMMARY and any required `apply-fee` correction is filed.

---

## 6. SELF-UPDATE-CHECK — behavioral D-04 / EXEC-01 confirmation

Prove the executor **actually re-pulls on change** (not just that `md5sum`
appears in `run_check-queue.sh` source). One-time, reversible.

**6a. Record the current on-node md5 + make a trivial SOURCE-side marker change.**

```bash
# ON <CANARY_NODE> — note the current hash
md5sum /lnd/nodemon/check-queue

# ON THE FILESERVER — append a trivial, reversible comment to the SOURCE copy so
# its md5 differs (a no-op comment line; nothing behavioral):
echo "# self-update marker $(date +%s)" >> ~/nodemon/check-queue
md5sum ~/nodemon/check-queue     # note the NEW source hash
```

**6b. Run one tick (or wait for `*/5`) and confirm the re-pull.**

```bash
# ON <CANARY_NODE>
/lnd/bashScripts/run_check-queue.sh
md5sum /lnd/nodemon/check-queue          # MUST now equal the NEW source hash from 6a
ls -lt /lnd/nodemon/old-scripts/         # the PRIOR copy was backed up here before scp
grep -n 'self-update marker' /lnd/nodemon/check-queue   # the marker is now present on-node
```

**6c. Revert the marker.**

```bash
# ON THE FILESERVER — remove the marker line from the source
sed -i '/# self-update marker/d' ~/nodemon/check-queue
# ON <CANARY_NODE> — let one more tick re-pull the clean copy
/lnd/bashScripts/run_check-queue.sh
grep -c 'self-update marker' /lnd/nodemon/check-queue   # expect 0
```

**Self-update-check DONE when:** after the marker change, on-node
`md5sum /lnd/nodemon/check-queue` matched the modified source, the prior copy
was backed up under `/lnd/nodemon/old-scripts/`, and the marker was cleanly
reverted on the next tick. This is the behavioral EXEC-01 "updates" proof of the
D-04 md5 self-update that the Plan-02/03 static greps only assert statically.

---

## PASS criteria (the gate)

The live gate **PASSES** when ALL hold on the operator-named canary + channel:

1. The approved `update_fee` applied and reported **`succeeded`** (dashboard +
   `command_executions`/`command_audit` rows).
2. The new fee policy was **visible on-node** via `lncli getchaninfo` and the
   inbound-fee fields were **unchanged** (A2).
3. The **revert** restored the original policy on-node (D-12).
4. The confirmed **flag spelling** + **inbound-fee behavior** were recorded
   (A1/A2 closed).
5. A modified `check-queue` **re-pulled** on the next self-update tick and the
   prior copy was backed up (D-04 / EXEC-01).

Referenced artifacts: `db/role-grants.sql` (Plan 01), `/lnd/nodemon/.nodemon.env`
(D-03), `run_check-queue.sh` (Plan 03 md5 self-update), `nodemonDownload.sh`,
`updateCrontab.snippet.sh`.

---
---

# TELEMETRY (Phase 11) — live canary ingest proof (operator procedure)

The second live procedure on the canary. Where EXEC-03 (above) proved the
**write** rail (signed `update_fee` → on-node apply → revert), this section proves
the **read** rail: real host/service/bitcoind signals land in the `nodemon` fact
tables on a `*/5` collector tick and read back **honestly** through the three read
helpers — including a deliberately-stopped service reading **not-functioning** and
the cron-disabled `rebalance` reading **no-data, never DOWN** (TEL-01/02/03, D-16).

> **Read-only blast radius:** the telemetry path never mutates the node. The
> collector role (`nodemon_telemetry`) is SELECT/INSERT/DELETE-on-own-rows only,
> RLS-boxed to this host's `host_id`. The only writes are appended observation
> rows + the in-collector 21-day prune. No HMAC, no fee changes, no `lncli`
> mutations — RLS + least-privilege ARE the integrity boundary (D-11).

## Conventions used below

Fill these in at the gate — they are **placeholders, never hardcoded**. Each is a
live-host fact resolved by the CONFIRM-AGAINST-HOST step (T2), not a repo constant.

| Placeholder | Meaning | Resolves |
|-------------|---------|----------|
| `<CANARY_HOST_ID>` | the canary's stable host key — recommend `hostname -f` | OQ-6 |
| `<CANARY_PUBKEY>` | the canary node's `lncli getinfo` → `identity_pubkey` | OQ-6 |
| `<NODEMON_OWNER>` | the `nodemon` DB owner/superuser DSN (has DDL — the DSN that can run the migration; the app's `nodemon_rw` DSN does **not** have DDL) | bootstrap |
| `<NODEMON_HOST>` | the **remote prod** `nodemon` DB host:port (the only available DSN) | bootstrap |
| `<BITCOIND_RPCHOST>` | bitcoind JSON-RPC `host:port` (fleet uses a remote host, NOT `127.0.0.1:8332` — Pitfall 6) | OQ-5 |
| `<ESPLORA_TIP_URL>` | full URL to esplora `…/blocks/tip/height` (leave UNSET → honest no-data) | OQ-4 |
| `<PG_PROBE_CONNINFO>` | read-only conninfo for the postgres functioning probe | OQ-3 |

> **D-18 ordering is the load-bearing rule of this section:** dimensions
> (`hosts` + `service_inventory`) and the `nodemon_telemetry` role+RLS MUST exist
> **before** the collector's first tick. The collector connects as
> `nodemon_telemetry` (SELECT/INSERT on facts, SELECT-only on dimensions under
> FORCE RLS) — it physically **cannot** seed a dimension row. Seed out-of-band as
> owner first, enable `CRON_JOB_12` last.

---

## T1. TELEMETRY-BOOTSTRAP — schema → role+RLS → seed, as owner, BEFORE the tick

Run T1a→T1c once, **as the `nodemon` DB owner/superuser** (NOT as
`nodemon_telemetry`, NOT as the app's `nodemon_rw`), against the **remote prod
`nodemon` DB** — that is the only available DSN, and `nodemon_rw` lacks DDL. This
ordering is D-18.

**T1a. Apply the telemetry migration FIRST (DDL — owner only).**
The Plan-01 telemetry tables migration (`drizzle/nodemon/0001_telemetry_tables.sql`)
was **not** applied live — its apply is deferred to you here. It creates the four
fact tables + two dimensions the rest of this section depends on. The app's
`nodemon_rw` DSN cannot run it (no DDL); use the owner DSN.

```bash
# from a psql box that can reach the REMOTE PROD nodemon DB, as DB owner/superuser
psql "<NODEMON_OWNER>" -f drizzle/nodemon/0001_telemetry_tables.sql
# Confirm the six telemetry relations now exist:
psql "<NODEMON_OWNER>" -c "\dt host_metrics|host_storage|service_health|chain_telemetry|hosts|service_inventory"
```

> Do NOT run `drizzle-kit generate`/`migrate`/`push` against this DB to do this —
> the migration is hand-applied by the owner (the warehouses/queue DB are not
> Drizzle-managed at deploy time here). Apply the SQL file verbatim.

**T1b. Apply the `nodemon_telemetry` role + RLS block (owner only).**
Run ONLY the `nodemon_telemetry` block of `db/role-grants.sql` (the third block,
starting at the `nodemon_telemetry` banner) against the same `nodemon` DB as owner.
Generate a strong password FIRST and substitute `<generated-strong-password>`; it
goes ONLY into the root-only env file (T3), never into source.

```bash
psql "<NODEMON_OWNER>" -f db/role-grants.sql   # or paste only the nodemon_telemetry block
```

Then run the verification query at the bottom of that block and confirm
`nodemon_telemetry` shows **SELECT/INSERT/DELETE only** on the four fact tables and
**SELECT only** on `hosts`/`service_inventory` — any UPDATE/TRUNCATE row is a
misconfiguration. Separately confirm `nodemon_telemetry` does **NOT** own the fact
tables (Pitfall 4 — owner bypasses FORCE RLS).

**T1c. Seed the dimensions with substituted live values (owner only).**
Substitute `<CANARY_HOST_ID>` / `<CANARY_PUBKEY>` in `db/seed-dimensions.sql` with
the values confirmed in T2 (OQ-6), then apply as owner:

```bash
psql "<NODEMON_OWNER>" -f db/seed-dimensions.sql
```

The seed's own verification query must list **10 service rows: 8 `is_expected = t`
+ exactly two (`esplora`, `rebalance`) `is_expected = f`** (D-17 / Pitfall 5;
esplora runs centrally per OQ-2, rebalance cron is disabled). Confirm the `hosts`
row carries `<CANARY_HOST_ID>` with `<CANARY_PUBKEY>` in `node_pubkeys`.

**Bootstrap DONE when:** the four fact tables + two dimensions exist on the remote
prod `nodemon` DB, the `nodemon_telemetry` role verifies SELECT/INSERT/DELETE-only
(+ SELECT-only dimensions) and does not own the tables, and the 8-expected +
2-not-expected service set is seeded — **all before `CRON_JOB_12` is enabled.**

---

## T2. CONFIRM-AGAINST-HOST — resolve OQ-2..OQ-6 on the live machine

Settle the five live-host topology facts BEFORE the env file (T3) and before the
first tick. **Capture the real values; do not hardcode.** Record each in the
SUMMARY (T7).

**T2-OQ6 — `host_id` + node pubkey (the RLS axes).**

```bash
# ON <CANARY_NODE>
hostname -f                       # → <CANARY_HOST_ID> (the recommended stable key)
lncli getinfo | jq -r .identity_pubkey   # → <CANARY_PUBKEY>
```

These are the values you substituted into the seed (T1c). If you choose a host key
other than `hostname -f`, you MUST set `NODEMON_HOST_ID` in the env (T3) to the same
string you seeded — the collector's `resolve_host_id()` defaults to `hostname()`.

**T2-OQ2 — infra trio: systemd vs docker/tmux.**

```bash
# ON <CANARY_NODE> — confirm how bitcoind / postgres / esplora are managed
systemctl is-active bitcoind postgresql 2>/dev/null
docker ps --format '{{.Names}}' 2>/dev/null    # if any infra runs in docker instead
```

Record the real unit/container names. The seed's `service_inventory.running_target`
for the infra trio is `systemctl is-active …` / `pg_isready` / `GET /blocks/tip/height`
([ASSUMED] systemd); if any is docker/tmux, note it for a follow-up seed correction.

**T2-OQ3 — postgres functioning probe target + read-only cred.**
Identify the host:port the canary should probe and a **read-only** conninfo for it
(never a write cred — reusing a write cred is a security regression). This becomes
`PG_PROBE_CONNINFO` in T3. Unset → the probe reads honest no-data.

**T2-OQ4 — esplora endpoint.**
Determine whether esplora runs on/for the canary and its
`…/blocks/tip/height` URL. There is **no esplora ref in the fleet tree** — if it
does not exist, **leave `ESPLORA_TIP_URL` unset**; the collector reads honest
no-data (never a false DOWN). Record the decision.

**T2-OQ5 — bitcoind RPC reachability (`bitcoin-cli` vs raw curl).**
The collector uses raw JSON-RPC over `BITCOIND_RPCHOST` (it does not require the
`bitcoin-cli` binary). Confirm the RPC host:port + that the rpcuser/rpcpass
authenticate:

```bash
# ON <CANARY_NODE> — confirm RPC reachability with the creds you will place in T3
curl -s --user "<BITCOIND_RPCUSER>:<BITCOIND_RPCPASS>" \
  --data-binary '{"jsonrpc":"1.0","id":"probe","method":"getblockchaininfo","params":[]}' \
  -H 'content-type: text/plain;' "http://<BITCOIND_RPCHOST>/" | jq '{blocks,headers,verificationprogress}'
```

Expect `blocks ≈ headers` and `verificationprogress ≈ 1.0`. Record the confirmed
`<BITCOIND_RPCHOST>`.

**Confirm DONE when:** `<CANARY_HOST_ID>`, `<CANARY_PUBKEY>`, the infra-trio
management style (OQ-2), `PG_PROBE_CONNINFO` (OQ-3), the esplora decision (OQ-4),
and the reachable `<BITCOIND_RPCHOST>` (OQ-5) are all captured from the live host.

---

## T3. TELEMETRY-ENV — extend the root-only env file (creds NEVER in source)

Extend the existing root-only `/lnd/nodemon/.nodemon.env` (the same file EXEC-03
uses for the HMAC secret + `nodemon_node` DSN) with the telemetry values. The
collector wrapper `source`s this file at runtime; it is **NEVER** carried in the scp
distribution channel (D-03 / Pitfall 3). No telemetry secret may appear in
`collect_telemetry.py` or any shipped artifact.

```bash
# ON <CANARY_NODE>, as root — APPEND to /lnd/nodemon/.nodemon.env (do not clobber EXEC-03 lines)
sudo tee -a /lnd/nodemon/.nodemon.env >/dev/null <<'ENV'
# ── Phase-11 telemetry (collect_telemetry.py reads these from the environment) ──
NODEMON_TELEMETRY_DSN=postgres://nodemon_telemetry:<generated-strong-password>@<NODEMON_HOST>:5432/nodemon
BITCOIND_RPCHOST=<BITCOIND_RPCHOST>      # host:port — NEVER assume 127.0.0.1:8332 (Pitfall 6)
BITCOIND_RPCUSER=<bitcoind-rpcuser>
BITCOIND_RPCPASS=<bitcoind-rpcpass>
PG_PROBE_CONNINFO=<PG_PROBE_CONNINFO>    # read-only probe conninfo (OQ-3); unset → honest no-data
ESPLORA_TIP_URL=<ESPLORA_TIP_URL>        # full …/blocks/tip/height URL (OQ-4); OMIT this line if no esplora
# NODEMON_HOST_ID=<CANARY_HOST_ID>       # set ONLY if host_id != `hostname` (must match the seed)
ENV
sudo chmod 600 /lnd/nodemon/.nodemon.env
```

Confirm: `sudo ls -l /lnd/nodemon/.nodemon.env` shows `-rw------- root root`, and
`sudo grep -c TELEMETRY_DSN /lnd/nodemon/.nodemon.env` returns `1`.

**Env DONE when:** the telemetry DSN + bitcoind RPC creds + (optional) pg/esplora
targets are present in the root-only env file, the file is `0600 root:root`, and a
grep confirms **no** telemetry secret leaked into source or the scp payload.

---

## T4. DISTRIBUTE + ENABLE — payload to fileserver, splice `CRON_JOB_12`

Mirror the EXEC-03 PRE-FLIGHT distribution, for the telemetry payload + cron line.

**T4a. Put the collector payload on the fileserver.**

```bash
# from this repo root, to the fileserver (use the fleet REMOTE_* values)
scp -P <REMOTE_PORT> -i /lnd/id_rsa \
  scripts/fileserver/collect_telemetry.py scripts/fileserver/requirements.txt \
  <REMOTE_USER>@<REMOTE_SERVER>:~/nodemon/
scp -P <REMOTE_PORT> -i /lnd/id_rsa \
  scripts/fileserver/run_collect-telemetry.sh \
  <REMOTE_USER>@<REMOTE_SERVER>:~/bashScripts/
```

**T4b. Splice `CRON_JOB_12` into the live `updateCrontab.sh` (LAST — after T1–T3).**
On the fileserver, paste pieces (c) + (d) from
`scripts/fileserver/updateCrontab.snippet.sh` into the live `updateCrontab.sh`:
piece (c) the `CRON_JOB_12` constant after `CRON_JOB_11`; piece (d) the `grep -Fxq`
merge block before the final `crontab "${TEMP_CRON_FILE}"` load. The resulting line:

```
*/5 * * * * /lnd/bashScripts/run_collect-telemetry.sh >> /lnd/nodemon/collect-telemetry.log 2>&1
```

`grep -Fxq` makes the merge idempotent. **Only enable this after T1–T3 are
verified** (D-18) — the collector must never tick before its dimensions + role exist.

**T4c. Pull the payload onto the canary once by hand.**

```bash
# ON <CANARY_NODE>
sudo /lnd/bashScripts/nodemonDownload.sh   # pulls ~/nodemon/* -> /lnd/nodemon
/lnd/bashScripts/updateCrontab.sh          # merges the */5 CRON_JOB_12 line
crontab -l | grep run_collect-telemetry    # confirm the */5 line is present exactly once
ls -l /lnd/nodemon/collect_telemetry.py /lnd/nodemon/requirements.txt
```

**Distribute DONE when:** the payload is under `/lnd/nodemon`, the `*/5`
`CRON_JOB_12` line is present exactly once, and T1–T3 were all completed first.

---

## T5. FORCE A TICK — run the collector once, tail the log

```bash
# ON <CANARY_NODE> — either wait for the next */5 cron, or force one tick now:
/lnd/bashScripts/run_collect-telemetry.sh
tail -n 60 /lnd/nodemon/collect-telemetry.log
```

Expect the wrapper to: acquire the flock, self-update the payload via md5, build
the `.venv-telemetry` + install `psycopg2`/`dotenv` on first run, source the env
file, then log `telemetry collection completed successfully`. A
`WARNING: …/.nodemon.env not found` or a non-zero exit means the env (T3) or DSN is
wrong — fix before proceeding.

**Force-tick DONE when:** the log shows `telemetry collection completed
successfully` for one tick.

---

## T6. QUERY — rows landed + read helpers return latest-per-entity + staleness

**T6a. Confirm fresh rows in all four fact tables (against the nodemon DB).**

```bash
# read-side check (any read-capable nodemon DSN); host-scoped to the canary
psql "<NODEMON_OWNER>" -v hid="<CANARY_HOST_ID>" <<'SQL'
SELECT 'host_metrics'    AS t, count(*), max(collected_at) FROM host_metrics    WHERE host_id = :'hid'
UNION ALL SELECT 'host_storage',    count(*), max(collected_at) FROM host_storage    WHERE host_id = :'hid'
UNION ALL SELECT 'service_health',  count(*), max(collected_at) FROM service_health  WHERE host_id = :'hid'
UNION ALL SELECT 'chain_telemetry', count(*), max(collected_at) FROM chain_telemetry WHERE host_id = :'hid';
SQL
```

Expect a non-zero count with a `max(collected_at)` within the last few minutes in
**all four** tables.

**T6b. Confirm the three read helpers read latest-per-entity + derived staleness.**
In the dashboard (or a node REPL against the read layer), confirm:

- `getLatestHostMetrics()` → one latest row per host (DISTINCT ON `host_id`,
  `ORDER BY collected_at DESC`) with `deriveStale(collected_at)` **false** right
  after a fresh tick (and **true** if you wait past the collector window).
- `getServiceHealth("<CANARY_HOST_ID>")` → one state per graded service, each with a
  running + functioning axis derived against the per-service
  `expected_interval_seconds` (NOT the 15-min collector clock — Pitfall 1).
- `getChainTelemetry()` → the latest chain row with `deriveBlocksBehind` /
  `buildChainEvidence` reflecting `blocks` vs `headers` from the live RPC.

**Query DONE when:** all four fact tables show fresh host-scoped rows AND the three
read helpers return latest-per-entity values with correct derived staleness.

---

## T7. HONEST-STALE PROOF — stopped service not-functioning; rebalance no-data

The integrity test (T-11-19): a dead/stale signal must NEVER read green.

**T7a. Stop one graded service and re-tick.**

```bash
# ON <CANARY_NODE> — stop ONE low-stakes graded service (e.g. a persistent Go proc
# detected by pgrep, or stall a cron-mtime artifact past its expected_interval).
sudo systemctl stop <one-graded-service>   # or stop the pgrep'd proc / freeze its log mtime
/lnd/bashScripts/run_collect-telemetry.sh   # force a tick that observes the stopped service
```

Then re-read `getServiceHealth("<CANARY_HOST_ID>")` and confirm the stopped service
reads **RUNNING = false** (pgrep miss) or **FUNCTIONING = false** (heartbeat past its
`expected_interval_seconds`) — **unmistakably not green**.

**T7b. Confirm `rebalance` reads no-data, not DOWN.**
In the same read, confirm the `rebalance` service (one of the two `is_expected =
false` seed rows — cron disabled on the live fleet; `esplora` is the other, runs
centrally) reads **no-data / not-applicable**, NOT
DOWN (Pitfall 5 / SC#4). A declared-but-not-expected service going red would be a
false alarm.

**T7c. Restore the stopped service (leave the canary as found).**

```bash
# ON <CANARY_NODE>
sudo systemctl start <one-graded-service>   # or restart the proc / let its cron resume
/lnd/bashScripts/run_collect-telemetry.sh    # one more tick to read it green again
```

**Honest-stale DONE when:** the deliberately-stopped service read not-functioning,
`rebalance` read no-data (never DOWN), and the service was restored to green.

---

## TELEMETRY PASS criteria (the gate)

The telemetry gate **PASSES** when ALL hold on the canary (TEL-01/02/03, D-16):

1. **Bootstrap ordering (D-18):** the migration + `nodemon_telemetry` role/RLS +
   dimension seed were applied as owner on the remote prod `nodemon` DB **before**
   `CRON_JOB_12` was enabled; the seed verifies 9-expected + 1-not-expected.
2. **Creds isolated (T-11-18):** the telemetry DSN + bitcoind/pg/esplora values live
   only in the `0600 root:root` env file; **no** secret in source or the scp payload.
3. **Rows land (TEL-01/02/03):** a `*/5` tick produced fresh host-scoped rows in
   **all four** fact tables (`host_metrics`, `host_storage`, `service_health`,
   `chain_telemetry`).
4. **Read helpers honest:** `getLatestHostMetrics` / `getServiceHealth` /
   `getChainTelemetry` return latest-per-entity with correct **derived** staleness.
5. **Honest stale/no-data (T-11-19 / SC#4):** a deliberately-stopped service read
   **not-functioning** (never green) and `rebalance` read **no-data, never DOWN**.
6. **OQ-2..OQ-6 recorded:** the live host facts (host_id, infra-trio management,
   pg target, esplora decision, bitcoind RPC host) are written into the SUMMARY.

Referenced artifacts: `drizzle/nodemon/0001_telemetry_tables.sql` (Plan 01 schema),
`db/role-grants.sql` `nodemon_telemetry` block (Plan 02), `db/seed-dimensions.sql`
(Plan 02 / D-18), `src/lib/read/host-metrics.ts` / `service-health.ts` /
`chain-telemetry.ts` (Plans 04-05 read helpers), `collect_telemetry.py` +
`run_collect-telemetry.sh` + `updateCrontab.snippet.sh` pieces (c)/(d) (Plan 06),
`/lnd/nodemon/.nodemon.env` (D-03).

---
---

# DATA-COLLECTION EXPANSION (Phase 15) — logs + deep-VM + pg_health canary proof

The third live procedure on the canary. Where TELEMETRY (Phase 11, above) proved
the **four base fact tables** land honest host/service/chain signals, this section
proves the **expanded** collector: real **service log events** (with signature
aggregation + secret redaction), **deep-VM metrics** (per-core CPU, per-device
disk I/O, per-iface net counters, extended host vitals + storage inodes), and
**pg_health** rows land in the eight NEW `nodemon` tables on a `*/5` tick and read
back **honestly** through the new DISTINCT-ON readers — with **read-time bands
only** (nothing stored), **benign read-time suppression**, and the deterministic
AP-12a/b advisory reading live `pg_health` (no LLM). Requirements COL-01/02/03.

> **Read-only blast radius (unchanged from Phase 11):** the expanded collector is
> still SELECT/INSERT/DELETE-on-own-rows only, RLS-boxed to this host's `host_id`,
> under the same `nodemon_telemetry` role. The **only** new privilege is a single
> scoped `UPDATE` on `log_patterns` (the signature-aggregate upsert, D-03 /
> T-15-03). No UPDATE/TRUNCATE on any raw fact; no HMAC, no `lncli` mutation. RLS +
> least-privilege remain the integrity boundary. `CRON_JOB_12` is **unchanged** —
> the expanded `collect_telemetry.py` rides the existing `*/5` telemetry tick.

## Conventions used below

Reuse the Phase-11 placeholders (`<NODEMON_OWNER>`, `<NODEMON_HOST>`,
`<CANARY_HOST_ID>`, `<CANARY_PUBKEY>`, `<PG_PROBE_CONNINFO>`). Two new preconditions
are named here:

| Precondition | Meaning | Resolves |
|--------------|---------|----------|
| **A1** | `PG_PROBE_CONNINFO` (Phase-11 pg probe cred) can `SELECT` from `pg_stat_activity` / `pg_stat_database` — the source of the pg_health counters (T-15-09 least-privilege read-only). | OQ-3 reuse |
| **A3** | A `postgres` `service_inventory` row with a **readable** `artifact_path` (+ `error_pattern`) exists on the canary, so PG log lines are tailed into `service_log_events`. Seed via `db/seed-dimensions.sql` if absent. | Phase-15 |

> **D-18 ordering still governs** — the 8 new tables + the `log_patterns` UPDATE
> grant + the pattern seed MUST exist **before** the first expanded tick. The
> collector connects as `nodemon_telemetry` under FORCE RLS and physically cannot
> create a table, grant itself UPDATE, or seed a config row. Apply owner-side first.

---

## P15-1. EXPANSION-BOOTSTRAP — migration → grants delta → pattern seed, as owner

Run P15-1a→P15-1c once, **as the `nodemon` DB owner/superuser** (NOT
`nodemon_telemetry`, NOT `nodemon_rw` — which lacks CREATE on schema `public`),
against the **remote prod `nodemon` DB**, **IN THIS ORDER** (D-18).

> **Status: NOT YET APPLIED.** As of Plan 15-09, migration `0003` has **not** been
> applied to the live nodemon DB — the file is generated, committed, and verified
> additive-only (Plan 15-01), but the live apply is this operator step. The
> deferred-canary gate (Tasks 1 & 2 of Plan 15-09) is exactly this procedure.

**P15-1a. Apply the `0003` migration FIRST (DDL — owner only).**
Creates the 8 new tables (`service_log_events`, `log_patterns`,
`log_patterns_config`, `host_metrics_ext`, `host_cpu_core`, `host_disk_io`,
`host_net_iface`, `pg_health`) + the additive `host_storage` inode columns.

```bash
# from a psql box that can reach the REMOTE PROD nodemon DB, as DB owner/superuser
psql "<NODEMON_OWNER>" -f drizzle/nodemon/0003_moaning_randall.sql
# Confirm the 8 new relations + the 3 inode columns now exist:
psql "<NODEMON_OWNER>" -c "\dt service_log_events|log_patterns|log_patterns_config|host_metrics_ext|host_cpu_core|host_disk_io|host_net_iface|pg_health"
psql "<NODEMON_OWNER>" -c "\d host_storage" | grep -E 'inodes_total|inodes_used|inodes_free'
```

> Apply the SQL file verbatim — do NOT run `drizzle-kit generate/migrate/push`
> against this DB (no `__drizzle_migrations` journal exists; 0000–0002 were all
> owner-applied out-of-band, same discipline).

**P15-1b. Apply the Phase-15 `db/role-grants.sql` delta (owner only).**
Grants the collector role SELECT/INSERT/DELETE on the 6 new raw facts, **SELECT +
the single `UPDATE`** on `log_patterns` (the ONLY UPDATE in the whole grant set —
the D-03 upsert), SELECT-only on `log_patterns_config`, and ENABLE+FORCE RLS +
host-scoped policies on all 7 new fact tables.

```bash
psql "<NODEMON_OWNER>" -f db/role-grants.sql   # or paste only the Phase-15 block
```

Then run the verification query at the bottom of the Phase-15 block and confirm the
zero-row misconfiguration probe returns **nothing** — i.e. `UPDATE` appears **only**
on `log_patterns` (no UPDATE/TRUNCATE on any raw fact), and `nodemon_telemetry` does
**NOT** own the new tables (FORCE RLS intact, owner-bypass avoided).

**P15-1c. Apply the pattern seed (owner only).**

```bash
psql "<NODEMON_OWNER>" -f db/seed-log-patterns.sql
# Confirm the Obsidian config rows (incl. the AP-12a too-many-clients + benign-40001 rows):
psql "<NODEMON_OWNER>" -c "SELECT count(*), count(*) FILTER (WHERE suppress) FROM log_patterns_config"
```

**P15-1d. Confirm A1 + A3 (Phase-15 preconditions).**

```bash
# A1 — the pg probe cred can read pg_stat_* (source of pg_health counters):
psql "<PG_PROBE_CONNINFO>" -c "SELECT count(*) FROM pg_stat_activity; SELECT count(*) FROM pg_stat_database"
# A3 — a postgres service_inventory row with a readable artifact_path exists on the canary:
psql "<NODEMON_OWNER>" -v hid="<CANARY_HOST_ID>" -c \
  "SELECT service_name, artifact_path FROM service_inventory WHERE host_id = :'hid' AND service_name = 'postgres'"
# (seed via db/seed-dimensions.sql if the row/artifact_path is absent)
```

**Bootstrap DONE when:** the 8 new tables + inode columns exist, the grant probe
shows UPDATE only on `log_patterns`, the pattern seed rows are present, and A1/A3
are confirmed — **all before the first expanded tick.**

---

## P15-2. EXPANDED-TICK + VERIFY — one canary tick lands rows in all 8 new tables

Deploy the expanded `collect_telemetry.py` (Plans 15-06/07) via the existing
`nodemonDownload.sh` fileserver rail (same as Phase-11 T4), then force one tick —
the same invocation `CRON_JOB_12` uses (unchanged):

```bash
# ON <CANARY_NODE>
sudo /lnd/bashScripts/nodemonDownload.sh        # self-updates collect_telemetry.py via md5
/lnd/bashScripts/run_collect-telemetry.sh       # force one */5 tick
tail -n 60 /lnd/nodemon/collect-telemetry.log   # expect new counts: log events, cpu cores, disk devs, net ifaces, pg_health
```

The tick MUST exit 0 with **NO SQLSTATE 42501** (proves the `log_patterns` UPDATE
grant, T-15-03). Then verify — as a read role, host-scoped to the canary:

```bash
psql "<NODEMON_OWNER>" -v hid="<CANARY_HOST_ID>" <<'SQL'
SELECT 'service_log_events' AS t, count(*), max(collected_at) FROM service_log_events WHERE host_id = :'hid'
UNION ALL SELECT 'log_patterns',     count(*), max(collected_at) FROM log_patterns     WHERE host_id = :'hid'
UNION ALL SELECT 'host_metrics_ext', count(*), max(collected_at) FROM host_metrics_ext WHERE host_id = :'hid'
UNION ALL SELECT 'host_cpu_core',    count(*), max(collected_at) FROM host_cpu_core    WHERE host_id = :'hid'
UNION ALL SELECT 'host_disk_io',     count(*), max(collected_at) FROM host_disk_io     WHERE host_id = :'hid'
UNION ALL SELECT 'host_net_iface',   count(*), max(collected_at) FROM host_net_iface   WHERE host_id = :'hid'
UNION ALL SELECT 'pg_health',        count(*), max(collected_at) FROM pg_health        WHERE host_id = :'hid';
SQL
```

Confirm ALL of:

1. **≥1 row in each of the 7 fact tables** above (child facts `host_cpu_core` /
   `host_disk_io` / `host_net_iface` show one row **per** core/device/iface — never
   collapsed to 1 per host, Pitfall 4), `max(collected_at)` within the last few
   minutes.
2. **Cross-host isolation (T-15-02):** every new row's `host_id` equals the canary's
   — no other host's rows are visible or writable (FORCE RLS held). A quick check:
   `SELECT DISTINCT host_id FROM service_log_events` returns ONLY `<CANARY_HOST_ID>`.
3. **No SQLSTATE 42501** anywhere in the tick log (the `log_patterns` upsert
   succeeded — T-15-03).
4. **Message redaction (T-15-05):** spot-check `service_log_events.message` for any
   macaroon / secret / token string → **none present**.
   `SELECT message FROM service_log_events WHERE host_id = :'hid' LIMIT 20` — eyeball
   for redaction markers, confirm no raw secrets.
5. **`log_patterns` aggregate:** at least one signature has `count_window ≥ 1` with a
   matching exemplar (or, for a benign high-frequency signature, the aggregate
   persists while exemplars stay capped — D-08).
6. **Deterministic AP-12 advisory:** the AP-12a/b detector reads live `pg_health`
   (no LLM) and the `AP12_NO_DATA_PLACEHOLDER` appears ONLY where a node genuinely
   lacks `pg_health` data.

**Expanded-tick DONE when:** all 7 fact tables carry ≥1 canary row, every row's
`host_id` is the canary's, the tick had no 42501, redaction held, and the
`log_patterns` aggregate + AP-12 detector read the live rows honestly.

---

## PHASE-15 PASS criteria (the gate)

The data-collection-expansion gate **PASSES** when ALL hold on the canary
(COL-01/02/03):

1. **Apply ordering (D-18):** `0003` migration → `role-grants.sql` Phase-15 delta
   (UPDATE on `log_patterns` ONLY) → `seed-log-patterns.sql`, all owner-run, all
   before the first expanded tick; the grant probe confirms no UPDATE/TRUNCATE on
   raw facts.
2. **A1/A3 confirmed:** `PG_PROBE_CONNINFO` reads `pg_stat_*`; a `postgres`
   `service_inventory` row with a readable `artifact_path` exists on the canary.
3. **Rows land (COL-01/02/03):** one `*/5` tick produced host-scoped rows in all 8
   new tables (7 facts + the `log_patterns` aggregate) with no SQLSTATE 42501.
4. **Isolation + redaction (T-15-02 / T-15-05):** every new row's `host_id` is the
   canary's (no cross-host leak); no secret appears in any `service_log_events.message`.
5. **Read-time honesty (T-15-08 / D-14):** bands/verdicts are computed at read via
   the DISTINCT-ON readers — nothing stored; benign signatures suppress at read; the
   AP-12a/b detector is deterministic (LLM retired).

## Deferred rollout (D-09) — fleet splice is NOT part of this gate

The fleet-wide splice of the expanded `collect_telemetry.py` to all ~26 nodes is the
**deferred** rollout step (D-09). It is intentionally OUT of scope for the canary
gate: `CRON_JOB_12` stays **unchanged** for the canary (the expanded collector rides
the existing `*/5` telemetry tick), and no other node receives the expanded payload
until the canary gate above passes and the operator authorizes the splice. Distribute
to the remaining fleet only via the same `nodemonDownload.sh` md5 self-update rail,
one wave at a time, after canary proof.

Referenced artifacts: `drizzle/nodemon/0003_moaning_randall.sql` (Plan 15-01 schema),
`db/role-grants.sql` Phase-15 block (Plan 15-01 grants + FORCE RLS), `db/seed-log-patterns.sql`
(Plan 15-01 Obsidian pattern seed), `src/lib/read/service-log-events.ts` /
`host-metrics-ext.ts` / `pg-health.ts` / `telemetry-bands.ts` / `counter-delta.ts`
(Plans 15-02..05 DISTINCT-ON readers), `src/lib/insight/detectors/ap12-advisory.ts`
(Plan 15-05 deterministic detector), `collect_telemetry.py` (Plans 15-06/07 expanded
collector) + `run_collect-telemetry.sh` (Plan 06 wrapper, `CRON_JOB_12` unchanged),
`/lnd/nodemon/.nodemon.env` (D-03).

---

# PHASE-16 — collector hardening + D-08 channel-promotion (operator procedure)

The fourth live procedure on the canary. It proves the operationally-hardened
collector (absolute `LNCLI_BIN`, `COLLECTOR_VERSION` marker, pubkey self-check,
esplora NO-DATA cleanup) and, critically, exercises the **D-08 channel gate** — the
control that ends the **2026-07-15 accidental fleet-splice** failure mode, where the
expanded collector rode the shared `scp -r` rail and spliced EVERY node at once with
no canary isolation.

The gate replaces "publish to `~/nodemon/` and every node pulls it" with a per-node
**channel pin** that resolves through a fileserver pointer to a **versioned release
dir** — so a build lands on the `canary` channel and is physically unreachable by
`stable`-pinned nodes until the operator flips ONE pointer. The whole gate is bash +
fileserver layout + the local `.nodemon.env` channel line; **zero new warehouse
writes** — the collector stays SELECT-only.

## Conventions used below

| Placeholder | Meaning |
|---|---|
| `<CANARY_NODE>` | the ONE node whose `.nodemon.env` carries `NODEMON_CHANNEL=canary` |
| `<VERSION>` | a release version string, e.g. `16.06` (matches `COLLECTOR_VERSION`) |
| `~/nodemon/releases/<VERSION>/` | fileserver dir holding that build's `collect_telemetry.py` + `requirements.txt` |
| `~/nodemon/channels/canary` | pointer file whose ONLY contents are a `<VERSION>` string |
| `~/nodemon/channels/stable` | the fleet-wide pointer; flipping it IS promotion |

## P16-0. OWNER-SIDE PREREQUISITE — apply 16-04 + 16-05 SQL BEFORE the canary tick

> **BLOCKING, owner-run, MUST happen before (or at) the first canary tick.** Both are
> **owner-run SQL** (NOT `drizzle-kit push`, NOT a collector write) — the collector's
> SELECT-only boundary is preserved. Skipping this ordering means the canary proves
> nothing useful: the info-tier flood is NOT suppressed and **0 daemon-log lines** are
> captured.

1. **16-04 reseed — `db/seed-log-patterns.sql`.** Apply the info/warn/critical +
   category reseed that REPLACES the old `benign/ap11/ap12` classification VALUES.
   **Why first:** 16-03's info-tier exemplar suppression only MATCHES once the live
   `log_patterns` rows carry the new `{info,warn,critical}` classification values.
   Pre-reseed, `_tier_of` maps every non-`{info,warn,critical}` row to the defensive
   warn-capped path (a tick never crashes) — but info suppression is **inert**, so the
   info-tier flood floods `service_log_events` unabated.
2. **16-05 path reconciler — `scripts/fileserver/path-reconciler.sql`.** Apply the
   guarded `UNIQUE` constraint + daemon-path UPSERT that populates
   `service_inventory.artifact_path` for the native daemons. **Why first:** native
   daemon logs (bitcoind/postgres/lnd) are only tailed ONCE `artifact_path` is
   populated (COL-05 decoupled tail). With it empty, **0 daemon-log lines** are
   captured at the canary tick.

```bash
# ON THE OWNER/superuser PG session (NOT nodemon_telemetry):
psql "<NODEMON_OWNER>" -f db/seed-log-patterns.sql              # 16-04 reseed
psql "<NODEMON_OWNER>" -f scripts/fileserver/path-reconciler.sql # 16-05 daemon paths
```

**P16-0 DONE when:** `log_patterns.classification` shows `{info,warn,critical}` values
(no residual `benign/ap11/ap12`), and each native daemon `service_inventory` row on the
canary has a non-null, readable `artifact_path`.

## P16-1. CONFIRM-HARDENING — absolute lncli + version marker resolve on the node

```bash
# ON <CANARY_NODE> — re-provision so the managed env carries the absolute LNCLI_BIN
# default (/usr/local/bin/lncli) and a NODEMON_CHANNEL line:
sudo /lnd/bashScripts/deploy-env.sh
sudo grep -E '^(LNCLI|NODEMON_CHANNEL)=' /lnd/nodemon/.nodemon.env   # both present; channel defaults stable

# Force a tick and confirm identity + version are now logged (no pubkey=none):
sudo /lnd/bashScripts/run_collect-telemetry.sh
tail -n 30 /lnd/nodemon/collect-telemetry.log | grep -E 'collector version=|wrote tick'
# EXPECT: `collector version=16.06 ... lncli=/lnd/bashScripts/lncli-telemetry.sh`
#         `wrote tick host=... pubkey=set lncli=... version=16.06 ...`  (pubkey=set, NOT none)
```

If the tick logs `WARN: node_pubkey=none`, the absolute lncli fix did not take — check
`LNCLI` in the env points at the wrapper and `deploy-env.sh`'s `getinfo` sanity passed.

## P16-2. PIN THE CANARY CHANNEL — set `NODEMON_CHANNEL=canary` on the one node

```bash
# ON <CANARY_NODE> — flip THIS node (and only this node) onto the canary channel.
# (Re-running deploy-env.sh with NODEMON_CHANNEL=canary exported is the managed way;
#  a one-line edit of the managed block is equivalent since the key already exists.)
sudo NODEMON_CHANNEL=canary /lnd/bashScripts/deploy-env.sh
sudo grep '^NODEMON_CHANNEL=' /lnd/nodemon/.nodemon.env      # EXPECT: NODEMON_CHANNEL=canary
```

## P16-3. PUBLISH THE BUILD to the canary channel/release (fileserver)

```bash
# ON THE FILESERVER — stage the new build under a versioned release dir, then point
# the canary channel at it. Stable nodes still resolve the OLD stable version, so they
# cannot see this build.
mkdir -p ~/nodemon/releases/<VERSION>
cp ~/nodemon/collect_telemetry.py ~/nodemon/requirements.txt ~/nodemon/releases/<VERSION>/
mkdir -p ~/nodemon/channels
echo "<VERSION>" > ~/nodemon/channels/canary
cat ~/nodemon/channels/canary        # EXPECT: <VERSION>
```

## P16-4. PROVE ON THE ONE CANARY — gated pull + verification tick

```bash
# ON <CANARY_NODE> — the wrapper resolves channel=canary -> <VERSION> and scopes its
# md5 self-update to ~/nodemon/releases/<VERSION>/ ONLY.
sudo /lnd/bashScripts/run_collect-telemetry.sh
grep 'D-08 gate:' /lnd/nodemon/collect-telemetry.log | tail -2
# EXPECT: `D-08 gate: channel=canary -> version=<VERSION>; self-update scoped to .../releases/<VERSION>`
```

Then run the standing telemetry verification (mirror the Phase-15 P15 / TELEMETRY
T-section queries): confirm host-scoped rows landed, `pubkey=set`, info-tier signatures
are count-only (suppressed exemplars after the P16-0 reseed), and daemon-log lines are
now captured (after the P16-0 path reconciler). No cross-host leak; no secret in any
`service_log_events.message`.

**Proof that isolation held:** on ANY `stable`-pinned node, the same tick logs
`D-08 gate: channel=stable -> version=<OLD_STABLE_VERSION>` (or SKIPS if unresolved) —
it never pulls `<VERSION>`. This is the structural end of the accidental-splice class.

## P16-5. PROMOTE FLEET-WIDE — flip ONE stable pointer

Only after P16-4 passes on the canary:

```bash
# ON THE FILESERVER — a SINGLE pointer flip promotes the proven build to the whole
# fleet. Every stable-pinned node's next */5 tick resolves the new version and pulls
# it through the same gated, md5-compared rail — one wave, no blanket scp -r splice.
cp ~/nodemon/collect_telemetry.py ~/nodemon/requirements.txt ~/nodemon/releases/<VERSION>/  # ensure release is staged
echo "<VERSION>" > ~/nodemon/channels/stable
cat ~/nodemon/channels/stable        # EXPECT: <VERSION>
```

To ROLL BACK: `echo "<PRIOR_VERSION>" > ~/nodemon/channels/stable` — the next tick
re-pulls the prior release. No node edits, no re-splice.

## PHASE-16 PASS criteria (the gate)

The hardening + rollout-gate gate **PASSES** when ALL hold on the canary (COL-06 #4 + D-08):

1. **Prereq ordering (P16-0):** 16-04 `seed-log-patterns.sql` + 16-05
   `path-reconciler.sql` were applied owner-side BEFORE the canary tick — `log_patterns`
   carries `{info,warn,critical}`, native daemon `artifact_path` is populated.
2. **Identity restored (T-16-09):** the tick logs `pubkey=set` with an absolute
   `lncli=/lnd/bashScripts/lncli-telemetry.sh`; no `pubkey=none` WARN.
3. **Observable build (T-16-11):** `collector version=16.06` is logged each tick and
   carried in the `wrote tick` summary — no warehouse row was added for it.
4. **Channel gate scopes the pull (T-16-08):** the canary logs
   `D-08 gate: channel=canary -> version=<VERSION>` and self-updates ONLY from
   `releases/<VERSION>/`; a stable node never pulls `<VERSION>`; an unresolved channel
   SKIPS self-update (fail-safe, never an unscoped fleet pull).
5. **SELECT-only preserved:** no `INSERT`/`UPDATE`/`GRANT` was added to
   `run_collect-telemetry.sh` or `collect_telemetry.py`; the gate is bash + fileserver
   layout + the local channel line only.
6. **Promotion is one flip:** fleet-wide rollout is `echo <VERSION> > channels/stable`
   (and rollback the reverse) — the blanket `scp -r` accidental-splice path is closed.

Referenced artifacts: `scripts/fileserver/deploy-env.sh` (absolute `LNCLI_BIN` +
`NODEMON_CHANNEL`), `scripts/fileserver/collect_telemetry.py` (`COLLECTOR_VERSION`,
lncli self-check, esplora NO-DATA), `scripts/fileserver/run_collect-telemetry.sh`
(D-08 channel gate), `scripts/fileserver/nodemonDownload.sh` (D-08 header note),
`db/seed-log-patterns.sql` (16-04 reseed), `scripts/fileserver/path-reconciler.sql`
(16-05 daemon paths), `/lnd/nodemon/.nodemon.env` (D-03 channel pin).
