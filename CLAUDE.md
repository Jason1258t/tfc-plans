@AGENTS.md

## Claude Code only

AGENTS.md above is the source of truth; edit rules there, not here. Only what other agents can't use goes below.

- Worktree: `git worktree add …` from AGENTS.md, then `EnterWorktree path=<it>` (or `EnterWorktree name=<short>`).
- Agent name for the work log and MCP signatures — `Claude` (detected via `CLAUDECODE`; `TFC_AGENT_NICK` overrides).
- Preview: the app reads `.claude/launch.json` of the **main checkout**, so `dev-alt` (5176) and `dev-alt2` (5177) show
  `main`, not your edits. In a worktree use the entry `tfc-plans-dev` `worktree_add` prints: `preview_start name=wt-<short>`
  (own port, no jars needed; after a plain `git worktree add` — `worktree_preview worktree=<short>`; `ship` and
  `worktree_remove` drop it). In the browser prefer `find` + `ref` or `javascript_tool`.
- Broad searches → the `Explore` subagent. Scratch scripts — in the session scratchpad.
- After editing `scripts/mcp/` — `/mcp` in terminal Claude Code or a new session in the app.
