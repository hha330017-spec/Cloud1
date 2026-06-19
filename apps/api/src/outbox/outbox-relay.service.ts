import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { Database } from '@repo/db';
import { PUBSUB_CHANNEL, type DomainEventEnvelope } from '@repo/types';
import { Redis } from 'ioredis';
import { DB } from '../database/database.module';
import { REDIS } from '../redis/redis.module';

/**
 * Outbox Relay (polling publisher).
 *
 * Every tick it claims a batch of unpublished events using
 *   SELECT ... FOR UPDATE SKIP LOCKED
 * inside a transaction. SKIP LOCKED lets multiple API replicas run the relay
 * concurrently without ever processing the same row twice and without blocking
 * each other. Each claimed event is published to Redis Pub/Sub and then stamped
 * published_at in the SAME transaction, so a crash mid-batch simply rolls back
 * and the events are retried on the next tick (at-least-once delivery).
 *
 * Consumers must be idempotent because at-least-once can deliver twice.
 */
@Injectable()
export class OutboxRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private running = false;
  private stopped = false;
  private static readonly BATCH = 100;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onModuleDestroy(): void {
    this.stopped = true;
  }

  // Poll fast; combine with LISTEN/NOTIFY for near-zero latency if desired.
  @Interval('outbox-relay', 250)
  async relayTick(): Promise<void> {
    if (this.running || this.stopped) return; // prevent overlapping ticks
    this.running = true;
    try {
      let processed = 0;
      // Drain in batches until empty so a backlog clears quickly.
      // eslint-disable-next-line no-constant-condition
      while (!this.stopped) {
        const n = await this.processBatch();
        processed += n;
        if (n < OutboxRelayService.BATCH) break;
      }
      if (processed > 0) this.logger.debug(`relayed ${processed} events`);
    } catch (err) {
      this.logger.error('relay tick failed', err as Error);
    } finally {
      this.running = false;
    }
  }

  private async processBatch(): Promise<number> {
    return this.db.transaction(async (tx) => {
      // Claim a batch; SKIP LOCKED => safe across replicas.
      const rows = await tx.execute<{
        id: string;
        aggregate: string;
        aggregate_id: string;
        event_type: string;
        payload: unknown;
        trace_id: string | null;
        created_at: Date;
      }>(sql`
        SELECT id, aggregate, aggregate_id, event_type, payload, trace_id, created_at
        FROM outbox_events
        WHERE published_at IS NULL
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT ${OutboxRelayService.BATCH}
      `);

      const list = rows.rows ?? [];
      if (list.length === 0) return 0;

      const publishedIds: string[] = [];
      for (const row of list) {
        const envelope: DomainEventEnvelope = {
          id: String(row.id),
          aggregate: row.aggregate as DomainEventEnvelope['aggregate'],
          aggregateId: row.aggregate_id,
          eventType: row.event_type as DomainEventEnvelope['eventType'],
          payload: row.payload,
          traceId: row.trace_id ?? undefined,
          occurredAt: new Date(row.created_at).toISOString(),
        };
        // Publish to Redis; the Realtime gateway + BullMQ producers subscribe.
        await this.redis.publish(PUBSUB_CHANNEL, JSON.stringify(envelope));
        publishedIds.push(row.id);
      }

      // Stamp as published within the same tx. If publish above threw, the whole
      // tx rolls back and nothing is marked published -> retried next tick.
      await tx.execute(sql`
        UPDATE outbox_events
        SET published_at = now(), attempts = attempts + 1
        WHERE id = ANY(${sql.raw(`ARRAY[${publishedIds.join(',')}]::bigint[]`)})
      `);

      return list.length;
    });
  }
}
