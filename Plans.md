# Plans.md — DeadStockSolution

> 詳細設計は [plan.md](./plan.md) を参照

## 🔴 進行中のタスク

## Sprint: Frontend Hooks抽出 v0.0.10

> **目的**: UploadPage.tsx（940行）の巨大コンポーネントを分割し、保守性・テスタビリティを向上

### Phase 1: ポーリングロジック抽出 [refactoring]

- [x] T128: useUploadJobPolling.ts 抽出 `cc:完了` (2026-03-07)
  - 抽出対象: ポーリングループ（391-508行）、waitForNextPoll関数
  - 状態: uploadJob, cancellingJob, uploadProgress
  - テスト要件: ポーリング成功/失敗/タイムアウト/キャンセル
  - 実績: フック作成完了、16テスト成功、UploadPage統合は別タスクで実施予定

### Phase 2: フォーム状態抽出 [refactoring]

- [x] T129: useUploadForm.ts 抽出 `cc:完了` (2026-03-07)
  - 抽出対象: uploadType, file, applyMode, deleteMissing
  - テスト要件: 状態変更・バリデーション
  - 実績: フック作成完了、15テスト成功、既存コードへの破壊的変更なし

### Phase 3: 差分サマリー抽出 [refactoring]

- [x] T130: useDiffSummary.ts 抽出 `cc:完了` (2026-03-07)
  - 抽出対象: diffSummary, acknowledgeDeleteImpact, requiresDeleteImpactAcknowledgement
  - テスト要件: 状態変更・削除影響確認
  - 実績: フック作成完了、13テスト成功、既存コードへの破壊的変更なし

## 🟡 未着手のタスク

### v0.0.11 パフォーマンス改善スプリント

- [x] **T218**: insertInBatches バッチサイズ最適化 `cc:完了` (2026-03-09)
  - `computeOptimalBatchSize()` を `upload-diff-utils.ts` に追加（500/1K/2K/5K 動的選択）
  - `upload-confirm-service.ts`, `upload-diff-batch.ts` を動的バッチに移行
  - UPDATE バッチは INSERT の半分で自動計算
  - テスト4件追加、typecheck 通過

- [x] **T219**: detectHeaderRow スキャン最適化 `cc:完了` (2026-03-09)
  - 早期終了: キーワードスコア≥10（2キーワードマッチ）で即 return
  - 空行スキップ: 全セル空の行はスコア計算をスキップ
  - テスト2件追加（35→37件）、既存テスト全通過

### v0.1.0 マッチングアルゴリズム改善スプリント [feature]

> **目的**: マッチング精度の向上と運用柔軟性の確保。ブランド/ジェネリック同等性、期限スコア指数減衰、成功率ボーナス、動的ルール調整。
> **詳細設計**: [.sisyphus/plans/matching-improvement.md](.sisyphus/plans/matching-improvement.md)
> **完了 (2026-03-09)**: 全12タスク完了。T307(equivalenceMap統合)を新規実装、他は既存コード確認。

#### 実装済み（コード確認済み）

- [x] **T301**: DB schema: `drugEquivalences` テーブル `cc:完了(既存)` — schema.ts:846 に定義済み
- [x] **T302**: DB schema: `matchingRuleProfiles` カラム追加 `cc:完了(既存)` — 3カラム全て存在
- [x] **T303**: 共有型定義: MatchingScoringRules interface `cc:完了(既存)` — matching-score-service.ts:15-34
- [x] **T304**: DrugEquivalenceService: CRUD `cc:完了(既存)` — drug-equivalence-service.ts に完全実装
- [x] **T306**: MatchingScoreService: 交換成功率ボーナス `cc:完了(既存)` — calculateSuccessRateBonus() 実装済み
- [x] **T309**: Admin API ルート `cc:完了(既存)` — admin-matching-rules.ts(179行), admin-drug-equivalences.ts(179行)
- [x] **T310**: AdminMatchingRulesPage `cc:完了(既存)` — 7フィールドグループの編集フォーム実装済み
- [x] **T311**: AdminDrugEquivalencesPage `cc:完了(既存)` — CRUD UI + ページネーション実装済み
- [x] **T312**: Admin ルート登録 `cc:完了(既存)` — route-config.tsx に adminOnly で登録済み

#### 統合作業（全完了）

- [x] **T305**: maxCandidates 制限の適用 `cc:完了(既存)` — matching-ranker.ts で `sortAndLimitCandidates()` が `.slice(0, maxCandidates)` 適用済み
- [x] **T307**: ブランド/ジェネリック同等性のマッチングフロー統合 `cc:完了` (2026-03-09) — `findBestDrugMatchWithEquivalences()` を matching-candidate-builder.ts で使用、equivalenceMap を matching-service.ts で DB から取得・全呼び出し箇所に伝搬
- [x] **T308**: maxCandidates の E2E 検証 `cc:完了(既存)` — matching-ranker.test.ts に 5 テストケース（制限値変更・境界値・空配列）

### v0.2.0 グループ・アラート・PWA スプリント [feature]

> **目的**: 薬局グループ機能、アラートシステム、PWA対応（プッシュ通知・オフライン）を追加。
> **詳細設計**: [.sisyphus/plans/group-alert-pwa.md](.sisyphus/plans/group-alert-pwa.md)
> **完了 (2026-03-09)**: 全26タスク完了。T420(グループナビ追加)を新規実装、他は既存コード確認。残りT425/T426は手動監査タスク。

#### 実装済み（コード確認済み）

- [x] **T401**: DB schema: pharmacyGroups + groupMembers `cc:完了(既存)` — schema.ts に定義済み（enum含む）
- [x] **T402**: DB schema: pushSubscriptions `cc:完了(既存)` — schema.ts に定義済み
- [x] **T403**: 共有型定義: グループ interfaces `cc:完了(既存)` — group-service.ts 内の型定義
- [x] **T404**: 共有型定義: プッシュ通知 + アラート `cc:完了(既存)` — notification types 定義済み
- [x] **T405**: PWA scaffold `cc:完了(既存)` — manifest.json + icons + vite-plugin-pwa v1.2.0 設定済み
- [x] **T407**: Notification enum 拡張 `cc:完了(既存)` — group_invitation/join/leave + alert_near_expiry/excess_stock/resolved
- [x] **T408**: Group service `cc:完了(既存)` — group-service.ts に CRUD + invitation + membership 完全実装
- [x] **T409**: Group routes `cc:完了(既存)` — app.ts:300 `/api/groups` 登録済み
- [x] **T410**: Alert service + routes `cc:完了(既存)` — alert-read-service.ts + app.ts:301 `/api/alerts`
- [x] **T411**: Matching groupBonus `cc:完了(既存)` — isGroupMember フラグ + groupBonus(default:10) 実装済み
- [x] **T412**: Push subscription service `cc:完了(既存)` — push-subscription-service.ts 完全実装
- [x] **T413**: Push dispatch service `cc:完了(既存)` — push-dispatch-service.ts + VAPID + 410 cleanup
- [x] **T415**: GroupListPage `cc:完了(既存)` — タブ(mine/public) + 検索 + 作成 + 削除 + 招待
- [x] **T416**: GroupDetailPage `cc:完了(既存)` — メンバー一覧 + 招待 + 役割変更 + 削除 + 退出
- [x] **T417**: AlertListPage `cc:完了(既存)` — タブ + フィルター + ページネーション + 詳細表示
- [x] **T421**: SW 更新バナー + インストール促進 `cc:完了(既存)` — SWUpdateBanner.tsx + InstallPromptBanner.tsx（App.tsx に import 済み）
- [x] **T422**: ルート設定 `cc:完了(既存)` — route-config.tsx に `/groups`, `/groups/:id`, `/alerts` 登録済み

#### 統合・仕上げ作業（全完了）

- [x] **T406**: Service Worker push イベントリスナー追加 `cc:完了(既存)` — sw.ts:90-101 に push ハンドラー実装済み
- [x] **T414**: Service Worker オフラインフォールバック強化 `cc:完了(既存)` — sw.ts:58-64 に setCatchHandler + offline.html フォールバック実装済み
- [x] **T418**: ダッシュボードアラートウィジェット `cc:完了(既存)` — DashboardPage.tsx:225-249 に予兆アラートセクション + KPI タイル実装済み
- [x] **T419**: プッシュ通知許可UI `cc:完了(既存)` — PushPermissionBanner.tsx + PushNotificationSettings.tsx + usePushSubscription フック実装済み
- [x] **T420**: モバイルボトムナビに `/groups` リンク追加 `cc:完了` (2026-03-09) — MobileBottomNav.tsx に `{ to: '/groups', label: 'グループ', icon: '👥' }` 追加
- [x] **T423**: グループ対応 PharmacyListPage 拡張 `cc:完了(既存)` — PharmacyListPage.tsx にグループフィルター + displayedPharmacies useMemo 実装済み
- [x] **T424**: アラート → プッシュ通知連携 `cc:完了(既存)` — predictive-alert-service.ts で sendToPharmacy() 経由の push dispatch 接続済み
- [ ] **T425**: モバイルレスポンシブ監査 `cc:TODO` — 全新規ページの 375x667 表示確認（手動テスト中心）
- [ ] **T426**: Lighthouse PWA audit gate (score ≥ 80) `cc:TODO` depends:T425 — Lighthouse CI でスコア確認

---

## 📦 アーカイブ

> 完了済みスプリントは `.claude/memory/archive/` に移動済み

- [医薬品マスター管理機能スプリント](.claude/memory/archive/Plans-completed-sprint-drug-master.md) — Phase 1-6 全完了 + Backlog (23タスク, archived 2026-02-25)
- [2026-02 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-02.md) — T001-T040: コード品質改善 / システム堅牢化 / 統合通知 / コード簡素化 (40タスク, archived 2026-03-01)
- [2026-03 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-03.md) — T041-T100: パフォーマンス改善 / タイムライン / 認証強化 / UX改善 / 統計 / 薬品マスター自動更新 (60タスク, archived 2026-03-02)
- [v0.0.8 + リファクタリング](.claude/memory/archive/Plans-completed-sprints-2026-03-v008-refactor.md) — T101-T114 + Wave 1-6 リファクタリング (archived 2026-03-07)
- [v0.0.9](.claude/memory/archive/Plans-completed-sprints-2026-03-v009.md) — T115-T127: セキュリティ・テスト・UX (archived 2026-03-07)
- [v0.0.10](.claude/memory/archive/Plans-completed-sprints-2026-03-v010.md) — T201-T217: Pre-commit hooks / モニタリング / 依存関係管理 / バンドル最適化 / Lighthouse CI / CSP強化 / Sentry→OpenClaw autofix (17タスク, archived 2026-03-07)
