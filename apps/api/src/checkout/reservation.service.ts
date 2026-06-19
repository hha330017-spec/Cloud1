import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Database, type DbTransaction } from '@repo/db';
import { DB } from '../database/database.module';

export interface ReserveLine {
  variantId: string;
  qty: number;
}

/**
 * Race-condition-safe reservations.
 *
 * SCENARIO: two buyers try to grab the exact last unit at the same millisecond.
 * Without protection both reads see stock=1 and both decrement -> oversell /
 * negative stock. Below are the two correct strategies; both guarantee stock
 * never drops below zero and only one buyer wins.
 */
@Injectable()
export class ReservationService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // =========================================================================
  // STRATEGY A — Pessimistic row lock (SELECT ... FOR UPDATE)
  // =========================================================================
  /**
   * Best when contention is high (flash sale on one SKU).
   *
   * `SELECT ... FOR UPDATE` takes an exclusive row lock. The second transaction
   * BLOCKS at the SELECT until the first COMMITs, then reads the post-update
   * value (available = 0) and is rejected. Serialised by Postgres on the row;
   * no oversell possible. The CHECK constraint (reserved_qty <= stock_qty) is
   * the final backstop if application logic is ever wrong.
   *
   * Reserving multiple lines: lock variants in a DETERMINISTIC order (sorted by
   * id) to avoid deadlocks between concurrent multi-item carts.
   */
  async reserveWithRowLock(
    orderId: string,
    lines: ReserveLine[],
    ttlSeconds = 900,
  ): Promise<string[]> {
    const sorted = [...lines].sort((a, b) => (a.variantId < b.variantId ? -1 : 1));

    return this.db.transaction(async (tx) => {
      const reservationIds: string[] = [];

      for (const line of sorted) {
        // 1) Acquire the exclusive lock and read current numbers.
        const [variant] = await tx
          .select({
            id: schema.productVariants.id,
            stockQty: schema.productVariants.stockQty,
            reservedQty: schema.productVariants.reservedQty,
            isActive: schema.productVariants.isActive,
          })
          .from(schema.productVariants)
          .where(eq(schema.productVariants.id, line.variantId))
          .for('update') // <-- row-level lock held until COMMIT/ROLLBACK
          .limit(1);

        if (!variant || !variant.isActive) {
          throw new ConflictException({ code: 'VARIANT_UNAVAILABLE', variantId: line.variantId });
        }

        const available = variant.stockQty - variant.reservedQty;
        if (available < line.qty) {
          // Throwing rolls back the whole tx, releasing locks + any prior holds.
          throw new ConflictException({
            code: 'OUT_OF_STOCK',
            variantId: line.variantId,
            available,
          });
        }

        // 2) Safe to reserve — we hold the lock, no one else can interleave.
        await tx
          .update(schema.productVariants)
          .set({
            reservedQty: sql`${schema.productVariants.reservedQty} + ${line.qty}`,
            version: sql`${schema.productVariants.version} + 1`,
          })
          .where(eq(schema.productVariants.id, line.variantId));

        const [res] = await tx
          .insert(schema.stockReservations)
          .values({
            variantId: line.variantId,
            orderId,
            qty: line.qty,
            status: 'held',
            expiresAt: new Date(Date.now() + ttlSeconds * 1000),
          })
          .returning({ id: schema.stockReservations.id });

        reservationIds.push(res!.id);
      }

      return reservationIds;
    });
  }

  // =========================================================================
  // STRATEGY B — Optimistic concurrency (version CAS, no locks)
  // =========================================================================
  /**
   * Best when contention is low (most catalogs). No locks, so it scales better,
   * but the loser must retry.
   *
   * The UPDATE is a compare-and-swap: it only succeeds if BOTH the version is
   * unchanged since we read it AND enough stock is free. Two racers read
   * version=7; the first UPDATE bumps it to 8 (rowCount=1, wins); the second's
   * `WHERE version = 7` now matches nothing (rowCount=0, loses) and retries,
   * re-reads version=8 with available=0, and is rejected. No oversell.
   */
  async reserveWithOptimisticVersion(
    orderId: string,
    line: ReserveLine,
    ttlSeconds = 900,
    maxRetries = 3,
  ): Promise<string> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const [variant] = await this.db
        .select({
          stockQty: schema.productVariants.stockQty,
          reservedQty: schema.productVariants.reservedQty,
          version: schema.productVariants.version,
          isActive: schema.productVariants.isActive,
        })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.id, line.variantId))
        .limit(1);

      if (!variant || !variant.isActive) {
        throw new ConflictException({ code: 'VARIANT_UNAVAILABLE', variantId: line.variantId });
      }
      if (variant.stockQty - variant.reservedQty < line.qty) {
        throw new ConflictException({ code: 'OUT_OF_STOCK', variantId: line.variantId });
      }

      // Atomic CAS in a single transaction: bump reserved only if version + free
      // stock still hold. Returns the row only when it actually updated.
      const reservationId = await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(schema.productVariants)
          .set({
            reservedQty: sql`${schema.productVariants.reservedQty} + ${line.qty}`,
            version: sql`${schema.productVariants.version} + 1`,
          })
          .where(
            and(
              eq(schema.productVariants.id, line.variantId),
              eq(schema.productVariants.version, variant.version), // <-- the CAS guard
              sql`${schema.productVariants.stockQty} - ${schema.productVariants.reservedQty} >= ${line.qty}`,
            ),
          )
          .returning({ id: schema.productVariants.id });

        if (updated.length === 0) return null; // someone else won; retry outer loop

        const [res] = await tx
          .insert(schema.stockReservations)
          .values({
            variantId: line.variantId,
            orderId,
            qty: line.qty,
            status: 'held',
            expiresAt: new Date(Date.now() + ttlSeconds * 1000),
          })
          .returning({ id: schema.stockReservations.id });
        return res!.id;
      });

      if (reservationId) return reservationId;
      // else: version moved under us -> loop and retry with fresh read
    }

    throw new ConflictException({
      code: 'CONTENTION_RETRY_EXHAUSTED',
      message: 'Could not reserve stock after retries; please try again',
    });
  }

  /** Shared helper used by the webhook path to commit a single reservation. */
  async commitReservationTx(tx: DbTransaction, reservationId: string): Promise<void> {
    await tx.execute(sql`SELECT commit_reservation(${reservationId}::uuid)`);
  }
}
