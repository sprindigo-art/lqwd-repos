interface CriticalChipProps {
  /** Plain-English Tier-1 label passthrough, e.g. "fee crash" (never a raw code). */
  label: string;
}

/**
 * Breach text per sketch 001 ("CLOSE STORM", "UNREACHABLE" — plain uppercase
 * mono words, never emoji, never a boxed chip). D-07 still binds: only the
 * Tier-1 breach wears critical red, and it stays a SEPARATE signal — never
 * folded into the composite grade.
 */
export function CriticalChip({ label }: CriticalChipProps) {
  return (
    <span className="font-mono text-xs font-semibold tracking-[0.06em] uppercase whitespace-nowrap text-status-critical">
      {label}
    </span>
  );
}
