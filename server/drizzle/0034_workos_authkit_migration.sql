-- WorkOS AuthKit 移行: pharmacies テーブルに workos_user_id 追加 + password_hash を nullable 化

-- 1. workos_user_id カラム追加（nullable, unique）
ALTER TABLE "pharmacies" ADD COLUMN "workos_user_id" text;
CREATE UNIQUE INDEX "pharmacies_workos_user_id_unique" ON "pharmacies" USING btree ("workos_user_id");

-- 2. password_hash を nullable に変更（WorkOS ユーザーはパスワードハッシュ不要）
ALTER TABLE "pharmacies" ALTER COLUMN "password_hash" DROP NOT NULL;
