import { sql } from 'drizzle-orm';
import { db } from './database';
import { logger } from '../services/logger';

let ensureColumnsPromise: Promise<boolean> | null = null;
let testPharmacyColumnsEnsured = false;

export function ensureTestPharmacyColumnsAtStartup(): Promise<boolean> {
  if (testPharmacyColumnsEnsured) {
    return Promise.resolve(true);
  }

  if (ensureColumnsPromise) {
    return ensureColumnsPromise;
  }

  ensureColumnsPromise = (async () => {
    try {
      await db.execute(sql`ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "is_test_account" boolean DEFAULT false NOT NULL`);
      await db.execute(sql`ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "test_account_password" text`);
      testPharmacyColumnsEnsured = true;
      logger.info('Test pharmacy columns ensured at startup');
      return true;
    } catch (err) {
      logger.warn('Test pharmacy column ensure skipped at startup', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      ensureColumnsPromise = null;
    }
  })();

  return ensureColumnsPromise;
}
