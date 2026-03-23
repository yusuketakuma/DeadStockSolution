# DSS Webhook Contract

This file defines how `dss-manager` should call DeadStockSolution webhook endpoints.

## Principle

- use `reportUrl` for dialogue and structured progress
- use `callbackUrl` for coarse status transitions
- keep payloads retry-safe and semantically stable

## callbackUrl

Use `callbackUrl` only for:

- `status=implementing`
- `status=completed`

Recommended payload fields:

- `requestId`
- `status`
- `threadId`
- `summary`
- `implementationBranch`

Rules:

- `completed` should be sent to `callbackUrl`, not `reportUrl`, unless `callbackUrl` is unavailable
- keep `summary` stable across retries
- do not send speculative completion

## reportUrl

Use `reportUrl` for:

- `kind=question`
- `kind=analysis`
- `kind=status_update`
- `kind=pr_opened`
- `kind=failed`

Recommended payload fields:

- `requestId`
- `kind`
- `message`
- `workflowStatus`
- `threadId`
- `summary`
- `branchName`
- `prUrl`
- `prNumber`

Rules:

- `question` must contain only the minimum missing delta
- `analysis` should summarize the current hypothesis or implementation plan
- `status_update` should be short and non-duplicative
- `pr_opened` must include `branchName`, `prUrl`, and `prNumber`
- `failed` must include a concrete blocking reason and the next best recovery step

## Idempotency

Retries must preserve the same semantic payload.

Treat these as stable dedupe units:

- `question`: `requestId + kind + threadId + message`
- `analysis`: `requestId + kind + threadId + message`
- `status_update`: `requestId + kind + threadId + message`
- `pr_opened`: `requestId + kind + threadId + prUrl + prNumber`
- `completed`: `requestId + status + threadId + summary`
- `failed`: `requestId + kind + threadId + message`

Do not add random wording, timestamps, or changing prose on retries.

## Retry policy

When webhook delivery fails:

1. retry with exponential backoff
2. preserve the exact same payload unless new facts materially change the case
3. prefer backoff steps like `3s, 10s, 30s, 60s, 300s`
4. do not mark the case complete locally until the terminal webhook is accepted or explicit operator policy says otherwise

## Recommended sequence

### User report with missing info

1. `reportUrl kind=status_update`
2. `reportUrl kind=question`
3. user follow-up arrives
4. `reportUrl kind=status_update`
5. `reportUrl kind=analysis` or `callbackUrl status=implementing`

### Code-changing task

1. `reportUrl kind=analysis`
2. `callbackUrl status=implementing`
3. implement and verify
4. `reportUrl kind=pr_opened`
5. `callbackUrl status=completed`
