# Plans.md — DeadStockSolution

> 詳細設計は [plan.md](./plan.md) を参照

## 🔴 進行中のタスク

（なし）

---

## 🟡 未着手のタスク

（なし）

---

## 🟢 完了タスク

## Sprint: コードベース品質強化 v0.0.8

> **目的**: セキュリティ強化・パフォーマンス最適化・テストカバレッジ拡充・UX改善の4軸で品質基盤を固める

### Phase 1: セキュリティ強化 [security]

- [x] T101: パスワード変更・アカウント削除にエンドポイント専用レート制限追加 `cc:完了` (2026-03-02)
  - passwordChangeLimiter(10回/時) + accountDeletionLimiter(3回/日) をユーザーIDキーで追加
- [x] T102: admin-log-center タイムスタンプパラメータ検証追加 `cc:完了` (2026-03-02)
  - from/to に ISO 8601 形式チェック・from≤to 検証・90日スパン制限・不正値 400 返却
- [x] T103: OpenClaw コマンドパラメータ Zod スキーマ検証 `cc:完了` (2026-03-02)
  - pharmacy.toggle/job.cancel/logs.query/notification.send に Zod v4 スキーマ追加

### Phase 2: パフォーマンス最適化 [performance]

- [x] T104: 交換完了時の逐次 UPDATE をバッチ化 `cc:完了` (2026-03-02)
  - ループ内逐次 UPDATE → Promise.all 並列化
- [x] T105: enrichment パッケージ事前一括読み込み `cc:完了` (2026-03-02)
  - N+1 パターン → 2パス設計で masterIds 一括ロード
- [x] T106: マッチングスナップショット一括保存 `cc:完了` (2026-03-02)
  - saveMatchSnapshotsBatch() 追加、UPSERT + 一括通知 INSERT、M*3→3 DB round trip
- [x] T107: 薬品マスター同期 UPDATE バッチ化 `cc:完了` (2026-03-02)
  - syncDrugMaster() 内 UPDATE を Promise.all 並列化

### Phase 3: テストカバレッジ強化 [test]

- [x] T108: drug-master-enrichment テスト追加 `cc:完了` (2026-03-02)
  - 8テスト: YJコード/GS1/名前マッチ・未登録・空入力・パッケージ補完
- [x] T109: column-mapper テスト追加 `cc:完了` (2026-03-02)
  - 33テスト: parseColumnIndex/getCell/detectHeaderRow/suggestMapping/detectUploadType/computeHeaderHash
- [x] T110: data-extractor テスト追加 `cc:完了` (2026-03-02)
  - 18テスト: Excel/CSV パース・境界値・異常系・大量行・wrapper関数
- [x] T111: matching-filter-service テスト追加 `cc:完了` (2026-03-02)
  - 17テスト: balanceValues/groupByPharmacy の正常系・境界値
- [x] T112: matching-rule-service テスト追加 `cc:完了` (2026-03-02)
  - 13テスト: キャッシュ・DB取得・フォールバック・更新バリデーション（既存確認）
- [x] T113: monitoring-kpi-service テスト追加 `cc:完了` (2026-03-02)
  - 13テスト: uploadFailureRate算出・status判定・レスポンス構造

### Phase 4: UX 改善 [ui]

- [x] T114: PharmacyListPage エラー/空状態の排他表示修正 `cc:完了` (2026-03-02)
  - エラー > ローディング > 空状態 > コンテンツ の排他制御に統合

---

## 📦 アーカイブ

> 完了済みスプリントは `.claude/memory/archive/` に移動済み

- [医薬品マスター管理機能スプリント](.claude/memory/archive/Plans-completed-sprint-drug-master.md) — Phase 1-6 全完了 + Backlog (23タスク, archived 2026-02-25)
- [2026-02 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-02.md) — T001-T040: コード品質改善 / システム堅牢化 / 統合通知 / コード簡素化 (40タスク, archived 2026-03-01)
- [2026-03 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-03.md) — T041-T100: パフォーマンス改善 / タイムライン / 認証強化 / UX改善 / 統計 / 薬品マスター自動更新 (60タスク, archived 2026-03-02)
