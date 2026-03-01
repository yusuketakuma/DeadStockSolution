# 統合タイムライン機能 + 既存機能連動

## TL;DR

> **Quick Summary**: ダッシュボードの通知欄を「統合タイムライン」に進化させ、スマートダイジェスト（優先度付きアクション提案）＋時系列アクティビティフィード＋提案詳細のビジュアルタイムライン強化を一体で構築する。既存通知システムの上位互換として、忙しい薬局スタッフが「朝開いたら全部わかる」体験を実現。
>
> **Deliverables**:
> - 統合タイムラインAPI（既存9テーブル並列クエリ + JS merge）
> - スマートダイジェストコンポーネント（ルールベース優先度エンジン）
> - ダッシュボードタイムラインフィード（DashboardNotices + NextAction を置換）
> - 提案詳細ページのビジュアルタイムライン強化
> - TimelineContext（NotificationContext の上位互換）
> - ヘッダーバッジ統合（タイムライン未読数）
> - モバイルファーストUI
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 5 waves
> **Critical Path**: T1→T3→T6→T11→T13→T15→T16→F1-F4

---

## Context

### Original Request
タイムライン機能と既存実装済み機能との連動について計画。ユーザー体験を第一に、忙しいユーザーのためになる機能を最大限考察して立案。

### Interview Summary
**Key Discussions**:
- 方向性: A(統合アクティビティフィード) + B(提案タイムライン強化) + C(スマートダイジェスト) の3本柱
- 表示場所: ダッシュボード上部の通知欄を拡張・置換
- 通知との関係: タイムラインが通知の上位互換（通知 = タイムラインの未読イベント）
- データ: 既存テーブル統合クエリ（新テーブル不要）
- ダイジェスト: ルールベース優先度（Critical/High/Medium/Low）
- 既存UI: DashboardNotices + DashboardNextAction を置換
- モバイル: モバイルファースト
- テスト: TDD (vitest)
- 提案タイムライン: データ+UI両方強化

**Research Findings**:
- 既存通知システムは全Phase完了（T026-T035）、30秒ポーリング、未読管理付き
- activityLogs: 22アクションタイプ完全追跡
- ProposalDetailPageに既存ProposalTimelineEvent[]型あり
- 既存notifications routeは並列クエリ+JSマージパターン（SQL UNIONではない）
- buildNextAction() に129行のビジネスロジックあり（要保全）
- 9テーブル中5テーブルに既読/未読追跡なし

### Metis Review
**Identified Gaps** (addressed):
- **未読追跡ギャップ**: 9テーブル中5つにisRead列なし → `pharmacies.lastTimelineViewedAt` カラム追加で解決（「最後に閲覧した時刻より新しい = 未読」モデル）
- **クエリパターン**: SQL UNIONでなく、既存の並列クエリ+JSマージパターンを踏襲
- **buildNextAction()消失リスク**: ロジックをスマートダイジェストの優先度ルールに統合（テストで先に動作保証）
- **タイムスタンプ列名不統一**: proposedAt/completedAt/createdAt → テーブルごとのマッピング関数で吸収
- **管理者タイムライン**: 現行通り管理者はバッジ非表示。管理者ダッシュボードはスコープ外
- **期限切れデッドストック**: deadStockItemsテーブルを10番目のデータソースとしてダイジェスト用に追加
- **型の重複リスク**: TimelineEvent共通型をserver/client双方で定義（将来の共有型基盤への布石）

---

## Work Objectives

### Core Objective
忙しい薬局スタッフが朝ダッシュボードを開くだけで「昨日何が起きて、今日何をすべきか」が一目でわかる統合タイムライン体験を構築する。既存通知システムを包含・発展させる。

### Concrete Deliverables
- `GET /api/timeline` — 統合タイムラインAPI（ページネーション+フィルタリング+優先度付き）
- `GET /api/timeline/unread-count` — 未読イベント数API
- `PATCH /api/timeline/mark-viewed` — 閲覧済みマーク API
- `server/src/services/timeline-service.ts` — タイムラインサービス
- `server/src/services/timeline-priority-engine.ts` — 優先度ルールエンジン
- `client/src/contexts/TimelineContext.tsx` — タイムラインコンテキスト
- `client/src/components/timeline/SmartDigest.tsx` — スマートダイジェストUI
- `client/src/components/timeline/DashboardTimeline.tsx` — タイムラインフィード
- `client/src/components/timeline/TimelineEventCard.tsx` — イベントカード
- `client/src/components/timeline/ProposalTimeline.tsx` — 提案タイムライン強化
- Drizzle migration: `pharmacies.lastTimelineViewedAt` カラム追加
- 全コンポーネントのモバイルファーストデザイン

### Definition of Done
- [x] `npm run test --workspace=server` — 全テスト PASS（新規タイムラインテスト含む）
- [x] `npm run test --workspace=client` — 全テスト PASS（新規コンポーネントテスト含む）
- [x] `npx tsc --noEmit` — server + client 両方 0 errors
- [x] ダッシュボード表示: スマートダイジェスト + タイムラインフィードが正しく表示
- [x] 提案詳細ページ: ビジュアルタイムラインが全イベントを時系列表示
- [x] ヘッダーバッジ: タイムライン未読数を正しく表示
- [x] モバイル: 全コンポーネントが992px以下で適切に表示

### Must Have
- 既存テーブル並列クエリ+JSマージパターン（notifications.ts L250-336 踏襲）
- ルールベース優先度判定（Critical/High/Medium/Low 4段階）
- モバイルファースト（AppResponsiveSwitch活用）
- TDD: 各サービス・コンポーネントにユニットテスト
- 既存通知エンドポイントの後方互換維持（移行期間中）
- buildNextAction()ビジネスロジックの完全保全
- offset-based ページネーション（既存parsePagination踏襲）

### Must NOT Have (Guardrails)
- ❌ WebSocket / SSE（Vercel serverless非対応、30秒ポーリング維持）
- ❌ 新規データベーステーブル（`pharmacies.lastTimelineViewedAt` カラム追加のみ許容）
- ❌ 通知設定/プリファレンスUI
- ❌ プッシュ通知（ブラウザ/モバイル）
- ❌ activityLog スキーマ変更（新アクションタイプ追加禁止）
- ❌ 管理者ダッシュボードの変更
- ❌ タイムライン検索/全文検索
- ❌ タイムラインエクスポート（CSV/PDF）
- ❌ アニメーション/トランジション（framer-motion等）
- ❌ 楽観的更新（ポーリングベース、サーバー権威）
- ❌ SQL UNION クエリ（並列クエリ+JSマージを使用）
- ❌ DashboardStatusCards への変更
- ❌ AI/MLベースの優先度判定
- ❌ 既存通知エンドポイントの即時削除（後方互換維持）
- ❌ 過剰なJSDocコメント（最小限に）
- ❌ 汎用的すぎる命名（data/result/item/temp）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest, 320 server + 114 client tests)
- **Automated tests**: TDD (RED-GREEN-REFACTOR)
- **Framework**: vitest (server + client both)
- **Each task**: テスト→実装→リファクタの順

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Backend API**: Use Bash (curl) — Send requests, assert status + response fields
- **Frontend UI**: Use Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **Component Unit**: Use Bash (vitest) — Run specific test files, assert pass count

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — schema + types + priority engine):
├── Task 1: Schema migration (lastTimelineViewedAt) + types [quick]
├── Task 2: timeline-priority-engine.ts (pure function, TDD) [deep]
├── Task 3: timeline-aggregator helpers (per-table fetchers, TDD) [deep]
└── Task 4: ProposalTimeline data enrichment (server-side, TDD) [unspecified-high]

Wave 2 (Backend API — complete timeline endpoint):
├── Task 5: timeline-service.ts (parallel query + merge + paginate, TDD) [deep]
├── Task 6: Timeline API routes (GET /timeline, GET /unread-count, PATCH /mark-viewed, TDD) [unspecified-high]
└── Task 7: Shared TimelineEvent type definition (client-side mirror) [quick]

Wave 3 (Frontend Components — individual pieces):
├── Task 8: TimelineEventCard component (mobile-first, TDD) [visual-engineering]
├── Task 9: SmartDigest component (priority display, TDD) [visual-engineering]
├── Task 10: DashboardTimeline feed component (TDD) [visual-engineering]
└── Task 11: ProposalTimeline visual component (TDD) [visual-engineering]

Wave 4 (Integration — wiring everything together):
├── Task 12: TimelineContext (replace NotificationContext, TDD) [deep]
├── Task 13: DashboardPage integration (replace DashboardNotices + NextAction) [unspecified-high]
├── Task 14: ProposalDetailPage integration (replace existing timeline) [unspecified-high]
└── Task 15: Header badge rewiring + old endpoint deprecation [quick]

Wave FINAL (Verification — 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA - Playwright (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: T1 → T3 → T5 → T6 → T10 → T12 → T13 → T15 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 4 (Waves 1, 3)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| T1 | — | T3, T5, T6 | 1 |
| T2 | — | T5, T9 | 1 |
| T3 | T1 | T5 | 1 |
| T4 | T1 | T11, T14 | 1 |
| T5 | T1, T2, T3 | T6, T10 | 2 |
| T6 | T5 | T12, T13 | 2 |
| T7 | — | T8, T9, T10, T11 | 2 |
| T8 | T7 | T10, T13 | 3 |
| T9 | T2, T7 | T13 | 3 |
| T10 | T5, T7, T8 | T13 | 3 |
| T11 | T4, T7 | T14 | 3 |
| T12 | T6 | T13, T15 | 4 |
| T13 | T8, T9, T10, T12 | T15, F1-F4 | 4 |
| T14 | T4, T11 | F1-F4 | 4 |
| T15 | T12, T13 | F1-F4 | 4 |
| F1-F4 | T13, T14, T15 | — | FINAL |

### Agent Dispatch Summary

- **Wave 1**: 4 tasks — T1 `quick`, T2 `deep`, T3 `deep`, T4 `unspecified-high`
- **Wave 2**: 3 tasks — T5 `deep`, T6 `unspecified-high`, T7 `quick`
- **Wave 3**: 4 tasks — T8-T11 `visual-engineering`
- **Wave 4**: 4 tasks — T12 `deep`, T13-T14 `unspecified-high`, T15 `quick`
- **FINAL**: 4 tasks — F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high` + `playwright`, F4 `deep`

---

## TODOs


- [x] 1. Schema Migration: `lastTimelineViewedAt` カラム追加 + TimelineEvent 共通型定義

  **What to do**:
  - `server/src/db/schema.ts` の `pharmacies` テーブルに `lastTimelineViewedAt: timestamp('last_timeline_viewed_at', { mode: 'string' })` カラム追加
  - Drizzle migration 生成: `cd server && npx drizzle-kit generate`
  - `server/src/types/timeline.ts` に `TimelineEvent` 共通型を定義:
    ```typescript
    type TimelinePriority = 'critical' | 'high' | 'medium' | 'low';
    type TimelineSource = 'notification' | 'activity' | 'match' | 'proposal' | 'comment' | 'feedback' | 'upload' | 'admin_message' | 'exchange_history' | 'expiry_risk';
    interface TimelineEvent {
      id: string; // '{source}_{tableId}' e.g. 'notification_42'
      source: TimelineSource;
      type: string; // action type or notification type
      title: string;
      body: string;
      timestamp: string; // ISO string
      priority: TimelinePriority;
      isRead: boolean;
      actionPath?: string; // link target
      metadata?: Record<string, unknown>;
    }
    ```
  - テスト: migration が正常に適用されること、型定義が tsc コンパイル通ること

  **Must NOT do**:
  - 新テーブル作成禁止（カラム追加のみ）
  - 既存カラムの変更禁止

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 3, 5, 6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `server/src/db/schema.ts:47-70` — pharmacies テーブル定義。ここに `lastTimelineViewedAt` カラムを追加
  - `server/src/db/schema.ts:577-597` — notifications テーブル定義。TimelineEvent 型設計の参考（type/title/message/referenceType/referenceId 構造）
  - `server/drizzle/` — 既存 migration ファイルの命名パターン確認用

  **API/Type References**:
  - `client/src/components/dashboard/types.ts:1-30` — 既存の Notice 型定義。TimelineEvent 型はこれを包含する設計
  - `client/src/pages/ProposalDetailPage.tsx:37` — 既存の ProposalTimelineEvent 型。提案タイムライン用の参考

  **WHY Each Reference Matters**:
  - schema.ts の pharmacies テーブル: カラム追加の正確な場所を特定するため
  - notifications テーブル: TimelineEvent 型が既存の通知データ構造を包含できるか確認するため
  - 既存 Notice 型: 新型が後方互換を維持できる設計か確認するため

  **Acceptance Criteria**:
  - [x] `cd server && npx drizzle-kit generate` → migration ファイル生成成功
  - [x] `npx tsc --noEmit --project server/tsconfig.json` → 0 errors
  - [x] `server/src/types/timeline.ts` が存在し、TimelineEvent/TimelinePriority/TimelineSource 型をエクスポート

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Schema migration applies correctly
    Tool: Bash
    Preconditions: Server dev environment running
    Steps:
      1. Run `cd server && npx drizzle-kit generate`
      2. Check new migration file exists in server/drizzle/
      3. Run `npx tsc --noEmit --project server/tsconfig.json`
    Expected Result: Migration file generated, TypeScript compiles with 0 errors
    Failure Indicators: drizzle-kit error, tsc compilation errors
    Evidence: .sisyphus/evidence/task-1-schema-migration.txt

  Scenario: Type definitions are valid
    Tool: Bash
    Preconditions: server/src/types/timeline.ts created
    Steps:
      1. Import TimelineEvent type in a test file
      2. Create a mock object conforming to the type
      3. Run tsc --noEmit
    Expected Result: No type errors
    Evidence: .sisyphus/evidence/task-1-type-check.txt
  ```

  **Commit**: YES
  - Message: `feat(db): add lastTimelineViewedAt column and TimelineEvent types`
  - Files: `server/src/db/schema.ts`, `server/src/types/timeline.ts`, `server/drizzle/*.sql`
  - Pre-commit: `npx tsc --noEmit --project server/tsconfig.json`

---

- [x] 2. Timeline Priority Engine (ルールベース優先度判定、TDD)

  **What to do**:
  - `server/src/services/timeline-priority-engine.ts` を作成
  - TDD: 先にテスト `server/src/services/__tests__/timeline-priority-engine.test.ts` を作成
  - 優先度ルール（Pure Function）:
    ```
    Critical:
      - confirmed 提案の取引完了待ち（status='confirmed', completedAt=null）
      - 期限切れ3日以内のデッドストック（expirationDateIso <= today+3, isAvailable=true）
    High:
      - 未返信コメント24h以上（proposalComments where readByRecipient=false, createdAt < now-24h）
      - 受信提案の承認/拒否待ち（status='proposed', pharmacyBId=self）
      - 新規マッチング候補（matchNotifications where isRead=false）
    Medium:
      - 提案ステータス変更（notification type='proposal_status_changed'）
      - 新規コメント受信（notification type='new_comment'）
      - 在庫アップロード完了（activityLogs action='upload'）
    Low:
      - 管理者メッセージ（adminMessages）
      - 取引完了履歴（exchangeHistory）
      - システム更新情報
    ```
  - `assignPriority(event: RawTimelineEvent): TimelinePriority` — イベントデータからルールに基づき優先度を割り当て
  - `buildNextAction()` (types.ts L127-255) のロジックを分析し、Critical/High ルールに統合
  - テスト: 各優先度レベルについて最低2ケース（該当/非該当）

  **Must NOT do**:
  - AI/ML ベースの判定禁止
  - 外部API呼び出し禁止
  - DB直接アクセス禁止（Pure Function のみ）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Tasks 5, 9
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `client/src/components/dashboard/types.ts:127-255` — `buildNextAction()` 関数。129行のビジネスロジック。ワークフロー状態に基づく「次のアクション」決定ロジック。これをスマートダイジェストの優先度ルールに統合する
  - `client/src/components/dashboard/types.ts:1-45` — Notice 型と NoticeType 定義。優先度判定に使うイベントタイプの全体像

  **API/Type References**:
  - `server/src/db/schema.ts:21-29` — exchangeStatusEnum。提案ステータスの全値（proposed/accepted_a/accepted_b/confirmed/rejected/completed/cancelled）
  - `server/src/types/timeline.ts` — T1 で定義する TimelineEvent/TimelinePriority 型

  **External References**:
  - なし（Pure Function、外部依存なし）

  **WHY Each Reference Matters**:
  - buildNextAction(): このロジックが「今日やるべきこと」の根幹。消失させず優先度エンジンに統合する
  - exchangeStatusEnum: confirmed 判定、proposed 判定に必要
  - Notice types: どのイベントタイプをどの優先度にマッピングするかの根拠

  **Acceptance Criteria**:
  - [x] テスト作成: `server/src/services/__tests__/timeline-priority-engine.test.ts` — 最低12テスト
  - [x] `npx vitest run server/src/services/__tests__/timeline-priority-engine.test.ts` → 全PASS
  - [x] Critical/High/Medium/Low の各レベルに最低2テストケース
  - [x] buildNextAction() の主要ロジック（upload未完了判定、提案期限判定）が優先度ルールに反映

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Priority engine correctly assigns Critical to confirmed proposals
    Tool: Bash (vitest)
    Preconditions: timeline-priority-engine.test.ts created
    Steps:
      1. Create test: event with source='proposal', type='confirmed', completedAt=null
      2. Call assignPriority(event)
      3. Assert result === 'critical'
    Expected Result: Priority is 'critical'
    Evidence: .sisyphus/evidence/task-2-priority-engine.txt

  Scenario: Priority engine assigns Low to admin messages
    Tool: Bash (vitest)
    Preconditions: Same test file
    Steps:
      1. Create test: event with source='admin_message'
      2. Call assignPriority(event)
      3. Assert result === 'low'
    Expected Result: Priority is 'low'
    Evidence: .sisyphus/evidence/task-2-priority-low.txt
  ```

  **Commit**: YES
  - Message: `feat(server): add timeline priority engine with TDD`
  - Files: `server/src/services/timeline-priority-engine.ts`, `server/src/services/__tests__/timeline-priority-engine.test.ts`
  - Pre-commit: `npx vitest run server/src/services/__tests__/timeline-priority-engine.test.ts`

---

- [x] 3. Timeline Aggregator Helpers (テーブル別データ取得関数群、TDD)

  **What to do**:
  - `server/src/services/timeline-aggregators.ts` を作成
  - TDD: 先にテスト `server/src/services/__tests__/timeline-aggregators.test.ts` を作成
  - テーブルごとの fetcher 関数を実装（各関数は db と pharmacyId を受け取り、RawTimelineEvent[] を返す）:
    1. `fetchNotificationEvents(db, pharmacyId, since?)` — notifications テーブル
    2. `fetchMatchEvents(db, pharmacyId, since?)` — matchNotifications テーブル
    3. `fetchProposalEvents(db, pharmacyId, since?)` — exchangeProposals (pharmacyAId OR pharmacyBId)
    4. `fetchCommentEvents(db, pharmacyId, since?)` — proposalComments (自分の提案に対するコメント)
    5. `fetchFeedbackEvents(db, pharmacyId, since?)` — exchangeFeedback
    6. `fetchUploadEvents(db, pharmacyId, since?)` — uploads + activityLogs(action='upload')
    7. `fetchAdminMessageEvents(db, pharmacyId, since?)` — adminMessages
    8. `fetchExchangeHistoryEvents(db, pharmacyId, since?)` — exchangeHistory
    9. `fetchExpiryRiskEvents(db, pharmacyId)` — deadStockItems(expirationDateIso <= today+3)
  - 各 fetcher は統一された RawTimelineEvent 型を返す（タイムスタンプ列名の差異を吸収）
  - `since` パラメータで日付フィルタリング対応（ページネーション最適化用）
  - **重要**: `server/src/routes/notifications.ts` L250-336 の並列クエリパターンを踏襲

  **Must NOT do**:
  - SQL UNION 使用禁止（各テーブル個別クエリ）
  - 1関数で全テーブルクエリ禁止（関数分割必須）
  - activityLogs スキーマ変更禁止

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1 (schema types)

  **References**:

  **Pattern References**:
  - `server/src/routes/notifications.ts:250-336` — **最重要参照**。既存の並列クエリ+JSマージパターン。このファイルの `Promise.all()` → merge → sort パターンをそのまま踏襲する
  - `server/src/services/notification-service.ts:82-130` — `getDashboardUnreadCount()` 関数。複数テーブルからの集計パターン参考

  **API/Type References**:
  - `server/src/db/schema.ts:443-460` — activityLogs テーブル定義。action フィールドの値と detail フィールドのフォーマット（'proposalId=X|status=Y'）
  - `server/src/db/schema.ts:154-171` — exchangeProposals テーブル。`proposedAt`（createdAtではない）に注意
  - `server/src/db/schema.ts:186-200` — exchangeHistory テーブル。`completedAt`（createdAtではない）に注意
  - `server/src/db/schema.ts:508-526` — matchNotifications テーブル。diffJson/candidateCountBefore/After
  - `server/src/db/schema.ts:89-127` — deadStockItems テーブル。expirationDateIso + isAvailable で期限切れ判定
  - `server/src/types/timeline.ts` — T1 で定義する TimelineEvent 型

  **WHY Each Reference Matters**:
  - notifications.ts: 並列クエリの「証明済みパターン」。このパターンを外れると未知のリスク
  - activityLogs: detail フィールドのパイプ区切りパース方法を知る必要がある
  - exchangeProposals/exchangeHistory: タイムスタンプ列名が異なる（proposedAt/completedAt）ため、マッピング実装に必須
  - deadStockItems: 期限切れリスク判定のクエリ条件確認

  **Acceptance Criteria**:
  - [x] 9つの fetcher 関数が全て実装済み
  - [x] 各 fetcher が RawTimelineEvent[] を返す（統一型）
  - [x] `npx vitest run server/src/services/__tests__/timeline-aggregators.test.ts` → 全PASS
  - [x] テスト: 各 fetcher に最低2テスト（データあり/なし）→ 最低18テスト

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Notification fetcher returns correct events
    Tool: Bash (vitest)
    Preconditions: Test DB with seed data
    Steps:
      1. Insert notification record for pharmacy_id=1
      2. Call fetchNotificationEvents(db, 1)
      3. Assert result[0].source === 'notification'
      4. Assert result[0].timestamp is ISO string
    Expected Result: Returns array of RawTimelineEvent with correct source and timestamp
    Evidence: .sisyphus/evidence/task-3-aggregators.txt

  Scenario: Fetcher returns empty array for pharmacy with no events
    Tool: Bash (vitest)
    Steps:
      1. Call fetchNotificationEvents(db, 99999)
      2. Assert result.length === 0
    Expected Result: Empty array, no errors
    Evidence: .sisyphus/evidence/task-3-empty.txt
  ```

  **Commit**: YES
  - Message: `feat(server): add timeline aggregator helpers with TDD`
  - Files: `server/src/services/timeline-aggregators.ts`, `server/src/services/__tests__/timeline-aggregators.test.ts`
  - Pre-commit: `npx vitest run server/src/services/__tests__/timeline-aggregators.test.ts`

---

- [x] 4. Proposal Timeline Data Enrichment (提案タイムラインデータ強化、TDD)

  **What to do**:
  - 既存の `server/src/routes/exchange-proposals.ts` の提案タイムライン構築ロジックを拡張
  - TDD: `server/src/routes/__tests__/exchange-proposals-timeline.test.ts` にテスト追加
  - 追加するイベントタイプ:
    - コメント追加/編集/削除（proposalComments から取得）
    - フィードバック投稿（exchangeFeedback から取得）
    - 提案アイテム詳細（exchangeProposalItems の薬品名・数量を含む）
  - 既存の `ProposalTimelineEvent` 型を拡張:
    ```typescript
    interface EnrichedProposalTimelineEvent extends ProposalTimelineEvent {
      eventType: 'status_change' | 'comment' | 'feedback' | 'item_detail';
      commentBody?: string;
      feedbackRating?: number;
      feedbackComment?: string;
    }
    ```
  - 既存の activityLogs ベースのタイムライン構築を壊さない（additive change）

  **Must NOT do**:
  - 既存 ProposalTimelineEvent 型の breaking change 禁止
  - activityLogs の detail パース方法変更禁止
  - 既存レスポンス shape の破壊禁止（新フィールド追加のみ）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Tasks 11, 14
  - **Blocked By**: Task 1 (types)

  **References**:

  **Pattern References**:
  - `server/src/routes/exchange-proposals.ts:370-416` — **最重要参照**。既存の提案タイムライン構築ロジック。activityLogs からフィルタリングし、detail フィールドをパースして ProposalTimelineEvent[] を構築している。このロジックを壊さず拡張する

  **API/Type References**:
  - `server/src/db/schema.ts:202-216` — proposalComments テーブル。コメントイベント追加に必要
  - `server/src/db/schema.ts:218-233` — exchangeFeedback テーブル。フィードバックイベント追加に必要
  - `server/src/db/schema.ts:173-184` — exchangeProposalItems テーブル。アイテム詳細表示に必要
  - `client/src/pages/ProposalDetailPage.tsx:37` — 既存 ProposalTimelineEvent 型（クライアント側定義）

  **WHY Each Reference Matters**:
  - exchange-proposals.ts:370-416: 既存タイムラインの構築方法を理解し、壊さず拡張するために必須
  - proposalComments: コメントイベントのデータ構造確認
  - ProposalTimelineEvent (client): 拡張後も既存UIが壊れないことを確認

  **Acceptance Criteria**:
  - [x] `GET /api/exchange/proposals/:id` のレスポンスに enrichedTimeline フィールド追加
  - [x] enrichedTimeline にコメント/フィードバック/アイテム詳細イベントが含まれる
  - [x] 既存 timeline フィールドは変更なし（後方互換）
  - [x] `npx vitest run server/src/routes/__tests__/exchange-proposals-timeline.test.ts` → 全PASS

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Enriched timeline includes comment events
    Tool: Bash (curl)
    Preconditions: Auth cookie for pharmacy with proposals that have comments
    Steps:
      1. curl -s -b cookies.txt http://localhost:3000/api/exchange/proposals/1
      2. Parse JSON response
      3. Check .enrichedTimeline contains objects with eventType='comment'
    Expected Result: enrichedTimeline array includes comment events with commentBody field
    Evidence: .sisyphus/evidence/task-4-enriched-timeline.json

  Scenario: Existing timeline field unchanged (backward compat)
    Tool: Bash (curl)
    Steps:
      1. curl -s -b cookies.txt http://localhost:3000/api/exchange/proposals/1
      2. Check .timeline field exists and has same structure as before
    Expected Result: timeline field unchanged, enrichedTimeline is additive
    Evidence: .sisyphus/evidence/task-4-backward-compat.json
  ```

  **Commit**: YES
  - Message: `feat(server): enrich proposal timeline with comments and feedback`
  - Files: `server/src/routes/exchange-proposals.ts`, `server/src/routes/__tests__/exchange-proposals-timeline.test.ts`
  - Pre-commit: `npx vitest run server/src/routes/__tests__/exchange-proposals-timeline.test.ts`

---

- [x] 5. Timeline Service (並列クエリ + マージ + ページネーション、TDD)

  **What to do**:
  - `server/src/services/timeline-service.ts` を作成
  - TDD: `server/src/services/__tests__/timeline-service.test.ts`
  - コア関数:
    - `getTimeline(db, pharmacyId, { page, limit, priority?, since? })` — T3のaggregator群を`Promise.all()`で並列実行→マージ→T2のpriority engineで優先度付与→timestamp降順ソート→ページネーション
    - `getTimelineUnreadCount(db, pharmacyId)` — 未読イベント数算出。pharmacies.lastTimelineViewedAtより新しいイベント数をカウント（isRead=falseのテーブルはisReadも加味）
    - `markTimelineViewed(db, pharmacyId)` — pharmacies.lastTimelineViewedAtを現在時刻に更新
  - パフォーマンス目標: 全9テーブル並列クエリ+マージが500ms以内
  - Smart Digest用データ: `getSmartDigest(db, pharmacyId)` — Critical/Highイベントのみ抽出（最大5件）

  **Must NOT do**:
  - SQL UNION使用禁止
  - WebSocket/SSE導入禁止
  - 30秒ポーリング間隔の変更禁止

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential within wave)
  - **Blocks**: Tasks 6, 10
  - **Blocked By**: Tasks 1, 2, 3

  **References**:

  **Pattern References**:
  - `server/src/routes/notifications.ts:250-336` — 並列クエリ+JSマージの証明済みパターン。Promise.all()でクエリ→結果をflatten→sort→dedupe→slice
  - `server/src/services/notification-service.ts:82-130` — getDashboardUnreadCount() の集計パターン。複数テーブルの未読数を合算する方法
  - `server/src/utils/request-utils.ts` — parsePagination()関数。offset-basedページネーションのヘルパー（page/limit/offset変換）

  **API/Type References**:
  - `server/src/services/timeline-aggregators.ts` — T3で作成するfetcher群
  - `server/src/services/timeline-priority-engine.ts` — T2で作成する優先度エンジン
  - `server/src/types/timeline.ts` — T1で定義するTimelineEvent型

  **WHY Each Reference Matters**:
  - notifications.ts: マージ+ソート+dedupeの実証済みアルゴリズム。再発明するより踏襲
  - notification-service.ts: 未読数集計の既存パターン。新しいlastTimelineViewedAtベースの集計と比較参照
  - request-utils.ts: ページネーションの既存ヘルパーを再利用

  **Acceptance Criteria**:
  - [x] getTimeline() が TimelineEvent[] を返す（ページネーション付き）
  - [x] getTimelineUnreadCount() が number を返す
  - [x] markTimelineViewed() が pharmacies.lastTimelineViewedAt を更新
  - [x] getSmartDigest() が Critical/High イベントのみ最大5件返す
  - [x] `npx vitest run server/src/services/__tests__/timeline-service.test.ts` → 全PASS
  - [x] テスト: 最低8テスト（ページネーション、フィルタリング、未読数、空状態等）

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Timeline returns paginated results with priority
    Tool: Bash (vitest)
    Steps:
      1. Seed DB with 30+ events across multiple tables
      2. Call getTimeline(db, pharmacyId, { page: 1, limit: 10 })
      3. Assert result.events.length === 10
      4. Assert result.total > 10
      5. Assert events are sorted by timestamp DESC
      6. Assert each event has priority field
    Expected Result: 10 events returned, properly sorted, with priorities
    Evidence: .sisyphus/evidence/task-5-timeline-service.txt

  Scenario: Unread count reflects lastTimelineViewedAt
    Tool: Bash (vitest)
    Steps:
      1. Set lastTimelineViewedAt to 1 hour ago
      2. Insert 3 events with timestamp = now
      3. Call getTimelineUnreadCount(db, pharmacyId)
      4. Assert count >= 3
    Expected Result: Count includes events newer than lastTimelineViewedAt
    Evidence: .sisyphus/evidence/task-5-unread-count.txt
  ```

  **Commit**: YES
  - Message: `feat(server): add timeline-service with parallel query and merge`
  - Files: `server/src/services/timeline-service.ts`, `server/src/services/__tests__/timeline-service.test.ts`
  - Pre-commit: `npx vitest run server/src/services/__tests__/timeline-service.test.ts`

---

- [x] 6. Timeline API Routes (TDD)

  **What to do**:
  - `server/src/routes/timeline.ts` を作成
  - TDD: `server/src/routes/__tests__/timeline-route.test.ts`
  - エンドポイント:
    - `GET /api/timeline` — タイムラインイベント一覧（query: page, limit, priority, since）
    - `GET /api/timeline/unread-count` — 未読イベント数（軽量ポーリング用）
    - `PATCH /api/timeline/mark-viewed` — 閲覧済みマーク（lastTimelineViewedAt更新）
  - `server/src/app.ts` にルート登録
  - 認証ミドルウェア必須（authMiddleware）
  - レスポンス形状:
    ```typescript
    // GET /api/timeline
    { events: TimelineEvent[], total: number, page: number, limit: number }
    // GET /api/timeline/unread-count
    { unreadCount: number }
    // PATCH /api/timeline/mark-viewed
    { success: true, viewedAt: string }
    ```

  **Must NOT do**:
  - 既存 /api/notifications エンドポイントの削除・変更禁止（後方互換）
  - 認証なしのエンドポイント公開禁止

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on T5)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 12, 13
  - **Blocked By**: Task 5

  **References**:

  **Pattern References**:
  - `server/src/routes/notifications.ts` — 既存通知ルート全体。ルート構造、エラーハンドリング、レスポンス形状のパターン参考
  - `server/src/app.ts` — ルート登録パターン。`app.use('/api/timeline', authMiddleware, timelineRouter)` の追加場所
  - `server/src/middleware/` — authMiddleware の import パスと使い方

  **API/Type References**:
  - `server/src/services/timeline-service.ts` — T5で作成するサービス。ルートハンドラから呼び出す
  - `server/src/utils/request-utils.ts` — parsePagination() ヘルパー

  **Test References**:
  - `server/src/routes/__tests__/` — 既存ルートテストのパターン（supertest使用かmock使用か確認）

  **WHY Each Reference Matters**:
  - notifications.ts: 新ルートが既存ルートと同じパターンで書かれることを保証
  - app.ts: ルート登録の正確な場所と方法を確認
  - 既存テスト: テスト記述パターンの統一

  **Acceptance Criteria**:
  - [x] `GET /api/timeline?page=1&limit=10` → 200 + TimelineEvent[]
  - [x] `GET /api/timeline?priority=critical` → critical のみ返す
  - [x] `GET /api/timeline/unread-count` → 200 + { unreadCount: number }
  - [x] `PATCH /api/timeline/mark-viewed` → 200 + { success: true }
  - [x] 認証なしリクエスト → 401
  - [x] `npx vitest run server/src/routes/__tests__/timeline-route.test.ts` → 全PASS

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Timeline API returns paginated events
    Tool: Bash (curl)
    Preconditions: Dev server running, authenticated session
    Steps:
      1. curl -s -b cookies.txt 'http://localhost:3000/api/timeline?page=1&limit=5'
      2. Parse JSON: jq '.events | length'
      3. Assert output <= 5
      4. Parse JSON: jq '.total'
      5. Assert total is a number
    Expected Result: 5 or fewer events, total count provided
    Evidence: .sisyphus/evidence/task-6-timeline-api.json

  Scenario: Unauthenticated request returns 401
    Tool: Bash (curl)
    Steps:
      1. curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3000/api/timeline'
      2. Assert output === '401'
    Expected Result: HTTP 401
    Evidence: .sisyphus/evidence/task-6-auth-check.txt
  ```

  **Commit**: YES
  - Message: `feat(server): add timeline API routes with TDD`
  - Files: `server/src/routes/timeline.ts`, `server/src/routes/__tests__/timeline-route.test.ts`, `server/src/app.ts`
  - Pre-commit: `npx vitest run server/src/routes/__tests__/timeline-route.test.ts`

---

- [x] 7. Client-side TimelineEvent型定義

  **What to do**:
  - `client/src/types/timeline.ts` を作成（サーバー側T1の型定義をクライアント向けにミラー）
  - 型定義:
    ```typescript
    export type TimelinePriority = 'critical' | 'high' | 'medium' | 'low';
    export type TimelineSource = 'notification' | 'activity' | 'match' | 'proposal' | 'comment' | 'feedback' | 'upload' | 'admin_message' | 'exchange_history' | 'expiry_risk';
    export interface TimelineEvent { ... } // server/src/types/timeline.ts と同一
    export interface TimelineResponse { events: TimelineEvent[]; total: number; page: number; limit: number; }
    export interface TimelineUnreadResponse { unreadCount: number; }
    export interface SmartDigestItem { event: TimelineEvent; actionLabel: string; actionPath: string; }
    ```
  - API関数追加 `client/src/api/timeline.ts`:
    ```typescript
    export const timelineApi = {
      getTimeline: (params) => api.get<TimelineResponse>('/timeline', { params }),
      getUnreadCount: () => api.get<TimelineUnreadResponse>('/timeline/unread-count'),
      markViewed: () => api.patch('/timeline/mark-viewed'),
    };
    ```

  **Must NOT do**:
  - 既存の api/client.ts の変更禁止
  - 既存の dashboard/types.ts の Notice 型変更禁止

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (parallel with T5, T6)
  - **Blocks**: Tasks 8, 9, 10, 11
  - **Blocked By**: None (types only, no runtime dependency)

  **References**:

  **Pattern References**:
  - `client/src/api/client.ts` — 既存APIクライアント。api.get<T>() パターンの使い方
  - `client/src/components/dashboard/types.ts:1-45` — 既存 Notice/NoticeType 型。新型が包含する設計確認

  **API/Type References**:
  - `server/src/types/timeline.ts` — T1で定義したサーバー側型。クライアント側でミラーする

  **WHY Each Reference Matters**:
  - api/client.ts: 既存パターンに沿ったAPI関数の書き方を確認
  - dashboard/types.ts: 新しいSmartDigestItemがNoticeの概念を包含するか確認

  **Acceptance Criteria**:
  - [x] `client/src/types/timeline.ts` が存在し、全型をエクスポート
  - [x] `client/src/api/timeline.ts` が存在し、3つのAPI関数をエクスポート
  - [x] `npx tsc --noEmit --project client/tsconfig.json` → 0 errors

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Client types compile without errors
    Tool: Bash
    Steps:
      1. npx tsc --noEmit --project client/tsconfig.json
    Expected Result: Exit code 0
    Evidence: .sisyphus/evidence/task-7-type-check.txt

  Scenario: API functions are importable
    Tool: Bash
    Steps:
      1. Create temp test file importing timelineApi
      2. npx tsc --noEmit --project client/tsconfig.json
    Expected Result: No import errors
    Evidence: .sisyphus/evidence/task-7-import-check.txt
  ```

  **Commit**: YES
  - Message: `feat(client): add TimelineEvent types and API client`
  - Files: `client/src/types/timeline.ts`, `client/src/api/timeline.ts`
  - Pre-commit: `npx tsc --noEmit --project client/tsconfig.json`

---

- [x] 8. TimelineEventCard コンポーネント (モバイルファースト、TDD)

  **What to do**:
  - `client/src/components/timeline/TimelineEventCard.tsx` を作成
  - TDD: `client/src/components/timeline/__tests__/TimelineEventCard.test.tsx`
  - 単一のタイムラインイベントをカード形式で表示:
    - 左アイコン（source別: 提案=↔️, コメント=💬, マッチ=🔍, アップロード=📦, 管理者=📢, 履歴=✅, 期限=⚠️）
    - タイトル + 本文 + 相対時間（「3時間前」「昨日」）
    - 優先度バッジ（Critical=赤, High=オレンジ, Medium=青, Low=グレー）
    - 未読状態の視覚的区別（背景色・ドット）
    - クリックで actionPath へナビゲート
  - モバイル: タッチターゲット十分なサイズ、AppMobileDataCardパターン参考
  - デスクトップ: コンパクトな行表示

  **Must NOT do**:
  - framer-motion等のアニメーションライブラリ追加禁止
  - Bootstrap以外のCSSフレームワーク追加禁止

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 9, 10, 11)
  - **Blocks**: Tasks 10, 13
  - **Blocked By**: Task 7 (types)

  **References**:
  - `client/src/components/ui/AppMobileDataCard.tsx` — モバイル向けカードの既存パターン
  - `client/src/components/ui/AppCard.tsx` — デスクトップ向けカードパターン
  - `client/src/components/ui/AppResponsiveSwitch.tsx` — モバイル/デスクトップ切り替え
  - `client/src/components/dashboard/DashboardNotices.tsx` — 既存の通知カードUI。スタイリング参考
  - `client/src/types/timeline.ts` — T7で定義するTimelineEvent型
  - `docs/medical-ui-design-language.md` — UIデザインランゲージ
  - `docs/generic-design-presets.md` — デザインプリセット（clinical-calm等）

  **Acceptance Criteria**:
  - [x] コンポーネントが source別アイコンを表示
  - [x] 優先度バッジが4色で表示
  - [x] 未読/既読の視覚的区別がある
  - [x] クリックで actionPath へ遷移
  - [x] AppResponsiveSwitch でモバイル/デスクトップ切り替え
  - [x] vitest テスト → 全PASS

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Event card renders with correct priority badge
    Tool: Playwright
    Steps:
      1. Render TimelineEventCard with priority='critical' mock
      2. Assert badge element has class containing 'danger' or red color
      3. Screenshot component
    Expected Result: Red priority badge visible
    Evidence: .sisyphus/evidence/task-8-priority-badge.png

  Scenario: Card navigates on click
    Tool: Playwright
    Steps:
      1. Render with actionPath='/proposals/1'
      2. Click the card
      3. Assert URL changed to /proposals/1
    Expected Result: Navigation to proposal detail page
    Evidence: .sisyphus/evidence/task-8-navigation.png
  ```

  **Commit**: YES
  - Message: `feat(client): add TimelineEventCard component with mobile-first design`
  - Files: `client/src/components/timeline/TimelineEventCard.tsx`, test file

---

- [x] 9. SmartDigest コンポーネント (TDD)

  **What to do**:
  - `client/src/components/timeline/SmartDigest.tsx` を作成
  - TDD: `client/src/components/timeline/__tests__/SmartDigest.test.tsx`
  - 「今日あなたがやるべきこと」カード:
    - Critical/High イベントを最大5件表示
    - 各アイテム: アイコン + 説明 + アクションボタン
    - 空状態: 「今日のタスクはありません 🎉」メッセージ
    - モバイル: スワイプ可能なカードリスト（タッチ操作最適化）
    - buildNextAction() のロジックを統合: アクションラベル + アクションパスをダイジェストアイテムに反映
  - Props: `{ items: SmartDigestItem[], loading: boolean }`

  **Must NOT do**:
  - buildNextAction() のロジック消失禁止（統合先で保全）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 13
  - **Blocked By**: Tasks 2 (priority engine), 7 (types)

  **References**:
  - `client/src/components/dashboard/types.ts:127-255` — buildNextAction() 関数。ロジックの理解と統合
  - `client/src/components/dashboard/DashboardNextAction.tsx` — 既存の「次のアクション」コンポーネント。スタイリング参考
  - `client/src/components/ui/AppEmptyState.tsx` — 空状態表示パターン
  - `client/src/components/ui/AppButton.tsx` — アクションボタンパターン

  **Acceptance Criteria**:
  - [x] Critical/Highイベントが優先度順で最大5件表示
  - [x] 空状態メッセージが表示される
  - [x] 各アイテムにアクションボタンがある
  - [x] vitest テスト → 全PASS

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Smart digest shows critical items first
    Tool: Playwright
    Steps:
      1. Render SmartDigest with 3 critical + 2 high items
      2. Assert first 3 items have critical styling
      3. Assert 4th/5th items have high styling
    Expected Result: Critical items rendered first with correct visual hierarchy
    Evidence: .sisyphus/evidence/task-9-smart-digest.png

  Scenario: Empty state renders correctly
    Tool: Playwright
    Steps:
      1. Render SmartDigest with items=[]
      2. Assert empty state message visible
    Expected Result: Celebration message displayed
    Evidence: .sisyphus/evidence/task-9-empty-state.png
  ```

  **Commit**: YES
  - Message: `feat(client): add SmartDigest component with priority display`
  - Files: `client/src/components/timeline/SmartDigest.tsx`, test file

---

- [x] 10. DashboardTimeline フィードコンポーネント (TDD)

  **What to do**:
  - `client/src/components/timeline/DashboardTimeline.tsx` を作成
  - TDD: `client/src/components/timeline/__tests__/DashboardTimeline.test.tsx`
  - 時系列フィード:
    - 日付グルーピング（「今日」「昨日」「2日前」「3/1」）
    - TimelineEventCard をリスト表示
    - 「もっと見る」ボタン（ページネーション）
    - ローディング/エラー/空状態
    - モバイル: フル幅カード、コンパクトな日付ヘッダー
  - Props: `{ events: TimelineEvent[], total: number, page: number, loading: boolean, onLoadMore: () => void }`

  **Must NOT do**:
  - 無限スクロール禁止（「もっと見る」ボタン方式）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 13
  - **Blocked By**: Tasks 5 (service), 7 (types), 8 (event card)

  **References**:
  - `client/src/components/dashboard/DashboardNotices.tsx` — 置換対象の既存コンポーネント。レイアウトとスタイリング参考
  - `client/src/components/Pagination.tsx` — 既存ページネーションコンポーネント
  - `client/src/components/ui/AppDataPanel.tsx` — データパネルラッパー
  - `client/src/hooks/useAsyncResource.ts` — データ取得フック

  **Acceptance Criteria**:
  - [x] 日付グルーピングが正しく表示
  - [x] 「もっと見る」で次ページ読み込み
  - [x] ローディング/エラー/空状態が正しく表示
  - [x] vitest テスト → 全PASS

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Timeline feed groups events by date
    Tool: Playwright
    Steps:
      1. Render with events from today and yesterday
      2. Assert date headers 'today' and 'yesterday' exist
      3. Assert events under correct headers
    Expected Result: Events grouped under date headers
    Evidence: .sisyphus/evidence/task-10-date-grouping.png

  Scenario: Load more button fetches next page
    Tool: Playwright
    Steps:
      1. Render with total=20, events showing first 10
      2. Click 'Load more' button
      3. Assert onLoadMore callback fired
    Expected Result: Load more triggers callback
    Evidence: .sisyphus/evidence/task-10-load-more.png
  ```

  **Commit**: YES
  - Message: `feat(client): add DashboardTimeline feed component`
  - Files: `client/src/components/timeline/DashboardTimeline.tsx`, test file

---

- [x] 11. ProposalTimeline ビジュアルコンポーネント (TDD)

  **What to do**:
  - `client/src/components/timeline/ProposalTimeline.tsx` を作成
  - TDD: `client/src/components/timeline/__tests__/ProposalTimeline.test.tsx`
  - 縦型タイムラインUI:
    - 左側に縦線 + ノード（● 完了 / ○ 未完了）
    - イベントタイプ別アイコン（status_change / comment / feedback / item_detail）
    - タイムスタンプ + アクター名 + ラベル
    - コメント本文のインラインプレビュー
    - フィードバック評価の星表示
    - 「次のステップ」インジケーター（現在の状態に応じたアクション提案）
    - モバイル: コンパクトな縦ライン、タッチ可能なノード
  - Props: `{ events: EnrichedProposalTimelineEvent[], currentPharmacyId: number }`

  **Must NOT do**:
  - 既存のコメントセクションUIの破壊禁止

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 4 (data enrichment), 7 (types)

  **References**:
  - `client/src/pages/ProposalDetailPage.tsx` — 既存の提案詳細ページ。タイムラインの現在の表示方法とレイアウト
  - `client/src/components/timeline/TimelineEventCard.tsx` — T8で作成するカードコンポーネント（スタイル統一）
  - `docs/medical-ui-design-language.md` — 医療UIデザインランゲージ

  **Acceptance Criteria**:
  - [x] 縦型タイムラインがノード+縦線で表示
  - [x] イベントタイプ別アイコンが表示
  - [x] コメントプレビューがインライン表示
  - [x] 「次のステップ」インジケーターが表示
  - [x] vitest テスト → 全PASS

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Vertical timeline renders all events
    Tool: Playwright
    Steps:
      1. Render with 5 enriched timeline events
      2. Assert 5 nodes on vertical line
      3. Assert each node has icon, timestamp, label
    Expected Result: 5 nodes visible with correct data
    Evidence: .sisyphus/evidence/task-11-proposal-timeline.png

  Scenario: Comment preview shows inline
    Tool: Playwright
    Steps:
      1. Render with event of eventType='comment' and commentBody='Test'
      2. Assert comment body preview is visible
    Expected Result: Comment text displayed inline
    Evidence: .sisyphus/evidence/task-11-comment-preview.png
  ```

  **Commit**: YES
  - Message: `feat(client): add ProposalTimeline visual component`
  - Files: `client/src/components/timeline/ProposalTimeline.tsx`, test file

---

- [x] 12. TimelineContext (NotificationContext 置換、TDD)

  **What to do**:
  - `client/src/contexts/TimelineContext.tsx` を新規作成
  - TDD: `client/src/contexts/__tests__/TimelineContext.test.tsx`
  - NotificationContext の上位互換として以下を提供:
    - `unreadCount: number` — タイムライン未読件数（`/api/timeline/unread-count` から取得）
    - `digestItems: SmartDigestItem[]` — Critical/High の上位5件（`/api/timeline?priority=critical,high&limit=5` から取得）
    - `events: TimelineEvent[]` — フィード用イベント一覧（`/api/timeline?page=N` から取得）
    - `totalEvents: number` — イベント総数
    - `page: number` — 現在のページ
    - `loading: boolean` — 読み込み状態
    - `refreshTimeline: () => Promise<void>` — 手動リフレッシュ
    - `loadMore: () => Promise<void>` — 次ページ読み込み
    - `markViewed: () => Promise<void>` — 閲覧済みマーク（PATCH /api/timeline/mark-viewed）
  - ポーリング: 30秒間隔 + visibilitychange イベント（既存パターン踏襲）
  - `useTimeline()` カスタムフック export
  - **既存 `useNotifications()` フックは残す**: TimelineContext 内で `unreadCount` を返す互換レイヤーとして `useNotifications` を re-export（移行期の安全策）

  **Must NOT do**:
  - WebSocket やリアルタイム通信の追加禁止
  - 既存 NotificationContext.tsx を直接編集しない（新ファイルで置換）
  - ポーリング間隔を 30 秒未満にしない

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Context + hooks + polling + state management が複雑に絡むため deep が適切
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (Sequential — Task 12 first, then 13-15 in parallel)
  - **Blocks**: Tasks 13, 14, 15
  - **Blocked By**: Tasks 5 (timeline service), 6 (API routes), 7 (client types)

  **References**:

  **Pattern References** (existing code to follow):
  - `client/src/contexts/NotificationContext.tsx` — 完全なコードを参照。ポーリング30秒、visibilitychange、useCallback/useRef パターンをそのまま踏襲。68行の小さなファイルなので全体を理解してから着手
  - `client/src/contexts/AuthContext.tsx` — Context + Provider + useXxx() フックのエクスポートパターン

  **API/Type References** (contracts to implement against):
  - `client/src/api/timeline.ts` — T7 で作成する API クライアント関数群。getTimeline / getUnreadCount / markTimelineAsRead を使用
  - `client/src/types/timeline.ts` — T7 で定義する TimelineEvent, SmartDigestItem 型

  **Test References** (testing patterns to follow):
  - `client/src/contexts/__tests__/` — 既存の Context テストパターンがあれば参照（なければ vitest + @testing-library/react の renderHook パターンで新規）

  **WHY Each Reference Matters**:
  - NotificationContext.tsx: ポーリングロジック（setInterval + clearInterval + visibilitychange）を正確に再現するため。fetchCount のエラーハンドリング（ベストエフォート）パターンも継承
  - AuthContext.tsx: Provider ラッピングと useXxx() フックの export パターンの統一
  - timeline API client: Context が呼ぶ具体的な関数シグネチャの確認

  **Acceptance Criteria**:
  - [x] TimelineProvider が unreadCount / digestItems / events / loading / refreshTimeline / loadMore / markViewed を提供
  - [x] 30秒ポーリング + visibilitychange で自動更新
  - [x] useTimeline() フックが正常に動作
  - [x] useNotifications() 互換フックが unreadCount を返す
  - [x] vitest テスト → 全PASS

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: TimelineContext provides unread count
    Tool: Bash
    Preconditions: TimelineContext.tsx と test ファイルが存在
    Steps:
      1. npx vitest run client/src/contexts/__tests__/TimelineContext.test.tsx
      2. Assert exit code 0
    Expected Result: All tests pass including unreadCount polling test
    Failure Indicators: Test failures, import errors, type errors
    Evidence: .sisyphus/evidence/task-12-context-test.txt

  Scenario: useNotifications compatibility hook works
    Tool: Bash
    Steps:
      1. Create temp test importing useNotifications from TimelineContext
      2. Assert it returns { unreadCount, refreshCount } shape
      3. npx tsc --noEmit --project client/tsconfig.json
    Expected Result: No type errors, backward compatible
    Evidence: .sisyphus/evidence/task-12-compat-check.txt

  Scenario: Polling respects visibility state
    Tool: Bash
    Steps:
      1. Run specific vitest test case for visibility-based polling
      2. Assert fetchCount is NOT called when document is hidden
    Expected Result: Polling pauses when tab is hidden
    Evidence: .sisyphus/evidence/task-12-visibility-test.txt
  ```

  **Commit**: YES
  - Message: `feat(client): add TimelineContext replacing NotificationContext`
  - Files: `client/src/contexts/TimelineContext.tsx`, `client/src/contexts/__tests__/TimelineContext.test.tsx`
  - Pre-commit: `npx vitest run client/src/contexts/__tests__/TimelineContext.test.tsx && npx tsc --noEmit --project client/tsconfig.json`

---

- [x] 13. DashboardPage 統合 (DashboardNotices + DashboardNextAction 置換)

  **What to do**:
  - `client/src/pages/DashboardPage.tsx` を編集:
    - `import DashboardNotices` を削除 → `import DashboardTimeline` に置換
    - `import DashboardNextAction` を削除 → `import SmartDigest` に置換
    - `import { useNotifications }` を `import { useTimeline }` に置換
    - `import { buildNextAction, ... }` の引用を削除（buildNextAction は SmartDigest 内部で処理済み）
    - `useTimeline()` から `digestItems, events, totalEvents, page, loading, loadMore, refreshTimeline` を取得
    - 既存の `notifications` state と `fetchDashboardData` 内の `/notifications` API 呼び出しを削除
    - `<DashboardNotices ... />` を `<SmartDigest items={digestItems} loading={loading} />` に置換
    - `<DashboardNextAction ... />` を `<DashboardTimeline events={events} total={totalEvents} page={page} loading={loading} onLoadMore={loadMore} />` に置換
    - handleNoticeClick ロジックは不要（TimelineEventCard の onClick で内部処理）
    - `onRefresh` / `onRetry` は `refreshTimeline` に変更
  - `status` と `risk` の API 取得はそのまま維持（タイムラインとは独立）
  - DashboardStatusCards と期限切れリスクパネルはそのまま維持

  **Must NOT do**:
  - DashboardStatusCards / 期限リスクパネルの変更禁止
  - `/upload/status` や `/inventory/dead-stock/risk` API の削除禁止
  - DashboardNotices.tsx / DashboardNextAction.tsx ファイル自体の削除禁止（将来のクリーンアップで対応）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 既存ページのリファクタリングで、影響範囲を正確に把握する必要がある
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 14, 15 — after Task 12 completes)
  - **Blocks**: None (F1-F4 verification only)
  - **Blocked By**: Tasks 8 (event card), 9 (smart digest), 10 (dashboard timeline), 12 (context)

  **References**:

  **Pattern References** (existing code to follow):
  - `client/src/pages/DashboardPage.tsx` — 編集対象ファイル。179行。現在の import 構成、fetchDashboardData の Promise.allSettled パターン、DashboardNotices/DashboardNextAction の JSX 配置を理解してから編集
  - `client/src/components/dashboard/DashboardNotices.tsx` — 置換元の Props 構造を理解（notifications, loadingNotifications, dashboardError, onNoticeClick, onRetry, onRefresh）
  - `client/src/components/dashboard/DashboardNextAction.tsx` — 置換元の Props 構造（nextAction）

  **API/Type References** (contracts to implement against):
  - `client/src/contexts/TimelineContext.tsx` — T12 で作成する useTimeline() の戻り値型
  - `client/src/components/timeline/SmartDigest.tsx` — T9 で作成する SmartDigest の Props
  - `client/src/components/timeline/DashboardTimeline.tsx` — T10 で作成する DashboardTimeline の Props

  **WHY Each Reference Matters**:
  - DashboardPage.tsx: 編集対象。特に L4 (useNotifications import), L14-15 (DashboardNextAction/DashboardNotices import), L55 (refreshCount), L61-89 (fetchDashboardData), L100 (buildNextAction), L144-153 (JSX) が変更箇所
  - DashboardNotices/NextAction: Props の型を正確に把握し、新コンポーネントで同等のデータが流れることを確認

  **Acceptance Criteria**:
  - [x] DashboardPage が SmartDigest + DashboardTimeline をレンダリング
  - [x] DashboardNotices / DashboardNextAction の import がない
  - [x] buildNextAction の import がない
  - [x] useTimeline() からデータ取得
  - [x] status / risk API 取得はそのまま動作
  - [x] npx tsc --noEmit → 0 errors

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Dashboard renders SmartDigest and Timeline
    Tool: Playwright
    Preconditions: Dev server running, logged in as pharmacy user with notifications
    Steps:
      1. Navigate to / (dashboard)
      2. Wait for page load (timeout: 10s)
      3. Assert element with text '今日あなたがやるべきこと' OR '今日のタスクはありません' exists (SmartDigest)
      4. Assert DashboardTimeline feed container exists
      5. Assert old DashboardNotices component is NOT rendered (no element with old notification list structure)
      6. Screenshot full page
    Expected Result: SmartDigest visible at top, timeline feed below, no old notification components
    Failure Indicators: Old notification list visible, SmartDigest missing, console errors
    Evidence: .sisyphus/evidence/task-13-dashboard-integration.png

  Scenario: Dashboard risk panel still works
    Tool: Playwright
    Preconditions: Dev server running, logged in, dead stock items uploaded
    Steps:
      1. Navigate to /
      2. Assert '期限切れリスク' panel is visible
      3. Assert KPI cards show numeric values
    Expected Result: Risk panel renders independently of timeline
    Failure Indicators: Risk panel missing, API error displayed
    Evidence: .sisyphus/evidence/task-13-risk-panel.png

  Scenario: Type check passes after refactor
    Tool: Bash
    Steps:
      1. npx tsc --noEmit --project client/tsconfig.json
    Expected Result: Exit code 0, no type errors
    Failure Indicators: Type mismatch from removed imports
    Evidence: .sisyphus/evidence/task-13-typecheck.txt
  ```

  **Commit**: YES
  - Message: `feat(client): integrate SmartDigest and DashboardTimeline into DashboardPage`
  - Files: `client/src/pages/DashboardPage.tsx`
  - Pre-commit: `npx tsc --noEmit --project client/tsconfig.json`

---

- [x] 14. ProposalDetailPage 統合 (ProposalTimeline 組み込み)

  **What to do**:
  - `client/src/pages/ProposalDetailPage.tsx` を編集:
    - `import ProposalTimeline` を追加（T11 で作成済み）
    - 既存の「進行履歴」セクション（L364-393）を `<ProposalTimeline>` コンポーネントに置換:
      - 既存の `filteredTimeline` ロジック（L310-314）は ProposalTimeline コンポーネント内部で処理
      - 既存の `timelineFilter` state （L114）は ProposalTimeline に移動するか、props として渡す
      - `<ul>` リスト表示 → 縦型ビジュアルタイムラインにアップグレード
    - API データ強化: `/exchange/proposals/:id` のレスポンスに T4 で追加した enriched timeline データを受け取る
    - `ProposalTimelineEvent` インターフェイスを `EnrichedProposalTimelineEvent`（T4 で定義）に更新
    - 既存の AppSelect フィルターは ProposalTimeline 内に統合（外部からは削除）

  **Must NOT do**:
  - コメントセクションの UI 変更禁止（タイムラインとコメントは別セクション）
  - 提案アクションボタン（承認/拒否/完了）の変更禁止
  - フィードバックセクションの変更禁止
  - ProposalItemsPanel の変更禁止

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: 縦型ビジュアルタイムライン UI の組み込みが主な作業
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 13, 15 — after Task 12 completes)
  - **Blocks**: None (F1-F4 verification only)
  - **Blocked By**: Tasks 4 (data enrichment), 11 (ProposalTimeline component), 12 (context)

  **References**:

  **Pattern References** (existing code to follow):
  - `client/src/pages/ProposalDetailPage.tsx` — 編集対象ファイル。607行。特に L37-45 (ProposalTimelineEvent 型定義), L114 (timelineFilter state), L310-314 (filteredTimeline ロジック), L364-393 (既存の進行履歴セクションの JSX) が変更箇所
  - `client/src/components/timeline/ProposalTimeline.tsx` — T11 で作成するコンポーネント。Props を確認して正しく渡す

  **API/Type References** (contracts to implement against):
  - `server/src/types/timeline.ts` — T4 で定義する EnrichedProposalTimelineEvent 型
  - `client/src/types/timeline.ts` — T7 で定義するクライアント側の型定義

  **WHY Each Reference Matters**:
  - ProposalDetailPage.tsx: 607行の大きなファイルなので、変更箇所を正確に把握するため。特に「進行履歴」セクション (L364-393) を ProposalTimeline に置き換える範囲を明確に
  - ProposalTimeline.tsx: Props 型を確認して、data.timeline から正しくマッピングして渡す

  **Acceptance Criteria**:
  - [x] ProposalDetailPage が ProposalTimeline コンポーネントをレンダリング
  - [x] 旧「進行履歴」の `<ul>` リスト表示が縦型タイムライン UI に置換
  - [x] タイムラインフィルターが ProposalTimeline 内部で動作
  - [x] コメント・フィードバック・アクションボタンが変更なく動作
  - [x] npx tsc --noEmit → 0 errors

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Proposal detail shows visual timeline
    Tool: Playwright
    Preconditions: Dev server running, logged in, at least one proposal exists with timeline events
    Steps:
      1. Navigate to /proposals/{existing-proposal-id}
      2. Wait for page load (timeout: 10s)
      3. Assert vertical timeline container exists (look for timeline-specific CSS class)
      4. Assert timeline nodes with icons are visible
      5. Assert old `<ul class="mb-0 ps-3">` list is NOT present
      6. Screenshot the timeline section
    Expected Result: Visual vertical timeline with nodes, icons, and timestamps
    Failure Indicators: Old bullet list still visible, timeline component not rendering
    Evidence: .sisyphus/evidence/task-14-proposal-timeline.png

  Scenario: Timeline filter works inside ProposalTimeline
    Tool: Playwright
    Preconditions: Proposal with mixed timeline events (status changes + comments)
    Steps:
      1. Navigate to /proposals/{id}
      2. Find filter dropdown inside timeline section
      3. Select '承認/拒否/完了のみ' filter
      4. Assert only decision events are shown
      5. Select 'すべて表示' filter
      6. Assert all events are shown again
    Expected Result: Filter toggles event visibility correctly
    Evidence: .sisyphus/evidence/task-14-timeline-filter.png

  Scenario: Comment section remains unchanged
    Tool: Playwright
    Preconditions: Proposal with existing comments
    Steps:
      1. Navigate to /proposals/{id}
      2. Scroll to '交渉メモ / コメント' section
      3. Assert comment list is visible
      4. Assert comment input textarea exists
      5. Assert '定型文1' button exists
    Expected Result: Comment section completely unchanged from before
    Failure Indicators: Comment section missing, template buttons gone
    Evidence: .sisyphus/evidence/task-14-comments-unchanged.png
  ```

  **Commit**: YES
  - Message: `feat(client): integrate ProposalTimeline into ProposalDetailPage`
  - Files: `client/src/pages/ProposalDetailPage.tsx`
  - Pre-commit: `npx tsc --noEmit --project client/tsconfig.json`

---

- [x] 15. Header バッジ切り替え + App.tsx Provider 置換

  **What to do**:
  - `client/src/App.tsx` を編集:
    - `import { NotificationProvider }` (L4) を `import { TimelineProvider }` に置換
    - `<NotificationProvider>` (L79-81) を `<TimelineProvider>` に置換
  - `client/src/components/Header.tsx` を編集:
    - `import { useNotifications }` (L7) を `import { useTimeline }` に置換
    - `const { unreadCount } = useNotifications()` (L60) を `const { unreadCount } = useTimeline()` に置換
    - バッジのクリック先を `/` (ダッシュボード) のまま維持（L220）
    - バッジの `title` を `${unreadCount}件の未読通知` から `${unreadCount}件の未読` に変更（タイムラインは「通知」より広い概念）
  - 既存の `/api/notifications` エンドポイントは削除しない（後方互換）
  - 既存の `NotificationContext.tsx` ファイルは削除しない（他コンポーネントがまだ参照している可能性）

  **Must NOT do**:
  - サーバー側の notification ルート削除禁止（後方互換維持）
  - NotificationContext.tsx ファイルの削除禁止
  - Header のクイックアクションボタンやリクエストモーダルの変更禁止
  - GitHub アップデートポップオーバーの変更禁止

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 2ファイルの小規模 import 置換が主な作業
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 13, 14 — after Task 12 completes)
  - **Blocks**: None (F1-F4 verification only)
  - **Blocked By**: Task 12 (TimelineContext)

  **References**:

  **Pattern References** (existing code to follow):
  - `client/src/App.tsx` — 編集対象。84行の小さなファイル。L4 (NotificationProvider import), L79-81 (NotificationProvider JSX) を TimelineProvider に置換
  - `client/src/components/Header.tsx` — 編集対象。261行。L7 (useNotifications import), L60 (unreadCount 取得), L214-224 (Badge JSX) が変更箇所

  **API/Type References** (contracts to implement against):
  - `client/src/contexts/TimelineContext.tsx` — T12 で作成する TimelineProvider と useTimeline()

  **WHY Each Reference Matters**:
  - App.tsx: Provider のラップ構造が AuthProvider > NotificationProvider > AppRoutes なので、同じ階層に TimelineProvider を置く
  - Header.tsx: Badge の unreadCount 取得元を useNotifications → useTimeline に切り替えるだけ。それ以外の Header ロジックは一切変更しない

  **Acceptance Criteria**:
  - [x] App.tsx が TimelineProvider を使用
  - [x] Header.tsx が useTimeline() から unreadCount を取得
  - [x] バッジがタイムライン未読数を表示
  - [x] 既存の /api/notifications エンドポイントがまだ動作
  - [x] npx tsc --noEmit → 0 errors (server + client)

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Header badge shows timeline unread count
    Tool: Playwright
    Preconditions: Dev server running, logged in as pharmacy user with unread timeline events
    Steps:
      1. Navigate to /
      2. Wait for page load (timeout: 10s)
      3. Find Badge element with class 'badge' in header
      4. Assert badge displays a number > 0
      5. Assert badge title contains '未読'
      6. Screenshot header area
    Expected Result: Badge shows unread count from timeline API
    Failure Indicators: Badge shows 0, badge missing, console errors about useNotifications
    Evidence: .sisyphus/evidence/task-15-header-badge.png

  Scenario: Admin user does not see badge
    Tool: Playwright
    Preconditions: Dev server running, logged in as admin user
    Steps:
      1. Navigate to /admin
      2. Assert Badge element is NOT visible in header
    Expected Result: No notification badge for admin (existing behavior preserved)
    Evidence: .sisyphus/evidence/task-15-admin-no-badge.png

  Scenario: Old notification endpoint still responds
    Tool: Bash (curl)
    Preconditions: Dev server running
    Steps:
      1. curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/notifications -H 'Authorization: Bearer {test-token}'
      2. Assert HTTP status is 200 (not 404)
    Expected Result: Old endpoint still functional for backward compatibility
    Failure Indicators: 404 response, route not found
    Evidence: .sisyphus/evidence/task-15-old-endpoint.txt

  Scenario: Type check passes for both App.tsx and Header.tsx
    Tool: Bash
    Steps:
      1. npx tsc --noEmit --project client/tsconfig.json
    Expected Result: Exit code 0, no type errors from import changes
    Failure Indicators: Cannot find module errors, type mismatches
    Evidence: .sisyphus/evidence/task-15-typecheck.txt
  ```

  **Commit**: YES
  - Message: `feat(client): rewire Header badge and App provider to TimelineContext`
  - Files: `client/src/App.tsx`, `client/src/components/Header.tsx`
  - Pre-commit: `npx tsc --noEmit --project client/tsconfig.json`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npx tsc --noEmit` (server + client) + `npm run test` (both workspaces). Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start dev server. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (dashboard timeline + badge + proposal timeline working together). Test edge cases: empty state, many events, rapid actions. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built, nothing beyond spec. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **T1**: `feat(db): add lastTimelineViewedAt column to pharmacies` — schema.ts, migration
- **T2**: `feat(server): add timeline priority engine with TDD` — timeline-priority-engine.ts, test
- **T3**: `feat(server): add timeline aggregator helpers with TDD` — timeline-aggregators.ts, test
- **T4**: `feat(server): enrich proposal timeline data with TDD` — exchange-proposals.ts, test
- **T5**: `feat(server): add timeline-service with parallel query merge` — timeline-service.ts, test
- **T6**: `feat(server): add timeline API routes with TDD` — routes/timeline.ts, test
- **T7**: `feat(client): add shared TimelineEvent type definitions` — types/timeline.ts
- **T8**: `feat(client): add TimelineEventCard component with TDD` — TimelineEventCard.tsx, test
- **T9**: `feat(client): add SmartDigest component with TDD` — SmartDigest.tsx, test
- **T10**: `feat(client): add DashboardTimeline feed component with TDD` — DashboardTimeline.tsx, test
- **T11**: `feat(client): add ProposalTimeline visual component with TDD` — ProposalTimeline.tsx, test
- **T12**: `feat(client): add TimelineContext replacing NotificationContext` — TimelineContext.tsx, test
- **T13**: `feat(client): integrate timeline into DashboardPage` — DashboardPage.tsx
- **T14**: `feat(client): integrate ProposalTimeline into ProposalDetailPage` — ProposalDetailPage.tsx
- **T15**: `feat(client): rewire header badge to TimelineContext` — Header.tsx, App.tsx

---

## Success Criteria

### Verification Commands
```bash
npm run test --workspace=server   # Expected: all pass (320+ existing + new timeline tests)
npm run test --workspace=client   # Expected: all pass (114+ existing + new component tests)
npx tsc --noEmit --project server/tsconfig.json  # Expected: 0 errors
npx tsc --noEmit --project client/tsconfig.json  # Expected: 0 errors
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] All tests pass
- [x] Dashboard: SmartDigest + Timeline feed rendering correctly
- [x] ProposalDetailPage: Visual timeline with all events
- [x] Header: Badge shows timeline unread count
- [x] Mobile: All components responsive at <992px
- [x] Old notification endpoints still functional (backward compat)
