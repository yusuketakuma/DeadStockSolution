# Plans.md — DeadStockSolution

> 詳細設計は [plan.md](./plan.md) を参照

## Sprint: コード品質改善リファクタリング

### Phase 1: サーバー大規模ファイル分割 [P]
- [x] T001: `drug-master-service.ts` (1004行) を分割 `cc:DONE` (2026-02-25)
  - `drug-master-parser-service.ts`, `drug-master-sync-service.ts`, `drug-master-lookup-service.ts` に分離 + ファサード
- [x] T002: `matching-service.ts` (734行) を分割 `cc:DONE` (2026-02-25)
  - `matching-score-service.ts`, `matching-filter-service.ts` に分離 + ファサード
- [x] T003: `admin.ts` ルート (700行) を分割 `cc:DONE` (2026-02-25)
  - `admin-pharmacies.ts`, `admin-logs.ts`, `admin-stats.ts`, `admin-utils.ts` に分離 + ファサード
- [x] T004: `drug-master.ts` ルート (706行) を分割 `cc:DONE` (2026-02-25)
  - `drug-master-crud.ts`, `drug-master-sync.ts` に分離 + ファサード
- [x] T005: `upload.ts` ルート (516行) を分割 `cc:DONE` (2026-02-25)
  - `upload-validation.ts`, `upload-parser.ts` に分離 + ファサード

### Phase 2: クライアント大規模ページ分割 [P]
- [x] T006: `AccountPage.tsx` (867行) をコンポーネント分割 `cc:DONE` (2026-02-25)
  - `components/account/` に AccountInfoForm, BusinessHoursSettings, WithdrawSection + types.ts
- [x] T007: `AdminDrugMasterPage.tsx` (747行) をコンポーネント分割 `cc:DONE` (2026-02-25)
  - `admin/components/` に DrugMasterStatsCards, SearchFilter, Table, DetailModal, EditModal
- [x] T008: `DashboardPage.tsx` (476行) をコンポーネント分割 `cc:DONE` (2026-02-25)
  - `components/dashboard/` に DashboardNextAction, Notices, StatusCards + types.ts
- [x] T009: `Header.tsx` (393行) をコンポーネント分割 `cc:DONE` (2026-02-25)
  - `components/header/` に AppUpdatesPopover, RequestModal

### Phase 3: サーバーログ整理
- [x] T010: DB スクリプトの `console.log` を構造化ログに置換 `cc:DONE` (2026-02-25)
  - 4ファイル19箇所を logger.* に完全置換

---

## Sprint: システム堅牢化・運用機能強化

> **目的**: 複数ログイン時のデータ整合性、編集データの消失防止、管理者向けバックアップ機能を追加

### Phase 1: 同一アカウント複数ログイン — データ整合性対策 [feature:security]

現状JWTステートレス方式で複数ログインは既に可能。競合編集時のデータ破壊を防止する。

- [x] T011: Optimistic Locking 基盤追加 `cc:DONE` (2026-02-26)
  - `pharmacies`, `pharmacyBusinessHours`, `pharmacySpecialHours` に `version` カラム追加
- [x] T012: サーバー側 Optimistic Locking 実装 `cc:DONE` (2026-02-26)
  - account.ts, business-hours.ts に version チェック + 409 Conflict 返却
- [x] T013: フロントエンド競合ハンドリング `cc:DONE` (2026-02-26)
  - ConflictAlert コンポーネント + isConflictError ヘルパー + AccountPage 統合
- [x] T014: テスト `cc:DONE` (2026-02-26)
  - optimistic-locking.test.ts: 11テスト（アカウント6 + 営業時間5）

### Phase 2: 編集途中データ リアルタイム保存 [feature]

全フォームに localStorage ベースの自動保存を追加。ページ離脱・リロード時のデータ消失を防止。

- [x] T015: useAutoSave カスタムフック作成 `cc:DONE` (2026-02-26)
  - `client/src/hooks/useAutoSave.ts` — debounce 1秒, enabled オプション, savingStatus 3状態
- [x] T016: AccountInfoForm にリアルタイム保存適用 `cc:DONE` (2026-02-26)
  - パスワード除外の AccountDraftData 型 + DraftRestoreAlert 統合
- [x] T017: BusinessHoursSettings にリアルタイム保存適用 `cc:DONE` (2026-02-26)
  - 通常+特別営業時間の両方を保存対象、編集モード中のみ有効
- [x] T018: DrugMasterEditModal にリアルタイム保存適用 `cc:DONE` (2026-02-26)
  - formId に yjCode 含む、モーダル閉じる時に自動クリア
- [x] T019: UploadPage 設定にリアルタイム保存適用 `cc:DONE` (2026-02-26)
  - カラムマッピング + アップロードタイプを保存対象
- [x] T020: テスト `cc:DONE` (2026-02-26)
  - useAutoSave.test.ts: 12テスト（初期状態、debounce、復元、クリア、独立性、壊れたJSON等）

### Phase 3: データベースバックアップ機能（管理者メニュー）[feature:security] [P]

JSON + CSV 両形式でのエクスポート。管理画面からワンクリックでダウンロード。

- [x] T021: バックアップ API 設計・実装 `cc:DONE` (2026-02-26)
  - admin-backup.ts: GET /tables + POST /export、レート制限 5回/15分
- [x] T022: JSON エクスポートサービス `cc:DONE` (2026-02-26)
  - backup-service.ts: 23テーブル全対応、メタデータ付き、adm-zip 圧縮
  - passwordHash/token をエクスポートから除外（セキュリティ）
- [x] T023: CSV エクスポートサービス `cc:DONE` (2026-02-26)
  - 80+カラムの日本語マッピング、BOM付きUTF-8、自作CSVエスケープ
- [x] T024: 管理画面 バックアップページ UI `cc:DONE` (2026-02-26)
  - AdminBackupPage.tsx + Sidebar メニュー追加 + ルート /admin/backup
- [x] T025: テスト + アクティビティログ `cc:DONE` (2026-02-26)
  - backup-service.test.ts: 34テスト、activity_logs に backup_export 記録
  - バックアップ実行を `activity_logs` に記録
  - 大量データ時のメモリ考慮（ストリーミング検証）

### 優先度マトリクス

| 機能 | 優先度 | 理由 |
|------|--------|------|
| Phase 1: Optimistic Locking | **Required** | 複数ログイン時のデータ破壊防止（安全性） |
| Phase 2: リアルタイム保存 | **Required** | ユーザー体験の基本品質（データ消失防止） |
| Phase 3: DB バックアップ | **Recommended** | 運用上重要だが Phase 1-2 より後でも可 |

### 工数目安（参考）

| Phase | タスク数 | 規模感 |
|-------|---------|--------|
| Phase 1 | 4 | 小〜中（スキーマ変更 + API修正 + フロント対応） |
| Phase 2 | 6 | 中（共通フック + 4画面適用 + テスト） |
| Phase 3 | 5 | 中〜大（新規 API + サービス + UI ページ） |

> **Note**: Phase 1 と Phase 3 は並列実行可能。Phase 2 は Phase 1 完了後が望ましい（version を保存対象に含めるため）。

---

## Sprint: 統合通知センター

> **設計書**: [notification-center-design.md](docs/plans/2026-02-26-notification-center-design.md)
> **実装計画**: [notification-center-plan.md](docs/plans/2026-02-26-notification-center-plan.md)

### Phase 1: バックエンド基盤

- [x] T026: notifications テーブル + readByRecipient カラム追加 `cc:DONE` (2026-02-26)
  - schema.ts に notifications テーブル定義、proposalComments に readByRecipient カラム追加
  - マイグレーション生成済み (0015)
- [x] T027: notification-service.ts を作成（TDD） `cc:DONE` (2026-02-26)
  - createNotification, getUnreadCount, getNotifications, markAsRead, markAllAsRead — 6テストPASS
- [x] T028: 通知 API エンドポイント追加 `cc:DONE` (2026-02-26)
  - GET /unread-count, PATCH /:id/read, PATCH /read-all — 4テストPASS
- [x] T029: 既存サービスに通知生成を追加 `cc:DONE` (2026-02-26)
  - exchange-service.ts + exchange.ts にベストエフォート通知生成追加

### Phase 2: バックエンド統合

- [x] T030: GET /api/notifications に notifications テーブルを統合 `cc:DONE` (2026-02-26)
  - notificationToNotice() ヘルパーで統合、summary に未読件数加算

### Phase 3: フロントエンド

- [x] T031: NotificationContext + ポーリング `cc:DONE` (2026-02-26)
  - 30秒間隔ポーリング、visibilitychange 連携
- [x] T032: ヘッダー通知バッジ `cc:DONE` (2026-02-26)
  - Badge コンポーネント、99+ 表示、ダッシュボード遷移
- [x] T033: ダッシュボード通知タイプ拡張 `cc:DONE` (2026-02-26)
  - new_comment タイプ追加、parseNotificationId ヘルパー
- [x] T034: ダッシュボードとポーリングの連携 `cc:DONE` (2026-02-26)
  - handleNoticeClick 内で refreshCount 呼び出し

### Phase 4: 検証

- [x] T035: 全体テスト & ビルド確認 `cc:DONE` (2026-02-26)
  - サーバー: 320 passed / クライアント: 114 passed / ビルド: 成功

---

## Sprint: コード簡素化リファクタリング（/simplify 残タスク）

> **背景**: `/simplify` レビューで検出された改善項目のうち、影響範囲が大きく自動修正を見送った5件

### Phase 1: UIリファクタリング [refactor] [P]
- [x] T036: ProposalDetailPage のA→B/B→Aパネル共通化 `cc:DONE` (2026-02-28)
  - ProposalItemsPanel.tsx 新規作成、ProposalDetailPage.tsx の重複パネルを統合
- [x] T037: UploadPage のジョブ状態3点を統合オブジェクト化 `cc:DONE` (2026-02-28)
  - uploadJobId/uploadJobStatus/uploadJobAttempts → UploadJobState 統合オブジェクト化、6箇所のリセット一括化

### Phase 2: サーバーロジック整理 [refactor] [P]
- [x] T039: pharmacies/inventory の Map構築ループ共通化 `cc:DONE` (2026-02-28)
  - array-utils.ts に groupBy<T, K>() 追加、pharmacies.ts + inventory.ts 計4箇所置換

### Phase 3: エラー処理構造化 [refactor]
- [x] T040: エラー分類ロジックの構造化 `cc:DONE` (2026-02-28)
  - error-handler.ts に getErrorMessage + handleRouteError 追加、auth.ts 6箇所統一

---

## Sprint: ログイン→ダッシュボード表示パフォーマンス改善

> **目的**: ログインからダッシュボード表示まで約7秒かかる問題を解消（目標: 2-3秒以内）

### Phase 1: API・フロントエンド最適化 [performance]
- [x] T041: `/notifications` クエリ完全並列化 `cc:DONE` (2026-03-01)
  - 直列6+クエリを2段階の `Promise.all` に再構成（全クエリ並列 + 後処理の messageReads/triggerNames 並列化）
- [x] T042: `/inventory/dead-stock/risk` にユーザー向けメモリキャッシュ追加 `cc:DONE` (2026-03-01)
  - TTL 30秒のメモリキャッシュ (`userRiskCache`) を `getPharmacyRiskDetail` に追加
- [x] T043: AuthContext 二重取得の除去 `cc:DONE` (2026-03-01)
  - `skipNextRefreshRef` でlogin直後の不要な GET /auth/me をスキップ
- [x] T044: NotificationContext の初回取得をダッシュボードデータと統合 `cc:DONE` (2026-03-01)
  - `/notifications` レスポンスの summary から直接 unreadCount を設定、`setUnreadCount` を公開

---

## Sprint: 統合タイムライン機能

> **設計書**: [.sisyphus/plans/timeline-feature.md](.sisyphus/plans/timeline-feature.md)
> **目的**: ダッシュボードの通知欄を統合タイムラインに進化。朝開いたら全部わかる体験を実現

### Phase 1: サーバー基盤 (Wave 1) [feature] [P]
- [x] T045: Schema + 型定義 `cc:DONE` (2026-03-01)
  - `pharmacies.lastTimelineViewedAt` カラム追加 + `server/src/types/timeline.ts` にTimelineEvent共通型 + migration 0028 生成
- [x] T046: 優先度エンジン `cc:DONE` (2026-03-01)
  - `timeline-priority-engine.ts` Critical/High/Medium/Low 4段階ルール（Pure Function, TDD）25テスト PASS
- [x] T047: Aggregator Helpers `cc:DONE` (2026-03-01) depends:T045
  - `timeline-aggregators.ts` 9テーブル別fetcher関数群（TDD）28テスト PASS

### Phase 2: サーバーAPI (Wave 2) [feature]
- [x] T048: タイムラインサービス `cc:DONE` (2026-03-01) depends:T045,T046,T047
  - `timeline-service.ts` getTimeline/getTimelineUnreadCount/markTimelineViewed/getSmartDigest（TDD）8テスト PASS
- [x] T049: タイムラインAPIルート `cc:DONE` (2026-03-01) depends:T048
  - GET /api/timeline, GET /api/timeline/unread-count, PATCH /api/timeline/mark-viewed, GET /api/timeline/digest + 9テスト PASS

### Phase 3: フロントエンドコンポーネント (Wave 3) [feature] [P]
- [x] T050: TimelineEventCard `cc:DONE` (2026-03-01)
  - `TimelineEventCard.tsx` ソース別ラベル+優先度バッジ+未読スタイル+相対時間 11テスト PASS
- [x] T051: SmartDigest `cc:DONE` (2026-03-01) depends:T046
  - `SmartDigest.tsx` Critical/Highイベント最大5件表示+空状態+ローディング 7テスト PASS
- [x] T052: DashboardTimeline `cc:DONE` (2026-03-01) depends:T048,T050
  - `DashboardTimeline.tsx` フィルタ+ページネーション+エラー/空状態 9テスト PASS

### Phase 4: 統合 (Wave 4) [feature]
- [x] T053: TimelineContext `cc:DONE` (2026-03-01) depends:T049
  - `TimelineContext.tsx` 60sポーリング+visibilitychange+フィルタ+ページネーション、NotificationContext後方互換維持
- [x] T054: ダッシュボード統合 `cc:DONE` (2026-03-01) depends:T050,T051,T052,T053
  - DashboardPage にSmartDigest+DashboardTimeline統合、旧DashboardNotices+NextAction置換、157テスト PASS
- [x] T055: ヘッダーバッジ統合 `cc:DONE` (2026-03-01) depends:T053
  - Header.tsx のuseNotifications→useTimeline切替、タイムライン未読数をバッジ表示

### Phase 5: UI調整 [ui]
- [x] T056: ダッシュボードPC画面ビューポートフィット `cc:DONE` (2026-03-01)
  - PC(≥992px)でスクロールなしの全画面表示。2カラムトップ(SmartDigest+リスク/ステータス) + タイムライン(flex-grow内部スクロール)
  - StatusCards→コンパクトストリップ化、DashboardTimeline flex対応、24テスト PASS

---

## 📦 アーカイブ

> 完了済みスプリントは `.claude/memory/archive/` に移動済み

- [医薬品マスター管理機能スプリント](.claude/memory/archive/Plans-completed-sprint-drug-master.md) — Phase 1-6 全完了 + Backlog (23タスク, archived 2026-02-25)
