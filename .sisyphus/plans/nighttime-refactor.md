# 無人夜間リファクタリング — Security・Stability・Readability

## TL;DR

> **目的**: リポジトリ全体をスキャンし、セキュリティ → 安定性 → 可読性の優先度で、挙動保全を担保しつつ自律的に改善を適用する。
>
> **成果物**:
> - Upload/CSVエクスポート/提案書き込みエンドポイントへのレートリミッター追加
> - 検索パラメータの最大長バリデーション追加
> - JSON.parse クラッシュベクターの防御的修正（migrate.ts）— cursor-pagination.ts は既に防御済み
> - 共通レスポンスヘルパー/バリデーションヘルパーの集約・重複排除
> - 全変更のアトミックコミット（各コミット独立で revert 可能）
>
> **見積もり規模**: Medium（7 実装タスク + 1 プリフライト + 1 最終検証）— Task 6 は既に実装済みのため SKIP
> **並列実行**: YES — 4 Wave
> **クリティカルパス**: Pre-flight → Security Wave → Stability Wave → Readability Wave → Final Verification

---

## Context

### Original Request
無人の夜間リファクタリング計画。セキュリティ・安定性・可読性の改善を自律的に進めるための実行計画。Atlas が >10% の推測なしに実行できるレベルまで具体化。cosmetic churn・投機的抽象化は明確に禁止。

### 調査結果サマリー（4 並列エージェント + 直接スキャン）

**セキュリティ監査結果**:
- CRITICAL: 0 / HIGH: 2（CSRF cookie 設計通り、JWT テスト専用シークレット） / MEDIUM: 5 / LOW: 6
- SQL Injection: SAFE（Drizzle ORM が全 `sql` テンプレートをパラメタライズ）
- `sql.raw()` はマイグレーション内のみ（安全）
- `child_process` 使用: `execFile`（`exec` ではない — より安全）
- ハードコードされたシークレット: なし / `eval()`: なし / `console.log` 汚染: なし
- CORS: オリジンバリデーション付きで適切に設定
- Helmet + CSP 設定済み（`style-src 'unsafe-inline'` は Bootstrap に必要）
- **レートリミッターのギャップ**: Upload/CSV エクスポート/提案書き込みに専用リミッターなし（グローバル 1200/15min のみ）

**安定性監査結果**:
- Express 5.2.1 確認済み — sync/async エラーを自動的にグローバルエラーハンドラーに転送
- JSON.parse 未保護: **3 件のみ**（当初の 9 件報告は過大評価 — Metis が検証・修正）
  - `db/migrate.ts:15` — **真のクラッシュベクター**（Express 外のスタートアップスクリプト）
  - `utils/cursor-pagination.ts:9` — ユーザー入力起点、Express がキャッチするが改善余地あり
  - `matching-snapshot-service.ts:144` — DB データ、Express がキャッチ
- `void Promise.all` は **安全** — 内部の各 Promise が個別に try/catch 済み（Metis が検証）
- タイマー/イベントリスナー: 全てクリーンアップ済み
- DB トランザクション: 適切に管理
- 循環依存: なし

**可読性監査結果**:
- `sendBadRequest()` が 3+ ルートファイルに重複定義
- `parseVersion()`/`parseOptionalTrimmedString()` バリデーションヘルパー重複
- TODO/FIXME/HACK コメント: 0
- `console.log` プロダクションコード内: 0
- 長大ファイル多数あるが、well-organized なので分割は限定的に

**テストカバレッジ**:
- 4,104 テスト / 267 テストファイル
- 現在: 92.06% lines（目標 95%）/ 94.11% functions
- 未テストルート: 19 ファイル / 未テストサービス: 8 ファイル
- TypeScript strict mode: 有効

### Metis Review — 重要な修正と追加ガードレール

**修正された誤認**:
1. JSON.parse クラッシュベクター: 9 件 → 実際は 3 件のみ未保護（Express 5 が残りをキャッチ）
2. `void Promise.all` 未処理 Promise: 誤り — 各 Promise が個別に try/catch 済み
3. 未テストルートファイル数: 12 → 実際は 19

**追加されたガードレール** (G1-G8):
- G1: Express 5 セーフティネット — ルートハンドラーの JSON.parse に過剰な try/catch を追加しない
- G2: 逐次的ロジックの分解禁止 — `useUploadExcelFlow.handleConfirm`, `auth.requireLogin` は触らない
- G3: ファイル分割上限 — 長いだけで well-organized なファイルは分割しない
- G4: OpenAPI 契約ゲート — ルートファイル変更後は `npm run openapi:check` 必須
- G5: パフォーマンスリグレッションゲート
- G6: `eslint-disable react-hooks/exhaustive-deps` は削除禁止（意図的）
- G7: Sentry/OpenClaw エラーパス保全 — エラーメッセージ変更禁止
- G8: テストファイルの `as any`/`@ts-expect-error` は対象外

---

## Work Objectives

### Core Objective
レポジトリ全体の Security・Stability・Readability を、挙動を壊さず、アトミックかつ独立 revert 可能なコミット単位で改善する。

### Concrete Deliverables
- `server/src/routes/upload.ts` — Upload エンドポイント用レートリミッター追加
- `server/src/routes/admin-csv-export.ts` — CSV エクスポート用レートリミッター追加
- `server/src/routes/exchange-proposals.ts` — 提案書き込み用レートリミッター追加
- `server/src/routes/admin-logs.ts` + 検索パラメータを持つルート — 最大長バリデーション追加
- `server/src/db/migrate.ts` — JSON.parse try/catch + `process.exit(1)`
- ~~`server/src/utils/cursor-pagination.ts`~~ — **既に防御済み**: try/catch + `return null` 実装確認済み（Momus レビュー）
- `server/src/routes/response-helpers.ts` — 新規：共通レスポンスヘルパー
- `server/src/routes/validation-helpers.ts` — 新規：共通バリデーションヘルパー
- `.sisyphus/evidence/` — 各タスクの検証エビデンス

### Definition of Done
- [ ] `npm run test` — 全テスト PASS（4,104+ テスト）
- [ ] `npm run typecheck` — 型エラー 0
- [ ] `npm run lint` — Lint エラー 0
- [ ] `npm run test:perf:server` — パフォーマンスリグレッションなし
- [ ] カバレッジ ≥ ベースライン（92.06% 以上を維持）
- [ ] 各コミットが独立して `git revert` 可能

### Must Have
- Security: Upload/CSVエクスポート/提案書き込みのレートリミッター
- Stability: `db/migrate.ts` の JSON.parse 保護
- Readability: `sendBadRequest` 重複排除
- 全変更がアトミックコミット
- 各タスク後の検証パス

### Must NOT Have（ガードレール）
- ❌ Cosmetic churn（インデント変更、import 並び替え等の見た目だけの変更）
- ❌ 投機的抽象化（「将来使うかも」のためのリファクタリング）
- ❌ 大規模 rewrite（1タスクで 4+ ファイルの構造変更）
- ❌ `useUploadExcelFlow.handleConfirm` / `auth.requireLogin` の分解
- ❌ `eslint-disable react-hooks/exhaustive-deps` コメントの削除
- ❌ テストファイル内の `as any` / `@ts-expect-error` の修正
- ❌ Sentry/OpenClaw に流れるエラーメッセージの変更
- ❌ データベーススキーマの変更
- ❌ OpenClaw handoff / Upload diff ロジックの変更（テストなし）
- ❌ カバレッジギャップ埋め（スコープ外）
- ❌ 長いだけで well-organized なファイルの分割（auth-helpers.ts 等）
- ❌ 新規 rate limiter は 3 つまで（over-engineering 防止）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — 全検証はエージェント実行。例外なし。

### Test Decision
- **Infrastructure exists**: YES（Vitest 4 + Supertest + PGlite）
- **Automated tests**: YES（Tests-after — 既存テストで挙動保全を確認、必要に応じて characterization test 追加）
- **Framework**: vitest（server）, vitest + @testing-library/react（client）

### Pre-Flight Baseline（全変更前に必須キャプチャ）
```bash
npm run test:server              # テスト数・PASS 確認
npm run test:client              # クライアントテスト PASS
npm run typecheck                # 型エラー 0
npm run lint                     # Lint エラー 0
npm run test:perf:server         # パフォーマンスベースライン
```
Expected: All exit code 0. 1 つでも失敗したら **全計画を STOP**。

### Per-Task Verification（各アトミック変更後）
```bash
npm run test:server              # サーバーテスト全 PASS
npm run typecheck --workspace=server  # 型エラー 0
npm run lint --workspace=server  # Lint エラー 0
```
ルートファイル変更時は追加: `npx vitest run server/src/test/openapi-contract.test.ts --config server/vitest.config.ts`

### Final Gate（全変更完了後）
```bash
npm run test                     # 全テスト PASS
npm run typecheck                # 型エラー 0
npm run lint                     # Lint エラー 0
npm run test:perf:server         # リグレッションなし
npm run test:coverage            # カバレッジ ≥ ベースライン
```

### QA Policy
- **Rate limiter**: Bash (curl) — 連続リクエストで 429 レスポンスを確認
- **JSON.parse 保護**: Bash — 不正入力で適切なエラーレスポンス/終了コードを確認
- **ヘルパー抽出**: `npm run test:server` — テストファイル変更なしで全テスト PASS

### Rollback Policy
- 各タスクは 1 アトミックコミットを生成
- Per-Task Verification が失敗した場合: `git revert <commit>` → 次のタスクへスキップ
- **revert 後は必ず再度 verification を実行して clean state を確認**
- **revert されたタスクは `.sisyphus/evidence/reverted-tasks.txt` に記録**（タスク番号、revert 理由、revert コミットハッシュ）
- revert されたタスクの Must Have 項目は F1 で「REVERTED（理由付き）」として報告される（REJECT ではない）
- **完了条件**: revert なしで全 Must Have 達成 = FULL SUCCESS / revert ありだが codebase は clean = PARTIAL SUCCESS
- ブロッカー条件（後述）に該当する場合: 全計画を停止

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 0 (Pre-flight — baseline capture):
└── Task 0: Pre-flight baseline capture & branch creation [quick]

Wave 1 (Security — MAX PARALLEL):
├── Task 1: Rate limiter for upload endpoints [deep]
├── Task 2: Rate limiter for CSV export endpoints [quick]
└── Task 3: Rate limiter for proposal write endpoints [quick]
    (Task 4 は normalizeSearchTerm() が既にトランケート済みのため SKIPPED)

Wave 2 (Stability):
└── Task 5: db/migrate.ts JSON.parse protection [quick]
    (Task 6 は cursor-pagination.ts が既に防御済みのため SKIPPED)

Wave 3 (Readability — SEQUENTIAL):
├── Task 7: Extract response-helpers.ts (sendBadRequest/sendConflict) [quick]
└── Task 8: Extract validation-helpers.ts (parseVersion etc.) [quick]

Wave FINAL (Verification — 4 parallel):
├── Task F1: Plan compliance audit [deep]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: Real QA — rate limiter & JSON.parse verification [unspecified-high]
└── Task F4: Scope fidelity check + final report generation [deep]

Critical Path: Task 0 → Task 1 → Task 5 → Task 7 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 0 | — | 1,2,3,5,7,8 | 0 |
| 1 | 0 | F1-F4 | 1 |
| 2 | 0 | F1-F4 | 1 |
| 3 | 0 | F1-F4 | 1 |
| ~~4~~ | — | — | SKIPPED |
| 5 | 0 | F1-F4 | 2 |
| ~~6~~ | — | — | SKIPPED |
| 7 | 0 | 8, F1-F4 | 3 |
| 8 | 7 | F1-F4 | 3 |
| F1-F4 | 1-3,5,7,8 | — | FINAL |

### Agent Dispatch Summary

| Wave | Tasks | Categories |
|------|-------|-----------|
| 0 | 1 | T0 → `quick` |
| 1 | 3 | T1 → `deep`, T2 → `quick`, T3 → `quick` (T4 SKIPPED) |
| 2 | 1 | T5 → `quick` (T6 SKIPPED) |
| 3 | 2 | T7 → `quick`, T8 → `quick` |
| FINAL | 4 | F1 → `deep`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep` |

---

## Blocker Conditions（即時停止条件）

以下のいずれかに該当した場合、計画を **即時停止** し、最終レポートを生成して終了する：

1. **Pre-flight 失敗**: ベースラインが broken（テスト失敗、型エラー、lint エラー）
2. **連続 revert**: 2 タスク連続で revert が必要になった場合（系統的な問題の可能性）
3. **カバレッジ低下**: テストカバレッジがベースラインから 0.5% 以上低下
4. **型エラー発生**: `npm run typecheck` でエラーが出て、そのタスク内で解決不能
5. **OpenAPI 契約違反**: ルート変更後に `openapi-contract.test.ts` が失敗し、解決不能
6. **パフォーマンスリグレッション**: `npm run test:perf:server` が失敗

## Completion Conditions（完了条件）

計画は以下の条件で完了とする：

**FULL SUCCESS（全 Must Have 達成）**:
1. 全 Wave のタスクが完了（revert なし）
2. Final Verification Wave の 4 エージェント全てが APPROVE
3. `npm run test && npm run typecheck && npm run lint` が exit 0
4. `npm run test:perf:server` が PASS
5. カバレッジ ≥ ベースライン
6. 最終レポートが生成され、`.sisyphus/evidence/final-report.md` に保存
7. feature ブランチに全コミットが完了

**PARTIAL SUCCESS（一部 revert あり）**:
1. 全 Wave のタスクが完了または revert でスキップ
2. Final Verification Wave: F1 が PARTIAL（revert 分を除き残りは APPROVE）、F2-F4 は APPROVE
3. `npm run test && npm run typecheck && npm run lint` が exit 0（codebase は clean）
4. `npm run test:perf:server` が PASS
5. カバレッジ ≥ ベースライン
6. 最終レポートに revert されたタスクと理由が記載
7. `.sisyphus/evidence/reverted-tasks.txt` が存在

**どちらの場合も計画は「完了」扱い。** PARTIAL の場合は revert 項目が次回計画の推奨フォローアップに記載される。

---

## TODOs

- [x] 0. Pre-flight Baseline Capture & Branch Creation

  **What to do**:
  - feature ブランチ `refactor/nighttime-security-stability` を作成
  - 以下のコマンドを順次実行し、全て exit 0 を確認:
    ```bash
    npm run test:server
    npm run test:client
    npm run typecheck
    npm run lint
    npm run test:perf:server
    ```
  - テスト数（4,104+）、カバレッジ（≥92.06% lines）をログに記録
  - 1 つでも失敗した場合は **全計画を即時停止** し、理由を `.sisyphus/evidence/preflight-failure.md` に記録

  **Must NOT do**:
  - ソースコードの変更
  - 既存ブランチへの force push

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: コマンド実行とログ記録のみの軽量タスク
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 0 (standalone)
  - **Blocks**: Tasks 1, 2, 3, 4, 5, 6, 7, 8
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `server/vitest.config.ts` — カバレッジ閾値設定（lines 95%, functions 95%, branches 86%）
  - `package.json` scripts セクション — 利用可能なテスト/ビルドコマンド

  **WHY Each Reference Matters**:
  - `vitest.config.ts`: ベースライン数値の期待値を確認するために参照
  - `package.json`: 正確なコマンド名を確認するために参照

  **Acceptance Criteria**:
  - [ ] `git branch --show-current` → `refactor/nighttime-security-stability`
  - [ ] `npm run test:server` → exit 0
  - [ ] `npm run test:client` → exit 0
  - [ ] `npm run typecheck` → exit 0
  - [ ] `npm run lint` → exit 0
  - [ ] `npm run test:perf:server` → exit 0

  **QA Scenarios**:

  ```
  Scenario: Pre-flight 全コマンド成功
    Tool: Bash
    Preconditions: clean working tree (git status shows nothing to commit)
    Steps:
      1. git checkout -b refactor/nighttime-security-stability
      2. npm run test:server 2>&1 | tail -5 — 最終行に "Tests passed" 相当の出力
      3. npm run test:client 2>&1 | tail -5 — 最終行に PASS
      4. npm run typecheck 2>&1 — 出力なし（エラー 0）
      5. npm run lint 2>&1 — 出力なし（エラー 0）
      6. npm run test:perf:server 2>&1 | tail -5 — PASS
    Expected Result: 全コマンド exit 0
    Failure Indicators: いずれかが exit 1 → 計画全体を停止
    Evidence: .sisyphus/evidence/task-0-preflight-baseline.txt
  ```

  **Commit**: NO（ブランチ作成のみ、コミットなし）

- [x] 1. Rate Limiter for Upload Endpoints

  **What to do**:
  - `server/src/routes/upload-parser.ts` の先頭で `express-rate-limit` をインポート
  - **重要**: 実際の `/preview`, `/confirm`, `/confirm-async` ハンドラーは `upload-parser.ts` にある（`upload.ts:15` は `parserRouter` をマウントするだけ）
  - Upload 用レートリミッターを定義:
    ```typescript
    import rateLimit from 'express-rate-limit';
    import { AuthRequest } from '../types';

    const uploadLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'アップロードリクエストが多すぎます。しばらく待ってからお試しください。' },
      keyGenerator: (req) => (req as AuthRequest).user?.id?.toString() ?? req.ip ?? 'unknown',
    });
    ```
  - `router.post('/preview', uploadSingleFile, ...)` の `uploadSingleFile`（multer）の **前** に `uploadLimiter` を挿入: `router.post('/preview', uploadLimiter, uploadSingleFile, ...)`
  - 同様に `router.post('/confirm', ...)` (line 219) と `router.post('/confirm-async', ...)` (line 226) にも適用
  - **重要**: レートリミッターは multer（ファイルパース）の **前** に配置すること。429 応答時にファイルパースを無駄に実行しない
  - **注意**: `express-rate-limit` はインメモリストアを使用。Vercel サーバーレスではコールドスタートでリセットされる（バースト保護として機能、持続的攻撃保護は限定的）。コミットメッセージにこの制限を記載

  **Must NOT do**:
  - 既存のルートハンドラーロジックの変更
  - エラーメッセージの変更（Sentry/OpenClaw パス保全）
  - multer / `uploadSingleFile` の設定変更
  - `upload.ts` の変更（対象は `upload-parser.ts`）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: ミドルウェアの挿入順序が重要、Express のミドルウェアチェーンを理解する必要あり
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 0

  **References**:

  **Pattern References**:
  - `server/src/routes/upload-parser.ts:70` — `router.post('/preview', uploadSingleFile, ...)` — リミッターをこの `uploadSingleFile` の前に挿入する
  - `server/src/routes/upload-parser.ts:219` — `router.post('/confirm', ...)` — 同様にリミッター挿入
  - `server/src/routes/upload-parser.ts:226` — `router.post('/confirm-async', ...)` — 同様にリミッター挿入
  - `server/src/routes/account.ts:24-41` — `passwordChangeLimiter`, `accountDeletionLimiter` の定義パターン（`keyGenerator` で `req.user.id` 使用）
  - `server/src/routes/exchange-proposals.ts` — `findLimiter` の定義パターン

  **API/Type References**:
  - `server/src/routes/upload.ts:15` — `router.use('/', parserRouter)` — upload.ts は parserRouter をマウントするだけ。変更不要
  - `server/src/app.ts:245-253` — グローバルレートリミッター設定（1200 req/15min）

  **Test References**:
  - `server/src/test/upload-route.test.ts` — 既存の upload ルートテスト（変更不要だが動作確認用）
  - `server/src/test/upload-parser-route-coverage.test.ts` — parser ルートの既存テスト

  **WHY Each Reference Matters**:
  - `upload-parser.ts:70,219,226`: リミッターの実際の挿入位置。ここに `uploadLimiter` をミドルウェアチェーンの先頭に追加する
  - `account.ts:24-41`: `keyGenerator` パターンをコピーする。`(req as AuthRequest)` キャストが必要
  - `upload.ts:15`: 変更不要であることの確認

  **Acceptance Criteria**:
  - [ ] `npm run test:server` → PASS（既存テスト変更なし）
  - [ ] `npm run typecheck --workspace=server` → exit 0
  - [ ] `npm run test:server -- src/test/openapi-contract.test.ts` → PASS（ルート変更時は必須）

  **QA Scenarios**:

  ```
  Scenario: Upload レートリミッターが 429 を返す
    Tool: Bash (curl)
    Preconditions: サーバーが localhost:3001 で起動（PORT 未指定時のデフォルト）、テスト用薬局アカウントが DB に存在すること
    Auth取得手順（全 rate-limit QA 共通 — 3 ステップ）:
      # Step 1: テスト薬局一覧を取得し、メール/パスワードを確認
      #   GET /api/auth/test-pharmacies?includePassword=true
      #   （TEST_LOGIN_FEATURE_ENABLED=true、EXPOSE_PASSWORD_RESET_TOKEN=true が必要な場合あり）
      #   レスポンスから email と password を取得
      TEST_EMAIL=$(curl -s http://localhost:3001/api/auth/test-pharmacies?includePassword=true | npx tsx -e "
        const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
        console.log(d.pharmacies?.[0]?.email ?? d[0]?.email ?? '')" -)
      TEST_PASSWORD=<test-pharmacies レスポンスで得たパスワード>
      # Step 2: cookie jar にログインセッションを保存（token + csrfToken 両方設定される）
      curl -s -c /tmp/qa-cookies.txt http://localhost:3001/api/auth/login \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"
      # Step 3: csrfToken を変数に抽出（POST 用に必要 — GET は CSRF 免除）
      CSRF=$(grep csrfToken /tmp/qa-cookies.txt | awk '{print $NF}')
      # ※テスト薬局が存在しない場合の代替: admin シードを使用
      #   admin@admin.com + ADMIN_SEED_PASSWORD 環境変数（server/src/db/seed-admin-account.ts:9 参照）
    Steps:
      1. for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/upload/preview -b /tmp/qa-cookies.txt -H "x-csrf-token: $CSRF"; done
      2. 最後のレスポンスコードが 429 であることを確認
      3. レスポンスボディに "アップロードリクエストが多すぎます" を含むことを確認
    Expected Result: 11 回目のリクエストが HTTP 429 を返す
    Failure Indicators: 11 回目が 200/400/500 を返す
    Evidence: .sisyphus/evidence/task-1-upload-rate-limit.txt

  Scenario: 正常範囲のリクエストは通過する
    Tool: Bash (curl)
    Preconditions: サーバー起動済み、レートリミッターリセット後
    Steps:
      1. curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/upload/preview -b /tmp/qa-cookies.txt -H "x-csrf-token: $CSRF" -F "file=@test-data/dead-stock-test.xlsx"
      2. レスポンスコードが 200 または 400（バリデーションエラー）であることを確認
    Expected Result: 429 ではないレスポンス
    Failure Indicators: 初回リクエストで 429 が返る
    Evidence: .sisyphus/evidence/task-1-upload-rate-limit-normal.txt
  ```

  **Commit**: YES
  - Message: `feat(security): add rate limiter for upload endpoints`
  - Files: `server/src/routes/upload-parser.ts`
  - Pre-commit: `npm run test:server && npm run typecheck --workspace=server`

- [x] 2. Rate Limiter for CSV Export Endpoints

  **What to do**:
  - `server/src/routes/admin-csv-export.ts` の先頭で `express-rate-limit` をインポート
  - CSV エクスポート用レートリミッターを定義:
    ```typescript
    const csvExportLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'エクスポートリクエストが多すぎます。しばらく待ってからお試しください。' },
      keyGenerator: (req) => req.user?.id?.toString() ?? req.ip ?? 'unknown',
    });
    ```
  - 全 `router.get(...)` ハンドラーの前に `csvExportLimiter` を適用
  - CSV エクスポートは DB に重い集計クエリを発行するため、濫用防止が目的

  **Must NOT do**:
  - CSV 生成ロジックの変更
  - レスポンスフォーマットの変更

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Task 1 のパターンをコピーするだけの単純な作業
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 0

  **References**:

  **Pattern References**:
  - `server/src/routes/account.ts:24-41` — レートリミッター定義パターン
  - Task 1 の実装（同一 Wave 内だが独立）

  **API/Type References**:
  - `server/src/routes/admin-csv-export.ts` — 全体を読み、GET ハンドラーの位置を確認

  **WHY Each Reference Matters**:
  - `account.ts:24-41`: `keyGenerator` パターンを統一するため

  **Acceptance Criteria**:
  - [ ] `npm run test:server` → PASS
  - [ ] `npm run typecheck --workspace=server` → exit 0
  - [ ] `npm run test:server -- src/test/openapi-contract.test.ts` → PASS

  **QA Scenarios**:

  ```
  Scenario: CSV エクスポートレートリミッターが 429 を返す
    Tool: Bash (curl)
    Preconditions: サーバー起動済み、admin ユーザー（isAdmin=true）が DB に存在すること
    Auth取得手順:
      # admin アカウント: server/src/db/seed-admin-account.ts:9 に基づき admin@admin.com
      # パスワードは ADMIN_SEED_PASSWORD 環境変数でシード時に設定される
      curl -s -c /tmp/qa-admin-cookies.txt http://localhost:3001/api/auth/login \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"admin@admin.com\",\"password\":\"$ADMIN_SEED_PASSWORD\"}"
    Steps:
      1. for i in $(seq 1 21); do curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/admin/csv/pharmacies -b /tmp/qa-admin-cookies.txt; done
      2. 21 回目のレスポンスコードが 429 であることを確認
      Note: 実在するCSVルートは /api/admin/csv/pharmacies, /api/admin/csv/exchanges, /api/admin/csv/reports の3つ。GET なので CSRF 不要
    Expected Result: 21 回目で HTTP 429
    Failure Indicators: 21 回目が 200/403 を返す
    Evidence: .sisyphus/evidence/task-2-csv-export-rate-limit.txt
  ```

  **Commit**: YES
  - Message: `feat(security): add rate limiter for CSV export endpoints`
  - Files: `server/src/routes/admin-csv-export.ts`
  - Pre-commit: `npm run test:server && npm run typecheck --workspace=server`

- [x] 3. Rate Limiter for Proposal Write Endpoints

  **What to do**:
  - `server/src/routes/exchange-proposals.ts` に提案書き込み用レートリミッターを追加
  - 既存の `findLimiter`（GET 用）と同様のパターンで、POST/PUT/PATCH 用のリミッターを定義:
    ```typescript
    const proposalWriteLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: '提案リクエストが多すぎます。しばらく待ってからお試しください。' },
      keyGenerator: (req) => req.user?.id?.toString() ?? req.ip ?? 'unknown',
    });
    ```
  - `router.post(...)`, `router.put(...)`, `router.patch(...)` の前に `proposalWriteLimiter` を適用
  - **既存の `findLimiter` は変更しない**

  **Must NOT do**:
  - 既存の `findLimiter` の変更
  - 提案ワークフローロジックの変更
  - エラーメッセージの変更

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 既存パターン（findLimiter）が同一ファイルにあるのでコピーするだけ
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 0

  **References**:

  **Pattern References**:
  - `server/src/routes/exchange-proposals.ts` — 既存 `findLimiter` の定義（ファイル先頭付近）

  **Test References**:
  - `server/src/test/exchange-proposals-route-coverage.test.ts` — 提案ルートの既存テスト

  **WHY Each Reference Matters**:
  - `exchange-proposals.ts` 内の `findLimiter`: 同一ファイル内にある実在パターンを正確にコピーする

  **Acceptance Criteria**:
  - [ ] `npm run test:server` → PASS
  - [ ] `npm run typecheck --workspace=server` → exit 0
  - [ ] `npm run test:server -- src/test/openapi-contract.test.ts` → PASS

  **QA Scenarios**:

  ```
  Scenario: 提案書き込みレートリミッターが 429 を返す
    Tool: Bash (curl)
    Preconditions: サーバー起動済み、Task 1 で取得した cookie jar 再利用（/tmp/qa-cookies.txt + $CSRF）
    Steps:
      1. for i in $(seq 1 31); do curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/exchange/proposals -b /tmp/qa-cookies.txt -H "x-csrf-token: $CSRF" -H "Content-Type: application/json" -d '{"matchingSnapshotId": 1}'; done
      2. 31 回目のレスポンスコードが 429 であることを確認
    Expected Result: 31 回目で HTTP 429
    Failure Indicators: 31 回目が 200/400/404 を返す
    Evidence: .sisyphus/evidence/task-3-proposal-write-rate-limit.txt
  ```

  **Commit**: YES
  - Message: `feat(security): add rate limiter for proposal write endpoints`
  - Files: `server/src/routes/exchange-proposals.ts`
  - Pre-commit: `npm run test:server && npm run typecheck --workspace=server`

- ~~4. Query Parameter Max-Length Validation~~ **SKIPPED**: `admin-logs.ts:76` は既に `normalizeSearchTerm(req.query.keyword, 120)` を使用しており、`normalizeSearchTerm()` (`request-utils.ts:50`) は `.slice(0, maxLength)` で入力をトランケート済み。`admin-log-center.ts:86` も `normalizeSearchTerm(req.query.search)` でデフォルト maxLength=100 を使用。両ファイルとも既に防御済みのため、このタスクは no-op。

- [x] 5. db/migrate.ts JSON.parse Protection (Genuine Crash Vector)

  **What to do**:
  - `server/src/db/migrate.ts:15` の `JSON.parse(raw)` を try/catch で包む
  - **これは Express 外のスタートアップスクリプト** — グローバルエラーハンドラーが存在しないため、真のクラッシュベクター
  - 修正パターン:
    ```typescript
    let journal: { entries: Array<{ idx: number; when: number; tag: string }> };
    try {
      journal = JSON.parse(raw) as typeof journal;
    } catch (err) {
      console.error(`Failed to parse migration journal: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    ```
  - **重要**: `process.exit(1)` で終了すること。`process.exit(0)` にするとマイグレーション失敗を握り潰す
  - ここは Express 外なので `console.error` の使用は適切（logger はまだ初期化されていない可能性あり）

  **Must NOT do**:
  - マイグレーションロジックの変更
  - ジャーナルファイルのフォーマット変更
  - 正常系の exit code の変更

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 5 行の try/catch 追加のみ
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 6)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 0

  **References**:

  **Pattern References**:
  - `server/src/db/migrate.ts` — ファイル全体を読み、JSON.parse の使用箇所とフロー全体を把握する

  **External References**:
  - `server/src/db/seed-test-pharmacy-accounts.ts:121` — 同ディレクトリ内の類似 JSON.parse + try/catch パターン

  **WHY Each Reference Matters**:
  - `migrate.ts`: ファイル全体の文脈（変数の使われ方、後続処理）を理解しないと正しい try/catch 範囲を決められない
  - `seed-test-pharmacy-accounts.ts:121`: 同ディレクトリ内の既存 try/catch パターンに合わせる

  **Acceptance Criteria**:
  - [ ] `npm run test:server` → PASS
  - [ ] `npm run typecheck --workspace=server` → exit 0

  **QA Scenarios**:

  ```
  Scenario: 修正後の migrate.ts に try/catch + process.exit(1) が存在する
    Tool: Bash (grep — 修正後のファイル内容を静的検証)
    Preconditions: Task 5 の実装完了後
    Steps:
      1. grep -n "try {" server/src/db/migrate.ts — JSON.parse を囲む try ブロックが存在すること
      2. grep -n "catch" server/src/db/migrate.ts — catch ブロックが存在すること
      3. grep -n "process.exit(1)" server/src/db/migrate.ts — 異常終了が exit(1) であること
      4. grep -n "Failed to parse\|parse.*journal\|migration journal" server/src/db/migrate.ts — エラーメッセージが含まれること
      5. grep -c "process.exit(0)" server/src/db/migrate.ts | grep "^0$" — exit(0) で握り潰していないこと（0 件であること）
    Expected Result: try/catch が JSON.parse を囲み、catch 内で console.error + process.exit(1) が呼ばれる
    Failure Indicators: try/catch がない、process.exit(0) がある、エラーメッセージがない
    Evidence: .sisyphus/evidence/task-5-migrate-json-parse.txt

  Scenario: 正常な _journal.json で型チェック・テスト PASS
    Tool: Bash
    Preconditions: 既存のマイグレーションジャーナルが正常
    Steps:
      1. npm run typecheck --workspace=server — 型チェック通過確認
      2. npm run test:server — 全テスト PASS
    Expected Result: 既存の挙動に変化なし
    Evidence: .sisyphus/evidence/task-5-migrate-normal.txt
  ```

  **Commit**: YES
  - Message: `fix(stability): add try-catch to migration script JSON.parse`
  - Files: `server/src/db/migrate.ts`
  - Pre-commit: `npm run test:server && npm run typecheck --workspace=server`

- ~~6. cursor-pagination.ts~~ **SKIPPED**: Momus レビューで `cursor-pagination.ts:7-13` が既に try/catch + `return null` を実装済みと判明。このタスクは no-op のため削除。

- [x] 7. Extract Shared Response Helpers (sendBadRequest/sendConflict)

  **What to do**:
  - 新規ファイル `server/src/routes/response-helpers.ts` を作成
  - 以下の関数を集約:
    ```typescript
    import { Response } from 'express';

    export function sendBadRequest(res: Response, error: string): null {
      res.status(400).json({ error });
      return null;
    }

    export function sendConflict(res: Response, error: string): null {
      res.status(409).json({ error });
      return null;
    }
    ```
  - 以下のファイルからローカル定義を削除し、共通モジュールからインポートに切り替え:
    - `server/src/routes/account.ts` — `sendBadRequest`, `sendConflict`
    - `server/src/routes/inventory.ts` — `sendBadRequest`
    - `server/src/routes/business-hours.ts` — `sendBadRequest`
  - **各ファイルの既存の関数シグネチャと完全に一致することを `lsp_find_references` で確認してから作業開始**
  - `upload-validation.ts` にも類似パターンがあるが、シグネチャが異なる可能性があるので、今回は **3 ファイルのみ** を対象とする

  **Must NOT do**:
  - 関数シグネチャの変更（引数の型、戻り値の型）
  - テストファイルの変更（テストは既存のまま PASS するはず）
  - 5 ファイル以上の変更（本タスクの対象は response-helpers.ts(new) + account.ts + inventory.ts + business-hours.ts の 4 ファイルのみ）
  - `sendBadRequest` の使用箇所のロジック変更

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 純粋なコード移動（extract + import change）でロジック変更なし
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (Task 8 が依存)
  - **Parallel Group**: Wave 3 (sequential with Task 8)
  - **Blocks**: Task 8, F1-F4
  - **Blocked By**: Task 0

  **References**:

  **Pattern References**:
  - `server/src/routes/account.ts:45-52` — `sendBadRequest()` と `sendConflict()` の現在の定義
  - `server/src/routes/inventory.ts:53-56` — `sendBadRequest()` の重複定義
  - `server/src/routes/business-hours.ts:56-59` — `sendBadRequest()` の重複定義
  - `server/src/routes/admin-utils.ts` — `parseIdOrBadRequest()` — 既存の共通ヘルパーパターン参照

  **WHY Each Reference Matters**:
  - 3 ファイルのローカル定義: シグネチャが完全一致することを確認してから抽出する
  - `admin-utils.ts`: 既存の共通ヘルパーモジュールのパターン（export スタイル、命名規則）に合わせる

  **Acceptance Criteria**:
  - [ ] `npm run test:server` → PASS（テストファイル変更なし）
  - [ ] `npm run typecheck --workspace=server` → exit 0
  - [ ] `npm run lint --workspace=server` → exit 0
  - [ ] `git diff --stat` → 変更ファイルが `response-helpers.ts`(new) + `account.ts` + `inventory.ts` + `business-hours.ts` の 4 ファイルのみ

  **QA Scenarios**:

  ```
  Scenario: テストファイル変更なしで全テスト PASS
    Tool: Bash
    Preconditions: Task 7 のコミット適用済み
    Steps:
      1. git diff --name-only HEAD~1 — テストファイルが含まれていないことを確認
      2. npm run test:server — 全テスト PASS
      3. npm run typecheck --workspace=server — exit 0
    Expected Result: テストファイル変更なし、全テスト PASS、型エラー 0
    Failure Indicators: テストファイルが diff に含まれる / テスト失敗
    Evidence: .sisyphus/evidence/task-7-response-helpers-tests.txt

  Scenario: 新しい response-helpers.ts が正しくエクスポートされている
    Tool: Bash
    Preconditions: Task 7 のコミット適用済み
    Steps:
      1. npx tsx -e "import { sendBadRequest, sendConflict } from './server/src/routes/response-helpers'; console.log(typeof sendBadRequest, typeof sendConflict)"
      2. 出力が "function function" であることを確認
    Expected Result: "function function"
    Failure Indicators: "undefined" が含まれる / import エラー
    Evidence: .sisyphus/evidence/task-7-response-helpers-export.txt
  ```

  **Commit**: YES
  - Message: `refactor(readability): extract shared response helpers`
  - Files: `server/src/routes/response-helpers.ts`(new), `server/src/routes/account.ts`, `server/src/routes/inventory.ts`, `server/src/routes/business-hours.ts`
  - Pre-commit: `npm run test:server && npm run typecheck --workspace=server && npm run lint --workspace=server`

- [x] 8. Extract Shared Validation Helpers (parseVersion etc.)

  **What to do**:
  - 新規ファイル `server/src/routes/validation-helpers.ts` を作成
  - 以下の関数を **account.ts:55-67 から完全にそのまま** 集約（動作変更禁止）:
    ```typescript
    // account.ts:55-58 の完全コピー — Number(value) への変換やスライスは絶対にしない
    export function parseVersion(value: unknown): number | null {
      if (typeof value !== 'number' || !Number.isInteger(value)) return null;
      if (value < 1 || value > 2_147_483_647) return null;
      return value;
    }

    // account.ts:61-67 の完全コピー — maxLength 超過時は slice ではなく null を返す
    export function parseOptionalTrimmedString(value: unknown, maxLength: number): string | null | undefined {
      if (value === undefined) return undefined;
      if (typeof value !== 'string') return null;
      const normalized = value.trim();
      if (normalized.length === 0 || normalized.length > maxLength) return null;
      return normalized;
    }
    ```
  - **重要**: 上記は `account.ts:55-67` のバイト単位のコピーである。`Number(value)` への型変換や `slice(0, maxLength)` によるトランケートは **元のコードに存在しない** ため、追加してはならない
  - `server/src/routes/account.ts` からローカル定義を削除し、共通モジュールからインポートに切り替え:
    - `account.ts:55-58` の `parseVersion` → `validation-helpers.ts` からインポート
    - `account.ts:61-67` の `parseOptionalTrimmedString` → `validation-helpers.ts` からインポート
  - **注意**: `business-hours.ts:80` の `isValidVersion()` はシグネチャが異なる（`value is number` 型ガード）ため、**今回のスコープ外**。統合しない
  - **作業前に `lsp_find_references` で `parseVersion` と `parseOptionalTrimmedString` の全使用箇所を確認**
  - `account.ts` 以外のファイルで同名関数が使われている場合のみ、そのファイルも対象に含める

  **Must NOT do**:
  - 関数の動作変更
  - 使用箇所のロジック変更
  - テストファイルの変更
  - シグネチャが異なる関数の無理な統一

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Task 7 と同パターンの純粋なコード移動
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Task 7)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 7

  **References**:

  **Pattern References**:
  - `server/src/routes/account.ts:55-67` — `parseVersion()`, `parseOptionalTrimmedString()` の現在の定義（抽出元）
  - Task 7 で作成した `response-helpers.ts` — モジュール構成パターンを合わせる

  **WHY Each Reference Matters**:
  - `account.ts:55-67`: 抽出元の正確な実装。バイト単位でコピーすること
  - `response-helpers.ts`: 同じ Wave で作成したヘルパーモジュールのパターンに合わせる

  **スコープ外の確認済みファイル**:
  - `business-hours.ts:80` — `isValidVersion()` はシグネチャが異なる（`value is number` 型ガード）ため対象外

  **Acceptance Criteria**:
  - [ ] `npm run test:server` → PASS（テストファイル変更なし）
  - [ ] `npm run typecheck --workspace=server` → exit 0
  - [ ] `npm run lint --workspace=server` → exit 0
  - [ ] `git diff --stat` → 変更ファイルが `validation-helpers.ts`(new) + `account.ts` のみ

  **QA Scenarios**:

  ```
  Scenario: テストファイル変更なしで全テスト PASS
    Tool: Bash
    Preconditions: Task 8 のコミット適用済み
    Steps:
      1. git diff --name-only HEAD~1 — テストファイルが含まれていないこと、かつ account.ts と validation-helpers.ts のみが含まれることを確認
      2. npm run test:server — 全テスト PASS
      3. npm run typecheck --workspace=server — exit 0
    Expected Result: テストファイル変更なし、変更は validation-helpers.ts(new) + account.ts のみ、全テスト PASS
    Failure Indicators: テスト失敗 / 型エラー / 予期しないファイルが diff に含まれる
    Evidence: .sisyphus/evidence/task-8-validation-helpers-tests.txt

  Scenario: 新しい validation-helpers.ts が正しくエクスポートされている
    Tool: Bash
    Preconditions: Task 8 のコミット適用済み
    Steps:
      1. npx tsx -e "import { parseVersion, parseOptionalTrimmedString } from './server/src/routes/validation-helpers'; console.log(typeof parseVersion, typeof parseOptionalTrimmedString)"
      2. 出力が "function function" であることを確認
    Expected Result: "function function"
    Failure Indicators: "undefined" が含まれる / import エラー
    Evidence: .sisyphus/evidence/task-8-validation-helpers-export.txt
  ```

  **Commit**: YES
  - Message: `refactor(readability): extract shared validation helpers`
  - Files: `server/src/routes/validation-helpers.ts`(new), `server/src/routes/account.ts`
  - Pre-commit: `npm run test:server && npm run typecheck --workspace=server && npm run lint --workspace=server`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. FULL SUCCESS requires ALL APPROVE. PARTIAL SUCCESS allows F1=PARTIAL (others APPROVE). Rejection on F2-F4 → fix → re-run.

- [x] F1. **Plan Compliance Audit** — `deep`

  **What to do**: `.sisyphus/plans/nighttime-refactor.md` を end-to-end で読み、各 "Must Have" の実装存在を確認し、各 "Must NOT Have" の違反をコードベース検索で検出する。revert されたタスクがある場合は `.sisyphus/evidence/reverted-tasks.txt` を参照し、該当 Must Have を「REVERTED（理由付き）」として報告する（REJECT ではなく PARTIAL）。

  **QA Scenarios**:
  ```
  Scenario: Must Have 項目の実装確認
    Tool: Bash + Grep
    Steps:
      1. grep -r "uploadLimiter\|csvExportLimiter\|proposalWriteLimiter" server/src/routes/ — 3 つのリミッターが存在すること
      2. cat server/src/db/migrate.ts | grep -A5 "JSON.parse" — try/catch が存在すること
      3. test -f server/src/routes/response-helpers.ts — ファイルが存在すること
      4. test -f server/src/routes/validation-helpers.ts — ファイルが存在すること
      5. ls .sisyphus/evidence/task-*.txt — エビデンスファイルが存在すること
    Expected Result: 全コマンドが一致するパターンを検出
    Evidence: .sisyphus/evidence/f1-plan-compliance.txt

  Scenario: Must NOT Have 違反検出
    Tool: Grep + ast_grep
    Steps:
      1. git diff main..HEAD --name-only | grep -v "^server/src/" — server/src/ 以外の変更がないこと
      2. git diff main..HEAD -- "*.test.ts" — テストファイルへの変更がないこと
      3. git diff main..HEAD -- server/src/db/schema.ts — スキーマ変更がないこと
    Expected Result: 全 grep が 0 行出力（違反なし）
    Evidence: .sisyphus/evidence/f1-must-not-have.txt
  ```
  Output: `Must Have [N/N done, M reverted] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/PARTIAL/REJECT`
  ※APPROVE = 全 Must Have 達成、PARTIAL = 一部 revert あり but codebase clean、REJECT = Must NOT Have 違反あり

- [x] F2. **Code Quality Review** — `unspecified-high`

  **What to do**: 全変更ファイルの品質を検証する。

  **QA Scenarios**:
  ```
  Scenario: ビルド・リント・テスト全通過
    Tool: Bash
    Steps:
      1. npm run typecheck 2>&1 — exit 0, 出力にエラーなし
      2. npm run lint 2>&1 — exit 0, 出力にエラーなし
      3. npm run test:server 2>&1 | tail -20 — 全テスト PASS
      4. npm run test:perf:server 2>&1 — PASS
    Expected Result: 4 コマンド全て exit 0
    Evidence: .sisyphus/evidence/f2-quality-check.txt

  Scenario: AI slop パターン不在確認
    Tool: Grep
    Steps:
      1. git diff main..HEAD | grep -c "as any" — 0 であること
      2. git diff main..HEAD | grep -c "console.log" — 0 であること
      3. git diff main..HEAD | grep -c "@ts-ignore" — 0 であること
      4. git diff main..HEAD | grep -cE "// TODO|// FIXME|// HACK" — 0 であること
    Expected Result: 全カウント 0
    Evidence: .sisyphus/evidence/f2-ai-slop-check.txt
  ```
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real QA — Rate Limiter & Stability Verification** — `unspecified-high`

  **What to do**: 全実装タスクの QA シナリオを再実行して検証する。

  **QA Scenarios**:
  ```
  Scenario: Rate limiter 動作検証（upload）
    Tool: Bash (curl)
    Steps:
      1. サーバーを起動: npm run dev:server &（デフォルト port 3001）
      2. テスト薬局一覧からログイン情報を取得し cookie jar を作成（Task 1 QA Auth取得手順を参照）
      3. for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/upload/preview -b /tmp/qa-cookies.txt -H "x-csrf-token: $CSRF"; done
      4. 11 回目のレスポンスが 429 であること
    Expected Result: HTTP 429 on 11th request
    Evidence: .sisyphus/evidence/final-qa/f3-upload-limiter.txt

  Scenario: Rate limiter 動作検証（CSV export）
    Tool: Bash (curl)
    Steps:
      1. admin cookie を取得（Task 2 QA Auth取得手順を参照 — admin@admin.com + $ADMIN_SEED_PASSWORD）:
         curl -s -c /tmp/qa-admin-cookies.txt http://localhost:3001/api/auth/login \
           -H "Content-Type: application/json" \
           -d "{\"email\":\"admin@admin.com\",\"password\":\"$ADMIN_SEED_PASSWORD\"}"
      2. for i in $(seq 1 21); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/admin/csv/pharmacies -b /tmp/qa-admin-cookies.txt; done
      3. 21 回目のレスポンスが 429 であること（GET なので CSRF 不要）
    Expected Result: HTTP 429 on 21st request
    Evidence: .sisyphus/evidence/final-qa/f3-csv-limiter.txt

  Scenario: migrate.ts JSON.parse 防御確認 — 修正後の実ファイルを検証
    Tool: Bash (grep + TypeScript compilation)
    Steps:
      1. cat server/src/db/migrate.ts | grep -A8 "JSON.parse" — try/catch が存在すること
      2. grep "process.exit(1)" server/src/db/migrate.ts — exit(1) が存在すること
      3. grep "Failed to parse\|parse.*journal\|catch" server/src/db/migrate.ts — エラーメッセージが存在すること
      4. npm run typecheck --workspace=server — 修正後の型チェック通過
    Expected Result: try/catch + process.exit(1) + エラーメッセージが migrate.ts に存在する
    Evidence: .sisyphus/evidence/final-qa/f3-migrate-json.txt

  Scenario: response/validation helpers 統合確認
    Tool: Bash
    Steps:
      1. npm run test:server — 全テスト PASS（ヘルパー抽出後もテスト変更なしで通過）
      2. git diff main..HEAD -- "*.test.ts" | wc -l — 0 行（テスト変更なし）
    Expected Result: テスト全 PASS、テストファイル変更 0
    Evidence: .sisyphus/evidence/final-qa/f3-helpers.txt
  ```
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check + Final Report** — `deep`
  For each task: read "What to do", read actual diff (`git log --oneline`, `git diff`). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Generate final report to `.sisyphus/evidence/final-report.md` with format:
  ```
  # 夜間リファクタリング最終レポート
  ## 実行サマリー
  - 開始時刻 / 終了時刻
  - 実行タスク数 / スキップ数 / revert 数
  ## Security 改善
  - [各タスクの結果]
  ## Stability 改善
  - [各タスクの結果]
  ## Readability 改善
  - [各タスクの結果]
  ## 検証結果
  - テスト: PASS/FAIL (N tests)
  - 型チェック: PASS/FAIL
  - Lint: PASS/FAIL
  - パフォーマンス: PASS/FAIL
  - カバレッジ: N% (ベースライン比 +/-N%)
  ## 未着手・スキップ項目
  - [理由付きリスト]
  ## 推奨フォローアップ
  - [次回計画で対処すべき項目]
  ```

  **QA Scenarios**:

  ```
  Scenario: Scope fidelity — 全タスクが仕様通り、スコープ外変更なし
    Tool: Bash (git)
    Preconditions: 全実装タスク完了済み、ブランチ上にコミットが存在
    Steps:
      1. git log --oneline main..HEAD で全コミットを列挙（revert コミットも含まれる場合あり）
      2. 各コミットのメッセージからタスク番号を特定し、git diff <commit>^..<commit> --name-only でタッチしたファイルを取得
      3. "rate limiter for upload" コミット: upload-parser.ts のみ
      4. "rate limiter for CSV export" コミット: admin-csv-export.ts のみ
      5. "rate limiter for proposal write" コミット: exchange-proposals.ts のみ
      6. "try-catch to migration script" コミット: db/migrate.ts のみ
      7. "extract shared response helpers" コミット: response-helpers.ts(new) + account.ts, inventory.ts, business-hours.ts
      8. "extract shared validation helpers" コミット: validation-helpers.ts(new) + account.ts
      ※revert コミットが存在する場合: .sisyphus/evidence/reverted-tasks.txt と照合し、revert 理由が記録済みであることを確認
      10. 上記以外のファイルが変更されていないことを確認: git diff main..HEAD --name-only | sort -u で全変更ファイルを列挙し、想定リストと比較
    Expected Result: 各コミットが計画のファイル範囲内に収まっている。想定外のファイル変更が 0 件
    Failure Indicators: 想定外のファイルが diff に含まれる、"Must NOT do" 対象ファイル（auth.ts, error-handler.ts, schema.ts）が変更されている
    Evidence: .sisyphus/evidence/final-qa/f4-scope-fidelity.txt

  Scenario: 最終レポート生成と内容検証
    Tool: Bash (cat + grep)
    Preconditions: F4 タスクのレポート生成ステップ完了後
    Steps:
      1. cat .sisyphus/evidence/final-report.md で内容を確認
      2. grep "実行サマリー" .sisyphus/evidence/final-report.md → ヒットすること
      3. grep "Security 改善" .sisyphus/evidence/final-report.md → ヒットすること
      4. grep "検証結果" .sisyphus/evidence/final-report.md → ヒットすること
      5. grep "推奨フォローアップ" .sisyphus/evidence/final-report.md → ヒットすること
      6. レポート内の「テスト」行が PASS を含むことを確認
      7. レポート内の「型チェック」行が PASS を含むことを確認
    Expected Result: final-report.md が存在し、全必須セクションが含まれ、テスト/型チェックが PASS
    Failure Indicators: ファイルが存在しない、必須セクションが欠けている、FAIL が含まれる
    Evidence: .sisyphus/evidence/final-qa/f4-report-validation.txt
  ```

  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Report [GENERATED] | VERDICT`

---

## Commit Strategy

| # | Message | Files | Pre-commit Check |
|---|---------|-------|-----------------|
| 0 | — (branch creation のみ、コミットなし) | — | — |
| 1 | `feat(security): add rate limiter for upload endpoints` | `server/src/routes/upload-parser.ts` | `npm run test:server` |
| 2 | `feat(security): add rate limiter for CSV export endpoints` | `server/src/routes/admin-csv-export.ts` | `npm run test:server` |
| 3 | `feat(security): add rate limiter for proposal write endpoints` | `server/src/routes/exchange-proposals.ts` | `npm run test:server` |
| ~~4~~ | ~~SKIPPED~~ — normalizeSearchTerm() が既にトランケート済み | — | — |
| 5 | `fix(stability): add try-catch to migration script JSON.parse` | `server/src/db/migrate.ts` | `npm run test:server` |
| ~~6~~ | ~~SKIPPED~~ — cursor-pagination.ts は既に防御済み | — | — |
| 7 | `refactor(readability): extract shared response helpers` | `server/src/routes/response-helpers.ts` + 3 route files | `npm run test:server` |
| 8 | `refactor(readability): extract shared validation helpers` | `server/src/routes/validation-helpers.ts`(new) + `server/src/routes/account.ts` | `npm run test:server` |

---

## Success Criteria

### Verification Commands
```bash
npm run test                  # Expected: 4,104+ tests, 0 failures
npm run typecheck             # Expected: 0 errors
npm run lint                  # Expected: 0 errors
npm run test:perf:server      # Expected: PASS (no regressions)
npm run test:coverage         # Expected: ≥ 92.06% lines
```

### Final Checklist
- [ ] 全 "Must Have" が実装済み（revert されたタスクは PARTIAL として報告）
- [ ] 全 "Must NOT Have" が遵守済み
- [ ] 全テスト PASS
- [ ] 型エラー 0
- [ ] Lint エラー 0
- [ ] パフォーマンスリグレッションなし
- [ ] カバレッジ ≥ ベースライン
- [ ] 全コミットが独立 revert 可能
- [ ] 最終レポートが `.sisyphus/evidence/final-report.md` に生成済み
