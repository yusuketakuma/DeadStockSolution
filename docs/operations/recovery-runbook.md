# DeadStockSolution / OpenClaw Recovery Runbook

## 1. 定期バックアップ

```bash
cd /Users/yusuke/DeadStockSolution
./scripts/backup-openclaw-preview.sh
```

生成物:
- `openclaw.json` のスナップショット
- `preview` ブランチの `git bundle`
- `metadata.txt`

保存先（既定）:
- `/Users/yusuke/.openclaw/workspace/backups/deadstock-openclaw/<timestamp>/`

## 2. 復元

```bash
cd /Users/yusuke/DeadStockSolution
./scripts/restore-openclaw-preview.sh /Users/yusuke/.openclaw/workspace/backups/deadstock-openclaw/<timestamp>
```

復元後の確認:
1. `git -C /Users/yusuke/DeadStockSolution checkout preview`
2. `git -C /Users/yusuke/DeadStockSolution status`
3. `openclaw gateway restart`
4. `openclaw status`

## 3. 監視アラート確認

- 管理画面 `/admin` の「運用KPIステータス」が `要対応` の場合、
  以下を優先調査:
  1) API 5xx率
  2) 取込失敗率
  3) 滞留取込ジョブ

## 4. OpenAPI/契約運用

### 4.1 冪等性（Idempotency）

- `npm run openapi:generate` は `server/openapi/openapi.json` を常に同一の順序で再生成するため、同一ルート基盤なら再実行しても差分は生まれない。
- 差分が生じた場合は、`scripts/generate-openapi.mjs` の基底ルート定義が更新されているかを先に確認し、意図的変更の場合のみコミットする。

### 4.2 部分復旧（Partial）

- OpenAPI 生成のみ失敗した場合: `npm run openapi:generate` を再実行し、`git diff server/openapi/openapi.json` で変更点を確認。
- 契約テストのみ失敗した場合: `npm run test:openapi-contract --workspace=server` だけを再実行し、`server/src/test/openapi-contract.test.ts` の期待パスと `server/openapi/openapi.json` の整合のみを確認する。
- いずれも不明点が残る場合: ローカルの変更を一旦退避（または `git restore`）して、問題を再現する最小手順を記録する。

### 4.3 キャンセル・再試行（Cancel / Retry）

- CI 実行中の一時障害は、該当ジョブをキャンセルし、必要に応じて再キックする。
- 再試行手順:
  - `npm run openapi:generate`
  - `npm run openapi:check`
  - `npm run test:openapi-contract --workspace=server`
- 同一入力なら再試行結果は同一になり、再現性を保ったまま復旧判断が可能。

## 5. 品質ゲート

PR前に必ず実行:

```bash
cd /Users/yusuke/DeadStockSolution
npm run quality:gate
```

失敗時通知付き:

```bash
OPENCLAW_NOTIFY_TARGET=-5103716630 npm run quality:gate:notify
```
