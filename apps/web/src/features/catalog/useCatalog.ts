import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import type { Product, ProductPage } from './types';

export function useProducts(filters?: { category?: string; q?: string }) {
  const search = new URLSearchParams(
    Object.entries(filters ?? {}).filter(([, v]) => Boolean(v)) as [string, string][],
  ).toString();
  return useQuery({
    queryKey: qk.products(filters),
    queryFn: () => apiFetch<ProductPage>(`/products${search ? `?${search}` : ''}`),
    // Catalog is persisted (default) so reloads show last-seen products instantly.
  });
}

export function useProduct(productId: string) {
  return useQuery({
    queryKey: qk.product(productId),
    queryFn: () => apiFetch<Product>(`/products/${productId}`),
  });
}
