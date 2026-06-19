import { sql } from 'drizzle-orm';
import {
  pgTable,
  bigserial,
  uuid,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Transactional Outbox. Rows are inserted in the SAME transaction as the
 * domain mutation, guaranteeing event + state commit atomically. A separate
 * relay worker polls unpublished rows (FOR UPDATE SKIP LOCKED) and publishes
 * to Redis Pub/Sub, then stamps published_at. At-least-once delivery.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    aggregate: text('aggregate').notNull(), // 'inventory' | 'order' | 'cart'
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(), // 'inventory.updated'
    payload: jsonb('payload').notNull(),
    traceId: text('trace_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [
    index('idx_outbox_unpublished')
      .on(t.id)
      .where(sql`${t.publishedAt} IS NULL`),
  ],
);

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
