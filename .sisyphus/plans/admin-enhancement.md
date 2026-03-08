# 管理者機能強化 (Admin Feature Enhancement)

## TL;DR

> **Quick Summary**: 管理者向けの運用効率と透明性を向上させるため、薬局の一括承認/拒否、CSVエクスポート（薬局・交換・レポート）、操作履歴の監査ログ、承認待ち専用キュー、およびマッチングルール管理UIを実装する。

> **Deliverables**:
> - **一括操作**: 薬局一覧での複数選択と一括承認/拒否（通知連携・トランザクション保証）
> - **CSVエクスポート**: 薬局一覧、交換履歴、月次レポートのストリーミングダウンロード
> - **監査ログ**: 薬局ステータス変更の履歴記録（`adminAuditLogs`テーブル）と詳細画面での表示
> - **承認待ちキュー**: `AdminPharmaciesPage`への「承認待ち」専用タブ追加
> - **マッチングルールUI**: `AdminMatchingRulesPage`新設によるスコアリングルールの動的編集

> **Estimated Effort**: Medium-Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 → Task 3 → Task 8 → Task 12 → F1-F4

---

## Context

### Current Admin State
現在、管理画面には11のページが存在し、基本的な監視と個別操作は可能だが、運用規模の拡大に伴い以下の課題が顕在化している。
- **効率性**: 多数の新規登録薬局を1件ずつ承認するのが手間（一括操作の欠如）
- **データ活用**: 外部分析や報告用にデータを抽出する手段がない（CSVエクスポートの欠如）
- **透明性**: 「誰がいつ、なぜ承認/拒否したか」の履歴が追えない（監査ログの欠如）
- **メンテナンス性**: マッチングルールの調整にDB直接操作やコード変更が必要（管理UIの欠如）

### Improvement Scope (v1)
本計画では、運用負荷を直接軽減し、ガバナンスを強化する5つのコア機能を実装する。

**Must Have**:
1. **薬局一括承認/拒否**: `AdminPharmaciesPage`にチェックボックス選択と一括アクションボタンを追加。
2. **CSVエクスポート**: 薬局、交換、レポートの3種。大量データに対応するためストリーミングレスポンスを採用。
3. **監査ログ**: 薬局ステータス変更（verify/reject/re-review）を`adminAuditLogs`に記録し、編集画面で表示。
4. **承認待ちキュー**: `pending`ステータスの薬局を優先的に処理できる専用ビュー。
5. **マッチングルール管理UI**: `AdminMatchingRulesPage`でスコアリングパラメータをスライダーや数値入力で調整可能にする。

**Must NOT Have**:
- ❌ リアルタイム通知（WebSocket/SSE）— ポーリングのみ
- ❌ 管理者間メッセージング/タスク割り当て
- ❌ 薬局活動ヒートマップ
- ❌ Excelエクスポート（CSVのみ）
- ❌ `as any` / `@ts-ignore` / 空のcatchブロック
- ❌ 一括操作での部分失敗の無視（全件成功 or ロールバック）

---

## Work Objectives

### Core Objective
管理者の運用コストを削減し、システムの透明性とデータポータビリティを向上させる機能を、既存のExpress/Drizzle/Reactアーキテクチャに統合して実装する。

### Concrete Deliverables
- **DB**: `adminAuditLogs` テーブル（adminId, targetPharmacyId, action, previousStatus, newStatus, reason, createdAt）
- **Backend API**:
  - `POST /api/admin/pharmacies/bulk-verify`, `POST /api/admin/pharmacies/bulk-reject`
  - `GET /api/admin/pharmacies/export`, `GET /api/admin/exchanges/export`, `GET /api/admin/reports/export`
  - `GET /api/admin/pharmacies/:id/audit-logs`
- **Frontend Pages**:
  - `AdminMatchingRulesPage.tsx` (新規)
  - `AdminPharmaciesPage.tsx` (拡張: 一括操作、承認待ちタブ)
  - `AdminPharmacyEditPage.tsx` (拡張: 監査ログ表示)

### Definition of Done
- [x] `npm run typecheck` — PASS ✅ (2026-03-08)
- [x] `npm run test` — PASS ✅ (4024 server + 484 client = 4508 tests)
- [x] `npm run build:client && npm run build:server` — PASS ✅
- [x] 薬局の一括承認が正常に動作し、各薬局に通知が送信されること ✅
- [x] CSVエクスポートが日本語文字化けなく、ストリーミングでダウンロードできること ✅
- [x] 監査ログが改ざん不能な形で記録され、UIに表示されること ✅
- [x] マッチングルールの変更が即座にマッチングエンジンに反映されること ✅

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (Vitest 4 + Supertest + @testing-library/react)
- **Automated tests**: TDD (RED-GREEN-REFACTOR)
- **Each task**: テスト先行。failing test → minimal implementation → refactor

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright — Navigate, interact, assert DOM, screenshot
- **API/Backend**: Use Bash (curl) — Send requests, assert status + response fields
- **CSV**: Use Bash — Download and verify content (grep/wc)

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — DB + Types):
├── Task 1:  DB schema: adminAuditLogs table [quick]
└── Task 2:  Shared types: Bulk ops & Audit log interfaces [quick]

Wave 2 (Backend — Services & Routes):
├── Task 3:  Audit log service (record/fetch) [unspecified-high]
├── Task 4:  Bulk pharmacy operations service & routes [deep]
├── Task 5:  CSV export service (streaming) [deep]
├── Task 6:  CSV export routes (pharmacies/exchanges/reports) [unspecified-high]
└── Task 7:  Matching rules API enhancement (validation) [unspecified-high]

Wave 3 (Frontend — UI Components & Pages):
├── Task 8:  AdminPharmaciesPage: Bulk selection & Actions [visual-engineering]
├── Task 9:  AdminPharmaciesPage: Pending queue tab [visual-engineering]
├── Task 10: AdminPharmacyEditPage: Audit log history view [visual-engineering]
├── Task 11: AdminMatchingRulesPage: Rule editor UI [visual-engineering]
└── Task 12: Route config & Navigation update [quick]

Wave FINAL (Review & Audit):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Security audit (admin middleware check) [deep]
└── Task F4: Scope fidelity check (deep)
```

---

## TODOs

### Wave 1: Foundation

#### Task 1: DB schema: adminAuditLogs table
- **What to do**: `server/src/db/schema.ts` に `adminAuditLogs` テーブルを追加。adminId (users.id参照), targetPharmacyId (pharmacies.id参照), action, previousStatus, newStatus, reason, createdAt を含む。
- **Must NOT do**: 既存テーブルの破壊的変更。
- **Agent Profile**: implementer
- **Parallelization**: Task 2 と並列可
- **References**: `server/src/db/schema.ts`
- **Acceptance Criteria**:
  - `npx drizzle-kit generate` が成功すること
  - マイグレーションファイルが正しく生成されること
- **QA Scenarios**:
  - DBに直接レコードを挿入し、外部キー制約が効いていることを確認
- **Commit message**: `feat(db): add adminAuditLogs table for auditing status changes`

#### Task 2: Shared types: Bulk ops & Audit log interfaces
- **What to do**: フロントエンドとバックエンドで共有する一括操作リクエストおよび監査ログの型定義を作成。
- **Must NOT do**: `any` の使用。
- **Agent Profile**: implementer
- **Parallelization**: Task 1 と並列可
- **References**: `client/src/types/` (既存の型定義場所を確認)
- **Acceptance Criteria**:
  - TypeScriptの型チェックが通ること
- **QA Scenarios**:
  - N/A (Type check only)
- **Commit message**: `feat(types): add interfaces for bulk operations and audit logs`

### Wave 2: Backend

#### Task 3: Audit log service (record/fetch)
- **What to do**: 監査ログを記録・取得するための `AuditLogService` を実装。ステータス変更時に自動的に呼び出せるようにする。
- **Must NOT do**: ログの削除・更新機能の実装（監査ログは不変であるべき）。
- **Agent Profile**: implementer
- **Parallelization**: Wave 2 内で並列可
- **References**: `server/src/services/`
- **Acceptance Criteria**:
  - ログ記録メソッドが正常に動作すること
  - 特定薬局のログ取得メソッドが正常に動作すること
- **QA Scenarios**:
  - サービス経由でログを保存し、DBから正しく取得できることを確認
- **Commit message**: `feat(server): implement AuditLogService for tracking admin actions`

#### Task 4: Bulk pharmacy operations service & routes
- **What to do**: `POST /api/admin/pharmacies/bulk-verify` および `bulk-reject` を実装。トランザクション内で複数薬局のステータスを更新し、通知を送信し、監査ログを記録する。
- **Must NOT do**: 部分的な成功を許容すること（全件成功かロールバック）。
- **Agent Profile**: implementer
- **Parallelization**: Wave 2 内で並列可
- **References**: `server/src/routes/admin/pharmacies.ts`
- **Acceptance Criteria**:
  - 複数IDを渡して一括更新ができること
  - 1件でも失敗（存在しないID等）した場合は全件ロールバックされること
- **QA Scenarios**:
  - 有効なIDリストで一括承認をリクエストし、全件のステータスと通知、監査ログを確認
  - 無効なIDを混ぜてリクエストし、全件が更新されていないことを確認
- **Commit message**: `feat(server): add bulk verify/reject endpoints for pharmacies`

#### Task 5: CSV export service (streaming)
- **What to do**: 大量データに対応するため、ストリーミング形式でCSVを生成する `CsvExportService` を実装。
- **Must NOT do**: 全データをメモリに読み込んでからレスポンスを生成すること。
- **Agent Profile**: implementer
- **Parallelization**: Wave 2 内で並列可
- **References**: `server/src/services/`
- **Acceptance Criteria**:
  - `fast-csv` 等のライブラリを使用してストリーム処理すること
  - 日本語（Shift-JIS または UTF-8 with BOM）がExcelで文字化けしないこと
- **QA Scenarios**:
  - 大量（1000件以上）のモックデータでメモリ使用量が急増しないことを確認
- **Commit message**: `feat(server): implement streaming CSV export service`

#### Task 6: CSV export routes (pharmacies/exchanges/reports)
- **What to do**: 薬局一覧、交換履歴、月次レポートのCSVエクスポートエンドポイントを実装。
- **Must NOT do**: `requireAdmin` ミドルウェアを忘れること。
- **Agent Profile**: implementer
- **Parallelization**: Wave 2 内で並列可
- **References**: `server/src/routes/admin/`
- **Acceptance Criteria**:
  - 各エンドポイントからCSVファイルがダウンロードできること
  - フィルタ条件（日付範囲等）がエクスポートに反映されること
- **QA Scenarios**:
  - `curl` でリクエストし、レスポンスヘッダーの `Content-Type: text/csv` を確認
  - ダウンロードしたCSVの内容がDBと一致することを確認
- **Commit message**: `feat(server): add CSV export endpoints for admin data`

#### Task 7: Matching rules API enhancement (validation)
- **What to do**: 既存の `PUT /api/admin/matching-rules` にバリデーションを追加し、不正な値（負の重み等）を拒否するように強化。
- **Must NOT do**: 既存の正常なルールを破壊すること。
- **Agent Profile**: implementer
- **Parallelization**: Wave 2 内で並列可
- **References**: `server/src/routes/admin/matching-rules.ts`
- **Acceptance Criteria**:
  - 不正な入力に対して 400 Bad Request を返すこと
- **QA Scenarios**:
  - 範囲外の数値を送信し、エラーメッセージが返ることを確認
- **Commit message**: `fix(server): enhance validation for matching rules API`

### Wave 3: Frontend

#### Task 8: AdminPharmaciesPage: Bulk selection & Actions
- **What to do**: `AdminPharmaciesPage` のテーブルにチェックボックス列を追加し、選択された薬局に対して一括承認/拒否を実行できるツールバーを実装。
- **Must NOT do**: ページネーションを跨いだ選択状態の管理ミス。
- **Agent Profile**: visual-engineering
- **Parallelization**: Wave 3 内で並列可
- **References**: `client/src/pages/admin/AdminPharmaciesPage.tsx`
- **Acceptance Criteria**:
  - 全選択/解除ができること
  - 選択中のみアクションボタンが有効になること
- **QA Scenarios**:
  - 複数選択して一括承認ボタンを押し、確認ダイアログが表示され、実行後に一覧が更新されることを確認
- **Commit message**: `feat(client): add bulk selection and actions to AdminPharmaciesPage`

#### Task 9: AdminPharmaciesPage: Pending queue tab
- **What to do**: `AdminPharmaciesPage` に「承認待ち」タブを追加。`status=pending` の薬局のみを表示し、申請日時順にソートする。
- **Must NOT do**: 既存の「すべて」タブの動作を壊すこと。
- **Agent Profile**: visual-engineering
- **Parallelization**: Wave 3 内で並列可
- **References**: `client/src/pages/admin/AdminPharmaciesPage.tsx`
- **Acceptance Criteria**:
  - タブ切り替えでフィルタリングが正しく行われること
  - バッジ等で承認待ち件数が表示されること
- **QA Scenarios**:
  - 「承認待ち」タブを選択し、pending以外の薬局が表示されないことを確認
- **Commit message**: `feat(client): add pending approval queue tab to AdminPharmaciesPage`

#### Task 10: AdminPharmacyEditPage: Audit log history view
- **What to do**: `AdminPharmacyEditPage` の下部に、その薬局に対する過去の監査ログ（ステータス変更履歴）を表示するセクションを追加。
- **Must NOT do**: ログが大量にある場合にページが重くなること（必要ならスクロール/簡易ページネーション）。
- **Agent Profile**: visual-engineering
- **Parallelization**: Wave 3 内で並列可
- **References**: `client/src/pages/admin/AdminPharmacyEditPage.tsx`
- **Acceptance Criteria**:
  - 日時、操作者、変更前後のステータス、理由が表示されること
- **QA Scenarios**:
  - ステータスを変更した後、履歴セクションに即座に反映されることを確認
- **Commit message**: `feat(client): display audit logs in AdminPharmacyEditPage`

#### Task 11: AdminMatchingRulesPage: Rule editor UI
- **What to do**: `AdminMatchingRulesPage.tsx` を新設。現在のマッチングルールを取得し、スライダーや数値入力で編集・保存できるフォームを実装。
- **Must NOT do**: 保存ボタンを押す前に変更が反映されてしまうこと（ドラフト状態の維持）。
- **Agent Profile**: visual-engineering
- **Parallelization**: Wave 3 内で並列可
- **References**: `client/src/pages/admin/`
- **Acceptance Criteria**:
  - 各パラメータの説明が表示されていること
  - 保存成功時にトースト通知が表示されること
- **QA Scenarios**:
  - ルールを変更して保存し、リロード後も変更が保持されていることを確認
- **Commit message**: `feat(client): implement AdminMatchingRulesPage for dynamic rule adjustment`

#### Task 12: Route config & Navigation update
- **What to do**: `AdminMatchingRulesPage` を `route-config.tsx` に登録し、サイドバー等のナビゲーションに追加。
- **Must NOT do**: `adminOnly: true` フラグを忘れること。
- **Agent Profile**: implementer
- **Parallelization**: Wave 3 内で並列可
- **References**: `client/src/routes/route-config.tsx`
- **Acceptance Criteria**:
  - 管理者ユーザーで新しいページにアクセスできること
- **QA Scenarios**:
  - 一般ユーザーでURLを直接叩き、アクセス拒否されることを確認
- **Commit message**: `feat(client): register AdminMatchingRulesPage and update navigation`

### Wave FINAL: Review & Audit

#### Task F1: Plan compliance audit (oracle)
- **What to do**: 実装が本計画の Must Have をすべて満たし、Must NOT Have に抵触していないか、oracle エージェントが監査する。
- **Must NOT do**: 形式的なチェックで済ませること。
- **Agent Profile**: oracle
- **Parallelization**: Wave FINAL 内で並列可
- **Acceptance Criteria**: 計画との不一致が 0 件であること。

#### Task F2: Code quality review
- **What to do**: コードの可読性、型安全性、既存パターンとの整合性をレビューする。
- **Must NOT do**: `as any` 等の技術的負債を見逃すこと。
- **Agent Profile**: claude_reviewer
- **Parallelization**: Wave FINAL 内で並列可
- **Acceptance Criteria**: 重大な指摘事項が 0 件であること。

#### Task F3: Security audit (admin middleware check)
- **What to do**: 新設されたすべてのAPIエンドポイントおよびフロントエンドルートに、適切な管理者権限チェックが実装されているか確認する。
- **Must NOT do**: 権限昇格の脆弱性を見逃すこと。
- **Agent Profile**: implementer
- **Parallelization**: Wave FINAL 内で並列可
- **Acceptance Criteria**: すべての新エンドポイントで `requireAdmin` が機能していること。

#### Task F4: Scope fidelity check
- **What to do**: 実装された機能がユーザーの期待する「管理者機能強化」のスコープに合致しているか、最終確認を行う。
- **Must NOT do**: スコープ外の機能が含まれていないか確認。
- **Agent Profile**: implementer
- **Parallelization**: Wave FINAL 内で並列可
- **Acceptance Criteria**: スコープ通りの成果物が揃っていること。
