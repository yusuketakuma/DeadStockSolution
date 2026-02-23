# DeadStockSolution

## Vercel Postgres移行手順

1. `server/.env` に `POSTGRES_URL`（必要なら `POSTGRES_URL_NON_POOLING`）を設定
2. スキーマを作成

```powershell
npm run db:migrate --workspace=server
```

3. 既存SQLite/Tursoデータを移行（任意）

```bash
# 既存DBがTursoの場合
$env:LEGACY_DATABASE_URL="libsql://xxxx.turso.io"
$env:LEGACY_AUTH_TOKEN="xxxxx"

# 既存DBがローカルSQLiteの場合（どちらか）
$env:LEGACY_SQLITE_PATH="./local.db"
# または server/local.db を自動検出

npm run db:migrate:legacy --workspace=server
```

`LEGACY_MIGRATION_MODE=replace` を設定すると、移行前にPostgres側テーブルを初期化します（既定は `append`）。
