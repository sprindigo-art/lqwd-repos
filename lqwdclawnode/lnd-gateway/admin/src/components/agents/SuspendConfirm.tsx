import { useState } from 'react';
import { type Agent } from '@/hooks/useAgents';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface SuspendConfirmProps {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (agentId: string) => Promise<void>;
}

export function SuspendConfirm({ agent, open, onOpenChange, onConfirm }: SuspendConfirmProps) {
  const [loading, setLoading] = useState(false);

  if (!open || !agent) return null;

  async function handleConfirm() {
    if (!agent) return;
    setLoading(true);
    try {
      await onConfirm(agent.id);
      onOpenChange(false);
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
        <h2 className="text-lg font-semibold">
          Suspend {agent.name}?
        </h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Their API key will immediately return 403 on all requests. You can unsuspend them at any time.
        </p>

        <div className="mt-6 flex gap-3">
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
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className={cn(
              'flex h-10 flex-1 items-center justify-center rounded-md text-sm font-medium',
              'bg-[var(--destructive)] text-[var(--destructive-foreground)]',
              'hover:opacity-90 transition-opacity',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Suspend Agent'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
