import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  integer,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { reservationStatus } from './enums';
import { productVariants } from './catalog';
import { orders } from './orders';

/**
 * TTL-based stock holds. The consistency keystone:
 *   - reserve_stock() inserts a 'held' row + bumps reserved_qty atomically
 *   - commit_reservation() on payment success decrements real stock
 *   - release_reservation() / sweep_expired_reservations() free abandoned holds
 */
export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
    qty: integer('qty').notNull(),
    status: reservationStatus('status').notNull().default('held'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_reservations_expiry')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'held'`),
    index('idx_reservations_variant').on(t.variantId),
    index('idx_reservations_order').on(t.orderId),
    check('chk_reservation_qty', sql`${t.qty} > 0`),
  ],
);

export type StockReservation = typeof stockReservations.$inferSelect;
export type NewStockReservation = typeof stockReservations.$inferInsert;
