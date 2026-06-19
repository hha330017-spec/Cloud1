import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, newIdempotencyKey } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { usePlatform } from '../../platform/PlatformProvider';
import { useHaptics } from '../../platform/buttons';
import type { Cart } from './types';

export interface ShippingAddress {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface CheckoutInput {
  shippingAddress: ShippingAddress;
  ref?: string; // referral attribution from a deep link
}

export interface CheckoutResult {
  orderId: string;
  orderNumber: string;
  /** Provider checkout URL/intent the UI redirects to (or null for TG Payments). */
  paymentUrl?: string;
}

/**
 * Checkout = create order from the current cart.
 *
 * CRITICAL idempotency difference vs add-to-cart: the key is STABLE across
 * retries of the same checkout attempt (held in a ref), so a double-tap, a
 * network retry, or the user reopening the app NEVER creates two orders — the
 * server returns the original order for a repeated key. The key is rotated only
 * after a confirmed success, so the next genuine checkout gets a new one.
 */
export function useCheckout() {
  const qc = useQueryClient();
  const { notify } = useHaptics();
  const { isTelegram } = usePlatform();
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());

  return useMutation<CheckoutResult, Error, CheckoutInput>({
    mutationFn: (input) =>
      apiFetch<CheckoutResult>('/orders', {
        method: 'POST',
        body: {
          shippingAddress: input.shippingAddress,
          ref: input.ref,
          placedVia: isTelegram ? 'tma' : 'web',
        },
        idempotencyKey: idempotencyKeyRef.current,
      }),

    onSuccess: (result) => {
      notify('success');
      // Cart is converted server-side; clear it locally for an instant empty UI.
      qc.setQueryData<Cart>(qk.cart(), (old) =>
        old ? { ...old, items: [], subtotalCents: 0 } : old,
      );
      void qc.invalidateQueries({ queryKey: qk.cart() });
      void qc.invalidateQueries({ queryKey: qk.orders() });
      void qc.invalidateQueries({ queryKey: qk.order(result.orderId) });
      // Rotate the key so a subsequent checkout is a distinct operation.
      idempotencyKeyRef.current = newIdempotencyKey();
    },

    onError: () => {
      notify('error');
      // Keep the SAME key: a retry of this attempt must remain idempotent.
    },
  });
}
