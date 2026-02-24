import { eq, or } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { hashPassword } from './auth-service';

export type TestAccountKey = 'tokyo' | 'osaka';

interface TestAccountDefinition {
  key: TestAccountKey;
  email: string;
  password: string;
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

const TEST_ACCOUNTS: TestAccountDefinition[] = [
  {
    key: 'tokyo',
    email: 'test@example.com',
    password: 'test1234',
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
    key: 'osaka',
    email: 'test2@example.com',
    password: 'test1234',
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

export function getTestAccountByKey(key: string): TestAccountDefinition | null {
  return TEST_ACCOUNTS.find((account) => account.key === key) ?? null;
}

export function getAllTestAccounts(): TestAccountDefinition[] {
  return [...TEST_ACCOUNTS];
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
  const existing = await findExistingPharmacy(account);
  if (existing) {
    return existing;
  }

  const passwordHash = await hashPassword(account.password);
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
  const seededAccounts: EnsuredTestAccount[] = [];
  for (const account of TEST_ACCOUNTS) {
    seededAccounts.push(await ensureTestAccount(account));
  }
  return seededAccounts;
}
