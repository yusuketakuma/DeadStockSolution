import { db } from '../config/database';
import { pharmacies } from './schema';
import { hashPassword } from '../services/auth-service';
import { logger } from '../services/logger';
import { DEFAULT_TEST_PHARMACY_SEED_PAYLOAD, type SeedPayload, type SeedTestPharmacyAccount } from './test-pharmacy-account-config';

const REQUIRED_STRING_KEYS = [
  'name',
  'email',
  'password',
  'postalCode',
  'address',
  'phone',
  'fax',
  'licenseNumber',
  'prefecture',
] as const;

function parseOptionalPositiveId(value: unknown, fieldPath: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${fieldPath} は正の整数で指定してください`);
  }
  return value as number;
}

function requireNonEmptyString(row: Record<string, unknown>, key: (typeof REQUIRED_STRING_KEYS)[number], index: number): string {
  const value = row[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`accounts[${index}].${key} は空でない文字列が必要です`);
  }
  return value;
}

function requireCoordinate(value: unknown, fieldPath: string): number {
  if (typeof value !== 'number') {
    throw new Error(`${fieldPath} は数値が必要です`);
  }
  return value;
}

function parseSeedAccount(item: unknown, index: number): SeedTestPharmacyAccount {
  if (!item || typeof item !== 'object') {
    throw new Error(`accounts[${index}] が不正です`);
  }

  const row = item as Record<string, unknown>;
  const id = parseOptionalPositiveId(row.id, `accounts[${index}].id`);

  for (const key of REQUIRED_STRING_KEYS) {
    requireNonEmptyString(row, key, index);
  }

  return {
    ...(id !== undefined ? { id } : {}),
    name: requireNonEmptyString(row, 'name', index).trim(),
    email: requireNonEmptyString(row, 'email', index).trim().toLowerCase(),
    password: requireNonEmptyString(row, 'password', index),
    postalCode: requireNonEmptyString(row, 'postalCode', index).replace(/[-ー－\s]/g, ''),
    address: requireNonEmptyString(row, 'address', index).trim(),
    phone: requireNonEmptyString(row, 'phone', index).trim(),
    fax: requireNonEmptyString(row, 'fax', index).trim(),
    licenseNumber: requireNonEmptyString(row, 'licenseNumber', index).trim(),
    prefecture: requireNonEmptyString(row, 'prefecture', index).trim(),
    latitude: requireCoordinate(row.latitude, `accounts[${index}].latitude`),
    longitude: requireCoordinate(row.longitude, `accounts[${index}].longitude`),
  };
}

function buildPharmacyUpsertValues(account: SeedTestPharmacyAccount, passwordHash: string, updatedAt: string) {
  return {
    ...(account.id !== undefined ? { id: account.id } : {}),
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
    isTestAccount: true,
    testAccountPassword: account.password,
    updatedAt,
  };
}

function normalizePayload(payload: SeedPayload): SeedPayload {
  const accounts = payload.accounts.map((account, index) => parseSeedAccount(account, index));
  if (accounts.length === 0) {
    throw new Error('accounts は1件以上必要です');
  }
  return { accounts };
}

export function parseSeedPayloadFromEnv(env: NodeJS.ProcessEnv = process.env): SeedPayload {
  const raw = env.TEST_PHARMACY_SEED_JSON;
  if (!raw || raw.trim().length === 0) {
    throw new Error('TEST_PHARMACY_SEED_JSON が未設定です');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `TEST_PHARMACY_SEED_JSON のJSON解析に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { accounts?: unknown }).accounts)) {
    throw new Error('TEST_PHARMACY_SEED_JSON は {"accounts":[...]} 形式で指定してください');
  }

  return normalizePayload(parsed as SeedPayload);
}

export function resolveTestPharmacySeedPayload(
  env: NodeJS.ProcessEnv = process.env,
  options: { allowDefault?: boolean } = {},
): SeedPayload {
  if (env.TEST_PHARMACY_SEED_JSON?.trim()) {
    return parseSeedPayloadFromEnv(env);
  }
  if (options.allowDefault) {
    return normalizePayload(DEFAULT_TEST_PHARMACY_SEED_PAYLOAD);
  }
  throw new Error('TEST_PHARMACY_SEED_JSON が未設定です');
}

export async function seedTestPharmacyAccounts(payload: SeedPayload): Promise<void> {
  const { accounts } = normalizePayload(payload);
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    for (const account of accounts) {
      const passwordHash = await hashPassword(account.password);
      const upsertValues = buildPharmacyUpsertValues(account, passwordHash, now);
      await tx.insert(pharmacies).values(upsertValues).onConflictDoUpdate({
        target: pharmacies.email,
        set: upsertValues,
      });

      logger.info(`Seeded test pharmacy account: ${account.email}`);
    }
  });
}

