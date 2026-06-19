import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  bigint,
  text,
  char,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { paymentStatus } from './enums';
import { orders } from './orders';

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref'),
    status: paymentStatus('status').notNull().default('initiated'),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    rawPayload: jsonb('raw_payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_payments_order').on(t.orderId),
    check('chk_payment_amount', sql`${t.amountCents} >= 0`),
    // one logical payment per provider reference — webhook idempotency anchor
    uniqueIndex('uq_payment_provider_ref').on(t.provider, t.providerRef),
  ],
);

/** Dedupe incoming webhook deliveries (providers retry aggressively). */
export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type'),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_webhook_event').on(t.provider, t.providerEventId),
    index('idx_webhook_unprocessed')
      .on(t.receivedAt)
      .where(sql`${t.processedAt} IS NULL`),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PaymentWebhookEvent = typeof paymentWebhookEvents.$inferSelect;
