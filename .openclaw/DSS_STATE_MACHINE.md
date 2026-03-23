# DSS Case State Machine

This file defines the canonical DSS case lifecycle for DeadStockSolution.

## Internal states

- `received`
- `analyzing`
- `awaiting_user`
- `implementing`
- `pr_opened`
- `completed`
- `failed`

## App mapping

- `received` -> app `workflowStatus=queued`
- `analyzing` -> app `workflowStatus=analyzing`
- `awaiting_user` -> app `workflowStatus=awaiting_user`
- `implementing` -> app `workflowStatus=implementing`
- `pr_opened` -> app `workflowStatus=pr_opened`
- `completed` -> app `workflowStatus=completed`
- `failed` -> app `workflowStatus=failed`

## Allowed transitions

- `received -> analyzing`
- `analyzing -> awaiting_user`
- `analyzing -> implementing`
- `analyzing -> failed`
- `awaiting_user -> analyzing`
- `awaiting_user -> failed`
- `implementing -> pr_opened`
- `implementing -> failed`
- `pr_opened -> completed`
- `pr_opened -> failed`

Do not move backwards unless the app explicitly restarts the case.

## Follow-up rule

When `source=user_request_follow_up` or `context.followUp` exists:

- keep the same case and same thread
- do not create a new intake
- treat the reply as new evidence for the current missing-info gap
- `awaiting_user -> analyzing` is the default resume transition

## Terminal rule

Only one of these may end the case:

- `completed`
- `failed`

Before a terminal transition, confirm:

- the current summary is accurate
- the latest known branch / PR metadata is attached when code was changed
- no unanswered blocking question remains
