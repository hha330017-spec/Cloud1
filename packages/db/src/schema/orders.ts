import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  bigint,
  bigserial,
  integer,
  text,
  char,
  jsonb,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { orderStatus } from './enums';
import { users } from './users';
import { vendors } from './vendors';
import { productVariants } from './catalog';

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderNumber: text('order_number').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),
    status: orderStatus('status').notNull().default('pending_payment'),
    subtotalCents: bigint('subtotal_cents', { mode: 'number' }).notNull(),
    shippingCents: bigint('shipping_cents', { mode: 'number' }).notNull().default(0),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    shippingAddress: jsonb('shipping_address'),
    // unique idempotency key prevents double-submit creating two orders
    idempotencyKey: text('idempotency_key').unique(),
    placedVia: text('placed_via').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_orders_vendor_status').on(t.vendorId, t.status, t.createdAt.desc()),
    index('idx_orders_user').on(t.userId, t.createdAt.desc()),
    check(
      'chk_order_amounts',
      sql`${t.subtotalCents} >= 0 AND ${t.shippingCents} >= 0 AND ${t.totalCents} >= 0
          AND ${t.totalCents} = ${t.subtotalCents} + ${t.shippingCents}`,
    ),
    check('chk_order_placed_via', sql`${t.placedVia} IN ('web', 'tma', 'bot')`),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    productTitleSnapshot: text('product_title_snapshot').notNull(),
    optionsSnapshot: jsonb('options_snapshot').notNull(),
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    qty: integer('qty').notNull(),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('idx_order_items_order').on(t.orderId),
    check('chk_order_item_qty', sql`${t.qty} > 0`),
    check('chk_order_item_total', sql`${t.totalCents} = ${t.unitPriceCents} * ${t.qty}`),
  ],
);

/** Append-only audit log. Illegal transitions rejected by DB trigger. */
export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status').notNull(),
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_order_history_order').on(t.orderId, t.createdAt)],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderStatusHistory = typeof orderStatusHistory.$inferSelect;
