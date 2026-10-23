import "server-only";

/**
 * The single sanctioned "what time is it" read for SERVER-rendered components.
 *
 * Why this exists
 * ---------------
 * React 19's `react-hooks/purity` rule forbids calling `Date.now()` inside a
 * component body, and it is right to: in a CLIENT component, render is re-entrant
 * (concurrent rendering, StrictMode double-render, retries), so two reads inside
 * one logical render can disagree and the UI becomes nondeterministic.
 *
 * A React Server Component is different: it renders ONCE per request and its
 * output is serialized and shipped. A clock read during that pass is stable for
 * the request, which is exactly the semantic a freshness/staleness display wants.
 *
 * This helper centralises that read so it is auditable in one place instead of
 * scattered across five component bodies. It does not make the call pure — it
 * makes it explicit, `server-only`, and documented.
 *
 * Rules
 * -----
 *  - SERVER components only. `import "server-only"` makes a client import a build
 *    error rather than a subtle runtime bug.
 *  - CLIENT components must NOT use this. They should either receive the time as a
 *    prop from the server, or hold it in state and tick it in an effect — see
 *    `PollAge` and `IncidentTrackingControls` for that pattern.
 *  - Prefer threading an explicit `now`/`nowMs` prop where a caller already has
 *    one (tests and deterministic SSR rely on being able to inject it). This is
 *    the fallback for when no caller-supplied value exists.
 */
export function renderNowMs(): number {
  return Date.now();
}

/** `Date` flavour of {@link renderNowMs}, for APIs that take a Date. */
export function renderNow(): Date {
  return new Date(renderNowMs());
}
