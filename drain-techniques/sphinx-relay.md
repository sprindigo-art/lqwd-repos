# Release workflows execute unpinned third-party action with Docker Hub release credential in scope

## Details
Both tag-triggered release workflows (.github/workflows/docker-build.yml and docker-swarm-build.yml) execute `crazy-max/ghaction-docker-buildx@v1`, a third-party action referenced only by a mutable major tag and resolved at run time, inside the job that holds the Docker Hub release credential. The step before it (`docker login` with secrets.DOCKER_PASSWORD, line 26) has already written that credential, base64-encoded, to ~/.docker/config.json on the ubuntu-20.04 runner, so the action's code can read it directly; independently of ordering, any action in the job can write $GITHUB_PATH / $GITHUB_ENV to interpose on the later `docker buildx build --output type=registry` steps. If the `v1` tag is moved or the publishing account is compromised (the pattern of the tj-actions/changed-files incident), the code it serves runs at the next sphinx-relay tag push and can exfiltrate the registry credential, push arbitrary images to `sphinxlightning/sphinx-relay:latest` and `sphinx-relay-swarm:latest`, or alter the build inputs on the runner so the legitimately pushed image carries injected code. docs/docker_deployment.md:95 tells operators to deploy `sphinxlightning/sphinx-relay:latest` alongside their LND node with the admin macaroon mounted, so a tampered image executes with spending authority over users' funds. The action is deprecated upstream in favour of docker/setup-buildx-action (its archived status is recalled, not verified from this checkout), so it will not be re-pinned or maintained by its author.

Secondarily, the PR workflows (integration_test.yml, cln_proxy_integration_test.yml) consume `canastro/copy-file-action@master` and `jakejarvis/wait-action@master`, branch refs whose content changes with every upstream commit. These jobs carry no repository secrets and fork PRs get a read-only GITHUB_TOKEN; for PRs from branches of stakwork/sphinx-relay the token is persisted in relay/.git/config by actions/checkout@v2 with the repository's default permissions, which this tree does not set (`permissions:` appears in no workflow). If those defaults are write, a compromised action can push to master, where the committed dist/ is what the Dockerfile ships at the next human-made release tag. GITHUB_TOKEN-initiated pushes do not trigger further workflows, so the PR path cannot by itself fire the release jobs.

The release pipeline is the asset the threat model lists under 'Supply chain / release'; its integrity rests on external GitHub accounts whose code is fetched unpinned at run time. Assumptions: GitHub Actions resolves `uses: owner/repo@ref` at run time and tags/branches are mutable; `docker login` on the GitHub-hosted ubuntu-20.04 image stores credentials unencrypted in ~/.docker/config.json; actions/checkout@v2 defaults to persist-credentials: true.

## Evidence
1. [.github/workflows/docker-build.yml:29–34](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/docker-build.yml#L29-L34)
   Tag-triggered release job executes `crazy-max/ghaction-docker-buildx@v1`, a third-party action referenced by a mutable tag and resolved at run time; whatever code the tag points to when a release is cut runs on the runner. The action also fetches `buildx-version: latest` / `qemu-version: latest` at run time.
2. [.github/workflows/docker-build.yml:25–26](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/docker-build.yml#L25-L26)
   `docker login` with secrets.DOCKER_PASSWORD runs before the third-party action; on the ubuntu-20.04 runner (no credential helper) the credential is stored base64-encoded in ~/.docker/config.json, so the action's code can read it directly. Even if login were moved later, an action in the same job can prepend $GITHUB_PATH / write $GITHUB_ENV to hijack the later `docker buildx build --output type=registry` steps (lines 49-64) that push sphinxlightning/sphinx-relay:<tag> and :latest.
3. [.github/workflows/docker-swarm-build.yml:25–34](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/docker-swarm-build.yml#L25-L34)
   Identical sequence (login, then `crazy-max/ghaction-docker-buildx@v1`) in the job that pushes sphinxlightning/sphinx-relay-swarm:<tag> and :latest.
4. [docs/docker\_deployment.md:95](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/docs/docker_deployment.md#L95)
   Operators are instructed to deploy `image: sphinxlightning/sphinx-relay:latest` — the exact tag the release workflow pushes — with the LND node and macaroon mounted, so a tampered image is executed on users' nodes.
5. [.github/workflows/integration\_test.yml:99–106](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/integration_test.yml#L99-L106)
   PR workflows run `canastro/copy-file-action@master` and `jakejarvis/wait-action@master` (branch refs). No repository secrets are in these jobs and fork PRs receive a read-only GITHUB_TOKEN, but for PRs from branches of the main repository the token is persisted in relay/.git/config by `actions/checkout@v2` (persist-credentials default true) with the repository's default permissions; if those are write (repository setting not visible in this tree) a compromised action can push to master (whose committed dist/ the Dockerfile ships). GITHUB_TOKEN-initiated pushes do not themselves trigger workflows.
6. [.github/workflows/cln\_proxy\_integration\_test.yml:98–105](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/cln_proxy_integration_test.yml#L98-L105)
   Same two @master actions in the CLN integration workflow, same conditions.

## Impact
The release pipeline's Docker Hub credential is disclosed (C:H) and arbitrary images can be published under the official sphinxlightning/sphinx-relay and sphinx-relay-swarm names, or the in-progress build tampered — complete loss of integrity of the released artifact (I:H). The runner job can also be made to fail or stall (A:L). Subsequent-system impact: docs/docker_deployment.md:95 instructs operators to run `sphinxlightning/sphinx-relay:latest` next to their LND node with the admin macaroon mounted; an attacker-published image therefore executes on users' nodes with full read/write of relay data and spending authority over Lightning funds, and can take the relay down.

## Reproduction steps
1. Attacker: whoever controls or compromises the GitHub repository/tag of crazy-max/ghaction-docker-buildx (release path), or of canastro/copy-file-action / jakejarvis/wait-action (PR path). They publish code behind the mutable ref over the network; the next sphinx-relay tag push fetches and executes it with the Docker Hub credential already on disk and the push steps still to run. No privileges on sphinx-relay and no user interaction are needed; the attack requirement is control of the upstream action (AT:PRESENT). The position is external to this system and the project does not concede it registry push authority.

## Recommended fix
1. Third-party actions are referenced by mutable tags/branches and resolved at run time, so the code executed in the release job (and PR jobs) is whatever the external account currently serves. Fix criteria: Every non-GitHub-owned action in .github/workflows is pinned to a full commit SHA (with the version in a comment), and the deprecated crazy-max/ghaction-docker-buildx is replaced by the maintained docker/setup-buildx-action, also SHA-pinned. Verify that moving the upstream tag or branch cannot change the code the workflows execute.
2. The Docker Hub credential is materialised on the runner before any third-party code runs and the push steps follow, so compromised setup code can read the credential or interpose on the push. Fix criteria: Registry login occurs only after all third-party setup steps, immediately before the push (or via a SHA-pinned docker/login-action), and the credential is scoped to a Docker Hub access token limited to the two repositories. Verify that no step preceding login can read ~/.docker/config.json.
3. PR workflows run @master actions with a GITHUB_TOKEN persisted in the checkout and inheriting the repository's default permissions. Fix criteria: PR workflows declare `permissions: contents: read` and their checkouts set `persist-credentials: false`, in addition to SHA-pinning the actions. Verify that a PR job's token cannot push to any branch or tag.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Supply chain integrity
**CWE:** [CWE-829](https://cwe.mitre.org/data/definitions/829.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258182

---

# Unknown sender pubkey skips tribe owner's membership and private-approval gates

## Details
The tribe owner's relay is the only place where tribe access control is enforced (members accept whatever the owner forwards). In onReceive (src/network/receive.ts) the two gates that protect a tribe from outsiders are both written as `if (<condition> && senderContactId)`, i.e. they are evaluated only when the claimed sender pubkey already resolves to a Contact of the owner:

1. Membership (165-172): for message, attachment, boost and direct_payment the ChatMember lookup is skipped for unknown pubkeys; only `amount < pricePerMessage` (175) can still block, which is 0 for free tribes. A node that has never joined can therefore post into any tribe: the owner forwards the post to all members (forwardMessageToTribe) and stores it locally (receiveMessage with synthetic sender id 0, surfaced in the owner's client with the attacker-chosen alias and photo).

2. Private-tribe approval (192-209): for group_join the `status === approved` check is skipped for unknown pubkeys. The intended flow for private tribes is member_request (creates Contact + pending ChatMember) followed by owner approval; a stranger who skips member_request has no Contact, so a direct group_join with chat.members[<pubkey>].key set passes (if amount >= priceToJoin), is broadcast as a join, and receiveGroupJoin/addMemberToTribe creates the Contact, upserts a ChatMember with status approved, adds the attacker to chat.contactIds and replays the last 40 messages to them. The attacker is now a fully approved member of a private tribe without the owner ever approving, and receives all future broadcasts.

The unknown-pubkey condition is trivially met: any fresh Lightning node identity, or, since signatures are not enforced (inbound-payload-signature-verification-result-ignored), any pubkey string that is not yet a contact. Note this is independent of the signature defect: with signatures enforced, a fresh node key still has no Contact row.

Related records: tribe-delete-message-no-sender-authorization covers the identical `&& senderContactId` pattern on the delete gate (212-224); group-join-unauthenticated-self-insertion covers non-tribe groups and member relays and explicitly treats the owner-side private check as present. This record is the owner-side bypass of the membership and private-approval gates that neither covers.

## Evidence
1. [src/network/receive.ts:165–172](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L165-L172)
   The ChatMember membership check for message/attachment/boost/direct_payment runs only `if (needsPricePerMessage && senderContactId)`; a sender pubkey with no Contact row yields senderContactId undefined and the check is skipped, leaving doAction true.
2. [src/network/receive.ts:192–210](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L192-L210)
   For group_join on a private tribe the approved-status check runs only `if (chat.private && senderContactId)`; an unknown pubkey bypasses it, so only priceToJoin (0 for free tribes) gates the join.
3. [src/network/receive.ts:306–313](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L306-L313)
   With doAction still true the owner forwards the stranger's message/join to every member over MQTT (forwardMessageToTribe) and runs the local handler via doTheAction (354).
4. [src/controllers/chats.ts:616–659](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L616-L659)
   receiveGroupJoin -> addMemberToTribe creates the Contact from the payload's chat.members[pubkey].key and, because isTribeOwner, upserts a ChatMember with status approved and replays chat history to the new member; the private tribe's approval workflow (member_request -> owner approves) is never consulted.
5. [src/helpers.ts:320–332](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L320-L332)
   For tribe payloads parseReceiveParams synthesises sender={id:0, alias} for unknown pubkeys so receiveMessage stores and surfaces the stranger's message instead of rejecting it.
6. [src/controllers/chatTribes.ts:239–311](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L239-L311)
   The intended private-tribe flow: receiveMemberRequest creates the Contact and upserts a ChatMember with status pending (302-311); approveOrRejectMember then flips it to approved and sends member_approve, after which the member relay sends group_join. A stranger who never sent member_request has no Contact and therefore no pending record for the owner-side gate to check.

## Impact
Confidentiality: unapproved entry into private tribes yields the history replay and all subsequent member traffic. Integrity: non-members can post into tribes as any alias and the owner forwards it to everyone, and ChatMember/contactIds records are created without authorization. No availability impact.

## Reproduction steps
1. Attacker: any Lightning node with a pubkey not yet in the victim owner's contacts (a fresh node suffices). Private tribe: keysend {type:14, chat:{uuid:<tribe>, type:2, members:{<pk>:{key:<rsa>, alias}}}, sender:{pub_key:<pk>}} with amount >= price_to_join; owner approves implicitly and replays history. Public/free tribe: keysend {type:0, ...} to post without joining. Tribe uuids and prices are public on the tribe server. No interaction, deterministic.

## Recommended fix
The tribe owner's membership and private-approval checks are conditioned on the sender already being a Contact, so an unknown pubkey is treated as more trusted than a known one. Fix criteria: For tribe-owner processing, a sender with no Contact or no approved ChatMember is rejected for member-only types, and group_join on a private tribe is accepted only when an approved ChatMember (created by the member_request/approve flow) exists for that pubkey. Verify by sending a message or group_join from a fresh pubkey to a private tribe and confirming it is neither forwarded, stored, nor results in a Contact/ChatMember row.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Incorrect authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257987

---

# Tribe-owner relay signs attacker-chosen challenge and sends authenticated requests to the host named in a peer-supplied media token

## Details
When a relay that owns a tribe receives an attachment from a member (receive.ts:137-172 -> forwardMessageToTribe -> modifyPayloadAndSaveMediaKey) or a `purchase_accept` naming one of its tribes with `purchaser` != tenant (receive.ts:342-349 -> sendFinalMemeIfFirstPurchaser), `downloadAndUploadAndSaveReturningTermsAndKey` (src/network/modify.ts:243-256) parses the peer's `mediaToken` with parseLDAT and uses its first base64 segment, `terms.host`, as the media server. The only check is `if (!terms.host) return`; nothing compares it to `config.media_host` and the LDAT signature is never verified.

`meme.lazyToken(ownerPubkey, terms.host)` -> `getMediaToken` (src/utils/meme.ts:47-78) then runs the meme login protocol against that host: GET `<host>/ask`, take `r.challenge` from the response, `Lightning.signBuffer(Buffer.from(r.challenge,'base64'), ownerPubkey)` and POST `{id, sig, pubkey}` to `<host>/verify`. `signBuffer` (src/grpc/lightning.ts:736-767) is LND `signMessage` (or Greenlight libhsmd) with the node identity key and no domain separation, so an attacker-controlled host receives a node-key signature over bytes of its choosing. The same primitive produces `genSignedTimestamp` (src/utils/tribes.ts:732-766: sig over the raw 4-byte unix timestamp, format shown by verifySignedTimestamp at 768-778), which is the Bearer token for tribe-server edit/delete/channel calls (tribes.ts:528,573,615,644,676,709,905) and the MQTT password for username = owner pubkey (tribes.ts:112-125); it also signs LDAT media tokens (ldat.ts:51) and outbound message bodies (lightning.ts:600-606). A challenge equal to base64(current ts bytes) therefore yields a valid tribe-server/MQTT credential for the victim owner; relaying the real meme server's `/ask` challenge yields the owner's meme token.

Independently the relay issues GET `<host>/ask`, GET `<host>/file/<mt>` with a Bearer token and a multipart POST `<host>/file` (modify.ts:253-255, 278-285) to the attacker-chosen host; the host string is concatenated raw (port, userinfo, path allowed) and the scheme drops to plain http for any host containing `localhost` or `meme.sphinx` (modify.ts:250-252, e.g. `meme.sphinx.attacker.tld`).

Reachability: entry 1 requires the sender to have a Contact and a ChatMember row for the tribe (receive.ts:146-171; status is not checked); both are created automatically by the owner relay on a public-tribe group_join (chatTribes.ts:267-310). Entry 2 requires no relationship at all: sendFinalMemeIfFirstPurchaser reaches the download (modify.ts:193) before `sender` is dereferenced, needing only a tribe uuid owned by the relay (public on the tribe server), a `purchaser` equal to any existing contact id other than the owner's, a mediaKey of any value and a muid with no MediaKey row. getMediaToken failures are caught, so the oracle can be repeated with a new host string each time (lazyToken caches per exact host).

Assumptions: LND `lnrpc.SignMessage` signs double-SHA256('Lightning Signed Message:' || msg) with the node identity key and `VerifyMessage` recovers it (the relay's own verifySignedTimestamp relies on this); acceptance of the forged token by tribes.sphinx.chat / memes.sphinx.chat is external to this repository.

## Evidence
1. [src/network/modify.ts:243–255](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/modify.ts#L243-L255)
   downloadAndUploadAndSaveReturningTermsAndKey parses the peer-authored mediaToken, takes terms.host from its first segment with only a non-empty check, passes it to meme.lazyToken (node-key challenge signing) and fetches `${protocol}://${terms.host}/file/${mt}` with the Bearer token; protocol becomes http for any host containing 'localhost' or 'meme.sphinx'. This is the code the fix must change.
2. [src/utils/meme.ts:47–78](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/meme.ts#L47-L78)
   getMediaToken GETs `${host}/ask`, decodes r.challenge from the attacker's response, signs those raw bytes with Lightning.signBuffer (node identity key) and POSTs the signature plus owner pubkey to `${host}/verify`: a signature oracle over arbitrary bytes for whoever controls host.
3. [src/network/receive.ts:342–351](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L342-L351)
   Entry point 2: inside the isTribeOwner branch, any purchase_accept whose purchaser != tenant is routed to sendFinalMemeIfFirstPurchaser with senderContact possibly null; no contact or membership check precedes it.
4. [src/network/modify.ts:149–199](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/modify.ts#L149-L199)
   sendFinalMemeIfFirstPurchaser needs only a non-empty mediaToken/purchaser, a muid with no MediaKey row and an existing contact id for purchaser, then calls downloadAndUploadAndSaveReturningTermsAndKey (line 193) before `sender` is ever dereferenced, so the oracle fires for a sender who is not a contact.
5. [src/network/receive.ts:137–171](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L137-L171)
   Entry point 1 gating: for an attachment in a tribe this relay owns, the sender must resolve to a Contact and have a ChatMember row (status not checked) and pay pricePerMessage; then forwardMessageToTribe (443-470) calls modifyPayloadAndSaveMediaKey for the attachment type.
6. [src/controllers/chatTribes.ts:267–310](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L267-L310)
   addMemberToTribe, run by the owner relay on an inbound group_join, creates the Contact row for the joining pubkey and upserts its ChatMember row with no owner interaction, so any Lightning node can self-register into the position entry point 1 requires on a public tribe.
7. [src/network/modify.ts:271–285](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/modify.ts#L271-L285)
   The relay also POSTs a multipart body with the Bearer token to `${protocol}://${terms.host}/file`: an authenticated POST SSRF primitive to the attacker-chosen host.
8. [src/utils/tribes.ts:732–778](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L732-L778)
   genSignedTimestamp = urlBase64(ts4bytes || signBuffer(ts4bytes)) and verifySignedTimestamp shows the accepted format; the same signBuffer primitive signed the attacker's challenge, so a challenge equal to base64(current ts bytes) yields a valid tribe-server Bearer token and MQTT password (used at 112-125, 528, 573, 615, 644, 676, 709, 905) for the victim owner's pubkey.
9. [src/grpc/lightning.ts:736–767](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L736-L767)
   signBuffer is the single node-identity-key signing primitive (LND signMessage or Greenlight libhsmd) with no purpose prefix, shared by meme login, genSignedTimestamp, LDAT tokenFromTerms and signAscii, so a signature obtained through one protocol is a credential in the others.

## Impact
The relay yields node-identity-key signatures over attacker-chosen bytes; that signature is the relay's only credential toward the tribe server, the MQTT broker and the meme server and signs its LDATs, so the owner's identity toward those services can be forged (integrity high). Blind authenticated GET/POST SSRF to an arbitrary host, with the per-host meme token and a re-encrypted media blob, leaks little beyond the owner pubkey (confidentiality low); no availability impact on the relay itself. Subsequent-system impact: With a forged signed timestamp the attacker authenticates to tribes.sphinx.chat and the MQTT broker as the owner: edit or delete the owner's tribes and channels and publish payloads on member topics as the owner (relays do not enforce payload signatures on receipt, receive.ts:578-581). Relaying the real meme server's challenge yields the owner's meme token to list, upload or delete the owner's (client-encrypted) media. Acceptance by those external services is assumed, not verified in this repository.

## Reproduction steps
1. Attacker runs a small HTTP(S) server and sends one keysend to the victim relay's node: either an attachment as a member of a public tribe the relay owns (membership is self-service: group_join creates the Contact and ChatMember rows, chatTribes.ts:267-310) or a purchase_accept naming an owned tribe uuid (public on the tribe server) with purchaser set to a guessable contact id, needing no prior relationship (receive.ts:342-349, modify.ts:193). The mediaToken's first segment is base64 of the attacker's host. The relay connects, asks for a challenge, signs the attacker's bytes with its node key and posts the signature back. No allowlist, signature check or owner interaction intervenes; default configuration.

## Recommended fix
1. The media server host used for authentication and file transfer is taken from a peer-authored LDAT (modify.ts:243-246, also ml.ts:331-334) instead of trusted configuration, turning the meme login flow into a node-key signing oracle and the fetch/upload into SSRF. Fix criteria: The relay must only authenticate to and transfer media with hosts it trusts (the configured media_host or an explicit allowlist) and must not downgrade to plain http on substring matches; a token naming any other host must be rejected before any network request or signBuffer call. Verify that an attachment or purchase_accept whose token host is attacker-controlled produces no outbound request and no signature.
2. One undifferentiated node-key signMessage primitive serves meme login (server-chosen challenge), tribe-server/MQTT auth (raw 4-byte timestamp), LDATs and message signatures, so a signature obtained in one protocol is a valid credential in another. Fix criteria: Domain-separate signed material per purpose (distinct prefixes or structured payloads) and never sign raw server-supplied bytes; verify that a signature over an arbitrary challenge cannot be presented as a signed timestamp or LDAT.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Server-Side Request Forgery
**CWE:** [CWE-918](https://cwe.mitre.org/data/definitions/918.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257979

---

# Inbound payload signature verification result discarded; sender pubkey never bound to signature

## Details
Every message Sphinx relays exchange over Lightning keysend TLVs, over the tribe MQTT broker and via the proxy co-tenant shortcut is a JSON payload followed by a node signature (src/network/send.ts:333-337, signAndSend signs with the node key and appends the signature). The receive side, parseAndVerifyPayload (src/network/receive.ts:562-591), is the single gate for all three ingress paths (parseKeysendInvoice 712/718, receiveMqttMessage 523, receiveCoTenantMessage 541) and is meant to establish that payload.sender.pub_key authored the message. It does not: after computing the verification result it returns the payload whether v.valid is true, false, or verification threw (`return payload // => RM THIS` on lines 581 and 588); when the trailing signature is neither 96 nor 104 characters (including absent) v is undefined and the else branch at 581 still returns the payload. The only condition that rejects a payload is a missing sender.pub_key (584-585). Independently, for 104-character zbase32 signatures the code calls Lightning.verifyAscii(msg, sig) without the claimed pubkey; verifyMessage (src/grpc/lightning.ts:782-843) returns {valid, pubkey} — on Greenlight it resolves valid:true unconditionally with the recovered key (818-821), on LND it returns LND's result (824-837) — and the caller never compares v.pubkey with payload.sender.pub_key, so even a real signature by the attacker's own node would authenticate a payload claiming any other sender.

Consequence: the sender identity of every inbound message is attacker-chosen. Any Lightning node that can keysend this node (adversary 2), and anyone the broker lets publish under the owner's MQTT prefix (adversary 3), can set sender.pub_key to (a) any of the owner's contacts for direct-message types (receiveContactKey replaces the contact's RSA key; messages/attachments/payments appear from the trusted contact), (b) any approved tribe member when talking to the tribe owner (onReceive resolves senderContact solely from payload.sender.pub_key at 146-148 and keys the ChatMember membership check 167-172, private-join approval 196-209, delete ownership 212-224, reputation/totalSpent 262-298 and uniqueifyAlias 393-441 on it), and (c) the tribe owner when talking to members. helpers.ts parseReceiveParams (254) hands dat.sender.pub_key to every ACTIONS handler as the authenticated peer identity.

This is the root cause shared by the dependent records on file (bot-res-*, group-join-*, tribe-delete-*, tribe-member-*, receive-contact-key-*, mqtt-heartbeat-*, etc.), which cite lines 578-591 as context; none records the defect at its own location. Fixing those handlers individually does not restore the protocol's identity guarantee; this record does.

The disabled check ships: the committed build dist/src/network/receive.js lines 531-545 carries the same `return payload; // => RM THIS` branches and is what the Docker image (CMD node /relay/dist/app.js) and `npm run prod` execute.

## Evidence
1. [src/network/receive.ts:562–591](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L562-L591)
   parseAndVerifyPayload computes v = verifyAscii(...) but returns the parsed payload on every branch: when v.valid is false or v is undefined because the trailing signature is neither 96 nor 104 chars ('return payload // => RM THIS', line 581) and when verification throws (line 588). The only rejection is a missing sender.pub_key (584-585). The function is the sole gate for keysend (712/718), MQTT (523) and co-tenant (541) ingress.
2. [src/network/receive.ts:572–577](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L572-L577)
   For 104-char zbase32 signatures the code calls Lightning.verifyAscii(msg, sig) without the claimed pubkey and only tests v.valid; the recovered v.pubkey is never compared with payload.sender.pub_key, so even if the early return were removed a valid signature from node A would authenticate a payload claiming any sender.
3. [src/grpc/lightning.ts:782–851](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L782-L851)
   verifyMessage/verifyAscii return {valid, pubkey}. On Greenlight (791-821) the function resolves valid:true unconditionally with the secp256k1-recovered key; on LND/proxy (822-837) it returns LND's VerifyMessage result, where valid only means the recovered key is some node known to the graph. Binding to the claimed sender must happen in the caller and does not.
4. [src/network/receive.ts:146–148](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L146-L148)
   onReceive resolves the sender Contact solely from the unauthenticated payload.sender.pub_key; every downstream authorization (membership 167-172, private-join approval 196-209, delete ownership 212-224, reputation/totalSpent 262-298, alias uniqueness 393-441) keys on that identity.
5. [src/helpers.ts:254–255](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L254-L255)
   parseReceiveParams derives sender_pub_key from the payload for every ACTIONS handler; all controllers treat it as the authenticated peer identity.
6. [src/network/send.ts:333–337](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L333-L337)
   Outbound side: every payload is signed with the node key (LND.signAscii, line 336) and the signature appended (337), showing the protocol intends signature-bound sender identity that the receive side does not enforce.
7. [src/network/receive.ts:709–726](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L709-L726)
   Keysend ingress: parseKeysendInvoice, driven by lndService.subscribeInvoices for every settled keysend from any Lightning node, hands the TLV payload to parseAndVerifyPayload and dispatches whatever it returns to onReceive.

## Impact
Confidentiality: impersonating a contact lets the attacker substitute the contact's RSA key (receiveContactKey) so the owner's client encrypts future DM content and media keys to the attacker, and impersonating an approved member admits the attacker to private tribe traffic. Integrity: every inbound authorization decision (membership, delete ownership, approvals, kicks, bot actions, reputation/leaderboard counters) keys on the forged identity, and forged messages are stored and shown as from trusted parties. Availability not directly affected.

## Reproduction steps
1. Attacker is any Lightning node (or MQTT publisher under the owner's topic) able to reach the victim's node — the relay's purpose. They craft JSON with sender.pub_key set to the identity they wish to assume (a contact, an approved tribe member, or the tribe owner), append nothing, any string, or a signature by their own node as the trailing 'signature', and keysend it (min_sat, a few sats) to the victim. parseAndVerifyPayload returns the payload regardless of the verification outcome; onReceive and all ACTIONS handlers then treat the forged identity as authenticated. Contact pubkeys are public node ids and tribe uuids are listed on the tribe server, so no secret is needed. No credentials, no user interaction, deterministic. Assumption (not verifiable in this checkout): LND's VerifyMessage RPC, reached via @grpc/grpc-js 1.8.7, returns valid=true for any signature whose recovered key is a node in the channel graph and reports that key in res.pubkey; the finding does not depend on this since the result is discarded in every case.

## Recommended fix
1. parseAndVerifyPayload returns the payload when the signature is invalid, malformed, absent, or when verification throws, so sender.pub_key is never authenticated. Fix criteria: A payload is dispatched to onReceive only when a signature is present, verifies, and the verification is positively tied to the claimed sender; invalid, missing or unverifiable signatures cause the payload to be dropped (logged). Verify by sending a payload with a forged sender.pub_key and a bogus or absent signature over keysend and MQTT and observing that no Contact lookup, DB write, forward or ACTIONS call occurs.
2. For LND-style signatures the recovered pubkey returned by Lightning.verifyAscii is never compared with payload.sender.pub_key, so any valid signature authenticates any claimed sender. Fix criteria: The recovered/verified pubkey must equal payload.sender.pub_key (after normalisation) or the payload is rejected. Verify by signing a payload with node A and setting sender.pub_key to node B: the payload must be dropped.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Improper signature verification
**CWE:** [CWE-347](https://cwe.mitre.org/data/definitions/347.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257974

---

# Peer-planted invoice row hijacks settlement of owner's own invoice: misattribution, suppressed notification, crash

## Details
When a non-keysend invoice settles, `receiveNonKeysend` (src/grpc/regular.ts:34-39) decides how to book the payment by looking up `Message.findOne({ type: invoice, payment_request })`. The lookup has no tenant filter, no sender filter and no check that the row was created by this owner's `createInvoice`. But invoice-type rows are also written by `receiveInvoice` (src/controllers/invoices.ts:290-347) for every type-2 payload any Lightning node sends, with `paymentRequest` taken verbatim from the peer and no check that the bolt11's payee is not the owner. Any node that knows one of the owner's bolt11 strings can therefore plant the row that will be matched when that invoice settles.

The owner's invoices created without a contact or chat (POST /invoices with no contact_id/chat_id, i.e. the app's receive-via-QR flow, and the hub's unauthenticated POST /invoices in HOSTING_PROVIDER mode) store no Message at all (invoices.ts:164-169). For them the planted row is the only match and the hijack is deterministic. For chat invoices the owner's own row exists first; SQLite's LIMIT 1 without ORDER BY returns the lower rowid (the owner's row), while under Postgres the physical order after the confirmation UPDATE of the owner's row is not guaranteed, so the hijack is possible but not deterministic there.

Consequences, all traced:
1. Misattribution. Peer P sends one keysend `{type:2, chat:{uuid:X}, sender:{pub_key:P}, message:{invoice:B}}` where B is the owner's bolt11, then pays B. On settlement the planted row is found; `senderId = contactIds.find(id != P.id)` is the owner's id, so the real incoming payment is stored and pushed to the client as a payment with sender = owner in the chat with P, and the planted 'invoice from P' is marked confirmed. The owner's records show they paid P the amount instead of receiving it.
2. Suppression. The null branch (regular.ts:40-76) never runs: no `invoice_payment` socket event (the client's 'payment received' signal for QR invoices), no chatId-0 incoming payment record and, when HOSTING_PROVIDER=true, no hub `sendInvoice` call (src/hub.ts:242-251), so the hub is never told the invoice it created was paid. What the hub does with that notification is outside this repository; the effect here is that the only settlement callback is lost.
3. Crash. If P claims the owner's own pubkey as `sender.pub_key` (signatures are not enforced, receive.ts:578-589), parseReceiveParams resolves the owner's own contact as sender and creates chat X with contactIds [owner, owner]; the planted row has sender = owner. On settlement `contactIds.find(id != owner)` is undefined, so `Contact.findOne({ where: { id: undefined, tenant } })` rejects (sequelize 5.22.5 rejects undefined where values) or, if it returned null, `sender.alias` at line 121 throws. `receiveNonKeysend` is invoked un-awaited from the LND stream handler (subscribe.ts:37) and no unhandledRejection handler exists, so the node:16 process exits. One crash per settled invoice the attacker knows; in HOSTING_PROVIDER non-proxy mode the attacker can mint unlimited row-less invoices via the unauthenticated POST /invoices (recorded separately) and crash the relay repeatedly for 1 sat each.
4. Cross-tenant (proxy mode). Because the lookup ignores tenant and the subscription is on the root node, a row planted in tenant A for tenant B's bolt11 makes B's settlement be booked in A's tenant (A's client is told the amount and settle time) and B receives nothing.

Root cause: the settlement path trusts a peer-writable table row as the authority for who owns an invoice and how to attribute its payment. The owner's own invoices should be matched only against rows created by the owner (sender = owner, within the payee's tenant), and the chat/sender derivation must not dereference a missing counterpart.

## Evidence
1. [src/grpc/regular.ts:34–39](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/regular.ts#L34-L39)
   receiveNonKeysend selects the Message that 'owns' a settled invoice with Message.findOne({type: invoice, payment_request}) and no tenant filter, no sender filter and no check that the row was created by the owner (createInvoice). A row stored by receiveInvoice from a peer that echoed the owner's own bolt11 satisfies this lookup.
2. [src/grpc/regular.ts:40–75](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/regular.ts#L40-L75)
   The null branch is the only place an invoice created outside a chat (POST /invoices without contact_id/chat_id, or a hub-created invoice in HOSTING_PROVIDER mode) is handled: hub sendInvoice(payReq, amount) when HOSTING_PROVIDER=true, the 'invoice_payment' socket event the client waits on, and a chatId 0 incoming payment record. When a planted row exists this whole branch is skipped.
3. [src/grpc/regular.ts:78–121](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/regular.ts#L78-L121)
   With the planted row the payment is processed in that row's tenant and chat: senderId = contactIds.find(id != invoice.sender). For a row planted by peer P in the DM chat [owner, P] with sender P, senderId is the owner's id, so the real incoming payment is stored and pushed to the client as a payment with sender = owner (an outgoing payment to P) and the planted 'invoice from P' is marked confirmed. If the row was planted with sender.pub_key = the owner's own pubkey, findOrCreateContactByPubkeyAndRouteHint resolves the owner's own contact (publicKey = owner.publicKey, tenant = owner.id) and the chat is [owner, owner]; find() returns undefined, Message.create succeeds (sender is a nullable BIGINT in src/models/sql/message.ts), and Contact.findOne({ where: { id: undefined, tenant } }) rejects under sequelize 5.22.5 (undefined WHERE values are rejected) or, if it resolved null, sender.alias at line 121 throws; either way the promise rejects.
4. [src/controllers/invoices.ts:290–346](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L290-L346)
   receiveInvoice (ACTIONS[2]) stores a type-invoice Message with paymentRequest = dat.message.invoice exactly as supplied by the peer, sender = sender.id, chatId = chat.id, tenant = owner.id. It never checks that the bolt11's payee is not this owner, and parseReceiveParams auto-creates the sender contact and chat for any Lightning node, so any node can plant a row for any bolt11 string it knows.
5. [src/controllers/invoices.ts:164–168](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L164-L168)
   createInvoice returns the bolt11 without storing any Message when no contact_id/chat_id is given (the app's 'receive via QR' flow and the hub's unauthenticated POST /invoices in hosting mode). For these invoices the peer-planted row is the only row with that payment_request, so the hijack is deterministic.
6. [src/grpc/subscribe.ts:25–38](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/subscribe.ts#L25-L38)
   Settled non-keysend invoices from the LND subscription (root node in proxy mode, so all tenants' invoices) are passed to receiveNonKeysend(inv) without await or catch; a rejection inside it is an unhandled promise rejection, which terminates the node:16 process (no unhandledRejection handler exists in src/ or app.ts; Dockerfile CMD node /relay/dist/app.js).
7. [src/helpers.ts:305–318](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L305-L318)
   For a conversation-type payload parseReceiveParams resolves sender by pub_key (the owner's own contact row matches if the peer claims the owner's pubkey, since signatures are not enforced) and findOrCreateChatByUUID creates a chat with contactIds [owner.id, sender.id] for any fresh uuid.
8. [src/hub.ts:242–250](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/hub.ts#L242-L250)
   sendInvoice is a fire-and-forget POST of {invoice, amount} to hub /invoices; it is the hub's only notification that a hosting-mode invoice settled, and it is suppressed when a planted row exists.

## Impact
Integrity LOW: the owner's payment ledger and client display record a real incoming payment as an outgoing one to the attacker, the planted invoice is marked paid, and the hub settlement callback and invoice_payment socket event are suppressed; no funds move incorrectly. Availability HIGH: the owner-as-sender variant makes receiveNonKeysend reject inside the un-awaited LND stream callback (subscribe.ts:37) with no unhandledRejection handler anywhere in src/ or dist/, so the node:16 process exits and the relay (HTTP, socket.io, keysend processing) is down until restarted; the main Dockerfile runs node directly with no supervisor (only the lndrelay image has autorestart). One crash per settled owner invoice the attacker holds, unbounded in HOSTING_PROVIDER non-proxy mode where POST /invoices is unauthenticated. Confidentiality LOW in proxy mode only: a co-tenant that knows another tenant's bolt11 learns when it settled and for how much, while the other tenant's client receives nothing.

## Reproduction steps
1. Attacker: any Lightning node that holds one of the owner's bolt11 strings, typically because it is the payer (the owner generated a receive-QR invoice for it) or, in HOSTING_PROVIDER non-proxy mode, because it minted the invoice itself via POST /invoices which auth.ts lets through unauthenticated. It sends one minimum keysend carrying a type-2 payload with that bolt11 (no prior contact needed; parseAndVerifyPayload does not enforce the signature, and contact and chat are auto-created), then pays the invoice. The relay deterministically books the real payment against the planted row. Claiming the owner's pubkey as sender adds the crash. The owner's only involvement is the routine act of issuing the invoice.

## Recommended fix
1. receiveNonKeysend resolves the owner of a settled invoice from any invoice-type Message with that payment_request, including rows written by receiveInvoice from peer payloads, without tenant or sender constraints. Fix criteria: A settled invoice is matched only against rows the owner created (sender = owner, tenant = the payee owner derived from the bolt11's payeeNodeKey); peer-received invoice rows never satisfy the lookup. Verify by planting a type-2 row for an owner bolt11 and settling it: the invoice_payment event, hub notification and chatId-0 record must still be produced and no payment with sender = owner must appear.
2. receiveInvoice stores any bolt11 a peer supplies, including ones whose payee is this owner. Fix criteria: Inbound invoice payloads whose payee pubkey equals the receiving owner's pubkey (or any owner on the relay) are rejected and not stored. Verify by sending the owner's own invoice back as a type-2 payload and confirming no Message row is created.
3. The settled-invoice branch derives the payer as 'the other contact in the chat' and dereferences it without a null check, inside an un-awaited stream callback with no process-level rejection handler. Fix criteria: A missing counterpart contact must be handled without throwing, and rejections from receiveNonKeysend must be caught at the subscription handler so no inbound settlement can terminate the process. Verify by settling an invoice whose matched row's chat contains only the owner and confirming the relay keeps running.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper Input Validation
**CWE:** [CWE-345](https://cwe.mitre.org/data/definitions/345.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258358

---

# Per-call sphinx-proxy gRPC clients are never closed, leaking a TLS connection per inbound message

## Details
In proxy (multi-tenant) mode every Lightning wrapper in src/grpc/lightning.ts obtains its client through `loadLightning(true, ownerPubkey)`. For a tenant pubkey this path intentionally bypasses the module-level cache (`// do not cache proxy lightning`, lightning.ts:134-141) and returns a new `lnrpc_proxy.Lightning` client built by `loadProxyLightning` (proxy.ts:181-205) with freshly constructed ChannelCredentials (a new SSL credential object and a new `createFromMetadataGenerator` closure per call, proxy.ts:163-177). None of the eleven wrappers closes the client when the RPC completes (the only `.close()` calls in src/ are file readers in utils/unlock.ts); the object is dropped after the callback fires. The single-tenant path, by contrast, caches one root client for the process lifetime.

Each such client owns a grpc-js Channel. Because the call-credentials generator is a distinct closure per call, grpc-js' subchannel pool treats every client's credentials as unequal and allocates a separate subchannel, i.e. a separate TCP+TLS connection to sphinx-proxy (`PROXY_LND_IP:proxy_lnd_port`). Nothing in the relay releases it: the channel is never `close()`d, so the subchannel stays referenced and the socket and file descriptor stay open until grpc-js' own idle timer (if any) fires.

The allocation is attacker-driven. Every outbound Sphinx message runs `signAndSend` (send.ts:333-364), which calls `LND.signAscii` -> `signBuffer` (lightning.ts:740, one new client) and `LND.keysendMessage` -> `keysend` (lightning.ts:438, a second new client). Outbound messages are generated automatically in reaction to inbound traffic: parseKeysendInvoice (receive.ts:709-727) hands every inbound keysend payload to onReceive, which selects the tenant by dest pubkey alone (receive.ts:97-101); for a conversation-typed `message` payload parseReceiveParams auto-creates a contact and chat for an unknown sender (helpers.ts:303-314) and receiveMessage then calls sendConfirmation (messages.ts:607 -> confirmations.ts:18-44), which emits the reply through signAndSend. An unauthenticated Lightning node (threat-model adversary 2) therefore makes the relay allocate at least two never-closed TLS connections for every 1-sat keysend it sends to any tenant pubkey; an authenticated tenant allocates two per HTTP request (`GET /balance` -> complexBalances -> listChannels + channelBalance, lightning.ts:1117-1121) within the 10 req/s/IP limiter. The number of simultaneously open connections is therefore set by the attacker's message count over the leak window, not by anything the code bounds. Sustained inbound traffic exhausts the process' file-descriptor limit (EMFILE), after which the relay can no longer open connections to sphinx-proxy, LND, the tribe broker or external services and every tenant of the shared relay loses service; the same connection flood is imposed on the sphinx-proxy process.

This holds only when the relay runs in proxy mode (config.proxy_lnd_port, proxy_macaroons_dir and proxy_tls_location set, via PROXY_* env or config, config.ts:142-145) — the supported multi-tenant deployment the threat model names; the single-tenant mode is unaffected.

Dependency assumption (not verified from sources; @grpc/grpc-js is pinned to 1.8.7 in package.json and package-lock.json): (a) each client holds its own Channel; (b) ComposedChannelCredentials equality requires the same metadata-generator function instance, so per-call credentials prevent subchannel sharing; (c) a Channel that is never closed keeps its subchannel referenced, and grpc-js 1.8.x tears an unused channel down on its own only after the default 30-minute idle timeout (`grpc.client_idle_timeout_ms`). Under (c) the leak is a window of at least 30 minutes per message (rate x 1800 open sockets at steady state); if the idle timer does not reclaim it, the leak is permanent until restart. This differs from a volumetric flood in that each message leaves a resource the code never frees; the fix is to reuse or close clients, not to rate limit.

## Evidence
1. [src/grpc/lightning.ts:133–140](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L133-L140)
   In proxy mode loadLightning(true, ownerPubkey) deliberately bypasses the module-level cache ('do not cache proxy lightning') and returns a brand-new client from loadProxyLightning on every call. No caller ever invokes .close() on the returned client (the only .close() calls in src/ are file readers in utils/unlock.ts); the object is dropped when the callback fires. This is the code the fix must change: cache per owner pubkey with stable credentials, or close after use.
2. [src/utils/proxy.ts:157–204](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L157-L204)
   loadProxyCredentials builds fresh ChannelCredentials on each call (new createSsl object and a new createFromMetadataGenerator closure) and loadProxyLightning constructs `new lnrpc.Lightning(PROXY_LND_IP:proxy_lnd_port, credentials)`. With a distinct call-credentials closure per client, grpc-js cannot treat the credentials as equal, so each client gets its own subchannel, i.e. its own TCP+TLS connection to sphinx-proxy.
3. [src/grpc/lightning.ts:736–740](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L736-L740)
   signBuffer (reached via signAscii for every outbound payload) obtains one new per-call proxy client per signature.
4. [src/grpc/lightning.ts:437–438](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L437-L438)
   keysend obtains a second new per-call proxy client for the payment. The same pattern appears at queryRoute (249), sendPayment (319), verifyMessage (790), addInvoice (918), listPeers (958), listChannels (976), pendingChannels (1008), channelBalance (1176) and getInvoiceHandler (1258) — eleven wrappers, none of which closes the client.
5. [src/network/send.ts:333–363](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L333-L363)
   signAndSend calls LND.signAscii(data, ownerPubkey) (line 335) and then LND.keysendMessage(..., ownerPubkey) (lines 357-360) for every non-MQTT message the relay emits, so each emitted message costs two never-closed clients/connections.
6. [src/controllers/messages.ts:607](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L607)
   receiveMessage ends by calling sendConfirmation({ chat, sender: owner, msg_id, receiver: sender }) for every stored inbound message, which is the automatic reply that drives signAndSend.
7. [src/helpers.ts:303–313](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L303-L313)
   For conversation-typed payloads parseReceiveParams calls findOrCreateContactByPubkeyAndRouteHint and findOrCreateChatByUUID, so an unknown sender pubkey is auto-provisioned a contact and chat; receiveMessage's `if (!owner || !sender || !chat)` guard therefore passes for any Lightning node, not only existing contacts.
8. [src/controllers/confirmations.ts:18–43](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/confirmations.ts#L18-L43)
   sendConfirmation calls network.sendMessage -> signAndSend for non-tribe chats (it returns early only for tribe non-owners), so the reply is sent for every inbound DM-style message.
9. [src/network/receive.ts:709–726](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L709-L726)
   parseKeysendInvoice dispatches every inbound keysend payload to onReceive, which (lines 97-101) resolves the tenant owner from the dest pubkey alone with doAction defaulting to true for non-tribe payloads; there is no sender allow-list or rate limit on the LN inbound path (the 10 req/s/IP limiter applies only to HTTP).

## Impact
Open TLS sockets, file descriptors and per-channel memory grow with inbound message volume until the Node process hits EMFILE; at that point every gRPC call (payments, invoices, signing), MQTT reconnect and HTTP fetch fails for all tenants of the shared relay until restart (availability HIGH). No confidentiality or integrity effect. Rating assumes the grpc-js 1.8.7 behaviour stated in the description: even under the most favourable reading (channels reclaimed after the 30-minute idle timeout) a sustained rate of a few messages per second — a few sats per second to the attacker — keeps thousands of sockets open, exceeding the 1024-descriptor soft limit typical of `npm run prod` under systemd; if channels are not reclaimed, a cumulative total suffices.

## Reproduction steps
1. Attacker is any Lightning node able to route a keysend to a tenant pubkey of a proxy-mode relay (threat-model adversary 2), or any authenticated co-tenant over HTTP (adversary 5). They send ordinary 1-sat keysend `message` payloads at a sustained rate; onReceive selects the tenant from dest alone, parseReceiveParams auto-creates a contact for the unknown sender and receiveMessage auto-replies via sendConfirmation -> signAndSend, which allocates two unclosed gRPC clients/TLS connections per inbound message. No credentials, no user interaction, no race. Attack requirement: the relay must run in proxy multi-tenant mode (PROXY_* configured), the configuration in which per-call clients are created.

## Recommended fix
loadLightning creates a new proxy gRPC client with new ChannelCredentials for every wrapper call in proxy mode, and no wrapper closes the client, so each call leaks a channel and its TLS connection. Fix criteria: Proxy clients must be reused — cached per owner pubkey with stable credential objects so grpc-js can share subchannels — or explicitly closed (client.close()) once each RPC completes, on both success and error paths. Verify in proxy mode by sending N inbound messages and observing that the relay's open-socket/file-descriptor count toward sphinx-proxy stays bounded (O(tenants), not O(messages)).

---
**Severity:** HIGH
**Status:** Open
**Category:** Resource leak
**CWE:** [CWE-772](https://cwe.mitre.org/data/definitions/772.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258357

---

# Released Docker image ships committed dist/ JavaScript without building from source

## Details
The production Docker images are not built from source. Dockerfile and Dockerfile.swarm copy the repository (including the 723 tracked files under `dist/`), run `npm install` (whose only lifecycle hook is `git apply protobuf_long.patch`), and execute `node /relay/dist/app.js`. There is no TypeScript compilation in either Dockerfile and no step anywhere in the release path that checks that `dist/` corresponds to `src/`. The JavaScript that reaches operators is therefore whatever `dist/` contains at the tagged commit.

`dist/` is kept in sync with `src/` only by the master-branch bot job (lint_format_and_build.yml), which runs `tsc` and force-adds `dist` after each push. That job (a) is skipped entirely when the triggering commit message contains `[ci commit]` — text a contributor places in a PR title (included by GitHub in squash and merge commit messages) or in their own commits; (b) runs `tsc`, which overwrites the files it emits but never deletes files it did not emit, and whose `include` (tsconfig.json) never touches `dist/node_modules`; and (c) runs under `bash -e`, so a compile error aborts the step before `git add dist`. Consequently a pull request that adds JavaScript under `dist/` that tsc does not regenerate survives into master: in particular `dist/node_modules/express/index.js` (not matched by `.gitignore`'s root-anchored `node_modules/*`, nor by `.dockerignore`'s root-only `node_modules`) is resolved first by Node's module lookup from `/relay/dist/app.js` and silently replaces the real `express` for the whole application, unconditionally; alternatively an edited `dist/**/*.js` paired with a `[ci commit]` merge title ships code with no counterpart in `src/`.

Reviewers reason about `src/`; `dist/` is machine-owned output that the bot rewrites on every push, so its diffs are noise that review customarily skips. The tag-triggered workflows (docker-build.yml, docker-swarm-build.yml) then publish the tagged tree as `sphinxlightning/sphinx-relay:<tag>` and `:latest`, which docs/docker_deployment.md tells operators to run.

The result is that the released artifact's code is not derivable from the reviewed source: a contributor whose PR is merged — or anyone with push access to a commit that gets tagged — can ship JavaScript that reviewers never saw as source. The relay runs that code with the LND admin macaroon.

## Evidence
1. [Dockerfile:5–42](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L5-L42)
   The image copies the whole checkout (`COPY . .` at line 5, which includes the 723 tracked files under dist/), runs `npm install` (line 16; package.json's only lifecycle hook is `postinstall: git apply protobuf_long.patch`, no `prepare`), copies config into dist/config and starts `node /relay/dist/app.js` (line 42). There is no `tsc`/`npm run build` step, so the JavaScript that runs in production is exactly the dist/ committed at the tagged revision, not a compilation of src/.
2. [Dockerfile.swarm:5–43](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile.swarm#L5-L43)
   Same structure (COPY . ., npm install, node /relay/dist/app.js) for the sphinx-relay-swarm image, additionally running as root; committed dist/ is shipped as-is.
3. [.github/workflows/lint\_format\_and\_build.yml:20–43](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/lint_format_and_build.yml#L20-L43)
   dist/ is re-synchronised with src/ only by this bot job on pushes to master. It exits early (lines 22-26) whenever the triggering commit's full message (`git log --format=%B`) contains '[ci commit]' — a string a contributor controls via the PR title (GitHub puts the PR title in squash and merge commit messages) or their own commit messages. When it does run, `npm run build` (line 35) is plain `tsc`, which overwrites files it emits but never deletes files it did not emit, and `git add dist --force` (line 36) commits whatever is left in dist/. The step runs under bash -e, so a tsc error aborts before the add, leaving dist/ as the merged PR left it.
4. [.dockerignore:1–2](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.dockerignore#L1-L2)
   Only `node_modules` and `npm-debug.log` are excluded from the build context. Docker matches .dockerignore patterns against the full context-relative path, so the bare `node_modules` pattern excludes only the root directory; a committed `dist/node_modules/<pkg>/index.js` is copied into the image by `COPY . .`.
5. [.gitignore:10–15](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.gitignore#L10-L15)
   Under dist/ only dist/public/uploads and dist/config/*.json are ignored, and `node_modules/*` contains a mid-pattern slash so it is anchored to the repository root; `dist/node_modules/express/index.js` is therefore trackable and committable. Node's module lookup from /relay/dist/app.js (which does `require("express")`, `require("helmet")`, `require("cors")` at dist/app.js:12-15) searches /relay/dist/node_modules before /relay/node_modules, so such a file shadows the real dependency for the whole application.
6. [tsconfig.json:20–21](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/tsconfig.json#L20-L21)
   tsc's `include` is limited to app.ts, src/** and config/*.json with `outDir: dist`; it never reads or rewrites anything under dist/node_modules, so a file planted there survives every bot rebuild unconditionally.
7. [.github/workflows/docker-build.yml:5–8](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/docker-build.yml#L5-L8)
   Any tag pushed on any commit (including one whose dist/ was never rebuilt by the bot) is checked out, built with the Dockerfile and pushed as sphinxlightning/sphinx-relay:<tag> and :latest (docker-swarm-build.yml does the same for Dockerfile.swarm). No PR workflow (lint_pr.yml, unit_test.yml, integration_test.yml, cln_proxy_integration_test.yml) compares dist/ to a fresh tsc build.
8. [docs/docker\_deployment.md:95](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/docs/docker_deployment.md#L95)
   Operators are instructed to run `image: sphinxlightning/sphinx-relay:latest`, i.e. the artifact produced by the tag workflow from the committed dist/.

## Impact
Arbitrary attacker JavaScript runs inside the relay process in every deployment that pulls the image: full read of stored messages, contact keys, auth tokens and the transport-token private key, arbitrary modification of data and behaviour, and the ability to stop the service. Subsequent-system impact: The relay process holds the LND admin macaroon and TLS cert by configuration (and Greenlight device credentials under creds/), so injected code controls the operator's Lightning node and can spend its funds.

## Reproduction steps
1. Attacker: anyone who can open a pull request against the public repository (PR:NONE — no privilege on the relay, the repository or its pipeline is needed; lint_pr.yml/unit_test.yml run on pull_request from any fork); a maintainer must merge it (UI:ACTIVE). Delivery: add under dist/ a file tsc never emits — e.g. dist/node_modules/express/index.js that re-exports the real module from /relay/node_modules and adds a backdoor — which survives the master bot rebuild unconditionally (tsc does not delete, tsconfig include never covers it, .gitignore and .dockerignore only match the root node_modules); or edit dist/*.js and title the PR with '[ci commit]' so the bot skips rebuilding. AT:PRESENT: the payload must evade source-focused review and a release tag must then be cut from a commit containing it. The tag workflows publish the image as :<tag> and :latest; operators following docs/docker_deployment.md pull :latest and execute the injected code.

## Recommended fix
1. The release image executes committed build output instead of compiling the reviewed source, so dist/ can diverge from src/ undetected. Fix criteria: The image build must compile src/ with tsc into a clean output directory inside the build (after `rm -rf dist`), and must not copy a pre-existing dist/ or any dist/node_modules from the context. Verify that deleting dist/ from the context does not change the produced image and that a file placed under dist/ in the repository does not appear in the image.
2. Committed dist/ is only re-synchronised by a skippable bot job, and tsc does not remove stray files. Fix criteria: Stop tracking dist/ (or add CI that fails when `tsc` output differs from the committed dist/ and when dist/ contains files tsc did not emit), and ignore dist/node_modules. Verify that a PR adding dist/node_modules/x/index.js or editing dist/*.js with a '[ci commit]' title fails CI.

---
**Severity:** HIGH
**Status:** Open
**Category:** Supply chain integrity
**CWE:** [CWE-829](https://cwe.mitre.org/data/definitions/829.html)
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
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258356

---

# Unverifiable tribe uuid in peer group_create makes verifySignedTimestamp reject and crash the relay

## Details
Any Lightning node can send this relay a keysend whose payload is `{type: group_create (or group_invite), sender:{pub_key:<its own key>}, chat:{uuid:'x', type:2, members:{}}, message:{}}` (type 2 = chat_types.tribe). onReceive finds no chat for uuid 'x', so isTribeOwner is false and the payload is dispatched to receiveGroupCreateOrInvite (receive.ts:387) without await. parseReceiveParams succeeds (chat and message are objects), and because chat_type is tribe the handler calls validateTribeOwner(chat_uuid, sender_pub_key) (chats.ts:862, 887).

validateTribeOwner -> tribes.verifySignedTimestamp('x') (tribes.ts:768-778): Buffer.from('x','base64') is 0 bytes, subarray(4,92) is empty, zbase32.encode('') is '', and LND.verifyBytes(<empty>, '') is awaited with no try/catch. In lightning.ts:825-838 the LND/proxy branch calls lightning.verifyMessage and rejects whenever err is set or res.pubkey is empty; LND returns either an error or Valid:false with no pubkey for a signature that is not a 65-byte compact signature, so the promise rejects. (Greenlight branch: secp256k1.recover on a 0/short signature throws into reject(e). CLN: neither branch runs and the promise hangs instead.) The rejection propagates through validateTribeOwner and receiveGroupCreateOrInvite, which nothing awaits or catches, becoming an unhandledRejection. The shipped image runs node:16 with the default throw mode and no handler is installed, so the relay process terminates. Any chat_uuid that is not a genuine 69-byte signed timestamp (i.e. anything shorter than ~92 base64 characters, or random bytes) triggers it, and repeating the 3-sat keysend keeps the relay in a crash loop; in proxy mode every tenant is taken offline.

This is distinct from inbound-payload-shape-unhandled-rejection-crash (missing chat/message fields throwing in parseReceiveParams) and inbound-payload-object-uuid-unhandled-rejection-crash (object-typed uuid in messages.ts): here the payload is fully well-formed and the failure is the signature verifier in src/utils/tribes.ts treating a verification failure as an exception rather than as `undefined`. Fixing shape validation does not close this path; verifySignedTimestamp (or validateTribeOwner) must contain verification errors.

## Evidence
1. [src/utils/tribes.ts:768–777](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L768-L777)
   verifySignedTimestamp base64-decodes the attacker string, slices bytes 4..92 as the signature (empty or non-65-byte for any non-token input), zbase32-encodes it and awaits LND.verifyBytes with no try/catch and no length/shape check; a verification failure surfaces as a rejection instead of `undefined`, and any rejection propagates to the caller.
2. [src/grpc/lightning.ts:788–842](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L788-L842)
   verifyMessage rejects whenever the backend returns an error or a response without pubkey (`if (err || !res || !res.pubkey) reject(err)`); the repo's proto/lightning.proto documents VerifyMessageResponse.pubkey as the key recovered from the signature, so a malformed signature yields valid:false with no pubkey and the promise rejects (with `undefined`). The Greenlight branch lets readUIntBE/secp256k1.recover throw on a 0/short signature into reject(e). Nothing resolves {valid:false} for malformed signatures.
3. [src/controllers/chats.ts:861–890](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L861-L890)
   validateTribeOwner awaits verifySignedTimestamp without catching; receiveGroupCreateOrInvite calls it for every payload with chat.type === tribe (2) after parseReceiveParams. parseReceiveParams (helpers.ts:246-370) tolerates an unknown chat (chat null, optional chaining) and an unknown sender (injects {id:0}) for the tribe branch, so a well-formed payload reaches the throwing call.
4. [src/network/receive.ts:383–390](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L383-L390)
   doTheAction dispatches ACTIONS[payload.type](payload) without await or catch; the rejected promise is unhandled. doTheAction itself is un-awaited at line 354 and onReceive is un-awaited in parseKeysendInvoice (line 726).
5. [src/network/receive.ts:112–136](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L112-L136)
   For an unknown chat uuid maybeChat is null, so isTribeOwner is false, the whole tribe-owner gating block is skipped, doAction stays true and the payload goes straight to doTheAction; no gate before the handler.
6. [src/grpc/subscribe.ts:35](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/subscribe.ts#L35)
   Entry point: every settled keysend from the LND SubscribeInvoices stream is passed to parseKeysendInvoice inside the 'data' handler without await or catch, so nothing upstream contains the rejection.
7. [Dockerfile:23–42](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L23-L42)
   Production image runs `node /relay/dist/app.js` on node:16-buster-slim with no --unhandled-rejections flag; app.ts, src/ and dist/app.js register no unhandledRejection handler, so Node 16's default `throw` mode terminates the process (ERR_UNHANDLED_REJECTION even for an `undefined` reason).

## Impact
The relay process exits on each such payload; a repeated 3-sat keysend keeps the chat backend (and all tenants in proxy mode, who share the process) offline regardless of supervisor restarts. No data disclosure or modification.

## Reproduction steps
1. Attacker is any Lightning node able to route a minimal keysend (3 sats default) to the victim's node pubkey. It sends a well-formed payload `{type:12 or 13, sender:{pub_key:<own key>}, chat:{uuid:'x', type:2, members:{}}, message:{}}` with an arbitrary chat.uuid that is not a genuine LND-signed timestamp (tribe uuids are genSignedTimestamp outputs, chatTribes.ts:963, so any other string fails verification). No chat needs to exist, no authentication, no interaction; default configuration and image. Deterministic on LND (default provider; in proxy mode loadLightning(true, undefined) falls back to the root LND client) and Greenlight backends; on CLN the verifier never resolves and the handler hangs instead. Assumptions: lnd VerifyMessage (proto/lightning.proto:103-109, 1252-1258) returns valid:false with an empty pubkey, or an error, for a signature that is not a 65-byte compact signature; Node 16 (image base) defaults --unhandled-rejections=throw.

## Recommended fix
1. verifySignedTimestamp treats a failed or malformed signature verification as a thrown error instead of a negative result, and performs no length/shape check on the attacker-supplied string before calling the signer backend. Fix criteria: verifySignedTimestamp returns undefined for any input that is not a well-formed signed timestamp or whose verification fails, never throwing to its caller. Verify that a tribe group_create with chat.uuid='x' is logged and dropped while the relay keeps running.
2. receiveGroupCreateOrInvite / validateTribeOwner and the ACTIONS dispatch in receive.ts have no error containment, so any rejection from a handler is an unhandled rejection that terminates node:16. Fix criteria: Handler invocations are awaited inside a try/catch (or a process-level unhandledRejection handler logs and continues) so that no inbound payload can terminate the process. Verify by sending malformed group_create payloads and confirming the process survives.

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
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258351

---

# Unauthenticated POST /action with object-typed bot_id throws in Bot lookup and terminates relay

## Details
POST /action (src/controllers/botapi/index.ts processAction) is exempt from authentication (src/auth.ts no_auth) because external bots authenticate per-request with a bot secret or HMAC. That check, however, is performed only after the bot row has been loaded, and the lookup trusts the shape of the request field:

```
if (!bot_id) return failure(res, 'no bot_id')
const bot = await models.Bot.findOne({ where: { id: bot_id } })
```

express.json() delivers `bot_id` as whatever JSON type the client sent. A plain object with a non-operator key (`{"bot_id":{"a":1}}`) is truthy, so it reaches Sequelize's where builder. In Sequelize 5 (package.json ^5.19.3, lock 5.22.5) a single-key plain object whose key is not an operator is routed to _whereParseSingleValueObject and then SqlString.escape, which throws `Error: Invalid value { a: 1 }` because the value has no .replace method (the same dependency behaviour that inbound-payload-object-uuid-unhandled-rejection-crash and the second variant of swarm-admin-register-unhandled-rejection-crash rely on). The Bot table's `id` is a TEXT column (src/models/sql/bot.ts), so no numeric coercion path applies.

processAction is `async`; the throw becomes a rejected promise. Express 4 (^4.16.4) ignores promises returned by handlers, there is no error middleware and the repository registers no `unhandledRejection` handler. The Docker image runs node:16, where an unhandled rejection is fatal by default, so one unauthenticated request - `curl -X POST /action -H 'content-type: application/json' -d '{"bot_id":{"a":1}}'` - exits the relay process: HTTP API, socket.io, the LND invoice subscription and MQTT tribe subscriptions all stop for every tenant until a supervisor restarts it, and the request can be repeated after each restart. The 10 req/s rate limit is irrelevant to a one-request crash.

This is the POST /action sibling of the recorded /ml, /webhook and /swarm_admin_register crashes (ml-callback-prototype-process-id-unhandled-exception-crash, github-webhook-malformed-repository-unhandled-exception-crash, swarm-admin-register-unhandled-rejection-crash); none of those records covers this entry point. The existing /action records (action-api-bot-secret-not-bound-to-installed-chat, action-chat-uuid-sql-injection-get-tribe-owners-chat) concern authenticated-bot abuse and SQL injection after the secret check, not this pre-authentication crash.

## Evidence
1. [src/controllers/botapi/index.ts:181–183](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L181-L183)
   bot_id is checked only for truthiness and then used verbatim as a Sequelize where value: models.Bot.findOne({ where: { id: bot_id } }). A plain object such as {"a":1} passes the truthiness check and makes Sequelize 5 throw ('Invalid value' from SqlString.escape for a non-operator plain-object value on the TEXT primary key). No bot needs to exist and no secret is involved - the throw happens before the secret/HMAC check at 185-195.
2. [src/controllers/botapi/index.ts:151–163](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L151-L163)
   processAction is an async Express handler; the only try/catch (154-163) wraps the optional single-quote JSON re-parse, and the later try/catch at 217-222 wraps finalAction only. The Bot.findOne rejection propagates out of the handler.
3. [src/auth.ts:122–144](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L122-L144)
   '/action' is in the no_auth list, so the request reaches the handler with no token, HMAC or transport-token check.
4. [src/controllers/index.ts:156](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L156)
   Route registration: app.post('/action', actions.processAction).
5. [Dockerfile:23–42](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L23-L42)
   Shipped image runs node:16 (`node /relay/dist/app.js`) with no --unhandled-rejections flag; no process.on('unhandledRejection') or Express error middleware exists in app.ts or src/, so the rejection terminates the process.

## Impact
The relay process terminates: all tenants lose the chat API, websocket pushes, inbound Lightning message processing and tribe MQTT until restarted; repeated requests keep it down. No data is disclosed or modified.

## Reproduction steps
1. Any client able to reach the relay's HTTP port (Internet-facing by design) sends one JSON POST to the unauthenticated /action route with a non-scalar bot_id such as {"bot_id":{"a":1}}. No bot row, secret, token or prior interaction is required: the lookup at src/controllers/botapi/index.ts:182 runs before the secret/HMAC check, the handler is async with no try/catch around it, app.ts registers no Express error middleware and the repository has no process.on('unhandledRejection'). Dependency assumptions: (1) sequelize 5.22.5 (lock; manifest ^5.19.3) routes a single-key non-operator plain object on a TEXT attribute through _whereParseSingleValueObject to SqlString.escape, which throws 'Invalid value' for any value lacking .replace (plain objects, including {}), so Bot.findOne rejects; (2) express 4.18.2 does not forward rejected handler promises to any error handler; (3) node:16 (Dockerfile FROM node:16-buster-slim, CMD node /relay/dist/app.js with no --unhandled-rejections flag) terminates the process on an unhandled rejection by default. The committed dist (dist/src/controllers/botapi/index.js:140) contains the same unvalidated lookup. The 10 req/s rate limit does not matter for a one-request crash, and the request can be replayed after each supervisor restart.

## Recommended fix
1. processAction uses an untyped request field as a Sequelize where value, so a non-string bot_id turns into a thrown query-builder error on an unauthenticated route. Fix criteria: bot_id (and the other identifier fields used in where clauses by this handler) must be validated as a non-empty string before any database call, with a 400 returned otherwise; verify that `{"bot_id":{"a":1}}`, arrays and numbers all yield an HTTP error response and the process stays alive.
2. Async Express handlers on no_auth routes have no error containment, and the process has no unhandledRejection handler, so any thrown error is fatal. Fix criteria: Rejections from processAction (and the other no_auth handlers) must be caught and converted into HTTP error responses - e.g. a try/catch around the handler body or an async-error wrapper plus Express error middleware - and a process-level unhandledRejection handler should log instead of exiting. Verify that a thrown error inside processAction no longer terminates the relay.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper Input Validation
**CWE:** [CWE-754](https://cwe.mitre.org/data/definitions/754.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258350

---

# Unauthenticated non-string token to /swarm_admin_register crashes relay via unhandled rejection

## Details
swarmAdminRegister (src/controllers/admin.ts:10-39) is unauthenticated (no_auth list in src/auth.ts) and has no try/catch. It validates `req.body.token` only with `if (!token)` and then calls `crypto.createHash('sha256').update(token)`. express.json() happily delivers `token` as an object, array or number, and Node's Hash.update throws `TypeError [ERR_INVALID_ARG_TYPE]` for anything that is not a string, Buffer, TypedArray or DataView. Because the handler is `async`, the throw becomes a rejected promise; Express 4 ignores promises returned by route handlers, and the repository registers no `process.on('unhandledRejection')` handler. On Node 15+ (the shipped image is node:16) the default unhandled-rejection mode is `throw`, so the rejection is raised as an uncaught exception and the whole relay process exits.

To reach line 26 the request's `pubkey` must match an owner contact, which it will for the node's public Lightning identity key (or any tenant's pubkey in proxy mode) - public information. A single request such as `POST /swarm_admin_register {"pubkey":"<owner pubkey>","token":{}}` therefore takes down the relay for all tenants: HTTP API, socket.io, the LND invoice subscription (inbound message processing) and MQTT tribe subscriptions all stop until an external supervisor restarts the container (the main Dockerfile and Dockerfile.swarm run `node dist/app.js` with no in-container restart; only the Dockerfile.lndrelay supervisord flavour auto-restarts, and it can be re-crashed immediately). The express-rate-limit of 10 req/s per IP does not prevent a one-request crash.

A second variant that does not even need a known owner pubkey: sending `pubkey` as a plain object with a non-operator key (e.g. {"pubkey":{"x":1}}) makes Sequelize's where-builder throw 'Invalid value ...' on line 15; this depends on Sequelize ^5.19.3 (package.json) rejecting non-operator object values, which is its documented behaviour since v5 removed string operator aliases, and is stated here as an assumption.

The same shape (async handler, `createHash().update(req.body.token)`, no try/catch, no_auth) exists in contacts.generateToken (/contacts/tokens); that sibling is noted for its own scope.

## Evidence
1. [src/controllers/admin.ts:10–39](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/admin.ts#L10-L39)
   swarmAdminRegister is an async Express handler with no try/catch. `token` is taken from the JSON body with only a truthiness check and passed straight to crypto.createHash('sha256').update(token) (line 26). For a non-string/non-Buffer value such as {} or 1, Node's hash.update throws ERR_INVALID_ARG_TYPE synchronously, rejecting the handler's promise.
2. [src/auth.ts:122–145](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L122-L145)
   '/swarm_admin_register' is in no_auth(), so the route is reachable with no credentials.
3. [src/controllers/index.ts:252](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L252)
   The route is registered directly (no wrapper that catches promise rejections); Express 4 (package.json pins ^4.16.4) does not handle rejected promises returned by handlers.
4. [app.ts:1–198](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L1-L198)
   The process installs no process.on('unhandledRejection') handler anywhere (none in app.ts or src/), so under Node 16 (Dockerfile: node:16-buster-slim) the default --unhandled-rejections=throw turns the rejection into an uncaught exception and the relay process exits.

## Impact
The relay process terminates: all API, websocket, inbound Lightning message handling and tribe MQTT handling stop for every owner/tenant hosted by the relay until something outside the process restarts it, and it can be re-crashed with one request each time. No confidentiality or integrity effect.

## Reproduction steps
1. Any remote party able to reach the relay's HTTP port sends one unauthenticated JSON POST with a non-string token and a publicly known owner pubkey. No authentication, no race, no non-default configuration: the route and behaviour are identical in single-user and proxy deployments. The crash is deterministic.

## Recommended fix
Untrusted body fields are passed to crypto APIs without type validation inside an async Express 4 handler that has no exception handling, so a type error becomes an unhandled promise rejection that terminates the process. Fix criteria: The handler must validate that pubkey and token are strings (and reject otherwise with a 4xx) and must catch and convert any exception into an HTTP error response; additionally the application should install a global rejection handler or promise-aware route wrapper so no handler rejection can exit the process. Verify that POSTing {"pubkey":"<owner pubkey>","token":{}} and {"pubkey":{"x":1}} returns an error response and the process keeps serving requests.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncaught exception
**CWE:** [CWE-248](https://cwe.mitre.org/data/definitions/248.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258349

---

# Keysend TLV pre-dispatch parsing crashes relay: prototype chunk key, string message, object memo

## Details
parseKeysendInvoice (src/network/receive.ts:632-728) is the first code that touches the custom TLV record of every inbound keysend, before any signature step or ACTIONS handler. Three independent shape assumptions in it are fatal when violated, and all of them are reached before (or instead of) the handler-level sites recorded in inbound-payload-shape-unhandled-rejection-crash / inbound-payload-object-uuid-unhandled-rejection-crash, so a fix that hardens the ACTIONS dispatch or the controllers leaves them open.

1. Chunk reassembly (weave, 731-752). TLV data that does not begin with '{' is split on '_' and the first field becomes a key into the module-level plain object `chunks`. A key that names an inherited Object.prototype function and contains no underscore - e.g. `constructor_0_1_x` - makes `chunks[ts]` a truthy function, and `[...chunks[ts], ...]` throws `TypeError: chunks[ts] is not iterable` (target es6, native spread in dist). Nothing wraps weave(); the throw rejects parseKeysendInvoice.

2. Settled-amount write (722-723). `if (value && dat && dat.message) dat.message.amount = value` assumes message is an object. The payload `{"type":0,"sender":{"pub_key":"<66 hex>"},"message":"x"}` passes parseAndVerifyPayload (sender.pub_key present; signature is not enforced), and under the "use strict" emitted into dist/src/network/receive.js the assignment to a property of a string primitive throws TypeError.

3. Keysend branch (685-707 -> 593-628). For `type: 28` the memo and sender_pubkey are copied from the payload untyped and saveAnonymousKeysend runs un-awaited. `{"type":28,"sender":{"pub_key":{"a":1}},"message":{"content":{"b":2}}}` makes Contact.findOne({where:{publicKey:{a:1}}}) throw (Sequelize 5 SqlString.escape 'Invalid value') or, with a string pubkey, Message.create({messageContent:{b:2}}) reject with a Sequelize ValidationError ('messageContent cannot be an array or an object'). Dependency assumption: sequelize ^5.19.3 (5.22.5 in the lock) - InstanceValidator._validateSchema rejects non-string values for STRING/TEXT attributes and SqlString.escape throws for plain-object values.

In every case the async parseKeysendInvoice rejects; subscribe.ts:35 invokes it without await/catch inside an async 'data' callback; the repository has no unhandledRejection handler; the production image is node:16, whose default is to exit. One minimum-value keysend (3 sats by default) from any Lightning node that can route to the victim therefore terminates the relay - HTTP, socket.io, MQTT and invoice processing for every tenant in proxy mode - and repeating it keeps the service down across supervisor restarts. Variant 1 needs no JSON and no sender field at all, so it cannot be mitigated by validating the parsed payload.

## Evidence
1. [src/network/receive.ts:730–752](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L730-L752)
   weave() indexes the plain-object `chunks` map with the attacker-chosen first underscore-separated field of the TLV (`ts`). For an inherited property name without underscores (constructor, toString, valueOf, hasOwnProperty, isPrototypeOf, propertyIsEnumerable, toLocaleString) `chunks[ts]` is a truthy Function, so `[...chunks[ts], {i,n,m}]` throws TypeError (function is not iterable). tsconfig target es6 means dist uses native spread, so the throw is real in the shipped build.
2. [src/network/receive.ts:709–727](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L709-L727)
   Non-'{' TLV data is routed to weave() with no try/catch (717). After parsing, line 723 writes `dat.message.amount = value` without checking that message is an object; dist is compiled with "use strict", so a payload whose `message` is a JSON string (truthy) throws TypeError 'Cannot create property amount on string'. The try/catch at 711-715 covers only parseAndVerifyPayload. onReceive is then called un-awaited.
3. [src/network/receive.ts:685–706](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L685-L706)
   For type 28 (keysend) payloads, `memo` is taken from payload.message.content and `sender_pubkey` from payload.sender.pub_key with no type check, then saveAnonymousKeysend is invoked un-awaited (705).
4. [src/network/receive.ts:593–627](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L593-L627)
   saveAnonymousKeysend passes an object-typed memo to Message.create as messageContent (TEXT column) and an object-typed sender_pubkey into a Contact.findOne where clause. Sequelize 5 rejects both (ValidationError 'cannot be an array or an object' from InstanceValidator._validateSchema for STRING/TEXT attributes; 'Invalid value' from SqlString.escape for object where values). The rejection is not observed by anything.
5. [src/grpc/subscribe.ts:25–38](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/subscribe.ts#L25-L38)
   parseKeysendInvoice(inv) is called from the gRPC invoice-stream 'data' callback without await or catch, so any rejection from it becomes a process-level unhandledRejection.
6. [Dockerfile:23–42](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L23-L42)
   Shipped image runs node:16 with `node /relay/dist/app.js` and no --unhandled-rejections flag; no process.on('unhandledRejection') handler exists anywhere in app.ts or src/, so Node's default terminates the process.

## Impact
The whole relay process exits: chat backend, socket.io, MQTT tribe subscriptions and LND invoice stream stop for the owner and, in proxy/hosting mode, for all tenants until an external supervisor restarts it; the attacker can re-crash it at will. No data is read or altered.

## Reproduction steps
1. Attacker is any Lightning node able to route a keysend to the victim's public node (adversary 2). It sets the Sphinx custom TLV record to one of the three byte strings above and pays the minimum amount. No relationship, membership, signature or prior state is required; the TLV reaches parseKeysendInvoice for every settled keysend. The crash is deterministic and reproducible after each restart.

## Recommended fix
1. weave() uses a plain object keyed by attacker-controlled text, so inherited prototype properties are mistaken for existing chunk arrays and spread as iterables. Fix criteria: Chunk storage must not resolve attacker-chosen keys through the prototype chain (own-property lookup or a Map), and a TLV with a first field such as `constructor` must be dropped or treated as a fresh chunk set without throwing; verify by feeding `constructor_0_1_x` as TLV data and confirming the process stays up.
2. parseKeysendInvoice writes dat.message.amount and copies memo/sender_pubkey without verifying the JSON field types, and its downstream calls are un-awaited. Fix criteria: Before any field is written or persisted, payload.message must be verified to be a plain object and content/sender.pub_key to be strings (or the payload discarded); non-conforming payloads must be logged and dropped. Verify with `message:"x"` and object-typed content/pub_key payloads: no unhandled rejection, relay continues processing.
3. parseKeysendInvoice and saveAnonymousKeysend are invoked without await/catch from the gRPC data callback, so any exception becomes a fatal unhandledRejection. Fix criteria: Every promise started from the invoice-stream callback must be awaited inside a try/catch (or chained with .catch) so a malformed invoice logs an error and the stream continues; additionally a process-level unhandledRejection handler should log rather than exit. Verify that an exception thrown anywhere in the keysend parsing path no longer terminates the process.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper Input Validation
**CWE:** [CWE-754](https://cwe.mitre.org/data/definitions/754.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258209

---

# Unauthenticated POST /contacts/tokens with non-string token throws in sha256 and terminates relay

## Details
POST /contacts/tokens (generateToken, src/controllers/contacts.ts:197-263) is the unauthenticated bootstrap route the Sphinx app uses to pair with the relay; src/auth.ts lists it in no_auth. The handler reads `token = req.body['token']` (line 237) whenever the request carries no string `x-transport-token` header, checks only `if (!token)`, and then executes `crypto.createHash('sha256').update(token)` (line 246). express.json() preserves the JSON type of `token`, and Node's Hash.update accepts only string/Buffer/TypedArray/DataView: for `{}`, `[]`, `1` or `true` it throws `TypeError [ERR_INVALID_ARG_TYPE]`.

The hash is computed before the `owner.authToken` comparison at 248-251, so the throw happens on every relay, claimed or not. In the default (non-proxy) mode the preceding `Contact.findOne({ where: { isOwner: true } })` always finds the owner row created by setup, so no knowledge of any pubkey is needed; in proxy mode the attacker supplies an owner pubkey (public Lightning identity) or simply an object-typed `pubkey`, which makes the Sequelize where clause throw instead. If USE_PASSWORD=true, the `?pwd=` gate at 224-231 runs first, but that pairing password is served unauthenticated on GET /connect (see unauthenticated-owner-token-claim-on-fresh-relay), so the gate does not protect the route.

generateToken is `async` with no try/catch; Express 4 (^4.16.4) ignores rejected handler promises; app.ts registers no error middleware and the tree has no process.on('unhandledRejection'). On the shipped node:16 image an unhandled rejection exits the process. Thus a single request - `POST /contacts/tokens` with body `{"token":{}}` - takes the relay offline (HTTP, socket.io, LND invoice stream, MQTT tribe subscriptions, all tenants in proxy/hosting mode) until a supervisor restarts it, and can be repeated indefinitely; the 10 req/s per-IP limiter does not stop a one-request crash. On `config.unlock` deployments the restarted relay additionally waits for a manual /unlock.

This is the /contacts/tokens sibling of swarm-admin-register-unhandled-rejection-crash (same Hash.update sink on a different no_auth route, reachable without knowing any pubkey) and is distinct from unauthenticated-owner-token-claim-on-fresh-relay, which records the first-claim authorization problem in the same function rather than this crash.

## Evidence
1. [src/controllers/contacts.ts:233–246](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L233-L246)
   When no x-transport-token header is present, token = req.body['token'] is taken untyped; after a truthiness check it is passed to crypto.createHash('sha256').update(token). Node's Hash.update throws TypeError [ERR_INVALID_ARG_TYPE] for an object, array, number or boolean. The hash is computed before the owner.authToken comparison, so the crash does not depend on whether the relay has already been claimed.
2. [src/controllers/contacts.ts:197–221](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L197-L221)
   generateToken is an async handler with no try/catch. In non-proxy mode the owner lookup is `{ isOwner: true }` and always succeeds on a set-up relay, so execution reaches line 246 for any request body. In proxy mode a known owner pubkey must be supplied (or an object-typed pubkey makes the where clause itself throw).
3. [src/auth.ts:122–144](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L122-L144)
   '/contacts/tokens' is in the no_auth list: the request reaches the handler with no credential.
4. [src/controllers/index.ts:78](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L78)
   Route registration: app.post('/contacts/tokens', contacts.generateToken).
5. [Dockerfile:23–42](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L23-L42)
   Shipped image runs node:16 (`node /relay/dist/app.js`); no process.on('unhandledRejection') handler or Express error middleware exists in app.ts or src/, so the rejection terminates the process.

## Impact
The relay process exits, stopping the chat API, websocket pushes, inbound Lightning message handling and tribe MQTT for the owner and every co-tenant until restarted; the attacker can keep it down. No confidentiality or integrity impact.

## Reproduction steps
1. Any network client able to reach the relay's HTTP port (exposed to the Internet by design) sends one JSON POST to the unauthenticated /contacts/tokens route with a non-string token (e.g. {"token":{}}). In default single-owner mode no pubkey, password or prior state is needed: the owner row is created by setupOwnerContact and the hash is computed before the authToken comparison. USE_PASSWORD is opt-in ('for extra security' in docs/*_deployment.md, unset in the Dockerfile) and, when set with connect_ui, the password is served by unauthenticated GET /connect. Assumptions: Node's crypto Hash.update throws TypeError [ERR_INVALID_ARG_TYPE] for non-string/non-buffer input; express 4.18.2 (package-lock) does not catch rejected handler promises; node:16 (Dockerfile) terminates on an unhandled rejection by default. The compiled dist/src/controllers/contacts.js:217-227 has the same unguarded shape, and no unhandledRejection/uncaughtException handler exists in the tree.

## Recommended fix
1. generateToken hashes an untyped request field; a non-string token reaches crypto Hash.update, which throws, on an unauthenticated route. Fix criteria: token (and pubkey) must be validated as non-empty strings before hashing or querying, returning HTTP 400 otherwise; verify that `{"token":{}}`, `{"token":1}`, `{"token":["a"]}` and `{"pubkey":{}}` produce error responses while the process keeps running.
2. The async handler has no error containment and the process has no unhandledRejection handler, so any thrown error on this public route is fatal. Fix criteria: Exceptions inside generateToken must be caught and turned into an HTTP failure (try/catch or an async wrapper plus Express error middleware), and a process-level unhandledRejection handler should log rather than exit; verify that an exception thrown anywhere in the handler no longer terminates the relay.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper Input Validation
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258205

---

# Cookie-authenticated GET /test_clear wipes the owner's tenant and reopens unauthenticated token claim (CSRF)

## Details
clearForTesting (src/controllers/details.ts:224-260) is a destructive test helper compiled into and routed by the production relay as GET /test_clear (src/controllers/index.ts:149). For the authenticated owner's tenant it deletes every chat, subscription, bot, invite, media key, message, timer and non-owner contact, then blanks the owner's authToken, contactKey, alias, deviceId, hmacKey and push tokens. The config surface defines allow_test_clearing (src/utils/config.ts:53) but nothing reads it, so the endpoint is live in every deployment, including the Docker image and multi-tenant hosted relays.

The weakness that makes this exploitable by a third party is that the operation is a state-changing GET authenticated by an ambient credential: ownerMiddleware accepts the owner token from req.cookies['x-user-token'] (src/auth.ts:154-155) with cookie-parser mounted globally (app.ts:130), and there is no CSRF token, Origin/Referer check or method restriction; the optional HMAC middleware (src/auth.ts:86-97) is skipped when no signature is present. A top-level navigation to http(s)://<relay>/test_clear from an attacker-controlled page carries SameSite=Lax (or unset) cookies, so the relay executes the wipe as the owner.

The damage is not limited to data loss. Blanking authToken puts the owner row back into the unclaimed state: generateToken behind the auth-exempt POST /contacts/tokens (src/controllers/contacts.ts:248-258) sets authToken to whatever hash the caller presents when the stored value is falsy. An attacker can therefore follow the forged GET with their own unauthenticated token claim (from their server, or from the same page via a cross-origin form/fetch, since CORS allows any origin) and become the relay's owner, with every owner route and the relay's Lightning spending authority behind it. In the default configuration (USE_PASSWORD unset) no check stands in the way of that claim.

The relay never sets these cookies itself and this repository ships no browser client, so the finding holds only where the Sphinx client used with the relay stores the owner token in an x-user-token (or x-transport-token/x-admin-token) cookie for the relay's origin; the auth code explicitly supports exactly that mode. Absent such a client, /test_clear is reachable only with the owner's own header-borne token, which gains that holder nothing beyond what the sanctioned DELETE routes already permit. Assumption: cookie-parser ^1.4.4 (manifest) populates req.cookies from the Cookie header; express 4.18.2 routes the GET.

## Evidence
1. [src/controllers/details.ts:224–259](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/details.ts#L224-L259)
   clearForTesting destroys every Chat, Subscription, Bot, BotMember, ChatBot, Invite, MediaKey, Message, Timer and non-owner Contact of req.owner's tenant and then blanks the owner's authToken, contactKey, alias, deviceId, hmacKey and push tokens (248-255). The only check is that req.owner exists; no feature flag, confirmation, method or CSRF check.
2. [src/controllers/index.ts:149](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L149)
   The handler is routed unconditionally as GET /test_clear in the production router (controllers.set is called from app.ts for every deployment).
3. [src/auth.ts:154–159](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L154-L159)
   ownerMiddleware takes the owner token from req.cookies['x-user-token'] (and x-transport-token / x-admin-token cookies) when the header is absent, so an ambient cookie sent by the browser on a cross-site top-level GET navigation authenticates the request as the owner.
4. [app.ts:130](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L130)
   cookie-parser is mounted globally before ownerMiddleware, making the cookie credential branch live in production; the relay itself never sets these cookies (no res.cookie/Set-Cookie anywhere), so the condition is a client that stores the token as a cookie.
5. [src/controllers/contacts.ts:248–257](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L248-L257)
   generateToken (POST /contacts/tokens, exempt from auth via no_auth) sets owner.authToken to the caller's hash whenever the stored authToken is falsy. Because clearForTesting blanks authToken to '', the wipe returns the relay to the unclaimed state and any unauthenticated caller can claim the owner token afterwards (in proxy mode by supplying the victim's pubkey).
6. [src/utils/config.ts:53](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/config.ts#L53)
   config.allow_test_clearing is loaded from ALLOW_TEST_CLEARING/app.json but referenced nowhere else in src/, so the gate the maintainers evidently intended for this test helper is dead.
7. [src/auth.ts:86–96](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L86-L96)
   hmacMiddleware is opt-in (skipped when the owner has no hmacKey) and accepts a request with no x-hmac signature, so request signing does not prevent the forged GET.

## Impact
All of the tenant's messages, contacts, chats, media keys, bots, invites and the owner's contact key are irreversibly destroyed and the owner's session is invalidated (integrity and availability of the owner's relay data and access). Because authToken is blanked, the unauthenticated first-come claim at POST /contacts/tokens lets the attacker take the owner identity, locking the real owner out and granting read access to node state, invoices, logs and all subsequent traffic plus every owner action including payments. Worst case established by the code is full compromise of the relay for that tenant.

## Reproduction steps
1. Attacker hosts a page (or sends a link) that top-level-navigates the victim's browser to http(s)://<relay>/test_clear. The browser attaches the x-user-token cookie (Lax permits top-level GET), ownerMiddleware resolves the owner, clearForTesting wipes the tenant and blanks authToken. The attacker then POSTs /contacts/tokens (auth-exempt) with their own token and is accepted as owner. Network, no privileges, no defenses to defeat; the victim only has to visit the page (passive). Attack requirement: the victim's client stores the owner token as a cookie for the relay origin, a condition outside the attacker's control.

## Recommended fix
1. A test-only mass-deletion handler is routed in production with no feature gate, although the configuration flag intended to gate it (allow_test_clearing) exists and is never consulted. Fix criteria: /test_clear must not be registered unless allow_test_clearing is explicitly enabled, and never in the shipped Docker image or `npm run prod`; verify that a default deployment returns 404 for GET /test_clear.
2. A state-changing operation is exposed on GET and authenticated by an ambient cookie credential, so a cross-site top-level navigation performs it as the victim. Fix criteria: No state-changing route may be reachable by GET, and any request authenticated via cookie must carry an unforgeable per-request proof (header-borne token, CSRF token, or mandatory signed HMAC) that a cross-site navigation cannot supply; verify that a top-level navigation to the URL from a foreign origin has no effect.
3. Clearing the owner's authToken returns the relay to the unclaimed state in which POST /contacts/tokens accepts any caller's token, so a forced wipe becomes an account takeover. Fix criteria: Any reset of the owner credential must not re-enable unauthenticated token claim (e.g. require re-pairing through an operator-controlled secret or out-of-band confirmation); verify that after a wipe an unauthenticated POST /contacts/tokens is rejected.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-Site Request Forgery
**CWE:** [CWE-352](https://cwe.mitre.org/data/definitions/352.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258204

---

# Tribe owner relay crashes in boost reversal when original message lookup returns null

## Details
The sats-reversal path in src/network/send.ts assumes the original inbound message has already been persisted. initiateReversal (643-657) runs Message.findOne({ tenant, uuid: msg.message.uuid }) and then evaluates `originalMessage.sender !== tenant` without checking for null. msg.message.uuid is the uuid field of the peer's own payload, carried unchanged through forwardMessageToTribe and newmsg.

Attack path (any Lightning node, against a relay that owns a tribe with at least one other member):
1. Attacker learns the uuid of a message in the victim tenant whose sender is not in the tribe's chat.contactIds. The simplest is one it writes itself: a DM from a second pubkey auto-creates a contact and stores a Message with the attacker-chosen uuid (messages.ts 545-587, helpers.ts 180-217). Bot responses (sender -1) broadcast to members, or messages of kicked/departed members, also work.
2. Attacker keysends 1 sat (pricePerMessage+escrow+1 on paid tribes) to the owner with payload { type: 29 (boost), chat: { uuid: <tribe>, type: 2 }, sender: { pub_key: <fresh or member pubkey> }, message: { uuid: <random>, replyUuid: <uuid from step 1> }, error_message: 'x' }. parseAndVerifyPayload returns the payload regardless of signature; an unknown sender pubkey skips the membership gate (receive.ts 163-170).
3. onReceive (receive.ts 225-258) finds ogMsg by replyUuid anywhere in the tenant, computes a positive amtToForward and sets realSatsContactId = ogMsg.sender, then calls forwardMessageToTribe -> sendMessage un-awaited (306-313, 481); concurrently doTheAction -> receiveBoost returns at the error_message branch (messages.ts 653) without storing the boost.
4. In sendMessage realSatsIndex < 0, so after sleep(1000) initiateReversal runs; the lookup by the random uuid returns null; `originalMessage.sender` throws TypeError. The rejection travels out of sendMessage to forwardMessageToTribe's un-awaited call and is never handled; no unhandledRejection/uncaughtException handler exists, and node:16 (Dockerfile) terminates the process.

The same dereference is reached from the catch block (285-288) whenever the forced keysend to a legitimate recipient fails, so an unreachable recipient also crashes the relay if the boost was not stored. If msg.message.uuid is omitted entirely, Sequelize 5 (lock 5.22.5) rejects a where clause containing undefined, producing the same unhandled rejection (assumption about Sequelize behaviour).

In proxy/hosting mode the process serves every tenant, so one 1-sat payload takes down all of them; supervisor autorestart (docker/relay_supervisor.conf) turns a repeated send into a crash loop. The shipped dist/src/network/send.js (lines 139-147, 506-511) contains the same code.

## Evidence
1. [src/network/send.ts:643–656](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L643-L656)
   initiateReversal looks the original message up by {tenant, uuid: msg.message.uuid} and immediately dereferences originalMessage.sender with no null check. msg.message.uuid is the peer-chosen uuid of the inbound boost/direct_payment payload (newmsg at 398-441 passes message through unchanged). When no stored message matches, this throws TypeError inside an async function, i.e. a rejected promise. Identical code ships in dist/src/network/send.js:506-511.
2. [src/network/send.ts:200–209](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L200-L209)
   sendMessage reaches initiateReversal whenever realSatsContactId is set but absent from chat.contactIds ('user is no longer in tribe'); the call is `return await` with no try/catch, so the rejection propagates out of sendMessage. The catch at 285-288 reaches the same function when the forced keysend to the recipient fails.
3. [src/network/receive.ts:225–257](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L225-L257)
   On the tribe owner's relay, any boost/direct_payment carrying replyUuid sets realSatsContactId = ogMsg.sender for ANY message in the tenant with that uuid (no chatId restriction) when the settled amount exceeds pricePerMessage+escrow (1 sat on a free tribe). An unknown sender pubkey leaves senderContactId undefined so the ChatMember gate at 165-170 is skipped and doAction stays true.
4. [src/network/receive.ts:481–499](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L481-L499)
   forwardMessageToTribe calls sendMessage without await or .catch, passing the peer's message object (uuid intact), realSatsContactId and amount; forwardMessageToTribe is itself invoked un-awaited at 306-313 and onReceive is un-awaited from the keysend subscription (757). The rejection from sendMessage is therefore unobserved. No process.on('unhandledRejection'/'uncaughtException') exists in the repository; the Docker image is node:16-buster-slim, whose default is to terminate the process.
5. [src/controllers/messages.ts:653–661](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L653-L661)
   receiveBoost (and receivePayment, payment.ts:185-194) returns via onReceiveReversal before Message.create when payload.error_message is present, so a boost that carries error_message is never stored and the reversal lookup by the same uuid deterministically returns null. onReceiveReversal itself tolerates the unknown uuid (messageToJson(null) returns {}), so this handler completes normally and only the send.ts path throws.
6. [src/controllers/messages.ts:545–586](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L545-L586)
   A replyUuid target the attacker fully controls: a DM (conversation-typed payload) from a second pubkey makes parseReceiveParams auto-create a contact (helpers.ts:180-217) and receiveMessage stores a Message with the attacker-chosen uuid and sender = that contact id, which is never in the tribe's chat.contactIds. Bot responses (botapi/broadcast.ts:68-88, sender -1) and messages of kicked/departed members (chats.ts:97-99, 799-801) are alternative targets.

## Impact
Process termination of the relay (all tenants in proxy mode); in-flight messages and pending payments are lost and the attack is repeatable at will. No confidentiality or integrity effect beyond the crash.

## Reproduction steps
1. Any Lightning node that can keysend the victim's node and knows a public tribe uuid the victim owns sends one boost payload with error_message and a replyUuid naming a bot message or a message of a non-member. Cost is one minimal keysend; no credentials, no user action, no special configuration. The crash is deterministic because the error_message branch guarantees the boost is never stored.

## Recommended fix
1. initiateReversal dereferences the result of a uuid lookup driven by peer input without a null check, and reversePayment/initiateReversal failures are not contained within sendMessage. Fix criteria: A reversal whose original message cannot be found must be logged and abandoned without throwing; sendMessage must catch and report (via the failure callback) any error from initiateReversal/reversePayment so that no rejection escapes to un-awaited callers. Verify that a boost with error_message and an unknown uuid replying to a non-member's message leaves the process running.
2. forwardMessageToTribe and onReceive dispatch sendMessage/handlers without awaiting or catching, so any handler exception becomes an unhandled rejection that terminates Node 16. Fix criteria: All peer-triggered async dispatch must be awaited inside try/catch or otherwise observed, and the process should register an unhandledRejection handler that logs rather than exits; verify that a thrown handler error no longer terminates the process.

---
**Severity:** HIGH
**Status:** Open
**Category:** NULL pointer dereference
**CWE:** [CWE-476](https://cwe.mitre.org/data/definitions/476.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258203

---

# Object-typed uuid in inbound message payload crashes relay via unhandled rejection

## Details
Inbound Lightning keysend payloads are JSON authored entirely by the remote node; parseAndVerifyPayload (src/network/receive.ts:578-590) returns them even when the signature is invalid, and onReceive checks only dest, payload.type and payload.chat.uuid before dispatch. src/controllers/messages.ts forwards two of those fields - message.uuid and message.replyUuid - verbatim into Sequelize queries: receiveDeleteMessage (type 17) builds `where = { uuid: msg_uuid, tenant, sender }` and calls Message.findOne (lines 783-787); receiveBoost (type 29) writes uuid/replyUuid via Message.create (665-700) and looks replyUuid up with findOne (705-708). Message.uuid and Message.replyUuid are plain string columns (src/models/sql/message.ts:14,96).

Assumption (sequelize 5.22.5 per package-lock.json, dialect sqlite or postgres): in v5 WHERE values are escaped inline, and a plain object whose key is not an operator symbol reaches SqlString.escape, which throws Error('Invalid value {...}') for any value without a .replace method; on create, the instance validator rejects an object assigned to a STRING attribute ('cannot be an array or an object'). Either way the awaited call throws inside the async handler and the handler's promise rejects.

Nothing catches it: doTheAction calls ACTIONS[type](payload) un-awaited (receive.ts:387), onReceive is called un-awaited from parseKeysendInvoice (726) and receiveMqttMessage (529), the gRPC invoice 'data' callback has no catch (src/grpc/subscribe.ts:25-40), and no process.on('unhandledRejection') handler exists in app.ts or src/. Under node:16 (Dockerfile, no --unhandled-rejections flag) an unhandled rejection is fatal by default, so the relay process exits.

Concrete trigger, no prior relationship needed: any Lightning node keysends the victim the minimum amount with TLV payload {"type":17,"sender":{"pub_key":"<any 66-hex>"},"chat":{"uuid":"x"},"message":{"uuid":{"a":1}}}. onReceive finds the owner; chat.type is absent so the payload is a conversation and skips the tribe gating; parseReceiveParams creates a contact and a conversation chat for the attacker (helpers.ts:302-315); receiveDeleteMessage then runs Message.findOne({ where: { uuid: {a:1}, tenant, sender } }), which throws, and the process dies. A type-29 boost with message.uuid or message.replyUuid set to an object reaches the same outcome at Message.create. Varying chat.uuid defeats the in-memory r_hash dedupe, and repeating the keysend after each supervisor restart keeps the relay (and every tenant on it in proxy mode) offline.

This is distinct from the verified record inbound-payload-shape-unhandled-rejection-crash (missing chat/message objects -> TypeError in confirmation/heartbeat/group handlers): here the payload is well-formed in shape, and the handler-level null checks that record calls for would not stop it; the type of the identifier fields is what is trusted. The un-awaited dispatch is the shared amplifier.

## Evidence
1. [src/controllers/messages.ts:783–787](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L783-L787)
   receiveDeleteMessage places the payload-supplied msg_uuid (dat.message.uuid, any JSON value) directly into a Sequelize where clause. A plain object such as {"a":1} is not a valid where value for a STRING column and the query builder throws; the await rethrows and the handler's promise rejects.
2. [src/controllers/messages.ts:665–708](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L665-L708)
   receiveBoost (ACTIONS[29]) puts the payload's uuid and replyUuid into Message.create (lines 665-700) and then uses replyUuid as a where value (705-708). Both columns are plain @Column string attributes (src/models/sql/message.ts:14,96); a JSON object in either field rejects at create (Sequelize v5 instance validator 'string violation' for object values on STRING attributes) or, failing that, at findOne (SqlString.escape throws). The `as string` cast is compile-time only.
3. [src/network/receive.ts:384–387](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L384-L387)
   doTheAction invokes ACTIONS[payload.type](payload) without await or try/catch, so the handler's rejection is dropped.
4. [src/network/receive.ts:720–727](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L720-L727)
   parseKeysendInvoice calls onReceive(dat, dest) without await; onReceive (line 354) likewise does not await doTheAction. receiveMqttMessage (529) has the same shape, its try/catch cannot see the un-awaited rejection.
5. [src/grpc/subscribe.ts:25–39](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/subscribe.ts#L25-L39)
   The invoice stream 'data' callback fires parseKeysendInvoice(inv) with no catch; no process.on('unhandledRejection') handler exists anywhere in the repository (rg over src/ and app.ts).
6. [src/helpers.ts:271–276](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L271-L276)
   parseReceiveParams derives msg_uuid = dat.message.uuid || '' (271) and reply_uuid = dat.message.replyUuid (276) with no type validation; a truthy object survives the `|| ''` default and is passed verbatim to the handlers.
7. [Dockerfile:23](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L23)
   The shipped image runs node:16, where the default --unhandled-rejections=throw turns an unhandled rejection into an uncaught exception that terminates the process.

## Impact
Availability HIGH: the relay process terminates, taking down the HTTP API, socket.io and the invoice subscription for every tenant sharing the process; repeatable indefinitely at the keysend minimum per crash. Side effect only: an attacker-named contact and conversation chat row are created before the crash. No confidentiality or integrity impact.

## Reproduction steps
1. Any Lightning node sends one minimal keysend (type 17 delete or type 29 boost) whose message.uuid or message.replyUuid is a JSON object. No authentication, no victim interaction, no prior contact or chat (parseReceiveParams creates both), deterministic on the first payload. Assumptions: Node 16 image default --unhandled-rejections=throw with no handler registered; sequelize 5.22.5 SqlString.escape throws on non-string/non-array objects and its instance validator rejects objects for STRING attributes.

## Recommended fix
1. Handlers use JSON fields from untrusted payloads (message.uuid, message.replyUuid, and by extension chat.uuid, sender.pub_key) as Sequelize where values without validating that they are strings. Fix criteria: Every identifier taken from an inbound payload must be validated as a bounded string before any database lookup; non-string values must cause the payload to be discarded with a logged error, never an exception. Verify by sending the payload described and confirming the process stays up and no row is created.
2. Inbound-message dispatch (parseKeysendInvoice -> onReceive -> doTheAction -> ACTIONS[type]) never awaits or catches handler promises and the process has no unhandledRejection handler, so any handler exception is fatal. Fix criteria: A rejection from any ACTIONS handler must be caught and logged at the dispatch boundary, and a process-level unhandledRejection handler must prevent termination; verify by injecting a throwing handler and confirming the process continues to serve requests.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncaught exception
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258202

---

# Member relays accept tribe-typed messages from any node, allowing spoofed tribe posts

## Details
In the Sphinx tribe model every message a member sees is supposed to pass through the tribe owner's relay, which enforces membership, price-per-message, the spam list and alias uniqueness (uniqueifyAlias), then re-signs and broadcasts over MQTT; members themselves send tribe traffic only to chat.ownerPubkey (send.ts:195-201). The member-side receive path, however, decides how to store a message purely from the payload's own chat.type and chat.uuid and never verifies that a tribe-typed payload actually originated from the tribe owner.

Path: any Lightning node keysends the victim a payload { type: 0, chat: { uuid: <tribe uuid>, type: 2 }, sender: { pub_key: <anything>, alias: 'Admin', photo_url: ... }, message: { content, uuid, date, push: true } }. parseKeysendInvoice (receive.ts:709-728) passes it to onReceive, which finds the chat by uuid/tenant, sees the victim is not the tribe owner (receive.ts:132-137), skips every gate and dispatches to receiveMessage (354). parseReceiveParams (helpers.ts:320-333) cannot find the pubkey as a contact and synthesises sender = { id: 0, alias }. receiveMessage (messages.ts:573-608) stores the message in the tribe chat with the attacker's alias, picture URL and 'person' link, emits it over socket.io as a tribe message, and fires a push notification ('You have N new messages in <tribe>'), with payload.message.push overriding a mentions-only mute (notify.ts:114). receiveBoost (679-686) and receiveVoip (995-1017) follow the same pattern: fake boosts (amount = the settled keysend, min 1 sat) and an incoming-call push with an attacker-chosen caller name and link_url.

Consequences: a non-member can post into any member's view of any tribe whose uuid they know (public tribes are listed on the tribe server), impersonate the tribe owner or any member by alias and photo (uniqueifyAlias only runs on the owner's node), and bypass price_per_message, the spam list and private-tribe approval, all without the tribe owner or other members ever seeing the message. The injected message is stored and displayed only on the targeted relay.

This is distinct from the verified records conversation-payload-chat-uuid-injection-into-tribe-or-dm (conversation-typed payload bound to a tribe uuid via findOrCreateChatByUUID, which creates a real contact and does not set senderAlias) and inbound-payload-signature-verification-result-ignored (the discarded signature). Even with signatures enforced this defect remains: a payload genuinely signed by the attacker's own node still passes, because nothing at a non-owner relay compares the sender pubkey with chat.ownerPubkey for tribe-typed traffic. The shipped build dist/src/helpers.js:272 and dist/src/controllers/messages.js:480/550/814 carry the same code.

## Evidence
1. [src/helpers.ts:320–332](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L320-L332)
   parseReceiveParams, the shared parameter resolver for receiveMessage/receiveBoost/receiveVoip, takes the group branch from the payload's own chat.type, looks the sender up by the claimed pub_key and, when no contact exists and chat_type is tribe, fabricates sender = { id: 0, alias: sender_alias } so every handler's '!sender' guard passes for a completely unknown node. It resolves the chat by uuid within the tenant but never requires that, at a non-owner relay, sender_pub_key equals chat.ownerPubkey. This is the shared point where a tribe-typed payload from a non-owner must be rejected.
2. [src/network/receive.ts:132–137](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L132-L137)
   onReceive computes isTribeOwner = owner.publicKey === maybeChat.ownerPubkey and applies membership, price-per-message, spam-list and uniqueifyAlias gating (lines 140-319) only when the receiving owner IS the tribe owner. At a member relay isTribeOwner is false, nothing checks payload.sender.pub_key against maybeChat.ownerPubkey, and doAction stays true, so line 354 dispatches straight to ACTIONS[type].
3. [src/controllers/messages.ts:573–607](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L573-L607)
   receiveMessage treats chat_type from the payload as authoritative: for tribe-typed payloads it stores the attacker-supplied sender_alias, sender_photo_url and person on the message row (sender possibly the synthetic id 0), emits it over socket.io as a message of the tribe chat, and calls sendNotification with force_push = payload.message.push, which notify.ts:114 honours to override the chat's mentions-only mute. With DEFAULT_STORE_CACHE '' (config.ts:33) cached is false and the row is always created.
4. [src/controllers/messages.ts:679–685](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L679-L685)
   receiveBoost has the identical pattern: a tribe-typed boost from any node is stored with attacker alias/pic and the settled keysend amount (min 1 sat) and surfaced as a boost in the tribe chat.
5. [src/controllers/messages.ts:995–1016](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L995-L1016)
   receiveVoip stores a tribe-typed call message with attacker alias/pic and triggers sendVoipNotification(owner, { caller_name: sender.alias, link_url: text }) - an incoming-call push with an attacker-chosen caller name and link URL.
6. [src/network/receive.ts:709–727](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L709-L727)
   Keysend ingress: parseKeysendInvoice runs for every settled keysend from any Lightning node, parses the TLV payload (parseAndVerifyPayload returns it regardless of signature validity), overwrites only message.amount with the settled value, and hands chat.uuid, chat.type and sender.* to onReceive as the peer authored them.

## Impact
Integrity LOW: the attacker inserts arbitrary messages, boosts and call events into the victim's tribe chats under any alias and photo, defeating owner moderation, payment gating and the alias anti-impersonation control; existing data is not modified and the injection is visible only on the targeted relay. Confidentiality NONE: nothing is read. Availability NONE.

## Reproduction steps
1. Attacker is any Lightning node (threat-model adversary 2). They need a tribe uuid (public via the tribe server) and the victim's node pubkey (public), then send a single keysend carrying a tribe-typed Sphinx TLV payload; the victim must hold a Chat row for that uuid (be a member), which an attacker can satisfy by spraying public tribe uuids. No credentials, no victim action, default configuration (STORE_CACHE empty); the only cost is the minimum keysend amount.

## Recommended fix
1. The member-side receive path (onReceive and parseReceiveParams) accepts tribe-typed payloads from any sender when the receiving owner is not the tribe owner, and parseReceiveParams fabricates a sender record for unknown pubkeys instead of rejecting them. Fix criteria: At a non-owner member's relay, a tribe-typed payload must be processed only if the (signature-verified) sender pubkey equals the stored chat's ownerPubkey; payloads from any other pubkey must be dropped before any handler runs, creating no message row, socket event or notification. Verify by keysending a tribe-typed message, boost and call from a fresh node to a member and confirming nothing is stored or emitted.
2. Handlers select tribe semantics (senderAlias/senderPic/person storage) from the payload's chat.type rather than the stored chat's type. Fix criteria: Tribe-specific storage and notification behaviour must be driven by the stored Chat row's type for the resolved uuid, not by the peer-supplied chat.type.

---
**Severity:** HIGH
**Status:** Open
**Category:** Origin validation error
**CWE:** [CWE-346](https://cwe.mitre.org/data/definitions/346.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258201

---

# signAndSend awaits the signer outside its try/catch, so a signer failure crashes the shared relay via unhandled rejection

## Details
signAndSend (src/network/send.ts 317-370) wraps its body in an async Promise executor and performs `const sig = await LND.signAscii(data, ownerPubkey)` at line 336, before the try/catch that begins at line 339. If signAscii rejects, (a) the async executor's internal promise rejects and nothing observes it, so Node emits unhandledRejection, and (b) the promise returned to the caller stays pending forever, so sendMessage's per-recipient try/catch (send.ts 216-293) and its failure callback never fire. The repository registers no unhandledRejection or uncaughtException handler (app.ts, src/, dist/app.js), and the Dockerfile ships node:16-buster-slim, where the default --unhandled-rejections mode is throw: the rejection is raised as a fatal uncaught exception and the process exits.

signAscii -> signMessage -> signBuffer (lightning.ts 736-768) rejects whenever loadLightning throws or LND's SignMessage errors. In proxy (multi-tenant) mode loadLightning(true, ownerPubkey) (lightning.ts 131-140) throws 'no lightning client' whenever loadProxyLightning (proxy.ts 181-203) cannot read `<ownerPubkey>.macaroon`: loadProxyCredentials readFileSync's ENOENT is caught and swallowed into undefined. The ownerPubkey used is owner.publicKey from the caller's Contact row, and an authenticated tenant can rewrite its own owner publicKey to any string through PUT /contacts/:id (contacts.ts 315-349, extractAttrs allow-lists public_key; verified as update-contact-owner-pubkey-rewrite-tenant-hijack).

Attack (proxy mode, authenticated co-tenant): PUT /contacts/<own id> {"public_key": "<any 66-char string with no macaroon file>"}, then POST /messages to any of the attacker's own chats. messages.ts sendMessage passes sender = req.owner into network.sendMessage, which calls signAndSend(opts, sender, ...) (send.ts 277-283); signAscii rejects with 'no lightning client', the rejection is unhandled, and the single shared relay process exits. Every tenant's HTTP API, socket.io, LND invoice subscription and MQTT delivery stop until the supervisor restarts the process, and the attacker's rewritten row persists so the attacker (or any inbound traffic for that owner via sendConfirmation or replayChatHistory, both un-awaited) can crash it again immediately after each restart.

The same defect also turns any ordinary signer error (LND SignMessage failing for a single call) into a process exit rather than a failed message, because the one place that could catch it does not. Correct behaviour is for signAndSend to reject so sendMessage records the error for that message and calls the failure callback.

This is the behaviour described in ledger item lead-send-326-7be5, read to a conclusion; the dismissal dismissed-send-326-a4f9 ('only on local signer failure') does not account for the co-tenant-controlled publicKey lever.

## Evidence
1. [src/network/send.ts:326–339](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L326-L339)
   signAndSend returns `new Promise(async function (resolve, reject) {...})`. Line 336 `const sig = await LND.signAscii(data, ownerPubkey)` sits before the try block that opens at line 339. When signAscii rejects, the async executor's own promise rejects with no listener (the Promise constructor discards it), so Node emits unhandledRejection, while the promise returned to the caller never settles, so sendMessage's per-recipient try/catch and failure callback never run. This is where the fix belongs.
2. [src/grpc/lightning.ts:736–767](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L736-L767)
   signBuffer (reached via signAscii -> signMessage) rejects whenever loadLightning(true, ownerPubkey) throws or the LND SignMessage gRPC call returns an error or empty signature.
3. [src/grpc/lightning.ts:131–139](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L131-L139)
   In proxy mode (isProxy() true, ownerPubkey set) loadLightning calls loadProxyLightning(ownerPubkey) and throws new Error('no lightning client') when it returns undefined.
4. [src/utils/proxy.ts:158–203](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L158-L203)
   loadProxyLightning uses any 66-character ownerPubkey as the macaroon file name; loadProxyCredentials does fs.readFileSync(proxy_macaroons_dir + '/' + pubkey + '.macaroon'), and the ENOENT is caught at line 202 and swallowed into an undefined return. An owner row whose publicKey is a 66-char string with no macaroon file therefore makes every signAscii call for that tenant reject.
5. [src/controllers/contacts.ts:315–348](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L315-L348)
   updateContact (PUT /contacts/:id) matches the caller's own owner row (tenant == id) and writes extractAttrs output including `public_key` (allow-list at 688-704) straight into contact.update, so an authenticated tenant can set its owner publicKey to an arbitrary 66-char string on demand (verified separately as update-contact-owner-pubkey-rewrite-tenant-hijack).
6. [src/controllers/messages.ts:355–513](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L355-L513)
   POST /messages (sendMessage controller) passes `sender: owner` where `const owner = req.owner` (line 389) into network.sendMessage, which calls signAndSend(opts, sender, ...) for each recipient (send.ts 277-283); the rewritten owner publicKey is what signAscii receives, so one ordinary message from the attacker's tenant triggers the unhandled rejection.
7. [src/controllers/confirmations.ts:15–43](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/confirmations.ts#L15-L43)
   sendConfirmation -> network.sendMessage -> signAndSend runs un-awaited on every inbound message, and chatTribes.ts replayChatHistory (asyncForEach at 822, un-awaited; signAndSend inside at ~895) runs on every tribe join: once the signer for an owner is failing, any inbound traffic for that owner terminates the process too, and there is no process-level unhandledRejection handler anywhere in the tree.

## Impact
Termination of the single shared relay process: every co-tenant's HTTP API, socket.io, LND invoice subscription and MQTT delivery stop until supervisor restart, and the persisted publicKey rewrite lets the attacker repeat the crash at will (A HIGH, crossing the tenant boundary). No confidentiality or integrity impact from this defect itself.

## Reproduction steps
1. Attacker is an ordinary authenticated tenant on a proxy-mode relay (threat-model adversary 5, PR LOW). Two requests behind ownerMiddleware only: PUT /contacts/<own id> with a 66-char public_key that has no macaroon file, then POST /messages to any own chat. Deterministic (ENOENT -> undefined -> throw -> reject -> unhandled), no race, no user interaction. Proxy mode is the deployment in which this attacker position exists at all rather than an added condition, so AT NONE. Assumption: Node 16 (Dockerfile node:16-buster-slim) default --unhandled-rejections=throw terminates the process on an unhandled rejection when no handler is registered, and none is in this tree.

## Recommended fix
1. signAndSend awaits LND.signAscii outside its try/catch inside an async Promise executor, so a signer rejection is neither propagated to the caller nor observed anywhere. Fix criteria: Any failure of signAscii must reject the promise returned by signAndSend so that callers' existing try/catch and failure callbacks handle it, and must never produce an unhandled rejection; verify that a signer error during POST /messages, sendConfirmation and replayChatHistory results in a logged failure for that message while the process keeps running.
2. The process registers no unhandledRejection handler, so any escaped rejection is fatal under the Node 16 default. Fix criteria: Register a process-level unhandledRejection handler that logs and continues (and audit un-awaited async dispatches such as sendConfirmation and replayChatHistory's asyncForEach); verify that an injected rejection in a network send path no longer terminates the relay.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncaught exception
**CWE:** [CWE-248](https://cwe.mitre.org/data/definitions/248.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258200

---

# Received invoice amount decoded as 0 for valid BOLT11 forms; owner pays full amount

## Details
Invoices received from peers (`receiveInvoice`) are decoded for display with the project's own decoder (src/utils/decode), while payment (`payInvoice`) hands the raw string to LND. The two disagree on valid BOLT11 amounts, and the project decoder fails open to 0.

`decodeAmount` returns `'error'` when (a) the numeric part begins with '0' (`'0100u'`), or (b) there is no multiplier letter (`'1'`, `'2'` — whole-BTC amounts, where the last character is a digit). `decodePaymentRequest` then does `if (Number.isInteger(amount)) {...}` and otherwise leaves `sat = 0, msat = 0`, so the stored Message has `amount: 0`, which the app presents as a zero/any-amount invoice. BOLT11 permits both forms for readers (leading zeros are only a writer MUST-NOT; multiplier-less amounts are BTC). Assumption about the pinned backend: LND's zpay32 `decodeAmount` parses the digits with `strconv.ParseUint`, which accepts `"0100"` as 100, and treats a trailing digit as a BTC amount; CLN/Greenlight behave the same for these forms. Under that assumption a malicious contact crafts e.g. `lnbc0100u1...` (10,000 sats, chosen to fit the victim's balance) or `lnbc1...` (1 BTC), signs it normally, and sends it as an `invoice` payload with a memo such as "50 sats for the file".

The victim's app shows a 0-sat invoice with the attacker's memo. When the owner taps pay, the client calls `PUT /invoices` with only the `payment_request` (there is no amount field in this API), `Lightning.sendPayment` pays the amount LND decodes — the full 10,000 sats — and `payInvoice` then writes a `payment` Message with `amount: message.amount` = 0, so the payment history also misrepresents the outflow.

A zero-amount display is a strong cue for "cheap/any amount" and the API offers the owner no way to cap the amount, so the deception converts directly into loss of funds up to the attacker-chosen value. The root defect is a fail-open decoder: an unparseable amount should be a hard error (and the message rejected or flagged), not 0, and the display amount should come from the same decoder the payment path trusts (the `@boltz/bolt11` library is already used elsewhere in this file). This is distinct from the decoder DoS recorded at the same handler: that one hangs/crashes on malformed strings; this one mis-reports well-formed ones.

## Evidence
1. [src/utils/decode/decode.js:80–106](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/decode/decode.js#L80-L106)
   decodeAmount returns the string 'error' for any amount whose digits begin with '0' (line 83, e.g. '0100u') and for any amount with no multiplier letter (whole-BTC form such as '1': the trailing digit is taken as the multiplier and falls to the default case at line 104). Both are forms a BOLT11 reader accepts (leading zero is only a writer MUST NOT) and that the Lightning backend decodes and pays.
2. [src/utils/decode/index.ts:27–34](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/decode/index.ts#L27-L34)
   decodePaymentRequest checks Number.isInteger(amount); the 'error' sentinel (and any non-integer) silently yields sat = 0 and msat = 0 instead of failing, so an undecodable amount is reported as a zero-amount invoice.
3. [src/controllers/invoices.ts:316–355](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L316-L355)
   receiveInvoice decodes the peer-supplied payment_request with the project decoder, stores the Message with amount: sat (0) and amountMsat: msat (0), and pushes it to the owner's app over socket.io as a 0-sat invoice with the attacker's memo.
4. [src/controllers/invoices.ts:44–87](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L44-L87)
   payInvoice (PUT /invoices) takes only payment_request from the body, hands the raw bolt11 to Lightning.sendPayment (the backend decodes and pays the real amount), then records the outgoing payment Message with amount: message.amount, the mis-decoded 0, so the relay's own ledger understates the outflow.
5. [src/grpc/lightning.ts:314–375](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L314-L375)
   sendPayment submits the bolt11 string as-is to LND (sendPayment stream / sendPaymentSync in proxy mode), Greenlight or CLN with only a fee limit; no amount cap is applied, so the amount paid is whatever the backend decodes from the string.
6. [src/controllers/index.ts:260](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L260)
   ACTIONS maps inbound payload type `invoice` to invoices.receiveInvoice; doTheAction dispatches any keysend payload of that type to it.
7. [src/network/receive.ts:562–590](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L562-L590)
   parseAndVerifyPayload returns the payload even when the sender signature does not verify ('=> RM THIS'), so any Lightning node can deliver the invoice payload without a valid signature or prior relationship.
8. [src/helpers.ts:301–314](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L301-L314)
   For a conversation-type payload parseReceiveParams auto-creates a contact and chat for an unknown sender pubkey, so receiveInvoice's owner/sender/chat check passes for an arbitrary remote node.

## Impact
Integrity high: the owner is induced to send an attacker-chosen amount of Lightning funds (bounded only by the victim's balance and the fee limit) while believing the invoice is 0 sats, and the relay's own payment ledger records 0 for the outflow; funds are irrecoverable. No confidentiality or availability effect.

## Reproduction steps
1. Any Lightning node keysends the relay a conversation payload of type `invoice` (contact and chat are auto-created; signature failure is ignored) whose bolt11 string carries an amount in leading-zero form (e.g. 'lnbc0100u...' = 10,000 sat) or whole-BTC form ('lnbc1...'), signed with the attacker's own node key. The relay stores and displays the invoice as 0 sats with the attacker's memo. The owner must then actively choose to pay it (UI:ACTIVE); PUT /invoices carries no amount, and the backend pays the embedded amount. Assumption, stated because the Lightning backend is an external binary not pinned in this repository: LND's zpay32 decodeAmount parses the digits with strconv.ParseUint (accepts '0100' as 100) and treats a trailing digit as a BTC amount, so these strings are valid, payable invoices to LND; CLN/Greenlight are assumed to accept at least the leading-zero form. The Sphinx client is outside this repository and is assumed to present the relay-supplied amount. No configuration dependency.

## Recommended fix
decodePaymentRequest maps any amount it cannot parse (including valid leading-zero and whole-BTC encodings) to 0 instead of failing, so the displayed amount can differ from the amount the Lightning backend will pay. Fix criteria: The amount shown for a received invoice must equal the amount the payment path will pay for the same string, or the invoice must be rejected/flagged as undecodable; an unparseable amount must never be presented as 0. Verify with 'lnbc0100u...' and 'lnbc1...' style invoices that the stored amount matches the backend's decode or the message is refused.

---
**Severity:** HIGH
**Status:** Open
**Category:** Encoding confusion
**CWE:** [CWE-436](https://cwe.mitre.org/data/definitions/436.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258199

---

# Unauthenticated GET /connect triggers unhandled promise rejection that terminates the relay

## Details
GET /connect is unauthenticated (src/auth.ts:134 no_auth; ownerMiddleware and hmacMiddleware both pass it through) and mounted whenever config.connect_ui is set (app.ts:135-140; opt-in via the CONNECT_UI env or config key, src/utils/config.ts:139) on the Internet-facing relay port, before the unlock gate at app.ts:183, so it is live on a locked relay. On LND (non-Greenlight) relays its handler (src/utils/connect.ts:182-202) runs several awaits inside the async callback passed to fs.readFile with no try/catch: makeVarScript() -> isClean() (DB), Lightning.listChannels({}) and one getChanInfo per channel; get_hub_pubkey(); getQR() -> getIP(). fs.readFile discards the callback's promise, so any rejection is unhandled and the HTTP response is never ended.

A rejection is deterministic or easy to wait for:
- unlock mode (config.unlock): getMacaroon() returns '' until POST /unlock succeeds (src/utils/macaroon.ts:8-11; src/auth.ts:19-60 is the only setter), so LND, which by default requires a valid macaroon on every Lightning RPC, errors each listChannels call -> reject(err) (src/grpc/lightning.ts:992) -> makeVarScript rejects;
- LND unreachable, restarting, or wallet still locked (the relay registers /connect and listens in setupApp() before grpc.reconnectToLightning succeeds, app.ts:56-62): listChannels rejects; if the TLS cert or macaroon file is unreadable, loadLightning throws inside listChannels' `new Promise(async ...)` executor (lightning.ts:970-996), which is itself an unhandled rejection that no caller's try/catch can reach;
- getChanInfo rejecting ('edge not found'/zombie edge) for any listed channel;
- PUBLIC_URL and NODE_IP unset and the public-ip lookup failing: theIP stays undefined and `theIP.includes('://')` throws TypeError (connect.ts:43).

The shipped runtime is node:16 (Dockerfile:1,23; Dockerfile.swarm:1,24), where an unhandled rejection is raised as an uncaught exception and terminates the process by default (Node >= 15), and neither app.ts nor src registers an unhandledRejection/uncaughtException handler or passes --unhandled-rejections (package.json scripts; only commented-out SIGTERM/exit handlers at app.ts:170-180). The committed dist/src/utils/connect.js:209-220 has the same structure. One unauthenticated GET /connect in any of those states therefore exits the relay process. In unlock mode this is persistent: supervisor restarts the relay (docker/relay_supervisor.conf autorestart=true) still locked, and an attacker polling /connect kills it again before the owner can POST /unlock, keeping the node's chat backend down indefinitely. In the non-crash variants the request hangs with no response. The Greenlight branch (greenlightConnect) only awaits getQR() via localip.address() and is not affected, so the finding holds for LND relays with connect_ui enabled.

makeVarScript's output is also dead: connect.ts:194 looks for `<script>var hi='hello';</script>` but public/index.html:89 is formatted `var hi = 'hello'` on its own line, so the LND calls that create this exposure serve no purpose on the shipped page.

## Evidence
1. [src/utils/connect.ts:182–202](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/connect.ts#L182-L202)
   connect() awaits makeVarScript(), get_hub_pubkey() and getQR() inside the async callback passed to fs.readFile with no try/catch. fs.readFile ignores the returned promise, so any rejection is unhandled and the response is never ended. This is the code the fix must change.
2. [src/utils/connect.ts:57–97](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/connect.ts#L57-L97)
   makeVarScript calls Lightning.listChannels and then Lightning.getChanInfo for every channel; both reject on any gRPC error (empty macaroon before unlock, LND unreachable/locked, 'edge not found'). Its result is also never used: the replace target at line 194 does not match the formatted public/index.html:89.
3. [src/grpc/lightning.ts:970–996](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L970-L996)
   listChannels wraps `await loadLightning(...)` in `new Promise(async (resolve, reject) => ...)` and calls reject(err) on any gRPC error. If loadLightning throws (loadCredentials fails) the async executor's rejection is itself unhandled and the outer promise never settles; the same pattern is used by listPeers (952-968) and connectPeer (1035-1050).
4. [src/utils/macaroon.ts:8–11](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/macaroon.ts#L8-L11)
   In unlock mode getMacaroon returns the in-memory macaroon, which is '' until POST /unlock (src/auth.ts:19-60) succeeds, so every LND RPC made by /connect before unlock fails and rejects - a deterministic state that recurs after every process restart.
5. [app.ts:135–140](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L135-L140)
   GET /connect is registered when config.connect_ui is set, before the unlock gate at line 183 and before grpc.reconnectToLightning (line 58) has connected, so it is reachable on a locked relay or while LND is unavailable; it is in the no_auth list (src/auth.ts:134).
6. [src/utils/connect.ts:17–49](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/connect.ts#L17-L49)
   getIP: when public_url and NODE_IP are unset and publicIp.v4() throws (no outbound DNS/HTTPS), theIP stays undefined and line 43 `theIP.includes('://')` throws TypeError, rejecting getQR(); greenlightConnect's path uses localip.address() and does not throw.
7. [Dockerfile:1](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L1)
   The shipped images run on node:16 (also line 23 and Dockerfile.swarm:1,24). Node >= 15 raises an unhandled rejection as an uncaught exception and terminates the process by default, and no process.on('unhandledRejection'/'uncaughtException') handler or --unhandled-rejections flag exists in app.ts, src or package.json scripts (only commented-out SIGTERM/exit handlers at app.ts:170-180).
8. [dist/src/utils/connect.js:209–220](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/dist/src/utils/connect.js#L209-L220)
   The committed compiled output that the Docker image runs has the same structure: fs.readFile('public/index.html', ...) with the __awaiter-wrapped callback yielding makeVarScript() and getQR(), its promise discarded.
9. [docker/relay\_supervisor.conf:3–6](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/docker/relay_supervisor.conf#L3-L6)
   autorestart=true with effectively unlimited startretries: after the crash the relay is restarted, in unlock mode still locked (in-memory macaroon is per process), so a polling attacker can kill it again before the owner can POST /unlock.

## Impact
Process termination of the relay (all chat, payment-receipt processing, MQTT/tribe and socket.io services stop until restart; repeatable, and in unlock mode sustainable indefinitely) is a total loss of availability of the component (A:H). No confidentiality or integrity impact.

## Reproduction steps
1. Attacker: any host reaching the relay port of an LND deployment with connect_ui enabled (opt-in flag; the Internet-facing port is by design). Issue one GET /connect; if the relay is locked (unlock mode, before the owner's POST /unlock), LND is unreachable/restarting/wallet-locked, a channel edge is missing, or the public-IP lookup fails, a promise rejects inside the detached fs.readFile callback and the node:16 process exits. Repeat after each supervisor restart to keep it down. No credentials or user action. Success depends on a runtime state outside the attacker's direct control (AT:PRESENT), though the locked-before-unlock state is deterministic, recurs on every restart and persists until the owner acts. Assumption: LND (default config, macaroons enabled) rejects Lightning RPCs carrying an empty macaroon.

## Recommended fix
1. connect()/greenlightConnect() await fallible LND, hub and IP-lookup operations inside an fs.readFile async callback with no rejection handling, so errors escape as unhandled rejections and the response is left open. Fix criteria: Every awaited operation in the /connect handlers must be caught and turned into an HTTP error response; verify that GET /connect on a relay whose LND is unavailable or locked, or whose public-IP lookup fails, returns an error page and the process keeps running.
2. getIP() dereferences theIP after the public-IP lookup fails, and lightning.ts wraps `await loadLightning()` in async Promise executors so loadLightning failures escape every caller's try/catch. Fix criteria: getIP must return a defined value or throw a handled error when no address source is available; the gRPC wrappers must resolve/reject the outer promise on loadLightning failure. Verify no code path in the connect routes can produce an unhandled rejection.
3. The process has no last-resort handler for unhandled rejections, so a single escaped promise kills a long-running network service. Fix criteria: An unhandledRejection handler should log and keep the service alive (or the deployment must guarantee immediate restart); verify a forced rejection in a request handler no longer terminates the relay.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncaught exception
**CWE:** [CWE-248](https://cwe.mitre.org/data/definitions/248.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258198

---

# Malformed peer purchase payloads throw in un-awaited handlers, crashing the relay process

## Details
Inbound Lightning keysend payloads are dispatched by `doTheAction` -> `ACTIONS[payload.type](payload)` (src/network/receive.ts:384-388) with neither `await` nor `catch`; `doTheAction` is itself un-awaited at receive.ts:354, `onReceive` at receive.ts:726 and `parseKeysendInvoice` in the LND invoice stream handler (src/grpc/subscribe.ts:35). The tribe-owner branches call `purchaseFromOriginalSender` (receive.ts:338) and `sendFinalMemeIfFirstPurchaser` (receive.ts:349) the same way. Any exception thrown inside these async handlers becomes an unhandled promise rejection. The shipped runtime is Node 16 (`node:16-buster-slim`, `CMD node /relay/dist/app.js`; `npm run prod`/`start-ecs` likewise pass no `--unhandled-rejections` flag), and no `process.on('unhandledRejection')` or `uncaughtException` handler exists in app.ts, src/ or dist/, so Node's default (`throw`) terminates the process. The relay (and in proxy mode every tenant) is offline until restarted; in-memory state (chunk reassembly `chunks`, dedupe `hashCache`, MQTT clients, socket.io sessions) is lost each time, and the dedupe cache is keyed on the payment hash, so each new keysend is processed afresh.

Triggers, all deterministic and reachable by an arbitrary Lightning node (parseAndVerifyPayload returns the payload even on a bad or missing signature):
1. `receivePurchaseAccept` (src/controllers/media.ts:467): send `{type: 8, chat: {uuid: 'x'}, sender: {pub_key: <any 66-hex>}, message: {}}`. With no chat.type, parseReceiveParams (src/helpers.ts:301-312) auto-creates the sender contact and a conversation chat, the `!owner || !sender || !chat` guard passes, and `mediaToken.split('.')` on `undefined` throws TypeError. No prior relationship with the victim is needed; cost is one minimum keysend (~3 sats).
2. `receivePurchase` (media.ts:331): same shape with `type: 7` and `message: {mediaToken: 1}` (any truthy non-string) throws TypeError after the auto-created-chat guard; with a real string token, parseLDAT at media.ts:354 throws on malformed meta once ogMessage/MediaKey match (a contact who has received an attachment).
3. `purchaseFromOriginalSender` (src/network/modify.ts:79) on any tribe owner: send `{type: 7, chat: {uuid: <public tribe uuid>, type: 2}, sender: {pub_key: <any>}, message: {mediaToken: 'a.b.c.d.' + base64('x"=%')}}`; `purchase` is not in typesToForward so no price/membership gate applies, `myAttachmentMessage` is not found (attacker-chosen host/muid), and `parseLDAT` throws from `deserializeMeta` (src/utils/ldat.ts:207-223: JSON.parse SyntaxError on a quote, or URIError from decodeURIComponent on a bare `%`). Public tribe uuids are listed by the tribe server.
4. `sendFinalMemeIfFirstPurchaser` (modify.ts:175) on any tribe owner with a `purchase_accept` carrying `purchaser` and a malformed-meta token, before its try block.

The verified record inbound-payload-shape-unhandled-rejection-crash documents the same uncaught dispatch for the confirmation/heartbeat/group handlers; this finding covers the media/purchase handlers, whose distinct defects are the unchecked `mediaToken` dereference and the throwing `parseLDAT`/`deserializeMeta` on attacker-authored token meta. Root weakness: absence of exception containment around peer-driven handlers (CWE-248) combined with handlers that dereference optional payload fields without checks.

## Evidence
1. [src/controllers/media.ts:447–471](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/media.ts#L447-L471)
   receivePurchaseAccept calls `mediaToken.split('.')` on dat.message.mediaToken with no presence/type check; a purchase_accept payload without mediaToken (or a non-string one) throws TypeError after parseReceiveParams has already auto-created the sender contact and chat for any Lightning node.
2. [src/controllers/media.ts:330–356](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/media.ts#L330-L356)
   receivePurchase (ACTIONS[7]) passes its `!owner || !sender || !chat` guard for any node because parseReceiveParams auto-creates a conversation chat and contact, then evaluates `mediaToken && mediaToken.split('.')` (line 331): a non-string truthy mediaToken (e.g. 1 or {}) throws TypeError. The parseLDAT(mediaToken) call at line 354 additionally throws on malformed meta, but only after an ogMessage and MediaKey match, i.e. for a contact who has received an attachment from the victim. Neither is wrapped.
3. [src/network/modify.ts:70–80](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/modify.ts#L70-L80)
   purchaseFromOriginalSender (tribe owner, any sender, no contact needed) calls parseLDAT(mt) outside any try/catch; a malformed meta segment throws.
4. [src/network/modify.ts:158–175](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/modify.ts#L158-L175)
   sendFinalMemeIfFirstPurchaser calls parseLDAT(mt) before its try block; same throw.
5. [src/utils/ldat.ts:207–222](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/ldat.ts#L207-L222)
   deserializeMeta builds JSON by string replacement and JSON.parse (SyntaxError on a quote or odd `=`/`&` layout) and runs decodeURIComponent in the reviver (URIError on a bare `%`), so an attacker-chosen meta segment reliably throws.
6. [src/network/receive.ts:384–387](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L384-L387)
   doTheAction invokes ACTIONS[type](payload) without await or catch; receive.ts lines 338 and 349 likewise call purchaseFromOriginalSender and sendFinalMemeIfFirstPurchaser un-awaited. The resulting rejected promises are unhandled.
7. [Dockerfile:1–41](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L1-L41)
   Production runs `node /relay/dist/app.js` on node:16 with no --unhandled-rejections flag, and the codebase registers no process 'unhandledRejection'/'uncaughtException' handler, so an unhandled rejection terminates the process (Node >= 15 default).

## Impact
Full loss of availability of the relay (the user's messaging and payment backend) for the duration of each restart, repeatable indefinitely; in-memory state such as chunked-message reassembly is lost each time. No confidentiality or integrity impact.

## Reproduction steps
1. Any Lightning node that can route a keysend to the victim's pubkey sends one payload of type purchase_accept (8) with no mediaToken, or type purchase (7) with a non-string mediaToken, to any relay; or type purchase with a malformed-meta token to a tribe owner. No authentication, no existing contact, no valid signature; the handler throws deterministically inside an un-awaited async chain (subscribe.ts:35 -> parseKeysendInvoice -> onReceive -> doTheAction -> handler) and the process exits. Repeatable at ~3 sats per crash; hashCache dedupe is per payment hash so it does not block repeats. Assumption: Node 16 (the pinned image base node:16-buster-slim; no engines field for `npm run prod`) defaults to --unhandled-rejections=throw, which with no 'unhandledRejection'/'uncaughtException' handler terminates the process.

## Recommended fix
1. Peer-driven async handlers are invoked without await/catch and the process has no unhandled-rejection safety net, so any thrown error terminates the relay. Fix criteria: Exceptions raised while processing an inbound payload must be contained to that payload (caught and logged at the dispatch point) and must never terminate the process; verify that the malformed purchase_accept and purchase payloads above are logged and dropped while the relay keeps serving requests.
2. receivePurchase, receivePurchaseAccept, purchaseFromOriginalSender and sendFinalMemeIfFirstPurchaser dereference optional payload fields (mediaToken) and parse untrusted LDAT meta without validation. Fix criteria: Validate that mediaToken is a string with the expected segment count before use, and make parseLDAT/deserializeMeta return a failure value instead of throwing on malformed input; verify that tokens with arbitrary meta bytes are rejected without an exception escaping the handler.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncaught Exception
**CWE:** [CWE-248](https://cwe.mitre.org/data/definitions/248.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258197

---

# Unauthenticated POST /ml with process_id "__proto__" throws and terminates the relay

## Details
`processMlCallback` (src/controllers/botapi/index.ts:339-357) is mounted at POST /ml (src/controllers/index.ts:154) and listed in `no_auth` (src/auth.ts:142), so anyone who can reach the HTTP port reaches it with no credential. It reads `req.body.body.process_id` and does `if (CALLBACKS[process_id]) CALLBACKS[process_id](response)`. `CALLBACKS` is a module-level plain object literal (`src/builtin/ml.ts:36`) that exists whether or not the ML bot is installed, and the lookup is an ordinary property access that walks the prototype chain. A body `{"body":{"process_id":"__proto__","response":"x"}}` makes `CALLBACKS["__proto__"]` evaluate to `Object.prototype` (truthy, not callable) and the call throws `TypeError: CALLBACKS[process_id] is not a function`; `"__defineGetter__"` likewise reaches `Object.prototype.__defineGetter__` and throws because its second argument is not a function.

The handler is `async` with no try/catch around the call, so the TypeError becomes a rejected promise. Express 4 (lock: 4.18.2) does not observe promises returned by route handlers, app.ts registers no error-handling middleware, and neither app.ts, src/ nor the committed dist/ installs a `process.on('unhandledRejection')` or `uncaughtException` handler (app.ts:170-180 has only commented-out SIGTERM/exit hooks). The shipped image runs the same code (dist/src/controllers/botapi/index.js:305-306) on node:16 (Dockerfile:1,23), where an unhandled rejection terminates the process by default. One request therefore kills the relay: gRPC invoice subscriptions, MQTT tribe subscriptions and socket.io sessions are torn down. The main Dockerfile runs `node /relay/dist/app.js` directly, so recovery depends on the operator's container restart policy (only the lndrelay supervisord image autorestarts); where `config.unlock` is enabled the restarted relay additionally has no macaroon until the owner manually POSTs /unlock. The 10 req/s rate limit is irrelevant to a single-request crash, which can be repeated after every restart.

The absence of authentication on the same handler, which lets a holder of a live process_id spoof the ML bot's reply, is a separate defect recorded as ml-callback-registry-process-id-only-unauthenticated-response-spoofing; the fix for this crash (own-property/function check, rejection handling) does not address it.

Assumptions on pinned dependencies: express 4.18.2 does not route handler promise rejections to error handling; Node 16 defaults to `--unhandled-rejections=throw`; no installed dependency registers a process-level rejection handler (dependencies not inspected).

## Evidence
1. [src/controllers/botapi/index.ts:339–357](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L339-L357)
   process_id from the unauthenticated JSON body indexes the plain CALLBACKS object and the result is invoked with no own-property or typeof check and no try/catch; the async handler's TypeError becomes an unhandled rejection.
2. [src/builtin/ml.ts:36](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/ml.ts#L36)
   CALLBACKS is a module-level plain object literal (always present, independent of ML bot installation), so inherited keys such as __proto__ and __defineGetter__ resolve to truthy non-callable or argument-checking values.
3. [src/auth.ts:122–144](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L122-L144)
   /ml is in no_auth; ownerMiddleware and the admin middleware call next() without any token check, so the handler runs for unauthenticated requests.
4. [src/controllers/index.ts:154](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L154)
   Route registration of POST /ml to processMlCallback.
5. [app.ts:90–198](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L90-L198)
   Express 4 app with json body parsing, no error-handling middleware and no unhandledRejection/uncaughtException handler (only commented-out SIGTERM/exit hooks at 170-180); async handler rejections are process-fatal.
6. [dist/src/controllers/botapi/index.js:305–306](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/dist/src/controllers/botapi/index.js#L305-L306)
   The committed dist that the Docker image executes contains the same unchecked CALLBACKS[process_id](response) call.
7. [Dockerfile:23](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L23)
   Runtime image is node:16, where unhandled rejections terminate the process by default; CMD runs node directly with no supervisor, so recovery depends on the operator's restart policy.

## Impact
Complete loss of the relay service (message receipt, payments, tribe forwarding, socket.io sessions) until the process is restarted by the operator's container policy, and until manual POST /unlock on encrypted-macaroon deployments; repeatable with one request per restart. The crash itself discloses or modifies no data.

## Reproduction steps
1. Any network client sends one unauthenticated POST /ml with JSON body {"body":{"process_id":"__proto__","response":"x"}}. no_auth (src/auth.ts:142) skips all token checks; processMlCallback indexes the plain CALLBACKS object, gets Object.prototype, and calls it, throwing a TypeError inside an async handler. With no try/catch, no Express error middleware and no process-level rejection handler, the Node 16 process exits. Deterministic, works against the shipped defaults regardless of whether the ML bot is installed, needs no credential or victim interaction.

## Recommended fix
1. Untrusted key used to index a prototype-bearing object and the result invoked without checking it is an own-property function. Fix criteria: CALLBACKS is a Map or null-prototype object and the handler only invokes an entry when hasOwnProperty is true and typeof is 'function'; unknown process_ids return an error. Verify: process_id values __proto__, constructor, __defineGetter__ produce a 4xx response and the process stays up.
2. Async Express 4 handlers have no rejection handling, so any thrown error in a no_auth route is process-fatal. Fix criteria: Route handlers are wrapped so rejections become error responses, and the process installs an unhandledRejection handler that logs instead of exiting. Verify: a thrown error in any handler yields a 500 and the server keeps serving.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncaught exception
**CWE:** [CWE-248](https://cwe.mitre.org/data/definitions/248.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258193

---

# Unauthenticated POST /webhook with repository lacking full_name throws and terminates the relay

## Details
`processWebhook` (src/controllers/botapi/index.ts:55-148) is mounted at POST /webhook and is in `no_auth` (src/auth.ts:138). Before any HMAC verification it does, at line 72-74 and outside the try/catch that starts at line 82:

```
if ('repository' in event) {
  repo = event.repository?.full_name.toLowerCase() || ''
}
```

Optional chaining only guards `event.repository` being nullish; when `repository` is present but has no `full_name` (or `full_name` is not a string) the expression is `undefined.toLowerCase()` and a TypeError is thrown. The only prerequisites are that the `x-hub-signature-256` and `x-github-event` headers are non-empty — their values are never checked before this point. So the request `POST /webhook` with headers `x-hub-signature-256: a`, `x-github-event: push` and body `{"repository":{}}` (or `{"repository":{"full_name":1}}`) throws from an `async` route handler.

Express 4 (^4.16.4) does not catch promise rejections from handlers; app.ts installs no error middleware and no `process.on('unhandledRejection')`; the Docker image runs node:16 (Dockerfile:23), where an unhandled rejection exits the process. One unauthenticated request therefore stops the relay (gRPC/MQTT/socket subscriptions dropped) until the supervisor restarts it, and on `config.unlock` deployments until the owner manually unlocks again. This is the GitHub-webhook sibling of the same pattern in `processMlCallback`.

A second, lower-probability variant in the same handler: if anything inside the try block throws (e.g. a DB error), the catch calls `unauthorized(res)` and the code after the try/catch calls `unauthorized(res)` again, which throws ERR_HTTP_HEADERS_SENT from the same async function with the same fatal outcome.

## Evidence
1. [src/controllers/botapi/index.ts:70–78](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L70-L78)
   Lines 72-74: `if ('repository' in event) repo = event.repository?.full_name.toLowerCase() || ''`. Optional chaining guards only a nullish `repository`; a body of {"repository":{}} or {"repository":{"full_name":1}} makes `.toLowerCase()` throw a TypeError synchronously inside the async handler, before the try/catch at line 82 and before the HMAC verification at line 96. Compiled equivalent in dist/src/controllers/botapi/index.js:44 (`_a.full_name.toLowerCase()`).
2. [src/controllers/botapi/index.ts:140–148](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L140-L148)
   Catch path responds and then the post-try code responds again, a second fatal throw path.
3. [src/auth.ts:122–144](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L122-L144)
   /webhook is in no_auth.
4. [src/controllers/index.ts:155](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L155)
   Route registration of POST /webhook.
5. [app.ts:90–198](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L90-L198)
   No error middleware or unhandledRejection handler; Express 4 async handler rejections are fatal on Node 16.
6. [Dockerfile:23](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L23)
   Runtime node:16 terminates on unhandled rejections by default.

## Impact
The relay process exits: all gRPC/MQTT/socket.io subscriptions drop and every owner (all tenants in proxy mode) loses service until a supervisor restarts it; on config.unlock deployments (app.ts:183-196) routes are not re-registered until the owner POSTs /unlock again. No confidentiality or integrity effect.

## Reproduction steps
1. Any network client sends POST /webhook with arbitrary non-empty x-hub-signature-256 and x-github-event headers and JSON body {"repository":{}} (express.json always yields an object or array for a JSON body, so the `in` test passes and `.full_name` is undefined). The TypeError is thrown at line 73 before the HMAC check, escapes the async handler as a rejected promise, and no code in app.ts or src/ registers an error middleware, unhandledRejection or uncaughtException handler. Assumptions, stated from the manifest: express 4.18.2 (package-lock) does not catch promise rejections from route handlers; the node:16 runtime (Dockerfile:23, package.json prod script) defaults to --unhandled-rejections=throw, which exits the process on an unhandled rejection with no handler installed. Deterministic, single request, no credentials; the 10 req/s limiter is irrelevant to a one-shot kill.

## Recommended fix
1. Attacker-shaped webhook body is dereferenced without type checks before authentication, inside an async handler whose exceptions are process-fatal. Fix criteria: The handler validates that repository.full_name is a string (or guards with optional chaining on full_name) and wraps the whole body in error handling that returns 4xx; verification of the HMAC should precede any parsing of body fields. Verify: bodies {"repository":{}} and {"repository":{"full_name":1}} return 401/400 and the process stays up.
2. Double response in the catch/after-try paths. Fix criteria: Exactly one response is written per request; the catch path returns after responding.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncaught exception
**CWE:** [CWE-248](https://cwe.mitre.org/data/definitions/248.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258191

---

# Forged group_leave silently evicts any tribe or group member from owner and member relays

## Details
group_leave (type 15) is the message a member's relay sends when the user leaves a tribe or group. receiveGroupLeave (src/controllers/chats.ts:771-860) treats payload.sender.pub_key as the leaver: on the tribe owner's relay, or on any relay for a plain group (`!isTribe || isTribeOwner`, line 792), it looks the pubkey up as a Contact, strips that contact id from chat.contactIds and, for tribes, destroys the ChatMember row and reports the new member count to the tribe server. The sender identity is the only authorisation and it is not authenticated: parseAndVerifyPayload (receive.ts:562-591) returns the payload for invalid, absent or unverifiable signatures (root record inbound-payload-signature-verification-result-ignored, which does not enumerate this sink).

Attack (tribe): any Lightning node keysends min_sat (3 sats) to the tribe owner's node with {type:15, chat:{uuid:<tribe uuid, public on the tribe server>, type:2}, sender:{pub_key:<victim member's pubkey>}, message:{}}. onReceive (owner path, 137-319) resolves senderContact from the claimed pubkey, finds group_leave in typesToForward with no price gate, calls forwardMessageToTribe — which broadcasts 'left' to every member except skipPubKey = the forged victim (481-498) — and dispatches receiveGroupLeave. Result: the victim is removed from contactIds (no further broadcasts reach them, send.ts:113-227), their ChatMember row is gone (their later posts fail the membership gate at receive.ts:165-172 and are silently discarded), the owner sees a 'Someone left' system message, and the victim's own relay keeps a chat that is now dead. To recover they must notice, leave and re-join — paying priceToJoin again for priced tribes and re-requesting approval for private ones. Member pubkeys are not broadcast in tribe traffic, so the attacker needs the victim's node pubkey (known to anyone they have DM'd, from people.sphinx.chat profiles, invite links or the Lightning graph); the owner's pubkey and tribe uuid are public.

Attack (plain group, chat type 1): the same payload sent to each group member's relay removes the victim from that relay's contactIds (the `!isTribe` branch), fragmenting the group so the victim no longer receives messages from those members. Group uuids are known to current and former members (see group-join-unauthenticated-self-insertion).

Sibling on the owner relay: receiveMemberRequest (chatTribes.ts:239-353) is reachable with the same forged identity for private tribes; its ChatMember.upsert (302-310) rewrites the existing (chat_id, contact_id) row — the unique index at src/models/sql/chatMember.ts:6 / migrate.ts:205 makes upsert an update — to role reader / status pending and emits a member_request event, so an approved member reappears in the owner's pending list; if the owner rejects it, approveOrRejectMember destroys the row (chatTribes.ts:583-586). ChatMember.role is not consumed for authorisation anywhere in the relay (bot admin checks use the wire role), so the role rewrite itself has no privilege effect; the status/pending surfacing and the eviction via rejection are the impact.

The handlers themselves could not have been expected to do more than trust a verified sender, so this is primarily a consequence of the signature bypass, filed at its own sink because the effect (silent eviction with the victim deliberately excluded from the notification) is distinct from anything on record. Ships in dist/app.js.

## Evidence
1. [src/controllers/chats.ts:771–821](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L771-L821)
   receiveGroupLeave identifies the leaver solely by payload sender_pub_key (793-795); on the tribe owner (isTribeOwner) or for any non-tribe group it removes that contact from chat.contactIds (799-801) and, for tribes, destroys the ChatMember row (806-808). No check that the payload was authored by that member.
2. [src/network/receive.ts:137–148](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L137-L148)
   On the owner relay the tribe block resolves senderContact purely from payload.sender.pub_key; group_leave is in typesToForward (50-58) and is not price-gated, so doAction stays true.
3. [src/network/receive.ts:481–498](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L481-L498)
   forwardMessageToTribe broadcasts the leave to the tribe with skipPubKey = payload.sender.pub_key — i.e. the forged victim — so the evicted member is the one node that is never told.
4. [src/network/receive.ts:165–172](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L165-L172)
   After the ChatMember row is destroyed, the victim's subsequent message/attachment/boost/payment posts fail the membership gate and are dropped as 'insufficient payment', while the victim's relay still believes it is a member.
5. [src/network/send.ts:113–116](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L113-L116)
   Owner broadcasts iterate chat.contactIds; once removed, the victim receives no further tribe traffic.
6. [src/network/receive.ts:562–591](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L562-L591)
   parseAndVerifyPayload returns the payload on any signature outcome, so sender.pub_key is attacker-chosen (root record inbound-payload-signature-verification-result-ignored).
7. [src/controllers/chatTribes.ts:302–310](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L302-L310)
   Sibling on the same trust decision: receiveMemberRequest upserts the (contactId, chatId) row with role reader and status pending, so a forged member_request from an existing approved member's pubkey flips that member to pending and surfaces a bogus join request in the owner's UI.
8. [src/models/sql/chatMember.ts:3–7](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/models/sql/chatMember.ts#L3-L7)
   Unique index on (chat_id, contact_id) makes the upsert an UPDATE of the existing member row rather than an insert.
9. [src/controllers/chatTribes.ts:580–585](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L580-L585)
   If the owner rejects the spurious request, approveOrRejectMember destroys the ChatMember row — the same eviction outcome via the owner's own action.

## Impact
Tribe/group roster integrity is violated (any member can be removed by a stranger) and the victim loses the service they joined or paid for without notice; their subsequent posts are dropped. No confidentiality impact; the chat data itself is not destroyed.

## Reproduction steps
1. Any Lightning node with the public tribe uuid and the victim member's node pubkey keysends a 3-sat type-15 payload claiming the victim as sender to the tribe owner's node; no signature is required (parseAndVerifyPayload returns the payload on any verification outcome). On the owner relay maybeChat.ownerPubkey matches, group_leave is in typesToForward with no price gate, decryptMessage/encryptTribeBroadcast/detectMentionsForTribeAdminSelf all tolerate message:{} (as the legitimate leave sent by deleteChat also carries), so forwardMessageToTribe broadcasts the leave to everyone except skipPubKey=the victim and receiveGroupLeave strips the victim from contactIds and destroys their ChatMember row. For plain groups the same payload is sent to each member relay. No user interaction, no prior relationship, deterministic. Assumption for the member_request sibling (not verifiable in this checkout): sequelize 5.22.5 Model.upsert on a model with a unique (chat_id, contact_id) index updates the existing matching row rather than inserting a duplicate.

## Recommended fix
1. The leaver (and member_request requester) identity is taken from payload.sender.pub_key, which the ingress never authenticates against the payload signature. Fix criteria: Roster-changing handlers act only on a sender identity positively bound to a valid signature (the ingress drops unsigned/invalid payloads and the recovered key must equal sender.pub_key). Verify by sending a group_leave claiming another member with a bogus or absent signature and observing no change to contactIds or ChatMember.
2. receiveMemberRequest's upsert overwrites an existing approved member's row (status pending, role reader) instead of only creating a request for non-members. Fix criteria: A member_request for a contact who already holds an approved ChatMember row leaves that row unchanged and does not surface a new pending request. Verify by sending member_request for an approved member and checking status/role are unchanged.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper authentication
**CWE:** [CWE-290](https://cwe.mitre.org/data/definitions/290.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258190

---

# Unauthenticated boost payload with error_message flips any known message to failed

## Details
Boost/payment reversal is a tribe-owner-to-member signal: when the tribe owner cannot forward boost sats to the original poster, send.ts initiateReversal/reversePayment keysends the boost back to the payer with `error_message` set, and the payer's relay marks its original message failed. The receiving side in receiveBoost (src/controllers/messages.ts:653-662; the identical branch exists in receivePayment, src/controllers/payment.ts:185-194) implements this as 'if payload.error_message is present, run onReceiveReversal on payload.message.uuid' before any check of who sent it, whether the referenced message was sent by this owner to that sender, whether it was a boost/payment at all, or whether any sats were returned.

Any Lightning node can therefore keysend the victim's node a TLV payload { type: 29 (boost), chat: { uuid: <any>, type: 0 }, sender: { pub_key: <attacker> }, message: { uuid: <target uuid> }, error_message: '<attacker text>' } with the minimum amount. parseAndVerifyPayload (receive.ts) returns the payload whether or not the signature verifies; because chat.type is not tribe, onReceive (receive.ts:114-134) applies no tribe-owner/membership gating and dispatches ACTIONS[29] = receiveBoost; parseReceiveParams (helpers.ts:301-319) auto-creates a contact and a conversation chat for the unknown pubkey so the owner/sender/chat guard passes; onReceiveReversal (src/utils/reversal.ts:23-31) then runs Message.update({ status: failed(4), errorMessage: <attacker text> }, { where: { tenant, uuid } }) and pushes the altered record to the owner's app over socket.io as a 'boost' event.

Uuid knowledge is delivered by the protocol itself: sendMessage (messages.ts:427,466) puts the uuid of every outgoing message/boost/payment in the payload sent to each recipient, and the tribe owner forwards members' messages to all members with the same uuid, so any correspondent or tribe co-member learns the uuids of the victim's sent and received messages. The attacker can mark any such message failed with arbitrary text; a payee who received a direct payment from the victim can mark that payment failed, which both shows it as failed in the app and hides it from GET /payments (listPayments, payment.ts:269,284 exclude status failed by default) while the payee keeps the funds. No funds move on the relay itself; the impact is integrity of message status and error text for every message whose uuid the attacker knows.

This is distinct from tribe-delete-message-no-sender-authorization (different handler, different status transition, and attacker text is persisted).

## Evidence
1. [src/controllers/messages.ts:653–662](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L653-L662)
   receiveBoost routes every payload carrying error_message to onReceiveReversal with msgUuid = payload.message.uuid before any other validation; it never checks that the sender is the tribe owner who returned the sats, nor that the referenced message was sent by this owner to that sender or is a boost at all.
2. [src/utils/reversal.ts:23–31](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/reversal.ts#L23-L31)
   onReceiveReversal updates every message in the tenant with that uuid to status failed (4) and persists the attacker-supplied errorMsg verbatim, then emits the record to the owner's client over socket.io; the where clause constrains only tenant and uuid.
3. [src/controllers/payment.ts:185–194](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/payment.ts#L185-L194)
   receivePayment has the identical unconditional error_message branch, so a direct_payment-typed payload reaches the same sink; a fix must cover both callers.
4. [src/network/receive.ts:114–134](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L114-L134)
   isTribe is taken from payload.chat.type, and the owner-side membership/price gating runs only when isTribe && owner is tribe owner; a conversation-typed (type 0) payload is dispatched straight to ACTIONS[type] with no gating.
5. [src/helpers.ts:301–319](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L301-L319)
   For conversation-typed payloads parseReceiveParams auto-creates a contact and a chat for any unknown sender pubkey, so receiveBoost's owner/sender/chat guard is satisfied with no prior relationship.
6. [src/network/send.ts:643–657](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L643-L657)
   The legitimate producer of error_message is the tribe owner's initiateReversal/reversePayment, sent back to the original boost sender together with the returned sats; the receiver trusts the field from anyone because no origin or ownership binding is enforced.
7. [src/controllers/payment.ts:269–284](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/payment.ts#L269-L284)
   listPayments excludes status failed by default, so a payment the victim made and the attacker flips to failed disappears from the owner's payment history while the payee keeps the funds.

## Impact
Integrity LOW: the status of any message whose uuid the attacker knows is set to failed and an attacker-written errorMessage is persisted and shown to the owner; a payee can hide a received payment from the victim's GET /payments list. Content is unchanged and no funds move on the relay. No confidentiality or availability impact.

## Reproduction steps
1. Any Lightning node keysends one boost-type (29) payload with error_message and a known message uuid to the victim's pubkey; no prior contact is needed (the conversation path auto-creates one), the signature is not enforced and would be the attacker's own anyway, the amount is the keysend minimum, and no victim action or deployment setting is involved. The uuid is delivered to the attacker by the protocol when they are a correspondent or tribe co-member of the victim.

## Recommended fix
receiveBoost and receivePayment honour error_message from any sender and onReceiveReversal updates by tenant+uuid alone, so the reversal protocol has no origin or ownership binding. Fix criteria: A reversal is applied only when the signature-verified sender is the owner of the tribe in which the referenced message was sent, the referenced message was sent by this owner (sender === tenant) in that chat, and it is a boost or direct_payment; otherwise the payload is ignored. This applies to both callers of onReceiveReversal. Verify by sending the described payload from a fresh node and confirming the target message status and errorMessage are unchanged.

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
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258189

---

# Co-tenant plants chat with victim ownerPubkey; leaderboard posts victim's node-signed token to attacker host

## Details
In sphinx-proxy multi-tenant mode (isProxy(): proxy_lnd_port && proxy_macaroons_dir && proxy_tls_location) one relay process and database host many owner contacts (isOwner: true, created by generateNewUser, proxy.ts:111-121), each with a sub-node whose macaroon is selected by owner publicKey (loadLightning(true, ownerPubkey) -> loadProxyLightning -> <pubkey>.macaroon). The periodic leaderboard job (app.ts:78, every 30 minutes, unconditional) iterates every owner contact and selects tribes with `Chat.findAll({ where: { ownerPubkey: contact.publicKey } })` (leadershipboard.ts:28-30) with no tenant filter. For any such chat whose ChatMember rows carry a `lastAlias`, it mints a fresh node-signed timestamp for that owner (`genSignedTimestamp(contact.publicKey)` -> `LND.signBuffer(ts, ownerPubkey)`, i.e. signed by the named owner's sub-node) and POSTs it as `?token=` to `${protocol}://${tribe.host}/leaderboard/${tribe.uuid}` (leadershipboard.ts:39-50).

Both `ownerPubkey` and `host` of a Chat row are authored by whichever tenant joins the tribe. Attacker tenant B calls POST /tribe (controllers/index.ts:234 -> doJoinTribe) with `owner_pubkey` = victim tenant A's owner pubkey, `host` = an attacker-controlled hostname and a fresh `uuid`/`group_key`; the handler validates none of these (chatTribes.ts:75-78 only checks presence) and stores them verbatim with `tenant: B` (chatTribes.ts:116-131, 167-169) once the group_join keysend to the owner_pubkey contact settles (send.ts:179-185, 268-280 -> LND.keysendMessage via B's proxy client). B then calls POST /tribe_member (index.ts:236 -> addTribeMember) with that chat_id, any pub_key/contact_key and an `alias`: the chat is looked up by id+tenant only (chats.ts:555-557) and addMemberToTribe is called with `isTribeOwner: true` unconditionally (chats.ts:572), so it upserts a ChatMember row with `lastAlias: alias` (chats.ts:638-660). On the next leaderboard tick the relay, acting for owner A, signs a timestamp with A's sub-node key and sends it to B's host. A performs no action and sees nothing. Earlier readers dismissed leadershipboard.ts on the premise that lastAlias is only set on genuine tribe-owner paths; chats.ts:572 breaks that premise (the peer-supplied isTribeOwner flag honoured in receiveGroupJoin, already on record, is a second way).

The token has no audience binding and is the same format the relay presents for owner-only operations on the tribe server (tribes.ts:573-577 delete, 528-531 edit, 615-618 activity, 644-647 stats), as the MQTT password (tribes.ts:112), and to the people/boltwall servers (people.ts:125-129 /withdraw, 216-218 /transfer_badge); the relay's own verifySignedTimestamp never checks the timestamp (tribes.ts:768-778). B receives a freshly minted token for A every 30 minutes, so any freshness window those servers apply does not help A.

Root cause: the leaderboard job treats Chat.ownerPubkey as the identity to sign for and Chat.host as the destination, although both are written by the joining tenant and the row is not scoped to the owner's tenant; compounded by addTribeMember granting owner-only ChatMember creation (lastAlias) to any chat the caller holds.

Conditions and assumptions: requires a proxy-mode deployment with at least two owners (HOSTING_PROVIDER without proxy resolves a single owner, auth.ts:184-189, so it has no victim). The 3-sat group_join keysend from B's virtual node to A's virtual node must settle; this relies on sphinx-proxy (separate repository, version not pinned here) routing payments between its own virtual nodes, which is the ordinary path by which co-tenants message each other (the relay only short-circuits locally for tribe-owner broadcasts, send.ts:243-249). Single-owner relays are unaffected.

## Evidence
1. [src/utils/leadershipboard.ts:28–50](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/leadershipboard.ts#L28-L50)
   For every isOwner contact, Chat rows are selected by ownerPubkey alone (no tenant filter, 28-30) and ChatMember rows by chatId (33-35); if any member has lastAlias, genSignedTimestamp(contact.publicKey) is minted (39) and POSTed as ?token= to `${tribe.host}/leaderboard/${tribe.uuid}` (42-50). Host comes from the row, the signing identity from the owner the row names.
2. [src/controllers/chatTribes.ts:44–182](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L44-L182)
   doJoinTribe (POST /tribe, any authenticated tenant) only checks presence of owner_pubkey/group_key/uuid (75-78) and stores body.host and body.owner_pubkey verbatim into Chat.host and Chat.ownerPubkey with the caller's tenant (116-131, create at 167-169) once the group_join keysend succeeds; nothing checks that owner_pubkey is not another local owner's key or that host is the configured tribes host.
3. [src/controllers/chats.ts:550–575](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L550-L575)
   addTribeMember (POST /tribe_member) looks the chat up by id+tenant only (555-557) and calls addMemberToTribe with isTribeOwner: true unconditionally (572), so the joining (non-owner) tenant can create owner-only ChatMember rows on the planted chat.
4. [src/controllers/chats.ts:638–663](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L638-L663)
   With isTribeOwner true, addMemberToTribe upserts a ChatMember with lastAlias = caller-supplied alias (652-660); a truthy lastAlias is the only condition parseLeaderRecord needs for the leaderboard POST to fire.
5. [src/utils/tribes.ts:732–765](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L732-L765)
   genSignedTimestamp(ownerPubkey) looks up the owner contact by publicKey and calls LND.signBuffer(ts, ownerPubkey): the token is the named owner's node-signed timestamp, the same format used for owner-only tribe-server, MQTT and people/boltwall calls.
6. [src/grpc/lightning.ts:736–766](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L736-L766)
   signBuffer loads the per-owner proxy client (loadLightning(true, ownerPubkey), 740) and calls signMessage on it, so in proxy mode the signature is made by the victim tenant's sub-node, not the attacker's.
7. [src/utils/proxy.ts:181–201](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L181-L201)
   loadProxyLightning selects the macaroon by the 66-char ownerPubkey it is given (186-195); the owner pubkey named in the planted Chat row therefore selects the victim's credentials.
8. [src/network/send.ts:170–185](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L170-L185)
   For a joiner (sender.publicKey !== chat.ownerPubkey) sendMessage resolves the tribe owner contact by the body-supplied ownerPubkey in the caller's tenant and keysends only to it (then 268-280, 360); the Chat row is created only once that keysend to the co-tenant settles, the sole cost of the attack.
9. [app.ts:78](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L78)
   leadershipBoardInterval(1800000) is started unconditionally in finishSetup, so the job runs every 30 minutes in production without any action by the victim.
10. [src/utils/tribes.ts:768–777](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L768-L777)
   verifySignedTimestamp checks only the signature, never the timestamp, showing the ecosystem treats these tokens as long-lived proofs of key ownership; and the attacker receives a fresh one every 30 minutes regardless.

## Impact
The relay's tenant boundary (req.owner.id) is crossed: the relay mints and discloses another tenant's node-signed bearer token to the attacker (confidentiality of the victim's credential: HIGH) and performs an unauthorized signing operation with the victim's sub-node key on the attacker's demand, limited to the timestamp format (integrity LOW). The relay's own HTTP authentication (authToken/JWT) is not affected and there is no availability impact on the relay. Subsequent-system impact: The token is the credential the tribe server, MQTT broker, people server and boltwall/liquid accept for owner-only operations by the victim (tribes.ts:528-647, 112; people.ts:125-129, 216-218): edit/delete the victim's tribes, change stats/activity, declare bots, connect to MQTT as the victim and receive/publish on `${pubkey}/#`, delete the victim's profile, transfer liquid badges. Acceptance by those external servers cannot be verified in this checkout and is stated as an assumption; because the attacker receives a newly minted token every 30 minutes, any freshness window they apply does not mitigate it. Confidentiality LOW because tribe traffic is encrypted with group keys the attacker may not hold; integrity HIGH for the victim's tribes, bots, profile and badge assets; availability LOW for deletion of tribes/profile.

## Reproduction steps
1. Attacker is an authenticated co-tenant owner (adversary 5) on a sphinx-proxy multi-owner relay. Step 1: POST /tribe {uuid, group_key, owner_pubkey: <victim owner pubkey>, host: <attacker host>}; the min-sat group_join keysend to the co-tenant must settle (assumes sphinx-proxy routes payments between its virtual nodes, as it must for co-tenants to message each other). Step 2: POST /tribe_member {chat_id, pub_key, contact_key, alias}. Step 3: wait up to 30 minutes; the relay POSTs the victim's freshly signed token to https://<attacker host>/leaderboard/<uuid>?token=. No victim interaction; victim owner pubkeys are public (tribe listings, contacts). AT:P for the multi-tenant deployment and settled keysend preconditions.

## Recommended fix
1. updateLeadershipBoard selects chats by ownerPubkey without tenant scoping and signs for the owner named in a row another tenant authored, posting the signature to the row's host. Fix criteria: The leaderboard job must only sign for an owner on chats that belong to that owner's own tenant (ownerPubkey AND tenant === owner.id) and must only send the token to the configured tribes host (or a host validated against an operator allow-list). Verify: a Chat row with tenant B and ownerPubkey A never causes a signature by A or a request to its host.
2. doJoinTribe stores caller-supplied owner_pubkey and host into Chat without validating that owner_pubkey is not another local owner's key or that host is an allowed tribes host. Fix criteria: Joining a tribe must reject an owner_pubkey that belongs to a different local owner contact and must restrict host to the configured tribes host or an operator allow-list. Verify: POST /tribe with a co-tenant's owner pubkey or an arbitrary host is refused.
3. addTribeMember passes isTribeOwner: true unconditionally, letting a non-owner create owner-only ChatMember rows (with lastAlias) on any chat in their tenant. Fix criteria: POST /tribe_member must require req.owner.publicKey === chat.ownerPubkey before creating ChatMember rows. Verify: calling it on a joined (non-owned) tribe returns an error and creates no ChatMember.

---
**Severity:** HIGH
**Status:** Open
**Category:** Privilege escalation
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258187

---

# Greenlight device private key written to the relay log during register and recover

## Details
Both Greenlight bootstrap flows print the device private key to the log. `startGreenlightInit` (src/grpc/greenlight.ts:67-98) runs on every start via app.ts:58 -> reconnectToLightning -> initGrpcSubscriptions -> initGreenlight; on first boot (no hsm_secret) it calls `registerGreenlight`, and on any boot where the device key file is missing it calls `recoverGreenlight`. Both receive `{device_cert, device_key}` from the scheduler (PEM strings per proto/scheduler.proto:157,192) and immediately call `sphinxLogger.info(`WRITE KEY ${keyLoc} ${res.device_key}`)` (line 178) / `sphinxLogger.info(`RECOVER KEY ${keyLoc} ${res.device_key}`)` (line 145). `sphinxLoggerBase` (src/utils/logger.ts:65-87) emits every untyped message as 'MISC' regardless of `config.logging`, at level info, which is the default `logging_level` (config.ts:61), through the blgr console transport; the shipped dist/src/grpc/greenlight.js:139,164 carries the same lines. The PEM key therefore lands in the process output: journald/rsyslog on the documented Raspberry Pi image (whose release checklist rotates `/var/log/*` and the journal, confirming logs are kept on disk and treated as ordinary logs), `/var/log/supervisor/relay.log` or `docker logs` in container deployments, and any log shipping the operator configures. The same log tail is also returned to the Sphinx app by authenticated `GET /logs` (controllers/index.ts:145 -> details.getLogsSince, last 500 lines of the relay log), so the key also lands on the client device and in any log export the user shares with a support channel.

The device key is the mTLS client credential the relay uses for the Greenlight node (`loadMtlsCredentials`, lightning.ts:107-112). Assumption (upstream Greenlight, out of scope): the node authenticates devices solely by a valid device cert/key pair under the GL CA chain and accepts RPCs (Pay, Keysend, Withdraw, CloseChannel, ListInvoices, StreamIncoming) from any such device, and the deployment's signer (`sphinx-hsmd` per docs/sphinx_greenlight_build.md, mirroring `streamHsmRequests` in this file) co-signs whatever the node streams. Hence a reader of the relay's logs who is not the owner (another local account in `adm`/`systemd-journal`, an operator of a log aggregation system, a support recipient of pasted logs) obtains the client private key for the user's Lightning node. The device certificate is not logged and must be obtained separately; it sits world-readable next to the key in the default deployment (the verified permissions record at this file) or is reachable by the same host access.

The project treats the key as a secret, not log material: it is written under creds/, which .gitignore:39 excludes, and the docs tell users to back up `creds/hsm_secret` as the secret from which keys derive. The key is written only on registration/recovery, so exposure is once per such event, but the line persists in the journal/log and its rotations. Dependency assumption: blgr ^0.2.0 console transport prints messages at or above the configured level ('info'). The sibling candidate `lnd-wallet-password-logged-at-info` covers the same pattern for LND; this record covers the Greenlight credential at its own location.

## Evidence
1. [src/grpc/greenlight.ts:178](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/greenlight.ts#L178)
   registerGreenlight logs `WRITE KEY ${keyLoc} ${res.device_key}` — the full PEM private key returned by the scheduler (string per proto/scheduler.proto:157) — at info level via sphinxLogger with no logging type, so it is always emitted.
2. [src/grpc/greenlight.ts:145](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/greenlight.ts#L145)
   recoverGreenlight logs `RECOVER KEY ${keyLoc} ${res.device_key}` the same way whenever the device key file is missing at boot (RecoveryResponse.device_key, proto/scheduler.proto:192).
3. [src/utils/logger.ts:65–86](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/logger.ts#L65-L86)
   sphinxLoggerBase emits every message whose loggingType is 'MISC' (the default when no type is passed, as here) regardless of config.logging, at the default level 'info' (config.ts:61), to the blgr console transport — the process stdout captured by systemd/journald, supervisor relay.log or docker logs.
4. [src/grpc/greenlight.ts:67–98](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/greenlight.ts#L67-L98)
   startGreenlightInit runs at every process start (app.ts:58 -> reconnectToLightning -> initGrpcSubscriptions -> initGreenlight); it calls registerGreenlight when hsm_secret is absent (first boot of every Greenlight relay) and recoverGreenlight when the device key file is absent, so every Greenlight deployment emits the key line at least once.
5. [src/controllers/details.ts:100–124](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/details.ts#L100-L124)
   Authenticated GET /logs (controllers/index.ts:145) returns the last 500 lines of the relay log (supervisor relay.log, pm2 log, /var/log/syslog or config.log_file) to the Sphinx app, so the logged key also reaches the client device and any log export the user shares for support.
6. [src/grpc/lightning.ts:107–112](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L107-L112)
   loadMtlsCredentials reads cln_device_key as the client private key of the mTLS session to the Greenlight node; with it plus the device certificate and GL CA stored alongside, a holder can open their own session and issue node RPCs (upstream Greenlight device authentication, stated as an assumption).

## Impact
Holding the device key/cert pair gives RPC control of the user's Greenlight node under the stated upstream assumption: read invoices, payments and peers (confidentiality HIGH) and send, withdraw or close channels (integrity HIGH) given the deployment's signer co-signs streamed requests. Availability not directly affected.

## Reproduction steps
1. Every Greenlight-mode relay emits the key line on first boot (register) and on any boot with the device key file missing (recover); the line then persists in journald/syslog/relay.log and rotations. The attacker is a reader of that log who is not the owner: a local account with log access (adm/systemd-journal), a log-aggregation operator, or a support recipient of logs the owner exports (including the GET /logs tail the app shows). Rated local access with low privileges. Attack requirements PRESENT: the device certificate is not logged and must be obtained separately (world-readable beside the key in the default deployment, or via the same host access), and the attacker must reach a log copy from before rotation. The plain-HTTP /logs response is not counted as a vector: an eavesdropper on the documented plaintext transport already captures the owner's x-user-token, so that position gains nothing additional from the key.

## Recommended fix
registerGreenlight and recoverGreenlight interpolate the scheduler-returned device_key into info-level, untyped (always-emitted) log lines, writing the mTLS private key to the shared process log that is kept on disk, shipped, and served to the app via GET /logs. Fix criteria: No private key material (device_key, hsm_secret, or derived secrets) may appear in any log output at any level or logging type; after a fresh registration and a recovery the process log must contain at most the path the key was written to. Verify by searching the captured log and the GET /logs response for 'BEGIN' / the key bytes and finding none.

---
**Severity:** HIGH
**Status:** Open
**Category:** Information exposure through log
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** LOCAL
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258183

---

# Sentiment timer value unvalidated: NaN, zero or overflow collapses polling to 1 ms, flooding relay and target

## Details
The `/sentiment timer <value>` command (sentiment.ts:67-69 -> utill/sentiment.ts:86-130) converts the member-supplied word with Number() and feeds it straight into setInterval via timerMs (value * 60 * 1000). The isNaN check only posts an error message and falls through (no return), so `abc` becomes NaN; `0`, a negative number, `Infinity`, or any value above 35791 minutes (product > 2^31-1) are accepted as well. Node's timers clamp every delay that is not in [1, 2147483647] to 1 ms, so each of these inputs produces an interval that fires roughly every millisecond. Each tick runs checkThreshold (utill/sentiment.ts:136-189): a ChatBot.findOne query, a node-fetch GET to meta.url (member-settable per the verified finding sentiment-bot-no-admin-check-member-sets-polled-url, otherwise the owner's configured sentiment service), a full r.json() read and reduce over the body, and a bot.update write. The callback is async and has no in-flight guard, so ticks overlap: pending DB queries and outbound HTTP requests accumulate without bound, saturating the event loop and DB connection and, when a URL is set, emitting on the order of 1000 GET/s at that host indefinitely.

The handle management makes this persistent and cumulative: timer() receives the module-global `interval` by value (sentiment.ts:69). Its clearInterval(interval) clears that global handle (which belongs to whichever tribe first triggered sentiment.ts:40-57, possibly another tribe or, in proxy mode, another tenant), then assigns the new interval to the local parameter only. The global in sentiment.ts still holds the dead handle, so the `if (!interval)` guard never re-arms it, and each subsequent `/sentiment timer` command clears nothing and adds another uncancellable 1 ms loop. The only ways to stop the loops are uninstalling the bot (checkThreshold clears its own interval when the ChatBot row disappears) or restarting the process. Because meta.timer is persisted, a negative or huge value (truthy) re-creates the 1 ms loop on restart via timerMs(meta.timer || 60) (sentiment.ts:57) as soon as any message arrives in that tribe; 0 and NaN are falsy and fall back to 60 minutes after a restart.

Entry and reachability: the owner must have installed the bot (`/bot install sentiment`, Admin only, mother.ts:91-92); it is installed with the default msgTypes [message] (mother.ts:113-115). Afterwards any tribe member's text message arriving at the owner relay by keysend or MQTT is forwarded through forwardMessageToTribe -> sendMessage (receive.ts:306, 481-497; send.ts:142) into isBotMsg, which emits it to the builtin bot with author.bot='/sentiment' (intercept.ts:92-111, bots.ts:524). sentiment.ts:60-70 never checks the member's role. mother.ts:59 registers timer as an owner-intended hidden command, but hiding affects only the display of the command text (send.ts:555-597), not its execution. The timer-value handling and handle leak are a defect independent of the missing role check: even with an Admin gate the owner could trip them by typo, and the fix for the authorization gap does not fix them.

Assumptions: Node timers (node:16 runtime per Dockerfile:1,23) coerce delays that are NaN, < 1 or > 2147483647 to 1 ms, as documented for setInterval/setTimeout; node-fetch 2.6.12 (lockfile) has no request timeout by default, so slow or hung responses to the polled URL keep pending requests alive while new ticks add more.

## Evidence
1. [src/builtin/utill/sentiment.ts:95–117](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/utill/sentiment.ts#L95-L117)
   timer = Number(value); the isNaN branch only posts an error and falls through (no return). meta.timer = timer is persisted and setInterval(..., timerMs(timer)) is armed with whatever the member typed. `interval` is a by-value parameter, so the reassignment on line 115 never updates the module-global handle in sentiment.ts; the new interval is referenced only by its own closure.
2. [src/builtin/utill/sentiment.ts:132–134](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/utill/sentiment.ts#L132-L134)
   timerMs multiplies by 60000 with no range check; 0, negative, NaN, Infinity and any value above 35791 minutes (product > 2^31-1) yield a delay Node's timers clamp to 1 ms.
3. [src/builtin/utill/sentiment.ts:136–157](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/utill/sentiment.ts#L136-L157)
   Each tick runs ChatBot.findOne, fetch(meta.url) with the full body read by r.json(), a reduce and bot.update. The callback is async with no in-flight guard, so at a 1 ms period ticks overlap and pending DB queries and HTTP requests accumulate without bound rather than merely running at ~1000/s.
4. [src/builtin/sentiment.ts:40–57](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/sentiment.ts#L40-L57)
   The single module-global `interval` is created for the first tribe seen using timerMs(meta.timer || 60); a persisted negative or huge meta.timer (truthy) re-arms the 1 ms loop on every relay restart as soon as any message arrives in that tribe. (0 and NaN are falsy and fall back to 60 minutes on restart.)
5. [src/builtin/sentiment.ts:67–69](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/sentiment.ts#L67-L69)
   timer() receives the global handle by value; its clearInterval clears the global (possibly another tribe's or, in proxy mode, another tenant's) interval while the newly created one is only referenced by the local closure. The global still holds the dead handle, so `if (!interval)` never re-arms, and each repeated command adds another loop that no later command can clear.
6. [src/builtin/sentiment.ts:60–74](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/sentiment.ts#L60-L74)
   The command branch gates only on arr[0] === '/sentiment' and message.author.bot === '/sentiment'; message.member.roles is never consulted, so any tribe member reaches timer() (verified finding sentiment-bot-no-admin-check-member-sets-polled-url).
7. [src/network/intercept.ts:92–111](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/intercept.ts#L92-L111)
   Delivery path: the sentiment bot is installed with msgTypes [message] (mother.ts:113-115), so isBotMsg emits every member's text message via emitMessageToBot -> builtinBotEmit(msg, '/sentiment'), which sets author.bot to the prefix the handler checks. Reached from receive.ts:306 forwardMessageToTribe -> sendMessage (send.ts:142) for a member's keysend/MQTT message to the tribe owner's relay.

## Impact
The relay's single event loop is driven to issue a DB query and an outbound fetch every millisecond per stacked interval, with overlapping async ticks accumulating pending work without bound, for as long as the process lives and again after every restart for negative/huge values. Message handling, payment processing and the HTTP API for the owner degrade severely; recovery requires the owner to notice and uninstall the bot. The attacker also clears whichever tribe's polling interval the module global held. No data disclosure or modification beyond the bot's own meta. Subsequent-system impact: The polled host (meta.url, member-settable per the verified companion finding, otherwise the owner's configured third-party sentiment service) receives on the order of 1000 GET requests per second from the relay indefinitely, so the relay is usable as an amplification source against an external host.

## Reproduction steps
1. A tribe member sends `/sentiment timer 0` (or `abc`, `-1`, `99999999`) as an ordinary text message into a tribe whose owner installed the sentiment bot; optionally first `/sentiment url http://<target>`. Membership of a public tribe is self-service and the message is delivered over Lightning/MQTT with no HTTP credentials on the victim relay. The owner relay forwards, intercept emits to the bot, timer() persists the value and starts a 1 ms interval; repeating the command stacks additional loops. No role check, owner interaction or special timing is needed; the only precondition is that the owner installed the bot.

## Recommended fix
1. The polling period is taken from chat text without range validation and the NaN path falls through, so values Node clamps to 1 ms are persisted and armed. Fix criteria: Reject (with an early return) any timer that is not a finite integer within a sane range (e.g. 1 to a few thousand minutes) before persisting or arming it; verify that `timer 0`, `timer abc`, `timer -1` and `timer 99999999` leave meta.timer and the interval unchanged.
2. Interval handles are tracked in one module-global variable passed by value, so re-arming leaks the new handle, clears another tribe's interval, and allows unbounded accumulation of concurrent loops. Fix criteria: Keep one interval per tribe in a keyed registry owned by the module; a new timer command clears exactly that tribe's previous interval before creating the new one, and uninstalling the bot clears it immediately. Verify that repeated timer commands never increase the number of live intervals and never affect other tribes.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
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
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258181

---

# Sub-satoshi keysend skips settled-amount normalization, so claimed amount drives owner-paid keysends

## Details
The established defence for every amount-dependent handler on the Lightning ingress is receive.ts:722-723: `if (value && dat && dat.message) dat.message.amount = value`, which is meant to replace the sender's claimed message.amount with the sats actually settled. `value` is `parseInt(i.value)` (receive.ts:677), the invoice's whole-satoshi amount. A keysend HTLC carrying less than one satoshi (1-999 msat) is settled by LND as a keysend invoice whose `value` is 0 (the remainder lives only in value_msat/amt_paid_msat, which the relay never reads). Because 0 is falsy the overwrite is skipped and the attacker-authored amount survives, tagged network_type=lightning, into onReceive and every ACTIONS handler. The Greenlight conversion (interfaces.ts:659-670) floors msat the same way.

The payload is otherwise unauthenticated (parseAndVerifyPayload returns payloads with bad/missing signatures; sender.pub_key is attacker-chosen), so any Lightning node that can deliver a sub-satoshi HTLC to the relay's node gets the same power that mqtt-inbound-claimed-amount-drives-tribe-owner-forwarding and mqtt-heartbeat-unverified-amount-keysend-drain describe for the MQTT transport, but over the Lightning transport those records (and ledger item dismissed-confirmations-158-13c6) assumed to be safe:

1. Any relay: `{type:26, sender:{pub_key:A, route_hint:R}, message:{amount:N}}` -> receiveHeartbeat keysends round(N/2) to A (confirmations.ts:172-185). No contact, chat or tribe relationship is needed. With N = 2x the victim's spendable balance the whole balance is sent; the only cap is the 5% fee limit.
2. Tribe owner: a member (membership itself is gained for free because the priceToJoin gate at line 193 compares the claimed amount) posts a message (uuid U), then sends `{type:29, chat:{uuid:T,type:2}, message:{amount:N, replyUuid:U}}` for 1 msat. amtToForward = N - ppm - escrow (240-249) and sendMessage forces a keysend of that amount to realSatsContactId = the attacker's contact (send.ts:253-280). The pricePerMessage gate (175), escrow refund timer (178-189), purchase_deny refund (media.ts:369-377) and bot-maker keysend (bots.ts:241-253) all consume the same fabricated amount.

Assumptions stated: LND (the default lightning_provider) reports Invoice.value in whole satoshis and value_msat in msat; LND accepts keysend HTLCs of any size above the channel's min_htlc, and its default inbound minimum (DefaultBitcoinMinHTLCInMSat) is 1 msat, so a direct channel peer can deliver a sub-satoshi keysend; multi-hop delivery additionally requires the final intermediary's outbound min_htlc policy to be below 1000 msat (CLN's default htlc_minimum is 0). Opening a channel to the victim's public node is within the attacker's control.

This is a different source (Lightning transport, sub-satoshi settlement) from the MQTT/co-tenant records; the sinks overlap by design because they share the same unnormalized field. Ledger item lead-receive-720-25ec is concluded here.

## Evidence
1. [src/network/receive.ts:720–727](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L720-L727)
   parseKeysendInvoice replaces the payload's message.amount with the settled invoice value only when `value` is truthy. value is the whole-satoshi field, so a settled keysend of 1..999 msat yields value 0, the overwrite is skipped and the attacker-authored message.amount flows into onReceive as if it were received sats. This is the line the fix must change.
2. [src/network/receive.ts:675–677](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L675-L677)
   value = parseInt(i.value): i.value is the invoice's integer-satoshi amount (floored); value_msat / amt_paid_msat are never consulted.
3. [src/controllers/confirmations.ts:158–189](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/confirmations.ts#L158-L189)
   Simplest sink, reachable on every relay (no tribe needed): receiveHeartbeat trusts dat.message.amount, computes round(amount/2) and signAndSend()s a real keysend from the owner's node to the payload's self-declared sender.pub_key / route_hint. The ledger dismissed this handler's Lightning path on the assumption that amount is always overwritten with the settled value; the sub-satoshi case voids that assumption.
4. [src/network/receive.ts:225–256](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L225-L256)
   Tribe-owner sink: for boost/direct_payment with replyUuid, amtToForward = message.amount - pricePerMessage - escrowAmount is computed from the (unnormalized) claimed amount and realSatsContactId = ogMsg.sender, i.e. whoever authored the referenced message (the attacker's own earlier post).
5. [src/network/send.ts:253–279](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L253-L279)
   When isTribeOwner, amount and realSatsContactId match the contact, sendMessage forces a Lightning keysend of Math.max(amount, min_sat) from the owner's wallet (ownerPubkey selects the tenant sub-wallet in proxy mode).
6. [src/network/receive.ts:167–210](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L167-L210)
   pricePerMessage / priceToJoin gates and the escrow refund timer (timers.addTimer pays chat.escrowAmount back later) are all decided from the same claimed amount, so paid tribes become free and escrow is refunded for nothing.
7. [src/grpc/lightning.ts:418–425](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L418-L425)
   keysend only applies a lower bound (Math.max(opts.amt, 3)); there is no upper bound on the amount paid out, and maxfee() allows up to 5% routing fee on top.
8. [src/controllers/media.ts:369–377](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/media.ts#L369-L377)
   Further sink: receivePurchase refunds `amount` (the claimed value) via purchase_deny when amount < price, so a sub-satoshi purchase claiming price-1 is refunded price-1 real sats.
9. [src/controllers/bots.ts:241–253](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L241-L253)
   Further sink: when a remote bot is installed, the tribe owner pays Math.max(msg.message.amount, pricePerUse) to the bot maker from the member's claimed amount.
10. [src/grpc/interfaces.ts:659–669](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/interfaces.ts#L659-L669)
   Greenlight path: greenlightAmoutToAmounts floors millisatoshi to whole satoshis for i.value, so the same zero-value condition arises for sub-satoshi payments on Greenlight.

## Impact
Direct theft of the owner's Lightning funds (the primary asset the relay guards) up to outbound liquidity, repeatable; paid-tribe/escrow accounting is bypassed. No confidentiality impact; availability of the service is only indirectly affected by liquidity exhaustion.

## Reproduction steps
1. Attacker runs any Lightning node, opens a channel to the victim relay's node (pubkey is public: tribe listings expose owner_pubkey; LND accepts inbound channels by default) or routes via a final hop whose outbound min_htlc is below 1000 msat (CLN default 0), and sends a 1 msat keysend whose TLV payload claims amount N. parseKeysendInvoice computes value = parseInt(i.value) = 0, skips the overwrite at receive.ts:722, tags network_type=lightning and dispatches to onReceive; a type-26 payload without chat skips every tribe gate and reaches receiveHeartbeat, which keysends round(N/2) to the attacker's sender.pub_key through signAndSend -> LND.keysendMessage (no mqttTopic/coTenantDest), with no upper bound on amt (lightning.ts:418). As a tribe member the owner instead forwards N - ppm - escrow for a boost on the attacker's own post. No credentials, no owner interaction, deterministic. Assumptions about LND (external, unpinned; the relay requires accept-keysend per docs/*_deployment.md and docker/lnd.conf.sample): processKeySend creates the keysend invoice with Value = the msat amount paid and settles it without a minimum; the RPC Invoice.value is that amount floored to whole satoshis (value_msat/amt_paid_msat carry the remainder, never read here); and the default inbound channel min_htlc (DefaultBitcoinMinHTLCInMSat) is 1 msat so a direct peer can deliver a sub-satoshi HTLC. Whether proto-loader returns i.value as number 0, string "0" or a Long, parseInt yields 0 and the guard fails the same way.

## Recommended fix
1. parseKeysendInvoice normalizes message.amount only when the settled satoshi value is non-zero, so a sub-satoshi settlement leaves the sender-claimed amount in a payload that downstream code treats as paid Lightning value. Fix criteria: Every payload delivered over the Lightning ingress must carry the settled amount (0 when the settled value is below one satoshi, derived from amt_paid_msat), never the sender-claimed figure; verify by sending a 1 msat keysend with message.amount set high and observing that receiveHeartbeat pays at most min_sat, price gates reject the message, and no forward/escrow/refund keysend is issued.
2. Amount-dependent handlers (heartbeat, boost/direct_payment forwarding, purchase_deny refund, bot keysend, escrow timer) spend owner funds proportional to message.amount without an independent bound tied to what was actually received. Fix criteria: Outbound payments derived from an inbound message are capped at the inbound settled amount for that message (and heartbeat/refund replies never exceed it); verify that a payload whose claimed amount exceeds its settled value cannot cause an outbound keysend larger than the settled value.

---
**Severity:** HIGH
**Status:** Open
**Category:** Reliance on untrusted input
**CWE:** [CWE-807](https://cwe.mitre.org/data/definitions/807.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258179

---

# Greenlight hsm_secret and device key written with default world-readable permissions

## Details
In Greenlight provider mode (`lightning_provider=GREENLIGHT`; `initGrpcSubscriptions` in src/network/receive.ts:501-506 calls `initGreenlight` at startup only in that mode) the relay itself is the node's signer. `startGreenlightInit` (src/grpc/greenlight.ts:68-106) generates a 32-byte node seed on first boot, derives the node identity with the embedded Core Lightning hsmd (`libhsmd.Init`), registers with the Greenlight scheduler, and `registerGreenlight` (161-187) persists the scheduler-issued mTLS device private key, device certificate, CA and finally the raw seed (`fs.writeFileSync(secretPath, Buffer.from(rootkey,'hex'))`, line 183) with plain `fs.writeFileSync(path, data)` and no `mode`. `recoverGreenlight` (137-152) rewrites the device key and certificate the same way. Nothing in src/ calls `umask` or `chmod` or passes a file mode (no such token outside tests), so under Node 16's documented default (`mode: 0o666`, masked by the process umask) each file is created 0644 in a default shell/systemd environment: readable by every uid on the host. Core Lightning, whose hsmd this code embeds, creates its own `hsm_secret` 0400 for exactly this reason.

The default `hsm_secret_path` is `./creds/hsm_secret` (src/utils/config.ts:22) inside the relay checkout; `creds/` is a committed directory (`creds/.gitkeep`) whose permissions the code never tightens. `cln_device_key`/`cln_device_cert` have no defaults (config.ts:83-84) and must be configured for the module to work at all (the writes at 179-180 would otherwise throw before the seed is persisted); the release checklist in docs/sphinx_greenlight_build.md:111 (`rm /home/pi/sphinx-relay/creds/*`, keep `scheduler_creds`) shows they live under the same `creds/` directory in the shipped Pi image. `libhsmd` is not a package.json dependency — it is `npm link`ed per docs/sphinx_greenlight_build.md — so Greenlight mode is the documented Raspberry Pi deployment (checkout at `/home/pi/sphinx-relay`, single documented user `pi`, relay Internet-exposed on 3001 per docs/sphinx_greenlight_instructions.md), not the Docker image.

Either file alone is total authority over the user's node. The seed reproduces `startGreenlightInit` offline: `libhsmd.Init` → node_id, `sign_challenge` (212-220) over the scheduler's challenge, `recover` → fresh device credentials, using only the publicly committed `creds/scheduler_creds` client identity; or the attacker derives the on-chain and channel keys directly. The device key plus certificate is the identity `loadMtlsCredentials` (src/grpc/lightning.ts:107-112) presents to the node's gRPC endpoint, so its holder can `schedule()` the node and issue pay/withdraw/close calls from any machine. The project's own user documentation (docs/sphinx_greenlight_instructions.md:30-32) describes `creds/hsm_secret` as 'the secret from which all your bitcoin keys are derived'.

The defect is the on-host permission: any other uid on the Pi — a second account, or a compromised unprivileged daemon such as the mDNS responder the docs rely on for `raspberrypi.local` — with traversal rights to the checkout reads the seed, leaving no trace in the relay. `.gitignore` keeps `creds/*` out of version control, which does not address this. Dependency assumption: Node 16 (`node:16` per Dockerfile/CI) `fs.writeFileSync` default `mode` 0o666, per its documented API.

## Evidence
1. [src/grpc/greenlight.ts:176–183](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/greenlight.ts#L176-L183)
   registerGreenlight writes the scheduler-issued mTLS device private key, device cert, CA and finally the raw 32-byte node seed (`fs.writeFileSync(secretPath, Buffer.from(rootkey,'hex'))`, line 183) with fs.writeFileSync and no `mode` option, so each file is created with Node's default 0o666 masked by the process umask, i.e. 0644 under the usual 022: readable by every uid on the host. Primary location: the fix must create these files owner-only.
2. [src/grpc/greenlight.ts:143–147](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/greenlight.ts#L143-L147)
   recoverGreenlight rewrites the device key and cert the same way, again without a restrictive mode, so a recover after key loss also leaves them world-readable.
3. [src/grpc/greenlight.ts:68–99](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/greenlight.ts#L68-L99)
   startGreenlightInit shows the seed alone is sufficient authority: from hsm_secret the relay derives node_id via libhsmd.Init, signs the scheduler's challenge (sign_challenge, 212-220) and runs `recover` to obtain brand-new device credentials, using only the publicly committed creds/scheduler_creds client identity. A reader of hsm_secret can do exactly the same from any machine, or derive the on-chain and channel keys directly.
4. [src/grpc/lightning.ts:107–111](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L107-L111)
   loadMtlsCredentials builds the node gRPC client identity from cln_device_key + cln_device_cert + cln_ca_cert; the holder of the 0644 device key file (plus the cert) is therefore the node's authorised RPC client and can schedule() the node and issue pay/withdraw/close calls without touching hsm_secret.
5. [src/utils/config.ts:22](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/config.ts#L22)
   Default hsm_secret_path is './creds/hsm_secret' — inside the relay checkout (/home/pi/sphinx-relay/creds on the documented Pi image), a committed directory (creds/.gitkeep) whose permissions the code never tightens. cln_device_key/cln_device_cert (config.ts:83-84) have no defaults and must be configured for the module to function; the release checklist places them under the same creds/ directory.
6. [src/network/receive.ts:501–505](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L501-L505)
   initGrpcSubscriptions runs initGreenlight at startup only when lightning_provider === 'GREENLIGHT' (default provider is 'LND', config.ts:41), so the write path is live in every Greenlight-mode relay and in no other mode.
7. [docs/sphinx\_greenlight\_instructions.md:30–32](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/docs/sphinx_greenlight_instructions.md#L30-L32)
   The project's own user documentation tells the user to back up `home/pi/sphinx-relay/creds/hsm_secret` as 'the secret from which all your bitcoin keys are derived', confirming the file is the master secret for the user's funds and that the shipped Pi image keeps it under the pi user's home checkout.

## Impact
The seed is total compromise of the user's Lightning node: all on-chain and channel funds can be moved and arbitrary payments issued (integrity HIGH); the node identity key, payment history and invoices are exposed and every message the node signs can be forged (confidentiality HIGH). Availability is not directly affected by reading the files.

## Reproduction steps
1. Attacker holds an unprivileged local uid on the host running a Greenlight-mode relay (a second account or a compromised unprivileged service) with traversal access to the checkout's creds/ directory. They read creds/hsm_secret and/or the device key file (both created 0644). With the seed they re-run the register/recover challenge flow offline against the scheduler using the committed scheduler_creds identity, or derive the node and on-chain keys directly; with the device key+cert they connect to the node's gRPC endpoint as the owner. Deterministic, no race, no owner interaction. Requires the non-default GREENLIGHT provider mode (AT:PRESENT).

## Recommended fix
hsm_secret and the device private key are created with Node's default 0o666 & ~umask mode (src/grpc/greenlight.ts:146-147,179-183) in a committed directory the code does not protect, so other local principals can read the node seed and mTLS key. Fix criteria: hsm_secret and the device private key must be created owner-read-only (0400/0600) via an explicit mode or exclusive-create descriptor, written atomically, inside a creds directory restricted to the relay's uid; existing world-readable copies must be tightened on startup. Verify after a fresh registration and after a recover that `stat` on both files and the directory shows no group/other permission bits and that a different uid cannot open them.

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
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258175

---

# Docker image build deletes package-lock.json and installs unpinned dependencies

## Details
The two Dockerfiles that produce the published sphinx-relay images (`sphinxlightning/sphinx-relay` and `sphinx-relay-swarm`, built and pushed to Docker Hub by the tag-triggered workflows) deliberately delete `package-lock.json` before running `npm install` (Dockerfile:14-16, Dockerfile.swarm:15-17). package.json declares nearly all ~70 runtime dependencies with caret ranges, so the image's node_modules is assembled from whatever versions the npm registry serves at build time rather than from the reviewed, integrity-hashed set recorded in the committed lockfile. The lockfile is honoured everywhere else (the master lint/build workflow runs `npm i` with it present; every deployment guide runs `npm install` in the checkout), so the released container is the one artifact whose dependency tree is unreviewed and non-reproducible.

Because the image does not compile TypeScript (it ships the committed `dist/`), the dependency versions resolved here are the only variable in the build: a malicious or compromised publish of any direct dependency (e.g. a new 0.2.x of `sphinx-bot`, a 0.21.x of `axios`, a 2.x of `request`) or of any transitive dependency within range is pulled into the next release image automatically, with no maintainer review step, and its install-time lifecycle scripts also run inside the build (there is no `.npmrc` setting `ignore-scripts`; the project's own `postinstall` already relies on lifecycle scripts running). Operators who follow docs/docker_deployment.md run `sphinxlightning/sphinx-relay:latest` beside their LND node, so the resolved dependency code runs in the process that holds the LND admin macaroon (config/app.json production `macaroon_location`) and therefore spending authority over the user's Lightning funds.

The `postinstall` hook (`git apply protobuf_long.patch`) further assumes a specific protobufjs source layout; with the lock removed it is applied to whichever protobufjs version resolves, so the build either fails or silently patches a version the maintainers did not test.

This is a build-integrity defect in the release pipeline rather than an outdated-dependency issue: the maintainers' own pinning (the committed lockfile) is discarded precisely for the artifact that ships to end users. (Dockerfile.lndrelay is not included: its `git clone` of sphinx-relay retains the repository's lockfile, so that install is lock-pinned, and the branches it checks out are the project's own.)

## Evidence
1. [Dockerfile:14–16](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L14-L16)
   The builder stage runs `rm ./package-lock.json` and then `npm install`, so the release image's node_modules is resolved fresh from the npm registry to the newest version satisfying each caret range at build time, with no integrity hashes to compare against the reviewed set. No .npmrc exists, so dependency lifecycle scripts also execute during this install.
2. [Dockerfile.swarm:15–17](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile.swarm#L15-L17)
   Identical lockfile removal and unpinned `npm install` for the second published image (sphinx-relay-swarm), which additionally runs as root with NODE_ENV unset.
3. [.github/workflows/docker-build.yml:49–64](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/docker-build.yml#L49-L64)
   On every tag push this workflow builds `./Dockerfile` and pushes the result to Docker Hub as both `sphinx-relay:<tag>` and `sphinx-relay:latest`, so whatever the unpinned resolution produced is the official release artifact.
4. [.github/workflows/docker-swarm-build.yml:49–64](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/docker-swarm-build.yml#L49-L64)
   Same tag-triggered build and push for Dockerfile.swarm as `sphinx-relay-swarm:<tag>` and `:latest`.
5. [package.json:40–113](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/package.json#L40-L113)
   Nearly every runtime dependency is declared with a caret range (axios ^0.21.1, sphinx-bot ^0.2.43, sequelize ^5.19.3, request ^2.88.0, node-fetch ^2.6.7, mqtt ^4.2.8, ...). Without the lock, any newer in-range publish of these or of their transitive closure is pulled into the image.
6. [docs/docker\_deployment.md:95](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/docs/docker_deployment.md#L95)
   The project's deployment documentation tells operators to run `sphinxlightning/sphinx-relay:latest`, the image these workflows publish, so the unpinned dependency set is what end users execute next to their LND node.
7. [.github/workflows/lint\_format\_and\_build.yml:18–19](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/lint_format_and_build.yml#L18-L19)
   Contrast: the master build workflow runs `npm i` with the lockfile present, as do all documented host installs, so the committed lock is the project's intended control over dependency versions and the Docker builds are the one path that discards it.

## Impact
The released relay image executes arbitrary attacker-chosen dependency code with the relay's full privileges: read of all messages, keys and tokens in the database, modification of any data, and ability to crash or hold the service. Subsequent-system impact: The relay process holds the LND admin macaroon (config/app.json production macaroon_location) and TLS cert, so code running inside it can issue any gRPC call to the operator's Lightning node, including sending payments and closing channels — full control over the user's funds beyond the relay's own boundary.

## Reproduction steps
1. Attacker: anyone who can publish a new in-range version of any direct or transitive npm dependency of the relay (package takeover, compromised maintainer, malicious transitive publish). No access to the sphinx-relay repository or CI is needed: the next tag push rebuilds the image with `rm package-lock.json && npm install`, pulling the malicious version and running its lifecycle scripts, and the workflow pushes the result to Docker Hub as `:latest` and `:<tag>`; operators following the docs pull and run it. Preconditions: a compromised in-range publish must exist at build time (AT:PRESENT), and a maintainer must perform the routine release tag push that triggers the build (UI:PASSIVE).

## Recommended fix
Dockerfile and Dockerfile.swarm remove the committed lockfile before installing, so the release image's dependency set is resolved fresh from the registry instead of from the reviewed, integrity-hashed pins. Fix criteria: The image build must install exactly the versions and integrity hashes recorded in the committed lockfile and must fail if the lock is missing or inconsistent with package.json. Verify by building the image twice from the same commit and confirming identical dependency versions, and by confirming that a newer in-range registry publish does not change the image contents.

---
**Severity:** HIGH
**Status:** Open
**Category:** Unpinned dependencies
**CWE:** [CWE-829](https://cwe.mitre.org/data/definitions/829.html)
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
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258173

---

# Personal access token persisted while master build runs repository-controlled scripts

## Details
The master-branch workflow checks the repository out with a long-lived personal access token (`secrets.ACTIONS_PAT`) and leaves it persisted in the workspace `.git/config` for the whole job (actions/checkout's default `persist-credentials: true` stores it as `http.https://github.com/.extraheader = AUTHORIZATION: basic base64(x-access-token:<PAT>)`). Before any push it then executes a large amount of code controlled by the commit being built: `npm i` (install scripts of every dependency plus the repository's own `postinstall: git apply protobuf_long.patch`, a patch that already rewrites files under node_modules), `eslint` (parser and plugins named in .eslintrc), `prettier`, the bash script `grpc_gen_types.sh`, and `tsc`. Finally it `git push`es three automatic commits to master.

A PAT is used instead of the job's GITHUB_TOKEN so that the bot's pushes trigger other workflows and reach master directly, but that choice hands every script above a credential that does not expire with the job, grants direct unreviewed push to master and tags, and (as a classic PAT cannot be scoped to one repository) typically covers every repository its owner can write to. `git config --get http.https://github.com/.extraheader` from any of those steps yields the token.

Attack path: a contributor gets a pull request merged that changes any executed input — a dependency/lockfile bump to a version with a malicious install script, a line in `grpc_gen_types.sh`, a hunk in `protobuf_long.patch` that patches `node_modules/eslint` or `prettier`, or an eslint plugin/`.eslintrc.js`. The project's own PR workflows (lint_pr.yml, unit_test.yml) run the same scripts without secrets, so the payload can gate on the presence of the extraheader credential and remain silent during review. On merge the master push runs it with the PAT. With the PAT the attacker escalates from one reviewed change to persistent, unreviewed control: push arbitrary commits to master (including the committed `dist/`, which the Dockerfile ships without recompiling), push tags that trigger docker-build.yml to publish attacker-controlled images to Docker Hub as `latest` with the project's registry secrets, and act on the token owner's other repositories. The same exposure applies to a compromised upstream npm package once a maintainer bumps the lockfile.

Assumptions: actions/checkout@v3 persists the supplied token in .git/config when persist-credentials is not set to false (documented default); npm runs lifecycle scripts on `npm i` by default (no --ignore-scripts and no .npmrc disabling them in the tree); tag pushes authenticated with a user PAT trigger `on: push: tags` workflows. Tag-protection rules on the GitHub side, if any, are not visible in the repository.

## Evidence
1. [.github/workflows/lint\_format\_and\_build.yml:13–19](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/lint_format_and_build.yml#L13-L19)
   actions/checkout@v3 is given `token: ${{ secrets.ACTIONS_PAT }}` with the default persist-credentials: true, so the PAT is written into the workspace .git/config as http.https://github.com/.extraheader for the rest of the job; the very next step runs `npm i`, executing every dependency lifecycle script plus this repo's own postinstall, all with read access to that file.
2. [.github/workflows/lint\_format\_and\_build.yml:29–43](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/lint_format_and_build.yml#L29-L43)
   With the PAT still in .git/config the job runs `npm run lint` (eslint with the parser/plugins named in .eslintrc), `npx prettier`, `bash grpc_gen_types.sh` (an arbitrary shell script from the tree), `npm run build` (tsc), and then `git push`es three unreviewed commits to master. Every one of these executes code taken from the commit that was just merged.
3. [package.json:23](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/package.json#L23)
   `postinstall` runs `git apply protobuf_long.patch` during `npm i`: a merged change to the patch file lets the commit rewrite arbitrary files under node_modules (e.g. eslint, prettier, typescript) that the same job then executes.
4. [protobuf\_long.patch:1](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/protobuf_long.patch#L1)
   The shipped patch already targets `node_modules/protobufjs/src/decoder.js`, demonstrating that the postinstall step rewrites installed tooling in place; retargeting a hunk at a tool executed later in the job is a one-file change.
5. [grpc\_gen\_types.sh:25–33](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/grpc_gen_types.sh#L25-L33)
   Shell script executed verbatim by the workflow (line 39) while the PAT is persisted; any merged edit to it runs with that credential readable. Its `npx proto-loader-gen-types` / `npx pretty-quick` calls resolve to the locally installed @grpc/proto-loader and pretty-quick, which are themselves installed (and patchable) by the preceding `npm i`.
6. [.github/workflows/docker-build.yml:5–8](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/.github/workflows/docker-build.yml#L5-L8)
   Any tag push triggers the release workflow, which builds the tagged tree (Dockerfile copies the committed dist/ as-is) and publishes it with the Docker Hub secrets as both the tag and `latest` (lines 57-64). A PAT-authored tag push, unlike one made with GITHUB_TOKEN, triggers this workflow, so the stolen PAT converts into attacker-controlled images shipped to operators.

## Impact
Disclosure of a long-lived PAT with direct write access to the repository: the attacker can push arbitrary unreviewed commits to master (including the shipped dist/), rewrite history and create tags, i.e. full integrity loss of the source and release line and loss of the credential's confidentiality. Repository availability is only marginally affected. Subsequent-system impact: A tag pushed with the stolen PAT triggers docker-build.yml, which builds the tagged tree and publishes it to Docker Hub as the versioned tag and `latest` using the project's registry secrets. Operators pull and run that image with the LND admin macaroon, so attacker code gains full control of their relay host and Lightning funds: confidentiality, integrity and availability of those deployments are all lost. The PAT is assumed (as a classic PAT) to also reach the owner's other repositories; that extent cannot be verified from the code.

## Reproduction steps
1. Attacker: a contributor able to get a pull request merged, or the maintainer of any npm package in the lockfile once a routine bump lands (PR:LOW; the maintainer's merge is UI:ACTIVE). Delivery: modify package.json/lockfile, grpc_gen_types.sh, protobuf_long.patch or .eslintrc so code executed by the master workflow reads the PAT from .git/config and exfiltrates it, gated on the credential's presence so it is inert in the secret-less PR jobs. On merge the master push executes it with the PAT (AT:PRESENT: the review must miss the payload). No shipped control separates the credential from the build steps.

## Recommended fix
1. A long-lived, broadly scoped PAT is present in the checkout while untrusted, repository-controlled scripts execute. Fix criteria: The credential used to push must not be readable by npm lifecycle scripts, eslint/prettier plugins or repository shell scripts: check out with persist-credentials disabled, run installs with scripts disabled where possible, and introduce the push credential (a short-lived GitHub App or fine-grained token scoped to this repository) only in the final push step. Verify that `git config --get-all http.https://github.com/.extraheader` is empty during install/lint/build steps.
2. Automatic commits of dist and generated types are pushed to master without review, so injected content cannot be distinguished from bot output. Fix criteria: Generated artifacts should be produced in the build (image/release) rather than committed, or the bot should open a pull request instead of pushing directly to master so changes remain reviewable.

---
**Severity:** HIGH
**Status:** Open
**Category:** Insufficiently protected credentials
**CWE:** [CWE-522](https://cwe.mitre.org/data/definitions/522.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258171

---

# Unauthenticated GET /peered answers peer/channel state for any caller-chosen pubkey (connect UI)

## Details
When config.connect_ui is enabled (the documented Greenlight production build sets it: docs/sphinx_greenlight_build.md), app.ts:135-140 registers GET /peered and POST /connect_peer, and src/auth.ts no_auth() exempts both from every authentication middleware.

checkPeered (src/utils/connect.ts:99-123) reads req.body.pubkey (express.json/express.urlencoded parse bodies on GET too) and, falling back to the hard-coded Sphinx router pubkey only when none is supplied, calls Lightning.listPeers() and Lightning.listChannels() on the root client and returns {peered, active, channel_point} for that pubkey. Both the LND and Greenlight response mappings (src/grpc/interfaces.ts listPeersResponse / listChannelsResponse) yield hex pub_key/remote_pubkey, active and channel_point, so the comparison works on both builds. The shipped connect page (public/index_greenlight.html:190) only ever fetches /peered with no body, i.e. the sanctioned unauthenticated capability is the node's state relative to the Sphinx router; nothing in the UI or docs uses or needs a caller-chosen pubkey.

An unauthenticated Internet caller can therefore use the relay as an oracle: for any node id X, learn whether this node currently has a transport peer connection to X, whether it has a channel to X, whether that channel is active, and the channel's funding outpoint. Iterating over the public node graph (bounded only by the global 10 req/s per-IP limiter, trivially spread over IPs) enumerates the node's peer set and channel partners, including unannounced (private) channels and their funding UTXOs, which are deliberately absent from gossip; a public channel_point resolved against gossip also links the relay's HTTP endpoint (home IP / dynDNS name the instructions tell users to expose) to the owner's Lightning node identity, which no other unauthenticated route discloses (GET /info is loopback-gated, /initial_admin_pubkey is proxy-only and pre-claim). listPeers/listChannels are called without an owner pubkey, so in a proxy deployment with connect_ui set the disclosed state is the hosting node's.

POST /connect_peer (connect.ts:125-139) forces an outbound peer connection to the hard-coded Sphinx router and echoes the LND/CLN error text via failure(); this is the same action the connect page performs unauthenticated by design (index_greenlight.html:179), so it adds no integrity gain beyond the sanctioned path and only marginal information (e.g. 'already connected to peer'). The pairing-secret disclosure on GET /connect is recorded separately in unauthenticated-owner-token-claim-on-fresh-relay.

## Evidence
1. [src/utils/connect.ts:99–123](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/connect.ts#L99-L123)
   checkPeered takes req.body.pubkey (any caller-chosen value; falls back to the Sphinx router pubkey), lists the node's peers and channels via the root Lightning client and returns {peered, active, channel_point} for that pubkey with no authentication or tenant scoping. The UI never supplies a body, so the arbitrary-pubkey oracle is surplus to the feature.
2. [src/auth.ts:134–136](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L134-L136)
   '/connect', '/connect_peer' and '/peered' are in the no_auth list, so ownerMiddleware, hmacMiddleware and proxyAdminMiddleware pass them through without any credential.
3. [app.ts:135–140](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L135-L140)
   The routes are registered whenever config.connect_ui (or CONNECT_UI env) is set; they are mounted before the unlock gate and before controllers.set, so they are live even on a locked relay.
4. [src/grpc/interfaces.ts:293–316](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/interfaces.ts#L293-L316)
   Greenlight listPeers responses are mapped to channels with hex remote_pubkey, active (CHANNELD_NORMAL) and channel_point (funding_txid:index); LND responses pass through unchanged. The oracle therefore works on the documented Greenlight build as well as LND.
5. [app.ts:102–110](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L102-L110)
   express.json and express.urlencoded parse bodies on every method, so a GET /peered with a JSON or form body supplies req.body.pubkey.
6. [public/index\_greenlight.html:179–190](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/public/index_greenlight.html#L179-L190)
   The shipped connect page calls POST /connect_peer and GET /peered with no body: the sanctioned unauthenticated capability is state relative to the Sphinx router only, and the force-peer action is by design.
7. [src/utils/connect.ts:125–139](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/connect.ts#L125-L139)
   connectPeer lets any caller make the node dial the hard-coded Sphinx router and returns raw Lightning error text via failure(); same action the connect page performs, so marginal information only.
8. [docs/sphinx\_greenlight\_instructions.md:12](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/docs/sphinx_greenlight_instructions.md#L12)
   Users of the Greenlight build (whose production config sets connect_ui: true per docs/sphinx_greenlight_build.md:79) are told to open /connect and later to port-forward 3001 to the Internet with no instruction to disable the connect UI, so these routes are exposed in a documented deployment.

## Impact
Confidentiality: discloses, per queried pubkey, the node's peer connections, channel partners, channel activity and funding outpoints (including unannounced channels) and lets an outsider link the relay's exposed HTTP endpoint to the owner's Lightning node identity; targeted topology/privacy information, not secrets or funds (C:L). Integrity: the only action an outsider can trigger is the peer connection to the maintainer-chosen router, which the connect page already performs unauthenticated by design, so no integrity gain beyond the sanctioned path (I:N). Availability: none beyond ordinary request load.

## Reproduction steps
1. Attacker: any host that can reach the relay's HTTP port on a deployment with connect_ui enabled (the documented Greenlight production build; the instructions tell users to expose port 3001). Send GET /peered with a JSON body {"pubkey": "<target>"} and read {peered, active, channel_point}; repeat per candidate node id from the public graph. No credentials, no user interaction, deterministic; the 10 req/s per-IP limiter only paces enumeration.

## Recommended fix
1. GET /peered is listed in no_auth and answers peer/channel queries for a caller-supplied pubkey, although the connect page only needs the node's state relative to the fixed Sphinx router. Fix criteria: Unauthenticated /peered must not accept a caller-chosen pubkey (ignore the body and answer only for the hard-coded router, or require the owner token / a local-setup session for any other pubkey); verify that an unauthenticated GET /peered with a body pubkey returns no per-pubkey state while the connect page still works.
2. failure() returns raw Lightning gRPC error text to unauthenticated callers of /peered and /connect_peer. Fix criteria: Unauthenticated connect-UI routes return a generic error; verify that backend error strings no longer appear in their responses.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing authentication
**CWE:** [CWE-306](https://cwe.mitre.org/data/definitions/306.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258169

---

# receiveConfirmation lets any contact mark arbitrary message ids as delivered

## Details
Confirmations (message type 1) are delivery receipts: the recipient's relay echoes the sender's local `message.id` back and the sender's relay marks that message as received. receiveConfirmation (src/controllers/confirmations.ts:66-92) trusts the numeric id in the peer payload: it loads Message where { id: msg_id, tenant } and, provided payload.sender.pub_key resolves to a Contact row of the victim, sets status = received, records statusMap[sender.id] = received, and emits a 'confirmation' socket event carrying the message to the owner's client. The chat looked up by the attacker-supplied chat uuid is only used for the socket payload.

Message ids are small sequential integers (autoincrement primary key). The handler never checks that the confirming contact was a recipient of the message (chat membership / contactIds), that the message was sent by the owner, or that it belongs to the named chat. Any Lightning node reaches the handler via a keysend TLV payload (src/network/receive.ts:709-726; parseAndVerifyPayload returns the payload even on a bad signature, and onReceive applies no gating to non-tribe type-1 payloads). The only precondition — being a Contact — is satisfied by any node that has sent one conversation message (src/helpers.ts:187-202 creates the contact unconditionally) or that joined a tribe the victim owns. Such a peer can therefore send type-1 keysends with message.id = 1..N and have the victim's messages in chats it does not belong to — DMs with other people, outbound invoices, attachments, tribe posts — marked as delivered, with the attacker's contact id inserted into their statusMap; the client is notified over the socket and re-syncs them as 'confirmed' through GET /messages?date= (src/controllers/messages.ts:80-85). The legacy branch (no message.id) marks the newest pending owner message in any chat whose uuid the attacker supplies.

Impact is limited to falsifying delivery state (status and statusMap) of the victim's messages, which the relay stores and serves as authoritative; no content is disclosed and no funds move. On the LN path each probe costs the attacker a settled keysend; a sender pub_key that is not a contact instead throws on sender.id (covered by a separate candidate).

Root cause: the handler authorises the confirmation by tenant alone, not by the relationship between the confirming peer and the message.

## Evidence
1. [src/controllers/confirmations.ts:66–92](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/confirmations.ts#L66-L92)
   receiveConfirmation loads Message.findOne({ id: msg_id, tenant }) where msg_id is the peer-supplied payload.message.id, and the only sender lookup is Contact.findOne by pub_key (line 58). Nothing checks that the message was sent by the owner, that it belongs to the chat named by payload.chat.uuid, or that the confirming contact is in that chat's contactIds. It then sets status=received, writes statusMap[sender.id]=received and emits a 'confirmation' socket event with the message to the owner's client.
2. [src/controllers/confirmations.ts:16–43](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/confirmations.ts#L16-L43)
   sendConfirmation shows the intended semantics: a confirmation is sent by the recipient of a specific message back to its sender (and in tribes only by the tribe owner, to the original sender). The receive side enforces none of that relationship.
3. [src/network/receive.ts:709–726](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L709-L726)
   LN keysend entry: the TLV payload is parsed by parseAndVerifyPayload (which returns the payload even when the signature is missing or invalid) and handed to onReceive; for a type-1 (confirmation) payload with chat.type != tribe, onReceive applies no membership or price gating and doTheAction dispatches straight to ACTIONS[1] = receiveConfirmation.
4. [src/helpers.ts:187–202](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L187-L202)
   The only precondition the handler has (sender resolves to a Contact row) is met by any Lightning node: a single conversation-type payload makes findOrCreateContactByPubkeyAndRouteHint create the Contact unconditionally (priceToMeet only sets an 'unmet' flag). Tribe joiners of a tribe the victim owns are likewise created as fromGroup contacts.
5. [src/controllers/messages.ts:80–85](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L80-L85)
   Shipped consumer of the falsified state: GET /messages?date= returns as 'confirmed' every owner-sent message whose status is received and updated_at >= date, so the attacker-marked messages are synced to the Sphinx client as delivered in addition to the real-time 'confirmation' socket event.

## Impact
Falsified delivery status and statusMap on arbitrary messages of the victim, stored in the relay DB and served to the client as authoritative (socket 'confirmation' event; GET /messages?date= confirmed set). Minor integrity impact; no disclosure, no availability effect, no funds.

## Reproduction steps
1. Attacker is any Lightning node (threat-model adversary 2). It first becomes a Contact by sending one conversation payload (helpers.ts:187-202) or by joining a tribe the victim owns, then sends type-1 keysend payloads with message.id = 1..N and any chat object; no signature is required (parseAndVerifyPayload returns unverified payloads) and onReceive applies no gating to non-tribe type-1 payloads. Each existing id in the victim's tenant is marked received and the client notified. No privileges on the relay and no user action are needed.

## Recommended fix
1. receiveConfirmation selects the message by peer-supplied id scoped only by tenant and never relates the confirming contact to that message. Fix criteria: Only update a message when it was sent by the owner (message.sender === tenant), it belongs to the chat identified by the payload uuid (message.chatId === chat.id), and the confirming contact is a member of that chat (in chat.contactIds, or the tribe owner for tribe chats); apply the same chat/sender constraints to the legacy no-id branch. Verify that a confirmation from an unrelated contact for a DM or tribe message id leaves its status and statusMap unchanged.
2. The handler dereferences sender.id without confirming the sender resolved to a Contact, so the authorisation failure mode is a thrown error rather than a logged rejection. Fix criteria: Return early with a logged error when the sender pub_key is not a known contact or the chat is not found, before any Message lookup or update.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing Authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258168

---

# Conversation-typed payload injects messages into existing tribe or DM chats by uuid

## Details
Inbound message handling binds a peer payload to a stored chat solely by the uuid the peer supplies. For conversation-typed payloads (chat.type absent or 0) parseReceiveParams calls findOrCreateChatByUUID(chat_uuid, [owner.id, sender.id], owner.id), which returns whatever non-deleted chat of the tenant has that uuid - a 1:1 conversation, a group or a tribe - regardless of whether the sender is one of chat.contactIds. onReceive independently decides isTribe from the payload's chat.type rather than the stored chat's type, so relabeling a tribe uuid as type 0 also bypasses the tribe owner's gating block.

Two concrete abuses, each reachable by any Lightning node with one keysend carrying the Sphinx TLV record (or over MQTT when the broker lets the attacker publish to the victim's topic):

1. Tribe injection bypassing owner gating. Payload { type: 0, chat: { uuid: <tribe uuid> }, sender: { pub_key: <any>, alias }, message: { id, uuid, content } }. isTribe=false, so membership, pricePerMessage, spam-list and private-approval checks (receive.ts 140-319) are skipped and receiveMessage persists the message in the tribe chat with the attacker's auto-created contact as sender, pushes it to the owner's client and keysends a 3-sat confirmation to the attacker. Members' relays accept the same payload (they have no gating). The injected message is stored and displayed only on the targeted relay; it is not re-broadcast to the tribe. Tribe uuids are public via the tribe server. This is distinct from tribe-message-injection-unverified-origin-member-node (tribe-typed payloads at member nodes) and from tribe-owner-unknown-sender-skips-membership-and-approval-gates (unknown sender inside the tribe-typed path, where the price check still applies).

2. DM injection. The uuid of the DM between victim V and contact C is md5(sort([V.pubkey, C.pubkey]).join('-')) (helpers.ts:35), carried on the wire by newmsg (send.ts:434), so anyone knowing both public node ids can compute it. A type-0 message naming that uuid is stored in V's DM chat with C with a sender id that is neither V nor C, emitted to V's client as a message of that chat, and the relay keysends a confirmation to C for a message C never sent (sendConfirmation -> chat.contactIds). Because the relay has just auto-created a contact for the attacker and sent them V's RSA contact_key (helpers.ts:203-207), the attacker can encrypt content V's client decrypts. Whether the Sphinx client labels the message as C's or as the unknown contact's depends on client rendering, which this repository does not contain; the relay-side defect - a third party writing into a two-party chat - holds either way.

The discarded signature result (inbound-payload-signature-verification-result-ignored) lets the attacker additionally claim C's pubkey, but even with signatures enforced the chat binding by uuid alone remains the defect.

Root cause: chat resolution trusts the peer's chat.uuid and chat.type; it never checks that the resolved chat is a conversation whose contactIds include the resolved sender.

## Evidence
1. [src/helpers.ts:219–240](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L219-L240)
   findOrCreateChatByUUID resolves the target chat by { uuid, tenant, deleted: false } only. It never checks that the stored chat is a conversation (type 0) or that the resolved sender is one of chat.contactIds, so a conversation-typed payload naming the uuid of an existing tribe or of another pair's DM is bound to that chat. This is the primary fix location.
2. [src/network/receive.ts:113–135](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L113-L135)
   onReceive derives isTribe from payload.chat.type, not from maybeChat.type that it has just loaded. A tribe uuid delivered with chat.type absent or 0 yields isTribe=false and isTribeOwner=false, so the whole owner-side gating block (membership, pricePerMessage, spam list, private approval; lines 140-319) is skipped and doTheAction runs with doAction=true.
3. [src/helpers.ts:289–319](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L289-L319)
   parseReceiveParams takes the conversation branch purely from the payload's own chat.type; it auto-creates a contact for the claimed sender pubkey (findOrCreateContactByPubkeyAndRouteHint) and then calls findOrCreateChatByUUID with the payload's chat.uuid. The peer therefore chooses both the sender record and the destination chat.
4. [src/controllers/messages.ts:545–609](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L545-L609)
   receiveMessage persists the message with chatId of the resolved (tribe or DM) chat and sender = the peer's contact id, emits it over socket.io to the owner's client, fires a push notification, and calls sendConfirmation({chat, sender: owner, receiver: sender}). With the default STORE_CACHE='' (config.ts:33) `cached` is false and the row is always created. receiveBoost (616-720) follows the same path.
5. [src/controllers/confirmations.ts:27–43](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/confirmations.ts#L27-L43)
   For a non-tribe chat sendConfirmation passes the stored chat unchanged to network.sendMessage, which iterates chat.contactIds (send.ts:113-116, 216-233) skipping only the owner: for an injected DM the relay keysends a confirmation (min 3 sats) to the legitimate counterpart C for a message C never sent. For a tribe chat on the owner's relay it keysends the confirmation to the attacker; on a member relay it sends nothing.
6. [src/helpers.ts:35](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L35)
   DM chat uuids are deterministic: md5 of the two participants' node pubkeys, sorted and joined with '-'. Node pubkeys are public, so any third party can compute the uuid of the DM between a victim and a chosen contact.
7. [src/network/send.ts:431–436](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L431-L436)
   newmsg places chat.uuid in every outbound payload, so the receiving relay stores the same md5 uuid via findOrCreateChatByUUID; both sides of a DM share the computable uuid.
8. [src/network/receive.ts:709–727](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L709-L727)
   LN ingestion: the TLV payload is parsed and only message.amount is replaced by the settled value; chat.uuid, chat.type and sender.* pass through to onReceive as the peer authored them. receiveMqttMessage (516-533) is a second entry with no rewriting at all.

## Impact
Integrity HIGH: the attacker writes arbitrary content into any chat of the victim - private 1:1 conversations and gated tribes - defeating the tribe's membership/payment/spam/approval controls and the two-party integrity of a DM; the relay also emits unintended confirmation keysends (3 sats) to the DM counterpart or to the attacker. Confidentiality NONE: no existing content is read (the contact_key disclosure is a separate finding). Availability NONE.

## Reproduction steps
1. Any Lightning node keysends the victim one payload with chat.type omitted and the uuid of a public tribe or of a DM computed from two public node pubkeys (or publishes it over MQTT). No prior relationship (the contact is auto-created), no credentials, no victim action, default configuration (STORE_CACHE empty). Works against tribe owners and members alike; same path for message, boost and attachment types.

## Recommended fix
1. findOrCreateChatByUUID binds a peer payload to any chat of the tenant by uuid alone, ignoring the chat's type and whether the sender is a participant, so a conversation-typed payload can target a tribe or another pair's DM. Fix criteria: A conversation-typed payload must only resolve to a chat of type conversation whose contactIds contain the resolved sender; a uuid belonging to a tribe or group, or a conversation the sender is not part of, must be rejected rather than reused. Verify that a type-0 payload naming a tribe uuid or another pair's DM uuid stores nothing, emits nothing to the client and sends no confirmation.
2. onReceive derives isTribe from the payload's chat.type instead of the stored chat's type, so the tribe owner's gating block can be skipped by relabeling the payload. Fix criteria: Tribe gating must be driven by the stored Chat row's type for the given uuid; verify a type-0 payload for a tribe uuid is subjected to the same membership, price, spam and approval checks as a type-2 payload.

---
**Severity:** HIGH
**Status:** Open
**Category:** Insecure direct object reference
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258164

---

# Greenlight scheduler/node TLS trusts any GL-CA cert, including the committed public identity

## Details
In Greenlight mode (`lightning_provider=GREENLIGHT`, the documented Raspberry Pi deployment in docs/sphinx_greenlight_build.md and docs/sphinx_greenlight_instructions.md; the compiled code ships in dist/src/grpc/greenlight.js) the relay authenticates both remote services it depends on only by CA. `loadSchedulerCredentials` (src/grpc/greenlight.ts:35-40) builds `createSsl(rootCerts=ca.pem, key, chain)` from the defaults in src/utils/config.ts:23-25 (`creds/scheduler_creds/ca.pem`, `device-key.pem`, `device.crt`), and `loadScheduler` (42-54) dials the hard-coded `35.236.110.178:2601` with `grpc.ssl_target_name_override: 'localhost'`. `loadMtlsCredentials` (src/grpc/lightning.ts:107-112) uses `cln_ca_cert` - a byte copy of the same `ca.pem` written by `writeTlsLocation` (greenlight.ts:154-159) - as the root store, and `loadLightning` (146-157) connects to whatever host `schedule()` stored from the scheduler's `grpc_uri` (greenlight.ts:124), again with name override `localhost`. Neither connection checks the peer's subject, pins a key, or checks that `grpc_uri` points into Greenlight.

The committed `creds/scheduler_creds/device.crt` is a three-certificate chain: leaf CN `GL /users/nobody` issued by `GL /users` (CA:TRUE, pathlen 3) under the root `GL /` that is `ca.pem`; the leaf carries Extended Key Usage serverAuth+clientAuth, SAN `DNS:localhost`, validity 2021-04-26 to 2031-04-24, and `device-key.pem` is its matching private key (identical public key). That is a complete TLS *server* identity satisfying the relay's only check (chains to `ca.pem`, name `localhost` matches), so the relay cannot distinguish its holder from the real scheduler or from its own node.

Attack path (needs an on-path position between the relay and the hard-coded scheduler IP, or the node host - AT:PRESENT; no Greenlight account and no relay credential):
1. On boot and every reconnect (`initGrpcSubscriptions`, src/network/receive.ts:501-514; `keepalive` every 59 s) the relay calls `schedule(node_id)`. The attacker terminates TLS with the nobody chain and returns `{grpc_uri: 'https://attacker:port'}`, which is stored unchecked.
2. `loadLightning` connects to that host with the relay's real device credentials and accepts the attacker's nobody leaf as the node; `getInfo` returns an attacker-chosen identity.
3. `subscribeInvoices` (src/grpc/subscribe.ts:21-39) opens `streamIncoming`; `subscribeResponse` (src/grpc/interfaces.ts:579-614) turns every streamed `IncomingPayment.offchain` into a SETTLED Invoice with `value`/`amt_paid_sat` from the attacker's `amount`, `is_keysend` from `label.startsWith('keysend')`, `extratlvs` copied into `htlcs[0].custom_records` and `payment_request` from `bolt11`. Keysend-labelled records go through `parseKeysendInvoice` (receive.ts:632-736), which sets `message.amount = value` (722-724, 'ADD IN TRUE VALUE') and dispatches to `onReceive`, so forged tribe joins, purchases and paid messages are credited at attacker-declared amounts with no sats moving; non-keysend records carrying a relay-issued `bolt11` reach `receiveNonKeysend` (src/grpc/regular.ts:25-120), which marks the owner's own invoice `confirmed` and emits `invoice_payment`/`payment` to the client. Outbound `keysend`/`pay` go to the fake node, whose non-FAILED reply `keysendResponse` (interfaces.ts:490-509) records as success, so real payments are black-holed while the ledger shows them sent, and outbound payload metadata, destinations and amounts are disclosed to the attacker.
4. If `hsm_secret` or the device key is absent - first boot of the shipped image (the release checklist in docs/sphinx_greenlight_build.md:111 deletes `creds/*` before imaging) or after a re-flash - `registerGreenlight`/`recoverGreenlight` (greenlight.ts:137-187) take the challenge from the fake scheduler, sign the attacker-chosen bytes with the node key through the type-23 `sign_message` framing (`sign_challenge`, 212-220; the same primitive `signBuffer` uses for Sphinx signatures), and persist the attacker-supplied `device_key`/`device_cert` for all future node sessions. If the real scheduler accepts a relayed challenge/signature pair (Greenlight-side behaviour, not verifiable from this checkout), the attacker can additionally complete `recover`/`register` against real Greenlight and obtain its own device credentials for the victim's node.

The defect is the relay's trust decision, not Greenlight's: it never checks that the presented certificate's subject is the scheduler or a node certificate bound to its own node_id, and never validates `grpc_uri`. Dependency assumptions: @grpc/grpc-js 1.8.7 (package-lock) applies `grpc.ssl_target_name_override` as both the SNI servername and the `checkServerIdentity` hostname and verifies the chain against the `rootCerts` passed to `createSsl` (its documented behaviour); Node 16 (Dockerfile `node:16-buster-slim`) TLS accepts a server chain whose EKU includes serverAuth and performs no revocation check by default. Whether other GL-issued device certificates also carry serverAuth and SAN `localhost` cannot be verified here; the committed nobody identity alone suffices.

## Evidence
1. [src/grpc/greenlight.ts:35–54](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/greenlight.ts#L35-L54)
   loadSchedulerCredentials builds createSsl(rootCerts=ca.pem (the 'GL /' root), key, chain) and loadScheduler dials the hard-coded IP 35.236.110.178:2601 with grpc.ssl_target_name_override='localhost'. The only server check is therefore 'chains to the GL root CA and has a name matching localhost'; no subject or key pinning of the scheduler. Primary location: the fix must positively identify the scheduler here.
2. [creds/scheduler\_creds/device.crt](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/creds/scheduler_creds/device.crt) (whole file)
   Committed three-certificate chain (parsed with openssl): leaf CN 'GL /users/nobody', issuer 'GL /users' (CA:TRUE pathlen 3), root 'GL /' identical to ca.pem; leaf EKU 'TLS Web Server Authentication, TLS Web Client Authentication', SAN DNS:localhost, valid 2021-04-26 to 2031-04-24. creds/scheduler_creds/device-key.pem is the matching private key (same public key). Together they are a complete public TLS server identity that passes the relay's trust check for both the scheduler and the node connection.
3. [src/utils/config.ts:22–25](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/config.ts#L22-L25)
   DEFAULT_SCHEDULER_TLS_LOCATION/KEY/CHAIN point the scheduler trust store and client identity at the committed creds/scheduler_creds files by default, so every Greenlight-mode relay trusts exactly the CA under which the public nobody identity was issued.
4. [src/grpc/lightning.ts:107–112](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L107-L112)
   loadMtlsCredentials uses cln_ca_cert (a copy of the same GL root written by writeTlsLocation) as the root store for the node connection, with the device key/cert as client identity.
5. [src/grpc/lightning.ts:146–157](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L146-L157)
   The Greenlight node client is created for whatever host get_greenlight_grpc_uri() returned (split on '//', no scheme/host validation), again with ssl_target_name_override 'localhost' and no identity pinning, and cached for the process lifetime.
6. [src/grpc/greenlight.ts:112–134](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/greenlight.ts#L112-L134)
   schedule() stores response.grpc_uri from the scheduler unconditionally; nothing validates the scheme, host or that it belongs to Greenlight, and response.node_id is never compared with GID.node_id.
7. [src/grpc/greenlight.ts:137–219](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/greenlight.ts#L137-L219)
   On register (no hsm_secret) or recover (device key missing) the relay signs a scheduler-chosen challenge with the node key via libhsmd type-23 sign_message (the same primitive signBuffer uses for Sphinx payload signatures) and writes the scheduler-supplied device_key/device_cert to disk, which the node connection then uses.
8. [src/grpc/interfaces.ts:579–613](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/interfaces.ts#L579-L613)
   subscribeResponse converts every streamIncoming offchain payment from the node into a SETTLED Invoice: amount from r.amount, is_keysend from label.startsWith('keysend'), extratlvs copied into htlcs[0].custom_records, payment_request from r.bolt11. Everything the impersonated node streams is trusted.
9. [src/grpc/subscribe.ts:21–38](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/subscribe.ts#L21-L38)
   SETTLED invoices are dispatched to parseKeysendInvoice (full inbound Sphinx message pipeline with the declared amount) or receiveNonKeysend (marks the relay's own invoices paid and emits invoice_payment).
10. [src/network/receive.ts:722–724](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L722-L724)
   parseKeysendInvoice overwrites payload.message.amount with the invoice value ('ADD IN TRUE VALUE'); in Greenlight mode that value is the amount the (impersonated) node declared, so forged settled amounts drive tribe-join, purchase and payment accounting.
11. [src/grpc/regular.ts:25–85](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/regular.ts#L25-L85)
   receiveNonKeysend looks up the relay's own invoice Message by payment_request and marks it confirmed, emitting invoice_payment/payment to the client; a fake node streaming a relay-issued bolt11 with a non-keysend label marks the owner's invoices paid without any sats moving.
12. [src/network/receive.ts:501–513](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L501-L513)
   Startup and every reconnect run initGreenlight -> schedule -> getInfo -> subscribeInvoices, so the impersonation window recurs on each boot/reconnect; keepalive() repeats getInfo every 59 s on the cached client.

## Impact
Integrity HIGH: forged SETTLED payments at attacker-declared amounts enter the full inbound pipeline (parseKeysendInvoice sets message.amount = value) and the owner's own invoices are marked confirmed with invoice_payment events, so memberships, media and goods are released without payment; outbound payments are recorded as sent when they never left; on first boot or recover, attacker-supplied device credentials are persisted and the node key signs attacker-chosen bytes. Confidentiality LOW: outbound payload metadata, destinations, amounts and the contact graph are exposed to the fake node; DM bodies stay client-encrypted. Availability LOW: real inbound and outbound payments are black-holed while the impersonation holds.

## Reproduction steps
1. The attacker must be on-path between the Greenlight-mode relay and the hard-coded scheduler 35.236.110.178:2601, or the node host the scheduler named (AT:PRESENT). With that position they present the publicly committed nobody chain (creds/scheduler_creds/device.crt + device-key.pem) as the TLS server; the relay's CA-only check with name override 'localhost' (greenlight.ts:35-53, lightning.ts:107-157) accepts it. No credentials, no Greenlight account, no user interaction; the handshake happens automatically on every boot, reconnect and 59 s keepalive, after which the attacker deterministically controls every scheduler and node response.

## Recommended fix
1. Scheduler and node TLS peers are validated only against the shared Greenlight CA with a constant 'localhost' name override, so any GL-issued leaf (including the public nobody identity shipped in creds/) is accepted as the server. Fix criteria: The relay must positively identify its peers: the scheduler by a pinned certificate/public key or a subject it alone holds, and the node by a certificate whose subject binds to this node's node_id. A TLS server presenting the committed creds/scheduler_creds identity, or any other user's device certificate, must be rejected for both the scheduler and the node connection.
2. schedule() stores whatever grpc_uri the scheduler returns and register/recover persist whatever device credentials it returns, with no validation. Fix criteria: grpc_uri must be checked to be an https endpoint under Greenlight's domain/address space before use, and device credentials must only be written after the scheduler identity has been verified; a response from an unverified peer must not change on-disk credentials or the node endpoint.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper certificate validation
**CWE:** [CWE-295](https://cwe.mitre.org/data/definitions/295.html)
**Attack vector:** NETWORK
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258163

---

# /bot install keysends registry-advertised price_per_use to bot maker with no cap or confirmation

## Details
The mother bot's `/bot install <name>` command (src/builtin/mother.ts:95-167) is the only production path that installs a registry (non-builtin) bot. The Admin gate (mother.ts:91) limits the trigger to the tribe owner: forwarded member messages are re-sent with role reader (network/receive.ts:488, send.ts:449), so buildBotPayload never grants them the Admin role. For a non-builtin name the relay GETs `${tribes_host}/bot/<name>` unauthenticated (getBotByName, 261-274) and, if the JSON carries `uuid` and `owner_pubkey`, calls `installBotAsTribeAdmin(chat, bot)` (controllers/bots.ts:127-203). That function copies the registry's `price_per_use` into `chatBot.pricePerUse` and, for a maker pubkey other than the local owner, calls `keysendBotInstall` (213-227) -> `botKeysend` (269-328), which sets `amt = Math.max(amount || min_sat_amount)` -- a one-argument Math.max, so the registry value is used as-is -- and `network.signAndSend(opts, owner)`; with no MQTT topic this reaches `LND.keysendMessage` (network/send.ts:359-364) -> `keysend` (grpc/lightning.ts:393-530), which applies only a floor (`Math.max(opts.amt, min_sat_amount || 3)`, line 419) and a 5% fee limit. The owner's node therefore pays `price_per_use` sats to `owner_pubkey` via `owner_route_hint`, with no maximum, no comparison against anything the owner typed, and no confirmation step; `/bot search` (207-222) shows only name and description, so the price is invisible in-chat. If the keysend succeeds the ChatBot is created with no msgTypes, so every later `/<name> ...` message from any tribe member (forwarded by the owner through intercept.isBotMsg, intercept.ts:117-123,155-156) triggers `keysendBotCmd` (241-254), paying `Math.max(message.amount, pricePerUse)` again from the owner's node per use.

Anyone running a relay can register a bot with an arbitrary `price_per_use` and name (createBot -> tribes.declare_bot, controllers/bots.ts:54-89, utils/tribeBots.ts:28-68, unauthenticated POST); the registry host itself (threat-model adversaries 3/6) can also rewrite the value. An attacker lists a bot under an attractive or typo-squatted name with price_per_use = e.g. 4,000,000, and any tribe owner who types `/bot install <name>` -- a documented, help-listed command -- has that amount keysent to the attacker's node immediately, bounded only by the LND payment maximum and channel liquidity; an accomplice member can then drain further per-use payments by posting `/<name> x`. Because the payment is a keysend there is no invoice to inspect and no refund path. Assumption: LND's routerrpc sendPaymentV2 (as driven through @grpc/grpc-js 1.8.7 against the bundled proto) enforces no amount ceiling other than its own max payment size and available liquidity. The threat model's assets list 'Lightning funds ... amounts and destinations derived from request or peer data'; here both amount and destination come from a third-party registry record authored by a stranger.

## Evidence
1. [src/builtin/mother.ts:152–158](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/mother.ts#L152-L158)
   For any bot name not in builtinBots the mother bot fetches the registry record with getBotByName and hands it straight to installBotAsTribeAdmin; the price is never checked, shown to the owner or confirmed. This is the only call site of installBotAsTribeAdmin in production code.
2. [src/controllers/bots.ts:144–202](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L144-L202)
   installBotAsTribeAdmin destructures uuid, owner_pubkey, price_per_use, owner_route_hint from the registry JSON, copies price_per_use into chatBot.pricePerUse (160) and, for any owner_pubkey other than the local owner, calls keysendBotInstall (193) before creating the ChatBot row.
3. [src/controllers/bots.ts:213–226](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L213-L226)
   keysendBotInstall passes b.pricePerUse as the keysend amount and b.botMakerPubkey / b.botMakerRouteHint as destination and route hint.
4. [src/controllers/bots.ts:288–323](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L288-L323)
   botKeysend sets amt = Math.max(amount || min_sat_amount) -- a single-argument Math.max, so the registry value is used unchanged -- and calls network.signAndSend(opts, sender) with the owner as sender; there is no upper bound.
5. [src/network/send.ts:317–365](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L317-L365)
   signAndSend with no coTenantDest/mqttTopic falls through to LND.keysendMessage({...opts, data}, ownerPubkey) (359-364), so opts.amt sats are actually paid from the owner's node.
6. [src/grpc/lightning.ts:419](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L419)
   keysend() applies only a floor, amt: Math.max(opts.amt, min_sat_amount || 3); the fee limit is 5% of amt (maxfee, 376-382). Nothing in the relay bounds the amount above; the only ceiling is LND's own max payment / channel liquidity.
7. [src/builtin/mother.ts:261–273](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/mother.ts#L261-L273)
   getBotByName GETs `${tribes_host}/bot/${name}` with no authentication and returns the JSON as long as uuid and owner_pubkey are present; price_per_use, owner_pubkey and owner_route_hint are trusted as returned.
8. [src/network/intercept.ts:117–122](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/intercept.ts#L117-L122)
   A remote ChatBot installed this way has no msgTypes, so every tribe message starting with `/<name> ` -- including member messages the owner forwards -- reaches emitMessageToBot and, for bot_types.remote, keysendBotCmd (155-156) with the owner as sender.
9. [src/controllers/bots.ts:241–253](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L241-L253)
   keysendBotCmd pays Math.max(message.amount, b.pricePerUse) to the same bot maker from the owner's node on every such message, so the uncapped price accepted at install is charged again per use, triggerable by any member.
10. [src/builtin/mother.ts:207–230](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/mother.ts#L207-L230)
   /bot search renders only unique_name and a truncated description, and the help text advertises '/bot install {BOTNAME}'; the owner has no in-relay way to learn the price before the payment is made.
11. [src/utils/tribeBots.ts:28–67](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribeBots.ts#L28-L67)
   declare_bot POSTs price_per_use verbatim and unauthenticated to the public registry; createBot (controllers/bots.ts:54-89) lets any relay owner register a bot under any name with any price, so the attacker needs no relationship with the victim.

## Impact
Lightning funds are the relay's primary asset. An attacker-chosen amount is paid from the owner's node on install and again on every subsequent use triggered by any member; the relay imposes only a floor (min_sat_amount) and a 5% fee limit, so the ceiling is LND's max payment size and channel liquidity, which for a typical node means millions of sats per payment. No confidentiality or availability impact on the relay.

## Reproduction steps
1. Attacker: any Lightning node operator; they register a bot on the public tribes registry (POST /bots via their own relay's createBot, or directly -- the POST is unauthenticated) with an arbitrary price_per_use and a desirable or typo-squatted name, or they control/compromise the registry host. Victim: a tribe owner who types `/bot install <name>` in their tribe, a routine, help-listed admin command (user interaction ACTIVE; member messages cannot trigger it because forwarded senders carry role reader). The relay fetches the record, keysends price_per_use sats to the attacker's pubkey without displaying or capping it, then installs the bot so every later member `/<name>` message pays again. No relay credential or code defence stands in the way.

## Recommended fix
1. installBotAsTribeAdmin/keysendBotInstall/botKeysend pay the registry-supplied price_per_use with no upper bound and without the owner having seen or agreed to the amount; the chat command surface never displays the price. Fix criteria: An install initiated from chat must not transfer funds beyond an explicit, owner-approved amount: either require the owner to confirm the exact price (e.g. `/bot install <name> <price>` matching the registry value, or an app-side confirmation) and reject mismatches, or enforce a configurable maximum install/per-use price with anything above it refused. Verify that a registry record with an arbitrarily high price_per_use no longer results in a keysend from `/bot install`.
2. keysendBotCmd pays Math.max(message.amount, pricePerUse) for every member-authored `/<name>` message, so a price accepted blind keeps being charged without limit. Fix criteria: Per-use bot payments must respect the same owner-approved cap and the cap must be stored with the ChatBot at install time; verify that member messages cannot cause payments exceeding it.

---
**Severity:** HIGH
**Status:** Open
**Category:** Unvalidated payment amount
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258162

---

# Unauthenticated type-30 query makes relay pay sender and mint root-wallet addresses

## Details
The Sphinx 'query' message (type 30) exists so a client can ask the hub routing node for an on-chain deposit address: queryOnchainAddress (queries.ts:262-316) keysends the query to hub_pubkey, fetched from hub.sphinx.chat/routingnode. The answering side, receiveQuery, is nonetheless registered in every relay's ACTIONS table (controllers/index.ts:284) and performs no check on who sent the query or whether this relay is a routing node. The LN inbound path (receive.ts parseKeysendInvoice -> onReceive -> doTheAction) dispatches ACTIONS[payload.type] for any keysend carrying the Sphinx TLV record; for a payload without chat.uuid nothing consults the Contact table, so the sender need not be a contact. receiveQuery only requires sender.pub_key, message.content and owner to be present (queries.ts:326). For content {"type":"onchain_address",...} it (1) calls lightning.newAddress() on the root LND client (no owner pubkey, so in proxy mode the provider's wallet), (2) inserts a tenant-less Accounting row {pubkey, routeHint, sourceApp, status pending} with attacker-chosen values, and (3) signAndSend()s a query_response to dest = sender.pub_key with route_hint = sender.route_hint and amt = min_sat (default 3), which keysend() sends with fee_limit_sat = maxfee(3) = 21. Step (3) happens for any parseable JSON content regardless of q.type (the switch has no default; result stays ''). Signature verification is immaterial: the attacker signs with the key of the node they name.

Consequence: any Lightning node can, with a >=1-sat keysend, make the victim's relay pay 3 sats plus up to 21 sats routing fee to a destination of the attacker's choosing, repeatedly (hashCache dedupes only by r_hash), and in the onchain_address case also derive a fresh on-chain address on the root wallet and persist an Accounting row per request: unbounded, remotely driven growth of the HD wallet's address set and of a table shared by all tenants (read by GET /utxos; input to the currently disabled pollUTXOs channel-opening workflow). Ledger item e3-onchain-query is concluded here.

## Evidence
1. [src/controllers/queries.ts:318–379](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/queries.ts#L318-L379)
   receiveQuery: no sender or role check (only presence of sender.pub_key/content/owner at 326); for onchain_address it calls newAddress on the root client (340), creates a tenant-less Accounting row with attacker-chosen pubkey/routeHint/sourceApp (341-351), then signAndSend()s a min_sat query_response to dest = sender.pub_key via sender.route_hint (361-374). The reply is sent for any parseable JSON content even when q.type matches nothing.
2. [src/controllers/index.ts:284–285](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L284-L285)
   query and query_response handlers are wired into ACTIONS on every relay; nothing distinguishes the hub routing node that queryOnchainAddress targets from an ordinary user's relay.
3. [src/network/receive.ts:632–727](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L632-L727)
   parseKeysendInvoice: every settled inbound keysend carrying the Sphinx TLV (133773310) is parsed and handed to onReceive; the only dedupe is hashCache by r_hash, and only message.amount is overwritten with the paid value.
4. [src/network/receive.ts:88–130](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L88-L130)
   onReceive resolves the owner from dest only; for a payload without chat.uuid (isTribe false) no Contact lookup or membership check runs and doAction stays true.
5. [src/network/receive.ts:384–390](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L384-L390)
   doTheAction dispatches ACTIONS[payload.type] with the owner attached, so a type-30 payload from any node reaches receiveQuery.
6. [src/grpc/lightning.ts:418–436](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L418-L436)
   keysend builds the payment with amt = max(opts.amt, min_sat||3), dest from the payload and route_hints from the attacker-supplied route_hint.
7. [src/grpc/lightning.ts:378–384](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L378-L384)
   maxfee(3) returns FEE_LIMIT_SAT = 21, so each reflected 3-sat reply may additionally pay up to 21 sats in routing fees (fee_limit_sat at 484 / fee_limit at 443).
8. [src/grpc/lightning.ts:293–311](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L293-L311)
   newAddress uses loadLightning() with no owner pubkey, i.e. the root LND wallet; in proxy mode any tenant's inbound query mints addresses on the provider's wallet.
9. [src/controllers/queries.ts:262–316](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/queries.ts#L262-L316)
   Design intent: queryOnchainAddress sends queries only to hub_pubkey (the hub routing node); a user relay has no reason to answer queries, yet the receiving handler is active on all of them.

## Impact
Each query causes an unauthorized outbound payment from the owner's wallet of 3 sats plus up to 21 sats fee to an attacker-chosen destination, repeatable at LND HTLC settlement rate: limited per event but unbounded over time (integrity LOW; the contact_key handshake already reflects a 3-sat reply to strangers, so the marginal fund gain is small). Each onchain_address query also derives a new root-wallet address and persists a tenant-less Accounting row, remotely driven unbounded growth of wallet and DB state (availability LOW). Fresh addresses disclose nothing (confidentiality NONE).

## Reproduction steps
1. Attacker runs any Lightning node reachable in the graph (or opens a channel to the victim) and sends a keysend of >=1 sat to the relay's pubkey with TLV 133773310 = JSON {type:30, sender:{pub_key:<attacker>, route_hint?}, message:{content:'{"type":"onchain_address","uuid":"u","app":"a"}'}}. No credentials, no owner interaction, default configuration; works against single-user and proxy installs alike, repeatable per inbound HTLC.

## Recommended fix
1. receiveQuery, a handler meant only for the hub routing node, is active on every relay and acts on type-30 payloads from any sender. Fix criteria: Only a relay explicitly configured as the hub/routing node registers or executes receiveQuery; on every other relay a type-30 payload from an arbitrary node produces no newAddress call, no Accounting row and no outbound payment.
2. Even where queries are legitimately answered, the handler spends funds and mints wallet state for unauthenticated senders with no authorization, tenant scoping or issuance limit. Fix criteria: The answering node honours queries only from authorised senders whose payload signature verifies against the named pubkey, bounds per-sender address issuance, and records Accounting rows with the tenant so GET /utxos and any UTXO workflow are tenant-scoped.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing Authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258001

---

# socket.io handshake accepts transport tokens with no timestamp or replay validation

## Details
The socket.io server attached in src/utils/socket.ts (connect() is called from app.ts:185/193 on the same HTTP(S) server as the REST API, so it is exposed wherever the relay is) authenticates the handshake from client.handshake.headers. When x-transport-token is present (socket.ts:41-49) it decrypts the token with the transport RSA private key and uses only the first '|'-separated component as the owner bearer token; the timestamp component is discarded. Unlike ownerMiddleware (src/auth.ts:250-268) it never rejects a token without a timestamp, never compares the timestamp with owner.lastTimestamp and never advances that mark. A transport token is therefore a plain, indefinitely replayable bearer credential on this entry point: it stays valid until the owner's authToken itself changes, even after the HTTP path has moved lastTimestamp far past it, and the project's own test (src/tests/controllers/transportToken.test.ts check1MinuteOldRequest, expecting 401 for a 61 s-old token) shows this contradicts the intended contract.

The attacker is the adversary the transport-token scheme is designed against: an on-path observer of the client-relay hop, which is plain HTTP in the shipped default (config/app.json ssl.enabled=false in both environments; app.ts http.createServer; TLS, if any, is the operator's reverse proxy). Having captured one x-transport-token header from any HTTP request or socket handshake, they open a socket.io connection (any client library, extraHeaders) presenting that header at any later time; getOwnerFromToken resolves the owner, the socket is pushed into CLIENTS[owner.id] and from then on receives every event send/sendJson emits for that tenant: each new message record (messageToJson: sender, chat, type, amounts, media tokens, status, and messageContent, which for DM and tribe messages is ciphertext encrypted to the owner's RSA key but for keysend memos is plaintext, receive.ts:615-627), invoice_payment and payment events (grpc/regular.ts:53, 113), and contact, chat and tribe updates. The connection can be dropped and re-established indefinitely with the same captured header. The socket is receive-only (no server-side handler other than 'disconnect'), so there is no integrity or availability impact.

This is a distinct missing control from the flawed HTTP comparison recorded in transport-token-replay-ciphertext-block-extension (src/auth.ts:250): a separate entry point, a separate sink, and a fix to the HTTP middleware leaves this path unchanged. The sphinx_requests_transport_tokens table exists (migrate.ts:260, model RequestsTransportTokens) but is only ever truncated (migrate.ts:33), never consulted, so no used-token registry protects either path. Assumption: socket.io 4.7.1 (package-lock) exposes handshake request headers unchanged on client.handshake.headers for both polling and websocket transports.

## Evidence
1. [src/utils/socket.ts:38–56](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/socket.ts#L38-L56)
   socket.io handshake middleware: when x-transport-token is present it RSA-decrypts it and keeps only split('|')[0] as the bearer token (44-48); the '|timestamp' component is discarded and owner.lastTimestamp is never read, compared or updated. getOwnerFromToken (88-100) then admits any owner whose sha256(authToken) matches, so any transport token ever issued stays a valid socket credential until the owner's authToken itself changes.
2. [src/tests/controllers/transportToken.test.ts:85–119](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/tests/controllers/transportToken.test.ts#L85-L119)
   check1MinuteOldRequest encodes the project's own contract for transport tokens: a token whose timestamp is 61 seconds old must be refused with 401. The socket.io entry point implements none of that contract.
3. [src/auth.ts:250–268](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L250-L268)
   The HTTP sibling (ownerMiddleware) at least rejects a missing timestamp and one before owner.lastTimestamp and advances the high-water mark; because the socket path shares neither the check nor the mark, tokens the HTTP path has already aged out remain accepted on the socket, and fixing the HTTP comparison does not fix this entry point.
4. [src/utils/socket.ts:102–110](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/socket.ts#L102-L110)
   send/sendJson emit 'message' events to every socket registered under CLIENTS[tenant]; the ~40 call sites (messages.ts, receive.ts, grpc/regular.ts, payment.ts, invoices.ts, contacts.ts, chatTribes.ts, media.ts, ...) push each new message record via messageToJson, invoice_payment and payment events, and contact/tribe updates, so an admitted socket receives the owner's complete realtime feed.

## Impact
The attacker holds a persistent, unrevocable (short of rotating the owner's authToken) read position on the owner's complete realtime feed: every message record with sender, chat, type, amounts and media tokens, plaintext keysend memos, every invoice/payment event, and every contact and tribe change. DM and tribe bodies arrive as ciphertext to the owner's RSA key, so the loss is the owner's full communication and payment metadata plus the plaintext fields, not E2E content; that is still disclosure of the whole in-scope message/contact/tribe asset set in real time (C:H). The socket path accepts no client-to-server commands, so integrity and availability are unaffected.

## Reproduction steps
1. Attacker must have captured one x-transport-token for the victim, i.e. the on-path observer of the plain-HTTP hop the scheme is meant to protect (AT:PRESENT). They then open a socket.io connection to the relay's public port presenting that header; the handshake middleware admits it without any freshness or replay check, deterministically, with no credentials of their own and no victim action. The relay's 10 req/s/IP limiter does not apply to an established socket.

## Recommended fix
1. The socket.io handshake trusts the decrypted token component alone and ignores the freshness/ordering component of the transport token, so a captured token is reusable forever on this entry point. Fix criteria: The socket.io handshake must apply the same (corrected) transport-token validation as the HTTP middleware: reject a token without a parseable timestamp, require the timestamp to be strictly after the owner's stored high-water mark and within a short window of the relay clock, and advance the mark on success; verify that presenting a previously used or 61 s-old transport token in a socket.io handshake is refused while a fresh one is admitted.
2. Transport-token validation is duplicated by hand in two entry points (ownerMiddleware and the socket.io handshake) and has drifted. Fix criteria: A single shared verifier is used by every entry point that accepts x-transport-token, so a future fix to the replay check cannot leave one path unprotected.

---
**Severity:** HIGH
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-294](https://cwe.mitre.org/data/definitions/294.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258000

---

# Unauthenticated first-come owner-token claim on an unclaimed relay; the USE_PASSWORD pairing secret is disclosed by unauthenticated GET /connect

## Details
The owner's bearer credential is bootstrapped by POST /contacts/tokens (src/controllers/contacts.ts generateToken), which src/auth.ts no_auth() exempts from every authentication middleware. The handler selects the owner contact (the single isOwner row, or in proxy mode the isOwner row whose publicKey equals req.body.pubkey) and, when owner.authToken is falsy, stores sha256(req.body.token) as that owner's authToken (lines 248-257). Nothing proves the caller controls the node or the device: the first party to send {"token":"<anything>"} becomes the owner, and every later request bearing x-user-token: <anything> is accepted by ownerMiddleware as that owner. The legitimate user's own pairing attempt is then rejected with 'invalid token' (line 249-250).

The owner contact is in that claimable state on every fresh install from the moment finishSetup()/setupOwnerContact() creates it (src/utils/setup.ts:50-84, no authToken) until the user scans the QR, and again after GET /test_clear, which resets authToken to '' (src/controllers/details.ts:245-254) — an empty string is falsy, so the relay is claimable again after a clear. In proxy mode every pre-generated or admin-created tenant is stored with authToken: null (src/utils/proxy.ts:111-124) and is claimable by anyone who learns its pubkey; the root owner (id 1) carries the proxy's public node identity.

The only gate the code ships for this bootstrap is the per-process random password (src/utils/password.ts), compared against req.query.pwd when process.env.USE_PASSWORD === 'true' (contacts.ts:224-231). That gate does not protect an Internet-facing relay: getQR() (src/utils/connect.ts:52-55) embeds the very same password in the connection string 'ip::<url>::<password>', and connect() (connect.ts:182-202) substitutes that string into public/index.html and returns it to any caller of GET /connect, which app.ts:135-140 registers whenever config.connect_ui is set (the Greenlight production config enables it and the Greenlight instructions tell users to forward port 3001 to the Pi) and which auth.ts:134 also exempts from authentication. An attacker who reaches the port therefore first fetches /connect, base64-decodes the connection string to obtain the password, then calls POST /contacts/tokens?pwd=<password> with a token of their choice and owns the relay: all stored contacts, chats, messages, media keys and invites, and every payment-sending route backed by the LND admin macaroon (keysend, pay invoice, channel operations). The real owner cannot pair and must manually reset the database to recover.

The relay port is exposed to the Internet by design (README 'Network connectivity', docker-compose example with a public PUBLIC_URL), and the host is discoverable (public_ip, the Lightning node's advertised address), so an attacker scanning for relays that answer GET /app with 'INDEX' can claim any relay found in the unclaimed state.

## Evidence
1. [src/controllers/contacts.ts:207–263](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L207-L263)
   generateToken selects the owner contact (single isOwner row; by req.body.pubkey in proxy mode). The sole gate is `process.env.USE_PASSWORD === 'true'` comparing req.query.pwd to the in-process `password` (224-231). If owner.authToken is falsy, sha256(body.token) is stored as the owner's authToken for whoever calls first (248-257); afterwards any other token is rejected with 'invalid token'.
2. [src/auth.ts:130](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L130)
   '/contacts/tokens' is in no_auth(), so ownerMiddleware, hmacMiddleware and proxyAdminMiddleware all skip it: the claim request carries no credential.
3. [src/utils/connect.ts:52–55](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/connect.ts#L52-L55)
   getQR() embeds the same imported per-process `password` into the connection string base64('ip::<url>::<password>').
4. [src/utils/connect.ts:182–202](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/connect.ts#L182-L202)
   connect() unconditionally substitutes that connection string for CONNECTION_STRING in public/index.html and serves the page to any caller of GET /connect, disclosing the USE_PASSWORD secret.
5. [src/auth.ts:134](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L134)
   '/connect' is also in no_auth(), so the password-bearing page is served without any credential.
6. [app.ts:135–140](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L135-L140)
   GET /connect is registered whenever config.connect_ui (or CONNECT_UI env) is set; docs/sphinx_greenlight_build.md sets connect_ui: true in the production config and docs/sphinx_greenlight_instructions.md tells users to forward port 3001 to the device.
7. [src/utils/password.ts:3](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/password.ts#L3)
   A single per-process random hex password; the same module value is imported by both contacts.ts (the check) and connect.ts (the disclosure).
8. [src/utils/setup.ts:50–83](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/setup.ts#L50-L83)
   setupOwnerContact() creates the owner contact (id 1, isOwner) with no authToken once LND is reachable, opening the claimable window on every fresh install.
9. [src/controllers/details.ts:245–253](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/details.ts#L245-L253)
   clearForTesting (GET /test_clear) resets the owner's authToken to '' — falsy — so the owner row becomes claimable again by the unauthenticated bootstrap after a clear, not only on first install.
10. [src/utils/proxy.ts:111–123](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L111-L123)
   In proxy mode every pre-generated tenant is stored with authToken: null, so each is claimable through the same route by anyone who learns its pubkey.

## Impact
The attacker becomes the relay's owner: full read of all data the relay holds and will receive (contacts, messages, media keys, invites) and full use of every payment-sending route backed by the LND admin macaroon (C:H, I:H). The legitimate user's pairing is rejected with 'invalid token' and there is no API path to recover; the owner must manually reset the database (A:H).

## Reproduction steps
1. Attacker: any Internet host that reaches the relay's HTTP port while an owner contact has no authToken (fresh install before the user pairs, after /test_clear, or an unclaimed proxy tenant). One unauthenticated POST /contacts/tokens with a chosen token claims ownership; where USE_PASSWORD is enforced and connect_ui is on, a preceding unauthenticated GET /connect yields the password that satisfies the check. Deterministic and needs no victim action; it depends on the relay being in the unclaimed state, a timing window the attacker must hit (AT:PRESENT).

## Recommended fix
1. The owner-token bootstrap on the unauthenticated /contacts/tokens route is first-come-first-served: whoever sends a token while authToken is unset becomes the owner, with the pairing-secret check optional. Fix criteria: Claiming an unset (or cleared) owner authToken must always require a pairing secret generated on the host and conveyed only out of band (terminal QR, connection_string.txt, or an authenticated local UI); verify that POST /contacts/tokens on an unclaimed relay without the secret is rejected and leaves authToken unset, and that an emptied authToken ('' after /test_clear) is treated the same as unset.
2. GET /connect, reachable without authentication whenever connect_ui is set, embeds the same per-process pairing password that generateToken checks, so the USE_PASSWORD control is nullified for any remote caller. Fix criteria: The connect page must not expose the pairing secret to unauthenticated remote callers (serve it only to the local host / an authenticated session, or make the secret single-use and invalidated after the first successful pairing); verify that fetching /connect remotely does not yield a value that satisfies the USE_PASSWORD check.

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
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257997

---

# Peer-supplied isTribeOwner flag honoured on non-owner relays: owner-only branches and process crash

## Details
onReceive (src/network/receive.ts) decides locally whether this relay is the tribe owner by comparing owner.publicKey with chat.ownerPubkey (lines 132-135) and records the result in toAddIn so handlers can branch on it. Two defects combine: the flags are declared on the wire type (Payload extends AdminPayload, interfaces.ts:80-91), so JSON.parse of a keysend TLV, an MQTT message or a co-tenant message keeps whatever a peer put there; and toAddIn.isTribeOwner is set only when the relay IS the owner (line 138), never explicitly false. The merge `{ ...payload, ...toAddIn }` at line 354 therefore preserves a peer-supplied `"isTribeOwner": true` (and `"hasForwardedSats": true`) on every non-owner relay and for every unknown chat uuid. parseReceiveParams (helpers.ts:282-283) then exports the flags to all controllers. newmsg (send.ts:431-454) never emits these fields, so no legitimate wire value exists.

Consequences traced in the code:
- Crash of any relay: doTheAction (receive.ts:360-374) branches on payload.isTribeOwner, looks the chat up by payload.chat.uuid and passes the possibly-null result to decryptMessage, whose first line dereferences chat.groupPrivateKey (msg.ts:132); chat.myAlias is dereferenced next. doTheAction is not awaited (line 354) and the repository registers no unhandledRejection handler, so under node:16 (Dockerfile) the TypeError terminates the process. Any Lightning node triggers this with {type:0, chat:{uuid:"<unknown>"}, sender:{pub_key:...}, message:{}, isTribeOwner:true}.
- Owner-only branches on member relays: receiveGroupJoin upserts an approved ChatMember (chats.ts:638-660), replays the member's locally stored tribe history to the attacker's MQTT topic (chats.ts:717-721, chatTribes.ts:781-905 — content bodies are generally empty on members, but uuids, amounts, aliases, dates, media tokens and MediaKey entries re-encrypted to the attacker-chosen contactKey are sent) and PUTs tribestats to the tribe host as if owner; receiveGroupLeave removes any claimed pubkey (e.g. the real tribe owner) from chat.contactIds and destroys its ChatMember (chats.ts:792-820); receiveMemberRequest creates a Contact with an attacker-chosen RSA key plus a pending ChatMember (chatTribes.ts:258-311); receiveMessage/receiveBoost/payment persist forwardedSats=true.

Member-side sending resolves the tribe owner by chat.ownerPubkey (send.ts:180-185), not contactIds, so the group_leave effect is to the member's local tribe state rather than to delivery. No sats are spent by the victim on these paths (replay goes over MQTT). The defect is independent of the signature bypass recorded at receive.ts:562: even a correctly signed sender can set the flag, so it persists after signatures are enforced.

## Evidence
1. [src/network/receive.ts:354](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L354)
   doTheAction receives { ...payload, ...toAddIn }. toAddIn only ever carries isTribeOwner/hasForwardedSats when this relay IS the tribe owner, so on every other relay (or for an unknown chat uuid) a peer-supplied payload.isTribeOwner === true survives the merge and is handed to the handler as if locally computed. The call is not awaited, so a rejection inside doTheAction is unhandled.
2. [src/network/receive.ts:132–138](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L132-L138)
   The relay computes isTribeOwner from owner.publicKey === maybeChat.ownerPubkey and sets toAddIn.isTribeOwner = true only in the owner case; it is never set to false, so the override does not apply on member relays.
3. [src/network/receive.ts:360–373](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L360-L373)
   doTheAction branches on payload.isTribeOwner from the merged payload: it looks up the chat by payload.chat.uuid (null when the uuid is unknown or payload.chat is absent) and passes it to decryptMessage and dereferences chat.myAlias. With a forged flag and an unknown uuid this throws a TypeError inside an un-awaited async call → unhandled rejection → Node 16 terminates the process (no unhandledRejection handler exists in the repo).
4. [src/utils/msg.ts:132](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/msg.ts#L132)
   decryptMessage dereferences chat.groupPrivateKey on its first line; with the null chat from doTheAction this is the TypeError that crashes the relay.
5. [src/helpers.ts:282–283](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L282-L283)
   parseReceiveParams exports isTribeOwner = dat.isTribeOwner and hasForwardedSats = dat.hasForwardedSats straight from the (peer-authored) payload to every controller.
6. [src/network/send.ts:431–454](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L431-L454)
   newmsg builds every outbound wire message with only type/chat/message/sender; isTribeOwner and hasForwardedSats are never emitted, so any value arriving on the wire is attacker-authored, not a legitimate protocol field.
7. [src/network/interfaces.ts:80–91](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/interfaces.ts#L80-L91)
   Payload extends AdminPayload, so the server-only authority flags share the parsed wire type instead of a separate server-side envelope.
8. [src/controllers/chats.ts:638–660](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L638-L660)
   addMemberToTribe upserts an approved ChatMember row only when isTribeOwner; with the forged flag a member relay records the attacker as an approved member of a tribe it does not own.
9. [src/controllers/chats.ts:717–727](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L717-L727)
   receiveGroupJoin, gated on the wire flag, calls replayChatHistory(chat, theSender, owner) and tribes.putstats on the member relay.
10. [src/controllers/chatTribes.ts:781–904](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L781-L904)
   replayChatHistory publishes the member's last 40 stored messages of the tribe (uuids, amounts, aliases, dates, media tokens, and MediaKey rows re-encrypted to the attacker-supplied contactKey) over MQTT to `${attacker_pubkey}/${chat.uuid}`; for attachments with no MediaKey row it dereferences mediaKey.key inside an un-awaited asyncForEach, another unhandled rejection.
11. [src/controllers/chats.ts:792–819](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L792-L819)
   receiveGroupLeave with the forged flag removes the claimed sender (any pubkey, e.g. the real tribe owner) from chat.contactIds and destroys their ChatMember on the member relay.
12. [src/controllers/chatTribes.ts:256–258](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L256-L258)
   receiveMemberRequest is gated solely on the wire flag; on a member relay a forged flag creates a Contact with an attacker-chosen RSA contactKey and a pending ChatMember row.
13. [src/controllers/messages.ts:570](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L570)
   hasForwardedSats from the wire is persisted as forwardedSats on the stored message.

## Impact
Availability HIGH: a single unauthenticated keysend with isTribeOwner:true and an unknown chat uuid crashes the relay process via an unhandled TypeError (receive.ts:360-374, msg.ts:132), repeatable at will. Integrity LOW: member relays' ChatMember/contactIds/Contact rows and message flags are altered by an unauthorised peer and owner-only side effects (history replay, putstats) run. Confidentiality LOW: replayChatHistory publishes the member's stored tribe history metadata and MediaKey entries, re-encrypted to the attacker's key, to the attacker's MQTT topic; message bodies on members are generally empty. No funds move on these paths.

## Reproduction steps
1. Attacker: any Lightning node (keysend with a sphinx custom-record JSON payload, receive.ts:720-726), any publisher on the relay's MQTT topic, or a co-tenant in proxy mode. Send {type:14/15/19/0, chat:{uuid:<tribe the victim joined, or any unknown uuid>, type:2}, sender:{pub_key:<any>}, message:{}, isTribeOwner:true}. On a non-owner relay toAddIn is empty, the flag survives the merge at line 354 and the owner-only branches run; with an unknown uuid doTheAction throws on a null chat and the process exits. No credentials, no user interaction, deterministic.

## Recommended fix
1. Server-computed authority flags (isTribeOwner, hasForwardedSats) share the wire payload type and are only overridden when this relay is the tribe owner, so peer-supplied values are honoured on member relays and for unknown chats, unlocking owner-only handler branches. Fix criteria: Authority flags are always derived by the relay from its own chat.ownerPubkey comparison (explicitly false when not owner or when no chat exists) and never read from inbound JSON — e.g. stripped before dispatch or carried in a separate server-side envelope. Verify by delivering payloads with isTribeOwner:true / hasForwardedSats:true to a non-owner relay and confirming no owner-only branch executes and forwardedSats is not set.
2. doTheAction's tribe-owner branch dereferences a chat that may be null, inside an un-awaited async call with no unhandledRejection handler, so a single crafted payload terminates the relay process. Fix criteria: The inbound dispatch path cannot terminate the process on peer input: the owner branch tolerates a missing chat, dispatched handlers are awaited or their rejections caught and logged, and a process-level unhandledRejection handler exists. Verify by sending the crash payload (isTribeOwner:true with an unknown chat uuid) and confirming the relay keeps serving.

---
**Severity:** HIGH
**Status:** Open
**Category:** Untrusted security-decision input
**CWE:** [CWE-807](https://cwe.mitre.org/data/definitions/807.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257996

---

# Any contact of a tribe owner can plant a tribe MediaKey record, redirecting other members' paid-media payments and content to themselves

## Details
In a tribe, paid attachments posted by a member (the OP) are sold through the owner: a buyer's `purchase` keysend (carrying the broadcast token, muid M) goes to the owner; `purchaseFromOriginalSender` (src/network/modify.ts:61-147) looks for a MediaKey row with `originalMuid == M`. If none exists it forwards the purchase to the OP; the OP answers `purchase_accept` (with `purchaser`), and the owner's `sendFinalMemeIfFirstPurchaser` (modify.ts:149-223) downloads, re-keys and re-uploads the media, stores MediaKey{muid: <re-upload muid>, originalMuid: M, sender: <accept sender>} and delivers the content to the purchaser. On every later purchase of M the row is found, the stored key/muid is sent to the buyer and the buyer's full `amount` is keysent to `mediaKey.sender` (modify.ts:108-123, forced keysend at send.ts:253-257).

`sendFinalMemeIfFirstPurchaser` accepts the `purchase_accept` from anyone. Everything is taken from the sender's payload: the item muid (`originalMuid`), the host and content (via the token's host and the RSA(groupKey) mediaKey — the host handling is the separate SSRF record), and the merchant identity (`sender.id`, modify.ts:311). The only guard is `MediaKey.findOne({ muid })` on the token's muid. For paid attachments that guard never trips: the poster's client sends them with `skipSigning` (src/controllers/media.ts:137), so the owner receives an empty mediaKey, `downloadAndUploadAndSaveReturningTermsAndKey` returns early (`if (!mt || !key)`, modify.ts:235) without creating a row, and the broadcast carries the poster's token (muid M) unchanged. No row with muid == M ever exists on the owner, so planting succeeds for every paid item posted by a member.

Attack: X is any Lightning node holding a Contact row in owner O's tenant — created automatically on tribe join (chats.ts:617-629) or on any DM to O (helpers.ts:187-202). X sees a paid attachment with token muid M in O's tribe (tribe uuid and group_key are also published to the tribes server). X sends O one `purchase_accept` keysend with `chat.uuid` = tribe uuid, `chat.type` = tribe, `message.purchaser` = any existing contact id other than O's (ids are small sequential integers), `message.mediaToken` = `base64(<x-host>).M....` and `message.mediaKey` = RSA(groupKey, k), where X's host answers /ask and /verify with a token, serves RNCryptor(k, junk) at /file/<token> and returns `{muid: M2}` to the upload. O's relay inserts MediaKey{muid: M2, originalMuid: M, sender: X.id}. From then on every member buying item M pays O, and O's `purchaseFromOriginalSender` keysends the full `amount` to X and delivers X's substituted content with X's key; the OP is never paid and the buyer receives junk. Planting before the first legitimate sale (e.g. as soon as the attachment is broadcast) captures all subsequent purchases deterministically; after a legitimate first sale a second row can still be planted but which row `findOne({originalMuid})` returns is DB-order dependent. Purchases of the owner's own attachments are unaffected (they do not pass through purchaseFromOriginalSender).

Root cause: missing authorization in the tribe re-key path — the relay does not verify that the `purchase_accept` sender is the poster of the attachment identified by the token's muid (e.g. an attachment Message in this chat with that muid and sender == senderContact.id), nor that a purchase for that purchaser was actually forwarded to that sender. The inbound-signature defect (separate verified record) additionally lets X claim any contact's pub_key, but is not required: X uses its own contact so the payouts reach X.

## Evidence
1. [src/network/modify.ts:149–222](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/modify.ts#L149-L222)
   sendFinalMemeIfFirstPurchaser treats whoever sent a purchase_accept as the merchant: it requires only a mediaToken, a `purchaser` that is some existing contact id (!= owner) and the absence of a MediaKey row whose muid equals the token's muid, then calls downloadAndUploadAndSaveReturningTermsAndKey with the sender as merchant. It never verifies that the sender posted an attachment with that muid in this chat or that a forwarded purchase to them is pending. This is the code the fix must change.
2. [src/network/modify.ts:305–315](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/modify.ts#L305-L315)
   MediaKey.create stores `sender: sender.id` (the purchase_accept sender) and `originalMuid: ogmuid` (the muid of the attacker's token, i.e. the victim item's muid) with `muid: json.muid` from the attacker-chosen host's upload response; this is the row every later purchase of that item matches.
3. [src/network/modify.ts:75–122](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/modify.ts#L75-L122)
   purchaseFromOriginalSender looks a buyer's purchase up by `originalMuid == token muid`; when a row exists it sends the stored key/muid to the buyer as purchase_accept and sends a `purchase` carrying the buyer's full `amount` to mediaKey.sender with realSatsContactId set ('PAY THE OG POSTER HERE'), so the planted row decides both the delivered content and the payee.
4. [src/network/receive.ts:342–351](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L342-L351)
   In the tribe-owner branch any purchase_accept whose `purchaser` differs from the owner's id is routed to sendFinalMemeIfFirstPurchaser; the sender is resolved only by the claimed pub_key with no membership, poster or pending-purchase check.
5. [src/controllers/media.ts:133–137](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/media.ts#L133-L137)
   A paid attachment is sent with `skipSigning: amt ? true : false`, so (via addInMediaKey, utils/msg.ts:92) the tribe owner receives it with an empty mediaKey and the owner's forward step never re-keys it: downloadAndUploadAndSaveReturningTermsAndKey returns at `if (!mt || !key)` (modify.ts:235) without creating a MediaKey row, and the broadcast carries the poster's token unchanged. Consequently no row with muid == <paid item muid> exists on the owner, and the only guard in sendFinalMemeIfFirstPurchaser (`MediaKey.findOne({ muid })`) passes for every paid item.
6. [src/network/send.ts:253–256](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L253-L256)
   For the tribe owner with `amount` and realSatsContactId equal to the recipient, MQTT/co-tenant delivery is disabled and the message is forced to a keysend of `amount` sats, so the redirected payout is an irreversible Lightning transfer from the owner's node to the attacker.
7. [src/controllers/chats.ts:617–628](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L617-L628)
   addMemberToTribe, run by the owner relay on an inbound group_join, creates the Contact row for the joining pubkey without owner interaction (helpers.ts:187-202 does the same for any DM sender), so any Lightning node can self-register into the 'contact of the owner' position the attack requires and, as a member, sees the paid item's broadcast token and the tribe uuid/group_key (also published to the tribes server, utils/tribes.ts:466-470).

## Impact
Integrity of the tribe's paid-media accounting and content delivery is fully subverted: the owner's node keysends every subsequent buyer's payment for the item to the attacker (irreversible Lightning transfers), buyers receive attacker-substituted content under the attacker's key, and the legitimate poster loses all revenue for that item. The attacker does not obtain the genuine media key (no confidentiality loss) and availability is unaffected.

## Reproduction steps
1. The attacker is any Lightning node with a Contact row in the tribe owner's tenant; the relay creates that row automatically on a public-tribe join or on a first DM, with no owner approval. One crafted purchase_accept keysend (tribe uuid and group_key are public on the tribes server; the item muid is visible in the broadcast) plus an attacker-hosted HTTP server answering the meme protocol plants the record; no race or special configuration is needed. The monetary redirection then fires each time another member performs the routine action of buying the item, so user interaction is passive.

## Recommended fix
1. sendFinalMemeIfFirstPurchaser records the purchase_accept sender as the merchant for a muid without verifying they posted that attachment or that a forwarded purchase to them is pending. Fix criteria: Before downloading, re-keying or creating a MediaKey, the owner must confirm the sender is the original poster of an attachment in this chat whose token muid equals the accept token's muid, and that a purchase for this purchaser was forwarded to them and is still pending. A purchase_accept from any other contact must be ignored; verify that the planted-row attack leaves no MediaKey and no payment redirection.
2. purchaseFromOriginalSender pays mediaKey.sender based solely on the stored row, so a planted row directs real funds. Fix criteria: The payee for a purchase must be derived from the stored original attachment's sender for that muid, not from a MediaKey.sender field that peers can populate; confirm that funds for item M only ever go to the contact that posted M.
3. The dedupe guard keys on the accept token's muid, which never matches any row for paid items (no row is created when the owner forwards a paid attachment), so it offers no protection against repeated or foreign accepts. Fix criteria: The 'already sent' check must key on the item identity actually used later (originalMuid == item muid) and on the pending purchase, so that at most one merchant row can exist per item and it can only be created by the verified poster.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing Authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257995

---

# receiveGroupKick accepts a kick for any chat from any sender without owner check

## Details
group_kick (type 16) is the notification a tribe/group owner sends to a member it has removed: the only sanctioned producers are the owner-authenticated PUT /kick/:chat_id/:contact_id (kickChatMember, src/controllers/chats.ts:84-124) and the builtin kick bot (src/builtin/utill/kick.ts:17-56), both of which run as the chat owner. On the receiving relay the message is trusted completely. The inbound path is parseKeysendInvoice -> parseAndVerifyPayload (src/network/receive.ts:562-591, which returns the payload even when the signature is missing or invalid) -> onReceive -> doTheAction -> ACTIONS[16] = chats.receiveGroupKick (src/controllers/index.ts:271). On a member relay the chat's ownerPubkey is not the owner's key, so isTribeOwner is false (receive.ts:132-135), none of the owner-side gating block applies, doAction stays true and line 354 dispatches directly. receiveGroupKick (chats.ts:132-180) then calls parseReceiveParams, which for non-conversation chat types resolves the chat purely by payload chat.uuid within the tenant and, for tribes, fabricates a sender {id:0, alias} when the pubkey is unknown (src/helpers.ts:320-332); the handler stores a confirmed Message of type group_kick in that chat and emits a 'group_kick' socket event (contact + chat + message) to the victim's connected clients. At no point is sender.pub_key compared to chat.ownerPubkey (which the member relay does hold: chatTribes.ts:126 stores it on join) or to the chat's membership.

Tribe uuids are public (listed by the tribe server), so any Lightning node can send one keysend to a tribe member's node carrying {type:16, chat:{uuid:<tribe uuid>, type:2}, sender:{pub_key:<any 66-hex>}, message:{}} and have the member's relay record 'you were kicked' and push the event to the client. For non-tribe groups (chat type 1) the same applies to anyone who knows the group uuid, e.g. any current or former member. Because signature verification is not enforced, sender.pub_key can be set to the real owner's pubkey so the forged kick is indistinguishable from a genuine one in the stored message and UI; the finding does not depend on that, since even a correctly signed payload from an arbitrary node is accepted.

Relay-side chat data is not deleted (that code is commented out at chats.ts:139-148), so the confirmed impact on the relay is a forged, confirmed owner-only system message persisted in the victim's chat and a spoofed 'group_kick' event delivered to the client. Assumption (out of this repository): the Sphinx client's standard handling of group_kick is to remove the chat from the user's view, which would make the forged event a per-conversation denial for the victim.

Root cause: missing authorization on an owner-only control message.

## Evidence
1. [src/controllers/chats.ts:132–180](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L132-L180)
   receiveGroupKick resolves the chat via parseReceiveParams by payload uuid and, with only an `if (!chat) return` guard, records a confirmed group_kick Message and emits a 'group_kick' socket event to the tenant's clients. No comparison of the sender pubkey against chat.ownerPubkey (tribes) or chat membership (groups) is performed; the relay-side deletion code is commented out.
2. [src/network/receive.ts:132–135](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L132-L135)
   On a member relay owner.publicKey !== maybeChat.ownerPubkey, so isTribeOwner is false and the entire owner-side gating block (lines 137-353) is skipped; doAction remains true and line 354 dispatches the unauthenticated payload straight to ACTIONS[16] = receiveGroupKick. group_kick is also not in typesToForward, so no membership check exists anywhere on the path.
3. [src/helpers.ts:320–332](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L320-L332)
   For non-conversation chat types parseReceiveParams looks the sender up by pubkey only to attach an id, finds the chat purely by uuid+tenant, and for tribes injects a synthetic sender {id:0, alias} when the pubkey is unknown — so a stranger's kick is processed with a fabricated sender identity rather than rejected.
4. [src/controllers/chats.ts:84–124](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L84-L124)
   kickChatMember is the sanctioned producer of group_kick: it runs only for the authenticated owner of the chat (req.owner, tenant-scoped) and sends the kick solely to the kicked contact. The receive side is the only place the owner relationship could be enforced for inbound kicks and it is not.
5. [src/network/receive.ts:562–591](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L562-L591)
   parseAndVerifyPayload returns the payload whether or not the signature over it is valid (lines 578-582, 588), so sender.pub_key may be set to the real tribe owner's key, making the forged kick indistinguishable from a genuine one. The missing owner check is exploitable even with a valid signature, so this is an amplifier rather than the root cause.

## Impact
A forged, confirmed owner-only system message (group_kick) is persisted in the victim's chat and a spoofed 'group_kick' event is pushed to the victim's clients, optionally attributed to the real owner. Relay-side chat data and membership are not modified (deletion code is commented out) and nothing is disclosed. Client-side removal of the chat is an out-of-repo assumption and is not rated here.

## Reproduction steps
1. Any Lightning node (threat-model adversary 2, in scope) sends one keysend to a tribe member's pubkey with TLV payload {type:16, chat:{uuid:<tribe uuid>, type:2}, sender:{pub_key:<any 66-hex>}, message:{}}. Tribe uuids are public via the tribe server; no credentials, membership or victim action are required, and no gate on the inbound path (receive.ts:132-135, 354; chats.ts:132-180) inspects the sender. For non-tribe groups the attacker needs the group uuid (any current or former member has it).

## Recommended fix
1. receiveGroupKick does not verify that the sender is authorised to kick in the referenced chat. Fix criteria: An inbound group_kick must be ignored unless the sender pubkey (bound to a verified signature) equals chat.ownerPubkey for tribe chats, or is an existing participant of the chat for plain groups, and the receiving owner is itself a participant. A kick from an unrelated pubkey must produce no Message row and no socket event.
2. parseAndVerifyPayload returns the payload when the signature is missing or invalid, so sender.pub_key cannot be relied on by any owner check. Fix criteria: Inbound payloads whose signature does not verify against sender.pub_key are dropped before dispatch, so that the owner check above operates on an authenticated sender identity.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing Authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257994

---

# Unsolicited group_create/group_invite creates chats and contacts with attacker-chosen keys and triggers paid replies

## Details
receiveGroupCreateOrInvite (ACTIONS 12/13) is reachable by any Lightning node with one keysend carrying a Sphinx TLV payload; receive.ts dispatches non-tribe types straight to the handler with no sender or membership check. For tribes the handler verifies the chat uuid is a timestamp signed by the sender (validateTribeOwner); for plain groups (chat.type = 1) it verifies nothing.

Per attacker message the victim relay:
1. Creates a Chat with attacker-chosen uuid/name/type (no dedup: Chat.uuid has no unique index), and the owner need not be a listed member.
2. Creates a confirmed Contact (status 1) for every arbitrary pubkey in chat.members that has a key, storing the attacker-chosen RSA contactKey. If the victim later adds that real person via POST /contacts, createContact reuses the row and, because contactKey is set, skips the key exchange (contacts.ts:450); the victim's messages/media keys to that person are encrypted to the attacker's key and unreadable by the real recipient until the recipient's own contact_key arrives (receiveContactKey overwrites it). The attacker does not receive those messages, so this is an integrity/denial effect, not disclosure.
3. For type group_invite, auto-replies group_join via sendMessage to every contactId in the chat: one keysend of min_sat (default 3 sats) plus routing fees per attacker-listed pubkey, to destinations the attacker chose. Listing N attacker-owned pubkeys turns one cheap inbound keysend into N paid outbound ones, repeatable without bound.

What the project already concedes to a stranger is narrower: the DM path (helpers.findOrCreateContactByPubkeyAndRouteHint) creates one Contact for the sender's own pubkey with no contactKey and one contact_key reply. This path grants confirmed contacts with attacker-chosen keys for third-party pubkeys and 1:N attacker-directed spending.

The mechanics are the ones the legitimate group flow relies on (createGroupChat/addGroupMembers send group_create/group_invite and member relays run this same handler and auto-reply), so they work in production. Assumption: LND (via @grpc/grpc-js 1.8.7 keysendMessage) delivers keysends to any pubkey reachable in the graph.

Root cause: group-type create/invite trusts every field of an unauthenticated peer payload and acts on it with confirmed-contact writes and payments.

## Evidence
1. [src/controllers/chats.ts:869–949](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L869-L949)
   receiveGroupCreateOrInvite: validateTribeOwner runs only when chat_type === tribe (884-890). For chat_type === group (1) nothing checks the sender: for every entry of payload.chat.members that carries a key, a Contact is created for that (arbitrary third-party) pubkey with contactKey = member.key, status 1 (confirmed) and fromGroup true (912-919), and a Chat with the attacker's uuid/name is created (939-949) whether or not the owner was listed.
2. [src/controllers/chats.ts:974–989](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L974-L989)
   When payload.type is group_invite (13) the relay immediately replies with a group_join via network.sendMessage to the whole chat.contactIds, i.e. to every pubkey the attacker listed; no confirmation step or cap.
3. [src/network/send.ts:215–291](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L215-L291)
   sendMessage loops over contactIds (skipping only the owner), looks each Contact up by id and calls signAndSend with amt = max(0, min_sat_amount) (default 3 sats, config.ts DEFAULT_MIN_SAT) and route_hint ''; with no MQTT topic or co-tenant dest, signAndSend calls LND.keysendMessage, so one inbound invite produces N outbound keysends to attacker-chosen destinations.
4. [src/network/receive.ts:354–387](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L354-L387)
   onReceive -> doTheAction -> ACTIONS[payload.type]: for a payload whose chat.type is not tribe, isTribeOwner is false, the whole owner-gating block is skipped and the handler runs with doAction true. The LN ingress (parseKeysendInvoice) passes any keysend TLV payload here; the only owner lookup is by dest pubkey.
5. [src/controllers/contacts.ts:437–457](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L437-L457)
   createContact (POST /contacts): if a row for the pubkey already exists it is reused and the contact_key exchange is re-run only when existing.contactKey is empty (450). A row pre-seeded by the attacker with a contactKey therefore keeps the attacker-chosen RSA key as the key the client encrypts to for that pubkey.

## Impact
Integrity LOW: attacker-controlled chat/contact rows and RSA contact-key pre-seeding for arbitrary pubkeys on the victim relay, breaking the victim's first messages to those people. Availability LOW: attacker-directed spending of min_sat (default 3 sats) plus fees per listed pubkey per message, and unbounded row growth. Confidentiality NONE: the attacker does not receive the mis-encrypted messages.

## Reproduction steps
1. Any Lightning node sends a type-13 (group_invite) keysend with chat.type=1, a uuid, and members mapping N pubkeys to arbitrary RSA keys. No credential, relationship or user action is needed: receive.ts performs no sender check for non-tribe types and the handler validates only the tribe branch. The relay creates N confirmed contacts and a chat and sends N min_sat group_join keysends; repeating with new uuids grows the DB and spends sats without bound, and pre-seeded keys poison later contact additions. The LN ingress has no rate limit.

## Recommended fix
1. Group-type group_create/group_invite payloads are accepted from any Lightning node with no check that the sender is a known contact or participant, that the receiving owner is a listed member, or that the invite was expected. Fix criteria: Accept group create/invite only when the signature-verified sender is an existing contact and a listed member and the owner is listed; otherwise drop the payload. Verify that an invite from an unknown pubkey creates no Chat and no Contact.
2. Member entries from the peer payload are stored as confirmed contacts with the peer-supplied contactKey, and createContact treats any stored contactKey as authoritative. Fix criteria: Do not mark group-seeded contacts as confirmed or persist a peer-supplied key as authoritative until a contact_key exchange with that pubkey completes; createContact must initiate the key exchange for fromGroup rows. Verify that adding a pre-seeded pubkey via POST /contacts triggers a contact_key exchange.
3. A group_invite triggers an automatic paid group_join keysend to every listed contact before the owner has accepted anything. Fix criteria: Do not auto-reply with keysends to unverified invites (require the owner's acceptance or restrict the reply to the verified inviter). Verify that an unsolicited invite listing N pubkeys produces zero outbound payments.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing Authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257993

---

# Tribe delete payloads mark any message deleted without verifying the deleter

## Details
Deleting a message in a Sphinx tribe is a two-hop protocol: a member keysends a type-17 (delete) payload to the tribe owner, the owner's relay is supposed to verify that the deleter authored the message (header comment in src/network/receive.ts: 'owner needs to check that the delete is the one who made the msg'), and then broadcasts the delete to all members over MQTT. Each receiving relay runs receiveDeleteMessage (src/controllers/messages.ts:772-797), which for tribe-typed payloads deliberately omits the sender filter and trusts that 'this is already validated on admin's node'. Two defects break that assumption.

1. Owner side: the og-poster check at receive.ts:212-224 executes only when the claimed sender pubkey already resolves to a Contact (`&& senderContactId`). A delete from an unknown pubkey — any Lightning node that never joined, or a member presenting a different pub_key since signatures are not enforced — skips the check, keeps doAction = true, is forwarded to every member via forwardMessageToTribe (306-313) and applied locally via doTheAction (354). The owner's receiveDeleteMessage then matches `{ uuid, tenant }` with no chat or sender restriction.

2. Member side: the same handler is reachable directly. A keysend to any member with chat.type = 2 and chat.uuid of a tribe the victim has joined bypasses the owner-side block entirely (isTribeOwner false), parseReceiveParams (helpers.ts:320-333) synthesises a sender {id:0} for unknown pubkeys, and receiveDeleteMessage never checks that sender.pub_key equals chat.ownerPubkey. Messages can thus be marked deleted on individual members without the owner's involvement.

IsTribe is taken from the payload's own chat.type (receive.ts:114, messages.ts:781), so the attacker chooses the unchecked branch. Message uuids are not secret: every tribe post is broadcast to all members carrying message.uuid (send.ts newmsg, messages.ts:467), so any co-member knows every uuid in the chat, including the owner's; because the lookup is uuid+tenant only, a message in any other chat of the victim whose uuid is known is equally affected. Result: moderation bypass and vandalism of the tribe's history on the owner's relay and every member's relay. The handler and the conditional check ship unchanged in the committed dist/ (dist/src/controllers/messages.js:633-636, dist/src/network/receive.js:190).

## Evidence
1. [src/controllers/messages.ts:781–790](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L781-L790)
   receiveDeleteMessage decides isTribe from the payload's own chat.type, builds the lookup as { uuid: msg_uuid, tenant } and adds where.sender only when NOT tribe-typed ('in tribe this is already validated on admin's node'). For tribe-typed payloads any message in the tenant with that uuid — no chatId, no sender, no owner-pubkey check — is set to status deleted and a 'delete' socket event is pushed to the client. This is the code the fix must change; the same code ships in dist/src/controllers/messages.js:633-636.
2. [src/network/receive.ts:211–224](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L211-L224)
   The owner-side 'sender is the og poster' check runs only `if (payload.type === msgtypes.delete && senderContactId)`. When the claimed sender pubkey has no Contact row (a fresh node, or any unknown pubkey string) senderContactId is null, the block is skipped and doAction stays true. delete is not in typesThatNeedPricePerMessage (64-69), so the membership check at 167-172 is skipped too.
3. [src/network/receive.ts:306–313](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L306-L313)
   With doAction true the tribe owner's relay forwards the stranger's delete to every member over MQTT (delete is in typesToForward, line 55; forwardMessageToTribe passes payload.message incl. the target uuid through unchanged) before applying it locally.
4. [src/network/receive.ts:354](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L354)
   doTheAction dispatches to ACTIONS[payload.type]. On a member relay (not tribe owner) the whole owner-side block 138-352 is skipped, so a tribe-typed delete keysent directly to a member reaches receiveDeleteMessage with no check that the sender is the tribe owner.
5. [src/controllers/index.ts:272](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L272)
   ACTIONS maps msgtypes.delete (17) to messages.receiveDeleteMessage, so the handler is reachable from every ingress path (keysend via parseKeysendInvoice, MQTT via receiveMqttMessage, co-tenant).
6. [src/helpers.ts:320–332](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L320-L332)
   For tribe-typed payloads whose sender pubkey is unknown, parseReceiveParams synthesises sender = { id: 0, alias } instead of rejecting and resolves the chat by uuid+tenant alone, so receiveDeleteMessage's '!owner || !sender || !chat' guard never fires for a stranger.
7. [src/grpc/subscribe.ts:34–36](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/subscribe.ts#L34-L36)
   Ingress: every settled keysend invoice from any Lightning node is handed to parseKeysendInvoice, which parses the TLV payload and calls onReceive — no peering or contact relationship is required to reach the handler.
8. [src/network/receive.ts:578–590](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L578-L590)
   Context (root cause recorded separately as inbound-payload-signature-verification-result-ignored): the signature result is discarded, so payload.sender.pub_key is attacker-chosen; an existing member can therefore present as an unknown pubkey without even using a fresh node. The defect here is independent: a genuinely fresh node key also has no Contact row.

## Impact
Integrity: any message whose uuid is known can be flipped to status deleted on the owner's relay and propagated to all members, hiding it in every client and defeating the owner's moderation authority. Content is not altered and the modification is a single status flag, so rated LOW rather than HIGH. No confidentiality or availability impact.

## Reproduction steps
1. Attacker is any Lightning node able to keysend the victim (adversary 2), or an MQTT publisher under the victim's prefix (adversary 3). They learn a tribe uuid (listed on the tribe server; carried in every tribe payload) and target message uuids (broadcast to all members), then send one keysend (min_sat_amount) per target with type=17, chat={uuid,type:2}, message={uuid}, and either a fresh node key or any unknown sender.pub_key. Sending to the owner propagates the delete to every member; sending to a member hits it directly. No authentication, no victim interaction, no non-default configuration; deterministic from the code paths cited.

## Recommended fix
1. receiveDeleteMessage trusts the inbound payload's chat.type to decide that no sender verification is needed, and matches on uuid+tenant alone. Fix criteria: On a non-owner member relay a tribe-typed delete must be acted on only when the (signature-bound) sender is the tribe owner (sender.publicKey === chat.ownerPubkey); in every other case the handler must require ogMsg.sender === sender.id and ogMsg.chatId === chat.id. A delete keysent by an arbitrary node for another member's message must leave the message status unchanged.
2. The owner-side og-poster check in onReceive is conditional on the claimed sender already being a known Contact, so unknown senders bypass it and the delete is forwarded to the whole tribe. Fix criteria: A delete whose sender has no Contact/ChatMember row, or whose contact id does not match the target message's sender, must set doAction = false and must not be forwarded; verify by sending a delete from a fresh node for an existing tribe message and confirming no member receives a delete and the message remains visible.

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
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257992

---

# Member-side receiveBotRes stores spoofed bot messages from any Lightning node into any chat

## Details
The non-owner branch of `receiveBotRes` (src/controllers/bots.ts:596-638) runs whenever this relay receives a `bot_res` (type 25) payload whose `chat.uuid` matches a Chat row the owner holds but does not own (`owner.publicKey !== chat.ownerPubkey`, line 575) — every tribe the owner is a member of; tribe uuids are public on the tribe server. The payload reaches it unauthenticated: `parseKeysendInvoice` (src/network/receive.ts:632-727) hands any keysend TLV to `parseAndVerifyPayload` (561-591), which returns the parsed payload even when the signature is absent, malformed or invalid, and `onReceive` (121-130) dispatches the three bot types straight to `ACTIONS[type]` before the membership/price/sender logic other types pass through (for bot_res not even `bot_uuid` is required). The member branch then performs no origin check at all: it does not verify the signature result, does not require `sender.pub_key === chat.ownerPubkey`, and does not require the payload to have arrived on the tribe's MQTT topic. It creates a `Message` row of type bot_res with attacker-chosen `messageContent`, `senderAlias` (`sender.alias`, default 'Bot'), `senderPic` (`sender.photo_url`), `uuid`, `replyUuid`, `parentId`, `date` and `network_type`, sets `sender` to the matching local contact id or 0, marks it `confirmed`, and pushes it to the connected client over socket.io as a `message` event (lines 612-637).

In the sanctioned design a bot_res reaches a tribe member only from the tribe owner's relay (botapi/broadcast.ts via network.sendMessage over MQTT, signed by the owner) after the owner's relay has run the bot pipeline; this path lets any Lightning node keysend a 1-sat TLV `{type:25, chat:{uuid:<tribe>}, sender:{pub_key:x, alias:'GitBot', photo_url:...}, message:{content:..., uuid:..., replyUuid:...}}` to the victim's pubkey and have a fabricated bot message — a fake payment/boost notice, a fake GitBot/ML answer, or a reply threaded under a real message via `replyUuid`/`parentId` — stored in the victim's tribe history and displayed as a genuine bot response. Over Lightning `message.amount` is overwritten with the sats actually received (receive.ts:722-723); over MQTT (`receiveMqttMessage`, 516-529, no amount override; the relay's own cross-pubkey publishing shows the broker permits publishing to another pubkey's topic) the attacker also chooses `amount`. This is the member-side sibling of the verified owner-branch finding bot-res-unauthenticated-final-action-on-tribe-owner-relay (bots.ts:543-595, finalAction pay/broadcast); the sink here is the victim's own message store and client, not the owner's wallet.

## Evidence
1. [src/controllers/bots.ts:596–638](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L596-L638)
   Non-owner branch stores a confirmed bot_res Message with attacker-chosen content, alias, picture, uuid, reply/parent ids and pushes it to the client; no check that the sender is the tribe owner.
2. [src/network/receive.ts:121–130](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L121-L130)
   bot_res dispatched to ACTIONS without any sender or membership validation.
3. [src/network/receive.ts:561–591](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L561-L591)
   Signature failures do not reject the payload, so sender.pub_key is unauthenticated.

## Impact
Integrity LOW: fabricated bot-attributed messages (fake payment/boost notices, fake bot answers, replies threaded under real messages, arbitrary alias and avatar) are inserted into the victim's tribe chat history as confirmed rows and shown to the client; only the victim's own relay state is affected and no payment, key or role is changed. Confidentiality NONE: nothing is returned to the attacker. Availability NONE on this branch.

## Reproduction steps
1. Attacker is any Lightning node able to route a keysend to the victim (Sphinx relays require accept-keysend) or any client on the tribe MQTT broker publishing to <victim pubkey>/#. They need the victim's pubkey and the uuid of a tribe the victim belongs to; tribe uuids are listed publicly and the attacker can send one payload per candidate tribe since receiveBotRes silently drops uuids the victim does not hold. No signature validity, membership, bot installation or owner-origin check is applied on the member branch; the message is stored and pushed to the client with no user interaction.

## Recommended fix
The member-side bot_res branch of receiveBotRes stores and displays the payload without authenticating its origin as the tribe owner, and parseAndVerifyPayload discards the signature result upstream. Fix criteria: A bot_res for a chat the owner does not own is stored only when the payload signature verifies for sender.pub_key and that pubkey equals chat.ownerPubkey (and, for tribes, the payload arrived on the tribe MQTT path); unverified or mismatched bot_res payloads are dropped and logged. Verify: a keysend or MQTT bot_res from an arbitrary node naming a tribe the victim is a member of creates no Message row and emits no socket event.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing authentication
**CWE:** [CWE-306](https://cwe.mitre.org/data/definitions/306.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257991

---

# Avatar upload builds multer filename from request fields, allowing path traversal file write

## Details
`POST /upload` (src/controllers/uploads.ts:10-28, registered at src/controllers/index.ts:72 as `avatarUpload.single('file')` before `uploadFile`) stores the uploaded part with multer `diskStorage`. The `filename` callback returns `chat_${req.body.chat_id}_picture.${ext}` when `chat_id` is truthy, else `${req.body.contact_id}_profile_picture.${ext}`, where `chat_id`/`contact_id` are multipart text fields the client sends ahead of the file part and `ext` is the last `/`-separated component of the client-declared part `Content-Type`. Nothing validates, normalises or allowlists any of them, and no post-join containment check exists. Assumption (multer, manifest ^1.4.2, lock 1.4.4; the Dockerfile deletes package-lock so the image gets the latest 1.4.x): `diskStorage` populates `req.body` from preceding fields and writes to `path.join(destination, filename)` without sanitising `filename`, as its documentation states ("you are responsible for" the filename). `path.join` normalises `..` lexically, so `contact_id=../../dist/src/x` yields `/relay/dist/src/x_profile_picture.<ext>` and `chat_id=/../../../creds/x` yields `/relay/creds/x_picture.<ext>`, with the full uploaded body as content, written as the relay process user. The forced suffix (`_picture.<ext>` / `_profile_picture.<ext>`) means existing files can only be clobbered if their names match that pattern (notably other tenants' avatar files, whose names `chat_<id>_picture.<ext>` are fixed and guessable, no traversal needed), but directory, basename prefix, extension (any string without `/`) and content are attacker-chosen for new files.

Deployment facts from the repository: `__dirname` of the compiled module is `/relay/dist/src/controllers`, so the destination resolves to `/relay/public/uploads` (present in the image via `public/uploads/.gitkeep`); the Dockerfile runs `chown -R 1000:1000 /relay` and `USER 1000`, so the relay user can write anywhere under `/relay` (dist/, config/, creds/, .lnd/, public/), and Dockerfile.swarm runs as root. `express.static('public')` at `/static` (app.ts:133) serves whatever is written under `public/`, so an `.html`/`.js` file planted there is served from the relay origin to any unauthenticated visitor. `/upload` is not in `no_auth` (src/auth.ts:122-145), so the caller needs an owner token; the HMAC middleware (src/auth.ts:70-105) is opt-in and passes requests that omit `x-hmac` ("FIXME optional sig for now"), so it is not a control on this path.

This crosses the boundary the threat model draws: the owner is trusted with funds and data, not with the host filesystem, and in proxy/hosting mode any one tenant gains a file-write primitive over the shared relay's tree and over other tenants' avatars. Root cause: untrusted request fields embedded in a filesystem path (CWE-22) with no normalisation, allowlist (numeric-only ids, image-extension allowlist) or containment check after joining.

## Evidence
1. [src/controllers/uploads.ts:17–27](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/uploads.ts#L17-L27)
   The multer diskStorage filename callback interpolates req.body.chat_id or req.body.contact_id (multipart text fields the client sends before the file part) and a mimetype-derived extension directly into the stored filename with no validation; `../` in either id moves the write out of public/uploads because multer joins destination and filename with path.join, which normalises the traversal lexically.
2. [src/controllers/uploads.ts:10–15](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/uploads.ts#L10-L15)
   Destination is a fixed directory, but multer joins destination and the attacker-influenced filename, so the destination does not bound the write.
3. [src/controllers/index.ts:72](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L72)
   POST /upload is registered with avatarUpload.single('file') before uploadFile, so the file is written to disk before any handler logic runs.
4. [src/auth.ts:122–144](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L122-L144)
   /upload is not in no_auth, so the caller must hold an owner (tenant) token; in proxy/hosting mode any tenant of the shared relay reaches this handler.
5. [app.ts:133](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L133)
   express.static('public') serves public/ at /static, so files written under public/ (including other tenants' avatars) are also publicly readable.

## Impact
Arbitrary-content file creation in any directory writable by the relay user (the whole /relay tree in the shipped image, anywhere when run as root), with attacker-chosen directory, name prefix and extension but a forced `_picture.<ext>`/`_profile_picture.<ext>` suffix; overwrite of other tenants' avatar files by fixed name; attacker HTML/JS served from the relay origin via /static. Host-integrity impact beyond the caller's own data. Disk filling and clobbering avatar files give limited availability impact; no read primitive.

## Reproduction steps
1. Attacker holds an owner token for the relay (its own Sphinx credentials; in proxy/HOSTING_PROVIDER deployments any one of many co-tenants). One multipart POST /upload with a chat_id or contact_id text field containing `../` segments placed before a file part with a chosen Content-Type and body; multer writes the file before uploadFile runs, the HMAC middleware passes requests without x-hmac, and the uploads directory exists in the image. Deterministic, no control to bypass.

## Recommended fix
1. Client-supplied chat_id/contact_id and mimetype are interpolated into the on-disk filename without validation, so the path can escape the uploads directory. Fix criteria: Stored filenames must be derived only from validated values (e.g. integer ids parsed and re-serialised, extension from an allowlist of image types) or from a server-generated random name, and the resolved path must be verified to lie inside the uploads directory before writing. Verify that a chat_id containing `../` is rejected and no file appears outside public/uploads.
2. Ids used in the filename are not checked to belong to the requesting tenant, so avatar files of other tenants can be overwritten by name. Fix criteria: Only chats/contacts owned by req.owner may have their avatar file written; verify a tenant cannot overwrite another tenant's chat_<id>_picture file.

---
**Severity:** HIGH
**Status:** Open
**Category:** Path Traversal
**CWE:** [CWE-22](https://cwe.mitre.org/data/definitions/22.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257990

---

# bot_install/bot_cmd from any peer registers BotMember rows, bypasses price and redirects bot responses

## Details
On the bot maker's relay, `receiveBotInstall` and `receiveBotCmd` (src/controllers/bots.ts:342-447) are reached for any `bot_install`/`bot_cmd` payload a Lightning node keysends to the maker (receive.ts:632-727 → onReceive 121-130, which checks only that `bot_uuid` is present). `parseAndVerifyPayload` (receive.ts:561-591) returns the payload when the signature is absent or invalid ('=> RM THIS'), so `sender.pub_key`, `sender.id`, `sender.role` and `chat.uuid` are whatever the attacker wrote. Bot uuids and the maker's pubkey are public: `createBot` posts them to the tribe server via `declare_bot` (bots.ts:72-84, tribeBots.ts:45-60).

1. `receiveBotInstall` validates only that `bot_uuid` was signed by the local owner (`verifySignedTimestamp`, 362-363) — true for every bot the owner created — and then creates `BotMember {botId, memberPubkey: sender_pub_key, tribeUuid: chat_uuid}` (364-372) for whatever pubkey and tribe uuid the sender claims, before the Contact check at 375-383 and with no uniqueness or tribe-ownership check. Any Lightning node can therefore register itself as installer of any of the maker's bots for any tribe uuid (real or invented). The only other write path is `BotMember.destroy` on account deletion (details.ts:232); nothing ever reconciles rows.

2. `receiveBotCmd` has the price check commented out (`// const amount = dat.message.amount - check price_per_use`, 411) and requires only that a BotMember row exists for (bot, chat_uuid) and that `sender.pub_key` matches a Contact of the maker (432-440). Because the signature is not enforced, the attacker satisfies the Contact gate by claiming the maker's own pubkey (published by `declare_bot`): the owner's Contact row carries `tenant` equal to its own id (setup.ts:66-71, contacts.ts:193, proxy.ts:121) and so matches `Contact.findOne({tenant, publicKey})`. The command is forwarded to the bot webhook (`postToBotServer`, 457-492) with `member.id = sender.id` from the wire (443, 520) and `roles: [Admin]` whenever the wire says `sender.role === owner` (526-532), so the attacker can impersonate the tribe admin toward the bot. The honest path pays `max(amount, pricePerUse)` (`keysendBotCmd`, 241-254, called from intercept.ts:155-156) and installs with a `pricePerUse` keysend (`keysendBotInstall`, 213-227); the maker's receive side collects neither.

3. `finalAction`'s bot-maker branch (src/controllers/botapi/index.ts:257-307) resolves the destination of every bot response with `BotMember.findOne({tribeUuid, botId, tenant})` — no ORDER BY, first row wins — and sends the signed `bot_res` to `botMember.memberPubkey`. For a (bot, uuid) pair the attacker planted, the bot's reply to the attacker's unpaid command is delivered to the attacker's node, completing free use of a priced bot. For a real tribe, a row planted before the legitimate owner's install is returned first under the default SQLite dialect (config/config.json; Sequelize ^5.19.3 emits LIMIT 1 without ORDER BY and SQLite's table scan returns rowid order — stated as an assumption), hijacking every response the bot produces for that tribe to the attacker; alternatively the attacker sends `bot_cmd` against the legitimate row of a tribe it is not a member of, and the bot's reply is delivered to that tribe's owner, who forwards it into the tribe via `receiveBotRes`, letting a non-member post through the bot without paying the tribe's or the bot's price.

## Evidence
1. [src/controllers/bots.ts:342–388](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L342-L388)
   receiveBotInstall: verifySignedTimestamp(bot_uuid) only proves the bot belongs to the local owner (true for every bot the owner created); BotMember is created (364-372) with memberPubkey and tribeUuid copied from the unauthenticated payload, before the Contact check and with no tribe-ownership or uniqueness check.
2. [src/controllers/bots.ts:401–447](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L401-L447)
   receiveBotCmd: price_per_use check commented out (411); gates are only a BotMember row for (bot, chat_uuid) and a Contact match on the claimed sender.pub_key; dat.sender.id is taken from the wire (443) and forwarded to the bot webhook.
3. [src/network/receive.ts:561–591](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L561-L591)
   parseAndVerifyPayload returns the payload when the signature is missing, malformed or invalid ('=> RM THIS'), so sender.pub_key, sender.id and sender.role are attacker-claimed; the attacker can claim the maker's own pubkey to pass the Contact gate.
4. [src/network/receive.ts:121–130](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L121-L130)
   onReceive dispatches bot_install/bot_cmd straight to ACTIONS[type] with only a bot_uuid presence check, before any membership, price or sender validation; payload.owner is set to the local owner.
5. [src/controllers/botapi/index.ts:257–307](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L257-L307)
   Bot-maker branch of finalAction routes every bot response to the memberPubkey of the first BotMember row found for (tribeUuid, botId, tenant) with no ORDER BY, so a planted row receives the bot's output.
6. [src/controllers/bots.ts:500–534](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L500-L534)
   buildBotPayload forwards sender.id as member.id and grants the Admin role whenever the wire payload says sender.role === owner, so an unauthenticated peer impersonates the tribe admin toward the bot.
7. [src/controllers/bots.ts:241–254](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L241-L254)
   Honest path: keysendBotCmd (called from intercept.ts:155-156) pays max(amount, pricePerUse) to the maker, establishing that the per-use fee is the designed control the receive side fails to enforce.
8. [src/utils/setup.ts:66–71](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/setup.ts#L66-L71)
   The owner's own Contact row is created with tenant equal to its id, so Contact.findOne({tenant, publicKey: <maker pubkey>}) in receiveBotInstall/receiveBotCmd succeeds for an attacker claiming the maker's public pubkey.

## Impact
Integrity LOW: forged BotMember installer rows for any tribe uuid; priced bot commands executed without the per-use fee the honest keysendBotCmd path pays; attacker-chosen member id and Admin role presented to the bot; content posted into a tribe through the bot by a non-member. Confidentiality LOW: bot responses (including output of paid commands) for a tribe routed to the attacker's node when its planted row is returned first. No availability impact.

## Reproduction steps
1. Attacker is any Lightning node able to keysend to the bot maker's pubkey (threat-model adversary 2). Required knowledge — bot uuid and maker pubkey — is published to the tribe server by declare_bot. The Contact gate in receiveBotCmd is passed by claiming the maker's own pubkey, since signatures are not enforced (receive.ts:578-589) and the owner Contact row has tenant = own id. No deployment precondition, no race for the free-use path, no user interaction.

## Recommended fix
1. parseAndVerifyPayload accepts payloads whose signature is missing or invalid, so sender.pub_key, sender.id and sender.role are unauthenticated on every bot path. Fix criteria: A bot_install/bot_cmd payload is processed only when the signature verifies for sender.pub_key; sender.id and sender.role are derived from the relay's own records for that pubkey, not copied from the wire. Verify: an unsigned or mis-signed bot_cmd claiming the maker's pubkey is dropped before any lookup.
2. receiveBotInstall records an installer without verifying the sender owns the claimed tribe and without enforcing one installer per (bot, tribe). Fix criteria: A BotMember is created only when the verified sender pubkey is the owner of chat_uuid (e.g. via the tribe server's owner_pubkey) and no row exists for that (bot, tribe), or an existing row is replaced only by the verified owner. Verify: a bot_install from a non-owner node creates no row.
3. receiveBotCmd does not enforce pricePerUse or bind the command to the registered installer. Fix criteria: Commands are forwarded only when the received sat value (dat.message.amount, set from the invoice) is at least the bot's pricePerUse and the verified sender is the BotMember's memberPubkey. Verify: a 1-sat bot_cmd for a priced bot, or one from a pubkey other than the installer, is not posted to the webhook.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing authentication
**CWE:** [CWE-306](https://cwe.mitre.org/data/definitions/306.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257989

---

# joinTribe host parameter makes relay send owner's signed token to attacker MQTT broker and trust its traffic

## Details
POST /tribe (joinTribe → doJoinTribe, src/controllers/chatTribes.ts:44-181; registered at src/controllers/index.ts:234 behind owner auth) takes `host` from the request body. The Sphinx client fills it from the tribe join link/QR, and group_invite/group_join payloads also carry the tribe owner's `chat.host` (src/network/send.ts:439, chats.ts:724/815), so the tribe owner or anyone who publishes a join link chooses the value. After the group_join keysend to the body-supplied owner_pubkey succeeds (the attacker's own node), the chat is stored with host=body.host and tribes.addExtraHost(owner, host, network.receiveMqttMessage) runs (chatTribes.ts:178).

addExtraHost (src/utils/tribes.ts:313-324) only skips the configured default host and an already-cached client; it then calls lazyClient → initializeClient, which mints a fresh node-signed timestamp with genSignedTimestamp (730-766) and uses it as the MQTT password, with the owner pubkey as username, in mqtt.connect(mqttURL(host)) (112-127). mqttURL (326-341) honours the per-chat host whenever config.mqtt_host is unset, which is the shipped state (config/app.json has no mqtt_host; only an MQTT_HOST env override exists). On connect the client subscribes `${ownerPubkey}/#` (specialSubscribe, 248-255) and hands every published message to receiveMqttMessage (175-181). publish() (257-273) only ever targets getHost(), so the extra-host connection serves no outbound purpose: its sole effect is to make the attacker-chosen broker a trusted inbound transport. On 'close' the while(true) loop (192-198) re-signs and reconnects every 5-13 s, so the channel persists (and, for an unreachable host, the loop runs forever).

receiveMqttMessage (src/network/receive.ts:516-533) takes dest from the topic prefix, tags the payload network_type=mqtt and calls onReceive. Nothing distinguishes an extra host's traffic from tribes.sphinx.chat's, nothing restricts it to the chat uuid stored with that host, parseAndVerifyPayload (562-592) returns the payload even when the signature fails (verified record inbound-payload-signature-verification-result-ignored), and unlike the Lightning path (720-723) the MQTT path never overwrites payload.message.amount with a settled value.

Consequences for the victim who taps Join:
1. Inbound channel hijack (primary). The attacker's broker can publish payloads claiming any sender.pub_key into any chat uuid the victim has - spoofed DMs/tribe posts, group_join/leave/kick, member approvals, bot_res - without paying a keysend or needing a Lightning route, and with a claimed amount that the owner-side gates trust (pricePerMessage/priceToJoin checks, escrow timers, heartbeat repayment and forwarding: verified records mqtt-heartbeat-unverified-amount-keysend-drain and mqtt-inbound-claimed-amount-drives-tribe-owner-forwarding). This grants the threat model's adversary 3 position (the MQTT broker) to any join-link publisher without compromising the real tribe server.
2. Credential disclosure (secondary). Presenting the signed timestamp to the joined host is how the tribe protocol authenticates members, but the token (sign_owner(unix_ts)) carries no audience or host binding and is the same `?token=` credential the relay uses for owner-only operations on the default tribe server (edit 528-531, delete_tribe 573-577, putstats 644-647, updateRemoteTribeServer 905-908) and the people/boltwall servers (src/utils/people.ts 43-46, 77-80, 125-129); the relay's own verifier (768-778) never checks the timestamp. Assumption: tribes.sphinx.chat / people.sphinx.chat (separate repositories) accept the token for some freshness window, during which the attacker can replay it.
3. Resource waste. Each join naming a distinct unreachable host leaves a never-resolving loop that calls LND signMessage and opens a TLS connection every 5-13 s until restart.

The verified record profile-host-param-leaks-signed-node-token covers the same token leaking through the JWT-scoped /profile endpoint; this finding is a different entry point (POST /tribe body host), a different sink (mqtt.connect password plus the inbound subscription) and adds the trusted-inbound-channel consequence.

## Evidence
1. [src/utils/tribes.ts:313–324](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L313-L324)
   addExtraHost accepts any host string; the only checks are 'not the configured default host' and 'no cached client yet'. It then calls lazyClient(contact, host, onMessage) with the relay's inbound MQTT handler attached.
2. [src/utils/tribes.ts:103–127](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L103-L127)
   initializeClient mints a fresh node-signed timestamp (genSignedTimestamp) and uses it as the MQTT password, with the owner's pubkey as username, in mqtt.connect() to mqttURL(host) - i.e. to whatever host the caller named.
3. [src/utils/tribes.ts:326–340](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L326-L340)
   mqttURL only overrides the host when config.mqtt_host is set; the shipped config/app.json sets no mqtt_host, so the per-chat host is used verbatim (port forced to 8883/tribes_mqtt_port, tls unless tribes_insecure).
4. [src/utils/tribes.ts:148–182](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L148-L182)
   After connecting to the attacker broker the client subscribes `${pubkey}/#` (specialSubscribe, 248-255) and every message the broker publishes is handed to onMessage = network.receiveMqttMessage. Nothing distinguishes traffic from an extra host from traffic from the real tribe server.
5. [src/controllers/chatTribes.ts:44–56](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L44-L56)
   doJoinTribe takes `host` (and owner_pubkey, uuid, group_key) straight from the POST /tribe body; no comparison against config.tribes_host or any allow-list.
6. [src/controllers/chatTribes.ts:172–180](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L172-L180)
   Once the group_join keysend to the body-supplied owner_pubkey succeeds, the chat is stored with host=body.host and tribes.addExtraHost(theOwner, host, network.receiveMqttMessage) is invoked.
7. [src/utils/tribes.ts:730–765](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L730-L765)
   genSignedTimestamp produces sign_owner(unix_ts) with no audience, purpose or host binding. The identical token format is what the relay presents as `?token=` for privileged tribe-server operations (edit 528-531, delete_tribe 573-577, putstats 644-647, updateRemoteTribeServer 905-908) and to the people/boltwall servers (src/utils/people.ts 43-46, 77-80, 125-129).
8. [src/utils/tribes.ts:768–777](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L768-L777)
   The relay's own verifier of this token format checks only the signature and never the timestamp, which shows the ecosystem treats these tokens as long-lived proofs of key ownership; a captured token is therefore replayable.
9. [src/network/receive.ts:516–532](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L516-L532)
   receiveMqttMessage takes dest from the topic prefix (the owner pubkey the attacker broker chose to publish under) and passes the parsed payload to onReceive; the broker is implicitly trusted as a legitimate transport.
10. [src/network/receive.ts:562–591](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L562-L591)
   parseAndVerifyPayload returns the payload even when the signature is invalid ('RM THIS'), so an attacker broker can publish payloads with any sender.pub_key; this is what turns the rogue broker into a full spoofing channel (recorded separately as lead e4-sig-bypass).
11. [src/utils/tribes.ts:192–198](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L192-L198)
   If the extra host never accepts the connection, the while(true) loop re-signs with LND and reconnects every 5-13 s forever; every joinTribe naming a distinct unreachable host adds another eternal loop.
12. [config/app.json:34–57](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/config/app.json#L34-L57)
   Shipped production config: tribes_host set, no mqtt_host, no tribes_insecure - the defaults under which the per-chat host is honoured over TLS.

## Impact
Integrity HIGH: the attacker's broker becomes a trusted inbound transport into the victim's relay; combined with the unenforced payload signature and the un-overwritten MQTT amount it can inject messages and control events as any contact into any chat and drive owner-paid keysends (escrow refunds, heartbeat repayment, forwarding). Confidentiality LOW: a node-signed bearer token is disclosed; disclosure to the joined host is protocol design, the exposure is its replayability elsewhere. Availability LOW: an eternal re-sign/reconnect loop per bogus host. Subsequent-system impact: The captured token is the credential the default tribe server and people server accept for owner-only operations (edit/delete tribes, change preview/feed URLs, declare bots, edit/delete profile, /withdraw). Rated LOW because replay depends on those external servers' freshness window, which this repository does not fix and which could not be verified in the checkout.

## Reproduction steps
1. Attacker runs a Lightning node and a TLS MQTT broker (a valid certificate for a host they own is trivial), and publishes a tribe join link/QR or group invite whose host field names that broker; the client's tribe lookup is served by the attacker's host. The victim taps Join; the client POSTs /tribe with host=attacker. The relay keysends group_join to the attacker node (succeeds), stores the chat and connects to tls://attacker:8883 with pubkey + node-signed timestamp. The attacker captures the token and publishes on <victimPubkey>/#. No credentials on the victim relay are needed; the shipped configuration (no mqtt_host) suffices; the only interaction is the victim joining a tribe.

## Recommended fix
1. addExtraHost/initializeClient connect to a host taken from the client request body and present the owner's node-signed credential to it, with no allow-list or trust decision about the host. Fix criteria: The relay only authenticates to MQTT hosts it is configured to trust (config.tribes_host/mqtt_host or an explicit allow-list); a POST /tribe naming any other host must not cause an outbound authenticated MQTT connection. Verify by joining with host=<attacker>: no connection attempt or credential is sent.
2. genSignedTimestamp tokens are unbound bearer credentials: the same signature format authenticates to every tribe/people/boltwall endpoint and as MQTT password, so disclosure to one party is replayable against all. Fix criteria: Tokens presented to a host are bound to that host/purpose (e.g. the signed message includes the destination host and a short validity) so a token captured by one host is rejected by another. Verify by replaying an MQTT password as ?token= against the tribe server: it must be rejected.
3. Messages arriving from an extra-host broker are processed identically to the configured tribe server's, and inbound payload signatures are not enforced (receive.ts:586-589). Fix criteria: Inbound MQTT payloads are accepted only when the sender signature verifies and, for extra hosts, only for the chats stored with that host. Verify that a payload with an invalid signature published on <pubkey>/<uuid> from a non-default broker is dropped.

---
**Severity:** HIGH
**Status:** Open
**Category:** Origin validation error
**CWE:** [CWE-346](https://cwe.mitre.org/data/definitions/346.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257988

---

# Paid-media price taken from buyer-supplied unsigned LDAT meta, enabling purchase for 1 sat

## Details
The Sphinx relay sells attachments by sending recipients a media token (LDAT) whose meta segment carries `amt` (price) and `ttl`. For paid media the token sent to recipients is deliberately unsigned (`skipSigning` in src/utils/msg.ts finishTermsAndReceipt yields `host.muid...meta` with empty pubkey/exp and no signature), and `parseLDAT` (src/utils/ldat.ts) never verifies LDAT signatures in any case.

When a `purchase` keysend arrives, `receivePurchase` (src/controllers/media.ts:354-370) takes the `mediaToken` from the peer's payload and decides the price with `terms.meta.amt` from that very token; the meme-server `getMediaInfo` fallback is only consulted when amt or ttl is falsy. The intended cross-check `Message.findOne({ where: { mediaToken, tenant } })` is a tautology: lines 300-313 have just inserted the purchase message with the same `mediaToken`. The `MediaKey` lookup only requires that the seller once shared that muid with this contact (DM, receiver=sender.id) or the tribe (receiver=0), which saveMediaKeys does for every paid attachment. The keysend amount is the true LND value (receive.ts:723), but the price it is compared against is attacker-authored.

Attack (DM): contact B received a paid attachment (price 1000 sats) from A with muid M. B takes the received token, replaces the meta segment with base64(`amt=1&ttl=1`) (both truthy, so the fallback is skipped), and sends a `purchase` keysend of >=1 sat (the relay's own minimum is config min_sat, 3). A's relay computes price=1, accepts, signs a fresh LDAT for B's pubkey and returns `mediaKey.key` (the media key encrypted for B) in `purchase_accept`. B decrypts the media having paid a few sats.

Tribes: the tribe owner's relay routes purchases of its own paid attachments to `receivePurchase` (receive.ts:320-341), so any member can buy the owner's paid media at the forged price. For other members' attachments, `purchaseFromOriginalSender` (modify.ts:79-81) performs the same forged-meta comparison; once an item has been legitimately purchased once (a MediaKey with originalMuid exists), the already-purchased branch (modify.ts:83-123) has no token match and releases the key to any member for the minimum keysend. The first-purchase branch (modify.ts:125-128) requires an exact token match and is not exposed.

Root cause: the price used for the authorization decision comes from unauthenticated peer input instead of the seller's own stored attachment record, and the existence check meant to tie the token to a stored record matches the just-created purchase row.

## Evidence
1. [src/controllers/media.ts:354–369](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/media.ts#L354-L369)
   receivePurchase parses the mediaToken that arrived in the peer's purchase payload (parseLDAT performs no signature check) and uses terms.meta.amt as the price and terms.meta.ttl as the TTL; the meme-server fallback runs only when either is falsy, so a buyer whose meta reads amt=1&ttl=1 fixes price=1. `if (amount < price)` then passes for any keysend of >=1 sat (amount is the true LND value bound at receive.ts:723).
2. [src/controllers/media.ts:300–351](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/media.ts#L300-L351)
   The purchase row carrying the attacker's exact mediaToken is inserted at 300-313, so `Message.findOne({ where: { mediaToken, tenant } })` at 336-338 always succeeds and never ties the token to the seller's stored attachment. The MediaKey lookup (344-350) only requires that the owner once shared this muid with the sender (receiver=sender.id) or with the tribe (receiver=0), which saveMediaKeys does for every paid attachment.
3. [src/controllers/media.ts:403–444](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/media.ts#L403-L444)
   After the forged price check passes, the seller signs a fresh LDAT for the buyer's pubkey and sends purchase_accept carrying mediaKey.key (the media key RSA-encrypted for that buyer), granting full access to the paid media.
4. [src/utils/msg.ts:108–122](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/msg.ts#L108-L122)
   finishTermsAndReceipt builds the token recipients receive for paid media: skipSigning makes pubkey '' and ttl 0 so tokenFromTerms returns the five unsigned segments, with meta = {amt, ttl}. The buyer therefore holds a template whose meta segment is plain base64 of a query string and is the only input the price decision reads.
5. [src/utils/ldat.ts:125–131](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/ldat.ts#L125-L131)
   parseLDAT splits on '.' and base64-decodes each segment; the sig segment, when present, is decoded but never verified against anything, so a rewritten meta segment is accepted as authoritative.
6. [src/network/receive.ts:320–340](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L320-L340)
   On a tribe owner's relay, a purchase whose host.muid prefix matches one of the owner's own attachments is routed to receivePurchase (doAction stays true), so any tribe member can buy the owner's paid tribe attachments at the forged price. Purchases of other members' attachments go to purchaseFromOriginalSender.
7. [src/network/modify.ts:75–127](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/modify.ts#L75-L127)
   purchaseFromOriginalSender takes price from terms.meta.amt of the purchaser's token (79-81). In the already-purchased branch (83-123, MediaKey with originalMuid exists) there is no token match, so a forged amt releases mediaKey.key to the purchaser for the minimum keysend. The first-purchase branch (125-128) requires an exact mediaToken match against the stored attachment, which a rewritten meta segment fails; it is not exposed.
8. [src/controllers/media.ts:87–95](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/media.ts#L87-L95)
   The seller's genuine price is recorded in its own attachment Message token (meta {amt, ttl}) created here; it is never consulted when a purchase arrives.

## Impact
The media key, a secret the relay withholds precisely until the price is paid, is disclosed for any paid item the attacker has been offered (every paid item in a tribe for a member), together with a freshly node-signed access token: a full confidentiality loss of the protected asset at the attacker's choosing. Integrity impact is limited to the relay recording purchase_accept rows and signing a token asserting payment at the forged amount; availability is unaffected.

## Reproduction steps
1. Attacker is any Lightning node that is a contact (or tribe member) to whom the victim has sent a paid attachment, i.e. the normal buyer position, which is a low privilege the victim grants to every recipient. They copy the received token, rewrite its meta segment (plain base64 of a query string) to amt=1&ttl=1, and send a `purchase` keysend of >=1 sat with that token. No signature is checked, the stored-record check is a tautology, and the behaviour is deterministic.

## Recommended fix
1. receivePurchase and purchaseFromOriginalSender derive the price (and TTL) from meta embedded in the token supplied by the buyer, which is neither signed nor compared with the seller's stored record. Fix criteria: The price used to accept or deny a purchase must come from the seller's own stored attachment record (or MediaKey row) for the muid, never from the buyer's token; a purchase whose keysend amount is below that stored price must be denied regardless of what the submitted token claims. Verify by sending a purchase with a token whose meta says amt=1 for a 1000-sat item and confirming purchase_deny, both in a DM and for the tribe owner's own and already-purchased tribe attachments.
2. The `Message.findOne({ mediaToken })` existence check matches the purchase row created moments earlier, so it never ties the token to a real attachment. Fix criteria: Look up the original attachment by muid with type=attachment and sender=owner (and, for DMs, in the same chat) before creating the purchase row, and reject when none exists; a purchase for a muid the owner never sent must not reach the key-release path.

---
**Severity:** HIGH
**Status:** Open
**Category:** Reliance on untrusted input in security decision
**CWE:** [CWE-807](https://cwe.mitre.org/data/definitions/807.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257984

---

# Unsigned peer payload lets any Lightning node replace a contact's RSA contact key

## Details
receiveContactKey and receiveConfirmContactKey (src/controllers/contacts.ts:556-668) take payload.sender.pub_key as the identity of the remote peer, look up the tenant's confirmed contact with that publicKey and overwrite its contactKey (the RSA public key all end-to-end encryption to that contact is done with), alias and photoUrl with the values in the payload, then push the modified contact to the owner's app over the socket.

The identity is never authenticated. Payloads reach these handlers from grpc/subscribe.ts:35 (every SETTLED keysend) -> parseKeysendInvoice -> parseAndVerifyPayload -> onReceive -> doTheAction -> ACTIONS[type]. parseAndVerifyPayload (src/network/receive.ts:562-591) computes the signature check but returns the payload whether or not it is valid (`return payload // => RM THIS` in both the invalid branch and the catch branch), and a payload with no trailing signature at all (sig.length neither 96 nor 104) also passes. onReceive applies no further gate to a non-tribe type 10/11 payload (no chat uuid, not a bot type), and doTheAction dispatches straight to ACTIONS[10]/ACTIONS[11] (src/controllers/index.ts:256-257). The same handlers are reachable over MQTT via receiveMqttMessage (receive.ts:516-533), which uses the same parseAndVerifyPayload gate.

So any Lightning node able to keysend to the relay's node (adversary 2 in the threat model; the node is on the public network by design) can send a type contact_key or contact_key_confirmation TLV payload with sender.pub_key = <pubkey of any of the victim's contacts B> and sender.contact_key = <attacker-generated RSA public key>, costing a few sats, and the victim's relay will:
- store the attacker's RSA key as B's contactKey; from then on the app (which reads contact_key from contactToJson, src/utils/json.ts:37-43) and the relay itself (src/utils/msg.ts:64-74 encryptTribeBroadcast via personalizeMessage in send.ts:259, src/controllers/botapi/dm.ts:47, src/controllers/subscriptions.ts:158) encrypt content and media keys destined for B with the attacker's key. B can no longer decrypt anything the victim sends until keys are re-exchanged. Keysend TLV payloads are onion-wrapped, so a Lightning-only attacker does not see the resulting ciphertext; a party that both delivers payloads and carries the victim's outbound traffic — the tribe MQTT broker (adversary 3), over which a tribe owner's per-member re-encrypted broadcasts travel — can substitute every member's key and read the re-encrypted tribe content.
- replace B's alias and photoUrl with attacker-chosen values (impersonation of a trusted contact in the victim's UI; a contact can be renamed to look like another person).
- in receiveContactKey, also send a contact_key_confirmation keysend to the spoofed pubkey (recorded separately).

The tenant scoping (tenant: owner.id) is correct, and only confirmed contacts are matched, but neither is an authentication of the sender. The maintainers' intent (the comment 'VERIFY PUBKEY OF SENDER from sig') shows the signature was meant to gate this. The shipped build carries the same code (dist/src/controllers/contacts.js:534 and :585 assign contactKey from sender_contact_key; dist/src/network/receive.js:535/545 keep the `RM THIS` returns), and is what the Docker image (CMD node /relay/dist/app.js) and `npm run prod` execute.

This record covers the contact-key/identity overwrite sink in contacts.ts; the generic signature bypass in receive.ts is the shared root cause (recorded as inbound-payload-signature-verification-result-ignored) and affects other ACTIONS handlers as well.

## Evidence
1. [src/controllers/contacts.ts:556–618](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L556-L618)
   receiveContactKey trusts dat.sender.pub_key to select the contact and overwrites contactKey, alias and photoUrl from the payload.
2. [src/controllers/contacts.ts:621–667](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L621-L667)
   receiveConfirmContactKey does the same overwrite for the confirmation type.
3. [src/network/receive.ts:562–590](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L562-L590)
   parseAndVerifyPayload returns the payload even when the signature is invalid, absent or throws, so sender.pub_key is attacker-authored.
4. [src/network/receive.ts:709–726](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L709-L726)
   parseKeysendInvoice feeds any settled keysend TLV payload into onReceive.
5. [src/network/receive.ts:354–390](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L354-L390)
   onReceive/doTheAction dispatch to ACTIONS[payload.type] for non-tribe payloads with no further sender check.
6. [src/controllers/index.ts:256–258](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L256-L258)
   ACTIONS maps contact_key and contact_key_confirmation to the two handlers.
7. [src/utils/msg.ts:64–73](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/msg.ts#L64-L73)
   encryptTribeBroadcast, called per member from personalizeMessage (src/network/send.ts:259) on the tribe owner's relay, encrypts re-broadcast content and media keys with contact.contactKey, so the substituted key is used for relay-side encryption.
8. [src/controllers/botapi/dm.ts:47](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/dm.ts#L47)
   Bot DMs are encrypted with the stored contactKey.
9. [src/utils/json.ts:37–42](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/json.ts#L37-L42)
   contactToJson exposes contact_key to the client app, which encrypts DMs with it.

## Impact
Integrity HIGH: any confirmed contact's stored E2E RSA key, display name and photo can be rewritten by an unauthenticated peer, enabling impersonation in the owner's UI and key substitution for all future encryption to that contact. Confidentiality LOW: a Lightning-only attacker cannot observe the resulting ciphertext (keysend TLVs are onion-wrapped), so plaintext is recovered only by a party that also carries the victim's outbound traffic, such as the tribe MQTT broker (adversary 3) for a tribe owner's per-member re-encrypted broadcasts. Availability LOW: communication with the targeted contact is undecryptable by that contact until keys are re-exchanged.

## Reproduction steps
1. Attacker: any Lightning node (unauthenticated, PR NONE) that can route a 3-sat keysend to the victim's node, which is publicly reachable by design (AT NONE). The attacker needs the victim node pubkey and the pubkey of one of the victim's contacts (both public Lightning identities). One TLV payload, no signature required, deterministic.

## Recommended fix
1. Contact identity and key material are updated from payload.sender without the sender's identity being authenticated; receive.ts hands over payloads whose signature failed or is missing. Fix criteria: A contact_key / contact_key_confirmation payload must only update the contact whose publicKey verifiably signed it; verify that a payload with a missing or invalid signature (or a signature by a key other than sender.pub_key) leaves contactKey, alias and photoUrl unchanged and emits nothing to the app.
2. Key rotation for a contact is accepted silently with no owner-visible confirmation. Fix criteria: A change of an existing contact's contactKey should be surfaced to the user as a key change rather than applied silently; verify the app receives a distinguishable event when a non-empty contactKey is replaced.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper authentication
**CWE:** [CWE-287](https://cwe.mitre.org/data/definitions/287.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257983

---

# Peer-supplied invoice string hangs relay via infinite loop in bolt11 decoder

## Details
Any Lightning node can keysend this relay a TLV payload of type `invoice` (constants.message_types.invoice = 2). `parseKeysendInvoice` -> `onReceive` -> `doTheAction` dispatches it to `receiveInvoice`, which (after `parseReceiveParams` auto-creates a contact/chat for the unknown sender) calls `decodePaymentRequest(payload.message.invoice)` with the attacker-authored string, unguarded.

The decoder in src/utils/decode/decode.js is hand-rolled and not robust against malformed input:

1. Infinite loop (deterministic hang). `extractTags` reads a tag's data length as `bech32ToInt(str.substring(1,3))`. `bech32ToInt` uses `indexOf` on the bech32 charset, which returns -1 for any other character (e.g. 'b', 'i', 'o'), so a two-char length of `"bq"` evaluates to -32. The loop then does `str = str.substring(3 + (-32), str.length)` = `str.substring(0)` — the string is unchanged and `while (str.length > 0)` never terminates, pushing an object into `tags` every iteration. The Node event loop is blocked for the whole process (all tenants, all HTTP/socket/gRPC handling) until memory is exhausted and the process is killed. The only gate before this is `verify_checksum`, a deterministic BCH polymod; the final six 5-bit values enter it linearly, so the attacker computes the matching six-character checksum for whatever (non-charset-containing) data they choose, exactly like a normal bech32 checksum. The prefix only needs to be `lnbc` and the data long enough that `tagData = data.substring(7, len-104)` is non-empty.

2. Uncaught exceptions (process crash). If `verify_checksum` fails, `decode()` returns the string `'error'` and `decodePaymentRequest` dereferences `'error'.data.tags` (TypeError). A non-string `message.invoice` throws in `toLowerCase()`. A `d` (description) tag whose bytes are not valid UTF-8 throws URIError from `decodeURIComponent`. `receiveInvoice` is `async` and invoked by `doTheAction` with no await and no catch; app.ts registers no `unhandledRejection`/`uncaughtException` handler, and the shipped image runs Node 16 (Dockerfile `FROM node:16-buster-slim`) whose default is to terminate the process on an unhandled rejection.

In both cases one keysend of the minimum sat amount, costing the attacker a few sats, takes the relay down. Because `subscribeInvoices` is opened with `{}` (no add/settle index) the poisoned invoice is not replayed on restart, so a supervisor restart recovers, but the attacker can repeat indefinitely. The hang variant will not be noticed by a crash-restart supervisor at all until OOM.

The only other caller, `anonymousInvoice` in payInvoice, decodes an owner-supplied string that LND has already accepted and paid, so it is not an attack surface; the peer-facing `receiveInvoice` is.

## Evidence
1. [src/utils/decode/decode.js:117–130](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/decode/decode.js#L117-L130)
   extractTags computes dataLength from two bech32 chars via bech32ToInt; characters outside the charset yield indexOf()=-1, so dataLength can be negative (e.g. -32). str.substring(3 + dataLength) then clamps to substring(0) and str never shrinks: while (str.length > 0) loops forever, pushing a tag object each iteration.
2. [src/controllers/invoices.ts:290–317](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L290-L317)
   receiveInvoice takes payload.message.invoice straight from the inbound peer payload and passes it to decodePaymentRequest with no validation and no try/catch.
3. [src/utils/decode/index.ts:3–35](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/decode/index.ts#L3-L35)
   decodePaymentRequest calls decode() and then dereferences decodedPaymentRequest.data.tags; when decode() returns the string 'error' (bad checksum) this throws TypeError. Non-string input throws in toLowerCase; a description tag with invalid UTF-8 throws URIError in decodeURIComponent.
4. [src/utils/decode/decode.js:223–256](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/decode/decode.js#L223-L256)
   verify_checksum is a deterministic BCH polymod whose last six values enter linearly; an attacker can compute a passing 6-char checksum for arbitrary (even non-charset) data, so the hang path behind the checksum check is reachable.
5. [src/network/receive.ts:384–390](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L384-L390)
   doTheAction invokes ACTIONS[type](payload) without await or try/catch, so exceptions thrown by receiveInvoice become unhandled promise rejections.
6. [src/network/receive.ts:562–590](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L562-L590)
   parseAndVerifyPayload returns the payload even when the signature does not verify ('=> RM THIS'), so no valid signature or prior relationship is needed to reach the handler.
7. [src/helpers.ts:301–314](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L301-L314)
   For a conversation-type payload parseReceiveParams auto-creates a contact and chat for an unknown sender pubkey, so any Lightning node reaches receiveInvoice's decode call.

## Impact
The whole relay process (every tenant, every API, message receipt, scheduled payments) stops responding until the process is externally restarted or dies from memory growth; the exception variants crash it outright. No confidentiality or integrity effect.

## Reproduction steps
1. Attacker is any node on the Lightning network. They craft a bolt11-shaped string with a valid computed checksum whose first tag length field contains a non-bech32 character, place it in message.invoice of a type-2 payload in the sphinx TLV of a minimum-amount keysend to the relay's pubkey. No signature, contact relationship or configuration is required; the loop is deterministic.

## Recommended fix
1. extractTags trusts a parsed tag length that can be negative (or exceed the remaining string) and uses it to advance the cursor, so malformed input never makes progress. Fix criteria: Decoding any string must terminate in time bounded by input length: a non-charset character or a length that does not fit the remaining data must abort decoding with an error. Verify that the crafted invoice described returns an error promptly instead of hanging.
2. receiveInvoice passes attacker-controlled message.invoice to a decoder that can throw, with no validation or exception handling, inside an un-awaited async handler on a process with no unhandled-rejection handler. Fix criteria: Malformed or non-string invoice strings in inbound payloads must be rejected (logged and dropped) without throwing out of the handler; the process must not terminate on any peer-supplied invoice value. Verify with bad-checksum, non-string and invalid-UTF-8 description inputs.

---
**Severity:** HIGH
**Status:** Open
**Category:** Denial of service
**CWE:** [CWE-835](https://cwe.mitre.org/data/definitions/835.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257982

---

# Any node can add itself to a group chat by sending group_join with the chat uuid

## Details
group_join is the message a relay sends after accepting a group_invite. On the receiving side, receiveGroupJoin treats it as authoritative: it finds the chat by `payload.chat.uuid`, takes the sender's self-declared pubkey, alias and RSA contact key from the payload, and calls addMemberToTribe, which creates a Contact (fromGroup) with that key and appends the contact id to chat.contactIds. The only gate — price-to-join and private-tribe approval in receive.ts onReceive — runs exclusively when the receiving owner is the tribe owner. For ordinary group chats (chat_types.group), and on tribe members' relays, no authorization exists.

Consequences for a non-tribe group: any Lightning node that knows the group uuid (format `${ms-timestamp}-${md5(sorted member pubkeys)}`, known to every current and former member) can send one keysend of type group_join to each member and is thereafter a member on each of their relays. send.ts fans every subsequent group message out to chat.contactIds; the Sphinx client encrypts content per contact id using the contactKey the relay stores (addInRemoteText / remote_text_map), and that key is the one the attacker supplied. The attacker thus receives and can read all future messages and media keys of a group they were never invited to — or were explicitly kicked from. kickChatMember only edits the kicker's own relay and sends a group_kick notification; the kicked party simply re-joins. addMemberToTribe also overwrites an existing contact's contactKey with the payload value when the pubkey is already known, letting the attacker rotate the key the victim encrypts to at will.

For tribe members' relays the impact is limited to contact pollution and a forged group_join system message, since members send only to the tribe owner.

Root cause: receiveGroupJoin lacks any check that the joiner was invited (e.g. present in chat.contactIds or in a pending invite) and accepts a sender-supplied contact key for the chat.

## Evidence
1. [src/controllers/chats.ts:668–715](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L668-L715)
   receiveGroupJoin looks the chat up by the payload uuid and, for every chat type, calls addMemberToTribe with the payload's sender_pub_key and chat_members[sender_pub_key] (attacker-authored alias/RSA key). There is no check that the sender was invited, is listed in chat.contactIds, or that the owner is the tribe owner.
2. [src/controllers/chats.ts:581–635](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L581-L635)
   addMemberToTribe creates a Contact for an unknown pubkey with contactKey = member.key supplied by the sender, pushes its id into chat.contactIds and persists the chat. For an existing contact it even overwrites contactKey with the sender-supplied key.
3. [src/network/receive.ts:106–140](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L106-L140)
   doAction is initialised true (line 106). The only gating block for inbound group traffic (lines 137-319: sender membership, price-to-join, private-tribe approval) is entered solely when the receiving owner is the tribe owner of a chat_types.tribe chat; for chat_types.group (type 1) isTribeOwner stays false, the block is skipped and line 354 dispatches straight to ACTIONS[group_join] = receiveGroupJoin with no check of any kind.
4. [src/network/send.ts:113–115](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L113-L115)
   Outbound fan-out for a non-tribe chat is driven by chat.contactIds; every id the attacker inserted receives each subsequent message.
5. [src/utils/msg.ts:9–19](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/msg.ts#L9-L19)
   addInRemoteText selects message.content[contactId] — the client encrypts content per recipient contact using the contactKey stored on the relay, so the attacker-supplied key yields readable ciphertext for the attacker.
6. [src/controllers/chats.ts:84–123](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L84-L123)
   kickChatMember removes a member only on the kicker's relay and sends group_kick; nothing prevents the kicked party from re-sending group_join and being re-added, so the kick is not enforceable.

## Impact
After insertion the relay itself (send.ts:113-116, 215-280) keysends every subsequent group message and media key for that chat to the attacker's node, selecting content[attackerContactId] from the owner's remote_text_map. The attacker's contact (fromGroup, status 1, contactKey = attacker key) is returned by GET /contacts and /contacts/:chat_id, so the Sphinx client encrypts each recipient copy to the stored key — an assumption about the shipped client, but the relay-stored key is the client's only key source. Result: ongoing read access to a private group the attacker was excluded from (C:H). Integrity: unauthorised membership, forged group_join message, attacker-chosen contactKey for its own pubkey (I:L). No availability impact.

## Reproduction steps
1. Attacker is any Lightning node holding the group chat uuid (a kicked or departed member, or anyone a member leaked it to; the uuid is `${ms}-${md5(sorted pubkeys)}` and is carried in every group_create/group_invite payload). It sends one keysend per member node with a TLV payload {type:14, chat:{uuid, type:1, members:{attackerPubkey:{key:attackerRSA, alias}}}, sender:{pub_key:attackerPubkey}}. parseKeysendInvoice -> onReceive (no owner gating for type 1) -> receiveGroupJoin -> addMemberToTribe creates/updates the Contact with the attacker's key and appends it to chat.contactIds. No signature binding is enforced, no invite is consulted, no user action is needed. Knowledge of the uuid is the only precondition (AT:P).

## Recommended fix
receiveGroupJoin/addMemberToTribe admit any sender into any chat identified by uuid and accept a sender-supplied contact key, with no invitation or membership check outside the tribe-owner path. Fix criteria: A group_join must only be honoured when the sender is already an invited participant of that chat (e.g. its contact id is in chat.contactIds from the invite, or a pending invite record exists) and must be rejected for a contact that was kicked; a contact key change must come from a signed contact_key exchange, not from a group_join payload. Verify that an uninvited node's group_join leaves chat.contactIds unchanged and that a kicked member cannot re-add itself.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing Authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
**Attack vector:** NETWORK
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257981

---

# Tribe owner schedules escrow refund even when sender underpaid or is not a member

## Details
Sphinx tribes can require members to pay price_per_message plus an escrow_amount per post; the owner holds the escrow for escrow_millis and then refunds it (the 'repayment' keysend in timers.payBack). The refund is the owner's own sats leaving the node, so it must only be scheduled when the escrow was actually received.

In onReceive (src/network/receive.ts:174-190) the tribe owner's relay does this: if message.amount < chat.pricePerMessage it marks doAction=false, and then, in the same block and independent of doAction, calls timers.addTimer({amount: chat.escrowAmount, receiver: senderContactId, ...}) whenever chat.escrowAmount is non-zero, the sender resolves to a Contact and the message is not on the spam list. There is no check that amount >= pricePerMessage + escrowAmount, nor that the payment check passed, nor that the sender is a ChatMember (the membership check at 167-172 also only flips doAction). The payload's amount on the Lightning path is the true settled value (line 723), so the attacker controls exactly how much they pay.

Attack: any node first sends one ordinary DM-type keysend to the owner (parseReceiveParams creates a Contact for unknown conversation senders), then repeatedly keysends min_sat (default 3 sats) carrying {type:0, chat:{uuid:<tribe uuid>, type:2}, message:{...}} for any tribe the victim owns whose escrow_amount is non-zero (tribe listings on the tribe server expose uuid, price_per_message and escrow_amount). Each such message is rejected for insufficient payment (never forwarded or stored), yet escrow_millis later payBack keysends escrow_amount sats from the owner to the attacker. Net gain per message = escrow_amount - min_sat - fees, repeatable without bound until the owner's outbound liquidity is exhausted. The attacker does not need to be a tribe member and (because the signature is not enforced, see inbound-payload-signature-verification-result-ignored) does not even need their own pubkey to be the contact, but the attack works with a correctly signed payload too, so it is independent of the signature defect.

Even for honest members the check is wrong: paying exactly price_per_message (without the escrow) still earns an escrow refund, so the owner pays members to post. This is distinct from mqtt-heartbeat-unverified-amount-keysend-drain (different transport assumption and sink) and from the MQTT amount-trust record: here the value really paid is known to be insufficient and the refund is scheduled anyway.

## Evidence
1. [src/network/receive.ts:174–190](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L174-L190)
   For message/attachment/boost/direct_payment the tribe owner only sets doAction=false when payload.message.amount < chat.pricePerMessage (175-177), then independently of doAction, of the escrow component, and of membership calls timers.addTimer({amount: chat.escrowAmount, receiver: senderContactId, ...}) whenever chat.escrowAmount is non-zero, the sender has a Contact row and is not on the spam list (178-188). This is the code the fix must change.
2. [src/network/receive.ts:165–172](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L165-L172)
   The ChatMember membership check only flips doAction; a Contact who is not a tribe member still reaches the escrow timer block below.
3. [src/network/receive.ts:240–243](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L240-L243)
   The same function elsewhere treats the expected payment as pricePerMessage + escrowAmount (theAmtToForward subtracts both), confirming escrow is an amount the sender must pay in, not a bonus.
4. [src/network/receive.ts:314–318](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L314-L318)
   With doAction false the message is neither forwarded nor stored ('insufficient payment for this action'), yet the Timer created above remains armed.
5. [src/utils/timers.ts:31–54](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/timers.ts#L31-L54)
   addTimer persists the Timer row and arms setTimeout(payBack) for escrowMillis later; reloadTimers re-arms persisted rows after restart.
6. [src/utils/timers.ts:81–123](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/timers.ts#L81-L123)
   payBack calls network.sendMessage(type repayment, amount=t.amount, realSatsContactId=t.receiver, contactIds=[t.receiver]) with the tenant owner as sender.
7. [src/network/send.ts:253–280](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L253-L280)
   With isTribeOwner, amount and realSatsContactId===contactId, sendMessage clears mqttTopic/coTenantDest ('FORCE KEYSEND') and signAndSend falls through to LND.keysendMessage of Math.max(amount, min_sat): real sats leave the owner's node to the receiver.
8. [src/network/receive.ts:720–726](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L720-L726)
   On the Lightning path dat.message.amount is overwritten with the invoice's settled value, so the attacker pays exactly what they choose (e.g. min_sat, default 3 in src/utils/config.ts) and still gets escrowAmount back.
9. [src/helpers.ts:301–310](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L301-L310)
   parseReceiveParams, for any conversation-type payload, calls findOrCreateContactByPubkeyAndRouteHint for the claimed sender pubkey.
10. [src/helpers.ts:187–202](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L187-L202)
   An unknown sender pubkey gets a Contact row created unconditionally (priceToMeet only sets the unmet flag), satisfying the senderContactId precondition for the escrow timer without any tribe membership.
11. [src/tests/utils/msg/sendEscrowMsg.ts:40](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/tests/utils/msg/sendEscrowMsg.ts#L40)
   Context only: the maintainers' escrow test pays escrowAmount + pricePerMessage and expects the admin to hold both and return only escrowAmount, establishing the intended semantics the receive side fails to enforce.

## Impact
The owner's Lightning funds (the primary asset in the threat model) are paid out repeatedly to the attacker without any corresponding payment in; the loss is bounded only by outbound liquidity. No confidentiality impact; availability impact is the channel balance depletion, counted under integrity of funds.

## Reproduction steps
1. Attacker: any Lightning node. Step 1: one DM-type keysend to the victim to become a Contact. Step 2: look up a tribe the victim owns with escrow_amount > 0 (public tribe metadata). Step 3: loop keysends of min_sat with type 0 and that chat uuid. Each is dropped for underpayment but schedules a Timer; after escrow_millis the victim's node keysends escrow_amount to the attacker. Deterministic, no interaction; the only precondition is that the victim operates a tribe with a non-zero escrow amount, a per-tribe setting.

## Recommended fix
The escrow refund timer is armed regardless of whether the message passed the payment and membership checks, and the payment check itself ignores the escrow component. Fix criteria: A refund timer for escrowAmount is created only when the settled amount is at least pricePerMessage + escrowAmount, the sender is an approved ChatMember, and the message is actually accepted (doAction). Verify by sending an underpaid or non-member message to an escrow tribe and confirming no Timer row is created and no repayment keysend follows after escrow_millis.

---
**Severity:** HIGH
**Status:** Open
**Category:** Business logic error
**CWE:** [CWE-841](https://cwe.mitre.org/data/definitions/841.html)
**Attack vector:** NETWORK
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257980

---

# POST /action lets any bot secret pay, broadcast and DM in any local tribe, across tenants

## Details
`processAction` (src/controllers/botapi/index.ts:151-223) is mounted at POST /action (src/controllers/index.ts:156), which is in `no_auth` (src/auth.ts:129), so the only credential is knowledge of `bot_id` plus `bot.secret` (or an HMAC of the body under that secret). The handler copies `action`, `chat_uuid`, `amount`, `recipient_id`, `recipient_pubkey`, `pubkey`, `content`, ... from the body into an `Action` and calls `finalAction`.

`finalAction` (index.ts:241-254) looks the bot up by `id` with no tenant filter and, if `getTribeOwnersChatByUUID(chat_uuid)` (src/utils/tribes.ts:389-410, a raw query over all owners with no tenant filter) returns any tribe owned by any owner on this relay, discards the bot (`myBot = null`) and executes `pay` / `broadcast` / `dm` on that tribe. `validateAction` (index.ts:327-337) derives the acting owner from `theChat.tenant`, not from `bot.tenant`. The `ChatBot` table is never consulted, so nothing binds the authenticated bot to the target chat (installation) or to the chat's tenant.

Impact paths:
- Proxy / hosting-provider mode (several owners in one DB, threat-model adversary 5): a co-tenant creates a bot with POST /bot (src/controllers/bots.ts:54-88; any authenticated owner, webhook URL of their choice, random `id` and `secret`; the secret is also pushed to that webhook as `x-secret`, bots.ts:478-485). They then POST /action with `bot_secret`, `action: 'pay'`, the `chat_uuid` of another tenant's tribe (tribe uuids are public on the tribe server), `amount` of their choice and `recipient_id` / `recipient_pubkey` of a contact they control in that tribe (anyone can join a public tribe). `pay` (pay.ts:25-124) records the message under the victim tenant and calls `network.sendMessage` with the victim owner as sender and `realSatsContactId` = the recipient; `sendMessage` forces a keysend of `amount` to that contact (send.ts:253-257, 271) via `LND.keysendMessage(..., ownerPubkey)` (send.ts:360-363), which in proxy mode loads the victim's sub-LND (`loadProxyLightning(ownerPubkey)`, src/grpc/lightning.ts:134-136). The same request shape with `broadcast` forges bot messages into the victim's tribe, and with `dm` (dm.ts:19-61) sends a message in the victim owner's name to any of the victim's contacts. No amount cap or per-bot allowance exists.
- Single-tenant relays: the third-party host of a bot the owner created and installed in tribe A holds `bot_id`+`secret` and can run `pay`, `broadcast` and `dm` against any other tribe B the owner runs where the bot is not installed; the threat model concedes the bot authority only over the tribe it is installed in.

The `pay()`/`broadcast()`/`dm()` calls are not awaited, so the caller always receives success regardless of outcome; a `recipient_id` not in the chat is handled by `initiateReversal`/`reversePayment`, whose null-contact dereference is caught by the try/catch in `reversePayment` (send.ts:613-640), so no process crash results from that path.

## Evidence
1. [src/controllers/botapi/index.ts:241–254](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L241-L254)
   finalAction: Bot looked up by id without tenant; if getTribeOwnersChatByUUID finds any locally-owned tribe for chat_uuid, myBot is nulled and the action runs on that tribe. ChatBot (installation) and bot.tenant are never checked — the fix belongs here.
2. [src/controllers/botapi/index.ts:327–337](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L327-L337)
   validateAction derives the acting owner from theChat.tenant, not from the bot's tenant, so the action executes as whichever owner runs the tribe named by chat_uuid.
3. [src/controllers/botapi/index.ts:151–223](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L151-L223)
   processAction: entry at POST /action; authenticates only bot_id + bot.secret (string compare) or HMAC under that secret, then forwards body-controlled chat_uuid, amount, recipient_id/recipient_pubkey, pubkey and content to finalAction.
4. [src/utils/tribes.ts:389–410](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L389-L410)
   getTribeOwnersChatByUUID returns the tribe of any owner on the relay for the uuid, with no tenant filter.
5. [src/controllers/botapi/pay.ts:25–124](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/pay.ts#L25-L124)
   pay: body-controlled amount and recipient; message stored under the chat owner's tenant and sendMessage invoked with the chat owner as sender and realSatsContactId = recipient; no cap or membership check.
6. [src/network/send.ts:253–257](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L253-L257)
   For a tribe-owner sender with amount and realSatsContactId, MQTT is suppressed and a keysend of the full amount is forced to that contact.
7. [src/network/send.ts:360–363](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L360-L363)
   LND.keysendMessage is called with ownerPubkey = the chat owner's pubkey; in proxy mode loadLightning(true, ownerPubkey) selects that tenant's sub-LND (src/grpc/lightning.ts:134-136), so sats leave the victim tenant's wallet.
8. [src/controllers/botapi/dm.ts:19–61](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/dm.ts#L19-L61)
   dm: message sent as the chat owner to any contact pubkey in that owner's tenant, creating the conversation if needed.
9. [src/auth.ts:122–144](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L122-L144)
   /action is in no_auth, so ownerMiddleware is bypassed and the bot secret is the only credential.
10. [src/controllers/bots.ts:54–88](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L54-L88)
   createBot: any authenticated owner (a co-tenant in proxy mode) creates a bot with a webhook of their choice and receives a random id and secret usable at /action.
11. [src/controllers/bots.ts:457–492](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L457-L492)
   postToBotServer sends bot.secret to the webhook host as x-secret on every call, so a third-party bot host holds the credential /action trusts.

## Impact
Integrity HIGH: unbounded Lightning payments from another tenant's (or, single-tenant, the owner's) wallet to an attacker-controlled contact, forged bot messages in tribes the bot is not installed in, DMs in the victim owner's name. Confidentiality NONE: nothing is returned to the caller. Availability NONE: the only throw on this path (null contact in reversePayment for a non-member recipient) is caught by its try/catch, so no crash was confirmed.

## Reproduction steps
1. Attacker is a co-tenant on a proxy/hosting-provider relay who created a bot via POST /bot (low privilege: an ordinary owner account), or the third-party host of a bot the owner created. They POST /action with bot_id + bot_secret, action 'pay', the public chat_uuid of a victim tribe, their own contact id/pubkey in that tribe and any amount. No further checks; the action executes as that tribe's owner.

## Recommended fix
1. finalAction/validateAction authorize an action on a chat without binding the authenticated bot to that chat or to its tenant. Fix criteria: An action from bot_id may only target a chat that has a ChatBot row for that bot's uuid and whose tenant equals the bot's tenant; cross-tenant and uninstalled-bot requests are rejected with an error. Verify: /action with a valid secret for bot X and the chat_uuid of a tribe where X is not installed (or belonging to another tenant) performs no payment, message or DM.
2. pay accepts any amount and any recipient with no policy limit, and the un-awaited action hides failures from the caller. Fix criteria: Bot-initiated payments are bounded by a per-bot/per-chat allowance or owner-configured cap, the recipient must be a current member of the target chat, and the handler awaits the action so that failures are reported to the caller instead of silently logged.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257978

---

# chat_uuid from POST /action interpolated into raw SQL in getTribeOwnersChatByUUID

## Details
`getTribeOwnersChatByUUID` (src/utils/tribes.ts:389-410) builds its query by string interpolation — `AND sphinx_chats.uuid = '${uuid}'` — and executes it with `sequelize.query` passing only `{model, mapToModel}`, so no bind parameters, replacements or escaping are applied. `processAction` (src/controllers/botapi/index.ts:164-215) copies `chat_uuid` straight from the JSON body of POST /action, which is in the `no_auth` list (src/auth.ts:129), into the Action; `finalAction` (index.ts:249-250) awaits the raw query with it before the HTTP response is sent, and `validateAction` (index.ts:329) runs it again for broadcast/pay/dm. The only gate is knowledge of a Bot row's `id` + `secret` (or an HMAC with it), looked up without tenant (index.ts:182). That credential is handed to every third-party bot host as the `x-secret` header on every webhook delivery (src/controllers/bots.ts:482), and any co-tenant in proxy/hosting mode mints one with POST /bot.

A body such as `{"bot_id":"<id>","bot_secret":"<secret>","action":"broadcast","chat_uuid":"x' OR 1=1 --"}` changes the query structure. On the shipped default SQLite backend (config/config.json production: dialect sqlite; sqlite3 5.0.11 executes one statement per `all()`), the attacker can (a) UNION-select a fully forged Chat row — choosing `tenant`, `type`, `contactIds`, `groupKey`, `id` — so that broadcast/pay/dm run as any owner on the relay against a member list of the attacker's choosing, including `pay` of owner sats to an attacker-chosen `recipient_id`; (b) extract any table (Bot secrets of all bots, Lsat macaroons/preimages, owner auth_token hashes, contacts, messages) by time-based blind injection, since the awaited query's duration is reflected in the response latency and SQLite expressions (randomblob, recursive CTEs) give controllable delays; (c) hang the relay's single SQLite connection with an unbounded recursive CTE. On a Postgres deployment (`isPostgres()` branches exist in production code; DB_DIALECT env), under the assumption that Sequelize ^5.19.3 passes the raw text to pg ^8 without values and pg's simple-query protocol executes semicolon-separated statements, `x'; UPDATE sphinx_contacts SET auth_token='<sha256 of attacker token>' WHERE is_owner=1; --` rewrites owner credentials and DROP/DELETE destroys every tenant's data.

The same function is also reached by builtin bots with tribe-message channel ids (mother.ts, welcome.ts, git.ts, loop.ts) and by receiveBotRes→finalAction, but those paths first resolve the uuid against an existing Chat row; POST /action is the path that carries arbitrary strings.

## Evidence
1. [src/utils/tribes.ts:389–410](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L389-L410)
   getTribeOwnersChatByUUID builds the SQL text with `AND sphinx_chats.uuid = '${uuid}'` and runs it via sequelize.query with only {model, mapToModel} — no replacements or bind parameters, no escaping; the query is awaited, so its duration is visible in the HTTP response latency.
2. [src/controllers/botapi/index.ts:164–215](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L164-L215)
   processAction destructures chat_uuid straight from the JSON body (express.json, 5MB limit) and copies it into the Action with `chat_uuid: chat_uuid || ''`; no format or type validation.
3. [src/controllers/botapi/index.ts:243–254](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L243-L254)
   finalAction awaits getTribeOwnersChatByUUID(chat_uuid) with the unvalidated string before processAction answers the request.
4. [src/controllers/botapi/index.ts:327–337](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L327-L337)
   validateAction passes the same chat_uuid to the raw query again for broadcast/pay/dm and then runs the action as the Contact whose id is the returned row's `tenant`.
5. [src/controllers/botapi/index.ts:181–195](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L181-L195)
   The only gate before the sink: the caller must know a Bot row's id and either its secret (string compare) or an HMAC of the body with that secret. Bot is looked up by id alone, without tenant.
6. [src/auth.ts:129](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L129)
   '/action' is in the no_auth list, so ownerMiddleware and proxyAdminMiddleware skip it; no owner token or JWT is required.
7. [src/controllers/bots.ts:478–485](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L478-L485)
   postToBotServer sends bot.secret to the bot's webhook URL as the x-secret header on every message/install delivery, so every third-party bot host the owner installs holds the credential that unlocks /action.

## Impact
Default SQLite backend: the awaited raw query gives a time-based blind oracle over every table (all bot secrets, Lsat macaroons/preimages, owner auth_token hashes, contacts, messages, across all tenants) — confidentiality HIGH; a UNION-forged Chat row lets broadcast/pay/dm run as any tenant's owner against an attacker-chosen member list, including owner-funded pay to an attacker-chosen recipient — integrity HIGH; an unbounded recursive CTE in the injected text stalls the relay's single SQLite connection — availability HIGH. Postgres backend (assumption: Sequelize ^5.19.3 forwards the raw text to pg ^8 with no values, whose simple-query protocol executes stacked statements) additionally allows arbitrary UPDATE/DELETE/DROP, including rewriting owner credentials.

## Reproduction steps
1. The attacker needs any Bot row's id+secret: a third-party bot host receives it as x-secret on every webhook call the relay makes to it (bots.ts:482); a co-tenant in proxy/hosting mode mints one with POST /bot. With it they POST /action (no owner auth, src/auth.ts:129) with a crafted chat_uuid; the string reaches sequelize.query unescaped on every deployment. No user interaction; a single HTTP request.

## Recommended fix
1. getTribeOwnersChatByUUID concatenates an externally supplied uuid into SQL text. Fix criteria: The uuid is passed as a bound parameter/replacement (or the query is expressed through the ORM with a where object) so that no part of the input can alter query structure. Verify: a chat_uuid containing quotes, semicolons or SQL keywords returns no chat and executes no additional statements.
2. processAction forwards an unvalidated chat_uuid. Fix criteria: chat_uuid is validated against the expected uuid format before use and rejected otherwise.

---
**Severity:** HIGH
**Status:** Open
**Category:** SQL injection
**CWE:** [CWE-89](https://cwe.mitre.org/data/definitions/89.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257977

---

# Tenant can rewrite own owner publicKey to act with a co-tenant's Lightning macaroon

## Details
In proxy (multi-tenant) mode every authenticated request resolves req.owner by authToken hash (src/auth.ts) and then every Lightning operation selects the tenant's sub-node by req.owner.publicKey: Lightning.loadLightning(true, ownerPubkey) -> loadProxyLightning(ownerPubkey) -> reads `<ownerPubkey>.macaroon` from proxy_macaroons_dir. The relay therefore treats the publicKey column of the owner row as the tenant's Lightning identity and credential selector.

PUT /contacts/:id (updateContact) lets the caller update any contact row where {id: req.params.id, tenant: req.owner.id}. Owner rows are created with tenant = id (proxy.ts generateNewUser, contacts.ts generateOwnerWithExternalSigner), so the tenant's own owner row passes this filter. extractAttrs allow-lists `public_key` and `route_hint`, and jsonToContact is a plain snake->camel conversion with no field filtering, so `contact.update(jsonUtils.jsonToContact(attrs))` writes publicKey on the owner row. There is no unique constraint on sphinx_contacts.public_key (contact.ts).

Attack: tenant A (any ordinary authenticated owner; co-tenant pubkeys are visible in every contact row, message payload and GET /contacts for anyone A has chatted with) sends PUT /contacts/<A's id> {"public_key": "<B's pubkey>"}. From the next request on, req.owner.publicKey == B's pubkey, so PUT /invoices (invoices.ts:43-47 Lightning.sendPayment(payment_request, req.owner.publicKey)), POST /payment and every keysend message (send.ts signAndSend: ownerPubkey = owner.publicKey -> LND.keysendMessage) execute through B's macaroon and spend B's balance; GET /balance, /channels, /invoices read B's node state. A can pay an invoice A created to drain B.

Inbound side effect: receive.ts onReceive and parseKeysendInvoice resolve the recipient owner with Contact.findOne({isOwner: true, publicKey: dest}) with no ORDER BY; with two owner rows sharing B's pubkey, whichever the DB returns (SQLite: lowest rowid, i.e. the older tenant) becomes the recipient of B's inbound messages, payments and invites, which are stored under A's tenant, pushed to A's socket and A's device, and never reach B. auth.ts JWT lookup (findOne({publicKey, isOwner})) and /contacts/tokens are likewise made ambiguous. A can revert its publicKey afterwards to cover tracks.

Root cause: the owner's own identity column is writable through the generic contact-update endpoint, and tenant identity/credential selection is keyed on a mutable, non-unique column.

## Evidence
1. [src/controllers/contacts.ts:315–348](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L315-L348)
   updateContact finds the row by {id: req.params.id, tenant: req.owner.id}; the owner's own row has tenant == id, so it matches, and contact.update(jsonToContact(attrs)) writes whatever extractAttrs let through, including publicKey. This is where the fix belongs.
2. [src/controllers/contacts.ts:688–703](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L688-L703)
   extractAttrs allow-list includes 'public_key' and 'route_hint' (identity/routing fields) with no owner-row exclusion.
3. [src/utils/json.ts:51](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/json.ts#L51)
   jsonToContact is toCamel (src/utils/case.ts): a pure key rename, so public_key -> publicKey unchanged.
4. [src/utils/proxy.ts:158–205](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L158-L205)
   loadProxyLightning(ownerPubkey) -> loadProxyCredentials reads `${proxy_macaroons_dir}/${ownerPubkey}.macaroon` (only a length==66 check), so the rewritten owner publicKey selects the victim tenant's macaroon.
5. [src/grpc/lightning.ts:127–141](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L127-L141)
   loadLightning(true, ownerPubkey) returns the proxy client for whatever pubkey the owner row carries.
6. [src/grpc/lightning.ts:314–319](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L314-L319)
   sendPayment(payment_request, ownerPubkey) -> loadLightning(true, ownerPubkey): the spend sink executes under the selected macaroon; keysend (lines 437-439) does the same for every outbound message.
7. [src/controllers/invoices.ts:42–47](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L42-L47)
   PUT /invoices passes req.owner.publicKey into Lightning.sendPayment; details.ts getBalance/listChannels/queryRoute and invoices.ts addInvoice use the same selector.
8. [src/network/send.ts:317–363](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L317-L363)
   signAndSend derives ownerPubkey from owner.publicKey for signing and keysendMessage, so chat/payment messages also go out through the victim's sub-node.
9. [src/auth.ts:207–215](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L207-L215)
   ownerMiddleware (applied globally, app.ts:131) loads req.owner by authToken hash only, so the rewritten publicKey is what every later request of the attacker carries.
10. [src/utils/proxy.ts:111–121](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L111-L121)
   generateNewUser creates owner rows with tenant = own id, which is why the owner's own row passes updateContact's tenant filter (same in contacts.ts generateOwnerWithExternalSigner:188-193).
11. [src/network/receive.ts:99–102](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L99-L102)
   Inbound owner resolution by {isOwner: true, publicKey: dest} with no ORDER BY; with two owner rows sharing the victim's pubkey, inbound traffic can be delivered to the attacker's tenant.
12. [src/network/receive.ts:659–661](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L659-L661)
   Same lookup in parseKeysendInvoice for proxy child users (dest = bolt11 payee).
13. [src/models/sql/contact.ts:16–17](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/models/sql/contact.ts#L16-L17)
   publicKey column has no unique constraint and the model has no hooks; migrate.ts defines no unique index on public_key either.

## Impact
After the rewrite every Lightning call keyed on req.owner.publicKey (sendPayment, keysend, addInvoice, complexBalances, listChannels, queryRoute) runs with the victim tenant's macaroon: the attacker spends the victim's balance (e.g. pays an invoice the attacker created) and reads the victim's balance, channels and invoices (C HIGH, I HIGH). Duplicate owner pubkeys make inbound owner resolution (receive.ts:99-101, 659-661) ambiguous, so the victim's inbound messages and payments can be delivered to the attacker's tenant and lost to the victim (A LOW). Assumptions: sphinx-proxy (external, not pinned in this repo) authorises sub-node operations by the per-pubkey macaroon file that loadProxyCredentials reads, as the code's design implies; Sequelize ^5.19.3 findOne without order returns an arbitrary (SQLite 5.0.11: lowest rowid) matching row.

## Reproduction steps
1. Attacker is any ordinary authenticated tenant on a proxy-mode (multi-tenant) relay — the co-tenant adversary the threat model names (PR LOW). PUT /contacts/:id is behind ownerMiddleware only; one request PUT /contacts/<own id> {"public_key": "<B's pubkey>"} suffices, with B's pubkey learned from any contact row, message sender field or tribe membership. No race, no second condition and no user interaction: proxy mode is the deployment in which this attacker position exists at all, not an additional requirement, so AT is NONE.

## Recommended fix
1. updateContact allows identity fields (public_key, route_hint) to be written on the caller's own owner row, and tenant credential selection keys on that mutable column. Fix criteria: An owner row's publicKey (and routeHint in proxy mode) must not be changeable through PUT /contacts/:id; verify that PUT /contacts/<own id> with public_key is rejected or ignored and that req.owner.publicKey after the call still equals the pubkey assigned by the proxy.
2. No uniqueness or authority check on isOwner+publicKey, so two owner rows can share a pubkey and lookups by dest/publicKey become ambiguous. Fix criteria: Enforce uniqueness of publicKey among owner rows (constraint or check on write) and resolve the proxy macaroon from an immutable tenant identifier rather than a user-writable column; verify that inbound owner resolution and macaroon selection cannot be influenced by any authenticated-tenant write.

---
**Severity:** HIGH
**Status:** Open
**Category:** Privilege escalation
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257976

---

# Transport-token replay check defeated by equal timestamps and RSA ciphertext block appending

## Details
The x-transport-token scheme exists so the bearer token can cross an untrusted (plain-HTTP, the shipped default: config/app.json ssl.enabled=false, app.ts:160 http.createServer) hop without being reusable: the client RSA-encrypts 'token|timestamp' with the public key served unauthenticated at GET /request_transport_key, and ownerMiddleware (src/auth.ts:250-268) rejects tokens whose timestamp is older than owner.lastTimestamp. Two defects make the control ineffective against an attacker who has captured one transport token (the adversary the scheme is designed against):

1. Equal timestamps pass. The check is thisTimestamp.isBefore(lastTimestamp) (auth.ts:260; the FIXME at 261-262 says it should be !isAfter), so a captured token can be replayed verbatim any number of times until the legitimate client happens to send a newer one.

2. Ciphertext extension defeats the ordering check entirely and locks the owner out of transport-token auth. rsa.decrypt() (src/crypto/rsa.ts:33-53) treats the base64 input as a sequence of independent 256-byte PKCS#1 v1.5 blocks, privateDecrypts each and concatenates the plaintexts; nothing binds blocks together or fixes their count. The attacker base64-decodes the captured token (one block, plaintext 'token|<10- or 13-digit ts>'), appends a block they encrypted themselves with the public key (plaintext a few digits, e.g. '0000'), re-encodes and sends it. getAndDecryptTransportToken (src/utils/cert.ts:264-272) splits on '|': token is unchanged (so the sha256 owner lookup at auth.ts:208-215 succeeds) and parseInt yields a 14-digit value; momentFromTimestamp (auth.ts:278-285) treats any non-10-digit value as milliseconds, i.e. a date centuries in the future, so isBefore() is false and auth.ts:268 stores it in owner.lastTimestamp (BIGINT, src/models/sql/contact.ts:92). From then on (a) the attacker replays the same extended header indefinitely because equal timestamps pass, and (b) every genuine transport-token request from the owner (current timestamps) fails with 'timestamp too soon', because lastTimestamp only ever moves forward: the only writer is auth.ts:268, no route resets it, and the length_of_time_for_transport_token_clear config (src/utils/config.ts:164) is read but never used. Recovery requires editing the database row by hand; the owner can still authenticate with a plain x-user-token if their client supports it, since the check runs only when x-transport-token is present (auth.ts:165-169, 250).

The attacker thus holds a permanent owner credential for the full HTTP API (send payments, read messages, manage contacts). The RSA private key is used only for decryption; integrity of the encrypted token is assumed but never enforced (no MAC, no fixed block count, no plaintext grammar check, no freshness window against the relay clock). PKCS#1 v1.5 encryption padding is randomized but provides no integrity across blocks. Assumption: Node 16 (Dockerfile FROM node:16-buster-slim) crypto.privateDecrypt with RSA_PKCS1_PADDING decrypts a correctly padded block normally, and moment 2.29.4 (package-lock) interprets moment(number) as milliseconds since epoch.

The sibling check in the socket.io handshake is filed separately (socketio-transport-token-no-replay-check).

## Evidence
1. [src/auth.ts:250–268](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L250-L268)
   Replay protection rejects only when thisTimestamp.isBefore(lastTimestamp); an identical timestamp is accepted (the FIXME at 261-262 acknowledges it), and lastTimestamp is then overwritten with whatever value the presented token carried, with no check that it is near the current time.
2. [src/crypto/rsa.ts:33–52](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/crypto/rsa.ts#L33-L52)
   decrypt() slices the base64 input into independent 256-byte PKCS#1 v1.5 blocks, decrypts each and concatenates the plaintexts. Nothing binds blocks together, so an attacker can append their own block (encrypted with the public key) to a captured ciphertext and the plaintext is extended.
3. [src/utils/cert.ts:264–271](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/cert.ts#L264-L271)
   The concatenated plaintext is split on '|' and element 1 is parseInt'ed as the timestamp; digits appended by the attacker's block lengthen the timestamp (e.g. 1700000000000 -> 17000000000009).
4. [src/auth.ts:278–285](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L278-L285)
   momentFromTimestamp treats any non-10-digit value as milliseconds, so the lengthened value becomes a date centuries in the future that is never 'before' the stored lastTimestamp.
5. [src/controllers/auth.ts:83–99](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/auth.ts#L83-L99)
   GET /request_transport_key is unauthenticated and returns the RSA public key, so anyone can produce validly padded blocks to append.
6. [src/tests/controllers/transportToken.test.ts:57–58](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/tests/controllers/transportToken.test.ts#L57-L58)
   The replay assertion is commented out with 'FIXME re-enable the replay test once apps are always sure to do unique ts', confirming the maintainers rely on the timestamp check as the sole anti-replay control.

## Impact
The attacker gains a permanent owner-level credential: full read of messages, contacts, media keys and invoices (C:H), ability to send payments, create/modify data and pay invoices with the relay's LND admin macaroon (I:H). The legitimate owner's transport-token authentication is persistently rejected because lastTimestamp is pushed to the far future and nothing in the code resets it; however the check runs only when x-transport-token is present (auth.ts:165-169, 250), so plain x-user-token authentication still works and the lockout is confined to one authentication channel (A:L).

## Reproduction steps
1. Attacker must observe one x-transport-token header for the victim, e.g. as an on-path observer of the plain-HTTP hop that transport tokens are meant to protect (AT:PRESENT, machine-in-the-middle position). They fetch the public key from /request_transport_key, encrypt a single digit, append the block to the captured ciphertext and send it as x-transport-token; the request is accepted as the owner and lastTimestamp is pushed to a far-future value. The same header is then reusable without limit. No credentials, no victim action, deterministic.

## Recommended fix
1. The anti-replay comparison accepts a timestamp equal to the last one seen and accepts any future value, so a captured token can be reused and the stored high-water mark can be pushed arbitrarily forward. Fix criteria: A presented timestamp must be strictly greater than the last accepted one AND within a small window of the relay's current time (e.g. +/- a few minutes); verify that replaying an accepted token returns 401 and that a token with a timestamp far in the future is rejected without updating lastTimestamp.
2. rsa.decrypt concatenates independently decrypted PKCS#1 v1.5 blocks, so ciphertexts are malleable by appending blocks; the transport token has no integrity protection and no fixed structure check. Fix criteria: Transport tokens must be rejected unless they consist of exactly one RSA block (or carry an integrity tag covering the whole plaintext) and the decrypted plaintext matches a strict 'token|<10 or 13 digits>' grammar; verify that a captured token with an extra block appended is rejected.

---
**Severity:** HIGH
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-294](https://cwe.mitre.org/data/definitions/294.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257975

---

# HOSTING_PROVIDER mode lets unauthenticated callers pay arbitrary invoices from owner's node

## Details
`ownerMiddleware` contains a special case for hosting-provider deployments (`HOSTING_PROVIDER=true`, started via `npm run start-hosting`). In that mode, if the request carries no `x-user-token`/`x-transport-token`/`x-admin-token` and the relay is not in proxy mode, the middleware loads the single `isOwner` contact and sets `req.owner` to it "anyway". Immediately afterwards, if `req.path === '/invoices'`, it calls `next()` and returns — bypassing the `if (!token && !jwt) 401` check and every subsequent credential check. The exemption is keyed on the path only, not the method.

Three routes share that path: `POST /invoices` (createInvoice — the hub's intended use), `GET /invoices` (listInvoices) and `PUT /invoices` (payInvoice). `payInvoice` requires only that `req.owner` be set, then calls `Lightning.sendPayment(req.body.payment_request, req.owner.publicKey)`, which pays the bolt11 from the owner's LND node with a 100-sat fee limit.

An unauthenticated Internet attacker therefore sends `PUT /invoices` with body `{"payment_request": "<attacker's bolt11>"}` and no auth headers to a hosting-provider relay (port 3300/3001 is exposed so the mobile client can reach it). The relay pays the attacker's invoice from the user's channel balance. Repeating with invoices sized to the remaining balance drains the node; the 10 req/s rate limiter does not prevent this.

The same bypass exposes `GET /invoices`, which calls `loadLightning().listInvoices({})` and returns every invoice on the LND node — payment requests, memos, settled preimages and the `htlcs[].custom_records` containing the raw sphinx message TLV payloads of every keysend the node has received — to an unauthenticated caller. `POST /invoices` with `contact_id`/`chat_id` also lets the caller create invoices and have the owner's node send them as messages to contacts.

The path is conditional on `HOSTING_PROVIDER=true` and a non-proxy deployment (in proxy mode `req.owner` stays undefined without a token and payInvoice fails with 'no owner'). The threat model notes hosting-provider mode relaxes token handling; the hub-notification code in regular.ts shows the relaxation was meant for invoice creation, not payment or listing.

## Evidence
1. [src/auth.ts:171–193](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L171-L193)
   When HOSTING_PROVIDER=true and no x-user-token/x-transport-token/x-admin-token is presented on a non-proxy relay (isProxy() false), ownerMiddleware loads the sole isOwner contact into req.owner (lines 183-188), then for req.path === '/invoices' calls next() and returns (lines 189-192), skipping the 'no token or jwt' 401 and every later credential check. The exemption is keyed on path only, so GET, POST and PUT all pass.
2. [src/controllers/invoices.ts:26–47](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L26-L47)
   payInvoice requires only req.owner to be set, then calls Lightning.sendPayment(req.body.payment_request, req.owner.publicKey), paying the caller-supplied bolt11 from the owner's node.
3. [src/controllers/index.ts:243–244](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L243-L244)
   POST /invoices is routed to createInvoice and PUT /invoices to payInvoice; both have req.path '/invoices' and so both fall under the hosting-mode exemption.
4. [src/controllers/index.ts:136](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L136)
   GET /invoices (listInvoices) shares the same req.path and is therefore also reachable without credentials.
5. [src/controllers/invoices.ts:240–255](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L240-L255)
   listInvoices requires only req.owner, calls loadLightning() (root client) .listInvoices({}) and returns the full LND response, including payment requests, memos, settled preimages and htlcs[].custom_records, to the caller.
6. [src/grpc/lightning.ts:314–375](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L314-L375)
   sendPayment loads the root LND client in non-proxy mode (loadLightning(true, pubkey) only uses a proxy client when isProxy()) and pays the bolt11 at its embedded amount with fee_limit fixed 100 (or GL/CLN pay); nothing re-checks authorization or caps the amount.
7. [src/auth.ts:93–97](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L93-L97)
   hmacMiddleware, the only other middleware between ownerMiddleware and the route (app.ts:131-132), calls next() when no x-hmac header is present ('FIXME optional sig for now'), so request signing does not stop the unauthenticated request even if the owner has opted in to an hmacKey.
8. [src/grpc/regular.ts:50–51](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/regular.ts#L50-L51)
   The only other HOSTING_PROVIDER-conditional code posts settled invoices to the hub (hub.ts sendInvoice), showing the exemption exists so the hub can create invoices (POST) and learn when they settle; paying (PUT) and listing (GET) are swept into the same path-only carve-out.

## Impact
Integrity high: arbitrary outbound Lightning payments from the owner's funds up to the full spendable balance. Confidentiality high: the complete invoice history including settled preimages and the raw keysend message payloads is disclosed to anyone. Availability not directly affected beyond the loss of funds.

## Reproduction steps
1. Attacker on the Internet reaches the relay's HTTP port, which is exposed by design. With HOSTING_PROVIDER=true (a documented run mode, non-default) on a non-proxy relay, a bare PUT /invoices with a bolt11 body and no headers is accepted and paid; GET /invoices with no headers returns all invoices. No credential, interaction or race is needed.

## Recommended fix
The hosting-provider exemption in ownerMiddleware is keyed on req.path alone and additionally pre-populates req.owner with the sole owner, so PUT and GET /invoices run as the owner with no credentials. Fix criteria: Without valid owner credentials, PUT /invoices must not pay and GET /invoices must not return data (401), in every mode including HOSTING_PROVIDER=true; any unauthenticated allowance must be limited to the specific operation the hub needs (invoice creation) and must not run with req.owner set to the owner's full identity. Verify by sending unauthenticated PUT and GET /invoices in hosting mode and confirming rejection and no payment.

---
**Severity:** HIGH
**Status:** Open
**Category:** Authentication bypass
**CWE:** [CWE-306](https://cwe.mitre.org/data/definitions/306.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257973

---

# receiveHeartbeat pays back half of an attacker-declared amount on unpaid MQTT transport

## Details
The heartbeat protocol is meant to be a liveness probe: a peer keysends a small amount with a type-26 payload and the receiving relay returns half of it as a heartbeat_confirmation keysend. On the Lightning path this is safe because parseKeysendInvoice replaces message.amount with the real settled value, so a prober always loses half of what it paid.

The same handler, however, is reachable over MQTT. The relay subscribes to `${ownerPubkey}/#` on the tribe broker (tribes.sphinx.chat by default) and receiveMqttMessage dispatches whatever arrives there to ACTIONS[payload.type] with no restriction on type and with network_type merely recorded. A tribe owner publishes to `${memberPubkey}/${tribeUuid}` in the normal course of broadcasting, so the broker necessarily lets tribe owners publish onto other users' prefixes. A malicious tribe owner (or anyone the broker admits onto the victim's prefix, or a compromised broker — adversary 3 in the threat model) can therefore publish `{type:26, sender:{pub_key:<attacker>, route_hint:...}, message:{amount: N}}` to every member of a tribe they operate. No sats were paid, the signature is not enforced (parseAndVerifyPayload returns unverified payloads), yet receiveHeartbeat computes amt = Math.round(N/2) and calls signAndSend, which — having no mqttTopic or coTenantDest — performs LND.keysendMessage from the victim's node (in proxy mode, from that tenant's sub-wallet) to the attacker's pubkey. keysend has no upper bound on amt and sets a 5% fee limit, so the payment succeeds up to the victim's outbound liquidity. Repeating with smaller N drains whatever remains.

Root cause: receiveHeartbeat trusts a payload-declared amount as evidence of received value regardless of transport, and the MQTT ingress does not restrict which message types it will accept.

Assumption stated: the tribe broker's publish ACL permits a tribe owner to publish on member prefixes (this is required for normal tribe broadcast in send.ts, mqttTopic = `${destkey}/${chatUUID}`); whether it further restricts the uuid suffix does not matter because the relay ignores the suffix.

## Evidence
1. [src/controllers/confirmations.ts:158–190](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/confirmations.ts#L158-L190)
   receiveHeartbeat reads dat.message.amount straight from the inbound payload, computes amt = round(amount/2) and calls network.signAndSend({amt, dest: sender_pub_key, route_hint}, owner) with no mqttTopic or coTenantDest — a Lightning keysend from the owner's node to the payload's self-declared sender. It never checks payload.network_type, so the declared amount is trusted even when no payment was received.
2. [src/network/receive.ts:516–532](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L516-L532)
   receiveMqttMessage parses any message published on the owner's MQTT prefix, tags it network_type=mqtt, takes dest from topic segment 0 (ignoring the uuid suffix) and hands it to onReceive. No type restriction: a heartbeat (type 26) carries no chat, so onReceive's tribe gating is skipped, doAction stays true and doTheAction dispatches ACTIONS[26] = receiveHeartbeat.
3. [src/network/receive.ts:720–726](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L720-L726)
   Only the Lightning path (parseKeysendInvoice) overwrites message.amount with the invoice's true settled value. The MQTT path leaves the attacker-authored amount untouched.
4. [src/network/receive.ts:562–590](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L562-L590)
   parseAndVerifyPayload returns the payload even when the signature is invalid or absent ('=> RM THIS'), so the sender.pub_key and amount in an MQTT message need not be signed by the claimed sender.
5. [src/network/send.ts:345–363](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L345-L363)
   signAndSend keysends via LND.keysendMessage whenever neither coTenantDest nor mqttTopic is supplied; receiveHeartbeat supplies neither, so the half-amount is a real Lightning payment from the victim's wallet (ownerPubkey selects the tenant's sub-wallet in proxy mode).
6. [src/utils/tribes.ts:248–254](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L248-L254)
   The relay subscribes to `${pubkey}/#`, i.e. every topic under the owner's pubkey; the uuid suffix a tribe owner publishes to is never checked against tribe membership or message type.
7. [src/grpc/lightning.ts:418–419](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L418-L419)
   keysend applies only a lower bound (min_sat_amount) to amt; there is no upper cap, so the half-amount is sent as declared, limited only by channel liquidity and the 5% fee limit.

## Impact
Direct theft of Lightning funds from the victim's node — the primary asset the relay guards. No data is disclosed and the service keeps running.

## Reproduction steps
1. Attacker creates a free public tribe (or already owns one the victim joined). Victim's relay is subscribed to its own pubkey prefix on the broker. Attacker publishes an unsigned heartbeat payload with message.amount = 2x victim balance on `${victimPubkey}/${attackerTribeUuid}`. receiveMqttMessage -> onReceive -> receiveHeartbeat -> keysend of half the amount to attacker's pubkey, paid by the victim. No credentials on the victim's relay are needed; the only precondition is the broker admitting the attacker onto the victim's topic prefix (the normal tribe-owner position).

## Recommended fix
1. receiveHeartbeat treats message.amount as money actually received even when the payload arrived over MQTT/co-tenant transport where nothing was paid. Fix criteria: Heartbeat replies must only be sent when network_type is lightning and the amount used is the invoice-settled value; a heartbeat received over MQTT or co-tenant delivery must never trigger a payment. Verify by publishing a heartbeat with a large amount on the owner's MQTT prefix and confirming no keysend is attempted.
2. The MQTT ingress dispatches every message type, including payment-triggering ones, to the same ACTIONS table as paid Lightning traffic. Fix criteria: Messages arriving over MQTT must be limited to tribe-broadcast types (typesToForward and related) and must not reach handlers that spend funds; the uuid in the topic should be matched to a chat the owner belongs to. Verify by sending non-broadcast types over MQTT and confirming they are dropped.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper Input Validation
**CWE:** [CWE-345](https://cwe.mitre.org/data/definitions/345.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257972

---

# Unauthenticated bot_res payload drives pay/broadcast actions on tribe owner's relay and crashes it

## Details
When a relay that owns a tribe receives a `bot_res` (type 25) payload, `receiveBotRes` (src/controllers/bots.ts:543-595) looks up the chat by `chat.uuid`, sees the local owner is the tribe owner, and calls `finalAction()` with `bot_id`, `action`, `content`, `amount`, `recipient_id`, `reply_uuid`, `parent_id`, `msg_uuid` and `bot_name` copied verbatim from the peer payload. Nothing authenticates the sender: `onReceive` (src/network/receive.ts:121-130) dispatches the three bot types to `ACTIONS` before the membership/price/sender checks other types get, and `parseAndVerifyPayload` (receive.ts:561-591) returns the payload even when the signature is absent or invalid. In `finalAction` (src/controllers/botapi/index.ts:225-321) the attacker's `bot_id` is looked up and immediately discarded (`myBot = null`) because the chat is local; neither it nor `validateAction` (327-337) checks that a bot is installed in the chat (ChatBot/BotMember) or that the sender is that bot's maker. The action then runs with the tribe owner's identity and node:

- `pay` (pay.ts:93-124): stores a direct_payment/boost message as the owner and calls `network.sendMessage(... amount, realSatsContactId: recipient_id)`. If `recipient_id` (a small sequential contact id, strict-equal to an entry of `chat.contactIds`) names a tribe member, the owner's LND keysends `Math.max(amount, min_sat)` sats to that member (send.ts:253-273) and every other member receives an owner-signed payment/boost message. If `recipient_id` is not in the tribe, `initiateReversal` (send.ts:201-211, 643-657) runs with tenant -1, finds no message and dereferences null; `pay()` rejects, `finalAction` did not await it, there is no `unhandledRejection` handler anywhere in the tree, and the Node 16 (Dockerfile `node:16-buster-slim`) process exits.
- `broadcast` (broadcast.ts:64-131): stores and publishes to every tribe member a message with attacker-chosen `bot_name` alias, content, uuid and reply/parent ids, appearing as a bot response from the tribe owner.

(`dm` is not reachable from this path: receiveBotRes builds the Action without `pubkey`, so dm.ts:19 returns.)

Delivery: any Lightning node can keysend a TLV payload of type 25 to the victim's pubkey (tribe uuids are public on the tribe server); on this path the relay overwrites `message.amount` with the sats received (receive.ts:722-723), so the forwarded payment is attacker-funded (the owner still pays routing fees and the tribe sees an owner-attributed payment). Over MQTT the relay subscribes to `<pubkey>/#` (tribes.ts:253) and `receiveMqttMessage` (receive.ts:516-529) applies no amount override; the relay's own code publishes to other pubkeys' topics (`${destkey}/${chatUUID}`, `${dest}/${myBot.uuid}`), so the broker necessarily lets any client authenticated with a Lightning key publish to the owner's topic (threat-model adversary 3). That path lets the attacker name an arbitrary `amount` and a `recipient_id` (their own contact row after joining the tribe, or any member by enumeration), draining the owner's wallet one keysend per message, bounded only by LND's fee limit and channel liquidity.

## Evidence
1. [src/controllers/bots.ts:543–595](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L543-L595)
   receiveBotRes: when the local owner is the tribe owner, bot_id, action, content, amount, recipient_id, reply_uuid, parent_id, msg_uuid and bot_name are copied verbatim from the peer payload into finalAction() with no sender, signature, BotMember or ChatBot check; the call is not awaited.
2. [src/controllers/botapi/index.ts:225–321](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L225-L321)
   finalAction: the attacker-chosen bot_id is looked up and then discarded (myBot = null) because getTribeOwnersChatByUUID finds the local chat; pay/broadcast are dispatched as the tribe owner without verifying a bot is installed in the chat or that the caller is its maker, and without await, so their rejections are unhandled.
3. [src/network/receive.ts:121–130](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L121-L130)
   onReceive returns ACTIONS[payload.type](payload) for bot_install/bot_cmd/bot_res before any tribe-membership, price or sender validation; for bot_res not even bot_uuid is required.
4. [src/network/receive.ts:561–591](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L561-L591)
   parseAndVerifyPayload returns the payload when the signature is missing, malformed or invalid ('=> RM THIS'), so sender.pub_key is unauthenticated on both the Lightning and MQTT paths.
5. [src/network/receive.ts:720–726](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L720-L726)
   Over Lightning message.amount is replaced by the sats actually received; receiveMqttMessage (516-529) performs no such override, so an MQTT-delivered bot_res carries an arbitrary attacker-chosen amount.
6. [src/controllers/botapi/index.ts:327–336](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L327-L336)
   validateAction, the only gate pay() and broadcast() apply, checks just that chat_uuid is a tribe owned by a local owner; it does not identify or authorise the caller.
7. [src/controllers/botapi/pay.ts:93–124](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/pay.ts#L93-L124)
   pay stores a direct_payment/boost message as the owner (sender -1) and calls network.sendMessage with amount and realSatsContactId = recipient_id from the payload.
8. [src/network/send.ts:253–273](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L253-L273)
   For the realSatsContactId contact the MQTT topic is cleared and LND.keysendMessage sends Math.max(amount, min_sat) sats from the owner's node; every other member receives the owner-signed direct_payment/boost over MQTT.
9. [src/network/send.ts:201–211](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L201-L211)
   If recipient_id is not in chat.contactIds, initiateReversal is called with tenant = sender.id = -1 (pay sets id: botContactId).
10. [src/network/send.ts:643–657](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L643-L657)
   initiateReversal looks the message up with tenant -1, which never matches the row pay() stored under the owner's tenant, and dereferences the null result (originalMessage.sender), rejecting sendMessage -> pay -> unhandled rejection; no process.on('unhandledRejection') handler exists and the Node 16 image terminates by default.
11. [src/controllers/botapi/broadcast.ts:64–131](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/broadcast.ts#L64-L131)
   broadcast stores and publishes to every tribe member a bot_res message with attacker-chosen bot_name alias, content, uuid and reply/parent ids, signed by and forwarded as the tribe owner.

## Impact
Integrity HIGH: attacker-controlled bot messages and owner-attributed payments/boosts are injected into the tribe and stored in the owner's database, and the owner's node is made to keysend sats to an attacker-chosen member (arbitrary amount over MQTT; the amount the attacker paid plus routing fees over Lightning). Availability HIGH: a pay action naming a non-member recipient_id deterministically terminates the relay process through an unhandled rejection. Confidentiality NONE: no data is returned to the attacker.

## Reproduction steps
1. Attacker is any Lightning node (keysend TLV to the owner's pubkey) or any client authenticated to the tribe MQTT broker who publishes to the owner's <pubkey>/# topic. They learn a tribe uuid from the public tribe server and send {type:25, chat:{uuid}, sender:{pub_key:any}, action:'pay'|'broadcast', recipient_id, amount, content, bot_name}. No signature validity, membership, bot secret or installation is checked; the action executes as the owner. No user interaction. Assumption: LND default inbound min_htlc is 1 sat, so over Lightning the forwarded amount equals what the attacker paid; the arbitrary-amount drain relies on MQTT delivery, which the relay's own cross-pubkey publishing shows the broker (tribes.sphinx.chat, default host) permits.

## Recommended fix
1. receiveBotRes/finalAction execute bot actions on a tribe without authenticating the sender as the maker of a bot that is actually installed in that chat, and payload signatures are not enforced upstream. Fix criteria: A bot_res received by a tribe owner is acted on only when the payload signature verifies for sender.pub_key, that pubkey equals the bot maker's pubkey of a ChatBot/BotMember row for this chat (or the bot is local/builtin), and bot_id/bot_uuid match that row; unverified or unmatched bot_res payloads are dropped and logged. Verify: a keysend or MQTT bot_res from an arbitrary node produces no broadcast or payment.
2. pay/broadcast are invoked without await; a rejection (recipient not in tribe causing a null dereference in initiateReversal, which also queries with tenant -1) is unhandled and terminates the process. Fix criteria: All action handlers are awaited with errors caught and logged; sendMessage validates that realSatsContactId is a member before paying, and initiateReversal handles a missing original message without throwing. Verify: a pay action with an unknown recipient_id is rejected without the process exiting.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing authentication
**CWE:** [CWE-306](https://cwe.mitre.org/data/definitions/306.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257969

---

# Any peer can inject a tribe_delete event into a victim's chat without owner check

## Details
receiveTribeDelete (src/controllers/chatTribes.ts:739-773) handles inbound message type 22 (tribe_delete), which the protocol defines as the tribe owner announcing the tribe is gone: deleteChat (src/controllers/chats.ts:502-503) only sends it when owner.publicKey === chat.ownerPubkey, and sibling tribe controls (pinToTribe chatTribes.ts:375, editTribe chatTribes.ts:453) gate on the same identity. The receiver enforces no corresponding check.

Path: any Lightning node keysends to the victim's pubkey with the Sphinx TLV record containing {type:22, chat:{uuid:<tribe uuid>, type:2}, sender:{pub_key:<attacker>}, message:{}} plus a signature over the JSON (parseKeysendInvoice, src/network/receive.ts:632-727; parseAndVerifyPayload even returns the payload when the signature is invalid, 'RM THIS', 578-590). onReceive finds the victim's chat by uuid+tenant; because the victim is not the tribe owner the owner-side gating block (140-351) is skipped, doAction stays true and doTheAction (354) calls ACTIONS[22] = chatTribes.receiveTribeDelete (src/controllers/index.ts:277). parseReceiveParams (src/helpers.ts:321-331) resolves the chat by uuid+tenant and tolerates an unknown sender ({id:0}). receiveTribeDelete then persists a Message of type tribe_delete (sender 0 or the attacker's contact id) in the victim's tribe chat and emits a 'tribe_delete' socket event carrying the chat to the victim's connected client as if the owner had deleted the tribe. The same path also reaches the tribe owner's own relay (type 22 is not in typesToForward, so doAction remains true on the isTribeOwner branch).

Prerequisites: the tribe uuid (public tribes are listed by the tribe server; GET /tribes/:uuid is unauthenticated, src/utils/tribes.ts:597) and a member's pubkey (the owner's pubkey is in the listing). No payment threshold applies to type 22. Verified relay-side effect: a forged owner-only control message is written to the victim's message store and delivered to the client as authentic. Whether the Sphinx client (separate repository, not verifiable in this checkout) removes the tribe locally on this event is an assumption; the relay itself does not destroy rows here. Same root-cause class as the sibling receiveMemberApprove/receiveMemberReject handlers at different entry points.

## Evidence
1. [src/controllers/chatTribes.ts:739–773](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L739-L773)
   receiveTribeDelete resolves the chat from the payload-supplied uuid, never compares sender_pub_key to chat.ownerPubkey, and stores a tribe_delete Message (sender 0 or attacker contact id) plus emits a 'tribe_delete' socket event to the victim's client.
2. [src/controllers/chats.ts:502–520](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L502-L520)
   deleteChat sends tribe_delete only when owner.publicKey === chat.ownerPubkey: the project's own sender-side definition that tribe_delete is an owner-only control message. The receiver side has no equivalent check.
3. [src/network/receive.ts:354](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L354)
   onReceive dispatches the payload to doTheAction/ACTIONS with doAction still true for a non-owner recipient; no sender authorization is applied for type 22 on either the member or owner branch.
4. [src/controllers/index.ts:277](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L277)
   ACTIONS maps msgtypes.tribe_delete (22) to chatTribes.receiveTribeDelete.
5. [src/helpers.ts:320–331](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L320-L331)
   parseReceiveParams group branch finds the chat by uuid+tenant only and injects a placeholder sender {id:0} when the sender pubkey is unknown to the tenant, so a stranger's payload still resolves to the victim's tribe chat.
6. [src/network/receive.ts:709–726](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L709-L726)
   parseKeysendInvoice entry point: any inbound keysend TLV payload is parsed (signature failure does not stop it) and handed to onReceive with the victim as dest.

## Impact
A forged owner-only control message (type tribe_delete) is persisted in the victim's tribe chat history and emitted to the connected client as authentic, corrupting the integrity of tribe control state the relay vouches for. No data is disclosed. The relay destroys no rows itself; whether the Sphinx client drops the tribe locally on the event is unverifiable in this checkout (separate repository) and is therefore not rated.

## Reproduction steps
1. Any Lightning node can keysend an arbitrary Sphinx TLV payload to the victim's node pubkey (threat-model adversary 2). The attacker needs only the tribe uuid (public tribe listing; GET /tribes/:uuid is unauthenticated per src/utils/tribes.ts:597) and a member's pubkey (the owner's is in the listing). Type 22 is subject to no price/amount gate and no membership check on the recipient side, and the handler runs in the default deployment with no victim interaction.

## Recommended fix
The tribe_delete receiver trusts the message type alone: receiveTribeDelete (and the onReceive dispatch feeding it) never verifies that the payload's sender pubkey is the tribe owner recorded in chat.ownerPubkey. Fix criteria: A tribe_delete payload is stored and emitted only when the authenticated sender pubkey equals chat.ownerPubkey of the resolved tribe chat (and the signature over the payload actually verifies for that pubkey). Verify by keysending tribe_delete for a known tribe uuid from a non-owner key: no Message row is created and no 'tribe_delete' socket event is sent.

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
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257966

---

# Unauthenticated member_approve payload forces victim to re-pay tribe join price

## Details
The inbound handler for message type member_approve (src/controllers/chatTribes.ts receiveMemberApprove) is reachable by any Lightning node that can keysend to the relay's pubkey (and by anyone who can publish on the relay's MQTT topics). It identifies the chat solely by payload.chat.uuid within the destination owner's tenant, performs no check that payload.sender.pub_key equals chat.ownerPubkey, does not require the chat to be in the pending state, and unconditionally (1) sets chat.status = approved and (2) calls network.sendMessage({type: group_join, amount: chat.priceToJoin, chat}). In send.ts, a tribe message from a non-owner is routed exclusively to the tribe-owner contact as a keysend of Math.max(amount, min_sat), i.e. the victim's node pays priceToJoin sats to the tribe owner.

Because there is no replay/idempotency guard, every forged member_approve causes another payment. Tribe uuids are public (they are listed on the tribe server and appear in join links), and a member's node pubkey is known to the tribe owner and discoverable on the Lightning graph.

Attack path 1 (malicious tribe owner, threat-model adversary 3): create a tribe with a high price_to_join, wait for members to join and pay once, then repeatedly keysend {type: member_approve, chat:{uuid, type: 2}, sender:{pub_key: owner}} to each member. Each message drains priceToJoin sats from the member to the owner, indefinitely, with no action from the member.

Attack path 2 (any third party): send the same payload to a known member of any priced tribe to force them to pay the tribe owner repeatedly (griefing / fund depletion to a third party).

The signature on the payload is irrelevant here: even if the sender signature were enforced (parseAndVerifyPayload currently returns the payload on invalid signatures), the handler never compares the sender to the tribe owner, so a non-owner's legitimately signed message is equally accepted.

The same missing-owner check pattern exists in receiveMemberReject and receiveTribeDelete (filed separately), but only receiveMemberApprove moves funds.

## Evidence
1. [src/controllers/chatTribes.ts:616–675](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L616-L675)
   receiveMemberApprove takes the peer-authored payload, resolves the chat only by uuid+tenant via parseReceiveParams, never compares payload.sender.pub_key with chat.ownerPubkey, does not require chat.status === pending, unconditionally sets status approved, and calls network.sendMessage({type: group_join, amount: chat.priceToJoin, sender: owner, chat}). No idempotency guard: every delivery triggers another send.
2. [src/network/send.ts:179–185](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L179-L185)
   For a tribe chat where the sender (the victim owner) is not the tribe owner, sendMessage replaces contactIds with the single tribe-owner contact (looked up by chat.ownerPubkey), so the group_join goes only to the tribe owner; networkType stays undefined so no MQTT topic is used.
3. [src/network/send.ts:268–280](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L268-L280)
   signAndSend is called with amt = Math.max(amount, min_sat_amount) and an empty mqttTopic, so it falls through to LND.keysendMessage (lightning.ts keysend -> sendPaymentV2/sendPaymentSync): the victim's node actually pays chat.priceToJoin sats on every invocation.
4. [src/network/receive.ts:562–591](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L562-L591)
   parseAndVerifyPayload returns the parsed payload even when the signature is invalid, missing, or verification throws ('return payload // => RM THIS'), so payload.sender.pub_key is unauthenticated; and even with a valid signature the handler performs no owner comparison, so a legitimately-signed tribe owner can trigger the payment at will.
5. [src/network/receive.ts:132–134](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L132-L134)
   onReceive derives isTribeOwner only to decide the owner-side forwarding/pricing block; on a member relay isTribeOwner is false, member_approve is not in typesToForward, and doAction stays true.
6. [src/network/receive.ts:354](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L354)
   doTheAction dispatches to ACTIONS[member_approve] = chatTribes.receiveMemberApprove (controllers/index.ts:275) with no sender/owner authorization.
7. [src/helpers.ts:320–331](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L320-L331)
   parseReceiveParams for a tribe-typed payload resolves chat purely from the attacker-supplied chat.uuid (scoped to the dest owner) and injects an unknown sender as {id: 0}, so any node that knows the public tribe uuid and the victim's node pubkey reaches the handler.
8. [src/controllers/chatTribes.ts:129](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L129)
   chat.priceToJoin is persisted on the member's chat record at join time (doJoinTribe) from the tribe's advertised price and is reused as the payment amount on every member_approve; the project's sanctioned flow pays it exactly once, at join.

## Impact
The relay's core asset is spending authority over the user's Lightning funds. The attacker causes unauthorized outbound payments of priceToJoin sats per message, unbounded in count, plus unauthorized mutation of the chat status. No confidentiality impact; availability impact is the depletion of channel balance.

## Reproduction steps
1. Attacker is any Lightning node (or MQTT publisher) able to deliver a keysend TLV payload to the victim relay's pubkey; no credentials or victim interaction. They need the public tribe uuid and the victim's pubkey (known to the tribe owner, who is the natural attacker). One payload per payment; repeat at will. Works on default deployments with any tribe whose priceToJoin > 0.

## Recommended fix
1. receiveMemberApprove trusts an attacker-authored control message: it never verifies that the message sender is the tribe owner (chat.ownerPubkey), that a member_request is actually outstanding (chat.status === pending), or that the join payment has not already been made. Fix criteria: A member_approve is acted upon only when payload.sender.pub_key equals chat.ownerPubkey for the resolved chat and the chat is in pending state; after approval the chat leaves pending so a replayed/forged message cannot trigger another group_join payment. Verify by sending member_approve from a non-owner key and from the owner twice: no payment and no status change on the forged/replayed messages.
2. The inbound dispatcher (network/receive.ts onReceive/doTheAction) dispatches tribe control types (member_approve, member_reject, tribe_delete, group_kick) to handlers without a central check that tribe-owner-only messages originate from chat.ownerPubkey, and parseAndVerifyPayload accepts payloads whose signature fails verification. Fix criteria: Owner-only tribe message types are rejected before dispatch unless the (verified) sender pubkey matches the stored chat.ownerPubkey, and payloads with invalid or missing signatures are dropped. Verify by sending each owner-only type from a non-owner key and observing no handler side effects.

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
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257961

---

# Unauthenticated /swarm_admin_register lets anyone become proxy admin for any owner

## Details
POST /swarm_admin_register (src/controllers/admin.ts:10-39) is on the no_auth list in src/auth.ts, so it is reachable with no credentials. It reads `pubkey` and `token` from the JSON body, finds the owner Contact whose publicKey equals `pubkey`, and if that owner has no adminToken it writes `adminToken = sha256(token)` and `isAdmin = true`. The handler was evidently meant for one-time bootstrap of the first admin on a fresh swarm install (see the sibling `initialAdminPubkey`, which does gate on 'exactly one contact, no authToken'), but it has no such gate: it works in every deployment mode, for every owner row, at any time, and requires no proof that the caller controls the pubkey.

Owner pubkeys are not secrets: they are Lightning node identity keys, gossiped on the network, shown to every contact and tribe the user interacts with, published in tribe listings and people profiles, and reported to the hub. On a fresh proxy install `/initial_admin_pubkey` (also unauthenticated) hands out the root owner's pubkey directly.

Attack (proxy/swarm mode, the mode the admin API exists for): the attacker POSTs `{pubkey: <any tenant's or the root node's pubkey>, token: T}`. That owner now has adminToken=sha256(T) and isAdmin=true. Sending `x-admin-token: T` on later requests makes ownerMiddleware set req.admin to that owner, and proxyAdminMiddleware passes. The attacker can then:
- GET /list_users: every owner contact serialised by contactToJson, which strips only authToken/adminToken and leaks hmacKey (request-signing secret), deviceId/pushKitToken, contactKey, personUuid, routeHint and the publicKey of every unclaimed pre-funded user (authToken null, generated by generateNewUsers with proxy_initial_sats, default 5000 sats each).
- POST /contacts/tokens {pubkey: <unclaimed pubkey>, token: X} (no_auth): claims those pre-funded accounts, then spends their sats via the normal owner API.
- GET /add_user?sats=N: has the proxy create and fund a new sub-node with attacker-chosen N from the root node, and returns its publicKey; claim it the same way.
- GET /admin_balance: the hijacked owner's channel balances (via that owner's proxy macaroon).
- POST /default_tribe/:id on the hijacked owner's tribes: because contacts.ts picks `Contact.findOne({isAdmin:true})` as 'the admin', every new user who sets a contact key is auto-joined to the attacker's tribe.
- Because the first registration wins, the legitimate operator can no longer register an admin token for that owner.

In non-proxy mode the pamid routes reject (isProxy false), but the handler still flips isAdmin and plants an adminToken on the single owner, locking the operator out of the admin bootstrap.

Assumption: sphinx-proxy's /generate?sats=N honours the requested amount without an independent cap (its code is outside this repository).

## Evidence
1. [src/controllers/admin.ts:10–38](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/admin.ts#L10-L38)
   swarmAdminRegister takes pubkey and token from the unauthenticated request body, looks up any owner contact by that pubkey and, if that owner has no adminToken yet, stores sha256(token) as the owner's adminToken and sets isAdmin=true. There is no isProxy() gate, no 'no admin exists yet' gate (unlike hasAdmin/initialAdminPubkey), no restriction to the root contact (id 1), and no proof of control of the pubkey.
2. [src/auth.ts:122–144](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L122-L144)
   no_auth() lists '/swarm_admin_register', so ownerMiddleware, hmacMiddleware and proxyAdminMiddleware all skip it: the handler is reachable with no credentials at all.
3. [src/auth.ts:207–227](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L207-L227)
   On later requests an x-admin-token header is hashed and matched against Contact.adminToken; with isAdmin true the contact becomes req.admin (line 270-272). The attacker-registered token therefore authenticates as proxy admin.
4. [src/controllers/index.ts:217–223](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L217-L223)
   Admin routes /add_user, /list_users, /default_tribe/:id, /tribes, /admin_balance are protected only by proxyAdminMiddleware (req.admin.isAdmin && isProxy()), which the forged admin satisfies in proxy mode.
5. [src/controllers/admin.ts:112–143](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/admin.ts#L112-L143)
   addProxyUser asks the sphinx-proxy admin API to create a new sub-node funded with attacker-chosen ?sats= and returns the new contact including its publicKey; listUsers returns every owner contact. Both are reachable by the forged admin.
6. [src/utils/json.ts:37–42](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/json.ts#L37-L42)
   contactToJson strips only authToken and adminToken, so /list_users discloses every tenant's hmacKey, deviceId, pushKitToken, contactKey, personUuid, routeHint and, for unclaimed pre-funded users, the publicKey needed to claim them.
7. [src/controllers/contacts.ts:207–257](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L207-L257)
   generateToken (/contacts/tokens, also no_auth) sets authToken on any owner whose authToken is null given only its pubkey; combined with the pubkeys leaked by /list_users or returned by /add_user the attacker takes over pre-funded virtual nodes.
8. [src/controllers/contacts.ts:351–358](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L351-L358)
   On a new user's first contact_key set, the relay picks Contact.findOne({isAdmin:true}) and auto-joins the user to all defaultJoin tribes using that admin's routeHint; a forged admin and /default_tribe/:id therefore inject attacker tribes into every new signup.

## Impact
Confidentiality: every tenant's contact record including hmacKey, device/push tokens, contactKey and unclaimed account pubkeys, plus the hijacked owner's balances. Integrity: takeover of pre-funded virtual accounts and creation of new ones funded from the root node (theft of operator sats), injection of attacker tribes into every new signup, hijack of the admin identity. Availability: legitimate operator permanently locked out of admin registration for the affected owner; root node balance can be drained into attacker accounts.

## Reproduction steps
1. Remote, unauthenticated attacker reaching the relay's HTTP port (exposed by design). One POST with a publicly known owner pubkey and a chosen token registers the attacker as admin for that owner; subsequent requests carry x-admin-token. No defence mechanism must be bypassed. The high-impact admin routes require the relay to run in proxy/swarm mode (config.proxy_* set), a documented production mode but not the single-user default, hence attack requirements PRESENT.

## Recommended fix
1. swarmAdminRegister grants admin authority to any caller who names an owner pubkey, with no authentication and no proof of control, because the bootstrap-only intent is not enforced in code. Fix criteria: Admin registration must be impossible for an unauthenticated caller except during a provably fresh bootstrap (e.g. only when no admin exists and the target is the root contact with no authToken), or must require a secret the operator provisions (proxy admin token / signed challenge from the owner's node key). After the fix, POSTing an arbitrary owner pubkey and token to /swarm_admin_register on an initialised relay must not set adminToken or isAdmin, and must not work at all outside proxy mode.
2. The admin surface (/list_users, /add_user) exposes per-tenant secrets and allows unbounded funding of new accounts, amplifying any admin credential compromise. Fix criteria: Serialisation of owner contacts for the admin API must omit hmacKey, deviceId, pushKitToken and other per-tenant secrets, and the sats passed to the proxy's generate endpoint must be bounded server-side; verify /list_users output contains no secret fields.

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
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257960

---

# Planted-owner co-tenant installs/uninstalls bots in victim's tribe and makes victim's node pay registry bot

## Details
On a sphinx-proxy multi-owner relay (several isOwner contacts sharing one process and database), a co-tenant A can act as Admin for another tenant V's tribe and drive the MotherBot's install/uninstall writes, and the resulting Lightning payments, onto V's rows.

Step 1 - plant: A calls POST /tribe {uuid: <V's tribe uuid, public on the tribe server>, group_key: 'x', owner_pubkey: <A's own pubkey>}. doJoinTribe (chatTribes.ts:65-131) checks uuid uniqueness only within A's tenant and resolves owner_pubkey to A's own owner contact, so contactIds = [A]; sendMessage is justMe (send.ts:118-123, 165-168) and the success callback runs Chat.create({uuid: V_uuid, ownerPubkey: A, tenant: A}) (167-169). No keysend, no cost.

Step 2 - command: A POSTs /messages {chat_id: <planted id>, text: '/bot install <name>'}. findOrCreateChat is scoped to A's tenant and returns the planted row; sendMessage sees A as tribe owner of its own row (send.ts:96-105, role owner carried into the payload by newmsg at 449). decryptMessage returns the text unchanged because the planted row has no groupPrivateKey (utils/msg.ts:132). isBotMsg finds the planted chat in A's tenant and emits any '/bot ' text to the mother bot (intercept.ts:44-54) with no ChatBot row required; buildBotPayload grants Admin for role owner (bots.ts:526-533). Again justMe - nothing leaves A's relay.

Step 3 - cross-tenant resolution: mother.ts:102/138/155/172 resolve the chat with getTribeOwnersChatByUUID(message.channel.id = V_uuid) (tribes.ts:389-410). The raw JOIN matches both V's genuine row and A's planted row (each pairs with its own owner contact on owner_pubkey = public_key AND id = tenant); there is no ORDER BY and r[0] is used. With the shipped sqlite dialect (config/config.json, every environment) sphinx_chats has no index on uuid, tenant or owner_pubkey (models/sql/chat.ts, migrate.ts), so the planner scans sphinx_chats as the outer loop with a rowid lookup into sphinx_contacts and returns rowid order: V's row, which necessarily predates A's plant (A learns the uuid only after V created the tribe), is returned every time. On Postgres (DB_DIALECT) heap order decides and A retries for free.

Consequences, all executed by the relay as tenant V:
(a) `/bot install <builtin>` -> ChatBot.create({chatId: V.chat, tenant: V}) (mother.ts:117-130): A installs welcome/kick/sentiment/jarvis/spam_gone/ml/badge/git/loopout into V's tribe; 'git' also creates a Bot row with a fresh secret under V's tenant (getOrCreateGitBot(chat.tenant)). Installing 'sentiment' exposes V's relay to the member-level `/sentiment url` SSRF recorded separately.
(b) `/bot uninstall <name>` -> V's ChatBot row destroyed (mother.ts:175-183), erasing V's kick blacklist, ML/jarvis endpoints and keys, welcome text and hidden-command settings.
(c) `/bot install <registry name>`: A first registers a bot on the tribes registry with price_per_use P - via POST /bot from its co-tenant account (bots.ts:54-89 -> declare_bot, owner_pubkey = A's proxy key) or from any other Sphinx relay/node A controls (owner_pubkey = an external node of A's). installBotAsTribeAdmin(V's row, bot_json) (bots.ts:127-203) loads owner = V (tenant from chat.tenant), passes isTribeOwner because V's key equals V's row's ownerPubkey, treats the bot as remote and calls keysendBotInstall -> botKeysend(sender = V) -> signAndSend (no mqttTopic/coTenantDest) -> LND.keysendMessage(opts, V.publicKey) -> loadLightning(true, V) (lightning.ts:438): V's sub-node pays P sats to the bot maker, then ChatBot.create installs the remote bot in V's tribe with pricePerUse P and botMakerPubkey. Thereafter every message in V's tribe starting with '/<name> ' (from A as an ordinary member, or from anyone) is forwarded by V's relay, has no msgTypes (intercept.ts:117-123) and so reaches keysendBotCmd (bots.ts:241-254), which pays max(amount, P) from V's node to the bot maker per message - a repeatable drain of V's Lightning funds with no cap, and the plaintext of those messages (decrypted by V's relay before isBotMsg) travels to A's node in the keysend payload. The owner-pays-own-install case is on record as mother-bot-install-pays-registry-price-uncapped; here the payer is another tenant.
(d) Each reply embed (channel.send -> finalAction -> broadcast) re-resolves the chat through validateAction -> getTribeOwnersChatByUUID (broadcast.ts:27-30), so the 'has been installed!' / 'has been removed' messages are stored under V's tenant and broadcast to V's tribe by V's node.

The same planted-row primitive is on record for other sinks (leaderboard-cross-tenant-planted-owner-pubkey-token-exfiltration, hide-command-null-chatbot-cross-tenant-tribe-row-relay-crash); the tenant-less lookup is on record for the passive direction (tribe-uuid-lookup-without-tenant-leaks-admin-bot-secrets). This record is the attacker-driven install/uninstall/payment path through mother.ts. Single-tenant relays are unaffected; HOSTING_PROVIDER without proxy has one owner and therefore no victim.

## Evidence
1. [src/builtin/mother.ts:102–130](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/mother.ts#L102-L130)
   `/bot install <builtin>` resolves the chat with getTribeOwnersChatByUUID(message.channel.id) and then ChatBot.create({chatId: chat.id, tenant: chat.tenant, ...}); when the returned row is the victim's, the builtin bot is installed into the victim's tribe (for 'git', getOrCreateGitBot(chat.tenant) also creates a Bot row with a fresh secret under the victim's tenant).
2. [src/builtin/mother.ts:138–158](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/mother.ts#L138-L158)
   For a registry (non-builtin) name the same lookup is used and installBotAsTribeAdmin(chat, bot) is called with the victim's Chat row and the registry JSON fetched from tribes_host/bot/<name>.
3. [src/builtin/mother.ts:169–194](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/mother.ts#L169-L194)
   `/bot uninstall <name>` resolves the same way and destroys ChatBot {chatId: chat2.id, botPrefix, tenant: chat2.tenant} - the victim's bot row and all its meta (kick blacklist, ML url/api keys, jarvis url, welcome text, hiddenCommands).
4. [src/utils/tribes.ts:389–409](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L389-L409)
   Raw JOIN of sphinx_chats with the owner contact on owner_pubkey = public_key AND id = tenant AND uuid = '<uuid>'; both the victim's genuine row and a co-tenant's planted row (ownerPubkey = its own owner key, tenant = its own id) satisfy it; no ORDER BY, r[0] is returned.
5. [src/controllers/bots.ts:127–202](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L127-L202)
   installBotAsTribeAdmin takes tenant from chat.tenant, loads that owner (the victim), passes the isTribeOwner check because the victim's key equals the victim row's ownerPubkey, and for a maker pubkey other than the victim calls keysendBotInstall(chatBot, chat_uuid, owner=victim) then ChatBot.create under the victim's chat/tenant with the registry pricePerUse and botMakerPubkey.
6. [src/controllers/bots.ts:269–327](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L269-L327)
   botKeysend signs and sends with `sender` (the victim owner): network.signAndSend(opts, sender) -> LND.keysendMessage(opts, victim.publicKey); amt = Math.max(amount || min) i.e. the registry price as-is; the message content is carried in the keysend payload.
7. [src/grpc/lightning.ts:438–443](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L438-L443)
   keysend selects the proxy client by ownerPubkey (loadLightning(true, ownerPubkey)), so in proxy mode the payment is made from the victim tenant's sub-node, not the attacker's.
8. [src/controllers/bots.ts:241–253](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L241-L253)
   Once a remote bot is installed in the victim's tribe, keysendBotCmd pays Math.max(msg amount, pricePerUse) from `sender` - the victim owner who forwards every member message - to botMakerPubkey for every message starting with the bot prefix.
9. [src/network/intercept.ts:44–53](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/intercept.ts#L44-L53)
   isBotMsg scopes the chat to the sender's tenant (the attacker's planted row) and emits any text starting with '/bot ' to the mother bot without requiring any ChatBot row, so the attacker needs nothing beyond the planted Chat row.
10. [src/network/intercept.ts:117–122](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/intercept.ts#L117-L122)
   Remote bots have no msgTypes, so any tribe member's message beginning with the prefix triggers emitMessageToBot -> keysendBotCmd on the victim's relay.
11. [src/network/send.ts:95–122](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L95-L122)
   isTribeOwner is sender.publicKey === chat.ownerPubkey on the sender's own row, giving the attacker role owner (Admin in buildBotPayload); contactIds [self] makes the send justMe so the command costs nothing and leaves the attacker's relay only via the bot path.
12. [src/utils/msg.ts:132](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/msg.ts#L132)
   decryptMessage returns the message unchanged when the chat has no groupPrivateKey; the planted row (created by doJoinTribe) has none, so the attacker's raw '/bot install <name>' text reaches isBotMsg verbatim.
13. [src/controllers/bots.ts:526–532](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L526-L532)
   Admin role granted whenever msg.sender.role === owner - the only gate mother.ts checks (line 91-92).
14. [src/controllers/chatTribes.ts:65–130](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L65-L130)
   doJoinTribe (POST /tribe) checks uuid uniqueness only within the caller's tenant and stores body uuid and owner_pubkey verbatim; with owner_pubkey = caller's own key, tribeOwner is the caller's own owner contact, contactIds = [self], and the row {uuid: victim uuid, ownerPubkey: attacker, tenant: attacker} is created at 167-169 with no payment.
15. [src/controllers/botapi/broadcast.ts:27–29](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/broadcast.ts#L27-L29)
   Every bot reply (channel.send -> finalAction -> broadcast) re-resolves the chat with validateAction -> getTribeOwnersChatByUUID, so the 'has been installed!' / 'has been removed' embeds are stored under the victim's tenant and broadcast to the victim's tribe members by the victim's node.
16. [src/controllers/bots.ts:54–88](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L54-L88)
   POST /bot lets the attacker tenant register its own bot on the tribes registry with an arbitrary price_per_use and owner_pubkey = its own key (declare_bot, utils/tribeBots.ts:28-68), which getBotByName later returns; a bot registered from any other node the attacker controls works the same way.
17. [src/models/sql/chat.ts:13–14](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/models/sql/chat.ts#L13-L14)
   uuid has no unique or ordinary index (none added in migrate.ts either); with the shipped sqlite dialect (config/config.json, every environment) the unindexed scan of sphinx_chats returns rows in rowid order, i.e. the victim's older row before the attacker's planted one.

## Impact
Integrity HIGH: the relay performs attacker-directed Lightning payments from the victim tenant's node (install price and an uncapped per-message price afterwards) and creates/destroys bot configuration rows under the victim's tenant, including a remote bot of the attacker's choosing wired into the victim's tribe. Confidentiality LOW: messages addressed to the installed remote bot carry plaintext content to the attacker's node, and attacker-installed builtin bots expose member-level configuration (sentiment URL). Availability LOW: the victim's existing bots and their state can be removed and funds drained.

## Reproduction steps
1. Attacker: an authenticated co-tenant owner (threat-model adversary 5) on a sphinx-proxy multi-owner relay (isProxy() true: proxy_lnd_port, proxy_macaroons_dir, proxy_tls_location). Three authenticated HTTP calls - POST /bot (register a priced bot, or register one from any other node the attacker controls), POST /tribe (plant the row, zero cost), POST /messages '/bot install <name>' into the planted chat - and no control stands in the way: the only gate in mother.ts is the Admin role, which the attacker holds on its own row. Deterministic on the shipped sqlite dialect; on Postgres the attacker retries at no cost. Explicit assumptions: (1) sqlite plans the unindexed sphinx_chats as the outer loop with a rowid lookup into sphinx_contacts and so returns rowid order, and sequelize 5.22.5's sqlite dialect emits the BIGINT AUTOINCREMENT primary key as INTEGER PRIMARY KEY (rowid alias); (2) sphinx-bot ^0.2.43's _emit('message') dispatches to every builtin client's MESSAGE handler and channel.send calls the finalAction registered by client.login; (3) for the victim-paid keysend to a bot maker that is itself a co-tenant, sphinx-proxy settles the payment between its own virtual nodes - not needed when the bot maker is an external node of the attacker's, which is the ordinary LN path. AT:P for the multi-tenant deployment.

## Recommended fix
1. mother.ts (and installBotAsTribeAdmin/broadcast) resolve the acting tribe by uuid alone through getTribeOwnersChatByUUID, although the command arrives for a known tenant; with duplicate uuids across tenants the row of another owner is selected and written to or paid from. Fix criteria: Builtin bot handlers act only on the Chat row of the tenant that emitted the message (uuid AND tenant, carried in the bot payload); ChatBot.create/destroy and installBotAsTribeAdmin must never target a chat whose tenant differs from the acting owner. Verify: with a planted row {uuid: V, ownerPubkey: A, tenant: A}, A's '/bot install|uninstall' never creates, destroys or pays on behalf of tenant V, on both sqlite and postgres.
2. doJoinTribe stores a caller-supplied uuid/owner_pubkey pair without verifying it, letting a tenant claim ownership of another tenant's tribe uuid. Fix criteria: POST /tribe rejects an owner_pubkey equal to the caller's own key, rejects uuids already owned by another local owner contact, and verifies the uuid against the tribe server or signed timestamp. Verify: the planting request in the description is refused and creates no Chat row.

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
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258359

---

# Push notification blocked-contact check hard-codes owner id 1, bypassed for other tenants

## Details
sendNotification (src/notify.ts:138-149) is meant to suppress push notifications for 1-1 conversations when the counterparty is blocked. It picks the counterparty with `cids.find((id) => id !== 1)` and loads it with Contact.findOne({ where: { id: notme } }) (no tenant filter), returning early only if `other.blocked`.

The literal 1 is only correct for the root owner that setup.ts creates with id 1. In proxy / multi-tenant deployments every other tenant owner is created by proxy.ts generateNewUser with an auto-increment id and tenant = its own id. Inbound 1-1 messages create the chat with contactIds [owner.id, sender.id] (helpers.ts:311-315), so for tenant N (N != 1) the array is [N, senderId], notme resolves to N — the owner's own contact row, whose blocked flag is never set — and the notification is sent regardless of whether senderId is blocked. (If a tenant's chat ever contained id 1 as the counterpart the check would instead wrongly suppress.)

Contact.blocked has no other consumer in src/: receiveMessage (messages.ts:597) and receivePayment (payment.ts:238) store the message and call sendNotification unconditionally. Result: on a proxy/hosting relay, a Lightning peer the user explicitly blocked (PUT /block/:contact_id) continues to trigger push notifications to the victim's device through hub.sphinx.chat for every message or payment it sends, with 'You have a new message from <alias>' where alias is the stored contact alias (attacker-chosen at first contact unless the user renamed it). The attacker is any Lightning node (unauthenticated to the relay); the only condition is that the victim's tenant id is not 1, which is every user tenant on a proxy relay. Single-tenant relays (owner id 1) are not affected. The same code ships in dist/src/notify.js:101-105.

## Evidence
1. [src/notify.ts:140–146](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/notify.ts#L140-L146)
   Conversation branch: `cids.find((id) => id !== 1)` assumes the owner is contact id 1, and the findOne has no tenant filter. For any owner whose id is not 1 this selects the owner's own row (blocked never set), so `other.blocked` is false and finalNotification runs even when the real counterparty is blocked.
2. [src/helpers.ts:311–315](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L311-L315)
   Inbound 1-1 messages resolve/create the chat with contactIds [owner.id, sender.id] (findOrCreateChatByUUID, lines 219-240 stores them as given), so for tenant N the array is [N, senderId]; find(id !== 1) returns N when N != 1.
3. [src/controllers/messages.ts:597–604](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L597-L604)
   receiveMessage (LN keysend path via receive.ts ACTIONS) stores the message and calls sendNotification(chat, sender.alias, 'message', owner) with no blocked check of its own; payment.ts:238 does the same for direct payments. The only consumer of Contact.blocked in src/ is notify.ts:145.
4. [src/utils/proxy.ts:117–121](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L117-L121)
   In proxy mode each tenant owner is a Contact.create with auto-increment id and tenant set to its own id; only the root owner is id 1 (setup.ts:66-71), so every real user tenant has id != 1 and hits the broken branch.
5. [src/controllers/contacts.ts:787–808](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L787-L808)
   switchBlock/blockContact (PUT /block/:contact_id) set contact.blocked scoped to the owner's tenant; this is the user control the notify path is meant to enforce.

## Impact
Integrity LOW: the user's block decision — the only server-side effect of Contact.blocked — is not enforced for push notifications, so a blocked peer can keep pushing notification text (with its stored alias) to the victim's device. No confidentiality impact on the relay and no availability impact.

## Reproduction steps
1. A blocked Lightning peer (PR NONE, any node on the network) keeps sending 1-1 messages or payments to the victim's pubkey. On a multi-tenant (proxy) relay the victim's owner id is not 1 (AT PRESENT: deployment must be proxy/hosting mode, which is a supported first-class configuration where every user tenant meets the condition), so notify.ts:141 selects the owner's own row and the block check passes. Deterministic, no user interaction.

## Recommended fix
Counterparty selection in sendNotification uses a hard-coded owner id (1) instead of owner.id and loads the contact without a tenant filter. Fix criteria: Select the counterparty as the contactId that is not owner.id, load it scoped to tenant = owner.id, and skip the notification when that contact is blocked; a message from a blocked contact to a tenant whose id is not 1 must produce no call to the hub notify endpoint.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Incorrect authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258355

---

# Builtin hide command dereferences null ChatBot resolved through tenant-less tribe lookup, crashing shared relay

## Details
hideCommandHandler (src/controllers/botapi/hideAndUnhideCommand.ts:14-22) is the shared implementation of the `/welcome hide`, `/git hide`, `/badge hide` and `/callRecording hide` admin commands. It loads ChatBot by { botPrefix, chatId: tribeId } with no tenant filter and dereferences the result (`bot.hiddenCommands`, `bot.update`) without a null check. Every caller derives tribeId from `models.Chat.findOne({ where: { uuid: message.channel.id } })` with no tenant (badge.ts:48, welcome.ts:70, git.ts:79, callRecording.ts:52), discarding the tenant scoping isBotMsg (intercept.ts:44-46, 81-86) had already established. Chat.uuid is neither unique nor indexed (models/sql/chat.ts:13-14; migrate.ts indexes only sphinx_chat_bots/sphinx_chat_members/messages.sender), and on a multi-tenant (proxy / HOSTING_PROVIDER) relay every tenant that joined a tribe holds its own row with that uuid, so Sequelize's `LIMIT 1` without ORDER BY may return another tenant's row. Its id has no ChatBot for the acting tenant's bot, the lookup returns null and `bot.hiddenCommands` throws; if that tenant does have the bot, `bot.update({hiddenCommands})` rewrites the other tenant's bot configuration. welcome.ts, git.ts and badge.ts have no try/catch around the call (callRecording.ts:49/537 does), and the handler runs as a detached sphinx-bot listener fired from setTimeout (builtin/index.ts:31-35), so the throw is an unhandled rejection; the tree registers no unhandledRejection/uncaughtException handler (app.ts:170-180 only has commented-out hooks) and the node:16 image exits, taking down every tenant served by the process until supervisord (docker/relay_supervisor.conf autorestart=true) restarts it.

Attacker-driven route (co-tenant, adversary 5). The Admin role in builtin bot payloads is granted whenever msg.sender.role is owner (bots.ts:526-533), which network.sendMessage sets whenever `sender.publicKey === chat.ownerPubkey` on the sender's own row and the message is not forwarded (send.ts:96-106; newmsg carries role at 449). Tenant A: (a) POST /tribe (controllers/index.ts:234 -> doJoinTribe, chatTribes.ts:44-183) with uuid = a tribe uuid some co-tenant already holds a row for (public tribes are listed on the tribe server), owner_pubkey = A's own pubkey, any group_key: nothing is verified (comment at line 81 'verify signature here?'); tribeOwner resolves to A's own owner contact (owner contacts have tenant == id, contacts.ts:190-193), contactIds is [A], sendMessage short-circuits as justMe (send.ts:118-123, 165-168) and the success callback creates {uuid, ownerPubkey: A, tenant: A} with no groupPrivateKey (165-177). (b) POST /messages (controllers/index.ts:229) with chat_id = the planted row and text `/bot install badge`: findOrCreateChat scopes by {id, tenant} (helpers.ts:21-24), isTribeOwner is true, decryptMessage passes plaintext through because the row has no groupPrivateKey (utils/msg.ts:132), isBotMsg emits any '/bot ' text to MotherBot (intercept.ts:51-53), which with the Admin role creates a '/badge' ChatBot (msgTypes [message, boost, direct_payment]) on the chat returned by getTribeOwnersChatByUUID (mother.ts:95-130; tribes.ts:389-406 joins owner_pubkey to the tenant's own owner contact, so when the real tribe owner is not a co-tenant only A's row matches). POST /add_badge or /create_badge (personal.ts:473-481, 528 / 310-329 -> utils/badgeBot.ts) is an alternative that additionally needs a Badge row minted via the boltwall server. (c) POST /messages into the planted chat with text `/badge hide types`: isBotMsg finds A's chat and '/badge' ChatBot (tenant-scoped) and emits (intercept.ts:92-111, 142-145); badge.ts:44-53 sees author.bot '/badge', Admin role, cmd 'hide', but resolves `tribe` by uuid alone and gets the co-tenant's older row (SQLite: lowest rowid of an un-indexed equality scan; Postgres: heap order, so A repeats); hideCommandHandler then loads ChatBot {'/badge', chatId: victimChatId}. If the victim has no badge bot (members never do), the null dereference kills the relay for all tenants, repeatable after every restart and with any other public tribe uuid; if the victim does have it, A's `bot.update({ hiddenCommands })` (lines 19-21, 31-33) rewrites the victim's bot configuration. This is distinct from the verified tribe-uuid-lookup-without-tenant-leaks-admin-bot-secrets (send.ts:577, interceptTribeMsgForHiddenCmds: victim's own command landing on the attacker's row, wrapped in try/catch).

Passive route: on Postgres the victim's own routine `/welcome|/git|/badge hide <cmd>` can resolve to a co-tenant member's row once heap order changes after updates to the owner's row, and the same null dereference fires without any action by the co-tenant beyond having joined.

Assumptions (dependencies not present in the checkout): Sequelize 5.22.5 findOne emits `LIMIT 1` without ORDER BY; SQLite returns rows of an un-indexed equality scan in rowid order; sphinx-bot 0.2.43 (package-lock) Client.on/_emit is a plain EventEmitter that neither awaits nor catches listener promises; node:16 (Dockerfile) defaults to --unhandled-rejections=throw.

## Evidence
1. [src/controllers/botapi/hideAndUnhideCommand.ts:14–21](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/hideAndUnhideCommand.ts#L14-L21)
   hideCommandHandler looks up ChatBot by { botPrefix, chatId: tribeId } with no tenant and no null check, then reads bot.hiddenCommands and calls bot.update(). When tribeId names a Chat row of another tenant the lookup returns null and the dereference throws inside an async sphinx-bot listener nobody awaits; when it returns the other tenant's ChatBot, bot.update() rewrites that tenant's hiddenCommands.
2. [src/builtin/badge.ts:48–53](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/badge.ts#L48-L53)
   tribe is resolved with models.Chat.findOne({ where: { uuid: message.channel.id } }) and no tenant filter; the Admin check that follows only tests message.member.roles.
3. [src/builtin/badge.ts:194–203](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/badge.ts#L194-L203)
   The hide branch passes tribe.id (possibly another tenant's chat id) into hideCommandHandler with no try/catch around it; welcome.ts:97-106 and git.ts:160-169 are identical. callRecording.ts:365-374 is the sibling that wraps the same call in try/catch (537-539) and merely logs.
4. [src/builtin/welcome.ts:68–72](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/welcome.ts#L68-L72)
   Same tenant-less Chat.findOne({uuid}) feeding hideCommandHandler at 98-105 with no error handling.
5. [src/builtin/git.ts:77–81](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/git.ts#L77-L81)
   Same tenant-less Chat.findOne({uuid}) feeding hideCommandHandler at 161-168 with no error handling.
6. [src/network/send.ts:95–106](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L95-L106)
   isTribeOwner is simply sender.publicKey === chat.ownerPubkey on the sender's own Chat row, and for a non-forwarded message theSender.role is set to chat_roles.owner. A tenant that holds a Chat row naming its own pubkey as ownerPubkey is therefore 'tribe owner' of that row regardless of who really owns the uuid.
7. [src/controllers/bots.ts:519–533](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L519-L533)
   buildBotPayload grants the Admin role to the bot message whenever msg.sender.role === owner, i.e. whenever the sending tenant is isTribeOwner of its own row. Forwarded member messages are built with role reader (receive.ts:481-497), so only a tenant acting as owner of some row reaches the Admin branches.
8. [src/network/intercept.ts:44–46](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/intercept.ts#L44-L46)
   isBotMsg scopes the Chat and the ChatBot lookups (81-86) to the sender's tenant and then emits to the builtin bot (142-145); the builtin handlers throw that tenant scoping away by re-resolving the tribe by uuid alone.
9. [src/builtin/index.ts:31–35](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/index.ts#L31-L35)
   builtinBotEmit fires SphinxBot._emit from a setTimeout callback; the listener's returned promise is detached from every caller, so a throw inside the handler is an unhandled rejection.
10. [src/controllers/chatTribes.ts:44–130](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L44-L130)
   doJoinTribe (authenticated POST /tribe, controllers/index.ts:234) stores body.uuid and body.owner_pubkey verbatim into a Chat row under the caller's tenant with no verification against the tribe server or the owner_pubkey's signature (comment at line 81: 'verify signature here?'). With owner_pubkey equal to the caller's own pubkey, tribeOwner resolves to the caller's own owner contact (owner contacts have tenant == id, contacts.ts:193), contactIds is [caller], sendMessage short-circuits as justMe and the row is created (165-169).
11. [src/controllers/api/personal.ts:473–480](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/api/personal.ts#L473-L480)
   addBadgeToTribe (POST /add_badge) matches the chat by id + ownerPubkey == req.owner.publicKey + tenant, which the planted row satisfies, and calls createBadgeBot(tribe.id, tenant) at line 528 (createBadge does the same at 310-329), giving the caller a '/badge' ChatBot for the planted row and so making isBotMsg emit '/badge' messages for it. mother.ts '/bot install badge|welcome|git' (102-130) is an alternative that depends on getTribeOwnersChatByUUID row order.
12. [src/utils/badgeBot.ts:4–22](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/badgeBot.ts#L4-L22)
   createBadgeBot creates the builtin '/badge' ChatBot row with msgTypes including message type 0 for the given chatId/tenant.
13. [src/models/sql/chat.ts:13–14](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/models/sql/chat.ts#L13-L14)
   uuid is a plain column: no unique constraint and no index (migrate.ts creates indexes only on sphinx_chat_bots and sphinx_chat_members), so several tenants legitimately hold rows with the same uuid and findOne's LIMIT 1 without ORDER BY picks whichever the engine scans first.
14. [app.ts:168–179](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L168-L179)
   No process.on('unhandledRejection') or uncaughtException handler is registered anywhere in the tree (only commented-out SIGTERM/exit hooks), so on the node:16 image the rejection terminates the process.

## Impact
Availability HIGH: the unhandled rejection terminates the single relay process that serves every tenant (HTTP, socket.io, MQTT, invoice handling); supervisord restarts it but the attacker can repeat the crash at will. Integrity LOW: when the victim tenant has the bot installed, the attacker's update writes an attacker-chosen hiddenCommands list onto the victim's ChatBot, changing which of the victim's admin commands are suppressed. Confidentiality NONE.

## Reproduction steps
1. Attacker is an authenticated co-tenant on a proxy/hosting relay (PR:L) using only ordinary owner routes over the network: POST /tribe with a public tribe uuid and its own pubkey as owner_pubkey, POST /messages `/bot install badge` (or POST /add_badge) to get a builtin ChatBot on the planted row, then POST /messages `/badge hide types`. No shipped control has to be defeated and the planted row needs no signature or tribe-server check (AC:L). Requires a multi-tenant deployment and a uuid some co-tenant already holds a row for, and relies on findOne row order (deterministic on SQLite, repeatable on Postgres and across many public tribe uuids) (AT:P). No victim interaction (UI:N).

## Recommended fix
1. hideCommandHandler and determineOwnerOnly's sibling callers dereference a ChatBot lookup result that can be null, inside detached async bot listeners with no error handling, so a missing row becomes a process-terminating unhandled rejection. Fix criteria: A missing ChatBot (or missing tribe) makes the handler return or reply with an error; welcome/git/badge handlers (like callRecording) catch and log exceptions, and the process registers an unhandledRejection handler so no bot handler can exit the relay. Verify: `/badge hide types` in a chat whose ChatBot lookup returns null produces a logged error and the process keeps serving.
2. Builtin bots re-resolve the tribe with Chat.findOne({uuid}) and no tenant, discarding the tenant scoping isBotMsg already established, so another tenant's Chat/ChatBot rows can be read and written. Fix criteria: The tribe used by every builtin handler is the row of the tenant on whose behalf the message was emitted (uuid AND tenant, or passed through the bot payload); verify that with two tenants holding the same uuid, a hide command from tenant A can neither read nor update tenant B's ChatBot and never yields a null row for A's own installed bot.
3. doJoinTribe accepts any uuid/owner_pubkey pair, letting a tenant mint a Chat row for which it is 'tribe owner' under another tribe's uuid and thereby obtain the Admin role in builtin bot payloads for that uuid. Fix criteria: Joining requires that owner_pubkey be verifiable for the uuid (signed-timestamp check or tribe-server lookup) and that owner_pubkey differ from the joiner's own key; verify a POST /tribe naming the caller as owner of an existing tribe uuid is rejected.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** IDOR
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258353

---

# Unauthenticated GET /info loopback check is satisfied by any request through the documented localhost reverse proxy

## Details
GET /info is exempted from authentication (src/auth.ts no_auth, line 128) and is protected only by details.getNodeInfo's check that the TCP peer address (req.connection.remoteAddress) contains '127.0.0.1' or 'localhost'. The handler never consults X-Forwarded-For / req.ip, and app.ts only sets 'trust proxy' for the rate limiter (app.ts:97), which does not change remoteAddress. The project's own bare-metal deployment guides (docs/linux_deployment.md nginx at line 268 and Apache at 186-187, docs/raspiblitz_deployment.md:183, docs/myNode_deployment.md:201) tell users to front the relay with nginx/Apache on the same machine using proxy_pass http://localhost:3001. Behind that proxy every request, including from arbitrary Internet clients, arrives with remoteAddress 127.0.0.1 or ::ffff:127.0.0.1 (both contain '127.0.0.1'), so the check is satisfied and /info becomes a fully unauthenticated endpoint. (If the proxy resolves 'localhost' to ::1 the peer is '::1' and that attempt is refused; with the usual dual-stack /etc/hosts nginx round-robins both addresses, so the attacker simply retries.)

An anonymous attacker then obtains the node's financial and topology state: identity pubkey and route hint, public IP, the complete open channel list with local/remote balances, capacities, sats sent/received, pending HTLCs and peer pubkeys, pending channels, total local balance, non-zero fee policies, chain/graph sync state, LND and relay versions, whether the relay is still 'clean' (unclaimed) and the timestamp of the latest message. In proxy/hosting mode the same data describes the hosting provider's root node. None of this is conceded to unauthenticated clients by any sanctioned path: the unauthenticated /connect page exposes only booleans (channelIsOpen, channelFeesBaseZero, hasRemoteBalance, isSignedUp) and /peered a per-pubkey peer/channel_point oracle; the full nodeinfo is otherwise sent only to hub.sphinx.chat (src/hub.ts:141) or to the authenticated owner via /getinfo and /channels.

The finding holds for the documented same-host reverse-proxy deployments (Linux, Raspiblitz, myNode guides). Where the relay port is forwarded directly (docs/docker_deployment.md) or the proxy runs in a separate container (swarm/traefik), remoteAddress is the real client or container-network address and the check does refuse the request. The root cause is an access decision based on the immediate TCP peer's IP address, a property any local reverse proxy confers on every client. Ledger item e2-route2-no-tenant's /info portion is concluded here.

## Evidence
1. [src/controllers/details.ts:205–216](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/details.ts#L205-L216)
   getNodeInfo is the only guard for GET /info: it accepts the request if req.connection.remoteAddress (the raw TCP peer, unaffected by Express 'trust proxy' or X-Forwarded-For) contains the substring '127.0.0.1' or 'localhost', then returns the full nodeinfo() object as JSON.
2. [src/auth.ts:122–144](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L122-L144)
   /info is in the no_auth list (line 128), so ownerMiddleware performs no token check and the remoteAddress test is the sole access control.
3. [src/controllers/index.ts:146](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L146)
   Route registration: app.get('/info', details.getNodeInfo) on the same Express app the public port serves (app.ts:164 server.listen(port) with no host binding).
4. [src/utils/nodeinfo.ts:110–156](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/nodeinfo.ts#L110-L156)
   nodeinfo() returns identity pubkey, route hint, public IP, every open channel (interfaces.Channel: remote_pubkey, channel_point, capacity, local/remote balance, sats sent/received, pending HTLCs, private flag), pending channels, total/largest balances, non-zero fee policies, chain/graph sync state, LND version, relay commit/tag, 'clean' (unclaimed) state and last message timestamp.
5. [docs/linux\_deployment.md:262–269](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/docs/linux_deployment.md#L262-L269)
   The project's Linux deployment guide installs nginx on the same host with proxy_pass http://localhost:3001 (the Apache variant at lines 186-187 uses ProxyPass / http://localhost:3001/); docs/raspiblitz_deployment.md:183 and docs/myNode_deployment.md:201 prescribe the same same-host nginx topology. Every Internet request therefore reaches the relay from a loopback peer.

## Impact
Disclosure of the node's balances, channel partners, pending channels, public IP, versions and activity timestamps to anyone (confidentiality LOW: sensitive financial metadata but no secrets or credentials). No integrity or availability impact.

## Reproduction steps
1. An unauthenticated Internet client sends GET /info to the public hostname. When the relay sits behind a same-host reverse proxy (the documented setup) the loopback check passes and the full node info is returned. No credentials, no interaction; the requirement is that deployment topology.

## Recommended fix
Access control for an unauthenticated route relies on the immediate TCP peer being loopback, a property any local reverse proxy confers on every client. Fix criteria: /info must require owner (or admin) authentication, or be bound to a separate local-only listener rather than inferred from remoteAddress; verify that an unauthenticated request via the documented nginx configuration is rejected and that the sensitive channel/balance fields are never returned without credentials.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Authentication Bypass
**CWE:** [CWE-291](https://cwe.mitre.org/data/definitions/291.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258195

---

# Nonexistent chat/contact ids in kick, add-members, create-group and delete-chat crash the relay

## Details
Four authenticated chat routes in src/controllers/chats.ts assume their database lookups succeed. kickChatMember (PUT /kick/:chat_id/:contact_id) runs Chat.findOne({id, tenant}) and immediately reads chat.contactIds (line 97); addGroupMembers (PUT /chat/:id) does the same at line 451; createGroupChat (POST /group) iterates body.contact_ids with the awaiting asyncForEach helper (src/helpers.ts:381-388) and reads contact.publicKey on each Contact.findOne result (line 327). A nonexistent id — e.g. PUT /kick/999999/1 — yields null and a TypeError inside the async handler, i.e. a rejected promise. deleteChat (DELETE /chat/:id) additionally fires tribes.delete_tribe(chat.uuid, owner.publicKey) from sendMessage's success callback (line 512) without await or catch; delete_tribe (src/utils/tribes.ts:567-590) rethrows on any non-2xx tribe-server response or fetch error. Re-issuing DELETE on an already-deleted owned tribe (row persists with uuid '' and contactIds '[]', so sendMessage skips the loop and calls success at send.ts:298) sends DELETE https://<tribes host>/tribe/?token=..., which the tribe server will not answer 2xx, so the dangling promise rejects.

Express 4.18.2 does not route async-handler rejections to error middleware, app.ts installs no process-level unhandledRejection/uncaughtException handler (only commented-out SIGTERM/exit stubs at lines 170-180), and the image runs plain `node /relay/dist/app.js` on node:16 whose default --unhandled-rejections=throw terminates the process. The shipped dist/src/controllers/chats.js (lines 94, 295, 393, 453) contains the same code.

In a single-owner relay the caller only kills their own service. In proxy / HOSTING_PROVIDER multi-tenant deployments (threat model adversary 5) every owner authenticates with their own x-user-token into one shared process, so one tenant terminates the relay — HTTP, socket.io, LND and MQTT subscriptions — for every other tenant with a single request, and can repeat it after each supervisor restart (docker/relay_supervisor.conf autorestart). The impact holds only where the relay hosts more than one owner.

## Evidence
1. [src/controllers/chats.ts:94–97](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L94-L97)
   kickChatMember: Chat.findOne({id: chatId, tenant}) result is dereferenced at line 97 (chat.contactIds) with no null check; PUT /kick/<unknown>/<n> throws a TypeError inside the async Express handler.
2. [src/controllers/chats.ts:447–451](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L447-L451)
   addGroupMembers: Chat.findOne({id, tenant}) result dereferenced at line 451 (chat.contactIds) without a null check; PUT /chat/<unknown> throws.
3. [src/controllers/chats.ts:323–330](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L323-L330)
   createGroupChat: for every body.contact_ids entry Contact.findOne may return null and contact.publicKey is read at line 327; asyncForEach awaits the callback so the TypeError rejects the handler promise. POST /group with an unknown id throws.
4. [src/helpers.ts:381–387](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/helpers.ts#L381-L387)
   asyncForEach awaits each callback, so a rejection inside the createGroupChat/addGroupMembers loops propagates to the route handler's returned promise.
5. [src/controllers/chats.ts:506–518](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L506-L518)
   deleteChat invokes tribes.delete_tribe inside sendMessage's success callback without await or catch (line 512); the returned promise is dropped, so any rejection is unhandled.
6. [src/utils/tribes.ts:567–589](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L567-L589)
   delete_tribe throws on !r.ok and rethrows fetch errors; nothing upstream handles the promise. Re-deleting an owned tribe whose uuid is now '' sends DELETE /tribe/?token=... which the tribe server does not answer 2xx.
7. [src/network/send.ts:294–299](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L294-L299)
   With contactIds '[]' the send loop does not run, `no` stays null and success() is invoked, which is what fires the un-awaited delete_tribe on a re-delete.
8. [app.ts:170–180](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L170-L180)
   The only process.on handlers in the bootstrap are commented out; no unhandledRejection or uncaughtException handler exists anywhere in app.ts or src/, and routes are registered directly (controllers.set) without an async wrapper.
9. [Dockerfile:1–42](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L1-L42)
   Image is node:16-buster-slim running `node /relay/dist/app.js` with no --unhandled-rejections flag; Node 16's default mode terminates the process on an unhandled rejection. Express 4.18.2 (lockfile) does not catch async handler rejections.

## Impact
The whole relay process exits: HTTP API, socket.io, LND gRPC subscriptions and MQTT tribe connections stop for every tenant hosted on it, and the attacker can repeat the request after each supervisor restart. No confidentiality or integrity effect.

## Reproduction steps
1. Any owner holding a valid x-user-token (ownerMiddleware, src/auth.ts:208-215) sends PUT /kick/<nonexistent id>/1, PUT /chat/<nonexistent id>, POST /group with an unknown contact_id, or re-issues DELETE /chat/:id on an owned, already-deleted tribe. The null dereference is deterministic and needs no timing or secondary data. Cross-tenant impact requires the relay to be deployed in proxy / HOSTING_PROVIDER multi-tenant mode (attack requirement present); the attacker's privilege is that of an ordinary tenant. Assumptions: node:16 default --unhandled-rejections=throw; express 4.18.2 does not forward async rejections to error middleware.

## Recommended fix
1. Handlers dereference findOne results without checking for null and fire async helpers that throw without handling their promises. Fix criteria: kickChatMember, addGroupMembers, createGroupChat and deleteChat must return a 4xx failure when the chat/contact is not found, and delete_tribe's promise must be awaited inside try/catch. Verify that requests with unknown ids return an error response and the process keeps running.
2. No process-level containment for async Express handler rejections. Fix criteria: Route handlers should be wrapped so rejections become error responses, and a global unhandledRejection handler should log rather than allow process exit. Verify a deliberately throwing handler does not terminate the relay.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** NULL pointer dereference
**CWE:** [CWE-476](https://cwe.mitre.org/data/definitions/476.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258188

---

# ML bot binds pending replies to a bare process_id, so anyone can spoof model responses via unauthenticated POST /ml

## Details
When a tribe member talks to a model, MlBot POSTs the message to the admin-configured model URL and advertises `${host_name}/ml` as the webhook (src/builtin/ml.ts:175-187). It then stores a closure in the module-level CALLBACKS object under the process_id the ML service returned (ml.ts:206-218) for up to 15 minutes. The closure trusts whatever string it is handed: for kind 'text' it becomes the embed description, for kind 'image' it becomes the image URL, and the embed is sent to the requesting member (setOnlyUser) under the ML bot's name.

The callback side, processMlCallback (src/controllers/botapi/index.ts:339-357), is mounted at POST /ml and listed in no_auth (src/auth.ts:142). It performs no authentication at all: no shared secret, HMAC over the body, source binding or tenant check — unlike the sibling bot entry points POST /action (bot secret or HMAC, index.ts:185-195) and POST /webhook (GitHub HMAC, index.ts:96-100). The only thing standing between an Internet client and the member's chat is knowledge of a live process_id, a value chosen by the external ML service and never designed as a secret. Anyone who learns or guesses one (sequential or short identifiers, a leak in the ML service, or a man-in-the-middle on a plain-http model URL) can:

- deliver arbitrary text/HTML to the member as the trusted ML bot (phishing, fake instructions, spoofed answers);
- for image-kind models, make the member's client load an attacker URL, disclosing the member's IP/user agent;
- suppress the genuine answer, because the closure deletes itself on first use.

This is the registry half of the problem. The existing record ml-callback-prototype-process-id-unhandled-exception-crash covers the crash caused by inherited property names at the same handler and notes the spoofing in passing, but its remediations (own-property check, rejection handling) do not add authentication, so the spoofing defect remains after that fix. Reachability requires an installed ML bot with a configured model and a pending request (15-minute window), hence attack_requirements PRESENT.

Assumption: sphinx-bot ^0.2.43 routes `channel.send({embed})` back to finalAction as a broadcast carrying only_user, as the rest of the builtin bots rely on.

## Evidence
1. [src/builtin/ml.ts:205–222](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/ml.ts#L205-L222)
   The pending reply is registered in CALLBACKS keyed solely by the process_id the ML service returned; the closure accepts any msg and posts it to the requesting member as the bot (setDescription for text, setImage URL for image), then deletes itself. No per-request secret, signature or origin binding is stored.
2. [src/builtin/ml.ts:175–186](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/ml.ts#L175-L186)
   The relay advertises `${host_name}/ml` as the webhook to the ML service with no token or HMAC key, so the service has nothing to prove its identity with on callback.
3. [src/controllers/botapi/index.ts:339–357](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/botapi/index.ts#L339-L357)
   processMlCallback takes process_id and response from the raw body and invokes the registered closure with no authentication; contrast processAction (185-195) and processWebhook (96-100), which verify a bot secret or HMAC.
4. [src/auth.ts:142](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L142)
   /ml is in no_auth, so ownerMiddleware lets unauthenticated Internet clients reach the handler.
5. [src/builtin/utill/ml.ts:245](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/utill/ml.ts#L245)
   The ML bot's own embed descriptions carry HTML (<br/>, <strong> here and at src/builtin/ml.ts:146), showing the Sphinx client renders bot embed descriptions as markup; a spoofed description delivered through the same embed path is rendered the same way.

## Impact
Integrity: attacker-chosen text/HTML or image URL is delivered to a tribe member under the trusted bot identity and the genuine model answer is dropped. Confidentiality: an image-kind spoof makes the member's client fetch an attacker URL, revealing the member's network address. No availability impact from this path (the crash path is a separate record).

## Reproduction steps
1. An Internet client POSTs {"body":{"process_id":"<id>","response":"<payload>"}} to the relay's /ml route, which src/auth.ts:142 exempts from authentication. processMlCallback (src/controllers/botapi/index.ts:339-357) checks nothing but the presence of the two fields and invokes the closure registered under that process_id; the closure (src/builtin/ml.ts:206-218) sends the payload to the requesting member as MlBot and deletes itself, so the genuine answer is also dropped. No credential is required (PR:N). The attacker must, however, hold a live process_id: it is chosen by the admin-configured external model service, lives at most 15 minutes (ml.ts:220-222), and the relay gives no oracle — /ml returns {ok:true} whether or not a callback matched — so it must be obtained out of band (observing plain-http model traffic, a leak or predictable scheme on the service side); the repository does not reveal its format, hence AC:HIGH. Deployment preconditions outside the attacker's control (AT:PRESENT): the tribe admin has installed the ML bot and configured a model url/api_key, config.host_name is set (ml.ts:166-170; not shipped in config/app.json), and a member request is pending.

## Recommended fix
1. The webhook contract between relay and ML service carries no authenticator: the relay registers callbacks by a service-chosen process_id alone and accepts any POST /ml naming it, so possession of the identifier equals authority to answer. Fix criteria: Each outbound ML request carries (or the bot configuration holds) a per-model or per-request secret, and processMlCallback only invokes a callback when the request proves possession of it (e.g. HMAC over the raw body as /action and /webhook already do, or an unguessable per-request token included in the webhook URL). Verify that a POST /ml with a valid process_id but no/invalid authenticator is rejected and nothing is sent to the member.
2. Attacker-influenced response strings are rendered as bot embed description/HTML or as an image URL without constraint. Fix criteria: Text responses are escaped or restricted to a safe markup subset before being placed in the embed, and image responses are required to be https URLs on hosts the admin configured; verify that a response containing markup or a non-allowlisted image host is neutralised.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Missing authentication
**CWE:** [CWE-306](https://cwe.mitre.org/data/definitions/306.html)
**Attack vector:** NETWORK
**Attack complexity:** HIGH
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258186

---

# Un-awaited invite payment promise crashes the shared relay on any failed invite payment

## Details
hub.ts payInviteInvoice (288-295) does `const res = Lightning.sendPayment(invoice, pubkey); onSuccess(res)` without awaiting the promise. When the payment fails - the invite has no invoice yet (dbInvite.invoice undefined), the invoice is already paid or expired, there is no route, or the tenant's sub-node lacks liquidity - sendPayment rejects (lightning.ts:326-372 reject on payment_error / stream error / gRPC error) and nothing handles the rejection. Under node:16 (Dockerfile) the default unhandled-rejection mode is `throw`, and app.ts registers no handler, so the relay process exits.

Entry point: POST /invites/:invite_string/pay (invites.ts:36-88), reachable by any authenticated owner. The caller needs an Invite row of its own (created through POST /invites against the hub, which production config enables); the invoice field is whatever the hub last synced, and an invite that is pending has none. The HTTP response is already 200 {success:true} because onSuccess runs with the Promise object (response.payment_error is undefined), so the client sees success while the process dies moments later.

In single-tenant deployments the owner only takes down their own relay. In proxy / HOSTING_PROVIDER deployments one tenant's request terminates the relay serving every tenant (and every in-flight payment), which crosses the tenant boundary; the finding is conditioned on multi-tenant deployment for its availability impact. A supervisor may restart the process, but the trigger is repeatable at will. Ledger item dismissed-invites-78-f7bc considered only the early success report, not the crash.

## Evidence
1. [src/hub.ts:288–295](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/hub.ts#L288-L295)
   payInviteInvoice calls Lightning.sendPayment(invoice, pubkey) without await or .catch and passes the pending Promise to onSuccess. The surrounding try/catch cannot observe a rejection of the un-awaited promise, so any payment failure becomes an unhandled promise rejection. This is where the fix belongs.
2. [src/controllers/invites.ts:36–87](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invites.ts#L36-L87)
   POST /invites/:invite_string/pay (any authenticated owner/tenant) looks up the caller's own Invite row and hands dbInvite.invoice (possibly undefined when the hub has not yet attached an invoice, or an already-paid/expired invoice) to payInviteInvoice; onSuccess reads response.payment_error off the Promise object and reports success.
3. [src/grpc/lightning.ts:314–375](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L314-L375)
   sendPayment rejects on payment_error, on stream error, and on gRPC err for the proxy/GL/CLN branches, so an unpayable or empty payment_request deterministically produces a rejected promise.
4. [Dockerfile:23](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L23)
   The shipped image (second stage FROM node:16-buster-slim, CMD node /relay/dist/app.js at line 42) runs on Node 16, whose default --unhandled-rejections mode is 'throw' (assumption on the node:16 runtime: an unhandled rejection with no 'unhandledRejection' listener is raised as an uncaught exception and terminates the process). A repository-wide search finds no process.on('unhandledRejection') or 'uncaughtException' handler, and neither the Dockerfile CMD nor the npm 'prod' script passes NODE_OPTIONS to change the mode.

## Impact
Process termination of the relay shared by all tenants; no data disclosure or modification beyond lost in-flight state.

## Reproduction steps
1. An authenticated tenant on a shared (proxy/hosting) relay creates an invite via POST /invites, then calls POST /invites/<pin>/pay while the invite has no invoice (or re-pays a settled one). sendPayment rejects, the rejection is unhandled, and node:16 terminates the process for all tenants. Deterministic; requires only ordinary tenant credentials and the multi-tenant deployment condition.

## Recommended fix
1. payInviteInvoice discards the promise returned by Lightning.sendPayment, so payment failures surface as unhandled rejections instead of being reported to the caller. Fix criteria: The invite payment result is awaited (or chained with a rejection handler) and failures are returned to the HTTP caller; verify that paying an invite with no or an invalid invoice yields an error response and the process keeps running.
2. The process has no global unhandledRejection handler, so any stray rejection in request handlers terminates a relay shared by many tenants. Fix criteria: A process-level unhandledRejection handler logs and survives stray rejections; verify by triggering a rejected un-awaited promise and confirming the service remains available.

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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258185

---

# Proxy tenant can open channels from the provider's root on-chain wallet via /gen_channel

## Details
connect.ts genChannel (141-164) is the connect-UI helper meant for a single owner to open their first channel to Sphinx's routing node: it reads `amount` from req.body and calls Lightning.connectPeer then Lightning.openChannel({node_pubkey: <hard-coded Sphinx node>, local_funding_amount: amount, push_sat: round(amount*0.02), sat_per_byte}). connectPeer and openChannel call loadLightning() with no owner pubkey (lightning.ts:1043, 1093), which is the cached root LND client built from config.lnd_port with the root admin macaroon (lightning.ts:117-142, 175-184). In proxy mode that is the hosting provider's node and on-chain wallet, not the tenant's sub-node.

The route is registered at app.ts:137 whenever config.connect_ui is truthy and is protected only by ownerMiddleware (not in auth.ts no_auth). genChannel never inspects req.owner, is not behind proxyAdminMiddleware (which gates the other proxy-admin operations, controllers/index.ts:217-223), and the relay's own channel-opening flow is explicitly disabled on proxy (queries.ts:177). Any authenticated tenant can therefore make the provider's root node connect to the Sphinx routing node and fund a channel of tenant-chosen size from the provider's on-chain balance, pushing 2% of it to the remote side as an unrecoverable gift and paying chain fees at up to 250 sat/vB. The handler answers 'ok' or silently logs, with no record tying the open to the tenant.

Mechanics note: both awaits share one try block. LND's ConnectPeer returns an error when the node is already connected to that peer (assumption about LND behaviour; this repository pins no LND version, the lnrpc proto is upstream), in which case the catch logs and openChannel is skipped. The open therefore succeeds when the root node is not currently connected to 023d70f2...; once a channel exists LND keeps that peer connected, so further opens need a disconnection window. The unauthenticated GET /peered (connect.ts:99) reports exactly that peer's connection state, letting a tenant time the call. A single call can still commit the whole spendable on-chain balance.

Conditions: the finding applies only where connect_ui is enabled on a multi-tenant (proxy_* configured, LND) relay; in single-tenant mode the caller is the owner spending their own funds, which is the intended onboarding flow, and on Greenlight/CLN openChannel is a no-op. The repository ships connect_ui in its sample configs but does not settle whether hosting operators enable it, so the finding is filed with that condition.

## Evidence
1. [src/utils/connect.ts:141–164](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/connect.ts#L141-L164)
   genChannel reads `amount` from req.body, never consults req.owner (no admin/tenant check), and calls Lightning.connectPeer then Lightning.openChannel with local_funding_amount = amount and push_sat = 2% of it toward the hard-coded Sphinx routing node. Both awaits share one try; if connectPeer rejects (LND returns an error when already connected to that peer) the catch only logs and openChannel is skipped, so the open proceeds when the root node is not currently connected to that pubkey.
2. [app.ts:135–140](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L135-L140)
   POST /gen_channel is registered whenever config.connect_ui (or env CONNECT_UI) is set. It is not in the auth.ts no_auth list, so ownerMiddleware admits any authenticated owner token; in proxy mode every tenant is an isOwner Contact with its own authToken.
3. [src/grpc/lightning.ts:117–141](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L117-L141)
   loadLightning only selects a per-owner proxy client when tryProxy && isProxy() && ownerPubkey; with no arguments it returns the cached root client built from config.lnd_port and loadCredentials() (root admin macaroon).
4. [src/grpc/lightning.ts:1035–1108](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L1035-L1108)
   connectPeer and openChannel both call loadLightning() with no owner pubkey and issue connectPeer / openChannelSync on the root LND, i.e. the hosting provider's on-chain wallet; there is no per-tenant wallet selection on this path.
5. [src/controllers/index.ts:217–223](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L217-L223)
   Operations reserved to the proxy admin are gated by proxyAdminMiddleware (pamid); /gen_channel, which moves root-wallet funds, is registered in app.ts without that gate.
6. [src/controllers/queries.ts:177–178](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/queries.ts#L177-L178)
   pollUTXOs, the relay's own channel-opening flow, is explicitly disabled in proxy mode ('not on proxy for now'), showing the project does not sanction opening channels from the root wallet on a multi-tenant relay.
7. [src/controllers/queries.ts:119–128](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/queries.ts#L119-L128)
   getSuggestedSatPerByte fetches mempool.space and allows up to 250 sat/vB (falls back to 250 on error), so each open also spends on-chain fees from the root wallet at a rate the attacker does not control.

## Impact
Attacker-chosen amounts of the provider's on-chain funds, up to the full spendable balance in one call, are locked into a channel the provider did not authorize; 2% is pushed to the remote node irrecoverably and chain fees are spent. No disclosure; the HTTP service stays up.

## Reproduction steps
1. An authenticated tenant of a proxy-mode LND relay that has connect_ui enabled sends POST /gen_channel {amount: N} with its ordinary x-user-token. ownerMiddleware admits it, genChannel runs connectPeer and openChannelSync on the root LND client, and N sats of the provider's on-chain funds are committed to a channel with Sphinx's node, 2% pushed away plus chain fees. Succeeds whenever the root node is not currently connected to that peer (observable via unauthenticated /peered). Deployment conditions (proxy mode plus connect_ui) are outside the attacker's control.

## Recommended fix
1. genChannel performs a root-node, funds-moving operation for any authenticated owner without checking that the caller is the node operator (proxy admin / single owner) and without a per-tenant wallet. Fix criteria: Channel opening from the connect UI is refused unless the caller is the node operator (not a proxy tenant), or is performed against the caller's own sub-wallet; verify that a non-admin tenant's POST /gen_channel is rejected and no openChannel RPC reaches the root node.
2. The connect-UI routes are mounted whenever connect_ui is set, regardless of proxy mode, although the connect UI is a single-tenant onboarding feature. Fix criteria: The /gen_channel route is not registered (or returns 403) when the relay runs in proxy mode; verify by starting with proxy_* configured and connect_ui true and confirming the route is unavailable to tenants.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Missing Authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258184

---

# KickBot `/kick add` or `/kick remove` without a pubkey crashes the relay process

## Details
The kick bot (src/builtin/kick.ts) handles `/kick add <pubkey>` and `/kick remove <pubkey>` from a tribe admin. Both branches read `arr[2]` and immediately dereference `.length` (kick.ts:88-89 and 145-146) without checking that a third token exists, so the two-word commands `/kick add` or `/kick remove` throw TypeError. The handler is an async callback invoked via `SphinxBot._emit` from a setTimeout (builtin/index.ts:31-35); nothing awaits or catches its promise and the command branch has no try/catch, so the error becomes an unhandled promise rejection. The shipped Docker image runs node:16 (Dockerfile:23) and app.ts installs no `unhandledRejection` handler, so the whole relay process exits, taking down the HTTP API, LND subscriptions and MQTT connections until a supervisor restarts it. The committed dist (dist/src/builtin/kick.js:85-86, 136-137) carries the same code.

Path: the tribe owner's app sends the text via POST /messages (controllers/messages.ts:355-511) -> network.sendMessage, which sets `role = chat_roles.owner` only for the owner's own non-forwarded tribe message (send.ts:104-106), decrypts the content with the tribe group key (send.ts:136) and hands it to intercept.isBotMsg; the installed kick ChatBot has msgTypes [group_join, message] so the text is emitted to the builtin bot (intercept.ts:92-112) and buildBotPayload (bots.ts:526-533) grants the Admin role the kick.ts:84 gate requires. Member messages arrive through forwardMessageToTribe with role reader and isForwarded true (receive.ts:481-497), so a member cannot reach the branch.

Who gains: in a single-tenant deployment the owner only crashes their own relay (nil gain). In proxy or HOSTING_PROVIDER multi-tenant mode (threat-model adversary 5) one process serves all tenants: any tenant owner can create a tribe, `/bot install kick` (mother.ts:95-136, builtin) and type `/kick add`, deterministically terminating the service for every co-tenant. Condition: multi-tenant deployment; the finding holds under that condition. Assumption: sphinx-bot 0.2.43 (package-lock) `_emit` dispatches to `client.on` listeners with EventEmitter semantics, i.e. without awaiting or catching the returned promise (node_modules not present in the checkout). The companion builtin bots guard the same shape (`if (arr.length < 3) return` in mother.ts:96, welcome.ts:32; try/catch in git.ts), so this is an omission specific to kick.ts.

## Evidence
1. [src/builtin/kick.ts:88–89](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/kick.ts#L88-L89)
   `const pubkey = arr[2]; if (pubkey.length !== 66)` -- for the two-word command `/kick add`, arr[2] is undefined and `.length` throws TypeError inside the async listener; this branch has no try/catch. The shipped bundle dist/src/builtin/kick.js:85-86 contains the same code.
2. [src/builtin/kick.ts:145–146](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/kick.ts#L145-L146)
   Same unguarded `remove_pubkey.length` for `/kick remove` (dist/src/builtin/kick.js:136-137).
3. [src/builtin/kick.ts:33–39](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/kick.ts#L33-L39)
   The handler is an async callback registered with client.on; only the group_join branch (45-82) is wrapped in try/catch, the command branch (83-185) is not, so the TypeError rejects the listener's promise.
4. [src/builtin/index.ts:31–35](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/index.ts#L31-L35)
   builtinBotEmit invokes SphinxBot._emit from a setTimeout callback; the async listener's promise is never awaited or caught here, so its rejection is unhandled (assumes sphinx-bot 0.2.43's _emit dispatches to on() listeners with EventEmitter semantics, i.e. without awaiting or catching).
5. [src/network/send.ts:104–106](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L104-L106)
   Only the tribe owner's own non-forwarded message gets `theSender.role = chat_roles.owner`; forwardMessageToTribe (receive.ts:481-497) sets role reader and isForwarded true, so tribe members cannot reach the Admin-gated branch. The owner's plaintext command is then passed to intercept.isBotMsg (send.ts:136-147) after decryptMessage.
6. [src/controllers/bots.ts:526–533](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L526-L533)
   buildBotPayload maps `msg.sender.role === chat_roles.owner` to `member.roles = [{name:'Admin'}]`, satisfying the `isAdmin` gate at kick.ts:84-85 for the owner's command.
7. [src/network/intercept.ts:92–111](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/intercept.ts#L92-L111)
   For each ChatBot in the tribe whose msgTypes include message (kick is installed with [group_join, message], mother.ts:44), a text message is emitted to the builtin bot via emitMessageToBot -> builtinBotEmit(msg, '/kick').
8. [Dockerfile:23](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L23)
   The shipped image runs node:16 (`node /relay/dist/app.js`, no --unhandled-rejections flag), where an unhandled promise rejection terminates the process by default; no `process.on('unhandledRejection'|'uncaughtException')` exists in src/ or app.ts (only commented-out SIGTERM/exit hooks at app.ts:170-181).

## Impact
Process termination removes the relay for all co-tenants (HTTP API, LND invoice/payment subscriptions, MQTT tribe connections) until a supervisor restarts it and can be repeated indefinitely by the same tenant; no data is read or altered.

## Reproduction steps
1. Attacker: an authenticated tenant owner on a proxy/hosting-mode relay (threat-model adversary 5). They create a tribe (POST /group), send `/bot install kick` (mother bot; Admin = own tribe owner), then send `/kick add` with no pubkey via POST /messages. Their own relay path grants the Admin role (send.ts:104-106, bots.ts:526-533), forwards the plaintext to the kick bot, `arr[2].length` throws in the un-awaited async listener, and node 16 terminates the shared process. Deterministic, repeatable after every restart; no control to evade. Attack requirement: the relay must be deployed multi-tenant (proxy_* config or HOSTING_PROVIDER); in a single-tenant relay the owner only harms themself. Assumes sphinx-bot 0.2.43 _emit does not catch listener rejections.

## Recommended fix
1. kick.ts dereferences arr[2] without an argument-count check, and the async command branch has no exception boundary, so a malformed admin command becomes an unhandled rejection. Fix criteria: `/kick add` and `/kick remove` with a missing or non-string argument must produce a bot error reply, not an exception; the handler must catch and log any error on all branches. Verify that sending `/kick add` leaves the process running and that other builtin handlers follow the same guard.
2. Bot handler promises emitted via SphinxBot._emit are never observed and the process has no global rejection handler, so any thrown error in any builtin bot is fatal. Fix criteria: Rejections from bot handlers must be caught at the dispatch boundary (builtinBotEmit) or by a process-level handler that logs instead of exiting; verify a throwing handler cannot terminate the relay.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Unhandled exception
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258180

---

# DELETE /message/:id dereferences a missing message and crashes the shared relay

## Details
deleteMessage (DELETE /message/:id, registered at src/controllers/index.ts:108 as a bare async handler) runs models.Message.findOne({ where: { id, tenant } }) and then unconditionally reads message.uuid and calls message.update() (src/controllers/messages.ts:318-319). When the id does not exist, or belongs to another tenant, findOne resolves null and a TypeError is thrown inside the async function. Express 4 (lock: 4.18.2) does not observe the promise an async route handler returns, so the rejection is unhandled; app.ts and src/ register no process.on('unhandledRejection') or 'uncaughtException' handler (only commented-out SIGTERM/exit stubs at app.ts:170-180), and both Dockerfiles run node:16, whose default --unhandled-rejections=throw terminates the process. A second path in the same handler has the same outcome: success(res, ...) is sent at line 326 and, for a message whose chatId is 0 (keysend/anonymous-invoice rows created at src/network/receive.ts:607 and src/controllers/invoices.ts:108), failure(res, 'no Chat') at line 329 calls res.json() on an already-finished response and throws ERR_HTTP_HEADERS_SENT.

In a single-owner deployment only the owner can trigger this against their own relay and gains nothing. The impact crosses a trust boundary in the multi-tenant modes the threat model records (proxy mode via config.proxy_* or HOSTING_PROVIDER=true), where one relay process serves many owners each authenticated by their own token (src/auth.ts ownerMiddleware). Any one tenant can send DELETE /message/<id outside their tenant> and terminate the process for every co-tenant, repeatedly, one authenticated request per crash. The sanctioned message-deletion paths (clearMessages, disappearingMessages) only touch the caller's own tenant rows; nothing in the project concedes process termination to a tenant. Where the relay is run under supervisord (Dockerfile.lndrelay, autorestart=true) the process is restarted, but each crash still drops all tenants' sockets, in-flight requests and the invoice subscription and can be repeated at will; the primary Dockerfile runs node directly with no restart.

This finding holds only where the relay is deployed multi-tenant (proxy or hosting-provider mode). Root cause: the result of the tenant-scoped lookup is used without a null check, and the handler writes two responses on the chatId-0 path; amplifier: no async error handling at the Express layer and no process-level rejection handler.

## Evidence
1. [src/controllers/messages.ts:313–319](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L313-L319)
   deleteMessage parses req.params.id, looks the message up by { id, tenant } and immediately reads message.uuid and calls message.update() with no null check. Any id outside the caller's tenant (or nonexistent) yields null and a TypeError inside the async handler.
2. [src/controllers/messages.ts:326–330](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/messages.ts#L326-L330)
   Second crash path: success(res, ...) finishes the response, then for a message with chatId 0 (keysend / anonymous-invoice rows) failure(res, 'no Chat') calls res.status/res.json again; Express res.send's Content-Type set on a finished response throws ERR_HTTP_HEADERS_SENT inside the same un-caught async handler.
3. [src/controllers/index.ts:108](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L108)
   The async handler is registered directly on Express 4 (app.delete) without any promise/error wrapper; the route is subject to ownerMiddleware (authenticated) but is reachable by every tenant.
4. [package.json:62](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/package.json#L62)
   express ^4.16.4 (lock 4.18.2): Express 4 ignores the promise returned by an async route handler, so a thrown TypeError becomes an unhandled promise rejection rather than a 500. No error-handling middleware or express-async-errors is used anywhere in app.ts or src/.
5. [Dockerfile:23](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L23)
   Runtime image is node:16-buster-slim (CMD node /relay/dist/app.js at line 42, no supervisor). Node >= 15 defaults to --unhandled-rejections=throw; with no process.on('unhandledRejection') or 'uncaughtException') handler in app.ts or src/, the rejection terminates the process serving all tenants.
6. [src/network/receive.ts:606–607](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L606-L607)
   Keysend rows are created with chatId: 0, so any tenant that has received a bare keysend (or paid an anonymous invoice, src/controllers/invoices.ts:108) owns a row that drives the second (double-response) crash path by deleting it.

## Impact
Availability HIGH for the shared relay: the Node process exits, dropping the HTTP API, socket.io connections, MQTT tribe subscriptions and the LND invoice subscription for every tenant until an operator or supervisor restarts it; the primary Dockerfile has no restart, and even under supervisord (Dockerfile.lndrelay) the crash is repeatable with one request each. No confidentiality or integrity impact: the lookup is tenant-scoped, so no foreign row is read or modified.

## Reproduction steps
1. Attacker is an authenticated tenant holding ordinary owner credentials for their own account on a relay deployed in proxy (config.proxy_*) or HOSTING_PROVIDER=true multi-tenant mode — adversary 5 of the threat model. One HTTP request DELETE /message/<id not in their tenant> (or DELETE of one of their own chatId-0 keysend rows) terminates the shared Node process; it is repeatable, needs no victim interaction and no knowledge beyond the attacker's own token. The multi-tenant deployment is the condition under which the impact crosses a boundary (AT:P).

## Recommended fix
1. deleteMessage uses the result of a tenant-scoped findOne without checking for null, and writes two HTTP responses when the message has no chat. Fix criteria: A request for a non-existent or foreign message id must return a 4xx error without throwing, and the handler must send exactly one response on every path (including chatId 0). Verify by issuing DELETE /message/<unknown id> and DELETE for a keysend row and confirming the process remains up.
2. Async Express handlers run with no promise rejection handling and the process has no unhandledRejection handler, so any thrown error in a route is fatal to all tenants. Fix criteria: Rejections from route handlers must be routed to an Express error response rather than escaping, and the process must not terminate on an unhandled rejection; verify with a handler that throws and confirm a 500 is returned and the process continues.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Null pointer dereference
**CWE:** [CWE-476](https://cwe.mitre.org/data/definitions/476.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258178

---

# Sentiment bot lets any tribe member set the URL the relay polls, enabling periodic SSRF

## Details
The builtin SentimentBot (src/builtin/sentiment.ts) is one of the in-process bots that receive every tribe message the tribe owner's relay forwards. Unlike its siblings SpamGoneBot (spamGone.ts:29-31) and MlBot (ml.ts:47,56), which refuse configuration commands unless message.member.roles contains 'Admin', the sentiment handler's command branch (sentiment.ts:60-74) only checks that the text starts with '/sentiment' and that the message was emitted for this bot. Any tribe member can therefore run:

- `/sentiment url <anything>` -> updateUrl (utill/sentiment.ts:211-240) writes the string into ChatBot.meta.url;
- `/sentiment threshold <n>` -> rewrites the alert threshold;
- `/sentiment timer <n>` -> rewrites the polling period and (re)creates the interval (value handling is the separate candidate sentiment-timer-unvalidated-interval-collapse-flood).

The project itself treats these three as owner commands: mother.ts:59 registers threshold/timer/url as the bot's default hiddenCommands, and buildBotPayload (bots.ts:525-533) supplies the Admin role that would have distinguished the owner; the handler simply never reads it.

Once meta.url is set, checkThreshold (utill/sentiment.ts:136-189) runs on every interval tick for the lifetime of the process and calls getSentiment(url) (195-209), i.e. `fetch(url, {method:'GET'})` with node-fetch (lockfile 2.6.12; assumed to follow redirects by default per its documented `follow: 20`) to a URL whose scheme, host, port and path the member chose. The relay thus becomes a periodic HTTP client against any internal or external host the attacker names (loopback services such as LND REST or the proxy admin API, cloud metadata, link-local hosts, or a third-party victim), and reveals the owner relay's egress IP to an attacker-run server. The response is read in full with r.json() (no size limit), averaged, and only a percentage difference is posted to the tribe, so the SSRF is blind; the attacker additionally gains the ability to post fabricated 'Sentiment has increased by N%' alerts and to overwrite the tribe owner's legitimate configuration.

Reachability: the owner must have installed the bot (`/bot install sentiment`, admin only, mother.ts:91-92). After that, the bot is installed with the default msgTypes [message] (mother.ts:113-115), so intercept.ts:92-111 emits every text message in the tribe to it. A member's message arrives at the owner relay via keysend or MQTT (receive.ts:137-172), is forwarded through forwardMessageToTribe -> sendMessage (send.ts:142) and isBotMsg into builtinBotEmit; the member's role is forced to reader (receive.ts:489), which the bot ignores. Membership of a public tribe is self-service (chats.ts:668 receiveGroupJoin -> addMemberToTribe), and receive.ts:165-172 skips the membership check altogether for senders that are not yet contacts when pricePerMessage is 0. The hidden-command interception (send.ts:155-158, 559-597) runs after isBotMsg and only hides the command text from other members; it does not prevent execution.

Assumption: sphinx-bot ^0.2.43 `_emit` dispatches the payload built by buildBotPayload to every logged-in builtin client and routes `channel.send` back to finalAction as a broadcast, as the surrounding code relies on.

## Evidence
1. [src/builtin/sentiment.ts:60–74](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/sentiment.ts#L60-L74)
   The command branch is gated only on arr[0] === '/sentiment' and message.author.bot === '/sentiment'; message.member.roles is never consulted, so threshold/timer/url run for any member. Compare spamGone.ts:29-31 and ml.ts:47,56 where the same maintainers gate on the Admin role.
2. [src/builtin/utill/sentiment.ts:211–240](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/utill/sentiment.ts#L211-L240)
   updateUrl stores the member-supplied arr[2] verbatim into ChatBot.meta.url with no scheme/host validation.
3. [src/builtin/utill/sentiment.ts:136–157](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/utill/sentiment.ts#L136-L157)
   checkThreshold runs on every interval tick, reads meta.url and calls getSentiment(url).
4. [src/builtin/utill/sentiment.ts:195–208](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/utill/sentiment.ts#L195-L208)
   getSentiment performs fetch(url) (node-fetch) with the attacker-chosen URL; the whole response body is read with r.json().
5. [src/builtin/mother.ts:56–59](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/mother.ts#L56-L59)
   builtInHiddenCmd registers threshold/timer/url as the sentiment bot's hidden (owner-intended) commands, showing the project does not concede these to members; hiding only affects display (send.ts:559-597), not execution.
6. [src/builtin/mother.ts:113–115](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/mother.ts#L113-L115)
   'sentiment' has no builtInBotMsgTypes entry, so it is installed with msgTypes [message]; every text message in the tribe is therefore emitted to this bot.
7. [src/network/intercept.ts:92–111](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/intercept.ts#L92-L111)
   isBotMsg iterates every ChatBot in the tribe and emits any text message whose type is in the bot's msgTypes via emitMessageToBot -> builtinBotEmit(msg, '/sentiment'), which sets author.bot to the prefix the handler checks.
8. [src/controllers/bots.ts:519–534](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L519-L534)
   buildBotPayload derives the Admin role only from msg.sender.role === owner; send.ts:104-106 sets owner only for the tribe owner's own un-forwarded messages, receive.ts:489 forces reader for forwarded member messages. So the role data exists and would have distinguished the attacker had the bot checked it.
9. [src/network/receive.ts:146–171](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L146-L171)
   Entry: a member's keysend/MQTT message to the tribe owner reaches forwardMessageToTribe -> sendMessage -> intercept.isBotMsg -> builtinBotEmit. Membership is self-service on public tribes (chats.ts:668 receiveGroupJoin creates Contact and ChatMember) and the membership check is skipped entirely for unknown senders when pricePerMessage is 0 (needsPricePerMessage && senderContactId).

## Impact
Integrity: a non-admin rewrites bot configuration owned by the tribe admin and can post fabricated sentiment alerts to the tribe. Confidentiality: the relay issues GETs to attacker-chosen internal URLs but only a derived percentage is observable, so disclosure is minimal. Availability: the relay performs an unbounded-size fetch and JSON parse of the attacker's response on every tick (the interval collapse is rated in the separate timer finding). Subsequent-system impact: The relay is turned into a scheduled HTTP GET client against any host the member names, including loopback and link-local services co-located with the relay and arbitrary third parties; requests are blind GETs carrying only a Content-Type header, so state change on those targets is limited to what an unauthenticated GET can do.

## Reproduction steps
1. Attacker joins (or merely sends a keysend/MQTT message into) a public tribe whose owner has installed the sentiment bot, then sends the text `/sentiment url http://<target>` and optionally `/sentiment timer <n>`. The owner relay forwards it, intercept emits it to the bot, the handler skips any role check and stores the URL; from the next tick onward the relay GETs the attacker's URL on a schedule. No signature, membership status or owner interaction stands in the way; the only precondition is that the bot is installed in the tribe.

## Recommended fix
1. The sentiment command branch executes configuration changes (url/threshold/timer) without verifying the sender holds the Admin role that buildBotPayload already supplies, violating the tribe-authority boundary that the sibling bots enforce. Fix criteria: Configuration commands must be executed only when message.member.roles contains Admin (i.e. the un-forwarded tribe owner), exactly as spamGone.ts and ml.ts do; a member's `/sentiment url`, `/sentiment timer` or `/sentiment threshold` must leave ChatBot.meta unchanged and create no interval.
2. meta.url is accepted verbatim and later fetched by the relay, so whoever can set it directs server-side requests to arbitrary schemes and hosts. Fix criteria: The polled URL is validated (https only, no loopback/link-local/private hosts, or an operator allowlist) and response size is bounded before parsing; verify that a URL naming localhost or 169.254.169.254 is rejected and produces no outbound request.

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
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258177

---

# KickBot blacklist is checked against the owner's own contact for first-time joiners

## Details
The kick bot (src/builtin/kick.ts) implements a pubkey blacklist for a tribe: `/kick add <pubkey>` stores the key in the ChatBot's meta (builtin/utill/kick.ts:58-68), including for pubkeys that are not yet contacts (kick.ts:135-143 reports success), and the group_join branch (kick.ts:45-77) is meant to kick a blacklisted joiner. That branch identifies the joiner as `Contact.findOne({ id: message.member.id, tenant })` and compares the blacklist with that contact's publicKey. `member.id` is `msg.sender.id` (controllers/bots.ts:520), which isBotMsg computes as `forwardedFromContactId || tenant` (network/intercept.ts:30). On the tribe owner's relay `forwardedFromContactId` is `senderContact && senderContact.id` from a Contact lookup by the join payload's pub_key (receive.ts:146-166), computed before the join is acted on; the Contact for a never-seen pubkey is only created later by doTheAction (receive.ts:354) -> receiveGroupJoin -> addMemberToTribe (chats.ts:617-629). So for any first-time joiner the kick bot is handed the owner's own contact id, loads the owner's Contact, finds the owner's pubkey is not blacklisted, and returns without kicking. The ban therefore only works for pubkeys that already have a Contact row (e.g. someone kicked while a member, whose Contact persists); a pubkey the owner blacklisted pre-emptively -- the case the bot explicitly confirms as successful -- joins unimpeded, receives the history replay (chats.ts:717-720) and all future broadcasts, and appears in contactIds like any member. Deleting the contact of a kicked user (a normal cleanup action) has the same effect on re-join. The outcome does not depend on timing: member.id is fixed to the owner's id at intercept.ts:30 before the bot handler runs, so the bot never looks the joiner up by pubkey even if the Contact has been created by then.

Attacker: the banned party, any Lightning node, sending an ordinary group_join (paying priceToJoin) to a public tribe with the kick bot installed (or a private one, see verified record tribe-owner-unknown-sender-skips-membership-and-approval-gates, which covers the receive.ts gates but not this bot). No forged fields are needed; the bypass is deterministic. The bot trusts a payload-derived member.id as the joiner's identity although that id degrades to the owner's id; the join payload's pub_key, which is what the blacklist stores, is never consulted. Leads lead-intercept-29-05c0, lead-intercept-30-68fc and the kick.ts:48 item of e5-badge-member-id-tenant are concluded by this record.

## Evidence
1. [src/builtin/kick.ts:45–76](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/kick.ts#L45-L76)
   On group_join the bot resolves the joiner as Contact.findOne({id: message.member.id, tenant}) and kicks only if blacklist.includes(contactJoining.publicKey); it never looks at the joining pubkey carried by the join payload.
2. [src/network/intercept.ts:23–30](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/intercept.ts#L23-L30)
   isBotMsg sets msg.sender.id = forwardedFromContactId || tenant, so when the forwarder has no contact id for the joiner the bot receives the owner's own contact id as member.id.
3. [src/controllers/bots.ts:519–522](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/bots.ts#L519-L522)
   buildBotPayload copies msg.sender.id into message.member.id.
4. [src/network/receive.ts:146–166](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L146-L166)
   forwardedFromContactId = senderContact && senderContact.id, where senderContact is Contact.findOne({publicKey: payload.sender.pub_key, tenant}) executed before the join is acted on; for a pubkey the owner has never seen it is undefined.
5. [src/network/receive.ts:306–313](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L306-L313)
   forwardMessageToTribe (which reaches sendMessage -> isBotMsg -> the kick bot) is invoked with that undefined forwardedFromContactId; doTheAction (line 354) later runs receiveGroupJoin/addMemberToTribe, which is what creates the joiner's Contact and approved ChatMember.
6. [src/builtin/kick.ts:97–142](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/kick.ts#L97-L142)
   `/kick add <pubkey>` for a pubkey with no Contact row still appends it to the blacklist and replies 'You've successfully added this user to the blacklist' -- the pre-emptive ban is an intended feature, and it is exactly the case the join check cannot enforce.
7. [src/controllers/chats.ts:716–722](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L716-L722)
   receiveGroupJoin replays chat history to the (unkicked) joiner, so a bypassed ban yields the tribe's recent messages and all future broadcasts.

## Impact
A party the owner explicitly banned becomes a tribe member: reads the replayed history and subsequent broadcasts (confidentiality, limited to that tribe) and can post as a member (integrity of tribe membership/authority). No availability impact.

## Reproduction steps
1. Attacker: a Lightning node whose pubkey a tribe owner has blacklisted with `/kick add` before it ever became a contact (or whose Contact row was later deleted). It sends a normal group_join for the tribe; the owner's relay forwards it with member.id = owner id, the kick bot checks the owner's pubkey against the blacklist and does nothing, and receiveGroupJoin admits the attacker and replays history. No special payload, timing or credential is required; the kick bot must be installed with a blacklist entry for that key.

## Recommended fix
1. The kick bot derives the joiner's identity from message.member.id, which falls back to the tribe owner's own contact id when the joiner has no Contact yet, so the blacklist is compared against the wrong pubkey for first-time joiners. Fix criteria: The blacklist decision must be made against the joining node's pubkey as carried in the join payload (or against a contact id that is guaranteed to be the joiner's), never against a fallback id. Verify that a pubkey added with `/kick add` before any contact exists is kicked (or refused) on its first group_join, and that the owner's own id is never used as the joiner's identity.
2. isBotMsg substitutes the tenant id for a missing forwardedFromContactId, silently turning 'unknown sender' into 'the owner' for every builtin bot. Fix criteria: Unknown senders must be represented as unknown (e.g. '0' or absent) in the bot payload so bots cannot mistake them for the owner; verify member.id never equals the owner's id for a forwarded member message or join.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Incorrect authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258174

---

# Call-recording poller and cron callbacks lack error handling; a failed fetch terminates the relay

## Details
Both asynchronous workers of the call-recording bot run outside any error handler.

1. Passive poller (src/builtin/callRecording.ts:441-496). Any message in a tribe with the bot installed whose text starts with the tribe's jitsiServer URL creates a CallRecording row and a setInterval that, once a minute for three hours, does `await fetch(`${memeServerLocation}/${callId}.mp4`)`. The callback is an async function whose promise setInterval ignores. If fetch rejects (ECONNREFUSED/ECONNRESET, DNS failure, TLS error, redirect loop, non-http scheme), if the object exists but jobs.stakwork.com returns non-2xx (`throw` at 482), or if the Stakwork body is not JSON / lacks `data`, the rejection is unhandled.

2. Recurring-call cron (src/builtin/utill/callRecording.ts:75-165). Every hour at :30 the CronJob HEADs the bucket URL. The fetch is unguarded, and on a 2xx response the code reads `headers.raw()['x-amz-version-id'][0]` - a TypeError whenever the server is not a versioned S3 bucket (plain HTTP server, S3 with versioning off, any CDN). Jobs are re-created from the DB at startup (initializeCronJobsForCallRecordings, controllers/index.ts:41-43), so the crash recurs after each restart.

The repository registers no unhandledRejection/uncaughtException handler and the production image is node:16, so each of these events exits the process: HTTP, socket.io, MQTT subscriptions and invoice handling stop for every tenant until supervisord restarts it.

Who can trigger it. In single-tenant deployments the owner is the only party able to configure the bucket, so a crash is self-inflicted or caused by the owner's chosen meme server failing (adversary 6) - though any tribe member can start pollers at will, and any transient failure of the configured bucket during the 180 requests of a poller then kills the relay. In proxy / hosting-provider mode (threat-model adversary 5) the attack is deterministic and cross-tenant: a tenant owner sets call_recording=1 and meme_server_location/jitsi_server to a host they control via PUT /group/:id (chatTribes.ts:500-506) or `/callRecording update`, posts a jitsi link in their own tribe, and has their server reset the connection (poller rejects within a minute) or return 200 without x-amz-version-id to the hourly HEAD after `/callRecording recurring <link>` (TypeError at :30 every hour, surviving restarts). All co-tenants on the shared relay lose service repeatedly.

Assumptions: node-fetch ^2.6.7 (lock 2.6.12; Dockerfile deletes the lockfile so any 2.x) rejects its promise on network errors and exposes `headers.raw()` as a plain object of arrays, so a missing header yields undefined; cron ^1.7.2 (lock 1.8.3) invokes onTick without observing a returned promise. Both are the documented behaviour of those majors.

## Evidence
1. [src/builtin/callRecording.ts:441–496](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/callRecording.ts#L441-L496)
   The per-call poller is an `async function` passed to setInterval with no try/catch. `await fetch(filePathAndName)` (445) rejects on any network/TLS/redirect error; `throw` (482) fires whenever Stakwork answers non-2xx; `sendFile.json()` (464) and `res.data.project_id` (468) throw on non-JSON or unexpected bodies. setInterval discards the returned promise, so every one of these becomes an unhandledRejection.
2. [src/builtin/utill/callRecording.ts:75–165](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/utill/callRecording.ts#L75-L165)
   startCallRecordingCronJob's onTick is an async function run by `cron` with its promise ignored. `await fetch(filepath, {method:'HEAD'})` (99) is unguarded, and on any 2xx response lacking an `x-amz-version-id` header, `newCall.headers.raw()['x-amz-version-id'][0]` (110) dereferences undefined and throws. `extractFileName(recurringCall.link, tribe.jitsiServer)` (96) and `owner.id` (129) also throw when the Chat row has a null jitsiServer or the tenant has no owner row.
3. [src/builtin/utill/callRecording.ts:61–73](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/utill/callRecording.ts#L61-L73)
   initializeCronJobsForCallRecordings re-creates a CronJob for every non-deleted RecurringCall row at process start (called from src/controllers/index.ts:41-43), so a poisoned recurring call crashes the relay again at the next :30 after every restart until the DB row is removed.
4. [src/builtin/callRecording.ts:404–439](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/callRecording.ts#L404-L439)
   The passive branch runs for every text message in a tribe that has the bot installed (owner's own sends and forwarded member messages alike); any message starting with tribe.jitsiServer creates a CallRecording row and starts the unguarded poller for 3 hours.
5. [src/controllers/chatTribes.ts:500–505](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L500-L505)
   editTribe (PUT /group/:id, authenticated owner) accepts call_recording, meme_server_location, jitsi_server, stakwork_api_key and stakwork_webhook from the HTTP body, so any tenant can point its own tribe's memeServerLocation at a host it controls without using the bot's `update` command.
6. [src/network/intercept.ts:89–111](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/intercept.ts#L89-L111)
   '/callRecording' is in botInterceptMsg, so the bot receives every type-0 message in the tribe, text or not.
7. [app.ts:170–181](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L170-L181)
   No process.on('unhandledRejection') / 'uncaughtException' handler exists anywhere in app.ts or src (only commented-out SIGTERM/exit hooks), so Node's default `--unhandled-rejections=throw` terminates the process.
8. [Dockerfile:23–24](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L23-L24)
   The shipped image runs on node:16, where an unhandled rejection is fatal by default; docker/relay_supervisor.conf restarts the process, but the DB-restored cron job makes the crash recur.

## Impact
The Node process exits: every tenant on the relay loses HTTP, socket.io, MQTT and payment processing until restarted, and the DB-restored cron job (or a re-posted link) repeats the crash on the attacker's schedule. No data is read or modified.

## Reproduction steps
1. Attacker is an authenticated tenant owner (or, with a configured bucket, any tribe member who can get a message forwarded). They configure their own tribe's bucket URL to a host they control (HTTP editTribe or bot update), install the bot, and post a jitsi link or register a recurring call; their server then fails the fetch or omits the S3 header. No race, no defence to bypass. Cross-tenant victims exist only in proxy/hosting-provider multi-tenant mode, or when the configured bucket fails during a poller window, hence AT:PRESENT.

## Recommended fix
1. The setInterval poller (callRecording.ts:441-496) and the CronJob onTick (utill/callRecording.ts:78-161) are async callbacks whose rejections nobody observes; network failures, non-2xx Stakwork replies, non-JSON bodies and missing headers all escape as unhandled rejections. Fix criteria: Every timer and cron callback body must catch and log its own errors (including explicit validation that `x-amz-version-id` is present before indexing it, that tribe.jitsiServer/memeServerLocation are non-null, and that the Stakwork response parsed), stopping or marking the job failed instead of throwing. Verify by making the bucket URL unreachable or return 200 without the header and confirming the process keeps running and logs the failure.
2. The process has no global unhandledRejection/uncaughtException handler, so any single escaped rejection in a background task is fatal for all tenants. Fix criteria: Register a process-level unhandledRejection handler that logs and keeps the service alive (as defence in depth, not a substitute for local handling). Verify that an injected rejection in a background timer no longer terminates the relay.

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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258172

---

# GET /logs exposes shared relay log with other tenants' tribe tokens and payments

## Details
GET /logs is routed at controllers/index.ts:145 to details.getLogsSince with only the generic ownerMiddleware in front of it (no proxyAdminMiddleware, unlike /admin_balance at index.ts:223). getLogsSince (details.ts:105-125) never consults req.owner: it reads the last 500 lines of config.log_file or, failing that, of /var/log/supervisor/relay.log, /home/lnd/.pm2/logs/app-error.log and /var/log/syslog, and returns them verbatim. The relay is one process for all owners in proxy / HOSTING_PROVIDER mode and its log is process-wide, so any tenant holding a valid x-user-token (or an admin token) reads every other tenant's log lines.

At the shipped defaults (config.ts:57-59 enable TRIBES, PAYMENT_TRACKING, EXPRESS; logging_level info) those lines include: (1) tribes.ts:122 'connect with token: <pwd>' on every MQTT connect, where pwd is genSignedTimestamp(owner) - the owner-signed timestamp that is simultaneously the MQTT password (tribes.ts:124-126), the ?token= bearer credential for the tribe server HTTP API (tribes.ts:528-531, 573, 615, 644, 676, 709, 905), the people-server profile API (people.ts:43-47) and the token handed to external sign-in flows (controllers/auth.ts:41); (2) lightning.ts:535-538 '=> keysendMessage from <pubkey> {dest, amt, route_hint, data}' for every outbound payment of every tenant, data being the serialized Sphinx payload (chat uuids, aliases, invoices, media tokens, encrypted bodies); (3) invoices.ts:39-43 '[pay invoice] <bolt11>' plus tenant id and pubkey, logged with no logging type and therefore always emitted; (4) express-winston request lines (app.ts:111-113, always on), including query strings, for all tenants. The LSAT variant at lsats.ts:78 is under LIGHTNING, which is not in the default set.

Which file is served depends on deployment: Dockerfile.lndrelay runs the relay under supervisor with stdout/stderr at /var/log/supervisor/relay.log (docker/relay_supervisor.conf:7-8); pm2 installs expose the stderr log; the documented myNode/Raspiblitz systemd units send output to syslog (docs/myNode_deployment.md:283-285), reaching /var/log/syslog, which the handler reads if the service user can; an operator-set LOG_FILE/log_file (config.ts:137) is read directly. The CI-built Dockerfile and Dockerfile.swarm images log to stdout only, so there the handler returns failure unless log_file is configured. The finding therefore holds in a multi-tenant deployment where a log file exists at a default path or log_file is configured; the repository does not settle the hosting layout.

In single-tenant mode the owner reading their own relay log is acceptable; the /var/log/syslog fallback additionally exposes host-wide system logs to the relay token where the process can read that file. The writing of secrets into the log is tracked separately (leads lead-tribes-122-f340, e6-secrets-logged); this finding is the exposure path, which has no notion of tenant and no admin restriction.

## Evidence
1. [src/controllers/details.ts:100–125](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/details.ts#L100-L125)
   getLogsSince never reads req.owner: it returns the last 500 lines of config.log_file or, failing that, of /var/log/supervisor/relay.log, /home/lnd/.pm2/logs/app-error.log or /var/log/syslog, verbatim, with no tenant, owner or admin check. This is the code the fix must change.
2. [src/controllers/index.ts:145](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L145)
   The route is registered with no proxy-admin middleware; compare /admin_balance at line 223, which is guarded by pamid. Only the generic ownerMiddleware (any owner token) stands in front of it.
3. [src/utils/tribes.ts:122–127](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L122-L127)
   Every MQTT connect logs 'connect with token: <pwd>' at info under TRIBES (in the default logging set); pwd is the owner-signed timestamp used as the MQTT password for that owner.
4. [src/utils/tribes.ts:528–531](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L528-L531)
   The same genSignedTimestamp value is the owner's bearer credential to the tribe server HTTP API (PUT /tribe?token=…; likewise lines 573, 615, 644, 676, 709, 905), to the people server (people.ts:43-47) and is handed to external sign-in flows (controllers/auth.ts:41), so the logged token impersonates the owner toward those services.
5. [src/grpc/lightning.ts:535–538](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L535-L538)
   Every outbound keysend logs the owner pubkey and the full opts (destination, amount, route hint, serialized Sphinx payload) under PAYMENT_TRACKING, in the default logging set.
6. [src/controllers/invoices.ts:39–43](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L39-L43)
   Paying an invoice logs the full bolt11, the tenant id and the owner pubkey with no logging type, i.e. MISC, which sphinxLoggerBase always emits regardless of config.logging.
7. [src/utils/config.ts:56–61](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/config.ts#L56-L61)
   Default config.logging enables TRIBES, EXPRESS, NETWORK, LSAT, PAYMENT_TRACKING and logging_level defaults to info, so the lines above are emitted in a stock deployment.
8. [docker/relay\_supervisor.conf:7–8](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/docker/relay_supervisor.conf#L7-L8)
   The supervisor image (Dockerfile.lndrelay:84-87) writes the relay's stdout and stderr to /var/log/supervisor/relay.log, the first default path read by getLogsSince.
9. [docs/myNode\_deployment.md:282–285](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/docs/myNode_deployment.md#L282-L285)
   The documented systemd unit sends relay output to syslog, reaching /var/log/syslog, the third default path; the handler then also returns host-wide system log lines when the service user can read that file.
10. [src/auth.ts:147–275](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L147-L275)
   ownerMiddleware only establishes which owner holds the presented token; it performs no per-route authorization, so any tenant's x-user-token (or an admin token) reaches getLogsSince.

## Impact
Other tenants' owner-signed tribe/people-server bearer tokens, every tenant's outbound keysend destinations, amounts and serialized payloads, paid bolt11 invoices and all request lines are disclosed to a co-tenant: a serious loss of critical cross-tenant data (C:H). The handler is read-only; the relay's own data and service are not modified or denied (I:N, A:N). Subsequent-system impact: The leaked token is the credential this relay itself presents to the tribe server (MQTT password and ?token= on the /tribe and /person APIs) and to external sign-in flows; with it the attacker can authenticate to those external services as the victim, reading the victim's tribe topics and editing tribes or publishing as the owner. Assumption: acceptance depends on the external verifier's timestamp-freshness window, which this repository does not control (the relay's own verifySignedTimestamp at tribes.ts:771-779 enforces none); rated LOW/LOW accordingly.

## Reproduction steps
1. Attacker is an authenticated tenant on a shared proxy/hosting relay (threat-model adversary 5). They send GET /logs with their own x-user-token; ownerMiddleware resolves them as an owner and getLogsSince returns the last 500 lines of the process-wide log with no tenant or admin check. Requires a multi-tenant deployment in which a log file exists at one of the default paths (supervisor, pm2, syslog) or log_file is configured; the stdout-only Docker images return failure otherwise.

## Recommended fix
1. GET /logs returns a process-wide log tail to any authenticated owner with no tenant scoping or admin restriction, and falls back to host system logs, violating tenant isolation and, for the syslog fallback, host confinement. Fix criteria: In proxy/hosting mode /logs must be unavailable to ordinary tenants (restricted to the proxy admin or disabled), and the handler must read only the relay's own configured log file, never /var/log/syslog or other host logs. Verify: as a non-admin tenant in proxy mode GET /logs returns 401/404; with no log_file configured no host path is opened.
2. Authentication tokens (owner-signed tribe tokens) and full payment payloads and invoices are written to the shared log at default verbosity, so any exposure of the log is a credential and traffic leak. Fix criteria: Tokens, passwords and full payment payloads must not appear in the log at default levels; verify by performing a tribe connect, a keysend and an invoice payment and grepping the log for the token, payload and bolt11 strings, finding none.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Missing Authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258003

---

# addGroupMembers and kickChatMember send to arbitrary contact ids, bypassing tenant isolation

## Details
The tenant isolation convention in this codebase is `where: { id, tenant: req.owner.id }` on every lookup. addGroupMembers (PUT /chat/:id, chats.ts:450-486) applies it only when building the `members` map and then hands the unfiltered `req.body.contact_ids` to network.sendMessage as the destination list; kickChatMember (PUT /kick/:chat_id/:contact_id, chats.ts:84-126) likewise sends group_kick to `[contactId]` straight from the URL. sendMessage (send.ts:222-224) resolves each id with Contact.findOne({ where: { id } }) with no tenant clause and, for a group-type chat, keysends the attacker-signed payload to that contact's publicKey/routeHint from the attacker's own sub-LND.

In proxy / hosting-provider multi-tenant mode (one process and one database shared by many owners; threat-model adversary 5) Contact ids are a single auto-increment space, so tenant A can iterate ids and make the relay deliver A-signed group_invite or group_kick messages to tenant B's contacts, people A has no relationship with. Single-tenant deployments are unaffected because every contact row belongs to the caller.

The HTTP response does not expose the target, and GET /payments is DB-backed, so the disclosure arrives through the Lightning round-trip: the targeted contact's relay answers a group_invite by creating the chat and sending group_join to every member including A (chats.ts:974-989); A's relay then finds its own chat by uuid and addMemberToTribe (chats.ts:603-625) creates a Contact row in A's tenant holding the recipient's publicKey, routeHint, alias and photo, which A's client lists as a contact. One keysend of min_sat (DEFAULT_MIN_SAT) per probed id. Assumes the targeted contact runs sphinx-relay (the Sphinx client's only backend), whose group_invite handling is this same code.

Root cause: destination contact ids taken from the request are not constrained to the caller's tenant before being passed to the network layer, and the network layer trusts its caller's id list.

## Evidence
1. [src/controllers/chats.ts:478–485](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L478-L485)
   addGroupMembers (PUT /chat/:id) passes the raw request-body contact_ids as chat.contactIds to network.sendMessage. The earlier tenant-scoped Contact lookup (lines 460-473) only populates the `members` map; ids that resolve to no contact under the caller's tenant are silently dropped from `members` but still sent to.
2. [src/controllers/chats.ts:109–117](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L109-L117)
   kickChatMember (PUT /kick/:chat_id/:contact_id) sends group_kick to contactIds=[contactId] taken straight from the URL; only the chat is tenant-scoped, the contact id never is.
3. [src/network/send.ts:222–223](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L222-L223)
   sendMessage resolves each destination id with Contact.findOne({ where: { id: contactId } }) with no tenant condition, then keysends the signed payload to contact.publicKey using contact.routeHint (lines 275-287). For a non-tribe (group) chat nothing earlier in the function filters contactIds.
4. [src/controllers/chats.ts:974–988](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L974-L988)
   On the targeted contact's relay, receiveGroupCreateOrInvite answers a group_invite by creating the chat and then sending group_join to every chat member, i.e. back to the attacker's pubkey, with its own contactKey in members.
5. [src/controllers/chats.ts:603–624](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L603-L624)
   Back on the attacker's relay, receiveGroupJoin finds the attacker's own chat by uuid and addMemberToTribe creates a Contact row under the attacker's tenant with the replying node's publicKey, routeHint, alias and photo (member.key is present because the reply carries the recipient's contactKey). The attacker's client then sees the other tenant's contact as its own contact.

## Impact
Cross-tenant disclosure of other tenants' contact-book entries (Lightning pubkey, route hint, alias, photo), enumerable by id: confidentiality LOW. A can also cause unsolicited A-signed invites/kicks to be delivered to those contacts and, where the target is itself a co-tenant on the same relay, cause chat and contact rows to be created in that tenant's partition: integrity LOW. No availability effect.

## Reproduction steps
1. Authenticated tenant A on a proxy/hosting-mode relay owns any group chat and calls PUT /chat/<ownChatId> with contact_ids:[1..N] (or PUT /kick/<ownChatId>/<id>). For every id that belongs to another tenant the relay keysends A's group_invite to that contact's node; the recipient's relay unconditionally replies with group_join, which A's relay stores as a new contact (pubkey, route hint, alias). No check stands in the way; the only requirement is the attacker position itself (a co-tenant account), so no additional attack requirement is present.

## Recommended fix
1. addGroupMembers and kickChatMember forward request-supplied contact ids to the network layer without restricting them to the caller's tenant. Fix criteria: Both handlers send only to contact ids that resolve under { id, tenant: req.owner.id } (addGroupMembers should derive the destination list from the tenant-scoped lookup it already performs); supplying another tenant's contact id results in no keysend and no change.
2. sendMessage resolves destination contact ids with Contact.findOne({ where: { id } }) and trusts whatever id list its caller provides. Fix criteria: sendMessage scopes every destination Contact lookup to the sender's tenant (where { id, tenant }) so that no caller can route a message to another tenant's contact.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Insecure Direct Object Reference
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258002

---

# PUT /lsats/:identifier applies raw request body as update set, allowing tenant and identifier overwrite

## Details
updateLsat (PUT /lsats/:identifier, src/controllers/lsats.ts:249-274) selects the caller's own record by {tenant: req.owner.id, identifier} but uses the unfiltered JSON request body as the SET clause: models.Lsat.update(body, {where}) (and {...body, status: expired} on the other branch). Sequelize 5.22.5 Model.update without options.fields writes every key of the values object that is a model attribute, so the client controls tenant, identifier, id, status, macaroon, preimage, paymentRequest, issuer, paths and metadata of its own row — including the tenant-scoping columns.

In proxy/hosting (multi-tenant) mode, where many owners share one DB and process, this crosses the tenant boundary: a co-tenant saves any LSAT it holds (POST /lsats), then PUTs {"tenant": <victimTenantId>, "status": 1, "issuer": "<target issuer>"} (optionally "identifier": <victim's LSAT identifier>) on it. The row now belongs to the victim's tenant. The victim's client calling GET /active_lsat?issuer=..., GET /lsats or GET /lsats/:identifier receives the attacker's macaroon+preimage as its own credential and will present that LSAT to the issuer (boltwall-protected service); the attacker, who holds the same LSAT, shares the victim's session at that issuer. Renaming identifier to the victim's existing identifier plants a duplicate under the victim's tenant that findOne may return in place of the legitimate token (lsatAlreadyExists only guards POST, not PUT). Tenant ids are owner Contact ids (small sequential integers), so a victim is trivially targeted. The attacker cannot modify rows it did not own, and once moved the row is out of its reach.

In single-tenant mode the owner can only alter their own records, which is harmless; the impact exists only in multi-tenant deployments, which is where the co-tenant adversary exists at all. Assumption: Sequelize 5.22.5 Model.update without options.fields writes the intersection of values keys and model attributes (including the primary key on sqlite/postgres and the tenant column); unknown keys are dropped by build()/pick.

## Evidence
1. [src/controllers/lsats.ts:249–274](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/lsats.ts#L249-L274)
   updateLsat passes req.body (or {...body, status: expired}) directly to models.Lsat.update as the SET values; the where clause {tenant, identifier} only selects the caller's own row, nothing restricts which columns the body may set, so tenant, identifier, id, macaroon, preimage, paymentRequest, issuer and status are all client-writable.
2. [src/models/sql/lsat.ts:15–74](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/models/sql/lsat.ts#L15-L74)
   The Lsat model declares tenant, identifier, id (autoIncrement PK), macaroon, preimage, paymentRequest, issuer, paths, metadata and status as plain attributes; Sequelize 5.22.5 Model.update without options.fields writes the intersection of the values keys and these attributes.
3. [src/controllers/lsats.ts:202–228](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/lsats.ts#L202-L228)
   getActiveLsat returns the first status=1 LSAT for req.owner.id (optionally filtered by issuer) with all columns; a row re-homed into the victim's tenant with status 1 is served to the victim's client as its active credential. getLsat/listLsats (177-247) likewise expose the planted macaroon/preimage.
4. [src/controllers/index.ts:192](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L192)
   PUT /lsats/:identifier is an ordinary authenticated route (not in auth.ts no_auth); any owner, including a co-tenant in proxy/hosting mode, reaches updateLsat with req.owner set to their own Contact.

## Impact
Attacker writes rows into another tenant's LSAT store and can shadow that tenant's legitimate credential for an issuer (integrity LOW: limited to the LSAT table, no modification of rows the attacker did not create). The victim's client then authenticates to third-party issuers with an attacker-known token, exposing the victim's activity at that issuer to the attacker (confidentiality LOW). No availability impact on the relay.

## Reproduction steps
1. Attacker is any authenticated owner (co-tenant) on a proxy/hosting-mode relay, reached over the Internet-facing HTTP port with their own x-user-token. They create an LSAT of their own via POST /lsats, then issue a single PUT /lsats/:identifier with a JSON body naming the victim tenant id, status 1 and issuer. No allow-list, validation or second control stands in the way; the multi-tenant deployment is the context in which the co-tenant position exists, not an execution-time condition the attacker must win.

## Recommended fix
The update handler trusts the client to name which columns to change, so tenant-scoping fields (tenant, identifier, id) and credential fields are client-writable. Fix criteria: Only an explicit allow-list of mutable LSAT fields (e.g. status, metadata, paths) may be written by PUT /lsats/:identifier; tenant, identifier, id, macaroon, preimage and paymentRequest must be ignored or rejected. Verify by PUTting a body with tenant/identifier/id set and confirming the stored row's tenant and identifier are unchanged.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Mass Assignment
**CWE:** [CWE-915](https://cwe.mitre.org/data/definitions/915.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257999

---

# POST /lsats makes the root/hosting LND node pay any tenant-supplied invoice in proxy mode

## Details
In proxy (multi-tenant) mode every owner is a virtual sub-node behind sphinx-proxy, and payment gRPC calls are meant to go through loadLightning(true, owner.publicKey) so that the tenant's own virtual balance is debited (the sanctioned POST /invoices payInvoice path does this, src/controllers/invoices.ts:44-47). saveLsat (POST /lsats, behind ownerMiddleware so any authenticated owner/tenant reaches it) breaks this: when the bolt11 payee is not the caller's own pubkey (lsats.ts:131) it calls payForLsat(paymentRequest), which calls Lightning.sendPayment(paymentRequest) with no owner pubkey (lsats.ts:80). loadLightning(true, undefined) fails the `ownerPubkey` condition at lightning.ts:134 and returns the root LND client built with loadCredentials() — the hosting provider's admin macaroon (lightning.ts:174-181). Because isProxy() is config-only (proxy.ts:22-30), sendPayment then issues sendPaymentSync on that root client with the attacker's raw payment_request and fee_limit {percent: 7} (lightning.ts:320-333); the amount is whatever the invoice encodes and nothing caps it.

Attack: a co-tenant (any owner on the hosted relay holding its own x-user-token; tenants are provisioned by generateNewUsers and claim tokens by pubkey in generateToken) creates an invoice for an arbitrary amount on a Lightning node they control, builds a macaroon whose identifier carries that invoice's payment hash and a fresh token id (no signing key is checked — the project's own fixture src/tests/utils/save/saveLsat.ts mints with randomBytes and the test asserts success), and POSTs {paymentRequest, macaroon, issuer} to /lsats. The root node pays the attacker's node; the tenant's virtual balance is never debited and the tenant's balance cap enforced by sphinx-proxy is bypassed. lsatAlreadyExists (lsats.ts:46-55) only dedupes by identifier, so each new invoice with a new token id passes. Repeating drains the hosting node's outbound liquidity to the attacker, which also disables every tenant's sanctioned payment path.

In single-tenant deployments the same code pays from the owner's own node, which is intended; the defect is that the tenant's action is executed with the provider's privilege in multi-tenant mode. Related leads e2-lsats-root-pay and lead-lsats-80-50fa are concluded by this finding. The same omission exists at a different sink (badge LSAT payments in src/utils/people.ts, recorded separately).

Assumption: lsat-js ^2.0.0 Lsat.fromMacaroon(macaroon, invoice) only decodes the macaroon and checks that its identifier's payment hash matches the invoice; it cannot verify the macaroon signature without the issuer's root key. The project's own test fixture (random root key, success asserted) is consistent with this.

## Evidence
1. [src/controllers/lsats.ts:67–85](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/lsats.ts#L67-L85)
   payForLsat calls Lightning.sendPayment(paymentRequest) with no ownerPubkey argument, so the payment is issued by whatever client loadLightning(true, undefined) returns — in proxy mode the root LND client, not the requesting tenant's sub-node. This is the line the fix must change.
2. [src/controllers/lsats.ts:125–141](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/lsats.ts#L125-L141)
   saveLsat routes any invoice whose bolt11 payee is not the requesting owner's pubkey into payForLsat. The only prior checks are that the macaroon decodes with a payment hash matching the invoice (both attacker-authored) and that the macaroon identifier is not already stored (attacker mints a fresh identifier per invoice).
3. [src/grpc/lightning.ts:127–181](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L127-L181)
   loadLightning selects the per-owner sphinx-proxy client only when tryProxy && isProxy() && ownerPubkey (line 134). With ownerPubkey undefined it returns the cached root client, or builds it with loadCredentials() — the admin macaroon at config.macaroon_location — against LND_IP:lnd_port (lines 174-181).
4. [src/grpc/lightning.ts:314–333](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L314-L333)
   sendPayment resolves the client with the (undefined) ownerPubkey. isProxy(lightning) is a config-only check, so in proxy mode the root LND client receives sendPaymentSync with the attacker's raw payment_request and fee_limit {percent: 7}; the amount is whatever the attacker encoded in the invoice and no cap is applied.
5. [src/controllers/invoices.ts:44–46](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L44-L46)
   The sanctioned payment path for a tenant, POST /invoices payInvoice, passes req.owner.publicKey so the tenant's own sub-node pays and its virtual balance is debited by sphinx-proxy. This is the tenant-scoping control that payForLsat omits.
6. [src/utils/proxy.ts:22–29](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L22-L29)
   isProxy ignores its client argument and returns true whenever proxy_lnd_port, proxy_macaroons_dir and proxy_tls_location are configured, which is why sendPayment takes the sendPaymentSync branch even when handed the root LND client.
7. [src/tests/utils/save/saveLsat.ts:11–30](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/tests/utils/save/saveLsat.ts#L11-L30)
   Supporting evidence: the maintainers' own fixture mints the LSAT macaroon with a random root key and the saveLsat test asserts success, confirming the relay never verifies macaroon authenticity; any client can fabricate a macaroon carrying its own invoice's payment hash.

## Impact
The hosting provider's root LND node makes outbound payments of attacker-chosen amounts to the attacker, repeatedly, with no debit to the tenant's virtual balance and no amount cap: a direct unauthorized transfer of the operator's Lightning funds (integrity HIGH). Draining the root node's outbound liquidity also leaves every tenant's sanctioned payInvoice path unable to pay (availability LOW). No confidentiality loss beyond the preimage of the attacker's own invoice.

## Reproduction steps
1. Attacker is any authenticated tenant of a proxy-mode relay (an ordinary x-user-token, PR:LOW), posting over the Internet-exposed HTTP port. They mint an invoice on their own node, wrap its payment hash in a self-made macaroon with a fresh identifier, and POST to /lsats; no race, no mitigation to evade, no user interaction. The deployment condition is that the relay runs in proxy mode (config.proxy_* set), a supported multi-tenant mode but not the default single-user one (AT:PRESENT).

## Recommended fix
payForLsat issues the payment through the root LND client because Lightning.sendPayment is called without the requesting owner's pubkey, so in proxy mode the tenant's action is executed with the provider's admin credential and funds instead of the tenant's own sub-node. Fix criteria: The invoice payment made for an LSAT must be executed on the requesting tenant's own node (the client selected by req.owner.publicKey, exactly as payInvoice does) in every mode; in proxy mode a tenant posting an external invoice must see their own virtual balance debited and the root node must make no direct payment. Verify by posting an external invoice as a non-root tenant and confirming the root node's payment list is unchanged and the tenant's balance decreased.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Privilege escalation
**CWE:** [CWE-269](https://cwe.mitre.org/data/definitions/269.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257998

---

# GET /invoices uses root LND client, exposing all tenants' invoices in proxy mode

## Details
In proxy mode (config.proxy_lnd_port, proxy_macaroons_dir and proxy_tls_location set; isProxy() in src/utils/proxy.ts:22) one relay serves many owners whose virtual nodes sphinx-proxy multiplexes onto a single underlying LND. Per-owner isolation of Lightning data rests entirely on each gRPC call going through `loadLightning(true, ownerPubkey)`: that branch (src/grpc/lightning.ts:139-146) builds a client with `loadProxyLightning(ownerPubkey)`, which selects `<ownerPubkey>.macaroon` from proxy_macaroons_dir and talks to the proxy port (src/utils/proxy.ts:181-203), so the proxy confines the reply to that owner.

`listInvoices`, bound to GET /invoices (src/controllers/index.ts:136) behind the ordinary owner-token middleware, instead calls `Lightning.loadLightning()` with no arguments (src/controllers/invoices.ts:243). With `tryProxy` and `ownerPubkey` undefined the proxy branch is skipped and the cached root client is returned: `new lnrpc.Lightning(LND_IP + ':' + config.lnd_port, loadCredentials())`, i.e. a direct connection to the real LND authenticated with the relay's admin macaroon (src/grpc/lightning.ts:147-181) — the same credentials getProxyRootPubkey and getProxyLNDBalance use to reach the real node. The handler then calls `listInvoices({})` and writes the raw ListInvoiceResponse to the HTTP client (invoices.ts:246-251); req.owner is only checked for presence, never used to scope the query.

All tenants' invoices are real invoices on that one LND: subscribe.ts:17-21 opens a single root-keyed invoice stream and receive.ts:647-664 attributes each settled invoice to a tenant by decoding the payee key from its payment_request, and getProxyLNDBalance compares the real node's balance with the proxy's virtual total. The response therefore hands any authenticated tenant other tenants' invoices: payment_request, memo, value, state, `r_preimage` for settled invoices (proof of payment presentable to the payer), and for keysend-received invoices `htlcs[].custom_records` carrying the raw sphinx TLV payloads (sender pubkeys, chat uuids, aliases, media tokens, invoice strings and the RSA- or group-key-encrypted message content) of messages received by other tenants. With an empty request LND returns its default first page of invoices (num_max_invoices unset; LND treats 0 as 100, an assumption about the pinned lnd protocol in proto/lightning.proto), so one call discloses the shared node's 100 oldest invoices regardless of owner; pagination fields are not accepted from the caller.

The sibling `getInvoice` passes `req.owner.publicKey` (invoices.ts:280-283) and `listPayments` is tenant-scoped at the database (payment.ts:250), so nothing the project sanctions gives a tenant another tenant's invoices. In single-tenant deployments the owner is the only tenant and nothing beyond their own data is exposed; the impact is specific to proxy mode. (The HOSTING_PROVIDER /invoices auth bypass is recorded separately at src/auth.ts:171; in proxy+HOSTING_PROVIDER mode an unauthenticated caller gets 'no owner' because req.owner is not set.)

## Evidence
1. [src/controllers/invoices.ts:240–255](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L240-L255)
   listInvoices checks req.owner only for presence, calls Lightning.loadLightning() with no tryProxy/ownerPubkey, then returns the raw listInvoices({}) response; the tenant never scopes the query.
2. [src/grpc/lightning.ts:127–181](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L127-L181)
   The proxy branch runs only when tryProxy && isProxy() && ownerPubkey; a bare call falls through to the cached root client built with loadCredentials() (admin macaroon) against LND_IP:config.lnd_port — the shared node holding every tenant's invoices.
3. [src/utils/proxy.ts:181–202](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L181-L202)
   loadProxyLightning selects <ownerPubkey>.macaroon and the proxy port: this per-owner macaroon is the tenant-isolation control that listInvoices bypasses.
4. [src/network/receive.ts:647–663](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L647-L663)
   Confirms that in proxy mode all child users' invoices live on the single root LND: the root-keyed invoice stream carries them and the relay attributes each to a tenant by decoding payeeNodeKey from payment_request.
5. [src/controllers/invoices.ts:258–287](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L258-L287)
   Sibling getInvoice passes req.owner.publicKey into getInvoiceHandler so the per-owner proxy client is used; listInvoices omits it, showing the omission is a defect rather than design.
6. [src/controllers/index.ts:136](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L136)
   GET /invoices is bound to listInvoices behind the standard owner-token middleware, so any authenticated tenant reaches it.

## Impact
Confidentiality high: other tenants' invoice records — payment requests, memos, amounts, settlement state, settled-invoice preimages (proof of payment) and raw keysend custom_records carrying received sphinx message TLVs — are disclosed to a tenant not entitled to them. Reach per call is bounded by LND's default page (100 invoices, oldest first, when num_max_invoices is unset) rather than the full ledger, but the disclosed data is other tenants' financial and messaging records. No write capability or availability effect.

## Reproduction steps
1. Any authenticated owner on a proxy-mode relay sends GET /invoices with their own x-user-token; no parameters are needed and the handler returns the shared node's invoice page. The proxy multi-tenant deployment is the only precondition (attack requirements present) and it is the deployment mode in which the co-tenant adversary exists.

## Recommended fix
listInvoices obtains the root admin-macaroon LND client instead of the requesting owner's proxy-scoped client, so the response is not confined to the tenant. Fix criteria: GET /invoices must only return invoices belonging to req.owner (by loading the client with loadLightning(true, req.owner.publicKey) as getInvoice does, or by filtering to the owner's payee key) and must not expose other tenants' preimages or custom_records. Verify in proxy mode that two tenants' GET /invoices results are disjoint.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Missing authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257986

---

# Cross-tenant subscription edit lets co-tenant set amount paid from victim's funds

## Details
sphinx-relay supports multi-tenant deployments (proxy mode / hosting provider) where each owner is a tenant and every table carries a tenant column; req.owner.id is the isolation boundary. `editSubscription` (PUT /subscription/:id) breaks that boundary: it fetches the subscription with `models.Subscription.findOne({ where: { id } })` — no tenant filter — and then unconditionally updates `cron`, `amount`, `endDate` and `endNumber` from the request body and restarts the cron job via `startCronJob(sub)`.

Subscription ids are sequential BIGINT autoincrements, so an authenticated co-tenant can enumerate them. The attacker sends `PUT /subscription/<victimSubId>` with `{ "chat_id": 1, "interval": "daily", "amount": 1000000, "end_number": 1000000 }`. The `chat_id` only needs to be truthy (`!s.chatId` check); it is not validated. The victim's subscription row is rewritten and the cron job restarted.

When the job fires, `startCronJob`'s callback resolves `owner` from `subscription.tenant` — the victim — and calls `sendSubscriptionPayment(subscription, false, owner)`, which calls `network.sendMessage({ chat, sender: owner, amount: sub.amount, ... })`. `signAndSend` then keysends from the victim's Lightning client (`LND.keysendMessage(opts, ownerPubkey)` with the victim's pubkey) to the contact in the victim's chat. The victim's funds are therefore spent at an attacker-chosen amount and cadence, repeatedly, until the balance is exhausted. If the attacker is the subscription's recipient (e.g. a creator the victim subscribed to), the attacker receives the money directly; otherwise it is pure destruction of the victim's balance. The attacker can also remove a planned end (`endNumber`/`endDate`) so a finite subscription becomes perpetual.

As a side effect the handler returns `subscriptionToJson(sub, chat)` — the victim's full subscription record (chat_id, contact_id, amount, total_paid, tenant) — to the attacker, since only the chat lookup afterwards is tenant-scoped.

All sibling handlers in the same file (`pauseSubscription`, `restartSubscription`, `getSubscription`, `deleteSubscription`'s destroy) include `tenant` in their where clause, which shows the omission here is a defect rather than design. In single-tenant deployments the only owner is the only tenant, so the issue is specific to proxy/hosting deployments.

## Evidence
1. [src/controllers/subscriptions.ts:434–456](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/subscriptions.ts#L434-L456)
   editSubscription loads the Subscription by id only (no tenant in the where clause), then writes attacker-supplied cron/amount/endDate/endNumber into it and restarts its cron job via startCronJob(sub). Every sibling handler (pause/restart/get/delete) filters by {id, tenant}.
2. [src/controllers/subscriptions.ts:414–431](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/subscriptions.ts#L414-L431)
   Request body is turned into the update object via jsonToSubscription/toCamel; the only validation is that id, a truthy chat_id and a valid interval (daily/weekly/monthly) are present. chat_id is never checked against the tenant before the update.
3. [src/controllers/subscriptions.ts:39–78](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/subscriptions.ts#L39-L78)
   The cron callback re-reads the subscription, resolves the owner Contact from subscription.tenant (the victim), and calls sendSubscriptionPayment(subscription, false, owner) with the rewritten amount.
4. [src/controllers/subscriptions.ts:131–165](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/subscriptions.ts#L131-L165)
   sendSubscriptionPayment re-reads the sub and the victim's original chat (chatId is not changed by the edit) and calls network.sendMessage with sender: owner (victim) and amount: sub.amount (attacker-chosen).
5. [src/network/send.ts:317–363](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L317-L363)
   signAndSend takes ownerPubkey = owner.publicKey (the victim's) and calls LND.keysendMessage(opts, ownerPubkey); in proxy mode loadLightning(true, ownerPubkey) selects the victim's sub-LND macaroon, so the payment is made from the victim's funds to the victim's existing subscription recipient.
6. [src/controllers/subscriptions.ts:458–461](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/subscriptions.ts#L458-L461)
   The response serialises the victim's full subscription record (chat_id, contact_id, amount, total_paid, tenant) back to the attacker; only the chat lookup is tenant-filtered, and that happens after the write.
7. [src/controllers/index.ts:121](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L121)
   PUT /subscription/:id is wired to editSubscription behind ownerMiddleware only (app.ts:131); any authenticated owner (tenant) can call it.

## Impact
Integrity high: the victim's Lightning funds are spent at attacker-chosen amounts on a recurring schedule, potentially draining the balance, and possibly into the attacker's own node. Confidentiality low: the victim's subscription record (contact id, chat id, amounts) is disclosed in the response. No availability impact beyond fund loss.

## Reproduction steps
1. Attacker is any authenticated owner on a multi-tenant (proxy/hosting) relay. They enumerate sequential subscription ids and issue PUT /subscription/<id> with a valid interval, any chat_id and a large amount. No further checks stand in the way; the cron job restarts immediately and the next tick pays from the victim's node. Requires a multi-tenant deployment, hence attack requirements present.

## Recommended fix
editSubscription resolves the target Subscription by primary key alone and never verifies it belongs to req.owner, so one tenant can mutate another tenant's payment schedule. Fix criteria: The subscription lookup and update in editSubscription must be scoped to the caller's tenant (and the supplied chat_id must belong to that tenant); a PUT against a subscription owned by a different tenant must return not-found and leave the row, the in-memory job and the response unchanged. Verify by attempting the cross-tenant edit described and confirming no change and no record disclosure.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Broken access control
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257971

---

# DELETE /profile `id` is spliced unencoded into the owner-signed tribe-server URL path, letting a personal-scope JWT holder delete the owner's tribes

## Details
`deletePersonProfile` (DELETE /profile, src/controllers/api/personal.ts:112-118) is reachable with a `personal`-scoped JWT — the one-week delegated credential POST /verify_external mints for the external web app the owner logs into (people.sphinx.chat by default). It reads `id` from the body, requires only that it be truthy, and `people.deletePerson` (src/utils/people.ts:77-83) interpolates it raw into the path of an owner-authenticated request: `DELETE https://<host>/person/<id>?token=<fresh owner-signed timestamp>`, where host defaults to config.tribes_host (tribes.sphinx.chat).

Because `id` is neither validated nor percent-encoded, a JWT holder sends `{"id":"../tribe/<tribe uuid>"}` and the relay issues `DELETE https://tribes.sphinx.chat/tribe/<uuid>?token=<valid owner token>` — byte-for-byte the request `tribes.delete_tribe` (src/utils/tribes.ts:567-580) uses to delete the owner's tribe on the tribe server, an operation the JWT scope allowlist (src/scopes.ts) reserves for the owner token. Tribe uuids are public (listed by the tribe server). Any other DELETE endpoint on the configured host that honours the owner's signed token is reachable the same way. The relay signs a fresh token per call, so the request is fully authenticated as the owner for as long as the JWT is valid.

This is a distinct root cause from the caller-chosen `host` parameter on the same route: even with `host` pinned to configuration, the `id` injection still lets a profile-management credential drive owner-only tribe administration on the tribe server. The relay-local side effect (`owner.update({priceToMeet: 0})`) is within what the scope already concedes.

Assumption: node-fetch 2.6.12 (package-lock.json) normalises absolute URLs through the WHATWG URL parser before issuing the request (parseURL → new URL(...).toString(), present since 2.6.1), which collapses the `..` segment; the tribe server (a separate repository) is assumed to accept the signed-timestamp token on DELETE /tribe/:uuid as this relay's own delete_tribe relies on.

## Evidence
1. [src/controllers/api/personal.ts:112–117](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/api/personal.ts#L112-L117)
   deletePersonProfile reads `id` (and `host`) from the JSON body, checks only that `id` is truthy, and passes it to people.deletePerson with host defaulting to config.tribes_host. The route (app.delete('/profile')) is reachable with a personal-scope JWT via ownerMiddleware's x-jwt branch.
2. [src/utils/people.ts:77–82](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/people.ts#L77-L82)
   deletePerson mints a fresh owner-signed timestamp token and issues fetch(`${protocol}://${host}/person/${id}?token=${token}`, {method:'DELETE'}) with no encoding or type check on `id`; `../tribe/<uuid>` therefore becomes DELETE /tribe/<uuid>?token=<owner token> after URL normalisation.
3. [src/utils/tribes.ts:567–589](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L567-L589)
   delete_tribe shows the project's own tribe-deletion request: DELETE `${protocol}://${getHost()}/tribe/${uuid}?token=${genSignedTimestamp(owner_pubkey)}` to config.tribes_host — identical host, method, path shape and token format to what the injected `id` produces.
4. [src/scopes.ts:10–14](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/scopes.ts#L10-L14)
   The PERSONAL JWT scope grants only /profile, /public_pic, /refresh_jwt and /claim_on_liquid; tribe deletion (DELETE /tribe/:id) is owner-token only. This allowlist is the shipped control the injection reaches around.
5. [src/controllers/auth.ts:27–47](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/auth.ts#L27-L47)
   verifyAuthRequest mints the one-week PERSONAL+BOTS JWT that the owner's app hands to the external web site during Sphinx-auth login; that third party is the holder of the credential this route accepts.

## Impact
No relay data is disclosed or destroyed: the only local write is priceToMeet reset to 0, which POST/DELETE /profile already concede to the same JWT holder. The relay's scope control is bypassed, but the resulting damage lands on the tribe server, not on the relay's own state. Subsequent-system impact: The owner-signed DELETE reaches the tribe/people server and deletes resources belonging to the owner's pubkey (tribe registry entries, person records) that the delegated credential was never granted. Impact is bounded to the victim owner's own records on that host, is deletion only, and the owner can re-register tribes; no funds or credentials are affected.

## Reproduction steps
1. The attacker holds a personal-scope JWT — the external web site the owner authenticated into via /verify_external, or anyone who obtained that token. One request, DELETE /profile with x-jwt and body {"id":"../tribe/<uuid>"}, makes the relay sign and send the tribe-deletion request as the owner. Tribe uuids are public. No user interaction, race or deployment precondition.

## Recommended fix
A caller-supplied identifier is concatenated into the URL path of an owner-authenticated outbound DELETE without validation or encoding, so it can introduce extra path segments and query parameters. Fix criteria: `id` is validated as a simple identifier (e.g. a positive integer or a strict uuid pattern) and percent-encoded as a single path segment before the URL is built; a request with id `../tribe/x` is rejected by the relay or produces a request to `/person/..%2Ftribe%2Fx`, never to `/tribe/x`.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Resource injection
**CWE:** [CWE-99](https://cwe.mitre.org/data/definitions/99.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257970

---

# JWT-reachable /profile sends node-signed auth token to attacker-chosen host

## Details
The relay's JWT scope system (src/scopes.ts) is the control that lets a third party hold limited authority over the owner's relay: POST /verify_external (owner-token only) mints a one-week `personal,bots` JWT that the Sphinx app hands, via the tribes server's /verify//poll handoff, to the people.sphinx.chat web application; ownerMiddleware (src/auth.ts:231-242) then accepts that JWT as the owner for exactly the routes allowed by its scopes. The PERSONAL allowlist is /profile, /public_pic, /refresh_jwt and /claim_on_liquid; TRIBE_ADMIN and SATS are distinct scopes that are never issued to this holder.

`createPeopleProfile` (POST /profile) and `deletePersonProfile` (DELETE /profile) read `host` from the JSON body and pass `host || config.tribes_host` straight to `people.createOrEditPerson` / `people.deletePerson` with no allowlist or comparison against the configured tribes/people host. Each of those helpers first calls `genSignedTimestamp(owner.publicKey)` (src/utils/tribes.ts:732-766), which has the owner's Lightning node sign the current unix timestamp, then issues `https://<host>/person...?token=<signed>` (http when `tribes_insecure`). That token is a bearer credential with no audience binding: the same `genSignedTimestamp` output is what the relay itself presents as proof of owner identity to the tribes host (`PUT /tribe`, `DELETE /tribe/:uuid`, channel create/delete, bot declaration), to boltwall (`/create_badge`, `/transfer_badge`, `/update_badge`, `/v1/reissue_badge`) and to liquid.sphinx.chat (`/withdraw`), and the tribes host verifies it as the owner's identity in the /verify flow.

Attack: a PERSONAL-JWT holder sends `POST /profile` with `x-jwt` and body `{"host":"attacker.example"}`; the relay mints a fresh owner-signed token and delivers it to the attacker's server in the query string. Without a server, `{"host":"nonexistent.invalid"}` makes node-fetch (2.6.12 in package-lock.json) reject with a FetchError whose message is `request to https://nonexistent.invalid/person?token=<TOKEN> failed, reason: getaddrinfo ENOTFOUND ...`; `people.ts` rethrows it unchanged and `failure(res, e)` (src/utils/res.ts:13-22) returns `e.message` in the 400 body, so the token is echoed directly to the caller. The JWT holder can repeat this at will to defeat any freshness window on the downstream services, and can keep the JWT alive via /refresh_jwt. CORS is `cors()` with default origin `*` and `x-jwt` in allowedHeaders (app.ts), so the people web page's own JavaScript can perform the call from the owner's browser.

Gain beyond what the project concedes to this position: the sanctioned /profile path sends the token only to `config.tribes_host` and never returns it to the JWT holder; /claim_on_liquid already lets the holder drive a Liquid withdrawal (that is within the conceded scope and is not the gain here). What the host parameter adds is possession of the owner's general service credential, which the holder can replay to perform tribe-admin actions (edit/delete the owner's tribes, channels, declared bots) and boltwall badge operations (transfer/update/reissue) that the TRIBE_ADMIN/SATS separation was meant to withhold. The same body-host pattern also allows SSRF (POST with partly attacker-controlled JSON) to arbitrary hosts, limited to https unless `tribes_insecure`.

`deleteTicketByAdmin` (POST /delete_ticket) has the identical pattern but is owner-token only; it is listed so the fix covers it, not as the exploit path.

Assumptions: (1) node-fetch 2.6.12 formats connection failures as `request to ${url} failed, reason: ...` (its v2 FetchError behaviour); (2) the tribes host, boltwall and liquid services accept the `genSignedTimestamp` token as the owner's identity — inferred from this repository presenting exactly that token to them on every authenticated call, since those services are external to the checkout.

## Evidence
1. [src/controllers/api/personal.ts:56–88](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/api/personal.ts#L56-L88)
   createPeopleProfile takes `host` straight from req.body and passes `host || config.tribes_host` to people.createOrEditPerson; no allowlist or comparison against the configured tribes/people host.
2. [src/utils/people.ts:43–71](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/people.ts#L43-L71)
   createOrEditPerson mints a fresh signed timestamp with the owner's node key (genSignedTimestamp) and puts it in the query string of a request to the caller-supplied host; on failure it rethrows the raw error.
3. [src/controllers/api/personal.ts:112–116](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/api/personal.ts#L112-L116)
   deletePersonProfile does the same with `host` from the body (DELETE /profile), also JWT-reachable.
4. [src/utils/people.ts:77–80](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/people.ts#L77-L80)
   deletePerson sends the signed token to the caller-supplied host.
5. [src/utils/res.ts:13–21](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/res.ts#L13-L21)
   failure() returns `e.message` to the HTTP caller. A node-fetch FetchError message is `request to <url> failed, reason: ...`, so when `host` does not resolve the token is returned directly in the 400 response body without the attacker needing a server.
6. [src/scopes.ts:10–14](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/scopes.ts#L10-L14)
   The PERSONAL JWT scope authorises /profile, /public_pic, /refresh_jwt and /claim_on_liquid only; the scope system is the boundary that is being escaped.
7. [src/auth.ts:231–241](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L231-L241)
   ownerMiddleware accepts an x-jwt header/cookie and sets req.owner to the owner contact for any route allowed by the JWT's scopes.
8. [src/controllers/auth.ts:27–48](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/auth.ts#L27-L48)
   verifyAuthRequest issues the PERSONAL+BOTS JWT and returns it in the body the client forwards to the tribes/people server, which hands it to the people web page (see src/tests/controllers/personProfile.test.ts lines 41-97).
9. [src/utils/tribes.ts:732–765](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/tribes.ts#L732-L765)
   genSignedTimestamp produces the bearer token used for every authenticated call to tribes host (edit/delete tribe), people host, boltwall (transfer/create/reissue badge) and liquid.sphinx.chat /withdraw; it is signed by the owner's Lightning node key.
10. [src/controllers/api/personal.ts:133–140](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/api/personal.ts#L133-L140)
   deleteTicketByAdmin has the same host-from-body pattern (owner-token only, so lower significance, but the same fix applies).

## Impact
The relay discloses a credential it mints with the owner's node key to a destination the limited-scope caller chooses (confidentiality: low — one credential class, not relay data at large). The token does not authenticate to the relay itself, so the relay's own data and availability are unaffected. Subsequent-system impact: The leaked token is the same owner credential this relay presents to the tribes host (PUT /tribe, DELETE /tribe/:uuid, channels, bots) and to boltwall (create/transfer/update/reissue badge), and the holder can mint fresh ones on demand. Replaying it lets the PERSONAL-scope holder edit or delete the owner's tribes and move or reissue the owner's badges — integrity loss over the owner's accounts on those services that the TRIBE_ADMIN/SATS scope separation was meant to withhold. (Liquid withdrawal is already reachable via /claim_on_liquid and is not counted as the gain.) Impact on those external services is an assumption that they accept the token as the relay's own code expects.

## Reproduction steps
1. Attacker position: holder of a PERSONAL-scoped JWT — the people.sphinx.chat web application (which receives the JWT off-device through the tribes server's /poll handoff after the owner calls /verify_external) or anyone who obtains that JWT. One HTTP request, POST /profile with x-jwt and a body `host` they control, suffices: ownerMiddleware admits the JWT for /profile, no host validation exists, and the relay either delivers the owner-signed token to the attacker's host or returns it in the 400 error body when the host does not resolve. Works over the network against any deployment with no special configuration; the JWT is a low-privilege credential the project deliberately issues to third parties, hence PR:L.

## Recommended fix
1. The destination host of a request carrying a freshly minted owner credential is taken from the request body in handlers reachable with a limited-scope JWT. Fix criteria: The people/tribes host used by /profile and /delete_ticket must come only from relay configuration (or an explicit allowlist); a body `host` differing from it must be rejected. Verify that POST /profile with an arbitrary host results in no outbound request and no token generation.
2. Error responses echo the thrown error's message, which for network failures contains the full outbound URL including the bearer token. Fix criteria: Error bodies returned to API callers must never include outbound URLs or tokens; verify that a failed /profile call returns a generic message with no `token=` substring.

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
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257968

---

# DELETE /profile returns the owner Contact row (plaintext hmacKey, push tokens) to a personal-scope JWT holder

## Details
`deletePersonProfile` (DELETE /profile, src/controllers/api/personal.ts:112-120) responds with `jsonUtils.contactToJson(owner)`, the owner's full Contact row. `contactToJson` (src/utils/json.ts:37-43) strips only `authToken` and `adminToken`, so the response carries `hmac_key` (the plaintext secret `hmacMiddleware` uses to verify `x-hmac` request signatures), `device_id` and `push_kit_token` (push-notification tokens), `last_timestamp` (transport-token replay watermark), `tenant`, `is_admin` and `person_uuid`.

DELETE /profile is in the PERSONAL JWT scope (src/scopes.ts), the one-week delegated token that POST /verify_external mints for the external people.sphinx.chat web app. That scope deliberately excludes GET /hmac_key and GET /contacts, and the relay returns the HMAC key to even the owner only RSA-encrypted to the owner's contact key (contacts.ts getHmacKey). The handler requires only a truthy `id`; `host` is also taken from the body, so a JWT holder sends `DELETE /profile` with `{id: 1, host: attacker.example}` — their server answers 200 to `DELETE /person/1?token=...`, `people.deletePerson` does not throw, the relay resets `priceToMeet` to 0 and returns the owner row. No dependency on the real people host accepting a delete.

Impact: a delegated-credential holder learns the owner's HMAC signing key and device push tokens that the JWT scope never grants. The practical value of the key is bounded: hmacMiddleware currently passes requests that omit `x-hmac` (FIXME at auth.ts:94), so the key is a secret of a control that is not yet enforced, and an auth token is still needed to act on the relay. The same `contactToJson` omission also returns hmacKey to the owner over owner-token routes (GET /contacts etc.), contradicting the encrypted-only delivery of /hmac_key; this record covers the cross-scope exposure at DELETE /profile.

## Evidence
1. [src/controllers/api/personal.ts:112–120](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/api/personal.ts#L112-L120)
   deletePersonProfile takes `id` and `host` from the request body, calls people.deletePerson(host || config.tribes_host, id, owner.publicKey), and on any 2xx from that host responds with jsonUtils.contactToJson(owner) — the whole owner Contact row — on a route the personal JWT scope can reach. Because `host` is caller-chosen, a JWT holder can point it at a server of their own that answers 200 and receive the row unconditionally.
2. [src/utils/json.ts:37–42](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/json.ts#L37-L42)
   contactToJson deletes only authToken and adminToken; hmacKey, deviceId, pushKitToken, lastTimestamp, tenant, isAdmin and personUuid remain in the serialized output.
3. [src/scopes.ts:9–16](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/scopes.ts#L9-L16)
   The PERSONAL JWT scope is limited to /profile, /public_pic, /refresh_jwt and /claim_on_liquid; /hmac_key and /contacts are not granted. This is the shipped control that bounds what the delegated token may learn, and the /profile response leaks around it.
4. [src/controllers/contacts.ts:285–313](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L285-L313)
   registerHmacKey stores the key after decrypting it from a transport-key-encrypted upload; getHmacKey returns it only RSA-encrypted to the owner's contact key. The project treats hmacKey as a secret that never leaves the relay in the clear.
5. [src/controllers/auth.ts:27–47](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/auth.ts#L27-L47)
   verifyAuthRequest mints the one-week PERSONAL+BOTS JWT for the external people host and discloses only pubkey, alias, photo_url, route_hint, contact_key and price_to_meet alongside it — what the project concedes to that holder; hmacKey and push tokens are not among them.
6. [src/auth.ts:70–104](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L70-L104)
   hmacMiddleware verifies x-hmac signatures with req.owner.hmacKey; the key is the secret of the opt-in request-signing feature. Note the FIXME: a request without x-hmac is passed through, so the key's protective value is currently limited — this bounds the impact to LOW.
7. [src/utils/people.ts:75–90](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/people.ts#L75-L90)
   deletePerson issues DELETE https://<host>/person/<id>?token=... to the caller-supplied host and throws only when the response is not ok; any 2xx from an attacker-run host satisfies it.

## Impact
Confidentiality: the owner's HMAC request-signing secret and push-notification tokens are disclosed to a delegated principal the scope system intentionally keeps away from them; the project itself only ever releases hmacKey RSA-encrypted. The disclosure is limited because hmacMiddleware does not yet reject unsigned requests and the key alone does not authenticate to the relay. Integrity: priceToMeet is reset to 0, but POST /profile in the same scope already lets the holder set it, so nothing beyond the conceded scope. Availability: none.

## Reproduction steps
1. The attacker holds a PERSONAL-scope JWT (issued to the external people web app for one week, renewable via /refresh_jwt). One request — DELETE /profile with x-jwt and body {id: <any>, host: <attacker host returning 200>} — yields the owner Contact JSON including hmac_key, device_id, push_kit_token and last_timestamp. No user interaction, no race, no deployment precondition for the row leak itself (hmac_key is populated only if the owner opted in to HMAC signing; the other fields leak regardless).

## Recommended fix
1. contactToJson removes only authToken/adminToken from the owner Contact row, leaving hmacKey and other sensitive columns (deviceId, pushKitToken, lastTimestamp) in every serialized contact. Fix criteria: contactToJson strips hmacKey (and device/push tokens) the same way it strips authToken/adminToken, so no contact serialization carries the HMAC secret in the clear; GET /hmac_key remains the only (RSA-encrypted) delivery path.
2. A handler reachable with a limited-scope JWT returns the serialized owner row instead of a response scoped to the operation. Fix criteria: Handlers reachable via JWT scopes (DELETE /profile and siblings) return only the fields the operation needs (e.g. success true / updated price_to_meet); verify a DELETE /profile response with x-jwt contains no hmac_key, device_id, push_kit_token or last_timestamp.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Information Exposure
**CWE:** [CWE-212](https://cwe.mitre.org/data/definitions/212.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257967

---

# Proxy mode: tenant badge LSAT payments are made from the provider's root node

## Details
In proxy (multi-tenant) mode every tenant payment is supposed to go through sphinx-proxy with the tenant's own macaroon, which is why `loadLightning(true, ownerPubkey)` exists (src/grpc/lightning.ts:134) and why the sibling spend paths pass the tenant's key: `invoices.payInvoice` passes `req.owner.publicKey` (src/controllers/invoices.ts:44-47) and `hub.payInviteInvoice` passes `pubkey` (src/hub.ts:290). The badge LSAT payments in `people.createBadge` (src/utils/people.ts:173) and `people.reissueBadgeOnLiquid` (src/utils/people.ts:297) call `Lightning.sendPayment(lsat.invoice)` with no `ownerPubkey`, even though `owner_pubkey` (the tenant's key, from `models.Contact.findOne({tenant, isOwner:true})` in src/controllers/api/personal.ts:242-244 / `req.owner.publicKey` at 768) is in scope and used for `genSignedTimestamp` a few lines above.

Trace in proxy mode: `sendPayment` calls `loadLightning(true, undefined)`; the proxy branch requires a truthy `ownerPubkey`, so it falls through to the cached root `lightningClient` (already populated by `genSignedTimestamp`'s `LND.loadLightning()`), or builds it from `LND_IP:config.lnd_port` with `loadCredentials()` — the relay's admin macaroon on the real LND, not the sphinx-proxy port (`config.proxy_lnd_port`). `isProxy(lightning)` ignores its argument and is true whenever the proxy config keys are set, so `lightning.sendPaymentSync(...)` is invoked on the root LND client and the boltwall invoice is paid from the hosting provider's wallet. The tenant's virtual balance in sphinx-proxy is never debited; the provider's margin (`realBal - virtualBal`, src/utils/proxy.ts:68) absorbs it.

Result: any authenticated tenant on a proxy-mode relay (x-user-token auth; the routes are outside `no_auth` and outside JWT scopes) can create or reissue badges via POST /create_badge and PUT /reissue_badge with the LSAT fee paid by the provider rather than themselves, repeatedly. The per-call amount is whatever boltwall prices the LSAT at (the relay applies only a 7% fee limit; see the separate candidate on the missing amount cap), so this is a per-tenant accounting bypass that spends another party's funds, not an arbitrary-amount drain. The same omission exists in `src/controllers/lsats.ts:80` (`payForLsat`), filed separately if at all.

This holds only when the relay is deployed in proxy mode (config.proxy_lnd_port, proxy_macaroons_dir, proxy_tls_location set) — the mode in which co-tenants exist at all; in single-owner mode the owner pays from their own node and there is no victim.

## Evidence
1. [src/utils/people.ts:173–175](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/people.ts#L173-L175)
   createBadge calls Lightning.sendPayment(lsat.invoice) without the tenant's ownerPubkey, although owner_pubkey is available in scope and is passed to genSignedTimestamp a few lines above.
2. [src/utils/people.ts:297–299](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/people.ts#L297-L299)
   reissueBadgeOnLiquid repeats the same omission.
3. [src/grpc/lightning.ts:127–144](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L127-L144)
   loadLightning(tryProxy, ownerPubkey) only selects the tenant's proxy client when ownerPubkey is supplied; otherwise it returns the cached root LND client (already populated because genSignedTimestamp called loadLightning() with no args).
4. [src/grpc/lightning.ts:314–336](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L314-L336)
   sendPayment then checks isProxy(lightning), which ignores its argument and is true whenever proxy config is set, so it calls sendPaymentSync on the root LND client — paying from the provider's wallet.
5. [src/utils/proxy.ts:22–29](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L22-L29)
   isProxy() is config-based only; it cannot distinguish a root LND client from a per-tenant proxy client.
6. [src/controllers/invoices.ts:43–46](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/invoices.ts#L43-L46)
   The sibling payInvoice correctly passes req.owner.publicKey so the tenant's own sub-account pays; the badge path does not.
7. [src/controllers/api/personal.ts:288–292](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/api/personal.ts#L288-L292)
   Any authenticated tenant can reach the payment via POST /create_badge (and PUT /reissue_badge).

## Impact
The provider's root wallet is spent on the tenant's behalf while the tenant's virtual balance is untouched — unauthorised spend of another party's Lightning funds and a corrupted provider/tenant ledger. The amount per call is set by the external boltwall price, not by the attacker, so each loss is bounded, though repetition is not. No confidentiality impact; availability of the shared node is only indirectly affected.

## Reproduction steps
1. Attacker is an authenticated tenant on a proxy-mode relay — the position the threat model names as adversary 5, which exists only in that mode, so proxy mode is the attacker's context rather than a hurdle. They call POST /create_badge (or PUT /reissue_badge for a badge they own) with well-formed fields; boltwall answers 402 with an LSAT; the relay pays the invoice from the root LND admin client instead of the tenant's sub-account and the tenant receives the badge. No user interaction, no race, deterministic, repeatable without limit.

## Recommended fix
1. The badge LSAT payment does not identify the paying tenant, so proxy-aware client selection in loadLightning falls back to the root admin-macaroon client. Fix criteria: Every payment initiated on behalf of a tenant (createBadge, reissueBadgeOnLiquid, and the same pattern in lsats.payForLsat) must pass the tenant's owner pubkey so the per-tenant sphinx-proxy client is used; in proxy mode a tenant's /create_badge and /reissue_badge must debit that tenant's sub-account and never the root node.
2. isProxy(client) ignores its argument and reports proxy mode from config alone, so a root LND client is silently treated as a per-tenant proxy client in sendPayment and the misrouting raises no error. Fix criteria: Payment paths in proxy mode must fail closed when no tenant client could be resolved (e.g. refuse to send when tryProxy was requested without an ownerPubkey, or distinguish the client type rather than the config), so a missing tenant identity cannot fall back to the root wallet.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Privilege Escalation
**CWE:** [CWE-269](https://cwe.mitre.org/data/definitions/269.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257965

---

# Badge creation auto-pays any LSAT invoice returned by boltwall without amount limit

## Details
`people.createBadge` and `people.reissueBadgeOnLiquid` implement the LSAT (L402) client flow against the configured boltwall server (`config.boltwall_server`, `https://knowledge-graph.sphinx.chat` in the shipped production config). When the server answers 402, the relay reads the `WWW-Authenticate` header, extracts the embedded bolt11 with `Lsat.fromHeader` (lsat-js 2.0.6, pinned in package-lock.json) and pays it with `Lightning.sendPayment(lsat.invoice)` under the owner's admin macaroon. Nothing decodes the invoice, compares its amount to an expected price or configured maximum, or surfaces it to the owner for approval; the owner's request body (name, icon, number of badges) carries no price at all, and the app only ever learns success or 'failed to create/reissue badge'.

The boltwall server is an external component outside this repository; the threat model places how this relay trusts such services in scope. A malicious or compromised boltwall server can respond to `/create_badge` or `/v1/reissue_badge` with a 402 whose invoice is for an arbitrary amount (bounded only by the owner's outbound channel liquidity) and payable to any node; the relay pays it in full the moment the owner performs the routine 'create badge' / 'reissue badge' action, then retries the request with the preimage.

Every other spend the relay makes is for an invoice or amount the owner supplied or has seen: `/invoices` payInvoice and `/lsats` saveLsat pay a payment_request the owner's app submitted, `/payment` and media purchases use an owner-typed amount, and invite payment pays an invoice already stored and shown. The badge path is the only one where an external service alone dictates how much the owner's node pays.

Assumption: lsat-js 2.0.6 `Lsat.fromHeader` returns the invoice embedded in the header unchanged, so the invoice (and its amount) is entirely server-chosen.

## Evidence
1. [src/utils/people.ts:168–200](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/people.ts#L168-L200)
   On a 402 from config.boltwall_server, createBadge parses the WWW-Authenticate header with Lsat.fromHeader and immediately calls Lightning.sendPayment(lsat.invoice); the invoice is never decoded, its amount is never compared to any expected price or cap, and the owner is never shown it.
2. [src/utils/people.ts:292–323](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/people.ts#L292-L323)
   reissueBadgeOnLiquid repeats the same unconditional payment for PUT /v1/reissue_badge.
3. [src/grpc/lightning.ts:314–374](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L314-L374)
   sendPayment pays the bolt11 exactly as given on every backend (LND fee_limit fixed 100 sat, proxy fee_limit 7%, GL/CLN none); no amount limit exists at this layer.
4. [src/controllers/api/personal.ts:288–292](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/api/personal.ts#L288-L292)
   POST /create_badge (owner-authenticated; not in auth.ts no_auth) is the entry point; the owner supplies only name/icon/amount-of-badges, never a price, so there is nothing to approve against.
5. [src/controllers/lsats.ts:125–140](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/lsats.ts#L125-L140)
   Contrast: the relay's generic LSAT path (saveLsat) pays only a paymentRequest the owner's app submitted, i.e. one the owner has seen; the badge path has no such owner-supplied invoice.

## Impact
Lightning funds are the relay's primary asset; an attacker-chosen invoice drains an arbitrary amount from the owner's node per badge action, with no cap other than channel liquidity. No confidentiality or availability impact on the relay itself.

## Reproduction steps
1. The attacker is whoever controls the configured boltwall server's responses — its operator, or a party that has compromised it. The victim owner performs a routine 'create badge' or 'reissue badge' action in the app; the relay receives the 402, pays the attacker-chosen invoice in full from the owner's node, and proceeds. No relay credential is needed by the attacker and no code defence stands in the way; the attack requirement is control of the boltwall service the relay is pointed at.

## Recommended fix
The LSAT invoice amount dictated by the external boltwall server is paid automatically with no upper bound and no owner approval. Fix criteria: Before paying an LSAT invoice in createBadge and reissueBadgeOnLiquid the relay must decode the bolt11 and enforce a maximum (a configured cap and/or a price the owner explicitly approved in the request, or return the invoice to the app for approval instead of paying); verify that a 402 carrying an invoice above the cap results in no payment and an error to the owner.

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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257963

---

# POST /tribe with missing fields raises unhandled rejection that crashes the relay

## Details
doJoinTribe (src/controllers/chatTribes.ts:65, behind the authenticated route POST /tribe registered at src/controllers/index.ts:234) uses the anti-pattern `new Promise(async (resolve, reject) => { ... })` and calls `reject()` without returning on two validation failures. The committed, shipped build (dist/src/controllers/chatTribes.js:54) compiles this to `new Promise((resolve, reject) => __awaiter(...))`: the executor returns the __awaiter promise, which the Promise constructor discards, so any throw after the first await rejects a promise nobody observes.

Two consequences:

1. Missing `uuid` (e.g. an empty JSON body, accepted by express.json()): the very first `await models.Chat.findOne({ where: { uuid: undefined, tenant } })` rejects — Sequelize 5 throws `WHERE parameter "uuid" has invalid "undefined" value` for undefined WHERE values. The throw happens inside the async executor, so it becomes an unhandledRejection; the outer promise is never settled, so the HTTP request also hangs.

2. Missing `owner_pubkey` (uuid and group_key present): `reject('missing required params')` fires and joinTribe returns a failure response, but execution continues to `models.Contact.findOne({ where: { publicKey: undefined, tenant } })` (lines 83-85), which rejects the same way -> unhandledRejection.

The repository registers no unhandledRejection/uncaughtException handler (app.ts and the committed dist/app.js contain only commented-out SIGTERM/exit hooks), and the production image runs node:16 (Dockerfile), where the default is `--unhandled-rejections=throw`: the relay process exits. Every tenant served by that process loses HTTP, socket.io, MQTT subscriptions and invoice processing until a supervisor restarts it, and a single request repeated at will keeps it down; the per-IP rate limiter (10 req/s) does not help since one request suffices.

Who can trigger it: any authenticated owner. In single-tenant deployments this is self-inflicted (the owner is not an adversary to its own relay), but in proxy / hosting-provider mode (threat-model adversary 5) one tenant's cheap, deterministic request kills the shared relay for all co-tenants, crossing the tenant isolation boundary. The same missing-`return` defect also means a join for an already-joined uuid rejects the request yet still sends the join keysend and creates a duplicate Chat row (lines 70-73, 146-181), a correctness bug with self-only impact.

Assumption: Sequelize ^5.19.3 (package.json; package-lock.json resolves 5.22.5) throws on undefined WHERE values in whereItemQuery, which is documented v5 behaviour; the Dockerfile removes package-lock.json before `npm install`, so any 5.x release is installed and all of them share this behaviour.

## Evidence
1. [src/controllers/chatTribes.ts:65–78](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L65-L78)
   doJoinTribe wraps its body in `new Promise(async (resolve, reject) => {...})`. The first statement queries Chat with `where: { uuid, tenant }` using the raw body uuid; the subsequent `reject(...)` calls for an existing chat and for missing params have no `return`, so execution continues past them.
2. [src/controllers/chatTribes.ts:83–85](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L83-L85)
   After the missing-params reject, Contact.findOne runs with `publicKey: undefined`. Sequelize v5 throws on an undefined WHERE value; the throw occurs inside the async executor whose own promise nobody observes, so it surfaces as an unhandledRejection rather than reaching the outer try/catch.
3. [src/controllers/chatTribes.ts:33–41](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L33-L41)
   joinTribe's try/catch awaits the outer promise only; it cannot observe the rejection of the detached async executor (and for the missing-uuid path the outer promise never settles at all, hanging the request).
4. [app.ts:170–181](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L170-L181)
   No process.on('unhandledRejection') or 'uncaughtException' handler is registered anywhere (only commented-out SIGTERM/exit hooks), so Node's default `--unhandled-rejections=throw` terminates the process.
5. [Dockerfile:23](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/Dockerfile#L23)
   The shipped image runs on node:16, where an unhandled promise rejection is fatal by default.
6. [src/controllers/contacts.ts:265–281](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L265-L281)
   doJoinTribe is also invoked from joinDefaultTribes in proxy mode, so the same code path runs for every newly provisioned tenant.

## Impact
The Node process terminates, taking down HTTP, socket.io, MQTT subscriptions and invoice processing for every tenant on the relay until restarted; repeatable at will. No data read or modified.

## Reproduction steps
1. Attacker is an authenticated tenant (any x-user-token holder) sending POST /tribe with an empty body or one lacking owner_pubkey; deterministic, no race. Cross-tenant impact needs the relay to be running in proxy/hosting-provider multi-tenant mode (non-default), hence AT:PRESENT; in single-tenant mode the only victim is the attacker themselves.

## Recommended fix
1. doJoinTribe performs validation inside a detached async Promise executor and continues executing after reject(), so request-controlled undefined values reach Sequelize and the resulting throw escapes all handlers. Fix criteria: Required fields (uuid, group_key, owner_pubkey) are validated and the handler returns a 4xx before any database query; no code path continues after a rejection; errors thrown anywhere in the join flow are caught and reported through the normal failure response. Verify that POST /tribe with an empty body and with a body lacking owner_pubkey returns an error promptly and the process stays up.
2. The process has no last-resort handler for unhandled promise rejections, so any such bug anywhere is a full-service crash shared by all tenants. Fix criteria: An unhandledRejection handler logs and contains the error (or the service is run under a supervisor with the failure isolated per tenant) so a single bad request cannot terminate service for other tenants.

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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5257962

---

# Planted-owner co-tenant attaches its own badge reward to victim's tribe via BadgeBot

## Details
The BadgeBot admin branch (src/builtin/badge.ts:44-159) resolves the tribe it acts on with `models.Chat.findOne({ where: { uuid: message.channel.id } })` and no tenant filter (48-50), although the Admin role it then checks (52-53) was derived from the sender's own Chat row (send.ts:96-106 -> bots.ts:526-533) and isBotMsg had already scoped the chat and ChatBot lookups to the sender's tenant (intercept.ts:44-47, 81-86). `/badge add <badgeId> <type> <req>` then calls addBadgeToTribe(badgeId, message.member.id, tribe.id, ...) (142-150): the Badge is looked up in the sender's tenant (member.id = sender tenant, intercept.ts:30; badge.ts:376-378) while the TribeBadge row is written for the resolved row's chat id (415-423). TribeBadge has no tenant column (models/sql/tribeBadge.ts), and Chat.uuid is neither unique nor indexed (models/sql/chat.ts:13-14), so on a multi-tenant relay the resolved row can be another tenant's.

Attacker route (co-tenant owner A on a sphinx-proxy multi-owner relay, threat-model adversary 5; victim V is a co-tenant that owns a tribe with uuid V_uuid, listed publicly on the tribe server):
1. POST /tribe {uuid: V_uuid, group_key: any, owner_pubkey: A, host: <A's host>} (controllers/index.ts:234 -> doJoinTribe, chatTribes.ts:65-169). Nothing is verified; tribeOwner resolves to A's own owner contact, contactIds = [A], sendMessage short-circuits as justMe (send.ts:118-123, 165-168) and the row {uuid: V_uuid, ownerPubkey: A, host: A's host, tenant: A, no groupPrivateKey} is created at no cost.
2. POST /create_badge (personal.ts:288-308) mints a Badge row in A's tenant through the boltwall server (external dependency, LSAT-paid). Then POST /add_badge {chat_id: planted id, badge_id} (personal.ts:473-530): the chat matches by id + ownerPubkey == A + tenant A, updateTribeServer posts to the planted row's host (A's own) with A's own signed token and succeeds, and createBadgeBot(planted.id, A) (utils/badgeBot.ts) gives A a builtin '/badge' ChatBot on the planted row.
3. POST /messages {chat_id: planted id, text: '/badge add <badgeId> 2 1'} (controllers/index.ts:229): findOrCreateChat scopes by {id, tenant} (helpers.ts:21-24); network.sendMessage sees isTribeOwner and sets role owner (send.ts:96-106); decryptMessage passes the plaintext through because the row has no groupPrivateKey (utils/msg.ts:132); isBotMsg finds A's chat and A's '/badge' ChatBot (msgTypes includes 0) and emits (intercept.ts:81-111, 142-145); buildBotPayload sets channel.id = V_uuid, member.id = A's id, roles [Admin] (bots.ts:500-535).
4. badge.ts:48 resolves `tribe` by V_uuid alone. On the shipped SQLite default the un-indexed equality scan returns the lowest rowid, V's older row (V's tribe existed before A learned its uuid); on Postgres heap order decides and A repeats. addBadgeToTribe(badgeId, A, V.id, 1, 2) loads A's Badge and writes TribeBadge {chatId: V's chat, badgeId: A's badge, rewardType 2 (spent), rewardRequirement 1, active: true}. The confirmation embed goes through finalAction -> broadcast -> getTribeOwnersChatByUUID(V_uuid) (tribes.ts:389-406), which matches both A's and V's rows, so the bot message is broadcast by whichever row the engine returns first.

Effect on V: a reward rule V never configured is active on V's tribe; V cannot see it (GET /badge_per_tribe lists only Badge rows in V's tenant, personal.ts:619-633) and cannot remove it (POST /remove_badge requires the Badge in V's tenant, personal.ts:699-705). If V's tenant holds a '/badge' ChatBot for the tribe (V installed it via /create_badge, /add_badge or '/bot install badge'), every member message, boost or payment V forwards (receive.ts:481-497 -> send.ts:142 -> badge.ts:221-318) loads the attacker's rule, loads A's Badge by id with no tenant (289-291), queries boltwall for the member's balance and calls transferBadge({asset: A's badge, to: member, owner_pubkey: V}) - V's node signs a /transfer_badge request for an asset it never issued (people.ts:214-239) on every qualifying member message (any member with totalSpent >= 1). The token goes to the configured boltwall_server, not to the attacker, so no credential leaks.

Assumptions (dependencies not present in the checkout): Sequelize 5.22.5 findOne emits LIMIT 1 without ORDER BY and SQLite returns an un-indexed equality scan in rowid order; sphinx-bot 0.2.43 Client.login(_, finalAction) routes message.channel.send({embed}) to finalAction as a 'broadcast' Action with chat_uuid = channel.id; the boltwall server (separate repository) must mint A's badge via /create_badge, and whether it honours a transfer of A's asset signed by V cannot be verified here - the confirmed impact is the cross-tenant TribeBadge write and the attacker-chosen signing/transfer requests V's relay issues. `/badge hide` on the same path is the separately verified hide-command-null-chatbot-cross-tenant-tribe-row-relay-crash and is not re-filed here.

## Evidence
1. [src/builtin/badge.ts:48–53](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/badge.ts#L48-L53)
   tribe is resolved with Chat.findOne({ where: { uuid: message.channel.id } }) with no tenant filter; the only gate is message.member.roles containing Admin, which was derived from the sender's own (planted) row, not from the row this lookup returns.
2. [src/builtin/badge.ts:142–149](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/badge.ts#L142-L149)
   `/badge add <badgeId> <type> <req>` calls addBadgeToTribe(badgeId, message.member.id /* sender tenant A */, tribe.id /* resolved row: victim's chat id */, ...).
3. [src/builtin/badge.ts:376–423](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/badge.ts#L376-L423)
   The badge is looked up in the sender's tenant (Badge.findOne({badgeId, tenant, active})) and TribeBadge.create({chatId: tribeId, badgeId: badge.id, rewardType, rewardRequirement, active: true}) is written for the victim's chat id.
4. [src/models/sql/tribeBadge.ts:13–17](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/models/sql/tribeBadge.ts#L13-L17)
   TribeBadge carries only badgeId and chatId - no tenant column - so nothing downstream can tell that the badge belongs to a different tenant than the chat.
5. [src/network/intercept.ts:30–46](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/intercept.ts#L30-L46)
   isBotMsg sets msg.sender.id = forwardedFromContactId || tenant (so member.id in the bot payload is the sending owner's id for a non-forwarded message) and scopes the Chat lookup to {uuid, tenant}; the ChatBot lookup at 81-86 is also tenant-scoped. The builtin handler then throws this scoping away by re-resolving the tribe by uuid alone.
6. [src/network/send.ts:95–106](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L95-L106)
   isTribeOwner is sender.publicKey === chat.ownerPubkey on the sender's own Chat row; for a non-forwarded message theSender.role = owner, which buildBotPayload (bots.ts:526-533) turns into the Admin role. isBotMsg is invoked at 142-147 only on this owner branch.
7. [src/controllers/chatTribes.ts:65–168](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L65-L168)
   doJoinTribe (authenticated POST /tribe, controllers/index.ts:234) stores body.uuid, body.owner_pubkey and body.host verbatim under the caller's tenant with no verification ('verify signature here?' at 81). With owner_pubkey = the caller's own key, tribeOwner is the caller's own owner contact, contactIds = [caller], sendMessage short-circuits as justMe (send.ts:118-123, 165-168) and the success callback creates the row at 167-169 with no groupPrivateKey.
8. [src/controllers/api/personal.ts:473–529](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/api/personal.ts#L473-L529)
   POST /add_badge matches the chat by id + ownerPubkey == req.owner.publicKey + tenant - satisfied by the planted row - then updateTribeServer posts to tribe.host (attacker-chosen in the planted row) with the attacker's own signed token, and calls createBadgeBot(tribe.id, tenant), giving the attacker a '/badge' ChatBot on the planted row so isBotMsg emits its '/badge' commands.
9. [src/utils/badgeBot.ts:4–22](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/badgeBot.ts#L4-L22)
   createBadgeBot creates the builtin '/badge' ChatBot with msgTypes [message, boost, direct_payment] for the given chatId/tenant; type 0 with text makes isBotMsg emit (intercept.ts:97-111).
10. [src/utils/msg.ts:128–132](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/msg.ts#L128-L132)
   decryptMessage returns the message unchanged when the chat has no groupPrivateKey, so the planted row passes the attacker's plaintext '/badge add ...' through to isBotMsg.
11. [src/builtin/badge.ts:261–303](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/badge.ts#L261-L303)
   Victim side (only if V's tenant holds a '/badge' ChatBot for its chat): on every member message, boost or payment V forwards, the non-admin branch loads TribeBadge rows by V's chatId - including the attacker-written rule - loads the Badge by id with no tenant (289-291, i.e. A's badge), queries boltwall for the member's balance and calls transferBadge({asset: A's badge, owner_pubkey: tribe.ownerPubkey = V}), so V's node signs a /transfer_badge request for an asset it never issued (people.ts:214-239).
12. [src/network/receive.ts:481–497](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L481-L497)
   forwardMessageToTribe calls sendMessage with sender = the tribe owner, isForwarded: true and forwardedFromContactId = the member, so isBotMsg (send.ts:142) runs in the owner's tenant for each member message and the badge handler's passive branch fires with member.id = the member's contact id.
13. [src/controllers/api/personal.ts:597–720](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/api/personal.ts#L597-L720)
   getBadgePerTribe lists only Badge rows in V's tenant and marks them active by TribeBadge.badgeId, so the attacker's rule is invisible to V; removeBadgeFromTribe requires Badge.findOne({tenant: V, badgeId}) and so cannot deactivate a TribeBadge whose badge lives in A's tenant.
14. [src/models/sql/chat.ts:13–14](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/models/sql/chat.ts#L13-L14)
   uuid is a plain column - not unique, not indexed (migrate.ts indexes only sphinx_chat_bots/sphinx_chat_members) - so on a multi-tenant relay several tenants hold rows with the same uuid and findOne's LIMIT 1 without ORDER BY returns whichever the engine scans first (SQLite: lowest rowid, i.e. the victim's older row; Postgres: heap order, retryable).

## Impact
Integrity LOW: the tenant boundary is crossed - an attacker-defined TribeBadge reward rule is written against the victim's chat, invisible to and irremovable by the victim through its own badge routes; a bot confirmation is broadcast into the tribe; and, where the victim runs the badge bot, the victim's node is made to sign and send /transfer_badge requests for the attacker's asset on each qualifying member message. Confidentiality NONE: the signed token goes only to the configured boltwall host. Availability NONE: the passive branch is wrapped in try/catch (badge.ts:319) and only adds boltwall round-trips per message.

## Reproduction steps
1. Attacker: an authenticated co-tenant owner on a sphinx-proxy multi-owner relay (adversary 5), using only ordinary owner routes over the network: POST /create_badge (needs the external boltwall server to mint a badge), POST /tribe to plant a row for V's public tribe uuid naming itself owner, POST /add_badge on the planted row (its host is attacker-chosen so the tribe-server call succeeds), then POST /messages '/badge add <id> 2 1'. No relay-side check is defeated (AC:L). Requires the multi-tenant deployment, a minted badge, and findOne row order - deterministic on the shipped SQLite dialect, retryable on Postgres (AT:P). No victim interaction (UI:N).

## Recommended fix
1. badge.ts resolves the tribe by uuid without tenant and addBadgeToTribe mixes the sender's tenant (for the Badge) with the resolved row's id (for the TribeBadge), so a reward rule can be attached to another tenant's chat; the passive branch likewise loads Badge by id without tenant. Fix criteria: Every builtin handler acts only on the Chat row of the tenant that emitted the message (uuid AND tenant, or the chat id passed through the bot payload) and refuses when the Badge's tenant differs from the tribe's tenant; TribeBadge rows carry and are filtered by tenant. Verify: with a planted row for V's uuid, A's '/badge add' creates no TribeBadge whose chatId belongs to V, and V's passive branch never loads a Badge outside V's tenant.
2. doJoinTribe accepts a Chat row whose uuid, ownerPubkey and host the caller set itself, and POST /add_badge treats ownerPubkey == req.owner.publicKey on such a row as tribe ownership, so any tenant can hold an 'owned' row for any uuid and obtain a BadgeBot for it. Fix criteria: Joining must reject owner_pubkey equal to the caller's own key and a uuid another local owner already owns, and must validate host against the configured tribes host; ownership checks should rely on a server-verified owner relationship rather than a caller-written column. Verify: the planting POST /tribe is rejected and /add_badge on such a row fails.

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
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258360

---

# POST /update_channel_policy lets any tenant rewrite the root node's global channel policy

## Details
POST /update_channel_policy (src/controllers/index.ts:250) is a plain owner route: details.ts:262-271 requires only req.owner, which auth.ts:273 grants to any Contact with isOwner=true and a matching authToken. In proxy/hosting mode every hosted tenant is such a contact (src/utils/proxy.ts generateNewUsers). The handler forwards the unvalidated req.body.base_fee to Lightning.updateChannelPolicies (lightning.ts:1329-1352), which calls loadLightning() with no owner pubkey. The proxy branch at lightning.ts:133 needs tryProxy && ownerPubkey, so the call always uses the cached root LND client carrying the hosting provider's admin macaroon, and issues UpdateChannelPolicy{global:true, base_fee_msat: Number(base_fee)*1000, time_lock_delta:18}. Neither the proxy client type (src/grpc/types/lnrpc_proxy) nor proto/rpc_proxy.proto define UpdateChannelPolicy, so this operation can only ever target the root node; it is operator-level configuration of the hosting node, which the project itself gates behind proxyAdminMiddleware for comparable node-level operations (index.ts:217-223: 'following routes are only for proxy admin user (isAdmin=true)') and tenant-scopes for sibling LND reads (details.ts:181 passes req.owner.publicKey to listChannels).

A co-tenant can therefore rewrite the fee policy of every active channel on the provider's node: zero (giving away routing revenue), an enormous value (effectively removing the node from forwarding paths), or a non-numeric value (Number(undefined)*1000 = NaN), and flip it repeatedly, each change broadcasting a gossip channel_update for every channel. Because fee_rate/fee_rate_ppm are omitted from the request, the proportional fee is also set from a zero field (assumption about LND's UpdateChannelPolicy semantics for the lightning.proto PolicyUpdateRequest shipped in proto/; the pinned relay dependency does not fix LND's version). The only in-repo consumer is the test harness (src/tests/controllers/fees.test.ts), where the real node 'alice' calls it and the effect is observed on a proxy virtual node, confirming the intended caller is the node operator, not a hosted tenant.

This holds in multi-tenant proxy/hosting deployments (config proxy_lnd_port, proxy_macaroons_dir, proxy_tls_location set — shipped keys in config/app.json); in single-tenant mode the sole owner is the node operator and the operation is intended. Ledger item e2-route2-no-tenant's /update_channel_policy portion is concluded here.

## Evidence
1. [src/controllers/details.ts:262–270](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/details.ts#L262-L270)
   updateChannelPolicy only checks that req.owner exists (any authenticated owner contact, including every proxy-mode tenant) and forwards the unvalidated req.body.base_fee to Lightning.updateChannelPolicies; there is no isAdmin check, no isProxy branch, and no tenant scoping.
2. [src/grpc/lightning.ts:1329–1351](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L1329-L1351)
   updateChannelPolicies calls loadLightning() with no arguments; the proxy branch at lightning.ts:133 requires tryProxy && ownerPubkey, so this always returns the cached root LND client built from the hosting node's admin macaroon. It issues UpdateChannelPolicy{global:true, base_fee_msat: Number(base_fee)*1000, time_lock_delta:18}, leaving fee_rate/fee_rate_ppm unset, so every active channel of the root node is rewritten. The proxy client type (src/grpc/types/lnrpc_proxy) and proto/rpc_proxy.proto have no UpdateChannelPolicy at all, so this call can never be scoped to a tenant's virtual node.
3. [src/controllers/index.ts:250](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L250)
   The route is registered as a plain owner route. Lines 217-223 show the project's own convention: node-level administrative operations in proxy mode are mounted behind proxyAdminMiddleware (pamid, isAdmin + isProxy); /update_channel_policy is not.
4. [src/auth.ts:273](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L273)
   ownerMiddleware sets req.owner for any Contact with isOwner=true whose sha256(authToken) matches; in proxy mode every hosted tenant is such a contact, so every tenant satisfies the handler's only check.

## Impact
An unprivileged tenant modifies operator-level configuration of the hosting Lightning node: base fee, proportional fee and CLTV delta on every active channel (integrity LOW: limited to channel-policy fields, no funds moved). Prohibitive or repeatedly flipped policies remove the node from forwarding paths, forfeit routing revenue and spam gossip updates, degrading the node's routing role shared by all tenants (availability LOW). No confidentiality effect.

## Reproduction steps
1. Any authenticated tenant of a proxy-mode relay posts {base_fee: N} with its ordinary x-user-token to /update_channel_policy; the handler's only check is that req.owner exists, and the gRPC wrapper unconditionally uses the root admin client. No admin gate, no tenant scoping, no input validation. Attack requirements PRESENT because the deployment must be a multi-tenant proxy/hosting relay for the caller to be anyone other than the node operator.

## Recommended fix
A node-wide administrative gRPC call (UpdateChannelPolicy global:true on the root LND client) is exposed on a route that any authenticated owner contact can reach, with no admin check and no tenant scoping, and the wrapper has no way to target anything but the root node. Fix criteria: In proxy/hosting mode the route is mounted behind proxyAdminMiddleware (or otherwise refuses any caller whose contact is not isAdmin), so no ordinary tenant can change the hosting node's channel policy; base_fee is validated as a finite, non-negative number before the gRPC call. Verify by posting as a non-admin tenant in proxy mode and confirming a 401/failure and unchanged root-node policies, while the admin (and the sole owner in single-tenant mode) can still update.

---
**Severity:** LOW
**Status:** Open
**Category:** Missing Authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258354

---

# POST /subscriptions lets the client choose the Subscription primary key via body spread

## Details
createSubscription (POST /subscriptions, src/controllers/subscriptions.ts:370-412) spreads the raw JSON body into the object given to models.Subscription.create(). After the spread it forces count, total_paid, createdAt, ended, paused and tenant and overwrites chatId with the tenant-scoped chat from helpers.findOrCreateChat, but it never strips `id`. jsonToSubscription/toCamel (src/utils/case.ts:34-40) rename keys without filtering, so a body `{"id": "9223372036854775807", "chat_id": <own chat>, "interval": "daily", "amount": 1}` yields s.id = "9223372036854775807". Model.build keeps the value because the PK default is null (not truthy), and Sequelize's insertQuery substitutes DEFAULT only when `autoIncrement && !value`, so the explicit non-falsy id is written as the primary key (assumption about sequelize 5.22.5, the locked version; typeValidation is off by default and the string is a valid bigint anyway).

The sphinx_subscriptions table is not defined by any migration; it is created by sequelize.sync() (src/utils/setup.ts:33) from the model, whose id is BIGINT primaryKey autoIncrement (src/models/sql/subscription.ts:5-11). Sequelize 5.22.5's sqlite createTableQuery rewrites any INT-typed PRIMARY KEY AUTOINCREMENT column as `INTEGER PRIMARY KEY AUTOINCREMENT` (assumption about the pinned dependency). config/config.json's production entry (selected by Dockerfile ENV NODE_ENV production) is sqlite. With AUTOINCREMENT, SQLite records the largest rowid ever inserted — explicit or automatic — in sqlite_sequence and returns SQLITE_FULL for every later automatic rowid once that value is 2^63-1. A JSON string id survives JS double precision and is losslessly coerced by INTEGER affinity, so one authenticated POST makes every subsequent Subscription.create on the relay fail for every tenant until an operator repairs sqlite_sequence. On Postgres (DB_DIALECT override) an explicit insert does not advance the BIGSERIAL sequence, so ids inserted just ahead of it cause one unique-constraint failure per id for whichever tenant creates next.

In a single-tenant relay the owner only harms their own data, so the impact exists in proxy / HOSTING_PROVIDER multi-tenant deployments (threat-model adversary 5), where any co-tenant with its own x-user-token denies the recurring-payment feature to all other tenants. No other tenant's rows are read or altered (tenant is forced; chat/contact lookups are scoped by owner_id in findOrCreateChat), so this is an availability issue on shared schema state. The sibling editSubscription path (lines 442-448) copies only cron/amount/endDate/endNumber into its update object, showing the create path's missing allow-list is an omission. The ledger dismissals dismissed-subscriptions-376-6e52 / -377-804d considered tenant/count/totalPaid/chatId/contactId but not the primary key.

## Evidence
1. [src/controllers/subscriptions.ts:370–411](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/subscriptions.ts#L370-L411)
   createSubscription builds the row as jsonToSubscription({...req.body, count:0, total_paid:0, createdAt, ended:false, paused:false, tenant}) and passes it straight to models.Subscription.create(s). Only count/totalPaid/createdAt/ended/paused/tenant are forced after the spread and chatId is replaced by chat.id; a body key `id` (or `ID`/`Id`, camelCased) survives and becomes the INSERT's primary-key value.
2. [src/controllers/subscriptions.ts:468–474](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/subscriptions.ts#L468-L474)
   jsonToSubscription spreads its argument and toCamel()s every key (src/utils/case.ts:34-40 has no allow-list), so any body key that camelCases to a model attribute (id, contactId, amount, endNumber, endDate, updatedAt) reaches the model.
3. [src/models/sql/subscription.ts:5–11](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/models/sql/subscription.ts#L5-L11)
   id is declared BIGINT primaryKey autoIncrement; Sequelize 5.22.5 includes a caller-supplied non-falsy primary key in the INSERT (the autoIncrement DEFAULT substitution applies only when the value is absent/falsy).
4. [src/utils/setup.ts:33](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/setup.ts#L33)
   sequelize.sync() creates sphinx_subscriptions from the model (no migration defines it); on the sqlite dialect Sequelize 5.22.5 emits `INTEGER PRIMARY KEY AUTOINCREMENT`, which is what makes an explicit max-int64 id permanently exhaust automatic rowid assignment (SQLITE_FULL) via sqlite_sequence.
5. [src/controllers/index.ts:249](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L249)
   POST /subscriptions is an ordinary authenticated owner route, reachable by every tenant in proxy/hosting-provider mode.

## Impact
No other tenant's data is read or altered; the attacker only controls the primary key of its own new row, so confidentiality and integrity of other tenants' data are unaffected. On the default sqlite backend one request permanently exhausts the AUTOINCREMENT space of sphinx_subscriptions, so every tenant's POST /subscriptions fails until manual repair of sqlite_sequence; on postgres each pre-inserted id causes one failed create for whoever is next. Loss of a single feature (recurring payments) for all tenants, not of the relay as a whole.

## Reproduction steps
1. Attacker is any authenticated owner on a multi-tenant (proxy or HOSTING_PROVIDER) relay, reached over the Internet-facing HTTP port with their own x-user-token. They send one POST /subscriptions whose JSON body is a valid subscription for one of their own chats plus an `id` key set to the maximum 64-bit value as a string (sqlite) or to values just above the current sequence (postgres). No validation, allow-list or second control stands in the way; the multi-tenant deployment is the condition under which a victim other than the attacker exists.

## Recommended fix
createSubscription passes the spread request body to Subscription.create with no attribute allow-list, so the client controls the primary key (and any other model attribute not explicitly overridden). Fix criteria: Only the intended client-settable fields (chat_id, contact_id, amount, interval, end_date, end_number) are copied into the create object, or Subscription.create is called with an explicit `fields` option excluding id, tenant, count, totalPaid, ended, paused and timestamps. Verification: a POST /subscriptions body containing `id` (any casing) results in a row whose id is autoincrement-assigned and ignores the supplied value; the same for editSubscription's inputs.

---
**Severity:** LOW
**Status:** Open
**Category:** Mass Assignment
**CWE:** [CWE-915](https://cwe.mitre.org/data/definitions/915.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258352

---

# Any tenant can drive proxy admin API to mint unclaimed owner rows via /generate_external

## Details
In proxy (multi-tenant) mode, creating a new owner/tenant through the sphinx-proxy admin API is an administrative action: GET /add_user is mounted behind proxyAdminMiddleware and admin.addProxyUser additionally requires req.admin.isAdmin before calling generateNewUser. Its sibling POST /generate_external (contacts.generateOwnerWithExternalSigner) performs the same class of action — it calls the proxy admin endpoint create_external with the relay's proxy_admin_token and inserts a new isOwner row — but is mounted with no admin middleware and the handler checks only isProxy(), never req.owner or req.admin. Any authenticated tenant on a shared proxy relay can therefore mint owner rows.

Attack: tenant A generates a fresh secp256k1 keypair, produces the proof-of-possession signature the proxy expects, and POSTs {pubkey, sig} to /generate_external with its ordinary x-user-token. The relay checks only that no owner with that pubkey exists, calls the proxy, and creates {publicKey: j.pubkey, routeHint: rootpk:j.channel, isOwner: true, authToken: null, tenant: self}. Repetition with new keys is unbounded (10 req/s/IP rate limit only). Relay-side consequences readable from this repository:
1. Onboarding-pool starvation: generateNewUsers (proxy.ts:53-59), run every 60 s by genUsersInterval whenever config.hub_api_url is set (app.ts:49-51; set in the shipped production config), treats every isOwner/authToken-null row (id != 1) as an available new user and stops generating pre-funded nodes once NEW_USER_NUM (default 2) exist. Two unclaimed attacker rows halt the provider's automatic pre-generation of real tenants until an operator deletes them.
2. Hub inventory pollution (committed dist only): massPingHubFromProxies advertises the attacker's rows to the hub as clean virtual nodes with the provider's route hint, so identities whose private key the attacker holds are offered as the provider's inventory.
3. Unlimited tenant accounts: A knows each pubkey and claims it via the unauthenticated /contacts/tokens, obtaining additional owner identities and MQTT subscriptions on the tribe server under the provider's host.
4. Response trust: generateNewExternalUser checks neither HTTP status nor the shape of j.pubkey; Contact.publicKey is nullable, so a JSON error from the proxy still creates an owner row with publicKey NULL (unclaimable, but counted in 1 and pinged in 2) — this needs no valid signature at all.

Assumption about sphinx-proxy (external, unpinned): create_external verifies sig as proof of possession of the supplied key and returns {pubkey, channel}, so the stored publicKey equals the attacker-chosen key; whether it allocates sats or channel capacity to an external user is not visible here — if it does, each minted row is also a funded account the attacker claims, raising integrity impact. Consequences 1 and 4 do not depend on that assumption.

## Evidence
1. [src/controllers/contacts.ts:162–195](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L162-L195)
   generateOwnerWithExternalSigner checks only isProxy(); it never reads req.owner or req.admin, so any caller holding any tenant's x-user-token reaches it. It forwards the body pubkey/sig to the proxy admin API via generateNewExternalUser and creates an isOwner row {publicKey: generated.publicKey, routeHint, isOwner: true, authToken: null} with tenant = own id, with no shape check on the returned pubkey.
2. [src/controllers/index.ts:86](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L86)
   POST /generate_external is mounted with no proxyAdminMiddleware (pamid), unlike the sibling provisioning route GET /add_user at line 218.
3. [src/controllers/admin.ts:112–115](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/admin.ts#L112-L115)
   The sanctioned provisioning path addProxyUser requires req.admin && req.admin.isAdmin (in addition to pamid) before calling generateNewUser — the project treats creating owner rows via the proxy admin API as an admin-only action.
4. [src/auth.ts:207–227](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L207-L227)
   ownerMiddleware resolves any x-user-token to its owner and sets req.owner; /generate_external is not in no_auth (auth.ts:122-146) and no role is required, so every tenant passes. JWTs cannot reach it (scopes.ts lists no /generate_external).
5. [src/utils/proxy.ts:126–141](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L126-L141)
   generateNewExternalUser POSTs the caller-supplied pubkey/sig to the proxy's create_external with the relay's proxy_admin_token, never checks r.ok/status, and returns {publicKey: j.pubkey, routeHint: `${rootpk}:${j.channel}`} even when j is an error object (publicKey undefined). Contact.publicKey has no allowNull:false (models/sql/contact.ts:16-17), so such a response still inserts an owner row with a NULL publicKey.
6. [src/utils/proxy.ts:48–59](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L48-L59)
   generateNewUsers counts all isOwner rows with authToken null and id != 1 and returns without pre-generating funded nodes once the count reaches NEW_USER_NUM (default 2). Attacker-minted unclaimed rows therefore halt the provider's automatic onboarding pool.
7. [app.ts:48–52](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/app.ts#L48-L52)
   genUsersInterval(60000) is started whenever config.hub_api_url is set and config.unlock is not; hub_api_url is set in the shipped config/app.json production block, so the pool-starvation timer is live in the default proxy deployment.
8. [src/hub.ts:150–188](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/hub.ts#L150-L188)
   massPingHubFromProxies reports every non-root owner row to the hub with clean = (authToken null/empty), pubkey and route_hint; attacker-minted rows are advertised as clean virtual nodes in the provider's inventory. Live in the committed dist/app.js (pingHubInterval at dist/app.js:49,79), which the Docker image runs unrebuilt, although commented out in app.ts.
9. [src/controllers/contacts.ts:207–257](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L207-L257)
   generateToken (no_auth POST /contacts/tokens) lets whoever knows the pubkey — here the minting tenant — set the authToken of each minted row, yielding unlimited extra tenant accounts, each with an MQTT subscription on the tribe server under the provider's host (tribes.newSubscription).

## Impact
Integrity LOW: unauthorised creation of owner/tenant rows and proxy-side external users through the relay's admin token, hub inventory polluted with attacker-keyed identities, unlimited extra claimed accounts. Availability LOW: the provider's automatic pre-generation of new funded tenants stops while attacker rows occupy the unclaimed pool; manual /add_user still works. No confidentiality impact established from this repository; impact would rise if the proxy funds external users (stated assumption).

## Reproduction steps
1. Attacker: any authenticated tenant of a proxy-mode relay (threat-model adversary 5), holding only its own x-user-token. Steps: generate a keypair, sign as the proxy expects (or send any body to get a NULL-key row), POST /generate_external, repeat; optionally POST /contacts/tokens {pubkey, token} to claim each row. Plain HTTP, deterministic, no victim interaction. Requires the relay to run in proxy mode with a reachable sphinx-proxy admin API — the documented multi-tenant deployment rather than the single-user default (AT:P).

## Recommended fix
1. POST /generate_external performs admin-level provisioning through the proxy admin API but is reachable by any authenticated tenant: no proxyAdminMiddleware and no req.admin check in the handler. Fix criteria: Owner provisioning via /generate_external must require the proxy-admin role (same gate as /add_user) or an operator-issued one-time credential bound to the new pubkey; verify a request with an ordinary tenant token is rejected and creates no Contact row and no proxy call.
2. The proxy's create_external response is trusted without status or shape validation, so error responses and arbitrary pubkey strings become owner rows, and unclaimed rows are counted as the onboarding pool. Fix criteria: Reject non-2xx responses and any pubkey that is not a 66-character hex string before creating the row; verify that a JSON error from the proxy yields a failure response and no Contact row, and that generateNewUsers' pool count is not inflated by externally created rows.

---
**Severity:** LOW
**Status:** Open
**Category:** Missing authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258207

---

# LND wallet unlock password written to the relay log at info level

## Details
When lnd_pwd_path is configured (the auto-unlock setup the code itself documents as "lnd_pwd_path": "/relay/.lnd/.lndpwd", the file docker/entrypoint.sh creates), tryToUnlockLND reads the first line of that file — the LND wallet password — and writes it verbatim with sphinxLogger.info(`==> ${pwd} ${typeof pwd}`) before calling Lightning.unlockWallet. The line is emitted in every default deployment: config.logging_level defaults to 'info' (src/utils/config.ts:61) and MISC-type messages bypass the per-category logging filter (src/utils/logger.ts:70-73). reconnectToLightning calls tryToUnlockLND whenever the gRPC subscription fails with UNIMPLEMENTED (wallet locked), i.e. on every LND restart and every 5 s retry while locked, so the password is written repeatedly in normal operation; the same line is present in the shipped build (dist/src/utils/unlock.js:31).

Under the Docker image, supervisor captures the relay's stdout to /var/log/supervisor/relay.log (docker/relay_supervisor.conf), which is exactly the file GET /logs returns (last 500 lines) to any authenticated owner with no tenant filter and no proxy-admin guard. In proxy/hosting mode a co-tenant therefore obtains the root node's LND wallet password over HTTP; in any deployment it lands in journald/pm2/docker logs and any log shipping. With the password, a party that can reach LND's unauthenticated WalletUnlocker service can unlock the wallet or call ChangePassword to lock the owner out, and anyone holding a copy of wallet.db can decrypt the seed. Holds only where lnd_pwd_path is set; nothing in the repository sets it, so the condition is deployment-specific but is the documented purpose of the code.

## Evidence
1. [src/utils/unlock.ts:22](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/unlock.ts#L22)
   sphinxLogger.info(`==> ${pwd} ${typeof pwd}`) writes the LND wallet password (the first line of config.lnd_pwd_path, read at line 19 and passed to Lightning.unlockWallet at line 25) to the log verbatim. This is the line the fix must remove.
2. [src/utils/config.ts:61](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/config.ts#L61)
   logging_level defaults to 'info' when neither LOGGING_LEVEL nor config.logging_level is set, so the blgr logger emits info-level lines in the default deployment.
3. [src/utils/logger.ts:70–73](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/logger.ts#L70-L73)
   sphinxLoggerBase prints any message whose loggingType is 'MISC' (the default when no type is passed, as in unlock.ts) regardless of config.logging, so the password line is not suppressed by the category filter.
4. [src/grpc/subscribe.ts:96–98](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/subscribe.ts#L96-L98)
   reconnectToLightning calls tryToUnlockLND whenever initGrpcSubscriptions fails with UNIMPLEMENTED (wallet locked) and retries every 5 s, so the password is logged on every LND restart and repeatedly while the wallet stays locked.
5. [docker/relay\_supervisor.conf:7–8](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/docker/relay_supervisor.conf#L7-L8)
   Under the Docker image supervisor writes the relay's stdout and stderr to /var/log/supervisor/relay.log, the first file GET /logs reads.
6. [src/controllers/details.ts:100–124](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/details.ts#L100-L124)
   getLogsSince returns the last 500 lines of /var/log/supervisor/relay.log (or config.log_file / pm2 / syslog) to the caller with no owner or tenant check; it is registered at src/controllers/index.ts:145 as an ordinary owner-authenticated route without proxyAdminMiddleware, so in proxy/hosting mode any co-tenant can read the logged password over HTTP.
7. [docker/entrypoint.sh:37–41](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/docker/entrypoint.sh#L37-L41)
   The image generates the wallet password and passphrase and writes them to /relay/.lnd/.lndpwd — the file unlock.ts documents as lnd_pwd_path — establishing that the first line read and logged is the LND wallet password.

## Impact
Discloses the LND wallet unlock password, a long-lived secret that on its own does not grant spending authority (the admin macaroon does) but protects the wallet seed at rest and gates the unauthenticated WalletUnlocker service: a holder who can reach LND's gRPC port can unlock the wallet or ChangePassword to lock the owner out (A:L), and one who also obtains wallet.db can decrypt the seed. In proxy mode the disclosed secret belongs to the root hosting node, not the reading tenant. Confidentiality rated LOW because the password's reach in this system depends on further access the relay does not itself provide; no integrity impact on the relay.

## Reproduction steps
1. The password is written unconditionally whenever lnd_pwd_path is set and LND reports the wallet locked; no attacker input is needed to trigger it. Readers: in proxy/hosting mode any authenticated tenant via GET /logs over the Internet-facing HTTP port (AV:N, PR:L — a tenant token; the route has no tenant filter and no proxy-admin guard), and in every deployment anyone with access to supervisor/journald/pm2/docker logs or a log aggregation sink. AT:P because lnd_pwd_path must be configured (the repository does not set it) and the line must be within the last 500 lines served by /logs, i.e. an LND restart or locked period must have occurred recently. No user interaction.

## Recommended fix
A secret read from disk solely to authenticate to LND's WalletUnlocker is interpolated into an info-level log message at src/utils/unlock.ts:22. Fix criteria: The wallet password value never appears in any log output at any level or logging type; triggering the locked-wallet path with lnd_pwd_path configured produces no log line containing the password (logging the path and whether a password was found is sufficient for diagnostics). The committed dist build must be regenerated so dist/src/utils/unlock.js no longer contains the line.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure through log
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258194

---

# Tribe resolved by uuid without tenant lets co-tenant member row capture admin bot secrets

## Details
Every tribe member keeps its own sphinx_chats row for the tribe, keyed by the same uuid but a different tenant (helpers.findOrCreateChatByUUID, chatTribes.doJoinTribe). On a multi-tenant (proxy / hosting-provider) relay a co-tenant that joins the owner's tribe therefore shares the uuid with the owner's row. Two owner-side code paths resolve the tribe by uuid alone:

1. network/send.ts interceptTribeMsgForHiddenCmds (lines 577-583), which decides whether an owner's `/bot` command must be kept private (justMe) and flagged onlyOwner; it then looks up ChatBot with the owner's tenant and the returned row's id.
2. All built-in bot handlers (callRecording.ts:52, ml.ts:49, kick.ts:41, badge.ts:48, sentiment.ts:36, jarvis.ts:25, spamGone.ts:34, welcome.ts:70, git.ts:79), which use the returned row's id and tenant for every subsequent ChatBot/Contact/ChatMember query and, in callRecording.ts:184-190, write the admin's Stakwork API key, webhook, Jitsi and S3 URLs onto that row with tribe.update().

The uuid column has no index or unique constraint and findOne adds LIMIT 1 without ORDER BY, so with duplicate uuids the row returned is whatever the engine scans first. On SQLite that is rowid order (the owner's older row), but with DB_DIALECT=postgres (models/index.ts:43-56) it is heap order, and the owner's row is rewritten constantly (receive.ts:118 seen=false on every inbound tribe message, messages.ts:901 on read), creating new tuple versions that change its physical position. Over time the co-tenant's row is returned for a share of the owner's commands.

When that happens: (a) the ChatBot lookup with the owner's tenant finds nothing, so an admin command such as `/ml api_key <key>`, `/callRecording update 1 <jitsi> <s3> <STAKWORK_API_KEY> <webhook>`, `/sentiment url …`, `/jarvis link …` or `/kick add <pubkey>` is not suppressed: it is broadcast to every tribe member (each copy RSA-encrypted to that member, readable by the co-tenant) and stored without onlyOwner, so replayChatHistory sends it to every future joiner as well; (b) callRecording's tribe.update() stores the owner's Stakwork API key and webhook in the co-tenant's Chat row, which GET /chats returns to the co-tenant because chatToJson strips only groupPrivateKey; the owner's own row is left unconfigured; (c) built-in bots that dereference the missing ChatBot (hideCommandHandler bot.hiddenCommands, kick.ts bot.meta, sentiment bot.meta) throw inside un-caught async handlers.

The attacker is a co-tenant (any hosted user) who joins the victim's public tribe — or, since doJoinTribe does not verify uuid or owner_pubkey, plants a Chat row with the victim's uuid pointing at a node of their own without ever joining — and waits for the owner's routine bot configuration. The owner cannot detect the condition. Fix: every tribe lookup on the owner path must include the owner's tenant (where: { uuid, tenant }), and the built-in bots should receive the tenant-scoped chat from the caller rather than re-resolving by uuid.

## Evidence
1. [src/network/send.ts:577–583](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L577-L583)
   interceptTribeMsgForHiddenCmds (run only for the tribe owner) resolves the tribe with models.Chat.findOne({ where: { uuid: msg.chat.uuid } }) and no tenant, then queries ChatBot with { tenant, chatId: newChat.id }. When the row returned belongs to a co-tenant member (same uuid, different tenant/id) the ChatBot query is empty, the function returns false and the hidden admin command is not suppressed.
2. [src/network/send.ts:152–167](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L152-L167)
   justMe is only set when the hidden-command check succeeds; otherwise the owner's command text is broadcast to every chat.contactIds member (encrypted per member in personalizeMessage, so every member can read it). updateMessageToIsOnlyOwner is also skipped, so the stored message keeps onlyOwner unset and is replayed to future joiners by replayChatHistory (chatTribes.ts:790-799 filters onlyOwner false/null).
3. [src/builtin/callRecording.ts:52–54](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/callRecording.ts#L52-L54)
   The built-in bot resolves `tribe` by uuid alone from message.channel.id; the same pattern is in ml.ts:49-51, kick.ts:41-43, badge.ts:48-50, sentiment.ts:36-38, jarvis.ts:25-27, spamGone.ts:34-36, welcome.ts:70-72 and git.ts:79-81.
4. [src/builtin/callRecording.ts:184–190](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/callRecording.ts#L184-L190)
   `/callRecording update` writes callRecording, jitsiServer, memeServerLocation, stakworkApiKey and stakworkWebhook with tribe.update() onto whichever tenant's Chat row was returned, i.e. onto the co-tenant's row when the lookup picks it.
5. [src/utils/json.ts:4–16](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/json.ts#L4-L16)
   chatToJson deletes only groupPrivateKey; stakworkApiKey and stakworkWebhook are returned verbatim, so the co-tenant reads the owner's Stakwork API key from its own chat row via GET /chats (chats.ts:189-198).
6. [src/controllers/chatTribes.ts:66–68](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chatTribes.ts#L66-L68)
   doJoinTribe only checks uniqueness of uuid within the joiner's tenant and stores the body-supplied uuid (lines 116-131, 167-169) — so every co-tenant that joins (or merely posts a body with the target uuid and a reachable owner_pubkey) holds a sphinx_chats row with the owner's tribe uuid under its own tenant.
7. [src/models/sql/chat.ts:13–14](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/models/sql/chat.ts#L13-L14)
   uuid is a plain column with no unique/index constraint; Sequelize findOne emits `... WHERE uuid = ? LIMIT 1` with no ORDER BY, so which of the duplicate-uuid rows is returned is left to the storage engine.
8. [src/models/index.ts:43–55](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/models/index.ts#L43-L55)
   DB_DIALECT/DB_STORAGE select Postgres at runtime (isPostgres is used by the raw tribe query), which is the deployment where heap order — not insertion order — decides which duplicate row LIMIT 1 returns.
9. [src/network/receive.ts:115–118](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/receive.ts#L115-L118)
   The owner's Chat row is rewritten (seen=false) on inbound tribe traffic and again when the owner reads (messages.ts:896-901), producing new tuple versions; on Postgres this moves the owner's row relative to the co-tenant's, so the unscoped lookup returns the co-tenant's row for a fraction of the owner's commands.
10. [src/builtin/mother.ts:56–62](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/builtin/mother.ts#L56-L62)
   The maintainers' default hidden-command list (callRecording update, kick add/remove, sentiment url, jarvis link, ml url/api_key/add) shows these commands carry configuration the owner expects to stay private to the admin; `/ml` and `/kick` are additionally always-hidden in send.ts:559.

## Impact
Confidentiality: the owner's bot secrets (Stakwork API key and webhook, ML service URL/API key, sentiment/jarvis endpoints, kick blacklist) are disclosed to all tribe members and persisted for replay — limited, non-relay credentials (LOW). Integrity: the owner's configuration is written into another tenant's row and the owner's own tribe is left unconfigured; hidden commands are recorded as public history (LOW). Availability: dereferences of the missing ChatBot throw in un-caught bot handlers (LOW). Subsequent-system impact: The leaked Stakwork API key is used by the relay as `Authorization: Token token="<key>"` against jobs.stakwork.com (builtin/utill/callRecording.ts:195-237); a holder can create and read jobs on the owner's Stakwork account.

## Reproduction steps
1. Attacker: an authenticated co-tenant on a multi-tenant relay (PR:L) who joins the victim's tribe (POST /tribe), creating a Chat row with the victim's uuid in its own tenant; no shipped control must be defeated (AC:L). Conditions outside the attacker's control (AT:P): the relay runs proxy/hosting mode on Postgres (pg is a runtime dependency; DB_DIALECT/--db select it) — on SQLite the unindexed scan returns the owner's lower-rowid row first. Assumes sequelize 5.22.5 findOne emits LIMIT 1 with no ORDER BY and Postgres seq-scan returns heap order, which the owner-row updates at receive.ts:118 and messages.ts:901 reshuffle. The victim must run a routine admin bot command carrying a secret (UI:P).

## Recommended fix
1. interceptTribeMsgForHiddenCmds resolves the chat by uuid only, although it runs on behalf of a known tenant and the uuid is shared across tenants; the subsequent ChatBot lookup silently fails and the command is treated as not hidden. Fix criteria: The chat used for hidden-command detection is the owner's own row (uuid AND tenant). Verify that, with a co-tenant row holding the same uuid, an owner `/ml api_key x` or `/callRecording update …` is never broadcast and is stored onlyOwner, regardless of row order.
2. Built-in bot handlers re-resolve the tribe by uuid without tenant and then read/write ChatBot, Contact, ChatMember and Chat rows using the returned row's id and tenant, so configuration can be written to and read from another tenant's row. Fix criteria: Bot handlers obtain the tribe scoped to the owning tenant (e.g. getTribeOwnersChatByUUID or an explicit tenant passed in the bot payload) and never update a Chat row whose tenant differs from the acting owner. Verify that `/callRecording update` cannot change any field of a co-tenant's Chat row and that the co-tenant's GET /chats never shows the owner's stakworkApiKey.
3. doJoinTribe accepts an arbitrary uuid/owner_pubkey without verification, letting a tenant plant a Chat row with any tribe's uuid. Fix criteria: Joining requires the uuid to be verifiable (signed timestamp) against the supplied owner_pubkey or the tribe server; verify a POST /tribe with a mismatched uuid/owner_pubkey pair is rejected.

---
**Severity:** LOW
**Status:** Open
**Category:** Incorrect authorization
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258176

---

# GET /channels and /getinfo return the root hosting node's channels and balances to any tenant

## Details
GET /channels (details.getChannels) and GET /getinfo (details.getLightningInfo) require only that the caller is an authenticated owner, then call Lightning.listChannels({}) and Lightning.getInfo() without an owner pubkey. loadLightning (lightning.ts:134) selects the per-tenant sphinx-proxy client only when ownerPubkey is supplied, so both handlers fall through to the cached root LND client. In proxy/hosting mode (config.proxy_lnd_port, proxy_macaroons_dir, proxy_tls_location set; tenants created by generateNewUser and authenticated with their own x-user-token) every tenant therefore receives the hosting provider's complete channel inventory: counterparties, channel points, capacity, local and remote balances, private-channel flags, unsettled balances, pending HTLC counts, plus the root node's GetInfo (alias, URIs, version, channel/peer counts, sync state). The project's own scoping is visible beside it: /balance/all passes req.owner.publicKey (details.ts:180) and the root-node /admin_balance route is gated by proxyAdminMiddleware (index.ts:223). No sanctioned path hands a tenant this data: the unauthenticated /peered oracle (utils/connect.ts:99-120) reveals only {peered, active, channel_point} for a caller-chosen pubkey, never balances or the full list. getInfo (lightning.ts:853) has no owner parameter at all, so /getinfo cannot be scoped without a signature change even though proto/rpc_proxy.proto defines per-tenant GetInfo and ListChannels. Single-tenant deployments are unaffected (the owner reads their own node); the shipped dist/src/controllers/details.js:162 contains the same unscoped call. Concludes the /channels and /getinfo portion of ledger item e2-route2-no-tenant.

## Evidence
1. [src/controllers/details.ts:139–149](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/details.ts#L139-L149)
   getChannels checks only that req.owner exists, then calls Lightning.listChannels({}) with no ownerPubkey and returns the raw ListChannelsResponse (remote_pubkey, channel_point, capacity, local_balance, remote_balance, private, pending_htlcs, unsettled_balance, etc.) to the caller.
2. [src/controllers/details.ts:127–136](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/details.ts#L127-L136)
   getLightningInfo checks only that req.owner exists, then calls Lightning.getInfo() and returns the raw GetInfo response (identity_pubkey, alias, uris, version, num_active/pending_channels, num_peers, sync state) of whichever node the root client addresses.
3. [src/grpc/lightning.ts:127–141](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L127-L141)
   loadLightning selects the per-tenant sphinx-proxy client only when tryProxy && isProxy() && ownerPubkey are all truthy; with ownerPubkey undefined it returns the cached root LND client (config.lnd_ip:lnd_port with the admin macaroon), i.e. the hosting provider's real node.
4. [src/grpc/lightning.ts:853–863](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L853-L863)
   getInfo has no ownerPubkey parameter at all and hard-codes undefined into loadLightning, so /getinfo can never be tenant-scoped even though proto/rpc_proxy.proto exposes a per-tenant GetInfo RPC.
5. [src/grpc/lightning.ts:970–976](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L970-L976)
   listChannels forwards its optional ownerPubkey into loadLightning(true, ownerPubkey); this is the only tenant-scoping hook and getChannels leaves it unset.
6. [src/controllers/index.ts:141–144](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L141-L144)
   /channels and /getinfo are registered under ownerMiddleware only (any authenticated owner); by contrast the root-node financial route /admin_balance at line 223 is placed behind proxyAdminMiddleware (pamid), showing that node-level financial state is meant for the proxy admin.
7. [src/controllers/details.ts:177–180](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/details.ts#L177-L180)
   The sibling /balance/all handler passes req.owner.publicKey to listChannels, the intended per-tenant scoping that /channels and /getinfo omit.

## Impact
Disclosure of the hosting operator's node-level financial metadata: per-channel local/remote balances, private channels, unsettled balances and pending HTLCs, plus node alias/URIs/version. Public-channel capacities and counterparties are gossip, but balances and private channels are not; no credentials, keys or other tenants' message data are exposed, so confidentiality LOW. No integrity or availability effect.

## Reproduction steps
1. Any tenant holding a valid x-user-token on a proxy-mode relay issues GET /channels or GET /getinfo over the Internet-facing HTTP port and receives the root node's data directly; no race, no user interaction, no additional secret. The only condition is that the relay runs in multi-tenant proxy mode (config.proxy_* set), a documented deployment configuration of this relay rather than a disabled control.

## Recommended fix
getChannels and getLightningInfo call the LND wrappers without the requesting owner's pubkey, and getInfo has no owner parameter, so in proxy mode both handlers always address the root node instead of the tenant's own virtual node. Fix criteria: In proxy mode /channels and /getinfo must either query the caller's own node (thread req.owner.publicKey through listChannels and a new ownerPubkey parameter on getInfo, using the rpc_proxy ListChannels/GetInfo RPCs) or be restricted to the proxy admin via proxyAdminMiddleware; verify that a non-admin tenant receives only their virtual node's channels/info and never the root node's channel list or GetInfo.

---
**Severity:** LOW
**Status:** Open
**Category:** Information Exposure
**CWE:** [CWE-200](https://cwe.mitre.org/data/definitions/200.html)
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258167

---

# Co-tenant can stop another tenant's running subscription job via DELETE by id

## Details
`deleteSubscription` (DELETE /subscription/:id, src/controllers/subscriptions.ts:333-349) performs two operations: it stops and removes the in-memory CronJob `jobs[id]`, then destroys the database row `where { id, tenant }`. The ownership (tenant) check applies only to the second step. The first step indexes the process-wide `jobs` map (line 18) with the raw `req.params.id`; that map is filled by `initializeCronJobs` with the running subscription jobs of every tenant on a multi-tenant (proxy / HOSTING_PROVIDER) relay, and a string id indexes the same property as the numeric key the job was stored under.

An authenticated co-tenant therefore issues `DELETE /subscription/<victimId>` for a sequential, enumerable id (or sweeps a range). The victim's CronJob is stopped and deleted from memory; the tenant-filtered destroy matches nothing and the handler still returns success. The victim's subscription row remains with `ended: false, paused: false`, so the victim's client shows it as active, but no further payments are made. `pauseSubscription` and `restartSubscription` only act on `jobs[id]` if it exists, so the victim's ordinary controls cannot revive it; only `editSubscription` (which calls `startCronJob`) or a relay restart recreates the job, and nothing tells the victim the schedule is dead.

This is distinct from the editSubscription defect in the same file (recorded as cross-tenant-subscription-edit-spends-victim-funds): there the DB row is mutated cross-tenant; here only the in-memory scheduler state is. Impact is limited to silently disabling another tenant's recurring payment (integrity/availability of that tenant's subscription feature); no funds move and no data is disclosed (the response is always `true`). Relies on `cron` 1.8.3 (package-lock) CronJob.stop() cancelling the scheduled timer.

## Evidence
1. [src/controllers/subscriptions.ts:333–348](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/subscriptions.ts#L333-L348)
   deleteSubscription takes req.params.id raw (line 336) and, before any ownership check, stops and deletes the in-memory CronJob jobs[id] (339-342). Only the following Subscription.destroy is scoped by { id, tenant } (343); for a foreign tenant's id it matches nothing, yet the handler still returns success(res, true). The victim's row survives with ended:false, paused:false while its job is gone.
2. [src/controllers/subscriptions.ts:17–18](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/subscriptions.ts#L17-L18)
   jobs is a single process-wide object keyed by subscription id (numeric key; req.params.id as a string indexes the same property), shared by every tenant on a multi-tenant relay.
3. [src/controllers/subscriptions.ts:21–36](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/subscriptions.ts#L21-L36)
   initializeCronJobs populates jobs with every non-ended subscription of every tenant at startup, so a victim tenant's job is present in the map the attacker's DELETE indexes.
4. [src/controllers/subscriptions.ts:245–285](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/subscriptions.ts#L245-L285)
   pauseSubscription and restartSubscription only call jobs[id].stop()/start() when the job still exists; after the cross-tenant delete they are no-ops, so the victim's normal pause/restart controls cannot revive the schedule. Only editSubscription (startCronJob at line 456) or a relay restart (initializeCronJobs) recreates it, and the victim has no signal that the job is dead.
5. [src/controllers/index.ts:120](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L120)
   DELETE /subscription/:id is wired to deleteSubscription behind only the global ownerMiddleware (app.ts:131); no proxy-admin gate (pamid) applies, so any authenticated owner/tenant can call it.

## Impact
The victim tenant's scheduled payments silently stop while the record still claims they are active (integrity low: scheduler state no longer matches the stored subscription), and the subscription feature is unavailable to that tenant until they happen to edit it or the relay restarts (availability low). No data disclosure and no fund movement.

## Reproduction steps
1. Any authenticated owner on a multi-tenant (proxy/hosting) relay sends DELETE /subscription/<id> for guessed sequential ids; the route is behind ownerMiddleware only and nothing intervenes before jobs[id].stop(). The attacker gets no success oracle (response is always true) but can simply sweep ids under the 10 req/s/IP limit. Attack requirement: the attacker must be a co-tenant of the same relay, i.e. a proxy/hosting deployment — the threat model's adversary 5.

## Recommended fix
The in-memory job is stopped and removed by raw id before verifying the subscription belongs to the requesting tenant. Fix criteria: Ownership (tenant match) must be established before any in-memory job is touched; a DELETE for another tenant's subscription id must leave that tenant's CronJob running and return not-found. Verify by issuing the cross-tenant delete and confirming the victim's job still fires.

---
**Severity:** LOW
**Status:** Open
**Category:** Broken access control
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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258166

---

# Upload handler updates any contact or chat photoUrl by id without tenant check

## Details
In proxy mode (config.proxy_lnd_port + proxy_macaroons_dir + proxy_tls_location, src/utils/proxy.ts:22-30) or HOSTING_PROVIDER=true, one relay process and one database host many owners; the threat model's tenant boundary is `req.owner.id` and every Contact/Chat row carries a `tenant` column. `uploadFile` (src/controllers/uploads.ts:51-59, reached via `POST /upload` at src/controllers/index.ts:72 behind ownerMiddleware) ignores it: after multer stores the file it runs `models.Contact.findOne({ where: { id: contact_id } })` and `models.Chat.findOne({ where: { id: chat_id } })` on the raw multipart text fields and calls `update({ photoUrl })` on whatever row matches, never reading `req.owner`.

An authenticated tenant A can therefore iterate the small sequential integer ids of the shared tables and set the `photoUrl` of any other tenant B's contacts — including B's own owner Contact row, whose photoUrl is sent as `sender.photo_url` in B's outbound tribe messages (src/network/send.ts:416-451) and shown in B's client — and of any of B's chats/tribes (tribe picture). The URL points at a file A uploaded under public/uploads, so A controls the image displayed for B. The project's own sanctioned paths for the same field, PUT /contacts/:id (contacts.ts:333) and PUT /chats/:id (chats.ts:50), both constrain the lookup with `tenant`, so /upload is the one path that crosses the boundary. The shipped dist/src/controllers/uploads.js matches.

This is a cross-tenant integrity defect (IDOR, CWE-639) in the avatar flow. It holds only when the relay is deployed multi-tenant; on a single-owner relay the caller can reach only their own rows. The separately verified filename path-traversal finding at uploads.ts:17-28 is a different defect in the same handler.

## Evidence
1. [src/controllers/uploads.ts:51–58](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/uploads.ts#L51-L58)
   uploadFile looks up Contact and Chat purely by the client-supplied multipart fields (`where: { id: contact_id }`, `where: { id: chat_id }`) with no `tenant: req.owner.id` filter and updates photoUrl on whatever row matches; req.owner is never consulted.
2. [src/controllers/uploads.ts:40–49](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/uploads.ts#L40-L49)
   photo_url is built from NODE_IP plus the uploaded filename, so the URL written into the victim tenant's row points at a file the attacker uploaded (attacker controls the image content).
3. [src/controllers/index.ts:72](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L72)
   POST /upload is registered behind ownerMiddleware (not in no_auth), so the caller is some authenticated owner; nothing restricts which tenant's ids it may name.
4. [src/controllers/contacts.ts:333](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L333)
   The sanctioned photo update path PUT /contacts/:id constrains the lookup to `{ id, tenant }`; /upload is the only path that writes photoUrl across the tenant boundary.
5. [src/controllers/chats.ts:49–50](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/chats.ts#L49-L50)
   Likewise PUT /chats/:id constrains to `{ id, tenant }` before setting photoUrl, showing the tenant filter is the project's own control that uploads.ts omits.
6. [src/network/send.ts:416–450](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/network/send.ts#L416-L450)
   The stored owner photoUrl is emitted as sender.photo_url in outbound tribe messages (unless privatePhoto), so the planted URL propagates to the victim tenant's peers.
7. [src/auth.ts:147–275](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/auth.ts#L147-L275)
   ownerMiddleware authenticates the caller as some owner (req.owner) via authToken/JWT; tenant isolation is left to each handler and is absent in uploadFile.

## Impact
Cross-tenant modification of a single profile field (contact avatar / tribe picture URL) on any row in the shared database, which then propagates to the victim tenant's client and tribe peers; no data disclosure, no availability impact.

## Reproduction steps
1. Attacker is an authenticated tenant (owner token or JWT) on a proxy/hosting multi-tenant relay, the co-tenant adversary the threat model names. One multipart POST /upload naming another tenant's contact_id or chat_id (sequential integers in the shared tables) rewrites that row's photoUrl; deterministic, no user interaction. The multi-tenant deployment mode is the only precondition (AT:P).

## Recommended fix
Contact and Chat rows in uploadFile are selected by client-supplied id alone, without constraining to the authenticated owner's tenant, unlike the project's other photoUrl update paths. Fix criteria: Both lookups must include tenant = req.owner.id and the handler must fail when req.owner is missing; a tenant supplying another tenant's contact_id or chat_id must receive no update and the victim row's photoUrl must be unchanged.

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
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258165

---

# GET /route2 resolves contact_id/chat_id without tenant filter, leaking other tenants' contact pubkeys

## Details
checkRouteByContactOrChat (GET /route2?contact_id=N or ?chat_id=N, src/controllers/details.ts:59-81) looks up the Contact or Chat by primary key only, whereas every other id lookup in the controllers adds tenant = req.owner.id (contacts.ts:333, chats.ts:50, messages.ts:316). In proxy (multi-tenant) mode all hosted owners share one Contact/Chat table with tenant = owner id (proxy.ts:121), so an authenticated tenant can iterate small integer ids and, for each contact row of any other tenant, have the relay run QueryRoutes to that contact's Lightning pubkey (with its stored route hint) and return LND's raw response; the final hop's pub_key is the destination, disclosing the other tenant's contact pubkey. When no route exists the response still distinguishes 'cant find contact' from an LND routing error, confirming the row exists. For chat ids the ownerPubkey of other tenants' tribes is disclosed the same way, revealing tribe membership. Contact pubkeys are the Sphinx identity and the relay treats contact lists as per-tenant data. The handler is shipped (dist/src/controllers/details.js:72,82). Single-tenant deployments have no other tenant to disclose; the finding holds only when the relay runs in proxy mode (config proxy_lnd_port/proxy_macaroons_dir/proxy_tls_location), the multi-tenant configuration the threat model names in scope.

## Evidence
1. [src/controllers/details.ts:59–80](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/details.ts#L59-L80)
   Contact.findOne({where:{id: contactId}}) (61-63), Chat.findOne({where:{id: chatId}}) (69-71) and Contact.findOne({where:{publicKey: chat.ownerPubkey}}) (75-77) use only the client-supplied id with no tenant predicate, so a row belonging to any tenant is selected; the distinct error strings 'cant find contact'/'cant find chat' versus proceeding to queryRoute confirm existence even when no route is returned. Shipped as dist/src/controllers/details.js:72,82.
2. [src/controllers/details.ts:82–97](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/details.ts#L82-L97)
   The resolved pubkey and routeHint are passed to Lightning.queryRoute and the response is returned verbatim via success(res, r), so the looked-up destination pubkey (final hop pub_key) and any route-hint hop reach the caller.
3. [src/grpc/lightning.ts:242–286](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/grpc/lightning.ts#L242-L286)
   queryRoute resolves the raw lnrpc QueryRoutes response (routes[].hops[].pub_key) without filtering; the route_hint is split into hop_hints for the request.
4. [src/controllers/index.ts:148](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/index.ts#L148)
   GET /route2 is registered for every authenticated owner (not in auth.ts no_auth, not JWT-scope-restricted), so any tenant's x-user-token reaches the handler.
5. [src/utils/proxy.ts:120–121](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/utils/proxy.ts#L120-L121)
   In proxy mode each hosted owner is created in the shared Contact table with tenant = its own id; tenant isolation elsewhere relies on that column, which /route2 ignores.
6. [src/controllers/contacts.ts:333](https://github.com/Halbarevi/sphinx-relay/blob/ba21d06c6303e6df8003e373fee75d19506940df/src/controllers/contacts.ts#L333)
   Comparison: the sanctioned contact-by-id path scopes with { id: req.params.id, tenant }, so the project does not concede other tenants' contact rows to a caller.

## Impact
Cross-tenant disclosure of contact-graph data: other tenants' contact Lightning pubkeys and route hints, and the owner pubkeys of tribes they belong to. No message content, keys or funds are exposed and nothing is modified: confidentiality LOW, integrity NONE, availability NONE.

## Reproduction steps
1. Any authenticated tenant on a proxy-mode relay sends GET /route2?contact_id=1..N (or chat_id) with its own x-user-token; no tenant check, no rate limit beyond the global 10 req/s/IP. Assumption: LND's lnrpc QueryRoutesResponse.routes[].hops[].pub_key (proto/lightning.proto loaded via @grpc/proto-loader; @grpc/grpc-js 1.8.7) carries the destination pubkey in the final hop; existence of the row is confirmed by the error-string difference regardless of routing success. Attack requirements PRESENT: the relay must be deployed multi-tenant (proxy mode) and a route must exist for the pubkey itself to appear.

## Recommended fix
Contact and Chat rows are selected by client-supplied primary key in /route2 without the tenant predicate the rest of the application uses for isolation. Fix criteria: All three lookups in checkRouteByContactOrChat (contact by id, chat by id, chat owner by publicKey) include tenant = req.owner.id; a request naming another tenant's contact_id/chat_id returns 'cant find contact'/'cant find chat' and never reaches queryRoute.

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
**Repository:** Halbarevi/sphinx-relay
**Branch:** main
**Commit:** ba21d06c6303e6df8003e373fee75d19506940df
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EmZNjBFdfxVkzbdJCwonPb&finding=scan_01FxykEVxGa4zA8KendQcK4o-5258161