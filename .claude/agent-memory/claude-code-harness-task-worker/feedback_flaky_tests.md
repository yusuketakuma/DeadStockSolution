---
name: Flaky Test Pattern - vi.resetModules in createApp
description: 32+ route test files use vi.resetModules() inside createApp() (not in beforeEach), causing non-deterministic test interference in bulk runs
type: feedback
---

When vi.resetModules() is called inside createApp() (test body), vitest's single-worker thread pool can cause non-deterministic failures in bulk runs. Symptoms: tests return 404 when routes should be registered, failures vary each run.

**Why:** vitest threads pool with maxWorkers:1 shares some internal state between test files' VM contexts despite isolate:true. vi.resetModules() in test body (not beforeEach) can interfere with module caching of concurrently-registered mocks.

**How to apply:** When encountering "404 in route tests only during bulk run", check if createApp() contains vi.resetModules(). The pattern exists in 32+ files and is a known structural issue. Fix is to move vi.resetModules() + vi.doMock() to beforeEach (not inside test body helpers).

Root cause confirmed: git stash showed flakiness existed before my changes. Fixes to Unhandled Rejections reduced severity but did not eliminate the problem entirely.
