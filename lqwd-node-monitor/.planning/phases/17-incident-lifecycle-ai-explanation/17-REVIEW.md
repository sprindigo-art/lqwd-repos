---
phase: 17-incident-lifecycle-ai-explanation
reviewed: 2026-07-21T00:00:00Z
resolution: "CR-01 fixed (e874a6c) + WR-01 fixed (97baba6). WR-02/WR-03/IN-01/IN-02/IN-03 deferred as tracked follow-ups."
depth: deep
files_reviewed: 16
files_reviewed_list:
  - src/lib/overview/incident-detail.ts
  - src/lib/overview/incident-prompt.ts
  - src/lib/overview/incident-tracking.ts
  - src/lib/overview/load-incidents.ts
  - src/lib/insight/guardrails.ts
  - src/lib/db/schema/nodemon.ts
  - src/lib/db/read/incident-tracking.ts
  - src/app/actions/incident-tracking.ts
  - src/app/actions/narrate-incident.ts
  - src/components/incident/IncidentTrackingControls.tsx
  - src/components/incident/IncidentReadClient.tsx
  - src/components/incident/SnoozedCriticalBanner.tsx
  - src/app/(overview)/incidents/[incidentKey]/page.tsx
  - src/app/(overview)/page.tsx
  - src/components/overview/QueueIsland.tsx
  - src/app/(overview)/hosts/[hostId]/page.tsx
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-07-21
**Depth:** deep
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 17 adds the incident-lifecycle tracking state machine, the incident-detail
RSC, the on-demand AI "read" action, and the tracking write surface. The security
posture on the AI path is genuinely strong: `narrateIncident` re-checks the flag
server-side before any SDK import, refuses client-supplied incident cards
(server-recompute by key only), delimits untrusted payload, bounds output tokens,
and gates output through `assertAdvisoryOnly`. The nodemon write path is
parameter-bound Drizzle with guarded `WHERE … AND cleared_at IS NULL` clauses and
a partial-unique index — no injection surface, no fleet/warehouse write, no
credentials. Prompt-injection containment is correctly implemented.

However, one correctness defect is a shipping blocker: the per-request reconcile
on the overview persists `set-cleared` writes with **no guard that the incident
read actually succeeded**, so a transient warehouse outage silently wipes all
operator ack/snooze tracking. Three warnings cover a guardrail that over-withholds
the most common incident type, a violated faithfulness invariant, and a
breakthrough-baseline loss on un-snooze.

## Critical Issues

### CR-01: Transient warehouse read failure mass-clears all operator ack/snooze tracking

**File:** `src/app/(overview)/page.tsx:484-492` (with `src/lib/overview/incident-tracking.ts:158-165` and `src/lib/db/read/incident-tracking.ts:105-113`)

**Issue:**
`buildOverviewData` is fail-soft: every warehouse/telemetry read has its own
`.catch(() => [])` (page.tsx:194-221), so a transient failure resolves
**successfully** with a degraded/empty `incidents` array rather than throwing. The
reconcile then runs **unconditionally** at line 487:

```ts
const reconciled = await reconcileAndGetView(incidents, new Date());
```

`reconcileTracking` D-07 resolution (incident-tracking.ts:160-165) emits a
`set-cleared` write for **every active tracking row whose key is not in the live
incident set**:

```ts
const liveKeys = new Set(incidents.map((i) => i.key));
for (const row of activeRows) {
  if (!liveKeys.has(row.incidentKey)) {
    writes.push({ kind: "set-cleared", id: row.id, clearedAt: now });
  }
}
```

`applyTrackingWrites` then commits those clears (incident-tracking read layer:77-96).
Because the warehouses (`routing`/telemetry) and `nodemon` are **separate
databases**, a warehouse blip while nodemon is healthy produces `incidents = []`
while `loadActiveTracking()` still returns every row — so **all** active rows are
`set-cleared` in a single render. `cleared_at` is filtered out by
`loadActiveTracking` (WHERE cleared_at IS NULL), so the ack/snooze/owner state is
irreversibly closed; a "recurrence-is-new" row only re-appears if the operator
re-acts. A snoozed critical silently re-floods the queue and every acknowledgement
is lost. This violates the project core value ("every recommended action must be
safe and accountable") and the D-07 invariant (resolution should mean the incident
genuinely left the live set, not that a read degraded).

**Fix:** Do not persist resolution writes derived from a degraded read. Gate the
reconcile behind a "reads were healthy" signal, or make `set-cleared` require
positive evidence the fleet loaded. Minimal approach — thread a `readsHealthy`
flag out of `buildOverviewData` (false if any top-level `.catch` fired) and skip
the write path when unhealthy:

```ts
// page.tsx — only reconcile+persist when the incident set is trustworthy.
if (data.readsHealthy) {
  const reconciled = await reconcileAndGetView(incidents, new Date());
  view = reconciled.view;
  snoozedCriticals = reconciled.snoozedCriticals;
}
```

Alternatively, split reconcile into a pure read-time view/banner computation
(always safe) and a separate resolution-write pass that only runs on a confirmed
full-fleet load. Detail pages already do the read-only variant (they call the pure
`reconcileTracking` without persisting) — the overview should not persist clears
on a fail-soft-empty set.

## Warnings

### WR-01: `assertAdvisoryOnly` withholds legitimate reads for the most common incident type (`bitcoind`)

**File:** `src/lib/insight/guardrails.ts:181-191`

**Issue:**
The command-signature list matches the bare daemon/subject names `bitcoind`,
`docker`, and `psql` with word boundaries:

```ts
{ re: /\bbitcoind\b/i, reason: "contains a bitcoind invocation" },
...
{ re: /\bdocker\b/i, reason: "contains a docker invocation" },
{ re: /\bpsql\b/i,   reason: "contains a psql invocation" },
```

`bitcoind` is a first-class incident **layer** (`LAYER_LABEL.bitcoind`,
incident-detail page) and the driver of the most common critical incidents
("bitcoind is behind tip / down"). Any advisory narration of a bitcoind incident
will almost certainly contain the word "bitcoind" as the *subject* of a sentence
("bitcoind appears to be lagging the chain tip"), which is not an invocation. The
regex conflates discussing the daemon with running it, so the guardrail will
**withhold the read for nearly every bitcoind incident** — defeating the feature
precisely where operators most want the explanation. It fails safe (the
deterministic card stands), but the AI read is effectively broken for the dominant
incident class. Note the list deliberately omits `postgres` (a service name) yet
includes `bitcoind` (also a service name) — inconsistent.

**Fix:** Only flag these as invocations when they appear command-shaped, not when
named as a subject. Anchor to a shell context — e.g. require a leading `$`/`sudo`,
a subcommand token, or a line-start invocation — rather than a bare word boundary:

```ts
// invocation-shaped only: start-of-token command with an argument/subcommand
{ re: /(^|[`$]\s*)bitcoin-cli\b/im, reason: "contains a bitcoin-cli invocation" },
// drop bare `\bbitcoind\b` / `\bdocker\b` / `\bpsql\b` as subject words;
// keep bitcoin-cli / lncli / lncmd / systemctl / pg_ctl which are only ever commands.
```

Keep the genuinely command-only tokens (`lncli`, `lncmd`, `systemctl`,
`bitcoin-cli`, `pg_ctl`, `sudo`) and remove the subject-noun tokens, or require an
adjacent argument/flag to treat them as invocations.

### WR-02: `loadIncidents` omits the 30-day cutoff + eliminated-node drop, breaking the stated faithfulness invariant

**File:** `src/lib/overview/load-incidents.ts:40-69` vs `src/app/(overview)/page.tsx:224-244`

**Issue:**
The header of `load-incidents.ts` claims it is "the ONE server-only incident-assembly
loader" whose payload "MUST be byte-identical to the UI it explains (faithfulness
invariant, AI-SPEC FM-2)." But the overview does **not** use `loadIncidents`; its
`buildOverviewData` applies a 30-day freshness cutoff and drops ranked cards for
eliminated nodes **before** `assembleIncidents` (page.tsx:229-241). `loadIncidents`
applies neither. As a result:

- `narrateIncident` and both detail pages (incident-detail, host-detail) operate on
  an **uncut** incident set, while the overview queue (and its `/incidents/[key]`
  links) operate on a **cut** set.
- A stale (>30d) entity excluded from the overview can still resolve on the detail
  page and be narrated by the AI — the read is NOT byte-identical to the queue it
  explains, violating the very FM-2 invariant the module documents.
- The overview reconcile input (cut) differs from what the detail pages reconcile
  against (uncut), producing divergent `snoozedCriticals` counts between surfaces.

**Fix:** Apply the same freshness cutoff + eliminated-node card filter inside
`loadIncidents` so it is the single source of truth, and refactor
`buildOverviewData` to consume it (or extract the cutoff+assemble step into one
shared helper both call). The invariant is only true if both paths run identical
pre-assembly filtering.

### WR-03: `unsnoozeIncident` nulls the D-06 mute baseline even when the incident is still acked

**File:** `src/app/actions/incident-tracking.ts:173-186`

**Issue:**
`unsnoozeIncident` unconditionally clears the mute baseline:

```ts
await upsertActive(incidentKey, {
  snoozeUntil: null,
  mutedAtSeverity: null,
  mutedCriticalChildren: null,
});
```

If the active row is **both acked and snoozed**, un-snoozing wipes
`mutedAtSeverity`/`mutedCriticalChildren` while leaving `ackedAt` set — so the row
is still muted (via ack, per `isMuted`), but its breakthrough baseline is gone.
`breaksThrough` (incident-tracking.ts:87-96) can then no longer fire the
count-based breakthrough (`mutedCriticalChildren` is null → `countBreakthrough`
false), weakening the "a broken-through critical is never silently muted"
guarantee for an incident that remains acked. Un-snooze should only reverse the
snooze, not the ack's mute baseline.

**Fix:** Clear only the snooze; recompute/preserve the mute baseline from the ack
state. If `ackedAt` is still set, either leave the baseline intact or re-snapshot
it via `muteBaseline`:

```ts
// Only null snoozeUntil; preserve the ack baseline when ackedAt is present.
await upsertActive(incidentKey, { snoozeUntil: null });
```

(Handle the "was only snoozed, never acked" case by leaving a stale baseline
harmless, or clear it only when `ackedAt IS NULL`.)

## Info

### IN-01: Verdict badge and model first-line verdict can disagree

**File:** `src/components/incident/IncidentReadClient.tsx:126-134` / `src/lib/overview/incident-prompt.ts:41`

**Issue:** `VerdictBadge` renders the deterministic `worstSeverity`-derived verdict
("Act now" for critical), while the system prompt also instructs the model to
**lead its prose with one urgency verdict** on the first line, which then renders
verbatim inside `AiReadPanel` directly below the badge. On a critical the operator
can see the badge say "Act now" and the model text open with "Monitor" (or vice
versa if the model mis-grades), presenting two conflicting verdicts. The badge is
authoritative by design, but the duplicated model verdict undercuts it.

**Fix:** Either drop the "lead with one verdict" instruction from the system prompt
(let the badge own the verdict and have the model narrate only the explanation), or
strip/normalize the model's first verdict line before rendering so only the
deterministic badge is shown.

### IN-02: `upsertActive` SELECT-then-INSERT can raise a unique violation under concurrency

**File:** `src/app/actions/incident-tracking.ts:72-92`

**Issue:** The upsert does `SELECT … WHERE cleared_at IS NULL` then `INSERT` inside
one transaction. Two concurrent actions for the same key both see no row and both
attempt `INSERT`; the partial-unique index (`incident_tracking_active_key_uniq`)
rejects the second with a unique violation, which surfaces as `{ ok: false }`.
Harmless for the documented solo operator, but a lost gesture under any
double-click/parallel-tab race.

**Fix:** Use an `INSERT … ON CONFLICT (incident_key) WHERE cleared_at IS NULL DO
UPDATE` so the write is atomic and idempotent rather than select-then-insert.

### IN-03: `childHref` routes node/fleet-keyed parents to a non-existent host page

**File:** `src/app/(overview)/incidents/[incidentKey]/page.tsx:92-104`

**Issue:** For host/bitcoind/service/storage children, `childHref` returns
`/hosts/${incidentKey}`, but `incidentKey` is the *parent incident key*. For a
fleet-level incident (`key === "fleet"`/`"unattributed"`) or a node-keyed parent
(pubkey), this yields `/hosts/fleet` or `/hosts/{pubkey}`, which resolves to
`notFound()`. A dead child deep-link rather than omitting the link.

**Fix:** Only emit the `/hosts/{key}` link when the parent key is genuinely a
host id (or derive the host id from the child rather than the parent), else return
`undefined` so the row renders link-free.

---

_Reviewed: 2026-07-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
