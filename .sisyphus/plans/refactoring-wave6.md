# Refactoring Wave 6: Top 10 Large File Reduction

## TL;DR

> **Quick Summary**: コードベース最大の10ファイル（server 6件 + client 4件）を分割・ヘルパー抽出して≤400行に削減。
> 
> **Deliverables**:
> - Server: 2サービス分割 + 4ルートhelper抽出
> - Client: 1 hook組み込み + 3ページhook/コンポーネント抽出
> - 全ファイル: typecheck ✅ + test ✅ + build ✅
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 3 waves + final verification
> **Critical Path**: Task 1 → Task 3 → Task 7 → F1-F4

---

## Context

### Original Request
リファクタリングタスクの実行。コードベース全体を対象に、最も大きいファイルの分割を中心に進める。

### Interview Summary
**Key Discussions**:
- スコープ: server + client合わせてトップ10ファイル
- 手法: ファイルごとにhelper抽出 or サブモジュール分割を判断
- テスト: 既存テスト通過確認のみ。新規テスト不要
- useUploadExcelFlow: 既存3 sub-hooksを組み込む（再抽出しない）
- timeline-aggregators: スコープ外（既に整理済み、代替にBusinessHoursSettings）

**Research Findings**:
- コード品質良好: `as any` 0件（prod）、TODO/FIXME 0件
- Server側は全対象にテストあり（🟢）。Client側3件はテストなし（🔴）
- 2つのバレルパターン存在: Facade vs Pure re-export → Pure re-export採用
- Route分割の前例なし → helper抽出で統一（sub-router化しない）

### Metis Review
**Identified Gaps** (addressed):
- useUploadExcelFlowの既存sub-hooks未使用問題 → 組み込み方針に決定
- timeline-aggregatorsの低優先度 → スコープ外に
- 3 clientファイルのテスト不在 → typecheck+buildのみで検証（合意済み）
- Routeファイルの3段ネスト懸念 → helper抽出のみ（sub-router化しない）
- バレルパターン不統一 → Pure re-export統一
- openclaw-serviceのモジュールレベルキャッシュ → キャッシュ所在モジュールに集約

---

## Work Objectives

### Core Objective
コードベース最大の10ファイルを≤400行に削減し、保守性を向上させる。

### Concrete Deliverables
- 10ファイルの分割/ヘルパー抽出完了
- 全ファイルが≤400行（理由がある場合は文書化）
- 全テスト通過、typecheck通過、build成功

### Definition of Done
- [x] `npm run typecheck` → 0 errors ✅ (2026-03-07 09:04)
- [x] `npm run test` → all pass ✅ (296 tests)
- [x] `npm run build:server && npm run build:client` → success ✅
- [x] 全10ファイルが≤400行（例外は理由を文書化）✅

### Must Have
- 全exported symbolのバレル再エクスポート（消失禁止）
- 既存テストの全通過
- 関数シグネチャ・パラメータ型・戻り値型の維持
- Pure re-exportバレルパターンの統一適用

### Must NOT Have (Guardrails)
- ❌ 動作変更（同一入力→同一出力を保証）
- ❌ 新規テスト追加（スコープ外）
- ❌ Sub-router化（helperファイル抽出のみ）
- ❌ 3段以上のRouterネスト
- ❌ モジュールレベルの可変状態（キャッシュ等）のファイル間移動
- ❌ 対象10ファイル以外のロジック変更
- ❌ 新規ディレクトリ作成（ルートhelper抽出時。サービス分割時は既存パターンに従う）
- ❌ `as any` / `@ts-ignore` の使用
- ❌ AI slop: 過剰コメント、不要な抽象化、汎用的な変数名

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: None (既存テスト通過のみ)
- **Framework**: Vitest 4 + Supertest (server), Vitest + @testing-library/react (client)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Server files**: `npm run typecheck`, `npm run test:server`, `npm run build:server`
- **Client files**: `npm run typecheck`, `npm run test:client`, `npm run build:client`
- **Line count verification**: `wc -l <file>` → ≤400
- **Symbol preservation**: `grep -c "^export " <barrel>` → matches pre-refactor count

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Server Services — best test coverage, start immediately):
├── Task 1: openclaw-service.ts → sub-module split [deep]
└── Task 2: upload-diff-service.ts → helper extraction [quick]

Wave 2 (Server Routes — good coverage, after Wave 1 pattern established):
├── Task 3: notifications.ts → helper extraction [quick]
├── Task 4: auth.ts → helper extraction [quick]
├── Task 5: upload-parser.ts → helper extraction [quick]
└── Task 6: admin-pharmacies-detail.ts → helper extraction [quick]

Wave 3 (Client — least coverage, after server verified):
├── Task 7: useUploadExcelFlow.ts → compose existing sub-hooks [deep]
├── Task 8: AdminPharmacyEditPage.tsx → hook extraction [unspecified-high]
├── Task 9: AdminLogCenterPage.tsx → hook/component extraction [unspecified-high]
└── Task 10: BusinessHoursSettings.tsx → component extraction [unspecified-high]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Regression QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 3 → Task 7 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 4 (Waves 2 & 3)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 3-6 (pattern established) | 1 |
| 2 | — | 3-6 | 1 |
| 3 | 1, 2 | 7-10 | 2 |
| 4 | 1, 2 | 7-10 | 2 |
| 5 | 1, 2 | 7-10 | 2 |
| 6 | 1, 2 | 7-10 | 2 |
| 7 | 3-6 | F1-F4 | 3 |
| 8 | 3-6 | F1-F4 | 3 |
| 9 | 3-6 | F1-F4 | 3 |
| 10 | 3-6 | F1-F4 | 3 |
| F1-F4 | 7-10 | — | FINAL |

### Agent Dispatch Summary

- **Wave 1**: **2** — T1 → `deep`, T2 → `quick`
- **Wave 2**: **4** — T3-T6 → `quick`
- **Wave 3**: **4** — T7 → `deep`, T8-T10 → `unspecified-high`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

> Implementation tasks below. EVERY task has: Recommended Agent Profile + Parallelization + QA Scenarios.


- [x] 1. openclaw-service.ts サブモジュール分割 (853行 → 20行 barrel) ✅

  **What to do**:
  - `server/src/services/openclaw-service.ts` (853行) を複数サブモジュールに分割
  - `lsp_find_references` で全exported symbolの使用箇所を調査してから着手
  - サブモジュール分割案:
    - `openclaw-webhook-handler.ts` — Webhook受信・署名検証・コマンドディスパッチ
    - `openclaw-handoff.ts` — handoffToOpenClaw + ログコンテキスト収集
    - `openclaw-status.ts` — ステータス取得・health check・キャッシュ管理
  - バレルファイル: `openclaw-service.ts` をpure re-exportに書き換え（`upload-confirm-job-service.ts` パターン）
  - モジュールレベルキャッシュ（3つ）は1つのサブモジュールに集約（分散禁止）
  - 全consumerのimport pathを更新（バレル経由なら変更不要）

  **Must NOT do**:
  - 関数シグネチャ変更
  - キャッシュのファイル間移動（全キャッシュを同一サブモジュールに集約）
  - 新規ディレクトリ作成（既存のservices/直下に配置）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 複雑な依存関係とキャッシュ状態の管理が必要
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 3-6 (pattern established)
  - **Blocked By**: None

  **References**:
  **Pattern References**:
  - `server/src/services/upload-confirm/upload-confirm-job-service.ts` — Pure re-export barrelパターン（36行のバレルファイル）
  - `server/src/services/upload-confirm/upload-confirm-processor-service.ts` — サブモジュール命名規則
  **API/Type References**:
  - `server/src/services/openclaw-service.ts` — 19 exported symbols, 3 module-level caches, 4 consumers
  **Test References**:
  - `server/src/test/openclaw-service.test.ts` + `openclaw-service-ultra.test.ts` + `openclaw-service-coverage.test.ts` — 1,758行のテスト

  **Acceptance Criteria**:
  - [ ] `wc -l server/src/services/openclaw-service.ts` → ≤40行（pure re-export barrel）
  - [ ] 各サブモジュール ≤400行
  - [ ] `grep -c "^export " server/src/services/openclaw-service.ts` → 分割前と同数
  - [ ] `npm run test:server` → all pass
  - [ ] `npm run typecheck` → 0 errors

  **QA Scenarios**:
  ```
  Scenario: バレル経由のimportが全て動作する
    Tool: Bash
    Steps:
      1. grep -rn "from.*openclaw-service" server/src/ --include='*.ts' | grep -v test | grep -v node_modules
      2. npm run typecheck
      3. npm run test:server
    Expected Result: typecheck 0 errors, all tests pass
    Evidence: .sisyphus/evidence/task-1-barrel-imports.txt

  Scenario: キャッシュが分散していないことを確認
    Tool: Bash
    Steps:
      1. grep -rn "new Map\|= new Map\|Map<" server/src/services/openclaw-*.ts
      2. 全キャッシュが1つのサブモジュールに集約されていることを確認
    Expected Result: キャッシュ定義が1ファイルのみに存在
    Evidence: .sisyphus/evidence/task-1-cache-locality.txt
  ```

  **Commit**: YES
  - Message: `refactor: split openclaw-service into sub-modules`
  - Files: `server/src/services/openclaw-*.ts`
  - Pre-commit: `npm run test:server`

- [x] 2. upload-diff-service.ts ヘルパー抽出 (670行 → 359行) ✅

  **What to do**:
  - `server/src/services/upload-diff-service.ts` (670行) から純粋関数をヘルパーファイルに抽出
  - `lsp_find_references` で全exported symbolの使用箇所を調査
  - 抽出候補:
    - diff計算用の純粋ユーティリティ関数 → `upload-diff-utils.ts`
    - 行比較・マッチングロジック → `upload-diff-matcher.ts`
  - バレル: `upload-diff-service.ts` をpure re-exportに書き換え
  - またはヘルパー抽出のみで十分ならバレル化不要

  **Must NOT do**:
  - 関数シグネチャ変更
  - diffアルゴリズムの変更

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: helper抽出のみ。Wave 5と同じパターン
  - **Skills**: [`simplify-refact`]
    - `simplify-refact`: 重複削減・分岐単純化のドメイン

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 3-6
  - **Blocked By**: None

  **References**:
  - `server/src/services/upload-diff-service.ts` — 対象ファイル (670行)
  - `server/src/test/upload-diff-service.test.ts` — 464行のテスト
  - `server/src/services/upload-confirm/upload-confirm-processor-service.ts` — 主要consumer

  **Acceptance Criteria**:
  - [ ] `wc -l server/src/services/upload-diff-service.ts` → ≤400行
  - [ ] `npm run test:server` → all pass
  - [ ] `npm run typecheck` → 0 errors

  **QA Scenarios**:
  ```
  Scenario: 分割後のテスト全通過
    Tool: Bash
    Steps:
      1. npm run typecheck
      2. npx vitest run src/test/upload-diff-service.test.ts (in server/)
      3. wc -l server/src/services/upload-diff-service.ts
    Expected Result: typecheck 0 errors, all tests pass, ≤400 lines
    Evidence: .sisyphus/evidence/task-2-tests.txt
  ```

  **Commit**: YES (groups with Task 1 if same wave)
  - Message: `refactor: extract upload-diff-service helpers`
  - Files: `server/src/services/upload-diff-*.ts`
  - Pre-commit: `npm run test:server`

- [x] 3. notifications.ts ヘルパー抽出 (744行 → 385行) ✅

  **What to do**:
  - `server/src/routes/notifications.ts` (744行) から純粋関数を抽出
  - `server/src/routes/notifications-helpers.ts` を作成し、DBクエリヘルパー、フォーマット関数、バリデーションロジックを移動
  - 元ファイルにはRouterセットアップ + ルートハンドラのみ残す
  - Sub-router化しない（helper抽出のみ）

  **Must NOT do**: Sub-router作成、ルートパス変更、エラーメッセージ変更

  **Recommended Agent Profile**:
  - **Category**: `quick` — **Skills**: [`simplify-refact`]

  **Parallelization**: Wave 2 (with Tasks 4, 5, 6) | Blocked By: 1, 2

  **References**:
  - `server/src/routes/notifications.ts` — 744行、通知CRUD + 未読管理 + ダイジェスト
  - `server/src/test/notification*.test.ts` — 4テストファイル、1,619行
  - `server/src/routes/exchange-comments.ts` — Wave 5のhelper抽出パターン参照

  **Acceptance Criteria**:
  - [ ] `wc -l server/src/routes/notifications.ts` → ≤400行
  - [ ] `npm run test:server` → all pass
  - [ ] `npm run typecheck` → 0 errors

  **QA Scenarios**:
  ```
  Scenario: helper抽出後のテスト全通過
    Tool: Bash
    Steps:
      1. npm run typecheck
      2. npx vitest run src/test/notification (in server/)
      3. wc -l server/src/routes/notifications.ts server/src/routes/notifications-helpers.ts
    Expected Result: typecheck 0 errors, all tests pass, 元ファイル≤400行
    Evidence: .sisyphus/evidence/task-3-tests.txt
  ```

  **Commit**: YES (groups with Tasks 4-6)
  - Message: `refactor: extract route helpers for notifications, auth, upload-parser, admin-pharmacies-detail`
  - Pre-commit: `npm run test:server`

- [x] 4. auth.ts ヘルパー抽出 (723行 → 400行) ✅

  **What to do**:
  - `server/src/routes/auth.ts` (723行) から純粋関数を抽出
  - `server/src/routes/auth-helpers.ts` を作成し、パスワード検証・トークン生成・JWTユーティリティを移動
  - Router + ルートハンドラは元ファイルに残す

  **Must NOT do**: 認証ロジックの変更、JWTシークレットの取り扱い変更

  **Recommended Agent Profile**:
  - **Category**: `quick` — **Skills**: [`simplify-refact`]

  **Parallelization**: Wave 2 (with Tasks 3, 5, 6) | Blocked By: 1, 2

  **References**:
  - `server/src/routes/auth.ts` — 723行、登録/ログイン/パスワードリセット/トークン更新
  - `server/src/test/auth*.test.ts` — 3テストファイル、1,633行

  **Acceptance Criteria**:
  - [ ] `wc -l server/src/routes/auth.ts` → ≤400行
  - [ ] `npm run test:server` → all pass

  **QA Scenarios**: 同 Task 3 パターン（authテスト対象）
  **Commit**: YES (groups with Task 3)

- [x] 5. upload-parser.ts ヘルパー抽出 (720行 → 354行) ✅

  **What to do**:
  - `server/src/routes/upload-parser.ts` (720行) からパースロジックを抽出
  - `server/src/routes/upload-parser-helpers.ts` を作成し、パース・バリデーション・マッピングロジックを移動
  - 注意: このファイルは既に2段ネスト（upload.ts経由）なのでsub-router化禁止

  **Must NOT do**: Sub-router作成、パースロジックの動作変更

  **Recommended Agent Profile**:
  - **Category**: `quick` — **Skills**: [`simplify-refact`]

  **Parallelization**: Wave 2 (with Tasks 3, 4, 6) | Blocked By: 1, 2

  **References**:
  - `server/src/routes/upload-parser.ts` — 720行、Excel/CSVパース+バリデーション
  - `server/src/test/upload-parser*.test.ts` — 779行のテスト

  **Acceptance Criteria**:
  - [ ] `wc -l server/src/routes/upload-parser.ts` → ≤400行
  - [ ] `npm run test:server` → all pass

  **QA Scenarios**: 同 Task 3 パターン（upload-parserテスト対象）
  **Commit**: YES (groups with Task 3)

- [x] 6. admin-pharmacies-detail.ts ヘルパー抽出 (647行 → 315行) ✅

  **What to do**:
  - `server/src/routes/admin-pharmacies-detail.ts` (647行) からヘルパー抽出
  - `server/src/routes/admin-pharmacies-detail-helpers.ts` を作成
  - 注意: 既に2段ネスト（admin-pharmacies.ts経由）

  **Must NOT do**: Sub-router作成、管理者権限チェックの変更

  **Recommended Agent Profile**:
  - **Category**: `quick` — **Skills**: [`simplify-refact`]

  **Parallelization**: Wave 2 (with Tasks 3, 4, 5) | Blocked By: 1, 2

  **References**:
  - `server/src/routes/admin-pharmacies-detail.ts` — 647行、薬局詳細CRUD
  - `server/src/test/admin-pharmacies-detail*.test.ts` — 1,051行のテスト

  **Acceptance Criteria**:
  - [ ] `wc -l server/src/routes/admin-pharmacies-detail.ts` → ≤400行
  - [ ] `npm run test:server` → all pass

  **QA Scenarios**: 同 Task 3 パターン（admin-pharmacies-detailテスト対象）
  **Commit**: YES (groups with Task 3)

- [x] 7. useUploadExcelFlow.ts 既存sub-hooks組み込み (753行 → 328行) ✅

  **What to do**:
  - `client/src/hooks/useUploadExcelFlow.ts` (753行) を既存の3 sub-hooksをcomposeする形にリファクタリング
  - Wave 4で抽出済みの以下3 hooksを組み込む:
    - `useDiffPreview.ts` — diffプレビューロジック
    - `useUploadJobPolling.ts` — ジョブポーリングロジック
    - `useUploadPreview.ts` — プレビュー表示ロジック
  - useUploadExcelFlow内の重複インラインロジックを削除し、sub-hooksへの委譲に置換
  - インターフェース調整が必要な場合は、sub-hooks側を先に修正してから組み込む

  **Must NOT do**:
  - 既存sub-hooksの削除（他の場所でも使える状態を維持）
  - Uploadフローの動作変更
  - 新規 Context/Provider 作成

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 3つの既存hooksとのインターフェース調整が複雑
  - **Skills**: [`simplify-refact`]

  **Parallelization**: Wave 3 (with Tasks 8, 9, 10) | Blocked By: 3-6

  **References**:
  - `client/src/hooks/useUploadExcelFlow.ts` — 753行、対象ファイル
  - `client/src/hooks/useDiffPreview.ts` — 既存sub-hook（現在未使用）
  - `client/src/hooks/useUploadJobPolling.ts` — 既存sub-hook（現在未使用）
  - `client/src/hooks/useUploadPreview.ts` — 型/ユーティリティのみ使用中
  - `client/src/pages/UploadPage.tsx` — 主要consumer

  **Acceptance Criteria**:
  - [ ] `wc -l client/src/hooks/useUploadExcelFlow.ts` → ≤400行
  - [ ] `npm run typecheck` → 0 errors
  - [ ] `npm run build:client` → success

  **QA Scenarios**:
  ```
  Scenario: 組み込み後の型チェック + ビルド成功
    Tool: Bash
    Steps:
      1. npm run typecheck
      2. npm run build:client
      3. wc -l client/src/hooks/useUploadExcelFlow.ts
    Expected Result: typecheck 0 errors, build success, ≤400 lines
    Evidence: .sisyphus/evidence/task-7-compose.txt

  Scenario: sub-hooksが独立でも使えることを確認
    Tool: Bash
    Steps:
      1. grep -rn "useDiffPreview\|useUploadJobPolling\|useUploadPreview" client/src/ --include='*.ts' --include='*.tsx'
      2. 各sub-hookが独立してimport可能であることを確認
    Expected Result: sub-hooksが自己完結している
    Evidence: .sisyphus/evidence/task-7-sub-hooks-independence.txt
  ```

  **Commit**: YES
  - Message: `refactor: compose existing sub-hooks into useUploadExcelFlow`
  - Pre-commit: `npm run typecheck`

- [x] 8. AdminPharmacyEditPage.tsx hook抽出 (725行 → 192行) ✅

  **What to do**:
  - `client/src/pages/admin/AdminPharmacyEditPage.tsx` (725行) からhookを抽出
  - `useAdminPharmacyEdit.ts` hookを作成し、20+の状態変数とビジネスロジックを移動
  - ページコンポーネントにはJSX + hook呼び出しのみ残す
  - Wave 4のAccountPageパターン（726→130行）を参照

  **Must NOT do**: コンポーネントprop interface変更、UI変更

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — **Skills**: [`simplify-refact`]

  **Parallelization**: Wave 3 (with Tasks 7, 9, 10) | Blocked By: 3-6

  **References**:
  - `client/src/pages/admin/AdminPharmacyEditPage.tsx` — 725行、対象
  - `client/src/hooks/useAccountForm.ts` — Wave 4のhook抽出パターン参照
  - `client/src/pages/AccountPage.tsx` — Wave 4で726→130行の成功例

  **Acceptance Criteria**:
  - [ ] `wc -l client/src/pages/admin/AdminPharmacyEditPage.tsx` → ≤400行
  - [ ] `npm run typecheck` → 0 errors
  - [ ] `npm run build:client` → success

  **QA Scenarios**: 同 Task 7 パターン（typecheck + build + line count）
  **Commit**: YES (groups with Tasks 9-10)

- [x] 9. AdminLogCenterPage.tsx hook/コンポーネント抽出 (636行 → 297行) ✅

  **What to do**:
  - `client/src/pages/admin/AdminLogCenterPage.tsx` (636行) からhookとサブコンポーネントを抽出
  - Metis推奨: `LogEntriesView`, `ErrorCodesTab`, `CommandHistoryTab` を同一ディレクトリに抽出
  - 状態管理hookも分離可能なら抽出

  **Must NOT do**: 新規Context/Provider作成、コンポーネントprop interface変更

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — **Skills**: [`simplify-refact`]

  **Parallelization**: Wave 3 (with Tasks 7, 8, 10) | Blocked By: 3-6

  **References**:
  - `client/src/pages/admin/AdminLogCenterPage.tsx` — 636行、対象

  **Acceptance Criteria**:
  - [ ] `wc -l client/src/pages/admin/AdminLogCenterPage.tsx` → ≤400行
  - [ ] `npm run typecheck` → 0 errors
  - [ ] `npm run build:client` → success

  **QA Scenarios**: 同 Task 7 パターン
  **Commit**: YES (groups with Task 8)

- [x] 10. BusinessHoursSettings.tsx コンポーネント抽出 (593行 → 168行) ✅

  **What to do**:
  - `client/src/components/account/BusinessHoursSettings.tsx` (593行) からサブコンポーネントを抽出
  - 通常営業時間設定 / 特例営業時間設定 / プレビュー表示 をそれぞれサブコンポーネント化
  - 既存の `useBusinessHoursForm.ts` hookとの連携を維持

  **Must NOT do**: hookインターフェース変更、営業時間バリデーションロジック変更

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — **Skills**: [`simplify-refact`]

  **Parallelization**: Wave 3 (with Tasks 7, 8, 9) | Blocked By: 3-6

  **References**:
  - `client/src/components/account/BusinessHoursSettings.tsx` — 593行、対象
  - `client/src/hooks/useBusinessHoursForm.ts` — 共有hook (391行)

  **Acceptance Criteria**:
  - [ ] `wc -l client/src/components/account/BusinessHoursSettings.tsx` → ≤400行
  - [ ] `npm run typecheck` → 0 errors
  - [ ] `npm run build:client` → success

  **QA Scenarios**: 同 Task 7 パターン
  **Commit**: YES (groups with Task 8)

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [x] F1. **Plan Compliance Audit** ✅ — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read barrel file, check exports). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** ✅ — `unspecified-high`
  Run `npm run typecheck` + `npm run lint` + `npm run test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Regression QA** ✅ — `unspecified-high`
  Run full test suite: `npm run test`. Verify all 4111+ tests pass. Run `npm run build:server && npm run build:client`. Check line counts for all 10 target files (`wc -l`). Verify each ≤400 or has documented exception. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Tests [N/N pass] | Build [PASS/FAIL] | Line Counts [N/N ≤400] | VERDICT`

- [x] F4. **Scope Fidelity Check** ✅ — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Wave | Commit Message | Files | Pre-commit |
|------|---------------|-------|------------|
| 1 | `refactor: split openclaw-service into sub-modules` | server/src/services/openclaw-* | `npm run test:server` |
| 1 | `refactor: extract upload-diff-service helpers` | server/src/services/upload-diff-* | `npm run test:server` |
| 2 | `refactor: extract route helpers for notifications, auth, upload-parser, admin-pharmacies-detail` | server/src/routes/*-helpers.ts | `npm run test:server` |
| 3 | `refactor: compose existing sub-hooks into useUploadExcelFlow` | client/src/hooks/useUploadExcelFlow.ts | `npm run typecheck` |
| 3 | `refactor: extract hooks from AdminPharmacyEditPage, AdminLogCenterPage, BusinessHoursSettings` | client/src/pages/admin/*, client/src/components/account/* | `npm run typecheck` |

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck     # Expected: 0 errors
npm run test          # Expected: all pass (4111+ tests)
npm run build:server  # Expected: success
npm run build:client  # Expected: success
```

### Final Checklist
- [x] All 10 files ≤400 lines ✅ (or exception documented)
- [x] All exported symbols preserved ✅ in barrels
- [ ] Pure re-export barrel pattern applied consistently
- [ ] No function signature changes
- [ ] No behavioral changes
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
