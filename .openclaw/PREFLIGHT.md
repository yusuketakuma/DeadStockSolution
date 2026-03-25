# DSS Manager Preflight

`/Users/yusuke/workspace/DeadStockSolution/.openclaw` is the repository-side contract directory.
The runnable agent bootstrap for `dss-manager` lives in:

- `~/.openclaw/agents/dss-manager/BOOT.md`
- `~/.openclaw/agents/dss-manager/agent/models.json`
- `~/.openclaw/agents/dss-manager/agent/auth-profiles.json`
- `~/.openclaw/agents/dss-manager/runtime/`

There is no executable binary in this repository folder. The repo folder exists to provide
task-specific operating rules, state contracts, and verification commands.

## Before Acting

Confirm these points before treating an OpenClaw issue as an implementation failure:

1. The current workspace is `/Users/yusuke/workspace/DeadStockSolution`.
2. Required repo references are readable:
   - `.openclaw/dss-manager-instructions.md`
   - `.openclaw/DSS_STATE_MACHINE.md`
   - `.openclaw/DSS_WEBHOOK_CONTRACT.md`
   - `.openclaw/DSS_RUNTIME_LOGGING.md`
   - `.openclaw/TOOLS.md`
3. OpenClaw-related database migrations are applied when full functionality is expected:
   - `openclaw_work_items`
   - `openclaw_retry_jobs`
   - related recent columns referenced by `schema-openclaw.ts`
4. If those schemas are missing, DeadStockSolution now degrades safely for:
   - `/api/requests/me`
   - `/api/requests/:id/messages`
   - `/api/requests/:id/messages` follow-up handoff
   - `/api/admin/openclaw-retries`
5. Safe fallback does not mean feature parity. Missing schema still blocks:
   - persistent OpenClaw work-item metadata
   - retry job visibility
   - parts of long-running coordination behavior

## Verification Baseline

Use these commands before reporting completion for code changes:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test --workspace=server`
- `npm run test --workspace=client`

For narrower validation during triage, start with the affected workspace and then widen to the
full baseline before terminal completion.

## Runtime Hygiene

- Runtime case log target: `~/.openclaw/agents/dss-manager/runtime/case-state.ndjson`
- DDS runner shared snapshot: `~/.openclaw/agents/dds-agent-runner/runtime/current-work-item.json`
- DDS attachment hydrate cache: `~/.openclaw/agents/dds-agent-runner/runtime/attachments/`
- Do not store secrets in repo-side `.openclaw/`
- Treat `agent/auth-profiles.json` and similar home-directory auth files as local machine state
- Do not commit machine-local runtime or auth artifacts back into this repository
