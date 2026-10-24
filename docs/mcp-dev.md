# MCP `tfc-plans-dev` (git/workflow)

A second stdio MCP server, next to `tfc-pack` (`scripts/mcp/`) — but only for operations on the **project repository**
itself: worktrees, branches, commit, ship. It has no pack data and no Firestore; the site task log stays in `tfc-pack`.

- Server — `scripts/mcp-dev/server.mjs` (Node, no deps, the same minimal JSON-RPC as `tfc-pack`); registered in
  `.mcp.json` as `tfc-plans-dev`. Other agents add it to their config like `tfc-pack` (docs/agents.md).
- The main checkout is found via `git rev-parse --git-common-dir` (so it works from any worktree); `TFC_PLANS_REPO`
  overrides. Worktrees — `.claude/worktrees/<name>`, branches `feat|refactor|fix/<name>`.
- Safety: no `--force`; mutating tools refuse when the main checkout is dirty or not on `main` (parallel agents);
  `ship` is a dry-run preview unless `confirm=true`; it also runs `oxlint` + `prettier --check` on the branch changed
  files (binaries from the main checkout `node_modules`; `TFC_LINT_TOOLS` overrides) and refuses on failure.

| Tool                            | Does                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `git_state(worktree)`           | main branch/cleanliness, ahead-behind `origin/main`, worktree list; with `worktree` — that worktree branch/status |
| `worktree_add(name, type)`      | create `.claude/worktrees/<name>` + branch `<type>/<name>` from `main`                                            |
| `commit(worktree, message)`     | `git add -A` + commit in a worktree (refuses on `main`, no identity)                                              |
| `ship(worktree, note, confirm)` | merge `--no-ff` into `main` → `git push origin main` → remove worktree + branch; preview unless `confirm=true`    |
| `worktree_remove(worktree)`     | remove a worktree; branch deleted only if merged                                                                  |

The session workflow (task → worktree → commit → ship) — skill `dev-session` (`.claude/skills/dev-session/SKILL.md`);
finish/deploy — skill `ship`.
