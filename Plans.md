# Plans.md — DeadStockSolution

> 詳細設計は [plan.md](./plan.md) を参照

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
- [x] T046: 優先度エンジン `cc:DONE` (2026-03-01)
- [x] T047: Aggregator Helpers `cc:DONE` (2026-03-01) depends:T045

### Phase 2: サーバーAPI (Wave 2) [feature]
- [x] T048: タイムラインサービス `cc:DONE` (2026-03-01) depends:T045,T046,T047
- [x] T049: タイムラインAPIルート `cc:DONE` (2026-03-01) depends:T048

### Phase 3: フロントエンドコンポーネント (Wave 3) [feature] [P]
- [x] T050: TimelineEventCard `cc:DONE` (2026-03-01)
- [x] T051: SmartDigest `cc:DONE` (2026-03-01) depends:T046
- [x] T052: DashboardTimeline `cc:DONE` (2026-03-01) depends:T048,T050

### Phase 4: 統合 (Wave 4) [feature]
- [x] T053: TimelineContext `cc:DONE` (2026-03-01) depends:T049
- [x] T054: ダッシュボード統合 `cc:DONE` (2026-03-01) depends:T050,T051,T052,T053
- [x] T055: ヘッダーバッジ統合 `cc:DONE` (2026-03-01) depends:T053

### Phase 5: UI調整 [ui]
- [x] T056: ダッシュボードPC画面ビューポートフィット `cc:DONE` (2026-03-01)

---

## Sprint: タイムライン品質改善（/simplify 残項目）

### Phase 1: サーバー型安全性・コード重複解消 [refactor] [P]
- [x] T057: countUnread 共通ヘルパー抽出 `cc:DONE` (2026-03-01)
- [x] T058: TimelineEventType ランタイムバリデーション `cc:DONE` (2026-03-01)

### Phase 2: サーバーパフォーマンス最適化 [performance]
- [x] T059: COUNT クエリ統合（10→1 round trip） `cc:DONE` (2026-03-01) depends:T057
- [x] T060: total カウント精度修正 `cc:DONE` (2026-03-01) depends:T059

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

> **背景**: バックエンドの再認証トリガー・審査ステータス返却を追加したが、フロントエンドの対応が不十分（約40%）

### Phase 1: API クライアント基盤修正 [bugfix]
- [x] T069: API client の 403 判定修正 `cc:DONE` (2026-03-01)

### Phase 2: アカウント更新フロー対応 [bugfix]
- [x] T070: AccountPage に 403 審査ステータスハンドリング追加 `cc:DONE` (2026-03-01) depends:T069
- [x] T071: AccountPage に 503 partialSuccess ハンドリング追加 `cc:DONE` (2026-03-01) depends:T069
- [x] T072: AccountData 型に verificationStatus 追加 `cc:DONE` (2026-03-01)

### Phase 3: 管理画面対応 [bugfix]
- [x] T073: AdminPharmacyEditPage に 403/503 ハンドリング追加 `cc:DONE` (2026-03-01) depends:T069
- [x] T074: AdminPharmaciesPage の 'unverified' バッジ判定修正 `cc:DONE` (2026-03-01)

---

## 📦 アーカイブ

> 完了済みスプリントは `.claude/memory/archive/` に移動済み

- [医薬品マスター管理機能スプリント](.claude/memory/archive/Plans-completed-sprint-drug-master.md) — Phase 1-6 全完了 + Backlog (23タスク, archived 2026-02-25)
- [2026-02 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-02.md) — T001-T040: コード品質改善 / システム堅牢化 / 統合通知 / コード簡素化 (40タスク, archived 2026-03-01)
