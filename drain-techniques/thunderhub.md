# Session JWT secret is the hard-coded '123456789' unless NODE_ENV=production, which the start:prod entry point never sets

## Details
`src/server/config/configuration.ts:137-141` selects the session-signing key by `process.env.NODE_ENV === 'production'`: a 64-byte random secret in production, otherwise the constant `'123456789'`. That constant is then used by `JwtStrategy` (`jwt.strategy.ts:30`, HS256; `validate()` requires only a `sub` claim), by the GraphQL context's own `jwt.verify` (`app.module.ts:100-102`), and by `JwtModule`/the login resolvers that mint tokens. Nothing in the server sets NODE_ENV, warns beyond a 'Getting development env variables.' log line, or refuses to start without it (`main.ts`).

The project's production entry point does not set it either: `start:prod` is `node dist/main` (package.json:26) and is the Dockerfile's `CMD`. The Dockerfile and fly.toml make the server safe only by exporting `NODE_ENV=production` themselves (Dockerfile:52, fly.toml:13). The one script that does set it, `start` (`cross-env NODE_ENV=production nest start`), depends on `cross-env` and `@nestjs/cli`, both devDependencies that the documented upgrade path `scripts/updateToLatest.sh` removes (`npm prune --omit=dev`, line 29), so after an upgrade `start:prod` and the unreferenced `start:prod:env` are the only working starts. No in-repo documentation names NODE_ENV as an operator obligation: the `.env` template lists every supported variable and omits it, README defers to an external site, and there is no SECURITY.md.

With the constant key, an unauthenticated client who can reach the HTTP port takes over every YAML account: (1) `{ public { get_server_accounts { id } } }` is `@Public()` and returns each account's full hash (`account.resolver.ts:313-335`); (2) the attacker signs `{sub:'yaml:<hash>'}` (or `yaml:sso` for the SSO account) with HS256 and `123456789`; (3) sent as `Authorization: Bearer`, it passes `GqlAuthGuard`, `parseSubject` yields `{authType: YAML, id: hash}`, and every resolver's `@CurrentUser()` id feeds `AccountsService.getAccount(id)` -> `account.connection` (the admin-macaroon connection) with no further check (`node.service.ts:41-49`): pay invoices, open/close channels, send on-chain, bake macaroons, sign messages. 2FA is enforced only at login, which the forged token skips. The same mode also (a) lets `get_auth_token` issue a `yaml:sso` session for any non-empty cookie argument (`public.resolver.ts:114-118`), (b) prints the full config including MASTER_PASSWORD_OVERRIDE, YML_ENV_*, DB_POSTGRES_URL and DB_ENCRYPTION_KEY to stdout (`configuration.ts:264-266`), and (c) enables introspection/playground and `cors.origin:true` with credentials (`app.module.ts:75-82`).

Scope: holds for every deployment that starts the built server through `npm run start:prod` / `node dist/main` without `NODE_ENV=production` already in the environment - the bare-metal path the threat model lists as a deployment mode and for which the repository documents no obligation. The Docker image and fly.io descriptors are unaffected because they export the variable themselves. The threat model records the dev-mode secret as a documented operator choice; the repository contains no such documentation - what it ships is a production-named start script that silently yields a server whose sessions anyone can forge.

## Evidence
1. [src/server/config/configuration.ts:137–141](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/config/configuration.ts#L137-L141)
   isProduction is true only when process.env.NODE_ENV === 'production'; otherwise jwtSecret is the constant '123456789'. This is the code the fix must change: a release build must never sign sessions with a constant.
2. [package.json:23–27](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/package.json#L23-L27)
   `start:prod` is `node dist/main` with no NODE_ENV and is the Dockerfile's CMD. The sibling `start` sets NODE_ENV=production via cross-env but needs cross-env and @nestjs/cli, both devDependencies (lines 152, 170); `start:prod:env` sets it but is referenced nowhere.
3. [src/server/modules/security/jwt.strategy.ts:25–42](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/security/jwt.strategy.ts#L25-L42)
   GqlAuthGuard's strategy accepts any HS256 token signed with configService.get('jwtSecret') from Authorization: Bearer or the cookie; validate() requires only a `sub` claim and returns parseSubject(sub) as the acting principal.
4. [src/server/modules/node/node.service.ts:41–48](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/node/node.service.ts#L41-L48)
   getAccountAndProvider(id) resolves the principal id straight to accountsService.getAccount(id) and hands back account.connection (the admin macaroon connection) with no ownership or credential check, so a forged `yaml:<hash>` subject drives the node.
5. [src/server/modules/api/account/account.resolver.ts:313–334](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/account/account.resolver.ts#L313-L334)
   Unauthenticated get_server_accounts (@Public root) returns every YAML account's full hash as `id`, exactly the value needed in the forged `yaml:<hash>` subject.
6. [src/server/app.module.ts:99–108](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/app.module.ts#L99-L108)
   The GraphQL context independently re-verifies the token with the same jwtSecret (jwt.verify without an algorithms list), so the forged token is also accepted as context.authToken.
7. [src/server/modules/api/public/public.resolver.ts:108–117](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/public/public.resolver.ts#L108-L117)
   In the same non-production state the SSO login short-circuits (`|| !isProduction`) and issues a `yaml:sso` session for any non-empty cookie argument.
8. [src/server/config/configuration.ts:264–266](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/config/configuration.ts#L264-L266)
   Non-production also console.logs the whole config object, including MASTER_PASSWORD_OVERRIDE, YML_ENV_* account passwords, DB_POSTGRES_URL and DB_ENCRYPTION_KEY.
9. [scripts/updateToLatest.sh:19–29](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/scripts/updateToLatest.sh#L19-L29)
   The documented upgrade path runs `npm prune --omit=dev`, removing cross-env and @nestjs/cli so `npm run start` (the only script that sets NODE_ENV and is a conventional entry) stops working; `start:prod` becomes the obvious remaining start.
10. [Dockerfile:52–66](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/Dockerfile#L52-L66)
   The image is safe only because it exports ENV NODE_ENV="production" itself before `CMD npm run start:prod` (fly.toml:13 likewise); the server and its production script do not establish production mode on their own.

## Impact
A forged session is indistinguishable from a legitimate login for every YAML/SSO account on the server: full read of node data and every fund-moving and configuration mutation, including closing channels and emptying the wallet (availability of the node's funds and channels). The same mode also writes YML_ENV passwords, the DB URL and DB_ENCRYPTION_KEY to the process log. Subsequent-system impact: The forged ThunderHub session drives the connected LND/litd nodes through their admin macaroons: funds can be sent, channels force-closed, and new macaroons baked, which persist on the node beyond ThunderHub itself.

## Reproduction steps
1. The attacker is an unauthenticated client reaching the HTTP port of a server started through the project's own production script (`npm run start:prod` / `node dist/main`) with no NODE_ENV in the environment - the default outcome of that script outside the container descriptors, with no in-repo document requiring otherwise, so no deployment condition beyond that default is needed. Steps: read every account hash from the @Public get_server_accounts root; sign {sub:'yaml:<hash>'} with HS256 and '123456789'; send it as Authorization: Bearer with any query or mutation. No rate limit applies to guarded resolvers, 2FA is checked only at login (skipped), and the Bearer path is immune to cookie SameSite/CSRF controls.

## Recommended fix
1. The production start script (`start:prod`) does not establish production mode; production hardening (random JWT secret, SSO cookie enforcement, CORS off, no config dump) is keyed on an env var that only the container descriptors set. Fix criteria: Starting the built server through the repository's production script, with no environment variables beyond those the operator configures, must result in isProduction=true (random per-process JWT secret, SSO cookie check enforced, CORS origin false, no config dump). Verify by launching `npm run start:prod` with a clean environment and confirming a token signed with '123456789' is rejected.
2. The server silently falls back to a hard-coded JWT secret and disabled SSO check whenever NODE_ENV is anything but 'production', so an operator cannot tell from behaviour that they are running insecurely. Fix criteria: A hard-coded signing secret and the SSO bypass must never be used by a server built for release: either always generate a random secret (gating only developer conveniences such as playground on NODE_ENV) or refuse to start / loudly warn when a release build runs without production mode. Verify that no code path signs session tokens with a constant when started from dist/.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Hard-coded cryptographic key
**CWE:** [CWE-321](https://cwe.mitre.org/data/definitions/321.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257423

---

# Release workflow executes tag-resolved third-party actions with the Docker Hub push token in scope

## Details
The release pipeline that publishes the Docker image operators run (`apotdevin/thunderhub`, per the recorded deployment model) resolves each GitHub Action by a version tag — `docker/login-action@v4.0.0`, `docker/build-push-action@v7.0.0`, `actions/checkout@v6.0.2`, `docker/setup-qemu-action@v4.0.0`, `docker/setup-buildx-action@v4.0.0`, `docker/metadata-action@v6.0.0` — rather than by an immutable commit SHA, and nothing in the repository pins any action or image by SHA/digest. Git tags are mutable pointers in a repository this project does not control: whoever controls the upstream repository (or a compromised maintainer token/release process for it) can move the tag to a different commit, and the next `release: published` or `workflow_dispatch` run of `docker-release.yml` downloads and executes that code without any integrity check. Within that job `docker/login-action` is handed `secrets.DOCKERHUB_TOKEN` directly as an input and stores it in the runner's Docker config, and `docker/build-push-action` decides what is built and pushed; because every step shares the runner, a retargeted tag on any of the six steps can read the long-lived Docker Hub token or simply push a modified `apotdevin/thunderhub:<version>`, `:latest` and `base-<version>` image. `release-please.yml` runs a tag-resolved `googleapis/release-please-action@v4.4.0` with `contents: write` on every push to master; a retargeted tag there can rewrite non-workflow repository content that the next genuine release builds (releases created with GITHUB_TOKEN do not themselves trigger the image workflow).

This is the exposure the recorded threat model names as adversary 5 ("a compromised upstream or CI: the release workflow pushes Docker images with Docker Hub credentials"). The 2025 tj-actions/changed-files (CVE-2025-30066) and reviewdog incidents are the precedent: retargeted tags ran secret-dumping code in consuming workflows, while SHA-pinned consumers were unaffected. No compensating control is present: no SHA pinning, no Dependabot/Renovate configuration for the `github-actions` ecosystem, no `permissions:` block on the release job, no image signing or provenance attestation a consumer could use to detect a non-genuine image, and the Docker Hub credential is a long-lived token rather than a short-lived/OIDC-scoped one.

Scope notes: the repository's own `docker-compose.yaml` (`build: .`) and `fly.toml` (`dockerfile = 'Dockerfile'`) build locally and do not pull the Docker Hub image; the affected consumers are operators and node distributions that pull `apotdevin/thunderhub` from Docker Hub, which the threat model records as the primary deployment. Likelihood is bounded by the fact that all referenced actions belong to GitHub, Docker Inc. and Google first-party organisations. Assumption (unverifiable from the checkout): the referenced upstream repositories have not enabled GitHub's opt-in immutable releases for these tags; GitHub's Actions security-hardening guidance continues to recommend full-length SHA pinning for third-party actions regardless.

## Evidence
1. [.github/workflows/docker-release.yml:22–60](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/.github/workflows/docker-release.yml#L22-L60)
   All six steps are resolved by a mutable git tag, not a commit SHA: actions/checkout@v6.0.2 (l.23), docker/setup-qemu-action@v4.0.0 (l.26), docker/setup-buildx-action@v4.0.0 (l.29), docker/login-action@v4.0.0 (l.32), docker/metadata-action@v6.0.0 (l.43), docker/build-push-action@v7.0.0 (l.51). login-action receives secrets.DOCKERHUB_USERNAME/DOCKERHUB_TOKEN as plain `with:` inputs (l.34-35) and writes them to the runner's Docker config; build-push-action then pushes apotdevin/thunderhub:<version> and :latest (and base-<version>) (l.45-58). Steps before login share the same runner and workspace, so a retargeted checkout/qemu/buildx step can plant a background reader for the token or alter the checked-out source that the genuine build step then pushes. The job runs on `release: published` and `workflow_dispatch` (l.3-6) and has no `permissions:` block. `rg '@sha256|@[0-9a-f]{40}'` over .github, Dockerfile, compose, fly.toml and scripts finds no SHA or digest pin anywhere.
2. [.github/workflows/release-please.yml:8–20](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/.github/workflows/release-please.yml#L8-L20)
   googleapis/release-please-action@v4.4.0 (l.16) is likewise tag-resolved and runs with `contents: write` and `pull-requests: write` via GITHUB_TOKEN on every push to master. A retargeted tag can modify non-workflow repository content on master (e.g. Dockerfile, package.json, src/**), which the next genuine release then builds into the image. Note: releases or tags created with GITHUB_TOKEN do not fire other workflows (documented GitHub behaviour), so this path cannot by itself trigger docker-release.yml; it is a secondary, lower-impact instance of the same weakness. CODEOWNERS covers only the release-please manifest and CHANGELOG; branch-protection settings are not visible in the checkout.

## Impact
The vulnerable system is this repository's release pipeline. Its long-lived Docker Hub publishing credential is exposed to the retargeted step (confidentiality: HIGH) and the content of every image it publishes under apotdevin/thunderhub becomes attacker-controlled (integrity: HIGH). The pipeline's own availability is not materially affected (availability: NONE). Subsequent-system impact: Operators who pull apotdevin/thunderhub from Docker Hub (the deployment the threat model records; the repo's own compose/fly manifests build locally and are not affected) run the attacker's image with their LND admin macaroons and TLS certs mounted in, i.e. full read, write and denial of service over their Lightning nodes and funds.

## Reproduction steps
1. The attack is carried over the network (the runner fetches the action at run time; the attacker acts on the upstream repository). Nothing in the vulnerable workflow has to be evaded — there is no SHA pin, no permissions block and no attestation — so AC is LOW; the prerequisite that the attacker first control the upstream tag (a supply-path position outside this project, analogous to an on-path attacker) and that a maintainer then publish a release or dispatch the workflow is an attack requirement (AT:PRESENT). The attacker needs no privilege on this repository or its pipeline (PR:NONE) and no interaction beyond the maintainers' routine release action, which happens regardless of the attack (UI:NONE).

## Recommended fix
1. The release and release-please workflows download and execute third-party action code selected by a mutable git tag in a repository outside the project's control, with no integrity check binding the executed code to a reviewed revision. Fix criteria: Every `uses:` reference in .github/workflows (docker-release.yml and release-please.yml at minimum; nodejs.yml for consistency) resolves to a full-length immutable commit SHA, with the human-readable version kept as a trailing comment, and an automated update mechanism (e.g. Dependabot for the github-actions ecosystem) keeps the SHAs current; verify that no `uses:` line references a tag or branch and that a retargeted upstream tag changes nothing in the pipeline's behaviour.
2. The Docker Hub credential is a long-lived secret exposed to every step of the release job, the job has no explicit permissions scope, and the published image carries no provenance by which a consumer could detect a non-genuine push. Fix criteria: The release job declares a least-privilege `permissions:` block, the Docker Hub credential is scoped to push-only on the apotdevin/thunderhub repository and rotated (or replaced by a short-lived credential), and published images carry verifiable provenance/signatures (e.g. build attestations or cosign signatures) identifying this repository's workflow and commit; verify that a tampered push can be detected by image consumers and that the credential cannot be used beyond pushing this image.

---
**Severity:** CRITICAL
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
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257422

---

# Swap claim releases preimage to Boltz without verifying lockup amount; auto-claim fires unattended on 0-conf

## Details
In a Boltz reverse swap the user pays a hold invoice; Boltz can only settle that HTLC once it learns the preimage. The atomic-swap guarantee therefore depends on the client releasing the preimage only after verifying that Boltz's on-chain lockup pays at least the agreed `onchainAmount` to the swap script and, for an unconfirmed lockup, cannot be trivially replaced. ThunderHub releases the preimage with neither check, and does so unattended.

Flow: the browser keeps a direct WebSocket to api.boltz.exchange (BoltzSwapContext.tsx 288-317). Any `swap.update` frame whose `status` is `transaction.mempool` or `transaction.confirmed` for a stored swap id (boltzStatus.ts 45-51) makes the effect at 524-534 call `attemptAutoClaim` (442-521), which 5 s later sends the stored preimage, privateKey, redeemScript, lockupAddress and destination to `claimBoltzTransaction`; the stored `onchainAmount` (views/swap/types.ts:8) is not passed. The server (boltz.resolver.ts 132-290) fetches the transaction paying `lockupAddress` from mempool.space, finds the matching taproot output purely by script (boltz.helpers.ts 46-80), builds a claim transaction and immediately POSTs `{id, preimage, transaction, pubNonce}` to Boltz (`getReverseSwapClaimSignature`, boltz.service.ts 65-93). The output's `value` is never compared to the expected amount. From that POST on, Boltz holds the preimage and can settle the user's HTLC for the full invoice amount regardless of what the lockup pays; if the cooperative path fails, the script-path fallback (265-268) reveals the preimage on-chain anyway.

Attack (Boltz operator / compromised Boltz, threat-model adversary 3): after the user has paid the hold invoice, Boltz broadcasts a lockup to the correct swap script paying a fraction of `onchainAmount` (it must exceed the claim fee so boltz-core's constructClaimTransaction yields a valid output — a few hundred sat at the default fee), or a low-fee RBF-signalling 0-conf lockup for the full amount, and pushes `transaction.mempool` over the WS. Five seconds later ThunderHub hands Boltz the preimage. Boltz settles the LN HTLC for the full amount; the user receives only the small output, or nothing if Boltz replaces the unconfirmed lockup before the claim confirms. The manual claim (SwapClaim.tsx 195-207) has the same server-side gap but requires a click and shows a 0-conf warning; the auto-claim is fully unattended and runs for every pending swap on every page load.

Condition: new swap creation is currently disabled by the `BOLTZ_SWAPS_DISABLED = true` constants (boltz.resolver.ts:57, boltzDisabled.ts:8), while the claim path is deliberately kept live for existing swaps. The flaw is exploitable against any swap already in localStorage whose hold invoice the user paid and which is still pending, and against every swap once creation is re-enabled.

## Evidence
1. [src/server/modules/api/boltz/boltz.resolver.ts:217–259](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/boltz/boltz.resolver.ts#L217-L259)
   claimBoltzTransaction locates the lockup output with findTaprootOutput (match by tweaked key only), builds ClaimDetails from it and, in the cooperative path, calls getReverseSwapClaimSignature(id, preimage, ...) at 237-244 — handing Boltz the preimage before any signature is verified or anything is broadcast. `output.swapOutput.value` is never compared to the agreed onchainAmount; the mutation has no argument carrying the expected amount. The script-path fallback (265-268) reveals the preimage on-chain as well.
2. [src/client/src/context/BoltzSwapContext.tsx:442–534](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/context/BoltzSwapContext.tsx#L442-L534)
   attemptAutoClaim is invoked by the effect at 524-534 whenever a stored swap's liveStatus becomes claimable; 5 s later it sends preimage, privateKey, redeemScript, lockupAddress and destination to claimBoltzTransaction with no user interaction. The stored entry carries `onchainAmount` (views/swap/types.ts:8) but it is neither passed nor checked. BoltzSwapProvider is mounted at the app root (context/ContextProvider.tsx:11), so this runs on every page load for every pending swap.
3. [src/client/src/views/swap/boltzStatus.ts:45–51](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/swap/boltzStatus.ts#L45-L51)
   isClaimableStatus treats `transaction.mempool` (unconfirmed lockup) as claimable, so the preimage is released while Boltz can still replace the lockup.
4. [src/client/src/context/BoltzSwapContext.tsx:300–316](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/context/BoltzSwapContext.tsx#L300-L316)
   swap.update frames from wss://api.boltz.exchange are parsed and applied via updateStatus with no verification; the Boltz-authored `status` string alone is what drives the claim trigger.
5. [src/server/modules/api/boltz/boltz.service.ts:65–92](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/boltz/boltz.service.ts#L65-L92)
   getReverseSwapClaimSignature POSTs `{id, index, preimage, pubNonce, transaction}` to Boltz's /v2/swap/reverse/claim — the point at which the counterparty learns the preimage and can settle the user's held HTLC.
6. [src/server/modules/api/boltz/boltz.helpers.ts:46–79](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/boltz/boltz.helpers.ts#L46-L79)
   findTaprootOutput returns the first output whose script matches the tweaked MuSig key, including its `value`; no caller compares that value to anything.
7. [src/client/src/views/swap/SwapClaim.tsx:195–206](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/swap/SwapClaim.tsx#L195-L206)
   The manual claim dialog sends the same tuple without onchainAmount, so the server-side gap applies to user-initiated claims too (with a click, and an 'Instant swap … not yet confirmed' warning for 0-conf).

## Impact
The operator's Lightning HTLC (full swap amount) is settled by the counterparty while the on-chain leg delivers a fraction or is replaced: direct, irreversible loss of node funds up to the swap amount. No confidentiality or availability impact on ThunderHub itself.

## Reproduction steps
1. Attacker is whoever controls the Boltz API/WS (the Boltz operator or a compromise of api.boltz.exchange) — the swap counterparty, which the atomic protocol is designed not to trust. Precondition outside attacker control: the victim has a pending swap whose hold invoice is paid (today only swaps created before BOLTZ_SWAPS_DISABLED was set; any swap once the constant is flipped back), hence AT:PRESENT. No ThunderHub privileges are needed and the victim takes no action: the WS frame triggers the claim and the server POSTs the preimage within seconds. Assumes boltz-core ^3.1.2 detectSwap/constructClaimTransaction behave as documented (match output by script; output value = input − fee), which only constrains the attacker's lockup to exceed the claim fee.

## Recommended fix
1. The preimage is released (cooperative claim request to Boltz, or on-chain script-path claim) without comparing the located lockup output's value to the swap's agreed `onchainAmount`; the mutation has no way to receive the expected amount and neither the auto-claim nor the manual claim passes it. Fix criteria: Both claim callers pass the expected amount, and the server refuses to construct, sign, request a cooperative signature for, or broadcast any claim when the matched lockup output value is below it. Verify with a lockup paying less than onchainAmount: no request containing the preimage leaves the server and no transaction is broadcast.
2. `transaction.mempool` (0-conf) is treated as claimable with no safeguards, so the preimage is disclosed while the counterparty can still replace the lockup. Fix criteria: Unattended claiming waits for `transaction.confirmed`; any 0-conf acceptance is an explicit user opt-in that additionally verifies the lockup does not signal RBF and pays a reasonable fee. Verify that a `transaction.mempool` frame alone no longer invokes claimBoltzTransaction.

---
**Severity:** HIGH
**Status:** Open
**Category:** Reliance on untrusted inputs
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257334

---

# LNURL responses are buffered with response.json() without size or time bounds

## Details
Every LNURL resolver reads the remote service's reply with `await response.json()` (lnurl.resolver.ts:72, 97, 116, 160, 244, 288) via FetchService.fetchWithProxy (fetch.service.ts:28-32), which is Node's global fetch (Node 24.13.1 per Dockerfile; undici) called with no `signal`, no dispatcher-level `maxResponseSize` and no Content-Length check. `Response.json()` buffers the whole body into memory before parsing, so the size of the allocation is set entirely by the remote server, not by any bound in this code. The project's only outbound timeout helper, `wrapFetch` (src/server/utils/fetch.ts:20-42, used by BoltzService), is a Promise.race that does not abort the fetch or its body read, and the LNURL module does not use it anyway.

The remote host is attacker-chosen by design: fetchLnUrl and lnUrlAuth take any URL (no validateCallbackUrl), getLightningAddressInfo takes any domain, and lnUrlPay/lnUrlWithdraw/lnUrlChannel accept any public HTTPS callback. The threat model names malicious LNURL service responses as an in-scope adversary. A service that answers `200 OK` with a chunked, endless or multi-gigabyte body (e.g. an unterminated `[[[[...`) makes the server accumulate chunks until the process is OOM-killed (the documented fly.io deployment has `memory = '512mb'`, fly.toml:37) or Node aborts on allocation failure; a service that trickles bytes instead holds the request, the socket and the accumulated buffer open indefinitely, because undici's default bodyTimeout (assumption: 300 s) is an idle timer reset on every chunk. Either outcome takes down the single shared ThunderHub process for every tenant and every managed node until the supervisor restarts it, and is repeatable on each paste.

Two positions reach it: (1) an unauthenticated attacker who hands an operator an LNURL or lightning address (QR code, message) — the SPA calls lnUrlAuth automatically for tag=login (quickActions/lnurl/index.tsx:53-55) and fetchLnUrl for every other tag before any confirmation; (2) any authenticated low-privilege principal (DB user or YAML account) who calls fetchLnUrl against a host they control, crashing the process for the other tenants that share it. This is a deterministic, single-request, input-sized allocation with no code bound, distinct from the SSRF records at the same lines (`lnurl-fetch-unvalidated-url-ssrf`, `lnurl-callback-private-network-check-bypass`), which concern where the request goes rather than how much of the reply is consumed.

## Evidence
1. [src/server/modules/api/lnurl/lnurl.resolver.ts:115–116](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L115-L116)
   fetchLnUrl: fetchWithProxy(url) on the caller-supplied LNURL (any scheme/host, no validateCallbackUrl) followed by `await response.json()`, which buffers the entire remote body before parsing. No Content-Length check, no streaming cap, no AbortSignal. This is the first step of every LNURL flow in the SPA (quickActions/lnurl/index.tsx -> lnUrlModal).
2. [src/server/modules/api/lnurl/lnurl.resolver.ts:96–97](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L96-L97)
   lnUrlAuth: same unbounded `response.json()` on the host named in the pasted LNURL; the SPA fires this mutation automatically for tag=login with no confirmation step.
3. [src/server/modules/api/lnurl/lnurl.resolver.ts:69–72](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L69-L72)
   getLightningAddressInfo: fetches https://<domain>/.well-known/lnurlp/<local> for an arbitrary domain and buffers the reply with `response.json()`; the `callback/maxSendable/minSendable` validation runs only after the whole body is in memory.
4. [src/server/modules/api/lnurl/lnurl.resolver.ts:159–160](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L159-L160)
   lnUrlPay: the pay callback (any public HTTPS host passing validateCallbackUrl) is read with `response.json()` into lnServiceResponse with no size bound.
5. [src/server/modules/api/lnurl/lnurl.resolver.ts:243–244](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L243-L244)
   lnUrlWithdraw: same unbounded `response.json()` on the withdraw callback response.
6. [src/server/modules/api/lnurl/lnurl.resolver.ts:287–288](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L287-L288)
   lnUrlChannel: same unbounded `response.json()` on the channel callback response.
7. [src/server/modules/fetch/fetch.service.ts:28–32](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/fetch/fetch.service.ts#L28-L32)
   fetchWithProxy is a thin wrapper over Node's global fetch (Node 24.13.1 per Dockerfile, i.e. undici). It passes no `signal`, sets no dispatcher-level maxResponseSize, and the LNURL callers pass no options at all, so the only bound on the body read is undici's default per-chunk bodyTimeout (assumption: 300 s idle, reset on every chunk), which a trickling or fast-streaming server never trips.
8. [src/server/utils/fetch.ts:20–41](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/utils/fetch.ts#L20-L41)
   wrapFetch, the project's only outbound-HTTP timeout (used by BoltzService with 10 s), is a Promise.race that rejects the awaiting caller without aborting the underlying fetch or its body read; the LNURL module does not use even this, so no shipped control bounds response size or duration anywhere on this path.
9. [src/client/src/views/home/quickActions/lnurl/index.tsx:50–55](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/home/quickActions/lnurl/index.tsx#L50-L55)
   Operator pastes/scans an LNURL in the quick-action card; for tag=login the SPA calls lnUrlAuth immediately, for other tags it opens LnUrlModal which calls fetchLnUrl. The victim action is a routine paste of a URL supplied by the attacker.
10. [fly.toml:37](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/fly.toml#L37)
   The documented fly.io deployment runs the process in a 512 MB VM, so a response body of a few hundred MB is enough to exhaust it; docker-compose.yaml uses `restart: on-failure`, so the crash is a repeatable outage rather than a permanent one.

## Impact
Process-wide out-of-memory crash (or indefinite hold of memory and a socket) of the single ThunderHub server process, affecting all tenants and all managed nodes' UI and SSE until the supervisor restarts it; repeatable on every trigger. No data disclosure or modification.

## Reproduction steps
1. Attacker hosts an HTTPS endpoint that streams an unbounded JSON body and gets an operator to paste or scan an LNURL / lightning address pointing at it (a routine action in the quick-action card; tag=login requires no confirmation). The server buffers the body until OOM. No payment, signature or node interaction is needed because fetchLnUrl/lnUrlAuth/getLightningAddressInfo issue the fetch before any LNURL semantics are checked. Alternatively an authenticated low-privilege tenant can trigger it directly via fetchLnUrl against its own host with no victim interaction (PR:L/UI:N); the metrics rate the broader unauthenticated-with-victim-interaction route. Relies on Node 24.13.1 global fetch (undici) having no default response-size limit and a per-chunk idle bodyTimeout, stated as an assumption from the pinned runtime, not verified in the checkout.

## Recommended fix
Untrusted LNURL responses are fully buffered via response.json() with no cap on body size and no abortable request timeout. Fix criteria: All LNURL fetches must carry an AbortSignal timeout that cancels the underlying request (not a Promise.race), reject responses whose Content-Length exceeds a small cap (LNURL replies are a few KiB), and read the body as a stream that aborts once that cap is exceeded before JSON parsing; non-JSON content types should be rejected. Verify that a host streaming an endless or slow body causes the mutation to fail within the timeout with bounded memory use.

---
**Severity:** HIGH
**Status:** Open
**Category:** Allocation without limits
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257331

---

# Encrypted YAML macaroons are protected by single-iteration MD5 EVP_BytesToKey, enabling fast offline cracking

## Details
ThunderHub's `encrypted: true` account option exists so that the admin macaroon stored in the account YAML (inline `macaroon:` or the file at `macaroonPath`, read as utf-8 text at files.service.ts:210) is not usable by someone who merely obtains the file — a backup, a read-only volume, a leaked config. The decryption routine `decodeMacaroon` (src/server/utils/crypto.ts:22-41) derives the AES-256-CBC key and IV with `evpBytesToKey` (crypto.ts:44-66): OpenSSL's legacy EVP_BytesToKey, i.e. MD5(password||salt), MD5(prev||password||salt), MD5(prev||password||salt) — exactly three MD5 compressions for the 48 bytes of key+IV, with no iteration count or memory cost. Testing one candidate password therefore costs three MD5 calls plus one AES block decryption, and the PKCS#7 padding of the final block (the only check `decipher.final()` performs) is the correctness oracle. Standard password-cracking tooling implements this exact OpenSSL `Salted__`/EVP_BytesToKey format and runs it at tens of GH/s per commodity GPU, so an 8-character mixed-case alphanumeric password (62^8 ≈ 2×10^14) falls in hours on one GPU and a 10-character one in weeks on a small rig — password strengths an operator would reasonably believe adequate.

This is the sole at-rest control for encrypted accounts. The decrypted macaroon is held only in memory (`updateAccountMacaroon`, accounts.service.ts:217-232) and every YAML rewrite (`saveHashedYaml`, invoked by `hashPasswords` and `updateTwofaSecret`) re-emits the still-encrypted blob, so the file never contains the plaintext — the protection is entirely the KDF. It is also inconsistent with the protection the project applies to the very same password in the very same file: `hashPasswords` bcrypt-hashes it with cost 12 (files.service.ts:151-171). For encrypted accounts that bcrypt hash is never consulted — `get_session_token` (public.resolver.ts:222-246) calls `decodeMacaroon` in the encrypted branch and only reaches `isCorrectPassword` in the else branch — so the slow hash protects nothing while the fast MD5 derivation guards the asset the password actually exists for.

The format is chosen for compatibility with crypto-js `AES.encrypt(text, passphrase)` output (comment at crypto.ts:20), but it is the only scheme the server accepts, not a legacy path kept beside a stronger one; the repository ships no encryption tool and no documentation of a password-strength requirement (the only in-repo mention of `encrypted` is docs/ADDING_A_PROVIDER.md:211 listing it as a field). Threat-model relevance: adversary 4 (read-only disk or backup access) is explicitly in scope for secrets at rest, and an admin macaroon equals full control of the node's funds.

## Evidence
1. [src/server/utils/crypto.ts:43–65](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/utils/crypto.ts#L43-L65)
   evpBytesToKey derives the AES-256 key and IV from the password with iterated MD5 over password||salt — one MD5 per 16 bytes of output, three MD5 calls total, no work factor. This is the OpenSSL legacy EVP_BytesToKey scheme.
2. [src/server/utils/crypto.ts:20–40](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/utils/crypto.ts#L20-L40)
   decodeMacaroon is the only supported format for encrypted macaroons: 'Salted__' + 8-byte salt + AES-256-CBC ciphertext, keyed solely by evpBytesToKey. A wrong password is detected only by decipher.final()'s PKCS#7 padding check (caught at line 37-40), the same cheap check an offline cracker uses as its correctness oracle.
3. [src/server/modules/files/files.service.ts:337–353](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/files/files.service.ts#L337-L353)
   For encrypted accounts the blob read from YAML/macaroonPath is kept as encryptedMacaroon; the operator's intent is that disk/backup exposure of this file does not reveal the admin macaroon.
4. [src/server/modules/files/files.service.ts:151–170](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/files/files.service.ts#L151-L170)
   The same file protects login passwords with bcrypt cost 12 (~2^12 iterations of Blowfish setup). The macaroon — the asset the password actually protects — is derived with a KDF several orders of magnitude cheaper, so the bcrypt protection is irrelevant for encrypted accounts whose login path (public.resolver.ts:222-237) never consults the bcrypt hash.

## Impact
Successful cracking discloses both the account's login password (the decryption passphrase is the password accepted by get_session_token for encrypted accounts) and the admin macaroon, the most sensitive secret ThunderHub holds; within ThunderHub this is a confidentiality loss, and the recovered password additionally lets the attacker log in over the network as that account (subject to 2FA if configured). Cracking a copied file does not alter or disable ThunderHub itself. Subsequent-system impact: An admin macaroon is a bearer credential for the LND/litd node itself: with it and the node's socket (serverUrl, present in the same file) the attacker can read all node state, pay invoices, open/close channels, send on-chain funds and bake further macaroons directly against the node, independent of ThunderHub.

## Reproduction steps
1. The attacker must first obtain a copy of the encrypted blob (the account YAML or the macaroonPath file), which is operator-owned configuration readable only with the service user's or root's privileges on the host, or via a backup/volume snapshot (LOCAL, PR:H as for other at-rest secrets in this project). Attack requirements PRESENT: the target account must be declared `encrypted: true` and the attacker must hold the file copy. From there the attack is entirely offline against a three-MD5 KDF with a built-in PKCS#7 padding oracle using standard cracking tooling; no runtime defence, throttle or server interaction applies, and no user interaction is needed.

## Recommended fix
Password-to-key derivation for macaroons at rest uses legacy MD5 EVP_BytesToKey with no work factor, so the at-rest protection is only as strong as brute-forcing the password at hash-speed, far weaker than the bcrypt protection the same password receives. Fix criteria: Encrypted macaroons are derived with a memory-/time-hard KDF (e.g. scrypt, Argon2id or PBKDF2 with a high iteration count) and an authenticated cipher, with the legacy crypto-js format accepted only for a one-time migration that re-encrypts on first successful login. Verify: cracking cost per guess is dominated by the KDF work factor, and newly written encrypted blobs are not in the Salted__/EVP_BytesToKey format.

---
**Severity:** HIGH
**Status:** Open
**Category:** Weak key derivation
**CWE:** [CWE-916](https://cwe.mitre.org/data/definitions/916.html)
**Attack vector:** LOCAL
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257329

---

# SSO cookie file is written with default permissions, readable by other local users

## Details
`FilesService.readCookie` (files.service.ts:476-478) initialises the SSO cookie file by calling `fs.writeFileSync(cookieFile, crypto.randomBytes(64).toString('hex'))` without a `mode`, and `refreshCookie` (493-510) rewrites it the same way after every successful SSO login (a rewrite of an existing file never changes its mode). Node creates the file 0o666 masked by the process umask, which on typical Linux hosts yields 0644 — readable by every local account. The code does create missing parent directories with mode 0o700 (`createDirectory`, 429-452), showing the secret is meant to be private to the ThunderHub uid, but when the parent directory already exists (a mounted data volume, a home directory, a shared config dir) that protection does not apply and the file mode alone decides who can read the secret. The repository's only guidance on COOKIE_PATH is `.env:60` (`COOKIE_PATH='/path/to/cookie/.cookie'`); nothing tells the operator to place the file in a private directory or to chmod it.

The cookie file content is the SSO bearer secret: `get_auth_token` (public.resolver.ts:112-147) is `@Public()`, compares the submitted `cookie` argument against the file and, on match, issues a 24-hour `yaml:sso` JWT bound to the SSO account whose macaroon is the admin.macaroon read from SSO_MACAROON_PATH (files.service.ts:418, accounts.service.ts:35-58). A different, unprivileged local user on a multi-user host can `cat $COOKIE_PATH`, submit it to the GraphQL endpoint and take over the node — funds, channels, configuration. The rotation on successful login does not help: the attacker's own login performs the rotation, and the legitimate wrapper simply reads the new value next time.

The same pattern applies to the account YAML when ThunderHub itself creates it (`parseYaml`, 65-74): the file is created with default permissions and later populated by `saveHashedYaml` (96-107) with bcrypt password hashes and plaintext TOTP seeds, all readable by other local users.

This holds only for bare-metal (`npm run start:prod`) deployments on a host with more than one local uid where the COOKIE_PATH directory pre-exists or is otherwise traversable; the Docker image (`USER node`, single process) and fly.io deployments have no second local user and are not affected.

## Evidence
1. [src/server/modules/files/files.service.ts:476–478](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/files/files.service.ts#L476-L478)
   readCookie creates the SSO cookie file with fs.writeFileSync(cookieFile, randomHex) and no mode option (line 478), so the file is created 0o666 masked by the process umask — 0644 under the usual 022, world-readable. createDirectory on the preceding line protects only directories that did not already exist.
2. [src/server/modules/files/files.service.ts:493–509](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/files/files.service.ts#L493-L509)
   refreshCookie rewrites the file on every successful SSO login, again with no mode; an existing permissive mode is preserved.
3. [src/server/modules/files/files.service.ts:429–451](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/files/files.service.ts#L429-L451)
   createDirectory does apply mode 0o700 to directories it creates, showing the maintainers intend the cookie to be private — but this only helps when the parent directory did not already exist. For a pre-existing COOKIE_PATH directory (the common case: a mounted data volume or home directory) the file alone decides who can read the secret.
4. [src/server/modules/api/public/public.resolver.ts:112–146](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/public/public.resolver.ts#L112-L146)
   Anyone who can read the file content can present it to the unauthenticated get_auth_token mutation and receive a 24h session as the SSO account with the node's admin macaroon.
5. [src/server/modules/files/files.service.ts:65–73](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/files/files.service.ts#L65-L73)
   Same sink pattern for the account YAML: when ACCOUNT_CONFIG_PATH does not exist parseYaml creates it with default permissions; saveHashedYaml later writes bcrypt hashes and TOTP secrets into that same world-readable file.

## Impact
Possession of the cookie yields a full SSO session, i.e. complete control over the managed node through ThunderHub: all node data readable, funds and channels controllable, service disruptable.

## Reproduction steps
1. An unprivileged local user on the same host (LOCAL, PR LOW) reads the world-readable cookie file whenever its parent directory pre-existed or is traversable (AT PRESENT), then uses the value in a normal get_auth_token call. No defensive mechanism has to be defeated.

## Recommended fix
Secret-bearing files (SSO cookie, auto-created account YAML) are created and rewritten without an explicit restrictive mode, so their readability depends on the umask and on whether ThunderHub happened to create the parent directory. Fix criteria: The cookie file and any config file ThunderHub creates or rewrites are owner-read/write only (0600) regardless of umask or pre-existing directory state, including on refresh. Verify: after startup and after an SSO login, stat on COOKIE_PATH shows no group/other read bits.

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
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257328

---

# lnUrlPay pays LNURL-service invoice with no routing-fee limit or description-hash check

## Details
`lnUrlPay` (src/server/modules/api/lnurl/lnurl.resolver.ts:130-212) implements LUD-06 LNURL-pay. After GETting the callback with the user's chosen `amount`, it takes the `pr` BOLT11 invoice verbatim from the remote service's JSON (159-175), checks only that `decoded.tokens <= amount` (185-195), and calls `nodeService.pay(id, { request: pr })` (197-199). `NodeService.pay` (node.service.ts:221-224) and `LndService.pay` (lnd.service.ts:278-280) pass the options object straight to `lightning`'s `pay()`; `PayOptions.max_fee` / `max_fee_mtokens` (lightning.types.ts:76-84) are never set on this path, and the client confirms only the sat amount (LnPay.tsx:176-196).

1. No routing-fee ceiling (financial impact). The invoice author — the LNURL service, i.e. the payee — controls the destination and the BOLT11 `r` route hints, whose `fee_base_msat` and `fee_proportional_millionths` fields are each 32-bit (up to ~4.29M sat base and ~4294x the amount proportionally). A malicious service returns an invoice for <= `amount` to a private node reachable only through a hop it operates, with an extreme hint fee. The amount check passes; the payer's node pays `amount` to the destination and the hint fee to the attacker's routing node. The only practical bound is the payer's outbound balance / max HTLC on the first hop (single path, `max_paths` unset). The project's generic `pay` mutation makes `max_fee: Float!` mandatory (schema.gql:570; invoices.resolver.ts:109-111), so the maintainers' own model is that an invoice payment carries an explicit, user-approved fee ceiling; lnUrlPay bypasses that control.

   Dependency assumption (library source not read): `lightning@11.1.0` (package.json pin) `subscribeToPay`, used by `pay()` for `request` payments, defaults `fee_limit_sat` to `Number.MAX_SAFE_INTEGER` when `max_fee`/`max_fee_mtokens` are unset, i.e. no fee limit at LND's SendPaymentV2. The repository's own usages corroborate this: magma.resolver.ts:444 and amboss.resolver.ts:128 pay real multi-hop Magma invoices with the same bare `{ request }` call, which would only ever find zero-fee routes if the default were LND's `fee_limit = 0`.

2. No description-hash verification (integrity, no direct loss). LUD-06 requires the wallet to check the invoice `h` tag equals sha256(metadata) from the first response. The resolver never reads `decoded.description_hash` or receives `metadata`, so the payee information shown to the user is not bound to the invoice paid.

The analogous unbounded payments of Amboss/Magma-supplied invoices are recorded separately (magma.resolver.ts:444, amboss.resolver.ts:118); this is a different entry point reachable from any LNURL-pay link or lightning address the operator chooses to pay.

## Evidence
1. [src/server/modules/api/lnurl/lnurl.resolver.ts:185–198](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L185-L198)
   The remote `pr` is decoded and rejected only if decoded.tokens > amount; then nodeService.pay(id, { request: pr }) is called with no max_fee / max_fee_mtokens, no destination check, and no comparison of the invoice description_hash with sha256(metadata) as LUD-06 requires.
2. [src/server/modules/api/lnurl/lnurl.resolver.ts:158–175](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L158-L175)
   `pr` comes verbatim from the JSON returned by the LNURL callback host, i.e. from the payee's server; its route hints and destination are entirely under that party's control.
3. [src/server/modules/node/lnd/lnd.service.ts:278–279](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/node/lnd/lnd.service.ts#L278-L279)
   LndService.pay spreads the options straight into lightning's pay(); nothing adds a fee bound on the way to LND.
4. [src/server/modules/node/lightning.types.ts:76–83](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/node/lightning.types.ts#L76-L83)
   PayOptions exposes max_fee and max_fee_mtokens as optional; the resolver leaves both unset.
5. [schema.gql:570](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/schema.gql#L570)
   The project's generic `pay` mutation makes `max_fee: Float!` mandatory, showing the maintainers' own model that a payment must carry an explicit fee ceiling; lnUrlPay (line 564) has no such argument and sets none internally.
6. [src/client/src/views/home/quickActions/lnurl/LnPay.tsx:176–195](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/home/quickActions/lnurl/LnPay.tsx#L176-L195)
   The user confirms a sat amount only; no fee is shown or bounded on the client either.

## Impact
Loss of funds from the operator's node beyond the amount the user approved: the fee component is chosen by the payee via route-hint fields (up to ~4.29M sat base plus ~4294x the amount) and is capped in practice only by the payer's outbound channel balance / max HTLC on the first hop, since no fee limit reaches LND. The secondary missing description-hash check removes the integrity link between displayed metadata and the invoice paid. No confidentiality or availability effect.

## Reproduction steps
1. Attacker operates (or has compromised) an LNURL-pay service / lightning address plus a Lightning node that is routable from the victim's node. The operator pays the address from ThunderHub for N sats (routine action, UI:ACTIVE). The callback returns a BOLT11 invoice for <= N sats whose only route hint goes through the attacker's node with a very large base/proportional fee. The server's `decoded.tokens > amount` check passes and pay() is issued with no max_fee, so — assuming lightning@11.1.0 defaults fee_limit_sat to Number.MAX_SAFE_INTEGER when max_fee is unset (corroborated by the project's own bare `{ request }` payments of multi-hop Magma invoices) — LND routes through the hinted hop and the attacker collects the fee. No privileges on ThunderHub are needed; the attacker only needs to be the payee.

## Recommended fix
1. lnUrlPay issues the payment without any max_fee / max_fee_mtokens bound, so the payee-controlled invoice route hints decide how much the payer spends. Fix criteria: Every LNURL-pay payment must carry an explicit fee ceiling (a user-visible/confirmable value or a conservative default proportional to the amount) passed as max_fee/max_fee_mtokens to pay(). Verify that an invoice whose only route hint demands a fee above the ceiling fails to pay.
2. The invoice returned by the callback is not bound to the metadata the user was shown (description_hash != sha256(metadata) is not checked). Fix criteria: Pass the first-step `metadata` into lnUrlPay (or re-fetch it) and reject invoices whose description_hash does not equal sha256(metadata). Verify with an invoice carrying a mismatching h tag.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper quantity validation
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257326

---

# Failed SSO login writes the valid cookie-file secret to the debug log

## Details
`PublicResolver.get_auth_token` (src/server/modules/api/public/public.resolver.ts:74-151) is the unauthenticated SSO login field under the `@Public()` `public` mutation root. When the supplied `cookie` argument does not match the cookie file it executes `this.logger.debug(`Cookie ${cookie} different to file ${cookieFile}`)` (line 149), where `cookieFile` is the complete secret that `FilesService.readCookie` (files.service.ts:454-491) read from `COOKIE_PATH` (creating a fresh 64-byte random secret when the file is absent, so the value is never empty once SSO is configured). That file content is the bearer secret of the SSO integration: anyone who presents it to `get_auth_token` receives a 24-hour `yaml:sso` JWT bound to the SSO account's admin macaroon (lines 114-146). The file is regenerated only by `refreshCookie` after a *successful* login (line 119; files.service.ts:493-510), so the logged value remains valid until the legitimate SSO wrapper next authenticates.

The line is reached exactly on the hardened path: in development mode or with `DANGEROUS_NO_SSO_AUTH=true` the comparison is skipped and login succeeds (lines 114-118), so only a production deployment with SSO auth actually enforced writes the secret. Any unauthenticated client can force it at will with `mutation { public { get_auth_token(cookie: "x") } }` (the `!cookie` early return at line 96 only requires a non-empty string).

The Winston logger (app.module.ts:113-123) has a single Console transport at `LOG_LEVEL`. This holds when the log level is `debug` or more verbose: the shipped `docker-compose.yaml` (line 10) sets `LOG_LEVEL: "debug"`, so a compose deployment that enables SSO emits the secret to container stdout and therefore into `docker logs`, journald, or any log shipper the operator attaches; `fly.toml` sets `info` and an unset `LOG_LEVEL` falls back to winston's default `info` (assumption: winston ^3.19.0 `createLogger` defaults `level` to 'info'), which suppresses the line. Nothing in `.env` or the docs tells operators to keep debug logging off in production. Anyone with read access to the log stream — a log-aggregation viewer, a support engineer, a backup of the log volume — obtains the current SSO secret and logs in as the SSO account.

The same line also records the attacker-controlled `cookie` string verbatim (log injection; low value on its own). `FilesService` itself logs only paths and names, so this is the single place in the YAML/cookie layer where a secret reaches the logger.

## Evidence
1. [src/server/modules/api/public/public.resolver.ts:149](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/public/public.resolver.ts#L149)
   On any cookie mismatch in production the resolver logs `Cookie ${cookie} different to file ${cookieFile}`, where cookieFile is the full current content of the SSO cookie file — the secret that grants an SSO session — alongside the attacker-supplied value. This is the line the fix must change.
2. [src/server/modules/api/public/public.resolver.ts:96–146](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/public/public.resolver.ts#L96-L146)
   Any non-empty `cookie` string passes the early return at 96; the match/dev/DANGEROUS_NO_SSO_AUTH branch (114-146) issues a 24h `yaml:sso` JWT and rotates the file via refreshCookie only on success, so the logged value stays valid until the legitimate wrapper next logs in, and the debug line is reached only when SSO auth is actually enforced.
3. [src/server/modules/files/files.service.ts:454–490](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/files/files.service.ts#L454-L490)
   readCookie returns the raw secret from COOKIE_PATH, generating a fresh 64-byte random one if the file is absent; this is the value interpolated into the log line.
4. [src/server/app.module.ts:113–122](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/app.module.ts#L113-L122)
   Winston level comes straight from LOG_LEVEL with a single Console transport, so at debug level the line reaches stdout/container logs and any attached log shipper.
5. [docker-compose.yaml:10](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/docker-compose.yaml#L10)
   The shipped compose deployment sets `LOG_LEVEL: "debug"`, so the debug line is emitted in that sanctioned production deployment once SSO is configured; nothing documents an obligation to lower the level.

## Impact
The SSO cookie is a full-authority bearer secret: a `yaml:sso` session acts with the SSO account's admin macaroon through every authenticated resolver (payments, channel open/close, on-chain sends, macaroon baking, fee changes), so disclosure gives complete confidentiality, integrity and availability impact over the managed node via ThunderHub.

## Reproduction steps
1. Any unauthenticated network client forces the line with a single failed `get_auth_token` call (no auth, no throttle concern — one request suffices). To benefit, the attacker must be positioned to read the server's stdout/log pipeline (container log viewer, aggregation, log backups) — a low privilege distinct from host or cookie-file access, hence PR:L — and the deployment must run SSO mode at debug log level, as the shipped docker-compose.yaml does (AT:P). With the logged value, one ordinary `get_auth_token` call yields a 24h SSO session.

## Recommended fix
The SSO cookie-file secret (and the attacker-supplied candidate) is interpolated into a log message on authentication failure, so a bearer secret reaches the log stream whenever the configured level admits debug output. Fix criteria: No log statement at any level contains the cookie-file content or the submitted cookie value; at most a fixed message or a non-reversible digest prefix is logged. Verify by reviewing every logger call on the SSO path and confirming that a failed get_auth_token under LOG_LEVEL=debug produces no output containing the file content.

---
**Severity:** HIGH
**Status:** Open
**Category:** Sensitive information in log
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257323

---

# YAML ${YML_ENV_n} password placeholder is bcrypt-hashed literally, so the placeholder becomes the password

## Details
ThunderHub lets operators reference environment variables inside the account YAML with `{YML_ENV_n}` placeholders (configuration.ts:189-194 `yamlEnvs`; `.env` lists YML_ENV_1..4 under 'Account Configs'; the regex in utils/env.ts:11 matches the text between braces, so `'{YML_ENV_1}'` and `'${YML_ENV_1}'` both count). Substitution is performed per account in `getParsedAccount` -> `resolveEnvVarsInAccount` (files.service.ts:255-257), and `password` is one of the substitutable fields (`UnresolvedAccountType.password`, files.types.ts:37). However `getAccountsFromYaml` (files.service.ts:370-374) first runs `hashPasswords` over the raw YAML object. `hashPasswords` treats every `masterPassword` / `accounts[i].password` lacking the `thunderhub-` prefix as a plaintext password, bcrypt-hashes it and rewrites the YAML file (files.service.ts:139-171, saveHashedYaml).

If an operator writes `password: '{YML_ENV_1}'` (or `masterPassword: '{YML_ENV_1}'`, which is never substituted at all because substitution only touches account objects), the literal placeholder string is hashed, persisted to disk as `thunderhub-$2b$12$...`, and returned as the account's password. When the hashed account later passes through `resolveEnvVarsInAccount` the bcrypt string contains no braces, so it is left unchanged. The environment variable's value is never used, and the operator's real secret never logs in.

Result: the effective login password of the account is the public, predictable string `{YML_ENV_n}` / `${YML_ENV_n}` (n = 1..4; at most eight guesses). Any unauthenticated network client can enumerate account ids via the @Public `public.get_server_accounts` query (account.resolver.ts:312-336, returns `id: hash`) and call `public { get_session_token(id, password: "{YML_ENV_1}") }` (public.resolver.ts:203-292); bcrypt compares equal, a 24h `yaml:<hash>` JWT is issued in the auth cookie, and the attacker acts on the node with the account's admin macaroon (payments, channel management, on-chain sends). The 4-per-10s throttle on the `public` root does not stop eight guesses. If the account has 2FA the second factor still applies; the master-password variant affects every account without its own password.

The operator receives no warning: the file is silently rewritten with the hash of the placeholder (only an info log 'Saving new yaml file'), so after first start the misconfiguration is invisible in the YAML, and a templated YAML restored by config management reproduces it on every boot. Reachable only when the operator used a placeholder in a password field — a use the configuration surface and the type definitions invite and no documentation in the repository forbids.

## Evidence
1. [src/server/modules/files/files.service.ts:370–393](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/files/files.service.ts#L370-L393)
   getAccountsFromYaml calls hashPasswords on the raw, un-substituted YAML config (370-374) and only afterwards maps each account through getParsedAccount (389-393), where ${YML_ENV_n} substitution happens. masterPassword (383) is taken straight from the hashed output and never substituted at all. This ordering is what the fix must change.
2. [src/server/modules/files/files.service.ts:139–171](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/files/files.service.ts#L139-L171)
   hashPasswords treats any masterPassword / accounts[i].password lacking the 'thunderhub-' prefix as plaintext, bcrypt-hashes it (hashPassword, crypto.ts:67-68) and rewrites the YAML via saveHashedYaml. For password: '{YML_ENV_1}' or '${YML_ENV_1}' it persists bcrypt of the literal placeholder, destroying the placeholder on disk with only an info-level 'Saving new yaml file' log.
3. [src/server/modules/files/files.service.ts:255–272](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/files/files.service.ts#L255-L272)
   getParsedAccount runs resolveEnvVarsInAccount on the already-hashed account. The bcrypt string ('thunderhub-$2b$12$' + [./A-Za-z0-9]) contains no braces, so the placeholder regex never matches and ParsedAccount.password is bcrypt of the literal placeholder; the YML_ENV_n value is never used.
4. [src/server/utils/env.ts:7–34](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/utils/env.ts#L7-L34)
   resolveEnvVarsInAccount is the only consumer of yamlEnvs. It substitutes every string field of the account (UnresolvedAccountType includes password, files.types.ts:37) whose value contains '{...}' — so both '{YML_ENV_1}' and '${YML_ENV_1}' are placeholder spellings — but it runs only on account objects and only after hashing.
5. [src/server/modules/api/public/public.resolver.ts:203–284](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/public/public.resolver.ts#L203-L284)
   get_session_token under the @Public, 4-per-10s throttled `public` root (lines 39-40) looks up the account by id, checks isCorrectPassword(password, account.password) (239) — bcrypt.compareSync against the stored hash — and on success signs a 24h 'yaml:<hash>' HS256 JWT and sets the auth cookie (280-292). Supplying the literal placeholder string passes the check.
6. [src/server/modules/api/account/account.resolver.ts:312–335](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/account/account.resolver.ts#L312-L335)
   get_server_accounts under the @Public `public` root (120-121) lists every YAML account with id: hash to unauthenticated callers, giving the attacker the id argument that get_session_token requires.
7. [src/server/config/configuration.ts:189–193](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/config/configuration.ts#L189-L193)
   YML_ENV_1..4 are the documented env inputs for the YAML file (.env lines 50-55 list them under 'Account Configs' beside MASTER_PASSWORD_OVERRIDE); nothing in README, docs/ or CHANGELOG restricts which account fields may use them.

## Impact
A valid 'yaml:<hash>' session JWT gives full ThunderHub access to the node bound to that account through its admin macaroon: read all node and wallet data, pay invoices, open/close channels, send on-chain, bake macaroons, change fees. Confidentiality, integrity and availability of the managed node are fully compromised; 2FA, if enabled, remains the only barrier.

## Reproduction steps
1. An unauthenticated attacker reaching /graphql queries the @Public get_server_accounts for account ids, then calls the @Public get_session_token with password '{YML_ENV_n}' / '${YML_ENV_n}' for n=1..4 (at most eight guesses per account). The only defence is the 4/10s throttle on the public root, which eight guesses clear in twenty seconds. The precondition is that the operator used a YML_ENV placeholder for password or masterPassword, a configuration the env surface and UnresolvedAccountType.password invite but which is not universal (AT:P). Accounts with 2FA enabled additionally require the TOTP code.

## Recommended fix
1. Password hashing in getAccountsFromYaml is applied to the raw YAML before environment placeholders are resolved, and masterPassword is never passed through placeholder resolution, so the literal placeholder text becomes the credential and is silently persisted as its bcrypt hash. Fix criteria: Placeholders in account password fields and masterPassword are resolved to the environment value before any hashing or comparison, and the file is never rewritten with a hash of an unresolved placeholder. Verify: with password '{YML_ENV_1}' and YML_ENV_1=secret, logging in with the literal string '{YML_ENV_1}' fails and 'secret' succeeds, and the YAML file still contains the placeholder after boot.
2. The hashing step accepts any brace-containing string as a plaintext password and gives the operator no signal that a placeholder was hashed literally. Fix criteria: A password or masterPassword value that still matches the placeholder pattern at hashing time, or whose referenced YML_ENV_n is unset, is rejected at startup with an error (the account is not loaded) rather than hashed and written back. Verify: with YML_ENV_1 unset and password '{YML_ENV_1}', startup logs an error, the account is absent from get_server_accounts, and the YAML is unchanged.

---
**Severity:** HIGH
**Status:** Open
**Category:** Incorrect behavior order
**CWE:** [CWE-696](https://cwe.mitre.org/data/definitions/696.html)
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257318

---

# Node macaroon and cert stored in plaintext when DB_ENCRYPTION_KEY is unset

## Details
UserService.addNode (src/server/modules/user/user.service.ts:200-211) is the only writer of DB node credentials. It encrypts with AES-256-GCM (utils/encryption/field-encryption.ts) only when database.encryptionKey is truthy; otherwise it stores the admin macaroon and TLS certificate verbatim in the columns named encrypted_macaroon / encrypted_cert. The add_node resolver (account.resolver.ts:177-193) first verifies the macaroon against the live node, so what is persisted is a working admin macaroon, i.e. full control of that node's funds.

Nothing enforces or documents the key: configuration.ts:249-261 reads DB_ENCRYPTION_KEY optionally; drizzle.provider.ts:38-64 validates only DB_POSTGRES_URL / DB_SQLITE_PATH; the .env reference marks DB_SQLITE_PATH and DB_POSTGRES_URL as 'Required when DB_TYPE is ...' but describes DB_ENCRYPTION_KEY only as a '64-char hex string ... for AES-256-GCM encryption of node credentials at rest', with no 'required' note and no warning that omitting it stores credentials in cleartext; the README has no database section; and the repository's own fly.toml deploys DB_TYPE=sqlite on a persistent /data volume without any key. Plaintext is therefore the default, not a control the operator switches off. The code itself shows the fallback is a defect rather than a design: the sibling Amboss-JWT path (amboss-token.service.ts:137-142) at least logs 'stored in plaintext' when it falls back, while addNode logs nothing, and the read path getDbNodeBySlug (accounts.service.ts:171-179) never consumes the plaintext (macaroon becomes undefined without a key) -- so a key-less deployment silently writes working admin macaroons it can never use, and if a key is added later decryptValue throws 'Invalid encrypted value format' on those rows instead of migrating them.

Anyone who obtains the SQLite file, a volume snapshot, or a Postgres dump (the backup / read-only-disk adversary the threat model keeps in scope) reads admin macaroons and certs directly from the nodes table.

## Evidence
1. [src/server/modules/user/user.service.ts:200–223](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/user/user.service.ts#L200-L223)
   If database.encryptionKey is falsy (lines 204-211) the raw admin macaroon and TLS cert from the add_node input are inserted verbatim into nodes.encrypted_macaroon / encrypted_cert, with no warning or refusal.
2. [src/server/config/configuration.ts:249–261](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/config/configuration.ts#L249-L261)
   encryptionKey is simply process.env.DB_ENCRYPTION_KEY; nothing validates presence or length when DB_TYPE is set, so the default is undefined.
3. [src/server/modules/database/drizzle.provider.ts:38–64](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/database/drizzle.provider.ts#L38-L64)
   Database start-up requires DB_SQLITE_PATH / DB_POSTGRES_URL but not the encryption key, so a key-less DB deployment boots and migrates normally.
4. [fly.toml:9–18](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/fly.toml#L9-L18)
   Shipped deployment manifest enables DB_TYPE=sqlite with DB_SQLITE_PATH on a persistent mounted volume and sets no DB_ENCRYPTION_KEY: the project's own deployment stores node credentials in cleartext.
5. [.env:71–74](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/.env#L71-L74)
   The only documentation of DB_ENCRYPTION_KEY: it is a commented-out optional entry described as a hex key for AES-256-GCM at-rest encryption; unlike DB_SQLITE_PATH/DB_POSTGRES_URL it carries no 'Required when DB_TYPE is ...' note and no warning that omitting it stores credentials in plaintext, so no operator obligation is documented.
6. [src/server/modules/accounts/accounts.service.ts:167–179](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/accounts/accounts.service.ts#L167-L179)
   The sole reader never consumes the plaintext: without a key macaroon/cert become undefined, and with a key decryptValue throws on a plaintext row. The plaintext rows are therefore useless to the application but persist in the database and any backup.
7. [src/server/modules/api/amboss/amboss-token.service.ts:136–142](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/amboss/amboss-token.service.ts#L136-L142)
   Contrast: the Amboss-JWT writer at least logs a 'stored in plaintext' warning when the key is absent; the node-credential writer in addNode has no such warning, showing the fallback there is an unintended silent degradation.

## Impact
Confidentiality of the most sensitive secret ThunderHub stores (admin macaroon plus TLS cert, verified live before storage) is fully lost from a read-only copy of the data. Reading a backup does not alter or disable ThunderHub itself. Subsequent-system impact: A recovered admin macaroon grants full control of the LND/litd node it was issued by: read all node data, move funds, open/close channels, bake further macaroons -- impact entirely outside ThunderHub's boundary.

## Reproduction steps
1. Holds whenever the database is enabled (DB_TYPE set, a non-default deployment mode) without DB_ENCRYPTION_KEY, which is the undocumented default and exactly what the shipped fly.toml does. The attacker needs read access to the SQLite file, a volume snapshot or a Postgres dump (local/backup access, not a network request); they then read the nodes table and obtain the verified admin macaroon and cert directly, with no cryptographic or computational step.

## Recommended fix
Credential persistence silently degrades to plaintext when the encryption key is absent instead of refusing. Fix criteria: Node credentials are never written unencrypted: either start-up fails (or node storage is disabled) when DB_TYPE is set without a valid 32-byte DB_ENCRYPTION_KEY, or add_node rejects the request. Test: with the key unset, add_node fails and the nodes table never contains a non-ENC[ value.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cleartext storage
**CWE:** [CWE-312](https://cwe.mitre.org/data/definitions/312.html)
**Attack vector:** LOCAL
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257314

---

# x-node-slug header lets any YAML account holder act on every other YAML account's node

## Details
ThunderHub YAML deployments define several accounts, each with its own `password` (or a shared `masterPassword`) and an optional per-account `twofaSecret` (files.service.ts getParsedAccount; docs/ADDING_A_PROVIDER.md shows per-account `password` alongside `masterPassword`). The login resolver `get_session_token` (public.resolver.ts 204-297) authenticates a caller to exactly one account id, checking that account's password hash and that account's 2FA secret, and issues a JWT whose subject is `yaml:<thatHash>`.

NodeSlugGuard, registered as a global APP_GUARD and run on every non-public resolver, then rewrites the authenticated identity: when `req.user.authType === YAML` and the request carries an `x-node-slug` header (copied verbatim from the request in app.module.ts:87), it calls `accountsService.getAccountBySlug(nodeSlug)` and sets `req.user.id = account.hash` for whichever entry in the process-wide `accounts` map has that slug (node-slug.guard.ts 31-35). There is no comparison with the JWT subject and no server-side notion of which accounts a YAML principal may use; `getAccountBySlug` has no principal parameter (accounts.service.ts 114-123). `@CurrentUser()` returns the swapped id and every resolver resolves `accountsService.getAccount(id).connection` through `NodeService.getAccountAndProvider` — the victim account's admin-macaroon gRPC connection.

Reach of the swap: every other YAML account; the `sso` account (constant slug `sso`) when SSO is configured alongside YAML; and any DB-tenant node that has been cached into the same map by `getDbNodeBySlug` (slug = uuid[0:8]). Victim slugs are public: `get_server_accounts` under the `@Public()` `public` query (account.resolver.ts 312-337) lists every YAML account with `id: hash` and `slug`, and slug is simply hash[0:8].

The victim account's password and 2FA secret are never consulted, so the swap also defeats 2FA configured on the target. Where all accounts share only a `masterPassword`, the password gain is nil but per-account 2FA is still bypassed; where accounts have distinct passwords (the documented per-account `password` field) the holder of the weakest account gains full control of every other account's node. The shipped SPA's `NodeSwitcher` renders only for DB principals and YAML users are routed to a per-account password form, confirming the swap crosses an authentication boundary the project enforces rather than an intended multi-node convenience for YAML logins. The DB-principal variant through `getDbNodeBySlug`'s cache scan is a separate defect filed as db-node-slug-cache-lookup-skips-ownership.

## Evidence
1. [src/server/modules/security/guards/node-slug.guard.ts:31–35](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/security/guards/node-slug.guard.ts#L31-L35)
   For a YAML principal the guard resolves the attacker-supplied x-node-slug with getAccountBySlug and unconditionally overwrites req.user.id with that account's hash. It never compares the found account to the JWT subject and never denies; this is the code the fix must change.
2. [src/server/modules/accounts/accounts.service.ts:114–123](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/accounts/accounts.service.ts#L114-L123)
   getAccountBySlug takes no principal argument and scans the single process-wide map, which holds every YAML account, the 'sso' entry (slug 'sso') and any DB node previously cached by getDbNodeBySlug (slug = uuid[0:8]); the first slug match is returned.
3. [src/server/modules/api/public/public.resolver.ts:204–297](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/public/public.resolver.ts#L204-L297)
   The YAML login boundary: get_session_token authenticates one account id with that account's own password (or masterPassword) and that account's twofaSecret, then issues a JWT whose sub is `yaml:<thatHash>`. This is the control the header swap acts around.
4. [src/server/modules/api/account/account.resolver.ts:312–337](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/account/account.resolver.ts#L312-L337)
   get_server_accounts, reachable under the @Public() `public` query root, returns every YAML account's name, full hash and slug to unauthenticated callers, so the victim slug is not secret (and the 'sso' slug is a constant).
5. [src/server/app.module.ts:87](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/app.module.ts#L87)
   nodeSlug is taken verbatim from the x-node-slug request header into the GraphQL context with no validation.
6. [src/server/modules/node/node.service.ts:41–59](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/node/node.service.ts#L41-L59)
   Every node operation resolves the connection via accountsService.getAccount(id) where id is the swapped req.user.id delivered by @CurrentUser(), so the swap yields the victim account's admin-macaroon connection for pay, openChannel, sendToChainAddress, bakeMacaroon, etc.
7. [src/client/src/components/nodeManager/NodeSwitcher.tsx:43–54](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/components/nodeManager/NodeSwitcher.tsx#L43-L54)
   The shipped SPA offers node switching only to DB principals (`if (!isDbUser) return null`); YAML users must 'Log in with another account' through the per-account password form, confirming that cross-account use by a YAML login is not an intended feature.

## Impact
The swapped identity yields the victim node's admin-macaroon connection: read all invoices, payments, channel and peer data (C); pay invoices, open/close channels, send on-chain funds, bake new macaroons, change fees, enable/disable 2FA for that account (I); force-close channels or drain the wallet (A). This is full control of another tenant's Lightning node and funds, with that tenant's password and 2FA bypassed.

## Reproduction steps
1. Attacker is any authenticated YAML account holder on a multi-account ThunderHub (adversary 2 of the threat model). They call the unauthenticated `public { get_server_accounts { slug } }` to learn other accounts' slugs (or use the constant `sso`), log in to their own account with `public { get_session_token }`, then add `x-node-slug: <victim slug>` to any authenticated GraphQL request. NodeSlugGuard swaps req.user.id without denying. No race, no victim interaction, no non-default configuration beyond the ordinary multi-account YAML; works over the network against the shipped Docker image.

## Recommended fix
1. NodeSlugGuard rewrites the authenticated principal's account id from the client-controlled x-node-slug header without verifying that the YAML principal identified by the JWT subject is authorised for the target account; getAccountBySlug scans the whole process-wide map with no principal parameter. Fix criteria: A YAML JWT issued for account A must never yield req.user.id for a different hash unless an explicit server-side authorisation record links A to that account. A request carrying a valid token for A and x-node-slug for B (another YAML account, 'sso', or a cached DB node) must be rejected or execute against A only; verify by replaying the attack and confirming getAccount(req.user.id) is A and B's node receives no call.
2. The unauthenticated get_server_accounts query discloses every YAML account's full hash and slug, the identifiers other guards treat as authorisation handles. Fix criteria: Unauthenticated callers should learn at most what the login picker needs; hashes and slugs that select a node connection should not be returned pre-authentication, or should be unusable as authorisation handles. Verify the unauthenticated response no longer exposes identifiers accepted by NodeSlugGuard.

---
**Severity:** HIGH
**Status:** Open
**Category:** Authorization bypass
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257313

---

# Login and 2FA brute-force limit bypassed by aliasing public field resolvers in one request

## Details
ThunderHub's only defence against online credential guessing is `@Throttle({ default: { limit: 4, ttl: seconds(10) } })` on the root `public` mutation (src/server/modules/api/public/public.resolver.ts:39-44). The root resolver returns an empty object; the authentication logic lives in `@ResolveField` handlers on `PublicMutation`: `get_session_token` (YAML password via bcrypt compareSync, then TOTP via otplib verifySync), `get_db_session_token` (argon2 verify) and `get_auth_token` (SSO cookie compare). NestJS applies APP_GUARD guards to field resolvers only when `fieldResolverEnhancers: ['guards']` is set on GraphQLModule; `src/server/app.module.ts:67-112` does not set it and configures no validation rules, plugins, alias/depth/complexity limit or custom body-parser limit. Consequently a single `public` mutation, which the throttler counts as one request, may select the same field under many aliases with different arguments, and every alias is executed:

mutation { public {
  a0: get_session_token(id: "<hash>", password: "p0")
  a1: get_session_token(id: "<hash>", password: "p1")
  ... aN ...
} }

Any alias that succeeds sets the `Thub-Auth` cookie on the shared response and returns the node version; the others return 'Wrong credentials for login' errors. Account hashes are listed to unauthenticated callers by `public { get_server_accounts }`. The global throttler is `config.limit * 1000` (10,000 per 10 s by default, security.module.ts:16-24) and provides no backstop.

Two concrete bypasses of the shipped control:
1. Password guessing against YAML accounts (bcrypt cost 12) and DB users (argon2) at a rate bounded by server CPU rather than by the 4-per-10s limit. Because `isCorrectPassword` uses `bcrypt.compareSync` (crypto.ts:71-77), aliased YAML attempts are serialised on the event loop (roughly a few attempts per second per process, i.e. about an order of magnitude above the control, while also stalling the event loop for every other client); argon2 `verify` is asynchronous and runs on the libuv threadpool, so DB-user attempts scale with threadpool size.
2. 2FA bypass: `get_session_token` re-checks the password for every alias and then verifies a 6-digit TOTP with `epochTolerance: 30`, so more than one adjacent code is valid at any instant. An attacker holding a leaked or phished password for a 2FA-protected YAML account can search the 10^6 code space across aliased calls and across requests (4 per 10 s, each carrying hundreds of aliases); nothing locks the account or backs off, so the search is bounded only by server CPU and the body-size cap.

The generic rate-limiting exclusion does not apply: this is a bypass of the project's explicit anti-brute-force control on authentication (CWE-307), and it turns 2FA into an uncontrolled search. Dependency assumptions (versions from package.json): @nestjs/graphql ^13.2.4 / @nestjs/apollo ^13.2.4 apply enhancers to field resolvers only via `fieldResolverEnhancers` (documented contract); @apollo/server ^5.4.0 and graphql ^16.13.1 impose no alias, depth or complexity limit by default; @nestjs/platform-express's default JSON body limit (100 kB) caps aliases per request at several hundred to about a thousand, which bounds but does not prevent the attack; otplib ^13.4.0 `epochTolerance` widens the accepted TOTP window.

## Evidence
1. [src/server/modules/api/public/public.resolver.ts:39–44](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/public/public.resolver.ts#L39-L44)
   The project's only anti-brute-force control on authentication is @Throttle(4 per 10s) on the @Public root `public` mutation, which returns an empty PublicMutation object; the throttler counts one unit per operation here, regardless of how many child fields the selection set contains.
2. [src/server/modules/api/public/public.resolver.ts:204–269](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/public/public.resolver.ts#L204-L269)
   get_session_token (a @ResolveField on PublicMutation) runs bcrypt compareSync against the YAML account hash and then otplib verifySync (epochTolerance 30) on the 6-digit TOTP per invocation, with no throttle, lockout or back-off of its own; a success sets the Thub-Auth cookie for a 24h YAML session.
3. [src/server/modules/api/public/public.resolver.ts:153–201](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/public/public.resolver.ts#L153-L201)
   get_db_session_token performs an asynchronous argon2 verify per invocation (user.service.ts verifyPassword -> @node-rs/argon2 verify) with the same absence of per-field limiting, and issues a user:<uuid> session on success.
4. [src/server/app.module.ts:67–111](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/app.module.ts#L67-L111)
   GraphQLModule.forRootAsync sets no fieldResolverEnhancers, validationRules, plugins or body-parser config; per NestJS's documented contract, APP_GUARD guards (including GqlThrottlerGuard) therefore run only on root Query/Mutation fields, never on @ResolveField handlers, and nothing limits aliases, depth or complexity per operation.
5. [src/server/modules/security/security.module.ts:16–23](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/security/security.module.ts#L16-L23)
   The global throttler is configured as config.limit * 1000 (10,000 requests per 10s by default), so it is no backstop for authentication attempts.
6. [src/server/utils/crypto.ts:71–77](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/utils/crypto.ts#L71-L77)
   isCorrectPassword uses bcrypt.compareSync (bcryptjs, cost 12), so aliased YAML-password attempts in one operation are serialised on the event loop: attempt throughput for the YAML path is bounded by server CPU, not by the 4-per-10s control.

## Impact
A successful guess yields a 24h Thub-Auth session for the account and therefore its admin-macaroon node connection: full read of node data, payments, channel operations, on-chain sends, macaroon baking. Rated as the impact of the authentication bypass the missing control is meant to prevent; the synchronous bcrypt work per alias additionally stalls the event loop for all clients during an attack.

## Reproduction steps
1. Unauthenticated network attacker learns account hashes from the public get_server_accounts query, then posts `public` mutations whose selection set aliases get_session_token/get_db_session_token hundreds of times with candidate passwords (or, with a known password, candidate TOTP codes). The throttle counts the whole operation as one request and no field-level guard, lockout or alias limit exists. Default configuration; no victim interaction. Attack requirements are rated PRESENT because each alias still costs a full bcrypt(12)/argon2 verification, so throughput is bounded by server CPU (a few to tens of attempts per second): success requires a guessable password, or, for the 2FA bypass, a password already obtained elsewhere; the bypass removes the control that would otherwise make these searches infeasible.

## Recommended fix
1. Authentication attempts are counted per HTTP operation at the root field while the credential checks execute in unthrottled child field resolvers, so GraphQL aliasing multiplies attempts per counted request. Fix criteria: Each credential or TOTP verification must consume the brute-force budget individually (per IP and per target account), independent of how many aliases a single operation contains; verify that an operation with N aliased login fields is either rejected or counts as N attempts.
2. No bound on aliases/complexity for the public GraphQL endpoint lets a single request fan out to arbitrarily many authentication attempts. Fix criteria: Operations exceeding a small alias/complexity budget on public login fields are rejected before execution; verify by submitting an over-budget aliased mutation and confirming no password/TOTP checks ran.
3. TOTP verification has no per-account failure lockout or back-off, so the 6-digit code space is searchable once the password is known. Fix criteria: Repeated TOTP failures for an account must trigger a lockout/back-off that makes exhaustive search of the code space infeasible within the code's validity window.

---
**Severity:** HIGH
**Status:** Open
**Category:** Auth bypass
**CWE:** [CWE-307](https://cwe.mitre.org/data/definitions/307.html)
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257311

---

# DB-user x-node-slug lookup returns any account regardless of ownership

## Details
AccountsService.getDbNodeBySlug(slug, userId) is the only ownership check between a database user's JWT and the node connection their requests execute against (NodeSlugGuard rewrites req.user.id to whatever hash it returns). It fails to bind the result to userId in two independent ways.

1. Lines 134-137 scan the whole in-memory account map and return the first account whose slug equals the header value. The map contains every YAML account loaded at startup and every DB node previously resolved by any user. userId is not consulted.

2. Lines 143-152 build the DB query with .where(eq(user_id, userId)).where(sql`SUBSTR(...) = slug`). In drizzle-orm (0.45.2 pinned; assumption: the select builder's where() assigns rather than ANDs, which is also why its return type omits where and why the code needs the (db as any) cast) the second call replaces the first, so the user_id predicate never reaches SQL. Any node that has at least one user_nodes row is returned to any user.

Result: an authenticated DB user sends x-node-slug: <victim slug> on any GraphQL request. The slug of every YAML account (and of every DB node already in the cache) is returned by the unauthenticated public { get_server_accounts } query. The guard sets req.user.id to the victim's hash, and all node resolvers (pay, openChannel, closeChannel, sendToChainAddress, bakeMacaroon, signMessage, getBackups, etc.) run with the victim's admin macaroon.

Reachability note: the shipped code can only ever create one DB user (createInitialUser is the sole users insert, TeamMutations has no invite), so the live victims are YAML accounts in a deployment that configures ACCOUNT_CONFIG_PATH together with DB_TYPE. The code path is identical for a second DB user should one exist. The cache path also means that even a correct SQL filter would be bypassed once a victim's account is resident in memory.

The threat model states x-node-slug 'selects which node an authenticated principal acts on'; in this code the selection is not bound to the principal at all.

## Evidence
1. [src/server/modules/accounts/accounts.service.ts:133–137](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/accounts/accounts.service.ts#L133-L137)
   Cache lookup returns the first in-memory account whose slug matches, with no comparison against the caller's userId. this.accounts holds every YAML account and every DB node any user has already loaded, so a DB user supplying another principal's 8-hex slug gets that principal's EnrichedAccount (live connection + admin macaroon).
2. [src/server/modules/accounts/accounts.service.ts:143–152](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/accounts/accounts.service.ts#L143-L152)
   Cache-miss path: two chained .where() calls on the drizzle select builder. In drizzle-orm 0.45.2 (package-lock pinned; behaviour assumed, not verified in checkout) where() assigns config.where rather than AND-ing, so the second call discards eq(userNodes.user_id, userId) and only SUBSTR(id)=slug executes; the inner join then only requires that some user_nodes row exist for the node. The (db as any) cast — used throughout this file and user.service.ts for the sqlite/pg union type — also hides the compile-time error drizzle's return type would raise for a duplicate where.
3. [src/server/modules/security/guards/node-slug.guard.ts:36–44](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/security/guards/node-slug.guard.ts#L36-L44)
   For user: JWTs the guard calls getDbNodeBySlug(nodeSlug, req.user.id) and, when anything is returned, rewrites req.user.id to account.hash. Every downstream resolver reads @CurrentUser().id and acts on accountsService.getAccount(id).connection.
4. [src/server/app.module.ts:87](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/app.module.ts#L87)
   nodeSlug is the raw x-node-slug request header, fully attacker controlled.
5. [src/server/modules/files/files.service.ts:333–347](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/files/files.service.ts#L333-L347)
   YAML account slugs are hash.slice(0,8) of a SHA-256 hex digest, so they satisfy isValidNodeSlug and collide with the DB slug format; the guard's regex pre-check does not separate the two namespaces.
6. [src/server/modules/api/account/account.resolver.ts:312–351](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/account/account.resolver.ts#L312-L351)
   @Public get_server_accounts lists the slug of every entry in this.accounts, giving an attacker the victim slugs without guessing.

## Impact
Full impersonation of another principal inside ThunderHub: read all wallet/channel/invoice/payment data of the victim's node (C), execute every fund-moving and configuration mutation as them (I), and close channels / drain the wallet (A). Subsequent-system impact: The victim's connection carries an admin macaroon; the attacker can call bakeMacaroon/grantAccess and obtain a standalone macaroon, i.e. persistent control of the LND/litd node and its funds beyond ThunderHub.

## Reproduction steps
1. Attacker holds a valid DB user session (create_initial_user/get_db_session_token). They query the public get_server_accounts field (no auth) to collect every slug, then send any node query/mutation with x-node-slug set to a YAML account's slug. getDbNodeBySlug returns the YAML EnrichedAccount from the cache (or, for an uncached DB node, from the unfiltered SQL), the guard swaps req.user.id, and the mutation executes on the victim's connection. Requires a deployment with both DB and YAML accounts (or a second DB user).

## Recommended fix
1. In-memory cache lookup by slug ignores the requesting user, so any resident account is returned to any DB user. Fix criteria: A cached account is returned to a DB user only after verifying (via user_nodes or a per-user cache key) that this userId is linked to that node; YAML accounts are never returned to user: principals. Test: user with no link to node X sends x-node-slug of X after X is cached and receives no account.
2. Second .where() replaces the first in the drizzle select builder, dropping the user_id predicate from the SQL. Fix criteria: The SQL executed for the slug lookup contains both predicates combined with AND (and the query builder is typed so a duplicate where is a compile error). Test: a node linked only to user A is not returned when user B's id is passed.

---
**Severity:** HIGH
**Status:** Open
**Category:** Authorization bypass
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
**Attack vector:** NETWORK
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257309

---

# Keysend pays with no routing-fee ceiling: fee is unbounded by client or server

## Details
Two production UIs issue keysends: the home Send card with the Keysend switch (Payment.tsx → KeysendModal.tsx, operator-entered pubkey and amount) and the Amboss Billboard page (Billboard.tsx, hard-coded Amboss pubkey, default 100 sats). Both call the `Keysend` GraphQL operation, which carries only `destination`, `tokens` and `message`; the schema (`keysend(destination: String, message: String, tokens: Float!)`) has no fee argument at all. The server's `keysend` mutation (invoices.resolver.ts:80-106) generates the preimage/hash, attaches the keysend TLV records and calls `nodeService.payViaPaymentDetails(user.id, { id, tokens, destination, messages })`. `NodeService.payViaPaymentDetails` (node.service.ts:276-279), `LndService.payViaPaymentDetails` (lnd.service.ts:325-330) and `LitdService.payViaPaymentDetails` (litd.service.ts:185-193) all pass the options through unchanged, so `max_fee`/`max_fee_mtokens` — which `PayViaPaymentDetailsOptions` already exposes — are never set on any path. The sibling `pay` mutation in the same resolver requires `max_fee: Float!` and the client defaults it to 100 sats, which is the project's own model that a payment must carry an explicit fee ceiling.

Consequence: the routing fee the operator's node pays on top of `tokens` is bounded by nothing the operator saw or approved; the confirm step shows Amount and Destination only. Keysend has no invoice, so the fee is whatever the forwarding nodes on the route LND selects advertise in their channel policies. Routing fees are charged by the node that forwards the final hop, on its outgoing channel to the destination, so the attacker is whoever controls that forwarding node — in practice an attacker runs the destination and its sole upstream peer (or otherwise controls the only path into the destination) and sets an extreme policy on the channel into the destination (`fee_base_msat` and `fee_proportional_millionths` are 32-bit gossip fields, i.e. up to ~4.29M sat base plus ~4294x the amount proportionally). With no fee limit LND pays it, so the attacker collects far more than the `tokens` the operator confirmed, bounded only by the operator's outbound liquidity along the path.

Dependency assumption (source not read in this checkout): with `lightning@11.1.0` as pinned in package.json, `payViaPaymentDetails()` without `max_fee`/`max_fee_mtokens` defaults the fee limit to an effectively unlimited value (Number.MAX_SAFE_INTEGER msat) before calling LND's SendPaymentV2. If it instead passed no `fee_limit`, LND would consider only zero-fee routes and keysend would work only over direct channels — which is contradicted by the project's own Billboard feature, which keysends to a fixed Amboss pubkey that operators are generally not directly peered with, and by the keysend feature shipping since v0.x (#27). The generic `pay` mutation in the same resolver is not affected because it requires max_fee.

## Evidence
1. [src/server/modules/api/invoices/invoices.resolver.ts:79–106](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/invoices/invoices.resolver.ts#L79-L106)
   Sink and fix location: keysend builds { id, tokens, destination, messages } and calls nodeService.payViaPaymentDetails with no max_fee or max_fee_mtokens, so the routing fee the node may pay is not bounded anywhere on the server.
2. [src/client/src/views/home/account/pay/KeysendModal.tsx:70–75](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/home/account/pay/KeysendModal.tsx#L70-L75)
   Client half (home Send card, mounted via Payment.tsx): handlePay sends only destination and tokens. The form has no fee field and the confirm step (lines 126-140) shows only Amount and Destination, so the operator never sees or approves a fee limit.
3. [src/client/src/views/amboss/Billboard.tsx:13–42](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/amboss/Billboard.tsx#L13-L42)
   Second production caller of the same mutation: keysends to a hard-coded Amboss pubkey with only destination, tokens and message. Its existence shows multi-hop keysends are expected to succeed through this path, i.e. routing fees are being paid without a bound.
4. [src/client/src/graphql/mutations/keysend.ts:3–8](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/graphql/mutations/keysend.ts#L3-L8)
   The Keysend operation document exposes destination, tokens and message only; the schema (schema.gql:561) has no fee argument, so no client could pass a fee bound even if it wanted to.
5. [src/server/modules/node/lightning.types.ts:98–106](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/node/lightning.types.ts#L98-L106)
   PayViaPaymentDetailsOptions already exposes optional max_fee / max_fee_mtokens; the resolver simply leaves them unset.
6. [src/server/modules/node/lnd/lnd.service.ts:325–330](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/node/lnd/lnd.service.ts#L325-L330)
   The LND provider spreads the options straight into lightning's payViaPaymentDetails; no default fee ceiling is injected between the resolver and LND (NodeService node.service.ts:276-279 and LitdService litd.service.ts:185-193 pass through likewise).
7. [src/server/modules/api/invoices/invoices.resolver.ts:108–122](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/invoices/invoices.resolver.ts#L108-L122)
   Contrast: the sibling pay mutation in the same resolver makes max_fee mandatory (schema.gql:570 'max_fee: Float!') and Pay.tsx defaults it to 100 sats - the maintainers' own model that a payment must carry an explicit fee ceiling, which keysend omits.

## Impact
Loss of funds from the operator's node beyond the amount approved: the fee component is attacker-chosen, limited only by the 32-bit policy field widths and the node's outbound liquidity along the path. No confidentiality effect; availability only in the sense of drained outbound liquidity (LOW).

## Reproduction steps
1. Attacker controls the node that forwards the final hop into the keysend destination (e.g. runs both the destination and its only upstream peer) and advertises an extreme fee policy on the channel into the destination via normal gossip. The operator opens Send > Keysend, enters the attacker's pubkey and an amount, and confirms - a routine action whose confirm step shows only Amount and Destination. The server issues payViaPaymentDetails with no fee bound; LND routes through the attacker's hop and pays the inflated fee. No ThunderHub credentials are needed (PR:N); the attacker must arrange the route topology and the operator must choose to pay that destination (AT:P, UI:A). Depends on lightning@11.1.0 defaulting the fee limit to an effectively unlimited value when max_fee is omitted (stated assumption, supported by the project's own multi-hop Billboard keysend feature).

## Recommended fix
A money-moving operation is issued without an explicit routing-fee ceiling, so the cost the node incurs is not bound to what the operator approved. Fix criteria: The keysend mutation accepts (or derives) a max_fee / max_fee_mtokens and always passes an explicit bound to payViaPaymentDetails, defaulting to a conservative value (e.g. a small percentage of tokens or a fixed sat cap) when the client omits it; the Keysend form exposes and displays the fee limit on the confirm step like Pay.tsx does. Verify: a keysend whose only route charges more than the bound fails with a fee-limit error instead of settling.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257335

---

# Unbounded remote fee rate used for unattended swap claim transaction

## Details
The unattended Boltz auto-claim in `BoltzSwapContext.attemptAutoClaim` (src/client/src/context/BoltzSwapContext.tsx 469-480) signs and broadcasts a claim transaction spending the swap's lockup output with fee rate `fastRef.current || 2`. `fastRef` (377-379) mirrors `fast` from `useBitcoinFees`, which is the `fastestFee` field of the configured mempool instance's `${MEMPOOL_URL}/api/v1/fees/recommended` response, relayed by `getBitcoinFees` (bitcoin.resolver.ts 33-54) with no range check and refreshed every 60 s by the globally mounted `BitcoinFees` poller (components/bitcoinInfo/BitcoinFees.ts 8-12, `network-only`). `BoltzSwapProvider` is mounted for the whole SPA (context/ContextProvider.tsx 11). The server's `claimBoltzTransaction` (boltz.resolver.ts 118-131) rejects only `fee < 1`, then applies the rate through `targetFee(fee, abs => constructClaimTransaction(utxos, destinationScript, abs))` (356-363), deducting fee x vsize from the lockup output and sending the remainder to the user's address.

The threat model lists mempool responses as untrusted remote data (adversary 3). Whoever controls the fee feed's response — a compromised or impersonated mempool.space, or a MEMPOOL_URL the operator pointed at another instance (the .env template lists the variable, line 20, with no trust requirement; plain-HTTP URLs are accepted) — can return an extreme `fastestFee`. The next time a pending swap reaches `transaction.mempool` or `transaction.confirmed` over the Boltz WebSocket (isClaimableStatus), the browser builds a ~111 vB claim transaction at that rate with no display, no bound and no confirmation; the bulk of the swap output goes to miners. The manual `SwapClaim` dialog (views/swap/SwapClaim.tsx) is the shipped control for this spend — it shows `fee x 111` and requires a click — and the auto path acts around it. The same position gets nothing comparable elsewhere: SendOnChain/OpenChannel/CloseChannel only pre-fill `fast` into a confirmed form, and the mempool instance's other role in the claim path (address txs / tx hex) can only block a claim, not burn it.

Dependency assumption: boltz-core ^3.1.2 `constructClaimTransaction` / bitcoinjs-lib ^6.1.7 `Transaction.addOutput` reject a negative output value, so a rate that exceeds the lockup makes construction throw, the auto-claim fails after 5 attempts and falls back to the manual dialog; the attacker therefore tunes the rate to the minimum swap size (or to a known pending amount) to leave a dust-sized output rather than fail.

Reachability: new swap creation is disabled (`BOLTZ_SWAPS_DISABLED = true`, client and server), but the server comment (boltz.resolver.ts 51-56) states claims deliberately stay enabled, and swaps persist in localStorage; the path is live in production for any pending legacy swap and for the feature once re-enabled.

## Evidence
1. [src/client/src/context/BoltzSwapContext.tsx:469–479](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/context/BoltzSwapContext.tsx#L469-L479)
   Auto-claim submits `fee: fastRef.current || 2` (line 478) — `fastRef` (377-379) is the raw `fast` value from the fee feed, refreshed by the 60 s `BitcoinFees` poller — with no upper bound, no display and no user confirmation; the mutation fires on a Boltz WS status change alone.
2. [src/client/src/hooks/UseBitcoinFees.tsx:19–36](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/hooks/UseBitcoinFees.tsx#L19-L36)
   `fast` is passed through from the getBitcoinFees query unchanged (`fast || 0`).
3. [src/server/modules/api/bitcoin/bitcoin.resolver.ts:32–53](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/bitcoin/bitcoin.resolver.ts#L32-L53)
   getBitcoinFees returns `fastestFee` from `${MEMPOOL_URL}/api/v1/fees/recommended` as-is; no range validation.
4. [src/server/modules/api/boltz/boltz.resolver.ts:126–130](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/boltz/boltz.resolver.ts#L126-L130)
   claimBoltzTransaction only rejects `fee < 1`; any larger sat/vB value is accepted and applied via targetFee to the claim transaction (356-363), deducting fee×vsize from the swap output.
5. [src/server/config/configuration.ts:147–162](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/config/configuration.ts#L147-L162)
   The fee feed host is `MEMPOOL_URL` (env, default https://mempool.space; `fees` URL at line 158). The .env template (line 20) lists the variable with no trust or transport requirement, so any HTTP(S) instance can be configured; the shipped default is a third party whose responses the threat model classes as untrusted.

## Impact
The swap's lockup output is irreversibly spent at an attacker-chosen fee rate: up to nearly the whole swap value goes to miners instead of the user's address, with the attacker choosing the magnitude. Loss is bounded by the pending swap amount; no confidentiality or availability effect on ThunderHub itself.

## Reproduction steps
1. Attacker controls the HTTP response of the configured mempool fee endpoint (compromised/impersonated upstream, or control of a non-default MEMPOOL_URL instance). The victim must have a pending swap that reaches a claimable Boltz status and have the ThunderHub SPA open in a browser — the auto-claim runs client-side, so exploitation rides on the victim's ordinary use of the app (UI:P) rather than any deliberate action; the pending swap and feed position are deployment conditions outside the attacker's control (AT:P). No ThunderHub credentials are needed.

## Recommended fix
1. A fee rate taken from a remote estimator is used to sign and broadcast a claim transaction in the unattended auto-claim path without any upper bound, proportionality check or user confirmation. Fix criteria: The auto-claim clamps the rate to a sane ceiling and/or caps the absolute fee to a small fraction of the lockup value, falling back to the manual claim dialog when the feed value exceeds it. Verify by returning an extreme fastestFee from the fee endpoint and confirming no claim transaction is signed automatically.
2. The server-side claimBoltzTransaction trusts the client-supplied fee rate with only a lower bound (fee >= 1), so the client is the sole guard. Fix criteria: claimBoltzTransaction independently rejects a fee rate above a maximum and an absolute fee above a bounded percentage of the lockup output value before constructing the transaction.

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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257332

---

# TOR_PROXY_SERVER SOCKS agent silently ignored by Node global fetch; outbound requests bypass Tor

## Details
ThunderHub offers a `TOR_PROXY_SERVER` setting (configuration.ts:237, advertised in the sample `.env` and CLAUDE.md as 'HTTP client with optional SOCKS proxy (Tor) support') so that outbound requests to third parties — Amboss space/auth/magma/trade APIs, Boltz, mempool.space, blockchain.info ticker, api.github.com, and arbitrary LNURL / lightning-address endpoints — egress through a local SOCKS/Tor proxy and hide the node operator's IP address. `FetchService` (src/server/modules/fetch/fetch.service.ts) implements this by constructing a `socks-proxy-agent` `SocksProxyAgent` (line 24) and passing it as `fetch(url, { agent: this.agent, ...options })` (line 30).

The `fetch` used is the global one: fetch.service.ts imports no fetch implementation, package.json has no `node-fetch`, `undici`, `cross-fetch` or similar dependency, and nothing in src/server, the Dockerfile CMD (`npm run start:prod` → `node dist/main`) or nest-cli.json installs a polyfill or sets a global dispatcher. The shipped image runs node:24.13.1-alpine (Dockerfile:1), whose built-in fetch is undici's WHATWG implementation. Stated assumption (not verifiable in the checkout because undici is bundled in the Node binary): undici's `RequestInit` has no `agent` member — its extension for routing connections is `dispatcher` — and unrecognised dictionary members are discarded, which is also what the pinned type definitions describe (@types/node 25.6.0 / undici-types 7.19.2 define `dispatcher`, not `agent`). TypeScript does not catch the mismatch because `options?: any` is spread into the literal, making the whole argument `any`. The SocksProxyAgent is therefore never used and every outbound request is made directly from the host's network stack, while the service logs 'Using tor proxy for external requests' (line 23). Nothing checks that the proxy is honoured; the control fails open and silently.

Who receives the direct connection, for an operator who configured Tor specifically to avoid being deanonymised:
- `LnUrlResolver.fetchLnUrl`, `getLightningAddressInfo`, `lnUrlAuth` and the other fetchWithProxy call sites in lnurl.resolver.ts fetch a URL chosen by whoever produced the LNURL / lightning address (an authenticated user pastes or scans it). A malicious LNURL service learns the real IP of the ThunderHub/LND operator.
- `AmbossService.ping` (amboss.service.ts:314-445) runs every minute in production and posts node-key-signed timestamps to api.amboss.space; `pushBalances` (line 448) pushes balances. These are gated: `healthCheckPingEnabled` / push flags default to false (userConfig.service.ts:32) and must be toggled on by the operator, and `DISABLE_HEALTHCHECK_PINGS` / `DISABLE_BALANCE_PUSHES` can disable them. When enabled, Amboss (or any on-path observer) can bind the node's public key to the operator's real IP with no user action. `getAmbossJWT` and the Magma/Trade resolvers likewise send node-signed logins when used.
- Price (blockchain.info), fee/mempool, GitHub version and Boltz requests (bitcoin.resolver.ts:20-38, github.resolver.ts:20, mempool.service.ts, boltz.service.ts) are issued whenever the operator uses the SPA, each disclosing the host IP to that fixed third party.

The defect is in this repository's own use of the dependency, not in the dependency: `socks-proxy-agent` 8.0.5 is an http.Agent designed for `http`/`https`/`node-fetch`, and the code hands it to an API that cannot consume it. This contradicts the recorded threat model's boundary 'server ↔ Amboss/Boltz/mempool/GitHub/LNURL (HTTPS, optional Tor proxy ...)': the optional Tor proxy is not applied on the shipped runtime.

## Evidence
1. [src/server/modules/fetch/fetch.service.ts:28–32](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/fetch/fetch.service.ts#L28-L32)
   fetchWithProxy is the single outbound-HTTP chokepoint. When a Tor proxy is configured it calls the global fetch(url, { agent: this.agent, ...options }). The global fetch in Node >= 18 is undici's WHATWG fetch, whose RequestInit has no `agent` member (the undici extension for routing is `dispatcher`); unknown dictionary members are discarded, so the SocksProxyAgent is never used and the request is sent directly from the host.
2. [src/server/modules/fetch/fetch.service.ts:20–25](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/fetch/fetch.service.ts#L20-L25)
   The agent is built from the `torProxy` config value and the service logs 'Using tor proxy for external requests', giving the operator a false confirmation that the proxy is active.
3. [src/server/config/configuration.ts:237](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/config/configuration.ts#L237)
   torProxy is taken from the TOR_PROXY_SERVER environment variable; this is the only mechanism offered for routing third-party traffic over Tor.
4. [Dockerfile:1](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/Dockerfile#L1)
   The shipped image runs on node:24.13.1, where `fetch` is the built-in undici implementation. No node-fetch or other agent-aware fetch is installed or polyfilled anywhere in src/server or package.json.
5. [src/server/modules/api/lnurl/lnurl.resolver.ts:112–115](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L112-L115)
   fetchLnUrl passes a user-supplied URL (an LNURL the user scanned or pasted, i.e. attacker-chosen) to fetchWithProxy. The attacker who operates that endpoint receives the connection from the ThunderHub host's real IP address despite the operator having configured Tor.
6. [src/server/modules/api/amboss/amboss.service.ts:419–430](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/amboss/amboss.service.ts#L419-L430)
   AmbossService.ping runs on a one-minute @Interval (line 314) in production and, once the operator has enabled health-check pings (userConfig healthCheckPingEnabled, default false at userConfig.service.ts:32, not disabled by DISABLE_HEALTHCHECK_PINGS), signs a timestamp with the node's identity key and posts it to api.amboss.space via graphqlFetchWithProxy. Because the proxy is bypassed, Amboss or any on-path observer can bind the node's public key to the operator's real IP address with no user action — exactly what the Tor option exists to prevent.
7. [.env:14](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/.env#L14)
   The sample environment file advertises TOR_PROXY_SERVER=socks://127.0.0.1:9050 as the supported configuration for proxying external requests; CHANGELOG entry 'enable tor proxy config (#197)' shows it is a long-standing feature.

## Impact
Confidentiality: the operator's real network location is disclosed to third parties and attacker-controlled endpoints, and can be linked to the Lightning node's public key via the signed Amboss health-check/balance/login requests — a deanonymisation the configured control was meant to prevent. No data integrity or availability impact.

## Reproduction steps
1. Precondition on the vulnerable system: the operator has set TOR_PROXY_SERVER, a documented configuration chosen precisely for anonymity; the finding is that this enabled control is not applied, not that a control was left off. The attacker is any remote party that operates, or can observe traffic to, an endpoint ThunderHub contacts: a malicious LNURL / lightning-address service an authenticated user is induced to use (attacker-chosen destination), a third-party API (Amboss, mempool.space, blockchain.info, GitHub, Boltz) contacted on normal SPA use, or — with the operator's Amboss health-check pings enabled — api.amboss.space receiving node-key-signed requests on a one-minute timer with no user action. The server connects directly from its real IP; no authentication to ThunderHub and no defeat of any mechanism is needed. Attack requirements are PRESENT because the attacker must hold one of those endpoint/on-path positions and the target must have the Tor option configured.

## Recommended fix
1. FetchService passes a Node http.Agent (`agent`) to the WHATWG global fetch, which does not accept that option, so the configured SOCKS/Tor proxy is never applied to outbound requests. Fix criteria: When torProxy is configured, every request issued through fetchWithProxy/graphqlFetchWithProxy must egress via the SOCKS proxy (e.g. by supplying an undici dispatcher that speaks SOCKS, or by using an HTTP client that honours the agent). Verify by pointing TOR_PROXY_SERVER at a test SOCKS listener and confirming that LNURL, Amboss, Boltz, mempool, ticker and GitHub requests all arrive through it and none reach the destination directly.
2. The proxy configuration fails open and silently: a misapplied proxy still logs success and requests proceed directly. Fix criteria: If the proxy cannot be applied to the fetch implementation in use, startup (or the first outbound request) fails with an explicit error rather than sending traffic directly; verify by configuring an unreachable/invalid proxy and confirming no direct connection is attempted.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Protection mechanism failure
**CWE:** [CWE-693](https://cwe.mitre.org/data/definitions/693.html)
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257330

---

# validateCallbackUrl private-network blocklist is bypassable (bracketed IPv6, uncovered ranges, followed redirects)

## Details
validateCallbackUrl (lnurl.resolver.ts:19-48) is the only control between the caller-supplied `callback` argument of the authenticated mutations lnUrlPay (:136), lnUrlWithdraw (:222) and lnUrlChannel (:267) and the server-side fetchWithProxy(finalUrl). It is meant to confine those requests to public HTTPS hosts, but it is a string blocklist on the WHATWG URL.hostname that is applied to the first hop only:

- IPv6 literals are never blocked. Node's WHATWG URL serialises IPv6 hosts in brackets (new URL('https://[::1]/').hostname === '[::1]'), so the hostname === '::1' branch can never match; https://[::1]:8080/, https://[::ffff:127.0.0.1]/ (IPv4-mapped loopback), https://[fd00::1]/ (ULA) and https://[fe80::1]/ (link-local) all pass.
- IPv4 coverage is partial: only the exact strings 127.0.0.1 and 0.0.0.0 plus the 10., 192.168., 169.254. and 172.16-31. prefixes are blocked; 127.0.0.2-127.255.255.255, 100.64.0.0/10 (CGNAT, Tailscale, overlay networks), the rest of 0.0.0.0/8 and multicast pass.
- Hostnames are not resolved, so any attacker-controlled DNS name (or a nip.io-style name) pointing at an internal address passes.
- Redirects are followed and never re-validated. FetchService.fetchWithProxy (fetch.service.ts:28-32) hands the URL to Node 24's global fetch with no `redirect` option, i.e. the default 'follow'; the Fetch standard's HTTP-redirect step rejects only non-HTTP(S) schemes, so an https->http Location is followed. An attacker-run HTTPS host with a valid certificate that passes the blocklist answers `302 Location: http://127.0.0.1:8080/...` (or any RFC1918/CGNAT/IPv6 URL) and the server issues the second GET with neither the private-network check nor the HTTPS rule applied.

Because TLS certificate validation applies to the first hop, the direct literal/range gaps reach only internal TLS endpoints whose certificate validates for that literal; the redirect path is the general-purpose primitive and also defeats the HTTPS-only rule that would otherwise keep plaintext internal services out of reach.

Who drives it: (a) any authenticated principal sends the mutation with a chosen callback (no @Public, GqlAuthGuard is the only gate, NodeSlugGuard never denies); (b) a malicious LNURL service - the SPA replays the remote JSON's callback verbatim into these mutations after the operator confirms (LnWithdraw.tsx:154-156, LnChannel.tsx:53, LnPay.tsx), displaying only callbackUrl.host (the attacker's HTTPS host), never the redirect target. The threat model lists 'SSRF via LNURL callbacks' as in scope.

Read-back: lnUrlChannel's catch rethrows `Error requesting channel from LnUrl service: ${error}` - for a non-JSON body that is V8's SyntaxError message, which includes a snippet of the response body (e.g. the first characters of an HTML page); for {status:'ERROR'} it is the remote `reason`; for any other JSON the success string; for an unreachable port `TypeError: fetch failed` - a port-scan and content oracle. lnUrlWithdraw returns the invoice id for valid non-ERROR JSON and a fixed error otherwise (a JSON/non-JSON oracle; it also creates an invoice on the operator's node per call). lnUrlPay returns the same fixed error on every failure path (no `pr`, ERROR status, non-JSON, network error), so it offers only timing. lnUrlChannel additionally performs addPeer to a caller-supplied peer URI first, which any reachable public node satisfies.

Distinct from lnurl-fetch-unvalidated-url-ssrf (fetchLnUrl/lnUrlAuth/getLightningAddressInfo have no check at all): here the maintainers' check exists and would remain bypassable even if it were applied to those resolvers. Assumptions stated rather than reproduced: Node 24.13.1 per Dockerfile, whose global fetch is undici with default redirect 'follow' and cross-scheme https->http following per the Fetch standard; WHATWG URL bracketed IPv6 hostname; V8 (Node >= 20) JSON.parse error messages include a source snippet.

## Evidence
1. [src/server/modules/api/lnurl/lnurl.resolver.ts:19–47](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L19-L47)
   The guard parses with WHATWG URL, requires https:, then compares parsed.hostname against literal strings. IPv6 hostnames carry brackets ('[::1]'), so the '::1' branch is dead and no IPv6 literal (incl. IPv4-mapped [::ffff:127.0.0.1], ULA, link-local) is blocked; IPv4 coverage is only exact 127.0.0.1/0.0.0.0 plus the 10/8, 192.168/16, 169.254/16 and 172.16/12 prefixes, so 127.0.0.2+, 100.64/10 and the rest of 0/8 pass; names are never resolved. The validator runs only on the initial URL.
2. [src/server/modules/fetch/fetch.service.ts:28–31](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/fetch/fetch.service.ts#L28-L31)
   fetchWithProxy passes the URL to Node's global fetch with no `redirect` option (default 'follow') and nothing re-validates the Location, so a first hop that passes the blocklist can 302 the server to any http:// or https:// internal URL; this is the general-purpose bypass and also voids the HTTPS-only rule.
3. [src/server/modules/api/lnurl/lnurl.resolver.ts:267–302](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L267-L302)
   lnUrlChannel runs validateCallbackUrl then GETs `${callback}?k1=...&remoteid=...&private=0`; its catch rethrows `${error}`, so V8's JSON-parse snippet of a non-JSON internal response, the remote `reason`, the success string or 'fetch failed' is returned to the GraphQL caller - a port-scan and content oracle.
4. [src/server/modules/api/lnurl/lnurl.resolver.ts:222–257](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L222-L257)
   lnUrlWithdraw runs the same guard, creates an invoice on the operator's node, then GETs `${callback}?k1=...&pr=...`; it returns the invoice id for valid non-ERROR JSON and a fixed error otherwise - a JSON/non-JSON oracle.
5. [src/server/modules/api/lnurl/lnurl.resolver.ts:136–159](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L136-L159)
   lnUrlPay runs the same guard and GETs `${callback}?amount=...&nonce=...&comment=...` from the server's network position; every failure path returns the same fixed error string, so it offers only a timing side channel.
6. [src/client/src/views/home/quickActions/lnurl/LnWithdraw.tsx:154–156](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/home/quickActions/lnurl/LnWithdraw.tsx#L154-L156)
   The shipped SPA replays the remote LNURL JSON's `callback` verbatim into the mutation after one operator click, showing only callbackUrl.host (line 174), so a malicious LNURL service steers the server-side request without the operator seeing a redirect target; LnChannel.tsx:53 and LnPay.tsx do likewise.

## Impact
The ThunderHub process itself discloses only network-reconnaissance information: port open/closed, JSON vs non-JSON, the remote `reason`, and a short body snippet via lnUrlChannel's reflected V8 parse error. No ThunderHub credentials or funds are exposed by this defect alone; side effects are a benign invoice per lnUrlWithdraw call and a caller-chosen addPeer in lnUrlChannel. Subsequent-system impact: Internal HTTP services not reachable from outside (loopback, RFC1918, CGNAT, IPv6 ULA/link-local, Docker-network neighbours such as LND REST, tapd, mempool or admin UIs) receive GETs with attacker-chosen path and query from the server's address, with a small read-back channel through error strings. GET only, no custom headers or body, so integrity is limited to GET-triggered actions on those services.

## Reproduction steps
1. Direct vector: any authenticated principal (YAML account or DB user; GqlAuthGuard is the only gate, the mutations are not @Public) calls lnUrlChannel(callback: 'https://attacker.example/r', uri: '<any public node pubkey@host:9735>', k1: 'a') or lnUrlWithdraw(callback: 'https://attacker.example/r', amount: 1, k1: 'a'), where attacker.example (valid certificate) answers 302 Location: http://10.0.0.5:8080/admin or http://127.0.0.1:<port>/; the server performs the GET from its network position and the error/success string reveals response characteristics. Direct IPv6/uncovered-range literals (https://[::1]:8080/, https://127.0.0.2/) also pass the check but reach only internal TLS endpoints whose certificate validates. Indirect vector: a malicious LNURL service's callback is replayed by the SPA after one operator click (PR:N/UI:A); the metrics below rate the direct authenticated vector. Assumes Node 24.13.1 (Dockerfile) undici fetch: default redirect 'follow', https->http permitted by the Fetch standard; WHATWG URL bracketed IPv6 hostname.

## Recommended fix
1. The private-network check is a string blocklist on the unparsed hostname that does not handle bracketed IPv6 literals, covers only fragments of the private IPv4 space, and does not resolve DNS names. Fix criteria: Replace the blocklist with address-based validation: parse the hostname (strip IPv6 brackets), resolve DNS names, and reject any address that is loopback, private (10/8, 172.16/12, 192.168/16, 100.64/10), link-local, unspecified, multicast, IPv6 ULA/link-local or IPv4-mapped equivalents. Verify that `https://[::1]/`, `https://127.0.0.2/`, `https://[::ffff:127.0.0.1]/` and a DNS name resolving to 10.0.0.1 are all rejected.
2. The check is applied only to the initial URL while fetch follows redirects, including https->http, so a compliant first hop can redirect the server to any internal URL. Fix criteria: Fetch LNURL callbacks with redirects disabled (`redirect: 'error'` or 'manual'), or re-run the destination validator and the HTTPS requirement on every Location before following it. Verify that a callback host returning `302 Location: http://127.0.0.1:8080/` causes the mutation to fail without the second request being made.
3. lnUrlChannel echoes the caught error object, including V8 JSON-parse snippets of the response body and the remote `reason` string, back to the GraphQL caller. Fix criteria: Return a fixed error message to the client and keep response details in server logs only. Verify that a non-JSON callback response yields a constant error string.

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
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257327

---

# getInvoiceStatusChange opens LND invoice streams it never closes

## Details
`InvoicesResolver.getInvoiceStatusChange` (src/server/modules/api/invoices/invoices.resolver.ts:22-50) is an authenticated GraphQL query that long-polls an invoice's settlement. Each call runs `nodeService.subscribeToInvoice(user.id, id)` → `LndService.subscribeToInvoice` (lnd.service.ts:345-347) → `lightning`'s `subscribeToInvoice`, which opens an LND `SubscribeSingleInvoice` gRPC server-stream on the account's shared `lnd` connection and returns an EventEmitter. The resolver attaches one `invoice_updated` listener and races it against a 90 s `setTimeout`. On no exit path (paid, 90 s timeout, never settled) does ThunderHub remove the listener, cancel/destroy the subscription, or clear the timer; contrast `NodeService.waitForChannelFromPeer` (node.service.ts:311-366), which does all three. Nothing else in the server tracks these emitters.

Because the `lightning` emitter only cancels the underlying stream when its last listener is removed (never here), the stream stays open until LND itself ends it. LND ends a SubscribeSingleInvoice stream only when the invoice reaches a terminal state (settled or canceled) or the client cancels. For an `id` that matches no invoice, LND's registry treats the lookup miss as 'subscribe to a future invoice' and keeps the subscription (goroutine, notification-client entry, HTTP/2 stream) open indefinitely. So an authenticated caller who sends the query with arbitrary 64-hex ids deterministically adds one permanently-open gRPC stream per request on both the ThunderHub process (grpc-js call object, http2 stream, emitter and closures) and the LND node, released only by a ThunderHub or LND restart. The 90 s timer is not itself leaked (it fires once), and for real invoices the leak is bounded by LND closing the stream on settlement or expiry-cancellation (default 24 h), so ordinary use leaks only transiently; the unbounded case is attacker-chosen ids.

The throttler is effectively off (limit×1000 per 10 s ttl) and the resolver does no validation of `id`. In a shared-process deployment — several YAML accounts, or DB users/teams when `DB_TYPE` is set — one tenant's requests grow the process's memory and stream count without bound and, if the LND server advertises a finite HTTP/2 max-concurrent-streams, stall every further RPC on that node's shared channel; other tenants of the same process are degraded. In a single-tenant deployment the caller only degrades their own server.

Dependency assumptions: `lightning` 11.1.0 (pinned) validates `id` as a 64-hex hash (throwing synchronously, which the async resolver surfaces as a GraphQL error) and guards `emitter.emit('error')` behind a listener-count check, so the missing 'error' listener does not crash the process; LND (grpc-go server) closes the stream on terminal invoice state and keeps unknown-hash subscriptions open. If the error-guard assumption is wrong, any stream error (LND restart) would be an unhandled 'error' event and crash the process.

## Evidence
1. [src/server/modules/api/invoices/invoices.resolver.ts:22–50](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/invoices/invoices.resolver.ts#L22-L50)
   Each call creates a subscribeToInvoice EventEmitter (a live LND gRPC server-stream) and races it against a 90 s timer. Neither branch removes the listener, cancels the stream, or clears the timer; the emitter and its stream outlive the request indefinitely. No 'error' listener is attached either.
2. [src/server/modules/node/lnd/lnd.service.ts:345–347](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/node/lnd/lnd.service.ts#L345-L347)
   The provider returns the raw lightning.subscribeToInvoice emitter with no lifecycle management, so the resolver is the only place the stream could be torn down.
3. [src/server/modules/node/node.service.ts:294–297](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/node/node.service.ts#L294-L297)
   The facade likewise just returns the emitter; no registry or cleanup exists anywhere on the path.
4. [src/client/src/views/home/quickActions/lnurl/LnWithdraw.tsx:42–56](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/home/quickActions/lnurl/LnWithdraw.tsx#L42-L56)
   Shows the query is used in normal production flows (also createInvoice/InvoiceStatus.tsx), so streams are opened routinely; for real invoices these are eventually closed server-side by LND on settlement or expiry-cancellation, so ordinary use leaks transiently while attacker-chosen non-existent ids leak permanently.

## Impact
Availability only: leaked grpc-js calls, http2 streams and emitters grow memory in the shared ThunderHub process for its lifetime, and the LND node accumulates open subscriptions; a finite server-side max-concurrent-streams would stall further RPCs on that node's shared channel. Cross-tenant impact exists only in shared-process deployments (multiple YAML accounts or DB users); in single-tenant use the caller harms only their own server. Degradation is gradual and cleared by restarting ThunderHub or LND, hence LOW. No confidentiality or integrity impact.

## Reproduction steps
1. Any authenticated GraphQL principal (PR:L; GqlAuthGuard, no @Public) sends repeated getInvoiceStatusChange queries with arbitrary 64-hex ids that match no invoice; each call deterministically opens a SubscribeSingleInvoice stream that neither ThunderHub nor LND ever closes. No race, configuration change or user interaction is needed, and the throttler (limit×1000 per 10 s) does not constrain it.

## Recommended fix
getInvoiceStatusChange opens a per-request LND SubscribeSingleInvoice stream and abandons it on every exit path (paid, timeout, never settled), relying on LND to close it — which LND never does for ids that match no invoice. Fix criteria: After the query settles by any path, the subscription must be cancelled/destroyed and its listeners removed, the 90 s timer cleared, and an 'error' listener attached so stream errors cannot surface as unhandled events; the id should be validated (64-hex) and ideally checked to exist before subscribing. Verify that repeated calls with paid, timed-out and non-existent ids leave no open SubscribeSingleInvoice streams on LND and no growth in emitter/listener or http2 stream counts.

---
**Severity:** MEDIUM
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
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257325

---

# Trade routes pay counterparty fee from peer-advertised policy with no upper bound

## Details
The executeTrade mutation builds explicit Lightning routes whose penultimate hop is the trade counterparty forwarding over the Taproot Asset channel. The fee paid to that hop is computed from the route hint embedded in the invoice: `peerFeeMtokens = base_fee_mtokens + forward_mtokens * fee_rate / 1e6`. Those two values originate in the counterparty's `channel_update` for the TA channel (tapd's addAssetInvoice and LND's private-channel hints copy the remote policy into the hop hint), so they are fully attacker-controlled. The resolver applies no maximum, adds the fee to the amount sent (`mtokensToPeer`), and submits the route with `payViaRoutes` (SendToRoute), which is the one LND payment path that enforces no fee limit at all.

Two paths reach the sink:

1. Buy (`executePurchase`, lines 315-483). The quote shown to the user (`getBuyQuote`) returns only `decoded.tokens`, the invoice amount. On execute, the node pays invoice + peer fee + base-route fee. A peer that advertises e.g. base fee 4,294,967 msat (u32 max) and fee_rate 4,294,967,295 ppm makes the user pay roughly 4,300x the quoted price plus 4,294 sats; the only limiter is the `local_balance >= tokensToPeer` channel filter at line 328, and the counterparty, being the channel peer, knows the user's balance on the direct channel and can size the fee to just fit.

2. Sell (`executeSale` -> `ensureTaChannelSatReserve` -> `rebalanceTaChannel`, lines 1026-1163). When the TA channel's sat balance is below 1.5x reserve + invoiceSats (common for peer-opened channels whose local balance starts at zero), the server silently sends a circular self-payment of up to the full sale value through the counterparty, again paying an uncapped peer fee. This payment is never quoted, never confirmed by the user, and its cost is not reported back; failures are swallowed as warnings (lines 833-841).

By contrast the project's other payment paths bound fees: tapd `sendAssetPayment` sets `feeLimitSat: 1000`, the `pay` mutation takes `max_fee`, and LND itself defaults QueryRoutes/SendPayment fee limits to the payment amount. The base route found by `getRouteToDestination` is therefore bounded by LND, but the appended peer hop is not.

Attacker: the Lightning trade counterparty (threat-model adversary 3), who needs only to publish a high-fee channel_update for the TA channel it shares with the victim and wait for the victim to buy or sell against it. Gain: the excess fee is settled to the attacker as ordinary routing revenue. Loss is bounded only by the victim's outbound BTC liquidity.

Assumption: `lightning@11.1.0` returns `partner_scid_alias` on getChannels as the maintainers' code and tests assume; if it does not, path 2 always throws before paying and only path 1 is live.

## Evidence
1. [src/server/modules/api/trade/trade.resolver.ts:315–321](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/trade/trade.resolver.ts#L315-L321)
   executePurchase computes peerFeeMtokens = base_fee + forward*fee_rate/1e6 directly from the route hint (routeHint.base_fee_mtokens / fee_rate), values the counterparty sets via its channel_update for the TA channel. No maximum is applied; the user's quoted sats_amount is then increased by this amount (mtokensToPeer).
2. [src/server/modules/api/trade/trade.resolver.ts:423–482](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/trade/trade.resolver.ts#L423-L482)
   The peer hop is rewritten with the uncapped fee and the explicit route is submitted via payViaRoutes (SendToRoute). Explicit routes bypass LND's fee-limit logic entirely, so whatever fee is encoded here is paid.
3. [src/server/modules/api/trade/trade.resolver.ts:1026–1034](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/trade/trade.resolver.ts#L1026-L1034)
   rebalanceTaChannel (reached from executeSale via ensureTaChannelSatReserve) repeats the pattern: peer fee for the circular self-payment is derived from the private-channel route hint embedded by LND (taRouteHint), again with no cap.
4. [src/server/modules/api/trade/trade.resolver.ts:1057–1064](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/trade/trade.resolver.ts#L1057-L1064)
   Pathfinding is requested for rebalanceSats + peerFee; the uncapped peer fee is then paid at lines 1089-1096 / 1160-1163. The rebalance is invisible to the user: it is never quoted and the result is not returned to the UI.
5. [src/server/modules/api/trade/trade.resolver.ts:176–191](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/trade/trade.resolver.ts#L176-L191)
   getBuyQuote reports sats_amount = decoded.tokens (the invoice amount only). The counterparty's forwarding fee is not part of the quote the user confirms, so the user consents to a price that excludes the attacker-controlled component.
6. [src/server/modules/node/lnd/lnd.service.ts:332–343](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/node/lnd/lnd.service.ts#L332-L343)
   payViaRoutes and getRouteToDestination pass the resolver's options straight to the lightning library; no max_fee / max_fee_mtokens is injected anywhere in the chain.
7. [src/server/modules/api/trade/trade.resolver.ts:1235–1274](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/trade/trade.resolver.ts#L1235-L1274)
   findVirtualScidHint extracts channel, cltv_delta, base_fee_mtokens and fee_rate from the BOLT11 route hint; these are the peer's gossiped policy values (tapd/LND embed the remote node's policy for the TA channel into the hop hint).

## Impact
Direct loss of the operator's funds: sats are irrevocably transferred to the attacker far in excess of the quoted trade price, limited only by the victim's channel liquidity. No confidentiality or availability effect.

## Reproduction steps
1. Attacker is a remote Lightning node that has a Taproot Asset channel with the victim and appears as a trade offer (a third-party edge/trading partner, threat-model adversary 3). It publishes a channel_update with maximal base fee / fee rate on that channel (ordinary gossip, u32 fields, accepted by the victim's LND). The victim, using ThunderHub's TradeSheet, requests a quote (getBuyQuote returns only decoded.tokens, trade.resolver.ts:187; the UI shows only that number) and clicks Execute Trade; executePurchase computes peerFeeMtokens from the hint (315-317) with no cap, only a liquidity filter (328), and pays via payViaRoutes (479). For sells, ensureTaChannelSatReserve -> rebalanceTaChannel (1028-1033, 1061, 1160) silently pays the same uncapped peer fee on a circular self-payment that is never quoted, with failures downgraded to warnings (835). Explicit dependency assumptions, not verified in this checkout: (a) tapd (@lightningpolar/tapd-api ^0.7.0-alpha against tapd) copies the peer's inbound channel policy FeeBaseMsat/FeeProportionalMillionths into the AddInvoice hop hint, and LND's private-channel hop hints carry the remote policy; (b) LND SendToRoute enforces no fee limit while QueryRoutes defaults its limit to the payment amount, so only the base route is bounded; (c) lightning@11.1.0 payViaRoutes/getRouteToDestination pass the resolver's options through unchanged (lnd.service.ts:334-341) and getChannels exposes partner_scid_alias as the project's own spec tests assume - if not, the sell/rebalance path throws before paying and only the buy path is live.

## Recommended fix
1. peerFeeMtokens in executePurchase and rebalanceTaChannel is taken verbatim from the counterparty's advertised policy and paid through SendToRoute, which enforces no fee limit; the quote presented to the user excludes this fee. Fix criteria: The server must enforce an upper bound on the total fee of any route it constructs (peer hop plus base route), expressed as an absolute cap and/or percentage of the trade amount, and must abort before paying when the bound is exceeded. The quote returned by getTradeQuote must include the expected peer forwarding fee so the user confirms the full cost. Verification: with a peer advertising maximal base fee and fee rate, executeTrade must fail with a fee-limit error and no payment or rebalance must be attempted.
2. The circular rebalance in ensureTaChannelSatReserve moves up to the full sale value through the counterparty without the user being quoted or informed of its cost. Fix criteria: Rebalance cost must be bounded by the same fee limit, surfaced to the user (in the quote or as an explicit confirmation), and reported in the execute result. Verification: a sell against a peer with a high-fee TA channel policy must not silently pay more than the configured limit.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper Quantity Validation
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257324

---

# purchaseLiquidity pays Magma-supplied invoice without verifying amount or destination

## Details
AmbossResolver.purchaseLiquidity (src/server/modules/api/amboss/amboss.resolver.ts:54-142) is the server half of the 'Boost Your Liquidity' flow in BuyChannel.tsx: the operator picks a USD amount, confirms 'Confirm $X', and the client sends only amount_cents. The server (1) reads the node URI, (2) obtains the node's Amboss API key, (3) POSTs PurchaseLiquidity to the Magma endpoint resolved for the node's network (https://magma.amboss.tech/graphql on mainnet, utils/network.ts:37-40) and takes data.liquidity.buy.payment.lightning_invoice verbatim (lines 87-114; the only check is truthiness), then (4) immediately pays it with the node's funds via nodeService.pay(user.id, { request: liquidityInvoice }) (line 128), which forwards straight to lightning.pay with only `request` set (lnd.service.ts:278-280).

The invoice is never decoded. The server does not compare its amount with the operator-approved amount_cents (nor with any sats expectation), does not check the payee, and sets no max_fee; the client never sees the invoice, so the operator's 'Confirm $10' is bound to nothing the node actually pays. Whatever the Magma backend returns is settled. The threat model lists Amboss/Magma API responses as malicious remote data to be interpreted defensively, and the project's own LNURL-pay resolver (lnurl.resolver.ts:185-192) decodes the remotely supplied invoice and aborts when decoded.tokens exceeds the requested amount — the maintainers' own standard for a remote-supplied invoice. purchaseLiquidity has no such check, so a compromised or hostile Magma backend (or anyone able to answer for magma.amboss.tech) can return an invoice for an arbitrary amount — bounded only by the node's outbound liquidity — and the node pays it as soon as the operator confirms a small purchase. The rate shown to the operator (getLiquidityPerUsd, lines 40-52) also comes from the same Magma endpoint, so it cannot serve as the independent bound.

The MAGMA_API_URL env override (configuration.ts:159) is operator configuration and is not the attack vector; it only selects which endpoint's answer is trusted. The parallel blind-pay at magma.resolver.ts:444 is a separate call site requiring its own fix.

Explicit dependency assumption: in the pinned `lightning` 11.1.0, pay({lnd, request}) pays the amount encoded in the invoice; with no max_fee/max_fee_mtokens the routing-fee bound is whatever that library/LND default is, which is not asserted here.

## Evidence
1. [src/server/modules/api/amboss/amboss.resolver.ts:118–137](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/amboss/amboss.resolver.ts#L118-L137)
   The pay step calls nodeService.pay(user.id, { request: liquidityInvoice }) with the raw BOLT11 string returned by the Magma API; no decodePaymentRequest, no comparison of the decoded amount against the operator-approved amount_cents, no max_fee bound and no payee check. This is the code the fix must change.
2. [src/server/modules/api/amboss/amboss.resolver.ts:87–114](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/amboss/amboss.resolver.ts#L87-L114)
   liquidityInvoice is taken verbatim from data.liquidity.buy.payment.lightning_invoice of the Magma GraphQL response; the only validation is that the field is truthy.
3. [src/client/src/views/home/liquidity/BuyChannel.tsx:253–267](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/home/liquidity/BuyChannel.tsx#L253-L267)
   The operator confirms only a USD figure; the mutation carries amount_cents alone and the client never receives or displays the invoice, so no user-side check binds the confirmed amount to what the node pays.
4. [src/server/modules/api/amboss/amboss.service.ts:111–115](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/amboss/amboss.service.ts#L111-L115)
   resolveMagmaUrl selects the Magma endpoint from the node's network (hard-coded https://magma.amboss.tech / magma-dev.amboss.tech in utils/network.ts:37-40); whoever answers at that endpoint authors the invoice that is paid.
5. [src/server/modules/fetch/fetch.service.ts:45–61](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/fetch/fetch.service.ts#L45-L61)
   graphqlFetchWithProxy returns the remote JSON `data` as-is; no schema validation of the response.
6. [src/server/modules/api/lnurl/lnurl.resolver.ts:185–192](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L185-L192)
   The sibling LNURL-pay flow decodes the remote invoice and rejects it when decoded.tokens exceeds the user-requested amount before paying — the project's own model for how a remotely supplied invoice must be treated.
7. [src/server/modules/node/lnd/lnd.service.ts:278–280](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/node/lnd/lnd.service.ts#L278-L280)
   The provider forwards options straight to lightning.pay; with only { request } set the payment amount is entirely dictated by the invoice.

## Impact
The node's Lightning funds are sent to an attacker-chosen invoice for an attacker-chosen amount, bounded only by the node's outbound liquidity — a direct, unauthorised movement of funds beyond the price the operator approved (integrity HIGH) that also drains channel liquidity (availability LOW). No confidential data is exposed by the defect itself.

## Reproduction steps
1. Attacker position: whoever controls the response of the Magma GraphQL endpoint the server resolves for the node's network (a compromised or hostile Amboss Magma backend, or an interposer able to answer for magma.amboss.tech) — a position the threat model names as in-scope malicious remote data. Delivery: the authenticated operator clicks Confirm for e.g. $10 in BuyChannel.tsx; the server POSTs PurchaseLiquidity and receives an invoice for an attacker-chosen amount; nodeService.pay settles it with no decode, amount, payee or fee check. No privileges on ThunderHub are needed (PR:N); the attacker must hold the Magma-response position, which is outside their direct control (AT:P); the operator's purchase action is required (UI:A).

## Recommended fix
A BOLT11 payment request supplied by a remote HTTP API is paid without the server verifying that its amount, payee or fee bound correspond to what the operator authorised; the operator's confirmation covers a USD figure that is never bound to the invoice actually paid. Fix criteria: Before paying, the server decodes the invoice and refuses it unless the decoded amount is within an expected range for the approved amount_cents derived from a bound that does not come solely from the same Magma endpoint (e.g. a client-supplied maximum in sats that the operator saw and confirmed, or an independent rate source), the payee matches the expected Magma destination, and an explicit max_fee is set on the pay call. Verify: a PurchaseLiquidity response carrying an invoice whose amount exceeds the approved bound, or with an unexpected payee, is rejected and no pay call is made.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257322

---

# LNURL resolvers fetch arbitrary user-supplied URLs server-side without scheme or destination checks (SSRF)

## Details
Three authenticated GraphQL operations in the LNURL module make the ThunderHub server issue HTTP GET requests to destinations fully chosen by the caller, with no validation of scheme or host:

1. `fetchLnUrl(url)` (lnurl.resolver.ts:113-127) fetches `url` verbatim. `http://`, loopback, RFC1918, link-local and IPv6-literal destinations are all accepted. The remote JSON is handed back through the `LnUrlRequest` union, so any internal endpoint whose JSON object contains a `maxSendable`, `maxWithdrawable` or `uri` key has its LNURL-named fields disclosed. Responses are also distinguishable: a JSON object lacking those keys yields GraphQL's abstract-type resolution error, while connection failure, a non-JSON body and `status:"ERROR"` all yield `ProblemFetchingFromLnUrlService`, giving a JSON-object-vs-other content oracle on internal services.

2. `lnUrlAuth(url)` (lnurl.resolver.ts:92-110, lnurl.service.ts:29-85) requires only that the URL has a host and a `k1` query parameter, then GETs `${url}&sig=…&key=…` and returns the remote `status` and `event`/`reason` strings. The SPA triggers this mutation automatically when a pasted/scanned LNURL decodes to a URL with `tag=login` (quickActions/lnurl/index.tsx:53-55), so a victim operator who pastes a crafted LNURL causes the request with no further confirmation.

3. `getLightningAddressInfo(address)` (lnurl.resolver.ts:60-89) builds `https://${domain}/.well-known/lnurlp/${local}` without encoding either part. `domain` may be `127.0.0.1:8443` or any private host (optionally with a path prefix), and `local` may contain `../` and `?`, which the WHATWG URL parser normalises so the request lands on an arbitrary path and query of the chosen host. Fields `callback`, `maxSendable`, `minSendable`, `metadata`, `commentAllowed`, `tag` are returned. This path is HTTPS-only with default certificate verification (NODE_TLS_REJECT_UNAUTHORIZED is not set in the tree), so it reaches only internal services presenting a trusted certificate or redirecting elsewhere.

`FetchService.fetchWithProxy` (fetch.service.ts:28-32) adds no protection: Node's global fetch (Node 24.13.1 per Dockerfile; undici) follows redirects by default, including https->http, and there is no timeout or body-size limit. The optional `TOR_PROXY_SERVER` agent is passed as an `agent` option that the global fetch does not recognise (assumption on undici; lead lead-fetch-28-1cfb), and the default deployment sets no proxy anyway, so these requests originate directly from the server.

The maintainers treat server-side fetches to caller-chosen hosts as a trust boundary — `validateCallbackUrl` (HTTPS-only, private-network blocklist) guards `lnUrlPay`, `lnUrlWithdraw` and `lnUrlChannel` — but these three entry points bypass that control entirely. ThunderHub is multi-tenant (YAML accounts and DB users share one process and network position, typically alongside LND/litd/tapd REST, Bitcoin Core, databases and Docker-internal services), so a low-privilege authenticated user can use the server as a pivot to probe and partially read internal HTTP services not reachable from outside. The same sink is reachable without an account by handing a malicious LNURL (QR code, lightning address) to an operator.

A separately verified SSRF record exists at a different entry point (`bake-super-macaroon-rest-host-ssrf`, macaroon.resolver.ts); this finding covers the LNURL entry points, which are reachable by every authenticated principal and need no litd setup.

## Evidence
1. [src/server/modules/api/lnurl/lnurl.resolver.ts:112–127](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L112-L127)
   fetchLnUrl passes the GraphQL `url` argument verbatim to fetchService.fetchWithProxy with no validateCallbackUrl call, no scheme restriction (http: accepted) and no private/loopback check. The parsed JSON is returned through the LnUrlRequest union, so any response object containing `maxSendable`, `maxWithdrawable` or `uri` has its LNURL-named fields (callback, k1, min/max amounts, metadata, defaultDescription, commentAllowed, tag, uri) disclosed to the caller. A JSON object lacking those keys makes resolveType return undefined and surfaces GraphQL's abstract-type error, whereas a connection failure, a non-JSON body or `status:"ERROR"` all collapse to 'ProblemFetchingFromLnUrlService' (lines 118-125), giving a JSON-object-vs-other oracle on internal endpoints.
2. [src/server/modules/api/lnurl/lnurl.resolver.ts:59–89](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L59-L89)
   getLightningAddressInfo splits `address` on '@' and interpolates both halves unencoded into `https://${split[1]}/.well-known/lnurlp/${split[0]}`. split[1] may be any host:port (loopback, RFC1918, plus a path prefix), and split[0] may contain `../` and `?`, which the WHATWG URL parser normalises into an arbitrary path and query on that host. Fields callback/maxSendable/minSendable/metadata/commentAllowed/tag are returned when callback, maxSendable and minSendable are truthy. Limited to HTTPS with default certificate verification (NODE_TLS_REJECT_UNAUTHORIZED is not set anywhere in the tree).
3. [src/server/modules/api/lnurl/lnurl.resolver.ts:91–110](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L91-L110)
   lnUrlAuth fetches `finalUrl` built by lnAuthUrlGenerator from the caller's `url` (any scheme/host; only a host and a k1 query parameter are required) and returns the remote `status` and `event`/`reason` strings. Requires the principal to be bound to a node (getWalletInfo/diffieHellmanComputeSecret). The SPA fires this mutation automatically when a pasted LNURL decodes to tag=login (quickActions/lnurl/index.tsx:53-55), with no confirmation step.
4. [src/server/modules/api/lnurl/lnurl.service.ts:29–38](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.service.ts#L29-L38)
   lnAuthUrlGenerator only checks that `new URL(url).host` and the `k1` query parameter exist; it restricts neither scheme nor destination, and returns `${url}&sig=...&key=...` for the fetch at resolver line 96.
5. [src/server/modules/fetch/fetch.service.ts:28–32](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/fetch/fetch.service.ts#L28-L32)
   fetchWithProxy is a thin wrapper over Node's global fetch (Node 24.13.1 per Dockerfile): no destination allow/deny list, no timeout, no body-size bound, and default redirect:'follow'. The `agent` option it passes when TOR_PROXY_SERVER is set is not an option of the global (undici) fetch, so even that optional proxy does not divert these requests (assumption on Node 24 / undici behaviour; see lead lead-fetch-28-1cfb). The default deployment sets no proxy at all.
6. [src/server/modules/api/lnurl/lnurl.resolver.ts:19–48](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L19-L48)
   validateCallbackUrl (HTTPS-only plus a private-network blocklist) is the project's shipped control for caller-chosen LNURL destinations; it is applied only to lnUrlPay (136), lnUrlWithdraw (222) and lnUrlChannel (267), and none of the three entry points above call it.

## Impact
On the ThunderHub process itself the attacker learns which internal hosts/ports answer with JSON objects and reads back LNURL-named fields; the substantive impact is on the internal services the server can reach, rated as the subsequent system. Confidentiality is Low on the vulnerable system because the oracle and returned fields leak limited information about the server's network. Subsequent-system impact: The server's network position is used to send attacker-shaped GET requests (arbitrary host, port, path and query; http or https for fetchLnUrl) to internal HTTP services (LND/litd/tapd REST, Bitcoin Core, database HTTP admin ports, Docker-internal services, cloud metadata) that are not exposed externally; JSON fields matching LNURL names are read back and a JSON-object oracle applies to everything else. Only GET with no custom headers or body is possible, so integrity impact is limited to GET-triggered side effects on such services.

## Reproduction steps
1. Any authenticated principal (YAML account or DB user; fetchLnUrl and getLightningAddressInfo do not even need a node bound via x-node-slug) sends `mutation { fetchLnUrl(url: "http://127.0.0.1:8080/v1/...") { ... } }` or `query { getLightningAddressInfo(address: "../../path?q=1@10.0.0.5:9443") { ... } }` to /graphql; the server performs the GET from its own network position and returns LNURL-shaped fields or an error that distinguishes a JSON object from anything else. No rate limit effectively applies (throttler limit x1000). Alternatively an unauthenticated attacker publishes an LNURL encoding an internal URL with tag=login and waits for an operator to paste it; the primary vector needs no interaction.

## Recommended fix
1. fetchLnUrl, lnUrlAuth and getLightningAddressInfo hand caller-controlled URLs/hosts to the server-side fetch without any scheme or destination validation, so the server can be directed at internal hosts. Fix criteria: Every LNURL-related server-side fetch must pass a single destination validator that rejects non-HTTPS URLs (except .onion over the Tor proxy if supported), resolves the hostname and rejects loopback, private, link-local, CGNAT and IPv6 ULA/mapped addresses, and disables or re-validates redirects. Verify by submitting fetchLnUrl/lnUrlAuth/getLightningAddressInfo with http://, 127.0.0.1, [::1], 10.x and redirecting hosts and confirming no outbound request is made.
2. getLightningAddressInfo interpolates the local part and domain of the address into a URL without encoding, allowing path traversal and query injection on the chosen host. Fix criteria: Validate the lightning address against the LUD-16 grammar (local part [a-z0-9-_.]+, domain a hostname) and percent-encode the local part; `../`, `?`, `#` and `:` in the local part must be rejected. Verify that `../../x?y@host` no longer produces a request to /x.

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
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257321

---

# toggleConfig lets any authenticated principal flip server-wide Amboss push settings for all accounts

## Details
`UserConfigResolver.toggleConfig` (src/server/modules/api/userConfig/userConfig.resolver.ts:134-187) is an authenticated but unscoped mutation: it takes only a `ConfigFields` enum, has no `@CurrentUser()`, `@Roles()` or ownership check, and is reachable by any principal holding a valid session JWT (GqlAuthGuard only requires a JWT; RolesGuard is a no-op without `@Roles`). It dispatches to `UserConfigService.toggleValue` (userConfig.service.ts:48-71), which parses the single server-wide account YAML at `ACCOUNT_CONFIG_PATH`, flips one of the top-level flags `backupsEnabled`, `healthCheckPingEnabled`, `onchainPushEnabled`, `channelPushEnabled`, `privateChannelPushEnabled`, and rewrites the whole file via `saveHashedYaml`.

These flags are account-agnostic and consumed process-wide:
- `AmbossService.pushBalances` (amboss.service.ts:448-681) and `ping` (314-446) run every minute in production and, when the flags are on, iterate `accountsService.getAllAccounts()` — every YAML account, the SSO account and every DB node cached by a slug lookup — and push each mainnet node's on-chain balance, public (and optionally private) channel balances and a signed liveness ping to Amboss.
- The `SubService` backup subscription (sub.service.ts:401-449) checks `backupsEnabled` on every SCB event for every node and, when on, signs and uploads the node's static channel backup to Amboss; when off, it drops it.

Multi-tenancy in this version comes from the YAML account file: each `accounts[]` entry has its own `password` (or shares `masterPassword`), each holder logs in with `public.get_session_token(id,password)` and receives a `yaml:<hash>` JWT, and the project otherwise isolates accounts from one another (threat model adversary 2; verified finding node-slug-guard-yaml-cross-account-swap). DB mode currently admits only the single initial owner (`create_initial_user` runs only while `needsSetup()`; no other insert into `users`), so the DB owner is effectively the operator, but a DB owner and YAML accounts can coexist on one process.

Result: on a server hosting several YAML accounts held by different people, any one account holder can (a) switch on balance/health pushes so the financial data of every other account's mainnet node is sent to Amboss, a third party, without those holders' consent, (b) switch off `backupsEnabled` so other operators' off-site channel backups silently stop, and (c) force a rewrite of the operator's account YAML. The UI presents these toggles under per-user Settings/Amboss pages (src/client/src/views/settings/Amboss.tsx, views/amboss/{Backups,Balances,Healthchecks}.tsx), so a holder reasonably believes they are personal settings. The companion `getConfigState` query exposes the same global flags to any authenticated user.

Preconditions: `ACCOUNT_CONFIG_PATH` is set (it necessarily is in any multi-account YAML deployment and is the docker-compose default; without it `toggleValue` throws), the server runs with NODE_ENV=production (the Dockerfile and fly.toml set it; pushes are skipped otherwise), and the respective `DISABLE_BACKUP_SUB` / `DISABLE_HEALTHCHECK_PINGS` / `DISABLE_BALANCE_PUSHES` env switches are not set (unset by default).

## Evidence
1. [src/server/modules/api/userConfig/userConfig.resolver.ts:134–187](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/userConfig/userConfig.resolver.ts#L134-L187)
   toggleConfig takes only the ConfigFields enum; there is no @CurrentUser, @Roles or ownership check. Any JWT holder that passes GqlAuthGuard (any YAML account holder, the SSO account or the DB owner) can call it and flip a server-wide flag.
2. [src/server/modules/api/userConfig/userConfig.service.ts:48–71](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/userConfig/userConfig.service.ts#L48-L71)
   toggleValue reads the single shared account YAML (ACCOUNT_CONFIG_PATH), flips a top-level, account-agnostic key and rewrites the whole file with saveHashedYaml. The flags are process-wide, not per-account or per-node.
3. [src/server/modules/api/amboss/amboss.service.ts:448–495](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/amboss/amboss.service.ts#L448-L495)
   pushBalances (every minute in production) reads the global onchain/channel/private-channel flags and, when any is on, enumerates accountsService.getAllAccounts() — every YAML account, SSO and cached DB node — and pushes each mainnet node's balances to Amboss (lines 545-666). One tenant's toggle therefore discloses every other tenant's node balances to a third party.
4. [src/server/modules/api/amboss/amboss.service.ts:314–353](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/amboss/amboss.service.ts#L314-L353)
   ping likewise reads the global healthCheckPingEnabled flag and, when set by anyone, enumerates all non-encrypted accounts and sends signed health-check pings for every mainnet node.
5. [src/server/modules/sub/sub.service.ts:401–449](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/sub/sub.service.ts#L401-L449)
   The backup subscription, established for every account in getAllAccounts(), consults the global backupsEnabled flag on each SCB event; flipping it off silently stops other operators' off-site channel backups, flipping it on signs and uploads every node's SCB to Amboss.
6. [src/server/modules/security/guards/roles.guard.ts:20–42](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/security/guards/roles.guard.ts#L20-L42)
   RolesGuard returns true whenever no @Roles decorator is present and @Roles is not applied to toggleConfig, so no administrative role separation protects this server-wide setting.
7. [src/server/modules/api/public/public.resolver.ts:203–289](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/public/public.resolver.ts#L203-L289)
   get_session_token issues a yaml:<hash> JWT to whoever knows one account's id and password, so each YAML account is an independently authenticated principal; this is the position from which toggleConfig is called.

## Impact
Confidentiality LOW: other tenants' on-chain and channel balances, liveness and signed channel backups for their mainnet nodes are pushed to Amboss, an external service, without their consent; the data goes to the third party rather than directly to the attacker. Integrity LOW: the attacker alters server-wide configuration, disables other operators' automatic off-site backups, and triggers rewrites of the operator-owned account YAML. Availability NONE.

## Reproduction steps
1. Attacker is any authenticated principal of a shared ThunderHub instance — in practice a YAML account holder with their own account password (DB mode currently admits only one owner). They send `mutation { toggleConfig(field: ONCHAIN_PUSH) }` (or CHANNELS_PUSH / PRIVATE_CHANNELS_PUSH / HEALTHCHECKS / BACKUPS) over the ordinary /graphql endpoint with their own session cookie; the UI's Settings → Amboss toggles do exactly this. No ownership, role or node-scoping check exists. The server must have ACCOUNT_CONFIG_PATH set (always true for a multi-account YAML deployment) and run in production mode (Dockerfile/fly.toml default); DISABLE_* switches are unset by default.

## Recommended fix
1. A process-wide setting that controls outbound disclosure of every account's node data is exposed as an ordinary authenticated mutation with no role or ownership check. Fix criteria: Only a principal with administrative authority over the server (or, if the settings are made per-account, only the owning account) may change these flags; non-admin tenants receive an authorization error and the YAML is not modified. Verify by calling toggleConfig as a second YAML account or a DB user without admin role and confirming the file and getConfigState are unchanged.
2. The flags are stored and evaluated globally, so one tenant's preference governs pushes for all nodes. Fix criteria: Push/backup/health-check enablement should be scoped per account or node (and consulted per node in AmbossService/SubService) so that enabling pushes for one account never causes another account's balances or backups to be sent. Verify by enabling pushes for account A and confirming no data for account B is sent.

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
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257319

---

# Wrong-password login replaces an encrypted YAML account's live macaroon before validating it

## Details
YAML accounts may be declared with `encrypted: true`; the macaroon on disk is then a crypto-js/OpenSSL `Salted__` AES-256-CBC blob encrypted with the account password. At boot `getParsedAccount` (files.service.ts 337-354) stores that blob both as `encryptedMacaroon` and as the initial `macaroon`, so the account's connection is non-functional until the owner logs in. In `get_session_token` (public.resolver.ts 222-237) the encrypted branch runs `decodeMacaroon(account.encryptedMacaroon, password)` and immediately commits the result with `accountsService.updateAccountMacaroon(id, macaroon)`; only afterwards (line 271) does `getWalletInfo(account.hash)` test the credential, and a failure there just throws 'UnableToConnectToThisNode' without restoring the previous macaroon/connection.

`decodeMacaroon` (crypto.ts 22-41) is unauthenticated CBC with an EVP_BytesToKey(MD5) key and no MAC. For a wrong password the plaintext is pseudo-random and `decipher.final()` throws only when the trailing bytes are not valid PKCS#7 padding; a final byte of 0x01 (1/256) plus smaller contributions from 0x02 0x02 etc. passes and the function returns garbage as the 'macaroon'. `updateAccountMacaroon` (accounts.service.ts 217-232) then rebuilds `connection` via `provider.connect` and overwrites `accounts[id].macaroon`/`connection` for the single process-wide account record that every session of that account resolves through (`NodeService.getAccountAndProvider` reads `account.connection` on each call). For the default LND provider `connect` is `authenticatedLndGrpc({socket, cert, macaroon})` (lightning 11.1.0), which only normalises the macaroon string to hex metadata and does not validate or test it (assumption about the dependency; the project's own `add_node` path at account.resolver.ts 181-186 calls `verifyConnection` separately, confirming `connect` itself verifies nothing).

Because `get_session_token` is public and account hashes are listed unauthenticated by `get_server_accounts` (account.resolver.ts 312-337), an unauthenticated attacker can repeatedly call it with arbitrary passwords for an encrypted account. About every 256th attempt silently replaces the live admin macaroon with garbage; every already-authenticated session of that account (JWTs valid 24 h, no revocation) then fails all node operations until the owner logs in again with the correct password, and the attacker can repeat indefinitely. The root `public` throttle of 4/10 s makes the expected time to a hit roughly ten minutes, and aliased field resolvers in one request execute without that throttle. (Encrypted accounts are excluded from SubService subscriptions at sub.service.ts:71, so background subscriptions are not affected.)

This is a commit-before-validate ordering defect compounded by unauthenticated encryption. Condition: only accounts declared `encrypted: true` are affected, and only with NODE_ENV=production (the branch is refused otherwise; the Dockerfile and fly.toml set production).

## Evidence
1. [src/server/modules/api/public/public.resolver.ts:222–237](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/public/public.resolver.ts#L222-L237)
   Encrypted-account branch of the @Public get_session_token field: decodeMacaroon with the caller's password is committed via updateAccountMacaroon (line 235) before getWalletInfo (line 271) tests the credential; a failed test throws without restoring the previous macaroon/connection.
2. [src/server/utils/crypto.ts:22–40](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/utils/crypto.ts#L22-L40)
   decodeMacaroon is unauthenticated AES-256-CBC: a wrong password only throws when PKCS#7 padding is invalid (~255/256 of attempts); otherwise random bytes are returned as the 'macaroon'.
3. [src/server/modules/accounts/accounts.service.ts:217–232](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/accounts/accounts.service.ts#L217-L232)
   updateAccountMacaroon rebuilds the connection with provider.connect (no verification; the lightning 11.1.0 authenticatedLndGrpc only normalises the macaroon string) and overwrites macaroon/connection on the shared, process-wide account record that NodeService resolves on every call for every session of that account.
4. [src/server/modules/api/account/account.resolver.ts:312–345](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/account/account.resolver.ts#L312-L345)
   Account ids (hashes) needed for get_session_token are listed to unauthenticated callers.

## Impact
Integrity: an unauthenticated party overwrites the in-memory node credential and gRPC connection of another principal's account with garbage (low: not attacker-chosen, grants no access). Availability: all authenticated sessions of the encrypted account lose node access through ThunderHub until the owner re-authenticates with the correct password, and the attacker can re-trigger at will; the LND node itself and the account's background subscriptions (excluded for encrypted accounts) are unaffected. No confidentiality impact.

## Reproduction steps
1. Unauthenticated network attacker reads the target account hash from the public get_server_accounts query and sends get_session_token with arbitrary wrong passwords. Each attempt has about a 1/256 chance of producing padding-valid garbage that is committed as the account's live macaroon before validation; the expected ~256 attempts fit in about ten minutes under the 4/10 s root throttle, and aliased fields in one request avoid it. Deterministic in expectation, repeatable, no victim interaction. Requires the target YAML account to use the `encrypted: true` option in a production-mode deployment (AT: PRESENT).

## Recommended fix
1. The decrypted macaroon is written into the shared account state before it has been proven valid, and a failed validation does not restore the previous state. Fix criteria: A login attempt that does not end in a successful getWalletInfo must leave the account's macaroon/connection unchanged (validate the decrypted credential on a temporary connection first, or restore on failure); verify that a wrong-password attempt never alters an existing valid connection.
2. Password-based macaroon encryption uses CBC without authentication, so wrong keys are only detected probabilistically via padding. Fix criteria: Decryption must deterministically reject wrong passwords (authenticated encryption or a MAC/KDF check), so garbage can never be mistaken for a credential.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Incorrect behavior order
**CWE:** [CWE-696](https://cwe.mitre.org/data/definitions/696.html)
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257317

---

# Magma order invoice paid blind: no amount check or fee cap on remote-supplied invoice

## Details
`MagmaResolver.setupTradeCapacity` (src/server/modules/api/magma/magma.resolver.ts, authenticated mutation) creates a Magma channel order by POSTing to the Magma API URL from `resolveMagmaUrl` (hard-coded `https://magma.amboss.tech/graphql` / `magma-dev.amboss.tech`, or the `MAGMA_API_URL` override) and then, in the `payMagma` step, immediately calls `nodeService.pay(user.id, { request: magmaOrder.invoice })` with the BOLT11 invoice taken verbatim from the reply (`data.market.order.create.payment.lightning.invoice`).

Nothing between the remote reply and the LND `pay` call validates the invoice:
- it is not decoded and its amount is not compared to the order the server itself requested (`magmaSize` + offer fees), to `order.size`, or to `order.fees.buyer.sats`;
- no `tokens` bound and no `max_fee`/`max_fee_mtokens` is set (assumption about the pinned dependency `lightning` 11.1.0: `pay` with only `request` pays the invoice's encoded amount and applies no fee cap when `max_fee` is omitted);
- the invoice destination is not checked;
- the client confirm steps (TradeSheet.tsx shows only channel size; SidebarTrade.tsx shows a client-side fee estimate) send no approved cost to the server, so the operator has not approved any ceiling that the server could enforce.

The threat model lists Amboss/Magma API responses as adversarial remote data. Whoever authors the Magma reply (a compromised or malicious Magma backend, or anyone able to interpose on the HTTPS/Tor-proxied path) can return an invoice for an arbitrary amount — up to the node's outbound Lightning liquidity — payable to any destination, and the operator's node pays it the moment the operator clicks the normal setup button for a small trade. Because Magma invoices are HODL invoices the code deliberately does not wait for settlement; the payment is in flight when the mutation returns, and the mutation reports success as soon as any channel from the peer appears or after 120 s.

The project's own controls for this surface show the omission: the sanctioned Magma-order payment path (MagmaOrders.tsx → `Pay` component) decodes the invoice, shows the operator its amount and passes `max_fee`; `lnurl.resolver.ts:185-195` decodes a remote invoice and rejects `decoded.tokens > amount`; `trade.resolver.ts:260-269` decodes and checks `tokens` before paying. The Magma auto-setup path has none of these. The same blind-pay pattern exists in the older `purchaseLiquidity` in amboss.resolver.ts:128 (tracked separately).

## Evidence
1. [src/server/modules/api/magma/magma.resolver.ts:444–446](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/magma/magma.resolver.ts#L444-L446)
   Sink: `nodeService.pay(user.id, { request: magmaOrder.invoice })` pays the BOLT11 string exactly as returned by the Magma API. No `tokens`, `max_fee` or `max_fee_mtokens` is passed and the invoice is never decoded, so LND sends whatever amount the remote reply encoded, to whatever destination it names.
2. [src/server/modules/api/magma/magma.resolver.ts:381–414](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/magma/magma.resolver.ts#L381-L414)
   Source: `order`, `invoice`, `order.size` and `order.fees.buyer.sats` all come from the `graphqlFetchWithProxy` reply. They are only logged and echoed back to the client after the fact; the invoice is not reconciled against `order.size`, `order.fees`, or the size the server itself requested.
3. [src/server/modules/api/magma/magma.resolver.ts:336–378](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/magma/magma.resolver.ts#L336-L378)
   The server knows the order it is placing (`magmaSize` from `input.assetAmount`/`input.assetRate`, `offer_id`) and sends it to the Magma URL from `resolveMagmaUrl` (hard-coded `https://magma.amboss.tech/graphql` on mainnet, network.ts:38, or `MAGMA_API_URL`), but never derives an expected cost from it to bound the invoice it then pays.
4. [src/server/modules/node/lnd/lnd.service.ts:278–280](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/node/lnd/lnd.service.ts#L278-L280)
   The provider forwards `PayOptions` verbatim to `lightning.pay` (litd.service.ts:182 delegates here too); no default fee ceiling or amount bound is injected anywhere between the resolver and LND.
5. [src/client/src/views/home/account/pay/Pay.tsx:20–37](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/home/account/pay/Pay.tsx#L20-L37)
   The sanctioned path for paying a Magma order invoice (MagmaOrders.tsx:417-418 renders `<Pay predefinedRequest={invoice}>`) decodes the invoice client-side and shows the operator its amount before the click, and submits `max_fee: fee` with the `pay` mutation (lines 85-101). `setupTradeCapacity` bypasses both of these controls by paying server-side with no decode and no fee cap.
6. [src/server/modules/api/lnurl/lnurl.resolver.ts:185–195](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L185-L195)
   Sibling server path paying a remotely supplied invoice: decodes it and rejects when `decoded.tokens > amount`. Together with trade.resolver.ts:260-269 (`executePurchase` decodes and checks `tokens`/`mtokens`), this shows the project treats remote invoices as untrusted; the Magma path omits the equivalent guard.
7. [src/client/src/views/assets/TradeSheet.tsx:906–918](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/assets/TradeSheet.tsx#L906-L918)
   The TradeSheet confirm step before `setupTradeCapacity` displays only the Magma channel size, never a sats price. SidebarTrade.tsx:779-820 shows a client-computed fee *estimate* from the offer's `baseFeeSats`/`feeRatePpm`, but neither client sends an approved cost to the server and the server enforces none, so no operator-approved ceiling exists on either side.

## Impact
Direct, irreversible loss of funds from the operator's node up to its outbound Lightning liquidity once the HTLC settles — the operator approved a channel purchase of a known size, the node pays an arbitrary amount instead (integrity of the node's balance: HIGH). No confidentiality impact; no availability impact on ThunderHub itself.

## Reproduction steps
1. Attacker position: authorship of the Magma API response — a compromised or malicious Amboss Magma backend, or a TLS interposer on the server-to-magma.amboss.tech path (the position is outside the attacker's normal control, hence AT:PRESENT). No ThunderHub credentials are needed (PR:NONE). Delivery requires the operator to initiate a trade-capacity setup through the normal UI (UI:ACTIVE); the server then pays the returned invoice with no amount, destination or fee bound, so the attacker simply returns an invoice for a large amount to a destination they control (AC:LOW). Attack over the network (AV:NETWORK).

## Recommended fix
1. The invoice amount and destination returned by the remote Magma API are trusted implicitly; the server pays without reconciling the invoice against the order it requested or the cost the operator approved, violating the principle that money-moving operations are bounded by operator-approved parameters. Fix criteria: Before paying, decode the invoice and reject it unless its amount equals (or is within an explicit, operator-visible tolerance of) the expected cost — order size plus buyer fee as quoted in the offer the operator selected — and pass that bound as `tokens` to `pay`. Verification: a reply whose invoice amount differs from the quoted order cost must cause the mutation to fail without any payment attempt.
2. No routing-fee ceiling is passed to `pay`, so even a correctly priced invoice can incur unbounded routing fees, unlike the sanctioned `pay` mutation which requires `max_fee`. Fix criteria: Every server-initiated `pay` for a Magma order sets an explicit `max_fee`/`max_fee_mtokens` derived from the approved amount; verification: the LND request carries a finite fee limit.
3. The client confirm steps show only the channel size (TradeSheet) or a client-side estimate (SidebarTrade) and transmit no approved cost, so the operator never approves a sats ceiling the server could enforce. Fix criteria: The confirmation shown before `setupTradeCapacity` includes the expected sats cost and fee, that figure is sent with the mutation, and the server enforces it against the decoded invoice.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257316

---

# Unauthenticated get_server_accounts lists cached DB nodes' names, UUIDs and slugs

## Details
PublicQueriesResolver.get_server_accounts (account.resolver.ts:312-338) is reachable without authentication under the @Public() `public` query root and is meant to list the YAML accounts the operator configured so the login page can offer them. It builds its list from AccountsService.getAllAccounts(), which returns the one process-wide `accounts` map — and that same map is used by getDbNodeBySlug as a connection cache for database-managed nodes (accounts.service.ts:204). In DB mode (DB_TYPE set), every authenticated DB-user request that carries x-node-slug passes through NodeSlugGuard (node-slug.guard.ts:36-44), which calls getDbNodeBySlug and inserts the user's node into the map with hash = the node's full UUID, name = the user's chosen node name and slug = UUID[0:8]. The shipped SPA sends x-node-slug on every node-scoped page (client.tsx:25-41), so this happens as soon as a DB user opens their dashboard. From then on, until the node is deleted or the process restarts, any anonymous client posting `query { public { get_server_accounts { name id slug type } } }` receives that tenant's node name, full UUID and slug labelled as a 'server' account; the SPA's login page (Accounts.tsx) even renders it as a 'Server Accounts' login button.

The project's only sanctioned disclosure of DB-node names and identifiers is user.get_nodes → UserService.getUserNodeSlugs, which is authenticated and joins user_nodes on the caller's user_id. The public listing bypasses that ownership filter and hands the data to an unauthenticated network position. The leaked slug is exactly the value the x-node-slug paths (getAccountBySlug / getDbNodeBySlug cache scan) resolve without ownership checks, so this is the enumeration step that removes the 32-bit guess from those cross-tenant findings. On its own it is a confidentiality leak only: the DB-node entry carries password '' and encrypted=false, so get_session_token against its UUID reaches isCorrectPassword and fails (assumption: bcryptjs ^3.0.3 compareSync returns false for a hash that is not 60 characters) — no login bypass results.

## Evidence
1. [src/server/modules/api/account/account.resolver.ts:312–337](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/account/account.resolver.ts#L312-L337)
   Public field resolver iterates accountsService.getAllAccounts() — the shared in-memory map — and emits name, id (= hash) and slug for every entry except 'sso', typing them 'server'. It does not distinguish YAML accounts loaded at boot from DB nodes cached at runtime, so a DB tenant's node is listed to anonymous callers.
2. [src/server/modules/accounts/accounts.service.ts:188–204](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/accounts/accounts.service.ts#L188-L204)
   getDbNodeBySlug builds an EnrichedAccount with hash = full node UUID, name = user-chosen node name, slug = UUID[0:8] and stores it in this.accounts[node.id] (line 204) — the same map getAllAccounts() returns. From then on it is part of the public listing until removeAccount or restart.
3. [src/server/modules/security/guards/node-slug.guard.ts:36–44](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/security/guards/node-slug.guard.ts#L36-L44)
   For every authenticated DB-user request carrying x-node-slug the guard calls getDbNodeBySlug, which is what populates the cache; no attacker action is needed beyond the victim tenant using their own node normally.
4. [src/client/config/client.tsx:25–40](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/config/client.tsx#L25-L40)
   The shipped SPA sets x-node-slug from the first URL path segment on every GraphQL request, so a DB user's node is cached as soon as they open any /<slug>/... page — the precondition holds in ordinary use.
5. [src/server/modules/api/account/account.resolver.ts:120–125](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/account/account.resolver.ts#L120-L125)
   The parent `public` query root is @Public(); only a 4-per-10s throttle applies, which limits rate but not access.

## Impact
Discloses to unauthenticated clients the names, full UUIDs and 8-char slugs of other tenants' database-managed nodes — data the project otherwise shows only to the owning DB user via the owner-filtered get_nodes. No credentials are leaked and the entry cannot be logged into (empty bcrypt hash), so confidentiality impact is LOW; no integrity or availability effect by itself.

## Reproduction steps
1. Anonymous network client posts the public get_server_accounts query to /graphql; no credentials or user interaction. The only precondition is system state the victim creates in normal use — a DB user has opened a node page since process start, which the SPA does on every node-scoped request — hence attack_requirements PRESENT. The 4/10s throttle on the public root limits rate, not access.

## Recommended fix
The public account listing is derived from AccountsService.accounts, a map that doubles as the runtime connection cache for DB-managed nodes, so tenant data inserted by getDbNodeBySlug enters an unauthenticated response. Fix criteria: get_server_accounts returns only accounts configured for password/SSO login from the YAML file and SSO env (e.g. entries marked as such at load time, or DB nodes cached in a separate structure), never DB-backed entries. Test: in DB mode, after a DB user has made a request with x-node-slug for one of their nodes, the anonymous get_server_accounts response is byte-identical to the response before that request.

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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257310

---

# Tenant-controlled DB node joins shared subscription pipeline and can stall or kill all tenants' subscriptions

## Details
SubService.startSubscription runs one async.auto pipeline for every entry in the process-wide AccountsService.accounts map. At boot (onApplicationBootstrap, before any request) the map holds only YAML/SSO accounts, but a DB user's node is cached into the same map by getDbNodeBySlug (accounts.service.ts:204) the first time that user sends a request with x-node-slug for it — the normal UI flow right after team.add_node (NodeSwitcher navigates to /<slug>/home). Whenever any subscription stream errors (an ordinary LND restart on the operator's node), the completion handler (sub.service.ts:466-495) removes every listener, increments the never-reset retryCount, waits 30s*retryCount and re-runs auto; getNodes (62-91) then re-enumerates the map and now includes the DB user's node (encrypted:false). From then on that node is part of the operator's failure domain:

1. Teardown (certain from the code): every per-node stream registers sub.on('error') -> cbk(err) on a shared async.each (160-190 and siblings 211-243, 264-294, 315-372, 393-463). The DB user stopping or disconnecting their own node fails the task, auto completes with err, all listeners on every node's subscriptions are removed and retryCount advances. Three such events after the first natural one reach retryCount>=4 and the pipeline stops for the process lifetime ('Max retries attempted').

2. Stall (assumption on the dependency): checkNodes (94-120) awaits async.map(getWalletInfo) over all nodes; lightning 11.1.0's getWalletInfo is assumed to issue the unary gRPC call without a deadline, so a DB-user endpoint that accepts the connection but never answers GetInfo keeps auto pending forever and no subscription for any node is re-established.

What the operator actually loses: the automatic static-channel-backup push of their YAML/SSO nodes to Amboss (backups task 376-464, active only when backupsEnabled is set in the YAML, isProduction and mainnet). The SSE fan-out in the same pipeline is already non-functional in this version (SseController registers under 'yaml:<hash>' / DB user uuid while emit uses the bare hash / node uuid), so it is not a practical loss. There is no per-tenant isolation (separate pipeline, error containment or timeout) between the operator's accounts and DB-supplied nodes.

Attacker position and conditions: in v0.19.0 DB users are created only by the @Public create_initial_user while needsSetup() is true — there is no invite or registration path — so the attacker is the deployment's single DB owner, who holds no YAML/SSO node credentials and whose only sanctioned reach is their own nodes (team.add_node/edit_node/delete_node). The finding holds only in a mixed deployment with ACCOUNT_CONFIG_PATH (or SSO_*) and DB_TYPE both configured (in DB-only mode getNodes is empty at boot, checkAvailable throws UnableToConnectToAnyNode and the pipeline never runs), DISABLE_ALL_SUBS/DISABLE_BACKUP_SUB unset, the operator having opted into backupsEnabled, and one natural subscription error on an operator node having occurred (with retryCount still below 4) so the DB node is picked up on re-enumeration.

## Evidence
1. [src/server/modules/sub/sub.service.ts:62–90](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/sub/sub.service.ts#L62-L90)
   getNodes re-enumerates accountsService.getAllAccounts() on every (re)start of the pipeline and admits every non-encrypted entry. The map is the single process-wide cache that also holds DB tenants' nodes once getDbNodeBySlug has resolved them, so after the first retry a tenant-controlled node is subscribed alongside the operator's YAML/SSO nodes with no isolation.
2. [src/server/modules/sub/sub.service.ts:94–119](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/sub/sub.service.ts#L94-L119)
   checkNodes awaits async.map over every node's getWalletInfo. The call has no deadline/timeout (lightning 11.1.0 unary gRPC without deadline; assumption, dependency not inspected). If one node accepts the connection and never answers, map never resolves, auto never completes, and no subscription for any node is (re)established.
3. [src/server/modules/sub/sub.service.ts:160–189](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/sub/sub.service.ts#L160-L189)
   Each per-node subscription registers sub.on('error') that calls cbk(err) for the shared async.each. A single node's stream error therefore fails the whole task; the same pattern repeats for payments, forwards, channels and backups (211-243, 264-294, 315-372, 393-463).
4. [src/server/modules/sub/sub.service.ts:466–494](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/sub/sub.service.ts#L466-L494)
   The auto completion handler removes listeners on every subscription of every node, increments retryCount (never reset) and gives up permanently at 4. One misbehaving node thus tears down all tenants' subscriptions, and three further induced errors end the pipeline for the process lifetime.
5. [src/server/modules/accounts/accounts.service.ts:188–204](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/accounts/accounts.service.ts#L188-L204)
   A DB node resolved by slug is cached into the shared accounts map with encrypted:false, making it eligible for the SubService enumeration above.
6. [src/server/modules/api/account/account.resolver.ts:159–212](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/account/account.resolver.ts#L159-L212)
   team.add_node lets any authenticated DB user register an arbitrary socket/macaroon as a node; the only check is that the node answers getWalletInfo at registration time.
7. [src/server/modules/security/guards/node-slug.guard.ts:36–44](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/security/guards/node-slug.guard.ts#L36-L44)
   Sending any request with x-node-slug for the newly added node calls getDbNodeBySlug, which caches it into the shared map; this is the normal UI flow after adding a node.

## Impact
Availability of one background feature only: the automatic Amboss SCB backup push for the operator's YAML/SSO nodes stops until ThunderHub is restarted (SSE delivery is already broken by a key mismatch, so no further functional loss). No credential or data exposure, no change on the victim nodes; GraphQL queries and mutations keep working. The pipeline is by design already fragile (permanent stop after 4 errors from any node), so the attacker's gain is making that stop deterministic and immediate — real but small.

## Reproduction steps
1. Attacker is the authenticated DB owner user (adversary 2; the threat model's DB/YAML multi-tenant boundary) on a ThunderHub that also serves YAML/SSO accounts. They register a node they control via team.add_node (only check: it answers GetInfo at registration), open it once in the UI so getDbNodeBySlug caches it into the shared map, and wait for the pipeline's first natural restart (any LND reconnect on the operator side). Their node is then subscribed alongside the operator's; stopping their own LND three times exhausts the never-reset retry budget (certain from the code), or — assuming lightning 11.1.0 sets no gRPC deadline on getWalletInfo — pointing the socket at a stub that accepts connections and never answers stalls the pipeline permanently. Network-reachable, no victim interaction, low privileges (DB login only, no node credentials). AT:PRESENT for the mixed YAML+DB configuration, backupsEnabled opt-in, and the natural first error that must precede the attack.

## Recommended fix
1. SubService treats every entry of the shared accounts map, including nodes supplied by DB tenants, as one failure domain: a single node's error or hang aborts or blocks subscriptions for all nodes. Fix criteria: Subscriptions for each account are established and retried independently (or tenant nodes are excluded from the operator pipeline), so that an error or hang on one node never removes or prevents subscriptions on another. Verify: with a YAML node and a DB-tenant node both cached, making the tenant node hang GetInfo or error its streams leaves the YAML node's invoice/backup subscriptions active and the retry budget of other nodes unaffected.
2. checkNodes awaits getWalletInfo on every node with no deadline, so one unresponsive node blocks the whole pipeline indefinitely. Fix criteria: Connectivity probes used to gate subscriptions complete within a bounded time per node, and a node that times out is skipped rather than blocking the others. Verify: a node that accepts connections but never replies is dropped from the subscription set within the bound while the remaining nodes are subscribed.

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
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257427

---

# Remote-authored trade memo precision throws RangeError in Trading History render

## Details
The Trading page's 'Trade History' widget (TradingHistory.tsx, mounted by TradingGrid.tsx 78-81 under `/:slug/trading`, App.tsx 281-287) renders every invoice the server classifies as a trade. The server (`trade_invoices`, trade.resolver.ts 1369-1406) classifies by prefix alone: any invoice on the node whose description starts with `th:trade:` has its JSON tail parsed and `p` relayed as `asset_precision` after a bare `Number()` conversion; the GraphQL scalar is `Float` (schema.gql 1296), so 1, 1.5 and 101 all serialize. The client then calls `value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: precision })` (TradingHistory.tsx 26-35, called at 128) guarded only by `precision > 0`. Per ECMA-402 SetNumberFormatDigitOptions this throws RangeError when maximumFractionDigits is below the fixed minimumFractionDigits of 2 (precision 1, or 1.5 which floors to 1) or above 100 (e.g. 101); NaN takes the safe `formatNumber` branch. The throw happens during render; the only error boundary is the root one (App.tsx 354, ErrorBoundary.tsx 12-36), so the whole SPA is replaced by 'Something went wrong'; 'Try again' re-renders the same route with the same cached invoices and fails again, and because the invoice persists on the node the crash recurs on every visit to `/<slug>/trading` until 100 newer invoices push it out of the window the resolver scans.

Who can author such a memo:
1. A remote LNURL-withdraw service (threat-model adversary 3). The operator pastes an LNURL in the Home quick action (quickActions/lnurl/index.tsx), `fetchLnUrl` relays the service's JSON verbatim (lnurl.resolver.ts 113-126), `defaultDescription` is pre-filled into the withdraw form's description Input (LnWithdraw.tsx 35-37) and sent as `description` when the operator clicks Withdraw (154-156); `lnUrlWithdraw` creates the invoice on the node with that description before the callback is fetched (lnurl.resolver.ts 231-236), so the withdraw need not succeed. A value such as `th:trade:{"t":"buy","amt":"1","p":1}` is enough.
2. The Amboss trade API. ThunderHub's own trade mutations write `p: input.asset_precision` into the memo (trade.resolver.ts 34-54, 613) and the client sources that from the Amboss supported-asset `precision`, relayed unbounded by magma.resolver.ts 805 (`a.precision ?? 0`) via TradingContext (TradeSheet.tsx 476/523, SidebarTrade.tsx 290/327). An asset advertised with precision 1 or 101 poisons the history once the operator starts one trade in it; the `selectedAsset?.precision` fallback at line 98 is hit directly for memos without `p`.

The maintainers know this computation can throw: the Transactions view (tradeMemo.ts 38-54) wraps the identical minimumFractionDigits 2 / maximumFractionDigits p call in try/catch and falls back to 'Trade'. TradingHistory has no such guard, and the server performs no range check on `p` or on `asset_precision` in the trade inputs (trade.resolver.ts validation at ~1340 covers only pubkey/asset id/group key).

Impact is availability of the Trading page for a litd/tapd-enabled operator (persistent until the invoice ages out), with no confidentiality or integrity effect. Conditions: the node must expose tapd (RequireTapd gates the route), and the operator must have performed an LNURL-withdraw from the hostile service or a trade in the hostile asset. Dependency assumption: the browser's Intl.NumberFormat implements ECMA-402's RangeError for maximumFractionDigits < minimumFractionDigits and for values outside 0..100 (both the pre-v3 DefaultNumberOption(mxfd, mnfd, 100) form and the ES2023 NumberFormat v3 explicit mnfd > mxfd check throw); current V8, SpiderMonkey and JavaScriptCore do.

## Evidence
1. [src/client/src/views/assets/TradingHistory.tsx:26–34](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/assets/TradingHistory.tsx#L26-L34)
   Sink: formatAssetAmount calls `toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: precision })` with a precision taken from the invoice. ECMA-402 throws RangeError when maximumFractionDigits is below minimumFractionDigits (precision === 1) or outside 0..100 (e.g. 101), and the call is not wrapped in try/catch.
2. [src/client/src/views/assets/TradingHistory.tsx:96–98](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/assets/TradingHistory.tsx#L96-L98)
   precision is `inv.asset_precision ?? selectedAsset?.precision ?? 0`; both candidates originate outside the operator's control (invoice memo written from remote data, or the Amboss asset precision chosen in TradingAssetSelector).
3. [src/client/src/views/assets/TradingHistory.tsx:127–129](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/assets/TradingHistory.tsx#L127-L129)
   The formatter runs inside the row render for every trade invoice, so one poisoned invoice throws on every render of the widget.
4. [src/server/modules/api/trade/trade.resolver.ts:1369–1405](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/trade/trade.resolver.ts#L1369-L1405)
   Source 1: trade_invoices scans the node's last 100 invoices, treats every description starting with `th:trade:` as trade metadata, and relays `Number(json.p)` as asset_precision with no range or integer check; the field is a GraphQL Float (schema.gql 1296) so 1, 1.5 and 101 all reach the client. Any invoice whose memo carries the prefix is trusted, regardless of who authored the memo.
5. [src/server/modules/api/lnurl/lnurl.resolver.ts:231–235](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L231-L235)
   A way for a remote party to author such a memo: lnUrlWithdraw creates an invoice on the node with the description the client sends.
6. [src/client/src/views/home/quickActions/lnurl/LnWithdraw.tsx:35–37](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/home/quickActions/lnurl/LnWithdraw.tsx#L35-L37)
   That description is pre-filled from the LNURL service's `defaultDescription` (remote JSON relayed verbatim by fetchLnUrl) and sent unchanged at lines 154-156 unless the operator edits it.
7. [src/server/modules/api/trade/trade.resolver.ts:34–53](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/trade/trade.resolver.ts#L34-L53)
   Source 2: ThunderHub's own trade flow writes `p: input.asset_precision` into the memo; the client supplies that from the Amboss supported-asset `precision` (TradeSheet.tsx 476/523, SidebarTrade.tsx 290/327 via TradingContext), which magma.resolver.ts 801-813 relays from the trade API as `a.precision ?? 0` without bounds.
8. [src/client/src/views/transactions/tradeMemo.ts:38–53](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/transactions/tradeMemo.ts#L38-L53)
   Contrast: the Transactions view performs the identical minimumFractionDigits 2 / maximumFractionDigits p computation but inside try/catch, falling back to 'Trade'; TradingHistory lacks that guard.
9. [src/client/src/components/ErrorBoundary.tsx:12–35](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/components/ErrorBoundary.tsx#L12-L35)
   Only the root boundary exists (App.tsx 354); the RangeError unmounts the whole SPA and 'Try again' re-renders the same cached invoices and fails again.

## Impact
The RangeError propagates to the root ErrorBoundary (the only one, App.tsx 354) each time the Trading route renders, replacing the SPA with 'Something went wrong'; 'Try again' re-renders the same route against the same cached invoices and fails again. The trigger persists in the node's invoice list, so the operator loses the Trading page until the invoice leaves the 100-invoice window; other routes work once the operator navigates by URL. Nothing is read or altered.

## Reproduction steps
1. Attacker is a remote LNURL-withdraw service the operator uses once (or the Amboss trade API for an asset the operator trades) — threat-model adversary 3, which names invoice memos and LNURL/Amboss responses rendered in the SPA. Delivery is a normal LNURL-withdraw JSON response whose defaultDescription carries a `th:trade:` memo with p=1; the operator pastes the LNURL and clicks Withdraw with the pre-filled description (UI:ACTIVE), and the node then holds the invoice whether or not the callback succeeds. From then on every render of the Trading page throws. Requires a litd/tapd deployment with the Trading route reachable (AT:PRESENT); no ThunderHub privileges (PR:N); no control to defeat — the server classifies trade memos by prefix alone and the client has no clamp or try/catch. Assumes the browser's Intl.NumberFormat throws RangeError per ECMA-402 for max < min fraction digits or > 100.

## Recommended fix
1. TradingHistory feeds an unvalidated precision into Intl number formatting with a fixed minimumFractionDigits, so out-of-range or sub-minimum values throw during render. Fix criteria: Clamp precision to an integer in the supported range (at least minimumFractionDigits, at most 100, or a smaller asset-specific bound) or catch the formatting error and fall back to the raw amount, as tradeMemo.ts already does; rendering an invoice with asset_precision 1, 101, or 1.5 must not throw.
2. trade_invoices trusts any invoice description with the `th:trade:` prefix and relays `p` after a bare Number() conversion, so remote-authored memos (LNURL-withdraw defaultDescription) and unbounded Amboss precisions reach the client as trusted numeric metadata. Fix criteria: The resolver should validate parsed memo fields (integer precision within an allowed range, numeric amt) and drop or sanitise invoices that fail; the trade mutations should bound asset_precision before writing it into the memo. A node holding an invoice with memo `th:trade:{"p":1}` must still produce a Trading History that renders.
3. A single root-level ErrorBoundary turns any widget render exception into a whole-SPA outage. Fix criteria: Trading widgets (and other remote-data views) should be wrapped in a local error boundary so a failing widget degrades to an inline error without unmounting the application; verify that a throwing TradingHistory leaves the rest of the Trading page usable.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper Input Validation
**CWE:** [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html)
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
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257426

---

# Empty Amboss trade-asset id crashes Trading page via Radix Select item invariant

## Details
ThunderHub's Trading page lists the assets supported by the Amboss Rails trade API in a Radix Select (`TradingAssetSelector`). The server resolver `get_tap_supported_assets` (src/server/modules/api/magma/magma.resolver.ts:801-813) copies each remote asset's `id` into the GraphQL result without validating it — only `symbol` and `precision` receive defaults — and the client renders `<SelectItem key={a.id} value={a.id}>` for every entry (src/client/src/views/assets/TradingAssetSelector.tsx:59-63). GraphQL's `String!` accepts the empty string, so a trade-API reply containing an asset with `id: ""` reaches the component unchanged; the label fallback `a.id.slice(0, 8)` tolerates it, so nothing upstream rejects it.

Assumption about the pinned dependency (`@radix-ui/react-select` 2.2.6 via `radix-ui` 1.4.3 in package-lock.json; node_modules is not present in the checkout): `Select.Item` throws `A <Select.Item /> must have a value prop that is not an empty string` in its render body when `value === ''`, and `Select.Content` renders its children into a DocumentFragment portal while the select is closed (so `Select.Value` can resolve the selected item's text). The exception therefore fires as soon as the Offers widget header mounts, without the operator opening the dropdown.

The only React error boundary is the root one (src/client/src/App.tsx:354), so the whole SPA — Apollo, SSE and router providers included — is replaced by 'Something went wrong'. `useGetTapSupportedAssetsQuery()` uses Apollo's default cache-first policy, so 'Try again' re-mounts at `/<slug>/trading`, reads the poisoned list from the cache and throws again; the operator must hand-edit the URL to recover, and every later visit to the Trading route repeats the crash until the upstream list changes.

Attacker: whoever controls the Amboss Rails trade API response for this node (adversary 3 in the threat model: malicious Amboss/trade API data rendered in the SPA; the URL is network-derived from `AMBOSS_TRADE_URLS` or an `urls.amboss.trade` override). No ThunderHub privileges are required. Beyond what the project already concedes to that party (returning an empty or failed list degrades the Trading page), this path crashes the entire SPA persistently at the Trading route. The component is reached only in deployments with a tapd-capable (litd) node that passes `RequireTapd` and `trade_readiness` (online, tapd, on-chain balance, active channel); where that holds, visiting `/<slug>/trading` is the only interaction needed.

## Evidence
1. [src/client/src/views/assets/TradingAssetSelector.tsx:59–62](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/assets/TradingAssetSelector.tsx#L59-L62)
   Sink: every asset relayed from the Amboss Rails trade API is rendered as `<SelectItem key={a.id} value={a.id}>` with no filter on `a.id`. Assumption about the pinned dependency (@radix-ui/react-select 2.2.6 via radix-ui 1.4.3, node_modules absent in the checkout): Select.Item's render body throws `A <Select.Item /> must have a value prop that is not an empty string` when `value === ''`, and SelectContent renders its children into a DocumentFragment portal while closed so the items render as soon as the page mounts. An asset with `id: ""` therefore aborts the render of the whole tree without the operator opening the dropdown.
2. [src/server/modules/api/magma/magma.resolver.ts:801–812](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/magma/magma.resolver.ts#L801-L812)
   Source: get_tap_supported_assets fetches `public.assets.supported.list` from resolveTradeUrl(user) (rails.amboss.tech / rails-dev.amboss.tech, or the urls.amboss.trade env override) and maps `id: a.id` verbatim. Only `symbol` and `precision` get defaults; `id` is never checked for emptiness, so `""` passes GraphQL's non-null String check (schema.gql TapSupportedAsset.id: String!) and reaches the client unchanged.
3. [src/client/src/views/assets/TradingGrid.tsx:45–50](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/assets/TradingGrid.tsx#L45-L50)
   Reachability: TradingAssetSelector is mounted unconditionally in the header of the Offers widget of the Trading grid, so the exception fires as soon as the Trading page renders with the poisoned list cached by Apollo.
4. [src/client/src/pages/TradingPage.tsx:28–79](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/pages/TradingPage.tsx#L28-L79)
   TradingPageContent (lines 28-79) renders TradingGrid once trade_readiness reports a tapd-capable node with an active channel and balance; the route is `/:nodeSlug/trading` under RequireTapd (App.tsx 282-289).
5. [src/client/src/components/ErrorBoundary.tsx:12–35](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/components/ErrorBoundary.tsx#L12-L35)
   The only error boundary wraps the whole App (App.tsx 354), so the render exception unmounts the entire SPA and shows 'Something went wrong'; 'Try again' re-renders against the same cached query and fails again.

## Impact
A render exception unmounts the whole SPA via the root ErrorBoundary and recurs on every visit to the Trading route (and on 'Try again', which re-reads the cached list) while the poisoned asset is present. No data is read or altered; other routes work once the operator manually changes the URL, so this is a page-scoped, operator-recoverable availability loss.

## Reproduction steps
1. The triggering input is authored by the Amboss Rails trade API (or an impersonator of it); the server fetches the list over HTTPS from a network-derived Amboss host or an env override, so control of that upstream response, plus a deployment with a tapd-capable node that passes trade_readiness, is the precondition (AT:PRESENT). Delivery is passive: the operator opens the Trading page, the SPA fetches the list and the render throws immediately; no ThunderHub credentials are involved and no shipped control (the root ErrorBoundary only converts the crash into a blank fallback) stands in the way. Depends on the stated assumption about @radix-ui/react-select 2.2.6's empty-value invariant and closed-state item rendering.

## Recommended fix
1. TradingAssetSelector passes a remote-controlled string straight into the Radix Select.Item `value` prop, whose non-empty invariant is enforced by throwing, so untrusted data can abort rendering. Fix criteria: Assets whose id is empty (or otherwise unusable as a Select value) must be filtered out or mapped to a safe sentinel before reaching SelectItem; rendering the selector with a supported-asset list containing `id: ''` must not throw and must still show the remaining assets.
2. The server relays the trade API's asset `id` without validating it, leaving every client consumer to defend itself. Fix criteria: get_tap_supported_assets should drop or reject entries whose id is not a non-empty string before returning them; a mocked trade-API reply with an empty id must yield a list that renders without error.

---
**Severity:** LOW
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
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257425

---

# Magma SALE order size committed from offer rate field the operator never sees

## Details
The live trade order form (`SidebarTrade`, mounted at /trading via TradingGrid → TradingOrderForm) lets the operator set up trade capacity against an Amboss Rails offer. For a SALE the server places a Magma order for an inbound BTC channel whose size is `assetAmount * 1e8 / assetRate` and pays the returned invoice.

The defect is which rate is committed versus which is shown. The Rails offer (fetched from https://rails.amboss.tech/graphql, network.ts:43) carries two independent strings, `rate.display_amount` (display units per BTC) and `rate.full_amount` (atomic units per BTC). `get_tap_offers` (magma.resolver.ts:686-698) forwards both unchanged with no derivation or consistency check. In the UI every figure the operator sees — the offers table (TradingOffers.tsx:255-257), the Rate row (SidebarTrade.tsx:415-428), the `~ N sats` estimate (186-202), the 'BTC channel of N sats will be purchased via Magma for ≈ F sats' recap and fee estimate (773-812) — derives from `displayAmount`; `fullAmount` is rendered only when `displayAmount` is empty. But `handleSetupPartner` (335-357) commits `assetRate: rateFull`, and the server (`computeMagmaOrderSize`, 60-74) sizes the Magma order from it with only a `> 0` check (128-134), never re-fetches the offer by `magmaOfferId`, and never returns the computed size for confirmation before creating the order and paying its invoice (327-368, 444). The button (926-944) fires the mutation with no confirm step.

Whoever authors the Rails offers response (threat-model adversary 3: a compromised or malicious Amboss Rails backend, or an interposer on the server→rails.amboss.tech path) can therefore quote an attractive `display_amount` while supplying a `full_amount` smaller than `display_amount × 10^precision`: the operator approves a channel/fee figure computed from one number and the node orders — and pays the Magma buyer fee for — a BTC channel inflated by the ratio between them. Only the SALE direction is affected: for PURCHASE the Magma size is `assetAmount` directly and the outbound BTC size is the displayed `satsAmount`.

The display-unit fallback when `fullAmount` is ''/'0' (line 344) is a cosmetic variant of the same defect (the same party fixes `fullAmount` directly) and `fullAmount` is a non-null `String!` so it cannot be absent; a decimal `full_amount` merely makes `BigInt()` throw a controlled GraphQL error. The sibling `TradeSheet.tsx` repeats the split but is imported nowhere.

Root cause: the value presented for consent and the value committed to a money-moving operation come from two different remote fields with no cross-check, and the server has no independent source of truth for the rate.

## Evidence
1. [src/client/src/layouts/sidebar/SidebarTrade.tsx:335–356](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/layouts/sidebar/SidebarTrade.tsx#L335-L356)
   Sink on the client: handleSetupPartner commits `assetRate: rateFull !== '0' ? rateFull : rateDisplay` (line 344) together with the atomic `assetAmount`. `rateFull` is `rate.fullAmount` from the Rails offer, a field the live UI never renders while `displayAmount` is present. (The display-unit fallback for an empty/'0' fullAmount adds no capability, since the same party authors fullAmount directly; see the rejected sibling at :344.)
2. [src/client/src/layouts/sidebar/SidebarTrade.tsx:177–202](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/layouts/sidebar/SidebarTrade.tsx#L177-L202)
   What the operator sees is derived from `rateDisplay = rate.displayAmount`: `satsAmount` (lines 186-202) is computed from the display rate and feeds every sats figure, recap and fee estimate in the form.
3. [src/client/src/layouts/sidebar/SidebarTrade.tsx:415–427](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/layouts/sidebar/SidebarTrade.tsx#L415-L427)
   The Rate row renders `displayAmount || fullAmount`: whenever Rails supplies a non-empty display_amount, full_amount is never shown anywhere in the order form.
4. [src/client/src/layouts/sidebar/SidebarTrade.tsx:773–811](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/layouts/sidebar/SidebarTrade.tsx#L773-L811)
   The Magma recap ('BTC channel of N sats will be purchased via Magma for ≈ F sats') and its fee estimate are computed from the display-derived `satsAmount`, not from the value the server will commit.
5. [src/client/src/layouts/sidebar/SidebarTrade.tsx:926–943](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/layouts/sidebar/SidebarTrade.tsx#L926-L943)
   The 'Setup Trade Channels' button calls handleSetupPartner directly; there is no confirmation step that shows the committed order size before the mutation fires.
6. [src/server/modules/api/magma/magma.resolver.ts:60–74](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/magma/magma.resolver.ts#L60-L74)
   Server sink: computeMagmaOrderSize for SALE is `BigInt(assetAmount) * 1e8 / BigInt(assetRate)`, treating the client-forwarded assetRate as atomic-units-per-BTC. A full_amount smaller than displayAmount × 10^precision inflates the result by the same factor.
7. [src/server/modules/api/magma/magma.resolver.ts:327–367](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/magma/magma.resolver.ts#L327-L367)
   The computed `magmaSize` is sent as `size` in createMagmaOrderMutation against `input.magmaOfferId`; the returned invoice is then paid in payMagma (line 444) and the size is only logged and echoed back afterwards, never shown for approval. The server never fetches the offer by magmaOfferId to confirm the rate.
8. [src/server/modules/api/magma/magma.resolver.ts:128–134](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/magma/magma.resolver.ts#L128-L134)
   The only validation of assetRate is `BigInt(input.assetRate) <= 0`; no unit, range or offer-consistency check.
9. [src/server/modules/api/magma/magma.resolver.ts:686–697](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/magma/magma.resolver.ts#L686-L697)
   Source: get_tap_offers forwards `rate.display_amount` and `rate.full_amount` from the Rails API as two independent strings. No derivation (fullAmount = displayAmount × 10^precision) or consistency check ties them together, so the UI value and the committed value are two separately remote-controlled strings.
10. [src/server/utils/network.ts:42–44](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/utils/network.ts#L42-L44)
   The party authoring the offer: the Rails trade API at https://rails.amboss.tech/graphql (or the TRADE_API_URL override), a remote service the threat model lists as adversarial data.
11. [src/client/src/views/assets/TradingOffers.tsx:255–257](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/assets/TradingOffers.tsx#L255-L257)
   The offers table the operator picks from also renders `displayAmount || fullAmount`, so the committed field is invisible across the whole live trading UI (App.tsx:286 → TradingPage → TradingGrid → TradingOrderForm → SidebarTrade).

## Impact
The operator's node places and pays for a Magma inbound-channel order of a size they did not see or approve; the attacker (as the Magma seller behind magmaOfferId) collects the buyer fee for the inflated size. The loss is the buyer-fee differential and unwanted capacity, bounded by Magma's acceptance of the size and the offer's fee schedule — the channel capital itself is the seller's. Integrity LOW: funds leave without consent but the extent is bounded by Magma pricing, not arbitrary (arbitrary-invoice loss belongs to the separately recorded blind-payment defect). No confidentiality or availability effect.

## Reproduction steps
1. Attacker authors the Rails offers response reaching the ThunderHub server (compromised or malicious Amboss Rails backend at the hard-coded https://rails.amboss.tech/graphql, or a TLS interposer on that path — a specific position, hence AT:PRESENT). No ThunderHub credentials are needed (PR:NONE). The operator must select the attacker's offer in the Trading view, choose SALE, read the display-derived estimate and click 'Setup Trade Channels' (UI:ACTIVE). No defence must be defeated: both fields pass through get_tap_offers verbatim and the server's only check is `> 0` (AC:LOW). Network delivery (AV:NETWORK).

## Recommended fix
1. The client commits `rate.fullAmount` as `assetRate` while every figure shown to the operator derives from `rate.displayAmount`; the two remote fields are never checked for consistency and the committed one is never displayed. Fix criteria: A single canonical rate drives both the displayed estimate and the committed order: the client derives the committed rate from the displayed one (fullAmount = displayAmount × 10^precision) and refuses to submit when the offer's fields disagree, or the server computes the order size from an offer it fetches itself by magmaOfferId. Verification: an offer whose display_amount and full_amount are inconsistent must not produce a setupTradeCapacity call, or must be rejected server-side.
2. The server sizes a money-moving Magma order from a client-forwarded rate string with only a `> 0` check and never surfaces the resulting size for operator confirmation before creating or paying the order. Fix criteria: setupTradeCapacity validates assetRate as an integer atomic-per-BTC value and the exact Magma order size and expected buyer fee are returned to and confirmed by the operator (or sent as an approved bound that the server enforces) before any order is created or paid. Verification: the size shown to the operator equals the `size` sent in createMagmaOrderMutation, and a request whose derived size exceeds the approved figure is rejected without any order or payment.

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
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257424

---

# Amboss-supplied Magma order status crashes the SPA via prototype-chain label lookup

## Details
ThunderHub relays Magma order records from the Amboss Magma API to the browser without constraining the `status` field (magma.resolver.ts mapOrder, `status: o.status`, schema type String). The SPA then uses that string as a key into plain object literals: `statusLabel()` in MagmaOrders.tsx (`STATUS_LABELS[status] ?? status`) and the status filter in MagmaPage.tsx (`STATUS_LABELS[s] ?? s`). Because these are ordinary objects, inherited properties resolve: a status of `__proto__` yields `Object.prototype`, which is not nullish, so the `?? status` fallback never fires and the object is rendered as a React child. React 18 throws 'Objects are not valid as a React child' during render. (`STATUS_COLORS[status]` has the same flaw but its result only lands in a className, which is harmless; other inherited names such as `constructor` or `toString` resolve to functions, which React silently drops rather than throwing.)

MagmaPage.tsx additionally feeds every distinct status into `<SelectItem value={s}>`. The radix-ui Select primitive (radix-ui ^1.4.3, used by components/ui/select.tsx) throws at render time when an item `value` is the empty string, so a status of `""` is a second, independent way to produce the same crash from the same remote field.

The only React error boundary is the one around the whole App (App.tsx:354), so the exception unmounts the entire SPA and shows 'Something went wrong'. Pressing 'Try again' re-renders against the same Apollo-cached orders and crashes again; navigating to /magma or /magma/sales (App.tsx:290-291) reproduces it on every visit until the offending order disappears or changes status upstream. The Magma page is the only consumer of `useMagmaOrders`, so other routes keep working once the operator reloads elsewhere.

Attacker: whoever controls the Magma API response for this node's account (adversary 3 in the threat model: a malicious or compromised Amboss/Magma backend). They need no ThunderHub credentials; the operator merely has to open the Magma orders page. Impact is limited to availability of the SPA's Magma view (and loss of the current page state), with no confidentiality or integrity effect. The fix is to treat `status` as an untrusted enum: look it up with an own-property check or a `Map`, fall back to the raw string, and skip/normalise empty values before they become Select item values; the server could also allowlist statuses before relaying them.

## Evidence
1. [src/client/src/views/channels/magmaOrders/MagmaOrders.tsx:105–107](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/channels/magmaOrders/MagmaOrders.tsx#L105-L107)
   statusLabel() resolves the remote-supplied order status with `STATUS_LABELS[status] ?? status`. STATUS_LABELS is a plain object literal, so a status of `__proto__` returns Object.prototype (an object, not nullish) instead of falling back to the raw string.
2. [src/client/src/views/channels/magmaOrders/MagmaOrders.tsx:181–186](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/channels/magmaOrders/MagmaOrders.tsx#L181-L186)
   The lookup result is rendered as a React child of the status <span>. Rendering a plain object (Object.prototype) makes React 18 throw 'Objects are not valid as a React child'; the throw propagates out of the OrderTable render for every order row with that status.
3. [src/client/src/pages/MagmaPage.tsx:92–96](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/pages/MagmaPage.tsx#L92-L96)
   Second sink in the same flow: the status filter maps every distinct remote status to `<SelectItem value={s}>{STATUS_LABELS[s] ?? s}</SelectItem>`. `__proto__` crashes here identically, and an empty-string status violates the radix-ui Select.Item non-empty `value` invariant (radix-ui ^1.4.3 throws during render).
4. [src/server/modules/api/magma/magma.resolver.ts:1288–1291](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/magma/magma.resolver.ts#L1288-L1291)
   Source: mapOrder (line 1288) copies `o.status` verbatim (line 1291) from the Magma GraphQL reply into the schema field typed as plain String (magma.types.ts MagmaOrder.status), so the server performs no allowlisting before relaying it to the browser; find_many only filters orders by the node's own pubkey, which Amboss knows from the signed-message login.
5. [src/client/src/components/ErrorBoundary.tsx:12–35](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/components/ErrorBoundary.tsx#L12-L35)
   The only error boundary is the one wrapping the entire App (App.tsx:354). The render exception therefore replaces the whole SPA with 'Something went wrong'; 'Try again' re-renders the same cached Apollo data and fails again, so the operator cannot use the /magma route (and loses the current page) until the remote status changes.

## Impact
A render exception unmounts the whole SPA via the root ErrorBoundary and recurs on every visit to the Magma route while the order is present, so the operator loses the Magma view and any in-progress page state. Other routes remain usable after reload and no data is read or altered, so the impact is a partial, page-scoped availability loss only.

## Reproduction steps
1. The attacker is the upstream Amboss Magma API (or whoever has compromised it or its TLS/DNS); ThunderHub fetches orders over HTTPS from a network-derived Amboss host, so the precondition is control of that remote service (AT:P). Delivery is passive: the server relays the crafted `status` and the exception fires as soon as the operator opens /magma or /magma/sales (UI:P). No ThunderHub privileges are needed and no shipped control is defeated. Gain over the sanctioned path: Amboss already decides which orders the Magma panel shows (an error reply yields an empty list with the rest of the UI usable), but this path unmounts the whole SPA through the sole root ErrorBoundary and recurs on 'Try again' because the Apollo client is a module-level singleton with cache-first policy (src/client/config/client.tsx:14,102), so the operator must hand-edit the URL to recover. Dependency assumptions: React 18.3.1 (lockfile) throws 'Objects are not valid as a React child' for a non-iterable plain object child; @radix-ui/react-select 2.2.6 (bundled by radix-ui 1.4.3 in the lockfile) throws when Select.Item receives an empty-string value and renders SelectContent children into a DocumentFragment portal even while closed.

## Recommended fix
1. MagmaOrders.tsx statusLabel/statusColor and MagmaPage.tsx resolve a remote-controlled string through plain object literals, so inherited prototype properties (notably `__proto__`) are returned and rendered instead of falling back to the raw string, violating the expectation that unknown statuses degrade gracefully to text. Fix criteria: Status label/color lookups must only consult own properties (e.g. hasOwn check or a Map) and must always yield a string; rendering an order whose status is `__proto__`, `constructor` or any other arbitrary string must display that string as text without throwing.
2. MagmaPage.tsx builds Radix SelectItem values directly from the set of remote statuses, so an empty-string status violates the Select.Item non-empty value invariant and throws during render. Fix criteria: Status values used as Select item values must be filtered or normalised so that empty or otherwise invalid strings never reach the Select primitive; an order with an empty status must render and filter without a render-time exception.
3. The server relays `o.status` from the Magma reply verbatim as an unconstrained String rather than validating it against the known order-status set, leaving every client consumer to defend itself. Fix criteria: Statuses relayed by find_many should be constrained (enum or allowlist with a sentinel for unknown values) so that arbitrary remote strings cannot reach the SPA; verify that a Magma reply containing an unexpected status still yields a renderable order list.

---
**Severity:** LOW
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
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257333

---

# SSRF in bakeSuperMacaroon: client-supplied rest_host is the origin of a server-side POST whose error body is reflected to the caller

## Details
`MacaroonResolver.bakeSuperMacaroon` (src/server/modules/api/macaroon/macaroon.resolver.ts:42-115) takes `input.rest_host` from the GraphQL client and uses it verbatim as the origin of a server-side request: `const url = `${rest_host}/v1/proxy/supermacaroon`` followed by `this.fetchService.fetchWithProxy(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Grpc-Metadata-macaroon': intermediateMacaroonHex }, body: JSON.stringify({ root_key_id_suffix: '0', read_only }) })`. The schema type (macaroon.types.ts:3-10) is a bare String and the resolver never compares the value with the account's configured socket; the SPA only pre-fills it (SuperMacaroon.tsx:17-20) and lets the user edit it.

The caller therefore controls scheme, host, port and path: `http://10.0.0.5:8080/v1/getinfo?` or `http://169.254.169.254/latest/meta-data/#` makes the fixed suffix a query string or fragment. fetchWithProxy (fetch.service.ts:28-33) is Node's global fetch with no URL policy; it follows redirects, and the `agent` option it passes is not honoured by undici, so the request originates from the ThunderHub server's own network position even when TOR_PROXY_SERVER is configured.

The response is partially readable. For every non-2xx status the resolver does `const text = await response.text()` and throws `new GraphQLError(`LITD returned ${response.status}: ${text}`)`; app.module.ts configures no formatError, and @apollo/server (^5.4.0) returns error messages to clients in production (only stack traces are suppressed), so the internal service's status code and full error body reach the attacker. For 2xx responses a JSON `macaroon` field is returned outright and a non-JSON body surfaces as a SyntaxError message. This yields internal host/port discovery (connection error vs. HTTP status) and content disclosure of error pages and small bodies, plus blind server-originated POSTs with an attacker-chosen path and a fixed JSON body against internal HTTP endpoints (e.g. a Docker API on TCP, monitoring or other tenants' LND/litd REST ports).

Gate: the only precondition (macaroon.resolver.ts:49-62) is that the caller's own node's `getAccessIds` contains the LiT root key id `18441921392371826688`, i.e. the account is a litd node — the feature's intended case, not a control over the destination. The project does apply a destination policy to user-supplied URLs elsewhere (`validateCallbackUrl`, lnurl.resolver.ts:19-48: https only, private ranges blocked); nothing equivalent, nor a binding to the configured node's host, guards rest_host.

Attacker position: an authenticated YAML account holder in a multi-account YAML deployment (per-account passwords or MASTER_PASSWORD_OVERRIDE, files.service.ts:306-310) whose account is a litd node; the threat model names the YAML account holder as an in-scope low-privilege principal. In DB mode the only user is the owner created by `createInitialUser` (user.service.ts:44-47, the sole insert into `users`), who is the operator, so that route gains nothing; in a single-account YAML deployment likewise. Gain over what the project concedes to a YAML account holder (control of their own node): server-side request forgery into ThunderHub's internal network with status and error-body read-back.

The freshly baked intermediate macaroon (permission `uri:/litrpc.Proxy/BakeSuperMacaroon` on the LiT root key of the caller's own node) is also sent to whatever host the caller names; since the caller already holds authority over that node this is not an escalation, only a footgun for a mistyped host.

Assumptions: @apollo/server ^5.4.0 returns GraphQLError messages to clients by default; Node 24.13.1 global fetch (undici) accepts http/https only, follows redirects by default, and ignores the `agent` option.

## Evidence
1. [src/server/modules/api/macaroon/macaroon.resolver.ts:81–101](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/macaroon/macaroon.resolver.ts#L81-L101)
   The request URL is `${rest_host}/v1/proxy/supermacaroon` with rest_host taken verbatim from the GraphQL input (line 47): no scheme/host allow-list and no comparison with the account's configured socket. A trailing `?` or `#` in rest_host turns the fixed suffix into query/fragment, so scheme, host, port and path are attacker-chosen. fetchWithProxy POSTs there and, for every non-2xx response, the full remote body is placed in the GraphQLError message (`LITD returned ${status}: ${text}`) returned to the client.
2. [src/server/modules/api/macaroon/macaroon.types.ts:3–9](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/macaroon/macaroon.types.ts#L3-L9)
   BakeSuperMacaroonInput.rest_host is a free-form String with only a doc description; no validation decorator, scheme, host or binding to the account's node constrains it.
3. [src/server/modules/fetch/fetch.service.ts:28–32](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/fetch/fetch.service.ts#L28-L32)
   fetchWithProxy is a thin wrapper over Node's global fetch (undici on node:24.13.1 per the Dockerfile): no URL validation, redirects followed by default, and the `agent` option is not an undici option, so even with TOR_PROXY_SERVER the request is issued directly from the ThunderHub server's network position.
4. [src/server/modules/api/macaroon/macaroon.resolver.ts:49–61](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/macaroon/macaroon.resolver.ts#L49-L61)
   The only check before the fetch is that the caller's own node lists the LiT super-macaroon root key id. It is evaluated against the caller's own account (getAccessIds(id) -> accountsService.getAccount(id)), so any YAML account holder whose node is litd passes it; it is a feature precondition, not a control over the destination.
5. [src/server/modules/api/lnurl/lnurl.resolver.ts:19–47](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/lnurl/lnurl.resolver.ts#L19-L47)
   validateCallbackUrl shows the project's own policy for user-supplied outbound URLs (https only, loopback/private/link-local hosts rejected) on a sibling path; nothing equivalent, nor a binding to the configured node host, is applied to rest_host.
6. [src/server/modules/user/user.service.ts:44–46](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/user/user.service.ts#L44-L46)
   createInitialUser is the only code path that inserts into users and it refuses once any user exists, so a DB-mode deployment has exactly one (owner) user — the operator. The attacker position for this finding is therefore a YAML account holder in a multi-account YAML deployment, not a DB user.
7. [src/client/src/views/tools/bakery/SuperMacaroon.tsx:17–19](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/client/src/views/tools/bakery/SuperMacaroon.tsx#L17-L19)
   The shipped client merely pre-fills rest_host from the node's gRPC socket and lets the user edit it; the server performs no check that the submitted value corresponds to that socket.

## Impact
Confidentiality: internal hosts/ports are enumerable (connection failure vs. HTTP status) and non-2xx response bodies of internal services are disclosed verbatim (LOW). Integrity: the server issues attacker-aimed POSTs with attacker-chosen path/query and a fixed JSON body, which can trigger side effects on unauthenticated internal HTTP endpoints (LOW). Availability: none. Subsequent-system impact: The forged request leaves ThunderHub's boundary and reaches services on the server's internal network that the account holder cannot otherwise reach (other accounts' LND/litd REST ports, Docker/monitoring HTTP APIs, cloud metadata endpoints); readable error bodies and blind POSTs give limited confidentiality and integrity impact on those systems.

## Reproduction steps
1. An authenticated YAML account holder whose own account is a litd node sends the `bakeSuperMacaroon` mutation with `input.rest_host` set to an internal origin such as `http://10.0.0.5:8080/path?`; the server POSTs there from its own network position and returns `LITD returned <status>: <body>` for non-2xx responses. No allow-list, scheme check, DNS/IP filter or binding to the configured socket stands in the way; the LiT-root-key gate is evaluated against the caller's own node. AT:P because the position differs from the operator only in a multi-account YAML deployment and the attacker's account must be litd (in DB mode the sole user is the owner created at setup, user.service.ts:44-47). PR:L: an ordinary authenticated account.

## Recommended fix
1. The resolver treats a client-supplied URL origin as trusted and issues a server-side request to it, violating the property that outbound server requests go only to operator-configured node endpoints. Fix criteria: The REST origin used for the super-macaroon call must be derived from the account's configured node (e.g. a REST host stored alongside the YAML/DB node record or derived from `account.socket`) rather than from the mutation input; if user input is retained it must be restricted to https, must resolve to the same host as the configured node, and must reject private/link-local/loopback destinations unless the configured node itself is there. Verify by confirming a mutation with `rest_host` pointing at an unrelated internal origin is rejected before any fetch.
2. The remote response body is reflected verbatim into the GraphQL error returned to the caller, turning a blind SSRF into a readable one. Fix criteria: Error responses from the litd call must be logged server-side only; the client-facing error must carry at most the status code and a generic message. Verify that a non-2xx response body from the target is no longer present in the GraphQL error payload.

---
**Severity:** LOW
**Status:** Open
**Category:** Server-side request forgery
**CWE:** [CWE-918](https://cwe.mitre.org/data/definitions/918.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257320

---

# Trade API response silently registers tapd federation servers and enables global proof sync-insert

## Details
When a logged-in operator opens the Trade/assets view, the SPA runs the `rails.get_tap_supported_assets` query. The resolver (magma.resolver.ts:757-814) fetches the supported-asset list from the Amboss Trade API (`rails.amboss.tech`, or `rails-dev.amboss.tech` on signet) and, without awaiting or surfacing the result, hands every `taproot_asset_details.universe` string in the response to `TapFederationService.syncForAccount` (tapd-federation.service.ts:14-65). That method calls `TapdNodeService.addFederationServer` (tapd-node.service.ts:336-363) for each host that is not already in the node's federation list.

`addFederationServer` does two things with that remote-supplied value: it registers `host` as a universe federation server in tapd (tapd will connect out to it over gRPC and periodically sync with it from then on, persisted in tapd's DB), and it then calls `SetFederationSyncConfig` setting the *global* defaults `allowSyncInsert: true` and `allowSyncExport: true` for both `PROOF_TYPE_ISSUANCE` and `PROOF_TYPE_TRANSFER`. The threat model lists Amboss/Magma/trade API responses as adversary 3 (malicious remote data). A compromised or impersonated Trade API therefore gets to: (a) make the operator's tapd daemon open outbound connections to an attacker-chosen host:port (disclosing the node's network location and giving the attacker a sync peer position), (b) have its own universe server's proofs — including unbounded transfer proofs, which upstream tapd does not insert by default (assumption about tapd defaults; not verifiable from this repository) — inserted into the node's universe database on every sync cycle, and (c) have the node export its transfer-proof history to federation peers. Injected universe content is then surfaced to the operator as legitimate assets in `get_universe_assets` and in the deposit UI's group-key picker (TapDepositStep.tsx `universeGroups`), enabling asset-name spoofing in the receive flow.

No validation of the host string, no allowlist, no operator confirmation, and no audit of what was joined exists: failures are logged at warn level and successes only at info. The exclusion filter `h !== ownHost` compares against the LND socket (e.g. `host:10009`), which never equals a universe address (`host:10029`), so it does not protect against self-insertion either.

The same `setFederationSyncConfig` side effect also fires when the operator adds a single server via the UI (`add_federation_server` mutation), silently loosening the global sync policy for all servers rather than the one being added.

The operator-facing entry point lives in the Magma unit; the vulnerable sink and policy change live in this unit.

## Evidence
1. [src/server/modules/api/tapd/tapd-federation.service.ts:14–64](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/tapd/tapd-federation.service.ts#L14-L64)
   syncForAccount() takes an arbitrary list of host strings, filters only those already registered (and the LND socket, which never matches a universe host:port), and calls addFederationServer for every remaining host with no format validation, allowlist or operator confirmation. Errors are swallowed into warn logs, so the operator never learns which servers were joined.
2. [src/server/modules/node/tapd/tapd-node.service.ts:336–363](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/node/tapd/tapd-node.service.ts#L336-L363)
   addFederationServer() issues tapd AddFederationServer for the untrusted host and then unconditionally calls SetFederationSyncConfig with allowSyncInsert=true and allowSyncExport=true for both PROOF_TYPE_ISSUANCE and PROOF_TYPE_TRANSFER as the global default, so every federation server (not only the one just added) may push issuance and transfer proofs into the node's universe DB on sync and pull the node's own transfer proofs.
3. [src/server/modules/api/magma/magma.resolver.ts:785–799](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/magma/magma.resolver.ts#L785-L799)
   get_tap_supported_assets reads taproot_asset_details.universe from the Amboss Trade (rails) API JSON response and passes the de-duplicated hosts straight to syncForAccount in a fire-and-forget promise; a read-only GraphQL query thereby persistently reconfigures the operator's tapd daemon based on remote data.
4. [src/server/modules/fetch/fetch.service.ts:34–66](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/fetch/fetch.service.ts#L34-L66)
   graphqlFetchWithProxy returns the remote response body as-is; no schema or host validation is applied to the universe field before it is acted on.

## Impact
Impact rests on tapd's handling of the two RPCs this code issues (via @lightningpolar/tapd-api ^0.7.0-alpha, patched in patches/; tapd itself is not in this checkout, so the following are explicit assumptions): AddFederationServer persists the host in tapd's DB and makes tapd dial it over gRPC on each federation sync without certificate pinning, and SetFederationSyncConfig with global allowSyncInsert/allowSyncExport=true for PROOF_TYPE_TRANSFER loosens tapd's default (transfer insert off) for every federation server. Confidentiality LOW: the node's tapd connects out to the attacker-chosen host:port, disclosing the node's network location, and transfer-proof export to federation peers is enabled. Integrity LOW: federation membership and the global sync policy are changed persistently without operator consent, and attacker-supplied universe proofs populate the node's universe DB, surfacing as 'universe' group entries in the deposit picker (TapDepositStep.tsx:73-91) and get_universe_assets. Availability LOW: recurring sync with, and unbounded proof insertion from, an attacker-controlled universe. No funds move directly and no macaroon is exposed.

## Reproduction steps
1. The triggering input is the `taproot_asset_details.universe` field of the Amboss Trade API response (rails.amboss.tech / rails-dev.amboss.tech, src/server/utils/network.ts:43-44); the attacker must control that response — a compromised upstream or DNS+CA-level impersonation, since Node's global fetch verifies TLS (AT:PRESENT). The TRADE_API_URL env override is the operator's own choice and is not counted. No ThunderHub credentials are needed (PR:N). The victim operator only has to be logged in with a tapd/litd-capable node and load any view that issues useGetTapSupportedAssetsQuery — AssetsList, TradingOffers, TradingPartners, TradingDistribution, PortfolioDistribution, TradingAssetSelector or the home TapWithdrawStep (UI:PASSIVE); the resolver fires syncForAccount as a fire-and-forget promise with no prompt. Reached over the network (AV:N); no defensive mechanism exists to defeat — syncForAccount filters only hosts already registered and the LND socket (AC:L).

## Recommended fix
1. syncForAccount/get_tap_supported_assets treat host strings from a third-party API response as authoritative configuration for the operator's tapd daemon, registering federation servers persistently and silently. Fix criteria: Universe hosts obtained from remote APIs are never registered automatically; they are presented to the operator for explicit confirmation (or matched against an operator-maintained allowlist) and validated as host[:port] before any AddFederationServer call. Verification: with a Trade API response containing an arbitrary universe host, loading the Trade view results in no change to tapd's ListFederationServers output.
2. addFederationServer unconditionally rewrites tapd's global federation sync config to allow insert and export of both issuance and transfer proofs for all servers as a side effect of adding one server. Fix criteria: Adding a federation server does not alter global sync policy; if looser sync settings are required they are applied per-server (SetFederationSyncConfig assetSyncConfigs / server-scoped) or exposed as a separate, explicit operator action. Verification: after add_federation_server, QueryFederationSyncConfig shows the global config unchanged from its prior value.

---
**Severity:** LOW
**Status:** Open
**Category:** External control of configuration
**CWE:** [CWE-15](https://cwe.mitre.org/data/definitions/15.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257315

---

# DB user acting through a node slug writes a 2FA secret into YAML account index 0

## Details
`updateTwofaSecret` and `removeTwofaSecret` (auth.resolver.ts 62-152) are YAML-account 2FA enrolment/removal flows: they load `accountsService.getAccount(id)`, check `account.twofaSecret` and `account.hash !== 'sso'`, verify a TOTP, and persist via `filesService.updateTwofaSecret(accountConfigPath, account.index, secret)` plus `accountsService.updateAccountSecret(id, secret)`. Neither checks that the account actually came from the YAML file.

When `DB_TYPE` is set, `AccountsService.onModuleInit` still loads YAML accounts unconditionally (accounts.service.ts 79-106), and `getDbNodeBySlug` caches DB nodes in the same map as EnrichedAccount objects with `index: 0`, `hash: node.id`, `twofaSecret: ''` (188-204). A DB user who sends `x-node-slug: <own node slug>` has `req.user.id` swapped to that node id by NodeSlugGuard (node-slug.guard.ts 36-44), so `getAccount(id)` returns the DB node. All preconditions pass, the attacker supplies any secret and a TOTP they compute from it, and the resolver executes `configCopy.accounts[0].twofaSecret = <attacker secret>` and rewrites the operator's YAML (files.service.ts 108-125) — i.e. it modifies the first YAML account, which belongs to a different tenant and is unrelated to the DB node. Because `updateAccountSecret` also sets `twofaSecret` on the in-memory DB entry, a follow-up `removeTwofaSecret` with a TOTP for the attacker's secret writes `''` into the same `accounts[0].twofaSecret` slot, silently deleting any 2FA secret the operator had configured for that account.

Effect: the on-disk YAML now carries an attacker-chosen (or blank) 2FA secret for account 0. The in-memory YAML account is unchanged, so the change takes effect at the next restart, when `getParsedAccount` reads `twofaSecret` back (files.service.ts 351) and `get_session_token` enforces it (public.resolver.ts 247-268, unless DISABLE_TWOFA=true): either the account-0 holder is locked out until the operator edits the file, or their 2FA is gone. `getTwofaSecret` also succeeds for DB nodes, so the SPA's Security page drives this path for any DB user without special tooling; the mutations can also be sent directly to `/graphql`.

Condition: holds only when both `DB_TYPE` and `ACCOUNT_CONFIG_PATH` are configured and the YAML has at least one account (docker-compose.yaml sets ACCOUNT_CONFIG_PATH by default; with no YAML path `filesService.updateTwofaSecret` throws and nothing is written; with an empty accounts list the assignment throws). Distinct from the x-node-slug ownership findings: the defect here is the 2FA resolvers' assumption that every entry in the shared account map is a YAML account with a meaningful file `index`.

## Evidence
1. [src/server/modules/api/auth/auth.resolver.ts:100–107](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/auth/auth.resolver.ts#L100-L107)
   updateTwofaSecret persists the caller-supplied secret to the YAML file at account.index after only checking twofaSecret is empty and hash !== 'sso'; it never checks that the account originated from the YAML file, so a DB node entry (index 0) maps to YAML account 0. updateAccountSecret(id, secret) then marks the in-memory DB entry as 2FA-enabled.
2. [src/server/modules/accounts/accounts.service.ts:188–204](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/accounts/accounts.service.ts#L188-L204)
   DB nodes are materialised as EnrichedAccount with index: 0, hash: node.id (not 'sso'), twofaSecret: '' and cached in the same map as YAML accounts, so they pass every precondition in the 2FA resolvers and map to YAML index 0.
3. [src/server/modules/files/files.service.ts:108–125](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/files/files.service.ts#L108-L125)
   updateTwofaSecret re-parses the operator's YAML, sets accounts[index].twofaSecret = secret and rewrites the whole file; index 0 is the first YAML account, whose twofaSecret is read back into memory at the next boot (getParsedAccount, line 351).
4. [src/server/modules/api/auth/auth.resolver.ts:142–149](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/api/auth/auth.resolver.ts#L142-L149)
   removeTwofaSecret, once the DB entry's in-memory twofaSecret is set by the attacker's own updateTwofaSecret call, verifies a TOTP against the attacker's secret and writes '' into the same YAML slot — clearing whatever 2FA secret the operator had configured for YAML account 0.
5. [src/server/modules/security/guards/node-slug.guard.ts:36–44](https://github.com/Halbarevi/thunderhub/blob/35fb38d3b578d353764dedc0e0646d6cfce6712c/src/server/modules/security/guards/node-slug.guard.ts#L36-L44)
   A DB user sending x-node-slug for their own node has req.user.id swapped to the DB node id, which is the id the 2FA resolvers then look up in the shared account map.

## Impact
Integrity: an attacker-chosen authentication parameter is written into another tenant's account configuration on disk, and the operator-configured 2FA secret for YAML account 0 can be overwritten or cleared; the modification is limited to that one field. Availability: after restart the YAML account 0 holder is locked out of ThunderHub (not of the node itself) until the operator edits the file. No confidentiality impact; node control is not obtained without the account password.

## Reproduction steps
1. Attacker is an authenticated DB user with at least one node of their own (any DB user can add one via team.add_node). They send updateTwofaSecret (and optionally removeTwofaSecret) with x-node-slug set to their own node, supplying a secret and a TOTP they compute for it; no cross-tenant lookup or guessing is needed. Requires a deployment that configures both the database and a YAML account file with at least one account — both documented features, loaded side by side by the code, but not a universal combination, hence AT: PRESENT.

## Recommended fix
1. updateTwofaSecret trusts account.index as a YAML array position for any account in the shared map, although DB-backed accounts are synthesised with index 0 and are not YAML entries. Fix criteria: 2FA enrolment/removal must only touch the YAML file for accounts that originated from that file (e.g. an explicit origin marker), and must verify the account at accounts[index] is the same account (by hash) before writing; verify a DB principal cannot alter any YAML entry.
2. DB nodes and YAML accounts share one in-memory map with the same shape, so YAML-only operations cannot distinguish them. Fix criteria: Account records carry their source (yaml/db/sso) and YAML-only resolvers reject non-YAML accounts explicitly.

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
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/thunderhub
**Branch:** main
**Commit:** 35fb38d3b578d353764dedc0e0646d6cfce6712c
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01UPB6kvd5ZgvksXmbZWs4Sd&finding=scan_01K9kYcfW7qGgbJPx1VXCZmp-5257312