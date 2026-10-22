# State: data builders, storage, pack server, `tfc` app

Part of [STATE.md](../STATE.md). Human docs: [pack-server.md](../pack-server.md), [tfc-app.md](../tfc-app.md); plan —
[plans/pack-cli.md](../plans/pack-cli.md) (stages 1–6).

## Data builders

- `npm run mods`, `serverconfig`, `kubejs`, `world`, `pack-release` on deploy, and `npm run pack -- <version
  folder|zip>` — all at once with folder discovery, whitelist and `instance/sources.json` (2026-10-20, stage 1).
- Parsers are a library: input, output and cache dirs are parameters; Firestore token from a service key
  (`GOOGLE_APPLICATION_CREDENTIALS`) or `firebase login`. `pack` was not run on the host's real instance folder (tested
  on an assembled copy in scratchpad: mods, KubeJS, test configs, calendar).
- Guard against building without mods (worktree without jars): the library build stops if `mods/` is empty but the
  previous build had mods (`TFC_ALLOW_NO_MODS=1` bypass); `pack-release` writes nothing at 0 mods or a loss of more
  than half (`ALLOW_MODS_DROP=1`). `npm run deploy:site` (`TFC_KEEP_MODS=1`) deploys site edits without jars: mod data
  ready-made, in a worktree taken from the main checkout with `.env.local`, addons, resource packs and KubeJS;
  `predeploy-check` blocks a site built without Firebase settings.

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
- **Mod data on the site now comes from the server:** `npm run deploy:site` from the main checkout uploads its
  `public/` — if mod data there is stale, run `npm run pack:fetch -- --data` first. A jar-less site build with
  `TFC_PACK_URL`/`TFC_PACK_TOKEN` in `.env.local` takes mod data from the server; `npm run pack:fetch` — pack from the
  server into the project.
- VPS code updated 2026-10-20 (`7684766`).

## `tfc` app (`cli/`, stage 3+)

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
  per-version game dir setting — **unverified** (its config samples show no such key). Progress: `spinner` /
  `withSpinner` in ui.mjs (prepare, file scan, NeoForge installer phases in Russian, placing files); progress bar
  shows speed and ETA, redraws every second.
- Site content (stage 5): datapacks → `<world>/datapacks/tfc-plans-<id>.zip`, kubejs → `kubejs/server_scripts/<fileName>`,
  schematics → `schematics/` (with replacements and shape). An unflagged item removes only our unchanged file; a foreign
  file with the same name → `*.tfc-new`; tracked in `pulled` in `.tfc/state.json`. Content via the pack server
  (`GET /site/datapacks|kubejs|schematics`, `/site/files/:id`): reads Firestore with the service key, lists cached 5 min,
  schematic sources on disk. Checked on prod Firestore (read-only) — 1 flagged datapack and 4 schematics installed; a
  temp key was used and revoked. **Not checked in game.**
- **Addons** (2026-10-21): from site static (`/addons/index.json` — built by `scripts/addons-index.mjs` before dev/build
  from `tools/*/addon.json` + jar sha256; no key needed) → `mods/`; old jar of the same mod (by id in jar) and files in
  the addon's `replaces` (rw-host-fix — `eratosthenes_portal_clamp.js`) are backed up, with a prompt or `--yes`. That
  `publish` takes jars from `mods/` and sees the removed script — checked by folder analysis without upload. **Not on
  Windows, not with a real upload.**
- `tfc --upgrade` — self-update (version.json → zip for own OS → sha256 → trial run → replace; on Windows the old exe is
  renamed `.old`). Checked on macOS arm64 with a local site copy; **not on Windows**.
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
