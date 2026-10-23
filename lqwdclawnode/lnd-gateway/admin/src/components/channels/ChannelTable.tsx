import { ArrowUp, ArrowDown } from 'lucide-react';
import { type ChannelGrantEntry } from '@/hooks/useChannels';
import { cn, formatSats } from '@/lib/utils';

interface ChannelTableProps {
  channels: ChannelGrantEntry[];
  loading: boolean;
  sort: string;
  dir: string;
  onSort: (col: string) => void;
}

const columns = [
  { key: 'agent_name', label: 'Agent', sortable: true },
  { key: 'pubkey', label: 'Pubkey', sortable: false },
  { key: 'node_uri', label: 'Node URI', sortable: false },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'funding_txid', label: 'Funding TxID', sortable: false },
  { key: 'output_index', label: 'Output Index', sortable: false },
  { key: 'channel_size_sats', label: 'Channel Size', sortable: true },
  { key: 'push_amount_sats', label: 'Push Amount', sortable: true },
  { key: 'fail_reason', label: 'Fail Reason', sortable: false },
  { key: 'banned', label: 'Banned', sortable: true },
  { key: 'created_at', label: 'Created', sortable: true },
  { key: 'opened_at', label: 'Opened', sortable: false },
  { key: 'closed_at', label: 'Closed', sortable: false },
  { key: 'closed_reason', label: 'Close Reason', sortable: false },
];

function ChannelStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    pending: 'bg-yellow-500/15 text-yellow-500',
    pending_open: 'bg-blue-500/15 text-blue-500',
    open: 'bg-[var(--success)]/15 text-[var(--success)]',
    failed: 'bg-[var(--destructive)]/15 text-[var(--destructive)]',
    closed: 'bg-[var(--muted-foreground)]/15 text-[var(--muted-foreground)]',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        colorMap[status] ?? 'bg-[var(--muted-foreground)]/15 text-[var(--muted-foreground)]'
      )}
    >
      {status}
    </span>
  );
}

function BannedBadge({ banned }: { banned: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        banned
          ? 'bg-[var(--destructive)]/15 text-[var(--destructive)]'
          : 'bg-[var(--muted-foreground)]/15 text-[var(--muted-foreground)]'
      )}
    >
      {banned ? 'Yes' : 'No'}
    </span>
  );
}

function TruncatedCell({ value, maxWidth }: { value: string; maxWidth: string }) {
  if (!value) return <span style={{ color: 'var(--muted-foreground)' }}>-</span>;
  return (
    <span
      className={cn('block truncate cursor-help', maxWidth)}
      title={value}
    >
      {value}
    </span>
  );
}

function TruncatedPubkey({ value }: { value: string }) {
  if (!value) return <span style={{ color: 'var(--muted-foreground)' }}>-</span>;
  const display = value.length > 10 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
  return (
    <span className="cursor-help" title={value}>
      {display}
    </span>
  );
}

function formatDate(val: string | null): string {
  if (!val) return '-';
  return new Date(val).toLocaleDateString();
}

export function ChannelTable({ channels, loading, sort, dir, onSort }: ChannelTableProps) {
  if (!loading && channels.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border p-12 text-center',
          'bg-[var(--card)] border-[var(--border)]'
        )}
      >
        <h3 className="text-lg font-semibold">No channel grants</h3>
        <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Channel grants will appear here as agents request channels through the faucet.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--card)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'whitespace-nowrap px-4 py-3 text-left text-xs font-normal',
                  col.sortable && 'cursor-pointer select-none hover:text-[var(--foreground)]'
                )}
                style={{ color: 'var(--muted-foreground)' }}
                onClick={() => col.sortable && onSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.sortable && sort === col.key && (
                    dir === 'asc' ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-[var(--border)]">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    <div className="h-4 w-20 animate-pulse rounded bg-[var(--muted)]" />
                  </td>
                ))}
              </tr>
            ))
          ) : (
            channels.map((ch) => (
              <tr
                key={ch.id}
                className="border-b border-[var(--border)] transition-colors hover:bg-[var(--primary)]/[0.08]"
              >
                <td className="px-4 py-3 text-sm">{ch.agent_name}</td>
                <td className="px-4 py-3 text-sm">
                  <TruncatedPubkey value={ch.pubkey} />
                </td>
                <td className="px-4 py-3 text-sm">
                  <TruncatedCell value={ch.node_uri} maxWidth="max-w-[140px]" />
                </td>
                <td className="px-4 py-3 text-sm">
                  <ChannelStatusBadge status={ch.status} />
                </td>
                <td className="px-4 py-3 text-sm">
                  <TruncatedCell value={ch.funding_txid} maxWidth="max-w-[120px]" />
                </td>
                <td className="px-4 py-3 text-sm">{ch.output_index}</td>
                <td className="px-4 py-3 text-sm">{formatSats(ch.channel_size_sats)} sats</td>
                <td className="px-4 py-3 text-sm">{formatSats(ch.push_amount_sats)} sats</td>
                <td className="px-4 py-3 text-sm">
                  <TruncatedCell value={ch.fail_reason} maxWidth="max-w-[160px]" />
                </td>
                <td className="px-4 py-3 text-sm">
                  <BannedBadge banned={ch.banned} />
                </td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  {formatDate(ch.created_at)}
                </td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  {formatDate(ch.opened_at)}
                </td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  {formatDate(ch.closed_at)}
                </td>
                <td className="px-4 py-3 text-sm">
                  <TruncatedCell value={ch.closed_reason} maxWidth="max-w-[160px]" />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
