import { ConflictException } from '@nestjs/common';

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

/**
 * The single source of truth for legal transitions. Mirrors the DB trigger
 * (assert_valid_order_transition) so we fail fast in the app AND have a
 * defensive backstop in Postgres.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['processing', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: ['refunded'],
  cancelled: [], // terminal
  refunded: [], // terminal
} as const;

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throws 409 if the transition is illegal (e.g. shipped -> pending_payment). */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === to) {
    throw new ConflictException({
      code: 'NO_OP_TRANSITION',
      message: `Order is already '${to}'`,
    });
  }
  if (!canTransition(from, to)) {
    throw new ConflictException({
      code: 'ILLEGAL_TRANSITION',
      message: `Cannot move order from '${from}' to '${to}'`,
    });
  }
}

/** Side effects each terminal/inventory-affecting transition implies. */
export function inventoryEffect(
  from: OrderStatus,
  to: OrderStatus,
): 'commit' | 'unwind' | 'none' {
  if (to === 'paid') return 'commit'; // holds -> real stock decrement
  if (to === 'cancelled' || to === 'refunded') return 'unwind'; // give stock back
  void from;
  return 'none';
}
