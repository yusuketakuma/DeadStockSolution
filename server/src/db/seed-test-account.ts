import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from './schema';
import { hashPassword } from '../services/auth-service';

const TEST_ACCOUNTS = [
  {
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
    isAdmin: false,
  },
  {
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
    isAdmin: false,
  },
];

async function seed() {
  console.log('Seeding test accounts...');

  for (const account of TEST_ACCOUNTS) {
    const existing = await db.select({ id: pharmacies.id })
      .from(pharmacies)
      .where(eq(pharmacies.email, account.email))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  [skip] ${account.email} (already exists)`);
      continue;
    }

    const { password, ...rest } = account;
    const passwordHash = await hashPassword(password);

    await db.insert(pharmacies).values({
      ...rest,
      passwordHash,
    });

    console.log(`  [created] ${account.email} / ${password}`);
  }

  console.log('Done.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
