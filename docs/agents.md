# Running other coding agents on this repo

Rules for every agent are in [AGENTS.md](../AGENTS.md) (root and per folder: `scripts/`, `scripts/mcp/`, `server/`,
`tools/`). Each `CLAUDE.md` is only `@AGENTS.md` plus Claude-only notes, so Claude Code and the rest read the same text.
Edit rules in `AGENTS.md`, never duplicate them in tool-specific files.

What each agent needs: (1) read `AGENTS.md`, (2) the skills, (3) the `tfc-pack` MCP server, (4) its own name for the
site work log.

## Shared pieces

| Piece         | Where                                                                    | Who reads it as is                                                                                                                 |
| ------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Rules         | `AGENTS.md` (+ nested)                                                   | Codex, Cursor, OpenCode, Copilot, Zed, … natively; Claude Code via `@AGENTS.md` in `CLAUDE.md`; Gemini CLI after the setting below |
| Skills        | `.claude/skills/<name>/SKILL.md`, symlink `.agents/skills` → same folder | Claude Code (`.claude/skills`), Codex (`.agents/skills`); others — open the file by hand, AGENTS.md lists them                     |
| MCP server    | `scripts/mcp/server.mjs` (stdio, no deps, Node 24)                       | Claude Code via `.mcp.json`; others — own config, below                                                                            |
| Preview ports | `.claude/launch.json` (local, gitignored)                                | Claude Code app only; others run `npm run dev -- --port 5176 --strictPort`                                                         |

`.agents/skills` is a git symlink: on Windows it needs `git config core.symlinks true` (Developer Mode), otherwise it
checks out as a text file — then point the agent at `.claude/skills` directly.

## MCP `tfc-pack` for any agent

The server is one command: `node <repo>/scripts/mcp/server.mjs`. Environment:

- `TFC_FIRESTORE_KEY` — service key for site content (default `~/.config/tfc/mcp-firestore.json`, setup in
  `scripts/mcp/firestore-key.example.md`). Use an absolute path: `${VAR:-default}` expansion is Claude Code syntax.
- `TFC_AGENT_NICK` — name written as author / `updatedBy` on tasks, plan docs, guides, config proposals and addon
  versions (default `Claude`). **Every agent sets its own name here** — never leave the default `Claude` unless you
  are Claude (`Codex`, `Gemini`, `Cursor`, `DeepSeek`…); use the same name as task assignee.
- The server finds `public/` of the main checkout itself (also from a worktree; override with `TFC_PACK_ROOT`); pack
  jars — from the snapshot cache `~/.cache/tfc-plans/pack/mods` (`npm run pack:fetch`; `TFC_MODS_DIR` overrides).

Paths differ per system: on Windows `~` is `%USERPROFILE%`, and the `tfc` app keeps **its own** settings (pack server
address and player/admin key) at `%APPDATA%\tfc\config.json` — not in `~/.config/tfc`, where only the MCP Firestore key
lives (`configDir()` in `cli/lib/config.mjs`); `npm run pack:fetch` reads the same file.

Point the agent at the main checkout's `server.mjs` (absolute path) — then it works from any worktree. Config shapes
below are from the tools' docs as remembered on 2026-10-23, not run here — check the current docs if one fails.

**Codex** — `~/.codex/config.toml` (or project `.codex/config.toml` in a trusted project); reads `AGENTS.md` and
`.agents/skills` itself:

```toml
[mcp_servers.tfc-pack]
command = "node"
args = ["/abs/path/to/tfc-taskmanager/scripts/mcp/server.mjs"]
env = { TFC_FIRESTORE_KEY = "/abs/home/.config/tfc/mcp-firestore.json", TFC_AGENT_NICK = "Codex" }
```

**Gemini CLI** — `.gemini/settings.json` (project) or `~/.gemini/settings.json`; `context.fileName` makes it read
`AGENTS.md` instead of `GEMINI.md`:

```json
{
  "context": { "fileName": ["AGENTS.md"] },
  "mcpServers": {
    "tfc-pack": {
      "command": "node",
      "args": ["/abs/path/to/tfc-taskmanager/scripts/mcp/server.mjs"],
      "env": { "TFC_FIRESTORE_KEY": "/abs/home/.config/tfc/mcp-firestore.json", "TFC_AGENT_NICK": "Gemini" }
    }
  }
}
```

**Cursor** — `.cursor/mcp.json` or `~/.cursor/mcp.json`, same `mcpServers` shape as above (`TFC_AGENT_NICK: "Cursor"`).

**OpenCode** — checked 2026-10-25 on v2.1.4: config lives in `~/.config/opencode/opencode.json` and the schema is
`mcp.servers` (not `mcp`); the project file `opencode.json` / `.opencode.local.json` was **not** picked up (`opencode debug
config` listed only the global folder, `opencode mcp list` said «No MCP servers configured»). The reliable route is the CLI
from the repo root:

```bash
opencode mcp add --global tfc-pack \
  --env TFC_FIRESTORE_KEY=/abs/home/.config/tfc/mcp-firestore.json --env TFC_AGENT_NICK=OpenCode \
  -- node /abs/path/to/tfc-taskmanager/scripts/mcp/server.mjs
opencode mcp add --global tfc-plans-dev \
  -- node /abs/path/to/tfc-taskmanager/scripts/mcp-dev/server.mjs
opencode mcp list      # ✓ tfc-pack connected
```

No `${VAR:-default}` expansion — give the absolute key path. OpenCode reads `AGENTS.md` and `.claude/skills`.

**DeepSeek Harness (DSH)** — checked 2026-10-24: servers are added in the profile patch
`~/.dsh/profiles/desktop/cordis.patch.yml` (outside the repo) as `insert` entries of `@deepseek-ai/dsh-mcp-client`. The
running app picks the patch up in place (no restart) and the tools appear as `mcp__tfc-pack__*`. Give an **absolute**
`node` path — a GUI-launched app has no fnm/nvm `PATH` — and keep `cwd` at the main checkout:

```yaml
- insert:
    - id: mcp-tfc-pack
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: tfc-pack
        transport: stdio
        command: /abs/home/.local/share/fnm/aliases/default/bin/node
        args: ['/abs/path/to/tfc-taskmanager/scripts/mcp/server.mjs']
        cwd: /abs/path/to/tfc-taskmanager
        env:
          TFC_FIRESTORE_KEY: /abs/home/.config/tfc/mcp-firestore.json
          TFC_AGENT_NICK: DeepSeek
```

A second entry with `serverName: tfc-plans-dev` and `scripts/mcp-dev/server.mjs` adds the git tools. Checked: both
servers connected, Firestore read through `groups_list`, `git_state` lists the worktrees. Skills: DSH loads
`.claude/skills` by name.

**Others** — any harness with stdio MCP: same command, args and env; skills load if it scans `.claude/skills` or
`.agents/skills`, otherwise AGENTS.md tells it to open `SKILL.md` by hand.

**`tfc-plans-dev`** (git/workflow) — a second stdio server `node <repo>/scripts/mcp-dev/server.mjs`, no env needed (it
finds the main checkout via `git rev-parse --git-common-dir`; `TFC_PLANS_REPO` overrides). Add it as a second `mcpServers`
entry next to `tfc-pack`. Tools: `git_state`, `worktree_add`, `commit`, `ship`, `worktree_remove` — see [mcp-dev.md](mcp-dev.md).

Personal configs (absolute paths, keys) stay out of git; commit a shared one only when it has no machine paths.

## Several agents at once

- One worktree and one branch per session (AGENTS.md → Workflow); the main checkout stays on `main`.
- One site task per session: take it with `doing` + your name; a task `doing` under another name is someone's work.
- Shared agent files (`AGENTS.md`, `.claude/skills/`, `docs/mcp.md`, `docs/STATE.md`) — small, focused edits; merge
  conflicts there are resolved by keeping both sides' rules.
- Dev servers: one port per session (5176, 5177, 5179); a taken port means another agent is running — pick the next.
- Firestore reads are shared (50k/day free) — the "don't loop" rule matters more with several agents.
