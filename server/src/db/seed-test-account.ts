import 'dotenv/config';
import { ensureTestAccount, getAllTestAccounts } from '../services/test-account-service';
import { logger } from '../services/logger';

async function seed() {
  logger.info('Seeding test accounts...');

  for (const account of getAllTestAccounts()) {
    const user = await ensureTestAccount(account);
    logger.info(`  [ok] ${user.email}`);
  }

  logger.info('Done.');
  process.exit(0);
}

seed().catch((err) => {
  logger.error('Seed failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
