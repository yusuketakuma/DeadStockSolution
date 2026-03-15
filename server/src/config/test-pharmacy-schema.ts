import { eq, sql, isNull, and } from 'drizzle-orm';
import { db } from './database';
import { pharmacies } from '../db/schema';
import { hashPassword } from '../services/auth-service';
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

/**
 * Fill test_account_password for existing test pharmacies where it is NULL.
 * Uses TEST_PHARMACY_SEED_JSON to look up the intended password by email.
 * Called once at startup after columns are ensured.
 */
export async function backfillTestPharmacyPasswords(): Promise<void> {
  const raw = process.env.TEST_PHARMACY_SEED_JSON?.trim();
  if (!raw) return;

  let parsed: { accounts?: Array<{ email?: string; password?: string }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed.accounts)) return;

  const emailToPassword = new Map<string, string>();
  for (const acc of parsed.accounts) {
    if (typeof acc.email === 'string' && typeof acc.password === 'string') {
      emailToPassword.set(acc.email.trim().toLowerCase(), acc.password);
    }
  }
  if (emailToPassword.size === 0) return;

  try {
    const nullRows = await db.select({ id: pharmacies.id, email: pharmacies.email })
      .from(pharmacies)
      .where(and(eq(pharmacies.isTestAccount, true), isNull(pharmacies.testAccountPassword)));

    for (const row of nullRows) {
      const plainPassword = emailToPassword.get(row.email.toLowerCase());
      if (!plainPassword) continue;
      const hashed = await hashPassword(plainPassword);
      await db.update(pharmacies)
        .set({ testAccountPassword: plainPassword, passwordHash: hashed })
        .where(eq(pharmacies.id, row.id));
      logger.info(`Backfilled test pharmacy password: ${row.email}`);
    }
  } catch (err) {
    logger.warn('backfillTestPharmacyPasswords skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
