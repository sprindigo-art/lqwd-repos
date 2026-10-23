import { cn } from '@/lib/utils';

interface TimeRangeSelectorProps {
  value: string;
  onChange: (v: string) => void;
}

const ranges = [
  { label: '24h', value: '24' },
  { label: '7d', value: '168' },
  { label: '30d', value: '720' },
];

export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="flex gap-1 rounded-md border border-[var(--border)] p-1">
      {ranges.map((range) => (
        <button
          key={range.value}
          onClick={() => onChange(range.value)}
          className={cn(
            'rounded px-3 py-1.5 text-xs font-medium transition-colors',
            value === range.value
              ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          )}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
