# Unvalidated zeuscontact: import persists malformed contact that crashes Contacts, Send and Channel screens

## Details
ContactDetails.importToContacts (views/ContactDetails.tsx:223-244) persists the object it received as the nostrContact route param verbatim, changing only contactId. For the zeuscontact: input class that object is attacker-authored: handleAnything.ts:1066-1078 JSON.parses the payload and forwards it with only a truthy-contactId check; ContactDetails.fetchContact (151-171) sets state.contact = storedContact ?? nostrContact, so with no contactId route param the raw object becomes the screen's contact. The payload arrives via the exported zeuscontact URL scheme (AndroidManifest.xml:78, ios/zeus/Info.plist:42), a QR scan, a shared image, NFC or the clipboard; an app lock only defers the link (LinkingUtils.handleDeepLink -> pendingDeepLink, processed by Wallet.tsx:1473 after unlock).

Every consumer of the stored array assumes the Contact shape written by AddContact: models/Contact.ts hasMultiplePayableAddresses (160-182) calls .forEach on lnAddress, onchainAddress and pubkey unguarded (only bolt12Address/bolt12Offer/noffer are optional-chained), and views/Channels/Channel.tsx:179 calls contact.pubkey.includes. A payload such as

  zeuscontact:{"contactId":"x","name":"Alice","description":"","isFavourite":true,"bolt12Address":["alice@example.com"]}

renders in ContactDetails without error: the render path uses only the guarded has* getters (isAddressArrayEmpty(undefined) is true at Contact.ts:30-32), description.trim() succeeds on the supplied string, the bolt12 row makes the card look like a normal contact, and because isNostrContact is true the 'Save to contacts' button (importToContacts) is shown. One tap persists it, sorted by a.name.localeCompare (name is attacker-supplied). Immediately afterwards popTo('Contacts') mounts the Contacts list, whose renderContactItem (Contacts.tsx:112-114) constructs new Contact(item) and destructures hasMultiplePayableAddresses, throwing TypeError (this.lnAddress is undefined) inside render. The repository contains no React error boundary (no componentDidCatch/ErrorBoundary/ErrorUtils.setGlobalHandler under App.tsx, components/ or views/). Assumption on react-native 0.87.1 (package.json:125): the renderer's onUncaughtError routes an uncaught render error to ExceptionsManager.handleException(error, true), which in a release build terminates the app; even if a build treated it as non-fatal, React 19 unmounts the root on an unhandled render error, leaving a blank, unusable screen until restart. Either way the throw recurs on every later visit to Contacts, on the Send screen whenever favourites are rendered (Send.tsx:734-736 filters contacts by the attacker-set isFavourite, FlatList at 1756-1781 -> renderContactItem 591 -> displayAddress 565-577) and on every Channel detail screen with a remote pubkey (Channel.tsx:175-181, invoked at 436). Because the record is in the keychain blob (CONTACTS_KEY), the condition survives restarts.

Recovery is not available from the UI: the only contact-clearing control ('Delete all contacts', Contacts.tsx:518-560) sits on the screen that crashes; ContactStore.deleteContact needs prefillContact set from the Edit screen reached via ContactDetails, and the only non-crashing routes to ContactDetails for a stored contact are Contacts.tsx and Send.tsx (both crash) and Channel.tsx (crashes in findContactByPubkey first); no other code path rewrites CONTACTS_KEY except NostrContacts import (appends), the one-shot migration, and the full data wipe clearAllData (utils/DataClearUtils.ts), which destroys the embedded node and all wallet configs. The user is left unable to open Contacts, Send-with-favourites or any channel detail screen until they wipe the wallet or reinstall.

The same missing validation lets the payload set isFavourite, carry arbitrary extra keys and non-array/non-string types for any field, and (if the address book is empty so the sort comparator never runs) persist a nameless record that makes every subsequent saveContact/importToContacts throw at a.name.localeCompare. By contrast the 'Edit and save' path normalises through ContactStore.setPrefillContact (133-155) and the share side normalises in MultiQR.tsx:57-71; only the direct import trusts the raw object. Related lead: e2-02.

## Evidence
1. [views/ContactDetails.tsx:223–244](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/ContactDetails.tsx#L223-L244)
   importToContacts() spreads this.state.contact (the attacker-shaped nostrContact route param) verbatim into the persisted array, only replacing contactId, sorts by a.name.localeCompare and writes CONTACTS_KEY, then popTo('Contacts'). No field is type-checked or normalised.
2. [utils/handleAnything.ts:1066–1078](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L1066-L1078)
   Entry point: any input starting with 'zeuscontact:' (deep link, QR, shared image, NFC, clipboard) is JSON.parse'd and, if contact.contactId is truthy, routed to ContactDetails as nostrContact with isNostrContact: true. This is the only validation the payload ever receives.
3. [views/ContactDetails.tsx:151–171](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/ContactDetails.tsx#L151-L171)
   fetchContact sets state.contact = storedContact ?? nostrContact; with no contactId route param the raw parsed object becomes the screen's contact and is what importToContacts later persists.
4. [models/Contact.ts:160–182](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/models/Contact.ts#L160-L182)
   hasMultiplePayableAddresses calls this.lnAddress.forEach, this.onchainAddress.forEach and this.pubkey.forEach without optional chaining; on a record missing any of these arrays (or carrying a non-array) it throws TypeError.
5. [views/Settings/Contacts.tsx:112–114](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/Contacts.tsx#L112-L114)
   renderContactItem constructs new Contact(item) and destructures hasMultiplePayableAddresses during render for every stored contact, so the Contacts screen throws on each visit once the malformed record is stored. The screen's own 'Delete all contacts' button (518-560) is therefore unreachable.
6. [views/Send.tsx:565–577](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Send.tsx#L565-L577)
   Send.displayAddress reads hasMultiplePayableAddresses for every favourite contact rendered on the Send screen (favourites filtered from ContactStore.contacts at 734-736 by the attacker-settable isFavourite, FlatList at 1756-1781 via renderContactItem 591). The Send screen crashes on open, blocking manual sends.
7. [views/Channels/Channel.tsx:175–181](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Channels/Channel.tsx#L175-L181)
   findContactByPubkey iterates every stored contact with contact.pubkey.includes(pubkey) (called at 436 whenever a channel has a remote pubkey); a record without a pubkey array crashes every Channel detail screen, so channels cannot be managed or cooperatively closed from the UI.
8. [models/Contact.ts:30–32](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/models/Contact.ts#L30-L32)
   isAddressArrayEmpty returns true for undefined, so ContactDetails renders the malformed object cleanly (no rows for the missing arrays, no error) and presents the 'Save to contacts' button, which is what lets the record reach storage.
9. [stores/ContactStore.ts:133–155](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/ContactStore.ts#L133-L155)
   Contrast: setPrefillContact (the 'Edit and save' path) coerces every address field to an array and whitelists keys. The direct import path has no such normalisation, and MultiQR.tsx 57-71 shows the share side also normalises; only importToContacts trusts the raw object.
10. [android/app/src/main/AndroidManifest.xml:78](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/AndroidManifest.xml#L78)
   zeuscontact is an exported URL scheme (also ios/zeus/Info.plist:42), so a web page or another app can deliver the payload without a QR; LinkingUtils.handleDeepLink only defers it while the app is locked.

## Impact
Availability HIGH: the condition is persistent (stored in the keychain blob) and takes down core wallet screens — Contacts, Send with favourites, and every Channel detail view, so channels cannot be inspected or cooperatively closed from the UI — and the only recovery path (clearAllData / reinstall) destroys the embedded node and wallet configurations. The main Wallet, Receive and scan-to-PaymentRequest flows still work, so the loss is partial but its consequence is serious. Integrity LOW: an attacker-shaped record with attacker-chosen flags (isFavourite) and arbitrary keys/types is written into the user's persisted address book. Confidentiality NONE.

## Reproduction steps
1. Attacker publishes a zeuscontact: link (web page, message, NFC tag, QR poster, shared image) whose JSON has a contactId, a string name and description, isFavourite:true, optionally a bolt12Address/noffer/nip05 array so the card looks legitimate, and no lnAddress/onchainAddress/pubkey arrays (or non-array values for them). Victim opens it (an app lock only defers the link until unlock), sees a plausible contact card rendered without error, and taps 'Save to contacts'. The record is written unnormalised and the Contacts screen throws in render; thereafter Contacts, Send (favourites) and every Channel detail screen fail deterministically until the wallet is wiped. No privileges or deployment state are required; the only requirement is the victim's two taps. Assumes react-native 0.87.1 treats an uncaught render error as fatal (its renderer error handler reports it to ExceptionsManager as fatal); if not, React 19 unmounts the root and the screen is blank instead of crashing, with the same persistent effect.

## Recommended fix
1. importToContacts persists the externally supplied contact object without validating or normalising its shape, so records violating the Contact invariants (string[] address fields, string name/description, boolean isFavourite) reach storage. Fix criteria: A contact imported from a zeuscontact: payload or Nostr profile must be rebuilt from an allow-list of known fields with each value coerced to its expected type (address fields to arrays of strings, flags to booleans, name/description to strings) before being written; unknown keys must be dropped and isFavourite must not be attacker-settable. Verify by importing the payload above: the record must be stored in canonical shape and Contacts, Send and Channel screens must render normally.
2. Contact model getters and consumers (hasMultiplePayableAddresses, Channel.findContactByPubkey, Contacts/Send render paths) dereference address arrays unguarded, turning one bad stored record into a fatal render error. Fix criteria: Rendering any stored contact, however malformed, must not throw: model getters and list consumers must treat missing or non-array fields as empty, and a render-level error boundary should keep a single bad record from taking down the screen. Verify by seeding CONTACTS_KEY with a record lacking lnAddress/pubkey and confirming the Contacts, Send and Channel screens still open and still offer deletion.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258369

---

# POS-mode Activity button reaches channel close to a staff-chosen address, fee bump, bearer ecash tokens, preimages and full history export without PIN

## Details
ZEUS POS mode is designed so that staff holding the terminal without the owner's PIN can only operate the POS panes: Wallet.tsx hides the Keypad/Channels/Camera tabs while posStatus is 'active' (1898-1941), WalletHeader hides the menu/node buttons, and every exit (TempleButton, MenuBadge, NodeButton, the POS Layout error screen) goes through protectedNavigation, which pushes a PIN Lockscreen whose pendingNavigation branch (Lockscreen.tsx:370-383) deactivates POS only after a verified credential. SettingsStore.externalInputAuthRequired likewise treats an active POS session as not logged in. When the POS panes themselves open Activity (StandalonePosPane.tsx:621-627, SquarePosPane.tsx:185-191) they first call ActivityStore.setFiltersPos (received only, sent:false) and pass an `order`, which makes Activity a pick-a-receipt screen: taps only select an item and the filter button is replaced by MarkPaymentButton.

The WalletHeader ActivityButton (components/WalletHeader.tsx:143-159), rendered in the POS-mode header for every POS pane (709-719), is the exception: it calls navigation.navigate('Activity') with no order and no protectedNavigation. In that mode Activity (views/Activity/Activity.tsx) loads the persisted filters (DEFAULT_FILTERS include sent payments), offers the ungated ActivityFilter screen to re-enable anything setFiltersPos turned off, offers the CSV export (destinations, payment requests, hashes, memos, notes of every payment, invoice and transaction, written to Downloads/Documents), and on tap opens the detail screens: Payment (preimage with copy icon, destination, path), Invoice, Transaction, SwapDetails, LSPS1/LSPS7 orders, CashuInvoice/CashuPayment and CashuToken, which renders a sent ecash token as a copyable/shareable bearer string (CashuToken.tsx:426-436).

From an Invoice on an LND-based backend (the backend POS documents as fully supported) the incoming-channel link (Invoice.tsx:150-154) opens Channel. Channel's close form (Channel.tsx:1252-1383) has a force-close switch, a fee-rate input and a free-text delivery address (1344-1362, editable unless the channel has an upfront close_address); confirm-close calls ChannelsStore.closeChannel -> LND.closeChannel, which appends delivery_address to the request (LND.ts:589-591). A staff member can therefore cooperatively close the merchant's channel with their own bc1 address as the payout, taking the local balance, or force-close channels. From an unconfirmed Transaction, BumpFee spends wallet funds on fees. None of these screens re-check the lock or posStatus.

So the POS terminal holder, the distinct principal the project fences with the PIN, gains well beyond the sanctioned POS Activity view: exfiltration of the owner's complete payment history (preimages, destinations, memos) to a file, copy of unspent bearer ecash, fee bumps from wallet funds, and cooperative channel closes paid to an attacker-chosen address. Showing receipts to staff is intended; the reachable sinks are not, and contradict the protections on every other exit from POS mode.

## Evidence
1. [components/WalletHeader.tsx:143–159](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/WalletHeader.tsx#L143-L159)
   ActivityButton calls navigation.navigate('Activity', {animation}) directly: no `order` param and no protectedNavigation, unlike the sibling TempleButton (167), MenuBadge (185) and NodeButton (445), which route through the PIN Lockscreen while POS is active.
2. [components/WalletHeader.tsx:709–719](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/WalletHeader.tsx#L709-L719)
   The POS-mode rightComponent (posStatus === 'active') renders ActivityButton for every POS pane (views/POS/Layout.tsx:163-167, views/Wallet/StandalonePosKeypadPane.tsx:203), i.e. for staff who have not entered the PIN.
3. [views/Wallet/StandalonePosPane.tsx:621–627](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/StandalonePosPane.tsx#L621-L627)
   The sanctioned POS entry to Activity (same pattern in SquarePosPane.tsx:185-191) first calls setFiltersPos() and passes `order`, which puts Activity in a restricted mode: taps only select a payment for the order and the header shows MarkPaymentButton instead of FilterButton. The header ActivityButton applies neither restriction.
4. [stores/ActivityStore.ts:160–189](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/ActivityStore.ts#L160-L189)
   setFiltersPos is the project's POS restriction: sent:false, unpaid:false, received:true. The header path uses getFilters() (persisted filters, DEFAULT_FILTERS sent:true) and exposes FilterButton so staff can re-enable sent payments regardless.
5. [views/Activity/Activity.tsx:136–197](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Activity/Activity.tsx#L136-L197)
   Without route.params.order (the header path), handleItemPress navigates to SwapDetails, LSPS1/LSPS7 orders, Invoice, CashuInvoice, CashuPayment, CashuToken, Transaction and Payment for every list item.
6. [views/Activity/Activity.tsx:291–357](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Activity/Activity.tsx#L291-L357)
   In no-order mode the header shows FilterButton (ActivityFilter, no gate) and DownloadButton (ActivityToCsv) for the full filtered activity list.
7. [views/Invoice.tsx:150–157](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Invoice.tsx#L150-L157)
   On LND-based backends the invoice's incoming-channel link (from InvoicesStore.fetchIncomingChannel, 168-181) navigates to Channel with the live Channel object.
8. [views/Channels/Channel.tsx:1344–1362](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Channels/Channel.tsx#L1344-L1362)
   The cooperative-close form has a free-text deliveryAddress input (placeholder 'bc1...'), editable unless the channel has an upfront close_address; the staff member can enter their own address. A force-close switch (1286-1294) and fee-rate input (1311-1321) sit beside it.
9. [views/Channels/Channel.tsx:224–251](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Channels/Channel.tsx#L224-L251)
   closeChannel (confirm button 1367-1383) calls ChannelsStore.closeChannel with forceClose and deliveryAddress; no re-authentication or posStatus check anywhere in the screen.
10. [backends/LND.ts:580–593](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L580-L593)
   closeChannel appends delivery_address=<urlParams[4]> to the DELETE /v1/channels request, so the local channel balance is paid out to the staff-supplied address.
11. [views/Cashu/CashuToken.tsx:426–436](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/CashuToken.tsx#L426-L436)
   For a sent Cashu token opened from Activity, the screen renders the encoded bearer token as a QR with copyValue 'cashu:<token>' and a share-gift-link action; an unspent token is redeemable by whoever copies it.
12. [views/Transaction.tsx:402–413](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Transaction.tsx#L402-L413)
   Unconfirmed on-chain transactions show a BumpFee button (LND/LNC supportsBumpFee) that spends wallet funds on fees via FeeStore; no gate.
13. [views/Payment.tsx:278–287](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Payment.tsx#L278-L287)
   Payment detail shows the payment preimage (proof of payment, a listed asset) with a copy icon, plus destination and path; `sensitive` only hides it when privacy mode is enabled.
14. [utils/ActivityCsvUtils.ts:7–33](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ActivityCsvUtils.ts#L7-L33)
   The exported CSV includes destinations, payment requests, hashes, memos and notes of every payment, invoice and transaction; saveCsvFile writes it to the Downloads (Android) or Documents (iOS) directory.
15. [views/Wallet/Wallet.tsx:1898–1921](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L1898-L1921)
   The Channels tab is rendered only when posStatus !== 'active': the project does not intend POS staff to reach channel management, yet Channel is reachable via Activity -> Invoice.
16. [utils/NavigationUtils.ts:5–23](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NavigationUtils.ts#L5-L23)
   protectedNavigation is the shipped gate: with posStatus 'active' and a PIN/passphrase set it pushes a Lockscreen with pendingNavigation; Lockscreen.tsx:370-383 only deactivates POS and proceeds after a verified credential. A raw navigate() skips it.
17. [views/Settings/PointOfSale.tsx:179–185](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/PointOfSale.tsx#L179-L185)
   POS settings warn 'no password or PIN set' when neither is configured: the PIN is the designed control keeping terminal holders out of the owner's wallet.

## Impact
Confidentiality: the owner's entire payment history with destinations, preimages, payment requests, memos and notes can be read and written to a file. Integrity: a cooperative close with a staff-supplied delivery_address pays the merchant's local channel balance to the attacker (LND.ts:589-591); unspent sent ecash tokens are copyable bearer funds; BumpFee spends wallet funds on fees; channels can be force-closed. Availability: force-closing channels removes Lightning liquidity and time-locks funds for the CSV delay, while the on-chain wallet and POS remain usable.

## Reproduction steps
1. Attacker is whoever operates the merchant's device in POS mode without the PIN (staff, or a customer handed the terminal) - the position the PIN gate is designed against (PointOfSale.tsx:179-184 warning; Lockscreen.tsx:131-133 'Staff without the PIN'). One tap on the header caret opens the unrestricted Activity screen; from there, export the CSV, open any payment for its preimage/destination, open a sent Cashu token and copy it, open an invoice -> channel -> enter own address -> confirm close, or an unconfirmed transaction -> BumpFee. No credential, no defence to defeat, no race. The channel-payout path additionally needs an LND-based backend (POS's documented backend) and a channel without an upfront close address; the history export, preimage and ecash paths work on every backend.

## Recommended fix
1. WalletHeader.ActivityButton opens the unrestricted Activity screen in POS mode without the protectedNavigation Lockscreen gate used by every other POS exit, and without the received-only/order restrictions the POS panes apply when they open Activity. Fix criteria: While posStatus is 'active' and a login method is configured, the header Activity entry must either pass through the Lockscreen (pendingNavigation) or open a POS-restricted Activity (received items only, no ActivityFilter, no CSV export, no item detail navigation). Verify in POS mode without the PIN that no Payment, Invoice, Transaction, Swap, Cashu, Channel or BumpFee screen and no export is reachable from the header.
2. Fund-moving and secret-revealing screens (Channel close including delivery address and force close, BumpFee, Payment preimage, CashuToken bearer display/copy, ActivityToCsv) perform no lock-state or POS-status check of their own, so any ungated entry reaches them. Fix criteria: Channel close, BumpFee, CashuToken display of an unspent sent token, preimage reveal and activity export must require re-authentication (reAuthNavigation or equivalent) when posStatus is 'active' or loginRequired() is true. Verify by navigating to each with posStatus 'active' and a PIN set: the Lockscreen must appear first and a wrong PIN must not proceed.

---
**Severity:** HIGH
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258230

---

# Mint /v1/info JSON rendered without type validation lets a mint crash the wallet on every launch

## Details
ZEUS fetches each Cashu mint's `/v1/info` through its own raw HTTP transport in the CashuDevKit bridge (Android HttpURLConnection, iOS URLSession) and hands the body to JavaScript as-is. `CashuDevKit.fetchMintInfo` (cashu-cdk/CashuDevKit.ts 217-225) merely `JSON.parse`s it and casts to the TypeScript type `CDKMintInfo`; `CashuStore.fetchMintInfo` stores the object in the in-memory observable `mintInfos[mintUrl]` without checking that `name`, `icon_url`, `description`, `version`, `pubkey`, `contact` or `nuts` have the types the UI assumes. The observable is then rendered in places that call string methods on, or use as React children, those fields.

The most damaging sink is the main Wallet screen. `components/LayerBalances/index.tsx` (an `@observer` rendered by Wallet.tsx:1686) builds `{ name: mintInfo?.name, iconUrl: mintInfo?.icon_url }` for every configured mint and renders them through `MintAvatar`, which calls `getAvatarInitials(name || undefined)`; `utils/DisplayUtils.ts` does `(name || '').trim()`. If the mint's JSON contains `"name": 1`, `"name": {}` or `"name": ["x"]`, `.trim` is not a function and a TypeError is thrown during render. The fetch that populates `mintInfos` runs unconditionally in the background at the end of `initializeWallets` for every mint in the list, on every online launch (CashuStore.ts 3821-3829), so no tap is needed. The repository contains no React error boundary and no global JS exception handler, so the exception propagates to React Native's fatal handler and the app process terminates. Because the crash is on the Wallet screen, the user cannot reach Mints/Mint to remove the mint (Mints.tsx renders the same field through MintAvatar at 356-362 and crashes as well); recovery requires starting the app offline so the `isOffline` gate skips the fetch (mintInfos is never persisted), or clearing app data. The embedded LND/LDK node and all non-Cashu funds become unreachable from this app while the mint keeps serving the payload.

Further sinks share the root cause: EcashMintPicker on Receive/Send renders `name` as a Text child; KeyValue renders object values as children (Mint.tsx `version`/`pubkey`); and Mint.tsx's contact rendering calls `contact.map` and `method.toLowerCase()` before its `info` guard, so a mint whose `contact` is not an array of `{method: string}` objects (notably the legacy NUT-06 array-of-arrays format) crashes the Add Mint flow the moment the info screen opens.

During onboarding the same crash is reachable before any trust is given: MintDiscovery auto-fetches info for the top-5 relay-recommended mints via fetchMintInfoBatch and renders their `name` through MintAvatar (400-430), so a mint operator who gets recommended on Nostr crashes the onboarding screen with no tap.

The attacker is the operator of a mint the user has added (or one surfaced by NIP-87 recommendations during onboarding), whoever compromises its web server, or a MITM for an `http://` mint, which AddMint allows after a warning. The threat model lists Cashu mints as third-party servers whose responses are untrusted. This is distinct from the verified finding `cashu-bridge-mint-http-unbounded-response-body-read` (same transport, oversized body -> native OOM): here a well-formed ~12-byte JSON object triggers a JS render exception, and a byte cap on the transport does not fix it.

Dependency assumptions (not verifiable in the checkout): (1) react-native 0.87.1 / react 19.2.8 — RN's renderer passes its own `onUncaughtError` root option (Libraries/Core/ErrorHandlers.js, present since RN 0.77) which reports uncaught React render errors to ExceptionsManager with isFatal=true; in release builds Android's ExceptionsManagerModule throws a JavascriptException and iOS calls RCTFatal, both terminating the process. (2) mobx 5.15.7 observable objects are Proxy-backed, so adding the `mintInfos[mintUrl]` key notifies the LayerBalances observer that read the missing key.

## Evidence
1. [cashu-cdk/CashuDevKit.ts:217–224](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/cashu-cdk/CashuDevKit.ts#L217-L224)
   Single choke point every consumer goes through (CashuStore.fetchMintInfo, fetchMintInfoBatch, AddMint): the JS wrapper does `JSON.parse(json)` on the raw body returned by the native module and casts it to CDKMintInfo (cashu-cdk/types.ts 47-62: `name?: string`, `contact?: CDKMintContact[]`, ...). The type is compile-time only; nothing checks at runtime that any field has the declared type, so a mint-supplied `"name": 1` or `{}` flows on unchanged. This is where validation must be added.
2. [components/MintAvatar.tsx:36–41](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/MintAvatar.tsx#L36-L41)
   MintAvatar passes the mint-supplied `name` straight to getAvatarInitials(name || undefined). Only null/undefined/''/0/false are filtered by `|| undefined`; a non-zero number, array or object from the mint's JSON goes through.
3. [utils/DisplayUtils.ts:6–13](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/DisplayUtils.ts#L6-L13)
   getAvatarInitials does `(name || '').trim()`. For a non-string truthy `name` (e.g. 1, {}, []) `.trim` is not a function and a TypeError is thrown synchronously inside render.
4. [components/LayerBalances/index.tsx:473–489](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/LayerBalances/index.tsx#L473-L489)
   LayerBalances is `@inject('CashuStore',...) @observer` (422-424) and is rendered by views/Wallet/Wallet.tsx:1686 on the main Wallet screen. It builds `mints` from CashuStore.mintInfos (`name: mintInfo?.name`, `iconUrl: mintInfo?.icon_url`) for every configured mint and renders them through MintIcons -> MintAvatar (136-157, 242-244). When the background fetch adds the key to the observable, the observer re-renders and the throw happens on the entry screen.
5. [stores/CashuStore.ts:3821–3828](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L3821-L3828)
   At the end of initializeWallets (run from Wallet.tsx:793/870/1024 on every launch when settings.ecash.enableCashu is set) fetchMintInfo is called in the background for every mint in mintUrls, gated only on connectivityStore.isOffline. No user action is involved.
6. [stores/CashuStore.ts:725–759](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L725-L759)
   fetchMintInfo stores whatever object CashuDevKit.fetchMintInfo returns into the `@observable mintInfos` map (declared at 199, in-memory only, never persisted) with no shape or type check; the MobX observable then drives LayerBalances, EcashMintPicker, Mints and Mint renders. Because it is not persisted, launching offline (the isOffline gate) is the only in-app recovery.
7. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:786–822](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L786-L822)
   Android fetchMintInfo is a first-party raw HttpURLConnection GET of <mintUrl>/v1/info that resolves the response body verbatim ('Return the raw JSON string (already in correct format)'). It does not go through CDK's typed MintInfo deserialisation, so the mint controls the JSON shape entirely.
8. [ios/CashuDevKit/CashuDevKitModule.swift:751–792](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/CashuDevKit/CashuDevKitModule.swift#L751-L792)
   iOS parity: JSONSerialization.jsonObject only requires a top-level dictionary, then the dictionary is re-encoded and resolved to JS unchanged.
9. [views/Onboarding/MintDiscovery.tsx:400–429](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Onboarding/MintDiscovery.tsx#L400-L429)
   Pre-trust variant: during onboarding the screen auto-fetches /v1/info for the top-5 relay-recommended mints (262-271, fetchMintInfoBatch -> mintInfoCache, CashuStore.ts 2170-2184) and renders `<MintAvatar name={mintName || mint.url}>` with `mintName = mintInfo?.name` from that cache. A non-string `name` from a mint the user has never added crashes Mint Discovery with no tap at all.
10. [views/Cashu/Mints.tsx:356–361](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/Mints.tsx#L356-L361)
   The mint list screen — the one a user would use to remove the offending mint — renders `<MintAvatar name={mintInfo?.name}>` for each mint and `mintInfo.name || item.mintUrl` as a Text child (387-389), so it crashes on the same field.
11. [components/EcashMintPicker.tsx:317–323](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/EcashMintPicker.tsx#L317-L323)
   Second sink on the Receive/Send screens: `mints[displayMintUrl]?.name ? mints[displayMintUrl].name : ...` renders the raw `name` as a <Text> child; an object child throws 'Objects are not valid as a React child'. Same pattern at 112-114 and via MintAvatar at 93-98/294-300.
12. [views/Cashu/Mint.tsx:876–886](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/Mint.tsx#L876-L886)
   Reached when adding a mint (AddMint.tsx 156-163 navigates here with the raw fetched info): `mintInfo.contact.map(...)` throws if `contact` is not an array, and `method.toLowerCase()` at 882 runs before the `if (!contact.info) return` guard at 886, so a contact entry with a missing or non-string `method` (including the legacy NUT-06 `[["email","x"]]` array-of-arrays format) throws a TypeError. 743-754 and 779-802 also render `name`/`description` as Text children.
13. [components/KeyValue.tsx:238](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/KeyValue.tsx#L238)
   KeyValue renders any object `value` directly as a React child (`Value = typeof value === 'object' ? value : ValueBase`), so Mint.tsx's `version`/`pubkey` KeyValues (828-841) also crash on an object-valued field.
14. [App.tsx](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/App.tsx) (whole file)
   A search of the first-party tree (ts/tsx/js outside node_modules) finds no componentDidCatch, getDerivedStateFromError, ErrorBoundary or ErrorUtils.setGlobalHandler, so a render-time exception reaches the React root uncaught.

## Impact
Deterministic, remotely sustained crash of the whole wallet app on the entry screen, every online launch, with the removal screens crashing on the same field; the embedded node and all funds managed by the app are unreachable from it until the user discovers the offline-launch workaround or clears app data. Rated availability HIGH. No secrets are read and no state is altered: confidentiality and integrity NONE.

## Reproduction steps
1. Attacker operates, has compromised, or (for an http:// mint) can MITM a mint present in the victim's mint list; they change the `/v1/info` response so `name` (or `icon_url`, `contact`, `version`) is a non-string JSON value. On the victim's next online launch initializeWallets fetches the info in the background, LayerBalances renders MintAvatar on the Wallet screen, getAvatarInitials throws, and the app terminates. Every subsequent launch repeats it. No privileges, no user interaction; the precondition that the attacker's mint is configured is rated AT:PRESENT. The AddMint/Mint.tsx contact variant needs the user to type the URL (UI active) but requires no prior trust.

## Recommended fix
1. Mint info JSON returned by the first-party fetchMintInfo transport is parsed in CashuDevKit.fetchMintInfo and stored/rendered without validating that each field has the type the UI assumes (strings for name/icon_url/description/version/pubkey/motd, an array of {method: string, info: string} for contact, an object for nuts). Fix criteria: At the single parse point (CashuDevKit.fetchMintInfo) or before mint info is stored in CashuStore.mintInfos, mintInfoCache or passed to the Mint screen, every field is coerced or validated at runtime and non-conforming fields are dropped (or the whole info is rejected with an error state). Verify by serving `{"name":1}`, `{"name":{}}`, `{"contact":{}}`, `{"contact":[["email","x"]]}` and `{"version":{}}` from a configured mint and from a mint being added: the Wallet, Receive/Send, Mints and Mint screens must render (with a fallback name) and the app must not crash.
2. Render-time exceptions in the Cashu UI have no containment: there is no React error boundary around the wallet screens and no global JS exception handler, so a single bad field terminates the process. Fix criteria: A render exception in a Cashu component (or anywhere under the root) is caught by an error boundary that shows a fallback and keeps the rest of the app, including the ability to reach mint management, usable. Verify by forcing a throw inside MintAvatar and confirming the Wallet screen remains reachable.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper type validation
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258229

---

# Keychain purge's sole-copy check races the connect-time local deletion, stranding iCloud xprv/Cashu-seed copies

## Details
Builds between Jan 2025 and this release cached the embedded wallet's ypriv/zpriv - full on-chain spending keys derived from the seed - under '<pubkey>-extended-private-keys' (or 'undefined-extended-private-keys' when exported before node info loaded; utils/DataClearUtils.ts:690-710). On 2026 builds Storage prefixed the key 'zeus:' and, until patch-keychain-cloudsync landed, react-native-keychain 10.0.0 (oblador#800) wrote every item into the iCloud-synchronizable partition. The remediation chain is: keychainDesyncMigration copies every zeus:* synchronizable item to the local partition (utils/MigrationUtils.ts:1500-1533); the connect path deletes retired local secrets (NodeInfoStore.getNodeInfo deletes zeus:<nodeId>-extended-private-keys and zeus:undefined-extended-private-keys, stores/NodeInfoStore.ts:94-107; CashuStore.initializeCDK deletes zeus:<lndDir>-cashu-seed, stores/CashuStore.ts:3697-3700; Storage.removeItem is local-only, storage/index.ts:132-139); and autoPurgeLegacyKeychain deletes the synchronizable copies (utils/KeychainPurgeUtils.ts:432-473).

executePurge's prefixed-synchronizable loop applies a 'never delete the only copy of live data' rule: it re-reads the local copy and skips the item if local===null while the sync copy exists (378-387). verifyPurgePreflight (293-304) has already re-created any missing local copy, so the rule only fires when something deletes the local copy between preflight's visit of that server and loop 3's visit of it. Wallet.getSettingsAndNavigate fires autoPurgeLegacyKeychain() without awaiting it and immediately starts fetchData (views/Wallet/Wallet.tsx:527-528), whose connect path performs exactly such deletions concurrently: CashuStore.initializeWallets runs before LND is even initialised (Wallet.tsx:793) and deletes the local cashu-seed bytes; getNodeInfo deletes the local xprv cache once the node answers (after LND start on embedded wallets - seconds - or after one REST roundtrip when a remote wallet is active, which still deletes the shared 'zeus:undefined-extended-private-keys'). The purge window between preflight and loop 3 spans the rest of preflight plus two full deletion loops plus an arbitrary (SecItemCopyMatching order) prefix of loop 3 - several hundred keychain round-trips for a long-time user - so a startup-time deletion landing inside it is a realistic, non-deterministic outcome rather than a corner case. The two earlier loops exempt the xprv cache via isXprvCache (145-146, 341-342) precisely because the app only ever deletes that key and it is never the only copy of anything; loop 3 does not, and it also has no exemption for a cashu-seed whose phrase-form counterpart exists.

When the race is lost the sync copy is recorded as 'skipped', not failed, so the AUTO_PURGE_KEY done flag is set (465-467) and the automatic purge never runs again. The item is then removable only by a manual Tools > Keychain Cleanup run (which re-runs preflight and so succeeds, views/Tools/KeychainCleanup.tsx:89-100), but nothing surfaces to the user that anything was left behind.

Result: the extended private key for the wallet's on-chain funds, or the legacy Cashu seed bytes, remain in the user's iCloud Keychain indefinitely - the KEY-004/KEY-006 exposure this purge exists to end (threat model: 'Data must not leak to ... iCloud ... where the code says it should not') - while the app records cleanup as complete.

Stated assumptions: (1) a zeus:<pubkey>-extended-private-keys, zeus:undefined-extended-private-keys or zeus:<lndDir>-cashu-seed item exists in the synchronizable partition, i.e. the user ran an iOS build between the zeus: prefix migration and the cloudSync patch and used Seed QR Export / Cashu on it (the maintainers' own comments describe exactly these entries); (2) the lost-race boot is the one on which the auto-purge first completes with zero failures.

## Evidence
1. [utils/KeychainPurgeUtils.ts:378–387](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/KeychainPurgeUtils.ts#L378-L387)
   Prefixed-synchronizable loop: re-reads the local copy and skips the item if local===null && sync exists. Unlike the two earlier loops it has no isXprvCache exemption, and nothing orders it against the app's startup-time local deleters, so a local copy deleted after preflight makes the iCloud copy 'skipped' instead of deleted.
2. [utils/KeychainPurgeUtils.ts:293–304](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/KeychainPurgeUtils.ts#L293-L304)
   Preflight re-creates any missing local copy of a prefixed sync item (copy + verify) before executePurge. This bounds the race window to [preflight's visit of the server, loop 3's visit of the same server] within one purge pass; it is why a retry boot or the manual Tools run normally succeeds, and why only a deletion landing inside that window strands the item.
3. [stores/NodeInfoStore.ts:94–107](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NodeInfoStore.ts#L94-L107)
   First getNodeInfo of a session deletes zeus:<nodeId>-extended-private-keys and zeus:undefined-extended-private-keys via Storage.removeItem (local partition only; storage/index.ts:132-139). purgedXprvCacheFor is never reset, so this is a one-shot per session; the 'undefined-' entry is deleted by whatever wallet connects first, including a remote node whose getNodeInfo is a single REST roundtrip.
4. [views/Wallet/Wallet.tsx:525–528](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L525-L528)
   autoPurgeLegacyKeychain() is fired without await and fetchData() starts immediately, so scan+preflight+three deletion loops run concurrently with the connect path that performs the local deletions.
5. [views/Wallet/Wallet.tsx:793](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L793)
   Second concurrent deleter: in the normal connecting path CashuStore.initializeWallets() runs BEFORE initializeLnd/startLnd, so its local deletion of zeus:<lndDir>-cashu-seed fires early in startup, well inside the purge window.
6. [stores/CashuStore.ts:3697–3699](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L3697-L3699)
   initializeCDK deletes the local zeus:<lndDir>-cashu-seed (legacy Cashu seed bytes) whenever a seed phrase exists, via Storage.removeItem (local only). If this lands between preflight and loop 3, the synchronizable copy of the Cashu seed bytes is skipped by the same rule.
7. [utils/KeychainPurgeUtils.ts:460–467](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/KeychainPurgeUtils.ts#L460-L467)
   Skipped items are not failures: after a pass that skipped a stranded sync secret the AUTO_PURGE_KEY done flag is set and the automatic purge never runs again. Only a manual Tools > Keychain Cleanup run (which does re-run preflight, views/Tools/KeychainCleanup.tsx:89-100) would remove it, and nothing tells the user to run it.
8. [utils/KeychainPurgeUtils.ts:139–146](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/KeychainPurgeUtils.ts#L139-L146)
   isXprvCache and its rationale: the xprv cache is derived, never migrated, only ever deleted by the app and 'never the only copy of anything' - the exemption applied in hasMigratedCounterpart (341-342) but not in the prefixed-sync loop.
9. [storage/index.ts:132–139](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/storage/index.ts#L132-L139)
   Storage.removeItem passes cloudSync:false, so with the patched react-native-keychain 10.0.0 it clears only the device-local partition; the synchronizable twin written by unpatched 2026 builds is left for the purge.
10. [utils/MigrationUtils.ts:1500–1533](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/MigrationUtils.ts#L1500-L1533)
   keychainDesyncMigration copies every zeus:* synchronizable item - including the xprv cache and cashu-seed bytes if present - into the local partition on the first patched boot; these local copies are what the connect path deletes.
11. [utils/DataClearUtils.ts:690–709](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/DataClearUtils.ts#L690-L709)
   Maintainers' account of the affected builds: Jan 2025 until this release cached ypriv/zpriv under '<pubkey>-extended-private-keys' (and 'undefined-extended-private-keys' when exported before node info loaded); on 2026 builds Storage prefixed it zeus: and, before patch-keychain-cloudsync, wrote it to the synchronizable partition.

## Impact
The stranded items are an extended private key for the wallet's on-chain accounts and/or the legacy Cashu seed bytes: disclosure is total for those keys (confidentiality high) and the holder can spend every on-chain UTXO / redeem the ecash (integrity high). No availability impact.

## Reproduction steps
1. No attacker input triggers the defect; it is a check-then-act race inside the app's own startup (purge loop 3 vs the connect path's local deletions, both fired by Wallet.tsx:527-528). Whether it is lost depends on keychain size and node response time (seconds for embedded LND start, one REST roundtrip for a remote wallet deleting the shared 'undefined-' entry, CDK init for the cashu-seed), so AT:P. The stranded secret is then exploited by whoever can read the victim's iCloud Keychain - a party inside the Apple ID's keychain circle (compromised Apple ID plus a trusted-device passcode/approval, shared Apple ID, restored device) - which is the same adversary KEY-004 was remediated against; gaining that position is the circumvention that makes AC:H. Preconditions outside the attacker's control: iOS, an affected 2026 build having written the entry to the synchronizable partition, and the purge boot losing the race.

## Recommended fix
1. executePurge's prefixed-synchronizable loop applies the sole-surviving-copy rule to derived secrets the app itself deletes at startup (the xprv cache; the cashu-seed bytes once a seed phrase exists), and runs concurrently with those deletions, so a local copy removed between preflight and the loop causes the iCloud copy to be kept instead of removed. Fix criteria: A synchronizable '*-extended-private-keys' item (prefixed or not) must always be deleted by the purge regardless of whether a local copy exists, and a synchronizable zeus:<dir>-cashu-seed must be deletable when its local seed-phrase counterpart exists. Verify: with zeus:<pubkey>-extended-private-keys present only in the synchronizable partition, executePurge removes it and reports it as deleted, not skipped.
2. The auto-purge marks itself done while a retired secret remains in the synchronizable partition, and nothing orders it against the connect path's local deletions, so startup timing decides whether the secret ever leaves iCloud. Fix criteria: After any completed purge (automatic or manual) no '*-extended-private-keys' or retired cashu-seed item may remain in either keychain partition, independent of the interleaving of autoPurgeLegacyKeychain with NodeInfoStore.getNodeInfo and CashuStore.initializeWallets; either the done flag must not be set while such an item is skipped, the purge must be sequenced before fetchData, or the connect-time deletions must also clear the synchronizable twin (as CashuStore's deleteWallet already does at stores/CashuStore.ts:5837-5847). Verify by deleting the local copy between preflight and the loop and confirming the synchronizable copy is still removed.

---
**Severity:** HIGH
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258224

---

# Reverse swap claim fee taken from provider quote as absolute fee with no bounds or approval

## Details
A Boltz-style reverse swap (Lightning -> on-chain) is safe for the user only if the claim transaction that reveals the preimage confirms before the lockup's CLTV timeout and pays most of the lockup to the user's address. ZEUS lets the swap provider choose the absolute miner fee of that claim.

`SwapStore.claimMinerFee` (SwapStore.ts:202-204) is `reverseInfo.fees.minerFees.claim` verbatim from the provider's `GET /swap/reverse` fee table (372-384). `SwapDetails.createReverseClaimTransaction` (SwapDetails.tsx:846-885) resolves `minerFee` as `swapData.claimMinerFee ?? SwapStore.claimMinerFee ?? 0` and, when that is 0 (every rescued swap, since buildRescuedSwap sets none, and every legacy swap), calls `getSwapFees()` at claim time and uses whatever the provider answers now. The value passes unchanged through `ReverseClaimTransaction.build` (ClaimTransaction.ts:112-168) and lndmobile/swaps.ts into the prebuilt native `createReverseClaimTransaction`. FeeUtils.ts:72-84 is the maintainers' statement of the native semantics: the claim 'pays the host-quoted claim miner fee when there is one and ignores the rate', i.e. an absolute fee in sats. Nothing bounds it: no floor, ceiling, ratio to the lockup or sat/vB plausibility check. MIN/MAX_SAT_PER_VBYTE exist, and their comment says their purpose is 'bounding what an unvalidated API response can hand to a transaction the user does not individually approve', but they apply only to mempool rates and the fallback rate; `hasUsableClaimFee` accepts any quote > 0. The claim is built and broadcast automatically from the websocket `transaction.mempool`/`transaction.confirmed` handler (SwapDetails.tsx:663-671) once `verifyReverseLockup` passes, and that check requires only 6 blocks of headroom (SwapStore.ts:766) on the assumption that the claim confirms within them.

Two provider attacks:

1. Deflated quote (theft; swaps created on this device). The provider quotes `minerFees.claim = 1`. The Swaps screen shows 'Network fee' as claim + lockup fee (index.tsx:171-176), so the figure looks attractively low; `hasUsableClaimFee` passes; the creation check `onchainAmount > invoiceAmount - serviceFee - 1 - lockupFee` (SwapUtils.ts:354-359) is easily met. The user pays the hold invoice, the lockup confirms, and ZEUS builds a claim paying 1 sat absolute (about 0.01 sat/vB), which no node relays. In the Boltz cooperative claim the preimage is posted to the provider's `/swap/reverse/{id}/claim` before broadcast, and a script-path claim carries it in the witness handed to the provider's broadcast endpoint; the provider settles the hold invoice, waits for the timeout and refunds the lockup to itself. The 'claimBroadcastFailed' message tells the user to reopen the swap to retry, which reuses the stored 1-sat `claimMinerFee`; there is no in-app path to re-claim at a user-chosen fee.

2. Inflated quote (burn; rescued/legacy swaps). The fee is fetched at claim time and never shown; the rescued-swap 'confirm-amount' dialog states only the lockup amount. A quote near the lockup value sends almost everything to miners while the preimage still settles the hold invoice.

Assumptions outside this repository, stated explicitly: the prebuilt Lndmobile v0.21.4-beta-zeus.1 (fetch-libraries-versions.json) implements `minerFee` as the FeeUtils comment documents, and it follows the Boltz v2 reverse-swap claim protocol (preimage sent in the cooperative claim request, broadcast through the provider), as the SwapUtils comments referencing boltz-client indicate.

## Evidence
1. [views/Swaps/SwapDetails.tsx:846–885](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L846-L885)
   createReverseClaimTransaction resolves minerFee as swapData.claimMinerFee ?? SwapStore.claimMinerFee ?? 0 and, when that is 0 (rescued swaps have no claimMinerFee, legacy swaps predate it), calls SwapStore.getSwapFees() at claim time and takes whatever the provider's fee table now says. The value is passed into ReverseClaimTransaction.build as minerFee with no floor, ceiling, ratio-to-lockup check, sat/vB plausibility check or user confirmation. The retry loop reuses the same claim object, and reopening the swap reuses the stored fee, so there is no in-app re-claim at a user-chosen fee.
2. [utils/FeeUtils.ts:72–84](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/FeeUtils.ts#L72-L84)
   The maintainers' statement of the native claim builder's semantics: 'The claim pays the host-quoted claim miner fee when there is one and ignores the rate.' minerFee is an absolute fee in sats; the user's sat/vB rate is used only when the quote is 0. hasUsableClaimFee accepts any claimMinerFee > 0, so a 1-sat quote is 'usable'. The MIN/MAX_SAT_PER_VBYTE bounds above it, whose comment says they exist for 'bounding what an unvalidated API response can hand to a transaction the user does not individually approve', are not applied to the quote.
3. [stores/SwapStore.ts:202–204](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L202-L204)
   claimMinerFee is reverseInfo.fees.minerFees.claim verbatim from the provider's GET /swap/reverse response (stored at lines 372-384), with no plausibility bound.
4. [views/Swaps/SwapDetails.tsx:663–671](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L663-L671)
   The websocket handler builds and broadcasts the claim automatically on the provider's transaction.mempool / transaction.confirmed update once the lockup is verified; no screen shows the claim fee or asks the user before the preimage is revealed (rescued swaps get a confirm-amount dialog that states only the lockup amount).
5. [stores/SwapStore.ts:713](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L713)
   For swaps created on this device the provider's quoted claim fee is frozen into the swap at creation; rescued swaps (buildRescuedSwap, 1402-1485) never get a claimMinerFee, so they always take the live quote at claim time.
6. [views/Swaps/index.tsx:218–224](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/index.tsx#L218-L224)
   The creation screen's only fee gate: 'The reverse claim is broadcast without asking, so it needs a fee before the swap starts: the host's claim miner fee, or else a usable rate'. A deflated host quote (1 sat) passes hasUsableClaimFee; nothing warns that it cannot confirm.
7. [views/Swaps/index.tsx:171–176](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/index.tsx#L171-L176)
   The 'Network fee' the user approves is the sum of the provider's claim and lockup quotes, so a 1-sat claim quote is displayed as an attractively low total; the user has no way to tell the claim portion is unrelayable.
8. [utils/SwapUtils.ts:354–358](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/SwapUtils.ts#L354-L358)
   The only amount check at creation requires onchainAmount > invoiceAmount - serviceFee - claimFee - lockupFee. It bounds how little the provider may lock up but places no lower bound on the claim fee: a quote of 1 sat passes and makes this check easier for the provider to satisfy.
9. [models/ClaimTransaction.ts:112–168](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/models/ClaimTransaction.ts#L112-L168)
   ReverseClaimTransaction.build copies feeRate and minerFee through unchanged to the native bridge.
10. [lndmobile/swaps.ts:68–117](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/lndmobile/swaps.ts#L68-L117)
   createReverseClaimTransaction hands minerFee to LncModule.createReverseClaimTransaction (Android LncModule.kt:253-262, iOS LncModule.mm:300-320), which calls the prebuilt Lndmobile v0.21.4-beta-zeus.1 (fetch-libraries-versions.json) that builds and broadcasts the claim.
11. [stores/SwapStore.ts:749–770](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L749-L770)
   verifyReverseSwapDeadline (called from verifyReverseLockup at 930) only insists on MIN_REVERSE_SWAP_CLAIM_BLOCKS (6, SwapUtils.ts:173) before the refund deadline; it assumes the claim confirms within that window, which a provider-chosen 1-sat absolute fee cannot.

## Impact
The user's funds for the swap are lost: in the deflated case the whole Lightning payment goes to the provider with no on-chain payout (the lockup returns to the provider at timeout); in the inflated case nearly the entire lockup is burned to miners. The amount actually paid out differs from what the user approved, violating the amount/fee integrity asset in the threat model. The native-binary semantics are an assumption documented by the project's own FeeUtils comment. No confidentiality impact; availability impact is subsumed in the loss.

## Reproduction steps
1. Attacker is the Boltz-protocol swap provider at the user-selected host (a default third-party host or a custom one), a named adversary in the threat model. It controls the GET /swap/reverse fee table every client fetches before and during a reverse swap. Deflated case: the user performs an ordinary reverse swap; every check accepts the 1-sat quote, the claim is built unconfirmable, and the provider collects the hold invoice via the preimage and the lockup at timeout. Inflated case: the provider waits for a client holding a rescued/legacy swap to open its details. No ZEUS check bounds the quoted fee.

## Recommended fix
1. The provider's quoted claim miner fee is used as the absolute fee of the preimage-revealing claim transaction with no plausibility bounds, so the provider decides whether the claim can confirm and how much of the lockup reaches the user. Fix criteria: Before any reverse swap is created or claimed, the claim fee must be bounded independently of the provider: derive it from a sat/vB rate the app trusts (user-chosen or sanitized mempool rate within MIN/MAX_SAT_PER_VBYTE) times the claim's vsize, or at minimum reject a provider quote that implies a rate outside that range or exceeds a small fraction of the lockup. Verify by quoting claim fees of 1 sat and of lockup-minus-dust and confirming the swap is refused at creation and the claim is never built.
2. For rescued and legacy swaps the fee is fetched from the provider at claim time and spent automatically without being shown to or approved by the user. Fix criteria: A claim whose fee was not approved at creation must either use the app-derived fee above or present the exact payout and fee to the user for confirmation before the preimage is revealed; the confirm-amount dialog must include the claim fee. Verify by rescuing a reverse swap against a provider serving an inflated quote and confirming no claim is broadcast without the user seeing the fee.
3. Nothing checks that a broadcast claim actually confirms before the refund deadline, so a stuck claim silently hands the swap to the provider. Fix criteria: After broadcasting, the app should monitor the claim on the explorer and, if it is not confirmed with headroom before the timeout, fee-bump it (RBF/CPFP) or alert the user; the swap must not be shown as successful until the claim is confirmed.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258219

---

# First-party mint HTTP transport reads unbounded response bodies into memory, crashing the app

## Details
ZEUS talks to Cashu mints mostly through CDK, but the CashuDevKit bridge also implements its own raw HTTP transport for two endpoints: GET /v1/info (fetchMintInfo) and GET /v1/mint/quote/bolt11/<id> (checkExternalMintQuote). On Android these use HttpURLConnection and read the body with bufferedReader().readText(); on iOS they use URLSession.shared.data(from:). Neither checks Content-Length, caps the number of bytes read, nor streams/parses incrementally, so the entire body is materialised in process memory. A mint (or anything the mint redirects to - both transports follow redirects) can therefore answer with an arbitrarily large body. Both platform HTTP stacks transparently decompress Content-Encoding: gzip by default (Android HttpURLConnection requests gzip and inflates for getInputStream(); URLSession does likewise), so a compressed body of a few MB inflates to hundreds of MB or more in memory within seconds; the 30 s readTimeout on Android is an inactivity timeout and never fires while bytes keep arriving.

On Android the growing String exhausts the Java heap (largeHeap is set, but the bound is still a few hundred MB) and throws OutOfMemoryError, which the method's `catch (e: Exception)` does not handle; thrown inside `scope.launch` where `scope = CoroutineScope(Dispatchers.IO + SupervisorJob())` has no CoroutineExceptionHandler (line 41), it reaches the thread's uncaught handler and the process is killed. On iOS the Data buffer grows until jetsam terminates the app.

Reachability: fetchMintInfo is called for every configured mint at every wallet initialization (CashuStore.ts 3821-3828, background, not user-triggered; initializeWallets runs from Wallet.tsx on every launch when ecash is enabled, skipped only when connectivityStore.isOffline), so once a hostile, compromised or hijacked mint is in the user's list the app is terminated on each online launch while the fetch is in flight. The method is also reachable for mints the user never added: the onboarding Mint Discovery and RecommendedSettings screens feed the top-5 scored URLs to fetchMintInfoBatch (MintDiscovery.tsx 262-271, RecommendedSettings.tsx 313); in 'all' mode those come from NIP-87 kind-38000 events fetched from the default relays with no author filter, and the score is computed from the publishers' own review counts and ratings. checkExternalMintQuote is reached with the mint_url the ZEUS Pay backend supplies (LightningAddressStore.redeemCashu -> CashuStore.checkInvoicePaid -> checkAndMintCDK, lines 873-880).

The 10-second Promise.race in CashuStore.fetchMintInfo only abandons the JS promise; the native download continues. Recovery requires either going offline (so the isOffline gate skips the fetch) and removing the mint, or clearing app data, which deletes the plaintext proof database (recoverable only via NUT-13 restore). This is first-party code duplicating what CDK's HTTP client does, so an upstream fix would not cover it; the scan threat model lists Cashu mints among the third-party servers whose responses are untrusted, and the project's own .oss-scanner/threat_model.md rates 'denial of service from untrusted input that crashes the app or makes a wallet unusable until reinstall' as Medium.

## Evidence
1. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:786–822](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L786-L822)
   fetchMintInfo opens a plain HttpURLConnection to <mintUrl>/v1/info (connectTimeout/readTimeout 30 s are per-operation inactivity timeouts, not a total bound) and reads the whole body with bufferedReader().use { it.readText() } at line 808 with no Content-Length check or byte cap. The `catch (e: Exception)` at 815 does not catch java.lang.OutOfMemoryError (an Error), so an oversized body escapes the method's error handling.
2. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:41](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L41)
   `scope = CoroutineScope(Dispatchers.IO + SupervisorJob())` carries no CoroutineExceptionHandler; an OutOfMemoryError thrown inside `scope.launch` is delivered to the thread's uncaught-exception handler (kotlinx-coroutines 1.7.3 documented behaviour for launch), which on Android terminates the process.
3. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:936–989](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L936-L989)
   checkExternalMintQuote does the same over the same transport: unbounded readText() of the error stream (953) and of the success body (961), then JSONObject(response) on the whole string.
4. [ios/CashuDevKit/CashuDevKitModule.swift:751–792](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/CashuDevKit/CashuDevKitModule.swift#L751-L792)
   iOS fetchMintInfo uses URLSession.shared.data(from:) (766), which accumulates the complete (transparently decompressed) response in a Data before JSONSerialization, with no size limit; checkExternalMintQuote (875-930, data(from:) at 889) is identical. Memory grows until jetsam terminates the app.
5. [stores/CashuStore.ts:3821–3827](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L3821-L3827)
   At the end of initializeWallets, fetchMintInfo is invoked in the background for every configured mint, gated only by connectivityStore.isOffline; initializeWallets runs from Wallet.tsx (793, 870, 1024) on every launch when settings.ecash.enableCashu is set, so a hostile mint in the list triggers the download on each online launch with no user action.
6. [stores/CashuStore.ts:725–759](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L725-L759)
   The JS wrapper races the native call against a 10 s timer, but the timer only rejects the JS promise; the native read continues to completion, so it is not a mitigation. The wrapper also caches successful results per URL, so the fetch recurs only until a bounded result arrives — which an attacker's unbounded body never does.
7. [views/Onboarding/MintDiscovery.tsx:262–270](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Onboarding/MintDiscovery.tsx#L262-L270)
   The discovery screen automatically calls fetchMintInfoBatch for the top-5 scored mint URLs on render; in 'all' mode those come from NIP-87 kind-38000 events published by arbitrary Nostr principals (CashuStore.ts processMintRecommendationEvents 2043-2089, filter at 2205-2208 has no author restriction; score at 2111-2165 is driven by the publishers' own review counts/ratings), so a URL reaches the raw transport without the user having added the mint. RecommendedSettings.tsx:313 does the same.
8. [stores/CashuStore.ts:873–879](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L873-L879)
   checkAndMintCDK falls back to CashuDevKit.checkExternalMintQuote(mintUrl, quoteId) for quotes not in the local DB; LightningAddressStore.redeemCashu (487-534) passes the mint_url the ZEUS Pay server supplied, so that server (or whoever impersonates it) is a second author of the fetched URL.

## Impact
Availability: deterministic process termination of the wallet app (including the embedded LND/LDK node running in the same process) on every online launch for as long as the attacker keeps the mint configured and serving; with gzip inflation the crash lands within seconds, before the user can navigate to the mint-removal screen, so the attacker fully denies use of the app while the device is online. The only recovery paths are the undocumented one of going offline to skip the fetch and removing the mint, or clearing app data (losing the plaintext proof DB). Rated HIGH. Funds and keys are not read or altered: no confidentiality or integrity effect.

## Reproduction steps
1. Attacker operates (or has compromised, hijacked, or can redirect from) a mint URL present in the victim's mint list, is a Nostr publisher whose NIP-87 recommendations place a URL in the top-5 shown in 'all'-mode Mint Discovery, or controls the mint_url returned by the ZEUS Pay backend. On the next online wallet initialization the app GETs /v1/info in the background and the attacker streams an unbounded (and, with transparent gzip decompression, cheaply inflated) body; the Android process dies with an uncaught OutOfMemoryError, iOS is jetsammed. No user interaction is needed once the mint is configured; the configured-mint / discovery-mode precondition is rated AT:PRESENT. Assumptions: Android HttpURLConnection and iOS URLSession transparently decompress gzip (documented platform behaviour); kotlinx-coroutines 1.7.3 delivers uncaught launch exceptions to the thread's uncaught-exception handler (documented).

## Recommended fix
1. fetchMintInfo and checkExternalMintQuote in both native modules read the complete HTTP response (and error) body into memory with no upper bound, on transports that transparently inflate compressed bodies. Fix criteria: Responses from mints are read with a hard byte cap on the decompressed stream (a few hundred KB is ample for /v1/info and a quote) and rejected with a promise error when exceeded, on both platforms and for both success and error streams, so an oversized body can no longer exhaust memory. Verified by pointing a configured mint at a server that streams >1 GB (or a small gzip body inflating to >1 GB) on /v1/info and confirming the app stays alive and the promise rejects.
2. On Android the per-method `catch (e: Exception)` and the handler-less CoroutineScope let any Error thrown in a bridge coroutine terminate the process. Fix criteria: Bridge coroutines run under a CoroutineExceptionHandler (or catch Throwable at the method boundary) that rejects the promise instead of propagating to the thread's uncaught-exception handler, so a failure in one native call cannot kill the app.

---
**Severity:** HIGH
**Status:** Open
**Category:** Unbounded resource allocation
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258212

---

# ZEUS Pay client redeems against server-named mint, enabling fake receipts and untrusted-mint injection

## Details
The ZEUS Pay client treats three values supplied by the ZEUS Pay server as authoritative when redeeming Cashu lightning-address payments: the mint URL at which the quote supposedly lives, the amount, and the token handed back by /api/lnurl/nuts/redeem. They arrive via /api/lnurl/status `paid[]` (stores/LightningAddressStore.ts 386-426, consumed by redeemAllOpenPaymentsCashu 638-664 and CashuPayment.tsx) and the socket.io `paid` event (678-682) and flow unchecked into redeemCashu (530-564) -> CashuStore.checkInvoicePaid (4052) -> checkAndMintCDK (876-1005). The mint the user chose when creating the address (settings.lightningAddress.mintUrl, LightningAddressStore.ts 180) and the wallet's trusted mint list (cashuStore.mintUrls) are never consulted on this path; the only reader of lightningAddress.mintUrl is a settings screen.

The native bridge creates a CDK wallet for any URL on demand: Kotlin checkMintQuote (CashuDevKitModule.kt 904-910) and receive (1518-1521) call getWallet (272-322), which createWallet()s on a miss; iOS mirrors this (CashuDevKitModule.swift 211-245, 1367-1369). checkExternalMintQuote (Kotlin 936-944; Swift 874-930) performs a plain HTTP GET to `${mint_url}/v1/mint/quote/bolt11/${quote_id}` and returns the reply's state/amount to JS as truth.

Consequences for a compromised or malicious ZEUS Pay backend (or a network attacker holding a certificate the device trusts: the zeuspay.com calls use ReactNativeBlobUtil.fetch without `trusty`, so standard TLS applies, but Android's network_security_config trusts user CAs and there is no pinning):

1. Fake payment receipt. The server sends {quote_id, mint_url: 'https://attacker-mint', amount_msat: 100000000}. checkMintQuote fails with Unknown quote; checkExternalMintQuote GETs the attacker's quote endpoint, which answers PAID (or ISSUED). On PAID the client calls addExternalMintQuote + mintExternal at the attacker mint and gets proofs under the attacker's keyset; getTotalBalance (Kotlin 707-726) folds every CDK wallet's balance, so totalBalanceSats shown in BalancePane/Wallet rises and loadTransactions adds an incoming activity row. On ISSUED checkAndMintCDK returns isPaid:true even when restore() recovered nothing (975-1005). redeemCashu then posts a local 'Payment received: 100,000 sats' notification built from the server's amount_msat (497-500), never from what was minted, and calls the redeem endpoint. The receipt state the threat model protects ('no fake success'; repo threat model: 'Reporting a payment as sent or received when it was not is a security bug') is falsified without any real payment, and a merchant relying on the ZEUS Pay notification could release goods against it.

2. Untrusted-mint injection, bypassing a shipped control. For user-presented tokens, views/Cashu/CashuToken.tsx (120-131, 550) disables Receive unless `mintUrls.includes(mint)`, with a comment that an untrusted mint must only be contacted on explicit user action. The server-returned redeemData.token is instead received regardless of its mint (receiveTokenCDK 1803-1826 -> native receive -> getWallet(token.mintUrl())), so arbitrary-mint proofs enter the user's balance without that consent. The injected mint persists in CDK until the startup orphan reconcile in initializeWallets.

3. Forced outbound requests from the device to any URL the server names (quote GET, keyset fetches during mint).

The path runs with no user interaction: Wallet.tsx 1375-1383 calls status() and prepareToAutomaticallyAcceptCashu() on every startup when lightningAddress.enabled and automaticallyAccept (default true, SettingsStore.ts 1685-1697) hold. Binding mint_url to the user's own mints would make a diverted or fabricated payment fail at the first step and surface the compromise. The flow tests (LightningAddressStore.flows.test.ts 357-460) exercise only a constant MINT and never a foreign one.

## Evidence
1. [stores/LightningAddressStore.ts:530–563](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LightningAddressStore.ts#L530-L563)
   redeemCashu passes the server-supplied quote_id and mint_url straight to cashuStore.checkInvoicePaid. On isPaid (or updatedInvoice.state === 'ISSUED') it calls the ZEUS Pay redeem endpoint, receives whatever token the server returns via receiveTokenCDK, and fires a 'payment received' notification whose amount is the server-supplied amount_msat (497-500), not anything actually minted. Nothing compares mint_url with settings.lightningAddress.mintUrl or cashuStore.mintUrls. Primary fix location.
2. [stores/LightningAddressStore.ts:678–681](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LightningAddressStore.ts#L678-L681)
   socket.io 'paid' handler: {quote_id, mint_url, amount_msat} from zeuspay.com is fed to redeemCashu with localNotification=true, with no validation.
3. [stores/LightningAddressStore.ts:386–425](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LightningAddressStore.ts#L386-L425)
   status() copies paid[] (each {quote_id, mint_url, amount_msat}) from the server response into this.paid; redeemAllOpenPaymentsCashu (638-664) and views/LightningAddress/CashuPayment.tsx:121 then redeem each entry with its server-named mint.
4. [stores/CashuStore.ts:876–1004](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L876-L1004)
   When CDK reports Unknown quote, checkAndMintCDK asks the server-named mint directly (checkExternalMintQuote). A reply of PAID leads to addExternalMintQuote + mintExternal at that mint and isPaid:true; a reply of ISSUED returns isPaid:true even when restore() recovered nothing. The named mint's own answer decides 'paid'.
5. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:936–943](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L936-L943)
   checkExternalMintQuote performs an HTTP GET to `${mintUrl}/v1/mint/quote/bolt11/${quoteId}` built from the server-supplied strings; the reply's state/amount are returned to JS as truth. iOS equivalent: ios/CashuDevKit/CashuDevKitModule.swift 874-930.
6. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:272–322](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L272-L322)
   getWallet creates a CDK wallet for any mint URL on a lookup miss (repo.createWallet). It is what checkMintQuote (904-910), mintExternal and receive call, so the server-named mint gets a wallet without consulting the user's mint list; ensureMintAdded in CashuStore is not on this path. iOS mirrors this in CashuDevKitModule.swift 211-245.
7. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:1518–1520](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L1518-L1520)
   receive() resolves a wallet for the token's own mint URL ('allowUntrusted: true' semantics per the comment), so proofs from a mint the user never added are accepted into the wallet and its balance. iOS: CashuDevKitModule.swift 1367-1369.
8. [stores/CashuStore.ts:1803–1825](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L1803-L1825)
   receiveTokenCDK receives the server-returned token with no check of the token's mint against the user's mints (redeemCashu passes no mintUrl, so even ensureMintAdded is skipped).
9. [views/Cashu/CashuToken.tsx:120–130](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/CashuToken.tsx#L120-L130)
   The shipped control the server path bypasses: for user-presented tokens the view computes haveMint = mintUrls.includes(mint) and disables Receive when !haveMint (line 550), with a comment that an untrusted mint must only be contacted on explicit user action. The ZEUS Pay redeem path applies no equivalent gate.
10. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:707–725](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L707-L725)
   getTotalBalance folds every CDK wallet's balance for the configured unit, including the on-demand wallet for the attacker-named mint, so CashuStore.totalBalanceSats (shown in views/Wallet/BalancePane.tsx:210 and Wallet.tsx) is inflated by the fabricated proofs.
11. [views/Wallet/Wallet.tsx:1375–1382](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L1375-L1382)
   On every startup with lightningAddress.enabled, the app calls LightningAddressStore.status() and, when automaticallyAccept (default true, SettingsStore.ts 1685-1697) and the address is Cashu-type, prepareToAutomaticallyAcceptCashu() (LightningAddressStore.ts 684-692), which redeems all paid[] entries and subscribes to the socket; no user interaction is needed.

## Impact
Integrity of the wallet's payment and balance state is defeated: fabricated received-payment notifications (amount taken from the server), inflated ecash balance and incoming activity rows backed by proofs from a mint the user never trusted, and injection of arbitrary-mint tokens around the app's own mintUrls.includes gate. The repository's threat model rates a payment reported as received when it was not as High. No confidentiality impact beyond outbound connections to attacker-named hosts (the server already knows the user's IP); no availability impact.

## Reproduction steps
1. The attacker holds the ZEUS Pay server position: a compromised or malicious zeuspay.com backend (source outside this repository), or a network attacker able to present a certificate the device trusts (the zeuspay.com calls use standard TLS without pinning; Android's network_security_config trusts user CAs). The victim has a Cashu-type ZEUS Pay address with automaticallyAccept left at its default of true. On app start Wallet.tsx calls status() and prepareToAutomaticallyAcceptCashu(); the attacker's paid[] entry or socket 'paid' event names an attacker-run mint and amount. The client creates a CDK wallet for that mint, queries it, accepts its PAID/ISSUED answer, mints or restores proofs from it, posts 'payment received' for the server's amount, inflates the shown balance and receives any token the redeem endpoint returns. No user action and no credentials to the app are required; attack_requirements PRESENT reflects the need to hold the server position.

## Recommended fix
1. redeemCashu/checkInvoicePaid accept the mint URL named by the ZEUS Pay server (status paid[] and socket 'paid') and let that mint's answer decide 'paid', so an attacker-controlled server can steer redemption to an attacker mint and fabricate receipt state. Fix criteria: Before any CDK or network call, the mint_url of a paid entry must be one the user has configured (settings.lightningAddress.mintUrl or cashuStore.mintUrls); entries naming any other mint are rejected and surfaced as an error, never added via ensureMintAdded, queried, or redeemed. Verify by sending a paid entry with a foreign mint_url and confirming no addMint/quote request, no notification, no balance change, and no redeem call.
2. The 'payment received' notification and the redeem call use the server-supplied amount_msat and a bare isPaid flag, and checkAndMintCDK reports isPaid:true for ISSUED with nothing restored, so the displayed receipt does not reflect proofs actually obtained. Fix criteria: Receipt notifications and activity entries report only the amount actually minted/received from a trusted mint, and the redeem endpoint is only told a payment is consumed after proofs were obtained; an ISSUED quote with zero restored proofs is not announced as received.
3. receiveTokenCDK accepts the server-returned token for any mint, injecting untrusted-mint proofs into the balance. Fix criteria: Tokens returned by /api/lnurl/nuts/redeem are decoded first and received only when their mint is in the user's configured mint list; otherwise they are rejected with a visible error.

---
**Severity:** HIGH
**Status:** Open
**Category:** Reliance on untrusted input
**CWE:** [CWE-807](https://cwe.mitre.org/data/definitions/807.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258210

---

# ZEUS Pay auth blindly signs any server-chosen string with the node key, leaking LNURL-auth identity

## Details
stores/LightningAddressStore.ts getAuthData (99-126) authenticates to ZEUS Pay by POSTing the node pubkey to https://zeuspay.com/api/lnurl/auth, taking the `verification` string from the JSON reply and signing it with BackendUtils.signMessage — the Lightning node's identity key (LND /v1/signmessage, lnd-mobile signMessageNodePubkey, LNC lightning.signMessage, LDK Node sign_message). The resulting zbase/signature string is sent back with every subsequent ZEUS Pay call (status, create, redeem, plus/order, nwc, stream). The client imposes no constraint on what it signs: no client-built prefix or domain tag, no expected nonce format or length. The node identity key is therefore a chosen-message signing oracle for whoever answers as zeuspay.com. The request is a plain ReactNativeBlobUtil.fetch (no `trusty`), so standard TLS applies; the realistic attacker is a malicious or compromised ZEUS Pay backend (an adversary the threat model names), or a CA-level interposer (Android network_security_config trusts user CAs).

The payoff is in this codebase. views/LnurlAuth.tsx (32-34, 126-142) derives the user's LNURL-auth identity per LUD-13: hashingKey = sha256(signMessage(canonical phrase).signature) and linkingKeyPriv = HMAC-SHA256(hashingKey, serviceDomain). On every backend that supports ZEUS Pay — LND REST and EmbeddedLND (supportsCustomPreimages, LND.ts 762-769 inherited), LNC (LightningNodeConnect.ts 923-930) and LDK Node (supportsCashuWallet, LdkNode.ts 1953-1960) — lnurlAuth() is signMessage(phrase) followed by sha256 of the returned signature string, the identical string getAuthData hands to the server. A server that replies {verification: '<LUD-13 canonical phrase>'} receives the node's signature over it on the next app start (Wallet.tsx 1366-1377 calls status() automatically when lightningAddress.enabled) or within 10 minutes of cache expiry, and can compute the hashing key and the linking private key for every domain, logging in as the user to every LNURL-auth relying service and signing their k1 challenges. The canonical phrase itself warns that disclosing its signature 'MAY LEAD TO LOSS OF FUNDS'. More generally the oracle lets the server relay any third party's node-key login challenge as `verification` and replay the signature there.

The maintainers' tests (LightningAddressStore.flows.test.ts 114-145) assert only that the challenge string is signed and echoed, confirming the design signs whatever the server supplies. The 10-minute cache and reset() govern reuse, not content. The same pattern (sign server-chosen `verification` from backups.lnolymp.us) appears in ChannelBackupStore.ts 88/136/209 and ChannelMigrationUtils.ts 179/236 and should be fixed alongside.

## Evidence
1. [stores/LightningAddressStore.ts:99–125](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LightningAddressStore.ts#L99-L125)
   getAuthData POSTs the node pubkey to zeuspay.com/api/lnurl/auth, takes `verification` from the response with no format, prefix, length or nonce check, signs it with BackendUtils.signMessage (node identity key) and returns the signature to the server with every subsequent call. The 10-minute cache governs reuse only; a malicious server obtains signatures over arbitrary text on each app start and every refresh.
2. [views/LnurlAuth.tsx:126–141](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LnurlAuth.tsx#L126-L141)
   ZEUS's LNURL-auth identity is derived from exactly this primitive: BackendUtils.lnurlAuth(LUD-13 canonical phrase, lines 32-34) yields hashingKey = sha256(signMessage(phrase).signature) and linkingKeyPriv = HMAC-SHA256(hashingKey, domain). Whoever holds the node's signature string over the canonical phrase holds the user's linking private key for every LNURL-auth service.
3. [backends/LND.ts:738–768](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L738-L768)
   signMessage is LND /v1/signmessage (identity key); lnurlAuth is that same call followed by sha256 of the returned signature string — the same string getAuthData sends to ZEUS Pay (signData.zbase || signData.signature). EmbeddedLND inherits this; LightningNodeConnect.ts 923-930 and LdkNode.ts 1953-1960 implement the identical derivation, and those four are exactly the backends for which BackendUtils.supportsLightningAddress() is true.
4. [views/Wallet/Wallet.tsx:1366–1376](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L1366-L1376)
   status() is awaited on every app start when lightningAddress.enabled, so the server-chosen challenge is fetched and signed automatically with no user involvement.

## Impact
A long-term secret equivalent is disclosed: the node's signature over the LUD-13 phrase is the root of the user's LNURL-auth identity (all per-domain linking private keys), and arbitrary identity-key signatures over attacker-chosen text are obtained. No direct integrity or availability effect on the wallet itself. Subsequent-system impact: The derived linking keys let the attacker authenticate as the victim at every LNURL-auth relying service and sign its k1 challenges, taking over those accounts (read and act on them, including custodial balances); relayed node-key challenges do the same for services using node-signature login. Impact crosses to third-party systems via the derivation shown in LnurlAuth.tsx.

## Reproduction steps
1. Attacker is the ZEUS Pay backend (malicious operator or compromise) or a CA-level TLS interposer on the direct, non-Tor zeuspay.com connection; obtaining that position is the attack requirement. Victim has any ZEUS Pay address enabled on LND, EmbeddedLND, LNC or LDK Node. On the next app start (or after the 10-minute cache lapses) getAuthData requests a challenge; the attacker returns the LUD-13 canonical phrase or a third party's login challenge. The client signs it with the node identity key and sends the signature back without any user interaction. Assumes LND SignMessage, lnd-mobile signMessageNodePubkey and LDK Node sign_message (ldk-node pinned in versions.json) sign with the node identity key in zbase32 form, as the LNURL-auth flow in this repository itself relies on.

## Recommended fix
1. getAuthData signs an unconstrained server-supplied string with the node identity key, so a malicious or compromised ZEUS Pay server can obtain signatures over text meaningful to other protocols (the LUD-13 canonical phrase, third-party login challenges). Fix criteria: The bytes signed for ZEUS Pay authentication must be domain-separated so they can never equal a message another protocol accepts: the client builds the signed message itself from a fixed ZEUS Pay-specific prefix plus the server nonce, and rejects challenges that do not match an expected random-nonce format and length. Verify that a server returning the LUD-13 canonical phrase (or any free-form text) as `verification` does not yield a signature over that text. Apply the same to the backups.lnolymp.us flows in ChannelBackupStore and ChannelMigrationUtils.
2. The LNURL-auth hashing key is derived from a plain identity-key signature that any component calling signMessage can produce, so disclosure of one signature compromises all linking keys. Fix criteria: LNURL-auth key material must not be recoverable from a signature a remote party can request: no code path other than the LNURL-auth flow may sign the canonical phrase, and where the backend offers it a dedicated derivation (key-derivation RPC or wallet-scoped key) should replace the signature-based hashing key.

---
**Severity:** HIGH
**Status:** Open
**Category:** Insufficiently protected credentials
**CWE:** [CWE-522](https://cwe.mitre.org/data/definitions/522.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258031

---

# Clipboard-imported LNDHub config defaults to TLS verification disabled, unlike QR/dropdown paths

## Details
ZEUS offers three ways to configure an LNDHub (custodial) account: pick 'LNDHub' in the interface dropdown, scan/deep-link an `lndhub://user:pass@https://host` string, or accept the clipboard banner that WalletConfiguration shows on mount when `privacy.clipboard` is on (it is on by default: DEFAULT_SETTINGS, stores/SettingsStore.ts:1565). The first two deliberately set `certVerification: true` (`selectImplementation` line 574; `handleAnything` line 601; both pinned by tests at WalletConfiguration.test.tsx:518-545 and handleAnything.test.ts:1913) because LNDHub providers (lndhub.io, ln.getalby.com, lnbits — CUSTODIAL_LNDHUBS) are public Internet services with CA-issued certificates. The clipboard path (`importClipboard`, lines 296-340) copies username/password/lndhubUrl/enableTor but omits certVerification, so on a fresh Add-wallet screen (Wallets.tsx:222 passes no node) it stays at the form's initial `false` (line 221).

When the user then taps Save, the generic self-signed-certificate modal appears ('Opting not to use Certificate Verification may leave you vulnerable to a man-in-the-middle attack ... I understand, save wallet config'). The modal was written for self-hosted LND/CLN nodes; the user never opted out of anything, and the natural action to complete the import is to confirm. The config is saved with `certVerification: false`, `updateNodeProperties` (SettingsStore.ts:2042) loads it into the store, and every LndHub request (backends/LndHub.ts:32-57 → LND.restReq) runs with `ReactNativeBlobUtil.config({ trusty: true })` (backends/LND.ts:88). On Android that selects the trust-all X509TrustManager in MainApplication.kt:43-49; on iOS react-native-blob-util 0.25.1's trusty mode accepts any server trust (assumption on the pinned dependency).

A network attacker on the path (hostile Wi-Fi, rogue AP, compromised router) can then present any certificate for the LNDHub host, read the login/password and bearer access/refresh tokens in the `/auth` exchange, substitute the invoice in `/payinvoice` requests, and alter balance/invoice/payment responses. The threat model lists each node's certVerification setting as an asset that 'must be honored' (.oss-scanner/threat_model.md:31) and 'a network attacker ... when TLS verification is disabled/misapplied' as an adversary; here it is misapplied by an inconsistent default rather than knowingly disabled by the user, so the 'user disabled verification on purpose' exclusion does not apply.

The lndconnect/clnrest clipboard branches and BTCPay pre-fill also arrive without certVerification and rely on the same modal; for self-hosted nodes with self-signed certificates that is the maintainers' documented intent, so this record is limited to the LNDHub clipboard path where the project's own sibling code and tests establish `true` as the correct default.

## Evidence
1. [views/Settings/WalletConfiguration.tsx:296–339](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/WalletConfiguration.tsx#L296-L339)
   importClipboard's lndhub/bluewallet branch sets implementation:'lndhub', username, password, lndhubUrl and enableTor but never sets certVerification, so on a fresh Add-wallet screen it stays at the form's initial false. This is the code the fix must change.
2. [views/Settings/WalletConfiguration.tsx:221](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/WalletConfiguration.tsx#L221)
   Initial form state certVerification: false; Wallets.tsx:222 opens Add wallet with only {newEntry, index} and no node, so nothing else sets it before importClipboard runs.
3. [views/Settings/WalletConfiguration.tsx:570–580](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/WalletConfiguration.tsx#L570-L580)
   selectImplementation explicitly sets certVerification: value === 'lndhub' ? true : false — the project's own per-implementation secure default for lndhub (pinned by WalletConfiguration.test.tsx:518-545).
4. [utils/handleAnything.ts:589–617](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L589-L617)
   The QR/deep-link lndhub path builds the node with certVerification: true (pinned by handleAnything.test.ts:1913). The same string arriving via the WalletConfiguration clipboard banner yields false.
5. [stores/SettingsStore.ts:1565](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L1565)
   DEFAULT_SETTINGS.privacy.clipboard is true, so the clipboard banner (WalletConfiguration.tsx:384-397) is shown on a default install; no opt-in is needed to reach the vulnerable path.
6. [views/Settings/WalletConfiguration.tsx:3447–3468](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/WalletConfiguration.tsx#L3447-L3468)
   Save with certVerification false, no Tor and an https lndhubUrl opens the generic self-signed-cert modal (text locales/en.json:342-344 'Opting not to use Certificate Verification...'); the 'I understand, save wallet config' button at 1800-1813 calls saveWalletConfiguration, persisting certVerification: false.
7. [stores/SettingsStore.ts:2042](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L2042)
   updateNodeProperties loads node.certVerification || false into the live store when the wallet is selected.
8. [backends/LndHub.ts:32–56](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LndHub.ts#L32-L56)
   LndHub.request reads certVerification from settingsStore and passes it to LND.restReq for every call, including login (/auth with login+password, returning the bearer access/refresh tokens), balance, invoices and payinvoice.
9. [backends/LND.ts:86–89](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L86-L89)
   restReq issues the request with ReactNativeBlobUtil.config({ trusty: !certVerification }); with certVerification false every TLS certificate is accepted.
10. [android/app/src/main/java/com/zeus/MainApplication.kt:43–48](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/MainApplication.kt#L43-L48)
   The trust manager installed for react-native-blob-util's trusty mode accepts every server chain (empty checkServerTrusted), so an on-path attacker's certificate for the LNDHub host is accepted.

## Impact
Full disclosure of the custodial account credentials (login, password, access/refresh tokens) and all traffic (invoices, payment history, balance), and the ability to alter requests and responses (substituted payinvoice destination, fake payment success/failure) for that LNDHub account; the stolen login can later be used from anywhere to drain the custodial balance. Availability of the app itself is unaffected.

## Reproduction steps
1. Victim copies their lndhub:// account string (the normal way providers hand it out), opens Settings > Wallets > Add wallet (clipboard sniffing is on by default), taps Import on the banner, and confirms the certificate modal when saving. From then on an attacker positioned on the network path between the phone and the LNDHub provider (hostile Wi-Fi, rogue AP) terminates TLS with any certificate and proxies the traffic, capturing login, password and tokens and altering requests/responses. Requires the on-path position (AT:P) and the user's import plus modal confirmation (UI:A).

## Recommended fix
importClipboard's lndhub branch does not set certVerification, so the implementation-specific secure default applied by selectImplementation and handleAnything is lost on this one entry path, and the resulting insecure config is only gated by a generic warning modal the user did not cause. Fix criteria: Every path that sets implementation to 'lndhub' (clipboard import, QR/deep link, dropdown, config import) must yield certVerification true unless the user explicitly toggles it off in the form afterwards; verify that importing an lndhub:// string from the clipboard and saving produces a node with certVerification === true and that the LndHub backend issues requests with trusty: false. Consider centralising the per-implementation default so new entry paths cannot regress it.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper Certificate Validation
**CWE:** [CWE-295](https://cwe.mitre.org/data/definitions/295.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258027

---

# P2PK-locked ecash with a duration becomes spendable by anyone after the lock expires

## Details
ZEUS lets a sender lock an ecash token to a recipient pubkey (NUT-11 P2PK) and choose a lock duration in CashuLockSettings ('Lock for': 1 Day [default], 1 Week, Forever, Custom). SendEcash converts the duration to an absolute unix locktime and CashuStore.sendTokenCDK (stores/CashuStore.ts:1713-1727) turns that into a CDKSpendingConditions of kind P2PK containing only `pubkey` and `locktime`. It never sets `refund_keys`, although the bridge type CDKP2PKCondition exposes them and both native bridges (CashuDevKitModule.kt:166-203, CashuDevKitModule.swift:74-115) pass them straight through to CDK unchanged, so the resulting secret is exactly `["P2PK", {data: <recipient>, tags: [["locktime", N]]}]`.

Under NUT-11, a P2PK proof whose locktime has passed and which carries no `refund` tag is spendable by anyone: the mint accepts a swap with no witness. ZEUS's own receive path encodes this: CashuUtils.isTokenP2PKLocked returns false once locktime <= now, so a ZEUS wallet handed the token string after expiry claims it with an empty p2pk_signing_keys list (CashuStore.ts ~5152, ~5288).

Consequence: for every lock with a finite duration (the default is 1 Day), the exclusivity the UI promises ('Only the receiver will be able to unlock it') holds only until the deadline; afterwards the token is a plain bearer instrument. Any party who observed the token in transit (chat log, forwarded message, screenshot, shared clipboard, leaked backup, QR photo) - precisely the adversary P2PK exists to defeat - stores it and submits it to the mint one second after locktime. If the recipient has not claimed by then (offline, or a long lock chosen deliberately as 'hold for the recipient'), the funds are stolen; no key and no interaction with sender or recipient is required. The sender's own P2PK key (deriveCashuPubkey, CashuStore.ts:3849) is available and is the natural refund key; with it set, the post-expiry path would require the sender's signature and a third party would gain nothing.

Assumptions on dependencies (not verifiable in this checkout): the CDK 0.18.1 FFI bindings (fetch-libraries-versions.json) map an empty `refund_keys` list to no `refund` tag rather than an empty one, and the mint implements NUT-11's locktime rule (Nutshell and CDK mintd both return the proof as spendable when locktime has passed and no refund keys are present). The project's own receive logic (isTokenP2PKLocked) is consistent with both.

## Evidence
1. [stores/CashuStore.ts:1713–1727](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L1713-L1727)
   sendTokenCDK builds the NUT-11 P2PK condition with only `pubkey` and (when the user chose a finite duration) `locktime`. `refund_keys` is never set, so once locktime passes the secret carries no refund pathway and the mint accepts a swap of these proofs with no witness from anyone. This is the line the fix must change (populate refund_keys with the sender's own pubkey from deriveCashuPubkey when a locktime is set).
2. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:166–202](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L166-L202)
   The Android bridge passes `refund_keys` through verbatim (empty list when JS omits it) into CDK `Conditions`; nothing downstream adds a refund path, so the token's secret is exactly `pubkey` + `locktime`.
3. [ios/CashuDevKit/CashuDevKitModule.swift:74–114](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/CashuDevKit/CashuDevKitModule.swift#L74-L114)
   Same pass-through on iOS: refundKeys is [] when JS omits the field and is handed to CDK Conditions unchanged.
4. [cashu-cdk/types.ts:121–133](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/cashu-cdk/types.ts#L121-L133)
   CDKP2PKCondition exposes refund_keys / num_sigs_refund; the bridge supports a refund path but the store never populates it.
5. [utils/CashuUtils.ts:249–265](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/CashuUtils.ts#L249-L265)
   isTokenP2PKLocked returns false once locktime <= now; the receive paths (CashuStore.ts ~5152 and ~5288) then pass no p2pk_signing_keys and claim the token. The codebase itself relies on expired-lock tokens being claimable by a holder with no key, confirming the anyone-can-spend semantics ZEUS produces.
6. [views/Cashu/SendEcash.tsx:293–307](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/SendEcash.tsx#L293-L307)
   lockTime is computed as now + duration seconds from the 'Lock for' selector and passed to mintToken -> sendTokenCDK.
7. [views/Cashu/CashuLockSettings.tsx:71–75](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/CashuLockSettings.tsx#L71-L75)
   DURATION_OPTIONS are '1 Day', '1 Week', 'Forever', 'Custom'; line 105 defaults `duration` to DURATION_OPTIONS[0] ('1 Day'), so the default lock a user applies degrades to anyone-can-spend after 24 hours.
8. [views/Cashu/CashuLockSettings.tsx:470–475](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/CashuLockSettings.tsx#L470-L475)
   The lock screen tells the sender 'Lock ecash token to a public key. Only the receiver will be able to unlock it.' (locales/en.json cashu.lockEcashDescription); the token view only shows 'Locked until <date>'. Nothing discloses that the lock degrades to anyone-can-spend after the chosen duration rather than reverting to the sender.

## Impact
Full loss of the locked token's value to an unauthorised third party; the protection the sender explicitly configured is silently voided after the deadline instead of reverting control to the sender. Loss is bounded to the amount of the token the sender locked. No confidentiality or availability impact beyond the stolen funds.

## Reproduction steps
1. Attacker is anyone who obtains the token string during or after transit - the adversary the P2PK lock is meant to defeat; the project concedes nothing to that party ('Only the receiver will be able to unlock it'). They wait until the sender-chosen locktime passes (24h by default) and submit the token to the mint over the network; with no refund keys the mint accepts the swap with no signature. Attack requirements are present: the sender must have chosen a finite duration (the default), the attacker must have observed the token, and the recipient must not have claimed by the deadline. No privileges, no victim interaction at exploitation time.

## Recommended fix
1. sendTokenCDK emits a NUT-11 P2PK condition with a locktime but no refund keys, so the lock degrades to anyone-can-spend at expiry instead of reverting control to the sender. Fix criteria: When a locktime is set, the spending condition must include refund_keys bound to the sender's own Cashu pubkey (deriveCashuPubkey), and the receive path must pass the sender's signing key when the sender re-claims an expired token (isTokenP2PKLocked must treat a token with a refund tag as still locked after expiry). Verify by decoding a token produced with a duration and confirming the secret carries a refund tag, and that a wallet without either key cannot swap it after locktime.
2. The lock UI asserts exclusive recipient access without disclosing the post-expiry semantics. Fix criteria: The 'Lock for' control and the token view must state what happens at expiry (reverts to sender) so the user's configured protection matches what the token enforces.

---
**Severity:** HIGH
**Status:** Open
**Category:** Incorrect authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258017

---

# Exponential-backtracking regex in errorToUserFriendly freezes app on LSP-supplied error strings

## Details
utils/ErrorUtils.ts errorToUserFriendly is the app-wide function that turns backend and server error strings into user-facing text. Before anything else it evaluates

    const pascalCase = /^[A-Z](([a-z0-9]+[A-Z]?)*)$/;
    if (pascalCase.test(errorMsg)) { ... }

on the untrusted message (ErrorUtils.ts:188, 200-208). The inner `[a-z0-9]+` is repeated by the outer `*` with only an optional `[A-Z]?` between iterations, so a run of n lowercase/digit characters admits 2^(n-1) distinct partitions. When the anchored match fails (the string contains any character outside [A-Za-z0-9] after the run, e.g. '.', '!', a space, or a trailing hyphen), a backtracking regex engine explores every partition. A message such as `"A" + "a"*40 + "!"` costs on the order of 2^39 steps; longer runs are effectively unbounded. The call runs on the React Native JS thread, so every JS-driven screen (lock screen, payment screens, the NWC service handler) stops responding; the user must force-quit, and the request is re-issued on the next wallet fetch.

Assumption (dependency, not verifiable in this checkout): the Hermes engine bundled with react-native 0.87.1 (android/gradle.properties hermesEnabled=true; iOS default) is a backtracking matcher without memoisation, as is JSC; Hermes' backtrack-stack depth limit bounds depth (linear in n here), not the number of steps.

The string is attacker-controlled from third-party servers the threat model lists as adversaries:
- Flow LSP: LSPStore.formatFlowError (300-304) feeds `data.message || data.error` from the LSP's HTTP body into errorToUserFriendly; getLSPInfo (378-382) calls it with the parsed body for any non-200 /api/v1/info reply. initFlowLSP (423-440) issues getLSPInfo automatically whenever settings.enableLSP is on (default true, SettingsStore.ts:1660) for LND / embedded LND, and Wallet.tsx:1446 calls initFlowLSP on every wallet fetch. A malicious or compromised Flow host (default flow.zeuslsp.com, or a custom host the user configured) therefore freezes the wallet on every startup without user action, and the condition persists until the LSP changes its reply or the user manages to disable/replace the LSP before the response lands.
- LSPS1/LSPS7 over custom messages: `error.message` / `error.data.message` from JSON-RPC replies received from the LSP peer (LSPStore 791-860).
- LSPS1 REST: `responseData.message` from the configured create_order endpoint (1076).
- Also node error bodies (TransactionsStore, ChannelsStore, etc.), though the remote node is trusted.

No length limit or linear-time check protects the input. The 'Handle LSP spec error message formatting' comment shows the branch was written specifically for LSP-originated strings, i.e. for input from a third party. The project's own severity ladder (.oss-scanner/threat_model.md) rates 'denial of service from untrusted input that ... makes a wallet unusable' as Medium.

## Evidence
1. [utils/ErrorUtils.ts:188](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ErrorUtils.ts#L188)
   pascalCase = /^[A-Z](([a-z0-9]+[A-Z]?)*)$/ nests an unbounded '+' inside an unbounded '*' with only an optional [A-Z]? separator, so a run of n lowercase/digit characters admits 2^(n-1) distinct partitions; when the anchored match fails on a trailing non-alphanumeric character a backtracking engine explores every partition. This is the line the fix must change.
2. [utils/ErrorUtils.ts:200–207](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ErrorUtils.ts#L200-L207)
   errorMsg is the raw caller-supplied string (or error.message / parsed JSON error.message / message) and is tested against pascalCase at line 207 with no length cap and before any other processing.
3. [stores/LSPStore.ts:300–304](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L300-L304)
   formatFlowError passes data.message || data.error from the Flow LSP's HTTP JSON body straight into errorToUserFriendly.
4. [stores/LSPStore.ts:378–382](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L378-L382)
   getLSPInfo calls formatFlowError with the parsed body for any non-200 /api/v1/info reply, so the LSP triggers the regex with an HTTP error response.
5. [stores/LSPStore.ts:423–439](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L423-L439)
   initFlowLSP fires getLSPInfo without user action whenever settings.enableLSP (default true, SettingsStore.ts:1660) and the backend supports Flow (LND and embedded LND), so the hostile reply is fetched automatically.
6. [views/Wallet/Wallet.tsx:1446](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L1446)
   Wallet.tsx calls LSPStore.initFlowLSP() on every wallet fetch after connect, so the freeze recurs on each app start / refresh while the LSP keeps replying with the payload.
7. [stores/LSPStore.ts:791–799](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L791-L799)
   LSPS1/LSPS7 JSON-RPC error.message / error.data.message received from the LSP over Lightning custom messages are passed to errorToUserFriendly (same pattern repeated through line 860).
8. [stores/LSPStore.ts:1074–1076](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L1074-L1076)
   LSPS1 REST create_order response body responseData.message from the configured LSP host is passed to errorToUserFriendly.

## Impact
Availability: the JS thread hangs deterministically on receipt of the reply, rendering the wallet unusable (cannot pay, receive, unlock, or serve NWC requests) and, via the automatic Flow startup request, recurring on every launch until the LSP changes its reply or the user races to disable/replace the LSP before the response lands. No confidentiality or integrity effect.

## Reproduction steps
1. The attacker operates (or has compromised) the Flow LSP host the wallet is configured to use (default flow.zeuslsp.com), the LSPS1 REST host, or the LSPS1/LSPS7 peer. They answer a routine request (Flow GET /api/v1/info on every wallet fetch, or an LSPS1/LSPS7 order) with a non-200 JSON body whose message is a capital letter followed by tens of lowercase characters and a terminating punctuation character. The wallet hands the string to errorToUserFriendly and pascalCase.test never completes. Flow info is fetched automatically from Wallet.tsx:1446 → initFlowLSP → getLSPInfo with enableLSP defaulting to true, so no user interaction is needed and the condition recurs on every launch. AT:P because the attacker must hold the LSP position for the wallet's configured host. Assumes the bundled Hermes/JSC regex engine is a non-memoising backtracker (react-native 0.87.1).

## Recommended fix
1. errorToUserFriendly applies a regex with nested unbounded quantifiers (`([a-z0-9]+[A-Z]?)*`) to untrusted, unbounded error strings from third-party servers. Fix criteria: PascalCase detection must run in linear time on any input (e.g. an unambiguous pattern such as a single character-class repetition, or a non-regex scan) and/or be applied only to inputs under a small length cap. Verify that a string of one uppercase letter followed by 10,000 lowercase letters and a '!' is processed in milliseconds.
2. LSP and other server-supplied error messages are handed to the formatter with no length bound. Fix criteria: Server-originated error text is truncated to a short display limit before any parsing or display, so no third-party response can drive super-linear work in the UI thread.

---
**Severity:** HIGH
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258014

---

# Submarine swap lockup address, script and amount from provider never verified before user pays

## Details
In a Boltz-protocol submarine swap (on-chain -> Lightning) the client sends the provider its refund public key and the invoice, and the provider replies with the lockup `address`, a `bip21` URI, the `swapTree` (claim leaf: HASH160(payment hash) + server key; refund leaf: our key + CLTV timeout), the server's `claimPublicKey`, `timeoutBlockHeight` and `expectedAmount`. Atomicity for the user rests entirely on the lockup output being the taproot output of that tree with the user's key in the refund leaf and a reasonable timeout; otherwise the user has no way to recover funds if the provider does not pay the invoice.

`SwapStore.createSubmarineSwap` (stores/SwapStore.ts:468-526) performs none of these checks. It parses the response, attaches the refund key, persists it and navigates to SwapDetails. SwapDetails shows `effectiveLockupAddress`/`expectedAmount` and, on 'Pay invoice', passes `swapData.qrCodeValue` -- the provider's raw `bip21` string -- to `handleAnything`, which opens the Send screen pre-filled with that address and amount (SwapDetails.tsx:1257-1275, models/Swap.ts:132-140). The QR code shown is the same string. Nothing compares the bip21 address to `address`, reconstructs the tree from (invoice payment hash, our refund key, claimPublicKey, timeoutBlockHeight), derives the expected P2TR output and compares it with the address, bounds `timeoutBlockHeight`, or compares `expectedAmount` with the fee quote the Swaps screen displayed.

Attack: a malicious or compromised swap provider (the app ships two third-party default hosts and supports arbitrary custom hosts; the threat model names the provider as an adversary) answers POST /swap/submarine with a `bip21`/`address` it fully controls (e.g. a plain P2TR of its own key, or a tree whose refund leaf uses a key it owns, or a timeout thousands of blocks away). The user taps Pay, approves the amount shown, and the on-chain funds go to the attacker. The provider never pays the invoice. The refund path (Refund.tsx:87-108) signs with the user's key against the provider's tree and can never produce a valid spend, so the loss is total and permanent. A taproot address cannot be checked by eye, so the on-screen address gives the user no protection.

The maintainers already implemented the full verification primitive for the reverse direction (`verifyReverseSwapResponse`, SwapUtils.ts:264-366: leaf reconstruction, BIP-327 KeyAgg of [serverKey, ourKey], taproot output derivation, address and timeout checks, amount floor) and wired it into both creation and claim; the submarine direction, which is the one where the user moves funds first and irrevocably, has no equivalent.

## Evidence
1. [stores/SwapStore.ts:452–535](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L452-L535)
   createSubmarineSwap POSTs the invoice and a fresh refundPublicKey to `${getHost}/swap/submarine`, JSON.parses the body, checks only responseData.error, then attaches the refund keys, persists the response via saveSubmarineSwap and navigates to SwapDetails. Nothing reconstructs the claim/refund leaves from the invoice payment hash, our refund key, claimPublicKey and timeoutBlockHeight, derives the P2TR output and compares it with `address` and the `bip21` address, bounds timeoutBlockHeight, or compares expectedAmount with the quote. This is the location the fix must change.
2. [views/Swaps/SwapDetails.tsx:1257–1274](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L1257-L1274)
   While the swap is InvoiceSet/Created, the 'Pay invoice' button hands swapData.qrCodeValue (the provider's raw bip21) to handleAnything and navigates to the route it returns, so the user is sent to the on-chain Send screen pre-filled with the provider's destination and amount.
3. [models/Swap.ts:128–140](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/models/Swap.ts#L128-L140)
   effectiveLockupAddress (what SwapDetails displays) is `address || lockupAddress`, while qrCodeValue for a submarine swap (what the QR shows and the Pay button pays) is `bip21 || lockupAddress`, both verbatim from the provider; the two are never compared with each other or with anything the app derived.
4. [utils/handleAnything.ts:446–455](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L446-L455)
   A bip21 URI whose address is valid for the node's network is routed to 'Send' with destination=value, satAmount from the URI, transactionType 'On-chain' and isValid: true — the provider's address and amount become the pre-filled on-chain payment the user approves.
5. [views/Swaps/Refund.tsx:87–107](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/Refund.tsx#L87-L107)
   The only recovery path spends the lockup through the native createRefundTransaction using the provider-supplied swapTree leaves, servicePubKey, timeoutBlockHeight and lockupAddress with our refundPrivateKey. If the paid output is not the taproot output of a tree whose refund leaf pays our key, no script-path spend signed by our key can validate, so the funds are unrecoverable.
6. [utils/SwapUtils.ts:264–365](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/SwapUtils.ts#L264-L365)
   verifyReverseSwapResponse implements the needed primitive for the reverse direction (leaf reconstruction, compressed-key check, KeyAgg of [serverKey, ourKey], taproot output derivation, witness-program comparison with the address, timeout extraction, amount floor); no submarine equivalent exists anywhere in the tree.
7. [stores/SwapStore.ts:631–703](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L631-L703)
   The sibling createReverseSwap calls verifyReverseSwapInvoice, verifyReverseSwapResponse and verifyReverseSwapDeadline and aborts without saving on any mismatch, showing the project treats the provider's response as untrusted; createSubmarineSwap has no counterpart.

## Impact
The user's on-chain funds for the swap amount are sent to an attacker-controlled output with no refund path; the provider keeps them without paying the invoice. This is a complete loss of the funds the user approved for the operation, i.e. a destination substitution of the approved payment (integrity of the amount/destination asset in the threat model). No confidentiality or availability impact beyond the loss itself.

## Reproduction steps
1. Attacker is the swap provider (or whoever controls the host the user selected, including a compromised default host). The user opens Swaps, enters an amount and invoice, taps Initiate; the provider returns an address it controls; the user taps Pay and approves the on-chain send. No defence stands in the way: the response is trusted verbatim and the UI displays the attacker's address/amount as the swap's. Works on every deployment since verification is absent; requires only that the user complete a swap with that provider.

## Recommended fix
1. createSubmarineSwap trusts the provider's address, bip21, swapTree, claimPublicKey, timeoutBlockHeight and expectedAmount without reconstructing the expected lockup script from values the app controls or chose (invoice payment hash, its own refund key, the quoted fees). Fix criteria: Before saving the swap or offering any way to pay it, the app must: rebuild the claim leaf from the invoice's payment hash and the provider's compressed claimPublicKey and the refund leaf from its own refund key and the response's timeoutBlockHeight; check both equal the returned swapTree leaves (tapscript version 0xc0); derive the P2TR output key from KeyAgg([claimPublicKey, refundPublicKey]) tweaked with that tree and require the witness program of `address` and of the bip21 address to equal it; bound timeoutBlockHeight above the current tip and below a sane maximum; and reject an expectedAmount above the quoted send amount. Any mismatch aborts with an error and nothing is persisted or displayed as payable. Verify by feeding a response with a foreign address, foreign refund key, or inflated amount and confirming the Pay button and QR never appear.
2. SwapDetails and Swap.qrCodeValue pay the raw provider bip21 string rather than an address/amount the app verified. Fix criteria: The payable value shown and passed to the Send flow must be constructed by the app from the verified address and verified expected amount, not copied from the provider's bip21; the displayed address and the paid address must be guaranteed identical.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing data authenticity verification
**CWE:** [CWE-345](https://cwe.mitre.org/data/definitions/345.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258004

---

# NWC releases pending pay_invoice budget hold when node list omits in-flight payment; later settlement never debited

## Details
A pay_invoice whose HTLC is still outstanding when the 125 s store wait ends is recorded as a 'pending' activity (recordPendingPayment, stores/NostrWalletConnectStore.ts:3493-3537) and its amount is held against the connection budget only through pendingSpendSats (models/NWCConnection.ts:233-241). reconcilePendingPayInvoiceActivities (3063-3105) later resolves such rows by searching paymentsStore.getPayments(); when the payment is not in that list it calls abandonStaleUnresolvedPayInvoiceHold, which, once isPayInvoiceHoldAbandoned (utils/NostrConnectUtils.ts:1039-1074) returns true - 7 days of age, or 24 h after the payee-chosen bolt11 expiry - marks the row 'failed'/'error.paymentFailed' (3113-3126). That row is no longer unresolved (NWCConnection.ts:276-291 treats a failed row as unresolved only when its error is a timed-out message), so it is never reconciled again and its amount no longer counts against the budget. The release is keyed on time and absence from a list, not on any evidence from the node that the HTLC resolved, and the released row is dropped from reconciliation instead of staying debit-eligible. An in-flight payment is absent from the list on these backends:

- Embedded LND: EmbeddedLND.getPayments (backends/EmbeddedLND.ts:129-133) passes the NWC store's undefined params to lndmobile listPayments (lndmobile/index.ts:628-647), which sends max_payments 1000 and omits reversed; per proto/lightning.proto:4414-4420 a zero index_offset without reversed starts from the oldest payment, so once the node has more than 1000 lifetime payments (failed attempts included, and the client can add them) no recent or in-flight payment is ever listed.
- LndHub: getPayments is /gettxs (backends/LndHub.ts:66-69). Assumption about the third-party server: BlueWallet LndHub lists in-transit payments only as 'Payment in transition' rows without payment_hash or pay_req, which Payment.getPaymentRequest/paymentHash cannot match (an LNbits-style server that lists the hash keeps the row pending and is not affected). The 60 s client timeout (161-184) yields payment_error 'paymentTimedOut', which TransactionsStore.handlePayment and resolveLightningPaymentInTransit (NostrConnectUtils.ts:1216-1286) turn into a pending hold.
- LND REST / LNC (newest 500, include_incomplete; backends/LND.ts:389-402) and CLNRest (newest 150 sendpay groups; CLNRest.ts:386-389): the in-flight payment is listed and kept pending, but the client can evict it by submitting a few hundred pay_invoice requests for 1-sat invoices that fail at the destination; each failed attempt is a listed payment record that costs no budget (recordFailedPayment debits nothing) and the only pay_invoice throttle is the 30 s serial queue (MAX_PAYMENT_QUEUE_WAIT_MS).

Attack: an NWC client with pay_invoice permission and a budget submits a hodl invoice from its own node with a short bolt11 expiry (unexpired at submission so the pre-check at 2569-2580 passes) and a large min_final_cltv_expiry; the payer passes no cltv_limit (lndmobile/index.ts:324, LND.ts:548-575), so LND's default total-timelock bound (~2016 blocks) lets the HTLC be held for days. The service pays, the wait times out, and a pending hold for the full budget (or budget minus 1 sat when eviction attempts are needed) is recorded. The client holds the HTLC for 24 h past expiry; its next pay_invoice, lookup_invoice or list_transactions (2587, 2383, 2455) or the user opening the activity screen (1306, 1636) runs reconcile, finds the payment unlisted, abandons the hold and frees the budget. The client then spends the full budget again (validateBudgetBeforePayment admits it) and settles the first HTLC. The first payment, now settled on the node, is never debited: reconcile only revisits unresolved rows, and the already-paid replay branch is one the attacker does not take. Net effect: one extra full budget per 24 h cycle, repeatable for the life of the connection and bounded only by the wallet balance check at 2634-2648. Gain depends on the budget renewal (BUDGET_RENEWAL_MS, NWCConnection.ts:103-108): nil for a daily-renewing budget (the hold straddles the day boundary anyway), one budget per day for weekly, monthly, yearly and never-renewing budgets.

The comment on UNRESOLVED_PAY_INVOICE_MAX_AGE_MS ('LndHub, paginated history') and the store test 'abandons a stale hold' show the release is deliberate, while the sibling test 'debits a stale hold when the node lists settlement instead of abandoning' shows settled payments are meant to be debited; the gap is a payment that is unlisted at release time and settles afterwards. Dependency assumptions: LND ListPayments pagination as documented in the vendored proto and LND registering failed attempts as payment records; LndHub /gettxs omitting matchable identifiers for in-transit payments; a hodl payee holding an HTLC up to the payer-granted CLTV.

## Evidence
1. [stores/NostrWalletConnectStore.ts:3063–3104](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L3063-L3104)
   reconcilePendingPayInvoiceActivities looks each unresolved hold up in the node's payment list; when the payment is absent it calls abandonStaleUnresolvedPayInvoiceHold. Absence from the list is treated as evidence the payment is lost, but it is also what in-flight payments look like on several backends.
2. [stores/NostrWalletConnectStore.ts:3107–3125](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L3107-L3125)
   Abandonment sets status 'failed' with error 'error.paymentFailed'. isUnresolvedPayInvoiceActivity (NWCConnection.ts:276-291) treats a failed row as unresolved only when its error is a timed-out message, so the abandoned row leaves reconcile and prune protection permanently; pendingSpendSats drops it and the budget is freed.
3. [utils/NostrConnectUtils.ts:1039–1073](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NostrConnectUtils.ts#L1039-L1073)
   isPayInvoiceHoldAbandoned releases the hold at 7 days of age or 24 h after the bolt11 expiry. The bolt11 expiry is chosen by the payee (the attacker) and has no relation to how long the HTLC can be held; nothing checks that the node reported the payment failed.
4. [models/NWCConnection.ts:233–240](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/models/NWCConnection.ts#L233-L240)
   pendingSpendSats counts only status 'pending' rows; after abandonment the held amount no longer counts against remainingBudget, so validateBudgetBeforePayment admits a fresh spend of the full budget while the first HTLC is still outstanding.
5. [stores/NostrWalletConnectStore.ts:3188–3213](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L3188-L3213)
   getPaymentsForPendingPayInvoiceRefresh calls paymentsStore.getPayments() with no parameters, so each backend's default listing window decides what 'not listed' means.
6. [lndmobile/index.ts:628–646](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/lndmobile/index.ts#L628-L646)
   Embedded LND listPayments sets reversed only when params.reversed is truthy and max_payments 1000; EmbeddedLND.getPayments (backends/EmbeddedLND.ts:129-133) passes the undefined params straight through. Per proto/lightning.proto:4414-4420 a zero index_offset without reversed starts from the oldest payment, so once the node has more than 1000 payments the newest, including every in-flight NWC payment, are never in the list and every hold is abandoned on schedule.
7. [backends/LndHub.ts:66–68](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LndHub.ts#L66-L68)
   LndHub getPayments is /gettxs. Third-party assumption: BlueWallet LndHub lists in-transit payments only as 'Payment in transition' rows with no payment_hash or pay_req, so Payment.getPaymentRequest/paymentHash never match the hold and the payment is effectively unlisted until it settles; by then the row has left reconcile. An LNbits-style server that lists the hash keeps the row pending and is not affected.
8. [backends/LndHub.ts:161–183](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LndHub.ts#L161-L183)
   LndHub payLightningInvoice races a fixed 60 s client timeout that returns payment_error 'paymentTimedOut'; TransactionsStore.handlePayment (815-890) turns that into payment_error, which resolveLightningPaymentInTransit (NostrConnectUtils.ts:1216-1286) treats as in-transit when the list has no outcome, producing the pending hold that gettxs can never confirm.
9. [backends/LND.ts:389–401](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L389-L401)
   LND REST (and LNC) list the newest 500 payments including incomplete ones; CLNRest.getPayments (CLNRest.ts:386-389) the newest 150 sendpay groups. Failed pay_invoice attempts are listed payments too and are recorded without budget debit (recordFailedPayment), so a client can push its in-flight payment out of the window with cheap unroutable attempts before the abandonment time arrives.
10. [stores/NostrWalletConnectStore.ts:2582–2607](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2582-L2607)
   handleLightningPayInvoice runs reconcile before the budget check so that late settlements are debited first; after abandonment that path finds nothing to debit, and the dedupe only short-circuits while the row is unresolved, so a second spend of the full budget proceeds.

## Impact
Integrity HIGH: the connection budget is the only limit the user placed on this client's delegated spending, and it is fully defeated - the attacker controls the consequence (funds leave the wallet) and the overspend is one full budget per 24 h cycle, repeatable for the life of the connection and bounded only by the wallet balance check at NostrWalletConnectStore.ts:2634-2648, not by the budget; the settled payment is also recorded as failed in the connection activity. No confidentiality or availability impact.

## Reproduction steps
1. Attacker is an external NWC client with a pay_invoice-permitted, budget-limited connection (PR LOW) reached over Nostr relays (AV NETWORK), controlling the payee node so it can issue hodl invoices with chosen bolt11 expiry and CLTV and trigger reconcile with its own requests (UI NONE). Attack requirements PRESENT: the node's payment listing must omit the in-flight payment (inherent on embedded LND with >1000 payments and on BlueWallet-style LndHub; obtained on LND REST/LNC/CLN by evicting it with budget-free failed attempts), the HTLC must be held 24 h past the invoice expiry, and the budget must not renew daily. No defensive mechanism must be defeated once those hold (AC LOW).

## Recommended fix
1. An unresolved pay_invoice hold is released purely on elapsed time and absence from the node's payment list, which cannot distinguish a lost payment from a hodl HTLC still outstanding, and the released row is removed from reconciliation so a later settlement is never debited. Fix criteria: A hold is released only on positive evidence of failure from the node (listed FAILED, or a per-hash lookup such as TrackPaymentV2 / listpays / LndHub checkpayment reporting failure); where a backend offers none, the abandoned row stays debit-eligible so that a payment that later appears settled is debited on reconcile. Verification: on each backend, a hodl payment held past expiry+24 h and then settled ends with the connection's totalSpendSats including it and with no second full-budget spend admitted while it was outstanding.
2. The payment list used for reconciliation is fetched with backend defaults that omit recent payments: embedded LND lists the oldest 1000 (no reversed flag), LndHub lists settled only, and LND/CLN windows are evictable by failed attempts that cost no budget. Fix criteria: Reconciliation queries the specific payment by hash where the backend supports it, and list-based fallbacks request the newest entries (reversed) with a window not evictable by the client; failed pay_invoice attempts are rate limited per connection. Verification: with >1000 payments on an embedded node, or after 500 failed attempts on LND, the service still finds its in-flight payment and keeps the hold.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper authorization
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258393

---

# ZEUS Pay startup calls bypass Tor, sending node pubkey and signature from the device IP

## Details
ZEUS routes HTTP over its embedded Tor client only per call site (utils/TorUtils.ts doTorRequest). The per-node 'Use Tor' switch (WalletConfiguration.tsx:1531 supportsTor — remote LND, CLNRest, LndHub; loaded into SettingsStore.enableTor at SettingsStore.ts:2043) is honoured by the LND/CLNRest/LndHub restReq paths, LndHub create, BTCPay config fetch, sponsors and the Flow LSP info request, and the maintainers describe its purpose as keeping the app's own fetches from leaking the user's IP (SettingsStore.ts:1861-1867; LSPStore.ts:412-434, #4372). The scan's threat model (.oss-scanner/threat_model.md:31) states the invariant outright: 'when Tor is enabled, no request may go out over clearnet'.

stores/LightningAddressStore.ts never reads enableTor. Every ZEUS Pay request — getAuthData (99-126), create/createNWC/update/status/redeem/delete/order (150-782) — goes to https://zeuspay.com through ReactNativeBlobUtil.fetch on the platform network stack, and every authenticated one carries the node's identity_pubkey plus a fresh node-key signature over a server challenge.

The call is automatic. views/Wallet/Wallet.tsx:1365-1383 awaits LightningAddressStore.status() on every wallet connect whenever lightningAddress.enabled is set on a mainnet wallet whose backend supportsLightningAddress() (BackendUtils.ts:284-285: supportsCustomPreimages || supportsCashuWallet; LND.ts:1069 supportsCustomPreimages = true). Remote LND is the one backend that both offers the 'Use Tor' switch and supports a ZEUS Pay address: views/LightningAddress/index.tsx:836 and LightningAddressSettings.tsx:152 offer CreateNWCLightningAddress to it, and createNWC (206-249) sets lightningAddress.enabled = true. When notifications are on, Wallet.tsx:1385-1391 also runs updatePushCredentials (618-636) → update() (311-330), a second direct POST. So a user who runs a remote LND node, has set 'Use Tor' for it, and holds a ZEUS Pay NWC-type address has their device IP delivered to zeuspay.com together with their node pubkey — and a signature proving control of that key — every time the app opens or reconnects. (The socket.io stream at 666-681 is equally un-routed but is only opened for 'cashu' addresses, which a remote-LND wallet cannot hold because LND.supportsCashuWallet() is false.)

This defeats the property the Tor setting exists to provide (device IP not linkable to the node identity) in exactly the way the project treats as a leak for its sibling ZEUS-operated host: LSPStore.initFlowLSP skips the clearnet Flow /info request for Tor-enabled remote LND because it 'would send the device IP to the Flow host on every startup (#4372)'. The verified findings lnd-websocket-subscriptions-bypass-tor (node WebSockets) and flow-lsp-fee-proposal-requests-bypass-tor (Flow host) record the same shape; this is the ZEUS Pay host instance. SECURITY.md lists 'traffic that bypasses Tor when Tor is enabled' as a privacy leak of particular interest.

TLS is default-verified for these calls (no trusty), so credentials are not exposed to a passive observer; the impact is de-anonymisation: zeuspay.com (and any observer of the clearnet path) learns IP <-> node pubkey, and the node-key signature proves the binding rather than merely asserting it. The verified record zeuspay-auth-blind-signs-server-challenge-node-key-oracle (LightningAddressStore.ts:99) is a different defect at the same lines.

Assumption: react-native-blob-util 0.25.1 issues requests via the platform HTTP stack with no proxy unless configured natively; no first-party code under android/app/src/main/java or ios/ installs an OkHttp/NSURLSession proxy.

## Evidence
1. [stores/LightningAddressStore.ts:99–125](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LightningAddressStore.ts#L99-L125)
   getAuthData POSTs the node's identity_pubkey to https://zeuspay.com/api/lnurl/auth with plain ReactNativeBlobUtil.fetch (system network stack), then signs the challenge with the node key. settingsStore.enableTor is never consulted anywhere in this store; there is no doTorRequest branch.
2. [stores/LightningAddressStore.ts:364–381](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LightningAddressStore.ts#L364-L381)
   status() POSTs {pubkey, message, signature} to /api/lnurl/status with plain ReactNativeBlobUtil.fetch (no doTorRequest branch). This is the call Wallet.tsx makes automatically at every wallet connect.
3. [views/Wallet/Wallet.tsx:1365–1382](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L1365-L1382)
   On every connect, when lightningAddress.enabled, mainnet and identity_pubkey are present and BackendUtils.supportsLightningAddress() holds, the wallet awaits LightningAddressStore.status() with no check of enableTor. For 'cashu' addresses it then opens the socket.io stream.
4. [utils/BackendUtils.ts:284–285](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/BackendUtils.ts#L284-L285)
   supportsLightningAddress is supportsCustomPreimages || supportsCashuWallet; LND.supportsCustomPreimages is true, so a remote LND wallet (the only kind with a 'Use Tor' switch besides CLNRest/LndHub) can hold a ZEUS Pay (NWC-type) address and reaches the startup call.
5. [stores/LightningAddressStore.ts:618–635](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LightningAddressStore.ts#L618-L635)
   updatePushCredentials (run from Wallet.tsx:1385-1391 right after status() when lightningAddress.notifications === 1) calls update(), which POSTs {pubkey, message, signature, device_token, device_platform} to /api/lnurl/update (311-330) by the same direct fetch — a second automatic clearnet request per connect for users with push enabled. The socket.io stream (666-681) is likewise un-routed but is not reached in the affected configuration: LND.supportsCashuWallet() is false, so a remote-LND address can never be type 'cashu'.
6. [stores/LSPStore.ts:412–433](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L412-L433)
   The project's own treatment of this exact shape: Flow LSP getLSPInfo is skipped for remote LND over Tor because a clearnet request on startup 'would send the device IP to the Flow host on every startup (#4372)'. The ZEUS Pay startup request to another ZEUS-operated host, carrying the node pubkey, received no such gate.
7. [stores/SettingsStore.ts:1861–1867](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L1861-L1867)
   Maintainers' stated semantics of enableTor: route the app's own fetches (BTCPay config here) over Tor 'so the config fetch does not leak the user's IP' - i.e. enableTor is meant to cover app-level HTTP, not only node RPC.
8. [utils/TorUtils.ts:65–76](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/TorUtils.ts#L65-L76)
   Tor routing is per call site via doTorRequest/RnTor; nothing configures ReactNativeBlobUtil or socket.io to use the SOCKS port, so every call in LightningAddressStore is clearnet.

## Impact
Confidentiality: the user's real IP is bound - by a node-key signature - to their Lightning node identity at a third-party service on every startup, which is the privacy property Tor mode promises and that #4372 protects for the Flow host. No credential disclosure (TLS verified) and no effect on funds, integrity or availability.

## Reproduction steps
1. The observer is zeuspay.com (ZEUS infrastructure) or any passive on-path party between the phone and it - the parties the user chose to hide the device IP from by enabling Tor. No action by them is required: with a ZEUS Pay address enabled on a Tor-enabled remote wallet, every app open/reconnect performs the direct authenticated POSTs. The user does nothing beyond opening the app. AT:P because the leak needs the protected configuration (Tor-enabled remote wallet with a ZEUS Pay address) and the observer must be the service or on-path.

## Recommended fix
1. LightningAddressStore issues all ZEUS Pay HTTP and socket.io traffic through the direct platform stack, ignoring the per-node enableTor setting that the REST backends and sibling ZEUS-host calls honour. Fix criteria: When enableTor is set, every ZEUS Pay request (auth, status, create, update, redeem, delete, order) is issued through doTorRequest and the stream is either Tor-routed or not opened; verified by confirming that with enableTor set no non-Tor connection to zeuspay.com occurs on startup or refresh.
2. Wallet.tsx triggers LightningAddressStore.status() on every connect without the Tor gate that initFlowLSP applies to the equivalent Flow host request. Fix criteria: The automatic startup status call is skipped (or Tor-routed) under the same condition that skips getLSPInfo for Tor-enabled remote wallets, and the UI tells the user the address features are unavailable over Tor rather than leaking silently.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-359](https://cwe.mitre.org/data/definitions/359.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258387

---

# Reverse swap preimage release gated solely on user-configured block explorer, no node cross-check

## Details
In a reverse swap the user pays the provider's hold invoice first; the provider can only settle it once it learns the preimage, which ZEUS discloses when it builds the claim (SwapDetails.tsx:560-563 comment: 'only claim, which reveals the preimage, once it is confirmed'; the native Lndmobile.createReverseClaimTransaction receives endpoint and preimageHex, LncModule.kt:253-257). The project therefore gates the claim on an 'independent observer': SwapStore.verifyReverseLockup (stores/SwapStore.ts:823-947) looks the provider-supplied lockup txid up on the mempool/esplora instance from UrlUtils.getMempoolApiUrl and requires it confirmed (GET /tx/{txid}), paying the swap output script in full (checkLockupOutput over the explorer's vout list), unspent (GET /tx/{txid}/outspend/{vout}), and at least six blocks before the deadline (verifyReverseSwapDeadline, 749-773, GET /blocks/tip/height, any positive integer accepted as the tip). Every one of those facts comes from that single HTTP explorer. Nothing is corroborated against the user's own node (NodeInfoStore.nodeInfo.currentBlockHeight is read for display on the very same screen at SwapDetails.tsx:955-959 and by Refund.tsx:109-114, and BackendUtils.getMyNodeInfo is available on LND/CLN/LDK/embedded) or against any second source, and the explorer's answers carry no authentication beyond TLS to whatever host the setting names.

The explorer is chosen by the user in Privacy settings (settings.privacy.mempoolInstance: electrs.zeusln.com [default, ZEUS-operated], mempool.space, or 'Custom' + customMempoolInstance used verbatim, UrlUtils.ts:23-54). The explainer shown there (locales/en.json:1292-1293) says the instance is used for fee estimates, broadcasting, sweeps and block height while syncing; it does not say the instance decides when swap preimages are released. The project's own threat model (.oss-scanner/threat_model.md:20) lists mempool/esplora explorers among responses to 'treat as attacker-controlled', and FeeUtils.ts:1-12 shows the maintainers already bound what 'an unvalidated API response can hand to a transaction the user does not individually approve' from this same instance for fee rates — but no such bound or corroboration exists for the lockup oracle.

The swap provider alone cannot abuse this (an honest explorer returns 404 for a fabricated txid and the claim waits, per the 'waits on a fabricated lockup' test). The weakness is that the second party whose honesty the design requires is a plain user-settable HTTP endpoint whose independence from the provider is neither enforced, cross-checked, nor communicated. Explicit assumption: the prebuilt Lndmobile v0.21.4-beta-zeus.1 claim builder discloses the preimage to the provider (cooperative claim POST / provider-side broadcast), as the project's own comments state; and react-native-blob-util 0.25.1 verifies TLS for these fetches since no 'trusty' option is passed, so the attacker must answer at the configured host rather than merely sit on the network.

## Evidence
1. [stores/SwapStore.ts:823–946](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L823-L946)
   verifyReverseLockup decides whether the preimage-revealing claim may be built. Every chain fact it relies on — that the provider's lockup txid exists and is confirmed (GET {apiUrl}/tx/{txid}, 834-851), that it pays the swap output (checkLockupOutput over the explorer's vout list, 886-893), that the output is unspent (GET /tx/{txid}/outspend/{vout}, 909-925), the lockup value for the rescued-swap confirmation (937-946) and the refund deadline (verifyReverseSwapDeadline, 930) — comes from the single HTTP explorer at UrlUtils.getMempoolApiUrl. Nothing is corroborated against the user's own node or a second source.
2. [stores/SwapStore.ts:749–772](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L749-L772)
   verifyReverseSwapDeadline fetches /blocks/tip/height from the same explorer and treats any positive integer as the chain tip; a low tip makes any timeoutBlockHeight pass the six-block check, both at creation (689-703) and immediately before the claim (930-934). The comment calls the explorer 'the same independent observer used for the lockup' — its independence from the provider is assumed, never checked.
3. [utils/UrlUtils.ts:23–53](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/UrlUtils.ts#L23-L53)
   getMempoolApiUrl resolves to settings.privacy.customMempoolInstance verbatim (https assumed) when the user selected 'Custom', otherwise to the ZEUS-operated electrs.zeusln.com or mempool.space. A plain HTTPS endpoint with no response authentication; whoever answers at that host is the oracle.
4. [views/Swaps/SwapDetails.tsx:898–928](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L898-L928)
   Once verifyReverseLockup returns 'ok' the native createReverseClaimTransaction is invoked automatically with the preimage, the provider endpoint and the provider's transactionHex; no user confirmation sits between the oracle's answer and the preimage leaving the device.
5. [views/Swaps/SwapDetails.tsx:663–670](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L663-L670)
   The provider's websocket transaction.mempool/transaction.confirmed update supplies the lockup hex and triggers the check; the provider therefore chooses the txid the explorer is asked about.
6. [views/Swaps/SwapDetails.tsx:955–959](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L955-L959)
   The same screen already reads NodeInfoStore.nodeInfo.currentBlockHeight (for display), showing the node's own tip is available to the claim path yet never used to sanity-check the explorer's height before the preimage is released.
7. [views/Settings/Privacy.tsx:377–399](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/Privacy.tsx#L377-L399)
   The only writer of mempoolInstance/customMempoolInstance. The explainer offered here (locales/en.json:1292-1293: fee estimates, broadcasting, sweeps, block height while syncing) never tells the user that the chosen instance also authorises reverse-swap claims, so a user may point it at a provider-run host without knowing it defeats the swap's safety check.

## Impact
The user's Lightning payment for the swap is settled by the provider against no on-chain lockup (or one whose timeout has already passed, in the tip-lie variant); the funds the user approved for the swap go to the attacker with nothing claimable — integrity HIGH under the threat model's amount/destination asset and 'swap lockup verification' delegated authority. No confidentiality impact beyond the preimage, which is the loss itself; no availability impact.

## Reproduction steps
1. Attacker: a Boltz-protocol swap provider (listed or Custom, both user-selectable) that also answers the explorer ZEUS is configured to use — a Custom mempool instance the user pointed at the provider's host, or a compromised default instance. The user creates a reverse swap and pays the hold invoice (UI:A). The provider pushes transaction.mempool with a lockup hex it never broadcast; the colluding explorer returns confirmed, correct script, full amount, unspent and a low tip for that txid; verifyReverseLockup returns 'ok' and SwapDetails auto-invokes the native claim, disclosing the preimage. No ZEUS control must be defeated (AC:L); the non-default explorer configuration or instance compromise is required (AT:P).

## Recommended fix
1. verifyReverseLockup and verifyReverseSwapDeadline accept a single user-configurable HTTP explorer as the only authority on confirmation, output, unspentness and chain height before the preimage is revealed. Fix criteria: Before the claim is built, the chain tip must be corroborated against the user's own node where the backend exposes it (BackendUtils.getMyNodeInfo / NodeInfoStore, as Refund.tsx does) and the explorer's height rejected when it is below the node's; the confirmation and unspent checks must additionally require that the lockup txid is known to a source the provider does not choose (the node's chain view where available, a second independent explorer, or at minimum a fixed well-known instance alongside a Custom one), with any disagreement treated as 'unavailable' so the claim waits. Verify by having the configured explorer vouch for a txid the node/second source has never seen and confirming no native claim is invoked.
2. Selecting a custom mempool instance silently also makes that host the oracle protecting swap funds, which the Privacy settings explainer does not convey. Fix criteria: The mempool instance setting must state that the instance is trusted to authorise swap claims and must be independent of the swap provider, or swap verification must consult a fixed well-known instance in addition to the custom one so that a custom explorer alone cannot approve a claim.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Reliance on untrusted inputs
**CWE:** [CWE-807](https://cwe.mitre.org/data/definitions/807.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258384

---

# Native buildNode recursively deletes unvalidated JS-supplied storage path on VSS failure

## Details
The native LDK Node bridge performs a recursive delete on the wallet storage path it received verbatim from JS, with no containment check. In `buildNode` (android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt:504-517; ios/LdkNodeMobile/LdkNodeModule.swift:513-524), when the dual-store (VSS + local) build fails and `storedVssFailOnError` is set, `java.io.File(storedStorageDirPath).deleteRecursively()` / `FileManager.default.removeItem(atPath:)` runs; the orphaned build thread performs the same delete on the timeout path (kt:461-468, swift:470-479). `storedStorageDirPath` is whatever `setStorageDirPath` received (kt:127-137, swift:142-151): nothing checks that it is a single UUID component under the `ldk-node` base directory, that its canonical path lies inside that base, or that the directory was empty or created by this build.

Attacker-controlled input: the path is `${DocumentDirectoryPath}/ldk-node/${node.ldkNodeDir}` (utils/LdkNodeUtils.ts:95-97) and `ldkNodeDir`, `ldkMnemonic` and `ldkVssServer` are copied from the stored node object on activation (stores/SettingsStore.ts:2056-2073). Every in-app writer uses `uuidv4()` (utils/WalletCreationUtils.ts:77,90), but the wallet-config import (views/Tools/NodeConfigExportImport.tsx:607-656, recorded as node-config-import-lnddir-ldknodedir-path-traversal) stores arbitrary node objects unvalidated. This finding is a second, independent sink for that source, reached by *activating* the planted wallet rather than deleting it: views/Wallet/Wallet.tsx:703-756 calls `startLdkNodeWallet` on activation; it computes `hasLocalDb = exists(`${storagePath}/ldk_node_data.sqlite`)` (false for any traversal path) and passes `failOnVssError: true` (utils/LdkNodeUtils.ts:430-446); `initNode` always supplies a `vssConfig` (storeId derived from the attacker's own mnemonic, LdkNodeUtils.ts:259-283) and `initializeNode` forwards the URL and flag to native (ldknode/LdkNodeInjection.ts:964-1007) before `buildNode`. With `ldkVssServer` pointing at an unreachable or non-VSS endpoint (e.g. `http://127.0.0.1:1/`), `buildWithDualStoreAndFixedHeaders` throws, the catch at kt:495-498 sets `vssError`, and the fail-hard delete runs on the attacker's path; a slow endpoint instead reaches the orphan-thread delete when the FFI call returns after the 180 s timeout.

Reach: `ldkNodeDir: '../../shared_prefs'` (Android) deterministically removes the whole `shared_prefs` directory, i.e. the react-native-keychain blob holding every node config and embedded seed; `'../lnd'` or `'../<uuid>'` removes an embedded LND wallet (channel.db, wallet.db); `'..'` targets the files/Documents directory itself. For the broad `'..'` variant note that `File.listFiles()` builds children as `File(parent, name)`, so every child path keeps the `ldk-node/..` prefix and once the bottom-up walk has removed `files/ldk-node` the remaining siblings no longer resolve: at minimum every LDK wallet under `ldk-node` is destroyed plus whichever siblings readdir ordered before it. Targeted variants whose `..` components resolve through the untouched base directory have no such limit.

Precondition: `<Documents|files>/ldk-node` must exist for `ldk-node/..` to resolve. On iOS `ensureLdkNodeBackupExclusion` (LdkNodeUtils.ts:109-121) mkdirs it at the start of every `startLdkNodeWallet`, so it always holds; on Android it exists on any device that has ever created or restored an LDK wallet (`createLdkNodeDirectory`), and is additionally expected to be created by the builder. Assumptions about the prebuilt binary (fetch-libraries-versions.json pins ZeusLN/ldk-node v0.7.0-zeus-rl-0.2.7): like upstream `Builder::build` it `create_dir_all`s the storage dir (Rust's `Path::parent` treats `..` lexically, so `files/ldk-node` is created first), and a dual-store build against an unreachable VSS URL returns an error (upstream `BuildError::KVStoreSetupFailed`) rather than silently succeeding; the Kotlin code treats any exception or timeout as `vssError` in any case.

Root cause: a destructive native operation keyed on a JS-controlled path with no containment or freshness check. The same sink also fires for a legitimate wallet whenever `ldk_node_data.sqlite` is absent and the VSS server is down, which is the maintainers' intended 'restore starts clean' behaviour and is only safe because that directory is expected to be a fresh leaf.

## Evidence
1. [android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt:504–517](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt#L504-L517)
   Fail-hard branch of buildNode: when vssError is set and storedVssFailOnError is true, java.io.File(storedStorageDirPath).deleteRecursively() runs on the path exactly as JS supplied it. No check that it is a leaf UUID directory under the ldk-node base, no canonicalisation, no check that the directory was empty or created by this build.
2. [android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt:461–468](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt#L461-L468)
   Same sink on the timeout path: the orphaned dual-store thread deletes storageDirPath recursively once the blocking FFI call returns if failHard was captured, so a slow VSS endpoint produces the same deletion as a fast failure.
3. [android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt:127–137](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt#L127-L137)
   setStorageDirPath stores the JS string verbatim into storedStorageDirPath and hands it to the builder; this is the only point at which the path could be validated and it validates nothing.
4. [android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt:424–499](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt#L424-L499)
   Dual-store build against storedVssUrl (JS-supplied via setVssServer). A timeout sets vssError at 486; any exception from buildWithDualStoreAndFixedHeaders is rethrown at 489 and caught at 495-498 as vssError, so an unreachable or non-VSS URL deterministically arms the fail-hard branch.
5. [ios/LdkNodeMobile/LdkNodeModule.swift:513–524](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LdkNodeMobile/LdkNodeModule.swift#L513-L524)
   iOS sibling of the fail-hard branch: FileManager.default.removeItem(atPath: self.storedStorageDirPath) with the same absence of containment or freshness checks.
6. [ios/LdkNodeMobile/LdkNodeModule.swift:470–479](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LdkNodeMobile/LdkNodeModule.swift#L470-L479)
   iOS timeout path: the orphaned work item removes storageDirPath when failHard was captured.
7. [ios/LdkNodeMobile/LdkNodeModule.swift:141–151](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LdkNodeMobile/LdkNodeModule.swift#L141-L151)
   iOS setStorageDirPath stores the JS path verbatim; no validation.
8. [utils/LdkNodeUtils.ts:424–446](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LdkNodeUtils.ts#L424-L446)
   startLdkNodeWallet (run on every activation of an ldk-node wallet) computes hasLocalDb = exists(`${storagePath}/ldk_node_data.sqlite`) and passes failOnVssError: !hasLocalDb. For a traversal directory this file does not exist, so fail-hard deletion is armed by activation alone.
9. [utils/LdkNodeUtils.ts:259–283](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LdkNodeUtils.ts#L259-L283)
   initNode always builds a vssConfig: url = vssServerUrl || DEFAULT_VSS_SERVER and storeId derived from the supplied mnemonic, so the dual-store (VSS) branch in native buildNode is always taken and the attacker's ldkVssServer decides whether it fails.
10. [utils/LdkNodeUtils.ts:95–97](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LdkNodeUtils.ts#L95-L97)
   getLdkNodeStoragePath concatenates `${DocumentDirectoryPath}/ldk-node/${nodeDir}` with nodeDir = node.ldkNodeDir; '..' resolves to the files/Documents directory, '../..' to the app data root, '../../shared_prefs' to the keychain-backed settings store on Android.
11. [utils/LdkNodeUtils.ts:109–121](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LdkNodeUtils.ts#L109-L121)
   ensureLdkNodeBackupExclusion runs at the top of startLdkNodeWallet and on iOS mkdirs the ldk-node base directory unconditionally, so the intermediate component needed for `ldk-node/..` to resolve always exists there.
12. [views/Wallet/Wallet.tsx:703–756](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L703-L756)
   On activation of a wallet with implementation 'ldk-node', Wallet.tsx calls startLdkNodeWallet with nodeDir: ldkNodeDir, seedMnemonic: ldkMnemonic and vssServerUrl: ldkVssServer || DEFAULT_VSS_SERVER straight from SettingsStore; only truthiness of ldkMnemonic and ldkNodeDir is checked.
13. [stores/SettingsStore.ts:2056–2073](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L2056-L2073)
   setActive copies ldkNodeDir, ldkMnemonic, ldkPassphrase and ldkVssServer verbatim from the stored node object, so all are attacker-chosen when the node object came from an import.
14. [ldknode/LdkNodeInjection.ts:964–1007](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ldknode/LdkNodeInjection.ts#L964-L1007)
   initializeNode forwards vssConfig.url via setVssServer and failOnVssError via setVssFailOnError to the native module before buildNode; the 180 s timeout for fail-hard builds is set here too.
15. [views/Tools/NodeConfigExportImport.tsx:607–655](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/NodeConfigExportImport.tsx#L607-L655)
   Source of the attacker-authored node object: handleImportFile JSON.parses a user-picked file and accepts data.nodes with only an Array.isArray check; no field (implementation, ldkNodeDir, ldkVssServer, ldkMnemonic) is validated before executeImport -> saveNodeConfigs stores them (recorded as node-config-import-lnddir-ldknodedir-path-traversal).

## Impact
Recursive deletion of attacker-chosen directories inside the app sandbox: '../../shared_prefs' removes the keychain-backed settings blob holding every node config and embedded seed (Android); '../lnd' or '../<uuid>' removes an embedded LND wallet's channel.db/wallet.db; '..' removes every LDK wallet under ldk-node plus a readdir-order-dependent set of sibling wallet and Cashu databases. Channel state is unrecoverable without an external backup, so this is irreversible loss of funds and total loss of availability of the app's data. No confidentiality impact from the delete sink itself.

## Reproduction steps
1. Attacker authors a .zeus-wallet-config-backup (plaintext `encrypted:false` envelope, or an encrypted v2 envelope plus its password) containing an `implementation:'ldk-node'` node with a traversal ldkNodeDir ('..', '../lnd', '../../shared_prefs'), any valid BIP39 ldkMnemonic and an ldkVssServer pointing at an unreachable URL, and gets it onto the device by any file share. The victim imports it (Tools -> Import; the selection modal shows only nickname and implementation) and later taps the planted wallet in the wallet list; activation alone runs startLdkNodeWallet -> initNode -> native buildNode -> fail-hard recursive delete. No crypto, lock-screen or permission bypass is needed; two deliberate victim steps (import, select) so UI ACTIVE; attacker-supplied file opened locally so AV LOCAL. The ldk-node base-directory precondition is created unconditionally on iOS on every start and on Android exists on any device that ever had an LDK wallet (and is expected to be created by the builder itself), so AT NONE.

## Recommended fix
1. LdkNodeModule.buildNode (Kotlin and Swift) performs a recursive delete of storedStorageDirPath, a string taken verbatim from JS, without confirming it is a strict child of the ldk-node base directory, a single path component, or a directory this build created. Fix criteria: The native delete must only ever remove a directory whose canonical path is a direct child of the app-private ldk-node base directory and whose name matches the UUID pattern; any other value must be rejected at setStorageDirPath and never reach deleteRecursively/removeItem. Prefer deleting only the artefacts the failed build itself created (or require the directory to have been empty before the build) rather than the whole directory. Verify by driving buildNode with storage paths '..', '../..', '../../shared_prefs', 'a/b' and an absolute path outside the base and confirming nothing outside the base is touched.
2. The JS layer arms fail-hard deletion (failOnVssError) purely on the absence of ldk_node_data.sqlite and passes a stored, attacker-influenceable VSS URL, so an imported configuration can both choose the path and force the failure. Fix criteria: Node configs must be validated on import (see node-config-import-lnddir-ldknodedir-path-traversal) so ldkNodeDir is a single UUID component and ldkVssServer a well-formed https URL; and startLdkNodeWallet/initializeNode must only enable fail-hard mode when the storage directory was freshly created by this flow. Verify that activating an imported ldk-node config with a non-UUID ldkNodeDir is refused before any native call.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Path Traversal
**CWE:** [CWE-22](https://cwe.mitre.org/data/definitions/22.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258364

---

# Seed words and xprv QR captured in OS app-switcher snapshots (iOS; Android 9-12) — app lock bypassed

## Details
The seed screens render key material directly into the app window: views/Settings/Seed.tsx shows each aezeed/BIP39 word in plaintext once tapped (MnemonicWord, 88-134), and views/Settings/SeedQRExport.tsx shows the derived BIP32 root xprv as an expanded QR and base58 string (272-283). Nothing in either platform layer stops the OS from capturing that window when the app leaves the foreground:

- Android: MainActivity.kt:38-40 calls setRecentsScreenshotEnabled(false) 'to avoid data leak via recents', but only when SDK_INT >= 33. The app ships with minSdkVersion 28 (android/build.gradle:4) and FLAG_SECURE is set nowhere in the first-party tree, so on Android 9-12 the Recents thumbnail is the last rendered frame.
- iOS: ios/zeus/AppDelegate.mm:90-92 only logs on applicationDidEnterBackground; there is no willResignActive handler, cover view or snapshot suppression, so the app-switcher card is the live frame.

SeedQRExport.tsx has no AppState handler at all, so its leak is deterministic on iOS and on Android below 13. Seed.tsx tries to compensate in JS by re-hiding words on the AppState 'background' event (169-177); that is the latest lifecycle signal, is delivered to JS asynchronously, and the hide is a React re-render committed back on the UI thread while the OS captures the snapshot during the same transition. Explicit assumption: react-native 0.87.1 emits AppState changes to JS asynchronously from UIApplicationDidEnterBackgroundNotification / onHostPause, and neither OS waits for subsequent app UI updates before capturing the task snapshot; Apple's own guidance is to hide sensitive content synchronously inside applicationDidEnterBackground, which no first-party code does.

Attack: the owner reveals words (or opens the xprv QR) and presses Home or switches apps. Anyone who later holds the device with the phone unlocked (handed over, or seized while unlocked) opens the OS app switcher and reads the seed or xprv from the ZEUS card without passing the ZEUS PIN/passphrase/biometric gate that reAuthNavigation (utils/NavigationUtils.ts:28-40) requires before the Seed screen opens. The project's own threat model (.oss-scanner/threat_model.md:59) rates 'bypass of the PIN, passphrase or duress wipe by someone holding the unlocked or locked device' as High, and the maintainers' Android-13-only Recents suppression and the Seed.tsx re-hide show this surface is one the project intends to defend.

Filed from open lead lead-seed-flow-7a0f, with the correction that Android 13+ Recents is already covered by setRecentsScreenshotEnabled(false).

## Evidence
1. [android/app/src/main/java/com/zeus/MainActivity.kt:38–40](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/MainActivity.kt#L38-L40)
   The only Android capture mitigation: setRecentsScreenshotEnabled(false) 'to avoid data leak via recents', guarded by SDK_INT >= TIRAMISU (API 33). minSdkVersion is 28 (android/build.gradle:4) and no FLAG_SECURE is set anywhere in the first-party tree (rg over android/app, patches/, zeus_modules finds none), so on Android 9-12 the task snapshot shown in Recents is the last rendered frame of whatever screen was open.
2. [ios/zeus/AppDelegate.mm:90–92](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/zeus/AppDelegate.mm#L90-L92)
   applicationDidEnterBackground only NSLogs; there is no applicationWillResignActive/scene handler, no cover view and no ignoreSnapshotOnNextApplicationLaunch anywhere in ios/zeus or the Podfile, so the app-switcher card is the live last frame of the seed or xprv screen.
3. [views/Settings/SeedQRExport.tsx:272–283](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/SeedQRExport.tsx#L272-L283)
   Both derived BIP32 root xprvs (np2wkh/p2wkh) are rendered through CollapsedQR with expanded (QR plus base58 text). The file imports no AppState and installs no listener (rg 'AppState|addEventListener' finds nothing), so the capture of this screen is deterministic on iOS and Android below 13.
4. [views/Settings/Seed.tsx:169–177](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/Seed.tsx#L169-L177)
   The Seed screen's only re-hide is this JS AppState 'background' handler bumping revealResetKey. The 'background' event is the latest signal both platforms emit (UIApplicationDidEnterBackgroundNotification / onHostPause) and is delivered to the JS thread asynchronously; the re-render must then be committed back on the UI thread, while the OS captures the task snapshot during that same transition. Hiding is therefore a race the app does not control, whereas platform APIs (FLAG_SECURE, a synchronous cover view) are not used.
5. [views/Settings/Seed.tsx:88–134](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/Seed.tsx#L88-L134)
   MnemonicWord renders the plaintext word once tapped; a user transcribing a backup reveals several or all words, and that frame is what the snapshot holds.
6. [utils/NavigationUtils.ts:28–40](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NavigationUtils.ts#L28-L40)
   reAuthNavigation forces PIN/passphrase/biometric re-auth before the Seed screen opens. This is the shipped control the OS-held snapshot sidesteps: the live screen is gated, the image of it is not.

## Impact
The captured frame contains the wallet seed words or the BIP32 root xprv — full disclosure of the key that controls all on-chain and channel funds (confidentiality high) and, by importing it elsewhere, the ability to spend them (integrity high). App availability is unaffected.

## Reproduction steps
1. Attacker physically holds the device (AV:P) after the owner backgrounded ZEUS from the Seed screen with words revealed or from the xprv QR screen; the phone must be unlocked or handed over, but the ZEUS app lock is not passed. Opening the app switcher is trivial (AC:L); no ZEUS credential is needed (PR:N). The exploit depends on platform (iOS, or Android 9-12) and on the snapshot having been captured — AT:P — and requires the owner's ordinary prior interaction of viewing the seed then leaving the app, which is involuntary with respect to the attack (UI:P).

## Recommended fix
Secret-bearing screens are rendered in a window the OS is allowed to snapshot; the only Android mitigation requires API 33, iOS has none, and the JS-side re-hide (absent entirely on SeedQRExport) runs asynchronously after the lifecycle signal the OS snapshots on. Fix criteria: While a seed, xprv or other key-bearing screen is mounted, the window is excluded from OS capture on every supported platform version: on Android below 33, FLAG_SECURE (or an equivalent secure-flag toggle exposed to JS) in addition to the existing Recents suppression; on iOS, a cover view installed synchronously in applicationWillResignActive / applicationDidEnterBackground (or equivalent) so the snapshot never contains app content. SeedQRExport, like Seed, must also not keep key material rendered across a backgrounding. Verified by backgrounding from both screens on an Android 12 device and on iOS and confirming the ZEUS app-switcher card shows no seed or xprv.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-200](https://cwe.mitre.org/data/definitions/200.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258363

---

# VSS timeout fallback builds second Node on same storage dir while orphaned build still runs

## Details
`buildNode` runs the dual-store (VSS + local) build on a detached thread and waits at most `storedVssBuildTimeoutSeconds` (30 s for any wallet that already has `ldk_node_data.sqlite`, LdkNodeInjection.ts:1003). When the wait times out and fail-hard is not set, the module records `vssError`, leaves the orphaned thread running, and in the same call immediately constructs a *second* Node with `localBuilder.build(nodeEntropy)` over the identical `storageDirPath` (LdkNodeModule.kt:483-531; LdkNodeModule.swift:493-537). JS then `start()`s that local node (LdkNodeUtils.ts:456-467). The orphaned FFI build keeps executing against the same SQLite store until the VSS server finally answers or errors; only then does the thread call `stop()` on its Node (a no-op for a never-started node) and drop it.

The code's own invariant that two builds must never operate on one storage directory (kt:21-24, 379-395; swift:9-12, 387-398) is enforced only across successive `buildNode` calls, not for this in-call fallback. The result is two independent ldk-node `Node` instances, each holding its own in-memory ChannelManager/ChainMonitor and its own KVStore handle on `ldk_node_data.sqlite`: one live and mutating channel state, one still mid-construction.

Impact depends on what the prebuilt library writes during construction. Assumption, stated explicitly: ZeusLN/ldk-node v0.7.0-zeus-rl-0.2.7 (fetch-libraries pin) behaves like upstream ldk-node/rust-lightning `Builder::build`, which reads all ChannelMonitors first and later hands each to `ChainMonitor::watch_channel`, whose `Persister::persist_new_channel` *writes* the monitor back to the KVStore; with a synchronous dual store each such write blocks on the VSS half. Under that assumption, a stall of >30 s during the monitor-persist phase means: the orphan read monitors at T0; the live node starts and advances channel state, persisting newer monitors at T2; when VSS unblocks, the orphan writes its T0 copies over them. On the next app launch the ChannelManager (persisted by the live node) is ahead of the monitor on disk, which rust-lightning rejects as a 'potentially-critical violation of the chain::Watch API' (BuildError::InvalidChannelMonitor): the wallet no longer starts and channel funds are stranded until manual recovery; if a stale monitor is instead accepted and used, the node may later broadcast or react on revoked state. Even if the fork's dual store only reads during build, two Nodes sharing one SQLite file concurrently is outside anything ldk-node guarantees (SQLITE_BUSY failures in the live node's persistence, event-queue double-reads).

Attacker: the VSS server or anyone able to stall the TLS connection to it (MitM, hostile network) for ~30-180 s at the moment the user opens the wallet; VSS is contacted on every start of every LDK wallet and the server is an in-scope adversary. No user action beyond opening the app.

## Evidence
1. [android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt:473–531](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt#L473-L531)
   latch.await times out after storedVssBuildTimeoutSeconds (completed=false, line 473-487); the caller claims the result, leaves dualThread blocked in buildWithDualStoreAndFixedHeaders on config.storageDirPath, and — because storedVssFailOnError is false for any wallet with a local DB — falls through to lines 519-531 and synchronously builds a second Node via localBuilder.build(nodeEntropy) over the identical storageDirPath while the orphaned FFI build still holds the same ldk_node_data.sqlite.
2. [android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt:379–395](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt#L379-L395)
   The module's one-build-per-directory control: a *subsequent* buildNode call joins pendingDualBuildThread for up to 10 s and rejects with build_in_progress if it is still alive. The in-call fallback at 519-531 runs without this check, so the shipped control is bypassed on the very path it was written for.
3. [android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt:455–468](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt#L455-L468)
   Orphan cleanup runs only after the FFI returns: it calls stop() on a Node that was never started (NotRunning, effectively a no-op) and deletes the directory only on the fail-hard path. Nothing cancels or fences the Rust build's reads and writes to the shared store between the timeout and the FFI return.
4. [ios/LdkNodeMobile/LdkNodeModule.swift:484–537](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LdkNodeMobile/LdkNodeModule.swift#L484-L537)
   iOS sibling: semaphore.wait times out, vssBuildPending is set and doneSemaphore is stored only for *future* calls (line 495), then the same call proceeds to localBuilder.build on the same storage dir (527-537) while the DispatchWorkItem is still executing the dual-store FFI build.
5. [ldknode/LdkNodeInjection.ts:1001–1007](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ldknode/LdkNodeInjection.ts#L1001-L1007)
   For every existing wallet (hasLocalDb true, failOnVssError false — LdkNodeUtils.ts:445 passes !hasLocalDb) the VSS build timeout is 30 s and fail-hard is off, so the timeout-then-local-fallback is the normal path whenever VSS stalls more than 30 s at app start.
6. [utils/LdkNodeUtils.ts:456–467](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LdkNodeUtils.ts#L456-L467)
   startLdkNodeWallet (called from views/Wallet/Wallet.tsx on every launch/wallet switch) then start()s whichever Node the module exposes — the local-only one — which begins chain sync, peer connections and channel-state persistence against the store the orphaned build is still operating on.
7. [android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt:21–24](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt#L21-L24)
   The module's own stated invariant: 'A new build must not touch the same storage dir until it finishes and cleans up after itself.' The fallback violates it inside a single call.

## Impact
Verified in the checkout: two independent ldk-node Node instances are constructed over one storageDirPath, one live and persisting channel state, one mid-construction, with no synchronisation — the module's own comments (kt:21-24, 379-383) say this must never happen. Dependency assumption, stated explicitly and not verifiable here (prebuilt ZeusLN/ldk-node v0.7.0-zeus-rl-0.2.7, fetch-libraries-versions.json): upstream ldk-node Builder::build reads all ChannelMonitors and then hands each to ChainMonitor::watch_channel, whose Persist::persist_new_channel writes the full monitor back to the KVStore; the fork's dual store writes through to the local SQLite store as well as VSS (implied by ZEUS's own comments that reads are local-first with VSS fall-through). Under that assumption the orphan, once VSS unblocks, writes stale (T0) monitors over the live node's newer ones; on the next launch rust-lightning rejects a ChannelManager that is ahead of its monitor (node will not start, all channel funds stranded pending manual recovery), or if a stale monitor is accepted the node may act on revoked state. If the fork's dual store performs no local writes during build, the floor is concurrent SQLite access from two connections causing persistence failures (UnrecoverableError panic) in the live node. No confidentiality impact.

## Reproduction steps
1. Attacker is the VSS server operator or an on-path network position that delays (not drops) packets to the VSS host so the HTTPS request neither completes nor errors for >30 s while the victim opens an existing LDK wallet (VSS is contacted on every start of every LDK wallet; LDK_VSS_SERVER_KEYS offers only ZEUS or Custom, no off switch). TLS need not be broken: the attack is pure timing. No privileges on the device; the victim merely launches the app (UI PASSIVE). The damaging outcome additionally requires the live node to advance channel state (e.g. the LSP delivering pending HTLCs on reconnect, or any payment — which the attacker can itself trigger by paying the victim) before the attacker releases the stall, so AT PRESENT.

## Recommended fix
buildNode proceeds to construct and expose a local-only Node on a storage directory that a still-running dual-store build has open, violating the one-build-per-directory invariant the module enforces elsewhere. Fix criteria: A timed-out dual-store build must be fully finished (FFI returned, Node stopped and dropped) before any other Node is built on the same storage directory: either wait for the orphaned build to complete before falling back, or make the VSS stage cancellable so the FFI call returns promptly on timeout, or reject the call (as build_in_progress) and let JS retry. Verify by stalling the VSS endpoint beyond the timeout with a wallet that has channels and confirming that exactly one Node ever holds the store and the on-disk ChannelMonitors are never older than the ChannelManager after restart.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Race Condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258361

---

# POS Quick Pay with no fiat rate generates zero-amount invoice marked paid by any payment

## Details
In standalone POS mode, fiat-priced products (and the keypad's custom item in fiat units) are converted to sats by PosStore.recalculateCurrentOrder using the current FiatStore rate. FiatStore.fiatRates is undefined until the asynchronous fetch from Yadio or pay.zeusln.app resolves (Wallet.tsx triggers it on connect) and stays undefined offline or after a fetch error; a rate row can also be absent for the selected currency. In that state calcSatsAmountFromFiat returns 0, so the current order has total_money.sats = 0 while total_money.amount (fiat cents) > 0. StandalonePosPane only disables Charge/Quick Pay when both amount and sats are 0, and its loading flag ignores FiatStore.loading, so Quick Pay stays enabled; POS/Layout.tsx only shows a 'fetching rates' text.

PosStore.processCheckout(isQuickPay=true) then computes rate = 0, subTotalSats = '0', totalSats = '0' and navigates to Receive (or ReceiveEcash when Cashu is enabled - that leg is not traced here) with amount '0', autoGenerate: true and orderTotal '0', with no positivity check. Receive.autoGenerateInvoice calls createUnifiedInvoice with value '0'; InvoicesStore.createInvoice passes it through (the LSP wrapping branch is just skipped for '0'), LND.createInvoice sends value_msat 0 and CLNRest maps 0 to amount_msat 'any', so the node issues a pay-any-amount invoice. CollapsedQR hides the amount block when satAmount is 0, so the customer-facing QR shows no amount. LND.watchInvoicePaid (and the CLNRest/EmbeddedLND/LdkNode equivalents) settle on any non-zero paid amount - Invoice.getAmount returns amt_paid_sat for a settled invoice - so a customer who pays 1 sat has the order recorded as paid via PosStore.recordPayment, the stored invoice cleared, and the POS success screen shows only 'Paid' (the received amount is displayed only outside POS mode).

Assumption: LND's REST AddInvoice with value/value_msat 0 creates a zero-value invoice that settles for any amount (documented LND behaviour, also what CLNRest.ts:374 relies on). The defect is that processCheckout and the Receive autoGenerate path never require a positive rate / positive order total, and the POS paid handler never compares the settled amount with the order total. The threat model names fiat-rate services as untrusted and payment-state truthfulness as an asset, and rates 'a payment reported as successful when it failed, in a way that leads to loss' as High. Distinct from the Order-screen path (views/Order.tsx), which needs a tax rate and yields 'Infinity'; this Quick Pay path needs only a missing rate.

## Evidence
1. [stores/PosStore.ts:142–192](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/PosStore.ts#L142-L192)
   processCheckout(isQuickPay=true): rate = fiatEntry.rate or 0 when no rate row is loaded; subTotalSats falls to '0' because total_money.sats is 0 and rate is not > 0; totalSats = '0'; it then navigates to Receive/ReceiveEcash with amount '0' (or '0.00' / '0.00000000' in fiat/BTC units), autoGenerate: true and orderTotal '0'. No check that rate > 0 or that totalSats is a positive integer.
2. [stores/PosStore.ts:292–352](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/PosStore.ts#L292-L352)
   calcSatsAmountFromFiat returns 0 whenever rate is falsy, so recalculateCurrentOrder sets total_money.sats = 0 for fiat-priced line items while total_money.amount (cents) stays non-zero.
3. [views/Wallet/StandalonePosPane.tsx:370–380](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/StandalonePosPane.tsx#L370-L380)
   disableButtons is false whenever total_money.amount !== 0 (sats may be 0); loading excludes FiatStore.loading. Charge and Quick Pay (lines 544-575) therefore stay enabled while no rate is loaded.
4. [views/Wallet/StandalonePosKeypadPane.tsx:148–195](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/StandalonePosKeypadPane.tsx#L148-L195)
   In fiat units the keypad builds a custom item with base_price_money.amount = fiat value and sats 0, calls recalculateCurrentOrder and then processCheckout(navigation, true) - the same path, with no rate check.
5. [views/Receive.tsx:449–489](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L449-L489)
   amount '0' skips the satAmount setState (state.satAmount stays ''), but autoGenerate still calls autoGenerateInvoice(getSatAmount(amount).toString()) which is '0' for every display unit when the rate is 0.
6. [views/Receive.tsx:655–675](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L655-L675)
   createUnifiedInvoice is called with value: amount || '0'; nothing in Receive or InvoicesStore.createInvoice rejects a zero value (the LSP wrapping branch is merely skipped for value === '0').
7. [backends/LND.ts:376–387](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L376-L387)
   value_msat: data.value_msat || Number('0') * 1000 = 0, so the REST AddInvoice request carries no amount and LND issues a zero-amount (pay-any-amount) invoice.
8. [backends/CLNRest.ts:370–377](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/CLNRest.ts#L370-L377)
   The CLN backend maps value 0 explicitly to amount_msat: 'any', confirming that a '0' value from Receive becomes an any-amount invoice across backends.
9. [backends/LND.ts:783–808](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L783-L808)
   watchInvoicePaid fires onPaid as soon as invoice.isPaid && amountPaid !== 0. The comment justifies the missing amount check with 'LND does not settle a fixed-amount invoice for less' - an assumption that does not hold for the zero-amount invoice this path creates.
10. [models/Invoice.ts:254–259](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/models/Invoice.ts#L254-L259)
   For a settled LND invoice getAmount returns amt_paid_sat, so a 1-sat payment to the zero-amount invoice yields amountPaid = 1 and satisfies the watcher.
11. [views/Receive.tsx:821–856](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L821-L856)
   handlePaymentReceived records the POS order as paid via PosStore.recordPayment with orderTotal '0' and clears the stored invoice, without comparing the settled amount to the order total.
12. [components/CollapsedQR.tsx:383–385](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/CollapsedQR.tsx#L383-L385)
   The amount block under the QR is rendered only when satAmount != 0; with satAmount '' the customer-facing QR shows no amount at all, so staff have no cue that the invoice is amountless.
13. [views/Receive.tsx:1526–1534](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L1526-L1534)
   In POS mode (posStatus === 'active') the success screen shows only the 'Paid' string; the received amount (watchedInvoicePaidAmt) is shown only outside POS mode, so the 1-sat shortfall is invisible to staff.
14. [views/POS/Layout.tsx:106–140](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/POS/Layout.tsx#L106-L140)
   When the rate is unavailable the layout renders only a blinking 'fetching rates' or a fiat-fetch-error text; checkout is not disabled.

## Impact
An order of arbitrary fiat value is recorded (pos-<orderId> with orderTotal '0') and displayed as paid after a 1-sat payment; the merchant releases goods without receiving the amount and the order history misstates revenue. Integrity of payment/receipt state - a named asset - is fully compromised for the affected order; no confidentiality or availability impact.

## Reproduction steps
1. Precondition: no fiat rate loaded for the selected currency - true at every app start until the rate fetch resolves, whenever the device is offline or the rate service fails, or when the (untrusted) rate service returns no row for the currency. Staff add a fiat-priced product (or type a fiat amount on the keypad) and tap Quick Pay, a routine action; Receive immediately shows an amountless invoice QR with no amount displayed. The customer pays 1 sat over Lightning; the watcher marks the order paid and the POS screen shows 'Paid' with no amount. No privileges or defences to defeat. The rate condition is outside a customer's control (AT:P) unless the attacker operates or intercepts the rate feed; a merchant at a venue with poor connectivity is routinely in this state.

## Recommended fix
1. processCheckout and the POS panes allow checkout of a fiat-priced order whose sats total is 0 because the rate is missing. Fix criteria: Checkout (Charge and Quick Pay, pane and keypad) must be blocked, with a visible error, unless a finite positive fiat rate is loaded and the computed totalSats is a positive integer. Verify by starting the app offline with a fiat-priced product: Quick Pay must not produce an invoice.
2. The POS invoice path creates zero-amount invoices and marks the order paid on any settled amount. Fix criteria: Invoice creation for POS orders must reject a zero/non-finite amount, and the paid handler must only record the order as paid when the settled amount is at least orderTotal, displaying the received amount on the POS paid screen. Verify by paying 1 sat to a POS invoice for a larger order: the order must remain open.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper Input Validation
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258228

---

# POS-mode wallet header nickname and ZEUS Pay taps bypass protectedNavigation

## Details
ZEUS POS mode is designed to run without authentication: Wallet.getSettingsAndNavigate activates POS at cold start with no Lockscreen (views/Wallet/Wallet.tsx:477-492) and the Lockscreen's POS waiver (views/Lockscreen.tsx:193-210) sets loggedIn=true without a PIN. The only thing separating POS staff from the owner's wallet is that every exit from POS must go through protectedNavigation (utils/NavigationUtils.ts:5-23), which pushes a Lockscreen with pendingNavigation whenever posStatus==='active' and a PIN/passphrase is configured. WalletHeader honours this for NodeButton (445), MenuBadge (178-190) and TempleButton (161-176).

Two header taps do not. (1) When settings.display.displayNickname is on, the centerComponent renders the wallet nickname as a Text whose onPress is a bare navigation.navigate('Wallets') (components/WalletHeader.tsx:678-690) - the very destination NodeButton protects. (2) When ZEUS Pay has unredeemed payments (LightningAddressStore.paid non-empty; fetchDataCore calls LightningAddressStore.status() in POS mode too, Wallet.tsx:1388-1400), the leftComponent renders a ZeusPay badge whose onPress is navigation.navigate('LightningAddress', {skipStatus:true}) (640-662). Neither checks posStatus, neither uses protectedNavigation, and neither branch is suppressed while POS is active.

WalletHeader is on screen in POS mode via StandalonePosKeypadPane (views/Wallet/StandalonePosKeypadPane.tsx:203, the POS Keypad tab shown when pos.showKeypad is set) and via Wallet's connecting overlay (Wallet.tsx:1955-1957) during every connect with posStatus active (the overlay passes `connecting`, but the nickname Text is not gated on it, so Square POS terminals have the tap during startup and every reconnect).

From Wallets (views/Settings/Wallets.tsx) the holder can open any wallet's WalletConfiguration (538-547), where the eye toggle (WalletConfiguration.tsx:2166 and siblings) reveals macaroonHex / rune / LNC pairing phrase / LNDHub password with no re-auth, delete the wallet config (deleteNodeConfig, 860, Alert-confirmed only), add a wallet pointing at an attacker node (219-226) or switch the active wallet. From LightningAddress the holder reaches LightningAddressSettings -> confirmDelete -> deleteAddress (LightningAddressSettings.tsx:39-56) and the complete payment Activity via that screen's pan responder (LightningAddress/index.tsx:85).

Root cause: WalletHeader relies on each tap individually opting into protectedNavigation, and two destinations were wired with the raw navigate. The ActivityButton shown in the POS-mode rightComponent (143-158) is also a raw navigate to the unfiltered Activity list; that one appears deliberate (it is placed specifically for POS mode) and is noted rather than counted here.

## Evidence
1. [components/WalletHeader.tsx:678–690](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/WalletHeader.tsx#L678-L690)
   centerComponent: when settings.display.displayNickname is set, the wallet nickname is a Text whose onPress is a bare navigation.navigate('Wallets') (line 688). It is rendered regardless of posStatus and regardless of the connecting prop, and does not use protectedNavigation.
2. [components/WalletHeader.tsx:644–662](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/WalletHeader.tsx#L644-L662)
   leftComponent: when LightningAddressStore.paid is non-empty (and not connecting) the ZeusPay badge is rendered with onPress navigation.navigate('LightningAddress', { skipStatus: true }) (651), again with no posStatus check and no protectedNavigation.
3. [components/WalletHeader.tsx:442–448](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/WalletHeader.tsx#L442-L448)
   NodeButton reaches the same 'Wallets' destination through protectedNavigation(navigation, 'Wallets', ...), showing the maintainers consider Wallets a POS exit that must pass the Lockscreen. MenuBadge (178-190) and TempleButton (161-176) do the same for Menu and Wallet.
4. [utils/NavigationUtils.ts:5–22](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NavigationUtils.ts#L5-L22)
   protectedNavigation is the only POS-exit gate: when posStatus === 'active' and a pin/passphrase is set it routes through the Lockscreen with pendingNavigation; a raw navigate() skips it entirely. No App-level navigation guard exists (App.tsx screenListeners only handle back-press).
5. [views/Lockscreen.tsx:193–210](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Lockscreen.tsx#L193-L210)
   The POS waiver: with POS active and no pendingNavigation/shareIntentData the Lockscreen sets loggedIn=true without any credential, so in POS mode loginRequired() is false and nothing but protectedNavigation stands between the terminal holder and the wallet. With pendingNavigation set (the protectedNavigation path) the waiver is skipped and a PIN is demanded.
6. [views/Wallet/Wallet.tsx:477–492](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L477-L492)
   POS boots unauthenticated: posStatus starts 'unselected' (SettingsStore.ts:1737) so at cold start this branch activates POS and runs fetchData with no Lockscreen even when a PIN is configured.
7. [views/Settings/PointOfSale.tsx:179–184](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/PointOfSale.tsx#L179-L184)
   The POS settings screen shows 'Warning: no password or PIN set' (locales/en.json pos.views.Settings.PointOfSale.authWarning) when neither is configured: the project designs the PIN/passphrase as the gate that keeps POS terminal holders out of the owner's wallet.
8. [views/Wallet/StandalonePosKeypadPane.tsx:203](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/StandalonePosKeypadPane.tsx#L203)
   WalletHeader is rendered in POS mode by the POS Keypad tab (Standalone POS with pos.showKeypad, which defaults to true at SettingsStore.ts:1597; tab wiring Wallet.tsx:1890-1897), so the nickname/ZeusPay taps are on screen for POS staff.
9. [views/Wallet/Wallet.tsx:1949–1959](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L1949-L1959)
   WalletHeader is also rendered in the connecting overlay (absolute, zIndex 1) whenever posEnabled !== Disabled, including with posStatus active during every connect; the nickname Text is not gated on `connecting`, so Square POS terminals have the same tap during startup/reconnect.
10. [views/Settings/Wallets.tsx:538–547](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/Wallets.tsx#L538-L547)
   From Wallets the holder opens any wallet's WalletConfiguration with the full node config; the Add button (219-226) opens a blank WalletConfiguration. No posStatus or login check anywhere in the screen.
11. [views/Settings/WalletConfiguration.tsx:2399–2406](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/WalletConfiguration.tsx#L2399-L2406)
   ShowHideToggle flips state.hidden (initialised true at 231) and reveals the LNDHub password here, and macaroonHex / rune / NWC URL / LNC pairing phrase at siblings 2160-2170, 2677, 2782, 3015, with no re-auth; only the Seed screen is reAuthNavigation-gated (1137, 3351). deleteNodeConfig (860) is reachable from Alert confirmations (1128) with no re-auth.
12. [views/LightningAddress/LightningAddressSettings.tsx:39–56](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LightningAddress/LightningAddressSettings.tsx#L39-L56)
   From the unguarded LightningAddress screen (settings gear at index.tsx:182) the holder reaches confirmDelete -> LightningAddressStore.deleteAddress(), deleting the owner's ZEUS Pay address; LightningAddress/index.tsx:85 also opens the full Activity list.

## Impact
Wallets -> WalletConfiguration reveals remote-node credentials (macaroon, rune, LNC pairing phrase, NWC URL, LNDHub login) in clear after an eye toggle with no re-auth (confidentiality high; the seed alone stays behind reAuthNavigation). The holder can edit configs, add a wallet pointing at their own node, switch the active wallet and delete the owner's ZEUS Pay address (integrity high); and can delete wallet configurations, including embedded-node directories, through an Alert confirmation with no re-auth (availability high).

## Reproduction steps
1. Attacker is whoever operates the POS terminal (staff or a customer handed the device): physical access to a device deliberately left in POS mode, a position the code treats as untrusted (sibling header exits go through protectedNavigation to a PIN Lockscreen, and PointOfSale.tsx:179 warns when no PIN is set). Preconditions outside their control: POS enabled with a PIN/passphrase set, and either display.displayNickname enabled (default false, SettingsStore.ts:1579) with the POS Keypad tab (showKeypad default true) or any connect in progress, or ZEUS Pay enabled with a pending payment on the POS Keypad tab. Then a single tap on the nickname or ZeusPay icon lands on Wallets/LightningAddress with no credential prompt.

## Recommended fix
1. The displayNickname Text in WalletHeader's centerComponent navigates to 'Wallets' with a raw navigation.navigate while the sibling NodeButton protects the identical destination with protectedNavigation, so in POS mode the nickname is an unauthenticated exit to the wallet list and configuration screens. Fix criteria: While posStatus === 'active' and a login method is configured, no tap in WalletHeader may reach Wallets, WalletConfiguration or any other wallet-management screen without the Lockscreen first accepting a credential. Verify by enabling POS, displayNickname and a PIN, entering POS mode (cold start and connecting overlay), tapping the nickname: a Lockscreen must appear, a wrong PIN must not proceed, and Wallets must only open after a correct PIN.
2. The ZeusPay badge in WalletHeader's leftComponent navigates to 'LightningAddress' unconditionally; it is rendered in POS mode whenever a ZEUS Pay payment is pending, exposing address settings (delete), redemption and the full Activity list to POS staff. Fix criteria: In POS mode the ZeusPay badge must either be hidden or route through the same Lockscreen-with-pendingNavigation gate as Menu/Wallets. Verify with POS active, a PIN set and a pending ZEUS Pay payment: tapping the badge must not show LightningAddress or LightningAddressSettings before a correct PIN.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-288](https://cwe.mitre.org/data/definitions/288.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258221

---

# LNC watchInvoicePaid marks the watched invoice paid when any other single-invoice stream settles

## Details
The LNC bridge delivers server-streaming gRPC results to JavaScript as React Native events whose only name is the gRPC method: lnc-rn createRpc.ts:19-23 routes subscription methods to lnc.subscribe(), which calls LncModule.initListener(namespace, method, reqJSON) and returns the bare method string (lnc.ts:306-311); LncModule.kt:189-203 and StreamingCallback.mm:11-22 emit {result} under that name with no stream or request identifier, and neither native module exposes a way to cancel a stream once started.

LightningNodeConnect.watchInvoicePaid (959-1000) therefore listens on the single shared event 'invoicesrpc.Invoices.SubscribeSingleInvoice' and calls onPaid as soon as any event's parsed result has `settled` truthy. The payload carries the settled invoice's r_hash, but it is never compared with the rHash argument the watcher was created for; the amount, payment_request and preimage reported are the foreign invoice's.

Receive.tsx starts one such stream per invoice it displays (858-897) and, on the next invoice or on unmount, stopInvoiceWatcher (568-572) removes only the JS listener; the earlier Go-side stream stays open until lnd ends it (invoice settled, or cancelled at expiry, default 3600 s, Receive.tsx:669). From then on every settlement of an earlier still-open invoice is delivered to the listener of the invoice currently on screen, and handlePaymentReceived (821-856) flips the screen to the paid view, calls InvoicesStore.setWatchedInvoicePaid with the foreign amount and, for a POS order, persists the current order as paid via PosStore.recordPayment (PosStore.ts:217-236) and clears its pending invoice. In POS mode the paid view shows only 'Paid' (1497-1535), so there is no amount cue. Secondary effect: when the earlier stream ends with EOF (e.g. that invoice expires), the current watcher removes itself (973-976) and the displayed invoice's genuine payment is no longer detected.

Every sibling backend binds the paid signal to the watched hash: EmbeddedLND.ts:515-532 compares bytesToHex(invoice.r_hash) === rHash; LND.ts:782-810, CLNRest and LndHub look up the specific hash; watchOnchainReceived in the same file (1032-1036) filters by address. LNC's Lightning path is the only one that fires on any settled invoice. SECURITY.md lists 'fake payment confirmation' among the payment-handling flaws of particular interest.

Assumptions about the prebuilt LNC Go bridge (Lndmobile from ZeusLN/lnd v0.21.4-beta-zeus.1, pinned in fetch-libraries-versions.json): InvokeRPC forwards each stream message to the streaming callback for the life of the stream and offers no cancellation (consistent with the absence of any cancel method in LncModule.kt/.mm), and lnd's JSON marshalling emits the snake_case `settled` field, as the sibling watchOnchainReceived relies on for dest_addresses/num_confirmations.

Preconditions: LNC backend; at least one earlier invoice created in Receive during the same LNC session is still open.

## Evidence
1. [backends/LightningNodeConnect.ts:959–999](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LightningNodeConnect.ts#L959-L999)
   watchInvoicePaid adds a listener on the event name returned by subscribeInvoice ('invoicesrpc.Invoices.SubscribeSingleInvoice', shared by every single-invoice stream) and calls onPaid as soon as any event has result.settled truthy. The settled invoice's r_hash is present in the payload but is never compared with the rHash this watcher was created for; the amount reported is the foreign invoice's amt_paid_sat.
2. [backends/LightningNodeConnect.ts:935–936](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LightningNodeConnect.ts#L935-L936)
   subscribeInvoice returns the lnc-rn subscribe() result, which is the bare gRPC method name; every concurrent SubscribeSingleInvoice stream is therefore delivered on the same emitter event.
3. [zeus\_modules/@lightninglabs/lnc-rn/lib/lnc.ts:306–311](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/zeus_modules/%40lightninglabs/lnc-rn/lib/lnc.ts#L306-L311)
   subscribe() calls LncModule.initListener(namespace, method, reqJSON) and returns method: no per-stream identifier is minted and nothing is exposed to cancel a stream later.
4. [android/app/src/main/java/com/zeus/lnc-rn/LncModule.kt:167–202](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/lnc-rn/LncModule.kt#L167-L202)
   initListener wires an AndroidStreamingCallback whose eventId is the method name; sendEvent emits {result} on that name with no stream or request id. There is no method to cancel an open stream, so an earlier invoice's Go stream keeps emitting on the same event after JS stops listening for it.
5. [ios/LncMobile/StreamingCallback.mm:11–22](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LncMobile/StreamingCallback.mm#L11-L22)
   Same on iOS: sendResult emits {result} under self.eventId (the method name); nameSpace is only set for the key callbacks, and no stream identifier is carried.
6. [views/Receive.tsx:858–898](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L858-L898)
   Every new invoice calls subscribeInvoice(rHash): stopInvoiceWatcher() removes only the previous JS listener (568-572), then BackendUtils.watchInvoicePaid starts a new SubscribeSingleInvoice stream for the new hash. The previous invoice's native stream remains open until lnd terminates it (settle or cancel), so two or more single-invoice streams are live whenever a merchant has issued more than one unpaid invoice in a session.
7. [views/Receive.tsx:821–856](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L821-L856)
   The onPaid callback runs handlePaymentReceived: InvoicesStore.setWatchedInvoicePaid(amount) flips the screen to the paid state and, for a POS order, PosStore.recordPayment persists the current order as paid with its orderTotal and clearOrderInvoice removes the pending invoice. No check that the settled hash or amount belongs to this invoice.
8. [views/Receive.tsx:1497–1535](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L1497-L1535)
   In POS mode the paid view shows only the localized 'Paid' text (no amount), so the merchant gets no visual cue that the settled amount differs from the order; outside POS it shows the foreign invoice's amount.
9. [backends/EmbeddedLND.ts:515–531](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/EmbeddedLND.ts#L515-L531)
   The embedded-LND sibling binds the settled event to the watched hash (bytesToHex(invoice.r_hash) === rHash) before calling onPaid; LND REST (LND.ts:782-810), CLNRest (303-330) and LndHub (101-135) all look up the specific hash. LNC is the only backend that fires on any settled invoice.

## Impact
Integrity HIGH: the receiving flow's core guarantee, that the paid state reflects settlement of the displayed invoice, is defeated for an attacker-chosen amount gap; the POS order is persisted as paid and its invoice cleared, so the merchant releases goods for an unpaid invoice with no on-screen amount cue. No confidentiality impact. No availability impact.

## Reproduction steps
1. Attacker is any payer (a POS customer or a counterparty) interacting with an LNC-backed ZEUS wallet over Lightning (AV NETWORK). They obtain invoice A, decline to pay, obtain invoice B for a larger amount, then pay A; the merchant's screen and POS record mark B paid. No defence has to be defeated (AC LOW). Conditions outside the attacker's control: LNC backend and an earlier unpaid invoice from this session whose stream is still open (AT PRESENT). The merchant only performs their routine invoice flow (UI PASSIVE). No privileges (PR NONE).

## Recommended fix
1. LightningNodeConnect.watchInvoicePaid fires onPaid for any settled event on the shared 'invoicesrpc.Invoices.SubscribeSingleInvoice' emitter event without binding the event to the watched payment hash. Fix criteria: onPaid is invoked only when the settled event's r_hash (normalised for hex/base64) equals the rHash the watcher was created for, as the other backends do; events for other invoices are ignored and leave the watcher armed. Verify: with two single-invoice streams open, settle the earlier invoice and confirm the Receive screen for the later one stays unpaid and no POS payment is recorded.
2. LNC stream results carry no stream/request identifier and the bridge has no cancel, so a stream that JS stopped listening to keeps emitting on the same event name for the lifetime of the session. Fix criteria: Each initListener call is identified (per-stream event name or id in the payload) and/or can be cancelled when the JS consumer unsubscribes, so abandoned streams cannot feed later listeners. Verify: after stopInvoiceWatcher, events from the abandoned stream are not delivered to a new watcher.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Origin validation error
**CWE:** [CWE-346](https://cwe.mitre.org/data/definitions/346.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258220

---

# Rescue-key restore resets swap key counter, reusing deterministic reverse-swap preimages

## Details
ZEUS derives every swap key, and every reverse swap preimage, deterministically from the 12-word rescue mnemonic: key_i = m/44/0/0/0/i and preimage_i = sha256(privkey_i) (SwapStore.ts:1326-1361, SwapUtils.ts:422). Uniqueness of preimages across swaps rests entirely on the monotonically increasing counter in Storage key SWAPS_LAST_USED_KEY (generateNewKey, SwapStore.ts:1390-1395), which defaults to 0 when absent.

The two restore flows in the swap UI do not restore that counter. 'Import existing rescue key' (views/Swaps/index.tsx:730-738 -> SeedRecovery.tsx:1511-1530) writes only SWAPS_RESCUE_KEY; 'Restore swaps' (SwapsPane.tsx:295-299 -> getRescuableSwaps, SwapStore.ts:1488-1588) learns each swap's keyIndex from the host but never advances the counter; and deleting the rescue key (Seed.tsx:237-240) removes the counter so a later re-import of the same mnemonic also restarts at 0. After any of these, the next reverse swap on the new install reuses index 0, 1, 2... and therefore the exact preimage and payment hash of a reverse swap the user already completed on the old install.

A reused payment hash is the classic Lightning hash-reuse failure: when the first swap at index i completed, preimage_i was revealed to the then-provider (cooperative claim), to every routing node on the path of the hold-invoice payment (the preimage travels back hop by hop on settlement) and, for a script-path claim, to the whole network in the claim witness. When the user later pays a new hold invoice carrying the same hash, any such party on the new path -- most plausibly the user's direct channel peer/LSP, which forwards every payment the user makes -- can settle the incoming HTLC with preimage_i and keep the funds; the user's node records a successful payment, the provider never receives it, no lockup is made, and the swap expires. A provider that recognises the hash (its own earlier swap, or a hash whose preimage is on-chain) can likewise settle the hold invoice without locking anything. verifyReverseSwapInvoice/Response pass, because the invoice hash does equal sha256(our preimage).

The scenario is the product's own recovery story: a user who lost a device, reinstalled, and followed the in-app prompts to import their rescue key or restore their swaps, then uses the feature again. Provider-side rejection of a duplicate preimageHash (which Boltz-derived servers may enforce) does not protect across providers -- the app itself migrated users between hosts (MigrationUtils applySwapHostsToBoltz/applyRetiredSwapHosts) -- and does not protect against the routing-node attacker at all. Submarine swaps on a reused index also share a refund key with an earlier swap, a lesser weakness. No test covers the counter after restore (SwapStore.rescue.test.ts).

## Evidence
1. [stores/SwapStore.ts:1377–1395](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L1377-L1395)
   getLastUsedKey reads SWAPS_LAST_USED_KEY and returns 0 when absent; generateNewKey hands that index to createReverseSwap/createSubmarineSwap and stores index+1. This counter is the only thing that keeps two swaps from sharing a derived key and, for reverse swaps, a preimage.
2. [stores/SwapStore.ts:1346–1360](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L1346-L1360)
   derivePreimageFromRescueKey derives the reverse-swap preimage as deriveSwapPreimage(child privkey at m/44/0/0/0/<index>) = sha256(privkey) (utils/SwapUtils.ts:422). Same mnemonic + same index reproduces the same preimage and payment hash with no per-swap entropy.
3. [views/Settings/SeedRecovery.tsx:1511–1529](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/SeedRecovery.tsx#L1511-L1529)
   The restoreRescueKey branch (reached from the Swaps intro modal, views/Swaps/index.tsx:726-738) validates the mnemonic and writes only SWAPS_RESCUE_KEY; SWAPS_LAST_USED_KEY is neither restored nor advanced, so on a fresh install the next swap starts at index 0.
4. [stores/SwapStore.ts:1488–1587](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L1488-L1587)
   getRescuableSwaps (reached from views/Swaps/SwapsPane.tsx:295-299) learns each rescued swap's keyIndex from the host's /swap/restore response and persists the swaps, but never raises SWAPS_LAST_USED_KEY above the highest rescued index.
5. [stores/SwapStore.ts:587–599](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L587-L599)
   createReverseSwap sends preimageHash = sha256(preimage) for the (possibly reused) index to the host as the hold invoice's payment hash. Neither here nor in verifyReverseSwapInvoice/verifyReverseSwapResponse (lines 631-690) is the hash compared against stored swaps; those checks pass because the invoice hash does equal sha256(our preimage).
6. [views/Settings/Seed.tsx:237–240](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/Seed.tsx#L237-L240)
   Deleting the rescue key also removes SWAPS_LAST_USED_KEY; re-importing the same mnemonic afterwards restarts at index 0 on the same device, reproducing the preimages of swaps already completed.
7. [stores/SettingsStore.ts:1469–1478](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L1469-L1478)
   ZEUS has retired and migrated users across several Boltz-protocol hosts (eldamar, api.boltz.exchange, middle-way), and SwapStore.getHost honours settings.swaps.customHost (SwapStore.ts:270-274). A new host has no record of the earlier hash, so a provider-side duplicate-preimageHash check cannot prevent the reuse; the routing-node attacker is unaffected by any such check.

## Impact
The user's Lightning payment for the new reverse swap is captured by a routing node or prior provider without any on-chain payout, and no refund path exists because the payment is 'successful' from the node's view. Every swap whose index collides loses its atomicity guarantee: funds go to a party other than the one the user approved (integrity HIGH). The reused key/preimage material is already known to the attacker, so no additional disclosure; no availability impact.

## Reproduction steps
1. Precondition (AT:P): the user has completed at least one reverse swap at index i under a rescue mnemonic and later imports that mnemonic (or rescues swaps and imports it) on an install whose SWAPS_LAST_USED_KEY is absent or below i — the lost-device/reinstall and delete-then-reimport paths the in-app recovery UI exists for. When the first swap settled, preimage_i was revealed to the then-provider (cooperative claim or on-chain witness) and to every routing node on the hold-invoice path via update_fulfill_htlc, inherently in Lightning. The attacker is any such party that retained it — most plausibly the user's direct channel peer/LSP, which forwards every payment the user sends. When the user creates the next reverse swap (index i again) and pays its hold invoice, that peer settles the incoming HTLC with preimage_i and keeps the funds; the user's node records success, the provider receives nothing and locks up nothing. No ZEUS check has to be defeated (PR:N, AC:L); the user must initiate and pay the swap (UI:A). Assumption: Boltz-backend hosts reject a preimageHash already in their own database and LND rejects duplicate invoice hashes, so same-host reuse fails safely; this does not cover a different or migrated host (SettingsStore.ts:1469-1478, custom host) nor the routing-node attacker.

## Recommended fix
1. The swap key counter is the sole source of preimage uniqueness, but the rescue-key import and swap-rescue flows restore the mnemonic without restoring or advancing the counter. Fix criteria: After importing a rescue key or rescuing swaps, SWAPS_LAST_USED_KEY must be set above every index already used under that mnemonic: at least max(keyIndex of rescued swaps)+1, and the app should query the host's restore endpoint on rescue-key import for the same purpose or require a gap-limit scan. Verify by rescuing swaps at indices 0-3 on a fresh install and confirming the next swap uses index >= 4.
2. Reverse swap preimages are a deterministic function of the key index with no per-swap entropy, so any counter error reproduces a previously revealed preimage. Fix criteria: Before creating a reverse swap, the app must refuse a preimage hash that matches any stored swap and should prefer mixing per-swap entropy that is itself recoverable (e.g. including the swap's creation nonce in the host-returned restore data) so that a counter collision cannot reproduce an old preimage. Verify by forcing the counter to a used index and confirming creation is refused or produces a fresh hash.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Nonce reuse
**CWE:** [CWE-323](https://cwe.mitre.org/data/definitions/323.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258218

---

# Ecash melt dispatched after confirmation from unpinned shared store; concurrent NWC getPayReq redirects payment

## Details
CashuPaymentRequest pins the invoice under review (reviewedPaymentRequest) and refuses to proceed when CashuStore.paymentRequest no longer matches (lines 243-251). That check is the only binding between what the user approved and what is paid, and it happens before the payment is dispatched: triggerPayment navigates to CashuSendingLightning carrying only paymentAmount, and CashuSendingLightning.componentDidMount later calls CashuStore.payLnInvoiceFromEcash({ amount }) via runWhenIdle (111-118). payLnInvoiceFromEcash then melts this.meltQuote.quote and records this.payReq / this.paymentRequest (stores/CashuStore.ts 4539-4558) with no comparison against the reviewed invoice. The multi-mint screen (MultimintPayment.tsx 229-232 -> CashuStore.ts 4615-4617) and both donation legs behave the same way. The Lightning sibling does not have this gap: views/PaymentRequest.tsx 448-449 passes payment_request into sendPayment in the same step as its pin check.

The singleton is writable by an external principal. NostrWalletConnectStore.handleCashuPayInvoice (active when the user has switched NWC funding to ecash; 1517-1520) calls cashuStore.getPayReq(request.invoice) at 2803 before its budget (2860) and balance (2869) checks. Any connected NWC client with pay_invoice permission, including one whose budget is exhausted, can therefore make ZEUS set paymentRequest = its invoice, fetch a melt quote for it at the user's selected mint, and store it in meltQuote, at any time and at no cost, with no rate limit beyond a 30 s queue wait. enqueuePayment serialises only NWC requests, not user payments.

Attack: the client repeatedly submits pay_invoice for an invoice it controls. If one such getPayReq completes in the window between the user's pin check and the melt read at 4539 (navigation transition + idle wait of up to 500 ms + the async getMintBalance call), the user's ecash melts the attacker's quote: the attacker's invoice is paid for the amount it chose, the invoice the user confirmed is never paid, the CashuPayment persisted to history names the attacker's bolt11, and CashuSendingLightning shows success with the reviewed amount from the route (251-266, 334-339). The subsequent NWC leg either fails its budget check or fails to re-melt the spent quote, so no NWC budget is debited for the spend. A clobber landing before the tap is caught by the pin (warning shown), so the attacker races blind, but can retry indefinitely across every ecash payment the user makes, and each hit can drain up to the mint balance.

Secondary consequence of the same shared state: an NWC-initiated payLnInvoiceFromEcash resets and then sets paymentSuccess/paymentError (4459-4464, 4572-4600), which CashuSendingLightning renders as its own result (244-246, 290), so a concurrent NWC payment can flip the user's screen back to loading and then show the NWC outcome, including a false failure with a Try again button. This is the Cashu sibling of the verified TransactionsStore finding nwc-shared-transactions-store-payment-result-crosstalk; related store-side records are cashu-single-mint-melt-ignores-pending-state (4538, state check) and lead e4-08 / lead-cashustore-4204-1e29.

Dependency assumption: react-navigation 'focus' is not re-fired on CashuPaymentRequest during the forward navigation (so no re-derivation intervenes), and CashuDevKit.melt(mintUrl, quoteId) pays whatever quote id it is given.

## Evidence
1. [views/Cashu/CashuSendingLightning.tsx:111–118](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/CashuSendingLightning.tsx#L111-L118)
   On mount the screen resets payment state and schedules CashuStore.payLnInvoiceFromEcash({ amount }) via runWhenIdle (deadline 500 ms). Only the amount travels from the confirmation screen; the invoice and melt quote to pay are read later from the CashuStore singleton, after the review screen's pin check has already passed.
2. [stores/CashuStore.ts:4539–4558](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L4539-L4558)
   The melt executes CashuDevKit.melt(mintUrl, this.meltQuote.quote) and records a CashuPayment from ...this.payReq and this.paymentRequest. None of these are compared with the invoice the user confirmed; whatever getPayReq last wrote is paid. rawPaymentAmt (4467-4469) and feeEstimate (4521) are likewise read from the singleton.
3. [views/Cashu/CashuPaymentRequest.tsx:243–251](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/CashuPaymentRequest.tsx#L243-L251)
   triggerPayment compares CashuStore.paymentRequest with the pinned reviewedPaymentRequest exactly once, then (289-292, 213-229) navigates to CashuSendingLightning passing only paymentAmount. The pin is not propagated, so the check is time-of-check and the melt is time-of-use.
4. [stores/NostrWalletConnectStore.ts:2803–2805](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2803-L2805)
   handleCashuPayInvoice calls cashuStore.getPayReq(request.invoice) for any pay_invoice request from a connection with that permission (1517-1534), BEFORE the budget check (2860) and balance check (2869). A client with an exhausted budget can therefore rewrite CashuStore.paymentRequest/payReq/meltQuote at will, at no cost, whenever it likes; enqueuePayment (1944-1959) serialises only NWC requests, not against user payments.
5. [stores/CashuStore.ts:4217–4223](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L4217-L4223)
   getPayReq overwrites paymentRequest synchronously and, after a mint round-trip, payReq/meltQuote/feeEstimate together (4406-4411). Its requestId guard only orders getPayReq calls against each other; it offers nothing to a melt already in progress.
6. [views/PaymentRequest.tsx:448–449](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/PaymentRequest.tsx#L448-L449)
   The Lightning sibling binds the invoice at dispatch: triggerPayment passes payment_request: paymentRequest into TransactionsStore.sendPayment (356-358) in the same synchronous step as its pin check. The Cashu path is the one sibling that defers the binding to a later screen reading mutable shared state.
7. [views/Cashu/MultimintPayment.tsx:229–232](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/MultimintPayment.tsx#L229-L232)
   Same pattern on the multi-mint path: executePayment on mount passes only the amount; payLnInvoiceFromEcashMultiMint (stores/CashuStore.ts 4615-4617) snapshots this.paymentRequest and this.meltQuotes at execution time.
8. [views/Cashu/CashuSendingLightning.tsx:251–266](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/CashuSendingLightning.tsx#L251-L266)
   The success view prints paymentAmount from the route (the amount the user reviewed) rather than what was melted, so a substituted melt is shown as a successful payment of the reviewed amount. Success/failure themselves come from the shared paymentSuccess/paymentError flags (244-246, 290), which an NWC-initiated payLnInvoiceFromEcash also resets (stores/CashuStore.ts 4459-4464) and sets, so the user's screen can additionally display the NWC payment's outcome as its own.
9. [views/Cashu/CashuSendingLightning.tsx:184–189](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/CashuSendingLightning.tsx#L184-L189)
   The donation leg repeats the pattern with its own window: getPayReq(donationInvoice) then payLnInvoiceFromEcash, with a clobber between the two melting whatever meltQuote is present (MultimintPayment.tsx 292-296 is identical).

## Impact
On a hit the user's ecash melts the attacker's quote: rawPaymentAmt (4467) and amountToPay (4521) are taken from the attacker's payReq/feeEstimate, the melt (4539-4542) pays the attacker's invoice for the amount it chose, the persisted CashuPayment (4547-4558) records the attacker's bolt11, and CashuSendingLightning shows success with the reviewed amount from the route (251-266). The invoice the user confirmed is never paid and no NWC budget is debited (the NWC leg fails its budget check or fails re-melting the spent quote), so destination, amount and payment-state integrity are all violated and funds up to the selected mint's balance are lost (I HIGH). The shared paymentSuccess/paymentError flags add false-result reporting. No confidential data exposed; no availability impact.

## Reproduction steps
1. Attacker is an NWC client app holding a connection with pay_invoice permission (PR LOW; pay_invoice is in the full-access preset, utils/NostrConnectUtils.ts:392), reached over Nostr relays (AV NETWORK); the relay subscription (startService -> subscribeToAllConnections) is live in the foreground while the user pays. Preconditions: the user has turned on the NWC 'fund from Cashu' switch (NWCSettings.tsx:106 -> setCashuEnabled; isCashuConfigured at NostrWalletConnectStore.ts:3867) and the attacker's getPayReq must start after the review screen's pin check and complete before the melt read at CashuStore.ts:4539 (navigation + runWhenIdle deadline 500 ms + getMintBalance), so a race must be won (AT PRESENT). withGlobalHandler (1882-1932) applies no budget or rate limit before the handler, so the client can submit pay_invoice for its own invoice indefinitely at no cost; a clobber landing before the tap only shows the payment-request-changed warning, so the attacker retries across every ecash payment the user makes (UI PASSIVE: the user performs only a routine payment). No defensive mechanism remains to defeat once the window is hit; CashuStore has no in-flight/payment lock (AC LOW). Dependency assumptions: @getalby/sdk 8.0.3 delivers pay_invoice events authored with the connection secret to handler.payInvoice; @react-navigation/native 7.5.0 does not re-fire 'focus' on CashuPaymentRequest during forward navigation; the pinned CDK FFI melt(mintUrl, quoteId) pays whatever quote id it is handed.

## Recommended fix
1. The invoice/melt quote to pay is re-read from the mutable CashuStore singleton at melt time instead of being bound to the invoice the user confirmed when the pin check passed. Fix criteria: The confirmation step must capture the reviewed bolt11 and its melt quote(s) and pass them explicitly into the payment call (CashuSendingLightning, MultimintPayment and both donation legs), and payLnInvoiceFromEcash must melt only the quote it was handed (or re-verify that store paymentRequest/meltQuote still correspond to that bolt11 and fail closed otherwise). Verify by invoking getPayReq with a different invoice between triggerPayment and the melt and confirming no melt of the second quote occurs and the user is shown a refusal, not success.
2. The NWC service mutates the user-facing CashuStore review state (paymentRequest/payReq/meltQuote/feeEstimate) and result flags (paymentSuccess/paymentError) for requests from external clients, before authorising them. Fix criteria: NWC pay_invoice handling must decode and quote the client's invoice into request-scoped state that the user's review and sending screens never read, and must not reset or set the flags CashuSendingLightning renders; budget and balance checks should precede any mint round-trip. Verify by running a user ecash payment concurrently with an NWC pay_invoice and confirming each flow reports only its own outcome.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-367](https://cwe.mitre.org/data/definitions/367.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258217

---

# LDK Node channel state and debug log stored in iOS Documents exposed via File Sharing

## Details
The JS layer that initialises the embedded LDK Node builds its storage directory as `${RNFS.DocumentDirectoryPath}/ldk-node/<uuid>` (utils/LdkNodeUtils.ts:88-97) and hands it verbatim to the native builder (LdkNodeModule.swift:141-149, `builder.setStorageDirPath`). On iOS this is the app's Documents directory, and ios/zeus/Info.plist sets both `UIFileSharingEnabled` (line 135) and `LSSupportsOpeningDocumentsInPlace` (line 55) to true. Apple documents that this combination exposes the whole Documents directory in the Files app (On My iPhone > ZEUS) and to Finder/iTunes File Sharing from any computer the phone trusts; the project itself describes Documents as "the Files-app visible Documents dir on iOS" whose files "outlive the app" when it purges a legacy plaintext rescue-key file from there (utils/SwapUtils.ts:518-524).

What lives there: `ldk_node_data.sqlite`, ldk-node's local KVStore (LdkNodeUtils.ts:430-431). It is written in every configuration: with the default VSS server (`DEFAULT_VSS_SERVER`, LdkNodeUtils.ts:47) the native module builds a dual store "VSS + local" (LdkNodeModule.swift:425-428) and falls back to local-only SQLite when VSS fails or is not configured (LdkNodeModule.swift:525-534). Per ldk-node's KVStore layout it holds the ChannelManager, every ChannelMonitor (channel state, counterparty-revealed per-commitment secrets, the counterparty-signed holder commitment transaction), the payments table with payment hashes, preimages and payment secrets, peer records, scorer/network graph and the BDK wallet changeset (public extended descriptor, i.e. every on-chain address). Alongside it the native module writes `ldk_node.log` at DEBUG level (LdkNodeModule.swift:574-577). Assumption on the pinned binary (ldk-node v0.7.0-zeus-rl-0.2.7, fetch-libraries-versions.json): upstream rust-lightning stopped serialising InMemorySigner secrets into ChannelMonitors in 0.0.119, so channel signing keys are taken NOT to be on disk; the seed stays in the keychain. The disclosure is therefore the complete payment history with preimages/secrets, channel and peer state, the on-chain xpub descriptor and the verbose log, not the keys themselves.

Attack path: someone holding the device while ZEUS is locked by PIN/passphrase/biometrics (an in-scope adversary; the project's threat model rates PIN bypass by "someone holding the unlocked or locked device" as High) opens Files, navigates to On My iPhone > ZEUS > ldk-node > <uuid>, and shares/copies `ldk_node_data.sqlite` and `ldk_node.log` — or plugs the phone into a trusted computer and copies them via File Sharing. ZEUS's lock screen is never involved and the duress wipe cannot reach data already copied. Because Files and File Sharing also allow deleting and replacing files in place, the attacker can delete the store (node loses all channel state; ldk-node keeps no static channel backup locally) or replace it with an earlier copy so that the next local-only start runs on stale channel state and broadcasts or accepts a revoked commitment, exposing the channel balance to the counterparty's penalty transaction. In dual-store mode the precedence between the local and VSS copies on conflict is a detail of the ZEUS ldk-node fork that cannot be verified from this checkout; the local-only fallback path is reached whenever VSS is unreachable at start.

The maintainers already treat this directory as sensitive (NSURLIsExcludedFromBackupKey applied on every start, LdkNodeUtils.ts:109-122) and keep the sibling embedded-node stores under Library/Application Support — LND (ios/LndMobile/LndMobileTools.swift:648-652) and CDK (utils/DataClearUtils.ts:346-351, CashuDevKitModule.swift:262-285 "plaintext SQLite file must not leave the device"); only the LDK store was left in Documents. Android is unaffected (DocumentDirectoryPath is the private files dir).

## Evidence
1. [utils/LdkNodeUtils.ts:88–97](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LdkNodeUtils.ts#L88-L97)
   getLdkNodeBaseDirectory()/getLdkNodeStoragePath() place every LDK wallet's data directory under RNFS.DocumentDirectoryPath (NSDocumentDirectory on iOS). This path is passed verbatim to the native setStorageDirPath and becomes ldk-node's storage_dir_path. This is the location the fix must change.
2. [ios/zeus/Info.plist:135–136](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/zeus/Info.plist#L135-L136)
   UIFileSharingEnabled is true, so the app's Documents directory is exported to Finder/iTunes File Sharing on any trusted computer.
3. [ios/zeus/Info.plist:55–56](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/zeus/Info.plist#L55-L56)
   LSSupportsOpeningDocumentsInPlace is true; together with UIFileSharingEnabled this makes the Documents directory browsable, copyable, editable and deletable from the iOS Files app (On My iPhone > ZEUS) without opening ZEUS or passing its lock screen.
4. [ios/LdkNodeMobile/LdkNodeModule.swift:574–577](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LdkNodeMobile/LdkNodeModule.swift#L574-L577)
   The native module writes ldk_node.log at DEBUG level into the same storage directory, so the node's verbose runtime log (payment hashes, amounts, peer ids, channel ids) is exposed alongside the database.
5. [ios/LdkNodeMobile/LdkNodeModule.swift:425–427](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LdkNodeMobile/LdkNodeModule.swift#L425-L427)
   With a VSS server configured (the default) the node is built with a dual store, VSS + local, so the local ldk_node_data.sqlite is written in every configuration; lines 525-534 fall back to a local-only SQLite store when VSS fails or is absent.
6. [utils/LdkNodeUtils.ts:424–446](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LdkNodeUtils.ts#L424-L446)
   startLdkNodeWallet confirms the store file name: ldk_node_data.sqlite inside that directory. This SQLite KVStore holds the channel manager, every ChannelMonitor, the payments table (hashes, preimages, secrets), peer data and the BDK wallet changeset.
7. [utils/LdkNodeUtils.ts:109–121](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LdkNodeUtils.ts#L109-L121)
   The only protection applied is NSURLIsExcludedFromBackupKey, which keeps the directory out of iCloud/iTunes backups but has no effect on File Sharing or Files-app visibility. It shows the maintainers consider this data sensitive.
8. [utils/SwapUtils.ts:518–524](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/SwapUtils.ts#L518-L524)
   The project's own comment calls RNFS.DocumentDirectoryPath "the Files-app visible Documents dir on iOS" whose files "outlive the app" and purges a legacy plaintext secret written there — the project does not concede Documents contents to the device holder; it treats such exposure as a bug.
9. [utils/DataClearUtils.ts:342–351](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/DataClearUtils.ts#L342-L351)
   Sibling implementation: CDK (Cashu) databases are deliberately kept under Library/Application Support on iOS, which is not exposed by File Sharing.
10. [ios/LndMobile/LndMobileTools.swift:648–651](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LndMobile/LndMobileTools.swift#L648-L651)
   Sibling implementation: the embedded LND data directory is also created under Application Support. LDK Node is the only embedded-node store left in Documents.

## Impact
Confidentiality: the entire local LDK node store is readable — payments table with payment hashes, preimages and secrets (preimages are a protected asset and serve as proof of payment for outstanding invoices), every ChannelMonitor and the ChannelManager, peer records, the BDK public descriptor (every on-chain address and balance) and the DEBUG log. Assumption on the pinned ldk-node v0.7.0-zeus-rl-0.2.7: rust-lightning >= 0.0.119 no longer serialises signer secrets into monitors and the seed stays in the keychain, so channel signing keys are not disclosed. Integrity: the store can be deleted or replaced with a stale copy; a subsequent local-only start (the fallback path whenever VSS is unreachable, and the only path when no VSS is configured) runs on revoked channel state and exposes the channel balance to penalty. Whether the VSS copy overrides a tampered local copy in dual-store mode is fork behaviour not verifiable here. Availability: deleting the store destroys the node's channel state with no local static channel backup.

## Reproduction steps
1. Attacker needs physical possession of the iPhone, either unlocked (Files app) or paired with a previously trusted computer (Finder/iTunes File Sharing). No ZEUS credential, PIN or biometric is required and no user interaction occurs; the app lock screen is bypassed entirely. iOS-only, and the device must be unlocked or trusted, hence attack requirements PRESENT. Reading, copying, deleting and replacing files are plain Files/Finder operations.

## Recommended fix
1. The LDK Node data directory is created under the iOS Documents directory, which the app exports through UIFileSharingEnabled/LSSupportsOpeningDocumentsInPlace, so channel keys, payment secrets and debug logs are readable and writable without passing the app lock. Fix criteria: On iOS the LDK storage directory (database and ldk_node.log) must reside in a location not exported by File Sharing or the Files app (e.g. Library/Application Support, like LND and CDK), with a one-time migration of existing wallets. Verify that after the change no ldk-node file is visible under On My iPhone > ZEUS or via Finder File Sharing, and that NSURLIsExcludedFromBackupKey is still applied at the new location.
2. Document-sharing flags remain enabled for the whole Documents directory although the app stores security-critical state there. Fix criteria: Either disable UIFileSharingEnabled/LSSupportsOpeningDocumentsInPlace, or confine anything intentionally shared to a dedicated subfolder while all node state lives outside Documents. Verify by auditing every RNFS.DocumentDirectoryPath writer (TorUtils, ContactUtils, PhotoUtils, SwapUtils, ChannelMigrationUtils) for secrets.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Sensitive data exposure
**CWE:** [CWE-552](https://cwe.mitre.org/data/definitions/552.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258211

---

# Imported wallet config lndDir/ldkNodeDir reach native recursive delete without validation

## Details
The node-config import feature (Tools -> Export/Import wallet configs) loads `data.nodes` from a user-picked file straight into settings. `handleImportFile` (views/Tools/NodeConfigExportImport.tsx:607-656) accepts an envelope with `encrypted:false` and checks only `Array.isArray(nodes)`; `executeImport` -> `saveNodeConfigs` (utils/NodeConfigUtils.ts:46-55) appends the objects verbatim, and nothing downstream distinguishes an imported node from one the app created. So `implementation`, `lndDir` and `ldkNodeDir` are attacker-chosen strings, whereas every in-app writer of those fields uses `uuidv4()` (utils/WalletCreationUtils.ts:90,125) and the exporter refuses to export embedded-lnd/ldk-node nodes at all and never writes plaintext (encryption is no barrier either: an attacker can ship an encrypted v2 envelope with its password).

The two directory fields are later used as path components by code that assumes a flat UUID directory name:

* ldk-node route (no activation needed): Wallets -> gear (views/Settings/Wallets.tsx:538-548 passes the stored node) -> Delete wallet -> `performDelete` goes straight to `deleteNodeConfig` for non-embedded-lnd implementations -> `deleteNodeDataDirectoryWithRetry(deletedNode)` -> `deleteNodeDataDirectory` -> `deleteLdkNodeWallet(node.ldkNodeDir)` -> `RNFS.unlink(`${DocumentDirectoryPath}/ldk-node/${ldkNodeDir}`)` (react-native-fs 2.20.0 unlink removes directories recursively). `ldkNodeDir: '..'` resolves to the whole Documents (iOS) / files (Android) directory: every embedded LND wallet's channel.db/wallet.db, every LDK wallet, the CDK ecash databases; `'../..'` resolves to the app data root, which on Android holds `shared_prefs` where react-native-keychain keeps the settings blob with all node configs and embedded seeds. Because the kernel resolves `..` through the intermediate component, this route requires `${DocumentDirectoryPath}/ldk-node` to exist, which is the case on any device that has ever created or restored an LDK Node wallet (`createLdkNodeDirectory` -> RNFS.mkdir creates it); on a device with no LDK history `RNFS.exists` is false and nothing is deleted.

* embedded-lnd route (no filesystem precondition): `performDelete` demands the wallet be active first; `setWalletConfigurationAsActive` sends the user to Wallet.tsx:876 -> `initializeLnd({ lndDir })` -> native `writeConfig` (LndMobileTools.java:99-110), which `mkdirs()` and writes `lnd.conf` at `filesDir/<lndDir>/lnd.conf`, and `startLnd` with `--lnddir=filesDir/<lndDir>` (LndMobile.java:383), i.e. LND pointed at `filesDir/..`, the app data root. Deleting the now-active wallet then runs `deleteLndWallet(lndDir)` -> `deleteLndDirectory(lndDir)` = `deleteRecursive(new File(filesDir, lndDir))` (LndMobileTools.java:757-761; the `'lnd'` special case shows the code knows the files root holds other wallets, but `..` is not caught), on iOS `removeItem(applicationSupport/<lndDir>)` (LndMobileTools.swift:231-245) which with `..` removes the whole Library directory.

The same lack of validation lets an imported node carry a `nostrWalletConnectUrl`, `host`, `lndhubUrl` or `certVerification:false` that bypasses the WalletConfiguration form's ValidationUtils checks, and a node with `implementation:'lndhub'`, no nickname and no `lndhubUrl` makes `NodeTitle` (components/NodeIdenticon.tsx:16) throw on every render of the wallet list.

Attacker: whoever supplies a `.zeus-wallet-config-backup` file (shared file, chat attachment, a 'backup' or 'connection config' sent by a fake support agent or node host). The victim must import it and later delete (ldk-node) or activate-then-delete (embedded-lnd) the planted wallet; the import modal shows only nickname and implementation, so a node named like the user's own wallet is not distinguishable. Impact: irreversible loss of all on-device wallet state and, for embedded wallets without external backups, of funds (channel state is unrecoverable without SCB; on Android the `../..` variant also removes the keychain-backed settings blob holding the seeds; on iOS seeds in the OS keychain survive but LND/LDK channel state does not).

## Evidence
1. [views/Tools/NodeConfigExportImport.tsx:607–655](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/NodeConfigExportImport.tsx#L607-L655)
   handleImportFile JSON.parses any user-picked file and, when the envelope says encrypted:false, takes data.nodes verbatim with only an Array.isArray check. No field of any node (implementation, lndDir, ldkNodeDir, ...) is validated or filtered, even though the export side (lines 253-263, 283-285, 353-355) never emits embedded-lnd/ldk-node nodes and the current exporter never produces encrypted:false files.
2. [views/Tools/NodeConfigExportImport.tsx:921–932](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/NodeConfigExportImport.tsx#L921-L932)
   executeImport hands the selected imported node objects straight to saveNodeConfigs.
3. [utils/NodeConfigUtils.ts:46–54](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NodeConfigUtils.ts#L46-L54)
   saveNodeConfigs appends the imported objects to settings.nodes unchanged; from here they are indistinguishable from nodes created by the app with uuidv4() directory names.
4. [views/Settings/WalletConfiguration.tsx:860–995](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/WalletConfiguration.tsx#L860-L995)
   deleteNodeConfig reads lndDir/ldkNodeDir from the stored node (copied into state verbatim at 476-481/521-526; the Wallets list gear at views/Settings/Wallets.tsx:538-548 opens this screen for any stored node) and calls deleteNodeDataDirectoryWithRetry(deletedNode). For implementation 'ldk-node' performDelete (1088-1177) reaches this directly, active or not, after a single confirm dialog; for 'embedded-lnd' it first requires the wallet to be set active (1198-1216), which starts LND on the attacker-chosen lndDir.
5. [utils/DataClearUtils.ts:597–612](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/DataClearUtils.ts#L597-L612)
   deleteNodeDataDirectory forwards node.lndDir || 'lnd' to deleteLndWallet and node.ldkNodeDir to deleteLdkNodeWallet with no canonicalisation or allow-list (the NODE_DIR_NAME_REGEX at 758-760 exists but is only applied to the orphan sweep, not here).
6. [utils/LdkNodeUtils.ts:95–96](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LdkNodeUtils.ts#L95-L96)
   getLdkNodeStoragePath concatenates `${DocumentDirectoryPath}/ldk-node/${nodeDir}`; a nodeDir of '..' resolves to the app's Documents/files dir and '../..' to the app data root. Kernel path resolution requires the intermediate `ldk-node` component to exist, so this route needs the base directory created by createLdkNodeDirectory (RNFS.mkdir) at least once on the device.
7. [utils/LdkNodeUtils.ts:572–577](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LdkNodeUtils.ts#L572-L577)
   deleteLdkNodeWallet RNFS.exists()s then RNFS.unlink()s that path with no canonicalisation or UUID check; react-native-fs 2.20.0 unlink removes directories recursively (the project's own test helper at utils/NodeConfigUtils.test.ts:29 documents this assumption).
8. [android/app/src/main/java/com/zeus/LndMobileTools.java:743–769](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/LndMobileTools.java#L743-L769)
   deleteLndDirectory builds new File(filesDir, lndDir) and deleteRecursive()s it; '..' segments are honoured by java.io.File, so lndDir '../shared_prefs' or '..' escapes the wallet directory.
9. [android/app/src/main/java/com/zeus/LndMobileTools.java:99–109](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/LndMobileTools.java#L99-L109)
   writeConfig writes lnd.conf to filesDir + '/' + lndDir + '/lnd.conf' after mkdirs(); reached via Wallet.tsx -> initializeLnd(lndDir) when an imported embedded-lnd node is selected (utils/LndMobileUtils.ts:411-425, views/Wallet/Wallet.tsx:876-877).
10. [ios/LndMobile/LndMobileTools.swift:231–244](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LndMobile/LndMobileTools.swift#L231-L244)
   iOS sibling: applicationSupportUrl.appendingPathComponent(lndDir) followed by removeItem; same traversal.

## Impact
Recursive deletion of the app's files/Documents directory (or app data root) destroys every embedded LND/LDK wallet's channel and wallet databases, Cashu proofs, and on Android the keychain-backed settings blob with all node configs and embedded seeds: irreversible loss of funds for wallets without external backups and total loss of availability of the app's data. Confidentiality is not directly affected by the delete sink; the lnd.conf write and LND start on filesDir/.. stay inside the app sandbox.

## Reproduction steps
1. Attacker crafts a plaintext JSON envelope `{version:2, encrypted:false, data:{nodes:[{implementation:'ldk-node', ldkNodeDir:'..', nickname:'My wallet'}]}}` (or an encrypted v2 envelope plus its password) and gets it onto the device by any file share. Victim opens Tools -> Import, picks the file, taps Import (all nodes pre-selected), then later deletes that wallet from the Wallets list and confirms; for the embedded-lnd variant the delete dialog itself steers the victim to set the wallet active first. No crypto, lock-screen or permission bypass is needed. The ldk-node route additionally needs the ldk-node base directory to exist (any device that ever had an LDK wallet); the embedded-lnd route has no filesystem precondition. Two or three deliberate victim steps, hence UI ACTIVE; attacker-provided file opened locally, hence AV LOCAL.

## Recommended fix
1. The import path trusts the structure and content of node objects from an external file: `encrypted:false` envelopes are accepted although the exporter never produces them, embedded implementations are accepted although the exporter excludes them, and directory-name fields are stored without validation. Fix criteria: Import must reject envelopes that are not encrypted v1/v2 blobs and must validate each decrypted node against an explicit schema: implementation in the remote set (lnd, cln-rest, lndhub, lightning-node-connect, nostr-wallet-connect) with embedded-lnd/ldk-node nodes dropped or refused, lndDir/ldkNodeDir and other unknown keys stripped, string fields type-checked, and host/url/NWC fields passed through the same ValidationUtils checks the form uses. Verify by importing the crafted file above: the node must be refused or sanitised and no delete/start path may receive a non-UUID directory name.
2. Native and JS filesystem helpers concatenate a stored directory name onto a base path and perform recursive delete / mkdir / config write without confirming the result stays inside the intended wallet base directory. Fix criteria: deleteNodeDataDirectory, deleteLdkNodeWallet, getLdkNodeStoragePath, LndMobileTools.deleteLndDirectory/writeConfig/startLnd (and the iOS siblings) must accept only a single path segment matching the UUID pattern (or the legacy literal 'lnd'), and must verify the canonical path of the target is a strict child of the wallet base directory before acting. Verify that '..', '../x', 'a/b' and absolute values are rejected at every sink.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Path Traversal
**CWE:** [CWE-22](https://cwe.mitre.org/data/definitions/22.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258028

---

# Lockscreen Back header pops the lock gate after background lock re-arms

## Details
The Lockscreen is pushed on top of the normal navigation stack in an 'already-authenticated-user' mode by Security.tsx (modifySecurityScreen / deletePin / deleteDuressPin / deletePassword / deleteDuressPassword, views/Settings/Security.tsx:236-287) and by NavigationUtils.reAuthNavigation / protectedNavigation (pendingNavigation). In those modes Lockscreen.render draws a Header with leftComponent="Back" (views/Lockscreen.tsx:643-645) whose default onPress is navigation.goBack() (components/Header.tsx:45-57, default navigateBackOnBackPress=true). The header is rendered purely from the mode flags; it never checks SettingsStore.loginRequired().

When the user has enabled 'login on background' (settings.loginBackground, Security settings toggle), Wallet.handleAppStateChange sets loggedIn=false on 'background' and on 'active' calls navigation.navigate('Lockscreen') with no params (views/Wallet/Wallet.tsx:365-380). Wallet is the root of the stack and stays mounted, so this fires whatever screen is focused. If the focused screen was already a security-management Lockscreen (the owner tapped Settings > Security > Change PIN / Delete PIN / Set duress PIN, saw the 'enter existing PIN' prompt, and backgrounded the app), React Navigation 7 (@react-navigation/native 7.5.0, native-stack 7.20.0) navigate() reuses the focused same-name route and only swaps its params instead of pushing a fresh, header-less Lockscreen. The project documents and relies on exactly this behaviour at utils/LinkingUtils.ts:135-160 ('navigate() would keep the focused screen and only swap its route params, which screens that copy the request into state on mount do not pick up'). The security-management flags were copied into component state at mount (views/Lockscreen.tsx:255-276) and nothing resets them (no componentDidUpdate; the AppState handler at 309-314 only clears passphraseAttempt), so the Back header is still drawn while loginRequired() is true. (The pendingNavigation re-auth mode reads route.params at render time, so the same in-place param swap clears it and that header disappears on resume; the state-held security-management mode is the one that survives.)

Someone who then picks up the device sees a PIN/passphrase prompt with a Back arrow. One tap pops the Lockscreen and lands on Security while loginRequired() is true. Only views/Wallet/Wallet.tsx:1581/1790 and components/ModalBox.tsx:691 gate rendering on loginRequired(); Security, Settings, Menu, Wallets, WalletConfiguration, Activity, Contacts, Channels, Tools and the NWC screens are fully interactive. From there the holder can read remote-node credentials in WalletConfiguration (macaroonHex, rune, pairingPhrase fields with a plain show/hide toggle, no re-auth), browse history and contacts, send payments, create NWC connections with budgets, edit or delete wallet configurations, and turn loginBackground off. Screens behind reAuthNavigation (Seed, NWCConnectionQR) push a fresh Lockscreen that still demands the credential and remain protected. The App-level hardware-back handler (App.tsx:351-355) exits the app on back when locked and App.tsx:612-615 disables iOS swipe-back for the Lockscreen, which shows the intended behaviour; the on-screen header button is the gap neither control covers.

Assumption stated: that @react-navigation/native 7.5.0 / native-stack 7.20.0 navigate() updates the focused route of the same name in place rather than pushing a second instance. This is the documented v7 change, and the codebase's own LinkingUtils.ts comment and popTo/replace usages are written against it.

## Evidence
1. [views/Lockscreen.tsx:643–645](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Lockscreen.tsx#L643-L645)
   render() draws <Header leftComponent="Back" navigation={navigation} /> whenever isSecurityManagementFlow (state-held modifySecurityScreen / deletePin / deleteDuressPin / deletePassword / deleteDuressPassword) or route.params.pendingNavigation is set. The condition never consults SettingsStore.loginRequired(), so the back affordance stays rendered after the background lock has set loggedIn=false. This is the line the fix must change.
2. [components/Header.tsx:45–56](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/Header.tsx#L45-L56)
   BackButton's onPress calls props.navigation.goBack() when navigateBackOnBackPress is true, which is the default (line 93) and what the Lockscreen's header uses. Pressing it pops the Lockscreen directly, never passing through App.handleBackPress.
3. [views/Wallet/Wallet.tsx:365–379](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L365-L379)
   With settings.loginBackground enabled, 'background' sets SettingsStore.loggedIn=false (unless a system dialog is up) and 'active' calls navigation.navigate('Lockscreen') with no params. Wallet stays mounted at the bottom of the stack, so this listener fires regardless of which screen is focused, including when the focused screen is already a Lockscreen.
4. [views/Lockscreen.tsx:255–275](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Lockscreen.tsx#L255-L275)
   componentDidMount copies modifySecurityScreen / deletePin / deleteDuressPin / deletePassword / deleteDuressPassword from route.params into component state once. isSecurityManagementFlow (113-129) reads that state, so the Back header persists through the params swap that navigate('Lockscreen') performs on resume; no componentDidUpdate or getDerivedStateFromProps exists to reset it.
5. [utils/LinkingUtils.ts:135–159](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LinkingUtils.ts#L135-L159)
   The project's own comment documents the React Navigation 7 behaviour the bug depends on: 'navigate() only reuses an existing route when it is the currently focused one' and 'navigate() would keep the focused screen and only swap its route params, which screens that copy the request into state on mount do not pick up.' A focused security-management Lockscreen is exactly such a screen, so Wallet's resume-time navigate('Lockscreen') neither pushes a fresh header-less lock nor clears the mode held in state.
6. [views/Lockscreen.tsx:309–313](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Lockscreen.tsx#L309-L313)
   The Lockscreen's own AppState handler only clears passphraseAttempt on 'background'; it does not drop the security-management mode or convert the screen into a plain lock when the session is locked underneath it.
7. [App.tsx:351–354](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/App.tsx#L351-L354)
   The App-level hardwareBackPress handler calls BackHandler.exitApp() whenever loginRequired() is true, and App.tsx:612-615 disables the iOS swipe-back gesture for the Lockscreen: the maintainers intend that a locked session cannot be backed out of. The header Back button is a third path that neither control covers.
8. [views/Settings/Security.tsx:236–238](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/Security.tsx#L236-L238)
   Entry into the vulnerable mode: when a PIN or passphrase is set, Change PIN / Change password / Set duress PIN / Set duress password navigate to Lockscreen with modifySecurityScreen (and lines 256-287 with deletePin / deletePassword / deleteDuressPin / deleteDuressPassword). The owner leaving the app on this prompt is the pre-background state the attack needs.

## Impact
Bypassing the engaged app lock exposes everything reachable from Security/Settings/Menu without re-auth: remote-node credentials revealed by a show/hide toggle in WalletConfiguration, payment history, contacts and channel data (confidentiality high); the holder can send payments, alter node configs and create NWC connections with spending budgets (integrity high); and can delete wallet configurations, including embedded-node wallets (availability high). Only the Wallet root screen, modals, and the reAuthNavigation-gated Seed / NWC QR screens stay closed.

## Reproduction steps
1. Attacker holds the device after the owner left ZEUS on a security-management Lockscreen (Change PIN / Delete PIN / Set duress PIN or password) and the app was backgrounded with 'login on background' enabled. On resume the same Lockscreen is shown with a Back arrow; one tap pops it and the unlocked screens beneath are interactive. No credentials, no victim interaction at exploit time, nothing to defeat; but it needs physical possession plus the loginBackground setting the owner turned on and that specific pre-background screen state, hence AT:P.

## Recommended fix
1. The Lockscreen renders a back affordance based only on which mode it was opened in, not on whether the session is currently locked, so a mode intended for an already-authenticated user keeps offering goBack() after loginBackground has re-locked the session. Fix criteria: Whenever SettingsStore.loginRequired() is true, the Lockscreen must present no path off the screen other than a correct credential (or duress credential): the header Back button must not be rendered or must be inert, and goBack()/beforeRemove must be blocked. Verify by opening Change PIN, backgrounding with loginBackground on, resuming, and confirming that neither the header button nor any gesture reaches the screen beneath.
2. The background-lock resume path relies on navigate('Lockscreen') and does not reset a Lockscreen already on screen into a plain lock, so stale security-management state copied into component state at mount survives the lock. Fix criteria: On a background lock (or on resume with loginRequired() true) any Lockscreen already mounted must drop its security-management and pendingNavigation mode, or be replaced by a fresh plain Lockscreen (e.g. navigation.replace rather than navigate when the focused route is already Lockscreen); after unlocking, the user should land back where they were (or on the Wallet) rather than being granted the original privileged target. Verify that after a lock-and-resume with a security-management Lockscreen focused, Lockscreen.isSecurityManagementFlow is false until re-authentication.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-288](https://cwe.mitre.org/data/definitions/288.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258026

---

# Biometric unlock is a bare OS prompt, so any newly enrolled biometric unlocks the wallet

## Details
ZEUS's biometric unlock (Lockscreen.componentDidMount -> verifyBiometry) is a bare OS confirmation: react-native-biometrics' simplePrompt returns a boolean and the app treats `true` as full authentication, equivalent to entering the PIN or passphrase. No keystore/Secure Enclave key is created when biometrics are enabled (Security.handleBiometricsSwitchChange only runs a prompt and writes isBiometryEnabled=true), nothing is signed or decrypted by the biometric, and the enrollment state (Android: a key with setInvalidatedByBiometricEnrollment; iOS: LAContext.evaluatedPolicyDomainState) is never captured or compared.

Consequently the biometric path is satisfied by any biometric the OS currently accepts, not by the biometric that was enrolled when the owner enabled the feature. The project's own configuration shows this is not the intended design: BiometricUtils.ts constructs the prompt with allowDeviceCredentials:false, refusing to let the device passcode unlock ZEUS directly - yet the device passcode is all that is needed to enrol a new fingerprint/face in OS settings, after which the Lockscreen's automatic prompt (Lockscreen.tsx:220-247) accepts it, resets the failed-attempt counter (line 239, defeating the wipe-after-5 control at 444-449), sets loggedIn=true and proceeds to the wallet or to the pendingNavigation target. reAuthNavigation (NavigationUtils.ts:28-40) routes the Seed and NWCConnectionQR re-authentication gates through the same Lockscreen, so the unbound prompt also yields the embedded-node seed and NWC secrets. The duress PIN/passphrase is never consulted on this path.

Attacker position: someone holding the device who knows or has observed the device passcode (the well-documented shoulder-surf-then-steal pattern that motivated iOS Stolen Device Protection) but not the ZEUS PIN/passphrase, on a device where the owner opted in to ZEUS biometrics. The project's threat model places 'bypass of the PIN, passphrase or duress wipe by someone holding the unlocked or locked device' at High; only an unlocked phone with no app lock set is out of scope, and here the app lock is set.

Dependency assumption: react-native-biometrics 3.0.1 simplePrompt() is the library's non-cryptographic prompt (Android BiometricPrompt.authenticate without a CryptoObject; iOS evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics) without an evaluatedPolicyDomainState check) and therefore accepts biometrics enrolled after the fact; createSignature() is the key-bound variant and is never used. No patch in patches/ modifies the library and no first-party native code in the repository touches biometric APIs.

## Evidence
1. [utils/BiometricUtils.ts:3–42](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/BiometricUtils.ts#L3-L42)
   The ReactNativeBiometrics instance is created with allowDeviceCredentials:false (lines 3-5), i.e. the project explicitly refuses to let the device passcode satisfy the ZEUS lock. verifyBiometry (22-42) then calls rnBiometrics.simplePrompt and returns its boolean `success`. simplePrompt (react-native-biometrics 3.0.1, assumed per the library's public API: the non-cryptographic prompt, as opposed to createSignature) presents BiometricPrompt / LAContext.evaluatePolicy without a CryptoObject or keystore key and without comparing evaluatedPolicyDomainState, so the result is true for ANY biometric currently enrolled on the device, including one enrolled after ZEUS biometrics were switched on. Enrolling a biometric needs only the device passcode, so the passcode the project refused to honour directly still satisfies the lock indirectly. No app-side secret is unlocked by the biometric; the PIN/passphrase stays in the settings blob regardless, and no code in this repository calls createKeys/createSignature/biometricKeysExist or touches enrollment state.
2. [views/Lockscreen.tsx:220–246](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Lockscreen.tsx#L220-L246)
   On mount, when isBiometryConfigured() is true, a verified prompt immediately resets the failed-attempt counter, sets loggedIn=true and proceeds to the wallet (or the pendingNavigation target, including re-auth-gated screens such as Seed). The PIN/passphrase is never consulted on this path.
3. [utils/NavigationUtils.ts:25–39](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NavigationUtils.ts#L25-L39)
   reAuthNavigation is documented as requiring re-authentication before sensitive screens 'regardless of ... current session login state' and routes through the same Lockscreen, so the seed/NWC-QR re-auth gates are also satisfied by the unbound biometric prompt.
4. [views/Settings/Security.tsx:175–215](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/Security.tsx#L175-L215)
   Enabling biometrics only requires a successful prompt at that moment; no key is created and no enrollment state is recorded, so there is nothing later to detect that the set of enrolled biometrics changed.

## Impact
A successful biometric is treated as full login: the whole wallet UI, remote-node credentials, payment history and - via the same prompt satisfying reAuthNavigation - the embedded node seed are readable (confidentiality high); funds can be spent and configurations changed (integrity high); wallets can be deleted (availability high).

## Reproduction steps
1. Attacker holds the device and has the device passcode (observed or coerced) but not the ZEUS PIN/passphrase; biometric unlock must be enabled in ZEUS (opt-in). They enrol their own biometric in OS settings, open ZEUS, and the Lockscreen's automatic prompt accepts it, unlocking the wallet and also satisfying the seed re-auth gate. No ZEUS credential, no victim interaction, no defence to evade.

## Recommended fix
The biometric check is a non-cryptographic OS prompt whose boolean result is trusted as authentication, so the app cannot distinguish the owner's enrolled biometric from one enrolled later, and the biometric unlocks nothing that the PIN protects. Fix criteria: Biometric unlock must be bound to a device-keystore key created when the feature is enabled and configured to be invalidated on new biometric enrollment (or, on iOS, the stored evaluatedPolicyDomainState must match before the prompt result is honoured); a changed enrollment set must fail the biometric path and fall back to PIN/passphrase, and ideally re-enabling biometrics must require the PIN. Verify by enabling biometrics, enrolling an additional fingerprint/face, and confirming the Lockscreen no longer unlocks via biometrics until the PIN has been entered.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Weak authentication
**CWE:** [CWE-1390](https://cwe.mitre.org/data/definitions/1390.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258025

---

# LSPS0 custom-message responses accepted from any peer; empty/absent id matches unset request slots

## Details
`LSPStore.handleCustomMessages` (stores/LSPStore.ts 776-869) is the single dispatcher for every Lightning custom message the node delivers (`SubscribeCustomMessages` on embedded LND; the REST WebSocket `/v1/custommessage/subscribe` and LNC `subscribeCustomMessages` on remote LND). It is subscribed for the whole session by `initFlowLSP` (443-450) wherever `supportsLSPScustomMessage()` is true (EmbeddedLND, LND, LightningNodeConnect) and again when the LSPS1 screen mounts. Correlation to an outstanding LSPS1/LSPS7 request is done solely by `data.id === this.<requestId>`; the sender pubkey is decoded into `peer` (788) but never compared with `getLSPSPubkey()` or the persisted order's `peer`, and the message `type` is never compared with 37913. The project's own unit tests feed the dispatcher messages from peer `aa` and expect them to be accepted.

The six request-id slots are declared without initialisers (54-66), so they are `undefined` until first use, and `resetLSPS1Data`/`resetLSPS7Data` set them to `''` (175-176, 188). A JSON-RPC body with no `id` therefore satisfies `data.id === undefined` for the first never-used slot, and a body with `"id":""` satisfies the first reset slot. Concretely, on embedded LND (LSPS1 runs over custom messages there because `supportsLSPS1rest()` is false and `supportsLSPS1native` is undefined): opening the LSPS1 screen calls `resetLSPS1Data()` then `lsps1GetInfoCustomMessage()`, leaving `getInfoId` = uuid and `createOrderId` = `''` until the user presses Create order. Any connected peer that sends type-37913 `{"jsonrpc":"2.0","id":"","result":{"order_id":"x","order_state":"CREATED","lsp_balance_sat":"...","payment":{"bolt11":{"invoice":"<attacker invoice>","order_total_sat":"...","fee_total_sat":"..."}}}}` lands in the `createOrderId` branch (806-817), becomes `createOrderResponse` and clears `loadingLSPS1`. views/LSPS1/index.tsx renders any non-empty `createOrderResponse` with `result.payment` as the order (468-477) and switches the primary button to "Make payment" (1198-1281), which saves the fake order to history with `peer = getLSPSPubkey()` (LSPStore 232) and navigates to LSPPaymentAwait with `buildPaymentAwaitParams` (models/LSP.ts 51-67) taking the invoice straight from the injected `payment.bolt11.invoice`. There the attacker's invoice is shown as the QR to pay from an external wallet and fed to `handleAnything` for in-app payment (views/LSPS/LSPPaymentAwait.tsx 221-227, 304-312). The screen is branded with the configured LSP ("Olympus by ZEUS"), so the user has no cue that the order did not come from the LSP. A peer can simply emit such a message every second; the first one after get_info is sent is displayed, regardless of whether the real get_info reply has arrived.

On remote LND/LNC, LSPS1 itself uses REST, so `{"id":""}` there lands in `getInfoId` (polluting `getInfoData`); the payment-injection route on those backends is the LSPS7 slot `createExtensionOrderId`, which `resetLSPS7Data` sets to `''` on LSPS7 unmount and whose response views/LSPS7/index.tsx renders and pays the same way (669-705). Id-less bodies reach whichever slot (`getOrderId`, `getExtendableChannelsId`, `getExtensionOrderId`) is still `undefined`.

Attacker position: any Lightning peer connected to the user's node — a channel counterparty, a gossip peer embedded LND connects to (no `nobootstrap`/`nolisten` in the utils/LndMobileUtils.ts config, so LND bootstraps peers from DNS seeds and listens), or any inbound peer of a public remote node. Even when ids are populated, the lack of a peer check means the uuid is the only protection; LSPS0 expects responses only from the LSP peer.

## Evidence
1. [stores/LSPStore.ts:776–868](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L776-L868)
   Dispatcher: `peer` decoded at 788 but never checked; `type` unchecked; each branch is `data.id === this.<slot>` and on match overwrites store state (`createOrderResponse = data` at 813) that the views render as a genuine order.
2. [stores/LSPStore.ts:54–65](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L54-L65)
   Request-id slots are declared with no initial value, so an id-less message (`data.id === undefined`) matches the first slot that has never been used.
3. [stores/LSPStore.ts:168–192](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L168-L192)
   `resetLSPS1Data`/`resetLSPS7Data` set ids to `''`; a message with `"id":""` then matches, e.g. `createOrderId` while the user sits on the LSPS1 screen after get_info.
4. [views/LSPS1/index.tsx:468–476](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LSPS1/index.tsx#L468-L476)
   Any non-empty `createOrderResponse` with `result.payment` is rendered as the LSP's order, regardless of origin.
5. [views/LSPS1/index.tsx:1198–1280](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LSPS1/index.tsx#L1198-L1280)
   With a response present the button becomes "Make payment"; pressing it persists the injected order and navigates to LSPS1PaymentAwait with the injected invoice.
6. [views/LSPS/LSPPaymentAwait.tsx:221–226](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LSPS/LSPPaymentAwait.tsx#L221-L226)
   "Pay from ZEUS wallet" passes the injected invoice to `handleAnything` for payment; lines 304-312 also display it as a QR for external wallets.
7. [stores/LSPStore.ts:877–914](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L877-L914)
   Session-long subscription delivering every custom message from every peer into `handleCustomMessages`.
8. [views/LSPS1/index.tsx:81–94](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LSPS1/index.tsx#L81-L94)
   Mount sequence: `resetLSPS1Data()` (ids -> '') then `fetchGetInfo()` (getInfoId -> uuid) produces exactly the state in which `"id":""` lands in `createOrderId`.

## Impact
The user pays an attacker-controlled invoice believing it buys a channel/extension from the configured LSP; the amount is attacker-chosen within plausible LSP pricing, the funds are lost and no channel is delivered. The forged order is also persisted into order history. This defeats the destination integrity of the LSP purchase flow. No confidentiality or availability impact.

## Reproduction steps
1. Attacker is any Lightning peer connected to the victim's node: a channel counterparty, a DNS-seed bootstrap gossip peer (the embedded LND config sets neither nobootstrap nor nolisten), or an inbound peer of a public remote LND node. It repeatedly sends a type-37913 custom message with `"id":""` (or no id) carrying a fabricated LSPS1/LSPS7 order whose bolt11 invoice it controls. Dependency assumption: LND (fetch-libraries-versions.json pins embedded-lnd v0.21.4-beta-zeus.1; remote LND via REST/LNC) delivers every custom-range (>=32768) message from every connected peer to SubscribeCustomMessages subscribers together with the sender pubkey, without filtering by peer — ZEUS applies no filter of its own. When the victim opens the LSPS1 screen (embedded LND) or revisits the LSPS7 screen (any LND backend), the message is accepted as the LSP's order and shown under the LSP's branding. The victim must tap "Make payment" and then confirm the payment on the PaymentRequest screen, so active interaction is needed; the attacker also needs the victim to be on that screen with the slot in the matching state, a condition the attacker cannot force but can wait for by emitting the message continuously. No authentication or privilege on the victim's node is required.

## Recommended fix
1. Responses are correlated only by JSON-RPC id and the id slots can be `undefined`/`''`, so a message with a missing or empty id is treated as the reply to a request that was never sent. Fix criteria: A custom message must be ignored unless a request with that exact non-empty id is currently outstanding; cleared/unused slots must never compare equal to any incoming id (e.g. require `typeof data.id === 'string' && data.id.length > 0` and clear slots to a sentinel that cannot match). Verify by injecting `{"id":""}` and id-less bodies in every screen state: none may alter store state.
2. The dispatcher ignores the sender pubkey and message type, so any peer can answer LSPS0 requests addressed to the LSP. Fix criteria: Only messages whose `type` is 37913 and whose decoded `peer` equals the pubkey the request was sent to (the configured LSP pubkey, or the persisted order's `peer` for get_order polls) may be dispatched; messages from any other peer must be dropped. Verify that a correctly-id'd response from a non-LSP peer is ignored.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Origin validation error
**CWE:** [CWE-346](https://cwe.mitre.org/data/definitions/346.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258010

---

# Olympus channel-DB restore accepts server-chosen stale backup; freshness unauthenticated

## Details
restoreChannelBackupFromOlympus (called from views/Settings/SeedRecovery.tsx when the user picks 'Check Olympus for backup' while restoring a wallet from seed) migrates a live lnd channel database between devices via the ZEUS backup service (https://backups.lnolymp.us). The client authenticates to the service by signing a server-supplied challenge with the node key, then downloads an opaque blob, decrypts it with the seed-derived AES-256-GCM key, wipes `<lndDir>/data/graph/<network>` and unzips the result in place before starting lnd on it. The GCM tag guarantees that the blob was produced by a holder of this seed, but nothing guarantees it is the *latest* state: the upload places only the raw graph-dir files in the archive, with no timestamp, sequence number or associated data (Android ZipUtils.java and iOS CryptoHelper.swift both seal with no AAD), and the only freshness indicator shown to the user — `last_backup_at` in the /api/status JSON — is an unauthenticated server field. The restoring device is by construction a fresh wallet with no local reference point.

A compromised or dishonest backup server (or anyone who obtains its blob store) can therefore return any earlier upload for this pubkey while reporting a current date, and the user will approve the restore. Every upload is a snapshot of lnd's channel state at that moment; the export flow explicitly anticipates repeat uploads ('You already have a backup from {{date}}. Do you want to replace it?'), and a user who exported, then cancelled the migration lock (BalancePane 'Unlock Wallet' removes CHANNEL_MIGRATION_ACTIVE) and continued transacting before exporting again has an older blob whose commitment transactions are revoked. Starting lnd on a rolled-back channel.sqlite/channel.db is the classic toxic-state scenario: if a peer is reachable lnd's channel_reestablish data-loss detection will mark the channel borked and wait for the peer to close (in-flight HTLC state is still lost), but if the peer is offline — and in a migration from a dead device users commonly force-close 'inactive' channels, which lnd permits for channels not yet marked as data-loss — the stale commitment is broadcast and the counterparty's justice transaction claims the entire channel balance. Note that the backup service and the default LSP/channel peer (DEFAULT_LSP_MAINNET = flow.zeuslsp.com, stores/SettingsStore.ts) are both ZEUS-operated infrastructure, so the party choosing the blob can also choose to be offline at the critical moment.

The design treats the backup server as untrusted for confidentiality (hence the seed-keyed encryption) but the client silently extends it full trust for integrity-of-freshness. The upload should carry an authenticated freshness indicator inside the encrypted payload (e.g. a manifest file in the zip with upload time, node pubkey and a monotonically increasing counter, or these values as GCM associated data), the restore should display *that* value to the user instead of the server's, and refuse or at least prominently warn when the server's `last_backup_at` disagrees with it. Exploitation requires control of the backup service's responses or its stored blobs; a network attacker cannot reach this path through TLS (ReactNativeBlobUtil.fetch to an https host with default verification).

## Evidence
1. [utils/ChannelMigrationUtils.ts:545–578](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ChannelMigrationUtils.ts#L545-L578)
   The /api/restore-channels response body is written to disk and decrypted with the seed-derived key; the only check applied to the blob is the AES-GCM tag, which proves a holder of this seed once produced it but not that it is the most recent upload. This is where an authenticated freshness check must be added.
2. [utils/ChannelMigrationUtils.ts:460–509](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ChannelMigrationUtils.ts#L460-L509)
   The date shown to the user ('A channel backup from {{date}} was found') is `statusJson.last_backup_at`, an unauthenticated field of the server's /api/status JSON, so the user cannot detect a substituted older blob.
3. [utils/ChannelMigrationUtils.ts:609–624](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ChannelMigrationUtils.ts#L609-L624)
   After stopping lnd, every file in `<lndDir>/data/graph/<network>` is deleted and the decrypted archive is unzipped in its place; lnd is then started on whatever channel state the server chose to return.
4. [utils/ChannelMigrationUtils.ts:266–299](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ChannelMigrationUtils.ts#L266-L299)
   On upload the archive contains only the raw graph-dir files (zipFolder) and no timestamp, counter or node-state identifier is placed inside the encrypted payload, so nothing authenticated exists for the restoring device to compare against the server's claims.
5. [android/app/src/main/java/app/zeusln/zeus/ZipUtils.java:133–166](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/app/zeusln/zeus/ZipUtils.java#L133-L166)
   Android encryptFile wire format is [version][salt][iv][ciphertext+tag] with no associated data; GCM authenticates the bytes but binds no context (timestamp, pubkey, sequence).
6. [ios/CryptoHelper.swift:14–41](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/CryptoHelper.swift#L14-L41)
   iOS encryptData produces the same [version][salt][iv][ciphertext][tag] envelope via AES.GCM.seal with no authenticated associated data, so blobs from either platform carry no bound freshness or identity metadata.

## Impact
The authoritative channel state of the embedded node is replaced with attacker-selected stale state. Integrity is rated HIGH because this state governs which commitment transactions lnd may broadcast; realisation as fund loss depends on the peer being offline or the user force-closing before reestablish, which the attacker (as backup operator and default LSP peer) can influence. No confidentiality impact (the attacker already held the ciphertext and cannot read it); availability of the node's channels is degraded (borked channels) even in the benign outcome.

## Reproduction steps
1. Attacker controls the backup service responses (compromised server, operator, or whoever holds the stored blobs) and holds an older validly-encrypted upload for the victim's pubkey, which the service stores by design. When the victim restores a wallet on a new device and chooses 'Check Olympus for backup', the attacker returns the stale blob with a current `last_backup_at`; the client's GCM check passes and the user, seeing a plausible date, confirms the restore. Requires the victim to actively perform the migration restore and the attacker to hold server-side position.

## Recommended fix
1. The encrypted migration payload carries no authenticated freshness or identity metadata, so the client cannot distinguish the latest upload from any earlier one the server chooses to return. Fix criteria: The upload must bind an authenticated freshness indicator (timestamp and/or monotonic counter plus node pubkey) inside the GCM-protected payload or as associated data, and the restore must display that authenticated value to the user and refuse or warn when it disagrees with the server-reported date. Verify: substituting an older stored blob while reporting a newer last_backup_at is detected before the graph directory is overwritten.
2. The user-facing confirmation ('backup from {{date}}') is built from an unauthenticated server field, giving false assurance about which snapshot will be restored. Fix criteria: The confirmation shown before overwriting lnd state must be derived from authenticated data, and the UI must warn that restoring anything other than the final export can broadcast revoked state. Verify: a server returning a fabricated last_backup_at cannot cause the client to present it as the backup's own date.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Insufficient Verification of Data Authenticity
**CWE:** [CWE-345](https://cwe.mitre.org/data/definitions/345.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258009

---

# LNURL-withdraw callback fetched without scheme or private-host validation, auto-fired on scan

## Details
LNURL-withdraw (LUD-03) is redeemed by creating a local invoice and GETting the service's `callback` with `k1` and `pr`. Both implementations — `InvoicesStore.createInvoice` (stores/InvoicesStore.ts:504-512) and `CashuStore.createInvoice` (stores/CashuStore.ts:3985-3993) — build the URL from `lnurl.callback` exactly as returned by the service's first-hop JSON and fetch it with `ReactNativeBlobUtil.fetch('get', ...)`. There is no check that the scheme is https (or http only for .onion) and no check that the host is not loopback / RFC1918 / link-local / CGNAT, although `isLnurlCallbackAllowed` (utils/LnurlPayUtils.ts:256-290) implements exactly that policy, its doc comment names SSRF-by-callback and cleartext leakage as the motivating cases, it is unit-tested (utils/LnurlPayUtils.test.ts), and it is applied to the LNURL-pay callback (views/LnurlPay/LnurlPay.tsx:277) and the LNURL-auth callback (via verifyLnurlAuthCallback). The withdraw path is the one sibling that omits it.

Reachability: handleAnything.ts:952-966 routes `tag:'withdrawRequest'` to Receive (or, with ecash enabled, ChoosePaymentMethod → EcashSwipeableRow → ReceiveEcash with the same `lnurlParams`). In views/Receive.tsx:768-790 and views/Cashu/ReceiveEcash.tsx:280-294, if the user had typed an amount on the keypad before scanning, the invoice is created and the callback fetched immediately when the scan (camera or NFC) resolves — no confirmation tap. Otherwise the user taps 'Create invoice and submit to <lnurl.domain>' (Receive.tsx:2946-2990, ReceiveEcash.tsx:876-888); `lnurl.domain` is derived by js-lnurl from the first-hop URL, so the button names the attacker's public host while the request actually goes to the service-chosen callback host, which the user never sees.

Attack: a withdraw QR / deep link / NFC tag / clipboard value whose first hop returns `{tag:'withdrawRequest', callback:'http://192.168.1.1/...', k1:'...', minWithdrawable:1000, maxWithdrawable:1000, defaultDescription:'...'}` makes the phone GET an attacker-chosen internal or cleartext URL (attacker controls path and existing query; the app appends k1 and the user's freshly created bolt11). A non-JSON response body is shown to the user in an alert (`reason: response.text()`) but is not returned to the attacker. Effect: blind GET SSRF/CSRF from the phone into the user's LAN or loopback services, and cleartext disclosure of the user's invoice (which embeds the node pubkey and amount) to on-path observers.

Dependency assumptions (packages not installed in this checkout): js-lnurl 0.6.0 `getParams` returns the service's `callback` unmodified for withdrawRequest and derives `domain` from the first-hop URL; react-native-blob-util 0.25.1 `fetch` issues the request to whatever http/https URL it is given with no private-host filtering.

## Evidence
1. [stores/InvoicesStore.ts:504–512](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/InvoicesStore.ts#L504-L512)
   createInvoice posts the freshly created invoice: it parses the service-supplied lnurl.callback, appends k1 and pr, and fetches it with ReactNativeBlobUtil.fetch with no scheme/host check.
2. [stores/CashuStore.ts:3985–3993](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L3985-L3993)
   The ecash sibling performs the identical unvalidated fetch of lnurl.callback with k1 and pr.
3. [views/Receive.tsx:768–789](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L768-L789)
   When an amount was entered before scanning, validateAddress calls createUnifiedInvoice with the lnurl params immediately after handleAnything resolves, so the callback is fetched with no further tap.
4. [views/Cashu/ReceiveEcash.tsx:280–293](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/ReceiveEcash.tsx#L280-L293)
   Same scan-triggered auto-redeem path for the ecash receive screen.
5. [utils/LnurlPayUtils.ts:256–290](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LnurlPayUtils.ts#L256-L290)
   isLnurlCallbackAllowed is the existing control that blocks cleartext and private/loopback/link-local callback targets; it is only called from LnurlPay and LnurlAuth, never on the withdraw path.

## Impact
Blind GET into loopback/LAN/link-local infrastructure with attacker-chosen path and query (low integrity), and cleartext disclosure of the user's invoice and node pubkey (low confidentiality). No fund loss; no availability impact.

## Reproduction steps
1. Attacker publishes an LNURL-withdraw (QR, deep link, clipboard) that resolves to their server. When the user scans it from the Receive screen with an amount pre-entered, the callback is fetched automatically; otherwise one tap. The service JSON fully controls the callback URL; no defenses are in the path on default configuration.

## Recommended fix
Both withdraw implementations trust the service-supplied callback URL for scheme and host, allowing the service to direct the phone at cleartext or internal endpoints; the existing callback policy is not applied. Fix criteria: Before the k1/pr GET in both InvoicesStore and CashuStore, reject cleartext http to non-onion hosts and any loopback/private/link-local/CGNAT target, fail with a localized error, and issue no request. Verify by presenting a withdrawRequest whose callback is http://169.254.169.254/x or http://10.0.0.1/x and confirming no request leaves the device on either the lightning or ecash path.

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
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258008

---

# LND REST WebSocket subscriptions bypass Tor and leak node identity on every wallet fetch

## Details
ZEUS lets a remote-LND wallet set enableTor (WalletConfiguration.tsx 'Use Tor' switch, persisted per node and loaded into SettingsStore.enableTor) so that traffic to the user's node is routed through the bundled Tor client (react-native-nitro-tor). LND.request passes enableTor into LND.restReq, which sends every REST call through doTorRequest (RnTor.httpGet/httpPost/httpDelete over the embedded SOCKS/Tor daemon). The four WebSocket helpers in backends/LND.ts — subscribeCustomMessages (316), initChanAcceptor (865), openChannelStream (496) and wsReq (153) — do not read enableTor at all: they build wss://<host>:<port>/... via getURL(..., ws=true) from the same node config and hand it, with the Grpc-Metadata-Macaroon header, to the global React Native WebSocket. No first-party native code under android/app/src/main/java or ios/ installs an OkHttp/NSURLSession proxy, so the socket uses the device's normal network stack and the system resolver.

Two of these are opened automatically. stores/LSPStore.ts initFlowLSP (called unconditionally from views/Wallet/Wallet.tsx getSettingsAndNavigate on every wallet fetch) calls this.subscribeCustomMessages() and this.initChannelAcceptor(); for implementation 'lnd' these dispatch through BackendUtils to LND.subscribeCustomMessages and LND.initChanAcceptor. The same function deliberately skips the Flow LSP HTTP request for remote LND when enableTor is set because it 'would send the device IP to the Flow host on every startup (#4372)', but the WebSocket connections that follow are outside that gate. keepSocket releases the slot on error/close, so a socket that fails (e.g. unresolvable .onion) is re-attempted on the next fetch.

Consequences for a user who enabled Tor for their node:
- Clearnet host (VPS/IP with a CA-signed cert): the device opens an authenticated wss connection directly to the node on every startup/refresh, revealing the user's real IP to the node host and any on-path observer and correlating the device with that node. The property the Tor setting exists to provide is defeated, and the socket stays open for the session.
- .onion host: the WebSocket cannot be routed, but before failing the platform resolver is asked to resolve the .onion name, disclosing the user's hidden-service address to the local DNS resolver/ISP (RFC 7686 leak), repeated on every fetch because keepSocket releases the slot on error.

The macaroon is sent only after a TLS handshake (RN WebSocket verifies certificates), so a passive observer does not obtain credentials; the impact is de-anonymisation of the wallet/node pair. The project treats exactly this as a leak: SECURITY.md lists 'traffic that bypasses Tor when Tor is enabled' as a privacy leak of particular interest, and utils/ClinkUtils.ts refuses onion relays because 'WebSocket-over-Tor is not currently supported' rather than silently leaking. openChannelStream (PSBT channel funding) and wsReq share the defect on user action.

Assumptions (dependencies not vendored in this checkout): React Native 0.87.1's WebSocket implementation (OkHttp on Android, NSURLSession on iOS) uses the platform resolver and no proxy unless one is configured natively, which this repository does not do; react-native-nitro-tor 0.6.1 exposes only HTTP request helpers (httpGet/httpPost/httpDelete) as used in utils/TorUtils.ts, with no WebSocket transport.

## Evidence
1. [backends/LND.ts:316–330](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L316-L330)
   subscribeCustomMessages builds wss://host:port/v1/custommessage/subscribe from the node config and opens it with the global React Native WebSocket directly. settingsStore.enableTor is never read; there is no SOCKS/Tor routing. The macaroon is attached as a Grpc-Metadata-Macaroon header.
2. [backends/LND.ts:865–879](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L865-L879)
   initChanAcceptor opens wss://host:port/v1/channels/acceptor the same way, with the macaroon header and no Tor routing.
3. [backends/LND.ts:49–65](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L49-L65)
   By contrast restReq honours useTor (enableTor) by sending every REST call through doTorRequest. Only the WebSocket paths are exempt, so a wallet configured for Tor gets Tor for REST and clearnet for the subscriptions.
4. [stores/LSPStore.ts:443–453](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L443-L453)
   initFlowLSP calls subscribeCustomMessages() (LND supportsLSPScustomMessage() is true) and initChannelAcceptor() unconditionally for remote LND, outside the enableTor gate the function applies to the Flow LSP HTTP request a few lines above.
5. [stores/LSPStore.ts:412–422](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L412-L422)
   The project's own comment (#4372) records that remote LND over Tor must skip clearnet startup requests because they send the device IP out on every startup; the WebSocket subscriptions opened right after were not given the same treatment.
6. [stores/LSPStore.ts:602–613](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L602-L613)
   keepSocket releases the slot on error/close, so a failed socket (e.g. unresolvable .onion) is re-attempted on the next fetch, repeating the leak.
7. [views/Wallet/Wallet.tsx:1446](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L1446)
   initFlowLSP runs on every wallet fetch, so the direct WebSocket connection attempt happens automatically at startup and on every refresh, not only on user action.
8. [backends/LND.ts:496–498](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L496-L498)
   openChannelStream (PSBT channel funding, user-initiated) and wsReq (153-165, currently uncalled) use the same direct WebSocket pattern and share the defect.

## Impact
Confidentiality: the user's real IP is linked to their Lightning node (clearnet host), or the .onion address of their node is disclosed to the resolver/ISP; this is the privacy property Tor mode promises and that the project's own #4372 fix protects for the Flow HTTP request. No credential disclosure (TLS verified before the macaroon header is sent) and no effect on integrity or availability of funds.

## Reproduction steps
1. The observer is the remote node's host, the device's DNS resolver/ISP, or any passive on-path party between the phone and the node — precisely the parties the user enabled Tor to hide from. No action by them is required: with enableTor set on a remote LND wallet, every wallet fetch (startup and each refresh) opens a direct WebSocket to a clearnet host or a system DNS lookup of the .onion name. The user does nothing beyond opening the app. attack_requirements is PRESENT because the leak occurs only for wallets configured with Tor enabled (the protected configuration) and the observer must be positioned at the node host, resolver or network path.

## Recommended fix
1. The WebSocket helpers in LND.ts ignore settingsStore.enableTor and use the direct platform WebSocket, so a Tor-only node configuration is not honoured for streaming endpoints. Fix criteria: When enableTor is set (or the host is a .onion), no direct WebSocket or system DNS lookup to the node host may occur: either route the subscription over Tor or refuse to open it (and surface that the feature is unavailable over Tor). Verified by confirming that with enableTor set, startup/refresh of a remote LND wallet produces no non-Tor connection or DNS query to the node host.
2. LSPStore.initFlowLSP applies its Tor gate only to the Flow HTTP request and still opens the custom-message and channel-acceptor sockets for remote LND over Tor on every fetch. Fix criteria: The automatic subscriptions are skipped (or Tor-routed) under the same condition that skips getLSPInfo, so no clearnet connection is attempted on startup for Tor-enabled remote LND wallets.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Information exposure
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258007

---

# BOLT11 decoder keeps last duplicate tag, bypassing swap and LSP payment-hash binding

## Details
Bolt11Utils.decode (utils/Bolt11Utils.ts:186-235) walks the tagged fields and, for each occurrence, overwrites result.payment_hash, description_hash, payment_secret, description and destination. It never checks the field's data_length and never rejects duplicates. BOLT11 requires a reader to skip p/h/s/n fields whose data_length is not 52/52/52/53 and says a payer SHOULD use the FIRST p field it did not skip. Assumption about external components (not in this checkout): LND's zpay32 decoder keeps the first p field and ignores later ones, Core Lightning's bolt11.c treats a second p as an unknown field, and LDK's lightning-invoice rejects an invoice with multiple payment hashes. Under that behaviour, for an invoice carrying two well-formed p fields an LND- or CLN-based payer (embedded Lndmobile, remote LND REST, CLNRest, LNC, LndHub, NWC) pays to the FIRST hash while ZEUS compares the LAST; an embedded LDK Node refuses to pay, which only makes the attack fail there.

Two shipped verifiers rely on the decoded payment_hash to protect funds from a third-party server, and both are circumvented by the same ambiguous invoice:

1. Reverse swaps (utils/SwapUtils.ts:35-61, called from stores/SwapStore.ts:630). ZEUS chooses the preimage, sends only its hash to the swap host (Boltz protocol; default or custom host) and the host returns a hold invoice. The check exists, per its own comment, so a malicious host cannot return "an invoice paying itself with an unrelated payment hash". A malicious host returns an invoice whose first p field is H_host (host knows the preimage) and whose last p field is sha256(user preimage), signed with its own key. verifyReverseSwapInvoice passes, the swap is saved, and SwapDetails (views/Swaps/SwapDetails.tsx:1265-1271, qrCodeValue = invoice) hands the string to handleAnything -> PaymentRequest, where the user's node pays to H_host. The host settles immediately with its own preimage and never has to lock up on-chain; the user's lightning funds are gone and the user's preimage claims nothing.

2. Flow 2.0 wrapped invoices (utils/LspUtils.ts:50-55, called from stores/LSPStore.ts:693). The LSP's jit_bolt11 is verified to carry the same payment hash as the user's inner invoice so the LSP cannot settle the payer's HTLC without forwarding. With first p = H_lsp and last p = H_user, the check passes, InvoicesStore (stores/InvoicesStore.ts:483-487, 546-549) substitutes the wrapped invoice for the user's own as the receive invoice, the payer's node pays H_lsp, and the LSP keeps the payment while the user is never paid.

The same last-wins reading applies to description_hash, so the LUD-06 metadata binding in utils/LnurlPayUtils.ts can be satisfied by a trailing matching h field while the effective (first) h commits to something else; impact there is limited to the proof-of-payment commitment.

The attacker is the operator of the swap host or Flow-2 LSP the user has selected (both listed adversaries in the threat model: 'Boltz-protocol swap providers, LSPs'); the project's own guards and comments show it does not concede unrelated-hash invoices to these servers. No ZEUS privilege is needed; the user performs an ordinary swap or Flow-2 receive.

## Evidence
1. [utils/Bolt11Utils.ts:186–234](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/Bolt11Utils.ts#L186-L234)
   The tagged-field loop assigns result.payment_hash (line 209), description_hash, payment_secret, description and payee on every occurrence of the tag, so the LAST occurrence wins. It never checks data_length (BOLT11 requires readers to skip p/h/s fields that are not 52 words and n fields that are not 53) and never rejects duplicates. BOLT11 says a payer SHOULD use the FIRST p field it did not skip, so ZEUS's view of an invoice's payment hash can differ from the node that pays it.
2. [utils/SwapUtils.ts:35–61](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/SwapUtils.ts#L35-L61)
   verifyReverseSwapInvoice is the only guard binding the host-supplied reverse-swap invoice to sha256(our preimage); it compares decoded.payment_hash (the last p tag) with the expected hash. The amount check reads the HRP and is unaffected.
3. [stores/SwapStore.ts:625–647](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L625-L647)
   Call site: the swap host's JSON response `invoice` is checked with verifyReverseSwapInvoice; on success the swap is saved and SwapDetails is opened with it.
4. [views/Swaps/SwapDetails.tsx:1265–1271](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L1265-L1271)
   The 'Pay invoice' button passes swapData.qrCodeValue (models/Swap.ts:132-140 returns `invoice` for reverse swaps) to handleAnything -> PaymentRequest, so the user's node pays exactly the host-authored string; the node applies first-p semantics.
5. [utils/LspUtils.ts:50–55](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LspUtils.ts#L50-L55)
   verifyWrappedInvoice binds the LSP's jit_bolt11 to the user's inner invoice by comparing decoded payment_hash values; the same last-tag reading lets a wrapped invoice whose first (effective) p tag is LSP-controlled pass.
6. [stores/LSPStore.ts:693–708](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L693-L708)
   Call site: on a passing check the LSP's jit_bolt11 is resolved to InvoicesStore.
7. [stores/InvoicesStore.ts:483–486](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/InvoicesStore.ts#L483-L486)
   The resolved jit_bolt11 replaces the user's own invoice as the payment request shown/sent to the payer (also lines 508 and 546-549), so the payer's node pays the LSP-chosen first p hash.

## Impact
The guard that keeps the reverse swap atomic is defeated: the user's node pays a lightning invoice whose effective payment hash is controlled by the host, which never has to lock up on-chain, so the swapped lightning funds are lost. In the LSP case the payer's payment to the user is captured by the LSP. Loss of funds / destination substitution is an integrity impact on the wallet's payment authority; no confidentiality or availability effect.

## Reproduction steps
1. Attacker: operator of (or whoever has compromised) the reverse-swap host or Flow-2 LSP the user has selected; the request is ordinary HTTPS JSON, so no on-path position is needed. Delivery: the normal JSON response carrying `invoice` / `jit_bolt11`. Steps: craft a bech32-valid invoice with two 52-word p fields (first = attacker hash, last = expected hash), sign it with any key, return it. verifyReverseSwapInvoice / verifyWrappedInvoice pass; the user then taps Pay invoice (swap) or shares the invoice with a payer (LSP). Requirements outside the attacker's control: the user must be running a swap or Flow-2 receive against that host, and the paying node must apply first-p semantics (assumed for LND/CLN-based backends; LDK Node is assumed to reject duplicates, which defeats the attack there).

## Recommended fix
1. The tag loop in Bolt11Utils.decode overwrites each named field on every occurrence, so the last duplicate tag wins, whereas BOLT11 and the nodes that pay the invoice use the first unskipped occurrence. Fix criteria: For p, h, s, n, d, x and c fields the decoder must use the first well-formed occurrence and ignore later ones (or fail the decode on duplicates of p/h/s/n). An invoice carrying two 52-word p fields must yield the same payment_hash in Bolt11Utils.decode as LND/CLN would pay to, and verifyReverseSwapInvoice / verifyWrappedInvoice must reject the invoice described above.
2. Bolt11Utils.decode does not validate data_length for p/h/s (52 words) and n (53 words), so a wrong-length field that a node would skip is still taken as the value ZEUS compares against. Fix criteria: Fields p/h/s/n with a data_length other than 52/52/52/53 must be skipped exactly as the spec requires, so the decoder's payment_hash is never derived from a field the paying node ignores; add tests with wrong-length and duplicate p/h fields asserting the chosen value.
3. Security-critical verifiers (SwapUtils.verifyReverseSwapInvoice, LspUtils.verifyWrappedInvoice) trust a single hash from a lenient decoder with no fail-closed handling of ambiguity. Fix criteria: Verifiers must treat an invoice with more than one p (or h) field, or with any skipped malformed p/h/s/n field, as invalid, so an ambiguous invoice can never pass the binding check regardless of which occurrence the decoder picks.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Interpretation conflict
**CWE:** [CWE-436](https://cwe.mitre.org/data/definitions/436.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258005

---

# POS-mode Receive 'Go to LSP settings' bypasses lock; LSP host change re-points zero-conf trust to attacker node

## Details
ZEUS POS mode runs unauthenticated (Wallet.tsx:477-492 activates POS at cold start; Lockscreen.tsx:193-213 waives the PIN while posStatus is 'active' and no pendingNavigation is carried) and relies on every exit from the POS screens going through protectedNavigation (utils/NavigationUtils.ts:5-23) so the owner's PIN is demanded before any wallet-management screen. The POS checkout screen is views/Receive.tsx (Order.tsx:1316 and PosStore.processCheckout navigate to 'Receive'). It renders a 'Go to LSP Settings' button (1604-1620) with a bare navigation.navigate('LSPSettings') whenever LSPStore.showLspSettings is set, state.lspIsActive is true and selectedIndex is 0/1 - true by default on embedded LND and LDK Node (enableLSP defaults true at SettingsStore.ts:1660; local wallets are never 'not configured' at NodeInfoStore.ts:185-190; POS defaults to the unified/lightning index). showLspSettings is set by getLSPInfo's fetch .catch on any connection failure to the Flow host (LSPStore.ts:396-408), on the geoblock reply (387-391) and on an access-key proposal error (717-722); a later successful getLSPInfo does not clear it. initFlowLSP runs on every Wallet fetch (Wallet.tsx:1446; POS-mode refreshes fire on AppState 'active' and on settings changes), and the flag is cleared only by LSPStore.reset()/resetFee() (connect time, Receive unmount) or when getZeroConfInvoice starts (636). A terminal holder therefore reaches the button by cutting the device's network (airplane mode) before a Wallet refresh and keeping it cut through the checkout: invoice creation then stops at getZeroConfFee's failure (InvoicesStore.ts:435-438) before getZeroConfInvoice would clear the flag, and Receive shows the 'Could not connect to LSP' error with the button beneath it. Where the Flow host is down or geoblocks the merchant, the button is present on every checkout with no action by the holder.

views/Settings/LSP.tsx (registered as a plain Stack.Screen at App.tsx:1297) has no lock check: it persists a new Flow host and access key on every keystroke (235-281), shows the owner's existing lspAccessKey in clear, and toggles enableLSP/requestSimpleTaproot. The host is not cosmetic: getLspConfigForNetwork resolves flowHost from settings.lspMainnet (SettingsStore.ts:1426), LSPStore.getLSPInfo (324-376) fetches `${host}/api/v1/info`, stores the reply as this.info and dials info.pubkey at the advertised address on every fetch (connectPeer with perm=false, connect-only, silent). The embedded-LND channel acceptor (LSPStore.ts:527-545) and the remote-LND acceptor (LND.ts:904-912 via getLspPubkey) grant zero-conf acceptance to exactly that pubkey, and the embedded lnd.conf enables protocol.zero-conf and option-scid-alias (LndMobileUtils.ts:312-313). Every subsequent POS invoice is also wrapped by the new host (InvoicesStore.ts:397-435, 476-501); verifyWrappedInvoice binds the payment hash and bounds the fee, so the attacker LSP cannot keep a customer's payment without forwarding it - but it forwards it over its own unconfirmed channel.

Attack: staff or anyone handed the terminal opens LSP settings from the POS Receive error state, points the Flow host at their own server (which returns their node's pubkey/address) and restores the network. On the next Wallet refresh the merchant node dials the attacker and the acceptor will admit zero-conf channels from them. The attacker then opens a zero-conf channel to the merchant node and pays POS invoices through it (or, as the wrapping LSP, forwards real customers' payments over it). The merchant's invoice settles, watchInvoicePaid fires, Receive.handlePaymentReceived records the order paid (873-893, 821-856) and goods are handed over; the attacker never confirms (or double-spends) the funding transaction. Backends: embedded LND is affected by default; remote LND only when the owner enabled certVerification and the node advertises zero-conf+scid-alias (NodeInfoStore.ts:177-190), since otherwise lspIsActive is false and the button does not render; LDK Node shows the button and has its invoice wrapping and access key redirected, but its trusted 0-conf peers are pinned at startup to lspConfig.defaultPubkey/lsps1Pubkey (Wallet.tsx:720-731), so the fake-payment leg does not apply there.

Secondary effects: the owner's LSP access key is disclosed, the node's pubkey and traffic are routed to the attacker's server on every fetch, and the attacker LSP can withhold wrapped proposals (POS denial of service). Root cause: a POS-reachable screen navigates to an owner-settings screen without protectedNavigation, and the LND zero-conf trust anchor is derived from a user-editable URL rather than pinned. Distinct from the verified WalletHeader records and from the verified Receive.tsx:1923 'Advanced' tab record: different entry point (the LSP error button) and a different sink (LSP host / zero-conf trust).

## Evidence
1. [views/Receive.tsx:1604–1620](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L1604-L1620)
   The 'Go to LSP Settings' Button calls navigation.navigate('LSPSettings') directly. It renders whenever LSPStore.showLspSettings && state.lspIsActive && selectedIndex is 0 or 1 - no posStatus check and no protectedNavigation, and it is outside the haveInvoice branch so it shows even while/after invoice creation fails.
2. [views/Receive.tsx:326–334](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L326-L334)
   lspIsActive = (settings.enableLSP || forceLsp) && supportsFlowLSP() && !flowLspNotConfigured && !onChainOnly. enableLSP defaults true (SettingsStore.ts:1660); embedded LND/LDK are never 'not configured' (NodeInfoStore.ts:185-190); EmbeddedLND/LND/LdkNode return supportsFlowLSP true. In POS mode lnOnly forces selectedIndex=1 (466-470), satisfying the index condition.
3. [stores/LSPStore.ts:396–407](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L396-L407)
   getLSPInfo's fetch .catch sets showLspSettings = true on any connection failure to the Flow host (also on the geoblock reply at 387-391 and on an 'access key' proposal error at 717-722). The flag is only cleared by reset()/resetFee() (125-145, 160-166) or when a proposal request starts (636).
4. [stores/LSPStore.ts:423–453](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L423-L453)
   initFlowLSP runs getLSPInfo on every Wallet fetch when enableLSP is set (Wallet.tsx:1446, including POS mode), and initChannelAcceptor. Wallet.tsx:652-661 calls LSPStore.reset() only while `connecting`, so a failure flag set on a later focus/AppState refresh persists into the next POS checkout. The terminal holder can induce the failure by cutting the device's network before a refresh.
5. [views/Settings/LSP.tsx:235–280](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/LSP.tsx#L235-L280)
   The LSP screen persists a new Flow host (lspMainnet/lspTestnet/lspMutinynet) and lspAccessKey on every keystroke via updateSettings, displays the existing access key in clear, and offers the enableLSP (191-201) and requestSimpleTaproot toggles. No posStatus, protectedNavigation or reAuthNavigation anywhere in the file.
6. [stores/LSPStore.ts:324–375](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L324-L375)
   getLSPInfo fetches `${getFlowHost()}/api/v1/info` from the configured host (flowHost = settings.lspMainnet || default, SettingsStore.ts:1426), stores the whole reply as this.info (including pubkey) and dials info.pubkey at the advertised address via connectPeer(perm=false, connectPeerOnly, silent) on every Wallet fetch - so after the host change the merchant node connects to whatever pubkey the attacker's server returns, and that pubkey becomes the acceptor's zero-conf trust anchor. A later successful reply does not clear showLspSettings.
7. [stores/LSPStore.ts:527–544](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L527-L544)
   Embedded LND channel acceptor: isZeroConfAllowed = this.info?.pubkey === requestPubkey || zeroConfPeers.includes(...). The LSP pubkey used for zero-conf trust is the one fetched from the (now attacker-controlled) Flow host, not a pinned value. Remote LND does the same via getLspPubkey() in backends/LND.ts:904-912.
8. [utils/LndMobileUtils.ts:312–313](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LndMobileUtils.ts#L312-L313)
   The embedded lnd.conf enables protocol.option-scid-alias and protocol.zero-conf, so zero-conf channels accepted by the acceptor are usable for HTLCs immediately, before the funding transaction confirms.
9. [views/Wallet/Wallet.tsx:720–730](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L720-L730)
   Contrast: for LDK Node the trusted 0-conf peer list is pinned to lspConfig.defaultPubkey (hard-coded) plus the configured LSPS1 pubkey, never to a host-fetched value. The LND paths have no such pin, so the host field alone decides who may open unconfirmed channels to the merchant.
10. [stores/InvoicesStore.ts:397–434](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/InvoicesStore.ts#L397-L434)
   Every POS invoice (value != '0', LSP enabled) is routed to the configured host: connectPeer to info.pubkey, getZeroConfFee, and the invoice is reduced by the quoted fee; getZeroConfInvoice (476-501) then returns the wrapped invoice shown on the POS QR. verifyWrappedInvoice (utils/LspUtils.ts:50-75) binds the hash and bounds the amount, so the attacker LSP cannot keep the payment without forwarding - which it does over its own zero-conf channel.
11. [views/Receive.tsx:873–892](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L873-L892)
   The POS screen marks the order paid as soon as BackendUtils.watchInvoicePaid reports settlement and calls handlePaymentReceived -> PosStore.recordPayment (821-856). An HTLC settled over an unconfirmed channel opened by the attacker satisfies this; nothing checks that the funds are in a confirmed channel.
12. [utils/NavigationUtils.ts:5–22](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NavigationUtils.ts#L5-L22)
   protectedNavigation is the only POS exit gate (Lockscreen with pendingNavigation when posStatus==='active' and a PIN/passphrase exists). Lockscreen.tsx:193-213 waives authentication in POS mode otherwise, and Wallet.tsx:477-492 boots POS unauthenticated, so a raw navigate from a POS-reachable screen is a full bypass.

## Impact
Integrity: the LSP host, access key and enable flag are rewritten without the PIN; the merchant node then trusts the attacker's pubkey for zero-conf channels and routes every POS invoice through the attacker's wrapping server, letting the attacker produce 'Paid' POS receipts backed by an unconfirmed, double-spendable channel and intercept real customer payments - payment-state truthfulness, a named asset, is defeated. Confidentiality: the owner's lspAccessKey is shown in clear and the node pubkey/IP are handed to the attacker host. Availability: an attacker LSP can withhold or fail wrapped payments, stalling POS checkout.

## Reproduction steps
1. Attacker is whoever operates the POS terminal without the owner's PIN (staff or a customer handed the device) - the position the project fences with protectedNavigation and the PointOfSale settings 'Warning: no password or PIN set' notice. Preconditions: POS enabled with a PIN or passphrase; embedded LND with the Flow LSP enabled (default) so lspIsActive is true (remote LND only with certVerification on and a zero-conf-capable node; LDK Node for the settings/access-key leg only); and LSPStore.showLspSettings set - which the holder induces by cutting network (airplane mode) before a Wallet refresh and through the checkout so getZeroConfInvoice never clears it, or which is present on every checkout where the Flow host is down or geoblocks. One tap opens LSP settings; typing a URL persists it. The zero-conf fake-payment leg needs the attacker to run a Lightning node and a server answering /api/v1/info, /fee and /proposal - ordinary tooling, no defence to defeat.

## Recommended fix
1. Receive.tsx's 'Go to LSP Settings' button navigates with a raw navigation.navigate while posStatus is 'active', bypassing the Lockscreen gate every other POS exit uses. Fix criteria: While posStatus === 'active' and a login method is configured, the LSP settings button must either be hidden or route through protectedNavigation so a Lockscreen with pendingNavigation appears first. Verify in POS mode with a PIN set and showLspSettings true: tapping the button must demand the PIN, a wrong PIN must not proceed, and the LSP screen must not be reachable from Receive otherwise.
2. LSP.tsx persists host/access-key/enable changes with no re-authentication, and the LND channel acceptors derive zero-conf trust from the pubkey fetched from that editable host rather than a pinned or explicitly confirmed value. Fix criteria: Editing the Flow host must require re-authentication (reAuthNavigation or equivalent) and/or the zero-conf acceptor must only trust a pinned default pubkey plus explicitly whitelisted zeroConfPeers, as LDK Node already does; a host change must not silently add a new pubkey to the zero-conf trust set. Verify by pointing the host at a test server returning a different pubkey: that pubkey must not be granted zero-conf acceptance without the owner's explicit, authenticated confirmation.

---
**Severity:** LOW
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-288](https://cwe.mitre.org/data/definitions/288.html)
**Attack vector:** PHYSICAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258395

---

# Duress wipe re-arms keychain desync migration whose raw writes bypass the wipe latch

## Details
clearAllData() (duress PIN/passphrase and repeated-failed-login wipes in views/Lockscreen.tsx, Tools > Clear storage) relies on Storage.blockWrites() to stop the still-running JS context from re-persisting wiped data until restartApp() lands. The latch is consulted only in Storage.setItem (storage/index.ts:104-108). On iOS a second keychain writer sits outside it: MigrationUtils.keychainDesyncMigration (utils/MigrationUtils.ts:1491-1570) copies every synchronizable `zeus:*` item that has no device-local twin into the local partition through setRawLocalItem (storage/index.ts:54-64), a raw Keychain.setInternetCredentials with no latch check.

The wipe re-arms that migration before it finishes deleting the keychain. Step 6 (utils/DataClearUtils.ts:960-969) runs EncryptedStorage.clear(), deleting the `keychain-desync-v1` flag, and MigrationUtils.clearConfirmedFlags(), dropping the in-process 'true' cache (MigrationUtils.ts:124-138); from then on readFlag returns null and the migration runs on the next getSettings(). Step 8 clearKeychainEntries (DataClearUtils.ts:287-307) enumerates and deletes the device-local partition server by server, each an awaited native call, and only afterwards enumerates and deletes the synchronizable partition. Any getSettings() that starts after step 6 runs keychainDesyncMigration concurrently on the same JS thread: for every zeus:* server already removed from the local partition but not yet removed from the synchronizable one, getRawItem(server,false) is null, getRawItem(server,true) returns the value and setRawLocalItem re-creates the local item. The local sweep has already passed that server and never revisits it; the sync sweep then deletes only the synchronizable copy; restartApp() on iOS is RNRestart.Restart(), a JS reload (utils/RestartUtils.ts:43-49), which resets the latch but leaves the keychain intact. After the reload getSettings reads the resurrected `zeus:zeus-settings-v2` (every wallet config: aezeed/BIP39 mnemonics, macaroons, runes, LNC pairing, PINs and duress PINs) from the local partition and the app boots into the pre-wipe wallet; any other resurrected item (`zeus:<pubkey>-extended-private-keys`, `zeus:<lndDir>-cashu-seed`, Cashu/LNC keys) stays in the device keychain.

getSettings() is reachable without the wipe's cooperation: App.tsx's AppState handler (384-398) awaits settingsStore.getSettings() on every 'background' transition, so the phone holder pressing Home, taking a call or letting the screen lock during the tens-of-seconds wipe starts the migration; and every queued updateSettings runs getSettings(true,true) inside applySettingsUpdate (stores/SettingsStore.ts:2367) before the latched setSettings, so the async writers the maintainers themselves observed landing ~20 ms after the wipe (DataClearUtils.ts:873-878) also enter it. The duress screen (Lockscreen.tsx:523-547, 625-639) blocks back navigation and gestures but cannot block backgrounding, and nothing in getSettings or the migration checks that a wipe is in progress.

Precondition: zeus:* items exist in the synchronizable partition at wipe time. Every pre-patch install (react-native-keychain 10.0.0 wrote all zeus:* data synchronizable before patch-keychain-cloudsync.mjs) is in that state on its first patched launch: the desync migration copies to local during startup getSettings, but autoPurgeLegacyKeychain is fired only from Wallet.getSettingsAndNavigate after the lockscreen is passed (views/Wallet/Wallet.tsx:525-528), so at that first post-upgrade lockscreen, and on any install whose purge was deferred (preflight 'missing-settings'/'copy-failed') or failed, the full set including the settings blob is still synchronizable. Purged installs retain the stranded sole-copy items (xprv cache, legacy Cashu seed bytes; see keychain-autopurge-strands-icloud-xprv-cache-after-local-delete), which this race likewise copies back.

The same unlatched-writer gap applies to Storage.removeItem (storage/index.ts:132-139) and KeychainPurgeUtils.verifyPurgePreflight's setRawLocalItem (utils/KeychainPurgeUtils.ts:299); no asynchronous trigger for those during the wipe window was found.

Assumed dependency behaviour (react-native-keychain 10.0.0 with the project's cloudSync patch applied): setInternetCredentials without a cloudSync option writes kSecAttrSynchronizable=false; getInternetCredentials with { cloudSync: true } queries only the synchronizable partition; react-native-restart 0.0.29 on iOS reloads the JS bundle rather than terminating the process.

## Evidence
1. [storage/index.ts:54–64](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/storage/index.ts#L54-L64)
   setRawLocalItem writes straight to Keychain.setInternetCredentials. Unlike Storage.setItem (lines 104-108) it never consults the writesBlocked latch that clearAllData engages, so it can re-create device-local keychain items during and after the wipe's final sweep.
2. [utils/MigrationUtils.ts:1491–1570](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/MigrationUtils.ts#L1491-L1570)
   keychainDesyncMigration enumerates every synchronizable zeus:* server; for each whose local copy is missing (getRawItem(server,false) === null) but whose sync copy exists, it calls setRawLocalItem(server, syncValue). It runs whenever readFlag(KEYCHAIN_DESYNC_KEY) is not 'true' and has no wipe-in-progress check.
3. [utils/DataClearUtils.ts:960–969](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/DataClearUtils.ts#L960-L969)
   Step 6 clears EncryptedStorage (deleting the keychain-desync-v1 flag) and calls MigrationUtils.clearConfirmedFlags(), re-arming keychainDesyncMigration BEFORE step 8 deletes the keychain. Any getSettings() after this point runs the migration against a half-deleted keychain.
4. [utils/DataClearUtils.ts:287–307](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/DataClearUtils.ts#L287-L307)
   clearKeychainEntries deletes the device-local partition first ([false, true]), one awaited native call per server, then the synchronizable partition. Between a server's local deletion and its sync deletion the migration sees exactly the 'local missing, sync present' condition that triggers a copy, and the local loop never revisits a server it has passed.
5. [utils/MigrationUtils.ts:124–138](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/MigrationUtils.ts#L124-L138)
   readFlag serves 'true' from the in-process confirmedFlags cache; clearConfirmedFlags empties it. This is why the wipe's step 6 makes the next readFlag fall through to the now-empty EncryptedStorage and the migration runs again in the dying JS context.
6. [stores/SettingsStore.ts:2096–2113](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L2096-L2113)
   getSettings() unconditionally awaits keychainDesyncMigration() and keychainCloudSyncMigration() before reading the blob; applySettingsUpdate (2367) calls it for every queued updateSettings before the latched setSettings, so the latch stops the write but not the migration.
7. [App.tsx:384–398](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/App.tsx#L384-L398)
   The global AppState handler, registered for the app's lifetime, awaits settingsStore.getSettings() on every 'background' transition. Pressing Home, an incoming call or the screen locking during the tens-of-seconds wipe therefore starts the migration while clearAllData is still running.
8. [views/Lockscreen.tsx:523–565](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Lockscreen.tsx#L523-L565)
   Duress and failed-attempt paths await clearAllData() and call restartApp() in finally; blockNavigationDuringWipe stops back navigation and gestures only, so the holder can still background the app during the wipe. The failed-attempt path is driven entirely by the device holder.
9. [utils/DataClearUtils.ts:873–879](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/DataClearUtils.ts#L873-L879)
   The latch is the only protection against in-flight writers and is documented as covering updateSettings; the maintainers record an async settings write landing ~20 ms after the wipe on device, showing such writers do fire in the window. The desync migration's raw writer (and Storage.removeItem, storage/index.ts:132-139) are outside the latch.
10. [views/Wallet/Wallet.tsx:525–528](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L525-L528)
   autoPurgeLegacyKeychain, the only automatic deleter of synchronizable zeus:* copies, fires only here, after the lockscreen is passed. On the first launch of a patched build the lockscreen (and so a duress or lockout wipe) is reached while the whole zeus:* set, settings blob included, is still synchronizable.
11. [utils/RestartUtils.ts:43–49](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/RestartUtils.ts#L43-L49)
   On iOS restartApp is RNRestart.Restart(), a JS reload: it resets the in-memory latch and store state but leaves keychain items re-created by the migration in place for the next getSettings.

## Impact
The resurrected items are the settings blob (every wallet config: aezeed/BIP39 seeds, macaroons, runes, LNC pairing, PINs/duress PINs) or the stranded xprv cache / legacy Cashu seed bytes. After the reload the app boots into the pre-wipe wallet, or the key material stays in the device keychain, defeating the duress wipe the threat model requires to be complete and leaving funds and credentials with the coercer. Integrity of the 'complete wipe' guarantee is broken; no availability impact.

## Reproduction steps
1. Attacker is the person physically holding the locked phone: a coercer present when the user enters the duress PIN/passphrase, or anyone who exhausts the failed-login limit themselves (that path needs no victim action at all, hence UI:N). During the tens-of-seconds wipe they background the app (Home, a call, screen lock) or an already-queued updateSettings fires; either runs getSettings() -> keychainDesyncMigration after step 6 has re-armed it. If that interleaves with step 8's partition sweeps, synchronizable copies are written back locally and survive the JS reload. AT:P: requires zeus:* items still in the synchronizable partition (any pre-patch install at its first patched lockscreen, deferred/failed purges, or stranded sole-copy items) and winning the interleaving. No credentials or app privileges are needed.

## Recommended fix
1. Keychain writers outside Storage.setItem (setRawLocalItem used by keychainDesyncMigration and verifyPurgePreflight; Storage.removeItem) are not covered by the wipe write latch, so the dying JS context can re-create keychain items after the sweep. Fix criteria: Every code path that performs a keychain add/update/delete must be a no-op once the wipe latch is engaged, including raw helpers and migrations; verify by starting clearAllData, invoking getSettings()/updateSettings() concurrently, and confirming no setInternetCredentials call reaches the native module after blockWrites().
2. clearAllData clears the one-shot migration flags (EncryptedStorage.clear + clearConfirmedFlags) before the keychain sweep, re-arming keychainDesyncMigration against a half-deleted keychain. Fix criteria: Migrations must not run while a wipe is in progress (e.g. getSettings skips migrations when writes are blocked, or flags are cleared only after the final keychain sweep); verify that a getSettings() issued between step 6 and step 8 performs no keychain writes and that the device-local partition is empty after the wipe when the sync partition held zeus:* items.

---
**Severity:** LOW
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
**Attack vector:** PHYSICAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258394

---

# POS Receive 'Advanced' tab exposes Lightning Address setup reaching ecash settings and mint selection without PIN

## Details
The POS checkout screen views/Receive.tsx is reached unauthenticated in POS mode (PosStore.processCheckout / Order.tsx Pay). When the merchant's POS confirmationPreference is '0conf' or '1conf' (SettingsStore.ts:1321-1326; the lnOnly default disables this) the screen is not in lnOnly mode, so once the POS invoice exists showButtonGroup is true (1431-1436) and the 'Advanced' toggle (1994-2014) reveals the receive-type ButtonGroup (3050-3078). On LND-based or Cashu-capable mainnet backends that group includes a Lightning Address tab (1235-1242). Selecting it when the merchant has no ZEUS Pay address shows a 'Create Lightning Address' button that calls navigation.navigate('LightningAddress') directly (1923-1941) - no posStatus check and no protectedNavigation, unlike the sanctioned POS exits (WalletHeader TempleButton/MenuBadge/NodeButton, POS Layout error button) that all go through utils/NavigationUtils.ts:5-23.

views/LightningAddress/index.tsx in the no-handle state offers, with no lock check: 'Enable ecash' -> EcashSettings (647-665), 'Get started' -> CreateCashuLightningAddress, and for remote nodes CreateNWCLightningAddress (831-840). EcashSettings lets the holder flip settings.ecash.enableCashu (166-190) and open Mints (324-349); Mints -> AddMint -> Mint lets them add any mint URL and make it the selected receive mint (Mints.tsx:147-155, 318-329; AddMint.tsx:144-163; Mint.tsx:1015, 1058). None of those screens checks posStatus or re-authenticates.

Consequence: with ecash enabled, PosStore.processCheckout (172-176) routes every POS checkout to ReceiveEcash, i.e. to the attacker's mint. CashuStore.checkAndMintCDK (813-822) accepts the mint's 'Paid' quote state as proof of payment and ReceiveEcash.subscribeInvoice (334-347) records the order paid - so an attacker-run mint can issue 'Paid' for its own quotes without any Lightning payment (free goods), and real customers' payments to the mint's invoices are held by the attacker while the merchant is left with ecash the mint can refuse to honour. On remote-node deployments CreateNWCLightningAddress -> LightningAddressStore.createNWC (206-244) registers a ZEUS Pay address for the merchant's node pubkey backed by whatever NWC string the holder pastes and switches lightningAddress.enabled/automaticallyAccept on. Enabling ecash from here also places the POS flow on the ReceiveEcash screen whose clipboard button is already recorded as a lock bypass (pos-receive-ecash-clipboard-handleanything-reaches-send-without-lock).

Root cause: a destination intended for the owner (ZEUS Pay setup and, behind it, ecash/mint configuration) is wired from the POS-reachable Receive screen with a raw navigate. Distinct from wallet-header-pos-mode-nickname-zeuspay-navigation-bypasses-pos-lock, which reaches LightningAddress through the header badge only when a pending ZEUS Pay payment exists and lands in the has-address state; this record is the Receive tab entry and the no-address creation sub-flow into EcashSettings/Mints/CreateNWC.

## Evidence
1. [views/Receive.tsx:1923–1942](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L1923-L1942)
   On tab 3 with no ZEUS Pay address loaded (!lightningAddress), a 'Create Lightning Address' Button does a bare navigation.navigate('LightningAddress') - no posStatus check, no protectedNavigation.
2. [views/Receive.tsx:1431–1436](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L1431-L1436)
   showButtonGroup = !belowDustLimit && !lnOnly && !onChainOnly && !watchedInvoicePaid && haveInvoice. lnOnly (264-269) is true in POS only when settings.pos.confirmationPreference === 'lnOnly'; with '0conf' or '1conf' the tab group is available in POS mode once the POS invoice exists.
3. [views/Receive.tsx:1994–2013](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L1994-L2013)
   The 'Advanced' toggle is rendered in POS mode whenever showButtonGroup || showNfcButton; tapping it sets showAdvanced, which reveals the bottom ButtonGroup (3050-3078) whose 4th button (1235-1242) is the Lightning Address tab when supportsLightningAddress() && !testnet (LND-based or Cashu-capable backends, BackendUtils.ts:284-285).
4. [stores/SettingsStore.ts:1321–1326](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L1321-L1326)
   confirmationPreference offers '0conf', '1conf' and 'lnOnly'; the default is 'lnOnly' (1594), so the path needs a merchant who chose on-chain acceptance - a supported, documented POS setting, not a corrupted state.
5. [views/LightningAddress/index.tsx:647–664](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LightningAddress/index.tsx#L647-L664)
   With no handle, the intro offers 'Get started'/'Enable ecash' navigating to CreateCashuLightningAddress or EcashSettings (owner settings), plus CashuLightningAddressInfo; nothing in the screen checks posStatus or the lock.
6. [views/LightningAddress/index.tsx:831–840](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LightningAddress/index.tsx#L831-L840)
   For remote nodes (notEmbedded) the intro offers CreateNWCLightningAddress, where any pasted NWC string is registered.
7. [views/Settings/EcashSettings.tsx:166–190](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/EcashSettings.tsx#L166-L190)
   The 'enable ecash' switch persists settings.ecash.enableCashu and initialises Cashu wallets immediately; the Mints row (324-349) opens the mint list. No lock or POS check in the file.
8. [views/Cashu/Mints.tsx:147–155](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/Mints.tsx#L147-L155)
   AddMint button -> AddMint.tsx:144-163 fetches info for any URL and opens Mint with lookup -> Mint.tsx:1015 addMint / 1058 setSelectedMint; Mints.tsx:318-329 also selects any listed mint as the receive mint. No posStatus, protectedNavigation or reAuthNavigation in Mints/AddMint/Mint/EcashSettings.
9. [stores/PosStore.ts:172–175](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/PosStore.ts#L172-L175)
   Once settings.ecash.enableCashu is set, every POS checkout is routed to ReceiveEcash, i.e. to the selected mint, instead of the merchant's node.
10. [stores/CashuStore.ts:813–821](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L813-L821)
   checkAndMintCDK treats the mint's reported quote state 'Paid' as proof of payment and mints against it; ReceiveEcash.tsx:334-347 then records the POS order paid. A mint chosen by the attacker can report 'Paid' for any quote without any Lightning payment, or keep real customers' payments while issuing ecash it can later refuse to redeem.
11. [stores/LightningAddressStore.ts:206–244](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LightningAddressStore.ts#L206-L244)
   createNWC registers a ZEUS Pay address for the merchant's node pubkey backed by the supplied nwc_string and flips settings.lightningAddress.enabled/automaticallyAccept - an owner-level delegation taken from the POS screen.
12. [utils/NavigationUtils.ts:5–22](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NavigationUtils.ts#L5-L22)
   protectedNavigation is the gate the project applies to POS exits; Lockscreen.tsx:193-213 waives the PIN in POS mode otherwise and Wallet.tsx:477-492 boots POS unauthenticated, so this raw navigate is a complete bypass.
13. [views/Cashu/ReceiveEcash.tsx:502–512](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/ReceiveEcash.tsx#L502-L512)
   The sibling ecash receive screen hides its header scan button when posStatus === 'active', showing the maintainers intend POS staff not to leave the checkout flow; Receive's tab group and create button have no such guard.

## Impact
Integrity: owner settings (ecash enabled, selected mint, ZEUS Pay registration with an attacker NWC string) are rewritten without the PIN, and POS checkouts are redirected to an attacker-chosen custodian whose 'Paid' state the app trusts - falsified receipts and diverted customer payments, defeating payment-state truthfulness. Confidentiality: none beyond mint balances shown on the mint screens. Availability: the POS receive path now depends on the attacker's mint, which can stall or fail checkouts.

## Reproduction steps
1. Attacker is the POS terminal holder without the owner's PIN (staff or a customer handed the device) - the principal protectedNavigation and the PointOfSale 'no PIN set' warning exist to stop. Preconditions outside their control: POS with a PIN, pos.confirmationPreference set to '0conf'/'1conf' (non-default but a documented option), an LND-based or Cashu-capable mainnet backend, and no ZEUS Pay address yet. Then: start a checkout, tap Advanced, pick the Lightning Address tab, tap Create, tap Enable ecash, enable the switch, add and select their own mint. From the next checkout on, their mint controls 'Paid'. No defence to defeat.

## Recommended fix
1. Receive.tsx shows the receive-type tab group and the 'Create Lightning Address' navigation in POS mode and navigates with a raw navigation.navigate, bypassing the Lockscreen gate used by every other POS exit. Fix criteria: While posStatus === 'active', Receive must not offer the Lightning Address tab/creation button, or must route it through protectedNavigation so a Lockscreen appears first. Verify in POS mode with a PIN and confirmationPreference '0conf': after generating an invoice, no sequence of taps on Receive reaches LightningAddress, EcashSettings, Mints, AddMint or CreateNWCLightningAddress without the PIN.
2. Owner-level configuration screens (LightningAddress setup, EcashSettings, Mints/AddMint/Mint, CreateNWCLightningAddress) perform no posStatus or re-authentication check of their own, so any ungated entry from POS reaches them. Fix criteria: Enabling ecash, adding or selecting a mint, and registering a ZEUS Pay address must require the Lockscreen when posStatus is 'active' or loginRequired() is true. Verify by navigating to each with posStatus 'active' and a PIN set: the Lockscreen must appear and a wrong PIN must not proceed.

---
**Severity:** LOW
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-288](https://cwe.mitre.org/data/definitions/288.html)
**Attack vector:** PHYSICAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258391

---

# NWC Cashu pay_invoice melts and judges outcome from shared CashuStore state; budget escape and crosstalk

## Details
When the user has switched NWC funding to ecash (isCashuConfigured, NostrWalletConnectStore.ts:3867; handler chosen at 1517-1520), pay_invoice is served by handleCashuPayInvoice, which drives CashuStore.payLnInvoiceFromEcash on the app-wide CashuStore singleton and then infers the outcome from singleton fields. Two shared-state paths follow, both reachable by an external NWC client with pay_invoice permission. CashuStore has no in-flight lock, and enqueuePayment (1944-1959) serialises only NWC requests, so user-initiated ecash payments (views/Cashu/CashuSendingLightning.tsx:111-118) interleave freely with the service's.

(A) Budget escape / false failure. The handler calls cashuStore.getPayReq(request.invoice) (2803), later payLnInvoiceFromEcash (2881), and judges failure by `!cashuInvoice || cashuInvoice.isFailed || this.cashuStore.paymentError` (2884-2888). payLnInvoiceFromEcash resets paymentError at its start and any ecash payment in the app sets it on failure (CashuStore.ts:4458-4465, 4482-4530, 4594-4604); the CashuPayment it returns never carries a status, so CashuPayment.isFailed (models/CashuPayment.ts:95-97) is always false and paymentError is the only failure signal. If a user-initiated ecash payment fails between the NWC call's reset and the handler's check (a window spanning getMintBalance, the mint melt round-trip, Storage.setItem and syncCDKBalances), the handler records the connection's successfully melted payment as 'failed' via recordFailedPayment (3539-3586: status 'failed', no trackSpending), debits nothing (pendingSpendSats counts only 'pending' rows, NWCConnection.ts:233-241), returns FAILED_TO_PAY_INVOICE to the client, and shows the user a payment-failed notification for a payment that paid the attacker's invoice. A user ecash payment started in that window is in fact likely to fail: the NWC getPayReq replaced the shared meltQuote with the attacker's quote (verified finding cashu-melt-dispatched-from-unpinned-store-nwc-getpayreq-redirects-payment), so when the service's melt of that quote is ahead, the user's CashuSendingLightning melts a quote already being melted and the mint/CDK rejects it. Each hit lets the client spend once more than its budget allows.

(B) Reverse clobber. payLnInvoiceFromEcash reads this.payReq (amount, 4467-4470), this.meltQuote.quote and this.paymentRequest (4511-4560) at melt time, none bound to the handler's request. If the user's own getPayReq (scanning an invoice to pay with ecash) completes between the handler's getPayReq (2803) and its melt (2881) - a window of several awaits including decodeInvoiceTags inside getPayInvoiceAmountSats and the CDK getMintBalance call - the service melts the user's quote: the user's invoice is paid with the user's ecash, the connection's budget is debited at the attacker's requested amountSats (2905-2946), a 'success' activity is recorded under the attacker's invoice id, and the preimage of the user's payment is returned to the attacker as proof of payment. A related interleaving needs no tight window: a user getPayReq that starts while the handler's getPayReq is in its mint round-trip supersedes it via getPayReqRequestId (CashuStore.ts:4253, 4402), so the handler reads the user's early-set payReq (4257-4260) at 2804 and later melts whichever meltQuote is still in the store - the user's fresh quote, or a stale unmelted quote from an earlier review the user backed out of. The user's subsequent melt of the same quote fails, so the user sees a failure for an invoice that was actually paid and may pay it again by other means.

This is the Cashu-leg sibling of the verified lightning finding nwc-shared-transactions-store-payment-result-crosstalk (service outcome read from a shared TransactionsStore) and the service-side counterpart of cashu-melt-dispatched-from-unpinned-store-nwc-getpayreq-redirects-payment, whose sink is the user's melt and whose fixes (pin the reviewed invoice into the user's melt; stop NWC writing the flags the user's screens render) leave the handler's reads at 2884-2888 and 4467-4560 untouched. The maintainers' own comment at 2907-2913 recognises that gating the debit on a list lookup would let spend escape the budget, but the failure gate one line earlier is a shared flag with the same property.

## Evidence
1. [stores/NostrWalletConnectStore.ts:2881–2904](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2881-L2904)
   After its own melt returns, handleCashuPayInvoice decides failure from `!cashuInvoice || cashuInvoice.isFailed || this.cashuStore.paymentError`. paymentError is a singleton flag written by every ecash payment in the app; on failure the handler calls recordFailedPayment (no budget debit, no pending hold) and reports FAILED_TO_PAY_INVOICE although the melt succeeded.
2. [stores/CashuStore.ts:4458–4464](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L4458-L4464)
   payLnInvoiceFromEcash resets paymentError/paymentErrorMsg/paymentSuccess at the start of every call (UI or NWC) and sets them on any failure (4482-4530, 4594-4604); nothing correlates the flag to the caller that reads it.
3. [stores/CashuStore.ts:4467–4469](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L4467-L4469)
   The amount actually melted is taken from this.payReq.getRequestAmount (singleton), not from the amount argument, so a payReq replaced by another flow changes what is paid.
4. [stores/CashuStore.ts:4511–4559](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L4511-L4559)
   The melt executes CashuDevKit.melt(mintUrl, this.meltQuote.quote) and records a CashuPayment from ...this.payReq and this.paymentRequest, all read from the singleton at melt time. When the NWC handler is the caller, a user getPayReq that lands between the handler's getPayReq (2803) and this read makes the service melt the user's quote and pay the user's invoice.
5. [stores/NostrWalletConnectStore.ts:2803–2805](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2803-L2805)
   The handler primes the shared state with cashuStore.getPayReq(request.invoice) and only after several awaits (decode checks, getPayInvoiceAmountSats, budget check, getMintBalance) melts; the window is open to the user's own getPayReq and to a user melt that will fail on the swapped quote and set paymentError.
6. [models/CashuPayment.ts:95–97](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/models/CashuPayment.ts#L95-L97)
   isFailed is true only when status === 'FAILED'; payLnInvoiceFromEcash never sets status on the CashuPayment it returns, so the shared paymentError flag is the only failure signal the handler has.
7. [stores/NostrWalletConnectStore.ts:2905–2945](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2905-L2945)
   On the success branch finalizePayment debits amountSats (the amount of the client's requested invoice, not what was melted) and the response returns cashuInvoice.getPreimage, i.e. the preimage of whatever invoice was actually melted, to the client.
8. [models/NWCConnection.ts:233–240](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/models/NWCConnection.ts#L233-L240)
   pendingSpendSats counts only status 'pending' pay_invoice rows; a Cashu payment recorded 'failed' holds nothing against the budget, so a melted spend recorded as failed escapes the cap entirely.

## Impact
Integrity LOW: per hit the client spends one payment beyond its budget (bounded by the melt amount), the connection's activity and the user's notification report a false failure, or the service pays the user's invoice and debits the connection for it while the user's own flow reports failure. Confidentiality LOW: in the reverse interleaving the preimage of the user's own payment is returned to the client as its proof of payment. Availability NONE.

## Reproduction steps
1. Attacker is an external NWC client holding a connection with pay_invoice permission (PR LOW; pay_invoice is in the full-access preset), reached over Nostr relays (AV NETWORK). Preconditions: the user has enabled NWC funding from Cashu, and a user ecash payment or invoice review must interleave with the service's melt (AT PRESENT). For (A) the client submits pay_invoice for its own invoice and repeats across the user's ecash payments; whenever the user pays (or attempts to pay) with ecash during the service melt (UI PASSIVE), the spend is recorded failed and escapes the budget. For (B) the client can probe at no budget cost with an invoice the mint cannot route: a failed melt is recorded via recordFailedPayment without trackSpending, so repeated attempts cost nothing until a user getPayReq lands in the window and the service melts the user's quote, returning the user's preimage. No defensive mechanism stands in the way once the window is hit; CashuStore has no in-flight lock and enqueuePayment serialises only NWC requests (AC LOW). Dependency assumption (cdk-ffi 0.18.1 per fetch-libraries-versions.json, prebuilt and not readable here): CashuDevKit.melt(mintUrl, quoteId) pays whichever quote id it is handed and a second melt of an already-melted quote fails rather than paying twice.

## Recommended fix
1. handleCashuPayInvoice determines success or failure of its melt from the singleton flag cashuStore.paymentError, which any concurrent ecash payment resets or sets, instead of from the result of the melt it performed. Fix criteria: The outcome used for budget accounting and the NIP-47 response derives solely from the return value / thrown error of the service's own melt call (or a per-call result object), never from shared flags. Verification: with a user ecash payment failing while a service melt succeeds, the service debits the budget and returns success; with the service melt failing while a user payment succeeds, the service reports failure without debiting.
2. payLnInvoiceFromEcash reads the invoice, amount and melt quote to execute from mutable singleton fields (payReq, meltQuote, paymentRequest) rather than from parameters bound by its caller, so a service-initiated melt can execute a user's quote and vice versa. Fix criteria: Service-initiated melts pass the invoice, amount and quote explicitly and the melt operates only on those values; the response preimage must correspond to the requested invoice's payment hash. Verification: a user getPayReq landing between the service's getPayReq and its melt does not change which quote the service melts, which amount is debited, or which preimage is returned.

---
**Severity:** LOW
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258390

---

# LSPS1 REST requests and forced Flow info request bypass Tor, sending node pubkey and refund address from the device IP

## Details
A remote LND or CLNRest wallet can enable Tor so that traffic to the node goes through the bundled Tor client (backends/LND.ts:49-66, backends/CLNRest.ts:62-90 route node REST through doTorRequest when enableTor is set), and the project treats traffic that bypasses Tor when Tor is enabled as a privacy leak (SECURITY.md 'Privacy leaks (e.g. traffic that bypasses Tor when Tor is enabled ...)'). stores/LSPStore.ts initFlowLSP (413-443) already withholds the startup Flow `/api/v1/info` request from Tor remote LND because it 'goes over clearnet and would send the device IP to the Flow host on every startup (#4372)'. The LSPS1 REST client in the same store, and one further Flow caller, never got the same treatment:

- lsps1GetInfoREST (919-929) GETs `<lsps1Rest>/api/v1/get_info` with a bare ReactNativeBlobUtil.fetch as soon as the LSPS1 screen mounts (views/LSPS1/index.tsx 81-93 -> fetchGetInfo 112-122).
- lsps1CreateOrderREST (1043-1073) POSTs `{public_key: <node id>, refund_onchain_address, client_info, ...}` to `<lsps1Rest>/api/v1/create_order` when the user submits an order (views/LSPS1/index.tsx 1253-1258).
- lsps1GetOrderREST (1191-1200) GETs `get_order?order_id=` and is polled from pollFreeOrderStatus (1716-1722), views/LSPS1/Order.tsx (87-91) and views/LSPS/LSPPaymentAwait.tsx (181-184).
- views/Receive.tsx 368-373: the 'Create a wrapped invoice' path (views/Settings/LSP.tsx 353-366 navigates with forceLsp: true) calls LSPStore.getLSPInfo() directly; getLSPInfo (324-331) is itself a bare fetch of `<flowHost>/api/v1/info`, and the Tor gate exists only in its other caller initFlowLSP, so this re-issues the request #4372 suppressed.

None of these reads settingsStore.enableTor or uses doTorRequest. supportsLSPS1rest() is true for remote LND (backends/LND.ts:1076) and CLNRest (backends/CLNRest.ts:863); supportsLSPS1native exists only on LdkNode (false), so those backends always take the REST branch. The LSPS1 entry (components/Modals/NewChannelModal.tsx 41-49, 186-193) is offered without any Tor condition. Unlike the Flow path, the LSPS1 path has no certVerification prerequisite: any Tor-enabled remote LND or CLNRest wallet that opens the LSPS1 screen contacts the LSPS1 host (https://lsps1.zeuslsp.com by default, SettingsStore 1353; or a custom host) from the device's real IP, and submitting an order delivers the node pubkey and a refund on-chain address with that IP; every later view of the order repeats the contact.

Result: the LSPS1 host operator (ZEUS by default) and any on-path observer learn the device IP bound to the user's node pubkey and refund address, which is what the Tor setting exists to withhold; for a .onion-only node this de-anonymises the node operator, for a clearnet node it ties the phone to the node identity. The Flow fee/proposal requests (getZeroConfFee, getZeroConfInvoice) have the same defect and are recorded separately as flow-lsp-fee-proposal-requests-bypass-tor; the Swaps screen (views/Swaps/index.tsx 509-522) is a further caller of that record's getZeroConfFee sink. The sibling node-side defect is lnd-websocket-subscriptions-bypass-tor. The threat model's established facts describe 'LSP getLSPInfo' as Tor-gated; the code shows only the initFlowLSP caller is gated.

Assumption about a dependency not vendored here: react-native-blob-util 0.25.1's plain fetch (no .config) uses the platform HTTP stack directly with no proxy, as the project's own #4372 comment states; nothing in this repository configures a native proxy for it.

## Evidence
1. [stores/LSPStore.ts:1043–1072](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L1043-L1072)
   lsps1CreateOrderREST POSTs public_key: nodeInfoStore.nodeInfo.nodeId, refund_onchain_address and client_info to <lsps1Rest>/api/v1/create_order with a bare ReactNativeBlobUtil.fetch. settingsStore.enableTor is never read and there is no doTorRequest branch, so on a Tor-enabled wallet the node pubkey and a refund address leave from the device's real IP.
2. [stores/LSPStore.ts:919–928](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L919-L928)
   lsps1GetInfoREST GETs <lsps1Rest>/api/v1/get_info with a bare fetch; it is issued as soon as the LSPS1 screen mounts, so merely opening the screen on a Tor wallet contacts the LSPS1 host from the device IP.
3. [stores/LSPStore.ts:1191–1199](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L1191-L1199)
   lsps1GetOrderREST GETs <RESTHost>/api/v1/get_order?order_id=<id> with a bare fetch. It is polled by pollFreeOrderStatus (1716-1722), views/LSPS1/Order.tsx (87-91) and views/LSPS/LSPPaymentAwait.tsx (181-184), so every later look at an order repeats the device-IP contact for an order that already carries the node pubkey.
4. [views/LSPS1/index.tsx:112–121](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LSPS1/index.tsx#L112-L121)
   fetchGetInfo, called from componentDidMount (81-93), dispatches to lsps1GetInfoREST whenever BackendUtils.supportsLSPS1rest(); supportsLSPS1native exists only on LdkNode (false), so remote LND and CLNRest always take the REST branch. The create-order button (1253-1258) dispatches to lsps1CreateOrderREST the same way. Neither consults enableTor.
5. [components/Modals/NewChannelModal.tsx:41–48](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/Modals/NewChannelModal.tsx#L41-L48)
   supportsLSPS1 = supportsLSPS1native() || supportsLSPScustomMessage() || supportsLSPS1rest(); the 'LSPS1' option (186-193) is shown and navigates to the LSPS1 screen with no Tor condition, so the entry point is offered to Tor-enabled wallets as to any other.
6. [backends/CLNRest.ts:62–89](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/CLNRest.ts#L62-L89)
   CLNRest.restReq (like LND.restReq at backends/LND.ts:49-66) routes the node's own REST through doTorRequest when useTor is set, and CLNRest.supportsLSPS1rest() (863) and LND.supportsLSPS1rest() (1076) are both true. These are exactly the backends for which WalletConfiguration offers the 'Use Tor' switch (supportsTor, views/Settings/WalletConfiguration.tsx:1531-1534), so the wallets whose node traffic is Tor-routed are the ones whose LSPS1 REST traffic is not.
7. [views/Receive.tsx:368–372](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L368-L372)
   When route.params.forceLsp is set (the LSP settings 'Create a wrapped invoice' item, views/Settings/LSP.tsx:353-366, navigates here with forceLsp: true) and lspIsActive holds (330-334, no Tor term), Receive calls LSPStore.getLSPInfo() directly. getLSPInfo (324-331) is a bare fetch of <flowHost>/api/v1/info; the only Tor gate for it lives in its other caller initFlowLSP, so this path re-issues over clearnet the very request #4372 suppressed for Tor remote LND.
8. [stores/LSPStore.ts:413–442](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L413-L442)
   initFlowLSP skips the startup getLSPInfo for remote LND over Tor because it 'goes over clearnet and would send the device IP to the Flow host on every startup (#4372)'. This is the project's own statement that clearnet contact with an LSP host from a Tor-enabled wallet is a leak; the gate is applied at this one caller only, not inside getLSPInfo and not to any LSPS1 REST function.
9. [stores/SettingsStore.ts:1353](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L1353)
   DEFAULT_LSPS1_REST_MAINNET = 'https://lsps1.zeuslsp.com' (getLspConfigForNetwork 1427 falls back to it): the LSPS1 REST host is ZEUS-operated infrastructure by default, or any custom host the user enters in LSPS1 settings.

## Impact
Confidentiality: the device's real IP is linked to the user's Lightning node identity (public_key) and a refund on-chain address at the LSPS1 host and to on-path observers, defeating the anonymity the Tor setting promises and that #4372 protects for the Flow host at startup. TLS is still verified on these clearnet requests (doTorRequest is not involved and no trusty flag is passed), so no credential is exposed; funds, integrity and availability are unaffected.

## Reproduction steps
1. The observer is the LSPS1 (or Flow) host operator or any passive on-path party between the phone and that host, the parties the user enabled Tor to hide the device IP from. No attacker action is needed: on a Tor-enabled remote LND or CLNRest wallet, opening the LSPS1 channel-purchase screen issues a clearnet get_info request from the device IP, submitting an order posts the node pubkey and refund address from that IP, and opening order history or the payment-await screen repeats get_order the same way; the forceLsp 'Create a wrapped invoice' path does the same for the Flow info request. The user performs routine wallet actions, not an interaction with attacker content, hence UI:P (consistent with the sibling Flow record). AT:P because the wallet must be a Tor-enabled remote LND/CLNRest wallet whose user uses the LSPS1 feature (or the wrapped-invoice shortcut) and the observer must sit at the host or on the path.

## Recommended fix
1. LSPStore's LSPS1 REST functions (lsps1GetInfoREST, lsps1CreateOrderREST, lsps1GetOrderREST) use bare ReactNativeBlobUtil.fetch and ignore settingsStore.enableTor, so a Tor-configured remote LND or CLNRest wallet contacts the LSPS1 REST host over the clearnet with the node pubkey and refund address in the request. Fix criteria: When enableTor is set, every HTTP request to the LSPS1 REST host is either routed through the Tor client (doTorRequest with strict TLS, as node REST already is) or refused with a visible message that LSPS1 is unavailable over Tor, and the LSPS1 entry in NewChannelModal reflects that. Verify by configuring a Tor-enabled remote LND and a Tor-enabled CLNRest wallet, opening the LSPS1 screen, creating an order and reopening it from order history: no non-Tor connection to the LSPS1 host may occur.
2. The Tor gate for the Flow info request lives in one caller (initFlowLSP) rather than in getLSPInfo itself, so Receive's forceLsp path (and any future caller) re-issues the request over clearnet for a Tor wallet. Fix criteria: getLSPInfo (or a single predicate every LSP request goes through) applies the Tor condition itself, so a Tor-enabled remote LND wallet never contacts the Flow host over clearnet regardless of which screen triggers the request; verify by using 'Create a wrapped invoice' on a Tor-enabled remote LND wallet and confirming no non-Tor connection to the Flow host.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-359](https://cwe.mitre.org/data/definitions/359.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258389

---

# Imported channel-backup copy left in Caches survives wipe and wallet deletion

## Details
The channel-database import flow (wallet restore: views/Settings/SeedRecovery.tsx handleImportFile -> validateChannelBackupFile; then utils/LndMobileUtils.ts:1349 -> importChannelDb) copies the user-selected zipped LND graph directory (channel.db / channel.sqlite and siblings) into a fixed, predictable location in the app's cache directory, `${RNFS.CachesDirectoryPath}/zeus-import-temp.zip` (resolveToLocalPath, utils/ChannelMigrationUtils.ts:63-93; on Android for the content:// URIs the document picker returns, on iOS for every picked file). Both validateChannelBackupFile (116) and importChannelDb (887) create this copy, and neither removes it: importChannelDb unzips from localPath into the graph dir and returns (903-904) without an unlink, and `zeus-import-temp` is referenced nowhere else in the tree. The export and Olympus-restore paths, by contrast, unlink their temporary zip/enc files (276, 282, 579, 623), as does the node-config export (NodeConfigUtils.ts).

The wipe (DataClearUtils.clearAllData, run by the duress PIN via Lockscreen.deleteNodes and by the full wipe) deletes LND/LDK data directories (including the graph dir the import populated), CDK databases, every keychain partition, AsyncStorage, EncryptedStorage and, per the comment at 919-925, the rescue-key staging copy that lives in the same cache directory. It never sweeps Caches/zeus-import-temp.*, and no native code deletes the cache directory. Single-wallet deletion (WalletConfiguration.deleteNodeConfig -> clearNodeKeychainData / deleteNodeDataDirectoryWithRetry) does not remove it either. OS cache eviction on either platform is opportunistic (storage pressure) and not a guarantee.

The retained file is a full copy of the wallet's channel database: channel state and counterparty pubkeys/channel points, revocation logs, invoices with payment preimages, and payment/forwarding history. After a duress wipe meant to leave 'no recoverable key material behind' (Lockscreen.tsx 523-525), a forensic file-system extraction of the device still recovers the pre-wipe channel database. Android allowBackup=false and the iOS Library/Caches location keep it out of normal backups and File Sharing, so recovery needs device-level file access, which bounds the impact; the seed is not in the file, so funds cannot be moved with it alone. It is nonetheless a deterministic incompleteness of the wipe for any user who has used channel import.

## Evidence
1. [utils/ChannelMigrationUtils.ts:876–904](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ChannelMigrationUtils.ts#L876-L904)
   importChannelDb validates, resolves the user-picked backup to the fixed cache copy via resolveToLocalPath (887), clears the LND graph dir and unzips localPath into it (903), then returns. localPath is never unlinked; no other code in the tree references zeus-import-temp.
2. [utils/ChannelMigrationUtils.ts:63–93](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ChannelMigrationUtils.ts#L63-L93)
   resolveToLocalPath copies the picked file to the fixed path Caches/zeus-import-temp.zip|.db: on Android for content:// URIs (what @react-native-documents/picker 12.0.2 returns), on iOS for every existing path (it unlinks and replaces an older copy, never removes the current one). validateChannelBackupFile (116) makes the same copy, so the file exists even when the user aborts before import.
3. [utils/DataClearUtils.ts:870–1007](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/DataClearUtils.ts#L870-L1007)
   clearAllData (the duress and full wipe) removes node data directories, CDK databases, keychain, AsyncStorage, EncryptedStorage and, at 919-925, the rescue-key staging copy in the same cache directory, but never sweeps Caches/zeus-import-temp.*; no native code deletes the cache dir either.
4. [views/Settings/SeedRecovery.tsx:358–390](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/SeedRecovery.tsx#L358-L390)
   handleImportFile is the UI entry: pick({mode:'import'}) then validateChannelBackupFile(result.uri), which creates the cache copy before the user has confirmed the import.
5. [utils/LndMobileUtils.ts:1349–1353](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LndMobileUtils.ts#L1349-L1353)
   Wallet-restore flow calls importChannelDb with the picked URI after stopping LND; nothing after the call removes the cache copy.

## Impact
channel.db discloses channel partners, capacities, invoice preimages and full payment history of the supposedly wiped wallet, but contains no seed, so funds cannot be moved with it alone. Confidentiality impact is limited; no integrity or availability impact.

## Reproduction steps
1. A person who obtains the device after a duress or full wipe (or after wallet deletion) and can read the app's private cache directory (forensic extraction, OS-level file access) recovers Caches/zeus-import-temp.zip|.db. Requires that the user previously ran the channel-backup import flow; no credentials or user interaction at exploitation time.

## Recommended fix
The channel-import flow stages a copy of the user's channel database at a fixed cache path and never deletes it, and neither clearAllData nor wallet deletion sweeps that path, so channel state outlives the wallet and the duress wipe. Fix criteria: The staged import copy must be removed in a finally block as soon as validation or import completes or fails (both validateChannelBackupFile and importChannelDb), and clearAllData plus single-wallet deletion must also remove any zeus-import-temp.* leftovers (belt-and-braces, as done for the rescue-key staging file); verify that after an import followed by a wipe no file matching zeus-import-temp.* exists in the Caches directory on either platform.

---
**Severity:** LOW
**Status:** Open
**Category:** Incomplete cleanup
**CWE:** [CWE-459](https://cwe.mitre.org/data/definitions/459.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258388

---

# Submarine refund spends provider-designated lockup transaction; user's own lockup txid never bound to swap

## Details
For a submarine swap the user's on-chain lockup transaction is broadcast from the ordinary Send flow (SwapDetails 'Pay invoice' -> handleAnything(bip21) -> Send/SendingOnChain) or from an external wallet via the displayed QR. SendingOnChain knows it is inside a swap (views/SendingOnChain.tsx:104-107) but never records the broadcast txid against the swap, and SwapStore has no field for a submarine lockup txid, so ZEUS holds no record of which transaction, or how much, it locked up. The only description of 'the lockup transaction' the app ever has is what the provider returns from GET /swap/submarine/{id}/transaction, stored verbatim by SwapStore.getLockupTransaction (stores/SwapStore.ts:408-449) when the provider reports a failure status (SwapDetails.tsx:378-395) or when the refund screen opens without one (Refund.tsx:461-467).

Refund.tsx:87-108 passes that hex to the native createRefundTransaction (lndmobile/swaps.ts:122-170; the prebuilt Lndmobile v0.21.4-beta-zeus.1 binary), whose signature takes transactionHex and lockupAddress but no expected amount, so it spends whatever output of that transaction pays the lockup address. On any returned txid the app calls updateSwapOnRefund (SwapStore.ts:1274-1308), which marks the swap transaction.refunded with that txid, a final state: SwapDetails opens no socket and showRefundButton is never true for it (118-140, 1011-1018), fetchAndUpdateSwaps never polls it again (1063-1080), the list colours it green (302-306) and a later rescue keeps the existing entry (1552-1560). The refund screen shows no lockup or refund amount, and no step compares the refunded output's value with expectedAmount or with anything the user paid.

Attack (provider at the user-selected host): after the user has locked up, say, 1,000,000 sats in the swap's taproot output, the provider reports invoice.failedToPay and serves, as the swap's 'transaction', the hex of a real transaction it made itself paying a few thousand sats to the same lockup address (cheap; the script is public). The refund path spends that small output to the user's address (the provider cosigns the cooperative path, or the refund leaf validates after the timeout), returns a txid, and the swap is recorded as successfully refunded. The user's real lockup stays locked and invisible: in-app recovery is gone (final status, no refund button, rescue skips the known id) and the user has been told the refund completed. The provider cannot take the real lockup without the invoice preimage, so the outcome is griefing plus a false final payment state, with recovery only via the rescue mnemonic and external tooling once the user realises.

Assumption: the prebuilt Lndmobile builder selects the input by matching an output of transactionHex to lockupAddress (Boltz-style detectSwap); its source is not in this repository, but the JS/native signature gives it no amount to check against. This is distinct from submarine-swap-status-trusted-hides-refund (a provider status string suppressing the refund UI): here the refund UI runs and 'succeeds', and the trusted input is the lockup transaction endpoint; the fix for that finding (gating the refund on local block height or node settlement) leaves this path open. It also stands independently of submarine-swap-lockup-address-unverified, because a correctly scripted lockup still has no txid or amount bound to it in the app. The project's own verifyReverseLockup (SwapStore.ts:778-911) applies exactly the missing discipline in the reverse direction.

## Evidence
1. [stores/SwapStore.ts:408–448](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L408-L448)
   getLockupTransaction takes {id, hex, timeoutBlockHeight, timeoutEta} verbatim from the provider's GET /swap/submarine/{id}/transaction and persists it as the swap's lockupTransaction. Nothing decodes the hex, looks the txid up on the explorer, compares the output paying the lockup address with expectedAmount, or compares it with anything the user paid. This is where the provider's designation of 'the lockup transaction' enters and the place the fix must change.
2. [views/Swaps/Refund.tsx:87–107](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/Refund.tsx#L87-L107)
   broadcastRefund hands swapData.lockupTransaction.hex to the native createRefundTransaction as the transaction whose output to lockupAddress is to be spent, together with the user's refundPrivateKey, the swap tree leaves and the user's destination. Whatever output the provider's hex pays to the lockup address becomes the refunded UTXO.
3. [lndmobile/swaps.ts:122–169](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/lndmobile/swaps.ts#L122-L169)
   The native API signature (mirrored in lndmobile/LndMobile.d.ts:88-101, LncModule.kt:265 and ios/LncMobile/LncModule.mm:326) takes transactionHex and lockupAddress but no expected amount, so the prebuilt builder has nothing to check the spent output's value against even if it wanted to; the only value it can act on is the one in the provider's hex.
4. [views/Swaps/Refund.tsx:461–466](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/Refund.tsx#L461-L466)
   If no lockupTransaction is stored, the Initiate refund handler fetches it from the provider endpoint on the spot, so the provider is always the source of the hex. The screen shows no amount for the lockup or the refund (only destination, fee and a raw-details accordion), so the user has nothing to compare.
5. [views/Swaps/Refund.tsx:193–197](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/Refund.tsx#L193-L197)
   Any txid returned by the native builder is treated as a complete refund: updateSwapOnRefund is called and a success message with the txid is shown, with no check that the refunded output value approximates expectedAmount.
6. [stores/SwapStore.ts:1274–1307](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L1274-L1307)
   updateSwapOnRefund sets status transaction.refunded and txid. That status is final: SwapDetails.tsx:118-140 opens no socket for it and showRefundButton (1011-1018) is never true for it, fetchAndUpdateSwaps skips it (1063-1080), statusColor renders it green (302-306), and getRescuableSwaps keeps the existing stored entry (1552-1560).
7. [views/Swaps/SwapDetails.tsx:378–394](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L378-L394)
   The lockup transaction is fetched from the provider when the provider itself reports invoice.failedToPay / transaction.lockupFailed / swap.expired, i.e. the attacker chooses both the moment the refund path opens and the transaction it will spend.
8. [views/SendingOnChain.tsx:104–106](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingOnChain.tsx#L104-L106)
   The on-chain send flow knows it is part of a swap (isSwap from the route stack) and has TransactionsStore.txid, but records nothing against the swap; SwapStore has no field or write for a submarine lockup txid, so there is no local value to check the provider's hex against.
9. [stores/SwapStore.ts:778–829](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L778-L829)
   verifyReverseLockup shows the project's own standard for the reverse direction: the provider's hex is only a hint, the txid is looked up on the user's explorer and the output must pay the swap's address at least the swap's amount. No submarine counterpart exists for the refund path.

## Impact
Integrity: the app records and displays a successful refund that did not return the user's funds (false payment-state confirmation, an asset named by the threat model and SECURITY.md). Availability: the real lockup becomes unreachable through every in-app path (final status, no refund button, rescue skips the id) until recovered externally with the rescue mnemonic after the timeout. The provider cannot spend the lockup without the preimage, so no theft: both LOW.

## Reproduction steps
1. Attacker is the swap provider the user selected (default third-party hosts or a custom one), named as untrusted input by the project's threat model. The user completes a submarine lockup; the provider reports a failure status and serves a substitute lockup transaction (a small real output to the same address) from GET /swap/submarine/{id}/transaction. The user, following the app's refund prompt, taps Initiate refund; the app spends the substitute and records the swap as refunded. No ZEUS check stands in the way; requires only ordinary use of the feature and the refund action.

## Recommended fix
1. The transaction the refund spends, and therefore what 'refunded' means, is defined entirely by the provider's /swap/submarine/{id}/transaction response; the app never records the txid or amount it actually paid into the swap and never verifies the provider's hex against the chain. Fix criteria: When the on-chain send for a swap is broadcast from the app, store the resulting txid and amount against the swap; in all cases, before spending, verify the lockup transaction independently (decode the hex, look the txid up on the user's explorer or node, and require the output to the swap's lockup address to be at least expectedAmount), as verifyReverseLockup already does for reverse swaps, rejecting a provider-supplied hex whose matching output value is below that floor. Verify by serving a small alternate transaction to the lockup address and confirming the refund refuses it or targets the recorded lockup.
2. A refund txid from the native builder is treated as full recovery and the swap is finalised without the app knowing or showing the refunded value. Fix criteria: The swap may only be marked transaction.refunded when the refunded output value is at least the recorded or verified lockup amount (less the user's chosen fee); otherwise the swap stays open with the refund path available, and the refund screen and SwapDetails must show which output was refunded and how much.

---
**Severity:** LOW
**Status:** Open
**Category:** Missing data authenticity verification
**CWE:** [CWE-345](https://cwe.mitre.org/data/definitions/345.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258386

---

# NWC make_invoice writes shared InvoicesStore; Receive screen shows client's invoice, client can receive user's

## Details
The NWC wallet service creates make_invoice invoices through the app-wide InvoicesStore singleton and reads the result back from the shared observable `payment_request` (stores/NostrWalletConnectStore.ts:2266-2300) because `createUnifiedInvoice` returns only `{ rHash }` (InvoicesStore.ts:226-273). The same observable is what views/Receive.tsx renders as the user's QR code (1249-1275), while the screen's paid-watcher is bound to the rHash of the invoice it created itself (658-704).

Consequence 1 (deterministic, no race): while the user has the Receive screen open with an invoice displayed, any make_invoice request processed by the service runs `createInvoice`, which immediately sets `payment_request = null` (InvoicesStore.ts:321), then after the backend call and a fresh `getNewAddress` sets `payment_request` = the client's invoice and `onChainAddress` = a new address. The user's QR is replaced by an invoice whose amount and description were chosen by the external NWC client; the on-screen amount still shows the user's figure. A payer scanning it pays the client-chosen amount (e.g. 1 sat) to the user's node, the user's own invoice is never paid, the Receive/POS paid-watcher never fires (it watches the user's rHash), the POS order is never marked paid, and the NWC client is the party notified that "its" invoice settled. The client can repeat this at 5 requests/min per connection (checkMakeInvoiceLimits), keeping the user's screen on client-chosen invoices. The handler also clears `creatingInvoiceError`/`error_msg` the user may be looking at.

Consequence 2 (race): if a user-side `createUnifiedInvoice` or the POS reuse write (Receive.tsx:640) lands while the NWC call is pending and the NWC call's `getNewAddress` leg then fails (its catch returns undefined, leaving `payment_request` untouched), `unifiedInvoiceCreationFailed` is false because `payment_request` is a non-empty string, `rHash` is '', and `recordMakeInvoiceActivity` (2060-2096) matches the user's Invoice by payment request and returns the user's invoice and payment hash to the client. The connection then receives payment_received / lookup_invoice state (and, via reconcilePendingLightningMakeInvoice, the preimage) for an invoice the user created privately.

The threat model lists NWC clients as external principals and requires receipt state to be truthful; here an external client with only make_invoice permission controls which invoice the user's Receive screen presents. The root cause is that InvoicesStore exposes invoice creation results only through mutable singleton fields with no ownership, and the service flow and the UI flow both read and write them.

## Evidence
1. [stores/NostrWalletConnectStore.ts:2274–2299](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2274-L2299)
   The lightning path of handleMakeInvoice clears the shared creatingInvoiceError/error_msg flags, calls invoicesStore.createUnifiedInvoice (without skipOnchain, so getNewAddress also runs on on-chain-capable backends) and then takes the invoice to hand to the client from the shared observable invoicesStore.payment_request rather than from the call's own result. The failure predicate accepts any non-empty string in that field; invoiceResult undefined only yields rHash ''. Whatever another flow last wrote is recorded as this connection's make_invoice activity and returned.
2. [stores/InvoicesStore.ts:319–324](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/InvoicesStore.ts#L319-L324)
   createInvoice synchronously nulls payment_request and payment_request_amt at the start of every call, including the NWC service's. A Receive screen currently displaying an invoice loses it the moment any make_invoice request is processed.
3. [stores/InvoicesStore.ts:226–272](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/InvoicesStore.ts#L226-L272)
   createUnifiedInvoice writes the new paymentRequest (and onChainAddress) into the singleton after getNewAddress resolves and returns only { rHash } to its caller, so no caller can get its own invoice except via the shared field. On getNewAddress failure the catch returns undefined and leaves payment_request as whatever another flow wrote.
4. [views/Receive.tsx:1249–1274](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L1249-L1274)
   The QR / copy values shown to the user (unified bitcoin: URI with lightning= param and the bare lightning invoice) are built from InvoicesStore.payment_request and onChainAddress, i.e. from whatever the singleton currently holds, while the amount parameter comes from the screen's own satAmount state.
5. [views/Receive.tsx:658–703](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L658-L703)
   Receive's own createUnifiedInvoice call subscribes the paid-watcher to the rHash it received (the user's invoice). The displayed invoice and the watched invoice therefore diverge once an NWC make_invoice rewrites payment_request: a payer paying the displayed QR never triggers the user's received screen.
6. [views/Receive.tsx:638–642](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L638-L642)
   The POS reuse path writes InvoicesStore.payment_request directly without nulling, a further writer that can land while an NWC createUnifiedInvoice is awaiting getNewAddress and be returned to the client.
7. [stores/NostrWalletConnectStore.ts:2060–2095](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2060-L2095)
   recordMakeInvoiceActivity looks up the invoice by rHash OR paymentRequest, so with rHash '' and a foreign payment_request it attaches the user's own Invoice object to the connection activity; lookup_invoice / notifications then report that invoice's settlement to the client.

## Impact
Integrity LOW: the invoice the user presents to a payer is replaced by one with client-chosen amount and memo; the user's intended invoice goes unpaid, the paid-watcher and POS order never resolve, and the connection's activity can record the user's own invoice as the client's. Funds still land on the user's node, so no theft. Confidentiality LOW: in the race direction the client is handed the user's private invoice and is notified (with preimage via activity refresh) when it settles; in the deterministic direction it learns when and how much a payer paid during the user's receive session. Availability NONE.

## Reproduction steps
1. Attacker is an external NWC client app holding a connection with make_invoice permission (PR LOW), reached over Nostr relays while the app is foregrounded (AV NETWORK). It sends make_invoice with any amount/description; no race is needed for the primary effect because createInvoice unconditionally nulls and then rewrites the field the Receive screen renders (AC LOW, AT NONE). The user only has to be on the Receive/POS screen presenting an invoice (UI PASSIVE). The reverse direction (client handed the user's invoice) additionally needs a concurrent user invoice and a getNewAddress failure or POS reuse write, i.e. a race.

## Recommended fix
1. handleMakeInvoice obtains the invoice to return from the shared observable invoicesStore.payment_request instead of from the result of the createUnifiedInvoice call it made, so another flow's write can be recorded and returned as the client's invoice. Fix criteria: The NWC handler returns and records only the payment request produced by its own call (e.g. createUnifiedInvoice/createInvoice return paymentRequest alongside rHash, or the handler decodes the returned rHash against the created invoice). Verification: with a concurrent user invoice creation or POS reuse write and a failing getNewAddress, the client receives an error or its own invoice, never a payment request whose hash differs from the rHash it created.
2. Service-initiated invoice creation mutates the same InvoicesStore fields (payment_request, payment_request_amt, onChainAddress, creatingInvoice, error flags) that the Receive screen renders, so an external client can replace the invoice the user is presenting. Fix criteria: Service-originated make_invoice must not write the UI-facing invoice fields: use a side-effect-free creation path (direct backend call with isolated state) or scope the fields to the flow that created them. Verification: with the Receive screen showing an invoice, processing an NWC make_invoice leaves the displayed QR, amount and on-chain address unchanged, and the displayed invoice always equals the one the screen's paid-watcher observes.

---
**Severity:** LOW
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258385

---

# LNURL-pay successAction and domain rendered unvalidated; non-string JSON crashes the payment success screen

## Details
ZEUS stores and renders two LNURL-pay server fields without any type validation and with no React ErrorBoundary or global JS error handler anywhere in the app (none in App.tsx, index.js, shim.js, polyfills.js or components/), so a server can make the wallet UI throw during render exactly when it is showing the user that a payment succeeded.

Sources: on the lightning-address path utils/handleAnything.ts:755-786 (both the Tor and clearnet branches) and components/LayerBalances/LightningSwipeableRow.tsx:208-222 pass the first-hop /.well-known/lnurlp JSON straight into LnurlPay as lnurlParams after checking only that `callback` exists; its `domain` member is therefore whatever JSON value the server chose (js-lnurl's getParams, which derives a string domain from the URL, is used only on the bech32-LNURL path). On every path views/LnurlPay/LnurlPay.tsx:390 takes the second-hop `successAction` verbatim (`data.successAction || { tag: 'noop' }`). `isValidPayRequest` (LnurlPay.tsx:78-86) checks callback/minSendable/maxSendable only and `verifyLnurlPayInvoice` checks the invoice binding only; nothing checks that tag/message/description/url/domain are strings. Before payment `domain` is only used in template strings (LnurlPay.tsx:318,348) and as `lightningAddress || domain` (LnurlPay.tsx:560, where lightningAddress is set on this path), so a non-string domain does not surface until after payment.

Storage: LnurlPay.tsx:439-448 / 484-492 call LnurlPayStore.keep(payment_hash, domain, ..., successAction) before the user confirms; stores/LnurlPayStore.ts:83-108 persists the object under 'lnurlpay:<paymentHash>' (storage/index.ts:111-112 JSON.stringifies non-string values) and keeps it in the observable store.

Sink: after the node (views/SendingLightning.tsx:475-495; payment_hash from TransactionsStore) or the mint (views/Cashu/CashuSendingLightning.tsx:346-365; payment_hash from CashuStore.payReq) reports success, LnurlPaySuccess is rendered. views/LnurlPay/Success.tsx:57-118 places `message`, `description`, `url` and `domain` directly as children of <Text>. React's reconciler rejects a plain object child ('Objects are not valid as a React child') and, with no error boundary, unmounts the whole root. Because `successAction` defaults to {tag:'noop'} (truthy) the 'Serviced by' line (Success.tsx:116-120, 135, 160) is rendered for every LNURL-pay payment with a truthy domain, so a lightning-address server only needs `"domain": {}` in its first-hop JSON; any LNURL-pay server can use `successAction: {tag:'message', message: {}}` (or an object in description/url).

Concrete malicious server: /.well-known/lnurlp/alice returns {callback:'https://evil.example/cb', minSendable:1000, maxSendable:1000000, metadata:'[["text/plain","alice"]]', domain:{}}; the callback returns a correctly bound invoice (amount and description_hash pass verifyLnurlPayInvoice) with successAction {tag:'message', message:{x:1}}. The user reviews and pays as normal. The payment settles, SendingLightning starts rendering the success view, and the React tree is torn down before the success state, preimage or fee is shown. The persisted record then makes views/LnurlPay/Historical.tsx (loaded by Payment.tsx:65-69 and rendered at 194-200 for that payment hash; hasSuccessDetails is true for a truthy domain) throw again whenever the user taps to expand the LNURL panel, so that payment's success-action/receipt panel is permanently unviewable in the app; the rest of the payment detail (amount, fee, preimage) still renders because the panel is collapsed by default.

Assumption on dependency behaviour: with react 19.2.8 and react-native 0.87.1 (package.json), an uncaught render error unmounts the root and is handed to React's reportGlobalError; whether RN then terminates the process (fatal exception) or leaves a blank root (shim.js installs the `process` 0.11.10 browser polyfill whose `emit` is a no-op, which can swallow the report) could not be settled from the checkout. In either case the wallet UI is unusable until the user relaunches the app.

Impact: the server is paid, and the user is denied the in-app confirmation at the moment it matters; after relaunch the node's own payment record is truthful, so this is an availability impact on the wallet UI (one-time at success, persistent for that payment's LNURL panel) rather than a falsified payment state. The verified finding lnurl-pay-success-action-url-arbitrary-scheme covers the Linking.openURL sink of the same unvalidated object; this record is the different sink (type-unsafe render / persistent throw) and the additional source (`domain` from the lightning-address first hop).

## Evidence
1. [views/LnurlPay/Success.tsx:56–120](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LnurlPay/Success.tsx#L56-L120)
   LnurlPaySuccess destructures tag/description/url/message from the service-supplied successAction and places them directly as children of <Text> (message at 68, description/url at 81/89, description at 107); the service-supplied domain is rendered as a Text child at 118 for every tag including the default noop. A JSON object in any of these fields makes React throw 'Objects are not valid as a React child' during render.
2. [views/LnurlPay/LnurlPay.tsx:390–392](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LnurlPay/LnurlPay.tsx#L390-L392)
   Second-hop callback JSON: successAction is taken as-is (`data.successAction || { tag: 'noop' }`); tag, message, description, url are never checked to be strings (LUD-09 requires strings, message <= 144 chars).
3. [views/LnurlPay/LnurlPay.tsx:439–447](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LnurlPay/LnurlPay.tsx#L439-L447)
   The unvalidated successAction and `domain` (state copied from lnurlParams.domain at line 259) are handed to LnurlPayStore.keep before the user confirms payment; same at 484-492 for the non-ecash path.
4. [utils/handleAnything.ts:755–785](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L755-L785)
   First hop for lightning addresses: the served /.well-known/lnurlp JSON is passed verbatim as lnurlParams (only `callback` presence is checked), so `domain` is a server-chosen JSON value of any type rather than the host that was contacted (js-lnurl is not used on this path). components/LayerBalances/LightningSwipeableRow.tsx:208-222 is the identical second entry point.
5. [stores/LnurlPayStore.ts:83–107](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LnurlPayStore.ts#L83-L107)
   The values are persisted under 'lnurlpay:<paymentHash>' (Storage.setItem JSON-stringifies objects) and kept in the observable store, so the malformed record outlives the session.
6. [views/SendingLightning.tsx:475–494](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingLightning.tsx#L475-L494)
   On payment success the screen renders LnurlPaySuccess with LnurlPayStore.domain and LnurlPayStore.successAction whenever the paid hash matches; successAction is always truthy (noop default), so even a bad `domain` alone reaches the render.
7. [views/Cashu/CashuSendingLightning.tsx:346–364](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/CashuSendingLightning.tsx#L346-L364)
   Ecash sibling renders the same component on melt success; payment_hash there comes from Bolt11Utils like the stored hash, so the match always holds.
8. [views/LnurlPay/Historical.tsx:33–74](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LnurlPay/Historical.tsx#L33-L74)
   The persisted record is re-rendered from payment history (Payment.tsx:65-69 loads it by payment hash); hasSuccessDetails is true for a truthy domain, and tapping the panel renders LnurlPaySuccess again, so the payment detail view for that payment crashes on every attempt.

## Impact
Availability: the React root is torn down (app terminates or shows a blank root, depending on RN 0.87.1's handling of React 19's uncaught-error report) at the success screen, and the affected payment's LNURL panel throws on every expand (persistent per stored record); the rest of the app recovers on relaunch and the node's payment history still lists the payment. Integrity: the app displays no false payment state and the stored node-side record is truthful, so no integrity impact is rated; the user merely does not see the in-app success confirmation. No confidentiality impact.

## Reproduction steps
1. Attacker operates any LNURL-pay service or lightning-address host the user chooses to pay (QR, deep link, contact, or typed address). First-hop `domain` or second-hop `successAction` carries a JSON object instead of a string. The user performs an ordinary payment review and confirmation; no other condition is needed, the invoice still passes the amount/description_hash binding (verifyLnurlPayInvoice does not look at these fields), and the throw occurs deterministically on the success render and again from history whenever the panel is expanded.

## Recommended fix
1. LnurlPay accepts the second-hop successAction object without validating that tag is one of the LUD-09/LUD-10 tags and that message/description/url/ciphertext/iv are strings within the specified lengths, then persists and renders it. Fix criteria: A successAction that is not an object with a known tag and string-typed fields of bounded length is replaced by {tag:'noop'} before LnurlPayStore.keep; rendering a payment whose server returned successAction {tag:'message', message:{}} shows the success screen normally and the history panel opens without throwing.
2. The lightning-address first hop passes the served JSON straight into LnurlPay, so `domain` is a server-chosen value of any type rather than the host that was contacted. Fix criteria: On the lightning-address paths (handleAnything and LightningSwipeableRow) `domain` is set by the app from the host it fetched (as js-lnurl does), or coerced to a string and otherwise dropped; a server returning a non-string domain neither crashes the success view nor controls the 'Serviced by' text.
3. LnurlPaySuccess and Historical render stored server fields as React children with no type guard and the app has no ErrorBoundary, so a single malformed record turns into a fatal exception at success time and on every later view. Fix criteria: Success.tsx renders only string values (coercing or omitting others) and the success/payment screens are wrapped so a render error in the LNURL panel cannot unmount the success state; after the fix a stored record with object-valued fields displays the payment as successful.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258383

---

# LDK keysend pending result carries payment_route, rendering an unsettled payment as Success

## Details
SendingLightning decides 'success' with `transactionStore.payment_route || status === 'complete' || status === 'SUCCEEDED' || status === 2` (views/SendingLightning.tsx:329-336). The payment_route clause exists for LndHub, whose /payinvoice response carries a real route and no status. The LDK Node backend reuses that field as a placeholder: sendKeysend (backends/LdkNode.ts:1464-1475) returns `payment_route: {}` on both branches, including the pending branch where awaitPaymentCompletion (2021-2035) gave up after the user's payment timeout with the HTLC still outstanding and status is set to 'IN_FLIGHT'. TransactionsStore.handlePayment (815-818, 853-884) stores payment_route = {} and status = 'IN_FLIGHT' without error. SendingLightning then evaluates success = {} (truthy) and inTransit = true at the same time and renders PaymentSuccessView (paid indicator, success animation, 'Success', an amount) above the in-transit clock (424-470); componentDidUpdate runs the success side-effects (162-169) and fetchPayments (287-304) picks the amount to display from any recent LDK payment whose payment_preimage is '' (formatPayment reports '' for all non-succeeded payments, 2130-2135), so the figure under 'Success' may belong to a different pending or failed payment.

The trigger is controlled by the counterparty: the keysend destination (or any routing hop) holds the HTLC instead of settling or failing it. LDK keeps the HTLC in flight past paymentTimeoutSecs (default 60 s, from settings.payments.timeoutSeconds), the poll loop ends with status 'pending', and the pending shape above is returned. The attacker can later fail the HTLC, returning the funds, after the user has been shown and acted on a 'Success' screen. The threat model lists truthful payment state ('no fake success') as a protected asset; this is a false success for a payment that has not settled, reachable in the shipped LDK Node (embedded) backend for keysend only. The sibling payOffer pending result (1886-1892) omits payment_route and is rendered correctly as in-transit, and the verified finding sending-lightning-retry-offered-for-timed-out-keysend covers the opposite misclassification (unknown outcome shown as failure with retry); this record is the success-side misread of a backend-specific result shape by the generic handler.

No funds are misdirected: the impact is that the user (and anything they tell the recipient) treats an unresolved keysend as paid; no retry control is offered, so there is no double-send.

## Evidence
1. [views/SendingLightning.tsx:329–336](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingLightning.tsx#L329-L336)
   successfullySent() returns truthy whenever TransactionsStore.payment_route is truthy, without factoring in status. An empty object {} satisfies it, so a result whose status says IN_FLIGHT is still classified as a success.
2. [backends/LdkNode.ts:1464–1476](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LdkNode.ts#L1464-L1476)
   sendKeysend awaits completion with pendingOnTimeout and, when the payment is still pending, returns {payment_hash, payment_preimage: '', fee_msat: '0', payment_route: {}, status: 'IN_FLIGHT'}. The payment_route: {} placeholder is emitted on the pending branch as well as the success branch.
3. [backends/LdkNode.ts:2021–2035](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LdkNode.ts#L2021-L2035)
   awaitPaymentCompletion returns {pending: true, preimage: ''} when the payment is neither succeeded nor failed after timeoutSecs+5 polls, i.e. when the recipient or a hop has held the HTLC past the user's payment timeout (default 60 s, TransactionsStore.ts sets timeout_seconds || 60 for ldk-node).
4. [stores/TransactionsStore.ts:815–818](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L815-L818)
   handlePayment copies result.payment_route into the observable payment_route unconditionally, before evaluating status.
5. [stores/TransactionsStore.ts:853–883](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L853-L883)
   For status 'IN_FLIGHT' no error is set (IN_FLIGHT is explicitly exempt) and this.status = 'IN_FLIGHT'; the store therefore holds payment_route = {} and status = IN_FLIGHT simultaneously.
6. [stores/TransactionsStore.ts:737–745](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L737-L745)
   sendPayment routes a keysend (pubkey set) on the ldk-node implementation to BackendUtils.sendKeysend, so the Send screen's keysend flow reaches LdkNode.sendKeysend and its pending result shape.
7. [views/SendingLightning.tsx:424–469](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingLightning.tsx#L424-L469)
   Render shows PaymentSuccessView (PaidIndicator, SuccessAnimation, 'Success' text and an amount) whenever !!success && !error, and separately the in-transit clock whenever !!inTransit && !error; with both true the user is told the payment succeeded while it is still unresolved.
8. [views/SendingLightning.tsx:148–169](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingLightning.tsx#L148-L169)
   componentDidUpdate treats the truthy successfullySent() as a completed payment: it flips wasSuccessful, refreshes balances/channels and fetches the payment to display, so the success side-effects run for a pending keysend.
9. [views/SendingLightning.tsx:287–303](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingLightning.tsx#L287-L303)
   fetchPayments matches the displayed payment by payment_preimage === TransactionsStore.payment_preimage, which is '' for the pending result, so the amount shown under 'Success' is taken from whichever listed LDK payment first has an empty preimage (pending or failed), not necessarily this one.
10. [backends/LdkNode.ts:2130–2134](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LdkNode.ts#L2130-L2134)
   formatPayment deliberately reports payment_preimage '' for every non-succeeded payment, which is what makes the empty-preimage match above ambiguous.
11. [backends/LdkNode.ts:1882–1892](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LdkNode.ts#L1882-L1892)
   The sibling payOffer pending result omits payment_route and is therefore rendered only as in-transit; sendKeysend is the one LDK pending shape that also carries payment_route.
12. [views/SendingLightning.test.tsx:106–121](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingLightning.test.tsx#L106-L121)
   The project's own test pins the intended behaviour for 'LdkNode reports a keysend ... still pending at its timeout': in-transit text, no success. It renders {status: 'IN_FLIGHT'} without the payment_route: {} the real sendKeysend result carries, so the shipped shape is not exercised and the success rendering goes unnoticed.

## Impact
The payment status shown to the user is false: an unsettled keysend, which the recipient can still fail so that funds return, is presented with the paid indicator, success animation, 'Success' text, an amount that may belong to another payment, and the success side-effects run. Integrity of payment-state reporting is affected (LOW), an asset the threat model names ('no fake success'); no funds are misdirected and no retry control is offered, so there is no overpayment or double-send; no confidentiality or availability effect.

## Reproduction steps
1. Attacker is the keysend recipient or a routing node on the path, reached over the Lightning network (AV NETWORK). Delivery: the victim, on an LDK Node (embedded) wallet, sends a keysend to or through the attacker (active user interaction); the attacker accepts the HTLC and withholds settlement or failure for longer than the victim's payment timeout (default 60 s), which any node under the attacker's control can do (hold-HTLC behaviour). Nothing outside the attacker's control must be present: the hold is entirely theirs, and once awaitPaymentCompletion returns pending the success rendering is deterministic (AT NONE, AC LOW). No ZEUS privilege or defence bypass is required.

## Recommended fix
1. SendingLightning.successfullySent treats any truthy payment_route as proof of success, independent of the result's status, so a backend result that is explicitly IN_FLIGHT is still rendered as paid. Fix criteria: Success must require a terminal success status (or a non-empty preimage) and must be mutually exclusive with the in-transit state; a result with status IN_FLIGHT must render only the in-transit view regardless of payment_route. Verify with a result {payment_route: {}, status: 'IN_FLIGHT', payment_preimage: ''} that no success indicator, success side-effect or PaymentDetailsSheet appears.
2. LdkNode.sendKeysend emits the payment_route: {} placeholder on its pending branch, a shape the generic handler reads as LndHub-style success. Fix criteria: The pending (IN_FLIGHT) result from sendKeysend must not carry a truthy payment_route (match payOffer's pending shape), and the success-side result should only be returned once a preimage is known. Verify that a timed-out LDK keysend reaches SendingLightning as in-transit only.

---
**Severity:** LOW
**Status:** Open
**Category:** Incomplete comparison
**CWE:** [CWE-1023](https://cwe.mitre.org/data/definitions/1023.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258382

---

# Reverse swap on-chain amount floor omits claim fee, provider may underdeliver versus quoted receive amount

## Details
createReverseSwap (stores/SwapStore.ts:650-687) is where ZEUS binds the provider's reverse-swap response to what the user agreed to on the Swaps screen. The Swaps screen quotes outputSats = inputSats - ceil(inputSats*pct/100) - (claimMinerFee + lockupMinerFee) as the amount the user will receive (views/Swaps/index.tsx:170-177, 1107-1113; utils/SwapUtils.ts:600-615). The provider's `onchainAmount` is the value of the lockup output; the user's payout is that value minus the claim transaction's miner fee, which the project itself models as getReverseSwapReceiveAmount = onchainAmount - claimMinerFee (SwapStore.ts:206-212), freezes into the swap at creation (713) and, per FeeUtils.ts:72-84, hands to the native claim builder as an absolute fee.

The floor handed to verifyReverseSwapResponse is `minOnchainAmount = calculateReceiveAmount(invoiceAmount, pct, claim + lockup, true)`, i.e. the quoted post-claim-fee payout itself, and the check is `onchainAmount > minOnchainAmount` (SwapUtils.ts:354-359). Because the claim fee is subtracted after this check, a provider may lock up as little as quotedReceive + 1 and still pass; the user then receives quotedReceive + 1 - claimMinerFee. The later pre-claim lockup check uses minAmount = swap.onchainAmount, the provider's own figure (SwapStore.ts:861-891), so nothing downstream restores the floor and the claim is built automatically once the lockup confirms. The shortfall is bounded by the provider's quoted claim fee, which the provider sets freely. With the maintainers' own vector (SwapStore.reverseLockup.test.ts:154-175: 100,000 sats, 0.5%, claim 300, lockup 400, 'Swaps screen shows 98,800') a provider answering onchainAmount 98,801 is accepted and the user receives 98,501; the only rejection vector tested is 1000.

The lockup the quote implies, and what an honest Boltz-protocol server returns, is invoiceAmount - ceil(pct) - lockupMinerFee (= quotedReceive + claimMinerFee; 99,100 in the vector). SwapDetails later displays getReverseSwapReceiveAmount(onchainAmount, claimMinerFee) above the 'Pay invoice' button (SwapDetails.tsx:1186-1202, 1256-1272), so a careful user could notice the lower figure before paying, but the creation-time check exists precisely so that the app, not the user, enforces the quote; the comment at SwapStore.ts:650-654 and the test name 'an on-chain amount below what the user was shown' say exactly that and the code does not deliver it. A provider can therefore skim up to claimMinerFee-1 sats on every reverse swap relative to the amount the app displayed, without failing any check.

Assumption outside this repository: the prebuilt Lndmobile claim builder (pinned by fetch-libraries.sh) pays `minerFee` as an absolute fee from the lockup output, as FeeUtils.ts:72-84 documents and as getReverseSwapReceiveAmount models.

## Evidence
1. [stores/SwapStore.ts:650–673](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L650-L673)
   minOnchainAmount = calculateReceiveAmount(invoiceAmount, pct, claim + lockup, true) is the exact post-claim-fee 'you receive' figure the Swaps screen displayed. It is passed as the floor for responseData.onchainAmount, which is the lockup output value from which the claim miner fee is still to be deducted. The comment states the intent (provider must lock up at least what the Swaps screen showed) but the floor is lower than the lockup the quote implies by exactly the claim miner fee, so onchainAmount down to quotedReceive+1 passes and the user ends up to claimMinerFee-1 sats short.
2. [utils/SwapUtils.ts:354–358](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/SwapUtils.ts#L354-L358)
   The only creation-time amount check on the provider's response: Number(onchainAmount) > minOnchainAmount. Nothing relates onchainAmount to the claim fee that will come out of it.
3. [stores/SwapStore.ts:202–211](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L202-L211)
   claimMinerFee is the provider's quoted claim fee; getReverseSwapReceiveAmount = onchainAmount - claimMinerFee is the project's own definition of what the user receives from a lockup of onchainAmount, confirming the lockup value is pre-claim-fee. Line 713 freezes this fee into the swap, and FeeUtils.ts:72-84 documents that the native claim pays it as an absolute fee.
4. [utils/SwapUtils.ts:600–614](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/SwapUtils.ts#L600-L614)
   calculateReceiveAmount for reverse subtracts the full minerFee the caller passes (claim + lockup) from the send amount; the Swaps screen displays this value as the output the user will receive.
5. [views/Swaps/index.tsx:170–176](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/index.tsx#L170-L176)
   networkFee for reverse swaps is claim + lockup miner fee from the provider's fee table; outputSats = calculateReceiveAmount(inputSats, serviceFeePct, networkFee, reverse) at 1107-1113 is what the user is shown before tapping Initiate, and networkFee is shown as 'Network fee' at 1630-1640.
6. [stores/SwapStore.ts:861–890](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L861-L890)
   The pre-claim lockup check (verifyReverseLockup -> checkLockupOutput) uses minAmount = swap.onchainAmount, the provider's own returned figure, so no later check restores the floor the quote implies; a lockup of quotedReceive+1 passes here too and the claim is built automatically.
7. [views/Swaps/SwapDetails.tsx:1186–1201](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L1186-L1201)
   SwapDetails displays getReverseSwapReceiveAmount(onchainAmount, claimMinerFee) above the 'Pay invoice' button (1256-1272), so the lower figure is visible to a user who re-reads it; this is the only remaining guard and relies on the user noticing a discrepancy from the previous screen.
8. [stores/SwapStore.reverseLockup.test.ts:154–174](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.reverseLockup.test.ts#L154-L174)
   Maintainers' vector: 100,000 sats invoice, 0.5%, claim 300 + lockup 400, 'Swaps screen shows 98,800 to receive', honest onchainAmount 99,100 (= 100,000 - 500 - 400). The only rejection case tested (236-239) is onchainAmount 1000; with the floor at 98,800 a provider answering 98,801 is accepted and after the 300-sat claim fee the user receives 98,501.

## Impact
The amount delivered differs from the amount the app showed and claims to enforce, by up to the provider-quoted claim fee (hundreds to a few thousand sats on typical quotes; a larger claim quote would be visible as a larger 'Network fee' on the Swaps screen). It is a bounded skim rather than loss of the swap, and the lower figure is visible on SwapDetails before payment, so integrity LOW. No confidentiality or availability effect.

## Reproduction steps
1. Attacker is the swap provider at the host the user selected, a named adversary in the threat model. The user requests a reverse swap and the Swaps screen quotes a receive amount; the provider returns onchainAmount just above that quote instead of quote + claimFee. All creation-time checks pass, the swap is saved and offered for payment, the lockup check accepts the provider's own figure, and after the automatic claim the user receives up to claimFee-1 sats less than quoted. No shipped control has to be switched off; works on every deployment. The user must initiate the swap and tap Pay invoice (UI:A).

## Recommended fix
minOnchainAmount is the post-claim-fee receive amount shown to the user while onchainAmount is the pre-claim-fee lockup value, so the floor is lower than the lockup the quote implies by exactly the claim miner fee. Fix criteria: The floor passed to verifyReverseSwapResponse must be the lockup value the quote implies (quoted receive amount plus the claim miner fee that will be deducted, i.e. invoiceAmount - service fee - lockup miner fee), so that onchainAmount - claimMinerFee >= the amount the Swaps screen displayed; equivalently, verify getReverseSwapReceiveAmount(onchainAmount, claimMinerFee) against the displayed receive amount. Add a boundary test with the existing vector: onchainAmount 98,801 (and anything below 99,100 when the claim fee is 300) must be rejected as onchain-amount-low.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258381

---

# LSPS7 order response fields from LSP rendered untyped; non-array/object values crash the order screen

## Details
ZEUS speaks LSPS7 (channel-lease extension) to the user's configured LSP (default: ZEUS's Olympus pubkey, SettingsStore.ts 1356; user-replaceable in LSPS1 Settings) over LSPS0 JSON-RPC carried in Lightning custom messages (type 37913) when the backend is LND, embedded LND or LNC. `LSPStore.handleCustomMessages` (stores/LSPStore.ts 776-790) JSON.parses the peer's message and, when `data.id` matches the pending request id, stores the entire decoded object in the observable `createExtensionOrderResponse` (850) or `getExtensionOrderResponse` (862) without validating the shape of `result`. The LSPS7 screen then renders `result` through `views/LSPS7/OrderResponse.tsx` (index.tsx 378-388; Order.tsx 193-198 for an order opened from history).

OrderResponse assumes the LSP honours the spec's field types. Two sinks break when it does not:

1. `channel.extension_order_ids` is guarded only by truthiness and `.length !== 0` (142-143) before `.join(', ')` (148). A JSON string such as `"extension_order_ids": "x"`, a number, or a plain object (whose `.length` is undefined, so the `!== 0` guard passes) reaches `.join`, which is not a function: TypeError thrown inside render.

2. `order_id` (46), `channel.short_channel_id` (104), `channel.original_order.id` (131) and `channel.original_order.service` (138) are passed uncoerced into `KeyValue`'s `value`. KeyValue (components/KeyValue.tsx 105-109, 237-239) treats any non-string/non-number value as a pre-built element and renders it directly as a React child (`Value = typeof value === 'object' ? value : ValueBase`). A plain JSON object in any of those fields produces React's 'Objects are not valid as a React child' render error.

The repository has no React error boundary and no global JS exception handler, so in a release build the exception reaches React Native's fatal handler and the process terminates (dependency assumption: react-native 0.87.1 / react 19.2.8 as pinned in package.json route an uncaught render error with no boundary to ErrorUtils.reportFatalError, which in release builds terminates the app).

Persistence: for the live create_order path the response is in-memory only (reset by resetLSPS7Data), so the crash recurs only while the user retries the extension. For get_order, however, views/LSPS7/Order.tsx 94-124 calls setState and then `updateOrderInStorage` synchronously in the same callback when the LSP reports order_state COMPLETED or FAILED, so a malformed reply is written to LSPS_ORDERS_KEY before React renders it; every later open of that order from the orders history (Order.tsx 61-80, 193-198) renders the stored object and crashes again. The free-order poller (LSPStore.ts 1733-1751) persists the same way.

The attacker is the operator of the LSP the user has configured (or whoever controls its LSPS7 responder), a party the recorded threat model lists as a third-party server whose responses are untrusted data. The LDK-native LSPS7 path (LSPStore.ts 1428-1440, LdkNode.ts 1726-1756) maps typed native structs and is not affected, so the condition is: LND-family backend using the custom-message transport. The LSPS1 sibling (views/LSPS1/OrderResponse.tsx) does not `.join`/`.map` any field, but shares the KeyValue object-render exposure for its string fields.

This is a low-severity availability defect; it is the LSP sibling of the mint-info class already on record (cashu-mint-info-unvalidated-shape-crashes-wallet-on-launch), which names KeyValue's object render as the same sink.

## Evidence
1. [views/LSPS7/OrderResponse.tsx:142–152](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LSPS7/OrderResponse.tsx#L142-L152)
   The only guard on the LSP-supplied `channel.extension_order_ids` is truthiness and `.length !== 0`. A non-empty string, a number or a plain object (whose `.length` is undefined, so `undefined !== 0` passes) reaches `.join(', ')`, which throws TypeError synchronously inside render.
2. [views/LSPS7/OrderResponse.tsx:42–48](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LSPS7/OrderResponse.tsx#L42-L48)
   `orderResponse.order_id` is passed straight into KeyValue `value`; the same is done for `channel.short_channel_id` (102-106), `channel.original_order.id` (127-133) and `channel.original_order.service` (134-139). None is coerced to a string first.
3. [components/KeyValue.tsx:105–108](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/KeyValue.tsx#L105-L108)
   isCopyable is true only for string/number values, so for an object value the component falls through to line 238.
4. [components/KeyValue.tsx:237–238](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/KeyValue.tsx#L237-L238)
   `Value = typeof value === 'object' ? value : ValueBase` renders a plain (non-element) object directly as a React child at line 249. React throws 'Objects are not valid as a React child' during render for an object such as {"a":1} supplied by the LSP in any of the fields above.
5. [stores/LSPStore.ts:776–789](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L776-L789)
   handleCustomMessages JSON.parses the LSP peer's custom message (type 37913) body and dispatches on `data.id` with no schema or type validation of `data.result`.
6. [stores/LSPStore.ts:843–866](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L843-L866)
   For the create_order reply the whole decoded message is stored as-is in the observable `createExtensionOrderResponse = data` (850); for the get_order reply likewise in `getExtensionOrderResponse = data` (862).
7. [views/LSPS7/index.tsx:378–387](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LSPS7/index.tsx#L378-L387)
   LSPS7/index.tsx derives `result = createExtensionOrderResponse?.result` (203-206) and, as soon as it is non-empty and has a `payment`, renders <LSPS7OrderResponse orderResponse={result}>. No field types are checked before render.
8. [views/LSPS7/Order.tsx:94–123](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LSPS7/Order.tsx#L94-L123)
   When the LSP's get_order reply arrives, Order.tsx calls setState({order}) and then, if order_state is COMPLETED or FAILED, `LSPStore.updateOrderInStorage` synchronously in the same callback, so the malformed reply is persisted to LSPS_ORDERS_KEY before React renders it and crashes. Every later open of that order from the history list (lines 61-80 load `temporaryOrder.order` from storage and render it at 193-198) crashes again until the stored order is removed.
9. [stores/LSPStore.ts:1733–1750](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L1733-L1750)
   The free-order poller copies a COMPLETED/FAILED get_order reply into `createExtensionOrderResponse` and into storage via updateOrderInStorage, a second route by which a malformed LSP reply reaches both the live LSPS7 screen and persisted order history.
10. [stores/LSPStore.ts:1428–1439](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L1428-L1439)
   Contrast: the LDK-native LSPS7 path maps a typed native struct (ch.extensionOrderIds etc.; LdkNode.ts 1726-1756 likewise builds the order from named fields), so the unvalidated path is specifically the LND-family custom-message (LSPS0 JSON-RPC over BOLT8) transport (LND.ts 1075, EmbeddedLND.ts 652, LightningNodeConnect.ts 1174 return supportsLSPScustomMessage true).
11. [App.tsx](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/App.tsx) (whole file)
   App.tsx, index.js, shim.js and polyfills.js contain no React error boundary and no global JS exception handler (no ErrorBoundary / componentDidCatch / ErrorUtils / setJSExceptionHandler anywhere in first-party code), so an uncaught render exception reaches React Native's fatal handler.

## Impact
Impact is a process crash of the wallet each time the extension-order result is rendered. The response is not persisted, so the app recovers on relaunch and no funds, keys or approvals are affected; the user cannot complete an LSPS7 extension with that LSP while it serves the payload. Availability LOW; no confidentiality or integrity impact.

## Reproduction steps
1. Attacker operates the LSP the user has selected and holds a channel with (AT:PRESENT: a configured LSP on an LND-family backend that uses the custom-message transport). The user opens the LSPS7 channel-extension screen and submits an order (UI:ACTIVE). The LSP replies to the lsps7.create_order request with a well-formed JSON-RPC message whose result has `extension_order_ids` as a string or `order_id`/`short_channel_id` as an object. handleCustomMessages stores it raw; LSPS7/index.tsx renders OrderResponse; `.join` or React's object-child check throws in render; with no error boundary the app terminates. Network attacker over the Lightning peer connection (AV:NETWORK), no privileges, no protective mechanism to defeat (AC:LOW).

## Recommended fix
1. LSPS0/LSPS7 JSON-RPC results received over the custom-message transport are stored, persisted and rendered without validating field types; the view calls Array methods on, and hands as React children, values the LSP controls. Fix criteria: Before storing an LSPS7 (and LSPS1) create_order or get_order result in the observable or in LSPS_ORDERS_KEY, validate or coerce each rendered field to its spec type (strings for order_id/short_channel_id/original_order.id/service, array of strings for extension_order_ids) and reject non-conforming messages with an error state. Verify by having a test LSP reply with `"extension_order_ids":"x"` and `"order_id":{}` to both create_order and get_order: the LSPS7 screen and the order-history screen must render an error or fallback, nothing malformed is persisted, and the app must not crash.
2. components/KeyValue.tsx renders any object-typed `value` directly as a React child, so every caller that forwards remote data becomes a crash sink for object-valued fields. Fix criteria: KeyValue only renders `value` directly when React.isValidElement(value) is true and otherwise stringifies or hides it; verify by passing a plain object as `value` and confirming no render exception.
3. No React error boundary or global JS exception handler exists, so any single render-time exception from remote data terminates the whole wallet process. Fix criteria: Wrap screen rendering in an error boundary that shows a recoverable error view instead of propagating the exception to the fatal handler; verify by throwing inside a screen's render in a release build and confirming the app stays alive.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper Input Validation
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258380

---

# Flow LSP fee and proposal requests bypass Tor, posting node pubkey from the device IP

## Details
stores/LSPStore.ts talks to the Flow LSP (default https://flow.zeuslsp.com, ZEUS-operated) over plain ReactNativeBlobUtil.fetch. For the startup /api/v1/info request the maintainers added a Tor gate in initFlowLSP (412-434): for remote LND it is skipped when enableTor is set because a clearnet request 'would send the device IP to the Flow host on every startup (#4372)'. The two requests that actually carry the node identity were not given the same treatment:

- getZeroConfFee (457-475) POSTs {amount_msat, pubkey: nodeInfo.nodeId} to /api/v1/fee.
- getZeroConfInvoice (633-665) POSTs the node's bolt11 (its signature recovers the node pubkey), fee_id and client_info to /api/v1/proposal.

Both are reached from InvoicesStore.createUnifiedInvoice (395-430, 476-490) whenever the Receive screen's LSP leg is active, i.e. settings.enableLSP (or forceLsp) and !flowLspNotConfigured. For remote LND, NodeInfoStore.flowLspNotConfigured (176-190) is false when certVerification is true and the node advertises zero-conf/scid-alias - a state that coexists with enableTor because WalletConfiguration only hides the cert switch when Tor is on (3095) and persists the stored value (500-505). This is exactly the configuration the startup gate's `!enableTor && !flowLspNotConfigured` condition was written for.

Result: a user who runs remote LND over Tor with the Flow LSP enabled has their device IP sent to flow.zeuslsp.com, together with their node pubkey (and the node-signed invoice), every time they create an invoice on the Receive screen - including the default Receive flow, which creates an invoice automatically. The startup leak #4372 fixed is thus re-opened on the first Receive. The Flow host legitimately learns the pubkey (it opens a channel to the node); what the Tor setting is meant to withhold, and what this path discloses, is the device IP bound to that pubkey.

Related: lnd-websocket-subscriptions-bypass-tor (same store, node-side WebSockets) and zeuspay-startup-status-bypasses-tor-node-identity (ZEUS Pay host). TLS is default-verified on these calls, so there is no credential exposure; the lspAccessKey header, where set, is sent over TLS to the intended host.

Assumption: react-native-blob-util 0.25.1 uses the platform HTTP stack with no proxy unless configured natively, which this repository does not do.

## Evidence
1. [stores/LSPStore.ts:457–474](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L457-L474)
   getZeroConfFee POSTs {amount_msat, pubkey: nodeInfo.nodeId} (plus the lspAccessKey token when set) to <flowHost>/api/v1/fee with plain ReactNativeBlobUtil.fetch. enableTor is not read; there is no doTorRequest branch.
2. [stores/LSPStore.ts:633–664](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L633-L664)
   getZeroConfInvoice POSTs the node's own bolt11 (whose signature identifies the node pubkey), the fee id and client_info to <flowHost>/api/v1/proposal the same way.
3. [stores/LSPStore.ts:412–444](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L412-L444)
   initFlowLSP applies the Tor gate only to the startup getLSPInfo request: for implementation 'lnd' it requires !enableTor && !flowLspNotConfigured, citing #4372 ('would send the device IP to the Flow host'). The condition is only meaningful for wallets where the Flow LSP IS configured and Tor is on - precisely the wallets whose Receive-time fee/proposal calls are left direct.
4. [stores/InvoicesStore.ts:395–429](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/InvoicesStore.ts#L395-L429)
   createUnifiedInvoice calls lspStore.getZeroConfFee whenever lspRequested (settings.enableLSP or forceLsp) and supportsFlowLSP, with no Tor check.
5. [stores/InvoicesStore.ts:476–489](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/InvoicesStore.ts#L476-L489)
   After the node invoice is created it calls lspStore.getZeroConfInvoice with the node's bolt11, again without a Tor check.
6. [stores/NodeInfoStore.ts:176–189](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NodeInfoStore.ts#L176-L189)
   For remote LND the Flow LSP counts as configured when certVerification is true and the node advertises zero-conf + scid-alias features; Receive.tsx (330-335) sets lspIsActive from this and settings.enableLSP. Nothing here involves enableTor.
7. [views/Settings/WalletConfiguration.tsx:3095–3114](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/WalletConfiguration.tsx#L3095-L3114)
   The certificate-verification switch is only hidden when 'Use Tor' is on; the certVerification value loaded from the saved node (500-505) is written back unchanged by performSaveWalletConfiguration together with enableTor (635-683), and SettingsStore.connect (2042-2043) reads both independently. A remote LND wallet can therefore be enableTor=true and certVerification=true at once, which is the state initFlowLSP's `!enableTor && !flowLspNotConfigured` condition exists for.
8. [views/Receive.tsx:328–335](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Receive.tsx#L328-L335)
   lspIsActive = (enableLSP || forceLsp) && supportsFlowLSP() && !flowLspNotConfigured && !onChainOnly has no enableTor term. Receive passes noLsp: !lspIsActive into createUnifiedInvoice (676, 787) and auto-generates an invoice on mount when autoGenerate is set (478-479), so for the Tor-enabled wallet described every invoice created on Receive, including the automatic one, triggers the direct Flow fee and proposal POSTs.
9. [utils/TorUtils.ts:65–76](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/TorUtils.ts#L65-L76)
   Tor routing is per call site via doTorRequest; nothing proxies ReactNativeBlobUtil, so these POSTs leave from the device's real IP.

## Impact
Confidentiality: the user's real IP is linked to their node pubkey (and node-signed invoice) at the LSP host, defeating the anonymity the Tor setting promises and that #4372 protects for the same host at startup. No credential disclosure (TLS verified), no integrity or availability effect - the wrapped invoice is still bound by verifyWrappedInvoice.

## Reproduction steps
1. The observer is the Flow LSP host or any passive on-path party between the phone and it. No attacker action is needed: the user, on a Tor-enabled remote LND wallet with the Flow LSP configured and enabled, opens Receive (which creates an invoice automatically) and the direct POSTs carrying the node pubkey leave from the device IP. UI:P because receiving is routine wallet use, not a specific attacker-directed step. AT:P because it requires the protected configuration (Tor on, certVerification on, zero-conf node, LSP enabled) and an observer at the service or on-path.

## Recommended fix
1. getZeroConfFee and getZeroConfInvoice issue Flow LSP requests carrying the node identity through the direct platform stack regardless of enableTor, while the sibling getLSPInfo call in the same store is Tor-gated. Fix criteria: When enableTor is set, the fee and proposal requests are routed through doTorRequest or the LSP leg is disabled with a visible notice; verified by confirming that with enableTor set, creating an invoice produces no non-Tor connection to the Flow host.
2. Receive/InvoicesStore decide LSP activity from enableLSP and flowLspNotConfigured only, so a Tor-enabled wallet is treated as LSP-capable even though the store will not contact the LSP over Tor. Fix criteria: lspIsActive (and the Receive LSP toggle) reflect the same Tor condition initFlowLSP uses, so the Tor-enabled wallet never enters the Flow flow unless it can be served over Tor.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-359](https://cwe.mitre.org/data/definitions/359.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258379

---

# Release builds log swap, LSP order, HTLC, address and node-host metadata to Android logcat

## Details
The production JS bundle contains unguarded console.log calls whose arguments are whole API/RPC objects describing the user's financial activity. babel.config.js (presets/plugins at lines 16-22) carries no console-removal transform and no global console override exists in index.js/shim.js/polyfills.js, so every call survives into the release Hermes bundle. Dependency assumption (react-native 0.87.1 as pinned in package.json; sources not inspected in this checkout): on Android the @react-native/js-polyfills console polyfill routes console.log/info/warn/error to nativeLoggingHook in release as well as debug builds, and the Android host writes it to logcat under tag ReactNativeJS; on iOS the release RCTLog threshold admits only console.error, so this is predominantly an Android exposure.

What is written, per routine wallet operation:
- Swaps (stores/SwapStore.ts 484, 601, 613; views/Swaps/SwapDetails.tsx 294-295): swap ids, lockup addresses, amounts, the invoice to be paid, claim/refund public keys, preimage hash and every provider WebSocket status update including lockup/claim transaction ids and hex.
- LSP channel purchases (stores/LSPStore.ts 790, 1021, 1086, 1169, 1202, 1262, 1589, 1672): order ids, bolt11 invoices and on-chain addresses to pay, channel sizes, the client node pubkey and LSP peer pubkey.
- On-chain wallet (stores/UTXOsStore.ts 278, 290): each newly generated receive and change address of an imported account.
- Channels (stores/ChannelsStore.ts 482): all pending HTLCs - payment hashes, amounts, direction, CLTV expiry.
- Embedded node (lndmobile/index.ts 564): the node's private-channel route hints (channel ids, peer pubkeys) for every invoice.
- Remote node (backends/LND.ts 136, 341): the node's host/IP:port URL (plus REST route, which may embed a payment request or hash) on each timeout, and every LSPS0 custom-message WebSocket payload with the peer pubkey.

None of these lines contains a signing key, seed or macaroon (the declined ledger lead e4-14 and dismissal dismissed-swapstore-484-b8a2 established that SwapStore's provider responses are logged before refundPrivateKey/preimage are attached; the LND URL carries the macaroon in a header, not the URL), so this is payment and identity metadata, not credential exposure. A logcat reader (adb-authorised host, bugreport, shared diagnostics, READ_LOGS-privileged component) can reconstruct the user's swap and LSP history with amounts, invoices and addresses, learn the imported wallet's future receive/change addresses, see in-flight payments by hash and amount, map the embedded node's private channels, and identify the remote node they run - all while the app lock screen is engaged, since logcat is read outside the app. The native LND log tail (android LndMobileTools.java readToEnd) emits only to the JS event bus, so no sanctioned path already puts this data in logcat. The project's own pattern for this surface is the __DEV__ gate used throughout stores/CashuStore.ts and PushNotificationManager.tsx:25; the stores above omit it.

## Evidence
1. [stores/SwapStore.ts:483–484](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L483-L484)
   Submarine swap creation: the provider's full response (swap id, lockup address, expectedAmount, swapTree/redeem script, claimPublicKey, timeout height, bip21) is logged unconditionally. The user's invoice was sent in the request on lines 474-480 and the swap id is the handle for every later status lookup.
2. [stores/SwapStore.ts:601–613](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L601-L613)
   Reverse swap creation: request body (invoiceAmount, claimPublicKey, preimageHash) and full response (swap id, the invoice the wallet will pay, lockupAddress, refundPublicKey, onchainAmount) are logged unconditionally.
3. [views/Swaps/SwapDetails.tsx:293–295](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L293-L295)
   Every WebSocket swap.update message from the provider (status, lockup/claim transaction ids and hex) is logged in full.
4. [stores/LSPStore.ts:1086](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L1086)
   LSPS1 REST create_order response (order id, bolt11 to pay, on-chain payment address, channel parameters, client pubkey) logged in full; lines 1202, 1021, 1169, 1262, 1589, 1672 log the sibling get_order / custom-message responses, and 790 logs every LSPS0 custom message with the peer pubkey.
5. [stores/UTXOsStore.ts:277–293](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/UTXOsStore.ts#L277-L293)
   During account import every freshly generated receive and change address of the imported wallet account is logged, giving a log reader the user's future on-chain addresses.
6. [stores/ChannelsStore.ts:481–482](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/ChannelsStore.ts#L481-L482)
   Pending HTLC objects (payment hashes, amounts, direction, expiry) are logged on every channel refresh while HTLCs are in flight.
7. [lndmobile/index.ts:564](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/lndmobile/index.ts#L564)
   Route hints built for the embedded node's own invoices (its channel ids and remote node pubkeys, i.e. private-channel topology) are logged.
8. [backends/LND.ts:136](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L136)
   On request timeout the full REST URL - remote node host/IP and port plus the route (which may embed a payment hash) - is logged. Line 341 logs every custom-message WebSocket payload.
9. [babel.config.js:16–21](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/babel.config.js#L16-L21)
   No console-stripping transform and no global console override anywhere in index.js/shim.js/polyfills.js (index.js only calls LogBox.ignoreLogs); all of the above survive into the release Hermes bundle. Dependency assumption, not verified in this checkout: react-native 0.87.1 (package.json) forwards console.* from release bundles to Android logcat under tag ReactNativeJS via the js-polyfills console shim and nativeLoggingHook.
10. [stores/CashuStore.ts:858–949](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L858-L949)
   Contrast: the Cashu store gates equivalent payment-object logging behind `if (__DEV__)`, so the maintainers do not regard such output as acceptable in production; the stores above apply no gate.

## Impact
Confidentiality only: swap/LSP history with amounts, invoices and addresses, future receive/change addresses, in-flight HTLC hashes and amounts, private-channel topology and the remote node's host are disclosed; no key material, so funds cannot be taken and nothing is modified.

## Reproduction steps
1. Attacker reads Android logcat: adb shell on a host the owner authorised for USB debugging, a bugreport, or diagnostics the user shares. The data is written during ordinary use (creating swaps, buying LSP channels, importing accounts, routing payments, node timeouts) without any user interaction beyond normal operation. Third-party apps cannot read logcat on supported Android, so the position is privileged and depends on a non-default device state.

## Recommended fix
Stores and backends log whole provider/RPC response objects and request URLs with console.log in code compiled into release builds, and the build strips no console output. Fix criteria: In release builds no swap, LSP order, HTLC, address, route-hint or node-URL object reaches the device log: gate the listed calls behind __DEV__ (or a release-stripped logger) and add a console-stripping transform so unguarded calls cannot regress. Verify by exercising a swap, an LSPS1 order and an account import on a release APK and confirming logcat contains none of the response fields.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure through log
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258378

---

# BTCPay onion node import never enables Tor; route param mismatch leaks onion address

## Details
ZEUS pairs with a BTCPay Server by scanning its `config=<url>/lnd.config` QR (utils/handleAnything.ts 820-885). After local validation and user consent the config is fetched — over Tor when the BTCPay host is a .onion (SettingsStore.fetchBTCPayConfig 1867-1872) — and parseBTCPayConfig (1985-1990) turns the returned `uri` and admin macaroon into `{ host: uri, macaroonHex, implementation: 'lnd' }` with no `enableTor` field. The branch then navigates to WalletConfiguration with the Tor decision as a top-level route parameter, `enableTor: node.host.includes('.onion')` (879).

WalletConfiguration.initFromProps never reads that parameter. Line 445 reads `route.params.tor ?? this.state.enableTor` (initial state false, line 222) and line 505 sets `enableTor: tor || enableTor` from the node object — `false || undefined` → undefined. The Route type (105-118) declares `tor`, and no navigator in the tree (Wallets.tsx, Menu.tsx, LSP.tsx, Wallet.tsx, WalletSetup.tsx, CustodialWalletWarning.tsx, SetWalletPicture.tsx, handleAnything.ts) ever passes `tor`, so the value handleAnything computes is silently discarded. For an onion BTCPay (`uri` like `https://<56 chars>.onion/lnd-rest/btc/`) the form opens with 'Use Tor' OFF (supportsTor is true for implementation 'lnd', 1531-1534), shows the certificate-verification switch, and Save opens the TLS modal (3449-3466) because `!enableTor`.

performSaveWalletConfiguration persists `enableTor` from state (627/684) — undefined — and a new entry is pushed to settings.nodes and the user is sent to Wallets (795). When the wallet is selected, updateNodeProperties copies `node.enableTor` (undefined) into the live store (2043) and Wallet.fetchDataCore calls NodeInfoStore.getNodeInfo → LND.getMyNodeInfo (`/v1/getinfo`, LND.ts 364) → request (242-275) → restReq with `useTor` undefined. restReq takes the Tor branch only when `useTor === true` (49); otherwise ReactNativeBlobUtil.fetch is handed `https://<onion>/lnd-rest/btc/v1/getinfo` (86-90), so OkHttp/NSURLSession asks the system resolver for the .onion name (RFC 7686 special-use name; the query reaches the configured DNS server / ISP and is visible on the local network) and the connection fails. Each subsequent wallet refresh or focus repeats the attempt. The macaroon is not transmitted because no TCP connection is established, but the user's hidden-service address — the very identifier Tor mode exists to keep private, and which the project itself refuses to leak elsewhere (handleAnything.ts 651-654 skips DoH for .onion 'so the onion address is not sent to the resolver'; fetchBTCPayConfig forces Tor for onion hosts) — is disclosed on the first connection attempt after the wallet becomes active.

Root cause: a name mismatch between the parameter handleAnything emits (`enableTor`) and the one WalletConfiguration consumes (`tor`). The lndconnect branch (580-586) makes the same top-level mistake but is rescued because ConnectionFormatUtils.processLndConnectUrl puts `enableTor` inside the node object (ConnectionFormatUtils.ts 38-40); the LNDHub branch (600-610) and the clipboard import (WalletConfiguration 294, 330) also set it on the node. The BTCPay node is the only import whose Tor setting depends solely on the ignored route parameter.

Dependency assumption (not vendored here): react-native-blob-util 0.25.1 performs fetches through OkHttp (Android) / NSURLSession (iOS) with the platform resolver and no SOCKS proxy unless configured natively; this repository configures none (MainApplication.kt, ios/zeus). react-native-nitro-tor 0.6.1 (TorUtils.doTorRequest) is only reached through the `useTor === true` branch.

## Evidence
1. [utils/handleAnything.ts:876–884](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L876-L884)
   The BTCPay branch returns ['WalletConfiguration', { node, enableTor: node.host.includes('.onion'), newEntry, isValid }]. The Tor decision is placed as a top-level route param named enableTor; the node object itself carries no enableTor field.
2. [views/Settings/WalletConfiguration.tsx:445](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/WalletConfiguration.tsx#L445)
   initFromProps reads route.params.tor, not route.params.enableTor, so the value computed by handleAnything is silently discarded.
3. [views/Settings/WalletConfiguration.tsx:505](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/WalletConfiguration.tsx#L505)
   enableTor state becomes tor || node.enableTor; for a BTCPay node both are undefined, so 'Use Tor' is off for an onion host.
4. [views/Settings/WalletConfiguration.tsx:105–117](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/WalletConfiguration.tsx#L105-L117)
   The route params type declares `tor` and no `enableTor`; no navigator in the tree (Wallets.tsx, Menu.tsx, LSP.tsx, Wallet.tsx, CustodialWalletWarning.tsx, WalletSetup.tsx, handleAnything.ts) ever passes `tor`, so the parameter is dead and the handleAnything value is the only intended source.
5. [stores/SettingsStore.ts:1985–1989](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L1985-L1989)
   parseBTCPayConfig builds the node as { host: uri, macaroonHex, implementation: 'lnd' } with no enableTor, so the onion decision can only come from the (ignored) route param.
6. [stores/SettingsStore.ts:1867–1871](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L1867-L1871)
   The config fetch itself is routed over Tor when isOnion, i.e. the project treats an onion BTCPay as Tor-only; the node derived from it is not.
7. [utils/handleAnything.ts:580–585](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L580-L585)
   Contrast: the lndconnect branch makes the same top-level enableTor mistake, but its node object already contains enableTor from processLndConnectUrl, so only the BTCPay path loses the setting.
8. [stores/SettingsStore.ts:2042–2043](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L2042-L2043)
   updateNodeProperties loads node.enableTor (undefined) into the live store when the wallet is selected.
9. [backends/LND.ts:49–90](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L49-L90)
   restReq takes the Tor branch (doTorRequest) only when useTor === true (49); with the saved node's enableTor undefined it falls through to the direct ReactNativeBlobUtil.fetch (86-90), which resolves https://<x>.onion/lnd-rest/btc/v1/getinfo through the platform resolver and fails.
10. [views/Settings/WalletConfiguration.tsx:3449–3465](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/WalletConfiguration.tsx#L3449-L3465)
   With enableTor false the Save button also opens the TLS-certificate modal for an onion host, where TLS verification is irrelevant, so the user is additionally nudged into saving certVerification:false.

## Impact
The user's hidden-service address is linked to their device/IP at the resolver and on the local network; no credential is transmitted (no TCP connection is established to a .onion over clearnet) and no funds or integrity are affected. Availability: the wallet cannot connect until the user manually enables Tor, a functional rather than security impact.

## Reproduction steps
1. The observer is the device's DNS resolver, ISP, or any party on the local network path — those the user hides the node from by running it as an onion service. The user scans their own BTCPay pairing QR (the normal onboarding flow), accepts the certificate modal and saves; when the wallet is active the app automatically attempts a direct connection and the .onion name is resolved via system DNS on every fetch. attack_requirements PRESENT because the victim must run an onion BTCPay and the observer must sit at the resolver or on the path.

## Recommended fix
1. handleAnything emits the Tor decision under a route-param name (enableTor) that WalletConfiguration never reads (it reads tor), and the BTCPay node object itself carries no enableTor, so an onion BTCPay node is saved with Tor off and contacted over the platform network stack. Fix criteria: A node imported from a BTCPay config whose uri host ends in .onion must arrive at the form with Use Tor on (carry enableTor inside the node object, or make the form read the parameter actually emitted), and the dead `tor` parameter should be removed so the two cannot diverge again. Verify by scanning an onion BTCPay config QR and confirming the form shows Tor enabled, no certificate modal is shown, and no system DNS query for the .onion name is issued on connect.
2. The REST transport performs a direct platform fetch for any host when enableTor is falsy, including .onion hosts that can never be reached that way, so a misconfiguration becomes a hostname disclosure rather than a local error. Fix criteria: LND.restReq/CLNRest.restReq (and WalletConfiguration on save) refuse or auto-route a .onion host when Tor is not enabled, so the onion name is never handed to the system resolver. Verify that a node with an .onion host and enableTor false produces no DNS lookup.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-200](https://cwe.mitre.org/data/definitions/200.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258376

---

# Contact address book written to Android logcat on every contact edit in release builds

## Details
stores/ContactStore.ts saveContact's edit path (lines 49-62) logs the complete updated contacts array — `console.log('Contact updated successfully!', updatedContacts)` at line 61 — every time the user edits a contact from views/Settings/AddContact.tsx. Each entry is a models/Contact.ts record: display name, description, lightning addresses, BOLT12 addresses/offers, noffers, on-chain addresses, node pubkeys, Cashu P2PK pubkeys, NIP-05 identifiers and Nostr npubs, plus photo/banner file paths. The call has no __DEV__ guard, babel.config.js ships no console-stripping transform, nothing in the production tree overrides console.*, and React Native 0.87.1 release builds on Android route console.* output from Hermes to logcat (tag ReactNativeJS) via nativeLoggingHook (assumed dependency behaviour for the pinned version). On iOS the default RCTLog threshold in release drops console.log, so the exposure is Android-only.

Result: the user's payee address book — the people and services they pay, with the on-chain addresses and node identities that let a reader correlate their on-chain and Lightning activity — is written in cleartext to the device log ring buffer (truncated at Android's per-entry limit, so a large book is partially disclosed per edit), where it is readable by an adb shell on a USB-debugging-authorised host, captured in bugreports, and included in diagnostics the user shares with support. The contact store itself is deliberately kept in the OS keychain (Storage.setItem, CONTACTS_KEY; the code comment at line 58 reads 'Save the updated contacts to encrypted storage'), so the project treats this data as confidential; the log line undoes that. The scan's threat model places logs under the in-scope device-holder adversary and requires that persisted data 'must not leak ... to logs ... where the code says it should not'. No other production path writes contact records to the log (the create, delete and ContactDetails/NostrContacts paths log only literals), so this line is the sole disclosure and the fix is local.

## Evidence
1. [stores/ContactStore.ts:49–61](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/ContactStore.ts#L49-L61)
   saveContact's edit branch (taken whenever isEdit is true: prefillContact defaults to a truthy {} and isNostrContact is false for ordinary edits) builds updatedContacts — every stored contact, with the edited one merged in — persists it to the keychain at line 59, then at line 61 calls console.log('Contact updated successfully!', updatedContacts) with no __DEV__ guard. The whole address book is serialised into the log line (subject to Android's ~4 KB per-entry truncation). The create branch (line 84) and delete branch (line 122) log only literals, so the fix is local to line 61.
2. [models/Contact.ts:8–23](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/models/Contact.ts#L8-L23)
   Fields of each logged record: name, description, lnAddress[], bolt12Address[], bolt12Offer[], noffer[], onchainAddress[], pubkey[], cashuPubkey[], nip05[], nostrNpub[], photo/banner paths — the user's full payee graph.
3. [views/Settings/AddContact.tsx:286–290](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/AddContact.tsx#L286-L290)
   The only caller: the Add/Edit Contact screen passes route.params.isEdit straight through, so every ordinary contact edit from the UI reaches the logging branch.
4. [babel.config.js:16–21](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/babel.config.js#L16-L21)
   The preset is @react-native/babel-preset with only the decorators and reanimated plugins; no transform-remove-console or equivalent, and no runtime override of console.* exists anywhere in the production tree (index.js, shim.js, App.tsx), so the call survives into the release Hermes bundle.
5. [package.json:125](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/package.json#L125)
   Pins react-native 0.87.1. Assumed dependency behaviour: in release builds on Android, React Native's console polyfill forwards every console.* call to nativeLoggingHook, which the Android runtime routes to __android_log_print under tag ReactNativeJS regardless of build type; on iOS the release RCTLog threshold (Error) drops console.log, so the exposure is Android-only.

## Impact
Confidentiality only: the address book (names, lightning/BOLT12/on-chain addresses, node and Cashu pubkeys, Nostr identities) is disclosed, enabling correlation of the user's payment counterparties and on-chain/Lightning activity; no seeds, credentials or funds are exposed and nothing can be altered. The threat model rates privacy leaks that do not expose secrets as Medium.

## Reproduction steps
1. Attacker needs read access to Android logcat: an adb shell on a device whose owner authorised USB debugging to that host, a bugreport, or a log dump the user shares with support. The line is emitted on every contact edit, a routine action the user performs independently of the attacker, and entries remain in the ring buffer until overwritten. Third-party apps cannot read another app's logcat on supported Android versions (READ_LOGS is signature/privileged), so the position is high-privilege and a non-default device state (debugging authorised or bugreport taken) is required.

## Recommended fix
saveContact's edit branch passes the full persisted contacts array as a console.log argument in a code path compiled into release builds, and the build strips no console output. Fix criteria: No contact record (or any field of one) is written to the device log in a release build on either platform: remove the object argument at stores/ContactStore.ts:61 or gate it behind __DEV__, and preferably add a release console-stripping transform (or a production console override) so the class of bug cannot recur. Verify by editing a contact on a release APK and confirming logcat contains no contact fields.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure through log
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258375

---

# Wallet picture files in Documents survive full wipe, duress wipe and wallet deletion

## Details
ZEUS lets the user attach a picture to each wallet (WalletConfiguration > picture > SetWalletPicture). views/Settings/SetWalletPicture.tsx selectPhoto (54-94) copies the chosen gallery image into RNFS.DocumentDirectoryPath as photo_<timestamp>.png and records only `rnfs://photo_<ts>.png` in the wallet config; utils/PhotoUtils.ts getPhoto (70-74) resolves it back to file://<DocumentDirectoryPath>/<name> for display.

No code path ever deletes these files. A repo-wide search finds no RNFS.unlink or ReactNativeBlobUtil.fs.unlink targeting photo_* files. Replacing the picture writes a new file and orphans the old one. Deleting a wallet (views/Settings/WalletConfiguration.tsx deleteNodeConfig, 860ff.) removes the config entry, the node data directory, the per-wallet CDK database, keychain material and NWC connections but not the picture file. Most importantly, utils/DataClearUtils.ts clearAllData (870-1000) — which backs the duress-PIN/passphrase wipe and the failed-login lockout wipe (views/Lockscreen.tsx 431->535, 449->558) and the Tools 'Clear All Data' action (views/Tools/index.tsx 122-155, promising to 'permanently delete all app data', locales/en.json:992) — clears the settings blob, AsyncStorage, EncryptedStorage, Cashu databases, LND/LDK directories, rescue-key exports, cookies and delivered notifications, yet has no step that enumerates or unlinks the Documents image files; its only directory sweeps match node-directory and cashu_wallet* names.

The duress feature is described to the user as deleting 'all of your wallet configurations' (locales/en.json:1352) and the threat model requires the duress wipe to be complete. After a duress wipe the app restarts into a fresh-install state, but its Documents directory still holds the user's wallet picture — typically a personal or identifying gallery photo — under a file name that timestamps when the wallet was configured, and one file per picture ever set. On iOS, RNFS.DocumentDirectoryPath (react-native-fs 2.20.0: NSDocumentDirectory) is exported by ios/zeus/Info.plist through UIFileSharingEnabled (135-136) and LSSupportsOpeningDocumentsInPlace (55-56), so the leftover files are browsable in the Files app (On My iPhone > ZEUS) on the OS-unlocked phone and over Finder/iTunes File Sharing, without any jailbreak and without passing ZEUS's lock screen. On Android the files sit in the app-private filesDir and android:allowBackup="false" (AndroidManifest.xml:34) blocks adb/cloud extraction, so Android residue is a wipe-completeness defect reachable only with root (out of scope), not an exposure in its own right.

A coercer who inspects the device after a duress wipe thus finds evidence that a ZEUS wallet existed and when, plus the user's chosen image, defeating the deniability the wipe is meant to provide; a buyer or forensic examiner of a 'wiped' device gets the same residue. Contact media files written by the same pattern (AddContact, ContactUtils) are a separate record. The fix belongs in clearAllData (sweep DocumentDirectoryPath for the app's own photo_*.png files, including orphans from earlier versions), in deleteNodeConfig (unlink the deleted node's photo) and in SetWalletPicture (unlink the replaced file).

## Evidence
1. [views/Settings/SetWalletPicture.tsx:54–94](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/SetWalletPicture.tsx#L54-L94)
   selectPhoto writes the picked gallery image (react-native-image-picker 8.2.1, resized to <=500x500, base64) as photo_<timestamp>.png into RNFS.DocumentDirectoryPath and hands only the `rnfs://photo_<ts>.png` reference back to WalletConfiguration. No RNFS.unlink anywhere in the non-test tree targets photo_* files: a replaced picture orphans the previous file and the file outlives the wallet config that references it.
2. [utils/DataClearUtils.ts:870–1000](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/DataClearUtils.ts#L870-L1000)
   clearAllData — the duress-PIN wipe, the failed-login lockout wipe and the Tools 'Clear All Data' action — removes the keychain settings blob, AsyncStorage, EncryptedStorage, Cashu DBs, LND/LDK node directories, rescue-key exports, POS records, cookies and delivered notifications, but no step enumerates or unlinks the image files written to DocumentDirectoryPath; the only directory sweeps (clearOrphanedNodeDataDirectories, Cashu DB sweep) match node-directory and cashu_wallet* names.
3. [views/Lockscreen.tsx:523–564](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Lockscreen.tsx#L523-L564)
   deleteNodes (duress PIN/passphrase match at 419-431) and authenticationFailure (max attempts at 445-449) call clearAllData and restart; the comment promises the duress action 'leaves no recoverable key material behind' and the restart lands on a fresh-install state, yet the wallet picture file remains on disk.
4. [views/Settings/WalletConfiguration.tsx:860–989](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/WalletConfiguration.tsx#L860-L989)
   deleteNodeConfig stops the node, deletes NWC connections, the per-wallet CDK database, node keychain material, the config entry and the node data directory, but never unlinks the file referenced by the deleted node's `photo` (no RNFS.unlink in this file).
5. [utils/PhotoUtils.ts:70–73](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/PhotoUtils.ts#L70-L73)
   getPhoto resolves `rnfs://<name>` to file://<DocumentDirectoryPath>/<name>, confirming the persistent location of the wallet picture files (react-native-fs 2.20.0: NSDocumentDirectory on iOS, filesDir on Android).
6. [ios/zeus/Info.plist:135–136](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/zeus/Info.plist#L135-L136)
   UIFileSharingEnabled true, together with LSSupportsOpeningDocumentsInPlace true at 55-56, exports the Documents directory to the Files app (On My iPhone > ZEUS) and to Finder/iTunes File Sharing, so leftover photo_*.png files are readable without passing ZEUS's lock screen.
7. [views/Tools/index.tsx:122–154](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/index.tsx#L122-L154)
   The Tools 'Clear Storage' action promises to 'permanently delete all app data' (locales/en.json:992) and relies solely on clearAllData, which leaves the wallet picture files.

## Impact
Confidentiality LOW: the user's chosen wallet picture (often a personal or identifying photo) and wallet-configuration timestamps embedded in file names survive wallet deletion and the complete wipe the app promises, revealing to a post-duress device holder that a wallet existed and when; no keys, seeds, balances or credentials are involved. Integrity and availability unaffected.

## Reproduction steps
1. The adversary is whoever holds the device after a wipe the user relied on: the user enters the duress PIN under coercion (or the wallet is wiped by failed logins or Tools > Clear All Data) and the phone passes to the coercer, buyer or examiner. On iOS the holder opens Files > On My iPhone > ZEUS on the OS-unlocked phone, or connects it to a paired computer, and reads the surviving photo_<timestamp>.png files; no jailbreak, ZEUS unlock or further user interaction is needed because the app's own lock no longer guards a wiped install and the files are outside every store the wipe touches. Requires physical possession and that the user had set a custom (gallery) wallet picture. Android residue is confined to app-private storage (allowBackup=false) and is not counted as exploitable here.

## Recommended fix
1. clearAllData enumerates every storage namespace except the wallet picture files the app itself writes into DocumentDirectoryPath, so the duress wipe and the 'Clear All Data' action leave identifying residue behind. Fix criteria: After a duress, lockout or manual full wipe, DocumentDirectoryPath must contain no app-written photo_*.png files, including orphans no current config references. Verify by setting a custom wallet picture (and replacing it once), running the duress wipe, and listing Documents via the iOS Files app or Finder File Sharing.
2. SetWalletPicture and WalletConfiguration.deleteNodeConfig never remove the previous or deleted wallet's picture file, so orphaned pictures accumulate for the lifetime of the install. Fix criteria: Replacing a wallet picture or deleting a wallet must unlink the file referenced by the old `rnfs://` value. Verify that after changing the picture or deleting the wallet the old photo_*.png no longer exists in Documents.
3. On iOS the picture files live in the File-Sharing-exported Documents directory, so whatever survives is readable without passing the app lock. Fix criteria: Wallet pictures should be stored under a non-exported location (Application Support or a subdirectory excluded from file sharing) so any residue is at least behind the app sandbox; verify the Files app and Finder no longer list wallet pictures under ZEUS.

---
**Severity:** LOW
**Status:** Open
**Category:** Incomplete cleanup
**CWE:** [CWE-459](https://cwe.mitre.org/data/definitions/459.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258374

---

# Imported contact photo and banner URLs are fetched from the author's host on every render

## Details
A contact object received through a zeuscontact: deep link, QR, share or clipboard value (handleAnything.ts 1066-1078) is shown in ContactDetails and, when the user taps 'Save to contacts', persisted verbatim by importToContacts (ContactDetails.tsx 223-245), including its photo, banner and isFavourite fields. utils/PhotoUtils.getPhoto (70-84) and models/Contact.getBanner (196-202) return any value that is not rnfs:// or preset:// unchanged, so an http:// or https:// URL chosen by the payload author becomes the uri of React Native Image components. Those components load the URL through the OS HTTP stack each time they mount: the contact list on every focus (Contacts.tsx 243-250 via ContactAvatar, reloaded by the focus listener at 69-73, including when the Send flow opens the picker), the Send screen's favourites strip (Send.tsx 625-635; isFavourite is also taken from the payload), ContactDetails (440-463), the LNURL-pay header when the contact is matched (LnurlPay.tsx 553-558, 591) and the payment details sheet (PaymentDetailsSheet.tsx 84-102).

The result is a persistent beacon: after one import, the author's server receives the victim's IP address and a timestamp every time the victim opens the address book, the Send screen or a payment to that contact, for as long as the contact exists, even if the victim never pays the contact. The request goes direct, outside the wallet's enableTor routing (established: only node REST and a few lookups are Tor-gated; Image loads use the native image pipeline, not doTorRequest), and on Android cleartext http:// is permitted by res/xml/network_security_config.xml, so the URL may also be a plain-HTTP host. The project itself does not concede this exposure: SECURITY.md lists 'traffic that bypasses Tor when Tor is enabled' as an in-scope privacy leak, SettingsStore.ts 1862-1878 routes the BTCPay config fetch over Tor 'so the config fetch does not leak the user's IP' and disables redirects so a host cannot 302 to 'an attacker beacon', and the Nostr import path (utils/ContactUtils.ts transformContactData) downloads profile media once and stores an rnfs:// reference. ZEUS's own share encoder (MultiQR.tsx 58-71) strips photo/banner entirely, so remote image URLs in a stored contact exist only because the import path accepts whatever it is given.

The verified finding nostr-profile-media-unbounded-download-on-scan covers the one-shot download during a scan at utils/ContactUtils.ts:35; this record is the distinct render-time sink on persisted contacts, which repeats indefinitely and is triggered by ordinary wallet use rather than by a scan. The rnfs:// branch was also examined: a payload such as rnfs://../../shared_prefs/x resolves to a file:// path outside Documents, but Image only renders bytes and provides no channel to return them, so that path adds no exposure.

Assumption: react-native 0.87.1 Image with a {uri: 'http(s)://…'} source fetches the URL via the native image pipeline (Fresco/OkHttp on Android, NSURLSession on iOS) when the component mounts, with no SOCKS/Tor proxy configured in this tree (no Fresco/OkHttpClientProvider customisation under android/app/src/main/java).

## Evidence
1. [utils/PhotoUtils.ts:70–84](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/PhotoUtils.ts#L70-L84)
   getPhoto maps rnfs:// values to file://<Documents>/… and preset:// names to bundled assets, but returns any other string unchanged (line 83), so an http(s) URL stored in a contact's photo field becomes the Image uri directly. models/Contact.ts getBanner (196-202) has the same pass-through for banner.
2. [views/ContactDetails.tsx:223–245](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/ContactDetails.tsx#L223-L245)
   importToContacts spreads the route's nostrContact object into CONTACTS_KEY with only a fresh contactId added: photo, banner and isFavourite are stored exactly as supplied in the zeuscontact: payload, with no scheme check and no download-and-store step like transformContactData performs for Nostr profiles (utils/ContactUtils.ts 35-73). It runs from the 'Save to contacts' button at 627-635; the 'Edit and save' path (ContactStore.setPrefillContact 134-152) likewise carries photo through.
3. [utils/handleAnything.ts:1066–1077](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L1066-L1077)
   Entry point: any dispatcher input beginning with zeuscontact: (deep link scheme registered in AndroidManifest.xml:78 and Info.plist:42, QR, clipboard, share) is JSON.parsed and, if it has a contactId, routed to ContactDetails as nostrContact without further validation.
4. [views/Settings/Contacts.tsx:243–250](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/Contacts.tsx#L243-L250)
   Every row of the contact list passes contact.getPhoto to ContactAvatar, which renders it as an Animated.Image source (components/ContactAvatar.tsx 89-97, SharedTransition.tsx 80-86); the list is reloaded on every focus (componentDidMount listener at 69-73), including when the Send flow opens the contact picker.
5. [views/Send.tsx:625–635](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Send.tsx#L625-L635)
   Favourite contacts (filtered at 734-736 on isFavourite, which the import takes from the payload) are drawn with <Image source={{uri: contact.getPhoto}}> on the Send screen itself, so the request fires whenever the user opens Send.
6. [views/ContactDetails.tsx:440–463](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/ContactDetails.tsx#L440-L463)
   On each mount/focus the banner Image (contact.getBanner) and the ContactAvatar (contact.getPhoto) load the stored URLs, i.e. the remote host.
7. [views/LnurlPay/LnurlPay.tsx:553–558](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LnurlPay/LnurlPay.tsx#L553-L558)
   When the pay destination matches a stored contact without LNURL metadata image, matchedContact.getPhoto is rendered (line 591), tying a fetch to the moment the victim pays; components/PaymentDetailsSheet.tsx 84-102 does the same on the payment details sheet.
8. [views/MultiQR.tsx:58–71](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/MultiQR.tsx#L58-L71)
   ZEUS's own share encoder emits only essentialContact fields (no photo, banner or isFavourite), so remote image URLs in a zeuscontact: payload only ever come from hand-crafted payloads; accepting them serves no in-app sharing need.

## Impact
Confidentiality LOW: the victim's network address and wallet-usage timing (when they open Send or Contacts, when they pay) are disclosed to an outside party persistently and outside the wallet's Tor routing, which SECURITY.md treats as an in-scope privacy leak; no secrets, balances or payment details leak. Integrity and availability unaffected.

## Reproduction steps
1. Attacker publishes a zeuscontact: payload (deep link, QR code, shared image, or text the victim pastes) whose JSON has a contactId, photo (and optionally banner) pointing at a host they log, and isFavourite:true. Victim opens it and taps 'Save to contacts' (or 'Edit and save'). From then on, each time the victim opens Contacts, the Send screen, ContactDetails or pays the contact, the device issues a GET to the attacker host revealing its IP address and activity timing, regardless of the node's enableTor setting. No privileges or special configuration needed; one user interaction (saving a contact that looks legitimate) is required.

## Recommended fix
Contact import (ContactDetails.importToContacts and the prefill/AddContact save path) stores externally supplied photo/banner values without restricting them to local rnfs:// or preset:// references, and PhotoUtils.getPhoto / Contact.getBanner resolve any other string straight to an Image uri, so persisted remote URLs are fetched from the author's host on every render. Fix criteria: A stored contact's photo and banner must only ever resolve to app-local or bundled image sources: on import, remote URLs must be either dropped or fetched once (with the bounds the verified download finding requires) into DocumentDirectoryPath and stored as rnfs:// references, and getPhoto/getBanner must return '' for any value that is not rnfs:// or preset://. Verify by importing a contact whose photo and banner are http(s) URLs and confirming that opening Contacts, Send, ContactDetails and a payment to that contact produces no network request to that host.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-200](https://cwe.mitre.org/data/definitions/200.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258373

---

# Saved Nostr contact's npub is taken from unsigned profile content instead of the event author

## Details
ContactUtils.transformContactData (utils/ContactUtils.ts 24-28) derives a saved Nostr contact's identity from the kind-0 event's content: contact.npub if present, else npubEncode(contact.pubkey). Both are free-form fields in JSON the profile author writes (neither is defined by NIP-01); the authenticated author is the signed event's pubkey, which is never used here. In handleAnything.nostrProfileLookup (202-244) the hex pubkey the user scanned — or that NIP-05 resolved after a failed lnurlp lookup for a lightning address (817 → 192-199) — is used only as the relay authors filter and then discarded, so the ContactDetails card and the record saved by importToContacts carry whatever npub the content asserts, or no npub at all for a standard profile. views/NostrContacts.tsx 347-355 shows the intended design — it injects npubEncode(item.pubkey) as content.npub — but only when the content has no npub field, so a followed account's self-asserted npub overrides the authenticated one on follow-list import as well.

Consequence: a Nostr author X publishes a profile whose content includes "npub": <Y's npub> with X's own lud16 (and, if desired, Y's name and picture). A victim who scans X's npub, resolves X through a lightning address whose lnurlp endpoint fails, or imports a follow list containing X, obtains a contact whose Nostr identity row is Y's npub while every lightning address belongs to X. Tapping the npub row (ContactDetails.tsx 611-625, handleNostr 263-266) opens Y's genuine Nostr profile in the user's client, and Contacts search (views/Settings/Contacts.tsx:317) matches Y's npub to this contact, so the one cryptographic anchor the app offers for 'who does this lightning address belong to' confirms the impersonation instead of exposing it. Relay signature verification (nostr-tools 2.25.2 SimplePool, assumed to verify signatures and filter matches) proves only that X signed the content; nothing binds the stored identity to that signer.

The zeuscontact: QR path (handleAnything.ts ~1066) also lets a QR presenter populate an arbitrary card, but that format carries no authenticity claim; the npub-lookup and follow-list paths are the ones that purport to resolve a key to its profile, and the follow-list path needs no QR from the attacker at all. nostrNpub is not used as a payment destination anywhere in the tree, so this is a low-impact integrity defect in identity binding, but it is the only place the app records which Nostr key a contact corresponds to and it is derived from the wrong source.

## Evidence
1. [utils/ContactUtils.ts:24–28](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ContactUtils.ts#L24-L28)
   transformContactData sets nostrNpub from contact.npub, else nip19.npubEncode(contact.pubkey). Both are fields inside the kind-0 JSON content the profile author writes freely (neither is a NIP-01 field); the signed event's pubkey is never consulted here.
2. [utils/handleAnything.ts:202–244](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L202-L244)
   nostrProfileLookup(pubkey) — reached from a scanned npub (1049-1065) or from attemptNip05Lookup (192-199), which the lightning-address branch falls back to at 817 when the lnurlp fetch fails — uses the hex pubkey only as the relay authors filter, then passes profile.content alone to transformContactData. The authenticated key is dropped: a standard profile yields a contact with no npub, a profile carrying an npub field yields whatever it claims.
3. [views/NostrContacts.tsx:347–355](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/NostrContacts.tsx#L347-L355)
   Follow-list import injects the event author's pubkey as content.npub only when the content lacks an npub field, showing the intended source is the author key; a profile that includes its own npub field overrides the authenticated identity. importSelectedContacts (436-477) then persists all or selected entries via transformContactData.
4. [views/ContactDetails.tsx:611–625](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/ContactDetails.tsx#L611-L625)
   The stored nostrNpub is rendered as the contact's Nostr identity row and, via handleNostr (263-266), opened as a nostr: link in the user's Nostr client; views/Settings/Contacts.tsx:317 also matches search queries against nostrNpub. The substituted identity is what the user verifies against and searches by.

## Impact
Integrity LOW: the Nostr identity recorded for a saved contact is attacker-chosen rather than the authenticated signer, letting another Nostr identity be paired with the attacker's payment address in the address book, where the npub row and contact search are what the user relies on to confirm a payee. No funds move automatically, no secrets are exposed; confidentiality and availability unaffected.

## Reproduction steps
1. Attacker X publishes a kind-0 profile containing an npub field naming identity Y plus X's own lightning address, then either presents X's npub as a QR / lightning address, or simply is among the accounts the victim follows. The victim scans or imports and taps save. No privileges; the relays and nostr-tools verify only that X signed the content, which is exactly what the attack needs. User interaction is active (scan/import and save); no deployment precondition.

## Recommended fix
The contact's nostrNpub is sourced from author-controlled content fields (npub/pubkey) instead of the signed event's pubkey, and nostrProfileLookup discards the scanned/resolved pubkey before transformation. Fix criteria: A saved Nostr contact's npub must be derived from the authenticated event author (the event.pubkey matching the scanned/resolved key), and content-supplied npub/pubkey fields must be ignored or overridden on both the scan/NIP-05 path and the follow-list import path. Verify by scanning an npub whose profile content claims a different npub: the resulting contact must carry the scanned npub; and by scanning an npub whose profile has no npub field: the contact must still carry the scanned npub.

---
**Severity:** LOW
**Status:** Open
**Category:** Insufficient verification of data authenticity
**CWE:** [CWE-346](https://cwe.mitre.org/data/definitions/346.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258372

---

# Any co-installed iOS app can stop the NWC background keep-alive via unauthenticated Darwin notification

## Details
ZEUS keeps its NWC wallet service alive on iOS by holding an AVAudioSession playing a looping ambient track (ios/zeus/NWCAudioKeepAlive.m; Info.plist UIBackgroundModes includes 'audio'). To let the Live Activity / Dynamic Island buttons control that session, armNWCAudio (called by IOSAudioKeepAliveUtils.arm() from NostrWalletConnectStore.setupIOSAppStateMonitoring on every NWC service initialisation) calls registerDarwinObservers, which subscribes on CFNotificationCenterGetDarwinNotifyCenter() for the fixed names com.zeusln.zeus.nwc.{nextTrack,prevTrack,toggleMute,stop}.

The Darwin notification center is the system-wide notify(3) mechanism: it carries no sender identity, no payload and no access control on third-party names, so any sandboxed app on the device can post "com.zeusln.zeus.nwc.stop" with one CFNotificationCenterPostNotification/notify_post call. nwcDarwinCallback accepts it with only `if (!self.isActive && !self.nwcArmed) return;` (line 58) and `if (!self.isActive) return;` (line 75), then calls stopInternal:@"widget_stop" (lines 465-508): isActive is set NO, the AVAudioPlayer is torn down, the Live Activity is ended (NWCActivityManager.stopActivity -> endDuplicateActivities), and the AVAudioSession is deactivated. With no audio playing the 'audio' background mode no longer applies and iOS suspends the process shortly afterwards (platform behaviour, assumed); the relay subscriptions serving external NWC clients go silent and every pay_invoice / make_invoice / lookup request sent until the user next foregrounds ZEUS is dropped. The Live Activity that would have shown 'NWC active' is removed by the same call, so the user gets no cue (the ambient track is typically muted).

Nothing recovers: the JS NWCAudioSuspended handler (NostrWalletConnectStore.ts:4352-4359) only logs, iosAudioKeepAliveActive stays true, and the AppState listener (4229-4248) only restarts the keep-alive on a fresh non-background -> background transition. The keep-alive is restored only when the user opens ZEUS again.

The legitimate sender (NWCStopIntent in ios/NWCWidget/NWCWidgetIntent.swift:48-56) posts the same bare notification and writes no verifiable token to the group.com.zeusln.zeus UserDefaults (it only clears nwc.activityId), so the app has no authenticated signal distinguishing the widget from a hostile app, even though the app-group container (writable only by entitled ZEUS targets) is already used for track/mute state. nextTrack/prevTrack/toggleMute are likewise honoured from any sender but only re-apply app-group state and have no security impact; stop is the one that matters.

Attacker: any app installed on the same device, running while ZEUS is backgrounded with NWC connections (its normal operating state; trivially satisfied when the user is using the attacker's app). The attacker can repost periodically so the denial persists until the user intervenes. ZEUS itself remains fully functional once foregrounded, so the loss is of the background NWC service only. Confirms ledger lead e5-06.

## Evidence
1. [ios/zeus/NWCAudioKeepAlive.m:52–83](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/zeus/NWCAudioKeepAlive.m#L52-L83)
   nwcDarwinCallback handles the four system-wide Darwin notifications. For com.zeusln.zeus.nwc.stop (lines 74-80) the only guards are the isActive/nwcArmed checks at lines 58 and 75; it then calls stopInternal:@"widget_stop" and emits NWCAudioSuspended. Darwin notifications carry no sender identity, so nothing distinguishes the ZEUS widget from any other process on the device.
2. [ios/zeus/NWCAudioKeepAlive.m:545–556](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/zeus/NWCAudioKeepAlive.m#L545-L556)
   registerDarwinObservers subscribes on CFNotificationCenterGetDarwinNotifyCenter() (the system-wide notify(3) center) with CFNotificationSuspensionBehaviorDeliverImmediately for fixed, public names also compiled into the widget bundle. No per-session nonce or app-group token is involved.
3. [ios/zeus/NWCAudioKeepAlive.m:465–508](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/zeus/NWCAudioKeepAlive.m#L465-L508)
   stopInternal sets isActive NO, tears down the AVAudioPlayer, ends the Live Activity via NWCActivityManager.stopActivity (removing the user-visible 'NWC active' indicator) and deactivates the AVAudioSession, the only thing keeping ZEUS running in the background under the 'audio' UIBackgroundMode.
4. [ios/zeus/NWCAudioKeepAlive.m:299–320](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/zeus/NWCAudioKeepAlive.m#L299-L320)
   armNWCAudio registers the Darwin observers; the store calls IOSAudioKeepAliveUtils.arm() from setupIOSAppStateMonitoring (stores/NostrWalletConnectStore.ts:4211) on every NWC service initialisation, so the observers are live for the whole NWC session.
5. [stores/NostrWalletConnectStore.ts:4352–4359](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L4352-L4359)
   The JS handler for NWCAudioSuspended only logs a warning. iosAudioKeepAliveActive stays true, no restart of the audio session is attempted and no notification is shown to the user.
6. [stores/NostrWalletConnectStore.ts:4229–4248](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L4229-L4248)
   The AppState listener starts the keep-alive only on a fresh non-background -> background transition and stops it on return to foreground; after an external 'widget_stop' nothing re-arms the session until the user opens ZEUS again, so the denial persists for the whole background period.
7. [ios/NWCWidget/NWCWidgetIntent.swift:10–16](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/NWCWidget/NWCWidgetIntent.swift#L10-L16)
   postDarwin is the legitimate sender used by NWCStopIntent (lines 48-56): it posts the bare Darwin notification and writes no verifiable token to the app-group UserDefaults (NWCStopIntent only clears nwc.activityId), so the app has nothing to check the request's origin against.

## Impact
No data is read or altered. Availability of the background NWC wallet service is lost silently until the user next opens ZEUS: requests from connected client apps in that window are dropped. Rated LOW rather than HIGH because only the background-serving mode of one component is denied; the wallet and NWC remain fully usable once foregrounded and the keep-alive is re-established on the next background transition without any repair, matching the project's own rubric that treats self-recovering outages as low.

## Reproduction steps
1. Attacker is a co-installed app with no special entitlements (AV:L, PR:L). It posts a Darwin notification with a fixed public name — one CFNotificationCenterPostNotification call, no defences to bypass (AC:L). It works whenever ZEUS's keep-alive is active, the component's normal state when backgrounded with NWC connections, e.g. whenever the user is in the attacker's app; the attacker can repost periodically (AT:N). No user interaction is needed and the Live Activity is removed by the same call, so the user gets no cue (UI:N).

## Recommended fix
1. nwcDarwinCallback honours the system-wide, sender-anonymous com.zeusln.zeus.nwc.stop notification with no proof it came from a ZEUS-team process, so the boundary between ZEUS and other apps on the device is not enforced for a control that disables background payment processing. Fix criteria: A stop request is honoured only when accompanied by evidence from a channel that only ZEUS targets can write — e.g. the widget intent records a fresh nonce/timestamp in the group.com.zeusln.zeus UserDefaults (or performs the stop in-process via LiveActivityIntent) and the app verifies and consumes it before calling stopInternal. Verification: posting com.zeusln.zeus.nwc.stop from another process while the keep-alive is active leaves the audio session and Live Activity running.
2. The JS NWCAudioSuspended handler only logs, so an unexpected 'widget_stop' (or any external teardown) leaves iosAudioKeepAliveActive true with no recovery or user notification. Fix criteria: On a suspension the user did not request, the store either restarts the keep-alive or surfaces a notification that background NWC has stopped. Verification: an externally triggered stop results in either re-activation or a visible alert, never a silent gap.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper source verification
**CWE:** [CWE-940](https://cwe.mitre.org/data/definitions/940.html)
**Attack vector:** LOCAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258371

---

# Contact photos and banners are never deleted and survive contact deletion and the full/duress wipe

## Details
The address book stores three kinds of image files directly in RNFS.DocumentDirectoryPath: gallery pictures chosen in AddContact (photo_<timestamp>.png, views/Settings/AddContact.tsx 300-339), and Nostr profile avatars and banners downloaded by ContactUtils.transformContactData (nostrContactPhoto_<uuid>.png and nostrContactBanner_<display name>.png, utils/ContactUtils.ts 35-75; reached from handleAnything.ts:238 on an npub/lightning-address scan and from views/NostrContacts.tsx:400,455 on import). Nothing in the repository ever deletes them: ContactStore.deleteContact (106-131) and the 'Delete all contacts' action (views/Settings/Contacts.tsx 535-541) only rewrite the JSON blob, AddContact's photo replacement only nulls state (937), and the full wipe DataClearUtils.clearAllData (870-1008) clears CONTACTS_KEY and sweeps node directories and Cashu databases but has no step that enumerates or unlinks these files. A repo-wide search finds no RNFS.unlink or ReactNativeBlobUtil.fs.unlink targeting any of the three name patterns.

clearAllData is the duress-PIN and failed-login wipe (views/Lockscreen.tsx 431->535, 449->558) and the Tools 'Clear All Data' action (views/Tools/index.tsx:145), whose confirmation text promises 'This will permanently delete all app data including settings, contacts, notes, and transaction history' (locales/en.json:992). After it runs, the device still holds every contact avatar and banner the user ever saved or imported, and each banner file name spells out the contact's Nostr display name in clear.

Exposure: on iOS, RNFS.DocumentDirectoryPath (react-native-fs 2.20.0: NSDocumentDirectory) is the Documents directory, which ios/zeus/Info.plist exports through UIFileSharingEnabled (135-136) and LSSupportsOpeningDocumentsInPlace (55-56); the leftover images are browsable in the Files app (On My iPhone > ZEUS) and over Finder/iTunes File Sharing without unlocking ZEUS, both before the wipe (deleted contacts' photos) and after it. On Android the files sit in the app-private filesDir and android:allowBackup="false" (AndroidManifest.xml:34) blocks adb/cloud extraction, so Android residue is only a wipe-completeness defect reachable with root (out of scope), not an exposure in its own right.

The verified finding nostr-profile-media-unbounded-download-on-scan notes in passing that these files accumulate (as a storage-exhaustion concern); this record is the distinct confidentiality sink: the deletion and wipe semantics the user relies on do not cover contact media, so a post-wipe device holder learns that a wallet existed and who its contacts were. Ledger lead e7-13 ('Documents images never removed') is answered in part by this record; the sibling candidate wallet-picture-files-survive-wipe-and-wallet-deletion covers the wallet-picture files written by the same pattern in views/Settings/SetWalletPicture.tsx.

## Evidence
1. [stores/ContactStore.ts:106–131](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/ContactStore.ts#L106-L131)
   deleteContact filters the JSON array and rewrites CONTACTS_KEY; the rnfs:// photo and banner files the removed contact references are never unlinked. No RNFS.unlink exists in this file, and no call anywhere in the non-test tree removes photo_*, nostrContactPhoto_* or nostrContactBanner_* files.
2. [views/Settings/Contacts.tsx:535–540](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/Contacts.tsx#L535-L540)
   'Delete all contacts' writes [] to CONTACTS_KEY and reloads; no image files are removed.
3. [views/Settings/AddContact.tsx:300–339](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/AddContact.tsx#L300-L339)
   selectPhoto writes the picked gallery image as photo_<timestamp>.png into RNFS.DocumentDirectoryPath; replacing or clearing the photo (933-938) only nulls state, leaving the previous file.
4. [utils/ContactUtils.ts:35–74](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ContactUtils.ts#L35-L74)
   Nostr imports write nostrContactBanner_<display name>.png and nostrContactPhoto_<uuid>.png into DocumentDirectoryPath; the banner file name embeds the contact's display name in clear.
5. [utils/DataClearUtils.ts:870–1008](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/DataClearUtils.ts#L870-L1008)
   clearAllData clears CONTACTS_KEY (STORAGE_KEYS at 94) but no step enumerates or unlinks photo_*, nostrContactPhoto_* or nostrContactBanner_* files; the only directory sweeps (815-850) match node-directory names bearing LND markers, LDK subdirectories and cashu_wallet* databases. This function is the duress wipe, the failed-login lockout wipe, and the Tools 'Clear All Data' action (views/Tools/index.tsx:145), whose prompt promises to 'permanently delete all app data including settings, contacts, notes, and transaction history' (locales/en.json:992).
6. [views/Lockscreen.tsx:523–564](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Lockscreen.tsx#L523-L564)
   deleteNodes (duress PIN/passphrase match at 419-431) and authenticationFailure (maxAuthenticationAttempts reached at 445-449) both call clearAllData and restart; the threat model requires the duress wipe to be complete, yet contact images are left behind.
7. [ios/zeus/Info.plist:135–136](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/zeus/Info.plist#L135-L136)
   UIFileSharingEnabled true (with LSSupportsOpeningDocumentsInPlace at 55-57) exports the Documents directory, where RNFS.DocumentDirectoryPath places these images, to the Files app and Finder/iTunes without passing ZEUS's lock screen.

## Impact
Confidentiality LOW: contact avatars, banners and (via file names) Nostr display names of the user's contacts survive single deletion, delete-all and the complete wipe that the app promises deletes 'all app data including ... contacts', revealing the wallet's prior existence and part of its social graph to a post-duress device holder; no keys, balances or credentials are involved. Integrity and availability unaffected.

## Reproduction steps
1. The adversary is the device holder after a wipe: the user triggers the duress PIN (or the wallet is wiped by failed logins or the Tools 'Clear All Data' action), then hands over or loses the phone. On iOS the holder opens Files > On My iPhone > ZEUS, or connects the phone to a paired computer, and reads the surviving avatar/banner images and display-name file names with no ZEUS unlock; the same Files path also exposes photos of contacts the user deleted before any wipe. Requires physical possession of the (OS-unlocked) device and that the user had saved or imported contacts with images; no ZEUS privileges or further user interaction. Android residue is confined to app-private storage (allowBackup=false) and is not counted as exploitable here.

## Recommended fix
1. Contact media files are written to DocumentDirectoryPath but no deletion path (single contact, delete-all, photo replacement, full wipe) unlinks them, so cleanup semantics the user relies on do not cover them. Fix criteria: Deleting a contact, deleting all contacts, replacing a contact photo and clearAllData must remove the corresponding photo_*, nostrContactPhoto_* and nostrContactBanner_* files (or the whole dedicated contact-media directory), and file names must not embed contact names. Verify by saving contacts with gallery and Nostr images, running the duress wipe, and confirming DocumentDirectoryPath holds none of these files.
2. On iOS the files live in the File-Sharing-exported Documents directory, so whatever survives is readable without passing the app lock. Fix criteria: Contact media should be stored under a non-exported location (Application Support or an excluded subdirectory) so that any residue is at least behind the app sandbox; verify the Files app and Finder no longer list contact images under ZEUS.

---
**Severity:** LOW
**Status:** Open
**Category:** Incomplete cleanup
**CWE:** [CWE-459](https://cwe.mitre.org/data/definitions/459.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258368

---

# Stealth decoy is armed only at cold start; warm resume shows ZEUS under the disguised icon

## Details
Stealth mode (Android only) replaces the ZEUS launcher entry with a decoy ('Calculator', 'Edge VPN', 'QR Scanner', 'Notepad') and is meant to show a decoy app to whoever opens it until the owner performs the unlock gesture (locale: 'Tap the = button 5 times quickly to reveal ZEUS'). components/StealthModeWrapper.tsx is the only place the decoy gate exists, and it is evaluated exactly once: checkStealthStatus() runs from useEffect(..., []) at JS mount (37-39), handleUnlock (88-97) sets isStealthActive=false and nothing ever sets it back, and render (104-116) is driven solely by that flag. No AppState listener, remount key or other hook re-arms the decoy (the only AppState use under views/Stealth is QRScannerApp's camera toggle).

All disguised launcher aliases target MainActivity, which is launchMode=singleTask (AndroidManifest.xml 56, 108-116). Tapping the disguised icon or its recents entry while the ZEUS process is alive therefore resumes the existing task and React tree instead of cold-starting it, so the wrapper renders the real app. What the observer then sees is decided by Wallet.handleAppStateChange (Wallet.tsx 359-380): with loginBackground off (default, SettingsStore.ts:1635) the wallet itself, balances and activity included; with loginBackground on and a PIN/biometric configured, the ZEUS-themed Lockscreen ('Enter PIN'), whose mount fires a system biometric prompt titled 'Unlock ZEUS' (Lockscreen.tsx 222-234, en.json 1342). In every configuration the disguise, the only thing stealth mode provides, is lost on warm resume, and stealth mode offers no re-arm option the user could turn on.

The project does treat the backgrounded state as something to keep from a device holder: MainActivity.onCreate calls setRecentsScreenshotEnabled(false) 'to avoid data leak via recents' (MainActivity.kt:38-40), so the recents entry shows the alias label with a blank thumbnail and resuming the task is the device holder's only view of the backgrounded wallet, exactly where the decoy is missing. App.handleAppStateChange (App.tsx 396-412) already runs on every 'background' transition to re-sync the native alias to settings.privacy.stealthMode; it does not re-arm the JS decoy and is the natural place to do so.

The decoy is a disguise, not the app lock: PIN/passphrase gating is unaffected, so the loss is confidentiality of the wallet's existence and, in the default loginBackground=false configuration, its on-screen contents.

## Evidence
1. [components/StealthModeWrapper.tsx:37–39](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/StealthModeWrapper.tsx#L37-L39)
   checkStealthStatus runs once from useEffect with an empty dependency array: the decoy decision is made only when the JS tree mounts. The wrapper has no AppState listener and nothing else re-evaluates it.
2. [components/StealthModeWrapper.tsx:88–97](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/StealthModeWrapper.tsx#L88-L97)
   handleUnlock sets isStealthActive=false and nothing ever sets it back to true; after one successful gesture the decoy is gone for the lifetime of the process.
3. [components/StealthModeWrapper.tsx:104–116](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/StealthModeWrapper.tsx#L104-L116)
   Render is driven purely by isStealthActive, so every warm resume renders the real wallet tree (children).
4. [android/app/src/main/AndroidManifest.xml:108–116](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/AndroidManifest.xml#L108-L116)
   The disguised launcher aliases target MainActivity, which is launchMode=singleTask (line 56): tapping the 'Calculator' icon while the process lives resumes the existing task and React tree instead of cold-starting, so the wrapper's cleared flag governs.
5. [views/Wallet/Wallet.tsx:359–380](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L359-L380)
   What the observer sees on 'active': with loginBackground off (default, SettingsStore.ts:1635) the wallet UI stays; with loginBackground on, navigation to the ZEUS Lockscreen. Neither is the decoy.
6. [views/Lockscreen.tsx:222–234](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Lockscreen.tsx#L222-L234)
   With biometrics configured the Lockscreen's mount fires a system biometric prompt titled 'Unlock ZEUS' (locales/en.json:1342), so even the maximum-protection configuration (stealth + lock + loginBackground) reveals ZEUS on warm resume.
7. [App.tsx:396–412](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/App.tsx#L396-L412)
   On every 'background' transition the app re-syncs the native launcher alias to settings.privacy.stealthMode; the JS decoy is not re-armed here. This is the lifecycle hook the fix belongs in.
8. [android/app/src/main/java/com/zeus/MainActivity.kt:38–40](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/MainActivity.kt#L38-L40)
   setRecentsScreenshotEnabled(false) 'to avoid data leak via recents': the project deliberately hides the backgrounded wallet from a device holder, so the recents entry is the alias label with a blank thumbnail and resuming the task is the only view, where the decoy is absent.

## Impact
Only the disguise is defeated: the observer learns the device runs a Bitcoin/Lightning wallet in every configuration and, with the default loginBackground=false, sees balances and transaction history on screen. Seeds, credentials and the PIN/passphrase gate are untouched, so integrity and availability are unaffected; the confidentiality loss is limited.

## Reproduction steps
1. Attacker is a person physically holding or shown the Android device (border check, partner, mugger asking to see 'that calculator') while the stealth-disguised ZEUS process is still alive after the owner performed the decoy gesture and pressed Home. They tap the disguised launcher icon or recents entry; singleTask resumes the existing React tree whose decoy flag was cleared, so ZEUS (the wallet, or the ZEUS Lockscreen / 'Unlock ZEUS' biometric prompt) appears instead of the decoy. No credential, defense or victim action is involved; it requires stealth mode enabled and the owner's earlier in-process unlock (AT:P).

## Recommended fix
The decoy gate in StealthModeWrapper is evaluated once at JS mount and permanently cleared by the first unlock gesture; it is not tied to the app's foreground/background lifecycle, so a singleTask warm resume via the disguised alias renders the real app. Fix criteria: When settings.privacy.stealthMode is on, returning to the foreground after a background transition (optionally beyond a short grace period) must present the decoy again until the unlock gesture is repeated, and the decoy must render before any ZEUS-branded view, including the Lockscreen and its biometric prompt. Verify by unlocking the decoy, backgrounding, and relaunching from the disguised launcher icon and from recents: the decoy, not the wallet or lock screen, must appear.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-200](https://cwe.mitre.org/data/definitions/200.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258367

---

# Unbounded NIP-87 review rating denominator makes MintReviewsModal allocate one star element per unit, hanging or crashing the wallet

## Details
Mint reviews shown during Cashu mint discovery are NIP-87 kind-38000 events fetched from the eight default public Nostr relays (SettingsStore.ts DEFAULT_NOSTR_RELAYS). `parseReviewRating` (stores/CashuStore.ts:136-157) parses a leading `[score/max]` from the event content and validates only `score >= 0 && max > 0 && score <= max`; `max` has no upper bound. `components/MintReviewsModal.tsx` `renderStarRating` (81-101) then builds the star row with `for (let i = 1; i <= rating.max; i++)`, creating one `<Text>` element per unit of `max`, synchronously on the JS thread. A review whose content begins `[1/9999999999]` makes the modal attempt to allocate ~1e10 React elements the moment that row is rendered (the JS thread blocks until the process is killed for memory); a denominator longer than ~309 digits parses to Infinity, passes the check, and makes the loop non-terminating. FlatList virtualisation limits how many rows render, not the content of a single row, so the hostile review fires when it is in the initial window or scrolled into view.

Who can inject it: in the shipped 'All Nostr users' mode (a radio option in both MintDiscovery.tsx and AddMint.tsx) `fetchMints` (2194-2210) subscribes to kind 38000 with no author restriction, so any Nostr key holder can publish a review with tags k=38172 and u=<any https mint URL>. In the default 'zeus' mode and in 'custom' mode the author must appear in the kind-3 follow list of ZEUS or of the user-entered npub (2247-2340), still a third-party Nostr principal. `processMintRecommendationEvents` (2043-2090) attaches the review to whatever mint URL the `u` tag names, so the attacker targets the popular mints that are exactly the ones surfaced as top-5. The victim triggers it by tapping a mint in onboarding MintDiscovery (418-424, captioned 'Tap a mint to read reviews') or 'View reviews' in AddMint (783-799). The attacker is the event author, who signs their own event, so no assumption about @nostr-dev-kit/ndk 3.0.3 signature verification is load-bearing; only that NDK delivers events matching the filter.

The same code path copies the reviewer's kind-0 profile `display_name`/`name`/`username` (2402-2411) without a type check into a string-typed field; `MintReviewsModal` line 205 calls `displayName.charAt(0)` on it when the reviewer has no picture, so a non-string value throws during render. No ErrorBoundary exists in the first-party tree, so either defect takes down the wallet UI. The in-memory review cache is not persisted, so relaunching recovers; the app is unusable only while the user re-opens that mint's reviews.

## Evidence
1. [components/MintReviewsModal.tsx:81–100](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/MintReviewsModal.tsx#L81-L100)
   renderStarRating loops `for (let i = 1; i <= rating.max; i++)` (line 83) pushing a <Text> element per iteration with no cap. rating.max is the integer parsed from the Nostr review event's content, so a review beginning `[1/9999999999]` builds ~1e10 React elements synchronously on the JS thread; a denominator of >309 digits parses to Infinity and the loop never terminates. Called from renderReviewItem (line 221) for every rated review in the FlatList; FlatList virtualisation bounds rows, not the content of one row.
2. [stores/CashuStore.ts:136–157](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L136-L157)
   parseReviewRating matches `^\s*\[(\d+)\/(\d+)\]\s*` (line 143), parseInt()s both groups and accepts them when `score >= 0 && max > 0 && score <= max` (line 150). There is no upper bound on max (NIP-87 convention is 5), so any digit string, including one that parses to Infinity, becomes rating.max.
3. [stores/CashuStore.ts:2043–2090](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L2043-L2090)
   processMintRecommendationEvents turns every kind-38000 event with tag k=38172 and an https `u` tag into a MintReview keyed by that attacker-chosen mint URL (line 2063 calls parseReviewRating on event.content). No author, size or shape check beyond the URL scheme, so a review can be attached to any mint's list, including the popular ones surfaced as top-5.
4. [stores/CashuStore.ts:2194–2210](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L2194-L2210)
   fetchMints ('All Nostr users' discovery mode, selectable in MintDiscovery.tsx:308-312 and AddMint.tsx:346-351) subscribes to kind 38000 with no authors filter on DEFAULT_NOSTR_RELAYS (SettingsStore.ts:1486, eight public relays), so any Nostr key holder's events reach processMintRecommendationEvents. fetchMintsFromFollows (2247-2340, the default 'zeus' mode) restricts authors to the kind-3 follow list of ZEUS or a user-entered npub, still third-party Nostr principals.
5. [views/Onboarding/MintDiscovery.tsx:418–424](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Onboarding/MintDiscovery.tsx#L418-L424)
   Onboarding entry point (routed from App.tsx:596, reached from RecommendedSettings.tsx:478 when ecash is enabled): tapping any top-5 mint opens MintReviewsModal for it, under the caption 'Tap a mint to read reviews'. views/Cashu/AddMint.tsx:783-799 ('View reviews') is the second entry.
6. [stores/CashuStore.ts:2402–2410](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L2402-L2410)
   Same unchecked-field pattern for reviewer kind-0 profiles: `name: content.display_name || content.name || content.username` is copied from the parsed JSON without a type check into a field typed string. MintReviewsModal.tsx:177 takes it as displayName and line 205 calls `displayName.charAt(0)` when no picture is set, so a numeric or object display_name throws a TypeError during render; there is no ErrorBoundary in the first-party tree.

## Impact
Deterministic JS-thread hang / out-of-memory termination of the wallet whenever the targeted mint's reviews are opened, from a ~15-byte string in a public Nostr event. The review cache is in memory only, so relaunching recovers and funds, keys and other screens are unaffected: availability LOW. No confidentiality or integrity impact is established by this finding (loading reviewer profile pictures from the reviewer's URL is ordinary Nostr-client behaviour, not rated here).

## Reproduction steps
1. Attacker holds any Nostr key (for the shipped 'All Nostr users' mode) or is in ZEUS's / the user's chosen npub's follow list (default 'zeus' / 'custom' modes) and publishes a kind-38000 event with k=38172, u=<popular mint URL> and content `[1/9999999999]` to the default public relays. A victim in onboarding Mint Discovery or Add Mint discovery taps that mint to read reviews and the modal's render loop hangs the JS thread until the process is killed. AT:PRESENT because the victim's discovery mode (or the attacker's presence in the relevant follow list) and the relay returning the event within its 2000-event limit are outside the attacker's control; UI:ACTIVE for the tap; PR:NONE, AV:NETWORK, AC:LOW.

## Recommended fix
1. parseReviewRating accepts any positive denominator (including values that parse to Infinity) and renderStarRating allocates one element per unit of it, so relay-supplied review content controls the number of elements rendered. Fix criteria: The rating denominator accepted from review content is bounded to a small constant (NIP-87 convention is 5) and the rating is rejected otherwise, or stars are rendered from a normalized 0-1 value with a fixed element count, so no review content can change the number of elements rendered. Verify by publishing a `[1/9999999999]` review for a test mint and opening its reviews: the modal renders promptly with at most a fixed number of stars.
2. Reviewer profile fields (display_name/name/username) are copied from kind-0 JSON without type validation into a string-typed field that the modal calls string methods on. Fix criteria: Only string-typed (and length-bounded) profile name fields are stored; non-strings are dropped so `charAt`/`slice` cannot throw during render. Verify with a kind-0 profile whose display_name is a number and no picture: the review list renders with the anonymous fallback.

---
**Severity:** LOW
**Status:** Open
**Category:** Unbounded resource allocation
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258366

---

# Nostr mint-backup nsec revealed and copyable without the re-authentication other secret screens require

## Details
views/Tools/NostrKeys/index.tsx derives the Cashu mint-backup Nostr keypair from the wallet's Cashu seed in its constructor (CashuStore.getNostrBackupSeed -> deriveMintBackupKeypair, SHA-256(seed || 'cashu-mint-backup'), utils/NostrMintBackup.ts 44-59), bech32-encodes it as an nsec into component state, and shows it in clear with an enabled copy icon after one tap on the header eye icon (lines 79-99 toggle revealSensitive; KeyValue at 125-133 passes disableCopy={!revealSensitive}). The screen is opened from the Tools menu with a plain navigation.navigate('NostrKeysTools') (views/Tools/index.tsx 719). The project's seed-material screens - Seed (Menu.tsx 416, WalletConfiguration.tsx 1137/3351, Swaps 879, BalancePane 456), the Cashu seed (CashuTools.tsx 75-78) and the NWC pairing secret (NWCConnectionDetails.tsx 187-193) - are all reached through reAuthNavigation (utils/NavigationUtils.ts 28-40), which forces the Lockscreen whenever a PIN/passphrase/biometric is configured 'regardless of POS status or current session login state' (comment at 25-27); the Lockscreen honours pendingNavigation only after a successful unlock (views/Lockscreen.tsx 236-245, 370-383). The nsec screen is seed-derived private-key material that is not behind that gate, and unlike Seed.tsx (169-177) it does not re-hide the revealed value when the app is backgrounded.

What the nsec protects: it is the identity for the user's NIP-44 encrypted kind-30078/d=mint-list backups on the eight DEFAULT_NOSTR_RELAYS (SettingsStore.ts 1486). restoreMintsFromNostr accepts any such event whose pubkey matches, whose Schnorr signature verifies and whose content decrypts with the self conversation key (NostrMintBackup.ts 200-229), and picks the highest payload timestamp (163-170). CashuStore.initializeWallets adopts that result without confirmation when the device has no stored mint list (fresh install or recovery; 3457-3477), adds every URL to CDK (3497-3510), and the first mint added becomes the selected mint (addMint 2797-2800). NostrMintSync's manual restore adds them after an Alert (72-101). A party who copies the nsec during a brief hands-on moment with the unlocked app therefore keeps, after the session ends, the ability to read which mints the user uses and to publish a forged backup (with an arbitrarily high payload timestamp) that is silently installed as the default ecash mint at the victim's next fresh install or recovery. The derivation is one-way, so the nsec does not expose the Cashu or wallet seed.

Scope: the project's threat model puts 'physical access to an unlocked phone with no app lock set' out of scope but rates 'bypass of the PIN, passphrase or duress wipe by someone holding the unlocked or locked device' as High (.oss-scanner/threat_model.md 59, 63). This finding is the lock-configured case: the re-auth control the project ships for secret reveals is simply not applied to this screen. The unlocked-session holder can already add a mint or spend in-session, and WalletConfiguration shows the node macaroon behind an eye toggle without re-auth, so the gain is the persistent, out-of-band backup-identity capability rather than anything in-session; severity is low.

## Evidence
1. [views/Tools/NostrKeys/index.tsx:42–50](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/NostrKeys/index.tsx#L42-L50)
   On construction the screen derives the mint-backup private key from the Cashu seed (getNostrBackupSeed -> deriveMintBackupKeypair) and bech32-encodes it as nsec into component state.
2. [views/Tools/NostrKeys/index.tsx:79–133](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/NostrKeys/index.tsx#L79-L133)
   The header eye icon (79-99) toggles revealSensitive with no PIN/passphrase/biometric prompt; the nsec KeyValue (125-133) then shows the key in clear and enables copying (disableCopy={!revealSensitive}). No AppState handler re-hides it on background, unlike Seed.tsx 169-177.
3. [views/Tools/index.tsx:716–720](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/index.tsx#L716-L720)
   The Tools menu reaches the screen with a plain navigation.navigate('NostrKeysTools'), not reAuthNavigation.
4. [views/Tools/CashuTools.tsx:74–79](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/CashuTools.tsx#L74-L79)
   Contrast: the sibling Cashu seed screen is reached only via reAuthNavigation(navigation, 'CashuSeed'); Menu.tsx:416, WalletConfiguration.tsx:1137/3351 (Seed) and NWCConnectionDetails.tsx:191 (NWC secret QR) apply the same gate, establishing the project's rule that secret-revealing screens re-authenticate.
5. [utils/NavigationUtils.ts:28–40](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NavigationUtils.ts#L28-L40)
   reAuthNavigation forces the Lockscreen whenever a login method is configured, 'regardless of ... current session login state' - the mechanism exists precisely for an unlocked session handed to someone else, and is simply not applied here.
6. [utils/NostrMintBackup.ts:200–229](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NostrMintBackup.ts#L200-L229)
   Restore accepts any kind-30078 event whose pubkey matches and whose signature verifies and decrypts with the conversation key; holding the nsec is sufficient to publish a backup the victim's wallet will accept, and to decrypt the victim's existing backups (list of mints used).
7. [stores/CashuStore.ts:3457–3476](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L3457-L3476)
   On a fresh install or recovery (no stored mintUrls) initializeWallets calls nostrRestoreMints and adopts the returned mint list as localMintUrls without any confirmation, then adds each mint to CDK (3497-3510); the first mint added becomes the selected mint (addMint 2797-2800). A forged backup therefore injects an attacker mint as the default mint at recovery time.
8. [views/Tools/NostrKeys/NostrMintSync.tsx:72–100](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/NostrKeys/NostrMintSync.tsx#L72-L100)
   The manual restore shows the recovered URLs in an Alert and adds them with addMint(mint, true) on 'Add', the second path by which a forged backup becomes trusted mints.

## Impact
Confidentiality LOW: the attacker learns the backup identity and can decrypt the mint-list backups (which mints the user uses), but not the wallet seed or funds. Integrity LOW: the attacker can plant mint URLs that the wallet installs as trusted (and default) mints at recovery time, steering future ecash receipts toward an attacker mint; funds already held are not altered. No availability impact.

## Reproduction steps
1. Attacker has brief physical access to the device while the ZEUS session is unlocked (e.g. the owner hands it over) on a wallet with ecash enabled and a lock method configured. Tools -> Nostr Keys -> eye icon -> copy puts the nsec on the clipboard or in a photo in seconds, with no prompt. Later, from anywhere, the attacker decrypts the user's mint-list backups and/or publishes a forged backup; at the victim's next fresh install/recovery initializeWallets adopts it automatically. AV:PHYSICAL, AT:PRESENT for the unlocked-session state, no privileges, no victim interaction beyond the hand-over.

## Recommended fix
1. The Nostr Keys screen, which reveals and copies a seed-derived private key, is reachable without the re-authentication the project applies to its other secret-revealing screens, and does not hide the revealed value on background. Fix criteria: Opening the Nostr Keys screen (or at minimum revealing/copying the nsec) requires the same reAuthNavigation lock-screen pass as the Seed and Cashu seed screens when a login method is configured, and the revealed nsec is re-hidden when the app leaves the foreground. Verify that with a PIN set, Tools -> Nostr Keys prompts for the PIN before the nsec can be shown or copied.
2. Automatic adoption of a Nostr mint-list backup at fresh install/recovery installs mints as trusted (and default) with no user confirmation, so anyone holding the backup key can inject mints. Fix criteria: Mints recovered from a Nostr backup at startup are presented to the user for confirmation (as NostrMintSync already does) before being added or selected, so a forged or stale backup cannot silently become the default mint.

---
**Severity:** LOW
**Status:** Open
**Category:** Missing authentication
**CWE:** [CWE-306](https://cwe.mitre.org/data/definitions/306.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258365

---

# POS ReceiveEcash clipboard button routes arbitrary clipboard input to Send/PaymentRequest without PIN

## Details
When ecash is enabled, POS checkout (PosStore.processCheckout and the Order screen's Pay button) opens ReceiveEcash with autoGenerate:true. The project treats an active POS session as unauthenticated for anything that can reach Send: SettingsStore.externalInputAuthRequired (honoured by deep links and share intents), protectedNavigation (header/menu), the Lockscreen's POS waiver comment, and ReceiveEcash itself, which hides its header ScanButton when posStatus === 'active'. The Wallet tab bar also removes the Keypad and Camera tabs in POS mode.

The create-invoice form in ReceiveEcash, rendered whenever !loading && !haveInvoice && !creatingInvoice, contains a 'read token from clipboard' button that calls handleAnything(clipboard) and then navigation.navigate(route, props) unconditionally. The form has no posStatus condition, and the button has no posStatus / externalInputAuthRequired / protectedNavigation gate. In POS mode the form becomes visible whenever the auto-generated Cashu invoice fails: CashuStore.createInvoice catches every error (not properly configured, mint unreachable, CDK quote rejected), sets creatingInvoiceError and leaves invoice undefined, and autoGenerateInvoice has no failure handling, so haveInvoice stays false and the full form is shown. A staff member holding the terminal can induce that failure by disabling the device's network before tapping Pay; it holds permanently when ecash is enabled but no mint is configured.

With a BOLT11 invoice, BOLT12 offer, on-chain address or node pubkey on the clipboard, handleAnything returns 'PaymentRequest', 'ChoosePaymentMethod' or 'Send', and the app navigates there. None of those screens re-check the lock, so the staff member can pay from the owner's node or Cashu balance without the PIN. The sibling NFC/scan path (validateAddress) only acts on lnurlParams and swallows everything else, so this clipboard button is the one handleAnything-driven navigation in the POS-reachable screen that is not constrained.

Root cause: a handleAnything-driven navigation inside a POS-reachable screen is not gated on posStatus / externalInputAuthRequired the way the header scan button, share intents and deep links are, and a failed POS auto-invoice falls through to the owner-facing create form.

## Evidence
1. [views/Cashu/ReceiveEcash.tsx:897–915](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/ReceiveEcash.tsx#L897-L915)
   The 'read token from clipboard' button reads Clipboard.getString(), passes it to handleAnything(clipboard) and calls navigation.navigate(route, props) with whatever route comes back. Unlike validateAddress (NFC/scan path, which only acts on lnurlParams), nothing restricts the route, and there is no posStatus, protectedNavigation or externalInputAuthRequired check.
2. [views/Cashu/ReceiveEcash.tsx:781](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/ReceiveEcash.tsx#L781)
   The create-invoice form containing the clipboard button renders whenever !loading && !haveInvoice && !creatingInvoice, with no posStatus condition, so it appears in POS mode as soon as the auto-generated invoice fails.
3. [stores/CashuStore.ts:4029–4042](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L4029-L4042)
   createInvoice catches every error (isProperlyConfigured false, mint unreachable, CDK quote rejected), sets creatingInvoiceError=true and creatingInvoice=false and leaves this.invoice undefined, so haveInvoice is false and the form renders. The device holder can force this by disabling network before checkout; it also holds permanently when ecash is enabled without a configured mint.
4. [views/Cashu/ReceiveEcash.tsx:256–265](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/ReceiveEcash.tsx#L256-L265)
   autoGenerateInvoice calls createInvoice with no failure handling; on failure it just calls subscribeInvoice, which returns early, and the screen falls through to the full create form rather than an error/retry view.
5. [views/Cashu/ReceiveEcash.tsx:502–512](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/ReceiveEcash.tsx#L502-L512)
   The header hides the ScanButton (HandleAnythingQRScanner) when posStatus === 'active', showing the maintainers intend POS staff not to reach handleAnything-driven navigation; the body clipboard button is not hidden.
6. [stores/SettingsStore.ts:2695–2701](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L2695-L2701)
   externalInputAuthRequired and its comment state the project's control: input that can navigate to Send must be authenticated when posStatus is 'active', because the Lockscreen's POS waiver sets loggedIn without a PIN. Deep links (LinkingUtils.ts:123) and share intents (ShareIntentProcessor.ts:60) honour it; the ReceiveEcash clipboard button does not.
7. [utils/handleAnything.ts:436–495](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L436-L495)
   For a BOLT12 offer, on-chain address, node pubkey or BOLT11 handleAnything returns 'Send', 'ChoosePaymentMethod' or 'PaymentRequest'; none of those screens re-check posStatus or loginRequired (no such reference in Send.tsx, PaymentRequest.tsx, ChoosePaymentMethod.tsx).
8. [stores/PosStore.ts:172–192](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/PosStore.ts#L172-L192)
   processCheckout routes POS checkout to ReceiveEcash with autoGenerate:true whenever settings.ecash.enableCashu and the backend supports Cashu, making the screen part of the unauthenticated POS flow.
9. [views/Order.tsx:1312–1343](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Order.tsx#L1312-L1343)
   The POS Order screen's Pay button likewise opens ReceiveEcash with autoGenerate:true when ecash is enabled.

## Impact
Reaching Send/PaymentRequest lets the staff member spend the owner's Lightning, on-chain or Cashu balance to a destination of their choice, which is exactly what the POS lock exists to prevent. No direct confidentiality or availability impact.

## Reproduction steps
1. Attacker is POS staff physically holding the terminal in posStatus 'active' without the owner's PIN, with Cashu enabled. They start a checkout so ReceiveEcash opens with autoGenerate; they make invoice creation fail (toggle airplane mode / Wi-Fi off before tapping Pay, or it already fails if no mint is configured), the create form with the clipboard button appears, they restore the network, copy a BOLT11/address/offer of their own, tap the button and are taken to PaymentRequest/ChoosePaymentMethod/Send, where they pay from the owner's funds. The invoice-creation failure is a precondition, but one the attacker can create from the device; no further defence stands in the way.

## Recommended fix
ReceiveEcash's clipboard button navigates to any route returned by handleAnything without checking posStatus or externalInputAuthRequired, and the create form containing it is rendered in POS mode when auto-invoice creation fails. Fix criteria: In POS mode (posStatus 'active' with a login method configured) the clipboard button must be hidden or its navigation routed through the Lockscreen (protectedNavigation / externalInputAuthRequired), and a failed auto-generated POS invoice must show an error/retry view rather than the owner-facing create form. Verify that with posStatus 'active' and a BOLT11, offer or address on the clipboard no path from ReceiveEcash reaches Send, ChoosePaymentMethod or PaymentRequest without the PIN.

---
**Severity:** LOW
**Status:** Open
**Category:** Missing Authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258227

---

# Embedded LND rebalance result is decided by stale TransactionsStore state, not the payment

## Details
On the embedded LND backend (the default local wallet; LND.supportsCircularRebalancing() = true is inherited), the circular rebalance flow never evaluates the payment it just made. Rebalance.executeLndRebalance awaits BackendUtils.payLightningInvoice, which for embedded-lnd is EmbeddedLND.payLightningInvoice -> lndmobile.sendPaymentV2Sync. With no_inflight_updates:true that resolves the terminal lnrpc.Payment (numeric status SUCCEEDED/FAILED, payment_preimage, failure_reason; pbjs --keep-case) unwrapped, or `{ payment_error }` only on the forced timeout. handleLndPaymentResult (Rebalance.tsx:926-939) recognises only `result.result` (the LND REST stream wrapper) or `result.payment_error`, so a real terminal Payment matches neither branch, is discarded, and handleFallbackPaymentCheck runs.

The fallback (1011-1044) decides the outcome from TransactionsStore.payment_error / payment_preimage after a 3 s sleep. The rebalance flow never writes those fields (executeRebalanceWithParameters only sets TransactionsStore.loading); the store clears them only when the next ordinary payment starts (sendPaymentInternal, TransactionsStore.ts:629-632) or on wallet connect (reset(), 120-136, called from Wallet.tsx:658). The screen the user sees is therefore a function of the previous ordinary lightning payment in the session:
- previous payment succeeded -> rebalance shown as SUCCESS with the previous payment's preimage (also used as the note key), regardless of whether the rebalance HTLC succeeded, failed or is still in flight;
- previous payment failed -> the previous payment's error shown as the rebalance error, with Try Again;
- no previous payment -> 'may still be processing' error with Try Again, even when the discarded Payment said SUCCEEDED.

The generic send path knows the shape difference and normalises it (`response.result || response`, TransactionsStore.ts:748 and 805) before handlePayment (815-887) derives status from lnrpc.Payment.PaymentStatus; the rebalance handler omits both steps. Remote LND REST reaches the same fallback whenever /v2/router/send emits a stream-level `{"error":...}` line (LND.ts:96-104 returns the last streamed line verbatim).

Measured against the threat model's 'payment/receipt state must be truthful (no fake success, no false failure causing double-pay)': a routing peer that fails or holds the rebalance HTLC is masked by a success screen whenever a prior payment succeeded (fake success); and in the no-prior-payment / prior-failure case every rebalance that actually succeeded is presented as failed with Try Again (false failure), so a user who retries - as the screen invites - performs a second rebalance and pays routing fees a second time, with nothing in executeRebalance (527-544) guarding against it. Distinct from rebalance-result-try-again-offered-for-in-flight-rebalance: there the payment is genuinely unresolved; here the result is simply never read.

## Evidence
1. [views/Tools/Rebalance.tsx:926–938](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/Rebalance.tsx#L926-L938)
   handleLndPaymentResult only recognises a wrapped `result.result` (LND REST stream line) or `result.payment_error`; any other shape goes to handleFallbackPaymentCheck. The embedded LND backend returns neither, so on embedded-lnd every rebalance takes the fallback and the actual terminal Payment is discarded.
2. [views/Tools/Rebalance.tsx:1011–1044](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/Rebalance.tsx#L1011-L1044)
   handleFallbackPaymentCheck waits 3s and then declares the rebalance failed if TransactionsStore.payment_error is set, succeeded (success screen, that preimage shown and used as the note key) if TransactionsStore.payment_preimage is set, else 'may still be processing' error. Rebalance never writes these fields on this path (executeRebalanceWithParameters only sets loading), so they are whatever the last ordinary payment left behind.
3. [backends/EmbeddedLND.ts:238–259](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/EmbeddedLND.ts#L238-L259)
   EmbeddedLND.payLightningInvoice returns sendPaymentV2Sync(...) directly - the decoded lnrpc.Payment, not an object with a `.result` wrapper.
4. [lndmobile/index.ts:297–399](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/lndmobile/index.ts#L297-L399)
   sendPaymentV2Sync sets no_inflight_updates:true, resolves decodeSendPaymentV2Result(e.data) (a raw lnrpc.Payment with status/payment_preimage/failure_reason) on the terminal event, or `{ payment_error }` on the forced timeout. The successful/failed Payment shape has no `result` and no `payment_error` key.
5. [stores/TransactionsStore.ts:748](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L748)
   sendPaymentInternal normalises both response shapes with `response.result || response` (also at 805 in sendPaymentSilently) before handing the Payment to handlePayment; this is the project's own contract for payLightningInvoice, which Rebalance.handleLndPaymentResult does not apply.
6. [stores/TransactionsStore.ts:815–886](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L815-L886)
   handlePayment sets payment_preimage (via Payment.getPreimage) on a successful ordinary payment and payment_error on a failed one; sendPaymentInternal (629-632) clears them only when the next ordinary payment starts and reset() (120-136) only runs on wallet connect (views/Wallet/Wallet.tsx:658) or an NWC reset. The values therefore persist for the session into the rebalance fallback.
7. [views/Tools/RebalancingChannels.tsx:620–734](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/RebalancingChannels.tsx#L620-L734)
   The result screen trusts rebalanceData.success/error from the route param: the stale-preimage path renders the success animation, 'Rebalance amount' and the previous payment's preimage in the CopyBox; the stale-error/unclear path renders the Error heading with Try Again (872-894).
8. [views/Tools/RebalancingChannels.tsx:437–460](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/RebalancingChannels.tsx#L437-L460)
   successfullySent() likewise treats stale TransactionsStore.payment_route/status from an earlier payment as proof the rebalance succeeded, driving BalanceStore refresh and hardware-back behaviour.
9. [backends/LND.ts:96–104](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L96-L104)
   LND REST returns the last streamed line; when SendPaymentV2 fails inside the stream grpc-gateway emits `{"error":{...}}`, which also has neither `.result` nor `.payment_error`, so remote LND reaches the same stale-state fallback on stream errors.

## Impact
Integrity of payment-state reporting: a failed or stalled rebalance is displayed as successful with another payment's preimage, and a successful one is displayed as failed with a retry affordance that leads to a second rebalance and a second routing fee (each bounded by the user's fee limit, default 100 sats). Funds stay within the user's own node, so loss is limited to routing fees and misdirected liquidity: integrity low. The preimage shown is the user's own (no confidentiality impact); no availability impact.

## Reproduction steps
1. The device user runs a circular rebalance on an embedded-LND wallet (or remote LND when the stream emits an error line); the Payment LND returns is discarded and the outcome read from stale store state. False-failure needs no attacker input: with no prior payment (or a prior failure) a SUCCEEDED rebalance is shown as failed with Try Again. Fake-success needs an in-scope routing peer on the user's chosen route to fail or withhold the HTLC after an earlier ordinary payment succeeded in the session (runtime state, AT:P). The user must actively perform the rebalance (UI:A); no privileges or defenses are involved.

## Recommended fix
1. handleLndPaymentResult does not recognise the unwrapped lnrpc.Payment returned by the embedded LND backend (nor the LND REST stream-error object), so the actual terminal result is discarded. Fix criteria: The rebalance handler normalises the backend response the same way TransactionsStore does (`response.result || response`), maps SUCCEEDED/FAILED/IN_FLIGHT from that object (using lnrpc.Payment.PaymentStatus for embedded-lnd's numeric status), and treats an `{error}` object as an error. Verify: on embedded-lnd a SUCCEEDED Payment yields the success screen with its own preimage and a FAILED Payment yields the failure reason, with TransactionsStore untouched.
2. handleFallbackPaymentCheck infers the rebalance outcome from TransactionsStore.payment_error/payment_preimage, which this flow never sets and which hold the previous ordinary payment's result for the whole session. Fix criteria: No rebalance outcome is ever derived from shared state the rebalance did not write; an unrecognised response is reported as unknown (in-flight, no Try Again) or confirmed by looking up this rebalance's own payment hash via ListPayments. Verify: after a successful ordinary payment, a rebalance whose payment fails is not shown as successful, and the shown preimage (if any) matches the rebalance invoice.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper exceptional condition check
**CWE:** [CWE-754](https://cwe.mitre.org/data/definitions/754.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258226

---

# Rebalance result screen offers Try Again for in-flight/timed-out rebalance, enabling double rebalance

## Details
The circular-rebalance flow (Tools -> Rebalance -> RebalancingChannels) has the same retry-after-unknown-outcome exposure that the verified finding sending-lightning-retry-offered-for-timed-out-keysend documents for the generic send screen, through a different sink and with a different double-pay mechanism.

Every backend deliberately surfaces an unknown payment outcome as a non-retryable-looking shape: LND REST and embedded LND resolve `{ payment_error: 'Payment timed out. It may be in transit...' }` when the request outlives timeout_seconds (Rebalance passes 120s) while the HTLC is still held; LNC resolves the same shape or an IN_FLIGHT status; CLN's /v1/waitsendpay is called with no `timeout` and the 120s transport timeout rejects with 'Request timeout' while the sendpay is still pending. Rebalance.tsx maps all of these to createRebalanceResult(false, <message>) (handleLndPaymentResult 929-935, handleLncPaymentResult 915-921 -> handleUnclearPaymentStatus 996-1009, CLN catch -> handleBackendError 642-668 -> handleRebalanceError 1102-1103). RebalancingChannels then renders the 'Error' heading with the primary white 'Try Again' button for any `error` (872-894), whose handler is navigation.goBack() to the Rebalance screen with source/destination channels and amount still selected.

executeRebalance (527-544) has no in-flight guard and each execution creates a brand-new self-invoice (560-591), so a retry is a second, independent payment with a fresh hash that the node cannot deduplicate. If the first HTLC later settles (LND/CLN keep in-flight HTLCs after their retry timeout; the recipient is the user's own node, which settles as soon as the HTLC arrives), both rebalances complete: liquidity is moved twice the approved amount and routing fees are paid twice (each bounded by fee_limit_sat / maxfee_msat).

An adversary needs only to be a node on the rebalance route - the user-selected destination peer (forced by last_hop_pubkey) or source peer is always on it - and to hold the HTLC past the wallet's timeout before forwarding, which any routing node can do. The screen text for LND says the payment may be in transit, but the affordance contradicts it, and the CLN and LNC messages ('Failed to execute payment', 'Payment status: IN_FLIGHT ... check your transaction history') do not warn at all. The project's own SendingLightning.test.tsx pins that IN_FLIGHT shows no Try Again on the generic screen; the rebalance screen has no such distinction.

## Evidence
1. [views/Tools/RebalancingChannels.tsx:872–894](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/RebalancingChannels.tsx#L872-L894)
   The primary white 'Try Again' button renders for any truthy rebalanceData.error, including the timed-out, IN_FLIGHT and 'unclear' shapes; its onPress (handleTryAgain, 481-484) is navigation.goBack() to the Rebalance screen whose selected channels and amount are still in state.
2. [views/Tools/Rebalance.tsx:926–938](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/Rebalance.tsx#L926-L938)
   handleLndPaymentResult folds the backends' unknown-outcome shape `{ payment_error: 'Payment timed out. It may be in transit...' }` (LND REST and embedded LND) into createRebalanceResult(false, payment_error) - the same error state as a definitive failure.
3. [views/Tools/Rebalance.tsx:892–922](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/Rebalance.tsx#L892-L922)
   handleLncPaymentResult: the LNC backend's timed-out shape `{ payment_error }` (LightningNodeConnect.ts:568-583, resolved after timeout_seconds+60 = 180s because utils/LncPayUtils.ts:91 drops every non-terminal IN_FLIGHT event) has no status, so `result.status || result.state || UNKNOWN` falls to the default branch and handleUnclearPaymentStatus (996-1009) produces an error result, so LNC rebalances still in transit get the Try Again control too.
4. [views/Tools/Rebalance.tsx:784–805](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/Rebalance.tsx#L784-L805)
   CLN path: waitSendPay is called without a timeout; CLNRest.waitSendPay (backends/CLNRest.ts:800-816) posts /v1/waitsendpay with a 120s transport timeout that rejects with 'Request timeout' (CLNRest.ts:96-100) while the HTLC is still pending. handleBackendError then throws the generic 'Failed to execute payment' Error, which handleRebalanceError (1046-1104) renders as an error result with Try Again.
5. [views/Tools/Rebalance.tsx:527–544](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/Rebalance.tsx#L527-L544)
   executeRebalance has no in-flight guard (nothing checks TransactionsStore.paymentInFlight/loading or a prior unresolved rebalance); tapping Execute again after Try Again immediately dispatches another rebalance.
6. [views/Tools/Rebalance.tsx:560–591](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/Rebalance.tsx#L560-L591)
   Every run creates a fresh self-invoice (new payment hash) via BackendUtils.createInvoice, so the node cannot reject the retry as a duplicate the way a BOLT11 re-pay would be; the first HTLC can still settle after the retry is dispatched.
7. [backends/LND.ts:555–577](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L555-L577)
   LND REST payLightningInvoice races /v2/router/send against a forced timeout at timeout_seconds+1 (120s default from Rebalance) and resolves the timed-out shape while in-flight HTLCs are still held; the comment states this shape must not look retryable.
8. [lndmobile/index.ts:384–395](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/lndmobile/index.ts#L384-L395)
   Embedded LND sendPaymentV2Sync races the same forced timeout and resolves the identical `{ payment_error }` shape.

## Impact
Integrity of the wallet's spend control and the threat model's 'no false failure causing double-pay' asset: the user ends up with two rebalances of the approved amount, paying routing fees twice (each capped by the fee limit) and shifting liquidity by twice the approved amount. Funds themselves return to the user's node, so the direct loss is bounded to the fee cap per induced retry; integrity is rated low. No confidentiality or availability impact.

## Reproduction steps
1. Attacker: any Lightning node on the rebalance route, in particular the user's own destination peer, which is always the last hop (LND: last_hop_pubkey at Rebalance.tsx:834; CLN: the askrene layer at 705-728 disables every channel except the destination, so getroutes must end through it). It accepts the rebalance HTLC and withholds forwarding/settlement past the wallet's deadline (121s LND/embedded, 180s LNC, 120s CLN transport). The wallet shows the Error screen with the primary 'Try Again' button; the user taps it, lands on the still-mounted Rebalance screen with channels and amount intact, and taps Execute, which creates a new self-invoice and dispatches a second payment with no in-flight check (527-544, button disabled only on selection/amount at 1644-1648). The peer then releases the first HTLC; the user's own node settles both invoices. The second rebalance only completes if the source channel has another `amount` of outbound and the destination peer can forward both; that is the common case for amounts below max. Needs the user's active retry (UI:A); no credential or control is defeated.

## Recommended fix
1. Rebalance.tsx collapses the backends' unknown-outcome results (timed-out payment_error, IN_FLIGHT/UNKNOWN status, CLN waitsendpay transport timeout) into the same error result as a definitive failure, and RebalancingChannels renders 'Try Again' for every error. Fix criteria: An in-transit/unknown-outcome rebalance renders a distinct in-flight state with no Try Again control and back navigation to the wallet; only results the node reports as terminally FAILED offer a retry. Verify with a backend returning the paymentTimedOut shape or IN_FLIGHT: no Try Again button is shown.
2. executeRebalance dispatches a new self-invoice payment with no check that a previous rebalance from this screen is still unresolved. Fix criteria: A second rebalance is refused or explicitly confirmed with an in-transit warning while the previous rebalance's payment hash has no terminal status from the node (e.g. ListPayments still shows it IN_FLIGHT / CLN sendpays pending). Verify: after a timed-out rebalance, returning and tapping Execute does not dispatch a second payment until the first is reported failed.
3. The CLN path calls waitsendpay without a timeout, so the only exit for a pending payment is a transport rejection that is indistinguishable from an execution failure. Fix criteria: waitSendPay is passed an explicit timeout below the transport deadline and CLN's 'timed out' response (error code 200) is mapped to the in-flight state rather than an error; verify a pending sendpay produces the in-flight screen, not 'Failed to execute payment'.

---
**Severity:** LOW
**Status:** Open
**Category:** Duplicate action
**CWE:** [CWE-837](https://cwe.mitre.org/data/definitions/837.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258225

---

# Wallet connect-time side effects navigate over the Lockscreen after a background lock

## Details
Wallet.handleAppStateChange (views/Wallet/Wallet.tsx:359-396) implements lock-on-background by calling SettingsStore.setLoginStatus(false) on 'background' (when loginBackground is enabled) and, on the next 'active', navigation.navigate('Lockscreen') (379). Lockscreen is an ordinary Stack.Screen (App.tsx:607-616, only gestureEnabled:false) and the NavigationContainer has no onStateChange guard, so the lock is a route pushed on top of the stack, not an interceptor: any route pushed afterwards renders above it without a credential. A fetchData that was in flight when the app was backgrounded is neither cancelled nor parked by the lock — the connection guard (SettingsStore.getConnectionGuard, 2560) only fails on connectionSeq/selectedNode/implementation changes, none of which a lock performs — and its tail performs navigations that never consult SettingsStore.loginRequired():

(a) processPendingGraphSyncPayment (dispatched at 1479, body 1506-1541) reads the payment the owner deferred when accepting the Express Graph Sync prompt mid-payment (utils/GraphSyncUtils.ts handleEnableGraphSync persists it and forces a restart; TransactionsStore.sendPayment:581-588 routes both invoice and keysend payments through that prompt) and calls navigation.navigate('PaymentRequest', {fromGraphSync:true}) or navigation.navigate('Send', {destination, satAmount, transactionType:'Keysend', fromGraphSync:true}). The data is only cleared when PaymentRequest/Send mounts (views/PaymentRequest.tsx:150, views/Send.tsx:260), so it is armed for the whole first connect after the restart. That connect runs expressGraphSync (Wallet.tsx:922-933) and startLnd, which take long enough for the owner to switch apps; with loginBackground enabled they come back to a Lockscreen, and when fetchData finishes PaymentRequest/Send is pushed over it. In the invoice branch the holder sees the invoice (destination, amount, memo) and can pay it (PaymentRequest.tsx:369 -> SendingLightning). In the keysend branch the Send screen's header renders Scan (-> HandleAnythingQRScanner) and NFC unconditionally (views/Send.tsx:768-812); a scanned payload goes through handleAnything -> navigation.navigate(route, props) (Send.tsx:403-413), so the holder can present their own BOLT11 invoice and pay it from the locked wallet, bounded only by channel balance; Send also exposes Contacts (963).

(b) showFolderMissingAlert (805-838) and the RPC folder-missing alert (1214-1235) present a native Alert, drawn above the Lockscreen, whose buttons run navigation.navigate('Wallets') or navigation.navigate('Tools', {showClearDataModal:true}); Tools auto-runs handleClearStorage -> clearAllData on confirm (views/Tools/index.tsx:89-92, 145) with no re-authentication. This needs the abnormal lnd-folder-missing state and is not rated.

(c) The 60 s startup-slow timer (armed at 1064, body 1066-1130) fires while connecting is still true — on iOS right after resume because JS timers pause in the background (react-native 0.87.1), on Android the Alert raised while the activity was paused is shown on resume — and its 'LND Logs' button navigates to LNDLogs (lnd log tail: pubkey, peers, channel points) over the lock.

The sibling consumers in the same tail are gated: LinkingUtils.handleDeepLink defers on externalInputAuthRequired() (utils/LinkingUtils.ts:116-120) and ShareIntentProcessing re-checks the gate live. The graph-sync pending payment and the connect-time Alert buttons were not given the same treatment: a navigation decided before the lock is executed after it. Preconditions all belong to the owner's prior actions (embedded LND on mainnet, PIN/passphrase plus loginBackground, graph-sync acceptance mid-payment, backgrounding during the first connect) and none are deployment switches the project documents as required fencing.

## Evidence
1. [views/Wallet/Wallet.tsx:1506–1541](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L1506-L1541)
   processPendingGraphSyncPayment loads the persisted deferred payment and calls navigation.navigate('PaymentRequest', {fromGraphSync:true}) or navigation.navigate('Send', {destination, satAmount, transactionType:'Keysend', fromGraphSync:true}) with no SettingsStore.loginRequired()/externalInputAuthRequired() check; when a Lockscreen was pushed during the connect, these routes land on top of it.
2. [views/Wallet/Wallet.tsx:1462–1480](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L1462-L1480)
   Tail of fetchDataCore: handleInitialUrl/processPendingDeepLink are gated inside LinkingUtils and processPendingShareIntent routes through ShareIntentProcessing's live gate, but processPendingGraphSyncPayment (1479) is dispatched ungated after the connect completes — which may be long after a background lock pushed the Lockscreen.
3. [views/Wallet/Wallet.tsx:359–396](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L359-L396)
   handleAppStateChange sets loggedIn=false on 'background' (loginBackground on) and on 'active' only does navigation.navigate('Lockscreen') (379). It neither cancels the in-flight fetchData nor bumps connectionSeq, so the connection guard stays current and the fetch tail still runs its navigations.
4. [App.tsx:607–616](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/App.tsx#L607-L616)
   Lockscreen is registered as an ordinary native-stack screen with only gestureEnabled:false; the NavigationContainer has no onStateChange/route guard, so routes pushed after the Lockscreen render above it.
5. [views/Send.tsx:768–811](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Send.tsx#L768-L811)
   Send header renders Scan (navigation.navigate('HandleAnythingQRScanner')) and NFC regardless of the locked-destination keysend branch; scanned input flows through validateAddress -> handleAnything -> navigation.navigate(route, props) (403-413), letting the device holder bring their own invoice to pay from the locked wallet.
6. [utils/GraphSyncUtils.ts:8–19](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/GraphSyncUtils.ts#L8-L19)
   handleEnableGraphSync persists the pending payment (savePendingPaymentData) and forces a restart; it is only cleared when PaymentRequest/Send mounts with fromGraphSync (views/PaymentRequest.tsx:150, views/Send.tsx:260), so it is armed for the whole first connect after the restart.
7. [views/Wallet/Wallet.tsx:1066–1130](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L1066-L1130)
   The 60 s startup-slow timer fires after resume while connecting is still true and shows a native Alert (drawn above the Lockscreen) whose 'LND Logs' button is navigation.navigate('LNDLogs') with no login check.
8. [views/Wallet/Wallet.tsx:805–838](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L805-L838)
   showFolderMissingAlert (and the RPC-error sibling at 1214-1235) shows a native Alert whose buttons run navigation.navigate('Wallets') and navigation.navigate('Tools', {showClearDataModal:true}) with no login check; requires the abnormal lnd-folder-missing state, so noted but not rated.
9. [views/Tools/index.tsx:89–92](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Tools/index.tsx#L89-L92)
   Tools auto-runs handleClearStorage when navigated with showClearDataModal, leading to clearAllData() (145) on confirmation, with no re-authentication.
10. [utils/LinkingUtils.ts:116–120](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LinkingUtils.ts#L116-L120)
   The deep-link sibling in the same fetchData tail defers on settingsStore.externalInputAuthRequired(); this is the project's shipped control for this surface, which the graph-sync and alert navigations act around.

## Impact
Invoice branch: the holder sees the owner's pending invoice (destination, amount, memo) and can submit it — an unauthorised but owner-intended spend. Keysend branch: the Send screen's unconditional Scan/NFC header hands scanned input to handleAnything, so the holder can present and pay their own BOLT11 invoice from the locked wallet, bounded only by outbound channel balance — loss of funds to an attacker-chosen destination, hence I:H. Disclosure is limited to the pending payment, Contacts reachable from Send, and the lnd log tail via LNDLogs (node pubkey, peers, channel points): C:L. No seeds or credentials are exposed. The clear-data path in (b) would wipe the wallet but needs the corrupted-install state, so it is not rated.

## Reproduction steps
1. Attacker holds the device while the app is locked (in-scope device-holder adversary; SECURITY.md lists 'Bypass of PIN, passphrase, or duress protections'). Owner state required: embedded LND on mainnet, PIN/passphrase with loginBackground enabled, acceptance of the Express Graph Sync prompt mid-payment (persisting the payment and restarting), unlock after the restart, then backgrounding during the long first connect. On resume the holder sees the Lockscreen; when the connect finishes PaymentRequest/Send is pushed over it with no credential, deterministically. The LNDLogs alert path needs only embedded LND plus a startup slower than 60 s under the same lock. The state is narrow and outside the attacker's control, hence AT:P; no interaction by anyone other than the attacker is needed.

## Recommended fix
1. processPendingGraphSyncPayment and the connect-time Alert button handlers navigate to protected screens based on a decision made before the lock, without checking whether loginRequired()/externalInputAuthRequired() has since become true; the Lockscreen being a pushed route means they land on top of it. Fix criteria: Every navigation or alert action triggered by connect-time side effects must check the lock state at dispatch time and, when locked, defer (e.g. hold the target as pendingNavigation for the Lockscreen or until the next refresh with loggedIn true) rather than navigating. Verify: enable Express Graph Sync during a payment, restart, unlock, background during the sync with loginBackground on, resume - the Lockscreen must stay the top route until a correct credential, and PaymentRequest/Send must appear only afterwards.
2. A background lock (setLoginStatus(false)) does not cancel or park the UI work queued by the in-flight fetchData, so work scheduled while unlocked executes against a locked session. Fix criteria: When the session is locked while a connect is in progress, any pending navigation produced by that connect (graph-sync payment, alerts, future additions) must be queued and re-dispatched only after authentication succeeds. Verify that no route other than Lockscreen can become focused between a background lock and a successful unlock regardless of fetchData timing.

---
**Severity:** LOW
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-288](https://cwe.mitre.org/data/definitions/288.html)
**Attack vector:** PHYSICAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258223

---

# LNC SendPaymentV2 raw error from any concurrent stream rejects every pending payment

## Details
On the LNC backend every SendPaymentV2 stream reports on the single emitter event 'routerrpc.Router.SendPaymentV2' (LightningNodeConnect.ts:549-552, 587-601). The native bridge emits each stream's results under the bare method name with no stream identifier (LncModule.kt:189-203; LncModule.mm:198-214) and has no separate error channel: a gRPC status error terminating a stream arrives as 'rpc error: code = ... desc = ...' text on the same event (the project pins this in LncPayUtils.test.ts:158-166 and LightningNodeConnect.test.ts:428). The shipped correlation covers only JSON lnrpc.Payment events with a parseable payment_hash (decideLncPayEvent, LncPayUtils.ts:93-98). Two shapes bypass it: a raw error string, which decideLncPayEvent classifies as {kind:'error'} before the hash check (81-89), and, for AMP payments, any terminal Payment (deriveExpectedPaymentHash returns undefined, line 47). payLightningInvoice then rejects (596-598), so one stream's request-level failure rejects every pending payment listening on the channel.

lnd returns a gRPC error (not a FAILED Payment) from SendPaymentV2 for request-level rejections, notably codes.AlreadyExists for a payment hash the node already paid or has in flight, and Canceled/Unavailable when the mailbox session drops (assumption about the lnd node behind LNC and the Go bridge in Lndmobile v0.21.4-beta-zeus.1; consistent with the project's own tests).

Attack path: the NWC wallet service runs on LNC (supportsNostrWalletConnectService, LightningNodeConnect.ts:1187; Wallet.tsx:381) and service payments bypass the user's in-flight guard (TransactionsStore.ts:614-622; enqueuePayment serialises only NWC-originated payments, and nothing gates dispatch on the user's payment state). The NWC pay_invoice handler rejects expired invoices (NostrWalletConnectStore.ts:2569-2581) but dedupes only unresolved activity of its own connection (2594-2609; NWCConnection.isUnresolvedPayInvoiceActivity returns false for a completed, budget-debited row, 276-291), so a client replaying an invoice it already paid — e.g. a 1-sat invoice to itself — passes the budget check and is dispatched (2646-2656); lnd rejects it with AlreadyExists and the raw error lands on the shared channel. If the user has a payment in flight from the UI, their payLightningInvoice promise rejects with that text, handlePaymentError (888-894) marks the payment failed and releases the guard, SendingLightning shows Error + Try Again (583-604), and the user's HTLC may still settle. The attacker can replay at no cost until the window is hit. A retry re-pays: for keysend each dispatch carries a fresh preimage (TransactionsStore.ts:661-669), so this is a genuine double-send (lnd's same-hash protection covers only bolt11 retries). The same crosstalk occurs with no attacker whenever a background and a user payment overlap and either fails at the RPC level, and in the AMP case the user's payment resolves on another payment's SUCCEEDED/FAILED event (false success with a foreign preimage, or false failure).

Relation to existing records: embedded-lnd-router-send-payment-event-crosstalk is the same class in the embedded-LND bridge (lndmobile/index.ts), where no correlation exists at all; nwc-shared-transactions-store-payment-result-crosstalk concerns the shared MobX fields. This record is the LNC bridge-level gap: the correlation that exists is bypassed by hash-less error events and skipped for AMP, so fixing the store would not stop the foreign rejection from settling the user's promise.

## Evidence
1. [utils/LncPayUtils.ts:69–101](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LncPayUtils.ts#L69-L101)
   decideLncPayEvent returns {kind:'error'} for any non-JSON event string (81-86) and for JSON non-objects (87-89) before the payment_hash correlation at 93-98 is reached. A raw Go error string carries no hash, so every listener treats it as its own payment's failure regardless of which stream produced it. With expectedHashHex undefined (AMP, line 47 of deriveExpectedPaymentHash) any terminal event is also accepted.
2. [backends/LightningNodeConnect.ts:539–603](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LightningNodeConnect.ts#L539-L603)
   payLightningInvoice subscribes to the shared 'routerrpc.Router.SendPaymentV2' event (the comment acknowledges it is 'shared by every concurrent payment, with no request correlation'); on decision.kind==='error' it settles by rejecting (596-598). Every pending payLightningInvoice promise sees the same error event and all of them reject, contradicting the designed in-transit fallback at 568-585.
3. [android/app/src/main/java/com/zeus/lnc-rn/LncModule.kt:189–203](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/lnc-rn/LncModule.kt#L189-L203)
   initListener emits every result of a stream — Go-side results and error strings, plus the synchronous failure message — on the stream's method-name event via sendEvent (167-174), with no stream identifier.
4. [ios/LncMobile/LncModule.mm:198–214](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LncMobile/LncModule.mm#L198-L214)
   iOS counterpart: initListener binds a StreamingCallback to the bare method name; StreamingCallback.sendResult emits {result} on that event for every stream, so the channel is shared on both platforms.
5. [stores/TransactionsStore.ts:614–622](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L614-L622)
   Background (NWC service) payments bypass the paymentInFlight guard, so a user payment and an NWC payment can have two SendPaymentV2 streams open at once on the LNC backend.
6. [stores/NostrWalletConnectStore.ts:2646–2656](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2646-L2656)
   NWC pay_invoice dispatches through TransactionsStore.sendPayment with background:true; LightningNodeConnect.supportsNostrWalletConnectService() is true (line 1187) and Wallet.tsx:381 initializes the service on such backends, so an external NWC client can open the concurrent stream.
7. [stores/NostrWalletConnectStore.ts:2592–2609](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2592-L2609)
   Pre-dispatch dedupe consults only this connection's activity and short-circuits only when that activity is unresolved; a replay of an invoice the connection already paid falls through to the budget check and dispatch, so lnd rejects it at the RPC level (AlreadyExists) and the raw error lands on the shared channel. Expiry is checked earlier (2569-2581), so the already-paid replay is the attacker's cost-free trigger.
8. [models/NWCConnection.ts:276–291](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/models/NWCConnection.ts#L276-L291)
   isUnresolvedPayInvoiceActivity returns false for a completed, budget-debited pay_invoice row, so a replayed already-paid invoice is not short-circuited.
9. [stores/TransactionsStore.ts:888–894](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L888-L894)
   The rejection from payFunc(...).catch (746-753) reaches handlePaymentError, which sets error=true and clears the user's in-flight guard, converting the foreign error into a definitive failure of the user's payment.
10. [views/SendingLightning.tsx:583–603](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingLightning.tsx#L583-L603)
   The error state renders 'Try Again' which navigates back to the Send screen; for keysend each dispatch carries a fresh preimage (TransactionsStore.ts:661-669), so a retry after a false failure double-sends while the original HTLC may still settle.
11. [utils/LncPayUtils.test.ts:158–166](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LncPayUtils.test.ts#L158-L166)
   The maintainers' test pins that a raw 'rpc error: ...' string is classified as 'error' even when a specific expected hash is supplied, i.e. error strings deliberately bypass correlation; LightningNodeConnect.test.ts:428 pins the same 'rpc error: code = ...' shape arriving on a stream event channel.

## Impact
Integrity LOW: the wallet reports a definitive failure for a payment it dispatched whose HTLC may still settle, inviting a retry that double-sends for keysend (bolt11 retries are caught by lnd's same-hash protection), and in the AMP case may report another payment's outcome as this one's; the loss is bounded by the user's own payment amount and funds are not redirected. Confidentiality NONE in the error path (an error string carries no secret); the AMP path can hand a foreign preimage to the user's flow but that is the exception. Availability NONE.

## Reproduction steps
1. Attacker is an external NWC client already granted pay_invoice on an LNC-backed ZEUS wallet running the NWC service (PR LOW), acting over Nostr relays (AV NETWORK). It pays a tiny invoice to itself once, then replays that invoice: the handler's expiry check passes, the own-connection dedupe does not short-circuit a completed row, and lnd rejects the dispatch with a gRPC AlreadyExists error that lands on the shared channel. Replays cost nothing and can be repeated until one overlaps a user payment in flight (AT PRESENT: NWC service on LNC plus the timing overlap). No shipped control must be evaded beyond the hash correlation the raw error bypasses (AC LOW). The misreport needs no user action; the double-send needs the user to tap Try Again on a payment shown as failed (UI PASSIVE).

## Recommended fix
1. decideLncPayEvent classifies any non-JSON event on the shared SendPaymentV2 channel as this payment's error, and skips correlation for AMP, so events that cannot be attributed to the caller's stream settle the caller's promise. Fix criteria: A payment promise settles only on events attributable to its own stream: either the bridge tags each initListener stream with an identifier carried in every emitted event (including error strings) and payLightningInvoice filters on it, or un-attributable error strings are not treated as terminal for a payment whose expected hash is known (fall back to the designed in-transit resolution or re-query the payment by hash). Verify: with two SendPaymentV2 streams open, make one fail at the RPC level and confirm the other caller's promise is unaffected.
2. The bridge emits every stream's results, including synchronous and Go-side errors, under the bare method name with no stream identifier. Fix criteria: Each stream started via initListener is distinguishable to JS (per-stream event name or id field) so that consumers can discard foreign events. Verify: concurrent streams of the same method deliver their results only to their own subscriber.

---
**Severity:** LOW
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258222

---

# PSBT channel funding hardcodes spend_unconfirmed, bypassing the user's min_confs policy

## Details
ZEUS opens channels through two paths. The default path (openChannelSync) forwards the user's `min_confs` / `spend_unconfirmed` setting (default: 1 confirmation, do not spend unconfirmed; configurable in the open form and in Settings > Channels) to the node. When the user picks a non-default account in the UTXO picker or opens several channels at once (batch open, LND-based backends), `ChannelsStore.openChannel` instead uses the PSBT funding flow: it asks the node for a funding address/amount via `openChannelStream` with a `psbt_shim`, then funds the transaction itself in `handleChannelOpen` by calling `BackendUtils.fundPsbt` with:

```
const fundPsbtRequest = {
    raw: { outputs, inputs },
    sat_per_vbyte: Number(sat_per_vbyte),
    spend_unconfirmed: true,
    account
};
```

`spend_unconfirmed` is hardcoded to `true` and `min_confs` is not passed, even though `request.spend_unconfirmed` and `request.min_confs` are present on the same `request` object. When the user has not picked explicit UTXOs (the normal batch-open case, or an account switched in the picker without a selection, which calls onValueChange([], 0, account)), `inputs` is empty and the node coin-selects. Assumption about the dependency (LND walletrpc FundPsbt, remote node or the pinned embedded Lndmobile): `min_confs`/`spend_unconfirmed` go through `lnrpc.ExtractMinConfs`, so `spend_unconfirmed: true` with `min_confs` unset yields minConfs = 0 and unconfirmed outputs - including externally received ones - become eligible, largest-first by default. With a PSBT shim the node does no coin selection in OpenChannel itself, so the policy carried in the OpenChannel request has no effect either. The result is that every batch/external-account channel open may be funded from unconfirmed inputs regardless of the user's configured policy, with no indication in the UI (the form still shows `min_confs: 1`). `utils/OpenChannelUtils.ts` documents that the maintainers consider the policy a guarantee: clearing the min_confs field must never store 0 because that "would let channel opens spend unconfirmed funds".

Attack path: anyone who knows one of the victim's on-chain addresses (a payer the victim gave an address to, a refund counterparty, a dusting party) sends a low-fee, RBF-signalling payment; because they will reclaim it, they can make it large enough to be the first pick of largest-first selection. If the victim opens a batch of channels (or selects another account) while that payment is unconfirmed, the funding transaction is built on the attacker's unconfirmed output, signed, verified (`psbt_verify`) and published (`psbt_finalize`). The attacker then replaces the parent transaction. The funding transaction becomes invalid: the channels stay in pending-open (LND's initiator side has no funding timeout) until manually abandoned, and every other coin of the victim's spent in the same funding transaction is unavailable until the conflicting replacement confirms and the wallet drops the dead funding transaction. The victim sees the normal success screen and only later a never-confirming batch. No funds are stolen, but the user's explicit confirmation policy is silently bypassed and their on-chain liquidity and channel-open attempt can be invalidated by a third party - precisely what the min_confs policy exists to prevent and what the default path enforces.

Fix is to pass the user's policy through (`spend_unconfirmed: request.spend_unconfirmed`, `min_confs: request.min_confs`) in the fundPsbt request on every backend wrapper (including lndmobile/wallet.ts, which currently has no min_confs parameter), or to surface in the UI that the PSBT path ignores it.

## Evidence
1. [stores/ChannelsStore.ts:992–999](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/ChannelsStore.ts#L992-L999)
   handleChannelOpen builds the fundPsbt request that selects the coins for the externally-funded (PSBT shim) channel(s). spend_unconfirmed is a literal true and no min_confs is passed, although request.spend_unconfirmed and request.min_confs (the user's choices, forwarded unchanged from OpenChannel.tsx via connectPeer -> channelRequest -> openChannel) are available on the same request object destructured at line 978. When no explicit UTXOs were picked, inputs is [] and the node performs coin selection with these flags.
2. [stores/ChannelsStore.ts:1165](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/ChannelsStore.ts#L1165)
   Selects the PSBT funding path whenever a non-default account is chosen in the UTXO picker (UTXOPicker calls onValueChange([], 0, account) on account change/clear, so this happens with no explicit inputs) or more than one channel is opened at once (batch open; supportsChannelBatching is true for LND and EmbeddedLND). All such opens are funded through handleChannelOpen.
3. [stores/ChannelsStore.ts:1268–1282](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/ChannelsStore.ts#L1268-L1282)
   The node is asked to open the channel with a psbt_shim funding_shim. With a PSBT shim LND performs no coin selection of its own, so the min_confs/spend_unconfirmed carried in the OpenChannel request have no effect; the only place the user's policy could be honoured is the fundPsbt call above. The funded PSBT is then signed, verified (psbt_verify) and published (psbt_finalize) without further user review (lines 1002-1060).
4. [views/OpenChannel.tsx:1404–1413](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/OpenChannel.tsx#L1404-L1413)
   The request handed to the store carries min_confs (default 1, from state init at line 119 / settings at line 157) and spend_unconfirmed (false unless min_confs === 0), i.e. the user's explicit policy that the PSBT path then ignores. The form still displays this value while the open runs.
5. [utils/OpenChannelUtils.ts:63–69](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/OpenChannelUtils.ts#L63-L69)
   The maintainers' own comment states that min_confs must never silently become 0 because that 'would let channel opens spend unconfirmed funds' - the exact behaviour the PSBT path hardcodes.
6. [backends/LND.ts:413–423](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L413-L423)
   Contrast: the single-channel default-account path (openChannelSync) forwards min_confs and spend_unconfirmed to the node, so the policy is honoured there and only the PSBT/batch path deviates.
7. [lndmobile/wallet.ts:86–104](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/lndmobile/wallet.ts#L86-L104)
   Embedded-LND fundPsbt wrapper: forwards spend_unconfirmed but has no min_confs parameter at all, so a fix that passes the user's min_confs through must also extend this wrapper (the remote LND REST path at backends/LND.ts:720 posts the request object as-is).

## Impact
No confidentiality impact. Integrity LOW: the user's configured min_confs policy is silently overridden and the funding transaction the app reports as published can be invalidated by a third party after the success screen; the pending-channel state becomes untruthful. Availability LOW: the victim's other coins spent in the same funding transaction are unavailable until the conflicting replacement confirms, and the dead pending channels persist until manually abandoned; recoverable, no permanent loss of funds.

## Reproduction steps
1. The attacker needs only an on-chain address of the victim and the ability to broadcast an RBF-signalling transaction over the Bitcoin network (AV:N, PR:N). Exploitation requires the victim to use the batch or non-default-account channel open path while the attacker's output is unconfirmed and gets selected (AT:PRESENT); the attacker controls the output size so largest-first selection picks it deterministically (AC:L). The victim must actively initiate the channel open (UI:ACTIVE). No app-side defence applies on this path: the hardcoded flag overrides the user's min_confs setting. Dependency assumption: LND walletrpc FundPsbt derives minConfs via lnrpc.ExtractMinConfs (spend_unconfirmed=true, min_confs unset => 0), applying to remote LND nodes and the pinned embedded Lndmobile alike.

## Recommended fix
1. handleChannelOpen builds the fundPsbt request with a literal spend_unconfirmed: true and no min_confs, so the PSBT/batch funding path ignores the confirmation policy the user set in the form/settings and that the default openChannelSync path honours. Fix criteria: The coin selection performed for externally-funded (PSBT shim) channel opens must honour the same min_confs/spend_unconfirmed values that the request carries and that openChannelSync forwards. Verification: with min_confs >= 1 and an unconfirmed UTXO present, a batch or non-default-account channel open must not include the unconfirmed output in the funding PSBT (fundPsbt request carries spend_unconfirmed=false / min_confs>=1); with min_confs = 0 it may.
2. The embedded-LND fundPsbt wrapper (lndmobile/wallet.ts) exposes no min_confs parameter, so the policy cannot reach WalletKitFundPsbt on the embedded backend even if the store passes it. Fix criteria: Every backend fundPsbt wrapper (REST, LNC, embedded) forwards both min_confs and spend_unconfirmed to the node's FundPsbt call; a unit test asserts that a channel-open fundPsbt request built from min_confs=1 reaches the backend with spend_unconfirmed=false.

---
**Severity:** LOW
**Status:** Open
**Category:** Insecure default
**CWE:** [CWE-1188](https://cwe.mitre.org/data/definitions/1188.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258216

---

# NWC custom connection expiry keyed on localized unit label; non-English hours become days

## Details
ZEUS lets the user give an NWC connection (a bearer secret granting pay_invoice/get_balance/list_transactions/etc. to an external app) a custom expiry of N hours/days/weeks/months/years. The expiry date is computed by NostrConnectUtils.calculateCustomExpiryDate(value, unit), which picks the multiplier by `unit.toLowerCase().includes('hours')`, `.includes('days')`, and so on, and silently falls back to `value * 24h` (days) when nothing matches.

The `unit` it receives is not an English literal. AddOrEditNWCConnection builds the dropdown from NostrConnectUtils.TIME_UNITS, which returns localeString('time.hours'), localeString('time.days'), ... cast to the TimeUnit type, and localeString returns the translation for the app language the user selected in Settings (settings.locale; English when unset). In 20 of the 37 shipped locale files the 'hours' label contains no English substring (de: Stunden; es/pt_BR: Horas; fr: Heures; it/ro: Ore; cs: Hodin; fi: Tuntia; id: Jam; ko, zh_CN, zh_TW, el, hi_IN, bg, pl, vi ...), so N hours becomes N days; weeks/months/years likewise collapse to days in most of those locales.

Security-relevant consequence: a user who creates a connection with a custom expiry of e.g. '2 Stunden' / '3 Horas' obtains a connection whose stored expiresAt is 2 or 3 days out, 24x the configured bound. The store persists params.expiresAt unchanged, and the NIP-47 gate (NostrWalletConnectStore.withGlobalHandler -> connection.isExpiredNow()) enforces that stored value, so the external client keeps its delegated payment authority (within the required budget) and read access (get_balance, list_transactions, lookup_invoice) for the whole extended window; a leaked or over-shared connection secret likewise outlives the window the user believed they had set. The localized label is also persisted as connection.customExpiryUnit and re-used by refreshExpiryForRegenerate on every 'Regenerate connection', reproducing the error. The reverse direction (weeks/months/years collapsing to days) shortens validity: an availability nuisance only. Form validation (1..999) does not catch this; the Add/Edit form shows no computed date, and the Details screen shows only the absolute date via DateTimeUtils.formatDate.

Root cause: a security-control calculation keyed on a human-facing, translated display string rather than a stable enum/key, with an unknown unit defaulting to a longer duration instead of being rejected; the TimeUnit type misrepresents the runtime value.

## Evidence
1. [utils/NostrConnectUtils.ts:322–343](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NostrConnectUtils.ts#L322-L343)
   calculateCustomExpiryDate lowercases the unit label and tests `.includes('hours')`, `.includes('days')`, `.includes('weeks')`, `.includes('months')`, `.includes('years')`; any label matching none falls through to the final `value * 24h` (days) return at line 342. The unit it receives is the localized label from TIME_UNITS, so in 20 of the 37 shipped locale files (de, es, fr, pt_BR, it, cs, el, fi, id, ko, ro, zh_CN, zh_TW, bg, hi_IN, pl, vi, ...) 'hours' never matches and N hours is computed as N days. This is the code the fix must change.
2. [utils/NostrConnectUtils.ts:134–141](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NostrConnectUtils.ts#L134-L141)
   TIME_UNITS returns localeString('time.hours'), ('time.days'), ... cast to TimeUnit. localeString (utils/LocaleUtils.ts:85) returns the translation for settings.locale, falling back to English only when a key is missing. locales/de.json: Stunden/Tage/Wochen/Monate/Jahre; es.json: Horas/Dias/Semanas/Meses/Años; fr.json: Heures/Jours/Semaines/Mois/Ans; pt_BR.json: Horas/Dias/Semanas/Meses/Anos. The TypeScript type promises English literals but the runtime values are translations.
3. [views/Settings/NostrWalletConnect/AddOrEditNWCConnection.tsx:1457–1486](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/NostrWalletConnect/AddOrEditNWCConnection.tsx#L1457-L1486)
   The custom-expiry unit dropdown lists NostrConnectUtils.TIME_UNITS (localized labels) with key === value, and onValueChange passes the chosen label straight into getExpiryDateFromPreset -> calculateCustomExpiryDate as `value as TimeUnit`, storing the resulting expiresAt and the label in state. handleCustomExpiryValueChange (482-512) and selectExpiryPreset (461-477) do the same; the initial unit (line 102) and the edit-mode unit (200-201) are also TIME_UNITS labels. The form renders no preview of the computed date.
4. [views/Settings/NostrWalletConnect/AddOrEditNWCConnection.tsx:600–603](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/NostrWalletConnect/AddOrEditNWCConnection.tsx#L600-L603)
   buildConnectionParams sends the miscomputed state.expiresAt as params.expiresAt and persists the localized label as params.customExpiryUnit.
5. [stores/NostrWalletConnectStore.ts:594–624](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L594-L624)
   createConnection stores params.expiresAt unchanged as connection.expiresAt (no recomputation or sanity check against value/unit); on regenerate (params.id && params.createdAt, driven from NWCConnectionDetails.tsx:212-217) it calls refreshExpiryForRegenerate with the persisted label, reproducing the error.
6. [stores/NostrWalletConnectStore.ts:1909–1916](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L1909-L1916)
   withGlobalHandler is the NIP-47 gate: every request from the client is rejected with RESTRICTED only once connection.isExpiredNow() (models/NWCConnection.ts:199-201, `new Date() > this.expiresAt`) is true. The miscomputed expiresAt is therefore the enforced bound on the client's delegated authority.
7. [utils/NostrConnectUtils.ts:584–592](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NostrConnectUtils.ts#L584-L592)
   refreshExpiryForRegenerate recomputes expiry from the persisted customExpiryValue/customExpiryUnit with the same substring matcher, so every 'Regenerate connection' re-applies the 24x extension.
8. [models/NWCConnection.ts:58](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/models/NWCConnection.ts#L58)
   TimeUnit is declared as the English literal union 'Hours'|'Days'|'Weeks'|'Months'|'Years', which is why the matcher was written against English words while the runtime values are translated strings.

## Impact
Delegated authority outlives its intended bound: a paired client can keep spending and reading balance/transactions for up to 24x the intended duration. buildConnectionParams requires a budget whenever pay permissions are granted (AddOrEditNWCConnection.tsx:580-587), so spend stays capped by the budget and integrity impact is limited; confidentiality impact is the continued get_balance/list_transactions/lookup_invoice access. No availability impact.

## Reproduction steps
1. The wallet owner (victim) selects a non-English app language in Settings and configures a short custom expiry in hours; the NWC client app, or anyone holding the connection secret, simply keeps sending NIP-47 requests over the relay after the intended expiry and is still served because expiresAt was computed 24x too far out. No action by the attacker triggers the defect; the preconditions (user-selected affected locale, custom expiry in hours) are attack requirements PRESENT. The attacker needs the connection secret, i.e. the position of an already-paired client (low privilege); requests travel over Nostr relays (network).

## Recommended fix
1. calculateCustomExpiryDate derives the time multiplier from substring matches on an English display label, while the value it receives is a translated label from TIME_UNITS; unmatched labels silently fall back to 'days'. Fix criteria: Expiry computation must be keyed on a locale-independent unit identifier (enum or key) that is what the dropdown stores and what is persisted in connection.customExpiryUnit; translation must happen only for display. Unknown units must be rejected, not defaulted. Verify by creating a connection with a 1-hour custom expiry under the es/de/fr locale and confirming expiresAt is ~1 hour out, and that regenerate preserves the same duration.
2. Existing connections already persist translated labels in customExpiryUnit, so edit/regenerate would keep miscomputing even after the matcher is fixed. Fix criteria: On load, map legacy translated labels back to canonical units (or fall back to the stored expiresAt duration rather than recomputing from the label) so that regenerate/edit of pre-existing connections does not extend their validity.

---
**Severity:** LOW
**Status:** Open
**Category:** Insufficient Session Expiration
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258215

---

# Android CDK bridge logs ZEUS Pay mint quote URL, full mint response and quote IDs to logcat in release builds

## Details
The Android CashuDevKitModule's raw-HTTP external-quote path writes payment material to logcat in release builds. checkExternalMintQuote logs `Fetching <mintUrl>/v1/mint/quote/bolt11/<quoteId>` (Log.d, line 943), the mint's complete HTTP error body (Log.e, 954) and the complete NUT-04 success body (Log.d, 962); addExternalMintQuote (1056, 1073) and mintExternal (1103) log the quote id and mint URL again. android/app/build.gradle enables R8 (minifyEnabled true, line 65/138) with proguard-android-optimize.txt plus proguard-rules.pro, neither of which carries an -assumenosideeffects rule for android.util.Log, and the module has no BuildConfig.DEBUG guard, so every statement executes on production devices.

Reachability: the path is production-reachable through ZEUS Pay. LightningAddressStore.subscribeUpdatesCashu receives `{quote_id, mint_url}` from the ZEUS Pay socket (line 679) and redeemCashu calls cashuStore.checkInvoicePaid → checkAndMintCDK (CashuStore.ts 778-1020); because the quote was created server-side, CDK answers 'Unknown quote' and the store falls through to CashuDevKit.checkExternalMintQuote / addExternalMintQuote / mintExternal (866-947). Every ZEUS Pay ecash receipt on Android therefore lands in logcat as: the mint URL, the quote id, the bolt11 (amount, payment hash, payee node, description), state, expiry and the user's NUT-20 locking pubkey — a stable identifier linking all of the user's receipts — plus whatever body the mint returns on error.

What is new versus what the project already concedes: the JS side already logs the bare quote_id in production (LightningAddressStore.ts:547, unguarded console.log; React Native 0.87.1 release builds forward console output to logcat under ReactNativeJS — assumption from RN's JSIExecutor nativeLoggingHook, not verifiable in this checkout), but it deliberately wraps the externalQuote object and the quote-path logging in `if (__DEV__)` (CashuStore.ts 858-950), and the iOS implementation of the same three methods logs nothing. The Kotlin module alone exposes the bolt11, pubkey, mint URL and raw response/error bodies. The recorded threat model lists logs within the device holder's surface and states 'secrets must never reach logs or exported diagnostics'.

Bearer-credential angle (contingent, not the primary impact): a NUT-04 quote id is a bearer minting credential unless the quote is NUT-20 locked. ZEUS Pay registers the user's cashu_pubkey with the server (LightningAddressStore.ts:156) and the client treats these quotes as locked, so the logged ZEUS Pay quote id does not let a log reader take the funds. The same code path also runs for any user-created quote that CDK no longer knows (the trigger is purely the 'Unknown quote' error text at CashuStore.ts:866) — but with CDK 0.18.1 the wallet is assumed to attach a NUT-20 pubkey to every bolt11 mint quote (dependency behaviour, not verifiable here), the invoice list and the CDK database are normally in step, and the app itself mints immediately after logging, so a log reader stealing an unlocked quote requires a mint without NUT-20 support plus a database/invoice desync plus a failed mintExternal. Impact is rated on the metadata disclosure.

Who can read it: adb shell on a device with USB debugging authorised, a bugreport, or diagnostics the user shares; third-party apps cannot read logcat on modern Android, which bounds the severity.

## Evidence
1. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:943–962](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L943-L962)
   checkExternalMintQuote logs the full quote URL (mint URL + quoteId) at Log.d (943), the mint's complete HTTP error body at Log.e (954) and the complete NUT-04 success body at Log.d (962). That body carries quote id, bolt11 `request`, state, expiry, amount and the NUT-20 locking `pubkey`. No BuildConfig.DEBUG guard.
2. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:1056–1073](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L1056-L1073)
   addExternalMintQuote logs the quote id at Log.d twice (1056, 1073) while persisting the quote together with the user's P2PK secret key (the key itself is not logged).
3. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:1103](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L1103)
   mintExternal logs quote id and mint URL at Log.d immediately before minting from the quote.
4. [android/app/build.gradle:137–139](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/build.gradle#L137-L139)
   Release build type: minifyEnabled enableProguardInReleaseBuilds (true at line 65) with proguard-android-optimize.txt and proguard-rules.pro. Neither file contains an -assumenosideeffects rule for android.util.Log, so R8 keeps every Log.d/Log.e call in the shipped APK.
5. [android/app/proguard-rules.pro](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/proguard-rules.pro) (whole file)
   Project ProGuard rules: only -keep/-dontwarn entries; no rule strips android.util.Log, so the statements above survive release builds and write to logcat on production devices.
6. [stores/LightningAddressStore.ts:677–681](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LightningAddressStore.ts#L677-L681)
   Production entry point: the ZEUS Pay socket 'paid' event supplies quote_id and mint_url, and redeemCashu (487-535) calls cashuStore.checkInvoicePaid(quote_id, mint_url, true, …), which reaches checkAndMintCDK. Line 547 already logs the bare quote_id in production, so the quote id alone is conceded; the bolt11, pubkey and response bodies are not.
7. [stores/CashuStore.ts:866–946](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L866-L946)
   The external-quote path is entered whenever CDK answers 'Unknown quote' for checkMintQuote — every server-created ZEUS Pay quote, and any user quote missing from the local CDK database. The JS side guards its own logging of externalQuote and the quote id with __DEV__ (858-950), showing the maintainers do not intend this data to be logged in production.
8. [ios/CashuDevKit/CashuDevKitModule.swift:874–929](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/CashuDevKit/CashuDevKitModule.swift#L874-L929)
   The iOS implementation of checkExternalMintQuote (and the sibling addExternalMintQuote/mintExternal) logs nothing; the Kotlin module diverges from its sibling.

## Impact
Confidentiality only: the log reader learns, per ZEUS Pay receipt, the mint URL, quote id, bolt11 (amount, payment hash, payee node, description), state/expiry and the user's cashu NUT-20 pubkey, a stable identifier linking the user's receipts; raw mint error bodies are also written. The quote id is not a bearer credential for ZEUS Pay quotes (locked to the registered cashu_pubkey) and the unlocked-quote theft scenario needs a non-NUT-20 mint, a database/invoice desync and a failed in-app mint, so the rated impact is payment-metadata disclosure. No integrity or availability impact.

## Reproduction steps
1. The attacker needs read access to the device's logcat — an adb shell on a device with USB debugging authorised, a bugreport, or diagnostics the user shares (third-party apps cannot read logcat on modern Android) — and the victim must have redeemed a ZEUS Pay ecash payment (or re-checked a quote missing from the CDK database) while the ring buffer still holds the entries. No user interaction beyond normal wallet use; the data is written unconditionally on every such redemption.

## Recommended fix
checkExternalMintQuote, addExternalMintQuote and mintExternal in the Android CashuDevKitModule write the quote URL (mint URL + quote id), the full mint response body, the full mint error body and quote ids to android.util.Log without any debug-build guard, and the release build strips no Log calls. Fix criteria: In release builds no quote id, mint quote URL, bolt11 request, locking pubkey, mint response body or mint error body is written to the Android log from CashuDevKitModule — by removing the statements, guarding them with BuildConfig.DEBUG, or stripping android.util.Log via an R8 -assumenosideeffects rule — matching the iOS module and the __DEV__-guarded JS side. Verified by building a release APK, redeeming a ZEUS Pay cashu payment and confirming logcat contains no quote id, bolt11 or response JSON from the module.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure through log
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258214

---

# LDK backend pays caller-supplied amount instead of invoice amount; stale custom amount overpays swapped invoice

## Details
backends/LdkNode.ts payLightningInvoice (1408-1416) treats a caller-supplied `data.amt` as authoritative: whenever it is truthy the payment is dispatched with `sendBolt11UsingAmount(amountMsat = Number(amt)*1000)` without decoding the invoice or checking whether it already carries an amount. The JS wrapper (ldknode/LdkNodeInjection.ts 463-485) and both native modules (LdkNodeModule.kt 1436-1438, LdkNodeModule.swift 1321-1323) forward the amount straight to ldk-node's `Bolt11Payment::sendUsingAmount`. Explicit dependency assumption: in ldk-node (prebuilt binary pinned at v0.7.0-zeus-rl-0.2.7 in fetch-libraries-versions.json; the uniffi bindings in the checkout carry no doc comments) `send_using_amount` on an amount-bearing invoice rejects only amounts below the invoice amount and pays any larger one, per upstream's documented contract ('This will fail if the amount given is less than the value required by the given invoice'). LND and CLN reject an explicit amount on an amount-bearing invoice, and the project relies on exactly that node-side rejection (NostrWalletConnectStore.ts:2649 'nodes reject an amount for an invoice that already has one'), so the LDK backend is the one place where a mismatched `amt` reaches the network as an overpayment instead of an error.

The PaymentRequest screen produces such a mismatch. It pins the reviewed invoice (reviewedPaymentRequest) and shows a 'payment request changed' warning when InvoicesStore.paymentRequest is swapped, but the 'review new pay req' button (views/PaymentRequest.tsx 1404-1411) only re-pins and bumps the swipe key; `customAmount`/`satAmount`, which the user types into the AmountInput rendered only for zero-amount invoices (724-739), are never reset. Once the swapped-in invoice carries its own amount, `isNoAmountInvoice` (602) is false, the screen renders the new invoice's amount and hides the custom-amount input, yet triggerPayment (447-450) still passes the stale `satAmount` as `amount`; TransactionsStore.sendPayment (657-659) copies it into `data.amt`; LdkNode.payLightningInvoice sends satAmount*1000 msat to the new invoice.

The swap is a sanctioned, deliberately supported path: utils/LinkingUtils.ts handleDeepLink (147-155) pops back to the already-mounted PaymentRequest instance via `navigation.popTo` when one exists in the stack (its comment: 'it is already showing the new invoice alongside the warning'), after handleAnything.ts 481-482 has replaced the store invoice with `invoicesStore.getPayReq`; the component instance and its state survive, so the typed amount is carried across. Deep links are processed immediately whenever the app is unlocked (SettingsStore.externalInputAuthRequired, and loginBackground defaults to false).

Attack: a user on an LDK Node wallet opens a zero-amount invoice A (tip/donation request) and types X sats. While the review screen is open, an attacker-controlled `lightning:` string B (an amount-bearing invoice for Y < X sats to the attacker's node) is delivered through any dispatcher input: a deep link from a web page or message, an NFC NDEF tag, or a share-in. The screen shows the changed-request warning and B's amount Y; the user taps 'review new pay req' and slides to pay Y. The node pays X >= Y to B and the attacker keeps the surplus X-Y, which no confirmation screen ever displayed for this invoice. This breaks the amount-binding invariant the threat model rates highest and SECURITY.md lists in scope ('overpayment, amount manipulation'). The exploit works around the shipped control for this exact surface (the reviewedPaymentRequest pin), which binds invoice identity but not the amount typed for the previous invoice.

## Evidence
1. [backends/LdkNode.ts:1408–1415](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LdkNode.ts#L1408-L1415)
   payLightningInvoice dispatches sendBolt11UsingAmount(amountMsat = Number(data.amt)*1000) whenever data.amt is truthy, without decoding the invoice or checking whether it already carries an amount; the else branch (sendBolt11, pays the invoice amount) is only taken when amt is absent.
2. [views/PaymentRequest.tsx:1404–1411](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/PaymentRequest.tsx#L1404-L1411)
   The 'review new pay req' button re-pins reviewedPaymentRequest to the swapped-in InvoicesStore.paymentRequest and bumps only swipeButtonKey; customAmount/satAmount typed for the previous zero-amount invoice are left in state.
3. [views/PaymentRequest.tsx:447–450](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/PaymentRequest.tsx#L447-L450)
   triggerPayment passes state.satAmount as `amount` whenever it is non-empty, regardless of whether the pinned invoice now carries its own amount.
4. [views/PaymentRequest.tsx:724–739](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/PaymentRequest.tsx#L724-L739)
   satAmount/customAmount are only entered via the AmountInput shown for no-amount invoices; after the swap the Amount display branch renders the new invoice's amount instead, and nothing clears the typed values.
5. [views/PaymentRequest.tsx:602](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/PaymentRequest.tsx#L602)
   isNoAmountInvoice is derived from the current store invoice (pay_req.getRequestAmount), so after the swap the screen shows the new invoice's fixed amount while the stale satAmount is what gets sent.
6. [utils/LinkingUtils.ts:147–155](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LinkingUtils.ts#L147-L155)
   handleDeepLink deliberately popTo()s the PaymentRequest already in the stack when a new lightning: string arrives ('it is already showing the new invoice alongside the warning'), so the same component instance, with its typed satAmount, survives the swap.
7. [utils/handleAnything.ts:481–482](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L481-L482)
   Any newly handled lightning: string (deep link, NFC, share-in) calls invoicesStore.getPayReq, replacing pay_req/paymentRequest under the mounted review screen, and returns the 'PaymentRequest' route.
8. [stores/TransactionsStore.ts:657–659](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L657-L659)
   sendPayment copies the UI-supplied `amount` into data.amt unconditionally; it does not know whether the invoice is zero-amount.
9. [ldknode/LdkNodeInjection.ts:463–484](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ldknode/LdkNodeInjection.ts#L463-L484)
   The wrapper forwards amountMsat to the native sendBolt11UsingAmount without reference to the invoice.
10. [android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt:1436–1437](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/app/zeusln/zeus/LdkNodeModule.kt#L1436-L1437)
   Android native side calls bolt11.sendUsingAmount(invoice, amount) directly; no comparison against the invoice's own amount.
11. [ios/LdkNodeMobile/LdkNodeModule.swift:1321–1323](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LdkNodeMobile/LdkNodeModule.swift#L1321-L1323)
   iOS native side likewise calls bolt11.sendUsingAmount(invoice:amountMsat:) with the caller's amount and no check against the invoice amount.
12. [stores/NostrWalletConnectStore.ts:2649–2650](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2649-L2650)
   The project's own NWC caller omits `amount` for amount-bearing invoices because 'nodes reject an amount for an invoice that already has one' — the node-side rejection the LDK backend path does not provide.

## Impact
The payment sent exceeds the amount approved on the confirmation screen; the surplus (custom amount typed for the previous invoice minus the displayed invoice amount) goes irreversibly to the attacker's node. The loss is bounded by the amount the user had typed, and the overpayment outcome rests on the ldk-node send_using_amount lower-bound-only contract, which is a documented upstream behaviour but could not be verified in the checkout (prebuilt binary, bindings without doc comments); the integrity rating is capped accordingly. No confidentiality or availability effect.

## Reproduction steps
1. Attacker publishes or sends a lightning: deep link (or writes an NFC tag / shares an image) carrying an amount-bearing invoice to their own node; Android MainActivity exports the scheme and LinkingUtils processes it immediately while the app is unlocked (loginBackground defaults false). The victim must be an LDK Node user who is mid-review of a zero-amount invoice with a custom amount typed when the second invoice arrives (attack requirements PRESENT), and must then tap 'review new pay req' and slide/tap to pay the displayed amount (active user interaction). No privileges or defence bypass needed; once those conditions hold the overpayment follows deterministically from the code.

## Recommended fix
1. LdkNode.payLightningInvoice trusts the caller-supplied amt over the invoice's own amount, and ldk-node's send_using_amount permits overpayment, so an amount mismatch is paid instead of rejected as on every other backend. Fix criteria: For an invoice that carries an amount, the LDK backend must pay exactly that amount (use sendBolt11, or require amt*1000 to equal the invoice msat and fail closed otherwise); amt may only select the amount for zero-amount invoices. Verify that calling payLightningInvoice with amt different from an amount-bearing invoice's amount is rejected before any native send call, on both platforms.
2. PaymentRequest keeps invoice-specific state (customAmount/satAmount and values derived from it) across a re-pin to a different invoice, so an amount typed for one invoice is submitted for another while the screen displays the new invoice's amount. Fix criteria: Re-pinning reviewedPaymentRequest (and any other path that changes the invoice under review, including the deep-link popTo) must reset customAmount/satAmount and re-derive dependent state, and triggerPayment must pass amount only when the pinned invoice is zero-amount. Verify by swapping a zero-amount invoice with a custom amount for an amount-bearing one and confirming the dispatched request carries no amt.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258213

---

# Embedded LND payment results matched by global event name; concurrent payments receive each other's result

## Details
The embedded-LND bridge delivers gRPC stream results to JavaScript as React Native events whose only name is the gRPC method (Android LndMobile.java:152-172, iOS LndMobile.swift:196-228), and the native layer only refuses a second stream for the same method when streamOnlyOnce is true (LndMobileService.java:150-178, Lnd.swift:277-295). lndmobile/index.ts builds request/response matching on top of that: sendPaymentV2Sync (341-383) and sendKeysendPaymentV2 (433-465) each add a listener on 'RouterSendPaymentV2', start a new stream with streamOnlyOnce=false, and resolve their promise with the first 'RouterSendPaymentV2' event they see. The decoded lnrpc.Payment is never compared against the request (payment_hash of the invoice / keysend hash), there is no per-stream identifier to compare against, and TransactionsStore.handlePayment (815-827) accepts the Payment without checking its hash against what it dispatched.

Consequence: whenever two RouterSendPaymentV2 streams are open at once, the first terminal Payment emitted (no_inflight_updates:true, so each stream emits exactly one) is delivered to every listener. Both callers resolve with the same Payment object (status, preimage, payment_hash, fee, failure_reason) that belongs to only one of them; the other payment's real result arrives later with no listener and is dropped (or, for sendPaymentV2Sync, is replaced by the forced-timeout result). In sendKeysendPaymentV2 the listener is also left registered after EOF/error and there is no forced timeout; if a keysend stream ends with EOF before a terminal Payment, the still-pending promise is resolved by the next unrelated payment's result.

Reachable in production: TransactionsStore deliberately lets service-initiated payments bypass the paymentInFlight guard (TransactionsStore.ts:614-622), the NWC wallet service is supported on embedded LND (EmbeddedLND.supportsNostrWalletConnectService) and dispatches pay_invoice through TransactionsStore.sendPayment with background:true (NostrWalletConnectStore.ts:2646-2661); enqueuePayment serialises only NWC-originated payments. An NWC client with pay_invoice permission can therefore keep a payment in flight (an invoice it controls with a slow or hodl settlement, up to the 120 s PAYMENT_TIMEOUT_SECONDS) while the user pays from the UI; on embedded LND both flows then receive whichever Payment finishes first. The user is shown a SUCCEEDED Payment with a preimage for an invoice they did not pay while their own payment may still fail (false success), or a FAILED/timeout result for a payment that in fact succeeded (false failure that invites a retry; for keysend the retry is a genuine double-send). The NWC side receives the user's preimage and payment_hash as the result of its own request.

This is a different root cause from the verified store-level record nwc-shared-transactions-store-payment-result-crosstalk (and its rejected duplicate nwc-service-payment-shares-user-payment-state): those concern MobX fields that both flows read and write, and their fix (a per-call result object) would not help on embedded LND, because the Payment object handed back by the backend call itself is the wrong one. The fix has to happen at the bridge/stream-correlation layer. It also subsumes the open lead lead-index-405-c6f7 (keysend listener not removed on EOF, no timeout). Other consumers of the same emitter (watchInvoicePaid filters by r_hash, watchOnchainReceived by address, closeChannel documents the ambiguity) are not affected in the same way; RouterSendPaymentV2 is the only payment-moving stream with no discriminator.

## Evidence
1. [lndmobile/index.ts:341–367](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/lndmobile/index.ts#L341-L367)
   sendPaymentV2Sync registers a listener on the app-wide 'RouterSendPaymentV2' event and, on the first event of any kind, removes itself and resolves with decodeSendPaymentV2Result(e.data). Nothing checks that the decoded lnrpc.Payment belongs to the request this call made (no stream id, no payment_hash comparison against options.payment_request / options.payment_hash).
2. [lndmobile/index.ts:370–382](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/lndmobile/index.ts#L370-L382)
   Each call starts a fresh RouterSendPaymentV2 stream with streamOnlyOnce=false, so two in-flight payments are two native streams whose results are both emitted under the same event name to every registered listener.
3. [android/app/src/main/java/com/zeus/LndMobileService.java:150–177](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/LndMobileService.java#L150-L177)
   The only concurrency check for stream commands is the streamOnlyOnce flag; with it false a second RouterSendPaymentV2 stream is started with its own LndStreamCallback(msg.replyTo, method), so two streams for the same method run at once and report to the same client under the same method string.
4. [android/app/src/main/java/com/zeus/LndMobile.java:152–171](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/LndMobile.java#L152-L171)
   MSG_GRPC_STREAM_RESULT forwards stream results to JS via RCTDeviceEventEmitter.emit(method, params): the event name is only the gRPC method name and params carry no request/stream identifier.
5. [ios/LndMobile/Lnd.swift:277–294](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LndMobile/Lnd.swift#L277-L294)
   Same on iOS: activeStreams is consulted only when streamOnlyOnce is true; otherwise every call creates a new LndmobileReceiveStream for the method, so concurrent RouterSendPaymentV2 streams are permitted.
6. [ios/LndMobile/LndMobile.swift:196–227](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/ios/LndMobile/LndMobile.swift#L196-L227)
   sendEvent(withName: method, body: [data]) for every result of every stream started under that method name; no stream identifier.
7. [lndmobile/index.ts:433–464](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/lndmobile/index.ts#L433-L464)
   sendKeysendPaymentV2 has the same first-event-wins pattern with no payment_hash check, and no forced timeout. Its listener is not removed on EOF or error: after an error the promise is already rejected (a later resolve is a no-op), but if the stream ends with EOF before any terminal Payment the still-pending promise is resolved by the next unrelated payment's result.
8. [backends/EmbeddedLND.ts:238–259](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/EmbeddedLND.ts#L238-L259)
   payLightningInvoice returns the sendPaymentV2Sync result directly; TransactionsStore.handlePayment then takes status, preimage, payment_hash and failure_reason from this object as the outcome of the payment that was dispatched.
9. [stores/TransactionsStore.ts:815–826](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L815-L826)
   handlePayment accepts whatever Payment the backend call resolved with: it never compares payment.resolvedPaymentHash against the invoice or keysend hash that sendPaymentInternal dispatched, so a foreign Payment is recorded and displayed as this payment's result.
10. [stores/TransactionsStore.ts:614–621](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L614-L621)
   Service-initiated (background) payments bypass the paymentInFlight guard, so a user payment and an NWC payment can be in flight simultaneously on the embedded node, which is the precondition for two concurrent RouterSendPaymentV2 streams.
11. [stores/NostrWalletConnectStore.ts:2646–2660](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2646-L2660)
   The NWC service dispatches pay_invoice through TransactionsStore.sendPayment with background:true; EmbeddedLND.supportsNostrWalletConnectService() is true, so on embedded LND this reaches sendPaymentV2Sync while a user payment may already have its own listener on the same event. enqueuePayment (1944-1960) serialises only NWC-originated payments, not UI payments.

## Impact
Integrity LOW: the app reports the wrong outcome for a payment it dispatched (false success with a foreign preimage, or false failure for a payment that settled, which invites a retry and for keysend a double-send); funds are not directly redirected. Confidentiality LOW: the user's payment preimage, payment hash and fee for one payment are handed to the concurrent NWC request and returned to the external client. Availability NONE.

## Reproduction steps
1. Attacker is an NWC client already granted pay_invoice on a ZEUS embedded-LND wallet running the NWC service (PR LOW). It submits pay_invoice over Nostr relays (AV NETWORK) for an invoice it controls and keeps unsettled for up to the 60-125 s payment timeout. When the user makes any Lightning payment from the UI in that window (routine action, UI PASSIVE), the first terminal Payment emitted resolves both sendPaymentV2Sync promises. No security mechanism has to be defeated (AC LOW); NWC service mode and the timing overlap are deployment/state conditions (AT PRESENT). The same cross-talk occurs without an attacker whenever a background and a user payment overlap.

## Recommended fix
1. sendPaymentV2Sync and sendKeysendPaymentV2 resolve with the first 'RouterSendPaymentV2' event regardless of which stream produced it, because the bridge identifies stream results only by gRPC method name and the JS side adds no discriminator. Fix criteria: A payment call must only resolve with a Payment whose payment_hash equals the hash of the invoice/keysend it dispatched (or with an event carrying a per-stream identifier assigned when the stream was started), and must ignore events for other streams. Verification: start two RouterSendPaymentV2 streams concurrently on embedded LND and confirm each caller receives exactly its own terminal Payment and never the other's.
2. Listeners are left registered after EOF/error (keysend path) and have no timeout, so stale listeners with pending promises capture later, unrelated payment results. Fix criteria: Every listener registered for a payment stream is removed on terminal result, EOF, error and timeout, and a keysend call has a bounded wait like sendPaymentV2Sync. Verification: after a stream ends with EOF or error, no listener for that call remains on the emitter and a subsequent payment's result does not resolve the earlier promise.

---
**Severity:** LOW
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258030

---

# Push-notification tap navigates to NWC activity without passing the app lock gate

## Details
ZEUS's app lock is a route, not a navigator gate: 'Lockscreen' is a plain Stack.Screen (App.tsx:608-615, gestureEnabled:false) that Wallet pushes onto the root native stack - at startup from getSettingsAndNavigate after SettingsStore.getSettings() has awaited several keychain reads (Wallet.tsx:428-494), and on every AppState 'active' transition while SettingsStore.loginRequired() (Wallet.tsx:377-380). Nothing intercepts navigation (no NavigationContainer onStateChange guard, no overlay in AppContainer/StealthModeWrapper, no blur/focus re-assertion in Lockscreen), so whatever is pushed after the Lockscreen is rendered above it without authentication. Every other external entry honours this: LinkingUtils.handleDeepLink parks the URL while settingsStore.externalInputAuthRequired() (LinkingUtils.ts:121-126), ShareIntentProcessing fails closed into the Lockscreen (ShareIntentProcessing.tsx:74), and in-app sensitive routes use protectedNavigation/reAuthNavigation (utils/NavigationUtils.ts).

PushNotificationManager.goToNwcActivityFromNotif() (PushNotificationManager.tsx:39-50) is the exception: on registerNotificationOpened (warm) and getInitialNotification (cold start) it parses the local notification payload (zeusNwcAction='connection_activity', zeusNwcConnectionId, zeusNwcFailedActivityId) and calls NavigationService.navigateWhenReady('NWCConnectionActivity', ...), which dispatches CommonActions.navigate on the root navigator as soon as it isReady() (NavigationService.ts:24-35). It never consults loginRequired()/externalInputAuthRequired() and never routes through the Lockscreen with a pendingNavigation.

The notifications that carry this payload are posted by the wallet's own NWC service when a client's pay_invoice fails (NostrConnectUtils.notifyOutgoingNwcPaymentFailed, NostrConnectUtils.ts:1644-1668, called from NostrWalletConnectStore.ts:3579). That service keeps running while the app is backgrounded or sitting locked in the foreground (keep-alive services; NostrWalletConnectStore.reset() skips teardown with the persistent Android service or active iOS connections), so such notifications accumulate in the shade of a locked device.

When the device holder taps one, two independent pushes race with no ordering enforced by this code: Wallet's Lockscreen push (triggered by AppState 'active' on resume) and the NWC push (triggered by react-native-notifications' notificationOpened event, which on Android is also delivered around the same onHostResume). Whichever lands last is on top. Where the NWC push lands last - or where the tap produces no AppState transition at all (app already in the foreground on the Lockscreen and react-native-notifications dispatching notificationOpened immediately for a visible app) - NWCConnectionActivity renders above the lock and the holder sees that connection's payment/invoice history (amounts, memos, status, counterparty connection name) and can open Payment/CashuPayment (which display the payment preimage, Payment.tsx:278-283) and Invoice/CashuInvoice detail screens via handleActivityPress (NWCConnectionActivity.tsx:386-398). Hardware back exits the app (App.tsx:351-354) because loginRequired() is still true, confirming the lock was meant to be in force.

At cold start the Lockscreen push normally lands last (it waits on multiple keychain round-trips while getInitialNotification is a single native call), so the exposure is the warm-resume and foreground-locked cases. The exact event order on each platform is a property of react-native-notifications 5.2.2 and react-native 0.87.1 lifecycle-listener dispatch (explicit assumption; not verifiable in this checkout), which is exactly what the project's other entry points refuse to rely on: they check the lock state explicitly. The root cause is that the notification entry point trusts the stack order instead of gating on the lock.

## Evidence
1. [PushNotificationManager.tsx:39–50](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/PushNotificationManager.tsx#L39-L50)
   goToNwcActivityFromNotif() parses the NWC notification payload and calls NavigationService.navigateWhenReady('NWCConnectionActivity', ...) unconditionally; it never consults settingsStore.loginRequired()/externalInputAuthRequired() and does not route through the Lockscreen with a pendingNavigation, unlike deep links and share intents.
2. [PushNotificationManager.tsx:88–126](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/PushNotificationManager.tsx#L88-L126)
   Both the warm path (registerNotificationOpened) and the cold-start path (getInitialNotification) hand the payload straight to the ungated navigation.
3. [NavigationService.ts:24–35](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/NavigationService.ts#L24-L35)
   navigateWhenReady() dispatches CommonActions.navigate on the root native stack as soon as it isReady() (retrying every 100 ms for up to 5 s); with @react-navigation/native 7.5.0 this pushes a new route on top of whatever is there, including a Lockscreen.
4. [views/Wallet/Wallet.tsx:377–380](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Wallet/Wallet.tsx#L377-L380)
   After a background lock the only thing that re-establishes the lock is this AppState 'active' handler pushing 'Lockscreen' (and getSettingsAndNavigate at startup, after awaited keychain reads). It is a navigation push, not an interceptor, so a push that lands after it sits above it.
5. [App.tsx:608–615](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/App.tsx#L608-L615)
   Lockscreen is registered as an ordinary Stack.Screen (gestureEnabled:false only); the NavigationContainer has no onStateChange guard and no overlay keyed on loginRequired(), so nothing prevents a route being pushed above the lock.
6. [utils/LinkingUtils.ts:121–126](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LinkingUtils.ts#L121-L126)
   The sanctioned pattern for external input: handleDeepLink parks the URL while settingsStore.externalInputAuthRequired() instead of navigating. The notification path omits this check.
7. [utils/NavigationUtils.ts:5–40](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NavigationUtils.ts#L5-L40)
   protectedNavigation/reAuthNavigation route through the Lockscreen with a pendingNavigation target; the notification path does not use them.
8. [utils/NostrConnectUtils.ts:1644–1668](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NostrConnectUtils.ts#L1644-L1668)
   notifyOutgoingNwcPaymentFailed posts the local notification carrying zeusNwcAction/zeusNwcConnectionId/zeusNwcFailedActivityId; it is emitted by the NWC service (NostrWalletConnectStore.ts:3579) which keeps running while the app is backgrounded or locked, so these notifications sit in the shade of a locked device.
9. [views/Settings/NostrWalletConnect/NWCConnectionActivity.tsx:386–397](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Settings/NostrWalletConnect/NWCConnectionActivity.tsx#L386-L397)
   The destination lists the connection's payments/invoices and handleActivityPress opens Payment/CashuPayment and Invoice/CashuInvoice detail screens, so reaching it unauthenticated discloses wallet activity.
10. [views/Payment.tsx:278–283](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Payment.tsx#L278-L283)
   The Payment detail screen reachable from the NWC activity list renders the payment preimage, one of the secrets the threat model lists as an asset.

## Impact
Discloses the NWC connection's payment/invoice activity (amounts, memos, status, connection name) and the Payment/Invoice detail screens behind it, including payment preimages, which the app lock is meant to protect. No funds can be moved from these screens and nothing is modified, so integrity and availability are unaffected; the disclosure is bounded to one connection's activity, not seeds or node credentials.

## Reproduction steps
1. Attacker is whoever holds a device whose ZEUS app is locked (PIN/passphrase/biometric configured; cold start or lock-on-background) with an NWC failed-payment notification in the shade - notifications the wallet's own NWC service posts while backgrounded or locked. Tapping it fires an ungated root-level navigate to NWCConnectionActivity. Whether that push lands above Wallet's Lockscreen push depends on event ordering this code does not control (react-native-notifications 5.2.2 notificationOpened vs react-native 0.87.1 AppState 'active' on resume; or no AppState transition at all when the app is already in the foreground on the Lockscreen) - a race/ordering condition the holder can retry, hence Attack Requirements PRESENT. No credentials, no cooperation from the victim; physical possession of the locked device.

## Recommended fix
1. goToNwcActivityFromNotif navigates to a protected screen from an OS-delivered notification event without checking whether the app lock is in force, relying on the Lockscreen having been pushed earlier and staying on top. Fix criteria: Notification-driven navigation is gated exactly like deep links and share intents: when settingsStore.externalInputAuthRequired() is true the target is held as a pendingNavigation and only reached after the Lockscreen succeeds (e.g. navigate('Lockscreen', { pendingNavigation }) or protectedNavigation), independent of the order in which the notification event and the AppState/startup Lockscreen push arrive. Verified by tapping an NWC notification on a locked app at cold start, after a background lock, and while the Lockscreen is already in the foreground: the Lockscreen is always the top route and NWCConnectionActivity appears only after successful authentication.
2. The lock is implemented as a pushed route rather than a navigator-level gate, so any root-level navigate that lands after it is rendered above it. Fix criteria: Either every root-level navigation source (NavigationService.navigate/navigateWhenReady) refuses or defers protected targets while loginRequired()/externalInputAuthRequired() is true, or the lock becomes a container-level guard (e.g. rendering the Lockscreen instead of the stack, or re-pushing it on any state change) so that no route can be shown above it while the session is locked.

---
**Severity:** LOW
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-288](https://cwe.mitre.org/data/definitions/288.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258029

---

# Malformed NFC NDEF text record crashes app in native getIntentNfcData

## Details
On Android, ZEUS exports MainActivity for android.nfc.action.NDEF_DISCOVERED with mimeType text/plain (AndroidManifest.xml:80-84). Android's NFC dispatcher maps any NDEF message whose first record is TNF_WELL_KNOWN/RTD_TEXT to text/plain without validating the record's payload (Android's NdefRecord parser accepts any payload, including an empty one, for TNF_WELL_KNOWN), so a tag carrying a malformed Text record is delivered to ZEUS as the activity intent (cold start, or onNewIntent -> setIntent in MainActivity.kt:68-71 when ZEUS is already running).

On startup (LinkingUtils.handleInitialUrl falls through to handleAndroidIntents because a text/plain NDEF intent has no data URI) and on every AppState 'active' transition (App.tsx:384-393), handleAndroidIntents() (LinkingUtils.ts:80-87) calls the legacy native module MobileTools.getIntentNfcData() (MobileTools.java:41-98), which hand-parses the first record. This happens before the lock-screen gate in handleDeepLink (LinkingUtils.ts:123), so it runs even while the app is locked.

The parser trusts the tag bytes completely:
- if Ndef.get(tag) is null it resolves the promise but does not return, then dereferences ndef (NullPointerException and a double resolve);
- for an RTD_TEXT record it reads payload[0] without checking payload.length > 0 (ArrayIndexOutOfBoundsException on an empty Text record);
- the language-code length is computed as payload[0] & 0063 - an octal literal equal to 51 (0x33), not the 0x3F mask the comment describes;
- new String(payload, languageCodeLength + 1, payload.length - languageCodeLength - 1, enc) is called with a negative length whenever the declared language-code length is >= the payload length (e.g. status byte 0x33 with a one-byte payload gives length -51), throwing StringIndexOutOfBoundsException.

Only UnsupportedEncodingException is caught. The RuntimeExceptions escape the @ReactMethod. The app runs React Native 0.87.1 with newArchEnabled=true (android/gradle.properties:38) and MainApplication.kt:17-38 builds the host with getDefaultReactHost() using the default exception handler; for a Promise-returning legacy module method the Java exception is rethrown on the native-modules queue and reaches ReactHostImpl.handleHostException, whose default delegate rethrows, so in a release build the process is terminated (assumption about react-native 0.87.1 behaviour; if a deployment installed a swallowing handler the React instance would instead be destroyed, which is still a loss of the running app). This kills the embedded LND/LDK node and NWC/keep-alive services that share the process. The crash happens each time such a tag is delivered (Android finishes the crashed activity, so a relaunch from the launcher is clean; a restart of the task from recents may re-deliver the stored launch intent).

The in-app reader path (utils/NFCUtils.ts decodeNdefTextPayload) already guards an empty payload and uses the 0x3F mask; the native intent path has no equivalent. An attacker who brings a programmed tag or an HCE emulator within NFC range of the victim's unlocked phone, or who plants a tag where a merchant 'tap to pay' tag is expected, crashes the wallet deterministically at the moment the user tries to use it.

## Evidence
1. [android/app/src/main/java/com/zeus/MobileTools.java:41–97](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/MobileTools.java#L41-L97)
   getIntentNfcData parses the first NDEF record of the current activity intent without bounds checks: Ndef.get(tag)==null resolves but falls through to ndef.getCachedNdefMessage() (NPE, double resolve); payload[0] is read on a possibly empty payload (ArrayIndexOutOfBoundsException); the mask is the octal literal 0063 (51) instead of 0x3F; new String(payload, len+1, payload.length-len-1, enc) gets a negative length when the declared language-code length >= payload length (StringIndexOutOfBoundsException). Only UnsupportedEncodingException is caught, so these RuntimeExceptions escape the @ReactMethod.
2. [utils/LinkingUtils.ts:80–87](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LinkingUtils.ts#L80-L87)
   handleAndroidIntents() awaits NativeModules.MobileTools.getIntentNfcData() unconditionally, before any lock-screen check (externalInputAuthRequired is only consulted in handleDeepLink at line 123). It is reached from handleInitialUrl (line 75-77) at startup when the intent has no data URI, as is the case for a text/plain NDEF intent.
3. [android/app/src/main/AndroidManifest.xml:80–84](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/AndroidManifest.xml#L80-L84)
   MainActivity (exported=true, singleTask) registers an NDEF_DISCOVERED filter for mimeType text/plain, so any NFC tag whose first record is a well-known Text record is delivered to ZEUS with the Tag (and its cached NDEF message) in the intent.
4. [App.tsx:384–392](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/App.tsx#L384-L392)
   handleAppStateChange runs LinkingUtils.handleAndroidIntents on every 'active' transition, so a tag tapped while ZEUS is already running (delivered via onNewIntent/setIntent and the resulting pause/resume) is parsed by the native method as well, not only at cold start.
5. [android/app/src/main/java/com/zeus/MainActivity.kt:68–71](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/MainActivity.kt#L68-L71)
   onNewIntent calls setIntent(intent), so an NDEF intent delivered to the running singleTask activity becomes getIntent() for the subsequent getIntentNfcData() call.
6. [android/app/src/main/java/com/zeus/MainApplication.kt:17–37](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/MainApplication.kt#L17-L37)
   The ReactHost is built with getDefaultReactHost() and no custom exceptionHandler; MobileToolsPackage is a legacy ReactPackage loaded through the new-architecture interop (gradle.properties newArchEnabled=true). With react-native 0.87.1 the default host exception handler rethrows, so an exception escaping a Promise-returning legacy module method terminates the process in release builds.
7. [android/app/src/main/java/com/zeus/LndMobileTools.java:353–412](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/LndMobileTools.java#L353-L412)
   An identical copy of the NDEF parser (same null fallthrough, 0063 mask and unchecked String construction) lives in the LndMobileTools module. The JS entry point currently calls MobileTools, so this copy is not on the attack path today, but it must be fixed or removed alongside the primary location.

## Impact
Deterministic termination of the wallet process on each delivery of a malformed tag, taking down the embedded LND/LDK node and NWC/keep-alive services in the same process; the app recovers on relaunch (Android finishes the crashed activity). No data disclosure or modification. The project's own severity guide rates crashes that recover on restart as Low.

## Reproduction steps
1. The attacker writes an NDEF message whose first record is a well-known Text record with an empty payload, or a status byte declaring a language-code length >= the payload length, onto a cheap NFC tag or an HCE emulator, and gets it within NFC range (a few centimetres) of the victim's unlocked Android phone - held near a phone in use, or planted over a legitimate payment tag. Android dispatches the tag to ZEUS (MainActivity is exported for text/plain NDEF; if several apps register text/plain the user may see a chooser), handleAndroidIntents runs the native parser before the lock gate, the parser throws and the process dies. No privileges, no attack requirements and no victim action beyond the device being within range; UI is rated NONE for the emulator-held-to-phone case (a planted tag needs a passive tap).

## Recommended fix
1. Native NDEF Text-record parsing in getIntentNfcData trusts tag-supplied lengths and nullable Android NFC objects, and lets RuntimeExceptions escape the React Native bridge method, where the default host exception handler terminates the process. Fix criteria: getIntentNfcData (in MobileTools and the duplicate in LndMobileTools) must never throw into the bridge: every nullable result (getCurrentActivity, Ndef.get, getCachedNdefMessage, records) is checked with an early return; the Text payload is validated before indexing (non-empty, language-code length masked with 0x3F and strictly less than the payload length); and any remaining Throwable is caught and converted into promise.resolve(null) or promise.reject. Verify with tags carrying an empty Text record and a Text record whose status byte declares a language-code length longer than the payload: ZEUS stays running and ignores the tag.
2. The NFC intent parse runs on every resume with no dedupe and before the lock-screen gate, so untrusted tag bytes are processed natively even while the app is locked. Fix criteria: Parse the NDEF intent once per delivery (clear or remember the handled intent) and prefer decoding the Text record in JS with the existing guarded decodeNdefTextPayload so the native side only hands over raw bytes.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-129](https://cwe.mitre.org/data/definitions/129.html)
**Attack vector:** PHYSICAL
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258024

---

# Donation payment retries without bound on failure, re-fetching and paying a fresh invoice each loop

## Details
When donations are enabled (Android, mainnet, opt-in setting documented in README.md:139) and a percentage is set, PaymentRequest.tsx:369-375 navigates to SendingLightning with enableDonations/donationAmount, and the screen pays a donation silently after the user's payment succeeds. handleDonationPayment (views/SendingLightning.tsx:187-285) has no terminal state for failure: when loadDonationLnurl returns null, when the backend result carries status FAILED or a non-empty payment_error, or when anything throws, it only sets payingDonation=false (lines 195-199, 211-215, 280-283) and never sets donationHandled or TransactionsStore.donationIsPaid. That setState re-renders the component (mobx-react 6.1.4's observer shouldComponentUpdate returns true whenever this.state !== nextState) and componentDidUpdate's guard at lines 174-182 (`isMainNet && wasSuccessful && enableDonations && donationAmount && !donationIsPaid && !payingDonation && !donationHandled`) is satisfied again, so the handler is re-entered immediately and indefinitely until the screen unmounts. The sibling Cashu screen (views/Cashu/CashuSendingLightning.tsx:154-163) fires only on the success transition (`wasSuccessful && !this.state.wasSuccessful`), showing a single attempt is the intended behaviour; this screen lacks that guard.

Two consequences follow:
1. Resource exhaustion: if the donation LNURL endpoint is unreachable, returns an unexpected body, or the node has no route, the loop spins as fast as failures return, each iteration issuing two HTTPS requests to the donation server (utils/DonationUtils.ts:57,73) plus a pay attempt against the user's node, for as long as the success screen is open. The user sees only the DonationGiftIcon LoadingIndicator (components/DonationGiftIcon.tsx:33-34) while payingDonation is true, so nothing prompts them to leave.
2. Repeated donations: each iteration fetches a fresh invoice (new payment hash). Every backend returns or throws the payment-timed-out shape after timeout+1 s while the HTLC may still be in flight (backends/LND.ts:569-576 and lndmobile/index.ts:385-392 resolve `{ payment_error: paymentTimedOut }`; backends/CLNRest.ts:519-526 likewise; backends/LdkNode.ts:2037 throws). The handler treats that as failure and pays a new invoice. A donation server that returns hold invoices and settles each HTLC just after the wallet gives up therefore receives one donation of the approved amount per ~61 s for as long as the user stays on the screen, with no confirmation and no cap; the amount/description_hash verification in loadDonationLnurl (lines 88-96) does not protect against this because every invoice is for the correct amount.

The attacker position is the donation server (ZEUS Pay infrastructure, or whoever compromises it or its DNS with a valid certificate; the fetch uses default TLS verification, not trusty), which the project's own code already treats as potentially compromised (DonationUtils.ts:60-61, 84-87); the resource-exhaustion variant also triggers on an ordinary network or routing failure. The gain beyond the single donation the user consented to is N-1 additional donations and an unbounded request loop against the user's device and node.

## Evidence
1. [views/SendingLightning.tsx:174–184](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingLightning.tsx#L174-L184)
   componentDidUpdate re-invokes handleDonationPayment whenever the main payment succeeded and donationIsPaid, payingDonation and donationHandled are all false. It runs after every state update of the screen, including the handler's own failure setState, with no once-only transition guard (contrast views/Cashu/CashuSendingLightning.tsx:154-163).
2. [views/SendingLightning.tsx:193–216](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingLightning.tsx#L193-L216)
   On a null payment request (LNURL fetch failed or verification failed) or a FAILED/payment_error result, the handler only sets payingDonation=false and returns; it never sets donationHandled or TransactionsStore.donationIsPaid. That setState re-renders and re-triggers componentDidUpdate, whose condition is again true, so a fresh invoice is fetched and paid again immediately.
3. [views/SendingLightning.tsx:278–284](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingLightning.tsx#L278-L284)
   The catch path behaves the same way (payingDonation=false only), so a thrown error from the LNURL fetch or the pay call (e.g. LdkNode's thrown paymentTimedOut) also loops.
4. [backends/LND.ts:569–576](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L569-L576)
   payLightningInvoice races the router/send call against a forced timeout of timeout_seconds+1 and resolves `{ payment_error: paymentTimedOut }` while the node's payment (and its HTLC) is still in flight. lndmobile/index.ts:385-392 and backends/CLNRest.ts:519-526 do the same; backends/LdkNode.ts:2037 throws. This is the shape the donation handler treats as failure before re-paying a new invoice.
5. [utils/DonationUtils.ts:40–102](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/DonationUtils.ts#L40-L102)
   Each iteration performs two HTTP requests to the donation LNURL server and obtains a NEW invoice. Callback origin, amount and description_hash are verified (the project explicitly treats a compromised server as the adversary at lines 60-61 and 84-87), but nothing bounds the number of invoices paid, and nothing prevents the server from returning a hold (slow-settling) invoice.
6. [stores/TransactionsStore.ts:766–812](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L766-L812)
   sendPaymentSilently returns the backend's raw result, including the timed-out `{ payment_error }` shape, and rethrows errors; it records no state for the donation payment, so the only terminal-state bookkeeping is the caller's, which is missing on failure.

## Impact
Integrity: the user approved one donation of a given size but can pay it once per ~61 s with no confirmation, bounded only by how long they linger on the screen (low, since amounts are a small percentage and the window is user-limited). Availability: an unbounded loop of HTTPS requests and pay attempts against the user's own node for as long as the screen is open, degrading the device and node but recoverable by leaving the screen.

## Reproduction steps
1. After any successful user payment with the opt-in Android donation setting on and a percentage > 0, the wallet contacts tips@pay.zeusln.app over verified TLS and pays silently. A server (or a plain route/network failure) that makes the donation fail causes the screen to loop without bound; for repeated donations the server returns hold invoices and settles each HTLC after the wallet's ~61 s give-up. The attacker needs no privileges on the device; the user only performs a routine payment and stays on the success screen (passive interaction), which the loading indicator does nothing to discourage. Attack requirements: donations enabled on Android mainnet, and for the repeat-donation variant control of the recipient node's settlement timing.

## Recommended fix
1. handleDonationPayment's failure, null-invoice and exception paths do not record a terminal state (donationHandled / donationIsPaid), so componentDidUpdate's trigger condition remains true and the donation is re-attempted indefinitely with a new invoice each time. Fix criteria: A donation is attempted at most once per user payment (fire only on the success transition, as CashuSendingLightning does, or set a terminal handled flag on every exit path). Verify: with the donation server unreachable, returning a malformed body, or the node reporting no route, the screen makes exactly one attempt and stops.
2. A timed-out donation payment (payment_error: paymentTimedOut, or LdkNode's thrown paymentTimedOut) is treated as a definite failure even though the HTLC may still settle, so a new invoice is paid while the previous one can still complete. Fix criteria: A timed-out or unknown-outcome donation payment is treated as possibly settled and never followed by payment of a different invoice for the same donation. Verify: with a hold invoice settled after the wallet's timeout, only one donation is ever sent.

---
**Severity:** LOW
**Status:** Open
**Category:** Infinite loop
**CWE:** [CWE-835](https://cwe.mitre.org/data/definitions/835.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258023

---

# Scanned npub or lightning address triggers unbounded download of attacker URLs to storage

## Details
handleAnything (utils/handleAnything.ts) is the dispatcher for every external byte source: camera QR and shared images (views/HandleAnythingQRScanner.tsx:238, views/ShareIntentProcessing.tsx:171), lightning:/lnurl deep links and NFC (utils/LinkingUtils.ts:133), and clipboard values the user taps (components/WalletHeader.tsx:205). Two branches resolve a Nostr profile before any screen or confirmation:

1. A valid npub (line 1050) -> NostrUtils.npubToHex -> nostrProfileLookup(pubkey).
2. A lightning address (line 636) whose LNURLP GET (line 755) returns non-200 or throws -> .catch (791) -> attemptNip05Lookup(value) -> NostrUtils.queryNip05Profile -> nostr-tools nip05.queryProfile fetches https://<address domain>/.well-known/nostr.json?name=<user> from the address's own domain -> nostrProfileLookup(pubkey returned by that server).

nostrProfileLookup queries DEFAULT_NOSTR_RELAYS for the pubkey's kind-0 event and hands the parsed content to ContactUtils.transformContactData(). For content.banner and content.picture that function calls RNFS.downloadFile({ fromUrl, toFile: DocumentDirectoryPath + '/nostrContactBanner_' + name + '.png' / 'nostrContactPhoto_' + uuid + '.png' }) and awaits completion. There is no size cap, no total-duration timeout, no scheme or private-host policy on fromUrl, no content-type check and no user prompt; the dispatcher only returns once both transfers end. No code path in the repository ever deletes these files (the only RNFS.unlink calls are for swap, migration and node-config temp files), so the bytes persist whether or not the user saves the contact, and every scan of a profile with a picture adds a fresh uuid-named file.

Consequences for a victim who merely scans an npub QR or taps a lightning:user@attacker.example link that looks like an ordinary payment destination: (a) the device opens a direct connection to any URL the attacker placed in the profile, including http:// and LAN/loopback hosts (a blind GET; the response is only stored, never returned to the attacker), from a scanned value that names no attacker host, outside the per-node Tor setting; (b) an attacker-sized write into the app sandbox: a server that streams an arbitrarily large body fills the device's shared data partition, which on Android also holds the embedded LND/LDK/Cashu databases, and leaves the wallet degraded until the user finds and clears the file (the app offers no UI for that); (c) because the banner file name is derived from the profile's display_name, a profile named like an existing saved contact overwrites that contact's stored banner (models/Contact.ts getBanner resolves rnfs://nostrContactBanner_<name>.png from DocumentDirectoryPath).

Dependency assumption (react-native-fs 2.20.0, not readable in this checkout): downloadFile applies only idle timeouts by default (connectionTimeout 5 s, readTimeout 15 s between reads) and no byte limit on either platform, so a server that keeps sending bytes is never cut off, while a server that sends nothing is cut off after ~15 s. The 'nostrContactBanner_' prefix prevents directory traversal through name (the first path component can never be an existing directory); the defect is the unbounded, unconfirmed download itself. The BTCPay branch in the same file (824-857) shows the project's own standard for QR-supplied URLs: classify, then require explicit consent before any request.

## Evidence
1. [utils/ContactUtils.ts:35–74](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ContactUtils.ts#L35-L74)
   transformContactData() takes the kind-0 profile JSON published by the remote pubkey and calls RNFS.downloadFile({ fromUrl: contact.banner }) and ({ fromUrl: contact.picture }) into RNFS.DocumentDirectoryPath, awaiting completion. No size cap, total timeout, scheme allowlist, content-type check or user prompt; the banner file name is 'nostrContactBanner_' + profile name + '.png', so it also overwrites the stored banner of any saved contact with the same name. No code in the tree ever unlinks nostrContactBanner_*/nostrContactPhoto_* files.
2. [utils/handleAnything.ts:202–244](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L202-L244)
   nostrProfileLookup() queries DEFAULT_NOSTR_RELAYS for the pubkey's newest kind-0 event and passes its parsed content to ContactUtils.transformContactData() before returning the ContactDetails route, so the downloads run during dispatch, before any screen is shown.
3. [utils/handleAnything.ts:1050–1065](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L1050-L1065)
   Entry 1: any non-clipboard-probe input that is a valid npub (QR scan, shared image, pasted value the user acts on) goes straight to nostrProfileLookup() with no confirmation.
4. [utils/handleAnything.ts:791–818](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L791-L818)
   Entry 2: for a lightning address (lightning:user@attacker.example deep link or QR), when the LNURLP fetch at 755 returns non-200 or throws, the .catch falls back to attemptNip05Lookup(value), letting the attacker's own domain name the pubkey whose profile is then resolved.
5. [utils/handleAnything.ts:192–200](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L192-L200)
   attemptNip05Lookup() chains the NIP-05 lookup on the address's domain into nostrProfileLookup(lookup.pubkey).
6. [utils/NostrUtils.ts:164–170](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NostrUtils.ts#L164-L170)
   queryNip05Profile() calls nostr-tools nip05.queryProfile(), which fetches https://<address domain>/.well-known/nostr.json?name=<user> from the attacker-chosen domain and returns the pubkey it names.
7. [views/HandleAnythingQRScanner.tsx:231–250](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/HandleAnythingQRScanner.tsx#L231-L250)
   The QR scanner hands the scanned string to handleAnything() immediately and shows only a generic 'Loading' header while awaiting it; there is no intermediate confirmation and the screen stays in this state until the downloads complete.
8. [utils/handleAnything.ts:824–856](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L824-L856)
   Contrast: the BTCPay branch classifies the QR-supplied URL and requires confirmBtcPayFetch() consent before any network request, with a comment stating this prevents a scan-time beacon to an attacker URL; the Nostr branches perform a strictly more consequential fetch-and-persist with no gate.

## Impact
Availability LOW: an attacker-sized file is written to persistent app storage with no cap and never cleaned up, able to exhaust the data partition shared with the embedded node databases and stalling the dispatcher for as long as the server streams. Integrity LOW: attacker-chosen bytes are persisted into the app sandbox and a same-name banner overwrites a saved contact's stored banner file. Confidentiality LOW: the fetch discloses the victim's IP and scan timing to an attacker host that is not named in the scanned npub, outside the node's Tor setting; the GET is blind so no LAN data is returned.

## Reproduction steps
1. Attacker publishes a kind-0 event for a pubkey they control with banner/picture pointing at their server (or any http(s) URL), then either prints that npub as a QR or serves a lightning address on their domain whose /.well-known/lnurlp returns 404 and whose /.well-known/nostr.json returns the pubkey. The victim scans the QR or taps the lightning: link expecting a payment screen (user interaction, no other precondition; app lock only defers a deep link until unlock). handleAnything resolves the profile and RNFS downloads the attacker's URL to disk with no prompt while the server streams an arbitrarily large body.

## Recommended fix
1. transformContactData downloads attacker-supplied profile media URLs to persistent storage with no size, time, scheme or content-type bounds and no user consent, and handleAnything invokes it during dispatch before any screen is shown. Fix criteria: Resolving an npub or falling back to NIP-05 from a lightning address must not fetch profile media automatically: defer media download until the user explicitly chooses to save/import the contact (or confirm the fetch as the BTCPay branch does), and when performed enforce an https-only scheme, a hard maximum byte count and total duration, and image content validation before persisting. Verify by scanning an npub whose kind-0 banner points at a non-terminating or multi-gigabyte URL: no request to that URL and no file write may occur before the user acts, and when it does occur the transfer must abort at the size cap.
2. Downloaded media files are named from the untrusted profile name and are never removed when the contact is not saved, so they overwrite other contacts' banners and accumulate indefinitely. Fix criteria: Name stored contact media by a per-contact unique identifier rather than the profile's display name, and delete media files when the contact they belong to is discarded or deleted. Verify that scanning a profile named like an existing saved contact leaves that contact's banner file unchanged and that discarding the ContactDetails screen leaves no new file in DocumentDirectoryPath.

---
**Severity:** LOW
**Status:** Open
**Category:** Uncontrolled resource consumption
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258022

---

# NWC pay_invoice reads shared TransactionsStore result; concurrent user payment leaks preimage and fakes success

## Details
The NWC wallet service executes pay_invoice through the app-wide TransactionsStore singleton and determines the outcome by (1) waiting until transactionsStore.loading flips to false and (2) reading transactionsStore.payment_preimage / payment_hash / payment_fee / status (NostrWalletConnectStore.ts:2646-2661, 2694-2712, 3388-3420). These fields are shared with every user-initiated payment from the PaymentRequest/Send screens. Background NWC payments deliberately bypass the paymentInFlight guard (TransactionsStore.ts:614-634), and the UI pay buttons are gated only on paymentInFlight, so the user can start a payment while an NWC payment is pending; TransactionsStore.handlePayment (815-827) writes whichever payment finishes into the same fields. No code binds the preimage returned to the client to the request invoice's payment hash.

Attack path (preimage harvesting): an external NWC client with pay_invoice permission submits an invoice it controls and holds unsettled (hodl invoice). The LND backend call resolves only on final state or its forced timeout (LND.ts:559-579; lndmobile sendPaymentV2Sync uses no_inflight_updates), so handleLightningPayInvoice blocks in waitForPaymentCompletion for ~121 s. If the user pays any invoice from the ZEUS UI in that window, the user's payment completes first, handlePayment sets loading=false with the user's preimage and payment_hash, the NWC wait resolves, matchesPaymentRequest finds the user's Payment via the shared payment_hash, settledEvidence (= !!preimage) is satisfied, finalizePayment records the user's Payment under the attacker's invoice id and debits the budget, and the NIP-47 response returns the user's payment preimage and fee to the attacker (2752-2780). The attacker then cancels its HTLC (the pending budget hold is reconciled) and repeats, keeping an NWC payment almost continuously in flight at no cost. Preimages are proof-of-payment and, for L402/LSAT-style services, bearer credentials; payment_hash and fee reveal the user's payment activity. list_transactions/lookup_invoice do not expose outgoing-payment preimages, so no sanctioned NWC path concedes this to the client.

Reverse interleaving: if the NWC payment reaches a final state while a user payment is in flight (or the user's payment has just completed and the screen is still mounted), SendingLightning (346-386) renders the NWC payment's success/preimage or — when the client cancels its held HTLC — a failure, as the result of the user's payment: a false success/failure report of the kind the threat model calls out. The retry is blocked by paymentInFlight while the user's own payment is unresolved, which limits this to misreporting.

The maintainers' enqueuePayment comment (1944-1960) recognises the hazard but serialises only NWC-internal payments; user-initiated flows share the same singleton with no ownership or correlation of results to the request that produced them.

## Evidence
1. [stores/NostrWalletConnectStore.ts:2646–2660](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2646-L2660)
   handleLightningPayInvoice resets the app-wide TransactionsStore singleton, dispatches sendPayment with background:true (so paymentInFlight is never set), then blocks in waitForPaymentCompletion and reads transactionsStore.payment_hash — fields every concurrent user payment also writes. No per-request result object correlates the outcome to this dispatch.
2. [stores/NostrWalletConnectStore.ts:2694–2711](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2694-L2711)
   preimage = transactionsStore.payment_preimage; the Payment is located via matchesPaymentRequest on the shared payment_hash; settledEvidence = !!preimage. Nothing checks that SHA-256(preimage) equals the request invoice's payment hash, so a user payment that finished first is accepted as this request's settlement.
3. [stores/NostrWalletConnectStore.ts:2752–2779](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2752-L2779)
   finalizePayment records the foreign Payment under the NWC invoice's id and debits the budget; the NIP-47 response returns `preimage || payment?.getPreimage` — the user's preimage and fee — to the external client.
4. [stores/NostrWalletConnectStore.ts:3388–3419](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L3388-L3419)
   waitForPaymentCompletion resolves on a MobX reaction when transactionsStore.loading flips to false, with no notion of which payment finished; a user payment completing first ends the NWC wait.
5. [stores/TransactionsStore.ts:614–633](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L614-L633)
   Background (NWC) payments bypass the paymentInFlight guard and never own it, so PaymentRequest/Send (gated only on paymentInFlight) let the user dispatch a payment while an NWC payment is pending; every dispatch rewrites the same loading/payment_preimage/payment_hash/status fields.
6. [stores/TransactionsStore.ts:815–826](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L815-L826)
   handlePayment writes loading=false, payment_preimage, payment_hash, payment_fee and status into the singleton for whichever payment's backend call resolves; seq only scopes clearPaymentInFlight, not the result fields.
7. [backends/LND.ts:559–578](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L559-L578)
   The LND REST /v2/router/send call resolves only when the stream ends (final payment state, parsed from the last line) or the forced timeout at timeout_seconds+1 fires; with a held (hodl) invoice the NWC payment stays in flight and the NWC handler stays blocked for ~121 s, which is the crosstalk window. Embedded LND (lndmobile sendPaymentV2Sync, no_inflight_updates:true) behaves the same.
8. [stores/NostrWalletConnectStore.ts:1944–1959](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L1944-L1959)
   enqueuePayment serialises only NWC-originated payments; its comment acknowledges that concurrent flows over the shared stores 'report the other payment's result/preimage', but user-initiated UI payments are outside this queue.
9. [views/SendingLightning.tsx:346–385](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingLightning.tsx#L346-L385)
   The user's payment screen destructures loading/error/payment_hash/payment_preimage/payment_fee from the same singleton and computes success from status, so in the reverse interleaving the user is shown the NWC payment's result (success or — when the client cancels its held HTLC — failure) as if it were their own.

## Impact
Confidentiality LOW: the preimage, payment hash and fee of individual user payments (proof-of-payment / L402 bearer credentials, payment linkage) leak to the client, one payment per cycle; no sanctioned NWC method exposes outgoing preimages. Integrity LOW: the client receives a success and a preimage that do not belong to its invoice, the connection activity log and budget record the wrong payment, and in the reverse interleaving the user is shown a success or failure that belongs to the NWC payment; no fund redirection is demonstrated and the paymentInFlight guard blocks an immediate retry. Availability NONE.

## Reproduction steps
1. Attacker is an external NWC client already granted pay_invoice on a connection (PR LOW), reached over Nostr relays (AV NETWORK). It sends pay_invoice for a hodl invoice it controls, keeping the handler blocked ~121 s per request and repeating at no net cost; whenever the user makes any routine payment from the UI in that window (UI PASSIVE), the user's preimage/hash/fee are returned to the attacker and a false settlement is recorded. The interleaving must occur (AT PRESENT: a race to be won), but there is no defensive mechanism to evade (AC LOW).

## Recommended fix
1. The NWC pay_invoice handler infers its payment's outcome from global TransactionsStore fields (loading, payment_preimage, payment_hash, payment_fee, status) that any concurrent payment overwrites, instead of from a result correlated to the request it dispatched. Fix criteria: The NWC handler obtains the outcome of exactly the payment it initiated (e.g. a per-call promise/result object returned by the dispatch, or a lookup keyed by the request invoice's payment hash) and never reports a preimage whose SHA-256 does not equal that payment hash. Verification: with an NWC payment pending and a user payment completing first, the NWC response is pending/failed for its own invoice and never contains the user's preimage, hash or fee.
2. Service-initiated and user-initiated payment flows share one mutable TransactionsStore singleton with no ownership, so one flow's result is rendered or recorded by the other. Fix criteria: Either serialise all payment flows (UI and NWC) through one owner-aware queue, or give background payments isolated state so they neither read nor write the fields SendingLightning observes. Verification: an NWC payment reaching a final state while a user payment is in flight does not change what the user's payment screen shows.

---
**Severity:** LOW
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258021

---

# NWC pay_invoice discloses preimage of payments the connection did not make

## Details
handleLightningPayInvoice (stores/NostrWalletConnectStore.ts) decides whether a pay_invoice request settled by looking the client-supplied invoice up in the node's complete payment list, not in the connection's own activity. The only connection-scoped step is the dedupe at 2591-2608 (connection.findPayInvoiceActivity); a payment the user made from the wallet UI, or that another NWC connection made, has no activity on this connection and falls through. The handler then calls transactionsStore.sendPayment; the node rejects the re-pay of an already-settled hash (LND ErrAlreadyPaid 'invoice is already paid', CLN equivalent), TransactionsStore records error/payment_error with payment_preimage null, and the handler resolves the invoice against paymentsStore.getPayments() (LND: last 500 payments, CLNRest: last 150) via resolveLightningPaymentInTransit/findPaymentForInvoice, which match by exact payment_request or payment hash (utils/NostrConnectUtils.ts:1176-1185). A settled match becomes settledEvidence (2694-2712; the comment states the debit is deliberate even when 'Zeus did not initiate the pay via this NWC connection'). finalizePayment then records that foreign payment under this connection's activity and the response returns `preimage: preimage || payment?.getPreimage` and its fee (2775-2781).

The maintainers' test ('debits what was paid when the invoice was already settled by the wallet') asserts only the budget debit; nothing asserts or prevents the preimage echo. The result is that a client with pay_invoice permission can use the wallet as a payment-history oracle: submit any BOLT11 it knows (a public donation/merchant invoice, one observed as payee or routing node, one issued to a different NWC connection) whose amount fits its budget and the wallet's balance; if the node paid it, the client learns that fact plus the preimage and fee. lookup_invoice and list_transactions are deliberately scoped to connection.activity, so node-wide payment history and preimages are not something the project concedes to a client. The preimage is proof that this wallet paid the invoice and, for receipt/preimage-redeemed services, the bearer secret for what the user bought. The connection's budget is debited for a transfer that never occurred, which the project accepts.

## Evidence
1. [stores/NostrWalletConnectStore.ts:2694–2711](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2694-L2711)
   After the node rejects the re-pay of an already-settled hash (TransactionsStore sets error/payment_error, preimage null), the handler resolves the client-supplied invoice against the node's full payment list (resolveLightningPaymentInTransit / findPaymentForInvoice) and treats any settled match as settlement evidence; the comment confirms this is deliberate for budget accounting even when this NWC connection did not initiate the payment. No check ties the matched record to this connection.
2. [stores/NostrWalletConnectStore.ts:2752–2780](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2752-L2780)
   finalizePayment records the foreign payment under this connection's activity and the response returns payment.getPreimage and its fee to the external client — the preimage of a payment made from the wallet UI or by another NWC connection.
3. [stores/NostrWalletConnectStore.ts:2591–2607](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2591-L2607)
   The only ownership-aware step: dedupe looks up connection.findPayInvoiceActivity, i.e. this connection's own activity. A payment made elsewhere has no activity here, so the request falls through to the node and the whole-list lookup.
4. [utils/NostrConnectUtils.ts:1176–1185](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NostrConnectUtils.ts#L1176-L1185)
   matchesPaymentRequest matches a listed payment by exact payment_request string or by payment hash, so the client can target any payment whose BOLT11 or hash it knows.
5. [backends/LND.ts:389–401](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L389-L401)
   paymentsStore.getPayments() with no params lists the node's last 500 payments (CLNRest: last 150 sendpays) — node-wide history, not connection activity — and each record carries payment_preimage.

## Impact
Confidentiality LOW: per query the client learns whether the user's node paid a specific invoice and obtains that payment's preimage and fee, one invoice at a time and only for invoices it can name within its budget; preimages are a listed asset and proof-of-payment/bearer secrets for some services. Integrity NONE: funds do not move and the budget debit is the project's intended behavior affecting only the client's own allowance. Availability NONE.

## Reproduction steps
1. Attacker is an external NWC client app holding a connection secret with pay_invoice permission (PR LOW), sending pay_invoice over a relay (AV NETWORK, UI NONE). No defense must be defeated (AC LOW): the request passes the connection-only dedupe, budget and balance checks, the node rejects the duplicate hash, and the whole-list lookup supplies the foreign payment. Success requires runtime state outside the attacker's control: the node must have paid that exact invoice/hash within the listing window and the client's budget and wallet balance must cover the amount (AT PRESENT).

## Recommended fix
Settlement evidence for a pay_invoice response is resolved from the node's whole payment list by a client-supplied key (invoice or payment hash) and the response echoes that record's preimage and fee without verifying that this connection initiated the payment, violating the connection-scoped disclosure boundary the other NWC handlers enforce. Fix criteria: A pay_invoice response may carry a preimage or fee only for a payment this connection initiated (in this request or a prior activity of its own). For an invoice the node already settled outside the connection, respond with an error (e.g. OTHER / already paid) that reveals neither preimage nor fee. If budget debiting of wallet-paid invoices is retained, it must not disclose payment data. Verify: pay an invoice from the wallet UI or a second connection, then request it over NWC from another connection and confirm the response contains no preimage or fee.

---
**Severity:** LOW
**Status:** Open
**Category:** IDOR
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258020

---

# Timed-out (possibly in-transit) payment is shown with a Try again control enabling keysend double-send

## Details
Every non-LDK backend deliberately converts an unknown payment outcome (the request outlived the payment timeout, default 60s, while the HTLC may still be held by the recipient) into `{ payment_error: 'Payment timed out. It may be in transit...' }` (LND.ts:567-573, lndmobile/index.ts:385-391, CLNRest.ts:519-525, LightningNodeConnect.ts:577-583). The comments at each site state the invariant that this shape must not look retryable because a retry double-sends keysends, and the rest of the project honours it: LdkNode.awaitPaymentCompletion returns IN_FLIGHT for the same situation ('Reporting a timeout as a failure there lets the user send again while this payment can still complete'), NostrConnectUtils.resolveLightningPaymentInTransit (utils/NostrConnectUtils.ts:1259-1280) treats the same message as in-flight for NWC budget holds, and SendingLightning.test.tsx:106 pins that IN_FLIGHT shows no Try Again.

The user-facing screen is the one consumer that breaks it. TransactionsStore.handlePayment (853-885) sets error=true/payment_error for any non-empty payment_error and clears the paymentInFlight guard (817); SendingLightning (583-604) then renders PaymentErrorView ('Error' heading) with the primary white 'Try Again' button for `payment_error || error`, whose onPress is navigation.goBack() to the Send screen. sendKeySendPayment (Send.tsx:537) and the send button (Send.tsx:738) check only the already-cleared paymentInFlight flag, and each keysend dispatch generates a fresh preimage and hash (TransactionsStore.ts:661-677), so the node cannot deduplicate the retry as it does for BOLT11.

A keysend recipient who accepts the incoming HTLC but withholds settlement past the wallet's timeout (LND/CLN/LDK keep in-flight HTLCs after their retry timeout, as the LDK comment notes) causes the wallet to show an Error screen with 'Try Again'; a user who taps it and sends again pays twice once the recipient settles both HTLCs. The in-transit text is displayed, so the user is warned, but the screen's affordance contradicts the warning. Affects LND REST, embedded LND, LNC and CLNRest keysends; LDK is unaffected via IN_FLIGHT; LndHub and NWC do not support keysend.

## Evidence
1. [views/SendingLightning.tsx:583–603](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/SendingLightning.tsx#L583-L603)
   The 'Try Again' button renders for any `payment_error || error`, including the timed-out shape, and its onPress is navigation.goBack() to the keysend Send screen. The sibling IN_FLIGHT branch (lines 438-470, inTransit at 338-343) shows the in-transit clock with no retry control, which is the behaviour the project's own SendingLightning.test.tsx:106 pins.
2. [stores/TransactionsStore.ts:814–885](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L814-L885)
   handlePayment clears the double-submission guard (817) and, because `result.payment_error !== ''` (859), sets error=true and payment_error to the timed-out text, folding an unknown-outcome result into the same state as a definitive failure.
3. [backends/LND.ts:555–577](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LND.ts#L555-L577)
   LND REST races /v2/router/send against a forced timeout at timeout_seconds+1 and resolves `{ payment_error: paymentTimedOut }` while the HTLC may still be held by the recipient; the comment names the invariant: a retryable-looking error is 'dangerous on keysend, where a retry double-sends'.
4. [lndmobile/index.ts:384–394](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/lndmobile/index.ts#L384-L394)
   Embedded LND's sendPaymentV2 races RouterSendPaymentV2 against the same forced timeout and resolves the identical timed-out shape, so the embedded keysend path reaches the same UI state.
5. [backends/CLNRest.ts:490–526](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/CLNRest.ts#L490-L526)
   CLN's payWithTimeout returns the same timed-out shape for /v1/keysend and /v1/xkeysend with the stated intent that it surface as 'may be in transit' rather than a retryable error.
6. [backends/LightningNodeConnect.ts:566–582](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/backends/LightningNodeConnect.ts#L566-L582)
   LNC resolves the timed-out shape when no terminal event arrives, explicitly 'rather than rejecting: ... a hard failure here invites a retry (a double-send on keysend, where every attempt carries a fresh preimage)'.
7. [stores/TransactionsStore.ts:661–676](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/TransactionsStore.ts#L661-L676)
   Each keysend dispatch generates a fresh random preimage and payment hash, so the node cannot reject the retry as a duplicate the way it does for a BOLT11 re-pay; a second dispatch while the first HTLC is still held is a second payment.
8. [views/Send.tsx:522–562](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Send.tsx#L522-L562)
   sendKeySendPayment, the screen 'Try Again' returns to, bails only on TransactionsStore.paymentInFlight (537), which handlePayment already cleared; the send button's isSendDisabled (738) checks the same flag, so the re-dispatch is unguarded.

## Impact
Integrity of the wallet's spend control: the user pays the approved keysend amount a second time, contrary to the single payment they approved, and the threat model names 'no false failure causing double-pay' as an asset. The user takes an explicit extra step after a warning text, and the loss is bounded to one extra payment per induced retry, so integrity is rated low. No confidentiality or availability impact.

## Reproduction steps
1. The attacker is the keysend recipient: any Lightning node the user chooses to tip or pay by keysend. It accepts the HTLC and delays settlement beyond the wallet's 60s payment timeout, which any node under the recipient's control can do (hold-invoice style). The wallet shows the Error view with 'Try Again'; the user taps it, lands on the keysend screen with the guard released, and sends again with a new preimage; the recipient settles both. No credential or control is defeated; the user must actively retry (UI:A) against on-screen text saying the payment may be in transit.

## Recommended fix
1. TransactionsStore.handlePayment folds the backends' unknown-outcome (timed-out) result into the same error=true state as a definitive failure, so SendingLightning offers 'Try Again' for a payment that may still settle. Fix criteria: A timed-out/unknown-outcome result from any backend is rendered the same way as IN_FLIGHT: in-transit text, no Try Again, back navigation to the wallet rather than the payment screen. Verify with a backend returning the paymentTimedOut shape for a keysend: no Try Again button is on screen and hardware back pops to Wallet.
2. The keysend Send screen re-dispatches with a fresh preimage guarded only by paymentInFlight, which is released as soon as any result (including unknown outcome) is handled. Fix criteria: A keysend to the same destination is refused or explicitly confirmed with an in-transit warning while the prior keysend has no terminal status from the node (e.g. the node's payment list still shows it IN_FLIGHT). Verify: after a timed-out keysend, returning to the Send screen and sending again does not dispatch a second payment until the first is reported failed.

---
**Severity:** LOW
**Status:** Open
**Category:** Duplicate action
**CWE:** [CWE-837](https://cwe.mitre.org/data/definitions/837.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258019

---

# NWC insufficient-balance error reveals exact wallet balance to budget-limited or balance-unprivileged clients

## Details
ZEUS lets the user grant an external NWC client a spending budget and, separately, a get_balance permission, so a client is meant to see only the slice of the wallet it was granted. handleGetBalance (stores/NostrWalletConnectStore.ts:2011-2022) enforces this: when maxAmountSats is set it answers get_balance with the connection's remaining budget rather than the node balance, and the method is bound only when get_balance is in the connection's permissions (1510-1515; the Custom preset in utils/NostrConnectUtils.ts lets pay_invoice be granted without it).

The pay_invoice handlers undo that. After the budget check passes, handleLightningPayInvoice (2629-2645) and handleCashuPayInvoice (2869-2882) compare the amount with the real wallet balance and, on failure, build the NIP-47 INSUFFICIENT_BALANCE message from the exact figure: lightningInsufficientBalance / cashuInsufficientBalance with {{balance}} = currentLightningBalance / cashuStore.totalBalanceSats (locales/en.json:1847-1848). The handler's return value is what @getalby/sdk 8.0.3's NWCWalletService publishes to the client (1517-1534, 1584).

An NWC client is the payee of invoices it submits, so it can mint an invoice for any amount. Whenever the connection's remaining budget exceeds the spendable balance — a state the app anticipates with the WalletBalanceLowerThanBudget warning (models/NWCConnection.ts:481-497) and that arises as the user spends or when a renewing budget outlives the balance, since the UI slider cap (AddOrEditNWCConnection.tsx:445) is applied only at creation — the client submits an invoice for an amount between the balance and its remaining budget. It passes validateBudgetBeforePayment, fails the balance check, and receives the exact lightning or ecash balance without any payment. Repeating as the balance changes tracks the wallet balance over time. The disclosure matters for the budget-limited connections the feature is designed to protect and for connections granted pay_invoice without get_balance; connections without a budget already receive the balance from get_balance.

## Evidence
1. [stores/NostrWalletConnectStore.ts:2629–2644](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2629-L2644)
   Primary sink. After validateBudgetBeforePayment passes, handleLightningPayInvoice fetches the node's total lightning balance and, when it is below the invoice amount, returns a NIP-47 INSUFFICIENT_BALANCE error whose message interpolates the exact figure (balance: currentLightningBalance.toString()). The returned object is the handler's response to the external client; no payment occurs.
2. [stores/NostrWalletConnectStore.ts:2869–2881](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2869-L2881)
   Cashu sibling in handleCashuPayInvoice: after the budget check, the exact total ecash balance (cashuStore.totalBalanceSats) is interpolated into the cashuInsufficientBalance error returned to the client.
3. [stores/NostrWalletConnectStore.ts:2011–2021](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2011-L2021)
   The sanctioned balance path: handleGetBalance answers a budget-limited connection with connection.remainingBudget, not the node balance, and is only bound at all when the connection has the separate get_balance permission (1510-1515). The project therefore does not concede the real balance to a budget-limited or pay-only client; the error path does.
4. [stores/NostrWalletConnectStore.ts:1517–1533](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L1517-L1533)
   subscribeToConnection binds handler.payInvoice for any connection with pay_invoice permission and returns the handler's {result, error} object to nwcWalletService.subscribe (@getalby/sdk 8.0.3), which delivers it to the client as the NIP-47 response. No message sanitisation sits between the handler and the relay.
5. [models/NWCConnection.ts:481–496](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/models/NWCConnection.ts#L481-L496)
   syncWarnings raises WalletBalanceLowerThanBudget when maxAmountSats >= available balance — the app anticipates the state (remaining budget above spendable balance) that lets the client's probe pass the budget check and hit the balance check; it warns the user but does not block it.
6. [locales/en.json:1847–1848](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/locales/en.json#L1847-L1848)
   The strings read 'You have only {{balance}} sats remaining in Cashu/Lightning wallet', confirming the wallet balance is placed verbatim in the client-facing message.

## Impact
Confidentiality LOW: the exact lightning or ecash balance is disclosed to a principal the budget mechanism and the get_balance permission are meant to keep ignorant of it; no keys, preimages or funds are exposed and the disclosure is limited to one figure per probe. No integrity or availability impact.

## Reproduction steps
1. Attacker is an external NWC client app holding a budget-limited (or get_balance-less) connection with pay_invoice permission (PR LOW; NWC client apps are an in-scope external principal). It mints an invoice to itself for an amount above the wallet balance but within its remaining budget and sends pay_invoice over the relay (AV NETWORK); the handler rejects before paying and returns the exact balance. No defence to defeat (AC LOW), no user involvement (UI NONE). Requires the remaining budget to exceed the spendable balance at that moment (AT PRESENT), a state the app warns about but does not prevent. Assumes @getalby/sdk 8.0.3 NWCWalletService delivers the handler's error.message to the client unchanged, as its handler contract specifies.

## Recommended fix
Client-facing NIP-47 insufficient-balance errors in handleLightningPayInvoice and handleCashuPayInvoice are built from the wallet's total lightning/ecash balance rather than from information the connection is entitled to (its own budget). Fix criteria: Insufficient-balance responses to NWC clients must carry the INSUFFICIENT_BALANCE code with a message that never includes the wallet's real balance; for budget-limited connections the message may reference only the connection's remaining budget, and for connections without get_balance it must reference no balance figure at all. Verification: a budget-limited client requesting an amount above the wallet balance but within budget receives no figure other than its own budget values.

---
**Severity:** LOW
**Status:** Open
**Category:** Information disclosure
**CWE:** [CWE-209](https://cwe.mitre.org/data/definitions/209.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258018

---

# Self-custody token claim consumes token before melt feasibility checks, stranding funds at unlisted mint

## Details
CashuStore.claimToken with toSelfCustody=true (the 'Receive to self-custody' button in views/Cashu/CashuToken.tsx) is meant to accept a Cashu token and immediately melt it to the user's own Lightning node. The implementation performs the irreversible step first: receiveTokenCDK(encodedToken, signingKey, mintUrl) swaps the token at its mint at line 5309 (CashuDevKit.receive -> wallet.receive, consuming the sender's proofs), and only afterwards creates the node invoice, requests a melt quote and checks fee_reserve >= tokenAmt (5336-5346). If invoice creation fails, the quote fails, the fee reserve matches or exceeds the amount (deterministic for any token at or below the mint's fee reserve, e.g. a 1-2 sat token), the second invoice fails, or meltCDK throws, the function returns success:false and the view shows an error ('Melt fees match or exceed token amount', 'Error claiming token') — a false failure in the threat model's terms: the token is spent and cannot be re-claimed elsewhere, yet the user is told the claim failed.

Where the value lands compounds this. The self-custody button is the only claim control not gated on haveMint (CashuToken.tsx 560-606 vs 549-556), so it is reachable for tokens whose mint is not in the user's list. receiveTokenCDK -> ensureMintAdded (437-463) adds that mint to CDK but never to this.mintUrls or the persisted <nodeDir>-cashu-mintUrls (only addMint at 2730-2800 does). The received value then inflates totalBalanceSats (native getTotalBalance sums all CDK wallets) while Mints.tsx / EcashMintPicker list only mintUrls, so there is no entry to view or spend it from. At the next initializeWallets the reconciliation loop (3476-3491) treats the CDK-only mint as an orphan and calls CashuDevKit.removeMint (removeWallet + db.removeMint), after which the balance vanishes from the UI entirely. Whether cdk-sqlite 0.18.1's remove_mint deletes the proof rows or merely detaches them is an assumption not verifiable in this checkout; either way the proofs are no longer enumerated and the user must know to re-add that exact mint and run restore.

For backends where BackendUtils.supportsCashuWallet() is false (remote LND, CLNRest, LNC), this path is the only 'Receive' button, initializeCDK explicitly provisions a CDK mnemonic for remote nodes, and no Cashu UI exists at all, so a post-receive failure leaves the value in a CDK database the user cannot see.

The offline variant makes the mis-routing automatic: when connectivityStore reports offline, claimToken ignores toSelfCustody and queues the token (5261-5265), returning success:true with a warning that the self-custody handler ignores, so 'Successfully received token' is shown; sweepOfflinePendingTokens later calls ensureMintAdded(token.mint) and receives it as ecash at the foreign mint, which is removed at the next boot.

This contradicts the CashuToken.tsx comment (118-129) that an untrusted, attacker-chosen mint only becomes a wallet through explicit Add Mint, since these paths populate a mint URL chosen by the token's sender without adding it to the trusted list.

## Evidence
1. [stores/CashuStore.ts:5291–5375](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L5291-L5375)
   claimToken(toSelfCustody): the irreversible step receiveTokenCDK (swap at the token's mint) runs at 5309 before the node invoice is created (5313), the melt quote fetched (5330), the fee_reserve >= tokenAmt check (5336-5346, returns success:false 'feeExceedsAmt'), the second invoice (5349-5362) and meltCDK (5364). Every failure after 5309 returns success:false or throws into the catch, so the UI reports a failed claim while the value already sits in the CDK wallet keyed by decoded.mint.
2. [stores/CashuStore.ts:1803–1825](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L1803-L1825)
   receiveTokenCDK calls ensureMintAdded(mintUrl) (437-463) with the token-supplied mint URL, which only calls CashuDevKit.addMint and updates addedMintsCache; unlike the sanctioned addMint (2730-2800) it never updates this.mintUrls or the persisted <nodeDir>-cashu-mintUrls list.
3. [views/Cashu/CashuToken.tsx:560–605](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/CashuToken.tsx#L560-L605)
   The 'Receive to self-custody' (or, for backends with supportsCashuWallet()=false, plain 'Receive') button is disabled only on channels/isSupported/loading, not on haveMint (contrast the plain Receive button at 549-556, disabled when !haveMint). It is therefore the one path by which a token from a mint absent from the user's list reaches receiveTokenCDK. Its handler also reads only success/errorMessage, so the offline branch's success:true+warningMessage is rendered as 'Successfully received token'.
4. [stores/CashuStore.ts:3476–3490](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L3476-L3490)
   At the next initializeWallets, every CDK mint not in the persisted mint list is treated as an orphan and removed via CashuDevKit.removeMint, so the mint holding the just-received value disappears from balances.
5. [stores/CashuStore.ts:5261–5264](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L5261-L5264)
   When connectivityStore reports offline, claimToken drops toSelfCustody and queues the token via claimTokenOffline; sweepOfflinePendingTokens (5107-5160, ensureMintAdded(token.mint) at 5149) later receives it as ecash at the token's mint, again without adding that mint to the trusted list.
6. [views/Cashu/Mints.tsx:74–81](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/Mints.tsx#L74-L81)
   The mint list (and components/EcashMintPicker.tsx:86) iterates only CashuStore.mintUrls, so a balance held at a mint registered via ensureMintAdded alone has no UI entry to view or spend it from, even before the boot-time removal.
7. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:707–725](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L707-L725)
   getTotalBalance sums every CDK wallet of the sat unit, so totalBalanceSats shown in BalancePane/Wallet is inflated by the stranded value with no corresponding spendable mint entry until removeMint (625-648; iOS parity at ios/CashuDevKit removeMint 626-671) drops it.

## Impact
Receipt state is misreported (claim shown as failed, or offline queue shown as success, although the token was consumed), wallet state becomes incoherent (total balance includes value no mint entry can spend), and the value becomes inaccessible from the wallet after the boot-time orphan-mint removal, recoverable only by manually re-adding the exact mint and restoring. Bounded to the token's value; no confidentiality impact.

## Reproduction steps
1. Any sender delivers a token (QR, cashu: link, clipboard, NFC) that handleAnything routes to the CashuToken screen; the sender chooses mint URL and amount. The user taps 'Receive to self-custody' (or 'Receive' on remote backends). If the mint is not in the user's list, the amount is at or below that mint's fee reserve, the melt fails, or the device is offline, the token is consumed and the value parked at an unlisted mint while the UI reports failure or a plain success. No privileges; a griefing sender triggers it deterministically with a tiny token from a mint the user has not added.

## Recommended fix
1. claimToken(toSelfCustody) performs the irreversible receive before verifying that the melt to the user's node is feasible (invoice, quote, fee vs amount), and reports failure to the user after the token has been consumed. Fix criteria: All feasibility checks must complete before the token is received, or a receive followed by a failed melt must be reported as 'received as ecash at <mint>' with the balance visible and spendable, never as a failed claim. Verify with a token whose amount is below the mint fee reserve: the UI must either refuse before consuming it or show the ecash balance it created.
2. receiveTokenCDK/ensureMintAdded register a token-specified mint in CDK without adding it to the app's trusted mint list, and boot-time reconciliation then removes that mint and hides its proofs. Fix criteria: A receive must only proceed for mints in the user's list (or add the mint to the persisted list with user consent), and boot reconciliation must never remove a CDK mint holding unspent proofs without surfacing it to the user. Verify by receiving at a foreign mint and restarting: the balance must remain visible and spendable.
3. Offline claimToken drops the toSelfCustody intent, reports success, and later sweeps the token as an ecash receive at the token's mint. Fix criteria: An offline self-custody request must be preserved as such (melted after reconnect) or refused with a clear message, and the view must not render it as a completed receive; it must not be converted into an ecash receive at a mint the user did not add.

---
**Severity:** LOW
**Status:** Open
**Category:** Incorrect behavior order
**CWE:** [CWE-696](https://cwe.mitre.org/data/definitions/696.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258016

---

# Single-mint ecash melt reports success without checking returned quote state

## Details
The single-mint Lightning payment path in CashuStore.payLnInvoiceFromEcash (stores/CashuStore.ts:4538-4581) treats any non-throwing return from CashuDevKit.melt() as a settled payment. It copies meltResult.fee_paid / preimage into a CashuPayment (which has no status field, so ActivityListItem renders it as 'You sent'), persists it to <nodeDir>-cashu-payments, and sets paymentSuccess=true, which CashuSendingLightning.tsx uses as the sole gate for the success screen (successfullySent is !!paymentSuccess; PaymentSuccessView/PaymentDetailsSheet need no preimage). The returned `state` field is never inspected. No production code calls CashuDevKit.checkMeltQuote, so a pending melt is never reconciled later; checkPendingItems only polls mint quotes and sent tokens.

Both native bridges (android CashuDevKitModule.kt melt() -> wallet.prepareMelt(quoteId).useHandle { it.confirm() } -> encodeMelted; ios CashuDevKitModule.swift:1136-1156 the same) serialise FinalizedMelt.state via quoteStateToString (Unpaid/Paid/Pending/Issued), and cashu-cdk/types.ts declares CDKMelted.state, so the data reaches JS and is simply unused. Dependency assumption (cdk-ffi 0.18.1 per fetch-libraries-versions.json, prebuilt, not readable here): PreparedMelt.confirm() returns Ok(FinalizedMelt) carrying the mint's NUT-05 quote state rather than throwing when the mint answers PENDING (Lightning HTLC in flight — hold invoice or slow route), leaving the input proofs pending. The project's own multi-mint executor at stores/CashuStore.ts:4740-4752 is written on exactly this premise: it uppercases meltResult.state and throws errorPayingInvoice when it is not 'PAID'. The NWC service path (stores/NostrWalletConnectStore.ts:2884-2931) also calls payLnInvoiceFromEcash and treats anything that is not paymentError as a settled payment, debiting the budget and answering the external NIP-47 client with a success result; its own comments concede 'melt never records pending today' / 'CashuStore does not surface IN_FLIGHT melts yet'.

Attack path: a Lightning payee (merchant, marketplace, or anyone who can hand the user an invoice via QR/deep link/LNURL-pay/clipboard, or an NWC client paying through ZEUS) issues a hold invoice. The user pays it from ecash on the default single-mint path; the mint reports PENDING; ZEUS shows 'payment sent' with amount and fee but no preimage, records a completed payment in history, and (over NWC) reports success to the client. The payee can (a) claim non-receipt and ask the user to pay again via a second invoice — the user has no preimage and their own app says it succeeded — then settle both; or (b) cancel the hold so the proofs return to the mint while ZEUS's history permanently shows a successful spend and never re-checks the quote. SECURITY.md lists 'fake payment confirmation' as in-scope and the threat model protects 'must report payment/receipt state truthfully (no fake success, no false failure that leads to double-pay)'.

The same omission exists in meltCDK (stores/CashuStore.ts:1056-1069, used by claimToken's self-custody sweep) and sweepMint (~5563), which report a successful sweep for a pending melt.

## Evidence
1. [stores/CashuStore.ts:4538–4581](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L4538-L4581)
   payLnInvoiceFromEcash (single-mint path) calls CashuDevKit.melt, then unconditionally constructs and persists a CashuPayment and sets paymentSuccess=true / paymentPreimage=(preimage||''). meltResult.state is never read, so a Pending (or any non-Paid) FinalizedMelt is surfaced and recorded as a completed payment. This is the code the fix must change.
2. [stores/CashuStore.ts:4731–4758](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L4731-L4758)
   Sibling multi-mint executor reads meltResult.state, uppercases it and throws errorPayingInvoice when it is not 'PAID' — the project itself handles confirm() returning a non-paid state, but only on this path.
3. [views/Cashu/CashuSendingLightning.tsx:244–291](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Cashu/CashuSendingLightning.tsx#L244-L291)
   successfullySent() is !!paymentSuccess and showLoading is !paymentSuccess && !paymentError; the success screen (PaymentSuccessView, PaymentDetailsSheet) is rendered on paymentSuccess alone, with no requirement for a preimage or a Paid state.
4. [android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt:445–456](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/com/zeus/cashudevkit/CashuDevKitModule.kt#L445-L456)
   encodeMelted serialises FinalizedMelt.state via quoteStateToString (Unpaid/Paid/Pending/Issued) — the mint-reported state is available to JS (melt() at 1249-1273 returns it via prepareMelt().confirm()) and is simply ignored by the single-mint path. ios/CashuDevKit/CashuDevKitModule.swift:1136-1156 is the equivalent.
5. [stores/NostrWalletConnectStore.ts:2884–2931](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/NostrWalletConnectStore.ts#L2884-L2931)
   NWC service pay_invoice over ecash calls payLnInvoiceFromEcash and, unless paymentError is set, debits the connection budget and answers the external client with a settled result; comments concede 'CashuStore does not surface IN_FLIGHT melts yet', so a Pending melt is reported to the NWC client as paid.
6. [stores/CashuStore.ts:1056–1068](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/CashuStore.ts#L1056-L1068)
   meltCDK (used by claimToken toSelfCustody) likewise returns the melt result without checking state; sweepMint (~5563) does the same and reports a successful sweep.

## Impact
Payment-state integrity is violated: an unsettled payment is shown, permanently recorded, and reported to NWC clients as successful with no preimage, enabling a double-payment dispute and hiding that proofs are still pending at the mint; ZEUS never re-checks the melt quote. No confidentiality impact; the tie-up of the pending proofs is bounded by the HTLC/quote timeout and depends on CDK's own reconciliation, so availability is not rated.

## Reproduction steps
1. Attacker is the Lightning payee; they deliver a hold invoice over any channel ZEUS accepts (QR, lightning: link, LNURL-pay, clipboard, or as an NWC client). The victim actively confirms and pays it from ecash on the default single-mint path. The mint answers PENDING while the HTLC is held; under the stated cdk 0.18.1 assumption confirm() returns Ok(state=Pending), and ZEUS displays, persists and (over NWC) reports success. No privileges and no non-default configuration beyond ecash being enabled; a cooperating or standard mint Lightning backend that reports in-flight HTLCs as pending is the only requirement.

## Recommended fix
payLnInvoiceFromEcash (single-mint), meltCDK and sweepMint accept any non-throwing CashuDevKit.melt result as a settled payment, ignoring the state field the bridge returns and that the multi-mint path already checks; no code ever re-polls a melt quote afterwards. Fix criteria: A melt whose returned state is not Paid must not set paymentSuccess, must not be persisted as a completed CashuPayment, and must not be reported to NWC clients as settled; it must surface a distinct pending outcome (IN_FLIGHT status on the stored payment) and be reconciled by polling checkMeltQuote until Paid or Unpaid, mirroring the multi-mint path. Verify by driving the single-mint path with a FinalizedMelt of state Pending and asserting no success state, no completed history entry and no NWC success result is produced.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper condition check
**CWE:** [CWE-754](https://cwe.mitre.org/data/definitions/754.html)
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
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258015

---

# Onion lightning-address pay callback fetched over clearnet after Tor-routed first hop

## Details
ZEUS routes requests through its embedded Tor client only per call site: `doTorRequest` (utils/TorUtils.ts:65) issues HTTP via `RnTor` over a local SOCKS port; nothing configures `ReactNativeBlobUtil` or `fetch` to use it and no native proxy is set. `enableTor` is the per-node 'Use Tor' switch for remote backends (LND REST, CLNRest, LndHub; views/Settings/WalletConfiguration.tsx:1531), which the maintainers treat as 'route the app's own fetches over Tor so they do not leak the user's IP' (stores/SettingsStore.ts:1861-1867; stores/LSPStore.ts:420-422, #4372).

When such a user pays a `.onion` lightning address, both entry points — `handleAnything` (utils/handleAnything.ts:736-752) and the contacts swipe row (components/LayerBalances/LightningSwipeableRow.tsx:190-202) — fetch `http://<x>.onion/.well-known/lnurlp/<user>` through `doTorRequest` and open LnurlPay with the parsed response as `lnurlParams`. In `LnurlPay.sendValues` the service-supplied `lnurl.callback` passes `isLnurlCallbackAllowed` (utils/LnurlPayUtils.ts:274-280: http allowed for .onion, any https host allowed) and is then fetched with `ReactNativeBlobUtil.fetch('get', url.format(u))` (views/LnurlPay/LnurlPay.tsx:300) — the system network stack — with `amount` and `comment` in the query string. The second hop never goes over Tor.

Two outcomes, both chosen by the service:
1. The service returns a clearnet `https://` callback (explicitly permitted). The phone connects to it directly, handing the onion service's operator (or its fronting host) the user's real IP together with the amount, the comment and the identity of the onion payee. The Tor first hop gives the operator nothing; the second hop deanonymises the payer.
2. The service returns the usual `http://<x>.onion/` callback. The system resolver is asked for the .onion name — leaking which hidden service the user is paying to the local network/DNS resolver, the very leak utils/handleAnything.ts:650-654 avoids for the BIP 353 lookup — and the request then fails, so the Tor-only pay flow does not work unless an external Orbot VPN happens to route the device.

The generic LNURL first hop (js-lnurl getParams, utils/handleAnything.ts:946) is also clearnet and acknowledged by a TODO; the onion lightning-address path is the one where the app itself establishes the Tor expectation and then silently breaks it on the hop that carries the payment details. SECURITY.md lists 'traffic that bypasses Tor when Tor is enabled' as in scope.

## Evidence
1. [views/LnurlPay/LnurlPay.tsx:300–301](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LnurlPay/LnurlPay.tsx#L300-L301)
   sendValues fetches the service-supplied lnurl.callback (with amount and comment in the query string) via ReactNativeBlobUtil.fetch — the system network stack — with no reference to enableTor or to how lnurlParams were obtained. This is the line the fix must change.
2. [utils/handleAnything.ts:736–752](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L736-L752)
   For an .onion lightning address with the node's enableTor on, the first hop (http://<x>.onion/.well-known/lnurlp/<user>) is deliberately routed through doTorRequest and the parsed response is passed to LnurlPay as lnurlParams, establishing the Tor expectation the second hop breaks.
3. [components/LayerBalances/LightningSwipeableRow.tsx:190–202](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/components/LayerBalances/LightningSwipeableRow.tsx#L190-L202)
   Second entry point with the same pattern: onion lightning addresses from contacts are fetched via doTorRequest and navigate to LnurlPay with the response as lnurlParams.
4. [utils/LnurlPayUtils.ts:274–280](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/LnurlPayUtils.ts#L274-L280)
   isLnurlCallbackAllowed admits http for .onion hosts and any https host, so an onion service may return either an onion callback (unreachable from the system stack, and its name goes to the system DNS resolver) or a clearnet callback (fetched directly, revealing the IP).
5. [utils/TorUtils.ts:65–76](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/TorUtils.ts#L65-L76)
   Tor routing in ZEUS is per request: doTorRequest issues HTTP through RnTor (react-native-nitro-tor 0.6.1) over a local SOCKS port. Nothing configures ReactNativeBlobUtil or fetch to use it, and no native proxy is set, so any ReactNativeBlobUtil call is clearnet.
6. [stores/SettingsStore.ts:1861–1867](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SettingsStore.ts#L1861-L1867)
   The maintainers' stated semantics of enableTor: route the app's own fetches (not just node RPC) over Tor so they do not leak the user's IP.
7. [stores/LSPStore.ts:420–422](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LSPStore.ts#L420-L422)
   Issue #4372: a clearnet request made while the node is on Tor is treated by the project as an IP leak to fix, confirming the second-hop clearnet fetch is outside what the project concedes.
8. [utils/handleAnything.ts:650–654](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/handleAnything.ts#L650-L654)
   The BIP 353 lookup is skipped for .onion names explicitly so the onion address is not sent to a clearnet resolver; the onion-callback case of this finding sends exactly that name to the system resolver.

## Impact
The user's network identity is linked to the payment amount, comment and the identity of the onion payee, defeating the anonymity the user configured and the project promises. For onion callbacks the .onion hostname leaks to the system DNS resolver and the pay flow fails — a functional gap, not an availability attack. No integrity impact: the returned invoice is still bound to amount and metadata by verifyLnurlPayInvoice.

## Reproduction steps
1. Attacker: the operator of an .onion lightning address (a third-party LNURL server, named in the threat model), or anyone who gets the user to pay one. Preconditions: the active wallet is a remote backend with 'Use Tor' on, and the user pays the onion address and confirms an amount (UI:A). The service simply returns a clearnet https callback; isLnurlCallbackAllowed admits it and the phone connects directly. No defence to evade and no privileges needed; AT:P for the Tor-enabled remote-node configuration and the user's choice of this payee.

## Recommended fix
1. LnurlPay.sendValues fetches the service-supplied callback with ReactNativeBlobUtil regardless of the per-node enableTor setting or of the first hop having been made over Tor, and isLnurlCallbackAllowed admits .onion callbacks that the system stack cannot reach. Fix criteria: When enableTor is on — and at minimum whenever the lnurlp response was obtained via doTorRequest or the callback host is .onion — the callback request is issued through doTorRequest, and .onion callbacks are never handed to the system resolver. A test asserts that Tor-fetched onion lnurlParams never cause a ReactNativeBlobUtil call for the callback.
2. An onion service reached over Tor can steer the second hop to a clearnet host of its choosing, which the callback policy admits silently. Fix criteria: A callback whose host differs from the onion origin that served the lnurlp response is refused, or requires explicit user consent naming the host, before any connection is made.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-359](https://cwe.mitre.org/data/definitions/359.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258013

---

# Android channel-database export written in cleartext to public Downloads folder

## Details
The 'Export Channels to other device -> Save to Device' flow (views/Tools/index.tsx and views/Settings/Seed.tsx -> handleExportChannels -> exportChannelDb) stops lnd, zips the whole `<lndDir>/data/graph/<network>` directory and, on Android, copies the ZIP verbatim into the public Downloads directory (`RNFS.DownloadDirectoryPath/zeus-lnd-<network>-<ts>.zip`), then tells the user it 'has been saved to your Downloads folder'. The graph directory is the node's complete channel-state database (channel.sqlite/channel.db plus lnd.sqlite under the `db.backend=sqlite`/`db.use-native-sql=true` config written by LndMobileUtils.writeLndConfig): every open and closed channel with commitment state and revocation logs, the counterparty revocation store and our shachain producer, the full payment and invoice history with preimages, destinations, memos and routes, private-channel peer identities, decayed-log and watchtower-client state. It does not contain the seed or on-chain keys (data/chain).

Nothing on this branch encrypts the archive or lets the user choose a destination, although the same module ships the control: the Olympus branch of the very same alert encrypts the identical payload with `encryptFile` keyed by the seed phrase (which handleExportChannels already receives), the node-config export was redesigned so that 'the export is never produced in plaintext' and 'nothing is written to shared storage unprompted' (NodeConfigUtils.ts, with a test asserting no write to Downloads), and the rescue-key export was moved off Downloads for exactly this reason (SwapUtils.ts: 'those files outlive the app'). Seed-keyed encryption would cost nothing in UX, because the importing device must restore the same seed before importChannelDb runs (LndMobileUtils.createLndWallet).

Downloads is shared external storage outside both the app sandbox and the app lock. Anyone holding the unlocked phone can open the zip with the system Files app while ZEUS itself is PIN/passphrase-locked; co-installed apps with All-files-access or legacy external-storage access (file managers, backup/sync tools), a desktop over USB/MTP, or a third-party backup of the Downloads folder read it as well. The file is never removed: the exporting device keeps it indefinitely, and the complete/duress wipe (DataClearUtils) purges legacy rescue-key exports from Downloads but not this archive. The project's existing activity-CSV export also writes to Downloads, so what this path hands a shared-storage reader beyond that concession is the preimages, memos, channel-protocol state (commitments, revocation material), private-channel peers and watchtower state - sensitive wallet state that the lock screen and privacy mode are meant to guard.

Assumption: react-native-fs 2.20.0's DownloadDirectoryPath resolves to Environment.getExternalStoragePublicDirectory(DIRECTORY_DOWNLOADS) (the maintainers' own comment calls it 'public /sdcard/Download'); on Android 11+ an app may create files there through the File API without a storage permission, which is why the copy succeeds although the manifest declares no storage permission (on Android 9/10 it would fail with EACCES).

## Evidence
1. [utils/ChannelMigrationUtils.ts:712–717](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ChannelMigrationUtils.ts#L712-L717)
   Primary sink: on Android the staged plaintext zip is copied with RNFS.copyFile into RNFS.DownloadDirectoryPath (public /sdcard/Download) and left there indefinitely; only the cache copy is unlinked. No encryption and no user-chosen destination (saveDocuments/SAF) on this branch.
2. [utils/ChannelMigrationUtils.ts:667–684](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ChannelMigrationUtils.ts#L667-L684)
   exportChannelDb packages <lndDir>/data/graph/<network> (channel.sqlite or channel.db, lnd.sqlite under the native-SQL config, wtclient, sphinxreplay) with zipFolder alone; no encryptFile call before the artefact leaves the sandbox.
3. [utils/ChannelMigrationUtils.ts:269–281](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/ChannelMigrationUtils.ts#L269-L281)
   The Olympus branch offered in the same alert encrypts the identical graph-directory zip with encryptFile keyed by the user's seed phrase and unlinks the plaintext; the local Save-to-Device branch omits this step although the seed is already in hand (handleExportChannels receives seedPhrase).
4. [android/app/src/main/java/app/zeusln/zeus/ZipUtils.java:34–74](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/java/app/zeusln/zeus/ZipUtils.java#L34-L74)
   zipFolder writes a plain, unencrypted ZIP of every file in the source directory; the module's encryptFile (PBKDF2-HMAC-SHA256 + AES-256-GCM) exists but is never invoked on the local export path.
5. [utils/NodeConfigUtils.ts:57–61](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/NodeConfigUtils.ts#L57-L61)
   The maintainers' stated policy for sibling exports: 'Nothing is written to shared storage unprompted, and the export is never produced in plaintext' (enforced by the 'never writes the export to shared Downloads' test). The channel-DB export violates both properties.
6. [utils/SwapUtils.ts:519–526](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/SwapUtils.ts#L519-L526)
   The project already classified the same pattern as a defect it fixed: older builds wrote the rescue key as plaintext to public Downloads, 'those files outlive the app', and under scoped storage only the creating install can remove them. The channel-DB export repeats the pattern.
7. [utils/DataClearUtils.ts:920–924](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/DataClearUtils.ts#L920-L924)
   The complete/duress wipe purges legacy rescue-key files from Downloads but has no step for zeus-lnd-<network>-<ts>.zip, so a wipe leaves the full channel database in shared storage.

## Impact
Full disclosure of the embedded node's channel database: all channel state incl. commitment and revocation material, the complete payment and invoice history with preimages, memos, destinations and balances, and private-channel peer identities - the wallet data the app lock and privacy mode exist to protect. The archive does not contain the seed or on-chain keys, and reading it does not alter node state or availability.

## Reproduction steps
1. The victim deliberately runs the multi-step Export Channels -> Save to Device flow on an Android 11+ device (UI:A); from then on the plaintext zip sits in public Downloads until the user manually deletes it, and the wipe path does not remove it (AT:P). Any reader of shared storage - a co-installed app with All-files-access or legacy storage access, a cloud-sync/backup app, a desktop over USB/MTP, or a person holding the unlocked phone using the system Files app while ZEUS is PIN-locked - copies the file and opens the SQLite/bbolt databases offline. No cryptography is defeated and no further victim interaction is needed.

## Recommended fix
1. exportChannelDb writes the zipped channel database to shared storage without encryption, so confidentiality depends entirely on Android external-storage access rules rather than on the app, unlike the Olympus branch which encrypts the same payload with the seed. Fix criteria: The artefact that leaves the app sandbox must be encrypted (e.g. the existing encryptFile AES-256-GCM primitive keyed by the seed phrase already passed to handleExportChannels, matching the Olympus path) and the import path must decrypt it with the restored seed. Verify: after export, no file outside the app's private directories contains readable channel.sqlite/channel.db/lnd.sqlite content.
2. The export is placed unprompted in the public Downloads directory, and neither the exporting device nor the complete/duress wipe ever deletes it. Fix criteria: Deliver the file via the system save dialog (saveDocuments/SAF, as NodeConfigUtils and SwapUtils do) staged from app-private cache so the user chooses the destination; remove the staged copy once consumed; and have the data-wipe path best-effort purge any export this install wrote to shared storage. Verify: after a completed export and after a wipe, no copy of the archive remains in Downloads or CachesDirectoryPath.

---
**Severity:** LOW
**Status:** Open
**Category:** Cleartext Storage
**CWE:** [CWE-312](https://cwe.mitre.org/data/definitions/312.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258012

---

# LNURL-pay url successAction opened without LUD-09 same-domain binding or the app's leave-app confirmation (open redirect from payment receipt)

## Details
LUD-09 defines the `url` successAction as `{tag:'url', description, url}` and requires `url` to be on the same domain as the LNURL callback. In ZEUS, `LnurlPay.sendValues` takes `data.successAction` verbatim from the service's callback response (views/LnurlPay/LnurlPay.tsx:390-392), persists it under the payment hash (stores/LnurlPayStore.ts:83-99) and renders it after payment in SendingLightning / CashuSendingLightning and later from payment history (Payment.tsx -> Historical.tsx). `LnurlPaySuccess.URLClicked` (views/LnurlPay/Success.tsx:27-43) then calls `Linking.canOpenURL(url)` / `Linking.openURL(url)` on the raw string.

Two controls are missing: (1) no check that the URL's host matches the callback/service domain shown right beneath it as 'Serviced by: <domain>'; (2) no scheme allow-list and no confirmation step: every other outbound link in the app, including server-supplied ones, goes through `UrlUtils.goToUrl` -> ExternalLinkModal -> `leaveZeus` (utils/UrlUtils.ts:199-222), which Success.tsx bypasses.

What the attacker actually reaches: a malicious or compromised LNURL-pay service, or a tenant of a shared lightning-address provider whose paylinks accept a per-user success URL, attaches to the payment receipt a tappable element whose text and target it controls, branded with the provider's domain. On Android 11+ (targetSdk 36) `canOpenURL` is filtered by the manifest `<queries>` (http/https VIEW only) plus ZEUS's own package, so http(s) to any host and ZEUS's own schemes (bitcoin:, lightning:, lnurl*:, lndconnect:, cashu:, zeusln:) resolve; on Android 9/10 (minSdk 28) any installed handler (tel:, sms:, market:, other wallets) resolves. On iOS only http(s) and LSApplicationQueriesSchemes (mailto, itms-apps) pass. React Native's IntentModule uses `Uri.parse`, not `Intent.parseUri`, so `intent://...#Intent;...;end` does NOT launch third-party activities with extras. Re-entry into ZEUS's own schemes gains nothing beyond the exported, BROWSABLE deep-link filters any app can already fire (handleAnything flows still require user confirmation).

The realistic impact is therefore an open redirect / phishing primitive inside a trusted-looking payment receipt: the user who just paid user@provider sees a 'Serviced by: provider' panel with an attacker-chosen description and link to an arbitrary host (e.g. a fake 'payment failed, retry here' or 'verify your wallet' page) and is taken there on a single tap with no leave-app prompt. The URL text is rendered, but inside a 15%-screen-height scroll view where a long description can push it out of view. The link persists in payment history.

## Evidence
1. [views/LnurlPay/Success.tsx:27–43](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LnurlPay/Success.tsx#L27-L43)
   URLClicked passes successAction.url verbatim to Linking.canOpenURL/openURL; no host binding to the callback domain, no scheme allow-list, no ExternalLinkModal confirmation.
2. [views/LnurlPay/LnurlPay.tsx:390–392](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LnurlPay/LnurlPay.tsx#L390-L392)
   successAction is taken from the LNURL callback response JSON with no validation of tag, url scheme or domain before it is kept.
3. [stores/LnurlPayStore.ts:83–99](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/LnurlPayStore.ts#L83-L99)
   The unvalidated successAction is persisted under the payment hash and re-rendered from history (Payment.tsx -> Historical.tsx), so the link stays tappable after the fact.
4. [views/LnurlPay/Success.tsx:72–92](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/LnurlPay/Success.tsx#L72-L92)
   The tappable element shows the service-controlled description and url, directly above the 'Serviced by: <callback domain>' line that lends it the provider's branding.
5. [utils/UrlUtils.ts:199–221](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/utils/UrlUtils.ts#L199-L221)
   The app's shipped control for outbound links (goToUrl -> ExternalLinkModal -> leaveZeus) that Success.tsx bypasses by calling Linking.openURL directly.
6. [android/app/src/main/AndroidManifest.xml:14–27](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/android/app/src/main/AndroidManifest.xml#L14-L27)
   <queries> declares only http/https VIEW intents, so on Android 11+ canOpenURL resolves http(s) to any host plus ZEUS's own schemes; this bounds the reachable scheme set to an open redirect rather than arbitrary intent launch.

## Impact
The service can send the user, from inside a payment receipt branded with the provider's domain, to an arbitrary web destination (phishing for seeds/credentials or a fake retry-payment page). The wallet discloses nothing itself and no funds move without further confirmation in the app, so integrity impact is low and confidentiality/availability none.

## Reproduction steps
1. Attacker operates or has compromised the LNURL-pay service or lightning-address host the user pays, or is a tenant of a shared provider that forwards a per-paylink success URL. Its callback response carries successAction {tag:'url', description, url}; after a successful payment the receipt shows the attacker's text under the provider's domain and one tap opens the arbitrary http(s) destination with no leave-app prompt. Default configuration; no shipped control is evaded other than the one this path never invokes. Assumes react-native 0.87.1 IntentModule semantics (Uri.parse + resolveActivity).

## Recommended fix
The url successAction is accepted, stored and opened without binding its host to the LNURL callback domain (LUD-09) and without the scheme allow-list and leave-app confirmation the app applies to every other outbound link. Fix criteria: Before storage, drop or render as inert text any url successAction whose scheme is not http(s) or whose host does not equal the callback domain; open the remaining links through UrlUtils.goToUrl so the ExternalLinkModal confirmation applies. Verify that a successAction url of https://other.example and of lightning:... are not opened on tap and that a same-domain https link prompts the leave-app modal.

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
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258011

---

# Provider-reported 'transaction.claimed' status accepted unverified, permanently hiding submarine refund path

## Details
For submarine (on-chain -> Lightning) swaps, whether the user is ever offered the in-app refund of their locked on-chain funds is decided entirely by status strings the swap provider sends over its websocket (SwapDetails.tsx:320-333) and status poll (SwapStore.ts:1088-1097), persisted verbatim by updateSwapStatus (SwapStore.ts:1145-1178). `showRefundButton` (SwapDetails.tsx:1011-1017) requires both a provider failure status and a fetched `lockupTransaction`, and the lockup transaction is only fetched when the provider reports a failure status (SwapDetails.tsx:378-395). Nothing cross-checks a success status against local truth: the app could look up settlement of the swap invoice on the user's own node by payment hash (when the invoice is the node's own) or require a preimage matching the invoice hash, and it already computes timeoutBlockHeight vs the node's current block height (SwapDetails.tsx:952-966) but uses that only to draw a lock indicator, never to enable the refund.

Attack: after the user has broadcast the lockup payment, a malicious or compromised provider emits `transaction.claimed` without paying the invoice. SwapDetails closes the socket (406-412), the status is stored, and on every later open the swap is treated as final with no socket and no lockup fetch (118-141); the list and detail screens colour it green/success (SwapStore.ts:302-306); fetchAndUpdateSwaps skips it forever (SwapStore.ts:1063-1080); and the refund button is never shown, including after the CLTV timeout when the user may refund unilaterally. The rescue flow does not recover: getRescuableSwaps keeps the existing stored entry (SwapStore.ts:1552-1560), and a fresh rescue takes `status` from the host's /swap/restore response anyway (RESCUE_SWAP_FIELDS, SwapStore.ts:86). The same root cause lets a provider that simply stalls at `transaction.confirmed` withhold the refund path, but the false `transaction.claimed` is the worst case because it also produces a false success record and permanently stops polling. The creation flow accepts any pasted BOLT11 (views/Swaps/index.tsx:198-205), so when the invoice belongs to a third party the user has no local signal that it went unpaid other than the app's status.

The provider cannot spend the correctly-scripted lockup without the invoice preimage, so this is griefing plus a false success state rather than theft: the user's funds stay locked until recovered with the rescue mnemonic through external tooling. The reverse direction is not similarly exposed: a false `invoice.settled` has no fund consequence because the provider cannot settle the hold invoice without the user's preimage.

## Evidence
1. [views/Swaps/SwapDetails.tsx:1011–1017](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L1011-L1017)
   showRefundButton requires swapData.lockupTransaction AND a provider failure status (invoice.failedToPay, transaction.lockupFailed, swap.expired, or a failureReason error). A provider status of transaction.claimed satisfies neither, so the refund path is never offered regardless of on-chain state or timeout.
2. [views/Swaps/SwapDetails.tsx:118–141](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L118-L141)
   On mount, a submarine swap whose stored status is transaction.claimed or transaction.refunded is treated as final: no websocket is opened, no lockup transaction is fetched, and only the stored status is displayed. The status originated from the provider via updateSwapStatus/fetchAndUpdateSwaps.
3. [views/Swaps/SwapDetails.tsx:320–333](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L320-L333)
   Every websocket update's data.status is set in state and written to storage unconditionally, with no check against the local node's settlement state of the swap invoice or a preimage matching its payment hash.
4. [views/Swaps/SwapDetails.tsx:378–412](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L378-L412)
   The lockup transaction needed for a refund is fetched only when the provider reports a failure status; on transaction.claimed the socket is closed and nothing is fetched or verified.
5. [stores/SwapStore.ts:1060–1103](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L1060-L1103)
   fetchAndUpdateSwaps copies result.status from the provider's GET /swap/{id} verbatim into the stored swap and skips any submarine swap already marked transaction.claimed, so a false final status is never revisited.
6. [stores/SwapStore.ts:1144–1177](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L1144-L1177)
   updateSwapStatus persists the provider status string verbatim.
7. [views/Swaps/SwapDetails.tsx:952–966](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/views/Swaps/SwapDetails.tsx#L952-L966)
   timelockIndicator already compares swapData.timeoutBlockHeight to the node's currentBlockHeight — the local fact that would establish refund eligibility — but uses it only to render a lock emoji, not to gate the refund path.
8. [stores/SwapStore.ts:86](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L86)
   RESCUE_SWAP_FIELDS includes 'status', so even a fresh rescue via /swap/restore takes the swap's status from the host; the rescue flow offers no provider-independent recovery.
9. [stores/SwapStore.ts:302–306](https://github.com/Halbarevi/zeus/blob/e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2/stores/SwapStore.ts#L302-L306)
   statusColor renders transaction.claimed green, so the unverified status is displayed to the user as a successful swap in the list and detail screens.

## Impact
Integrity: the app records and displays a successful swap that did not happen — a false payment confirmation, which SECURITY.md lists in scope and the threat model names as an asset (report payment state truthfully). Availability: the user's on-chain funds remain locked and the in-app refund function is permanently withheld even after the timeout; recovery requires the rescue mnemonic and external tooling. Funds are not stolen because the lockup script still requires the invoice preimage, so both impacts are rated LOW.

## Reproduction steps
1. Attacker is the swap provider (the default third-party host or any custom host the user configured), a third-party server the threat model names as an adversary whose responses are untrusted data. Once the user has broadcast the lockup payment for a submarine swap, the provider sends a single websocket update or poll response with status transaction.claimed. No local check exists (SwapDetails.tsx:320-333, SwapStore.ts:1096); the status is persisted and treated as final on every subsequent open. The only user action required is performing a submarine swap with that provider, which is the ordinary use of the feature.

## Recommended fix
1. Success and final statuses from the provider are persisted and used to gate recovery UI without any local confirmation (e.g. the local node's settlement state of the swap invoice, or on-chain state of the lockup output). Fix criteria: A submarine swap must only be treated as successfully completed when the app has confirmed locally that the swap invoice is settled (lookup by payment hash on the user's node when the invoice is the node's own, or the preimage received from the provider hashes to the invoice's payment hash). Otherwise the swap remains open: polling continues, the lockup transaction is fetched, and the refund option is offered whenever the lockup output is unspent and the timeout has passed, independent of the provider's reported status. Verify by feeding a transaction.claimed update for an unpaid invoice and confirming the refund button still appears after the timeout.
2. The refund screen's prerequisites (lockupTransaction, failure status) are derived solely from provider-driven state. Fix criteria: The refund path must be reachable for any stored submarine swap whose lockup output is unspent on the user's explorer and whose timeout has passed, regardless of the provider status string, and the lockup transaction should be fetchable on demand (from the explorer by lockup address, not only from the provider).

---
**Severity:** LOW
**Status:** Open
**Category:** Reliance on untrusted inputs
**CWE:** [CWE-807](https://cwe.mitre.org/data/definitions/807.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/zeus
**Branch:** main
**Commit:** e20a5cee5fd28915c9a1b8f57f33aedb7ae335d2
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01BVKD9mvCXXbyKuokKEzhuo&finding=scan_019DJq4vCaLiYgnNoyuXFGD1-5258006