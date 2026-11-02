---
name: dev-session
description: Start and finish a dev/fix session by the repo workflow — dev task (tfc-plans-dev dev_*, pack server) + worktree/branch, then commit, hand off to `ship` (merge → push → cleanup) and close the task with a report. Use at the start of any dev work («начни задачу», «в отдельной ветке») and to finish it.
---

# Dev session: task → worktree → work → commit → ship → task done

The workflow is in AGENTS.md. This skill drives it with **`tfc-plans-dev`**: worktree tools and the dev tracker
(`dev_*`, on the pack server — no Firestore reads, [docs/plans/dev-tracker.md](../../../docs/plans/dev-tracker.md)).
Finish/deploy — skill `ship`; this skill only hands it off. Players' tasks and pack plans stay on the site
(`tfc-pack` `task_*`).

## 1. Start

- `tfc-plans-dev` `git_state` — main clean, on `main`, in sync with `origin/main`.
- `dev_list query=<words>` / `dev_create` — take or create the task (kind `fix` for fixes), then
  `dev_start id=<id> branch=<branch>`: status `doing`, assignee = **your own agent name**, signed from `TFC_AGENT_NICK`
  ([docs/agents.md](../../../docs/agents.md)). It refuses a task another agent is working on —
  ask the user, don't pass `takeover` on your own.
- `tfc-plans-dev` `worktree_add name=<short>` (type `feat`/`refactor`/`fix`, default `feat`) → worktree
  `.claude/worktrees/<short>`, branch `<type>/<short>`. Work only inside it.

## 2. Work

- Edit and verify (the relevant skill or MCP tools). Never touch the main checkout; do not take another agent’s task.
- Verified milestone — `dev_check id=<id> done=[<item numbers>]`, numbers from `dev_get`; they never shift.
- Findings and progress — `dev_note`; a bigger plan — `dev_doc_put task=<id>`. Found a separate problem along the way —
  a new dev task.

### Checklist items

Items have stable numbers (`#175.3`), shown by `dev_get`. Change them with `dev_check id done=[2,3]` (also `undone`,
`add`, `remove`, `edit`, `move`) — no `baseRev`, nothing else in the task changes. Mark an item right after its milestone
is verified; a journal note alone marks nothing. Items are created with `dev_create checklist=…` or `dev_check add=…`;
`dev_update` no longer takes them. Closed tasks with the old format are read-only until reopened.

### Reading and small edits

Search — `dev_find`; log pages — `dev_log`; small plan edits — `dev_doc_edit` and `dev_doc_append` instead of `dev_doc_put`
with the whole text; a long plan — `dev_doc_get heading=…`.

### Links

Tie work together with refs `#175`, `#175.3`, `doc:12#Раздел`, `note:881` — the server finds them in texts itself (a ref
that is only an example goes in backticks). Follow one — `dev_open`; explicit link — `dev_link`; log entry or doc to a
checklist item — field `item`.

## 3. Finish

- Stop the dev server you started from the worktree (Claude: `preview_stop`) — a running Vite breaks the worktree
  removal in `ship`.
- `tfc-plans-dev` `commit worktree=<short> message="Раздел: что сделано"` (one line, Russian).
- Skill `ship` — `tfc-plans-dev` `ship worktree=<short>` for the preview, then `confirm=true`; it merges `--no-ff`,
  pushes `origin/main`, removes the worktree and branch. (Deploy needed → ship skill’s raw steps.)
- `dev_finish id=<id> report="…"` — short Russian report: what changed for
  players, what was checked, what wasn’t (in game — never).
