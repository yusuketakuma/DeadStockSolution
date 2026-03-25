# DSS Runtime Logging

`dss-manager` should keep a lightweight local case log so OpenClaw-side behavior can be audited against app-side state.

`dds-agent-runner` should also keep a machine-readable latest-work-item snapshot so runner-side claim /
attachment / callback state can be cross-checked quickly during incident review.

## Log target

- local path: `~/.openclaw/agents/dss-manager/runtime/case-state.ndjson`
- runner snapshot path: `~/.openclaw/agents/dds-agent-runner/runtime/current-work-item.json`

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

## Rules

- use append-only logging
- keep summaries short and factual
- never write secrets, tokens, cookies, or webhook signatures
- if a retry occurs, log both the failure and the scheduled retry step
- keep runner snapshot fields stable enough that humans and scripts can diff them between retries
