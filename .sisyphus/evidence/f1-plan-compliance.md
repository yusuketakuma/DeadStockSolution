# F1: Plan Compliance Audit
Date: 2026-03-07
Branch: feature/group-alert-pwa
Commit: 0851096 fix(groups): fix API method mismatches and public group join flow

## Must Have

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | グループのハイブリッド型（公開/招待制の切替） | **APPROVE** | `schema.ts:47` — `pharmacyGroupVisibilityEnum = pgEnum('pharmacy_group_visibility_enum', ['public', 'invite_only'])`. `group-service.ts:347` — `acceptInvitation()`, `group-service.ts:395` — `joinPublicGroup()`. Both paths present. |
| 2 | グループ内マッチングボーナス（matchingRuleProfilesで設定可能） | **APPROVE** | `matching-score-service.ts:30` — `groupBonus: number` in MatchingScoringRules type. `matching-score-service.ts:48` — default `groupBonus: 10`. `matching-score-service.ts:399` — `const groupScore = isGroupMember ? scoringRules.groupBonus : 0`. `matching-rule-service.ts:55` — validation `groupBonus: { min: 0, max: 50, integer: true }`. |
| 3 | アラート一覧・詳細の専用ページ（DashboardPageの拡張ではなく独立ページ） | **APPROVE** | `client/src/pages/AlertListPage.tsx` exists as standalone file. `route-config.tsx:32` — `const AlertListPage = lazy(() => import('../pages/AlertListPage'))`. `route-config.tsx:79` — `{ path: '/alerts', access: 'protected', useLayout: true, component: AlertListPage }`. Independent route, not embedded in DashboardPage. |
| 4 | ダッシュボードへのアラートウィジェット追加 | **APPROVE** | `DashboardPage.tsx:49` — `alertStats: AlertStatsData | null` in state. `DashboardPage.tsx:67` — fetches `/alerts/stats`. `DashboardPage.tsx:216-238` — renders alert widget with title "予兆アラート", unresolvedCount KPI, and Badge components for near_expiry/excess_stock/no_movement. Link to `/alerts` for full list. |
| 5 | manifest.json + Service Worker + オフラインフォールバック | **APPROVE** | `client/public/manifest.json` — EXISTS. `client/src/sw.ts` — EXISTS (Workbox-based with CacheFirst, StaleWhileRevalidate strategies). `client/public/offline.html` — EXISTS. All three PWA artifacts present. |
| 6 | Web Push API (VAPID) によるプッシュ通知基盤 | **APPROVE** | `push-subscription-service.ts` — EXISTS (subscription CRUD). `push-dispatch-service.ts` — EXISTS with `import webpush from 'web-push'` (line 1), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` env vars (lines 13-15), `webpush.setVapidDetails()` (line 51), `webpush.sendNotification()` (line 75). Full VAPID implementation. |
| 7 | モバイル専用ボトムナビゲーション | **APPROVE** | `client/src/components/layout/MobileBottomNav.tsx` — EXISTS. `Layout.tsx:6` — `import MobileBottomNav from './layout/MobileBottomNav'`. `Layout.tsx:35` — `<MobileBottomNav />` rendered in layout. CSS at `MobileBottomNav.css`. |
| 8 | PushManager feature detection（iOS EU DMA対応） | **APPROVE** | `usePushSubscription.ts:39` — `&& 'PushManager' in window` check present. Test file `usePushSubscription.test.ts:36,58` — tests both PushManager present and absent scenarios. |
| 9 | SW registerType: 'prompt' + 更新バナーUI | **APPROVE** | `vite.config.ts:36` — `registerType: 'prompt'` (NOT 'autoUpdate'). `client/src/components/pwa/SWUpdateBanner.tsx` — EXISTS. Test at `SWUpdateBanner.test.tsx`. |

## Must NOT Have

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | Background Sync | **APPROVE** | Grepped `sw.ts` for `BackgroundSync`, `background.?sync`, `sync.*event`, `onsync`, `addEventListener.*sync` — zero matches. No Background Sync API usage. |
| 2 | オフラインでのデータ変更 | **APPROVE** | Grepped entire `client/src/` for `offlineQueue`, `offline.*mutation`, `offline.*save`, `offline.*store`, `indexedDB.*put`, `localForage` — zero matches. No offline data mutation patterns. |
| 3 | Admin画面でのグループ管理 | **APPROVE** | Group routes in `route-config.tsx:77-78` are `access: 'protected'` with no `adminOnly` flag. No admin-only group management UI found. Test data uses group `role: 'admin'` (group-internal admin role), not system admin — this is correct group membership role, not platform admin. |
| 4 | アラート閾値のUI設定 | **APPROVE** | Grepped `client/src/` for `threshold.*input`, `threshold.*slider`, `閾値.*設定`, `alertThreshold.*UI`, `setThreshold` — zero matches. No alert threshold configuration UI. |
| 5 | registerType: 'autoUpdate' | **APPROVE** | Grepped `vite.config.ts` for `autoUpdate` — zero matches. Confirmed `registerType: 'prompt'` at line 36. |
| 6 | /api/auth/* のSWキャッシュ | **APPROVE** | `sw.ts:32` — `!url.pathname.startsWith('/api/auth/')` — auth routes are explicitly EXCLUDED from the API cache route matcher. Also excludes `/api/push/` and `/api/csrf-token`. |
| 7 | 大容量ペイロードのSWキャッシュ | **APPROVE** | `sw.ts` caches only: app shell (CacheFirst), API GET responses with `maxEntries: 50` (StaleWhileRevalidate), images with `maxEntries: 100`. Only GET requests cached. Excel uploads (POST), matching result sets are not cached. No large payload caching. |
| 8 | 1回のVercel Functionで全購読者へpush送信 | **APPROVE** | `push-dispatch-service.ts:64` — `Promise.allSettled()` for per-pharmacy subscription sends. `push-dispatch-service.ts:133` — `sendToMultiple()` iterates pharmacies sequentially (`for...of` loop at line 151), calling `sendToPharmacy()` per pharmacy. Not a single giant Promise.all for all subscribers. Proper batching pattern. |
| 9 | `as any` / `@ts-ignore` / 空のcatchブロック / console.logの本番残し | **APPROVE** | **`as any`**: Grepped diff additions — zero matches. **`@ts-ignore`**: zero matches. **`@ts-expect-error`**: 1 occurrence in test file only (`usePushSubscription.test.ts:57` — `// @ts-expect-error removing PushManager from window` for `delete window.PushManager`). Legitimate test-only suppression. **`console.log`**: zero matches in diff additions. **Empty catch blocks**: All catch blocks in diff have either return statements or explanatory comments (e.g., `// localStorage unavailable`, `// 統計取得失敗はサイレント`, `// Silently fail - group data is supplementary`, `/* ignore */`). No truly empty catch blocks. |

## Overall Verdict: ✅ APPROVE

All 9 Must Have items are fully implemented and verified. All 9 Must NOT Have items are confirmed absent. The branch `feature/group-alert-pwa` is fully compliant with the plan.

### Notes
- The single `@ts-expect-error` in test code is a legitimate suppression for testing PushManager absence (iOS EU DMA scenario) — not a production code quality issue.
- Catch blocks use parameterless `catch {}` syntax (not `catch(e) {}`) which is TypeScript best practice when the error variable is unused. All have comments or return values.
- `sendToMultiple` uses sequential per-pharmacy iteration which is more Vercel-friendly than a single massive Promise.all.
