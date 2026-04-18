# Playwright Audit Report

## 1. 実行概要
- 対象:
  - Frontend `http://127.0.0.1:5173`
  - API `http://127.0.0.1:3101`
- 実施日:
  - login/dashboard audit: 2026-03-29 17:51 JST
  - proposal-flow audit: 2026-03-29 17:51 JST
- 実施内容:
  - Playwright CLI / config / suite をローカル実体で棚卸し
  - disposable local Postgres を一時生成し、`db:push` / seed / server / client / Playwright 実行 / cleanup まで wrapper 化
  - `login-smoke.spec.ts` 2件、`dashboard-runtime-audit.spec.ts` 2件、`proposal-flow.spec.ts` 3件を実行
  - HTML report / JSON report / screenshot / trace を `artifacts/playwright-audit/` に保存
- 集計:
  - 7 passed / 0 failed / 0 flaky / 0 skipped

## 2. 実際に使えた Playwright CLI capabilities
- バージョン:
  - Node `v24.14.1`
  - npm `11.11.0`
  - Playwright / `@playwright/test` `1.58.2`
- `npx playwright --help` で確認:
  - `test`
  - `codegen`
  - `show-report`
  - `show-trace`
  - `merge-reports`
  - `clear-cache`
- `npx playwright test --help` で確認:
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
  - `npx playwright test ... --project chromium --workers=1 --trace on --output ... --reporter=list,html,json`
  - `PLAYWRIGHT_HTML_OUTPUT_DIR`
  - `PLAYWRIGHT_JSON_OUTPUT_FILE`

## 3. 対象フロー
- login/dashboard:
  - 一般ユーザー login -> dashboard 初期表示
  - 管理者 login -> admin dashboard 初期表示
  - admin dashboard 上の OpenClaw degraded 表示確認
  - console error / page error / failed response 採取
- proposal-flow:
  - seed -> 提案作成 -> 相互承認 -> 完了
  - 提案拒否
  - 在庫減少後の完了失敗

## 4. 発見事項
- product defect は今回の 7 ケースでは再現しませんでした。
- login/dashboard runtime audit では console error / page error / failed response は 0 件でした。
- proposal-flow は isolated local DB 上で 3 ケースとも通過しました。
- 実装側の E2E 補助ルートには不整合がありました。
  - `server/src/routes/internal-e2e-proposal-flow.ts` の seed 取得が admin test account を含んでおり、Playwright fixture の `mode=user` と index 対応がずれていました。
  - その結果、`counterpartyIndex=1` が admin を指すケースがあり、reject / accept が 404 になる false negative を起こしていました。
  - `isAdmin = false` で絞るよう修正し、fixture と seed の母集団を一致させました。
- 運用上の既知リスクは残っています。
  - `server/.env` は preview 系設定を含むため、wrapper なしのローカル監査は危険です。
  - clean DB に対する `db:migrate` は現状 repo の migration chain 不整合で失敗します。
  - 具体的には `server/drizzle/0019_upload_confirm_jobs.sql` と `server/drizzle/0021_clean_warpath.sql` が fresh DB 上で同じ `upload_job_status_enum` を重複作成します。

## 5. 再現手順
1. `npm run test:e2e:local-login-dashboard` を実行する
2. proposal flow まで含める場合は `npm run test:e2e:proposal-flow` を実行する
3. clean DB migration chain の既知不整合を再現したい場合だけ `RUN_MIGRATION_SMOKE=1` を付ける
4. local Postgres が `127.0.0.1:5432` 以外なら `LOCAL_POSTGRES_ADMIN_URL=postgres://...@127.0.0.1:<port>/postgres` を付ける

## 6. 証拠パス
- HTML report:
  - [login-dashboard html](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/reports/html/login-dashboard/index.html)
  - [proposal-flow html](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/reports/html/proposal-flow/index.html)
- JSON report:
  - [login-dashboard-audit.json](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/reports/json/login-dashboard-audit.json)
  - [proposal-flow-audit.json](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/reports/json/proposal-flow-audit.json)
- screenshot:
  - [runtime-user-dashboard.png](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/screenshots/runtime-user-dashboard.png)
  - [runtime-admin-dashboard.png](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/screenshots/runtime-admin-dashboard.png)
- trace:
  - [login user trace](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/traces/login-dashboard-login-smoke-%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3-smoke-%E4%B8%80%E8%88%AC%E3%83%A6%E3%83%BC%E3%82%B6%E3%83%BC%E3%81%8C%E3%83%80%E3%83%83%E3%82%B7%E3%83%A5%E3%83%9C%E3%83%BC%E3%83%89%E3%81%B8%E5%88%B0%E9%81%94%E3%81%A7%E3%81%8D%E3%82%8B-chromium-trace.zip)
  - [login admin trace](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/traces/login-dashboard-login-smoke-%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3-smoke-%E7%AE%A1%E7%90%86%E8%80%85%E3%81%8C%E7%AE%A1%E7%90%86%E8%80%85%E3%83%80%E3%83%83%E3%82%B7%E3%83%A5%E3%83%9C%E3%83%BC%E3%83%89%E3%81%B8%E5%88%B0%E9%81%94%E3%81%A7%E3%81%8D%E3%82%8B-chromium-trace.zip)
  - [proposal happy path trace](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/traces/proposal-flow-proposal-flow-%E6%8F%90%E6%A1%88%E3%83%95%E3%83%AD%E3%83%BC-%E3%83%8F%E3%83%83%E3%83%94%E3%83%BC%E3%83%91%E3%82%B9-seed%E2%86%92%E6%8F%90%E6%A1%88%E2%86%92%E7%9B%B8%E4%BA%92%E6%89%BF%E8%AA%8D%E2%86%92%E5%AE%8C%E4%BA%86-chromium-trace.zip)
  - [proposal reject trace](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/traces/proposal-flow-proposal-flow-%E6%8F%90%E6%A1%88%E3%83%95%E3%83%AD%E3%83%BC-%E6%8F%90%E6%A1%88%E6%8B%92%E5%90%A6%E3%83%95%E3%83%AD%E3%83%BC-chromium-trace.zip)
  - [proposal conflict trace](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/traces/proposal-flow-proposal-flow-%E6%8F%90%E6%A1%88%E3%83%95%E3%83%AD%E3%83%BC-%E7%AB%B6%E5%90%88%E3%82%B7%E3%83%8A%E3%83%AA%E3%82%AA-%E5%9C%A8%E5%BA%AB%E6%B8%9B%E5%B0%91%E5%BE%8C%E3%81%AE%E5%AE%8C%E4%BA%86%E5%A4%B1%E6%95%97%E3%82%92%E8%BF%94%E3%81%99-chromium-trace.zip)

## 7. 修正内容
- local audit 安全化:
  - [playwright-local-db.sh](/Users/yusuke/workspace/DeadStockSolution/scripts/playwright-local-db.sh)
  - [run-local-login-dashboard-audit.sh](/Users/yusuke/workspace/DeadStockSolution/scripts/run-local-login-dashboard-audit.sh)
  - [run-proposal-flow-e2e.sh](/Users/yusuke/workspace/DeadStockSolution/scripts/run-proposal-flow-e2e.sh)
  - [package.json](/Users/yusuke/workspace/DeadStockSolution/package.json)
- proposal-flow false negative 修正:
  - [internal-e2e-proposal-flow.ts](/Users/yusuke/workspace/DeadStockSolution/server/src/routes/internal-e2e-proposal-flow.ts)
- prompt 固定化:
  - [PROMPT_PLAYWRIGHT_AUDIT_LOCAL_LOGIN_DASHBOARD.md](/Users/yusuke/workspace/DeadStockSolution/PROMPT_PLAYWRIGHT_AUDIT_LOCAL_LOGIN_DASHBOARD.md)
- wrapper は実行した suite ごとの `summary.json` も更新しますが、監査の source of truth は上記 per-suite JSON / HTML です。

## 8. 追加/更新テスト
- 追加した新規 spec はありません。
- proof として既存 Playwright suite を local isolated DB 上で実行しました。
- 実行した spec:
  - [login-smoke.spec.ts](/Users/yusuke/workspace/DeadStockSolution/e2e/tests/login-smoke.spec.ts)
  - [dashboard-runtime-audit.spec.ts](/Users/yusuke/workspace/DeadStockSolution/e2e/tests/dashboard-runtime-audit.spec.ts)
  - [proposal-flow.spec.ts](/Users/yusuke/workspace/DeadStockSolution/e2e/tests/proposal-flow.spec.ts)

## 9. 未解決事項
- `RUN_MIGRATION_SMOKE=1` にすると fresh DB migration はまだ失敗します。
- migration chain 問題自体は今回の task scope 外なので未修正です。
- `artifacts/playwright-audit/` には過去実行の screenshot / trace も混在しています。今回分は `login-dashboard-` と `proposal-flow-` prefix で追加保存しています。

## 10. 次の一手
1. `server/drizzle/0019_upload_confirm_jobs.sql` と `server/drizzle/0021_clean_warpath.sql` の duplicate enum 作成を整理し、`RUN_MIGRATION_SMOKE=1` を既定有効に戻す
2. proposal-flow wrapper を repo の標準監査導線に昇格させ、master prompt にも destructive flow の安全手順を反映する
3. 必要なら HTML report の index 集約運用を整理して、login-dashboard / proposal-flow のトップリンクを一箇所にまとめる

---

## 11. 2026-04-15 Frontend Follow-up Audit

### 実行できた確認
- `npm run build --workspace=client`: passed
- `npm run lint --workspace=client`: passed
- `npm run typecheck --workspace=client`: passed
- `npm run test --workspace=client`: failed
  - 136 test files 中 133 passed / 3 failed
  - 801 tests 中 797 passed / 4 failed

### 今回の制約
- `bash scripts/run-local-login-dashboard-audit.sh` は現環境で fresh 実行できなかった
  - 1回目: sandbox 内で `127.0.0.1:5432` 接続が `EPERM`
  - 昇格後: ローカル Postgres 自体が未起動で `ECONNREFUSED`
- そのため、今回の visual 判定は以下を組み合わせた
  - 既存 Playwright スクリーンショットの確認
  - 現行 client build / lint / typecheck / test の結果
  - 主要ページ実装の静的確認

### 追加で見つかった frontend 問題

#### A. UploadQualityPage は remediation payload が崩れると描画ごと落ちる
- 根拠:
  - [client/src/pages/UploadQualityPage.tsx](/Users/yusuke/workspace/DeadStockSolution/client/src/pages/UploadQualityPage.tsx:136)
  - [client/src/test/e2e/routes-meta.test.tsx](/Users/yusuke/workspace/DeadStockSolution/client/src/test/e2e/routes-meta.test.tsx:368)
- 症状:
  - test 実行で `Cannot read properties of undefined (reading 'MISSING_DRUG_NAME')`
  - route 表示確認がエラーバウンダリへ落ち、`問題総数` まで到達できていない
- 解釈:
  - 主要画面が補助データの shape に強く依存しており、ガイド辞書の欠落でページ全体が死ぬ
- UX 影響:
  - 本来は「ガイドが出ない」だけで済むべきケースで、画面全体が「予期しないエラー」になる

#### B. MatchingPage は副次パネルの取得失敗が目立つエラーとして露出しやすい
- 根拠:
  - [client/src/components/matching/ProposalTemplateSelector.tsx](/Users/yusuke/workspace/DeadStockSolution/client/src/components/matching/ProposalTemplateSelector.tsx:21)
  - [client/src/test/e2e/matching-bookmarks.test.tsx](/Users/yusuke/workspace/DeadStockSolution/client/src/test/e2e/matching-bookmarks.test.tsx:192)
- 症状:
  - Matching bookmark 系テストで `保存済み提案テンプレート` パネルが `Not found` を赤アラート表示
  - コア機能の検索/候補閲覧より先に、補助機能の失敗が画面上で強く主張する
- 解釈:
  - Secondary panel failure が primary flow の可読性を壊している
  - Matching 画面は候補比較・ブックマーク・提案テンプレート・絞り込みを一面に載せており、失敗時のノイズ耐性が低い

#### C. 初回ユーザー dashboard は導線が二重オーバーレイになっている
- 根拠:
  - [local-user-authenticated.png](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/screenshots/local-user-authenticated.png)
  - [runtime-user-dashboard.png](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/screenshots/runtime-user-dashboard.png)
- 症状:
  - `はじめてのセットアップガイド` モーダルが全面に出ている状態で、背後に別の導線カードも見えている
- 解釈:
  - 初回体験で「最初に何をすればいいか」を一つに絞れていない
  - モーダルを閉じないと本来の dashboard 情報密度も読めず、加えて背後の CTA が視覚ノイズになる

#### D. 管理者 dashboard は正常表示ではあるが、上部の情報密度が高く優先度が読みにくい
- 根拠:
  - [runtime-admin-dashboard.png](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/screenshots/runtime-admin-dashboard.png)
  - [client/src/pages/admin/AdminDashboardPage.tsx](/Users/yusuke/workspace/DeadStockSolution/client/src/pages/admin/AdminDashboardPage.tsx:1)
- 症状:
  - 上部に quick links が 10 個超、その下に多数の KPI card が連続し、さらにフォームとテーブルが同一画面に積まれている
- 解釈:
  - レイアウト崩れではないが、情報階層が弱い
  - 「今日まず確認すべきもの」「障害時に触るもの」「定常運用で使うもの」が視覚的に分離されていない
- UX 影響:
  - 慣れていない管理者ほど、最初の視線誘導が分散する

### 複雑性の高いページ
- 行数ベースで特に重い
  - [client/src/pages/admin/AdminUserRequestsPage.tsx](/Users/yusuke/workspace/DeadStockSolution/client/src/pages/admin/AdminUserRequestsPage.tsx:1) 1360行
  - [client/src/pages/ProposalDetailPage.tsx](/Users/yusuke/workspace/DeadStockSolution/client/src/pages/ProposalDetailPage.tsx:1) 1312行
  - [client/src/pages/admin/AdminDashboardPage.tsx](/Users/yusuke/workspace/DeadStockSolution/client/src/pages/admin/AdminDashboardPage.tsx:1) 980行
  - [client/src/pages/NotificationsPage.tsx](/Users/yusuke/workspace/DeadStockSolution/client/src/pages/NotificationsPage.tsx:1) 975行
- この規模自体が直ちに表示崩れを意味するわけではないが、状態管理と表示責務が集中しており、操作系のズレや微妙な退行が起きやすい構造になっている

### この時点の結論
- 明確な「CSS が壊れて読めない」系は、今回参照できたスクリーンショット上では見えていない
- ただし frontend 上の不都合はある
  - UploadQualityPage の描画例外
  - MatchingPage の補助パネル失敗が前面に出る設計
  - 初回 dashboard の二重オーバーレイ
  - Admin dashboard の優先度設計不足による過密感

## 実行コマンド
```bash
npx playwright --help
npx playwright test --help
npx playwright test --list

npm run test:e2e:local-login-dashboard
npm run test:e2e:proposal-flow

RUN_MIGRATION_SMOKE=1 npm run test:e2e:local-login-dashboard
RUN_MIGRATION_SMOKE=1 npm run test:e2e:proposal-flow
```
