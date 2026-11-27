# State: data builders, storage, pack server, `tfc` app

- 2026-11-21 (dev #401): Hosting REST retry is async again; fixes the syntax error that blocked lint and deployment. Verified module import and recovery after a temporary failure.

Part of [STATE.md](../STATE.md). Human docs: [pack-server.md](../pack-server.md), [tfc-app.md](../tfc-app.md); plan —
[plans/pack-cli.md](../plans/pack-cli.md) (stages 1–6).

## Repo split (dev #138, plan doc 23)

- Chosen (2026-10-29): one repo with packages (npm workspaces) + addons (`tools/`) moved to their own repo.
- **Stage 1 done (2026-10-29):** `packages/core` (`@tfc/core`) — 12 modules both the site and Node run (nbt,
  schematicFile + BlockFixes, datapackFiles, addonVersions, projection, recipeFilter, recipeRefs, liquidFuel, hash,
  freshness, files.config); `scripts/`, MCP and `cli/` no longer import `src/`. Checked: `tsc -b`, oxlint, Vite build,
  site pages on the dev server, MCP over stdio (map, freshness, recipes, datapacks), esbuild bundle of `tfc`, and
  `npm run mods` + `kubejs` before/after — 21 074 files identical except build timestamps. The pack server picks
  core modules from its builders copy at `packages/core/src` and falls back to `src/lib` for an old copy; `tfc admin
rebuild --pull` runs `npm ci` there (lock changed). Not checked: the VPS itself (rebuild/publish after this merge).
- Worktree preview and data (2026-11-05, dev #251): `worktree_add`/`worktree_preview` write the entry `wt-<name>` to the
  main `.claude/launch.json`, because the app reads only that file; `ship`/`worktree_remove` prune entries of removed
  worktrees. `fetchData` also takes the KubeJS outputs, so `npm run dev` has `kubejs.json` with `datapacks` and `snapshot`;
  a local `npm run kubejs` parse survives only with `TFC_KEEP_MODS=1`.
- Worktree preview files (2026-11-05, dev #265): `vite.config.ts` aliases `@tfc/pack-server` to the worktree's
  `server/pack-server/lib` (`tsconfig.app.json` — to its `.d.mts`), so edits there show in the preview; `server.fs.allow`
  adds the `node_modules` Node resolves (the main checkout's, only that folder), so Inter loads instead of a 403.
- **Stage 3 done (2026-10-29):** addons are the repo [tfc-addons](https://github.com/Jason1258t/tfc-addons) (history of
  `tools/` kept via `git subtree split`, 65 commits), checked out as the `tools/` submodule — every `tools/<mod>` path
  is unchanged. `tfc-plans-dev`: `worktree_add` inits it (objects from `.git/modules/tools` of the main folder),
  `ship` refuses a pointer not on tfc-addons `origin/main` or dirty/unpushed `tools/`, updates `tools/` in the main
  folder after the merge; `ship`/`worktree_remove` deinit the submodule first (git can't remove a worktree with one).
  `addons-index` (prebuild) inits an empty `tools/` and stops if there are no cards (an empty list would drop addons
  from the site). Pack server builders copy: `git submodule update --init --depth 1 tools` after pull (an old plain
  `tools/` folder is removed first). Not checked: the VPS itself.
- **Stage 2 done (2026-10-29), in place (host's choice, no move to `apps/`):** workspaces `@tfc/scripts` (`scripts/`,
  incl. both MCP servers), `@tfc/cli`, `@tfc/pack-server`, `@tfc/file-server`, own `package.json` and dependencies
  (adm-zip, esbuild, postject, smol-toml → scripts); site = root package (`react-router` now declared). Cross-package
  imports via `@tfc/<package>/<module>`; `scripts/repo-boundaries.mjs` (`npm run boundaries`, CI, `ship` gate) checks
  it. Exceptions `граница-ок`: pack-server `worker.mjs` → scripts, file-server `auth.mjs` → pack-server (VPS installs
  by folder copy). `npm run lint` now covers `cli/` and `server/` too. Checked: tsc, oxlint, boundaries (incl. a
  negative probe), esbuild bundle of `tfc` (same inputs), `@tfc/scripts/pack` resolution for `tfc build`, MCP over
  stdio, KubeJS data identical to `main`. Not checked: the VPS (`npm ci` on rebuild — lock changed).
- Still cross-repo: addon `release.sh` → tfc-plans `scripts/mcp/render.mjs`. Next (optional): stage 4 (server repo).

## Data builders

- `npm run mods`, `serverconfig`, `kubejs`, `world`, `pack-release` on deploy, and `npm run pack -- <version
folder|zip>` — all at once with folder discovery, whitelist and `instance/sources.json` (2026-10-20, stage 1).
- Parsers are a library: input, output and cache dirs are parameters; Firestore token from a service key
  (`GOOGLE_APPLICATION_CREDENTIALS`) or `firebase login`. `pack` was not run on the host's real instance folder (tested
  on an assembled copy in scratchpad: mods, KubeJS, test configs, calendar).
- **No `<repo>/mods/` since 2026-10-23.** Pack jars live in the snapshot cache outside the repo
  (`scripts/pack-cache.mjs`: `~/.cache/tfc-plans/pack`, `TFC_PACK_CACHE`; jar dir `TFC_MODS_DIR`), one copy per machine
  for all worktrees. `npm run pack:fetch` mirrors the current snapshot there (deletes files not in it; jars already in
  an old `mods/` of the repo are hard-linked instead of downloaded — on the host 234 of 241, 13.5 MB fetched). Readers:
  MCP (`MODS` = cache, its `.cache/mcp`/`tools/`/`instance/` stay in the main checkout — `WORK` in `mcp/data.mjs`;
  with `TFC_MODS_DIR` set, as on the pack server, they sit next to the jars as before), `npm run mods`, freshness
  fingerprints, `tools/*/libs.sh|test-server.sh|build.sh`, `ee-extras` art. `npm run dev` never reads jars:
  `ensure-mods.mjs` copies missing `public/` from the main checkout, then syncs mod data from the pack server
  (`/data`), soft-failing to the old data; the whole download is capped at 60 s (`TFC_PACK_TIMEOUT_MS`, 2026-10-24 —
  a worktree used to hang for minutes on a slow or dead server) and staged in `public/.tfc-data-new`, so a timeout or
  a network error leaves the files as they were; a full pull without a timeout is `npm run pack:fetch -- --data`.
  `TFC_KEEP_MODS=1` = offline. Pack server address/key: env, `.env.local`,
  else the `tfc` app login (`%APPDATA%\tfc\config.json` on Windows, `~/.config/tfc/config.json` on macOS/Linux —
  `configDir()` in `cli/lib/config.mjs`). The host may delete the old `mods/` (cache holds hard links).
- Guard against building without mods: the library build stops if the jar dir is empty but the previous build had mods (`TFC_ALLOW_NO_MODS=1` bypass); `pack-release` writes nothing at 0 mods or a loss of more
  than half (`ALLOW_MODS_DROP=1`). `predeploy-check` blocks a site built without Firebase settings.
- **Pack data is published only by the pack server** (2026-10-22, `docs/plans/vps-publish.md`): `npm run deploy:site`
  = `scripts/deploy-site.mjs` — site built with `TFC_SITE_ONLY=1`, new Hosting version from `firebase.json` config,
  data roots (`scripts/data-roots.mjs`) carried over from the live release by hash; `firebase deploy --only hosting` is
  blocked (`ALLOW_FULL_HOSTING_DEPLOY=1`). Freshness report in site-only mode uses the live manifest. Dry run checked
  against prod (config identical to the live one, 16 356 data files kept, `/__/firebase/*` kept).

- Mods inside jars (`META-INF/jarjar/*.jar` with `neoforge.mods.toml` and assets/data) are read like top-level jars
  (2026-10-22): Create Aeronautics bundle → `aeronautics` 46, `simulated` 86, `offroad` 7 items (+125 recipes). The
  pack manifest still lists only top-level jars. Dyed symmetric sails are blocks without items (drop the white sail,
  only `white_symmetric_sail` has an item model) — absent on purpose.

## Imported from the server

- Server config (`config/`, layer `config`; the host PC is the server): `tfc-server.toml`, `tfc-common.toml`,
  `firmalife-server.toml` (greenhouse). Other configs are not stored until used; list — `docs/plans/config-listing.md`.
  Since the 2026-10-20 publish all server TOMLs (103 docs) are in `config`.
- Electricity configs (2026-10-14): `electroenergetics-server.toml` (24 W per FE/t instead of 34, heater 15 Ω instead
  of 45), `immersiveengineering-server.toml` (dynamo × 2 instead of 3), `create-server.toml` — layer `config`.
- World save (`npm run world`): `tfc_calendar.dat` — month length 30 days (set by command).
- `tfc_real_world/server.toml` (profile `DEFAULT:FULL_EQUAL_EARTH`, radius 100000×50000, spawn GEOGRAPHIC 45.47° /
  10.94° — near Milan) and `tfc_eratosthenes-server.toml`.
- KubeJS: layer `pack` (84 scripts: 373 removals, 72 replacements, 1280 added recipes, 369 recipes in `kubejs/data`) and
  layer `world` (one script `ee_heater_crucible.js`). KubeJS removes 1325 pack recipes.
- Since 2026-10-21 `.json5` configs are imported too (`config_get`).

## File storage

- Package **firestore-files@0.1.0** (user's separate repo) — attachments and schematic sources.
- Package **cm-live-markdown** (user's separate repo, npm `^0.1.6`) — the live Markdown editor
  (details in [site.md](site.md)).
- Storage behind an interface (`src/lib/fileStorage`): Firestore (default) or own server `server/file-server` (Node
  without deps, systemd + Caddy, Firebase token and App Check verification, SSE). Migration —
  `scripts/files-migrate.mjs` (firestore / https / dir, ids preserved, sha256 check). Tested locally (site through the
  server: list, upload, read, delete, refusal without App Check; migration Firestore → dir → server → test collection →
  dir without diffs). `install.sh` not run on Ubuntu.
- **Decided not to migrate for now** (2026-10-19): 9 files, 68 KB; Firestore reads are spent mostly by tasks and guides.
  Migrate if we hit the 1 GB database or need files over 25 MB.

## Pack server (`server/pack-server`, stage 2)

- Stores the pack as snapshots — files by sha256 (identical jar once), snapshot = path list, current snapshot and
  rollback; keys `player`/`admin` (stored hashed, first admin key created by `install.sh`), path whitelist, bans on
  `server.properties`, player lists/data, logs. Node without deps, systemd + Caddy next to the file server (Caddy blocks
  in `conf.d/`). Tested locally by node script (upload, snapshots, rollback, key/path refusals, restart).
- **Installed 2026-10-20: `https://tfc-pack.duckdns.org:28788`** (VPS Ubuntu 24.04, 1 core, 2 GB RAM, 30 GB; SSH from
  Mac — `ssh tfc`, root). Code — `/opt/tfc-plans` (git clone), service `tfc-pack` (127.0.0.1:8788), data
  `/var/lib/tfc-pack`, settings `/etc/tfc-pack.env`. HTTPS — Caddy on **28788** with a DuckDNS DNS cert (token
  `/etc/tfc-pack/duckdns.token`, root only). Firebase service key — `/etc/tfc-pack/firebase-sa.json` (root:tfcpack
  640): Firestore reads and Hosting release list verified from the server. Admin key given to the host. Key `claude`
  (admin) is the agent's, revocable.
- **Foreign services on the machine — don't touch:** Telegram proxy (Docker, 443), Xray (6080, 6443, 6444, 8080; 8443
  reserved for Xray), a bot, raven-subscribe (47291), ufw rule on 6000. New ports only after `ss -tulnp`,
  `ufw status`, root command history.
- **Build and publish on the server** (stage 4, 2026-10-20): after the current snapshot changes and on
  `POST /admin/rebuild` the server builds site data with its own repo copy (`/var/lib/tfc-pack/repo`, `git pull` on
  request), peak memory ~0.8 GB at `BUILD_HEAP_MB=640` (no swap, not needed yet). Publish — Hosting only changed files,
  `config`, `packUpdates`; **dry-run by default** (`AUTO_PUBLISH=dry-run`), real — `POST /admin/publish
{"dryRun": false}` / `tfc admin publish`.
- **First real publish 2026-10-20**, host snapshot `20261020-161550-09d2` (current): +2 mods (addons ee_rectifier,
  ee_overheat) in `packUpdates`, 103 new `config` docs (all server TOMLs without client ones; no secret-looking keys),
  2 icons and 5 data files on Hosting. First attempt failed: Firestore can't store nested arrays
  (`createentitycontrol-common.toml`, `blocks_limit`) — `toValue` now writes inner arrays as `{ __array }`. Old test
  snapshot `20261020-120830-b1bc` remains in history.
- **Mod data on the site comes from the server.** `npm run dev` takes mod data from the server (see «No `<repo>/mods/`»
  above); `npm run pack:fetch` — pack jars from the server into the snapshot cache.
- **3D icons on the VPS** (2026-10-22): the build repo was 111 commits behind (pre-icons), so the 22.10 dry run wanted to
  remove 8559 renders. The renderer is pure Node; the worker sets `TFC_MODS_DIR` to the snapshot's `mods/` before
  importing builders; without a NeoForge platform jar the build downloads `client.jar` + Mojang mappings and the
  NeoForge universal jar (`scripts/mods/platform-assets.mjs`, `<DATA>/cache/platform/`; dye colours read from the
  obfuscated class via mappings — identical to the platform jar). `.build.json` has `render` stats. AdmZip in
  visibility/multiblocks/manifest read whole jars into memory (OOM at 640 MB) → `scripts/mods/zipfile.mjs` (offset
  reads). Checked locally with `worker.mjs` on a 234-jar snapshot, heap 640: renders 8559 + 129 aeronautics, peak RSS
  785 MB, 42 s warm (cold render ~1–2 min on the Mac); dry run vs prod — 0 removals, 1 changed file.
- **Publish guard:** a build without renders keeps `icons/*/render/` on the site; > 300 removals need
  `allowRemovals` (`tfc admin publish --live --allow-removals`). `AUTO_PUBLISH=live` builds pull fresh code first.
- VPS code updated 2026-10-22 19:01 UTC (`ad3cff2`, incl. the `.spec.json` loader fix; job records intact after the
  restart). **`AUTO_PUBLISH=live`** since then (user's decision). Renders on the VPS work
  (cold 2 min 50 s, then ~45 s from cache). **First live publish with renders 2026-10-22 18:31 UTC** (snapshot
  `20261022-154041-2be2`, +54 files, 0 removed). Rollout log — `docs/plans/vps-publish.md`.

## `tfc` app (`cli/`, stage 3+)

- **Versions** (2026-11-08, dev #307): `tfc --version` → `tfc 1.0.0 (сборка 70, 2026.11.05-95fc2b81)` — readable
  version from `cli/package.json` (`npm run tfc:bump -- patch|minor|major`, rule in docs/tfc-app.md «Версии tfc»),
  build number = `git rev-list --count` of the program sources, commit label. `version.json` gains `release`/`build`;
  updates still compare commit time. `tfc:dist` refuses a site build whose program changed but release didn't grow,
  or whose build number is not above the published one (`--no-public` only warns). `--upgrade` refuses a downloaded file
  whose `--version` doesn't name the expected label. Checked: macOS arm64 build, both refusals against a fake
  published `version.json`, `--upgrade --force` from a local server and the mismatch refusal; Windows/Linux not run.

- `init`/`login`/profiles, `status`, `publish` (host; only missing files, protection from overwriting an edit from
  another device; without a game version in the folder — from past snapshots or by asking), `build`, `admin` (keys,
  history, rollback; `rebuild`/`publish`/`jobs` — server-side build and site publish, dry-run by default, with log and
  summary; checked with a local server, not on prod with an admin key).
- **Single file** (stage 6): `npm run tfc:dist` → `dist-tfc/` and `public/tfc/` (zip for Windows x64, macOS arm64/x64,
  Linux x64, ~33–41 MB; Node SEA, Node 24.13), download block on «Обновления»; `tfc --version`, daily update check via
  `/tfc/version.json`. Built macOS file (arm64, x64 via Rosetta) passed host+player scenario with a local server (33
  checks); **Windows exe and Linux file not run** (PE/ELF headers checked). Node script with local server (58 checks)
  and `status` on prod. Files `2026.10.20-540e283` published to the site.
- **One `tfc pull`** (2026-10-21, replaces `tfc sync` + `tfc pull <kind>`): pack from the server + addons + flagged site
  datapacks/scripts + schematics; parts `mods` (with addons) `config kubejs resourcepacks datapacks world schematics
addons`; with names — one named site item; `tfc undo` — undo the whole pull (one backup for pack and site);
  `tfc sync` / `sync --undo` — hidden aliases with a hint. Pack and site don't fight over paths: for addons the site
  wins (another addon version from the snapshot by jar name, `replaces` and jars with the same mod id are not installed;
  remembered in `addonOverrides` in state.json); a server folder gets addons of its side, pack mods only via
  `tfc pull mods`; a client with a world also gets world datapacks. Sync deletes only its own files, player edits go to
  `*.tfc-new`, backups and `--undo`, old mod version by mod id. Tested from sources on macOS with a local pack server
  and Firestore/site stubs. **Built file, Windows, real launcher folder and the game — not checked.**
- **Fast pull** (2026-10-22): downloads go to a shared cache (`cacheDir()` in `cli/lib/config.mjs`: `~/Library/Caches/tfc`,
  `%LOCALAPPDATA%\tfc\cache`, `~/.cache/tfc`; `TFC_CACHE_DIR`), 6 parallel requests; files ≤256 KB via
  `POST /blobs/pack` (gzip stream, ≤8 MB / 1000 files per request from the client); hash computed while streaming; copy
  to the instance with `COPYFILE_FICLONE`; cache pruned after apply (not in current snapshot and untouched 14 days).
  Old server → small files one by one in parallel. Local test, 60 ms per request, 2259 files / 127 MB: old 156 s /
  4529 requests, new client + old server 28 s, new + new 4 s / 41 requests; resume, corrupt `.part`, second profile
  from cache, prune — checked. Not checked on the real VPS / Windows.
- **`tfc addons`** (2026-10-25, `cli/lib/addons.mjs`): `list` — one line per addon as `<id>@<latest released>` (+ what
  is installed/pinned here), `--host-only` — cards with `hostOnly: true` (host_tools, rw_host_fix; passed through
  `/site/addons` and `/addons/index.json`, `tfc pull` still installs by `side`); `tfc addons <id…>` — all versions as
  `<id>@<version>`; `install <id>@<version>…` = `tfc pull addons …`. `install --host-only` — all host addons; `tfc publish --no-host-addons` drops their jars
  (`isAddonJar`: id or jar name of any version) from the snapshot — checked on a temp folder, no upload. Checked from sources against the prod pack server
  (list, versions, errors) and a stub API for `--host-only`; `install` on a real game folder — not checked.
- **Empty `tools/` guard** (2026-11-01, dev #189): the server copy `<DATA_DIR>/repo` kept an empty `tools/` after the
  submodule move, `/site/addons` returned `[]`, `tfc pull` planned removing every addon. Now the server answers 503
  without cards and fills `tools/` on start; `tfc pull` treats 503/empty as a failure (latest from site static, pins
  neither applied nor dropped), refuses if the site is empty too. Checked with local servers and stub API.
- **`tfc report`** (2026-10-25, `cli/lib/reports.mjs`, task BDoIffX3jFbb4laaIr5N): logs and crash reports to the site.
  Types: game-log (`logs/latest.log` + `*.log.gz`), crash-report, debug-log, kubejs-log, jvm-crash (`hs_err_pid*`);
  with a profile server folder — server-log, server-crash. Interactive: type list with counts → Enter latest / N latest /
  names; note. Non-interactive: `tfc report crash`, `log 3`, `<type> <name,…>`, `--note`, `--task`, `--dry-run`,
  `--instance`. Player IPs `/a.b.c.d:port` masked (gz unpacked for that); several files or one > 1 MB → zip; ≤ 25 MB.
  Pack server `POST /site/reports` (player key, meta in `X-Report`) writes firestore-files format (meta complete:false →
  700 KB chunks → complete:true, cleanup on failure). Checked: dry-run scenarios, interactive flow via `expect`, real
  uploads through a local pack server to prod Firestore (1 file, 2-file zip, 3-chunk 1.6 MB zip), read back by MCP
  byte-identical, deleted. VPS server updated by the host 2026-10-25; a real upload through prod read back by MCP and deleted. **Not checked:** Windows paths/consoles, a real game folder.
- Profile maintenance (2026-11-05, dev #219/#237): `tfc rename` changes the CLI profile key and optionally renames a
  managed launcher version in place. `tfc delete` uninstalls the program; `--versions` also removes separate managed
  version folders after confirmation, optionally limited by `--profile`.
- Launcher profile isolation (2026-11-05, dev #242): NeoForge updates use the selected tfc profile's existing game
  folder and version, including legacy profiles inferred from their paths. New copies get separate version folders,
  official launcher profile keys and numeric TLauncher IDs. A matching legacy official launcher key is reused.
- Installed NeoForge detection (2026-11-05, dev #258): the launcher version JSON beats `minecraftinstance.json`, and a
  profile with `launcher.version` reads that version even when its game folder is the `.minecraft` root; the highest
  `libraries` version is compared numerically.
- TLauncher update safety (2026-11-05, dev #260): an open TLauncher strips the `modpack` block (seen on the host: open —
  block gone, closed — pack opens). `launcherRunning` also looks for java processes with `tlauncher` in the command line
  on Windows (**not run on Windows**). `installToLauncher` merges the version JSON (keeps launcher fields and `type`) and
  copies it and `TLauncherAdditional.json` to `*.tfc-<time>`; `tfc status` and `init --launcher` warn if the block is gone.
- TLauncher unfolded versions (2026-11-05): on launch TLauncher rewrites a short version JSON (`inheritsFrom`) into a full one
  with `arguments.game` as `{ values: [...] }` and drops the `modpack` block, so the first launch has 2 mods. Host's test
  on `TFC-RealWorld`: short JSON — 2 mods and block gone; TLauncher's own full JSON + block — pack loads, block kept.
  `detectVersions` reads those arguments; `installToLauncher` leaves an unfolded JSON of the same NeoForge alone and, when
  a `.tlauncher` folder exists and `versions/<parent>` is there, writes NeoForge + parent merged without `inheritsFrom`
  (order and arguments match TLauncher's file). Without them — the short form, as the official launcher expects.
  Host's TLauncher on 2026-11-05: `tfc`'s own full JSON, all mods on first launch, block kept. Not run: an official launcher
  with a `.tlauncher` folder alongside, a real NeoForge version change.
- **`tfc init --launcher`** (2026-10-22, `cli/lib/vanilla.mjs`): official Minecraft Launcher — NeoForge from the
  snapshot `loader` via its installer (`--install-client <mcDir>`, maven sha256, cached; needs launcher_profiles.json —
  created temporarily if only the Store file exists), Java 21+ from `<mc>/runtime`, Store runtime, JAVA_HOME, PATH;
  game dir `<mc>/versions/TFC-RealWorld`, launcher profile `tfc-realworld` (Xmx from RAM or `--memory`) in
  launcher_profiles.json and `_microsoft_store.json`; the installer's «NeoForge» profile is restored; backups
  `*.tfc-<time>`; then `tfc pull`. Also an item in interactive `tfc init`. Checked on macOS with fake `.minecraft`
  folders against the real VPS (install 21 s, rerun idempotent, Store-only file, error texts, menu in a TTY). **Not
  checked:** the real launcher starting the profile, Windows/Linux, the game itself.
  2026-10-22 later: own version `versions/<name>/<name>.json` (copy of the NeoForge json with `id` = name, inherits
  1.21.1) so TLauncher lists it; profile `lastVersionId` = name; works without launcher_profiles.json (TLauncher-only
  `.minecraft`: temp file for the installer, no profile written); Java also from `.tlauncher`. TLauncher's
  game dir = the version folder — **confirmed by the host** (plays `.minecraft/versions/TerraFirma Rebirth 2` via
  TLauncher). 2026-11-01: **not universal** — a player's third-party launcher ran version `TFC-RealWorld` with
  `--gameDir .minecraft` despite our profile, so no pack mods loaded (`create_connected:sync_config` refusal).
  `launchedElsewhere` (detect.mjs) reads `<mc>/logs/latest.log`; `status`/`pull`/`report` warn, `report` takes logs from
  the real folder. `tfc init --instance` also expands `$env:X` / `%X%` left unexpanded by the shell.
  Snapshot `loader` must cover mods' NeoForge minimum (it was 21.1.248 while pyrofuel/builder_tools need 21.1.251, so
  new installs crashed): `tfc publish` raises it from the jars and publishes a loader-only change; `init --launcher`
  upgrades after pull and keeps a pack already moved to the `.minecraft` root; `status`/`pull` warn. `tfc init` lists `<.minecraft>/versions/*` with `mods/` (label «TLauncher / .minecraft» + loader);
  `detectVersions` reads `<dir>/<name>.json` (`--fml.neoForgeVersion`, `--fml.mcVersion`, `inheritsFrom`). Progress: `spinner` /
  `withSpinner` in ui.mjs (prepare, file scan, NeoForge installer phases in Russian, placing files); progress bar
  shows speed and ETA, redraws every second.
- Site content (stage 5): datapacks → `<world>/datapacks/tfc-plans-<id>.zip`, kubejs → `kubejs/server_scripts/<fileName>`,
  schematics → `schematics/` (with replacements and shape). An unflagged item removes only our unchanged file; a foreign
  file with the same name → `*.tfc-new`; tracked in `pulled` in `.tfc/state.json`. Content via the pack server
  (`GET /site/datapacks|kubejs|schematics`, `/site/files/:id`): reads Firestore with the service key, lists cached 5 min,
  schematic sources on disk. Checked on prod Firestore (read-only) — 1 flagged datapack and 4 schematics installed; a
  temp key was used and revoked. **Not checked in game.**
- **Players' uploaded schematics** (2026-10-22): Create stores a schematic a player uploads in the Schematic Table
  at `<server gamedir>/schematics/uploaded/<nick>/<file>` and the cannon builds from that copy (client hologram —
  local `schematics/<file>`; checked in Create 6.0.10 `SchematicItem.loadSchematic`, `ServerSchematicLoader`).
  The host plays the world from his client, so the copies are in his folder. `tfc pull` (schematics part; now also
  default on server profiles, where the `schematics/` root is skipped) replaces `uploaded/*/<library file name>`
  when the hash differs (`uploadedCopies` in `cli/lib/pull.mjs`), backed up, not recorded in `pulled`. A cannon
  already printing caches the template until the schematic is taken out. Scratch test (client + server profile,
  real library sources): 16/16. **Not checked in game.**
- **Addons** (2026-10-21): from site static (`/addons/index.json` — built by `scripts/addons-index.mjs` before dev/build
  from `tools/*/addon.json` + jar sha256; no key needed) → `mods/`; old jar of the same mod (by id in jar) and files in
  the addon's `replaces` (rw-host-fix — `eratosthenes_portal_clamp.js`) are backed up, with a prompt or `--yes`. That
  `publish` takes jars from `mods/` and sees the removed script — checked by folder analysis without upload. **Not on
  Windows, not with a real upload.**
- `tfc --upgrade` — self-update (version.json → zip for own OS → sha256 → trial run → replace; on Windows the old exe is
  renamed `.old`). Checked on macOS arm64 with a local site copy; **not on Windows**.
- **Auto-update** (2026-10-24, `autoUpgrade` in `cli/lib/upgrade.mjs`): before any command, once per terminal session
  (parent pid; min 10 min between checks) or daily — if the site has a newer build, upgrade first, then re-run the same
  command with the new file (`TFC_UPGRADED=1`, `TFC_SESSION`). Failure/offline → warning, old version runs.
  `TFC_NO_AUTO_UPDATE=1` opts out. Checked on macOS arm64 binary with a local version.json (upgrade + re-run, exit
  code, offline, opt-out, session/10-min logic); **not on Windows, not the npm channel**.
- **Install** (2026-10-22): `tfc install` / `uninstall` — own folder (`%LOCALAPPDATA%\Programs\tfc`, `~/.local/bin`) and
  PATH (HKCU registry on Windows, a marked line in the shell rc); running without a command outside the install folder
  (double click) offers to install itself; one-line installers `/tfc/install.ps1` (`irm … | iex`) and `/tfc/install.sh`
  (`curl … | sh`); npm package `tfc-plans` (`/tfc/tfc.tgz`, `npm install -g <url>`, `--upgrade` via npm; not on the npm
  registry). Site shows three ways in the «Программа tfc» block. Checked on macOS arm64 in a fake home. **Windows
  (PowerShell installer, registry PATH, uninstall) and Linux not run.**
- **Config noise** (2026-10-22): of 28 snapshot changes only 2 were real. `tfc publish` doesn't upload mod state
  (`isStatePath`: EMI Accelerator caches, JEI history, spark journal with nick, Sodium fingerprint, Chunky tasks…);
  files differing only by `.properties` header date, blank lines or world time in the calendar, and client ones
  (`-client`, now also `.snbt`/`.yaml`/`.ini`) keep the server's version. `tfc pull` stores semantic keys
  (`state.norms`): a game rewrite updates without `.tfc-new`; a player edit with an unchanged pack file stays silently.
  Checked on the whole snapshot history and an end-to-end host → player scenario (from sources). **Built file on
  Windows and a real upload not checked**; state already in the current snapshot will leave it on the next
  `tfc publish`.
- **Site datapacks** (2026-10-22): each site datapack was in the snapshot twice (manual copy `zipName`, one stale, and
  `tfc-plans-<id>.zip` from `pull`), and «pack wins for datapacks» blocked site edits from reaching the game. Now the
  site wins: `publish` doesn't upload them (`siteDatapackPaths`), `pull` takes them from the site even if the snapshot
  has a copy and removes the manual copy (obsolete). Checked end-to-end on a local server (old tfc snapshot with 20 zips
  → new player pull −9 copies, «Фикс магмы» updated → new publish keeps 2 own → repeated pull no changes).

## Agent config edits (2026-10-21)

MCP `config_propose` (key, type, range and layer check via `config_get`) → Firestore `configChanges` → pack server
`/admin/changes` → `tfc admin changes [pull|reject]`: edits only the key's value in all TOML copies (`config/`,
`defaultconfigs/` of the game folder and `--server-dir`; `serverconfig/` and `<world>/serverconfig/`), backup for
`tfc undo`, per-key result reported back (`config_changes`). Checked on a local pack server and temp folder (apply,
mismatch with the old value, reject, cancel from MCP, stale record → 409, undo); JSON5 configs are not edited. Not run on
the host's real folder.

## Manual addons and staging over pull (dev #201, 2026-11-03)

- Card flag `manual: true`: visible on the site and in `tfc addons`, installed only by name, plain pull keeps and updates
  an installed one, `tfc addons remove`, not uploaded by `tfc publish` unless already in the snapshot. Old clients: server
  gates it behind `/site/addons?v=2`, `index.json` omits it (old no-key clients read it). `destroy_extras` and `destroy_bridge`
  used it until 2026-11-13 (dev #341): since Destroy Extras 0.8.1 both are regular addons installed by plain `tfc pull`.
- Staging: `tfc admin updates subscribe|unsubscribe|subscribed`, client-only state in `.tfc/state.json` (`staging`,
  `stagingPaths`, `stagingDrop`), logic in `cli/lib/staging.mjs`. `tfc pull` plans against a virtual snapshot
  (current + updates), so regular files keep updating and unsubscribing is just the next plain plan. Update wins over the
  pack and addons; old jars dropped by name, by mod id once on disk. `tfc publish` keeps server versions for staged paths.
- `tfc admin propose`: `--jar`, `--datapack`, auto `remove` of old jars (`--keep-old`). Server: update field `datapacks`,
  `confirmDatapackItems` shared with `changeDatapacks`, approve confirms in the same snapshot (`options.datapacks`), activates
  before writing the status (`activate`, base = parent), stores `parent`. Old records work unchanged.
- `--replace-datapack` (dev #261): swaps a pinned pack for its card version in one approval; update field
  `datapacks[].replaces` = pinned sha256/contentHash/revision, rechecked at propose and approve, `--force` doesn't bypass it,
  `tfc datapacks confirm` refuses it. Overlaps ignore the replaced version. Staging keeps the pack pinned with the new ZIP.
- Verified with a throwaway script: local pack server on a temp data dir + Firestore stub (`SITE_DOCS_URL`, fake service
  key with a local `token_uri`), 81 checks over the full flow. Not verified: in the game; the first real update through
  the new flow.

## Proposed pack updates (2026-10-22)

- Server `lib/updates.mjs` + `/admin/updates` (create, list, approve → snapshot = current + files − remove and made
  current with the site build job, reject); author can't approve (403); paths changed in the pack since the proposal →
  409 `conflicts` (`--force`); another version of an update's mod jar added since the proposal → 409 `jarConflicts`, not
  forceable (dev #263: the path check missed these, approve would have left two versions of a mod). `GET` returns both
  for pending updates. `tfc admin updates` lists pending only (`--rejected`, `--approved`), `approve all` checks the whole
  batch first and refuses `--force`. CLI: `tfc admin propose <dir>`, `tfc admin updates [pull|approve|reject]`; pull writes
  into the game folder (backup for `tfc undo`) and `mods|config|defaultconfigs|kubejs` of the server dir; approve marks
  the host's state in sync (next `publish` — nothing to upload). Verified end-to-end on a local server (scratch dirs):
  propose, self-approve refused, pull into both folders, undo, approve, host status/publish clean, player pull, conflict
  409, reject. Direct snapshot edits by the agent — intentionally not provided (user's call).
- Deployed to the VPS 2026-10-22 (`install.sh`, service restarted, health OK). Agent key `claude-agent` (admin) — in
  `~/.config/tfc/config.json` on the Mac (never printed); the old lost `claude` key revoked. First update:
  `u20261022-150945-83a0` (pack-patches/l10n).

## Whole-pack stand (dev #133, 2026-10-31)

`scripts/pack-stand.mjs` (`npm run stand`, MCP `pack_devserver`): production NeoForge dedicated server (installer into
`~/.cache/tfc-plans/stand/neoforge-<ver>`, version from `.tfc-fetch.json` `loader`, else 21.1.251) with the snapshot
cache — mods minus client-only, `config/`, `kubejs/`, `world/`; flat world, RCON, then a summary (KubeJS script
counts and errors, grouped `latest.log` ERROR/FATAL lines, crash report). `overlay=` copies a folder over the run dir
(test a `tfc admin propose` overlay first), `mods=` replaces pack jars by modId. Production launch avoids both dev-run
blockers (TFC Registry API on source folders, KubeJS TFC `!isProduction()` assertion).

Client-only mods: `scripts/pack-stand-client.json` + Fabric `environment=client` + anything with a required dependency
(any side) on an excluded mod. **Roxy** (needs Sodium on the client) was the cause of Create/FTB command
`BootstrapMethodError → LocalPlayer`: its common mixin makes `CommandSourceStack` implement
`FabricClientCommandSource`. Mods whose main class is client-only are found from the crash report, dropped and the
server restarted (reported as «добавьте в pack-stand-client.json»).

Verified on snapshot `20261029-192724-29d7`: 224 of 243 mods, boot 96 s, KubeJS 6/6 startup and 84/84 server scripts,
FTB commands registered. Stand reports real errors: 16 `concrete_lime.js` cement recipes and one
`create_flight_control` deploying recipe (the pending #157 fix isn't in that snapshot).

## Remote whole-pack stand (dev #275)

The stand runs as `master` on Ubuntu `test1a` (`100.109.147.20` in the owner's Tailscale network).
SSH from the Mac was verified over Tailscale. Join the same tailnet before connecting. The Mac already has the host
key under its LAN address, so reuse that entry with `HostKeyAlias` and keep host key checking enabled.
AutoLab, its Docker containers, and Ollama are outside this workflow.

Node.js 24 and Java 21 are installed under `~/.local/opt/tfc-stand/{node,java}`. The server runs from a source
export in `~/tfc-stand/repo`, with the pack snapshot in `~/.cache/tfc-plans/pack`. Update the export from the revision
being tested. If the revision removes source files, use a fresh export directory. For uncommitted changes, sync the
files needed by the test. Refresh the pack cache on the Mac with `npm run pack:fetch` when a test needs a newer
snapshot. Sync it into the dedicated pack cache with `--delete` to remove jars from older snapshots.

```bash
tfc_ssh() {
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o HostKeyAlias=192.168.0.101 "$@"
}
tfc_host=master@100.109.147.20
tfc_ssh "$tfc_host" 'mkdir -p ~/tfc-stand/repo ~/.cache/tfc-plans/pack'
git archive HEAD | tfc_ssh "$tfc_host" 'tar -xf - -C ~/tfc-stand/repo'
rsync -a --delete -e 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o HostKeyAlias=192.168.0.101' \
  ~/.cache/tfc-plans/pack/ "$tfc_host:.cache/tfc-plans/pack/"
tfc_ssh "$tfc_host" 'bash -se' <<'REMOTE'
export JAVA_HOME="$HOME/.local/opt/tfc-stand/java"
export PATH="$HOME/.local/opt/tfc-stand/node/bin:$PATH"
cd ~/tfc-stand/repo
npm ci --ignore-scripts --no-audit --no-fund
cache="$HOME/.cache/tfc-plans"
loader=$(node -p 'require(process.argv[1]).loader' "$cache/pack/.tfc-fetch.json")
ram=$(mktemp -d /dev/shm/tfc-stand.XXXXXX)
trap 'rm -rf -- "$ram"' EXIT
mkdir "$ram/stand"
cp -a "$cache/pack" "$ram/pack"
cp -a "$cache/stand/$loader" "$ram/stand/"
TFC_PACK_CACHE="$ram/pack" TFC_STAND_DIR="$ram/stand" npm run stand -- --port 25617 --cmd list
REMOTE
```

The smoke test stages the snapshot and loader on tmpfs to avoid slow random reads from the HDD. It starts NeoForge,
sends `list` through RCON and stops the server. Both ports are bound to loopback. Copy any detailed logs or worlds
you need out of the run directory before the shell exits and removes the temporary files.
For an overlay or a replacement jar, copy it to a separate directory on `test1a` and pass its remote path to
`--overlay` or `--mod`. Use the output summary for KubeJS and startup diagnostics. Run one check at a time on
the default ports. For concurrent checks use separate `TFC_STAND_DIR` values and separate port pairs.
The local MCP `pack_devserver` still runs on the host that started the MCP server. Use the SSH command above to run
the stand on `test1a`.

Before testing a new loader, install it into the persistent stand cache. If `maven.neoforged.net` times out on
`test1a`, sync the `libraries/` directory from a working NeoForge stand cache for the same loader version. Use `~/.cache/tfc-plans/stand/neoforge-<version>/libraries/` on both hosts and confirm
that the source includes the version's `unix_args.txt`. The stand can then start without fetching the installer.

Verified on `20261105-135644-3704` with NeoForge 21.1.251. The RAM-backed run booted in 122 seconds with 231 mods,
answered RCON `list`, and stopped. Both listeners bound to loopback. The snapshot reported recipe and tag errors
without blocking startup.

## Background print check of library schematics (dev #305)

Every library schematic is printed with the Create schematicannon on the whole-pack stand in the background; the site
shows the result (badge in «Библиотека схем», block «Проверка печати пушкой» in the schematic panel).

- **Queue and results — pack server** (`server/pack-server/lib/print-checks.mjs`, `<DATA_DIR>/print-checks.json`).
  A schematic waits when it has no result for its key (source `fileId`+`sha256`, `replace`, `shape` — description
  edits don't count) and the environment (current snapshot + latest `released` version of every non-manual addon,
  as `tfc pull` installs). New/changed schematics first, then rechecks after a new snapshot/addon; small before big.
  One batch at a time: ≤ 8 schematics and ≤ 40k blocks (bigger ones alone); deadline `900 + 0.12 × blocks` s of the
  biggest (sites print in parallel). Worker silent > 20 min or past deadline + 30 min → every schematic of the batch
  gets «неясное» (`not_finished`) with the last stage/log line; a stale result stays visible as «прошлая проверка».
- API: `GET /print-checks` (site login with the player mark or any key; CORS) — `{ env, running, queued, items: { id:
{ state: queued|running|done, position, current, previous } } }`; `worker` or admin key: `POST /print-checks/claim { worker,
max }`, `/progress { batch, stage, note }`, `/result { batch, result }` or `{ batch, error, log }`,
  `/recheck { ids } | { all: true }`. Reads Firestore only through the 5-minute schematic list cache.
- **Worker — `test1a`** (`scripts/print-worker.mjs --once`, run by the stand queue worker when it is idle — see
  «Stand queue» below; the old `print-worker.sh` cron wrapper is gone): claims a batch,
  `fetchPack` if the cached snapshot differs, downloads addon jars by sha256 to `~/.cache/tfc-plans/print-addons`,
  copies pack + NeoForge to `/dev/shm`, runs `printCheck` (survival, restart, addons as `mods`) in a child process,
  heartbeats every minute, posts the result. Child crash or kill → `error` + log tail → «неясное».
- Installed on `test1a` 2026-11-07: clone `~/tfc-stand/print-worker/repo`, key in `~/tfc-stand/print-worker/env`
  (600; `TFC_PACK_URL`, `TFC_PACK_TOKEN`) — key `print-worker`, id `e1c60c9b88ad`, role `worker` (reads the pack,
  writes only claim/progress/result; no admin, no site login); the stand queue cron line runs it. Revoke:
  `tfc admin revoke e1c60c9b88ad` (or on the VPS `node cli.mjs key revoke …`). A new key: on the VPS `cd /opt/tfc-pack && sudo -u tfcpack env DATA_DIR=/var/lib/tfc-pack
node cli.mjs key add print-worker --role worker`, write it into the env file.
- First full run (test copy, 2026-11-07, snapshot `20261106-194903-3047` + 13 addons): boot ~2 min; 8 small schematics
  ~1 min, 30k blocks ~5 min, the 190k-block cathedral 19 min of printing. Results archived on `test1a` in
  `~/tfc-stand/print-worker/test-2026-11-07/`.

## Stand runtime recovery (dev #416, #414, #404)

Restored the full addon acceptance and client runner after #358 had replaced them with incomplete stubs.
`tfc-pack` and the queue now import without a missing `freeze.mjs` or missing exports. Addon acceptance again builds,
checks and freezes jars, judges scene/chain results and attaches evidence. Client setup, launch, screenshots and
cleanup are restored. Scenes in saved TFC worlds remain supported; acceptance requires the copied-world marker.
Verified MCP startup and item lookup, addon chain validation, positive/negative scene verdicts, lint and package
boundaries. After renewed Tailscale SSH authentication, the direct run of the published main reached the menu in
172 s, returned a visually checked PNG and exited normally (187 s total; 9 startup + 3 client KubeJS scripts, zero
script errors). Evidence is attached to #416. The queue checkout had diverged from GitHub: its clean old main was
preserved as `archive/stand-before-recovery-20261126`, and main now tracks origin/main at 6200e325. No local commits
were discarded. The updated queue run 20261126-125503-6e8d reached the menu in 130 s, returned a PNG and exited normally
(149 s total, zero KubeJS script errors). Runtime checkout freshness checks are tracked in #419.
The old etching-bath job 20261125-103306-78dd was correctly rejected by restored addon acceptance for missing
SCENE END and required screenshots; it is not evidence of a successful addon scene.

## Stand queue on test1a (dev #310)

Agents queue whole-pack stand runs instead of holding the stand from their session and polling its log. Measured
before (226 Claude Code transcripts, 26 with the stand): log text itself was ~2 % of tool output, but 14–31 % of the
turns of stand sessions went to the stand, 203 of 373 of them waiting/polling (`sleep`, `tail`, `ps`) — every turn
re-reads the whole context. So the queue answers «done» in one call.

- **Worker** — `scripts/stand-queue.mjs serve` on `test1a`, kept alive by cron every minute through `flock`
  (`scripts/stand-queue.sh`). Runs from the print-worker clone
  `~/tfc-stand/print-worker/repo` (main; `git pull` on start, exits by itself when `origin/main` moves while idle, cron
  restarts it within a minute). One run at a time (client 8G + server 6G don't fit 14 GB together). Agent jobs first;
  idle → one background print-check batch (`print-worker.mjs --once`) at most every 10 min. A long print batch (up to
  ~20 min for the cathedral) is not interrupted — an agent job waits behind it, `stand_jobs` says so.
- **Queue folder** `~/tfc-stand/queue` (`TFC_STAND_QUEUE`): `jobs/<id>/job.json` (queued → running → done | error |
  cancelled), `events.jsonl` (progress: the stands' own stderr lines — `[client-stand] …`, pack-stand stages,
  pack:fetch — not the game log), `output.log` (everything, `stand_log`), `summary.txt`, `logs/` (server runs: their
  `/dev/shm` run dir is removed, so `latest.log`, `debug.log`, `kubejs/`, `crash-reports/`, `rcon.txt`/`rcon.json` and,
  with `--save-world`, `world/` are copied here),
  `cancel`; `inputs/<tag>/` — own jars/overlay/world uploaded by the Mac, removed after the run; `current.json`. Last
  40 finished jobs are kept. A worker restart mid-run marks that job `error`. Chains (dev #356): a job with `after`
  waits for that job and runs only if it passed, else it is cancelled; `--world-job <id>` → `--world <saved world>`
  (`npm run stand-queue -- submit … --after <id> --world-job <id>`; «Chains» under «Addon scene acceptance»).
- **Before each job** the worker compares `.tfc-fetch.json` with `GET /pack/current` (print-worker key) and runs
  `pack-fetch.mjs` when the snapshot moved: new queue jobs pin the current snapshot at submission (dev #425), not the Mac's cache; see “Pinned stand runs” below. Server
  runs: snapshot + NeoForge staged in `/dev/shm` (`scripts/stand-shm.mjs`, shared with print-worker). Client runs:
  `client-stand.mjs run … --stdin-watch` (cancel closes stdin → clean exit). Stand code is frozen per job: default verified main; test stand code changes with `stand_submit runtime=worktree`, which uploads the current worktree automatically.
- **Mac side** — `scripts/stand-queue-remote.mjs` (`npm run stand-queue -- submit|wait|list|log|cancel`), MCP
  `stand_submit` / `stand_wait` / `stand_log` / `stand_jobs`; `pack_client` goes through the queue (submit + wait).
  `stand_wait` is a long-poll on the host (`stand-queue.mjs wait`, checks the job file every second) over an async ssh,
  so the MCP server keeps answering other calls. Results → `~/.cache/tfc-plans/stand-queue/<id>`. The host CLI exits
  only after stdout drains (`process.exit` right after a write into the ssh pipe cut answers at 64 KB, dev #328); a
  summary over 14 000 chars (fits the MCP 20 000 cap with the header) comes back as head + tail with `summaryCut`, the full `summary.txt` is rsynced next to the
  results. Env:
  `TFC_QUEUE_REPO` (host code dir), `TFC_QUEUE_DIR` (queue dir relative to `~`) — for a test copy. A test copy of
  the worker (dev #356: branch `scripts/` rsynced to `~/tfc-stand/chain-test`, `node_modules` symlinked to the
  print-worker clone, `serve --no-print --no-pull` with `TFC_STAND_QUEUE` and the print-worker `env`) runs beside the
  live one: move the copy's `pack-stand.mjs` default ports off 25616/25617, or the live print check takes them
  («bind failed: Address already in use»).
- **RAM after SSH logout (dev #374)** — test1a has lingering enabled for `master`. Run
  `loginctl enable-linger master` when provisioning the stand and verify `loginctl show-user master -p Linger`
  returns `Linger=yes`. With the default `RemoveIPC=yes`, stopping the user after the last login session closes
  recursively removes its files under `/dev/shm`, including the server run and its logs. Lingering keeps the user
  manager running across logouts. Cron still starts the worker, and the worker removes its own staged files after runs.
- **Install** (once; replaces the old print-worker cron line):
  `crontab -l | grep -v print-worker.sh | { cat; echo '* * * * * $HOME/tfc-stand/print-worker/repo/scripts/stand-queue.sh >> $HOME/tfc-stand/queue/serve.log 2>&1'; } | crontab -`.
  Stop: remove the line, `pkill -f 'stand-queue[.]mjs serve'` (the bracket keeps `pkill` from matching its own ssh command).

## Stand scenario with acceptance (dev #319)

Server stand (`pack-stand.mjs`, `stand_submit kind=server`, `pack_devserver`) can judge its own RCON commands instead of
a throwaway script over the summary (`scripts/stand-scenario.mjs`). Opt-in: on only with `failFast` (`--fail-fast`),
`failOn` (`--fail-on <regex>`) or scenario lines in `commands`; without them runs, summary and exit code are unchanged.

- A reply is a failure on `ASSERTFAIL`, a command exception («An unexpected error occurred…»), unknown/incomplete
  command, wrong argument, or a `failOn` regex.
- `!cmd` — negative check: sent as `cmd`, its reply must be a failure; a failure there is a pass, no failure is a fail.
- `expect A=4.95±0.002 A+B-C=0±1e-7 D=5±1% E<=1e-11 F>0` — evaluated on the Mac/host side, not sent: numbers from the
  reply of the last sent command (`Name:1.5d` SNBT and `Name=1.5`, last occurrence wins; `%` — of the expected value);
  the left side is fields joined by `+`/`-` (energy balance in one check). Missing field — fail.
- `failFast` — after the first failure no more commands go out and `untilLog` is skipped («ожидание until пропущено»).
- Result: a line near the top of the summary «Сценарий: ПРОЙДЕН|ПРОВАЛ — команд отправлено N из M, остановлен на шаге
  K …» (survives a cut summary), failures and every check at the end, and `scenario.json` in the run dir
  (`{ ok, failFast, total, sent, stopped, failures, negatives, checks: [{ n, command, expr, op, measured, expected,
tolerance, error, ok }] }`); the queue copies it next to the logs, `stand_wait` names its Mac path. A failed scenario
  makes the stand exit non-zero; `stand_wait` then says «итог: не пройдено» — «готово» alone means only that the run
  ended.

## Remote Minecraft client stand — scripted (dev #284)

`npm run client-stand -- <prepare|run|clean>` on the Mac (`scripts/client-stand-remote.mjs`) drives
`scripts/client-stand.mjs` on `test1a` over the same SSH entry as the server stand (`TFC_CLIENT_HOST`,
`TFC_CLIENT_HOST_ALIAS` override it). Every call pushes the stand code from the working tree to
`~/tfc-stand/client-stand-code` (only built-in Node modules, no `npm ci`) and, unless `--no-pack`, rsyncs the Mac pack
cache with `--delete`. Stand files on the host: `~/.cache/tfc-plans/client-stand` (`TFC_CLIENT_STAND`).

- `prepare` (once per loader): Xvfb via `apt-get download xvfb` + `dpkg-deb -x` (no sudo; needs the system `xauth`,
  `xkbcomp`, `xkb-data`, already there), vanilla version + client jar from Mojang, NeoForge from the **fat installer**
  the Mac takes from the pack server (`/neoforge/<ver>`, `tfc admin neoforge build`) — `maven.neoforged.net` times out
  on `test1a`, the fat jar carries its libraries. Missing libraries (Linux LWJGL natives) come from
  `libraries.minecraft.net` with sha1 checks. Assets: `--assets base` (default, ~110 MB: language list, translations,
  title panorama, built-in packs — no sounds), `all`, `none`.
- `run`: own profile per run (`runs/<id>/game`, mods symlinked, `--ram` copies them to `/dev/shm`), first-run screens
  off (`options.txt`, FancyMenu welcome), own Xvfb display (first free from `:90`, own Xauthority, no TCP), production
  launch built from the version JSONs (no Python launcher, no ModDevGradle) with the vanilla client copied to
  `versions/neoforge-<v>/neoforge-<v>.jar` at the end of the classpath like the official launcher (dev-285). Waits for
  FancyMenu's `title_screen` layer (`--ready <regex>`), waits `--settle` s, takes `--shots` PNGs (`client-stand/
Capture.java`), SIGTERM for a clean exit (kill after a minute), stops Xvfb with SIGTERM, deletes the run folder
  (`--keep`), and leaves `results/<id>/` (`summary.txt`, `client.log`, `latest.log`, `debug.log`, `kubejs/`,
  `crash-reports/`, PNG). The Mac copies it to `~/.cache/tfc-plans/client-stand/results/<id>`. `--mod <jar>` /
  `--overlay <dir>` are uploaded first; `--exclude <name part>` drops snapshot jars. A dropped SSH session closes stdin
  and the host side stops the game and Xvfb. A second run while one is live is refused unless `--parallel`.
- `clean`: abandoned run folders, stray stand Xvfb processes, results beyond `--results 10`.

Verified 2026-11-06 from an empty stand dir on snapshot `20261105-135644-3704`: `prepare` passed (fat installer,
44 libraries fetched), the full client reached the title screen in ~130 s with 342 mods (250 jars), two PNGs, clean
SIGTERM exit, no leftover Xvfb or run folder. The first try caught a real launch bug in seconds (vanilla jar on the
classpath next to NeoForge's patched client → module resolution error), with the cause in `summary.txt`.

**World and MCP (dev #288).** `run --world new` writes a minimal `saves/stand/level.dat` and launches with
`--quickPlaySingleplayer stand`. The file: creative, cheats on, peaceful, no daylight/weather/mob cycle, random seed,
`initialized=0` (the game picks the spawn — TFC by climate), data version from the client jar's `version.json` (else
DataFixer treats it as ancient), storage `version` 19133 (Anvil; without it the world list rejects the save with
«Unknown data version: 0»), and `WorldGenSettings.dimensions` from the pack's world preset — TFC's `defaultWorldPreset`
(`tfc:overworld`), looked up in `kubejs/data`, mod jars, then Minecraft, JSON converted to NBT; `new:<preset id>` picks
another. Dimensions missing from the file (nether, end, mod ones) are added from the dimension registry at load.
`--world flat` is a vanilla flat overworld — **not usable for this pack**: TFC Eratosthenes sets its map projection only
when TFC's `RegionGenerator`/`OverworldClimateModel` are built, so it throws «No MapProjection set» every player tick.
`--world <save folder>` copies a save (uploaded from the Mac like `--overlay`; a server world works). Ready means the
integrated server's `StandTest[…] logged in with entity id` line (not the chat line — it's translated); a failure screen
(`RecoverWorldDataScreen`, `DisconnectedScreen`, … — FancyMenu logs each new screen class) stops the run at once with
`world-error.png`. The login comes long before the world is drawn — on llvmpipe «Загрузка территории…» stays for
a minute or more and that frame is static — so after login the stand takes a probe shot every 10 s until the picture
changes (`--load`, 300 s max; the summary says «мир на экране через N с» or notes the timeout), then `--settle` and the
shots. PNGs are `world-NN.png`. The stand player has the offline UUID of `StandTest` (all-zero UUID made
FTB Chunks throw on login). Software GL: llvmpipe reports OpenGL 4.5, Voxy compiles GLSL 4.60 shaders and force-crashes
the client on join, so runs set `MESA_GL_VERSION_OVERRIDE=4.6` / `MESA_GLSL_VERSION_OVERRIDE=460`.

MCP `tfc-pack` `pack_client` runs the same from the Mac and returns the summary plus the last PNGs as images
(`scripts/mcp/tools/devserver.mjs` → `clientStand()` in `client-stand-remote.mjs`, which writes nothing to stdout — that
is the MCP channel). From a shell: `node scripts/mcp-call.mjs tfc-pack pack_client '{"world":"new"}' --timeout 1500`.

**In-game screenshots (dev #294).** `run --game-shots <prefix>` (repeatable; MCP `pack_client gameShots=[…]`) copies
PNGs that the run itself left in `game/screenshots` (F2 from an overlay script, a mod) whose names start with a prefix
into `results/<id>/screenshots/`, so they reach the Mac with the logs — no `--keep`, no manual SSH. A prefix is a plain
name start (`[\w.-]+`, no paths or globs), checked on the Mac before anything is uploaded; only regular `.png` files with
a valid PNG header are taken, at most 100. The summary lists each frame with size and dimensions; `pack_client` returns
in-game shots after the stand's own shots, so `images` shows them first.

**Builder Tools check stays separate.** `tools/builder-tools-mod/test-client.sh` is an addon dev test, not a pack
check: ModDevGradle `runClient` from sources with the `devtest` source set (not in the release jar), a few mods
(addon `libs/`, optionally TFC + Patchouli), assertions in code (`BTCLIENT OK/FAIL`, six of them), about a minute. The
pack client stand answers a different question — does the released jar work in the full pack (250 jars, KubeJS,
production launch). To run an addon's in-game assertions inside the full pack, build its devtest classes into a jar
and pass it with `stand_submit kind=client scene=<name> mods=[…]` (below).

**Scene scaffold for addon client checks (dev #342).** `tools/stand-scene/src/tfc/stand/scene/Scene.java` is shared
source, compiled into an addon's `devtest` source set (`java.srcDir '../stand-scene/src'` in its `build.gradle`; now
`ee-extras-mod`, `destroy-extras-mod`). A check is written as steps: `server(name, c -> …)` (runs on the integrated
server, `c.at(x, y, z)` is relative to the platform), `client`, `ticks`, `until(name, timeout, cond)`,
`synced(name, from, to)` (waits until the client sees the server's block states in a box), `camera(x, y, z, distance,
yaw, pitch)` (target relative to the platform; player hangs there, waits for client chunks and Sodium/vanilla terrain compile), `gui(false)`,
`shot(name)`, then `start()`. The prologue does what every scene needed by hand: on the title screen it creates a
creative world **`tfc:overworld` with fixed seed `Scene.SEED`** (vanilla flat if TFC is absent — a dev run without it),
waits for no loading screen and the player's chunk, waits until the integrated server's smoothed tick time stays under
50 ms for 40 ticks, then on the server: noon, no daylight/weather/mob cycle, a smooth-stone floor at the spawn surface
`±12` with `10` layers of air above (`area(r, h)`; flags without neighbour updates, so TFC collapses stay quiet),
player flying at its south edge; and waits until the client sees the platform. Every tick it checks that the server
player still exists. Log lines `SCENE START|STEP|OK|FAIL|NOTE|SHOT`, the end `SCENE END PASS|FAIL <n> <name>`, then
the game closes itself. Frames go to `screenshots/scene-<name>-<shot>.png`.

- **Why not `minecraft:flat`** (root cause of #340/#339/#329 «client sees no server blocks»): TFC Eratosthenes reads
  its map projection on a player tick every 23 ticks; outside `tfc:overworld` there is none and it throws. The pack's
  `neoforge-server.toml` has `removeErroringEntities = true`, so NeoForge does not crash — it **discards the server
  player** (crash report «Ticking entity», `StandTest`, ~20 s after login). The connection lives on (commands, `tp`,
  menus work), but a removed player is no longer tracked by `ChunkMap`: no block changes, no new chunks. The scene's
  player check catches that at once.
- **Enable**: the scene is picked by name — file `scene` in the game dir, or `-Dstand.scene=<name>`;
  `Scene.requested("<name>")`. The stand writes the file: `client-stand.mjs run --scene <name>` (MCP
  `stand_submit kind=client scene=<name>` / `pack_client scene=<name>`). With `--scene` the run needs no `--world`
  (refused), waits for the title screen, then for `SCENE END` (or game exit, or `--timeout` from launch) instead of
  `--settle`/shots, takes `scene-<name>*` in-game shots by itself, and the summary gets «Сцена <name>: проверок OK n,
  FAIL m» plus every non-OK `SCENE` line; `ok` = `SCENE END PASS` and no crash report.
- **One devtest jar per run**: each carries its own copy of `tfc.stand.scene` (two would split the package).
- Usual path — `addon_stand` (below, «Addon scene acceptance»): builds, checks, freezes and judges. By hand: build the jar: `./libs.sh` once, then `./gradlew devtestJar` in the addon (JDK 21–23; Gradle 8 fails on JDK 26 with
  «Unsupported class file major version 70» — set `JAVA_HOME`). Example:

  ```
  stand_submit kind=client scene=flywheel-wires timeout=1500 note="…" \
    mods=["tools/ee-extras-mod/build/libs/ee-extras-<ver>-devtest.jar"]
  stand_wait id=<id>
  ```

  Scenes so far: `flywheel-wires` (ee-extras `FlywheelWireTest`, dev #329), `destroy-extras` (destroy-extras
  `ClientTest`; also its `test-client.sh` dev run, which runs it when no scene is requested).

## Addon scene acceptance (dev #311)

One call for what agents of #301 did by hand around every client scene: `scripts/addon-stand.mjs`
(`npm run addon-stand -- run|result|scenes`, MCP `tfc-pack` `addon_stand`).

- **run** `addon=<path|name> scene=<name>`: `libs.sh` when `libs/` is empty, `libs=true` or `env` is given (`DESTROY=1`
  — merged with the scene's `env` from `stand.json`); then **one** Gradle call `./gradlew jar devtestJar` with
  `javaHome()` (JDK 21) — Gradle compiles everything before packing (a hand-zipped classes folder next to a running
  Gradle once gave a devtest jar without `Power.class`). An up-to-date build keeps the old jars (fine); a jar older
  than its own `build/classes/java/<set>` is refused. Addons without a `devtestJar` task are refused with the
  example to copy (`ee-extras-mod/build.gradle`).
- **Jar check** before the stand is touched: every `.class` in `build/classes/java/main|devtest` is in its jar and the
  jar has nothing else; no package in both jars (split package); both have a manifest and `neoforge.mods.toml`; the main
  modId equals `addon.json` `id`, the devtest one differs; `tfc/stand/scene/Scene.class` only in devtest; classes listed
  in `stand.json` are there; the scene is found in devtest sources (`new Scene("…")`, `Scene.requested("…")`) or
  declared. Failure → nothing is queued.
- **Freeze**: both jars copied to `~/.cache/tfc-plans/addon-stand/<scene>-<time>/` with the first 8 SHA256 chars in
  the name (so the stand summary line «свои: …» proves which bytes ran) + `candidate.json` (paths, SHA256, addon git
  commit and dirty count, `released=false`, `runtimeChecked`, job id, task).
- **Job**: client queue job with both frozen jars, `--exclude` of the snapshot copy (prefix from the card's `jar`),
  `--scene`, `timeout` (1500 s or the scene's). Returns the job id; `wait=N` judges in the same call.
- **result** `job=<id>`: waits (long-poll) and judges: job ended without error, `SCENE END PASS <scene>`, no crash
  report, both frozen file names in «свои:», no unexpected fail line (`SCENE FAIL`, `<X>CLIENT … FAIL` — old
  `EECLIENT FAIL` style, `ASSERTFAIL`, scene `failOn`), every scene `expectFail` regex matched (negative controls must
  fail), at least one `SCENE SHOT` and each came back as a PNG whose luminance spread is not flat (an empty/black frame
  fails; byte-identical frames are noted), scene `shots` present. Writes `verdict.json` and `evidence/` (summary,
  `latest.log`, `client.log`, frames) next to the frozen jars; `task=<dev id>` (or the one given to run) adds a work-log
  note with verdict, SHA256 and the folder.
- **`tools/<mod>/stand.json`** (optional): `{ "scenes": { "<name>": { "note", "timeout", "env", "classes",
"shots", "expectFail", "failOn" } } }`. Without it the scene still runs with defaults.
- Not covered (separate work): a client **scene** inside a saved world (scenes create their own world and start from
  the title screen, which quick play skips — needs `tools/stand-scene` and the addons' start hook); board-specific
  measurement profiles. Evidence upload as a dev-task attachment — done in dev #357: `addon_stand … task=<id>`
  attaches `evidence/` + `verdict.json` as one zip (chains too; their `evidence/<step>/world` folders make it a few
  MB, the limit is 50 MB).

### Chains: server save → restart → client (dev #356)

What #301 agents did by hand (export the world from an ephemeral job, rsync it back as an overlay, restart, check the
SHA by eye) is a declared chain: `addon_stand addon=<path> chain=<name>` (`npm run addon-stand -- run <addon> --chain
<name>`), then `addon_stand job=<any step id> task=<dev id>`.

- **Declared** in `tools/<mod>/stand.json` → `"chains": { "<name>": { "note", "env", "classes", "steps": [...] } }`.
  Step: `name`, `kind` (`server`|`client`), `world` (name of an earlier step whose saved world it starts on), `save`
  (keep this step's world as a job artifact), `timeout`. Server: `cmd` (RCON, scenario syntax `!…`/`expect …`),
  `failFast`, `failOn`, `levelType` (first step only), `expect` (regexes that must match the full RCON transcript).
  Client: `shots` (frames after entering the world, default 2) or `scene` (own world; `scene` + `world` is refused).
  Which jars: server steps and scene steps get main + devtest; a plain client entry gets **only the main jar**, like a
  player (main + world) — the old auto `ClientTest` of ee-extras devtest otherwise takes over any world, prints
  `EECLIENT FAIL` and quits after one frame; `devtest: true` puts it back. `expectFail`/`failOn` work on every step.
  Example — `tools/ee-extras-mod/stand.json` `rectifier-restart`: build + measure + save → a new server process on that
  world checks the blocks (`execute if block …` with `failOn: Test failed`) and the measurement → the client logs in.
- **Same bytes everywhere**: one build, one freeze (`~/.cache/tfc-plans/addon-stand/<chain>-<time>/`), every step gets
  the same frozen jars. Each stand computes SHA256 of its own jars itself (`свои: x.jar sha256 …` in the server
  summary, `свои sha256: …` in the client one); the judge requires them to equal the frozen ones on **every** step
  (the devtest jar where the step loads it, and its absence where it doesn't).
- **Queue**: every step is its own job, submitted at once with `after=<previous job>` and `chain=<addon>/<name>`. The
  worker (`stand-queue.mjs`) runs a job only after its `after` job finished with `done` and code 0; otherwise it
  cancels it with the reason, so the rest of a failed chain does not burn stand time. `--world-job <id>` in a job's
  args is replaced on the host by `--world <that job's saved world>` — the world never travels through the Mac between
  steps.
- **World artifact**: server `--save-world` (`pack-stand.mjs`) sends `save-all flush`, stops the server normally (waits
  up to 120 s; a killed server is a failed save), the worker copies `run/world` (without `session.lock`) to
  `jobs/<id>/logs/world` and records `job.world`. Server `--world <dir>` starts on a copy of it. Client `--save-world`
  (`client-stand.mjs`) copies the last played world from `saves/` to `results/<id>/world`. Both come to the Mac with
  the job results (`~/.cache/tfc-plans/stand-queue/<id>/world`).
- **Judge per step**: cancelled → failed with the reason; server — exit 0, «сервер загрузился», no crash, scenario
  passed (if any), `rcon.txt` came back, each `expect` matched, `мир: копия …` when `world` is set, `мир сохранён` +
  `world/level.dat` when `save` (a failed server's `run/world` is only its input world, the worker doesn't keep it);
  client entry — `итог: в мире`, all `shots` frames, each not flat and with no tone over 90 % of pixels (a black
  screen with the FancyMenu bar has a luminance spread of 16 but 94 % one tone; real frames — 7–25 %); every step —
  no unexpected fail line (`SCENE FAIL`, `…CLIENT … FAIL`, `ASSERTFAIL`, `failOn`) in `latest.log`, every
  `expectFail` seen; client scene — the scene judge above. One
  `verdict.json` (`steps[]` with checks, jobs, SHA) and `evidence/<step>/` (summary, `latest.log`, `client.log`,
  `rcon.txt`, `rcon.json`, `scenario.json`, PNGs, `screenshots/`, `world/`).

### Full RCON transcript (dev #356)

- `pack-stand.mjs` writes every command with its whole reply to `run/rcon.txt` (`> command` + reply) and
  `run/rcon.json` (`[{ command, reply, ms, packets }]`); the queue copies both into `logs/`, `stand_wait` names them.
  In the summary a reply over 1500 chars is cut with `… ещё N симв. (rcon.txt)`.
- `runRcon` (`mc-server.mjs`) used to take the first 4 KB packet as the whole reply and pin the rest on the next
  command. Now, after the first packet of a reply it sends an end marker (unknown packet type → the server answers
  «Unknown request c8»); everything before the marker's answer is the reply. The marker must not be sent right behind
  the command: vanilla `RconClient.run` reads the socket once per packet and drops the connection when two packets
  arrive in one read. The server cuts replies at 4096 bytes, so a Cyrillic character on a cut becomes U+FFFD — server
  side, can't be repaired.

## Remote Minecraft client stand (dev #279, manual)

The manual stand on `test1a` lives in `~/tfc-stand/client`, separate from the server stand. It uses Java 21,
NeoForge 21.1.251, and the Ubuntu `xvfb` and `x11-apps` packages extracted into `client/x11` with `dpkg-deb -x`.
The launcher starts an authenticated 1280×720 Xvfb display on `:91` with TCP disabled, uses Mesa software
rendering, and stops Xvfb when the command exits. Run one client at a time.

```bash
tfc_ssh "$tfc_host" '~/tfc-stand/client/run-builder-test.sh'
tfc_ssh -t "$tfc_host" '~/tfc-stand/client/run-full-pack.sh'
```

The Builder Tools check uses the addon's existing `test-client.sh` and writes
`builder-tools-mod/run/client-check.log` and `builder-tools-mod/run/screenshots/buildertest.png`. It passed all
six assertions and saved an 854×480 frame from the test world.

The full profile copies the snapshot's `mods`, `config`, `kubejs`, and `resourcepacks` under `full-pack/run`.
It launches the installed NeoForge client with a local test profile and writes `full-pack/run/client-check.log`.
Keep the launch command in the foreground. To capture its display during a run, use a second SSH session:

```bash
tfc_ssh "$tfc_host" 'cd ~/tfc-stand/client &&
  DISPLAY=:91 XAUTHORITY="$PWD/Xauthority" \
    ~/.local/opt/tfc-stand/java/bin/java Capture.java frames/full-pack.png'
```

The Builder Tools Gradle run resolves dependencies offline from `client/gradle` because the NeoForge Maven host
times out on `test1a`. The cache was seeded from the Mac. The Gradle init script in `gradle/init.d/stand.gradle` resolves LWJGL
from `lwjgl-repo`, which also contains the Linux natives fetched from `libraries.minecraft.net`.
Refresh the dependency cache when changing the loader. The full profile uses the NeoForge installer and
the launch metadata under `client/launcher`. Running the full snapshot through ModDevGradle triggered an
assertion in KubeJS TFC 2.0.2 that its bytecode gates to development runs.

The full profile uses snapshot `20261105-135644-3704` with all 250 mod jars. It sets
`-Dcustomskinloader.ignorePatchFailure=true`: its classpath lacks the vanilla client jar, so CustomSkinLoader 15.0.1
reads no `version.json`, takes protocol 0 and applies its pre-1.20.2 `SkinManager` / `PlayerTabOverlay` patches (dev-285).
The official launcher and `client-stand` add that jar, so the flag is not needed there. The test copy of the FancyMenu config skips its first-run welcome screen.
The GTX 1650 is visible to `nvidia-smi`. Xvfb uses Mesa llvmpipe (OpenGL 4.5), and the log reports a
GLSL 4.60 shader compilation error during startup.

## Pack patches (`pack-patches/`)

- `l10n/` (2026-10-22): translation of Chinese strings in pack KubeJS scripts. Base — pack snapshot
  `20261022-095351-d765` (read from the VPS blobs). `apply.py <game folder>` re-applies onto a newer pack (every
  replacement must match exactly once); ready files next to it. Checked: `node --check`, `apply.py` on a fresh snapshot
  copy reproduces the stored files, `buildKubejs` on the patched layer — same counts, 0 errors. Not checked in game.
  Scan of all jars + configs for CJK: the rest is zh_cn lang/manuals, logs, config comments, two mods with hardcoded
  chat text (see pending.md).

## Dev tracker (2026-10-26)

Dev tasks moved from Firestore to SQLite in the pack server (`lib/dev.mjs`, `/dev/…`, `node:sqlite`, daily backup) —
the free-tier read quota ran out on 2026-10-26. Site page «Разработка» (`/dev`, `src/pages/dev`) with edits (Firebase
ID token checked on the server, helper moved from the file server to `pack-server/lib/firebase-auth.mjs`); MCP
`tfc-plans-dev` `dev_*`; `scripts/dev-migrate.mjs` for the old groups. AGENTS.md and skills now log work there.
Checked locally: API (create, Russian search, rev 409, status log, notes, docs, import idempotent, CORS, no-key 401),
MCP tools against a local server, the page with a real site sign-in (list, filters, edit+save, checklist, log, plan,
create, mobile). Plan and stages — `docs/plans/dev-tracker.md`. Migrated the same day with the host's yes: 81 tasks
and 15 plans imported (checked on the server), 89 Firestore docs and the group «Разработка» deleted; 7 tasks with
attachments stay in Firestore group «Фиксы» (their copies on the server note where the files are).

**Players' reports on the pack server** (2026-11-14, dev #360): `tfc report` uploads (`POST /site/reports`, unchanged
for the CLI) go to `<DATA_DIR>/reports.db` + `<DATA_DIR>/reports/<sha256>` (`lib/reports.mjs`) instead of Firestore
`files`; reads — `GET /reports[?kind=]`, `GET|DELETE /reports/:id`, `GET /reports/:id/content`, same auth and CORS as
`/dev`; 25 MB/report, 5 GB total (`REPORTS_MAX_BYTES`). An admin key may pass `id`/`createdAt`/`author`/`sha256` in
`X-Report` — ids survive (`tfc-report:<id>`, `/dev?report=<id>`). Site report tabs and MCP `reports_list`/`report_get`
read the pack server (0 Firestore reads). Migration — `scripts/reports-migrate.mjs` (dry run, `--apply` with
verification of size/hash/author/time/kind/task, `--purge` deletes the Firestore copies after a clean verification).
Checked on a local pack server: player upload, admin upload with id (bad hash refused, repeat = existed), list by kind,
content headers, delete keeping a shared blob; migration of the 3 real Firestore reports twice (3/3 verified, then
"existed"); MCP list/get/analysis of a migrated zip; site `/dev` against the local server — list, `?report=` focus and
tab switch, download (size matches), delete.

**Dev attachments on the pack server** (2026-11-14, dev #357): table `files` in `dev.db` + `<DATA_DIR>/dev-files/<sha256>`
(`lib/dev-files.mjs`), routes `/dev/tasks/:id/files`, `/dev/files/:id[/content]`, same auth as `/dev`; SHA256 checked
while streaming, 50 MB/file, 5 GB total, extension allowlist, download-only serving, upload/delete log notes, cascade on
task delete. Site `/dev` uploads and shows them through the pack server (no Firestore), MCP `dev_file_get` /
`dev_file_put`. Firestore attachments migrated with `scripts/dev-files-migrate.mjs` (Firestore copies kept, unread).
Checked on a local pack server: upload/duplicate/bad hash/bad type/size/no key/download/delete/admin id/task cascade,
MCP put (file, folder zip, repeat) and get (unzip, images, ownership refusal), `verdictToTask`, the migration twice
(10/10 verified, repeat idempotent), and `/dev` in the browser (image + file upload, gallery, download, delete, new task
with a draft file). Not covered: player crash/log reports on `/dev` («Краш-репорты»/«Логи») stay in Firestore.

## Multi-agent setup (2026-10-23)

`AGENTS.md` (root + `src/`, `packages/core/`, `scripts/`, `scripts/mcp/`, `cli/`, `server/`, `tools/`) is the source of truth; every `CLAUDE.md` is
`@AGENTS.md` + Claude-only notes (root). Skills stay in `.claude/skills/`, `.agents/skills` is a symlink for Codex and
others. MCP signs writes with `TFC_AGENT_NICK`, else the detected harness (`Claude`, `Kimi`…), else `Агент?` (dev #184). Per-agent setup — `docs/agents.md`. Checked: Claude
Code loads nested `@AGENTS.md` imports; MCP server starts and reads the nick from env. 2026-10-24: DeepSeek Harness
(DSH) set up and checked — both MCP servers (`tfc-pack`, `tfc-plans-dev`) connected through the DSH profile patch, a
Firestore read and `git_state` verified, tools appear as `mcp__tfc-pack__*` (`docs/agents.md`). 2026-10-25: OpenCode
v2.1.4 set up — `opencode.json` in the repo root (`mcp.servers`, relative `node scripts/mcp/server.mjs`, nick `OpenCode`)
replaces the gitignored `.opencode.local.json`, which OpenCode never read: only `opencode.json(c)` /
`.opencode/opencode.json(c)` count, and they are found from the session directory up to `/`. Checked: `opencode debug
config` lists the project file from the repo root and from a worktree, `opencode mcp list` — both servers connected, the
server starts and finds `public/` from a worktree. Known limit: a relative command resolves from the session directory, so
a session started in a subfolder (`tools/…`) needs the global config with absolute paths. Not run: Codex, Gemini CLI,
Cursor configs (shapes from their docs, not tried).

- Dev #127 (2026-10-28): site deployments serialize build → Hosting upload through a lock in the shared git
  directory and use a private temporary dist. Pack-server shutdown drains accepted jobs and rejects new ones;
  systemd uses KillMode=mixed/TimeoutStopSec=infinity. Installer serializes updates and stops before replacing code.
  The deployment lock covers worktrees on one machine, not independent hosts. Forced termination is still interrupting.
- Dev #256 (2026-11-05): `deploy:site` no longer queues. A second run refuses at the lock; `--dry-run` takes no lock; a
  stale lock (dead process or older than 30 min) clears itself. Before the build it requires `HEAD` to contain the commit
  in the last `commit=<sha>` release message (`--allow-older` to roll back). On top of #254's rebuild after a foreign
  release: a foreign site deploy whose commit isn't in this build stops the run instead. Checked on a fake Hosting server
  in a clone, and a real `--dry-run`.

- Dev #134 (2026-10-28): `tfc whoami` shows the server-recognized key name/role and local config path; login and
  self-approval errors identify the key without printing its token. CLI error/auto-upgrade completion uses natural
  process shutdown instead of forced exit (Windows libuv assertion mitigation). Local HTTP + CLI checks cover
  author refusal, host approval, player/no-key refusal and changing the saved key. The reported Windows credential
  selection was resolved by logging in again: the user approved both updates afterward. The Windows libuv crash
  mitigation still needs verification there; host/Jason keys are distinct admins on VPS.

- Dev #119 (2026-10-29): `tfc schematics list/local/<query>/install/publish/update`: library ids, hashes,
  Firestore updateTime revisions, local and uploaded copies (also profile serverDir), explicit source preview,
  author separate from copy owner/uploader. Authenticated `POST /site/schematics`: bounded NBT validation,
  duplicate source detection, explicit transformed-source opt-in, owner/author/admin update rights, atomic file
  completion + card revision check; preserves edits/author/description and clears stale preview. Selective pull
  assigns collision filenames over the entire library; unknown uploaded namesakes are preserved unless --force,
  known copy hashes persist and undo restores them. Local HTTP/Firestore stub and temporary profiles: 42 scenarios
  (auth, paths, gzip duplicate, malformed/oversized NBT, simultaneous publication, revision conflict, failed chunks,
  stable selective filenames, modified uploaded copies, force, undo, CLI entry points). Lint and TypeScript passed.
  Built all four distributions; macOS arm64 binary launched and read the production library. Production API check:
  temporary publication, update preserving author, stale-revision refusal, second-profile pull with matching bytes;
  temporary card and both files deleted afterward. Pack server updated and CLI released as 2026.10.29-ddb430df.
  Browser library verification was blocked by Firestore permission errors in Codex IAB (also participants/onboarding);
  recorded separately. Real game/Windows launcher folders remain untested.

- Dev #147 (2026-10-29): pack-server Firestore requests refresh both token caches after a 401 and retry once,
  preserving the URL, body and revision preconditions. Concurrent requests share token acquisition; a late 401
  cannot invalidate a newer token. Local stub checks covered recovery, repeated 401, 403, revision conflict,
  network/token failures and parallel requests. Actual token expiry/revocation was not induced on production.

- Dev #125 (2026-10-29): `tfc datapacks list/files/install/confirm/unconfirm` manages world testing and pinned
  pack-wide ZIPs in `kubejs/data/` through the installed KubeJS. Current snapshot `datapacks` metadata owns hashes,
  source revision, confirmer and known world copies; source cards/opt-in remain separate. Admin confirmation creates
  a snapshot and switches it with a base-snapshot check, validates ZIP/source content and blocks conflicting resource
  paths. Site cards and ZIPs already in the snapshot are supported, including filename selection without a card.
  Old CLI still receives archives as ordinary `kubejs`; old publish cannot lose or replace pinned files. Modified
  world/pack ZIPs stay, managed copies have backups; undo is local and refuses a different selected world.
  Builder parses ZIPs in KubeJS order (direct data last), publishes deployment metadata with `kubejs.json`; MCP keeps
  later live-card recipes out of the active pinned layer. Checked: 59 local HTTP/CLI scenarios, original CLI full
  pull, concurrent 409, resource overlap, ZIP priority and builder output; separate combined-scope check and MCP
  list/get/recipe-layer checks. Browser: real cards, confirmed-state fixture desktop/375 px without overflow.
  TypeScript/lint/format passed. Real host world, old/new game-world loading and priorities remain untested;
  no production datapacks were promoted. Instructions/inventory: [datapacks-pack.md](../plans/datapacks-pack.md).

- Dev #154 (2026-10-29): named `tfc datapacks pull <id/name/filename>` (`install` alias) and raw `pull datapacks`
  resolve pinned ZIPs without cards, original filenames, and old pinned names after a card rename. Pack-level pulls
  work without a selected world; world drafts require one and missing-world skips are visible. `datapacks <name>`
  shows source, level and a copyable pull command. Explicit datapack pulls refresh the independent server card cache
  after MCP writes; ordinary full pulls retain the five-minute cache. Checked on temporary HTTP/profiles: 73 cases
  including no-world legacy ZIP pull, deleted source card, unrelated file preservation, fresh draft, SHA256 failure,
  MCP stdio inventory/exact ZIP read and prior promotion/undo/old-CLI scenarios. Game not checked.

  Live checks after merge with @tfc/core: inventory and exact AirpresureFix.zip pack.mcmeta through MCP; compiled
  macOS CLI pulls that confirmed legacy filename with no world in dry-run without creating files. Four distribution
  SHA256s, npm startup and Linux native startup verified. Release: 2026.10.29-7a2edd56. Snapshot/game files unchanged.

- Dev #150 (2026-10-29): Euphoria Patcher startup popup traced to missing Complementary r5.8.1.
  Proposed update `u20261029-193554-dd27` changes only `display.doPopUpLogging=false`, preserving logs and
  all other config bytes. Verified installed jar code through MCP and source SHA256 against the current snapshot;
  config absent from Firestore, so submitted through `tfc admin propose`. Client launch still awaits host check.

- Dev #156 (2026-10-29): rejected pack updates remain listed without the five-record history limit and can
  be pulled explicitly by ID; bulk pull accepts pending updates only. Reject/approve without an interactive
  terminal now require `--yes` and fail visibly instead of silently keeping pending status. Reject verifies
  the server response; named pull retains rejected status. Obsolete Euphoria popup update was rejected live.
  Nine temporary HTTP/CLI scenarios verified persisted rejection, noninteractive failure, bulk exclusion,
  explicit multi-ID pulls, full rejected history, invalid-set preflight, blocked approval of rejected updates,
  argument validation and unexpected server response. Lint/format passed.

- Dev #158 (2026-10-29): `tfc report kubejs` discovers `.log` / `.log.gz` in both `logs/kubejs/` and
  `kubejs/logs/`; `tfc report server-kubejs` uses the profile host server directory. Ambiguous names show
  relative paths for explicit selection. Temporary folders and a stub upload API verified discovery, selection,
  gzip, IP masking, task binding and dry-run. Real game folders/upload and Windows were not checked.

- NeoForge without maven (2026-11-03, dev #204): `tfc init --launcher` first takes a fat installer from the pack server
  (`tfc admin neoforge build`, `/neoforge/<version>`, record in `neoforge.json`), otherwise maven. Blocked-maven run checked
  with a JVM hosts file on a throwaway server (plain installer: 82 libraries fail; fat: installs); Mojang stays required.
  Fat download on a real PC installed NeoForge 21.1.251. A new NeoForge version needs a new build.
- TLauncher game dir (2026-11-03, dev #204): it uses the version folder only for a version with a `modpack` block in
  `versions/<name>/TLauncherAdditional.json`, otherwise `.minecraft`. `installToLauncher` writes that block with empty lists;
  the host's TLauncher then loaded 341 mods from `TFC-RealWorld` (block written by hand, not yet by the new `tfc`). Replaces
  the earlier «TLauncher game dir = version folder»: that was only true for imported packs.

- Dev #254 (2026-11-05): a site deploy and a server publish no longer undo each other. Hosting has no conditional
  release, so `release()` in `scripts/hosting-rest.mjs` takes `base` and checks the release list before and after its own
  release; a foreign release raises `ReleaseConflict`, and `deploy()` / `deploy-site.mjs` rebuild on top of it (up to 5
  times; releases of their own earlier attempts don't count). Rolled-back case: 2026-11-05 a deploy released seconds after
  host job j20261105-132601-69d3 and removed its data. Checked with a fake Hosting API (`TFC_HOSTING_API`): overlap before
  and right before the release, for both writers, no overlap, endless conflicts; the old code fails the same scenarios.
  Limit: three writers within seconds can still lose the middle one's non-shared files.

## Stand hardening (dev #400/#402/#393/#397/#418/#419, 2026-11-26)

Client acceptance: queue job `20261126-141414-4ec6`, snapshot `20261117-180033-6dff`, source world
`20261120-131548-0394`, runtime `a431563f`, addon sources `41e2450` (clean). `SCENE END PASS insulator-anchors`:
25 scene checks, 0 failures, three inspected 1280×720 screenshots. The helper rejected the wrong terminal, chose a
fallback view, sent real clicks, and server checks confirmed all five wires, both clamps and 297.9 V under load.
The run completed in 284 s; JAR hashes matched the frozen candidate. Evidence is attached to dev #397 and #402.
No fixture-height change was needed: the accepted run used the original positions. The compatibility profile still
excludes the exact incompatible OptiCore pair and disables Voxy only in the software-rendered stand copy.

- MCP no longer imports missing freeze.mjs; preflight and freeze live in addon-stand.mjs. The smoke command runs the
  real stdio server and tools, so missing exports/imports cannot silently pass CI.
- `npm run stand:smoke`: standalone fixtures, no Minecraft/SSH/credentials; MCP/queue contracts, scene+world rules,
  unexpected SCENE FAIL, own JAR exclusion, frozen retry, duplicate requests and checkout divergence.
- `addon_stand job=… retry=<step>` retries one terminal failed/cancelled chain step with recorded arguments, original
  saved world and unchanged SHA256 JARs/overlay. Live/unknown jobs are refused; history is kept in the combined verdict
  and evidence/attempts. Old candidates without recorded parameters need a fresh run.
- Client stand compatibility profile removes only `Opticores-1.0.9 - Neoforge-1.21.1.jar` when paired with
  `sodium-neoforge-0.8.13-beta.1+mc1.21.1.jar`, with an explicit summary warning. MCP bytecode/decompilation confirms
  mismatched renderModel signatures; there is no OptiCore mixin switch. Live pack files are untouched.
- Software client profile uses renderDistance=4, simulationDistance=4 and maxFps=30. Voxy 0.2.16's enabled,
  enable_rendering and ingest_enabled are false in the test copy (config keys verified via MCP decompile); overlay can
  override this for Voxy-specific checks. The summary reports effective settings. Heap diagnostics showed no sustained
  full-GC pressure; watchdog stacks instead showed delayed Voxy renderer initialization and chunk-system work.
- Saved-world scene startup allows 900 s after server-side login (still bounded by the overall run timeout), with
  progress every minute. Login is not the first client tick: the observed EMI item-group synchronization alone took
  107 s, and more client data processing followed. Missing SCENE END or frames remains a failed acceptance.
- Standalone `addon_stand scene=… worldJob=<successful saved job>` starts in a copy of an accepted TFC world;
  candidate/verdict records the source and acceptance checks it. Useful for electronics scenes: regenerating the
  RealWorld world from scratch exceeded 1500 s, while the saved-world client logged in after 158 s. The insulator scene
  prepares its test area in the copy only. Legacy scene dispatch entries were restored in EE Extras ClientTest.
- Scene.useContact tries an outside camera position and fallback views, refuses collisions, verifies the actual
  mod-selected contact before a real keyUse click, and runs the caller's server-side result check. The insulator-anchor
  scene uses it for clamps and spool terminals.
- Queue submission/status checks checkout and upstream SHAs, divergence, branch, tracked changes and loaded worker SHA.
  Failed ff-only update stops startup; local commits are never discarded automatically.

### Восстановление checkout очереди

Only when the worker is idle: inspect `stand_jobs` and its `current`; allow an active job to finish. Stop the idle
queue process (not Minecraft) and hold the queue's flock while repairing, so cron cannot restart it mid-update.
Fetch origin/main and inspect status/log first. For a clean diverged checkout preserve HEAD in a unique archive branch,
then recreate main from origin/main. Never use reset --hard on unreviewed changes:

```bash
cd ~/tfc-stand/print-worker/repo
exec 9>~/tfc-stand/queue/lock
flock 9
git status --short
git fetch origin main
git log --oneline --left-right main...origin/main
# Continue only with a clean worktree; preserve tracked/untracked changes separately otherwise.
git switch -c archive/stand-before-recovery-$(date +%Y%m%d-%H%M%S)
git branch -f main origin/main
git switch main
npm ci --ignore-scripts --no-audit --no-fund
node --input-type=module -e "import {runtimeStatus,requireCurrentRuntime} from './scripts/stand-runtime.mjs'; console.log(requireCurrentRuntime(runtimeStatus(process.cwd(),{refresh:true})))"
# Release flock; cron starts the updated worker. Check stand_jobs again, including worker.head.
```

## Targeted Minecraft logs (dev #420, 2026-11-26)

`stand_log` accepts `source=wrapper|client|latest` (wrapper by default). Active client runs carry the queue job ID in
`stand.json`, including RAM runs; reads never select an unrelated run. Terminal jobs use saved results, server jobs
use their active run or archived logs. Reads check real paths, reject escapes, read at most the last 2 MiB and return
at most 400 lines with bounded grep input; missing/deleted logs are reported explicitly. Fixture checks cover active
and archived logs, filtering, truncation and path escape; stand smoke and lint pass.

Live acceptance: remote checkout/worker updated automatically to `2eaf2ab0`. MCP `stand_log` read saved
`wrapper`, `client` and Minecraft `latest` from terminal client job `20261126-145433-e382`. During the real
registration-audit client job `20261126-175313-dba8`, both `source=latest` and `source=client` returned current
mod-discovery lines from its own run `20261126-175315-41ab`, before completion. IPv4 SSH was intermittently
unavailable; the advertised Tailscale IPv6 route worked with the same verified host key. MCP stdio/remote-client/CLI
contracts also passed for all three sources using an isolated transport fixture (scripts attached to #420).

### Create registration concurrency on the client stand (dev #312, 2026-11-26)

A separate `debug-tools-mod` devtest JAR audits Registrate captures, writer thread IDs, overlap, table contents before
registration, bound entries afterwards, and `extendo_grip` before trigger registration. It is excluded from the normal
Debug Tools JAR and is not a player addon release. Source, wrapper, exact run parameters and hashes are attached to #312.

On snapshot `20261117-180033-6dff`, Create 6.0.10 / Registrate 1.3.0+67 / FML 4.0.44, queue job
`20261126-175636-ad19` demonstrated concurrent writes into Create's unsynchronized `HashBasedTable`: Create Deco
initializes `AllItems` on one thread, Aeronautics initializes `AllBlocks` on another. Their FML thread names are equal,
but thread IDs differ. Overlapping item registration was observed. All 699 items and 643 blocks survived in this run;
the historical missing `extendo_grip` was not reproduced directly. A standalone Guava 32.1.2 stress demonstrates that
the same table structure can lose entries under concurrent writes; this is mechanism evidence, not a replay of the crash.

Paired job `20261126-191010-c1fb` used the same diagnostic JAR SHA256
`0d63deaa1a90e4e96f66e85b7ac84b4cdaa5376b7ef0fb069fac3c9b1d086583` and only an overlay setting root
`config/fml.toml` `maxThreads=1`. The loader's raw debug log confirms `Using 1 threads for parallel mod-loading`:
no overlapping captures, all 699/699 items and 643/643 blocks bound, `extendoBound=true`, menu after 122 seconds.
The pool still used two writer thread IDs sequentially, so `maxThreads` is pool parallelism rather than a promise of
one physical thread. Evidence archives: `hzuCOBkRGgXGT4FslDHY` (parallel) and `oM6CF2vj5V5SJetp2bKZ` (serial).

#### Guarded registration accepted (2026-11-27)

A Java 21 agent built from `scripts/client-stand/RegistrateGuard.java` wraps the freshly created Registrate table
in Guava `Tables.synchronizedTable` in the isolated client JVM. It matches the exact target field/constructor/factory
shape and one assignment; incompatible bytecode halts with code 86. Player JARs and the pack cache are unchanged.
The stand builds the helper per run and archives its source, JAR and SHA256 metadata. Acceptance requires the
`APPLIED` console marker and no guard failure. Both queue and direct stand-code synchronization include the source.
FML parallelism is preserved; the maxThreads=1 experiment is not shipped as a substitute for synchronization.

On Java 21, an exact-constructor fixture lost 4655 entries in 20/20 unguarded runs; the actual transformer produced
`Synchronized$SynchronizedTable` with no lost entries in 20 runs. A mismatched factory halted before probe execution.
Fixture archive on #312: `h7tBalvee45qpo31QyEG`; guard source SHA256
`2c3b4b6435e97c7fb6bcf71422ee11ac6e9339a6893ef2e9ab06aaf076efed8c`.

Real parallel guarded audit `20261126-232114-1e27` confirms the synchronized runtime table, three writer thread IDs,
699/699 items, 643/643 blocks and `extendoBound=true`; audit JAR SHA256 is
`cd6e8727dd7b0fa31d3ff6b889ae1f3eff873e40be3f9a86b3ab58cddec4ecb7`.
Its title marker appeared at 213 seconds, but the frame still showed the loading overlay; that PNG is not accepted
as visual menu evidence (#423 tracks the early marker). Normal guarded run `20261127-083717-af78` without the audit
mod reached the marker at 142 seconds and its inspected frame shows the actual menu, followed by clean exit.
Evidence: `Fjytf4I83ndlHINvuXCS` (audit) and `K8rUtfTEMKzSSHWSzTFP` (normal client).

History is retained: first guarded run `224933-06fe` timed out at 900 seconds while model loading still made progress;
that run is not accepted and the slowdown's cause is unproven. Same-JAR unguarded baseline `231818-02b3` subsequently
showed the menu at 114 seconds. A constant guard deadlock is contradicted by the later completed guarded runs.
The original November 8 missing extendo entry was not replayed directly; the observed unsafe concurrent writer path
and the underlying table-loss mechanism are confirmed and protected. The normal Debug Tools JAR excludes the audit
source set. IPv6 result retrieval (#421) and automatic visible-menu confirmation (#423) are implemented below.

Final deployed queue acceptance: `20261127-084423-f0b5`, runtime checkout/worker `f48e8ed0`, normal client without
audit mod, snapshot `20261117-180033-6dff`, FML maxThreads=-1. Run `20261127-084426-91ce` reached the title marker at
118 seconds and exited cleanly at 144 seconds; its inspected PNG shows the actual main menu with buttons and no
loading overlay. Guard source SHA256 matches the accepted source above, helper JAR SHA256
`c77a4a59a54837d7018e5ff202d5982f684f58a930d0bb7f311156d6b721750f` was verified against archived bytes, console
APPLIED marker present. Full result attached to #312 as `x7xEJYPNI16XbJXiJmrX`. Runtime update preserved a stale,
unowned `.git/index.lock` as `queue/stale-index-lock-1795769028`, with the idle queue lock held; no local changes or
commits were discarded. Debug audit sources are on tfc-addons main `912a061`; stand implementation is on tfc-plans
main `f48e8ed0`. All four #312 checklist items are verified. No player addon/pack release or Hosting change is needed.

### Pinned stand runs, menu frames and recovery (dev #421, #423–425, 2026-11-27)

Every new queue job pins the server's immutable pack manifest at submission; `snapshot=<id>` selects an explicit one.
Chain steps, copied worlds and retries inherit it, with refusal on conflicting/legacy unknown snapshots. A cache per
manifest SHA256 is populated in a temporary directory, verified file by file, then renamed; the shared cache used by
direct runs and print checks cannot change the job's mods. Cache files copied from seeds are separate copies.
The source runtime is also frozen per job, including main; chained steps/retries inherit its bytes.
`runtime=worktree` freezes/uploads local runner sources and resolves workspace packages inside that bundle. No manual
SSH, git pull, archive or copy is needed. Addon changes continue through `addon_stand` (frozen JARs/overlay).
The source dependency lock must match installed dependencies. `run-inputs.json` in results records the pack manifest,
runtime SHA256 and custom input hashes. Input/runtime changes are an explicit error.

IPv6 transfers use a fixed rsync destination alias with the real SSH `HostName` and user passed separately. Host key
checking stays enabled. Full saved results (including long logs, summary, PNG and worlds) use the same path as IPv4.
`stand_wait` timeout observes the existing job; it never submits another one.

A stand-only bootstrap helper observes the end of client rendering. Menu success requires two fresh TitleScreen
frames without overlay and confirmation at screenshot capture; FancyMenu's early marker is only diagnostic. Scene
acceptance remains `SCENE END PASS`. Sources and hashes of both Java helpers are archived with the result.

Runtime diagnostics include `index.lock` age, owner uid, size and git processes. For recovery, first stop the idle
worker (check `stand_jobs.current` and queued jobs); from its checkout call:

```bash
node scripts/stand-runtime.mjs --recover
```

The command obtains the queue flock itself. It refuses a busy queue/live worker, recent/nonempty/active lock and
local changes/commits/divergence; saves an old empty lock to `queue/stale-index-lock-<time>` before fast-forwarding.
No reset or forced checkout. Cron prints diagnostics when its pull is blocked.

Verification: autonomous smoke covers pinned-current changes, exact snapshot fetch, inherited snapshot conflicts,
unknown legacy jobs, changed/extra cache files, source-bundle tampering, IPv4/hostname/IPv6 argument handling, fresh vs
stale/blocked menu markers, recent/busy/ahead lock refusal and archived stale-lock recovery.
Live direct run `20261127-090958-6c9d`: early marker 102 s, confirmed menu frame 105 s, normal stop 114 s; PNG viewed.
Saved results and the earlier queue run `20261127-084423-f0b5` were retrieved through the same verified-key IPv6 transport.
Live queue client `20261127-093622-ea9e` passed: early marker 123 s, visible menu 126 s, normal exit, 9/9 startup
and 3/3 client KubeJS scripts without script errors. PNG viewed and attached to #423; logs, helper sources, full
2641-file manifest and source SHA256 are attached to #425. The `FROZEN-WORKTREE-425` marker appeared after its local
source was restored, proving delivery of the captured uncommitted worktree. Cancel/retry and duplicate delivery kept
the same manifest/source digest; conflicting snapshot selection was refused. Server step `20261127-093624-9730`
inherited the same manifest and source digest, booted in 86 s, answered RCON `list` and completed in 111 s.
Its passport and full logs are attached to #425. This was a stand boot/transport check; existing pack recipe/tag and
client-class diagnostics remain in the archived logs.

Exact-path cache seeding verifies SHA256 and copies independent files; a complete verified cache plus the saved
manifest works without contacting the pack server. Missing blobs still require that server. Transient GET connection
errors get bounded retries with an endpoint/cause in the error. SSH submit loads the queue worker environment, so its
pack credentials are available when pinning. Both metadata and payload hashes are checked before reuse; changed
installed dependencies cause a refusal before execution. Active git detection uses process executable names on
Linux/macOS without disclosing command arguments.

### Stand extraction: contracts (dev #426, stage 1, 2026-11-27)

`packages/minecraft-stand` (`@tfc/minecraft-stand`, 0.1.0) is a Node-only package with no external dependencies.
It owns the pack-file manifest validator (the old hash remains compatible), canonical JSON hashes, version-1 run
passport/result and a declarative job validator. Its CLI is `node cli.mjs validate job.json`; see the package README
for the server → client example, pinned distributions, resources, limits, scenarios, checks and world dependencies.
The job validator does not yet prepare or execute these declarations.

The existing queue is an explicit `legacy-args` adapter. New jobs save `passport.json`, binding separate worker and
runner identities, base pack and candidate; the queue verifies its hash and the actual identity before execution.
The legacy worker identity describes a clean checkout revision, not an independent released worker archive.
Terminal jobs save `result.json`; `stand_wait` downloads both files even for cancellation without game artifacts.
Exit code and acceptance verdict are separate: the legacy backend supplies no structured checks, so exit 0 yields
`unknown` in the new protocol. Existing MCP replies/chain acceptance keep their compatibility semantics. Old jobs
are not retroactively assigned a passport.

Verified: existing `stand:smoke`; scratch checks of a package copy outside the checkout without node_modules,
CLI validation, invalid graph/refs/distributions/limits, world dependencies, process/check verdicts and canonical
hashes; isolated queue submission, cancellation, passport tampering rejection and metadata delivery list.
Lint and package boundaries pass. This is contract extraction only: standalone Minecraft execution, isolated
preparation, general backend, adapters and clean-worker real client/server acceptance remain open in #426.
