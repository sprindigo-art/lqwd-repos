import { describe, expect, it } from "vitest";
import { buildBandLines, buildCalmState } from "@/lib/overview/ai-band";
import type { GroupedIncident } from "@/lib/overview/incidents";
import type { Severity } from "@/components/df/Severity";

// =====================================================
// ai-band.test.ts — the deterministic "what needs you now" line builder
// =====================================================
// Mirrors rank.test.ts's fixture-factory shape. The band only reads
// severity / why / entityLabel off each GroupedIncident; the rest of the
// shape is carried untouched. The load-bearing assertion is the
// advisory-only `Object.keys(line)` guarantee (T-12-01 / D-04): an
// AiReadLine has NO action/param/command field by construction.

interface IncidentOverrides {
  key?: string;
  severity?: Severity;
  why?: string;
  entityLabel?: string;
  stale?: boolean;
}

/** Minimal valid GroupedIncident — the band reads severity/why/entityLabel only. */
function makeIncident(overrides: IncidentOverrides = {}): GroupedIncident {
  return {
    key: overrides.key ?? "host-1",
    layer: "hosts",
    severity: overrides.severity ?? "warning",
    stale: overrides.stale ?? false,
    why: overrides.why ?? "1 alert on host-1",
    entityLabel: overrides.entityLabel ?? "host-1",
    asOf: null,
    children: [],
  };
}

/** The ONLY keys an inert advisory line may carry (advisory-only by construction). */
const ALLOWED_KEYS = new Set(["sev", "head", "body", "text"]);

describe("buildBandLines (OVW-02 / D-04)", () => {
  it("returns at most 4 lines even when given more incidents", () => {
    const incidents = Array.from({ length: 7 }, (_, i) =>
      makeIncident({ key: `h-${i}`, entityLabel: `host-${i}` }),
    );
    expect(buildBandLines(incidents)).toHaveLength(4);
  });

  it("preserves ranked input order — never re-sorts by severity", () => {
    // Deliberately NOT severity-sorted: a re-sort would float `critical` to the top.
    const incidents = [
      makeIncident({ key: "a", severity: "watch", entityLabel: "alpha" }),
      makeIncident({ key: "b", severity: "critical", entityLabel: "bravo" }),
      makeIncident({ key: "c", severity: "warning", entityLabel: "charlie" }),
    ];
    const lines = buildBandLines(incidents);
    expect(lines.map((l) => l.sev)).toEqual(["watch", "critical", "warning"]);
    expect(lines.map((l) => l.head)).toEqual([
      expect.stringContaining("alpha"),
      expect.stringContaining("bravo"),
      expect.stringContaining("charlie"),
    ]);
  });

  it("sets each line's sev to its incident's severity (per-line severity, D-04)", () => {
    const sevs: Severity[] = ["critical", "warning", "watch", "stale"];
    const incidents = sevs.map((severity, i) => makeIncident({ key: `k-${i}`, severity }));
    expect(buildBandLines(incidents).map((l) => l.sev)).toEqual(sevs);
  });

  it("carries the incident `why` as the line body", () => {
    const lines = buildBandLines([makeIncident({ why: "bitcoind stalled", entityLabel: "host-3" })]);
    expect(lines[0].body).toBe("bitcoind stalled");
  });

  it("emits NO action/param/command field — advisory-only by construction (T-12-01)", () => {
    const lines = buildBandLines([
      makeIncident({ severity: "critical" }),
      makeIncident({ severity: "warning" }),
    ]);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const key of Object.keys(line)) {
        expect(ALLOWED_KEYS.has(key)).toBe(true);
      }
      expect(line).not.toHaveProperty("action");
      expect(line).not.toHaveProperty("param");
      expect(line).not.toHaveProperty("params");
      expect(line).not.toHaveProperty("command");
      expect(line).not.toHaveProperty("suggestedAction");
    }
  });

  it("returns [] for an empty queue (the page shows the calm state instead)", () => {
    expect(buildBandLines([])).toEqual([]);
  });

  it("is deterministic — same input yields deep-equal output across two calls", () => {
    const incidents = [
      makeIncident({ severity: "critical", entityLabel: "n1" }),
      makeIncident({ severity: "watch", entityLabel: "n2" }),
    ];
    expect(buildBandLines(incidents)).toEqual(buildBandLines(incidents));
  });

  it("does not mutate its input", () => {
    const incidents = [makeIncident({ severity: "critical" })];
    const frozen = structuredClone(incidents);
    buildBandLines(incidents);
    expect(incidents).toEqual(frozen);
  });
});

// =====================================================
// AIX-02 — the incident-detail rationale reuse pins the command-free structure
// =====================================================
// The SAME `buildBandLines` line rendered on the overview band is reused, verbatim,
// as the AIX-02 "why this incident is grouped" rationale on incident detail — the
// AI narrates the DETERMINISTIC grouping, it never re-derives the correlation
// (D-14). Because that reused line can carry NO action/param/command key, the AI
// surface on incident detail is structurally command-free too. This block pins the
// `Object.keys` guarantee for that reuse (mirrors guardrails.test.ts advisory-keys
// grammar) and pins per-line `sev` = the incident's own severity (no re-grading).
describe("AIX-02 rationale reuse stays command-free (D-14)", () => {
  it("buildBandLines([incident]) yields ONE rationale line whose keys are a subset of {sev,head,body} — no action/param/command", () => {
    const incident = makeIncident({ severity: "critical", entityLabel: "node-x", why: "grouped under host outage" });

    const lines = buildBandLines([incident]);

    expect(lines).toHaveLength(1);
    for (const key of Object.keys(lines[0])) {
      // Structural command-free guarantee: an AiReadLine may only ever be inert copy.
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
    expect(lines[0]).not.toHaveProperty("action");
    expect(lines[0]).not.toHaveProperty("param");
    expect(lines[0]).not.toHaveProperty("params");
    expect(lines[0]).not.toHaveProperty("command");
    expect(lines[0]).not.toHaveProperty("suggestedAction");
  });

  it("the rationale line's sev equals the incident's own severity — no re-grading", () => {
    const sevs: Severity[] = ["critical", "warning", "watch", "stale", "healthy"];
    for (const severity of sevs) {
      const lines = buildBandLines([makeIncident({ severity })]);
      expect(lines[0].sev).toBe(severity);
    }
  });
});

describe("buildCalmState (OVW-04 / D-08)", () => {
  it("returns { allClear: true, calmDetail } with non-empty templated copy", () => {
    const calm = buildCalmState({ nodeCount: 26, lastIncidentAgo: "3h" });
    expect(calm.allClear).toBe(true);
    expect(typeof calm.calmDetail).toBe("string");
    expect(calm.calmDetail.length).toBeGreaterThan(0);
    expect(calm.calmDetail).toContain("26");
    expect(calm.calmDetail).toContain("3h");
  });

  it("omits the last-incident clause when none is supplied", () => {
    const calm = buildCalmState({ nodeCount: 8, lastIncidentAgo: null });
    expect(calm.allClear).toBe(true);
    expect(calm.calmDetail).toContain("8");
    expect(calm.calmDetail).not.toContain("last incident");
  });
});
