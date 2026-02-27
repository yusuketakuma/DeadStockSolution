import 'dotenv/config';
import { db } from '../config/database';
import { pharmacies } from './schema';
import { hashPassword } from '../services/auth-service';
import { logger } from '../services/logger';

interface SeedTestPharmacyAccount {
  id?: number;
  name: string;
  email: string;
  password: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  prefecture: string;
  latitude: number;
  longitude: number;
}

interface SeedPayload {
  accounts: SeedTestPharmacyAccount[];
}

function parseSeedPayloadFromEnv(): SeedPayload {
  const raw = process.env.TEST_PHARMACY_SEED_JSON;
  if (!raw || raw.trim().length === 0) {
    throw new Error('TEST_PHARMACY_SEED_JSON が未設定です');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`TEST_PHARMACY_SEED_JSON のJSON解析に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { accounts?: unknown }).accounts)) {
    throw new Error('TEST_PHARMACY_SEED_JSON は {"accounts":[...]} 形式で指定してください');
  }

  const accounts = (parsed as { accounts: unknown[] }).accounts.map((item, index): SeedTestPharmacyAccount => {
    if (!item || typeof item !== 'object') {
      throw new Error(`accounts[${index}] が不正です`);
    }
    const row = item as Record<string, unknown>;
    const id = row.id;
    if (id !== undefined && (!Number.isInteger(id) || (id as number) <= 0)) {
      throw new Error(`accounts[${index}].id は正の整数で指定してください`);
    }

    const requiredStringKeys = [
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

    for (const key of requiredStringKeys) {
      if (typeof row[key] !== 'string' || row[key]!.trim().length === 0) {
        throw new Error(`accounts[${index}].${key} は空でない文字列が必要です`);
      }
    }

    if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') {
      throw new Error(`accounts[${index}].latitude / longitude は数値が必要です`);
    }

    return {
      ...(id !== undefined ? { id: id as number } : {}),
      name: String(row.name).trim(),
      email: String(row.email).trim().toLowerCase(),
      password: String(row.password),
      postalCode: String(row.postalCode).replace(/[-ー－\s]/g, ''),
      address: String(row.address).trim(),
      phone: String(row.phone).trim(),
      fax: String(row.fax).trim(),
      licenseNumber: String(row.licenseNumber).trim(),
      prefecture: String(row.prefecture).trim(),
      latitude: row.latitude as number,
      longitude: row.longitude as number,
    };
  });

  if (accounts.length === 0) {
    throw new Error('accounts は1件以上必要です');
  }

  return { accounts };
}

async function seedTestPharmacyAccounts(): Promise<void> {
  const { accounts } = parseSeedPayloadFromEnv();
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    for (const account of accounts) {
      const passwordHash = await hashPassword(account.password);
      await tx.insert(pharmacies).values({
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
        updatedAt: now,
      }).onConflictDoUpdate({
        target: pharmacies.email,
        set: {
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
          updatedAt: now,
        },
      });

      logger.info(`Seeded test pharmacy account: ${account.email}`);
    }
  });
}

seedTestPharmacyAccounts()
  .then(() => {
    logger.info('Test pharmacy account seeding complete.');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('Test pharmacy account seed failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
