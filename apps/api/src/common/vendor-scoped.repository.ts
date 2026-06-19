import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, desc, type SQL } from 'drizzle-orm';
import { schema, type Database } from '@repo/db';
import { DB } from '../database/database.module';

/**
 * Vendor isolation — Layer 2 (database abstraction rule).
 *
 * Every method here ALWAYS folds `vendor_id = :scope` into the WHERE clause, so
 * even if a controller forgets a check or an id is attacker-controlled, a vendor
 * physically cannot read or mutate another vendor's rows. Reads for a non-owned
 * id return 404 (not 403) to avoid leaking existence.
 *
 * Pair with VendorGuard (Layer 1) which resolves the trusted scope id.
 */
@Injectable()
export class VendorScopedRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  // ---------------- Products ----------------

  listProducts(vendorId: string, extra?: SQL) {
    return this.db
      .select()
      .from(schema.products)
      .where(extra ? and(eq(schema.products.vendorId, vendorId), extra) : eq(schema.products.vendorId, vendorId))
      .orderBy(desc(schema.products.createdAt));
  }

  async getProductOrThrow(vendorId: string, productId: string) {
    const [row] = await this.db
      .select()
      .from(schema.products)
      .where(and(eq(schema.products.id, productId), eq(schema.products.vendorId, vendorId)))
      .limit(1);
    if (!row) throw new NotFoundException('Product not found');
    return row;
  }

  async updateProduct(
    vendorId: string,
    productId: string,
    patch: Partial<typeof schema.products.$inferInsert>,
  ) {
    const updated = await this.db
      .update(schema.products)
      .set(patch)
      // scope is part of the predicate -> cross-vendor update is impossible
      .where(and(eq(schema.products.id, productId), eq(schema.products.vendorId, vendorId)))
      .returning({ id: schema.products.id });
    if (updated.length === 0) throw new NotFoundException('Product not found');
    return updated[0]!;
  }

  async deleteProduct(vendorId: string, productId: string) {
    const deleted = await this.db
      .delete(schema.products)
      .where(and(eq(schema.products.id, productId), eq(schema.products.vendorId, vendorId)))
      .returning({ id: schema.products.id });
    if (deleted.length === 0) throw new NotFoundException('Product not found');
    return deleted[0]!;
  }

  // ---------------- Orders ----------------

  listOrders(vendorId: string, status?: typeof schema.orders.$inferSelect.status) {
    const where = status
      ? and(eq(schema.orders.vendorId, vendorId), eq(schema.orders.status, status))
      : eq(schema.orders.vendorId, vendorId);
    return this.db
      .select()
      .from(schema.orders)
      .where(where)
      .orderBy(desc(schema.orders.createdAt));
  }

  async getOrderOrThrow(vendorId: string, orderId: string) {
    const [row] = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.vendorId, vendorId)))
      .limit(1);
    if (!row) throw new NotFoundException('Order not found');
    return row;
  }

  /**
   * Ownership assertion usable inside a transaction or before a mutation.
   * Returns the order row locked-or-not depending on caller needs.
   */
  async assertOrderOwned(vendorId: string, orderId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.vendorId, vendorId)))
      .limit(1);
    if (!row) throw new NotFoundException('Order not found');
  }
}
