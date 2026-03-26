---
name: Unhandled Rejection Pattern - missing tx.execute in exchange service tests
description: exchange-service-ultra and exchange-service-final tests need matching-refresh-service mock to prevent Unhandled Rejections that pollute other tests
type: feedback
---

completeProposal() calls void triggerMatchingRefreshOnUpload() which calls tx.execute(). If tests mock db.transaction but don't mock matching-refresh-service, an Unhandled Rejection occurs that can cause false failures in other test files.

**Why:** triggerMatchingRefreshOnUpload uses tx.execute() for advisory lock (pg_advisory_xact_lock). The mock tx objects in tests were missing this method, causing TypeError that propagated as Unhandled Rejection.

**How to apply:** When writing tests for exchange-execution-service.completeProposal or any function that calls triggerMatchingRefreshOnUpload:
1. Add vi.mock('../services/matching-refresh-service', () => ({ triggerMatchingRefreshOnUpload: vi.fn().mockResolvedValue(undefined) }))
2. OR add execute: vi.fn().mockResolvedValue(undefined) to the tx mock object

Fix applied to: server/src/test/exchange-service-ultra.test.ts, server/src/test/exchange-service-final.test.ts
