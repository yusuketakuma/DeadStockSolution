# Issues Log

## 2026-03-08: Fixed 3 failing client tests (+ 4 collateral)

### Files modified (components):
- `client/src/components/timeline/DashboardTimeline.tsx` — Added date grouping (今日/昨日/YYYY/M/D headers with `data-testid="date-header"`), added `data-testid="load-more-button"` to もっと見る button
- `client/src/components/timeline/SmartDigest.tsx` — Header changed to "今日やること", empty state "今日のタスクはありません 🎉" when status=null & events=[], added `data-testid="digest-item"` + `data-testid="priority-badge-{priority}"`, replaced `<button>` with `<Link>` for navigation, added priority sorting (critical > high), changed critical badge label from "緊急" to "重要"

### Files modified (tests):
- `client/src/test/e2e/proposal-detail-comments.test.tsx` — Changed mock field `timeline` → `enrichedTimeline` with `eventType: 'status_change'` to match `EnrichedProposalTimelineEvent` type
- `client/src/test/e2e/smart-digest.test.tsx` — Updated critical badge expectation from "緊急" to "重要" (collateral fix)
- `client/src/test/e2e/dashboard.test.tsx` — Updated header expectation from "今日のアクション" to "今日やること" (collateral fix)

### Results:
- `npm run test:client` → 59 files, 484 tests passed, 0 failures
- `npm run typecheck` → 0 errors
- LSP diagnostics → 0 errors on all changed files
