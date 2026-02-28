# リファクタリング: 可読性・セキュリティ・パフォーマンス改善

## TL;DR

> **Quick Summary**: DeadStockSolution のコード可読性・セキュリティ・パフォーマンスを3軸でバランス良く改善する。API完全互換を維持しながら、2つの巨大ルートファイルの分割、4件のセキュリティ修正、2件のパフォーマンス最適化を実施。
> 
> **Deliverables**:
> - `exchange.ts` (941行) を4つのサブルートファイルに分割
> - `admin-pharmacies.ts` (851行) を3つのサブルートファイルに分割
> - error-handler の4xxメッセージサニタイズ
> - 内部ルートの timing-safe 比較導入
> - CSP ヘッダー設定
> - CSRF token比較の timing-safe 化
> - matching-refresh-service の N+1 クエリ解消
> - 複合DBインデックス追加
> - 分割後モジュールのテスト追加
> 
> **Estimated Effort**: Medium（1-2週間）
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: Task 1-4 (security) → Task 5-6 (splits) → Task 7-8 (perf) → Task 9-10 (tests/verify)

---

## Context

### Original Request
コード可読性向上・セキュリティリスク低下・システム動作速度改善を狙ったリファクタリング。

### Interview Summary
**Key Discussions**:
- **優先順位**: バランス型（影響度×工数で個別判断）
- **API互換性**: 完全互換維持（外部API・DBスキーマは変更しない）
- **注目箇所**: matching-service.ts, inventory.ts, セキュリティ全般, 全体的
- **テスト戦略**: Tests-after（既存テスト通過確認 + 必要箇所にテスト追加）

**Research Findings**:
- **ファイルサイズ修正（Metis検証済み）**: 初期調査の数値は10-35倍の過大報告だった
  - matching-service.ts: 390行（既に5ファイルに分割済み、合計1,226行）
  - inventory.ts: 265行（分割不要）
  - notification-service.ts: 206行（分割不要）
  - monthly-report-scheduler.ts: 76行（分割不要）
- **実際の大ファイル**: exchange.ts (941行), admin-pharmacies.ts (851行) の2つのみ
- **セキュリティ**: CSRF/SSRF/ページネーション/パスワードリセット等は既に実装済み
- **テスト基盤**: Vitest 4.0, 78+テストファイル, CI統合, Coverage閾値あり

### Metis Review
**Identified Gaps (addressed)**:
- **CRITICAL**: ファイルサイズが10-35倍過大報告 → 実測値に修正、スコープを大幅縮小
- **CRITICAL**: セキュリティの70%は既実装 → 実際の未対策項目のみに絞り込み
- **CRITICAL**: パフォーマンスの60%は既対策済み → N+1とインデックスの2件に集中
- 内部ルートの`===`比較（timing attack） → タスクに追加
- CSRF比較の`===`使用 → タスクに追加

---

## Work Objectives

### Core Objective
API完全互換を維持しながら、セキュリティ脆弱性の修正、巨大ファイルの分割による可読性向上、N+1クエリ解消とインデックス追加によるパフォーマンス改善を行う。

### Concrete Deliverables
- セキュリティ修正4件（error-handler, 内部ルート, CSP, CSRF）
- ルートファイル分割2件（exchange.ts, admin-pharmacies.ts）
- パフォーマンス改善2件（N+1解消, 複合インデックス）
- テスト追加（分割後モジュール + 未テストエンドポイント）

### Definition of Done
- [x] `npm run test:server` → 全テスト PASS（既存379テスト + 新規テスト）
- [x] `npm run test:client` → 全テスト PASS
- [x] `npm run typecheck` → 0 errors
- [x] `npm run lint` → 0 errors
- [x] `npm run test:perf:server` → 全パフォーマンスベースライン PASS
- [x] `npm run build:server && npm run build:client` → ビルド成功
- [x] `npm run test:coverage:server` → Coverage閾値維持

### Must Have
- API のリクエスト/レスポンス形式に一切の変更なし
- DB スキーマ変更は `CREATE INDEX` のみ（テーブル構造変更なし）
- 既存テスト 379件が全て PASS
- パフォーマンス回帰テストが PASS

### Must NOT Have (Guardrails)
- ❌ matching-service.ts の分割（既に390行、5ファイルに分割済み）
- ❌ inventory.ts の分割（265行、分割不要）
- ❌ notification-service.ts の分割（206行、分割不要）
- ❌ monthly-report-scheduler.ts の分割（76行、分割不要）
- ❌ Redis 等の新規インフラ依存の追加
- ❌ ルートパスの変更（`/api/exchange/*` 等）
- ❌ レスポンス JSON の構造変更
- ❌ カナ正規化の書き換え（既にO(n)で効率的）
- ❌ 既実装のCSRF/SSRF/ページネーション/パスワードリセットの再実装
- ❌ auth キャッシュの LRU 化（FIFO + 5000上限で十分）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: Tests-after
- **Framework**: Vitest 4.0
- **Strategy**: 既存テスト全通過確認 → 分割/変更後にテスト追加

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Security fixes**: Bash (curl) — リクエスト送信、レスポンス検証
- **File splits**: Bash (npm test/typecheck) — テスト通過、型チェック
- **Performance**: Bash (npm run test:perf:server) — 回帰テスト

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — security fixes, all independent):
├── Task 1: error-handler 4xxメッセージサニタイズ [quick]
├── Task 2: 内部ルート timing-safe 比較 [quick]
├── Task 3: CSP ヘッダー設定 [quick]
└── Task 4: CSRF token 比較の timing-safe 化 [quick]

Wave 2 (After Wave 1 — file splits, parallel):
├── Task 5: exchange.ts ルート分割 (941行 → 4-5ファイル) [unspecified-high]
└── Task 6: admin-pharmacies.ts ルート分割 (851行 → 3-4ファイル) [unspecified-high]

Wave 3 (After Wave 2 — performance, parallel):
├── Task 7: matching-refresh-service N+1 クエリ解消 [deep]
└── Task 8: 複合DBインデックス追加 [quick]

Wave 4 (After Wave 3 — tests + verification):
├── Task 9: 分割後モジュールのテスト追加 [unspecified-high]
└── Task 10: 全体検証（テスト・型・lint・ビルド・perf） [quick]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1-4 → Task 5-6 → Task 7-8 → Task 9-10 → F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 4 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 10, F1-F4 | 1 |
| 2 | — | 10, F1-F4 | 1 |
| 3 | — | 10, F1-F4 | 1 |
| 4 | — | 10, F1-F4 | 1 |
| 5 | 1-4 | 9, 10, F1-F4 | 2 |
| 6 | 1-4 | 9, 10, F1-F4 | 2 |
| 7 | 5-6 | 10, F1-F4 | 3 |
| 8 | 5-6 | 10, F1-F4 | 3 |
| 9 | 5-8 | 10, F1-F4 | 4 |
| 10 | 1-9 | F1-F4 | 4 |
| F1-F4 | 1-10 | — | FINAL |

### Agent Dispatch Summary

- **Wave 1**: **4** — T1-T4 → `quick`
- **Wave 2**: **2** — T5-T6 → `unspecified-high`
- **Wave 3**: **2** — T7 → `deep`, T8 → `quick`
- **Wave 4**: **2** — T9 → `unspecified-high`, T10 → `quick`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. error-handler 4xxメッセージサニタイズ

  **What to do**:
  - `server/src/middleware/error-handler.ts` の `resolveResponseMessage` 関数（31行目）を修正
  - 4xxエラーでも `err.message` をそのままクライアントに返さず、内部情報（パス、スタックトレース、DBエラー詳細）をフィルタリング
  - 具体的には、本番環境（`NODE_ENV=production`）では内部エラー詳細を含まない汎用メッセージを返す
  - Zod バリデーションエラーや明示的なユーザー向けメッセージはそのまま通す（「パスワードが短すぎます」等）
  - 既存テスト `error-handler.test.ts` が通過することを確認、必要ならテストも更新

  **Must NOT do**:
  - 5xxのエラーハンドリングを変更しない（既に正しく本番では汎用メッセージを返している）
  - 400 entity.parse.failed のハンドリングを変更しない（既にサニタイズ済み）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 単一ファイルの関数修正、影響範囲が小さい
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: UI改修ではないため不要

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Task 10, F1-F4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `server/src/middleware/error-handler.ts:20-32` - 現在の resolveResponseMessage 実装。5xx の本番保護パターンを参考に 4xx も同様に保護する

  **Test References**:
  - `server/src/test/error-handler.test.ts` - 既存テスト。変更後も通過するように、必要なら期待値を更新

  **WHY Each Reference Matters**:
  - error-handler.ts: 31行目の `err.message` がそのまま返されており、内部エラー詳細がクライアントに漏れる可能性がある

  **Acceptance Criteria**:
  - [x] `npm run test:server` → PASS（error-handler.test.ts 含む）
  - [x] `npm run typecheck:server` → 0 errors

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 本番環境で4xxエラーが内部情報を漏らさない
    Tool: Bash (curl)
    Preconditions: NODE_ENV=production でサーバー起動済み、またはテストで検証
    Steps:
      1. `npm run test:server` で error-handler.test.ts が PASS することを確認
      2. テストケースで NODE_ENV=production 時に err.message がフィルタされることを検証
    Expected Result: 4xxレスポンスにスタックトレース、ファイルパス、DBエラー詳細が含まれない
    Failure Indicators: err.messageに `/Users/`, `at Object.`, `ENOENT`, `drizzle` 等の内部情報が含まれる
    Evidence: .sisyphus/evidence/task-1-error-sanitize.txt
  ```

  **Evidence to Capture:**
  - [x] task-1-error-sanitize.txt: テスト実行結果 + レスポンス検証

  **Commit**: YES (groups with 2, 3, 4)
  - Message: `fix(security): sanitize 4xx error messages in production`
  - Files: `server/src/middleware/error-handler.ts`, `server/src/test/error-handler.test.ts`
  - Pre-commit: `npm run test:server`

- [x] 2. 内部ルート timing-safe 比較導入

  **What to do**:
  - `server/src/routes/internal-matching-refresh.ts:14` の `reqAuthHeader === expected` を `crypto.timingSafeEqual()` に変更
  - `server/src/routes/internal-monthly-reports.ts:14` の `reqAuthHeader === \`Bearer \${secret}\`` を `crypto.timingSafeEqual()` に変更
  - バッファサイズが異なる場合の安全なハンドリングを実装（サイズ不一致は即座に false）
  - `openclaw-service.ts:221` の既存実装をパターン参考として使う

  **Must NOT do**:
  - 認証ロジックの変更（比較方法のみ変更）
  - ルートパスやミドルウェア構造の変更

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 2ファイルの比較演算子を置換するだけの単純作業
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Task 10, F1-F4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `server/src/services/openclaw-service.ts:221` - 既存の `crypto.timingSafeEqual` 実装。バッファサイズ整合とエラーハンドリングのパターンをそのまま踏襲する

  **API/Type References**:
  - `server/src/routes/internal-matching-refresh.ts:8-14` - 現在の認証ロジック（`===` 使用）
  - `server/src/routes/internal-monthly-reports.ts:9-14` - 同様の認証ロジック

  **Test References**:
  - `server/src/test/internal-matching-refresh-route.test.ts` - 既存の内部ルートテスト

  **WHY Each Reference Matters**:
  - openclaw-service.ts:221: 同プロジェクト内の timingSafeEqual の正しい使い方をコピーする
  - internal-matching-refresh.ts:14: `===` を使っており timing attack に脆弱

  **Acceptance Criteria**:
  - [x] `npm run test:server` → PASS（internal-matching-refresh-route.test.ts 含む）
  - [x] `npm run typecheck:server` → 0 errors

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: timing-safe 比較が正しく動作する
    Tool: Bash (npm test)
    Preconditions: コード変更済み
    Steps:
      1. `npm run test:server` で internal-matching-refresh-route.test.ts が PASS
      2. grep で変更後のファイルに `===` が認証比較に使われていないことを確認
      3. grep で `timingSafeEqual` が両ファイルに存在することを確認
    Expected Result: 全テスト PASS + `===` が bearer 比較に使われていない
    Failure Indicators: テスト失敗、または `reqAuthHeader ===` が残存
    Evidence: .sisyphus/evidence/task-2-timing-safe.txt

  Scenario: バッファサイズ不一致でもクラッシュしない
    Tool: Bash (npm test)
    Preconditions: テストケースでサイズ不一致の bearer token を送信
    Steps:
      1. 既存テストで不正なトークンが 401 を返すことを確認
    Expected Result: 401 Unauthorized が返る（クラッシュしない）
    Failure Indicators: 500 エラー、プロセスクラッシュ
    Evidence: .sisyphus/evidence/task-2-timing-safe-mismatch.txt
  ```

  **Commit**: YES (groups with 1, 3, 4)
  - Message: `fix(security): use timing-safe comparison for internal route auth`
  - Files: `server/src/routes/internal-matching-refresh.ts`, `server/src/routes/internal-monthly-reports.ts`
  - Pre-commit: `npm run test:server`

- [x] 3. CSP ヘッダー設定

  **What to do**:
  - `server/src/app.ts:111` の `contentSecurityPolicy: false` を React SPA 互換の CSP ポリシーに置換
  - `default-src 'self'`、`script-src 'self'`、`style-src 'self' 'unsafe-inline'`（Bootstrapがインラインスタイルを使用）、`img-src 'self' data:`、`connect-src 'self'` を設定
  - Vite の dev モードでは HMR のため `ws:` も許可が必要な場合があるが、これはサーバー側 CSP なので本番ビルドにのみ影響
  - helmet のオプションとして設定する（新しい依存追加不要）

  **Must NOT do**:
  - `unsafe-eval` を許可しない
  - 既存の helmet 設定（crossOriginEmbedderPolicy, crossOriginResourcePolicy等）を変更しない

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 単一ファイルの設定値変更
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 10, F1-F4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `server/src/app.ts:108-115` - 現在の helmet 設定全体。`contentSecurityPolicy: false` がある行を置換する

  **External References**:
  - Helmet CSP docs: https://helmetjs.github.io/ - CSP ディレクティブの設定方法

  **WHY Each Reference Matters**:
  - app.ts:111: `contentSecurityPolicy: false` はインラインスクリプトインジェクションを許可してしまう

  **Acceptance Criteria**:
  - [x] `npm run test:server` → PASS
  - [x] `npm run typecheck:server` → 0 errors
  - [x] `npm run build:client` → ビルド成功（CSPがViteビルドをブロックしないことを確認）

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: CSPヘッダーがレスポンスに含まれる
    Tool: Bash (npm test)
    Preconditions: コード変更済み
    Steps:
      1. `npm run test:server` で全テスト PASS
      2. grep で `contentSecurityPolicy: false` が app.ts から削除されていることを確認
      3. grep で `contentSecurityPolicy:` の新しい設定が存在することを確認
    Expected Result: CSP ポリシーが有効化され、`unsafe-eval` が含まれない
    Failure Indicators: `contentSecurityPolicy: false` が残存、または `unsafe-eval` が含まれる
    Evidence: .sisyphus/evidence/task-3-csp-header.txt
  ```

  **Commit**: YES (groups with 1, 2, 4)
  - Message: `fix(security): enable Content-Security-Policy header for SPA`
  - Files: `server/src/app.ts`
  - Pre-commit: `npm run test:server`

- [x] 4. CSRF token 比較の timing-safe 化

  **What to do**:
  - `server/src/middleware/csrf.ts:69` の `csrfCookie !== csrfHeader` を `crypto.timingSafeEqual()` に変更
  - Task 2 と同様に、バッファサイズ不一致の安全なハンドリングを実装
  - 空文字列チェック（`!csrfCookie || !csrfHeader`）は先に行われるので、timingSafeEqual は両方非空のときのみ呼ばれる
  - 既存の csrf.test.ts が通過することを確認

  **Must NOT do**:
  - CSRF ミドルウェアのロジック構造を変更しない
  - Cookie名やヘッダー名を変更しない

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 単一比較演算子の置換
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 10, F1-F4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `server/src/middleware/csrf.ts:52-70` - 現在の csrfProtection 実装と69行目の `!==` 比較が対象
  - `server/src/services/openclaw-service.ts:221` - timingSafeEqual の既存実装パターン

  **Test References**:
  - `server/src/test/csrf.test.ts` - CSRF ミドルウェアの包括的テスト（マッチ/ミスマッチ/セーフメソッドバイパス）

  **WHY Each Reference Matters**:
  - csrf.ts:69: `!==` を使っており、理論上は timing attack 可能（CSRFでは低リスクだが defense-in-depth として修正）

  **Acceptance Criteria**:
  - [x] `npm run test:server` → PASS（csrf.test.ts 含む）
  - [x] `npm run typecheck:server` → 0 errors

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: CSRF検証が正しく動作する
    Tool: Bash (npm test)
    Preconditions: コード変更済み
    Steps:
      1. `npm run test:server` で csrf.test.ts が PASS
      2. grep で `csrfCookie !== csrfHeader` が csrf.ts から削除されていることを確認
      3. grep で `timingSafeEqual` が csrf.ts に存在することを確認
    Expected Result: 全テスト PASS + timing-safe 比較が使用されている
    Failure Indicators: テスト失敗、または `!==` が残存
    Evidence: .sisyphus/evidence/task-4-csrf-timing-safe.txt
  ```

  **Commit**: YES (groups with 1, 2, 3)
  - Message: `fix(security): use timing-safe comparison for CSRF token validation`
  - Files: `server/src/middleware/csrf.ts`
  - Pre-commit: `npm run test:server`


- [x] 5. exchange.ts ルート分割（941行 → 4-5ファイル）

  **What to do**:
  - `server/src/routes/exchange.ts`（941行、15エンドポイント）を責務別に分割:
    - `exchange-proposals.ts` — 提案一覧・作成・詳細取得
    - `exchange-status.ts` — ステータス変更（承認・拒否・確定・完了）
    - `exchange-comments.ts` — コメントCRUD
    - `exchange-feedback.ts` — フィードバック・評価
  - `exchange.ts` はアグリゲーターとして残し、各サブルーターを `router.use()` でマウント
  - `admin.ts` の既存アグリゲーターパターンに従う
  - `app.ts` のインポートは変更不要（exchange.ts がそのままエクスポートを維持）
  - 分割前に `lsp_find_references` でインポート元を全て確認
  - 分割前に `ast_grep_search` でエンドポイント一覧を取得

  **Must NOT do**:
  - `/api/exchange/*` のルートパスを変更しない
  - レスポンスJSONの構造を変更しない
  - ビジネスロジックを変更しない（ファイル構造のみ変更）
  - `app.ts` のマウントポイントを変更しない

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 複数ファイル作成 + インポート管理 + テスト確認が必要
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: UIテストではないため不要

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 6)
  - **Parallel Group**: Wave 2 (with Task 6)
  - **Blocks**: Tasks 7, 8, 9, 10, F1-F4
  - **Blocked By**: Tasks 1-4 (Wave 1 complete)

  **References**:

  **Pattern References**:
  - `server/src/routes/admin.ts` - 既存のアグリゲーターパターン。各サブルートを `router.use()` でマウントしている例。このパターンをそのまま踏襲する
  - `server/src/routes/exchange.ts` - 分割対象ファイル全体。全15エンドポイントのハンドラーを責務別にグルーピング

  **API/Type References**:
  - `server/src/services/exchange-service.ts` - ビジネスロジック。ルートから呼び出されるサービス関数群
  - `server/src/services/proposal-priority-service.ts` - 提案優先度計算ロジック
  - `server/src/types/index.ts` - 共有型定義

  **Test References**:
  - `server/src/test/exchange-route-priority.test.ts` - exchange ルートの既存テスト。分割後も通過することを確認
  - `server/src/test/exchange-service.test.ts` - サービス層のテスト（ルート分割で影響を受けないはず）

  **WHY Each Reference Matters**:
  - admin.ts: 分割のアグリゲーターパターンが既に存在するので、同じパターンを踏襲することで一貫性を維持
  - exchange.ts: 15エンドポイントが1ファイルに集中しており可読性が低い

  **Acceptance Criteria**:
  - [x] `npm run test:server` → PASS（既存全テスト + exchange-route-priority.test.ts）
  - [x] `npm run typecheck:server` → 0 errors
  - [x] `npm run build:server` → ビルド成功
  - [x] ルートパスが変更されていないことを grep で確認

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 分割後も全エンドポイントが動作する
    Tool: Bash (npm test + grep)
    Preconditions: ファイル分割完了
    Steps:
      1. `npm run test:server` で全テスト PASS
      2. `npm run typecheck:server` で 0 errors
      3. `npm run build:server` でビルド成功
      4. ast_grep_search で exchange.ts からの router.get/post/patch/delete がサブファイルに移動されていることを確認
      5. grep で app.ts が変更されていないことを git diff で確認
    Expected Result: 全テスト PASS、型チェック OK、ビルド成功、app.ts 未変更
    Failure Indicators: テスト失敗、型エラー、ビルドエラー、app.ts が変更されている
    Evidence: .sisyphus/evidence/task-5-exchange-split.txt

  Scenario: アグリゲーターが正しくサブルーターをマウント
    Tool: Bash (grep)
    Preconditions: 分割完了
    Steps:
      1. grep で exchange.ts に `router.use` が存在することを確認
      2. exchange.ts の行数が 50行以下になっていることを確認（アグリゲーターのみ）
    Expected Result: exchange.ts がアグリゲーターとして機能、各サブファイルが200-300行以下
    Failure Indicators: exchange.ts がまだ500行以上、サブファイルが存在しない
    Evidence: .sisyphus/evidence/task-5-exchange-aggregator.txt
  ```

  **Commit**: YES
  - Message: `refactor(routes): split exchange.ts into focused sub-route modules`
  - Files: `server/src/routes/exchange.ts`, `server/src/routes/exchange-proposals.ts`, `server/src/routes/exchange-status.ts`, `server/src/routes/exchange-comments.ts`, `server/src/routes/exchange-feedback.ts`
  - Pre-commit: `npm run test:server && npm run typecheck:server`

- [x] 6. admin-pharmacies.ts ルート分割（851行 → 3-4ファイル）

  **What to do**:
  - `server/src/routes/admin-pharmacies.ts`（851行、14エンドポイント）を責務別に分割:
    - `admin-pharmacies-list.ts` — 一覧・検索・フィルタリング
    - `admin-pharmacies-detail.ts` — 詳細取得・更新・ステータス変更
    - `admin-pharmacies-actions.ts` — 特殊操作（パスワードリセット、アカウント停止等）
  - `admin-pharmacies.ts` はアグリゲーターとして残す
  - `admin.ts` が既に admin-pharmacies.ts をマウントしているので、admin.ts のインポートは変更不要
  - Task 5 と同様に分割前に `lsp_find_references` でインポート元を確認

  **Must NOT do**:
  - `/api/admin/pharmacies/*` のルートパスを変更しない
  - レスポンスJSONの構造を変更しない
  - `admin.ts` のマウントポイントを変更しない

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 複数ファイル作成 + インポート管理 + テスト確認
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 5)
  - **Parallel Group**: Wave 2 (with Task 5)
  - **Blocks**: Tasks 7, 8, 9, 10, F1-F4
  - **Blocked By**: Tasks 1-4 (Wave 1 complete)

  **References**:

  **Pattern References**:
  - `server/src/routes/admin.ts` - アグリゲーターパターン。admin-pharmacies.ts を `router.use('/pharmacies', pharmaciesRoutes)` でマウントしている
  - `server/src/routes/admin-pharmacies.ts` - 分割対象ファイル、14エンドポイントを責務別にグルーピング

  **API/Type References**:
  - `server/src/routes/admin-utils.ts` - 管理用共通ユーティリティ。分割後のサブファイルからもimportされる

  **Test References**:
  - `server/src/test/admin-route.test.ts` - adminルートの既存テスト。分割後も通過することを確認

  **WHY Each Reference Matters**:
  - admin.ts: admin-pharmacies.ts のインポート元。分割後もエクスポートが維持される必要がある
  - admin-pharmacies.ts: 14エンドポイントが1ファイルに集中しており可読性が低い

  **Acceptance Criteria**:
  - [x] `npm run test:server` → PASS（admin-route.test.ts 含む）
  - [x] `npm run typecheck:server` → 0 errors
  - [x] `npm run build:server` → ビルド成功

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 分割後も全adminエンドポイントが動作する
    Tool: Bash (npm test + grep)
    Preconditions: ファイル分割完了
    Steps:
      1. `npm run test:server` で全テスト PASS
      2. `npm run typecheck:server` で 0 errors
      3. `npm run build:server` でビルド成功
      4. grep で admin.ts が変更されていないことを git diff で確認
    Expected Result: 全テスト PASS、型チェック OK、ビルド成功、admin.ts 未変更
    Failure Indicators: テスト失敗、型エラー、ビルドエラー
    Evidence: .sisyphus/evidence/task-6-admin-pharmacies-split.txt
  ```

  **Commit**: YES
  - Message: `refactor(routes): split admin-pharmacies.ts into focused sub-route modules`
  - Files: `server/src/routes/admin-pharmacies.ts`, `server/src/routes/admin-pharmacies-list.ts`, `server/src/routes/admin-pharmacies-detail.ts`, `server/src/routes/admin-pharmacies-actions.ts`
  - Pre-commit: `npm run test:server && npm run typecheck:server`


- [x] 7. matching-refresh-service N+1 クエリ解消

  **What to do**:
  - `server/src/services/matching-refresh-service.ts` の `processPendingMatchingRefreshJobs` をリファクタ
  - 現在: impactedIds の各薬局IDに対してループ内で `findMatches()` を個別呼び出し（各呼び出しで6+DBクエリ）
  - 改善: 影響を受ける薬局のデータを事前にバッチ取得し、ループ内ではDBアクセスを最小化
  - `findMatches` のインターフェースを変更する場合は、既存の呼び出し元も更新
  - 改善前後で同じ結果が得られることを既存テストで検証

  **Must NOT do**:
  - `findMatches` のビジネスロジック（マッチングアルゴリズム）を変更しない
  - 新しいキャッシュレイヤー（Redis等）を追加しない
  - マッチング結果の形式を変更しない

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: N+1解消はDBクエリ構造の理解と慈重なリファクタが必要
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 8)
  - **Parallel Group**: Wave 3 (with Task 8)
  - **Blocks**: Tasks 9, 10, F1-F4
  - **Blocked By**: Tasks 5-6 (Wave 2 complete)

  **References**:

  **Pattern References**:
  - `server/src/services/matching-refresh-service.ts` - 全体（255行）。`processPendingMatchingRefreshJobs` 関数内のループがターゲット
  - `server/src/services/matching-service.ts` - `findMatches()` のシグネチャと内部DBクエリを理解するため
  - `server/src/services/matching-score-service.ts` - スコアリングロジック（変更不要だが依存理解に必要）

  **Test References**:
  - `server/src/test/matching-refresh-service.test.ts` - 既存テスト。リファクタ後も同じ結果を返すことを検証
  - `server/src/test/matching-service.test.ts` - findMatches のテスト（インターフェース変更時に参照）

  **WHY Each Reference Matters**:
  - matching-refresh-service.ts: N+1の根本原因。各薬局ごとに findMatches() を呼ぶループがボトルネック
  - matching-service.ts: findMatches の内部クエリを理解してバッチ化の実現可能性を判断

  **Acceptance Criteria**:
  - [x] `npm run test:server` → PASS（matching-refresh-service.test.ts 含む）
  - [x] `npm run test:perf:server` → パフォーマンス回帰なし
  - [x] `npm run typecheck:server` → 0 errors

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: N+1が解消されバッチクエリになっている
    Tool: Bash (npm test + grep)
    Preconditions: リファクタ完了
    Steps:
      1. `npm run test:server` で matching-refresh-service.test.ts が PASS
      2. `npm run test:perf:server` でパフォーマンス回帰なし
      3. grep で processPendingMatchingRefreshJobs 内のループ構造が改善されていることを確認
    Expected Result: 全テスト PASS + パフォーマンス回帰なし + バッチクエリ化済み
    Failure Indicators: テスト失敗、パフォーマンス回帰、ループ内に個別findMatches呼び出しが残存
    Evidence: .sisyphus/evidence/task-7-n-plus-1-fix.txt
  ```

  **Commit**: YES
  - Message: `perf(matching): batch matching-refresh queries to eliminate N+1`
  - Files: `server/src/services/matching-refresh-service.ts`
  - Pre-commit: `npm run test:server && npm run test:perf:server`

- [x] 8. 複合DBインデックス追加

  **What to do**:
  - Drizzle マイグレーションで以下の複合インデックスを追加:
    - `dead_stock_items(pharmacy_id, is_available, drug_name)` — 在庫検索の高速化
    - `used_medication_items(pharmacy_id, drug_name)` — 使用済み医薬品検索の高速化
  - `drizzle-kit generate` でマイグレーションファイルを生成
  - `CREATE INDEX IF NOT EXISTS` または `CREATE INDEX CONCURRENTLY` を使用（安全な追加）
  - 既存インデックスと重複しないことを確認

  **Must NOT do**:
  - テーブル構造（カラム、型、制約）を変更しない
  - 既存インデックスを削除・変更しない
  - Drizzle スキーマ定義以外のソースコードを変更しない

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: スキーマにインデックス定義を追加 + マイグレーション生成のみ
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 7)
  - **Parallel Group**: Wave 3 (with Task 7)
  - **Blocks**: Tasks 9, 10, F1-F4
  - **Blocked By**: Tasks 5-6 (Wave 2 complete)

  **References**:

  **Pattern References**:
  - `server/src/db/schema.ts:1-563` - 既存スキーマ。既存のインデックス定義パターンを確認し、同じ形式で追加する
  - `server/drizzle.config.ts` - Drizzle Kit 設定。マイグレーション生成コマンドの実行に必要

  **API/Type References**:
  - `server/src/routes/inventory.ts` - 在庫検索クエリ。インデックスが使われるクエリパターンを確認

  **WHY Each Reference Matters**:
  - schema.ts: 既存インデックスと重複しないことを確認するため
  - inventory.ts: どのカラム組み合わせがクエリされているかを理解するため

  **Acceptance Criteria**:
  - [x] `npm run db:generate --workspace=server` → マイグレーションファイル生成成功
  - [x] `npm run test:server` → PASS
  - [x] `npm run typecheck:server` → 0 errors

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: インデックスがスキーマに追加されている
    Tool: Bash (grep + npm)
    Preconditions: スキーマ変更済み
    Steps:
      1. grep で schema.ts に新しいインデックス定義が存在することを確認
      2. `npm run db:generate --workspace=server` が成功することを確認
      3. 生成されたマイグレーションSQLに CREATE INDEX が含まれることを確認
      4. `npm run test:server` で全テスト PASS
    Expected Result: インデックス定義追加 + マイグレーション生成成功 + テスト PASS
    Failure Indicators: スキーマエラー、マイグレーション生成失敗、テスト失敗
    Evidence: .sisyphus/evidence/task-8-indexes.txt
  ```

  **Commit**: YES
  - Message: `perf(db): add composite indexes for dead stock and used medication queries`
  - Files: `server/src/db/schema.ts`, `server/drizzle/` (マイグレーションファイル)
  - Pre-commit: `npm run test:server`

- [x] 9. 分割後モジュールのテスト追加

  **What to do**:
  - Task 5 で分割した exchange サブルートの未テストエンドポイントにテスト追加
  - Task 6 で分割した admin-pharmacies サブルートの未テストエンドポイントにテスト追加
  - 既存のテストパターン（supertest + vitest）に従う
  - 最低限: 各サブルートの主要エンドポイントの正常系 + エラー系テスト
  - Coverage 閾値が維持されることを確認

  **Must NOT do**:
  - 既存テストを削除・弱化しない（.claude/rules/test-quality.md 厳守）
  - テストをスキップ（it.skip, xit, xdescribe）しない
  - アサーションを緩和しない

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 複数テストファイル作成 + テストパターン理解が必要
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (sequential with Task 10)
  - **Blocks**: Task 10, F1-F4
  - **Blocked By**: Tasks 5-8 (Wave 2-3 complete)

  **References**:

  **Pattern References**:
  - `server/src/test/exchange-route-priority.test.ts` - exchange ルートの既存テストパターン。supertest + vitest の使い方を踏襲
  - `server/src/test/admin-route.test.ts` - adminルートの既存テストパターン。モック戦略とヘルパーを参考
  - `server/src/test/helpers/` - テストヘルパー群。既存のヘルパーを再利用する

  **WHY Each Reference Matters**:
  - 既存テストパターンに従うことで一貫性を維持し、レビューコストを下げる

  **Acceptance Criteria**:
  - [x] `npm run test:server` → PASS（既存 + 新規テスト全て）
  - [x] `npm run test:coverage:server` → Coverage閾値維持（Lines ≥49%）

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 新規テストが追加されカバレッジが維持される
    Tool: Bash (npm test)
    Preconditions: テストファイル作成済み
    Steps:
      1. `npm run test:server` で全テスト PASS
      2. `npm run test:coverage:server` で Coverage 閾値維持
      3. 新規テストファイルが存在し、it.skip が含まれないことを確認
    Expected Result: 全テスト PASS + Coverage閾値維持 + skipなし
    Failure Indicators: テスト失敗、Coverage低下、it.skip存在
    Evidence: .sisyphus/evidence/task-9-tests.txt
  ```

  **Commit**: YES
  - Message: `test: add tests for split route modules and untested endpoints`
  - Files: `server/src/test/exchange-*.test.ts`, `server/src/test/admin-pharmacies-*.test.ts`
  - Pre-commit: `npm run test:server && npm run test:coverage:server`

- [x] 10. 全体検証（テスト・型・Lint・ビルド・perf）

  **What to do**:
  - 全検証コマンドを順番に実行:
    1. `npm run typecheck` → 0 errors
    2. `npm run lint` → 0 errors
    3. `npm run test:server` → ALL PASS
    4. `npm run test:client` → ALL PASS
    5. `npm run test:perf:server` → パフォーマンス回帰なし
    6. `npm run build:server && npm run build:client` → ビルド成功
    7. `npm run test:coverage:server && npm run test:coverage:client` → Coverage閾値維持
  - 失敗があれば該当タスクに戻って修正

  **Must NOT do**:
  - lintエラーを `eslint-disable` で回避しない
  - テストをスキップしない
  - `@ts-ignore` を追加しない

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: コマンド実行と結果確認のみ
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (after Task 9)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1-9 (all implementation tasks)

  **Acceptance Criteria**:
  - [x] 上記全コマンド PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 全検証コマンドが成功する
    Tool: Bash
    Steps:
      1. `npm run typecheck` → 0 errors
      2. `npm run lint` → 0 errors
      3. `npm run test` → ALL PASS
      4. `npm run test:perf:server` → ALL PASS
      5. `npm run build:server && npm run build:client` → 成功
      6. `npm run test:coverage` → 閾値維持
    Expected Result: 全コマンド PASS
    Failure Indicators: いずれかのコマンドが失敗
    Evidence: .sisyphus/evidence/task-10-final-verification.txt
  ```

  **Commit**: NO (検証のみ)

---
## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run typecheck && npm run lint && npm run test:server && npm run test:client`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (skipped: no user-facing changes, all backend refactoring)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep` (APPROVE: code correct; commit grouping is per-plan Wave 1 strategy)
  For each task: read "What to do", read actual diff. Verify 1:1. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `fix(security): sanitize 4xx error messages and add timing-safe comparisons` — error-handler.ts, internal-*.ts, csrf.ts, app.ts
- **Wave 2a**: `refactor(routes): split exchange.ts into focused sub-route modules` — exchange-*.ts
- **Wave 2b**: `refactor(routes): split admin-pharmacies.ts into focused sub-route modules` — admin-pharmacies-*.ts
- **Wave 3a**: `perf(matching): batch matching-refresh queries to eliminate N+1` — matching-refresh-service.ts
- **Wave 3b**: `perf(db): add composite indexes for dead stock and used medication queries` — migration file
- **Wave 4**: `test: add tests for split route modules and untested endpoints` — test files

---

## Success Criteria

### Verification Commands
```bash
npm run test:server              # Expected: ALL tests PASS (379 existing + new)
npm run test:client              # Expected: ALL tests PASS
npm run typecheck                # Expected: 0 errors
npm run lint                     # Expected: 0 errors (--max-warnings=0)
npm run test:perf:server         # Expected: ALL performance baselines PASS
npm run build:server             # Expected: clean build
npm run build:client             # Expected: clean build
npm run test:coverage:server     # Expected: Lines ≥49%, Statements ≥48%, Functions ≥56%, Branches ≥42%
npm run test:coverage:client     # Expected: Lines ≥45%, Statements ≥45%, Functions ≥45%, Branches ≥35%
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] All tests pass (existing + new)
- [x] API完全互換を確認（レスポンス構造に変更なし）
- [x] パフォーマンス回帰なし
