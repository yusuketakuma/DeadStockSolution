# Group Alert PWA - Decisions

## Task 8
- Decided to track pending invitations via `notifications` table only (no schema migration), keyed by invitee `pharmacyId` + `type=group_invitation` + `referenceId=groupId` + `isRead=false`.
- Decided that owner/admin permissions gate invite/remove/role updates, owner-only permission gates delete, and owner cannot leave or be role-downgraded.
- 2026-03-07: Loaded group memberships in  via two-step query (source memberships -> all members by group) and in  via subquery on ; excluded self pharmacy IDs from bonus target set.
- 2026-03-07: Loaded group memberships in findMatchesBatch via two-step query (source memberships -> all members by group) and in findMatches via subquery on groupMembers.groupId; excluded self pharmacy IDs from bonus target set.

## Task 14
- Adopted `CacheFirst` for static assets and images, and `StaleWhileRevalidate` for allowed API GET responses with conservative limits (`maxEntries` 50/100) for iOS Safari cache constraints.
- Chose `offline.html` in `client/public/` and navigation-only catch fallback so non-navigation request failures still surface as normal network errors.
- Implemented push notification and `notificationclick` handling in SW to open notification `data.url` when provided.
