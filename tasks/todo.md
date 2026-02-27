# TODO（Codex）

## 目標（Goal）
- [x] 医療システムに適したログインUI/UXへ改善する
- [x] 認証画面に共通で使えるデザイン言語（トークン + 共有コンポーネント）を導入する
- [x] リサーチ根拠をドキュメント化し、実装との対応関係を明確にする

## 設計/方針（Plan）
- [x] 変更方針（トレードオフ含む）
- [x] 影響範囲（依存元/依存先/境界）
- [x] 検証計画（実行コマンド列）

## 実装（Implementation Sprint）
- [x] デザイン言語CSS（トークン・状態表現・レスポンシブ）を追加
- [x] Auth共通レイアウトコンポーネントを追加
- [x] StatusAlert共通コンポーネントを追加
- [x] LoginPageを新デザインへ刷新
- [x] RegisterPage / PasswordResetPageへ共通デザイン適用
- [x] Login E2Eテストを新UIに合わせて更新

## 一括検証（Verification）
- [x] typecheck

---

## 追加タスク（UIUX全体スキャン→提案→改善→レビュー）

## 目標（Goal）
- [x] 全画面のUI/UXをスキャンして改善候補を優先度付きで抽出する
- [x] 抽出した改善候補を共通コンポーネント中心に実装する
- [x] 最終レビューでP1/P2をゼロにする

## 実装（Implementation Sprint）
- [x] `AppSelect` のa11y強化（aria/label関連付け、説明文関連付け）
- [x] 認証入力の `autocomplete/inputMode/enterKeyHint` を付与
- [x] 一覧系画面の loading/error/retry/empty を標準化（DeadStock/UsedMedication/Pharmacy/AdminLogs 等）
- [x] 生 `button` の残存箇所を共通ボタンへ統一（DashboardNotices/ProposalPrint/Matching/Account/DrugMasterTable）
- [x] セキュリティ/正確性修正（`target=_blank` の `rel`、`0%` 表示バグ、Upload必須マッピング制御）
- [x] テストモック厳密化（誤マッチ防止）

## 一括検証（Verification）
- [x] typecheck
- [x] test:client

## 広域レビュー（Review）
- [x] P1/P2指摘を修正
- [x] 再レビューで P1/P2 = 0 を確認

---

## 追加タスク（モバイルUI共通化）

## 目標（Goal）
- [x] モバイルでもPCと同等の情報を閲覧できるUIへ統一する
- [x] モバイル向け共通コンポーネントを追加し、画面へ横展開する

## 実装（Implementation Sprint）
- [x] `AppResponsiveSwitch` を追加（desktop/mobile 切替）
- [x] `AppMobileDataCard` を追加（モバイル一覧カードの共通化）
- [x] デザイン言語CSSへモバイルカード/レスポンシブ切替スタイルを追加
- [x] 一覧系主要画面へモバイルカードUIを適用（在庫/履歴/薬局/管理画面）
- [x] `mobile-hide` 依存を解消し、モバイル情報欠落を解消

## 一括検証（Verification）
- [x] typecheck
- [x] test:client

## 広域レビュー（Review）
- [x] 最終レビューで P1/P2 = 0 を確認
- [x] test:client

---

## 追加タスク（残数ゼロ化）

## 目標（Goal）
- [x] 把握済みの残数（`Card` / `Form.Control` / `Alert` / `Button` / `Table` / `Modal`）を全件移行する

## 実装（Implementation Sprint）
- [x] 共通ラッパー追加（`AppControl`, `AppCard`, `AppAlert`, `AppButton`, `AppTable`）
- [x] 全画面の直書き `Card/Form.Control/Alert/Button/Table/Modal` を共通部品へ置換
- [x] `RequestModal`, `DrugMasterDetailModal` を `AppModalShell` ベースへ統一
- [x] 直書き残数再集計を更新（対象6種すべて 0）

## 一括検証（Verification）
- [x] typecheck
- [x] test:client

---

## 追加タスク（モーダル共通化）

## 目標（Goal）
- [x] `DrugMasterEditModal` を共通モーダル/共通入力へ統一する
- [x] `Form.Control` と `Modal` の直書きをさらに削減する

## 実装（Implementation Sprint）
- [x] `AppField` に `controlClassName` / `labelClassName` / `min,max,step` を追加
- [x] `DrugMasterEditModal` を `AppModalShell` 化
- [x] `DrugMasterEditModal` の入力群を `AppField` 化
- [x] ギャップ再集計（`Form.Control: 25`, `Modal: 9`）

## 一括検証（Verification）
- [x] typecheck
- [x] test:client

---

## 追加タスク（フォーム共通化）

## 目標（Goal）
- [x] `RegisterPage` と `AccountInfoForm` の入力を `AppField` に統一する
- [x] `Form.Control` 直書きをさらに削減する

## 実装（Implementation Sprint）
- [x] `AppField` に `controlId` と `onChange` 任意対応を追加
- [x] `RegisterPage` の入力群を `AppField` 化
- [x] `AccountInfoForm` の入力群を `AppField` 化
- [x] `AccountInfoForm` の外枠を `AppDataPanel` 化
- [x] ギャップレポート再集計（`Form.Control: 33`, `Card: 48`）

## 一括検証（Verification）
- [x] typecheck
- [x] test:client

---

## 追加タスク（KPIカード共通化）

## 目標（Goal）
- [x] KPI系カードの共通テンプレート化を行う
- [x] 高頻度カード画面に適用して `Card` 直書きを大幅削減する

## 実装（Implementation Sprint）
- [x] `AppKpiCard` を追加
- [x] `AdminDashboardPage` のKPIカードを `AppKpiCard` に置換
- [x] `DrugMasterStatsCards` を `AppKpiCard` に置換
- [x] `DashboardStatusCards` のカード群を `AppDataPanel` 化
- [x] ギャップレポートを再集計で更新（`Card: 50`）

## 一括検証（Verification）
- [x] typecheck
- [x] test:client

---

## 追加タスク（共通パターン拡大・再開）

## 目標（Goal）
- [x] 使用頻度の高い入力/パネル/モーダルシェルを共通コンポーネント化する
- [x] 優先画面に適用して未共通化箇所を削減する

## 実装（Implementation Sprint）
- [x] `AppField` を追加
- [x] `AppDataPanel` を追加
- [x] `AppModalShell` を追加
- [x] `ConfirmActionModal` を `AppModalShell` 化
- [x] `AdminDashboardPage` に `AppField` / `AppDataPanel` を適用
- [x] `ProposalDetailPage` に `AppDataPanel` を適用
- [x] `BusinessHoursSettings` に `AppDataPanel` を適用
- [x] ギャップレポートを再集計で更新

## 一括検証（Verification）
- [x] typecheck
- [x] test:client
- [x] lint（N/A: `package.json` に lint script 未定義）
- [x] tests
- [x] 失敗があれば修正して再実行（合格まで）

## 広域レビュー（Review）
- [x] 正確性
- [x] セキュリティ
- [x] 性能
- [x] 保守性
- [x] UX/DX
- [x] テスト/回帰
- [x] 運用（CI/CD/設定）

## 修正→再検証→再レビュー
- [x] 指摘修正
- [x] Verification再実行
- [x] Review再実行（P1/P2ゼロまで）

## 完了サマリ
- 変更点：
- 影響：
- 検証ログ：
- ロールバック：

---

## 追加タスク（全画面デザイン適用）

## 目標（Goal）
- [x] 認証画面だけでなく保護画面全体へ共通デザイン言語を適用する
- [x] 共通デザインコンポーネントを全画面ルートに適用する

## 実装（Implementation Sprint）
- [x] `AppScreen` 共通コンポーネントを追加
- [x] `Layout` で全保護画面を `AppScreen` + `app-theme` へ統一
- [x] デザイン言語CSSを全画面向けに拡張（header/sidebar/card/table/form/button/alert）
- [x] CSS読み込み順を調整して新デザインを最終適用
- [x] 設計ドキュメントに全画面適用マッピングを追記

## 一括検証（Verification）
- [x] typecheck
- [x] tests（routes/login/register/password-reset）

---

## 追加タスク（汎用プリセット拡張 + 未共通化特定）

## 目標（Goal）
- [x] インターネット一次情報に基づく汎用デザインを事前定義する
- [x] 共通コンポーネント化できていない箇所を件数付きで特定する

## 実装（Implementation Sprint）
- [x] `high-legibility` プリセットを追加
- [x] フォーカス可視化・最小操作領域・reduced motion の共通ルールを追加
- [x] `docs/generic-design-presets.md` に根拠リンクを追記
- [x] `docs/componentization-gap-report.md` を件数ベースで再生成

## 一括検証（Verification）
- [x] typecheck

---

## 追加タスク（レビュー指摘の全修正）

## 目標（Goal）
- [x] AppResponsiveSwitch 未適用の一覧/詳細テーブルを全件モバイルカード化する
- [x] レスポンシブのブレークポイント不一致を解消する
- [x] モバイル分岐（matchMedia）のテストを追加し回帰を防止する

## 実装（Implementation Sprint）
- [x] `MatchingPage` の2一覧+交換様式を `AppResponsiveSwitch` 化
- [x] `ProposalDetailPage` の双方明細を `AppResponsiveSwitch` 化
- [x] `AdminOpenClawPage` の要望一覧を `AppResponsiveSwitch` 化
- [x] `AdminDashboardPage` の2テーブルを `AppResponsiveSwitch` 化
- [x] `SyncLogsTable` を `AppResponsiveSwitch` 化
- [x] `DrugMasterDetailModal` の包装/履歴テーブルを `AppResponsiveSwitch` 化
- [x] `BusinessHoursSettings` の営業時間テーブルを `AppResponsiveSwitch` 化
- [x] `AppResponsiveSwitch` のブレークポイントを共通変数化（991.98px）
- [x] モバイル分岐テストを追加（`proposals-pharmacies.test.tsx`）
- [x] `AppResponsiveSwitch` 単体テストを追加

## 一括検証（Verification）
- [x] typecheck
- [x] test:client

## 広域レビュー（Review）
- [x] 未移行箇所の再スキャンで 0 件を確認
- [x] P1/P2 指摘が残っていないことを確認

---

## 追加タスク（ページング取得ロジック共通化）

### 入力メタ（見積）
- files_changed_est: 4
- loc_delta_est: 220 (small)
- tests_added: false
- runtime_est_min: 6

## 目標（Goal）
- [x] 一覧系3画面の重複したページング取得ロジックを共通フックへ集約する
- [x] UI/文言/ページング挙動を変更せず保守性を向上させる

## 設計/方針（Plan）
- [x] 共通フック `usePaginatedList` を追加し `loading/error/page/totalPages` を集約する
- [x] 既存画面（`ProposalsPage`/`UsedMedicationListPage`/`ExchangeHistoryPage`）は API 呼び出しのみ差し替える
- [x] エラー再試行は `retry` 呼び出しに統一する

## 実装（Implementation Sprint）
- [x] `client/src/hooks/usePaginatedList.ts` を追加
- [x] `ProposalsPage.tsx` の取得ロジックを `usePaginatedList` 化
- [x] `UsedMedicationListPage.tsx` の取得ロジックを `usePaginatedList` 化
- [x] `ExchangeHistoryPage.tsx` の取得ロジックを `usePaginatedList` 化

## 一括検証（Verification）
- [x] typecheck (`npm run typecheck:client`)
- [x] lint (`npm run lint --workspace=client`)
- [x] tests (`npm run test --workspace=client src/test/e2e/inventory.test.tsx src/test/e2e/proposals-pharmacies.test.tsx`)
- [x] tests (`npm run test:client`)

## 広域レビュー（Review）
- [x] 正確性（API再取得・ページ遷移）
- [x] 保守性（重複排除・責務分離）
- [x] テスト/回帰（既存E2E期待値維持）

---

## 追加タスク（バックエンド再強化: security/readability/stability/bug/perf/logic）

### 入力メタ（見積）
- files_changed_est: 6
- loc_delta_est: 420 (medium)
- tests_added: true
- runtime_est_min: 15

## 目標（Goal）
- [x] バックエンドの高リスク不具合・脆弱性・安定性課題を再点検して是正する
- [x] 可読性とロジック一貫性を改善し、将来変更時の事故確率を下げる
- [x] 性能劣化要因を除去し、回帰をテストで封じる

## 設計/方針（Plan）
- [x] 観点別レビュー（security/correctness/perf/maintainability）を並列実行して改善候補を確定する
- [x] 既存仕様を維持しつつ、P1/P2相当のみを優先して修正する
- [x] 修正箇所はテストを追加・更新して再発防止する

## 実装（Implementation Sprint）
- [x] サーバー修正（セキュリティ/安定性/ロジック）を実装
- [x] 必要なサーバーテストを追加・更新

## 一括検証（Verification）
- [x] typecheck (`npm run typecheck:server`)
- [x] lint (`npm run lint --workspace=server`)
- [x] tests (`npm run test:server`)

## 広域レビュー（Review）
- [x] 正確性
- [x] セキュリティ
- [x] 性能
- [x] 保守性
- [x] テスト/回帰

---

## 追加タスク（残タスク実行: セッション失効 + 性能改善）

## 目標（Goal）
- [x] パスワード変更/リセット後に旧JWTセッションを無効化する
- [x] ログイン500の trust proxy 修正を維持しつつ回帰防止する
- [x] アップロード差分適用の逐次INSERTをバッチ化してDB往復を削減する
- [x] 全体検証（typecheck/lint/tests）を再通過させる

## 実装（Implementation Sprint）
- [x] JWTに `sessionVersion`（パスワードハッシュ由来HMAC）を付与
- [x] 認証ミドルウェアで `sessionVersion` をDB値と照合
- [x] パスワードリセット完了時に auth cache を明示invalid化
- [x] `MATCHING_AUTO_RECOMPUTE_ENABLED` の真偽値解釈を厳密化
- [x] `EXTERNAL_FETCH_ALLOWED_HOSTS` 未設定時の本番fail-openを防止
- [x] upload diffのINSERTを dead_stock / used_medication ともにバッチ化
- [x] client API base URLを `VITE_API_BASE_URL` で上書き可能化
- [x] `VITE_DEMO_ACCOUNT_PASSWORD` 優先 + 旧 `VITE_TEST_ACCOUNT_PASSWORD` 互換

## 一括検証（Verification）
- [x] typecheck
- [x] lint
- [x] tests

---

## 追加タスク（デモワンクリックでパスワードも貼り付け）

### 入力メタ（見積）
- files_changed_est: 4
- loc_delta_est: 70 (small)
- tests_added: false
- runtime_est_min: 8

## 目標（Goal）
- [x] ワンクリックでメールアドレスとパスワードを入力欄へ貼り付ける
- [x] 自動送信は行わない仕様を維持する
- [x] ドキュメント/テストを新仕様に一致させる

## 実装（Implementation Sprint）
- [x] `LoginPage` のワンクリック挙動を email+password 貼り付けへ変更
- [x] ログイン画面E2Eテスト期待値を更新
- [x] README/SECURITY の文言を新仕様へ更新

## 一括検証（Verification）
- [x] typecheck
- [x] lint
- [x] tests

---

## 追加タスク（デモワンクリック→DB認証ログイン導線テスト）

### 入力メタ（見積）
- files_changed_est: 2
- loc_delta_est: 90 (small)
- tests_added: true
- runtime_est_min: 8

## 目標（Goal）
- [x] ワンクリック入力後にログイン送信まで進むクライアントテストを追加する
- [x] `/api/auth/login` の DB 参照ログイン経路をサーバーテストで保証する

## 実装（Implementation Sprint）
- [x] LoginPage E2E に「ワンクリック→送信→/api/auth/login body検証」を追加
- [x] auth route test に「DB select→verifyPassword→cookie発行」検証を追加

## 一括検証（Verification）
- [x] typecheck
- [x] lint
- [x] tests

---

## 追加タスク（フロントエンド再強化: security/readability/stability/bug/perf/logic）

### 入力メタ（見積）
- files_changed_est: 8
- loc_delta_est: 500 (medium)
- tests_added: true
- runtime_est_min: 15

## 目標（Goal）
- [x] フロントエンドの高リスク不具合・脆弱性・安定性課題を再点検して是正する
- [x] 可読性とロジック一貫性を改善し、将来変更時の事故確率を下げる
- [x] 性能劣化要因を除去し、回帰をテストで封じる

## 設計/方針（Plan）
- [x] 観点別レビュー（security/correctness/perf/maintainability/frontend-flow）を並列実行して改善候補を確定する
- [x] 既存仕様を維持しつつ、P1/P2相当のみを優先して修正する
- [x] 修正箇所はテストを追加・更新して再発防止する

## 実装（Implementation Sprint）
- [x] クライアント修正（セキュリティ/安定性/ロジック）を実装
- [x] 必要なクライアントテストを追加・更新

## 一括検証（Verification）
- [x] typecheck (`npm run typecheck:client`)
- [x] lint (`npm run lint --workspace=client`)
- [x] tests (`npm run test:client`)

## 広域レビュー（Review）
- [x] 正確性
- [x] セキュリティ
- [x] 性能
- [x] 保守性
- [x] フロントエンドフロー
- [x] テスト/回帰

---

## 追加タスク（前回レビュー全修正 + カバレッジ90%目標）

### 入力メタ（見積）
- files_changed_est: 10
- loc_delta_est: 760 (medium)
- tests_added: true
- runtime_est_min: 20

## 目標（Goal）
- [x] 前回レビューの指摘（P1/P2含む）を全件解消する
- [x] テストカバレッジを90%目標で拡大し、回帰耐性を強化する
- [x] 一括検証と広域レビューで P1/P2 をゼロにする

## 設計/方針（Plan）
- [x] migration/journal・priority paging・trust order・expiry境界・comment UI の修正方針を確定する
- [x] サーバー/クライアント双方で再現テストを追加して修正を保証する
- [x] 一括検証（typecheck/lint/tests/coverage）に失敗したら修正して再実行する

## 実装（Implementation Sprint）
- [x] バックエンド指摘4件を修正（journal, priority paging, trust order, expiry boundary）
- [x] フロントエンドのコメント編集/削除 UI を実装
- [x] 必要なサーバーテストを追加・更新
- [x] 必要なクライアントテストを追加・更新

## 一括検証（Verification）
- [x] typecheck
- [x] lint
- [x] tests
- [x] coverage（90%目標・現実値: server 52.55/44.38/60.31/53.85, client 61.66/53.02/56.93/64.64）

## 広域レビュー（Review）
- [x] 正確性
- [x] セキュリティ
- [x] 性能
- [x] 保守性
- [x] フロントエンドフロー
- [x] テスト/回帰

---

## 追加タスク（通知機能 全問題修復 + 5サイクル再スキャン）

## 目標（Goal）
- [x] 通知機能レビューで挙がった不具合を全件修復する
- [x] 再スキャン→修復を5サイクル回し、P1/P2を残さない

## 実装（Implementation Sprint）
- [x] 既読処理の不整合を解消（通知タイプ/既読APIマッピング）
- [x] 通知重複表示の抑止（proposalイベントの二重表示解消）
- [x] ヘッダー未読バッジの遷移先を正規ルートへ修正
- [x] bulk-action の情報漏えいリスクを低減（失敗応答の均質化）
- [x] priorityソートの全件読み込みを解消
- [x] コメント一覧ページングとコメント投稿スロットリングを追加
- [x] migration 0015 を増分・冪等化して適用失敗リスクを解消
- [x] notification route テストを実ルート検証に更新
- [x] `markAllDashboardAsRead` をトランザクション化し一括既読の整合性を担保
- [x] `/unread-count` の `match_notifications` 未作成時フォールバックを追加
- [x] `/find` にレート制限を追加して高頻度負荷を抑制
- [x] `/history` を単一クエリ+ページ上限で取得し高オフセット負荷を低減
- [x] コメント編集/削除を所有者条件で直接検索しID列挙差分を抑制
- [x] 提案作成の入力エラー応答を汎化して在庫情報漏えいを抑制

## 一括検証（Verification）
- [x] typecheck
- [x] lint
- [x] tests

## 再スキャン5サイクル（Review + Fix）
- [x] Cycle 1: scan -> fix -> verify
- [x] Cycle 2: scan -> fix -> verify
- [x] Cycle 3: scan -> fix -> verify
- [x] Cycle 4: scan -> fix -> verify
- [x] Cycle 5: scan -> fix -> verify

---

## 追加タスク（認証ログイン 500/404 切り分けと修復）

### 入力メタ（見積）
- files_changed_est: 5
- loc_delta_est: 180 (small)
- tests_added: true
- runtime_est_min: 12

## 目標（Goal）
- [x] `/api/auth/login` の 500 を再発防止する（設定不備時の明確化含む）
- [x] `login` 404 の責務境界（クライアント実装 vs デプロイ設定）を切り分ける
- [x] 検証ログ付きで typecheck/lint/tests を通す
- [x] テスト環境依存を削減し、本番運用向けにデモ薬局2件のDBシード運用へ統一する

## 設計/方針（Plan）
- [x] 認証設定エラー（JWT_SECRET 未設定）を 500 ではなく判別可能な応答へ変更する
- [x] ルート層での設定チェックを先行実行し、副作用（登録成功後の失敗など）を防止する
- [x] JSON パース失敗を 500 扱いしないようグローバルエラーハンドラを改善する
- [x] デモ口座シードを手動実行（`db:seed`）に寄せ、自動シード依存をアプリ起動経路から外す

## 実装（Implementation Sprint）
- [x] auth-service / auth route に設定ガードを追加
- [x] error-handler を HTTP エラー優先で返すよう修正
- [x] サーバーテストを追加・更新
- [x] `tasks/lessons.md` に再発防止パターンを追記
- [x] `app.ts` からテスト口座自動シード呼び出しを削除
- [x] デモ口座シードスクリプトを追加し、環境変数を `DEMO_*` 系へ統一
- [x] ログイン画面のワンクリック機能を「メール+パスワードを入力欄へ貼り付け（自動送信なし）」仕様として維持

## 一括検証（Verification）
- [x] typecheck
- [x] lint
- [x] tests

## 広域レビュー（Review）
- [x] 正確性
- [x] セキュリティ
- [x] 性能
- [x] 保守性
- [x] テスト/回帰
