import { describe, expect, it } from "vitest";

import {
  applyHostFilters,
  parseHostFacets,
  sortHostsWorstFirst,
  type HostFacets,
  type HostFilterRow,
} from "@/lib/overview/host-filter";

// =====================================================
// host-filter.test.ts — Hosts-list facet codec + pure view filter + the ONE
// sanctioned worst-first sort (HOST-01, D-08)
// =====================================================
// Clone of the node-filter.ts contract with the hosts vocabulary:
//   • sev   — All | Critical | Warning | Watch | Healthy  (the direct df ramp,
//             MINUS stale — stale is NOT a sev chip)
//   • stale — a single honest-state "stale only" boolean toggle
// V5: operator-editable ?sev/?stale params are whitelisted against a CLOSED
// vocabulary; an invalid value SILENTLY WIDENS the view (never throws).
// applyHostFilters is a PURE AND-semantics view — no sorting, no mutation.
// sortHostsWorstFirst is the ONLY sort Phase 14 introduces (D-08): severity rank
// desc, stale group AFTER at-risk but BEFORE healthy (RESEARCH Open Q3 pin),
// healthy last, ties by hostId ascending, input never mutated.

/**
 * Minimal loaded-row fixture. The filter reads severity/stale/hostId; the fixture
 * is a structural superset so generic preservation (`<T extends HostFilterRow>`)
 * keeps `.name` accessible on the output.
 */
type TestRow = HostFilterRow & { name: string };
function row(
  hostId: string,
  severity: HostFilterRow["severity"],
  stale = false,
): TestRow {
  return { hostId, severity, stale, name: `host ${hostId}` };
}

describe("parseHostFacets", () => {
  it("parses a valid ?sev=critical&stale=1 into the typed facet object", () => {
    const facets = parseHostFacets(new URLSearchParams("sev=critical&stale=1"));
    expect(facets).toEqual({ sev: "critical", stale: true });
  });

  it("accepts every ramp chip in the closed sev vocabulary", () => {
    for (const sev of ["all", "critical", "warning", "watch", "healthy"] as const) {
      expect(parseHostFacets(new URLSearchParams(`sev=${sev}`)).sev).toBe(sev);
    }
  });

  it("accepts ?stale=true as well as ?stale=1", () => {
    expect(parseHostFacets(new URLSearchParams("stale=true")).stale).toBe(true);
    expect(parseHostFacets(new URLSearchParams("stale=1")).stale).toBe(true);
  });

  it("silently WIDENS invalid values and never throws (V5)", () => {
    expect(() => parseHostFacets(new URLSearchParams("sev=bogus"))).not.toThrow();
    expect(parseHostFacets(new URLSearchParams("sev=bogus&stale=maybe"))).toEqual({
      sev: "all",
      stale: false,
    });
    // `stale` is NOT a sev chip — it must widen like any other invalid token.
    expect(parseHostFacets(new URLSearchParams("sev=stale")).sev).toBe("all");
  });

  it("returns the widest facets for an empty query", () => {
    expect(parseHostFacets(new URLSearchParams(""))).toEqual({ sev: "all", stale: false });
  });
});

describe("applyHostFilters", () => {
  const hosts: TestRow[] = [
    row("alpha", "critical"),
    row("bravo", "warning"),
    row("charlie", "watch"),
    row("delta", "healthy"),
    // No-telemetry host: rollup healthy-after-stale-filter, honest stale flag on.
    row("echo", "healthy", true),
    row("foxtrot", "warning", true),
  ];

  it("returns the full set unchanged for all/false (same length, same order)", () => {
    const out = applyHostFilters(hosts, { sev: "all", stale: false });
    expect(out.map((h) => h.hostId)).toEqual(hosts.map((h) => h.hostId));
  });

  it("narrows sev=warning to warning rollups only", () => {
    const out = applyHostFilters(hosts, { sev: "warning", stale: false });
    expect(out.map((h) => h.hostId)).toEqual(["bravo", "foxtrot"]);
  });

  it("stale-only keeps only stale/no-telemetry hosts (the no-telemetry fixture surfaces)", () => {
    const out = applyHostFilters(hosts, { sev: "all", stale: true });
    expect(out.map((h) => h.hostId)).toEqual(["echo", "foxtrot"]);
  });

  it("combines sev AND stale (intersecting facets)", () => {
    const out = applyHostFilters(hosts, { sev: "healthy", stale: true });
    expect(out.map((h) => h.hostId)).toEqual(["echo"]);
  });

  it("yields [] on zero matches (honest empty) and never mutates or reorders the input", () => {
    const before = hosts.map((h) => h.hostId);
    const out = applyHostFilters(hosts, { sev: "critical", stale: true });
    expect(out).toEqual([]);
    expect(hosts.map((h) => h.hostId)).toEqual(before);
  });
});

describe("sortHostsWorstFirst (D-08 — the ONLY Phase 14 sort)", () => {
  it("pins the full order: [critical, warning, watch, stale-group, healthy] with hostId tiebreak", () => {
    const input: TestRow[] = [
      row("zulu", "healthy"),
      row("mike", "healthy", true), // no-telemetry → stale group
      row("kilo", "watch"),
      row("bravo", "warning"),
      row("yankee", "healthy"),
      row("november", "healthy", true), // stale group, ties with mike by hostId
      row("delta", "critical"),
      row("alpha", "critical"), // ties with delta by hostId
    ];
    const out = sortHostsWorstFirst(input);
    expect(out.map((h) => h.hostId)).toEqual([
      "alpha", // critical (hostId tiebreak asc)
      "delta", // critical
      "bravo", // warning
      "kilo", // watch
      "mike", // stale group — AFTER at-risk (Open Q3 pin)
      "november", // stale group, hostId tiebreak
      "yankee", // healthy LAST (hostId tiebreak asc)
      "zulu", // healthy
    ]);
  });

  it("keeps an at-risk host in its severity band even when its data is stale (stale never buries critical)", () => {
    const out = sortHostsWorstFirst([
      row("stale-healthy", "healthy", true),
      row("stale-critical", "critical", true),
      row("fresh-warning", "warning"),
    ]);
    expect(out.map((h) => h.hostId)).toEqual([
      "stale-critical",
      "fresh-warning",
      "stale-healthy",
    ]);
  });

  it("returns a NEW array and never mutates the input order", () => {
    const input = [row("bee", "healthy"), row("aye", "critical")];
    const before = input.map((h) => h.hostId);
    const out = sortHostsWorstFirst(input);
    expect(out).not.toBe(input);
    expect(input.map((h) => h.hostId)).toEqual(before);
    expect(out.map((h) => h.hostId)).toEqual(["aye", "bee"]);
  });
});

// Type-level guard: HostFacets carries the closed vocab, never free strings.
const _typeGuard: HostFacets = { sev: "watch", stale: true };
void _typeGuard;
