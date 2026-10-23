---
name: dev-session
description: Start and finish a dev/fix session by the repo workflow — site task in «Разработка» (tfc-pack) + worktree/branch (tfc-plans-dev), then commit, hand off to `ship` (merge → push → cleanup) and close the task. Use at the start of any dev work («начни задачу», «в отдельной ветке») and to finish it.
---

# Dev session: task → worktree → work → commit → ship → task done

The workflow is in AGENTS.md. This skill drives it with two MCP servers: **`tfc-plans-dev`** (git/worktree) and
**`tfc-pack`** (site task log). Finish/deploy — skill `ship`; this skill only hands it off.

## 1. Start

- `tfc-plans-dev` `git_state` — main clean, on `main`, in sync with `origin/main`.
- `tfc-pack` `tasks_list group=Разработка` / `task_create` — take or create the task, status `doing`, assignee = your
  agent name (`DeepSeek` here).
- `tfc-plans-dev` `worktree_add name=<short>` (type `feat`/`refactor`/`fix`, default `feat`) → worktree
  `.claude/worktrees/<short>`, branch `<type>/<short>`. Work only inside it.

## 2. Work

- Edit and verify (the relevant skill or MCP tools). Never touch the main checkout; do not take another agent’s task.

## 3. Finish

- `tfc-plans-dev` `commit worktree=<short> message="Раздел: что сделано"` (one line, Russian).
- Skill `ship` — `tfc-plans-dev` `ship worktree=<short>` for the preview, then `confirm=true`; it merges `--no-ff`,
  pushes `origin/main`, removes the worktree and branch. (Deploy needed → ship skill’s raw steps.)
- `tfc-pack` `task_update id=<id> baseRevision=<rev> status=done` — short Russian note: what changed for players,
  what was checked, what wasn’t (in game — never).
