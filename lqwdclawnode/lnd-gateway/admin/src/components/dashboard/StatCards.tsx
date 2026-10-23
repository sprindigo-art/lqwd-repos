import { type AdminMetrics } from '@/hooks/useMetrics';
import { cn, formatSats } from '@/lib/utils';

interface StatCardsProps {
  metrics: AdminMetrics | null;
  loading: boolean;
}

const creditStats = [
  { key: 'total_agents' as const, label: 'Total Agents', suffix: '' },
  { key: 'total_credits_granted' as const, label: 'Credits Granted', suffix: ' sats' },
  { key: 'total_l402_calls' as const, label: 'L402 Calls', suffix: '' },
  { key: 'daily_faucet_spend' as const, label: 'Daily Faucet Spend', suffix: ' sats' },
];

const channelStats = [
  { key: 'total_channels_opened' as const, label: 'Total Channels Opened', suffix: '' },
  { key: 'active_channels' as const, label: 'Active Channels', suffix: '' },
  { key: 'total_sats_pushed' as const, label: 'Total Sats Pushed', suffix: ' sats' },
  { key: 'faucet_slots_remaining' as const, label: 'Faucet Slots Remaining', suffix: '' },
];

function StatCard({
  label,
  value,
  suffix,
  loading,
}: {
  label: string;
  value: number;
  suffix: string;
  loading: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-6',
        'bg-[var(--card)] border-[var(--border)]'
      )}
    >
      <p
        className="text-xs font-normal"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {label}
      </p>
      {loading ? (
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-[var(--muted)]" />
      ) : (
        <p className="mt-2 text-[32px] font-semibold leading-tight">
          {formatSats(value)}
          {value > 0 && suffix && (
            <span
              className="ml-1 text-sm font-normal"
              style={{ color: 'var(--muted-foreground)' }}
            >
              {suffix.trim()}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export function StatCards({ metrics, loading }: StatCardsProps) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {creditStats.map((stat) => (
          <StatCard
            key={stat.key}
            label={stat.label}
            value={metrics ? metrics[stat.key] : 0}
            suffix={stat.suffix}
            loading={loading}
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {channelStats.map((stat) => (
          <StatCard
            key={stat.key}
            label={stat.label}
            value={metrics ? metrics[stat.key] : 0}
            suffix={stat.suffix}
            loading={loading}
          />
        ))}
      </div>
    </>
  );
}
