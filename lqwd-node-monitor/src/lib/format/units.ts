// AFM-002 single source of truth for all sat / BTC / msat math.
// No inline `/ 1e8`, `* 1000`, or raw `fee` is permitted anywhere else in the codebase —
// every conversion routes through these named exports (see ../lqwdLogs analytical-failure-modes.md).
const SATS_PER_BTC = 100_000_000; // 1e8
const MSAT_PER_SAT = 1_000;

// Binary (IEC) byte scale — host-vitals storage/memory render through THIS, never
// an inline `/ 1024 ** 3` or `/ 1073741824` at a call site (acceptance grep gate).
const BYTES_PER_KIB = 1024;
const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
// Placeholder for a missing percentage — mirrors the file's null-coalescing posture.
const PERCENT_NULL = "—";

/** Millisatoshis → satoshis. Always use for any `*_msat` column (never raw `fee`). */
export function feeMsatToSat(msat: bigint | number): number {
  return Number(msat) / MSAT_PER_SAT;
}

/** Satoshis → BTC string at fixed precision (default 4 dp). */
export function formatBtc(sats: bigint | number, dp = 4): string {
  return (Number(sats) / SATS_PER_BTC).toFixed(dp);
}

/** Satoshis display with en-US thousands separators. */
export function formatSats(sats: bigint | number): string {
  return Number(sats).toLocaleString("en-US");
}

/**
 * Bytes → binary unit string (B/KiB/MiB/GiB/TiB), auto-scaled to the largest unit
 * at or below the value, fixed precision (default 2 dp). The SINGLE place binary
 * byte math lives — never inline `/ 1024 ** 3` or `/ 1073741824` elsewhere (AFM-002).
 */
export function formatBytes(bytes: bigint | number, dp = 2): string {
  let value = Number(bytes);
  let unitIndex = 0;
  while (
    Math.abs(value) >= BYTES_PER_KIB &&
    unitIndex < BYTE_UNITS.length - 1
  ) {
    value /= BYTES_PER_KIB;
    unitIndex += 1;
  }
  return `${value.toFixed(dp)} ${BYTE_UNITS[unitIndex]}`;
}

/** Options for {@link formatPercent}. */
export interface FormatPercentOptions {
  /** When true, `value` is already a 0–100 percentage (not a 0–1 fraction). */
  alreadyPercent?: boolean;
  /** Decimal places (default 1). */
  dp?: number;
}

/**
 * Render a percentage with fixed precision (default 1 dp). A 0–1 fraction is scaled
 * ×100; pass `alreadyPercent` for a value already on the 0–100 scale. The result is
 * clamped into [0, 100]; null/undefined renders the "—" placeholder. Single source
 * for percent formatting — no inline `* 100` / `% math` at call sites (AFM-002).
 */
export function formatPercent(
  value: number | null | undefined,
  opts: FormatPercentOptions = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PERCENT_NULL;
  }
  const dp = opts.dp ?? 1;
  const asPercent = opts.alreadyPercent ? value : value * 100;
  const clamped = Math.min(100, Math.max(0, asPercent));
  return `${clamped.toFixed(dp)}%`;
}
