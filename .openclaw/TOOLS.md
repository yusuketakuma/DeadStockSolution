# TOOLS.md - DeadStockSolution

## Workspace

- Repo root: `/Users/yusuke/workspace/DeadStockSolution`
- Production-focused OpenClaw agent: `dss-manager`
- Default PR base branch: `review`
- Preferred branch prefix: `dss/`

## Verification

- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Server tests: `npm run test --workspace=server`
- Client tests: `npm run test --workspace=client`

## Key Files

- Handoff format: `server/src/services/openclaw-service.ts`
- User report route: `server/src/routes/requests.ts`
- OpenClaw callback route: `server/src/routes/openclaw.ts`
- Realtime stream route: `server/src/routes/realtime.ts`
- OpenClaw commands route: `server/src/routes/openclaw-commands.ts`
- Log context assembly: `server/src/services/openclaw-log-context-service.ts`
- OpenClaw case state model: `.openclaw/DSS_STATE_MACHINE.md`
- OpenClaw webhook contract: `.openclaw/DSS_WEBHOOK_CONTRACT.md`
- OpenClaw runtime log policy: `.openclaw/DSS_RUNTIME_LOGGING.md`

## Operating Notes

- Prefer `rg` / `rg --files` for search.
- Respect existing uncommitted user changes.
- Avoid destructive git commands.
- Keep fixes production-relevant unless the task explicitly says otherwise.
- Local DSS case log target: `~/.openclaw/agents/dss-manager/runtime/case-state.ndjson`
