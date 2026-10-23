# Pull request code runs with passwordless root on self-hosted runner shared with release pipeline

## Details
All PR-triggered workflows (ci.yml, backend-integration.yml, docker.yml test-images, supply-chain-audit.yml, oss-scanner.yml) run on the self-hosted runner label `mempool-ci`, the same label that executes the release pipeline (docker.yml `build`/`tag-latest`, which logs into Docker Hub with DOCKER_USERNAME/DOCKER_PASSWORD and pushes `mempool/frontend` and `mempool/backend`, including `latest`). Only server-config.yml uses GitHub-hosted `ubuntu-latest`.

A pull request author controls every script those jobs execute: ci.yml:76/81 runs the PR's `meta/scripts/check-install-scripts.sh` directly and then `npm ci`, which runs the PR's root `preinstall` (backend/package.json:30); `validate_docker_json` (ci.yml:470-475) runs the PR's docker/backend/start.sh; docker.yml test-images runs the PR's docker/init.sh (line 59), builds the PR's Dockerfiles, and `docker compose up -d` (line 152) on a compose file derived from the PR's docker/docker-compose.yml (line 92); backend-integration.yml:96 does the same with the PR's backend/docker-compose.test.yml. The workflows themselves prove the runner account has non-interactive passwordless sudo (`sudo apt-get install jq -y` in a PR-triggered job, ci.yml:466; `sudo mount`/`sudo systemctl restart docker` in docker.yml:246-268) and docker-group access (docker invoked without sudo). Any PR therefore obtains root on the runner host by `sudo` from a PR script, `docker run --privileged -v /:/host`, or a compose service with `privileged: true`/`pid: host`.

GitHub semantics (stated assumption): fork PRs get a read-only GITHUB_TOKEN and no repository secrets, and under the default fork-approval setting only first-time contributors need a maintainer click; an author with one previously merged commit runs automatically. So the PR job itself holds no secret. The finding holds on the condition that the `mempool-ci` runner, its host, or its docker daemon is reused across jobs (the repository contains no provisioning for the runner and nothing stating it is ephemeral; the single squashed git history gives no further evidence). Under that condition root persists: the attacker can read the runner's `.credentials`/`.runner` files (impersonate the runner and receive any later job and its secrets), trojan `/usr/bin/docker` or the runner binary, or install a service that scrapes Runner.Worker memory. The next tag push then hands over DOCKER_USERNAME/DOCKER_PASSWORD (docker.yml:290-294, login happens before checkout and the credential lands in the runner user's docker config) and the attacker can push arbitrary `mempool/*:latest` images consumed by every Docker/Umbrel self-hoster; CYPRESS_RECORD_KEY and the e2e jobs' tokens are captured the same way. If instead each job runs on a fresh single-use VM, the PR author gains no more than GitHub-hosted runners already concede and this finding does not apply. GitHub's documentation explicitly warns against self-hosted runners for public-repository pull requests for exactly this reason.

The threat model lists 'whoever can open a pull request' as adversary 6 and the Docker Hub images as a supply-chain asset; this is the path connecting them.

## Evidence
1. [.github/workflows/ci.yml:3–21](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/ci.yml#L3-L21)
   Workflow triggers on every pull_request (opened/synchronize) and runs on the self-hosted runner label `mempool-ci`; the only exclusion is the `ops` label/branch prefix. Fork PRs reach this path once a first-time contributor is approved or the author has any prior merged commit.
2. [.github/workflows/ci.yml:74–82](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/ci.yml#L74-L82)
   The Install step first executes `bash meta/scripts/check-install-scripts.sh` — a script taken verbatim from the PR checkout — and then `npm ci`, which runs the PR's root `preinstall` lifecycle script (backend/package.json:30). Either is arbitrary attacker-authored shell executed as the runner user on the self-hosted host.
3. [.github/workflows/ci.yml:465–476](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/ci.yml#L465-L476)
   `sudo apt-get install jq -y` with no password proves the runner user has passwordless sudo, so any PR step (the preinstall above, or `sh start_ci.sh` which is the PR's own docker/backend/start.sh) can run `sudo` to become root.
4. [.github/workflows/docker.yml:243–269](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L243-L269)
   The release `build` job runs on the same `mempool-ci` label and relies on passwordless sudo (swapoff/fallocate/mount tmpfs/systemctl restart docker), confirming the privileged release pipeline and untrusted PR jobs share one runner pool and one sudo-capable account.
5. [.github/workflows/docker.yml:290–297](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L290-L297)
   `docker login` with DOCKER_USERNAME/DOCKER_PASSWORD happens on that runner (credentials land in ~/.docker/config.json and pass through the docker CLI); an implant left by an earlier PR job captures them and gains push rights to the official Docker Hub namespace.
6. [.github/workflows/docker.yml:20–27](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L20-L27)
   `test-images` runs on every PR with no label gate, executing the PR's docker/init.sh (line 59) and `docker compose up -d` (line 152) on a compose file taken from the PR checkout (line 92), so a PR can also define privileged / host-mounted containers; docker is invoked without sudo, so the runner user is in the docker group (root-equivalent) regardless of sudo.
7. [.github/workflows/backend-integration.yml:95–97](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/backend-integration.yml#L95-L97)
   Same pattern: `docker compose -f docker-compose.test.yml up -d` on a PR-controlled compose file from the PR's backend/ directory, on the same runner.
8. [backend/package.json:30](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/package.json#L30)
   The `preinstall` hook that `npm ci` executes is defined in the PR-controlled manifest.

## Impact
Root on the CI runner: full read of runner credentials and all secrets of later jobs (Docker Hub, Cypress, GITHUB_TOKENs), arbitrary modification of build outputs, and ability to disable or hijack CI. Subsequent-system impact: Captured DOCKER_USERNAME/DOCKER_PASSWORD allow pushing malicious `mempool/frontend` and `mempool/backend` images, including `latest`, which Docker/Umbrel self-hosters pull; those containers hold Bitcoin Core RPC and database credentials and serve the explorer UI, so impact crosses to every downstream deployment.

## Reproduction steps
1. Attacker: any GitHub account that can open a PR (auto-run after one merged commit, or after a one-time first-contributor approval). Delivery: a PR whose backend/package.json `preinstall` (or docker-compose.yml, Dockerfile, init.sh) runs `sudo`/privileged docker to plant a persistent implant on the runner host. Exploitation completes when the next secret-bearing job (tag push -> Docker Hub login) runs on that runner. Requires the runner to be non-ephemeral or to share host/daemon between jobs (AT:PRESENT); no defensive mechanism must be defeated.

## Recommended fix
1. Untrusted pull-request code executes on the same runner pool, as the same sudo- and docker-capable account, that performs credentialed release publishing; nothing isolates PR jobs from release jobs. Fix criteria: PR-triggered jobs must not run on infrastructure that ever holds release credentials: route pull_request jobs to GitHub-hosted or ephemeral, single-use runners (or a separate runner pool with no secrets), and keep docker.yml build/tag-latest on a dedicated runner that never executes PR code. Verify by confirming a PR workflow cannot leave any file, container, or process observable by a subsequent tag-push job.
2. The runner account has passwordless sudo and docker-group access, so any step a PR controls is root-equivalent on the host. Fix criteria: Remove sudo and direct docker-socket access from the account that runs PR jobs; perform swap/tmpfs preparation in runner provisioning rather than in-workflow. Verify that `sudo -n true` and `docker info` fail from a PR job.

---
**Severity:** CRITICAL
**Status:** Open
**Category:** Improper isolation
**CWE:** [CWE-653](https://cwe.mitre.org/data/definitions/653.html)
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
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258141

---

# Block-side ClusterMempool build materialises O(N^2) ancestor/descendant sets on deep in-block chains

## Details
When MEMPOOL.CLUSTER_MEMPOOL_INDEXING is enabled, every block at or above CM_ACTIVATION_HEIGHT is passed through `calculateClusterMempoolBlockCpfp` (block-processor.ts:234), which constructs a `ClusterMempool` over all of the block's transactions (cpfp.ts:196). The structure was designed for mempool contents, whose dependency depth Bitcoin Core policy bounds (the researcher ledger dismisses the same addDependency loop for the mempool path on exactly that ground); a mined block has no such bound, and nothing in `buildFromMempool` / `createClusterFromTxids` caps component size or depth.

Cost on an N-transaction in-block chain T1->T2->...->TN:
1. `DepGraph.addDependency` (depgraph.ts:51-56) materialises the full transitive closure in per-tx `ancestors`/`descendants` Sets: N^2/2 insertions in block order and N*(N+1) live Set entries. For N = 15,000 (minimal P2A->P2A spends, ~256 WU each) that is ~2.25x10^8 entries; for N = 9,000 (ordinary P2WPKH) ~8x10^7. Assuming V8 Set entries cost ~24-32 bytes each (Node release builds without pointer compression; the manifest pins no Node version), that is several GB of heap.
2. `linearizeCluster` with budget 25000: the budget gates only optimizeSFL/minimizeSFL (linearize.ts:197-202); `makeTopological`/`extractLinearization` run unbudgeted (this phase is also described, for the mempool path, by the verified record cluster-mempool-unbudgeted-quadratic-relinearization-and-removal).
3. The per-tx loop in cpfp.ts:201-232 calls `getCpfpDataForTx` for every tx; `findChunkInfo` (cluster-mempool.ts:696-708) is a linear `includes` over all chunks, so this phase is O(N^2) regardless of how the chain chunkifies. If the attacker gives the chain strictly increasing child feerates, `chunkify` (linearize.ts:13-30) merges it into a single N-tx chunk, `minimizeChunks` cannot split a connected chain, and `getChunkRelatives` (334-352) then emits i-1 ancestor and N-i descendant objects for tx i: N^2 {txid, fee, weight} objects retained in cpfpData and Object.assign'ed onto the block transactions (block-processor.ts:175-181), a third quadratic allocation that outlives the function.

All of this runs synchronously on the single Node event loop inside `blocks.$updateBlocks` (live path) or the indexer. Under the shipped heap limits (`npm start` 2 GB, Docker default) the closure alone exhausts the heap -> fatal V8 abort, replayed on restart while the block is within the last INITIAL_BLOCKS_AMOUNT blocks (blocks.ts:1366-1374). On the 16 GB `start-production` heap the process stalls for the duration or, with the single-chunk variant, aborts as well.

Relation to the verified finding block-cpfp-mini-miner-quadratic-ancestor-maps-deep-in-block-chain: that record covers the legacy `calculateGoodBlockCpfp`/`makeBlockTemplate` sink, which runs first on the live path. This is a second, independent sink reached with the same block:
- On the live path it adds a second quadratic allocation (Sets holding both ancestors AND descendants per tx, plus the relatives arrays) after the mini-miner's, and it survives that finding's proposed fix (falling back to `calculateFastBlockCpfp`), because `detectTemplateAlgorithm` still calls `calculateClusterMempoolBlockCpfp` afterwards.
- On the indexing path (`$indexCPFP` -> `detectTemplateAlgorithm(..., fast=true)`, blocks.ts:2032) the legacy part is the linear `calculateFastBlockCpfp`, so this is the ONLY quadratic sink there; the mini-miner record states that path is unaffected, which does not hold once CLUSTER_MEMPOOL_INDEXING is on. `$generateCPFPDatabase` rethrows (blocks.ts:943) and `indexer.$run` retries every 10 s in the same process (indexer.ts:244-246), so one such block permanently wedges CPFP indexing and every indexer task queued after it on each instance with CPFP_INDEXING + CLUSTER_MEMPOOL_INDEXING (including historical reindexes over the whole chain with INDEXING_BLOCKS_AMOUNT -1), repeating the synchronous stall or heap abort every 10 s until the operator intervenes.

Conditions: CLUSTER_MEMPOOL_INDEXING true (default false; true in every production/mempool-config.*.json shipped for mempool.space; exposed as a Docker env var) and block height >= CM_ACTIVATION_HEIGHT for the network. Delivery requires a block producer (miner with relaxed template policy or a custom template builder, or on testnet3/testnet4 any CPU miner via the min-difficulty rule), the same position the verified mini-miner finding establishes; the chain may be zero-fee so it costs only block space, and every instance on that network with the flag set is hit by the same block.

## Evidence
1. [backend/src/api/cpfp.ts:183–239](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/cpfp.ts#L183-L239)
   calculateClusterMempoolBlockCpfp builds `new ClusterMempool(txMap, accelMap, false, 25000)` (line 196) over every transaction of a confirmed block with no component-size or depth cap, then for every txid calls cm.getCpfpDataForTx (202), retains its ancestors/descendants arrays in cpfpData (209-210) and, once per cluster, cm.getCluster (214), keeping the full clusterData in the returned clusters array (228). This is the function the fix must change (cap/fallback).
2. [backend/src/cluster-mempool/depgraph.ts:38–57](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/depgraph.ts#L38-L57)
   addDependency materialises the transitive closure: for every descendant of the child and every ancestor of the parent it inserts into both Sets (51-56). Each ClusterTx seeds ancestors/descendants with itself (18-19). For a chain T1->...->TN added in block order, step i performs i insertions (N^2/2 total) and the final state holds N*(N+1) live Set entries (tx i has i ancestors and N-i+1 descendants). Nothing bounds N on the block path.
3. [backend/src/cluster-mempool/cluster-mempool.ts:232–285](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/cluster-mempool.ts#L232-L285)
   createClusterFromTxids adds one ClusterTx per block tx (240-248), calls depgraph.addDependency for every in-block parent edge (250-263) and linearizeCluster with the 25000 budget (265). The constructor (52-60) -> buildFromMempool (148-154) runs this for every connected component found by dfsComponent (188-222), which follows parents and spentBy children, so an N-tx chain is one component.
4. [backend/src/cluster-mempool/cluster-mempool.ts:696–708](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/cluster-mempool.ts#L696-L708)
   findChunkInfo locates a tx by linear Array.includes over every chunk's txs array. Called once per block tx from getCpfpDataForTx (107), the cpfp.ts loop costs O(N * total chunk length) = O(N^2) whether the chain is one N-tx chunk (increasing feerates) or N singleton chunks (equal/zero feerates).
5. [backend/src/cluster-mempool/cluster-mempool.ts:102–122](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/cluster-mempool.ts#L102-L122)
   getCpfpDataForTx builds a Set of the chunk (112) and calls getChunkRelatives twice (119-120), which iterate the tx's full transitive ancestors/descendants Sets (334-352) and emit one {txid, fee, weight} object per chunk-mate. When the chain forms a single chunk (strictly increasing child feerates: chunkify at linearize.ts:13-30 merges a later chunk into the previous whenever its feerate is strictly higher, and minimizeChunks at 1105-1118 only splits by connectivity, which a chain never is), tx i receives i-1 ancestor and N-i descendant objects: N^2 objects total, retained in cpfpData and Object.assign'ed onto the block transactions (block-processor.ts:175-181).
6. [backend/src/api/block-processor.ts:201–259](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/block-processor.ts#L201-L259)
   detectTemplateAlgorithm calls calculateClusterMempoolBlockCpfp (234-238) whenever config.MEMPOOL.CLUSTER_MEMPOOL_INDEXING is true (217) and height >= CM_ACTIVATION_HEIGHT (227), on BOTH the live path (fast=false, after calculateGoodBlockCpfp) and the indexing path (fast=true, where the legacy part is the linear calculateFastBlockCpfp). There is no size guard, try/catch or fallback around the call.
7. [backend/src/api/block-processor.ts:38–44](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/block-processor.ts#L38-L44)
   CM_ACTIVATION_HEIGHT is hard-coded: mainnet 940000, testnet 4860000, testnet4 125000, signet 294000, regtest 0. The branch is live for every block at or above these heights; mainnet (block ~880,000 in early 2025 at ~144 blocks/day) is expected to be well past 940,000 at the date of this scan.
8. [backend/src/api/blocks.ts:1415–1458](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L1415-L1458)
   The main update loop fetches the verbose block (1427) and every transaction of it via $getTransactionsExtended (1430), then passes the whole list to blockProcessor.$processNewBlock (1442) -> detectTemplateAlgorithm synchronously on the single event loop, before the block is applied to the mempool or sent to clients. On restart currentBlockHeight resumes from the cached tail or tip - INITIAL_BLOCKS_AMOUNT (1366-1374), so a crashing block is replayed.
9. [backend/src/api/blocks.ts:2016–2046](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L2016-L2046)
   $indexCPFP fetches all block transactions (2019-2028) and calls detectTemplateAlgorithm(height, transactions, [], true) (2032); with CLUSTER_MEMPOOL_INDEXING on this runs the ClusterMempool constructor over each indexed block. Called from $generateCPFPDatabase (934), $indexBlockSummary (889) and reorg handling (1639).
10. [backend/src/api/blocks.ts:901–944](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L901-L944)
   $generateCPFPDatabase iterates every CPFP-unindexed height returned by $getCPFPUnindexedBlocks (all heights within INDEXING_BLOCKS_AMOUNT lacking a compact_cpfp_clusters row; -1 = whole chain in production configs) and rethrows on any error (943); the adversarial block is returned on every run until it is indexed, which never happens if its processing fails.
11. [backend/src/indexer.ts:229–246](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/indexer.ts#L229-L246)
   indexer.$run awaits blocks.$generateCPFPDatabase (230) in the same Node process as the API; on exception it schedules a retry (244-246, 10 s), so a block that fails here is re-attempted indefinitely and the indexer tasks after it (231-237) never run on that instance.
12. [backend/src/config.ts:210–211](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/config.ts#L210-L211)
   CLUSTER_MEMPOOL_INDEXING defaults to false, so the path is off for default self-hosted installs; docker/backend/start.sh:37 exposes it as MEMPOOL_CLUSTER_MEMPOOL_INDEXING (default false). No documentation attaches an operator obligation to enabling it.
13. [production/mempool-config.mainnet.json:20–23](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/mempool-config.mainnet.json#L20-L23)
   mempool.space's shipped mainnet config sets CPFP_INDEXING, CLUSTER_MEMPOOL and CLUSTER_MEMPOOL_INDEXING to true (testnet, testnet4, signet and regtest configs also set CLUSTER_MEMPOOL_INDEXING), so the block-side constructor runs on the project's own production fleet for every block, and the indexing path runs over the whole chain (INDEXING_BLOCKS_AMOUNT -1).
14. [backend/package.json:31–32](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/package.json#L31-L32)
   `npm start` runs node with --max-old-space-size=2048; `start-production` uses 16384; the Docker image (docker/backend/start.sh:325) uses the default V8 heap. A V8 heap-limit failure is a fatal abort that runMainUpdateLoop's try/catch (index.ts:308-326) cannot intercept; production/mempool-start-all restarts the backend in a `while true` loop.

## Impact
On 2 GB / default-heap deployments the N*(N+1) Set closure (and, in the single-chunk variant, N^2 retained relative objects) aborts the process on V8 heap exhaustion, which the main loop's try/catch cannot intercept; the block is reprocessed on each restart while it remains within INITIAL_BLOCKS_AMOUNT of the tip. On the 16 GB production heap the event loop stalls for minutes per block (and the single-chunk variant likely aborts as well). On the indexing path the same block wedges $generateCPFPDatabase in a 10-second retry loop indefinitely in the API process, halting CPFP indexing and the indexer tasks scheduled after it. Heap figures assume ~24-32 bytes per V8 Set entry and ~50-70 bytes per small object. No confidentiality or integrity impact.

## Reproduction steps
1. A block producer (miner using relaxed policy or a custom template builder; on testnet3/testnet4 any solo CPU miner) includes ~9,000-15,000 chained minimal transactions in one block, optionally with strictly increasing child feerates so the chain forms one chunk. Every backend with CLUSTER_MEMPOOL_INDEXING on (all mempool.space production configs) fetches the block from its own node and runs calculateClusterMempoolBlockCpfp over it, hitting the quadratic closure, linearization and per-tx lookup phases synchronously. No privileges on the victim and no user interaction; the attack requirement is the block-producer position, since an unmodified Core template would not assemble such a block.

## Recommended fix
1. DepGraph stores the full transitive ancestor and descendant sets of every transaction, so an N-deep in-block chain costs O(N^2) memory and time; the block path has no component-size or depth cap, unlike the mempool for which the structure was designed. Fix criteria: Building block CPFP data for a block consisting of a maximal chain (~15,000 txs) must complete with memory and time roughly linear in N, e.g. by skipping cluster-mempool CPFP (returning per-tx rates) when a component exceeds a size/depth threshold, or by not materialising transitive closures. Verify by feeding such a synthetic block through detectTemplateAlgorithm with CLUSTER_MEMPOOL_INDEXING on and confirming bounded heap growth and completion within seconds.
2. getCpfpDataForTx -> findChunkInfo performs a linear Array.includes across all chunks per transaction, and getChunkRelatives iterates full closure Sets, making the per-block loop in calculateClusterMempoolBlockCpfp O(N^2). Fix criteria: Chunk lookup for a transaction is O(1) (e.g. a tx -> chunk index map maintained with the chunks) and relatives are derived from chunk membership rather than full closure iteration, so the loop is O(N) in block size; verify that the loop's runtime grows linearly with N on a chained block.
3. A failing or over-budget cluster CPFP calculation propagates into $updateBlocks and into $generateCPFPDatabase, which rethrows into indexer.$run's 10-second retry loop, so one adversarial block halts block processing or indexing indefinitely. Fix criteria: Block processing and CPFP indexing must tolerate a failing or over-budget calculateClusterMempoolBlockCpfp by falling back to legacy/fast CPFP data for that block and continuing; after a restart or indexer retry the same block must not re-enter the failure. Verify that a thrown error or exceeded budget in calculateClusterMempoolBlockCpfp results in an indexed block with degraded CPFP data, not a stalled loop.

---
**Severity:** HIGH
**Status:** Open
**Category:** Algorithmic complexity
**CWE:** [CWE-407](https://cwe.mitre.org/data/definitions/407.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258347

---

# Cluster block assembly re-walks equal-feerate chunk prefixes, quadratic per poll in attacker-built cluster

## Details
With MEMPOOL.CLUSTER_MEMPOOL enabled, every mempool update runs `ClusterMempool.getBlocks(8)` -> `assembleBlocks` -> `fillBlock` synchronously in `$handleMempoolChange` (websocket-handler.ts:654-656, wired as the async mempool-changed callback at index.ts:370 and awaited from `$updateMempool` at mempool.ts:417-419 on the single event loop). The block builder pops chunks from a pairing heap and, each time it accepts a chunk, pushes the cluster's next chunk via `makeChunkHeapEntry` (block-builder.ts:133-135). `makeChunkHeapEntry` computes `equalFeeratePrefixWeight` by walking backwards from the new chunk over every preceding chunk whose feerate is exactly equal (`a.fee * b.weight === b.fee * a.weight`, lines 56-63), stopping at the first unequal chunk. For a cluster whose chunks all share one feerate the entry for chunk k costs k iterations; because `getBlocks` defaults to `enforceLimit=false` the eighth block has maxWeight/maxSigops = Infinity (lines 94-96) and the heap is drained, so every chunk is accepted exactly once per call and a cluster with K equal-feerate chunks costs K(K-1)/2 iterations on every poll.

K is attacker-controlled. `linearizeCluster` (linearize.ts:1200-1212) derives the final `chunks` by running `chunkify` over the linearization; `chunkify` (linearize.ts:13-34) merges a chunk into its predecessor only on a strictly higher feerate (`higherFeerate`, line 22), so transactions of identical feerate stay singleton chunks whatever the spanning-forest phase did; `minimizeChunks` (1105-1118) passes singletons through and `canonicalizeChunkOrder` (1214-1254) only reorders. Fees are integer satoshis (`Math.round(fees.base * 1e8)`, bitcoin-api.ts:424) and weights integer WU (`adjustedWeight`, cluster-mempool.ts:228-230), so the cross-multiplication equality is exact for identical transactions, or for any set whose fee is proportional to weight. An anonymous broadcaster who builds one connected component of N same-shape standard transactions (a 'ladder' A1,B1,A2,B2,... where each Bi spends one output of Ai and one of Ai+1 keeps every tx within Core's 25/25 ancestor/descendant policy while the component is unbounded; same script type, same input/output count, same fee; Schnorr or low-R ECDSA signatures make weights deterministic) gets a single cluster with N equal-feerate singleton chunks, i.e. N^2/2 `equalFeerate` iterations per poll for as long as the component sits in the mempool. mempool.space's production bitcoin.conf sets mempoolexpiry=999999 and maxmempool=4096, so the component persists until mined.

Magnitude (estimates for a tight V8 loop over an object array): N = 10,000 -> 5x10^7 iterations per 2-second poll (a steady partial tax of the main loop); N = 30,000 -> 4.5x10^8 (~1 s per poll); N = 50,000 (~0.05-0.1 BTC in fees at 1 sat/vB) -> 1.25x10^9 iterations, several seconds of synchronous CPU per 2-second poll, saturating the event loop so HTTP and WebSocket service degrades to multi-second latency for every user and mempool/block processing lags. The same walk runs again on every block connect (blocks.ts:546-548) and on every audit (block-processor.ts:121-124).

This is distinct from the verified finding cluster-mempool-unbudgeted-quadratic-relinearization-and-removal (linearize.ts/depgraph.ts): that cost is paid only in polls where the component is dirty, so the attacker must keep adding or removing members; this cost is paid in every poll with any mempool change at all (effectively every poll on mainnet) with no further attacker action once the component is in place, and only a component-size cap would address both. The ledger entry dismissed-block-builder-118-5ff8 judged fillBlock O(#chunks log #chunks) and did not consider the prefix walk at lines 56-63.

Conditions: CLUSTER_MEMPOOL true (default false in config.ts:210 and docker/backend/start.sh:36; true in every production/mempool-config.{mainnet,testnet,testnet4,signet,regtest}.json used by mempool.space) and an operator Bitcoin Core whose policy does not cap connected-component size (releases predating Core's cluster-mempool limits, or a raised -limitclustercount; a 64-tx cluster cap bounds K and makes the cost negligible). production/install pins BITCOIN_LATEST_RELEASE=v32.0, whose mempool policy cannot be verified from this checkout, and the backend documents no minimum Core version for CLUSTER_MEMPOOL.

## Evidence
1. [backend/src/cluster-mempool/block-builder.ts:43–73](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/block-builder.ts#L43-L73)
   makeChunkHeapEntry walks backwards from chunkIndex-1 to 0 summing the weight of every preceding chunk with exactly equal feerate (lines 56-63), stopping only at the first unequal one. For a cluster whose first K chunks all share a feerate the entry for chunk k costs k iterations.
2. [backend/src/cluster-mempool/block-builder.ts:106–151](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/block-builder.ts#L106-L151)
   fillBlock calls makeChunkHeapEntry(cluster, chunkIndex+1) every time a chunk is accepted into a block (133-135). Every chunk is accepted exactly once per assembleBlocks call, so the cluster above costs sum_{k<K} k = K^2/2 iterations per call.
3. [backend/src/cluster-mempool/block-builder.ts:85–104](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/block-builder.ts#L85-L104)
   assembleBlocks is called with enforceLimit=false by getBlocks; the last of the n blocks has maxWeight/maxSigops = Infinity (94-96), so the heap is fully drained and no chunk escapes the walk.
4. [backend/src/cluster-mempool/linearize.ts:13–34](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/linearize.ts#L13-L34)
   chunkify merges a chunk into its predecessor only when its feerate is strictly higher (higherFeerate, line 22), so transactions with identical fee and weight never merge: an N-tx component of identical txs yields N singleton chunks of equal feerate. minimizeChunks (1105-1118) passes singletons through and canonicalizeChunkOrder (1214-1254) only reorders, so cluster.chunks keeps N equal-feerate entries.
5. [backend/src/cluster-mempool/cluster-mempool.ts:70–72](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/cluster-mempool.ts#L70-L72)
   getBlocks runs assembleBlocks over every cluster with no size cap; the component itself is uncapped (no limit constant anywhere in cluster-mempool/).
6. [backend/src/api/websocket-handler.ts:654–656](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L654-L656)
   $handleMempoolChange calls mempool.clusterMempool.getBlocks(MEMPOOL_BLOCKS_AMOUNT) synchronously on every mempool update that has any change, independent of whether the attacker's cluster changed (relinearization is skipped for clean clusters, block assembly is not).
7. [backend/src/api/mempool.ts:417–421](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mempool.ts#L417-L421)
   The callback is awaited inside $updateMempool, which runMainUpdateLoop (index.ts:288-293) awaits on the single event loop that also serves Express and the WebSocket server; POLL_RATE_MS defaults to 2000 (config.ts:188).
8. [backend/src/api/blocks.ts:546–548](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L546-L548)
   The same getBlocks + processClusterMempoolBlocks runs on every block connect; block-processor.ts:121-130 runs it again for the audit.
9. [backend/src/config.ts:210](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/config.ts#L210)
   CLUSTER_MEMPOOL defaults to false; the path is active only when enabled.
10. [production/mempool-config.mainnet.json:22](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/mempool-config.mainnet.json#L22)
   mempool.space's shipped mainnet config (and the testnet/testnet4/signet/regtest configs) enable CLUSTER_MEMPOOL, so this code runs every poll on the project's own production deployment.

## Impact
The backend is a single Node process; at N in the tens of thousands the walk costs one to several seconds of synchronous CPU per 2-second poll for the lifetime of the component (unbounded under production mempoolexpiry=999999 until mined), stalling HTTP/WebSocket service for all users and delaying mempool and block processing; at N=10k it is a persistent but partial tax. No data is read or altered.

## Reproduction steps
1. An anonymous network participant broadcasts a policy-compliant ladder of N same-shape, same-fee transactions forming one connected component; the operator's Core accepts them and the backend's poll (mempool.ts:400) places them in one cluster of N equal-feerate singleton chunks. From then on every mempool poll performs N(N-1)/2 prefix-walk iterations inside getBlocks on the main loop with no further action by the attacker, until the transactions are mined (the attacker chooses the lowest relayable feerate to maximise residence time and can rebuild the component when it is mined). No privileges or user interaction; constructing exact-equal-feerate transactions is routine (integer fee and weight, deterministic signature sizes). Attack requirements are the deployment conditions: CLUSTER_MEMPOOL=true (non-default but set in all mempool.space production configs) and a Core whose policy does not cap cluster size at 64 (explicit assumption about the external node; the pinned v32.0's policy is unverified here), plus pre-funding of the component (~0.01-0.02 BTC per 10k txs at 1 sat/vB).

## Recommended fix
1. makeChunkHeapEntry recomputes the equal-feerate prefix weight by scanning backwards over all preceding equal-feerate chunks on every call, making block assembly quadratic in the length of an equal-feerate chunk run within one cluster. Fix criteria: Equal-feerate prefix weights are computed once per cluster linearization (e.g. a per-chunk running prefix stored alongside the chunks, or incrementally from the previous entry) so that building a heap entry is O(1) and assembleBlocks is O(total chunks * log) regardless of feerate equality. Verify that getBlocks over a 50k-tx cluster of identical transactions completes in time comparable to 50k singleton clusters.
2. Block assembly over the full cluster set runs synchronously on the request-serving event loop every poll with no bound on per-cluster chunk count. Fix criteria: Per-poll block assembly cost is bounded independent of any single component's size (cap the component size admitted to the cluster path or move assembly off the main thread), so no attacker-built component can monopolise the event loop between polls.

---
**Severity:** HIGH
**Status:** Open
**Category:** Algorithmic complexity
**CWE:** [CWE-407](https://cwe.mitre.org/data/definitions/407.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258346

---

# Push-tx weight limit enforced only after full bitcoinjs parse of 10 MB body

## Details
The transaction-submission routes (POST /api/v1/tx, /api/v1/tx/push, /api/v1/txs/test, /api/v1/txs/package) validate each submitted raw transaction in Common.validateTransactionHex (backend/src/api/common.ts:1182-1199). The function first fully deserialises the hex with bitcoinjs.Transaction.fromHex (line 1190) and only afterwards rejects transactions whose weight() exceeds MEMPOOL.MAX_PUSH_TX_SIZE_WEIGHT (line 1196). The callers getTransactionFromRequest / getTransactionsFromRequest (lines 1119-1163) accept any string matching /^((?:[a-fA-F0-9]{2})+)$/ with no length bound, so the only limit on the parsed input is the global 10mb body-parser limit (backend/src/index.ts:152-154); both shipped reverse-proxy configs permit the same (`client_max_body_size 10m`, http-basic.conf:36 and production/nginx/http-basic.conf:39).

Assumption (dependency not present in the checkout): bitcoinjs-lib ~6.1.3 (backend/package.json:47) deserialises witnesses in BufferReader.readVector, which loops `count` times calling readVarSlice -> readSlice -> buffer.slice(), producing one distinct Buffer (Uint8Array) object per witness item even when the item is empty. A body that is a segwit header, one input, zero outputs and a witness-item count of ~5,000,000 followed by that many 0x00 bytes (~9.5 MiB of hex, inside both limits) is therefore parsed into ~5 million heap objects (on the order of 80-100 bytes each) plus a 5M-slot array: roughly 400-500 MB of V8 heap and several seconds of synchronous work on the single event loop before weight() throws code -3 and the handler returns 400 (or, with a deliberately overlong count, before the reader runs off the end and throws). The work and allocation are complete by the time the request is rejected; while it runs, every REST and WebSocket client and the mempool polling loop are stalled, and the ensuing GC of millions of promoted objects adds further pauses. An arbitrary 10 MB hex blob (one large script) costs a single Buffer; the amplification is specific to this input shape and is roughly 50x the body size in heap.

A pre-parse serialised-size check alone is only a partial fix: weight >= serialised size, so it is sound, but Docker (docker/backend/start.sh:41) and the sample config set MAX_PUSH_TX_SIZE_WEIGHT to 4,000,000, which would still admit a 4 MB body with ~4 million empty witness items. Bounding the parse itself (item counts, or a body cap for these routes far below the global limit) is required as well.

Deployment notes: the Docker image starts the backend as plain `node /backend/package/index.js` (default V8 heap ceiling, typically 2-4 GB), `npm start` uses --max-old-space-size=2048. Whether repeated or back-to-back requests push the process past its heap ceiling depends on the host; the per-request stall does not. The earlier ledger dismissal at common.ts:1190 weighed only time complexity and the catch-to-400 path, not the per-byte object allocation ahead of the size check. All four routes are unauthenticated; tx/push and txs/package are registered for every backend type (bitcoin.routes.ts:52-71) and are reachable through the shipped Docker nginx (`/api/` -> backend `/api/v1/`) and production nginx (`/api/v1` -> backend).

## Evidence
1. [backend/src/api/common.ts:1182–1198](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/common.ts#L1182-L1198)
   validateTransactionHex calls bitcoinjs.Transaction.fromHex(txhex) on the whole attacker-supplied hex (Check 1, line 1190) and only afterwards compares tx.weight() against config.MEMPOOL.MAX_PUSH_TX_SIZE_WEIGHT (Check 2, line 1196). There is no bound on txhex length or on parsed item counts before the full deserialisation; this is the location the fix must change.
2. [backend/src/api/common.ts:1119–1137](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/common.ts#L1119-L1137)
   getTransactionFromRequest accepts any string body matching /^((?:[a-fA-F0-9]{2})+)$/ (or the txHash= form) with no length limit, lower-cases it and hands it to validateTransactionHex. Entry for POST /api/v1/tx and /api/v1/tx/push.
3. [backend/src/api/common.ts:1140–1162](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/common.ts#L1140-L1162)
   getTransactionsFromRequest bounds the array at 25 elements but not the length of each element; each is passed to validateTransactionHex, so POST /api/v1/txs/test and /api/v1/txs/package reach the same sink.
4. [backend/src/index.ts:152–154](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L152-L154)
   express.urlencoded, express.text (text/plain, application/base64) and express.json accept bodies up to 10mb, so one unauthenticated request delivers up to 10 MB of hex (5 MB of serialised transaction) to the parser.
5. [http-basic.conf:36](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/http-basic.conf#L36)
   The shipped Docker nginx config sets client_max_body_size 10m (production/nginx/http-basic.conf:39 likewise), so the reverse proxy does not reduce the body the backend will parse.
6. [backend/src/api/bitcoin/bitcoin.routes.ts:1198–1245](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L1198-L1245)
   $postTransaction, $postTransactionForm, $testTransactions and $submitPackage call the validators synchronously on the event loop; the catch converts the eventual throw into a 400 only after the allocation and parse work has happened.
7. [backend/src/api/bitcoin/bitcoin.routes.ts:52–70](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L52-L70)
   tx/push and txs/package are registered unconditionally for every backend type (tx and txs/test additionally when BACKEND !== 'esplora'), with no authentication.
8. [backend/src/config.ts:217](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/config.ts#L217)
   Default MAX_PUSH_TX_SIZE_WEIGHT is 400000; Docker start.sh:41 and the sample config set 4000000. Any serialised size above the weight limit is a guaranteed rejection, so the full parse of a 5 MB body is wasted work; with the 4,000,000 setting a size-only pre-check would still admit ~4 million witness items.

## Impact
Availability only. Each request blocks the single-threaded backend (all HTTP and WebSocket clients, mempool polling, block processing) for the seconds of allocation, parse and GC it causes and spikes heap by hundreds of MB, roughly 50x the body size; a modest sustained stream of such requests keeps the API unresponsive, and on memory-constrained hosts (default heap ceiling, large resident mempool) back-to-back requests can push V8 to a fatal out-of-memory abort that no handler intercepts. No data is read or modified.

## Reproduction steps
1. Any Internet client POSTs to /api/v1/tx/push (or /tx, /txs/test, /txs/package) through the shipped nginx with Content-Type text/plain and a ~9.5 MiB hex body: segwit marker/flag, one input, no outputs, witness count ~5,000,000, then that many '00' bytes. No credentials, user involvement or race. The regex and lower-casing pass; Transaction.fromHex allocates millions of Buffer objects synchronously before any size check on every default deployment (nginx 10m, body-parser 10mb, no pre-check). Repeating the request keeps the event loop saturated; a heap-ceiling crash is an additional, host-dependent outcome.

## Recommended fix
1. validateTransactionHex deserialises the entire submitted transaction before applying MAX_PUSH_TX_SIZE_WEIGHT, so the configured size bound does not limit the parse work or the memory a rejected submission can consume. Fix criteria: Any submission whose serialised byte length alone already exceeds MAX_PUSH_TX_SIZE_WEIGHT (weight is never less than serialised size) must be rejected with 400 before Transaction.fromHex is invoked, on all four routes and for every element of the txs/test and txs/package arrays. Verify that a 10 MB hex body is refused without entering the bitcoinjs parser.
2. The parser materialises one heap object per witness item, so even a submission within the configured weight limit (4,000,000 in the Docker and sample configs) can carry millions of empty witness items and the cost of parsing a rejected or accepted submission is bounded by the global 10 MB body limit rather than by anything proportional to a plausible transaction. Fix criteria: Heap and CPU spent on a submission must be bounded independently of the global body limit: enforce a per-route body cap sized to the configured weight limit and a hard cap on parsed element counts (inputs, outputs, witness items per input) that aborts parsing early. Verify that a maximal-size body composed of empty witness items is rejected with heap growth and event-loop time comparable to a legitimate transaction of the configured maximum weight.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncontrolled resource consumption
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258344

---

# Production esplora fallback list fetches and trusts chain data over plaintext HTTP across datacenters

## Details
All nine production backend configs (production/mempool-config.{mainnet,testnet,testnet4,signet,liquid,liquidtestnet,mainnet-lightning,testnet-lightning,signet-lightning}.json) set ESPLORA.FALLBACK to 58 plain 'http://node2xx.<site>.mempool.space:300x' URLs spanning the hnl, sv1, fra, tk7, va1, sg1 and es1 sites. backend/src/api/bitcoin/esplora-api.ts uses the strings verbatim: FailoverRouter's constructor (lines 66-94) turns each into a FailoverHost and enables multihost mode; because index.ts:126-128 starts health checks for the esplora backend, pollHosts (line 127) GETs host + '/blocks/tip/height' on every one of the 58 remote hosts every 60 seconds, and $query (line 421) sends host.host + path through an axios instance built on a plain http.Agent. Nothing authenticates or cross-validates the replies: esplora is treated as chain truth.

Two consequences follow for a party able to intercept or inject on the inter-site path (or to steer DNS/routing for a node2xx name toward itself, since no TLS binds the reply to a hostname). First, the plaintext health poll alone lets the attacker take over the backend's data source: pollHosts computes maxHeight as the maximum of every non-flagged host's reported height (line 132) and marks any host more than MAX_BEHIND_TIP (2 on Bitcoin, 8 on Liquid) behind that maximum outOfSync (lines 137-138); a single forged height in one fallback's reply therefore condemns the local unix-socket esplora and every honest fallback, and the check at lines 188-196 calls electHost(), whose sortHosts ranks non-outOfSync hosts first, so the attacker-controlled endpoint becomes activeHost and stays there for as long as the forgery is repeated each cycle. No outage and no client-triggered failover are needed (the verified finding esplora-failover-tripped-by-client-triggered-4xx is merely an alternative trigger). Second, once active, every esplora-backed request flows through the attacker: the full mempool is loaded from /internal/mempool/txs (mempool.ts:181 via esplora-api.ts:474-475), which feeds projected mempool blocks and fee recommendations served to all clients and WebSocket subscribers; bulk block transaction fetches (blocks.ts:158 $getTxsForBlock) and difficulty-adjustment and historical block indexing (blocks.ts:1385-1395, 1288-1289, 1594-1595) consume esplora block hashes and bodies and persist derived rows into MariaDB, so forged data outlives the interception; address and transaction lookups the backend performs for users travel in the clear. The newest-block hash and header come from Core RPC (blocks.ts:1426-1427), so that one loop is not forgeable, but its transaction contents for large blocks and all mempool state are.

The weakness is the shipped production configuration, not operator drift: production/** is the project's own deployment for mempool.space, the same hosts are reachable over TLS (production/check queries https://node2xx.<site>.mempool.space; esplora-api.ts:73 builds an https:// publicDomain for the git-hash probes), and the FailoverRouter would honour https:// URLs, yet the data path was left on cleartext port 300x. The recorded threat model places backend→electrs as a trusted boundary; these configs move 58 of those endpoints across the public Internet, which is where the model's boundary is contradicted. Condition under which the finding holds: inter-site traffic rides ordinary IP transit. The repository provisions no encrypted overlay (no WireGuard/IPsec/VPN anywhere under production/ or docker/; the install script's ELECTRS_*_HTTP_HOST=127.0.0.1 variables are defined but never used), and the URLs are public DNS names on raw TCP ports, so nothing in the checkout indicates otherwise.

## Evidence
1. [production/mempool-config.mainnet.json:45–106](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/mempool-config.mainnet.json#L45-L106)
   ESPLORA.FALLBACK lists 58 'http://node2xx.<site>.mempool.space:3000' URLs spanning hnl, sv1, fra, tk7, va1, sg1 and es1 - distinct cities on three continents - with no TLS. This is the artefact the fix must change.
2. [production/mempool-config.liquid.json:27–88](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/mempool-config.liquid.json#L27-L88)
   Same plaintext fallback pattern for Liquid (port 3001); testnet/testnet4/signet/liquidtestnet and the three lightning configs repeat it on ports 3002-3005, so every production network is affected.
3. [backend/src/api/bitcoin/esplora-api.ts:123–141](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/esplora-api.ts#L123-L141)
   pollHosts GETs host.host + '/blocks/tip/height' on every configured host each 60 s cycle over the configured (plaintext) scheme, computes maxHeight from all non-flagged hosts' answers, and marks any host more than MAX_BEHIND_TIP behind that maximum outOfSync; one forged height in one fallback's reply condemns the local socket host and every honest fallback.
4. [backend/src/api/bitcoin/esplora-api.ts:186–196](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/esplora-api.ts#L186-L196)
   After each host check, electHost() runs whenever activeHost is outOfSync; sortHosts ranks non-outOfSync hosts first, so the attacker-controlled endpoint becomes activeHost and remains there as long as the forged height is repeated each cycle.
5. [backend/src/api/bitcoin/esplora-api.ts:413–422](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/esplora-api.ts#L413-L422)
   $query concatenates host.host + path and sends it via requestConnection (axios with a plain http.Agent, line 55-57); no TLS, no response authentication, no cross-check against Core, so whatever answers on the path is accepted as chain truth.
6. [backend/src/api/bitcoin/esplora-api.ts:66–94](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/esplora-api.ts#L66-L94)
   FALLBACK strings become FailoverHost.host verbatim and multihost mode is enabled whenever the list is non-empty; the constructor also builds an https:// publicDomain for the same hosts (line 73), showing a TLS path exists for them.
7. [backend/src/api/mempool.ts:181](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mempool.ts#L181)
   $reloadMempool fetches the entire mempool from the active esplora host (/internal/mempool/txs); forged contents feed projected blocks and fee recommendations served to every client.
8. [backend/src/api/blocks.ts:1385–1395](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L1385-L1395)
   Difficulty-adjustment data is derived from bitcoinApi.$getBlockHash/$getBlock (esplora) with no comparison to Core; blocks.ts:1288-1289 and 158 likewise take historical block bodies and bulk block transactions from esplora and persist derived rows into MariaDB.
9. [backend/src/api/bitcoin/esplora-api.ts:430–443](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/esplora-api.ts#L430-L443)
   Failover to the fallback list is also triggered by non-404 request errors; the verified finding esplora-failover-tripped-by-client-triggered-4xx shows an anonymous client can force this, an alternative to the poller-based takeover.

## Impact
Integrity HIGH: once the attacker's endpoint is active, mempool contents, fee recommendations, projected blocks, bulk block transactions, difficulty-adjustment data and historically indexed blocks are whatever the attacker returns, served to all visitors and partly persisted into MariaDB. Confidentiality LOW: the address/txid lookups the backend performs and the fleet's node topology and software hashes are observable in cleartext, though no credentials traverse the link. Availability LOW: with the backend pinned to the attacker's endpoint, requests can be stalled or errored, degrading the instance until the forgery stops.

## Reproduction steps
1. An attacker positioned on the network path between two mempool.space sites (transit provider, IXP, compromised router) or able to steer DNS/routing for a node2xx name toward itself answers the backend's cleartext requests. The health poll to all 58 fallbacks runs every 60 s regardless of failover state, so the attacker need only forge one /blocks/tip/height reply with an inflated height to make pollHosts mark every other host outOfSync and electHost switch the backend to the attacker's endpoint; repeating the forgery each cycle keeps it pinned. No credentials or user interaction are required; the on-path (or DNS/route-steering) position is the single condition outside the attacker's control, captured as AT:P. Assumption stated in the description: inter-site links are ordinary IP transit with no encrypted overlay, which the repository does not contradict.

## Recommended fix
1. Fallback esplora endpoints in the production configs are plaintext http:// URLs to remote sites and the FailoverRouter performs no transport security or response authentication. Fix criteria: Inter-site esplora traffic must be authenticated and encrypted - https:// with certificate validation against the node2xx hostnames, or an authenticated overlay the install provisions - and the production configs must contain no plaintext cross-site URLs; verify that an injected cleartext response is no longer accepted by $query or pollHosts.
2. pollHosts lets a single host's self-reported tip height condemn the preferred local esplora and every other host, so one forged (or buggy) answer re-elects the active data source. Fix criteria: Host sync status must be judged against a trusted reference (Core RPC tip) rather than the maximum of peer-reported heights, and the preferred local socket host must not be deposed on the strength of a remote host's claim alone; verify that a fallback reporting an inflated height is itself flagged, not the local host.
3. Block hashes and bodies obtained from fallback hosts are indexed and served without cross-validation against the local Core node. Fix criteria: Block hashes/heights from fallbacks should be cross-checked against Core RPC before being served or persisted; verify that a fallback returning a wrong block hash for a height is rejected.

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
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258154

---

# Installer falls back to predictable /tmp file names as root, allowing symlink-based file clobbering

## Details
production/install is the root-run provisioning script for mempool.space-style FreeBSD/Debian hosts: on FreeBSD it executes `pkg install -y` (line 457), `zfs create` (536-650) and `chown` (1813, 1843) directly rather than via osSudo, under `set -e`, so the invoking shell is root. At lines 784-785 it obtains its two dialog scratch files with `input=\`tempfile\` || input=/tmp/input$$` and `output=\`tempfile\` || output=/tmp/test$$`. tempfile(1) is a Debian-only utility that FreeBSD base does not ship (FreeBSD has mktemp(1)) and that debianutils 5.x removed, so on the project's documented platform (production/README.md:25, FreeBSD) the fallback to a PID-derived name in world-writable /tmp is the normal path. Nothing creates the files exclusively: line 799 (`$CUT` is undefined, so zsh's NULLCMD `cat` writes the heredoc through a plain `>$input`), line 816 (`sed ... >$output`), line 817 (`cat $output >$input`) and line 823 (dialog `--file $input 2> $output`) all open the paths with O_CREAT|O_TRUNC and no O_EXCL, following whatever already exists there.

An unprivileged local account present while the operator starts the installer pre-creates /tmp/input<pid> and /tmp/test<pid> for the upcoming PID range (FreeBSD PIDs are sequential by default and bounded by PID_MAX 99999, so seeding the range is cheap). If /tmp/test<pid> is a symlink to a root-owned file, root's redirection at 816 or 823 truncates and overwrites it (e.g. /etc/master.passwd or /boot/loader.conf, breaking authentication or boot); the trap at 786 removes only the symlink. Because the sed at 816 rewrites each attacker-supplied line `a:b:c` as `"a" "b" "c"`, aiming $output at a shell startup file such as /etc/zshenv yields a root-executed command line. Making /tmp/input<pid> a FIFO removes any race: each of root's opens of $input blocks until the attacker opens the other end, so the attacker paces every step, feeds dialog and sed arbitrary content, and can retarget the $output symlink between 816 and 817 so that `cat $output >$input` copies an arbitrary root-readable file into the attacker's FIFO. The selections read back at 833-922 are likewise attacker-chosen, controlling which daemons and credentials get installed.

On Linux hosts with fs.protected_symlinks/protected_fifos/protected_regular enabled (the systemd/procps sysctl defaults on Debian and Ubuntu) the kernel refuses root's open and `set -e` merely aborts the install; FreeBSD has no equivalent, so the project's primary platform is the exposed one. The attacker must hold a local login during provisioning (e.g. a compromised service account on a host being re-provisioned), which bounds exposure but is not a control the project documents or enforces.

## Evidence
1. [production/install:784–786](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/install#L784-L786)
   Scratch-file names fall back to /tmp/input$$ and /tmp/test$$ whenever tempfile(1) fails. tempfile is a Debian-only utility: FreeBSD base ships only mktemp(1), and debianutils 5.x removed it, so on the documented FreeBSD platform (production/README.md:25) the PID-derived name in world-writable /tmp is the normal path. Nothing creates the files exclusively, and the trap at 786 only unlinks the paths, not a clobbered symlink target. This is the code the fix must change.
2. [production/install:799–814](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/install#L799-L814)
   The invoking shell writes the heredoc through a plain `>$input`; `$CUT` is never defined, so zsh's NULLCMD `cat` performs the write. The script must run as root (it runs `pkg install -y` at 457, `zfs create` at 536-650 and `chown` at 1813/1843 directly, under `set -e`), so this is a root open with O_CREAT|O_TRUNC and no O_EXCL that follows a pre-existing attacker symlink or opens a pre-existing attacker FIFO.
3. [production/install:816–823](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/install#L816-L823)
   Three more root opens of attacker-controllable paths: `sed ... >$output` (816) writes each input line as `"a" "b"`-quoted text, `cat $output >$input` (817) reads whatever $output resolves to and writes it to $input, and dialog writes its stderr to `$output` (823). A symlinked $output pointing at a root-owned file is truncated and overwritten (clobber, or a root-executed command line if the target is a shell startup file such as /etc/zshenv); a FIFO at $input makes each of root's opens block until the attacker responds, removing any race and letting the attacker retarget $output between 816 and 817 so that 817 copies an arbitrary root-readable file into the attacker's FIFO.
4. [production/install:833–921](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/install#L833-L921)
   Component selection is read back with grep from the same attacker-controllable $output path, so the attacker can also choose which daemons and credentials the installer provisions.

## Impact
Root truncates and overwrites any file the attacker's symlink names (authentication, boot and shell-startup configuration; sed-quoted attacker lines written to /etc/zshenv run as root on the next zsh start), which also denies service to the host. Line 817 `cat $output >$input`, executed by root, copies any root-readable file into the attacker's FIFO once $output is retargeted while that line's FIFO open blocks, so arbitrary root-readable files (e.g. /etc/master.passwd hashes) are also disclosed.

## Reproduction steps
1. Attacker: any unprivileged local account on the host at the moment the operator runs production/install as root. /tmp is world-writable and the scratch names depend only on the installer's PID, which on FreeBSD is sequential by default and at most 99999, so the attacker pre-creates symlinks/FIFOs for the upcoming PID range before the script starts; a FIFO at $input makes root's opens block until the attacker responds, so no timing race remains. The script ships no control: it never uses mktemp(1) or checks for a pre-existing path, and the Linux fs.protected_* sysctls that would turn this into an install abort do not exist on FreeBSD, the documented platform. AT:P because the installer must be running while the attacker holds a login, a provisioning-time window the attacker does not control.

## Recommended fix
The dialog scratch files are created at predictable, attacker-pre-creatable /tmp paths with non-exclusive, symlink-following '>' redirections while the script runs as root, with a PID-based fallback that is the normal path on FreeBSD because tempfile(1) does not exist there. Fix criteria: Create the scratch files atomically with mktemp(1) (present on both FreeBSD and Debian) inside a freshly created mode-0700 directory, with no predictable fallback, and abort if creation fails; a pre-existing symlink, FIFO or regular file at the former /tmp/input<pid> or /tmp/test<pid> path must have no effect on what the installer reads or writes.

---
**Severity:** HIGH
**Status:** Open
**Category:** Insecure temporary file
**CWE:** [CWE-377](https://cwe.mitre.org/data/definitions/377.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258153

---

# Installer leaves Bitcoin/Elements RPC and MariaDB credentials in world-readable files

## Details
The mempool.space production installer (production/install, run as root) generates random RPC and database credentials and then stores them in files every local account can read.

- /bitcoin/bitcoin.conf and /minfee/bitcoin.conf are installed with 'install -m 644' (lines 1181, 1184) and rpcuser/rpcpassword are substituted in with sed (1187-1190).
- /elements/elements.conf is installed 0644 (1300) and receives the Bitcoin mainchain RPC credentials plus the Elements RPC credentials (1303-1306). If Liquid testnet is enabled, a second 'sed -i.orig' pass (1611-1614) over the already-substituted file leaves elements.conf.orig as a complete 0644 copy of all RPC secrets; no .orig created by the installer is ever removed.
- /mempool/.mysql_credentials, a shell file exporting all nine MariaDB user/password pairs (each granted ALL on its database), is created by root with 'cat >' under the default umask and only chown'ed, never chmod'ed (1793-1813).
- production/mempool-build-all, which the installer symlinks as ~mempool/upgrade, cp's the backend template to /mempool/<site>/backend/mempool-config.json (0644 in a 0755 git checkout) and substitutes every RPC and DB secret into it (84-109).

The parent directories are ZFS mountpoints or 'mkdir -p' results (0755) that are only chown'ed; the production nginx (user www) serves 'root /mempool/public_html/...', so /mempool is necessarily world-traversable. The only chmod in the whole installer is the 750 applied to the CLN home (1409-1412), with the mempool user admitted via the cln group — showing the project does draw a cross-account boundary between its daemon users, but not for these credentials.

The host is deliberately multi-user: the installer creates bitcoin, minfee, elements, electrs, ckpool, cln and mempool accounts and the OS adds www/www-data (nginx workers terminating all Internet traffic), _tor/debian-tor, mysql and redis. Any of them can read the Bitcoin Core RPC password and all MariaDB passwords. The root cause is CWE-732: credential-bearing files are created with permissive modes and only ownership is ever adjusted. The script's own reliance on grepping bitcoin.conf as the mempool user (mempool-build-all:9-12) shows cross-account readability is baked into the deployment rather than accidental.

Assumptions: root's default umask is 022 on the supported FreeBSD and Debian targets (no umask is set by the script); BSD/GNU 'sed -i.orig' backups retain the original file's mode.

## Evidence
1. [production/install:1180–1190](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/install#L1180-L1190)
   bitcoin.conf (and the minfee bitcoin.conf) are installed by root with 'install -m 644' into /bitcoin and /minfee (mkdir -p / zfs mountpoint, 0755) and the generated rpcuser/rpcpassword are then sed'd in. Every local account can read them. 'sed -i.orig' also leaves a 0644 bitcoin.conf.orig that, after the second pass, contains the substituted rpcuser (password still a placeholder); no later step removes it.
2. [production/install:1792–1813](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/install#L1792-L1813)
   All nine MariaDB user/password pairs (each granted ALL on its database at lines 1762-1790) are written by root with 'cat >' under root's default umask to /mempool/.mysql_credentials; the only follow-up is chown to mempool:mempool. There is no chmod anywhere in the script except the CLN directories, so the file is 0644 in a 0755 home.
3. [production/install:1299–1306](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/install#L1299-L1306)
   elements.conf is installed 0644 and receives both the Bitcoin mainchain RPC credentials (mainchainrpcuser/password) and the Elements RPC credentials; its .orig backup after the fourth sed holds the Bitcoin user+password and the Elements user.
4. [production/install:1610–1614](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/install#L1610-L1614)
   When ELEMENTS_LIQUIDTESTNET_ENABLE is ON a second sed -i.orig pass runs over the already-substituted elements.conf, so elements.conf.orig becomes a fully populated 0644 copy of every RPC credential.
5. [production/mempool-build-all:79–109](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/mempool-build-all#L79-L109)
   generate_config, run as the mempool user, cp's the template (0644 under umask 022) to ~/<site>/backend/mempool-config.json inside a 0755 git checkout and substitutes every RPC and DB password into it (templates production/mempool-config.*.json carry the placeholders), producing a second world-readable copy of all secrets; only this script's own .orig is removed (line 109).
6. [production/mempool-build-all:8–12](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/mempool-build-all#L8-L12)
   The upgrade script, running as mempool, greps rpcuser/rpcpassword out of /bitcoin/bitcoin.conf and /elements/elements.conf: the deployment relies on cross-account readability and achieves it by leaving the files world-readable instead of a group grant.
7. [production/nginx/nginx.conf:73](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/nginx/nginx.conf#L73)
   nginx runs as __NGINX_USER__ (www / www-data, line 1) and serves 'root /mempool/public_html/mainnet/', so /mempool must be world-traversable for the site to work at all; the Internet-facing worker account can therefore open /mempool/.mysql_credentials and /mempool/<site>/backend/mempool-config.json.
8. [production/install:1403–1413](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/install#L1403-L1413)
   The project's own cross-account boundary: CLN secrets are protected with chmod 750 and the mempool user is granted access via the cln group. The same installer applies no such restriction to the Bitcoin/Elements RPC or MariaDB credentials, so other daemon accounts on the same host are not meant to read them yet can.
9. [production/bitcoin.conf:10–12](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/bitcoin.conf#L10-L12)
   server=1 with rpcallowip=127.0.0.1 and rpcbind on loopback: any local process holding the leaked rpcuser/rpcpassword can issue arbitrary RPCs (stop, invalidateblock, setban, setnetworkactive) to the production bitcoind.

## Impact
Confidentiality: every node RPC and database credential of the deployment is disclosed. Integrity: GRANT ALL on each mempool database lets the attacker rewrite blocks, pools, prices, lightning and statistics data the public site serves; bitcoind RPC (invalidateblock, setban, addnode, setnetworkactive) alters the node's chain view and peers. Availability: 'stop' over RPC or dropping tables halts the explorer.

## Reproduction steps
1. Attacker is any unprivileged local account on the production host other than the owning daemon — most plausibly the nginx www worker after a compromise of the Internet-facing nginx/SSR path, or _tor, redis, mysql, electrs, ckpool. They read /bitcoin/bitcoin.conf, /elements/elements.conf, /mempool/.mysql_credentials or /mempool/<site>/backend/mempool-config.json (all 0644 under 0755 directories; /mempool must be traversable for nginx to serve it). No race or special state. Credentials are immediately usable against loopback bitcoind RPC (rpcallowip=127.0.0.1, server=1) and the local MariaDB.

## Recommended fix
1. Credential-bearing configuration files (bitcoin.conf, minfee bitcoin.conf, elements.conf, .mysql_credentials, mempool-config.json) are created with permissive modes — 'install -m 644', cp/cat under the default umask — and only ownership is adjusted, so any local account can read them. Fix criteria: Each file must be readable only by its owning service account (0600, or 0640 with a dedicated group for sanctioned readers), and the installer must not leave .orig backups containing secrets. Verify from an unrelated local account (e.g. the nginx worker user) that none of these files, nor their backups, can be read.
2. mempool-build-all obtains bitcoind/elementsd RPC credentials by reading another daemon's configuration file as the mempool user, institutionalising cross-account readability of bitcoin.conf and elements.conf. Fix criteria: The mempool account should obtain its own RPC credentials (rpcauth entries, or a cookie file shared via a dedicated group with 0640 mode) rather than parsing bitcoind's config; verify the upgrade path still works with bitcoin.conf and elements.conf unreadable by the mempool user and all other non-owner accounts.

---
**Severity:** HIGH
**Status:** Open
**Category:** Incorrect permission assignment
**CWE:** [CWE-732](https://cwe.mitre.org/data/definitions/732.html)
**Attack vector:** LOCAL
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258152

---

# Root nginx loads its configuration from the unprivileged mempool user's writable git checkout

## Details
production/install (line 1819) creates the symlink /usr/local/etc/nginx/mempool -> /mempool/mempool, and the root-owned nginx.conf it installs (lines 21-36, 78, 112) includes every http- and server-level configuration file through that symlink. /mempool/mempool is a git checkout owned by the unprivileged 'mempool' service account (install lines 1040, 1047), which is also the account that runs all public Node backends (mempool-start-all) and that pulls GitHub master into that checkout (mempool-update-repo, mempool-build-all).

The nginx master process runs as root and parses/opens everything referenced by the configuration at every start and reload (reboot via nginx_enable=YES, 'service nginx restart' during routine operations). Because the included files are writable by the mempool user, that user can insert arbitrary http-context directives. Concretely, adding to http-basic.conf

  log_format p '$http_x_p';
  access_log /etc/crontab p;

makes the root master open /etc/crontab (O_APPEND|O_CREAT) at the next reload; a single HTTP request carrying header 'X-P: * * * * * root /tmp/x.sh' then appends a root cron line. The same works against /root/.ssh/authorized_keys or any other root-writable path, and 'root' / 'alias' / 'proxy_pass' directives can be repointed to serve arbitrary content or exfiltrate traffic. No signature or ownership check protects the included files, and the installer never makes them root-owned or read-only.

Result: a local compromise of the mempool account (the natural landing point of any RCE in the unauthenticated backend, or of a malicious npm dependency pulled in by mempool-build-all) escalates to root, and a compromise of the upstream GitHub master branch propagates to root on every production host at the next pull + nginx reload. The threat model records 'Internet -> nginx -> backend' as the trust chain; here the backend's account controls nginx itself.

## Evidence
1. [production/install:1819](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/install#L1819)
   The installer, running as root, symlinks ${NGINX_ETC_FOLDER}/mempool (/usr/local/etc/nginx or /etc/nginx, the root-owned nginx configuration directory) to ${MEMPOOL_HOME}/mempool, the git checkout owned by the unprivileged 'mempool' service account. The preceding line 1818 installs nginx.conf itself with -o root -g root -m 644, so the project intends nginx configuration to be root-owned, but every file that nginx.conf includes through this symlink is not.
2. [production/nginx/nginx.conf:21–36](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/nginx/nginx.conf#L21-L36)
   The root-owned top-level nginx.conf includes http-level configuration via relative paths 'mempool/production/nginx/*.conf', which nginx resolves against its prefix (/usr/local/etc/nginx), i.e. through the symlink into /mempool/mempool/production/nginx/. Lines 78 and 112 include the server-level files the same way.
3. [production/install:1039–1047](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/install#L1039-L1047)
   /mempool is chown -R'd to mempool:mempool and the repository is cloned as the mempool user, so every file nginx includes is owned and writable by the mempool account (no root ownership, no immutability).
4. [production/mempool-update-repo:1](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/mempool-update-repo#L1)
   This operator-run script (it is not scheduled in production/mempool.crontab) runs 'git pull origin master' as the mempool user into ~/mempool, rewriting the very files nginx includes; whoever controls the GitHub master branch therefore controls the root daemon's configuration on every fleet host after the next pull and nginx restart. This is a secondary route; the primary one is any process running as the mempool account.
5. [production/mempool-start-all:7–11](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/mempool-start-all#L7-L11)
   The same mempool account runs the Internet-facing Node backends ('npm run start-production'); any compromise of an unauthenticated backend process lands in the account that owns nginx's included configuration.
6. [production/README.md:279–285](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/README.md#L279-L285)
   The documented manual procedure prescribes the same symlink, so the issue is not an installer accident but the shipped deployment design.

## Impact
Arbitrary file append/overwrite as root and arbitrary nginx configuration yield full root compromise of the production host: all confidentiality (RPC/DB credentials, TLS keys, Tor HS keys), integrity (served site content, system files) and availability.

## Reproduction steps
1. Attacker holds the 'mempool' account - the natural landing point of RCE in the unauthenticated Internet-facing backends that mempool-start-all runs as that user, of a malicious npm lifecycle script executed by mempool-build-all's bare 'npm install', or of any other local foothold in that account - or controls the upstream master branch that the operator-run mempool-update-repo pulls into ~/mempool. They write arbitrary http-context directives into any file under /mempool/mempool/production/nginx/ (owned by mempool, install:1040/1047; no sudo or wheel membership is granted to the account, only -G cln at 1403). On the next nginx start or reload - which only root triggers: reboot (nginx_enable=YES at install:1863; production/mempool.crontab expects reboots), 'service nginx restart' (install:1912, README:289), or, assuming the python3-certbot-nginx / py-certbot-nginx plugin the installer selects at line 396 reloads nginx on renewal, periodic certificate renewal - the root master process parses the attacker's directives and opens, as root, any file named by access_log/error_log (e.g. /etc/crontab or /root/.ssh/authorized_keys); workers then append attacker-chosen request-header bytes through the inherited descriptor, giving root command execution with one HTTP request. The attacker cannot force the reload, so a root-driven restart is a precondition (AT:P); no user interaction is involved.

## Recommended fix
1. nginx (root) trusts configuration files owned and writable by an unprivileged service account because the installer symlinks the nginx config directory into the mempool user's git checkout. Fix criteria: Every file nginx includes must be owned by root and not writable by the mempool user (e.g. copied by root at deploy time into the nginx etc directory, or an immutable root-owned snapshot). Verify that writing to /mempool/mempool/production/nginx/*.conf as the mempool user has no effect on the next nginx reload.
2. The update scripts pull a moving remote branch directly into the tree nginx reads, so remote content reaches root's configuration without review. Fix criteria: Configuration promoted to nginx must go through an explicit root-controlled deploy step (reviewed, pinned revision), never automatically from 'git pull'. Verify that updating the checkout does not change what nginx loads until an operator explicitly installs it.

---
**Severity:** HIGH
**Status:** Open
**Category:** Privilege escalation
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258151

---

# Unquoted $TAG from PR package.json lets labeled PR push arbitrary Docker Hub tags including latest

## Details
docker.yml's `build` job publishes PR-built images to the official `mempool/*` Docker Hub namespace when a PR carries the `docker-push` label. The intended safety property is that such images only ever get a non-release tag `v<version>-<shortsha>` (line 309) and that `latest` is set only by the `tag-latest` job, which is gated to plain version tag pushes (line 364).

That property depends on `$TAG`, which for PRs is `jq -r '.version'` of the PR's own package.json (lines 305-308) with no validation. It is used unquoted in a bash `run:` step at line 354 (`--tag ${{ secrets.DOCKER_HUB_USER }}/${{ matrix.service }}:$TAG`) ahead of `--output type=registry,push=true` (line 357). Bash word-splits the value, so a version such as `3.4-dev --tag mempool/frontend:latest --label x=` yields the arguments `--tag mempool/frontend:v3.4-dev --tag mempool/frontend:latest --label x=-<sha>` and buildx pushes the attacker-built image as `latest` (or as any existing release tag). The namespace is public knowledge (docker/scripts/get_image_digest.sh:12). A second route avoids the matrix race entirely: line 310 writes `echo "TAG=${TAG}" >> $GITHUB_ENV` with no delimiter, so a version containing newlines appends further `NAME=value` or `NAME<<EOF` lines, letting the PR redefine TAG to exactly `latest` (or set any other environment variable) for every later step of the job.

The gating `test-images` job does not stop this: it only requires frontend and backend versions to be equal (lines 43-48); its own `--tag test-frontend:$TAG` (line 67) is also unquoted and `--load` builds locally, so extra words are tolerated; and the compose file it reads (line 92), the Dockerfiles (docker/frontend, docker/backend, copied by docker/init.sh) and docker/init.sh itself are all PR-controlled, so the health checks and any npm version validation are under the attacker's control. (`docker/docker-compose.yml` is gitignored by the root `.gitignore:3` and so absent from this checkout, though docker/README.md documents it as present; a PR can add or edit it either way.)

Who can exploit: on `pull_request` events GitHub does not supply repository secrets to runs from forks of a public repository, so `docker login` (lines 291-294) fails for fork PRs. The exploitable position is a same-repo PR author — a write-access collaborator of mempool/mempool (write includes triage, so the author can self-apply the `docker-push` label), or a compromised collaborator account. The label persists across `synchronize` pushes, so a label applied once by a maintainer to a benign PR also covers every later commit the author pushes. This is an escalation beyond what the label concedes (publishing a `v<version>-<sha>` test tag): it overwrites `latest` — what docker/README.md tells self-hosters to run — and release tags, and does so from within `build`, around the `tag-latest` gate, without creating a git tag, so it also bypasses any tag or branch protection ruleset the repository applies to `v*` tags (whether such rules exist is not visible in the repository; the gain over a sanctioned tag push holds wherever release authority is meant to be narrower than write access, and in any case the push leaves no git-visible release artefact).

Independently of the injection, `docker login` (line 291) precedes checkout (line 297) and the PR's own `docker/init.sh` runs afterwards on the runner (line 319), so the same PR author can read the runner's ~/.docker/config.json and exfiltrate the Docker Hub credential; remediation must address both.

## Evidence
1. [.github/workflows/docker.yml:347–359](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L347-L359)
   `--tag ${{ secrets.DOCKER_HUB_USER }}/${{ matrix.service }}:$TAG` (line 354) is unquoted in a bash `run:` step whose command ends with `--output type=registry,push=true` (357); word-splitting of $TAG injects additional `docker buildx build` arguments such as a second `--tag mempool/frontend:latest`, and buildx pushes every tag given.
2. [.github/workflows/docker.yml:299–311](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L299-L311)
   For pull_request events TAG is `v` + `jq -r '.version'` of the PR-controlled package.json + `-<sha>` with no character validation (305-309). Line 310 appends it to GITHUB_ENV with no heredoc delimiter, so a version containing newlines defines arbitrary further environment variables, including redefining TAG to exactly `latest` for all later steps.
3. [.github/workflows/docker.yml:223–229](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L223-L229)
   The build job runs for any pull_request carrying the `docker-push` label once test-images passes; the label persists, so every later `synchronize` push by the PR author re-runs the credentialed push without further maintainer action.
4. [.github/workflows/docker.yml:361–364](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L361-L364)
   `tag-latest` is the shipped control keeping PR builds off `latest`: it is gated to `github.event_name == 'push'` on plain version tags. The injection sets `latest` from inside `build`, around this gate.
5. [.github/workflows/docker.yml:38–50](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L38-L50)
   test-images only checks that frontend and backend package.json versions are equal; it does not constrain the version string. Its own `--tag test-frontend:$TAG` (67) is unquoted and `--load` builds locally, so extra words are tolerated, and the compose file it reads (92), the Dockerfiles and docker/init.sh are all PR-controlled, so the health gate passes under attacker control.
6. [.github/workflows/docker.yml:290–297](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L290-L297)
   `docker login` with DOCKER_USERNAME/DOCKER_PASSWORD precedes checkout, and the PR's own docker/init.sh (line 319) then executes on the runner with ~/.docker/config.json holding the Docker Hub credential — a second route for a labeled same-repo PR to reach the same outcome by exfiltrating the credential.

## Impact
The publishing pipeline's integrity guarantee (PR builds confined to non-release `v<version>-<sha>` tags; `latest` only via tag-latest on tag pushes) is fully broken: arbitrary tags in the official Docker Hub namespace, including `latest` and existing releases, are overwritten with attacker-built images without any git tag or release being created. GITHUB_ENV line injection additionally lets the PR set arbitrary environment for later steps of the job. Subsequent-system impact: Self-hosters following docker/README.md pull `mempool/frontend:latest` / `mempool/backend:latest` (Docker, Umbrel and similar updaters) and receive attacker-controlled images that run with their Bitcoin Core RPC credentials, electrum/esplora access and database credentials and serve their web UI.

## Reproduction steps
1. Attacker: a same-repo PR author — a write-access collaborator of mempool/mempool or a compromised collaborator account (fork PRs receive no repository secrets on `pull_request`, so `docker login` fails for them). Write access includes triage, so the attacker self-applies the `docker-push` label, or relies on one a maintainer applied earlier that persists across pushes. The PR's package.json version embeds extra buildx arguments (or a GITHUB_ENV redefinition of TAG), its Dockerfiles/compose/init.sh are shaped to pass test-images, and each push runs `docker buildx build ... --tag mempool/<svc>:latest --output type=registry,push=true` with the project's Docker Hub credentials over the network. No control must be defeated; the privilege level is the only gate, hence PR:H with no separate attack requirement.

## Recommended fix
1. A PR-controlled string (package.json version) is interpolated unquoted into a privileged `docker buildx build --push` command, allowing argument injection. Fix criteria: The image reference passed to buildx must be a single, validated argument: quote the variable and reject any version not matching a strict tag grammar (for example ^[0-9]+\.[0-9]+(\.[0-9]+)?(-[A-Za-z0-9.]+)?$) before use, and write GITHUB_ENV values with newline-safe delimiters. Verify that a version containing spaces, flag-like words or newlines fails the job rather than altering the push.
2. The docker-push label grants PR code execution while Docker Hub credentials are present, so even without injection a labeled PR can exfiltrate the push credential. Fix criteria: Build PR images without credentials and push only in a separate step/job that executes no PR-controlled scripts (or publish PR builds to a scratch namespace with a scoped token). Verify no PR-controlled file executes between `docker login` and the push.

---
**Severity:** HIGH
**Status:** Open
**Category:** Argument injection
**CWE:** [CWE-88](https://cwe.mitre.org/data/definitions/88.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** HIGH
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258147

---

# Block CPFP mini-miner materialises quadratic ancestor maps on deep in-block chains, stalling or crashing backend

## Details
Every new block is passed through the mini-miner (`blocks.$updateBlocks` -> `blockProcessor.$processNewBlock` -> `detectTemplateAlgorithm(fast=false)` -> `calculateGoodBlockCpfp` -> `makeBlockTemplate(transactions, accelerations, 1, Infinity, Infinity)`) to recover CPFP clusters and effective fee rates for the block summary. The mini-miner was written for mempool packages and, per its own comment (mini-miner.ts:417), relies on Bitcoin Core's 25-ancestor mempool policy to keep relative graphs small; the mempool-side helpers in the same file carry an explicit MAX_RELATIVE_GRAPH_SIZE=100 cap (lines 132, 170) that `setRelatives`/`makeBlockTemplate` do not. That assumption does not hold for the block path: Bitcoin consensus imposes no limit on how deep a dependency chain inside a single block may be, and `$getTransactionsExtended` (blocks.ts:96-207) fetches every transaction of the block and throws if any is missing, so the whole block reaches the mini-miner.

A block producer (a miner, or anyone who gets a non-standard template mined, e.g. through out-of-band submission services run by pools; on testnet3/testnet4 any CPU miner can produce a min-difficulty block after 20 minutes) can fill a block with a chain of N minimal transactions each spending the previous one. With ~64-byte P2A->P2A transactions (weight ~256) a 4,000,000 WU block holds N ~ 15,000 such transactions; with ordinary ~110 vB P2WPKH spends N ~ 9,000. The transactions may be zero-fee, so the block costs the miner nothing beyond its block space.

In block order (parents first, as consensus requires) `setRelatives` does not recurse deeply, but it copies the parent's full ancestorMap into each child, so the chain produces N^2/2 (~1.1x10^8 for N=15,000; ~4x10^7 for N=9,000) live Map entries and as many Map.set operations before selection even begins. Assuming V8's ordered hash map costs on the order of 24-40 bytes per entry (Node.js release builds without pointer compression; the manifest does not pin a Node version), that is several GB of heap. If the allocation succeeds, the selection loop in `makeBlockTemplate` performs, for each of the N transactions marked used, an O(N) descendant walk followed by a full re-sort of the `modified` array (`modified = updateDescendants(...)` returning `modified.sort(priorityComparator)`), i.e. O(N^2 log N) comparisons, and `calculateGoodBlockCpfp` (cpfp.ts:134-161) then builds per-member ancestors/descendants arrays over the whole N-member cluster, a second O(N^2) allocation that is Object.assign'ed onto the block transactions and survives the function. All of this runs synchronously on the single event loop inside `blocks.$updateBlocks`, so the backend serves nothing (HTTP, WebSocket, mempool polling) for the duration.

Under the shipped heap limits (`npm start`: 2048 MB; Docker: default V8 heap) the quadratic ancestor maps exhaust the heap and Node aborts with a fatal error, which the main loop's try/catch cannot intercept. On restart `blocks.$updateBlocks` resumes from the disk-cached blocks tail or from tip - INITIAL_BLOCKS_AMOUNT (blocks.ts:1365-1376, default 8), so the same block is processed again and the process crashes again; mempool.space's own `production/mempool-start-all` restarts the backend in a `while true` loop. The loop persists until the block is more than 8 blocks deep (~80 minutes on mainnet) or the operator wipes the cache. On the 16 GB `start-production` heap the process may survive but stalls for minutes per such block. The same code path is also exercised by the historical re-classification tasks (blocks.ts:1052, 1090), so such a block would also break reindexing for every instance that reaches it.

Reachability condition: the attacker must get a block containing a chain of roughly 10,000 dependent transactions mined. An unmodified Bitcoin Core node will not assemble such a template (ancestor/cluster limits), so on mainnet this requires a miner using relaxed policy or a custom template builder, at the cost of one block's worth of space; on testnet3/testnet4 an attacker can mine it alone. This is adversary class 2 of the threat model (data on chain) in its strongest position. Because block transactions are consumed by every mempool instance, one such block affects every deployment of this software on that network simultaneously.

The sibling `calculateFastBlockCpfp` (used for the `fast=true` reindex path) is linear and unaffected; the live path never falls back to it.

## Evidence
1. [backend/src/api/mini-miner.ts:416–446](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mini-miner.ts#L416-L446)
   setRelatives() copies the parent's entire ancestorMap into every child (parentTx.ancestorMap.forEach -> tx.ancestorMap.set, lines 431-433). For a chain of N dependent transactions in one block, tx_i holds i-1 entries, so N*N/2 Map entries are built and are all live simultaneously when the selection phase starts. The comment at line 417 names the only assumed bound, 'depth < 25 by mempool policy'; that is a Bitcoin Core mempool policy limit, not a consensus rule, and does not apply to transactions already mined in a block. No MAX_RELATIVE_GRAPH_SIZE-style cap (used by the mempool path at lines 132 and 170) exists here.
2. [backend/src/api/mini-miner.ts:273–413](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mini-miner.ts#L273-L413)
   makeBlockTemplate() builds one MinerTransaction per candidate (277-306), calls setRelatives on each (320-324), then runs greedy package selection. For every transaction marked used it calls updateDescendants() and replaces `modified` with the fully re-sorted list (388). With maxBlocks=1, weightLimit=Infinity and sigopLimit=Infinity (as passed by calculateGoodBlockCpfp) the fit check at 360 always passes, `failures` never increments and nothing short-circuits: selection on an N-deep chain costs O(N^2 log N).
3. [backend/src/api/mini-miner.ts:450–493](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mini-miner.ts#L450-L493)
   updateDescendants() walks every descendant of the used root that still holds it in ancestorMap (O(N) for a chain, since every later member of the chain holds every earlier one) and then sorts the whole `modified` array (493) on each call.
4. [backend/src/api/cpfp.ts:114–161](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/cpfp.ts#L114-L161)
   calculateGoodBlockCpfp() passes every transaction of a mined block to makeBlockTemplate(transactions, accelerations, 1, Infinity, Infinity) (121). It then, for each cluster and for each of its k members, iterates the whole cluster (141-156) building a fresh `ancestors` and `descendants` array of {txid, fee, weight} objects per member: a second quadratic sink, k^2 relative objects that are then Object.assign'ed onto the block transactions (160) and so stay live past the function.
5. [backend/src/api/block-processor.ts:201–215](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/block-processor.ts#L201-L215)
   detectTemplateAlgorithm() with fast=false (the default, used by the live new-block path) always calls calculateGoodBlockCpfp() over the full block transaction list before anything else; the linear calculateFastBlockCpfp is used only when fast=true ($indexCPFP, blocks.ts:2032). No fallback or budget switches the live path to the fast variant.
6. [backend/src/api/block-processor.ts:49–63](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/block-processor.ts#L49-L63)
   $processNewBlock() calls detectTemplateAlgorithm() synchronously as the first step of block processing, with the complete transaction list of the block.
7. [backend/src/api/blocks.ts:1415–1447](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L1415-L1447)
   The main update loop ($updateBlocks, called from index.ts runMainUpdateLoop) fetches the verbose block from the operator's node, builds `transactions` for every txid in it, and calls blockProcessor.$processNewBlock(block, transactions, ...). This runs on the single Node.js event loop; while it runs no HTTP route, WebSocket message or mempool poll is served.
8. [backend/src/api/blocks.ts:96–206](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L96-L206)
   $getTransactionsExtended() copies in-mempool txs, bulk-fetches or individually fetches every remaining txid, throws if any is missing (199-203) and returns all of them in block order (206). There is no cap on the number of transactions or on chain structure, so a 15,000-tx chained block reaches the mini-miner whole.
9. [backend/src/api/blocks.ts:1365–1375](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L1365-L1375)
   On (re)start, currentBlockHeight resumes from the disk-cached blocks tail (which does not contain the block whose processing crashed) or from tip - INITIAL_BLOCKS_AMOUNT (default 8, config.ts:194), so the same adversarial block is processed again on every restart until it is more than 8 blocks deep or the operator wipes the cache.
10. [backend/package.json:31–32](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/package.json#L31-L32)
   `npm start` (the README's documented start command) runs node with --max-old-space-size=2048; `start-production` uses 16384. The Docker image (docker/backend/start.sh:325) runs `node /backend/package/index.js` with the default V8 heap. A V8 heap-limit failure is a fatal abort, not a catchable exception, so the main loop's try/catch (index.ts:308-326) cannot recover it.
11. [production/mempool-start-all:11](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/mempool-start-all#L11)
   The mempool.space fleet runs the backend in `while true; do npm run start-production; sleep 1; done`, so after a heap-exhaustion abort the process restarts immediately and, per blocks.ts:1365-1376, re-enters the same block.

## Impact
The event loop is blocked for minutes per such block on large-heap deployments; on the shipped 2 GB (`npm start`) and default-heap (Docker) deployments the process aborts on V8 heap exhaustion, which the main loop's try/catch cannot intercept, and re-crashes on every restart while the block remains within the last INITIAL_BLOCKS_AMOUNT (8) blocks. All API and WebSocket service is lost for the duration, for every instance on the affected network. Heap figures rest on an assumption about V8 Map entry size (~24-40 bytes/entry) stated in the description. No confidentiality or integrity impact.

## Reproduction steps
1. Attacker is a block producer: a miner, someone who pays a pool with relaxed policy to mine their template, or on testnet3/testnet4 any CPU miner using the min-difficulty rule. They construct ~10,000-15,000 chained minimal transactions (each spending the previous output) and include them in one block. Every mempool backend fetches the block from its own node and runs calculateGoodBlockCpfp over all its transactions, hitting the quadratic path. No privileges on the victim, no user interaction; the only requirement is the block-producer position, which standard Core template policy otherwise prevents on mainnet, so AT is PRESENT.

## Recommended fix
1. setRelatives materialises the complete ancestor set of every transaction as a Map copied from its parent, giving O(N^2) memory and time on an N-deep chain; the block path has no policy-imposed depth limit, unlike the mempool path the code was written for. Fix criteria: Processing a block consisting of a maximal chain of dependent transactions (~15,000 txs) must complete with memory and time bounded roughly linearly in the number of transactions (or the block CPFP calculation must fall back to the linear calculateFastBlockCpfp / skip cluster reconstruction once a depth or ancestor-count threshold is exceeded). Verify by feeding such a synthetic block through detectTemplateAlgorithm and confirming bounded heap growth and completion within seconds.
2. makeBlockTemplate re-sorts the entire `modified` list on every updateDescendants call and walks all descendants per used transaction, giving O(N^2 log N) selection cost on deep chains. Fix criteria: The selection phase must not re-sort the full modified set per used transaction (e.g. a priority heap with decrease/increase-key as in tx-selection-worker.ts) and total selection work must be bounded for an N-deep chain. Verify with the same synthetic block that selection time grows near-linearly with N.
3. A failure or runaway cost inside the block CPFP calculation propagates into the main block-processing loop, so a single adversarial block can abort block processing or crash the process, and a crash is replayed on restart. Fix criteria: Block processing must survive a failing or over-budget CPFP calculation (degrade to per-transaction fee rates without clusters) and continue with subsequent blocks; after a restart the backend must not re-enter a crash loop on the same block. Verify that a thrown error or exceeded budget in calculateGoodBlockCpfp results in a processed block with degraded CPFP data rather than an aborted loop or process exit.

---
**Severity:** HIGH
**Status:** Open
**Category:** Resource exhaustion
**CWE:** [CWE-407](https://cwe.mitre.org/data/definitions/407.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258145

---

# Release image build imports local BuildKit cache from /tmp writable by any PR job on shared runner

## Details
docker.yml's `build` job, which publishes release images on `v*` tag pushes (and whose output `tag-latest` promotes to `latest`), runs `docker buildx build --cache-from type=local,src=/tmp/.buildx-cache --cache-to type=local,dest=/tmp/.buildx-cache,mode=max ... --output type=registry,push=true` on the self-hosted runner `mempool-ci` (docker.yml:347-360). BuildKit's local cache is an OCI layout whose cache-config manifest maps step cache keys to layer blobs; on import BuildKit verifies blob digests against that manifest but cannot verify that a blob is the genuine output of the step, so whoever writes the directory decides which layer the release build reuses for any step whose key matches (stated assumption about moby/buildkit as installed by docker/setup-buildx-action v4.3.0).

The directory lives on the runner host's /tmp. Every pull request already executes attacker-chosen code on that runner as the runner user with no label gate: docker.yml's `test-images` job runs the PR's own `docker/init.sh` (lines 13-14, 58-59), and ci.yml runs the PR's `meta/scripts/check-install-scripts.sh` and `npm ci` preinstall (ci.yml:74-83). The buildx CLI writes the type=local export on the host as that same user, so the PR job owns the directory outright; passwordless sudo (ci.yml:466, docker.yml:246-268) is available but not needed. The actions/cache step (docker.yml:338-346) cannot repair it: docker.yml has no branch-push trigger, so the default-branch scope never holds a `buildx-*` entry and tag-push restores always miss, leaving whatever is on disk (a hit would only untar over the directory anyway; actions/cache v6.1.0 behaviour, stated assumption). The job does mount a fresh tmpfs over /var/lib/docker and restart the daemon (docker.yml:260-270) but never touches /tmp/.buildx-cache, and no workflow prunes it.

Poisoning is deterministic for docker/backend/Dockerfile. The runtime stage's first RUN (lines 29-34) has no ARG, ENV or COPY before it, so its cache key depends only on the `rust:1.84-bookworm` manifest digest and the literal command, which the attacker reproduces by building the same Dockerfile locally with `--cache-to type=local,mode=max`; that layer contains /usr/bin/node and ships verbatim in `mempool/backend:<version>` and `latest`. Replacing its blob (a modified node binary, an added /etc/ld.so.preload) and rewriting the digests in the cache manifest yields a directory the next tag build consumes silently. The builder stage's first RUN (lines 8-13) is also poisonable: its key additionally includes `MEMPOOL_COMMIT_HASH=<SHORT_SHA>` (lines 3-4), predictable once the release commit lands on master and before the tag is pushed; a trojaned toolchain there taints /build/package, copied into the runtime image at lines 39-41. Later steps become predictable the same way once the release tree is public.

This is distinct from the verified record ci-untrusted-pr-code-root-on-shared-self-hosted-runner (root on the shared runner capturing Docker Hub credentials): this path needs only a runner-user write to /tmp, survives the job's explicit fresh-daemon hardening, and is closed by a different fix (no local layer cache on a runner that runs PR jobs). Condition under which it holds: the `mempool-ci` runner's filesystem persists between jobs. The repository contains no ephemeral-runner provisioning; `sudo swapoff /mnt/swapfile || true` and the tmpfs-over-/var/lib/docker step are written for a machine carrying state from earlier runs. If each job ran on a single-use VM the directory would be empty on every tag build and this finding would not apply.

## Evidence
1. [.github/workflows/docker.yml:347–359](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L347-L359)
   The tag-push `build` job pushes to Docker Hub (`--output type=registry,push=true`) while importing `--cache-from type=local,src=/tmp/.buildx-cache`. BuildKit's local cache importer (moby/buildkit as installed by docker/setup-buildx-action v4.3.0, buildx-stable-1; stated assumption) verifies each blob against its digest but takes the cache manifest's mapping of step cache keys to layer blobs on trust, so whoever writes the directory chooses the layer BuildKit substitutes for any matching step.
2. [.github/workflows/docker.yml:338–345](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L338-L345)
   actions/cache v6.1.0 keyed `${runner.os}-buildx-<service>-${github.sha}` with a prefix restore key. The workflow has no branch-push trigger (lines 8-14), so no `buildx-*` entry ever exists in the default-branch scope and a tag ref sees only its own and the default branch's caches: tag builds always miss, and on a miss the action leaves /tmp/.buildx-cache exactly as found on disk (on a hit it would only untar over the directory, leaving planted blobs in place).
3. [.github/workflows/docker.yml:58–59](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L58-L59)
   `test-images` runs on every pull_request (opened/synchronize/reopened/labeled, lines 13-14) on `mempool-ci` with no label gate and executes `docker/init.sh` straight from the PR checkout: arbitrary attacker-authored shell as the runner user. With the docker-container driver the buildx CLI writes the type=local cache export on the host as that same user, so the PR job can rewrite /tmp/.buildx-cache without any privilege escalation.
4. [.github/workflows/ci.yml:74–82](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/ci.yml#L74-L82)
   Second PR-code execution path on the same runner: `bash meta/scripts/check-install-scripts.sh && npm ci` runs the PR's script and its root `preinstall`; `sudo apt-get install jq -y` at ci.yml:466 shows passwordless sudo is available should ownership of the directory ever differ.
5. [docker/backend/Dockerfile:27–34](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/docker/backend/Dockerfile#L27-L34)
   Primary poisoning target. The runtime stage's first RUN (apt-get + NodeSource curl|bash + nodejs) has no ARG/ENV/COPY before it, so its cache key depends only on the `rust:1.84-bookworm` manifest digest and the literal command text, both of which the attacker reproduces by running the same build locally with `--cache-to type=local,mode=max`. This layer, which contains /usr/bin/node, ships verbatim in the published `mempool/backend` image and is what executes start.sh (line 47).
6. [docker/backend/Dockerfile:1–13](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/docker/backend/Dockerfile#L1-L13)
   Secondary target. The builder stage's first RUN also precedes any COPY, but `ENV MEMPOOL_COMMIT_HASH=${commitHash}` (lines 3-4) puts SHORT_SHA into its cache key; that becomes predictable once the release commit is public, before the tag is pushed. A trojaned toolchain here would taint /build/package, which lines 39-41 copy into the runtime image.
7. [.github/workflows/docker.yml:260–269](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/.github/workflows/docker.yml#L260-L269)
   The job mounts a fresh tmpfs over /var/lib/docker and restarts the daemon, so builder state is clean, but /tmp/.buildx-cache is never removed by this or any other workflow (no `rm -rf /tmp/.buildx-cache`, `buildx prune` or `system prune` under .github/): the local cache is the one persistent, untrusted input the release build still consumes.

## Impact
Integrity of the release build is fully lost: arbitrary layer content enters the signed-off release images without any maintainer-visible change. No confidentiality or availability impact on the CI system itself. Subsequent-system impact: Poisoned `mempool/backend` images (versioned and `latest`) are pulled by Docker/Umbrel self-hosters and run with their Bitcoin Core RPC and MariaDB credentials; the trojaned layer executes with full control of those containers.

## Reproduction steps
1. Attacker: any PR author whose workflows run (automatic after one merged commit, or after a maintainer approves a first-time contributor's run; threat-model adversary 6). Steps: build docker/backend/Dockerfile locally with `--cache-to type=local,mode=max`; replace the runtime-stage apt/node layer blob with a trojaned one and fix up the manifest digests (optionally plant entries for several recent `rust:1.84-bookworm` digests); open or update a PR whose docker/init.sh or npm preinstall writes that directory to /tmp/.buildx-cache on mempool-ci. Wait for the next `v*` tag push: the release build imports the cache, reuses the poisoned layer and pushes it to Docker Hub. AT:PRESENT for the persistent-runner condition and the one-merged-commit/approval gate on PR workflow runs; no secret, credential or maintainer interaction with the attacker's content is required.

## Recommended fix
1. The release (tag-push) build consumes a BuildKit layer cache from a host path (/tmp/.buildx-cache) that untrusted PR jobs on the same runner can write, and BuildKit trusts the cache manifest's step-to-layer mapping without any provenance check. Fix criteria: Release builds must use no cache that an untrusted job can write: drop the local cache on shared runners (`--no-cache`, or a registry cache under a tag only the release job can push, or `type=gha` scoped to the tag ref), and never import a type=local cache from a path that outlives the job. Verify that a /tmp/.buildx-cache planted by a PR job has no effect on the next tag build (layer digests identical to a `--no-cache` build).
2. Labeled `docker-push` PR builds and tag builds share one `--cache-to` destination, so even sanctioned PR-driven builds seed layers that later release builds reuse. Fix criteria: Separate cache destinations for PR-driven and release builds, or disable `--cache-to` for pull_request events. Verify that a build triggered by a pull_request event cannot write to any cache location a push-triggered build reads.

---
**Severity:** HIGH
**Status:** Open
**Category:** Build cache poisoning
**CWE:** [CWE-829](https://cwe.mitre.org/data/definitions/829.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** HIGH
**Subsequent system availability impact:** HIGH
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258142

---

# Stored pools_json_sha interpolated into ALTER TABLE blocks DDL during schema migration

## Details
Schema steps 95 and 97 of the startup migration (backend/src/api/database-migration.ts:1125-1134, 1142-1150) read `state.string` for `pools_json_sha` and interpolate it, unvalidated and unescaped, into two ALTER TABLE statements on `blocks` (`... DEFAULT "${poolJsonSha}"`). `$executeQuery` (1317-1322) passes the composed string to `DB.query({sql, timeout})` with no parameter array, so mysql2 sends it verbatim. A double quote in the stored value closes the DEFAULT literal and everything after it is parsed as further ALTER TABLE clauses on `blocks` (DROP COLUMN, DROP PRIMARY KEY, RENAME TO, MODIFY ...), with `#` or `-- ` swallowing the trailing quote. The payload is bounded by `state.string` varchar(100) (1348-1356), ample for e.g. `x", DROP COLUMN hash, DROP COLUMN height #`.

Who controls the value: the stored sha is whatever `tree[].sha` the HTTP provider behind MEMPOOL.POOLS_JSON_TREE_URL (api.github.com by default; any mirror/forge the operator configured; a second-order adversary in the threat model) returned for `pools-v2.json`. pools-updater.ts:173-186 does not check it is 40 hex characters and updateDBSha (143-154) stores it as-is. This is a distinct defect from the recorded finding pools-updater-github-sha-sql-injection (the INSERT at pools-updater.ts:148): a value containing only double quotes passes through that single-quoted INSERT unchanged, and would pass through a parameterised INSERT unchanged as well, so parameterising line 148 alone does not remove this path. The root cause here is that the migration module trusts `state.string` as DDL text.

Reachability - the DDL runs only while the database is below schema version 95 (step 95) or 97 (step 97) at a backend start, which `$initializeOrMigrateDatabase` performs unconditionally whenever DATABASE.ENABLED (index.ts:130-142; Docker default true). Two routes:
1. Legacy upgrade (independent of the recorded INSERT injection): a Bitcoin-network instance whose database is at schema version 75-94 and whose updater stored a hostile sha, upgraded to a current backend. The window starts at 75 because step 75 (line 661) NULLs `pools_json_sha` on Bitcoin networks and nothing re-populates it before step 95 (the updater runs only after migration completes); below 75 the stored value is discarded, and on non-Bitcoin networks the updater never writes the row (pools-updater.ts:39-44), so the hardcoded default is used. Assumption: the updater in those earlier releases stored the fetched sha unvalidated as this tree does (unverifiable in this single-commit checkout).
2. Fully current instance (chained): the provider uses the recorded INSERT injection at pools-updater.ts:148 to write, in one statement, the DDL payload into `pools_json_sha` and `schema_version = 96` via multi-row VALUES + ON DUPLICATE KEY UPDATE; the next restart runs step 97 as `ALTER TABLE blocks MODIFY COLUMN definition_hash varchar(255) NULL DEFAULT "x", DROP COLUMN hash, DROP COLUMN height #"`. This yields arbitrary ALTER TABLE clauses on `blocks` rather than the DROP/TRUNCATE the recorded path already reaches - a different mechanism, not a new impact class.

Impact: the attacker rewrites the schema of the indexed `blocks` table - dropping columns (loss of indexed block data until a full re-index), dropping the primary key, or renaming the table so every blocks query fails. Steps 95/97 execute inside `$createMissingTablesAndIndexes` (106-1280); when a following statement fails, the catch at lines 79-84 calls process.exit(-1) at every restart until an operator repairs the database by hand. No data is returned to the attacker through this sink (ALTER TABLE cannot embed subqueries), so confidentiality is unaffected.

Assumptions: mysql2 3.24.2 (lockfile) sends `query({sql})` without values verbatim; MariaDB default sql_mode without ANSI_QUOTES, which the migration itself relies on for `DEFAULT "0"`; MariaDB accepts comma-separated ADD/MODIFY/DROP/RENAME clauses in one ALTER TABLE (standard syntax).

## Evidence
1. [backend/src/api/database-migration.ts:1125–1133](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/database-migration.ts#L1125-L1133)
   Primary sink (schema step 95). state.string for name='pools_json_sha' is read back (1127) and spliced into DDL at 1131: ALTER TABLE blocks ADD definition_hash varchar(255) NOT NULL DEFAULT "${poolJsonSha}". No validation or escaping; a double quote closes the DEFAULT literal and the remainder becomes further ALTER TABLE clauses, terminated with # or '-- '.
2. [backend/src/api/database-migration.ts:1142–1149](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/database-migration.ts#L1142-L1149)
   Second sink (schema step 97), same pattern at 1148: ALTER TABLE blocks MODIFY COLUMN definition_hash varchar(255) NULL DEFAULT "${poolJsonSha}". Because it MODIFYs an existing column it succeeds on a current schema, so lowering schema_version to 96 (via the recorded INSERT injection) reaches it without the duplicate-column error step 95's ADD would hit.
3. [backend/src/api/database-migration.ts:1317–1321](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/database-migration.ts#L1317-L1321)
   $executeQuery passes the composed string to DB.query({ sql, timeout }) with no parameter array, so mysql2 (3.24.2 per lockfile) transmits it verbatim.
4. [backend/src/tasks/pools-updater.ts:173–185](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/tasks/pools-updater.ts#L173-L185)
   Source. fetchPoolsSha() returns tree[].sha for the pools-v2.json entry of the JSON served at MEMPOOL.POOLS_JSON_TREE_URL (default api.github.com) with no format check; the HTTP provider, not the pools-v2.json authors, controls this string.
5. [backend/src/tasks/pools-updater.ts:143–153](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/tasks/pools-updater.ts#L143-L153)
   Writer. updateDBSha() stores the raw provider string into state.string. The INSERT is single-quoted, so a value containing only double quotes is stored literally - and would be by a parameterised INSERT too - so fixing line 148 (pools-updater-github-sha-sql-injection) does not close this sink. The same unparameterised INSERT also lets the provider set schema_version to 96 via ON DUPLICATE KEY UPDATE, making step 97 run on the next restart of a fully current instance.
6. [backend/src/api/database-migration.ts:658–662](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/database-migration.ts#L658-L662)
   Bounds the legacy route: step 75 sets state.string = NULL for pools_json_sha on Bitcoin networks, and nothing re-populates it before step 95 (the updater runs after migration). A stored hostile sha therefore survives into steps 95/97 only for databases at schema version 75-94 at upgrade time.
7. [backend/src/api/database-migration.ts:1348–1355](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/database-migration.ts#L1348-L1355)
   state.string is varchar(100): the injected DDL fragment is bounded to 100 characters, ample for e.g. x", DROP COLUMN hash, DROP COLUMN height # (42 characters).
8. [backend/src/api/database-migration.ts:79–84](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/database-migration.ts#L79-L84)
   Steps 95/97 run inside $createMissingTablesAndIndexes (106-1280); when a later statement fails after the injected ALTER (dropped/renamed table or columns), this catch logs and calls process.exit(-1), repeating on every restart until the database is repaired by hand.
9. [backend/src/index.ts:130–141](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L130-L141)
   Reachability: $initializeOrMigrateDatabase runs unconditionally at every backend start when DATABASE.ENABLED (Docker default true), so the DDL executes on the first start after the hostile value is present with schema_version below 95 or 97.
10. [backend/src/database.ts:17–26](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/database.ts#L17-L26)
   The mysql2 pool is created with default options: no multipleStatements (so no stacked statements) and no sql_mode change, so MariaDB's default treatment of double quotes as string delimiters applies - which the migration itself relies on for DEFAULT "0".

## Impact
Integrity HIGH: attacker-chosen ALTER TABLE clauses on `blocks` drop columns or the primary key or rename the table, destroying or disabling the indexed block dataset the mining, block and audit APIs are built on (recoverable only by a full re-index). Availability HIGH: after the injected DDL, subsequent migration statements in $createMissingTablesAndIndexes fail and the catch at lines 79-84 calls process.exit(-1) at every restart until an operator hand-repairs the database; alternatively a renamed `blocks` table makes every block query error. Confidentiality NONE: ALTER TABLE cannot return or copy data to the attacker and no result is exposed.

## Reproduction steps
1. Attacker authors the HTTP response for POOLS_JSON_TREE_URL (compromised GitHub API, an operator-configured mirror, or a TLS-breaking proxy) - a deployment condition outside the attacker's control that the threat model nonetheless names as an in-scope second-order adversary - and additionally the database must be below schema_version 95/97 at the next backend start: either a Bitcoin-network instance at schema 75-94 being upgraded with a hostile sha already stored (step 75 NULLs the row below that), or the same provider lowered schema_version to 96 through the recorded INSERT injection at pools-updater.ts:148 (AT:PRESENT). No privileges on the instance and no user interaction are needed; the payload is one JSON string field and the DDL runs deterministically at the next backend start (restarts are routine: Docker restart policies, upgrades, crash loops).

## Recommended fix
1. database-migration.ts steps 95 and 97 build DDL by string-interpolating a value read from the `state` table, treating database content as trusted SQL text; the DEFAULT literal boundary is controlled by that value. Fix criteria: Migration steps 95 and 97 never place `state.string` content into SQL text unescaped: the sha is either validated as exactly 40 lowercase hex characters (falling back to the hardcoded default otherwise) or passed through the driver's literal escaping. A `state` row whose string contains a double quote, comma, `#` or `--` results in that literal becoming the column default (or in the fallback default), never in additional ALTER TABLE clauses, and the backend starts normally.
2. pools-updater.ts fetchPoolsSha/updateDBSha accept and persist any string the remote provider returns as a git object id, so arbitrary provider text reaches `state.string` and every later consumer, including the migration DDL (see pools-updater-github-sha-sql-injection). Fix criteria: A tree response whose pools-v2.json sha is not exactly 40 hex characters is treated as a failed fetch and causes no database write; `state.pools_json_sha` can only ever hold a 40-hex string or NULL.

---
**Severity:** HIGH
**Status:** Open
**Category:** SQL injection
**CWE:** [CWE-89](https://cwe.mitre.org/data/definitions/89.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258140

---

# Cluster mempool relinearization and removal cost grows quadratically with attacker-built component size

## Details
ClusterMempool keeps one DepGraph per connected component of the mempool and, on every poll in which a component changed, relinearizes the whole component (cluster-mempool.ts:631-657). The linearizer is nominally cost-budgeted (DEFAULT_COST_BUDGET 75000), but the budget gates only optimizeSFL/minimizeSFL (linearize.ts:197-202); the initial cost 87*N + 4*E already exceeds the budget for N of a few hundred, so on a large component the budget merely skips the optional phases while these mandatory phases always run to completion:

- the warm-start loop (185-194): for every tx of the previous linearization it calls mergeUpwards, each mergeStepUp performing full scans of the deps array in pickMergeCandidateUp (and, on a merge, pickRandomCrossChunkDep and activateInternalDeps) -> at least N*E work even when nothing merges;
- makeTopological (392-449): every chunk dequeued with queue.shift (O(N)) and one or two full-dep-scan mergeSteps -> O(N*E + N^2);
- postLinearize/extractLinearization/canonicalizeChunkOrder (splice/findIndex/shift based) -> O(N^2) worst case.

Removals are worse: processRemovals (cluster-mempool.ts:366-376) calls DepGraph.removeTransactions once per removed tx, and each call (depgraph.ts:59-96) scans every tx in the graph, then rederiveAncestorsDescendants allocates 2N fresh Sets, sorts N entries and rebuilds every transitive set. Removing k txs from an N-tx component is therefore O(k*(N log N + N*deg*anc)) with 2kN Set allocations.

Component size is attacker-controlled on nodes whose policy bounds only per-tx ancestor/descendant counts (Bitcoin Core's default 25/25): a 'ladder' A1,B1,A2,B2,... where each Bi spends one output of Ai and one of Ai+1 gives every tx <=3 relatives while the connected component is unbounded. ~10,000 standard 110-vB txs at 1 sat/vB cost roughly 0.011 BTC and persist (mempool.space's production bitcoin.conf sets mempoolexpiry=999999). The cluster-mempool path has no component-size cap anywhere (no limit constant in cluster-mempool/*), unlike the legacy CPFP path's MAX_RELATIVE_GRAPH_SIZE=100 (mini-miner.ts:132).

Impact: with N=10k, each relinearization performs on the order of 10^8-10^9 Map/Set operations, i.e. seconds of synchronous CPU on the single Node event loop that also runs Express and the WebSocket server (mempool.ts:399-405; index.ts:271-306). The attacker keeps the component dirty by adding one tiny child per poll (POLL_RATE_MS default 2000), so the backend spends most of its time in linearizeCluster: HTTP/WS latency grows to seconds and mempool/block processing lags. Cheaply evicting members (RBF-replacing roots removes each root plus its children) or a block confirming part of the ladder triggers the O(k*N log N) removal path (blocks.ts:519-525): k=5000 of N=10000 is ~10^8 Set allocations plus 5000 full sorts in one synchronous call.

The same code builds a ClusterMempool per block in calculateClusterMempoolBlockCpfp (cpfp.ts:196, budget 25000) when CLUSTER_MEMPOOL_INDEXING is set, where block contents can contain out-of-policy chains; that path shares the unbudgeted phases.

Conditions: reachable only when MEMPOOL.CLUSTER_MEMPOOL is true (default false; true in every production/mempool-config.{mainnet,testnet,testnet4,signet,regtest}.json used by mempool.space). It holds where the operator's Bitcoin Core does not itself enforce a cluster-count policy limit (releases predating Core's cluster mempool, or a raised -limitclustercount); a Core release that caps clusters at 64 transactions bounds N and makes the cost negligible. production/install pins BITCOIN_LATEST_RELEASE=v32.0, whose mempool policy could not be verified from this checkout; the backend documents no minimum Core version for CLUSTER_MEMPOOL.

## Evidence
1. [backend/src/cluster-mempool/linearize.ts:185–201](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/linearize.ts#L185-L201)
   cost starts at 87*N + 4*E (line 185), which already exceeds DEFAULT_COST_BUDGET=75000 for N of roughly 850 txs, so for any large component the budget checks at 197/200 only skip the optional optimizeSFL/minimizeSFL phases. The warm-start loop (187-194) calls mergeUpwards once per tx of the previous linearization and makeTopological (196) always runs to completion; neither consults costBudget, so the mandatory work is O(N*E) in attacker-built component size.
2. [backend/src/cluster-mempool/linearize.ts:290–326](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/linearize.ts#L290-L326)
   pickMergeCandidateUp iterates the entire deps array (every edge in the component) on every merge step, even when it finds nothing to merge; pickMergeCandidateDown (464-500), pickRandomCrossChunkDep (502-529) and activateInternalDeps (270-288) do the same, so each mergeStepUp/Down is O(E) regardless of the chunk involved.
3. [backend/src/cluster-mempool/linearize.ts:392–449](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/linearize.ts#L392-L449)
   makeTopological dequeues every chunk with queue.shift (O(N) per call) and performs one or two full-dep-scan mergeSteps per dequeue, re-queuing merged results; the loop has no budget check, giving O(N*E + N^2) before cost is compared to the budget on line 197.
4. [backend/src/cluster-mempool/depgraph.ts:59–96](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/depgraph.ts#L59-L96)
   removeTransactions scans every remaining tx in the graph (70-75) and then rederiveAncestorsDescendants sorts all N txs, allocates two fresh Sets per tx and rebuilds every ancestor/descendant set; the routine is O(N log N + N*deg*anc) per call irrespective of how many txs are removed.
5. [backend/src/cluster-mempool/cluster-mempool.ts:366–375](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/cluster-mempool.ts#L366-L375)
   processRemovals calls depgraph.removeTransactions once per removed tx (369) and filters the whole linearization (371), so removing k txs from an N-tx component costs k full rederivations: O(k*N log N) with 2kN Set allocations in one synchronous poll.
6. [backend/src/cluster-mempool/cluster-mempool.ts:631–656](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/cluster-mempool.ts#L631-L656)
   Any add/remove/acceleration touching a component marks it dirty and the entire component is relinearized (643-647) through the unbudgeted phases above; a single ~110-vB child spending one output of the component, broadcast once per poll, retriggers this every poll.
7. [backend/src/api/mempool.ts:399–405](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mempool.ts#L399-L405)
   applyMempoolChange runs synchronously inside $updateMempool, awaited by runMainUpdateLoop (index.ts:271-306) on the single event loop that also serves Express and the WebSocket server; while it runs no HTTP or WebSocket work is processed. The stall timer (mempool.ts:530-533) only logs after mainLoopTimeout.
8. [backend/src/api/blocks.ts:519–525](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L519-L525)
   On block connect every transaction of the block is passed as `removed`, so a block (or an RBF/eviction wave in a poll) that confirms/evicts k members of a large component triggers the O(k*N log N) removal path synchronously in $updateBlocks.

## Impact
The backend is a single Node process; seconds-to-minutes of synchronous CPU per poll block all HTTP and WebSocket service for every user and delay mempool/block processing for as long as the component exists and keeps changing. No data is read or altered.

## Reproduction steps
1. An anonymous network participant broadcasts standard, policy-compliant transactions forming one large connected component (ladder topology keeps every tx within Core's 25/25 ancestor/descendant limits). The operator's Bitcoin Core accepts them, the backend's poll ingests them into one Cluster, and every subsequent add/remove to the component (one ~110-vB child per 2 s poll suffices) triggers the unbudgeted O(N*E) relinearization, and each removal an O(N log N) rederivation, synchronously on the main loop. No privileges or user interaction; attack requirements are the deployment conditions: CLUSTER_MEMPOOL=true (non-default, but set in all of mempool.space's production configs), a Bitcoin Core whose policy does not cap cluster size at 64 (explicit assumption: Core releases without cluster-mempool limits, or -limitclustercount raised; the pinned v32.0's policy is unverified here), and pre-funding of the component (~0.01 BTC for 10k txs).

## Recommended fix
1. spanningForestLinearize runs the warm-start mergeUpwards loop and makeTopological without consulting costBudget, and each merge step scans the entire dependency array, so per-poll linearization work is unbounded in component size. Fix criteria: Every phase of linearizeCluster is bounded by the cost budget (or by per-chunk adjacency so merge steps are O(local edges)), such that relinearizing a component of any size does not exceed a fixed amount of CPU per poll; verify with a 10k-tx ladder that applyMempoolChange completes in bounded time independent of N.
2. DepGraph.removeTransactions scans and fully rederives the whole graph per call, and processRemovals invokes it once per removed transaction. Fix criteria: Removal of k transactions from an N-tx component costs O(k * local relatives) (single batched removal with incremental set updates), not O(k*N); verify that confirming/evicting half of a 10k-tx ladder in one poll completes in bounded time.
3. No upper bound on cluster/component size is enforced on the cluster-mempool path, unlike the legacy path's MAX_RELATIVE_GRAPH_SIZE. Fix criteria: Components beyond a configured size (or linearization cost) fall back to a linear-time ordering (e.g. ancestor-feerate) or are chunked per Core-style cluster limits, so no single component can monopolize the event loop; and this work is moved off the request-serving event loop or yields between clusters.

---
**Severity:** HIGH
**Status:** Open
**Category:** Algorithmic complexity
**CWE:** [CWE-407](https://cwe.mitre.org/data/definitions/407.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257959

---

# Full cluster payload serialised per tracked tx per poll with no cluster size cap

## Details
When MEMPOOL.CLUSTER_MEMPOOL is enabled, the CPFP data served for a mempool transaction includes `cluster`: the complete connected component the tx belongs to, as one entry per transaction plus chunk index arrays (CpfpClusterData, mempool.interfaces.ts:406-421). ClusterMempool.getClusterForApi (cluster-mempool.ts:90-100) -> getClusterInfo -> findChunkInfo (696-708, a linear Array.includes over every chunk) and then getCluster -> buildClusterData (658-694) have no limit on component size: buildClusterData copies and sorts every chunk (`sortTopological` is `[...subset].sort(...)`, depgraph.ts:139-141), allocates one object per member tx and one index array per chunk, so output size and CPU are O(N log N) in component size N.

Component size is set by whoever gets transactions into the node's mempool. Bitcoin Core's standard policy (25-ancestor / 25-descendant count, 101 kvB ancestor/descendant size; no connected-component limit in Core releases up to 30.x — the cluster-size limit is what Core's own cluster-mempool project introduces) does not bound connected-component size: a ladder where each B_i spends outputs of A_i and A_{i+1} keeps every tx within policy while the component grows without bound. ~10,000 standard ~110-vB transactions form one cluster whose serialised payload is ~1.2-1.5 MB (~120-150 bytes/tx). Large natural components (batching/consolidation chains, inscription mints) also occur, so the attacker may not even have to pay to build one.

Two entry points return it:

1. WebSocket track-txs / track-tx (websocket-handler.ts:1005-1024, 957-973). A single subscription message listing up to MAX_TRACKED_TXS=100 member txids (line 63; validation at 250-260 checks only count and hex format) makes the server, on every mempool update in which the component changed, call getClusterForApi for each tracked txid and JSON.stringify the result into that client's response: 100 x ~1.2 MB of synchronous object construction and serialisation per client per poll (POLL_RATE_MS 2 s, config.ts:188; index.ts:290-305). This recurs with no further client messages because relinearizeDirtyClusters assigns a fresh cluster id on every relinearization (631-641) and writeBackTx marks every member cpfpDirty when tx.clusterId !== cluster.id (316-320); any addition, removal or acceleration change anywhere in the component (one tiny child tx per poll from the attacker, or natural churn) re-arms the resend for all N members. cpfpDirty is cleared only after all clients have been served (1076-1080). The cluster result is not shared via getCachedResponse across tracked txids or clients, so cost is (#clients x #tracked x N) per poll. send()'s MAX_BUFFERED_AMOUNT check (1387) terminates a client only after 10 MB is already buffered and runs after the build/stringify work, so it bounds neither the CPU nor the per-poll allocation.

2. GET /api/v1/cpfp/:txId (bitcoin.routes.ts:275-279) rebuilds and returns the O(N) structure per request; each of the N member txids is a distinct request URI and therefore a distinct nginx cache key.

This differs from the rejected finding websocket-per-message-uncached-serialization-amplification: there the per-message cost was fixed by server constants and scaled only with more messages/connections; here the per-payload cost is set by what is in the mempool (unbounded N), and one subscription yields recurring 100 x N work every poll with no further messages. The legacy CPFP path bounds relative graphs at MAX_RELATIVE_GRAPH_SIZE (mini-miner.ts:128-135); the cluster path has no bound.

Impact: tens-to-hundreds of MB of synchronous JSON construction per poll on the single event loop (which also runs $updateMempool/$updateBlocks and the WebSocket fan-out), plus the outbound buffers, from a handful of connections — CPU and memory exhaustion of the backend. The path is active when MEMPOOL.CLUSTER_MEMPOOL is true: it is false in config.ts defaults (210) and the Docker start.sh default (36), and true in every shipped mempool.space production config (production/mempool-config.mainnet.json:22 and the testnet/testnet4/signet/regtest configs), so the path is live on the project's own production deployment.

## Evidence
1. [backend/src/cluster-mempool/cluster-mempool.ts:658–694](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/cluster-mempool.ts#L658-L694)
   buildClusterData emits one entry {txid, fee, weight, parents[]} for every transaction in the cluster and, per chunk, calls sortTopological (depgraph.ts:139-141: `[...subset].sort(...)`, a copy plus sort) and allocates an index array of chunk length; there is no cap on cluster size, so output and CPU are O(N log N) in component size N.
2. [backend/src/cluster-mempool/cluster-mempool.ts:90–100](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/cluster-mempool.ts#L90-L100)
   getClusterForApi returns the full buildClusterData result for any tx in a multi-tx cluster; getClusterInfo -> findChunkInfo (696-708) does a linear Array.includes over every chunk first.
3. [backend/src/cluster-mempool/cluster-mempool.ts:631–641](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/cluster-mempool.ts#L631-L641)
   relinearizeDirtyClusters assigns a brand-new cluster id on every relinearization, so after any change to a component every member's clusterId differs from the stored one.
4. [backend/src/cluster-mempool/cluster-mempool.ts:316–319](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/cluster-mempool.ts#L316-L319)
   writeBackTx sets cpfpDirty = true whenever tx.clusterId !== cluster.id, i.e. for every tx of the component on every relinearization, which re-arms the WebSocket cluster resend for all of them.
5. [backend/src/api/websocket-handler.ts:1005–1023](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L1005-L1023)
   For each client and each of up to MAX_TRACKED_TXS (=100, line 63) tracked txids, when cpfpDirty the handler calls getClusterForApi and embeds the full cluster in that client's response, which is then JSON.stringify'd (1033). The result is not shared via getCachedResponse across tracked txids or clients, so cost is (#clients x #tracked x N) per poll; all of this synchronous work precedes send()'s 10 MB bufferedAmount check (1387), which therefore bounds neither CPU nor allocation.
6. [backend/src/api/websocket-handler.ts:967–972](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L967-L972)
   Same per-client uncached getClusterForApi call on the single track-tx path.
7. [backend/src/api/bitcoin/bitcoin.routes.ts:275–279](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L275-L279)
   GET /api/v1/cpfp/:txId returns the full cluster for any mempool txid; each distinct txid of the component is a distinct request/cache key that rebuilds and returns the whole O(N) structure.

## Impact
Hundreds of megabytes of synchronous object construction and JSON serialisation per poll on the single Node event loop degrade or stall HTTP and WebSocket service and mempool/block processing for all users while the subscriptions exist; memory growth from per-client payload strings can OOM the process. No confidentiality or integrity impact.

## Reproduction steps
1. An anonymous network client first ensures a large connected component exists in the node's mempool — either by broadcasting a policy-compliant ladder (about 0.011 BTC for ~10,000 txs at 1 sat/vB; resident up to two weeks) or by using an existing large natural component. They then open WebSocket connections to /api/v1/ws and send one track-txs message per connection listing 100 member txids (validated only for count and hex at websocket-handler.ts:250-260), and/or issue GET /api/v1/cpfp/<member> requests. Every poll in which the component changed — guaranteed by adding one small child tx per poll, or by natural churn — the backend builds and stringifies 100 full-cluster payloads per connection. No credentials or user interaction. Attack requirement: the operator's Bitcoin Core must accept and retain the large component (true under Core policy through 30.x, which has no cluster-size limit; this is an assumption about the external node, not verified in this repository).

## Recommended fix
1. buildClusterData/getClusterForApi serialise the entire connected component with no upper bound on size, and component size is attacker-controlled. Fix criteria: Cluster payloads returned to clients are bounded (e.g. truncated to a fixed number of transactions/chunks around the requested tx, or omitted above a size threshold with a flag), so the response for any txid is O(constant) regardless of component size.
2. The WebSocket handler recomputes getClusterForApi per client per tracked txid, and relinearization churns cluster ids so every member is cpfpDirty on each change, forcing full resends. Fix criteria: Cluster payloads are computed at most once per cluster per mempool update and shared across tracked txids and clients (as getCachedResponse does for other fields), and cpfpDirty is set only when a tx's effective feerate or chunk membership actually changes, not on cluster-id reassignment; verify that N clients tracking 100 member txids cause one serialisation per cluster per poll.

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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257958

---

# Unbounded RBF tree depth from sequential replacements overflows recursive tree walks and JSON serialization

## Details
The RBF cache models consecutive replacements as a tree whose depth equals the length of the replacement chain: when a new transaction B conflicts with a just-deleted transaction A that already heads a tree, add() detaches A's whole tree and nests it as a child of B's new tree (rbf-cache.ts:160-170, 185-192), and remove() (line 338) refuses to drop any version that has a replacedBy entry, so every prior version is retained while the chain grows. Every tree operation is unbounded recursion: updateTreeMap, getTransactionsInTree, setTreeMined and exportTree recurse through tree.replaces.forEach (three stack frames per level), remove and importTree recurse directly (one frame per level), and whole trees are JSON.stringify()d for the WebSocket rbfLatest/rbfInfo messages and the /replacements, /fullrbf/replacements and /tx/:txid/rbf routes (two JSON nesting levels per tree level). No code bounds the depth of a tree.

Anyone who can broadcast transactions (threat-model adversary 2) controls that depth. Replacing the newest version of their own transaction once per backend poll (POLL_RATE_MS default 2000 ms) adds exactly one level per poll: findRbfTransactions (common.ts:88-96) requires only a shared outpoint plus strictly higher absolute fee and feerate, which Bitcoin Core's BIP125 policy already demands (fee >= old fee + 1 sat/vB x vsize by default), and Core places no limit on how many times a transaction may be replaced. With a minimal ~110 vB transaction each round costs ~110 sats, paid once when the final version confirms; a chain of a few thousand rounds (about two to three hours, ~0.004 BTC) is enough to exceed V8's default ~1 MB stack for the forEach-based recursion (assumption: Node's default stack limit; no launcher in package.json, docker/ or production/ passes --stack-size) and approaches JSON.stringify's nesting limit. The exact thresholds depend on the Node version and frame sizes, but the recursion and nesting are unbounded, so some finite chain always reaches them, and because add() mutates the structure (removeTree, addTree, treeMap.set of the root) before updateTreeMap recurses, the attacker can keep deepening the tree even after it has begun to throw.

Confirmed consequences once the threshold is reached:
1. In $handleMempoolChange (websocket-handler.ts:666-681), memPool.handleRbfTransactions -> rbfCache.add -> updateTreeMap and rbfCache.getRbfChanges -> getTransactionsInTree run on every poll that has mempool changes. A RangeError propagates out of $updateMempool to runMainUpdateLoop's catch (index.ts:306-328), which retries; because `this.dirtyTrees = new Set()` (rbf-cache.ts:302) is only reached after the loop, the deep tree stays dirty and every subsequent poll fails at the same point. Mempool-block projections, WebSocket deltas and fee updates stop; after 5 failures setOutOfSync() makes fee endpoints return 503. The wedge persists until the tree leaves rbfTrees: at the earliest ~24 h after the attacker's final version confirms, when cleanup() -> remove(root) deletes it (if that one-frame-per-level recursion survives the depth), or on an operator restart.
2. If getRbfChanges survives (or JSON.stringify's nesting limit is reached first), the fan-out `server.clients.forEach(async (client) => ...)` (websocket-handler.ts:790-1073) is never awaited; getCachedResponse('rbfLatest', rbfReplacements) at 1048-1052 JSON.stringify()s the 25 most recent trees (the attacker's is always among them while it is being replaced), and the RangeError becomes an unhandledRejection that index.ts:122-124 turns into forceExit(1), killing the process whenever any client has set track-rbf (the attacker's own WebSocket client suffices, websocket-handler.ts:388-392).

Secondary/conditional effects: the REST handlers (bitcoin.routes.ts:1067-1083) and the WebSocket message handler (lines 132/462) wrap their serialization in try/catch, so they degrade to 500 / connection close rather than crash. rbfCache.mined(root) -> setTreeMined matches the root without recursing, so block processing is only disturbed when a never-seen replacement is mined directly (add -> updateTreeMap throws inside $applyBlockTransactionsToMempool), and it recovers on the retry because add() short-circuits on txs.has(). With a roughly three-times-deeper chain the direct recursion in remove() also overflows, and because cleanup() runs from a bare setInterval (rbf-cache.ts:77) that is an uncaughtException -> forceExit. dump() -> exportTree throws at the same threshold as updateTreeMap and is caught in $saveCacheToDisk, so the disk cache holds at most a near-threshold tree; on restart load() -> importTree (one frame per level) can rebuild it and addTree() runs before updateTreeMap() throws inside load()'s try/catch, leaving the deep tree in rbfTrees/dirtyTrees so the wedge may resume on the first mempool change, and the attacker's newest version is still in Core's mempool to be replaced a few more times.

Retained memory is also unbounded (every replaced version's full MempoolTransactionExtended is kept in `txs` while the newest version is unreplaced), but the recursion/serialization failure is the decisive impact.

## Evidence
1. [backend/src/api/rbf-cache.ts:129–194](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/rbf-cache.ts#L129-L194)
   add() nests the replaced transaction's existing RbfTree (looked up via treeMap, lines 160-170) as a child of the new tree (185-191) and then calls the recursive updateTreeMap(). Each observed replacement of the newest version of a chain adds one level; nothing bounds depth. The structural mutation (removeTree, addTree, treeMap.set of the root) precedes the recursion, so the tree keeps deepening even once updateTreeMap throws.
2. [backend/src/api/rbf-cache.ts:356–379](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/rbf-cache.ts#L356-L379)
   updateTreeMap(), getTransactionsInTree() and setTreeMined() recurse through tree.replaces.forEach with no depth limit; each tree level consumes three stack frames (method, forEach builtin, closure).
3. [backend/src/api/websocket-handler.ts:666–680](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L666-L680)
   Every poll with changes, $handleMempoolChange calls memPool.handleRbfTransactions (-> rbfCache.add -> updateTreeMap), rbfCache.getRbfChanges (-> getTransactionsInTree over dirty trees) and getRbfTrees. A RangeError here aborts the mempool update; because `this.dirtyTrees = new Set()` (rbf-cache.ts:302) is never reached, the deep tree stays dirty and every subsequent poll fails the same way.
4. [backend/src/api/websocket-handler.ts:1048–1051](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L1048-L1051)
   Inside the un-awaited `server.clients.forEach(async (client) => ...)` that starts at line 790, getCachedResponse('rbfLatest', rbfReplacements) JSON.stringify()s the full trees (nesting depth 2 per tree level). A RangeError thrown here rejects an async callback nobody awaits, i.e. an unhandledRejection.
5. [backend/src/index.ts:117–124](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L117-L124)
   process.on('uncaughtException'|'unhandledRejection') calls forceExit(..., 1) (index.ts:444-450 -> process.exit): either of the above throws terminates the backend process.
6. [backend/src/api/websocket-handler.ts:388–391](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L388-L391)
   Any WebSocket client (including the attacker) can set track-rbf = 'all', which makes the fan-out path serialize rbfReplacements on every change. The initial JSON.stringify here is inside the message handler's try/catch (lines 132/462), so it closes the connection rather than crashing.
7. [backend/src/api/common.ts:83–133](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/common.ts#L83-L133)
   findRbfTransactions() flags a replacement whenever a new tx spends an outpoint of a tx deleted within the last 10 polls with strictly higher fee and feerate; this is the only gate on growing a chain, so one real RBF per poll interval adds one tree level.
8. [backend/src/index.ts:271–329](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L271-L329)
   runMainUpdateLoop catches the error and retries, calling mempool.setOutOfSync() after 5 failures (fee endpoints return 503); the failing state persists because the deep tree remains in rbfTrees and dirtyTrees. blocks.$updateBlocks still runs before $updateMempool each iteration.
9. [backend/src/api/rbf-cache.ts:323–354](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/rbf-cache.ts#L323-L354)
   remove() (line 338) never drops a version that has a replacedBy entry, so the chain is retained while it grows. cleanup() runs from a bare setInterval (line 77) with no try/catch and calls remove(), which recurses one frame per level over the whole chain once the newest version expires: for a chain roughly three times deeper than the forEach threshold this is an uncaughtException; for a shallower one it deletes the tree and ends the wedge ~24 h after the final version confirms.
10. [backend/src/api/rbf-cache.ts:475–545](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/rbf-cache.ts#L475-L545)
   exportTree() (forEach recursion, called by dump() inside $saveCacheToDisk's try/catch) stops persisting once the tree passes the threshold, so the disk cache holds a near-threshold tree; importTree() (direct recursion) can rebuild it on restart, and load() (lines 428-429) calls addTree() before the updateTreeMap() that throws into load()'s try/catch, leaving the deep tree dirty in rbfTrees so the wedge can resume on the first mempool change.
11. [backend/src/api/blocks.ts:526–530](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L526-L530)
   rbfCache.mined(txId) -> setTreeMined() matches the root without recursing, so ordinary confirmation of the newest version does not throw; only a never-seen replacement mined directly reaches add() -> updateTreeMap() via handleRbfTransactions (line 527) and fails $updateBlocks for one iteration, recovering on retry because add() short-circuits on txs.has().

## Impact
Either process termination via unhandledRejection (fan-out JSON.stringify) or a persistent failure of every mempool update (dirty deep tree re-walked on each poll) that lasts until the tree is removed ~24 h after the final version confirms or the operator restarts and wipes the RBF cache: total loss of the backend's availability for the attack's duration plus up to a day, repeatable for a few hundred dollars each time. No confidentiality or integrity impact.

## Reproduction steps
1. The attacker broadcasts a transaction and then one BIP125 replacement of it per backend poll interval for a few thousand rounds; each round is accepted by Bitcoin Core under default policy (fee += ~1 sat/vB x vsize, ~110 sats for a minimal P2TR spend) and recorded by findRbfTransactions as a new tree level. Total cost is on the order of 0.004 BTC paid once at confirmation and two to three hours of pacing at the default 2 s POLL_RATE_MS; no authentication, special configuration or victim interaction is needed, and the exact V8 stack/JSON nesting threshold need not be known because the attacker simply continues until the backend fails. The attacker then subscribes track-rbf over the public WebSocket, or simply waits for the next poll, to trigger the RangeError paths. Depends on Node's default ~1 MB V8 stack (no launcher passes --stack-size).

## Recommended fix
1. RbfTree depth is unbounded: add() nests the replaced tree under the new one for every observed replacement with no limit, and remove() retains every replaced version while a newer one exists, so attacker-driven replacement chains produce arbitrarily deep structures. Fix criteria: Enforce a maximum tree depth (e.g., collapse or truncate the oldest levels, or flatten long chains) so that no tree exceeds a fixed depth regardless of how many replacements occur. Verify that a chain of 10^4 sequential replacements yields a tree of bounded depth and that all routes, WebSocket messages and the disk/Redis export still serialize.
2. updateTreeMap, getTransactionsInTree, setTreeMined, remove, exportTree and importTree recurse without depth checks; getRbfChanges clears dirtyTrees only after a successful walk; cleanup() runs from a bare setInterval and the per-client WebSocket fan-out is an un-awaited async callback, so a RangeError in RBF processing wedges the main loop or terminates the process. Fix criteria: Implement the traversals iteratively (explicit stack) or with a hard depth guard; clear or evict a dirty tree even when walking it fails; and wrap the setInterval-driven cleanup and the per-client async fan-out so that an exception in RBF processing is logged and isolated rather than terminating the process or wedging $updateMempool. Verify with a synthetic deep tree that no path throws out of the mempool callback, block handler, cleanup timer or WebSocket fan-out.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncontrolled recursion
**CWE:** [CWE-674](https://cwe.mitre.org/data/definitions/674.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257957

---

# POST /cpfp: unbounded vin/vout arrays drive quadratic in-mempool graph expansion on the event loop

## Details
The public, unauthenticated POST /api/v1/cpfp endpoint (registered unconditionally at bitcoin.routes.ts:68; the frontend's raw-transaction preview is its production consumer) runs the in-mempool CPFP cluster algorithm on a transaction object supplied in the request body. getCpfpLocalTxs() only checks that `vin` and `vout` are arrays; it bounds neither their length nor their contents and does not reject duplicate entries. calculateMempoolTxCpfp() converts the object with convertToGraphTx() (O(|vin|+|vout|), building a `${txid}:${index}` string and doing a spendMap lookup per vout) and seeds expandRelativesGraph() with it.

expandRelativesGraph() is meant to be bounded by MAX_RELATIVE_GRAPH_SIZE = 100, but the check runs only at pop time and counts *distinct* txids in `relatives`. When the root is popped, every one of its `depends` entries (the request's vin txids) is handled: only txids already in `relatives` are skipped, and `relatives` is populated only at pop. So N duplicate vin entries naming the same in-mempool tx T produce N convertToGraphTx(T) calls and N GraphTx copies pushed onto the stack simultaneously. Popping those N copies never grows relatives.size beyond 2 (root, T) when T's inputs are confirmed and it has no in-mempool children, so the early-return never fires and the loop drains all N entries, each pop spreading `[...T.depends, ...T.spentby]` and performing relatives.has / ancestors.get / `in mempool` lookups for every one of T's |vin| parents. Total work is about N x (|T.vin| + |T.vout|): the attacker controls N (~130,000 `{"txid":T}` entries fit in the 10 MB body that both express.json and the shipped nginx client_max_body_size 10m accept) and chooses T from the public mempool (large consolidations/batch payouts with hundreds to ~1,500 inputs or thousands of outputs are routinely present and visible via the mempool APIs, or the attacker broadcasts one). That is on the order of 10^8-10^9 string builds, Map lookups and array allocations executed synchronously on the single Node.js event loop. The subsequent passes are secondary but also scale with N: setAncestors() re-walks the N depends merging T's cached ancestor map (<=100 entries) per entry, and removeAncestors() filters the N-element depends array once if T outranks the root. Independently, a request `vout` array with millions of elements drives the per-vout string build in convertToGraphTx for the local tx.

Memory is also unbounded: each of the N GraphTx copies retains its own `depends` array of |T.vin| string references (~12 KB for 1,500 inputs) plus a Map, and all N are live on the stack before any is popped, i.e. ~1.5 GB for N=130k. The Docker image runs `node /backend/package/index.js` with the default V8 heap and `npm start` uses --max-old-space-size=2048, so on top of a mainnet mempool this can exceed the heap and abort the process.

Impact: one 10 MB request blocks the backend for tens of seconds (or crashes it on heap exhaustion). While blocked, the mempool poll loop, every WebSocket client and every HTTP route stall; a few requests per minute keep the instance down. The threat model lists per-request amplification as in scope. The GET /cpfp/:txId sibling is not affected in the same way because its root is a real mempool tx whose vin is bounded by standardness.

Relation to the ledger: lead dismissed-bitcoin-1326-e8ce declined this sink because expandRelativesGraph is capped by MAX_RELATIVE_GRAPH_SIZE=100 and cost stays proportional to request size. The cap counts distinct popped relatives, duplicates in the request's vin bypass it entirely, and the per-entry cost is the size of the referenced mempool transaction chosen by the attacker, so total work is request size multiplied by target size. Open lead lead-mini-miner-142-c7c3 identified the first-level fan-out; this finding runs it to a conclusion. (`relativeTxid in mempool` with `__proto__`/`constructor` strings only yields a caught TypeError today.)

## Evidence
1. [backend/src/api/mini-miner.ts:128–159](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mini-miner.ts#L128-L159)
   expandRelativesGraph() checks relatives.size > MAX_RELATIVE_GRAPH_SIZE (100) only when popping. For every entry of nextTx.depends (the request-supplied vin list) it skips only txids already *processed* (relatives.has), then calls convertToGraphTx() on the referenced mempool tx and pushes it. Duplicate txids in depends are each converted and pushed; duplicates never grow relatives.size, so the loop drains the whole stack and re-walks the target tx's depends/spentby on every pop. Work and pending-stack memory are proportional to |vin| x (|T.vin| + |T.vout|), not to the 100-relative cap.
2. [backend/src/api/bitcoin/bitcoin.routes.ts:1304–1332](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L1304-L1332)
   getCpfpLocalTxs validates only that vin and vout are arrays (no length bound, no element validation) and hands the attacker object to calculateMempoolTxCpfp(..., localTx=true). The route is registered unconditionally (line 68) for all backends with no authentication.
3. [backend/src/api/mini-miner.ts:104–123](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mini-miner.ts#L104-L123)
   convertToGraphTx() costs O(|vin| + |vout|) per call: maps every vin to its txid and, for every vout index, builds a `${txid}:${index}` string and performs a spendMap lookup, allocating transient arrays. The local tx's own vout array (unbounded, from the body) is walked here too.
4. [backend/src/api/cpfp.ts:262–268](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/cpfp.ts#L262-L268)
   calculateMempoolTxCpfp() seeds the graph with the request-supplied tx and calls expandRelativesGraph() against the live mempool map and spendMap, then initializeRelatives() and calculateCpfpCluster(), all synchronously inside the HTTP handler.
5. [backend/src/api/mini-miner.ts:168–197](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mini-miner.ts#L168-L197)
   setAncestors() (called via initializeRelatives for the local tx, which is a leaf because its spentby is empty) iterates tx.depends again (|vin| entries) and for each resolvable parent merges the parent's cached ancestor map (at most MAX_RELATIVE_GRAPH_SIZE entries), so the second pass is O(|vin| x <=100): secondary to the expansion cost but still proportional to the request-supplied array.
6. [backend/src/api/mini-miner.ts:230–251](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mini-miner.ts#L230-L251)
   removeAncestors() runs tx.depends.filter(...) over the local tx's |vin|-element depends array for each removed cluster member whose txid the local tx depends on. With the duplicate-vin graph {root, T} this happens at most once (the cluster loop in calculateCpfpCluster exits as soon as the best cluster contains the root), so it is a single extra O(|vin|) pass allocating a fresh |vin|-sized array.
7. [backend/src/index.ts:152–155](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L152-L155)
   express.json is configured with limit '10mb', so a single request can carry ~130,000 vin objects of the form {"txid":"<64 hex>"} or several million vout elements.

## Impact
Full loss of availability of the backend process (all HTTP and WebSocket service, mempool polling and block processing) for the duration of each request, with repeat requests sustaining the outage and a possible OOM crash. No confidentiality or integrity impact.

## Reproduction steps
1. Anonymous Internet client sends POST /api/v1/cpfp with a 10 MB JSON body: one object whose vin array repeats {"txid": T} ~130,000 times, where T is an in-mempool tx with many inputs/outputs (observable via public mempool/tx APIs or created by the attacker). The handler synchronously performs ~N x |T| work and allocates N GraphTx copies; the event loop is blocked for tens of seconds or the heap limit is hit. No authentication, no special configuration, works against the default route set.

## Recommended fix
1. getCpfpLocalTxs accepts vin/vout arrays of unbounded length and unvalidated element shape, so the request controls the amount of graph work performed. Fix criteria: Reject request transactions whose vin or vout exceed a small bound consistent with standard transactions, whose vin elements are not {txid: 64-hex, vout: integer} objects, or whose vin contains duplicate outpoints. Verify that a 10 MB body with 10^5 vin entries is rejected before any graph work.
2. expandRelativesGraph bounds only distinct processed relatives; duplicate or pending txids are converted and pushed without limit, making work proportional to the input's edge count rather than the graph-size cap. Fix criteria: Track pushed/visited txids so each mempool tx is converted at most once, and cap total pushes/iterations (not just relatives.size) so the routine's work is bounded by a constant independent of request-supplied array sizes. Verify a root with N duplicate depends performs O(1) conversions of the target.

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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257955

---

# WebSocket track-tx with watch-mempool issues one Core RPC per input of an arbitrary confirmed transaction

## Details
The WebSocket handler lets any anonymous client make the backend fetch an arbitrary transaction with full prevouts on every message. On `{"track-tx":"<txid>","watch-mempool":true}` (websocket-handler.ts:190-227), if the txid is not in the RBF cache and not in the mempool, line 219 awaits `transactionUtils.$getMempoolTransactionExtended(txid, true)` — `addPrevouts=true`, `lazyPrevouts=false`. The frontend sends this only after `/api/tx/:txid` returned 404 (transaction.component.ts:911), but the server does not check that: any 64-hex txid, including a confirmed one, is accepted.

With the default `MEMPOOL.BACKEND='none'` (config.ts:183) or the Docker default `electrum` (start.sh:5; BitcoindElectrsApi extends BitcoinApi, electrum-api.ts:12, and does not override the path) the request goes to Bitcoin Core: `$getRawTransaction` (bitcoin-api.ts:40-62) issues `getrawtransaction`, then `$convertTransaction(..., addPrevout=true)` (374-382) calls `$calculateFeeFromInputs(..., lazyPrevouts=false)` (469-493), which awaits one more `getrawtransaction` — and a full `$convertTransaction` of the fetched prevout tx — for every input. The 12-input cap exists only for `lazyPrevouts=true`, which the project uses on `GET /block/:hash/txs` (bitcoin.routes.ts:709) but not here. For a confirmed consolidation with thousands of inputs (public chain data, discoverable by anyone), one ~110-byte WebSocket frame therefore produces thousands of sequential Core RPC round-trips, and nothing is cached because the transaction is not in the mempool. The amplification factor is set by the attacker's choice of txid, not by the code. (Without `txindex` the first RPC fails cheaply; `txindex=1` is what backend/README.md:33-36 and docker/README.md:21 instruct operators to set.)

The message handler is `async` and does not serialise messages (websocket-handler.ts:131), so one connection may have up to 100 such chains in flight per 10 s (lines 142-152) and connections per IP are unbounded in every shipped nginx config (no `limit_conn`/`limit_req` is applied anywhere; nginx.conf only defines zones). The RPC client uses `agent: false` (rpc-api/jsonrpc.ts:49), so there is no client-side concurrency cap either. Bitcoin Core's RPC server has a small worker pool and queue (defaults rpcthreads=4, rpcworkqueue=16 — an assumption about Bitcoin Core, not pinned by this repo); saturating it with attacker-driven `getrawtransaction` calls makes the backend's own `$getRawMempool`/`$updateBlocks` in `runMainUpdateLoop` (index.ts:284-288) fail or time out, and after five failures the instance is marked out of sync (index.ts:317-319), starving every other user.

The same sink is reachable via REST `GET /api/tx/:txid` (bitcoin.routes.ts:321, lazyPrevouts=false); that sibling exhibits the same defect rather than sanctioning it, and is tracked separately. The mempool-resident shortcut (`$addPrevouts`, bitcoin-api.ts:429-446) used at websocket-handler.ts:211 caches prevouts on the mempool entry after the first fetch, so the repeated, uncached cost applies to confirmed transactions. Related per-input/per-output fan-out findings at other entry points: core-rpc-outspends-per-output-gettxout-fanout, psbt-addparents-unbounded-input-fanout-memory.

## Evidence
1. [backend/src/api/websocket-handler.ts:190–227](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L190-L227)
   For any message whose 'track-tx' is 64 hex chars and whose 'watch-mempool' is truthy, when the txid is neither in the RBF cache (rbfCache.getReplacedBy) nor in memPool.getMempool(), line 219 awaits transactionUtils.$getMempoolTransactionExtended(client['track-tx'], true) — addPrevouts=true, lazyPrevouts=false — on every message. The server never checks that the tx is actually unconfirmed/unknown (the only case the frontend sends this for); a confirmed txid is accepted and fully resolved, and nothing caches or deduplicates the result.
2. [backend/src/api/transaction-utils.ts:52–76](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/transaction-utils.ts#L52-L76)
   $getMempoolTransactionExtended(txId, addPrevouts) forwards to $getTransactionExtended(txId, addPrevouts=true, lazyPrevouts=false, forceCore=false, addMempoolData=true), which calls bitcoinApi.$getRawTransaction(txId, false, true, false).
3. [backend/src/api/bitcoin/bitcoin-api.ts:40–62](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin-api.ts#L40-L62)
   For a tx not in the mempool, $getRawTransaction issues bitcoindClient.getRawTransaction(txId, true) (needs txindex, which backend/README.md:33-36 and docker/README.md:21 tell operators to enable) and passes the result to $convertTransaction(tx, addPrevout=true, lazyPrevouts=false).
4. [backend/src/api/bitcoin/bitcoin-api.ts:374–383](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin-api.ts#L374-L383)
   $convertTransaction with addPrevout=true calls $calculateFeeFromInputs(tx, false, lazyPrevouts=false) for every non-coinbase transaction.
5. [backend/src/api/bitcoin/bitcoin-api.ts:469–493](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin-api.ts#L469-L493)
   $calculateFeeFromInputs loops over every vin and awaits a separate this.$getRawTransaction(vin.txid) — one getrawtransaction RPC plus a full $convertTransaction of the prevout tx — per input. The 12-input cap applies only when lazyPrevouts is true, which this path never sets, so an N-input confirmed transaction costs N+1 sequential Core RPCs per WebSocket message. The project itself uses lazyPrevouts=true to bound this cost on GET /block/:hash/txs (bitcoin.routes.ts:709), showing unbounded fan-out is not an intended per-request cost.
6. [backend/src/api/bitcoin/electrum-api.ts:12](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/electrum-api.ts#L12)
   BitcoindElectrsApi extends BitcoinApi and does not override $getRawTransaction or $convertTransaction, so the Docker default BACKEND=electrum (docker/backend/start.sh:5) takes the identical per-input Core RPC path; only BACKEND=esplora (ElectrsApi) avoids it.
7. [backend/src/api/websocket-handler.ts:131–152](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L131-L152)
   client.on('message', async …) processes each message as an independent async chain — nothing serialises messages per connection — and the only throttle is 100 messages per 10 s per connection (MSG_RATE_LIMIT/MSG_RATE_WINDOW, lines 64-65). No shipped nginx config applies limit_conn or limit_req (nginx.conf only defines zones), so connections per IP are unbounded.
8. [backend/src/rpc-api/jsonrpc.ts:40–50](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/rpc-api/jsonrpc.ts#L40-L50)
   The Core RPC client sets agent: false, so every RPC opens its own connection with no client-side concurrency cap or queue; all in-flight prevout chains hit Core's RPC worker pool concurrently.
9. [backend/src/index.ts:284–319](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L284-L319)
   The backend's own polling (bitcoinApi.$getRawMempool, blocks.$updateBlocks) uses the same Core RPC server; when those calls fail or time out five times in a row the instance is marked out of sync (mempool.setOutOfSync, line 319) and stops serving fresh data to every client.
10. [backend/src/config.ts:183](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/config.ts#L183)
   MEMPOOL.BACKEND defaults to 'none' (Bitcoin Core as transaction source); together with the Docker electrum default, both default deployments are affected.

## Impact
Thousands of attacker-driven getrawtransaction calls per message saturate Core's RPC worker pool/queue and the backend's RPC client, so the backend's own polling (getrawmempool, getblock) stalls or errors, the instance falls out of sync and stops serving fresh data to all users; the Node process also spends CPU converting each fetched prevout transaction. No confidentiality or integrity impact. Subsequent-system impact: The amplified load lands on the operator's Bitcoin Core node (a separate trusted component): its RPC interface becomes unavailable for other RPC consumers while the attack runs.

## Reproduction steps
1. An anonymous client connects to the public WebSocket (threat-model adversary 1), picks the txid of a confirmed transaction with thousands of inputs (public chain data), and repeatedly sends {track-tx, watch-mempool:true} — up to 10/s per connection, across as many connections as desired since no shipped nginx config applies limit_conn. Each message makes the backend perform one Core RPC per input with no cap or cache. Holds on both default deployments (config default BACKEND 'none' and Docker default 'electrum') when Core runs with txindex as the project's install docs instruct; only esplora-backed instances are unaffected, hence AT:P. No security mechanism has to be defeated.

## Recommended fix
1. The watch-mempool branch fetches an arbitrary client-chosen transaction with full prevouts (lazyPrevouts=false) on every message, with no cap on inputs and no caching for non-mempool transactions. Fix criteria: A track-tx/watch-mempool message for a transaction not in the mempool must cost a bounded number of upstream calls regardless of the transaction's input count (e.g. use lazyPrevouts, skip prevout resolution for confirmed transactions on this path, or return only the position/replacement data the subscription needs), and repeated requests for the same txid must be served from a cache rather than re-fetched.
2. Core-backed prevout resolution in $calculateFeeFromInputs performs one sequential RPC per input with no upper bound when lazyPrevouts is false. Fix criteria: Prevout resolution for client-initiated requests is bounded (input cap or lazy mode) or batched, so that a single request cannot generate an unbounded number of Core RPC calls.

---
**Severity:** HIGH
**Status:** Open
**Category:** Resource amplification
**CWE:** [CWE-405](https://cwe.mitre.org/data/definitions/405.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257954

---

# Bulk block range loop never advances when an indexed height stays unreadable

## Details
Blocks.$getBlocksBetweenHeight (backend/src/api/blocks.ts:1875-1884) serves GET /api/v1/blocks-bulk/:from[/:to]. Per height it runs: block = $getBlockByHeight(h); if null -> await $indexBlockByHeight(h); block = $getBlockByHeight(h); if still null -> `continue`. The only increment of fromHeight is at the bottom of the loop body (blocks.ts:1977), so the `continue` re-runs the same height with no bound, no backoff and no cancellation on client disconnect; the response is never sent and the request's async loop keeps issuing 3 DB queries plus one upstream $getBlockHash call per pass for as long as the DB state persists.

The code does not guarantee that a non-throwing $indexBlockByHeight makes the height readable. $indexBlockByHeight (1608-1619) resolves hash = bitcoinApi.$getBlockHash(h) and calls $indexBlock(hash) (1697-1704), which returns early with whatever row BlocksRepository.$getBlockByHash finds (587-606, no stale filter) without touching the DB. $getBlockByHeight (537-557) requires `stale = 0`. So when the hash upstream reports as canonical at H is stored only as a stale=1 row and no stale=0 row exists at H, the second lookup is null and the loop spins.

That index state is one the project's own code anticipates: chain-tips $indexOrphanedBlocks saves fork blocks with stale=1 (chain-tips.ts:139-176); a fork later reconnected as canonical is normally repaired by $handleReorgs -> $setCanonicalBlockAtHeight (blocks.ts:1622-1645), by the ER_DUP_ENTRY branch of $saveBlockInDatabase (BlocksRepository.ts:205-216, comment: 'possible upon node backend restart or if a stale block is reconnected'), or by the hourly indexer ($indexBlocks treats stale-only heights as missing, 1261-1300; $validateChain resets wrongly stale canonical blocks, 681-760). The repairs do not cover every path: $handleReorgs is skipped when $updateBlocks fast-forwards (1465), its walk-back stops at the first height with no stale=0 row, and a failing $setCanonicalBlockAtHeight in the dup-entry branch is logged and swallowed. Until the hourly indexer run (or the next successful repair) writes stale=0 for the canonical row, any request covering H loops.

An anonymous client who requests a range covering such a height (or sweeps recent heights where reorgs occur, MAX_BLOCKS_BULK_QUERY heights per request) turns a transient, otherwise harmless index inconsistency into an unbounded per-request loop of DB queries and upstream RPC/esplora calls; each additional request adds another spinner, and with enough of them the shared mysql pool (DATABASE.POOL_SIZE, default 100) and upstream are saturated, stalling block ingestion and all DB-backed routes until the state is repaired. Legitimate clients hitting the same height also hang.

Conditions: MEMPOOL.MAX_BLOCKS_BULK_QUERY > 0 (config default 0 disables the route; the frontend's public API docs list the endpoint as live with a 10-block limit, api-docs-data.ts:5311-5316), DATABASE.ENABLED with INDEXING_BLOCKS_AMOUNT != 0, and the stale-only index state at a height in the requested range. The sibling range reader $getBlocks (1845-1856) always decrements and is unaffected.

## Evidence
1. [backend/src/api/blocks.ts:1875–1883](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L1875-L1883)
   The while loop in $getBlocksBetweenHeight calls $indexBlockByHeight(fromHeight) when $getBlockByHeight is null, re-queries, and on a second null executes `continue` without incrementing fromHeight. The only increment is at line 1977, so this path re-runs the same height with no bound, backoff or cancellation.
2. [backend/src/api/blocks.ts:1608–1618](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L1608-L1618)
   $indexBlockByHeight returns normally whenever $getBlockByHeight is null but $indexBlock(hash) returns a block; it does not verify the height became readable, so the caller's second $getBlockByHeight can still be null without any throw.
3. [backend/src/api/blocks.ts:1697–1703](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L1697-L1703)
   $indexBlock short-circuits on $getBlockByHash(hash) and returns whatever row exists for that hash, including one flagged stale=1, without reconciling the flag or writing anything. The DB state is unchanged, so the next $getBlockByHeight returns null again.
4. [backend/src/repositories/BlocksRepository.ts:537–556](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/repositories/BlocksRepository.ts#L537-L556)
   $getBlockByHeight filters `stale = 0`, so a height whose only row for the canonical hash is flagged stale yields null even though the block is indexed.
5. [backend/src/repositories/BlocksRepository.ts:587–605](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/repositories/BlocksRepository.ts#L587-L605)
   $getBlockByHash has no stale filter, so it finds the row that $getBlockByHeight rejects. This asymmetry is what lets $indexBlockByHeight 'succeed' while the height remains unreadable.
6. [backend/src/repositories/BlocksRepository.ts:205–215](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/repositories/BlocksRepository.ts#L205-L215)
   The ER_DUP_ENTRY branch documents that a stale block being reconnected as canonical is an expected state and repairs it via $setCanonicalBlockAtHeight, but a failure there is logged and swallowed, leaving the stale=1 row in place; the hourly indexer is then the only repair.
7. [backend/src/api/bitcoin/bitcoin.routes.ts:573–613](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L573-L613)
   Unauthenticated entry point GET /api/v1/blocks-bulk/:from[/:to]. Validation only bounds the range size (MAX_BLOCKS_BULK_QUERY) and sign; any height in the range reaches $getBlocksBetweenHeight. The endpoint is active when MAX_BLOCKS_BULK_QUERY > 0.

## Impact
Each triggering request becomes a never-completing async loop issuing three DB queries and one upstream $getBlockHash call per pass at full speed, with no backoff and no cancellation on disconnect, until the stale row is repaired (typically by the hourly indexer). The response never completes. Enough concurrent requests hold every connection of the shared mysql pool (POOL_SIZE default 100) and load Core/esplora, stalling block ingestion and all DB-backed routes for the whole instance for the duration; legitimate requests for the same range also hang. No data is disclosed or modified.

## Reproduction steps
1. Anonymous HTTP client sends GET /api/v1/blocks-bulk/H/H (or any range including H) where H is a height whose canonical hash is stored only as a stale=1 row. Route validation checks only range size and sign; no credentials or user interaction. The index state is not attacker-created: it arises from fork blocks indexed as stale by chain-tips that are later reconnected while the normal repairs ($handleReorgs, the dup-entry $setCanonicalBlockAtHeight, hourly $indexBlocks/$validateChain) have not yet run or were skipped, and it persists at most until the next successful repair. The attacker can probe for it by sweeping recent heights. AT:P reflects both that state and the non-default MAX_BLOCKS_BULK_QUERY > 0 setting.

## Recommended fix
1. The `continue` branch in $getBlocksBetweenHeight does not advance `fromHeight`, so a height that remains unreadable after on-the-fly indexing is retried forever; the loop has no guaranteed progress or exit condition. Fix criteria: Every iteration of the range loop must either advance to the next height or terminate the request (skip the height, or fail with an error). Verify by arranging a DB where the only row for the canonical hash at height H is flagged stale=1 and requesting /blocks-bulk/H/H: the response must return promptly and the backend must issue a bounded number of DB/upstream calls.
2. $indexBlock returns an existing row found by hash even when that row is flagged stale although upstream reports the hash as canonical for its height, so a successful $indexBlockByHeight does not imply $getBlockByHeight returns a block. Fix criteria: When indexing by height resolves to a hash that is already stored but flagged stale (or otherwise unreadable by $getBlockByHeight), the index must be reconciled (mark it canonical) or an error surfaced. Verify that after $indexBlockByHeight(H) returns without throwing, $getBlockByHeight(H) is non-null for the same H.

---
**Severity:** HIGH
**Status:** Open
**Category:** Infinite loop
**CWE:** [CWE-835](https://cwe.mitre.org/data/definitions/835.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257953

---

# Tor hidden-service listener defeats loopback-based ACL guarding /api/v1/internal and /api/internal

## Details
The production nginx configuration (deployed by `production/install` onto mempool.space / liquid.network class hosts) restricts the internal API surface - `/api/v1/internal/*` on the mempool backend and `/api/internal/*` on esplora - by a single check: `$mempool_external`, computed in `http-acl.conf` from `$remote_addr` with 127.0.0.1 and ::1 mapped to the trusted value. `location-api.conf` returns 403 only when `$mempool_external` is set.

The same configuration defines the mempool server block with `listen 127.0.0.1:81;` (the clearnet `listen 443 ssl` lines are commented out), and `production/torrc` publishes that port as the Tor v3 hidden service (`HiddenServicePort 80 127.0.0.1:81`; the install script appends the same for liquid on port 83). A Tor hidden service delivers client connections from the local tor daemon, so for every onion visitor `$remote_addr` is exactly 127.0.0.1. The ACL therefore evaluates to 'internal' for all anonymous Tor users, and the `if ($mempool_external) return 403` guard never fires on the Tor path.

Result: anyone with Tor Browser can GET/POST `http://<mempool onion>/api/v1/internal/bitcoin-core/get-block?hash=<h>&verbosity=3`, `.../get-raw-transaction?txid=..&verbose=2`, `.../get-mempool-entry`, `.../get-mempool-ancestors`, `.../decode-raw-transaction`, `.../send-raw-transaction`, `.../test-mempool-accept` (registered because production configs set `MEMPOOL.OFFICIAL: true`), plus `/api/v1/internal/blocks/*` (registered unconditionally in bitcoin.routes.ts:72-74), and the esplora bulk endpoints via `/api/internal/txs`, `/api/internal/mempool/txs`, `/api/internal/block/<hash>/txs`, `/api/internal/txs/outspends/*`. The bitcoin-core routes are documented in the file header as 'not designed to be public'; they talk directly to Bitcoin Core RPC and set no-cache headers, so nginx's proxy cache does not absorb repeated calls, and the Tor listener has no `limit_req`. An attacker gets the node's private view (mempool entry internals, verbose block/tx dumps) and a cheap request-to-heavy-RPC amplifier (`getblock verbosity=3` on a full block, bulk esplora fetches) against the same Core/esplora instances the public backend depends on.

The threat model records that `/internal/*` routes 'are gated by nginx location rules'. In this configuration that gate is keyed on a property (loopback peer) that the deployment's own Tor front-end shares with the operator's cache warmers, so the boundary is not where the threat model says it is. The same `127.0.0.1` exemption also appears in the Docker nginx.conf rate-limit `geo`, though that config never applies the limit zones.

## Evidence
1. [production/nginx/http-acl.conf:2–5](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/nginx/http-acl.conf#L2-L5)
   The only authorization signal for the internal API is `geo $remote_addr $mempool_external`, which yields '' (trusted) for 127.0.0.1 and ::1 and 1 for everything else. No `proxy`/real_ip handling is configured, so the peer address of the accepted TCP connection decides.
2. [production/nginx/nginx.conf:48–50](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/nginx/nginx.conf#L48-L50)
   The mempool server block's only active listener in the shipped config is `listen 127.0.0.1:81;` commented '# tor v3' (the clearnet `listen 443` lines at 41-42 are commented out). Every connection accepted here is made by the local tor daemon, so $remote_addr is always 127.0.0.1. production/install:1818 installs this file verbatim as the system nginx.conf.
3. [production/torrc:13–15](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/torrc#L13-L15)
   `HiddenServicePort 80 127.0.0.1:81` forwards all anonymous onion visitors to that listener; production/install:1098 installs this torrc and lines 1104-1106 append the same for liquid on 127.0.0.1:83 (nginx.conf:91).
4. [production/nginx/location-api.conf:5–18](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/nginx/location-api.conf#L5-L18)
   `if ($mempool_external) { return 403; }` is skipped when the variable is '' (loopback peer); the request is then proxied to the esplora upstream (`/api/internal/` -> `/internal/...` via @esplora-api-cache-disabled) or to the mempool backend (`/api/v1/internal/` via @mempool-api-v1-cache-normal). No limit_req is applied anywhere in production/nginx.
5. [production/nginx/location-testnet-api.conf:5–11](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/nginx/location-testnet-api.conf#L5-L11)
   Intent evidence: for testnet (and identically signet, testnet4, liquid, liquidtestnet) the same `/api/internal/` and `/api/v1/internal/` routes are unconditionally `return 404`, showing the project means these routes to be unreachable by visitors; the mainnet loopback exemption exists only for the co-located accelerator server / cache warmer.
6. [backend/src/api/bitcoin/bitcoin-core.routes.ts:10–28](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin-core.routes.ts#L10-L28)
   Routes explicitly documented as 'used by the accelerator server' and 'not designed to be public': direct Bitcoin Core RPC passthrough (getblock with caller-chosen verbosity, getrawtransaction with caller-chosen verbose level, getmempoolentry, getmempoolancestors, decoderawtransaction, sendrawtransaction, testmempoolaccept). The disableCache middleware (lines 38-43) sets `Cache-control: private, no-store`, so nginx's proxy cache does not absorb repeated requests.
7. [backend/src/index.ts:385–387](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L385-L387)
   These routes are registered when MEMPOOL.OFFICIAL is true, which production/mempool-config.mainnet.json, .testnet.json and .liquid.json all set (line 3 of each). The code itself has no auth; nginx is the gate.
8. [backend/src/api/bitcoin/esplora-api.ts:467–475](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/esplora-api.ts#L467-L475)
   Shows the esplora `/internal/*` bulk endpoints the backend itself relies on (POST /internal/txs, POST /internal/mempool/txs, GET /internal/mempool/txs full-mempool paging) that `/api/internal/` exposes to loopback peers; esplora is an external component, so their server-side behaviour is inferred from these client calls.

## Impact
Confidentiality LOW: exposes node-internal RPC views the project deliberately withholds from visitors (getmempoolentry fees/modified fee/time/unbroadcast state, getblock verbosity 3, verbose raw txs, esplora bulk internals); blockchain data itself is public, so the leak is node-local metadata. Integrity NONE: send-raw-transaction/test-mempool-accept are already reachable publicly via `/api/tx`, `/api/v1/txs/test` and `/api/v1/txs/package`. Availability LOW: each request maps to an uncached Core RPC (`Cache-control: no-store` from disableCache; getblock verbosity 3 on a full block) or an esplora bulk query, with no limit_req on the Tor listener, degrading the shared Core/esplora instances the public API depends on; the per-request cost is bounded by block/mempool size, so this is amplification, not unbounded exhaustion. Assumptions: the mempool esplora fork actually serves `/internal/txs` and `/internal/mempool/txs` as the backend client in esplora-api.ts expects (esplora is not in this repository); and the host runs tor and nginx co-located as production/install configures. If a deployment fronts nginx differently, only the Tor-side path described here applies.

## Reproduction steps
1. Attacker: any anonymous Internet user with a Tor client. They open the published mempool.space / liquid.network onion address and request `/api/v1/internal/bitcoin-core/...`, `/api/v1/internal/blocks/...` or `/api/internal/...`. The hidden-service hop makes nginx see 127.0.0.1 as the peer, so `$mempool_external` is '' and the 403 guard in location-api.conf is skipped; the request is proxied to the OFFICIAL backend / esplora. No credentials, no user interaction, no race. The listener/torrc pairing is what production/install deploys verbatim (lines 1098-1106, 1818), not an operator deviation.

## Recommended fix
Authorization for the internal API is derived from `$remote_addr == 127.0.0.1`, but the Tor hidden-service listener (127.0.0.1:81/83) delivers all anonymous visitors from that address, so the check cannot distinguish operator tooling from the public. Fix criteria: Requests arriving on any listener that carries public traffic (including the Tor hidden-service ports) must receive 403/404 for `/api/v1/internal/*` and `/api/internal/*` regardless of peer address; e.g. gate on the listening socket/server block or require an explicit credential. Verify by requesting an internal route through the onion and observing it is refused while the local cache warmer still succeeds.

---
**Severity:** HIGH
**Status:** Open
**Category:** Improper access control
**CWE:** [CWE-863](https://cwe.mitre.org/data/definitions/863.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257950

---

# Unauthenticated blockHeight query crashes backend via unhandled rejection in accelerator history route

## Details
The backend registers GET `<API_URL_PREFIX>services/accelerator/accelerations/history` whenever `MEMPOOL_SERVICES.ACCELERATIONS` is enabled (index.ts:403-405; false by default for self-hosters and Docker, true in the shipped production/mempool-config.mainnet.json). The handler `$getAcceleratorAccelerationsHistory` (acceleration.routes.ts:44-57) is an `async` Express 4 handler with no try/catch. It parses the attacker-controlled `blockHeight` query parameter with `parseInt`, so any non-numeric value (`?blockHeight=abc`, `?blockHeight=Infinity`, `?blockHeight[]=x`) yields `NaN`; the value is truthy-checked before conversion, so NaN is passed as `height` to `AccelerationRepository.$getAccelerationInfo(null, NaN)`.

In the repository (AccelerationRepository.ts:102-159) `NaN == null` is false, so the early return is skipped; `height != null` is true, so `WHERE accelerations.height = ?` is appended and NaN is pushed as a bound parameter. `DB.query` (database.ts:37-78) calls `pool.query(sql, params)` on mysql2/promise, i.e. client-side interpolation. Dependency assumption: mysql2 3.24.2 formats parameters with sql-escaper 1.5.1 (both pinned in backend/package-lock.json), whose number case emits `val + ''`, so the statement becomes `accelerations.height = NaN`; MariaDB rejects `NaN` as an unknown column and the promise rejects. The repository's catch block logs and re-throws. Because the handler has no try/catch, no Express error middleware is registered anywhere in the backend, and Express 4.22.1 (lockfile) does not forward a handler's rejected promise to `next()`, the rejection surfaces as a Node `unhandledRejection`; index.ts:121-124 routes that to `forceExit('unhandledRejection', 1)` → `process.exit()` (index.ts:444-450). SPAWN_CLUSTER_PROCS defaults to 0, so nothing respawns in-process.

Result: one unauthenticated GET terminates the whole backend process for that network (REST API, WebSocket fan-out, mempool projection, indexing). An external supervisor may restart it, but the attacker repeats the request after every restart, and each restart replays mempool loading and cache warm-up. Because the repository re-throws on any DB error, a DB timeout or outage on this route crashes the process the same way, but the NaN path lets a remote client trigger it deterministically.

Reachability through the shipped proxies: the Docker frontend's nginx-mempool.conf:61-63 sends `/api/v1/services*` to https://mempool.space, which shadows the backend copy under that exact prefix, but nginx-mempool.conf:67-69 (`location /api/ { proxy_pass http://127.0.0.1:8999/api/v1/; }`) rewrites `/api/<x>` to the backend's `/api/v1/<x>`, so `GET /api/services/accelerator/accelerations/history?blockHeight=abc` reaches the vulnerable route on any Docker deployment with ACCELERATIONS enabled, without port 8999 being exposed. The repo's production/nginx fleet config routes `/api/v1/services/` to the mempool.space services upstream and `/api/` to esplora, so on that config the backend copy is reached only directly on the backend listener; the repository does not settle how mempool.space's origin routes this documented public endpoint (api-docs-data.ts:12273 lists `/v1/services/accelerator/accelerations/history` with a `blockHeight` filter). The finding therefore holds for every deployment with `MEMPOOL_SERVICES.ACCELERATIONS=true` whose backend route is reachable, which includes the shipped Docker proxy path.

The sibling route `/accelerations/block/:height` in mining-routes.ts:422-436 makes the identical call but wraps it in try/catch and returns a 500, confirming the services-route omission is the defect.

## Evidence
1. [backend/src/api/acceleration/acceleration.routes.ts:44–57](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/acceleration/acceleration.routes.ts#L44-L57)
   $getAcceleratorAccelerationsHistory is an async Express 4 handler (annotated @asyncUnsafe, i.e. rejections are allowed to bubble) with no try/catch. req.query.blockHeight is truthy-checked and then parseInt'd, so any non-numeric value ('abc', 'Infinity', 'blockHeight[]=x') becomes NaN and is passed as height to AccelerationRepository.$getAccelerationInfo(null, NaN). Any rejection of that await escapes the handler; Express 4 ignores the returned promise. This is the location the fix must change.
2. [backend/src/repositories/AccelerationRepository.ts:102–159](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/repositories/AccelerationRepository.ts#L102-L159)
   The early-return guard at :102 tests `height == null`, which NaN passes; :118-124 appends `WHERE accelerations.height = ?` and pushes NaN as a bound parameter; :136-159 awaits DB.query and, on any error, logs and re-throws (`throw e`). Assumption on mysql2 3.24.2 + sql-escaper 1.5.1 (lockfile): query() formats parameters client-side and a JS number is emitted as `val + ''`, so the SQL becomes `height = NaN`, which MariaDB rejects as an unknown column; the promise rejects and the rejection propagates to the route handler.
3. [backend/src/index.ts:121–124](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L121-L124)
   process.on('unhandledRejection', ...) calls this.forceExit('unhandledRejection', 1). No Express error middleware is registered anywhere in the backend and Express 4.22.1 (lockfile) does not forward a route handler's rejected promise to next(), so the escaped rejection reaches this hook.
4. [backend/src/index.ts:444–450](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L444-L450)
   forceExit sets process.exitCode and calls process.exit(): the whole backend process (HTTP API, WebSocket fan-out, mempool projection, indexing) terminates. SPAWN_CLUSTER_PROCS defaults to 0 (config.ts:186, production mainnet config, Docker start.sh), so there is no in-process worker respawn.
5. [nginx-mempool.conf:61–69](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/nginx-mempool.conf#L61-L69)
   The shipped Docker nginx sends /api/v1/services* to https://mempool.space (shadowing the backend copy under that path), but `location /api/ { proxy_pass http://127.0.0.1:8999/api/v1/; }` rewrites /api/<x> to the backend's /api/v1/<x>, so GET /api/services/accelerator/accelerations/history?blockHeight=abc reaches the vulnerable backend route through the shipped proxy without exposing port 8999.
6. [backend/src/index.ts:403–405](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L403-L405)
   accelerationRoutes.initRoutes(app) runs whenever config.MEMPOOL_SERVICES.ACCELERATIONS is true. The flag defaults to false (config.ts:328, Docker start.sh:152) but production/mempool-config.mainnet.json:194 ships ACCELERATIONS: true, so the route is live on mempool.space-style deployments and on any self-hoster who enables the accelerator feature.
7. [backend/src/database.ts:37–77](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/database.ts#L37-L77)
   DB.query delegates to pool.query(query, params) on mysql2/promise (client-side parameter interpolation, not a prepared statement) and rejects the returned promise on any driver error, which the repository re-throws.
8. [backend/src/api/mining/mining-routes.ts:422–435](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mining/mining-routes.ts#L422-L435)
   Sibling route /accelerations/block/:height makes the identical $getAccelerationInfo(null, parseInt(...)) call but wraps it in try/catch and answers 500, showing the maintainers expect this call to reject and that the services route omitted the guard.

## Impact
The whole Node backend process for the network exits (SPAWN_CLUSTER_PROCS defaults to 0, so no in-process respawn): REST API, WebSocket clients, mempool/block projection and indexing all stop until an external supervisor restarts it, and the attacker can repeat the request after each restart, including during cache warm-up. No data is disclosed or modified.

## Reproduction steps
1. An anonymous network client sends one GET (e.g. /api/services/accelerator/accelerations/history?blockHeight=abc through the shipped Docker nginx, or /api/v1/services/accelerator/accelerations/history?blockHeight=abc on the backend listener). parseInt yields NaN, the repository binds it, MariaDB errors, the un-guarded async handler lets the rejection escape, and the process-wide unhandledRejection hook calls process.exit(). No authentication, no race, no user interaction, no special timing. The attack requirement is a deployment condition: MEMPOOL_SERVICES.ACCELERATIONS must be enabled (true in the shipped production mainnet config, false by default elsewhere) and the backend's copy of the route must be reachable (it is through the Docker proxy's /api/ alias).

## Recommended fix
1. The async route handler $getAcceleratorAccelerationsHistory lets a rejected promise escape; under Express 4 with a process-wide unhandledRejection -> exit hook, any repository error becomes a process crash. Fix criteria: Every async handler in acceleration.routes.ts must catch errors and answer with an HTTP error (as the mining-routes siblings do), or a process-wide async wrapper/error middleware must route handler rejections to an HTTP 500. Verify: requesting ?blockHeight=abc (and simulating a DB failure on this query) returns an error response and the process keeps running.
2. req.query.blockHeight is converted with parseInt and used without checking the result is a finite non-negative integer, so NaN reaches the SQL layer. Fix criteria: Reject non-numeric or non-finite blockHeight values with HTTP 400 before any repository call; $getAccelerationInfo should treat a non-finite height as invalid rather than binding it. Verify: ?blockHeight=abc, ?blockHeight[]=1 and ?blockHeight=Infinity return 400 and issue no SQL query.

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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257949

---

# Operator-precedence bug in taproot inscription heuristic crashes classification of standard 2-item-witness inputs

## Details
Common.inputIsMaybeInscription (backend/src/api/common.ts:565-608) is a heuristic Common.getTransactionFlags uses to decide whether a witness-bearing input without prevout data might be a taproot inscription. Its final test mixes `&&` and `||` without parentheses (common.ts:599-603):

```
if (!isTaproot
  && vin.witness.length >= 3
  && vin.witness[0].length === 128 || vin.witness[0].length === 130
  && (vin.witness[2].length - 66) % 64 === 0
)
```

JavaScript parses this as `(!isTaproot && len >= 3 && w[0].length === 128) || (w[0].length === 130 && (w[2].length - 66) % 64 === 0)`, so the `len >= 3` guard covers only the left disjunct. For an input whose witness has exactly two items and whose first item is 65 bytes (130 hex chars), the right disjunct dereferences `vin.witness[2]`, which is `undefined`, and throws `TypeError: Cannot read properties of undefined (reading 'length')`.

Anyone who can relay a transaction to the operator's node controls this: a standard P2WSH spend with witness `[<65 arbitrary bytes>, <witnessScript e.g. OP_DROP OP_1>]` (stack items <= 80 bytes, script <= 3600 bytes) satisfies it, as does a taproot script-path spend whose leaf script is 65 bytes with no signature on the stack (`[<65-byte script>, <control block>]`). The attacker can also push it through the instance's own `POST /api/tx`.

The heuristic runs only when `vin.prevout` is null (common.ts:668-678), which is the normal state of every mempool transaction when MEMPOOL.BACKEND is `none` (the config.ts default) or `electrum` (the Docker default in docker/backend/start.sh): bitcoin-api.ts $convertTransaction sets `prevout: null` (electrum-api.ts `BitcoindElectrsApi extends BitcoinApi`) and mempool.ts:299 fetches with addPrevouts=false. The call at common.ts:670 is outside the try/catch that protects only `isInscription`. With the `esplora` backend prevouts are present and this branch is not reached.

Consequences by call site:
1. Common.classifyTransaction (mempool-blocks.ts:679, blocks.ts:237) catches the error and records `flags = 0`; because getTransactionFlags re-runs full classification whenever `tx.flags` is falsy (common.ts:628), the tx is re-classified and re-throws on every projection update, and is persisted to the disk/Redis cache with flags 0. Minor on its own.
2. Mempool.$setMempool (mempool.ts:152) calls getTransactionFlags directly, with no try/catch, while restoring the cached mempool at startup. The cached copy of the crafted tx has falsy `flags`, so it is fully re-processed and throws.
   - Redis cache mode (MEMPOOL.CACHE_ENABLED=false, REDIS.ENABLED=true — a shipped option in mempool-config.sample.json and docker/backend/start.sh, and the layout production/mempool-config.mainnet.json uses): redis-cache.ts:438 and index.ts:193 have no try/catch; `startServer` is invoked with `void` (index.ts:77/101), so the rejection reaches the `unhandledRejection` handler at index.ts:121-124 and the backend exits with code 1 during startup. On the next restart the tx is still in Core's mempool (and therefore still loaded by `$getMempool(validTxids)`), so a Core/electrum-backed instance in this mode crash-loops for as long as the transaction remains unconfirmed (up to Core's mempool expiry, default 14 days, or indefinitely if rebroadcast).
   - Disk cache mode (the default): disk-cache.ts:236 catches the error, but `this.mempoolCache` was already assigned (mempool.ts:132) and the loop aborted, so remaining txs are not re-flagged, `cpfpChecked` is not reset, `addToSpendMap` (mempool.ts:170) never runs and `blocks.setBlocks` is skipped. Afterwards only newly arriving txs enter the spendMap (websocket-handler.ts:686 `addToSpendMap(newTransactions)`), so the instance serves with no spendMap entries for the entire restored mempool, which breaks RBF detection (Common.findMinedRbfTransactions via blocks.ts:515, rbf-cache load) and CPFP relative discovery (cpfp.ts:263-266) for those transactions until they confirm or are evicted.

bitcoin-api.ts:443 ($addPrevouts) also calls getTransactionFlags directly, but prevouts are present on that path, so the faulty branch is not reached there; blocks.ts:1774 wraps its direct call in try/catch.

The unit tests for Common cover isNonStandard, findRbfTransactions and calcEffectiveFeeStatistics only; none exercises getTransactionFlags on prevout-less inputs.

## Evidence
1. [backend/src/api/common.ts:599–605](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/common.ts#L599-L605)
   The condition is written `!isTaproot && len >= 3 && w[0].length === 128 || w[0].length === 130 && (w[2].length - 66) % 64 === 0`. Because `&&` binds tighter than `||`, the `len >= 3` guard applies only to the left disjunct; the right disjunct evaluates `vin.witness[2].length` whenever the first witness item is 65 bytes (130 hex chars), even when the witness has exactly 2 items. `vin.witness[2]` is then `undefined` and the property access throws a TypeError. This is the line the fix must change.
2. [backend/src/api/common.ts:668–678](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/common.ts#L668-L678)
   In getTransactionFlags, when the input has no prevout (`vin.prevout?.scriptpubkey_type` falsy), `inputIsMaybeInscription(vin)` is called on line 670 for any witness with >= 2 items. Only the subsequent `isInscription` call is inside the try/catch; the heuristic call itself is unprotected, so the TypeError propagates out of getTransactionFlags.
3. [backend/src/api/bitcoin/bitcoin-api.ts:346–358](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin-api.ts#L346-L358)
   With a Bitcoin Core (`none`) or electrum backend (electrum-api.ts `BitcoindElectrsApi extends BitcoinApi`), $convertTransaction builds every vin with `prevout: null` and `witness: vin.txinwitness`. mempool.ts:299 fetches mempool txs with addPrevouts=false, so every mempool tx on these backends takes the no-prevout branch above.
4. [backend/src/api/mempool.ts:131–170](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mempool.ts#L131-L170)
   $setMempool assigns `this.mempoolCache = mempoolData` first (line 132) and then calls `Common.getTransactionFlags(this.mempoolCache[txid])` directly (line 152) with no try/catch while restoring the cached mempool at startup. The exception aborts the loop before the change callbacks and `addToSpendMap` (line 170) run.
5. [backend/src/api/redis-cache.ts:416–445](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/redis-cache.ts#L416-L445)
   $loadCache loads the cached mempool filtered to txids still in Core's mempool and awaits memPool.$setMempool(loadedMempool) (line 438) without a try/catch, so the TypeError propagates to the caller.
6. [backend/src/index.ts:117–123](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L117-L123)
   unhandledRejection and uncaughtException handlers call forceExit → process.exit(1). startServer (invoked as `void this.startServer()`) awaits redisCache.$loadCache at line 193 with no try/catch, so in Redis cache mode the TypeError becomes an unhandled rejection and terminates the backend during startup; the same tx is reloaded on the next start.
7. [backend/src/api/disk-cache.ts:226–237](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/disk-cache.ts#L226-L237)
   In the default disk-cache configuration the exception from $setMempool is caught here and logged as a cache-parse failure, but by then `this.mempoolCache` has already been assigned and the per-tx initialisation, spendMap population and `blocks.setBlocks` are skipped, leaving the running instance with an incompletely initialised mempool.
8. [backend/src/api/websocket-handler.ts:685–686](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L685-L686)
   After startup, the only other spendMap population is `memPool.addToSpendMap(newTransactions)` in the mempool-changed handler, which receives only newly fetched txs; the restored txs skipped by the aborted $setMempool loop therefore never enter the spendMap used by findMinedRbfTransactions (blocks.ts:515) and cpfp.ts:263-266.
9. [backend/src/api/common.ts:779–790](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/common.ts#L779-L790)
   classifyTransaction catches the exception and stores `flags = 0` on the tx. Because getTransactionFlags re-runs full classification whenever `tx.flags` is falsy (line 628), the faulty tx is re-classified (and re-throws) on every call, and is persisted to the disk/Redis cache with flags 0, which is what makes $setMempool hit the bug on restart.

## Impact
Availability: on a Core/electrum-backed instance using the shipped Redis cache mode the backend cannot start while the tx sits in the node's mempool (persistent crash loop, up to 14 days or indefinitely if rebroadcast) — High. Integrity: in the default disk-cache mode the restored mempool has no spendMap entries and stale CPFP state, so RBF replacement and CPFP data served by the API/WebSocket are wrong for all cached transactions until they leave the mempool — Low. No confidentiality impact.

## Reproduction steps
1. The attacker broadcasts (via the P2P network or the instance's own POST /api/tx) a standard P2WSH or taproot script-path transaction whose input has a 2-item witness with a 65-byte first item. On an instance with MEMPOOL.BACKEND `none` or `electrum` (config.ts and Docker defaults respectively) the tx is stored without prevouts and every classification of it throws. The crash requires the backend to (re)start while the tx is unconfirmed — a deployment event the attacker does not control but that recurs (upgrades, Docker restarts, crashes from other causes) — and the full startup crash loop requires the shipped Redis cache mode; the default disk-cache mode yields a half-initialised mempool instead. No privileges or user interaction are needed.

## Recommended fix
1. inputIsMaybeInscription indexes vin.witness[2] without guaranteeing the witness has three items because the `len >= 3` guard is not applied to the `|| w[0].length === 130 && …` disjunct (operator precedence). Fix criteria: The heuristic must never index beyond the witness array for any witness length >= 2; for a two-item witness whose first item is 65 bytes it must return a boolean without throwing. Verify with a unit test feeding getTransactionFlags a prevout-less input with witness ['aa'.repeat(65), '7551'].
2. Common.getTransactionFlags is invoked directly (mempool.ts:152, bitcoin-api.ts:443) on attacker-controlled transaction content without error containment, and the startup chain redis-cache.$loadCache → index.startServer has no try/catch, so any classification exception terminates the process via the unhandledRejection handler. Fix criteria: A failure to classify a single transaction must not abort mempool restoration or startup: per-transaction classification errors are caught and logged, the remaining transactions are still initialised (spendMap, cpfp reset, blocks), and the process keeps running. Verify by restoring a cache containing a transaction whose classification throws and confirming the backend starts and serves RBF/CPFP data for the other transactions.

---
**Severity:** HIGH
**Status:** Open
**Category:** Operator precedence logic error
**CWE:** [CWE-783](https://cwe.mitre.org/data/definitions/783.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257948

---

# SQL injection: remotely fetched pools-v2.json git sha interpolated into state-table INSERT

## Details
The mining-pool definition updater (backend/src/tasks/pools-updater.ts) fetches a GitHub git-tree JSON document from the operator-configured MEMPOOL.POOLS_JSON_TREE_URL (default https://api.github.com/repos/mempool/mining-pools/git/trees/master), takes `tree[].sha` of the `pools-v2.json` entry without any format validation, and in `updateDBSha()` splices it straight into SQL:

    INSERT INTO state VALUES('pools_json_sha', NULL, '${githubSha}')

The call passes no parameter array, so mysql2 transmits the string verbatim. Every neighbouring write of the same value is parameterised (the rollback UPDATE on line 113, BlocksRepository definition_hash writes, pools-parser), so this is the one place where the provider's bytes alter query grammar.

Who controls the value: the HTTP provider behind POOLS_JSON_TREE_URL — api.github.com by default (TLS-protected, so a passive network MITM cannot substitute it), or whatever mirror/forge the operator configured (the docker README and mempool-config.sample.json present the URL as a free setting). The threat model lists remote data providers, GitHub among them, as second-order adversaries. The pools-v2.json authors cannot influence the sha (it is git's blob id), so this is a provider-trust defect, not a repo-content one.

Reachability: `updatePoolsJson()` runs at startup (index.ts:171) and every 10 s from `$startService()`, gated by POOLS_UPDATE_DELAY. On a first-ever run (currentSha null) the import proceeds regardless of AUTOMATIC_POOLS_UPDATE; with AUTOMATIC_POOLS_UPDATE true (Docker start.sh default; mempool.space production configs with a 1 h delay) it proceeds on every cycle whose sha differs. Requires DATABASE.ENABLED (Docker default true) and a Bitcoin network.

What the provider gains beyond the pool definitions it is already allowed to supply: the pool is created without multipleStatements (database.ts), so stacked statements are out, but MariaDB multi-row VALUES, scalar subqueries and ON DUPLICATE KEY UPDATE are available inside the one INSERT. Because `state.name` is UNIQUE and the pools_json_sha row was deleted just before, a sha such as `x'),('schema_version',4,NULL) ON DUPLICATE KEY UPDATE number=VALUES(number)-- ` commits a rewrite of any `state` row. Setting schema_version to 3 or 4 makes the next backend start run DROP TABLE blocks / TRUNCATE blocks in database-migration.ts:121-130 (loss of the indexed block dataset), after which the ALTER TABLE ADD `reward` fails on the existing column and the migration driver calls process.exit(-1) (lines 78-84) — a crash loop on every restart until the operator repairs `state` manually. Other rows (last_bitcoin_block_audit, last_bitcoin_block_scanned, last_elements_block, last_acceleration_block, hashrate run markers) are indexer resume points, so they can be rewound or skipped. With `ON DUPLICATE KEY UPDATE string=(SELECT ...)` the stored pools_json_sha becomes any <=100-char scalar (e.g. @@hostname, @@version, user()) and is served verbatim by the always-registered GET internal/blocks/definition/current route (bitcoin.routes.ts:954-967), which the Docker nginx config does not block.

A related secondary sink exists: database-migration.ts:1127-1131 and 1144-1148 read pools_json_sha back from `state` and interpolate it into ALTER TABLE ... DEFAULT "..." DDL, but only while migrating a database still below schema version 95/97; validating the sha format fixes both.

## Evidence
1. [backend/src/tasks/pools-updater.ts:148](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/tasks/pools-updater.ts#L148)
   Primary sink. updateDBSha() runs DB.query(`INSERT INTO state VALUES('pools_json_sha', NULL, '${githubSha}')`, undefined, ...) — githubSha is spliced into the SQL text and no params array is passed, so mysql2 sends the string verbatim. The sibling DELETE on line 147 is a constant and the rollback UPDATE on line 113 binds githubSha with '?', so this is the one unparameterised write of the fetched value.
2. [backend/src/tasks/pools-updater.ts:173–186](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/tasks/pools-updater.ts#L173-L186)
   Source. fetchPoolsSha() GETs config.MEMPOOL.POOLS_JSON_TREE_URL (default https://api.github.com/repos/mempool/mining-pools/git/trees/master), iterates response['tree'] and returns file['sha'] for the 'pools-v2.json' entry with no check that it is 40 hex characters. The value is whatever the HTTP provider returns; the pools-v2.json authors cannot influence it (git blob id), only the provider can.
3. [backend/src/tasks/pools-updater.ts:61–117](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/tasks/pools-updater.ts#L61-L117)
   Reachability. The fetched sha is compared to the DB value and, when different, imported. The AUTOMATIC_POOLS_UPDATE gate (lines 72-79) only applies when currentSha !== null, so a first-ever run (fresh install, or after a migration that NULLs pools_json_sha) always proceeds; with AUTOMATIC_POOLS_UPDATE true (Docker start.sh default, mempool.space production configs) every POOLS_UPDATE_DELAY cycle proceeds. updateDBSha runs at line 103 inside a transaction on a dedicated connection with the backend's DB credentials; updatePoolsJson is called from index.ts:171 at startup and from $startService every 10 s.
4. [backend/src/database.ts:17–27](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/database.ts#L17-L27)
   The mysql2 (~3.24.2) pool is created without multipleStatements, so stacked statements are not available; the attacker reshapes this single INSERT. MariaDB's multi-row VALUES, scalar subqueries in VALUES and ON DUPLICATE KEY UPDATE remain available, which is enough to insert or overwrite any row of `state`.
5. [backend/src/api/database-migration.ts:1348–1355](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/database-migration.ts#L1348-L1355)
   `state` is name varchar / number int / string varchar(100) with UNIQUE(name). Because of the unique key, a payload such as sha = "x'),('schema_version',4,NULL) ON DUPLICATE KEY UPDATE number=VALUES(number)-- " overwrites the existing schema_version row (the pools_json_sha row was just deleted on line 147 so the first tuple does not conflict). The same table holds last_bitcoin_block_audit, last_bitcoin_block_scanned, last_elements_block, last_acceleration_block and hashrate-indexing run markers consumed as indexer resume points.
6. [backend/src/api/database-migration.ts:121–130](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/database-migration.ts#L121-L130)
   Consequence of a lowered schema_version. $initializeOrMigrateDatabase() runs at every backend start (index.ts:138) and reads schema_version from `state`. With it set to 3 or 4, $createMissingTablesAndIndexes executes DROP TABLE blocks / TRUNCATE blocks, destroying the indexed block dataset; the following ALTER TABLE blocks ADD `reward` then fails on the existing column, the catch at lines 78-84 calls process.exit(-1), and the sequence repeats on every restart until the operator repairs `state` by hand.
7. [backend/src/api/bitcoin/bitcoin.routes.ts:954–966](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L954-L966)
   Exfiltration channel. GET <prefix>internal/blocks/definition/current (registered unconditionally at line 73) returns state.string for pools_json_sha verbatim as text/plain. A payload using ON DUPLICATE KEY UPDATE string=(SELECT @@hostname) (or any <=100-char scalar from another table) makes that value publicly readable on deployments whose nginx does not block /api/v1/internal (the Docker nginx-mempool.conf has no such block; mempool.space's production nginx gates it to loopback).

## Impact
Integrity HIGH: via ON DUPLICATE KEY UPDATE any `state` row can be rewritten, and rewriting schema_version to 3/4 causes database-migration.ts:121-130 to DROP/TRUNCATE the blocks table at the next start, destroying the indexed dataset; indexer resume pointers can likewise be rewound. Availability HIGH: the same lowered schema_version makes the subsequent ALTER TABLE fail and the migration driver process.exit(-1) on every restart (lines 78-84) until an operator hand-edits the database; the attacker can also make the INSERT fail so pool updates never apply. Confidentiality LOW: a scalar subquery stored into pools_json_sha is served verbatim by the unauthenticated internal/blocks/definition/current route (not blocked by the Docker nginx config), exposing DB metadata such as @@hostname/@@version/user() or any <=100-char value from the mempool database, which otherwise holds public chain-derived data. Stacked statements are unavailable (no multipleStatements).

## Reproduction steps
1. The attacker must author the HTTP response for POOLS_JSON_TREE_URL: a compromised GitHub API, a mirror/forge the operator configured, or a TLS-breaking proxy in the fetch path — a deployment condition outside the attacker's control (AT:PRESENT) that the threat model nonetheless names as an in-scope second-order adversary. No privileges on the mempool instance and no user interaction are needed; once positioned, the payload is a single JSON field and executes deterministically on the next update (immediately on first start, every POOLS_UPDATE_DELAY with AUTOMATIC_POOLS_UPDATE, or on --update-pools). Assumes mysql2 ~3.24.2 sends query(sql, undefined) verbatim and MariaDB accepts multi-row VALUES with ON DUPLICATE KEY UPDATE and scalar subqueries (standard syntax).

## Recommended fix
1. updateDBSha() concatenates a value obtained from a remote HTTP response into the SQL text of the state-table INSERT instead of binding it, so provider bytes alter the statement's grammar. Fix criteria: The INSERT into state passes githubSha as a bound parameter (as the rollback UPDATE on line 113 already does); a tree response whose sha contains quotes, parentheses, comment markers or ON DUPLICATE KEY UPDATE text results in that literal string being stored or the update being rejected, never in additional or rewritten state rows or a syntax error.
2. fetchPoolsSha() accepts any string from the tree JSON as a git object id, so malformed provider data propagates into the state table, into blocks.definition_hash, and into the migration DDL that later interpolates the stored sha. Fix criteria: The extracted sha is validated as exactly 40 lowercase hex characters before any use and anything else is treated as a failed fetch; a tree document with a non-hex sha causes the updater to log an error and perform no database writes.

---
**Severity:** HIGH
**Status:** Open
**Category:** SQL injection
**CWE:** [CWE-89](https://cwe.mitre.org/data/definitions/89.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257946

---

# POST /psbt/addparents fetches and retains one parent tx per PSBT input with no input cap

## Details
The public endpoint POST /api/v1/psbt/addparents (bitcoin.routes.ts postPsbtCompletion, lines 361-418) parses an attacker-supplied PSBT from the text/plain or application/base64 body (bounded only by the 10mb express.text limit at index.ts:153 and nginx client_max_body_size 10m) and, for every input lacking a nonWitnessUtxo, awaits bitcoinApi.$getTransactionHex(txid) and attaches the full parent transaction via psbt.updateInput (lines 379-404). Nothing bounds the number of inputs, de-duplicates inputs that spend the same parent txid, or bounds the size of each parent fetched and retained. Sibling handlers in the same file do cap per-request fan-out (50 txids for outspends at line 236, MAX_TRANSACTION_TIMES=100 at line 213, 100 outpoints for /prevouts at line 1255), so the missing cap here is an omission, not a design choice.

Attack: an anonymous client crafts a PSBT whose unsigned transaction has N inputs (~41 bytes each plus a 1-byte empty input map), all referencing one real, very large transaction as the prevout txid with distinct vout indices 0..N-1 (bitcoinjs-lib's checkTxForDupeIns rejects only identical hash:index pairs; the vout need not exist, since the handler never validates the outpoint against the parent). A 10mb body allows roughly 200k inputs; a few thousand suffice. For each input the backend serially:
1. issues an upstream call — on the 'none' and 'electrum' backends a verbose `getrawtransaction <txid> true` to the operator's Bitcoin Core (bitcoin-api.ts:93-95; txindex=1 is what backend/README.md:33, docker/README.md:21 and production/bitcoin.conf instruct, so arbitrary confirmed parents resolve), on esplora a GET /tx/:txid/hex (esplora-api.ts:478-480) — decoding a multi-MB JSON/hex response each time; and
2. calls psbt.updateInput with a fresh Buffer.from(hex,'hex') of the parent, which bitcoinjs-lib stores in the input map and in its per-input non-witness-utxo cache alongside a parsed Transaction, so every copy stays alive until the request finishes.

With a ~4MB parent (multi-MB inscription transactions exist on mainnet), 1,000 inputs (a ~42KB request body) retain ~4GB of Buffers in the single Node process per network; the final psbt.toHex()/toBase64() at line 406 roughly doubles the peak. The process exhausts memory and aborts, taking down the REST API and WebSocket for that network — fatal on node-distro hardware (Umbrel, RaspiBlitz). Even with smaller parents, one HTTP request drives thousands of serial multi-MB RPC decodes against the operator's Core node; nginx closing the client connection after proxy_read_timeout does not stop the backend loop. This is per-request amplification set by attacker input, which the threat model places in scope, not request-volume load.

Dependency assumption (bitcoinjs-lib ~6.1.3 per backend/package.json, node_modules not inspected): Psbt.fromBase64/fromHex accept inputs with empty key-value maps, Psbt.fromBuffer only rejects duplicate hash:index outpoints, and Psbt.updateInput({nonWitnessUtxo}) retains the Buffer and a parsed Transaction per input in psbt.data.inputs and its __CACHE. Even if retention were weaker than assumed, the unbounded serial upstream fan-out alone stands on the code as written.

## Evidence
1. [backend/src/api/bitcoin/bitcoin.routes.ts:379–403](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L379-L403)
   For every PSBT input lacking nonWitnessUtxo the handler awaits bitcoinApi.$getTransactionHex(txid) and then psbt.updateInput(index, { nonWitnessUtxo: Buffer.from(hex,'hex') }). There is no limit on psbt.data.inputs.length, no de-duplication of inputs sharing a parent txid, no validation that the outpoint exists in the parent, and no cap on the size of the fetched parent, so serial upstream calls and retained memory both scale linearly with the attacker-chosen input count times parent size. This is the code the fix must change.
2. [backend/src/api/bitcoin/bitcoin.routes.ts:361–377](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L361-L377)
   The PSBT is parsed directly from req.body with bitcoinjs Psbt.fromBase64/fromHex; the only size bound is the global 10mb body limit, enough for ~200k ~42-byte inputs.
3. [backend/src/api/bitcoin/bitcoin.routes.ts:61](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L61)
   The route is registered unconditionally in initRoutes for every backend type and network, with no authentication.
4. [backend/src/api/bitcoin/bitcoin-api.ts:87–96](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin-api.ts#L87-L96)
   On the 'none' and 'electrum' backends each call is a verbose getrawtransaction RPC against the operator's Bitcoin Core that decodes the whole parent transaction JSON (esplora-api.ts:478 issues GET /tx/:txid/hex instead). One HTTP request fans out to N serial upstream calls.
5. [backend/src/api/bitcoin/bitcoin.routes.ts:1255–1257](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L1255-L1257)
   The sibling POST /prevouts handler rejects more than 100 outpoints per request (as do outspends at line 236 and transaction-times at line 213), showing the project's intended per-request fan-out bound that postPsbtCompletion lacks.
6. [backend/src/index.ts:152–154](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L152-L154)
   express.text accepts up to 10mb for text/plain and application/base64 (matching nginx client_max_body_size 10m in http-basic.conf), which bounds the PSBT only loosely; no auth middleware is applied.

## Impact
A single ~42KB request can drive the Node backend (one process per network serving REST and WebSocket) to out-of-memory abort by retaining N copies of a multi-MB parent transaction, or tie it up for minutes with thousands of serial upstream calls. No confidentiality or integrity impact. Subsequent-system impact: Each input produces a verbose getrawtransaction RPC (or esplora GET) against the operator's Bitcoin Core / electrs instance, so one HTTP request imposes thousands of multi-MB decode operations on that node, occupying its RPC worker threads and degrading it for the operator's other consumers (wallet, indexers, Lightning node).

## Reproduction steps
1. Any Internet client POSTs a crafted base64/hex PSBT to /api/v1/psbt/addparents through nginx; the route is registered unconditionally (bitcoin.routes.ts:61), the backend has no authentication, and no shipped nginx config applies limit_req. The attacker picks one real large txid as the prevout for thousands of inputs with distinct vout indices; the handler fetches and retains the parent once per input until memory is exhausted or the RPC node is tied up. Deterministic, single request, no preconditions beyond the documented default deployment (txindex=1 for the Core-backed modes).

## Recommended fix
1. postPsbtCompletion iterates psbt.data.inputs without any cap on input count, so attacker-controlled input count directly sets the number of upstream fetches and retained buffers. Fix criteria: A request whose PSBT has more inputs than a small fixed maximum (or more than a maximum number of distinct missing parents) is rejected before any upstream call; verify that a PSBT with thousands of inputs returns 4xx immediately with no RPC traffic.
2. Parent transactions are fetched and copied once per input even when many inputs share the same prevout txid, and no bound is placed on the aggregate size of fetched parents. Fix criteria: Parent transactions are fetched at most once per distinct txid and the total bytes attached to the PSBT are bounded (reject or truncate when exceeded); verify peak memory for a worst-case PSBT stays within a small constant multiple of the request size.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncontrolled resource consumption
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
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257945

---

# Electrum UTXO lookup issues two Core RPC calls per UTXO with no bound

## Details
When the backend runs with MEMPOOL.BACKEND = "electrum" (the shipped default of the Docker image, docker/backend/start.sh:5, and the configuration the backend and Docker READMEs give for romanz/electrs or Fulcrum, i.e. node distros such as Umbrel, RaspiBlitz, StartOS), the anonymous routes GET /api/v1/address/:address/utxo and GET /api/v1/scripthash/:scripthash/utxo (registered at bitcoin.routes.ts:104,108) are served by BitcoindElectrsApi.$getScriptHashUtxos (backend/src/api/bitcoin/electrum-api.ts:197-229). The handlers validate the parameter only with a syntactic regex.

$getScriptHashUtxos asks the electrum server for the complete unspent list of the scripthash (blockchain.scripthash.listunspent) and then, for every confirmed UTXO, sequentially awaits two Bitcoin Core RPC calls: getblockhash(height) and getblock(hash). BitcoinApi.$getBlock (bitcoin-api.ts:146-154) only short-circuits for the blocks held in memory (at most INITIAL_BLOCKS_AMOUNT*4 = 32 recent blocks, blocks.ts:1532-1533); for any older block it issues getblock with default verbosity 1, whose response carries the full txid list of the block (hundreds of KB of JSON for a full block), even though convertBlock (bitcoin-api.ts:20-35) consumes only header fields and the loop uses only block.timestamp. There is no cap on the number of UTXOs processed, no deduplication of blocks already fetched during the same request, and no cache of block timestamps. Each RPC call opens a fresh TCP connection and buffers the entire body as a string (rpc-api/jsonrpc.ts:40-50, agent:false); the 30 s per-call timeout bounds one call, not their count. The Express handler never checks for client disconnect, so the loop runs to completion after the client (or nginx, on proxy_read_timeout) has gone away.

An anonymous client therefore turns one HTTP request naming an existing mainnet address with a large UTXO set (burn addresses, dust-attack targets and exchange hot wallets with thousands to tens of thousands of unspent outputs are public knowledge; no on-chain spend by the attacker is needed) into thousands of sequential Core RPC calls, each transferring and JSON.parse'ing a block-sized document on the Node main thread. A handful of such requests fired concurrently and abandoned keep that many Core RPC workers busy for minutes; once Core's HTTP work queue (rpcworkqueue, default 16) is full, the backend's own polling (getrawmempool, getblock, getblockchaininfo) fails with 'Work queue depth exceeded', runMainUpdateLoop backs off and after five failures marks the mempool out of sync (index.ts:309-320), so the explorer stops updating for as long as the requests run. The shipped Docker nginx config (nginx-mempool.conf) applies no cache and no rate limit to /api/, and per-IP rate limiting would in any case not address a per-request amplification.

Contrast with the project's own bounds on sibling paths: $getScriptHashTransactions caps each page at 10 transactions (electrum-api.ts:180), MAX_BLOCKS_BULK_QUERY defaults to 0 (disabled), and the esplora backend delegates the UTXO list to esplora, which enforces its own utxo limit.

Assumptions on dependencies: @mempool/electrum-client 1.1.9 is assumed to impose no response-size limit on listunspent; romanz/electrs is assumed to ship without a default index lookup limit and Fulcrum to allow very large histories, while ElectrumX caps responses at ~1 MB (~8k UTXOs) — any of these returns enough UTXOs to trigger the behaviour.

## Evidence
1. [backend/src/api/bitcoin/electrum-api.ts:197–229](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/electrum-api.ts#L197-L229)
   $getScriptHashUtxos iterates every UTXO returned by the electrum server and, for each confirmed one, sequentially awaits $getBlockHash(height) and $getBlock(blockHash) — two Core RPC round trips per UTXO — with no cap on the UTXO count, no per-block memoization within the request, and no client-disconnect check; only block.timestamp is used from the fetched block.
2. [backend/src/api/bitcoin/bitcoin-api.ts:146–154](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin-api.ts#L146-L154)
   $getBlock only hits the in-memory blocks array (at most INITIAL_BLOCKS_AMOUNT*4 = 32 recent blocks); for any older block it calls bitcoind getblock with default verbosity 1, returning the full txid list (hundreds of KB of JSON) that is transferred and JSON.parse'd per UTXO although convertBlock (lines 20-35) uses only header fields.
3. [backend/src/api/bitcoin/electrum-api.ts:150–156](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/electrum-api.ts#L150-L156)
   $getAddressUtxos validates the address via Core validateaddress, then unconditionally delegates to $getScriptHashUtxos.
4. [backend/src/api/bitcoin/bitcoin.routes.ts:788–811](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L788-L811)
   Anonymous entry point GET /api/v1/address/:address/utxo (registered at line 104); the only gate is a 405 when BACKEND is 'none' and a syntactic ADDRESS_REGEX test. Nothing limits the size of the UTXO set that will be walked and the handler does not abort when the client disconnects.
5. [backend/src/api/bitcoin/bitcoin.routes.ts:873–894](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L873-L894)
   Second anonymous entry point GET /api/v1/scripthash/:scripthash/utxo (registered at line 108) reaching the same loop with only a SCRIPT_HASH_REGEX check.
6. [backend/src/rpc-api/jsonrpc.ts:40–50](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/rpc-api/jsonrpc.ts#L40-L50)
   Every RPC call opens a fresh TCP connection (agent: false) and buffers the whole response body as a string, so each per-UTXO getblock costs a connection setup plus a full-block JSON body on the Node main thread; the 30 s timeout at lines 72-83 bounds one call, not the number of calls.
7. [docker/backend/start.sh:5](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/docker/backend/start.sh#L5)
   The Docker image defaults MEMPOOL_BACKEND to 'electrum', so the vulnerable code path is the shipped default for containerised deployments rather than an opt-in configuration.
8. [backend/src/index.ts:309–326](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L309-L326)
   When the backend's own Core RPC polling fails (e.g. Core returns 'Work queue depth exceeded' because the queue is saturated by the per-UTXO getblock storm), runMainUpdateLoop backs off and after five consecutive failures calls mempool.setOutOfSync(): the explorer stops updating while the attack runs.

## Impact
No data is disclosed or modified. One cheap request produces thousands of sequential Core RPC calls with full-block JSON responses parsed on the Node main thread; a handful of concurrent abandoned requests fill Core's RPC work queue so the backend's own polling fails and runMainUpdateLoop marks the mempool out of sync — the explorer stops updating for the duration of the attack, which the attacker can sustain indefinitely at negligible cost. Subsequent-system impact: The RPC calls land on the operator's Bitcoin Core node, whose HTTP RPC work queue is shared with every other RPC consumer on that host (LND/CLN, wallets, other indexers on node distros); while the attack lasts those clients also receive 'Work queue depth exceeded' errors.

## Reproduction steps
1. Attacker is any anonymous Internet client of the public API. They send GET /api/v1/address/<existing-address-with-many-utxos>/utxo (or the scripthash variant) to an instance running the electrum backend; such addresses are public and need no attacker funds. No authentication, no user interaction, deterministic; the request can be abandoned immediately because the loop does not observe disconnects. The one deployment condition is MEMPOOL.BACKEND = 'electrum', which is 'none' in config.ts but the shipped Docker default and the documented setup for romanz/electrs and Fulcrum.

## Recommended fix
1. $getScriptHashUtxos performs unbounded, per-UTXO, uncached Core RPC calls (getblockhash + full verbosity-1 getblock) whose count is set by the UTXO set of an attacker-chosen address, and the loop runs to completion regardless of client state. Fix criteria: A request for any address/scripthash results in a bounded amount of upstream work: cap or paginate the number of UTXOs enriched per request (rejecting oversized sets early, e.g. via the existing 413 'too long' path), resolve each distinct block height at most once per request and cache block hash/timestamp by height across requests, and fetch only the header (getblockheader) since only the timestamp is consumed. Verify that a request for an address with many thousands of UTXOs either completes with a bounded number of RPC calls or is rejected before any per-UTXO fan-out.
2. The route handlers for /address/:address/utxo and /scripthash/:scripthash/utxo do not observe client disconnects, so abandoned requests continue to drive upstream work. Fix criteria: Long-running per-request upstream loops stop when the HTTP request is aborted or closed, so an abandoned request cannot keep consuming Core RPC capacity.

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
**Subsequent system availability impact:** LOW
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257944

---

# Uncontrolled regexes from remote pools-v2.json compiled and run on every block (ReDoS)

## Details
Pool attribution compiles each coinbase tag string from the mining-pools definition file (`pools-v2.json`) into a JavaScript `RegExp` and matches it against the ASCII rendering of the block's coinbase scriptSig (`PoolsParser.matchBlockMiner`, backend/src/api/pools-parser.ts:161-169). The tag strings are taken verbatim from the downloaded JSON (`setMiningPools`: `pool.regexes = pool.tags`), stored in the `pools.regexes` column by `migratePoolsJson`, and re-parsed and compiled on every call. Nothing checks that a tag is a plain literal or a linear-time pattern, bounds its length, catches a compile error, or protects the event loop from super-linear backtracking; V8's Irregexp engine (Node's default) has no step limit.

The document is fetched from the operator-configured `POOLS_JSON_URL`, by default the master branch of the third-party repository mempool/mining-pools, which accepts community pull requests; the scan's threat model classifies this provider as a second-order adversary. The guard in `pools-updater.ts:72-79` only suppresses the download when a sha is already stored and `AUTOMATIC_POOLS_UPDATE` is false and `--update-pools` is absent, so every fresh install downloads whatever is served, and the Docker image (`docker/backend/start.sh:29`) and mempool.space's production configs enable periodic refresh. A single tag such as `(.*)*(?!)` -- which fails only after exploring every partition of the input, i.e. ~2^(n-1) steps for an n-byte coinbase, regardless of the coinbase's content -- is enough; it does not look obviously hostile next to the real tags, which already use regex syntax (`/BTC.COM/`, `/E2M & BTC.TOP/`).

Effect once applied:
1. `migratePoolsJson()` detects the changed `regexes`, writes them, and runs `$reindexBlocksForPool()` for that pool and for the Unknown pool, calling `matchBlockMiner` for every indexed block from height 130635 upward while the pools transaction is open. The first evaluation of the catastrophic pattern blocks the single Node process synchronously and effectively forever, so HTTP, WebSocket and indexing all stop.
2. The pattern is persisted in `pools.regexes` (or held in `poolsParser.miningPools` when the DB is disabled), and `blocks.$findBlockMiner()` (called from `$getBlockExtended` and `$updateBlocks`) runs it for every new block, so after a restart the backend stalls again on the next block; on restart `updatePoolsJson` sees the stored sha equals GitHub's and does not re-migrate, so recovery requires the upstream file to change and a manual re-update, or a manual DB edit.
3. A syntactically invalid tag instead throws `SyntaxError` out of `$findBlockMiner`, which `runMainUpdateLoop` catches and retries indefinitely (index.ts:308-326), halting block ingestion until the definitions are fixed.

This differs from the trust the project deliberately places in the pool definitions for attribution (a bad tag mislabels blocks and has no availability consequence): the defect is executing provider-supplied regular expressions with no complexity or time safeguard inside the main event loop. Impact is availability of the whole backend for all users of the instance; no data is disclosed or modified beyond the pool attribution the provider already controls by design.

## Evidence
1. [backend/src/api/pools-parser.ts:147–171](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/pools-parser.ts#L147-L171)
   matchBlockMiner() converts the coinbase scriptSig to ASCII (<=100 chars by consensus) and, for each pool in order, does `new RegExp(regexes[y], 'i')` and `asciiScriptSig.match(regex)` synchronously on the main event loop. The pattern strings are whatever the pools JSON supplied (via pool.regexes in memory or the pools.regexes column). There is no pattern validation, length/complexity bound, timeout or try/catch; a super-linear pattern such as `(.*)*(?!)` backtracks through every partition of the coinbase string (~2^99 steps on a 100-byte coinbase, independent of its content) and never returns, and an invalid pattern throws SyntaxError out of block ingestion.
2. [backend/src/api/pools-parser.ts:25–32](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/pools-parser.ts#L25-L32)
   setMiningPools() copies pool.tags verbatim into pool.regexes with no sanity check on the strings; this is where the remotely fetched document becomes the regex source (used directly when DATABASE.ENABLED is false, persisted via migratePoolsJson otherwise).
3. [backend/src/tasks/pools-updater.ts:72–118](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/tasks/pools-updater.ts#L72-L118)
   updatePoolsJson() downloads POOLS_JSON_URL (default raw.githubusercontent.com/mempool/mining-pools/master/pools-v2.json). The guard at 72-79 only skips the download when a sha is already stored AND AUTOMATIC_POOLS_UPDATE is off AND --update-pools is absent, so a fresh install always downloads; Docker (docker/backend/start.sh:29) and the production mempool-config.*.json set AUTOMATIC_POOLS_UPDATE=true for periodic refresh. The parsed JSON goes to poolsParser.setMiningPools() and migratePoolsJson(), which persists the regexes to the pools table and immediately runs $reindexBlocksForPool for changed pools and the Unknown pool.
4. [backend/src/api/pools-parser.ts:209–253](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/pools-parser.ts#L209-L253)
   $reindexBlocksForPool()/$reassignBlocks() load the just-written pools rows and call matchBlockMiner for every block of the changed pool and every Unknown block from height 130635, inside the open pools transaction; the first evaluation of a catastrophic pattern already stalls the process indefinitely.
5. [backend/src/api/blocks.ts:478–506](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L478-L506)
   $findBlockMiner() loads all pools (DB or poolsParser.miningPools) and calls matchBlockMiner on the coinbase scriptsig. It is called from $getBlockExtended (blocks.ts:344, new blocks and on-demand indexing) and from $updateBlocks (blocks.ts:1439) for every newly seen block, so the persisted pattern re-stalls the backend after every restart as soon as a block is processed.
6. [backend/src/index.ts:171](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/index.ts#L171)
   startServer() awaits poolsUpdater.updatePoolsJson() unconditionally at boot, before the HTTP/WebSocket server is useful, so the first-install download and migration (and any reindex it triggers) run on every fresh instance.

## Impact
A super-linear regex evaluated synchronously in the single backend process blocks all HTTP, WebSocket and indexing work on the first evaluation; it is persisted in the pools table (or in-memory pool list) and re-evaluated for every new block, so the outage is total, recurs after restart, and is not cleared by the updater (stored sha matches upstream). No confidentiality or integrity impact beyond the attribution data the provider already controls.

## Reproduction steps
1. The attacker is whoever controls the content served at POOLS_JSON_URL: landing a tag in the third-party mempool/mining-pools repository (community PRs, reviewed by humans who already accept regex syntax in tags), compromising that repository or GitHub's raw CDN, or controlling a mirror an operator configured. The attacker needs no privileges on, and no interaction from, the mempool instance; the condition that the malicious document be the one served at update time is an attack requirement outside the attacker's direct control (AT:P). Once served, application is automatic (unconditional on fresh installs per pools-updater.ts:72-79 and index.ts:171; periodic under the Docker/production default AUTOMATIC_POOLS_UPDATE=true) and the hang is deterministic for any coinbase content. Assumes Node's default V8 Irregexp backtracking matcher with no step limit (the experimental linear-time fallback is off by default).

## Recommended fix
1. matchBlockMiner compiles and executes arbitrary provider-supplied strings as regular expressions on the main event loop with no bound on pattern complexity or match time and no handling of compile errors. Fix criteria: Pool tags must not be able to stall or halt the process: restrict tags to a safe subset (literal substrings or a linear-time matcher) validated at import time, or execute matching with a hard time/step bound off the main loop, and treat a pattern that fails to compile as a non-match rather than an exception. Verification: import a pools document containing a known catastrophic pattern and an invalid pattern and confirm block indexing and reindexing complete in normal time with the offending tags rejected or logged.
2. setMiningPools/migratePoolsJson accept and persist tag strings without validation, so a bad pattern survives restarts and is re-applied to every block. Fix criteria: Reject or neutralise tags that fail validation before they are written to the pools table or kept in memory, and compile each surviving pattern once per update rather than per block. Verification: after importing a document with an invalid or dangerous tag, the pools table contains only validated patterns and the update either skips that pool with an error or stores a safe form.

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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257943

---

# Outspends lookup via Core RPC issues one gettxout per output, batched 50x

## Details
On deployments where MEMPOOL.BACKEND is 'none' or 'electrum' (the routes are registered only when BACKEND !== 'esplora', bitcoin.routes.ts:81-93; ElectrumApi extends BitcoinApi and does not override $getOutspends; Docker's start.sh defaults MEMPOOL_BACKEND to electrum), the public endpoints GET /api/v1/tx/:txId/outspends and GET /api/v1/txs/outspends?txids=<up to 50> are served by BitcoinApi.$getOutspends / $getBatchedOutspends (bitcoin-api.ts:236-291).

$getOutspends fetches the transaction with getrawtransaction (skipConversion=true, so the raw Core object has no `status` field and the `tx.status.block_height === 0` short-circuit never fires) and then, unless indexer.isCoreIndexReady('txospenderindex') is truthy, awaits one `gettxout` RPC per output, serially, for every index in tx.vout with no cap on tx.vout.length. `coreIndexes` is populated only by checkAvailableCoreIndexes() inside the mining indexer run (indexer.ts:214), and txospenderindex is an optional, off-by-default Bitcoin Core index, so the per-output path is the shipped default. $getBatchedOutspends repeats this for each of up to 50 txids. Each RPC call opens a fresh TCP connection (jsonrpc.ts agent:false) with a 30 s timeout per call, not per request; the route has no client-disconnect handling, so the loop runs to completion after nginx has dropped the client.

The route guards (TXID_REGEX, <=50 txids) bound only the number of transactions. Mainnet contains confirmed transactions with thousands to >13,000 outputs; 50 such txids turn one cheap GET into hundreds of thousands of serial Core RPC round-trips lasting many minutes. Each in-flight request holds one slot of Core's RPC work queue continuously, so a few dozen cheap concurrent GETs saturate Core's default rpcthreads/rpcworkqueue; the backend's own polling (getblock, getrawmempool) then fails with 'Work queue depth exceeded', the main loop backs off (index.ts:308-326) and the instance stops updating while the attack is sustained, as do all other Core-backed API routes. The amplification factor is set by the attacker's input (sum of vout counts), not by request rate, so it is per-request amplification rather than volumetric load. The shipped Docker nginx config applies no cache or rate limit to these routes; the production nginx 2 s request_uri cache is defeated by permuting txid order. mempool.space itself runs BACKEND esplora (production/mempool-config.mainnet.json) and is not affected; self-hosted Core-only/electrum instances are.

## Evidence
1. [backend/src/api/bitcoin/bitcoin-api.ts:236–280](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin-api.ts#L236-L280)
   $getOutspends fetches the transaction (skipConversion=true, so no `status` short-circuit applies) and, unless Core's optional txospenderindex is reported synced, serially awaits one getTxOut RPC per output with no cap on tx.vout.length. This is the code the fix must bound.
2. [backend/src/api/bitcoin/bitcoin-api.ts:283–290](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin-api.ts#L283-L290)
   $getBatchedOutspends repeats $getOutspends for every supplied txid with no overall budget, multiplying the per-output fan-out by the batch size.
3. [backend/src/api/bitcoin/bitcoin.routes.ts:229–250](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L229-L250)
   GET /api/v1/txs/outspends?txids=... accepts up to 50 hex-valid txids from an anonymous client and passes them to $getBatchedOutspends; only format and count are checked, never output counts.
4. [backend/src/api/bitcoin/bitcoin.routes.ts:1102–1112](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L1102-L1112)
   GET /api/v1/tx/:txId/outspends reaches $getOutspends for a single arbitrary txid.
5. [backend/src/api/bitcoin/bitcoin.routes.ts:81–93](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L81-L93)
   Both routes are registered whenever MEMPOOL.BACKEND !== 'esplora', i.e. on Core-only and electrum deployments (Docker default is electrum); ElectrumApi inherits the same loop.
6. [backend/src/indexer.ts:71–78](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/indexer.ts#L71-L78)
   isCoreIndexReady returns null unless checkAvailableCoreIndexes (run only inside the mining indexer, indexer.ts:214) recorded txospenderindex as synced; on default deployments the per-output gettxout path is therefore always taken.
7. [backend/src/rpc-api/jsonrpc.ts:40–50](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/rpc-api/jsonrpc.ts#L40-L50)
   Each RPC call opens a fresh TCP connection (agent: false); the 30 s timeout is per call, so a request of hundreds of thousands of calls is never cut short.

## Impact
No confidentiality or integrity impact. One cheap GET produces up to hundreds of thousands of serial Core RPC round-trips over fresh TCP connections, continuing after the client disconnects. Each in-flight request continuously occupies a Core RPC work-queue slot; a few dozen concurrent requests exhaust Core's default work queue so the backend's own block/mempool polling and every other Core-backed route fail for as long as the attacker sustains the requests, leaving the explorer stale and non-functional. The backend process survives (main loop catches and retries, index.ts:308-326), so this is a sustained loss of service rather than a crash.

## Reproduction steps
1. Any unauthenticated Internet client sends GET /api/v1/txs/outspends?txids=<50 txids of known high-output-count confirmed mainnet transactions> (or the single-tx route) to an instance running the Core-only or electrum backend, which is the Docker default and the documented self-hosting configuration. Bitcoin Core's txospenderindex is optional and off by default (assumption about Bitcoin Core >= v30; older Core lacks it entirely), so the per-output path is the shipped default. No authentication, interaction or special condition is needed; the attacker needs only publicly known txids.

## Recommended fix
1. $getOutspends issues an unbounded number of per-output gettxout RPC calls driven by the attacker-chosen transaction's output count, and $getBatchedOutspends multiplies it by the batch size with no overall per-request budget. Fix criteria: The total upstream RPC work per client request must be bounded independently of the chosen transactions: enforce a total-output budget across the batch (reject or truncate above a threshold), batch the gettxout calls into a single JSON-RPC batch request with a cap, or require txospenderindex/gettxspendingprevout for these routes. Verify that a batched request for 50 high-output-count txids either completes with a bounded number of RPC calls or is rejected early.
2. The route handler keeps issuing upstream calls after the HTTP client has disconnected, so work outlives the request that triggered it. Fix criteria: Abort the outspends loop when the request is closed by the client (req/res 'close' handling), so an attacker cannot queue minutes of upstream work with a request nginx has already dropped.

---
**Severity:** HIGH
**Status:** Open
**Category:** Uncontrolled resource consumption
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257942

---

# Block CPFP cluster serialisation truncates parent indices and counts to uint8, corrupting stored cluster ancestry

## Details
The cluster-mempool CPFP summary of a confirmed block is persisted with `CpfpRepository.packCM`, a compact binary format whose per-transaction `num_parents` and `parent_indices` fields are single bytes (CpfpRepository.ts:324-329). The indices are flat positions within the cluster assigned by `buildClusterData` (cluster-mempool.ts:666), and the block-side cluster is an uncapped connected component of the block's in-block spend graph: `calculateClusterMempoolBlockCpfp` builds a `ClusterMempool` over every block transaction (cpfp.ts:196), whose `buildRelativeMaps`/`dfsComponent` join any transactions linked by an in-block `vin.txid` with no size limit (cluster-mempool.ts:157-215). `DataView.setUint8` stores the value modulo 256, so for any in-block component of more than 256 transactions every parent index >= 256 is written as `index % 256`, and a transaction with more than 255 in-cluster parents has its count wrapped too. The wrapped blob is written to `compact_cpfp_clusters` by `$batchSaveClusters` (CpfpRepository.ts:17-27) for every new block (blocks.ts:592-596) and every re-indexed block (blocks.ts:2032-2036) when the block was attributed to the cluster-mempool template algorithm (block-processor.ts:248-253).

On read, `unpackCM` (CpfpRepository.ts:335-396) trusts the stored bytes. With wrapped indices the blob parses cleanly (every wrapped index is still smaller than its child's index, so the graph stays acyclic and no loop or crash results), but `TransactionRepository.convertCpfpCM` (TransactionRepository.ts:123-210) follows the wrong edges: `GET /api/v1/cpfp/:txid` (bitcoin.routes.ts:293) for a confirmed member returns ancestors/descendants that are not its relatives, and the `cluster.txs[].parents` array it returns is rendered as the dependency edges of the frontend cluster diagram (cluster-diagram.component.ts:77). Chunk feerates are unaffected in this case because chunk sizes are uint16 and feerates are recomputed from fee/weight. With a wrapped parent count the record stream is misaligned by 256 bytes; the parser either overruns the buffer (RangeError caught at 392-395, the cluster is returned empty and every member's effective fee rate becomes 0 with no relatives) or yields garbage records whose out-of-range indices make convertCpfpCM throw, which the route converts to HTTP 500 for that txid. Either way the block's persisted CPFP data for that component is wrong or lost. The legacy `pack` format (lines 240-259) carries no indices and is unaffected.

Who can trigger it: a block producer can include a >256-transaction spend component (or one transaction spending >255 in-block parents) and order the block in cluster-chunk order so `detectTemplateAlgorithm` selects the cluster-mempool result; a transaction broadcaster can supply the component indirectly, since legacy mempool policy bounds ancestor/descendant counts but not connected-component size (a ladder of children each spending two adjacent parents is policy-compliant at any width), although algorithm selection then depends on the miner's ordering. Pre-pack in-memory data (effective fee stats, block summaries) is computed before packing and is not affected.

Conditions: this holds only where `CPFP_INDEXING` and `CLUSTER_MEMPOOL_INDEXING` are both enabled (both default false in config.ts:211-214; both are true in the in-tree mempool.space mainnet config production/mempool-config.mainnet.json:20-23 — the testnet/testnet4/signet production configs enable only `CLUSTER_MEMPOOL_INDEXING`), the block height is at or above `CM_ACTIVATION_HEIGHT` (mainnet 940000, block-processor.ts:38-44), and the cluster-mempool algorithm is selected for the block.

## Evidence
1. [backend/src/repositories/CpfpRepository.ts:294–333](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/repositories/CpfpRepository.ts#L294-L333)
   packCM writes each tx's parent count with setUint8 (324) and each parent's flat index with setUint8 (327); DataView.setUint8 reduces the value modulo 256, so any flat index >= 256 or any count > 255 is silently wrapped. Chunk count and chunk size use setUint16 (307, 311) and wrap at 65536.
2. [backend/src/api/cpfp.ts:211–229](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/cpfp.ts#L211-L229)
   calculateClusterMempoolBlockCpfp attaches `clusterData` from cm.getCluster to every multi-tx cluster of a confirmed block; the cluster is an uncapped connected component of the block's in-block dependency graph, so its flat index space is as large as the component.
3. [backend/src/cluster-mempool/cluster-mempool.ts:658–694](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/cluster-mempool.ts#L658-L694)
   buildClusterData assigns flat indices 0..N-1 across all chunks (txToFlatIdx, line 666) and records parents as those indices (667-673); nothing limits N.
4. [backend/src/repositories/CpfpRepository.ts:13–27](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/repositories/CpfpRepository.ts#L13-L27)
   $batchSaveClusters stores packCM(cluster.clusterData) for every cluster whose templateAlgorithm is clusterMempool, and indexes every member txid to the cluster root, so the wrapped data is persisted to compact_cpfp_clusters.
5. [backend/src/api/blocks.ts:592–595](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/blocks.ts#L592-L595)
   $saveBlockData calls $saveCpfp for every new block when CPFP_INDEXING is enabled; $indexCPFP (2034-2036) does the same for historical blocks.
6. [backend/src/repositories/TransactionRepository.ts:123–210](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/repositories/TransactionRepository.ts#L123-L210)
   convertCpfpCM rebuilds ancestors (168-176) and descendants (154-187) by following the stored parent indices; wrapped indices point at the wrong transactions, so GET /api/v1/cpfp/:txid for a confirmed tx (bitcoin.routes.ts:293) returns relatives that are not its ancestors/descendants and a `cluster.txs[].parents` edge list the frontend diagram renders as-is. Out-of-range indices from a misparsed blob throw here; the route's try/catch turns that into HTTP 500, so there is no process crash.
7. [backend/src/repositories/CpfpRepository.ts:335–396](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/repositories/CpfpRepository.ts#L335-L396)
   unpackCM trusts the stored uint8 parent counts; when a count wrapped, the remaining tx records are parsed 256 bytes out of alignment until a RangeError is caught and the whole cluster is returned empty (392-395), so every member's effective fee rate reads 0 with no relatives, or garbage records are returned.
8. [backend/src/api/block-processor.ts:240–252](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/block-processor.ts#L240-L252)
   detectTemplateAlgorithm selects the cluster-mempool result (and thus packCM) when the block's ordering is better explained by cluster chunk order than by legacy ancestor order; a block producer controls the ordering.
9. [production/mempool-config.mainnet.json:20–23](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/mempool-config.mainnet.json#L20-L23)
   CPFP_INDEXING (20) and CLUSTER_MEMPOOL_INDEXING (23) are both true in the in-tree mempool.space mainnet config, so the path is live there; both default to false in config.ts:211-214 and the other production configs set only CLUSTER_MEMPOOL_INDEXING.

## Impact
Persisted compact_cpfp_clusters rows for the affected component are corrupted and the public API serves incorrect ancestors/descendants and dependency edges, or no cluster data and a zero effective fee rate, for every confirmed transaction in that component; the corruption is limited to that component's rows, is not exploitable for disclosure or code execution, and the read path's error handling confines failures to HTTP 500 for the affected txids.

## Reproduction steps
1. The triggering input is the in-block spend graph of a confirmed block, delivered to the backend over the network via its Bitcoin Core node; no privileges on the mempool instance and no user interaction are needed. The attacker must hold or borrow a block-producer position: a >256-transaction component (or a >255-parent transaction) must confirm in one block and the block must be ordered so that detectTemplateAlgorithm's LIS heuristic (block-processor.ts:248) attributes it to the cluster-mempool algorithm. Legacy mempool policy does not bound component size, so a tx broadcaster can supply the component, but selection then depends on the miner's ordering. Those execution conditions are attack requirements; the construction itself is straightforward and deterministic.

## Recommended fix
packCM encodes cluster-relative parent indices and parent counts as uint8 although the block-side cluster has no size cap, so values >= 256 wrap silently and corrupt the stored dependency graph. Fix criteria: The serialised format must represent every index and count the producer can generate without wrapping (wider fields or a varint), or packCM must refuse/degrade (e.g. store legacy format) when a value exceeds the field width, and unpackCM must validate indices against the decoded tx count. Verify by round-tripping a 300-tx chain cluster and a tx with 300 parents through packCM/unpackCM and confirming identical parents arrays.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Numeric truncation
**CWE:** [CWE-197](https://cwe.mitre.org/data/definitions/197.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258348

---

# Cluster diagram runs O(E²·W²) crossing search synchronously on unbounded attacker-shaped cluster

## Details
When MEMPOOL.CLUSTER_MEMPOOL is enabled (false in config.ts:210 and the Docker start.sh default, true in every shipped production/mempool-config.*.json including mainnet), the CPFP response for a mempool transaction carries `cluster`: the complete connected component (bitcoin.routes.ts:275-280 for GET /api/v1/cpfp/:txId; websocket-handler.ts:1008-1023 for the WebSocket txPosition.cpfp push), built by buildClusterData (cluster-mempool.ts:658-695) with no size cap. The frontend lays the entire payload out synchronously on the main thread: ClusterDiagramComponent.ngOnChanges (cluster-diagram.component.ts:59-66) calls computeLayout -> computeGridLayout (cluster-layout.ts:59-112) whenever the `cluster` input reference changes, with no cap on transaction or edge count.

computeGridLayout calls optimizeCrossings (1110-1151). countEdgeCrossings (1057-1070) tests every edge pair with edgesCross (1072-1081), which compares every waypoint segment of one edge against every segment of the other and returns early only on a crossing, so every non-crossing pair pays the full W_a x W_b cost. For every edge with a crossing, optimizeCrossings then evaluates the current and four alternative routings with countSingleEdgeCrossings (1177-1183, O(E*W^2) each), and the outer loop repeats up to five times. The floor is one Theta(E^2*W^2) pass; the worst case is ~25*E^2*W^2.

W is set by graph shape: computeWaypoints (324-350) emits one waypoint per intermediate column, and assignColumns (128-133) moves every childless transaction to the last column, so every parent->leaf edge spans the whole diagram width and W = maxCol+1 for all of them. A single deep chain anywhere in the component therefore inflates W for every leaf edge.

Attacker: anyone who can broadcast transactions (threat-model adversary 2). Connected-component size is unbounded under Bitcoin Core's standard 25-ancestor/25-descendant policy (see verified cluster-mempool-unbounded-cluster-payload-per-tracked-tx): a ladder in which B_i spends A_i and A_{i+1} is 2k txs and 2k edges, and one ~22-tx chain hung off any rung sets maxCol~22, so W~23 (W^2~500) for every ladder edge. For k=1000 (2000 txs, roughly 0.002 BTC at 1 sat/vB) one countEdgeCrossings pass is ~2*10^6 edge pairs x ~480 segment tests ~ 10^9 segmentsCross calls, on the order of ten seconds of main-thread time; interleaving rungs so edges cross adds ~E*5*E*W^2 ~ 10^10 per iteration for up to five iterations. For k=5000 one pass alone is ~2.5*10^10: the tab is frozen for minutes and the browser offers to kill it. Secondary O(n^2) phases (clusterOverlapping 1022-1055, assignLanes 942-995 over the vertical segments of a column, hasDescendantColumnTie 239-258 over a layer) add to this.

Reachability: every transaction page whose tx belongs to a multi-tx cluster instantiates the preview diagram with [preview]="true" and no click (transaction-details.component.html:263, 298-311). The preview lays out the whole active chunk; the attacker makes that the whole component by having every descendant pay at least its ancestors' feerate, since mergeStepUp/pickMergeCandidateUp (linearize.ts:286-328) merges a child chunk into its parent chunk whenever the parent's feerate is not strictly higher. The full cluster is laid out regardless of chunking when `?cpfp=true` is in the URL (transaction.component.ts:238; transaction.component.html:84-97) or the user clicks the preview. The attacker chooses the victim page: the ladder can be attached as descendants of any unconfirmed transaction that pays the attacker (e.g. an exchange withdrawal), making that third party's transaction page unusable for every visitor, and /tx/<txid>?cpfp=true links can be shared. Every WebSocket txPosition.cpfp push goes through setCpfpInfo, which stores the new object (`this.cpfpInfo = cpfpInfo`, transaction.component.ts:966), so the diagram's `cluster` input is a fresh reference and the full layout re-runs; per the verified backend record, relinearization reassigns the cluster id and marks every member cpfpDirty, so one small child tx per 2-second poll (or natural churn) makes the freeze recur for as long as the page is open.

The legacy CPFP view bounds its graph (mini-miner.ts MAX_RELATIVE_GRAPH_SIZE = 100); the cluster diagram has no equivalent bound on either side.

## Evidence
1. [frontend/src/app/components/cluster-diagram/cluster-layout.ts:1057–1081](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/cluster-diagram/cluster-layout.ts#L1057-L1081)
   countEdgeCrossings tests every edge pair (E^2/2) with edgesCross, which compares every waypoint segment of one edge against every segment of the other (W_a x W_b); the early return fires only on a crossing, so non-crossing pairs pay the full W^2 cost.
2. [frontend/src/app/components/cluster-diagram/cluster-layout.ts:1110–1151](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/cluster-diagram/cluster-layout.ts#L1110-L1151)
   optimizeCrossings calls countEdgeCrossings up to 5 times and, for every edge with a crossing, evaluates the current plus four alternative routings with countSingleEdgeCrossings (1177-1183, O(E*W^2) each). Total work is Theta(E^2*W^2) minimum, ~25*E^2*W^2 worst case; no edge budget or time limit.
3. [frontend/src/app/components/cluster-diagram/cluster-layout.ts:114–134](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/cluster-diagram/cluster-layout.ts#L114-L134)
   assignColumns (128-133) moves every childless transaction to maxCol, so every parent->leaf edge spans the full diagram width; one deep chain anywhere in the component sets W = maxCol+1 for every leaf edge.
4. [frontend/src/app/components/cluster-diagram/cluster-layout.ts:324–350](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/cluster-diagram/cluster-layout.ts#L324-L350)
   computeWaypoints emits one waypoint per intermediate column between parent and child, so an edge's segment count equals its column span.
5. [frontend/src/app/components/cluster-diagram/cluster-layout.ts:59–111](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/cluster-diagram/cluster-layout.ts#L59-L111)
   computeGridLayout has no cap on transaction or edge count and runs the full pipeline (routeEdges, optimizeCrossings, assignSlots with O(n^2) clusterOverlapping 1022-1055 and assignLanes 942-995, computeChunkRegions) synchronously.
6. [frontend/src/app/components/cluster-diagram/cluster-diagram.component.ts:59–91](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/cluster-diagram/cluster-diagram.component.ts#L59-L91)
   ngOnChanges calls computeLayout synchronously on the main thread whenever the `cluster` input reference changes, with no size guard; in preview mode it lays out the whole active chunk, otherwise the whole cluster.
7. [frontend/src/app/components/transaction/transaction-details/transaction-details.component.html:298–311](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transaction/transaction-details/transaction-details.component.html#L298-L311)
   The clusterPreviewButton template (line 263: <app-cluster-diagram ... [preview]="true">) is instantiated on every transaction page whose cpfpInfo has a cluster, without any user action.
8. [frontend/src/app/components/transaction/transaction.component.ts:238](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transaction/transaction.component.ts#L238)
   cpfpMode is set from the ?cpfp=true query parameter, so a shared link renders the full-cluster diagram (transaction.component.html:84-97) on load.
9. [frontend/src/app/components/transaction/transaction.component.ts:966](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transaction/transaction.component.ts#L966)
   setCpfpInfo stores each incoming CpfpInfo object as-is, so every HTTP response and every WebSocket txPosition.cpfp push (556-567) gives the diagram a new `cluster` reference and re-runs the full layout.
10. [backend/src/api/websocket-handler.ts:1008–1023](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L1008-L1023)
   For every tracked tx that is cpfpDirty the handler embeds the full getClusterForApi result in the txPosition.cpfp push; per the verified backend record every relinearization re-marks all members dirty, so the push (and the client re-layout) recurs each poll.
11. [backend/src/api/bitcoin/bitcoin.routes.ts:275–280](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L275-L280)
   GET /api/v1/cpfp/:txId attaches the full cluster to the response when CLUSTER_MEMPOOL is enabled; this is what the transaction page fetches on load.
12. [backend/src/cluster-mempool/cluster-mempool.ts:658–694](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/cluster-mempool/cluster-mempool.ts#L658-L694)
   buildClusterData emits the whole connected component with parents as flat indices; there is no size cap (verified record cluster-mempool-unbounded-cluster-payload-per-tracked-tx), so E, N and depth are set by whoever gets transactions into the mempool.

## Impact
The victim's browser tab running the mempool frontend is blocked for tens of seconds to minutes per layout and the layout recurs on every WebSocket cluster push, so the transaction pages of every member of the attacker-built component — including third-party transactions the attacker attached to — are fully unusable for every visitor for as long as the component sits in the mempool (up to two weeks). Other pages of the frontend are unaffected. No data is disclosed or altered.

## Reproduction steps
1. The attacker broadcasts a policy-compliant ladder of a few thousand transactions plus one ~22-deep chain, with descendants paying at least their ancestors' feerate so the component linearizes as one chunk, attached as descendants of any unconfirmed transaction they want to target (one that pays them). Any user who opens that transaction's page on an instance with CLUSTER_MEMPOOL enabled receives the full cluster from /api/v1/cpfp or the WebSocket and the browser runs the Theta(E^2*W^2) layout on the main thread; a shared ?cpfp=true link forces the full-cluster layout regardless of chunking. No credentials; the victim only visits a page. Requirements outside the attacker's control: CLUSTER_MEMPOOL enabled (true in every shipped production config, false in the config.ts and Docker defaults) and a node whose policy admits large connected components (Bitcoin Core defaults through 30.x; an assumption about the external node, not verified in this repository).

## Recommended fix
1. computeGridLayout/optimizeCrossings perform Θ(E²·W²) (up to ~25·E²·W²) work with no bound on E or W, on a graph whose size and depth are chosen by whoever broadcasts transactions, and the component runs it synchronously on the UI thread. Fix criteria: Layout work is bounded independently of cluster size: above a fixed transaction/edge budget the diagram renders a truncated neighbourhood of the current tx or a 'cluster too large' notice, and crossing optimisation is skipped or replaced by a near-linear (sweep/segment-indexed) method. Verify that a 5000-tx ladder with a 22-deep chain renders or degrades in well under a second of main-thread time, for both the preview and the ?cpfp=true full view.
2. Every WebSocket txPosition.cpfp push replaces the cluster object and re-runs the entire layout even when the graph is structurally unchanged, letting an attacker re-trigger the cost every poll. Fix criteria: Layout is recomputed only when the set of txids/parents/chunks actually changes (structural comparison or backend-supplied cluster version), and recomputation is debounced; verify repeated pushes of an equivalent cluster do not call computeGridLayout.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Algorithmic complexity
**CWE:** [CWE-407](https://cwe.mitre.org/data/definitions/407.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258345

---

# Infinite loop on negative or oversized index hangs /view/mempool-block kiosk page

## Details
MempoolBlockViewComponent, the full-screen projected-block renderer at `/view/mempool-block/:index` (kiosk/fullscreen view, eagerly routed in app-routing.module.ts:260-263 with no guard), derives the block index from the URL with `parseInt(params.get('index'), 10) || 0` (mempool-block-view.component.ts:50) and then, on each emission of `stateService.mempoolBlocks$` (a ReplaySubject(1)), normalises it with `while (!mempoolBlocks[this.index]) { this.index--; }` (lines 61-63). The loop assumes a non-negative index not far above the array length and has no other exit. Opening `https://<instance>/view/mempool-block/-1` sets `index = -1` (truthy, so `|| 0` does not replace it); `mempoolBlocks[-1]` is `undefined`, so the index is decremented forever and the loop never terminates. `/view/mempool-block/99999999999999999999` parses to 1e20, where `this.index--` is a no-op in IEEE-754 doubles, so the loop is equally non-terminating; values between ~1e9 and 2^53 merely iterate that many times with the same observable effect. Because the `map` at lines 53-58 substitutes a one-element placeholder when there are no projected blocks, the `filter` at line 59 always passes and the `tap` runs on the first `mempool-blocks` emission. That emission happens on every page load: the component calls `want(['blocks','mempool-blocks'])` (line 45) and the backend answers a new `want-mempool-blocks` subscription with the current `mempool-blocks` array (backend/src/api/websocket-handler.ts:175-176) and includes it in init data (line 100). The subscription is made eagerly in ngOnInit (`.subscribe()` at line 67), not through a template async pipe, so the loop executes on the main thread of whatever environment instantiates the component. The visitor's tab becomes permanently unresponsive until force-closed.

This is the same mistake as in MempoolBlockComponent (`/mempool-block/:id`) but at a distinct route and component, requiring its own fix.

The backend is unaffected: the index is only sent to the WebSocket (`track-mempool-block`) by the child MempoolBlockOverviewComponent, which is never reached because the loop precedes it, and the backend rejects out-of-range values anyway (backend/src/api/websocket-handler.ts:373-385).

Conditional aggravation (not rated): if an operator runs the optional Angular SSR server (`frontend/server.ts` / `server.run.ts`, built by `npm run build:ssr`), one unauthenticated GET for `/view/mempool-block/-1` blocks that Node event loop forever: server.ts:38 installs a domino `window` so line 43 does not throw, and WebsocketService's non-browser branch (websocket.service.ts:56-61) feeds `/api/v1/init-data` — which contains `mempool-blocks` — into `mempoolBlocks$` (lines 422-424), driving the same loop inside the process. No shipped target deploys that server: Docker (`docker/frontend`), `production/install` and `production/mempool-build-all` never invoke `build:ssr`, and the production nginx `$mempoolSpaceSSR` upstream (127.0.0.1:4201, production/nginx/nginx.conf:55) is the daemon started from `${HOME}/services/ssr` (production/mempool-start-all:14-19), an external tree. The metrics therefore rate only the browser path.

## Evidence
1. [frontend/src/app/components/mempool-block-view/mempool-block-view.component.ts:60–63](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/mempool-block-view/mempool-block-view.component.ts#L60-L63)
   `tap(() => { while (!mempoolBlocks[this.index]) { this.index--; } })` decrements the index until an element exists and has no other exit; for a negative index no element ever exists so the loop never terminates, for 1e20 the decrement is a no-op in doubles, and for large finite indices it iterates that many times on the main thread. This is the code the fix must bound or clamp.
2. [frontend/src/app/components/mempool-block-view/mempool-block-view.component.ts:50](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/mempool-block-view/mempool-block-view.component.ts#L50)
   `this.index = parseInt(params.get('index'), 10) || 0;` takes the `:index` route segment verbatim; `parseInt` accepts `-1` and arbitrarily large magnitudes and `|| 0` only replaces NaN/0, so negative and huge values pass through unvalidated.
3. [frontend/src/app/components/mempool-block-view/mempool-block-view.component.ts:45–67](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/mempool-block-view/mempool-block-view.component.ts#L45-L67)
   `want(['blocks','mempool-blocks'])` requests the stream on every load; the `map` at 53-58 substitutes a one-element placeholder when there are no projected blocks so the `filter` always passes, and the pipeline is subscribed eagerly in ngOnInit (`.subscribe()`), not via a template async pipe, so the loop runs in any environment that instantiates the component.
4. [frontend/src/app/app-routing.module.ts:260–263](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/app-routing.module.ts#L260-L263)
   `view/mempool-block/:index` is a top-level eagerly routed page mapped to MempoolBlockViewComponent with no guard or resolver, so the index is an unauthenticated URL-controlled input.
5. [backend/src/api/websocket-handler.ts:175–176](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L175-L176)
   When a client first subscribes with `want-mempool-blocks`, the backend immediately includes the current `mempool-blocks` array in its response (and in init data at line 100), so `mempoolBlocks$` emits — and the loop runs — on every page load without waiting for mempool activity.
6. [frontend/src/app/services/websocket.service.ts:56–61](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/services/websocket.service.ts#L56-L61)
   Conditional path only: in the non-browser (SSR) branch WebsocketService fetches `/api/v1/init-data` and passes it to `handleResponse`, which emits `mempoolBlocks$.next(response['mempool-blocks'])` (lines 422-424); if the optional Angular SSR server were deployed, the same loop would block that Node process's event loop. No shipped target deploys it, so this is not rated.

## Impact
The mempool web application in the victim's browser spins forever on the main thread and must be force-closed. No data is disclosed or altered; the impact is confined to the victim's session of the frontend, so availability is rated Low. The backend is not reached.

## Reproduction steps
1. Attacker shares a link to `/view/mempool-block/-1` (or any negative or enormous integer) on any mempool instance. When the victim opens it, Angular instantiates MempoolBlockViewComponent, parseInt yields the negative index, and the first `mempool-blocks` WebSocket message (sent on every connection) drives the `while` loop, which never terminates. No authentication or non-default configuration is required; only the victim's visit.

## Recommended fix
The `:index` route parameter is converted with parseInt and used as an array index without range validation, and the normalisation loop only decrements, so any index below zero (or far above the array length) violates its termination assumption. Fix criteria: The index derived from `:index` must be clamped to [0, mempoolBlocks.length - 1] (or rejected/redirected) before use, and the normalisation must be bounded rather than an open while loop. Verify by loading `/view/mempool-block/-1` and `/view/mempool-block/99999999999999999999`: the page must render the nearest valid projected block without the main thread hanging.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Infinite loop
**CWE:** [CWE-835](https://cwe.mitre.org/data/definitions/835.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258160

---

# Address page runs uncapped per-leaf secp256k1 derivations on fragment-supplied taproot leaves, freezing the browser

## Details
The address page (`/address/:id`, AddressComponent, registered unconditionally in graphs.routing.module.ts:91) parses `#psbt=`, `#tapleaf=`, `#taptree=` and `#ikey=` out of the URL fragment on load (address.component.ts:166-174) and hands them to submitPsbt() with no size or count limit. Processing is gated only on `tapTreeIncomplete`, which address.component.ts:329-331 sets to true (via setTapTreeIncomplete -> submitPsbt, 607-616) for every P2TR address whose loaded inputs reveal no tapscript spend: address-utils.ts:165-185 adds nothing to `scripts` for key-path spends, and unused or receive-only addresses have no inputs at all. The fragment stays pending from the init-time call (tapTreeIncomplete is still false then) and is consumed by this second call, so merely opening the link starts the work.

The unbounded sink is per-leaf elliptic-curve work. With `#taptree=<base64>&ikey=<any valid x-only key, e.g. the NUMS key>` (or `#tapleaf=cb:script,cb:script,...`), parseTapTreeRecord (transaction.utils.ts:2752-2790) yields one leaf per ~6 input bytes and extractTapLeaves (2845-2853) only dedupes exact duplicates. fillTapTree (2869-2947) then calls leafMatchesAddress on each leaf; because the address has no known scripts, `commitment` is undefined and every leaf runs computeMerkleRoot plus deriveTaprootAddress -> computeTaprootOutputKey (2715-2723): `secp256k1.Point.fromHex` (point decompression, a modular square root), `Point.BASE.multiply(tweak)` (a scalar multiplication), a point addition and affine conversion, then a bech32m encode - all pure-BigInt JavaScript on the main thread. No forged leaf matches the address, so the commitment is never set, the loop never exits early, and the cost is paid N times. Nothing in the component or the helpers caps N, the fragment length, or the number of EC derivations. Assumption: @noble/secp256k1 ^3.2.0 as pinned in frontend/package.json, where fromHex plus a base-point multiply costs on the order of a millisecond in a browser; a 100 KB fragment (~16k leaves) then freezes the tab for tens of seconds and a 1-2 MB fragment (the browser URL limit) for minutes. The browser's 'page unresponsive' prompt is the only recovery.

The `#psbt=` key additionally reaches decodePsbt via extractTapLeaves (2824-2826), whose readMaps(numOutputs) allocation loop is already recorded (with this address-page entry noted) in psbt-output-count-unbounded-allocation-preview-fragment; that sink is not re-filed here.

Result: anyone who can get a victim to open `https://<instance>/address/bc1p...#taptree=...&ikey=...` on any mempool instance deterministically hangs the victim's browser tab. No privileges and no non-default configuration are involved; the page ships on every instance.

## Evidence
1. [frontend/src/app/shared/transaction.utils.ts:2885–2912](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/transaction.utils.ts#L2885-L2912)
   Primary sink / fix location. fillTapTree.leafMatchesAddress: when the address has no known script (commitment undefined, the key-path-only and unused-address case), every leaf runs computeMerkleRoot then deriveTaprootAddress -> computeTaprootOutputKey (lines 2715-2723: secp256k1.Point.fromHex (modular sqrt) and Point.BASE.multiply(tweak) (scalar multiplication) in pure-BigInt JS, then an affine conversion and bech32m encode) before the address comparison fails. A non-matching leaf never sets the commitment, so this cost is paid once per leaf for every one of the N attacker-supplied leaves; nothing caps N or stops after a mismatch.
2. [frontend/src/app/shared/transaction.utils.ts:2752–2790](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/transaction.utils.ts#L2752-L2790)
   parseTapTreeRecord accepts an arbitrary number of leaves bounded only by the input length: each leaf needs a depth byte, a version byte, a varint and the script (about 6 bytes with a 3-byte script, which also makes leaves distinct past extractTapLeaves' dedupe key at 2845-2853). A 1 MB fragment therefore yields on the order of 100k leaves.
3. [frontend/src/app/components/address/address.component.ts:166–174](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/address/address.component.ts#L166-L174)
   Entry point: on init the component subscribes to the URL fragment, parses psbt/tapleaf/taptree/ikey with URLSearchParams and calls submitPsbt(). The fragment is never sent to the server and is bounded only by the browser's URL limit; no click or form interaction is required.
4. [frontend/src/app/components/address/address.component.ts:329–331](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/address/address.component.ts#L329-L331)
   After the address and its transactions load, any v1_p2tr address without a revealed tapscript spend (the common key-path-only case, and every unused or receive-only address) calls setTapTreeIncomplete(true).
5. [frontend/src/app/components/address/address.component.ts:607–616](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/address/address.component.ts#L607-L616)
   setTapTreeIncomplete sets tapTreeIncomplete=true and, because the fragment is still pending (the init-time submitPsbt call at 166-174 returned without consuming it while tapTreeIncomplete was false), calls submitPsbt() again - so the fragment is processed exactly in the no-known-scripts case that the ledger item dismissed-transaction-2900-f7fc assumed returned early.
6. [frontend/src/app/components/address/address.component.ts:544–605](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/address/address.component.ts#L544-L605)
   submitPsbt decodes the fragment values with convertTextToBuffer (hex or base64, no length cap, transaction.utils.ts:2684-2698), splits tapleaf on commas into an unbounded list, then calls extractTapLeaves and fillTapTree synchronously on the main thread. The try/catch handles only thrown errors; it cannot interrupt a loop that merely takes minutes.
7. [frontend/src/app/shared/address-utils.ts:165–184](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/address-utils.ts#L165-L184)
   For v1_p2tr, processInputs only adds a script (and sets tapscript) when an input reveals a leaf-version-0xc0 script-path spend. Key-path spends, receive-only and unused addresses leave scripts empty, so fillTapTree has no commitment and takes the per-leaf EC path for every leaf. AddressTypeInfo is constructed with no vin at address.component.ts:207.

## Impact
The victim's browser tab is frozen for tens of seconds to minutes (bounded by the browser URL limit and the per-leaf EC cost, assuming @noble/secp256k1 ^3.2.0); no data is read or altered. Impact is confined to the client rendering the page, so availability is LOW; the service and other users are unaffected.

## Reproduction steps
1. Attacker publishes or sends a link to any instance's address page for an ordinary key-path-only or unused P2TR address with a fragment of a few hundred KB of base64 taptree leaves (3-byte distinct scripts) plus a valid x-only ikey. The victim opens it; after the address loads, address.component.ts:329 -> setTapTreeIncomplete(true) -> submitPsbt runs fillTapTree automatically, performing one secp256k1 decompression and base-point multiplication per leaf on the main thread. No authentication, configuration or race; the only interaction is loading the page.

## Recommended fix
1. fillTapTree performs an expensive secp256k1 derivation for every candidate leaf and neither it nor extractTapLeaves/parseTapTreeRecord limits the number of leaves taken from untrusted psbt/tapleaf/taptree input, so work is bounded only by the attacker's fragment length. Fix criteria: Cap the number of leaves (and the decoded input length) accepted from psbt/tapleaf/taptree input to a small sane maximum, and/or derive the output key at most once per distinct (internalKey, merkleRoot) and stop as soon as the internal key cannot produce the address; a fragment carrying 10^5 forged leaves must be rejected or complete in well under a second.
2. The address page processes fragment-supplied taproot data automatically on load, turning any decoder cost into a drive-by denial of service. Fix criteria: Require an explicit user action, or at least a length and structural sanity check, before fragment-supplied psbt/tapleaf/taptree values are processed, so that opening a link alone cannot start unbounded client-side work.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Uncontrolled resource consumption
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258159

---

# Infinite loop on negative or oversized mempool block index hangs /mempool-block page

## Details
MempoolBlockComponent (route `/mempool-block/:id`, mounted for the bitcoin and liquid networks through GraphsRoutingModule, also under `/testnet`, `/signet`, `/liquid`, ...) derives the projected-block index from the URL with `parseInt(params.get('id'), 10) || 0` (line 44) and then, on every emission of `stateService.mempoolBlocks$`, normalises it with `while (!mempoolBlocks[this.mempoolBlockIndex]) { this.mempoolBlockIndex--; }` (lines 55-57). The loop assumes a non-negative integer no larger than the array. `https://<instance>/mempool-block/-1` yields `mempoolBlockIndex = -1` (`-1 || 0` is -1); `mempoolBlocks[-1]` is `undefined`, the index is decremented to -2, -3, ... and the condition can never become true, so the loop never exits. A huge value such as `/mempool-block/99999999999999999999` parses to 1e20, where `x - 1 === x` in double precision, so the index never changes and the loop is equally infinite; values between the array length and 2^53 spin for that many iterations. Lines 47-53 replace an empty projection with a one-element placeholder, so the `map` always runs. The template subscribes via `mempoolBlock$ | async`, `mempoolBlocks$` is a ReplaySubject(1), and the backend's WebSocket `init` response always carries `mempool-blocks` (backend/src/api/websocket-handler.ts:99), so the loop starts on the first message after page load and the visitor's tab becomes permanently unresponsive and must be force-closed.

Attacker: anyone who can get a victim to open or embed a crafted URL (threat-model adversary 5). The component is production frontend code served by nginx to every visitor of every instance (Docker image and production install alike).

The backend is not affected: `startTrackMempoolBlock` is only called in the `tap` after the `map`, which never completes, and the backend validates the index (`Number.isInteger(index) && index >= 0 && index < MEMPOOL_BLOCKS_AMOUNT`, backend/src/api/websocket-handler.ts:373-385).

Conditional aggravation (not rated): `frontend/server.ts` (Angular SSR) is not launched by the Docker frontend image (nginx static) or by `production/install`; mempool.space's nginx `$mempoolSpaceSSR` (production/nginx/nginx.conf:55) points at a separate unfurler service. If an operator did run `npm run serve:ssr`, the same loop would execute inside the Node process, because the non-browser branch of WebsocketService (websocket.service.ts:57-63) feeds `/api/v1/init-data` into `handleResponse` -> `mempoolBlocks$.next(...)`, and one unauthenticated GET for `/mempool-block/-1` would block the SSR event loop forever.

The same defect exists independently in MempoolBlockViewComponent (`/view/mempool-block/:index`), filed separately as mempool-block-view-negative-index-infinite-loop.

## Evidence
1. [frontend/src/app/components/mempool-block/mempool-block.component.ts:55–57](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/mempool-block/mempool-block.component.ts#L55-L57)
   `while (!mempoolBlocks[this.mempoolBlockIndex]) { this.mempoolBlockIndex--; }` only decrements and has no lower bound or iteration cap. For a negative index no array element can ever exist, so the loop never exits; for an index >= 2^53 (e.g. parseInt('99999999999999999999') === 1e20) the decrement is a no-op in IEEE-754 doubles, so the index never changes and the loop is likewise infinite. It runs synchronously inside an RxJS `map` on the browser main thread each time `stateService.mempoolBlocks$` (a ReplaySubject(1)) emits.
2. [frontend/src/app/components/mempool-block/mempool-block.component.ts:44](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/mempool-block/mempool-block.component.ts#L44)
   `this.mempoolBlockIndex = parseInt(params.get('id'), 10) || 0;` takes the `:id` route segment of `/mempool-block/:id` verbatim; `parseInt` accepts a leading `-` and arbitrarily large magnitudes (`-1`, `-7`, `1e20` written out), and `|| 0` only replaces NaN/0, so negative and huge values flow into the loop unchanged.
3. [frontend/src/app/components/mempool-block/mempool-block.component.ts:47–52](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/mempool-block/mempool-block.component.ts#L47-L52)
   When no projected blocks exist yet the stream is replaced with a one-element placeholder array and filtered to be non-empty, so the loop always runs as soon as `mempoolBlocks$` emits; there is no path on which a negative index skips the loop.
4. [frontend/src/app/graphs/graphs.routing.module.ts:79–87](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/graphs/graphs.routing.module.ts#L79-L87)
   The `mempool-block/:id` route maps to MempoolBlockComponent for the bitcoin and liquid networks, making the index an unauthenticated URL-controlled input.
5. [frontend/src/app/services/websocket.service.ts:422–423](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/services/websocket.service.ts#L422-L423)
   `mempoolBlocks$.next(response['mempool-blocks'])` is emitted on every WebSocket `mempool-blocks` message (and, in the non-browser/SSR branch of the constructor at lines 56-62, from `/api/v1/init-data`), which is what triggers the `map` containing the loop.

## Impact
The mempool web application in the victim's browser locks up completely (main thread spins forever); the tab must be killed. No data is read or modified. Impact is confined to the victim's session of the frontend, so availability is rated Low rather than High; the backend remains unaffected because the WebSocket subscription message is never sent.

## Reproduction steps
1. Attacker publishes or sends a link to `/mempool-block/-1` (or any negative / enormous integer) on any mempool instance. The victim opens it; Angular routes to MempoolBlockComponent, parseInt yields the negative index, and the first `mempool-blocks` WebSocket message (sent on every connection) drives the `while` loop, which never terminates. No authentication, no special configuration, works on the default build; only the victim's click is needed.

## Recommended fix
The route parameter is converted with parseInt and used as an array index without range validation, and the normalisation loop only decrements, so any index below zero (or far above the array length) violates the loop's termination assumption. Fix criteria: The index derived from `:id` must be clamped to the range [0, mempoolBlocks.length - 1] (or rejected/redirected) before use, and the normalisation must be bounded (e.g. `Math.min(Math.max(0, index), blocks.length - 1)` instead of a while loop). Verify by loading `/mempool-block/-1` and `/mempool-block/99999999999999999999`: the page must render the nearest valid block without the main thread hanging.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Infinite loop
**CWE:** [CWE-835](https://cwe.mitre.org/data/definitions/835.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258157

---

# Unbounded PSBT output-count allocation loop crashes browser via /tx/preview#tx= fragment

## Details
The transaction preview page (`/tx/preview`, TransactionRawComponent, registered unconditionally in transaction.module.ts:24) auto-decodes any value found in the `tx=` key of the URL fragment (transaction-raw.component.ts:98-114 -> decodeTransaction -> decodeRawTransaction). When the decoded bytes begin with the PSBT magic, decodePsbt() in frontend/src/app/shared/transaction.utils.ts is used.

decodePsbt pre-scans the embedded unsigned transaction to learn the input and output counts. The input count is implicitly bounded because the pre-scan loop advances txOffset through rawTx and readVarInt/readInt8 (transaction.utils.ts:2387-2392) throw 'Buffer out of bounds' once it runs past the buffer. The output count, however, is read once (`const [outputCount, _] = readVarInt(rawTx, txOffset); numOutputs = outputCount;`, lines 1589-1590) and passed directly to `readMaps(numOutputs, offset)` (line 1598). readMaps (lines 1535-1570) iterates `for (i = 0; i < count; i++)`, allocating `new Map()` and `new Set()` and pushing the Map onto the retained `map` array each time; its inner `while (offset < psbtBuffer.length)` is the only code that consumes bytes and is skipped entirely once the buffer is exhausted, so nothing ties the iteration count to the input size.

readVarInt (lines 2418-2439) accepts counts up to Number.MAX_SAFE_INTEGER (a 0xfe prefix yields up to 4,294,967,295; a 0xff prefix up to 2^53-1). An attacker therefore builds a ~60-byte PSBT: magic + 0xff separator, a global map containing key 0x00 whose value is a short unsigned tx (version, one input with empty scriptSig and sequence, then output-count varint 0xfe ff ff ff ff), the 0x00 global terminator, and a single 0x00 input-map terminator ending the buffer. Encoded as hex or base64 (convertTextToBuffer, lines 2684-2698) and placed in `https://<instance>/tx/preview#tx=<data>`, loading the link makes the victim's browser allocate billions of retained Map objects on the main thread until the renderer hits the V8 heap limit and is killed (out-of-memory is not a catchable exception), or the tab hangs. The surrounding try/catch in decodeTransaction cannot intervene because no exception is thrown.

No user interaction beyond following the link is required (the fragment path bypasses the Preview button), and the behaviour is deterministic. Fragments are not sent to the server so SSR is unaffected; impact is confined to the visitor's browser. A secondary entry point to the same sink exists on address pages: address.component.ts:166-173 auto-calls submitPsbt() on a `#psbt=` fragment, which reaches decodePsbt via extractTapLeaves (transaction.utils.ts:2824), but only when the page shows a P2TR address whose tap tree is incomplete. Any mempool instance ships the `/tx/preview` route (it is not behind a feature flag).

## Evidence
1. [frontend/src/app/shared/transaction.utils.ts:1535–1569](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/transaction.utils.ts#L1535-L1569)
   readMaps(count, startOffset) runs `for (let i = 0; i < count; i++)` allocating a new Map and a new Set and pushing to an array on every iteration. The inner `while (offset < psbtBuffer.length)` is the only thing that consumes bytes; once offset has reached the end of the buffer it is skipped entirely, so the loop degenerates into `count` pure allocations with no relationship to the input size.
2. [frontend/src/app/shared/transaction.utils.ts:1589–1598](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/transaction.utils.ts#L1589-L1598)
   numOutputs is taken verbatim from a varint in the attacker-supplied unsigned transaction (readVarInt accepts values up to Number.MAX_SAFE_INTEGER, e.g. 0xfe ff ff ff ff = 4,294,967,295 or 0xff + 8 bytes = 2^53-1) and passed straight to readMaps(numOutputs, offset). Unlike numInputs, whose pre-scan loop (lines 1580-1588) throws 'Buffer out of bounds' once rawTx is exhausted, numOutputs is never validated against the buffer or any cap.
3. [frontend/src/app/components/transaction/transaction-raw.component.ts:98–113](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transaction/transaction-raw.component.ts#L98-L113)
   The /tx/preview route subscribes to the URL fragment and, when a `tx=` key is present, writes it into the form and calls decodeTransaction() automatically with no user interaction beyond loading the page. This is the entry point that lets a crafted link deliver the PSBT to the decoder.
4. [frontend/src/app/components/transaction/transaction-raw.component.ts:116–130](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transaction/transaction-raw.component.ts#L116-L130)
   decodeTransaction() calls decodeRawTransaction() synchronously on the fragment value; the try/catch cannot help because the loop never throws, it simply runs until the renderer runs out of memory.
5. [frontend/src/app/shared/transaction.utils.ts:1805–1814](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/transaction.utils.ts#L1805-L1814)
   decodeRawTransaction routes any input whose first four bytes are 'psbt' (after hex or base64 decoding in convertTextToBuffer) into decodePsbt, so the attacker reaches the vulnerable loop with either a hex or base64 `#tx=` value.

## Impact
The victim's browser tab (and in some browsers the whole browser) is frozen or crashed by memory exhaustion; no data is read or modified. Impact is limited to the client rendering the page, so availability impact is rated LOW rather than HIGH (the service itself and other users are unaffected).

## Reproduction steps
1. Attacker crafts a tiny PSBT whose unsigned transaction declares an output count of 2^32-1 (or 2^53-1) and shares `/tx/preview#tx=<hex|base64>` on any mempool instance. A victim who opens the link triggers the fragment subscription, which auto-runs the decoder; readMaps then loops billions of times allocating objects with no bound tied to the buffer. No authentication, no special configuration, no race; the only requirement is that the victim loads the page.

## Recommended fix
1. decodePsbt trusts the output-count varint from attacker-controlled bytes and drives an allocation loop with it, without relating the count to the remaining buffer length or to any sane maximum. The property violated is that decoder work must be bounded by input size. Fix criteria: readMaps must not iterate more times than the remaining buffer can possibly describe (each map needs at least one terminator byte), and/or input and output counts must be rejected above a hard cap consistent with consensus-serializable transactions. After the fix, a PSBT declaring 2^32-1 outputs with an exhausted buffer must fail fast with an error rather than loop; the same bound should be applied to the input-map pass for defence in depth.
2. The preview page decodes fragment-supplied data automatically on page load, turning any decoder weakness into a drive-by denial of service. Fix criteria: Either require an explicit user action before decoding fragment-supplied `tx=` data, or enforce a length and structural sanity check on the fragment value before invoking the decoder, so that a crafted link cannot by itself drive unbounded client-side work.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Uncontrolled resource consumption
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258146

---

# Stored XSS: pool name from remote pools-v2.json rendered as HTML in accelerator pie-chart tooltip

## Details
The active-acceleration pie chart shown inside the Mempool Accelerator checkout (quote, summary and checkout steps of accelerate-checkout.component.html, lines 87/330/366, `[chartOnly]="true"`) and on every unconfirmed accelerated transaction's details page (transaction-details.component.html:54-55 → #acceleratingRow line 322, rendered when `!tx.status.confirmed && isAcceleration`) labels each slice with a hand-built HTML string: `<b style="color: white">${pool.name} (${poolShare}%)</b>` (active-acceleration-box.component.ts:91). The tooltip `formatter` returns that string unchanged (lines 126-128). echarts' tooltip in its default `renderMode: 'html'` assigns a string formatter result to the tooltip container via innerHTML, so any markup in `pool.name` is rendered and scripts in event-handler attributes (e.g. `<img src=x onerror=...>`) execute in the mempool instance's origin when a visitor hovers the chart.

`pool.name` is not chain data and not typed by the user; it originates in the mining-pool definition file `pools-v2.json`. The backend downloads that file from `POOLS_JSON_URL` (default: master branch of the third-party GitHub repository mempool/mining-pools, served by raw.githubusercontent.com; config.ts:206) on every fresh install (`currentSha === null`, pools-updater.ts:72-87) and periodically when `AUTOMATIC_POOLS_UPDATE` is enabled, which the Docker image (docker/backend/start.sh:29) and mempool.space production configs (production/mempool-config.mainnet.json:17) do. `migratePoolsJson()` writes `pool.name` verbatim into the `pools` table (pools-parser.ts:84 insert, :92 rename; PoolsRepository.ts:236-239 parameterised but unvalidated); only the slug is character-filtered. `GET /api/v1/mining/pools/:interval` (mining-routes.ts:138-150) returns `pools.name AS name`; `MiningService.generateMiningStats()` spreads each `poolStat` unchanged into `miningStats.pools` (mining.service.ts:129-139); transaction.component.ts:246-248 and accelerate-checkout pass `miningStats` to the chart.

Everywhere else the frontend prints pool names it uses Angular interpolation or `[name]`/`[alt]` bindings (pool.component.html:9, block.component.html:211, app-mining-pool), which escape them; this echarts formatter (and the sibling pattern in pool-ranking.component.ts:169/173, filed separately) bypasses that control. The impact is amplified by where the sink sits: the script runs on the page where the user is about to pay for an acceleration, so it can rewrite the displayed BIP21 URI/QR code and amounts in `app-bitcoin-invoice`, intercept the Square/Cash App/Apple Pay/Google Pay button handlers, or read `localStorage['auth']` (the services JWT and user object on mempool.space). The accelerator UI is enabled on mempool.space and the production configs (`ACCELERATOR: true`), which SECURITY.md places in scope; self-hosted instances default to `ACCELERATOR: false` but still render the transaction-page chart for accelerated transactions reported by the services API.

Dependency assumption: echarts `~6.1.0` (frontend/package.json:84) renders string tooltip-formatter output as HTML (innerHTML) in the default renderMode; the repository never sets `renderMode: 'richText'` (no occurrence under frontend/src), and the project's own formatters depend on this behaviour by emitting `<b>`/`<br>` markup (active-acceleration-box.component.ts:91, pool-ranking.component.ts:169-174).

## Evidence
1. [frontend/src/app/components/acceleration/active-acceleration-box/active-acceleration-box.component.ts:88–93](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/acceleration/active-acceleration-box/active-acceleration-box.component.ts#L88-L93)
   getChartData() builds each pie slice's `name` as the raw HTML string `<b style="color: white">${pool.name} (${poolShare}%)</b>` with `pool.name` taken unescaped from `miningStats.pools` (backend /api/v1/mining/pools data).
2. [frontend/src/app/components/acceleration/active-acceleration-box/active-acceleration-box.component.ts:116–128](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/acceleration/active-acceleration-box/active-acceleration-box.component.ts#L116-L128)
   The echarts tooltip is configured with `trigger: 'item'` and `formatter: (item) => item.name`, so the HTML string above is returned verbatim; echarts' default tooltip renderMode ('html') writes a string formatter result into the tooltip element via innerHTML, executing any embedded markup.
3. [frontend/src/app/components/accelerate-checkout/accelerate-checkout.component.html:87](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/accelerate-checkout/accelerate-checkout.component.html#L87)
   The chart is embedded (chartOnly) in the accelerator checkout 'quote' step; lines 330 and 366 embed it in the 'summary' and 'checkout' payment steps, so the sink executes on the page where the user is shown invoice/QR/amount data and confirms payment.
4. [frontend/src/app/components/transaction/transaction-details/transaction-details.component.html:322](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transaction/transaction-details/transaction-details.component.html#L322)
   Also rendered for every accelerated transaction on the regular transaction page (acceleratedBy pools), widening the set of visitors who hover the chart.
5. [backend/src/api/pools-parser.ts:80–92](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/pools-parser.ts#L80-L92)
   migratePoolsJson() inserts/renames pools using `pool.name` exactly as it appears in the downloaded pools-v2.json; only the slug is character-filtered, the display name is never validated or escaped.
6. [backend/src/repositories/PoolsRepository.ts:236–238](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/repositories/PoolsRepository.ts#L236-L238)
   $insertNewMiningPool persists the raw name into the pools table; $getPoolsInfo (lines 45-50) and $getPoolsInfoBetween (88-92) select `pools.name AS name` back out for the mining API.
7. [backend/src/api/mining/mining-routes.ts:138–149](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mining/mining-routes.ts#L138-L149)
   GET /api/v1/mining/pools/:interval returns the pool list including `name` to the frontend; MiningService.getMiningStats() consumes it into `miningStats.pools`, which the checkout passes to the chart.
8. [backend/src/tasks/pools-updater.ts:72–118](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/tasks/pools-updater.ts#L72-L118)
   The pool definitions are downloaded from POOLS_JSON_URL (default raw.githubusercontent.com/mempool/mining-pools/master/pools-v2.json) on every fresh install and periodically when AUTOMATIC_POOLS_UPDATE is true (Docker default), then handed to migratePoolsJson.
9. [frontend/src/app/graphs/echarts.ts:11–17](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/graphs/echarts.ts#L11-L17)
   TooltipComponent is registered with no global renderMode override, so the default HTML tooltip renderer is in effect for this chart.

## Impact
Script execution in the mempool instance origin on the payment checkout page: integrity HIGH because the payload can silently replace the invoice address/QR code and amounts the user is about to pay, or hijack the fiat payment button handlers, causing direct financial loss; confidentiality LOW because it can read localStorage (services JWT/user object on mempool.space) and observe the user's browsing of the instance; availability NONE.

## Reproduction steps
1. Attacker: whoever controls the content served at POOLS_JSON_URL — a malicious or compromised change to the third-party mempool/mining-pools repository (community PRs; a name like `Foundry USA <img src=x onerror=...>` could also be smuggled as an inconspicuous entity-encoded variant), a compromise of GitHub's raw CDN, or a mirror an operator points at. Delivery is automatic: the backend imports the name on fresh install or scheduled refresh (AT:PRESENT because the hostile document must be the one served at update time). Thereafter any unauthenticated visitor who hovers the acceleration pie chart on the checkout or on an accelerated transaction page (routine interaction, UI:PASSIVE) executes the payload in the instance origin.

## Recommended fix
1. active-acceleration-box builds echarts tooltip content by string-concatenating the unescaped pool display name into HTML and returning it from the tooltip formatter, violating the rule that externally sourced strings must be escaped (or rendered as text) before reaching an innerHTML sink. Fix criteria: Tooltip content must not interpret pool names as markup: HTML-escape `pool.name` before concatenation, or set `renderMode: 'richText'` / build the tooltip with text nodes. Verify by storing a pool whose name contains `<img src=x onerror=alert(1)>` and hovering the chart on the checkout and transaction pages: the name must appear literally and no script must run.
2. Pool display names from the remotely fetched pools-v2.json are persisted and served without validation, so one hostile upstream document poisons every page that renders names (the sibling pool-ranking tooltips share the defect). Fix criteria: Validate pool names at import (restrict to a printable character set / reject angle brackets) and audit every echarts formatter that interpolates pool names (pool-ranking.component.ts and others) to escape them. Verify by importing a pools document with a markup-bearing name and confirming it is rejected or rendered inert everywhere.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258139

---

# GET /mempool/recent sorts the entire in-memory mempool on every request

## Details
GET /api/v1/mempool/recent (also reachable as /api/mempool/recent through nginx-mempool.conf:67-68) is served by getRecentMempoolTransactions at backend/src/api/bitcoin/bitcoin.routes.ts:913-919, which on every request materialises Object.entries() over the whole in-memory mempool cache returned by mempool.getMempool() and sorts the resulting array by firstSeen to return the first 10 entries. The request carries no parameters and the handler has no cache or bound: the per-request cost is O(n log n) in n = live mempool size, which this code does not limit (it is set by Bitcoin Core's mempool limits and network conditions, commonly 100k-300k+ transactions during congestion). At that size one GET allocates hundreds of thousands of two-element arrays and runs millions of comparator calls synchronously on the single Node event loop that also drives the WebSocket feed and the 2 s mempool poll loop (`$updateMempool`).

This is per-request amplification rather than plain request volume: every other GET on this router is I/O-bound and yields to the event loop, whereas this one blocks it for a large fraction of a second (longer on the Raspberry Pi-class hardware the node distros target) for a request that costs the client nothing. A single client sending a handful of requests per second keeps the loop saturated, so WebSocket broadcasts stall and the poll loop is starved. The route is registered whenever MEMPOOL.BACKEND !== 'esplora' (bitcoin.routes.ts:81-85), which includes the Docker image's default electrum backend; the Docker nginx config proxies /api/ and /api/v1 to the backend without applying the limit_req zone that nginx.conf:35 defines (and even the defined 200 r/min per IP would allow ~3 req/s, enough from one or two IPs). Esplora-backed deployments such as mempool.space are unaffected because the route is not registered there.

The defect is a missed reuse: mempool.ts:392 already maintains an incrementally updated `latestTransactions` list (newest-first, stripped) on each mempool update, and the WebSocket handler serves recent transactions from it (websocket-handler.ts:689); the REST handler recomputes the same answer from scratch with a full sort instead.

## Evidence
1. [backend/src/api/bitcoin/bitcoin.routes.ts:913–919](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L913-L919)
   getRecentMempoolTransactions calls Object.entries(mempool.getMempool()) and sorts every entry by firstSeen to return 10 items; no cache, no bound, so each request is O(n log n) in mempool size, synchronous on the event loop.
2. [backend/src/api/bitcoin/bitcoin.routes.ts:81–85](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L81-L85)
   The route is registered on the unauthenticated public API whenever MEMPOOL.BACKEND !== 'esplora', which includes the Docker image's default electrum backend.
3. [backend/src/api/mempool.ts:392](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/mempool.ts#L392)
   An incrementally maintained newest-first `latestTransactions` list already exists and is updated per mempool poll; the WebSocket path uses it (websocket-handler.ts:689) while the REST handler ignores it and re-sorts the whole mempool.
4. [nginx-mempool.conf:64–68](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/nginx-mempool.conf#L64-L68)
   The shipped Docker nginx config proxies /api/v1 and /api/ straight to the backend on 8999 without a limit_req directive, so the zone defined in nginx.conf:35 is never applied to this route.

## Impact
Sustained requests starve the event loop that serves all REST routes, the WebSocket feed and the mempool poll loop, stalling updates and pushing the instance out of sync; service recovers when the requests stop. No confidentiality or integrity effect.

## Reproduction steps
1. Any anonymous Internet client issues repeated parameterless GET /api/mempool/recent requests against a Core-only or electrum-backed instance (the Docker default). Each request blocks the event loop for O(n log n) in the live mempool size; with a congested mempool (hundreds of thousands of transactions, a recurring network condition the attacker does not control, hence AT:P) a few requests per second from one or two IPs saturate the single backend process. No authentication, no user interaction, no crafted input beyond the URL.

## Recommended fix
The REST handler recomputes the 10 most recent mempool transactions by sorting the entire mempool cache on every request instead of serving the incrementally maintained recent list (mempool.latestTransactions) or a result cached per mempool update. Fix criteria: GET /mempool/recent is served in O(1) or O(k) time from a structure maintained during mempool ingestion (or a cache invalidated on each mempool update), so that request latency and event-loop blocking no longer scale with mempool size.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Algorithmic complexity
**CWE:** [CWE-407](https://cwe.mitre.org/data/definitions/407.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257956

---

# Production nginx proxies services upstream over unverified TLS via plaintext DNS, caching replies 30 days

## Details
The production nginx tree (`production/nginx/*`, installed verbatim by `production/install` for mempool.space-class hosts and mirrors such as mempool.ninja / liquid.place) proxies `/api/v1/services/*`, `/api/v1/assets*`, `/api/v1/contributors*`, `/api/v1/donations*` and `/api/v1/translators*` to `$mempoolSpaceServices = https://mempool.space`. Two weaknesses combine:

1. Upstream TLS is never verified. None of the six named locations in `location-api-v1-services.conf` sets `proxy_ssl_verify on`, `proxy_ssl_trusted_certificate` or `proxy_ssl_server_name`; nginx's documented default is `proxy_ssl_verify off`, so nginx completes the handshake with whatever certificate is presented by whoever answers at the resolved address.

2. Because `proxy_pass` takes a variable, nginx resolves `mempool.space` at request time through `resolver 8.8.8.8;` — plain UDP DNS to a third-party resolver with no DNSSEC or transport authentication. An attacker on the host's egress path, or able to spoof replies from that resolver, chooses the upstream IP, and (1) means the substitution is undetected. Even with correct DNS, an on-path party on the TCP/443 path to mempool.space can terminate the TLS session itself.

The impersonated responses are not merely passed through. `@mempool-api-v1-services-cache-long` stores 200 responses for `/api/v1/{contributors,donations,translators}/images/*` for 30 days and `-medium` stores the `/contributors`, `/donations`, `/translators` JSON for 7 days in the shared `proxy_cache services` zone (`http-proxy-cache.conf:2`, inactive=30d). A single interception window therefore fixes what every visitor of the About page sees for up to a month after the attacker's network position is gone. Only `Onion-Location`, HSTS, CSP, X-Frame-Options and cache headers are stripped from the upstream reply, so the attacker also controls `Content-Type` and body served from the mirror's own origin at these paths.

The frontend sends the About-page data and image requests, `/api/v1/services/sponsors` and `/api/v1/services/enterprise/info/<name>` relative to the site origin (`api.service.ts:31,134-146,448`; `about.component.html:559,729,743,755`), so they traverse this proxy. Login, account and accelerator flows do not: they use `env.SERVICES_API`, which defaults to the absolute `https://mempool.space/api/v1/services` (`state.service.ts:138`) and is not overridden by any `production/mempool-frontend-config.*.json`, so browsers reach mempool.space directly with browser-side certificate validation; no credential is exposed through this proxy, and the only cookie set on the mirror origin is `lang`.

The Docker sibling (`nginx-mempool.conf`) has the same missing verification and is filed separately as docker-services-proxy-unverified-tls.

## Evidence
1. [production/nginx/location-api-v1-services.conf:37–39](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/nginx/location-api-v1-services.conf#L37-L39)
   `proxy_pass $mempoolSpaceServices` (https://mempool.space) with no `proxy_ssl_verify on`, `proxy_ssl_trusted_certificate` or `proxy_ssl_server_name`; nginx's documented default `proxy_ssl_verify off` means any certificate presented by whoever answers at the resolved address is accepted. The same unverified `proxy_pass` appears in all six named locations (lines 68, 122, 153, 208, 239).
2. [production/nginx/location-api-v1-services.conf:238–266](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/nginx/location-api-v1-services.conf#L238-L266)
   `@mempool-api-v1-services-cache-long` stores any 200 from the unverified upstream in the shared `proxy_cache services` zone for 30 days (`proxy_cache_valid 200 30d`) for `/api/v1/{contributors,donations,translators}/images/*`; `-medium` (207-236) stores the `/contributors`, `/donations`, `/translators` JSON for 7 days. One impersonated response is replayed to every visitor long after the interception ends.
3. [production/nginx/nginx.conf:14](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/nginx/nginx.conf#L14)
   `resolver 8.8.8.8;` — because `proxy_pass` uses a variable, nginx resolves `mempool.space` at request time over unauthenticated UDP DNS to a third-party resolver (no DNSSEC/DoT), so a spoofed or on-path-rewritten answer selects the upstream address; (1) means the substitution is never detected.
4. [production/nginx/nginx.conf:53](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/nginx/nginx.conf#L53)
   `set $mempoolSpaceServices "https://mempool.space"` — the upstream is a public hostname reached across the Internet, not a loopback or private address; both the mempool (line 53) and liquid (line 95) server blocks include location-api-v1-services.conf.
5. [production/install:1818–1821](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/install#L1818-L1821)
   The install script copies production/nginx/nginx.conf onto the production host verbatim, substituting only `__NGINX_USER__` and `__NGINX_ETC_FOLDER__`; no local validating resolver is installed and nothing adds TLS verification, so the shipped configuration is what runs.
6. [frontend/src/app/services/api.service.ts:134–146](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/services/api.service.ts#L134-L146)
   Visitors' browsers fetch `/api/v1/services/sponsors`, `/api/v1/donations`, `/api/v1/translators` and `/api/v1/contributors` relative to the site origin (`apiBaseUrl = ''`, line 31), so on a host running this nginx tree these requests traverse the unverified proxy; `/api/v1/services/enterprise/info/<name>` (line 448) likewise.
7. [frontend/src/app/components/about/about.component.html:743](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/about/about.component.html#L743)
   About-page `<img [src]="'/api/v1/contributors/images/' + contributor.id">` (also 559 donations, 729 translators, 755) is the visitor request that populates and reads the 30-day cache entry.

## Impact
Integrity LOW: attacker-chosen JSON and image bodies (with attacker-chosen Content-Type, since only CSP/XFO/HSTS/cache headers are hidden) are served from the mirror's own origin at About-page, sponsor and enterprise-info paths to every visitor and persist in the shared proxy cache for up to 30 days. Confidentiality NONE: auth/account/accelerator traffic goes directly to the absolute `SERVICES_API` with browser-side validation, the mirror origin carries only a `lang` cookie, and the impostor learns only X-Real-IP/Host of About-page requests. Availability NONE beyond what a MITM already has.

## Reproduction steps
1. Attacker: machine-in-the-middle on the production host's egress path to mempool.space, or able to spoof the UDP DNS answer from 8.8.8.8 for mempool.space. They answer nginx's TLS handshake with any certificate; nginx accepts it (default proxy_ssl_verify off). The attacker then issues their own anonymous GET for `/api/v1/contributors/images/<id>` (or `/contributors`, `/donations`, `/translators`, `/services/sponsors`) against the mirror; nginx fetches from the impostor and stores the 200 in the shared `services` cache for 30d/7d. No victim action is needed to poison; visitors later receive the content. Network position is the sole precondition (AT:PRESENT).

## Recommended fix
1. All six services upstream locations use `proxy_pass https://...` with nginx's default `proxy_ssl_verify off`, so the identity of the services upstream is never authenticated and any party at the resolved address is accepted. Fix criteria: The proxy must refuse (502) any upstream whose certificate does not validate against a trusted CA for the configured hostname, with SNI enabled. Verify by directing the hostname to a server with a self-signed certificate and confirming no response is forwarded or cached.
2. Runtime hostname resolution for the upstream goes over unauthenticated UDP DNS to a public resolver (`resolver 8.8.8.8`), letting an on-path or spoofing party choose the upstream address. Fix criteria: Upstream address selection must not be influenceable by spoofed DNS: use a local validating resolver, a static upstream address, or at minimum make certificate verification the authoritative check so a wrong address cannot yield an accepted connection. Verify by returning a spoofed A record and confirming the proxy rejects the connection.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper certificate validation
**CWE:** [CWE-295](https://cwe.mitre.org/data/definitions/295.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257952

---

# Client-triggered 4xx from esplora counted as host failure, forcing failover

## Details
FailoverRouter in backend/src/api/bitcoin/esplora-api.ts decides which esplora/electrs host the whole backend talks to. $query (lines 413-444) counts any request error whose HTTP status is not 404 as a failure of the host (addFailure, lines 249-259); after more than five failures in multi-host mode the active host is flagged unreachable and electHost() moves all traffic to the next-ranked FALLBACK host. Successful requests only decrement the counter by one.

The counter does not distinguish genuine host faults (connection refused, timeouts, 5xx) from 4xx responses caused by the request itself. Client-controlled values that reach the esplora URL unvalidated therefore let an anonymous client inflate the failure counter. A concrete path exists in shipped code: on Liquid instances (liquid.network is run by the maintainers on the esplora backend with fallback hosts), GET /api/v1/blocks/-1 is routed to getLegacyBlocks (bitcoin.routes.ts:659-692), which computes Math.min(parseInt('-1') || tip, tip) = -1 and calls bitcoinApi.$getBlockHash(-1); ElectrsApi.$getBlockHash builds '/block-height/-1' (esplora-api.ts:529), which esplora/electrs rejects with 400 Bad Request (height must parse as usize). That is not 404, so addFailure runs.

Six or more such requests in parallel (faster than the backend's own successful polling requests can decrement the counter) flag the preferred local host unreachable and divert every esplora request the backend makes - mempool polling, block fetches, address lookups - to a remote fallback until the next 60-second health poll clears the flag, after which the attacker repeats. By repeating against each newly elected host the attacker can cycle the backend through every configured host, keeping it on slower or differently-synced hosts indefinitely, which degrades the instance (latency, REQUEST_TIMEOUT failures) and can make block/mempool data inconsistent between polls.

On Bitcoin networks the /blocks/:height route clamps the height (blocks.$getBlocks returns early for NaN/negative), and the other esplora-backed routes validate hashes/txids to hex so unknown values yield 404; no equivalent 4xx trigger was found there, but the failure-accounting flaw applies to any present or future unvalidated path reaching $query. The condition for exploitation is therefore: esplora backend with ESPLORA.FALLBACK configured (multihost) and a Liquid network.

## Evidence
1. [backend/src/api/bitcoin/esplora-api.ts:430–443](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/esplora-api.ts#L430-L443)
   $query's catch treats every error whose HTTP status is not 404 - including a 400 esplora returns for a malformed path built from client input - as a fault of the upstream host and calls addFailure(host); only transport errors (ECONNREFUSED) trigger the immediate retry, but all non-404 errors feed the counter.
2. [backend/src/api/bitcoin/esplora-api.ts:249–259](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/esplora-api.ts#L249-L259)
   addFailure increments host.failures and, once it exceeds 5 with multihost (FALLBACK non-empty), flags the active host unreachable and calls electHost(), moving every esplora request the backend makes to the next-ranked fallback host.
3. [backend/src/api/bitcoin/bitcoin.routes.ts:659–672](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L659-L672)
   On Liquid networks GET /api/v1/blocks/:height (registered at line 54, dispatched via getBlocks at 566) computes Math.min(parseInt(height) || tip, tip); a negative height such as -1 is truthy and below tip, so it passes unchanged to bitcoinApi.$getBlockHash(-1). The Bitcoin branch (blocks.$getBlocks) returns early for negative/NaN heights and is not affected.
4. [backend/src/api/bitcoin/esplora-api.ts:528–530](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/esplora-api.ts#L528-L530)
   $getBlockHash concatenates the height into '/block-height/' + height without validation, producing /block-height/-1 which esplora rejects with 400 (height must parse as usize), not 404.
5. [backend/src/api/bitcoin/esplora-api.ts:186–198](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/esplora-api.ts#L186-L198)
   The health poller clears the unreachable flag only when it next checks each host (60-second cycle, index.ts:126-128 starts it for the esplora backend), so a tripped failover persists for up to a minute and can be re-triggered indefinitely with ~6 requests per cycle.
6. [production/mempool-config.liquid.json:27–29](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/production/mempool-config.liquid.json#L27-L29)
   The maintainers' own liquid.network deployment runs NETWORK liquid with BACKEND esplora over a local unix socket and a non-empty ESPLORA.FALLBACK list of remote nodes, i.e. exactly the multihost Liquid shape in which this path is live; production nginx (location-liquid-api.conf:32-35, 100-113) proxies /api/v1/blocks/* to the backend and caches only 200 responses, so each 500 reaches the backend.

## Impact
The attacker controls which upstream esplora host the whole backend uses, forcing every esplora request (mempool polling at POLL_RATE_MS, block tx fetches, address summaries) from the local unix socket onto remote fallback datacenters, adding latency, risking REQUEST_TIMEOUT failures and delaying block/mempool updates for all users of the instance: a partial, sustained availability degradation. Block tip height is read from Core RPC (blocks.ts:1363) and fallback hosts are operator-configured and trusted, so the attacker cannot alter or falsify served data: integrity NONE. No disclosure.

## Reproduction steps
1. An anonymous Internet client sends ~6 parallel GET /api/v1/blocks/-1 (or -2, -3 ... to defeat any URI cache) requests to a Liquid instance running the esplora backend with ESPLORA.FALLBACK configured. Each request reaches getLegacyBlocks, which passes the negative height to ElectrsApi.$getBlockHash; esplora answers 400, $query counts it as a host failure, and on the sixth the active host is flagged unreachable and traffic fails over. Successful backend polls decrement the counter only by one each, so a short burst outpaces them. Repeating each minute (and against each newly elected host) keeps the backend off its preferred local host. Requires the deployment shape the project itself runs on liquid.network (esplora backend, fallback list, Liquid network) but no privileges or user interaction. Dependency assumption: mempool/electrs (Blockstream esplora fork) rest.rs returns HTTP 400 for /block-height/<non-usize> (ParseIntError mapped to a BAD_REQUEST HttpError); this could not be verified in the checkout, but the backend code counts any non-404 error identically.

## Recommended fix
1. Host-health accounting in FailoverRouter.$query treats request-specific 4xx responses as evidence that the host is unhealthy, so client-triggerable upstream rejections drive failover decisions. Fix criteria: Only transport-level errors, timeouts and 5xx responses should count toward a host's failure score; 4xx responses must not. Verify that a burst of malformed client requests leaves activeHost unchanged and failures unincremented.
2. ElectrsApi.$getBlockHash and the Liquid getLegacyBlocks route pass unvalidated (negative) heights into the esplora URL. Fix criteria: Heights reaching $getBlockHash must be validated as non-negative integers (and clamped to the tip) before any upstream request; verify GET /api/v1/blocks/-1 on Liquid returns 400 locally without contacting esplora.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper error handling
**CWE:** [CWE-754](https://cwe.mitre.org/data/definitions/754.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257947

---

# Address lookups publish the queried address to all WebSocket clients via loading indicators

## Details
On instances running the electrum backend (MEMPOOL.BACKEND='electrum', the default in docker/backend/start.sh line 5 and the usual node-distro configuration), BitcoindElectrsApi.$getAddressTransactions and $getScriptHashTransactions (backend/src/api/bitcoin/electrum-api.ts:87-110, 161-191) report progress through the process-global LoadingIndicators singleton with the key 'address-' + <the address or scripthash the HTTP client asked for>. LoadingIndicators.setProgress (loading-indicators.ts:15-25) stores the key in one shared map and calls the registered callback with the whole map on every update. That callback is WebSocketHandler.handleLoadingChanged (index.ts:375; websocket-handler.ts:489-506), which JSON-serialises the full map and sends it to every OPEN WebSocket client with no want-list or per-client scoping, and also writes it into the socket init data that is returned by GET /api/v1/init-data (bitcoin.routes.ts:115-123) and sent to each new WebSocket client on 'init' (websocket-handler.ts:419-427).

Consequently, while any user's unauthenticated GET /api/v1/address/:address/txs (bitcoin.routes.ts:102, 758-786) or /scripthash/:scripthash/txs is in flight - up to 10 transactions each fetched from Core with full prevouts via $getRawTransaction(txid,false,true) -> $addPrevouts, one extra RPC per input, so typically hundreds of ms to seconds - every other client connected to the instance receives messages such as {"loadingIndicators":{"address-bc1q...":40}} naming that address. Worse, when the address has no history (or pagination starts at the end), endIndex === startingIndex, the loop never executes and no setProgress(...,100) is ever issued, so the key is never deleted: 'address-<addr>' remains in the map and in the init data for every subsequent connection until the backend restarts. Fresh, not-yet-funded receive addresses - exactly the ones a user checks while waiting for a payment - are therefore disclosed persistently, not transiently.

The shipped frontend only reads indicators['address-' + this.addressString] for the page it is displaying (frontend/src/app/components/address/address.component.ts:175-179), so the feature's intent is per-requester progress; the cross-client disclosure is a side effect of using the global broadcast channel. Looking up an address on a block explorer links the observer to that address, and self-hosted instances exist precisely so that only the operator sees such lookups; here any anonymous third party who keeps a WebSocket open or polls /api/v1/init-data harvests the addresses other users of the instance are querying. The same pattern with 'blocktxs-' + hash in bitcoin.routes.ts:700-718 discloses only block hashes being browsed, which is far less sensitive.

## Evidence
1. [backend/src/api/bitcoin/electrum-api.ts:86–112](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/electrum-api.ts#L86-L112)
   $getAddressTransactions calls loadingIndicators.setProgress('address-' + address, 0) at line 87 and again after each of up to 10 transactions at line 105 using the client-requested address as the key of the process-global indicator map. The key is only deleted when progress reaches 100 (last loop iteration or the catch at line 110). When the address has no history (endIndex === startingIndex) the loop never runs and no 100 is ever set, so 'address-<addr>' stays in the map at 0 until the process restarts.
2. [backend/src/api/bitcoin/electrum-api.ts:159–193](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/electrum-api.ts#L159-L193)
   $getScriptHashTransactions does the same with 'address-' + <requested scripthash> (lines 161, 186, 191), with the same empty-history persistence.
3. [backend/src/api/websocket-handler.ts:489–505](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L489-L505)
   handleLoadingChanged (registered as the progress callback in index.ts:375) stores the whole map into the socket init data and JSON-serialises it to every OPEN WebSocket client on every server, with no want-list or per-client filter.
4. [backend/src/api/loading-indicators.ts:15–25](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/loading-indicators.ts#L15-L25)
   setProgress writes the key into the singleton map and invokes the callback with the entire map on every call; keys are removed only when progressPercent >= 100.
5. [backend/src/api/bitcoin/bitcoin.routes.ts:758–785](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L758-L785)
   Unauthenticated public entry point GET /api/v1/address/:address/txs (registered at line 102; scripthash variant at 106/845-871) passes req.params.address straight to bitcoinApi.$getAddressTransactions after only a /^[a-z0-9]{2,120}$/i shape check.
6. [backend/src/api/bitcoin/bitcoin.routes.ts:115–122](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/bitcoin/bitcoin.routes.ts#L115-L122)
   GET /api/v1/init-data returns websocketHandler.getSerializedInitData(), which embeds the current indicator map, so the keys are also readable by plain HTTP polling.
7. [backend/src/api/websocket-handler.ts:419–426](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L419-L426)
   On a client's 'init' action the serialized init data (including 'loadingIndicators' from updateSocketData line 103) is sent to the new client, so every fresh connection receives in-flight and stuck address keys.
8. [frontend/src/app/components/address/address.component.ts:175–178](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/address/address.component.ts#L175-L178)
   The shipped frontend reads only indicators['address-' + this.addressString] for the page it is showing, establishing that the feature is meant to deliver progress to the requesting client; the broadcast of other clients' keys is an unintended side effect of the global channel.

## Impact
Disclosure is limited to the Bitcoin addresses/scripthashes other users of the instance are currently (or, for empty-history addresses, have ever since restart) looked up - a privacy leak that links an unknown user of the instance to an address - not identity, credentials or account data; no integrity or availability effect.

## Reproduction steps
1. The attacker is any anonymous Internet client (threat-model adversary 1): open the public WebSocket at /api/v1/ws (or poll GET /api/v1/init-data) on an electrum-backed instance and record the keys of every loadingIndicators message. No message other than the normal 'init' is needed, no privileges, and no interaction by the victim beyond ordinary use of the explorer. Disclosure of a given lookup is transient (the key exists only while that request is in flight, which is why AT is PRESENT), except for empty-history addresses whose keys persist until restart. Requires MEMPOOL.BACKEND='electrum', which is the Docker default.

## Recommended fix
1. Per-request progress for address/scripthash lookups is keyed by the requested identifier in a process-global map that handleLoadingChanged broadcasts to every WebSocket client and embeds in init data, so one client's query is disclosed to all others. Fix criteria: Progress for a client's address or scripthash request must be delivered only to that client (or not at all): remove request-derived keys from the globally broadcast map and init data, or scope such indicators to the originating connection. A WebSocket client or an /api/v1/init-data caller must never receive loadingIndicators entries derived from another client's address, scripthash or block lookup.
2. Request-scoped indicator keys are only removed when progress reaches 100, which never happens when the transaction loop does not execute (empty history or pagination past the end), so keys accumulate in the global map and init data until restart. Fix criteria: Any request-scoped indicator must be removed when the request completes on every path (success with zero transactions, pagination past the end, and error), so the map never retains a request-derived key after the response is sent.

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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257941

---

# Rune etching divisibility drives unbounded BigInt exponentiation on every render of ord-data

## Details
The ord-data widget converts rune amounts for display with `getAmount(amount, divisibility)`, which evaluates `BigInt(10) ** BigInt(divisibility)` (ord-data.component.ts:83). `divisibility` comes unvalidated from the runestone's Divisibility field (rune.utils.ts:203: `Number(message.fields[Tag.Divisibility]?.[0] ?? 0n)`); the Runes protocol limits it to 38 (ord discards larger values) but this decoder accepts any varint. The exponent is therefore attacker-chosen, and the cost and size of the exponentiation grow with it: a divisibility around 3x10^8 produces a result of roughly 10^9 bits, just under V8's BigInt ceiling, costing seconds of CPU and ~125 MB per evaluation; an exponent between that and the engine limit performs the same squaring chain and then throws RangeError ("Maximum BigInt size exceeded") inside the template.

The template (ord-data.component.html:12) calls getAmount three times in a single interpolation whenever `runestone.etching.supply` is truthy and `premine > 0`. The component is OnPush, so the three evaluations run on first render and again whenever the view is re-checked: the parent's Runestone row (transactions-list.component.html:425-432, `*ngIf="...show"`) destroys and recreates the widget on each toggle, and any click inside the widget or change of the bound input re-runs the interpolation. ngOnChanges (ord-data.component.ts:29-39) performs the same call once for mints whose etching (also attacker-authored, fetched by rune id through ord-api.service.ts:57-78 and decoded by the same decoder) carries terms.amount.

Trigger: a transaction with an OP_RETURN OP_13 output whose payload is a handful of bytes - Flags=ETCHING (02 01), Premine=1 (06 01), Divisibility=300,000,000 (01 + 5-byte LEB128) - about 10 bytes, standard under every historical relay policy. transactions-list marks any `6a5d` output as a runestone (ts:305-309) and shows a Runestone badge on the transaction page and in address/block/wallet lists; a visitor who clicks it has the runestone decoded and bound to app-ord-data, and the browser tab stalls on the exponentiation (or the component errors out). The backend does not parse runestones, so the sink is frontend-only. This is distinct from `rune-leb128-unbounded-bigint-quadratic-decode`, which concerns quadratic varint decoding of a 100 kB payload and whose fix (cap varint width to 128 bits, validate Rune/Spacers) leaves a 29-bit divisibility untouched.

Engine assumptions (the visitor's browser, not pinned by the repository): V8 (Chromium) implements BigInt exponentiation by square-and-multiply with a 2^30-bit maximum, rejecting exponents >= 2^30 cheaply but computing every exponent below it (any exponent >= 2^28 forces the squaring chain up to 10^(2^28), about 8.9x10^8 bits, before succeeding or throwing); SpiderMonkey (Firefox) has a smaller ceiling and slower multiplication. Impact is availability of the explorer frontend in the clicking visitor's tab only; a reload recovers.

## Evidence
1. [frontend/src/app/components/ord-data/ord-data.component.ts:82–87](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/ord-data/ord-data.component.ts#L82-L87)
   getAmount computes `BigInt(10) ** BigInt(divisibility)` with no bound on divisibility. The Runes protocol caps divisibility at 38 (ord ignores larger values), but neither the decoder nor this method enforces it; a divisibility of a few hundred million makes the engine build a BigInt of up to ~10^9 bits by repeated squaring (or throw RangeError after doing that work). This is the primary location to fix.
2. [frontend/src/app/components/ord-data/ord-data.component.html:8–16](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/ord-data/ord-data.component.html#L8-L16)
   When an etching with truthy supply and premine > 0 is shown, the interpolation on line 12 calls getAmount(runestone.etching.premine, runestone.etching.divisibility || 0) three times. The component is OnPush, so this runs at least three times on first render and again each time the view is re-checked (the Runestone row is toggled closed/open, a click lands inside the widget, or the input reference changes).
3. [frontend/src/app/components/ord-data/ord-data.component.ts:29–39](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/ord-data/ord-data.component.ts#L29-L39)
   ngOnChanges also calls getAmount(terms.amount, etching.divisibility) for a mint whose etching was fetched by rune id (ord-api.service.ts:57-78 decodes that etching transaction with the same unvalidated decoder), so the cost is also reachable from any mint of an attacker-etched rune.
4. [frontend/src/app/shared/ord/rune.utils.ts:197–225](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/rune.utils.ts#L197-L225)
   messageToRunestone sets etching.divisibility = Number(fields[Tag.Divisibility][0]) straight from the decoded varint, premine from tag 6, and supply = cap*amount + premine; none are range-checked, so a runestone with Flags=ETCHING, Premine=1 and Divisibility=300000000 yields etching.supply truthy, premine > 0 and a huge divisibility.
5. [frontend/src/app/shared/ord/rune.utils.ts:242–255](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/rune.utils.ts#L242-L255)
   decipherRunestone strips OP_ tokens from the asm of the first output starting 6a5d and decodes the remaining bytes; the trigger payload (02 01 06 01 01 <5-byte LEB128 of 3e8>) is 10 bytes, inside even the historical 80-byte OP_RETURN standardness limit, so no large or non-standard transaction is needed.
6. [frontend/src/app/components/transactions-list/transactions-list.component.ts:647–660](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transactions-list/transactions-list.component.ts#L647-L660)
   Clicking the Runestone badge (set for any 6a5d output at lines 305-309 and rendered by the template at lines 364-366 on every non-Liquid network) calls decodeRunestone$ and assigns the decoded runestone into showOrdData, which the template (line 430) binds to <app-ord-data [runestone]> and starts the rendering described above.

## Impact
The explorer frontend in the clicking visitor's browser becomes unresponsive for seconds to minutes (three ~10^9-bit exponentiations, each ~125 MB) while the widget renders and on each re-check, or the widget fails with a RangeError. No confidentiality or integrity effect; only that visitor's tab is affected and a reload recovers, so availability is LOW, consistent with the sibling ord records.

## Reproduction steps
1. Attacker broadcasts a tiny, standard transaction with a `6a5d` OP_RETURN carrying Flags=ETCHING, Premine=1, Divisibility=~3e8 (or etches such a rune once and lets any later mint of it trigger the same path). The explorer shows a Runestone badge for that output wherever the transaction is listed. A visitor clicks it (UI: Active); the runestone is decoded and bound to app-ord-data, whose template evaluates 10n ** 300000000n three times on render (and again on every re-check of the OnPush view), stalling the tab for seconds or throwing RangeError in the view. No privileges, no special configuration, no race; the backend does not parse runestones so no server-side control exists.

## Recommended fix
1. The exponent of a BigInt exponentiation is taken directly from chain data with no upper bound, so the attacker controls the size (and cost) of the computed value. Fix criteria: Divisibility is validated against the protocol maximum (38) when the runestone is decoded or before getAmount uses it; out-of-range values make the etching undecodable/cenotaph or clamp the divisor. After the fix, a runestone with Divisibility=300000000 renders (or is rejected) without any BigInt larger than ~128 bits being constructed.
2. The template invokes getAmount on every change-detection cycle, so any expensive conversion is repeated indefinitely while the widget is visible. Fix criteria: Display amounts are computed once when the runestone input changes (e.g. in ngOnChanges or a pure pipe) rather than per render, so a single costly conversion cannot recur on every change-detection pass.

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
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258158

---

# Unbounded stratum merkleBranches array drives quadratic grid and DOM allocation in stratum pages

## Details
The stratum pages render each job's merkle branch array as a grid whose width is the largest `merkleBranches.length` seen across all jobs, with no upper bound anywhere between the stratum upstream and the DOM.

Data path: a mining pool's stratum server emits `mining.notify` (job id, prevhash, coinb1/coinb2, merkle_branch[], version, nbits, ntime); the operator-configured STRATUM.API relay forwards it as JSON to backend/src/api/services/stratum.ts, which only checks key presence (isStratumJob, lines 28-40) and stores `this.jobs[msg.pool] = msg`. websocket-handler.ts returns all jobs verbatim to any client sending `track-stratum` (449-457) and pushes each new job to tracking clients (1371-1384). The frontend stores them in stratumJobs$ unchanged.

Sinks: stratum-list.component.ts processJobs() (100-188) computes numBranches = max(length), allocates numBranches ids per job, iterates the tree build numBranches times over all jobs, pre-allocates a jobs x (numBranches+1) grid, and the template (stratum-list.component.html:20-32) emits a <td><div> pair per cell for every row. pool.component.html:278-300 renders a <td> per branch for the tracked pool's job. In real Bitcoin a job carries at most ~13 branches; a job declaring e.g. 500,000 entries (empty strings are accepted - getMerkleBranchIds substitutes a synthetic id - so the message is only ~1.5 MB) makes the ~20 rows on mempool.space's /stratum page expand to ~2x10^7 DOM nodes plus the matching JS arrays, freezing or OOM-killing the tab of every visitor currently on /stratum or on that pool's /mining/pool/<slug> page, and again on every reload while the job remains the pool's latest. The work is deterministic and proportional to a value the producer chooses, not to request volume. Smaller malformed fields in the same unvalidated object also crash rendering (reverseHash on a <2-char branch -> TypeError at stratum-list.component.ts:203 / pool.component.ts:364; non-string scriptsig -> hex2ascii TypeError).

Who can trigger it: the job fields are authored by the pool whose stratum endpoint the relay subscribes to, not by the mempool operator; the relay (mempool/stratum-observer, outside this repo) is assumed to pass merkle_branch through unmodified. The threat model lists remote data providers as a second-order adversary and the ledger previously dismissed the backend-side `jobs[msg.pool]` sink as operator-trusted (dismissed-stratum-57-84a4); this finding is about the untrusted pool-authored content, and is filed with that doubt stated. Conditions: STRATUM.ENABLED / STRATUM_ENABLED must be true (default false in mempool-config.sample.json, Docker start.sh and the frontend sample config; enabled on mempool.space) and a hostile or compromised pool (or relay) must be among the subscribed upstreams.

## Evidence
1. [frontend/src/app/components/stratum/stratum-list/stratum-list.component.ts:100–142](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/stratum/stratum-list/stratum-list.component.ts#L100-L142)
   processJobs() takes numBranches = max(job.merkleBranches.length) over every job received from the WebSocket (line 101) with no cap, then allocates numBranches ids per job (getMerkleBranchIds, lines 51-63 / 104), runs the tree-building loop numBranches times over all jobs (116-132) and pre-allocates a jobs x (numBranches+1) cell grid (135-142). Work and memory are O(jobs x numBranches) and are dictated entirely by the length a single job declares.
2. [frontend/src/app/components/stratum/stratum-list/stratum-list.component.html:20–32](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/stratum/stratum-list/stratum-list.component.html#L20-L32)
   Every row renders one <td> plus a <div> per merkle cell (@for over row.merkleCells), so the oversized grid becomes 2 x jobs x numBranches DOM nodes; a single hostile job inflates every row on the page.
3. [frontend/src/app/components/pool/pool.component.html:278–299](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/pool/pool.component.html#L278-L299)
   Second sink: the pool page renders a <td> per entry of job.merkleBranches for the tracked pool's job (and colspan = max(length, 12)), again unbounded, so a hostile job also hangs /mining/pool/<slug> for that pool.
4. [backend/src/api/services/stratum.ts:28–59](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/services/stratum.ts#L28-L59)
   isStratumJob() only checks that the keys exist ('merkleBranches' in obj); neither the type nor the length of merkleBranches, nor the type of pool/scriptsig/prevHash, is validated before the job is stored and fanned out.
5. [backend/src/api/websocket-handler.ts:449–456](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/websocket-handler.ts#L449-L456)
   On 'track-stratum' the backend serialises every stored job verbatim (JSON.stringify(stratumApi.getJobs())) to the client; handleNewStratumJob (1371-1384) pushes each new job to all tracking clients. send() (1386-1392) only drops a client whose buffer is already over 10 MB, so a single multi-megabyte job message passes through.
6. [frontend/src/app/services/state.service.ts:328–344](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/services/state.service.ts#L328-L344)
   The frontend merges received jobs into stratumJobs$ without validation; stratum-list.component.ts:94-96 and pool.component.ts:145-156 render straight from it.

## Impact
Impact is confined to visitors' browser tabs rendering the stratum views: the tab freezes or is OOM-killed, repeatedly while the job is current. No data exposure or modification; the backend itself only relays the message.

## Reproduction steps
1. Attacker position: a mining pool (or whoever controls the stratum feed between pool and the operator's STRATUM.API relay) whose jobs the instance observes; on mempool.space STRATUM is enabled (production/mempool-config.mainnet.json:201-204) and ~20 public pools are subscribed. One mining.notify with an enormous merkle_branch array (empty strings suffice, ~3 bytes each) is accepted by isStratumJob on key presence alone and fanned out to every client on /stratum or that pool's page; each browser synchronously builds a jobs x branches grid (stratum-list.component.ts:100-143) and 2 DOM nodes per cell for every row, so a ~150 KB message yields millions of DOM nodes and a frozen or OOM-killed tab, repeated on every reload while the job is current. No privileges on the instance; the victim need only be viewing the page (UI:P). Assumptions, stated not verified: the relay (mempool/stratum-observer, outside this repo) passes merkle_branch through unmodified; the backend's ws ~8.22.0 client WebSocket default maxPayload (100 MiB) admits the message. STRATUM.ENABLED is false by default (config.ts:345-348), so the attack requires an instance with the stratum feature on and the hostile pool among its upstreams (AT:P).

## Recommended fix
1. The frontend sizes its merkle grid and DOM directly from the producer-declared merkleBranches length, with no sanity bound, so a single hostile job scales work for every row and every viewer. Fix criteria: Rendering must be bounded independently of upstream data: cap the number of merkle columns (e.g. at a protocol-plausible maximum such as 32) and ignore or truncate jobs exceeding it, and guard reverseHash/hex2ascii against non-hex or short strings. Verify by injecting a job with 10^6 branches via stratumJobs$ and confirming /stratum and /mining/pool/<slug> render promptly.
2. backend/src/api/services/stratum.ts accepts any JSON object containing the expected keys and republishes it unchanged to all tracking WebSocket clients. Fix criteria: Validate job shape and size on ingest (types of pool/height/scriptsig/prevHash, merkleBranches an array of <=N 64-hex strings, overall serialised size cap) and drop non-conforming jobs before storing or broadcasting; a job with an oversized or non-string merkleBranches array must never reach clients.

---
**Severity:** LOW
**Status:** Open
**Category:** Uncontrolled resource consumption
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258156

---

# Inscription decoder: negative OP_PUSHDATA4 length rewinds pointer into non-terminating loop

## Details
The frontend inscription parser (frontend/src/app/shared/ord/inscription.utils.ts) does not guarantee forward progress when walking push opcodes, and an 11-byte sequence placed anywhere in a taproot script-path witness makes it loop forever while allocating.

Root cause: `readPushdata` decodes the OP_PUSHDATA4 length with `littleEndianBytesToNumber`, which ORs shifted bytes into a signed 32-bit integer (`number |= byte << (8*i)`). Lengths with the high bit set come back negative. The result is passed unchecked to `readBytes(raw, nextPointer, dataSize)`, which returns an empty slice and a pointer of `nextPointer + dataSize` - i.e. a pointer that moves backwards. For the bytes `4e fb ff ff ff` at position p, dataSize is -5 and the returned pointer is exactly p, the OP_PUSHDATA4 byte itself. `extractFields` (lines 343-360) and the body loop of `extractInscriptionData` (lines 390-393) only terminate when the pointer reaches the end or lands on 0x00/0x68 at a push boundary; with the pointer pinned to 0x4e they iterate forever, pushing a new object/typed array each round. Nothing throws, so the try/catch in extractInscriptionData never fires. The tab's main thread is blocked and heap grows until the renderer is killed.

Delivery: `OrdApiService.decodeInscriptions` scans the raw bytes for the ord marker `00 63 03 6f 72 64` without opcode alignment, so the trigger need not be a real envelope. A valid, spendable tapscript such as `OP_PUSHBYTES_11 00 63 03 6f 72 64 4e fb ff ff ff OP_DROP <32-byte key> OP_CHECKSIG` (the malformed push lives inside the data of a legitimate push, so Bitcoin Core's script parser never sees it) or a normal inscription whose body contains those 11 bytes both work. transactions-list.component.ts:333-336 flags the input on the substring match and shows the Inscription badge wherever the transaction is listed; a visitor who clicks it runs the decoder synchronously.

Relation to existing record `ord-inscription-decoder-quadratic-marker-rescan`: that finding is a Theta(N^2) slowdown from re-parsing at every marker in a large (~390 kB) witness. This is a different defect - non-termination caused by signed length decoding and the absence of a forward-progress check - reachable with a tiny payload, and its remediation (resume from envelope end, cap envelopes) would not reject a negative push length or detect a stalled pointer. Only the clicking visitor's own tab is affected and a reload recovers, but the crash is deterministic and driven by untrusted chain bytes (threat-model adversary 2).

## Evidence
1. [frontend/src/app/shared/ord/inscription.utils.ts:203–214](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/inscription.utils.ts#L203-L214)
   readPushdata handles OP_PUSHDATA4 by reading 4 length bytes, converting them with littleEndianBytesToNumber, and calling readBytes(raw, nextPointer, dataSize) with no check that dataSize is non-negative or fits the remaining bytes. A negative dataSize makes the returned pointer smaller than the opcode position that was just consumed.
2. [frontend/src/app/shared/ord/inscription.utils.ts:286–293](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/inscription.utils.ts#L286-L293)
   littleEndianBytesToNumber accumulates with `number |= byteArray[i] << (8 * i)`. JavaScript bitwise operators are signed 32-bit, so any 4-byte length with the top bit set (>= 0x80000000) comes back negative; bytes fb ff ff ff give -5.
3. [frontend/src/app/shared/ord/inscription.utils.ts:159–161](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/inscription.utils.ts#L159-L161)
   readBytes returns `[raw.slice(pointer, pointer + n), pointer + n]`. For negative n the TypedArray slice is empty (end < start) and the new pointer is pointer + n, i.e. it moves backwards. With n = -5 from a PUSHDATA4 at position p, nextPointer is p+5 and the returned pointer is exactly p again.
4. [frontend/src/app/shared/ord/inscription.utils.ts:337–362](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/inscription.utils.ts#L337-L362)
   extractFields loops `while (newPointer < raw.length && raw[newPointer] !== OP_0 && raw[newPointer] !== OP_ENDIF)`, calling readPushdata twice per iteration and pushing a {tag,value} object. The only exit conditions depend on the pointer advancing; when readPushdata returns the same pointer (raw[p] is 0x4e, neither 0x00 nor 0x68) the loop never terminates and `fields` grows without bound until the renderer runs out of memory.
5. [frontend/src/app/shared/ord/inscription.utils.ts:388–392](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/inscription.utils.ts#L388-L392)
   The body loop in extractInscriptionData has the same shape (`while (newPointer < raw.length && raw[newPointer] !== OP_ENDIF)` with `data.push(slice)`) and spins the same way if the self-referencing push follows the OP_0 body separator. The surrounding try/catch (lines 374, 422) cannot help because nothing throws.
6. [frontend/src/app/services/ord-api.service.ts:80–98](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/services/ord-api.service.ts#L80-L98)
   decodeInscriptions converts the whole tapscript hex to bytes and, for every raw-byte occurrence of 00 63 03 6f 72 64 found by getNextInscriptionMark (no opcode alignment), calls extractInscriptionData synchronously. The trigger bytes therefore work when embedded inside the data of an ordinary push in a valid script, or inside the body of a well-formed inscription.
7. [frontend/src/app/components/transactions-list/transactions-list.component.ts:330–336](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transactions-list/transactions-list.component.ts#L330-L336)
   For every v1_p2tr input the tapscript is taken verbatim from vin.witness via parseTaproot and flagged isInscription on a plain substring match of the marker, which renders the Inscription badge (transactions-list.component.html:123) on the tx page and in address/block/wallet lists.
8. [frontend/src/app/components/transactions-list/transactions-list.component.ts:640–644](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transactions-list/transactions-list.component.ts#L640-L644)
   Clicking the badge calls ordApiService.decodeInscriptions(tapscript) on the main thread; this is the only caller, so one click is the user interaction required.

## Impact
The explorer frontend in the clicking visitor's browser becomes permanently unresponsive and the renderer is eventually killed by memory exhaustion; no data is disclosed or altered. The effect is confined to that visitor's tab and a reload recovers, so availability is rated LOW in line with the sibling inscription/rune records, although unlike those this is a guaranteed crash rather than a slowdown.

## Reproduction steps
1. Attacker broadcasts (mined or merely relayed) a taproot script-path spend whose tapscript contains the ord marker followed by 4e fb ff ff ff, embedded in a legitimate data push or in an inscription body. The explorer renders an Inscription badge for that input on the tx page and in address/block/wallet transaction lists. A visitor clicks the badge; decodeInscriptions runs on the UI thread, extractFields never returns, and the tab freezes then OOM-crashes. No privileges, no non-default configuration; one deliberate click by the victim.

## Recommended fix
1. OP_PUSHDATA lengths are decoded through signed 32-bit bitwise arithmetic and then used unchecked, so a declared length can be negative and move the read pointer backwards. Fix criteria: Push lengths are interpreted as unsigned values (or decoded without sign wrap) and a declared length that is negative or exceeds the remaining bytes aborts the parse of that envelope. Verify by decoding a tapscript containing 00 63 03 6f 72 64 4e fb ff ff ff: decodeInscriptions must return promptly (null/empty for that envelope) instead of hanging.
2. The field and body loops in extractFields/extractInscriptionData rely solely on the pointer reaching a terminator and have no forward-progress or iteration bound. Fix criteria: Each loop iteration must strictly advance the pointer (or the loop aborts), and the number of fields/body chunks parsed is bounded by the number of bytes remaining, so no input can make either loop run more than O(script length) iterations or allocate more than O(script length) memory.

---
**Severity:** LOW
**Status:** Open
**Category:** Infinite loop
**CWE:** [CWE-835](https://cwe.mitre.org/data/definitions/835.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258155

---

# Runestone LEB128 decoder grows unbounded BigInts: quadratic hang from large OP_RETURN

## Details
The frontend runestone decoder in frontend/src/app/shared/ord/rune.utils.ts has quadratic worst-case cost in the length of an attacker-authored OP_RETURN payload. `decodeLEB128` (lines 113-128) accumulates continuation bytes into one BigInt via `value |= BigInt(byte & 0x7f) << BigInt(shift)` with no width limit: the Runes protocol caps varints at 128 bits (19 bytes) and treats longer ones as cenotaphs, but this decoder never stops. For a run of N bytes with the high bit set, iteration i allocates two fresh BigInts of ~7*i bits (the shift result and the OR result), so total work is Theta(N^2) bit operations and ~7N^2/8 bytes of allocation churn: ~9 GB and seconds of main-thread CPU at the 100,000-byte payload Core now relays by default, and ~100x that for a ~1 MB payload a miner can include (an unspent OP_RETURN scriptPubKey is never executed, so no MAX_SCRIPT_SIZE applies; only block weight bounds it). The resulting values then reach `parseRuneName` (one BigInt division per output character) and `spaceRuneName` (one BigInt shift per bit), lines 166-190, which add Theta(bits^2) work when the attacker tags the giant varint as Rune (tag 4) or Spacers (tag 3) in an etching with the ETCHING flag set.

Trigger: on every non-Liquid network, transactions-list.component.ts:305-309 marks any output whose scriptpubkey starts with `6a5d` as `isRunestone`, and the template (line 364-366) renders a "Runestone" badge for it on the transaction page and in address/wallet/channel transaction lists. Clicking the badge calls `OrdApiService.decodeRunestone$`, which runs `decipherRunestone` synchronously on the UI thread; `decipherRunestone` (line 243) strips the OP_ tokens from the output's asm (backend emits `OP_RETURN OP_PUSHNUM_13 OP_PUSHDATA2 <hex>`) and hands the entire payload to `decodeLEB128`. `getEtchingFromRuneId$` decodes a second, attacker-selectable etching transaction the same way. Nothing caps payload length or varint width; the surrounding try/catch does not help because no error is thrown. The project's own backend (common.ts:440-462) records that OP_RETURN size/count standardness limits were lifted in Core 28.3/29.2/30.0, so a 100 kB `6a5d` output is relayable to any current node's mempool at zero on-chain cost.

Impact is a deterministic algorithmic-complexity denial of service of the explorer frontend in the browser of each visitor who clicks the badge (tab freeze for seconds to minutes, possible tab OOM); it is recoverable by reloading and affects no other user or the backend.

## Evidence
1. [frontend/src/app/shared/ord/rune.utils.ts:113–127](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/rune.utils.ts#L113-L127)
   decodeLEB128 keeps consuming continuation bytes (high bit set) into a single BigInt with `value |= BigInt(byte & 0x7f) << BigInt(shift)`, `shift += 7`, with no 128-bit (or any) width limit and no payload-length cap. Each iteration allocates BigInts of ~7*i bits, so an N-byte run of 0x80..0xff bytes costs Theta(N^2) bit operations and allocation. This is the primary location the fix must change.
2. [frontend/src/app/shared/ord/rune.utils.ts:242–254](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/rune.utils.ts#L242-L254)
   decipherRunestone picks the first vout whose scriptpubkey starts with 6a5d, strips OP_ tokens and whitespace from its asm, and feeds every remaining data byte to decodeLEB128; nothing limits payload size, and the try/catch never fires because no error is raised.
3. [frontend/src/app/shared/ord/rune.utils.ts:166–190](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/rune.utils.ts#L166-L190)
   parseRuneName divides the unbounded rune value by 26 once per output character and spaceRuneName shifts the unbounded spacers value right by one bit per iteration; each step is Theta(bits) BigInt arithmetic, so both are Theta(bits^2) on a multi-hundred-thousand-bit value and compound the decodeLEB128 cost when the attacker tags the giant varint as Rune or Spacers in an etching.
4. [frontend/src/app/services/ord-api.service.ts:19–53](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/services/ord-api.service.ts#L19-L53)
   decodeRunestone$ calls decipherRunestone synchronously on the UI thread; getEtchingFromRuneId$ (lines 57-78) fetches and decodes a further attacker-selectable etching transaction the same way.
5. [frontend/src/app/components/transactions-list/transactions-list.component.ts:305–309](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transactions-list/transactions-list.component.ts#L305-L309)
   On any non-Liquid network, the first output whose scriptpubkey starts with 6a5d is flagged isRunestone, regardless of payload size.
6. [frontend/src/app/components/transactions-list/transactions-list.component.html:364–366](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transactions-list/transactions-list.component.html#L364-L366)
   For an op_return output flagged isRunestone the template renders the Runestone badge button whose click handler is toggleOrdData(tx.txid, 'vout', vindex); this list is embedded on the transaction, address, wallet and lightning channel pages.
7. [frontend/src/app/components/transactions-list/transactions-list.component.ts:647–659](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transactions-list/transactions-list.component.ts#L647-L659)
   toggleOrdData's vout branch invokes ordApiService.decodeRunestone$(tx) on the attacker-authored transaction the first time the badge is clicked.
8. [backend/src/api/transaction-utils.ts:296–332](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/transaction-utils.ts#L296-L332)
   convertScriptSigAsm renders the output as `OP_RETURN OP_PUSHNUM_13 OP_PUSHDATA2 <hex>` for Core/electrum backends (esplora emits the same shape), so after decipherRunestone strips OP_ tokens the whole pushed payload hex reaches the decoder.

## Impact
The explorer frontend in the clicking visitor's browser tab becomes unresponsive for seconds (100 kB payload, ~9 GB allocation churn) to minutes with possible tab OOM (mined ~1 MB payload). No confidentiality or integrity effect; only the user who clicks is affected and a reload recovers, so availability is LOW.

## Reproduction steps
1. The attacker publishes a transaction with an OP_RETURN OP_13 output whose payload is a long run of bytes with the high bit set (optionally framed as Flags=ETCHING plus a Rune/Spacers tag). The project's own common.ts:440-462 records that OP_RETURN size standardness limits were lifted in Core 28.3/29.2/30.0 (mainnet height 921000), so a 100 kB payload is relayable into any current node's mempool at no on-chain cost, and a ~1 MB payload can be mined. The explorer renders a Runestone badge for that output wherever the tx is listed; any visitor who clicks it (UI:Active) runs decodeLEB128 synchronously on the UI thread. No privileges, no deployment condition, no race. Dependency assumptions: V8 BigInt semantics as shipped in current Chromium/Firefox/Node engines — each `<<` and `|` allocates a fresh result of O(operand bits) and the engine's BigInt size ceiling (2^30 bits in V8) is far above the ~8M bits a consensus-maximal payload yields, so no engine RangeError short-circuits the loop; Angular 20 runs this on the main thread (no worker). Both assumptions are stated, not verified from vendored engine sources.

## Recommended fix
1. decodeLEB128 has no bound on the width of the varint it accumulates nor on the payload it will decode, so an attacker-chosen run of continuation bytes drives Theta(N^2) BigInt allocation on the UI thread. Fix criteria: Decoding is linear in payload size: a varint exceeding 128 bits (more than 18 continuation bytes) aborts decoding and the runestone is treated as a cenotaph/undecodable, matching the Runes specification; a 100 kB OP_RETURN of 0xff bytes prefixed 6a5d returns promptly with an undecodable result and O(N) memory.
2. parseRuneName and spaceRuneName iterate once per character / per bit of an unbounded BigInt with Theta(bits) arithmetic per step. Fix criteria: Rune and Spacers values are validated to the protocol's 128-bit range (and spacers to the name's length) before these loops run, so neither loop can execute more than a protocol-bounded number of iterations regardless of input.

---
**Severity:** LOW
**Status:** Open
**Category:** Inefficient algorithmic complexity
**CWE:** [CWE-407](https://cwe.mitre.org/data/definitions/407.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258150

---

# Inscription content type used as object key pollutes Object.prototype in ord-data widget

## Details
The ord-data component groups decoded inscriptions by MIME type using the chain-supplied content type string as a key on a plain object literal (`inscriptionsData[key]`, ord-data.component.ts:51-61). The inscription parser (`extractInscriptionData`, inscription.utils.ts:405-420) decodes the tag-1 field bytes as UTF-8 and returns them unmodified as `content_type_str`, so whoever authored the on-chain transaction chooses the key.

When the key is the literal string `__proto__`, `this.inscriptionsData['__proto__']` resolves to `Object.prototype`, which is truthy, so the `if (!this.inscriptionsData[key])` initialisation is skipped. The following statements then mutate the realm-wide prototype: `Object.prototype.count` becomes NaN, `Object.prototype.totalSize` becomes NaN, and if the inscription also carries a delegate field (tag 11), `Object.prototype.delegate` is set to an attacker-chosen hex string of arbitrary length. Keys such as `constructor`, `toString` or `hasOwnProperty` similarly write properties onto the shared built-in functions.

Trigger path: an attacker publishes a taproot script-path spend whose tapscript contains the ord envelope marker and an inscription with content type `__proto__` (a standard, relayable transaction; `__proto__` is a 9-byte push). transactions-list.component.ts:330-336 takes the tapscript straight from `vin.witness` via parseTaproot, sets `vin.isInscription` and renders an "Inscription" badge on the transaction page and on every address/block/wallet/asset/channel list that shows the transaction. Any visitor who clicks the badge (toggleOrdData → decodeInscriptions → `<app-ord-data>` ngOnChanges) has `Object.prototype` polluted for the remainder of their SPA session; the explorer is a single-page app, so the pollution survives navigation until a hard reload. The polluted entries themselves never render (assumption: Angular ^20.3.33's KeyValuePipe diffs plain objects with Object.keys), so the victim sees only an empty widget.

Impact is confined to the victim's browser session and bounded by the values written (NaN, NaN, a hex string), and no code-execution or data-disclosure gadget exists in the frontend. The inherited enumerable keys do, however, reach the app's unguarded `for…in` loops with concrete consequences: start.component.ts:143-145 dereferences `specialBlocks['count'].networks` (NaN → TypeError) in the home page's block subscription; fast-vertex-array.ts:107-112 calls `moveVertexPointer` on the delegate hex string (TypeError) inside the WebGL block-overview renderer's compact(); transactions-list.component.ts:152 writes junk `_outspends` entries; and any third-party code enumerating objects without hasOwnProperty guards inherits the keys. This is a low-severity integrity/availability defect in the viewer's session, but a real, deterministic prototype-pollution primitive driven by untrusted chain bytes, closed by grouping in a prototype-less container.

## Evidence
1. [frontend/src/app/components/ord-data/ord-data.component.ts:51–62](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/ord-data/ord-data.component.ts#L51-L62)
   `this.inscriptionsData = {}` is a plain literal inheriting Object.prototype, and `key = inscription.content_type_str || 'undefined'` is the chain-supplied MIME string used verbatim as its property name. For key `__proto__`, `this.inscriptionsData[key]` resolves to Object.prototype (truthy), so the `if (!this.inscriptionsData[key])` initialisation is skipped and lines 58-61 execute against Object.prototype: `.count++` and `.totalSize += body_length` write NaN, and `.delegate = inscription.delegate_txid` writes an attacker-chosen hex string when tag 11 is present. Keys `constructor`/`toString`/… write the same properties onto the shared built-in functions instead. This is the code the fix must change (use a Map or Object.create(null)).
2. [frontend/src/app/shared/ord/inscription.utils.ts:405–419](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/inscription.utils.ts#L405-L419)
   content_type_str is `bytesToUnicodeString(contentTypeRaw)` (TextDecoder utf-8, lines 225-228) over the raw bytes of inscription field tag 1 — no normalisation, allow-list or length limit; `__proto__` is a 9-byte push. delegate_txid is `bytesToHex(...)` of the tag-11 bytes: hex-only charset, unconstrained length.
3. [frontend/src/app/components/transactions-list/transactions-list.component.ts:640–645](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transactions-list/transactions-list.component.ts#L640-L645)
   Clicking the Inscription badge (transactions-list.component.html:123) calls `ordApiService.decodeInscriptions(tapscript)` with `tx.vin[index].taprootInfo?.scriptPath?.script` and binds the result to `<app-ord-data [inscriptions]>` (html:148), which runs the ngOnChanges code above. decodeInscriptions (ord-api.service.ts:80-99) only wraps extractInscriptionData; nothing filters the content type.
4. [frontend/src/app/components/transactions-list/transactions-list.component.ts:330–337](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transactions-list/transactions-list.component.ts#L330-L337)
   For every v1_p2tr input, `parseTaproot(vin.witness)` (transaction.utils.ts:2661 sets `script: witness[scriptIndex]`) exposes the attacker's tapscript; if it contains the ord marker 0063036f7264 the input gets `isInscription = true` and the badge is rendered. transactions-list is embedded in the transaction, address, block, wallet, asset, channel and justice-list pages, so every visitor to any page listing the attacker's transaction sees the trigger.
5. [frontend/src/app/components/start/start.component.ts:143–145](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/start/start.component.ts#L143-L145)
   Concrete gadget for the polluted keys: `for (const sb in specialBlocks)` over the plain object literal `specialBlocks` (app.constants.ts:234) enumerates inherited enumerable `count`/`totalSize`/`delegate` after pollution; `specialBlocks['count']` is NaN, so `specialBlocks[sb].networks.includes(...)` throws TypeError (undefined.includes) inside the home page's blocks$ subscription — the start component's block countdown logic breaks for the rest of the session.
6. [frontend/src/app/components/block-overview-graph/fast-vertex-array.ts:107–112](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/block-overview-graph/fast-vertex-array.ts#L107-L112)
   Second gadget: `for (const index in this.sprites)` over an array enumerates the inherited keys; `this.sprites['delegate']` is the attacker's hex string (truthy), so `sprite.moveVertexPointer(i)` throws TypeError (not a function) inside compact() of the WebGL block-overview renderer whenever the sprite array grows, breaking block visualisations for the session. `for…in` at transactions-list.component.ts:152 likewise writes junk `_outspends['count'|'totalSize'|'delegate']` entries.

## Impact
Realm-wide Object.prototype in the viewer's explorer session gains attacker-influenced enumerable properties (count/totalSize = NaN, delegate = attacker-chosen hex string). No data is disclosed and no code-execution gadget exists in the frontend. Integrity of application state is weakly affected (inherited keys leak into the app's 19 unguarded for…in loops, e.g. junk `_outspends` entries). Availability is weakly affected: confirmed gadgets throw TypeErrors in the home page block countdown (start.component.ts:143-145, NaN.networks) and the WebGL block-overview renderer (fast-vertex-array.ts:107-112, string.moveVertexPointer), degrading those views until the victim hard-reloads; only the clicking visitor's own session is affected.

## Reproduction steps
1. Attacker publishes a standard taproot script-path transaction with an ord envelope whose content-type field is `__proto__` (optionally a delegate field). The explorer shows an Inscription badge for that input on the tx page and address/block lists. A visitor clicks the badge; decodeInscriptions runs and ord-data's ngOnChanges mutates Object.prototype in the visitor's browser. No privileges, no special deployment; one deliberate click by the victim.

## Recommended fix
An attacker-controlled string (inscription content type) is used directly as a property key on a plain object, so special keys (`__proto__`, `constructor`, …) address the prototype chain instead of an own property. Fix criteria: Group inscriptions in a container whose keys cannot collide with the prototype chain (a Map, or an object created with Object.create(null) and accessed via hasOwnProperty checks). After the fix, an inscription whose content type is `__proto__` or `constructor` must produce an ordinary own entry (or be bucketed as unknown) and `Object.prototype` must remain unchanged after clicking the Inscription badge.

---
**Severity:** LOW
**Status:** Open
**Category:** Prototype pollution
**CWE:** [CWE-1321](https://cwe.mitre.org/data/definitions/1321.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258149

---

# GeoIP ISP and country names rendered unescaped in lightning pie-chart tooltips

## Details
Two lightning pie charts build their echarts tooltip HTML by string-interpolating GeoIP-derived display names and return it from a per-data-item `tooltip.formatter`; with echarts `~6.1.0` in its default tooltip renderMode 'html' the returned string is assigned to the tooltip element's innerHTML (every tooltip in this codebase relies on this to render its `<b>`/`<br>` markup).

Sinks:
- nodes-per-isp-chart.component.ts:163 – `${isp[1]}`, the AS organisation name of each ISP slice (page /graphs/lightning/nodes-per-isp and the lightning-dashboard widget).
- nodes-per-country-chart.component.ts:104 – `${country.name.en}` (page /graphs/lightning/nodes-per-country).

Source: the backend sync task node-locations.ts resolves each clearnet lightning node's IP against the operator's MaxMind GeoLite2-City/GeoLite2-ASN (and optional GeoIP2-ISP) databases and stores `isp.isp ?? asn.autonomous_system_organization` (lines 141-147) and the country-names object (101-108) verbatim, JSON-encoded, in geo_names. nodes.api.ts $getNodesISPRanking (413-478) and $getNodesCountries (628-651) JSON.parse them back and serve them unmodified on /api/v1/lightning/nodes/isp-ranking and /lightning/nodes/countries. No character policy is applied anywhere on the path, and the frontend applies no encoding before the HTML sink. The project itself treats these strings as untrusted: nodes-map.component.ts:206,215 (and nodes-channels-map.component.ts:306,315, node-channels.component.ts:115-116) HTML-encode the same alias and `node[6]?.en` country strings with `echarts.format.encodeHTML`; the two pie charts are the siblings that missed the fix.

Attacker position: the AS organisation string originates in RIR registration data authored by the AS owner and is curated/passed through by MaxMind; the country name is MaxMind-authored only. The scan's threat model names MaxMind DBs as an operator-chosen data provider whose compromise or malice is a second-order adversary. For the ISP path an AS owner who runs (or hosts customers running) enough clearnet lightning nodes with active channels to reach the slice threshold — >= 0.4% of geolocated node count or capacity on the desktop page, >= 0.75% in the dashboard widget (nodes-per-isp-chart.component.ts:116-141) — gets a dedicated slice; any visitor who hovers it has the payload written via innerHTML and executes script in the explorer origin, on every instance that ingested the record.

Conditions: LIGHTNING.ENABLED must be true (config.ts default false; docker start.sh default false; enabled on mempool.space) and MaxMind databases configured (docker default MAXMIND_ENABLED=true with bundled GeoLite2 files; production/install installs geoipupdate).

Assumptions not verifiable from the checkout: (1) echarts 6.1.0 TooltipHTMLContent assigns string formatter output to innerHTML in the default 'html' renderMode; (2) MaxMind's `autonomous_system_organization` / `isp` fields pass registrant-authored organisation names through without stripping `<`/`>` — this is why attack_requirements is PRESENT and the rating is capped at modest impact.

## Evidence
1. [frontend/src/app/lightning/nodes-per-isp-chart/nodes-per-isp-chart.component.ts:161–167](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/lightning/nodes-per-isp-chart/nodes-per-isp-chart.component.ts#L161-L167)
   Per-slice tooltip formatter returns `<b style="color: white">${isp[1]} (...)</b>...` (line 163); isp[1] is the AS organisation name from /api/v1/lightning/nodes/isp-ranking, interpolated without echarts.format.encodeHTML. Only slices whose node-count/capacity share is >= 0.4% (0.75% in the dashboard widget) get their own slice and tooltip (lines 116-141); smaller ISPs are folded into 'Other'.
2. [frontend/src/app/lightning/nodes-per-country-chart/nodes-per-country-chart.component.ts:102–108](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/lightning/nodes-per-country-chart/nodes-per-country-chart.component.ts#L102-L108)
   Per-slice tooltip formatter returns `<b style="color: white">${country.name.en} (...)</b>...` (line 104); country.name is the JSON-parsed MaxMind country-names object from /api/v1/lightning/nodes/countries, unescaped. Slices need >= 1% share (line 68).
3. [backend/src/tasks/lightning/sync-tasks/node-locations.ts:141–151](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/tasks/lightning/sync-tasks/node-locations.ts#L141-L151)
   AS name source: `isp?.isp ?? asn?.autonomous_system_organization` from the operator's MaxMind GeoIP2-ISP / GeoLite2-ASN lookups is JSON.stringify'd verbatim into geo_names(type='as_organization') with no character policy. Country names are stored the same way at lines 101-108.
4. [backend/src/api/explorer/nodes.api.ts:413–477](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/explorer/nodes.api.ts#L413-L477)
   $getNodesISPRanking joins geo_names on nodes.as_number for every active channel, JSON.parses the stored name string and emits it as ispRanking[i][1] (line 472); $getNodesCountries (628-651) emits `name: JSON.parse(country.names)`. Neither sanitises.
5. [frontend/src/app/lightning/nodes-map/nodes-map.component.ts:204–217](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/lightning/nodes-map/nodes-map.component.ts#L204-L217)
   Sibling tooltip in the same module wraps the alias (206) and data[6] = node[6]?.en, the identical MaxMind country name (215), in echarts.format.encodeHTML — the project's own control for this data class, which the two pie charts lack.
6. [frontend/src/app/graphs/lightning-graphs.module.ts:23–32](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/graphs/lightning-graphs.module.ts#L23-L32)
   Both components are routed as public pages (/graphs/lightning/nodes-per-isp, /graphs/lightning/nodes-per-country); the ISP chart is also embedded as a widget in lightning-dashboard.component.html:40.

## Impact
Script execution in the explorer origin for visitors of the lightning ISP/country pages: client-side state read and same-origin actions, page content tampering. Public-data site, session-bounded, so LOW/LOW.

## Reproduction steps
1. Attacker must get markup into an AS organisation (or ISP) name that MaxMind publishes in GeoLite2-ASN/GeoIP2-ISP, host enough clearnet lightning nodes with active channels in that AS to reach the pie-slice share threshold (>= 0.4% desktop / 0.75% widget, from the component code), or otherwise control the MaxMind data the operator imports (country path). The backend stores and serves the string verbatim; no privileges on the instance are needed; the victim only needs to visit the ISP/country page or lightning dashboard and hover the slice, an incidental interaction with the page (UI:P, as for stored XSS). Whether MaxMind would ever pass through such a string cannot be confirmed from the repository, hence AT:P.

## Recommended fix
1. GeoIP-derived names (AS organisation, country) are interpolated into HTML strings returned from echarts tooltip formatters without HTML encoding, unlike the sibling map tooltips in the same module. Fix criteria: Both pie-chart formatters HTML-escape `isp[1]` and `country.name.en` (echarts.format.encodeHTML, as nodes-map.component.ts does) or the tooltips switch to renderMode 'richText'; an AS organisation record named `<img src=x onerror=alert(1)>` renders as literal text in the tooltip.
2. The backend ingests MaxMind organisation/geo names into geo_names and serves them on public APIs with no character policy, so every frontend consumer must defend itself. Fix criteria: Defence in depth: node-locations.ts normalises stored names (strip or reject `<`, `>`, control characters) so a markup-bearing record never reaches the API, while frontend escaping remains the primary control.

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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258148

---

# Inscription decoder re-parses witness from every embedded ord marker: quadratic browser hang

## Details
The frontend inscription decoder has super-linear worst-case cost in the size of an attacker-authored tapscript. `OrdApiService.decodeInscriptions` searches for the 6-byte ord envelope marker, parses an inscription from the byte after it, and then resumes the marker search from that same position. Because the search is a raw byte scan rather than an opcode walk, any marker that appears inside the push data of a previous envelope is treated as a new envelope and the remainder of the script is parsed again.

A tapscript consisting of `OP_FALSE OP_IF` followed by the 7-byte unit `06 00 63 03 6f 72 64` (push-6 of the marker) repeated K times, then `OP_ENDIF <pubkey> OP_CHECKSIG`, is a valid, standard, relayable script (the pushes sit in an unexecuted branch, exactly like real inscriptions). For each of the K markers, `extractFields` reads push/push pairs until it sees 0x00 or 0x68 at a push boundary — which never happens before the end — so every parse is O(N) and allocates two typed-array slices per unit. Total work is Θ(N²/7) byte operations and Θ(N²/49) allocations. A standard 400,000-WU transaction allows a witness of roughly 390 kB, giving on the order of 10^10 byte copies and 3×10^9 small allocations: the browser tab is frozen for minutes or runs out of memory.

Trigger: transactions-list flags the input as an inscription (the script contains the marker) and shows the Inscription badge on the transaction page and in address/block transaction lists. Any visitor who clicks it runs the decoder synchronously on the UI thread. The attacker needs only to broadcast the transaction; it does not have to be mined.

This is a deterministic algorithmic-complexity denial of service of the explorer frontend driven by untrusted chain bytes; it affects only the viewer who clicks, and is recoverable by reloading the tab.

## Evidence
1. [frontend/src/app/services/ord-api.service.ts:80–99](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/services/ord-api.service.ts#L80-L99)
   decodeInscriptions loops: find the next 6-byte ord marker starting at `startPosition`, call extractInscriptionData from just after it, then set `startPosition = pointer` (immediately after the marker). Markers that lie inside push data of a previous envelope are found again, so each of K markers starts a fresh parse of the remaining bytes.
2. [frontend/src/app/shared/ord/inscription.utils.ts:337–363](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/inscription.utils.ts#L337-L363)
   extractFields keeps reading push/push pairs until the byte at a push boundary is OP_0 (0x00) or OP_ENDIF (0x68). A witness built from repeated `06 00 63 03 6f 72 64` units (push-6 of the marker) never presents such a byte at a boundary, so each parse runs to the end of the script, allocating two Uint8Array slices per unit.
3. [frontend/src/app/shared/ord/inscription.utils.ts:127–147](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/inscription.utils.ts#L127-L147)
   getNextInscriptionMark scans linearly from startPosition and returns index+6, so a marker embedded inside push data is treated as a new envelope start; nothing requires it to be at a script-level opcode boundary or caps the number of envelopes.
4. [frontend/src/app/shared/ord/inscription.utils.ts:372–403](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/shared/ord/inscription.utils.ts#L372-L403)
   The body loop and combinedData allocation are likewise O(remaining bytes) per parse with no overall budget; the 100 kB body crop is applied only after the full-size array has been built.
5. [frontend/src/app/components/transactions-list/transactions-list.component.ts:330–337](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transactions-list/transactions-list.component.ts#L330-L337)
   Any v1_p2tr script-path input whose tapscript hex contains 0063036f7264 is flagged isInscription, which renders the Inscription badge (template line 123).
6. [frontend/src/app/components/transactions-list/transactions-list.component.ts:640–645](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/transactions-list/transactions-list.component.ts#L640-L645)
   Clicking the badge calls decodeInscriptions(tapscript) synchronously on the main thread with the full attacker-authored tapscript.

## Impact
The explorer frontend in the clicking visitor's browser becomes unresponsive (minutes of CPU, gigabytes of allocation churn, possible tab OOM). No confidentiality or integrity effect. Only the user who clicks is affected and a reload recovers, so availability is rated LOW rather than HIGH.

## Reproduction steps
1. Attacker broadcasts a standard taproot script-path transaction (~390 kB witness) whose tapscript is an unexecuted OP_IF branch of repeated push-6-of-marker units. The explorer shows an Inscription badge for that input wherever the tx is listed. A visitor clicks the badge; decodeInscriptions runs Θ(N²) work on the main thread and the tab hangs. No privileges or deployment conditions; one deliberate click.

## Recommended fix
decodeInscriptions restarts a full parse at every raw-byte occurrence of the ord marker, including occurrences inside already-consumed push data, and the per-envelope parser has no work or count budget, giving Θ(N²) behaviour on attacker-authored scripts. Fix criteria: Parsing must be linear in the script size: resume the marker search from the end of the envelope just parsed (or walk the script by opcodes so markers inside push data are not treated as envelope starts), and bound the number of envelopes/fields decoded per input. Verify with a ~390 kB tapscript of repeated `06 00 63 03 6f 72 64` units: clicking the Inscription badge must complete in well under a second and allocate O(N) memory.

---
**Severity:** LOW
**Status:** Open
**Category:** Algorithmic complexity DoS
**CWE:** [CWE-407](https://cwe.mitre.org/data/definitions/407.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258144

---

# Mining pool names from remote pools-v2.json rendered unescaped in pool-ranking and pools-dominance echarts HTML tooltips

## Details
Two mining charts build echarts tooltip HTML by template-string interpolation of mining-pool display names and return it from a `tooltip.formatter`:

- pool-ranking.component.ts:169,173 – `<b style="color: white">${pool.name} (${pool.share}%)</b>` (mining dashboard widget at /mining and the full page at /graphs/mining/pools; present on every instance with MINING_DASHBOARD, which defaults to true).
- hashrate-chart-pools.component.ts:239 – `${pool.marker} ${pool.seriesName}: ...` where each series name is the raw `poolName` (lines 155-158; /graphs/mining/pools-dominance, axis trigger so any pointer movement over the chart renders every pool name).

echarts (frontend/package.json pins `echarts ~6.1.0`; renderMode is never set under frontend/src, so the default 'html' applies) writes a string formatter result into the tooltip DOM node via innerHTML without sanitisation, so markup in a pool name is rendered and event-handler attributes (e.g. `<img src=x onerror=...>`) execute in the explorer origin when a visitor hovers the chart. Because the frontend is an Angular SPA, a payload fired on the mining page stays alive across client-side navigation in that tab.

Source: pool names originate in pools-v2.json, which the backend downloads from `MEMPOOL.POOLS_JSON_URL` (pools-updater.ts:87; default raw.githubusercontent.com/mempool/mining-pools/master, config.ts:206) on every fresh install and weekly when AUTOMATIC_POOLS_UPDATE is on (Docker start.sh:29 and mempool.space production configs set it true). migratePoolsJson() stores the name verbatim (pools-parser.ts:84 insert, :92 rename; only the slug is filtered to [a-z0-9]); it is served unchanged by GET /api/v1/mining/pools/:interval (PoolsRepository.ts:47, mining.ts:137, mining.service.ts:129-139) and GET /api/v1/mining/hashrate/pools/:interval (HashratesRepository.ts:112). The JSON is a community-maintained file in a separate repository to which third-party pool operators submit their own names; it is not operator-authored on self-hosted instances. The threat model classes remote data providers (GitHub mining-pools JSON) as a second-order adversary.

Everywhere else the frontend prints pool names via Angular interpolation or property bindings (app-mining-pool, eight-blocks, block pages), which escape them, and the lightning map tooltips wrap equivalent upstream strings in `echarts.format.encodeHTML` (nodes-map, nodes-channels-map, node-channels); these two mining formatters bypass that control. The same defect in the acceleration pie chart (active-acceleration-box.component.ts) is recorded separately.

Dependency assumption: echarts 6.x TooltipHTMLContent.setContent assigns string content to `el.innerHTML` in the default renderMode; the project's own formatters rely on this by emitting `<b>`/`<br>` markup.

Impact: stored XSS on every affected instance (mempool.space and self-hosted) in the explorer origin, which also hosts accelerator login state (localStorage) and payment flows reachable via same-origin SPA navigation. Exploitation requires getting a crafted name into the pools JSON served at POOLS_JSON_URL (merged PR to the community repository, compromise of that repository or of raw.githubusercontent.com delivery), hence attack_requirements PRESENT.

## Evidence
1. [frontend/src/app/components/pool-ranking/pool-ranking.component.ts:163–177](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/pool-ranking/pool-ranking.component.ts#L163-L177)
   Per-slice tooltip formatter (lines 169 and 173) returns `<b style="color: white">${pool.name} (${pool.share}%)</b>...` as a raw HTML string; pool.name is interpolated without escaping. echarts' tooltip (no renderMode set anywhere under frontend/src, so default 'html') assigns the returned string to the tooltip element via innerHTML. Primary location: this is the code the fix must change.
2. [frontend/src/app/components/hashrates-chart-pools/hashrate-chart-pools.component.ts:233–246](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/hashrates-chart-pools/hashrate-chart-pools.component.ts#L233-L246)
   Axis-trigger tooltip formatter (line 239) appends `${pool.marker} ${pool.seriesName}: ...` for every series and returns the string as HTML; seriesName is the raw pool name.
3. [frontend/src/app/components/hashrates-chart-pools/hashrate-chart-pools.component.ts:155–158](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/hashrates-chart-pools/hashrate-chart-pools.component.ts#L155-L158)
   Each series' `name` is set to the key of `pools`, which applyHashrates() populates from `hashrate.poolName` returned by GET /api/v1/mining/hashrate/pools/:interval, with no transformation.
4. [backend/src/api/pools-parser.ts:80–94](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/pools-parser.ts#L80-L94)
   migratePoolsJson() inserts (line 84) and renames (line 92) pools using `pool.name` exactly as it appears in the downloaded pools-v2.json; only the slug is character-filtered, the display name has no character policy.
5. [backend/src/tasks/pools-updater.ts:72–87](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/tasks/pools-updater.ts#L72-L87)
   pools-v2.json is fetched over the network from config.MEMPOOL.POOLS_JSON_URL (line 87). The download always happens on a fresh install (`currentSha === null`, line 72 comment) regardless of AUTOMATIC_POOLS_UPDATE, and is refreshed weekly when that flag is on.
6. [backend/src/config.ts:205–206](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/config.ts#L205-L206)
   Default POOLS_JSON_URL is the master branch of the third-party GitHub repository mempool/mining-pools via raw.githubusercontent.com. docker/backend/start.sh:29 and production/mempool-config.mainnet.json:17 set AUTOMATIC_POOLS_UPDATE=true.
7. [backend/src/repositories/PoolsRepository.ts:47](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/repositories/PoolsRepository.ts#L47)
   `pools.name AS name` is returned by $getPoolsInfo, served via GET /api/v1/mining/pools/:interval (mining.ts:137 passes `name: poolInfo.name` through) and consumed by MiningService.generateMiningStats() which spreads poolStat unchanged (mining.service.ts:129-139).
8. [backend/src/repositories/HashratesRepository.ts:112](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/repositories/HashratesRepository.ts#L112)
   `pools.name as poolName` is returned for GET /api/v1/mining/hashrate/pools/:interval, the data source of the pools-dominance chart.
9. [frontend/src/app/graphs/graphs.routing.module.ts:128–137](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/graphs/graphs.routing.module.ts#L128-L137)
   Routes /graphs/mining/pools-dominance (HashrateChartPoolsComponent) and /graphs/mining/pools (PoolRankingComponent) ship in the graphs module; MINING_DASHBOARD defaults to true (state.service.ts:119, docker/frontend/entrypoint.sh:44).
10. [frontend/src/app/components/mining-dashboard/mining-dashboard.component.html:32](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/mining-dashboard/mining-dashboard.component.html#L32)
   The pool-ranking pie is also embedded as a widget on the mining dashboard landing page, so every visitor of /mining who hovers a slice triggers the tooltip.
11. [frontend/src/app/lightning/nodes-map/nodes-map.component.ts:204–216](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/lightning/nodes-map/nodes-map.component.ts#L204-L216)
   Sibling echarts tooltip that wraps upstream-derived strings in echarts.format.encodeHTML(), showing the project treats this sink as an HTML context and escapes elsewhere; the mining charts omit it.

## Impact
Arbitrary script runs in the explorer origin for every visitor of the affected pages and persists across SPA navigation in that tab: it can read localStorage (accelerator auth JWT on mempool.space, preferences), issue same-origin requests including to the /api/v1/services proxy, and rewrite displayed chain data, addresses or invoices. Rated LOW/LOW because the site is largely public data and the payload is bounded by one client session rather than the server; availability of the service is unaffected.

## Reproduction steps
1. The attacker needs an HTML-bearing `name` in the pools-v2.json the backend downloads (a pull request accepted into the community mempool/mining-pools repository, or compromise of that repository / its delivery). Every backend with the default POOLS_JSON_URL ingests it on first start and, with AUTOMATIC_POOLS_UPDATE (Docker and mempool.space defaults), within a week, and serves it from /api/v1/mining/pools and /api/v1/mining/hashrate/pools. Any anonymous visitor who hovers the pool-distribution pie on /mining or /graphs/mining/pools, or moves the pointer over /graphs/mining/pools-dominance, has the string written to the tooltip innerHTML and the payload executes. No privileges on the instance are needed; the interaction is routine browsing.

## Recommended fix
1. Untrusted upstream strings (pool names from the remotely fetched pools-v2.json) are concatenated into HTML returned from echarts tooltip formatters, which the library renders via innerHTML, with no output encoding for the HTML context. Fix criteria: The pool-ranking and hashrate-chart-pools tooltip formatters HTML-escape every dynamic text value (e.g. echarts.format.encodeHTML) or the tooltips use renderMode 'richText'; a pool named `<img src=x onerror=alert(1)>` renders as literal text in both tooltips and no script executes.
2. The backend stores pool names from the downloaded JSON verbatim with no character policy, so hostile JSON propagates markup into the database and API responses. Fix criteria: Pool names are validated or normalised on import (e.g. reject or strip < > " ' & and control characters) so markup cannot enter the pools table; verified by importing a pools JSON containing a markup name and observing it rejected or neutralised in /api/v1/mining/pools responses.

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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5258143

---

# Docker nginx proxies /api/v1/services to mempool.space over TLS without certificate verification

## Details
The Docker frontend image's nginx config (`nginx-mempool.conf`, copied verbatim into `/etc/nginx/conf.d/` by `docker/frontend/Dockerfile:25`) contains `location /api/v1/services { proxy_pass https://mempool.space; }` with no `proxy_ssl_verify on`, `proxy_ssl_trusted_certificate` or `proxy_ssl_server_name`; no `proxy_ssl_*` directive exists anywhere in the repository (`nginx.conf`, `http-basic.conf` included). In nginx (ngx_http_proxy_module, image pinned to nginx:1.30.1-alpine) `proxy_ssl_verify` defaults to off, so the upstream handshake completes with any certificate whatsoever and the `https://` scheme authenticates nothing. The hostname is resolved once at startup through the container's resolver, so a DNS hijack at container start or any on-path interception between the server and mempool.space lets an attacker terminate the TLS connection and impersonate the services API to every user of the instance - including users who are nowhere near the attacker's network position.

This proxied prefix is exercised by default builds: the `about` route is registered unconditionally (master-page.module.ts:48), and the About page fetches `/api/v1/services/sponsors` relative to the instance origin (api.service.ts:134) and renders `<img src="/api/v1/services/account/images/<username>">` (about.component.html:534/546). nginx forwards every path under the prefix together with the client's request headers (Cookie, Authorization) and relays the response unchanged, so the impersonator chooses every byte served from the instance's own origin under `/api/v1/services/*` - sponsor JSON and images on the About page, and arbitrary `text/html` for any user who follows a `/api/v1/services/...` link on that instance, i.e. script execution in the instance origin. Because nginx picks the longest matching prefix, this location also shadows the backend's own `about.routes.ts` handlers for `services/sponsors` and `services/account/images/*` (registered for non-OFFICIAL instances, index.ts:409-411), which fetch over Node's certificate-verified HTTPS - the unverified nginx hop is the one actually used in Docker. Operator variations widen the reach but are not required: `PROXIED_SERVICES_HOST` only swaps the upstream host (entrypoint.sh:6-11), pointing `SERVICES_API` at the local proxy routes accelerator traffic through the same hop, and mempool.space builds additionally send GitHub/Twitter login navigations through it.

The sibling production config (`production/nginx/location-api-v1-services.conf`) has the same omission and is filed separately (production-services-proxy-unverified-tls-plaintext-dns).

## Evidence
1. [nginx-mempool.conf:61–63](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/nginx-mempool.conf#L61-L63)
   `location /api/v1/services { proxy_pass https://mempool.space; }` with no `proxy_ssl_verify on`, `proxy_ssl_trusted_certificate` or `proxy_ssl_server_name`; nginx's default is verify off, so any upstream certificate is accepted. No proxy_ssl_* directive exists anywhere else in the repo to override this.
2. [docker/frontend/Dockerfile:23–25](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/docker/frontend/Dockerfile#L23-L25)
   The published mempool/frontend image (nginx:1.30.1-alpine) copies nginx.conf, http-basic.conf and nginx-mempool.conf verbatim; this is the shipped production config.
3. [docker/frontend/entrypoint.sh:6–11](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/docker/frontend/entrypoint.sh#L6-L11)
   Only the upstream host is substitutable (PROXIED_SERVICES_HOST); no option enables certificate verification.
4. [frontend/src/app/services/api.service.ts:134](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/services/api.service.ts#L134)
   Default frontend fetches `/api/v1/services/sponsors` relative to its own origin, i.e. through this nginx location, on the About page.
5. [frontend/src/app/components/about/about.component.html:534](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/about/about.component.html#L534)
   Sponsor images are loaded from `/api/v1/services/account/images/<username>` through the same proxy (also line 546).
6. [frontend/src/app/master-page.module.ts:48](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/master-page.module.ts#L48)
   The `about` route is registered unconditionally, so the proxied requests occur in every default deployment, not only official or accelerator-enabled ones.
7. [backend/src/api/about.routes.ts:80–91](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/backend/src/api/about.routes.ts#L80-L91)
   The backend has TLS-verified (Node axios/https) handlers for `services/sponsors` and `services/account/images`, registered for non-OFFICIAL instances (index.ts:409-411), but the longer nginx prefix `/api/v1/services` shadows them, so the unverified nginx path is the one actually used in Docker.
8. [frontend/src/app/components/github-login.component/github-login.component.ts:19–22](https://github.com/Halbarevi/mempool/blob/2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6/frontend/src/app/components/github-login.component/github-login.component.ts#L19-L22)
   Login flows navigate the browser to the relative `/api/v1/services/auth/login/github`, forwarded with the user's cookies to the unverified upstream; this component is only wired on mempool.space builds (faucet, gated by window['isMempoolSpaceBuild']) and shows the breadth of the forwarded prefix rather than the default path.

## Impact
Confidentiality LOW: nginx forwards every client request header (Cookie, Authorization, Referer) on the proxied prefix to the impersonator, and attacker-served HTML executing in the instance origin can read that origin's localStorage and page content. Integrity LOW: the attacker controls the sponsor JSON, images and any other `/api/v1/services/*` response served from the instance's own origin, including HTML/script shown to users as if from the instance; server-side state is not modified. Availability NONE.

## Reproduction steps
1. Attacker: a machine-in-the-middle between the self-hosted Docker instance and mempool.space (rogue network, ISP, or DNS hijack of the server's resolver at container start; nginx resolves the static upstream once and never verifies the peer). They answer nginx's TLS handshake with any certificate; nginx accepts it with no further condition (AC:LOW). Requires only the network position (AT:PRESENT) and ordinary browsing by instance users - loading the About page triggers the proxied fetches (UI:PASSIVE). No privileges on the instance are needed.

## Recommended fix
`proxy_pass https://mempool.space` relies on nginx's default `proxy_ssl_verify off` with no trust store or SNI, so the upstream's identity is never authenticated despite the https scheme. Fix criteria: The services proxy must only complete a TLS handshake with a peer presenting a certificate that chains to a trusted CA and is valid for the configured upstream hostname (verification on, trust store configured, SNI enabled, verify depth set), for both the default host and any PROXIED_SERVICES_HOST override. Verify by pointing the upstream at a host with a self-signed or mismatched certificate and confirming nginx returns 502 instead of forwarding.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper certificate validation
**CWE:** [CWE-295](https://cwe.mitre.org/data/definitions/295.html)
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
**Repository:** Halbarevi/mempool
**Branch:** main
**Commit:** 2b0eb7ffdce74d4b37eefde3eec8b2bb289bdbe6
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_01C9Ng6wKqVdmzEmWqEHJHjT&finding=scan_016ZjNNyuvKM3EqNuM38VeHr-5257951