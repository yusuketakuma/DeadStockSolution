# tasks/todo.md

## Plan: harness-update (2026-03-05)
- [x] Phase 1: 現行バージョン・テンプレート差分・破壊的変更候補を検出
- [x] Phase 2: バックアップ作成後に非破壊で Harness 関連ファイルを更新
- [x] Phase 3: template-tracker / JSON 構文 / 必要コマンドで検証
- [x] Phase 4: Correctness / Security / Performance / Maintainability / UX の広範レビュー
- [x] 完了報告を `tasks/todo.md` に記録し、Moshi webhook を送信

### harness-update log (2026-03-05)
- 検出:
  - 現行 `.claude-code-harness-version` は `2.25.0`
  - プラグイン最新は `3.3.0`（`~/.claude/plugins/marketplaces/claude-code-harness-marketplace/VERSION`）
  - `template-tracker.sh` は `generated-files` 空状態で `check/status` が途中終了するため、追跡情報を再構築
- バックアップ:
  - `.claude-code-harness/backups/20260305_085438/` を作成し、settings/rules/version/Plans/AGENTS/CLAUDE を退避
- 更新:
  - `.claude/settings.json` を非破壊更新（permission 構文補正・deprecated 削除・重複排除・メタ更新）
  - `.claude/rules/*` の `_harness_template` 管理ファイルをテンプレート同期
  - `.claude/rules/quality-gates.md` / `security-guidelines.md` / `tdd-guidelines.md` はローカライズ扱いで保護
  - `.claude-code-harness.config.yaml` を追加し、hook script を `./.claude/scripts/auto-cleanup-hook.sh` へ固定
  - `.claude/scripts/auto-cleanup-hook.sh` を追加
  - `.claude-code-harness-version` を構造化フォーマットへ更新（version: `3.3.0`）
  - `.claude/state/generated-files.json` を再構築
- 検証:
  - `template-tracker.sh status`: rules/settings/config は ✅ 最新
  - `template-tracker.sh check`: `{\"needsCheck\": false, \"reason\": \"Plugin version unchanged\"}`
  - `jq empty` で `.claude/settings.json` / `.claude/settings.local.json` / `.claude/state/generated-files.json` の構文妥当性を確認
- レビュー:
  - fallback subagent で Correctness/Security/Performance/Maintainability/UX を実施
  - 重大修正として「存在しない hook パス」を是正済み
  - 残課題は `.claude/memory/decisions.md` / `patterns.md` のテンプレート更新候補（履歴保護優先で未上書き）

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

## Plan: simplify-refact rank1 (upload-confirm-job-service)
- [ ] 対象ファイルの重複パターン（runtime row変換・失敗ログ分岐・cancel更新payload）を抽出
- [ ] 挙動維持のまま関数抽出で分岐を浅くし、型を明確化
- [ ] 関連テストと型/lintを対象範囲で実行して回帰なしを確認
- [ ] Correctness/Security/Performance/Maintainability/UX観点の対象ファイル集中レビュー

## simplify-refact rank1 log (upload-confirm-job-service)
- [x] 対象ファイルの重複パターン（runtime row変換・失敗ログ分岐・cancel更新payload）を抽出
- [x] 挙動維持のまま関数抽出で分岐を浅くし、型を明確化
- [x] 関連テストと型/lintを対象範囲で実行して回帰なしを確認
- [x] Correctness/Security/Performance/Maintainability/UX観点の対象ファイル集中レビュー

### verify commands
- `npm run typecheck --workspace=server`
- `npm run lint --workspace=server`
- `npm run test --workspace=server -- src/test/upload-confirm-job-service.test.ts src/test/upload-confirm-job-service-coverage.test.ts src/test/upload-confirm-job-service-deep.test.ts`
- `npm run typecheck --workspace=server && npm run lint --workspace=server && npm run test --workspace=server -- src/test/upload-confirm-job-service.test.ts src/test/upload-confirm-job-service-coverage.test.ts src/test/upload-confirm-job-service-deep.test.ts src/test/upload-confirm-job-service-ultra.test.ts`

### review summary
- explorer_fallback (correctness): 重大指摘なし
- explorer_fallback (security): 2件指摘（error code prefix trust, cancel heuristic）を修正済み
- explorer_fallback (performance/maintainability/ux): 既存設計由来の注意点のみ（今回スコープ外、挙動変更回避のため未変更）

## Plan: simplify-refact rank2 (drug-master-sync-service)
- [x] 対象ファイルの重複処理（薬価同期の更新判定・包装同期の正規化/更新値生成）を抽出
- [x] 挙動を変えずに関数抽出と型明確化で分岐を浅くする
- [x] 関連テストと typecheck/lint を対象範囲で実行して回帰なしを確認
- [x] 対象ファイル集中の観点別レビュー（Correctness/Security/Performance/Maintainability/UX）を実施

## simplify-refact rank2 log (drug-master-sync-service)
- [x] 変更条件判定・INSERT/UPDATE payload・price history生成を関数抽出して重複を削減
- [x] `syncDrugMaster` の分岐を `continue` ベースに整理してネストを削減
- [x] `syncPackageData` の `normalizePackageInfo` 重複呼び出しを1回化
- [x] 対象テストと typecheck/lint で回帰なしを確認

### verify commands
- `npm run typecheck --workspace=server`
- `npm run lint --workspace=server`
- `npm run test --workspace=server -- src/test/drug-master-sync-service.test.ts src/test/drug-master-sync-service-coverage.test.ts src/test/drug-master-sync-deep.test.ts`

### review summary
- explorer_fallback (correctness): 回帰指摘なし（`??` による null保持は既存挙動）
- explorer_fallback (security): 入力バリデーション/未知YJスキップ等の既存課題を確認（今回リファクタで悪化なし）
- explorer_fallback (performance/maintainability/ux): 既存実装由来の注意点のみ（今回スコープ外、挙動維持優先で未変更）

## Plan: simplify-refact rank3 (matching-service)
- [x] 対象ファイルの重複ロジック（候補生成・距離計算・営業時間付与）を抽出して整理
- [x] 分岐を平坦化しつつ関数抽出で型を明確化し、挙動を維持したまま可読性を改善
- [x] 関連テストと typecheck/lint を対象範囲で実行して回帰なしを確認
- [x] Correctness/Security/Performance/Maintainability/UX の観点別レビューを実施して重大指摘を解消

## simplify-refact rank3 log (matching-service)
- [x] `fetchBusinessHoursMaps` を追加し、単体/バッチ両経路の営業時間取得重複を削減
- [x] `collectCandidates` を追加し、候補生成ループを共通化して分岐を平坦化
- [x] `BusinessHoursRows` / `SpecialHoursRows` で業務時間関連の型意図を明示
- [x] レビュー指摘の P1（`businessStatus.isConfigured` 経路差）を修正し、単体/バッチのレスポンス形を統一

### verify commands
- `npm run typecheck --workspace=server`
- `npm run lint --workspace=server`
- `npm run test --workspace=server -- src/test/matching-service.test.ts src/test/matching-service-coverage.test.ts src/test/matching-service-deep.test.ts src/test/matching-service-final.test.ts src/test/matching-service-ultra.test.ts`

### review summary
- explorer_fallback (correctness): 重大指摘なし
- explorer_fallback (security): サービス層の既存権限境界・露出範囲に関する注意（今回差分で悪化なし）
- explorer_fallback (performance): 既存の候補数増加時コストに関する注意（今回差分で悪化なし）
- explorer_fallback (maintainability): 関数責務分離・重複削減を確認、P1/P2 回帰なし
- explorer_fallback (ux): 初回レビューの P1（`isConfigured` 不一致）を修正後、再レビューで重大指摘なし

## Plan: simplify-refact rank4 (drug-master-enrichment)
- [x] 対象ファイルの重複ロジック（パッケージ補完・薬価/単位補完・ラベル解決）を抽出して整理
- [x] await-in-loop を減らし、関数抽出で分岐を浅くして型意図を明確化
- [x] 関連テストと typecheck/lint を対象範囲で実行して回帰なしを確認
- [x] Correctness/Security/Performance/Maintainability/UX の観点別レビューを実施して重大指摘を解消

## simplify-refact rank4 log (drug-master-enrichment)
- [x] `findPackageByUnit` を同期化し、行ループ内 `await` を除去（事前ロード済みキャッシュのみ参照）
- [x] `resolvePackageLabel` / `applyMasterDefaults` を抽出して補完分岐の重複を削減
- [x] `type` 引数を活用し、dead_stock の `yakkaTotal` 再計算を型ガードで安全化（unsafe cast を除去）
- [x] 既存挙動（薬価補完・単位補完・包装ラベル優先順位）を維持したまま可読性を改善

### verify commands
- `npm run typecheck --workspace=server`
- `npm run lint --workspace=server`
- `npm run test --workspace=server -- src/test/drug-master-enrichment.test.ts`

### review summary
- explorer_fallback (correctness): 重大指摘なし
- explorer_fallback (security): 既存設計由来の注意（master空時のfail-open/全件キャッシュ読込）を確認、今回差分で悪化なし
- explorer_fallback (performance): 既存の全件 name cache 読込コストなどを確認、今回差分で await-in-loop を削減
- explorer_fallback (maintainability): 初回 P2（unsafe cast / 未使用引数）を修正し、再レビューで重大指摘なし
- explorer_fallback (ux): 重大指摘なし（ユーザー可視の挙動変更なし）

## Plan: simplify-refact rank5 (exchange-service)
- [ ] 対象ファイルの重複ロジック（proposal item検証、状態遷移判定、権限/更新ガード）を抽出
- [ ] 挙動を変えずに関数抽出で分岐を浅くし、型を明確化
- [ ] 関連テストと typecheck/lint を対象範囲で実行して回帰なしを確認
- [ ] Correctness/Security/Performance/Maintainability/UX の観点別レビューを実施

## 2026-03-05 exchange-service simplify-refact rank5
- [x] Locate duplication points in `server/src/services/exchange-service.ts` for proposal item validation/mapping, other-party id resolution, and proposal status update.
- [x] Implement minimal local helper extraction in `exchange-service.ts` only, preserving existing messages and status-transition behavior.
- [x] Run targeted verification:
  - [x] `npm run typecheck --workspace=server`
  - [x] `npm run lint --workspace=server`
  - [x] `npm run test --workspace=server -- src/test/exchange-service.test.ts src/test/exchange-service-coverage.test.ts src/test/exchange-service-final.test.ts src/test/exchange-service-ultra.test.ts`
- [x] Perform broad review (correctness/security/performance/maintainability/UX-a11y) on changed logic and fix issues if found.
- [x] Report changed files and command outcomes.

## simplify-refact rank5 log (exchange-service)
- [x] 対象ファイルの重複ロジック（proposal item検証、状態遷移判定、権限/更新ガード）を抽出
- [x] 挙動を変えずに関数抽出で分岐を浅くし、型を明確化
- [x] 関連テストと typecheck/lint を対象範囲で実行して回帰なしを確認
- [x] Correctness/Security/Performance/Maintainability/UX の観点別レビューを実施

### rank5 changes
- [x] `validateAndMapProposalItems` で A/B 両経路の在庫検証・yakka計算重複を共通化
- [x] `findActionProposal` / `assertActionPermission` / `canTransition` を追加して承認・拒否処理の重複を削減
- [x] `createProposal` の通知送信をトランザクション外へ移動し、ロック保持時間を短縮
- [x] `exchange-proposals` ルートのエラー判定トークンを補強し、`アクセスする権限` 文言でも 404 判定を維持

### verify commands
- `npm run typecheck --workspace=server`
- `npm run lint --workspace=server`
- `npm run test --workspace=server -- src/test/exchange-service.test.ts src/test/exchange-service-coverage.test.ts src/test/exchange-service-final.test.ts src/test/exchange-service-ultra.test.ts src/test/exchange-proposals-route-coverage.test.ts src/test/exchange-subroutes.test.ts`

### review summary
- explorer_fallback (correctness/security/ux): 初回指摘の権限エラートークン不一致を修正済み
- explorer_fallback (maintainability): 状態遷移型の広さ・重複ロジックを関数抽出で改善
- explorer_fallback (performance): 通知I/Oのトランザクション外だしを実施
- 再レビュー結果: P1/P2 指摘なし

## Plan: simplify-refact rank6 (drug-master-parser-service)
- [x] 対象ファイルの重複ロジック（ヘッダー検出、包装行の重複排除）を抽出
- [x] 挙動を変えずに関数抽出で分岐を浅くし、型を明確化
- [x] 関連テストと typecheck/lint を対象範囲で実行して回帰なしを確認
- [x] Correctness/Security/Performance/Maintainability/UX の観点別レビューを実施

## simplify-refact rank6 log (drug-master-parser-service)
- [x] `detectHeaderRow` を導入し、MHLW/包装のヘッダー行検出ロジックを共通化
- [x] `detectMhlwHeaderRow` の誤検出除外（`yakkaPrice` × `コード`）をオプション化して既存挙動を維持
- [x] `buildPackageRowKey` / `dedupePackageRows` を追加し、XML/ZIP経路の重複排除処理を共通化
- [x] 対象テストと typecheck/lint で回帰なしを確認
- [x] 5観点レビューで重大指摘なしを確認

### verify commands
- `npm run typecheck --workspace=server`
- `npm run lint --workspace=server`
- `npm run test --workspace=server -- src/test/drug-master-parser.test.ts src/test/drug-master-parser-coverage.test.ts src/test/drug-master-parser-service-deep.test.ts src/test/drug-master-parser-ultra.test.ts`

### review summary
- explorer_fallback (correctness): 重大指摘なし
- explorer_fallback (security): 重大指摘なし（既存残課題としてXML/ZIPのDoS耐性・部分成功fail-openを確認）
- explorer_fallback (performance): 重大指摘なし（既存残課題としてヘッダー検出コスト/ZIP展開時メモリを確認）
- explorer_fallback (maintainability): 重大指摘なし（`Record<string, number>` の型厳密化余地を確認）
- explorer_fallback (ux): 重大指摘なし（バックエンド処理のため直接UI影響なし、運用診断ログの改善余地を確認）

## Plan: simplify-refact rank7 (matching-refresh-service)
- [ ] 対象ファイルの重複ロジック（refreshジョブ構築/結果集計/エラー処理）を抽出
- [ ] 挙動を変えずに関数抽出で分岐を浅くし、型意図を明確化
- [ ] 関連テストと typecheck/lint を対象範囲で実行して回帰なしを確認
- [ ] Correctness/Security/Performance/Maintainability/UX の観点別レビューを実施

## simplify-refact rank7 log (matching-refresh-service)
- [x] claim条件の重複を `buildClaimEligibilityConditions` へ抽出
- [x] 失敗ログ処理を `recordPharmacyRefreshFailure` に共通化し、重複分岐を削減
- [x] `SnapshotEntry` 型を導入して候補収集の型意図を明確化
- [x] typecheck/lint/関連テストを実行して回帰なしを確認
- [x] Correctness/Security/Performance/Maintainability/UX の観点レビューで重大指摘なしを確認

### rank7 verify commands
- `npm run typecheck --workspace=server`
- `npm run lint --workspace=server`
- `npm run test --workspace=server -- src/test/matching-refresh-service.test.ts src/test/matching-refresh-service-coverage.test.ts src/test/matching-refresh-service-final.test.ts src/test/matching-refresh-service-ultra.test.ts`

### rank7 review summary
- explorer_fallback (correctness): No findings
- explorer_fallback (security): No findings
- explorer_fallback (performance/maintainability/ux): No findings（実行時競合シナリオの追加検証余地あり）

## Plan: simplify-refact script interactive terminal UI (2026-03-05)
- [x] 現行 `prepare-simplify-worklist.sh` の出力ポイントを整理し、Codex標準寄りの表示仕様（TTY/非TTY両対応）を定義
- [x] 表示ユーティリティ（色、セクション、ステップ、進捗バー、結果要約）を実装して既存出力を置換
- [x] `bash -n` と `--dry-run` で表示崩れ/文法エラー/既存動作の後方互換を確認
- [x] Correctness / Security / Performance / Maintainability / UX 観点で広範レビューして重大指摘を解消

## simplify-refact script interactive UI log (2026-03-05)
- [x] `IS_TTY` / `NO_COLOR` 判定を追加し、TTY時は色付き、非TTY時はプレーン表示に自動フォールバック
- [x] `log_section` / `log_step` / `log_info` / `log_success` / `log_warn` / `log_error` を追加し、主要出力を統一
- [x] `show_run_progress` + `render_bar` を追加し、ランごとの進捗表示を標準化
- [x] 既存の例外経路（引数不正、codex未検出、spark失敗、確認待ち検知）も同じ表示系へ統一

### verify commands
- `bash -n ~/.codex/skills/simplify-refact/scripts/prepare-simplify-worklist.sh`
- `bash ~/.codex/skills/simplify-refact/scripts/prepare-simplify-worklist.sh --limit 3 --max-files 1 --dry-run --agent-mode fallback`

### broad review
- Correctness: 既存分岐/終了コード/進捗ファイル更新順を維持し、表示層のみを差し替えたため回帰なし
- Security: 追加処理はログ整形のみで、外部入力評価・コマンド組み立て・権限境界の変更なし
- Performance: 追加コストは短い文字列生成のみ。既存 `codex exec` 実行時間に対して無視できる範囲
- Maintainability: ログ関数へ集約し、今後の表示変更点を局所化
- UX/Accessibility: セクション分割とステータス接頭辞で読み取り性を改善し、色無し環境でも同等情報を保持

## 2026-03-05 simplify-refact (top slow 30)
- [x] Phase A: spark疎通チェックを実施し、失敗時はfallback運用へ切替
- [ ] Phase B: `prepare-simplify-worklist.sh --limit 30` でworklist生成と未処理対象の連続実装
- [ ] Phase C: typecheck / lint / tests を一括実行し、失敗時は修正して再検証
- [ ] Phase D: Correctness / Security / Performance / Maintainability / UX-Accessibility の広範レビューを実施して残課題を解消
- [ ] Done: 変更内容と検証結果を記録し、Moshi webhook を送信

## Plan: simplify-refact rank9 (CameraDeadStockRegisterPanel)
- [ ] 対象ファイル内の重複/分岐過多/型曖昧箇所を抽出し、局所関数へ整理
- [ ] 挙動維持で重複削減・分岐平坦化・型明確化を適用（対象ファイル限定）
- [ ] 関連テストと対象範囲の typecheck/lint を実行し回帰なしを確認
- [ ] 対象ファイル集中の観点別レビュー（Correctness/Security/Performance/Maintainability/UX）を完了

## simplify-refact rank9 log (CameraDeadStockRegisterPanel)
- [x] 対象ファイル内の重複/分岐過多/型曖昧箇所を抽出し、局所関数へ整理
- [x] 挙動維持で重複削減・分岐平坦化・型明確化を適用（対象ファイル限定）
- [x] 関連テストと対象範囲の typecheck/lint を実行し回帰なしを確認
- [x] 対象ファイル集中の観点別レビュー（Correctness/Security/Performance/Maintainability/UX）を完了

### verify commands
- `npm run typecheck:client`
- `npm run lint --workspace=client`
- `npm run test --workspace=client -- src/test/e2e/upload-camera-register.test.tsx src/test/e2e/upload-page.test.tsx`

### review summary
- explorer_fallback (correctness): P1なし。P2指摘（空rawCode送信可、追加件数表示過大）を修正済み。
- explorer_fallback (security): fail-open抑止のため `canSubmit` と送信前ガードを強化、rawCode正規化を追加。
- explorer_fallback (performance): manual-candidates cache に上限を追加。直列解決（await in loop）は挙動維持優先で維持。
- explorer_fallback (maintainability): 共通ヘルパー抽出（キーワード検証、カメラ開始エラー解決、キャッシュ更新、行フィールド更新、Decode型alias）を適用。
- explorer_fallback (ux/accessibility): 候補検索入力/選択に `aria-label` を追加し、数量エラーメッセージを実挙動へ一致させた。

## Plan: simplify-refact rank11 (predictive-alert-service)
- [x] 対象ファイルの重複ロジック（集計Map更新・シグナル保存結果集計）を抽出
- [x] 挙動を変えずに関数抽出で分岐を平坦化し、型を明確化
- [x] 関連テストと typecheck/lint を対象範囲で実行して回帰なしを確認
- [x] Correctness/Security/Performance/Maintainability/UX の観点別レビューを実施

## simplify-refact rank11 log (predictive-alert-service)
- [x] `getOrInitMapValue` / `isFinitePositiveNumber` / `applyPersistedSignalResult` を追加し、Map更新・結果集計の重複を削減
- [x] `runPredictiveAlertsJob` のカウンタ更新分岐を抽出してネストを平坦化し、`PredictiveAlertCounters` で型意図を明確化
- [x] `MILLISECONDS_PER_DAY` 導入と timestamp 共有化（`persistSignal`）でマジックナンバーと重複生成を削減
- [x] レビュー指摘に基づき、`getOrInitMapValue` の falsy 罠を `map.has` 判定へ修正、ID判定を null 明示へ統一

### rank11 verify commands
- `npm run typecheck --workspace=server`
- `npm run lint --workspace=server`
- `npm run test --workspace=server -- src/test/internal-predictive-alerts-route.test.ts`
- `npm run typecheck --workspace=server`
- `npm run lint --workspace=server`
- `npm run test --workspace=server -- src/test/internal-predictive-alerts-route.test.ts`

### rank11 review summary
- explorer_fallback (correctness): P2/P3 指摘は既存仕様起因（部分失敗時の継続・累積丸め）で、今回差分由来の重大回帰なし
- explorer_fallback (security): 既存設計課題（通知未紐付け時の整合性、ジョブ境界）を確認。今回差分で悪化なし
- explorer_fallback (performance): 既存ホットスポット（アプリ側集計、per-signal transaction）を確認。今回は simplify スコープで非変更
- explorer_fallback (maintainability): `getOrInitMapValue` の汎用性リスクを修正済み。重複削減と型意図の明確化を確認
- explorer_fallback (ux/accessibility): サービス層のため直接UI変更なし。通知分類/運用可観測性の既存課題のみ確認

## Plan: simplify-refact rank12 (openclaw-service)
- [x] 対象ファイルの重複ロジック（connector設定判定、replay key正規化、gateway cli引数/応答抽出）を抽出
- [x] 挙動維持のまま関数抽出で分岐を平坦化し、型を明確化
- [x] 関連テストと typecheck/lint を対象範囲で実行して回帰なしを確認
- [x] Correctness/Security/Performance/Maintainability/UX の観点別レビューを対象ファイルに限定して実施

## simplify-refact rank12 log (openclaw-service)
- [x] `pruneExpiredMapEntries<K, V extends { expiresAtMs: number }>()` を追加し、`pruneHandoffResultCache` で使用
- [x] `buildHandoffSuccess()` を追加し、`handoffViaGatewayCli` / `handoffViaLegacyHttp` の成功時の結果構築を共通化
- [x] `isConnectorConfigured()` をインライン化して冗長な関数呼び出しを削減
- [x] typecheck/lint/tests (99件) で回帰なしを確認

### verify commands
- `npm run typecheck --workspace=server`
- `npm run lint --workspace=server`
- `npm run test --workspace=server -- src/test/openclaw-service.test.ts src/test/openclaw-service-deep.test.ts src/test/openclaw-service-ultra.test.ts`

### review summary
- Correctness: 挙動維持を確認（既存テスト全通過）
- Security: `crypto.timingSafeEqual` は維持、新規攻撃ベクトルなし
- Performance: O(n) のキャッシュプルーニングは維持、性能劣化なし
- Maintainability: 重複削減（pruneExpiredMapEntries, buildHandoffSuccess）を達成
- UX: ユーザー可視の変更なし、ログ出力は維持
