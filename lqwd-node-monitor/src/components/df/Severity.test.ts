import { describe, expect, it } from "vitest";

import {
  severityAccent,
  severityIcon,
  severityLabel,
  severityVariants,
  type Severity,
} from "@/components/df/Severity";

// =====================================================
// Severity.test.ts — the single-source ramp contract (10-02 Task 1)
// =====================================================
// Asserts severityVariants is the one place sev→class mapping lives: every state
// emits its df-token accent/tint/border classes, and the ramp NEVER emits a
// chrome/brand class (df-chrome / df-brand) as an accent or tint — severity color
// is set-disjoint from navy structure (DS-01).

const ALL: Severity[] = ["critical", "warning", "watch", "healthy", "stale"];

/** The df token stem each severity is expected to paint with. */
const EXPECTED_STEM: Record<Severity, string> = {
  critical: "df-critical",
  warning: "df-warning",
  watch: "df-watch",
  healthy: "df-ok",
  stale: "df-stale",
};

describe("severityVariants", () => {
  it("emits df-token classes for each of the five ramp states", () => {
    for (const sev of ALL) {
      const classes = severityVariants({ sev });
      expect(classes).toContain(EXPECTED_STEM[sev]);
      // tint bg + border + text role are all present for the tinted states
      expect(classes).toMatch(/bg-df-/);
      expect(classes).toMatch(/border-df-|border-df-ok|border-/);
    }
  });

  it("never emits a chrome/brand class as a severity accent/tint", () => {
    for (const sev of ALL) {
      const classes = severityVariants({ sev });
      expect(classes).not.toMatch(/df-chrome/);
      expect(classes).not.toMatch(/df-brand/);
    }
  });

  it("maps each severity to a distinct accent hue (state-only, no navy)", () => {
    for (const sev of ALL) {
      expect(severityAccent[sev]).toContain(EXPECTED_STEM[sev]);
      expect(severityAccent[sev]).not.toMatch(/df-chrome|df-brand/);
    }
  });

  it("provides an icon and label for every state", () => {
    for (const sev of ALL) {
      expect(severityIcon[sev]).toBeTypeOf("object");
      expect(severityLabel[sev]).toMatch(/^[A-Z]+$/);
    }
  });
});
