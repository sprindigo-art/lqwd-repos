import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/api';

export interface Transaction {
  id: string;
  amount_sats: number;
  tx_type: string;
  description: string;
  status: string;
  created_at: string;
}

interface TxResponse {
  ok: boolean;
  transactions: Transaction[];
  next_cursor: string;
}

export function useTransactions(agentId: string | null) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (agentIdVal: string, cursorVal: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (cursorVal) params.set('cursor', cursorVal);
      const res = await adminFetch<TxResponse>(`/agents/${agentIdVal}/transactions?${params}`);
      if (res.ok && res.data) {
        setTransactions((prev) =>
          cursorVal ? [...prev, ...res.data!.transactions] : res.data!.transactions
        );
        setCursor(res.data.next_cursor ?? '');
        setHasMore(!!res.data.next_cursor);
      } else {
        setError(res.error ?? 'Failed to load transactions');
      }
    } catch {
      setError('Failed to load transactions. Try closing and reopening the drawer.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Reset when agentId changes
  useEffect(() => {
    setTransactions([]);
    setCursor('');
    setHasMore(false);
    setError(null);
    if (agentId) fetchPage(agentId, '');
  }, [agentId, fetchPage]);

  const loadMore = useCallback(() => {
    if (cursor && !loading && agentId) fetchPage(agentId, cursor);
  }, [cursor, loading, agentId, fetchPage]);

  return { transactions, loading, error, hasMore, loadMore };
}
