# Prioritized Backlog (Final Verification)

Date: 2026-02-26
Status: `P0=0`, `P1=0` (remaining: low-priority only)

1. P2 Testing: Add direct DNS pinning dispatcher tests
- Target: `server/src/utils/network-utils.ts:239`
- Related callers: `server/src/services/drug-master-scheduler.ts:231`, `server/src/services/drug-package-scheduler.ts:214`
- Minimal follow-up: unit tests for host mismatch/family filtering/lookup-all and scheduler dispatcher wiring checks.

2. P2 Testing: Expand refresh queue retry/stale-reclaim coverage
- Target: `server/src/services/matching-refresh-service.ts:169`
- Related tests: `server/src/test/matching-refresh-service.test.ts:72`
- Minimal follow-up: stale-claim timeout reclaim, `nextRetryAt` progression, and max-attempt terminal-case tests.

3. P2 Reliability: Revisit upload-confirm availability tradeoff under enqueue failure
- Target: `server/src/routes/upload-parser.ts:213`
- Related behavior test: `server/src/test/upload-route.test.ts:222`
- Minimal follow-up: evaluate outbox/best-effort enqueue path if product policy prefers upload acceptance over strict atomic coupling.
