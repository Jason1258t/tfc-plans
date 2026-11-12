# State: data builders, storage, pack server, `tfc` app

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
  gates it behind `/site/addons?v=2`, `index.json` omits it (old no-key clients read it). `destroy_extras`, `destroy_bridge`
  use it (`unlisted` removed from the bridge). Live `index.json` listed `destroy_extras` until the first publish after this.
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

## Stand queue on test1a (dev #310)

Agents queue whole-pack stand runs instead of holding the stand from their session and polling its log. Measured
before (226 Claude Code transcripts, 26 with the stand): log text itself was ~2 % of tool output, but 14–31 % of the
turns of stand sessions went to the stand, 203 of 373 of them waiting/polling (`sleep`, `tail`, `ps`) — every turn
re-reads the whole context. So the queue answers «done» in one call.

- **Worker** — `scripts/stand-queue.mjs serve` on `test1a`, kept alive by cron every minute through `flock`
  (`scripts/stand-queue.sh`; no systemd: linger is off for `master`). Runs from the print-worker clone
  `~/tfc-stand/print-worker/repo` (main; `git pull` on start, exits by itself when `origin/main` moves while idle, cron
  restarts it within a minute). One run at a time (client 8G + server 6G don't fit 14 GB together). Agent jobs first;
  idle → one background print-check batch (`print-worker.mjs --once`) at most every 10 min. A long print batch (up to
  ~20 min for the cathedral) is not interrupted — an agent job waits behind it, `stand_jobs` says so.
- **Queue folder** `~/tfc-stand/queue` (`TFC_STAND_QUEUE`): `jobs/<id>/job.json` (queued → running → done | error |
  cancelled), `events.jsonl` (progress: the stands' own stderr lines — `[client-stand] …`, pack-stand stages,
  pack:fetch — not the game log), `output.log` (everything, `stand_log`), `summary.txt`, `logs/` (server runs: their
  `/dev/shm` run dir is removed, so `latest.log`, `debug.log`, `kubejs/`, `crash-reports/` are copied here),
  `cancel`; `inputs/<tag>/` — own jars/overlay/world uploaded by the Mac, removed after the run; `current.json`. Last
  40 finished jobs are kept. A worker restart mid-run marks that job `error`.
- **Before each job** the worker compares `.tfc-fetch.json` with `GET /pack/current` (print-worker key) and runs
  `pack-fetch.mjs` when the snapshot moved: queue runs always use the current snapshot, not the Mac's cache. Server
  runs: snapshot + NeoForge staged in `/dev/shm` (`scripts/stand-shm.mjs`, shared with print-worker). Client runs:
  `client-stand.mjs run … --stdin-watch` (cancel closes stdin → clean exit). Stand code is main's: to test a change to
  the stand code itself use the direct path (`pack_client direct=true`, `npm run client-stand`).
- **Mac side** — `scripts/stand-queue-remote.mjs` (`npm run stand-queue -- submit|wait|list|log|cancel`), MCP
  `stand_submit` / `stand_wait` / `stand_log` / `stand_jobs`; `pack_client` goes through the queue (submit + wait).
  `stand_wait` is a long-poll on the host (`stand-queue.mjs wait`, checks the job file every second) over an async ssh,
  so the MCP server keeps answering other calls. Results → `~/.cache/tfc-plans/stand-queue/<id>`. The host CLI exits
  only after stdout drains (`process.exit` right after a write into the ssh pipe cut answers at 64 KB, dev #328); a
  summary over 24 000 chars comes back as head + tail with `summaryCut`, the full `summary.txt` is rsynced next to the
  results. Env:
  `TFC_QUEUE_REPO` (host code dir), `TFC_QUEUE_DIR` (queue dir relative to `~`) — for a test copy.
- **Install** (once; replaces the old print-worker cron line):
  `crontab -l | grep -v print-worker.sh | { cat; echo '* * * * * $HOME/tfc-stand/print-worker/repo/scripts/stand-queue.sh >> $HOME/tfc-stand/queue/serve.log 2>&1'; } | crontab -`.
  Stop: remove the line, `pkill -f 'stand-queue[.]mjs serve'` (the bracket keeps `pkill` from matching its own ssh command).

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
and pass it with `pack_client mods=[…] world=flat`; none of the addons builds such a jar yet.

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
