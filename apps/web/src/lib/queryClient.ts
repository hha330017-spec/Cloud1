import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

/**
 * Stale-while-revalidate is the core mobile strategy:
 *   - staleTime 30s: cached data is served INSTANTLY, then revalidated in the
 *     background so the user never stares at a spinner on a flaky connection.
 *   - gcTime 24h: keeps entries alive long enough for the localStorage persister
 *     to reuse them on the next cold boot (warm start).
 *   - networkMode 'offlineFirst': render from cache even before the network resolves.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 0, // mutations are idempotency-keyed; retry handled explicitly
    },
  },
});

/** Persist the cache to localStorage for instant warm boots (SWR on reload). */
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'mp-query-cache',
  throttleTime: 1000,
});

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: 1000 * 60 * 60 * 24, // 24h
  // Bump when the cache shape changes to invalidate stale persisted data.
  buster: 'v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => {
      // Never persist sensitive/volatile state (cart, orders) — only catalog.
      // Opt a query OUT by setting meta.persist === false in its useQuery.
      if (query.meta?.persist === false) return false;
      const root = query.queryKey[0];
      return root === 'products' || root === 'product';
    },
  },
};
