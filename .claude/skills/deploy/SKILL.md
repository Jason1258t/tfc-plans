---
name: deploy
description: Deploy to Firebase safely — verify access (firebase login / service key), pick the route (firestore:rules first, site via deploy:site, pack data only via the pack server), dry-run, deploy, verify the live URL. Use for «задеплой», «выкати сайт», «обнови правила», or the deploy step of `ship`.
---

# Deploy: access → route → order → dry-run → deploy → verify

Project `tfc-plans-fd2c` (`.firebaserc`). This is the deploy step of the repo workflow; the merge → deploy → push flow
is `ship`, which delegates its step 3 here. Everything players see is Russian.

## 1. Preconditions

- Clean `main`, on `main` — deploy **never** from a feature branch or a dirty checkout.
- `ship` gate / CI green.
- Parallel deploys: Hosting releases are last-write-wins, so `npm run deploy:site` guards itself (§6). No manual check
  is needed; a refusal is the normal signal that someone else got there first.

## 2. Access

- CLI (`firebase deploy`, `firebase login:list`) → the right account; else `firebase login`.
- Scripts (`npm run deploy:site`, `publish-data.mjs`) authenticate via `scripts/firestore-rest.mjs`: a service key
  (`GOOGLE_APPLICATION_CREDENTIALS`; MCP uses `TFC_FIRESTORE_KEY`) or `firebase login`. On 401 → refresh the token or
  re-login; don’t retry blindly.

## 3. Route by what changed

| Changed                                                                                                           | Deploy                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `firestore.rules`                                                                                                 | `npx firebase deploy --only firestore:rules` — **first**, before the site                                                                     |
| Site code (`src/`, `public/` static, `firebase.json` headers)                                                     | `npm run deploy:site`                                                                                                                         |
| Pack data builders (`scripts/mods/…`, `mods.mjs`, `kubejs.mjs`, `scripts/mcp/render.mjs`, `scripts/mcp/models/…`) | no site deploy: push, then the pack server — `tfc admin rebuild --pull` (check the summary), `tfc admin publish --live` (ask before `--live`) |
| Docs, agent files, `tools/`, `cli/`, `server/` only                                                               | no deploy                                                                                                                                     |

- **Never** `firebase deploy --only hosting`: predeploy blocks it because it would upload this machine’s stale `public/`
  pack data and roll the site back. `ALLOW_FULL_HOSTING_DEPLOY=1` only for a first deploy or an emergency, with the
  user’s go-ahead.
- Pack data on Hosting is set **only by the pack server** (`scripts/publish-data.mjs`). `npm run deploy:site`
  (`scripts/deploy-site.mjs`) builds with `TFC_SITE_ONLY=1` and keeps the live data roots by hash — no jars, no data.

## 4. Order

1. `firestore:rules` first (if changed).
2. `npm run deploy:site -- --dry-run` — read the `+`/`~`/`−` list and the «данные сборки: N файлов» line; sanity-check
   nothing unexpected is added or removed.
3. `npm run deploy:site` (no `--dry-run`).

## 5. Verify after deploy

- Live URL `https://tfc-plans-fd2c.web.app` loads; spot-check an item/recipe is still there (pack data not rolled back).
- `packUpdates` / freshness in order.

## 6. Failures and access problems

- «у сайта нет ни одного релиза» / «в текущем релизе нет данных сборки» → pack data not published yet: publish it
  first (pack server), then `deploy:site`.
- predeploy «в dist/ нет настроек Firebase …» → `.env.local` missing: build from a checkout that has it and redeploy.
- 401 / «Authentication Error» → §2.

### Race guards in `deploy:site`

Each one stops the deploy before a release, with the site unchanged. **Don't retry the same checkout blindly** — bring
it up to date first.

| Message                                               | What happened                                                                                                                                      | Do                                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| «выкладку сайта уже ведёт процесс …»                  | Another worktree of this repo holds the lock (`deploy-site.lock` in the git common dir, for build + release).                                      | Wait for it, update your checkout (it must contain that commit), rerun.               |
| «пока шла выкладка, вышел другой релиз …»             | The live release changed after the plan was computed: another machine, or a pack-server data publish.                                              | Update your checkout, rerun; the plan is recomputed from the new release.             |
| «сайт выпущен из коммита …, а в этой копии … его нет» | The commit in the last `commit=<sha>` release message is not in your `HEAD`, so your build would drop someone's changes. Checked before the build. | `git pull` / `git merge main`, rerun. `--allow-older` only for a deliberate rollback. |

- A stale lock clears itself: its process is dead, or it is older than 30 minutes (the release check still protects a
  run that outlives that). Don't delete the file by hand while a deploy may be running.
- `--dry-run` takes no lock and works next to a running deploy; a commit mismatch is only a warning there
  («настоящая выкладка отказалась бы»).
- `--no-build` releases carry no `commit=` mark, since `dist/` may be from another commit; the next deploy compares with
  the last marked release. Pack-server data releases carry no mark either and don't change site files.
- What the guards don't cover: a release landing in the moment between the check and our release call (well under a
  second), and pack-server data publishes, which don't check for a site release in progress.
