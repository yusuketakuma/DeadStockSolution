# tasks/todo.md

## Goal
- デッドストック医薬品追加導線を改善し、Excelアップロードとカメラ取込みを同列導線で提供する。
- カメラ取込み時に画像内のコードを自動検出し、該当候補医薬品を提示して、ユーザー手動確定で登録できるようにする。
- 1フレーム内の複数コードを同時に取り込み、複数医薬品をまとめて登録できるようにする。

### 受け入れ条件
- [x] Upload画面でExcel取込とカメラ取込の導線が同列で表示され、どちらにも即アクセスできる。
- [x] カメラ画像にコードがある場合、コードを自動読取して行に追加され、候補医薬品が表示される。
- [x] 候補医薬品はユーザーが明示的に確定するまでは登録可能状態にならない。
- [x] 画像内の複数コードを一度に取り込み、複数行として追加できる。
- [x] UI改善の根拠となる外部ベストプラクティスを参照し、実装に反映する。
- [x] 既存E2Eが必要箇所で更新され、新要件テストが追加される。

## Plan（Plan mode 相当）
- [x] 影響範囲の特定（explorer）
- [x] 実装（worker_*）
- [x] テスト（test_engineer）
- [x] 検証（typecheck/lint/test）
- [x] 広範レビュー（reviewer_*）
- [x] 修正（必要なら）
- [x] 最終検証
- [x] ドキュメント更新（必要なら）

## Delegation（割当）
- loc_delta_est: medium (<= 800)
- files_changed_est: medium (<= 10)
- tests_added: true
- runtime_est_min: mid (<= 10)
- 役割割当メモ:
  - main: 実装・テスト更新・検証
  - reviewer_*: 実装後に品質/セキュリティ/テスト観点レビュー（必要に応じてsubagent）

## Implementation Log
- 変更点の要約
  - Upload画面をモード切替式から、Excel取込とカメラ取込を同列導線（2カラム/モバイル1カラム）に再構成
  - カメラ取込で、読取コードごとに候補医薬品を自動提示し、ユーザー手動確定後のみ登録可能に変更
  - カメラ画像1フレームからの複数コード同時検出（`BarcodeDetector`優先、ZXing単一読取フォールバック）を追加
  - E2Eテストを新要件へ更新（同列導線、候補手動確定、複数コード同時取込）
- 変更ファイル一覧
  - `client/src/pages/UploadPage.tsx`
  - `client/src/pages/upload/CameraDeadStockRegisterPanel.tsx`
  - `client/src/styles/sections/mobile.css`
  - `client/src/test/e2e/upload-page.test.tsx`
  - `client/src/test/e2e/upload-camera-register.test.tsx`
  - `server/src/test/openclaw-log-push-service-coverage.test.ts`
  - `tasks/todo.md`

## Verification Log
- 実行コマンド:
  - `npm run typecheck:client`
  - `npm run lint --workspace=client`
  - `npm run test --workspace=client -- src/test/e2e/upload-page.test.tsx src/test/e2e/upload-camera-register.test.tsx`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test`
  - `npm run test:client`
  - `npm run test --workspace=server -- src/test/openclaw-log-push-service-coverage.test.ts`
  - `npm run lint --workspace=server`
- 結果:
  - ✅ `typecheck:client` 通過
  - ✅ `lint (client)` 通過
  - ✅ 対象E2E（`upload-page`, `upload-camera-register`）通過
  - ✅ `typecheck`（server+client）通過
  - ✅ `lint`（server+client）通過
  - ✅ `test`（root, server+client）通過
  - ✅ `test:client` 全件通過
  - ✅ `openclaw-log-push-service-coverage` 個別実行も通過

## Review Log（複数観点）
- reviewer_security:
  - subagentはモデル上限制約で実行不可。主担当で手動レビュー実施。
  - 重大指摘なし。読取コードは既存の `normalizeCodeInput` を通過し、危険な制御文字は除去。
- reviewer_quality:
  - subagentはモデル上限制約で実行不可。主担当で手動レビュー実施。
  - P1/P2なし。導線、状態遷移（候補確認待ち→確定済み）、モバイル崩れを確認。
- reviewer_release:
  - root `npm run test` が server + client ともに通過。リリース阻害なし。
- 主要指摘（Severity順）
  - P1: なし
  - P2: なし
  - P3: なし
- 修正対応（実施したもの）
  - `upload-camera-register` の複数コード検出テストで、JSDOM `canvas.getContext` 未実装をモックして安定化。
  - `openclaw-log-push-service-coverage` のOpenClaw設定モックを現行 `OpenClawConfig` 仕様へ追随。

## Done Checklist
- [x] 受け入れ条件を満たした
- [x] typecheck ✅
- [x] lint ✅
- [x] test ✅
- [x] P1/P2 指摘ゼロ（または修正済み）
