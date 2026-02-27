import 'dotenv/config';
import { and, inArray, not, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from './schema';
import { hashPassword } from '../services/auth-service';
import { logger } from '../services/logger';
import { TEST_PHARMACY_DEMO_ACCOUNTS } from '../config/test-pharmacy-demo-accounts';

async function seedTestPharmacyAccounts(): Promise<void> {
  const now = new Date().toISOString();
  const targetEmails = TEST_PHARMACY_DEMO_ACCOUNTS.map((account) => account.email);
  const targetNames = TEST_PHARMACY_DEMO_ACCOUNTS.map((account) => account.name);

  const [nonDemoCountRow] = await db.select({
    count: sql<number>`count(*)`,
  })
    .from(pharmacies)
    .where(
      and(
        not(inArray(pharmacies.email, targetEmails)),
        not(inArray(pharmacies.name, targetNames)),
      ),
    );

  const nonDemoCount = Number(nonDemoCountRow?.count ?? 0);
  if (nonDemoCount > 0) {
    throw new Error(`非デモ薬局が ${nonDemoCount} 件存在するため、ID再採番を中断しました`);
  }

  const passwordHashes = new Map<string, string>();
  for (const account of TEST_PHARMACY_DEMO_ACCOUNTS) {
    passwordHashes.set(account.email, await hashPassword(account.password));
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE pharmacies RESTART IDENTITY CASCADE`);

    for (const account of TEST_PHARMACY_DEMO_ACCOUNTS) {
      const passwordHash = passwordHashes.get(account.email);
      if (!passwordHash) {
        throw new Error(`パスワードハッシュ生成に失敗しました: ${account.email}`);
      }

      await tx.insert(pharmacies).values({
        id: account.id,
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
        updatedAt: now,
      });

      logger.info(`Seeded test pharmacy account: ${account.email} (ID ${account.id})`);
    }

    await tx.execute(sql`
      SELECT setval(
        pg_get_serial_sequence('pharmacies', 'id'),
        (SELECT COALESCE(MAX(id), 1) FROM pharmacies),
        true
      )
    `);
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
