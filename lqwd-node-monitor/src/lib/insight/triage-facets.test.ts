import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTION_FACET_VALUES,
  parseFacets,
  serializeFacets,
  type FacetState,
} from "@/lib/insight/triage-facets";

const moduleSource = readFileSync(
  fileURLToPath(new URL("./triage-facets.ts", import.meta.url)),
  "utf8",
);

const PUBKEY_A = "a".repeat(66);
const PUBKEY_B = "b".repeat(66);

function params(init: Record<string, string | string[]>): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(init)) {
    if (Array.isArray(v)) for (const x of v) sp.append(k, x);
    else sp.append(k, v);
  }
  return sp;
}

describe("parseFacets", () => {
  it("reads ?sev/?node/?signal/?action and whitelists each value", () => {
    const state = parseFacets(
      params({
        sev: ["critical", "info"],
        node: PUBKEY_A,
        signal: "fee_raise",
        action: "update_fee",
      }),
    );
    expect(state.sev).toEqual(["critical", "info"]);
    expect(state.node).toEqual([PUBKEY_A]);
    expect(state.signal).toEqual(["fee_raise"]);
    expect(state.action).toEqual(["update_fee"]);
  });

  it("accepts CSV form for repeatable keys", () => {
    const state = parseFacets(params({ sev: "critical,warn", node: `${PUBKEY_A},${PUBKEY_B}` }));
    expect(state.sev).toEqual(["critical", "warn"]);
    expect(state.node).toEqual([PUBKEY_A, PUBKEY_B]);
  });

  it("drops invalid values silently — never throws", () => {
    expect(() =>
      parseFacets(
        params({
          sev: ["critical", "EMERGENCY", "info"],
          node: ["zzz", PUBKEY_A, "A".repeat(66) /* uppercase → invalid */],
          signal: ["fee_raise", "not_a_signal"],
          action: ["update_fee", "self_destruct"],
        }),
      ),
    ).not.toThrow();

    const state = parseFacets(
      params({
        sev: ["critical", "EMERGENCY", "info"],
        node: ["zzz", PUBKEY_A, "A".repeat(66)],
        signal: ["fee_raise", "not_a_signal"],
        action: ["update_fee", "self_destruct"],
      }),
    );
    expect(state.sev).toEqual(["critical", "info"]);
    expect(state.node).toEqual([PUBKEY_A]);
    expect(state.signal).toEqual(["fee_raise"]);
    expect(state.action).toEqual(["update_fee"]);
  });

  it("rejects an injection attempt in ?node (66-hex lowercase only)", () => {
    const state = parseFacets(params({ node: "'; DROP TABLE commands;--" }));
    expect(state.node).toEqual([]);
  });

  it("returns empty arrays for absent keys", () => {
    const state = parseFacets(params({}));
    expect(state).toEqual({ sev: [], node: [], signal: [], action: [] });
  });

  it("dedupes repeated valid values", () => {
    const state = parseFacets(params({ sev: ["critical", "critical"] }));
    expect(state.sev).toEqual(["critical"]);
  });

  it("never reads the ?card key — it stays orthogonal (D-09/D-10)", () => {
    const state = parseFacets(params({ card: "card-1", sev: "critical" }));
    expect(state).not.toHaveProperty("card");
    expect(JSON.stringify(state)).not.toContain("card-1");
    expect(state.sev).toEqual(["critical"]);
  });
});

describe("serializeFacets", () => {
  it("round-trips deterministically: serialize(parse(x)) is stable", () => {
    const sp = params({
      sev: ["info", "critical"],
      node: PUBKEY_B,
      signal: "fee_lower",
      action: "investigate",
    });
    const once = serializeFacets(parseFacets(sp));
    const twice = serializeFacets(parseFacets(new URLSearchParams(once)));
    expect(twice).toBe(once);
  });

  it("never emits the ?card key", () => {
    const state: FacetState = {
      sev: ["critical"],
      node: [],
      signal: [],
      action: [],
    };
    const out = serializeFacets(state);
    expect(out).not.toContain("card");
  });

  it("emits nothing for an empty facet state", () => {
    const out = serializeFacets({ sev: [], node: [], signal: [], action: [] });
    expect(out).toBe("");
  });

  it("a round-trip preserves combined facets", () => {
    const state: FacetState = {
      sev: ["critical", "warn"],
      node: [PUBKEY_A],
      signal: ["fee_raise"],
      action: ["update_fee"],
    };
    const reparsed = parseFacets(new URLSearchParams(serializeFacets(state)));
    expect(reparsed).toEqual(state);
  });
});

describe("ACTION_FACET_VALUES", () => {
  it("covers the 5 action types plus 'none'", () => {
    expect([...ACTION_FACET_VALUES].sort()).toEqual(
      [
        "close_channel",
        "investigate",
        "none",
        "rebalance",
        "remediate_pending",
        "update_fee",
      ].sort(),
    );
  });
});

describe("triage-facets.ts purity", () => {
  it("imports no server-only / DB runtime", () => {
    expect(moduleSource).not.toContain("server" + "-only");
    expect(moduleSource).not.toMatch(/from "@\/lib\/(db|queue)\//);
  });

  it("uses the 66-hex PUBKEY_RE whitelist discipline", () => {
    expect(moduleSource).toMatch(/0-9a-f\]\{66\}/);
  });
});
