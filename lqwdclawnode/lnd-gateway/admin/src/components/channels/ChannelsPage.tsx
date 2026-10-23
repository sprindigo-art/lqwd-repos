import { useChannels } from '@/hooks/useChannels';
import { ChannelTable } from './ChannelTable';
import { cn } from '@/lib/utils';

const statusOptions = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'pending_open', label: 'Pending Open' },
  { value: 'open', label: 'Open' },
  { value: 'failed', label: 'Failed' },
  { value: 'closed', label: 'Closed' },
];

export function ChannelsPage() {
  const {
    channels,
    total,
    page,
    setPage,
    perPage,
    statusFilter,
    setStatusFilter,
    sort,
    setSort,
    dir,
    setDir,
    loading,
    error,
  } = useChannels();

  function handleSort(col: string) {
    if (sort === col) {
      setDir(dir === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(col);
      setDir('desc');
    }
  }

  function handleStatusChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (error && !loading) {
    return (
      <div>
        <h2 className="text-xl font-semibold">Channels</h2>
        <div
          className={cn(
            'mt-8 flex flex-col items-center justify-center rounded-lg border p-12 text-center',
            'bg-[var(--card)] border-[var(--border)] border-[var(--destructive)]'
          )}
        >
          <p className="text-sm" style={{ color: 'var(--destructive)' }}>
            Failed to load data. Check the gateway connection and try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Channels</h2>
      </div>

      {/* Status filter */}
      <div className="mt-4">
        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          className={cn(
            'flex h-10 rounded-md border px-3 py-2 text-sm',
            'bg-transparent border-[var(--input)] text-[var(--foreground)]',
            'focus:outline-none focus:ring-2 focus:ring-[var(--ring)]'
          )}
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="mt-4">
        <ChannelTable
          channels={channels}
          loading={loading}
          sort={sort}
          dir={dir}
          onSort={handleSort}
        />
      </div>

      {/* Pagination */}
      {total > perPage && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className={cn(
              'rounded-md border border-[var(--border)] px-3 py-1.5 text-xs',
              'hover:bg-[var(--accent)] transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            Previous
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs transition-colors',
                p === page
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'hover:bg-[var(--accent)]'
              )}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className={cn(
              'rounded-md border border-[var(--border)] px-3 py-1.5 text-xs',
              'hover:bg-[var(--accent)] transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
