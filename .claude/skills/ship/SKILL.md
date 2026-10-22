---
name: ship
description: Finish a task in this repo — merge the worktree branch into main, deploy (rules/site/full), push, remove the worktree. Use when work is verified and ready ("пусти в деплой", "готово, выкатывай"), or before any firebase deploy.
---

# Ship: merge → deploy → push → cleanup

Main folder: `MAIN=/Users/ivan/vscodeProjects/tfc-taskmanager` (always on `main`). Your work is in
`.claude/worktrees/<short>` on branch `feat|refactor|fix/<short>`.

## 1. Before merging (in the worktree)

- Everything committed: `git status --short` is empty. Commit message `Раздел: что сделано` (Russian, one line).
- Checks relevant to the change passed: `npx tsc -b`, `npx oxlint src scripts`, browser check on `dev-wt` for UI.
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

| Changed | Command (run in `$MAIN`) |
| --- | --- |
| `firestore.rules` | `npx firebase deploy --only firestore:rules` — **first**, before hosting |
| Site code only (`src/`, `public/` static, no `scripts/mods/…`) | `npm run deploy:site` |
| Mod data builders (`scripts/mods/…`, `mods.mjs`) | `npx firebase deploy --only hosting` (needs jars in `$MAIN/mods/`) |
| Docs, agent files, `tools/` addon sources, `cli/`, `server/` only | no site deploy (addon jars/`tfc` builds have their own release steps — docs/addons.md, docs/tfc-app.md) |

- Deploying from a worktree is only for the rare case main can't be used; then mod-data changes need
  `ln -s $MAIN/mods/*.jar mods/` first, site-only changes use `npm run deploy:site` (`TFC_KEEP_MODS=1` takes mod data
  from `$MAIN/public/`).
- If `$MAIN/public/` mod data may be stale vs the pack server: `npm run pack:fetch -- --data` before `deploy:site`.
- Guards: build stops without mods (`TFC_ALLOW_NO_MODS=1`), `pack-release` refuses at 0 mods or > half lost
  (`ALLOW_MODS_DROP=1`) — bypass only if mods were really removed. `SKIP_PACK_RELEASE=1` skips the pack-update record.
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
