import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from './schema';
import { hashPassword } from '../services/auth-service';
import { logger } from '../services/logger';
import { eqEmailCaseInsensitive, normalizeEmail } from '../utils/email-utils';

const ADMIN_LOGIN_ID = normalizeEmail('admin@admin.com');
const LEGACY_ADMIN_LOGIN_ID = 'admin';
function requireAdminSeedPassword(): string {
  const password = process.env.ADMIN_SEED_PASSWORD?.trim();
  if (!password) {
    logger.error('ADMIN_SEED_PASSWORD is not set. Refusing to seed admin account without explicit password.');
    process.exit(1);
  }
  return password;
}
const ADMIN_PASSWORD = requireAdminSeedPassword();

async function findByEmail(email: string): Promise<{ id: number } | null> {
  const [row] = await db.select({
    id: pharmacies.id,
  })
    .from(pharmacies)
    .where(eqEmailCaseInsensitive(pharmacies.email, email))
    .limit(1);
  return row ?? null;
}

async function seedAdminAccount(): Promise<void> {
  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  const existing = await findByEmail(ADMIN_LOGIN_ID) ?? await findByEmail(LEGACY_ADMIN_LOGIN_ID);

  if (existing) {
    await db.update(pharmacies)
      .set({
        email: ADMIN_LOGIN_ID,
        passwordHash,
        isAdmin: true,
        isActive: true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(pharmacies.id, existing.id));

    logger.info(`Updated admin account: ${ADMIN_LOGIN_ID}`);
    return;
  }

  await db.insert(pharmacies).values({
    email: ADMIN_LOGIN_ID,
    passwordHash,
    name: '管理者',
    postalCode: '1000001',
    address: '東京都千代田区千代田1-1',
    phone: '03-0000-0000',
    fax: '03-0000-0001',
    licenseNumber: 'ADMIN-LOCAL-001',
    prefecture: '東京都',
    latitude: 35.6762,
    longitude: 139.6503,
    isAdmin: true,
    isActive: true,
  });

  logger.info(`Created admin account: ${ADMIN_LOGIN_ID}`);
}

seedAdminAccount()
  .then(() => {
    logger.info('Done.');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('Admin account seed failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
