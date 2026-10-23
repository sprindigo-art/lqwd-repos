import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/api';

export interface ChannelGrantEntry {
  id: string;
  agent_id: string;
  agent_name: string;
  pubkey: string;
  node_uri: string;
  status: string;
  funding_txid: string;
  output_index: number;
  channel_size_sats: number;
  push_amount_sats: number;
  fail_reason: string;
  banned: boolean;
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
  closed_reason: string;
}

interface ChannelsResponse {
  ok: boolean;
  channels: ChannelGrantEntry[];
  total: number;
}

export function useChannels() {
  const [channels, setChannels] = useState<ChannelGrantEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const perPage = 20;
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState('created_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        sort,
        dir,
        page: String(page),
        per_page: String(perPage),
      });
      if (statusFilter) params.set('status', statusFilter);
      const res = await adminFetch<ChannelsResponse>('/channels?' + params.toString());
      if (res.ok && res.data) {
        setChannels(res.data.channels ?? []);
        setTotal(res.data.total ?? 0);
      } else {
        setError(res.error ?? 'Failed to load channels');
      }
    } catch {
      setError('Failed to load data. Check the gateway connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sort, dir, page]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  return {
    channels,
    total,
    page,
    setPage,
    perPage,
    statusFilter,
    setStatusFilter,
    sort,
    setSort,
    dir,
    setDir,
    loading,
    error,
    refetch: fetchChannels,
  };
}
