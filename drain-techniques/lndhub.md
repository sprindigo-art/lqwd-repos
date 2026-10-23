# Full config with Redis and bitcoind credentials logged unless NODE_ENV=prod

## Details
controllers/api.js lines 8-10 run at require time:

```js
if (process.env.NODE_ENV !== 'prod') {
  console.log('using config', JSON.stringify(config));
}
```

`config` (config.js, or the Heroku `CONFIG` JSON parsed whole) contains `bitcoind.rpc` as `http://login:password@host:port/wallet/...`, `redis.password`, and `lnd.password` (the lnd wallet unlock password). The guard is inverted relative to how the project is deployed: nothing in the repository sets `NODE_ENV`. The Dockerfile sets only `PORT` and runs `npm start`; the `start` and `dev` scripts in package.json do not set it; the README's Heroku instructions list `CONFIG`, `MACAROON`, `TLSCERT` only. The conventional value is also `production`, not `prod`, so even operators who set `NODE_ENV=production` out of habit still get the dump. Consequently every process start of the published image, of an Umbrel install, of a Heroku dyno, or of a bare `npm start` writes the Redis password, the bitcoind RPC credentials and the lnd wallet password to stdout, where container runtimes, Heroku log drains and any log aggregation retain them.

Redis holds every user's login/password hash key, bearer and refresh tokens (`userid_for_*`), and all balance-bearing ledgers; the bitcoind wallet credentials allow spending from the operator's on-chain wallet; the lnd wallet password unlocks the node. Anyone who can read the hub's logs (log-drain services, shared monitoring, operators of a log pipeline, or anyone who later obtains an archived log) gains credentials to the stores that the threat model treats as the trusted infrastructure boundary, without needing host access.

This is the default behaviour in shipped artefacts, not a debug flag an operator must turn on. `lightning.js` prints the admin macaroon and tls.cert only when `VERBOSE` is set, which is opt-in and not filed.

## Evidence
1. [controllers/api.js:8–10](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L8-L10)
   At module load, `if (process.env.NODE_ENV !== 'prod') console.log('using config', JSON.stringify(config))` serialises the whole configuration object, including embedded credentials, to stdout. The guard is an undocumented, non-conventional value ('prod', not 'production'), so it is off in every shipped deployment path.
2. [config.js:7–26](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/config.js#L7-L26)
   The config object carries `bitcoind.rpc` as a URL with login:password userinfo, `redis.password`, and `lnd.password`; when `process.env.CONFIG` is set (Heroku path) the operator's JSON replaces it wholesale and is dumped identically.
3. [index.js:47](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/index.js#L47)
   `app.use(require('./controllers/api'))` loads the router at every process start, so the dump runs on every boot, not on a debug code path.
4. [Dockerfile:38–42](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/Dockerfile#L38-L42)
   The published image sets only `ENV PORT=3000` and runs `npm start`; NODE_ENV is never set, so the Docker Hub image (consumed by Umbrel) logs its credentials on every start by default.
5. [package.json:6–11](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/package.json#L6-L11)
   `start` and `dev` scripts run babel-node without setting NODE_ENV, so bare-metal `npm start` and Heroku dynos have the same default.
6. [README.md:32–37](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/README.md#L32-L37)
   Heroku instructions tell the operator to set only CONFIG, MACAROON and TLSCERT; the repository nowhere documents NODE_ENV=prod as an obligation, so there is no fencing requirement the operator could have applied.
7. [bitcoin.js:5–8](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/bitcoin.js#L5-L8)
   `url.parse(config.bitcoind.rpc)` feeds the userinfo credentials to the jayson JSON-RPC client, confirming the dumped URL is the live bitcoind wallet RPC credential.
8. [lightning.js:40–45](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/lightning.js#L40-L45)
   `config.lnd.password` is sent as `wallet_password` to lnd's WalletUnlocker, confirming the dumped value is the lnd wallet unlock password. The admin macaroon/tls.cert dumps on lines 23 and 31 are gated by opt-in VERBOSE and are not part of this finding.

## Impact
The Redis password is the only credential protecting every user's login/password-hash key, all bearer and refresh tokens (`userid_for_*`, no TTL) and every balance-bearing ledger (`userinvoices_for_`, `txs_for_`, `locked_payments_for_`, `ispaid_`). A log reader who can reach Redis from the hub's network (Heroku Redis add-ons are reachable over the internet with just this password) reads all hub data, rewrites ledgers to credit arbitrary balances that /payinvoice then pays out of the operator's lnd liquidity, and can delete or FLUSH the store. Subsequent-system impact: When `config.bitcoind` is set, the dumped `bitcoind.rpc` URL carries the login:password for the operator's bitcoind wallet RPC (`/wallet/wallet.dat`), a separate daemon: with it a reader who can reach bitcoind can list and export wallet data, spend the operator's on-chain funds (`sendtoaddress`), and halt the node (`stop`). The lnd wallet password only matters while lnd is locked and additionally requires reaching lnd's gRPC port.

## Reproduction steps
1. No attacker action triggers the exposure: every start of the hub in its default shipped configuration (Docker image, Umbrel, Heroku, bare npm start) writes the Redis password, bitcoind RPC login:password and lnd wallet password to stdout. The attacker is whoever can read that stream or its retained copies: container log driver output on the host, Heroku `heroku logs` or an attached log drain service, Umbrel's log viewer, or any aggregation/monitoring pipeline. That position is privileged relative to the hub's users but is distinct from and typically weaker than Redis, bitcoind or host root access.

## Recommended fix
The configuration object, which embeds Redis, bitcoind RPC and lnd wallet credentials, is serialised verbatim to the log stream, behind a guard keyed to an undocumented, non-conventional NODE_ENV value that no shipped deployment path (Dockerfile, npm scripts, README/Heroku instructions) sets. Fix criteria: Configuration containing credentials is never written to logs in any environment: either remove the dump or redact password fields and URL userinfo before logging, and make any remaining config dump explicitly opt-in (e.g. the existing VERBOSE flag) rather than on-by-default. A fresh start of the Docker image or `npm start` with default environment emits no Redis, bitcoind or lnd credential on stdout.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Sensitive information in logs
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5257883

---

# Per-request SendPayment gRPC stream never closed, leaking one lnd stream per /payinvoice

## Details
The external branch of POST /payinvoice calls `lightning.sendPayment()` (controllers/api.js:299) with no arguments, creating a new bidirectional lnd `SendPayment` call. `call` is a local variable: the handler registers only a 'data' listener (300-317), writes at most one SendRequest (330), and on no path calls `call.end()` (client half-close) or `call.cancel()`, nor registers an 'error', 'status' or 'end' listener. lnd's legacy SendPayment is specified in the in-tree rpc.proto (lines 411-418) as 'a persistent bi-directional stream' that the server keeps open until the client half-closes, so each stream stays open on the hub's single lnd channel (lightning.js:57 — one `lnrpc.Lightning` client for the whole process, no deadline, keepalive or idle option) for the life of the TCP connection.

Every request reaching line 299 therefore leaks one HTTP/2 stream, retained by the session together with the grpc-js call objects and the 'data' closure over `req`, `res`, `u`, `info` and `lock`, plus one open stream and handler on lnd. Three paths leak at no cost to the caller: (a) a zero-amount external invoice submitted without `amount` is rejected at 318-322 *after* the stream was created and before anything is written (needs only a 1-sat balance to pass the gate at 245); (b) a payment lnd fails promptly (1-sat invoice to an unreachable node) — the 'data' handler answers and returns, stream left open; (c) every genuine payment. The code imposes no bound: total leaked state equals the number of /payinvoice attempts since the last restart, which the attacker sets. The per-route `postLimiter` (api.js:132, 100/30 min) and global limiter are keyed on req.ip, which under `app.enable('trust proxy')` (index.js:19) is the leftmost X-Forwarded-For value the client supplies, so the pace is attacker-chosen.

Consequence: hub heap grows linearly until the process is OOM-killed, and lnd accumulates open streams/handlers on the admin connection. If the server advertises SETTINGS_MAX_CONCURRENT_STREAMS, Node's http2 client queues every later stream on the session once that many are leaked, so decodePayReq, lookupInvoice (used by every balance computation), addInvoice and getInfo block for all users until the connection drops. When it does drop, every leaked stream emits 'error' with no listener; index.js:1-4's uncaughtException handler swallows them, so the condition is silent and never triggers a restart.

This is a resource-release defect (CWE-772), not volumetric load: each request leaks a fixed amount that is never reclaimed, so cumulative low-rate traffic degrades the hub permanently until an operator restart.

Dependency assumptions: @grpc/grpc-js 1.3.7 (package-lock) starts a bidi call on `makeBidiStreamRequest` and keeps the Http2Stream open until the client half-closes and the server sends trailers (the documented gRPC streaming contract); lnd (external, unpinned) keeps a SendPayment stream open until client EOF, and its grpc-go server's concurrent-stream limit is either unlimited (memory-growth branch) or finite (wedge branch); Node 16 (Dockerfile) http2 sessions also count live streams against a default 10 MB `maxSessionMemory`, which if exceeded makes the hub reject further inbound response headers — an earlier hub-side wedge, stated as an unverified assumption.

## Evidence
1. [controllers/api.js:299](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L299)
   Primary location: a new bidirectional SendPayment call (one HTTP/2 stream on the hub's single lnd channel) is opened for every request reaching the external branch; `call` is local and nowhere in the file is it end()'d, cancel()'d or given an 'error'/'status'/'end' listener.
2. [controllers/api.js:318–322](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L318-L322)
   Zero-cost leak path: for a zero-amount external invoice submitted without `amount`, the stream created at 299 is abandoned by this early return before anything is written; the only precondition is passing the balance gate at 245, which with num_satoshis=false requires a 1-sat balance.
3. [controllers/api.js:300–317](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L300-L317)
   The only listener. It finishes the HTTP response on success or payment_error but never half-closes the stream, so the stream and its closure over req, res, u, info and lock stay alive on the hub and lnd after both the failed and the successful payment paths.
4. [controllers/api.js:328–334](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L328-L334)
   The single write and its failure path: after call.write (or a lockFunds throw) the handler returns without ending the stream.
5. [lightning.js:57](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/lightning.js#L57)
   One Lightning client for the whole process, with no deadline, keepalive or idle options: every lnd RPC (decodePayReq, lookupInvoice, addInvoice, getInfo, subscribeInvoices) multiplexes over the same HTTP/2 session the leaked streams occupy.
6. [index.js:19](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/index.js#L19)
   trust proxy enabled for all hops: req.ip, the key of both the global limiter (index.js:24) and postLimiter (api.js:132), is the client-supplied leftmost X-Forwarded-For value, so the rate at which streams are leaked is attacker-chosen rather than bounded to 100 per 30 minutes.
7. [controllers/api.js:132–135](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L132-L135)
   postLimiter on /payinvoice is the only throttle on the leak and is keyed per req.ip (spoofable under trust proxy).
8. [index.js:1–4](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/index.js#L1-L4)
   When the lnd connection eventually drops, every leaked stream emits an unhandled 'error'; the process-wide uncaughtException handler swallows each, so the leak is silent and never crashes or restarts the process.

## Impact
No confidentiality or ledger effect (reservations stay in place, the safe direction). Availability HIGH: the leaked state is never reclaimed while the process lives, its total is set by the attacker's request count (rate limit spoofable), and it accumulates on the one channel every lnd RPC uses; the end state is process OOM or a wedged lnd channel — every user's balance, invoice and payment call fails — until the operator restarts the hub. Effort to reach it is volume, not a security mechanism, so it does not lower the impact rating.

## Reproduction steps
1. Attacker: any authenticated user (free /create) holding 1-2 sat. Repeatedly POST /payinvoice with a zero-amount external bolt11 and no `amount` (rejected at 318 after the stream is opened) or a 1-sat invoice to an unreachable node (lnd fails it, funds unlocked). Each call deterministically opens a SendPayment stream that is never closed; the per-user lock is released at once so calls go back-to-back, and the per-IP limiters are bypassed by varying X-Forwarded-For under trust proxy. No race or victim interaction; the degradation accumulates until an operator restarts the hub.

## Recommended fix
1. The per-request SendPayment bidirectional stream is never half-closed or cancelled on any path (rejected request, failed payment, successful payment), so every attempt leaks an HTTP/2 stream and its closures on the hub and a stream/handler on lnd — a missing release of a resource after its effective lifetime. Fix criteria: Every path that creates the stream must deterministically close it (end()/cancel()) once the single response has been handled or when the request aborts before writing, and the stream must carry an 'error'/'status' handler that releases the per-user lock and answers the HTTP request. Verify: after many /payinvoice attempts of each kind (rejected zero-amount, failed, successful) the number of open streams on the lnd channel returns to baseline and process heap does not grow.
2. The stream is created before argument validation (line 299 precedes the num_satoshis check at 318), so even requests rejected with errorBadArguments leak a stream at zero cost to the caller. Fix criteria: Validate the request (amount present, balance sufficient) before opening any lnd stream, or use a unary call (SendPaymentSync / routerrpc) that has no persistent stream. Verify: a rejected zero-amount request opens no lnd stream.

---
**Severity:** HIGH
**Status:** Open
**Category:** Resource leak
**CWE:** [CWE-772](https://cwe.mitre.org/data/definitions/772.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5258077

---

# Malformed request bodies return Express default error pages with server stack traces and install paths

## Details
index.js mounts body-parser 1.19.0's urlencoded and json parsers for every request (lines 43-44) and never installs an Express error-handling middleware. When the JSON parser rejects a body (syntactically invalid JSON, a body over 100 kb, an unsupported charset or content-encoding) it calls next(err); with no error middleware Express 4.17.1 hands the error to finalhandler 1.1.2, which in any environment other than NODE_ENV='production' writes `err.stack` into an HTML `<pre>` block and returns it to the client.

Nothing in the shipped artefacts sets NODE_ENV: the Dockerfile exports only PORT, package.json's start script is plain babel-node, and the Heroku/bare-metal instructions never mention it. The only production switch the project knows is `NODE_ENV !== 'prod'` (controllers/api.js:8), which is not the string Express checks, so even an operator who follows the project's convention keeps the stack output on.

An anonymous client therefore sends e.g. `POST /create` with `Content-Type: application/json` and body `{` and receives HTTP 400 whose body is the SyntaxError stack: the parser call chain with absolute paths of the installation (`/lndhub/node_modules/body-parser/lib/types/json.js:89`, `.../raw-body/index.js:224`, Node internals). On bare-metal installs the path reveals the OS account and home directory the hub runs under; everywhere it confirms the exact middleware stack and file layout. The same default handler also serves Express's own 400 'Failed to decode param' stack for malformed percent-encoding in URLs. Route handlers themselves are async functions, so their throws bypass Express entirely (hung request, swallowed by the uncaughtException handler) rather than reaching this page, which is why the leak is confined to parser- and router-level errors.

The disclosed data is the install path, dependency identities and line numbers - reconnaissance material, not credentials. Low severity information exposure; filed because the path is reachable by the anonymous network adversary against the shipped default configuration.

Dependency assumption against the pinned versions: express 4.17.1 delegates unhandled errors to finalhandler 1.1.2, whose getErrorMessage returns err.stack whenever `env !== 'production'` (env defaulting to process.env.NODE_ENV or 'development'); body-parser 1.19.0 passes JSON.parse SyntaxErrors to next() as 400 errors with the original stack.

## Evidence
1. [index.js:41–48](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/index.js#L41-L48)
   body-parser json and urlencoded are mounted globally with no error-handling middleware anywhere after them; parse errors (400 entity.parse.failed, 413 entity.too.large, 415 charset/encoding unsupported) fall through to Express 4.17.1's built-in finalhandler.
2. [index.js:18–48](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/index.js#L18-L48)
   The whole Express app setup (lines 18-48): no `app.use((err, req, res, next) => ...)` error middleware after the parsers or routers, and no `app.set('env', 'production')`; express 4.17.1 therefore builds finalhandler 1.1.2 with env = process.env.NODE_ENV || 'development', and finalhandler's getErrorMessage emits err.stack whenever env !== 'production'.
3. [Dockerfile:38–41](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/Dockerfile#L38-L41)
   The published image sets only PORT; NODE_ENV is absent, so Express runs in 'development' mode and finalhandler renders err.stack in the HTML body.
4. [controllers/api.js:8–9](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L8-L9)
   The project's own production switch is NODE_ENV === 'prod'; an operator who sets that to silence the config dump still has finalhandler in non-'production' mode, so stacks remain exposed even in the project's intended production configuration.
5. [controllers/api.js:137–171](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L137-L171)
   /create and /auth are unauthenticated POST routes reading req.body, so the body parsers run for anonymous clients; any route (including non-existent paths) accepts a JSON body because the parsers are mounted before routing.

## Impact
Discloses the absolute installation path, the body-parser/raw-body/express file and line layout (pinning dependency versions), and the Node runtime's internal frame format. Against the Docker image the /lndhub root is already public in the Dockerfile, so the gain there is fingerprinting the exact stack; on bare-metal or Heroku installs the path reveals the service account's home directory and layout. No secrets, credentials or user data; no integrity or availability effect. Low confidentiality impact.

## Reproduction steps
1. Anonymous network client sends a single request with Content-Type application/json and a malformed body (e.g. `{`), or an over-limit body (413), unsupported charset/encoding (415), or a path with a malformed percent-escape in a parameterised route (/getchaninfo/%, 400 'Failed to decode param') to any path; body-parser 1.19.0 / Express's router pass the error to next(), no error middleware exists, and finalhandler 1.1.2 returns the error stack in an HTML <pre> block. Works against the published Docker image (Dockerfile sets only PORT), bare `npm start`, and deployments following the project's own NODE_ENV='prod' convention (controllers/api.js:8), since Express checks for the string 'production'. No privileges, no interaction, no special state; the global 200/15-min rate limit does not prevent a single request.

## Recommended fix
1. No application error-handling middleware exists, so parser and router errors reach Express's development-mode default handler, which emits err.stack to the client. Fix criteria: All errors reaching the end of the middleware chain must produce a generic JSON error body with no stack or path information, independent of NODE_ENV. Verify: POST /create with body '{' returns a response containing no file paths or stack frames.
2. The project's production flag ('prod') differs from the value Express recognises ('production'), so the intended production configuration still leaves Express in development mode. Fix criteria: Set Express's env explicitly (app.set('env','production')) or align the project's NODE_ENV convention and document it in the Dockerfile/README. Verify: the published image runs with Express in production mode.

---
**Severity:** HIGH
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-209](https://cwe.mitre.org/data/definitions/209.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5258074

---

# Fixed listtransactions window lets a depositor evict other users' confirmed deposits from balances

## Details
In the default (bitcoind-configured, config.js:7-9) deployment every user's on-chain credit is computed from one call `listtransactions ['*', 100500, 0, true]` (class/User.js:413). Bitcoin Core's listtransactions walks the wallet's transaction list from newest to oldest and returns only the newest `count` entries; a transaction paying a watched address in N outputs yields N separate 'receive' entries, and a transaction is entered into the wallet as soon as it reaches the node's mempool (depth 0, listed). The code treats this bounded, recency-ordered slice as the complete history: getTxs() (User.js:339-349) credits a user only for entries in the slice matching their address with confirmations >= 3, getCalculatedBalance() (User.js:161-179) is the balance authority for every /payinvoice (api.js:225), and /gettxs and /balance show the same view. Entries older than the newest 100500 are silently dropped, so any confirmed deposit that falls out of the window stops being credited while the user's Lightning debits in txs_for_ remain.

Wallet entries are externally insertable: every account obtains a watched deposit address via /getbtc (api.js:342-361, importaddress at User.js:129/137). An attacker can therefore flood the operator's bitcoind wallet with outputs to their own address. The entries persist either (a) while the transactions stay unconfirmed and their inputs are never spent elsewhere (the wallet never purges depth-0 transactions, even after mempool expiry), or (b) permanently once they confirm, in which case the dust is credited to the attacker's own hub account at >= 3 confirmations and is withdrawable over Lightning, so the attacker's net cost is miner fees. (Conflicted transactions do not help: Bitcoin Core lists 'receive' entries only for depth >= 0, so a confirmed double-spend removes the attacker's entries from the window.) Partial floods evict the oldest deposits first, so victims are harmed in proportion to the attacker's spend; organic wallet growth on a busy hub reaches the same state without an attacker.

Once other users' deposits are outside the window, on the next 5-minute cache refresh each victim's calculated balance drops by the full sum of their evicted on-chain deposits, /payinvoice returns 'not enough balance' (api.js:245, 337) and /balance shows a reduced or zero balance. The Redis fallback copy written at User.js:430 is the same truncated snapshot and does not restore them. The operator still holds the funds in lnd, so this is denial of access to users' funds across the hub rather than theft, but it persists until a code change or manual ledger intervention. The lnd-mode path (GetTransactions, no count) is not affected by this truncation.

## Evidence
1. [class/User.js:410–430](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L410-L430)
   _listtransactions fetches bitcoind listtransactions with count=100500, skip=0, include_watchonly=true and treats the result as the complete deposit history for every user. Bitcoin Core returns only the newest `count` entries in wallet insertion order, one entry per output to a watched address, and a transaction is entered into the wallet (depth 0, listed) as soon as it reaches the node's mempool. Entries older than the newest 100500 are silently dropped; the compacted slice is cached in-process for 5 minutes and written to the shared Redis key 'listtransactions' used as the error fallback at line 434.
2. [class/User.js:339–348](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L339-L348)
   getTxs() derives a user's on-chain credits solely from the entries present in that truncated window (address match, category 'receive', confirmations >= 3). A deposit that has fallen out of the window contributes nothing.
3. [class/User.js:161–178](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L161-L178)
   getCalculatedBalance() is the sole balance authority at spend time; it credits only the bitcoind_tx entries getTxs() returned, so evicted deposits reduce the victim's spendable balance by their full amount while Lightning debits in txs_for_ remain.
4. [controllers/api.js:342–360](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L342-L360)
   /getbtc hands every authenticated account a deposit address that is imported into the operator's bitcoind as watch-only (generateAddress/watchAddress, User.js:111-138). Anyone with a free account can therefore insert wallet entries into the operator's bitcoind at will by sending outputs to their own address.
5. [controllers/api.js:223–244](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L223-L244)
   /payinvoice compares the truncated-window balance against the invoice amount; victims whose deposits were evicted receive 'not enough balance' and cannot withdraw funds the operator actually holds.

## Impact
Balances computed for every other user with evicted deposits become wrong (deposits uncounted while debits remain), a limited integrity impact on the derived ledger, and those users lose the ability to withdraw funds the hub holds for as long as the window stays full, a high availability impact on the hub's core function. The attacker gains no funds beyond their own dust and reads nothing.

## Reproduction steps
1. Attacker creates a free account, obtains a watched deposit address via /getbtc, and relays standard-size transactions carrying thousands of dust outputs each to that address; each output becomes a listed wallet entry on arrival in the hub node's mempool. Entries persist while unconfirmed with inputs unspent, or permanently once confirmed (the dust is then credited back to the attacker's own account). On the next 5-minute cache refresh the newest-100500 window no longer contains other users' older confirmed deposits and getCalculatedBalance stops crediting them. Works against the shipped default bitcoind configuration with no victim interaction.

## Recommended fix
The deposit history is read as a fixed-size, recency-ordered slice of the whole watch-only wallet, so externally insertable entries evict legitimate deposits from the data the balance is computed from. Fix criteria: A user's confirmed deposits must be counted regardless of how many other wallet entries exist or how recent they are (e.g. per-address queries, pagination until exhaustion, or persisting credited deposits once confirmed). Verify that after inserting more than 100500 newer watch-only entries, a previously confirmed deposit of another user is still credited in getCalculatedBalance.

---
**Severity:** HIGH
**Status:** Open
**Category:** Incorrect calculation
**CWE:** [CWE-682](https://cwe.mitre.org/data/definitions/682.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5257885

---

# Re-submitting an in-flight invoice removes its balance reservation, enabling double spend of operator funds

## Details
The external branch of POST /payinvoice reserves the user's balance by pushing `{pay_req, amount, timestamp}` to `locked_payments_for_<uid>` (User.lockFunds) and then writes a SendRequest to lnd. The reservation is the only accounting for the payment until lnd's streaming response arrives, at which point the `data` handler (controllers/api.js:300-317) first executes `await u.unlockFunds(req.body.invoice)` and only afterwards decides whether the payment succeeded (record `savePaidLndInvoice`) or failed (just return an error).

Two properties combine into a deterministic double spend:
1. `User.unlockFunds(pay_req)` (class/User.js:565-578) rewrites the list keeping only entries whose `pay_req` differs, so it removes every reservation for that invoice string, not the one belonging to the current request.
2. Nothing prevents the same user from submitting the same invoice again. The only guard is the per-user Redis lock `invoice_paying_for_<uid>`, which `Lock.obtainLock` expires after 300 s (class/Lock.js:28) irrespective of whether the payment is still pending.

Attack (attacker = any authenticated user, who also runs an ordinary Lightning node D):
- Deposit N sats. Create on D a zero-amount (or fixed-amount) hold invoice I, i.e. D accepts the HTLC but neither settles nor fails it.
- POST /payinvoice {invoice: I, amount: N*0.98}. Balance gate passes, `lockFunds` reserves ~N, lnd dispatches the HTLC to D, D holds it. The HTTP request never completes; the lock key expires after 5 minutes.
- POST /payinvoice {invoice: I, amount: 1}. Gate needs only ~2 sats spare. `lockFunds` pushes a second entry, `call.write` goes to lnd, whose control tower refuses a duplicate in-flight hash with payment_error 'payment is in transition' (string the project matches in Paym.js:108). The `data` handler runs `unlockFunds(I)`, deleting BOTH entries, then returns errorPaymentFailed. The attacker's calculated balance is back to N with ~N still committed on the wire.
- Spend N again: internal transfer to a second attacker account via the internal branch, or another external payment. Repeat the hold/resubmit cycle k times to put k*N in flight, then have D settle all HTLCs. When each first stream finally delivers success, `savePaidLndInvoice` records a debit the account can no longer cover; the hub's lnd has paid out k*N against a deposit of N.

The same sequence works with any fixed-amount invoice if the attacker holds enough balance for two reservations, and with any other lnd failure for the second submission (expired invoice, etc.) — any `payment_error` triggers the unconditional unlock. The hold time is bounded only by the invoice's final CLTV (attacker-authored `c` tag, up to lnd's max-cltv-expiry, default 2016 blocks).

Assumption on lnd (external dependency, version not pinned in this repo): re-sending SendRequest for a payment hash currently in flight returns a SendResponse carrying payment_error ('payment is in transition') instead of dispatching a second HTLC; this is lnd's documented control-tower behaviour since 0.9 and is the error string the code expects. Even on an lnd that did dispatch a second HTLC, the data event for that second payment would still strip the first reservation.

## Evidence
1. [controllers/api.js:300–317](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L300-L317)
   The sendPayment 'data' handler calls `await u.unlockFunds(req.body.invoice)` before looking at the result. When lnd answers with a `payment_error` (e.g. 'payment is in transition' because the same hash is already in flight), the handler drops into the failure branch and returns errorPaymentFailed, but the reservation for the invoice has already been removed from `locked_payments_for_`.
2. [class/User.js:565–578](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L565-L578)
   unlockFunds strips EVERY entry whose pay_req equals the given string, not just the one created by this request. A second submission of the same invoice therefore also removes the reservation of the first, still in-flight, payment.
3. [controllers/api.js:318–334](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L318-L334)
   There is no check that `req.body.invoice` (or its payment_hash) is already present in the user's locked payments; `lockFunds` and `call.write` are performed unconditionally, so the same invoice can be submitted while its first payment is pending.
4. [class/Lock.js:18–29](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/Lock.js#L18-L29)
   The per-user `invoice_paying_for_<userid>` lock auto-expires after 5 minutes regardless of payment state. A payment held by the remote destination outlives it, after which the same user can re-enter /payinvoice.
5. [class/User.js:181–185](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L181-L185)
   getCalculatedBalance subtracts `locked_payments_for_` entries; this is the only thing debiting an in-flight payment. Once the entry is stripped the full balance becomes spendable again until the payment finally settles and `savePaidLndInvoice` records it.
6. [class/Paym.js:108–110](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/Paym.js#L108-L110)
   The project itself matches lnd's 'payment is in transition' error string, confirming that re-sending an in-flight payment hash yields a prompt SendResponse with payment_error on this stream rather than a second payment.

## Impact
The hub's ledger is driven negative while the operator's lnd channel liquidity actually leaves the node; the attacker extracts multiples of their deposit. Integrity of the custodial balance accounting is fully defeated and translates to direct, repeatable financial loss bounded only by hub liquidity. No confidentiality impact; availability impact is indirect (drained liquidity) and not rated.

## Reproduction steps
1. Attacker is any user of the open /create endpoint who also controls a Lightning node able to hold an HTLC (standard hold-invoice functionality). Steps: deposit, /payinvoice a hold invoice, wait five minutes for the per-user lock to lapse, /payinvoice the identical invoice string once more so lnd's prompt failure response triggers unlockFunds, then spend the restored balance and settle the held HTLC. No race, no special deployment state, no victim interaction; fully reproducible over the public API.

## Recommended fix
1. unlockFunds is executed before the SendPayment result is examined and removes every reservation matching the invoice string, so a failed duplicate submission erases the reservation of a payment still in flight. Fix criteria: A reservation may only be removed when lnd has reported a terminal state (success or definitive failure) for THAT payment attempt; a 'payment is in transition' or other non-terminal error must leave existing reservations intact. Verify: submit an invoice twice while the first HTLC is held; getCalculatedBalance must continue to reflect the reserved amount until the first payment settles or fails.
2. /payinvoice does not detect that the invoice (payment_hash) is already pending for this user, allowing the duplicate submission that triggers the unlock path. Fix criteria: Before lockFunds/call.write, reject or short-circuit an invoice whose payment_hash already has a live reservation or a recorded payment for the user, and key reservations by payment_hash/attempt id rather than by raw string so they cannot alias. Verify: the second submission is refused and no Redis write to locked_payments_for_ occurs.

---
**Severity:** HIGH
**Status:** Open
**Category:** Business logic error
**CWE:** [CWE-841](https://cwe.mitre.org/data/definitions/841.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5257880

---

# TLS certificate verification disabled process-wide, exposing admin macaroon and settlement data to MITM

## Details
index.js:6 sets `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` as the first thing the server does, before any module that opens a TLS connection is loaded. Node reads this variable at each `tls.connect` call and defaults `rejectUnauthorized` to `false` unless the caller sets it explicitly (documented Node behaviour: the value '0' disables certificate validation for TLS and HTTPS). The flag is global and unconditional; nothing re-enables verification for any connection in the process.

Affected outbound paths in this codebase:
1. lnd gRPC (lightning.js:24-57): the channel pins lnd's `tls.cert` via `grpc.credentials.createSsl(lndCert)`, attaches the **admin macaroon** to every RPC via metadata, sends `config.lnd.password` in `unlockWallet` when configured, and targets `config.lnd.url` over the network (default `1.1.1.1:10009`; the README's Heroku deployment reaches a remote lnd over the public Internet). ASSUMPTION about @grpc/grpc-js 1.3.7 (package-lock pin; not installed in the checkout): its secure channel credentials pass `{secureContext, servername, [checkServerIdentity]}` to `http2.connect`/`tls.connect` without an explicit `rejectUnauthorized` (the option was only added to grpc-js VerifyOptions in 1.10), so Node's env-derived default (`false`) applies and the pinned CA is not enforced. Under that assumption an on-path attacker between the hub and lnd terminates TLS with any certificate, receives the admin macaroon from the first RPC (full control of the operator's lnd node: funds, channels, payments) and can feed the hub fabricated `DecodePayReq`, `LookupInvoice`, `SendPayment` and `GetTransactions` responses, which User.js and the /payinvoice flow turn directly into user credits and debits. If grpc-js 1.3.7 does set `rejectUnauthorized` explicitly, this path does not apply and the finding is limited to path 2.
2. GroundControl push (controllers/api.js:93-103): `node-fetch` 2.6.1 uses Node's `https.request` with no `rejectUnauthorized` option, so the env default governs. Every settled invoice's `preimage`, `hash`, `memo` and `amt_paid_sat` is POSTed to `${GROUNDCONTROL}/lightningInvoiceGotSettled`; an on-path attacker impersonating the GroundControl host collects preimages (proofs of payment) and settlement metadata for all users. The response is only logged, so this path leaks data but does not alter hub state.
3. bitcoind (bitcoin.js) uses jayson's plain-HTTP client and Redis (ioredis, no `tls` option in config) is plaintext; both are unaffected by TLS settings.

The project's own control for this surface is certificate pinning (lightning.js:24; README: copy `tls.cert` / supply `TLSCERT`), which index.js:6 silently defeats. The threat model's description of hub ↔ lnd as a 'trusted transport' rests on this verification; the code contradicts it.

## Evidence
1. [index.js:6](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/index.js#L6)
   Primary location and the fix point: `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` is executed before any module that opens a TLS connection is required. Node reads this variable at every `tls.connect` call (lib/internal/options.js getAllowUnauthorized) and uses `rejectUnauthorized: !allowUnauthorized` as the default unless the caller passes `rejectUnauthorized` explicitly; Node's documentation states the value '0' disables certificate validation for TLS and HTTPS. Nothing in the process re-enables verification for any connection.
2. [lightning.js:24–57](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/lightning.js#L24-L57)
   The lnd channel is built with `grpc.credentials.createSsl(lndCert)` (the project's cert-pinning control) combined with a metadata generator that attaches the hex admin macaroon to every RPC (lines 32-37); `unlockWallet` additionally sends `config.lnd.password` (lines 40-54) and the Lightning client targets `config.lnd.url` over the network (line 57). ASSUMPTION (dependency not installed in the checkout): @grpc/grpc-js 1.3.7 (package-lock pin) builds its connection options as `{secureContext, servername, [checkServerIdentity]}` and passes them to `http2.connect('https://…')` without an explicit `rejectUnauthorized` (that option was only added to VerifyOptions in grpc-js 1.10), so Node's env-derived default applies and the pinned certificate is never enforced; an impersonating endpoint receives the admin macaroon on the first RPC.
3. [controllers/api.js:93–103](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L93-L103)
   node-fetch 2.6.1 (`https.request` with no `rejectUnauthorized` option) POSTs every settled invoice's payment hash, preimage, memo and amt_paid_sat to `${process.env.GROUNDCONTROL}/lightningInvoiceGotSettled`; with verification disabled, any host that terminates that TLS connection is accepted and collects the settlement data of every user.
4. [config.js:17–19](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/config.js#L17-L19)
   The default `lnd.url` is a remote host:port (`1.1.1.1:10009`), and `config.lnd.password` is sent over the same channel: lnd is reached over the network, so TLS certificate verification is the only thing that authenticates the peer.
5. [README.md:20–37](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/README.md#L20-L37)
   The README instructs operators to copy `tls.cert` next to `admin.macaroon` and, for Heroku, to supply `TLSCERT` and `MACAROON` as env vars: the project intends lnd to be authenticated by its certificate, and documents a deployment (Heroku → remote lnd over the public Internet) where that verification is the only protection against an on-path attacker. No documentation tells operators to confine lnd to a trusted network.

## Impact
Confidentiality high: all users' settlement preimages, hashes and memos transit to the impersonator on the GroundControl path, and, under the stated grpc-js 1.3.7 assumption, the admin macaroon and wallet password on the lnd path. Integrity high (grpc-js assumption): an impersonated lnd dictates decoded invoice amounts/destinations, payment results and chain transactions, which User.js and /payinvoice turn directly into balance credits and debits, and the captured admin macaroon gives direct control of the operator's lnd funds — the hub's primary asset per the threat model, so rated here rather than as a subsequent system. Availability low: the impersonator can stall or fail lnd calls. The grpc-js link could not be verified in the checkout; the GroundControl path alone supports only the confidentiality impact.

## Reproduction steps
1. The attacker needs an on-path (machine-in-the-middle) position between the hub process and either the lnd node (under the grpc-js assumption) or the GroundControl host — e.g. on the Internet path of a Heroku-hosted hub to a remote lnd, or any hop of a Docker/Umbrel deployment where lnd is a separate instance. They present any certificate; the hub accepts it because verification is disabled globally. On the lnd path the first RPC delivers the admin macaroon in metadata (and `unlockWallet` the wallet password); on the GroundControl path each settlement delivers preimage, hash and memo. No credentials or user action are needed; the on-path position is the sole requirement (AT:PRESENT).

## Recommended fix
A process-wide environment override (index.js:6) disables certificate verification for every TLS client in the hub, so the authenticity of lnd, GroundControl and any other HTTPS peer is never checked and the lnd certificate pin in lightning.js is void. Fix criteria: The application does not set NODE_TLS_REJECT_UNAUTHORIZED; every outbound TLS connection verifies the peer certificate against the intended trust anchor (lnd's tls.cert for gRPC, the system or operator CA for GroundControl), and any peer whose certificate does not verify is refused before the admin macaroon, wallet password or settlement data is sent. Where an operator must accept a self-signed GroundControl certificate, it is pinned per connection rather than verification being disabled globally.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper Certificate Validation
**CWE:** [CWE-295](https://cwe.mitre.org/data/definitions/295.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5257878

---

# Unauthenticated /queryroutes proxies arbitrary QueryRoutes to the hub's lnd with mission control

## Details
`GET /queryroutes/:source/:dest/:amt` (controllers/api.js:505-518) is reachable with no Authorization header. It builds `{pub_key: req.params.dest, source_pub_key: req.params.source, amt: req.params.amt, use_mission_control: true}` from the raw URL parameters and passes it to `lightning.queryRoutes`, the gRPC client authenticated to lnd with the admin macaroon (lightning.js:24-58), then `res.send`s whatever lnd returns (and dumps it to stdout). Every other lnd-backed route in the file begins with `User.loadByAuthorization` and returns `bad auth` otherwise; this one has no `User` at all, and nothing in the repository documents it as a public endpoint (doc/Send-requirements.md:11 states only `/create` is callable without a token).

What the anonymous position gains that no sanctioned path concedes to it:
- Mission-control disclosure: `QueryRoutesResponse.success_prob` (rpc.proto:2420-2424) is lnd's success probability for the returned route 'based on the current mission control state', i.e. the hub node's private record of which node pairs its own recent payments succeeded or failed through. Because `source_pub_key` is attacker-chosen, a single-hop query between two directly connected nodes reads the hub's mission-control estimate for that exact pair, letting an outsider probe aggregate payment-destination history of the hub's users. No authenticated route exposes this: `Paym.queryRoutes` is dead from the HTTP layer and `/payinvoice` returns only the payment result.
- Privileged RPC on demand: the caller drives an admin-macaroon lnd RPC with arbitrary endpoints and amounts, without an account or balance. QueryRoutes performs full-graph pathfinding per call on the production lnd node that all hub payments depend on. The only brake is the global express-rate-limit (200/15 min, index.js:23-27) keyed by `req.ip`, which under `app.enable('trust proxy')` (index.js:19) is the leftmost client-supplied X-Forwarded-For value; that keying weakness is a separate issue, but it means this route has no effective per-caller bound.

Integrity is unaffected (QueryRoutes is read-only). On lnd error the handler sends `undefined` (empty 200), so no error text leaks. Assumption on lnd (infrastructure, version not pinned in this repository): `success_prob` is computed from mission control irrespective of the `use_mission_control` flag, as rpc.proto documents.

## Evidence
1. [controllers/api.js:505–518](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L505-L518)
   The route builds a QueryRoutes request from three raw URL parameters (source_pub_key, pub_key, amt), forces use_mission_control: true, and calls lightning.queryRoutes without constructing a User or calling loadByAuthorization; the entire lnd response (routes and success_prob) is console.log'd and res.send'd to the anonymous caller. No input validation.
2. [lightning.js:24–57](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/lightning.js#L24-L57)
   The gRPC client the route uses is authenticated with the admin macaroon (file or MACAROON env), so the anonymous caller's parameters are executed with the operator's full lnd privileges.
3. [rpc.proto:2413–2425](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/rpc.proto#L2413-L2425)
   QueryRoutesResponse.success_prob is documented by lnd as 'the success probability of the returned route based on the current mission control state' — the hub's private record of its own past payment attempts — and the route returns it verbatim, for any attacker-chosen source/dest pair.
4. [controllers/api.js:174–179](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L174-L179)
   Every other lnd-backed route (/addinvoice shown) begins with User.loadByAuthorization and returns 'bad auth' otherwise; /queryroutes is the only lnd RPC-forwarding route without this prologue, and no document in the repository declares it a public endpoint (doc/Send-requirements.md:11 says only /create is token-free).
5. [class/Paym.js:30–45](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/Paym.js#L30-L45)
   The authenticated code path's QueryRoutes (Paym.queryRoutes/attemptPayToRoute) is never invoked from any route — /payinvoice uses streaming sendPayment and returns only the payment result — so no sanctioned path hands even an authenticated user route data or mission-control probabilities; the unauthenticated route is the sole exposure.

## Impact
Confidentiality LOW: discloses mission-control-derived success probabilities for arbitrary node pairs — indirect information about the hub's (and so its users') recent payment routing — plus route/fee data computed with the hub's private state; no credentials or balances leak. Integrity NONE: QueryRoutes is read-only. Availability LOW: each anonymous call forces full-graph pathfinding on the lnd node every hub payment depends on, with no effective per-caller bound; cost per call is bounded by the graph, so degradation rather than outage.

## Reproduction steps
1. Any network client issues GET /queryroutes/<src>/<dst>/<amt> with no credentials. The handler forwards the three parameters to lnd with the admin macaroon and returns the full response. No account, token, balance, or deployment precondition is required; the per-IP limiter is keyed on a client-supplied header and is not a security mechanism the attacker must defeat.

## Recommended fix
The route executes a privileged (admin-macaroon) lnd RPC with caller-chosen parameters and returns the hub's mission-control-derived results to a caller whose identity is never established, unlike every other lnd-backed route in controllers/api.js. Fix criteria: /queryroutes either requires a valid bearer token via the same loadByAuthorization prologue as the other routes (returning 'bad auth' and making no lnd call otherwise) or is removed. If retained as an authenticated feature, source_pub_key should not be caller-controlled and success_prob should be stripped from the response so mission-control state is not disclosed. Verify by requesting the route without Authorization and confirming no QueryRoutes RPC reaches lnd.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing Authentication
**CWE:** [CWE-306](https://cwe.mitre.org/data/definitions/306.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5257759

---

# Bearer and refresh tokens never expire, are never revoked and are interchangeable

## Details
LndHub issues two 20-byte random tokens per login (`_generateTokens`, class/User.js:487-498) and stores both under `userid_for_<token>` with `SET` and no `EXPIRE`. Nothing in the codebase ever deletes a `userid_for_*` key (the only writers are User.js:494-495, the only readers User.js:49 and :60; scripts/ never touch the prefix): a new login or a refresh adds two more permanent keys and leaves all earlier ones valid, because `access_token_for_<uid>` / `refresh_token_for_<uid>` are overwritten but never consulted on the authentication path. There is no logout, revoke or password-change endpoint; login and password are fixed at `/create`, and the operator recovery procedure in doc/recover.md re-points a fresh login at the old userid without touching old tokens, so neither the victim nor the operator (short of hand-editing Redis) can evict a leaked token.

Because both token kinds live under the same prefix, the distinction between them is void: `loadByAuthorization` (User.js:46-57) accepts a refresh token as a Bearer token on every authenticated route, and `loadByRefreshToken` (User.js:59-68), reached from `POST /auth` (api.js:159-165), accepts an *access* token as a refresh token and mints a fresh pair for it without invalidating the presented one. The access token is the credential the client sends on every request, so it is exposed to every TLS-terminating reverse proxy, CDN and request log on the path (the app runs with `trust proxy` enabled and is deployed behind a proxy; the hub's own morgan line does not record the header, so exposure is upstream of the process or on the client device). An attacker who obtains any single token once gains permanent control of a funded custodial wallet (balance, history, deposit address and the ability to spend via `/payinvoice`), can mint unlimited further pairs indistinguishable from the legitimate client's, and cannot be evicted.

This contradicts the project's own documentation: doc/schema.md lists the four token keys under 'with TTL', and doc/Send-requirements.md:36 states a used refresh_token is 'not available for access once again'. It is an insufficient-session-expiration weakness (CWE-613) in a system where the session grants spending authority over real funds. A secondary effect is unbounded growth of Redis: each `/auth` call permanently adds two keys, and the only brake is the in-process rate limiter, which under `trust proxy` is keyed by the client-controlled leftmost X-Forwarded-For address.

## Evidence
1. [class/User.js:487–498](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L487-L498)
   _generateTokens writes userid_for_<access>, userid_for_<refresh>, access_token_for_<uid>, refresh_token_for_<uid> with plain SET and no EXPIRE; the previously issued userid_for_* keys are not deleted (no DEL of this prefix exists anywhere in class/, controllers/ or scripts/), so every token ever issued to an account remains valid forever.
2. [class/User.js:46–68](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L46-L68)
   loadByAuthorization and loadByRefreshToken both resolve the presented string via GET userid_for_<token>; because access and refresh tokens share that prefix, either kind is accepted as a Bearer token on every route and either kind is accepted by /auth to mint a brand-new pair. access_token_for_/refresh_token_for_ are never consulted on the authentication path.
3. [controllers/api.js:153–172](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L153-L172)
   /auth with refresh_token calls loadByRefreshToken and returns a fresh pair without invalidating the presented token; there is no logout, revoke or password-change route anywhere in the router, so an account holder has no way to invalidate an exposed token.
4. [doc/schema.md:6–11](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/doc/schema.md#L6-L11)
   The documented storage schema places userid_for_{access_token}, userid_for_{refresh_token}, access_token_for_, refresh_token_for_ under 'with TTL'; the implementation sets no TTL, so the code contradicts its own stated guarantee.
5. [doc/Send-requirements.md:36](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/doc/Send-requirements.md#L36)
   The API design states that once a refresh_token is used at /auth it is 'not available for access once again' (single-use rotation); loadByRefreshToken never deletes or rotates the presented token, so the documented rotation guarantee is not implemented either.

## Impact
A valid token grants the full authority of the account: read balance, transaction and invoice history, deposit address (confidentiality high), and spend the balance through /payinvoice or redirect incoming funds (integrity high). No availability impact beyond unbounded key growth.

## Reproduction steps
1. Attacker is any party that has seen one access or refresh token of a victim account (proxy/CDN/request logs, a shared or lost device, a screenshot of the client's debug screen). They present it as `Authorization: Bearer <token>` to any route, or POST it as `refresh_token` to /auth to mint their own fresh pair. No further step is needed, the token never expires and the victim has no revocation path, so the access is permanent. The only precondition is prior exposure of a token, hence AT:PRESENT.

## Recommended fix
1. Tokens are written with SET and no TTL, so a session credential, once issued, is valid indefinitely; the schema's documented TTL is not implemented. Fix criteria: Every userid_for_<access_token> key has a short TTL and every userid_for_<refresh_token> key a bounded TTL (or server-side expiry check); after the TTL a request with the old token receives 'bad auth'. Verified by inspecting TTL on freshly issued keys and by replaying an expired token.
2. Refresh/re-login never invalidates previously issued tokens, and there is no revocation endpoint, so an exposed token cannot be evicted. Fix criteria: A refresh or re-login deletes the previously issued access and refresh tokens for the account (or tokens are bound to a per-user generation counter), and an authenticated logout/revoke operation exists. Verified by confirming an old token is rejected after refresh.
3. Access and refresh tokens are stored under one prefix, so each kind is accepted where the other is expected (access token usable at /auth to mint new pairs; refresh token usable as Bearer). Fix criteria: Access tokens and refresh tokens are stored and looked up under distinct namespaces; /auth rejects access tokens and loadByAuthorization rejects refresh tokens. Verified by presenting each kind at the wrong endpoint and receiving 'bad auth'.

---
**Severity:** HIGH
**Status:** Open
**Category:** Insufficient Session Expiration
**CWE:** [CWE-613](https://cwe.mitre.org/data/definitions/613.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5257758

---

# Unbounded per-user invoice list makes every balance computation cost O(N) lnd RPCs and signature recoveries

## Details
User.getUserInvoices (class/User.js:271-327) is the per-request accounting loop behind every balance computation. It reads the user's entire `userinvoices_for_<uid>` list and, for each stored invoice, (1) decodes the bolt11 string with the bolt11 library - which performs an ECDSA public-key recovery on the invoice signature, synchronous CPU work on the single Node event loop - (2) issues a Redis GET for `ispaid_<hash>`, and (3) if the invoice is unpaid and younger than five days, issues an awaited lnd `LookupInvoice` RPC (syncInvoicePaid) followed by another Redis GET. Unpaid invoices are never cached, so the cost is paid again on every call.

The length N of that list is controlled by the user: `/addinvoice` (controllers/api.js:174-200) appends one entry per call, there is no per-user cap, no pruning and no expiry (invoices expire in lnd after 24 h but stay in the list and keep being looked up for 5 days). The only brake is `postLimiter` (100 requests / 30 min keyed on req.ip) - 4,800 per day, ~24,000 within the 5-day lookup window per IP, and `app.enable('trust proxy')` (index.js:19) keys that limiter on an attacker-supplied X-Forwarded-For value, so the brake is removable.

Once the list is built, each cheap request by the attacker makes the hub do O(N) work: `/payinvoice` calls getCalculatedBalance unconditionally (api.js:225), `/getuserinvoices` without `?limit` returns the whole list (api.js:451) and is not serialised by any lock, and `/balance` recomputes on every call for an account whose cached balance is 0 because `getBalance` uses `if (!balance)` (User.js:148). With N = 24,000 a single request costs ~24,000 serial admin-macaroon RPCs to lnd plus 24,000 signature recoveries; the attacker can run many such requests concurrently from several free accounts, each account carrying its own list. Honest users' requests share the same event loop and the same lnd connection and are delayed by the aggregate CPU and RPC time; lnd itself absorbs the lookup load.

This is state-accumulation amplification rather than volumetric flooding: the attacker's steady-state traffic is a handful of requests, the work per request grows without bound with state they built earlier, and nothing in the code caps or paginates the list, caches negative lookups, or stops looking up invoices that have already expired.

Dependency assumptions: bolt11 1.3.2 `decode()` recovers the payee public key from the signature (secp256k1 3.8.0 `recover`; native addon when it loads, elliptic 6.6.1 pure-JS fallback otherwise - the Docker image compiles addons on node:16-bullseye-slim and runs on node:16-alpine, so the fallback is likely in the shipped image), and @grpc/grpc-js 1.3.7 serialises these unary calls over one HTTP/2 session.

## Evidence
1. [class/User.js:271–326](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L271-L326)
   getUserInvoices LRANGEs the user's whole userinvoices_for_ list (no pagination when called without limit), and for EVERY entry runs lightningPayReq.decode (bolt11 1.3.2: secp256k1 public-key recovery on the invoice signature, synchronous CPU on the event loop), a Redis GET, and - for every entry not marked paid whose timestamp is younger than 5 days - an awaited lnd lookupInvoice RPC via syncInvoicePaid (line 308) plus a second Redis GET (line 309). Unpaid invoices are never cached (the static cache at 311-313 is written only for paid ones), so the full cost recurs on every call.
2. [class/User.js:161–163](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L161-L163)
   getCalculatedBalance calls getUserInvoices() with no limit; it is the balance authority used on every /payinvoice and on every /balance cache miss.
3. [class/User.js:146–152](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L146-L152)
   getBalance treats a cached balance of 0 as a miss (`if (!balance)`), so an attacker account holding zero sats never benefits from the 30-minute balance_for_ cache: every /balance call recomputes.
4. [controllers/api.js:174–199](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L174-L199)
   Source of N: /addinvoice appends one entry to userinvoices_for_ per call with no per-user cap, no pruning and no expiry of the list; the only throttle is postLimiter keyed by req.ip.
5. [controllers/api.js:223–225](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L223-L225)
   /payinvoice awaits getCalculatedBalance unconditionally (no cache) on every call.
6. [controllers/api.js:442–456](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L442-L456)
   /getuserinvoices calls getUserInvoices directly; omitting ?limit returns the whole list, and the route is not serialised by any lock, so many requests run concurrently.
7. [index.js:19–27](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/index.js#L19-L27)
   app.enable('trust proxy') makes req.ip the leftmost X-Forwarded-For value, so the per-IP express-rate-limit windows that bound /addinvoice and the triggering GETs are bypassable by the same client; even without bypass the limiter allows 4,800 /addinvoice per day per IP.

## Impact
No data is read or altered. The per-request bound is the attacker's own list length, which the code never fixes, so the shipped rate limit no longer bounds load: each sanctioned request becomes N lnd RPCs plus N synchronous secp256k1 recoveries on the single event loop, delaying every other user's requests (including payments, whose per-user lock is then held longer) and loading the operator's lnd. Rated LOW: requests still complete, degradation scales with the attacker's concurrency, and the CPU share depends on an unverified dependency assumption (bolt11 1.3.2 decode recovering the payee key; native secp256k1 vs the elliptic fallback in the alpine image).

## Reproduction steps
1. Attacker: any authenticated user (accounts are free via /create). Preparation: call /addinvoice (amt 1) repeatedly; nothing caps, prunes or expires userinvoices_for_, so N grows to tens of thousands within the shipped limiter (100/30 min per req.ip, ~4,800/day; faster with several IPs or by setting X-Forwarded-For, which `trust proxy` makes req.ip). Trigger: /getuserinvoices without ?limit, /balance (cached 0 is treated as a miss) or /payinvoice; each costs the hub N bolt11 signature recoveries and N serial admin-macaroon lnd LookupInvoice RPCs, repeatable 100 times per 30 min per IP and across accounts. No race, no non-default configuration, no victim interaction.

## Recommended fix
1. getUserInvoices performs an lnd RPC and a signature recovery per stored invoice on every balance computation, over a list whose length the user grows without bound. Fix criteria: Balance computation must not scale with the number of unpaid invoices a user has created: cache negative lookups or stop polling invoices once lnd reports them expired/cancelled, persist decoded fields (payment_hash, amount, timestamp) at save time instead of re-decoding, and cap or prune userinvoices_for_ (e.g. drop expired unpaid invoices older than their expiry). Verify: a user with 20,000 unpaid invoices triggers at most a bounded, small number of lnd RPCs and decodes per /balance or /payinvoice.
2. /getuserinvoices returns the unbounded list by default and /balance recomputes on a zero cached balance. Fix criteria: Default and maximum page sizes on /getuserinvoices; the balance cache must distinguish 'not cached' from a cached 0. Verify: /getuserinvoices without limit returns at most the page maximum; two consecutive /balance calls on a zero-balance account trigger one computation.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Unbounded resource allocation
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5258076

---

# Payment lock expires inside internal-payment balance computation, allowing two debits of one balance

## Details
All balance-changing work in POST /payinvoice is serialised per user only by `invoice_paying_for_<uid>`, a Redis key with a fixed 300 s TTL (class/Lock.js:27) that is never renewed. The critical section it guards begins with `getCalculatedBalance()` (controllers/api.js:225), which for every stored invoice that is unpaid and younger than five days performs an awaited lnd `LookupInvoice` round trip (class/User.js:305-310). The number of such invoices is entirely under the user's control through /addinvoice, so the user can make their own balance computation take longer than the lock's TTL. When it does, a second /payinvoice from the same account acquires a fresh lock and runs concurrently; both requests compute their balance from `txs_for_` before either has written its debit, both pass the gate at api.js:245, and both internal-branch debits are RPUSHed at api.js:269 (each to a different hub invoice owned by other attacker accounts, so the per-invoice `ispaid_` guard at line 257 does not interfere). The ledger goes negative by one full balance; the two payee accounts each hold a spendable copy.

What makes the second request finish at the same moment as the first, rather than 300 s later, is the asymmetric age cutoff: `decoded.timestamp > now - 5 days` is evaluated per invoice at processing time, so a request that reaches an invoice after it crosses the five-day boundary skips the lnd RPC (one Redis GET and a bolt11 decode instead of an lnd round trip). With a batch of N invoices created over a window W five days earlier at a rate r faster than the hub's per-invoice LookupInvoice rate but slower than its skip rate, a request R1 that starts before the batch ages out falls behind the moving boundary, skips, catches up, RPCs again — it 'surfs' the boundary and finishes within about one lnd round trip of the moment the youngest invoice ages out. A request R2 started after R1's lock lapsed (>=300 s later) skips the already-aged invoices in a few milliseconds each, catches the same boundary, and finishes within the same window. Both then read txs_for_ before either RPUSHes. Each attempt is a tight race on the post-loop sequence (lrange txs_for_ -> decodePayReq -> redis gets -> rpush), repeatable with a fresh batch of invoices; a failed attempt costs nothing (one transfer succeeds, the other returns 'not enough balance').

Preconditions: W > 300 s of invoice creation at a rate between 1/(lnd LookupInvoice round trip + decode) and 1/(Redis round trip + decode) — a few tens per second with a remote lnd (the README's Heroku deployment 'requires a separate instance of redis and LND'), a few hundred per second with lnd on the same host — which exceeds the 100-per-30-min postLimiter for a single IP; the limiter is an in-process MemoryStore keyed by req.ip with `trust proxy` enabled (index.js:19), so it is defeated by varying X-Forwarded-For (or by multiple source addresses). The attacker can calibrate the hub's per-invoice rates from the response time of /getuserinvoices. The attack needs no Lightning node, no held HTLC and no stale `releaseLock`; it is therefore a different reachable path from payinvoice-lock-unconditional-release-stale-handler-overlap (whose primary defect is ownership-less release on the external SendPayment path) and would survive a fix that only adds release ownership tokens or extends the lock across SendPayment. A fix for this path must bound or exclude the per-invoice lnd RPC loop from the locked section, keep the lock alive for the whole computation, or make the debit conditional on a fresh atomic balance check.

Assumptions on pinned dependencies and runtime: express 4.17.1 with `trust proxy` = true takes req.ip from the leftmost X-Forwarded-For entry; express-rate-limit 5.4.1 keys its MemoryStore on req.ip; the shipped runtime is node:16-alpine (Dockerfile), where the HTTP server has no default request timeout, so a multi-minute /payinvoice handler keeps running to its RPUSH even if a reverse proxy drops the client connection (the handler has no abort handling). lnd LookupInvoice latency (external, unpinned) is assumed measurably larger than a Redis GET plus a bolt11 decode, which holds for any out-of-process lnd.

## Evidence
1. [class/User.js:305–310](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L305-L310)
   Inside the per-user payment lock, getUserInvoices issues one awaited lnd LookupInvoice RPC (via syncInvoicePaid, line 308) for every stored invoice that is unpaid and whose bolt11 timestamp is within the last five days. The age cutoff `+new Date()/1000 - 432000` (line 306) is re-evaluated per invoice at processing time, and the list length is set by how many /addinvoice calls the user has made, so the duration of this loop is attacker-sized and unbounded, and a later request skips exactly the invoices that aged out while the earlier one was working.
2. [class/Lock.js:18–29](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/Lock.js#L18-L29)
   obtainLock is SETNX + EXPIRE 300 s. Nothing refreshes the TTL while the holder is still working; once it lapses a second request for the same user acquires the key while the first is still inside its critical section.
3. [controllers/api.js:217–245](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L217-L245)
   The critical section begins with obtainLock, then runs the full getCalculatedBalance (the slow loop above), then an lnd decodePayReq, and only then evaluates the balance gate against the snapshot it read. No re-check or lock-liveness check happens between the snapshot and the write.
4. [controllers/api.js:248–294](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L248-L294)
   Internal branch: the only guards after the gate are payee existence and ispaid_<hash> for THIS invoice (line 257). Two requests paying two different hub invoices (to two other attacker accounts) both pass, and each unconditionally RPUSHes a full debit into txs_for_<payer> (line 269) and marks its payee's invoice paid. No external node, SendPayment stream or releaseLock is involved.
5. [class/User.js:161–187](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L161-L187)
   getCalculatedBalance reads userinvoices (slow loop) first and txs_for_ (where the debits land) last, so a request's debit visibility is determined by when it finishes the invoice loop relative to the other request's txs_for_ read.
6. [controllers/api.js:174–199](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L174-L199)
   /addinvoice lets any account create unlimited unpaid hub invoices (each stored in userinvoices_for_ and each later costing a LookupInvoice RPC in every balance computation for five days). The only throttle is the in-process per-IP limiter.
7. [index.js:19–27](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/index.js#L19-L27)
   `app.enable('trust proxy')` trusts every hop, so req.ip is the leftmost X-Forwarded-For entry the client supplies; the express-rate-limit MemoryStore (keyed by req.ip) and postLimiter are therefore defeated by varying that header, letting one account create invoices at the rate the attack needs.

## Impact
Two full-balance debits are authorised against a single balance snapshot: the payer's ledger ends negative and the two payee accounts hold twice the deposited amount, which they can withdraw over Lightning from the operator's liquidity. Integrity of the custodial ledger and the operator's funds is defeated; no confidentiality or availability impact.

## Reproduction steps
1. Authenticated user (free account) pre-creates several thousand to tens of thousands of unpaid hub invoices over a window longer than 300 s at a steady rate exceeding the hub's per-invoice lnd LookupInvoice rate (bypassing the per-IP limiter via X-Forwarded-For under trust proxy), funds the account, waits five days, then issues one internal /payinvoice to a second own account as the batch begins to cross the five-day cutoff and a second internal /payinvoice to a third own account once the 300 s lock has lapsed. Both converge on the ageing boundary, both pass the balance gate, and both debits are written when the finishing order lands in the post-loop window; the race is retryable at no cost. Timing and throughput conditions must hold and a millisecond-scale race must be won, so attack requirements are present; no exploit-mitigation evasion is needed.

## Recommended fix
1. The per-user payment lock has a fixed 300 s TTL while the locked section contains an attacker-sized loop of awaited lnd RPCs, so the lock can lapse before the holder reaches its balance gate and debit. Fix criteria: The serialisation of /payinvoice per user must hold for the entire duration of the balance computation and debit (e.g. the lock is kept alive while work proceeds and the holder aborts if it is no longer the owner), or the balance computation inside the lock must be bounded and free of per-invoice remote calls. Verify: with an account holding tens of thousands of recent unpaid invoices, a second /payinvoice issued >300 s after the first cannot pass the balance gate against the same snapshot.
2. The debit is written unconditionally after a balance snapshot that may be arbitrarily stale, with no atomic re-validation at write time. Fix criteria: The debit must be applied only if the balance is still sufficient at the moment of writing (atomic check-and-debit, e.g. a Lua script or a reservation keyed by request), so that two concurrent requests cannot both consume the same funds. Verify: two overlapping internal payments whose sum exceeds the balance result in exactly one debit.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-667](https://cwe.mitre.org/data/definitions/667.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5258075

---

# /checkpayment reveals and syncs settlement state of any invoice hash without ownership check

## Details
GET /checkpayment/:payment_hash (controllers/api.js:363-378) is meant for an invoice's creator to poll whether their invoice was settled. The route authenticates the caller (any account from the open /create endpoint) but performs no authorization: the path parameter is used directly as the key of the shared `ispaid_<hash>` map and, on a miss, as the `r_hash_str` of an lnd `LookupInvoice` call whose `settled` result is both returned and persisted into `ispaid_<hash>` (class/User.js:256-269). The owner map `payment_hash_<hash>` written by `saveUserInvoice` (User.js:221) is never checked.

Consequences for the authenticated adversary of the threat model:
- Confidentiality: anyone who obtains a hub invoice string (it is routinely shared out-of-band, printed as QR, posted for donations) can extract its payment hash and poll `/checkpayment/<hash>` to learn, in real time, whether and when another user's invoice was paid. The response is also distinguishable for hashes that exist on the hub's lnd but belong to no hub user (operator invoices): `true` when settled.
- The call forces an lnd `LookupInvoice` RPC and a Redis write for a hash the caller does not own. The written value is lnd's own `amt_paid` for a settled invoice, so this is the same write the `subscribeInvoices` callback would perform and does not by itself corrupt the ledger; it does however let any user drive the reconciliation of other users' invoices (and `clearBalanceCache` of their own account), which the threat model lists under affecting other users' state through global keys.

The primary impact is the information disclosure of payment status for arbitrary invoices on the hub to any registered account. The hash is a 32-byte value, so enumeration is infeasible; the attacker must already hold the invoice string, which is why the impact is rated low.

## Evidence
1. [controllers/api.js:363–378](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L363-L378)
   After loading the caller by bearer token, the handler takes req.params.payment_hash verbatim and returns whether ispaid_<hash> exists; if it does not, it calls syncInvoicePaid(hash), which queries the hub's lnd and writes ispaid_<hash>. At no point is payment_hash_<hash> (the owner map) compared with u.getUserId().
2. [class/User.js:256–269](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L256-L269)
   getPaymentHashPaid and syncInvoicePaid read/write the global ispaid_ map keyed only by the supplied hash; syncInvoicePaid issues lnd LookupInvoice for that hash and SETs the settled amount, then clears the caller's (not the owner's) balance cache.
3. [class/User.js:212–230](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L212-L230)
   saveUserInvoice records the owner of every hub invoice in payment_hash_<hash> and getUseridByPaymentHash exposes it; the authorization data exists but /checkpayment never consults it.

## Impact
Discloses to an unrelated account whether a specific invoice of another user (or of the operator) has been settled, i.e. payment-activity information bound to a hash the attacker must already possess. No modification of ledger values beyond writes that mirror lnd's authoritative state; no availability effect.

## Reproduction steps
1. Attacker registers via /create (open), obtains a token, decodes any hub invoice they have seen (e.g. a public donation invoice or one shown to them as a would-be payer) to get its payment hash, and calls GET /checkpayment/<hash>. The hub answers with the invoice's settlement state and triggers lnd LookupInvoice plus a Redis write for that hash. No victim interaction, no special deployment state.

## Recommended fix
The handler trusts the caller-supplied payment hash as a resource identifier without verifying that the authenticated user owns the invoice (payment_hash_<hash> == userid), violating object-level authorization. Fix criteria: Settlement status (and the lnd lookup / ispaid_ write it triggers) must only be available for hashes whose payment_hash_<hash> owner equals the caller's userid; other hashes must receive a uniform not-found/forbidden response. Verify: user B calling /checkpayment with the hash of user A's invoice gets no settlement information and causes no lnd LookupInvoice or Redis write.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** IDOR/BOLA
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5258073

---

# Payment lock released unconditionally by stale handler after expiry, letting two /payinvoice critical sections overlap

## Details
All balance-changing work in POST /payinvoice is serialised per user solely by the Redis key invoice_paying_for_<uid> (controllers/api.js:218-221). Lock.obtainLock (class/Lock.js:18-30) sets a fixed 300 s TTL, but the protected section for an external payment lasts until lnd's streaming SendPayment result arrives in the 'data' handler (api.js:300-317), which then calls lock.releaseLock(). Lock.releaseLock (Lock.js:32-34) is an unconditional DEL with no ownership check.

Once an external payment has been pending for more than five minutes its request still holds a Lock object for the user's key. When that payment resolves, the stale handler deletes the lock a newer /payinvoice request (R2) legitimately acquired, and a third request (R3) can obtain the key while R2 is still between its getCalculatedBalance() snapshot (api.js:225) and its balance-changing write. For internal payments that write is savePaidLndInvoice (api.js:269, RPUSH txs_for_), reached only after decodePayReq and four awaited Redis reads; getCalculatedBalance (User.js:161-188) recomputes from the Redis lists, so if R3's read of txs_for_ (User.js:351) precedes R2's RPUSH both pass the gate at api.js:245 and both are paid: the ledger goes negative by one full balance, which the attacker's other accounts withdraw.

The attacker controls both triggers: R2's send time, and the moment the held HTLC is settled at their own node, which fires the stale release. The window R3 must enter is the interval between R2's txs_for_ read and its RPUSH (one lnd decodePayReq round trip plus roughly six Redis round trips); the getUserInvoices loop and the _listtransactions refetch do not widen it, because R3 pays the same cost before its own read (a concurrent caller sees the cache as false at User.js:400 and refetches too). The attacker can carpet the window by accumulating several held payments (one new hold payment per five-minute lock lapse), each with its own stale handler, and settling them a few milliseconds apart; a burst of R3 candidates costs nothing (lock refusal or insufficient balance), and a missed attempt only moves funds to another attacker account at the intraHubFee (0.3 % default).

Assumption on lnd (external, unpinned): lnrpc.SendPayment does not return while an outgoing HTLC is held by the destination; the request carries no timeout and lightning.js sets no gRPC deadline. The project itself anticipates such payments (scripts/process-locked-payments.js reconciles reservations older than one day).

The non-atomic LRANGE/DEL/RPUSH in User.unlockFunds, and the unconditional unlockFunds on same-invoice resubmission, are separate defects recorded on their own. obtainLock's non-atomic SETNX+EXPIRE is not attacker-triggerable and is not part of this finding.

## Evidence
1. [class/Lock.js:32–34](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/Lock.js#L32-L34)
   releaseLock is a bare DEL of the key with no ownership token or compare-and-delete. A holder whose lock already expired therefore deletes whatever lock a newer request currently holds under the same key.
2. [class/Lock.js:18–29](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/Lock.js#L18-L29)
   obtainLock gives the key a fixed 300 s TTL ('just for any case'). The /payinvoice critical section it guards ends only when lnd's SendPayment stream delivers a result, which for an HTLC held by the remote destination exceeds five minutes, so the lock routinely expires while its owner is still active.
3. [controllers/api.js:300–317](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L300-L317)
   The sendPayment 'data' handler closes over the request's Lock object and calls lock.releaseLock() at lines 310 and 314 whenever the payment finally resolves, regardless of how long ago its own lock expired. It thereby deletes invoice_paying_for_<uid> while a newer request owns it.
4. [controllers/api.js:217–230](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L217-L230)
   The Redis lock is the only serialisation of /payinvoice per user; the balance snapshot used by the gate is computed at line 225, immediately after the lock is taken.
5. [controllers/api.js:245–276](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L245-L276)
   The gate at line 245 tests the stale snapshot. For an internal payment the first balance-affecting write is savePaidLndInvoice at 269-276, reached only after the asynchronous decodePayReq and several awaited Redis reads (251, 257, 265, 268). A third request that obtains the released lock and reads txs_for_ before this RPUSH passes the same gate against the same balance.
6. [class/User.js:161–187](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L161-L187)
   getCalculatedBalance recomputes the spendable balance from userinvoices_for_, txs_for_ (read in getTxs, line 351) and locked_payments_for_ on every call. Internal payments write no reservation before the debit (RPUSH to txs_for_ at 208-210), so two requests whose reads both precede either write both see the undebited balance.

## Impact
Two balance-changing payments are authorised against one balance snapshot, so the attacker extracts roughly twice their deposit from the operator's liabilities and, after withdrawal, from the operator's lnd liquidity. The custodial ledger's integrity is defeated and the loss is repeatable per five-minute cycle. No confidentiality impact; availability is not rated.

## Reproduction steps
1. Attacker: any user of the open /create endpoint who runs a Lightning node able to hold an HTLC. Pay a small hold invoice at that node; wait for the 300 s lock TTL; send an internal payment of the whole balance to a second attacker account while settling the held HTLC so the stale handler deletes the new lock; a burst of further internal payments to other attacker accounts follows, and the one entering before the second request's RPUSH is paid against the same balance. Both triggers are attacker-timed and attempts repeat every five minutes at negligible cost, but a millisecond-scale race must still be won (AT:P).

## Recommended fix
1. Lock.releaseLock deletes the lock key without proving ownership, so a request whose lock already expired removes a lock that now belongs to another request, breaking the mutual exclusion /payinvoice relies on. Fix criteria: A lock may only be released by the holder that set it (e.g. a unique token stored in the key and compared atomically on release); a release attempt by a stale holder must be a no-op. Verify: let a lock expire, re-acquire it from a second request, then run the first request's release; the key must still exist and the second request must complete before any third request can obtain it.
2. The lock TTL (300 s) is shorter than the critical section it protects (the duration of an lnd SendPayment), so per-user serialisation of /payinvoice is lost while a payment is pending, and the balance gate reads a snapshot that no write protects until the debit lands. Fix criteria: Either per-user serialisation holds for the full duration of a pending payment (lock renewed while the payment is in flight), or the balance check and the debit/reservation are made atomic so two requests cannot both pass the gate against one balance. Verify: with one payment held in flight for over five minutes, concurrent /payinvoice requests for the same user never both succeed against the same balance.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-667](https://cwe.mitre.org/data/definitions/667.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5257887

---

# Non-atomic unlockFunds read-modify-write races with live lockFunds, dropping fresh payment locks

## Details
`User.unlockFunds(pay_req)` (class/User.js:565-578) removes one locked payment as: LRANGE the whole `locked_payments_for_{uid}` list → filter in JavaScript (`paym.pay_req !== pay_req`) → DEL the key → RPUSH each surviving entry one at a time. There is no MULTI/EXEC, WATCH or Lua script. The list is written by two unsynchronised parties: the live Express process (`lockFunds` RPUSH at api.js:329 and `unlockFunds` at api.js:302, both inside the per-user `invoice_paying_for_{uid}` Lock) and scripts/process-locked-payments.js (unlockFunds at lines 63 and 75), which run-process-locked.sh loops hourly against the same Redis and which never takes the `invoice_paying_for_` lock. The threat model names shared-Redis races between the server and the operator scripts as an in-scope boundary.

Lost-lock interleaving (under-debit, operator loss):
1. Script: `unlockFunds(X)` for user U → LRANGE returns [X, …].
2. Server: U's `/payinvoice` for invoice B passes the balance check and `lockFunds(B)` RPUSHes B.
3. Script: DEL `locked_payments_for_U`, then RPUSHes only what it read in step 1.
Result: B is in flight in lnd but absent from the lock list, so `getCalculatedBalance()` (User.js:181-186) no longer deducts it. B's `invoice_paying_for_U` lock expires after 5 minutes (Lock.js:27); the attacker, who authors B as the Lightning counterparty, holds the HTLC (hold invoice) past that, pays a second invoice C with the same balance, then settles B. Both debits are eventually recorded, the ledger goes negative and the operator's lnd has paid twice.

Duplicate-debit interleavings (user over-charge): when the script's `unlockFunds(A)` and the server's `unlockFunds(B)` overlap on one list, the DEL/RPUSH sequences interleave so that an entry one side had removed and debited is written back by the other; the next hourly run matches it in listPayments again and `savePaidLndInvoice`s it a second time.

The attacker controls whether and how long the script works on their list. `getLockedPayments`/`unlockFunds` compare `pay_req` with strict equality, so a `/payinvoice` body whose `invoice` is a one-element JSON array (`["lnbc…"]`) stores an array `pay_req` that a freshly JSON.parsed array never `===` equals; neither api.js:302 nor the script can ever remove that entry. Assumption on dependencies: @grpc/proto-loader 0.6.5 serialises request objects through protobufjs 6.11.4 `Type.fromObject`, whose converter coerces string fields with `String(value)`, so `String(["lnbc…"])` reaches lnd as the plain bolt11 string and both `decodePayReq` (api.js:232, Paym.js:22) and `sendPayment` (api.js:330) succeed; a 1-sat invoice to an unreachable destination fails immediately and leaves a permanent 1-sat entry. After 24 h the script reaches line 75 for every such entry on every hourly run, so N permanent entries make it perform N LRANGE→parse→DEL→N×RPUSH cycles (O(N²) Redis round trips) on the attacker's list each run — minutes of continuous rewriting during which every LRANGE-to-DEL gap (JSON-parsing N entries) is a window in which the attacker's concurrent `lockFunds(B)` is lost. The attacker retries by cancelling the held HTLC (payment fails, lock released) and resubmitting; a dropped reservation is detected because the second payment C passes the balance check after the 5-minute lock expiry. Without the array trick the same race hits any user whose list the script touches (stale entries from a restart mid-payment, or the in-flight hold-invoice eviction of process-locked-payments-evicts-inflight-reservation).

Relation to verified records: payinvoice-resubmit-inflight-invoice-strips-reservation covers api.js:300 stripping every entry for the SAME pay_req on resubmission; process-locked-payments-evicts-inflight-reservation covers the script's time-based eviction at line 71 of a reservation still in flight. This record is the non-atomic LRANGE→DEL→RPUSH rewrite inside unlockFunds itself losing a concurrently RPUSHed lock for a DIFFERENT invoice (and re-materialising removed ones); fixing the other two leaves it open, an atomic single-entry removal (LREM / Lua / WATCH-MULTI) closes it.

## Evidence
1. [class/User.js:565–577](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L565-L577)
   unlockFunds() does LRANGE, filters in memory, then DEL and sequential RPUSH with no transaction, WATCH or Lua; any RPUSH by another process between the LRANGE and the DEL is silently discarded.
2. [class/User.js:550–557](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L550-L557)
   lockFunds() is a bare RPUSH onto the same list from the live server.
3. [scripts/process-locked-payments.js:62–63](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/scripts/process-locked-payments.js#L62-L63)
   Script calls unlockFunds() for every matched payment while the server is live.
4. [scripts/process-locked-payments.js:73–75](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/scripts/process-locked-payments.js#L73-L75)
   Script calls unlockFunds() for every evicted payment; a lock entry that never matches (e.g. the pay_req stored as an array, see description) makes this run every hour for the same user forever.
5. [controllers/api.js:300–302](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L300-L302)
   Server also runs unlockFunds() in the sendPayment data callback, and lockFunds() at line 329, concurrently with the script.
6. [run-process-locked.sh:1–6](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/run-process-locked.sh#L1-L6)
   The script is intended to run in a loop alongside the live server.
7. [class/User.js:181–185](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L181-L185)
   A lock dropped from the list is no longer deducted from the spendable balance.

## Impact
A won race lets the user spend an in-flight payment's amount twice, so the hub's lnd pays out more than the user deposited and the ledger goes negative; other interleavings double-debit honest users. Integrity of the balance ledger and of operator funds is compromised; no confidentiality or availability effect.

## Reproduction steps
1. Attacker is any authenticated user (accounts are free via /create) issuing /payinvoice over the network, and as the invoice's author also the Lightning counterparty who decides how long the payment stays in flight. The exploit must win a race between the hub's lockFunds RPUSH and the operator script's LRANGE→DEL gap on the attacker's own list — attack requirements PRESENT per CVSS 4.0 (a race that must be won) — but the attacker both forces the script to work on their list every hour (permanent array-pay_req entries, 1 sat each) and widens the aggregate window to minutes per run with N such entries (O(N²) rewrite cycles), retrying cheaply by cancelling the held HTLC. Relies on the operator running the shipped reconciliation loop (run-process-locked.sh; User.js:183 says locked payments are processed by it) and on the proto-loader/protobufjs String() coercion assumption stated in the description. No user interaction.

## Recommended fix
1. unlockFunds rebuilds the whole list with DEL + RPUSH after an unsynchronised read, so concurrent RPUSH/DEL from another process are lost. Fix criteria: Removal of one locked entry must be atomic with respect to concurrent additions and removals (e.g. LREM of the exact serialised entry, or a Lua/MULTI-WATCH transaction). Verify: concurrently run lockFunds(B) and unlockFunds(A) from two processes in a loop and confirm B is never missing and A is never duplicated.
2. Lock entries are matched by strict equality on pay_req, so non-string pay_req values (arrays from the JSON body) can never be removed, forcing perpetual rewrite cycles. Fix criteria: /payinvoice must reject non-string invoice values before locking, and matching must be done on a canonical string (or payment hash). Verify: a request with invoice as a JSON array is rejected with bad-arguments and leaves no lock entry.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5257886

---

# Non-standard output script in any wallet tx hangs all balance and payment endpoints (lnd mode)

## Details
When LndHub runs without a bitcoind wallet (config.bitcoind absent, a documented deployment mode), on-chain deposits are discovered by calling lnd GetTransactions and locally decoding every wallet transaction's raw_tx_hex with bitcoinjs-lib (btc-decoder.js). decodeOutput() calls bitcoin.script.toASM() and classify.output() on every output script of every transaction in lnd's wallet history, without any error handling.

An attacker creates a free account, calls /getbtc to obtain a deposit address (an lnd wallet address), and gets a transaction mined that (a) pays any amount (dust suffices) to that address, so lnd's wallet records it and GetTransactions returns it with label '' (passing the 'external'/'openchannel' filter), and (b) contains a second output whose scriptPubKey is a truncated push such as the single byte 0x01. Output scripts are not validated by consensus, so the transaction is valid in a block; it is non-standard, so the attacker needs a miner or a non-standard-transaction acceleration service to include it.

On the next cache miss, _getChainTransactions decodes the transaction inside the gRPC response callback. bitcoinjs-lib 5.2.0 script.decompile() returns null for the truncated push and toASM() throws a TypeError (classify.output() would also throw TypeError('Invalid script')). The exception is thrown synchronously inside the callback, not inside the Promise executor and not as a rejection, so the Promise returned by _getChainTransactions never resolves or rejects. The try/catch in _listtransactions never fires, _listtransactions_cache is never set, and the Redis fallback is never used. Every caller of getTxs() / getPendingTxs() / getCalculatedBalance() awaits forever: /payinvoice (after taking the per-user lock), /gettxs, /getpending and /balance (whenever balance_for_ is not cached) stop responding for every user of the hub. index.js's uncaughtException handler keeps the process alive in this wedged state, and because the offending transaction is permanently part of lnd's wallet history the condition recurs on every request until the code is patched.

Assumption against the pinned dependency: bitcoinjs-lib 5.2.0 script.decompile() returns null when a push declares more bytes than remain, and script.toASM()/classify.output() throw rather than tolerate a null decompile result. The code in scope contains no guard for either.

The same decoder also assumes bitcoin.networks.bitcoin regardless of the lnd network, so on testnet/signet/regtest no deposit is ever matched; that is an operational defect, not attacker-driven, and is not part of this finding.

## Evidence
1. [btc-decoder.js:23–47](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/btc-decoder.js#L23-L47)
   format() runs bitcoin.script.toASM(out.script) and classify.output(out.script) on every output of every lnd wallet transaction. For a scriptPubKey whose push opcode declares more bytes than follow (e.g. the single byte 0x01, or 0x4c 0xff), bitcoinjs-lib 5.2.0 script.decompile() returns null and toASM() dereferences it (null.map), throwing a TypeError; classify.output() also throws TypeError('Invalid script') on null. Such a scriptPubKey is consensus-valid (outputs are not evaluated until spent) but non-standard, so it needs a miner to include it.
2. [class/User.js:440–466](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L440-L466)
   _getChainTransactions wraps lightning.getTransactions in a Promise but calls decodeRawHex synchronously inside the gRPC callback. The TypeError escapes the callback; it is neither passed to reject() nor thrown inside the executor, so the Promise never settles and every awaiting caller blocks forever. An incoming deposit has label '' (proto-loader defaults:true), so it passes the 'external'/'openchannel' filter.
3. [class/User.js:395–437](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L395-L437)
   _listtransactions only catches rejections of _getChainTransactions(); a hung promise is never caught, _listtransactions_cache is never populated, and the fallback Redis copy is never consulted. Every call therefore re-issues getTransactions and hangs again, so the condition persists for as long as the transaction remains in lnd's wallet history.
4. [class/User.js:161–178](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L161-L178)
   getCalculatedBalance() awaits getTxs() -> _listtransactions() and is called on every /payinvoice; it is the single balance authority for spending.
5. [controllers/api.js:217–229](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L217-L229)
   /payinvoice obtains the per-user invoice_paying_for_ lock and then awaits getCalculatedBalance(); with the hang the response is never sent and the lock is held until its 5-minute expiry. /gettxs (413-440), /getpending (459-471) and cache-miss /balance (380-398) await the same chain and hang for every user.
6. [index.js:1–4](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/index.js#L1-L4)
   The process-level uncaughtException handler (lines 1-4) logs and continues, so the TypeError thrown out of the gRPC callback neither crashes nor restarts the service; the process stays up with every chain-dependent request wedged on a Promise that will never settle.
7. [config.js:7–9](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/config.js#L7-L9)
   config.bitcoind is the switch read at User.js:412: when it is absent the lnd GetTransactions + local-decode path is taken. README lines 28-30 document removing the bitcoind settings (neutrino / lnd-managed wallet) as a supported deployment, so this is a shipped mode, not a disabled control.

## Impact
No data is disclosed or altered. Availability of the hub's core functions (paying invoices, listing transactions and pending deposits, computing balances) is lost for every user and does not recover on its own because the transaction stays in lnd's wallet history and the process is kept alive by the uncaughtException handler.

## Reproduction steps
1. Attacker registers via the open /create endpoint, calls /getbtc to receive an lnd wallet address (newAddress type 0), and gets a single transaction mined that pays any amount to that address and carries a second output whose scriptPubKey is a truncated push (e.g. the single byte 0x01). lnd's wallet records the transaction because one output is its own, so GetTransactions returns it with label '' (proto-loader defaults:true) and it passes the 'external'/'openchannel' filter at User.js:449. Attack requirements are PRESENT because such a scriptPubKey is consensus-valid but non-standard, so inclusion needs a cooperating miner or a non-standard-transaction acceleration service rather than normal relay. No user interaction is involved; the hang begins on the first _listtransactions cache miss after confirmation and recurs on every request because the transaction remains in lnd's wallet history and neither the in-process cache nor the Redis fallback is ever populated. Assumption against the pinned dependency bitcoinjs-lib 5.2.0 (package-lock): script.decompile() returns null when a push declares more bytes than remain, script.toASM() then dereferences null (TypeError) and classify.output() throws TypeError('Invalid script'); @grpc/grpc-js 1.3.7 invokes the unary callback without catching exceptions. The path exists only when the hub is deployed without config.bitcoind, which README lines 28-30 document as a supported mode.

## Recommended fix
1. decodeRawHex/decodeOutput/decodeInput call bitcoinjs-lib script helpers on attacker-authored scripts with no error handling, and treat every output as decodable. Fix criteria: Decoding any wallet transaction, including ones with non-decompilable or unknown output/input scripts, must never throw out of the decoder; such outputs are skipped (no address) and the remaining outputs are still returned. Verify by decoding a transaction containing a 0x01 scriptPubKey and confirming an array is returned.
2. _getChainTransactions performs failable work synchronously inside a gRPC callback inside a Promise, so a thrown exception can leave the Promise permanently pending and wedge every caller. Fix criteria: Any exception raised while processing the GetTransactions response must reject the Promise (and be caught by _listtransactions' existing error path, which falls back to the cached copy). Verify that a decoder error results in a rejected promise and that /payinvoice, /gettxs, /getpending and /balance still respond.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Uncaught exception
**CWE:** [CWE-248](https://cwe.mitre.org/data/definitions/248.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5257884

---

# Reconciliation cron evicts reservations of payments still in flight after one day, enabling double spend

## Details
scripts/process-locked-payments.js is the only reconciler of `locked_payments_for_<uid>` reservations (User.js:183 points operators at it; the Docker image ships scripts/ via .dockerignore `!scripts/`; run-process-locked.sh runs it hourly). For each reservation it looks the payment hash up in lnd `ListPayments({})` (Paym.js:130-137). The request leaves `include_incomplete` unset, and rpc.proto:3176-3182 states that pending and failed payments are returned only when that flag is true, so an IN_FLIGHT payment is never matched. Lines 71-77 then treat every unmatched reservation older than one day as failed and call `user.unlockFunds(pay_req)` (User.js:565-578), which removes the only debit getCalculatedBalance applies for a pending payment (User.js:181-185).

A payment the hub started is not failed merely because a day has passed. /payinvoice (api.js:299-331) uses the legacy streaming SendPayment with a SendRequest that carries only payment_request/amt/fee_limit — no `timeout_seconds` and no `cltv_limit` — and the final-hop CLTV comes from the invoice author's `c` tag. A committed HTLC cannot be cancelled by the sender; it stays outstanding until the destination settles or fails it, or the CLTV expires (lnd's default max-cltv-expiry of 2016 blocks is about two weeks). The destination can therefore hold the payment IN_FLIGHT for well over 24 hours.

Attack: an authenticated user controlling a Lightning node D deposits N, creates a hold invoice on D with a large `c`, POSTs it to /payinvoice for about N, and leaves the HTLC unresolved. After 24 h the next run of the script evicts the reservation; getCalculatedBalance returns N again and the user spends it a second time (another /payinvoice, or an internal transfer to a second account). D then settles the held HTLC and the operator's lnd pays N once more. If the original hub process is still alive, its `data` handler (api.js:300-310) records the debit into an already-emptied ledger (balance goes negative, funds already gone); if it restarted, the stream is gone and no component ever records the payment, since the reservation that would have made later script runs look for it has been deleted. Either way one deposit is paid out twice from the operator's channel liquidity.

This finding holds where the operator runs the shipped reconciler, which the code and threat model treat as the expected deployment. It is distinct from the api.js:300 resubmission path (a different route to stripping the same reservation) and from the non-atomic rewrite inside unlockFunds (User.js:565), each filed separately.

Assumptions about lnd (external infrastructure, version not pinned in this repository): (1) `ListPayments` with `include_incomplete` false omits IN_FLIGHT payments — stated by the proto comment shipped in this repo; (2) a legacy `SendPayment` without `timeout_seconds` keeps the payment IN_FLIGHT while its HTLC is outstanding and the sender cannot unilaterally cancel a committed HTLC — Lightning protocol behaviour, and the basis of lnd hold invoices.

## Evidence
1. [scripts/process-locked-payments.js:71–77](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/scripts/process-locked-payments.js#L71-L77)
   Every reservation older than one day that was not matched against the completed-payments list is released with user.unlockFunds, restoring the user's spendable balance. Nothing distinguishes a payment lnd has definitively failed from one whose HTLC is still outstanding.
2. [scripts/process-locked-payments.js:25–29](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/scripts/process-locked-payments.js#L25-L29)
   The only source of truth is Paym.listPayments(), i.e. lnd ListPayments with an empty request; include_incomplete stays false, so in-flight payments are absent from the snapshot the script matches against.
3. [scripts/process-locked-payments.js:40–67](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/scripts/process-locked-payments.js#L40-L67)
   isPaid becomes true only when the payment hash is in that completed list; for a pending payment the loop finds nothing and control reaches the eviction branch.
4. [rpc.proto:3175–3182](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/rpc.proto#L3175-L3182)
   lnd's own schema comment: pending and failed payments are returned only if include_incomplete is true. The script never sets it.
5. [controllers/api.js:299–331](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L299-L331)
   /payinvoice reserves the amount with lockFunds and writes a SendRequest with no timeout_seconds or cltv_limit on the legacy streaming SendPayment; the data handler that would record the debit runs only when lnd eventually reports the result, which a holding destination can delay for days.
6. [class/User.js:181–185](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L181-L185)
   Balance derivation: the locked entry is the only debit for a pending payment; once evicted the amount is spendable again while the HTLC is still outstanding.
7. [class/User.js:565–578](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L565-L578)
   unlockFunds deletes the reservation for the given pay_req; after the script calls it, no record of the pending payment remains for later runs to reconcile.
8. [run-process-locked.sh:1–5](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/run-process-locked.sh#L1-L5)
   The project's own hourly loop for the script. The .sh itself is not whitelisted by .dockerignore, but scripts/ is, so the reconciler ships in the Docker image and User.js:183 names it as the processor of locked payments.

## Impact
The operator's lnd liquidity pays an amount the user has already re-spent; the ledger either goes negative after the fact or never records the payment at all. The hub's custodial accounting invariant (liabilities never exceed deposits) is broken with direct, repeatable financial loss to the operator, bounded per account by the attacker's deposit but repeatable across unlimited free accounts.

## Reproduction steps
1. Attacker is any authenticated user (accounts are free) who operates a Lightning node able to hold an HTLC for more than a day — a hold invoice with a large final CLTV, or simply a destination that does not resolve the HTLC. They pay their own invoice through the hub, wait for the hourly reconciler to evict the reservation, spend the balance again, then settle. No race, no victim interaction. Attack requirements are present because the deployment must run the shipped reconciliation script and the attacker must bring a node with inbound capacity to hold the HTLC.

## Recommended fix
The reconciler equates 'absent from lnd's completed-payments list and older than one day' with 'failed', although a Lightning payment stays IN_FLIGHT for as long as its HTLC is outstanding (up to the invoice's final CLTV, weeks under lnd defaults); it therefore releases reservations of payments the hub may still have to pay. Fix criteria: A reservation is released only when lnd reports the payment in a terminal FAILED state (e.g. ListPayments with include_incomplete and status inspection, or TrackPayment); IN_FLIGHT payments keep their reservation regardless of age, and a payment found SUCCEEDED is debited before its reservation is removed. Verify: a payment held unresolved for more than one day is still subtracted by getCalculatedBalance after the script runs, and settles into a debit rather than a free balance.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Business logic error
**CWE:** [CWE-841](https://cwe.mitre.org/data/definitions/841.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5257882

---

# Fractional /addinvoice amount yields zero-value invoice; internal payment credits 1 sat with zero debit

## Details
The hub's invoice-creation and internal-settlement code together let an authenticated user mint balance that was never paid in.

1. `/addinvoice` (controllers/api.js:182) accepts any `amt` for which `amt > 0` is true and forwards it unchanged as the lnd `Invoice.value` (int64). Fractional values (`0.5`, `"0.9"`, `".5"`) satisfy the check but are truncated to 0 when @grpc/proto-loader serialises the int64 field (protobufjs `fromObject` -> `Long.fromValue`/`Long.fromString`, which parseInt/truncate the input). lnd accepts `value == 0` and returns a zero-value, any-amount bolt11 invoice, which the hub stores in `userinvoices_for_<uid>` and maps via `payment_hash_<hash>` like any other hub invoice.

2. The owner (or any other account) then calls `/payinvoice` with that invoice and **no** `amount`. `freeAmount` stays `false`; because lnd reports `num_satoshis == 0`, `info.num_satoshis = false`. The affordability check becomes `userBalance >= 0 + 0 + 1`, the destination is the hub's own pubkey so the internal branch runs, and the sender's debit document is written with `value: 0, fee: 0` (lines 269-276). `markAsPaidInDatabase()` deletes `ispaid_<hash>` because `decoded.satoshis` is `null` for a zero-value invoice (class/Invo.js:41,57-63). The preimage saved at creation exists, so `subscribeInvoicesCallCallback` is invoked synthetically with `amt_paid_sat: +false === 0`.

3. In the callback (api.js:85-88) `LightningInvoiceSettledNotification.amt_paid_sat || 1` converts the 0 into 1 and writes `ispaid_<hash> = 1`. `getUserInvoices` (class/User.js:294-318) treats the truthy value as paid and computes `amt = parseInt("1") > null ? 1 : null` = 1, so `getCalculatedBalance` credits the owner 1 sat while the payer's ledger entry subtracts 0.

Net effect: every `/addinvoice`+`/payinvoice` pair creates 1 sat of liability with no corresponding deposit. A single account holding at least 1 sat can repeat this indefinitely (the `ispaid_` guard at line 257 only blocks re-paying the *same* invoice), limited by the per-IP POST rate limiter (`config.postRateLimit`, default 100 per 30 min). The loss per iteration is tiny, but it is a deterministic credit-without-debit path against the operator's funds, and it shows that the `amt > 0` validation does not actually prevent zero-value invoices, which the rest of the lifecycle (`markAsPaidInDatabase` deleting the paid marker, `process-unpaid-invoices.js`) does not handle.

Assumptions on pinned dependencies: @grpc/proto-loader 0.6.5 serialises via protobufjs 6.11.4 `fromObject`, which for int64 fields uses long 4.0.0 `Long.fromValue` (numbers truncated via `| 0`, strings via `parseInt`); lnd accepts AddInvoice with value 0 as a zero-value invoice; bolt11 1.3.2 returns `satoshis: null` for an invoice with no amount.

## Evidence
1. [controllers/api.js:69–88](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L69-L88)
   subscribeInvoicesCallCallback writes ispaid_<hash> = amt_paid_sat || 1. When the synthetic call from /payinvoice supplies amt_paid_sat = 0 (zero-amount invoice paid without an amount), the hub records a settled amount of 1 sat that nobody paid; getUserInvoices later turns this into +1 sat of balance for the invoice owner.
2. [controllers/api.js:182–189](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L182-L189)
   /addinvoice validates req.body.amt only with `!req.body.amt || !(req.body.amt > 0)` and passes it straight to lnd AddInvoice as the int64 `value`. Fractional inputs such as 0.5, "0.9" or ".5" pass the check (Number(x) > 0) but serialise to int64 0, so lnd creates a zero-value (any-amount) invoice even though the API nominally forbids amt <= 0.
3. [controllers/api.js:211–215](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L211-L215)
   If req.body.amount is absent, freeAmount stays `false`; there is no check that a zero-amount invoice must carry an amount on the internal path.
4. [controllers/api.js:238–291](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L238-L291)
   For a zero-amount hub invoice, info.num_satoshis becomes `false`. The balance check degenerates to userBalance >= 1, the sender's debit record is written with value 0 (+false + Math.floor(false*internalFee)), markAsPaidInDatabase deletes ispaid_ (decoded.satoshis is null), and the synthetic callback is invoked with amt_paid_sat: +false === 0, which the `|| 1` fallback turns into a 1-sat credit.
5. [class/User.js:294–317](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L294-L317)
   getUserInvoices reads ispaid_<hash> = "1", marks the invoice paid and computes amt = parseInt("1") > null ? 1 : null -> 1; getCalculatedBalance then adds +1 sat for the invoice while the payer's txs_for_ entry subtracts 0.
6. [class/Invo.js:31–62](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/Invo.js#L31-L62)
   markAsPaidInDatabase uses decoded.satoshis (null for zero-value invoices) so _setIsPaymentHashPaidInDatabase takes the delete branch; the only remaining writer of ispaid_ on this path is the synthetic callback's `|| 1`.

## Impact
The attacker fabricates balance (operator liability) without any deposit, a direct integrity violation of the ledger, but the gain is 1 sat per request pair, so the integrity impact is limited. No confidentiality or availability effect.

## Reproduction steps
1. Any user can register via /create and obtain a token. With >= 1 sat of balance they POST /addinvoice {amt: "0.9"} to obtain a zero-value hub invoice, then POST /payinvoice {invoice} with no amount. The request takes the internal branch, debits 0 and, through the synthetic settlement callback's `|| 1`, records a 1-sat settlement for their own invoice. Repeating with fresh invoices mints 1 sat per pair, bounded only by the POST rate limiter. No special deployment state or victim interaction is needed.

## Recommended fix
1. /addinvoice accepts non-integer amounts that truncate to zero during int64 serialisation, so the intended `amt > 0` invariant does not hold for the invoice lnd actually creates. Fix criteria: The amount forwarded to lnd must be a validated positive integer (e.g. Number.isSafeInteger(amt) && amt > 0) or the request must be rejected; verify that /addinvoice with amt 0.5, "0.9", ".5" returns 'Bad arguments' and that no zero-value invoice can be created through the API.
2. The settlement callback substitutes a fabricated amount (`|| 1`) when the reported settled amount is zero, and the synthetic invocation from /payinvoice can pass zero. Fix criteria: A settled-amount record must never exceed what was actually received/debited: a zero or missing amount must not be recorded as paid (or must be treated as an error), and the internal payment path must reject zero-amount invoices paid without an explicit positive amount so that the debit always equals the credit. Verify that paying a zero-value hub invoice without an amount is refused and that no ispaid_ key is written.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper Input Validation
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5257881

---

# Malformed invoice memo throws inside internal payment path, stranding the payer's lock for five minutes

## Details
In the internal branch of POST /payinvoice the sender's ledger entry is built with `memo: decodeURIComponent(info.description)` (controllers/api.js:274). `info.description` is the BOLT11 description written by whoever created the invoice through /addinvoice (`memo: req.body.memo`, line 189) and returned by lnd's DecodePayReq. decodeURIComponent throws URIError for any malformed percent-encoding such as '%', '%E0%A4%A' or '%zz'.

The throw happens inside the async decodePayReq callback after the lock `invoice_paying_for_<payer>` has been obtained (line 218) and after both balance caches were cleared (lines 265, 268), but before savePaidLndInvoice, markAsPaidInDatabase or releaseLock. The rejection is unhandled; index.js's `process.on('uncaughtException')` logs it and keeps the process alive, so the effects are: no debit, no credit (ledger stays consistent), no HTTP response to the payer (request hangs until client timeout), and the payer's lock remains until Lock.obtainLock's 5-minute TTL expires, during which every /payinvoice from that account returns 'Something went wrong' (lines 219-221).

Threat-model actor: the invoice author (any authenticated user) crafts a memo and distributes the invoice; any other hub user who tries to pay it is locked out of all payments for five minutes with no explanatory response, repeatable for as long as victims keep retrying. The same description is handled defensively in User.getUserInvoices (try/catch around decodeURIComponent, User.js:283-287), so this is an inconsistency between sibling call sites rather than an unknown hazard. The external branch does not decode the description and is unaffected.

Low impact: temporary denial of the payment function for one user per attempt, no ledger corruption.

## Evidence
1. [controllers/api.js:269–276](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L269-L276)
   Sink and fix location: `memo: decodeURIComponent(info.description)` (line 274) is evaluated on the payee-authored invoice description with no try/catch, inside the internal-invoice branch after the payer's lock is held. A description containing an invalid percent-escape (e.g. '%', '%zz') makes decodeURIComponent throw URIError before savePaidLndInvoice, markAsPaidInDatabase or releaseLock run.
2. [controllers/api.js:217–221](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L217-L221)
   The payer's `invoice_paying_for_<uid>` lock is obtained here. It is released only on the explicit paths inside the decodePayReq callback; the URIError escapes that async callback (grpc-js does not await it), so no releaseLock runs and no HTTP response is sent.
3. [controllers/api.js:188–189](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/controllers/api.js#L188-L189)
   Source: /addinvoice forwards `memo: req.body.memo` verbatim to lnd AddInvoice with no validation; per rpc.proto the memo becomes the bolt11 description that DecodePayReq later returns as info.description to whoever pays the invoice.
4. [class/Lock.js:18–30](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/Lock.js#L18-L30)
   obtainLock is SETNX plus a 5-minute EXPIRE; a lock that is never released persists until that TTL, during which every /payinvoice by the same user fails obtainLock and returns errorGeneralServerError (api.js:219-221).
5. [class/User.js:281–287](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/class/User.js#L281-L287)
   getUserInvoices wraps the identical decodeURIComponent(tag.data) on the same invoice description in try/catch with a raw-string fallback, showing the maintainers treat descriptions as possibly undecodable; the /payinvoice site lacks that guard.
6. [index.js:1–4](https://github.com/Halbarevi/lndhub/blob/2df1dc64fe2869427a5055c205b71d532075a502/index.js#L1-L4)
   The only process-level handler is this uncaughtException listener (no unhandledRejection handler exists). On the shipped node:16 image the unhandled rejection is raised as an uncaught exception and swallowed here, so the process survives with the request hung and the Redis lock key never deleted.

## Impact
Per-victim, per-attempt loss of the payment function for five minutes and a hung request; no data exposure and no ledger change.

## Reproduction steps
1. Attacker: any authenticated hub user (accounts are free via /create). They call /addinvoice with a small amount and a memo containing an invalid percent-escape such as '%' and hand the resulting invoice to a victim user of the same hub (e.g. as a merchant or in a chat). The victim's /payinvoice request takes the internal branch (identity_pubkey === info.destination), passes the balance gate, payee lookup and paid check, clears both balance caches, then throws at line 274. The request hangs until client timeout and the victim's invoice_paying_for_ lock stays set for 300 s, during which every /payinvoice from that account returns 'Something went wrong'. Each victim retry after expiry re-strands the lock. The victim must actively attempt the payment (UI:ACTIVE). Dependency assumptions: lnd (version unpinned; wrapped over gRPC via @grpc/grpc-js ^1.3.7 and rpc.proto) accepts arbitrary memo text up to its size limit and returns the bolt11 description verbatim from DecodePayReq, as rpc.proto documents; grpc-js invokes the callback without awaiting its returned promise.

## Recommended fix
Attacker-authored invoice description is passed to decodeURIComponent without error handling inside a critical section that holds the payer's lock. Fix criteria: Decoding of the description must not be able to abort the payment path (fall back to the raw string), and any exception inside the /payinvoice handler must release the per-user lock and return an error response. Verify: paying an internal invoice whose memo is '%' returns an error response and leaves no invoice_paying_for_ key.

---
**Severity:** LOW
**Status:** Open
**Category:** Uncaught exception
**CWE:** [CWE-248](https://cwe.mitre.org/data/definitions/248.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lndhub
**Branch:** main
**Commit:** 2df1dc64fe2869427a5055c205b71d532075a502
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01R2n2TuzmAEvXLr7pkEvUgo&finding=scan_01WQ5VKZ7sxHqstsAYumrqfo-5257879