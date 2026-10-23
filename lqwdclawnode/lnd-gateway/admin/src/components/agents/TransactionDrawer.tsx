import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn, formatSats } from '@/lib/utils';
import { useTransactions, type Transaction } from '@/hooks/useTransactions';
import type { Agent } from '@/hooks/useAgents';

interface TransactionDrawerProps {
  open: boolean;
  onClose: () => void;
  agent: Agent | null;
}

function TxTypeBadge({ txType }: { txType: string }) {
  const colorMap: Record<string, string> = {
    faucet_grant: 'bg-[var(--success)]/15 text-[var(--success)]',
    admin_grant: 'bg-blue-500/15 text-blue-500',
    debit: 'bg-[var(--muted-foreground)]/15 text-[var(--muted-foreground)]',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        colorMap[txType] ?? 'bg-[var(--muted-foreground)]/15 text-[var(--muted-foreground)]'
      )}
    >
      {txType}
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

function TransactionRow({ tx }: { tx: Transaction }) {
  const isNegative = tx.amount_sats < 0;
  return (
    <tr className="border-b border-[var(--border)]">
      <td
        className={cn(
          'px-4 py-3 text-sm',
          isNegative && 'text-[var(--destructive)]'
        )}
      >
        {formatSats(tx.amount_sats)} sats
      </td>
      <td className="px-4 py-3 text-sm">
        <TxTypeBadge txType={tx.tx_type} />
      </td>
      <td className="px-4 py-3 text-sm">{tx.description}</td>
      <td className="px-4 py-3 text-sm" style={{ color: 'var(--muted-foreground)' }}>
        {new Date(tx.created_at).toLocaleString()}
      </td>
    </tr>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-b border-[var(--border)]">
          <td className="px-4 py-3">
            <div className="h-4 w-16 animate-pulse rounded bg-[var(--muted)]" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-20 animate-pulse rounded bg-[var(--muted)]" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-32 animate-pulse rounded bg-[var(--muted)]" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-24 animate-pulse rounded bg-[var(--muted)]" />
          </td>
        </tr>
      ))}
    </>
  );
}

export function TransactionDrawer({ open, onClose, agent }: TransactionDrawerProps) {
  const { transactions, loading, error, hasMore, loadMore } = useTransactions(
    open && agent ? agent.id : null
  );

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className={cn(
            'fixed right-0 top-0 z-50 h-full w-[480px] overflow-y-auto',
            'bg-[var(--background)] border-l border-[var(--border)]',
            'animate-in slide-in-from-right duration-200'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--border)] p-6">
            <Dialog.Title className="text-lg font-semibold">
              Transaction History
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="rounded-md p-1 hover:bg-[var(--accent)] transition-colors"
                aria-label="Close transaction history"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Agent summary */}
          {agent && (
            <div className="border-b border-[var(--border)] p-6">
              <p className="text-sm font-semibold">{agent.name}</p>
              <div className="mt-2 flex items-center gap-3">
                <TierBadge tier={agent.tier} />
                <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  {formatSats(agent.balance_sats)} sats
                </span>
              </div>
            </div>
          )}

          {/* Transaction list */}
          <div className="p-6">
            {error && (
              <p className="mb-4 text-sm" style={{ color: 'var(--destructive)' }}>
                {error}
              </p>
            )}

            {!loading && !error && transactions.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                No transactions yet. Credits and debits will appear here as the agent uses the API.
              </p>
            )}

            {(transactions.length > 0 || loading) && (
              <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                      <th
                        className="px-4 py-3 text-left text-xs font-normal"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        Amount
                      </th>
                      <th
                        className="px-4 py-3 text-left text-xs font-normal"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        Type
                      </th>
                      <th
                        className="px-4 py-3 text-left text-xs font-normal"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        Description
                      </th>
                      <th
                        className="px-4 py-3 text-left text-xs font-normal"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <TransactionRow key={tx.id} tx={tx} />
                    ))}
                    {loading && <SkeletonRows />}
                  </tbody>
                </table>
              </div>
            )}

            {hasMore && !loading && (
              <button
                onClick={loadMore}
                className={cn(
                  'mt-4 w-full rounded-md border border-[var(--border)] px-4 py-2 text-sm',
                  'hover:bg-[var(--accent)] transition-colors'
                )}
              >
                Load more
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
