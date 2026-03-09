# Archived Sprints: v0.0.8 + Refactoring (2026-03-02 ~ 2026-03-07)

> Plans.md から 2026-03-07 にアーカイブ

---

## Sprint: リファクタリング (新機能構築前整理) — 完了 (2026-03-07)

### Wave 1-3: サーバーサイド分割
- [x] matching-service → 4サブモジュール分割
- [x] upload-confirm-job-service → 8サブモジュール分割

### Wave 4: フロントエンドhook抽出
- [x] useCamera.ts / useBarcodeResolver.ts / useCameraDraftRows.ts 抽出
- [x] CameraDeadStockRegisterPanel.tsx 統合
- [x] useDiffPreview.ts / useUploadPreview.ts / useUploadJobPolling.ts 抽出
- [x] useUploadExcelFlow.ts 抽出 → UploadPage.tsx 簡素化 (908→280行)
- [x] useAccountForm.ts / useBusinessHoursForm.ts / useNotificationSettings.ts 抽出
- [x] AccountPage.tsx 簡素化 (726→130行)

### Wave 5: サーバーサイド効率化 (simplify-refact)
- [x] upload-confirm-query-service.ts — createEnumNormalizer + countActiveJobs
- [x] exchange-comments.ts — 4ヘルパー抽出
- [x] exchange-service.ts — 3ヘルパー抽出

### Wave 6: Top 10 Large File Reduction (2026-03-07)
- [x] openclaw-service.ts (853→20行), upload-diff-service.ts (670→359行)
- [x] notifications.ts (744→385行), auth.ts (723→400行)
- [x] upload-parser.ts (720→354行), admin-pharmacies-detail.ts (647→315行)
- [x] useUploadExcelFlow.ts (753→328行), AdminPharmacyEditPage.tsx (725→192行)
- [x] AdminLogCenterPage.tsx (636→297行), BusinessHoursSettings.tsx (593→168行)

---

## Sprint: コードベース品質強化 v0.0.8

> **目的**: セキュリティ強化・パフォーマンス最適化・テストカバレッジ拡充・UX改善の4軸で品質基盤を固める

### Phase 1: セキュリティ強化
- [x] T101: レート制限追加 (passwordChange 10回/時, accountDeletion 3回/日)
- [x] T102: admin-log-center タイムスタンプ検証 (ISO 8601, 90日スパン制限)
- [x] T103: OpenClaw コマンド Zod スキーマ検証

### Phase 2: パフォーマンス最適化
- [x] T104: 交換完了 UPDATE バッチ化 (Promise.all)
- [x] T105: enrichment N+1 → 2パス一括ロード
- [x] T106: マッチングスナップショット一括保存 (M*3→3 DB round trip)
- [x] T107: 薬品マスター同期 UPDATE バッチ化

### Phase 3: テストカバレッジ強化
- [x] T108-T113: 6サービスのテスト追加 (102テスト)

### Phase 4: UX 改善
- [x] T114: PharmacyListPage エラー/空状態の排他表示修正
