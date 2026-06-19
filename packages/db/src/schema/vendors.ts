import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  integer,
  text,
  jsonb,
  timestamp,
  index,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { vendorStatus } from './enums';
import { users } from './users';

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: vendorStatus('status').notNull().default('pending'),
    // commission in basis points: 1000 = 10.00% (integer money, no float %)
    commissionBps: integer('commission_bps').notNull().default(1000),
    payoutDetails: jsonb('payout_details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_vendors_owner').on(t.ownerId),
    index('idx_vendors_status').on(t.status),
    check('chk_vendor_commission', sql`${t.commissionBps} BETWEEN 0 AND 10000`),
  ],
);

export const vendorMembers = pgTable(
  'vendor_members',
  {
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('staff'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.vendorId, t.userId] }),
    index('idx_vendor_members_user').on(t.userId),
  ],
);

export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;
export type VendorMember = typeof vendorMembers.$inferSelect;
