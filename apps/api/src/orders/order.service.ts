import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Database, type DbTransaction } from '@repo/db';
import { EVENT, type OrderStatusChangedPayload } from '@repo/types';
import { DB } from '../database/database.module';
import { OutboxService } from '../outbox/outbox.service';
import {
  assertTransition,
  inventoryEffect,
  type OrderStatus,
} from './order-state-machine';

export interface TransitionInput {
  orderId: string;
  toStatus: OrderStatus;
  /** User who initiated the change; omit for system/webhook actions (null actor). */
  actorId?: string;
  reason?: string;
  /** When set (vendor caller), the order must belong to this vendor or 404. */
  vendorScopeId?: string;
}

/**
 * Order lifecycle service. The whole transition is ONE database transaction:
 *
 *   1. lock the order row (SELECT ... FOR UPDATE) so concurrent transitions
 *      serialise and can't double-apply,
 *   2. enforce vendor ownership (isolation),
 *   3. validate the transition against the state machine,
 *   4. UPDATE orders.status,
 *   5. INSERT order_status_history (the DB trigger re-validates),
 *   6. apply inventory side effects (commit/unwind reservations),
 *   7. emit order.status_changed into the outbox.
 *
 * If ANY step throws, the transaction rolls back entirely — status, history,
 * inventory, and the outbox event all revert together. There is no partial state.
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async transitionStatus(input: TransitionInput): Promise<{ status: OrderStatus }> {
    const { orderId, toStatus, actorId, reason, vendorScopeId } = input;

    return this.outbox.withTransaction(async (tx, emit) => {
      // 1) Lock the row for the duration of the transaction.
      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .for('update')
        .limit(1);

      if (!order) throw new NotFoundException('Order not found');

      // 2) Vendor isolation — non-owned order looks like it doesn't exist.
      if (vendorScopeId && order.vendorId !== vendorScopeId) {
        throw new NotFoundException('Order not found');
      }

      const from = order.status as OrderStatus;

      // 3) State-machine validation (throws 409 on illegal/no-op).
      assertTransition(from, toStatus);

      // 4) Update status.
      await tx
        .update(schema.orders)
        .set({ status: toStatus })
        .where(eq(schema.orders.id, orderId));

      // 5) Append immutable history (trigger assert_valid_order_transition fires).
      await tx.insert(schema.orderStatusHistory).values({
        orderId,
        fromStatus: from,
        toStatus,
        changedBy: actorId ?? null,
        reason: reason ?? null,
      });

      // 6) Inventory side effects, in the SAME transaction.
      const effect = inventoryEffect(from, toStatus);
      if (effect === 'commit') {
        await this.commitReservations(tx, orderId);
      } else if (effect === 'unwind') {
        await this.unwindReservations(tx, orderId);
      }

      // 7) Emit event (atomic with everything above via the outbox).
      const payload: OrderStatusChangedPayload = {
        orderId,
        orderNumber: order.orderNumber,
        userId: order.userId,
        vendorId: order.vendorId,
        fromStatus: from,
        toStatus,
      };
      await emit({
        aggregate: 'order',
        aggregateId: orderId,
        eventType: EVENT.ORDER_STATUS_CHANGED,
        payload,
      });

      this.logger.log(`order ${order.orderNumber}: ${from} -> ${toStatus}`);
      return { status: toStatus };
    });
  }

  /** Convert all still-held reservations for the order into real decrements. */
  private async commitReservations(tx: DbTransaction, orderId: string): Promise<void> {
    const held = await tx
      .select({ id: schema.stockReservations.id })
      .from(schema.stockReservations)
      .where(
        and(
          eq(schema.stockReservations.orderId, orderId),
          eq(schema.stockReservations.status, 'held'),
        ),
      );
    for (const r of held) {
      await tx.execute(sql`SELECT commit_reservation(${r.id}::uuid)`);
    }
  }

  /**
   * Give stock back on cancel/refund:
   *   - 'held'      reservations -> release (return reserved units to available)
   *   - 'committed' reservations -> restock (stock already decremented at 'paid')
   */
  private async unwindReservations(tx: DbTransaction, orderId: string): Promise<void> {
    const reservations = await tx
      .select({
        id: schema.stockReservations.id,
        variantId: schema.stockReservations.variantId,
        qty: schema.stockReservations.qty,
        status: schema.stockReservations.status,
      })
      .from(schema.stockReservations)
      .where(eq(schema.stockReservations.orderId, orderId));

    for (const r of reservations) {
      if (r.status === 'held') {
        await tx.execute(sql`SELECT release_reservation(${r.id}::uuid)`);
      } else if (r.status === 'committed') {
        // Restock: the units left inventory at 'paid'; add them back.
        await tx
          .update(schema.productVariants)
          .set({
            stockQty: sql`${schema.productVariants.stockQty} + ${r.qty}`,
            version: sql`${schema.productVariants.version} + 1`,
          })
          .where(eq(schema.productVariants.id, r.variantId));
        await tx
          .update(schema.stockReservations)
          .set({ status: 'released' })
          .where(eq(schema.stockReservations.id, r.id));
      }
    }
  }
}
