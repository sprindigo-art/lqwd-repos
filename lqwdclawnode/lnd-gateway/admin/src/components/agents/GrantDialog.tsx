import { useState, type FormEvent } from 'react';
import { type Agent } from '@/hooks/useAgents';
import { cn } from '@/lib/utils';
import { Loader2, AlertCircle } from 'lucide-react';

interface GrantDialogProps {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGrant: (agentId: string, amount: number, reason: string) => Promise<void>;
}

export function GrantDialog({ agent, open, onOpenChange, onGrant }: GrantDialogProps) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !agent) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!agent) return;
    setError(null);
    setLoading(true);

    try {
      await onGrant(agent.id, Number(amount), reason);
      setAmount('');
      setReason('');
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Grant failed: ${msg}. The agent's balance was not changed.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div
        className={cn(
          'relative z-50 w-full max-w-md rounded-lg border p-6',
          'bg-[var(--card)] border-[var(--border)]'
        )}
      >
        <h2 className="text-lg font-semibold">Grant Credits</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Grant Tier 3 credits to {agent.name}. This will be recorded in their transaction history.
        </p>

        {error && (
          <div
            className={cn(
              'mt-4 flex items-start gap-2 rounded-md border p-3 text-sm',
              'border-[var(--destructive)] bg-[var(--destructive)]/10 text-[var(--destructive)]'
            )}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="grant-amount"
              className="mb-1.5 block text-xs"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Amount (sats)
            </label>
            <input
              id="grant-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={loading}
              className={cn(
                'flex h-10 w-full rounded-md border px-3 py-2 text-sm',
                'bg-transparent border-[var(--input)] text-[var(--foreground)]',
                'placeholder:text-[var(--muted-foreground)]',
                'focus:outline-none focus:ring-2 focus:ring-[var(--ring)]',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            />
          </div>

          <div>
            <label
              htmlFor="grant-reason"
              className="mb-1.5 block text-xs"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Reason
            </label>
            <input
              id="grant-reason"
              type="text"
              placeholder="e.g., Support ticket #123"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading}
              className={cn(
                'flex h-10 w-full rounded-md border px-3 py-2 text-sm',
                'bg-transparent border-[var(--input)] text-[var(--foreground)]',
                'placeholder:text-[var(--muted-foreground)]',
                'focus:outline-none focus:ring-2 focus:ring-[var(--ring)]',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className={cn(
                'flex h-10 flex-1 items-center justify-center rounded-md border text-sm',
                'border-[var(--border)] text-[var(--foreground)]',
                'hover:bg-[var(--accent)] transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !amount || Number(amount) < 1}
              className={cn(
                'flex h-10 flex-1 items-center justify-center rounded-md text-sm font-medium',
                'bg-[var(--primary)] text-[var(--primary-foreground)]',
                'hover:opacity-90 transition-opacity',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Grant Credits'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
