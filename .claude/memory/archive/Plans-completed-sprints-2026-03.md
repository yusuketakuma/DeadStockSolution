# Archived Sprints (2026-03-01 ~ 2026-03-02)

> Plans.md から 2026-03-02 にアーカイブ

---

## Sprint: ログイン→ダッシュボード表示パフォーマンス改善

> **目的**: ログインからダッシュボード表示まで約7秒かかる問題を解消（目標: 2-3秒以内）

### Phase 1: API・フロントエンド最適化 [performance]
- [x] T041: `/notifications` クエリ完全並列化 `cc:DONE` (2026-03-01)
- [x] T042: `/inventory/dead-stock/risk` にユーザー向けメモリキャッシュ追加 `cc:DONE` (2026-03-01)
- [x] T043: AuthContext 二重取得の除去 `cc:DONE` (2026-03-01)
- [x] T044: NotificationContext の初回取得をダッシュボードデータと統合 `cc:DONE` (2026-03-01)

---

## Sprint: 統合タイムライン機能

> **目的**: ダッシュボードの通知欄を統合タイムラインに進化

### Phase 1: サーバー基盤 (Wave 1) [feature] [P]
- [x] T045: Schema + 型定義 `cc:DONE` (2026-03-01)
- [x] T046: 優先度エンジン `cc:DONE` (2026-03-01)
- [x] T047: Aggregator Helpers `cc:DONE` (2026-03-01)

### Phase 2: サーバーAPI (Wave 2) [feature]
- [x] T048: タイムラインサービス `cc:DONE` (2026-03-01)
- [x] T049: タイムラインAPIルート `cc:DONE` (2026-03-01)

### Phase 3: フロントエンドコンポーネント (Wave 3) [feature] [P]
- [x] T050: TimelineEventCard `cc:DONE` (2026-03-01)
- [x] T051: SmartDigest `cc:DONE` (2026-03-01)
- [x] T052: DashboardTimeline `cc:DONE` (2026-03-01)

### Phase 4: 統合 (Wave 4) [feature]
- [x] T053: TimelineContext `cc:DONE` (2026-03-01)
- [x] T054: ダッシュボード統合 `cc:DONE` (2026-03-01)
- [x] T055: ヘッダーバッジ統合 `cc:DONE` (2026-03-01)

### Phase 5: UI調整 [ui]
- [x] T056: ダッシュボードPC画面ビューポートフィット `cc:DONE` (2026-03-01)

---

## Sprint: タイムライン品質改善（/simplify 残項目）

### Phase 1: サーバー型安全性・コード重複解消 [refactor] [P]
- [x] T057: countUnread 共通ヘルパー抽出 `cc:DONE` (2026-03-01)
- [x] T058: TimelineEventType ランタイムバリデーション `cc:DONE` (2026-03-01)

### Phase 2: サーバーパフォーマンス最適化 [performance]
- [x] T059: COUNT クエリ統合（10→1 round trip） `cc:DONE` (2026-03-01)
- [x] T060: total カウント精度修正 `cc:DONE` (2026-03-01)

### Phase 3: フロントエンド最適化 [performance] [P]
- [x] T061: 双方ポーリング統合 `cc:DONE` (2026-03-01)

---

## Sprint: 既存ユーザー認証済み化 & 再認証トリガー

> **目的**: 既存ユーザーを verified に移行、ステータス簡素化、プロフィール変更時の再認証トリガー

### Phase 1: バックエンド変更
- [x] T062: VerificationStatus 型簡素化 + canLogin 変更 `cc:DONE` (2026-03-01)
- [x] T063: auth ミドルウェア isActive 制御に変更 `cc:DONE` (2026-03-01)
- [x] T064: アカウント更新 API に再認証トリガー追加 `cc:DONE` (2026-03-01)
- [x] T065: 管理者更新 API に再認証トリガー追加 `cc:DONE` (2026-03-01)

### Phase 2: DB マイグレーション
- [x] T066: 既存ユーザー verified 移行マイグレーション `cc:DONE` (2026-03-01)

### Phase 3: テスト・フロントエンド
- [x] T067: テスト更新 `cc:DONE` (2026-03-01)
- [x] T068: フロントエンド バッジ表示簡素化 `cc:DONE` (2026-03-01)

---

## Sprint: 認証ステータス フロントエンド対応

> **背景**: バックエンドの再認証トリガー・審査ステータス返却を追加したが、フロントエンドの対応が不十分

### Phase 1: API クライアント基盤修正 [bugfix]
- [x] T069: API client の 403 判定修正 `cc:DONE` (2026-03-01)

### Phase 2: アカウント更新フロー対応 [bugfix]
- [x] T070: AccountPage に 403 審査ステータスハンドリング追加 `cc:DONE` (2026-03-01)
- [x] T071: AccountPage に 503 partialSuccess ハンドリング追加 `cc:DONE` (2026-03-01)
- [x] T072: AccountData 型に verificationStatus 追加 `cc:DONE` (2026-03-01)

### Phase 3: 管理画面対応 [bugfix]
- [x] T073: AdminPharmacyEditPage に 403/503 ハンドリング追加 `cc:DONE` (2026-03-01)
- [x] T074: AdminPharmaciesPage の 'unverified' バッジ判定修正 `cc:DONE` (2026-03-01)

---

## Sprint: 統計ページ追加

> **目的**: KPI・統計情報を1ページに集約

### Phase 1: 実装 [feature]
- [x] T075: 統計API + 統計ページ + ルーティング `cc:DONE` (2026-03-01)

---

## Sprint: ビューポートフィット & 医薬品マスター自動更新

- [x] T090: 全ページをビューポートフィットレイアウトに統一 `cc:DONE` (2026-03-01)
- [x] T100: 医薬品マスター自動更新機能ブラッシュアップ `cc:完了` (2026-03-02)
  - Phase 1-8 全完了（テスト 27件パス）

---

## Sprint: UX改善 4機能

> **目的**: トースト通知・期限リスク可視化・オンボーディング・マッチング自動通知

### Phase 1: トースト基盤 [feature]
- [x] T091: ToastContext + AppToastContainer 新規作成 `cc:DONE` (2026-03-02)
- [x] T092: DeadStockListPage の削除メッセージをトースト移行 `cc:DONE` (2026-03-02)

### Phase 2: 期限リスク可視化 [feature]
- [x] T093: expiry-risk.ts ユーティリティ作成 `cc:DONE` (2026-03-02)
- [x] T094: DeadStockListPage にバッジ・フィルタ・ソート追加 `cc:DONE` (2026-03-02)

### Phase 3: オンボーディング [feature]
- [x] T095: onboardingSteps + OnboardingGuide + useOnboardingVisibility 作成 `cc:DONE` (2026-03-02)
- [x] T096: DashboardPage にオンボーディング統合 `cc:DONE` (2026-03-02)

### Phase 4: マッチング自動通知 [feature]
- [x] T097: pharmacies テーブルに matchingAutoNotifyEnabled カラム追加 `cc:DONE` (2026-03-02)
- [x] T098: account API + matching-snapshot-service 変更 `cc:DONE` (2026-03-02)
- [x] T099: useMatchNotificationToast + AccountPage/Layout 変更 `cc:DONE` (2026-03-02)
