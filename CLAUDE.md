@AGENTS.md

## Claude Code only

AGENTS.md above is the source of truth; edit rules there, not here. Only what other agents can't use goes below.

- Worktree: `git worktree add …` from AGENTS.md, then `EnterWorktree path=<it>` (or `EnterWorktree name=<short>`).
- Agent name for the work log and MCP signatures — `Claude` (detected via `CLAUDECODE`; `TFC_AGENT_NICK` overrides).
- Preview: configs from `.claude/launch.json` — **`dev-alt`** (5176), if busy `dev-alt2` (5177); the same in a worktree
  (no jars needed). In the browser prefer `find` + `ref` or `javascript_tool`.
- Broad searches → the `Explore` subagent. Scratch scripts — in the session scratchpad.
- After editing `scripts/mcp/` — `/mcp` in terminal Claude Code or a new session in the app.
