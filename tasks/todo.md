# tasks/todo.md

## 2026-02-28 テスト薬局情報「利用できません」回帰修正

### Context
- Prompt: テスト薬局情報は利用できませんとエラーがでます。該当部分を0.0.3の時の実装に戻してください
- Scope:
  - `server/src/routes/auth.ts` のテスト薬局プレビュー有効判定
  - 関連テスト（`server/src/test/auth-route.test.ts`）

### Goals / Definition of Done
- [x] `ENABLE_TEST_PHARMACY_PREVIEW` の既定挙動を `v0.0.3` と同じに戻す
- [x] `production` 既定で `/api/auth/test-pharmacies` が利用可能であることをテストで保証
- [x] 関連テストを通す

### Implementation checklist
- [x] A. `isTestPharmacyPreviewEnabled` を `v0.0.3` 相当（`!== 'false'`）へ戻す
- [x] B. `auth-route` テストを `v0.0.3` 挙動へ更新
- [x] C. サーバー/クライアントのログイン関連テスト実行

### Verification
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run test --workspace=client -- src/test/e2e/login.test.tsx

### Result
- Status: DONE
- Notes:
  - `ENABLE_TEST_PHARMACY_PREVIEW` 未設定時でもテスト薬局情報を提供する `v0.0.3` 挙動へ復帰。
  - 明示的に `ENABLE_TEST_PHARMACY_PREVIEW=false` の場合のみ無効化されることを維持。

## 2026-02-28 総合レビュー指摘の全件修正（第2弾）

### Context
- Prompt: すべて修正
- Scope:
  - 直前の総合レビューで残した P1/P2 指摘（パスワード公開仕様はユーザー承認により除外）

### Goals / Definition of Done
- [x] upload-confirm ジョブの二重処理リスクを解消する
- [x] proposal timeline の誤マッチ検索を解消する
- [x] async upload キューの global 上限競合を解消する
- [x] UploadPage の差分プレビュー状態不整合を解消する
- [x] AdminExchangesPage の片系障害時UX後退を解消する
- [x] OpenClaw CLI パスの環境依存デフォルトを解消する
- [x] cron 設定の重複定義リスクを解消する
- [x] typecheck / lint / tests / build を通す

### Implementation checklist
- [x] A. `runUploadConfirm` の stale 判定を `>=` に修正し、回帰テストを追加
- [x] B. timeline の `proposalId` 検索条件を区切り安全な条件へ修正
- [x] C. `enqueueUploadConfirmJob` に global advisory lock を追加
- [x] D. UploadPage の `diffSummary` / `acknowledgeDeleteImpact` リセットと送信ガードを追加
- [x] E. AdminExchangesPage を `Promise.allSettled` 化し、セクション別エラー表示へ修正
- [x] F. OpenClaw の `OPENCLAW_CLI_PATH` フォールバックを撤廃し、`.env.example` を更新
- [x] G. `server/vercel.json` の cron 重複定義を整理
- [x] H. まとめて検証（typecheck/lint/test/build）

### Verification
- [x] npm run typecheck
- [x] npm run lint
- [x] npm run test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - `runUploadConfirm` の stale ガード比較を `>=` に変更し、同一ジョブ再取得時の二重反映を防止。
  - 提案タイムラインの activity log 検索を `proposalId=<id>|` プレフィックス一致へ変更し、ID部分一致誤マッチを解消。
  - async upload enqueue に global advisory lock を追加して、薬局跨ぎ同時投入時の global 上限競合を抑止。
  - UploadPage でマッピング変更/削除設定変更後に `diffSummary` と確認チェックを無効化し、再プレビュー必須化。
  - AdminExchangesPage は `Promise.allSettled` 化し、コメントとタイムラインを独立取得・独立エラー表示へ変更。
  - OpenClaw CLI の環境依存デフォルトパスを撤廃し、`.env.example` も空値に統一。
  - `server/vercel.json` から cron 定義を削除し、root `vercel.json` 側に集約して二重実行リスクを回避。

## 2026-02-28 コミットレビュー指摘の全件修正

### Context
- Prompt: すべて修正
- Scope:
  - 直前レビューで挙がった P2/P3 指摘（サーバーAPIとテスト）

### Goals / Definition of Done
- [x] 管理系書き込みAPIのレート制限を分割前と同等の共有予算へ戻す
- [x] matching refresh の障害分離後退を解消し、1件不整合で全体停止しない
- [x] batch matching の過負荷リスクを緩和（分割実行）
- [x] 指摘された未カバレッジ経路にテストを追加
- [x] typecheck / lint / tests を通す

### Implementation checklist
- [x] A. admin write limiter を共通化
- [x] B. `runSingleRefresh` に batch 失敗時のフォールバックを追加
- [x] C. `findMatchesBatch` の処理をチャンク化して負荷上限を設ける
- [x] D. `exchange-subroutes` 未カバー経路のテスト追加
- [x] E. `admin-pharmacies-subroutes` 未カバー経路のテスト追加
- [x] F. まとめて検証（typecheck/lint/test）

### Verification
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test

### Result
- Status: DONE
- Notes:
  - `adminWriteLimiter` を [server/src/routes/admin-write-limiter.ts](/Users/yusuke/DeadStockSolution/server/src/routes/admin-write-limiter.ts) に集約し、管理系書き込みAPIで共有。
  - matching refresh はバッチ失敗時に薬局単位 `findMatches` フォールバックで継続し、`MATCHING_REFRESH_BATCH_SIZE`（既定200）で分割実行。
  - `findMatchesBatch` は欠損薬局IDで例外を投げず空候補として処理。
  - 未カバー経路のサブルートテスト（exchange/admin）を追加。

## 2026-02-28 コミット履歴レビュー

### Context
- Prompt: コミット履歴を確認しレビュー
- Scope:
  - `git log` で確認できる最新コミット群（`origin/preview..HEAD`）

### Review checklist
- [x] A. 履歴を構造化してレビュー対象コミットを確定
- [x] B. 各コミット差分を確認して不具合・リスクを抽出
- [x] C. 重要度順にレビュー結果を整理（file/line付き）
- [x] D. 結果を `tasks/todo.md` に記録

### Verification
- [x] `git log --oneline --decorate --graph`
- [x] `git show <commit>`

### Result
- Status: DONE
- Notes:
  - 対象は `origin/preview..HEAD` の11コミット。
  - P1はなし。P2を3件（admin write rate limit緩和、matching refreshの失敗隔離後退、batch matchingの負荷スパイク懸念）指摘。

## 2026-02-27 本番で登録済みテスト薬局が5件表示されない不具合修正

### Context
- Prompt: 登録済みテスト薬局に5件のテスト薬局が表示されていない
- Scope:
  - `server/src/routes/auth.ts` の `GET /api/auth/test-pharmacies`

### Goals / Definition of Done
- [x] テスト薬局一覧APIが固定5件（設定済みデモメール）を対象に返却する
- [x] 本番環境で初回アクセス時に5件デモアカウントを自動同期できる
- [x] auth route / login e2e / lint / typecheck が通る

### Implementation checklist
- [x] A. 一覧フィルタを固定5件メール条件へ変更
- [x] B. 本番向け自動同期（初回1回）を追加
- [x] C. 検証コマンド実行

### Verification
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run test --workspace=client -- src/test/e2e/login.test.tsx
- [x] npm run typecheck --workspace=server
- [x] npm run lint --workspace=server

### Result
- Status: DONE
- Notes:
  - `test-pharmacies` は `TEST_PHARMACY_DEMO_ACCOUNTS` のメール5件を返却対象に固定。
  - `AUTO_SYNC_TEST_PHARMACIES !== 'false'` かつ test 実行環境以外では、初回アクセス時にデモ5件をDBへ自動同期（個別パスワード/active=true）。

## 2026-02-27 テスト薬局5件の個別ID/パスワード化 + DB反映 + 認証確認

### Context
- Prompt: テスト薬局5件のID/パスワードを全件異なる値に変更し、DB登録。ワンクリック表示とログイン認証を確認
- Scope:
  - `server/src/routes/auth.ts`（一覧APIのパスワード返却）
  - `client/src/pages/LoginPage.tsx`（モーダル表示）
  - `server/src/db/seed-test-pharmacy-accounts.ts`（DB反映）

### Goals / Definition of Done
- [x] 5件すべて異なるログイン情報（ID/パスワード）で表示される
- [x] DBに5件の個別パスワード（ハッシュ）が登録される
- [x] 5件すべてでログイン認証が成功する
- [x] IDが `1,2,3,4,5` へ再設定される

### Implementation checklist
- [x] A. テスト薬局5件の固定資格情報を共通設定として追加
- [x] B. `test-pharmacies` APIがアカウントごとのパスワードを返すよう更新
- [x] C. ログイン画面モーダルにID/パスワード表示を追加
- [x] D. DBシードスクリプト追加・実行で5件へ反映
- [x] E. 一覧API確認 + 5件ログイン認証確認
- [x] F. ID `1..5` 固定化シードへ更新し再実行

### Verification
- [x] npm run db:seed-test-pharmacies --workspace=server
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run test --workspace=client -- src/test/e2e/login.test.tsx
- [x] npm run typecheck
- [x] `GET /api/auth/test-pharmacies` 実行結果: `count=5`, `uniquePasswordCount=5`
- [x] 5件ログイン検証（強い `JWT_SECRET` 一時指定）: 全件 `status=200`
- [x] DB直接確認: `pharmacies` のIDが `1..5` で各テスト薬局へ再割当済み

### Result
- Status: DONE
- Notes:
  - テスト薬局5件に個別パスワードを定義し、`/api/auth/test-pharmacies` でアカウントごとに返却するよう更新。
  - DBシードを「非デモ薬局が0件の場合のみ `TRUNCATE ... CASCADE` で再投入」方式へ更新し、IDを `1..5` に固定化。
  - DBシードで5件の `password_hash` を個別パスワードへ更新し、ログイン認証が全件成功することを確認。
  - ログイン画面モーダルにログインID/パスワードを表示し、ワンクリックでフォームへ反映されることをE2Eテストで確認。

## 2026-02-27 テスト薬局5件がログイン一覧に出ない不具合修正

### Context
- Prompt: テスト薬局5件がログイン画面の登録済みテスト薬局一覧に出てこない
- Scope:
  - `server/src/routes/auth.ts` の `GET /api/auth/test-pharmacies` 絞り込み条件

### Goals / Definition of Done
- [x] `TEST_PHARMACY_EMAILS` 設定有無に関わらず、テスト薬局判定パターンに一致するデータが一覧候補になる
- [x] 回帰テストが通る

### Implementation checklist
- [x] A. `test-pharmacies` フィルタ条件を「許可リスト OR テスト薬局パターン」に変更
- [x] B. auth ルートテストを実行

### Verification
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run typecheck --workspace=server

### Result
- Status: DONE
- Notes:
  - `GET /api/auth/test-pharmacies` は `TEST_PHARMACY_EMAILS` が設定されていても、メール許可リスト一致に加えてテスト薬局パターン（`name`/`email`）一致を候補に含めるよう修正。
  - これにより、環境変数が過去設定（2件）のままでも、テスト薬局5件が一覧候補から除外されにくくなった。

## 2026-02-27 UI/UX是正（レビュー→修正 10サイクル）

### Context
- Prompt: UIUXに関するレビュー指摘をすべて修正し、レビュー→修正を10サイクル実施
- Scope:
  - ユーザー自店舗編集（`/account`）UI
  - 管理者全薬局編集（`/admin/pharmacies/:id/edit`）UI
  - 営業時間編集コンポーネント（PC/モバイル）

### Goals / Definition of Done
- [x] 既報のUI/UX指摘（重大度 High/Medium/Low）を全件解消する
- [x] レビュー→修正を10サイクル実施し、各サイクル結果を記録する
- [x] typecheck/lint/test/build を通す

### 10-cycle checklist
- [x] Cycle 1: 営業時間取得失敗時の誤上書きリスクを除去
- [x] Cycle 2: モバイル保存/キャンセル操作のレイアウト改善
- [x] Cycle 3: 管理者の有効/無効操作を一覧・詳細で一貫化
- [x] Cycle 4: フォーム入力支援（inputMode/autoComplete）を追加
- [x] Cycle 5: 画面遷移時の編集中データ保護を追加
- [x] Cycle 6: 無変更保存の抑止とボタン状態最適化
- [x] Cycle 7: 時刻入力の即時バリデーション強化
- [x] Cycle 8: エラー時の再試行導線を明確化
- [x] Cycle 9: モバイル表示密度と可読性の微調整
- [x] Cycle 10: 最終レビュー（security/correctness/quality/perf/ux/ops）でP1=0確認

### Cycle notes
- Cycle 1:
  - `BusinessHoursSettings` に `hoursEditable` / `onRetryLoad` を追加し、取得失敗時は編集ボタンを無効化
  - `AccountPage` / `AdminPharmacyEditPage` で取得失敗時の編集・保存をブロック
- Cycle 2:
  - 営業時間の保存操作コンテナへ `mobile-stack` を適用し、モバイルで縦積みに統一
- Cycle 3:
  - 管理者詳細画面の「有効/無効」を即時反映API (`toggle-active`) に統一
  - 一覧画面と同じ操作モデルに揃え、基本情報保存への依存を解消
- Cycle 4:
  - `AccountInfoForm` に `autoComplete` / `inputMode` / placeholder を追加（email/postal/address/tel/password）
- Cycle 5:
  - 管理者詳細画面で未保存変更がある場合の離脱確認（戻る遷移・ブラウザ離脱）を追加
- Cycle 6:
  - アカウント更新ボタンを「差分あり時のみ有効」に変更
- Cycle 7:
  - 通常営業時間の保存前バリデーション（open/close未入力・同値）を追加
- Cycle 8:
  - 営業時間データ空状態の明示と再読み込み導線をPC/モバイル双方に追加
- Cycle 9:
  - 特例営業時間ヘッダーをモバイルで折り返し可能化（見切れ防止）
- Cycle 10:
  - security/correctness/quality/perf/ux/ops 観点で最終確認し P1=0 を確認

### Verification（最後にまとめて）
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - 既報の High/Medium/Low 指摘を反映し、モバイル/PCの導線と保存安全性を是正
  - 10サイクルのレビュー→修正を完了し、最終検証コマンドを全通過

## 2026-02-27 薬局情報編集権限の整理（管理者=全体 / ユーザー=自店舗）

### Context
- Prompt: 管理者→全薬局情報の閲覧と編集。ユーザー→ログイン中の自店舗情報の閲覧と編集
- Scope:
  - 管理者向け薬局編集APIと編集画面導線
  - 自店舗編集API/UI（メール・許可番号含む）の更新
  - 営業時間（週次/特例）編集保存の両権限対応

### Goals / Definition of Done
- [x] 管理者が任意薬局の基本情報と営業時間を閲覧/編集保存できる
- [x] ユーザーが自店舗の基本情報と営業時間を閲覧/編集保存できる
- [x] 型チェック・lint・テスト・ビルドが通る

### Implementation checklist
- [x] A. `account` ルートを拡張し自店舗のメール/許可番号更新を許可
- [x] B. `admin-pharmacies` ルートに基本情報更新APIを追加
- [x] C. `admin-pharmacies` ルートに営業時間取得/更新APIを追加
- [x] D. 管理画面に薬局編集ページを追加し一覧から遷移可能にする
- [x] E. 検証（typecheck/lint/test/build）を実行

### Verification（最後にまとめて）
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - 管理者向けに `GET/PUT /api/admin/pharmacies/:id` および `GET/PUT /api/admin/pharmacies/:id/business-hours...` を追加し、全薬局の基本情報/営業時間を編集可能化。
  - 管理画面に `/admin/pharmacies/:id/edit` を追加し、一覧から編集画面へ遷移できるようにした。
  - ユーザー向け `PUT /api/account` とアカウント編集UIを拡張し、自店舗のメールアドレス・薬局開設許可番号も編集保存可能にした。

## 2026-02-27 管理者向け薬局編集（営業時間含む）機能追加

### Context
- Prompt: データベースの編集機能として、テスト薬局を含む薬局情報（営業時間など）を編集保存できるように更新
- Scope:
  - `server/src/routes/admin-pharmacies.ts` の編集API追加
  - `client/src/pages/admin` の編集UI追加
  - ルーティング更新
- Assumptions:
  - 管理者のみが利用する機能
  - 基本情報と営業時間を管理画面で編集/保存可能にする

### Goals / Definition of Done
- [x] 管理者が薬局の基本情報（名称・連絡先・住所・メール・許可番号等）を編集保存できる
- [x] 管理者が薬局の週次/特例営業時間を編集保存できる
- [x] 変更後に型チェック・lint・テスト・ビルドが通る

### Implementation checklist
- [x] A. 管理者向け薬局更新API（基本情報）を追加
- [x] B. 管理者向け営業時間取得/更新APIを追加
- [x] C. 管理画面に薬局編集ページを追加し保存UIを実装
- [x] D. 一覧画面から編集ページへ遷移導線を追加
- [x] E. 検証（typecheck/lint/test/build）を実行

## 2026-02-27 テスト薬局5件へ更新（DB登録 + 参照確認）

### Context
- Prompt: テスト薬局名を5件へ変更し、最寄り駅住所/郵便番号でDB登録。電話番号はランダム。DB参照確認まで実施
- Scope:
  - `server/src/routes/auth.ts` の取得件数上限
  - 実DB（`pharmacies`）のテスト薬局データ更新
  - 参照確認（DB直接 + API）
- Assumptions:
  - デモ用テスト薬局は5件表示を想定
  - 既存運用への影響を減らすため既存IDを可能な限り流用

### Goals / Definition of Done
- [x] 指定5名称のテスト薬局がDBに存在する
- [x] 各薬局に駅住所ベースの郵便番号/住所が登録される
- [x] `GET /api/auth/test-pharmacies` でDB由来の5件が取得できる

### Implementation checklist
- [x] A. テスト薬局表示上限を5件へ調整
- [x] B. 5件の薬局データをDBへ反映（update/upsert）
- [x] C. DB直接クエリで登録結果を確認
- [x] D. API応答でDB参照結果を確認
- [x] E. 関連テストを更新・実行

### Verification（最後にまとめて）
- [x] DB直接確認: `pharmacies` から test/テスト条件で5件抽出
- [x] API確認: `GET /api/auth/test-pharmacies` が status 200 で5件返却
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - テスト薬局を以下5件へ更新: 東京店 / 札幌店 / 大阪店 / 福岡店 / 那覇店。
  - 東京店（東京駅）、札幌店（札幌駅）、大阪店（大阪駅）、福岡店（博多駅）、那覇店（那覇空港駅）の住所・郵便番号を登録。
  - `server/src/routes/auth.ts` の `TEST_PHARMACY_PREVIEW_LIMIT` を 5 に変更し、`/api/auth/test-pharmacies` でDB由来の5件取得を確認。

## 2026-02-27 テスト薬局選択でパスワードも自動入力

### Context
- Prompt: パスワードもセットでペーストするようにしてください。デモなのでセキュリティリスクはありません。
- Scope:
  - `server/src/routes/auth.ts` のテスト薬局レスポンス項目拡張（password）
  - `client/src/pages/LoginPage.tsx` の選択反映処理を email+password 同時入力へ変更
  - 関連テスト更新（server/client）
- Assumptions:
  - デモアカウントは共通パスワード運用
  - 共通パスワードは環境変数 `TEST_ACCOUNT_PASSWORD` または `DEMO_ACCOUNT_PASSWORD` で上書き可能

### Goals / Definition of Done
- [x] テスト薬局APIが `password` を返す
- [x] テスト薬局選択時にメール/パスワードが同時入力される（PC/モバイル共通）
- [x] 関連テストと検証コマンドが通る

### Implementation checklist
- [x] A. auth route にデモパスワード解決ロジックを追加しレスポンスへ含める
- [x] B. LoginPage の型/反映処理/説明文を更新
- [x] C. server route test / client login e2e test を更新
- [x] D. 検証（typecheck/lint/test/build）を実行

### Verification（最後にまとめて）
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run test --workspace=client -- src/test/e2e/login.test.tsx
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - `GET /api/auth/test-pharmacies` のレスポンスに `password` を追加し、`TEST_ACCOUNT_PASSWORD` / `DEMO_ACCOUNT_PASSWORD` で上書き可能にした（未設定時は `password123`）。
  - ログイン画面でテスト薬局選択時に `email` と `password` を同時セットするよう更新し、PC/モバイル共通で動作をテストで担保。

## 2026-02-27 本番環境でテスト薬局表示機能を有効化

### Context
- Prompt: 本番環境でもデモアカウント機能表示ができるようにして
- Scope:
  - `server/src/routes/auth.ts` の公開可否判定
  - `server/src/test/auth-route.test.ts` の期待値更新
- Assumptions:
  - 本番でも表示機能を有効にする（必要なら環境変数で明示的に無効化可能）

### Goals / Definition of Done
- [x] 本番環境で `GET /api/auth/test-pharmacies` が既定で利用可能
- [x] 明示的なフラグで無効化できる
- [x] 検証（typecheck/lint/test/build）が通る

### Implementation checklist
- [x] A. `isTestPharmacyPreviewEnabled` の判定ロジックを変更
- [x] B. auth route テストを更新

### Verification（最後にまとめて）
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - `isTestPharmacyPreviewEnabled` を「`ENABLE_TEST_PHARMACY_PREVIEW=false` のときのみ無効」に変更し、本番既定で表示機能を有効化。
  - `auth-route` テストを更新し、「本番既定有効」と「明示無効化時404」の両方を検証。

## 2026-02-27 認証フロー変更のセキュリティレビュー（auth/login）

### Context
- Prompt: latest changes security review
- Scope:
  - `server/src/routes/auth.ts`
  - `client/src/pages/LoginPage.tsx`
  - `client/src/test/e2e/login.test.tsx`
  - `server/src/test/auth-route.test.ts`
  - 関連経路（`middleware/auth.ts`, `api/client.ts`, `contexts/AuthContext.tsx`, `app.ts`）

### Goals / Definition of Done
- [x] 変更点と関連経路の認可境界を確認
- [x] 注入/秘密情報/セッション競合観点を確認
- [x] P1/P2/P3 形式で指摘を整理
- [x] 同型パターンの横展開用 `rg` 提案を準備

### Implementation checklist
- [x] A. 対象4ファイル差分確認
- [x] B. 認可ミドルウェアとマウント境界確認
- [x] C. APIクライアントの401/エラー伝播確認
- [x] D. 同型ルート探索パターン抽出

## 2026-02-27 テスト薬局2件のDB表示ボタン + モバイルUIレビュー

### Context
- Prompt: DB登録済みのテスト薬局2件をワンクリックでウィンドウ表示。モバイル版にも同機能。加えてモバイルUIレビュー
- Scope:
  - `server/src/routes/auth.ts` の取得API追加
  - `client/src/pages/LoginPage.tsx` のUI変更（PC/モバイル）
  - テスト更新（server route / client login e2e）
- Assumptions:
  - 「ウィンドウ」はログイン画面内のモーダル表示を指す
  - DBの平文パスワードは保持されないため、表示情報はDB上の属性（id/name/email/prefecture）
- BLOCKED条件:
  - ローカルDBに対象データが存在しない場合は空状態表示で動作保証

### Goals / Definition of Done
- [x] テスト薬局2件を取得するAPIが実装される
- [x] ログイン画面でワンクリック表示モーダルが使える
- [x] モバイル表示でも同等機能が使える
- [x] モバイルUIレビュー（機能同等/レンダリング）を報告できる
- [x] typecheck/lint/test/build が通る

### Implementation checklist
- [x] A. auth routeにテスト薬局一覧APIを追加
- [x] B. serverテストを追加
- [x] C. LoginPageをモーダル表示フローへ変更
- [x] D. PC/モバイル両表示（responsive）を実装
- [x] E. client e2eテストを更新

### Verification（最後にまとめて）
- [x] npm run typecheck
- [x] npm run lint
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run test --workspace=client -- src/test/e2e/login.test.tsx
- [x] npm test
- [x] npm run build:server
- [x] npm run build:client

### Review（最後にまとめて多観点）
- [x] security
- [x] correctness
- [x] quality
- [x] performance
- [x] ux
- [x] ops

### Result
- Status: DONE
- Notes:
  - `server/src/routes/auth.ts` に `GET /api/auth/test-pharmacies` を追加。`isAdmin=false` / `isActive=true` に加え、`TEST_PHARMACY_EMAILS` 指定時は allowlist、未指定時は `test` / `テスト` を含むアカウントのみ対象化。
  - 本番環境は `ENABLE_TEST_PHARMACY_PREVIEW=true` がない限り 404 で無効化し、公開データ露出リスクを抑止。
  - ログイン画面は「登録済みテスト薬局を表示」ボタンでモーダルを開き、DB取得したテスト薬局情報（ID/薬局名/都道府県/メール）を表示。選択でメールアドレス欄へ反映。
  - モバイルは `AppResponsiveSwitch` でカード表示へ切替し、PC版と同じ選択機能を提供。
  - モバイルUIレビュー結果:
    - 機能同等性: PC/モバイルともに同じAPI・同じ選択アクションを使用（差異なし）。
    - レンダリング: デスクトップは表、モバイルはカードで表示崩れなし（`login.test.tsx` で両分岐を検証）。
    - 追加修正: ボタン文言を「このメールアドレスを入力」に統一し、挙動との不一致を解消。

## 2026-02-27 ログイン画面デモアカウント自動入力ボタン追加

### Context
- Prompt: ログインページ下部にデモアカウントID/パスワードをワンクリック入力するボタンを2つ追加
- Scope:
  - `client/src/pages/LoginPage.tsx` のUI追加
  - 必要なスタイルとテスト更新
- Assumptions:
  - ログイン実行は既存の submit フロー（本番同様）を変更しない
  - デモ資格情報は画面上で明示し、入力補助のみ行う（自動submitしない）
- BLOCKED条件:
  - 実運用デモ資格情報が未確定の場合は仮値で実装し別途差し替え

### Goals / Definition of Done
- [x] ログイン画面下部に2つのデモ入力ボタンが表示される
- [x] クリックでID/パスワードが入力される
- [x] 管理者デモボタンは管理者モードで入力される
- [x] ログイン処理は既存フローのまま（submit時API呼び出し）
- [x] typecheck/lint/test/build が通る

### Implementation checklist
- [x] A. LoginPageにデモアカウント定義と入力ハンドラを追加
- [x] B. ボタンUI（下部配置・a11y属性）を追加
- [x] C. 必要なスタイル追加
- [x] D. e2eテスト追加/更新

### Verification（最後にまとめて）
- [x] npm run typecheck
- [x] npm run lint
- [x] npm run test --workspace=client -- src/test/e2e/login.test.tsx
- [x] npm test
- [x] npm run build:server
- [x] npm run build:client

### Review（最後にまとめて多観点）
- [x] security
- [x] correctness
- [x] quality
- [x] performance
- [x] ux
- [x] ops

### Result
- Status: DONE
- Notes:
  - `client/src/pages/LoginPage.tsx` にデモ薬局/デモ管理者の2つの入力ショートカットを追加。クリックで `email/password` をセットし、管理者ショートカットは `mode=admin` へ切替。
  - ログイン処理は既存 `handleSubmit` をそのまま維持し、API認証フロー（本番同様）は未変更。
  - 追加改善として、環境変数が空文字の場合はフォールバック値を使用するようにし、`loading` 中はショートカットボタンを無効化。
  - `client/src/test/e2e/login.test.tsx` にショートカット挙動のテスト2件を追加し、期待値は環境変数解決ロジックと揃えて環境差分に追従。
  - 多観点レビューで露出リスク指摘があったが、ユーザー指示「デモアカウントなので露出してよい」により許容。露出以外の不具合リスク（空文字env/操作中上書き）を修正してP1=0で完了。

## 2026-02-27 error-handler セキュリティレビュー

### Context
- Prompt: `server/src/middleware/error-handler.ts` の変更を security review
- Scope:
  - 該当差分（ログ挙動変更）
  - 呼び出し元/隣接ログ基盤（`app.ts`, `services/logger.ts`, 関連テスト）
  - 観点: logging behavior / data exposure

### Goals / Definition of Done
- [x] 対象差分のログ露出リスクを評価
- [x] 関連経路（呼び出し元/同型ユーティリティ）を確認
- [x] P1/P2/P3 形式でレビュー結果を提示

### Implementation checklist
- [x] A. `git diff -- server/src/middleware/error-handler.ts` で変更点確認
- [x] B. `app.ts` の接続経路と `logger` 実装を確認
- [x] C. 同型ログ出力パターンを `rg` で横断確認

### Review
- [x] security（logging behavior / data exposure）

## 2026-02-27 上に出ているメッセージ解消

### Context
- Prompt: 上に出ているメッセージを解決して
- Scope:
  - ローカルで再現可能なエラー/警告メッセージの特定
  - 根因修正と検証
- Assumptions:
  - メッセージ本文が省略されているため、現行リポジトリの検証で再現する
- BLOCKED条件:
  - ローカル再現不可かつ外部環境依存

### Goals / Definition of Done
- [x] 対象メッセージを特定できる
- [x] 根因を修正できる
- [x] typecheck/lint/test/build をまとめて通す
- [x] 多観点レビューで P1=0

### Implementation checklist
- [x] A. エラーメッセージの再現手順を確立
- [x] B. 最小変更で修正
- [x] C. 必要なテスト/設定を更新

### Verification（最後にまとめて）
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test
- [x] npm run build:server
- [x] npm run build:client

### Review（最後にまとめて多観点）
- [x] security
- [x] correctness
- [x] quality
- [x] performance
- [x] ux
- [x] ops

### Result
- Status: DONE
- Notes:
  - `npm run test --workspace=server -- src/test/error-handler.test.ts` で `Unexpected end of JSON input` が 400 JSON parse error ログとして出ることを再現。
  - `server/src/middleware/error-handler.ts` に `resolveLogMessage` / `resolveLogStack` を追加し、`entity.parse.failed` 時はログ文言を `Malformed JSON payload` へ正規化し stack を省略。
  - 修正後に同テストを再実行し、対象メッセージの非表示化を確認。
  - 最終検証（typecheck/lint/test/build）を再実行し全成功。
  - 多観点レビューで P1 は 0。P2/P3 提案（`headersSent` ガード、4xxレスポンス正規化、エラーコード付与など）は今回スコープ外の設計改善として別タスク化候補。

## 2026-02-27 Vercel build failure (`tsc: command not found`)

### Context
- Prompt: Vercel preview deploy が `tsc: command not found` で失敗
- Scope:
  - `scripts/vercel-install.sh` の install 挙動
  - `scripts/vercel-build.sh` の prune タイミング整合
  - Vercel 相当条件（`NODE_ENV=production`）での再現・修正確認
- Assumptions:
  - 現行の monorepo workspace 構成（`client` + `server`）を維持する
  - デプロイ成果物最適化（server devDependencies prune）は維持する
- BLOCKED条件:
  - なし（ローカルで再現可能）

### Goals / Definition of Done
- [x] Vercel 相当条件で `client` build が成功する
- [x] `server` の devDependencies は deploy build フローで混入しない
- [x] typecheck/lint/test/build をまとめて通す
- [x] 多観点レビュー（security/correctness/quality/perf/ux/ops）で P1=0

### Implementation checklist
- [x] A. `scripts/vercel-install.sh` を production 環境でも client build ツールチェーンを保持する形に修正
- [x] B. `scripts/vercel-build.sh` のフロー整合（build 成功後に server prod-only install）を確認
- [x] C. Vercel 相当再現コマンドで修正効果を確認

### Verification（最後にまとめて）
- [x] NODE_ENV=production sh scripts/vercel-install.sh
- [x] NODE_ENV=production sh scripts/vercel-build.sh
- [x] (cd client && NODE_ENV=production sh scripts/vercel-install.sh || NODE_ENV=production sh ../scripts/vercel-install.sh)
- [x] (cd client && NODE_ENV=production sh scripts/vercel-build.sh || NODE_ENV=production sh ../scripts/vercel-build.sh)
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test
- [x] npm run build:server
- [x] npm run build:client

### Review（最後にまとめて多観点）
- [x] security
- [x] correctness
- [x] quality
- [x] performance
- [x] ux
- [x] ops

### Result
- Status: DONE
- Notes:
  - `NODE_ENV=production` 条件で `vercel-install` 後に `tsc` が消える不具合を再現し、`scripts/vercel-install.sh` を client workspace に限定して `--include=dev` で導入する方式へ修正。
  - `scripts/vercel-build.sh` は client build 成功後に `npm ci --workspace=server --omit=dev` を実行するフローへ変更し、server 側を prod-only で再構成。
  - Vercel の `client` ルート実行相当（`sh scripts/... || sh ../scripts/...`）でも build 成功を確認。
  - 最終検証（typecheck/lint/test/build）を実行し、全コマンド成功。
  - 多観点レビューで P1 は 0 件。P2 指摘（server dev依存の混入リスク）は上記フロー変更で解消。

## 2026-02-27 リファクタリング5ループ

### Context
- Prompt: リファクタリングタスクを開始 → 次に進む。5回ループさせて
- Scope:
  - 挙動を変えない品質改善を 5 ループで実施
  - 各ループは独立・小規模に分割し、回帰確認しながら進める
- Assumptions:
  - 仕様変更は行わず、保守性・型安全性・重複削減に限定する
  - 既存テストを最優先の安全網として利用する

### Goals / Definition of Done
- [x] Loop 1: `password-reset-service` / `upload-diff-service` の `any` 削減を完了
- [x] Loop 2: `network-utils` の残存 `as any` を除去
- [x] Loop 3: `upload-diff-service` の existing map 構築重複を共通化
- [x] Loop 4: `dead_stock` 変更判定ロジック重複を共通化
- [x] Loop 5: `used_medication` 変更判定ロジック重複を共通化
- [x] 5ループ完了後に typecheck/lint/test/build をまとめて通す

### Implementation checklist
- [x] A1. `password-reset-service.ts` の `tx:any` を型付きへ置換
- [x] A2. `upload-diff-service.ts` の `tx:any/table:any` を型付きへ置換
- [x] B. `network-utils.ts` の DNS pinning 実装を型安全化
- [x] C. `upload-diff-service.ts` の existing map 共通ヘルパー導入
- [x] D. `upload-diff-service.ts` の dead stock 変更判定ヘルパー導入
- [x] E. `upload-diff-service.ts` の used medication 変更判定ヘルパー導入

### Verification
- [x] Loop 1: npm run typecheck
- [x] Loop 1: npm run test:server
- [x] Loop 1: npm run lint --workspace=server
- [x] Loop 2: npm run typecheck --workspace=server
- [x] Loop 2: npm run test --workspace=server -- src/test/network-utils.test.ts
- [x] Loop 3: npm run typecheck --workspace=server
- [x] Loop 3: npm run test --workspace=server -- src/test/upload-diff-service.test.ts
- [x] Loop 4: npm run typecheck --workspace=server
- [x] Loop 4: npm run test --workspace=server -- src/test/upload-diff-service.test.ts
- [x] Loop 5: npm run typecheck --workspace=server
- [x] Loop 5: npm run test --workspace=server -- src/test/upload-diff-service.test.ts
- [x] Final: npm run typecheck
- [x] Final: npm run lint
- [x] Final: npm test
- [x] Final: npm run build:server
- [x] Final: npm run build:client

### Result
- Status: DONE
- Notes:
  - Loop 1 完了済み（`acquirePasswordResetLock` / `UploadDiffTx` の型導入）。
  - Loop 2 完了（`network-utils` の `as any` を除去し `net.LookupFunction` へ置換）。
  - Loop 3 完了（`upload-diff-service` の existing map 構築を `buildExistingByKey` に統一）。
  - Loop 4 完了（`dead_stock` の変更判定を `hasDeadStockRowChanged` に統一）。
  - Loop 5 完了（`used_medication` の変更判定を `hasUsedMedicationRowChanged` に統一）。
  - 追加修正: `insertInBatches` の `rows: unknown[]` を廃止し、`InferInsertModel` ベースのテーブル別バッチ挿入へ置換。
  - 最終検証（typecheck/lint/test/build）を再実行し全成功を確認。
  - 多観点レビューで P1 残件なし。P2提案（重複入力の可視化強化など）は仕様変更を伴うため今回は保留。

## 2026-02-27 全体レビュー指摘修正

### Context
- Prompt: すべて修正
- Scope:
  - 直前の全体レビューで抽出した P1/P2/P3 指摘
  - 対象: password-reset / login UI / upload parser+diff / vercel install script
- Assumptions:
  - 既存仕様は維持しつつ、セキュリティと整合性を優先して最小変更で修正する
  - 互換性破壊が疑われる箇所は後方互換を優先する
- BLOCKED条件:
  - なし（ローカル修正で完結可能）

### Goals / Definition of Done
- [x] P1: パスワードリセットのロック順序問題を解消する
- [x] P2: ログイン画面の資格情報露出を解消する
- [x] P2: upload confirm の `applyMode` 検証を早期化しDoS耐性を改善する
- [x] P3: diff適用時の `rowCount/message` を実反映件数と整合させる
- [x] P3: Vercel install の server dev依存導入を抑制する

### Implementation checklist
- [x] A. `password-reset-service.ts` のトランザクション手順修正
- [x] B. `LoginPage.tsx` / 関連テスト・CSS の修正
- [x] C. `upload-parser.ts` の検証順序・件数整合修正
- [x] D. `vercel-install.sh` の install/prune 戦略修正
- [x] E. 影響テスト更新

### Verification
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test
- [x] npm run build:server
- [x] npm run build:client
- [x] sh scripts/vercel-install.sh
- [x] npm run build:client（install後）

### Result
- Status: DONE
- Notes:
  - `resetPasswordWithToken` のロック順序を「pharmacy advisory lock先行」に変更し、同一薬局同時リセット時のデッドロック経路を除去。
  - ログイン画面のテスト資格情報表示を削除し、関連UIテストを更新。
  - `upload/confirm` は `applyMode` をファイル解析前に検証、未指定時は `replace` として後方互換を維持。
  - diff適用時は `rowCount/message` を `diffSummary.totalIncoming` へ同期。
  - Vercel deploy最適化は `install` 後に `build` 完了時点で `server` dev依存を prune する方式へ変更（install→client build 破綻を回避）。
  - 修正後の多観点再レビューで P1/P2 残件なし（performance は既知の最適化余地のみ）。

## 2026-02-27 その他全体レビュー

### Context
- Prompt: その他全体レビューを行ってください
- Scope:
  - 現在の作業ツリー差分（`git status` で変更中のファイル群）
  - 観点: security / correctness / quality / performance / ux / ops
- Assumptions:
  - 実装変更の提案は行うが、このターンではレビュー報告を主目的とする
  - 指摘は再現可能性と影響度を重視して優先順位付けする
- BLOCKED条件:
  - 外部環境依存で再現不能な不具合のみ、仮説として明示する

### Goals / Definition of Done
- [x] 差分全体を把握し、主要リスク領域を抽出する
- [x] 多観点レビューを実施し、Severity付きで整理する
- [x] 指摘の妥当性を実ファイルで一次検証し、誤検知を除外する
- [x] ユーザーへ findings-first 形式で報告する

### Implementation checklist
- [x] A. 差分サマリ収集（`git diff --stat` / 主要ファイル確認）
- [x] B. 観点別レビュー（security/correctness/quality/perf/ux/ops）
- [x] C. 重要指摘のローカル検証（根拠行・再現条件）
- [x] D. 最終レポート化（P1→P2→P3）

### Verification
- [x] レビュー根拠のファイル/行参照を明記
- [x] 可能な範囲で既存検証結果との整合確認

### Result
- Status: DONE
- Notes:
  - P1 1件（パスワードリセット同時実行時のデッドロック可能性）を確認。
  - P2/P3 は認証情報露出、入力検証順序、件数表示整合、運用最適化を抽出。
  - 既存検証ログ（typecheck/lint/test/build 成功）は前タスク結果と整合。

## 2026-02-27 Node 24 Security Migration Review

### Context
- Prompt: `DeadStockSolution` の Node 20→24 移行互換性リスクを、security 観点でレビュー
- Scope:
  - 設定ファイル（Node/CI/runtime 設定）
  - scripts（デプロイ/ビルド補助含む）
  - tests（実行設定とテストユーティリティ）
  - 関連経路（呼び出し元、同型ユーティリティ、隣接モジュール）
- Assumptions:
  - 既存実装の大規模変更は行わず、レビュー結果の報告を優先
  - 指摘は Node 24 移行に起因・増幅されるセキュリティリスクに限定
- BLOCKED条件:
  - リポジトリ外部の private 設定に依存して判定不能な場合

### Goals / Definition of Done
- [x] Node バージョン固定箇所と実行面（CI/ローカル）を確認
- [x] scripts/tests のセキュリティ関連挙動を Node 24 観点で点検
- [x] 関連経路（呼び出し元・同型）を横断し、migration relevant な指摘のみ抽出
- [x] Severity 順で報告（P1/P2/P3 + fix required now）

### Implementation checklist（先に一気に実施）
- [x] A. 設定ファイル調査（package/workflow/vercel 等）
- [x] B. scripts 調査（実行・認証・秘密情報・注入）
- [x] C. tests/テスト設定調査（env, mock, セッション）
- [x] D. 関連経路の横断（rg パターンで同型抽出）
- [x] E. migration relevant finding のみで最終レポート作成

### Result
- Status: DONE
- Notes:
  - Node 24 実行環境（`v24.14.0`/`npm 11.9.0`）で security 重点テストを実行し全件成功。
  - Node 24 非対応 engine 制約は `package-lock.json` 走査で 0 件を確認。
  - migration relevant な security リスクのみ抽出して最終報告。

## 2026-02-27 Node 24 Compatibility Scan

### Context
- Prompt: node依存を24にしました。支障がないかリポジトリ全体をスキャン
- Scope:
  - このリポジトリ全体（`/Users/yusuke/DeadStockSolution`）
  - Node 24 互換性に関わる設定・依存・実行検証
- Assumptions:
  - 互換性判定は「設定整合性 + 既存検証コマンドの成功 + 明確な非互換シグナル不在」を基準とする
  - 破壊的な依存更新は行わず、問題があれば指摘ベースで報告する
- BLOCKED条件:
  - 必須シークレット未設定でテストが実行不能な場合
  - 外部サービス依存によりローカル検証不能な場合

### Goals / Definition of Done
- [x] Node バージョン指定の整合性を確認する
  - 完了条件: workflow / package 設定上で Node 24 と矛盾する指定がない
- [x] 依存パッケージの Node engine 制約を横断確認する
  - 完了条件: Node 24 を明示的に拒否する engine 制約がない、または該当を列挙できる
- [x] 主要検証（typecheck → lint → test → build）を実行する
  - 完了条件: 全コマンド成功、失敗時は原因と影響を明確化
- [x] 多観点レビュー（security/correctness/quality/perf/ux/ops）を実施する
  - 完了条件: P1 指摘の有無を明示し、必要なら修正と再検証を実施

### Implementation checklist（先に一気に実装）
- [x] A. 設定・バージョン指定の横断スキャン
- [x] B. package-lock の engine 制約スキャン
- [x] C. 一括検証コマンド実行（typecheck/lint/test/build）
- [x] D. 多観点レビュー集約

### Verification（最後にまとめて）
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test
- [x] npm run build:server
- [x] npm run build:client

### Review（最後にまとめて多観点）
- [x] security
- [x] correctness
- [x] quality
- [x] performance
- [x] ux
- [x] ops

### Fixes（レビュー指摘の反映）
- [x] P1修正
  - `scripts/vercel-install.sh`: workspace 単位で `npm ci` を2回実行して client build ツールチェーンを消していたため、1回の `npm ci`（client+server同時）へ修正。
  - `server/package.json`: `undici` の暗黙的transitive依存を解消するため直接依存へ追加。
- [x] 再検証（typecheck/lint/test/build）
  - 標準検証（typecheck/lint/test/build:server/build:client）全成功。
  - 追加再現検証（`sh scripts/vercel-install.sh` 後の `npm run build:client`、`undici` import）も成功。

### Result
- Status: DONE
- Notes:
  - `package-lock.json` 全660パッケージの `engines.node` を走査し、Node 24 非互換は 0 件。
  - 受容したP2（理由付き）:
    - `engines.node` / `packageManager` の未固定（運用規約で吸収可能、推奨改善）。
    - Vercel functions runtime の `nodejs24.x` 明示なし（プロジェクト設定側と整合が取れていれば即時破綻はしない）。
    - `@types/node` が runtime Node 24 より新しい（型/runtime 乖離リスクはあるが現行検証では顕在化なし）。

## Context
- Prompt: このmac全体からnode 20の依存を24に変更して
- Assumptions（保守的仮定）:
  - 変更対象は `/Users/yusuke` 配下の開発関連ファイル（ソース管理される設定ファイル）に限定する
  - バイナリ・キャッシュ・`node_modules`・`.git` は編集対象外
  - Node バージョン指定は `20` 系（`20`, `20.x`, `v20.*`）を `24` 系へ更新する
- BLOCKED条件（あれば）:
  - システム管理領域（`/System`, `/Library` など）への変更が必要な場合
  - 外部ツール管理下（Homebrew Formula の upstream 未対応など）で強制更新できない場合

## Goals / Definition of Done
- [x] ゴール1: `/Users/yusuke` 配下で Node 20 依存設定を網羅検出する
  - 完了条件: 検出対象ファイル一覧を作成し、更新対象/対象外を分類できる
  - 検証方法: `rg` による再検索で対象パターンが把握できること
  - 影響範囲: dotfiles, project configs, CI/workflow files
- [x] ゴール2: Node 20 指定を Node 24 指定へ更新し、破綻がないことを確認する
  - 完了条件: 対象ファイルが更新済みで、主要プロジェクト検証が実行済み
  - 検証方法: `typecheck/lint/test/build`（可能範囲）と差分確認
  - 影響範囲: このリポジトリおよび `/Users/yusuke` 配下の該当設定

## Implementation checklist（先に一気に実装）
- [x] 実装パケットA（担当: worker_heavy）: Node 20 指定の横断検索と更新対象確定
- [x] 実装パケットB（担当: worker_heavy）: Node 24 への一括更新（安全対象のみ）
- [x] テスト追加（担当: test_writer）: 既存テスト実行で回帰確認（新規テスト不要なら理由明記）
  - 新規テスト不要。設定変更のため既存検証コマンドで回帰確認。

## Verification（最後にまとめて）
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test（必要ならfilter→全体）
- [x] npm run build（必要なら）
  - `npm run build` は script 未定義のため、代替として `npm run build:server` と `npm run build:client` を実行（ともに成功）。

## Review（最後にまとめて多観点）
- [x] security
- [x] correctness
- [x] quality
- [x] performance
- [x] ux
- [x] ops
  - P1 指摘なし（バージョン固定値更新のみ、機能コード変更なし）。

## Fixes（レビュー指摘の反映）
- [x] P1修正
  - P1なしのため追加修正不要。
- [x] 再検証（typecheck/lint/test）
  - `typecheck/lint/test` は全成功、build 代替検証も成功。

## Result
- Status: DONE
- Notes:
  - 変更対象: `DeadStockSolution` / `careroute-rx` / `.codex/worktrees/*/careroute-rx` の Node 20 指定を Node 24 系へ更新。
  - 実行環境: `nvm uninstall 20.20.0` 実施済み（既定は `v24.14.0`）。
  - 除外対象: `.bun`・`.npm-cache`・`.local/share/opencode`・`.claude/plugins/cache` 等のキャッシュ/外部配布物。
  - 再検索結果: 実設定に残る Node 20 指定なし（コメント例示・外部拡張 package の `^18.20.4` を除く）。

## 2026-02-27 リファクタリング継続（batch insert 重複除去）

### Context
- Prompt: 続きを開始
- Scope:
  - `server/src/routes/upload-parser.ts` の replace モード内 batch insert ループ重複
  - 挙動を変えずに共通ヘルパー化
- Assumptions:
  - INSERT_BATCH_SIZE と既存 slice 範囲の意味は維持する
  - SQL発行順序と件数は変更しない

### Goals / Definition of Done
- [x] dead_stock / used_medication の batch insert ループ重複を単一ヘルパーに統一
- [x] 既存アップロード系テストが成功する
- [x] server typecheck/lint/build が成功する

### Implementation checklist
- [x] `insertInBatches(totalCount, insertBatch)` ヘルパーを `upload-parser.ts` に追加
- [x] dead_stock の for ループを helper 呼び出しへ置換
- [x] used_medication の for ループを helper 呼び出しへ置換

### Verification
- [x] npm run test --workspace=server -- src/test/upload-route.test.ts
- [x] npm run test --workspace=server -- src/test/upload-inventory-flow.test.ts
- [x] npm run typecheck --workspace=server
- [x] npm run lint --workspace=server
- [x] npm run build:server

### Result
- Status: DONE
- Notes:
  - `upload-parser.ts` の dead_stock / used_medication 両経路で重複していた batch insert ループを `insertInBatches` に統一。
  - `INSERT_BATCH_SIZE` と `slice(start, end)` の境界は変更せず、既存の挿入件数・順序を維持。
  - 対象2テスト + server typecheck/lint/build を実行し全成功。

## 2026-02-27 リファクタリング継続（row mapping 重複除去）

### Context
- Prompt: 続きを開始
- Scope:
  - `server/src/routes/upload-parser.ts` の replace モード内 row mapping 重複
  - dead_stock / used_medication 共通の drug master link 付与と数値文字列化を共通化
- Assumptions:
  - DB挿入スキーマ・値変換ルール（null処理/文字列化/日付正規化）は維持する
  - 既存APIレスポンスと副作用は変更しない

### Goals / Definition of Done
- [x] row mapping 重複を helper 関数へ分離し、replace 経路の可読性を向上
- [x] 既存アップロード系テストが成功する
- [x] server typecheck/lint/build が成功する

### Implementation checklist
- [x] `InferInsertModel` ベースの `DeadStockInsertRow` / `UsedMedicationInsertRow` 型を導入
- [x] `toNumericText` / `normalizeExpirationDateIso` / `extractDrugMasterLinkFields` を追加
- [x] `toDeadStockInsertRow` / `toUsedMedicationInsertRow` を追加
- [x] replace 経路の `sourceRows.map(...)` を helper 呼び出しへ置換

### Verification
- [x] npm run test --workspace=server -- src/test/upload-route.test.ts
- [x] npm run test --workspace=server -- src/test/upload-inventory-flow.test.ts
- [x] npm run typecheck --workspace=server
- [x] npm run lint --workspace=server
- [x] npm run build:server

### Result
- Status: DONE
- Notes:
  - replace 経路の inline mapping を削減し、dead_stock / used_medication それぞれの Insert row 生成責務を関数化。
  - `drugMasterId` / `drugMasterPackageId` / `packageLabel` の null 正規化を `extractDrugMasterLinkFields` に集約。
  - `expirationDateIso` の正規化ロジックは `normalizeExpirationDateIso` へ抽出し、既存判定条件を維持。

## 2026-02-27 リファクタリング（useAsyncState + findMatches 分解）

### Context
- Prompt: コードリファクタリング
- Scope:
  - client: `loading/error/message` の useState 重複を `useAsyncState` フックに統一
  - server: `findMatches`（318行）を複数のヘルパー関数に分解
- Assumptions:
  - 挙動を変えない品質改善のみ
  - 既存テストを安全網として利用

### Goals / Definition of Done
- [x] Loop 1: `useAsyncState` フック作成 + LoginPage 適用
- [x] Loop 2: `useAsyncState` を RegisterPage/DeadStockListPage/UploadPage に適用
- [x] Loop 3: `useAsyncState` を MatchingPage/ProposalDetailPage に適用
- [x] Loop 4: `findMatches` から `fetchViablePharmacies`/`fetchReservationMap` を抽出
- [x] Loop 5: `findMatches` から `buildMatchItems` を抽出
- [x] 最終検証（typecheck/lint/test/build）を通す

### Verification
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test（client: 111 passed / server: 367 passed）
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - `client/src/hooks/useAsyncState.ts` を新規作成し、5ページ（LoginPage/RegisterPage/DeadStockListPage/UploadPage/MatchingPage/ProposalDetailPage）に適用。
  - `matching-service.ts` の `findMatches` を 318行 → 251行 → 最終的に 387行ファイル（ヘルパー3関数追加）に整理。
  - `fetchViablePharmacies`（51行）、`fetchReservationMap`（17行）、`buildMatchItems`（25行）を抽出。
  - 全検証（typecheck/lint/test/build）成功。P1 指摘なし。

## 2026-02-27 Full verification rerun (latest working tree)

### Context
- Prompt: Re-run full verification on latest working tree in `/Users/yusuke/DeadStockSolution`
- Scope: typecheck / lint / test / build:server / build:client

### Verification checklist
- [x] npm run typecheck
- [x] npm run lint
- [x] npm test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - `npm run typecheck` 成功
  - `npm run lint` 成功
  - `npm test` 成功（失敗なし）
  - `npm run build:server` 成功
  - `npm run build:client` 成功

## 2026-02-27 テストアカウント数に応じた表示件数の可変化

### Context
- Prompt: テストアカウント数に応じて表示件数を変える
- Scope:
  - `server/src/routes/auth.ts` の `GET /api/auth/test-pharmacies`
  - `server/src/test/auth-route.test.ts`

### Goals / Definition of Done
- [x] テスト薬局一覧APIが固定値に依存せず、現在のテストアカウント数に追従して返却する
- [x] 既存の回帰テストが通る

### Implementation checklist
- [x] A. 固定件数定数を削除し、件数上限を動的化（または不要化）
- [x] B. auth routeテストの期待値を固定 `5` 依存から外す
- [x] C. 検証実行（auth-route test + server typecheck/lint）

### Verification
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run typecheck --workspace=server
- [x] npm run lint --workspace=server

### Result
- Status: DONE
- Notes:
  - `GET /api/auth/test-pharmacies` の固定上限 `5` を廃止し、`TEST_PHARMACY_DEMO_ACCOUNTS.length` を上限に使用するよう変更。
  - デモアカウント設定が0件の場合は `accounts: []` を返すガードを追加。
  - auth routeテストの期待値を固定 `5` から `TEST_PHARMACY_DEMO_ACCOUNTS.length` 参照へ変更し、回帰確認済み。

## 2026-02-27 本番 `/api/auth/test-pharmacies` 500 修正（自動同期 fail-open）

### Context
- Prompt: `GET /api/auth/test-pharmacies` が本番で500
- Scope:
  - `server/src/routes/auth.ts`
  - `server/src/test/auth-route.test.ts`

### Goals / Definition of Done
- [x] 自動同期が失敗しても `/api/auth/test-pharmacies` が500にならずレスポンスを返す
- [x] 回帰テストで fail-open の挙動を担保する
- [x] server auth-route test / typecheck / lint が通る

### Implementation checklist
- [x] A. `ensureDemoAccountsSynced` を try/catch で fail-open 化
- [x] B. 同期失敗時でも一覧APIが200を返すテストを追加
- [x] C. 検証実行（auth-route test + server typecheck/lint）

### Verification
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run typecheck --workspace=server
- [x] npm run lint --workspace=server

### Result
- Status: DONE
- Notes:
  - `ensureDemoAccountsSynced` を fail-open 化し、同期失敗時は警告ログを残して一覧取得処理を継続するよう変更。
  - 本番相当 (`NODE_ENV=production`) かつ `VITEST` 無効で自動同期が失敗しても `GET /api/auth/test-pharmacies` が200を返す回帰テストを追加。

## 2026-02-27 テストアカウント5件の一覧取りこぼし修正

### Context
- Prompt: テストアカウントは5件登録しているはず
- Scope:
  - `server/src/routes/auth.ts` の `GET /api/auth/test-pharmacies` 抽出条件

### Goals / Definition of Done
- [x] 登録済み5件が抽出条件で取りこぼされにくいようにする
- [x] 回帰テスト / typecheck / lint が通る

### Implementation checklist
- [x] A. 抽出条件を「固定メール or 固定ID」の OR 条件へ調整
- [x] B. 検証実行（auth-route test + server typecheck/lint）

### Verification
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run typecheck --workspace=server
- [x] npm run lint --workspace=server

### Result
- Status: DONE
- Notes:
  - `test-pharmacies` の抽出条件を `email in fixed list OR id in [1..5]` に変更し、状態フラグ差異による取りこぼしを緩和。

## 2026-02-27 薬局情報にテストアカウントフラグ追加（5件適用）

### Context
- Prompt: 薬局情報に「テストアカウント」フラグを追加し、フラグ判定でテストアカウント扱いに変更。DB列追加と既存5件へ反映
- Scope:
  - DBスキーマ / マイグレーション
  - `server/src/routes/auth.ts`（テスト薬局判定）
  - 管理者向け薬局情報API/UI（フラグ表示・編集）
  - テスト薬局シード/同期処理

### Goals / Definition of Done
- [x] `pharmacies` に `is_test_account` 列を追加し運用可能にする
- [x] テスト薬局判定ロジックが `is_test_account=true` 基準で動作する
- [x] 既存5件のテスト薬局に `is_test_account=true` が付与される
- [x] 管理画面の薬局情報でフラグを閲覧・編集できる
- [x] 関連テスト / typecheck / lint が通る

### Implementation checklist
- [x] A. schema と migration を追加（既存5件 true 更新SQL含む）
- [x] B. auth ルートとシード/同期をフラグ基準に変更
- [x] C. admin API/UI に `isTestAccount` 追加（一覧/詳細/更新）
- [x] D. 検証実行（server test/typecheck/lint + client typecheck）

### Verification
- [x] npm run db:migrate --workspace=server
- [x] DB確認（tsx one-liner）: `is_test_account=true` の5件（ID 1..5）を確認
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run test --workspace=client -- src/test/e2e/login.test.tsx
- [x] npm run typecheck --workspace=server
- [x] npm run lint --workspace=server
- [x] npm run typecheck --workspace=client
- [x] npm run lint --workspace=client

### Result
- Status: DONE
- Notes:
  - `server/drizzle/0016_add_is_test_account_flag.sql` で `pharmacies.is_test_account` 列を追加。
  - `/api/auth/test-pharmacies` は `is_test_account=true` の薬局をテストアカウントとして返却するロジックに変更。
  - デモ同期（`syncDemoAccountsToDatabase`）とシード（`seed-test-pharmacy-accounts.ts`）で `isTestAccount: true` を永続化。
  - 管理画面（一覧/編集）で `isTestAccount` を表示・更新可能にし、編集画面にスイッチを追加。

## 2026-02-28 previewで `is_test_account` 未反映時の500復旧（後方互換）

### Context
- Prompt: Vercel previewで `/api/auth/test-pharmacies` が500（`is_test_account` を使うクエリ失敗）
- Scope:
  - `server/src/routes/auth.ts`
  - `server/src/test/auth-route.test.ts`

### Goals / Definition of Done
- [x] `is_test_account` 列が未存在でも `/api/auth/test-pharmacies` が500にならない
- [x] auto-syncが旧スキーマでもデモ5件を投入できる
- [x] `/auth/me` も列未存在時に後方互換レスポンスで継続できる
- [x] 回帰テスト / typecheck / lint が通る

### Implementation checklist
- [x] A. `is_test_account` 未存在（42703）を判定するヘルパーを追加
- [x] B. `test-pharmacies` を flag query → legacy query（email/id）へフォールバック
- [x] C. demo auto-sync を flag upsert → legacy upsert へフォールバック
- [x] D. `/auth/me` の列参照も legacy fallback を追加
- [x] E. auth route テストに fallback ケースを追加

### Verification
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run typecheck --workspace=server
- [x] npm run lint --workspace=server

### Result
- Status: DONE
- Notes:
  - preview DBのマイグレーション遅延時でも `test-pharmacies` が利用可能になるよう、列未存在時の互換ロジックを追加。
  - 互換ロジックは `is_test_account` が使える環境では自動的に新ロジックへ戻る。

## 2026-02-28 テスト薬局A/B参照の全廃（実在5件へ統一）

### Context
- Prompt: テスト薬局Aとテスト薬局Bは存在しないため、全ファイルを修正
- Scope:
  - server/client のテストデータと期待値
  - 文字列・メール参照（`テスト薬局A/B`, `test-a@example.com`, `test-b@example.com`）

### Goals / Definition of Done
- [x] `テスト薬局A/B` と `test-a/test-b` 参照がリポジトリから消えている
- [x] 実在するテスト薬局（東京店/札幌店/大阪店/福岡店/那覇店）へ置換されている
- [x] 変更したテストがすべて通る

### Implementation checklist
- [x] A. `client/src/test/e2e/login.test.tsx` のモック/期待値を東京店・札幌店へ変更
- [x] B. `client/src/test/e2e/routes-meta.test.tsx` の薬局名を東京店・大阪店へ変更
- [x] C. `server/src/test/auth-route.test.ts` のA/B参照を東京店・札幌店へ変更
- [x] D. 全体検索で残存参照がないことを確認

### Verification
- [x] `rg -n "テスト薬局A|テスト薬局B|test-a@example.com|test-b@example.com" -S .`（残存なし）
- [x] npm run test --workspace=server -- src/test/auth-route.test.ts
- [x] npm run test --workspace=client -- src/test/e2e/login.test.tsx src/test/e2e/routes-meta.test.tsx

### Result
- Status: DONE
- Notes:
  - A/B由来の名称・メール参照を実在5件に統一し、期待値も同時更新した。

## 2026-02-28 DBを唯一ソース化（コード側テストデータ撤去）

### Context
- Prompt: データベースを唯一のデータとし、コード側にテストデータを持たない
- Scope:
  - `server/src/routes/auth.ts` の固定テストアカウント依存除去
  - `pharmacies` のテストアカウント表示用パスワード列追加
  - 管理者UI/APIでテストアカウントパスワードを編集可能化
  - 固定テストデータ設定ファイル/シードの撤去または非依存化

### Goals / Definition of Done
- [x] `/api/auth/test-pharmacies` がDB列のみを根拠に返却する
- [x] ランタイムコードが固定テスト薬局リスト/固定パスワードMapに依存しない
- [x] 管理者がDB上のテストアカウント情報（フラグ/表示用パスワード）を編集できる
- [x] 主要テストと型/lintが通る

### Implementation checklist
- [x] A. schema+migrationで `test_account_password` 列を追加
- [x] B. auth route の固定設定依存を削除し、DB列参照へ変更
- [x] C. admin API/UI に `testAccountPassword` 編集を追加
- [x] D. 固定テストデータ定義ファイルの依存を除去
- [x] E. 検証（server/client関連テスト + typecheck/lint）

### Verification
- [x] npm run typecheck
- [x] npm run lint
- [x] npm run test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - ヘッダー/ログイン画面のバージョン表示を撤去し、`V2`ラベルの露出をなくした。
  - 月次レポートDLリンクを`buildApiUrl`へ置換し、`/api`直書き依存を除去した。
  - APIクライアントを改善し、GET/HEADで`Content-Type`を送らない・`ApiError.code`参照可能・CSRF判定を`/auth/csrf-token`特例のみへ整理した。
  - `test-pharmacies`は本番で`ENABLE_TEST_PHARMACY_PREVIEW=true`時のみ有効化し、既定でパスワードを返さない（`includePassword=1`指定時のみ返却）運用へ変更した。
  - アップロード上限を`50MB / 100,000行`へ拡張し、Excelパースキャッシュにエントリ数/総容量/対象サイズの制限を追加してメモリ安定性を向上した。

### Result
- Status: DONE
- Notes:
  - `server/drizzle/0017_chemical_cloak.sql` で `pharmacies.test_account_password` を追加し、テストアカウント表示用パスワードをDB管理へ移行。
  - `GET /api/auth/test-pharmacies` は `is_test_account=true AND test_account_password IS NOT NULL` のDB条件のみで返却し、固定デモ配列依存を削除。
  - `server/src/config/test-pharmacy-demo-accounts.ts` を削除し、固定テストデータがランタイムに混入しない構成へ変更。
  - 管理者編集画面でテストアカウント表示用パスワードを編集可能化し、更新API側で整合性（テストアカウント時必須）を検証。
  - パスワード再設定/本人パスワード変更時、テストアカウントなら `test_account_password` も同期更新するようにし、一覧表示との不整合を防止。

## 2026-02-27 薬局一覧の営業・距離表示不具合修正 + preview/production DB統一設定

### Context
- Prompt: 薬局一覧の営業・距離が表示されていない問題を修復。データベースをpreviewとproduction環境で統一し、設定を見直して変更
- Scope:
  - `client/src/components/BusinessStatusBadge.tsx`
  - `server/src/routes/pharmacies.ts`
  - `server/src/config/database.ts` / `server/drizzle.config.ts`
  - Vercel/DB運用設定（README / env example / workflow）

### Goals / Definition of Done
- [x] 薬局一覧で営業ステータスが未設定営業時間でも欠落せず表示される
- [x] 薬局一覧で距離ソート未指定時でも距離が返却・表示される
- [x] preview/productionで同一DBを利用できる共通接続設定を追加し、既存設定との後方互換を維持する
- [x] typecheck/lint/test/build を通す

### Implementation checklist
- [x] A. 営業ステータス表示ロジックの欠落ケースを修正
- [x] B. 薬局一覧APIの距離算出を常時返却に修正し、テストを更新
- [x] C. DB接続設定を見直し、preview/prod統一用の環境変数優先ロジックを追加
- [x] D. README / `.env.example` / workflow 設定を更新
- [x] E. 検証（typecheck/lint/test/build）を実行

### Verification
- [x] npm run test --workspace=server -- src/test/pharmacies-route.test.ts src/test/database-url-config.test.ts
- [x] npm run test --workspace=client -- src/components/__tests__/BusinessStatusBadge.test.tsx
- [x] npm run typecheck
- [x] npm run lint
- [x] npm run test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - `BusinessStatusBadge` を修正し、営業時間未設定で `isOpen=true` の場合も「営業中」を表示するようにした。
  - `GET /api/pharmacies` は通常ソートでも距離を返すようにしつつ、DB側の重い距離演算は `sortBy=distance` 時のみに限定して負荷を抑えた。
  - DB接続は `POSTGRES_URL_UNIFIED` / `POSTGRES_URL_NON_POOLING_UNIFIED` を最優先で解決し、preview環境では `POSTGRES_URL_PRODUCTION` 系の上書きを許可。
  - 非プーリングURLの解決順を補正し、previewで `POSTGRES_URL_PRODUCTION` のみ指定時でも接続先が分岐しないようにした（P1修正）。
  - `NODE_ENV=production` または `VERCEL_ENV` がある環境でDB URL未設定時は即エラー停止（fail-closed）するよう改善。
  - multi-perspective review（security/correctness/quality/perf/ux/ops）を実施し、P1=0を確認。

## 2026-02-28 営業時間表示仕様の修正（未設定表示）+ Vercel DB統一設定の実施

### Context
- Prompt: 1を実施（preview/production DB統一設定）。営業時間は「設定ありなら営業時間内/外、未設定なら未設定表示」。テスト有無に依存しない
- Scope:
  - Vercel project env (`POSTGRES_URL_UNIFIED` / `POSTGRES_URL_NON_POOLING_UNIFIED`)
  - `client/src/components/BusinessStatusBadge.tsx`
  - `client/src/components/__tests__/BusinessStatusBadge.test.tsx`

### Goals / Definition of Done
- [x] Vercel Preview/Productionで同一DB接続設定が有効化される
- [x] 営業時間未設定の薬局は `未設定` 表示になる
- [x] 営業時間設定済みの薬局は営業時間内/外を表示する
- [x] typecheck/lint/test/build を通す

### Implementation checklist
- [x] A. Vercel環境変数を確認し、共通DB URLをPreview/Productionへ適用
- [x] B. `BusinessStatusBadge` の表示分岐を仕様に合わせて更新
- [x] C. コンポーネントテストを更新
- [x] D. 検証（typecheck/lint/test/build）

### Verification
- [x] `npx vercel env ls production`
- [x] `npx vercel env ls preview`
- [x] `npx vercel env pull /tmp/deadstock-vercel/.env.production.updated --environment=production --yes`
- [x] `npx vercel env pull /tmp/deadstock-vercel/.env.preview.updated --environment=preview --git-branch=preview --yes`
- [x] `POSTGRES_URL_UNIFIED` / `POSTGRES_URL_NON_POOLING_UNIFIED` が preview/prod 同値であることを確認
- [x] npm run test --workspace=client -- src/components/__tests__/BusinessStatusBadge.test.tsx
- [x] npm run typecheck
- [x] npm run lint
- [x] npm run test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - Vercelへ `POSTGRES_URL_UNIFIED` と `POSTGRES_URL_NON_POOLING_UNIFIED` を追加し、ProductionとPreview（`preview` branch override）で同一DB URLに統一。
  - `BusinessStatusBadge` は営業時間未設定パターン（`isOpen=true`, `is24Hours=false`, `todayHours=null`, `closingSoon=false`）を `未設定` 表示へ変更。
  - 営業時間設定済みのケースは従来どおり `営業中` / `営業時間外` / `24時間営業` を表示。

## 2026-02-28 営業状態表示の誤判定修正（設定済みなのに未設定表示）

### Context
- Prompt: 営業状態が未設定表示になるが、現在時刻では営業時間外のはず。現在時刻取得可否も確認したい
- Scope:
  - `server/src/routes/pharmacies.ts`
  - `server/src/routes/inventory.ts`
  - `server/src/services/matching-service.ts`
  - `server/src/types/index.ts`
  - `client/src/components/BusinessStatusBadge.tsx`
  - 関連テスト

### Goals / Definition of Done
- [x] 営業時間設定済み薬局は、現在時刻に応じて `営業中` / `営業時間外` が表示される
- [x] 営業時間未設定薬局のみ `未設定` が表示される
- [x] 現在時刻の取得経路を確認し、回答できる状態にする
- [x] typecheck/lint/test/build が通る

### Implementation checklist
- [x] A. サーバー側レスポンスに営業時間設定済みフラグ（`isConfigured`）を付与
- [x] B. クライアント表示を `isConfigured` ベースへ変更
- [x] C. 既存テストの期待値更新と回帰確認
- [x] D. 検証（typecheck/lint/test/build）

### Verification
- [x] `date '+%Y-%m-%d %H:%M:%S %Z'` -> `2026-02-28 02:32:49 JST`
- [x] npm run test --workspace=server -- src/test/pharmacies-route.test.ts src/test/inventory-route.test.ts
- [x] npm run test --workspace=client -- src/components/__tests__/BusinessStatusBadge.test.tsx
- [x] npm run typecheck
- [x] npm run lint
- [x] npm run test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - サーバーの `businessStatus` に `isConfigured` フラグを付与し、営業時間設定有無を明示的に返すようにした（pharmacies / inventory / matching）。
  - `BusinessStatusBadge` の未設定判定を推測ロジックから `isConfigured === false` へ変更し、設定済み薬局の誤判定を防止。
  - 現在時刻は `new Date()` を起点に取得され、営業時間判定は `Asia/Tokyo` 基準で計算されることを確認。

## 2026-02-28 モニターサイズ連動の自動レイアウト調整

### Context
- Prompt: モニターサイズにあわせて画面サイズを自動調整したい
- Scope:
  - `client/src/styles/design-language.css`

### Goals / Definition of Done
- [x] デスクトップでモニター幅に応じてコンテンツ幅が自動拡張/縮小する
- [x] モバイル幅では既存の全幅レイアウトを維持する
- [x] ビルドが成功する

### Implementation checklist
- [x] A. `.app-theme .content-container` の `max-width` を動的計算へ変更
- [x] B. デスクトップ/モバイルのメディアクエリを明示
- [x] C. client buildで確認

### Verification
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - `@media (min-width: 992px)` で `max-width: min(1800px, calc(100vw - var(--sidebar-width) - 2rem))` を適用し、モニター幅に連動してコンテンツ幅が自動調整されるようにした。
  - `@media (max-width: 991.98px)` では `max-width: 100%` を維持し、モバイル表示を崩さないようにした。

## 2026-02-28 現行全面刷新（第1弾）: バージョン表示撤去・API連携安定化・大容量アップロード耐性

### Context
- Prompt: Implement the plan（`V2`表記なしで現行を完全アップデート刷新）
- Scope:
  - `client/src/components/Header.tsx`
  - `client/src/pages/LoginPage.tsx`
  - `client/src/pages/admin/AdminMonthlyReportsPage.tsx`
  - `client/src/api/client.ts`
  - `client/src/styles/**`
  - `client/src/test/**`
  - `server/src/routes/auth.ts`
  - `server/src/routes/upload-validation.ts`
  - `server/src/services/upload-service.ts`
  - `server/src/test/auth-route.test.ts`

### Goals / Definition of Done
- [x] 画面上のバージョン表示（`v*`）を撤去
- [x] FEの`/api`直書きダウンロードリンクをAPIベースURL経由へ統一
- [x] APIクライアントでGET/HEADに`Content-Type`を送らない
- [x] APIエラー`code`を`ApiError`で参照可能にする
- [x] CSRF除外パスの重複依存を削減（クライアント側は`/auth/csrf-token`のみ特例）
- [x] テスト薬局プレビューの保護を強化（本番は明示有効化のみ）
- [x] Excelアップロード上限を`50MB / 100,000行`へ拡張
- [x] Excelパースキャッシュを容量制御化しメモリ安定性を改善
- [x] typecheck/lint/test/build が通る

### Implementation checklist
- [x] A. Header/Loginのバージョン表示削除と関連テスト更新
- [x] B. Monthly report downloadリンクを`buildApiUrl`へ変更
- [x] C. API clientのheader/CSRF/ApiError改善
- [x] D. test-pharmaciesの本番有効化条件とパスワード返却制御追加
- [x] E. upload validation/serviceの上限・キャッシュ制御改善
- [x] F. 検証（typecheck/lint/test/build）

### Verification
- [x] npm run typecheck
- [x] npm run lint
- [x] npm run test
- [x] npm run build:server
- [x] npm run build:client

## 2026-02-28 現行全面刷新（第2弾）: 非同期アップロードジョブ基盤（DBキュー）導入

### Context
- Prompt: 次に進む
- Scope:
  - `server/src/db/schema.ts`
  - `server/drizzle/0019_upload_confirm_jobs.sql`
  - `server/src/services/upload-confirm-service.ts`
  - `server/src/services/upload-confirm-job-service.ts`
  - `server/src/routes/upload-parser.ts`
  - `server/src/routes/internal-upload-jobs.ts`
  - `server/src/app.ts`
  - `vercel.json`, `server/vercel.json`
  - `server/src/test/upload-route.test.ts`

### Goals / Definition of Done
- [x] 非同期アップロードジョブテーブルを追加
- [x] upload confirm処理をサービス化し、同期/非同期で共通化
- [x] `POST /api/upload/confirm-async` を追加
- [x] `GET /api/upload/jobs/:jobId` を追加
- [x] cron retry向け `GET /api/internal/upload-jobs/retry` を追加
- [x] Vercel cron設定を追加
- [x] 既存同期`/confirm`互換を維持
- [x] typecheck/lint/test/build が通る

### Implementation checklist
- [x] A. schema+migration 追加（`upload_confirm_jobs`）
- [x] B. confirm本体ロジックを `upload-confirm-service` へ抽出
- [x] C. job enqueue/claim/retry処理を `upload-confirm-job-service` へ実装
- [x] D. upload routesへ async confirm と job status API を追加
- [x] E. internal route + app mount + vercel cron を追加
- [x] F. upload route tests を更新・追加
- [x] G. 全体検証

### Verification
- [x] npm run typecheck
- [x] npm run lint
- [x] npm run test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - 既存同期 `POST /api/upload/confirm` のレスポンス仕様は維持したまま、内部実装を共通サービスへ移行。
  - 新規 `POST /api/upload/confirm-async` はジョブIDを返し、即時処理を試行しつつ未処理はDBキューへ残す。
  - 新規 `GET /api/upload/jobs/:jobId` でジョブ状態（pending/processing/completed/failed）と結果JSONを取得可能。
  - `GET /api/internal/upload-jobs/retry`（Bearer secret必須）で保留ジョブ再処理を実行可能。
  - Vercel cronに `/api/internal/upload-jobs/retry` を追加し、10分ごと再処理を有効化。

## 2026-02-28 現行全面刷新（第3弾）: 非同期アップロード運用強化（FE連携 + キュー安定化）

### Context
- Prompt: 次に進む
- Scope:
  - `client/src/pages/UploadPage.tsx`
  - `client/src/api/client.ts`
  - `client/src/test/e2e/upload-page.test.tsx`
  - `server/src/services/upload-confirm-job-service.ts`
  - `server/src/routes/upload-parser.ts`
  - `server/src/routes/internal-upload-jobs.ts`
  - `server/src/test/upload-route.test.ts`
  - `server/src/test/internal-upload-jobs-route.test.ts`

### Goals / Definition of Done
- [x] フロントのアップロード確定処理を非同期ジョブAPI（`/confirm-async` + `/jobs/:id`）へ統合
- [x] 大容量アップロード時のネットワーク待ちに耐えるため upload timeout を拡張可能化
- [x] 薬局単位のアップロードジョブ過積載を抑止（キュー上限）
- [x] 完了/失敗ジョブの定期クリーンアップを追加し、蓄積による劣化を抑止
- [x] 既存同期互換を維持しつつ、エラー応答（429含む）を明確化
- [x] typecheck/lint/test/build が通る

### Implementation checklist
- [x] A. `UploadPage` を async confirm + polling に更新
- [x] B. API client の `api.upload` に timeout オプション追加
- [x] C. upload confirm job service に queue limit / cleanup 機能追加
- [x] D. upload parser route で queue limit エラーを 429 応答
- [x] E. internal upload jobs route で retry + cleanup を実行
- [x] F. client/server テストを更新・追加
- [x] G. 全体検証（typecheck/lint/test/build）

### Verification
- [x] npm run test --workspace=server -- src/test/upload-route.test.ts src/test/internal-upload-jobs-route.test.ts
- [x] npm run test --workspace=client -- src/test/e2e/upload-page.test.tsx src/test/api-client.test.ts
- [x] npm run typecheck
- [x] npm run lint
- [x] npm run test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - `UploadPage` の登録フローを `POST /api/upload/confirm-async` + `GET /api/upload/jobs/:id` ポーリングへ切替し、待機中/処理中ステータスを画面表示。
  - ポーリング失敗時はジョブ表示状態/受付メッセージをクリアし、処理中の `uploadType` 変更を無効化して誤遷移を防止。
  - `api.upload` に `timeout` オプションを追加し、50MB級アップロードのネットワーク待機に対応。
  - `upload-confirm-job-service` に薬局単位 advisory lock を用いた原子的な上限判定+投入（既定3件）を導入し、過積載時は `UPLOAD_CONFIRM_QUEUE_LIMIT` を返すよう実装。
  - stale `processing` ジョブを再取得可能にし、入力起因エラーは非再試行で即 `failed` へ遷移するよう再試行制御を改善。
  - `cleanupUploadConfirmJobs` を追加し、`/api/internal/upload-jobs/retry` 実行時に完了/失敗ジョブの古いレコードを同時クリーンアップ。`limit`/`cleanupLimit` クエリで処理件数を調整可能にした。
  - `UPLOAD_CONFIRM_PROCESS_ON_ENQUEUE=true` の場合のみ即時処理を起動し、既定は cron ワーカー運用へ。upload jobs cron は毎分実行へ更新。
  - ルートテスト/クライアントE2Eを更新し、429応答・非同期完了フロー・internal route の認証/実行を回帰担保。

## 2026-02-28 Security review: upload async flow (targeted files + related paths)

### Context
- Prompt: Review recent changes for security issues
- Scope:
  - `client/src/pages/UploadPage.tsx`
  - `client/src/api/client.ts`
  - `server/src/services/upload-confirm-job-service.ts`
  - `server/src/routes/upload-parser.ts`
  - `server/src/routes/internal-upload-jobs.ts`
  - Related paths (callers / sibling utilities / auth middleware)

### Review checklist
- [x] A. 対象5ファイルの差分と現状実装を確認
- [x] B. 認可・権限境界（fail-open / unknown resource）を確認
- [x] C. 注入・情報露出・秘密情報ログを確認
- [x] D. abuse risk / DoS（queue, polling, retry, timeout）を確認
- [x] E. 関連経路（呼び出し元・同型モジュール）を spot-check
- [x] F. Severity順で具体的 findings を整理（file:line）

### Verification
- [x] コード読解ベースレビュー（必要箇所を `rg` / `sed` で参照）
- [x] findings の再現条件をコード上で確認

### Result
- Status: DONE
- Notes:
  - Concrete findings: P1 1件 / P2 1件 / P3 1件。
  - 主因は upload async queue の非原子上限制御と、失敗理由のそのまま返却。

## 2026-02-28 Security re-review: upload async flow (P1 only, updated files)

### Context
- Prompt: Re-review only updated files for remaining P1 security issues after fixes
- Scope:
  - `server/src/services/upload-confirm-job-service.ts`
  - `server/src/routes/upload-parser.ts`
  - `server/src/routes/internal-upload-jobs.ts`
  - `client/src/pages/UploadPage.tsx`
  - Related paths (caller/adjacent auth flow for these files only)

### Review checklist
- [x] A. 対象4ファイルの現状実装を確認
- [x] B. 認可・権限境界（fail-open / unknown resource）を再確認
- [x] C. 注入・秘密情報露出・セッション競合を再確認
- [x] D. 関連経路（呼び出し元/隣接）を最小範囲で spot-check
- [x] E. P1のみを判定して報告

### Result
- Status: DONE
- Notes:
  - P1観点（認可破綻 / 重大注入 / 秘密情報露出 / セッション破綻）で再確認し、対象差分および隣接経路で追加のP1は未検出。

## 2026-02-28 現行全面刷新（第4弾）: 非同期アップロード運用の堅牢化（エラー秘匿 + ポーリング最適化 + 観測性）

### Context
- Prompt: 続きを実行
- Scope:
  - `server/src/routes/upload-parser.ts`
  - `server/src/routes/internal-upload-jobs.ts`
  - `client/src/pages/UploadPage.tsx`
  - `client/src/test/e2e/upload-page.test.tsx`
  - `server/src/test/upload-route.test.ts`
  - `server/src/test/internal-upload-jobs-route.test.ts`

### Goals / Definition of Done
- [x] ジョブ失敗時に内部エラー詳細をクライアントへ露出しない
- [x] UploadPage のジョブポーリングを状況に応じたバックオフへ最適化
- [x] internal upload jobs cron の成功ログを構造化出力
- [x] 追加変更の回帰テストを更新
- [x] typecheck/lint/test/build が通る

### Implementation checklist
- [x] A. job status API の `lastError` をサニタイズ（必要なら code 付与）
- [x] B. UploadPage の polling interval を適応制御へ変更
- [x] C. internal upload jobs route に成功ログを追加
- [x] D. server/client テスト更新
- [x] E. 全体検証

### Verification
- [x] npm run test --workspace=server -- src/test/upload-route.test.ts src/test/internal-upload-jobs-route.test.ts
- [x] npm run test --workspace=client -- src/test/e2e/upload-page.test.tsx src/test/api-client.test.ts
- [x] npm run typecheck
- [x] npm run lint
- [x] npm run test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - `GET /api/upload/jobs/:jobId` は失敗時の `lastError` をユーザー向け文言へ変換し、`lastErrorCode` を返すように変更（内部例外文言の直接露出を抑止）。
  - `UploadPage` はポーリング待機を固定値から適応バックオフ（pendingの経過時間に応じて1.5s→3s→5s）へ変更し、失敗時は受付メッセージ/進行表示をクリアするよう改善。
  - `internal-upload-jobs` cron は成功時に `processed/cleaned/processLimit/cleanupLimit` を構造化ログ出力。
  - 追加テストとして、失敗ジョブのサニタイズ応答・upload jobs route のクエリ上限・UploadPageの失敗時表示を回帰担保した。

## 2026-02-28 現行全面刷新（第5弾）: 非同期アップロード最終安定化（競合防止 + メモリ圧縮 + 運用設定）

### Context
- Prompt: 続きを実行。残タスクを全て完了させて
- Scope:
  - `server/src/services/upload-confirm-job-service.ts`
  - `server/src/services/upload-confirm-service.ts`
  - `server/src/routes/upload-parser.ts`
  - `server/src/middleware/error-handler.ts`
  - `server/src/services/upload-diff-service.ts`
  - `server/src/db/schema.ts`
  - `server/drizzle/0020_uploads_requested_at.sql`
  - `server/drizzle/meta/_journal.json`
  - `client/src/pages/UploadPage.tsx`
  - `server/.env.example`
  - `vercel.json`
  - `server/vercel.json`
  - `server/src/test/upload-route.test.ts`
  - `server/src/test/upload-inventory-flow.test.ts`
  - `server/src/test/error-handler.test.ts`
  - `server/src/test/upload-diff-service.test.ts`
  - `client/src/test/e2e/upload-page.test.tsx`

### Goals / Definition of Done
- [x] 同一薬局・同一種別の古い非同期ジョブが新しい確定結果を上書きしない
- [x] 非同期ジョブのファイル保持を圧縮化し、完了/終端失敗時に生データを保持しない
- [x] upload job retry 判定を構造化し、解析系エラーの無駄リトライを止める
- [x] diff適用の更新処理をバッチ化し、大量更新時のSQL往復を削減する
- [x] UploadPage のジョブポーリングで一時的な通信失敗を自動リトライできる
- [x] error-handler が任意の内部 `err.code` をクライアントへ露出しない
- [x] monthly report cron と関連env例を整備する
- [x] typecheck/lint/test/build が通る

### Implementation checklist
- [x] A. upload confirm job service: stale job skip / payload compression / terminal payload clear / retry classification改善
- [x] B. upload parser route: job error code解決をprefix対応へ拡張
- [x] C. upload diff service: 更新系の一括バッチUPDATE導入
- [x] D. UploadPage: poll transient error retry + backoff追加
- [x] E. error-handler: 公開エラーコードの許可制化
- [x] F. cron/env設定: monthly report cron追加・env example追記
- [x] G. server/client テスト更新
- [x] H. 全体検証（typecheck/lint/test/build）

### Verification
- [x] npm run test --workspace=server -- src/test/upload-route.test.ts src/test/upload-inventory-flow.test.ts src/test/upload-diff-service.test.ts src/test/error-handler.test.ts
- [x] npm run test --workspace=client -- src/test/e2e/upload-page.test.tsx
- [x] npm run typecheck
- [x] npm run lint
- [x] npm run test
- [x] npm run build:server
- [x] npm run build:client

### Result
- Status: DONE
- Notes:
  - 非同期ジョブのファイル保存を `gzip + base64` へ変更し、`completed/terminal failed` 時は payload を即クリアするようにした（DB肥大化/露出リスクを低減）。
  - 同期/非同期の上書き競合を防ぐため、`runUploadConfirm` に薬局+種別の advisory lock を導入し、`uploads.requested_at`（要求時刻）基準で stale 判定を実装。
  - stale判定の誤判定回避のため `uploads.requested_at` を追加し、前方互換マイグレーション `0020_uploads_requested_at.sql` と Drizzle journal 追記を実施。
  - upload diff の更新処理を `UPDATE ... FROM (VALUES ...)` バッチ方式へ変更し、大量更新時のSQL往復を削減。
  - UploadPage はジョブ状態取得の一時失敗（timeout/5xx/429）を自動リトライするよう改善し、長時間待機時のメッセージも改善。
  - `error-handler` は公開エラーコードを許可制にし、内部 `err.code` の漏えいを抑止。
  - `monthly reports` cron を root/server の Vercel 設定へ追加し、関連 env (`UPLOAD_JOBS_CRON_SECRET`, `MONTHLY_REPORT_CRON_SECRET`, `MONTHLY_REPORT_SCHEDULER_ENABLED`, `UPLOAD_CONFIRM_MAX_ACTIVE_JOBS_GLOBAL`) を `.env.example` に追記。
  - 最終の再レビュー（security/correctness/performance）で P1 残件なしを確認。

## 2026-02-28 次期開発計画（機能改善・機能追加 / 項目4除外）

### Context
- Prompt: 再度つぎのかいはつけいかくをたてて
- Constraint:
  - 以前提示した改善候補のうち「4. オブジェクトストレージ移行」は今回スコープ外
  - 既存機能互換を維持しつつ、可用性・性能・安定性を優先
  - データ変換・移行はダウンタイムゼロ（expand/dual-write/backfill/contract）

### Scope（実装対象）
- [ ] 1. アップロードジョブ管理画面（履歴/再実行/キャンセル/状態可視化）
- [ ] 2. 行単位エラー診断 + 部分成功モード（valid行のみ反映）
- [ ] 3. 重複登録防止（冪等化: file hash + pharmacy + uploadType）
- [ ] 5. マッチングルールエンジン化（管理画面から重み調整）
- [ ] 6. 期限切迫・過剰在庫の予兆通知
- [ ] 7. 監査ログ強化（誰が何を変更したか）
- [ ] 8. API契約テスト（OpenAPI）導入

### Goal / Definition of Done
- [ ] 主要ユーザー操作（アップロード・マッチング・通知）が可視化/追跡可能
- [ ] 大量データ投入時に「全失敗」ではなく、行単位で復旧可能
- [ ] 二重取り込み/再実行による重複登録を抑止
- [ ] ルール変更をコード改修なしで運用調整可能
- [ ] 予兆通知で在庫滞留/期限切迫を先回り検知
- [ ] 監査ログで変更責任を追跡可能
- [ ] OpenAPI契約テストがCIで常時実行
- [ ] 各フェーズで typecheck/lint/test/build と P1=0 を維持

### Phase Plan
- [ ] Phase 1（運用可視化 + 安全性の土台）
  - [ ] A1. Upload Jobs API拡張（一覧/詳細/再実行/キャンセル/再取得）
  - [ ] A2. 管理画面 `AdminUploadJobsPage` 追加（検索/絞り込み/再試行）
  - [ ] A3. 冪等キー（`idempotency_key`）導入と重複検知レスポンス標準化
  - [ ] A4. 監査ログイベント拡張（upload/job/admin action）

- [ ] Phase 2（データ品質・復旧性）
  - [ ] B1. 行単位バリデーション結果モデル追加（error row report）
  - [ ] B2. `applyMode=partial` 実装（valid rowsのみ反映）
  - [ ] B3. エラーレポートDL（CSV/JSON）とUI表示
  - [ ] B4. 失敗パターン集計（頻出カラム不備/型不一致の可視化）

- [ ] Phase 3（最適化・提案精度）
  - [ ] C1. マッチングルール設定テーブル追加（重み/閾値/距離係数）
  - [ ] C2. ルール反映サービス化（Feature Flagで段階切替）
  - [ ] C3. 予兆通知ジョブ追加（期限切迫・滞留・変動）
  - [ ] C4. ダッシュボード導線（対応アクションへ1クリック遷移）

- [ ] Phase 4（契約保証と回帰抑止）
  - [ ] D1. OpenAPI仕様生成/固定（server routes基準）
  - [ ] D2. API契約テスト導入（主要エンドポイント）
  - [ ] D3. CI組み込み（契約破壊変更をfail-fast）
  - [ ] D4. Runbook更新（ゼロダウンタイム手順・ロールバック）

### Zero-Downtime Migration Policy（全フェーズ共通）
- [ ] Expand: 追加カラム/追加テーブルのみ先行デプロイ（既存読取維持）
- [ ] Dual-write: 新旧モデルへ並行書き込み（読みは旧優先）
- [ ] Backfill: バックグラウンドで段階移行（進捗メトリクス出力）
- [ ] Switch-read: 検証後に読取を新モデルへ切替（Flag管理）
- [ ] Contract: 旧カラム削除は十分な観測期間後に実施

### Verification Gate（各Phase完了時）
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run build:server`
- [ ] `npm run build:client`
- [ ] multi-perspective review（security/correctness/quality/perf/ux/ops）で P1=0

### Deliverable Order（推奨）
- [ ] Sprint 1: Phase 1（A1-A4）
- [ ] Sprint 2: Phase 2（B1-B4）
- [ ] Sprint 3: Phase 3（C1-C4）
- [ ] Sprint 4: Phase 4（D1-D4）
