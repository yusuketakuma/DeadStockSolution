# Group Alert PWA - Learnings

## Task 6: vite-plugin-pwa Configuration + SW Shell

### Completed
- ✓ Installed `vite-plugin-pwa` as dev dependency
- ✓ Configured VitePWA plugin in `client/vite.config.ts` with:
  - `registerType: 'prompt'` (user-initiated updates, iOS DMA compliant)
  - `strategies: 'injectManifest'` (manual manifest injection)
  - `injectManifest` with `globDirectory: 'dist'` and `globPatterns` for precaching
- ✓ Created `client/src/sw.ts` Service Worker shell with `precacheAndRoute(self.__WB_MANIFEST)`
- ✓ Created `client/src/hooks/useSWUpdate.ts` hook:
  - Exports `useSWUpdate()` returning `{ needsUpdate: boolean, updateSW: () => void }`
  - Uses `useRegisterSW` from `virtual:pwa-register/react`
  - Handles `needRefresh` tuple type correctly
- ✓ Updated `client/src/vite-env.d.ts` with `/// <reference types="vite-plugin-pwa/client" />`
- ✓ Build passes: `npm run build:client` → dist/sw.js generated (19KB)
- ✓ Committed: `feat(pwa): configure vite-plugin-pwa with injectManifest strategy`

### Key Learnings
1. **injectManifest vs generateSW**: injectManifest requires explicit `globDirectory` and `globPatterns` configuration
2. **needRefresh type**: The hook returns a tuple `[boolean, () => void]`, not a simple boolean
3. **Virtual module types**: Must add `/// <reference types="vite-plugin-pwa/client" />` to vite-env.d.ts for TypeScript support
4. **registerType: 'prompt'**: Essential for iOS DMA compliance and user control over updates
5. **Build output**: vite-plugin-pwa generates both `sw.js` (main SW) and `registerSW.js` (registration helper)

### Next Steps
- Task 14: Add runtimeCaching and push event handlers to sw.ts
- Task 15: Integrate useSWUpdate hook into App.tsx for update notifications

## Task 8: Group service (CRUD + membership + invitation)
- Added TDD-first service tests with `vi.hoisted + vi.mock` for DB and notification mocking in `server/src/test/group-service.test.ts`.
- Invitation flow works without schema change by using `notifications` entries (`type=group_invitation`, `referenceId=groupId`) as pending invite source of truth.
- `listGroups` returns current member groups plus discoverable public groups user has not joined, then paginates in-memory after dedupe.
- 2026-03-07: groupBonus can be added safely by extending  with a backward-compatible boolean/date parameter and by passing per-source group member sets from matching-service into candidate collection.
- 2026-03-07: groupBonus was added by extending calculateCandidateScore with a backward-compatible boolean/date parameter and by passing per-source group member sets from matching-service into candidate collection.

## Task 13: Push Dispatch Service
- `web-push` default export mocking: `vi.mock('web-push', () => ({ default: mocks.webpush, setVapidDetails: ..., sendNotification: ... }))`
- web-push error has `statusCode` property (not `status`) — 410/404 = expired subscription
- VAPID env vars checked at runtime with `process.env` — use `vi.stubEnv()` in tests
- Promise.allSettled inner function returns `{ status, subId }` for result aggregation
- sendToMultiple loops sequentially per pharmacy (avoids single giant Promise.all)
- Package-lock.json is at monorepo root, not in server/

## Task 14: Service Worker runtime caching + offline fallback
- `injectManifest` worker supports direct Workbox imports (`workbox-routing`, `workbox-strategies`, `workbox-expiration`, `workbox-precaching`) in `client/src/sw.ts`.
- `setCatchHandler` with `request.mode === 'navigate'` plus `matchPrecache('/offline.html')` provides deterministic offline fallback for route navigation.
- API runtime caching should stay GET-only and explicitly exclude `/api/auth/*`, `/api/push/*`, and `/api/csrf-token` to avoid sensitive caching.
- Build verification for this task should include both `dist/sw.js` existence and grep evidence logged to `.sisyphus/evidence/task-14-sw.txt`.


## Task 9: Group Routes — Learnings
- Express 5 `req.params` values are `string | string[]`, use `Array.isArray()` guard in parsers
- Route tests: mock group-service at module level with `vi.hoisted` + `vi.mock`
- Error mapping from JP service messages: 見つかりません→404, のみ/権限/ではありません/できません→403, 既に→409, default→500
- `requireLogin` middleware passed via `app.use('/api/groups', requireLogin, router)` in app.ts, not inside route file
- Zod v4 `safeParse` error format: `parsed.error.issues[0]?.message`
- TypeScript compiler (`tsc --noEmit`) is authoritative over LSP diagnostics (LSP can be stale)

## Task 10: Alert Read/Resolve API

### Key patterns
- `req.user!.id` = pharmacyId throughout the codebase (pharmacy id == user id convention)
- `predictiveAlerts.detailJson` is stored as TEXT (JSON stringified), must `JSON.parse()` on read
- alertType enum: `'near_expiry' | 'excess_stock'` — validated via `predictiveAlertTypeValues` from schema
- Route order matters: `/stats` must be registered BEFORE `/:id` in Express
- Test pattern: `vi.hoisted()` → `vi.mock()` → import → helper functions → tests
- Service tests mock `db.select/update`, route tests mock service functions
- `count()` from drizzle-orm returns `{ value: number }` pattern
- Pre-existing test failures exist in `account-route-deep.test.ts` and `business-hours-route-deep.test.ts` (not caused by alert changes)

### Files created
- `server/src/services/alert-read-service.ts` — 4 functions: listAlerts, getAlertDetail, resolveAlert, getAlertStats
- `server/src/routes/alerts.ts` — 4 endpoints: GET /, GET /stats, GET /:id, PATCH /:id/resolve
- `server/src/test/alert-read-service.test.ts` — 11 tests
- `server/src/test/alert-routes.test.ts` — 18 tests
- app.ts: `app.use('/api/alerts', requireLogin, alertsRoutes)` after groups route
## Task 25: Mobile Responsive Audit

### Findings
- All new pages (GroupListPage, AlertListPage, GroupDetailPage) properly use `AppResponsiveSwitch` with desktop/mobile layouts
- `AppMobileDataCard` provides clean mobile card view as alternative to tables
- MobileBottomNav CSS properly uses `d-lg-none` and `padding-bottom: env(safe-area-inset-bottom)` for iOS safety
- Pages require auth so preview screenshots show login page redirect (expected behavior)

### Issues Fixed
1. **GroupDetailPage header**: Action buttons (設定編集/グループ削除/脱退) could overflow on 375px → added `flex-wrap gap-2` to header container
2. **AlertListPage modal footer**: Action links + close button in fixed row → added `flex-wrap` 
3. **DashboardPage upload status**: Three `Col xs={4}` with long Japanese badge text cramped on 375px → changed to `Col xs={6} sm={4}` (first two) and `Col xs={12} sm={4}` (third)
4. **KPI tile badges on mobile**: Bootstrap badges default to `white-space: nowrap` → added CSS override for `white-space: normal; word-break: break-word` inside `.dl-kpi-tile .badge` at mobile breakpoint

### Mobile Responsive Patterns Observed
- `AppResponsiveSwitch` breakpoint: 991.98px (matches Bootstrap lg)
- `MobileBottomNav.css` adds 56px bottom padding to `.app-main` via `@media (max-width: 991.98px)`
- KPI tiles already have mobile-specific padding/font-size reductions
- `InstallPromptBanner` uses `position-fixed bottom-0` with z-index 1050 (above MobileBottomNav's 1030) — only appears with `beforeinstallprompt` event, minimal overlap concern
