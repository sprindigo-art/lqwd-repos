import { ArrowUp, ArrowDown } from 'lucide-react';
import { type Agent } from '@/hooks/useAgents';
import { cn, formatSats, formatRelativeTime } from '@/lib/utils';

interface AgentTableProps {
  agents: Agent[];
  loading: boolean;
  sort: string;
  dir: string;
  onSort: (col: string) => void;
  onGrant: (agent: Agent) => void;
  onStatusChange: (agent: Agent) => void;
  onViewHistory?: (agent: Agent) => void;
}

const columns = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'tier', label: 'Tier', sortable: true },
  { key: 'balance_sats', label: 'Balance', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'last_active', label: 'Last Active', sortable: true },
  { key: 'actions', label: 'Actions', sortable: false },
];

function StatusBadge({ status }: { status: string }) {
  const isActive = status === 'active';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        isActive
          ? 'bg-[var(--success)]/15 text-[var(--success)]'
          : 'bg-[var(--destructive)]/15 text-[var(--destructive)]'
      )}
    >
      {status}
    </span>
  );
}

function TierBadge({ tier }: { tier: number }) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs font-medium"
      style={{ color: 'var(--foreground)' }}
    >
      Tier {tier}
    </span>
  );
}

export function AgentTable({
  agents,
  loading,
  sort,
  dir,
  onSort,
  onGrant,
  onStatusChange,
  onViewHistory,
}: AgentTableProps) {
  if (!loading && agents.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border p-12 text-center',
          'bg-[var(--card)] border-[var(--border)]'
        )}
      >
        <h3 className="text-lg font-semibold">No agents registered</h3>
        <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Agents will appear here after they register through the API. Share the registration endpoint to get started.
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
                  'px-4 py-3 text-left text-xs font-normal',
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
            agents.map((agent) => (
              <tr
                key={agent.id}
                className="border-b border-[var(--border)] transition-colors hover:bg-[var(--primary)]/[0.08]"
              >
                <td className="px-4 py-3 text-sm">{agent.name}</td>
                <td className="px-4 py-3 text-sm">
                  <TierBadge tier={agent.tier} />
                </td>
                <td className="px-4 py-3 text-sm">{formatSats(agent.balance_sats)} sats</td>
                <td className="px-4 py-3 text-sm">
                  <StatusBadge status={agent.status} />
                </td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  {agent.last_active ? formatRelativeTime(agent.last_active) : 'Never'}
                </td>
                <td className="px-4 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onViewHistory?.(agent)}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--accent)] transition-colors"
                    >
                      View History
                    </button>
                    <button
                      onClick={() => onGrant(agent)}
                      className={cn(
                        'rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium',
                        'hover:bg-[var(--accent)] transition-colors'
                      )}
                    >
                      Grant Credits
                    </button>
                    <button
                      onClick={() => onStatusChange(agent)}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        agent.status === 'active'
                          ? 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                          : 'text-[var(--success)] hover:opacity-80'
                      )}
                    >
                      {agent.status === 'active' ? 'Suspend Agent' : 'Unsuspend Agent'}
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
