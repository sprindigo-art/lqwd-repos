import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { type TimePoint } from '@/hooks/useMetrics';
import { cn } from '@/lib/utils';

interface CallsChartProps {
  data: TimePoint[];
  loading: boolean;
}

function formatBucket(bucket: string): string {
  const d = new Date(bucket);
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${month}/${day} ${hours}:${mins}`;
}

export function CallsChart({ data, loading }: CallsChartProps) {
  return (
    <div
      className={cn(
        'rounded-lg border p-6',
        'bg-[var(--card)] border-[var(--border)]'
      )}
    >
      <h3 className="mb-4 text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
        L402 Calls
      </h3>
      {loading ? (
        <div className="h-[280px] animate-pulse rounded bg-[var(--muted)]" />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="bucket"
              tickFormatter={formatBucket}
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
            />
            <YAxis
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--foreground)',
                fontSize: 12,
              }}
            />
            <Bar
              dataKey="l402_calls"
              fill="var(--chart-2)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
