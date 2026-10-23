# Third-party GitHub Actions referenced by mutable tags receive the registry token and Apple signing identity

## Details
The two non-GitHub third-party actions in the workflows are referenced by mutable git tags rather than full-length commit SHAs: `mr-smithers-excellent/docker-build-push@v6` (build-docker.yaml:25) and `Apple-Actions/import-codesign-certs@v3` (http.yml:141, wails.yml:141). GitHub resolves `uses: owner/repo@ref` at run time, and a tag is a ref the action repository's owner can move; GitHub's own hardening guidance states that a full-length commit SHA is the only immutable way to reference an action. The upstream maintainer, or anyone who compromises that maintainer's account or repository, can therefore change the code the hub's CI executes without any commit, review or change in this repository — the mechanism of the tj-actions/changed-files (CVE-2025-30066) and reviewdog incidents in March 2025.

What the hub hands those actions is significant. docker-build-push receives `secrets.GITHUB_TOKEN` directly as the registry password (build-docker.yaml:33) in a job with no `permissions:` block, runs on every push to any branch or tag, and publishes ghcr.io/getalby/hub:<ref>, adding `:latest` on v* tags. A hijacked `v6` thus obtains a token with packages:write (and, since the ghcr push works with the default token, the permissive default's contents:write as well) and can push a backdoored image as `ghcr.io/getalby/hub:latest` — the image docker-compose.yml:6, fly.toml:13, render.yaml:6 and the README (`docker run … --pull always ghcr.io/getalby/hub:latest`) deploy, with no digest pinning or signature verification on the consumer side. import-codesign-certs receives the Developer ID PKCS12 and its password as inputs on every push to master, every same-repo PR and every release run; a hijacked `v3` exfiltrates the identity used to sign and notarize the macOS server and desktop builds. Independently of the inputs, a malicious action running in the job can read the runner process memory for every secret the job holds, as the 2025 incidents demonstrated.

This stands out against the project's handling of every other dependency class: Go modules are hash-pinned by go.sum, npm packages by frontend/yarn.lock, and the Linux install scripts GPG-verify the tarballs they fetch. Only the CI actions — which run with the most sensitive credentials the project holds — are fetched by mutable reference, and .github/dependabot.yaml has no `github-actions` ecosystem, so nothing maintains or pins them. GitHub-owned actions (actions/checkout@v4, setup-go@v5, setup-node@v4, upload/download-artifact@v4) are referenced the same way; their exposure is lower because GitHub controls those repositories, but the same fix applies.

Assumptions: GitHub Actions ref resolution and tag mutability as documented by GitHub; the permissive-default inference for GITHUB_TOKEN rests on the ghcr push succeeding without an explicit `permissions:` grant. Organisation-level 'allowed actions' or 'require SHA pinning' policies are not visible in the repository; since these workflows run and publish, no such policy blocks these references.

## Evidence
1. [.github/workflows/build-docker.yaml:23–35](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/.github/workflows/build-docker.yaml#L23-L35)
   `uses: mr-smithers-excellent/docker-build-push@v6` (line 25) is a third-party action referenced by a mutable git tag and is handed `secrets.GITHUB_TOKEN` as the registry password (line 33). The job runs on every push to any branch or tag (lines 2-3) and publishes ghcr.io/getalby/hub:<ref>, adding :latest on v* tags (line 34). Whoever controls the upstream tag can replace the executed code without any change to this repository and obtain the token, hence push arbitrary images under :latest.
2. [.github/workflows/http.yml:131–146](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/.github/workflows/http.yml#L131-L146)
   `uses: Apple-Actions/import-codesign-certs@v3` (line 141, mutable tag) receives the Developer ID PKCS12 and its password as inputs (lines 144-146) on every push to master, every same-repo PR and every release run (gate at lines 132-140); a moved tag exfiltrates the project's code-signing identity.
3. [.github/workflows/wails.yml:131–146](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/.github/workflows/wails.yml#L131-L146)
   Same mutable-tag action with the same signing secrets in the desktop build, under the same gating.
4. [.github/workflows/build-docker.yaml:1–4](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/.github/workflows/build-docker.yaml#L1-L4)
   No workflow or job in .github/workflows declares `permissions:`, so GITHUB_TOKEN carries the repository default. Because the ghcr push with GITHUB_TOKEN succeeds (the published image is what docker-compose.yml, fly.toml, render.yaml and the README reference), the default must be the permissive one (packages:write is not in the restricted default), which also grants contents:write and pull-requests:write to any code running in the job.
5. [.github/dependabot.yaml:1–12](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/.github/dependabot.yaml#L1-L12)
   Dependabot is configured for gomod and npm only; there is no `github-actions` ecosystem, so action references are neither SHA-pinned nor automatically maintained, unlike go.sum and frontend/yarn.lock which content-pin every other dependency class.
6. [docker-compose.yml:6](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/docker-compose.yml#L6)
   Consumers pull `ghcr.io/getalby/hub:latest` by mutable tag with no digest or signature (also fly.toml:13, render.yaml:6, README.md:566 `--pull always`), so an image pushed with the stolen token is deployed to every such user's self-custodial wallet on next start.

## Impact
The vulnerable system is the hub's CI/release pipeline and its distribution channels. Confidentiality HIGH: the Developer ID PKCS12 and password are passed as inputs to the third-party action, and GITHUB_TOKEN with the permissive default scopes is passed as the registry password. Integrity HIGH: the token suffices to push arbitrary images as ghcr.io/getalby/hub:latest, and the signing identity suffices to sign and notarize arbitrary macOS binaries as 'Alby Inc.'; contents:write additionally allows tampering with the repository. Availability LOW: packages or releases can be deleted or overwritten, disrupting distribution until maintainers intervene. Subsequent-system impact: docker-compose.yml, fly.toml, render.yaml and the README deploy ghcr.io/getalby/hub:latest by mutable tag with `--pull always` and no digest or signature check, so a backdoored image pushed with the stolen token runs as root inside every such user's hub on next start, with full access to the LDK seed, unlock password material, channel funds and remote-node credentials — complete compromise of the self-custodial wallets of all Docker/Fly/Render users.

## Reproduction steps
1. The attacker is the upstream action maintainer or whoever compromises that account/repository — a position outside this system that the hub trusts only at adoption. Moving the tag is a remote git operation (AV:N) with no race or special configuration (AC:L); the precondition of controlling the upstream tag is an attack requirement (AT:P). No privileges on the hub repository are needed (PR:N). build-docker runs automatically on every push and http/wails on every push to master and same-repo PR, so no deliberate interaction with the payload is required (UI:N). Nothing in the workflows (no SHA pin, no permissions scoping, no allowed-actions policy visible) would detect or block the swapped code. Assumes GitHub's documented run-time ref resolution for `uses:` and that a JS action can read its inputs and the runner's memory, as demonstrated in CVE-2025-30066.

## Recommended fix
1. Third-party workflow components are referenced by mutable git tags, so the code the hub's CI executes with its secrets can change without any change to this repository. Fix criteria: Every `uses:` reference in .github/workflows resolves to a full-length commit SHA (with a version comment), and `.github/dependabot.yaml` includes the `github-actions` ecosystem so pins are kept current through reviewed pull requests. Verify that no workflow line contains an `@v<N>`-style or branch reference.
2. No workflow declares `permissions:`, so GITHUB_TOKEN carries the repository's permissive default scopes into jobs that hand it to third-party code. Fix criteria: Each workflow or job declares the minimum token scopes it needs (build-docker: contents:read, packages:write; build/test workflows: contents:read; create-release: contents:write only), so a compromised action cannot modify the repository; verify via the token permissions printed in each job's 'Set up job' log.
3. Secrets are exposed to third-party action code more broadly than the task requires, and consumers cannot detect a substituted image. Fix criteria: Signing secrets are present only in release runs (workflow_call from release.yaml), the registry login uses a token or step the project controls rather than a third-party action, and published images are signed/attested (e.g. cosign or GitHub artifact attestations) with the compose/fly/render templates and README documenting digest-pinned or signature-verified pulls; verify that a same-repo PR run holds no Apple secrets and that a tampered image fails consumer-side verification.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Supply Chain
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256468

---

# Cross-origin YouTube iframe inside desktop webview can reach the unauthenticated Wails IPC handler

## Details
In the desktop (Wails) build there is no authentication between a document in the webview and `WailsApp.WailsRequestRouter` (wails/wails_handlers.go:27): the project's own design is that any script in the webview is the operator (README:661). The SPA nonetheless admits a foreign origin into that webview: the CSP meta tag injected for the desktop build (frontend/vite.config.ts:97, via insertProdCSPPlugin and `yarn build:wails`) grants `frame-src https://www.youtube-nocookie.com`, and StoriesWidget.tsx:196-205 renders `https://www.youtube-nocookie.com/embed/<videoId>` as an un-sandboxed iframe whenever the operator opens a story (fetched unauthenticated from https://getalby.com/api/stories) that carries a videoId. Home.tsx:45 mounts the widget for every operator.

Dependency assumptions (Wails v2.16.0 per go.mod:21; source not in the checkout): on macOS Wails registers `[WKUserContentController addScriptMessageHandler:self name:@"external"]` and on Linux `webkit_user_content_manager_register_script_message_handler(manager, "external")`; WebKit exposes `window.webkit.messageHandlers.<name>` in every frame of the web view, including cross-origin subframes (WKScriptMessage.frameInfo exists so natives can filter, which Wails does not); the Wails dispatcher parses `C`-prefixed call messages and invokes the named bound method without any frame or origin check, delivering the result via ExecJS into the main frame only. On Windows, `window.chrome.webview.postMessage` from an iframe raises CoreWebView2Frame.WebMessageReceived, which Wails v2 does not subscribe to, so this path does not apply to the Windows build.

Consequence: script executing in the youtube-nocookie.com embed document (that origin acting maliciously, or an XSS in the embedded player — a position the attacker does not control, hence AT:PRESENT) can post `'C' + JSON.stringify({name:"wails.WailsApp.WailsRequestRouter", args:["/api/payments/<attacker invoice>","POST",""], callbackID:"x"})` and the hub pays; likewise `/api/wallet/redeem-onchain-funds` with `{toAddress, sendAll:true}`, `/api/channels` to an attacker node, `/api/stop`, or a forced channel close. The frame cannot read responses, but it does not need to: `POST /api/apps` with its own `pubkey` and pay/list scopes (api/api.go:77-83 requires the unlock password only for the superuser scope) registers an NWC connection the attacker already holds the key for, yielding a persistent bidirectional channel (payments, transaction history, balances) over Nostr. After a routine click on the player (transient activation) the frame can additionally navigate `top` to an attacker page that holds the full bridge.

The defect is the hub's: it hosts third-party web content inside the one document whose scripts are, by design, the operator, extending that identity to the embedded origin. The same CSP in HTTP mode (http_service.go:70) is harmless because there a frame has no privileged bridge to reach.

## Evidence
1. [frontend/vite.config.ts:96–97](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/vite.config.ts#L96-L97)
   buildCSP() grants `frame-src https://www.youtube-nocookie.com`; insertProdCSPPlugin (lines 118-129) injects it as a <meta> tag precisely so it governs the desktop app, and `yarn build:wails` (package.json) runs this same `vite build`. Without the grant, `default-src 'self'` would block every subframe in the webview; this line is the hole the fix must close in desktop mode.
2. [frontend/src/components/home/widgets/StoriesWidget.tsx:194–205](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/home/widgets/StoriesWidget.tsx#L194-L205)
   Renders <iframe src="https://www.youtube-nocookie.com/embed/{videoId}?autoplay=1&rel=0"> with no sandbox attribute when the clicked story carries a videoId. Home.tsx:45 mounts StoriesWidget unconditionally and the data comes from `GET /api/alby/stories` (wails_handlers.go:470 -> alby_oauth_service.go:1410, an unauthenticated fetch of https://getalby.com/api/stories), so every desktop operator sees this frame; the frame's document is a foreign origin sharing the webview with the IPC bridge.
3. [wails/wails\_app.go:74–76](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/wails/wails_app.go#L74-L76)
   Bind: []interface{}{app} exposes `wails.WailsApp.WailsRequestRouter` to the webview. Wails v2.16.0 (go.mod:21) registers one script-message handler (`external`) on the WKUserContentController / WebKitUserContentManager and options.App offers no main-frame restriction, so the binding is callable from any frame the webview hosts (dependency behaviour, stated as an assumption in the description).
4. [wails/wails\_handlers.go:27–49](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/wails/wails_handlers.go#L27-L49)
   WailsRequestRouter performs no authentication and no caller check. Fire-and-forget routes a frame that cannot read responses can still drive: POST /api/payments/<invoice> (367-409), POST /api/wallet/redeem-onchain-funds (614-635), POST /api/channels (527-541), POST /api/stop (513-519), and POST /api/apps (480-495), where CreateAppRequest.pubkey (api/models.go:154) lets the attacker register their own NWC keypair with pay/list scopes — api.CreateApp (api/api.go:77-83) asks for the unlock password only for the superuser scope — giving a persistent bidirectional channel over Nostr without reading a single IPC response.
5. [http/http\_service.go:66–71](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L66-L71)
   The identical policy is served as a header in HTTP mode, where the same iframe gains nothing (no bridge; the JWT lives in the hub origin's localStorage). The grant was written for the browser deployment and carried into the webview unchanged, where frame-src decides who may share the operator's IPC.

## Impact
Blind IPC from the frame pays arbitrary invoices, sweeps all on-chain funds and opens channels to attacker nodes (integrity HIGH), and can stop the node or force-close channels (availability HIGH). POST /api/apps with an attacker-held pubkey and pay/list scopes needs no unlock password and no readable response, giving a persistent NWC channel that exposes balances and full transaction history (confidentiality HIGH); top-frame navigation after a routine click adds the bidirectional bridge (logs, app connections, swap mnemonic).

## Reproduction steps
1. The attacker needs script execution inside the https://www.youtube-nocookie.com embed document — a hostile or compromised Google origin, or an XSS in the embedded player — a privileged position outside their control (AT:PRESENT). No hub privileges are needed (PR:NONE); the operator only opens a story carrying a video on the Home dashboard, which Home.tsx:45 shows to every desktop operator (UI:PASSIVE). The frame then posts to the Wails script-message handler, which Wails v2.16.0 exposes to all frames on WKWebView/WebKitGTK and dispatches without origin checks (dependency assumptions stated in the description). The content is delivered over the network (AV:NETWORK). Not reachable on the Windows build.

## Recommended fix
1. The desktop webview, whose scripts are the operator by design, hosts a cross-origin third-party document (YouTube embed) that shares the webview's unauthenticated IPC bridge, because the CSP built for the desktop app grants frame-src to that origin and the iframe is rendered there without isolation. Fix criteria: No cross-origin document is ever loaded as a subframe of the hub webview in desktop mode: the desktop build's CSP sets frame-src 'none' (or the desktop build omits the youtube-nocookie grant), and story videos in desktop mode are opened via BrowserOpenURL or shown as a thumbnail that links out. Verify that a desktop build renders no <iframe> for a story with a videoId and that an injected youtube-nocookie.com frame is blocked by the CSP.
2. The Wails IPC binding is reachable from any frame because the embedding relies on the dependency exposing the script-message handler only to the main frame, which it does not. Fix criteria: If any cross-origin frame must ever be hosted in the desktop webview, the IPC path rejects messages not originating from the main frame of the hub's own origin (e.g. a frame-aware bridge or a Wails version that checks WKScriptMessage.frameInfo), and a test or documented check confirms that a cross-origin subframe cannot invoke WailsRequestRouter.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper isolation
**CWE:** [CWE-653](https://cwe.mitre.org/data/definitions/653.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256539

---

# Desktop webview navigates to Alby-served story CTA URL, handing foreign page the unauthenticated Wails IPC

## Details
In desktop mode (Wails v2.16.0) the SPA runs inside a single webview whose only bridge to the hub is the bound Go method `WailsApp.WailsRequestRouter`, which performs no authentication: any script that can post to the Wails IPC channel can create NWC connections, pay invoices, sweep on-chain funds, read transaction history, export the swap mnemonic and stop the node (wails/wails_handlers.go). The security of the desktop app therefore rests entirely on the main frame of that webview only ever hosting the embedded SPA.

StoriesWidget breaks that invariant. It fetches marketing "stories" through `GET /api/alby/stories` → `albyOAuthService.GetStories`, an unauthenticated GET of `https://getalby.com/api/stories` whose JSON is decoded verbatim. Each story may carry `cta: {label, url, openInNewTab}`. When `openInNewTab` is false (StoriesWidget.tsx:237-242) the CTA is rendered as a plain react-router `<Link to={cta.url}>`. For an absolute URL whose origin differs from `window.location.origin` (in desktop mode `wails://wails` on macOS/Linux, `http://wails.localhost` on Windows) react-router 7 renders a bare `<a href>` and does not intercept the click, so clicking the CTA performs a top-level navigation of the Wails webview to the remotely chosen page. No scheme or host validation is applied to `cta.url` in the frontend or in Go.

Assumptions about the dependency (Wails v2.16.0, source not in the checkout): (1) Wails v2 installs no navigation policy that restricts top-level navigation of the main webview to the asset-server origin on WKWebView (macOS), WebKitGTK (Linux) or WebView2 (Windows); only `target=_blank`/`window.open` are redirected to the system browser. (2) The IPC primitive — the `external` WKScriptMessageHandler on macOS, the `external` WebKitUserContentManager script-message handler on Linux, `window.chrome.webview.postMessage` on Windows — is bound to the webview instance, not to a document origin, so it remains callable from whatever document is loaded into the main frame; Wails dispatches `C`-prefixed call messages to bound methods without checking the message source and returns results via `ExecJS("window.wails.Callback(...)")` into the current document. (3) react-router 7.x `<Link>` external-URL behaviour as described.

Attack: whoever controls the stories response (Alby's backend, a compromise of getalby.com, or an interposer on that TLS connection) serves a story with a `videoId` and `cta: {label: "Claim", url: "https://attacker.example/", openInNewTab: false}`. The operator opens the story and clicks the CTA. The attacker page defines `window.wails = {Callback: fn}` and posts `'C' + JSON.stringify({name: "wails.WailsApp.WailsRequestRouter", args: ["/api/apps", "POST", body], callbackID})` via the platform IPC primitive. The response contains `pairingSecret`, `walletPubkey` and relay URLs for a full-scope, unlimited-budget NWC connection keyed to the attacker's pubkey — persistent remote control of the wallet after the webview is closed — and the same channel yields `/api/transactions`, `/api/swaps/mnemonic`, `/api/payments/<invoice>`, `/api/wallet/redeem-onchain-funds`, `/api/stop`.

The threat model lists the Alby API among remote parties whose responses the hub must validate; here an unvalidated marketing payload is promoted to wallet control. The `openInNewTab: true` branch is the other half of the same defect: it reaches `BrowserOpenURL` with an unvalidated scheme, a second source for the verified finding wails-browseropenurl-lnurl-successaction-arbitrary-scheme. In HTTP mode the same `<Link>` is a plain redirect of the browser tab (phishing only); the privileged impact is specific to the desktop build.

## Evidence
1. [frontend/src/components/home/widgets/StoriesWidget.tsx:236–243](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/home/widgets/StoriesWidget.tsx#L236-L243)
   When the remote story's cta.openInNewTab is false the CTA is rendered with react-router's plain <Link to={activeStory.cta.url}>. For an absolute URL on a different origin react-router renders a bare <a href> with no client-side handler, so the click is a normal top-level navigation of the document — in the desktop app, of the Wails webview itself. This is the only CTA branch that does not go through ExternalLink/BrowserOpenURL.
2. [frontend/src/components/home/widgets/StoriesWidget.tsx:96–117](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/home/widgets/StoriesWidget.tsx#L96-L117)
   Stories (including cta.url and cta.openInNewTab) are fetched from /api/alby/stories and copied verbatim into component state; no scheme or host validation is applied to cta.url anywhere.
3. [alby/alby\_oauth\_service.go:1410–1453](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_oauth_service.go#L1410-L1453)
   GetStories performs an unauthenticated GET to https://getalby.com/api/stories and json-decodes the body straight into []Story. The content is therefore controlled by whoever controls that endpoint's responses (Alby, a compromise of getalby.com, or a TLS interposer) and is not validated server-side either.
4. [wails/wails\_handlers.go:27–49](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/wails/wails_handlers.go#L27-L49)
   WailsRequestRouter is the single bound Go method. It takes (route, method, body) and dispatches with no authentication, session token or caller check — whoever can reach the Wails IPC gets the operator's full authority (POST /api/apps at 480-495, POST /api/payments/<invoice> at 386-409, POST /api/wallet/redeem-onchain-funds at 614-635, GET /api/transactions at 319-385, GET /api/swaps/mnemonic at 1161-1163, POST /api/stop at 513-519).
5. [wails/wails\_app.go:58–90](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/wails/wails_app.go#L58-L90)
   The options.App passed to wails.Run binds the WailsApp and serves the embedded SPA; it configures nothing that confines the main frame to the asset-server origin (Wails v2 offers no such option), so a top-level navigation to an https origin loads that origin into the same privileged webview.
6. [frontend/platform\_specific/wails/src/utils/request.ts:3–22](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/platform_specific/wails/src/utils/request.ts#L3-L22)
   Shows the SPA itself calls WailsRequestRouter with no credential of any kind: the webview is the only trust boundary in desktop mode, so any document loaded into it is indistinguishable from the operator.
7. [frontend/src/components/ExternalLink.tsx:10–29](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/ExternalLink.tsx#L10-L29)
   The intended desktop path for remote links: ExternalLink routes to openLink → BrowserOpenURL (system browser) when not in HTTP mode. The Stories CTA bypasses this component whenever the remote payload sets openInNewTab=false.

## Impact
If the dependency assumptions hold, the foreign page obtains the full unauthenticated WailsRequestRouter (wails/wails_handlers.go:27): GET /api/swaps/mnemonic returns the swap mnemonic with no password check (1161-1163 → api.GetSwapMnemonic), GET /api/transactions reads history (confidentiality HIGH); POST /api/apps creates a full-scope, unlimited-budget NWC connection keyed to the attacker's pubkey (480-495) and POST /api/wallet/redeem-onchain-funds sweeps on-chain funds (614-635) (integrity HIGH); POST /api/stop halts the node (availability HIGH). Impact is rated conditionally on the Wails v2.16.0 behaviour stated in the exploitability reasoning, which could not be verified in the checkout.

## Reproduction steps
1. The attacker must control the JSON body returned by https://getalby.com/api/stories (Alby backend operator, a compromise of that endpoint, or a TLS interposer with a CA the OS trusts) — a position outside the attacker's control, so AT is PRESENT; the hub needs no account linking for this fetch and grants the attacker no privileges. The operator must perform two specific, conscious clicks in the trusted UI: open the story (the CTA renders only when videoId is set, StoriesWidget.tsx:220) and press its call-to-action button — UI:ACTIVE. No hub control is defeated: react-router 7.18.2 renders an absolute cross-origin `to` as a bare <a href> without a click handler, so the click is a top-level navigation of the Wails webview. Dependency assumptions (Wails v2.16.0, source not in the checkout): Wails v2 installs no main-frame navigation policy confining the webview to the asset-server origin (only new-window/_blank requests are diverted to the system browser), and the IPC message handler is bound to the webview instance rather than a document origin, so the foreign document can post a 'C' call message to wails.WailsApp.WailsRequestRouter and receive the result via window.wails.Callback. The project's own pattern of routing every other remote URL through BrowserOpenURL in desktop mode (ExternalLink.tsx:17-29) is consistent with this behaviour.

## Recommended fix
1. StoriesWidget renders a remotely supplied cta.url as an in-document navigation (plain <Link>) when the remote payload asks for it, and performs no scheme/host validation, letting a trusted-for-content dependency choose what document the privileged desktop webview displays. Fix criteria: Remote-supplied URLs are never used for same-webview navigation: every story CTA (regardless of openInNewTab) opens through the system-browser path (ExternalLink/BrowserOpenURL) after validating scheme is http(s) and host is on an allowlist. Verify that a story with openInNewTab=false and an external url can no longer change window.location of the desktop webview.
2. The desktop build has no defence in depth: nothing confines the Wails main frame to the embedded SPA origin, so any single in-document navigation to a foreign origin equals full hub compromise. Fix criteria: The hub webview must refuse to load any top-level document that is not served by its own asset server (deny the navigation and open it externally instead). Verify by attempting window.location.href = 'https://example.com' from the SPA in a desktop build: the webview stays on the SPA and the IPC bridge is never exposed to a foreign document.

---
**Severity:** HIGH
**Status:** Open
**Category:** Open redirect
**CWE:** [CWE-601](https://cwe.mitre.org/data/definitions/601.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256538

---

# Deep-linked /apps/new auto-focuses pre-filled name field so Enter grants a full-access connection

## Details
The documented NWC deep link `/apps/new?pubkey=<client pubkey>&name=<app>&return_to=<url>` (README.md:386-404, 'Client created secret'; the popup flow at 405-409 tells web clients to open it with window.open) is a web-attacker-reachable entry point. The consent design relies on the operator reviewing the requested permissions and clicking 'Connect'. For the non-catalogue form of the link, NewApp.tsx renders the Name `Input` with `autoFocus` and its value already filled from the `name` (or `c`) parameter (lines 408-420; the shared Input component spreads props to the DOM input and react-dom 19 calls focus() on mount). The input sits inside `<form id="new-app">` whose default submit button is the 'Connect' LoadingButton (`type="submit" form="new-app"`, 486-501), so a single Enter keystroke performs HTML implicit submission and runs handleCreateApp (385-396) with no further dialog (the password dialog exists only when `superuser` is set, which the non-catalogue path never does). Because the pre-filled value satisfies `required`, nothing blocks the submission; with `name` absent the empty required field would stop it, so the attacker-supplied name is what arms the form. No other element competes for focus (ExpirySelect's autoFocus is behind the expiry toggle, off by default).

What that keystroke creates is chosen by the link author: with no `request_methods`, initialScopes (107-194) is the wallet's full capability set (pay_invoice, get_balance, get_info, make_invoice, lookup_invoice, list_transactions, sign_message, notifications); the budget defaults to 100,000 sats/month (223-235) and can be set arbitrarily high with `max_amount`/`budget_renewal` or stripped entirely with `max_amount` below 1000 msat (floors to 0, sent as maxAmountSat 0, which the backend treats as no budget; the Budget switch merely shows OFF, which an operator who has not reviewed the form never sees); `expires_at` can be omitted for a non-expiring connection. The SPA POSTs to /api/apps with the operator's stored JWT (platform_specific/http/src/utils/request.ts:13-20; route http_service.go:178), and api.CreateApp (api.go:77-149) accepts any valid pubkey. The SPA then navigates to the attacker's `return_to` with relay, wallet pubkey and lud16 appended (311-316, api.go:153-171) — or posts them to window.opener (298-308) — so the attacker learns immediately that the connection is live and drives it with their own key over NIP-47.

Because `return_to` is set, the stepper has only the 'configure' step (237-255): the focused, pre-filled, submit-ready form is the first thing rendered. Delivery: (a) while the operator's browser holds a valid full JWT (default 30 days, http_service.go:471), the attacker page opens the link in a focused popup/tab from a user gesture (the README's own popup flow) and arranges for an Enter keystroke to land there — a 'press Enter to continue' prompt, a typing-test page, or a keydown-triggered popup.focus() mid-phrase; typed characters merely edit the Name field and the terminating Enter submits. (b) Lock replay: DefaultRedirect persists the link while the session is unauthenticated (12-24); after the operator unlocks by pressing Enter in the Login form (Unlock.tsx:30-58) HomeRedirect replays it (30-42) and the form renders with focus in the Name field, so a repeated or held Enter grants the connection; the planted link persists in localStorage until the next unlock.

This is distinct from deep-link-app-param-preselects-superuser-under-alby-go-identity (the `app=` catalogue path and the superuser default behind a password dialog) and from the payment-screen autofocus records (payment sink). Here the sink is app creation and the defect is that the SPA arms the consent form so an incidental keystroke is treated as consent; the hub ships X-Frame-Options DENY against click-based UI redress but nothing against the keystroke variant. The backend correctly executes what the SPA sends.

## Evidence
1. [frontend/src/screens/apps/NewApp.tsx:408–420](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L408-L420)
   For non-catalogue links the Name Input is rendered with autoFocus and value pre-filled from the URL name/c parameter; the shared Input spreads props so react-dom focuses the DOM input on mount, and the pre-filled value satisfies `required`, so Enter in it performs implicit submission of form id=new-app. This is the code the fix must change.
2. [frontend/src/screens/apps/NewApp.tsx:385–395](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L385-L395)
   The form's onSubmit calls handleCreateApp directly whenever superuser is false (always, for a non-catalogue deep link); there is no confirmation dialog on this path.
3. [frontend/src/screens/apps/NewApp.tsx:486–501](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L486-L501)
   The 'Connect' LoadingButton is type=submit with form=new-app, so the form has a default submit button and implicit submission on Enter is guaranteed by HTML form semantics.
4. [frontend/src/screens/apps/NewApp.tsx:90–94](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L90-L94)
   pubkey, return_to and name (or c) are read from the URL; the attacker's name becomes the pre-filled, focused field and the page title 'Connect to <name>'.
5. [frontend/src/screens/apps/NewApp.tsx:107–194](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L107-L194)
   With no request_methods parameter the initial scopes are derived from every method and notification type the wallet supports (Full Access).
6. [frontend/src/screens/apps/NewApp.tsx:223–235](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L223-L235)
   Default budget is DEFAULT_APP_BUDGET_SATS renewing monthly; the link author can raise it via max_amount/budget_renewal or strip it with max_amount<1000 msat (floors to 0, which the backend treats as no budget).
7. [frontend/src/screens/apps/NewApp.tsx:237–255](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L237-L255)
   With return_to set and no app=, the stepper has exactly one step ('configure'), so the submit-ready form is the first thing rendered.
8. [frontend/src/screens/apps/NewApp.tsx:257–316](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L257-L316)
   handleCreateApp POSTs name, the attacker's pubkey, scopes, budget (maxAmountSat || 0) and returnTo to /api/apps, then posts relay/walletPubkey/lud16 to window.opener and navigates to return_to, confirming success to the attacker.
9. [frontend/platform\_specific/http/src/utils/request.ts:13–20](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/platform_specific/http/src/utils/request.ts#L13-L20)
   The SPA's request helper attaches the operator's stored JWT as a Bearer header, so the UI-driven POST /api/apps is authenticated by the victim's session; the attacker never needs the token.
10. [frontend/src/components/redirects/DefaultRedirect.tsx:12–24](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/redirects/DefaultRedirect.tsx#L12-L24)
   A deep link hit while unauthenticated is persisted in localStorage.returnTo and the user is sent to the login screen (secondary delivery).
11. [frontend/src/components/redirects/HomeRedirect.tsx:30–41](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/redirects/HomeRedirect.tsx#L30-L41)
   After unlock the stored deep link is replayed, landing the operator on the focused, pre-filled form immediately after they pressed Enter to submit the unlock password.
12. [frontend/src/screens/Unlock.tsx:30–57](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/Unlock.tsx#L30-L57)
   The unlock form is submitted by Enter in the autofocused password field and then navigates to '/', triggering the replay.
13. [api/api.go:77–149](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L77-L149)
   CreateApp accepts any syntactically valid caller-supplied pubkey, creates the app with the requested scopes and budget, and builds the return_to redirect; nothing server-side requires more than the SPA's request.
14. [http/http\_service.go:178](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L178)
   POST /api/apps is reachable with the full JWT the SPA holds after unlock; the rate limiter does not affect a single request.
15. [README.md:386–409](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/README.md#L386-L409)
   The documented /apps/new contract publishes name, pubkey and return_to for arbitrary clients and sanctions the window.open popup flow, making the consent screen a web-attacker-reachable entry point.

## Impact
The attacker obtains a persistent NWC connection with every scope: pay_invoice spends from the main wallet within a budget the link author chose (100k sats/month by default, arbitrarily large via max_amount, or none via max_amount<1000), get_balance/list_transactions/lookup_invoice disclose the full balance and transaction history, sign_message signs with the node key, notifications stream payment activity. Confidentiality and integrity of the wallet are highly impacted; availability is not.

## Reproduction steps
1. A web attacker crafts /apps/new?pubkey=<their key>&name=<any>&return_to=<their URL> (optionally max_amount/budget_renewal) and opens it from their page in a focused popup or tab — the delivery the README itself sanctions. If the operator's browser holds a valid full JWT (default 30 days) the form renders focused and submit-ready as soon as capabilities load; the attacker then needs one Enter keystroke to land in that window (a 'press Enter' prompt, a typing-test page whose trailing Enter is captured, or a keydown-triggered popup.focus()). If the session is unauthenticated the link is stored and replayed directly after the operator submits the Login form with Enter. No credential or network position is required (AV:N, PR:N); no technical control has to be evaded (AC:L); the attack requires the victim's browser to be (or become) authenticated to the hub and the keystroke to be won (AT:P); the operator performs a conscious keystroke that is not conscious consent (UI:A). The redirect to return_to or the postMessage to the opener tells the attacker it succeeded.

## Recommended fix
1. NewApp.tsx auto-focuses a text input that is pre-filled from the URL inside the form whose submission grants the connection, so a deep link arrives in a state where one Enter is treated as operator consent. Fix criteria: When any connection parameter (pubkey, return_to, name, scopes, budget) comes from the URL, the consent form must not be submittable by a single keystroke: do not auto-focus a field in the form (or do not pre-fill the focused field), and require an explicit pointer/keyboard activation of the 'Connect' control itself, ideally after a short enablement delay. Verify by loading /apps/new?pubkey=X&name=Y&return_to=Z and pressing Enter immediately: no POST /api/apps is issued and no redirect occurs.
2. DefaultRedirect/HomeRedirect replay a stored /apps/new deep link directly after the unlock form is submitted with Enter, chaining the unlock keystroke into the auto-focused consent form. Fix criteria: A replayed deep link must not land on a submit-ready consent form with focus already inside it; after unlock either show an interstitial that requires a deliberate action, or land with no field focused. Verify: plant /apps/new?pubkey=... while locked, unlock with Enter and hold it; no app is created.

---
**Severity:** HIGH
**Status:** Open
**Category:** Insufficient UI protection
**CWE:** [CWE-357](https://cwe.mitre.org/data/definitions/357.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256536

---

# Phoenixd installer runs downloaded hub and phoenixd binaries without integrity verification

## Details
scripts/linux-x86_64/phoenixd/install.sh is the documented installer for the 'Alby Hub with phoenixd' deployment (scripts/linux-x86_64/phoenixd/README.md:33-35, linked from README.md:303). It downloads phoenix-0.1.5-linux-x64.zip from github.com/ACINQ/phoenixd releases and server-linux-x86_64.tar.bz2 from getalby.com (lines 25-34), unpacks both, writes start scripts and, if the user agrees, installs and starts both as systemd services running as the installing user (lines 88-128).

Neither download is verified. The project ships a verification control for exactly this artifact: scripts/verify.sh downloads a signed manifest.txt/manifest.txt.asc, GPG-verifies it against the release keys published in scripts/keys/*.asc and compares the tarball's SHA-256 with the manifest entry; the four sibling installers (linux-x86_64, linux-aarch64, pi-arm, pi-aarch64) and update.sh all call it and abort on failure. The phoenixd installer has no such call, no --skip-verify flag (there is nothing to skip) and no pinned digest for the phoenixd zip either, although ACINQ publishes per-release checksums. Transport TLS is therefore the only protection. Anyone who controls the response for https://getalby.com/install/hub/server-linux-x86_64.tar.bz2 or for the ACINQ release asset (distribution host or CDN compromise, mutable release assets, or an on-path attacker with a certificate the victim trusts) obtains arbitrary code execution as the installing user on every machine that follows this install path, persisted as a service. The host runs the phoenixd wallet (on-chain and Lightning funds) and the hub (seed material, app connection secrets, credentials), all of which the injected code can read.

This is CWE-494: download of code without an integrity check, on a path that bypasses the project's own shipped verification mechanism for the same artifact.

## Evidence
1. [scripts/linux-x86\_64/phoenixd/install.sh:25–34](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-x86_64/phoenixd/install.sh#L25-L34)
   phoenixd (ACINQ GitHub release zip) and the Alby Hub tarball (getalby.com) are fetched with wget and unpacked straight into the install directory. No verify.sh call, no signed manifest, no pinned checksum: transport TLS is the only protection, in contrast to the sibling installers that verify the identical tarball.
2. [scripts/linux-x86\_64/phoenixd/install.sh:88–128](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-x86_64/phoenixd/install.sh#L88-L128)
   The unverified binaries are installed as two systemd services (via sudo) running as the installing user and started immediately, so a tampered download executes persistently on every boot.
3. [scripts/verify.sh:1–64](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/verify.sh#L1-L64)
   The project's shipped control for this surface: GPG-verifies a signed manifest (keys in scripts/keys/*.asc) and checks the tarball's SHA-256 against it. The phoenixd installer never invokes it.
4. [scripts/linux-x86\_64/install.sh:105–118](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-x86_64/install.sh#L105-L118)
   The sibling installer for the same server-linux-x86_64.tar.bz2 runs verify.sh and aborts on failure (as do linux-aarch64, pi-arm and pi-aarch64), showing the project does not intend the tarball to be trusted on TLS alone.
5. [scripts/linux-x86\_64/phoenixd/README.md:33–35](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-x86_64/phoenixd/README.md#L33-L35)
   The documented, user-run install path (linked from the main README's Phoenixd section) instructs users to wget and execute this script.

## Impact
Arbitrary code runs as the installing user and is persisted as a systemd service: full read/write over the phoenixd wallet data (funds), the hub work dir (seed material, encrypted secrets and the processes holding the decrypted keys), and the user account; the attacker can replace or stop the services at will.

## Reproduction steps
1. Attacker position: control of the HTTPS response for getalby.com/install/hub or the ACINQ GitHub release asset (host/CDN compromise, swapped release asset, or on-path with a trusted certificate) — a privileged network/infrastructure position, AT:PRESENT; no target-side defence beyond TLS must be defeated once that position is held, AC:LOW. The victim runs the documented ./install.sh (UI:ACTIVE); wget fetches the tampered archive, it is unpacked and started as a systemd service with no checksum or signature check. No privileges on the victim host are needed (PR:NONE).

## Recommended fix
The phoenixd installer downloads and executes two binary artifacts with no integrity or authenticity check beyond transport TLS, bypassing the project's shipped verify.sh/signed-manifest mechanism used by every other installer. Fix criteria: Before extraction, the Alby Hub tarball must be verified through the project's signed manifest against the release keys (as the sibling installers do), and the phoenixd archive must be checked against a digest or signature pinned in the script or obtained independently of the download host. A failed or absent verification must abort the install instead of writing start scripts or services.

---
**Severity:** HIGH
**Status:** Open
**Category:** Download of Code Without Integrity Check
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256465

---

# Pi installers register user-writable library directory in system-wide ld.so.conf (root escalation)

## Details
scripts/pi-arm/install.sh and scripts/pi-aarch64/install.sh (served to users via curl|bash as pi-zero-install.sh / pi-aarch64-install.sh per their READMEs and README.md:500-504) install Alby Hub into /opt/albyhub, `chown -R $USER:$USER` the whole tree (lines 12-13), grant the binary CAP_NET_BIND_SERVICE with setcap so it can bind port 80 (line 47), and then write `/opt/albyhub/lib` into `/etc/ld.so.conf.d/albyhub.conf` and run `ldconfig` (pi-arm:49-50, pi-aarch64:50-51). The global entry exists because file capabilities make the kernel exec the binary with AT_SECURE set, and glibc's loader in secure mode ignores a `$ORIGIN`-based DT_RPATH that does not resolve into a trusted system directory — so the `$ORIGIN/../lib` RPATH patched in CI (.github/workflows/http.yml:158) no longer finds libldk_node.so.

The result is a directory owned and writable by an unprivileged account registered in the dynamic-linker configuration consulted by every process on the machine, including root daemons, sudo, cron and setuid programs (which ignore LD_LIBRARY_PATH but honour /etc/ld.so.cache). ldconfig processes the directories of /etc/ld.so.conf (which includes /etc/ld.so.conf.d/*.conf in glob-sorted order) before the built-in /lib and /usr/lib, and for a soname present in several directories the first-processed one is listed first in the cache and chosen by ld.so. On 32-bit Raspberry Pi OS 'albyhub.conf' sorts before 'arm-linux-gnueabihf.conf', so /opt/albyhub/lib is processed before /lib/arm-linux-gnueabihf and /usr/lib/arm-linux-gnueabihf: a libc.so.6, libcrypto, libpam or any other core soname dropped there is cached ahead of the genuine one at the next root-run ldconfig. On aarch64 the system conf sorts first, so only sonames absent from the system directories (and anything in /usr/local/lib) can be supplied, a narrower but still real hijack surface.

The hub itself runs as that same $USER on port 80 on all interfaces (unit at pi-aarch64:57-78). Anyone who gains code execution as the service account — through a hub bug reachable from the LAN or via NIP-47, or any other foothold as that user — can write a trojan shared object into /opt/albyhub/lib; it becomes effective when root next runs ldconfig, which happens routinely through dpkg's ldconfig trigger on any shared-library package upgrade (apt upgrade / unattended-upgrades) or when the operator re-runs install.sh. From then on root processes load the attacker's library: the hub's deliberately unprivileged service account becomes a latent root escalation on the Pi, giving access to the seed, database and everything else.

Conditions under which this holds: the installing user must be a sudoer for the script to run; where that account already has passwordless sudo (the stock Raspberry Pi OS first user) code execution as $USER is root anyway and this path adds nothing. On hosts where sudo requires a password (Ubuntu for Pi, Raspberry Pi OS hardened as the Raspberry Pi documentation recommends, or a dedicated service user), this is the path that turns a hub compromise into root without the password. glibc behaviour (secure-mode $ORIGIN handling, ld.so.conf.d glob ordering, first-directory-wins cache) is stated for glibc 2.36 as shipped on Raspberry Pi OS Bookworm; the repository pins no OS version. The sibling linux-x86_64/linux-aarch64 installers avoid the whole construction by using PORT=8029 without setcap or any ld.so.conf change.

## Evidence
1. [scripts/pi-arm/install.sh:49–50](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/pi-arm/install.sh#L49-L50)
   Writes /opt/albyhub/lib into /etc/ld.so.conf.d/albyhub.conf and runs ldconfig, permanently adding a directory owned by the unprivileged service user to the system-wide dynamic-loader search path. glibc includes /etc/ld.so.conf.d/*.conf in glob-sorted order and ldconfig records the first directory's copy of a soname first; on armhf Raspberry Pi OS 'albyhub.conf' sorts before 'arm-linux-gnueabihf.conf', so /opt/albyhub/lib precedes /lib and /usr/lib/arm-linux-gnueabihf and can shadow libc.so.6 and every other core library for root processes.
2. [scripts/pi-aarch64/install.sh:50–51](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/pi-aarch64/install.sh#L50-L51)
   Same registration for Pi 4/5. On aarch64 'aarch64-linux-gnu.conf' sorts before 'albyhub.conf', so system sonames are not shadowed, but /opt/albyhub/lib still precedes /usr/local/lib ('libc.conf') and supplies any soname a root process requests that is absent from the system directories.
3. [scripts/pi-arm/install.sh:12–13](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/pi-arm/install.sh#L12-L13)
   /opt/albyhub is created and recursively chowned to the installing user, so the lib/ directory extracted into it (and its contents) is writable by that user and by the hub process, which the unit below runs as the same account. Same lines in scripts/pi-aarch64/install.sh.
4. [scripts/pi-aarch64/install.sh:12–13](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/pi-aarch64/install.sh#L12-L13)
   Identical chown -R "$USER:$USER" /opt/albyhub for the aarch64 installer.
5. [scripts/pi-arm/install.sh:47](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/pi-arm/install.sh#L47)
   setcap CAP_NET_BIND_SERVICE=+eip on the binary makes the kernel set AT_SECURE on exec, and glibc in secure mode refuses $ORIGIN expansion in DT_RPATH unless the result lies in a trusted system directory. This defeats the '$ORIGIN/../lib' RPATH patched in .github/workflows/http.yml:158 and is the reason the script falls back to a global ld.so.conf entry (same line 47 in pi-aarch64/install.sh).
6. [scripts/pi-aarch64/install.sh:57–78](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/pi-aarch64/install.sh#L57-L78)
   The systemd unit runs the hub as User=$USER with PORT=80 on all interfaces (equivalent unit at pi-arm/install.sh:56-77). A compromise of this network-facing process therefore yields write access to a directory in the global library search path. By contrast scripts/linux-x86_64/install.sh and linux-aarch64/install.sh use PORT=8029 with no setcap and no ld.so.conf entry.

## Impact
A library hijacked for root processes gives full root on the Pi that hosts the hub: the LDK seed and work dir, the database, all credentials and the ability to alter or stop the service — total loss of confidentiality, integrity and availability of the hub installation.

## Reproduction steps
1. Attacker already executes code as the hub's service user $USER on the Pi (AV:LOCAL, PR:LOW) — e.g. via a hub bug reachable on LAN-exposed port 80 or a NIP-47-triggered bug, since the hub runs as that user. They write a shared object into the $USER-owned /opt/albyhub/lib and wait for a root-run ldconfig (dpkg ldconfig trigger on apt upgrades, re-running install.sh); that runtime event and a host where $USER lacks passwordless sudo are conditions outside the attacker's control (AT:PRESENT). No protections to defeat once ldconfig runs; no user interaction.

## Recommended fix
1. The Pi installers register a directory owned and writable by the unprivileged service user (/opt/albyhub/lib, chowned to $USER) in the system-wide dynamic-linker configuration, so that user can supply shared objects to every process on the host after the next ldconfig. Fix criteria: No directory writable by the service user (or any non-root account) may appear in /etc/ld.so.conf or /etc/ld.so.conf.d after installation. Either keep the shipped libraries in a root-owned, non-writable location or do not register any global entry at all. Verify post-install that every path under /etc/ld.so.conf.d is root-owned and not writable by $USER, and that a file created by $USER in /opt/albyhub/lib is not picked up by `ldconfig -p`.
2. File capabilities (setcap CAP_NET_BIND_SERVICE) force the loader into secure mode, which disables the $ORIGIN/../lib RPATH the release build relies on; the global ld.so.conf entry is a workaround for that side effect. Fix criteria: Binding port 80 must not require file capabilities on the binary: grant the capability through the service manager (ambient capabilities), use a non-privileged port as the other installers do, or front the hub with a reverse proxy, so the relocatable RPATH resolves libldk_node.so without any system-wide loader configuration. Verify the hub starts and serves on its port with no /etc/ld.so.conf.d entry present and update.sh continues to work after re-extraction.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncontrolled Search Path Element
**CWE:** [CWE-427](https://cwe.mitre.org/data/definitions/427.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256464

---

# Install scripts fetch the release verifier from the artifact host and never pin a signing key, so getalby.com control defeats GPG verification

## Details
The documented install flow (scripts/linux-x86_64/README.md:21, linux-aarch64/README.md:21: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/getAlby/hub/master/scripts/<arch>/install.sh)"`; pi-aarch64/README.md:14 and pi-arm/README.md:12 fetch the installer from getalby.com) implements GPG release verification, but the verification is structured so that the one adversary it exists to defeat — whoever controls what https://getalby.com/install/hub/ serves (host/CDN compromise, DNS takeover with a mis-issued certificate, or TLS interception) — bypasses it:

1. Same-origin verifier (primary). install.sh:3-4 and :100-115 download the tarball AND verify.sh from getalby.com/install/hub/ and execute `./verify.sh`; verify.sh:3-4 and :32-41 download manifest.txt and manifest.txt.asc from the same origin. An attacker serving a malicious tarball also serves a verify.sh that prints the success banner and returns 0 (or a manifest matching the malicious hash plus any signature, see 2). The installer then extracts and runs the binary (install.sh:121-137) and, in the systemd branch, enables it as a Restart=always service (install.sh:179-201). For the Pi variants the installer itself is also served from getalby.com, so the whole chain has a single trust anchor. The shipped release keys (scripts/keys/*.asc, whose README says they sign the manifest used by "the systemd install/update scripts") are referenced by no script.

2. Unpinned signer. verify.sh:43 runs a bare `gpg --batch --verify manifest.txt.asc manifest.txt` against the user's default keyring: a good signature from ANY key the user has ever imported passes, no fingerprint is checked, and (GnuPG documented behaviour) EXPKEYSIG/REVKEYSIG results still exit 0 with only a warning, so a release key revoked after compromise keeps validating. This is the only check that remains for update.sh, which reuses the locally stored verify.sh (linux-x86_64/update.sh:124, pi-aarch64/update.sh:21) but fetches manifest and signature from getalby.com.

3. No freshness binding. The manifest lines are `<sha256> albyhub-Server-Linux-<arch>.tar.bz2` with no version (verify.sh:49-60) and the download URLs are unversioned, so a genuinely signed older manifest served with its older tarball passes — rollback to a release with known defects is undetectable at update time.

4. Opt-out prompt. verify.sh:12-19 returns 0 when the user answers N, so install/update proceed on an unverified archive; in non-interactive runs (install.sh -y with stdin at EOF) the prompt loops forever, which pushes automation to --skip-verify (install.sh:39-41).

5. update.sh is fetched from raw.githubusercontent.com/getAlby/hub/master at install time with no integrity check (install.sh:143, pi-*/install.sh:19) and executed later with sudo prompts. For the linux variants this is the same trust anchor the README already uses for install.sh itself, so it widens nothing there; for the Pi variants, whose installer comes from getalby.com, it is a second unverified anchor. In both cases the release-signing scheme does not cover it.

Result: control of getalby.com responses yields arbitrary code execution as the installing user on every fresh install that follows the documented flow — persisted as a systemd service — while the user is told "✅ Verification successful. The package is authentic and intact." A correctly anchored scheme (verifier and pinned keys delivered with the installer from a different origin) would have required the attacker to also hold a release signing key.

## Evidence
1. [scripts/linux-x86\_64/install.sh:98–118](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-x86_64/install.sh#L98-L118)
   Tarball (ALBYHUB_URL, line 3) and verifier (VERIFIER_URL, line 4) are both fetched from https://getalby.com/install/hub/ and verify.sh is executed; whoever controls that origin controls both the artifact and the code that decides whether it is authentic, so a no-op verify.sh (or a manifest matching the malicious hash) defeats the check. scripts/keys/*.asc are never imported or referenced.
2. [scripts/verify.sh:31–46](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/verify.sh#L31-L46)
   manifest.txt and manifest.txt.asc are fetched from the same getalby.com origin and checked with a bare `gpg --batch --verify` against the user's default keyring: any key in the keyring passes, no fingerprint is pinned, and GnuPG exits 0 for EXPKEYSIG/REVKEYSIG. This is the only check left for update.sh, which reuses the local verify.sh.
3. [scripts/linux-x86\_64/install.sh:121–137](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-x86_64/install.sh#L121-L137)
   After verify.sh returns 0 the archive is extracted and start.sh launches bin/albyhub; lines 179-201 then enable it as a Restart=always systemd service, so the attacker-supplied binary runs persistently as the installing user.
4. [scripts/verify.sh:49–59](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/verify.sh#L49-L59)
   The manifest carries no version or freshness binding and the download URLs are unversioned, so a genuinely signed older manifest served with its tarball passes — rollback is undetectable. (The unanchored grep is fail-closed and not itself exploitable.)
5. [scripts/verify.sh:11–21](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/verify.sh#L11-L21)
   Answering N returns 0 ('Verification skipped') and the caller extracts and runs the unverified archive; with stdin at EOF the loop never terminates, steering non-interactive users to --skip-verify.
6. [scripts/pi-aarch64/install.sh:15–33](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/pi-aarch64/install.sh#L15-L33)
   Pi installer fetches tarball and verify.sh from getalby.com and update.sh from GitHub master; per scripts/pi-aarch64/README.md:14 the installer itself is served from getalby.com, so every component of the install chain comes from the one host (lines 47-81 then setcap and enable it as a service).
7. [scripts/pi-arm/install.sh:15–33](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/pi-arm/install.sh#L15-L33)
   Same chain for armv6 (installer served from getalby.com per scripts/pi-arm/README.md:12).
8. [scripts/linux-aarch64/install.sh:98–118](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-aarch64/install.sh#L98-L118)
   Identical to the x86_64 installer apart from artifact names (diff confirms): same same-origin verifier fetch and execution.
9. [scripts/linux-x86\_64/update.sh:120–130](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-x86_64/update.sh#L120-L130)
   Updates reuse the locally stored verify.sh (so a later getalby.com compromise cannot swap the verifier) but remain exposed to the unpinned-key and rollback weaknesses; with rsync absent, bin/ and lib/ were already moved to albyhub-backup (lines 114-115) before verification, so a rejected download leaves the Restart=always service without a binary.
10. [scripts/linux-x86\_64/install.sh:141–144](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-x86_64/install.sh#L141-L144)
   update.sh is fetched from raw.githubusercontent.com/getAlby/hub/master at install time with no integrity check and executed later with sudo prompts. For this variant the README fetches install.sh from the same master branch, so it adds no new anchor; the release-signing scheme nevertheless does not cover it, and for the Pi variants (installer from getalby.com) it is a second unverified origin.

## Impact
Arbitrary code runs as the installing user and, in the systemd branch, as a persistent Restart=always service: full control of the hub binary, its work dir (LDK seed, channel state, encrypted secrets, DB) and the user account — complete loss of confidentiality, integrity and availability of the wallet.

## Reproduction steps
1. The attacker must be able to substitute the HTTPS responses of getalby.com/install/hub/ — host or CDN compromise, DNS takeover with a mis-issued certificate, or a TLS-interception position — which is a positional precondition outside the attacker's direct control (AT:PRESENT); given that position the exploit is trivial (serve a tarball plus a no-op verify.sh), so AC:LOW. The victim must run the documented curl|bash installer (UI:ACTIVE). No privileges on the victim host are needed; the script runs as the user and prompts for sudo only for the service unit.

## Recommended fix
1. The verifier script is fetched from the same origin as the artifact it verifies, so the signature check can be replaced by the same adversary that replaces the artifact. Fix criteria: Verification logic must be delivered through a channel independent of the artifact host — embedded in the installer (which the README serves from GitHub) or shipped in the repository and checked against a published digest. A getalby.com response that swaps the tarball must be rejected even when the attacker also controls the verify.sh URL.
2. gpg --verify is invoked without a pinned signer against the user's default keyring, so any key present — including expired or revoked ones — authenticates a release, and the shipped scripts/keys/*.asc are never used. Fix criteria: Verification must require a signature by one of the project's published release keys: import the shipped keys into an isolated keyring, check gpg --status-fd output for VALIDSIG with an expected fingerprint, and reject EXPKEYSIG/REVKEYSIG. A manifest signed by any other key in the user's default keyring must fail.
3. The signed manifest carries no version or freshness information and the download URLs are unversioned, allowing replay of an older signed release. Fix criteria: The manifest (or installer) must bind the expected release version or date so that an older genuinely signed manifest is rejected for a newer install or update.
4. The verifier lets the user skip verification by answering N and loops forever without a tty, and update.sh is downloaded from a mutable branch over TLS only and executed later without any integrity check. Fix criteria: Skipping verification must be an explicit flag, never an interactive default that returns success; non-interactive runs must fail closed. Scripts executed later with elevated prompts must be covered by the release signature or pinned to a commit/hash and verified before execution.

---
**Severity:** HIGH
**Status:** Open
**Category:** Download of Code Without Integrity Check
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256461

---

# Phoenixd 90s HTTP timeout marks in-flight payment FAILED, refunding app balance and budget

## Details
The Phoenixd backend's SendPaymentSync (lnclient/phoenixd/phoenixd.go:346-383) POSTs to phoenixd's synchronous /payinvoice endpoint with a plain `http.Client{Timeout: 90 * time.Second}` and returns whatever error client.Do yields (lines 359-363). A client-side timeout is not a terminal payment outcome: by the time the hub aborts the HTTP request, phoenixd has already committed the outgoing HTLC, which the sender cannot revoke; it settles whenever the payee releases the preimage. The hub nonetheless surfaces the timeout as an ordinary error.

The transactions service treats every SendPaymentSync error as a definitive failure (transactions_service.go:446-460) and calls markPaymentFailed (1718-1777), which sets State=FAILED and FeeReserveMsat=0. GetIsolatedBalanceMsat (db/queries/get_isolated_balance.go:24-32) and GetBudgetUsageMsat (db/queries/get_budget_usage.go:15-19) only count SETTLED and PENDING outgoing rows, so the paying app's isolated balance and budget are immediately restored while the funds are still committed at phoenixd.

Nothing ever reconciles the row. The maintainers' contract (lnclient/lnd/lnd.go:457-460, TestConsumeEvent_FailedMarkedAsSuccessful) is that an error means the payment definitively failed, or else the backend later emits nwc_lnclient_payment_sent so ConsumeEvent (889-970) can flip the FAILED row to SETTLED. The Phoenixd client publishes no events at all (GetSupportedNIP47NotificationTypes returns an empty slice, phoenixd.go:496-498; no Publish call in the file), and the only polling reconciliation, checkUnsettledTransactions / LookupTransaction (762-800, 654-656), re-checks PENDING rows only, even though lookupOutgoingPayment (/payments/outgoingbyhash) would reveal the settled payment. A FAILED-but-actually-paid payment is therefore permanently unrecorded; the duplicate-payment guard at line 391 also only blocks PENDING rows, so the same app may immediately spend again.

This is a hub-side defect: a non-terminal transport condition is mapped to a terminal ledger state with no recovery path on an event-less backend. Dependency assumption (phoenixd, deployed unpinned as ghcr.io/sethforprivacy/phoenixd:latest in scripts/linux-x86_64/phoenixd/docker-compose.yml and render.yaml): /payinvoice blocks until the payment resolves and an HTLC already sent is not cancelled when the HTTP client disconnects — the latter is a Lightning protocol property independent of phoenixd's implementation. The same window also exists for any legitimately slow payment, silently corrupting the operator's ledger.

## Evidence
1. [lnclient/phoenixd/phoenixd.go:359–363](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/phoenixd/phoenixd.go#L359-L363)
   SendPaymentSync issues the synchronous /payinvoice POST with a fixed 90-second http.Client timeout and returns the raw client.Do error. A timeout here is not a terminal payment outcome: the outgoing HTLC is already committed at phoenixd and will settle if the payee later releases the preimage, yet the caller receives an ordinary error.
2. [transactions/transactions\_service.go:446–460](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L446-L460)
   Every error from lnClient.SendPaymentSync is treated as a definitive failure: markPaymentFailed is called on the pending outgoing row and the error is returned to the NIP-47 app.
3. [transactions/transactions\_service.go:1718–1777](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1718-L1777)
   markPaymentFailed sets State=FAILED and FeeReserveMsat=0 for a PENDING row; the funds then no longer count against the app.
4. [db/queries/get\_isolated\_balance.go:24–32](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/queries/get_isolated_balance.go#L24-L32)
   Isolated sub-wallet balance subtracts only SETTLED and PENDING outgoing rows; a FAILED row returns the full amount plus fee reserve to the app's spendable balance.
5. [db/queries/get\_budget\_usage.go:15–18](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/queries/get_budget_usage.go#L15-L18)
   Budget usage counts only SETTLED and PENDING outgoing rows; a FAILED row does not consume budget, so validateCanPay (1166-1223) lets the app spend the amount again.
6. [transactions/transactions\_service.go:762–799](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L762-L799)
   checkUnsettledTransactions, the only polling reconciliation for backends without notification events, queries LookupInvoice solely for PENDING rows created in the last 24h. A FAILED row that later settles at phoenixd is never re-checked, though lookupOutgoingPayment would reveal it.
7. [transactions/transactions\_service.go:654–656](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L654-L656)
   LookupTransaction (NIP-47 lookup_invoice) likewise only re-checks the backend when the row is PENDING, so an app or operator looking up the FAILED payment never triggers reconciliation.
8. [lnclient/phoenixd/phoenixd.go:496–498](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/phoenixd/phoenixd.go#L496-L498)
   Phoenixd advertises no notification types and the client publishes no nwc_lnclient_payment_sent events anywhere in the file, so the ConsumeEvent fallback that flips a FAILED row to SETTLED (transactions_service.go:889-970) can never run for this backend.
9. [lnclient/lnd/lnd.go:456–460](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/lnd/lnd.go#L456-L460)
   The maintainers' own comment states the contract the transactions service relies on: an error from SendPaymentSync must mean the payment definitively failed (LND semantics), while backends where a timeout may still succeed (LDK) deliver a later event. The Phoenixd client satisfies neither.
10. [transactions/transactions\_service.go:383–391](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L383-L391)
   The duplicate-payment guard rejects a new payment only while a PENDING row exists for the invoice; once the row is FAILED the app can immediately pay again with the refunded balance.

## Impact
Funds leave the operator's phoenixd wallet while the hub ledger records a FAILED (zero-cost) row, defeating the isolated-balance and budget boundaries that bound each app's spending authority; iterating drains the entire backend balance regardless of the app's allowance. Ledger and funds integrity are fully compromised. No confidentiality impact; availability impact incidental.

## Reproduction steps
1. Attacker holds a NIP-47 app connection with pay_invoice scope (isolated sub-wallet or budget-limited) on a hub using the Phoenixd backend, and runs a Lightning node. It creates a hold invoice for up to its balance, calls pay_invoice via the Nostr relay; the hub records PENDING and phoenixd commits the HTLC. The attacker holds the HTLC >90 s; the hub times out, marks FAILED, returns an error and refunds balance/budget. The attacker then releases the preimage, phoenixd settles, funds leave, and the hub never records it. Repeatable with the refunded balance; timing is fully attacker-controlled, no race.

## Recommended fix
1. SendPaymentSync surfaces a client-side HTTP timeout (or other transport error after the request was sent) as a payment failure although phoenixd's HTLC is in flight, violating the lnclient contract that an error means the payment definitively failed. Fix criteria: A timeout or transport error during /payinvoice must leave the hub-side transaction PENDING (or an explicit in-flight state) rather than FAILED, resolving to a terminal state only after phoenixd reports one (e.g. via /payments/outgoingbyhash). Verify by holding an HTLC >90 s then settling: the row must end SETTLED with the debit applied and the app's isolated balance and budget must not be refunded in between.
2. The transactions service has no reconciliation for FAILED outgoing rows on backends without payment_sent events, so a payment that settles after being marked failed is never debited. Fix criteria: For backends that emit no payment_sent notifications, recent FAILED outgoing rows must be periodically re-checked against the backend and flipped to SETTLED with the real preimage and fee when the backend reports success; isolated balance and budget must then reflect the debit. Verify that a FAILED row for a payment the backend later shows as paid becomes SETTLED and that the app can no longer re-spend that amount.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper error handling
**CWE:** [CWE-755](https://cwe.mitre.org/data/definitions/755.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256456

---

# pay_keysend with a valid-hex, non-32-byte preimage returns (nil, nil) and crashes the hub

## Details
NIP-47 `pay_keysend` and `multi_pay_keysend` accept an optional caller-supplied `preimage`. `transactionsService.SendKeysend` validates it with

```go
preImageBytes, err := hex.DecodeString(preimage)
if err != nil || len(preImageBytes) != 32 {
    ... return nil, err
}
```

For a preimage that is valid, even-length hex but not 32 bytes (e.g. 62 hex characters), `err` is nil and the function returns `(nil, nil)` (transactions/transactions_service.go:481-487). The controller treats a nil error as success and dereferences `*transaction.Preimage` on a nil pointer (nip47/controllers/pay_keysend_controller.go:69). NIP-47 requests are dispatched with `go svc.nip47Service.HandleEvent(...)` (service/start.go:240) and there is no `recover` anywhere on that path, so the runtime panic kills the entire Alby Hub process — HTTP API, NWC service and (for LDK deployments) the embedded Lightning node. The systemd units installed by scripts/*/install.sh use `Restart=always`, so the attacker can repeat the request after each restart; each crash also interrupts in-flight payments and hold-invoice subscriptions.

The attacker is any holder of an app connection with the `pay_invoice` scope (which covers pay_keysend and multi_pay_keysend, constants/constants.go:42, nip47/permissions/permissions.go:156) — adversary 1 in the threat model, a third-party app the operator paired. The only gate before the controller is the scope/expiry check at nip47/event_handler.go:362. No budget is consumed: the function returns before `validateCanPay` (transactions_service.go:514) or any DB write, so even an app whose budget is exhausted or whose isolated balance is zero can trigger it. The project concedes to such an app only the ability to spend within its budget; terminating the wallet process is outside that grant. The same `err != nil || len != 32` pattern is copied into `LNDService.SendKeysend` (lnclient/lnd/lnd.go:489-496); it is unreachable for this input today only because the transactions-service check runs first.

## Evidence
1. [transactions/transactions\_service.go:481–487](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L481-L487)
   `preImageBytes, err := hex.DecodeString(preimage); if err != nil || len(preImageBytes) != 32 { ...; return nil, err }` — for an even-length, valid-hex string of any length other than 64 characters, hex.DecodeString returns a nil error, so SendKeysend returns (nil, nil): no transaction and no error. This is the line the fix must change.
2. [nip47/controllers/pay\_keysend\_controller.go:52–72](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/pay_keysend_controller.go#L52-L72)
   The controller checks only `err != nil`; on (nil, nil) it falls through to `Preimage: *transaction.Preimage` (line 69) on a nil *Transaction and panics with a nil pointer dereference.
3. [nip47/controllers/pay\_keysend\_controller.go:20–25](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/pay_keysend_controller.go#L20-L25)
   `preimage` is a client-supplied NIP-47 request parameter, json-decoded straight from the decrypted event payload with no format or length validation.
4. [nip47/controllers/multi\_pay\_keysend\_controller.go:31–43](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/multi_pay_keysend_controller.go#L31-L43)
   multi_pay_keysend reaches the same payKeysend code path per element, in its own goroutine, with no recover.
5. [service/start.go:236–240](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L236-L240)
   Each NIP-47 request is handled in `go svc.nip47Service.HandleEvent(...)` with no deferred recover; the only recover() calls in the tree (lnclient/lnd, lnclient/ldk broadcaster, lnclient/cln, alby/) are on unrelated goroutines, so the panic terminates the whole process (HTTP server and embedded node included).
6. [nip47/event\_handler.go:362](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/event_handler.go#L362)
   The only gate before the controller is HasPermission for the method's scope (pay_invoice, which covers pay_keysend and multi_pay_keysend per permissions.go:156); the request need not be payable.
7. [transactions/transactions\_service.go:511–514](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L511-L514)
   validateCanPay (budget / isolated-balance check) runs only after the preimage check, so the early (nil, nil) return consumes no budget and is reachable by an app with an exhausted budget or zero isolated balance.

## Impact
Whole-process crash of the hub (HTTP API, NWC service, embedded LDK node), repeatable at will by the same app with no budget cost: availability HIGH. No data is read or altered.

## Reproduction steps
1. Attacker holds any NWC app connection with the pay_invoice scope (a low-privilege position the hub grants to third-party apps). They publish one kind-23194 request `{"method":"pay_keysend","params":{"amount":1000,"pubkey":"02...","preimage":"<62 hex chars>"}}` via the relay. HandleEvent verifies the signature, looks up the app, passes the scope check, decodes the params, SendKeysend returns (nil, nil) before any budget check, the controller dereferences nil and the process exits. Deterministic, no race, no defense to bypass, no user interaction; repeatable after every supervisor restart.

## Recommended fix
1. The combined `err != nil || len != 32` guard returns the nil `err` for the length-failure branch, so callers receive success with a nil result. Fix criteria: SendKeysend (transactions service and every LNClient implementation) must return a non-nil error whenever the preimage is not exactly 32 bytes, and controllers must never dereference a nil transaction. Verify that a pay_keysend request with a 31- or 33-byte valid-hex preimage yields a NIP-47 error response and the process stays up.
2. NIP-47 request handling runs in bare goroutines without panic recovery, so any controller bug becomes a full-process crash reachable by remote app connections. Fix criteria: A panic inside a single NIP-47 request handler must not terminate the process (e.g. recover and log per request). Verify by inducing a panic in one handler and confirming other requests and the HTTP API continue to be served.

---
**Severity:** HIGH
**Status:** Open
**Category:** NULL Pointer Dereference
**CWE:** [CWE-476](https://cwe.mitre.org/data/definitions/476.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256455

---

# Undocumented app= deep-link parameter pre-selects superuser under Alby Go branding for any pubkey

## Details
The NWC deep link /apps/new is a public, web-attacker-reachable entry point (README 'Application deeplink options', README.md:370-409). Besides the documented parameters, NewApp.tsx reads an undocumented `app` parameter and resolves it against the static app-store catalogue (NewApp.tsx:81-82). The matched entry drives the consent screen's logo and title (343-356), the install step, hides the Name input (408-425), and seeds the superuser option: `useState(appStoreApp?.superuser || false)` (216); the superuser checkbox is rendered only when `appStoreApp?.superuser` is set (433-456). The only catalogue entry with `superuser: true` is `alby-go` (SuggestedAppData.tsx:159). No documented deep-link parameter can request superuser: initialScopes (107-194) is derived from request_methods and never yields it, and every in-repo producer of `app=` is an in-app link without a pubkey (AppStoreDetail.tsx:64, AppDetails.tsx:277, AppStoreDetailHeader.tsx:53), i.e. the hub generates the secret and the operator scans a QR into the real Alby Go.

Attack: a page the operator visits opens (window.open, the popup flow the README sanctions at line 405-409) `https://<hub>/apps/new?app=alby-go&pubkey=<attacker pubkey>`. The hub shows 'Connect to Alby Go' with the Alby Go logo and official install guide, then a Configure step with every scope selected, the default 100,000 sat/month budget on, and 'Enable accepting connections to other apps' already checked. Submitting opens SuperuserConfirmPasswordDialog whose text is hard-coded to 'Alby Go will be given permission to create other app connections' (650-651) and asks for the unlock password. The pubkey is never rendered anywhere on the screen; the only visible difference from a genuine in-app Alby Go pairing is the button label 'Connect' instead of 'Next' (498-500) (and, only if the attacker supplies return_to, the 'You will automatically return to' line at 458-462, which the popup flow avoids). An operator who believes they are pairing Alby Go types the password; api.CreateApp (api.go:78-83) checks only that password and creates a connection for the attacker's pubkey with every scope plus superuser. The browser posts relayUrls and the per-app walletPubkey to the opener via postMessage(…, '*') (298-308) (or redirects to return_to with them, api.go:153-171), which is all the attacker needs to drive the connection. If the hub is locked or the session expired, DefaultRedirect stores the deep link in localStorage.returnTo (DefaultRedirect.tsx:21-23) and HomeRedirect replays it after unlock (HomeRedirect.tsx:33-41).

With superuser the attacker's key may call NIP-47 create_connection (permissions.go:133-134; event_handler.go:429). By design the controller builds the child purely from request parameters: pay_invoice with max_amount 0 (unlimited, transactions_service.go:1195 only enforces MaxAmountSat > 0), non-isolated, with get_balance/list_transactions/make_invoice/lookup_invoice/sign_message; children are independent App rows (db.App has no parent link) so they outlive deletion of the spoofed 'Alby Go' connection and bypass the 100,000 sat budget the operator saw and believed applied. The result is full read and spend authority over the main wallet.

Root cause: a security-relevant default (superuser) and the hub-vouched presentation of a catalogue app are selected by an untrusted URL parameter and combined with an untrusted, never-displayed pubkey, so the password confirmation dialog — the shipped control for superuser — asserts a grantee identity (Alby Go) that the code has not verified and that is false for this input. The dialog mitigates accidental grants but is itself the vehicle of the misrepresentation. The documented deep-link contract concedes name, pubkey, scopes, budget and expiry to any client; it never concedes superuser, and superuser is what this path obtains.

## Evidence
1. [frontend/src/screens/apps/NewApp.tsx:216](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L216)
   The superuser state is initialised from appStoreApp?.superuser, i.e. from the attacker-controlled `app` query parameter, so a deep link with app=alby-go arrives with superuser pre-selected regardless of whether pubkey is externally supplied.
2. [frontend/src/screens/apps/NewApp.tsx:81–94](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L81-L94)
   `app`, `pubkey`, `return_to` and `name` are read from the URL; appStoreApp is the catalogue entry matched by the untrusted id and drives logo, title, install/finalize guides and the superuser default, while pubkey is the attacker's key and is never rendered.
3. [frontend/src/screens/apps/NewApp.tsx:433–456](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L433-L456)
   The superuser checkbox is rendered only when the catalogue entry has superuser: true, so `app=alby-go` is the sole deep-link route that exposes the option at all; it is shown already checked.
4. [frontend/src/screens/apps/NewApp.tsx:629–684](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L629-L684)
   The password dialog hard-codes 'Alby Go will be given permission to create other app connections' and never shows the pubkey being authorised, so the shipped superuser control itself asserts the spoofed identity.
5. [frontend/src/screens/apps/NewApp.tsx:343–355](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L343-L355)
   Header renders the catalogue logo and 'Connect to <title>', making the consent screen visually indistinguishable from a genuine in-app Alby Go pairing.
6. [frontend/src/screens/apps/NewApp.tsx:408–424](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L408-L424)
   When appStoreApp is set the Name input is hidden, so the operator cannot see or change the identity under which the connection is created.
7. [frontend/src/screens/apps/NewApp.tsx:265–308](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L265-L308)
   On submit the request carries the attacker's pubkey, the full scope list plus 'superuser', the typed unlockPassword and return_to; after creation the per-app walletPubkey and relay URLs are posted to window.opener with target '*', so the attacker's page learns everything it needs without a return_to.
8. [frontend/src/components/connections/SuggestedAppData.tsx:144–159](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/connections/SuggestedAppData.tsx#L144-L159)
   The only catalogue entry with superuser: true is alby-go; its id is a public constant any web page can put in a deep link.
9. [api/api.go:77–83](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L77-L83)
   CreateApp grants the superuser scope for an arbitrary caller-supplied pubkey as long as the unlock password matches; nothing ties superuser to a hub-generated secret or a verified Alby Go identity.
10. [nip47/controllers/create\_connection\_controller.go:34–154](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/create_connection_controller.go#L34-L154)
   With superuser the attacker's key may call create_connection; the child is built from request parameters alone (unlimited budget when max_amount is 0, non-isolated, all non-superuser scopes), so the spoofed grant converts to unbounded spend and read access on the main wallet.
11. [frontend/src/components/redirects/DefaultRedirect.tsx:12–23](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/redirects/DefaultRedirect.tsx#L12-L23)
   A deep link hit while the session is not authenticated is stored in localStorage.returnTo and replayed by HomeRedirect after unlock, so the attack does not require an already-signed-in browser tab.
12. [README.md:370–409](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/README.md#L370-L409)
   The documented /apps/new contract lists name, pubkey, return_to, expires_at, max_amount, budget_renewal, request_methods, notification_types, isolated and sanctions the popup/postMessage flow. `app` is not documented and no documented parameter can request superuser; the catalogue id is the only deep-link route to it.

## Impact
A superuser connection lets the attacker mint unbounded, non-isolated pay_invoice connections against the main wallet (create_connection builds children from request parameters alone; max_amount 0 means no budget) and read balances and transaction history via get_balance/list_transactions, so confidentiality and integrity of funds are fully compromised; children survive deletion of the spoofed connection. Availability is not directly affected.

## Reproduction steps
1. A web attacker hosts a page that opens the operator's hub at /apps/new?app=alby-go&pubkey=<attacker key> (popup flow sanctioned by the README, so no return_to hint is shown). The attacker needs to know or guess the hub's origin (predictable for Umbrel/Start9/systemd installs and public for fly/render deployments) and needs the operator to click Next on the Alby Go install step, click Connect with superuser pre-checked, and type the unlock password into a dialog that names Alby Go; if the browser is not signed in the deep link is persisted and replayed after unlock. No credential or network position is required of the attacker (PR:N, AV:N); the operator performs several conscious steps including entering a password (UI:ACTIVE). No non-default configuration is needed (AT:N).

## Recommended fix
1. The superuser default and the trusted catalogue presentation are chosen by the untrusted `app` query parameter and combined with an untrusted pubkey, misrepresenting the requester as the catalogue app. Fix criteria: A deep link must not be able to pre-select or request the superuser scope; superuser should be opt-in by explicit operator action only. When `pubkey` is supplied by the URL, the consent screen must make clear that an external key is being authorised (e.g. show the pubkey, do not hide the name field, do not reuse catalogue identity text in the confirmation dialog). Verify by loading /apps/new?app=alby-go&pubkey=X: the superuser option is unchecked and the dialog does not assert an Alby Go identity.
2. The documented /apps/new contract omits `app`, so integrators and reviewers cannot see that this parameter changes privilege defaults. Fix criteria: Either remove catalogue selection from externally reachable deep links (only allow it from in-app navigation) or document it with its effect limited to presentation, never to privilege defaults.

---
**Severity:** HIGH
**Status:** Open
**Category:** UI misrepresentation
**CWE:** [CWE-451](https://cwe.mitre.org/data/definitions/451.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256454

---

# Config cache race during password change keeps revoked unlock password valid

## Details
config.Get caches decrypted user_config values per key and per truncated password hash with no expiry; the only eviction is delete(cfg.cache, key) in set() (config/config.go:302-305), executed immediately after the write on whatever *gorm.DB set() was handed. In ChangeUnlockPassword (336-392) that handle is the open transaction tx, so for every encrypted row the order is: UPDATE inside the uncommitted tx -> evict cache[key] -> next row (two Argon2 derivations at t=3, m=32 MiB each, aesgcm.go:22) -> ... -> COMMIT. UnlockPasswordCheck is the first row written at setup (api.go:1780) and so is normally the first row processed, leaving a window of several hundred milliseconds to seconds (Mnemonic, JWTSecret and any backend credentials still to re-encrypt) between its eviction and the commit.

During that window a concurrent cfg.Get("UnlockPasswordCheck", oldPassword) misses the cache, reads the row through cfg.db on a pooled connection outside tx (under WAL, db/db.go:63, readers see the committed snapshot rather than blocking; Postgres READ COMMITTED behaves the same), decrypts the still-old ciphertext successfully, and stores the canary under hash(oldPassword) (line 264). After the commit nothing evicts that entry again — the next write to UnlockPasswordCheck is the next password change — so CheckUnlockPassword(oldPassword) (408-413) keeps returning true from the cache although the on-disk row is now encrypted under the new password. The condition lasts until process restart.

Exploitation: an attacker who knows the current unlock password polls POST /api/unlock or POST /api/start with it (global limiter: 1 r/s, burst 2) while the operator rotates the password through PATCH /api/unlock-password. One request landing in the window poisons the cache. api.ChangeUnlockPassword then calls api.Stop() (api/api.go:823), so the operator restarts the node with the new password; from then on POST /api/unlock with the revoked password passes CheckUnlockPassword from the cache and returns full JWTs signed with the live secret (http_service.go:350-394). Alternatively, before the operator restarts, POST /api/start with the revoked password passes the check, LoadJWTSecret(old) generates a new secret and a full token is returned (http_service.go:313-338); the operator's later LoadJWTSecret(new) keeps the in-memory secret (config.go:169-172), so that token stays valid once the node runs. A full JWT allows paying invoices, redeeming on-chain funds, closing channels, stopping the node and — because CheckUnlockPassword(old) is also poisoned — creating a superuser app connection (api/api.go:78-82) as a persistent NWC backdoor. Decrypting the mnemonic or changing the password again with the old password still fails, since those rows are read from the DB.

The password change is the project's revocation control: the code deletes the JWT secret 'to log all sessions out on password change' (config.go:373) and the threat model names stale-credential holders after a password change as in scope. The maintainers' test (config/config_test.go:81-91) covers only the sequential case. Ledger item dismissed-config-336-89e7 dismissed this function because 'cache cleared per key via set()', without considering that the eviction precedes the commit while Get() reads committed state on another connection.

## Evidence
1. [config/config.go:336–392](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/config.go#L336-L392)
   ChangeUnlockPassword re-encrypts every Encrypted=true row inside one cfg.db.Transaction, calling cfg.set(key, value, clauses, newPassword, tx) per row. Each row costs two Argon2 derivations (aesgcm.go:22: t=3, m=32 MiB), so the interval between the first row's cache eviction and COMMIT spans several hundred milliseconds to seconds. Nothing clears the cache after the commit; only cfg.jwtSecret is reset. This is where the fix belongs (evict after commit, or hold cacheMutex for the transaction).
2. [config/config.go:287–308](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/config.go#L287-L308)
   set() issues the UPDATE on whatever *gorm.DB it is handed (the uncommitted tx in ChangeUnlockPassword) and then immediately deletes cfg.cache[key] (lines 302-305), before the transaction commits. The eviction is therefore visible to concurrent readers while the on-disk row still holds the old ciphertext.
3. [config/config.go:242–267](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/config.go#L242-L267)
   Get() on a cache miss reads via cfg.db — a pooled connection outside the transaction — decrypts, and stores the result under sha256(password)[:8] with no expiry (line 264). A Get("UnlockPasswordCheck", oldPassword) landing between the eviction and the commit reads the pre-change ciphertext, decrypts it with the old password and re-caches the canary under the old password's hash.
4. [config/config.go:408–413](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/config.go#L408-L413)
   CheckUnlockPassword is served entirely from Get()'s cache, so once the stale entry exists the revoked password verifies as correct for the rest of the process lifetime.
5. [http/http\_service.go:342–394](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L342-L394)
   POST /api/unlock (unauthenticated, global 1 r/s burst-2 limiter) issues a full JWT whenever CheckUnlockPassword(password) is true and the node is running; after the operator restarts the node with the new password this hands the holder of the revoked password full-access tokens signed with the live JWT secret.
6. [http/http\_service.go:304–339](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L304-L339)
   POST /api/start also gates on CheckUnlockPassword, then LoadJWTSecret(password) (config.go:163-205) and createJWT before launching the node in a goroutine. With the poisoned cache and the node stopped after the change, the old password generates a fresh JWT secret and a full token; the operator's later LoadJWTSecret(newPassword) keeps the in-memory secret (line 169-172), so that token remains valid once the node is running.
7. [api/api.go:801–824](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L801-L824)
   api.ChangeUnlockPassword calls api.Stop() after the config change, so the operator must restart the node with the new password; that restart is what makes the poisoned CheckUnlockPassword(old) usable via /api/unlock.
8. [db/db.go:55–63](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/db.go#L55-L63)
   SQLite is opened with _journal_mode=WAL and _txlock=immediate and the pool has no SetMaxOpenConns, so a reader on another pooled connection does not block on the writer's transaction and sees the last committed snapshot (Postgres READ COMMITTED behaves the same). The out-of-transaction read in Get() therefore returns the old ciphertext.

## Impact
The revocation the operator relied on silently fails: the revoked password continues to produce full JWTs, giving the attacker the complete authenticated API — read all wallet, transaction, app and account data (C:H), pay invoices, redeem on-chain funds, create superuser app connections, close channels (I:H), and stop the node or force-close channels (A:H) — until the hub process restarts.

## Reproduction steps
1. The attacker is network-adjacent (the HTTP port is reachable on the LAN/VPN per the threat model) and must hold the current unlock password — the hub's administrative credential — at the moment the operator rotates it (PR:H). They poll the unauthenticated /api/unlock or /api/start with that password at the limiter's 1 r/s; a single request landing between the UnlockPasswordCheck eviction and the transaction commit (hundreds of ms to seconds of Argon2 work, longer on Raspberry-Pi-class hosts) is enough, so a race must be won (AT:P) and the operator must perform the password change (UI:A). No security mechanism beyond the timing has to be evaded (AC:L). Once poisoned, the revoked password yields full-access JWTs deterministically until the process restarts.

## Recommended fix
1. set() evicts the config cache before the enclosing transaction commits, while Get() repopulates it from a connection outside the transaction, so a value decrypted under the old password can be cached across the commit of a password change. Fix criteria: After ChangeUnlockPassword commits, the cache must contain no entry derived from the old password: clear the affected keys (or the whole cache) after the commit succeeds, or hold cacheMutex (or otherwise block Get()) for the duration of the transaction. Cover it with a test that runs CheckUnlockPassword(old) concurrently with ChangeUnlockPassword and asserts it is false once the change returns.
2. CheckUnlockPassword is answered from an unbounded, never-expiring cache keyed by password hash, so a stale positive result outlives the credential. Fix criteria: Password verification should not depend on a cache entry that can survive revocation: exclude UnlockPasswordCheck from caching, or invalidate every cached password-hash entry whenever the password changes (after commit), so that only the current password verifies.

---
**Severity:** HIGH
**Status:** Open
**Category:** Race Condition
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256450

---

# Swap-out invoice bound is derived from the provider's own fee quote with no cap and no binding to the operator-approved quote

## Details
SwapOut() pays a reverse-swap hold invoice whose amount is accepted if it does not exceed calculateMaxSwapOutSendAmountSat(amountSat, fees.Percentage, fees.MinerFees.Lockup, fees.MinerFees.Claim). All three fee inputs are read from the provider's own GetReversePairs response fetched inside SwapOut (288-304); the only sanity rule is that the summed percentage is below 100 (425-433). There is no absolute cap on the percentage or on the miner-fee amounts, no comparison with the quote the operator was shown by GetSwapOutInfo, and InitiateSwapOutRequest carries only amount and destination, so the backend cannot bind execution to what the operator accepted. The invoice is then paid from the main wallet (1267-1298) where validateCanPay imposes no limit beyond the backend's spendable balance.

Attack: the swap provider (https://api.boltz.exchange or https://api.satsrouting.exchange as selected by Alby's GetInfo, or the operator-set BOLTZ_API), or anyone able to answer in its name, returns a pair quote with an inflated fee and an invoice sized to the resulting maximum. Three variants: (a) MinerFees.Lockup set to e.g. 10,000,000 sat consistently on every GetReversePairs call — the UI renders only '<x>% + on-chain fees' and never the absolute network fee (index.tsx:476-481, AutoSwap.tsx:297-303), so a manual swap-out of 100,000 sat shows a normal fee line while the hub accepts and pays an invoice of ~10.1M sat; (b) a service percentage up to 98% (total < 100), which multiplies the bound by up to 100x, served to the execution-time GetReversePairs call while the info call saw a normal quote; (c) with auto swap-out enabled, either inflated quote is paid every hour with no human present (210-260), each run blocked until the swap completes. In every variant the protocol steps are honest (hash-bound hold invoice, lockup, claim) and the hub receives only amountSat + claim fee on-chain; the provider keeps the difference. Loss is bounded only by the hub's Lightning spendable balance.

The PairHash echoed in CreateReverseSwapRequest only binds the provider to its own quote; it does not protect against a provider that authors the quote. The threat model lists Boltz among remote parties whose responses the hub must validate, and the project's own verifySwapOutInvoice shows the invoice amount is not meant to be provider-controlled — but the bound it enforces is itself provider-supplied. Assumptions: boltz-client v2.12.5's ReversePair.Fees.Percentage (float64) and MinerFees.Lockup/Claim (uint64) are deserialised verbatim from the provider's JSON; ln-decodepay v1.13.0 returns the invoice MSatoshi faithfully. Distinct from the verified swap-in ExpectedAmount finding (579), the claim-fee finding (1357) and the cooperative-claim finding (1380): here the loss is pure overcharge accepted by the hub's own bound computation.

## Evidence
1. [swaps/swaps\_service.go:371–375](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L371-L375)
   maxSendAmountSat is computed from fees.Percentage and fees.MinerFees.Lockup/Claim fetched from the provider moments earlier, and verifySwapOutInvoice accepts any invoice up to that figure; the stored SendAmountSat then becomes the bound re-checked at pay time (1279). This is where the fix must bind the maximum to an operator-approved or capped value.
2. [swaps/swaps\_service.go:425–432](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L425-L432)
   calculateMaxSwapOutSendAmountSat only rejects totalFeePercentage >= 100 (serviceFee + 1% Alby). A quoted 98% service fee yields (amount + minerFees)/0.01, i.e. ~100x the swap amount; lockupFeeSat and claimFeeSat are uint64 added verbatim with no cap, so MinerFees.Lockup of 0.1 BTC raises the bound by 0.1 BTC.
3. [swaps/swaps\_service.go:288–303](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L288-L303)
   SwapOut fetches GetReversePairs itself at execution time; fees.Percentage and fees.MinerFees come from the provider's response (boltz-client v2.12.5 ReversePair.Fees, assumed provider-supplied float64/uint64) and are never compared to the quote returned to the operator by GetSwapOutInfo (607-629) nor to any configured maximum.
4. [swaps/swaps\_service.go:210–259](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L210-L259)
   Auto swap-out loop: every hour, if the Lightning balance exceeds the configured threshold, SwapOut(amountSat, destination, true, ...) runs with no operator present and blocks on the listener until the swap completes.
5. [swaps/swaps\_service.go:1267–1297](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1267-L1297)
   On the provider's SwapCreated websocket event the listener re-runs verifySwapOutInvoice against the stored (provider-derived) SendAmountSat and pays swap.Invoice via SendPaymentSync from the main wallet (appId nil).
6. [transactions/transactions\_service.go:1140–1146](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1140-L1146)
   validateCanPay applies isolated-balance and budget checks only when appId != nil; a main-wallet payment is limited solely by the backend's spendable balance plus fee reserve, so nothing downstream caps the inflated invoice.
7. [api/api.go:1009–1039](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L1009-L1039)
   InitiateSwapOut (POST /api/swaps/out, full-access JWT; Wails mirror wails_handlers.go:1104) passes only amountSat and destination to SwapOut; InitiateSwapOutRequest (api/models.go:179-183) has no field for the fee or total the operator accepted, so execution cannot be bound to the displayed quote.
8. [frontend/src/screens/wallet/swap/index.tsx:476–480](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/swap/index.tsx#L476-L480)
   The swap-out form shows only '<albyServiceFee + boltzServiceFee>% + on-chain fees'; boltzNetworkFeeSat is never rendered (same in AutoSwap.tsx:297-303), so an inflated MinerFees quote is invisible to the operator even on the manual path.

## Impact
Direct loss of Lightning funds: the hub pays an invoice far above amountSat plus any reasonable fee and receives only amountSat + claim fee on-chain; validateCanPay for main-wallet payments (appId nil) limits the send only by spendable balance plus fee reserve, so the per-swap loss can approach the hub's whole Lightning balance, and under auto-swap it repeats hourly. No confidentiality impact; no availability impact beyond the fund loss itself.

## Reproduction steps
1. The attacker is the swap provider the hub connects to over HTTPS (Boltz or SatsRouting as chosen by Alby GetInfo, or BOLTZ_API), or a party answering in its name. It returns an inflated pair quote and a hash-bound invoice sized to the hub's resulting maximum; the hub computes the bound from that quote, accepts the invoice and pays it. Deterministic, no defence to bypass. A swap-out must be executing: with auto swap-out enabled this happens hourly whenever the Lightning balance exceeds the configured threshold with no interaction (UI:NONE); on the manual path the operator initiates the swap but sees only a percentage line, never the absolute network fee, so the inflated MinerFees variant is indistinguishable from a normal swap.

## Recommended fix
1. The maximum invoice amount SwapOut will pay is derived solely from the provider's execution-time fee quote (percentage and miner fees), with no absolute cap and no binding to the quote the operator approved or to a configured auto-swap maximum. Fix criteria: Before creating or paying a swap-out, the hub must reject any invoice whose amount exceeds a bound the operator controls: for manual swaps the fee/total shown and accepted in the UI must be passed in InitiateSwapOutRequest and enforced server-side; for auto-swaps a configured maximum total fee (percentage and/or absolute sat) must be enforced; additionally an absolute sanity cap on provider percentage and miner-fee quotes must apply on every path. A quote exceeding any of these must abort the swap before CreateReverseSwap and before any payment.
2. The swap-out and auto-swap forms render only the summed percentage and never the quoted absolute network fee, so an inflated MinerFees quote is invisible to the operator. Fix criteria: The UI must display the quoted absolute network fee (and resulting total to be paid) for the chosen amount so that the operator approves a concrete maximum, and that maximum must be what the backend enforces.

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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256449

---

# Swap-out claim is unrecoverable after the preimage is disclosed: every failure is terminal and broadcast/confirmation rely solely on the provider

## Details
In a reverse (Lightning to on-chain) swap the hub pays the provider's hold invoice first; the provider settles that invoice as soon as it learns the preimage, and from that moment the hub is made whole only by getting its own claim of the on-chain lockup confirmed. startSwapOutListener gives the hub no way to do that without the provider's cooperation, and treats every failure after the preimage has left the hub as final.

On a lockup update the hub builds the claim with Cooperative: true (swaps/swaps_service.go:1343-1380). Under boltz-client v2.12.5 (go.mod:248; stated as an assumption, not verified in-tree) a cooperative reverse-swap claim posts the preimage, public nonce and unsigned transaction to the provider's claim endpoint and waits for its MuSig2 partial signature. If ConstructTransaction returns an error - provider error, invalid partial signature, or a response slower than the 5 s client timeout (108-113) - the listener returns (1380-1387), the deferred handler marks the swap FAILED (1141-1152), and nothing is retried: the hub never attempts a script-path claim with the preimage and key it holds locally, persists no transaction (db/models.go:98-109 has only ClaimTxId), resumes only PENDING swaps on restart (930-960), and exposes no manual claim or rebroadcast API for swap-outs (RefundSwap rejects them, 697-699). Whether or not the boltz-client library itself retries non-cooperatively internally (unverified), the hub's handling of the result is the same.

If signing succeeds, the signed claim is broadcast exclusively through the provider's API (1401-1420, TODO: 'to avoid trusting boltz'): five failures within roughly 30 s end the swap FAILED; a 'successful' response that is never actually relayed stores the returned txid, after which success is judged only by polling the provider's GetTransactionDetails (1234-1256, 1475-1481) and a restart skips the claim because ClaimTxId is set (1319-1325). The signed hex is discarded.

A malicious or compromised swap provider therefore keeps the Lightning payment of any swap-out: after accepting the hub's HTLC and locking funds it reads the preimage from the claim request, settles the hold invoice, and either returns an error / bad signature or accepts and swallows the broadcast; the hub never claims, and the provider refunds its own lockup after TimeoutBlockHeight. The same terminal path is reached with an honest provider on a transient network failure at the wrong moment. Auto swap-out exercises this hourly without operator interaction (212-246).

This record covers the failure handling after disclosure and the sole dependence on the provider for broadcast and confirmation; the separately verified record swap-out-claim-fee-from-unverified-lockup-amount-after-preimage-reveal covers the decision to disclose on unverified provider lockup data and fee. Fixing that record (validating the lockup and fee) does not close this path. The analogous RefundSwap path (830-862) at least drops to a non-cooperative refund once the timeout height passes and keeps retrying; the claim path has no equivalent.

## Evidence
1. [swaps/swaps\_service.go:1380–1386](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1380-L1386)
   boltz.ConstructTransaction is called with Cooperative: true, which (boltz-client v2.12.5, go.mod:248 - assumption, not verified in-tree) posts the preimage, nonce and unsigned tx to the provider's claim endpoint for a MuSig2 partial signature. Any error - provider 5xx, invalid partial signature, or a response slower than the 5 s client timeout - makes the listener return; the hub itself never retries with a script-path (non-cooperative) claim even though it holds the preimage and key locally, and nothing is persisted.
2. [swaps/swaps\_service.go:1401–1419](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1401-L1419)
   The fully signed claim is broadcast only via svc.boltzApi.BroadcastTransaction (the TODO acknowledges this trusts the provider); five attempts about one second apart, then err is set and the listener returns. The hub's own chain/LN backend is never used to relay the transaction and the signed hex is discarded.
3. [swaps/swaps\_service.go:1141–1151](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1141-L1151)
   Deferred handler: whenever the listener exits with err != nil the swap is marked SWAP_STATE_FAILED. For the claim-construction and broadcast errors above this happens after the preimage has already been handed to the provider.
4. [swaps/swaps\_service.go:1234–1255](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1234-L1255)
   Once a ClaimTxId is stored, success is determined solely by polling the provider's GetTransactionDetails (isTransactionConfirmed, lines 1475-1481) every 10 s. A provider that accepted the broadcast but never relayed it, returning the (real or fake) txid, is never detected: the hub polls indefinitely and no other verification exists.
5. [swaps/swaps\_service.go:1319–1324](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1319-L1324)
   On resume after restart a swap with ClaimTxId set skips the claim entirely ('Claim transaction already recorded, skipping broadcast'), so a claim the provider swallowed is never rebuilt or rebroadcast.
6. [swaps/swaps\_service.go:930–959](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L930-L959)
   subscribePendingSwaps resumes only SWAP_STATE_PENDING swaps; a swap-out marked FAILED after preimage disclosure is never claimed later.
7. [swaps/swaps\_service.go:697–698](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L697-L698)
   RefundSwap, the only manual recovery API (POST /api/swaps/refund), rejects swap-outs; http/http_service.go:158-204 and wails/wails_handlers.go expose no other claim or rebroadcast path for a swap-out.
8. [swaps/swaps\_service.go:108–112](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L108-L112)
   The provider HTTP client has a 5 s timeout, so a cooperative claim request that the provider has already read (and whose invoice it may already have settled) but answers slowly is itself enough to reach the terminal error path.
9. [db/models.go:98–108](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/models.go#L98-L108)
   The Swap model persists State, Preimage, LockupTxId and ClaimTxId but no signed claim transaction, so nothing can be rebroadcast after the listener exits.
10. [swaps/swaps\_service.go:212–245](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L212-L245)
   Auto swap-out invokes SwapOut hourly with no operator interaction, so this claim path runs unattended and repeatedly once enabled.

## Impact
Complete loss of the Lightning amount paid for each affected swap-out (the hub's funds are moved to the provider with nothing received), repeatable on every swap-out and hourly under auto swap-out. No confidentiality impact; the hub keeps operating.

## Reproduction steps
1. Attacker: the configured swap provider (Boltz, the Alby-selected provider, or an impersonator at the fetched URL), a remote party the threat model names (adversary 5) whose responses the hub is expected to validate. It accepts the hub's reverse swap, receives the hold-invoice HTLC and locks funds normally; when the hub's cooperative claim request arrives carrying the preimage it settles the invoice and answers with an error, an invalid partial signature, or a slow response, or it accepts the subsequent broadcast and never relays it. The hub's own code then marks the swap FAILED or polls forever and never claims; the provider refunds its lockup after the timeout. Deterministic, network-only, no privileges on the hub, no user interaction; requires a swap-out to be in progress, which auto swap-out performs hourly unattended. Depends on boltz-client v2.12.5 sending the preimage in the cooperative claim request (assumption from the pinned dependency, not verified in-tree).

## Recommended fix
1. Once the preimage has been handed to the provider, any failure of the cooperative signing step ends the swap permanently: no non-cooperative (script-path) claim, no retry, no persistence, no resume of FAILED swaps and no manual claim API for swap-outs. Fix criteria: A swap-out whose lockup has been detected must eventually be claimed without the provider's cooperation: on cooperative failure fall back to a script-path claim using the locally held preimage and key, keep the swap PENDING and retry across restarts until the claim confirms or the timeout passes, and expose a manual claim/rebroadcast operation for swap-outs.
2. The signed claim is broadcast only through the provider's API and its confirmation is judged only by the provider's transaction lookup; the signed transaction is never stored. Fix criteria: Broadcast the claim through the hub's own node or chain backend (at minimum in addition to the provider), persist the signed transaction so it can be rebroadcast, and verify txid and confirmation via a chain source independent of the provider so a provider that swallows the transaction is detected and the claim is re-sent.

---
**Severity:** HIGH
**Status:** Open
**Category:** Not failing securely
**CWE:** [CWE-636](https://cwe.mitre.org/data/definitions/636.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256446

---

# Refund construction trusts Boltz-reported timeout height and fee rate instead of verified local values

## Details
RefundSwap returns a failed swap-in's locked bitcoin to the operator. At creation the hub stores Boltz's TimeoutBlockHeight (swaps_service.go:545) and, before refunding, verifies it against the swap tree's CLTV leaf and the paid lockup address (tree.Check / tree.CheckAddress, lines 764-770), so swap.TimeoutBlockHeight is bound to the on-chain script. The refund logic then ignores that verified value and instead uses swapTransactionResp.TimeoutBlockHeight, fetched from Boltz's /swap/{id}/transaction endpoint at refund time (line 715), for two decisions: whether to attempt a cooperative (MuSig2 key-path) refund and which nLockTime to put on a script-path refund (lines 830, 841).

The refund is triggered automatically by the swap-in listener on any Boltz-reported failure status (lines 1109-1115, enableRetries=true) and manually via POST /api/swaps/refund or the desktop equivalent (enableRetries=false). Consequences with a malicious or compromised provider:
- Inflated timeout (e.g. 0xFFFFFFFF): cooperative is always true, so the hub only ever asks Boltz for a partial signature and never attempts the script-path refund even after the real CLTV has expired; the provider refuses to co-sign. Automatic refunds loop forever on the stale value (lines 859-860); manual refunds return Boltz's error. The operator's funds stay locked in the swap script, which the provider cannot spend either, even though a unilateral refund is valid on-chain; recovery requires the swap mnemonic and external tooling.
- Too-low timeout: cooperative is false early, the script-path refund is built with an nLockTime below the script's CLTV and is invalid; broadcast (also via Boltz, line 877) fails, the swap is marked FAILED and the hub's own refund path can never succeed for it.

Independently, the refund fee rate is svc.getFeeRate() = boltzApi.GetFeeEstimation() (lines 821, 1483-1485), unbounded and used as SatsPerVbyte. A provider returning e.g. 10,000 sat/vB makes the hub sign a refund that burns most or all of the locked amount as miner fee. The hub has its own node and chain backends but never uses them for this estimate, and applies no cap. The legacy swap-out claim branch (lines 1369-1376) uses the same unbounded value.

Dependency assumption (github.com/BoltzExchange/boltz-client/v2 v2.12.5, not inspected in this checkout): boltz.ConstructTransaction sets the transaction nLockTime from OutputDetails.TimeoutBlockHeight for non-cooperative NormalSwap outputs, requests a Boltz partial signature for cooperative outputs and returns an error if that request fails, and computes the fee as vsize * SatsPerVbyte with no upper clamp. Even if the library fell back to a script-path spend on cooperative failure, the fallback would use the same provider-supplied, inflated nLockTime and remain non-final.

The provider gains nothing directly from the fee burn, but it is a destruction of the hub's funds controlled entirely by a remote party's response, and the timeout manipulation lets a provider deny refunds of funds it cannot itself spend. The project treats Boltz as untrusted everywhere else in this flow (tree/address verification, the 'avoid trusting boltz' TODO at line 876).

## Evidence
1. [swaps/swaps\_service.go:830–851](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L830-L851)
   cooperative is decided from swapTransactionResp.TimeoutBlockHeight (fetched from Boltz at refund time, line 715, never refetched in the loop) and the same value is passed as OutputDetails.TimeoutBlockHeight, which becomes the nLockTime of a script-path refund. The locally stored swap.TimeoutBlockHeight, verified against the tree's CLTV leaf at line 764, is not used.
2. [swaps/swaps\_service.go:821–828](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L821-L828)
   feeRate comes from getFeeRate() with no upper bound and is passed as Fee.SatsPerVbyte for the refund; the refund output is whatever remains after this fee.
3. [swaps/swaps\_service.go:1483–1485](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1483-L1485)
   getFeeRate is purely boltzApi.GetFeeEstimation; the hub never consults its own node or chain backend and applies no clamp.
4. [swaps/swaps\_service.go:853–864](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L853-L864)
   With enableRetries (automatic refunds) a cooperative failure loops forever every 30s on the same stale provider-reported timeout; with manual refunds (enableRetries=false) or a non-cooperative failure the function returns the error and the caller marks the swap FAILED.
5. [swaps/swaps\_service.go:1109–1115](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1109-L1115)
   The swap-in listener calls RefundSwap(swapId, "", true) automatically on Boltz-reported failure statuses (transaction.lockupFailed, invoice.failedToPay, swap.expired), so the provider can itself trigger the refund path with no operator interaction.
6. [swaps/swaps\_service.go:764–766](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L764-L766)
   The verified local timeout: tree.Check binds swap.TimeoutBlockHeight (stored at creation, line 545) to the CLTV leaf of the tree whose address was paid. This is the value the refund should use but does not.
7. [swaps/swaps\_service.go:1369–1376](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1369-L1376)
   Legacy swap-out claims (ReceiveAmountSat == 0) use the same unbounded Boltz fee rate as SatsPerVbyte.

## Impact
Fee-rate manipulation makes the hub sign and hand to the provider a refund that burns most or all of the locked amount as miner fee (irrecoverable loss of the hub's on-chain funds: integrity HIGH). Timeout manipulation leaves the locked funds unrecoverable through the hub's automatic and manual refund paths until the operator exports the swap mnemonic and recovers out of band (availability LOW). No confidentiality impact.

## Reproduction steps
1. Attacker is the swap provider (operator of the configured BOLTZ_API host or the Alby-selected provider) or whoever controls its responses to GetSwapTransaction and GetFeeEstimation. A swap-in must be in flight with that provider; the provider itself can then fail it (invoice.failedToPay / swap.expired over the websocket) to trigger the automatic refund with no operator interaction, or wait for the operator's manual refund. The hub then builds and signs the refund from the attacker's timeout and fee rate deterministically. Depends on boltz-client v2.12.5 ConstructTransaction using OutputDetails.TimeoutBlockHeight as nLockTime and SatsPerVbyte unclamped (stated assumption).

## Recommended fix
1. Refund uses the provider-reported TimeoutBlockHeight fetched at refund time instead of the locally stored value that was verified against the swap tree. Fix criteria: Decide cooperative vs script-path and set the refund nLockTime from swap.TimeoutBlockHeight (verified by tree.Check); a provider-reported timeout must not influence the refund. Once the local timeout has passed, attempt the script-path refund regardless of the provider's cooperation, and do not let the retry loop depend on a stale provider value.
2. Refund (and legacy claim) fee rate is taken unbounded from the provider. Fix criteria: Obtain fee estimates from the hub's own node or chain backend, or clamp provider estimates to a sane maximum (and minimum), and refuse to sign a refund or claim whose absolute fee exceeds a bounded fraction of the input value.
3. Refund broadcast depends solely on the provider. Fix criteria: Broadcast refund transactions through the hub's own node or chain backend (the existing TODO), so a provider that refuses to relay cannot block a valid unilateral refund.

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
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256442

---

# Swap-out reveals preimage on provider-supplied lockup data with claim fee derived from unverified amount

## Details
In a reverse (Lightning to on-chain) swap the hub pays the provider's hold invoice first and is made whole only by claiming the on-chain lockup; the preimage is the hub's sole leverage, because the provider settles the hold invoice the moment it learns a valid preimage. The claim path in startSwapOutListener decides to reveal the preimage based entirely on data the provider supplies, with no verification against what the hub asked for or against the chain.

On a TransactionMempool or TransactionConfirmed websocket update (swaps/swaps_service.go:1299) the hub parses update.Transaction.Hex straight from the provider's message (1326), locates the lockup vout (1335) and computes the claim fee as feeSat := lockupAmountSat - swap.ReceiveAmountSat (1366). SwapOut requested OnchainAmount = amountSat + MinerFees.Claim (357) and stored ReceiveAmountSat = amountSat (323), but the response's OnchainAmount is never stored and the actual lockup value is never compared to the request; feeSat has no minimum or maximum and the uint64 subtraction underflows when the lockup is below ReceiveAmountSat. It then calls boltz.ConstructTransaction with Cooperative: true and the preimage in OutputDetails (1343-1379). Under boltz-client v2.12.5 (go.mod:248; stated as an assumption, not verified in-tree) a cooperative reverse-swap claim posts the preimage, public nonce and unsigned transaction to the provider's claim endpoint to obtain its MuSig2 partial signature, and Fee.Sats is applied as an absolute fee without a floor. The claim is afterwards broadcast only through the provider's API (1402, with the in-code TODO 'to avoid trusting boltz'); no independent chain lookup, confirmation requirement or fee bound exists anywhere on this path, and a lockup seen only in the mempool (0-conf) is treated identically to a confirmed one.

Consequently the provider controls whether the claim the hub signs can ever confirm: a lockup of amountSat + 1 yields a 1-sat absolute fee (unrelayable); a lockup hex that is never actually broadcast yields a claim spending a non-existent output; a lockup below amountSat underflows the fee. In every case the hub has already handed over the preimage (or ends the swap FAILED after paying), and after TimeoutBlockHeight the provider refunds the lockup to itself. The reference boltz-client nursery, by contrast, rejects a lockup whose value is below the expected onchain amount before claiming. Only verifySwapOutInvoice and calculateMaxSwapOutSendAmountSat are unit-tested; the claim path has no tests.

This path is reached on every manual swap-out and, with auto swap-out enabled, hourly without any operator action (lines 212-246).

## Evidence
1. [swaps/swaps\_service.go:1357–1378](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1357-L1378)
   feeSat = lockupAmountSat - swap.ReceiveAmountSat takes the provider-supplied lockup output value as-is: no comparison with the requested OnchainAmount, no minimum or maximum fee, uint64 underflow when the lockup is below ReceiveAmountSat. This is where the amount check and fee bound must be enforced before the preimage leaves the hub.
2. [swaps/swaps\_service.go:1343–1385](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1343-L1385)
   OutputDetails carries the preimage with Cooperative: true into boltz.ConstructTransaction; under boltz-client v2.12.5 (assumption) this posts the preimage to the provider's claim endpoint, at which point the hold invoice becomes settleable whether or not the resulting claim can confirm.
3. [swaps/swaps\_service.go:1299–1341](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1299-L1341)
   The lockup transaction is reconstructed from update.Transaction.Hex in the provider's websocket message and acted upon on TransactionMempool (0-conf) as well as TransactionConfirmed; no chain backend is consulted to confirm the output exists.
4. [swaps/swaps\_service.go:320–357](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L320-L357)
   The hub records ReceiveAmountSat = amountSat and requests OnchainAmount = amountSat + MinerFees.Claim, so the expected lockup value is known at creation but neither the response's OnchainAmount nor the actual lockup is ever checked against it.
5. [swaps/swaps\_service.go:1400–1402](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1400-L1402)
   The signed claim is broadcast only through the provider's API (TODO acknowledges this trusts boltz), so a provider that has already received the preimage also controls whether the claim is ever relayed.
6. [swaps/swaps\_service.go:212–245](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L212-L245)
   Auto swap-out invokes SwapOut hourly with no operator interaction, so the claim path is exercised repeatedly without a human in the loop.

## Impact
Theft of the full swap amount (Lightning funds paid out, nothing claimable on-chain) per swap, repeatable every hour under auto-swap; the hub's ledger records a pending/failed swap it cannot recover through any shipped code path. No confidentiality impact; no service availability impact.

## Reproduction steps
1. Attacker: the selected swap provider (Boltz or SatsRouting, chosen by Alby's GetInfo, or a compromised/impersonated one), a remote party the threat model names. It accepts the hub's reverse swap and receives the hold-invoice HTLC. It then pushes a TransactionMempool update whose tx hex either locks amountSat+1 (claim built with a 1-sat fee), is never broadcast, or locks below amountSat. The hub's own code computes the fee, builds the cooperative claim and sends the preimage to the provider, which settles the invoice; the claim cannot confirm and the provider refunds the lockup after timeout. Deterministic, network-only, no privileges on the hub; requires a swap-out in progress, which auto-swap performs hourly unattended.

## Recommended fix
1. The claim fee is derived by subtracting the expected receive amount from a provider-chosen lockup value, with no check that the lockup covers the requested OnchainAmount and no bounds on the result, so a short lockup produces a dust or underflowed fee while the preimage is still revealed cooperatively. Fix criteria: Before any cooperative claim request, the lockup output value must be verified to be at least the requested OnchainAmount (amountSat + quoted claim fee) and the claim fee must be bounded between a relayable minimum and a sane maximum derived from a fee-rate estimate, not from the provider's lockup value alone. A lockup that is too small, or a fee outside those bounds, must abort the claim before the preimage leaves the hub; a test feeding a lockup of ReceiveAmountSat+1 and one below ReceiveAmountSat must not reach ConstructTransaction.
2. The lockup transaction is taken from the provider's websocket message and acted on at 0-conf; the hub never confirms through its own chain backend that the output exists (and is confirmed) before revealing the preimage. Fix criteria: The lockup txid/output must be verified against the hub's own chain source (and required to be confirmed, or the preimage withheld until it is) before the preimage is sent to the provider or placed in a claim witness; a fabricated or unbroadcast lockup hex must not cause a preimage reveal.

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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256403

---

# Env-supplied LND macaroon and phoenixd password persisted unencrypted in user_configs

## Details
Alby Hub's documented storage contract (README "Encryption": sensitive data is "saved AES-encrypted by the user's unlock password ... and always requires the user's unlock password to access") is implemented for remote-node credentials by the UI/`Setup` path, which stores `LNDMacaroonHex` and `PhoenixdAuthorization` with `SetUpdate(key, value, setupRequest.UnlockPassword)`. The environment-variable configuration path does not: `config.init()` (run from `NewConfig` on every process start) reads the file named by `LND_MACAROON_FILE` (the README says this is LND's `admin.macaroon`) and the `PHOENIXD_AUTHORIZATION` value and writes them with `cfg.SetUpdate(key, value, "")`. With an empty encryption key `set()` skips AES-GCM and stores the row with `Encrypted=false`, i.e. the hex-encoded admin macaroon / phoenixd HTTP password sits in cleartext in the `user_configs` table of `nwc.db` (or Postgres).

Three properties make this persistent rather than transient: (1) `SetUpdate` uses ON CONFLICT DO UPDATE on `value` and `encrypted`, so a row the operator previously stored encrypted through the UI is downgraded to cleartext as soon as the env var is present; (2) `cfg.get()` returns an unencrypted row verbatim even when a password is supplied, so `launchLNBackend`'s `Get("LNDMacaroonHex", encryptionKey)` works silently and nothing detects or repairs the downgrade; (3) `ChangeUnlockPassword` only re-encrypts rows `WHERE encrypted = true`, and nothing deletes the row when the env var is later removed, so the cleartext copy outlives the configuration that created it.

The practical gain is largest for LND: `admin.macaroon` normally lives in LND's own directory (typically 0600, owned by the lnd user), whereas the hub copies it into `WORK_DIR` (created with `os.ModePerm`, DB file created with the SQLite driver's default mode) — a location the README tells users to back up and that other local accounts or a snapshot/volume holder may read. For phoenixd the shipped scripts (`scripts/linux-x86_64/phoenixd/*`) already keep the password in plaintext in `phoenix.conf` and in the compose/render manifests, so the hub DB is an additional plaintext copy rather than the only one. The hub's own backup/migration archive is not a vector: `CreateBackup` encrypts it with the unlock password (api/backup.go:218).

Reachable only when the backend is configured via env (LND or phoenixd), which the README documents for LND and the phoenixd deployment scripts use; the default LDK backend is unaffected.

## Evidence
1. [config/config.go:89–113](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/config.go#L89-L113)
   config.init() (called from NewConfig on every start) reads LND_MACAROON_FILE and PHOENIXD_AUTHORIZATION and persists them with SetUpdate(key, value, "") - an empty encryption key - so the rows are stored with Encrypted=false in cleartext, overwriting any previously encrypted row via ON CONFLICT DO UPDATE (value, encrypted).
2. [config/config.go:269–308](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/config.go#L269-L308)
   set() only encrypts when encryptionKey != "" and flags Encrypted accordingly; get() returns a row verbatim whenever Encrypted is false even if a password is supplied, so the encrypted-read path in start.go silently accepts cleartext and nothing detects the downgrade.
3. [config/config.go:336–369](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/config.go#L336-L369)
   ChangeUnlockPassword selects only Encrypted=true rows for re-encryption, so the cleartext credential rows are never migrated to encrypted form; nothing else deletes them when the env var is removed.
4. [service/start.go:403–433](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L403-L433)
   launchLNBackend reads LNDMacaroonHex / PhoenixdAuthorization with the unlock password as encryption key - the design intent is password-encrypted storage; the env path contradicts it and the read still succeeds because get() passes cleartext through.
5. [api/api.go:1832–1864](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L1832-L1864)
   The UI/setup path stores the same keys encrypted with setupRequest.UnlockPassword - the sibling implementation that shows the env path is the inconsistent one and that encryption of these values is the intended contract.
6. [README.md:653–655](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/README.md#L653-L655)
   The project's documented storage promise: sensitive data is AES-encrypted by the unlock password and "always requires the user's unlock password to access".
7. [README.md:243–252](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/README.md#L243-L252)
   LND configuration via LN_BACKEND_TYPE / LND_MACAROON_FILE (admin.macaroon) is the documented production configuration path for LND users.
8. [scripts/linux-x86\_64/phoenixd/docker-compose.yml:16–20](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-x86_64/phoenixd/docker-compose.yml#L16-L20)
   Shipped phoenixd deployment passes PHOENIXD_AUTHORIZATION via env, so these deployments exercise the cleartext path (the same password is also plaintext in phoenix.conf in the shared volume, so the gain for phoenixd is an additional copy).

## Impact
The backend credential the hub promises to keep encrypted is fully disclosed to a DB reader lacking the unlock password. Through it the attacker can read the hub's wallet state and transaction history on the backend and spend the funds the hub manages, defeating the encryption-at-rest boundary; the hub process itself is not disrupted. Subsequent-system impact: The disclosed value is LND's admin macaroon or phoenixd's HTTP password - full administrative control of a separate node: read all channel/payment data, send all funds, close channels or stop the daemon.

## Reproduction steps
1. Attacker: anyone who can read the hub database or a copy of it without knowing the unlock password - another local account on the host, the holder of a WORK_DIR backup or volume snapshot. No interaction with the running hub: open nwc.db, SELECT value FROM user_configs WHERE key IN ('LNDAddress','LNDCertHex','LNDMacaroonHex') (all cleartext on this path), hex-decode, connect to LND gRPC and issue SendPayment/SendCoins/StopDaemon; or use PhoenixdAuthorization against phoenixd. Requires the deployment to configure the backend via env (documented LND path, phoenixd scripts) rather than the default LDK backend.

## Recommended fix
1. config.init() persists secrets taken from the environment with an empty encryption key, so they are stored as Encrypted=false cleartext rows, violating the encrypted-at-rest property the UI path upholds. Fix criteria: Env-sourced LND macaroon and phoenixd authorization must never be stored unencrypted: either keep them only in memory / re-read from the referenced file at start, or write them under the unlock password once it is available (and refuse to store before that). Verify by configuring LND/phoenixd via env, starting the hub, and confirming user_configs holds no cleartext LNDMacaroonHex/PhoenixdAuthorization row (encrypted=true or absent).
2. cfg.get() silently returns cleartext when a password is supplied but the row is unencrypted, hiding the downgrade from callers that expect encrypted data. Fix criteria: Reads of credential keys performed with a non-empty encryption key should fail or log loudly when the stored row is unencrypted, and ChangeUnlockPassword / startup should migrate any such row to encrypted form. Verify with a DB containing a plaintext LNDMacaroonHex row: after unlock it is re-encrypted or startup refuses.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cleartext storage of sensitive information
**CWE:** [CWE-312](https://cwe.mitre.org/data/definitions/312.html)
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
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256394

---

# Unauthenticated, state-less Alby OAuth callback lets any network peer bind or clobber the hub's Alby account

## Details
GET /api/alby/callback?code=... is registered directly on the Echo instance (http/alby_http_service.go:32), outside both JWT groups, and the handler (lines 124-149) hands the query parameter straight to albyOAuthSvc.CallbackHandler. The authorization URL the hub produces uses a constant state (`AuthCodeURL("unused")`, alby/alby_oauth_service.go:521) and the callback checks no state, nonce, PKCE verifier or JWT. With the default client the redirect URI is https://getalby.com/hub/callback and the SPA's own flow has the operator copy the code shown there and GET it to the hub (frontend/src/components/AuthCodeForm.tsx:46). Because the default client id/secret are public constants (config/models.go:51-52), an attacker performs the same getalby.com login for *their own* account, copies the fresh code, and delivers `http://<hub>:<port>/api/alby/callback?code=<code>` to the victim hub — directly from the LAN/VPN, or as a cross-origin GET (<img>/navigation) from any page the operator visits; the hub requires no credential so the browser's lack of CORS consent is irrelevant.

CallbackHandler (lines 102-152) then: (1) exchanges the code with the hub's client credentials; (2) overwrites the stored refresh token, access token and expiry with the attacker's (saveToken, lines 196-210) *before* any identity comparison; (3) fetches /internal/users and stores the attacker's lightning address (GetMe, line 511); (4) if no AlbyUserIdentifier was ever stored (hub never linked, or unlinked via /api/alby/unlink-account), persists the attacker's identifier and publishes nwc_alby_account_connected.

Impact on an unlinked hub: the attacker's account becomes the hub's trusted Alby account. /api/info reports albyAccountConnected=true; the SPA renders the attacker's lightning address as the operator's receive QR/address (frontend/src/components/ReceiveToLightning.tsx:37-52), so payments the operator solicits land in the attacker's account; LDK reacts to nwc_alby_account_connected by uploading a static channel backup (lnclient/ldk/ldk.go:2753-2755) and ConsumeEvent (alby_oauth_service.go:618-787) streams whitelisted events — payment hashes, app create/update/delete, channel ready/closed, node_started with node_id and network as global properties — to the attacker's account because SEND_EVENTS_TO_ALBY defaults to true; a later operator-initiated POST /api/alby/link-account would create a budgeted, full-scope NWC connection on the attacker's account.

Impact on an already linked hub: step (2) has already replaced the legitimate tokens; the identifier mismatch at line 142 blanks only the access token, so fetchUserToken returns nil, IsConnected is false, the SPA redirects the operator to /alby/auth, and service/start.go:319 refuses to start the node ("alby account is not authenticated") on the next restart until the operator re-authenticates; Alby-backed features (channel backup upload, lightning address management, LSP/auto-channel) fail meanwhile. One unauthenticated request achieves this, it persists in the database, the handler is reachable before setup completes and while locked, and it is not covered by the unlock rate limiter. The threat model lists /api/alby/callback as an unauthenticated endpoint and network-adjacent and web attackers as in scope; the sanctioned paths that change the Alby link (/api/alby/link-account, /api/alby/unlink-account) require a full-access JWT.

## Evidence
1. [http/alby\_http\_service.go:124–149](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/alby_http_service.go#L124-L149)
   albyCallbackHandler takes `code` from the query string and passes it straight to CallbackHandler; no JWT, state, nonce or PKCE check anywhere in the handler.
2. [http/alby\_http\_service.go:32](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/alby_http_service.go#L32)
   Route is registered on the bare Echo instance, outside the readonly and full-access JWT groups, so it is reachable unauthenticated, pre-setup and while locked.
3. [alby/alby\_oauth\_service.go:102–152](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_oauth_service.go#L102-L152)
   CallbackHandler exchanges the code, persists the new tokens (saveTokenWithRetries) before any identity comparison, binds AlbyUserIdentifier on first login and publishes nwc_alby_account_connected; on identifier mismatch it blanks only the access token, leaving the hub linked but credential-less.
4. [alby/alby\_oauth\_service.go:520–522](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_oauth_service.go#L520-L522)
   GetAuthUrl builds the authorization URL with the constant state "unused"; the auth URL is also served to unauthenticated callers via /api/info, so no server-side state could distinguish an operator-started flow.
5. [alby/alby\_oauth\_service.go:196–210](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_oauth_service.go#L196-L210)
   saveToken unconditionally replaces refresh token, access token and expiry in user_configs.
6. [config/models.go:51–52](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/models.go#L51-L52)
   Default OAuth client id and secret are public constants shared by every hub, so a code minted by the attacker for their own account against this client is accepted by the token endpoint when any hub exchanges it.
7. [frontend/src/components/AuthCodeForm.tsx:46–50](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/AuthCodeForm.tsx#L46-L50)
   The project's own flow: the operator logs in at getalby.com, copies the code displayed at https://getalby.com/hub/callback, and the SPA issues GET /api/alby/callback?code=... — the attacker performs exactly this with their own account and sends the code to the victim hub instead.
8. [service/start.go:314–321](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L314-L321)
   With an AlbyUserIdentifier stored but no usable token (IsConnected false), startAppInternal refuses to start the node, so the clobbering variant blocks node (re)start until the operator re-authenticates.
9. [alby/alby\_oauth\_service.go:618–661](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_oauth_service.go#L618-L661)
   ConsumeEvent posts whitelisted events (payment hashes, app lifecycle, channel/node events with node_id global property) and encrypted channel backups to api.getalby.com under whatever token is stored — the attacker's account once bound; SEND_EVENTS_TO_ALBY defaults to true.
10. [lnclient/ldk/ldk.go:2752–2757](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L2752-L2757)
   On nwc_alby_account_connected (published by the callback on first binding) LDK immediately publishes a static channel backup, which ConsumeEvent uploads to the newly bound (attacker's) account.
11. [frontend/src/components/ReceiveToLightning.tsx:37–52](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/ReceiveToLightning.tsx#L37-L52)
   When albyAccountConnected is true the Receive screen renders the linked account's lightning address (from /api/alby/me) as the operator's receive QR code and copyable address.

## Impact
Integrity HIGH: the hub's stored Alby credentials, account identifier and lightning address are replaced with attacker-controlled values; the UI then advertises the attacker's lightning address as the operator's receive address, channel backups and events are sent to the attacker's account, and a later link-account would hand the attacker a budgeted NWC connection — a limited set of records whose malicious modification has direct, serious consequences. Confidentiality LOW: payment hashes, app lifecycle, channel events, node_id/network and encrypted SCB blobs are streamed to the attacker's account (SEND_EVENTS_TO_ALBY defaults to true). Availability LOW: on a linked hub the node refuses to (re)start and the SPA is forced to re-auth until the operator re-authenticates; repeatable at will.

## Reproduction steps
1. Attacker on the hub's LAN/VPN, or any web page the operator visits, performs the getalby.com login for the attacker's own account using the hardcoded default client id, copies the code displayed at getalby.com/hub/callback and issues GET http://hub:8080/api/alby/callback?code=... (directly, or as a cross-origin image/navigation from the operator's browser). No hub credential, token, state or operator action is required; the code is fresh because the attacker mints it seconds before. The clobbering variant works against every hub; the account-binding variant additionally needs the hub to have no stored AlbyUserIdentifier (never linked or unlinked). Assumption: golang.org/x/oauth2 v0.37.0 Config.Exchange posts grant_type=authorization_code, code and redirect_uri with the client credentials, and getalby.com's token endpoint — standard OAuth 2.0 — accepts any unexpired code issued to client J2PbXS1yOf for redirect https://getalby.com/hub/callback regardless of which hub exchanges it.

## Recommended fix
1. The OAuth callback is a state-changing operation reachable without any hub authentication, so any network peer or cross-origin page can drive account linking or credential replacement. Fix criteria: Changing the stored Alby credentials or identifier is only possible from an authenticated operator session (full-access JWT, or the in-progress setup session before a password exists), submitted as a non-simple request (e.g. authenticated POST) so a cross-origin GET cannot trigger it; an unauthenticated GET /api/alby/callback must not modify stored credentials.
2. The authorization code is not bound to a request the operator initiated: the state parameter is a constant and the auth URL is handed out via the unauthenticated /api/info. Fix criteria: Each authorization request carries an unpredictable, single-use state (and ideally PKCE) that is issued only to the authenticated session and verified on callback; a code minted by a third party for their own account is rejected before any token exchange.
3. Tokens are persisted before the account identity is compared, so a mismatched account still destroys the legitimate credentials and blocks node start. Fix criteria: Identity is verified before any stored token is replaced; on mismatch the previously stored refresh/access tokens remain intact and the node can still start.

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
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256391

---

# get_info panics on non-string lud16 app metadata, crashing the whole hub process

## Details
HandleGetInfoEvent (nip47/controllers/get_info_controller.go:62-64) rebuilds the app's metadata from the stored JSON and, when the app is isolated and the metadata contains `app_store_app_id: "uncle-jim"` and a non-nil `lud16`, does `lightningAddress := metadata["lud16"].(string)` with no comma-ok check. encoding/json decodes `"lud16": 1` as float64, `true` as bool, `{}` as map[string]interface{}, so the assertion panics.

The metadata is authored by a NIP-47 client: an app holding the `superuser` scope sends `create_connection` with `isolated: true`, `request_methods: ["get_info"]`, a `pubkey` it controls and `metadata: {"app_store_app_id": "uncle-jim", "lud16": 1}`. createConnectionParams.Metadata is `map[string]interface{}` (create_connection_controller.go:26), the controller forwards it to CreateApp unvalidated (line 135), and CreateApp marshals it verbatim into apps.metadata (apps/apps_service.go:101-125). The attacker then sends `get_info` signed by the new connection's key. get_info is always granted (nip47/event_handler.go:335, permissions.GetAlwaysGrantedMethods), so no scope or expiry check stands before the controller. HandleEvent runs in `go svc.nip47Service.HandleEvent(...)` (service/start.go:239) with no deferred recover; the only recover() calls in the tree are inside alby/, lnclient/lnd, lnclient/ldk and lnclient/cln helpers on other goroutines, and cmd/http/main.go and main_wails.go install none. An unrecovered panic in a goroutine terminates the Go process: the HTTP API, the relay subscriptions and the embedded LDK node all go down. The crafted app persists in the DB, so after a supervisor restart (systemd `Restart=always` in scripts/*/install.sh) the attacker repeats the crash with a fresh get_info event. The desktop (Wails) build reaches the same path via service.NewService → startNostr.

The same unchecked assertion exists in api.DeleteLightningAddress (api/api.go:415) but that path is operator-only and covered by Echo's Recover middleware; the NWC path is the unprotected one. The HTTP CreateApp/UpdateApp paths also store arbitrary metadata, but that is the operator's own trusted input.

Preconditions: the attacker holds a superuser app connection (PR HIGH; the operator creates it with the unlock password, api/api.go:78). The project concedes to that scope only the ability to create other app connections (frontend/src/types.ts:103); crashing the Lightning node is outside that grant and reachable through a deterministic, repeatable request.

## Evidence
1. [nip47/controllers/get\_info\_controller.go:62–64](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/get_info_controller.go#L62-L64)
   For an isolated app whose stored metadata has app_store_app_id == "uncle-jim" and a non-nil lud16, line 63 does `metadata["lud16"].(string)` as a single-value type assertion; when the stored JSON value is a number (float64), bool, object or array the assertion panics. This is the line the fix must change.
2. [nip47/controllers/create\_connection\_controller.go:17–26](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/create_connection_controller.go#L17-L26)
   createConnectionParams.Metadata is map[string]interface{} decoded straight from the NWC request; any JSON value is accepted for lud16.
3. [nip47/controllers/create\_connection\_controller.go:135](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/create_connection_controller.go#L135)
   The attacker-supplied metadata and isolated flag are passed to CreateApp without validation.
4. [apps/apps\_service.go:101–124](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/apps/apps_service.go#L101-L124)
   CreateApp marshals the metadata map verbatim into apps.metadata; no schema check on lud16 or app_store_app_id.
5. [service/start.go:235–240](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L235-L240)
   Each request is handled in `go svc.nip47Service.HandleEvent(...)` with no deferred recover; a panic in the goroutine terminates the entire Go process (HTTP server and embedded LDK node included).
6. [nip47/event\_handler.go:335](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/event_handler.go#L335)
   get_info is an always-granted method: the created app needs no scope and no valid expiry to reach the panic.

## Impact
The whole hub process terminates: Lightning node offline, all NWC apps unserved, HTTP API down, repeatable on each restart. Availability HIGH. No confidentiality or integrity impact from the crash itself.

## Reproduction steps
1. Attacker holds a superuser NWC connection (or has compromised one, e.g. a stolen Alby Go pairing secret). One create_connection request with crafted metadata, then one get_info request from the new key, both over the relay. The panic is deterministic; no race, no user interaction. Requires an existing superuser grant, so privileges are HIGH.

## Recommended fix
1. Unchecked interface type assertion on attacker-influenced JSON metadata in the get_info controller. Fix criteria: A non-string or malformed lud16 value must produce a normal (error or omitted-field) response, never a panic; verify get_info on an app with lud16 set to a number/object returns a response.
2. create_connection stores arbitrary metadata, including keys (app_store_app_id, lud16) that other code treats as trusted, typed values. Fix criteria: Metadata supplied over NWC must be validated (or reserved keys rejected/normalised) before storage so stored metadata always satisfies the type expectations of its consumers.
3. NIP-47 request handling goroutines have no panic recovery, so any handler bug becomes a full-process crash. Fix criteria: A panic while handling a single NWC request must be contained to that request (logged, request marked error) and must not terminate the process.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-704](https://cwe.mitre.org/data/definitions/704.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256382

---

# Budget check truncates sat amounts to 32-bit int on shipped armv6 build, letting a self-payment wrap budget usage negative

## Details
validateCanPay enforces an app's spending budget with `int(amountWithFeeReserveMsat/1000) > appPermission.MaxAmountSat-int(budgetUsageMsat/1000)` (transactions/transactions_service.go:1200). This is the only payment-time enforcement of MaxAmountSat in the tree (line 1694 only emits an nwc_budget_warning event; api/api.go and nip47/controllers/get_budget_controller.go only display usage). Both operands are uint64 millisat values divided to sats and converted to Go `int`; AppPermission.MaxAmountSat is itself declared `int` (db/models.go:37). The hub is released for 32-bit ARM: .github/workflows/http.yml builds albyhub-Server-Linux-armv6 with GOOS=linux GOARCH=arm GOARM=6, release.yaml calls that workflow and create-release.yaml attaches every albyhub-Server-* tarball to the GitHub release, and scripts/pi-arm/install.sh (the README's Raspberry Pi Zero quick start) installs server-linux-armv6.tar.bz2 as the systemd service. On GOARCH=arm `int` is 32 bits, so the conversion keeps the low 32 bits: any sat value in [2^31, 2^32) becomes negative and values in [2^32, 2^32+2^31) become small positives.

A NIP-47 app connection N that is non-isolated with a budget (MaxAmountSat > 0) and holds make_invoice + pay_invoice bypasses the budget entirely:
1. N calls make_invoice for 3,221,225,472,000 msat (3,221,225,472 sats, ~32 BTC). MakeInvoice checks only >= 1 sat and whole sats (177-182). The default LDK client (lnclient/ldk/ldk.go:830-882) compares the amount with getMaxReceivable() only to publish an informational nwc_incoming_liquidity_required event; with LDK_LSPS2_ADDRESSES unset (no default in config/models.go:41) isJitInvoice is false and the invoice is issued with Bolt11Payment().Receive regardless of channel capacity (assumption: ldk-node's receive does not cap by capacity; rust-lightning's inbound limit is 21M BTC). The incoming PENDING row is stored with its preimage.
2. N calls pay_invoice on that bolt11. SendPaymentSync finds the incoming row with the same hash and payment request, so selfPayment = true (334-348) and amountWithFeeReserveMsat equals the invoice amount (1140-1145). N is not isolated, so no balance check runs; the budget check computes int(3221225472) = -1073741824 and `-1073741824 > B - usage` is false for every budget B, so the payment is allowed and an outgoing PENDING row is inserted (FeeReserveMsat 3.22e10 msat; fine on the default SQLite database, DATABASE_URI default nwc.db — on Postgres fee_reserve_msat is still a 4-byte integer, only amount_msat was widened by 202508041737_postgres_amount_bigint, so the insert fails there). interceptSelfPayment (1062-1100) settles the incoming row and returns the preimage without touching the Lightning backend; markTransactionSettled (1479) marks the outgoing row SETTLED with FeeReserveMsat 0. No funds move (N pays itself).
3. GetBudgetUsageMsat (db/queries/get_budget_usage.go:11-22) sums amount_msat+fee_msat+fee_reserve_msat over PENDING+SETTLED outgoing rows in the window and now returns 3.22e12 msat; at every later payment int(budgetUsageMsat/1000) = -1073741824 and the remaining budget becomes B + 1,073,741,824 sats (no int32 overflow for any B <= 1,073,741,823). N then pays arbitrary external invoices with real funds from the operator's main wallet, limited only by liquidity, until the budget window renews (forever for renewal "never"), and can repeat the self-payment each window.

Variant: with an amount in [2^32, 2^32+2^31) sats the per-payment term truncates to a small positive number, so a budgeted app can also pay a ~42.9 BTC invoice issued by an isolated sub-wallet it controls (or attributed to it via metadata.app_id, see nip47-make-invoice-metadata-app-id-override), crediting that sub-wallet with a fabricated isolated balance (the isolated-balance check itself is int64 and unaffected).

The existing dismissals at this line (dismissed-transactions-service-1200-c498, e5-03) considered only uint64 values with the high bit set, which database/sql rejects; this path uses ordinary values that SQLite stores. The guarantee TestSendPaymentSync_App_BudgetExceeded encodes is void on the shipped 32-bit build.

## Evidence
1. [transactions/transactions\_service.go:1195–1215](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1195-L1215)
   The only budget enforcement: `int(amountWithFeeReserveMsat/1000) > appPermission.MaxAmountSat-int(budgetUsageMsat/1000)`. Both uint64 sat values are converted to Go `int`, which is 32 bits on GOARCH=arm. A payment of 3,221,225,472 sats converts to -1,073,741,824 and passes against any budget; once that row is SETTLED the window's usage converts to the same negative number and `MaxAmountSat - (-1073741824)` makes every later real payment pass.
2. [.github/workflows/http.yml:36–40](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/.github/workflows/http.yml#L36-L40)
   The release matrix builds an `armv6` server package (albyhub-Server-Linux-armv6).
3. [.github/workflows/http.yml:106–114](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/.github/workflows/http.yml#L106-L114)
   That package is compiled with GOOS=linux GOARCH=arm GOARM=6, on which `int` and `uint` are 32-bit.
4. [scripts/pi-arm/install.sh:15](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/pi-arm/install.sh#L15)
   The user-run installer the README points Raspberry Pi users to downloads server-linux-armv6.tar.bz2 and installs it as the hub service, so the 32-bit binary is a shipped production artifact.
5. [transactions/transactions\_service.go:334–347](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L334-L347)
   A payment of an invoice the hub itself issued is detected as a self-payment; the payer only needs make_invoice + pay_invoice on one connection to produce such an invoice and pay it.
6. [transactions/transactions\_service.go:1140–1144](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1140-L1144)
   For self-payments amountWithFeeReserveMsat is exactly the invoice amount, so the attacker controls the value fed to the truncating cast to the sat.
7. [transactions/transactions\_service.go:1062–1099](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1062-L1099)
   interceptSelfPayment settles the incoming and (via the caller) the outgoing row without touching the Lightning backend, so a 32 BTC self-payment needs no liquidity and always succeeds, leaving a SETTLED outgoing row of 3.22e12 msat in the budget window.
8. [db/queries/get\_budget\_usage.go:11–21](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/queries/get_budget_usage.go#L11-L21)
   Budget usage is SUM(amount_msat+fee_msat+fee_reserve_msat) over PENDING+SETTLED outgoing rows in the window, returned as uint64; the self-payment row is included and is what gets truncated at the check.
9. [transactions/transactions\_service.go:177–181](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L177-L181)
   MakeInvoice enforces only >= 1 sat and whole sats; there is no upper bound on the amount an app may request.
10. [lnclient/ldk/ldk.go:830–881](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L830-L881)
   On the default LDK backend an amount above max receivable only publishes an nwc_incoming_liquidity_required event; with LDK_LSPS2_ADDRESSES unset (no default, config/models.go:41) isJitInvoice is false and the invoice is created with Bolt11Payment().Receive, so a 32 BTC invoice is issued regardless of channel capacity (assumption: ldk-node receive() does not cap by capacity).
11. [db/models.go:32–41](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/models.go#L32-L41)
   AppPermission.MaxAmountSat is declared as platform `int`, which is why the check is written in `int` arithmetic rather than int64/uint64.

## Impact
The per-app budget is the only control bounding a non-isolated connection's spending of the operator's main Lightning balance; after the wrap the app spends real funds up to node liquidity with the budget check always passing (integrity of funds and of the ledger's budget accounting). The variant that credits a controlled sub-wallet also fabricates isolated balance. No confidentiality impact; availability unaffected.

## Reproduction steps
1. Attacker is a NIP-47 app connection (threat-model adversary 1) holding the ordinary make_invoice + pay_invoice scopes on a non-isolated connection whose spending the operator bounded with a budget; requests arrive through the Nostr relay. Steps: make_invoice for ~32 BTC, pay_invoice on it (self-payment, settled without the Lightning backend, no liquidity needed, deterministic), then pay external invoices freely for the rest of the budget window. Deployment conditions of the vulnerable system: the hub runs the shipped armv6 (GOARCH=arm, 32-bit int) release artifact that scripts/pi-arm/install.sh installs, with the default SQLite database (Postgres rejects the 4-byte fee_reserve_msat insert) and a backend that issues the large invoice (the default LDK client does, with LSPS2 unset by default). No user interaction, no race.

## Recommended fix
1. Budget arithmetic in validateCanPay is performed in platform-width `int` (and AppPermission.MaxAmountSat is declared `int`), so on 32-bit builds sat amounts and usage sums are truncated and can become negative, defeating the comparison. Fix criteria: The budget comparison must be computed in a fixed 64-bit (or wider) type with explicit overflow handling, so that for every amount and usage the check `amount + usage <= MaxAmountSat` holds exactly on all GOARCH targets; a payment whose sat amount exceeds the remaining budget, and any payment once usage exceeds MaxAmountSat, must be rejected with QUOTA_EXCEEDED on the armv6 build as on 64-bit builds.
2. MakeInvoice accepts arbitrarily large amounts, which is what supplies the wrapping operand; self-payments of such invoices settle without any backend check. Fix criteria: Invoice creation and payment amounts should be bounded to a sane maximum (e.g. the Lightning protocol maximum or the node's receivable capacity) so that values near 2^31/2^32 sats cannot enter the ledger; verify that make_invoice for >= 2^31 sats is rejected or that paying it is refused by the budget check.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Numeric truncation
**CWE:** [CWE-197](https://cwe.mitre.org/data/definitions/197.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256541

---

# Malformed latestVersion from Alby API crashes the whole SPA via uncaught compare() exception

## Details
The update banner logic in `useBanner` (frontend/src/hooks/useBanner.tsx:27-30) evaluates `compare(info.version.substring(1), albyInfo.hub.latestVersion, ">=")` inside a `React.useEffect`. `albyInfo.hub.latestVersion` originates from Alby's remote API — `GET https://getalby.com/api/internal/info` (const `albyInternalAPIURL` at alby/alby_service.go:16), field `hub.latest_version` — which the Go side (`albyService.GetInfo`, alby/alby_service.go:182-260) decodes as a plain string and copies into the response with no format validation; `GET /api/alby/info` (http/alby_http_service.go:33,78-88, unauthenticated) and the Wails router case `GET /api/alby/info` (wails/wails_handlers.go:434-442) pass the struct straight to the SPA, where `useAlbyInfo` fetches it on every load (SWR, 5-minute dedupe, revalidate on focus). The frontend guards only `info.version` (truthy and starts with `v`); `latestVersion` is passed unvalidated and the call is not wrapped in try/catch.

Assumption (dependency behaviour, not verifiable in the checkout): `compare-versions` 6.1.1 (frontend/yarn.lock) throws `Error("Invalid argument not valid semver ('…' received)")` from `compare()` when either argument does not match its semver regular expression — this includes the empty string that results when the remote JSON omits `latest_version`, and values such as `"latest"` or `"v1.25 beta"`. In release builds `info.version` is `version.Tag` = the git tag (`vX.Y.Z`: CI uses `${{ github.ref_name }}` and strips `${tag#v}`), so the short-circuit guard does not skip the `compare` call.

The effect runs in `AppLayoutInner`, the layout element of the root route `/` (frontend/src/routes.tsx:97-100) that wraps every authenticated screen and the `HomeRedirect` index route. No `errorElement` or error boundary exists anywhere in frontend/src, and `main.tsx` calls `createRoot` without `onUncaughtError`, so React 19.2 unmounts the whole tree: the operator gets a blank page on `/`, `/home`, `/wallet`, `/settings`, etc.; `Unlock`/`Start` still render but every successful unlock routes to `/` and crashes again. `WhatsNewWidget` (frontend/src/components/home/widgets/WhatsNewWidget.tsx:26-29) performs the same unguarded compare during render on the Home screen — a second sink with the same root cause. The failure is deterministic and persists for as long as the remote returns the malformed value, on every hub that has not set `HIDE_UPDATE_BANNER=true` (default false, config/models.go:64), in both the HTTP and desktop builds.

Attacker: whoever controls the body of a 2xx response from `getalby.com/api/internal/info` (Alby itself, a compromise of Alby's API/CDN, or a defect in that API). The URL is a hard-coded `https://` constant, so a network MITM is excluded; the threat model lists the Alby API as a remote party whose responses the hub must validate ("hub ↔ Alby API (response validation)"). A failed request does not trigger this (the backend returns 500 / a Wails error, the frontend `request` helper throws and `albyInfo` stays undefined); only a successful response carrying a non-semver string does. What the project concedes to this party is the display of release-notes text and an allow-listed swap-provider name; blanking the operator's whole management UI is beyond that.

Impact: availability of the operator's management UI across all Alby Hub deployments at once, until Alby corrects the value or each operator sets `HIDE_UPDATE_BANNER`. The Lightning node and NIP-47 service keep running; funds are not affected.

## Evidence
1. [frontend/src/hooks/useBanner.tsx:27–30](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/hooks/useBanner.tsx#L27-L30)
   Inside a React effect, compare(info.version.substring(1), albyInfo.hub.latestVersion, ">=") is called with albyInfo.hub.latestVersion taken verbatim from the /api/alby/info response. compare-versions (yarn.lock pins 6.1.1) throws `Invalid argument not valid semver` when either argument does not match its semver regex (including the empty string). Only info.version is guarded (Boolean + startsWith("v")); latestVersion is not validated and the call is not wrapped in try/catch.
2. [frontend/src/components/layouts/AppLayout.tsx:17–27](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/layouts/AppLayout.tsx#L17-L27)
   useBanner() runs in AppLayoutInner, the layout element of the root route (`/`) that wraps every authenticated screen and the HomeRedirect index route. An exception thrown from its effect unmounts the entire router tree.
3. [frontend/src/App.tsx:20–39](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/App.tsx#L20-L39)
   No error boundary exists above RouterProvider (routes.tsx defines no errorElement and main.tsx passes no onUncaughtError to createRoot), so React 19 unmounts the root on an uncaught effect error and the operator is left with a blank page on every route under AppLayout, including `/` itself.
4. [alby/alby\_service.go:182–260](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_service.go#L182-L260)
   GetInfo fetches https://getalby.com/api/internal/info (const albyInternalAPIURL, line 16), decodes `hub.latest_version` as a plain string and copies it into AlbyInfo without any format validation; a missing field becomes "" and any non-semver string is forwarded unchanged. Only non-2xx or undecodable responses are rejected.
5. [http/alby\_http\_service.go:78–88](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/alby_http_service.go#L78-L88)
   GET /api/alby/info (registered unauthenticated at line 33) is a plain pass-through of that struct to the SPA, which fetches it on every load via useAlbyInfo; wails/wails_handlers.go:434-442 is the equivalent desktop pass-through.
6. [frontend/src/components/home/widgets/WhatsNewWidget.tsx:26–29](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/home/widgets/WhatsNewWidget.tsx#L26-L29)
   Second sink with the same root cause: the Home screen widget calls compare() on the unvalidated latestVersion during render, with no try/catch and no boundary; it is reached only after AppLayout's effect, so the fix must cover both call sites.

## Impact
The operator's management UI becomes unusable on every route under AppLayout (including the post-unlock landing route), deterministically and for as long as the remote value stays malformed, across all deployments at once. The Go backend, the Lightning node and NIP-47 serving are unaffected and the condition is recoverable via HIDE_UPDATE_BANNER, so availability impact is LOW rather than HIGH. No confidentiality or integrity effect.

## Reproduction steps
1. The input is a single JSON field in a response from api.getalby.com, which the hub backend forwards to the SPA unvalidated. Anyone able to shape that response (Alby, or a compromise of its API/CDN) causes every hub that loads the UI to throw inside useBanner's effect, with no user action beyond opening the dashboard. No hub credentials are needed; the precondition is control of the third-party service, so Attack Requirements is PRESENT. AC is LOW: no defensive mechanism has to be defeated.

## Recommended fix
1. useBanner and WhatsNewWidget pass an unvalidated remote string into compare-versions, which throws on non-semver input, inside the root layout's effect and the Home render path with no error boundary; a single malformed third-party value unmounts the whole application. Fix criteria: A non-semver, empty or missing latestVersion must never throw out of useBanner or WhatsNewWidget: the comparison is guarded (validate/parse before compare, or catch and treat as 'up to date / unknown'), and the rest of the UI renders normally. Verify by serving /api/alby/info with hub.latestVersion set to "" and to "latest" and confirming every route under AppLayout, including /home, still renders.
2. The backend forwards getalby.com's latest_version to the SPA without validating its format, and the SPA has no error boundary around the router, so remote-data defects become whole-app outages. Fix criteria: Remote-sourced display data is validated at the backend boundary (reject or blank a non-semver latest_version) and the frontend wraps the router in an error boundary (or route errorElement) so a rendering exception in a non-critical widget cannot blank the operator's UI.

---
**Severity:** MEDIUM
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
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256470

---

# bip21 deep link lands on a pre-focused Confirm Payment button; one keypress pays attacker invoice

## Details
The HTTP build registers the SPA as the browser's `bitcoin:` protocol handler (useRegisterProtocolHandler.ts:25 -> /wallet/send?bip21=%s). A web attacker (threat-model adversary 3, which names this very entry) therefore controls `GET /wallet/send?bip21=bitcoin:?lightning=<attacker bolt11>` either through a bitcoin: link / JS navigation on their page or by linking directly to the hub's URL. Send.tsx:60-70 processes the parameter on mount with no operator action and, for a fixed-amount invoice, navigates to ConfirmPayment (Send.tsx:39-41). ConfirmPayment.tsx:134-142 renders the 'Confirm Payment' button with `autoFocus`, so as soon as the card mounts keyboard focus is on the control that sends the payment; an Enter keydown, or Space keydown+keyup, triggers confirmPayment -> POST /api/payments/{invoice} with the operator's full-access JWT, paying the attacker the amount encoded in the invoice (bounded only by the lightning balance; api/transactions.go:124 adds no further check). The attacker also controls the text displayed beside the button (the invoice description, ConfirmPayment.tsx:122-126); the amount is displayed and cannot be hidden.

The keypress is realistic in two ways. (1) Operator logged in: the attacker's page runs a 'hold Enter / Space to continue' interaction and, on the first keydown (a user activation), navigates to the bitcoin: URL or the hub URL; the hub tab takes focus, loads /api/info and /api/balances, mounts the focused button, and the OS key-repeat keydowns (or the eventual Space keyup after a repeated keydown) of the key the operator is still holding activate it. (2) Hub locked: DefaultRedirect.tsx:21-23 stores the deep link as returnTo and HomeRedirect.tsx:33-41 navigates to it immediately after the unlock form is submitted; the operator has just pressed Enter on Unlock.tsx and the next screen that appears has the payment button focused, so a held or double-tapped Enter pays. In both cases the only remaining protection is that the operator does not press a key before reading the screen; the SPA's other dangerous actions use an explicit dialog, and no input-protection delay or deliberate pointer action is required here.

X-Frame-Options: DENY (http_service.go:70) prevents classic clickjacking, so this is a keyboard-focus variant that relies on the pre-focused control plus attacker-timed navigation. It does not affect the Wails desktop build (isHttpMode() gate; wails.json registers no URL scheme). Confidentiality is not affected; a successful exploit is an unauthorised outgoing payment of attacker-chosen size.

## Evidence
1. [frontend/src/screens/wallet/send/ConfirmPayment.tsx:134–142](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/send/ConfirmPayment.tsx#L134-L142)
   The 'Confirm Payment' LoadingButton is rendered with `autoFocus` (line 139) and onClick=confirmPayment, which POSTs /api/payments/{invoice.paymentRequest} with the operator's JWT. React (19.2, package.json) calls focus() on autoFocus host elements when they mount, so the moment the card renders (after useBalances resolves) keyboard focus sits on the control that sends the payment; an Enter keydown or Space keydown+keyup — including OS key-repeat events from a key the operator is already holding — activates it.
2. [frontend/src/screens/wallet/Send.tsx:60–70](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/Send.tsx#L60-L70)
   On mount the `bip21` query parameter is read and handleBip21 runs automatically; the effect is not gated on the Loading return, so navigation happens with no operator action.
3. [frontend/src/screens/wallet/Send.tsx:29–43](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/Send.tsx#L29-L43)
   For a URI carrying `lightning=<bolt11>` the invoice is decoded with @getalby/lightning-tools and, when it has a fixed amount, the SPA navigates straight to /wallet/send/confirm-payment with the attacker-chosen invoice (amount, destination, description) as router state.
4. [frontend/src/hooks/useRegisterProtocolHandler.ts:24–27](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/hooks/useRegisterProtocolHandler.ts#L24-L27)
   In HTTP mode the SPA registers itself as the browser's `bitcoin:` protocol handler at `${origin}${basePath}/wallet/send?bip21=%s` (called from App.tsx:23). Once the operator accepts the browser prompt, any page's bitcoin: link or JS navigation to a bitcoin: URL opens this flow without the attacker needing the hub's address; otherwise a direct link to the hub URL reaches the same entry.
5. [frontend/src/components/redirects/DefaultRedirect.tsx:21–23](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/redirects/DefaultRedirect.tsx#L21-L23)
   If the hub is locked when the deep link arrives, pathname+search including `?bip21=` is stored as returnTo and the operator is sent to the unlock form (Unlock.tsx submits on Enter).
6. [frontend/src/components/redirects/HomeRedirect.tsx:33–41](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/redirects/HomeRedirect.tsx#L33-L41)
   Immediately after a successful unlock the SPA navigates to the stored returnTo, i.e. to the attacker's confirm-payment screen with the pay button focused, directly after the operator pressed Enter to submit the unlock form.
7. [frontend/src/screens/wallet/send/ConfirmPayment.tsx:122–126](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/send/ConfirmPayment.tsx#L122-L126)
   The attacker's invoice description is rendered as the screen's main text next to the focused button, so the attacker chooses the wording shown (e.g. 'press Enter to continue'); the amount is shown but cannot be hidden.
8. [frontend/src/components/ui/custom/loading-button.tsx:24–32](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/ui/custom/loading-button.tsx#L24-L32)
   LoadingButton spreads remaining props onto the underlying Button/<button>, so `autoFocus` reaches the DOM element.
9. [http/http\_service.go:195](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L195)
   POST /api/payments/:invoice is registered in the full-access JWT group; the SPA's request() (platform_specific/http/src/utils/request.ts) attaches the JWT from localStorage automatically.
10. [api/transactions.go:124–134](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/transactions.go#L124-L134)
   api.SendPayment hands the invoice straight to SendPaymentSync; the backend has no further confirmation, cooldown or per-payment limit for operator-initiated payments.

## Impact
A successful exploit results in an unauthorised Lightning payment of attacker-chosen amount from the operator's wallet (up to spendable balance), i.e. loss of funds; no data disclosure, no availability impact. The operator does see the amount and description before the keypress, which is why exploitability, not impact, carries the uncertainty.

## Reproduction steps
1. Attacker hosts a page the operator visits; a bitcoin: link (if the operator accepted the protocol-handler prompt) or a direct link to the hub opens /wallet/send?bip21=...lightning=<invoice>. The SPA auto-navigates to Confirm Payment with the pay button focused (immediately if logged in, or right after the operator submits the unlock form). Any Enter/Space keypress — including OS key-repeat from a key held on the attacker's page — sends the payment. Network-delivered, no privileges, but requires the operator to hold a hub session/unlock in that browser and the keypress to land after the button mounts (AT:P), and the operator to press a key (UI:A). Assumptions: React 19.2 (package.json) focuses autoFocus host elements on mount; browsers activate a focused <button> on Enter keydown and on Space keyup following a Space keydown; OS key-repeat follows window focus.

## Recommended fix
1. ConfirmPayment.tsx pre-focuses the payment submit button on a screen that can be reached by an externally supplied URL, so an incidental keypress completes an attacker-prefilled payment. Fix criteria: A payment confirmation reached from a deep link or protocol handler cannot be completed by a keypress that arrives with the screen: the submit control is not auto-focused (or is disabled for a short input-protection interval after mount), and a deliberate pointer click or an explicit second confirmation is required. Verify by opening /wallet/send?bip21=...lightning=... and pressing Enter immediately: no payment request is sent.
2. Deep links that pre-fill a payment are replayed straight after unlock (returnTo), chaining the unlock form's Enter keypress into the payment screen. Fix criteria: After unlock, a stored returnTo that pre-fills a payment is either dropped or shown with the same deliberate-confirmation requirement, so the unlock submission can never be followed directly by a focused pay button. Verify by deep-linking while locked, unlocking, and confirming that focus does not land on the payment button.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Insufficient UI warning
**CWE:** [CWE-357](https://cwe.mitre.org/data/definitions/357.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256462

---

# Duplicate-hash hold invoices settle two rows for one received payment, crediting an isolated balance with funds never received (LDK backend)

## Details
make_hold_invoice lets the requesting app choose the payment hash. The hub deliberately tolerates several incoming rows with the same hash (the 'wrapped invoice' design exercised by transactions/self_hold_payments_test.go TestWrappedInvoice) and tells them apart by payment_request in markHoldInvoiceAccepted - but the two code paths that mark a received payment SETTLED do not share one per-payment guard:

1. SettleHoldInvoice (transactions_service.go:1313-1361) selects the ACCEPTED row for (hash, app), calls ClaimForHash and marks that row SETTLED.
2. ConsumeEvent("nwc_lnclient_payment_received") (803-881) selects `Limit(1).Find(incoming, payment_hash=H)` with no invoice or state filter and no ORDER BY, and marks that row SETTLED.

markTransactionSettled's only guard, findSettledTransaction (1606-1627), requires the same payment_request, so two rows with the same hash and different bolt11 strings can both become SETTLED for one received payment. markTransactionSettled (1479-1525) never touches amount_msat, so each row is credited with its own amount. GetIsolatedBalanceMsat then counts both.

Attack (isolated app A with make_invoice and pay_invoice scopes, LDK backend): A picks preimage P, H = sha256(P). A calls make_hold_invoice(H, Y) then (a second later, or with a different description) make_hold_invoice(H, X) -> rows R2 (invoice I2, amount Y) and R3 (invoice I3, amount X), both PENDING, both hash H; I2 != I3 because LDK derives the payment secret from hash+amount+expiry timestamp. The hub performs no duplicate check. A pays I3 for X sats from an external wallet (X can be 1 sat). LDK emits PaymentClaimable with the per-hash record holding I3, so markHoldInvoiceAccepted (1000-1060) moves R3 to ACCEPTED. A calls settle_hold_invoice(P): SettleHoldInvoice settles R3 (+X). LDK's PaymentReceived event arrives; the hash-only Limit(1) lookup returns R2 (the older row - SQLite walks idx_transactions_payment_hash in rowid order, and idx_transactions_payment_hash_settled_at_created_at puts R2's NULL settled_at first), findSettledTransaction finds no SETTLED row with invoice I2, so R2 is marked SETTLED as well (+Y). The order of the two paths does not matter: R2 is PENDING with a distinct invoice either way, and if the event is processed first, R3's own guard looks for I3 and still settles. A's isolated balance is now X+Y for X received; Y is attacker-chosen. A spends it via pay_invoice to an external invoice and the hub's node pays out funds it never received. Repeatable with a fresh hash per round.

This is distinct from the verified ldk-hold-invoice-payment-hash-collision-hijack (cross-app acceptance hijack): fixing acceptance attribution or rejecting only other apps' hashes leaves this same-app double settlement intact, because the defect is in the settlement guard being keyed on payment_request while the payment_received lookup is keyed on hash alone.

Dependency assumption (stated, not verified - ldk-node-go sources are not in the checkout): that Bolt11Payment().ReceiveForHash in github.com/getAlby/ldk-node-go v0.0.0-20261015143504-ca24bcee5b83 (go.mod:11) creates a second invoice for a hash that already has a pending inbound payment. Upstream ldk-node's receive_inner inserts into the payment store with an overwriting insert and only the outbound send path checks DuplicatePayment; the hub's own wrapped-invoice feature on the LDK backend (TestWrappedInvoice, LNBackendType=LDK) relies on a second registration of an existing hash succeeding. LND rejects duplicates at AddHoldInvoice ('invoice with payment hash already exists', quoted in the same test), so the path is LDK-specific; LDK is the default backend. If ldk-node does reject duplicates this particular path is closed and only the hub-level weakness (no own guard, hash-only Limit(1) selection, payment_request-keyed settlement guard) remains.

## Evidence
1. [transactions/transactions\_service.go:803–880](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L803-L880)
   ConsumeEvent("nwc_lnclient_payment_received") resolves the row to settle with `Limit(1).Find(Type=incoming, PaymentHash=H)` - no payment_request match, no state filter, no ORDER BY - and calls markTransactionSettled on whatever row comes back. With two incoming rows for H this is the stale PENDING sibling (lowest rowid / NULL settled_at on SQLite's payment_hash indexes), not the row the payer actually paid.
2. [transactions/transactions\_service.go:1606–1626](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1606-L1626)
   findSettledTransaction, the only guard against settling a payment twice, matches Type + PaymentHash + PaymentRequest + SETTLED. Two rows that share a hash but carry different bolt11 strings never see each other, so both may reach SETTLED for a single received payment.
3. [transactions/transactions\_service.go:1479–1524](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1479-L1524)
   markTransactionSettled updates State, Preimage, FeeMsat, FeeReserveMsat, SettledAt and SelfPayment only; amount_msat is left as the row's own value. The stale row is therefore credited with the amount the app chose when it created it, independent of the amount actually received.
4. [transactions/transactions\_service.go:1313–1360](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1313-L1360)
   SettleHoldInvoice independently selects the ACCEPTED row for (hash, app), calls lnClient.SettleHoldInvoice (ClaimForHash) and marks that row SETTLED; this is the first of the two settlement paths, the payment_received consumer is the second.
5. [transactions/transactions\_service.go:247–299](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L247-L299)
   MakeHoldInvoice inserts a new PENDING incoming row with the caller-chosen payment hash without checking whether a pending/accepted incoming row with that hash already exists; the hub relies entirely on the LN backend to reject a duplicate.
6. [lnclient/ldk/ldk.go:2589–2651](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L2589-L2651)
   LDKService.MakeHoldInvoice checks only that the hash is 32 bytes and calls Bolt11Payment().ReceiveForHash; it never consults ls.node.Payment(hash) for an existing registration. The invoice string stored in the DB row is read back from the single per-hash LDK payment record, so each registration yields its own distinct bolt11 (different timestamp/payment secret).
7. [lnclient/ldk/ldk.go:1836–1857](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L1836-L1857)
   After ClaimForHash succeeds, LDK's PaymentReceived event is converted via ldkPaymentToTransaction and published as nwc_lnclient_payment_received, which drives the second settlement path.
8. [db/queries/get\_isolated\_balance.go:8–33](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/queries/get_isolated_balance.go#L8-L33)
   GetIsolatedBalanceMsat sums amount_msat over every SETTLED incoming row of the app; the stale duplicate row becomes spendable balance that validateCanPay (transactions_service.go:1166-1171) then honours.
9. [nip47/controllers/make\_hold\_invoice\_controller.go:62–76](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/make_hold_invoice_controller.go#L62-L76)
   NIP-47 entry point: payment_hash and amount are taken verbatim from the request of any app whose make_invoice scope grants make_hold_invoice/settle_hold_invoice (nip47/permissions/permissions.go:172).
10. [lnclient/ldk/ldk.go:2261–2263](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L2261-L2263)
   The LDK backend (the default) advertises make_hold_invoice and settle_hold_invoice as supported NIP-47 methods, so the path is enabled out of the box.

## Impact
Integrity: the per-app ledger is corrupted - one received payment settles two rows, and the stale row's amount is attacker-chosen and unrelated to what was received, creating spendable isolated balance backed by no funds that the app withdraws from the hub's channels via pay_invoice; repeatable up to the node's spendable balance, so the operator's funds are at risk (HIGH). No confidentiality impact; availability not affected beyond fund loss.

## Reproduction steps
1. Attacker holds an isolated app connection with make_invoice and pay_invoice scopes (PR:L) on an LDK-backed hub and sends NIP-47 requests over the relay: two make_hold_invoice calls with the same self-chosen hash, one small external payment to the newer invoice, one settle_hold_invoice with the preimage, then pay_invoice to withdraw. No user interaction. Attack requirements: the hash-only Limit(1) lookup must return the stale row (deterministic on SQLite's indexes, unspecified on Postgres) and ldk-node-go v0.0.0-20261015143504-ca24bcee5b83 must accept a second ReceiveForHash for a pending hash (stated assumption, unverified in the checkout), so AT:P.

## Recommended fix
1. The payment_received handler selects the row to settle by payment hash alone, and findSettledTransaction is keyed on payment_request, so with several incoming rows sharing a hash a row other than the one actually paid is settled and nothing prevents a second row from also being settled for the same received payment; the stale row keeps its own amount. Fix criteria: Exactly one incoming transaction may transition to SETTLED per received payment for a given hash: the settlement lookup must match the specific invoice (payment_request) reported by the backend, prefer the ACCEPTED/PENDING row deterministically, and markTransactionSettled must refuse to settle an incoming row when another incoming row with the same hash is already settled for that payment (or the amount settled must equal the amount received). Verify with two hold invoices sharing a hash and different amounts: after one payment and settle, the app's isolated balance increases by exactly the paid amount and the other row is not SETTLED.
2. MakeHoldInvoice does not check for an existing pending or accepted incoming transaction with the caller-chosen hash and relies on the LN backend to reject duplicates, which LDK does not. Fix criteria: The hub itself must reject a make_hold_invoice whose hash already belongs to a pending/accepted incoming transaction (or scope any sanctioned wrapped-invoice flow explicitly with separate accounting), independent of backend behaviour. Verify that a second make_hold_invoice with the same hash from the same app fails on every backend.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Duplicate identifier
**CWE:** [CWE-694](https://cwe.mitre.org/data/definitions/694.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256460

---

# GORM default logger prints slow and failing SQL with inlined bound values (plaintext secrets) to stdout

## Details
db/db.go:32-37 builds gorm.Config without a Logger unless LOG_DB_QUERIES is set. GORM (gorm.io/gorm v1.31.2, pinned in go.mod) then substitutes logger.Default, which writes to os.Stdout at Warn level: in Trace(), any statement that returns an error (including ErrRecordNotFound, since IgnoreRecordNotFoundError is false) or whose elapsed time exceeds SlowThreshold (200 ms) is printed as Dialector.Explain(sql, vars...), i.e. the SQL with every bound parameter value inlined as a literal (gorm.io/driver/sqlite v1.6.0 and driver/postgres v1.6.3 both inline via logger.ExplainSQL). No ParamsFilter or ParameterizedQueries is configured anywhere in the tree.

Several statements bind plaintext secrets: config.set (config.go:287-297) writes the unlock password whenever AUTO_UNLOCK_PASSWORD is configured (service.go:107, at every start) or set from the UI (config.go:398); the Alby OAuth refresh/access tokens (alby_oauth_service.go:195-199); env-supplied LNDMacaroonHex / PhoenixdAuthorization (config.go:96/109); the VSS token (start.go:544). transactions_service.go:239 inserts invoices with svc.db.Create as an autocommit statement binding the preimage, which the LND backend populates at creation (lnd.go:1570); the settle paths bind preimages inside explicit transactions.

The trigger is ordinary operation rather than attacker input: with SQLite, _txlock=immediate plus _busy_timeout=5000 (db.go:63) means every GORM transaction opens with BEGIN IMMEDIATE, so a concurrent autocommit write (config.set, MakeInvoice's insert) spends up to 5 s of busy-wait inside its own statement — counted by Trace — and is slow-logged past 200 ms, or fails with SQLITE_BUSY and is error-logged unconditionally. The project's own code acknowledges both: the db.go pragma comment exists to 'avoid SQLITE_BUSY errors', and saveTokenWithRetries (alby_oauth_service.go:180-192) retries the OAuth-token upsert because it fails in practice — every failed attempt emits the token in clear. Checkpoint fsyncs on slow storage (Raspberry Pi installs) and constraint errors add further occurrences.

The hub's own logrus logger never logs secrets, and its file hook (LOG_TO_FILE → WORK_DIR/log/nwc.log) does not capture GORM's output; GORM writes directly to the process stdout, which the documented systemd unit (install.sh:179-195, no redirection) persists in journald, the Docker image in the container log store, and fly.io/Render in their hosted log platforms. This contradicts the threat model's promise 'nothing sensitive logged' against a local attacker with log access (adversary 7). Encrypted values (mnemonic, credentials saved through setup) appear only as ciphertext; request_events.content_data is never written.

LOG_DB_QUERIES=true (Info level) prints every statement this way, but that is an operator opt-in; the finding is the default Warn-level path.

Explicit assumption: the behaviour of gorm.io/gorm v1.31.2 logger.Default (stdout, Warn, 200 ms SlowThreshold, IgnoreRecordNotFoundError=false, Explain inlining via callbacks' Trace) and gorm.Open's nil-Logger fallback, as recalled from the pinned version; dependencies were not inspected.

## Evidence
1. [db/db.go:31–37](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/db.go#L31-L37)
   gorm.Config leaves Logger nil unless LogQueries is true, so gorm.Open substitutes gorm_logger.Default: a logger writing to os.Stdout at Warn level with SlowThreshold 200 ms, IgnoreRecordNotFoundError=false and ParameterizedQueries=false. In its Trace(), every statement that returns an error, or whose measured elapsed time exceeds 200 ms, is printed as Dialector.Explain(sql, vars...) — the SQL with every bound value inlined as a literal. No ParamsFilter/ParameterizedQueries is configured anywhere in the tree (only this file and wails_app.go touch loggers). This is the line the fix must change.
2. [config/config.go:287–296](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/config.go#L287-L296)
   config.set binds the value — unencrypted whenever encryptionKey=="" — into gormDB.Clauses(onConflict).Create(&userConfig). When called on the root *gorm.DB this is an autocommit statement: on SQLite with _txlock=immediate a write queued behind another connection's BEGIN IMMEDIATE spends its busy-wait inside this statement's execution, and a SQLITE_BUSY timeout or constraint error surfaces here, so this is the statement whose rendered text carries the secret to stdout.
3. [service/service.go:105–110](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/service.go#L105-L110)
   At every start with AUTO_UNLOCK_PASSWORD set (documented in README.md:166) the unlock password is written via cfg.SetUpdate("AutoUnlockPassword", pw, "") — a plaintext bound value in the upsert above.
4. [config/config.go:394–400](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/config.go#L394-L400)
   SetAutoUnlockPassword (authenticated UI path) writes the unlock password through the same plaintext upsert.
5. [alby/alby\_oauth\_service.go:180–196](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_oauth_service.go#L180-L196)
   saveToken writes the Alby OAuth refresh and access tokens via SetUpdate(..., "") as plaintext bound values; saveTokenWithRetries wraps it in a retry loop because the statement is known to fail intermittently — and every failed attempt is an error-path GORM log line containing the token literal.
6. [config/config.go:89–110](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/config.go#L89-L110)
   LNDMacaroonHex (from LND_MACAROON_FILE) and PhoenixdAuthorization supplied via env are mirrored into user_configs at every start as plaintext bound values.
7. [service/start.go:543–546](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L543-L546)
   The VSS bearer token is written as a plaintext bound value.
8. [transactions/transactions\_service.go:213–242](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L213-L242)
   MakeInvoice inserts the new transaction with svc.db.Create outside any explicit transaction (autocommit), binding Preimage when the LN client returns one; the same autocommit insert is used by MakeHoldInvoice. markTransactionSettled/createSettledTransactionFromNotification bind the preimage inside explicit transactions and are logged on error (SQLITE_BUSY, constraint) or slow execution.
9. [lnclient/lnd/lnd.go:1568–1570](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/lnd/lnd.go#L1568-L1570)
   With the LND backend the invoice preimage (RPreimage) is populated at invoice creation, so the autocommit INSERT in MakeInvoice carries the preimage of a not-yet-paid invoice.
10. [db/db.go:63](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/db.go#L63)
   _txlock=immediate with _busy_timeout=5000: every GORM transaction opens with BEGIN IMMEDIATE, so a concurrent autocommit write waits up to 5 s inside its own statement (counted by GORM's Trace) and then fails with SQLITE_BUSY — the project's comment acknowledges these errors occur.
11. [scripts/linux-x86\_64/install.sh:179–194](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-x86_64/install.sh#L179-L194)
   The documented systemd unit runs start.sh (lines 133-138, no stdout redirection) as the installing user, so GORM's stdout output is persisted by journald, readable by root and the systemd-journal/adm groups; the Docker image (ENTRYPOINT /bin/main) likewise persists stdout in the container log store, and README.md:546-550 directs fly.io users to read it via `fly logs`.

## Impact
With AUTO_UNLOCK_PASSWORD configured (README.md:166) the logged value is the unlock password, which derives the AES key for the mnemonic and every encrypted secret and, presented to the hub's HTTP port on localhost, yields full wallet control — total confidentiality loss of the hub's data. Otherwise Alby OAuth tokens, the VSS token, env-supplied LND macaroon / phoenixd password and invoice preimages are disclosed. No direct integrity or availability effect from the logging itself.

## Reproduction steps
1. A local account able to read the service's captured stdout — journald (systemd-journal/adm group) for the documented systemd install, the container log directory or `docker logs` for the image, or the hosting platform's log console — reads lines GORM emitted when a statement binding a secret errored (SQLITE_BUSY after 5 s, constraint violation; the OAuth-token upsert is retried precisely because it fails) or exceeded 200 ms (autocommit write queued behind another connection's BEGIN IMMEDIATE, checkpoint fsync on slow storage). The attacker cannot force the slow/error condition and must wait for ordinary activity to produce it (AT:P); no operator interaction is needed.

## Recommended fix
1. The database layer accepts GORM's default logger, whose slow-query and error paths render SQL with inlined parameter values to stdout, so secrets bound as parameters are written to persisted process logs — violating the project's 'nothing sensitive logged' property. Fix criteria: In the default configuration no database statement text containing bound values may reach any log: the GORM logger must be silent or configured so only placeholders are emitted (ParameterizedQueries-equivalent) on both the slow-query and the error paths, routed through the hub logger. Verify by forcing a slow and a failing user_configs upsert and a failing transactions insert and asserting the captured stdout contains no parameter values.
2. LOG_DB_QUERIES=true enables Info-level logging that prints every statement with values, including those carrying plaintext secrets. Fix criteria: Even with query logging enabled, parameter values must be redacted so the unlock password, tokens and preimages never appear; verify by enabling LOG_DB_QUERIES, starting with AUTO_UNLOCK_PASSWORD set and asserting the password is absent from the output.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Sensitive information in logs
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** LOCAL
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256458

---

# Cashu melt without preimage treated as failure, refunding app balance while mint still pays

## Details
The Cashu backend's SendPaymentSync (lnclient/cashu/cashu.go:86-94) requests a melt quote, calls wallet.Melt and returns an error both when Melt errors and when the response carries no preimage. Under NUT-05 a melt whose Lightning payment is still outstanding is reported with state PENDING and no preimage; a transport error or timeout between the hub and the mint while the mint is mid-payment also surfaces as an error. In both cases the mint has already taken the hub's proofs and continues the Lightning payment, yet the hub reports a definitive failure.

The transactions service treats every SendPaymentSync error as final (transactions_service.go:449-460): markPaymentFailed sets the outgoing row to FAILED and zeroes the fee reserve. GetIsolatedBalanceMsat and GetBudgetUsageMsat count only SETTLED and PENDING outgoing rows, so the paying app's isolated balance and budget are immediately refunded and validateCanPay passes again. The Cashu client exposes no payment events (GetSupportedNIP47NotificationTypes is empty), and the only reconciliation (checkUnsettledTransactions -> LookupInvoice -> checkOutgoingPayment) is run for PENDING rows only, so the FAILED row is never corrected when the mint later reports the melt as PAID. The project's own contract, stated at lnd.go:457-460, is that a SendPaymentSync error means the payment definitively failed.

Attack: a NIP-47 app with pay_invoice scope (isolated or budget-limited) creates a hold invoice on a node it controls and calls pay_invoice. The mint forwards the payment; the attacker holds the HTLC until the mint returns PENDING or the hub's HTTP exchange with the mint breaks (gonuts client timeout, or a reverse-proxy idle timeout in front of the mint). The hub records FAILED and refunds the app's balance/budget. The attacker then releases the preimage; the mint completes the payment and the hub's ecash is consumed with no ledger debit. Repeating this drains the hub's Cashu balance beyond the app's authorised balance or budget.

Assumptions about gonuts v0.4.2 (pinned in go.mod): wallet.Melt returns the mint's PostMeltQuoteBolt11Response with State=Pending and empty Preimage for in-flight melts (keeping the input proofs pending for CheckMeltQuoteState to resolve later), and its HTTP client surfaces transport failures as errors. Whichever of these holds, the hub's own code is the defect: it equates 'no preimage yet' with 'definitively failed' and offers no later reconciliation of FAILED rows. The hub's 'restore' custom node command ('Restore cashu tokens after the wallet had a stuck payment', cashu.go:426) shows stuck melts are a known operational state.

## Evidence
1. [lnclient/cashu/cashu.go:86–94](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/cashu/cashu.go#L86-L94)
   After wallet.Melt, any error (86-90) and any response without a preimage (92-94) is returned as an error. Under NUT-05 a melt whose Lightning payment is still outstanding is returned with state PENDING and no preimage, and a transport failure/timeout while the mint is mid-payment also surfaces as an error; in both cases the mint holds the hub's proofs and continues paying, yet the hub reports a definitive failure. This is the code the fix must change.
2. [transactions/transactions\_service.go:446–460](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L446-L460)
   Every error from lnClient.SendPaymentSync is treated as definitive: markPaymentFailed is called on the PENDING outgoing row and the error is returned to the app.
3. [transactions/transactions\_service.go:1753–1757](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1753-L1757)
   markPaymentFailed sets State=FAILED and FeeReserveMsat=0 on the row.
4. [db/queries/get\_isolated\_balance.go:24–27](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/queries/get_isolated_balance.go#L24-L27)
   Only SETTLED and PENDING outgoing rows count as spent; the FAILED row no longer debits the isolated app's balance.
5. [db/queries/get\_budget\_usage.go:15–18](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/queries/get_budget_usage.go#L15-L18)
   Only SETTLED and PENDING outgoing rows count toward budget usage; the FAILED row no longer consumes the app's budget.
6. [transactions/transactions\_service.go:394](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L394)
   validateCanPay is the shipped spending control (budget / isolated balance); it reads the two queries above, so the refunded FAILED row lets the app pass it again.
7. [transactions/transactions\_service.go:762–798](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L762-L798)
   The only reconciliation for event-less backends re-checks rows in state PENDING only (771) and settles them via LookupInvoice; a FAILED row is never re-examined, so when the mint later completes the melt the ledger is never debited.
8. [lnclient/cashu/cashu.go:395–415](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/cashu/cashu.go#L395-L415)
   checkOutgoingPayment can refresh a melt quote via CheckMeltQuoteState, but it is reachable only through LookupInvoice from the PENDING-row reconciliation; and GetSupportedNIP47NotificationTypes is empty, so Cashu publishes no payment_sent event that could flip the row.
9. [lnclient/lnd/lnd.go:456–466](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/lnd/lnd.go#L456-L466)
   The project's own contract for SendPaymentSync: an error must mean the payment definitively failed (LND only errors when no routes remain; LDK's timeout is tolerated because LDK emits async settle events). The Cashu client violates this contract and has no event stream to compensate.

## Impact
Ecash leaves the hub's wallet with no corresponding debit in the ledger, bypassing the isolated-balance and budget boundaries that validateCanPay enforces; repeated use can drain the whole Cashu balance. Ledger and funds integrity is fully compromised; no confidentiality or availability impact.

## Reproduction steps
1. Attacker is any NIP-47 app connection with pay_invoice scope on a Cashu-backed hub (threat-model adversary 1). It pays a hold invoice on its own node, holds the HTLC until the mint reports the melt PENDING or the hub's request to the mint fails, receives a failure (balance/budget refunded), then settles and collects. Repeatable with no victim interaction. AT is PRESENT because success depends on the mint returning PENDING or the HTTP exchange breaking while the payment is in flight — behaviour of the external mint and transport, not of the hub or the attacker.

## Recommended fix
1. SendPaymentSync returns an error for a melt in PENDING state (or on a transport error) although the mint is still executing the payment, violating the lnclient contract that an error means the payment definitively failed. Fix criteria: A PENDING melt or a transport error must not be reported as failure; the client must poll CheckMeltQuoteState until PAID/UNPAID (or return a distinct in-flight result that the transactions service keeps PENDING). Verify by holding an HTLC until the mint reports PENDING, then settling: the hub row must end SETTLED and the app's balance must not be refunded.
2. No reconciliation exists for FAILED rows on backends without payment events, so a melt that completes after being marked failed is never debited. Fix criteria: Recent FAILED outgoing rows on event-less backends must be re-checked via LookupInvoice/CheckMeltQuoteState and flipped to SETTLED with the real fee when the quote is PAID; isolated balance and budget must then reflect the debit.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper state handling
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256457

---

# Boltz websocket dispatcher blocks forever on an abandoned listener channel, halting all swap processing until restart

## Details
NewSwapsService (swaps/swaps_service.go:130-148) starts one goroutine that is the sole consumer of the Boltz websocket's `Updates` channel. For every update it looks up `swapListeners[update.Id]` under the lock, releases the lock, and then executes a plain blocking send `ch <- update`. Each per-swap listener channel is created with a buffer of one (lines 963, 1128). Listeners (startSwapInListener / startSwapOutListener) exit on terminal statuses (InvoicePaid at 1089; TransactionLockupFailed/InvoiceFailedToPay/SwapExpired at 1109-1122; TransactionFailed/SwapExpired at 1439-1445) and on every internal error path by returning; only then does the deferred function (977-987, 1142-1152) delete the map entry. Nothing drains or closes the channel, and the dispatcher already holds `ch` as a local variable.

Deterministic sequence for the swap provider, for any swap id the hub is subscribed to: send a terminal status (e.g. `transaction.lockupFailed`), then two more status messages for the same id (they may share one websocket frame). The listener takes the first and enters RefundSwap (several HTTP calls to the provider, 5 s timeout each, plus sleeps; with `enableRetries && cooperative` at 859, where `cooperative` comes from the provider-reported TimeoutBlockHeight at 830, the provider can keep it looping indefinitely). The second update fills the buffer; the dispatcher blocks on the third. When the listener eventually returns it deletes the map entry and never reads again, so the dispatcher goroutine is blocked forever. Even a short window suffices because the provider controls batching and ordering.

From then on no websocket update for any swap is delivered: in-flight swap-outs never see their lockup and never claim; swap-ins never observe completion or failure; the hourly auto swap-out loop, which calls startSwapOutListener synchronously (line 405), stalls. Assumption about the pinned dependency github.com/BoltzExchange/boltz-client/v2 v2.12.5 (not vendored): `Updates` is an unbuffered channel fed by the connection's single reader goroutine, which also delivers the `subscribe` confirmation; with the hub's dispatcher blocked, that reader blocks on its next update and Subscribe for new swaps times out, so subscribeToSwapUpdates (1453-1473) retries with backoff forever. Recovery requires a hub restart (subscribePendingSwaps re-registers pending swaps on start).

This is a code defect (a blocking send into a channel whose consumer has exited), not volumetric load: the provider's message count is three. What it hands the provider beyond the per-swap stalling it can already cause by withholding updates is a persistent, process-wide wedge of the hub's swap subsystem that covers every current and future swap and outlives the triggering messages and any later honest behaviour by the provider, until an operator restart. Funds are not stolen: hold invoices time out and swap-ins remain refundable after restart; pending swaps silently stop progressing.

## Evidence
1. [swaps/swaps\_service.go:130–147](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L130-L147)
   The single dispatcher goroutine is the only reader of boltzWs.Updates. It looks up the per-swap channel under swapListenersLock, releases the lock, then performs an unconditional blocking send `ch <- update` with no select/timeout/ctx. Once that send blocks on a channel nobody reads, no update for any swap is ever dispatched again.
2. [swaps/swaps\_service.go:963](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L963)
   Each swap-in listener channel is created with a buffer of exactly one (`make(chan boltz.SwapUpdate, 1)`), so a second queued update fills it and a third blocks the dispatcher. The swap-out listener at line 1128 is identical.
3. [swaps/swaps\_service.go:977–987](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L977-L987)
   Deferred cleanup runs only after the listener has already stopped reading: it deletes the map entry and unsubscribes but never drains or closes updateCh. A dispatcher send already in progress against the full buffer holds the channel as a local and blocks permanently. Swap-out has the same defer at 1142-1152.
4. [swaps/swaps\_service.go:1109–1122](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1109-L1122)
   On transaction.lockupFailed / invoice.failedToPay / swap.expired the swap-in listener runs RefundSwap synchronously (several HTTP round trips to the provider, each with a 5 s client timeout, plus sleeps) and then returns without reading updateCh again. Any two further updates for the same swap id sent during that window (or in the same websocket frame) leave the dispatcher blocked on the orphaned channel.
5. [swaps/swaps\_service.go:1439–1445](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1439-L1445)
   Swap-out terminal statuses (transaction.failed / swap.expired) likewise return without draining; the InvoicePaid path at 1089 and every error `return` inside the listener loops exit the same way, so any terminal update followed by two more updates wedges the dispatcher.
6. [swaps/swaps\_service.go:859–860](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L859-L860)
   Supporting: RefundSwap's retry loop continues indefinitely while `enableRetries && cooperative`, where `cooperative` (line 830) is derived from the provider-reported TimeoutBlockHeight. A provider that keeps failing the cooperative signing call keeps the listener out of its read loop for as long as it likes, widening the window from seconds to unbounded.

## Impact
Permanent loss of swap-update processing for all swaps (and new subscriptions, under the stated boltz-client v2.12.5 assumption) until the hub is restarted; the rest of the hub (Lightning node, NWC, HTTP API) keeps running. No confidentiality or integrity effect; pending swaps stall but funds are recoverable via timeouts and manual refund after restart.

## Reproduction steps
1. The attacker is the swap provider (Boltz / SatsRouting, selected via Alby's info endpoint on mainnet, or BOLTZ_API), a remote party the threat model names and whose other inputs the hub validates. It controls websocket message content, batching and timing for swaps the hub has subscribed to (the dispatcher drops unknown ids, so an active swap is required: AT:P). Three messages for one swap id — a terminal status followed by two more — deterministically block the dispatcher; no race has to be won because the provider can widen the non-reading window arbitrarily via RefundSwap's provider-bound retry loop. Network vector, no privileges on the hub, no user interaction.

## Recommended fix
1. The single shared dispatcher performs an unconditional blocking send into a per-listener channel that may no longer have a reader. Fix criteria: The dispatcher must never block indefinitely on one listener: deliver with a non-blocking send, a select bounded by a timeout or the service context, or hand off to a per-listener goroutine/queue, and drop or log updates for listeners that cannot accept them. After any single listener stalls or exits, updates for other swaps continue to be delivered.
2. Listeners deregister only after they have stopped reading, and the abandoned channel is neither drained nor closed, so an in-flight send is orphaned. Fix criteria: A listener must remove its map entry under the lock before it stops consuming (or the dispatcher must re-check registration and select on a per-listener done channel), so that no send can be started or left pending against a channel whose consumer has exited.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Deadlock
**CWE:** [CWE-833](https://cwe.mitre.org/data/definitions/833.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256453

---

# Background cleanup deletes LDK records of pending payments, making accepted hold invoices unsettleable

## Details
LDKService.deleteOldLDKPayments (lnclient/ldk/ldk.go:2161-2196) runs after every successful full background sync (ldk.go:518; a full sync is forced at least hourly, ldk.go:435) and removes from ldk-node's payment store every Bolt11 / Bolt11Jit / Spontaneous payment whose CreatedAt is more than maxInvoiceExpiry (24h) old. The loop only looks at payment kind and age; it never inspects payment.Status, although the hub reads that field elsewhere (ldk.go:1538). Records that are still live are therefore deleted together with expired, unpaid invoices.

The hub's hold-invoice settlement depends on that record. SettleHoldInvoice (ldk.go:2667-2698) derives the hash from the app-supplied preimage, calls ls.node.Payment(hash) and returns 'payment not found for derived hash' when nil, never calling ClaimForHash; CancelHoldInvoice (ldk.go:2653-2665) calls FailForHash, which likewise needs the record. A hold invoice is created at T0 via NIP-47 make_hold_invoice with expiry up to 24h (default 86400s) and a CLTV delta up to 65535 blocks (ldk.go:2559-2651). The payer pays at T0+23h59m; LDK emits PaymentClaimable; the hub marks the DB row ACCEPTED with the LDK claim deadline (potentially days of blocks away) and notifies the app via hold_invoice_accepted carrying settle_deadline (transactions_service.go:1000-1061, nip47/models/transactions.go:58). At the first full sync after T0+24h, deleteOldLDKPayments removes the ldk-node record while the HTLC is still held. Every later settle_hold_invoice (or cancel_hold_invoice) from the app fails deterministically; the HTLC is eventually failed back to the payer by LDK at its CLTV deadline, and the DB row remains ACCEPTED with no recovery path (transactions_service.go:1313-1359).

The triggering input is authored by the payer, a remote Lightning party: hold invoices exist so that the receiver can act on 'accepted' and settle later (escrow, P2P-exchange, conditional-delivery flows), and the hub explicitly tells the app how long it may wait (settle_deadline). A payer who pays late in the invoice's validity window shrinks the receiver's real settlement window to minutes without the receiver or the hub being able to tell; once the receiving app has released whatever it releases on acceptance, the settle fails and the payer is refunded. No position beyond receiving the invoice is needed. Even with a short invoice expiry, any hold invoice held more than 24h after creation becomes unsettleable the same way, so the defect also breaks honest long-held hold invoices.

A secondary consequence: an outbound payment whose record is deleted before its HTLC resolves (an in-flight payment that outlives 24h from creation and is no longer tracked by the blocking SendPaymentSync call, e.g. after a hub restart) can no longer be matched by the asynchronous PaymentSuccessful/PaymentFailed handlers (ldk.go:1857-1903), which return early on a nil ls.node.Payment, so its DB row stays PENDING and is permanently counted against the app's budget/isolated balance (db/queries/get_isolated_balance.go:28).

Dependency assumptions, stated for github.com/getAlby/ldk-node-go v0.0.0-20261015143504-ca24bcee5b83 (ldk-node): Node.RemovePayment removes the payment-store entry regardless of status (upstream remove_payment performs no status check), Node.Payment(id) returns nil afterwards, and Bolt11Payment.ClaimForHash / FailForHash themselves refuse a hash absent from the payment store. Independently of the last point, the hub's own nil check at ldk.go:2683 alone blocks settlement.

## Evidence
1. [lnclient/ldk/ldk.go:2161–2196](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L2161-L2196)
   deleteOldLDKPayments removes every Bolt11, Bolt11Jit and Spontaneous payment whose CreatedAt is older than maxInvoiceExpiry (24h, ldk.go:72) via node.RemovePayment. It never inspects payment.Status (which the hub reads elsewhere, e.g. ldk.go:1538), so Pending records — inbound hold invoices with a held HTLC and in-flight outbound payments — are deleted together with expired invoices.
2. [lnclient/ldk/ldk.go:2667–2698](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L2667-L2698)
   SettleHoldInvoice derives the hash from the preimage, calls ls.node.Payment(hash) and returns 'payment not found for derived hash' when nil, never reaching ClaimForHash. Once the record has been removed the held HTLC can no longer be claimed through the hub; CancelHoldInvoice (ldk.go:2653-2665, FailForHash) is affected the same way.
3. [lnclient/ldk/ldk.go:517–518](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L517-L518)
   deleteOldLDKPayments runs after every successful full background wallet sync; the sync loop forces a full sync at least every MAX_SYNC_INTERVAL (1h, ldk.go:435), so deletion occurs within about an hour of the record passing 24h of age.
4. [lnclient/ldk/ldk.go:2559–2651](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L2559-L2651)
   MakeHoldInvoice allows an invoice expiry up to 24h (default DEFAULT_INVOICE_EXPIRY = 86400 when 0) and a min_cltv_expiry_delta up to 65535 blocks, so a payer may legitimately pay just before CreatedAt+24h and the HTLC may remain claimable (per the LDK claim deadline) well past that point.
5. [lnclient/ldk/ldk.go:1924–1951](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L1924-L1951)
   On EventPaymentClaimable the hub converts the still-Pending ldk-node record to a transaction, attaches the LDK ClaimDeadline as SettleDeadline and publishes nwc_lnclient_hold_invoice_accepted; the record's CreatedAt is not refreshed, so the 24h clock keeps running from invoice creation.
6. [transactions/transactions\_service.go:1000–1061](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1000-L1061)
   markHoldInvoiceAccepted sets the DB row ACCEPTED, stores settle_deadline and publishes nwc_hold_invoice_accepted, which the NIP-47 notifier relays to the app with settle_deadline (nip47/models/transactions.go:58). The hub therefore promises the app a claim window it cannot honour once deleteOldLDKPayments has run.
7. [transactions/transactions\_service.go:1313–1359](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1313-L1359)
   The NIP-47 settle_hold_invoice path finds the ACCEPTED row and relies entirely on lnClient.SettleHoldInvoice succeeding; on error the row stays ACCEPTED and no other code path moves it, so the receiver has no way to recover the held funds.
8. [lnclient/ldk/ldk.go:1857–1903](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L1857-L1903)
   Secondary consequence: the asynchronous PaymentSuccessful / PaymentFailed handlers return early when ls.node.Payment(paymentId) is nil, so an outbound payment whose record was deleted before its HTLC resolved (e.g. after a hub restart during a >24h in-flight payment) never produces nwc_lnclient_payment_sent/failed and its DB row stays PENDING, permanently counted against an isolated app's balance (db/queries/get_isolated_balance.go:28).

## Impact
Ledger integrity is corrupted: the hold-invoice row is stuck ACCEPTED with no recovery path, the receiver (operator or isolated sub-wallet app) loses incoming funds the hub reported as locked and claimable until settle_deadline, and in the outbound case PENDING rows permanently encumber an isolated app's balance. The settle/cancel functions become unavailable for affected payments. No confidentiality impact; loss is bounded per invoice and depends on the receiving app's behaviour, so integrity and availability are rated LOW.

## Reproduction steps
1. The attacker is the payer of a hold invoice issued by an app on the hub: any remote Lightning party, unauthenticated, in scope as threat-model adversary 5. They pay within the invoice's validity but shortly before CreatedAt+24h, then wait for the receiving app to act on the hold_invoice_accepted notification. Once a full sync has run past the 24h mark (at most about an hour later), the app's settle attempt fails and the HTLC is refunded at its CLTV timeout. Attack requirements are present: the receiving app must defer settlement past the 24h mark (which the hub's advertised settle_deadline invites) and a full sync must run in between.

## Recommended fix
1. deleteOldLDKPayments uses record age alone as the deletion criterion, releasing ldk-node payment records that are still Pending (an accepted hold invoice with a held HTLC, or an in-flight outbound payment) and that SettleHoldInvoice, CancelHoldInvoice and the asynchronous PaymentSuccessful/PaymentFailed handlers still need. Fix criteria: Only terminal payments (Succeeded/Failed) and inbound invoices that are both unpaid and past their invoice expiry may be removed; Pending inbound hold invoices with an outstanding HTLC and Pending outbound payments must be retained until they resolve (or until their claim deadline / CLTV has passed). Verify that a hold invoice accepted shortly before CreatedAt+24h can still be settled and cancelled after a full sync past that mark, and that an outbound payment resolving after 24h still updates its DB transaction.
2. An ACCEPTED hold-invoice row has no reconciliation path: when the backend can no longer settle or cancel it, the row stays ACCEPTED indefinitely and the operator/app receive no signal. Fix criteria: Accepted hold invoices whose HTLC has been failed back or whose backend record is missing are surfaced and transitioned to a terminal state, so that the receiver learns that settlement is impossible instead of discovering it on a failed settle call.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Operation after resource release
**CWE:** [CWE-672](https://cwe.mitre.org/data/definitions/672.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256448

---

# NIP-47 get_balance crashes hub via nil dereference on pending outbound channel

## Details
LDKService.GetBalances (lnclient/ldk/ldk.go:2126-2129) computes per-channel spendable/receivable limits by dereferencing `*channel.CounterpartyOutboundHtlcMaximumMsat` and `*channel.InboundHtlcMaximumMsat`. These are `*uint64` fields mapped from ldk-node's `Option<u64>`; rust-lightning only populates them once `counterparty_selected_channel_reserve_satoshis` is known, i.e. after the peer's accept_channel message (the ChannelDetails docs: "only `None` before we have received either the `OpenChannel` or `AcceptChannel` message from the remote peer"). For an outbound channel the hub has proposed and the peer has not yet accepted, both are nil. The hub's own `getMaxReceivable`/`getMaxSpendable` (ldk.go:792-821) dereference them only under an `IsUsable` guard, and `ListChannels` (ldk.go:1017-1046) nil-checks every other optional pointer and even emits a UI message for channels with no funding transaction, so the project expects unfunded channels in `node.ListChannels()` output. `GetBalances` evaluates `channel.IsUsable || includeInactiveChannels` and so dereferences the two pointers for every channel whenever `includeInactiveChannels` is true.

The only caller that passes `true` is the NIP-47 `get_balance` controller for non-isolated app connections (nip47/controllers/get_balance_controller.go:45); api.GetBalances and the swap service pass `false`. NIP-47 requests are dispatched as `go svc.nip47Service.HandleEvent(...)` (service/start.go:240) and there is no `recover()` anywhere in nip47/ or service/ (the only recovers are in the LDK event broadcaster, LND/CLN clients and the Alby OAuth service), so the nil dereference is a fatal runtime panic that terminates the whole Alby Hub process (node, HTTP server, relay subscription).

Attack path: the operator opens a channel to a peer (ldk.go OpenChannel, reached from POST /api/channels or the Wails mirror). A malicious or stalling peer completes the transport handshake and `init`, receives `open_channel`, and never replies `accept_channel`. OpenChannel gives up after 60s with "open channel timeout" and does nothing to cancel the pending channel, so the UnfundedOutboundV1 channel stays in LDK's channel list until the peer sends an error/accept or LDK's unfunded-channel age limit (UNFUNDED_CHANNEL_AGE_LIMIT_TICKS = 60 timer ticks, roughly one hour) prunes it. During that window, any NIP-47 `get_balance` request from a non-isolated app — e.g. the Alby mobile app or browser extension, which poll balance routinely, or an app connection the attacker holds — crashes the hub. Requests queued at the relay during downtime are redelivered on reconnect and crash it again while the state persists.

Assumptions on the pinned dependency (getAlby/ldk-node-go v0.0.0-20261015143504-ca24bcee5b83, wrapping ldk-node/rust-lightning): `ChannelDetails.InboundHtlcMaximumMsat` and `CounterpartyOutboundHtlcMaximumMsat` are `*uint64` (established by the hub code compiling with explicit `*` dereferences); `Node::list_channels()` passes `ChannelManager::list_channels()` through unfiltered and that list includes unfunded channel phases; `get_htlc_maximum_msat` returns None until the counterparty reserve is known; and rust-lightning retains UnfundedOutboundV1 channels across a peer disconnect (re-sending open_channel on reconnect), so the window is bounded by the age limit rather than by the peer's connection.

## Evidence
1. [lnclient/ldk/ldk.go:2126–2129](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L2126-L2129)
   GetBalances iterates every channel returned by ldk_node ListChannels and, when includeInactiveChannels is true, unconditionally dereferences *channel.CounterpartyOutboundHtlcMaximumMsat and *channel.InboundHtlcMaximumMsat for channels that are not IsUsable. Both fields are *uint64 (Option<u64> in ldk-node) and are nil for an outbound channel that has not yet received accept_channel. This is the line the fix must change.
2. [nip47/controllers/get\_balance\_controller.go:44–56](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/get_balance_controller.go#L44-L56)
   The NIP-47 get_balance handler for every non-isolated app connection calls lnClient.GetBalances(ctx, true) — the only caller in the tree that passes includeInactiveChannels=true (api.GetBalances at api/api.go:1372 and swaps/swaps_service.go:215 pass false).
3. [service/start.go:240](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L240)
   Each relay event is handled in a bare goroutine (`go svc.nip47Service.HandleEvent(...)`); there is no recover() in nip47/ or service/, so a panic in GetBalances terminates the whole hub process.
4. [lnclient/ldk/ldk.go:792–820](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L792-L820)
   getMaxReceivable and getMaxSpendable dereference the same two pointers but only inside an `if channel.IsUsable` guard, showing the maintainers treat them as optional for non-usable channels; GetBalances lacks that guard on the includeInactiveChannels path.
5. [lnclient/ldk/ldk.go:1017–1046](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L1017-L1046)
   ListChannels nil-checks FundingTxo, UnspendablePunishmentReserve and ConfirmationsRequired and emits a UI error for channels with no funding transaction, confirming that node.ListChannels() is expected to return unfunded (pre-accept) channels whose optional fields are nil.
6. [lnclient/ldk/ldk.go:1194–1244](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L1194-L1244)
   OpenChannel calls ldk_node OpenChannel/OpenAnnouncedChannel and waits at most 60s for a ChannelPending event; on timeout it returns an error without cancelling the pending channel, so the unfunded outbound channel remains in LDK's channel list until the peer responds or LDK's unfunded-channel age limit prunes it.

## Impact
A Go nil-pointer panic in an unrecovered goroutine terminates the entire hub: the Lightning node stops, pending NIP-47 requests are lost, and the operator must re-unlock. No data is disclosed or modified.

## Reproduction steps
1. Attacker is a remote Lightning peer (no privileges) to whom the operator opens a channel; the peer withholds accept_channel, leaving an unfunded outbound channel in LDK's list for up to ~1 hour. The crash is then triggered by any NIP-47 get_balance from a non-isolated app — routine polling by the operator's own wallet apps suffices, or an attacker-held connection. Requires the operator to initiate a channel open to the attacker's node (active interaction) and a connected non-isolated NIP-47 app that queries balance (near-universal deployment state).

## Recommended fix
1. GetBalances dereferences optional ChannelDetails fields (InboundHtlcMaximumMsat, CounterpartyOutboundHtlcMaximumMsat) for non-usable channels when includeInactiveChannels is set, violating the invariant that these fields are only guaranteed for usable channels. Fix criteria: GetBalances must tolerate nil InboundHtlcMaximumMsat / CounterpartyOutboundHtlcMaximumMsat (treat as 'no constraint' or skip the channel) on every path, including includeInactiveChannels=true. Verify by invoking GetBalances(ctx, true) with a ChannelDetails whose two pointers are nil and IsUsable=false and confirming it returns normally.
2. NIP-47 request handlers execute LN client calls in bare goroutines with no panic recovery, so any backend panic is process-fatal. Fix criteria: A panic inside a NIP-47 request handler must not terminate the process (recover, log, and return an internal error response). Verify by injecting a panicking LNClient method under HandleEvent and confirming the hub keeps running.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** NULL pointer dereference
**CWE:** [CWE-476](https://cwe.mitre.org/data/definitions/476.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256445

---

# Self-paid hold invoices never time out: unbounded blocked goroutines and indefinite fund lock

## Details
When SendPaymentSync detects that the invoice being paid was issued by this hub (a self-payment) and the matching incoming row is a hold invoice, it calls interceptSelfHoldPayment (transactions_service.go:1102-1138). That function registers a holdInvoiceUpdatedConsumer with the global event publisher, marks the incoming hold invoice ACCEPTED with a synthetic settle_deadline of BlockHeight+24, and then blocks on a select that only returns when a nwc_payment_received or nwc_hold_invoice_canceled event for the same payment request arrives, i.e. when the issuing app calls settle_hold_invoice or cancel_hold_invoice. Nothing enforces the recorded deadline: there is no timer, the function takes no context, and settle_deadline is never read for enforcement anywhere in the tree. A real hold payment is bounded by the HTLC's CLTV expiry; a self-hold payment never touches the Lightning backend, so this wait is the only resolution mechanism.

Consequences:

1. Non-reclaimable resource leak driven by a low-privileged NIP-47 app. Hold-invoice methods are granted by the make_invoice scope (permissions.go:126). An app with make_invoice and pay_invoice can loop make_hold_invoice(amount, hash_i) then pay_invoice(invoice_i) and never settle. Each iteration leaves one blocked goroutine (each NIP-47 request runs in its own goroutine, service/start.go:240), one registered subscriber (events.publish spawns a goroutine per subscriber per event, events.go:56-66), two DB rows and a PENDING outgoing. For a non-isolated app with no budget, validateCanPay (:1147-1165) performs no balance or budget check at all, so the count is unbounded; for isolated or budgeted apps each pending outgoing counts amount + >=10-sat fee reserve, bounding the count by balance or budget, but every entry still leaks. The leak persists until the hub restarts; after a restart the ACCEPTED/PENDING rows remain, no consumer exists, checkUnsettledTransactions never reconciles them (:762-766), and the issuer can still settle (SettleHoldInvoice skips the LN client for self-payments, :1338-1340), crediting its own incoming while the payer's outgoing stays PENDING forever.

2. Indefinite lock of a victim payer's isolated funds. When an isolated app (or an operator-driven transfer) pays a hold invoice issued by a malicious app on the same hub, the payer's sub-wallet is debited amount + fee reserve (get_isolated_balance.go:22-30) for as long as the issuer chooses, with no timeout; only the issuing app (AppId-scoped settle/cancel, :1326-1331, :1365-1370) can release it, and no operator API calls CancelHoldInvoice. Whether the backend accepts a zero-amount hold invoice (MakeHoldInvoice lacks MakeInvoice's minimum-amount check, :247-299 vs :177-182) was not verifiable in this checkout and is not needed for either consequence.

The maintainers' tests (TestSelfHoldPaymentSettled/Canceled) exercise only a prompt settle or cancel; none covers an issuer that never acts.

## Evidence
1. [transactions/transactions\_service.go:1102–1138](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1102-L1138)
   interceptSelfHoldPayment registers an event subscriber, marks the hold invoice ACCEPTED with a synthetic settle_deadline of BlockHeight+24, then blocks on a two-case select with no timeout, no context and no block-height check until the issuing app settles or cancels. RemoveSubscriber runs only via defer on return, so an issuer that never acts keeps the goroutine and the subscriber alive until the process exits. settle_deadline is only ever written (here and at :1029), never read for enforcement.
2. [service/start.go:240](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L240)
   Every NIP-47 request is dispatched in its own goroutine with no concurrency cap; the context carries no deadline and SendPaymentSync takes no context at all, so each blocked self-hold pay_invoice is a goroutine the hub never reclaims.
3. [events/events.go:56–66](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/events/events.go#L56-L66)
   publish iterates every registered listener under subscriberMtx and spawns one goroutine per listener per event; with N stuck holdInvoiceUpdatedConsumers every subsequent event (payments, budget warnings, telemetry) costs N extra goroutines and N string comparisons while the mutex is held.
4. [transactions/transactions\_service.go:1140–1165](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1140-L1165)
   validateCanPay checks only that the app has the pay_invoice scope; for a non-isolated app with MaxAmountSat == 0 (the UI's unlimited budget, NewApp.tsx:269) no balance or budget check follows, so the number of self-hold payments such an app can leave blocked is unbounded. For isolated or budgeted apps each pending outgoing counts amount plus a >= 10-sat fee reserve, which bounds the count by balance or budget but still leaks every one of them.
5. [nip47/permissions/permissions.go:126](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/permissions/permissions.go#L126)
   make_hold_invoice, settle_hold_invoice and cancel_hold_invoice are all granted by the make_invoice scope; combined with pay_invoice the same app connection can both issue the hold invoice and self-pay it.
6. [transactions/transactions\_service.go:396–425](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L396-L425)
   The payer's outgoing row is created PENDING with FeeReserveMsat set (CalculateFeeReserveMsat, minimum 10 sats) regardless of self-payment, and stays PENDING for as long as the goroutine blocks; for an isolated payer this debits amount + reserve from the sub-wallet with no bound, unlike a real hold payment whose HTLC CLTV expiry forces resolution.
7. [db/queries/get\_isolated\_balance.go:22–30](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/queries/get_isolated_balance.go#L22-L30)
   The isolated balance subtracts SUM(amount_msat + fee_msat + fee_reserve_msat) over SETTLED and PENDING outgoing rows, so a victim isolated app that paid a self-hold invoice has those funds locked until the issuer acts.
8. [transactions/transactions\_service.go:1336–1340](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1336-L1340)
   SettleHoldInvoice skips the LN client for SelfPayment rows, so the issuer can settle at any later time, including after a hub restart when no consumer goroutine exists: the issuer's incoming is credited while the payer's outgoing stays PENDING (fee reserve never released) forever.
9. [transactions/transactions\_service.go:762–766](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L762-L766)
   checkUnsettledTransactions returns immediately for backends that emit payment_received (LDK/LND/CLN) and otherwise only re-checks PENDING rows under 24 h old via LookupInvoice; a self-payment never exists at the LN client, so no reconciliation ever fails an orphaned self-payment outgoing or an ACCEPTED self-hold invoice.

## Impact
Goroutines, subscribers and per-event fan-out grow without reclamation until restart, progressively degrading the hub rather than crashing it, so availability impact is LOW. Victim isolated payers lose use of amount + fee reserve indefinitely and, after a restart, are left with permanently PENDING outgoing rows whose fee reserve is never released (ledger integrity LOW). No confidentiality impact.

## Reproduction steps
1. Attacker is a NIP-47 app connection with make_invoice (grants make/settle/cancel_hold_invoice) and pay_invoice scopes, reached through the Nostr relay. It repeatedly creates hold invoices and self-pays them, never settling; each pair of requests permanently leaks a blocked goroutine, an event subscriber and a pending outgoing, unbounded for a non-isolated unbudgeted app. No race, no backend-specific behaviour (the path never calls the LN client), no user interaction. For the fund-lock variant, another isolated app on the hub must pay the attacker's hold invoice, the ordinary use of a hold invoice.

## Recommended fix
1. interceptSelfHoldPayment waits indefinitely for the issuing app with no enforcement of the recorded settle deadline, leaking a goroutine and an event subscriber per unresolved self-hold payment and locking the payer's pending funds without bound. Fix criteria: A self-hold payment must resolve within a bounded time: when the recorded settle deadline (block height or an equivalent wall-clock bound) passes without settlement, the hub cancels the hold invoice, fails the payer's outgoing, releases the fee reserve and unregisters the consumer. Verify that N abandoned self-hold payments leave no blocked goroutines or registered subscribers after the deadline and that the payer's isolated balance is restored.
2. After a restart no consumer exists for ACCEPTED self-hold invoices and their PENDING self-payment outgoing rows, and no reconciliation path ever fails them, so they remain debited forever and can still be settled one-sidedly by the issuer. Fix criteria: On startup (or on a periodic reconciliation) the hub fails or re-attaches every PENDING self-payment outgoing whose matching hold invoice is ACCEPTED, and settling a self-hold invoice also settles or fails the matching outgoing atomically, so no self-payment pair can be left half-resolved.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Uncontrolled resource consumption
**CWE:** [CWE-772](https://cwe.mitre.org/data/definitions/772.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256441

---

# NIP-47 make_invoice metadata app_id lets any app attribute invoices to other apps

## Details
transactions_service.MakeInvoice honours an undocumented `app_id` key inside the caller-supplied metadata map and uses it to overwrite the app id that nip47/event_handler.go bound from the signature-verified, scope-checked app connection. The NIP-47 make_invoice controller passes the client's `metadata` object straight through, so any app connection with make_invoice scope — including an isolated sub-wallet issued to a third party (sub-wallets get make_invoice by default, frontend/src/screens/subwallets/NewSubwallet.tsx:58) — can send `{"amount":1000,"metadata":{"app_id":7}}` and have the resulting invoice recorded under app 7. App ids are small sequential integers.

No production code in the repository sets metadata.app_id; the only in-repo hint of the override's purpose is that the hub registers sub-wallet lightning addresses with api.getalby.com by `app_id` (alby/alby_oauth_service.go:354-360), i.e. it appears intended for the non-isolated 'Alby Account' connection whose keypair api.getalby.com holds. The override is not restricted to that connection, to non-isolated apps, or to existing app ids (transactions.app_id has no foreign key). The operator API (CreateInvoice/Transfer) attributes invoices to apps only through an explicit, existence-checked toAppId parameter with nil metadata.

Consequences for the targeted app once the invoice is paid (by anyone, including the attacker): the row appears in that app's isolated list_transactions/lookup_invoice results, it receives a NIP-47 payment_received notification it never initiated carrying attacker-chosen description and up to 4096 bytes of metadata, its isolated balance is credited with the real funds, and its last_settled_transaction_at is bumped. This breaks the documented isolation promise (README:400: an isolated connection has 'only access to its own transaction list') and the per-app attribution the operator UI relies on. It does not move funds the attacker does not own and settlement still requires a real Lightning payment, so the impact is an integrity/attribution defect between tenants of the hub, not theft. A non-existent app_id produces an orphaned settled row that afterTransactionSettled merely logs; app_id 0 makes the struct-condition lookup at line 1646 match the first app row (GORM drops zero-value fields), bumping that app's last_settled_transaction_at.

## Evidence
1. [transactions/transactions\_service.go:197–205](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L197-L205)
   MakeInvoice replaces the appId passed by the caller (the authenticated NIP-47 app) with metadata["app_id"] whenever that key is present and a JSON number, with no check that the caller owns or may act for that app, nor that the app exists. The resulting row (line 229) is stored with the forged AppId.
2. [nip47/controllers/make\_invoice\_controller.go:12–44](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/make_invoice_controller.go#L12-L44)
   makeInvoiceParams.Metadata is a free-form map decoded from the client's request params and passed verbatim to MakeInvoice at line 44 together with the authenticated appId, so any app with make_invoice scope can carry {"app_id": N} into the override.
3. [nip47/event\_handler.go:416](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/event_handler.go#L416)
   The event handler binds the request to app.ID of the signature-verified, scope-checked app row; this is the identity the metadata override discards.
4. [nip47/notifications/nip47\_notifier.go:43–56](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/notifications/nip47_notifier.go#L43-L56)
   nwc_payment_received is routed by transaction.AppId; notifySubscribers (line 107) delivers to an isolated app only when app.ID matches, so the targeted isolated app receives a payment_received notification carrying the attacker-chosen description and metadata.
5. [transactions/transactions\_service.go:626–627](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L626-L627)
   LookupTransaction (and ListTransactions at line 682) scope isolated apps to app_id = their own id, so the forged row appears in the victim app's isolated transaction list and is invisible to an isolated attacker afterwards; GetIsolatedBalanceMsat sums settled incoming rows by app_id, crediting the victim on settlement.
6. [api/transactions.go:19–33](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/transactions.go#L19-L33)
   The operator-facing CreateInvoice (and Transfer, lines 198-229) is the only sanctioned way to attribute an invoice to another app: it takes toAppId as an explicit parameter, verifies the app exists, and passes nil metadata. The NIP-47 path performs neither check.
7. [transactions/transactions\_service.go:1631–1661](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1631-L1661)
   On settlement afterTransactionSettled publishes the row with the forged AppId and bumps that app's last_settled_transaction_at; for a non-existent id it only logs 'failed to find app by id' (no crash, orphan row remains).

## Impact
The attacker appends incoming transaction rows with chosen description/metadata to another app's isolated ledger, triggers payment_received notifications to it and can create orphaned rows for non-existent apps, defeating the per-app attribution and isolation the hub documents; it cannot read other apps' data, cannot reduce any balance or move funds it does not own, and the orphan path only logs, so integrity LOW, confidentiality and availability none.

## Reproduction steps
1. Any NIP-47 app connection with make_invoice scope (the default for sub-wallets) sends one make_invoice request whose metadata contains another app's small sequential id; the hub records the invoice under that app and paying it completes the injection. No race, no special deployment, no user interaction; privileges are those of an ordinary app connection.

## Recommended fix
MakeInvoice trusts a caller-controlled metadata field to override the authenticated app identity, with no ownership or existence check. Fix criteria: The app id recorded on an invoice must come only from the authenticated connection or from an operator-level API parameter, never from NIP-47 request metadata; if an attribution override is retained for a trusted connection (e.g. the Alby Account lightning-address flow), it must be gated on that specific connection and validate that the target app exists. Verify that a NIP-47 make_invoice with metadata.app_id set to another app's id is recorded under the calling app (or rejected), and that the operator API still validates target app existence.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Insecure direct object reference
**CWE:** [CWE-639](https://cwe.mitre.org/data/definitions/639.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256404

---

# Accepted hold invoices never expire; settling after HTLC timeout credits sub-wallet with no funds

## Details
The hub treats a nil return from `lnClient.SettleHoldInvoice` as proof that a hold invoice's funds were received and immediately marks the ACCEPTED DB row SETTLED with the invoice amount (transactions_service.go:1341-1349). Hold invoices sit in ACCEPTED until the app settles or cancels them. The backend's `settle_deadline` is stored by markHoldInvoiceAccepted (:1025-1030) but is only ever echoed in NIP-47 responses (nip47/models/transactions.go:58), never compared with the block height; no code path moves an ACCEPTED row to FAILED other than the app's own cancel_hold_invoice (:1362-1414); checkUnsettledTransactions only inspects PENDING rows and returns early for backends with payment_received notifications, i.e. LDK (:762-779); and the LDK event handler consumes only PaymentClaimable (-> accepted, ldk.go:1924-1951) and PaymentReceived (-> settled, ldk.go:1836-1856), nothing for an inbound HTLC that is failed back at its CLTV deadline.

Attack (default embedded LDK backend). The attacker holds an isolated app B with make_invoice (which grants make/settle/cancel_hold_invoice, permissions.go:126) and pay_invoice scopes, and controls an external Lightning node.
1. B calls make_hold_invoice for X sats with payment_hash = sha256(P), optionally a small min_cltv_expiry_delta (ldk.go:2604-2611).
2. The attacker's node pays the invoice. LDK emits PaymentClaimable -> nwc_lnclient_hold_invoice_accepted -> row ACCEPTED with settle_deadline recorded.
3. The attacker does not settle. When the HTLC nears its CLTV expiry the hub's LDK fails it back and the attacker's node is refunded X. The hub DB row stays ACCEPTED; the ldk-node payment record stays Pending with amount X.
4. B calls settle_hold_invoice(P). SettleHoldInvoice finds the ACCEPTED row (:1326-1331) and LDK SettleHoldInvoice (ldk.go:2667-2697) looks up the still-present ldk-node payment, then calls ClaimForHash(hash, *paymentDetails.AmountMsat, preimage) — passing the stored amount back makes ldk-node's amount check vacuous — and returns only ClaimForHash's error, which is nil. The hub marks the row SETTLED for X (markTransactionSettled :1479-1527).
5. B's isolated balance (SUM of SETTLED incoming, get_isolated_balance.go:12-15) is now X although the node received nothing; validateCanPay (:1166-1171) lets B spend it with pay_invoice against the operator's real channel funds. Repeatable up to inbound capacity.

Timing window: deleteOldLDKPayments (ldk.go:2161-2195, run after each full sync, ldk.go:518) removes Bolt11 ldk-node payment records older than 24 h, so step 4 must occur within 24 h of invoice creation and after the fail-back (~cltv_expiry minus LDK's HTLC_FAIL_BACK_BUFFER). The attacker controls both the moment of payment and min_cltv_expiry_delta, so the window is comfortably met.

Dependency behaviour relied on, stated as assumptions for getAlby/ldk-node-go v0.0.0-20261015143504-ca24bcee5b83 (ldk-node / rust-lightning): (a) `Bolt11Payment::claim_for_hash` verifies preimage->hash and that the claimable amount is not below the stored amount, then calls the void `ChannelManager::claim_funds_with_known_custom_tlvs`; LDK's claim path returns silently when `claimable_payments` holds no entry for the hash, so claim_for_hash returns Ok with no HTLC claimed; (b) LDK fails claimable HTLCs back in `do_chain_event` at `cltv_expiry - HTLC_FAIL_BACK_BUFFER`, emitting only `HTLCHandlingFailed`, which ldk-node neither surfaces as a user Event nor uses to update its payment store. LDK's own documentation for claim_funds says the call does not guarantee the claim and that PaymentClaimed must be awaited, so this is hub misuse of the API rather than an upstream defect.

Other backends: on LND the hub's subscribeSingleInvoice returns on Invoice_CANCELED without marking the DB row FAILED (lnd.go:401-403), so the row also stays ACCEPTED forever, but LND's SettleInvoice is assumed to reject a cancelled hold invoice, so no credit results. CLN (hold plugin) was not analysed.

## Evidence
1. [transactions/transactions\_service.go:1313–1358](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1313-L1358)
   SettleHoldInvoice finds the app's ACCEPTED row by derived payment hash, calls lnClient.SettleHoldInvoice and, on a nil error, calls markTransactionSettled which sets state SETTLED with the row's AmountMsat. It never compares settle_deadline with the block height and never confirms with the backend that funds were actually claimed.
2. [lnclient/ldk/ldk.go:2667–2697](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L2667-L2697)
   LDK SettleHoldInvoice looks up the ldk-node payment record (still Pending after the HTLC was failed back), passes its own stored AmountMsat back as the claimable amount (so ldk-node's amount check is vacuous) and returns only ClaimForHash's error. Assumption: ldk-node claim_for_hash wraps the void ChannelManager::claim_funds and returns Ok when no claimable HTLC exists.
3. [transactions/transactions\_service.go:1000–1060](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1000-L1060)
   markHoldInvoiceAccepted stores the backend-reported settle_deadline on the row; no code path reads it for enforcement (it is only echoed to NIP-47 clients), and there is no reconciliation that moves an ACCEPTED hold invoice to FAILED when its HTLC times out.
4. [lnclient/ldk/ldk.go:1924–1951](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L1924-L1951)
   The only hold-invoice event the hub consumes from LDK is PaymentClaimable (-> accepted). ldk-node emits no user event the hub consumes when LDK fails a claimable HTLC back at its CLTV deadline, so the hub never learns the HTLC is gone.
5. [transactions/transactions\_service.go:762–778](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L762-L778)
   checkUnsettledTransactions only inspects PENDING rows and returns immediately for backends that support payment_received notifications (LDK), so ACCEPTED rows are never re-validated against the node.
6. [db/queries/get\_isolated\_balance.go:8–33](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/queries/get_isolated_balance.go#L8-L33)
   The isolated balance is SUM(amount_msat) of SETTLED incoming rows minus outgoing; the unfunded SETTLED row is counted as spendable balance.
7. [transactions/transactions\_service.go:1166–1180](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1166-L1180)
   validateCanPay authorises an isolated app's outgoing payment solely from GetIsolatedBalanceMsat, so the poisoned ledger lets the app spend the operator's real channel funds via pay_invoice.
8. [lnclient/ldk/ldk.go:2161–2195](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L2161-L2195)
   deleteOldLDKPayments removes Bolt11 ldk-node payment records older than 24 h after each full sync; this bounds the attack window (settle within 24 h of invoice creation, after the HTLC fail-back) but does not close it.

## Impact
Ledger integrity between the isolated sub-wallet and the main wallet — a trust boundary the threat model names — is fully compromised: the app is credited for funds the node never kept and spends that balance against the operator's real channel funds, repeatably, up to inbound capacity. No confidentiality or availability impact.

## Reproduction steps
1. Attacker is a NIP-47 app connection (threat-model adversary 1) with make_invoice and pay_invoice scopes on an isolated sub-wallet, plus an external Lightning node that pays the hold invoice over the network. They pay their own hold invoice, let the HTLC time out and be refunded, then call settle_hold_invoice within the 24 h ldk-node payment-record lifetime. Requires the default LDK backend and the stated ldk-node claim semantics (attack requirements present); no race, no user interaction; requests arrive via the Nostr relay.

## Recommended fix
1. SettleHoldInvoice records settlement from the absence of an error on a fire-and-forget claim call instead of from positive confirmation that the backend claimed funds. Fix criteria: An incoming hold invoice may only be marked SETTLED when the backend confirms receipt (the PaymentReceived/PaymentClaimed event for that payment hash and payment request, or a post-claim lookup showing the payment succeeded). Verify by settling an ACCEPTED hold invoice whose HTLC has already been failed back: the DB row must not become SETTLED and the app's isolated balance must not increase.
2. ACCEPTED hold invoices have no expiry handling: settle_deadline is stored but never checked, and no reconciliation moves timed-out or backend-cancelled invoices to FAILED (the LND subscription also drops Invoice_CANCELED without updating the row). Fix criteria: Reject settle_hold_invoice when the current block height is at or past the recorded settle_deadline, consume backend cancellation/timeout signals where available, and periodically (or on lookup) reconcile ACCEPTED rows with the backend so that invoices whose HTLCs are gone become FAILED and emit nwc_hold_invoice_canceled.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper state validation
**CWE:** [CWE-754](https://cwe.mitre.org/data/definitions/754.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256401

---

# Hold invoice settle/cancel race settles a cancelled invoice, crediting unfunded sub-wallet balance

## Details
SettleHoldInvoice and CancelHoldInvoice both locate the target row with an unlocked `Find(... State: ACCEPTED, AppId: appId)` and then transition it in separate database transactions. The failure path (markPaymentFailed) re-reads the row inside its transaction and refuses to fail a SETTLED payment, but the success path (markTransactionSettled) does not: findSettledTransaction only checks that no *other* SETTLED row exists for the same type/hash/payment request, and the update is `UPDATE transactions SET state='SETTLED', ... WHERE id = ?` with no precondition on the current state.

An isolated (sub-wallet) app B holding make_invoice (which covers make/settle/cancel_hold_invoice) and pay_invoice scopes can exploit the ordering cancel-commits-first, settle-commits-second:
1. B creates a hold invoice for X sats with a hash whose preimage it knows, and pays it itself (self-payment by an isolated app is a documented feature — README 'Transactions Service' — and is exercised by TestSendPaymentSync_SelfPayment_IsolatedAppToSelf). validateCanPay requires balance >= X; the incoming row becomes ACCEPTED with self_payment=true and B's outgoing stays PENDING while interceptSelfHoldPayment blocks on the event consumer.
2. B sends settle_hold_invoice(preimage) and cancel_hold_invoice(hash) at the same time; the hub runs each NIP-47 event in its own goroutine. Both Finds see the ACCEPTED row. If cancel's markPaymentFailed commits first, it publishes nwc_hold_invoice_canceled; the blocked SendPaymentSync returns HoldInvoiceCanceledError and markPaymentFailed sets B's outgoing to FAILED (fee reserve 0), restoring B's balance to X.
3. settle's markTransactionSettled then runs: findSettledTransaction finds no SETTLED row, and the UPDATE flips the FAILED incoming to SETTLED (amount X). nwc_payment_received is published; the consumer is already gone.
Result: B's isolated balance is 2X with only X ever funded. The attempt is free when the race is lost (settle-first yields a normal zero-fee self transfer and cancel returns 'cannot mark settled payment as failed'; cancel-before-settle's-Find just returns not-found), so B repeats with fresh hold invoices until it wins, then spends the fabricated balance through pay_invoice, which draws real funds from the operator's node beyond what was ever credited to the sub-wallet.

Database serialization does not close the race: on SQLite (`_txlock=immediate`, WAL) settle's BEGIN merely waits for cancel's commit and then proceeds with its stale pre-read; on Postgres lockTransactionsByPaymentHash is taken only inside each transaction and likewise does not cover the pre-read at line 1326. The same ordering applies to hold invoices paid by an external payer (cancel -> FailForHash, then settle -> ClaimForHash), but the self-payment variant involves no LN client call at all and is pure hub logic.

## Evidence
1. [transactions/transactions\_service.go:1325–1359](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1325-L1359)
   SettleHoldInvoice reads the ACCEPTED hold invoice with a plain Find outside any transaction or lock (1326-1331), skips the LN client for self_payment rows, and calls markTransactionSettled. Nothing between the read and the update re-checks that the row is still ACCEPTED.
2. [transactions/transactions\_service.go:1479–1521](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1479-L1521)
   markTransactionSettled only calls findSettledTransaction (a guard against a second SETTLED row) and then issues an unconditional UPDATE by primary key to state=SETTLED. A row that was moved to FAILED by a concurrent CancelHoldInvoice is silently flipped to SETTLED and nwc_payment_received is published.
3. [transactions/transactions\_service.go:1606–1626](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1606-L1626)
   findSettledTransaction looks only for an existing SETTLED row with the same type/payment_request/hash; the current state of the row being settled is never read, so a FAILED row passes the guard.
4. [transactions/transactions\_service.go:1362–1414](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1362-L1414)
   CancelHoldInvoice marks the incoming FAILED via markPaymentFailed and publishes nwc_hold_invoice_canceled; for a self-payment this wakes the payer's blocked SendPaymentSync.
5. [transactions/transactions\_service.go:1102–1137](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1102-L1137)
   interceptSelfHoldPayment marks the incoming ACCEPTED (self_payment=true) and blocks; on the canceled channel it returns HoldInvoiceCanceledError, so SendPaymentSync (lines 446-460) calls markPaymentFailed on the payer's outgoing row, zeroing its fee reserve and restoring the payer's isolated balance.
6. [transactions/hold\_invoice\_self\_payment\_consumer.go:24–30](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/hold_invoice_self_payment_consumer.go#L24-L30)
   The consumer routes nwc_hold_invoice_canceled for the matching payment request to canceledChannel, completing the refund of the self-payer's outgoing transaction.
7. [transactions/transactions\_service.go:1718–1777](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1718-L1777)
   By contrast markPaymentFailed re-reads the row inside the transaction (under lockTransactionsByPaymentHash on Postgres) and refuses the SETTLED->FAILED transition; the settle path has no such state precondition, so only the cancel-commits-first ordering is winnable, which is exactly the profitable one.
8. [db/queries/get\_isolated\_balance.go:8–33](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/queries/get_isolated_balance.go#L8-L33)
   Isolated balance = SUM(settled incoming) - SUM(settled+pending outgoing). After the race the recipient's incoming is SETTLED while the payer's outgoing is FAILED, so the sub-wallet is credited with no corresponding debit.
9. [service/start.go:240](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L240)
   Every NIP-47 request is handled in its own goroutine with no per-app serialization, so one app can have settle_hold_invoice and cancel_hold_invoice executing concurrently.
10. [nip47/permissions/permissions.go:125–126](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/permissions/permissions.go#L125-L126)
   The make_invoice scope grants make_hold_invoice, settle_hold_invoice and cancel_hold_invoice; together with pay_invoice this is the ordinary scope set of an isolated app connection.

## Impact
Ledger integrity between sub-wallets and the main wallet is fully compromised: an isolated app can mint arbitrary sub-wallet balance (doubling per won race, compounding) and then spend it via pay_invoice, moving real funds out of the operator's Lightning node beyond the balance the operator granted. No confidentiality impact; availability unaffected.

## Reproduction steps
1. Attacker is any NIP-47 app connection with make_invoice and pay_invoice scopes; an isolated sub-wallet with some funded balance is sufficient and is the position the threat model names (adversary 1). It creates and self-pays its own hold invoice, then fires settle_hold_invoice and cancel_hold_invoice concurrently through the relay; the hub processes each event in its own goroutine (service/start.go:240) with no per-app serialization. The exploitable interleaving (both pre-reads before either commit, cancel's transaction first) is one of a handful of equiprobable orderings, losing costs nothing, and attempts can be repeated indefinitely with new hold invoices.

## Recommended fix
1. SettleHoldInvoice reads the row's state outside the transaction that mutates it, and markTransactionSettled applies state=SETTLED without a precondition on the current state, so a concurrent FAILED transition is overwritten. Fix criteria: A hold invoice can only be settled if it is still ACCEPTED at the moment of the update, verified atomically (row lock plus re-read inside the transaction, or a conditional UPDATE ... WHERE state='ACCEPTED' with the affected-row count checked). After the fix, issuing settle and cancel concurrently in any order must leave the incoming row in exactly one of SETTLED or FAILED and the payer's outgoing in the matching state; the recipient's isolated balance must never increase without a corresponding settled debit.
2. FAILED -> SETTLED is a generally permitted transition in markTransactionSettled (needed for late payment_sent events on outgoing payments) and is applied to incoming hold invoices as well. Fix criteria: Restrict the FAILED -> SETTLED transition to outgoing payments confirmed by the LN backend; incoming transactions in FAILED state must not be settled by the NIP-47 settle path.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Race condition
**CWE:** [CWE-367](https://cwe.mitre.org/data/definitions/367.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256400

---

# Work directory and SQLite database created with permissive default modes (0777/0644 under umask), readable by other local accounts

## Details
`service.NewService` creates the work directory with `os.MkdirAll(appConfig.Workdir, os.ModePerm)` (service/service.go:71) and `NewLDKService` does the same for the LDK storage directory (lnclient/ldk/ldk.go:96). Nothing in the repository ever tightens the mode of these directories or of the files inside them (no `Chmod`, no `Umask`), so under the standard umask 022 of systemd services and Docker the directories end up 0755 and the SQLite database `nwc.db` (created by the bundled SQLite in mattn/go-sqlite3 v1.14.52 with its default 0644 mode, and its -wal/-shm siblings which inherit that mode) is world-readable. The only barrier left is the permission of the parent path, which the hub does not control.

The project's own Raspberry Pi installer (scripts/pi-aarch64/install.sh, pi-arm likewise) removes even that barrier: it creates `/opt/albyhub` with `sudo mkdir -p` (0755), chowns it to the unprivileged installing user, and runs the hub as that user with `WORK_DIR=/opt/albyhub/data`. Since `/opt` is world-traversable, any other local account on the Pi can run `sqlite3 /opt/albyhub/data/nwc.db` (or copy the file). The generic Linux installer puts the data dir under `$HOME/albyhub/data` and docker-compose bind-mounts `./albyhub-data` (root-owned files 0644 on the host), where exposure depends on the parent directory's mode (0755 homes on older Debian/Ubuntu and Raspberry Pi OS images; protected on distributions that default homes to 0700/0750).

The database is the hub's entire state. Readable in cleartext: the full transaction history with descriptions, metadata and labels (a privacy asset in the threat model), every app connection (name, pubkey, scopes, budgets, expiry, isolated balances), the Alby OAuth access/refresh tokens and VSS token (`account:read` scope), env-mirrored backend credentials, and the Argon2i-encrypted mnemonic, JWT secret and canary (Argon2i t=3, m=32 MiB, p=1), which the reader can brute-force offline against a weak unlock password. When auto-unlock is enabled the cleartext `AutoUnlockPassword` is also present and converts into full-access JWTs via `POST /api/unlock` on the local port; the Auto Unlock settings page already warns that 'everyone who has access to the machine running this hub could read that password', so that escalation is conceded by the project and is not counted in the integrity rating.

The threat model names local attackers with read access to the work dir as an adversary and excludes only root; the restore path (api/backup.go:361,371) creates the same files 0700/0600, showing the project itself treats them as owner-only. The default startup path therefore hands any co-located unprivileged account read access the project does not intend to grant. Exploitation requires a multi-user host (a second local account, or an attacker who has compromised a low-privilege service account on the same machine) and the default umask - attack requirements present.

## Evidence
1. [service/service.go:71](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/service.go#L71)
   `os.MkdirAll(appConfig.Workdir, os.ModePerm)` creates the work directory holding nwc.db, ldk/ and log/ with mode 0777 narrowed only by the process umask (0755 under the systemd/Docker default 022). No Chmod or Umask call exists anywhere in the non-test Go code, so the directory is traversable by every local account that can reach its parent.
2. [db/db.go:52–80](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/db.go#L52-L80)
   The SQLite database (default DATABASE_URI `nwc.db`, placed in the work dir) is opened via gorm.io/driver/sqlite v1.6.0 / mattn/go-sqlite3 v1.14.52 with no file-mode control; SQLite creates the main file (and its -wal/-shm siblings, which copy the main file's mode) with its compiled-in default 0644 & ~umask, so the file is world-readable inside a world-traversable directory.
3. [scripts/pi-aarch64/install.sh:12–13](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/pi-aarch64/install.sh#L12-L13)
   The shipped Raspberry Pi installer creates /opt/albyhub with `sudo mkdir -p` (0755) and chowns it to the unprivileged service user; /opt is world-traversable on every distribution, so the chain /opt (0755) -> /opt/albyhub (0755) -> data (0755, created by the hub) -> nwc.db (0644) is fully determined by the project's own artifacts and does not depend on home-directory defaults.
4. [scripts/pi-aarch64/install.sh:66–73](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/pi-aarch64/install.sh#L66-L73)
   The systemd unit runs the hub as `User=$USER` with `WORK_DIR=/opt/albyhub/data`; systemd's default UMask for services is 0022, so the hub's MkdirAll yields 0755 and SQLite's file creation yields 0644.
5. [lnclient/ldk/ldk.go:96](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L96)
   The LDK node storage directory (channel monitors, network graph, ldk logs) is likewise created with os.ModePerm; the backup helper at 2091/2103 writes channel-backup JSON with 0644.
6. [api/backup.go:361–371](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/backup.go#L361-L371)
   The restore path creates the very same files with 0700 directories and 0600 files, showing the project treats work-dir contents as owner-only material; the normal startup path is inconsistent with this shipped control.
7. [scripts/linux-x86\_64/install.sh:130–137](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-x86_64/install.sh#L130-L137)
   The generic Linux installer pre-creates `$INSTALL_DIR/data` with `mkdir -p` (0755 under umask 022) under $HOME, so on hosts whose home directories are 0755 (older Debian/Ubuntu, Raspberry Pi OS images) the same exposure results; on distributions that default homes to 0700/0750 this path is protected by the parent, not by the hub.

## Impact
Full read of the hub's state: complete transaction history, labels and metadata, all app connections with scopes/budgets/isolated balances, cleartext Alby OAuth and VSS tokens and env-mirrored backend credentials, and the Argon2i-encrypted mnemonic/JWT-secret/canary available for offline password cracking - total loss of confidentiality of the data at rest. Others have no write bit on the directory or file (0755/0644), so there is no direct integrity or availability impact; the escalation to full wallet control through a cleartext AutoUnlockPassword exists only when that opt-in feature is enabled and is already conceded by the project's own warning that anyone with machine access can read it, so it is not rated here.

## Reproduction steps
1. An unprivileged local account on the same host (a second user, or a compromised low-privilege service such as www-data on a shared home server) reads the database directly: on a Pi install `sqlite3 /opt/albyhub/data/nwc.db 'select key,value,encrypted from user_configs'` plus the transactions and apps tables; on the generic install the same file under ~hub/albyhub/data when the home directory is traversable. No interaction with the operator is needed and no hub control is involved - the hub never restricts the mode. Attack requirements: a multi-user host on which the attacker holds a local account and the default umask 022 (systemd/Docker default); on distributions that default home directories to 0700/0750 the generic installer path is shielded by the parent, but the Pi installer path under /opt is not.

## Recommended fix
1. The work directory, LDK directory and log directory are created with os.ModePerm (0777) and the SQLite database and backup files inherit permissive defaults (0644), so protection of the secret store against other local accounts depends on the host umask and parent-directory modes instead of the application. Fix criteria: Create the work directory and its ldk/, log/ and backup subdirectories owner-only (0700) and tighten the mode of pre-existing directories on startup; create or chmod the database file and its -wal/-shm siblings and any backup files to 0600. Verify on a fresh start with umask 022 that `stat` reports 0700 on the work dir and 0600 on nwc.db, nwc.db-wal and nwc.db-shm, and that a second local account cannot open them.
2. The shipped installers create the data directory (mkdir -p under $HOME, or /opt/albyhub chowned to the service user) with default modes and the systemd units set no UMask. Fix criteria: Installers create the data directory with mode 0700 (or chmod it after creation) and the generated systemd units set `UMask=0077`; verify after a scripted install that the data directory is 0700 and owned by the service user.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Incorrect default permissions
**CWE:** [CWE-276](https://cwe.mitre.org/data/definitions/276.html)
**Attack vector:** LOCAL
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256399

---

# Alby VSS bearer token stored unencrypted in user_configs although the unlock key is in hand

## Details
`service/start.go` `requestVssToken`, called from `launchLNBackend(ctx, encryptionKey)` where the unlock password is in hand, saves the VSS bearer JWT obtained from Alby's `/internal/auth_tokens` with `SetUpdate("VssToken", vssToken, "")` (line 544) and reads it back as a fallback with `Get("VssToken", "")` (line 536). With an empty key `config.set()` writes the row with `Encrypted=false`, so the token is stored in cleartext in `user_configs` even though every other backend secret read in the same function (`Mnemonic`, `LNDMacaroonHex`, `PhoenixdAuthorization`, ...) is encrypted under the unlock password. Unlike the Alby OAuth tokens (verified separately as alby-oauth-tokens-stored-plaintext-user-configs), which the hub must read and refresh before unlock (`/api/info` -> `IsConnected` -> `fetchUserToken`), the VSS token is written and consumed only on this post-unlock path, so the storage choice has no design necessity.

The LDK client passes the token to ldk-node as a fixed `Authorization: Bearer` header for `LDK_VSS_URL` (default `https://vss.getalbypro.com/vss`). When VSS is enabled - automatically for new nodes whose Alby account has a paid subscription, or via `MigrateNodeStorage` - it is the node's sole key-value store for the channel manager and channel monitors; the UI advertises it as end-to-end encrypted dynamic channel backup. A reader of `nwc.db` without the unlock password (threat-model adversary 7: another local user on a host where the systemd install runs as `$USER` with `WORK_DIR=$INSTALL_DIR/data` and the work dir is created with `os.ModePerm`, or anyone holding a copy of the database) extracts the JWT and can call the VSS API directly: `ListKeyVersions`, `PutObjects` and `DeleteObject` on the hub's namespace. Object values are client-side encrypted by ldk-node with a seed-derived key, so confidentiality loss is limited to metadata, but the attacker can overwrite or delete channel-manager/monitor objects or roll them back to an earlier version, which on the next start leaves the LDK node unable to load its channels or running with stale channel state (penalty risk). The `/api/backup` migration archive is encrypted with the unlock password, so the exposure is the live database file, not backups.

Assumptions: the lifetime of the server-issued token is set by Alby and not visible in this repository; the hub persists it as a cross-restart fallback and ldk-node uses it unchanged for the whole node run, so it is expected to remain valid for a long period. ldk-node-go (pinned v0.0.0-20261015143504-ca24bcee5b83) is assumed to use VSS as the only store when built with `BuildWithVssStoreAndFixedHeaders` and to encrypt values client-side.

## Evidence
1. [service/start.go:536–547](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L536-L547)
   requestVssToken persists the VSS bearer JWT with SetUpdate("VssToken", vssToken, "") (line 544) and fallback-reads it with Get("VssToken", "") (line 536). The empty key makes config.set() write the row with Encrypted=false, so the JWT sits in cleartext in user_configs; both the write and the only read happen inside launchLNBackend, which holds the unlock password.
2. [service/start.go:380–412](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L380-L412)
   launchLNBackend(ctx, encryptionKey) reads the sibling secrets (Mnemonic, LND cert/macaroon, Phoenixd password) with encryptionKey but calls svc.requestVssToken(ctx) at line 412 without passing it, so the token is the one backend credential on this path stored unprotected. The caller chain StartApp -> startAppInternal -> launchLNBackend always carries the unlock password.
3. [lnclient/ldk/ldk.go:283–286](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L283-L286)
   The token is handed to ldk-node as a fixed `Authorization: Bearer <vssToken>` header for LDK_VSS_URL. When VSS is enabled it is the node's only KV store (channel manager, channel monitors, scorer, graph); whoever presents the token can list, overwrite or delete those objects.
4. [config/config.go:287–295](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/config.go#L287-L295)
   config.set() encrypts with AES-GCM under the supplied key and sets Encrypted=true only when encryptionKey != ""; the storage layer supports per-row encryption and this caller opts out.
5. [service/start.go:502–520](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L502-L520)
   VSS is switched on automatically for brand-new nodes whose linked Alby account has a paid subscription (LdkVssEnabled=true), and LDK_VSS_URL defaults to https://vss.getalbypro.com/vss (config/models.go:40); the path is live in shipped builds for subscribers, and MigrateNodeStorage (api/api.go:2029) enables it for existing nodes.

## Impact
The token is the hub's write credential for its authoritative remote channel-state store. Values are client-side encrypted by ldk-node with a seed-derived key, so only key count, sizes and update activity leak (C:L). The attacker can overwrite, delete or roll back channel-manager and channel-monitor objects (I:H), and because no local copy exists when VSS is the store, deleting or corrupting them prevents the LDK node from loading its channels on the next start (A:H). No local wallet secret is disclosed.

## Reproduction steps
1. The attacker needs read access to nwc.db without the unlock password: another local account on the host (the Linux install runs the hub as the installing $USER under $HOME/albyhub/data, the work dir is created os.MkdirAll(..., os.ModePerm), the SQLite file gets the driver's default mode), or possession of a copy of the database file. They select the `VssToken` row and present it as `Authorization: Bearer` to LDK_VSS_URL; no brute force, no interaction with the operator, no unlock password. Preconditions outside the attacker's control: VSS must be enabled on the hub (paid Alby subscription, auto-enabled for new nodes or via MigrateNodeStorage) and the stored token must still be valid, whose lifetime Alby sets server-side.

## Recommended fix
1. requestVssToken writes and fallback-reads the VSS bearer token with an empty encryption key although its caller launchLNBackend holds the unlock password. Fix criteria: The unlock password is passed into requestVssToken; the VssToken row is written with Encrypted=true and the fallback read decrypts with the same key. After a VSS-enabled start, `user_configs` shows encrypted=1 for VssToken and the raw value is not a JWT; ChangeUnlockPassword re-encrypts it with the other Encrypted rows.
2. Existing installations already hold a cleartext VssToken row from earlier starts. Fix criteria: On the first start after the fix the plaintext row is replaced by an encrypted one (or deleted and re-fetched), so no upgraded database retains a cleartext VSS token.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Cleartext credential storage
**CWE:** [CWE-312](https://cwe.mitre.org/data/definitions/312.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256398

---

# Swap-in funds sent to Boltz-supplied lockup address before swap tree is verified

## Details
For an on-chain -> Lightning swap the hub must only send bitcoin to an output it can later refund: a taproot address derived from a swap tree whose refund leaf is spendable with the hub's key after TimeoutBlockHeight. The hub does verify this (tree.Init, tree.Check(NormalSwap, timeout, paymentHash), tree.CheckAddress(lockupAddress)) - but only inside startSwapInListener, which SwapIn starts as a goroutine at line 599, *after* it has already called lnClient.RedeemOnchainFunds(swap.Address, swap.ExpectedAmount) at line 580 when InternalPayment is set.

A malicious or impersonated swap provider therefore returns a CreateSwapResponse whose Address is an ordinary address it controls (with any SwapTree / ClaimPublicKey). The hub broadcasts ExpectedAmount to that address from its on-chain wallet. Milliseconds later the listener's tree.CheckAddress fails, the swap is marked FAILED, and RefundSwap (which repeats the same checks) can never build a refund because the output is not a swap script. The funds are gone; the provider never has to pay the invoice.

The same ordering problem exists for the manual-payment path: the unverified lockupAddress and sendAmountSat are persisted and rendered by the frontend as a BIP-21 payment URI while the swap is PENDING. Verification only happens once the websocket subscription succeeds, and subscribeToSwapUpdates retries indefinitely (2s..5min backoff) while the provider rejects the subscription, so a provider can keep the swap PENDING and the bogus address on screen for as long as it wants.

The maintainers clearly intend the tree checks to protect against exactly this (they are run before any claim/refund), but the funding step precedes them. Compare SwapOut, where the invoice is only paid from inside the listener after the tree has been checked.

## Evidence
1. [swaps/swaps\_service.go:579–599](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L579-L599)
   With internalPayment set, SwapIn calls lnClient.RedeemOnchainFunds(swap.Address, swap.ExpectedAmount, ...) synchronously at line 580, sending on-chain funds to the provider-supplied address; only afterwards (line 599) is startSwapInListener launched. No tree or address verification precedes the send.
2. [swaps/swaps\_service.go:962–1048](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L962-L1048)
   The only swap-in verification that swap.LockupAddress is the taproot output of a tree containing our refund key, the provider's claim key, the invoice hash and the timeout (tree.Init/Check/CheckAddress, lines 1029-1048) lives in the listener and runs only after subscribeToSwapUpdates returns; on failure the deferred handler marks the swap FAILED, but the funds have already left.
3. [swaps/swaps\_service.go:1453–1473](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1453-L1473)
   subscribeToSwapUpdates retries forever (2s doubling to 5min) while the provider refuses the websocket subscription, so the provider can defer the tree check indefinitely while the swap stays PENDING and the unverified address remains displayed.
4. [swaps/swaps\_service.go:760–770](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L760-L770)
   RefundSwap re-runs the same tree/address checks and returns an error when they fail, so funds sent to a non-swap-script address cannot be recovered through the hub.
5. [frontend/src/screens/wallet/swap/SwapInStatus.tsx:125](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/swap/SwapInStatus.tsx#L125)
   Manual-payment path: while the swap is PENDING and has no lockupTxId, the unverified lockupAddress and sendAmountSat from the provider's response are rendered as a bitcoin: BIP-21 QR code and 'Open in External Wallet' link (also line 158), before any verification has run.

## Impact
Unrecoverable loss of the full on-chain amount sent (combined with the unbounded ExpectedAmount this can be the whole on-chain balance). No confidentiality impact.

## Reproduction steps
1. Attacker is the swap provider or whoever answers in its name. The provider URL is https://api.boltz.exchange or https://api.satsrouting.exchange as selected by Alby's GetInfo (swaps/provider.go), or BOLTZ_API; swaps/provider.go only pins which provider, not the content of its responses. The operator initiates a swap-in from the hub's on-chain balance (frontend swap/index.tsx sets internalPayment: true for swapFrom === 'internal'; POST /api/swaps/in requires a full JWT). The provider returns a CreateSwapResponse whose Address is an ordinary address it controls; SwapIn sends ExpectedAmount there at line 580 and only then starts the listener whose tree.CheckAddress would have rejected it. Deterministic; no race. Assumptions on dependencies (not verified in the checkout): boltz-client v2.12.5 Api.CreateSwap is a plain HTTP client that performs no tree/address verification of the response, and ldk-node OnchainPayment().SendToAddress (and LND SendCoins) accept any valid Bitcoin address.

## Recommended fix
1. Funding (RedeemOnchainFunds) and persistence/display of the lockup address happen before the swap tree, Boltz key, timeout and address are verified against what the hub requested. Fix criteria: Perform tree.Init/Check/CheckAddress (and a sanity check of TimeoutBlockHeight against current height) synchronously in SwapIn, inside the DB transaction, before the swap row is committed, before any on-chain send and before the address is returned to the UI; a CreateSwap response whose address does not match the verified tree must fail the swap without any funds leaving the wallet.
2. Verification in the listener is gated behind a provider-controlled websocket subscription that retries forever. Fix criteria: Verification must not depend on the websocket subscription succeeding; a swap whose lockup address has not been verified must not be shown as payable.

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
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256397

---

# Swap-in internal payment sends Boltz-dictated ExpectedAmount on-chain without any bound

## Details
SwapIn() creates a Lightning invoice for the operator-approved amountSat, quotes the submarine pair (fees, limits), then asks Boltz to create the swap. Boltz's CreateSwapResponse.ExpectedAmount is the on-chain amount the hub must lock. The hub stores it as SendAmountSat and, when InitiateSwapInRequest.InternalPayment is true, immediately calls lnClient.RedeemOnchainFunds(swap.Address, swap.ExpectedAmount, feeRate, false), sending that exact amount from the hub's on-chain wallet.

Nothing checks ExpectedAmount against what the hub should owe (amountSat plus the quoted percentage fee, Alby fee and MinerFees from the same pairInfo used to build the request). The swap-out path has exactly this protection (calculateMaxSwapOutSendAmountSat + verifySwapOutInvoice, lines 371-376) but the swap-in path has none.

Attack: the swap provider (api.boltz.exchange / api.satsrouting.exchange, selected via Alby's GetInfo, or BOLTZ_API) or anyone able to return responses in its name answers CreateSwap with a valid swap tree for the hub's invoice but ExpectedAmount far larger than amountSat (e.g. the hub's whole on-chain balance). The hub sends it to the lockup script. Boltz then pays the small invoice, learns the preimage and claims the entire lockup. The operator approved a swap of amountSat and loses ExpectedAmount - amountSat. Because RedeemOnchainFunds runs with sendAll=false there is no 'send all' confirmation; and the maintainers' own comment notes a too-high amount can drain anchor reserves.

For the non-internal path the inflated SendAmountSat/lockupAddress is rendered to the operator as a BIP-21 URI (frontend SwapInStatus.tsx) with no indication that it differs from the approved amount, so a user paying from an external wallet is exposed to the same overcharge, though with a human in the loop.

The threat model lists Boltz among remote parties whose responses the hub must validate and names 'hub <-> Boltz (response validation)' as a trust boundary; this path crosses it unvalidated.

## Evidence
1. [swaps/swaps\_service.go:579–597](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L579-L597)
   With internalPayment=true the hub immediately calls lnClient.RedeemOnchainFunds(swap.Address, swap.ExpectedAmount, feeRate, false); the amount is taken verbatim from Boltz's CreateSwap response and the operator never sees it before the lockup is broadcast.
2. [swaps/swaps\_service.go:523–547](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L523-L547)
   CreateSwap response fields are persisted (SendAmountSat = swap.ExpectedAmount) with no comparison against amountSat plus the quoted fees (pairInfo.Fees.Percentage, MinerFees, AlbySwapServiceFeePercentage) fetched moments earlier at 466-487, nor against pairInfo.Limits.
3. [swaps/swaps\_service.go:371–375](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L371-L375)
   Contrast: the swap-out path bounds the Boltz-returned invoice amount via calculateMaxSwapOutSendAmountSat/verifySwapOutInvoice (10 sat tolerance), showing the project does not concede amount control to the provider; no equivalent exists for swap-in.
4. [swaps/swaps\_service.go:962–1124](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L962-L1124)
   startSwapInListener verifies the swap tree and address but never compares the lockup amount with the approved amount; after InvoicePaid it records success, so an over-funded lockup is never detected or refunded.
5. [api/api.go:1042–1071](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L1042-L1071)
   InitiateSwapIn (POST /api/swaps/in, full-access JWT; Wails mirror at wails_handlers.go:1133) passes the operator's amountSat and InternalPayment flag straight to SwapIn; the operator approves only amountSat and the UI-shown fee percentage, never the on-chain amount actually sent.
6. [lnclient/ldk/ldk.go:1425–1427](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L1425-L1427)
   RedeemOnchainFunds with sendAll=false calls OnchainPayment().SendToAddress(toAddress, amountSat, feePtr) for exactly the supplied amount; the maintainers' own note says a too-high amount can drain anchor reserves. LND's RedeemOnchainFunds (lnd.go:1272-1290) likewise sends Amount verbatim via SendCoins.

## Impact
Direct loss of on-chain funds: the provider pays the small invoice, learns the preimage and claims the whole lockup, netting ExpectedAmount - amountSat - normal fees, capped only by the backend's spendable on-chain balance (the hub itself imposes no cap). Assumption: boltz-client v2.12.5's CreateSwapResponse.ExpectedAmount is a provider-supplied uint64, and ldk-node-go (go.mod pin v0.0.0-20261015143504) SendToAddress sends exactly the requested amount; whether it protects anchor reserves is not verifiable in this checkout, so availability impact (anchor reserve drain noted by the maintainers' own comment) is rated LOW. No confidentiality impact.

## Reproduction steps
1. The attacker is the swap provider: the hub connects over HTTPS to https://api.boltz.exchange or https://api.satsrouting.exchange as selected by Alby's GetInfo (swaps/provider.go), or to the operator-set BOLTZ_API. A malicious or compromised provider answers CreateSwap with a valid swap tree for the hub's invoice but an ExpectedAmount larger than amountSat + quoted fees. The operator must initiate a swap-in with 'On-chain balance' selected (frontend swap/index.tsx sets internalPayment: true), after which the backend funds the lockup with ExpectedAmount without any further confirmation; the UI only shows '<fee>% + on-chain fees'. Deterministic, no defenses to bypass; requires the victim to perform an internal swap-in while the provider is hostile.

## Recommended fix
SwapIn trusts CreateSwapResponse.ExpectedAmount and sends it on-chain (and persists/displays it) without bounding it by the operator-approved amount plus the quoted fees. Fix criteria: Before persisting or funding, reject the swap if ExpectedAmount exceeds amountSat + quoted service fee + Alby fee + quoted MinerFees (plus a small tolerance); also enforce pair Limits. A CreateSwap response with an inflated ExpectedAmount must mark the swap failed and never reach RedeemOnchainFunds or the UI as a payable amount.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper Input Validation
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256396

---

# Alby OAuth access and refresh tokens persisted unencrypted in user_configs

## Details
The threat model lists Alby OAuth tokens among the hub's secrets and promises that secrets in user_configs stay encrypted at rest with the unlock password (as the mnemonic, LND macaroon, CLN keys and Phoenixd password are). The OAuth service does not honour that: saveToken() stores AlbyOAuthAccessToken, AlbyOAuthRefreshToken and the expiry via cfg.SetUpdate(..., ""), i.e. unencrypted, and fetchUserToken() reads them back without any key. The refresh token is long-lived and is sufficient on its own to mint new access tokens against api.getalby.com/oauth/token using the client credentials that are also constants in the binary (config/models.go defaults).

An attacker who can read the SQLite file / Postgres dump or a copy of it (adversary 7 in the threat model: backups of the work dir, shared Docker volumes, snapshots, a lower-privileged local account that can read the DB) obtains a bearer credential for the operator's Alby account without needing the unlock password. From the calls made in this file, that credential allows: reading the account profile (/internal/users: email, nostr pubkey, lightning address, plan), creating/deleting the account's lightning addresses, destroying the account's NWC node (DELETE /internal/nwcs) or re-activating it with a wallet_pubkey and relay the attacker chooses (PUT /internal/nwcs/activate) so that Alby-side services route the account's payments to the attacker's wallet service, overwriting the stored encrypted channel backup (/internal/backups), and obtaining a VSS auth token for the node's VSS namespace (/internal/auth_tokens). The exact server-side semantics of these internal endpoints are inferred from how this file uses them and are an assumption.

The design reason appears to be that IsConnected()/fetchUserToken() are invoked before unlock (service/start.go:318 and the unauthenticated /api/info), so the token must be readable without the password; that constraint should be solved differently (e.g. only checking presence pre-unlock, or deriving a separate at-rest key) rather than by storing the credential in the clear. Note also that api/backup.go:114 clears only the access token before exporting a migration file, leaving the refresh token inside the (password-encrypted) archive.

## Evidence
1. [alby/alby\_oauth\_service.go:196–209](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_oauth_service.go#L196-L209)
   saveToken writes AlbyOAuthRefreshToken, AlbyOAuthAccessToken and the expiry with cfg.SetUpdate(key, value, "") — an empty encryption key — so all three rows are stored as plaintext. This is the code the fix must change.
2. [config/config.go:287–295](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/config.go#L287-L295)
   config.set applies AES-GCM only when encryptionKey != ""; with an empty key the value is written verbatim and Encrypted=false, so the unlock-password at-rest protection (used for Mnemonic, JWTSecret, LND/CLN/Phoenixd credentials) does not apply to these rows and ChangeUnlockPassword never re-encrypts them.
3. [alby/alby\_oauth\_service.go:214–273](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_oauth_service.go#L214-L273)
   fetchUserToken reads all three values back with an empty key and, when the access token is near expiry, refreshes it via oauthConf.TokenSource using only the stored refresh token plus the client credentials — demonstrating that the refresh token alone, without the unlock password, yields fresh access tokens.
4. [config/models.go:51–52](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/models.go#L51-L52)
   The OAuth client id/secret used for the refresh (AuthStyle HTTP Basic) default to constants compiled into every shipped binary (J2PbXS1yOf / rABK2n16IWjLTZ9M1uKU), so a DB reader needs nothing beyond the plaintext refresh token to call api.getalby.com/oauth/token.
5. [service/start.go:313–320](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L313-L320)
   startAppInternal calls IsConnected (which triggers fetchUserToken/refresh) before CheckUnlockPassword, and the unauthenticated GET /api/info (api/api.go:1557) does the same — the design constraint that led to the tokens being kept readable without the password; a fix must only test for a linked account pre-unlock.
6. [alby/alby\_oauth\_service.go:866–1025](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_oauth_service.go#L866-L1025)
   What a stolen token grants: POST/DELETE /internal/nwcs and PUT /internal/nwcs/activate with an attacker-chosen wallet_pubkey/relay_url (re-point the account's NWC client), plus elsewhere in the file /internal/backups (overwrite the stored encrypted channel backup), /internal/lightning_addresses create/delete, /internal/auth_tokens (VSS token) and /internal/users (account profile). Server-side semantics are inferred from client usage.

## Impact
On the hub itself the exposed asset is the OAuth credential (confidentiality of a secret the threat model says must be encrypted at rest); the hub's own funds and keys are not directly affected. Subsequent-system impact: The stolen token is a credential for the operator's Alby account. Per the API calls in this file it can read account PII, destroy or re-point the account's NWC node to an attacker wallet (diverting lightning-address payments), overwrite the uploaded channel backup and obtain VSS tokens for the node's remote store; the server-side effect of these internal endpoints is assumed from client usage.

## Reproduction steps
1. Requires read access to the hub's database file or a copy (local account, volume/backup access) but not the unlock password or root. The attacker extracts AlbyOAuthRefreshToken, refreshes it with the public default client credentials and calls api.getalby.com directly. No defensive mechanism must be defeated.

## Recommended fix
1. OAuth access/refresh tokens are written to user_configs with an empty encryption key, violating the at-rest encryption promise made for all other credentials. Fix criteria: The refresh (and access) token rows are stored encrypted under the unlock-password-derived key (or another key not present in the DB), with Encrypted=true, and are re-encrypted on password change. Reading the raw DB must not yield a usable token.
2. Pre-unlock code paths (/api/info IsConnected, startAppInternal) depend on decrypting and refreshing the token without the password, which forces plaintext storage. Fix criteria: Pre-unlock checks only test for the presence of a linked account (identifier/flag), and any token refresh happens after the unlock password is available; node startup and /api/info work without a decryptable token.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Cleartext Storage of Sensitive Information
**CWE:** [CWE-312](https://cwe.mitre.org/data/definitions/312.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256393

---

# NIP-47 replay protection is a prunable 1000-row window; relay can re-execute signed requests

## Details
The hub's defence against a relay replaying or re-broadcasting an already-processed NIP-47 request is the UNIQUE request_events.nostr_id row created in HandleEvent. The maintainers' own comment (event_handler.go:348-351) acknowledges relays forward old requests and relies on this check plus a 6-hour created_at bound that is applied only to pay_invoice/make_invoice scopes.

However service.removeExcessEvents (run every 10 minutes) deletes all but the newest ~1000 request_events rows. The dedup record is therefore a rolling window, not a permanent log. Two consequences:

1. Any signed request older than the window is accepted again when redelivered with its original ID. The relay operator (an adversary in the recorded threat model) or anyone able to inject into the hub's subscription can resurrect: `create_connection` (re-creating a connection the operator has since deleted, since the UNIQUE app_pubkey only blocks it while the original still exists), `sign_message` (re-obtaining node signatures), `list_transactions`/`lookup_invoice`/`get_balance` (fresh disclosure under a possibly-revoked-but-not-expired state), and, within 6 hours of created_at, `pay_keysend`/`multi_pay_keysend`, which SendKeysend executes again as a brand-new payment because keysend has no payment-hash duplicate guard. A failed earlier `pay_invoice` can likewise be retried by replay.

2. The window can be flushed by an unauthenticated party: HandleEvent inserts the request_events row before looking up the app, and the subscription filter accepts any kind-23194 event p-tagged to a wallet pubkey (public via kind-13194 info events / pairing URIs). ~1100 junk events push every legitimate ID out of the window within one pruner cycle, after which the relay's replay of a request from minutes ago succeeds.

Impact is bounded by the original app's scopes/budget and by the 6h bound for payments, but the relay gains the ability to repeat authorised spends (keysend up to the remaining budget), resurrect deleted connections, and re-trigger disclosures without the app's or operator's involvement. Note also that the hub does not verify that event.ID equals sha256(serialized event): if the pinned getAlby/go-nostr (v0.0.0-20260805072924) `CheckSignature` only verifies the Schnorr signature over the computed hash (as upstream go-nostr does) and does not call CheckID, a relay can bypass the window entirely by redelivering a request with a mutated `id`; this is stated as an assumption, the pruning path above does not depend on it.

## Evidence
1. [nip47/event\_handler.go:57–71](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/event_handler.go#L57-L71)
   The only replay guard: a RequestEvent row keyed on event.ID is inserted and gorm.ErrDuplicatedKey is treated as 'already processed' (nostr_id is UNIQUE per migration 202407151352). The row is inserted BEFORE the app lookup (line 73), so events from any unknown pubkey also consume rows.
2. [service/service.go:297–332](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/service.go#L297-L332)
   removeExcessEvents keeps only the newest ~1000 request_events and deletes everything older (once >100 excess exist). Once a request's row is gone, the same signed event is accepted again.
3. [service/service.go:168–177](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/service.go#L168-L177)
   The pruner runs every 10 minutes for the lifetime of the service.
4. [nip47/event\_handler.go:348–359](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/event_handler.go#L348-L359)
   The created_at age check (6h) applies only to pay_invoice and make_invoice scopes; sign_message, create_connection, list_transactions, lookup_invoice, get_balance etc. have no age bound, and payment methods are replayable inside 6h.
5. [transactions/transactions\_service.go:472–536](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L472-L536)
   SendKeysend generates a fresh random preimage when the request omits one and has no duplicate-payment guard (unlike SendPaymentSync, which checks settled/pending by payment hash); each replay creates and sends a new payment within the app's budget.
6. [nip47/controllers/pay\_keysend\_controller.go:52](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/pay_keysend_controller.go#L52)
   pay_keysend (and multi_pay_keysend, which shares this path) reaches SendKeysend with the replayed request's parameters.
7. [service/start.go:198–201](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L198-L201)
   Subscription filter is kind 23194 + #p=wallet pubkey only; anyone who knows a wallet pubkey (published in the kind-13194 info event) can post events that pass the filter and reach the DB insert. Each event is dispatched to HandleEvent in its own goroutine (line 240) with no rate limit.
8. [nip47/event\_handler\_test.go:241–251](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/event_handler_test.go#L241-L251)
   The project's own test asserts that re-delivering an already-processed event must produce no second response ('second time it should not publish'): non-re-execution is the intended, shipped control, which the pruner silently removes.

## Impact
Integrity: a replayed pay_keysend/multi_pay_keysend within 6h of created_at is executed by SendKeysend as a brand-new payment (fresh random preimage when the request omits one, transactions_service.go:473-478; no payment-hash duplicate guard unlike SendPaymentSync at 360-392), spending the hub's funds again without the app's authorisation, bounded only by validateCanPay's remaining budget (1195-1214) and the 6h bound; create_connection has no age bound and its replay re-creates a connection the operator has deleted, restoring the revoked key holder's scopes and budget. Confidentiality: responses are encrypted to the app key, so the replayer itself reads nothing; the resurrected-connection path restores read access (list_transactions, get_balance) to a revoked app, rated LOW. Availability: none.

## Reproduction steps
1. The attacker is anyone who can observe and republish kind-23194 events on the hub's configured relay (default wss://relay.getalby.com): the relay operator, whom the recorded threat model says can replay events, or any ordinary relay subscriber, since kind 23194 is in Nostr's ephemeral range and is forwarded to every subscriber whose filter matches, and the hub's wallet pubkeys are public (kind-13194 info events, start.go:150/173). The attacker holds no app key. They capture a signed request, optionally flush the dedup window by publishing ~1100 arbitrary signed kind-23194 events p-tagged to the wallet pubkey (each inserts a request_events row at event_handler.go:58-59 before the app lookup at line 73), wait for the 10-minute pruner (service.go:168-178, 297-325), then republish the original event; the UNIQUE check no longer fires and the request is executed again. No credentials and no user interaction are needed; the only requirement is possession of a previously broadcast request and the window having cycled.

## Recommended fix
1. Replay detection depends on a request_events row that a periodic pruner deletes, so uniqueness is only enforced over the most recent ~1000 requests. Fix criteria: A request whose ID has ever been processed must be rejected for as long as it could still be accepted; e.g. keep processed IDs for at least the maximum accepted request age, or reject any request whose created_at is older than the retention horizon. Verify that redelivering a processed event after pruning produces no second execution.
2. The created_at age bound is applied only to pay_invoice/make_invoice scopes, leaving create_connection, sign_message and read methods replayable indefinitely. Fix criteria: Apply a bounded maximum request age to every method (NIP-47 clients may also set an expiration tag that the hub should honour), so that no request older than the dedup retention can be executed.
3. The dedup row is inserted before the sender is matched to an app, letting unauthenticated events consume and flush the window. Fix criteria: Only requests from a known app pubkey should occupy replay-protection state; junk events from unknown keys must not be able to evict legitimate IDs.
4. event.ID is trusted as the dedup key without checking it equals the hash of the serialized event. Fix criteria: Verify the event ID matches sha256(serialization) (or derive the dedup key from the serialization) so a redelivered event with a mutated id cannot bypass duplicate detection.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Replay attack
**CWE:** [CWE-294](https://cwe.mitre.org/data/definitions/294.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256387

---

# Operator-private transaction labels exposed to NWC apps through NIP-47 metadata

## Details
Alby Hub lets the operator attach free-text labels (key/value) to any transaction from the Hub UI (PATCH /api/transactions/:id/labels -> api.SetTransactionUserLabels -> transactionsService.SetTransactionUserLabels). The labels are a hub-local annotation feature: they are only written by the operator, searched by the Hub's own transaction list, and rendered in the Hub frontend. The threat model records transaction labels as a privacy asset of the operator.

The implementation stores the labels inside the transaction's generic `metadata` JSON column under `user_labels` (transactions_service.go:1470). That same `metadata` column is what the NIP-47 layer returns to connected apps: `models.ToNip47Transaction` (nip47/models/transactions.go:33-57) unmarshals the stored blob and places the whole map in the response `metadata` field without removing any hub-internal keys. Every app connection holding the `list_transactions` scope (or `lookup_invoice`) therefore receives the operator's private labels. For a non-isolated app, `list_transactions` is executed with `forceFilterByAppId=false`, so the app receives labels on every transaction in the hub, including payments made by other apps and by the operator manually.

Root cause: hub-internal, operator-private annotations are commingled with app-visible metadata in one JSON column, and the NIP-47 serialiser treats the entire column as app-visible. The same pattern also leaks other hub-internal keys written into metadata by the hub itself (e.g. `receive_through`, `order_id`, `amount_sat` written by api/rebalance.go lines 32-34 and 129-133), revealing the operator's rebalance activity and counterparties to apps, though those are less sensitive than free-text notes.

Attacker: any holder of an app-connection keypair with the `list_transactions` scope (a malicious or compromised NWC app). They send a signed `list_transactions` request to the relay and read `metadata.user_labels` from the response for every transaction. The operator has no indication in the UI that labels are shared with apps. Because labels are free text (e.g. 'rent to <name>', 'salary', 'donation to X'), the disclosure can be materially sensitive.

## Evidence
1. [nip47/models/transactions.go:33–57](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/models/transactions.go#L33-L57)
   ToNip47Transaction unmarshals the whole stored metadata JSON and copies the map verbatim into the NIP-47 Transaction.Metadata field returned to app connections. No hub-internal key (user_labels, rebalance receive_through/order_id/amount_sat) is stripped. This is the fix point.
2. [transactions/transactions\_service.go:1439–1473](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1439-L1473)
   SetTransactionUserLabels stores the operator's labels inside the same metadata JSON column under the key user_labels (line 1470) via SetTransactionMetadata, commingling operator-private annotations with app-visible metadata.
3. [nip47/controllers/list\_transactions\_controller.go:54–72](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/list_transactions_controller.go#L54-L72)
   list_transactions calls ListTransactions with forceFilterByAppId=false and serialises each result through ToNip47Transaction, so labels are returned per transaction (up to 50 per page, pageable via offset).
4. [transactions/transactions\_service.go:661–683](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L661-L683)
   ListTransactions applies the app_id filter only when the app is isolated or forceFilterByAppId is set; for a non-isolated app connection every hub transaction (operator-manual, other apps, rebalances) is returned, so the app receives labels on transactions unrelated to it.
5. [nip47/controllers/lookup\_invoice\_controller.go:62–78](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/lookup_invoice_controller.go#L62-L78)
   lookup_invoice resolves any payment hash via LookupTransaction (which filters by app_id only for isolated apps, transactions_service.go:606-628) and serialises it through ToNip47Transaction, exposing labels per payment hash.
6. [nip47/notifications/nip47\_notifier.go:40–89](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/notifications/nip47_notifier.go#L40-L89)
   Secondary consumer: payment_received / payment_sent / hold_invoice_accepted notifications also serialise the transaction through ToNip47Transaction, so labels applied to a pending transaction before settlement are pushed to apps with the notifications scope.
7. [http/http\_service.go:175](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L175)
   The only writer of user_labels is the operator: PATCH /transactions/:id/labels is registered on fullAccessApiGroup (full-access JWT), mirrored for the desktop app in wails/wails_handlers.go:274-295. Labels are rendered by the Hub UI as a distinct 'Labels' row separate from the raw 'Metadata' row (frontend/src/components/TransactionItem.tsx:70,342,391) with no notice that they are shared with apps.
8. [api/transactions.go:48–50](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/transactions.go#L48-L50)
   API wrapper through which the HTTP and Wails transports call SetTransactionUserLabels; the operator-only entry point that creates the private data.

## Impact
Confidentiality: operator-private free-text annotations on all transactions are disclosed to third-party apps that were only granted transaction-history access; the operator has no way to label privately. Limited to annotation data, so LOW rather than HIGH. No integrity or availability impact.

## Reproduction steps
1. Attacker holds an app connection with the list_transactions (or lookup_invoice) scope - an ordinary NWC app the operator connected. They post a signed kind-23194 list_transactions request to the relay; the hub answers with every transaction (non-isolated app) including metadata.user_labels. No user interaction, no special deployment state; the attack works against any hub where the operator has labelled transactions. Network-reachable via the Nostr relay.

## Recommended fix
ToNip47Transaction returns the entire stored metadata map, including hub-internal keys that were never intended for app consumption (user_labels, rebalance bookkeeping). Fix criteria: NIP-47 responses must not contain operator-private annotations: list_transactions and lookup_invoice responses for any app must omit user_labels (and other hub-internal keys), either by stripping a defined set of internal keys or by storing labels outside the app-visible metadata column. Verify by labelling a transaction and confirming a list_transactions/lookup_invoice response from a non-isolated app contains no user_labels key while app-supplied metadata is still returned.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Information disclosure
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256386

---

# Expired app connections still receive get_info and get_budget responses

## Details
App connections carry an expiry (AppPermission.ExpiresAt). README.md:395 documents it as 'connection cannot be used after this date', the SPA offers it as 'Automatically expire this connection' and badges such apps 'Expired', and the only enforcement is HasPermission (nip47/permissions/permissions.go:48-57), which returns ERROR_EXPIRED. HandleEvent (nip47/event_handler.go:335) skips HasPermission entirely for the always-granted methods get_info and get_budget, and the controllers do not re-check expiry: HandleGetInfoEvent assembles and publishes its payload - the operator's Alby lightning address (lud16) for non-isolated apps, app metadata (operator-editable via UpdateApp), permitted methods and notification types - before the HasPermission call that guards only the node-info block; HandleGetBudgetEvent returns the pay_invoice budget total, usage and renewal with no check at all. Relay subscriptions are started for every app with a wallet pubkey regardless of expiry (service/start.go:181), so a kind-23194 request signed with an expired connection's key is delivered, decrypted and answered with a signed success response.

Gain for a holder of an expired connection secret (a former app that kept it, or a secret leaked after expiry): the operator's lud16 - which is not in the public kind-13194 info event and is otherwise handed only to live, operator-authorised connections - plus the connection's current budget configuration/usage and metadata, including edits the operator made after expiry. The method/notification list is already public via the info event and adds nothing. The threat model names expiry as a bound on NIP-47 clients; this path acts around that control for two methods. Impact is confined to low-sensitivity disclosure: no funds movement, no integrity or availability effect. The existing tests (get_info_controller_test.go NoPermission cases) cover only the missing-scope case with ExpiresAt nil; no test covers an expired app.

## Evidence
1. [nip47/event\_handler.go:335–391](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/event_handler.go#L335-L391)
   HasPermission, the only code that consults AppPermission.ExpiresAt, is skipped entirely for methods in GetAlwaysGrantedMethods; the switch at 411-413 and 423-425 then dispatches get_budget/get_info for the expired app with no expiry check.
2. [nip47/permissions/permissions.go:38–61](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/permissions/permissions.go#L38-L61)
   HasPermission is the sole place expiry is enforced (lines 48-57 return ERROR_EXPIRED). GetPermittedMethods (63-95) and PermitsNotifications (97-105), which the controllers use instead, ignore ExpiresAt.
3. [nip47/permissions/permissions.go:195–197](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/permissions/permissions.go#L195-L197)
   get_info and get_budget are the always-granted methods that bypass HasPermission.
4. [nip47/controllers/get\_info\_controller.go:29–68](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/get_info_controller.go#L29-L68)
   The response payload - permitted methods, notification types, app metadata and, for non-isolated apps, the operator's Alby lightning address (lud16) - is assembled before the HasPermission call at line 73, which gates only the node-info block (73-104). The payload is published at 106 regardless.
5. [nip47/controllers/get\_budget\_controller.go:25–79](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/get_budget_controller.go#L25-L79)
   The pay_invoice permission row is read and its budget total, usage and renewal returned; ExpiresAt is never consulted.
6. [service/start.go:179–191](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L179-L191)
   A relay subscription is started for every app with a wallet pubkey regardless of expiry, so a request signed with an expired connection's key is delivered to HandleEvent.
7. [README.md:395](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/README.md#L395)
   The project's documented contract for expires_at: 'connection cannot be used after this date'.

## Impact
Discloses the operator's Alby lightning address (non-isolated apps), the connection's current budget total/usage/renewal and operator-edited metadata to a credential the README says cannot be used after expiry. No funds movement; no state change beyond last_used_at, which every request (denied or not) already bumps; no availability effect. Confidentiality LOW, Integrity NONE, Availability NONE.

## Reproduction steps
1. Attacker holds the keypair of an app connection whose permissions have passed ExpiresAt. They post a kind-23194 get_info or get_budget request to the relay; the hub's per-app subscription (service/start.go:181) delivers it, HandleEvent skips HasPermission for these methods (event_handler.go:335), and a signed success response is published. No user interaction, deterministic. PR:L because a once-issued connection credential is required.

## Recommended fix
The expiry check lives only inside HasPermission, which HandleEvent bypasses for GetAlwaysGrantedMethods and which the get_info and get_budget controllers do not re-apply before building their payloads. Fix criteria: A connection whose permissions have passed ExpiresAt receives ERROR_EXPIRED for every method, including get_info and get_budget, before any payload (lud16, metadata, methods, budget) is assembled or published; covered by tests in which an expired app calls get_info and get_budget and receives no result fields.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Insufficient session expiration
**CWE:** [CWE-613](https://cwe.mitre.org/data/definitions/613.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256384

---

# Request and route loggers persist Alby OAuth authorization code in query string to log file

## Details
Alby Hub logs the full request URI of every HTTP request at Info level (http/http_service.go:73-91). Echo's RequestLogger fills values.URI from the raw request-URI, so the query string is included and nothing is redacted. The Alby account-linking flow deliberately carries its OAuth authorization code in the query string: the SPA's AuthCodeForm issues GET /api/alby/callback?code=<code> (AuthCodeForm.tsx:46) and, with a custom client, Alby redirects the browser to BASE_URL/api/alby/callback?code=<code>. Every such request is therefore written, code included, to stdout and to WORK_DIR/log/nwc.log (logger.go:35-52, retained 3 days, 3 backups, LOG_TO_FILE default true). In desktop mode there is no request logger, but wails_handlers.go:43-46 logs the matched route string -- still containing ?code=... -- at Error level whenever CallbackHandler fails.

The code is single-use, so in the success path the logged value is dead by the time it is written (the earlier dismissal, dismissed-http-service-80-7e74, rests on this). The failure path is different: when oauthConf.Exchange, saveTokenWithRetries or GetMe fails (Alby API outage, network error, DB busy -- saveTokenWithRetries exists because this happens), the code is not consumed and remains redeemable until Alby expires it, and both loggers have already persisted it. Because the default client id and client secret are hard-coded in the shipped binary (config/models.go:51-52) and the default redirect URI is fixed, the code alone is enough to complete the exchange from any host. The resulting token is what the hub itself uses against api.getalby.com /internal endpoints: creating/activating NWC nodes for the account, creating and deleting lightning addresses, LSP orders, VSS token issuance.

The same logger also persists POST /api/payments/<bolt11> (payment destination, amount and memo of every payment made from the UI) and GET /api/transactions/<payment_hash>, giving a payment-history trail in the log that outlives the operator's view of it.

Readers of these logs who are not the operator: journald readers under the documented systemd install (root, systemd-journal, adm), Docker/fly/render log stores, local users able to read nwc.log, and Alby support, to whom Debug Tools > Get App Logs (GET /api/log/app, api.go:2108-2117) output is pasted. This contradicts the threat model's expectation for adversary 7 that nothing sensitive is logged.

Assumptions stated explicitly: labstack/echo v4.16.0 RequestLogger sets values.URI = req.RequestURI and calls LogValuesFunc after the handler returns; lumberjackrus v1.0.1/lumberjack v2.2.1 create new log files 0600 (so the file itself is readable only by the hub's user or root, while stdout copies have their own readers). Alby's authorization-code lifetime is not known from this repository.

## Evidence
1. [http/http\_service.go:73–91](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L73-L91)
   Echo RequestLoggerWithConfig is registered globally with LogURI: true and a LogValuesFunc that writes values.URI (echo v4.16.0 fills it from req.RequestURI, i.e. path plus raw query string) at Info level through logger.Logger. Every request, including GET /api/alby/callback?code=<authorization code> and POST /api/payments/<bolt11>, is written verbatim to stdout and, via the Info-level file hook, to WORK_DIR/log/nwc.log. Nothing strips or redacts the query string. This is the fix location: redact or drop the query string.
2. [alby/alby\_oauth\_service.go:102–111](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_oauth_service.go#L102-L111)
   CallbackHandler exchanges the code via oauthConf.Exchange with no PKCE verifier (AuthCodeURL("unused"), line 521). If Exchange fails before Alby consumes the code (network error / 5xx to api.getalby.com) the code is not consumed; it has already been logged and remains redeemable until Alby expires it. Failures after Exchange (saveTokenWithRetries, GetMe, identifier mismatch) leave a consumed, dead code.
3. [http/alby\_http\_service.go:124–149](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/alby_http_service.go#L124-L149)
   The unauthenticated callback reads the code from the query string (c.QueryParam) and hands it to CallbackHandler; on failure it returns 500 but the request logger has already captured the URI including the still-valid code.
4. [frontend/src/components/AuthCodeForm.tsx:46–49](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/AuthCodeForm.tsx#L46-L49)
   In the default-client flow (info.oauthRedirect false, api.go:1533) the SPA submits the operator-pasted authorization code as a GET query parameter, which is what places the secret into the logged URI in both HTTP and Wails modes.
5. [config/models.go:51–52](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/config/models.go#L51-L52)
   The default OAuth client id and client secret are hard-coded in the shipped binary and the redirect URL for the default client is fixed (https://getalby.com/hub/callback, alby_oauth_service.go:78-79), so possession of a fresh authorization code alone is sufficient to complete the token exchange from any machine. With a custom client (non-public secret) the logged code is not redeemable by a third party.
6. [logger/logger.go:35–51](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/logger/logger.go#L35-L51)
   The lumberjackrus hook persists every Info-and-above entry to WORK_DIR/log/nwc.log, retained 3 days with 3 backups (LOG_TO_FILE defaults to true, config/models.go:30); the same lines go to stdout. lumberjack v2.2.1 creates the file 0600, so the file itself is readable only by the hub's uid or root; the stdout copy has its own readers (journald, container log store).
7. [scripts/linux-x86\_64/install.sh:189–191](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/scripts/linux-x86_64/install.sh#L189-L191)
   The documented systemd install runs the hub as the installing user with stdout captured by journald, so every logged URI is readable by members of the systemd-journal/adm groups who are neither the operator nor root and cannot read the 0600 nwc.log or the work dir — the distinct local position (threat-model adversary 7) that gains from this log line.
8. [wails/wails\_handlers.go:30–47](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/wails/wails_handlers.go#L30-L47)
   Desktop path: the route string matched by albyCallbackRegex still contains ?code=<code>; when CallbackHandler fails the whole route is logged at Error level with "route": route — exactly the case in which the code may not have been consumed. Readers here are limited to the user's own nwc.log (0600) and process stdout, so this is a secondary sink.
9. [api/api.go:2108–2116](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L2108-L2116)
   GET /api/log/app returns the tail of nwc.log to any full-access JWT holder and is surfaced in Settings > Debug Tools as 'Get App Logs' (DebugTools.tsx:402-404), the output operators paste into support requests or issues; the logged authorization codes and payment URIs travel with it.

## Impact
On the hub itself the log discloses hub-held data: every UI payment's bolt11 (POST /api/payments/<invoice>, destination/amount/memo), looked-up payment hashes, and the OAuth authorization code; the transactions service otherwise logs bolt11 only on decode/expiry errors and for hold invoices, so the request logger is what records every UI payment. The token obtained does not unlock the hub, its node or its secrets, so confidentiality impact on the hub is low and there is no integrity or availability effect on the hub. Subsequent-system impact: A redeemed code yields account:read tokens that the hub's own code uses against api.getalby.com /internal endpoints: read /me (email, identifier, lightning address), create/delete lightning addresses, create/activate NWC nodes, request VSS tokens and LSP orders. That is read and limited write access to the operator's Alby account, outside the hub's boundary; it does not reach funds held by the hub.

## Reproduction steps
1. Attacker: a local account that can read the hub's stdout stream but is not the operator or root — a systemd-journal/adm group member under the shipped systemd unit (install.sh:189, User=$USER, stdout to journald), or a party the operator later shares Debug Tools / `fly logs` output with. The operator (default client, AUTO_LINK_ALBY_ACCOUNT default true) pastes the authorization code into the SPA, which GETs /api/alby/callback?code=X; the request logger persists X at Info before/regardless of the outcome. If oauthConf.Exchange fails before api.getalby.com consumes the code (outbound network error, 5xx), X stays redeemable until Alby expires it or the operator retries. The attacker reads X from the journal and, with the public default client id/secret, the fixed redirect URI and no PKCE, completes POST /oauth/token from any host. Requires the failed-exchange state plus log access inside the code's lifetime, hence attack requirements present; the operator's linking action is normal onboarding, not interaction with attacker content. Assumptions: echo v4.16.0 sets values.URI from req.RequestURI; Alby's authorization codes are single-use (RFC 6749) with a lifetime not known from this repository.

## Recommended fix
1. The global request logger writes the raw request URI, including the query string, at Info level to a persisted log; secrets carried in query strings (the OAuth authorization code) are therefore persisted. Fix criteria: Request logging must not persist query-string values (log the path only, or redact known sensitive parameters such as code); after the fix, a failed or successful GET /api/alby/callback?code=X leaves no occurrence of X in stdout or nwc.log.
2. The Wails request router logs the full route string, including ?code=..., at Error level when the OAuth callback fails -- the exact case in which the code is still redeemable. Fix criteria: Error logs on the desktop callback path must not include the code (log only the path or a redacted route); a failing exchange in desktop mode leaves no authorization code in the log output.
3. The frontend delivers the authorization code in a GET query string, exposing it to every URI-level logger and to browser history. Fix criteria: The code should be delivered in a POST body (or equivalent non-URI channel) for the SPA-driven flow so that URI-level logging cannot capture it; the custom-client browser redirect path, which must use the query string, is covered by the redaction above.

---
**Severity:** LOW
**Status:** Open
**Category:** Sensitive information in logs
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** LOCAL
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** NONE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256540

---

# Payment preimages, keysend TLVs and Alby account PII logged at default Info level to persisted log

## Details
At the default log level (LOG_LEVEL=4, Info; config/models.go:29) and default LOG_TO_FILE=true (config/models.go:30), Alby Hub's logrus logger writes Info/Error entries whose fields carry payment secrets and personal data to stdout and to the persisted WORK_DIR/log/nwc.log (file hook at InfoLevel, 3-day/3-backup rotation; logger/logger.go:35-52):

1. Payment preimages. NIP-47 settle_hold_invoice logs the client-supplied preimage at Info before settlement (nip47/controllers/settle_hold_invoice_controller.go:25-29) and at Error on failure (33-37); LND SendKeysend logs the keysend preimage at Info on success (lnclient/lnd/lnd.go:564-567) and at Error on every failure path (483-562); LND subscribeInvoices logs each settled *lnrpc.Invoice whole, including RPreimage, Memo, PaymentRequest and HTLC CustomRecords (lnd.go:225-227; the same struct's RPreimage/Memo/CustomRecords are read at 1570-1598); LDK handleLdkEvent logs every ldk_node.Event whole at Info (lnclient/ldk/ldk.go:1711-1713) and SendPaymentSync logs the EventPaymentSuccessful whole (676-678) before reading event.PaymentPreimage from it (680-685); LDK and LND SettleHoldInvoice log the preimage at Error (ldk.go:2670, 2695; lnd.go:796, 806); the self hold-payment path logs the settled *db.Transaction, whose Preimage field is then dereferenced (transactions/transactions_service.go:1125-1127), and SettleHoldInvoice logs the preimage at Error (1344, 1354). A preimage is the bearer proof of payment a third party can present to the payee; for hold invoices it is the secret the receiving app withholds until it chooses to settle, and the hub persists it the moment the app releases it, whether or not settlement succeeds.

2. Third-party payload data. The whole-struct lnrpc.Invoice and ldk_node.Event entries include settled-HTLC custom records / keysend TLVs supplied by remote payers (boostagram messages, sender names, app identifiers) and, for channel closes, the counterparty's free-text reason.

3. Operator PII. GetMe logs the full AlbyMe struct (alby/models.go:91-102: identifier, nostr_pubkey, lightning_address, email, name, avatar, keysend_pubkey, subscription) at Info (alby/alby_oauth_service.go:516). It runs on every GET /api/alby/me (http/alby_http_service.go:152; the SPA's useAlbyMe dedupes only 5 minutes), on every /api/health call while LdkVssEnabled is true (api/api.go:2152-2153), at startup (service/start.go:511), in the OAuth callback (alby_oauth_service.go:113) and via the Wails route (wails/wails_handlers.go:445). Only the lightning address is persisted elsewhere (alby_oauth_service.go:511); the email and name exist on the hub only in this log.

Who reads it: the threat model names 'local attackers with read access to the work dir, DB or logs' (adversary 7) with the property 'nothing sensitive logged'. Under the documented systemd install (scripts/linux-*/install.sh units set no StandardOutput, so stdout goes to the journal; scripts/linux-*/README.md tells operators to read it with journalctl -u albyhub) the entries are readable by root and the systemd-journal/adm groups; under Docker, fly.io and Render they land in the platform's log store; and Settings > Debug Tools > Get App Logs (GET /api/log/app, api/api.go:2108-2117, full-JWT) returns the file tail for pasting into support requests with no warning that it contains secrets (frontend/src/screens/settings/DebugTools.tsx:203-250). For a reader who can only see the log (journal group member, log aggregator, support recipient) the gain is the entire preimage history, remote payers' TLV payloads and the operator's email/name; for a reader who already has the 0644 SQLite database the preimages and TLVs add nothing (db.Transaction stores them in plaintext by design), but the email and name are still new.

README.md:655 ('Sensitive data such as the seed phrase are saved AES-encrypted … This data is not logged') covers only the AES-encrypted secrets and is not contradicted; the property violated is the threat model's 'nothing sensitive logged'. Severity is low: nothing here yields funds or control of the hub.

Assumptions (dependencies not inspected): ldk-node-go (go.mod pin v0.0.0-20261015143504-ca24bcee5b83) EventPaymentSuccessful carries PaymentPreimage and EventPaymentReceived carries CustomRecords, as the hub's own field accesses imply; lnrpc.Invoice (lnd v0.21.4-beta) carries RPreimage, Memo and Htlcs[].CustomRecords with json tags, so logrus's JSONFormatter serialises them; lumberjack v2.2.1 creates nwc.log 0600, so the file itself is readable only by the hub's user while stdout reaches the journal/container store unchanged.

## Evidence
1. [nip47/controllers/settle\_hold\_invoice\_controller.go:25–37](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/settle_hold_invoice_controller.go#L25-L37)
   The preimage supplied by the NIP-47 client in settle_hold_invoice is logged at Info ('Settling hold invoice') before the settle call, and again at Error on failure. For a hold invoice the preimage is the secret the receiving app holds back until it decides to settle; it is persisted here regardless of outcome.
2. [lnclient/lnd/lnd.go:564–567](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/lnd/lnd.go#L564-L567)
   LND SendKeysend logs the keysend preimage (proof of payment) at Info on success; lines 483-562 log the same preimage at Error on every failure path. The preimage is also the value the hub returns to the paying app as its receipt.
3. [lnclient/lnd/lnd.go:225–227](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/lnd/lnd.go#L225-L227)
   Every settled *lnrpc.Invoice from SubscribeInvoices is logged whole at Info. The lnrpc.Invoice struct carries RPreimage, Memo, PaymentRequest and the settled HTLCs with their CustomRecords (keysend TLVs from third-party payers such as boostagram messages and sender identities).
4. [lnclient/ldk/ldk.go:1710–1713](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L1710-L1713)
   handleLdkEvent logs every ldk_node.Event whole at Info. EventPaymentSuccessful carries PaymentPreimage (used at line 680-685 of the same file), EventPaymentReceived carries the payer-supplied custom TLV records, and EventChannelClosed carries the counterparty's free-text peer message.
5. [lnclient/ldk/ldk.go:676–685](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L676-L685)
   SendPaymentSync logs the full EventPaymentSuccessful at Info and then reads event.PaymentPreimage from it, establishing that the logged struct contains the preimage of every outgoing bolt11 payment.
6. [lnclient/ldk/ldk.go:2667–2697](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L2667-L2697)
   LDK SettleHoldInvoice logs the preimage at Error on decode failure and on ClaimForHash failure (lines 2670, 2695).
7. [transactions/transactions\_service.go:1124–1136](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1124-L1136)
   Self hold-payment settlement logs the whole *db.Transaction (including Preimage) at Info; lines 1344 and 1354 log the preimage at Error on settle failure.
8. [alby/alby\_oauth\_service.go:516](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_oauth_service.go#L516)
   GetMe logs the full AlbyMe struct (alby/models.go:91-102: identifier, nostr_pubkey, lightning_address, email, name, avatar, keysend_pubkey, subscription) at Info on every call. Callers: GET /api/alby/me (SPA useAlbyMe, deduped only 5 min), /api/health when VSS is enabled, startup (service/start.go:511), CallbackHandler and the Wails route. The email and name are not otherwise stored anywhere on the hub.
9. [logger/logger.go:35–51](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/logger/logger.go#L35-L51)
   The file hook persists Info and above to WORK_DIR/log/nwc.log (3 days, 3 backups) with LOG_TO_FILE defaulting to true and LOG_LEVEL defaulting to 4=Info (config/models.go:29-30); the same lines go to stdout and thus journald / container log stores.
10. [api/api.go:2108–2116](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L2108-L2116)
   GET /api/log/app (Settings > Debug Tools > Get App Logs) returns this log to the operator for pasting into support requests, so the preimages, third-party TLV payloads and account PII travel with every shared debug log.

## Impact
Disclosure only: payment preimages (bearer proof of payment for every outgoing bolt11/keysend payment and, for hold invoices, the receiving app's pre-settlement secret), remote payers' keysend TLV payloads and payment requests, and the operator's Alby account email, name, identifiers and plan. A log-only reader otherwise has none of this; a reader who already holds the SQLite file gains only the email/name. Nothing here changes hub state or grants control of funds or credentials, so integrity and availability are unaffected and confidentiality impact is limited.

## Reproduction steps
1. Attacker: a local account able to read the hub's stdout stream (member of systemd-journal/adm under the documented systemd unit, or a reader of the Docker/fly/Render log store) or the nwc.log file, or anyone who receives a Debug Tools 'Get App Logs' export. No interaction with the hub is needed: the entries are written during ordinary operation at the default log level on every payment, every settled invoice, every LDK event and every /api/alby/me poll, so the attacker only reads. No control stands in the way; the only shipped knobs (LOG_LEVEL, LOG_TO_FILE) default to the leaking configuration and are not documented as sensitive.

## Recommended fix
1. Preimages are included as explicit log fields or via whole-struct logging (ldk_node.Event, lnrpc.Invoice, db.Transaction) at Info/Error level. Fix criteria: No preimage value appears in any log entry at Info or above on success or failure paths; event/struct logging uses a redacted projection (payment hash, amounts, ids) rather than the whole struct. Verify by exercising settle_hold_invoice, keysend and bolt11 payment flows on each backend and grepping stdout/nwc.log for the known preimage.
2. Whole-event logging persists third-party payer TLV records and counterparty free-text messages. Fix criteria: Custom records / TLVs and peer messages are not written to the persisted log at default level (Debug at most, or redacted); a keysend with a known TLV payload leaves no copy of that payload in nwc.log.
3. GetMe logs the full AlbyMe struct including email and name at Info on every poll. Fix criteria: The /me response is not logged at Info or above (or only non-identifying fields such as a boolean success/plan code are); after linking an account and loading the SPA, nwc.log contains no email address or account name.

---
**Severity:** LOW
**Status:** Open
**Category:** Sensitive information in logs
**CWE:** [CWE-532](https://cwe.mitre.org/data/definitions/532.html)
**Attack vector:** LOCAL
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256537

---

# App pubkey accepted without curve-point validation; one undeliverable app silently aborts NIP-47 notification delivery to every later app

## Details
CreateApp (apps/apps_service.go:92-99) accepts a caller-supplied app pubkey after checking only that it is 64 hex characters; it does not check that the value is a valid x-only secp256k1 public key. About half of all 32-byte values are not curve points, and for those every NIP-04/NIP-44 key derivation fails (cipher.NewNip47Cipher, nip47/cipher/cipher.go:32-42, via go-nostr; see assumption in evidence). Such a connection is persisted with the requested scopes, including notifications.

The notifier's per-app loop is fail-fast: notifySubscribers (nip47/notifications/nip47_notifier.go:106-147) iterates every app with the notifications scope and returns on the first app whose notifySubscriber call fails (line 140), after the earlier apps have been notified. With an app whose pubkey is not a curve point, notifySubscriber fails deterministically at line 170 for every event, so every app after it in the unordered db.Find order (ascending ID on SQLite — every connection created later) never receives payment_received, payment_sent or hold_invoice_accepted notifications. ConsumeEvent discards notifySubscribers' error (lines 54-57, 70-73, 88-91) and returns nil, so there is no retry, no duplicate delivery and no queue build-up; the loss is one-shot per event but repeats for every event, silently (an error log line only), until the operator finds and deletes the offending app.

The bad pubkey reaches CreateApp from (a) the README-documented 'client created secret' deep link /apps/new?pubkey=<non-curve 32-byte hex>&request_methods=get_info&notification_types=payment_received, which any web page the operator visits can open; the approval dialog (frontend/src/screens/apps/NewApp.tsx) shows only the name and the scopes, never the pubkey, so the operator approves what looks like a harmless read-only connection; or (b) a NIP-47 app with superuser scope via create_connection (nip47/controllers/create_connection_controller.go:132-135), with no operator interaction. The result is a persistent, attacker-induced loss of notification delivery to other connected NWC apps — e.g. point-of-sale or hold-invoice flows that rely on payment_received / hold_invoice_accepted — which neither position is conceded: an approved connection may receive notifications, not suppress other apps'.

## Evidence
1. [apps/apps\_service.go:92–98](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/apps/apps_service.go#L92-L98)
   CreateApp stores a caller-supplied app pubkey after checking only that it hex-decodes to 32 bytes; it never checks that the value is a valid x-only secp256k1 public key. Roughly half of all 32-byte values have no corresponding curve point, so such a connection can never be used for NIP-04/NIP-44 but is persisted with whatever scopes were requested, including notifications.
2. [nip47/notifications/nip47\_notifier.go:137–146](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/notifications/nip47_notifier.go#L137-L146)
   notifySubscribers returns on the first app whose notifySubscriber call fails, after the apps before it in the iteration were already notified. For a deterministic per-app failure every app after it in the iteration never receives this notification, for every event.
3. [nip47/notifications/nip47\_notifier.go:170–178](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/notifications/nip47_notifier.go#L170-L178)
   notifySubscriber calls cipher.NewNip47Cipher(encryption, app.AppPubkey, appWalletPrivKey) and returns its error; for an app whose stored AppPubkey is not a curve point this fails deterministically on every call (NIP-04 first, so the NIP-44 attempt is never reached).
4. [nip47/cipher/cipher.go:32–41](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/cipher/cipher.go#L32-L41)
   NewNip47Cipher derives the NIP-04 shared secret / NIP-44 conversation key from the app pubkey via go-nostr and returns the library error. Assumption (dependency not vendored): getAlby/go-nostr v0.0.0-20260805072924-9844f892c3c8 nip04.ComputeSharedSecret and nip44.GenerateConversationKey parse "02"+pubkey with btcec/secp256k1 ParsePubKey, which rejects an x-coordinate that is not on the curve.
5. [nip47/notifications/nip47\_notifier.go:96–100](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/notifications/nip47_notifier.go#L96-L100)
   The app list is loaded with an unordered db.Find(&apps); on SQLite (the default) this is rowid order, so the apps starved are those with a higher ID than the bad app, i.e. every connection created after it. On Postgres the heap order is not deterministic but some apps are still skipped on every event.
6. [nip47/notifications/nip47\_notifier.go:54–57](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/notifications/nip47_notifier.go#L54-L57)
   ConsumeEvent discards the return value of notifySubscribers (also at lines 70-73 and 88-91) and returns nil, so StartNotifier's retry loop is NOT triggered by this failure: there is no re-queueing, no duplicate delivery and no queue exhaustion. The loss is one-shot per event — earlier apps get exactly one notification, later apps none.
7. [frontend/src/screens/apps/NewApp.tsx:90](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/apps/NewApp.tsx#L90)
   The README-documented 'client created secret' deep link /apps/new?pubkey=...&request_methods=get_info&notification_types=payment_received carries the page-chosen pubkey verbatim into the create request (line 267) and adds the notifications scope (lines 190-192). The dialog shows name and scopes only; the pubkey is never displayed (line 498 merely relabels the button 'Connect'), so the operator cannot judge its validity.
8. [nip47/controllers/create\_connection\_controller.go:132–135](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/create_connection_controller.go#L132-L135)
   Secondary route: a NIP-47 app holding the superuser scope can create such a connection with arbitrary pubkey and notification types through create_connection with no operator interaction; it reaches the same CreateApp validation.
9. [transactions/transactions\_service.go:1632–1640](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1632-L1640)
   afterTransactionSettled publishes nwc_payment_received / nwc_payment_sent with a *db.Transaction for every settled transaction (hold-invoice acceptance at line 1056 likewise), so the starvation applies to every payment notification the hub emits from then on.

## Impact
The hub's NIP-47 notification function is partially and persistently broken: notifications for every event are no longer delivered to a subset of connected apps (all later-created ones on SQLite), silently apart from an error log, and the state persists across restarts until the bad app is deleted. The hub itself keeps running, requests keep working, and no data is exposed or altered; there are no duplicate or forged notifications because ConsumeEvent does not retry. Subsequent-system impact: Third-party NWC apps connected to the hub after the bad app stop receiving payment_received, payment_sent and hold_invoice_accepted notifications; apps that drive their UI or hold-invoice settlement from notifications lose that function (they can still poll lookup_invoice / list_transactions). No data of theirs is exposed or altered.

## Reproduction steps
1. A web page the operator visits opens the documented deep link /apps/new?pubkey=<32-byte hex that is not a curve point>&request_methods=get_info&notification_types=payment_received; the operator approves a connection whose dialog shows only a name and read-only scopes (the pubkey is never displayed). No hub credential is needed by the attacker and no further action: from then on every settled transaction's notification is delivered only to apps iterated before the bad app. A NIP-47 app with superuser scope can do the same via create_connection without interaction, but that is a higher-privilege secondary route.

## Recommended fix
1. CreateApp accepts any 32-byte hex string as an app pubkey without checking it is a valid x-only secp256k1 public key, so a connection can be created whose key can never be used for NIP-04/NIP-44 but which still carries the notifications scope. Fix criteria: A caller-supplied app pubkey must be rejected at creation on every route (HTTP/Wails CreateApp and NIP-47 create_connection) unless it parses as a valid x-only secp256k1 public key; verify that a 32-byte value with no corresponding curve point is refused with an error.
2. notifySubscribers aborts the whole per-event loop on the first app whose notification fails, so one app's deterministic failure prevents delivery to every app after it in the iteration. Fix criteria: A failure to notify one app must be logged and skipped without preventing delivery to the remaining apps; verify that with one undeliverable app present, every other app with the notifications scope receives exactly one notification per event regardless of creation order.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-20](https://cwe.mitre.org/data/definitions/20.html)
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
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256535

---

# NIP-47 app-controlled metadata.user_labels shape breaks operator transaction search on Postgres

## Details
ListTransactions builds a JSON-path search over transaction metadata whose evaluation depends on the *type* of a stored JSON value that NIP-47 apps control.

When the operator searches their transaction history, `transactions/transactions_service.go:703-709` appends `EXISTS (SELECT 1 FROM jsonb_each_text((transactions.metadata->'user_labels')::jsonb) ...)` on Postgres (`json_each(transactions.metadata,'$.user_labels')` on SQLite). The code assumes `metadata.user_labels` is always an object of operator-written labels, because the only hub-side writer (`SetTransactionUserLabels`, lines 1439-1474) sanitises it to `map[string]string`.

But the same `metadata` column is also written verbatim from NIP-47 requests: `make_invoice`/`make_hold_invoice` metadata (MakeInvoice lines 184-195, 237) and `pay_invoice`/`multi_pay_invoice` metadata (SendPaymentSync lines 302-313, 417). The controllers decode `Metadata map[string]interface{}` with no key or type filtering (pay_invoice_controller.go:17-21, make_invoice_controller.go:12-18); only a 4096-byte size limit applies. An app connection can therefore persist `{"user_labels": 1}`, `{"user_labels": null}`, `{"user_labels": [..]}` or `{"user_labels": "text"}` on a row.

On PostgreSQL, `jsonb_each_text` is defined only for JSON objects: for a scalar, JSON null or array operand it raises `ERROR: cannot call jsonb_each_text on a non-object` (PostgreSQL semantics, assumed here for the backend the project tests against — postgres:17.2 in .github/workflows/test-postgres.yml — through gorm.io/driver/postgres v1.6.3 / pgx v5.11.0; a SQL NULL operand, i.e. a missing key, yields no rows and is harmless). The error aborts the statement, so both the COUNT and the SELECT in ListTransactions fail and `GET /api/transactions?search=…` (http_service.go:791-806) and the Wails mirror return an error to the operator's UI. Because the operator listing passes `unpaidOutgoing=true` (api/transactions.go:103), every OUTGOING row — pending, failed or settled — passes the state/type predicate, so the EXISTS is evaluated for it whenever the search term does not already match the row's description. SendPaymentSync creates the OUTGOING row (state PENDING) inside the DB transaction *before* the LN client is asked to pay (lines 364-420 then 441-460); on failure `markPaymentFailed` only flips the state, so the row and its metadata persist. An app with `pay_invoice` scope (and any remaining budget, since validateCanPay runs before the insert) can thus poison the table at zero cost by attempting to pay an unroutable invoice with an empty description and such metadata. An app with only `make_invoice` scope achieves the same once one such invoice is settled by any payer. The poisoned row is permanent: the operator has no UI to delete transactions, and `SetTransactionUserLabels` only rewrites rows the operator edits.

Result: on Postgres deployments (DATABASE_URI set to a postgres URL — documented in README as a supported backend with a migration guide, and exercised by CI) the operator's transaction search is deterministically broken by a single hostile or buggy app until the row is removed by hand. On SQLite, `json_each` over a primitive yields a single row whose value is the primitive, so an app that sets `user_labels` to a string merely makes its transaction match searches for that string — a lesser result-pollution effect.

The earlier dismissal at this location (lead dismissed-transactions-service-703-d1f1) considered only the operator's search term, which is correctly bound and LIKE-escaped; it did not consider the type of the stored JSON operand, which comes from an untrusted source.

## Evidence
1. [transactions/transactions\_service.go:703–725](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L703-L725)
   When the operator supplies a search term, ListTransactions adds an EXISTS subquery over the JSON path metadata.user_labels. On Postgres it is `jsonb_each_text((transactions.metadata->'user_labels')::jsonb)`, which PostgreSQL only accepts for a JSON object: for a scalar, JSON null or array value it raises an error (`cannot call jsonb_each_text on a scalar/array`), failing the whole SELECT and the preceding COUNT. The shape of that JSON value is not controlled by the caller of this query.
2. [transactions/transactions\_service.go:301–312](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L301-L312)
   SendPaymentSync serialises the NIP-47 pay_invoice `metadata` object verbatim (size-limited only) and stores it on the OUTGOING row (line 417), so an app with pay_invoice scope persists `{"user_labels": 1}` even when the payment later fails.
3. [transactions/transactions\_service.go:184–237](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L184-L237)
   MakeInvoice likewise stores app-supplied metadata verbatim on the INCOMING row; the key `user_labels` is not reserved or filtered, although the hub treats it as operator-private labels elsewhere.
4. [nip47/controllers/pay\_invoice\_controller.go:17–20](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/pay_invoice_controller.go#L17-L20)
   `Metadata map[string]interface{}` is decoded from the app's request and passed through to SendPaymentSync (line 62) without validation.
5. [nip47/controllers/make\_invoice\_controller.go:12–17](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/make_invoice_controller.go#L12-L17)
   Same for make_invoice (passed at line 44).
6. [api/transactions.go:98–107](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/transactions.go#L98-L107)
   The operator's listing always passes unpaidOutgoing=true, so every OUTGOING row (pending, failed or settled) satisfies the `state = ? OR type = ?` predicate and the label subquery is evaluated for it whenever a search term is present.
7. [transactions/transactions\_service.go:1439–1473](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1439-L1473)
   The operator-side writer sanitises user_labels into map[string]string, showing the maintainers assume the key is always an object; the NIP-47 writers do not enforce this.
8. [http/http\_service.go:791–805](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L791-L805)
   GET /api/transactions?search=... surfaces the database error as a 500 to the operator's UI; the Wails route (wails_handlers.go:354-359) mirrors it.

## Impact
Confidentiality is unaffected. Integrity is unaffected on Postgres; on SQLite search results can be polluted by an app choosing a string value, a minor effect not rated. Availability: the operator's transaction search (HTTP API and desktop Wails route) fails deterministically and persistently on Postgres until the poisoned row is deleted by hand outside the application; unfiltered listing and the rest of the hub keep working, so LOW.

## Reproduction steps
1. Attacker: holder of any app connection with pay_invoice (or make_invoice) scope — a malicious or compromised NWC app, threat-model adversary 1. One pay_invoice request carrying `metadata: {"user_labels": 1}` for any syntactically valid, unexpired invoice suffices; the OUTGOING row is inserted (transactions_service.go:404-418) before the payment is attempted and persists as FAILED if it cannot be paid, so no funds are spent. From then on every operator search on a Postgres-backed hub errors. No user interaction. Attack requirement: the hub must run on the supported Postgres backend rather than default SQLite (AT:P); the exploit also relies on PostgreSQL's documented rejection of non-object operands to jsonb_each_text, stated as an assumption about the pinned driver stack (gorm.io/driver/postgres v1.6.3, pgx v5.11.0, postgres:17.2 in CI).

## Recommended fix
1. The label-search subquery evaluates a JSON path whose operand type is assumed to be an object, while that JSON is written verbatim from untrusted NIP-47 request metadata. Fix criteria: Searching with any term must succeed regardless of the type of `metadata.user_labels` stored on any row (scalar, null, array, object, missing), on both dialects — e.g. the subquery guards on the JSON type before expanding it. Verify by storing a transaction with `{"user_labels": 1}` and `{"user_labels": null}` on Postgres and confirming ListTransactions with a search term returns without error.
2. NIP-47 writers accept the hub-interpreted key `user_labels` (and other hub-reserved keys) in app-supplied metadata. Fix criteria: Metadata written from make_invoice / make_hold_invoice / pay_invoice must not be able to set hub-interpreted keys such as `user_labels`; verify that a request containing them results in the key being rejected or stripped, and that operator labels remain the only source of `user_labels`.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper type validation
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256471

---

# CLN per-part sendpay_success mapped to whole-payment event; MPP fee recorded from first part only

## Details
Core Lightning's `sendpay_success` notification is emitted once per `sendpay`/injected part, not once per payment (the message carries `partid`/`groupid`). The CLN backend's `subscribeSuccessfulPayments` (enabled for CLN >= 26.04, cln.go:157-165) treats every notification as a completed payment: `clnSendpaySuccessToTransaction` derives `AmountMsat` and `FeesPaidMsat` from that part's `amount_msat`/`amount_sent_msat` and publishes it as `nwc_lnclient_payment_sent`, the event the transactions service uses for whole payments (LND reports whole payments via TrackPayments; LDK via PaymentSuccessful, each once).

For a payment the hub itself initiated via `Xpay` (which splits large payments into parts), the sequence is: a PENDING outgoing row is created with a fee reserve (transactions_service.go:409); the first part completes while others are still in flight; CLN emits `sendpay_success` for it; the hub decodes it and `ConsumeEvent` finds the PENDING row by payment hash and calls `markTransactionSettled(preimage, feeOfFirstPart)`; the row becomes SETTLED with `FeeMsat` = that part's fee and `FeeReserveMsat` = 0. When `Xpay` later returns the true total, `transactionsService.SendPaymentSync` (line 464) calls `markTransactionSettled` again, `findSettledTransaction` returns the existing settled row and the correct fee is discarded. `GetIsolatedBalanceMsat` and `GetBudgetUsageMsat` sum `amount_msat + fee_msat + fee_reserve_msat`, so the isolated sub-wallet (or budgeted app) is charged only the first part's routing fee; the remaining parts' fees are paid from the operator's main wallet. Because the first part completes before the others and Xpay only returns after the last, this is the normal ordering for any multi-part payment, not a narrow race. For payments made outside the hub, the created settled row records the first part's amount as the payment amount, misreporting the operator's history.

An isolated app can lean on this: paying invoices whose destination (controlled by the app or colluding) accepts only MPP and is reachable through several paths forces a split, so routing fees on all but the first part are systematically shifted to the operator; a colluding routing node collects those fees. The amount is bounded by CLN's fee ceiling per payment but is repeatable on every payment.

Assumptions (Core Lightning behaviour, external node, not pinned in this repository): `sendpay_success` fires for each part of an xpay-driven payment with per-part `amount_msat`/`amount_sent_msat` (CLN notification documentation: 'sent every time a sendpay succeeds'); the hub only subscribes when the node reports version >= 26.04. For successful payments the preimage of every part is the same, so the first-part settlement itself is otherwise valid; only the fee/amount fields are partial.

## Evidence
1. [lnclient/cln/cln.go:206–247](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/cln/cln.go#L206-L247)
   subscribeSuccessfulPayments publishes one nwc_lnclient_payment_sent per SendPaySuccessNotification received. CLN emits sendpay_success per sendpay part (the notification carries Partid, node.pb.go 43106), so a multi-part payment yields several whole-payment events for the same payment hash.
2. [lnclient/cln/cln.go:258–267](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/cln/cln.go#L258-L267)
   clnSendpaySuccessToTransaction computes AmountMsat and FeesPaidMsat as AmountSentMsat - AmountMsat of the single part carried by the notification (SendPaySuccessNotification has Partid/Groupid, lnclient/cln/clngrpc/node.pb.go:43104-43109), so the event describes one HTLC's amount and fee, yet it is published as a complete lnclient.Transaction.
3. [transactions/transactions\_service.go:889–969](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L889-L969)
   ConsumeEvent finds the PENDING outgoing row by payment hash and calls markTransactionSettled with the event's FeesPaidMsat as soon as the first part succeeds; for payments unknown to the hub it creates a settled row with the first part's AmountMsat.
4. [transactions/transactions\_service.go:1479–1494](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1479-L1494)
   markTransactionSettled returns the existing settled row from findSettledTransaction without updating FeeMsat, so when Xpay later returns the true total fee at line 464, the under-recorded first-part fee is kept.
5. [lnclient/cln/cln.go:2349–2359](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/cln/cln.go#L2349-L2359)
   The synchronous Xpay response carries the correct total fee (AmountSentMsat - AmountMsat across parts) but arrives after the first part's notification has already settled the row.

## Impact
Integrity of fee accounting between sub-wallets/budgets and the main wallet: the app is under-charged for routing fees on every multi-part payment and the operator's wallet absorbs the difference; externally made MPP payments are recorded with a wrong amount. Bounded per payment by the fee ceiling, so low integrity impact; no confidentiality or availability effect.

## Reproduction steps
1. An app connection with pay_invoice scope (isolated or budgeted) on a CLN-backed hub pays an invoice that CLN splits into multiple parts (large relative to channel balances, or an MPP-only payee under the attacker's control). The first part's sendpay_success settles the hub's row with only that part's fee before Xpay returns the total; the correct fee is then discarded. Requires the payment to be multi-part, which the attacker can encourage but not guarantee.

## Recommended fix
1. subscribeSuccessfulPayments publishes a whole-payment settlement event from a per-part notification, so the amount and fee describe one HTLC rather than the payment. Fix criteria: A nwc_lnclient_payment_sent event for CLN must carry the payment's total amount and total fee and be published once per payment hash (e.g. aggregate parts via listpays/listsendpays by payment hash and groupid, or only publish once the payment status is complete); verify with a test feeding two part notifications for one hash and asserting a single event with summed fee.
2. The synchronous Xpay result, which has the authoritative total fee, is ignored when an async event has already settled the row. Fix criteria: When the synchronous payment result reports a higher fee than the already-settled row, the recorded FeeMsat (and the app's charge) must be corrected; verify that after an MPP payment the DB FeeMsat equals Xpay's AmountSentMsat - AmountMsat.

---
**Severity:** LOW
**Status:** Open
**Category:** Incorrect Calculation
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256469

---

# LND UpdateChannel compares against never-set IdentityPubkey, copying the peer's policy and dereferencing nil

## Details
`LNDService.UpdateChannel` (lnclient/lnd/lnd.go:1107-1153) implements the operator's channel-fee edit as `UpdateChannelPolicy{BaseFeeMsat, FeeRatePpm, TimeLockDelta: nodePolicy.TimeLockDelta, MaxHtlcMsat: nodePolicy.MaxHtlcMsat}`, intending to preserve the hub's existing CLTV delta and max-HTLC while changing only fees. `nodePolicy` is selected by `channelEdge.Node1Pub == svc.client.IdentityPubkey` (line 1132), but `wrapper.LNDWrapper.IdentityPubkey` is declared (wrapper/lnd.go:45) and never assigned anywhere in the repository, so the comparison is always false and `nodePolicy` is always `channelEdge.Node2Policy`.

Consequences:

1. **Peer-controlled values written into the hub's own channel policy.** Edge node ordering is lexicographic by pubkey, so whenever the hub's node is `Node1` (roughly half of channels, and a deliberate attacker can guarantee it by choosing a node key that sorts after the hub's public pubkey), `Node2Policy` is the *remote peer's* advertised policy from its `channel_update` gossip. The peer controls its own `TimeLockDelta` and `MaxHtlcMsat`. When the operator later adjusts fees for that channel from the UI (`PATCH /api/peers/:peerId/channels/:channelId`, full-access JWT; or the equivalent Wails route), the hub silently copies the peer's values into its own outgoing policy. LND (server-side, behaviour assumed from lnd's `UpdateChannelPolicy`/`updateEdge`) accepts any `TimeLockDelta >= 18` and any `MaxHtlcMsat` between the channel's negotiated min_htlc and capacity, so a peer advertising e.g. `MaxHtlcMsat = min_htlc` (typically 1000 msat) pins the hub's own max-HTLC for that channel to 1 sat — LND pathfinding applies the local edge's max_htlc to the hub's own outbound payments, so the hub can no longer send or forward over that channel — and a peer advertising `TimeLockDelta = 18` lowers the hub's forwarding CLTV safety margin to LND's floor (or 65535 makes the hub's forwards unroutable). Because every subsequent fee update re-copies the peer's policy, the operator cannot repair the values from the hub UI (which exposes only fee fields); only lncli against the LND node, or closing the channel, restores them.

2. **Nil dereference.** If the edge has no `Node2Policy` (peer has not yet announced a channel_update) line 1144 panics. In the HTTP server `middleware.Recover()` (http_service.go:93) turns this into a 500; the Wails request router has no recover in hub code, so the desktop build's behaviour depends on the Wails v2 runtime.

The operator is the only caller, so this is not an unauthenticated path; the security relevance is that a remote Lightning peer (threat-model adversary 5) gets to write two fields of the hub node's own channel configuration through an operator action that neither mentions nor displays them — something no Lightning-protocol path otherwise grants a counterparty. The sibling implementation in `ListChannels` (lines 916-921) selects the side with `nodeInfo.IdentityPubkey` from GetInfo and nil-checks it; `svc.nodeInfo.Pubkey` is already cached at construction and is the value UpdateChannel should compare against.

## Evidence
1. [lnclient/lnd/lnd.go:1131–1146](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/lnd/lnd.go#L1131-L1146)
   nodePolicy is chosen by `channelEdge.Node1Pub == svc.client.IdentityPubkey`. IdentityPubkey is the zero string (never assigned), Node1Pub is a 33-byte hex pubkey, so the comparison is always false and nodePolicy is always Node2Policy. When the hub is Node1 of the edge, Node2Policy is the remote peer's advertised policy; its TimeLockDelta and MaxHtlcMsat are passed as the hub's own values to UpdateChannelPolicy (1139-1146). If Node2Policy is nil (peer has not yet sent a channel_update) line 1144 dereferences nil.
2. [lnclient/lnd/wrapper/lnd.go:39–100](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/lnd/wrapper/lnd.go#L39-L100)
   LNDWrapper declares IdentityPubkey (line 45) but NewLNDclient returns the struct without setting it (95-100); `rg IdentityPubkey` finds no write anywhere in the repository — the only read of the wrapper field is lnd.go:1132.
3. [lnclient/lnd/lnd.go:916–920](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/lnd/lnd.go#L916-L920)
   ListChannels performs the same side selection correctly using nodeInfo.IdentityPubkey from GetInfo and nil-checks the result, showing the intended logic; svc.nodeInfo.Pubkey (cached at construction, lnd.go:42,74) is also available to UpdateChannel.
4. [http/http\_service.go:190](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L190)
   The operator-triggered route: PATCH /api/peers/:peerId/channels/:channelId in fullAccessApiGroup (full JWT). Echo's middleware.Recover() (line 93) turns the nil-deref panic into a 500; the Wails router (wails/wails_handlers.go:187-203) has no recover in hub code.
5. [api/api.go:1257–1271](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L1257-L1271)
   api.UpdateChannel forwards only the operator's fee fields (frontend RoutingFeeDialogContent.tsx sends forwardingFeeBaseMsat and forwardingFeeProportionalMillionths); TimeLockDelta and MaxHtlcMsat are never operator inputs and come solely from the (wrongly selected) edge policy inside the LND client.

## Impact
Integrity LOW: two fields of the hub node's own channel policy (CLTV delta, max HTLC) for the shared channel are overwritten with peer-chosen values within LND's validation bounds (>=18 blocks; min_htlc..capacity — assumed from lnd's UpdateChannelPolicy validation). Availability LOW: the hub's outbound payments and forwards over that one channel can be blocked (max_htlc pinned at min_htlc) until the operator repairs the policy with lncli or closes the channel; the nil-deref fails only the single request under Echo's Recover. No confidentiality impact. Funds are never at direct risk; the lowered CLTV margin is a marginal increase in forwarding risk within what LND itself permits.

## Reproduction steps
1. A Lightning peer with a channel to the hub's LND node (LND accepts inbound channels by default) advertises a policy with chosen TimeLockDelta/MaxHtlcMsat and, if deliberate, picks a node key sorting after the hub's so the hub is Node1. Nothing happens until the operator edits that channel's fees from the authenticated UI (UI ACTIVE), a routine action; the hub then copies the peer's values into its own policy. The peer needs no hub privileges (PR NONE); the deployment must use the LND backend rather than the default LDK, and the hub must hold a channel with the attacker (AT PRESENT).

## Recommended fix
1. UpdateChannel selects which side's routing policy to preserve by comparing against wrapper.LNDWrapper.IdentityPubkey, a field that is never populated, so the comparison is always false, Node2Policy is always chosen, and the peer's policy is copied into the hub's own whenever the hub is Node1. Fix criteria: The hub's own policy must be selected using its actual identity pubkey (svc.nodeInfo.Pubkey or GetInfo().IdentityPubkey, as ListChannels does), and the never-assigned wrapper field must be populated or removed. Verify on a channel where the hub is Node1 that a fee update preserves the hub's existing TimeLockDelta/MaxHtlcMsat rather than the peer's.
2. The selected policy is dereferenced without a nil check, so an edge without the hub-side policy panics. Fix criteria: A missing policy must produce an error (or fall back to LND's current values by passing zero MaxHtlcMsat and the node's configured TimeLockDelta) rather than a panic; verify that updating a channel whose edge lacks the selected policy returns an error in both the HTTP and Wails paths.

---
**Severity:** LOW
**Status:** Open
**Category:** Expression Is Always False
**CWE:** [CWE-570](https://cwe.mitre.org/data/definitions/570.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256467

---

# HTTP-mode openLink opens third-party pages with window.opener access (reverse tabnabbing)

## Details
In the HTTP (browser) build, `src/utils/openLink.ts` is the copy of `frontend/platform_specific/http/src/utils/openLink.ts`, which opens external URLs with `window.open(url, "_blank")` and no `noopener`/`noreferrer` features. Per the HTML specification only anchor elements with `target=_blank` get an implicit `noopener`; `window.open()` always exposes the opener unless `noopener` is requested, and the hub does not send a `Cross-Origin-Opener-Policy` header (`http_service.go` Secure middleware). The opened page therefore holds a cross-origin `window.opener` handle on the authenticated hub tab and may assign `window.opener.location`, navigating the hub tab to a URL of its choosing (reverse tabnabbing).

Call sites that reach a third party: `ReceiveOnchain.tsx` and `wallet/swap/index.tsx` open `https://ff.io/?to=BTCLN&address=<invoice>` (FixedFloat, an external swap provider — one of the remote parties the threat model lists as adversaries) immediately after the operator starts a cross-crypto swap; `AuthCodeForm.tsx` opens the Alby OAuth page; `BuyBitcoin.tsx`, `FirstChannel.tsx`, `BuzzPay.tsx`, `Tictactoe.tsx` open Alby-operated pages. A malicious or compromised destination (or any page it later redirects to, since the opener handle survives redirects) can replace the hub tab with a pixel-perfect copy of the hub's `/unlock` or confirm-payment screen on an attacker host; the operator, who just interacted with the hub in that tab, is likely to re-enter the unlock password or approve a payment on the fake page. The attacker learns the unlock password, which with the LAN/VPN reachability the threat model keeps in scope yields full control via `/api/unlock` and `/api/backup`.

The `ExternalLink` component (used for most links) renders an anchor with `rel="noreferer noopener"` in HTTP mode and is not affected; the defect is specific to the imperative `openLink` path. `Cards.tsx` already uses `window.open(url, "_blank", "noopener,noreferrer")`, so the omission in `openLink` is inconsistent with the project's own practice. The desktop (Wails) `openLink` uses `BrowserOpenURL` and is covered separately by `wails-browseropenurl-lnurl-successaction-arbitrary-scheme`.

## Evidence
1. [frontend/platform\_specific/http/src/utils/openLink.ts:1–4](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/platform_specific/http/src/utils/openLink.ts#L1-L4)
   openLink() is implemented as window.open(url, "_blank") with no features string. Unlike anchors with target=_blank, window.open() never implies noopener, so the opened document receives a live window.opener reference to the hub tab. This file is copied over src/utils/openLink.ts by `yarn prepare:http` (package.json) and is what the shipped HTTP build runs.
2. [frontend/src/screens/wallet/receive/ReceiveOnchain.tsx:72–74](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/receive/ReceiveOnchain.tsx#L72-L74)
   In the Receive-onchain screen 'crypto' is the default swapFrom value (line 39, useState("crypto")); submitting creates an invoice and then calls openLink(`https://ff.io/?to=BTCLN&address=...`), handing the third-party exchange FixedFloat (not operated by Alby) a page with a live window.opener handle on the authenticated hub tab.
3. [frontend/src/screens/wallet/swap/index.tsx:129–131](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/swap/index.tsx#L129-L131)
   Same FixedFloat openLink call from the Swap screen.
4. [frontend/src/components/AuthCodeForm.tsx:30–39](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/AuthCodeForm.tsx#L30-L39)
   Secondary call site: the Alby OAuth page is also opened via openLink. The URL is albyAuthUrl from /api/info (api/api.go:1532, albyOAuthSvc.GetAuthUrl(), server configuration), i.e. the hub's own vendor — a trusted party, so this site is not the attacker's entry point; it is listed to show that every openLink destination, trusted or not, receives the opener handle.
5. [http/http\_service.go:66–72](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L66-L72)
   The Secure middleware sets CSP, X-Frame-Options, nosniff and Referrer-Policy but no Cross-Origin-Opener-Policy, so nothing at the HTTP layer severs the opener relationship that window.open creates.
6. [frontend/src/screens/cards/Cards.tsx:562](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/cards/Cards.tsx#L562)
   Contrast: the Cards screen opens provider pages with window.open(url, "_blank", "noopener,noreferrer"), showing the maintainers intend external pages not to get opener access; openLink does not follow this.

## Impact
Direct effect on the hub is navigation of the operator's tab away to attacker content; secrets are only obtained if the operator is then phished (unlock password → full remote control if the attacker can reach the hub's port; or a payment approved on a fake confirm screen). Rated LOW/LOW to reflect that compromise is indirect and interaction-dependent; no availability impact.

## Reproduction steps
1. Attacker position: operator of (or someone who has compromised) a page the hub opens via openLink — most notably ff.io in the swap flows, or any redirect target of those pages. Delivery: the operator clicks 'swap' (or 'Request Authorization Code'); the new tab runs `opener.location = 'https://<attacker>/unlock-lookalike'`. The hub tab silently becomes a phishing page; the operator must then type the unlock password or approve a payment there (ACTIVE user interaction). Attack Requirements is PRESENT because the third-party destination must be hostile. No hub privileges are required.

## Recommended fix
1. openLink (HTTP build) calls window.open without the noopener feature, leaving a cross-origin opener handle on the authenticated hub tab for every external page it opens. Fix criteria: Pages opened by openLink must have no reference to the hub window: window.opener is null in the new tab for every openLink call site (e.g. pass "noopener,noreferrer" as the features string, or null the returned window's opener). This is the required fix, since the hub is commonly served over plain HTTP on a LAN where browsers ignore COOP.
2. The server sets no Cross-Origin-Opener-Policy, so no defence-in-depth severs opener relationships created by any script path (openLink, Tictactoe's direct window.open, future call sites). Fix criteria: The HTTP server emits Cross-Origin-Opener-Policy: same-origin (or same-origin-allow-popups) on SPA document responses so that, in secure contexts (HTTPS reverse proxy or localhost), a cross-origin page can never obtain a usable opener handle on the hub regardless of how it was opened. Note browsers only honour COOP in secure contexts, so this complements rather than replaces the openLink fix.

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
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256466

---

# NIP-47 app-supplied transaction metadata crashes the wallet transaction list (no error boundary)

## Details
The React SPA renders transaction metadata assuming the shapes declared in frontend/src/types.ts (`TransactionMetadata`: `nostr.tags: string[][]`, `comment: string`, `offer.payer_note: string`), but the hub stores and returns metadata as an opaque `map[string]interface{}` (api/models.go:553; api/transactions.go:149-152 unmarshals the stored JSON into that map and returns it verbatim) that originates from NIP-47 clients. nip47/controllers/pay_invoice_controller.go:20 (and multi_pay_invoice_controller.go:42) decodes `metadata` straight from the app's signed request with a plain json.Unmarshal and forwards it to transactions_service.SendPaymentSync, which only re-serialises it under a 4096-byte cap (lines 302-313), inserts the transaction row with the metadata BEFORE attempting payment (404-420) and keeps the row as FAILED if the payment fails (449-461, markPaymentFailed). api.ListTransactions calls the service with unpaidOutgoing=true (api/transactions.go:103), so the list predicate is `state = settled OR type = outgoing` (transactions_service.go:685-690): a failed outgoing row is on page 1 of the operator's wallet list by default; `hideFailed` is opt-in and lives in an in-memory zustand store that resets on reload. make_invoice metadata is a second source into the same row (shown once the invoice settles).

TransactionItem.tsx line 102 evaluates `tx.metadata?.nostr?.tags?.find((t) => t[0] === "e")`: if `tags` is any non-nullish non-array value (e.g. the number 1) `.find` is undefined and the call throws a TypeError; an array element that is null throws on `t[0]`. Lines 107-108 compute `description = tx.description || tx.metadata?.comment || bolt12Offer?.payer_note` with no type check, and line 206 renders it as a React child, which React 19.2.6 rejects with 'Objects are not valid as a React child' when `comment` is a JSON object (reached whenever the invoice description is empty). Both throws happen while rendering the collapsed list row, so no click is needed.

No route in frontend/src/routes.tsx defines `errorElement`/`ErrorBoundary` and no error boundary component exists anywhere under frontend/src. The router is a react-router 7.18.2 data router (createBrowserRouter in HTTP mode, createHashRouter in the Wails desktop build; App.tsx:11-18). Under react-router's documented data-router behaviour the render error propagates to the default root error boundary, which replaces the entire matched route tree - AppLayout with its sidebar, the wallet balance, the Send/Receive buttons and the filter menu that could hide the record - with the library's default 'Unexpected Application Error!' screen. The same happens on the app's detail page (/apps/:id renders AppTransactionList -> TransactionsList). The failure recurs on every visit to /wallet until newer transactions push the row off the first page; deleting the app connection does not delete the transaction. Home does not render TransactionItem, so other routes remain reachable, which bounds the availability impact to the wallet and app-detail views.

TransactionItem already wraps the nostr pubkey and event id in try/catch (`safeNpubEncode`, `safeNeventEncode`), showing the metadata is known to be untrusted, but the `tags` lookup and the description fallback have no type guard.

## Evidence
1. [frontend/src/components/TransactionItem.tsx:102](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/TransactionItem.tsx#L102)
   `tx.metadata?.nostr?.tags?.find((t) => t[0] === "e")` runs for every listed transaction. Optional chaining only guards against null/undefined: if `tags` is a number, string, boolean or object, `.find` is undefined and the call throws a TypeError; if `tags` is an array containing null, `t[0]` throws. The value is NIP-47-client-supplied JSON that nothing type-checks.
2. [frontend/src/components/TransactionItem.tsx:107–108](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/TransactionItem.tsx#L107-L108)
   `description = tx.description || tx.metadata?.comment || bolt12Offer?.payer_note` falls through to client-controlled metadata values whenever the invoice description is empty, with no type check.
3. [frontend/src/components/TransactionItem.tsx:205–207](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/TransactionItem.tsx#L205-L207)
   `{description}` is rendered as a React child in the collapsed list row. If `metadata.comment` (or `offer.payer_note`) is a JSON object, React 19.2.6 throws 'Objects are not valid as a React child' during render of the list itself; no click is needed.
4. [frontend/src/App.tsx:11–18](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/App.tsx#L11-L18)
   The router is a react-router 7.18.2 data router (createBrowserRouter in HTTP mode, createHashRouter in the Wails desktop build). With no route-level errorElement/ErrorBoundary anywhere in routes.tsx (rg over frontend/src for ErrorBoundary|errorElement|getDerivedStateFromError|componentDidCatch finds nothing), a render error in TransactionItem propagates to the library's default root error boundary, which replaces the entire matched tree (AppLayout, sidebar, wallet balance, Send/Receive, filter menu) with its default error screen.
5. [frontend/src/components/TransactionsList.tsx:89–96](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/TransactionsList.tsx#L89-L96)
   Every transaction on the current page is rendered through TransactionItem; one malformed record therefore breaks the whole list render.
6. [frontend/src/screens/wallet/Lightning.tsx:102](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/Lightning.tsx#L102)
   The main /wallet screen renders TransactionsList unfiltered, so the operator's primary wallet page is the sink.
7. [frontend/src/components/connections/AppTransactionList.tsx:19–25](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/connections/AppTransactionList.tsx#L19-L25)
   The app detail page (/apps/:id) renders the same TransactionsList filtered by the attacking app's id, so that page breaks as well.
8. [api/transactions.go:103](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/transactions.go#L103)
   The HTTP/Wails list endpoint calls the service with unpaidOutgoing=true, so FAILED outgoing rows are included in the operator's default wallet list: the attacker's payment does not need to succeed.
9. [api/transactions.go:149–151](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/transactions.go#L149-L151)
   toApiTransaction unmarshals the stored metadata JSON into the untyped `Metadata` map and returns it to the frontend verbatim; no shape normalisation.
10. [api/models.go:553](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/models.go#L553)
   `type Metadata = map[string]interface{}` - the backend treats transaction metadata as an opaque JSON object; nothing enforces the shapes the frontend assumes.
11. [nip47/controllers/pay\_invoice\_controller.go:20](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/pay_invoice_controller.go#L20)
   The NIP-47 pay_invoice request body carries `metadata map[string]interface{}` decoded by a plain json.Unmarshal (decode_request.go:13) from the signed Nostr event authored by the app connection; line 52 forwards it unchanged into the payment path. multi_pay_invoice_controller.go:42 does the same per invoice.
12. [transactions/transactions\_service.go:302–312](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L302-L312)
   SendPaymentSync only re-serialises the metadata and enforces a byte-length cap (INVOICE_METADATA_MAX_LENGTH = 4096); value types are not validated.
13. [transactions/transactions\_service.go:404–419](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L404-L419)
   The db.Transaction row including `Metadata: datatypes.JSON(metadataBytes)` is created BEFORE the payment is attempted (after validateCanPay, which needs only pay_invoice scope and budget covering the invoice amount plus fee reserve).
14. [transactions/transactions\_service.go:449–460](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L449-L460)
   On payment failure the row is only marked FAILED via markPaymentFailed and kept, so the attacker's metadata persists even if the payment never succeeds (e.g. an unroutable 1-sat invoice).
15. [transactions/transactions\_service.go:685–701](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L685-L701)
   With unpaidOutgoing=true the list predicate is `state = settled OR type = outgoing`; failed transactions are excluded only when the optional hideFailed filter is set, and that filter lives in an in-memory store (frontend/src/state/TransactionFiltersStore.ts) that resets on every reload.
16. [nip47/controllers/make\_invoice\_controller.go:17](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/make_invoice_controller.go#L17)
   Second source into the same sink: make_invoice also accepts an untyped `metadata` map that MakeInvoice stores on the incoming transaction row (shown once settled).

## Impact
No data is disclosed or altered. The operator's primary wallet screen (balance, Send/Receive, transaction list and the filter menu that could hide the record) and the attacking app's detail page are replaced by an error screen persistently, in both the HTTP and desktop builds; Home and other routes still render and the backend/NIP-47 service keeps running, so availability impact is partial.

## Reproduction steps
1. Attacker holds any app connection keypair with pay_invoice scope and a budget covering a tiny invoice (or make_invoice scope plus paying the resulting invoice). It posts one kind-23194 pay_invoice event to the relay with `metadata` such as {"nostr":{"pubkey":"x","tags":1}} and any BOLT-11 invoice; the hub stores the metadata on the transaction row before paying and keeps it on failure, and the default wallet list includes failed outgoing rows. The next time the operator opens /wallet or the app's detail page (routine action), TransactionItem throws during render and react-router's default error screen replaces the page; this repeats on every visit while the row is on the first page.

## Recommended fix
1. TransactionItem.tsx dereferences and renders metadata fields (`nostr.tags`, `comment`, `offer.payer_note`, `payer_data.name`) assuming their declared TypeScript shapes, although the values are untrusted JSON from NIP-47 clients. Fix criteria: Rendering a transaction whose metadata has unexpected value types (non-array tags, array elements that are not arrays, object/array where a string is expected) must not throw: fields are type-checked before use and non-conforming values are ignored or shown as text. Verify by seeding a transaction with `metadata.nostr.tags = 1` and `metadata.comment = {}` and confirming the wallet list renders.
2. No route or component in the SPA defines an error boundary, so a render exception in one list item is caught only by react-router's default root boundary, which replaces the whole application view. Fix criteria: A render error in a single transaction item (or any route) is contained: the application shell, navigation and the transaction filter menu remain usable and the failing item alone is replaced by a fallback. Verify by forcing a throw inside TransactionItem and confirming the rest of the wallet page still renders.
3. The backend accepts NIP-47 `metadata` as an untyped map and persists it with only a size limit, so malformed structures reach every consumer. Fix criteria: Metadata written from NIP-47 requests is validated (or normalised) against the documented shape for the keys the hub itself interprets (nostr, comment, payer_data, recipient_data, offer), or stored in a way that consumers treat as opaque. Verify that a pay_invoice with `metadata.nostr.tags` set to a non-array is rejected or stored without that key.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper input type validation
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256463

---

# CLN sendpay_failure published with wrong event type; async payment failures never mark rows FAILED

## Details
The CLN backend maps CLN's `sendpay_failure` gRPC notification stream to the hub's `nwc_lnclient_payment_failed` event but publishes the wrong payload type. `subscribeFailedPayments` (lnclient/cln/cln.go:346-354) sets `Properties: transaction`, a `*lnclient.Transaction`, while the only consumer (transactions/transactions_service.go:972-976) type-asserts `*lnclient.PaymentFailedEventProperties` — the type LND (lnd.go:166), LDK (ldk.go:1899) and Bark publish and the tests assume (notifications_test.go:260-262). The assertion fails for every CLN event, the handler logs 'Failed to cast event' and returns, so `markPaymentFailed` is never reached from the async path on a CLN hub; `clnSendpayFailureToTransaction` is dead in effect.

In the common case this is masked: `SendPaymentSync` (cln.go:2344) blocks on `Xpay` and the caller (transactions_service.go:454) marks the row FAILED synchronously when Xpay errors. The CLN client's `c.ctx` is a child of the app context (service/start.go:351, 457), so even a graceful stop (SIGTERM → cmd/http/main.go cancel → stopAppInternal, with `db.Stop` only afterwards) makes Xpay return and the sync caller mark the row FAILED. The async path is therefore the only recovery for a payment whose synchronous caller died ungracefully: the hub process crashed, was OOM-killed, SIGKILLed or lost power while HTLCs were in flight (systemd `Restart=always` and Docker restart policies bring it back). A remote payee can stretch that window to hours or days by holding the HTLC until near CLTV expiry before failing it. When CLN then reports `sendpay_failure` to the restarted hub, the event is dropped and the outgoing row stays PENDING forever. Nothing else reconciles outgoing rows on CLN: `checkUnsettledTransactions` (transactions_service.go:762-765) is skipped because CLN >= 26.04 advertises `payment_received` (cln.go:1481-1485); for older CLN there is no failure stream at all and `LookupInvoice` queries `ListInvoices` (incoming invoices only). There is no startup reconciliation against `listpays`/`listsendpays` and no expiry sweep for pending outgoing rows.

Consequence: the row's `amount_msat + fee_reserve_msat` is counted indefinitely against the paying app's budget (`GetBudgetUsageMsat`) and, for isolated sub-wallets, against its spendable balance (`GetIsolatedBalanceMsat`, get_isolated_balance.go:24-27) although the funds were returned to the node when the HTLC failed. The sub-wallet user loses access to those funds (they sit in the operator's main wallet with no operator-facing way to release them short of DB edits or a manual top-up), and NIP-47 `list_transactions`/`lookup_invoice` keep reporting the failed payment as pending. A later `payment_sent` for the same hash is still handled (transactions_service.go:898-903), so the failure mode is one-directional: successes are recorded, failures are not.

Assumptions about the dependency: CLN >= 26.04 (the version the hub gates notifications on, cln.go:157) emits `sendpay_failure` for Xpay-initiated payments — the hub's own `subscribeSuccessfulPayments` relies on the sibling `sendpay_success` for the same payments — and its gRPC notification streams are live-only, so the failure must occur after the restarted hub has resubscribed, which the payee's hold guarantees.

## Evidence
1. [lnclient/cln/cln.go:346–354](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/cln/cln.go#L346-L354)
   subscribeFailedPayments publishes nwc_lnclient_payment_failed with Properties set to the *lnclient.Transaction returned by clnSendpayFailureToTransaction, not a *lnclient.PaymentFailedEventProperties as every other backend does.
2. [transactions/transactions\_service.go:971–997](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L971-L997)
   The only consumer casts event.Properties to *lnclient.PaymentFailedEventProperties; the cast fails for every CLN event, it logs 'Failed to cast event' and returns, so markPaymentFailed is never reached for CLN.
3. [lnclient/lnd/lnd.go:164–169](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/lnd/lnd.go#L164-L169)
   LND publishes &lnclient.PaymentFailedEventProperties{Transaction, Reason}; LDK (ldk.go 1897-1902) does the same. CLN is the only backend with the mismatched type.
4. [lnclient/cln/cln.go:2315–2365](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/cln/cln.go#L2315-L2365)
   SendPaymentSync blocks on Xpay with c.ctx, a child of the app context (service/start.go:351 → NewCLNService at :457). A graceful stop cancels it, Xpay returns and the synchronous caller at transactions_service.go:454 marks the row FAILED while the DB is still open; only an ungraceful termination (crash, OOM kill, SIGKILL, power loss) leaves a PENDING row whose only remaining resolution is the async sendpay_failure notification that this bug drops.
5. [transactions/transactions\_service.go:762–798](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L762-L798)
   checkUnsettledTransactions returns immediately when the client advertises payment_received, which CLN does whenever enableNotifications is set (cln.go:1474-1486, CLN >= 26.04); for older CLN it calls LookupInvoice, which in cln.go:1760-1788 queries ListInvoices (incoming invoices only). No startup reconciliation against listpays/listsendpays and no expiry sweep exists, so a stuck outgoing PENDING row is never resolved.
6. [db/queries/get\_isolated\_balance.go:24–31](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/queries/get_isolated_balance.go#L24-L31)
   Isolated balance subtracts amount_msat + fee_msat + fee_reserve_msat of PENDING outgoing rows; a row that never leaves PENDING permanently reduces the sub-wallet's spendable balance (budget usage in get_budget_usage.go:15-18 likewise counts pending rows).

## Impact
Ledger integrity: the transaction history, the app's budget usage and the isolated sub-wallet balance misstate a failed payment as pending indefinitely (low integrity impact). Availability of funds: an isolated sub-wallet permanently loses spendable balance equal to amount plus fee reserve per stuck payment, recoverable only by operator DB edits or a manual top-up since the funds never left the main wallet (low availability impact). No confidentiality impact; no funds leave the node.

## Reproduction steps
1. Attacker is a remote Lightning payee whose invoice an app (or the operator) on a CLN-backed hub (>= 26.04) pays. The payee holds the HTLC for hours or days instead of failing it. If during that window the hub process terminates ungracefully (crash, OOM, SIGKILL, power loss — a graceful stop marks the row FAILED first) and is restarted, the payee then fails the HTLC; CLN's sendpay_failure reaches the hub but is dropped by the type mismatch, leaving the row PENDING forever. The payee needs no hub privileges; the ungraceful restart is runtime state outside their control, and the victim must have initiated a routine payment to the payee's invoice.

## Recommended fix
1. subscribeFailedPayments publishes nwc_lnclient_payment_failed with a *lnclient.Transaction payload, violating the event contract the transactions service relies on (*lnclient.PaymentFailedEventProperties), so the consumer's type assertion fails and the failure is only logged. Fix criteria: A CLN sendpay_failure that terminates a payment must result in the matching PENDING outgoing row being marked FAILED with a failure reason and its fee reserve released, exactly as for LND/LDK, judged at the whole-payment level (a per-part failure during Xpay retries must not fail a payment that is still in flight). Verify with a test feeding a CLN failure event through ConsumeEvent and asserting the row transitions to FAILED, and enforce the event payload type by a shared constructor or compile-time type rather than an unchecked assertion that silently drops the event.
2. Pending outgoing rows on CLN have no reconciliation path other than the live notification streams, so a missed or dropped failure leaves budget and isolated balance debited forever. Fix criteria: On startup and periodically, pending outgoing CLN payments must be reconciled against the node (e.g. listpays/listsendpays by payment hash) or expired once the node reports no in-flight attempt, so budget and isolated-balance queries stop counting them; verify that a pending outgoing row whose payment CLN reports as failed is marked FAILED on the next reconciliation.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper error handling
**CWE:** [CWE-390](https://cwe.mitre.org/data/definitions/390.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256459

---

# Object-typed lud16 metadata from NIP-47 create_connection crashes the app details and disconnect UI

## Details
The SPA renders app.metadata.lud16 as a React child on the assumption (types.ts:224-227 AppMetadata.lud16?: string) that only the hub writes it, via api.CreateLightningAddress (api.go:387). The NIP-47 create_connection controller breaks that assumption: params.Metadata is map[string]interface{} (create_connection_controller.go:26) and is handed to appsService.CreateApp verbatim (line 135; apps_service.go:101-125 marshals and stores it), so a client holding the superuser scope can create a child connection with metadata {"app_store_app_id":"uncle-jim","lud16":{}} and optionally isolated:true. api.GetApp returns the stored object unchanged (api.go:470-479, 504) to GET /api/apps/:pubkey.

Two render sinks interpolate the value as a child node:
1. AppUsage.tsx:118-175: inside the app.isolated block, when app_store_app_id === 'uncle-jim' and lud16 is truthy, `<p>{app.metadata.lud16}</p>` is rendered. AppDetails mounts AppUsage on page load (AppDetails.tsx:401), so /apps/<id> for an isolated malicious connection throws 'Objects are not valid as a React child' (React 19.2) on every visit.
2. DisconnectApp.tsx:36-68: isSubwallet && hasLightningAddress (`!!{}` is true) renders `({app.metadata?.lud16})`, independent of isolation, so opening the Disconnect dialog (AppDetails.tsx:297,482-486) throws. That dialog is the only UI control that issues DELETE /api/apps/:pubkey (useDeleteApp.ts).

Only plain objects trigger it: arrays, numbers and booleans are valid children. frontend/src has no ErrorBoundary/errorElement/onUncaughtError; the app relies on react-router ^7.18.2's default root RenderErrorBoundary (assumed from the pinned dependency), which replaces the whole tree, navigation included, with its 'Unexpected Application Error!' page (a bare React root would instead unmount to a blank page). In both cases the operator must retype a URL to recover, the details page of an isolated malicious connection is unreachable, and the Disconnect dialog cannot be opened for an isolated or non-isolated one.

The connection is hidden from Connected Apps (ConnectedApps.tsx:48-50 filters 'uncle-jim') and AppsCleanup (useUnusedApps subWallets:false) and appears only under Sub-wallets (ListApps subWallets:true matches on the metadata key alone, api.go:553), whose cards navigate to the failing page (AppCard.tsx:29).

Net effect: a superuser NIP-47 client can create a spending connection (any scopes except create_connection, any budget) that the operator cannot inspect, edit or revoke through the shipped UI. The complementary backend failure, DeleteLightningAddress's unchecked `metadata["lud16"].(string)` aborting DELETE /api/apps/:pubkey with a 500, is the verified finding delete-app-trusts-metadata-lud16-from-nip47-clients; together they leave only a hand-crafted PATCH /api/apps/:pubkey with a replacement `metadata` object (api.go UpdateApp:223-231) as a way to clear the value before the connection can be removed. Operator-driven CreateApp/UpdateApp also accept arbitrary metadata, but their author is the operator; the superuser NIP-47 client is the untrusted writer.

Root cause: the hub stores client-authored metadata without validating the type of the keys it later interprets (lud16, app_store_app_id), and the frontend renders lud16 as a string child with no type guard and no application-level error boundary.

## Evidence
1. [frontend/src/components/connections/AppUsage.tsx:118–174](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/connections/AppUsage.tsx#L118-L174)
   Inside the `app.isolated` block (line 78), when metadata.app_store_app_id === 'uncle-jim' the Lightning Address card renders `{app.metadata.lud16}` as a React child (line 173) whenever the value is truthy. A JSON object such as {} is truthy and is not a valid React child, so React 19.2 throws 'Objects are not valid as a React child' during render of AppDetails, which mounts AppUsage on page load (AppDetails.tsx:401).
2. [frontend/src/components/connections/DisconnectApp.tsx:36–67](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/connections/DisconnectApp.tsx#L36-L67)
   isSubwallet (app_store_app_id === 'uncle-jim') && hasLightningAddress (`!!app.metadata?.lud16`, true for an object) renders `({app.metadata?.lud16})` as a child (line 64), independent of app.isolated. Opening the Disconnect dialog (AppDetails.tsx:297,482-486) therefore throws; this dialog is the only UI control that issues DELETE /api/apps/:pubkey (useDeleteApp.ts).
3. [nip47/controllers/create\_connection\_controller.go:26](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/create_connection_controller.go#L26)
   createConnectionParams.Metadata is map[string]interface{}: decodeRequest's json.Unmarshal accepts any JSON type for any key, including an object under lud16 and the hub-interpreted key app_store_app_id.
4. [nip47/controllers/create\_connection\_controller.go:135](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/create_connection_controller.go#L135)
   appsService.CreateApp receives params.Metadata and params.Isolated unmodified; CreateApp (apps_service.go:101-125) json.Marshals the map and stores it verbatim. create_connection is reachable only by a client whose connection holds the superuser scope (permissions.go:174-175, event_handler.go HasPermission).
5. [api/api.go:470–478](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L470-L478)
   GetApp unmarshals the stored JSON into Metadata (= map[string]interface{}, models.go:553) and returns it unchanged in the App response (line 504) served by GET /api/apps/:pubkey (http_service.go:139), so the object-typed lud16 reaches the SPA.
6. [frontend/src/App.tsx:11–14](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/App.tsx#L11-L14)
   The SPA uses a react-router data router (createBrowserRouter / createHashRouter) and frontend/src contains no ErrorBoundary, errorElement or onUncaughtError. Assumption on react-router ^7.18.2 (frontend/package.json, not verified in the checkout): the root route (routes.tsx:97-100, AppLayout) is wrapped in react-router's default RenderErrorBoundary, so the thrown render error replaces the entire tree, navigation included, with the library's 'Unexpected Application Error!' page; without that boundary React would unmount the root to a blank page. Either way the operator must retype a URL to recover.
7. [frontend/src/components/connections/ConnectedApps.tsx:48–49](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/connections/ConnectedApps.tsx#L48-L49)
   Connections with app_store_app_id 'uncle-jim' are filtered out of Connected Apps (and out of AppsCleanup via useUnusedApps subWallets:false); ListApps subWallets:true (api.go:553) selects on that metadata key alone, so the connection surfaces only under Sub-wallets, whose AppCard navigates to /apps/:id (AppCard.tsx:29).
8. [frontend/src/types.ts:224–227](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/types.ts#L224-L227)
   AppMetadata declares lud16?: string, the assumption under which both components interpolate it; the hub's own writer (api.CreateLightningAddress, api.go:387) always stores a string, the NIP-47 writer does not.

## Impact
Availability: the management UI for the affected connection fails on every visit (details page for an isolated connection, Disconnect dialog for any), and the whole SPA tree is replaced by the error page until the operator retypes a URL. Integrity: because inspect, edit (scopes/budget) and revoke controls live on that page, the attacker's spending connection persists against the operator's intent and can only be cleared with a hand-crafted PATCH; no funds move directly and no secrets are disclosed.

## Reproduction steps
1. Attacker holds an app connection the operator granted the superuser scope (unlock password required at grant time, api.go:78-83; the NewApp dialog warns only that the app 'can create connections with a larger budget'). Over the Nostr relay it sends create_connection with isolated:true (or false) and metadata {app_store_app_id:'uncle-jim', lud16:{}}; the controller stores it. The management-UI failure manifests when the operator later opens the connection's page or its Disconnect dialog, a routine action rather than a conscious interaction with the payload (PASSIVE). The only precondition beyond the attacker's privilege is that superuser connections are opt-in, not default (AT:PRESENT).

## Recommended fix
1. create_connection stores NIP-47-client-authored metadata verbatim, including hub-interpreted keys (lud16, app_store_app_id) with arbitrary JSON types, and the frontend renders metadata.lud16 as a string child without a type guard. Fix criteria: Metadata written through NIP-47 cannot set hub-interpreted keys, or those keys are validated as strings (and ignored/coerced otherwise) before storage and before rendering in AppUsage and DisconnectApp. Verify that a connection created via create_connection with lud16 set to an object and app_store_app_id 'uncle-jim' renders its details page and Disconnect dialog without error and can be deleted from the UI.
2. No application-level error boundary exists, so any render exception replaces the whole SPA (navigation included) with the router's default error page. Fix criteria: Route elements (or the app root) are wrapped in an error boundary that shows a recoverable error while keeping navigation usable. Verify that a thrown render error on /apps/:id leaves the sidebar and other routes reachable without retyping a URL.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256452

---

# Read-only JWT obtains decrypted auto-swap xpub from GET /api/autoswap

## Details
Alby Hub lets the operator configure auto swap-out to an extended public key (xpub) so each swap pays a fresh address of an external wallet. Because an xpub reveals every address, and therefore the balance and history, of that external wallet, the project treats it as a secret: EnableAutoSwapOut (api/api.go:1086-1093) accepts an xpub only with the correct unlock password and stores it AES-GCM-encrypted under that password, and the UI tells the user the password is needed 'to encrypt and securely store the XPUB'. At start/unlock, service/start.go:364 hands the unlock password to the swaps service, which decrypts the xpub and caches the plaintext in autoSwapOutDecryptedXpub (swaps/swaps_service.go:178-184).

GetAutoSwapConfig (api/api.go:879-883) reads the stored destination with an empty encryption key (yielding the ciphertext when the row is encrypted) and then replaces it with GetDecryptedAutoSwapXpub(), returning the plaintext xpub in the Destination field of the response. The HTTP route GET /api/autoswap is registered in readOnlyApiGroup (http/http_service.go:162), which applies only JWT validation; the requireFullAccess middleware (http_service.go:397-411) that separates permission=readonly from permission=full tokens is not applied. The handler has no notion of the caller's permission level and the response is identical for both.

This is inconsistent with the project's own treatment of comparable sensitive reads: GET /api/swaps/mnemonic and GET /api/log/:type are in fullAccessApiGroup (http_service.go:204-205) and the test suite asserts a readonly token receives 403 on the log endpoint. Readonly tokens are minted from Developer Settings for third-party API consumers and described as 'view-only access - can read balances, transactions, and other data but cannot perform operations' (DeveloperSettings.tsx:165-169); the threat model names their holders as an adversary. Such a holder obtains, without the unlock password and bypassing the at-rest encryption, a secret that gives permanent read visibility into the operator's external wallet - something no other readonly endpoint provides (GET /api/swaps exposes only the individual derived DestinationAddress of past swaps).

The desktop (Wails) mirror has no authentication by design and is operator-only, so the defect is confined to the HTTP server's readonly role. It is a missing authorization check on a specific disclosure rather than a flaw in the JWT mechanism itself.

## Evidence
1. [api/api.go:879–883](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L879-L883)
   GetAutoSwapConfig reads AutoSwapDestination with an empty encryption key (ciphertext when the row is encrypted) and then overwrites it with GetDecryptedAutoSwapXpub(), so the JSON Destination field carries the plaintext xpub for every caller regardless of JWT permission. This is the code the fix must change (or its route must move).
2. [http/http\_service.go:162](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L162)
   GET /autoswap is registered in readOnlyApiGroup, which applies only echojwt validation and not requireFullAccess; a permission=readonly token reaches getAutoSwapConfigHandler.
3. [http/http\_service.go:204–205](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L204-L205)
   The project's own precedent: the read operations GET /swaps/mnemonic and GET /log/:type are placed in fullAccessApiGroup (TestGetLogOutput_ReadonlyPermission expects 403 for readonly), showing readonly tokens are not meant to see sensitive reads. The xpub, which is encrypted at rest, is treated less strictly than the logs.
4. [api/api.go:1086–1093](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L1086-L1093)
   EnableAutoSwapOut requires CheckUnlockPassword for DestinationType xpub and stores it with SetUpdate(..., unlockPassword), i.e. AES-GCM-encrypted and flagged encrypted. The project treats the xpub as a secret worth the same protection as backend credentials; the frontend tells the user it is encrypted 'safely'.
5. [swaps/swaps\_service.go:178–184](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L178-L184)
   swapsService.EnableAutoSwapOut decrypts the destination with the unlock password and caches the plaintext in autoSwapOutDecryptedXpub for the lifetime of the unlocked session.
6. [swaps/swaps\_service.go:1640–1645](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/swaps/swaps_service.go#L1640-L1645)
   GetDecryptedAutoSwapXpub returns that cached plaintext with no caller-permission context; the API layer is the only place a permission check could be applied.
7. [service/start.go:364](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/start.go#L364)
   On every start/unlock the swaps service is constructed with encryptionKey = the unlock password, so the xpub is decrypted into memory without any further operator action; the readonly caller never needs the password.
8. [frontend/src/screens/settings/DeveloperSettings.tsx:165–169](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/settings/DeveloperSettings.tsx#L165-L169)
   The project defines the readonly token as 'View-only access - can read balances, transactions, and other data but cannot perform operations' and mints it for third-party API access; the holder is a distinct, lower-trust principal, not the operator.

## Impact
One secret the hub encrypts under the unlock password is disclosed to a principal not entitled to it. The xpub cannot spend funds and does not expose the LDK seed, swap mnemonic, JWT secret or backend credentials, so confidentiality loss within the hub is limited. No data or behaviour of the hub is modified and service is unaffected. Subsequent-system impact: The xpub belongs to the operator's external wallet, a separate system. From it every receive address (chain 0, and the change chain for an account-level key) is derivable, so the holder can watch that wallet's full balance and history indefinitely; an xpub cannot be rotated without moving the funds. This is a lasting privacy loss, not control over funds, so confidentiality LOW; no integrity or availability effect.

## Reproduction steps
1. Attacker holds a permission=readonly JWT - the limited token Developer Settings issues for third-party API access, or one leaked from such a consumer. A single GET /api/autoswap with Authorization: Bearer <readonly token> returns JSON whose destination field is the plaintext xpub; no password, no second step, no race. The only condition outside the attacker's control is that the operator configured an xpub (not a plain address) as the auto-swap destination, a supported but non-default setting.

## Recommended fix
1. GetAutoSwapConfig substitutes the decrypted xpub into a response that is served on a route outside requireFullAccess, so a readonly principal reads a secret the project otherwise gates behind the unlock password and encryption at rest. Fix criteria: A permission=readonly token must not be able to recover the xpub from any response: either GET /api/autoswap requires full access, or its response for non-full callers omits the xpub (an enabled/type indicator or a non-reversible fingerprint suffices for display). Verify with a test modelled on TestGetLogOutput_ReadonlyPermission that a readonly token's GET /api/autoswap response contains no xpub material while full tokens retain current behaviour.
2. Values stored encrypted under the unlock password are decrypted into memory at unlock and can be returned by any API read path without regard to the caller's permission level, as the route grouping is the only control. Fix criteria: Every API response field populated from an unlock-password-encrypted config value must be reachable only by full-access callers, consistent with GET /swaps/mnemonic and GET /log/:type; an audit of readOnlyApiGroup handlers confirms none returns such a value.

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
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256447

---

# DB migration resets app id sequence to surviving max, letting new apps inherit deleted apps' ids, balances and wallet keys

## Details
Alby Hub relies on apps.id being a never-reused integer: the per-app NIP-47 wallet keypair is derived from it (service/keys/keys.go GetAppWalletKey), and the transactions ledger attributes every payment to an app solely through transactions.app_id, which has no foreign key and is never cleaned up when an app is deleted (apps_service.DeleteApp deletes only the apps row). Migration 202407151352 introduced AUTOINCREMENT/SERIAL so that in-place SQLite and Postgres never hand out a deleted id again.

The SQLite<->Postgres data-migration code in db/db_migrate.go breaks that invariant. It copies rows with explicit ids and then (Postgres destination) runs `SELECT setval(seq, (SELECT MAX(id) FROM table))`, or (SQLite destination) relies on sqlite_sequence being bumped to the largest copied id. Both yield 'max of the apps that still exist', not the source's historical high-water mark. Every app that was deleted and had an id above the surviving maximum (typically the most recently created connections, e.g. a sub-wallet that was deleted) becomes allocatable again on the destination.

This path is production: (1) the shipped /bin/db_migrate CLI documented in README for SQLite->Postgres and back; (2) 'Settings -> Migrate Alby Hub' on a Postgres-backed hub (api/backup.go CreateBackup -> db.MigrateDB into migration.db), whose SQLite file is restored on the new device.

Consequences when the operator later creates a new app on the migrated hub and it receives a recycled id N:
- Inherited ledger: all orphaned transactions with app_id = N now belong to the new app. If the new app is isolated (a sub-wallet handed to a third party), GetIsolatedBalanceMsat returns the deleted app's residual balance and validateCanPay lets the holder spend that amount of the operator's main-wallet funds, which they were never granted. For budgeted non-isolated apps the deleted app's outgoing payments consume the new app's budget. The isolated app's list_transactions/lookup_invoice also expose the deleted app's payment history.
- Key reuse: the new app's wallet keypair equals the deleted app's; the deleted app's client still knows that wallet pubkey and sees the hub republish a kind-13194 info event for it. Requests it sends are rejected at the app_pubkey lookup, so this part is a weaker integrity/privacy concern, but it violates the one-keypair-per-connection design.

Assumptions: gorm v1.31.2 includes non-zero primary keys in Create; SQLite updates sqlite_sequence to the max explicitly inserted rowid on AUTOINCREMENT tables; PostgreSQL setval(seq, n) makes the next nextval n+1.

## Evidence
1. [db/db\_migrate.go:228–235](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/db_migrate.go#L228-L235)
   resetPostgresSequence sets each sequence to SELECT MAX(id) of the rows that survived into the destination, not to the source's historical high-water mark (sqlite_sequence / sequence last_value). Any deleted app whose id was above the surviving maximum becomes allocatable again.
2. [db/db\_migrate.go:119–145](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/db_migrate.go#L119-L145)
   migrateTable copies rows with their explicit ids via to.Create. For a SQLite destination no sequence handling exists at all: SQLite's AUTOINCREMENT bookkeeping (sqlite_sequence) ends up equal to the largest copied id, which again is the surviving maximum, so deleted top ids are reused on the next INSERT.
3. [db/db\_migrate.go:202–226](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/db_migrate.go#L202-L226)
   The reset list includes apps (apps_2_id_seq); the apps id is the one that feeds key derivation and transaction attribution.
4. [api/backup.go:123–161](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/backup.go#L123-L161)
   Production UI path: on a Postgres-backed hub, 'Settings -> Migrate Alby Hub' (CreateBackup, reachable via POST /api/backup and the Wails handler) creates a fresh migration.db and calls db.MigrateDB into it. The resulting SQLite file is restored on the new device, with sqlite_sequence.apps = MAX(surviving id).
5. [apps/apps\_service.go:148–158](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/apps/apps_service.go#L148-L158)
   CreateApp derives the app's NIP-47 wallet keypair from app.ID (GetAppWalletKey(app.ID)); a reused id reproduces the deleted app's wallet keypair, whose pubkey the deleted app's client still holds.
6. [apps/apps\_service.go:183–186](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/apps/apps_service.go#L183-L186)
   DeleteApp deletes only the apps row. app_permissions/request_events cascade via FK, but transactions do not.
7. [db/migrations/202407012100\_transactions.go:11–32](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/migrations/202407012100_transactions.go#L11-L32)
   The transactions table has app_id with no FOREIGN KEY, so a deleted app's incoming/outgoing transactions survive deletion as orphans keyed by the old app id. No code path deletes them (no Delete(&db.Transaction{}) anywhere).
8. [db/queries/get\_isolated\_balance.go:8–31](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/queries/get_isolated_balance.go#L8-L31)
   Isolated balance is SUM(incoming settled) - SUM(outgoing settled|pending) over transactions WHERE app_id = ?. A new isolated app with a reused id inherits the deleted app's residual balance.
9. [transactions/transactions\_service.go:1165–1189](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1165-L1189)
   validateCanPay authorizes a pay_invoice/keysend from an isolated app when amount <= GetIsolatedBalanceMsat; the inherited balance is therefore spendable main-wallet money.
10. [service/keys/keys.go:145–152](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/service/keys/keys.go#L145-L152)
   GetAppWalletKey path is appKey/1'/appID' - purely a function of the integer id, so id reuse equals key reuse.
11. [db/migrations/202407151352\_autoincrement.go:18–32](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/db/migrations/202407151352_autoincrement.go#L18-L32)
   The in-place schema deliberately switched apps to INTEGER PRIMARY KEY AUTOINCREMENT / SERIAL precisely so ids are never reused (comment: 'broken app permissions no longer linked to apps (from reused app IDs)'). db_migrate does not carry that monotonic counter across, undoing the guarantee.

## Impact
Integrity: a sub-wallet holder can spend operator funds up to the deleted app's residual balance - real but bounded loss, and budgets of other recycled apps are mis-accounted. Confidentiality: the new isolated app can read the deleted app's transaction history and the deleted client learns a new connection reuses its wallet key. No availability impact.

## Reproduction steps
1. Precondition (deployment state): the operator migrated the DB with db_migrate or the Postgres 'Migrate Alby Hub' flow, and at least one app with an id above the surviving maximum had been deleted while its transactions remained. The operator then creates a new (isolated) connection, which receives the recycled id. The holder of that connection - an ordinary NIP-47 client over the relay - calls get_balance/pay_invoice and spends the inherited residual balance; no defence stands in the way because the ledger itself attributes the old rows to the new app.

## Recommended fix
1. db_migrate derives the destination id counters from the surviving rows (MAX(id)) instead of carrying over the source's monotonic high-water mark, so ids of deleted apps become allocatable again although key derivation and transaction attribution assume ids are never reused. Fix criteria: After migration the destination must never allocate an id that the source ever allocated: carry the source counters (sqlite_sequence.seq / sequence last_value, or at least MAX(app_id) across transactions and the source counter) into setval and sqlite_sequence for every table whose ids are referenced or used for key derivation. Verify by migrating a DB whose highest-id app was deleted, creating a new app, and asserting its id and wallet_pubkey differ from the deleted app's.
2. transactions.app_id has no foreign key and deleted apps' transactions are left attributed to the dead id, so any id reuse silently transfers balance history to a new app. Fix criteria: Deleting an app must leave no transactions attributable to a future app with the same id (e.g. detach/mark them, or enforce referential integrity), and balance/budget queries for an app must only count transactions created while that app existed. Verify by creating an app with a recycled id and asserting GetIsolatedBalanceMsat and GetBudgetUsageMsat are zero.

---
**Severity:** LOW
**Status:** Open
**Category:** Identifier reuse
**CWE:** [CWE-694](https://cwe.mitre.org/data/definitions/694.html)
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256444

---

# DeleteApp trusts app metadata lud16 set by NIP-47 clients: panic blocks deletion, unvalidated Alby API path

## Details
api.DeleteApp (api/api.go:351-363) calls api.DeleteLightningAddress whenever apps.HasLightningAddress reports a non-nil metadata.lud16, and only then deletes the app row. DeleteLightningAddress (api/api.go:396-436) assumes lud16 is the string the hub itself wrote in CreateLightningAddress (api/api.go:387): it does `lud16 := metadata["lud16"].(string)` without the ok-idiom and forwards `strings.Split(lud16, "@")[0]` unvalidated to albyOAuthSvc.DeleteLightningAddress, which fmt.Sprintf-interpolates it into `DELETE https://api.getalby.com/internal/lightning_addresses/<address>` sent with the operator's OAuth token (alby/alby_oauth_service.go:432).

The assumption fails because the NIP-47 create_connection controller stores the requesting client's `metadata` object verbatim on the child app (nip47/controllers/create_connection_controller.go:135 -> apps/apps_service.go:125). create_connection is reachable only by an app the operator granted the superuser scope (nip47/event_handler.go:362 HasPermission; RequestMethodToScope maps it to superuser; granting superuser requires the unlock password, api/api.go:78-83). That scope concedes creating connections, not writing values the hub later treats as its own.

When the operator later disconnects the attacker's child app (the shipped UI's only removal path, DELETE /api/apps/:pubkey -> http/http_service.go:1237, or the Wails route wails/wails_handlers.go:119):
1. Non-string lud16 (e.g. `{"lud16": 1}`): the type assertion panics before appsSvc.DeleteApp runs. Under HTTP, echo's Recover middleware (http/http_service.go:93, echo v4.16.0) turns it into a 500 and the app row survives: a connection that may hold pay_invoice cannot be removed through the UI (the SPA has no metadata editor; AppDetails only spreads existing metadata). On the desktop build no recover() exists in wails/ or main_wails.go; whether Wails v2.16.0 recovers panics in bound methods is unverified here, and if it does not the desktop app terminates.
2. Attacker-chosen string lud16: the hub issues an OAuth-authenticated DELETE for a path segment the attacker chose, e.g. the local part of the operator's primary lightning address (visible to any non-isolated app via get_info), or a value containing '/', '?' or '..' that changes the request target on api.getalby.com. The SPA's confirmation dialog mentions the address only when the attacker-controlled `app_store_app_id` equals the sub-wallet id (frontend/src/components/connections/DisconnectApp.tsx:36-67), so the attacker can suppress the warning. Whether the Alby endpoint deletes an arbitrary address owned by the account is an external assumption; the hub-side defect is that it acts as a confused deputy on client-written data. An Alby error is only logged and deletion proceeds, so this branch does not block removal.

UpdateApp and CreateApp also accept arbitrary metadata, but their caller is the operator; the superuser NIP-47 client is the untrusted author.

## Evidence
1. [api/api.go:411–423](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L411-L423)
   DeleteLightningAddress performs an unchecked type assertion metadata["lud16"].(string) (panics on a non-string value) and passes the unvalidated local part of lud16 to albyOAuthSvc.DeleteLightningAddress; this is the code the fix must change.
2. [api/api.go:351–362](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/api/api.go#L351-L362)
   DeleteApp calls DeleteLightningAddress before appsSvc.DeleteApp whenever HasLightningAddress is true; a panic there aborts before the app row is deleted, while an Alby API error is only logged.
3. [nip47/controllers/create\_connection\_controller.go:135](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/create_connection_controller.go#L135)
   params.Metadata decoded from the NIP-47 request is handed verbatim to appsService.CreateApp and stored as the child app's metadata, so lud16 (and app_store_app_id) are client-authored.
4. [apps/apps\_service.go:249–261](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/apps/apps_service.go#L249-L261)
   HasLightningAddress returns true for any non-nil lud16 of any JSON type, so numeric/object values reach the unchecked assertion.
5. [alby/alby\_oauth\_service.go:432](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/alby/alby_oauth_service.go#L432)
   The address is interpolated unescaped into the request path of an OAuth-authenticated DELETE to api.getalby.com, so '/', '?' or '..' alter the request target.
6. [nip47/event\_handler.go:362](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/event_handler.go#L362)
   HasPermission gates create_connection on the calling app's superuser scope: the attacker position is a NIP-47 client holding an operator-granted superuser connection.
7. [http/http\_service.go:93](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/http/http_service.go#L93)
   echo's Recover middleware contains the panic in HTTP mode: the DELETE returns 500 and the app row is never removed.
8. [wails/wails\_handlers.go:119](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/wails/wails_handlers.go#L119)
   Desktop DELETE route calls api.DeleteApp with no recover() anywhere in wails/ or main_wails.go; panic containment depends on Wails v2.16.0 (unverified).
9. [frontend/src/components/connections/DisconnectApp.tsx:36–66](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/connections/DisconnectApp.tsx#L36-L66)
   The confirmation dialog warns about the lightning address only when app_store_app_id equals the sub-wallet id, a key the attacker also controls, so the operator can be shown no warning before the authenticated DELETE is sent.

## Impact
Integrity: the hub issues an OAuth-authenticated destructive request whose path segment the NIP-47 client chose, acting as a confused deputy on client-written data. Availability: the shipped UI's only removal path for the malicious connection fails with 500 (HTTP, echo Recover), so a connection that may hold pay_invoice persists until the operator edits metadata by hand; on the desktop build the panic is unrecovered in hub code and may terminate the app (Wails v2.16.0 behaviour assumed). Subsequent-system impact: The DELETE is sent with the operator's token to api.getalby.com for an attacker-chosen address (e.g. the operator's primary lightning address learned via get_info). Assumption: the Alby endpoint deletes any address owned by the account; this could not be verified from the repository and caps the rating at LOW.

## Reproduction steps
1. Attacker holds an app connection the operator granted the superuser scope (unlock password required at grant time). Over Nostr it calls create_connection with metadata {"lud16": <crafted>}; the controller stores it verbatim. Later the operator disconnects that app in the UI, clicking Disconnect and confirming the dialog (conscious interaction with the attacker's payload: ACTIVE). The panic branch needs no further condition (the assertion at api.go:415 runs before any Alby token fetch); the API branch additionally needs a linked Alby account, which is the default flow.

## Recommended fix
1. DeleteLightningAddress treats metadata.lud16 as hub-written trusted data (unchecked type assertion, no format validation) although NIP-47 clients can write app metadata. Fix criteria: Deleting an app never panics on malformed metadata, and the address forwarded to Alby is validated as a lightning-address local part (allowed character set, no path/query characters) and URL-path-escaped; ideally the hub records which address it created for the app and deletes only that. Verify by creating an app via create_connection with lud16 set to a number and to a path-like string and confirming deletion succeeds without any Alby request for the bogus value.
2. create_connection stores client-supplied metadata verbatim, including keys the hub itself interprets (lud16, app_store_app_id). Fix criteria: Metadata written through NIP-47 cannot set hub-interpreted keys (or those keys are ignored by hub logic unless written by the hub). Verify that a create_connection request with lud16/app_store_app_id in metadata does not influence HasLightningAddress or sub-wallet classification.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-20](https://cwe.mitre.org/data/definitions/20.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** HIGH
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256443

---

# make_hold_invoice accepts payment hashes of existing invoices, letting one app hijack another's hold invoice

## Details
The NIP-47 make_hold_invoice method lets the calling app choose the payment hash (nip47/controllers/make_hold_invoice_controller.go:62-74). LDKService.MakeHoldInvoice (lnclient/ldk/ldk.go:2559-2651) validates only that it is 32 hex bytes and calls ldk_node Bolt11Payment().ReceiveForHash / ReceiveForHashWithMinCltvExpiryDelta; it never checks ls.node.Payment(hash) for an existing registration. transactionsService.MakeHoldInvoice (transactions/transactions_service.go:247-300) then inserts a second INCOMING/PENDING row for the same hash under the caller's app id. The hub deliberately permits several incoming rows per hash (the 'wrapped invoice' design exercised by transactions/self_hold_payments_test.go TestWrappedInvoice, where one app's hold invoice reuses another app's invoice hash) and disambiguates them in markHoldInvoiceAccepted (transactions_service.go:1000-1060) by payment_hash AND payment_request. But the payment_request it matches against comes from the LDK payment store (ldk.go:1924-1952 reads ls.node.Payment(paymentId) and publishes nwc_lnclient_hold_invoice_accepted with that record's Bolt11Invoice), and that store holds exactly one record per hash: the last registration wins. The disambiguation key is therefore chosen by whoever registered the hash most recently, not by which invoice the payer actually paid.

Explicit dependency assumption: this requires that ldk-node-go (github.com/getAlby/ldk-node-go v0.0.0-20261015143504-ca24bcee5b83, go.mod:11) ReceiveForHash succeeds and replaces the payment-store record when a payment with id == payment_hash already exists. Upstream ldk-node's inbound receive path inserts into the payment store (an overwriting insert) and only the outbound send path rejects DuplicatePayment; the hub's own wrapped-invoice feature on the LDK backend relies on a second registration of an existing hash succeeding, so the project does not treat the backend as rejecting duplicates (LND does: 'invoice with payment hash already exists', quoted in the same test file).

Attack (under that assumption): app B (victim) creates hold invoice I_B with hash H and amount A_B. App A (attacker: any connection with make_invoice scope, which bundles make_hold_invoice; it learns H from list_transactions with unpaid_incoming, which is unscoped for non-isolated apps, or because it is B's counterparty and chose/was given H) calls make_hold_invoice with payment_hash=H and amount <= A_B. The LDK record for H now carries A's invoice I_A; the DB holds row R_A (app A, PENDING, payment_request I_A) beside B's R_B. LDK's inbound payment secrets are stateless, so when the payer pays I_B the HTLC is accepted and PaymentClaimable fires with PaymentId H; the hub reads the LDK record, publishes hold_invoice_accepted with Invoice=I_A, and markHoldInvoiceAccepted moves R_A (not R_B) to ACCEPTED and notifies A's app. R_B stays PENDING, so B's settle_hold_invoice fails at the app-scoped lookup (transactions_service.go:1313-1330) and B can never settle its own invoice; A, now holding an ACCEPTED row for H, may call cancel_hold_invoice (transactions_service.go:1362-1380), whose app-id scoping is satisfied, and FailForHash fails the victim's HTLC back to the payer. This defeats the per-app ownership that SettleHoldInvoice/CancelHoldInvoice scoping is meant to enforce. The same registration against another app's ordinary invoice leaves two INCOMING rows for one hash, which the payment_received consumer (transactions_service.go:811-815) resolves with Limit(1) and no ORDER BY, making settled-payment attribution database-order dependent.

## Evidence
1. [lnclient/ldk/ldk.go:2559–2650](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L2559-L2650)
   MakeHoldInvoice validates only that the client-supplied paymentHash is 32 hex bytes and then registers it with ldk_node ReceiveForHash / ReceiveForHashWithMinCltvExpiryDelta. It does not check ls.node.Payment(paymentHash) for an existing registration, so a hash belonging to another app's outstanding hold invoice is accepted and the single per-hash LDK record is replaced with the caller's invoice.
2. [transactions/transactions\_service.go:247–299](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L247-L299)
   transactionsService.MakeHoldInvoice creates a second INCOMING/PENDING row for the same payment hash under the calling app's ID without checking whether another app already owns a pending incoming row for that hash.
3. [lnclient/ldk/ldk.go:1924–1951](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/lnclient/ldk/ldk.go#L1924-L1951)
   On PaymentClaimable the hub reads ls.node.Payment(paymentId) and publishes nwc_lnclient_hold_invoice_accepted with the invoice string from that record; after the attacker's later registration this is the attacker's invoice, not the one the payer paid.
4. [transactions/transactions\_service.go:1000–1059](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1000-L1059)
   markHoldInvoiceAccepted matches on payment_hash AND payment_request (the comment says wrapped invoices share a hash), so the attacker's row, whose payment_request matches the LDK record, is moved to ACCEPTED and the victim's row stays PENDING; the acceptance notification goes to the attacker's app.
5. [transactions/transactions\_service.go:1362–1379](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/transactions_service.go#L1362-L1379)
   CancelHoldInvoice authorises by (payment_hash, state ACCEPTED, app_id); with its own row ACCEPTED the attacker app passes this check and FailForHash fails the victim's held HTLC back to the payer. SettleHoldInvoice (1313-1330) uses the same app-scoped lookup, so the victim can never settle.
6. [nip47/controllers/make\_hold\_invoice\_controller.go:62–73](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/nip47/controllers/make_hold_invoice_controller.go#L62-L73)
   The payment_hash is taken verbatim from the NIP-47 request of any app whose make_invoice scope grants make_hold_invoice (nip47/permissions/permissions.go:126).
7. [transactions/self\_hold\_payments\_test.go:111–216](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/transactions/self_hold_payments_test.go#L111-L216)
   TestWrappedInvoice (LNBackendType=LDK) documents the intended design: a second app registers a hold invoice on a hash already held by another app's incoming invoice, and quotes LND rejecting the same operation. It shows the hub relies on the backend accepting duplicate hash registration and on payment_request to tell the rows apart, which is the key the attacker controls.

## Impact
Integrity: the victim app's hold invoice lifecycle is taken over by another app: acceptance lands on and is notified to the attacker's row, the victim's row never leaves PENDING, and the attacker can cancel the held HTLC despite the per-app scoping of CancelHoldInvoice; attribution of colliding ordinary invoices becomes order dependent. Availability: the victim's hold invoices cannot be settled and the payer's HTLC is failed back. No preimage or other secret is disclosed to the attacker. Impact is bounded to the hub's own per-app ledger and incoming payments.

## Reproduction steps
1. Attacker holds any app connection with the make_invoice scope (PR:L) and sends a NIP-47 make_hold_invoice over the relay with a victim's payment hash. Attack requirements: the attacker must learn the hash (list_transactions with unpaid_incoming is unscoped for non-isolated apps; or it is the victim's counterparty), register after the victim and before the payer pays, and choose an amount not above the victim's. No user interaction. Depends on the stated ldk-node-go (v0.0.0-20261015143504-ca24bcee5b83) behaviour that ReceiveForHash succeeds for an already-registered hash, which the project's own wrapped-invoice feature on LDK also presumes; this link is unverified in the checkout and caps the rating.

## Recommended fix
1. The hub attributes a hold-invoice acceptance to a DB row by the invoice string stored in the backend's single per-hash payment record, which the most recent make_hold_invoice caller controls, instead of by which invoice (payment secret) the payer actually paid. Fix criteria: Acceptance, settlement and cancellation of a held payment must be attributed to the row whose invoice was actually paid, independent of later registrations for the same hash. Verify by creating hold invoices for the same hash from two apps in either order, paying the first app's invoice, and confirming the first app's row is the one accepted, settleable and cancellable while the second app's row is not.
2. LDKService.MakeHoldInvoice and transactionsService.MakeHoldInvoice register a client-chosen payment hash without confirming that no other app already owns an unsettled incoming payment for that hash. Fix criteria: A make_hold_invoice request whose hash already belongs to another app's pending hold invoice (in the node's payment store or in the transactions table) must be rejected before the backend registration is made, while any sanctioned wrapped-invoice flow remains explicit and cannot displace the original row. Verify that a second app's make_hold_invoice for an existing pending hold-invoice hash returns an error and leaves the node's record and the victim's row unchanged.

---
**Severity:** LOW
**Status:** Open
**Category:** Authorization bypass through user-controlled key
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
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256402

---

# Desktop app passes LNURL-supplied successAction URL to OS URL opener without scheme validation

## Details
In the Wails desktop build the SPA opens every "external" link through frontend/platform_specific/wails/src/utils/openLink.ts (copied over src/utils/openLink.ts by `yarn prepare:wails`, which wails.json's `frontend:build: yarn build:wails` runs for the artifacts .github/workflows/wails.yml uploads). openLink calls the Wails runtime's BrowserOpenURL(url) with no validation of scheme or host. isHttpMode() (frontend/src/utils/isHttpMode.ts) returns false inside the webview (hostname starts with `wails`), so ExternalLink renders a <span> whose click handler calls openLink(to) instead of a browser-governed <a>.

The primary untrusted input is a LUD-09 successAction from a remote LNURL-pay / lightning-address server, an adversary the threat model names. Send.tsx:96-101 builds `new LightningAddress(recipient)` from the address the operator types, fetches the remote lnurlp JSON and navigates to /wallet/send/lnurl-pay with the object; LnurlPay.tsx:48 calls lnAddress.requestInvoice() (@getalby/lightning-tools ^8.1.0), whose callback JSON may carry `{tag:"url", description, url}`; after payment LnurlPay.tsx:74-82 passes the Invoice (with the server-supplied successAction) as router state to /wallet/send/success; PaymentSuccess.tsx:118-137 renders `<ExternalLink to={action.url}>` with the URL as link text. A click goes to openLink -> BrowserOpenURL -> OS opener with the attacker's string, e.g. `file://attacker/share/payload.exe`, a local `file:///` path, or any registered custom scheme (ms-msdt:, search-ms:, etc.). The attacker only needs to run a lightning address the victim is willing to pay (tip jar, merchant, zap recipient).

No control exists on this path: nothing in the frontend validates successAction.url, wails/wails_app.go registers no URL filter, and the project's own http(s)-only helper frontend/src/utils/safeReturnToUrl.ts is applied to return_to parameters but not here. In HTTP mode the same component renders a real <a target=_blank>, so the browser blocks file: navigation from an http(s) page and prompts before launching custom schemes; none of those mitigations exist in the webview path. Two further unvalidated sources reach the same sink - story CTA URLs (GET /api/alby/stories) and LSP contactUrl values (channel offer / peer suggestions) - but those come from the Alby API, which the hub otherwise trusts.

Assumptions stated explicitly (dependency sources not inspected): Wails v2.16.0's BrowserOpenURL dispatches to the platform opener (`open` on macOS, `xdg-open` on Linux, rundll32 url.dll,FileProtocolHandler or equivalent on Windows, via the pkg/browser fork pinned indirectly as github.com/pkg/browser v0.0.0-20240102092130) without filtering schemes, and lightning-tools ^8.1.0 passes the server's successAction through unmodified. Whether the launched file or handler executes without further OS prompting (SmartScreen, Gatekeeper, UNC security warnings) depends on the host, which is why impact is rated low rather than high.

## Evidence
1. [frontend/platform\_specific/wails/src/utils/openLink.ts:3–11](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/platform_specific/wails/src/utils/openLink.ts#L3-L11)
   Desktop-mode openLink hands the string straight to the Wails runtime BrowserOpenURL with no scheme or host check. This file is copied over src/utils/openLink.ts by `yarn prepare:wails` (frontend/package.json), which wails.json's frontend:build runs, so it is what the shipped desktop build (wails.yml artifacts) executes. This is the code the fix must change.
2. [frontend/src/components/ExternalLink.tsx:17–29](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/ExternalLink.tsx#L17-L29)
   When isHttpMode() is false (inside the Wails webview, hostname starts with `wails`) ExternalLink renders a span whose click handler calls openLink(to) for whatever `to` it was given; the browser-level protections present in HTTP mode (a real <a> element, file: blocked from http origins, user prompt for custom schemes) do not apply here.
3. [frontend/src/screens/wallet/send/PaymentSuccess.tsx:118–136](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/send/PaymentSuccess.tsx#L118-L136)
   For a successAction of tag 'url' the component renders <ExternalLink to={action.url}> and displays action.url as the link text. action.url is taken verbatim from the paid LNURL-pay server's callback response and is not validated anywhere in the frontend.
4. [frontend/src/screens/wallet/send/LnurlPay.tsx:48–51](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/send/LnurlPay.tsx#L48-L51)
   The Invoice object (including successAction) is produced by lnAddress.requestInvoice(), i.e. from the remote lightning-address / LNURL-pay server's callback JSON response.
5. [frontend/src/screens/wallet/send/LnurlPay.tsx:74–82](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/send/LnurlPay.tsx#L74-L82)
   After the payment succeeds the remote-supplied invoice object is passed as router state to /wallet/send/success, where PaymentSuccess renders the successAction.
6. [frontend/src/screens/wallet/Send.tsx:96–101](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/screens/wallet/Send.tsx#L96-L101)
   Entry point: the operator types a lightning address; `new LightningAddress(recipient).fetch()` contacts the remote server and the resulting object is handed to LnurlPay via router state. The remote server operator is whoever owns the address the operator chooses to pay.
7. [frontend/src/utils/safeReturnToUrl.ts:9–11](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/utils/safeReturnToUrl.ts#L9-L11)
   Shows the project's own control for externally supplied URLs - parse with URL and accept only http:/https: - exists for return_to parameters but is not applied to successAction.url, story CTA URLs or LSP contactUrl before they reach openLink.
8. [frontend/src/components/home/widgets/StoriesWidget.tsx:229–235](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/home/widgets/StoriesWidget.tsx#L229-L235)
   Secondary source into the same sink: story CTA URLs returned by GET /api/alby/stories (Alby API) are passed to ExternalLink unvalidated.
9. [frontend/src/components/channels/LSPTermsDialog.tsx:45–47](https://github.com/Halbarevi/albyhub/blob/4ff44f3550bf56bb4dbf4c26762f8d248edfbf71/frontend/src/components/channels/LSPTermsDialog.tsx#L45-L47)
   Secondary source into the same sink: LSP contactUrl from the channel-offer / channel-suggestions API responses is passed to ExternalLink unvalidated.

## Impact
The desktop app is made to launch an attacker-chosen file or protocol handler on the operator's machine, the same machine holding the hub's seed and database. The outcome depends on which handlers the OS has registered and on OS warnings (SmartScreen/Gatekeeper may add a prompt), so the directly demonstrable impact on the hub is rated low rather than high. Subsequent-system impact: The launched URL is handled by other applications on the operator's host (shell/file opener, registered protocol handlers), so the impact crosses out of the hub into the host OS; the reachable impact depends on those handlers and is rated low.

## Reproduction steps
1. Attacker operates a lightning address / LNURL-pay endpoint. The desktop (Wails) operator pays it from Send -> Lightning Address; the attacker's callback response carries successAction {tag:'url', url:'file://attacker/share/x.exe'} (or any custom scheme). The success screen shows the URL as a link; when the operator clicks it, ExternalLink -> openLink -> BrowserOpenURL hands the string to open/xdg-open/rundll32 FileProtocolHandler, which launches the file or protocol handler. Network-delivered, no privileges, but requires the victim to choose to pay the attacker (AT:P) and to click the link (UI:A).

## Recommended fix
1. frontend/platform_specific/wails/src/utils/openLink.ts forwards any string to BrowserOpenURL, so the OS opener receives file:, UNC and custom-scheme URLs originating from remote responses. Fix criteria: In desktop mode only http: and https: URLs (parsed with the URL constructor) may reach BrowserOpenURL; anything else is rejected and never dispatched. Verify by rendering a successAction with a file:// or custom-scheme URL and confirming the click does not invoke the OS opener.
2. PaymentSuccess.tsx (and the stories CTA / LSP contactUrl renderers) treat remote-supplied URLs as safe link targets without validation. Fix criteria: Remote-supplied URLs (LNURL successAction.url, story cta.url, LSP contactUrl) are validated to http(s) before being rendered as links in either mode, and non-conforming values are shown as inert text or dropped. Verify with an LNURL callback returning a non-http successAction URL: no clickable link is produced.

---
**Severity:** LOW
**Status:** Open
**Category:** Open redirect
**CWE:** [CWE-610](https://cwe.mitre.org/data/definitions/610.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/albyhub
**Branch:** main
**Commit:** 4ff44f3550bf56bb4dbf4c26762f8d248edfbf71
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01EFpJeLF3mQUY1dHvCQaCqu&finding=scan_011QPEduZpMvD3gczxk77EkU-5256389