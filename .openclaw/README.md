# OpenClaw Local Notes

This directory holds DeadStockSolution-specific guidance for the local OpenClaw `dss-manager` agent.

Files:
- `dss-manager-instructions.md`: intake, dialogue, implementation, and PR workflow for incidents and user reports.
- `DSS_STATE_MACHINE.md`: canonical case-state transitions and app status mapping.
- `DSS_WEBHOOK_CONTRACT.md`: callback/report usage, retry rules, and idempotency contract.
- `DSS_RUNTIME_LOGGING.md`: local OpenClaw-side case log policy and schema.
- `IDENTITY.md`: identity values loaded into the local OpenClaw agent.
- `TOOLS.md`: project-specific commands, paths, and operating defaults.
- `USER.md`: persistent user preferences relevant to this workspace.

The actual OpenClaw boot prompt lives in `~/.openclaw/agents/dss-manager/BOOT.md` and points back to these files.
