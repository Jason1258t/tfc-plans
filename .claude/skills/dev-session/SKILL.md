---
name: dev-session
description: Start and finish a dev/fix session by the repo workflow — dev task (tfc-plans-dev dev_*, pack server) + worktree/branch, then commit, hand off to `ship` (merge → push → cleanup) and close the task with a report. Use at the start of any dev work («начни задачу», «в отдельной ветке») and to finish it.
---

# Dev session: task → worktree → work → commit → ship → task done

The workflow is in AGENTS.md. This skill drives it with **`tfc-plans-dev`**: worktree tools and the dev tracker
(`dev_*`, on the pack server — no Firestore reads). Finish/deploy — skill `ship`; this skill only hands it off.

## 1. Start

- `tfc-plans-dev` `git_state` — main clean, on `main`, in sync with `origin/main`.
- `dev_list query=<words>` / `dev_create` — take or create the task (kind `fix` for fixes), then `dev_update` with
  `baseRev`: status `doing`, assignee = your agent name (`TFC_AGENT_NICK`; `"me"` works), `branch`.
- `tfc-plans-dev` `worktree_add name=<short>` (type `feat`/`refactor`/`fix`, default `feat`) → worktree
  `.claude/worktrees/<short>`, branch `<type>/<short>`. Work only inside it.

## 2. Work

- Edit and verify (the relevant skill or MCP tools). Never touch the main checkout; do not take another agent’s task.
- Milestones and findings — `dev_note`; a bigger plan — `dev_doc_put task=<id>`.

## 3. Finish

- Stop the dev server you started from the worktree (Claude: `preview_stop`) — a running Vite breaks the worktree
  removal in `ship`.
- `tfc-plans-dev` `commit worktree=<short> message="Раздел: что сделано"` (one line, Russian).
- Skill `ship` — `tfc-plans-dev` `ship worktree=<short>` for the preview, then `confirm=true`; it merges `--no-ff`,
  pushes `origin/main`, removes the worktree and branch. (Deploy needed → ship skill’s raw steps.)
- `dev_get` → `dev_update id=<id> baseRev=<rev> status=done report="…"` — short Russian report: what changed for
  players, what was checked, what wasn’t (in game — never).
