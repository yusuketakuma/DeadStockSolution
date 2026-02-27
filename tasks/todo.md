# tasks/todo.md

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
