# TOOLS.md - DeadStockSolution

## Workspace

- Repo root: `/Users/yusuke/workspace/DeadStockSolution`
- Repo-side OpenClaw contract directory: `/Users/yusuke/workspace/DeadStockSolution/.openclaw`
- Home-side agent bootstrap directory: `~/.openclaw/agents/dss-manager`
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
- DDS remote agent contract: `server/src/services/dds-agent-service.ts`
- User report route: `server/src/routes/requests.ts`
- OpenClaw callback route: `server/src/routes/openclaw.ts`
- Realtime stream route: `server/src/routes/realtime.ts`
- OpenClaw commands route: `server/src/routes/openclaw-commands.ts`
- Log context assembly: `server/src/services/openclaw-log-context-service.ts`
- OpenClaw case state model: `.openclaw/DSS_STATE_MACHINE.md`
- OpenClaw webhook contract: `.openclaw/DSS_WEBHOOK_CONTRACT.md`
- OpenClaw runtime log policy: `.openclaw/DSS_RUNTIME_LOGGING.md`
- OpenClaw preflight checklist: `.openclaw/PREFLIGHT.md`

## Operating Notes

- Prefer `rg` / `rg --files` for search.
- Respect existing uncommitted user changes.
- Avoid destructive git commands.
- Keep fixes production-relevant unless the task explicitly says otherwise.
- If recent OpenClaw schema is missing, user and admin routes may run in degraded fallback mode.
- Do not confuse repo-side `.openclaw/` docs with home-side `~/.openclaw/agents/dss-manager/` runtime files.
- Local DSS case log target: `~/.openclaw/agents/dss-manager/runtime/case-state.ndjson`

## OpenClaw Commands

`callbacks.commandsUrl` がある場合、app-side command は次の whitelist に限定される。

- `system.status`
- `logs.query`
- `stats.summary`
- `cache.clear`
- `maintenance.enable`
- `maintenance.disable`
- `scheduler.restart`
- `pharmacy.toggle`
- `job.cancel`
- `drug_master.sync`
- `notification.send`

原則:

- 追加の app-side 情報取得や制御が必要なときだけ使う
- 破壊的な command は理由を明示する
- command が失敗したら完了扱いにしない
