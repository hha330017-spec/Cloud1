/**
 * Centralised query keys so producers (queries) and consumers (websocket
 * invalidation, optimistic mutations) can never drift. Mirrors the API resources.
 */
export const qk = {
  products: (filters?: Record<string, unknown>) =>
    filters ? (['products', filters] as const) : (['products'] as const),
  product: (id: string) => ['product', id] as const,
  cart: () => ['cart'] as const,
  orders: () => ['orders'] as const,
  order: (id: string) => ['order', id] as const,
} as const;
