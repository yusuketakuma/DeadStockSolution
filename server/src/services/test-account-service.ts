import { eq, or } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { hashPassword } from './auth-service';
import { logger } from './logger';

interface TestAccountDefinition {
  email: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  prefecture: string;
  latitude: number;
  longitude: number;
}

interface EnsuredTestAccount {
  id: number;
  email: string;
  name: string;
  prefecture: string;
  isAdmin: boolean;
}

let ensureSeedPromise: Promise<void> | null = null;

const TEST_ACCOUNTS: TestAccountDefinition[] = [
  {
    email: 'test@example.com',
    name: 'テスト薬局',
    postalCode: '1000001',
    address: '東京都千代田区千代田1-1',
    phone: '03-1234-5678',
    fax: '03-1234-5679',
    licenseNumber: 'TEST-001',
    prefecture: '東京都',
    latitude: 35.6762,
    longitude: 139.6503,
  },
  {
    email: 'test2@example.com',
    name: 'テスト薬局2号店',
    postalCode: '5300001',
    address: '大阪府大阪市北区梅田1-1',
    phone: '06-1234-5678',
    fax: '06-1234-5679',
    licenseNumber: 'TEST-002',
    prefecture: '大阪府',
    latitude: 34.7024,
    longitude: 135.4959,
  },
];

export function getAllTestAccounts(): TestAccountDefinition[] {
  return [...TEST_ACCOUNTS];
}

function resolveTestAccountPassword(options: { strict: true }): string;
function resolveTestAccountPassword(options: { strict: false }): string | null;
function resolveTestAccountPassword(options: { strict: boolean }): string | null {
  const configured = process.env.TEST_ACCOUNT_PASSWORD?.trim();
  if (configured) {
    if (configured.length < 8) {
      throw new Error('TEST_ACCOUNT_PASSWORD must be at least 8 characters');
    }
    return configured;
  }

  if (options.strict) {
    throw new Error('TEST_ACCOUNT_PASSWORD is required');
  }

  return null;
}

async function findExistingPharmacy(account: TestAccountDefinition): Promise<EnsuredTestAccount | null> {
  const rows = await db.select({
    id: pharmacies.id,
    email: pharmacies.email,
    name: pharmacies.name,
    prefecture: pharmacies.prefecture,
    isAdmin: pharmacies.isAdmin,
  })
    .from(pharmacies)
    .where(or(
      eq(pharmacies.email, account.email),
      eq(pharmacies.licenseNumber, account.licenseNumber),
    ))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    prefecture: row.prefecture,
    isAdmin: row.isAdmin ?? false,
  };
}

export async function ensureTestAccount(account: TestAccountDefinition): Promise<EnsuredTestAccount> {
  const resolvedPassword = resolveTestAccountPassword({ strict: true });
  const passwordHash = await hashPassword(resolvedPassword);
  return upsertTestAccount(account, passwordHash);
}

async function upsertTestAccount(account: TestAccountDefinition, passwordHash: string): Promise<EnsuredTestAccount> {
  const existing = await findExistingPharmacy(account);
  if (existing) {
    await db.update(pharmacies)
      .set({
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
        isAdmin: false,
        isActive: true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(pharmacies.id, existing.id));

    return {
      id: existing.id,
      email: account.email,
      name: account.name,
      prefecture: account.prefecture,
      isAdmin: false,
    };
  }

  const [created] = await db.insert(pharmacies).values({
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
    isAdmin: false,
    isActive: true,
  }).returning({
    id: pharmacies.id,
    email: pharmacies.email,
    name: pharmacies.name,
    prefecture: pharmacies.prefecture,
    isAdmin: pharmacies.isAdmin,
  });

  return {
    id: created.id,
    email: created.email,
    name: created.name,
    prefecture: created.prefecture,
    isAdmin: created.isAdmin ?? false,
  };
}

export async function seedTestAccounts(): Promise<EnsuredTestAccount[]> {
  const resolvedPassword = resolveTestAccountPassword({ strict: true });
  const passwordHash = await hashPassword(resolvedPassword);

  const seededAccounts: EnsuredTestAccount[] = [];
  for (const account of TEST_ACCOUNTS) {
    seededAccounts.push(await upsertTestAccount(account, passwordHash));
  }
  return seededAccounts;
}

export function ensureTestAccountsSeededIfEnabled(): Promise<void> {
  const enabledByEnv = process.env.ENABLE_TEST_PHARMACY_ACCOUNTS;
  const shouldSeedInPreview = enabledByEnv === undefined && process.env.VERCEL_ENV === 'preview';
  if (enabledByEnv !== 'true' && !shouldSeedInPreview) {
    return Promise.resolve();
  }

  const resolvedPassword = resolveTestAccountPassword({ strict: false });
  if (!resolvedPassword) {
    logger.warn('Test pharmacy seed skipped: TEST_ACCOUNT_PASSWORD is not set');
    return Promise.resolve();
  }

  if (ensureSeedPromise) {
    return ensureSeedPromise;
  }

  ensureSeedPromise = seedTestAccounts()
    .then((accounts) => {
      logger.info('Test pharmacy accounts are ready', { count: accounts.length });
    })
    .catch((err) => {
      logger.error('Failed to seed test pharmacy accounts', {
        error: err instanceof Error ? err.message : String(err),
      });
      ensureSeedPromise = null;
    });

  return ensureSeedPromise;
}
