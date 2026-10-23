import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { type TimePoint } from '@/hooks/useMetrics';
import { cn } from '@/lib/utils';

interface CreditChartProps {
  data: TimePoint[];
  loading: boolean;
}

function formatBucket(bucket: string): string {
  const d = new Date(bucket);
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  // If the data spans more than 48h, show date format
  return `${month}/${day} ${hours}:${mins}`;
}

export function CreditChart({ data, loading }: CreditChartProps) {
  return (
    <div
      className={cn(
        'rounded-lg border p-6',
        'bg-[var(--card)] border-[var(--border)]'
      )}
    >
      <h3 className="mb-4 text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
        Credits Granted
      </h3>
      {loading ? (
        <div className="h-[280px] animate-pulse rounded bg-[var(--muted)]" />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data}>
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
            <Area
              type="monotone"
              dataKey="credits_granted"
              stroke="var(--chart-1)"
              fill="var(--chart-1)"
              fillOpacity={0.2}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
