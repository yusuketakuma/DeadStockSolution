import 'dotenv/config';
import { migrate } from 'drizzle-orm/vercel-postgres/migrator';
import { db } from '../config/database';
import { logger } from '../services/logger';
import { applyPerformanceScaleIndexes } from './performance-scale-indexes';

async function main() {
  logger.info('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  await applyPerformanceScaleIndexes();
  logger.info('Migrations complete.');
  process.exit(0);
}

main().catch((err) => {
  logger.error('Migration failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
