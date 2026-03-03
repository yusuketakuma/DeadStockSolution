# docs/codex-upgrade-notes-0.107.0.md

## 0.107.0 highlights (from GitHub release)
- Thread can be forked into sub-agents (branch work without leaving the conversation)
- App-server exposes richer model availability metadata
- thread/resume restores pending approvals/inputs
- thread/start no longer blocks unrelated app-server requests (reduces stalls on slow startup paths)
- MCP OAuth flow forwards oauth_resource correctly

## Repo changes
- Config keys validated against official config reference
- apps/connectors disabled by default
- multi_agent enabled, max_threads=32, max_depth=2
- Enforced workflow: implement -> verify -> broad review -> fix -> re-verify
