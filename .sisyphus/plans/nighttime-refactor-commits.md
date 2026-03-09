# nighttime-refactor コミット整理 & PM ハンドオフ

## TL;DR

> **目的**: nighttime-refactor プランの未コミット変更 4 件をアトミックにコミットし、PM 向けマージ概要を生成する。
>
> **成果物**:
> - Task 1/5/7/8 の 4 アトミックコミット（各コミット独立で revert 可能）
> - account.ts の Task 7/8 間分割（フォールバック: 合体コミット）
> - PM 向けハンドオフサマリー（.sisyphus/evidence/handoff-summary.md）
>
> **見積もり規模**: Quick（4 コミット + 検証 + サマリー生成）
> **並列実行**: YES — 3 Wave
> **クリティカルパス**: Pre-flight → Commit 1 → Commit 5 → Commit 7 → Commit 8 → Verification + Handoff

---

## Context

### Original Request
nighttime-refactor プランの全実装タスクと Final Verification Wave は完了済み。未コミットの変更（Tasks 1, 5, 7, 8）をアトミックにコミットし、PM レビュー用のハンドオフサマリーを生成する。

### 前提状態
- **Worktree**: `/Users/yusuke/DeadStockSolution-nighttime-refactor`
- **Branch**: `refactor/nighttime-security-stability`
- **既存コミット**: Tasks 2, 3 は既にコミット済み（`75e3caa`, `244d759`, `6bc1353`）
- **全テスト PASS 確認済み**: typecheck, lint, test:server, test:client, test:perf:server
- **account.ts の分割課題**: Task 7（response helper extraction）と Task 8（validation helper extraction）が同一ファイルを変更

### Metis Review
**特定されたリスク**（対処済み）:
- account.ts Hunk 1 が Task 7/8 混在 → save/restore + ast-grep で分割、typecheck 失敗時は合体コミットにフォールバック
- `.sisyphus/` ファイルの誤コミットリスク → 特定ファイルのみ `git add`（`git add .` 禁止）
- 各コミット間で TypeScript コンパイルが通ることの保証 → 毎コミット後に typecheck 実行

---

## Work Objectives

### Core Objective
未コミット変更 4 件をプランの Commit Strategy に従いアトミックにコミットし、PM 向けハンドオフサマリーを生成する。

### Concrete Deliverables
- 4 git commits（or 3 if Tasks 7+8 合体フォールバック発動）
- `.sisyphus/evidence/handoff-summary.md`

### Definition of Done
- [ ] `git status -- server/` で未コミット変更が 0
- [ ] `git log --oneline -7` で全 7 コミットが正しい順序で表示
- [ ] `npm run typecheck` → exit 0
- [ ] `npm run test:server` → exit 0
- [ ] `.sisyphus/evidence/handoff-summary.md` が存在し、全セクション記載済み

### Must Have
- 各コミットが独立して revert 可能
- 各コミット後に typecheck PASS
- PM 向けサマリーに: 全コミット一覧、挙動変更なし声明、テスト証跡、マージ先指示

### Must NOT Have (Guardrails)
- `git add .` または `git add -A` の使用禁止（特定ファイルのみ staging）
- `.sisyphus/` ファイルのコミット禁止
- 既存コミット（75e3caa, 6bc1353, 244d759）の amend 禁止
- `git add -p` / `git add -i`（interactive）の使用禁止
- response-helpers.ts / validation-helpers.ts の内容変更禁止（既に正しい）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (tests-after — 各コミット後に test:server 実行)
- **Framework**: vitest

### QA Policy
各コミット後に `npm run typecheck` + `npm run test:server` をゲートとして実行。
最終コミット後に全テストスイート（`npm run test`）を実行。

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Pre-flight — 基盤確認):
└── Task 0: Pre-flight checks & insurance stash [quick]

Wave 2 (Sequential commits — all depend on previous):
├── Task 1: Commit upload-parser.ts (Plan Task 1) [quick]
├── Task 2: Commit migrate.ts (Plan Task 5) [quick]
├── Task 3: Commit response helpers — account.ts split (Plan Task 7) [deep]
└── Task 4: Commit validation helpers — remaining (Plan Task 8) [quick]

Wave 3 (Parallel — after all commits):
├── Task 5: Final verification [quick]
└── Task 6: Generate handoff summary [writing]

Critical Path: Task 0 → Task 1 → Task 2 → Task 3 → Task 4 → Task 5 + Task 6
Parallel Speedup: Wave 3 runs 2 tasks in parallel
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 0 | — | 1, 2, 3, 4 | 1 |
| 1 | 0 | 2 | 2 |
| 2 | 1 | 3 | 2 |
| 3 | 2 | 4 | 2 |
| 4 | 3 | 5, 6 | 2 |
| 5 | 4 | — | 3 |
| 6 | 4 | — | 3 |

### Agent Dispatch Summary

- **Wave 1**: 1 task — T0 → `quick`
- **Wave 2**: 4 tasks — T1 → `quick`, T2 → `quick`, T3 → `deep`, T4 → `quick`
- **Wave 3**: 2 tasks — T5 → `quick`, T6 → `writing`

---

## TODOs

- [ ] 0. Pre-flight checks & insurance stash

  **What to do**:
  - dev server (PID 78948, port 3001) が起動中なら kill する: `kill 78948 2>/dev/null || true`
  - worktree の状態を確認: `git status --short` で 5 modified + 2 untracked (server/ 以下のみ) を確認
  - insurance stash を作成:
    ```bash
    git stash push -m "insurance-backup-before-commit-split" --include-untracked
    git stash apply  # 即座に再適用 — stash は保険として残る
    ```
  - `.sisyphus/` が worktree の `.gitignore` に含まれているか確認。含まれていなければ、`.gitignore` に `.sisyphus/` を追加（ただしこの追加自体はコミット対象外 — あくまで誤 staging 防止）

  **Must NOT do**:
  - 既存コミットの amend
  - `.sisyphus/` ファイルの staging

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 1, 2, 3, 4
  - **Blocked By**: None

  **References**:
  - Worktree path: `/Users/yusuke/DeadStockSolution-nighttime-refactor`
  - Dev server PID: `78948` (may already be dead)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Pre-flight state is clean
    Tool: Bash
    Preconditions: Worktree exists at /Users/yusuke/DeadStockSolution-nighttime-refactor
    Steps:
      1. Run `git status --short` in worktree
      2. Count modified files (M prefix): expect exactly 5
      3. Count untracked files (?? prefix) under server/: expect exactly 2
      4. Run `git stash list` — verify insurance stash exists with message containing "insurance-backup"
      5. Run `lsof -i :3001 2>/dev/null | grep -c LISTEN || echo 0` — expect 0 (server killed)
    Expected Result: 5 modified, 2 untracked (server/), stash exists, port 3001 free
    Evidence: .sisyphus/evidence/task-0-preflight.txt
  ```

  **Commit**: NO

- [ ] 1. Commit upload-parser.ts (Plan Task 1)

  **What to do**:
  - Stage のみ `server/src/routes/upload-parser.ts`:
    ```bash
    git add server/src/routes/upload-parser.ts
    ```
  - Pre-commit check:
    ```bash
    npm run typecheck && npm run test:server
    ```
  - Commit:
    ```bash
    git commit -m "feat(security): add rate limiter for upload endpoints"
    ```

  **Must NOT do**:
  - 他のファイルの staging
  - `git add .` の使用

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]
    - `git-master`: atomic commit operations

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential with Tasks 2, 3, 4)
  - **Blocks**: Task 2
  - **Blocked By**: Task 0

  **References**:
  - `server/src/routes/upload-parser.ts` — uploadLimiter 定義 + 3 ルート（preview, confirm, confirm-async）へのミドルウェア追加
  - Original plan Task 1 commit strategy: `.sisyphus/plans/nighttime-refactor.md` line 1059

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Commit 1 is clean and tests pass
    Tool: Bash
    Preconditions: Task 0 completed, worktree clean except planned uncommitted files
    Steps:
      1. Run `git log -1 --format='%s'` → expect "feat(security): add rate limiter for upload endpoints"
      2. Run `git show --stat HEAD` → expect only "server/src/routes/upload-parser.ts" listed
      3. Run `grep -c 'uploadLimiter' server/src/routes/upload-parser.ts` → expect 4 (1 def + 3 uses)
      4. Run `npm run typecheck` → expect exit 0
      5. Run `npm run test:server` → expect exit 0, 0 failures
    Expected Result: Commit exists with correct message, only 1 file, typecheck + tests pass
    Evidence: .sisyphus/evidence/task-1-commit.txt
  ```

  **Commit**: YES
  - Message: `feat(security): add rate limiter for upload endpoints`
  - Files: `server/src/routes/upload-parser.ts`
  - Pre-commit: `npm run typecheck && npm run test:server`

- [ ] 2. Commit migrate.ts (Plan Task 5)

  **What to do**:
  - Stage のみ `server/src/db/migrate.ts`:
    ```bash
    git add server/src/db/migrate.ts
    ```
  - Pre-commit check:
    ```bash
    npm run typecheck && npm run test:server
    ```
  - Commit:
    ```bash
    git commit -m "fix(stability): add try-catch to migration script JSON.parse"
    ```

  **Must NOT do**:
  - 他のファイルの staging
  - `git add .` の使用

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]
    - `git-master`: atomic commit operations

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential with Tasks 1, 3, 4)
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References**:
  - `server/src/db/migrate.ts` — `assertMonotonicMigrationJournal()` 内の JSON.parse に try-catch + process.exit(1) 追加
  - Original plan Task 5 commit strategy: `.sisyphus/plans/nighttime-refactor.md` line 1063

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Commit 5 is clean and tests pass
    Tool: Bash
    Preconditions: Task 1 committed
    Steps:
      1. Run `git log -1 --format='%s'` → expect "fix(stability): add try-catch to migration script JSON.parse"
      2. Run `git show --stat HEAD` → expect only "server/src/db/migrate.ts" listed
      3. Run `grep -c 'try {' server/src/db/migrate.ts` → expect ≥ 1
      4. Run `grep -c 'process.exit(1)' server/src/db/migrate.ts` → expect ≥ 1
      5. Run `npm run typecheck` → expect exit 0
      6. Run `npm run test:server` → expect exit 0, 0 failures
    Expected Result: Commit exists with correct message, only 1 file, typecheck + tests pass
    Evidence: .sisyphus/evidence/task-2-commit.txt
  ```

  **Commit**: YES
  - Message: `fix(stability): add try-catch to migration script JSON.parse`
  - Files: `server/src/db/migrate.ts`
  - Pre-commit: `npm run typecheck && npm run test:server`

- [ ] 3. Commit response helpers — account.ts split (Plan Task 7)

  **What to do**:

  **この Task は account.ts の分割を伴う。以下の手順を正確に実行すること。**

  **Step A — バックアップ**:
  ```bash
  cp server/src/routes/account.ts /tmp/account-full.ts
  # バックアップ検証
  diff server/src/routes/account.ts /tmp/account-full.ts  # → 差分なし
  ```

  **Step B — account.ts を HEAD にリセット**:
  ```bash
  git checkout HEAD -- server/src/routes/account.ts
  ```

  **Step C — Task 7 の変更のみを適用**:
  1. `import { emailSchema } from '../utils/validators';` の直後に **Task 7 の import のみ**を追加:
     ```typescript
     import { sendBadRequest, sendConflict } from './response-helpers';
     ```
     ※ `validation-helpers` の import は **追加しない**
  2. ast-grep で call-site 置換を実行（account.ts のみ対象）:
     ```
     pattern:  res.status(400).json({ error: $MSG })
     rewrite:  sendBadRequest(res, $MSG)
     lang:     typescript
     paths:    [server/src/routes/account.ts]
     ```
     ```
     pattern:  res.status(409).json({ error: $MSG })
     rewrite:  sendConflict(res, $MSG)
     lang:     typescript
     paths:    [server/src/routes/account.ts]
     ```

  **Step D — 置換カウント検証**:
  ```bash
  grep -c 'sendBadRequest' server/src/routes/account.ts  # → 23 (1 import + 22 uses)
  grep -c 'sendConflict' server/src/routes/account.ts    # → 3 (1 import + 2 uses)
  # parseVersion と parseOptionalTrimmedString がローカル関数として残っていること
  grep -c 'function parseVersion' server/src/routes/account.ts           # → 1
  grep -c 'function parseOptionalTrimmedString' server/src/routes/account.ts  # → 1
  ```

  **Step E — Typecheck ゲート**:
  ```bash
  npm run typecheck
  ```
  - **PASS の場合**: Step F に進む
  - **FAIL の場合**: → **フォールバック発動** — Task 4 と合体コミット:
    ```bash
    git checkout HEAD -- server/src/routes/account.ts   # リセット
    cp /tmp/account-full.ts server/src/routes/account.ts  # フルバージョン復元
    # Task 3 + Task 4 を合体コミットとして実行（Task 4 をスキップ）
    git add server/src/routes/response-helpers.ts \
            server/src/routes/validation-helpers.ts \
            server/src/routes/account.ts \
            server/src/routes/inventory.ts \
            server/src/routes/business-hours.ts
    npm run typecheck && npm run test:server
    git commit -m "refactor(readability): extract shared response & validation helpers"
    # → Task 4 はスキップ、Task 5 に進む
    ```

  **Step F — Stage & Commit (split 成功時)**:
  ```bash
  git add server/src/routes/response-helpers.ts \
          server/src/routes/account.ts \
          server/src/routes/inventory.ts \
          server/src/routes/business-hours.ts
  npm run test:server
  git commit -m "refactor(readability): extract shared response helpers"
  ```

  **Step G — フルバージョン復元**:
  ```bash
  cp /tmp/account-full.ts server/src/routes/account.ts
  # 復元検証: 残りの diff が Task 8 分のみであること
  git diff -- server/src/routes/account.ts | head -30
  # → parseVersion/parseOptionalTrimmedString の import 追加 + ローカル関数削除のみ
  ```

  **Must NOT do**:
  - `git add .` の使用
  - `git add -p` / `git add -i` の使用
  - response-helpers.ts の内容変更
  - parseVersion / parseOptionalTrimmedString のローカル関数を削除（それは Task 4）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: account.ts の分割は backup/restore/ast-grep/typecheck ゲート/フォールバック判定を含む複雑な手順
  - **Skills**: [`git-master`]
    - `git-master`: partial staging and commit operations

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential)
  - **Blocks**: Task 4
  - **Blocked By**: Task 2

  **References**:
  - `server/src/routes/account.ts` — 19 hunks の diff (Hunk 1: mixed imports, Hunk 2: Task 8 function removal, Hunks 3-19: Task 7 call-site replacements)
  - `server/src/routes/response-helpers.ts` — sendBadRequest(res, message) / sendConflict(res, message) を export する新ファイル
  - `server/src/routes/inventory.ts` — sendBadRequest import 追加 + 6 箇所の call-site 置換済み
  - `server/src/routes/business-hours.ts` — sendBadRequest import 追加 + 4 箇所の call-site 置換済み
  - Original plan Task 7 commit strategy: `.sisyphus/plans/nighttime-refactor.md` line 1065

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Commit 7 is clean, account.ts split successful, and tests pass
    Tool: Bash
    Preconditions: Task 2 committed, account.ts backed up to /tmp/account-full.ts
    Steps:
      1. Run `git log -1 --format='%s'` → expect "refactor(readability): extract shared response helpers"
      2. Run `git show --stat HEAD` → expect 4 files: response-helpers.ts, account.ts, inventory.ts, business-hours.ts
      3. Run `grep -c 'sendBadRequest' server/src/routes/account.ts` → expect 23 (1 import + 22 uses)
      4. Run `grep -c 'sendConflict' server/src/routes/account.ts` → expect 3 (1 import + 2 uses)
      5. Run `grep -c 'function parseVersion' server/src/routes/account.ts` → expect 1 (still local)
      6. Run `grep -c 'function parseOptionalTrimmedString' server/src/routes/account.ts` → expect 1 (still local)
      7. Run `npm run typecheck` → expect exit 0
      8. Run `npm run test:server` → expect exit 0
    Expected Result: 4 files committed, call-site counts match, local functions preserved, all checks pass
    Failure Indicators: typecheck fails → fallback to combined commit (see Step E)
    Evidence: .sisyphus/evidence/task-3-commit.txt

  Scenario: Fallback — combined commit (if split fails)
    Tool: Bash
    Preconditions: typecheck failed after Step D
    Steps:
      1. Restore account.ts from backup
      2. Stage all Task 7 + Task 8 files together
      3. Run `npm run typecheck && npm run test:server` → expect exit 0
      4. Commit with message "refactor(readability): extract shared response & validation helpers"
      5. Run `git show --stat HEAD` → expect 5 files: response-helpers.ts, validation-helpers.ts, account.ts, inventory.ts, business-hours.ts
    Expected Result: Combined commit succeeds, Task 4 is SKIPPED
    Evidence: .sisyphus/evidence/task-3-fallback.txt
  ```

  **Commit**: YES
  - Message: `refactor(readability): extract shared response helpers`
  - Files: `server/src/routes/response-helpers.ts`, `server/src/routes/account.ts`, `server/src/routes/inventory.ts`, `server/src/routes/business-hours.ts`
  - Pre-commit: `npm run typecheck && npm run test:server`

- [ ] 4. Commit validation helpers — remaining account.ts (Plan Task 8)

  **⚠️ この Task は Task 3 でフォールバック（合体コミット）が発動した場合はスキップする。**

  **What to do**:
  - Task 3 の Step G で account.ts がフルバージョンに復元されている前提
  - `git diff -- server/src/routes/account.ts` で残りの差分が Task 8 分のみ（import 追加 + ローカル関数削除）であることを確認
  - Stage:
    ```bash
    git add server/src/routes/validation-helpers.ts \
            server/src/routes/account.ts
    ```
  - Pre-commit check:
    ```bash
    npm run typecheck && npm run test:server
    ```
  - Commit:
    ```bash
    git commit -m "refactor(readability): extract shared validation helpers"
    ```

  **Must NOT do**:
  - 他のファイルの staging
  - `git add .` の使用
  - validation-helpers.ts の内容変更

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]
    - `git-master`: atomic commit operations

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential)
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: Task 3

  **References**:
  - `server/src/routes/validation-helpers.ts` — parseVersion() / parseOptionalTrimmedString() を export する新ファイル
  - `server/src/routes/account.ts` — validation-helpers import 追加 + ローカル関数 2 つの削除
  - Original plan Task 8 commit strategy: `.sisyphus/plans/nighttime-refactor.md` line 1066

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Commit 8 is clean and tests pass
    Tool: Bash
    Preconditions: Task 3 completed (split path), account.ts restored to full version
    Steps:
      1. Run `git log -1 --format='%s'` → expect "refactor(readability): extract shared validation helpers"
      2. Run `git show --stat HEAD` → expect 2 files: validation-helpers.ts, account.ts
      3. Run `grep -c 'function parseVersion' server/src/routes/account.ts` → expect 0 (removed, now imported)
      4. Run `grep -c 'function parseOptionalTrimmedString' server/src/routes/account.ts` → expect 0 (removed, now imported)
      5. Run `grep "from './validation-helpers'" server/src/routes/account.ts` → expect 1 match
      6. Run `npm run typecheck` → expect exit 0
      7. Run `npm run test:server` → expect exit 0
    Expected Result: 2 files committed, local functions removed, import present, all checks pass
    Evidence: .sisyphus/evidence/task-4-commit.txt
  ```

  **Commit**: YES
  - Message: `refactor(readability): extract shared validation helpers`
  - Files: `server/src/routes/validation-helpers.ts`, `server/src/routes/account.ts`
  - Pre-commit: `npm run typecheck && npm run test:server`

- [ ] 5. Final verification

  **What to do**:
  - server/ 以下に未コミット変更がないことを確認:
    ```bash
    git status -- server/
    ```
  - 全 7 コミットが正しい順序で存在することを確認:
    ```bash
    git log --oneline -7
    ```
  - 全テストスイート実行:
    ```bash
    npm run typecheck && npm run test && npm run lint
    ```
  - insurance stash を削除（不要になったため）:
    ```bash
    git stash drop  # insurance stash を削除
    ```

  **Must NOT do**:
  - ファイルの変更
  - 追加コミット

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 6)
  - **Blocks**: —
  - **Blocked By**: Task 4 (or Task 3 if fallback)

  **References**:
  - Plan success criteria: `.sisyphus/plans/nighttime-refactor.md` lines 1070-1090

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All commits present and all checks pass
    Tool: Bash
    Preconditions: All commits completed
    Steps:
      1. Run `git status -- server/` → expect clean (no uncommitted changes)
      2. Run `git log --oneline -7` → expect 7 commits including:
         - feat(security): add rate limiter for upload endpoints
         - fix(stability): add try-catch to migration script JSON.parse
         - refactor(readability): extract shared response helpers (or combined)
         - refactor(readability): extract shared validation helpers (or absent if fallback)
         - Plus 3 existing commits (Tasks 2, 3)
      3. Run `npm run typecheck` → exit 0
      4. Run `npm run test` → exit 0 (4596+ tests)
      5. Run `npm run lint` → exit 0
      6. Run `git stash list` → insurance stash removed
    Expected Result: Clean worktree, all commits present, full test suite passes
    Evidence: .sisyphus/evidence/task-5-verification.txt
  ```

  **Commit**: NO

- [ ] 6. Generate handoff summary for PM

  **What to do**:
  `.sisyphus/evidence/handoff-summary.md` を以下の構成で生成:

  ```markdown
  # nighttime-refactor ハンドオフサマリー

  ## 挙動変更
  **挙動変更なし。** 全変更は構造的改善（レートリミッター追加、エラーハンドリング強化、ヘルパー抽出）。

  ## 全コミット一覧
  | Hash | Message |
  |------|---------|
  | (hash) | feat(security): add rate limiter for proposal write endpoints |
  | (hash) | fix(security): use ipKeyGenerator for IPv6-safe rate limiter key |
  | (hash) | feat(security): add rate limiter for CSV export endpoints |
  | (hash) | feat(security): add rate limiter for upload endpoints |
  | (hash) | fix(stability): add try-catch to migration script JSON.parse |
  | (hash) | refactor(readability): extract shared response helpers |
  | (hash) | refactor(readability): extract shared validation helpers |

  ## テスト証跡
  - typecheck: PASS
  - test:server: PASS (4101+ tests)
  - test:client: PASS (495 tests)
  - lint: PASS
  - test:perf:server: PASS

  ## diff-stat
  (git diff --stat main..HEAD の出力)

  ## マージ先
  - Source: `refactor/nighttime-security-stability`
  - Target: `preview` (推奨 — PM 判断)
  - Merge strategy: 通常マージ（squash 不要 — 各コミットが独立 revert 可能）

  ## PM 向け注意事項
  - 新レートリミッター（Tasks 1-3）は本番環境で window/max 値の調整が必要になる可能性あり
  - migrate.ts の try-catch（Task 5）は failure mode を crash → logged-exit に変更 — ops 確認推奨
  - test:coverage は計画前からベースライン未達（91.42% < 95%）— 本計画起因ではない
  ```

  - 実際の commit hash は `git log --oneline -7` から取得すること
  - diff-stat は `git diff --stat main..HEAD` から取得すること

  **Must NOT do**:
  - コミットの追加
  - ファイル内容の変更（サマリー生成のみ）

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: ドキュメント生成タスク
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 5)
  - **Blocks**: —
  - **Blocked By**: Task 4 (or Task 3 if fallback)

  **References**:
  - Plan file: `.sisyphus/plans/nighttime-refactor.md` — 全体コンテキスト
  - Final report: `.sisyphus/evidence/final-report.md` — テスト証跡とレビュー結果
  - Existing commits: `git log --oneline -7` で取得

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Handoff summary is complete and accurate
    Tool: Bash
    Preconditions: All commits completed
    Steps:
      1. Read `.sisyphus/evidence/handoff-summary.md`
      2. Verify sections exist: 挙動変更, 全コミット一覧, テスト証跡, diff-stat, マージ先, PM 向け注意事項
      3. Verify commit hashes match `git log --oneline -7` output
      4. Verify diff-stat matches `git diff --stat main..HEAD` output
      5. Verify 「挙動変更なし」statement is present
    Expected Result: All sections present, data matches git state
    Evidence: .sisyphus/evidence/task-6-handoff.txt
  ```

  **Commit**: NO

---

## Commit Strategy

| # | Message | Files | Pre-commit Check |
|---|---------|-------|-----------------|
| 1 | `feat(security): add rate limiter for upload endpoints` | `server/src/routes/upload-parser.ts` | `npm run typecheck && npm run test:server` |
| 5 | `fix(stability): add try-catch to migration script JSON.parse` | `server/src/db/migrate.ts` | `npm run typecheck && npm run test:server` |
| 7 | `refactor(readability): extract shared response helpers` | `server/src/routes/response-helpers.ts` (new) + `account.ts` + `inventory.ts` + `business-hours.ts` | `npm run typecheck && npm run test:server` |
| 8 | `refactor(readability): extract shared validation helpers` | `server/src/routes/validation-helpers.ts` (new) + `account.ts` | `npm run typecheck && npm run test:server` |
| 7+8 (fallback) | `refactor(readability): extract shared response & validation helpers` | 上記 Task 7 + Task 8 の全ファイル | `npm run typecheck && npm run test:server` |

---

## Success Criteria

### Verification Commands
```bash
git status -- server/          # Expected: no uncommitted changes
git log --oneline -7           # Expected: 7 commits in correct order
npm run typecheck              # Expected: 0 errors
npm run test:server            # Expected: 4101+ tests, 0 failures
```

### Final Checklist
- [ ] 全コミットが独立 revert 可能
- [ ] 各コミット後に typecheck PASS
- [ ] 全テスト PASS
- [ ] `.sisyphus/evidence/handoff-summary.md` が生成済み
- [ ] `.sisyphus/` ファイルがコミットされていない
