# グループ管理 + アラートUI統合 + フルPWA

## TL;DR

> **Quick Summary**: 薬剤師会/グループ管理（ハイブリッド型）、期限切れアラートのフロントエンド統合、フルPWA化（オフライン対応・プッシュ通知・モバイル専用ナビ）の3機能を実装する。
> 
> **Deliverables**:
> - グループCRUD + 招待/参加ワークフロー + グループ内マッチングボーナス
> - アラート一覧/詳細ページ + ダッシュボードウィジェット + プッシュ通知連携
> - PWAマニフェスト + Service Worker + オフラインフォールバック + Web Push基盤 + モバイル専用ナビ + インストール促進
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 5 waves
> **Critical Path**: Task 1 → Task 9 → Task 15 → Task 22 → Task 25 → F1-F4

---

## Context

### Original Request
分析モードでコードベースと業界ベストプラクティスを調査後、ユーザーが3つの開発候補を選択：
- ② 薬剤師会/グループ管理
- ⑥ 期限切れ予測アラートのUI統合
- ⑩ モバイルPWA最適化

### Interview Summary
**Key Discussions**:
- ②グループ性質: ハイブリッド型（公開/招待制をグループごとに選択可能）
- ②マッチング連携: グループ内優先（favoriteBonus +15ptと同様のgroupBonusを付与）
- ②権限: 誰でもグループ作成可能、複数グループ所属可能
- ⑥アラート: バックエンドはpredictive-alert-service/expiry-risk-serviceが実装済み。ただしAlert read API (GET/PATCH) は未実装
- ⑩PWA: フルPWA（manifest, SW, offline, install promotion, mobile nav）
- ⑩プッシュ通知: Web Push API (VAPID) バックエンド含む。⑥アラートと連携
- テスト: TDD (RED-GREEN-REFACTOR)。既存vitest 4環境を活用

**Research Findings**:
- 競合e-STockは薬剤師会単位のクローズド環境。メドシェアは複数グループ所属可能
- pharmacyRelationships テーブル (favorite/blocked) がグループのパターン基盤
- matching-score-service.ts L358-392 の favoriteBonus パターンを groupBonus に踏襲
- predictiveAlerts テーブルは dedupeKey + notificationId 連携済み
- 現在PWA関連インフラは一切なし（manifest, SW, push 全て未設置）
- AppResponsiveSwitch (991.98px) + AppMobileDataCard パターンが既存

### Metis Review
**Identified Gaps** (addressed):
- Alert read API (GET /api/alerts, PATCH resolve) が存在しない → Wave 2で実装
- iOS 17.4+ EU DMAでWeb Push無効化 → PushManager feature detection必須
- iOS Safari キャッシュ上限~50MB → Workbox expiration設定を保守的に
- registerType: 'autoUpdate'はセッション中断リスク → 'prompt'を使用しSW更新バナー実装
- Vercel Function 60秒タイムアウト → push dispatch を Promise.allSettled + pharmacy単位チャンク
- Background Syncは iOS/Safari非対応 → スコープから除外
- オフラインデータ変更は v1では対象外 → フォールバックページのみ
- グループ管理のAdmin UIはv1では対象外 → セルフサービスのみ

---

## Work Objectives

### Core Objective
薬局間連携を強化するグループ機能、在庫リスクの可視化を進めるアラートUI、利用シーンを拡大するフルPWA化の3機能を、既存アーキテクチャに整合させて実装する。

### Concrete Deliverables
- **DB**: pharmacyGroups, groupMembers, pushSubscriptions テーブル
- **Backend API**: グループCRUD, アラート一覧/詳細/解決, プッシュ購読管理, プッシュ送信
- **Frontend Pages**: グループ一覧, グループ詳細, アラート一覧, アラート詳細モーダル
- **Frontend Components**: グループ招待/参加UI, アラートダッシュボードウィジェット, プッシュ通知許可UI, SW更新バナー, インストール促進バナー, モバイルボトムナビ, オフラインフォールバック
- **PWA**: manifest.json, Service Worker (injectManifest), アプリアイコン一式
- **Matching**: groupBonus パラメータ追加 (matchingRuleProfiles)

### Definition of Done
- [ ] `npm run typecheck` — PASS (0 errors)
- [ ] `npm run test` — PASS (全テスト通過、カバレッジ95%以上維持)
- [ ] `npm run build:client && npm run build:server` — PASS
- [ ] Lighthouse PWA audit score ≥ 80
- [ ] グループ作成→招待→参加→マッチングボーナス適用の一連フロー動作確認
- [ ] アラート一覧表示→詳細表示→解決マーク→プッシュ通知受信の一連フロー動作確認
- [ ] モバイルブラウザからPWAインストール→オフラインフォールバック表示確認

### Must Have
- グループのハイブリッド型（公開/招待制の切替）
- グループ内マッチングボーナス（matchingRuleProfilesで設定可能）
- アラート一覧・詳細の専用ページ（DashboardPageの拡張ではなく独立ページ）
- ダッシュボードへのアラートウィジェット追加
- manifest.json + Service Worker + オフラインフォールバック
- Web Push API (VAPID) によるプッシュ通知基盤
- モバイル専用ボトムナビゲーション
- PushManager feature detection（iOS EU DMA対応）
- SW registerType: 'prompt' + 更新バナーUI

### Must NOT Have (Guardrails)
- ❌ Background Sync（iOS/Safari非対応のため除外）
- ❌ オフラインでのデータ変更（v1ではフォールバックページのみ）
- ❌ Admin画面でのグループ管理（v1はセルフサービスのみ）
- ❌ アラート閾値のUI設定（管理者/env-varのみ）
- ❌ registerType: 'autoUpdate'（セッション中断リスク）
- ❌ /api/auth/* のSWキャッシュ（セキュリティリスク）
- ❌ 大容量ペイロード（Excel, マッチング結果セット）のSWキャッシュ
- ❌ 1回のVercel Functionで全購読者へpush送信（60秒タイムアウト）
- ❌ AI slop: 過剰なJSDoc、過度な抽象化、汎用名 (data/result/item/temp)
- ❌ `as any` / `@ts-ignore` / 空のcatchブロック / console.logの本番残し

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
- **PWA**: Use Lighthouse CLI — Audit PWA score
- **Mobile**: Use Playwright with mobile viewport emulation

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — schema + types + config, all parallel):
├── Task 1:  DB schema: pharmacyGroups + groupMembers [quick]
├── Task 2:  DB schema: pushSubscriptions [quick]
├── Task 3:  Shared types: group interfaces + enums [quick]
├── Task 4:  Shared types: push + alert interfaces [quick]
├── Task 5:  PWA scaffold: manifest.json + icons + meta tags [quick]
├── Task 6:  vite-plugin-pwa configuration + SW shell [quick]
└── Task 7:  Notification enum extension (group + alert types) [quick]

Wave 2 (Backend Services — core business logic, MAX PARALLEL):
├── Task 8:  Group service: CRUD + membership + invitation [deep]
├── Task 9:  Group routes: REST API endpoints [unspecified-high]
├── Task 10: Alert read/resolve API service + routes [unspecified-high]
├── Task 11: Matching score extension: groupBonus [deep]
├── Task 12: Push subscription service (VAPID + subscribe/unsubscribe) [unspecified-high]
├── Task 13: Push dispatch service (send + 410 cleanup) [unspecified-high]
└── Task 14: Service Worker: caching strategy + offline fallback [deep]

Wave 3 (Frontend — UI pages + components, MAX PARALLEL):
├── Task 15: Group list page + group creation modal [visual-engineering]
├── Task 16: Group detail/management page [visual-engineering]
├── Task 17: Alert list page + alert detail modal [visual-engineering]
├── Task 18: Dashboard alert widget (DashboardPage extension) [visual-engineering]
├── Task 19: Push notification permission UI + settings [visual-engineering]
├── Task 20: Mobile bottom navigation [visual-engineering]
├── Task 21: SW update banner + install promotion [visual-engineering]
└── Task 22: Route config + lazy loading for new pages [quick]

Wave 4 (Integration — cross-feature connections):
├── Task 23: Group-aware PharmacyListPage extension [unspecified-high]
├── Task 24: Alert → Push notification linkage [deep]
├── Task 25: Mobile responsive audit (all new pages) [visual-engineering]
└── Task 26: Lighthouse PWA audit gate [quick]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 8/9 → Task 15/16 → Task 23 → F1-F4
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 7 (Waves 1, 2, 3)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | — | 8, 9, 11 |
| 2 | — | 12, 13 |
| 3 | — | 8, 9, 15, 16 |
| 4 | — | 10, 12, 13, 19 |
| 5 | — | 6, 14, 21 |
| 6 | 5 | 14, 21, 26 |
| 7 | — | 8, 10, 13, 24 |
| 8 | 1, 3, 7 | 15, 16, 23 |
| 9 | 1, 3, 7 | 15, 16, 23 |
| 10 | 4, 7 | 17, 18, 24 |
| 11 | 1, 3 | 23 |
| 12 | 2, 4 | 19, 24 |
| 13 | 2, 4, 7 | 24 |
| 14 | 6 | 21, 25, 26 |
| 15 | 8, 9, 3 | 23, 25 |
| 16 | 8, 9, 3 | 23, 25 |
| 17 | 10, 4 | 24, 25 |
| 18 | 10 | 25 |
| 19 | 12, 4 | 24, 25 |
| 20 | — | 25 |
| 21 | 6, 14 | 25, 26 |
| 22 | — | 25 |
| 23 | 8, 9, 11, 15, 16 | F1-F4 |
| 24 | 10, 12, 13, 17, 19, 7 | F1-F4 |
| 25 | 15-22 | F1-F4 |
| 26 | 6, 14, 21 | F1-F4 |

### Agent Dispatch Summary

| Wave | Tasks | Dispatch |
|------|-------|----------|
| 1 | 7 | T1-T4 → `quick`, T5-T6 → `quick`, T7 → `quick` |
| 2 | 7 | T8 → `deep`, T9 → `unspecified-high`, T10 → `unspecified-high`, T11 → `deep`, T12 → `unspecified-high`, T13 → `unspecified-high`, T14 → `deep` |
| 3 | 8 | T15-T21 → `visual-engineering`, T22 → `quick` |
| 4 | 4 | T23 → `unspecified-high`, T24 → `deep`, T25 → `visual-engineering`, T26 → `quick` |
| FINAL | 4 | F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep` |

---

## TODOs

### Wave 1: Foundation (all parallel)

- [ ] 1. DB schema: pharmacyGroups + groupMembers テーブル

  **What to do**:
  - `server/src/db/schema.ts` に `pharmacyGroups` テーブルを追加（id, name, description, visibility: 'public'|'invite_only', ownerPharmacyId, createdAt, updatedAt）
  - `groupMembers` テーブルを追加（id, groupId, pharmacyId, role: 'owner'|'admin'|'member', joinedAt）
  - `pharmacyGroupVisibilityEnum` と `groupMemberRoleEnum` を定義
  - FK制約: ownerPharmacyId→pharmacies, groupId→pharmacyGroups, pharmacyId→pharmacies（CASCADE DELETE）
  - Unique制約: (groupId, pharmacyId) で重複所属防止
  - インデックス: groupId, pharmacyId, ownerPharmacyId
  - `matchingRuleProfiles` テーブルに `groupBonus` カラム追加（integer, default 10, CHECK 0-50）
  - Drizzle migration を生成: `cd server && npx drizzle-kit generate`
  - テスト: schema定義の型チェックが通ることを確認

  **Must NOT do**:
  - pharmacyGroups に admin-only フィールドを追加しない
  - 既存テーブルの既存カラムを変更しない

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-7)
  - **Blocks**: Tasks 8, 9, 11
  - **Blocked By**: None

  **References**:
  - `server/src/db/schema.ts:594-606` — pharmacyRelationships テーブル（FK + unique constraint パターン）
  - `server/src/db/schema.ts:470-520` — matchingRuleProfiles テーブル（既存パラメータ構造）
  - `server/src/db/schema.ts:20-30` — enum定義パターン（pgEnum）

  **Acceptance Criteria**:
  - [ ] `npm run typecheck` → PASS
  - [ ] `cd server && npx drizzle-kit generate` → migration生成成功
  - [ ] pharmacyGroups, groupMembers テーブルが schema.ts に存在
  - [ ] matchingRuleProfiles に groupBonus カラムが存在

  ```
  Scenario: Schema type check passes
    Tool: Bash
    Steps:
      1. Run `npm run typecheck`
      2. Assert exit code 0
    Expected Result: No type errors
    Evidence: .sisyphus/evidence/task-1-typecheck.txt
  ```

  **Commit**: YES
  - Message: `feat(schema): add pharmacyGroups, groupMembers tables and groupBonus column`
  - Files: `server/src/db/schema.ts`, `server/src/db/migrations/*`
  - Pre-commit: `npm run typecheck`

- [ ] 2. DB schema: pushSubscriptions テーブル

  **What to do**:
  - `server/src/db/schema.ts` に `pushSubscriptions` テーブルを追加（id, pharmacyId FK, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, userAgent TEXT, createdAt, lastUsedAt）
  - Unique制約: (pharmacyId, endpoint) で重複購読防止
  - インデックス: pharmacyId, endpoint
  - 環境変数ドキュメント: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` を README.md に追記
  - Drizzle migration を生成
  - テスト: schema定義の型チェック

  **Must NOT do**:
  - VAPID鍵の生成ロジックは含めない（Task 12で実装）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3-7)
  - **Blocks**: Tasks 12, 13
  - **Blocked By**: None

  **References**:
  - `server/src/db/schema.ts:594-606` — pharmacyRelationships（FK + unique パターン）
  - Web Push API: subscription object shape (endpoint, keys.p256dh, keys.auth)

  **Acceptance Criteria**:
  - [ ] `npm run typecheck` → PASS
  - [ ] pushSubscriptions テーブルが schema.ts に存在

  ```
  Scenario: Schema validates
    Tool: Bash
    Steps:
      1. Run `npm run typecheck`
      2. Assert exit code 0
    Expected Result: No type errors
    Evidence: .sisyphus/evidence/task-2-typecheck.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(schema): add pushSubscriptions table`
  - Files: `server/src/db/schema.ts`
  - Pre-commit: `npm run typecheck`

- [ ] 3. Shared types: グループ interfaces + enums

  **What to do**:
  - `server/src/types/` に `group.ts` を作成
  - 型定義: `PharmacyGroup`, `GroupMember`, `GroupCreateRequest`, `GroupUpdateRequest`, `GroupInvitation`, `GroupListResponse`, `GroupDetailResponse`
  - Visibility type: `'public' | 'invite_only'`
  - Role type: `'owner' | 'admin' | 'member'`
  - テスト: 型が正しくexport/importできること

  **Must NOT do**:
  - ビジネスロジックの実装は含めない

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 8, 9, 15, 16
  - **Blocked By**: None

  **References**:
  - `server/src/types/` — 既存の型定義ディレクトリ構造
  - `server/src/db/schema.ts` — Task 1で定義したenum/テーブルとの整合性

  **Acceptance Criteria**:
  - [ ] `npm run typecheck` → PASS
  - [ ] group.ts が全必要型をexport

  ```
  Scenario: Types compile correctly
    Tool: Bash
    Steps:
      1. Run `npm run typecheck`
    Expected Result: exit code 0
    Evidence: .sisyphus/evidence/task-3-typecheck.txt
  ```

  **Commit**: YES (groups with Task 4)
  - Message: `feat(types): add group and push notification interfaces`
  - Files: `server/src/types/group.ts`

- [ ] 4. Shared types: プッシュ通知 + アラート interfaces

  **What to do**:
  - `server/src/types/` に `push.ts` を作成
  - 型定義: `PushSubscriptionPayload`, `PushNotificationPayload`, `PushSendResult`, `PushSubscriptionRecord`
  - `server/src/types/` に `alert.ts` を作成（アラートAPI用）
  - 型定義: `AlertListResponse`, `AlertDetailResponse`, `AlertResolveRequest`
  - テスト: 型チェック

  **Must NOT do**:
  - VAPID実装は含めない

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 10, 12, 13, 19
  - **Blocked By**: None

  **References**:
  - Web Push API: PushSubscription interface spec
  - `server/src/services/predictive-alert-service.ts` — alertType, detailJson 構造
  - `server/src/services/expiry-risk-service.ts` — risk bucket/score 型

  **Acceptance Criteria**:
  - [ ] `npm run typecheck` → PASS

  ```
  Scenario: Types compile
    Tool: Bash
    Steps:
      1. Run `npm run typecheck`
    Expected Result: exit code 0
    Evidence: .sisyphus/evidence/task-4-typecheck.txt
  ```

  **Commit**: YES (groups with Task 3)
  - Message: `feat(types): add push and alert interfaces`
  - Files: `server/src/types/push.ts`, `server/src/types/alert.ts`

- [ ] 5. PWA scaffold: manifest.json + icons + meta tags

  **What to do**:
  - `client/public/manifest.json` を作成（name: '薬局デッドストック交換', short_name: 'DeadStock', start_url: '/', display: 'standalone', theme_color: '#0d6efd', background_color: '#ffffff', icons配列）
  - アプリアイコン生成: 192x192, 512x512, apple-touch-icon 180x180, favicon.ico（薬のアイコンベース、シンプルなデザイン）
  - `client/index.html` に meta tags追加: theme-color, apple-touch-icon, manifest link, apple-mobile-web-app-capable
  - maskable アイコンも含める（PWA installability要件）

  **Must NOT do**:
  - Service Worker の実装は含めない（Task 6, 14で実装）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 6, 14, 21
  - **Blocked By**: None

  **References**:
  - `client/index.html` — 既存meta tags構造
  - `client/public/` — 既存public assets
  - PWA manifest spec: https://developer.mozilla.org/docs/Web/Manifest

  **Acceptance Criteria**:
  - [ ] manifest.json が client/public/ に存在
  - [ ] アイコンファイル (192x192, 512x512, apple-touch-icon) が存在
  - [ ] index.html に manifest link, theme-color, apple-touch-icon が存在

  ```
  Scenario: Manifest is valid JSON and referenced in HTML
    Tool: Bash
    Steps:
      1. Run `cat client/public/manifest.json | python3 -m json.tool`
      2. Assert exit code 0 (valid JSON)
      3. Run `grep 'manifest.json' client/index.html`
      4. Assert match found
    Expected Result: Valid manifest linked in HTML
    Evidence: .sisyphus/evidence/task-5-manifest-check.txt
  ```

  **Commit**: YES
  - Message: `feat(pwa): add manifest.json, app icons, and meta tags`
  - Files: `client/public/manifest.json`, `client/public/icons/*`, `client/index.html`

- [ ] 6. vite-plugin-pwa configuration + SW shell

  **What to do**:
  - `npm install -D vite-plugin-pwa` (client workspace)
  - `client/vite.config.ts` に VitePWA プラグインを追加
  - 設定: `registerType: 'prompt'`, `injectManifest` strategy, `srcDir: 'src'`, `filename: 'sw.ts'`
  - `client/src/sw.ts` にService Worker shell を作成（precache manifest injection point + 基本install/activate）
  - Workbox設定: runtimeCaching でAPI レスポンスの stale-while-revalidate、静的アセットの cache-first
  - `/api/auth/*` は caching から除外
  - `client/src/hooks/useSWUpdate.ts` フックを作成（SW更新検出 + 更新トリガー関数をexport）
  - テスト: build が成功することを確認

  **Must NOT do**:
  - `registerType: 'autoUpdate'` は使用禁止
  - `/api/auth/*` をキャッシュしない
  - 50MB超のペイロードをキャッシュしない

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 14, 21, 26
  - **Blocked By**: Task 5

  **References**:
  - `client/vite.config.ts` — 既存Vite設定（チャンク分割、テスト設定）
  - vite-plugin-pwa docs: injectManifest strategy
  - Workbox runtimeCaching patterns

  **Acceptance Criteria**:
  - [ ] `npm run build:client` → PASS（SW含むビルド成功）
  - [ ] `client/src/sw.ts` が存在
  - [ ] `client/src/hooks/useSWUpdate.ts` が存在

  ```
  Scenario: Client build succeeds with PWA plugin
    Tool: Bash
    Steps:
      1. Run `npm run build:client`
      2. Assert exit code 0
      3. Check dist/ contains sw.js
    Expected Result: Build succeeds with service worker output
    Evidence: .sisyphus/evidence/task-6-build.txt
  ```

  **Commit**: YES
  - Message: `feat(pwa): configure vite-plugin-pwa with injectManifest strategy`
  - Files: `client/vite.config.ts`, `client/src/sw.ts`, `client/src/hooks/useSWUpdate.ts`, `client/package.json`

- [ ] 7. Notification enum extension (group + alert types)

  **What to do**:
  - `server/src/db/schema.ts` の通知関連enum（notificationTypeValues等）にグループ通知タイプを追加: `group_invitation`, `group_join`, `group_leave`
  - アラート通知タイプを追加: `alert_near_expiry`, `alert_excess_stock`, `alert_resolved`
  - `server/src/services/notification-service.ts` の createNotification 関数が新タイプを受け付けることを確認
  - テスト: enum拡張の型チェック + 既存通知テストが壊れないこと

  **Must NOT do**:
  - 通知送信ロジックの変更は含めない（Task 8, 24で実装）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 8, 10, 13, 24
  - **Blocked By**: None

  **References**:
  - `server/src/db/schema.ts` — notificationTypeValues の定義箇所
  - `server/src/services/notification-service.ts:createNotification` — 通知作成パターン
  - `ast_grep_search` で `notificationTypeValues` の全参照を確認してから変更すること

  **Acceptance Criteria**:
  - [ ] `npm run typecheck` → PASS
  - [ ] `npm run test:server` → PASS（既存テスト破壊なし）

  ```
  Scenario: Enum extension doesn't break existing tests
    Tool: Bash
    Steps:
      1. Run `npm run test:server`
      2. Assert all tests pass
    Expected Result: 0 failures
    Evidence: .sisyphus/evidence/task-7-test.txt
  ```

  **Commit**: YES
  - Message: `feat(notifications): extend notification enums for group and alert types`
  - Files: `server/src/db/schema.ts`
  - Pre-commit: `npm run test:server`

---

### Wave 2: Backend Services (MAX PARALLEL)

- [ ] 8. Group service: CRUD + membership + invitation

  **What to do**:
  - `server/src/services/group-service.ts` を作成
  - 機能: createGroup, updateGroup, deleteGroup, listGroups, getGroupDetail
  - 機能: inviteMember, acceptInvitation, declineInvitation, removeMember, leaveGroup
  - 機能: listMembers, updateMemberRole
  - ビジネスルール: ownerのみグループ削除可、owner/adminがメンバー招待/削除可
  - visibility='public' なら誰でも参加可、'invite_only' なら招待のみ
  - 通知連携: 招待時に group_invitation 通知を作成
  - TDD: テスト先行で全機能をカバー

  **Must NOT do**:
  - Admin画面からのグループ管理は含めない
  - マッチングロジックは含めない（Task 11）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 9-14)
  - **Blocks**: Tasks 15, 16, 23
  - **Blocked By**: Tasks 1, 3, 7

  **References**:
  - `server/src/routes/pharmacies.ts:318-386` — upsertRelationship/deleteRelationship パターン（グループメンバー管理の参考）
  - `server/src/services/notification-service.ts:createNotification` — 通知作成パターン
  - `server/src/test/notification-service-final.test.ts` — サービステストのモックパターン (vi.hoisted + vi.mock)

  **Acceptance Criteria**:
  - [ ] テストファイル: `server/src/test/group-service.test.ts` → PASS
  - [ ] 全CRUD + 招待/参加/離脫フローのテストカバレッジ

  ```
  Scenario: Group CRUD operations
    Tool: Bash (curl)
    Preconditions: Server running, authenticated user
    Steps:
      1. POST /api/groups {name: 'テスト薬剤師会', visibility: 'public'} → 201
      2. GET /api/groups → 200, body contains created group
      3. PUT /api/groups/:id {name: '更新名'} → 200
      4. DELETE /api/groups/:id → 204
    Expected Result: All CRUD operations return correct status codes
    Evidence: .sisyphus/evidence/task-8-crud.txt

  Scenario: Invitation workflow
    Tool: Bash (curl)
    Steps:
      1. POST /api/groups/:id/invite {pharmacyId: 2} → 201
      2. POST /api/groups/:id/accept (as pharmacy 2) → 200
      3. GET /api/groups/:id/members → 200, contains pharmacy 2
    Expected Result: Invitation accepted, member added
    Evidence: .sisyphus/evidence/task-8-invitation.txt

  Scenario: Non-owner cannot delete group
    Tool: Bash (curl)
    Steps:
      1. DELETE /api/groups/:id (as non-owner) → 403
    Expected Result: Forbidden
    Evidence: .sisyphus/evidence/task-8-permission-error.txt
  ```

  **Commit**: YES
  - Message: `feat(groups): add group service with CRUD and membership management`
  - Files: `server/src/services/group-service.ts`, `server/src/test/group-service.test.ts`
  - Pre-commit: `npm run test:server`

- [ ] 9. Group routes: REST API endpoints

  **What to do**:
  - `server/src/routes/groups.ts` を作成
  - エンドポイント:
    - `POST /api/groups` — グループ作成
    - `GET /api/groups` — グループ一覧（自分の所属 + 公開グループ）
    - `GET /api/groups/:id` — グループ詳細（メンバー一覧含む）
    - `PUT /api/groups/:id` — グループ更新
    - `DELETE /api/groups/:id` — グループ削除
    - `POST /api/groups/:id/invite` — メンバー招待
    - `POST /api/groups/:id/join` — 公開グループに参加
    - `POST /api/groups/:id/accept` — 招待承認
    - `POST /api/groups/:id/leave` — グループ離脫
    - `DELETE /api/groups/:id/members/:pharmacyId` — メンバー削除
  - `server/src/app.ts` に `app.use('/api/groups', requireLogin, groupsRouter)` を登録
  - バリデーション: zod schemaでリクエスト検証
  - TDD: supertestでルートテスト

  **Must NOT do**:
  - ビジネスロジックの重複実装（group-serviceを呼ぶ）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 15, 16, 23
  - **Blocked By**: Tasks 1, 3, 7

  **References**:
  - `server/src/routes/pharmacies.ts` — 既存ルート構造（ミドルウェア、バリデーション、エラーハンドリング）
  - `server/src/app.ts` — ルート登録パターン (app.use)
  - `server/src/test/exchange-route-priority.test.ts` — supertestルートテストのパターン

  **Acceptance Criteria**:
  - [ ] `server/src/test/group-routes.test.ts` → PASS
  - [ ] 全エンドポイントのsupertestカバレッジ

  ```
  Scenario: Full REST API lifecycle
    Tool: Bash (curl)
    Steps:
      1. POST /api/groups → 201
      2. GET /api/groups → 200, array includes new group
      3. POST /api/groups/:id/invite → 201
      4. POST /api/groups/:id/join (public group) → 200
      5. GET /api/groups/:id → 200, members array populated
    Expected Result: All endpoints return correct responses
    Evidence: .sisyphus/evidence/task-9-api.txt
  ```

  **Commit**: YES
  - Message: `feat(groups): add group REST API routes`
  - Files: `server/src/routes/groups.ts`, `server/src/app.ts`, `server/src/test/group-routes.test.ts`
  - Pre-commit: `npm run test:server`

- [ ] 10. Alert read/resolve API service + routes

  **What to do**:
  - `server/src/services/alert-read-service.ts` を作成
  - 機能: listAlerts(pharmacyId, filters), getAlertDetail(id), resolveAlert(id), getAlertStats(pharmacyId)
  - filters: alertType, resolved/unresolved, 日付範囲, ページネーション
  - `server/src/routes/alerts.ts` を作成
  - エンドポイント:
    - `GET /api/alerts` — アラート一覧（フィルタ・ページネーション付き）
    - `GET /api/alerts/:id` — アラート詳細（detailJson含む）
    - `PATCH /api/alerts/:id/resolve` — 解決済みマーク
    - `GET /api/alerts/stats` — アラート統計（未解決数, 種別別集計）
  - `server/src/app.ts` にルート登録
  - TDD: supertestでテスト

  **Must NOT do**:
  - アラート生成ロジックの変更（predictive-alert-serviceはそのまま）
  - アラート閾値のUI設定機能

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 17, 18, 24
  - **Blocked By**: Tasks 4, 7

  **References**:
  - `server/src/services/predictive-alert-service.ts` — predictiveAlertsテーブルの構造、alertType、detailJson
  - `server/src/services/expiry-risk-service.ts` — risk bucket/score構造
  - `server/src/db/schema.ts` — predictiveAlertsテーブル定義

  **Acceptance Criteria**:
  - [ ] `server/src/test/alert-read-service.test.ts` → PASS
  - [ ] `server/src/test/alert-routes.test.ts` → PASS

  ```
  Scenario: Alert list and resolve
    Tool: Bash (curl)
    Steps:
      1. GET /api/alerts → 200, returns alert array
      2. GET /api/alerts/:id → 200, returns detail with detailJson
      3. PATCH /api/alerts/:id/resolve → 200
      4. GET /api/alerts/:id → 200, resolvedAt is not null
    Expected Result: Alert lifecycle works correctly
    Evidence: .sisyphus/evidence/task-10-alert-api.txt

  Scenario: Alert stats endpoint
    Tool: Bash (curl)
    Steps:
      1. GET /api/alerts/stats → 200
      2. Assert body has unresolvedCount, byType object
    Expected Result: Stats aggregation returns
    Evidence: .sisyphus/evidence/task-10-alert-stats.txt
  ```

  **Commit**: YES
  - Message: `feat(alerts): add alert read/resolve API with service and routes`
  - Files: `server/src/services/alert-read-service.ts`, `server/src/routes/alerts.ts`, `server/src/app.ts`, `server/src/test/alert-*.test.ts`
  - Pre-commit: `npm run test:server`

- [ ] 11. Matching score extension: groupBonus

  **What to do**:
  - `server/src/services/matching-score-service.ts` の `calculateCandidateScore` に groupBonus を追加
  - 既存の favoriteBonus (+15pt) パターンを踏襲: 同一グループ所属なら +groupBonus pt（デフォルト 10pt）
  - `server/src/services/matching-rule-service.ts` に groupBonus パラメータを追加
  - `server/src/services/matching-service.ts` でグループメンバーシップをロードし、スコア計算時に渡す
  - `lsp_find_references` で `calculateCandidateScore` と `MatchingScoringRules` の全参照を確認してから変更
  - TDD: グループボーナスが正しく加算されるテスト

  **Must NOT do**:
  - 既存マッチングロジックの破壊的変更
  - グループ限定モードの実装（ボーナスのみ）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 23
  - **Blocked By**: Tasks 1, 3

  **References**:
  - `server/src/services/matching-score-service.ts:L358-392` — favoriteBonus パターン（これをgroupBonusに踏襲）
  - `server/src/services/matching-rule-service.ts` — MatchingScoringRules interface
  - `server/src/services/matching-service.ts` — findMatchesBatchでfavoritesロード部分

  **Acceptance Criteria**:
  - [ ] `server/src/test/matching-score-group-bonus.test.ts` → PASS
  - [ ] 同一グループ候補: score += groupBonus
  - [ ] 非グループ候補: score変化なし
  - [ ] 既存matchingテストが壊れない

  ```
  Scenario: Group bonus applied correctly
    Tool: Bash
    Steps:
      1. Run `cd server && npx vitest run src/test/matching-score-group-bonus.test.ts`
      2. Assert all tests pass
    Expected Result: Group bonus tests pass
    Evidence: .sisyphus/evidence/task-11-matching.txt
  ```

  **Commit**: YES
  - Message: `feat(matching): add groupBonus to scoring algorithm`
  - Files: `server/src/services/matching-score-service.ts`, `server/src/services/matching-rule-service.ts`, `server/src/services/matching-service.ts`, `server/src/test/matching-score-group-bonus.test.ts`
  - Pre-commit: `npm run test:server`

- [ ] 12. Push subscription service (VAPID + subscribe/unsubscribe)

  **What to do**:
  - `npm install web-push` (server workspace)
  - `server/src/services/push-subscription-service.ts` を作成
  - 機能: subscribe(pharmacyId, subscription), unsubscribe(pharmacyId, endpoint), listSubscriptions(pharmacyId), cleanupStale()
  - VAPID設定: 環境変数 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` から読み込み
  - `GET /api/push/vapid-public-key` エンドポイント（クライアントが購読時に使用）
  - `POST /api/push/subscribe` — 購読登録
  - `DELETE /api/push/subscribe` — 購読解除
  - デバイス上限: 1薬局あたり最大10デバイス
  - `server/src/app.ts` にルート登録
  - TDD: subscribe/unsubscribe/cleanupのテスト

  **Must NOT do**:
  - push送信ロジック（Task 13）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 19, 24
  - **Blocked By**: Tasks 2, 4

  **References**:
  - Web Push API: PushSubscription interface
  - npm web-push: setVapidDetails, subscription shape
  - `server/src/db/schema.ts` — Task 2の pushSubscriptions テーブル

  **Acceptance Criteria**:
  - [ ] `server/src/test/push-subscription-service.test.ts` → PASS
  - [ ] 購読登録/解除/クリーンアップのテストカバレッジ

  ```
  Scenario: Push subscription lifecycle
    Tool: Bash (curl)
    Steps:
      1. GET /api/push/vapid-public-key → 200, returns publicKey
      2. POST /api/push/subscribe {endpoint, keys} → 201
      3. DELETE /api/push/subscribe {endpoint} → 204
    Expected Result: Subscribe/unsubscribe works
    Evidence: .sisyphus/evidence/task-12-push-sub.txt

  Scenario: Device limit enforcement
    Tool: Bash (curl)
    Steps:
      1. POST /api/push/subscribe 10 different endpoints → all 201
      2. POST /api/push/subscribe 11th endpoint → 409 or oldest replaced
    Expected Result: Max 10 devices per pharmacy
    Evidence: .sisyphus/evidence/task-12-device-limit.txt
  ```

  **Commit**: YES
  - Message: `feat(push): add push subscription service with VAPID support`
  - Files: `server/src/services/push-subscription-service.ts`, `server/src/routes/push.ts`, `server/src/app.ts`, `server/package.json`
  - Pre-commit: `npm run test:server`

- [ ] 13. Push dispatch service (send + 410 cleanup)

  **What to do**:
  - `server/src/services/push-dispatch-service.ts` を作成
  - 機能: sendToPharmacy(pharmacyId, payload), sendToMultiple(pharmacyIds, payload)
  - Promise.allSettled でバッチ送信、410 Gone レスポンスは自動削除
  - Vercel Function 60秒タイムアウト対応: pharmacy単位でチャンク処理
  - ペイロード形式: { title, body, icon, badge, data: { url, type, referenceId } }
  - TDD: 送信成功/失敗/410クリーンアップのテスト

  **Must NOT do**:
  - 全購読者への一括送信（1関数呼出しで）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 24
  - **Blocked By**: Tasks 2, 4, 7

  **References**:
  - npm web-push: sendNotification API, error codes (410, 404)
  - `server/src/services/push-subscription-service.ts` — Task 12で作成した購読管理

  **Acceptance Criteria**:
  - [ ] `server/src/test/push-dispatch-service.test.ts` → PASS
  - [ ] 410 cleanupロジックのテストカバレッジ

  ```
  Scenario: Push dispatch with 410 cleanup
    Tool: Bash
    Steps:
      1. Run push dispatch test suite
      2. Assert: successful send returns {sent: N, failed: 0}
      3. Assert: 410 response triggers subscription deletion
    Expected Result: Dispatch handles errors gracefully
    Evidence: .sisyphus/evidence/task-13-dispatch.txt
  ```

  **Commit**: YES
  - Message: `feat(push): add push dispatch service with 410 cleanup`
  - Files: `server/src/services/push-dispatch-service.ts`, `server/src/test/push-dispatch-service.test.ts`
  - Pre-commit: `npm run test:server`

- [ ] 14. Service Worker: caching strategy + offline fallback

  **What to do**:
  - `client/src/sw.ts` を拡張（Task 6の shellを実装）
  - Workbox runtimeCaching:
    - 静的アセット (JS/CSS/fonts): CacheFirst, maxAgeSeconds: 30日
    - APIレスポンス (GET /api/*): StaleWhileRevalidate, maxEntries: 50
    - 画像: CacheFirst, maxEntries: 100, maxAgeSeconds: 7日
    - 除外: `/api/auth/*`, `/api/push/*`, `/api/csrf-token`
  - オフラインフォールバック: `client/public/offline.html` を作成（「オフラインです。ネットワーク接続を確認してください」メッセージ）
  - pushイベントハンドラ: `self.addEventListener('push', ...)` でプッシュ通知表示
  - notificationclickハンドラ: クリック時に該当ページを開く
  - iOS Safariキャッシュ制限対応: maxEntriesを保守的に設定

  **Must NOT do**:
  - Background Sync（iOS/Safari非対応）
  - `/api/auth/*` のキャッシュ
  - 大容量ペイロードのキャッシュ

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 21, 25, 26
  - **Blocked By**: Task 6

  **References**:
  - `client/src/sw.ts` — Task 6で作成したshell
  - Workbox runtimeCaching patterns
  - `client/vite.config.ts` — injectManifest設定

  **Acceptance Criteria**:
  - [ ] `npm run build:client` → PASS
  - [ ] dist/sw.js に runtimeCaching ルールが含まれる
  - [ ] offline.html が client/public/ に存在

  ```
  Scenario: Offline fallback works
    Tool: Playwright
    Steps:
      1. Navigate to app
      2. Go offline (page.context().setOffline(true))
      3. Navigate to /nonexistent
      4. Assert page contains 'オフライン'
    Expected Result: Offline fallback page shown
    Evidence: .sisyphus/evidence/task-14-offline.png

  Scenario: Auth endpoints not cached
    Tool: Bash
    Steps:
      1. grep -r 'api/auth' in built sw.js
      2. Assert no caching rules match /api/auth/*
    Expected Result: Auth endpoints excluded from cache
    Evidence: .sisyphus/evidence/task-14-auth-exclude.txt
  ```

  **Commit**: YES
  - Message: `feat(pwa): implement service worker with caching and offline fallback`
  - Files: `client/src/sw.ts`, `client/public/offline.html`
  - Pre-commit: `npm run build:client`

---

### Wave 3: Frontend (MAX PARALLEL)

- [ ] 15. Group list page + group creation modal

  **What to do**:
  - `client/src/pages/GroupListPage.tsx` を作成
  - 自分の所属グループ一覧 + 公開グループ検索タブ
  - グループ作成モーダル（name, description, visibility選択）
  - 公開グループに「参加」ボタン、招待制グループに「招待待ち」バッジ
  - AppResponsiveSwitch でデスクトップ/モバイル対応
  - PageShell + 既存UIコンポーネントパターンを踏襲
  - TDD: @testing-library/react でコンポーネントテスト

  **Must NOT do**:
  - メンバー管理UI（Task 16）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 16-22)
  - **Blocks**: Tasks 23, 25
  - **Blocked By**: Tasks 8, 9, 3

  **References**:
  - `client/src/pages/PharmacyListPage.tsx` — 一覧ページパターン（フィルタ, ページネーション, AppResponsiveSwitch）
  - `client/src/components/ConfirmActionModal.tsx` — モーダルパターン
  - `client/src/components/ui/AppDataPanel.tsx` — カードパネルパターン

  **Acceptance Criteria**:
  - [ ] GroupListPage がレンダリングされる
  - [ ] グループ作成モーダルが動作する

  ```
  Scenario: Group list page renders
    Tool: Playwright
    Steps:
      1. Navigate to /groups
      2. Assert page contains 'グループ'
      3. Click 'グループを作成' button
      4. Assert modal appears with name/description/visibility fields
    Expected Result: Page and modal render correctly
    Evidence: .sisyphus/evidence/task-15-group-list.png
  ```

  **Commit**: YES
  - Message: `feat(groups): add group list page with creation modal`
  - Files: `client/src/pages/GroupListPage.tsx`, `client/src/__tests__/GroupListPage.test.tsx`

- [ ] 16. Group detail/management page

  **What to do**:
  - `client/src/pages/GroupDetailPage.tsx` を作成
  - グループ情報表示（name, description, visibility, owner）
  - メンバー一覧（ロールバッジ付き）
  - owner/admin向け: メンバー招待フォーム、メンバー削除ボタン、グループ設定編集
  - member向け: 離脫ボタン
  - 招待待ちユーザー: 承認/拒否ボタン
  - AppResponsiveSwitchでモバイル対応

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 23, 25
  - **Blocked By**: Tasks 8, 9, 3

  **References**:
  - `client/src/pages/ProposalDetailPage.tsx` — 詳細ページパターン（ロール別アクション、ステータスバッジ）
  - `client/src/components/ConfirmActionModal.tsx` — 削除確認モーダル

  **Acceptance Criteria**:
  - [ ] GroupDetailPage がメンバー一覧を表示
  - [ ] owner権限で招待/削除ボタンが表示

  ```
  Scenario: Group detail with member management
    Tool: Playwright
    Steps:
      1. Navigate to /groups/:id (as owner)
      2. Assert member list visible
      3. Assert 'メンバーを招待' button visible
      4. Assert 'グループを削除' button visible
    Expected Result: Owner sees management controls
    Evidence: .sisyphus/evidence/task-16-group-detail.png
  ```

  **Commit**: YES (groups with Task 15)
  - Message: `feat(groups): add group detail and management page`
  - Files: `client/src/pages/GroupDetailPage.tsx`, `client/src/__tests__/GroupDetailPage.test.tsx`

- [ ] 17. Alert list page + alert detail modal

  **What to do**:
  - `client/src/pages/AlertListPage.tsx` を作成
  - アラート一覧: 未解決/解決済みフィルタ、アラート種別フィルタ、ページネーション
  - アラートカード: title, message, alertTypeバッジ, detectedAt, 解決ボタン
  - アラート詳細モーダル: detailJsonの内容を表示（影響品目一覧、総額、最短期限）
  - 「在庫を見る」「提案を作成」のアクションリンク
  - AppResponsiveSwitchでモバイル対応

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 24, 25
  - **Blocked By**: Tasks 10, 4

  **References**:
  - `client/src/pages/DeadStockListPage.tsx` — フィルタ + ページネーションパターン
  - `client/src/components/ui/AppModalShell.tsx` — モーダルパターン
  - `server/src/services/predictive-alert-service.ts` — detailJson構造

  **Acceptance Criteria**:
  - [ ] AlertListPage がアラート一覧を表示
  - [ ] 詳細モーダルが影響品目を表示

  ```
  Scenario: Alert list with filtering
    Tool: Playwright
    Steps:
      1. Navigate to /alerts
      2. Assert alert cards displayed
      3. Click '未解決' filter
      4. Assert only unresolved alerts shown
      5. Click alert card → modal opens with detail
    Expected Result: List and modal work correctly
    Evidence: .sisyphus/evidence/task-17-alert-list.png
  ```

  **Commit**: YES
  - Message: `feat(alerts): add alert list page with detail modal`
  - Files: `client/src/pages/AlertListPage.tsx`, `client/src/__tests__/AlertListPage.test.tsx`

- [ ] 18. Dashboard alert widget (DashboardPage extension)

  **What to do**:
  - `client/src/pages/DashboardPage.tsx` にアラートウィジェットを追加
  - 既存の risk KPIタイルの下に配置
  - 未解決アラート件数、最新アラートタイトル、「全て見る」リンク
  - GET /api/alerts/stats を使用
  - AppDataPanel + dl-kpi-tile パターンを踏襲

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 25
  - **Blocked By**: Task 10

  **References**:
  - `client/src/pages/DashboardPage.tsx:L129-160` — 既存risk KPIタイル（この下に配置）
  - `client/src/components/ui/AppDataPanel.tsx` — パネルコンポーネント

  **Acceptance Criteria**:
  - [ ] ダッシュボードにアラートウィジェットが表示される

  ```
  Scenario: Dashboard shows alert widget
    Tool: Playwright
    Steps:
      1. Navigate to / (dashboard)
      2. Assert 'アラート' section visible
      3. Assert unresolved count displayed
      4. Click '全て見る' → navigates to /alerts
    Expected Result: Widget shows alert summary with link
    Evidence: .sisyphus/evidence/task-18-dashboard-widget.png
  ```

  **Commit**: YES (groups with Task 17)
  - Message: `feat(alerts): add alert dashboard widget`
  - Files: `client/src/pages/DashboardPage.tsx`

- [ ] 19. Push notification permission UI + settings

  **What to do**:
  - `client/src/components/push/PushPermissionBanner.tsx` を作成
  - PushManager feature detection: `'PushManager' in window` をチェック
  - 未許可時: 「プッシュ通知を有効にする」バナー表示
  - 許可済み: 購読登録を実行（VAPID public key取得 → subscribe → POST /api/push/subscribe）
  - 拒否済み: バナー非表示（ブラウザ設定で変更を案内）
  - AccountPage にプッシュ通知設定セクションを追加（ON/OFFトグル）
  - `client/src/hooks/usePushSubscription.ts` フックを作成

  **Must NOT do**:
  - PushManager未対応環境でエラーを出さない（feature detectionでサイレントに非表示）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 24, 25
  - **Blocked By**: Tasks 12, 4

  **References**:
  - `client/src/pages/AccountPage.tsx` — アカウント設定ページ構造
  - `client/src/components/ui/AppAlert.tsx` — バナーコンポーネントパターン
  - Web Push API: Notification.requestPermission(), PushManager.subscribe()

  **Acceptance Criteria**:
  - [ ] PushManager対応ブラウザでバナーが表示される
  - [ ] PushManager非対応でバナーが非表示

  ```
  Scenario: Push permission banner shown
    Tool: Playwright
    Steps:
      1. Navigate to / (dashboard)
      2. Assert 'プッシュ通知' banner visible (if PushManager supported)
    Expected Result: Banner appears on supported browsers
    Evidence: .sisyphus/evidence/task-19-push-banner.png
  ```

  **Commit**: YES
  - Message: `feat(push): add push notification permission UI and settings`
  - Files: `client/src/components/push/PushPermissionBanner.tsx`, `client/src/hooks/usePushSubscription.ts`, `client/src/pages/AccountPage.tsx`

- [ ] 20. Mobile bottom navigation

  **What to do**:
  - `client/src/components/layout/MobileBottomNav.tsx` を作成
  - ナビゲーション項目: ダッシュボード, マッチング, 提案, アラート, メニュー
  - モバイルのみ表示（AppResponsiveSwitchまたはCSS media query）
  - アクティブルートのハイライト
  - 未読バッジ（提案、アラート）
  - レイアウトコンポーネント（App.tsx またはレイアウト）に組み込み
  - CSS: 固定下部バー、z-index管理、safe-area-inset-bottom対応

  **Must NOT do**:
  - デスクトップの既存ナビゲーションを変更しない

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 25
  - **Blocked By**: None

  **References**:
  - `client/src/components/ui/AppResponsiveSwitch.tsx` — モバイル検出パターン
  - `client/src/App.tsx` — レイアウト構造
  - `client/src/contexts/TimelineContext.tsx` — unread count取得パターン

  **Acceptance Criteria**:
  - [ ] モバイルビューポートでボトムナビが表示
  - [ ] デスクトップでは非表示

  ```
  Scenario: Bottom nav on mobile viewport
    Tool: Playwright
    Preconditions: viewport 375x667
    Steps:
      1. Navigate to /
      2. Assert bottom nav bar visible
      3. Assert 5 navigation items present
      4. Click 'アラート' → navigates to /alerts
    Expected Result: Mobile nav works
    Evidence: .sisyphus/evidence/task-20-mobile-nav.png

  Scenario: Bottom nav hidden on desktop
    Tool: Playwright
    Preconditions: viewport 1280x800
    Steps:
      1. Navigate to /
      2. Assert bottom nav bar NOT visible
    Expected Result: Hidden on desktop
    Evidence: .sisyphus/evidence/task-20-desktop-no-nav.png
  ```

  **Commit**: YES
  - Message: `feat(pwa): add mobile bottom navigation`
  - Files: `client/src/components/layout/MobileBottomNav.tsx`, CSS files

- [ ] 21. SW update banner + install promotion

  **What to do**:
  - `client/src/components/pwa/SWUpdateBanner.tsx` を作成
  - Task 6の useSWUpdate フックを使用
  - 「新しいバージョンがあります。更新しますか？」バナー
  - `client/src/components/pwa/InstallPromptBanner.tsx` を作成
  - beforeinstallprompt イベントをキャプチャ
  - 「ホーム画面に追加」バナー表示
  - 「あとで」で非表示（localStorageでスヌーズ）
  - App.tsx またはレイアウトに組み込み

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 25, 26
  - **Blocked By**: Tasks 6, 14

  **References**:
  - `client/src/hooks/useSWUpdate.ts` — Task 6で作成したhook
  - vite-plugin-pwa: registerSW prompt pattern

  **Acceptance Criteria**:
  - [ ] SW更新バナーが更新検出時に表示
  - [ ] インストールバナーがbeforeinstallprompt時に表示

  ```
  Scenario: Install prompt banner
    Tool: Playwright
    Steps:
      1. Navigate to / on mobile viewport
      2. Assert install banner appears (if beforeinstallprompt fires)
      3. Click 'あとで' → banner dismissed
      4. Reload → banner does not reappear (snoozed)
    Expected Result: Install promotion works with snooze
    Evidence: .sisyphus/evidence/task-21-install-banner.png
  ```

  **Commit**: YES
  - Message: `feat(pwa): add SW update banner and install promotion`
  - Files: `client/src/components/pwa/SWUpdateBanner.tsx`, `client/src/components/pwa/InstallPromptBanner.tsx`

- [ ] 22. Route config + lazy loading for new pages

  **What to do**:
  - `client/src/routes/route-config.tsx` に新ルートを追加:
    - `/groups` → GroupListPage (protected)
    - `/groups/:id` → GroupDetailPage (protected)
    - `/alerts` → AlertListPage (protected)
  - React.lazy() で遅延ローディング
  - ナビゲーションメニュー（サイドバー）にリンク追加

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 25
  - **Blocked By**: None

  **References**:
  - `client/src/routes/route-config.tsx` — 既存ルートメタデータ構造（ProtectedRouteMeta, PublicRouteMeta）

  **Acceptance Criteria**:
  - [ ] /groups, /groups/:id, /alerts ルートが登録されている
  - [ ] `npm run build:client` → PASS

  ```
  Scenario: New routes registered
    Tool: Bash
    Steps:
      1. grep 'groups\|alerts' client/src/routes/route-config.tsx
      2. Assert routes found
    Expected Result: Routes registered in config
    Evidence: .sisyphus/evidence/task-22-routes.txt
  ```

  **Commit**: YES
  - Message: `feat(routes): add group and alert page routes with lazy loading`
  - Files: `client/src/routes/route-config.tsx`

---

### Wave 4: Integration (cross-feature connections)

- [ ] 23. Group-aware PharmacyListPage extension

  **What to do**:
  - `client/src/pages/PharmacyListPage.tsx` を拡張
  - グループバッジ表示: 同一グループの薬局にグループ名バッジを表示
  - グループフィルタ: 特定グループの薬局のみ表示するフィルタ
  - マッチングページでグループボーナスの表示: 候補一覧で同一グループマーク

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 24-26)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 8, 9, 11, 15, 16

  **References**:
  - `client/src/pages/PharmacyListPage.tsx:210-325` — 既存薬局リスト（favorite/blockedバッジ、Set<number>パターン）

  **Acceptance Criteria**:
  - [ ] グループバッジが薬局リストに表示
  - [ ] グループフィルタが機能する

  ```
  Scenario: Group badge on pharmacy list
    Tool: Playwright
    Steps:
      1. Navigate to /pharmacies
      2. Assert group badge visible on same-group pharmacies
      3. Select group filter → list filters to group members only
    Expected Result: Group integration in pharmacy list
    Evidence: .sisyphus/evidence/task-23-pharmacy-group.png
  ```

  **Commit**: YES
  - Message: `feat(groups): integrate group badges and filter into pharmacy list`
  - Files: `client/src/pages/PharmacyListPage.tsx`

- [ ] 24. Alert → Push notification linkage

  **What to do**:
  - `server/src/services/predictive-alert-service.ts` を拡張
  - アラート生成時に push-dispatch-service を呼び出し
  - ペイロード: { title: alert.title, body: alert.message, data: { url: '/alerts', type: alert.alertType } }
  - グループ通知: グループ招待/参加時にもpush送信
  - feature detection: VAPID環境変数未設定時はサイレントにスキップ
  - TDD: push送信がトリガーされるテスト

  **Must NOT do**:
  - アラート生成ロジック自体の変更

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 10, 12, 13, 17, 19, 7

  **References**:
  - `server/src/services/predictive-alert-service.ts` — runPredictiveAlertsJob（アラート生成ループ）
  - `server/src/services/push-dispatch-service.ts` — Task 13で作成したpush送信
  - `server/src/services/notification-service.ts:createNotification` — 通知作成パターン

  **Acceptance Criteria**:
  - [ ] アラート生成時にpush通知が送信される
  - [ ] VAPID未設定時はエラーなくスキップ

  ```
  Scenario: Alert triggers push notification
    Tool: Bash
    Steps:
      1. Run alert-push integration test
      2. Assert push dispatch called with correct payload
      3. Assert VAPID-missing case skips gracefully
    Expected Result: Push linked to alerts
    Evidence: .sisyphus/evidence/task-24-alert-push.txt
  ```

  **Commit**: YES
  - Message: `feat(push): link alert and group notifications to push dispatch`
  - Files: `server/src/services/predictive-alert-service.ts`, `server/src/services/group-service.ts`

- [ ] 25. Mobile responsive audit (all new pages)

  **What to do**:
  - Playwrightで全新規ページをモバイルビューポート(375x667)で検証
  - 対象: /groups, /groups/:id, /alerts, / (dashboard), /account
  - チェック項目:
    - AppMobileDataCard が正しく表示されるか
    - ボトムナビが表示され、コンテンツと重ならないか
    - モーダルが画面内に収まるか
    - タップターゲットが44px以上か
  - 問題があればCSS修正

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`playwright`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 15-22

  **References**:
  - `client/src/components/ui/AppResponsiveSwitch.tsx` — 991.98px breakpoint
  - `client/src/components/ui/AppMobileDataCard.tsx` — モバイルカードパターン

  **Acceptance Criteria**:
  - [ ] 全新規ページのモバイルスクリーンショット

  ```
  Scenario: Mobile responsive check for all new pages
    Tool: Playwright
    Preconditions: viewport 375x667
    Steps:
      1. Navigate to /groups → screenshot
      2. Navigate to /groups/:id → screenshot
      3. Navigate to /alerts → screenshot
      4. Navigate to / → screenshot (verify alert widget + bottom nav)
      5. Navigate to /account → screenshot (verify push settings)
    Expected Result: All pages render correctly on mobile
    Evidence: .sisyphus/evidence/task-25-mobile-audit-*.png
  ```

  **Commit**: YES
  - Message: `fix(ui): mobile responsive adjustments for new pages`
  - Files: CSS/component files as needed

- [ ] 26. Lighthouse PWA audit gate

  **What to do**:
  - Lighthouse CLI でPWAオーディットを実行
  - スコア ≥ 80 を確認
  - 未達の場合: 問題を特定して修正
  - vercel.json に SW/manifest の Cache-Control ヘッダーを追加（sw.js: no-cache）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 6, 14, 21

  **References**:
  - Lighthouse PWA audit: installability, SW registration, manifest requirements
  - `vercel.json` — 既存デプロイ設定

  **Acceptance Criteria**:
  - [ ] Lighthouse PWA score ≥ 80

  ```
  Scenario: Lighthouse PWA audit
    Tool: Bash
    Steps:
      1. Build client: npm run build:client
      2. Serve dist locally
      3. Run: npx lighthouse http://localhost:4173 --only-categories=pwa --output=json
      4. Assert PWA score >= 80
    Expected Result: PWA score meets threshold
    Evidence: .sisyphus/evidence/task-26-lighthouse.json
  ```

  **Commit**: YES
  - Message: `feat(pwa): add vercel.json headers for SW and pass Lighthouse audit`
  - Files: `vercel.json`

---
## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + `npm run lint` + `npm run test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (group matching bonus in matching page, alert push notification receipt, PWA install + offline). Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Wave | Commit Message | Pre-commit |
|------|---------------|------------|
| 1 | `feat(schema): add pharmacyGroups, groupMembers, pushSubscriptions tables` | `npm run typecheck` |
| 1 | `feat(types): add group and push notification interfaces` | `npm run typecheck` |
| 1 | `feat(pwa): add manifest.json, icons, vite-plugin-pwa config` | `npm run build:client` |
| 2 | `feat(groups): add group service with CRUD and membership` | `npm run test:server` |
| 2 | `feat(groups): add group REST API routes` | `npm run test:server` |
| 2 | `feat(alerts): add alert read/resolve API` | `npm run test:server` |
| 2 | `feat(matching): add groupBonus to scoring algorithm` | `npm run test:server` |
| 2 | `feat(push): add VAPID push subscription and dispatch services` | `npm run test:server` |
| 2 | `feat(pwa): implement service worker with caching strategy` | `npm run build:client` |
| 3 | `feat(groups): add group list and detail pages` | `npm run test:client` |
| 3 | `feat(alerts): add alert list page and dashboard widget` | `npm run test:client` |
| 3 | `feat(pwa): add push permission UI, mobile nav, install banner` | `npm run test:client` |
| 4 | `feat(groups): integrate group matching into pharmacy list` | `npm run test` |
| 4 | `feat(push): link alert notifications to push dispatch` | `npm run test` |
| 4 | `feat(pwa): mobile responsive audit and Lighthouse gate` | `npm run test` |

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck       # Expected: 0 errors
npm run test            # Expected: all pass, coverage ≥ 95%
npm run build:client    # Expected: successful build
npm run build:server    # Expected: successful build
npm run lint            # Expected: 0 errors
npx lighthouse http://localhost:5173 --only-categories=pwa --output=json  # Expected: score ≥ 80
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass (server + client)
- [ ] Coverage thresholds maintained (≥95%)
- [ ] Lighthouse PWA ≥ 80
- [ ] No `as any`, `@ts-ignore`, empty catches in new code
- [ ] All evidence files in `.sisyphus/evidence/`
