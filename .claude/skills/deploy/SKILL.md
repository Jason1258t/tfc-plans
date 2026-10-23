---
name: deploy
description: Deploy to Firebase safely — verify access (firebase login / service key), ensure no parallel deploy, pick the route (firestore:rules first, site via deploy:site, pack data only via the pack server), dry-run, deploy, verify the live URL. Use for «задеплой», «выкати сайт», «обнови правила», or the deploy step of `ship`.
---

# Deploy: access → route → order → dry-run → deploy → verify

Project `tfc-plans-fd2c` (`.firebaserc`). This is the deploy step of the repo workflow; the merge → deploy → push flow
is `ship`, which delegates its step 3 here. Everything players see is Russian.

## 1. Preconditions

- Clean `main`, on `main` — deploy **never** from a feature branch or a dirty checkout.
- `ship` gate / CI green.
- No parallel deploy: nobody else deploying at the same time (pack server or another agent). Hosting releases are
  last-write-wins — two concurrent deploys race. Ask the host if unsure.

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
