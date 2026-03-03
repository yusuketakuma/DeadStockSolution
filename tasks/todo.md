# tasks/todo.md

## 現在の目標（Goal）
- [x] デッドストック登録にカメラ読取導線を追加し、GS1/YJコードで医薬品特定後に数量入力して一括登録できるようにする
- [x] 包装単位・使用期限・ロット番号を可能な範囲で自動取り込みし、不足時は手入力補完できるようにする

## 完了条件（DoD）
- [x] 要件がすべて実装済み
- [x] verifier: typecheck PASS
- [x] verifier: lint PASS（プロジェクト方針に従う）
- [x] verifier: test PASS（必要範囲）
- [x] 広範レビュー（品質/セキュリティ/性能/テスト）P1=0
- [x] “次に進めるなら” が空
- [x] 変更サマリ/リスク/残課題を記録

---

## タスク一覧（Implement all -> Verify -> Wide Review）

### A. 実装（ここを一気に完了）
- [x] TASK-A1: `server/src/services/gs1-parser.ts` を追加し、GS1 AI(01/17/10) + YJコード解析を実装
- [x] TASK-A2: `POST /api/inventory/dead-stock/camera/resolve` を追加（コード解析と医薬品マスタ照合）
- [x] TASK-A3: `POST /api/inventory/dead-stock/camera/confirm-batch` を追加（一括登録・uploads連携・matching refresh連携）
- [x] TASK-A4: `UploadPage` に登録モード切替（Excel/カメラ）を追加
- [x] TASK-A5: `CameraDeadStockRegisterPanel` を新規追加（カメラ読取、手動コード補完、行編集、一括登録）
- [x] NOTE: 実装後に SIMPLIFY を実施（既存 `UploadPage` を壊さず導線追加、複雑化を分離）

### B. 最後にまとめて検証（verifier）
- [x] TASK-B1: typecheck（`npm run typecheck`）
- [x] TASK-B2: lint（`npm run lint`）
- [x] TASK-B3: test（`npm run test --workspace=server -- src/test/gs1-parser.test.ts src/test/inventory-route.test.ts`、`npm run test --workspace=client -- src/test/e2e/upload-page.test.tsx src/test/e2e/upload-camera-register.test.tsx`）
- [x] TASK-B4: build（`npm run build:server && npm run build:client`）

### C. 広範レビュー（後段でまとめて）
- [x] TASK-C1: 品質: 既存Excel取込フローをモード分離して回帰を抑制
- [x] TASK-C2: セキュリティ: サーバー側で件数上限/数量/ID整合性を再検証
- [x] TASK-C3: 性能: 連続スキャン時の重複抑制と逐次resolveで過負荷を抑制
- [x] TASK-C4: テスト: parser単体 + UploadPage回帰 + カメラ登録E2Eの最小セット追加

### D. レビュー指摘の修正（必要なら）
- [x] TASK-D1: parserのFNC1置換バグを修正
- [x] TASK-D2: UploadPageテスト衝突（文言重複）を解消

### E. 最終検証（verifier）
- [x] TASK-E1: 再typecheck/lint/test/build 実施
- [x] TASK-E2: DoD確認

---

## 変更サマリ
- サーバーに GS1/YJ 解析サービスとカメラ登録API（resolve/confirm-batch）を追加。
- カメラ一括登録は `uploads` と `dead_stock_items` に永続化し、matching refresh をトリガー。
- クライアントにカメラ読取登録UIを追加（スマホカメラ、手動補完、数量手入力、一括登録）。
- 既存 `UploadPage` はモード切替で併存し、既存Excel取込導線を維持。
- テストを追加（`gs1-parser.test.ts`、`upload-camera-register.test.tsx`）。
- 追加レビュー修正: GS1括弧形式パース境界バグ（`AI(10)` に次AIの `(` が混入）を修正し、回帰テストを追加。
- 追加レビュー修正: OpenAPI生成ベースラインと契約テストへ `camera/resolve` / `camera/confirm-batch` を反映。
- 追加レビュー修正: サーバールートテストにカメラAPIケースを追加し、手動コード入力の失敗時に入力値を保持するUX修正を実施。
- 最終レビュー修正: `confirm-batch` は `drugName/unit/yakkaUnitPrice/drugCode` をマスタ由来で固定し、クライアント値を信用しない実装に変更。
- 最終レビュー修正: 未一致行向けに `GET /api/inventory/dead-stock/camera/manual-candidates` を追加し、UIから手動医薬品確定できる導線を追加。
- 最終レビュー修正: `expirationDate` の厳密日付検証を追加（擬似日付でDBエラー化しない）。
- 最終レビュー修正: `UploadPage` でカメラ登録パネルを遅延ロード化し、初期バンドルを分離（`UploadPage` chunk 437kB → 16.98kB）。
- 最終レビュー修正: テスト拡充（GS1 resolve、manual-candidates、confirm-batch 正常系・改ざん耐性、未一致→手動確定E2E）。
- 最終レビュー修正(導線): モード別ページ見出しに変更し、モード切替時にExcel系通知状態をクリア。`Excel⇄Camera` 往復時の通知混在を防止するE2Eテストを追加。
- 全体リファクタ開始(低リスク): `UploadPage` のモード切替/ファイル変更で重複していた状態リセット処理を関数化し、`CameraDeadStockRegisterPanel` の未使用行状態（`codeType/drugCode/yakkaUnitPrice`）を削除して状態モデルを簡素化。
- 全体リファクタ開始(低リスク): `inventory.ts` からカメラ登録専用の正規化/照合/候補検索ロジックを `camera-dead-stock-service.ts` へ分離し、ルートの責務をI/O中心に整理。
- 全体リファクタ継続(低リスク): `confirm-batch` の検証/永続化ロジックを `confirmCameraDeadStockBatch` としてサービスへ移管し、ルートはレスポンス制御と監査ログに集中。
- 全体リファクタ再実施(低リスク): manual候補検索に2〜80文字の入力制約を追加し、`camera-dead-stock-service.ts` で薬価null時の`0`誤変換を解消。confirm-batchのコード再解析を同一コード単位でキャッシュして処理コストを削減。
- 全体リファクタ再実施(低リスク): `CameraDeadStockRegisterPanel` に行更新ヘルパーを導入して重複ロジックを削減し、コード解析レスポンスのローカルキャッシュ・入力長制限・再解析の強制リフレッシュ制御を追加。
- 追加検証: `inventory-route.test.ts` にmanual候補検索の境界値(短すぎ/長すぎ)と薬価nullケースを追加し、`typecheck/lint` と server/client 対象テストを再実行して全PASSを確認。

## リスク / 注意点
- ブラウザカメラ機能は HTTPS/対応端末依存のため、端末差異で起動不可ケースがある（手動コード補完で回避可能）。
- resolve API は都度DB参照するため、同時大量読取時はAPI負荷が増える可能性がある。
- カメラ読取値の表記揺れ（ベンダー固有prefixなど）は今後実データで追加チューニング余地あり。
- GS1の可変長AI連結（FNC1省略など）には実運用データ依存の揺れがあるため、実機ログ収集で継続的なパーサ調整が必要。
- リポジトリ全体テスト（`npm run test`）は、今回差分と無関係な `openclaw-log-push-service-coverage.test.ts` 4件失敗が現状残っている（本修正範囲のテストは全PASS）。

## “次に進めるなら”（残すのは禁止。残すなら必ずタスク化）
- （なし）
