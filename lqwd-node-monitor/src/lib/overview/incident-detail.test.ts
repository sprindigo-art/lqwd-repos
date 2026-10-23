import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildWhyChain,
  buildBlastTargets,
  selectDriver,
  buildBlastRoot,
} from "@/lib/overview/incident-detail";
import type { GroupedIncident } from "@/lib/overview/incidents";
import type { Severity } from "@/components/df/Severity";

// INC-01 pure-builder tests (no DB, no server-only) — the why-chain / blast-radius
// derivation off a GroupedIncident. Engine order is LAW (incidents.ts:18-22): the
// children array is consumed in order and NEVER re-sorted. Fee-summary children
// (feeKind set) are excluded from the blast tree (D-08). null asOf renders "—".

/** Minimal child factory — everything overridable, sane defaults. */
function child(over: Partial<GroupedIncident> = {}): GroupedIncident {
  return {
    key: over.key ?? "child",
    layer: over.layer ?? "nodes",
    severity: over.severity ?? "warning",
    stale: over.stale ?? false,
    why: over.why ?? "reason",
    entityLabel: over.entityLabel ?? "entity",
    asOf: over.asOf ?? null,
    children: over.children ?? [],
    ...over,
  };
}

/** Host-keyed incident wrapping the given children. */
function incident(children: GroupedIncident[], sev: Severity = "critical"): GroupedIncident {
  return {
    key: "host-03",
    layer: "hosts",
    severity: sev,
    stale: false,
    why: `${children.length} alerts on host-03`,
    entityLabel: "host-03",
    asOf: null,
    children,
  };
}

const AT_1408 = new Date("2026-07-20T14:08:00Z");
const AT_1523 = new Date("2026-07-20T15:23:00Z");

describe("buildWhyChain (INC-01)", () => {
  it("preserves engine (child) order — never re-sorts", () => {
    const inc = incident([
      child({ key: "a", entityLabel: "bitcoind", why: "chain tip stalled", severity: "critical" }),
      child({ key: "b", entityLabel: "lnd", why: "process crash-loop", severity: "warning" }),
      child({ key: "c", entityLabel: "chan-1", why: "inactive", severity: "watch" }),
    ]);
    const chain = buildWhyChain(inc);
    expect(chain.map((e) => e.text)).toEqual([
      "bitcoind — chain tip stalled",
      "lnd — process crash-loop",
      "chan-1 — inactive",
    ]);
    expect(chain.map((e) => e.severity)).toEqual(["critical", "warning", "watch"]);
  });

  it("formats asOf as HH:MM and yields null for a null asOf (no '—' wall — A6)", () => {
    const inc = incident([
      child({ key: "a", asOf: AT_1408 }),
      child({ key: "b", asOf: null }),
      child({ key: "c", asOf: AT_1523 }),
    ]);
    const chain = buildWhyChain(inc);
    expect(chain.map((e) => e.time)).toEqual(["14:08", null, "15:23"]);
  });

  it("does not mutate the input incident or its children", () => {
    const children = [child({ key: "a", asOf: AT_1408 })];
    const inc = incident(children);
    const frozen = structuredClone(inc);
    buildWhyChain(inc);
    expect(inc).toEqual(frozen);
  });

  it("returns [] for a childless incident", () => {
    expect(buildWhyChain(incident([]))).toEqual([]);
  });
});

describe("buildBlastTargets (INC-01)", () => {
  it("excludes fee-summary children (feeKind set) from the blast tree", () => {
    const inc = incident([
      child({ key: "n1", entityLabel: "lqwd-rtr-04", why: "2 HTLCs at risk" }),
      child({
        key: "fee",
        entityLabel: "lqwd-rtr-04",
        why: "3 channels need a fee raise",
        feeKind: "raise",
      }),
    ]);
    const targets = buildBlastTargets(inc);
    expect(targets).toEqual([
      { name: "lqwd-rtr-04", note: "2 HTLCs at risk", sev: "warning", layer: "nodes" },
    ]);
    expect(targets.find((t) => t.note.includes("fee raise"))).toBeUndefined();
  });

  it("carries each target's own severity + layer (A3 / C2)", () => {
    const inc = incident([
      child({ entityLabel: "vm-1", why: "down", severity: "critical", layer: "hosts" }),
      child({ entityLabel: "svc-1", why: "stale", severity: "watch", layer: "services" }),
    ]);
    expect(buildBlastTargets(inc)).toEqual([
      { name: "vm-1", note: "down", sev: "critical", layer: "hosts" },
      { name: "svc-1", note: "stale", sev: "watch", layer: "services" },
    ]);
  });

  it("yields a single centered target (1-target case)", () => {
    const inc = incident([child({ entityLabel: "solo", why: "channel state stale" })]);
    expect(buildBlastTargets(inc)).toEqual([
      { name: "solo", note: "channel state stale", sev: "warning", layer: "nodes" },
    ]);
  });

  it("yields N targets in engine order (N-target case)", () => {
    const inc = incident([
      child({ key: "a", entityLabel: "n-a", why: "r1" }),
      child({ key: "b", entityLabel: "n-b", why: "r2" }),
      child({ key: "c", entityLabel: "n-c", why: "r3" }),
    ]);
    expect(buildBlastTargets(inc)).toEqual([
      { name: "n-a", note: "r1", sev: "warning", layer: "nodes" },
      { name: "n-b", note: "r2", sev: "warning", layer: "nodes" },
      { name: "n-c", note: "r3", sev: "warning", layer: "nodes" },
    ]);
  });
});

describe("selectDriver + buildBlastRoot (INC-01)", () => {
  it("selects the first child whose severity matches the incident's", () => {
    const inc = incident(
      [
        child({ key: "warn", severity: "warning", why: "downstream symptom" }),
        child({ key: "crit", severity: "critical", why: "root cause" }),
      ],
      "critical",
    );
    expect(selectDriver(inc)?.key).toBe("crit");
    expect(buildBlastRoot(inc)).toEqual({ host: "host-03", hostStatus: "root cause" });
  });

  it("falls back to the first child when no severity matches", () => {
    const inc = incident(
      [child({ key: "first", severity: "watch", why: "only child" })],
      "critical",
    );
    expect(selectDriver(inc)?.key).toBe("first");
    expect(buildBlastRoot(inc).hostStatus).toBe("only child");
  });

  it("degrades to the incident's own why for a childless incident", () => {
    const inc = incident([]);
    expect(selectDriver(inc)).toBeUndefined();
    expect(buildBlastRoot(inc)).toEqual({ host: "host-03", hostStatus: "0 alerts on host-03" });
  });
});

describe("source discipline (engine order is law)", () => {
  it("incident-detail.ts contains no .sort — engine order is preserved by construction", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/overview/incident-detail.ts"), "utf8");
    expect(source.match(/\.sort\(/g) ?? []).toHaveLength(0);
  });
});
