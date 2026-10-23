import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DetectorIdSchema } from "@/lib/insight/schema";
import { SIGNAL_LABELS } from "@/lib/insight/labels";

const moduleSource = readFileSync(
  fileURLToPath(new URL("./labels.ts", import.meta.url)),
  "utf8",
);

describe("SIGNAL_LABELS", () => {
  it("covers every DetectorId member (all 14, derived from DetectorIdSchema)", () => {
    const detectorIds = DetectorIdSchema.options;
    expect(detectorIds).toHaveLength(14);
    expect(Object.keys(SIGNAL_LABELS).sort()).toEqual([...detectorIds].sort());
  });

  it("every label is uppercase plain text — no emoji, icons, or dots", () => {
    for (const [id, label] of Object.entries(SIGNAL_LABELS)) {
      expect(label, id).toMatch(/^[A-Z0-9 —-]+$/);
      expect(label.length, id).toBeGreaterThan(0);
    }
  });

  it("is a pure module — no server runtime import", () => {
    expect(moduleSource).not.toContain("server" + "-only");
  });
});
