# Archived Sprints: v0.0.10 hooks ~ v0.4.0 refactoring (2026-03-09 ~ 2026-03-15)

## Sprint: Frontend Hooks抽出 v0.0.10

- [x] T128: useUploadJobPolling.ts 抽出 `cc:完了` (2026-03-07)
- [x] T129: useUploadForm.ts 抽出 `cc:完了` (2026-03-07)
- [x] T130: useDiffSummary.ts 抽出 `cc:完了` (2026-03-07)

## v0.0.11 パフォーマンス改善スプリント

- [x] T218: insertInBatches バッチサイズ最適化 `cc:完了` (2026-03-09)
- [x] T219: detectHeaderRow スキャン最適化 `cc:完了` (2026-03-09)

## v0.1.0 マッチングアルゴリズム改善スプリント

全12タスク完了 (T301-T312)。T307(equivalenceMap統合)を新規実装、他は既存コード確認。

## v0.2.0 グループ・アラート・PWA スプリント

全26タスク完了 (T401-T426)。T420(グループナビ追加)を新規実装、他は既存コード確認。

## v0.3.0 デザイン刷新スプリント

- [x] T501: デザイントークン刷新 + プリセット統合 `cc:完了` (2026-03-09)
- [x] T502: 折りたたみサイドバー + ヘッダー刷新 `cc:完了` (2026-03-09)
- [x] T503: モバイル対応強化 + 認証ページ刷新 `cc:完了` (2026-03-09)

## v0.4.0 コードリファクタリングスプリント (2026-03-15)

型統一:
- [x] T601: Timeline型の共通化 — server→client re-export, toTimelineEventType分離
- [x] T602: サービス層インライン型集約 — types/matching.ts (11型), MatchingRuleProfile統一
- [x] T603: ルートヘルパー型集約 — types/notification.ts (9型), auth型3つ

共通化:
- [x] T604: スケジューラ共通ヘルパー — scheduler-utils.ts (clearSchedulerHandle)
- [x] T605: バッチ処理共通化 — insertInBatches→processInBatches統一

サービス分割:
- [x] T606: log-center-service分割 — log-center-issue-service.ts (3関数分離)
- [x] T607: exchange-service分割 — exchange-validation + exchange-execution
- [x] T608: drug-master-parser分割 — 共通 + parser-mhlw + parser-package

エラーハンドリング:
- [x] T609: 調査完了 — 全catch{}パターンが正当、変更不要
