# Timeline Feature — Issues & Gotchas

## 2026-02-28

### Timestamp column name inconsistency (RESOLVED)
- exchangeProposals uses `proposedAt` (not `createdAt`)
- exchangeHistory uses `completedAt` (not `createdAt`)
- deadStockItems uses `expirationDateIso` for expiry logic
- Solution: per-table mapping functions in aggregators

### Naming consistency fixed (RESOLVED)
- Momus flagged: Task 12 said `mark-read`, Task 6 defined `mark-viewed`
- Fixed: All references now use `mark-viewed` and `markViewed`

### activityLogs detail field format
- Pipe-separated: 'proposalId=X|status=Y'
- Must parse this format when building timeline events from activityLogs

### Test considerations
- Server tests: vitest (run with: npm run test --workspace=server)
- Client tests: vitest (run with: npm run test --workspace=client)
- Each wave task must have TDD tests first

## 2026-02-28 T3 Aggregators

### Gotchas (RESOLVED)
- Schema uses `notifications.pharmacyId` (not `toPharmacyId`), so notification fetcher must filter with `pharmacyId`.
- `adminMessages` fetcher requirement is global fetch (no pharmacy filter), unlike unread-count logic in notification routes.
- Expiry risk filter is `expirationDateIso <= today+3` and `isAvailable=true`; do not add unrelated lower-bound constraints.
