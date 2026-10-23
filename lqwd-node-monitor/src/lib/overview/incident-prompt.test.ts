import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildIncidentPrompt,
  INCIDENT_READ_SYSTEM_PROMPT,
  INCIDENT_CHILD_CAP,
} from "@/lib/overview/incident-prompt";
import type { GroupedIncident } from "@/lib/overview/incidents";
import type { Severity } from "@/components/df/Severity";

// AIX-01 prompt-builder tests (pure, no network, no env) — mirrors buildNarrationPrompt
// (narrative.ts:44-75). ALL payload text is wrapped in BEGIN/END_UNTRUSTED_INCIDENT_DATA
// so attacker-influenceable log lines / aliases are declared DATA, not instructions
// (T-17-01). The identity line references incident.key (NOT .hostId — the field does not
// exist). Overflowing child sets pre-truncate deterministically to the top-N by severity.

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

function incident(children: GroupedIncident[]): GroupedIncident {
  return {
    key: "host-03",
    layer: "hosts",
    severity: "critical",
    stale: false,
    why: `${children.length} alerts on host-03`,
    entityLabel: "host-03",
    asOf: null,
    children,
  };
}

const OPEN = "<<<BEGIN_UNTRUSTED_INCIDENT_DATA>>>";
const CLOSE = "<<<END_UNTRUSTED_INCIDENT_DATA>>>";

/** Pull the JSON payload out from between the untrusted-data delimiters. */
function extractPayload(prompt: string): GroupedIncident {
  const start = prompt.indexOf(OPEN) + OPEN.length;
  const end = prompt.indexOf(CLOSE);
  return JSON.parse(prompt.slice(start, end).trim());
}

describe("buildIncidentPrompt (AIX-01)", () => {
  it("wraps the serialized payload in BEGIN/END_UNTRUSTED_INCIDENT_DATA delimiters", () => {
    const prompt = buildIncidentPrompt(incident([child()]));
    expect(prompt).toContain("BEGIN_UNTRUSTED_INCIDENT_DATA");
    expect(prompt).toContain("END_UNTRUSTED_INCIDENT_DATA");
    expect(prompt.indexOf(OPEN)).toBeLessThan(prompt.indexOf(CLOSE));
  });

  it("serializes the incident faithfully between the delimiters (small case)", () => {
    const inc = incident([child({ key: "a", why: "chain tip stalled" })]);
    expect(extractPayload(buildIncidentPrompt(inc))).toEqual(JSON.parse(JSON.stringify(inc)));
  });

  it("references incident.key in the identity line", () => {
    const prompt = buildIncidentPrompt(incident([child()]));
    expect(prompt).toContain("host-03");
  });

  it("does not mutate the input incident", () => {
    const inc = incident([child({ key: "a" }), child({ key: "b" })]);
    const frozen = structuredClone(inc);
    buildIncidentPrompt(inc);
    expect(inc).toEqual(frozen);
  });
});

describe("deterministic top-N-by-severity pre-truncation (AI-SPEC §4b)", () => {
  it("keeps all children when at or below the cap", () => {
    const kids = Array.from({ length: 5 }, (_, i) => child({ key: `k${i}` }));
    const payload = extractPayload(buildIncidentPrompt(incident(kids)));
    expect(payload.children).toHaveLength(5);
  });

  it("caps an overflowing child set to INCIDENT_CHILD_CAP", () => {
    const kids = Array.from({ length: INCIDENT_CHILD_CAP + 20 }, (_, i) =>
      child({ key: `k${i}`, severity: "watch" }),
    );
    const payload = extractPayload(buildIncidentPrompt(incident(kids)));
    expect(payload.children.length).toBeLessThanOrEqual(INCIDENT_CHILD_CAP);
    expect(payload.children).toHaveLength(INCIDENT_CHILD_CAP);
  });

  it("retains the worst-severity children when truncating", () => {
    const sevs: Severity[] = ["watch", "healthy", "stale"];
    const filler = Array.from({ length: INCIDENT_CHILD_CAP + 5 }, (_, i) =>
      child({ key: `filler${i}`, severity: sevs[i % sevs.length] }),
    );
    const critical = child({ key: "the-critical", severity: "critical", why: "root cause" });
    // Critical placed LAST — it must survive truncation on severity, not position.
    const payload = extractPayload(buildIncidentPrompt(incident([...filler, critical])));
    expect(payload.children.some((c) => c.key === "the-critical")).toBe(true);
  });
});

describe("INCIDENT_READ_SYSTEM_PROMPT contract (AIX-01)", () => {
  const p = INCIDENT_READ_SYSTEM_PROMPT.toLowerCase();

  it("leads with exactly one urgency verdict vocabulary", () => {
    expect(INCIDENT_READ_SYSTEM_PROMPT).toContain("Act now");
    expect(INCIDENT_READ_SYSTEM_PROMPT).toContain("Monitor");
    expect(INCIDENT_READ_SYSTEM_PROMPT).toContain("Informational");
  });

  it("declares delimited content untrusted data, not instructions", () => {
    expect(p).toContain("untrusted");
    expect(p).toContain("not instructions");
  });

  it("forbids runnable commands", () => {
    expect(p).toMatch(/never.*(command|lncli)/);
  });

  it("forbids inventing numbers / nodes / correlations", () => {
    expect(p).toContain("do not invent");
  });

  it("requires plain prose, no code blocks / markdown", () => {
    expect(p).toMatch(/plain prose|no code blocks|no markdown/);
  });
});

describe("source discipline", () => {
  it("incident-prompt.ts references .key, never .hostId", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/overview/incident-prompt.ts"), "utf8");
    expect(source.match(/\.hostId/g) ?? []).toHaveLength(0);
  });
});
