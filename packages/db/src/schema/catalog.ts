import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  bigint,
  integer,
  text,
  char,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
  customType,
} from 'drizzle-orm/pg-core';
import { productStatus } from './enums';
import { vendors } from './vendors';

/** tsvector custom type for full-text search (maintained by a DB trigger). */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_categories_parent').on(t.parentId)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    status: productStatus('status').notNull().default('draft'),
    attributes: jsonb('attributes').notNull().default(sql`'{}'::jsonb`),
    searchTsv: tsvector('search_tsv'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_products_vendor_slug').on(t.vendorId, t.slug),
    index('idx_products_vendor_status').on(t.vendorId, t.status),
    index('idx_products_category').on(t.categoryId),
    index('idx_products_search').using('gin', t.searchTsv),
    index('idx_products_attributes').using('gin', t.attributes),
  ],
);

/**
 * A variant is the sellable SKU. Stock + price live HERE, never on products.
 *   available = stock_qty - reserved_qty   (computed in queries)
 *   version   = optimistic-lock counter, bumped on every stock mutation
 * Money is BIGINT cents. mode:'number' stays exact within safe-integer range.
 */
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull().unique(),
    options: jsonb('options').notNull().default(sql`'{}'::jsonb`),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    stockQty: integer('stock_qty').notNull().default(0),
    reservedQty: integer('reserved_qty').notNull().default(0),
    version: integer('version').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_variants_product').on(t.productId),
    check('chk_stock_nonneg', sql`${t.stockQty} >= 0`),
    check('chk_reserved_nonneg', sql`${t.reservedQty} >= 0`),
    check('chk_reserved_le_stock', sql`${t.reservedQty} <= ${t.stockQty}`),
    check('chk_price_nonneg', sql`${t.priceCents} >= 0`),
  ],
);

export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type NewProductVariant = typeof productVariants.$inferInsert;
