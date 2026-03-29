1. 実施したこと
- local Postgres 限定の Playwright wrapper を追加し、`npm run test:e2e:local-login-dashboard` と `npm run test:e2e:proposal-flow` で一時 DB 作成、seed、server/client 起動、Playwright 実行、cleanup まで自動化した。
- login/dashboard 4件と proposal-flow 3件を isolated DB 上で再実行し、合計 7 件すべて pass した。
- prompt と監査レポートを、wrapper 前提の安全手順と proposal-flow 実行結果込みで更新した。

2. 直したこと
- proposal-flow の E2E seed ルートが admin test account を混ぜていたため、fixture と index 対応がずれて false negative になる不整合を修正した。
- Playwright report 取得を単発実行の `list,html,json` に統一し、JSON 用の再実行で `/login` 429 を踏む状態を解消した。

3. まだ危ないこと
- `db:migrate` の clean-db smoke は repo の既知 migration chain 問題でまだ失敗する。
- 具体的には `server/drizzle/0019_upload_confirm_jobs.sql` と `server/drizzle/0021_clean_warpath.sql` が fresh DB で同じ enum を重複作成する。

4. 追加したテスト
- 新規 spec は追加していない。既存の Playwright spec を安全な local DB wrapper 経由で proof 実行した。
- 実行対象:
  - `e2e/tests/login-smoke.spec.ts`
  - `e2e/tests/dashboard-runtime-audit.spec.ts`
  - `e2e/tests/proposal-flow.spec.ts`

5. 保存した成果物の場所
- [audits/playwright-audit-report.md](/Users/yusuke/workspace/DeadStockSolution/audits/playwright-audit-report.md)
- [artifacts/playwright-audit/reports/html/login-dashboard/index.html](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/reports/html/login-dashboard/index.html)
- [artifacts/playwright-audit/reports/html/proposal-flow/index.html](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/reports/html/proposal-flow/index.html)
- [artifacts/playwright-audit/reports/json/login-dashboard-audit.json](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/reports/json/login-dashboard-audit.json)
- [artifacts/playwright-audit/reports/json/proposal-flow-audit.json](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/reports/json/proposal-flow-audit.json)
- [artifacts/playwright-audit/traces](/Users/yusuke/workspace/DeadStockSolution/artifacts/playwright-audit/traces)

6. 次の一手
- migration chain の duplicate enum 問題を直して `RUN_MIGRATION_SMOKE=1` でも green にする。
- proposal-flow wrapper の運用を master prompt 側にも反映し、login/dashboard だけでなく destructive flow まで標準化する。
