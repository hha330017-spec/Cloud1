import { Inject, Injectable, Logger, ConflictException } from '@nestjs/common';
import { sql, eq } from 'drizzle-orm';
import { schema, type Database, type DbTransaction } from '@repo/db';
import { EVENT, type InventoryUpdatedPayload } from '@repo/types';
import { DB } from '../database/database.module';
import { OutboxService } from '../outbox/outbox.service';

export interface ReserveResult {
  reservationId: string;
  success: boolean;
}

/**
 * Inventory operations. All stock mutations go through here so that:
 *   1. concurrency is race-safe (DB-enforced), and
 *   2. an inventory.updated event is emitted in the SAME transaction (outbox).
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Race-condition-safe reservation.
   *
   * Two buyers, one last unit, same millisecond:
   *   reserve_stock() runs a conditional UPDATE guarded by
   *   (stock_qty - reserved_qty) >= qty. Postgres serialises the two UPDATEs on
   *   the row lock; the first wins, the second sees 0 free and returns success=false.
   *   The CHECK constraint (reserved_qty <= stock_qty) is the final backstop.
   * No oversell is possible.
   */
  async reserve(variantId: string, qty: number, orderId: string): Promise<ReserveResult> {
    return this.outbox.withTransaction(async (tx, emit) => {
      const res = await tx.execute<{ reservation_id: string | null; success: boolean }>(
        sql`SELECT * FROM reserve_stock(${variantId}::uuid, ${qty}::int, ${orderId}::uuid, 900)`,
      );
      const row = res.rows?.[0];

      if (!row || !row.success) {
        // Caller maps this to HTTP 409 — the item just sold out.
        throw new ConflictException({
          code: 'OUT_OF_STOCK',
          message: 'Requested quantity is no longer available',
          variantId,
        });
      }

      await this.emitInventoryUpdated(tx, emit, variantId);
      return { reservationId: row.reservation_id!, success: true };
    });
  }

  /** On payment success: convert the hold into a real stock decrement. */
  async commit(reservationId: string, variantId: string): Promise<void> {
    await this.outbox.withTransaction(async (tx, emit) => {
      const res = await tx.execute<{ commit_reservation: boolean }>(
        sql`SELECT commit_reservation(${reservationId}::uuid)`,
      );
      if (!res.rows?.[0]?.commit_reservation) {
        this.logger.warn(`commit no-op for reservation ${reservationId}`);
        return;
      }
      await this.emitInventoryUpdated(tx, emit, variantId);
    });
  }

  /** On payment failure / cancel: free the hold back to available stock. */
  async release(reservationId: string, variantId: string): Promise<void> {
    await this.outbox.withTransaction(async (tx, emit) => {
      await tx.execute(sql`SELECT release_reservation(${reservationId}::uuid)`);
      await this.emitInventoryUpdated(tx, emit, variantId);
    });
  }

  /**
   * Admin/vendor stock edit using OPTIMISTIC LOCKING.
   * The UPDATE only succeeds if `version` still matches what the client read,
   * preventing the lost-update problem when two dashboards edit at once.
   */
  async setStock(variantId: string, newStockQty: number, expectedVersion: number): Promise<void> {
    await this.outbox.withTransaction(async (tx, emit) => {
      const updated = await tx
        .update(schema.productVariants)
        .set({
          stockQty: newStockQty,
          version: sql`${schema.productVariants.version} + 1`,
        })
        .where(
          sql`${schema.productVariants.id} = ${variantId}
              AND ${schema.productVariants.version} = ${expectedVersion}`,
        )
        .returning({ id: schema.productVariants.id });

      if (updated.length === 0) {
        throw new ConflictException({
          code: 'STALE_VERSION',
          message: 'Stock was modified by someone else. Reload and retry.',
        });
      }
      await this.emitInventoryUpdated(tx, emit, variantId);
    });
  }

  /** Build and emit the canonical inventory.updated event from fresh row state. */
  private async emitInventoryUpdated(
    tx: DbTransaction,
    emit: <P>(input: {
      aggregate: 'inventory';
      aggregateId: string;
      eventType: typeof EVENT.INVENTORY_UPDATED;
      payload: P;
    }) => Promise<void>,
    variantId: string,
  ): Promise<void> {
    const [v] = await tx
      .select({
        id: schema.productVariants.id,
        productId: schema.productVariants.productId,
        stockQty: schema.productVariants.stockQty,
        reservedQty: schema.productVariants.reservedQty,
        version: schema.productVariants.version,
        vendorId: schema.products.vendorId,
      })
      .from(schema.productVariants)
      .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      .where(eq(schema.productVariants.id, variantId))
      .limit(1);

    if (!v) return;

    const payload: InventoryUpdatedPayload = {
      variantId: v.id,
      productId: v.productId,
      vendorId: v.vendorId,
      stockQty: v.stockQty,
      reservedQty: v.reservedQty,
      availableQty: v.stockQty - v.reservedQty,
      version: v.version,
    };

    await emit({
      aggregate: 'inventory',
      aggregateId: v.id,
      eventType: EVENT.INVENTORY_UPDATED,
      payload,
    });
  }
}
