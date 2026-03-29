# Playwright ローカル監査プロンプト: login / dashboard / admin dashboard

## 対象
- App URL: `http://127.0.0.1:5173`
- API URL: `http://127.0.0.1:3101`
- Frontend root: `client`
- Backend root: `server`
- Auth / test account:
  - user: `playwright-user@example.com / PlaywrightUser!2026`
  - admin: `playwright-admin@example.com / PlaywrightAdmin!2026`
- Priority user flows:
  - user login -> dashboard 初期表示
  - admin login -> admin dashboard 初期表示
  - admin dashboard 上の OpenClaw degraded 表示
- Known pain points:
  - hydration 不良を待機で隠さない
  - console error / page error / failed request はプロダクト問題候補として扱う
  - OpenClaw 未設定時の degraded は page-level generic error にしない
- Out of scope:
  - 提案作成・承認・完了など destructive flow
  - 外部 SaaS 依存の深い監査
  - preview / production URL の監査
- Preferred language for report: 日本語
- Run context: Codex CLI 非対話。GUI が使えない場合は headless / trace / report / screenshot で代替。

## ローカル DB 安全ルール
- `server/.env` の `POSTGRES_URL` をそのまま使わないこと。preview / remote DB を踏む危険がある。
- 監査時の DB は disposable local Postgres に限定すること。
- 既定の実行コマンドは `npm run test:e2e:local-login-dashboard` とし、この wrapper が一時 DB 作成、`db:push`、seed、server/client 起動、Playwright 実行、cleanup を担う。
- `db:migrate` clean-db smoke は現状 repo の historical migration chain 問題を再現して落ちるため、通常の local audit では wrapper 既定で無効にする。再現確認が必要な場合だけ `RUN_MIGRATION_SMOKE=1 npm run test:e2e:local-login-dashboard` を使うこと。
- ローカル Postgres が `127.0.0.1:5432` 以外にいる場合だけ `LOCAL_POSTGRES_ADMIN_URL=postgres://...@127.0.0.1:<port>/postgres` を明示して wrapper に渡すこと。
- `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` を既存 shell から引き継いで remote DB に接続しないこと。

## 必須方針
- `npx playwright --help` を source of truth にすること。
- 既存の `playwright.config.*` と repo の test 規約を尊重すること。
- role / text / test id locator を優先し、manual wait を使わないこと。
- codegen は locator 偵察に限定し、生成コードをそのまま commit しないこと。
- hydration 不良はテスト都合ではなく UX 欠陥として扱うこと。
- `console error` `page error` `network failure` は必ず記録すること。
- 問題発見で止まらず、修正可能なら最小修正と proof test まで行うこと。

## 開始直後に短く出力
1. 理解した前提
2. 監査計画
3. 実行予定コマンド
4. 主なリスク

## 実施範囲

### Phase 0. Capability discovery
以下だけ確認すること。
- package manager
- Node / Playwright / `@playwright/test` version
- `npx playwright --help`
- 既存 `playwright.config.*`
- `npx playwright test --list` で対象棚卸し

### Phase 1. 軽量コード理解
以下だけ読むこと。
- login 関連 E2E fixture / spec
- dashboard / admin dashboard ページ
- auth / API client の最小限

### Phase 2. ローカル監査
必ず以下を実施すること。
- 一般ユーザー login -> dashboard
- 管理者 login -> admin dashboard
- console/page/network の異常採取
- 必要なら trace / screenshot 保存
- admin dashboard の OpenClaw degraded 表示が generic error になっていないか確認
- 可能なら `npm run test:e2e:local-login-dashboard` を使い、手動起動より wrapper を優先すること

### Phase 3. テスト/修正
- 高優先の不具合があれば最小修正
- proof test 追加または更新
- 変更範囲の test / lint / typecheck / build を relevant に実行

## 成果物
必ず以下を更新または作成すること。
- `audits/playwright-audit-report.md`
- `audits/codex-final.md`
- `artifacts/playwright-audit/screenshots/`
- `artifacts/playwright-audit/traces/`
- `artifacts/playwright-audit/reports/html/`
- `artifacts/playwright-audit/reports/json/`

## レポート要件
`audits/playwright-audit-report.md` には最低限以下を含めること。
1. 実行概要
2. 実際に使えた Playwright CLI capabilities
3. 対象フロー
4. 発見事項
5. 再現手順
6. 証拠パス
7. 修正内容
8. 追加/更新テスト
9. 未解決事項
10. 次の一手

## 完了時の最後の出力
1. 実施したこと
2. 直したこと
3. まだ危ないこと
4. 追加したテスト
5. 保存した成果物の場所
6. 次の一手
