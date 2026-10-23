# Phase 10: Design-System Foundation — Discussion Log

**Date:** 2026-06-23
**Mode:** discuss (default)
*Human-reference audit trail. Not consumed by downstream agents — see 10-CONTEXT.md for the canonical decisions.*

## Areas selected for discussion

Operator selected all four: Prototype source & readiness, Token-drift resolution,
Primitive gallery delivery, NOC retirement + transition.

## Area 1 + 2 — Prototype source & token authority

- **Q:** Where do the canonical tokens + primitives come from?
  - Options: winner-dropped-locally / **in claude.ai/design (372850ad…)** / synthesize from briefs / wait.
  - **Selected:** in claude.ai/design.
  - Operator note: *"you said i didnt need to drop design as you have direct access."* → confirmed: use the claude.ai/design integration directly, no manual drop.
- Claude verified access: project "LQWD Fleet Alert Dashboard" reachable; holds Data-Forward v1/v2 + Editorial + Triage Board directions, full screen set, and `support.js`.
- **Q:** Which version is canonical + how to settle drift?
  - Options: **Data-Forward v2 + extract values** / compare first / Data-Forward v1.
  - **Selected:** Data-Forward v2 + extract values. → Token values read off the prototype during planning resolve the chrome/ok-green/critical drift; prototype beats the older briefs.

## Area 3 — Primitive gallery delivery

- **Q:** How does DS-02 ship the gallery?
  - Options: **in-app /design-system route** / real Storybook / static page.
  - **Selected:** in-app /design-system route (no new tooling; real components + tokens).

## Area 4 — NOC retirement + transition

- **Q:** How to handle v1 screens (overview/console/inbox) during DS-03 retirement?
  - Options: **additive now, retire per-screen** / hard-cut the token layer now.
  - **Selected:** additive now, retire per-screen. Grep guard scoped to new v2 surfaces; NOC tokens deleted when the last v1 screen is replaced. Icons-for-state reversal confirmed (supersedes sketch-findings NOC grammar).

## Deferred / redirected

- Todo matches (node-detail, one-click-enqueue → Phase 13; ui-polish → Phase 12;
  lncli/A2 → Phase-8 tooling follow-ups) reviewed and NOT folded — belong to other phases.
