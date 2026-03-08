# F3: Manual QA Report
Date: 2026-03-07
Branch: feature/group-alert-pwa
Commit: 0851096 fix(groups): fix API method mismatches and public group join flow

## Scenario 1: Build Verification
Result: **PASS**

| Command | Result |
|---------|--------|
| `npm run typecheck` | Exit 0 — 0 errors (server + client) |
| `npm run build:client` | Exit 0 — Vite build success, 56 chunks + SW (sw.js), 66 precache entries |
| `npm run build:server` | Exit 0 — `tsc -p tsconfig.build.json` clean |

## Scenario 2: Full Test Suite
Result: **PASS**

| Suite | Files | Tests Passed | Skipped | Duration |
|-------|-------|-------------|---------|----------|
| Server | 252 passed, 1 skipped | **3979** | 1 (performance-regression, pre-existing) | 13.66s |
| Client | 54 passed | **441** | 0 | 6.09s |

All thresholds met: Server ≥ 3979 ✅, Client ≥ 441 ✅

## Scenario 3: Route Registration
Result: **PASS**

### Server (`server/src/app.ts`)
```
Line 288: app.use('/api/groups', requireLogin, groupsRoutes);    ✅
Line 289: app.use('/api/alerts', requireLogin, alertsRoutes);    ✅
Line 290: app.use('/api/push', pushRoutes);                      ✅ (per-route auth)
```

Note: Push routes apply `requireLogin` at per-route level (subscribe/unsubscribe) rather than app-level, which is correct — the VAPID public key endpoint (`GET /api/push/vapid-public-key`) is intentionally public.

### Client (`client/src/routes/route-config.tsx`)
```
Line 30: const GroupListPage = lazy(() => import('../pages/GroupListPage'));
Line 31: const GroupDetailPage = lazy(() => import('../pages/GroupDetailPage'));
Line 32: const AlertListPage = lazy(() => import('../pages/AlertListPage'));
Line 77: { path: '/groups', access: 'protected', useLayout: true, component: GroupListPage }
Line 78: { path: '/groups/:id', access: 'protected', useLayout: true, component: GroupDetailPage }
Line 79: { path: '/alerts', access: 'protected', useLayout: true, component: AlertListPage }
```
All routes registered with lazy loading, protected access, and correct components. ✅

## Scenario 4: PWA Artifacts
Result: **PASS**

| File | Status |
|------|--------|
| `client/public/manifest.json` | ✅ exists (941 bytes) |
| `client/public/offline.html` | ✅ exists (396 bytes) |
| `client/public/icons/` | ✅ 8 icons present (icon-192, icon-512, maskable variants, apple-touch-icon) |

## Scenario 5: SW Caching Rules
Result: **PASS**

File: `client/src/sw.ts` (104 lines)

| Rule | Code | Status |
|------|------|--------|
| Auth routes excluded | `!url.pathname.startsWith('/api/auth/')` (L32) | ✅ |
| Push routes excluded | `!url.pathname.startsWith('/api/push/')` (L33) | ✅ |
| CSRF excluded | `!url.pathname.includes('/api/csrf-token')` (L34) | ✅ |
| Offline fallback | `matchPrecache('/offline.html')` in `setCatchHandler` (L60) | ✅ |

Additional SW features verified:
- Static assets: CacheFirst with 30-day expiry ✅
- API responses: StaleWhileRevalidate with 50-entry max ✅
- Images: CacheFirst with 100 entries, 7-day expiry ✅
- Push event listener with notification display ✅
- Notification click handler with window focus/open ✅

## Scenario 6: Mobile Bottom Nav Integration
Result: **PASS**

File: `client/src/components/Layout.tsx`
```
Line 6:  import MobileBottomNav from './layout/MobileBottomNav';
Line 7:  import './layout/MobileBottomNav.css';
Line 35: <MobileBottomNav />
```
Component imported, styled, and rendered within Layout. ✅

## Scenario 7: Alert Widget in Dashboard
Result: **PASS**

File: `client/src/pages/DashboardPage.tsx`
```
Line 42:  unresolvedCount: number;           // Type definition
Line 67:  api.get<AlertStatsData>('/alerts/stats', ...)  // API fetch
Line 216: {alertStats && alertStats.unresolvedCount > 0 && (  // Conditional render
Line 225: <div className="dl-kpi-value">{alertStats.unresolvedCount}</div>  // Display
```
Alert widget fetches `/alerts/stats`, types `unresolvedCount`, renders conditionally. ✅

## Scenario 8: Group Join Flow
Result: **PASS**

File: `server/src/routes/groups.ts`
```
Line 162: router.post('/:id/join', ...)    → joinPublicGroup()     ✅ (NOT acceptInvitation)
Line 180: router.post('/:id/accept', ...)  → acceptInvitation()    ✅ (correct separation)
```
Join and accept flows correctly separated. ✅

## Scenario 9: GroupDetailPage API Correctness
Result: **PASS**

File: `client/src/pages/GroupDetailPage.tsx`
```
Line 162: await api.put(`/groups/${id}`, {...})              ✅ (uses PUT, NOT PATCH)
Line 106: await api.post(`/groups/${id}/invite`, {...})      ✅ (uses /invite, NOT /members)
```
Additional verified endpoints:
- `api.get(/groups/${id})` for detail fetch (L58) ✅
- `api.delete(/groups/${id})` for group deletion (L124) ✅
- `api.delete(/groups/${id}/members/${pharmacyId})` for member removal (L129) ✅
- `api.post(/groups/${id}/leave)` for self-leave (L133) ✅

## Scenario 10: VAPID Push Dispatch Chunking
Result: **PASS**

File: `server/src/services/push-dispatch-service.ts` (159 lines)

| Requirement | Code | Status |
|-------------|------|--------|
| `Promise.allSettled()` for per-pharmacy | L64: `const results = await Promise.allSettled(subscriptions.map(...))` | ✅ |
| 410 Gone → subscription deletion | L78-83: `if (isExpiredSubscriptionError(error)) { await db.delete(...) }` | ✅ |
| Also handles 404 | L27: `statusCode === 410 \|\| statusCode === 404` | ✅ |
| NOT single giant Promise.all | L151-156: `for (const pharmacyId of pharmacyIds) { ... sendToPharmacy(...) }` | ✅ |

Architecture: `sendToMultiple()` iterates pharmacyIds sequentially, calling `sendToPharmacy()` per pharmacy. Each `sendToPharmacy()` uses `Promise.allSettled()` for concurrent subscription sends within a single pharmacy. This avoids a single giant Promise.all across all subscriptions from all pharmacies. ✅

---

## Overall Verdict: APPROVE ✅

**Summary**: All 10 QA scenarios pass. The `feature/group-alert-pwa` branch builds cleanly (typecheck 0 errors, client/server builds succeed), all tests pass (server 3979, client 441), all route registrations are correct, PWA artifacts are complete, service worker caching rules properly exclude auth/push/csrf paths, mobile bottom nav is integrated into Layout, alert widget renders in dashboard, group join flow correctly separates join vs accept, GroupDetailPage uses correct HTTP methods and endpoints, and push dispatch uses safe chunked Promise.allSettled pattern with stale subscription cleanup.

No blocking issues found. Branch is ready for merge.
