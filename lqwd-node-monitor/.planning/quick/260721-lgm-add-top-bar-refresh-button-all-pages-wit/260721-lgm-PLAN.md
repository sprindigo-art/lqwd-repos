---
phase: quick-260721-lgm
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/overview/overview-cache.ts
  - src/lib/overview/overview-cache.test.ts
  - src/app/actions/refresh.ts
  - src/app/(overview)/page.tsx
  - src/components/df/RefreshControl.tsx
  - src/components/df/RefreshControl.test.tsx
  - src/components/df/NavRailShell.tsx
  - src/components/df/NavRailShell.test.tsx
autonomous: true
requirements: [QUICK-REFRESH]

must_haves:
  truths:
    - "Every page rendered inside NavRailShell shows a top-bar Refresh button beside the PollAge 'data as of' stamp"
    - "Clicking Refresh busts the overview 20s TTL cache and re-reads the warehouse (page shows fresh data-as-of)"
    - "An auto-refresh toggle re-runs the same refresh on a 60s interval; its ON/OFF state survives page navigation"
    - "The control is honestly labeled as refreshing the dashboard's warehouse READ — it does NOT claim to trigger collectors or poke nodes"
    - "The existing NavRailShell live-poll pill, PollAge stamp, view toggle, fleet ramp/tally markup is unchanged and its 23 tests still behave exactly as before (4 pre-existing view-toggle failures stay, untouched)"
  artifacts:
    - path: "src/lib/overview/overview-cache.ts"
      provides: "Single-owner overview cache global with clearOverviewCache() helper"
      exports: ["OVERVIEW_TTL_MS", "getOverviewCache", "setOverviewCache", "clearOverviewCache"]
    - path: "src/app/actions/refresh.ts"
      provides: "refreshData() 'use server' action — clears overview cache + revalidatePath"
      exports: ["refreshData"]
    - path: "src/components/df/RefreshControl.tsx"
      provides: "SSR-safe client Refresh button + auto toggle island"
      exports: ["RefreshControl"]
  key_links:
    - from: "src/app/actions/refresh.ts"
      to: "src/lib/overview/overview-cache.ts"
      via: "import clearOverviewCache"
      pattern: "clearOverviewCache"
    - from: "src/app/(overview)/page.tsx"
      to: "src/lib/overview/overview-cache.ts"
      via: "loadOverviewData reads/writes the shared cache helper"
      pattern: "getOverviewCache|setOverviewCache"
    - from: "src/components/df/NavRailShell.tsx"
      to: "src/components/df/RefreshControl.tsx"
      via: "mounted in the ms-auto right cluster"
      pattern: "RefreshControl"
    - from: "src/components/df/RefreshControl.tsx"
      to: "src/app/actions/refresh.ts"
      via: "startTransition calls refreshData"
      pattern: "refreshData"
---

<objective>
Add a shared top-bar Refresh button plus an auto-refresh toggle to NavRailShell so the
operator can force the dashboard to re-read the warehouse from any page (overview, nodes,
hosts, incident detail), beside the honest PollAge "data as of" stamp.

The refresh busts the overview's 20s TTL cache (a module-global) and revalidates the route.
It is honestly labeled: it refreshes the dashboard's READ of the warehouse — it does NOT
trigger the node collectors (which tick on their own ~5-min cadence) and does not poke nodes.

Purpose: The operator currently has no way to pull fresh data on demand — they wait out the
20s TTL and the browser round-trip. This gives an explicit, honest control.
Output: `overview-cache.ts` helper, `refreshData()` server action, `RefreshControl` client
island, mounted in NavRailShell's top bar.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

# Load before ANY UI work (NOC light theme, LQWD navy, df tokens/chrome):
Skill("sketch-findings-nodemonitor")

<interfaces>
<!-- Executor uses these directly — no codebase exploration needed. -->

CURRENT overview cache (src/app/(overview)/page.tsx :155-185) — to be relocated verbatim:
```typescript
export const OVERVIEW_TTL_MS = 20_000;
interface OverviewCacheEntry { at: number; promise: Promise<OverviewData>; }
const globalForOverview = globalThis as unknown as { _overviewDataCache?: OverviewCacheEntry };
// loadOverviewData(): TTL reuse within OVERVIEW_TTL_MS; on promise rejection, evict the
// entry (only if it is still the current entry) so the next load retries. PRESERVE BOTH.
```

Existing "use server" + copy discipline (src/app/actions/incident-tracking.ts, narrate.ts):
```typescript
"use server";
// client sends NOTHING sensitive; server does the work; wrap in try/catch where a
// result is returned. refreshData needs no input and returns void.
```

NavRailShell top-bar right cluster (src/components/df/NavRailShell.tsx :456-470) — the mount point:
```tsx
{/* Right cluster: extra slot, view toggle, live pill. */}
<div className="ms-auto flex items-center gap-3">
  {topBarEnd !== undefined && topBarEnd}
  {showViewToggle && (<ViewToggle .../>)}
  {showLivePill && (pollSinceMs !== undefined ? <PollAge sinceMs={pollSinceMs}/> : <LivePollPill .../>)}
</div>
```

Top-bar chrome tokens to match (the live-poll pill, :293): `rounded-df-btn border border-df-border
bg-df-surface px-3 py-[7px] text-xs text-df-muted`, dot accent `bg-df-ok`, PollAge uses
`font-df-mono text-[11px] text-df-faint`. Navy chrome token is `bg-df-chrome`.

Dep-free SSR test pattern (all src/components/df/*.test.tsx): `renderToStaticMarkup(createElement(Comp, props))`
then assert on the returned HTML string. NO jsdom.
</interfaces>

<constraints>
- Zero new npm deps (lucide-react `RefreshCw` + Next `revalidatePath` already present).
- noc-guard: files under src/components/df MUST use df-* tokens only — NO text-brand/bg-brand/
  border-brand/font-display/status-* tokens (verified via `npm run lint:noc-guard`).
- OUT OF SCOPE: SSE/websockets, forcing node collection, per-page bespoke caches beyond the
  overview, Phase-17 deferred items.
</constraints>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extract shared overview-cache helper + refreshData server action</name>
  <files>src/lib/overview/overview-cache.ts, src/lib/overview/overview-cache.test.ts, src/app/actions/refresh.ts, src/app/(overview)/page.tsx</files>
  <behavior>
    overview-cache.test.ts (write FIRST, RED):
    - `getOverviewCache()` returns undefined when nothing is cached.
    - After `setOverviewCache(at, promise)`, `getOverviewCache()` returns that same entry (`.at` and `.promise` intact).
    - After `clearOverviewCache()`, `getOverviewCache()` returns undefined again.
    - `OVERVIEW_TTL_MS` is exported and equals 20_000.
    (Do NOT test revalidatePath — that is Next runtime, not unit-testable here.)
  </behavior>
  <action>
    Create src/lib/overview/overview-cache.ts as the SINGLE owner of the overview cache global.
    Move `OVERVIEW_TTL_MS`, the `OverviewCacheEntry` shape, and the `globalThis._overviewDataCache`
    accessor out of page.tsx into this helper. Expose: `OVERVIEW_TTL_MS`, `getOverviewCache()`,
    `setOverviewCache(at, promise)`, `clearOverviewCache()`. Keep the entry promise typed against
    the overview data shape — either type-only import the OverviewData type from page.tsx (type
    imports are erased, no runtime cycle) or type the promise as `Promise<unknown>` and let page.tsx
    cast; prefer the type-only import for safety. Do NOT change caching semantics.

    Refactor page.tsx `loadOverviewData()` to use the helper: read via `getOverviewCache()`, honor
    the SAME `OVERVIEW_TTL_MS` reuse window, write via `setOverviewCache(now, promise)`, and PRESERVE
    the failure-eviction `.catch` (evict only if the cached entry is still the one we set). Remove the
    now-duplicated local const/global from page.tsx. Behavior must be byte-for-byte equivalent.

    Create src/app/actions/refresh.ts ("use server"): export async `refreshData()` that calls
    `clearOverviewCache()` then `revalidatePath("/", "layout")`. Mirror the incident-tracking.ts /
    narrate.ts "use server" style. It takes no input and returns void. Add a one-line honest doc
    comment: this busts the dashboard's warehouse-read cache and revalidates — it does NOT trigger
    node collectors. Do NOT log anything sensitive.
  </action>
  <verify>
    <automated>npx vitest run src/lib/overview src/app/actions && npx tsc --noEmit</automated>
  </verify>
  <done>overview-cache.test.ts passes; page.tsx imports the helper (no local `_overviewDataCache` const remains); refresh.ts exports refreshData calling clearOverviewCache + revalidatePath; tsc clean; existing src/app/actions tests still green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: RefreshControl client island (SSR-safe, honest, df-tokened)</name>
  <files>src/components/df/RefreshControl.tsx, src/components/df/RefreshControl.test.tsx</files>
  <behavior>
    RefreshControl.test.tsx (write FIRST, RED) via renderToStaticMarkup:
    - Renders a button with aria-label "Refresh data" (the honest read label).
    - Renders a title/tooltip string clarifying it re-reads the warehouse and does NOT force a
      node collection (assert the markup contains e.g. "re-reads" and does NOT contain a claim
      like "collect" phrased as an action it triggers — assert the honest copy is present).
    - Renders an auto-refresh toggle: role="switch" with aria-pressed, an accessible label, and
      the honest "Auto · 60s" text.
    - With `defaultPending` (test-only prop) true, the button is disabled and the icon carries
      `animate-spin`.
  </behavior>
  <action>
    Create src/components/df/RefreshControl.tsx ("use client"). CRITICAL SSR-SAFETY: this island is
    mounted inside NavRailShell, whose 23 tests render the whole shell via renderToStaticMarkup with
    NO router context. `useRouter()` from next/navigation THROWS under renderToStaticMarkup (verified),
    which would break the locked NavRailShell suite. Therefore do NOT use useRouter. Use ONLY
    SSR-safe hooks: `useTransition`, `useState`, `useEffect` (same hook set PollAge already renders
    cleanly under the shell test). The route re-renders because `refreshData()` calls
    `revalidatePath("/", "layout")` — invoking a server action inside a client transition makes Next
    re-fetch the current route's RSC payload; no router.refresh() is needed.

    Manual button: `const [isPending, startTransition] = useTransition()`. onClick runs
    `startTransition(async () => { await refreshData(); })` (import refreshData from
    @/app/actions/refresh). While `isPending` (OR the `defaultPending` test prop): disable the button
    and add `animate-spin` to a lucide-react `RefreshCw` icon. aria-label="Refresh data";
    title/tooltip = honest copy, e.g. "Re-reads the warehouse now. Collectors tick on their own
    (~5 min); this does not force a node collection." NEVER imply it triggers collectors.

    Auto toggle: `const [autoOn, setAutoOn] = useState(false)` (default false — do NOT read
    localStorage in the initializer, that is undefined during SSR). In a useEffect on mount, read
    persisted state from `localStorage.getItem("nodemon.autoRefresh")` and setAutoOn accordingly
    (guard `typeof window`). In an effect keyed on autoOn: persist to localStorage; when ON, start
    `setInterval(() => startTransition(() => refreshData()), 60_000)`; return a cleanup that clears
    the interval (so OFF and unmount both clear it — no timer leak). Render as role="switch" with
    `aria-pressed={autoOn}`, an accessible label, and visible honest text "Auto · 60s".

    Accept a test-only optional prop `defaultPending?: boolean` used ONLY to force the pending
    visual (disabled + animate-spin) for the SSR render test; it does not drive real behavior.

    Styling: df tokens ONLY (noc-guard). Match the top-bar pill chrome: `rounded-df-btn border
    border-df-border bg-df-surface`, `text-df-muted`/`text-df-ink`, `font-df-mono` sizing like the
    live-poll pill; use `cn()` from @/lib/utils and @/ imports. Navy accent for the ON toggle via
    `bg-df-chrome`/`text-df-chrome` (never bg-brand). Keep it compact to sit inline in the cluster.
  </action>
  <verify>
    <automated>npx vitest run src/components/df/RefreshControl.test.tsx && npm run lint:noc-guard && npx tsc --noEmit</automated>
  </verify>
  <done>RefreshControl.test.tsx passes (honest aria-label + tooltip, role=switch auto toggle "Auto · 60s", defaultPending → disabled + animate-spin); component uses no useRouter; noc-guard clean; tsc clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Mount RefreshControl in NavRailShell top bar + single assertion</name>
  <files>src/components/df/NavRailShell.tsx, src/components/df/NavRailShell.test.tsx</files>
  <behavior>
    NavRailShell.test.tsx: ADD exactly ONE new assertion (write FIRST, RED) — the default render
    now contains the refresh control (assert on aria-label "Refresh data"). Do NOT modify, reorder,
    or weaken any of the 23 existing assertions; the 4 pre-existing view-toggle failures stay exactly
    as-is (do not touch them).
  </behavior>
  <action>
    In src/components/df/NavRailShell.tsx, import RefreshControl from "./RefreshControl" and mount
    `<RefreshControl />` inside the existing `ms-auto` right cluster (the div at :457), placed
    immediately BEFORE the `{showLivePill && ...}` PollAge block so it sits beside the "data as of"
    stamp. Because RefreshControl mounts unconditionally in the shell, it appears on every page that
    uses NavRailShell (overview, nodes, hosts, incident detail) — no per-page wiring required.

    Do NOT alter the existing OperatorNav, fleet ramp/tally, ViewToggle, LivePollPill, PollAge, or
    topBarEnd markup, classes, testids, or ordering — only insert the one new child. NavRailShell
    stays a Server Component (RefreshControl is the client island).

    Add the single new assertion to NavRailShell.test.tsx per the behavior block.
  </action>
  <verify>
    <automated>npx vitest run src/components/df src/app/actions src/lib/overview && npx tsc --noEmit && npm run lint:noc-guard</automated>
  </verify>
  <done>RefreshControl renders in the top bar on the default NavRailShell render; the new assertion passes; all previously-passing NavRailShell tests still pass and the 4 pre-existing view-toggle failures are unchanged (not newly broken, not "fixed"); tsc + noc-guard clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser client → refreshData server action | Untrusted click/interval crosses into a server action that mutates the in-process overview cache and revalidates the route. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-QR-01 | Denial of Service | refreshData / warehouse reads | accept | Action only clears a module-global cache + revalidatePath; warehouse reads are pooled (postgres.js max:5) and fail-soft. Auto interval floor is 60s. No amplification, read-only, `grafana_demo_ro` SELECT-only role bounds impact. |
| T-QR-02 | Tampering | refreshData input | mitigate | Action takes NO client input — nothing to tamper. It never writes to the warehouses or the nodemon queue; only the read cache is affected. |
| T-QR-03 | Information Disclosure | RefreshControl honesty copy | mitigate | Copy explicitly states it re-reads the warehouse and does NOT trigger collectors/poke nodes — prevents the operator misreading it as a live node action (matches the D-R7 honesty principle). |
</threat_model>

<verification>
Full gate (matches the quick-task constraint):
- `npx vitest run src/components/df src/app/actions src/lib/overview` — all target suites pass; NavRailShell's 4 pre-existing view-toggle failures remain exactly 4 (no new failures).
- `npx tsc --noEmit` — clean.
- `npm run lint:noc-guard` — v2 surfaces clean (RefreshControl uses df tokens only).
</verification>

<success_criteria>
- Top-bar Refresh button + "Auto · 60s" toggle render on every NavRailShell page beside PollAge.
- Refresh busts the overview 20s cache (via clearOverviewCache) and revalidates — fresh data-as-of.
- Auto toggle persists across navigation (localStorage) and clears its interval on OFF/unmount.
- Honest labeling present; no claim of triggering collectors / poking nodes.
- Existing NavRailShell/PollAge/pill/view-toggle markup and their 23 tests unchanged in behavior.
- Zero new npm dependencies.
</success_criteria>

<output>
Create `.planning/quick/260721-lgm-add-top-bar-refresh-button-all-pages-wit/260721-lgm-SUMMARY.md` when done.
</output>
