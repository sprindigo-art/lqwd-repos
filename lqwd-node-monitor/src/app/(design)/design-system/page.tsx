import type { ReactNode } from "react";

import { NavRailShell } from "@/components/df/NavRailShell";
import { SeverityHeroCard } from "@/components/df/SeverityHeroCard";
import { SeverityCard } from "@/components/df/SeverityCard";
import { SeverityRow } from "@/components/df/SeverityRow";
import { TwoAxisPip } from "@/components/df/TwoAxisPip";
import { FreshnessChip } from "@/components/df/FreshnessChip";
import { ThresholdMeter } from "@/components/df/ThresholdMeter";
import { ImplTag } from "@/components/df/ImplTag";
import { AiReadPanel } from "@/components/df/AiReadPanel";
import { EvidenceChart } from "@/components/df/EvidenceChart";
import { CommandModal } from "@/components/df/CommandModal";
import { BlastRadius } from "@/components/df/BlastRadius";
import { WhyChain } from "@/components/df/WhyChain";
import {
  AI_READ_CALM_DETAIL,
  AI_READ_LINES,
  BLAST_RADIUS_FIXTURES,
  COMMAND_MODAL_FIXTURES,
  EVIDENCE_CHART_FIXTURES,
  FRESHNESS_CHIP_FIXTURES,
  FRESHNESS_NOW_ISO,
  GALLERY_STATES,
  HERO_AI_LINES,
  HERO_BEHIND_SERIES,
  HERO_BLAST_TARGETS,
  HERO_CHILDREN,
  HERO_COMMAND,
  HERO_RUNBOOK,
  HERO_TIMELINE,
  IMPL_TAG_FIXTURES,
  NAV_FLEET_COUNTS,
  NAV_POLL_AGE_SECONDS,
  SEVERITY_CARD_EXPANDED,
  SEVERITY_CARD_FIXTURES,
  SEVERITY_ROW_FIXTURES,
  STALE_CHART_FIXTURE,
  STATE_LABEL,
  STATE_TO_SEVERITY,
  THRESHOLD_METER_FIXTURES,
  TWO_AXIS_PIP_FIXTURES,
  WHY_CHAIN_FIXTURE,
  type GalleryState,
} from "./fixtures";
import { DF } from "@/lib/df/tokens";

// =====================================================
// /design-system — the DS-02 primitive gallery (RSC)
// =====================================================
// DS-02's proof artifact, rebuilt at G7 to SHOWCASE the now-fidelity-complete df
// primitives. A pure Server Component that imports every REAL `@/components/df/*`
// primitive (no re-implementation) and exercises each in its meaningful states
// from rich, prototype-matching STATIC fixtures (D-04 — no Storybook; T-10-10 — no
// DB/fetch). Client primitives (EvidenceChart, AiReadPanel, CommandModal) mount as
// client islands inside this RSC. df-* tokens + Tailwind defaults only — no NOC
// tokens (DS-03 / lint:noc-guard).
//
// Expand-driven primitives (SeverityHeroCard, the expanded SeverityCard) are
// rendered with `expanded` set and NO `onToggle`, so their drawers show OPEN
// statically — the caller owns toggle state, and the gallery needs no client wiring
// to display the full expanded composition. A deterministic `FRESHNESS_NOW_ISO` is
// passed to every FreshnessChip so the relative ages render stably.

export const metadata = { title: "Design System — DS-02 Gallery" };

const FRESHNESS_NOW = new Date(FRESHNESS_NOW_ISO);

/** A labelled top-level section wrapping one primitive's showcase. */
function Section({ name, blurb, children }: { name: string; blurb: string; children: ReactNode }) {
  return (
    <section className="mb-14">
      <header className="mb-5 border-b border-df-border pb-2">
        <h2 className="font-df-mono text-sm font-bold tracking-[0.08em] text-df-ink uppercase">
          {name}
        </h2>
        <p className="mt-1 text-[13px] text-df-muted">{blurb}</p>
      </header>
      {children}
    </section>
  );
}

/** One captioned slot showing a single primitive variant. */
function Cell({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-df-mono text-[10px] font-bold tracking-[0.06em] text-df-muted uppercase">
        {caption}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A responsive grid for variant cells. */
function Grid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 }) {
  const base =
    cols === 2
      ? "grid grid-cols-1 gap-5 lg:grid-cols-2"
      : "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3";
  return <div className={base}>{children}</div>;
}

export default function DesignSystemPage() {
  return (
    <NavRailShell
      active="ops"
      title="Design System — DS-02 Primitive Gallery"
      subtitle="Every Phase-10 primitive in its meaningful states, from prototype-matching static fixtures (no data access)."
      counts={NAV_FLEET_COUNTS}
      pollAgeSeconds={NAV_POLL_AGE_SECONDS}
      activeView="incident"
      topBarEnd={
        <span className="font-df-mono text-xs text-df-muted">df-* tokens · static fixtures</span>
      }
    >
      {/* ════════ SeverityHeroCard ════════ */}
      <Section
        name="SeverityHeroCard"
        blurb="The prototype TOP-PRIORITY hero: bitcoind on host-03 stalled — 22 min behind chain tip. ROOT CAUSE · 3 nodes roll up, the +22m evidence sparkline, the BlastRadius fan-out, the resolution callout, and the expand grid (why-chain + AI grouping + grouped children + Restart bitcoind export)."
      >
        <SeverityHeroCard
          sev="critical"
          rootCauseChip="ROOT CAUSE · 3 nodes roll up"
          freshLabel="data fresh · 4s"
          title="bitcoind on host-03 stalled — 22 min behind chain tip"
          narrative={
            <>
              The chain backend stopped advancing at{" "}
              <span className="font-df-mono text-df-ink">14:02</span>. Every Lightning node on
              host-03 can no longer confirm channel state, so pending HTLCs are at risk of
              force-closing. Fix the host first — the three node alerts below clear with it.
            </>
          }
          metaChips={["bitcoind · host-03", "flagged 14:08 · 22m ago"]}
          evidence={{
            series: HERO_BEHIND_SERIES,
            accent: DF.critical,
            evLabel: "Minutes behind chain tip · +22m",
            evValue: "+22m",
            evValueColor: DF.critical,
            evNote: "Climbing since 14:08 · alert threshold is 5 min — over it for 16 min.",
            threshold: { v: 5, label: "alert >5m" },
            area: "above",
            axisLabels: [
              { kind: "time", value: "-30m" },
              { kind: "time", value: "-15m" },
              { kind: "time", value: "now" },
            ],
            idSuffix: "hero-ev",
          }}
          blast={{
            host: "host-03",
            hostStatus: "bitcoind stalled",
            targets: HERO_BLAST_TARGETS,
            note: "one host outage → 3 nodes on it",
            resolution: (
              <>
                Restart bitcoind on host-03 and{" "}
                <span className="font-semibold text-df-ink">all 3 nodes clear automatically</span> —
                they share its backend, so don&rsquo;t act on them individually.
              </>
            ),
          }}
          expanded
          expandLabel="Why-chain · grouped alerts (shown open)"
          timeline={HERO_TIMELINE}
          aiLines={HERO_AI_LINES}
          childAlerts={HERO_CHILDREN}
          childrenLabel="3 grouped node alerts · clear when host-03 recovers"
          primaryAction={{
            title: "Restart bitcoind on host-03",
            intent:
              "Confirms the daemon is wedged, then restarts it and re-checks chain tip. Run the diagnostic first; only restart if it is truly stalled.",
            kind: "runbook",
            command: HERO_COMMAND,
            runbook: HERO_RUNBOOK,
          }}
        />
      </Section>

      {/* ════════ SeverityCard ════════ */}
      <Section
        name="SeverityCard"
        blurb="All 7 states — default (bare healthy), critical/warning/watch/healthy with inline evidence panels, honest-stale (STALE pill + StaleChart inset), and a loading skeleton. Each carries the ImplTag + FreshnessChip meta row where data is present."
      >
        <Grid cols={2}>
          {GALLERY_STATES.map((state: GalleryState) => {
            const fx = SEVERITY_CARD_FIXTURES[state];
            const freshness =
              fx.freshnessIso !== undefined
                ? {
                    asOf: fx.freshnessIso === null ? null : new Date(fx.freshnessIso),
                    stale: fx.freshnessStale ?? false,
                    now: FRESHNESS_NOW,
                  }
                : undefined;
            return (
              <Cell key={state} caption={STATE_LABEL[state]}>
                <SeverityCard
                  sev={STATE_TO_SEVERITY[state]}
                  title={fx.title}
                  label={fx.label}
                  why={fx.why}
                  body={fx.body}
                  impl={fx.impl}
                  stalePill={fx.stalePill}
                  freshness={freshness}
                  evidence={
                    fx.evidence
                      ? {
                          series: fx.evidence.series,
                          accent: fx.evidence.accent,
                          evLabel: fx.evidence.evLabel,
                          evValue: fx.evidence.evValue,
                          evValueColor: fx.evidence.evValueColor,
                          evNote: fx.evidence.evNote,
                          threshold: fx.evidence.threshold,
                          band: fx.evidence.band,
                          area: fx.evidence.area,
                          projection: fx.evidence.projection,
                          marker: fx.evidence.marker,
                          axisLabels: fx.evidence.axisLabels,
                          stale: fx.evidence.stale,
                          lastGoodLabel: fx.evidence.lastGoodLabel,
                          idSuffix: fx.idSuffix,
                        }
                      : undefined
                  }
                />
              </Cell>
            );
          })}
        </Grid>

        {/* The EXPANDED hero-grade card — drawer open (why-chain + AI + children + export). */}
        <div className="mt-7">
          <span className="mb-2 block font-df-mono text-[10px] font-bold tracking-[0.06em] text-df-muted uppercase">
            expanded · drawer open (why-chain + AI-read + grouped children + export)
          </span>
          <SeverityCard
            sev="critical"
            title={SEVERITY_CARD_EXPANDED.title}
            label={SEVERITY_CARD_EXPANDED.label}
            why={SEVERITY_CARD_EXPANDED.why}
            impl={SEVERITY_CARD_EXPANDED.impl}
            freshness={{
              asOf: new Date(SEVERITY_CARD_EXPANDED.freshnessIso),
              stale: false,
              now: FRESHNESS_NOW,
            }}
            evidence={{
              series: SEVERITY_CARD_EXPANDED.evidence.series,
              accent: SEVERITY_CARD_EXPANDED.evidence.accent,
              evLabel: SEVERITY_CARD_EXPANDED.evidence.evLabel,
              evValue: SEVERITY_CARD_EXPANDED.evidence.evValue,
              evValueColor: SEVERITY_CARD_EXPANDED.evidence.evValueColor,
              evNote: SEVERITY_CARD_EXPANDED.evidence.evNote,
              threshold: SEVERITY_CARD_EXPANDED.evidence.threshold,
              area: SEVERITY_CARD_EXPANDED.evidence.area,
              axisLabels: SEVERITY_CARD_EXPANDED.evidence.axisLabels,
              idSuffix: SEVERITY_CARD_EXPANDED.idSuffix,
            }}
            expanded
            expandLabel={SEVERITY_CARD_EXPANDED.expandLabel}
            timeline={SEVERITY_CARD_EXPANDED.timeline}
            aiLines={SEVERITY_CARD_EXPANDED.aiLines}
            childAlerts={SEVERITY_CARD_EXPANDED.children.map((c) => ({
              sev: c.sev,
              node: c.node,
              kind: c.kind,
              note: c.note,
              detail: c.detail,
            }))}
            childrenLabel={SEVERITY_CARD_EXPANDED.childrenLabel}
            exportAction={{
              title: SEVERITY_CARD_EXPANDED.exportTitle,
              intent: SEVERITY_CARD_EXPANDED.exportIntent,
              kind: "runbook",
              command: SEVERITY_CARD_EXPANDED.command,
              runbook: SEVERITY_CARD_EXPANDED.runbook,
            }}
          />
        </div>
      </Section>

      {/* ════════ EvidenceChart / StaleChart ════════ */}
      <Section
        name="EvidenceChart"
        blurb="The Recharts client island across every variant — area-above-threshold, area-under + vertical marker, dashed projection, peer-median band, shade-window, sats/time axis labels — wrapped in the EvidencePanel chrome. The last cell is the honest StaleChart fallback."
      >
        <Grid cols={2}>
          {EVIDENCE_CHART_FIXTURES.map((fx) => (
            <Cell key={fx.idSuffix} caption={fx.caption}>
              <div className="rounded-df-card border border-df-border bg-df-surface p-4">
                <EvidenceChart
                  series={fx.series}
                  accent={fx.accent}
                  threshold={fx.threshold}
                  band={fx.band}
                  area={fx.area}
                  projection={fx.projection}
                  marker={fx.marker}
                  shade={fx.shade}
                  axisLabels={fx.axisLabels}
                  stale={fx.stale}
                  lastGoodLabel={fx.lastGoodLabel}
                  height={104}
                  idSuffix={fx.idSuffix}
                />
              </div>
            </Cell>
          ))}
          <Cell caption={STALE_CHART_FIXTURE.caption}>
            <div className="rounded-df-card border border-df-border bg-df-surface p-4">
              <EvidenceChart
                series={STALE_CHART_FIXTURE.series}
                accent={STALE_CHART_FIXTURE.accent}
                stale={STALE_CHART_FIXTURE.stale}
                lastGoodLabel={STALE_CHART_FIXTURE.lastGoodLabel}
                height={104}
                idSuffix={STALE_CHART_FIXTURE.idSuffix}
              />
            </div>
          </Cell>
        </Grid>
      </Section>

      {/* ════════ BlastRadius ════════ */}
      <Section
        name="BlastRadius"
        blurb="The root-cause → impacted-nodes fan-out diagram (animated dashed edges), shown at N=3 (the hero host-03 scenario) and N=1 (a single-node blast)."
      >
        <Grid cols={2}>
          {BLAST_RADIUS_FIXTURES.map((fx) => (
            <Cell key={fx.host} caption={fx.caption}>
              <div className="overflow-x-auto rounded-df-card border border-df-border bg-df-surface p-4">
                <BlastRadius host={fx.host} hostStatus={fx.hostStatus} targets={fx.targets} />
              </div>
            </Cell>
          ))}
        </Grid>
      </Section>

      {/* ════════ WhyChain ════════ */}
      <Section
        name="WhyChain"
        blurb="The vertical detection-chain timeline — a per-event severity dot + connector + mono timestamp, ramping healthy → warning → critical across the host-03 incident."
      >
        <div className="max-w-2xl rounded-df-card border border-df-border bg-df-surface p-5">
          <WhyChain events={WHY_CHAIN_FIXTURE} />
        </div>
      </Section>

      {/* ════════ NavRailShell ════════ */}
      <Section
        name="NavRailShell"
        blurb="The shell instrumentation is LIVE around this whole gallery — the navy rail, the fleet ramp + tally (4 crit · 1 warn · 2 watch · 19 ok), the Mid-incident/All-clear view toggle, and the 'Live · polled 4s ago' pill all render in the top bar above. The pulse below is a standalone preview of the same ramp/tally parts."
      >
        <div className="rounded-df-card border border-df-border bg-df-surface p-5">
          <p className="text-[13px] text-df-muted">
            Scroll up: the top bar carries the real <code className="font-df-mono">NavRailShell</code>{" "}
            instrumentation — fleet ramp, severity tally, view-tab toggle, and live-poll pill, all
            driven by the same static fixtures (no polling, no data access).
          </p>
        </div>
      </Section>

      {/* ════════ AiReadPanel ════════ */}
      <Section
        name="AiReadPanel"
        blurb="The navy 'What needs you now' band with the verbatim zero-credential safety copy. Ranked variant shows numbered priority squares; the last line proves advisory text is INERT (shell metacharacters render literally). The all-clear variant shows the green-check calm state."
      >
        <Grid cols={2}>
          <Cell caption="ranked · numbered priority squares (inert advisory text)">
            <AiReadPanel lines={AI_READ_LINES} />
          </Cell>
          <Cell caption="all-clear · the green-check calm state">
            <AiReadPanel lines={[]} allClear calmDetail={AI_READ_CALM_DETAIL} />
          </Cell>
        </Grid>
      </Section>

      {/* ════════ CommandModal ════════ */}
      <Section
        name="CommandModal"
        blurb="The runbook/command export across all three risk tiers — runbook (host operation), command (exported fix), and investigate (read-only). The command renders as INERT copyable text inside a <code> block; nothing executes (the dashboard holds no node credentials)."
      >
        <div className="flex flex-wrap items-center gap-4 rounded-df-card border border-df-border bg-df-surface p-5">
          {COMMAND_MODAL_FIXTURES.map((fx) => (
            <div key={fx.title} className="flex flex-col gap-1.5">
              <span className="font-df-mono text-[10px] font-bold tracking-[0.06em] text-df-muted uppercase">
                {fx.kind}
              </span>
              <CommandModal
                title={fx.title}
                intent={fx.intent}
                sev={fx.sev}
                kind={fx.kind}
                command={fx.command}
                runbook={fx.runbook}
                trigger={
                  <button
                    type="button"
                    className="rounded-df-btn bg-df-chrome px-4 py-2 font-df-mono text-[13px] font-semibold text-white"
                  >
                    {fx.triggerLabel}
                  </button>
                }
              />
            </div>
          ))}
        </div>
        <p className="mt-3 font-df-mono text-xs text-df-muted">
          Each opens an inert runbook + command export — copy only, never executed.
        </p>
      </Section>

      {/* ════════ TwoAxisPip ════════ */}
      <Section
        name="TwoAxisPip"
        blurb="Running × functioning service tiles — GREEN only when BOTH axes pass. The up-but-dead state (running but NOT functioning) is unmistakably distinct: red chrome + pulsing alarm dot + red Functioning box + a red 'failed' last-run row."
      >
        <Grid>
          {TWO_AXIS_PIP_FIXTURES.map((fx) => (
            <Cell key={fx.name} caption={fx.caption}>
              <TwoAxisPip
                name={fx.name}
                running={fx.running}
                functioning={fx.functioning}
                heartbeat={fx.heartbeat}
                lastRun={fx.lastRun}
                errorCount={fx.errorCount}
              />
            </Cell>
          ))}
        </Grid>
      </Section>

      {/* ════════ SeverityRow ════════ */}
      <Section
        name="SeverityRow"
        blurb="The grouped-child record row — a 2px SQUARE severity accent dot then a columnar id · kind · note · detail record. Shown across the ramp (critical → stale)."
      >
        <div className="flex flex-col gap-2.5 rounded-df-card border border-df-border bg-df-surface p-4">
          {SEVERITY_ROW_FIXTURES.map((fx) => (
            <SeverityRow
              key={fx.id}
              sev={fx.sev}
              id={fx.id}
              kind={fx.kind}
              note={fx.note}
              detail={fx.detail}
            />
          ))}
        </div>
      </Section>

      {/* ════════ ThresholdMeter ════════ */}
      <Section
        name="ThresholdMeter"
        blurb="The D-03 severity fill meter (Phase 14) — 6px hairline track + a fill colored ONLY by the caller-supplied severity (computed from read-time bands; never derived from pct). Shown across the ramp, the honest-stale gold hatched track (no fill off old data), and the 0%/100% edges — every cell carries the adjacent mono value, never color alone."
      >
        <Grid>
          {THRESHOLD_METER_FIXTURES.map((fx) => (
            <Cell key={fx.caption} caption={fx.caption}>
              <div className="flex items-center gap-3 rounded-df-card border border-df-border bg-df-surface p-4">
                <ThresholdMeter
                  pct={fx.pct}
                  sev={fx.sev}
                  stale={fx.stale}
                  label={fx.label}
                  className="flex-1"
                />
                {/* adjacent mono value — the meter is never color alone (D-03 a11y) */}
                <span className="font-df-mono text-[13px] font-semibold tabular-nums text-df-ink">
                  {fx.value}
                </span>
              </div>
            </Cell>
          ))}
        </Grid>
      </Section>

      {/* ════════ FreshnessChip ════════ */}
      <Section
        name="FreshnessChip"
        blurb="Honest freshness — fresh round green dot + relative age, shape-distinct stale (square dot + dashed gold border), and honest no-data. Ages are relative to a fixed reference 'now' so they render deterministically."
      >
        <Grid>
          {FRESHNESS_CHIP_FIXTURES.map((fx) => (
            <Cell key={fx.caption} caption={fx.caption}>
              <div className="rounded-df-card border border-df-border bg-df-surface p-4">
                <FreshnessChip
                  asOf={fx.asOfIso === null ? null : new Date(fx.asOfIso)}
                  stale={fx.stale}
                  now={FRESHNESS_NOW}
                />
              </div>
            </Cell>
          ))}
        </Grid>
      </Section>

      {/* ════════ ImplTag ════════ */}
      <Section
        name="ImplTag"
        blurb="The implementation micro-tag in its own df impl-tag tokens (df-lnd / df-ldk) — the two-part 'Routing · LND' / 'LSP · LDK' role+impl label, never the structural navy."
      >
        <div className="flex flex-wrap items-center gap-6 rounded-df-card border border-df-border bg-df-surface p-5">
          {IMPL_TAG_FIXTURES.map((fx) => (
            <div key={fx.impl} className="flex items-center gap-2.5">
              <ImplTag impl={fx.impl} />
              <span className="text-[13px] text-df-muted">{fx.caption}</span>
            </div>
          ))}
        </div>
      </Section>
    </NavRailShell>
  );
}
