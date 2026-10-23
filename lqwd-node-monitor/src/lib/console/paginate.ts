// Pure module: no server runtime imports, no DB, no Date — fixture-testable
// anywhere and safe to import from Server Components and route handlers alike.
// =====================================================
// paginate.ts — URL ?page whitelist-parse + pure page slice (G1 foundation)
// =====================================================
// Security (V5 / threat T-13-11-01): the ?page param is operator-editable and
// untrusted. `parsePageParam` follows filter.ts's "invalid silently widens to
// the safe default" contract — a bad/hostile ?page never throws, it clamps to a
// valid page. The returned `offset` is a clean non-negative integer the caller
// binds as an `::int` param (never string-interpolated into SQL).

/** Default rows-per-page for the paginated console sub-route tables. */
export const DEFAULT_PAGE_SIZE = 50;

/** The clamped pagination frame derived from a raw ?page param + a total count. */
export interface PageParam {
  /** 1-based page, always within [1, pageCount]. */
  page: number;
  /** Zero-based row offset for `OFFSET ${offset}::int` — always >= 0. */
  offset: number;
  /** Total number of pages, always >= 1 (a zero-row set still has page 1 of 1). */
  pageCount: number;
  /** The effective page size (echoes the resolved default). */
  pageSize: number;
}

/**
 * Parse a raw ?page URL value against a known total row count into a clamped
 * pagination frame. Never throws on any input:
 *   • undefined / null / non-numeric / non-integer / <= 0 → page 1 (offset 0)
 *   • raw beyond the last page → clamped to pageCount
 *   • total 0 → page 1, pageCount 1, offset 0
 * The `pageSize` defaults to DEFAULT_PAGE_SIZE and is floored to a sane >= 1.
 */
export function parsePageParam(
  raw: string | null | undefined,
  opts: { total: number; pageSize?: number },
): PageParam {
  const pageSize = Math.max(1, Math.floor(opts.pageSize ?? DEFAULT_PAGE_SIZE));
  // A zero/negative total still has a single (empty) page — pageCount never < 1.
  const total = Number.isFinite(opts.total) ? Math.max(0, Math.floor(opts.total)) : 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Parse raw as a strict positive integer; any non-conforming value → page 1.
  const parsed = raw == null ? NaN : Number(raw);
  const requested =
    Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;

  const page = Math.min(requested, pageCount);
  const offset = (page - 1) * pageSize;
  return { page, offset, pageCount, pageSize };
}

/**
 * Pure array slice for the given 1-based page. Returns an empty array when the
 * page is beyond range. Never mutates the input array.
 */
export function slicePage<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
