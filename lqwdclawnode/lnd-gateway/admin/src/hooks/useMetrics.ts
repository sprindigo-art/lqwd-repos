import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/api';

export interface AdminMetrics {
  total_agents: number;
  total_credits_granted: number;
  total_l402_calls: number;
  daily_faucet_spend: number;
  total_channels_opened: number;
  active_channels: number;
  total_sats_pushed: number;
  faucet_slots_remaining: number;
}

export interface TimePoint {
  bucket: string;
  credits_granted: number;
  l402_calls: number;
}

interface MetricsResponse {
  ok: boolean;
  metrics: AdminMetrics;
  timeseries: TimePoint[];
}

export function useMetrics() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [timeseries, setTimeseries] = useState<TimePoint[]>([]);
  const [timeRange, setTimeRange] = useState<string>('24');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<MetricsResponse>('/metrics?range=' + timeRange);
      if (res.ok && res.data) {
        setMetrics(res.data.metrics);
        setTimeseries(res.data.timeseries ?? []);
      } else {
        setError(res.error ?? 'Failed to load metrics');
      }
    } catch {
      setError('Failed to load data. Check the gateway connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return { metrics, timeseries, timeRange, setTimeRange, loading, error, refetch: fetchMetrics };
}
