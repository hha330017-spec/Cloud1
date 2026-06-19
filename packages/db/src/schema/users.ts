import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  bigint,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
  customType,
} from 'drizzle-orm/pg-core';
import { userRole } from './enums';

/**
 * citext custom type — case-insensitive text (matches the `citext` extension).
 * Used for email so "User@x.com" and "user@x.com" collide on the UNIQUE index.
 */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // BIGINT: Telegram user ids exceed 32-bit range. mode:'number' is safe
    // because Telegram ids stay well below Number.MAX_SAFE_INTEGER.
    telegramId: bigint('telegram_id', { mode: 'number' }).unique(),
    email: citext('email').unique(),
    passwordHash: text('password_hash'),
    role: userRole('role').notNull().default('customer'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    username: text('username'),
    phone: text('phone'),
    languageCode: text('language_code').notNull().default('en'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_users_telegram')
      .on(t.telegramId)
      .where(sql`${t.telegramId} IS NOT NULL`),
    index('idx_users_role').on(t.role),
    check(
      'chk_users_identity',
      sql`${t.telegramId} IS NOT NULL OR ${t.email} IS NOT NULL`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
