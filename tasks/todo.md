- [x] 1) npm run test --workspace=client -- src/test/e2e/admin-upload-jobs-page.test.tsx
- [x] 2) npm run typecheck
- [x] 3) npm run lint
- [x] 4) npm run test
- [x] 5) npm run build:server
- [x] 6) npm run build:client
- [x] 7) npm run openapi:check
- [x] 8) npm run test:openapi-contract --workspace=server

## Security Spot-Check (latest uncommitted changes)
- [x] 1) 対象差分の抽出（cron auth secrets / CSV exports / cancel endpoints / keyword filtering SQL）
- [x] 2) 実装箇所レビュー（P1/P2判定）
- [x] 3) 関連経路レビュー（呼び出し元・同型ユーティリティ・隣接モジュール）
- [x] 4) 追加パターンスキャン（同型潜在箇所の候補抽出）
- [x] 5) 結果を整理して最終報告

## OpenClaw x DeadStockSolution 連携強化 (2026-02-28)
- [x] 1) `system_events` テーブルと記録サービスを追加し、runtime/system error を永続化する
- [x] 2) Vercel deploy error 受信用の内部Webhook（署名/シークレット必須）を実装する
- [x] 3) 管理者向け `GET /api/admin/system-events` を追加し、既存ログ画面で閲覧可能にする
- [x] 4) OpenClaw callback 完了時のユーザー通知作成とユーザー要望ステータス取得APIを追加する
- [x] 5) 新規登録に許可証記載情報入力を追加し、照合ロジックで登録可否を判定する
- [x] 6) 判定結果を審査テーブルへ監査保存し、NG登録を拒否する
- [x] 7) 関連テスト（server/client）を更新する
- [x] 8) typecheck/lint/対象テストで検証し、todo を完了更新する

## 全体速度改善 調査 (2026-03-01)
- [x] 1) サーバー/クライアントの主要ホットパス（matching, notifications, inventory, admin risk）を特定
- [x] 2) SQLパターン（`LIKE '%...%'`, 全件集約, in-memory sort/paginate）を抽出
- [x] 3) フロントの無駄な再フェッチ/ポーリング/大型描画箇所を抽出
- [x] 4) 影響度×実装コストで優先度を付けた改善候補を作成
- [x] 5) 実施順序（Quick Win / 中期 / 構造改善）として提案可能な形に整理

## 全体速度改善 実装 (2026-03-01)
- [x] 1) 公式ベストプラクティス調査（PostgreSQL index/lock/pagination, HTTP圧縮, queue運用）を反映方針へ落とし込む
- [x] 2) Excelアップロード処理を全体逐次化（enqueue後の即時実行無効化、cron処理1件化、並行実行ガード）
- [x] 3) マッチング再計算をデバウンス集約し、連続アップロード完了後にまとめて実行する
- [x] 4) マッチング計算のCPU負荷を削減（薬剤名前処理・使用量インデックスの再利用）
- [x] 5) 高頻度検索とログ検索向けに追加インデックスを導入（trgm + unread/ordering強化）
- [x] 6) 管理者リスク集計をTTLキャッシュ化し全件再集計頻度を抑制
- [x] 7) API応答圧縮とクライアント通知ポーリング最適化を適用
- [x] 8) 関連テストを更新し、typecheck/lint/test/buildで検証
- [x] 9) security/correctness/quality/perf/ux/ops観点レビューを実施し、必要修正を反映
- [x] 10) tasks/lessons.md に学びを追記

## 3点修正フォローアップ (2026-03-01)
- [x] 1) パフォーマンスインデックス作成を `CREATE INDEX CONCURRENTLY` ベースに切り替え、マイグレーション時の書き込みブロッキングを回避する
- [x] 2) matching refresh の常駐スケジューラを導入し、cron専用運用に依存しない構成へ変更する
- [x] 3) 関連テスト更新と `typecheck/lint/test/build` を再実行し、全体整合性を確認する
