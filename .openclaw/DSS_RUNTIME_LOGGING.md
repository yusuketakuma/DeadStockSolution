# DSS Runtime Logging

`dss-manager` should keep a lightweight local case log so OpenClaw-side behavior can be audited against app-side state.

`dds-agent-runner` should also keep a machine-readable latest-work-item snapshot so runner-side claim /
attachment / callback state can be cross-checked quickly during incident review.

## Log target

- local path: `~/.openclaw/agents/dss-manager/runtime/case-state.ndjson`
- runner snapshot path: `~/.openclaw/agents/dds-agent-runner/runtime/current-work-item.json`
- health monitor summary path: `~/.openclaw/runtime/openclaw-ops/openclaw-connection-run-*.json`
- buffered error path: `~/.openclaw/runtime/dss-alerts/error-buffer.ndjson`
- codex repair result path: `~/.openclaw/runtime/dss-codex/results.ndjson`

If the file or directory does not exist, create it before first append.

## Append rule

Append one JSON line whenever any of these happens:

- intake accepted
- state transition
- question sent
- follow-up resumed
- implementation started
- PR opened
- terminal completion
- terminal failure
- webhook retry scheduled

## Suggested schema

```json
{
  "ts": "2026-03-23T12:00:00.000Z",
  "requestId": 41,
  "threadId": "thread-41",
  "source": "user_request",
  "fromState": "analyzing",
  "toState": "implementing",
  "action": "callback.implementing",
  "summary": "CSV export bug fix implementation started",
  "branchName": "dss/request-20260323-csv-export",
  "prUrl": null,
  "retryCount": 0
}
```

## DSS monitor schema additions

`run-openclaw-connection-operation.sh` and `dss-ci-monitor.sh` now emit a richer runtime schema
(`dss-runtime-v2`) for OpenClaw-side diagnostics.

### Buffered error entry

```json
{
  "ts": "2026-04-08T06:00:00Z",
  "schema": "dss-runtime-v2",
  "source": "dss-ci-monitor",
  "component": "github-actions",
  "severity": "error",
  "category": "ci",
  "event": "ci_failure",
  "code": "ci_failure",
  "msg": "CI失敗: unit-test (main) https://example.invalid/run/1",
  "context": {
    "repo": "yusuketakuma/DeadStockSolution",
    "workflowRunId": "1",
    "workflowName": "unit-test",
    "branch": "main",
    "url": "https://example.invalid/run/1"
  },
  "artifacts": {
    "errorBuffer": "/Users/yusuke/.openclaw/runtime/dss-alerts/error-buffer.ndjson"
  }
}
```

### Codex result entry

```json
{
  "ts": "2026-04-08T06:05:00Z",
  "schema": "dss-runtime-v2",
  "source": "dss-health-monitor",
  "component": "codex-dispatch",
  "status": "failed",
  "type": "health-degraded",
  "summary": "codex auto-fix dispatch failed",
  "log": "/Users/yusuke/.openclaw/runtime/dss-codex/logs/20260408-150500-health-degraded.log",
  "errorHash": "abc123",
  "attempt": 1,
  "maxAttempts": 3,
  "dedupWindowSec": 7200,
  "context": {
    "runId": "20260408-150500",
    "baseUrl": "https://dead-stock-solution.vercel.app",
    "status": "degraded",
    "reason": "execution_failed"
  },
  "artifacts": {
    "summaryPath": "/Users/yusuke/.openclaw/runtime/openclaw-ops/openclaw-connection-run-20260408-150500.json"
  }
}
```

### Health summary additions

`openclaw-connection-run-*.json` keeps the existing top-level status fields and now also includes:

- `schema`, `source`, `runId`
- `runtime` (`script`, `rootDir`, `runnerDir`, `statePath`, `hostName`)
- `notifications` (`telegramDmEnabled`, `telegramGroupEnabled`, `codexAutofixEnabled`)
- `thresholds` (`awaitingUserWarning`, `awaitingUserCritical`)
- `healthHttpCode`
- `diagnostics` (`preflightLogTail`, `runnerLogTail`)
- enriched `artifacts` (`alertLog`, `healthSnapshot`, `reasonsLog`)

## Rules

- use append-only logging
- keep summaries short and factual
- never write secrets, tokens, cookies, or webhook signatures
- if a retry occurs, log both the failure and the scheduled retry step
- keep runner snapshot fields stable enough that humans and scripts can diff them between retries
- OpenClaw-side inspection should prefer `~/.openclaw/scripts/dss_runtime_digest.py` for a current digest view
