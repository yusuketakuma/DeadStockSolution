# F2: Code Quality Review
Date: 2026-03-07
Branch: feature/group-alert-pwa
Commit: 0851096 fix(groups): fix API method mismatches and public group join flow

## Files Reviewed (NEW files added by this branch)

### Server (production code)
- `server/src/services/group-service.ts` (549 lines)
- `server/src/services/alert-read-service.ts` (138 lines)
- `server/src/services/push-subscription-service.ts` (183 lines)
- `server/src/services/push-dispatch-service.ts` (159 lines)
- `server/src/routes/groups.ts` (233 lines)
- `server/src/routes/alerts.ts` (117 lines)
- `server/src/routes/push.ts` (90 lines)
- `server/src/types/group.ts` (123 lines)
- `server/src/types/push.ts` (53 lines)
- `server/src/types/alert.ts` (51 lines)

### Client (production code)
- `client/src/pages/GroupListPage.tsx` (346 lines)
- `client/src/pages/GroupDetailPage.tsx` (469 lines)
- `client/src/pages/AlertListPage.tsx` (466 lines)
- `client/src/hooks/usePushSubscription.ts` (143 lines)
- `client/src/hooks/useSWUpdate.ts` (38 lines)
- `client/src/components/layout/MobileBottomNav.tsx` (85 lines)
- `client/src/components/pwa/SWUpdateBanner.tsx` (27 lines)
- `client/src/components/pwa/InstallPromptBanner.tsx` (89 lines)
- `client/src/components/push/PushPermissionBanner.tsx` (55 lines)
- `client/src/components/account/PushNotificationSettings.tsx` (66 lines)
- `client/src/sw.ts` (104 lines)

### Server (test code)
- `server/src/test/group-service.test.ts`
- `server/src/test/group-routes.test.ts`
- `server/src/test/alert-read-service.test.ts`
- `server/src/test/alert-routes.test.ts`
- `server/src/test/push-subscription-service.test.ts`
- `server/src/test/push-dispatch-service.test.ts`
- `server/src/test/push-routes.test.ts`
- `server/src/test/alert-push-integration.test.ts`
- `server/src/test/matching-score-group-bonus.test.ts`

### Client (test code)
- `client/src/test/e2e/group-list-page.test.tsx`
- `client/src/test/e2e/group-detail-page.test.tsx`
- `client/src/test/AlertListPage.test.tsx`
- `client/src/test/components/MobileBottomNav.test.tsx`
- `client/src/test/components/SWUpdateBanner.test.tsx`
- `client/src/test/components/InstallPromptBanner.test.tsx`
- `client/src/test/components/PushPermissionBanner.test.tsx`
- `client/src/test/components/PushNotificationSettings.test.tsx`
- `client/src/test/hooks/usePushSubscription.test.ts`
- `client/src/test/e2e/matching-page-groups.test.tsx`
- `client/src/test/e2e/pharmacy-list-groups.test.tsx`

---

## A. Type Safety: APPROVE ✅

**Findings:**
- **Zero `as any`** across all new files (grep confirmed: 0 matches)
- **Zero `@ts-ignore` / `@ts-nocheck`** across all new files (grep confirmed: 0 matches)
- All service functions have **explicit return types** (e.g., `Promise<GroupDetailResponse>`, `Promise<PushSendResult>`, `Promise<boolean>`)
- All type interfaces defined in dedicated `types/` files with full property typing
- Hook return types explicitly defined via interfaces (`UsePushSubscriptionReturn`, `SWUpdateState`)
- Minor safe type assertions used appropriately:
  - `(error as { statusCode?: number }).statusCode` in push-dispatch-service.ts — narrowing for webpush error, not `as any`
  - `(limit as number)` in normalizePaging after `Number.isInteger()` guard — safe narrowing
  - `as GroupVisibility` in client components after `<Form.Select>` — controlled enum values
  - `as BeforeInstallPromptEvent` in InstallPromptBanner — standard PWA pattern
- DB row types properly inferred via `typeof table.$inferSelect`

**Verdict: No issues.**

---

## B. Error Handling: APPROVE ✅

**Findings:**
- **Zero empty catch blocks** (grep confirmed: 0 matches for `catch\s*\([^)]*\)\s*\{\s*\}`)
- Server routes use centralized `mapErrorToStatus()` to map Japanese error messages to proper HTTP codes (400/403/404/409/500)
- All route catch blocks log via `logger.error()` and return structured `{ error: message }`
- Service functions throw descriptive errors with Japanese messages
- `push-dispatch-service.ts` handles webpush 410/404 by auto-cleaning expired subscriptions
- `group-service.ts sendGroupPush()` catches push failures gracefully with `logger.warn` (non-critical path)
- Client error handling: All async operations have try/catch with user-facing error state
- Intentional silent catches documented with comments:
  - AlertListPage `fetchStats` catch: `// 統計取得失敗はサイレント` (stats non-critical, UI unaffected)
  - InstallPromptBanner localStorage catch: `// localStorage unavailable` (graceful degradation)
  - usePushSubscription permission check catch: falls back to `'prompt'` state
- Push routes return proper status codes: 201 (subscribe), 204 (unsubscribe), 404 (not found), 400 (validation), 500 (server error)

**Verdict: No issues. Error handling is thorough and consistent.**

---

## C. Naming Conventions: APPROVE ✅

**Findings:**
- **Zero generic names** (`temp`, `foo`, `bar`) in new code
- Scoped `data`/`result` variables exist in fetch callbacks and route handlers — acceptable as they are immediately consumed within 1-3 lines
- Function names are descriptive and domain-specific:
  - Server: `createGroup`, `inviteMember`, `acceptInvitation`, `joinPublicGroup`, `mapErrorToStatus`, `parseGroupId`, `normalizePaging`, `toAlertItem`, `mapToRecord`, `isExpiredSubscriptionError`
  - Client: `handleInviteMember`, `handleConfirmAction`, `visibilityLabel`, `roleBadgeBg`, `parseAffectedItems`, `formatDateTime`, `urlBase64ToUint8Array`
- Type/interface names are specific: `GroupDetailResponse`, `PushSubscriptionPayload`, `AlertListResponse`, `MemberListResponse`, `PushPermissionState`
- **Japanese UI text** for all user-facing strings ✅
- **English code identifiers** throughout ✅
- Consistent with existing codebase patterns (e.g., `AppButton`, `AppAlert`, `AppDataPanel`, `PageShell`, `ScrollArea`)

**Verdict: No issues. Naming is clean and domain-specific.**

---

## D. No console.log: APPROVE ✅

**Findings:**
- **Zero `console.log`** in all new files (server and client)
- **Zero `console.log`** in server production code
- One `console.error` found in `client/src/hooks/useSWUpdate.ts` line 16:
  ```typescript
  onRegisterError(error) {
    console.error('SW registration error:', error);
  }
  ```
  **Assessment:** This is the `onRegisterError` callback from `vite-plugin-pwa`'s `useRegisterSW`. It fires only when SW registration completely fails (a very rare edge case). Client-side code has no structured logger service available, and this is the standard pattern recommended by vite-plugin-pwa documentation. **Acceptable.**
- Server-side code consistently uses `logger.warn` / `logger.error` / `logger.info` from the logger service ✅
- Pre-existing `console.warn` in `database-url.ts` and `timeline.ts` are NOT in new files (out of scope)

**Verdict: No violations. The single `console.error` is in a SW registration error handler and follows the standard PWA pattern.**

---

## E. Test Coverage: APPROVE ✅

**Findings:**

### Server tests (all new services and routes covered):
| Source File | Test File(s) | Coverage |
|---|---|---|
| `group-service.ts` | `group-service.test.ts` | ✅ |
| `alert-read-service.ts` | `alert-read-service.test.ts` | ✅ |
| `push-subscription-service.ts` | `push-subscription-service.test.ts` | ✅ |
| `push-dispatch-service.ts` | `push-dispatch-service.test.ts` | ✅ |
| `routes/groups.ts` | `group-routes.test.ts` | ✅ |
| `routes/alerts.ts` | `alert-routes.test.ts` | ✅ |
| `routes/push.ts` | `push-routes.test.ts` | ✅ |
| (integration) | `alert-push-integration.test.ts` | ✅ |
| (matching group bonus) | `matching-score-group-bonus.test.ts` | ✅ |

### Client tests (all new pages, components, and hooks covered):
| Source File | Test File(s) | Coverage |
|---|---|---|
| `GroupListPage.tsx` | `e2e/group-list-page.test.tsx` | ✅ |
| `GroupDetailPage.tsx` | `e2e/group-detail-page.test.tsx` | ✅ |
| `AlertListPage.tsx` | `AlertListPage.test.tsx` | ✅ |
| `MobileBottomNav.tsx` | `components/MobileBottomNav.test.tsx` | ✅ |
| `SWUpdateBanner.tsx` | `components/SWUpdateBanner.test.tsx` | ✅ |
| `InstallPromptBanner.tsx` | `components/InstallPromptBanner.test.tsx` | ✅ |
| `PushPermissionBanner.tsx` | `components/PushPermissionBanner.test.tsx` | ✅ |
| `PushNotificationSettings.tsx` | `components/PushNotificationSettings.test.tsx` | ✅ |
| `usePushSubscription.ts` | `hooks/usePushSubscription.test.ts` | ✅ |
| (matching with groups) | `e2e/matching-page-groups.test.tsx` | ✅ |
| (pharmacy list groups) | `e2e/pharmacy-list-groups.test.tsx` | ✅ |

**All tests passing:** Server 3979 (1 pre-existing skip), Client 441. Typecheck: 0 errors.

**Verdict: 100% coverage of new features. Every new service, route, page, component, and hook has corresponding tests.**

---

## F. Architectural Consistency: APPROVE ✅

**Findings:**

### Route → Service pattern ✅
- `routes/groups.ts` delegates all logic to `groupService.*` functions
- `routes/alerts.ts` delegates all logic to `alertReadService.*` functions
- `routes/push.ts` delegates all logic to `pushSubscriptionService.*` functions
- Zero business logic in route handlers — only validation, delegation, and response formatting

### React component patterns ✅
- All pages use `PageShell` + `ScrollArea` layout wrapper
- All pages use `AppResponsiveSwitch` for desktop/mobile rendering
- Reusable components used throughout: `AppButton`, `AppAlert`, `AppDataPanel`, `AppTable`, `AppMobileDataCard`, `AppEmptyState`, `InlineLoader`, `LoadingButton`, `ConfirmActionModal`, `AppModalShell`
- Tab navigation uses React Bootstrap `Tab.Container` + `Nav` consistently

### API method correctness ✅
- `GroupDetailPage.tsx` line 162: `await api.put(`/groups/${id}`, {...})` — **PUT** ✅ (not PATCH)
- `GroupDetailPage.tsx` line 106: `await api.post(`/groups/${id}/invite`, { pharmacyId })` — **/invite** ✅ (not /members)
- `groups.ts` join route line 169: `await groupService.joinPublicGroup(groupId, req.user!.id)` — **joinPublicGroup** ✅ (not acceptInvitation)

### Zod validation ✅
- `groups.ts` and `push.ts` use Zod schemas for request body validation
- Validation errors return 400 with descriptive messages

### Type definitions ✅
- Types organized in `server/src/types/` with separate files per domain (group.ts, push.ts, alert.ts)
- DB row types inferred from Drizzle schema, not hand-written

**Verdict: Perfect alignment with existing architectural patterns.**

---

## G. PWA Compliance: APPROVE ✅

**Findings:**

### registerType: 'prompt' ✅
- `vite.config.ts` line 36: `registerType: 'prompt'` (NOT 'autoUpdate')
- `SWUpdateBanner.tsx` implements user-facing update prompt

### Auth excluded from SW caching ✅
- `sw.ts` lines 31-34:
  ```typescript
  !url.pathname.startsWith('/api/auth/') &&
  !url.pathname.startsWith('/api/push/') &&
  !url.pathname.includes('/api/csrf-token'),
  ```
  Auth, push, and CSRF endpoints all excluded from stale-while-revalidate cache

### No Background Sync ✅
- Grep confirmed: zero matches for `BackgroundSync`, `backgroundSync`, `BackgroundSyncPlugin`

### Additional PWA compliance:
- `strategies: 'injectManifest'` with custom `sw.ts` ✅
- Static assets cached with `CacheFirst` strategy (30-day expiry) ✅
- API GET responses cached with `StaleWhileRevalidate` (50 entries max) ✅
- Images cached with `CacheFirst` (100 entries, 7-day expiry) ✅
- Offline fallback via `setCatchHandler` → `/offline.html` ✅
- Push notification handler with `showNotification` ✅
- Notification click handler with window focus/open logic ✅
- Install prompt banner with 7-day snooze ✅

**Verdict: Full PWA compliance with all required constraints met.**

---

## Overall Verdict: APPROVE ✅

### Summary
All 7 review categories pass. The code added by the `feature/group-alert-pwa` branch demonstrates:

1. **Strong type safety** — Zero `as any`, zero `@ts-ignore`, explicit return types on all functions
2. **Robust error handling** — No empty catches, proper HTTP status mapping, graceful degradation
3. **Clean naming** — Domain-specific identifiers, no generic variable names, Japanese UI / English code
4. **No console.log leaks** — Server uses structured logger, client uses `console.error` only for SW registration failure
5. **Complete test coverage** — All 7 server services/routes and 11 client components/pages/hooks have dedicated tests
6. **Consistent architecture** — Route→Service delegation, shared UI components, correct API methods
7. **PWA compliance** — prompt-based updates, auth/push/csrf excluded from cache, no background sync

### Minor observations (informational, not blocking):
- `useSWUpdate.ts` uses `console.error` for SW registration failures — standard PWA pattern, acceptable for client-side code
- `AlertListPage.tsx` defines local type aliases for `AlertItem`/`AlertListResponse`/`AlertStats` instead of importing from server types — valid pattern to avoid cross-workspace imports in the client

### Evidence
- Server tests: 3979 passing (1 pre-existing skip)
- Client tests: 441 passing
- TypeScript: 0 errors
- All bug fixes verified: `api.put` (not patch), `/invite` route (not /members), `joinPublicGroup()` (not acceptInvitation)
