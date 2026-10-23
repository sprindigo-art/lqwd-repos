---
phase: 13
slug: 13-nodes-service-health
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-10
audited_head: 621ba0b
---

# Phase 13 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Verified against HEAD `621ba0b` (post-review: all 12 code-review findings fixed).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| client (browser) → server actions | untrusted `{ pubkey, params, staleAck }` / `{ id }` only; client never supplies HMAC/signature | fee-intent params, command ids |
| server action → nodemon queue DB | server-side signed rows; guarded state transitions + append-only audit | signed command rows, audit rows |
| nodemon queue DB → node (out of scope this phase) | node re-verifies HMAC + re-bounds + atomic `FOR UPDATE SKIP LOCKED` claim (3rd enforcement) | signed canonical payloads |
| URL params (pubkey, tab, service, ?window, ?page, ?peer, ?chan, ?focus) → read layer | untrusted; whitelist/format-validated BEFORE any warehouse query | route/query params |
| static sub-route exports → warehouse | shared `handleCsvExport` gauntlet (PUBKEY_RE → EXPORTABLE_TABS → window gate) before any query | CSV export requests |
| nodemon queue DB → channels page (approved-intents read) | server-only, parameter-bound, scoped to one node, fail-soft to `{}` | chanId → commandId map only |
| migration tool → nodemon DB | DDL targets nodemon ONLY; warehouses never migrated | `withdrawn` enum DDL |
| warehouse → presentational Server Components | pre-read, serializable props only; leaves perform no reads and no writes | formatted display values |

---

## Threat Register

All 60 threats from the 17 plan-time `<threat_model>` registers. Status verified by direct code inspection at HEAD `621ba0b`.

### 13-01 — withdrawn enum migration

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-01-01 | Tampering | drizzle-kit migrate target | mitigate | `drizzle.nodemon.config.ts:8-9` is the only config with `out: ./drizzle/nodemon`; `drizzle/` contains ONLY `nodemon/` — no warehouse migration dir exists | closed |
| T-13-01-02 | DoS | live enum ALTER | mitigate | `drizzle/nodemon/0002_productive_the_order.sql` = single `ALTER TYPE ... ADD VALUE 'withdrawn'`; blocking human-verify gate executed (13-01-SUMMARY Task 3: SQL inspected for the PG ADD-VALUE caveat; operator applied idempotent `ADD VALUE IF NOT EXISTS` as owner) | closed |
| T-13-01-SC | Tampering | npm installs | mitigate | zero installs: last `package.json` commit is `fec1c80` (2026-06-24, phase 10) — untouched throughout phase 13 | closed |

### 13-03 — enqueueAndApprove / withdraw write path

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-03-01 | Spoofing/Tampering | client-forged HMAC/params | mitigate | `src/app/actions/queue.ts:100-106` — `enqueueAndApproveInputSchema` is `.strict()` over `{ pubkey, params, staleAck }` only; server signs once via lazy `enqueue()` (`queue.ts:127-129`); `queue.enqueueAndApprove.test.ts:109-116` proves a smuggled `signatureHex` is rejected | closed |
| T-13-03-02 | Tampering | out-of-bounds fee params | mitigate | `src/lib/queue/bounds.ts:22-29` — `updateFeeBoundsSchema` ppm `.min(0).max(5000)`, baseMsat 0–100_000, timelock 18–2016, `.strict()`; re-validated server-side at `queue.ts:121` BEFORE any signing | closed |
| T-13-03-03 | Tampering | withdraw racing an in-flight claim | mitigate | `src/lib/queue/transitions.ts:117-123` — `UPDATE ... WHERE id=? AND state='approved' RETURNING id`; 0 rows ⇒ throws `ALREADY CLAIMED` (line 32,123); `withdraw.test.ts:96-120` pins the `state='approved'` predicate and the 0-row throw | closed |
| T-13-03-04 | Repudiation | approved intent with no trail | mitigate | `queue.ts:129-130` — enqueue() → pending_approval, then approve() flip; NOT an insert-at-approved bypass; `transitions.ts:57-63,125-130` — `commandAudit` insert inside the same transaction for every flip (staleAck recorded, actor `operator`) | closed |
| T-13-03-05 | Elevation | AI emits an executable param | accept (verified) | zero `@ai-sdk`/`generateText`/`anthropic` imports in `queue.ts`, `enqueue.ts`, `NodeFeeEnqueue.tsx` (grep clean); params come only from the operator's bounds-clamped edit | closed |
| T-13-03-SC | Tampering | npm installs | mitigate | zero installs (see T-13-01-SC) | closed |

### 13-06 — NodeFeeEnqueue leaf (canary defense)

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-06-01 | Tampering | wrong-channel targeting | mitigate | `NodeFeeEnqueue.tsx:92-106` — `buildEnqueueAndApproveArgs` carries `chanId: props.chanId` from the pre-targeted row into the signed params; pure builder unit-tested (`NodeFeeEnqueue.test.tsx:80-87`) | closed |
| T-13-06-02 | Tampering | stale baseline treated as current | mitigate | `src/lib/read/latest.ts:81,129` — `FEE_BASELINE_STALE_MS = 6h`, `baselineStale = now - timestamp > 6h` (null ⇒ true); `NodeFeeEnqueue.tsx:64-75` — `feeEnqueueConfirmBlocked` blocks CONFIRM until staleAck; behavioral tests `NodeFeeEnqueue.test.tsx:44-74` (blocked → ack → enabled + verbatim warning) | closed |
| T-13-06-03 | Spoofing/Tampering | client forges HMAC | mitigate | `NodeFeeEnqueue.tsx:203-214` — sends `{ pubkey, params, staleAck }` only into `enqueueAndApprove`; no signature construction anywhere client-side; server strict schema rejects extras (T-13-03-01) | closed |
| T-13-06-04 | Tampering | double-apply after approve | mitigate | same guard as T-13-03-03 (`transitions.ts:121-123`); UI surfaces "TOO LATE, ALREADY CLAIMED" copy (`queue.ts:39-41`) | closed |
| T-13-06-05 | Elevation | AI supplies the fee param | accept (verified) | `NodeFeeEnqueue.tsx:37` — B8 is no-AI: `suggestedPpm = currentPpm` seeded by the props builder; ppm clamped to `PPM_BOUNDS` (`:186,102`) | closed |
| T-13-06-SC | Tampering | npm installs | mitigate | zero installs; tests are dep-free (renderToStaticMarkup, no jsdom/@testing-library) | closed |

### 13-08 — node detail page assembly

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-08-01 | Tampering | unvalidated pubkey in route | mitigate | `[pubkey]/page.tsx:64,146` — `PUBKEY_RE.test(pubkey)` → `notFound()` before any read (also in generateMetadata `:113`); redirect shim `[tab]/page.tsx:29-32` validates before redirect | closed |
| T-13-08-02 | Tampering | write path re-wired incorrectly | mitigate | the page mounts only the Plan-06 leaves; no signing logic at page layer (page is an RSC; only `NodeFeeEnqueue`/`WithdrawAffordance` call the server actions) | closed |
| T-13-08-03 | Info Disclosure | CSV export path lost on retirement | mitigate | `[tab]/export/route.ts:19` still delegates to `handleCsvExport`; the shim replaced only `[tab]/page.tsx` (redirect at `:32`) | closed |
| T-13-08-SC | Tampering | npm installs | mitigate | zero installs (see T-13-01-SC) | closed |

### 13-10 — liquidity gauge + tabs leaves

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-10-01 | Info Disclosure | liquidity math | mitigate | `src/lib/read/liquidity-split.ts:20-36` — raw sats only, `localShare: number | null` (null ⇒ honest empty, never fabricated 50%); display solely via `formatSats` (`LiquidityGauge.tsx:1,149-150`) | closed |
| T-13-10-02 | Spoofing | health signalling via color | mitigate | `LiquidityGauge.tsx:106-122` — navy (df-brand) local / grey (df-slate) remote reference hues only; test gate asserts honest-empty renders no thumb (`LiquidityGauge.test.tsx:73-97`); severity ramp absent (see T-13-21-01) | closed |
| T-13-10-SC | Tampering | npm installs | mitigate | zero installs; dep-free tests | closed |

### 13-11 — pagination + shared export handler

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-11-01 | Tampering | ?page param | mitigate | `src/lib/console/paginate.ts:39-50` — non-numeric/≤0 → page 1, over-range clamped to pageCount; offset is a clean integer bound as `OFFSET ${offset}::int` (`forwards.ts:159`), never string-interpolated. Post-review CR-01 fix: `forwardsPageData` runs the summary first and binds the TRUE-total-clamped offset (`forwards.ts:223-254`) | closed |
| T-13-11-02 | Tampering | shared export handler | mitigate | `src/lib/console/export-handler.ts:80-90` — PUBKEY_RE → EXPORTABLE_TABS → window gate ALL before any query; CR-02 fix accepts literal `latest` for latest-state tabs (channels/fees) only, event tabs still require a WINDOW_PRESETS key; `export-handler.test.ts` covers 200/404 matrix incl. forwards+latest → 404 with zero reads | closed |
| T-13-11-03 | Info Disclosure | forwards fee math | mitigate | `forwards.ts:105-106` — `SUM(fee_msat)/1000.0` / `AVG(fee_msat)/1000.0`; raw `fee` column never used (AFM-002 hard rule at `:13`) | closed |
| T-13-11-SC | Tampering | npm installs | mitigate | zero installs | closed |

### 13-12 — channels sub-route

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-12-01 | Tampering | pubkey / ?peer / ?chan | mitigate | `channels/page.tsx:44-45,78,116-117` — PUBKEY_RE on segment → notFound; `?peer` PUBKEY_RE-gated, `?chan` gated by `CHAN_RE = /^\d+$/`; invalid filter → `null` (widens to unfiltered), never reaches a query | closed |
| T-13-12-02 | Tampering | fee-queue write path | mitigate | page mounts the reused 13-06 leaf only; no signing at page/table layer (`NodeChannelsTable.tsx` renders leaves; `WithdrawAffordance.tsx:50-51` sends `{ id }` only) | closed |
| T-13-12-03 | Info Disclosure | channels CSV export | mitigate | `channels/export/route.ts:19` delegates to `handleCsvExport` (full gauntlet re-applied) | closed |
| T-13-12-04 | Info Disclosure | approved-intents queue read | mitigate | `src/lib/read/approved-fee-intents.ts` — `import "server-only"` (:1), drizzle `eq(commands.nodePubkey, pubkey)` parameter-bound scope + `state='approved'` + `claimed_at IS NULL` (:44-52), returns chanId → commandId only, catch → `{}` fail-soft (:66-69); no secret/params leaked to the client | closed |
| T-13-12-SC | Tampering | npm installs | mitigate | zero installs | closed |

### 13-13 — peers sub-route

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-13-01 | Tampering | pubkey / ?focus | mitigate | `peers/page.tsx:40,75` PUBKEY_RE → notFound; `:108-110` — invalid `?focus` silently ignored (PUBKEY_RE-gated, `firstParam` discipline per IN-04 fix) | closed |
| T-13-13-02 | Spoofing | peer count integrity | mitigate | `src/lib/console/peers.ts:83-113` — counterparties from `active === true` latest-channel rows ONLY, never a COUNT over the lifetime log (unreliable `closed` column documented `:102-109`) | closed |
| T-13-13-03 | Info Disclosure | per-peer liquidity | mitigate | derived from real channel local/remote; honest-empty when unknowable (`liquidity-split.ts:34-36` null share); WR-05 fix: single snapshot via `preReadChannelRows` (`peers.ts:152-158`) | closed |
| T-13-13-SC | Tampering | npm installs | mitigate | zero installs | closed |

### 13-14 — forwards sub-route

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-14-01 | Tampering | ?window / ?page | mitigate | `forwards/page.tsx:37-38` — window via `WINDOW_PRESETS` membership (`WINDOW_KEYS`), only the bound preset int reaches SQL; page via `parsePageParam` clamp inside `forwardsPageData` (`forwards.ts:252`) | closed |
| T-13-14-02 | Tampering | pubkey segment | mitigate | `forwards/page.tsx:37,65` — PUBKEY_RE → notFound() before any read (notFound outside the try, WR-01 fix `:71-93`) | closed |
| T-13-14-03 | Info Disclosure | forwards CSV export | mitigate | `forwards/export/route.ts:19` delegates to `handleCsvExport` (full gauntlet + AFM-002 fee math via `buildForwardsFullSql`) | closed |
| T-13-14-SC | Tampering | npm installs | mitigate | zero installs | closed |

### 13-15 — lean overview

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-15-01 | Tampering | pubkey in route | mitigate | `[pubkey]/page.tsx:64,146` — PUBKEY_RE → notFound() before any read (retained) | closed |
| T-13-15-02 | Info Disclosure | CSV export / redirect regression | mitigate | `[tab]/export/route.ts` intact and delegating; static sub-routes carry their own export routes (`channels/export/route.ts`, `forwards/export/route.ts`) | closed |
| T-13-15-03 | Spoofing | liquidity gauge as health | mitigate | aggregate gauge is the same neutral-only `LiquidityGauge` (T-13-21-01 gate); navy never a health hue | closed |
| T-13-15-SC | Tampering | npm installs | mitigate | zero installs | closed |

### 13-16 — presentational polish

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-16-01 | Tampering | SummaryStrip grid class | mitigate | `SummaryStrip.tsx:13-30` — `LG_COLS`/`SM_COLS` literal-class lookup maps keyed by cell count with a literal fallback; no dynamically-built Tailwind strings | closed |
| T-13-16-02 | Info Disclosure | NodeChannelsTable soft-column wrapping | accept | layout-only change of already-authorized, already-formatted values; AFM-002 formatting untouched — see Accepted Risks AR-01 | closed |
| T-13-16-SC | Tampering | package installs | accept | CSS/layout-only plan; zero installs verified (package.json untouched) — see AR-02 | closed |

### 13-17 — gap closure (alias link, peers predicate, intercept removal)

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-17-01 | Tampering / open-redirect | Ops Center alias Link | mitigate | `(overview)/page.tsx:410` — `href={`/${node.pubkey}`}` internal relative href from the trusted 66-hex warehouse value; destination re-validates via PUBKEY_RE before any read | closed |
| T-13-17-02 | Info Disclosure | shapePeersTab widened predicate | accept | surfaces only real `active === true` counterparties already exposed by the channels table under the same predicate (`peers.ts:102-113`) — see AR-03 | closed |
| T-13-17-03 | DoS | intercept removal | accept | full /{pubkey} page is force-dynamic with per-section fail-soft `.catch` reads (`[pubkey]/page.tsx:159-177`); no new read amplification — see AR-04 | closed |
| T-13-17-SC | Tampering | package installs | accept | data/routing edits only; zero installs verified — see AR-02 | closed |

### 13-18 — operator visual gate

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-18-01 | Repudiation | gate outcome | mitigate | `13-NODE-DETAIL-GATE-FEEDBACK.md` frontmatter: `gate_outcome: gaps_found`, `date: 2026-07-09`, verbatim operator feedback recorded | closed |
| T-13-18-SC | Tampering | package installs | accept | verification-only checkpoint; zero installs verified — see AR-02 | closed |

### 13-19 — @modal default fallback

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-19-01 | Tampering | @modal/[pubkey]/default.tsx | mitigate | mitigation superseded by 13-23: the entire `@modal` slot was DELETED (no `@modal` dir under `src/app/(overview)`; `layout.tsx:11-16` documents the removal). The null-fallback surface no longer exists; [pubkey] pages remain PUBKEY_RE-gated | closed |
| T-13-19-02 | Info Disclosure | parallel slot | accept | slot removed entirely — no data ever crosses a @modal boundary; no new write path — see AR-05 | closed |

### 13-20 — forwards table fees column

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-20-01 | Tampering | forwards reader | mitigate | no reader/SQL change; reader stays read-only; ?window/?page remain whitelist/clamped (T-13-14-01 evidence); zero new write path | closed |
| T-13-20-02 | Info Disclosure | Fees earned column | mitigate | `NodeForwardsTable.tsx:12,145-150` — fee sats only via `feeMsatToSat(Number(row.fee_msat))` + `formatSats`; raw `fee` column never rendered | closed |

### 13-21 — gauge recolor (DS-01)

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-21-01 | Spoofing | health signalling via color | mitigate | `LiquidityGauge.tsx:116-122` — local `bg-df-brand` (navy) / remote df-slate (grey) reference hues; grep of component confirms zero `df-crit`/`df-warn`/`df-ok`/`df-watch`/red/amber/green severity classes in the render path (severity ramp mentioned only in the prohibition comment `:18`) | closed |
| T-13-21-02 | Tampering | LiquidityGauge props | accept | pure presentational recolor; no prop/signature change, no read, no write path — see AR-06 | closed |

### 13-23 — @modal slot removal

| Threat ID | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-23-01 | Tampering | route deletion | mitigate | only the dead null-rendering `@modal` slot removed (`ls src/app/(overview)` shows no `@modal`; `layout.tsx:11-16`); all page routes + export routes intact (verified above) | closed |
| T-13-23-SC | — | dependencies | mitigate | pure file delete + layout edit; zero installs verified | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-13-16-02 | Soft-column wrapping only changes layout of already-authorized, already-formatted values; no new data surfaced, AFM-002 formatting untouched (verified: `NodeChannelsTable.tsx` display path unchanged). | plan 13-16 threat model / security audit | 2026-07-10 |
| AR-02 | T-13-16-SC, T-13-17-SC, T-13-18-SC | No package installs in these plans (CSS/layout, data/routing, verification-only). Verified: `package.json` last modified `fec1c80` (2026-06-24, phase 10). | plan threat models / security audit | 2026-07-10 |
| AR-03 | T-13-17-02 | Widened peers predicate surfaces only real `active === true` channel counterparties already exposed by the channels table under the same predicate; no new or unauthorized data. | plan 13-17 threat model / security audit | 2026-07-10 |
| AR-04 | T-13-17-03 | Intercept removal changes navigation resolution only; /{pubkey} already force-dynamic with per-section fail-soft `.catch` reads — no new read amplification. | plan 13-17 threat model / security audit | 2026-07-10 |
| AR-05 | T-13-19-02 | @modal parallel slot rendered null and was subsequently deleted (13-23); no node data ever crossed the boundary, no write path. | plan 13-19 threat model / security audit | 2026-07-10 |
| AR-06 | T-13-21-02 | Pure presentational recolor of LiquidityGauge; no prop/signature change, no reads, no write path. | plan 13-21 threat model / security audit | 2026-07-10 |
| AR-07 (partial) | T-13-03-05, T-13-06-05 | AI-elevation dispositions were accept/mitigate: verified zero AI-SDK imports on the write path (`queue.ts`, `enqueue.ts`, `NodeFeeEnqueue.tsx`); B8 seeds `suggestedPpm = currentPpm` (no-AI). Residual accept: AI narration elsewhere in the app is copy-only and can never produce signed params. | plan threat models / security audit | 2026-07-10 |

---

## Unregistered Flags

None. No `## Threat Flags` section exists in any of the 23 SUMMARY files (several carry informational "Threat model coverage" sections that map 1:1 to registered threat IDs). No new attack surface without a threat mapping was declared by executors.

---

## Notes (out-of-scope infra items — not open threats)

- **nodemon_rw test-grant gap** — documented environment/infra item; the runtime app role boundary is unchanged. Out of scope per audit constraints.
- **Unmanaged drizzle migration history on the nodemon DB** — `0001` was applied out-of-band pre-phase, so `drizzle-kit migrate` cannot replay; the phase-13 `0002` enum value was applied by the operator as the `postgres` owner via idempotent `ADD VALUE IF NOT EXISTS` (13-01-SUMMARY). The committed migration file remains the schema source-of-record. Pre-existing infra, out of scope.
- **Review overlap verified in fixed state:** CR-01 (pagination offset), CR-02 (`?window=latest` export gauntlet), WR-01/WR-02 (honest degrade vs fake 404/500), WR-03 (service-case canonicalization), WR-04 (validated TTL in `src/lib/queue/ttl.ts`), WR-05 (single channel snapshot) — all confirmed present at HEAD `621ba0b`.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-10 | 60 | 60 | 0 | gsd-security-auditor (Claude) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-10
