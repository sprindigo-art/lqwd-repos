import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/api';

export interface Agent {
  id: string;
  name: string;
  tier: number;
  balance_sats: number;
  status: string;
  last_active: string | null;
  created_at: string;
}

interface AgentsResponse {
  ok: boolean;
  agents: Agent[];
  total: number;
}

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const perPage = 20;
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('created_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        search,
        sort,
        dir,
        page: String(page),
        per_page: String(perPage),
      });
      const res = await adminFetch<AgentsResponse>('/agents?' + params.toString());
      if (res.ok && res.data) {
        setAgents(res.data.agents ?? []);
        setTotal(res.data.total ?? 0);
      } else {
        setError(res.error ?? 'Failed to load agents');
      }
    } catch {
      setError('Failed to load data. Check the gateway connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [search, sort, dir, page]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const grantCredits = useCallback(async (agentId: string, amount: number, reason: string) => {
    const res = await adminFetch(`/agents/${agentId}/grant`, {
      method: 'POST',
      body: JSON.stringify({ amount_sats: amount, reason }),
    });
    if (!res.ok) {
      throw new Error(res.error ?? 'Grant failed');
    }
  }, []);

  const updateStatus = useCallback(async (agentId: string, status: string) => {
    const res = await adminFetch(`/agents/${agentId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      throw new Error(res.error ?? 'Status update failed');
    }
  }, []);

  return {
    agents,
    total,
    page,
    setPage,
    perPage,
    search,
    setSearch,
    sort,
    setSort,
    dir,
    setDir,
    loading,
    error,
    grantCredits,
    updateStatus,
    refetch: fetchAgents,
  };
}
