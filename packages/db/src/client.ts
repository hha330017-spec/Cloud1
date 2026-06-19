import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** Transaction handle type — what you get inside db.transaction(async (tx) => ...). */
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

let pool: Pool | undefined;
let db: Database | undefined;

export function createPool(config?: PoolConfig): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    // Sensible production pool defaults; tune per pod count:
    max: Number(process.env.DB_POOL_MAX ?? 20),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Fail fast on broken statements rather than hanging the pool:
    statement_timeout: 15_000,
    ...config,
  });
}

/** Lazily-initialised singleton DB for non-DI contexts (scripts, workers). */
export function getDb(): Database {
  if (!db) {
    pool = createPool();
    db = drizzle(pool, { schema, casing: 'snake_case' });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

export { schema };
