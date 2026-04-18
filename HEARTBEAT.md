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
