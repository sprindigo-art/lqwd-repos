import { describe, it, expect } from "vitest";
import {
  feeMsatToSat,
  formatBtc,
  formatSats,
  formatBytes,
  formatPercent,
} from "@/lib/format/units";

// AFM-002 reference values from ../lqwdLogs/_library/analytical-failure-modes.md
// (via RESEARCH §E). These are the documented sat→BTC conversions the 10×/1000×
// failures must never reproduce. The formatter is the SINGLE source of truth.
const BTC_REFERENCE: ReadonlyArray<[number, string, string]> = [
  [3_359_047_565, "33.5905", "Canada capacity"],
  [2_398_147_951, "23.9815", "Canada local balance"],
  [30_041_489_086, "300.4149", "Canada routing volume"],
  [47_271_912_611, "472.7191", "rebalance attempted"],
  [32_112_853_476, "321.1285", "moved through SouthAfrica"],
];

describe("feeMsatToSat (msat → sat)", () => {
  it("divides millisatoshis by 1_000", () => {
    expect(feeMsatToSat(1000)).toBe(1);
  });

  it("handles fleet-scale fee_msat sums without precision loss", () => {
    // e.g. a forwards fee_msat total of 3,359,047 → 3359.047 sat
    expect(feeMsatToSat(3_359_047)).toBeCloseTo(3359.047, 3);
  });

  it("accepts bigint without precision loss", () => {
    expect(feeMsatToSat(1000n)).toBe(1);
  });
});

describe("formatBtc (sat → BTC, dp=4)", () => {
  for (const [sats, expected, note] of BTC_REFERENCE) {
    it(`${sats} → ${expected} BTC (${note})`, () => {
      expect(formatBtc(sats)).toBe(expected);
    });
  }

  it("respects a custom decimal-place argument", () => {
    expect(formatBtc(3_359_047_565, 2)).toBe("33.59");
  });

  it("accepts bigint for fleet-scale sat values", () => {
    expect(formatBtc(3_359_047_565n)).toBe("33.5905");
  });

  it("Canada capacity literal 3359047565 → 33.5905 BTC", () => {
    // bare-literal form of the documented AFM-002 anchor value
    expect(formatBtc(3359047565)).toBe("33.5905");
  });

  it("back-conversion: parsed BTC × 1e8 is within ±1% of source sats", () => {
    for (const [sats] of BTC_REFERENCE) {
      const roundTrip = parseFloat(formatBtc(sats)) * 1e8;
      expect(Math.abs(roundTrip - sats)).toBeLessThanOrEqual(sats * 0.01);
    }
  });
});

describe("formatSats (en-US thousands separators)", () => {
  it("formats with comma separators", () => {
    expect(formatSats(3_359_047_565)).toBe("3,359,047,565");
  });

  it("accepts bigint", () => {
    expect(formatSats(3_359_047_565n)).toBe("3,359,047,565");
  });
});

// AFM-002 EXTENSION — host-vitals bytes → KiB/MiB/GiB/TiB (binary, 1024-based).
// units.ts stays the SINGLE source of truth: inline binary-byte division (the
// power-of-two divisor forms) is permitted nowhere else — the acceptance grep
// gate forbids it outside units.ts. The reference
// table mirrors BTC_REFERENCE: [rawBytes, expectedString, note].
const BYTES_REFERENCE: ReadonlyArray<[number, string, string]> = [
  [0, "0.00 B", "zero stays bytes"],
  [512, "512.00 B", "sub-KiB stays bytes"],
  [1024, "1.00 KiB", "1 KiB exact (1024^1)"],
  [1_048_576, "1.00 MiB", "1 MiB exact (1024^2)"],
  [1_073_741_824, "1.00 GiB", "1 GiB exact (1024^3)"],
  [1_610_612_736, "1.50 GiB", "1.5 GiB"],
  [1_099_511_627_776, "1.00 TiB", "1 TiB exact (1024^4)"],
  [2_199_023_255_552, "2.00 TiB", "2 TiB"],
];

describe("formatBytes (bytes → KiB/MiB/GiB/TiB, binary, dp=2)", () => {
  for (const [bytes, expected, note] of BYTES_REFERENCE) {
    it(`${bytes} → ${expected} (${note})`, () => {
      expect(formatBytes(bytes)).toBe(expected);
    });
  }

  it("auto-scales to the largest unit at or below the value", () => {
    // just under 1 GiB stays in MiB (no premature promotion)
    expect(formatBytes(1_073_741_823)).toContain("MiB");
  });

  it("respects a custom decimal-place argument", () => {
    expect(formatBytes(1_073_741_824, 0)).toBe("1 GiB");
    expect(formatBytes(1_610_612_736, 1)).toBe("1.5 GiB");
  });

  it("accepts bigint for fleet-scale byte values", () => {
    expect(formatBytes(1_099_511_627_776n)).toBe("1.00 TiB");
  });

  it("caps at TiB for values beyond the unit table", () => {
    // 1024 TiB does not promote to PiB (table tops out at TiB)
    expect(formatBytes(1_125_899_906_842_624n)).toBe("1024.00 TiB");
  });
});

describe("formatPercent (fraction or already-percent → fixed 1 dp)", () => {
  it("treats a 0–1 fraction as a percentage", () => {
    expect(formatPercent(0.5)).toBe("50.0%");
  });

  it("treats an already-percent value verbatim under alreadyPercent", () => {
    expect(formatPercent(50, { alreadyPercent: true })).toBe("50.0%");
  });

  it("renders 0 and 100 boundaries", () => {
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(100, { alreadyPercent: true })).toBe("100.0%");
  });

  it("clamps out-of-range values into [0, 100]", () => {
    expect(formatPercent(150, { alreadyPercent: true })).toBe("100.0%");
    expect(formatPercent(-5, { alreadyPercent: true })).toBe("0.0%");
  });

  it("handles null / undefined gracefully (null-coalescing posture)", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
  });

  it("respects a custom decimal-place argument", () => {
    expect(formatPercent(0.5, { dp: 2 })).toBe("50.00%");
  });
});
