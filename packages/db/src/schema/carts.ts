import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  bigint,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { cartStatus } from './enums';
import { users } from './users';
import { productVariants } from './catalog';

export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: cartStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Exactly one ACTIVE cart per user (partial unique index):
    uniqueIndex('idx_one_active_cart')
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    // snapshot of price at add-time; reconciled against live price at checkout
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_cart_variant').on(t.cartId, t.variantId),
    index('idx_cart_items_cart').on(t.cartId),
    check('chk_cart_item_qty', sql`${t.qty} > 0`),
  ],
);

export type Cart = typeof carts.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type NewCartItem = typeof cartItems.$inferInsert;
