import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { Database } from '@repo/db';
import { DB } from '../database/database.module';

/**
 * Releases expired stock holds so abandoned checkouts don't strand inventory.
 * Calls the batched sweep_expired_reservations() function (FOR UPDATE SKIP
 * LOCKED inside), so it's safe to run on every replica without contention.
 *
 * Edge case covered: user adds the last item to cart, opens payment, then closes
 * the app. The hold's expires_at (default 15 min) lapses; the next sweep frees
 * the unit back to available so other buyers aren't blocked indefinitely.
 */
@Injectable()
export class ReservationSweeperService {
  private readonly logger = new Logger(ReservationSweeperService.name);
  private running = false;

  constructor(@Inject(DB) private readonly db: Database) {}

  @Interval('reservation-sweeper', 30_000)
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const res = await this.db.execute<{ sweep_expired_reservations: number }>(
        sql`SELECT sweep_expired_reservations(500)`,
      );
      const released = res.rows?.[0]?.sweep_expired_reservations ?? 0;
      if (released > 0) this.logger.log(`released ${released} expired reservations`);
    } catch (err) {
      this.logger.error('reservation sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
