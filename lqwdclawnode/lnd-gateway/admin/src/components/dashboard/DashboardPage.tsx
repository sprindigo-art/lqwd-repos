import { useMetrics } from '@/hooks/useMetrics';
import { StatCards } from './StatCards';
import { CreditChart } from './CreditChart';
import { CallsChart } from './CallsChart';
import { TimeRangeSelector } from './TimeRangeSelector';
import { cn } from '@/lib/utils';

export function DashboardPage() {
  const { metrics, timeseries, timeRange, setTimeRange, loading, error } = useMetrics();

  // Empty state
  if (!loading && metrics && metrics.total_agents === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold">Dashboard</h2>
        <div
          className={cn(
            'mt-8 flex flex-col items-center justify-center rounded-lg border p-12 text-center',
            'bg-[var(--card)] border-[var(--border)]'
          )}
        >
          <h3 className="text-lg font-semibold">No activity yet</h3>
          <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Metrics will populate as agents register and make API calls.
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !loading) {
    return (
      <div>
        <h2 className="text-xl font-semibold">Dashboard</h2>
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
        <h2 className="text-xl font-semibold">Dashboard</h2>
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </div>

      <div className="mt-6">
        <StatCards metrics={metrics} loading={loading} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <CreditChart data={timeseries} loading={loading} />
        <CallsChart data={timeseries} loading={loading} />
      </div>
    </div>
  );
}
