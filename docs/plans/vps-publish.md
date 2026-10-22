# VPS publish: complete and safe live publishing of site data

Status: done 2026-10-22 — live publish with renders, `AUTO_PUBLISH=live`. Open: a `tfc` build with `--allow-removals`.

## Context

Publishing site data from the pack server (VPS) has to become safe enough to run live after every `tfc publish`.
On 2026-10-22 three problems came up:

1. The dry run of snapshot `20261022-095351-d765` (job `j20261022-095352-0590`) would have **removed 8559 files**,
   every `/icons/*/render/*.png`.
2. `npm run deploy:site` from the Mac uploaded data built from a stale `mods/` (234 mods, no addons). The site
   manifest is now 234 mods, built 2026-10-22 03:44 UTC, and the addon items are missing from the site.
3. Live publishing is off (`AUTO_PUBLISH` is unset, so every run is a dry run). The «Обновления» entry had to be
   written by hand.

### Findings (read-only, VPS and code)

- **Why there are no renders:** the VPS build repo `/var/lib/tfc-pack/repo` is at `3cc2531` (2026-10-21 01:49). That
  is **111 commits behind `main`**, from before 3D icons existed (`a792786`, 2026-10-21 13:38). The job log has no
  «объёмные иконки» line at all. So nothing is missing on the VPS by design: the code is simply old. (`git log` there
  also fails with "dubious ownership" when run as root. That is cosmetic, because the service runs as `tfcpack`.)
- **The renderer is pure Node.** `scripts/mcp/render.mjs` is a software rasterizer that writes PNGs itself: no GL,
  no Chromium, no native modules. It is called from `scripts/mods/icons3d.mjs`, which has a content-hash cache in
  `<cache>/icons3d/`. On the VPS the cache would live in `/var/lib/tfc-pack/cache` and persist between builds, so only
  the first run is cold.
- **What the renderer still needs on the VPS:**
  - `TFC_MODS_DIR`. `modJarsLayer()` and `fluids.mjs` read jars through MCP `jarList()`. That uses `TFC_MODS_DIR`,
    and falls back to `<repo>/mods` (empty on the VPS: `jarList` throws «в … нет jar»). `MODS` is computed at import
    time, so the variable has to be in the worker's environment, not set later. The same bug exists on the Mac when
    `npm run pack <folder>` runs: icons silently use the main checkout's `mods/`.
  - **Platform assets** (`platformLayers()`): the Minecraft `client-extra` resources (entity textures for chests,
    beds, heads) and NeoForge `assets/neoforge` (bucket models). Today they are found only in
    `tools/*/build/moddev/artifacts/neoforge-*.jar`, which come from a Gradle addon build that the VPS doesn't have.
    `TFC_PLATFORM_JAR` already overrides this. Without these assets the affected items fall back to textures. The
    build doesn't fail.
- **VPS resources:** 1 vCPU (Ryzen 9 7950X3D), 1967 MB RAM, **2 GB swap now exists** (417 MB used), about 1.29 GB
  available. Disk: 17 GB free. Node 22. The last full build without renders took 55 s, with a peak RSS of 780 MB
  (`BUILD_HEAP_MB=640`). Render time and memory haven't been measured. The local icon cache has 55k files (436 MB,
  all generator versions). Expect the cold render of about 8.5k models to take minutes on one core, and later builds
  only to render what changed.
- **Deploy from the Mac:** `firebase.json` predeploy runs `npm run build`, `predeploy-check`, then `pack-release`, and
  the CLI uploads all of `dist/`, data roots included. `ensure-mods.mjs` with `TFC_KEEP_MODS=1` copies data from the
  main checkout's `public/` whether it is fresh or stale.
- **packUpdates dedup (item 4) is confirmed:**
  - The record id is the first 20 hex characters of the SHA-1 of the joined mod sha1s (`pack-release.mjs`).
  - VPS `d765` manifest: 240 mods, id **`38539468f2e0e0cf87fb`**. This equals the hand-written record.
  - Current site manifest: 234 mods, id `e20ab0b452eeb7177915`, which is the 2026-10-07 baseline. That is why
    today's Mac deploy created nothing.
  - A live publish of `d765` will diff against the stale 234 (non-empty: +6 mods), POST id `38539468…`, get **409**,
    and leave «запись уже есть». No duplicate is created.
  - Feed today: `e20ab…` baseline, `a5abb…` (20.10, VPS), `38539468…` (22.10, manual).

## Decision: icons are rendered on the VPS (option a)

Rendering moves to the VPS. Nothing in the renderer depends on the host PC: the old code was the only blocker. Why
the VPS:

- The data stays one artifact built from one input: the snapshot. Players' `tfc publish` stays a plain upload.
- It works for the community release, where no host has the repo or jars set up for builders.
- A rendered-icon upload from the host (option b) would need a new upload channel, a hashing scheme and its own
  version skew. It also makes the host's PC a build machine.

**Fallback, implemented anyway as a safety net:** a publish never removes data files that the build didn't make
because of a missing capability. In general form: a **removal guard**. If the build reports `render` stats of 0
drawn plus 0 cached, publish refuses to touch `/icons/*/render/`. Any publish whose removals exceed 2 % of a root, or
more than 300 files, stops unless `allowRemovals` is passed (`tfc admin publish --live --allow-removals`).

## Changes

### 1. Build on the VPS renders icons

- `server/pack-server/lib/jobs.mjs` (spawn env):
  - Pass `TFC_MODS_DIR=<DATA>/work/<snap>/mods`, `TFC_PACK_ROOT=<repo>` and, if present,
    `TFC_PLATFORM_JAR=<DATA>/cache/platform/neoforge-<v>.jar`.
  - `worker.mjs` doesn't know the snapshot until it reads the spec, so the cleanest fix is for the worker to set
    these and then `await import()` `scripts/pack.mjs` dynamically.
- **Platform assets without Gradle.** A new `scripts/platform-assets.mjs`, called from `buildMods` before rendering:
  - Downloads and caches, in `<cacheDir>/platform/`, the Minecraft `client.jar`. `mods.mjs prepareVanilla()` already
    downloads it, so keep the jar instead of discarding it.
  - Also caches the NeoForge `universal` jar for the snapshot's loader version (`instance/sources.json` / snapshot
    `loader`, maven.neoforged.net, sha checked; `cli/lib/vanilla.mjs` already resolves NeoForge maven URLs).
  - `platformLayers()` gets a second source: if `platform()` is null, it uses these two jars. Only assets are needed,
    so the Mojang-mapped moddev jar is not required.
- `scripts/mods/icons3d.mjs`/`mods.mjs`: write the render stats (`drawn`, `cached`, `failed`, `code`) into
  `.build.json` (via `runPack` result) so publish and `tfc admin jobs` can see them.
- `server/pack-server/lib/jobs.mjs` `prepare()`: `git -c safe.directory=…` is not needed for the service user. Instead:
  - Show the repo commit and how far it is behind `origin/main` in the job log and `/health`, so a stale build repo is
    visible.
  - Make `AUTO_PUBLISH=live` builds always `pull` first (a live publish from stale code is the root cause of today's
    gap).

### 2. Mac deploy never touches pack data

- Shared list of data roots: `scripts/data-roots.mjs`, exporting `DATA_ROOTS`, the union of `MODS_OUTPUTS` from
  `ensure-mods.mjs` and the KubeJS outputs (`kubejs.json`, `kubejs-items.json`, `kubejs-data.json`,
  `icons-kubejs/`). `ensure-mods.mjs` and `publish-data.mjs` import it.
- **New `npm run deploy:site`**, `scripts/deploy-site.mjs`, using Hosting REST and no Firebase CLI for hosting:
  1. `vite build` with `TFC_SITE_ONLY=1`. `ensure-mods.mjs` then skips mod data entirely, so no jars, no copies and no
     pack server are involved. `predeploy-check`.
  2. `currentRelease()` and `versionFiles()`. The data-root entries are kept **by hash** from the live release, so
     nothing is downloaded or re-uploaded.
  3. Create a new version with `config` from `firebase.json` (headers, rewrites converted to the API form).
  4. `populateFiles` = site files from `dist/` minus data roots, plus the live data-root hashes. Upload only the
     missing hashes, finalize, then release.
  - Reuse `hosting-rest.mjs` (`hostingFile`, `populateFiles` loop, upload worker, finalize/release). Factor
    `deploy()` into "create version (clone or new)" plus "populate/upload/release".
  - No `pack-release` on this path: `packUpdates` is written only by publish.
- `firebase.json` `hosting.predeploy` gets a guard (`scripts/predeploy-check.mjs --full`). A plain
  `firebase deploy --only hosting` stops with the message «данные сборки ставит сервер сборки — npm run deploy:site»
  unless `ALLOW_FULL_HOSTING_DEPLOY=1` (first deploy or emergency).
- `.claude/skills/ship/SKILL.md`, CLAUDE.md commands, `docs/architecture.md`:
  - Site changes use `npm run deploy:site`.
  - Builder changes (`scripts/mods/…`, `mods.mjs`, `kubejs.mjs`, `scripts/mcp/render.mjs`…): merge and push, then
    `tfc admin rebuild --pull` (dry run), check the summary, then `tfc admin publish --live`.
  - The "full firebase deploy with jars" row goes away.

### 3. Publish guard (`scripts/publish-data.mjs`)

- `allowRemovals` option and thresholds as above. Report `removedByRoot` in the result, and give the refusal a
  Russian message with the counts and example paths.
- Also refuse when the build has `render.drawn + render.cached === 0` and the site has renders.
- Pass the option through the server API (`POST /admin/publish {dryRun, allowRemovals}`) and the CLI
  (`tfc admin publish --allow-removals`, `cli/`).

### 4. Rollout order (after merge to `main`)

1. `ship`: merge, push, then `npm run deploy:site` with the new script. Check that the live data roots are unchanged
   (diff of hashes before and after: 0 data-root changes).
2. VPS, with the user's go-ahead for restarts:
   - `cd /opt/tfc-plans && git pull && bash server/pack-server/deploy/install.sh` to update the service.
   - `tfc admin rebuild --pull`, a dry run that builds `d765` with renders.
   - Record time, peak RSS and swap use. If OOM: raise `BUILD_HEAP_MB` to about 1000 (swap exists) after asking.
3. Expected dry-run result:
   - `−` 0 under `/icons/*/render/`;
   - `+` addon items/icons (ee_extras, miner_tools, small_diesel…);
   - `~` `items.json`, `recipes.json`, `pack-manifest.json`…;
   - config docs mostly unchanged;
   - `packUpdates` «будет запись», which on the live run will be 409 / «уже есть».
   - Any remaining removals: inspect them, they should be only icons of items that are really gone.
4. `tfc admin publish --live` for `d765`. Check the site: an addon item has an icon, a TFC block has a 3D icon,
   «Обновления» has no new entry.
5. Set `AUTO_PUBLISH=live` in `/etc/tfc-pack.env` and `systemctl restart tfc-pack`, only with the user's approval.
   Alternative: keep the dry run and have the host run `tfc admin publish --live` each time.

## Files

- Modify:
  - `server/pack-server/worker.mjs`, `server/pack-server/lib/jobs.mjs`, `server/pack-server/server.mjs`
  - `scripts/publish-data.mjs`, `scripts/hosting-rest.mjs`, `scripts/ensure-mods.mjs`
  - `scripts/mcp/resources.mjs` (`platformLayers`), `scripts/mods.mjs` (keep `client.jar`, stats out),
    `scripts/pack.mjs` (stats in result)
  - `firebase.json`, `package.json` (`deploy:site`), `scripts/predeploy-check.mjs`
  - `cli/` (admin publish flag)
  - Docs: `.claude/skills/ship/SKILL.md`, `CLAUDE.md`, `docs/pack-server.md`, `docs/architecture.md`,
    `docs/state/infra.md`, `docs/state/icons.md`
- New: `scripts/data-roots.mjs`, `scripts/platform-assets.mjs`, `scripts/deploy-site.mjs`,
  `docs/plans/vps-publish.md`

## Verification

- **Local pack server** (`server/pack-server`, `npm run dev`) with a copy of the real snapshot jars:
  - The build job renders icons: the log has the «объёмные иконки» line, and `.build.json` has render stats.
  - Without the platform jar, a second run still downloads `client.jar` and the NeoForge universal jar into the cache.
  - Compare the render count with the main checkout (8559 for 234 mods; for 240 mods, more).
- `node scripts/publish-data.mjs <dir> --dry-run` against prod: 0 render removals. A crafted folder without renders
  must be refused by the guard.
- `deploy-site.mjs` dry-run mode (`--dry-run`): lists the site files to upload and confirms that the data-root hashes
  equal the live release. Then do a real deploy and repeat the hash diff.
- VPS dry run, measured (time, RSS, swap), then the live publish of `d765` and a check of the site in the browser
  preview (`dev-wt` is not needed: check the prod site pages for addon items and 3D icons).
- Not checked in game (not relevant). The cold render time on the VPS will only be known at step 4.2.

## Rollout log

- 2026-10-22, implementation notes beyond the plan:
  - The OOM risk was not the renderer: AdmZip in `scripts/mods/visibility/bytecode.mjs` (all jars at once),
    `multiblocks.mjs` (IE jars kept) and `manifest.mjs` read whole jars → `scripts/mods/zipfile.mjs`.
  - Dye colours without the platform jar: read from the obfuscated `client.jar` via Mojang mappings (identical values).
  - `pack-freshness.json` (from `main`) is a site file; in site-only mode its report uses the live manifest.
  - `npm run deploy` = rules + auth + `deploy-site.mjs`.
- 2026-10-22 rollout:
  - Merged to `main` (`b225b71`), pushed. The new `npm run deploy:site` made a real release (identical content,
    16 458 files, 0 uploads); the site and icons serve normally.
  - VPS service code updated to `3bfbbb0` (restart OK). The build repo was pulled to `3bfbbb0`, and the dry-run build of
    `d765` was run by hand as `tfcpack` (same worker, heap 640): **2 min 50 s cold**, max RSS 929 MB, swap unchanged.
    Rendered 8607 + 97 cached, failed 22. Publish dry run: hosting +47 ~7 −0, config 3 changed, packUpdates would POST
    `38539468…` → 409 (record exists). Log: `/var/lib/tfc-pack/jobs/j20261022-claude-dry.log`.
  - Not done (the agent was not allowed to: creating an admin key, a second service restart):
    - VPS service still on `3bfbbb0`, without the `.spec.json` loader fix (`b225b71`);
    - live publish of `d765`: host runs `tfc admin publish --live`;
    - `AUTO_PUBLISH=live`: host's decision;
    - new `tfc` build with `--allow-removals` and the render line in the summary (the old binary works; the flag is only
      needed when the guard stops a publish).
- 2026-10-22 18:31 UTC — **live publish** of `20261022-154041-2be2` by the host (`tfc admin publish --live --yes`;
  the first attempt never reached the server — the confirmation defaults to «no»). Hosting: 54 files uploaded,
  0 removed, 16 466 files, 8704 renders; config: 4 docs (new `miner_tools-helmet-server.toml`). «Обновления»: the
  snapshot changed only EE Extras 2.3.1 → 2.3.3 since the hand-written record, so the agent wrote that record
  (`0889664e…`, base = `d765` manifest) **before** the publish; the publish got 409 — no «+6 mods» duplicate against
  the stale site manifest. Checked on the site: manifest 240 mods (addons included), 13 668 items, 32 addon items with
  icons (PNG served), 3D icons of addons, TFC and Create Aeronautics.
  - Note: the publish log says «packUpdates: будет запись» even when the record already existed (409) — wording only.
- 2026-10-22 19:01 UTC — the user set `AUTO_PUBLISH=live` in `/etc/tfc-pack.env` and updated the VPS to `ad3cff2`
  (loader fix); log: «после смены текущего — сборка, публикация live»; all job records kept their state.
