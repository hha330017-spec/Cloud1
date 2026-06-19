import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, newIdempotencyKey } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { useHaptics } from '../../platform/buttons';
import { applyAdd, type AddToCartInput, type Cart } from './types';

interface MutationContext {
  previous: Cart | undefined;
}

/**
 * Add to cart with the complete optimistic lifecycle:
 *
 *   onMutate  -> cancel in-flight cart fetches, snapshot the cache, write the
 *                optimistic cart so the UI updates INSTANTLY, fire haptics.
 *   mutationFn-> POST with a fresh Idempotency-Key (server dedupes retries).
 *   onError   -> ROLL BACK to the snapshot, error haptic.
 *   onSuccess -> replace cache with the server's authoritative cart (real ids,
 *                true totals).
 *   onSettled -> invalidate so the next read reconciles with the source of truth.
 *
 * Note on idempotency: a fresh key per click is correct here — the server's
 * UNIQUE(cart_id, variant_id) merges quantities, so a retried request with the
 * same key returns the cached response instead of double-adding.
 */
export function useAddToCart() {
  const qc = useQueryClient();
  const { impact, notify } = useHaptics();

  return useMutation<Cart, Error, AddToCartInput, MutationContext>({
    mutationFn: (input) =>
      apiFetch<Cart>('/cart/items', {
        method: 'POST',
        body: { variantId: input.variantId, qty: input.qty },
        idempotencyKey: newIdempotencyKey(),
      }),

    onMutate: async (input) => {
      // Prevent an in-flight refetch from clobbering our optimistic write.
      await qc.cancelQueries({ queryKey: qk.cart() });
      const previous = qc.getQueryData<Cart>(qk.cart());
      qc.setQueryData<Cart>(qk.cart(), (old) => applyAdd(old, input));
      impact('light');
      return { previous };
    },

    onError: (_err, _input, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(qk.cart(), ctx.previous);
      }
      notify('error');
    },

    onSuccess: (serverCart) => {
      // Server response is authoritative — adopt it directly.
      qc.setQueryData(qk.cart(), serverCart);
    },

    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.cart() });
    },
  });
}
