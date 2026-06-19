import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb, closeDb } from './client';

/**
 * Applies all SQL migrations in ./drizzle in order.
 * Run via: pnpm --filter @repo/db migrate
 */
async function main(): Promise<void> {
  const db = getDb();
  // eslint-disable-next-line no-console
  console.log('[db] applying migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  // eslint-disable-next-line no-console
  console.log('[db] migrations complete');
  await closeDb();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[db] migration failed', err);
  process.exit(1);
});
