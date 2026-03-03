# docs/codex-multi-agent-playbook.md

## Multi-agent basics
- Enable via `[features].multi_agent = true`
- Control concurrency via `agents.max_threads`
- Control nesting via `agents.max_depth` (root depth=0)

## This repo's operating model
- Commander spawns and integrates.
- Implementers do not spawn further agents unless explicitly instructed (keep depth under control).
- Parallelize by roles: exploration/docs/security/tests/CI/perf.

## Golden rule for speed
Do NOT review mid-implementation.
Batch implement -> batch verify -> parallel broad review -> batch fix -> re-verify.

## Numeric routing
- loc_delta_est <= 250 -> implementer_light
- loc_delta_est > 800 or risk_flags include authz/sql/secrets/security/ssr -> implementer_heavy
