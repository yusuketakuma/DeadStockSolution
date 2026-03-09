# マッチングアルゴリズム改善 (Matching Algorithm Improvement)

## TL;DR

> **Quick Summary**: マッチング精度の向上と運用柔軟性の確保のため、ブランド/ジェネリック同等性考慮、期限スコアの指数減衰化、過去の成功率ボーナス、およびマッチングルールの動的調整機能を実装する。

> **Deliverables**:
> - 薬品同等性マスター (`drugEquivalences` テーブル + 管理UI)
> - 指数減衰・成功率ボーナス・動的候補数制限を含む改善版マッチングロジック
> - 管理者向けマッチングルール設定UI (`AdminMatchingRulesPage`)
> - 拡張された `matchingRuleProfiles` スキーマ

> **Estimated Effort**: Medium-Large
> - **Parallel Execution**: YES - 3 waves + FINAL
> - **Critical Path**: Task 1 → Task 2 → Task 5 → Task 8 → Task 10 → F1-F4

---

## Context

### Original Request
マッチングアルゴリズムの精度を向上させ、管理者がスコアリングパラメータを調整できるようにする。特に「薬品名の同等性（先発/後発）」や「期限が迫った在庫の優先度」を強化したい。

### Current State
- **Scoring**: 線形計算が中心。最大125点。
- **Drug Matching**: Jaccard + Levenshtein による文字列類似度のみ。成分や同等性の考慮なし。
- **Rules**: `matchingRuleProfiles` テーブルに定義されているが、UIからの編集手段がない。
- **Candidates**: `MAX_CANDIDATES` が 30 にハードコードされている。

### Research Findings
- `matching-score-service.ts` がスコアリングのコアロジックを保持。
- `matchingRuleProfiles` には既に14個のパラメータがあるが、今回の改善で4つの新パラメータが必要。
- 過去の交換実績は `exchangeHistory` (または関連テーブル) から集計可能。

---

## Work Objectives

### Core Objective
マッチングアルゴリズムを高度化し、在庫解消効率を最大化するとともに、市場環境や運用方針に合わせたパラメータ調整を可能にする。

### Concrete Deliverables
- **DB**: `drugEquivalences` テーブル、`matchingRuleProfiles` へのカラム追加 (`nearExpiryDecayCurve`, `successRateBonus`, `maxCandidates`)
- **Backend**: 指数減衰ロジック、成功率ボーナス計算、同等性考慮の名称マッチング、動的候補数制限
- **Frontend**: マッチングルール編集画面、薬品同等性管理画面

### Definition of Done
- [ ] `npm run typecheck` — PASS (0 errors)
- [ ] `npm run test` — PASS (全テスト通過、カバレッジ維持)
- [ ] `npm run build:client && npm run build:server` — PASS
- [ ] 管理画面からスコアリングパラメータを変更し、マッチング結果（スコア）に反映されることを確認
- [ ] 同等性マスターに登録した薬品ペアが、文字列類似度が低くてもマッチング候補に現れることを確認
- [ ] 期限30日以内の在庫が、以前の線形スコアよりも高い優先度で表示されることを確認

### Must Have
- ブランド/ジェネリック同等性テーブル (`drugEquivalences`) とその管理機能
- 期限スコアの指数減衰化 (`nearExpiryDecayCurve` パラメータ)
- 交換成功率ボーナス (`successRateBonus` パラメータ)
- マッチング候補数の動的調整 (`maxCandidates` パラメータ)
- 管理者向けマッチングルール編集UI

### Must NOT Have (Guardrails)
- ❌ 外部API（Google Maps等）の呼び出し
- ❌ ML/AIモデルの導入
- ❌ リアルタイムマッチングへの変更（非同期バッチを維持）
- ❌ 既存スコアリングパラメータのデフォルト値変更（後方互換性維持）
- ❌ `as any` / `@ts-ignore` / 空のcatchブロック

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: TDD (RED-GREEN-REFACTOR)
- **Framework**: Vitest 4 + Supertest (server), Vitest 4 + @testing-library/react (client)
- **Each task**: テスト先行。failing test → minimal implementation → refactor

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright — Navigate, interact, assert DOM, screenshot
- **API/Backend**: Use Bash (curl) — Send requests, assert status + response fields

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — schema + types, parallel):
├── Task 1:  DB schema: drugEquivalences table [quick]
├── Task 2:  DB schema: matchingRuleProfiles extension [quick]
└── Task 3:  Shared types: DrugEquivalence & Updated MatchingRules [quick]

Wave 2 (Backend — core logic, MAX PARALLEL):
├── Task 4:  DrugEquivalenceService: CRUD logic [unspecified-high]
├── Task 5:  MatchingScoreService: Exponential decay for expiry [deep]
├── Task 6:  MatchingScoreService: Exchange success rate bonus [deep]
├── Task 7:  MatchingScoreService: Brand/Generic equivalence matching [deep]
├── Task 8:  MatchingCandidateBuilder: Dynamic maxCandidates support [unspecified-high]
└── Task 9:  Admin API: Routes for rules and equivalences [unspecified-high]

Wave 3 (Frontend — Admin UI, MAX PARALLEL):
├── Task 10: AdminMatchingRulesPage: Scoring parameter editor [visual-engineering]
├── Task 11: AdminDrugEquivalencesPage: Master data management [visual-engineering]
└── Task 12: Admin Navigation & Route registration [quick]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | — | 4, 7, 11 |
| 2 | — | 5, 6, 8, 10 |
| 3 | 1, 2 | 4, 5, 6, 7, 8, 9, 10, 11 |
| 4 | 1, 3 | 9, 11 |
| 5 | 2, 3 | 9, 10 |
| 6 | 2, 3 | 9, 10 |
| 7 | 1, 3 | 9 |
| 8 | 2, 3 | 9, 10 |
| 9 | 4, 5, 6, 7, 8 | 10, 11 |
| 10 | 9, 2, 3 | F1-F4 |
| 11 | 9, 1, 3 | F1-F4 |
| 12 | 10, 11 | F1-F4 |

---

## TODOs

### Wave 1: Foundation

#### Task 1: DB schema: drugEquivalences table
- **What to do**: `server/src/db/schema.ts` に `drugEquivalences` テーブルを追加。カラム: `id`, `drugNameA`, `drugNameB`, `equivalenceType` (enum: 'brand_generic', 'generic_generic'), `notes`, `createdAt`, `updatedAt`。
- **Must NOT do**: 既存のテーブル定義の変更。
- **Recommended Agent Profile**: `implementer`
- **Parallelization**: Possible
- **References**: `server/src/db/schema.ts`
- **Acceptance Criteria**:
    - Drizzle migration が生成可能であること。
    - `npm run db:generate` が成功すること。
- **QA Scenarios**:
    - `npx drizzle-kit check` でスキーマの整合性を確認。
- **Commit message**: `db: add drugEquivalences table schema`

#### Task 2: DB schema: matchingRuleProfiles extension
- **What to do**: `server/src/db/schema.ts` の `matchingRuleProfiles` テーブルに `nearExpiryDecayCurve` (double), `successRateBonus` (integer), `maxCandidates` (integer) カラムを追加。
- **Must NOT do**: 既存カラムの削除やリネーム。
- **Recommended Agent Profile**: `implementer`
- **Parallelization**: Possible
- **References**: `server/src/db/schema.ts`
- **Acceptance Criteria**:
    - カラム追加後のスキーマで migration が生成可能であること。
- **QA Scenarios**:
    - `npx drizzle-kit check` でスキーマの整合性を確認。
- **Commit message**: `db: extend matchingRuleProfiles with new parameters`

#### Task 3: Shared types: DrugEquivalence & Updated MatchingRules
- **What to do**: フロントエンドとバックエンドで共有される型定義を更新。`drugEquivalences` のインターフェースと、更新された `MatchingScoringRules` の型を追加。
- **Must NOT do**: 既存の型定義の破壊的変更。
- **Recommended Agent Profile**: `implementer`
- **Parallelization**: Possible
- **References**: `server/src/types/`, `client/src/types/` (プロジェクトの型定義場所を確認)
- **Acceptance Criteria**:
    - `npm run typecheck` が通過すること。
- **QA Scenarios**:
    - 型定義を参照するダミーファイルを作成し、コンパイルエラーが出ないことを確認。
- **Commit message**: `types: add drug equivalence and update matching rule types`

### Wave 2: Backend Services

#### Task 4: DrugEquivalenceService: CRUD logic
- **What to do**: `server/src/services/drug-equivalence-service.ts` を新規作成し、同等性データのCRUDロジックを実装。
- **Must NOT do**: バリデーションなしの保存。
- **Recommended Agent Profile**: `implementer`
- **Parallelization**: Possible
- **References**: `server/src/db/schema.ts`
- **Acceptance Criteria**:
    - 登録、取得、更新、削除の各メソッドが正しく動作すること。
    - 重複登録（A-B と B-A）を防止するロジックが含まれていること。
- **QA Scenarios**:
    - ユニットテストで各CRUD操作を検証。
- **Commit message**: `feat: implement DrugEquivalenceService for master data management`

#### Task 5: MatchingScoreService: Exponential decay for expiry
- **What to do**: `server/src/services/matching-score-service.ts` の `calculateNearExpiryScore` (または相当) を修正。`nearExpiryDecayCurve` パラメータを使用し、期限が近いほどスコアが急激に上がる指数減衰ロジックを実装。
- **Must NOT do**: 従来の線形計算ロジックの完全な削除（パラメータが0の場合は線形に戻るなどの配慮）。
- **Recommended Agent Profile**: `implementer`
- **Parallelization**: Possible
- **References**: `server/src/services/matching-score-service.ts`
- **Acceptance Criteria**:
    - 期限30日以内の在庫のスコアが、設定されたカーブに従って正しく計算されること。
- **QA Scenarios**:
    - 異なる期限日と `nearExpiryDecayCurve` 値を用いたユニットテスト。
- **Commit message**: `feat: implement exponential decay for near expiry score`

#### Task 6: MatchingScoreService: Exchange success rate bonus
- **What to do**: `server/src/services/matching-score-service.ts` に過去の交換成功率に基づくボーナス加算ロジックを追加。`exchangeHistory` テーブルから薬局ペアの成功実績を取得し、`successRateBonus` を上限として加点。
- **Must NOT do**: マッチング計算ごとの重いDBクエリ（必要に応じてキャッシュや事前集計を検討）。
- **Recommended Agent Profile**: `implementer`
- **Parallelization**: Possible
- **References**: `server/src/services/matching-score-service.ts`
- **Acceptance Criteria**:
    - 過去に成功実績があるペアに対して、正しくボーナスが加算されること。
- **QA Scenarios**:
    - 成功実績がある場合とない場合でのスコア比較テスト。
- **Commit message**: `feat: add exchange success rate bonus to matching score`

#### Task 7: MatchingScoreService: Brand/Generic equivalence matching
- **What to do**: `server/src/services/matching-score-service.ts` の名称マッチングロジックを拡張。`drugEquivalences` テーブルを参照し、登録されたペアであれば名称が異なっても高い類似度スコアを付与する。
- **Must NOT do**: 全薬品ペアに対する総当たりチェック（同等性テーブルのインデックスを活用）。
- **Recommended Agent Profile**: `implementer`
- **Parallelization**: Possible
- **References**: `server/src/services/matching-score-service.ts`, `Task 4`
- **Acceptance Criteria**:
    - 「アスピリン」と「バイアスピリン」が同等として登録されている場合、これらがマッチング候補として高いスコアを得ること。
- **QA Scenarios**:
    - 同等性登録がある場合とない場合での名称マッチングスコアの検証。
- **Commit message**: `feat: integrate brand/generic equivalence into name matching`

#### Task 8: MatchingCandidateBuilder: Dynamic maxCandidates support
- **What to do**: `server/src/services/matching/matching-candidate-builder.ts` を修正し、ハードコードされている `MAX_CANDIDATES` を `matchingRuleProfiles` の `maxCandidates` から取得するように変更。
- **Must NOT do**: `maxCandidates` が未設定または不正な値（0以下など）の場合のフォールバック欠如。
- **Recommended Agent Profile**: `implementer`
- **Parallelization**: Possible
- **References**: `server/src/services/matching/matching-candidate-builder.ts`
- **Acceptance Criteria**:
    - 設定された `maxCandidates` の数だけ候補が生成されること。
- **QA Scenarios**:
    - `maxCandidates` を 10 や 50 に変更して、返される候補数が変わることを確認。
- **Commit message**: `feat: support dynamic maxCandidates from matching rules`

#### Task 9: Admin API: Routes for rules and equivalences
- **What to do**: `server/src/routes/admin-matching-rules.ts` (既存) を拡張し、スコアリングパラメータの更新APIを実装。また、`server/src/routes/admin-drug-equivalences.ts` を新規作成し、同等性マスターのCRUD APIを実装。
- **Must NOT do**: 管理者権限チェックの欠如。
- **Recommended Agent Profile**: `implementer`
- **Parallelization**: Possible
- **References**: `server/src/app.ts`, `server/src/routes/`
- **Acceptance Criteria**:
    - 各APIエンドポイントが正しく動作し、適切なステータスコードを返すこと。
- **QA Scenarios**:
    - `curl` または `supertest` によるAPIテスト。
- **Commit message**: `feat: add admin API routes for matching rules and drug equivalences`

### Wave 3: Frontend Admin UI

#### Task 10: AdminMatchingRulesPage: Scoring parameter editor
- **What to do**: `client/src/pages/admin/AdminMatchingRulesPage.tsx` を作成（または既存を拡張）。`matchingRuleProfiles` の全パラメータ（新設分含む）を編集・保存できるフォームを実装。
- **Must NOT do**: 入力バリデーション（数値範囲など）の欠如。
- **Recommended Agent Profile**: `visual-engineering`
- **Parallelization**: Possible
- **References**: `client/src/api/client.ts`, `Task 9`
- **Acceptance Criteria**:
    - パラメータを変更して保存でき、成功メッセージが表示されること。
- **QA Scenarios**:
    - Playwright によるフォーム入力と保存の自動テスト。
- **Commit message**: `feat: implement AdminMatchingRulesPage for scoring parameter management`

#### Task 11: AdminDrugEquivalencesPage: Master data management
- **What to do**: `client/src/pages/admin/AdminDrugEquivalencesPage.tsx` を作成。同等性マスターの一覧表示、新規登録、編集、削除ができるUIを実装。
- **Must NOT do**: 大量データ時のページネーション欠如。
- **Recommended Agent Profile**: `visual-engineering`
- **Parallelization**: Possible
- **References**: `client/src/api/client.ts`, `Task 9`
- **Acceptance Criteria**:
    - 同等性ペアを一覧で確認でき、追加・削除操作が反映されること。
- **QA Scenarios**:
    - Playwright によるCRUD操作の自動テスト。
- **Commit message**: `feat: implement AdminDrugEquivalencesPage for master data management`

#### Task 12: Admin Navigation & Route registration
- **What to do**: `client/src/routes/route-config.tsx` に新しい管理画面のルートを追加し、サイドバー等のナビゲーションにリンクを追加。
- **Must NOT do**: `adminOnly: true` フラグの付け忘れ。
- **Recommended Agent Profile**: `implementer`
- **Parallelization**: Sequential after Task 10, 11
- **References**: `client/src/routes/route-config.tsx`
- **Acceptance Criteria**:
    - 管理者ユーザーでログイン時、メニューから新しいページに遷移できること。
- **QA Scenarios**:
    - 画面遷移の確認。
- **Commit message**: `feat: register admin routes and navigation for matching improvements`

### Wave FINAL: Review & Audit

#### Task F1: Plan compliance audit (oracle)
- **What to do**: 実装が計画（Must Have / Must NOT Have）に完全に準拠しているか、Oracleエージェントによる監査を実施。
- **Recommended Agent Profile**: `oracle`

#### Task F2: Code quality review
- **What to do**: `as any` の使用、テストカバレッジ、エラーハンドリング、パフォーマンス上の懸念がないかコードレビューを実施。
- **Recommended Agent Profile**: `claude_reviewer`

#### Task F3: Real manual QA
- **What to do**: 実際にマッチングジョブを実行し、スコア計算や候補抽出が期待通りに行われるかエンドツーエンドで確認。
- **Recommended Agent Profile**: `implementer`

#### Task F4: Scope fidelity check
- **What to do**: ユーザーの当初の要望（ブランド/ジェネリック同等性、期限スコア改善等）が全て満たされているか最終確認。
- **Recommended Agent Profile**: `claude_reviewer`
