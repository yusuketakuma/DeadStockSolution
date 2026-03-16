/**
 * 管理者アカウント作成スクリプト
 * 使用: cd server && npx tsx src/scripts/create-admin.ts
 */
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { hashPassword } from '../services/auth-service';
import { eq } from 'drizzle-orm';

const ADMIN_EMAIL = 'admin@admin.com';
const ADMIN_PASSWORD = 'admin1234';

async function createAdmin() {
  console.log('🔧 管理者アカウント作成中...');

  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  // 既存チェック
  const existing = await db.select({ id: pharmacies.id })
    .from(pharmacies)
    .where(eq(pharmacies.email, ADMIN_EMAIL))
    .limit(1);

  if (existing.length > 0) {
    console.log(`⚠️ ${ADMIN_EMAIL} は既に存在します (ID: ${existing[0].id})`);
    console.log('パスワード・管理者権限を更新します...');
    await db.update(pharmacies)
      .set({
        passwordHash,
        isAdmin: true,
        isActive: true,
        verificationStatus: 'verified',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(pharmacies.id, existing[0].id));
    console.log('✅ 更新完了');
    process.exit(0);
  }

  const [admin] = await db.insert(pharmacies).values({
    email: ADMIN_EMAIL,
    passwordHash,
    name: '管理者',
    postalCode: '100-0001',
    address: '東京都千代田区千代田1-1',
    phone: '03-0000-0000',
    fax: '03-0000-0001',
    licenseNumber: 'ADMIN-0001',
    prefecture: '東京都',
    isAdmin: true,
    isActive: true,
    isTestAccount: false,
    verificationStatus: 'verified',
  }).returning({ id: pharmacies.id });

  console.log(`✅ 管理者アカウント作成完了 (ID: ${admin.id})`);
  console.log(`   Email: ${ADMIN_EMAIL}`);
  console.log(`   Password: ${ADMIN_PASSWORD}`);
  console.log(`   isAdmin: true`);
  process.exit(0);
}

createAdmin().catch((err) => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
