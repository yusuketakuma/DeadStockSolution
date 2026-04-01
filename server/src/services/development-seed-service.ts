import { resolveDatabaseUrls } from '../config/database-url';
import { seedPlaywrightAccounts } from '../db/playwright-account-seed-service';
import { resolveTestPharmacySeedPayload, seedTestPharmacyAccounts } from '../db/test-pharmacy-account-seed-service';
import { logger } from './logger';

const LOCAL_DB_HOSTS = new Set(['127.0.0.1', 'localhost']);

let seededOncePromise: Promise<void> | null = null;

function normalizeEnvValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function shouldAutoSeedDevelopmentAccounts(env: NodeJS.ProcessEnv = process.env): boolean {
  const autoSeed = normalizeEnvValue(env.AUTO_SEED_DEV_ACCOUNTS);
  if (autoSeed === '0' || autoSeed === 'false') {
    return false;
  }
  if (normalizeEnvValue(env.NODE_ENV) === 'production') {
    return false;
  }
  if (normalizeEnvValue(env.VERCEL_ENV)) {
    return false;
  }

  const { pooledUrl } = resolveDatabaseUrls(env);
  try {
    const parsed = new URL(pooledUrl);
    return (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:')
      && LOCAL_DB_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

async function seedDevelopmentAccounts(): Promise<void> {
  await seedPlaywrightAccounts();
  await seedTestPharmacyAccounts(resolveTestPharmacySeedPayload(process.env, { allowDefault: true }));
  logger.info('Development verification accounts are ready.');
}

export async function ensureDevelopmentSeedDataAtStartup(): Promise<void> {
  if (!shouldAutoSeedDevelopmentAccounts()) {
    return;
  }
  if (!seededOncePromise) {
    seededOncePromise = seedDevelopmentAccounts().catch((error) => {
      seededOncePromise = null;
      throw error;
    });
  }

  try {
    await seededOncePromise;
  } catch (error) {
    logger.warn('Development seed bootstrap failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
