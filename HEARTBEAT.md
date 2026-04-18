# DeadStockSolution Heartbeat Checklist

Heartbeat here is for monitoring and triage only.

## Default Rule
- Check the latest DSS health artifacts before anything else.
- If inputs are reachable and there is no material change, reply `HEARTBEAT_OK`.
- Do not do feature work or broad repo edits from heartbeat.

## Required Checks
- Read the latest DSS monitoring outputs such as `reports/loops/dss-manager-latest.md` and current cron outputs when present.
- Confirm whether connector, webhook, DDS agent connection, awaiting-user count, and CI status changed.
- Surface only real changes: new breakage, recovered health, new waiting user, or CI regression.

## Allowed Outcomes
- `HEARTBEAT_OK`
- one short degraded summary with the concrete failing subsystem
- one handoff/escalation note when action is needed elsewhere

## Stop Conditions
- If the target system is degraded, summarize the degradation and stop.
- If checks require broad debugging or code changes, leave a handoff and stop.

## Observability Artifacts (autonomous operation)
The `exe-dss-manager` agent maintains the following artifacts outside of
heartbeat (dispatch-driven, not from within heartbeat itself):

- `reports/loops/dss-manager-latest.md` — refreshed by DSS monitoring cron;
  primary health-state source for this heartbeat.
- `reports/status/dss-manager-weekly.md` — weekly summary of processed work
  items, PR counts, question counts, and Autonomy Budget utilization.
- `/Users/yusuke/brain/sources/dss/<YYYY-MM-DD>-<slug>.md` — one note per
  completed work item, ingested into GBrain so future incidents can query
  past patches first.

Heartbeat itself only *reads* the loops artifact; weekly/brain writes happen
during dispatch cycles.

## Autonomy Budget (enforced during dispatch)
Heartbeat surfaces budget-breach signals when they appear in loops output:

- `question` callbacks: <= 3 per 24h
- Same-class PR: <= 1 per 4h
- Cycles on same work-item: <= 3 (4th forces question)
- Consecutive LLM timeouts: <= 3 (shrink context; 4th hands off)

A breach observed during heartbeat is reported as
`DEGRADED:autonomy-budget:<indicator>`.
