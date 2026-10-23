import type { ReactNode } from "react";
import Link from "next/link";

import { cn, FOCUS_RING } from "@/lib/utils";
import { severityAccent, severityText, type Severity } from "./Severity";

// =====================================================
// SeverityRow — the condensed grouped-child record row (Server)
// =====================================================
// The approved redesign (sketch `.child` :126-141) collapses the old five-element
// record into a calm one-liner:
//
//   [category icon] ── single label ─────────── right-pinned severity status
//
// • The LEADING glyph is a caller-supplied NEUTRAL category icon (`icon`, from
//   `CategoryIcon`) that says WHAT the alert is. When no icon is given the legacy
//   2px SQUARE severity dot leads instead (frozen-gallery back-compat).
// • The single `id`/label is the WHAT (node alias / service name / fee phrase).
// • The right-pinned `status` is the STATE word, painted via `severityText`
//   (`statusSev ?? sev`) — this is the ONLY severity affordance on the row. There is
//   NO severity glyph and NO layer `kind` chip anymore (D-R5: severity stays
//   state-only; category is neutral).
// • When `note` string-equals the label it is SUPPRESSED — this kills the
//   `Address List Sync · services · Address List Sync` echo.
// • With an `href` the whole row becomes a `next/link` click-through (fee rows route
//   to `/{pubkey}/fees`); without one it is a plain div.
//
// Presentational only — any sat/fee evidence in `note`/`status` is pre-formatted by
// the caller via AFM-002 (`formatSats(feeMsatToSat(...))`); this component does NO
// unit math. All markup is df-token-only (noc-guard clean).
//
// LEGACY: `identity`/`evidence` are deprecated v1 aliases for `id`/`note`; `kind`
// and `detail` are retained (kind is now a NO-OP) so the frozen design-system
// gallery + prior SeverityCard callers keep compiling.

interface SeverityRowProps {
  /** Row state — drives the fallback square dot + the default status color. */
  sev: Severity;
  /** The record's single label (mono node id / service name / fee phrase). */
  id?: ReactNode;
  /** Leading NEUTRAL category glyph (from `CategoryIcon`) — replaces the square dot. */
  icon?: ReactNode;
  /** Right-pinned STATE word, painted via `severityText[statusSev ?? sev]`. */
  status?: ReactNode;
  /** Severity coloring the `status` (defaults to the row `sev`). */
  statusSev?: Severity;
  /** When set, the whole row is a `next/link` click-through (e.g. `/{pubkey}/fees`). */
  href?: string;
  /** Secondary clause — SUPPRESSED when it string-equals the label (no echo). */
  note?: ReactNode;
  /** @deprecated Right-pinned faint mono detail — rendered only when no `status`. */
  detail?: ReactNode;
  /** @deprecated NO-OP layer chip — accepted for back-compat, never rendered. */
  kind?: ReactNode;
  /** @deprecated v1 alias for `id` — retained for the frozen gallery. */
  identity?: ReactNode;
  /** @deprecated v1 alias for `note` — retained for the frozen gallery. */
  evidence?: ReactNode;
  /** Extra classes merged last via `cn()`. */
  className?: string;
}

/**
 * One condensed grouped-child record row: `[category icon] label … status`. Renders
 * in every severity state without throwing; the icon, note, status and detail all
 * drop out cleanly when omitted, and an `href` promotes the row to a `next/link`.
 */
export function SeverityRow({
  sev,
  id,
  icon,
  status,
  statusSev,
  href,
  note,
  detail,
  identity,
  evidence,
  className,
}: SeverityRowProps) {
  // New columnar props win; v1 aliases backfill so the frozen gallery compiles.
  const recordId = id ?? identity;
  const recordNote = note ?? evidence;

  // Suppress the echo: when the note string-equals the label, drop it entirely.
  const labelStr = typeof recordId === "string" ? recordId : undefined;
  const noteStr = typeof recordNote === "string" ? recordNote : undefined;
  const showNote =
    recordNote !== undefined && !(labelStr !== undefined && noteStr === labelStr);

  const rowClass = cn(
    "flex items-center gap-2.5 rounded-[8px] border border-df-border-soft bg-df-surface px-3 py-2",
    href && "transition-colors hover:border-df-border hover:bg-df-surface-sub",
    className,
  );

  const content = (
    <>
      {/* Leading glyph: caller category icon, else the legacy 2px SQUARE sev dot. */}
      {icon !== undefined ? (
        <span className="flex-none" aria-hidden="true">
          {icon}
        </span>
      ) : (
        <span
          className={cn("size-2 flex-none rounded-[2px]", severityAccent[sev])}
          aria-hidden="true"
        />
      )}

      {/* Single label — the WHAT. */}
      {recordId !== undefined && (
        <span className="min-w-0 truncate font-df-mono text-[12.5px] font-medium text-df-ink">
          {recordId}
        </span>
      )}

      {/* Secondary clause — only when it does NOT echo the label. */}
      {showNote && (
        <span className="min-w-0 truncate text-[12px] text-df-muted">{recordNote}</span>
      )}

      {/* Right-pinned severity-colored STATE word (the only severity affordance). */}
      {status !== undefined && (
        <span
          className={cn(
            "ms-auto font-df-mono text-[11px] whitespace-nowrap",
            severityText[statusSev ?? sev],
          )}
        >
          {status}
        </span>
      )}

      {/* Legacy faint mono detail — only when no status is pinned right. */}
      {status === undefined && detail !== undefined && (
        <span className="ms-auto font-df-mono text-[10.5px] whitespace-nowrap text-df-muted">
          {detail}
        </span>
      )}
    </>
  );

  if (href !== undefined) {
    return (
      <Link href={href} className={cn(rowClass, FOCUS_RING)}>
        {content}
      </Link>
    );
  }
  return <div className={rowClass}>{content}</div>;
}
