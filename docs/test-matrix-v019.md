# v0.0.19 回帰テスト行列

> 生成日: 2026-03-23
> スプリント: v0.0.19 全体改善スプリント (Track A-G)

## テスト実行コマンド共通ルール

```bash
# 単一ファイル実行
cd server && npx vitest run src/test/<file>.test.ts

# 複数ファイル同時実行
cd server && npx vitest run src/test/file1.test.ts src/test/file2.test.ts

# パターンマッチ実行
cd server && npx vitest run --reporter=verbose src/test/<pattern>*
```

## Track 別回帰テスト対象

| Track | テスト対象 | コマンド |
|-------|-----------|---------|
| A: UX | statistics trends, daily statistics | `cd server && npx vitest run src/test/statistics-trends.test.ts src/test/daily-statistics.test.ts src/test/statistics-route.test.ts` |
| B: マッチング | score breakdown, success rate, presets, equivalence | `cd server && npx vitest run src/test/matching-score-breakdown.test.ts src/test/matching-score-success-rate.test.ts src/test/matching-rule-preset.test.ts src/test/matching-score-equivalence.test.ts` |
| C: 管理 | admin stats KPI, pharmacy health, bulk actions | `cd server && npx vitest run src/test/admin-stats-kpi.test.ts src/test/admin-pharmacy-health-expanded.test.ts src/test/admin-bulk-actions.test.ts src/test/admin-bulk-actions-dryrun.test.ts src/test/admin-bulk-activate-deactivate.test.ts` |
| D: パフォーマンス | matching refresh parallel | `cd server && npx vitest run src/test/matching-refresh-parallel.test.ts` |
| E: OpenClaw | health KPI, retries, timeline | `cd server && npx vitest run src/test/openclaw-health-kpi.test.ts src/test/admin-openclaw-retries.test.ts src/test/internal-openclaw-retries-route.test.ts src/test/admin-user-requests-timeline.test.ts` |
| F: 横断ゲート | openapi contract | `cd server && npx vitest run src/test/openapi-contract.test.ts` |
| G: 追加機能 | comments unread, bookmarks, messages, SSE | `cd server && npx vitest run src/test/exchange-comments-unread.test.ts src/test/match-bookmarks.test.ts src/test/messages.test.ts src/test/sse-redis.test.ts` |

## 詳細テストファイル一覧

### Track A: UX 改善

| タスク | テストファイル | 説明 |
|--------|-------------|------|
| T952a | `daily-statistics.test.ts` | daily_statistics テーブル + 集計 cron |
| T952b | `statistics-trends.test.ts` | `/statistics/trends` エンドポイント |
| T952c | `statistics-route.test.ts` | 統計 API 全般 |

### Track B: マッチング高度化

| タスク | テストファイル | 説明 |
|--------|-------------|------|
| T955 | `matching-score-breakdown.test.ts` | scoreBreakdown フィールド |
| T961 | `matching-score-success-rate.test.ts` | 成約率フィードバックループ |
| T963 | `matching-rule-preset.test.ts` | グローバル既定 + 薬局別 override |
| T962 | `matching-score-equivalence.test.ts` | 同等品マッチング説明性 |

### Track C: 運用・管理改善

| タスク | テストファイル | 説明 |
|--------|-------------|------|
| T971 | `admin-stats-kpi.test.ts` | KPI 集約 (アクティブ率/成約率/月次交換額) |
| T973 | `admin-pharmacy-health-expanded.test.ts` | 薬局ヘルスダッシュボード拡張 |
| T975 | `admin-bulk-activate-deactivate.test.ts` | 一括有効化/無効化 action mapping |
| T1003 | `admin-bulk-actions-dryrun.test.ts` | ドライラン preview |
| -  | `admin-bulk-actions.test.ts` | bulk actions 全般 |

### Track D: パフォーマンス

| タスク | テストファイル | 説明 |
|--------|-------------|------|
| T984 | `matching-refresh-parallel.test.ts` | フォールバック並列化 Promise.allSettled |

### Track E: OpenClaw 実戦配備

| タスク | テストファイル | 説明 |
|--------|-------------|------|
| T991 | `openclaw-health-kpi.test.ts` | ヘルスチェック endpoint |
| T992 | `admin-openclaw-retries.test.ts` | リトライ状況 UI backend |
| T992 | `internal-openclaw-retries-route.test.ts` | internal retries route |
| T994 | `admin-user-requests-timeline.test.ts` | ステータス遷移タイムライン |

### Track F: 横断ゲート

| タスク | テストファイル | 説明 |
|--------|-------------|------|
| T997 | `openapi-contract.test.ts` | OpenAPI 契約テスト |

### Track G: 追加機能

| タスク | テストファイル | 説明 |
|--------|-------------|------|
| T1001 | `exchange-comments-unread.test.ts` | 提案コメント未読管理 |
| T1004/T1005 | `match-bookmarks.test.ts` | マッチング候補ブックマーク |
| T1008a/b | `messages.test.ts` | 薬局間メッセージング |
| T1009 | `sse-redis.test.ts` | SSE + Redis リアルタイム通知 |

## 全体回帰テスト (全 Track まとめ)

```bash
cd server && npx vitest run \
  src/test/statistics-trends.test.ts \
  src/test/daily-statistics.test.ts \
  src/test/matching-score-breakdown.test.ts \
  src/test/matching-score-success-rate.test.ts \
  src/test/matching-rule-preset.test.ts \
  src/test/matching-score-equivalence.test.ts \
  src/test/admin-stats-kpi.test.ts \
  src/test/admin-pharmacy-health-expanded.test.ts \
  src/test/admin-bulk-actions.test.ts \
  src/test/admin-bulk-activate-deactivate.test.ts \
  src/test/matching-refresh-parallel.test.ts \
  src/test/openclaw-health-kpi.test.ts \
  src/test/admin-openclaw-retries.test.ts \
  src/test/internal-openclaw-retries-route.test.ts \
  src/test/admin-user-requests-timeline.test.ts \
  src/test/openapi-contract.test.ts \
  src/test/exchange-comments-unread.test.ts \
  src/test/match-bookmarks.test.ts \
  src/test/messages.test.ts \
  src/test/sse-redis.test.ts
```
