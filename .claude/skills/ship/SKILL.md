---
name: ship
description: Finish a task in this repo — merge the worktree branch into main, deploy (rules/site/full), push, remove the worktree. Use when work is verified and ready ("пусти в деплой", "готово, выкатывай"), or before any firebase deploy.
---

# Ship: merge → deploy → push → cleanup

Git steps are automated by the **tfc-plans-dev** MCP server (git_state, commit, ship, worktree_remove). No deploy needed (docs, agent files, MCP tools, addon sources) → run tfc-plans-dev ship worktree=<short> confirm=true (merge → push → cleanup) and skip to §5. The raw commands below are for the deploy-ordering case.

Main folder: `MAIN=/Users/ivan/vscodeProjects/tfc-taskmanager` (always on `main`). Your work is in
`.claude/worktrees/<short>` on branch `feat|refactor|fix/<short>`.

## 1. Before merging (in the worktree)

- Everything committed: `git status --short` is empty. Commit message `Раздел: что сделано` (Russian, one line).
- **Dev server started from this worktree is stopped** (Claude: `preview_stop`; otherwise kill the `vite` process
  whose cwd is the worktree). A running Vite recreates `node_modules/.vite` while the worktree is being deleted, and
  `git worktree remove` fails with «Directory not empty».
- Checks relevant to the change passed: `npx tsc -b` (TS), `npm run lint` (oxlint, zero errors), `prettier --check`
  on changed files (`npx prettier --write <files>` to fix). The `ship` tool runs `oxlint` + `prettier --check` on the branch changed
  files and refuses on failure.
- Addon changes (`tools/` submodule, repo tfc-addons): committed and pushed **there** and on its `origin/main` before
  shipping here; the `ship` tool checks the `tools` pointer and refuses otherwise. After the merge it updates
  `tools/` in the main folder (`git submodule update --init tools`).
- `docs/state/<topic>.md` updated if the state changed (and the `docs/STATE.md` index line, if any).

## 2. Merge into main

```bash
git -C $MAIN status --short          # must be empty and on main (git -C $MAIN branch --show-current)
git -C $MAIN merge --no-ff <branch> -m "Слияние <branch>: что сделано"
```

If the main folder has someone else's uncommitted changes or isn't on `main` — **stop and ask the user**, don't touch
them. On a merge conflict (another session merged first) — resolve in the worktree (`git merge main` there), re-check,
then merge again.

## 3. Deploy (from clean `main`, never from a branch)

The full safe procedure — skill `deploy` (`.claude/skills/deploy/SKILL.md`): verify access, ensure no parallel
deploy, pick the route, `firestore:rules` first, `npm run deploy:site -- --dry-run` then real, verify the live URL.
Pack data is set only by the pack server; `firebase deploy --only hosting` stays blocked.

## 4. Push and clean up

```bash
git -C $MAIN push
git -C $MAIN worktree remove .claude/worktrees/<short>
git -C $MAIN branch -d <branch>
```

## 5. Report (in Russian)

What changed for players, what was checked and how, what wasn't (in game — never), deploy/push done. No internal
function names unless needed for an action.
