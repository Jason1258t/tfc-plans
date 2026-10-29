# MCP `tfc-plans-dev` (git/workflow)

A second stdio MCP server, next to `tfc-pack` (`scripts/mcp/`) — but only for operations on the **project repository**
itself: worktrees, branches, commit, ship. Dev tasks and their log live on the pack server (SQLite). Attachment metadata and content live in Firestore;
`dev_get` queries only files with `taskId=dev:<id>` (one-minute cache), and explicitly reports lookup failures.

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

## Dev task attachments

- `dev_get(id, notes)` includes attachment ids, names, MIME types and sizes alongside the task.
- `dev_file_get(task, id)` verifies that the file belongs to the dev task, downloads it through the shared
  report cache with size/SHA256 checks, and returns local paths plus inline PNG/JPEG/WebP/GIF images up to 10 MiB.
  Logs and archives are downloaded without automatic analysis; use `log_analyze` with the returned path.
- Configure `TFC_FIRESTORE_KEY` for `tfc-plans-dev` as for `tfc-pack`; otherwise Firebase CLI credentials are used.
  Task reads remain available on Firestore failure, with an explicit attachment warning.
- Restart the MCP process after updating its code.
