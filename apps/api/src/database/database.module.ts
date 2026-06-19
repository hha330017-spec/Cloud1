import { Global, Module, type OnModuleDestroy, Inject } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema, type Database } from '@repo/db';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

/**
 * Global database module. Exposes:
 *   - PG_POOL: the raw pg Pool (for advisory locks / LISTEN-NOTIFY if needed)
 *   - DB: the Drizzle instance bound to the full schema
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () =>
        new Pool({
          connectionString: process.env.DATABASE_URL,
          max: Number(process.env.DB_POOL_MAX ?? 20),
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          statement_timeout: 15_000,
        }),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database =>
        drizzle(pool, { schema, casing: 'snake_case' }),
    },
  ],
  exports: [DB, PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
