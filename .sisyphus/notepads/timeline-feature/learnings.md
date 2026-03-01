# Timeline Feature — Learnings

## 2026-02-28 Session Start

### Architecture Decisions
- Worktree: /Users/yusuke/DeadStockSolution-timeline (branch: feature/timeline)
- Test framework: vitest for both server and client
- Pattern: parallel-query + JS-merge (NOT SQL UNION) — follow notifications.ts L250-336
- Unread tracking: pharmacies.lastTimelineViewedAt column (anything newer = unread)
- Polling: 30s interval + visibilitychange (keep existing pattern from NotificationContext)

### Key File Locations
- Schema: server/src/db/schema.ts (pharmacies table L47-70, notifications L577-597)
- Pattern to follow: server/src/routes/notifications.ts L250-336
- buildNextAction(): client/src/components/dashboard/types.ts L127-255
- NotificationContext (to replace): client/src/contexts/NotificationContext.tsx (68 lines)
- DashboardPage (to update): client/src/pages/DashboardPage.tsx (179 lines)
- ProposalDetailPage (to update): client/src/pages/ProposalDetailPage.tsx (607 lines)
- Header (to update): client/src/components/Header.tsx (261 lines)
- App.tsx (to update): client/src/App.tsx (84 lines)

### Must NOT violations
- No WebSocket/SSE
- No new DB tables (only lastTimelineViewedAt column)
- No SQL UNION queries
- No framer-motion animations
- No AI/ML priority logic
- No changes to DashboardStatusCards
- No deletion of /api/notifications endpoint

### Wave Execution Plan
- Wave 1: T1+T2+T3+T4 (parallel, foundation)
- Wave 2: T5+T6+T7 (parallel, after T1+T2+T3 done)
- Wave 3: T8+T9+T10+T11 (parallel, after T7 done)
- Wave 4: T12 first, then T13+T14+T15 parallel
- Final: F1+F2+F3+F4 parallel

## 2026-02-28 T3 Aggregators

### Implementation Learnings
- `timeline-aggregators.ts` uses one fetcher per table with independent select chains; proposal fetch uses two branches (`pharmacyAId` / `pharmacyBId`) merged in JS to avoid SQL UNION.
- Timestamp mapping that must stay strict: `exchangeProposals.proposedAt`, `exchangeHistory.completedAt`, and `deadStockItems` expiry risk events stamped with `new Date().toISOString()`.
- Stable action path mapping was encoded at fetcher level for raw events: `/`, `/matching`, `/proposals/{id}`, `/upload`, `/inventory`.

## 2026-02-28 T5 Timeline Service

### Implementation Learnings
- `timeline-service.ts` can stay simple and deterministic by centralizing fan-out into a single `fetchAllRawEvents()` helper that runs all 9 aggregators with `Promise.all()` and flattens once.
- Unread count logic is lightweight and route-safe when based on `pharmacies.lastTimelineViewedAt` + raw event timestamp comparison, without introducing per-event read markers.
- `getSmartDigest` should compose `getTimeline` (instead of duplicating fan-out/sort logic) to keep ordering and future priority behavior consistent.
## [2026-02-28] T12: TimelineContext
- Built `TimelineProvider` with `useTimeline()` and backward-compatible `useNotifications()` in one module to replace NotificationContext data responsibilities.
- Copied NotificationContext's polling + visibilitychange behavior exactly (`30_000ms`, visible-only interval fetch, visibility listener refresh) while resetting state when unauthenticated.
- Implemented `fetchAll` as best-effort chained calls (unread count, critical/high digest mapping, first timeline page) and covered paging append + markViewed behavior via TDD.

## [2026-02-28] T15: Header + App.tsx provider swap
- Swapped `NotificationProvider` → `TimelineProvider` in App.tsx (lines 4, 79-81)
- Swapped `useNotifications()` → `useTimeline()` in Header.tsx (line 7, 60)
- Updated badge title from `${unreadCount}件の未読通知` → `${unreadCount}件の未読` (line 221)
- TypeScript check: 0 errors
- Tests: 172 passed (21 test files)
- Commit: 75ff026 feat(client): rewire Header badge and App provider to TimelineContext

## [2026-02-28] T13: DashboardPage integration
- Replaced DashboardNotices + DashboardNextAction with SmartDigest + DashboardTimeline from useTimeline()
- Removed: useNavigate, useNotifications, useMemo, NotificationsResponse, Notice, buildNextAction, resolveNoticeReadEndpoint, sanitizeInternalPath, handleNoticeClick, notifications state, nextAction memo
- Kept: /upload/status and /inventory/dead-stock/risk API calls via useAsyncResource, DashboardStatusCards, risk panel unchanged
- fetchDashboardData simplified from 3 parallel calls to 2 (removed /notifications)
- Only destructured `{ data }` from useAsyncResource since loading/error/reload became unused after removing notification UI
- Test update: removed 11 notification/next-action tests from dashboard.test.tsx, added 2 new tests (SmartDigest section, DashboardTimeline section)
- useTimeline() works without TimelineProvider in tests — falls back to createContext defaults (empty arrays, loading=false)
- File reduced from 179 to 120 lines; test file from 864 to 547 lines

## [2026-02-28] T14: ProposalDetailPage integration
- Added internal filter state to ProposalTimeline.tsx (useState + AppSelect)
- Replaced ProposalTimelineEvent local interface with EnrichedProposalTimelineEvent from types/timeline.ts
- Updated ProposalDetail.enrichedTimeline field (was timeline)
- Removed timelineFilter state and filteredTimeline computed var from ProposalDetailPage
- Replaced <ul> timeline with <ProposalTimeline events={data.enrichedTimeline ?? []} currentPharmacyId={user?.id ?? 0} />
- AppSelect kept in ProposalDetailPage (still used for feedback rating); removed unused toViewerStatusLabel and statusLabelMap
- TypeScript: 0 errors
- Tests: all pass
- Commit: 02e7fe2

## [2026-02-28] P1 Bug Fix: SmartDigest priority filter

### Bug Description
- **File**: `client/src/contexts/TimelineContext.tsx` line 50
- **Issue**: Single API call with `priority: 'critical,high'` (comma-separated string)
- **Root Cause**: Server validates priority against Set(['critical','high','medium','low']) — single values only. The string 'critical,high' is NOT in the set, so it falls through to undefined, fetching ALL events unfiltered
- **Impact**: SmartDigest showed arbitrary events instead of only critical/high priority items

### Solution
Replaced single call with two parallel Promise.all() calls:
```tsx
const [criticalRes, highRes] = await Promise.all([
  timelineApi.getTimeline({ priority: 'critical', limit: 5 }),
  timelineApi.getTimeline({ priority: 'high', limit: 5 }),
]);
const digestEvents = [...criticalRes.events, ...highRes.events]
  .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  .slice(0, 5);
```

### Test Updates
- Updated mock in `TimelineContext.test.tsx` to handle two separate API calls
- Replaced old mock: `/api/timeline?limit=5&priority=critical%2Chigh`
- Added two new mocks:
  - `/api/timeline?limit=5&priority=critical` → returns critical events
  - `/api/timeline?limit=5&priority=high` → returns high events

### Verification
- TypeScript: 0 errors
- Tests: 163 passed (all client tests)
- Commit: fc501d5 fix(client): fix SmartDigest priority filter in TimelineContext

### Key Learning
When API validation is strict (Set-based), client-side composition (Promise.all + merge) is safer than comma-separated strings. Always verify server-side validation rules before constructing API parameters.
