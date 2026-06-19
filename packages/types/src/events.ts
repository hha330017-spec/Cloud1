/**
 * Domain event contracts. These are the payloads written to outbox_events and
 * fanned out over Redis Pub/Sub -> Socket.IO. Shared by @repo/api, @repo/bot,
 * and @repo/web so producers and consumers can never drift.
 */

export type Aggregate = 'inventory' | 'order' | 'cart' | 'payment';

export const EVENT = {
  INVENTORY_UPDATED: 'inventory.updated',
  ORDER_CREATED: 'order.created',
  ORDER_STATUS_CHANGED: 'order.status_changed',
  CART_UPDATED: 'cart.updated',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
} as const;

export type EventType = (typeof EVENT)[keyof typeof EVENT];

/** Envelope every event shares once relayed. */
export interface DomainEventEnvelope<T = unknown> {
  id: string; // outbox row id (as string)
  aggregate: Aggregate;
  aggregateId: string;
  eventType: EventType;
  payload: T;
  traceId?: string;
  occurredAt: string; // ISO-8601
}

// ---- Per-event payloads ----

export interface InventoryUpdatedPayload {
  variantId: string;
  productId: string;
  vendorId: string;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  version: number;
}

export interface OrderStatusChangedPayload {
  orderId: string;
  orderNumber: string;
  userId: string;
  vendorId: string;
  fromStatus: string | null;
  toStatus: string;
}

export interface CartUpdatedPayload {
  cartId: string;
  userId: string;
  itemCount: number;
  subtotalCents: number;
}

export interface PaymentResultPayload {
  orderId: string;
  paymentId: string;
  provider: string;
  amountCents: number;
  currency: string;
}

/** Maps an event type to its payload shape (for exhaustive switch handling). */
export interface EventPayloadMap {
  [EVENT.INVENTORY_UPDATED]: InventoryUpdatedPayload;
  [EVENT.ORDER_CREATED]: OrderStatusChangedPayload;
  [EVENT.ORDER_STATUS_CHANGED]: OrderStatusChangedPayload;
  [EVENT.CART_UPDATED]: CartUpdatedPayload;
  [EVENT.PAYMENT_SUCCEEDED]: PaymentResultPayload;
  [EVENT.PAYMENT_FAILED]: PaymentResultPayload;
}

/** Redis Pub/Sub channel that the relay publishes to. */
export const PUBSUB_CHANNEL = 'domain-events';

/** Socket.IO room naming helpers — single source of truth for room keys. */
export const room = {
  user: (userId: string) => `user:${userId}`,
  vendor: (vendorId: string) => `vendor:${vendorId}`,
  product: (productId: string) => `product:${productId}`,
  order: (orderId: string) => `order:${orderId}`,
} as const;
