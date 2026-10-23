import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAgents, type Agent } from '@/hooks/useAgents';
import { AgentTable } from './AgentTable';
import { GrantDialog } from './GrantDialog';
import { SuspendConfirm } from './SuspendConfirm';
import { TransactionDrawer } from './TransactionDrawer';
import { cn, formatSats } from '@/lib/utils';

export function AgentsPage() {
  const {
    agents,
    total,
    page,
    setPage,
    perPage,
    search: _search,
    setSearch,
    sort,
    setSort,
    dir,
    setDir,
    loading,
    grantCredits,
    updateStatus,
    refetch,
  } = useAgents();

  // Debounced search
  const [searchInput, setSearchInput] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput, setSearch, setPage]);

  // Grant dialog
  const [grantAgent, setGrantAgent] = useState<Agent | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);

  // Suspend confirm
  const [suspendAgent, setSuspendAgent] = useState<Agent | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);

  // Transaction drawer
  const [txAgent, setTxAgent] = useState<Agent | null>(null);
  const [txDrawerOpen, setTxDrawerOpen] = useState(false);

  function handleSort(col: string) {
    if (sort === col) {
      setDir(dir === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(col);
      setDir('desc');
    }
  }

  function handleViewHistory(agent: Agent) {
    setTxAgent(agent);
    setTxDrawerOpen(true);
  }

  function handleGrant(agent: Agent) {
    setGrantAgent(agent);
    setGrantOpen(true);
  }

  function handleStatusChange(agent: Agent) {
    if (agent.status === 'active') {
      setSuspendAgent(agent);
      setSuspendOpen(true);
    } else {
      // Unsuspend: no confirmation needed
      handleUnsuspend(agent);
    }
  }

  async function handleGrantSubmit(agentId: string, amount: number, reason: string) {
    await grantCredits(agentId, amount, reason);
    toast(`Granted ${formatSats(amount)} sats to ${grantAgent?.name ?? 'agent'}`);
    refetch();
  }

  async function handleSuspendConfirm(agentId: string) {
    await updateStatus(agentId, 'suspended');
    toast(`${suspendAgent?.name ?? 'Agent'} has been suspended`);
    refetch();
  }

  async function handleUnsuspend(agent: Agent) {
    try {
      await updateStatus(agent.id, 'active');
      toast(`${agent.name} has been unsuspended`);
      refetch();
    } catch {
      toast.error('Failed to unsuspend agent');
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Agents</h2>
      </div>

      {/* Search */}
      <div className="relative mt-4">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
          style={{ color: 'var(--muted-foreground)' }}
        />
        <input
          type="text"
          placeholder="Search agents..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className={cn(
            'flex h-10 w-full max-w-sm rounded-md border pl-10 pr-3 py-2 text-sm',
            'bg-transparent border-[var(--input)] text-[var(--foreground)]',
            'placeholder:text-[var(--muted-foreground)]',
            'focus:outline-none focus:ring-2 focus:ring-[var(--ring)]'
          )}
        />
      </div>

      {/* Table */}
      <div className="mt-4">
        <AgentTable
          agents={agents}
          loading={loading}
          sort={sort}
          dir={dir}
          onSort={handleSort}
          onGrant={handleGrant}
          onStatusChange={handleStatusChange}
          onViewHistory={handleViewHistory}
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

      {/* Grant Dialog */}
      <GrantDialog
        agent={grantAgent}
        open={grantOpen}
        onOpenChange={setGrantOpen}
        onGrant={handleGrantSubmit}
      />

      {/* Suspend Confirm */}
      <SuspendConfirm
        agent={suspendAgent}
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        onConfirm={handleSuspendConfirm}
      />

      {/* Transaction Drawer */}
      <TransactionDrawer
        open={txDrawerOpen}
        onClose={() => setTxDrawerOpen(false)}
        agent={txAgent}
      />
    </div>
  );
}
