# パフォーマンス回帰テスト — 運用ガイド

このドキュメントでは、サーバーサイドのパフォーマンス回帰テストの仕組みと運用手順を説明します。

---

## テストの概要

`server/src/test/performance-regression.test.ts` が主要 API エンドポイントの応答時間を計測し、
`server/perf/baseline.json` に記録されたベースライン値と比較します。

計測は**ウォームアップ 8 回 + 測定 40 回**のサンプリングで行われ、P50（中央値）と P95 パーセンタイルを記録します。

---

## テストの実行方法

### 回帰チェック（通常の CI 実行）

```bash
npm run test:perf:server
```

ベースラインと比較し、閾値を超えた場合はテストが失敗します。
`PERF_REGRESSION_ENABLED=true` が自動で設定されます。

### ベースラインの更新

意図的なパフォーマンス変化（リファクタリング、依存関係アップデートなど）があった場合に実行します。

```bash
npm run test:perf:update:server
```

`PERF_BASELINE_UPDATE=true` が設定され、`server/perf/baseline.json` が上書きされます。
**更新後は必ずコミットしてください。**

---

## ベースラインの保存場所

```
server/perf/baseline.json
```

このファイルはリポジトリにコミットされており、CI での回帰検知の基準になります。
バージョン管理することで、「いつ・誰が・どんな理由でベースラインを変えたか」を git log で追跡できます。

---

## 回帰の判定基準（閾値）

回帰テストは以下の**どちらか一方でも超えた場合に失敗**します。

| 指標 | 判定ロジック |
|------|------------|
| **相対閾値** | `現在値 > ベースライン × (1 + 0.35)` — 35% 超過で失敗 |
| **絶対閾値 (P50)** | `現在値 > ベースライン + 4ms` で失敗 |
| **絶対閾値 (P95)** | `現在値 > ベースライン + 15ms` で失敗 |

相対・絶対のどちらか**緩い方**が適用されます（小さい値が基準になります）。

### 閾値のカスタマイズ（環境変数）

| 環境変数 | デフォルト | 説明 |
|---------|-----------|------|
| `PERF_RELATIVE_TOLERANCE` | `0.35` | 相対許容率（35%） |
| `PERF_ABSOLUTE_P50_MS` | `4` | P50 絶対許容値（ms） |
| `PERF_ABSOLUTE_P95_MS` | `15` | P95 絶対許容値（ms） |
| `PERF_WARMUP_RUNS` | `8` | ウォームアップ回数 |
| `PERF_MEASURED_RUNS` | `40` | 測定回数 |

---

## 計測対象シナリオ

| シナリオキー | エンドポイント | 説明 |
|-------------|--------------|------|
| `post_api_exchange_find` | `POST /api/exchange/find` | マッチング候補検索 |
| `post_api_upload_preview` | `POST /api/upload/preview` | アップロードプレビュー |
| `post_api_upload_confirm` | `POST /api/upload/confirm` | アップロード確定 |
| `get_api_inventory_browse` | `GET /api/inventory/browse` | 在庫一覧取得 |
| `get_api_pharmacies_list` | `GET /api/pharmacies` | 薬局一覧取得 |
| `scheduler_import_failure_alert_check` | スケジューラ | 取込失敗アラート確認 |

---

## ベースライン更新のタイミング

以下の場合はベースラインの更新を検討してください。

| 状況 | 対応 |
|------|------|
| パフォーマンスを意図的に改善した | 更新してコミット |
| Node.js / 依存関係のバージョンアップ | 更新してコミット（変化理由をコミットメッセージに記載） |
| テスト環境のスペック変化 | 更新してコミット（環境変化を PR に記載） |
| 原因不明の回帰で CI が失敗する | **更新せず** — 原因を調査して実装を修正する |

---

## 実績の追跡

`docs/performance/baseline.md` に過去のベースライン更新履歴を記録しています。
ベースラインを更新したら、同ファイルの表にも追記してください。

---

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `server/src/test/performance-regression.test.ts` | 回帰テスト本体 |
| `server/src/test/performance-scale-indexes.test.ts` | DBインデックス適用のユニットテスト |
| `server/src/db/performance-scale-indexes.ts` | パフォーマンス向上用インデックス定義 |
| `server/perf/baseline.json` | ベースライン数値（JSON） |
| `docs/performance/baseline.md` | ベースライン更新履歴（人間向け） |
