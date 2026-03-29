import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from './schema';
import { hashPassword } from '../services/auth-service';
import { logger } from '../services/logger';
import { PLAYWRIGHT_SEED_ACCOUNTS, type PlaywrightSeedAccount } from './playwright-account-config';

function buildAccountValues(account: PlaywrightSeedAccount, passwordHash: string, timestamp: string) {
  return {
    email: account.email,
    passwordHash,
    name: account.name,
    postalCode: account.postalCode,
    address: account.address,
    phone: account.phone,
    fax: account.fax,
    licenseNumber: account.licenseNumber,
    prefecture: account.prefecture,
    latitude: account.latitude,
    longitude: account.longitude,
    isAdmin: account.mode === 'admin',
    isActive: true,
    isTestAccount: true,
    testAccountPassword: account.password,
    verificationStatus: 'verified',
    verifiedAt: timestamp,
    rejectionReason: null,
    updatedAt: timestamp,
  };
}

async function seedPlaywrightAccount(account: PlaywrightSeedAccount, timestamp: string): Promise<void> {
  const passwordHash = await hashPassword(account.password);
  const values = buildAccountValues(account, passwordHash, timestamp);

  const [existing] = await db.select({ id: pharmacies.id })
    .from(pharmacies)
    .where(eq(pharmacies.email, account.email))
    .limit(1);

  if (existing) {
    await db.update(pharmacies)
      .set(values)
      .where(eq(pharmacies.id, existing.id));
    logger.info(`Updated Playwright ${account.mode} account: ${account.email}`);
    return;
  }

  await db.insert(pharmacies).values(values);
  logger.info(`Created Playwright ${account.mode} account: ${account.email}`);
}

async function seedPlaywrightAccounts(): Promise<void> {
  const timestamp = new Date().toISOString();

  for (const account of PLAYWRIGHT_SEED_ACCOUNTS) {
    await seedPlaywrightAccount(account, timestamp);
  }
}

seedPlaywrightAccounts()
  .then(() => {
    logger.info('Playwright account seeding complete.');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('Playwright account seed failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
