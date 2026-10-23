---
phase: 10
slug: design-system-foundation
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-23
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `10-RESEARCH.md` § Validation Architecture (HIGH confidence).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4 |
| **Config file** | none at root — Wave 0 adds `vitest.config.ts` (jsdom env) if component render tests are kept; dep-free fallback is `renderToStaticMarkup` from `react-dom/server` |
| **Quick run command** | `npm test -- src/components/df` |
| **Full suite command** | `npm test` (→ `vitest run`) |
| **Estimated runtime** | ~10–20 seconds (unit + render smoke) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- <changed df path>` + `npm run lint:noc-guard`
- **After every plan wave:** Run `npm test` (full vitest) + `npm run build`
- **Before `/gsd:verify-work`:** Full suite green + `lint:noc-guard` exit 0 + `next build` green
- **Max feedback latency:** ~20 seconds

---

## Per-Task Verification Map

> Task IDs are assigned by the planner; rows below pre-bind each phase requirement to its
> observable test so the planner can attach `<automated>` verify commands to the owning tasks.

| Req | Wave | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|------|----------|-----------|-------------------|-------------|--------|
| DS-01 | 1 | Every `df-*` color/radius/shadow token in `globals.css` mirrored in `src/lib/df/tokens.ts` (parity) | unit | `npm test -- src/lib/df/tokens.test.ts` | ❌ W0 | ⬜ pending |
| DS-01 | 1 | Severity ramp AA — TEXT roles ≥4.5:1, NON-TEXT (dot/accent) roles ≥3:1 on stated bg | unit | `npm test -- src/lib/df/contrast.test.ts` | ❌ W0 | ⬜ pending |
| DS-01 | 1 | No severity hue equals a chrome/brand hue (set-disjointness) | unit | `npm test -- src/lib/df/tokens.test.ts` | ❌ W0 | ⬜ pending |
| DS-01 | 2 | Stale token set renders shape-distinct (square dot r2px + dashed border) | unit (render) | `npm test -- src/components/df/FreshnessChip.test.tsx` | ❌ W0 | ⬜ pending |
| DS-02 | 2 | Each primitive renders in all 7 states without throwing | unit (render) | `npm test -- src/components/df` | ❌ W0 | ⬜ pending |
| DS-02 | 2 | EvidenceChart renders SVG (Recharts) line+threshold+band; falls back to StaleChart when stale | unit (render) | `npm test -- src/components/df/EvidenceChart.test.tsx` | ❌ W0 | ⬜ pending |
| DS-02 | 2 | Numeric-bearing primitives call `units.ts` (no inline sat/BTC math) | unit | `npm test -- src/components/df` | ❌ W0 | ⬜ pending |
| DS-02 | 3 | Gallery route builds (RSC + client islands) | build | `npm run build` | n/a (build gate) | ⬜ pending |
| DS-03 | 3 | NOC-guard grep returns ZERO matches on `src/components/df/**` + `src/app/(design)/**` | static/build | `npm run lint:noc-guard` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Observable success criteria (map to ROADMAP's 4):**
1. *(Canonical token set)* — `tokens.test.ts` (parity + ramp-vs-chrome disjointness) + `contrast.test.ts` (AA) pass.
2. *(Primitive library + gallery)* — gallery `next build` succeeds; smoke-render tests pass for every primitive × every state.
3. *(NOC retired on v2 surfaces)* — `npm run lint:noc-guard` exits 0.
4. *(Honest stale/no-data first-class)* — `FreshnessChip`/`StaleChart` render tests assert the shape-distinct stale treatment.

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — jsdom environment; add `@testing-library/react` + `jsdom` IF render tests are kept (flag as new devDeps for slopcheck). Dep-free alternative: `renderToStaticMarkup` smoke/shape assertions.
- [ ] `src/lib/df/tokens.ts` + `tokens.test.ts` — token parity + ramp/chrome disjointness
- [ ] `src/lib/df/contrast.test.ts` — pure-function AA ratios over token hexes
- [ ] `src/components/df/*.test.tsx` — per-primitive render-all-states + units.ts usage + stale shape
- [ ] `package.json` `lint:noc-guard` script (DS-03)
- [ ] `EvidenceChart.test.tsx` — Recharts renders / stale fallback

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual fidelity of primitives vs locked prototype | DS-02 | Pixel/grammar match to `Ops Center - Data-Forward v2` is a human judgment | Open `/design-system` gallery, compare each primitive against `.prototype-snapshot/shots/` references |
| EvidenceChart grammar (band/threshold/area/projection/marker) matches prototype intent | DS-02 | Recharts rebuild ≠ pixel port; grammar correctness is visual | Compare gallery EvidenceChart against prototype `chart()` output |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (plan-checker Dimension 8: PASS)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (10-01 T2/T3 install vitest `.tsx` + tokens/contrast tests + guard)
- [x] No watch-mode flags (`vitest run`, not `vitest`)
- [x] Feedback latency < 20s
- [x] `nyquist_compliant: true` set in frontmatter

> `wave_0_complete` stays false until Wave 0 (plan 10-01) actually executes.

**Approval:** approved 2026-06-23 (plan-checker verified — plans satisfy the validation contract)
