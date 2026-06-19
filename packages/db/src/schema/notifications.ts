import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  integer,
  text,
  jsonb,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { notificationStatus } from './enums';
import { users } from './users';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(), // 'telegram' | 'web_push' | 'email'
    template: text('template').notNull(), // 'order_shipped'
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    status: notificationStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_notifications_user').on(t.userId, t.createdAt.desc()),
    index('idx_notifications_queued')
      .on(t.createdAt)
      .where(sql`${t.status} = 'queued'`),
    check(
      'chk_notification_channel',
      sql`${t.channel} IN ('telegram', 'web_push', 'email')`,
    ),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
