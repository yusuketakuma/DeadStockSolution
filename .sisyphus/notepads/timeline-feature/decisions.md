# Timeline Feature — Decisions

## 2026-02-28

- Unread model: lastTimelineViewedAt on pharmacies table (single column, no per-event isRead tracking)
- Query pattern: parallel Promise.all() + JS sort/merge (proven in notifications.ts)
- Pagination: offset-based "load more" button (NOT infinite scroll)
- Badge click: navigate to "/" (dashboard) - same as existing behavior
- Admin: no timeline, existing badge hidden behavior maintained
- buildNextAction() 129 lines: migrated into SmartDigest priority rules (not deleted)
- mark-viewed endpoint: PATCH /api/timeline/mark-viewed (consistent with Task 6 definition)
- useNotifications() re-export: TimelineContext re-exports for backward compat during migration
