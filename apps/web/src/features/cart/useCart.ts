import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import type { Cart } from './types';

/**
 * The cart is SERVER state, never client state — that's what keeps web + TMA in
 * sync. meta.persist=false keeps this volatile/user-specific data out of the
 * localStorage cache (only the public catalog is persisted).
 */
export function useCart() {
  return useQuery({
    queryKey: qk.cart(),
    queryFn: () => apiFetch<Cart>('/cart'),
    staleTime: 0, // always considered stale so realtime invalidation refetches
    meta: { persist: false },
  });
}
