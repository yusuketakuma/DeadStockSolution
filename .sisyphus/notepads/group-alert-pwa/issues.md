# Group Alert PWA - Issues

## Task 8
- Attempted evidence command path from task note (`../../.sisyphus/evidence/...`) did not exist in this worktree layout; used `../.sisyphus/evidence/task-8-tests.txt` from `server/` instead.
- 2026-03-07: Existing matching-service tests use mocked DB chains that may return non-array placeholders; guarded group membership query results with  to keep behavior stable in tests and production.
- 2026-03-07: Existing matching-service tests use mocked DB chains that may return non-array placeholders; guarded group membership query results with Array.isArray(rows) ? rows : [] to keep behavior stable in tests and production.

## Task 14
- `grep -c "api/auth" client/dist/sw.js` returns `1` because the exclusion predicate string is present in minified service worker output; this confirms explicit exclusion logic exists, not auth response caching.


## Plan Compliance Audit (F1)
- 2026-03-07: `POST /api/groups/:id/join` currently calls invitation-accept logic, so joining a `visibility='public'` group fails unless an invite notification exists.
- 2026-03-07: Guardrail violations found: `as any` usage in server tests and empty `catch { /* ignore */ }` blocks (example: `client/src/pages/MatchingPage.tsx`).
