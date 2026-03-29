# Playwright Audit Report

## 1. 実行概要
- 対象: ローカル `http://127.0.0.1:5173` / API `http://127.0.0.1:3101`
- スコープ:
  - 一般ユーザー login -> dashboard 初期表示
  - 管理者 login -> admin dashboard 初期表示
  - admin dashboard 上の OpenClaw degraded 表示
- 実施日: 2026-03-29 16:41 JST
- 実施内容:
  - Playwright CLI / config / 既存 suite の棚卸し
  - 一時 Postgres DB を作成して `db:push` / Playwright seed / test pharmacy seed を実行
  - server/client をローカル起動
  - login smoke 2件 + dashboard runtime audit 2件を実行
  - HTML report / JSON report / screenshot / trace を更新

## 2. 実際に使えた Playwright CLI capabilities
- バージョン:
  - Node `v24.14.1`
  - npm `11.11.0`
  - `@playwright/test` / Playwright `1.58.2`
- `npx playwright --help` で確認した主要コマンド:
  - `test`
  - `codegen`
  - `show-report`
  - `show-trace`
  - `merge-reports`
  - `clear-cache`
- `npx playwright test --help` で確認した主要オプション:
  - `--project`
  - `--workers`
  - `--list`
  - `--trace`
  - `--output`
  - `--reporter`
  - `--debug`
  - `--headed`
  - `--last-failed`
- 今回実際に使ったもの:
  - `npx playwright test --list`
  - `npx playwright test ... --project chromium --workers=1`
  - `npx playwright test ... --trace on --output ... --reporter=list,html`
  - `npx playwright test ... --reporter=json`

## 3. 対象フロー
- user:
  - `GET /api/auth/test-pharmacies?includePassword=1&mode=user`
  - `POST /api/auth/login`
  - `/` へ遷移し、`ダッシュボード` 見出しと welcome 表示を確認
- admin:
  - `GET /api/auth/test-pharmacies?includePassword=1&mode=admin`
  - `POST /api/auth/login`
  - `/admin` へ遷移し、`管理者ダッシュボード` / `OpenClaw連携` / `OpenClaw / DDS 状態` を確認
- runtime audit:
  - console error
  - page error
  - failed response (`document` / `fetch` / `xhr`)
  - admin dashboard で generic error `一部のデータの取得に失敗しました` が出ていないこと

## 4. 発見事項
- Product defect は今回のスコープでは検出されませんでした。
- 4件すべて pass し、runtime audit でも console error / page error / failed response は 0 件でした。
- 運用上のリスクは残っています。
  - `server/.env` は preview 向け設定を含んでいるため、そのまま local audit を実行すると preview DB に触れる危険があります。
  - 今回は shell 側で `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` / `PORT` / `CORS_ORIGINS` / `VERCEL_ENV` を上書きして回避しました。

## 5. 再現手順
1. ローカル Postgres 上に一時 DB を作る
2. 以下の env を shell 側で上書きする
   - `POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:5432/<temp-db>`
   - `POSTGRES_URL_NON_POOLING=$POSTGRES_URL`
   - `JWT_SECRET=deadstock-playwright-audit-jwt-secret-2026`
   - `PORT=3101`
   - `CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173`
   - `VERCEL_ENV=`
3. `npm run db:push --workspace=server`
4. `npm run db:seed-playwright-accounts --workspace=server`
5. `npm run db:seed-test-pharmacies --workspace=server`
6. server を `3101`、client を `5173` で起動する
7. `E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/tests/login-smoke.spec.ts e2e/tests/dashboard-runtime-audit.spec.ts --project chromium --workers=1 --trace on --output artifacts/playwright-audit/test-results --reporter=list,html`
8. JSON report が必要なら同じ対象を `--reporter=json` で再実行する

## 6. 証拠パス
- screenshot:
  - [runtime-user-dashboard.png](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/screenshots/runtime-user-dashboard.png)
  - [runtime-admin-dashboard.png](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/screenshots/runtime-admin-dashboard.png)
- HTML report:
  - [index.html](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/reports/html/index.html)
- JSON report:
  - [login-dashboard-audit.json](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/reports/json/login-dashboard-audit.json)
- trace:
  - [user-runtime-trace](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/traces/dashboard-runtime-audit-da-6e64e-board-%E5%88%9D%E6%9C%9F%E8%A1%A8%E7%A4%BA%E3%81%A7-runtime-%E7%95%B0%E5%B8%B8%E3%82%92%E5%87%BA%E3%81%95%E3%81%AA%E3%81%84-chromium-trace.zip)
  - [admin-runtime-trace](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/traces/dashboard-runtime-audit-da-edcaa-%E5%AE%B9%E3%81%97%E3%81%A4%E3%81%A4-page-level-error-%E3%82%92%E5%87%BA%E3%81%95%E3%81%AA%E3%81%84-chromium-trace.zip)
  - [user-login-trace](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/traces/login-smoke-%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3-smoke-%E4%B8%80%E8%88%AC%E3%83%A6%E3%83%BC%E3%82%B6%E3%83%BC%E3%81%8C%E3%83%80%E3%83%83%E3%82%B7%E3%83%A5%E3%83%9C%E3%83%BC%E3%83%89%E3%81%B8%E5%88%B0%E9%81%94%E3%81%A7%E3%81%8D%E3%82%8B-chromium-trace.zip)
  - [admin-login-trace](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/traces/login-smoke-%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3-smoke-%E7%AE%A1%E7%90%86%E8%80%85%E3%81%8C%E7%AE%A1%E7%90%86%E8%80%85%E3%83%80%E3%83%83%E3%82%B7%E3%83%A5%E3%83%9C%E3%83%BC%E3%83%89%E3%81%B8%E5%88%B0%E9%81%94%E3%81%A7%E3%81%8D%E3%82%8B-chromium-trace.zip)

## 7. 修正内容
- なし。今回の対象フローでは修正が必要な不具合は再現しませんでした。

## 8. 追加/更新テスト
- なし。既存の Playwright suite を実行して監査しました。
- 実行した spec:
  - [e2e/tests/login-smoke.spec.ts](/Users/yusuke/workspace/DeadStockSolution/e2e/tests/login-smoke.spec.ts)
  - [e2e/tests/dashboard-runtime-audit.spec.ts](/Users/yusuke/workspace/DeadStockSolution/e2e/tests/dashboard-runtime-audit.spec.ts)

## 9. 未解決事項
- ローカル監査の安全性が shell 上書きに依存しています。
- repo 既定の `server/.env` が preview 系設定を含む点は、そのままでは人為ミスを誘発します。
- 今回は scoped prompt のうち destructive な proposal flow を intentionally 未実施にしました。

## 10. 次の一手
1. Playwright local audit 用の専用 env ファイルか wrapper script を追加し、preview DB 誤接続を防ぐ
2. `PROMPT_PLAYWRIGHT_AUDIT_LOCAL_LOGIN_DASHBOARD.md` に「必ず local DB を明示 override する」手順を固定で追記する
3. 次の監査では `proposal-flow.spec.ts` を同じ一時 DB 戦略で実行し、destructive flow まで確認する

## 実行コマンド
```bash
npx playwright --help
npx playwright test --help
npx playwright test --list

npm run db:push --workspace=server
npm run db:seed-playwright-accounts --workspace=server
npm run db:seed-test-pharmacies --workspace=server

npm run dev --workspace=server
npm run dev --workspace=client -- --host 127.0.0.1 --port 5173

E2E_BASE_URL='http://127.0.0.1:5173' \
PLAYWRIGHT_HTML_OUTPUT_DIR='artifacts/playwright-audit/reports/html' \
PLAYWRIGHT_HTML_OPEN='never' \
npx playwright test e2e/tests/login-smoke.spec.ts e2e/tests/dashboard-runtime-audit.spec.ts \
  --project chromium \
  --workers=1 \
  --trace on \
  --output artifacts/playwright-audit/test-results \
  --reporter=list,html

E2E_BASE_URL='http://127.0.0.1:5173' \
npx playwright test e2e/tests/login-smoke.spec.ts e2e/tests/dashboard-runtime-audit.spec.ts \
  --project chromium \
  --workers=1 \
  --trace on \
  --output artifacts/playwright-audit/test-results \
  --reporter=json \
  > artifacts/playwright-audit/reports/json/login-dashboard-audit.json
```

## 実行結果
- `npx playwright test --list`: 7 tests in 3 files
- login/dashboard 対象の実行結果: 4 passed / 0 failed / 0 flaky / duration 4.69s
