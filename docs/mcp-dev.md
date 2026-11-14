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

| Tool                            | Does                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git_state(worktree)`           | main branch/cleanliness, ahead-behind `origin/main`, worktree list; with `worktree` — that worktree branch/status                                                        |
| `worktree_add(name, type)`      | create `.claude/worktrees/<name>` + branch `<type>/<name>` from `main`                                                                                                   |
| `worktree_preview(worktree)`    | Claude app preview entry `wt-<name>` in the main `.claude/launch.json` (`--prefix`, port from 5190); `worktree_add` does it too; entries of removed worktrees are pruned |
| `commit(worktree, message)`     | `git add -A` + commit in a worktree (refuses on `main`, no identity)                                                                                                     |
| `ship(worktree, note, confirm)` | merge `--no-ff` into `main` → `git push origin main` → remove worktree + branch; preview unless `confirm=true`                                                           |
| `worktree_remove(worktree)`     | remove a worktree; branch deleted only if merged                                                                                                                         |

The session workflow (task → worktree → commit → ship) — skill `dev-session` (`.claude/skills/dev-session/SKILL.md`);
finish/deploy — skill `ship`.

## Dev task attachments

Stored on the pack server since dev #357 (metadata in `dev.db`, content in `<DATA_DIR>/dev-files/<sha256>`;
`server/pack-server/lib/dev-files.mjs`), not in Firestore — zero Firestore reads.

- `dev_get(id, notes)` lists attachment ids, names, MIME types, sizes and authors alongside the task.
- `dev_file_get(task, id)` verifies that the file belongs to the dev task, downloads it to
  `~/.cache/tfc-plans/dev-files/<id>` with size/SHA256 checks (zip unpacked into `files/`), and returns local paths
  plus inline PNG/JPEG/WebP/GIF images up to 10 MiB (up to 6, also from a zip). Logs are not analysed automatically;
  use `log_analyze` with the returned path.
- `dev_file_put(task, path, name, each, zip)` uploads a file, a folder (one deterministic zip, or `each=true` — file by
  file) or a list of paths (`zip=true` — one zip). Signed with the agent nick. Up to 50 MB per file; the same content
  with the same name is not stored twice. `addon_stand … task=<id>` attaches `evidence/` + `verdict.json` this way.
- Restart the MCP process after updating its code.
