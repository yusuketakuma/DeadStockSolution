/**
 * 既存ユーザーを WorkOS に一括移行するスクリプト
 *
 * 処理:
 * 1. pharmacies テーブルから workosUserId が未設定のユーザーを取得
 * 2. WorkOS User Management API でユーザー作成（email_verified: true）
 * 3. pharmacies.workosUserId を更新
 * 4. 全ユーザーにパスワードリセットを作成（WorkOS 経由）
 *
 * 実行: cd server && npx tsx src/scripts/migrate-users-to-workos.ts
 *
 * 環境変数:
 *   WORKOS_API_KEY — 必須
 *   DATABASE_URL — 必須
 *   DRY_RUN=true — ドライランモード（DB/API変更なし）
 */
import 'dotenv/config';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { isNull } from 'drizzle-orm';
import { createWorkosUser, createPasswordReset, linkWorkosUserToPharmacy } from '../services/workos-service';

const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_DELAY_MS = 500; // WorkOS API レート制限対策

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`=== WorkOS ユーザー移行スクリプト ===`);
  console.log(`モード: ${DRY_RUN ? 'ドライラン（変更なし）' : '本番実行'}`);
  console.log('');

  // 1. 未移行ユーザーの取得
  const unmigrated = await db.select({
    id: pharmacies.id,
    email: pharmacies.email,
    name: pharmacies.name,
    isTestAccount: pharmacies.isTestAccount,
  })
    .from(pharmacies)
    .where(isNull(pharmacies.workosUserId));

  console.log(`未移行ユーザー: ${unmigrated.length} 件`);
  if (unmigrated.length === 0) {
    console.log('全ユーザー移行済みです。');
    return;
  }

  let successCount = 0;
  const skipCount = 0;
  let errorCount = 0;
  const errors: Array<{ id: number; email: string; error: string }> = [];

  for (const user of unmigrated) {
    try {
      console.log(`[${user.id}] ${user.email} (${user.name})...`);

      if (DRY_RUN) {
        console.log(`  → [ドライラン] スキップ`);
        successCount++;
        continue;
      }

      // 2. WorkOS ユーザー作成
      // パスワードは一時的なランダム値（ユーザーにはリセットメールを送る）
      const tempPassword = generateTempPassword();
      const workosUserId = await createWorkosUser(user.email, user.name, tempPassword);
      console.log(`  → WorkOS ユーザー作成: ${workosUserId}`);

      // 3. DB更新
      await linkWorkosUserToPharmacy(user.id, workosUserId);
      console.log(`  → DB 更新完了`);

      // 4. パスワードリセット作成
      try {
        await createPasswordReset(user.email);
        console.log(`  → パスワードリセット作成完了`);
      } catch (resetErr) {
        console.warn(`  → パスワードリセット作成失敗（ユーザー作成は成功）: ${resetErr instanceof Error ? resetErr.message : String(resetErr)}`);
      }

      successCount++;
      await sleep(BATCH_DELAY_MS);
    } catch (err) {
      errorCount++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      errors.push({ id: user.id, email: user.email, error: errorMessage });
      console.error(`  → エラー: ${errorMessage}`);
    }
  }

  console.log('');
  console.log('=== 結果 ===');
  console.log(`成功: ${successCount}`);
  console.log(`スキップ: ${skipCount}`);
  console.log(`エラー: ${errorCount}`);

  if (errors.length > 0) {
    console.log('');
    console.log('エラー詳細:');
    for (const e of errors) {
      console.log(`  [${e.id}] ${e.email}: ${e.error}`);
    }
  }
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let password = '';
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  for (const byte of array) {
    password += chars[byte % chars.length];
  }
  return password;
}

main().then(() => {
  console.log('完了');
  process.exit(0);
}).catch((err) => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
