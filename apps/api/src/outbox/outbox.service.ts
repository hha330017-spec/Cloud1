import { Inject, Injectable } from '@nestjs/common';
import { schema, type Database, type DbTransaction } from '@repo/db';
import type { Aggregate, EventType } from '@repo/types';
import { DB } from '../database/database.module';

export interface EmitInput<P = unknown> {
  aggregate: Aggregate;
  aggregateId: string;
  eventType: EventType;
  payload: P;
  traceId?: string;
}

/**
 * Writes domain events into the outbox table. The critical contract:
 * `emit` MUST be called with the SAME transaction handle (`tx`) that performed
 * the state mutation. That makes the event insert and the business write commit
 * atomically — either both land or neither does. No lost events, no phantom events.
 */
@Injectable()
export class OutboxService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async emit<P>(tx: DbTransaction, input: EmitInput<P>): Promise<void> {
    await tx.insert(schema.outboxEvents).values({
      aggregate: input.aggregate,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload as Record<string, unknown>,
      traceId: input.traceId ?? null,
    });
  }

  /**
   * Convenience unit-of-work: run a closure inside a DB transaction. The closure
   * receives both the tx (for its writes) and a bound emit() so callers can do
   * business mutations + event emission in one atomic block.
   */
  async withTransaction<T>(
    work: (
      tx: DbTransaction,
      emit: <P>(input: EmitInput<P>) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const emit = <P>(input: EmitInput<P>) => this.emit(tx, input);
      return work(tx, emit);
    });
  }
}
