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
- Checks relevant to the change passed: `npx tsc -b` (TS), `npm run lint` (oxlint, zero errors), `prettier --check`
  on changed files (`npx prettier --write <files>` to fix). The `ship` tool runs `oxlint` + `prettier --check` on the branch changed
  files and refuses on failure.
- `docs/state/<topic>.md` updated if the state changed (and the `docs/STATE.md` index line, if any).

## 2. Merge into main

```bash
git -C $MAIN status --short          # must be empty and on main (git -C $MAIN branch --show-current)
git -C $MAIN merge --no-ff <branch> -m "Слияние <branch>: что сделано"
```

If the main folder has someone else's uncommitted changes or isn't on `main` — **stop and ask the user**, don't touch
them. On a merge conflict (another session merged first) — resolve in the worktree (`git merge main` there), re-check,
then merge again.

## 3. Deploy (from `$MAIN`, clean `main`, never from a branch)

Pick by what changed:

| Changed                                                                                                           | Command (run in `$MAIN`)                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `firestore.rules`                                                                                                 | `npx firebase deploy --only firestore:rules` — **first**, before hosting                                                                                                                                      |
| Site code (`src/`, `public/` static, `firebase.json` headers)                                                     | `npm run deploy:site`                                                                                                                                                                                         |
| Pack data builders (`scripts/mods/…`, `mods.mjs`, `kubejs.mjs`, `scripts/mcp/render.mjs`, `scripts/mcp/models/…`) | no site deploy from the Mac: push, then the pack server rebuilds — `tfc admin rebuild --pull` (dry run, check the summary: icons drawn, removals), then `tfc admin publish --live`. Ask before the live step. |
| Docs, agent files, `tools/` addon sources, `cli/`, `server/` only                                                 | no site deploy (addon jars/`tfc` builds have their own release steps — docs/addons.md, docs/tfc-app.md)                                                                                                       |

- **Pack data on Hosting is set only by the pack server** (`scripts/publish-data.mjs`). `npm run deploy:site`
  (`scripts/deploy-site.mjs`) builds the site with `TFC_SITE_ONLY=1` and keeps the data roots
  (`scripts/data-roots.mjs`) of the live release by hash — no jars, no `public/` data, works from a worktree.
- `npx firebase deploy --only hosting` is blocked by predeploy (it would upload this machine's `public/` data);
  `ALLOW_FULL_HOSTING_DEPLOY=1` only for a first deploy or an emergency, with the user's go-ahead.
- Pack server code changed (`server/pack-server`)? Updating the VPS is a separate step (docs/pack-server.md) — ask.

## 4. Push and clean up

```bash
git -C $MAIN push
git -C $MAIN worktree remove .claude/worktrees/<short>
git -C $MAIN branch -d <branch>
```

## 5. Report (in Russian)

What changed for players, what was checked and how, what wasn't (in game — never), deploy/push done. No internal
function names unless needed for an action.
