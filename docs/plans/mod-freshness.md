# Plan: pack freshness (how far behind each mod is)

Status: all parts done (2026-10-22). Tool gaps found by part 5 — below.

## Goal

For every mod in the pack, find the newest version for **Minecraft 1.21.1 + NeoForge** and colour the lag by the first
differing number of `x.y.z`: `x` — red, `y` — orange, `z` and further — yellow. The report is built by code only
(no model), so a skill with MCP can later turn it into a full or partial update plan.

## Sources

- **Modrinth** — by jar sha1 (`pack-manifest.json` already has it): `POST /v2/version_files` (current version),
  `POST /v2/version_files/update` with the current version's loaders and `game_versions: ["1.21.1"]` (newest of any
  type). If the newest is beta/alpha, the newest release comes from `/v2/project/{id}/version`. No key, needs a
  User-Agent, CORS is open — the site can recheck Modrinth by itself.
- **CurseForge** — for mods not found on Modrinth, by fingerprint (murmur2, seed 1, bytes 9/10/13/32 skipped — stored in
  the manifest as `cf`): `POST /v1/fingerprints/432` → mod and file; `POST /v1/mods` → `latestFilesIndexes`
  (latest file per game version, loader 6 = NeoForge, release type); `POST /v1/mods/files` → dates and dependencies.
  Needs `CURSE_FORGE_API_KEY` (`.env.local`; no `VITE_` prefix — never in the browser bundle).
- First probe (2026-10-22, 234 mods): Modrinth found 175 (75 outdated), CurseForge — most of the remaining 59 (FTB,
  Sophisticated, KubeJS, Moonlight…); unmatched — hand-built jars (`tfcr-fixes`, `*-TFCR`).
- **Git of the pack devs** — for mods still not found: GitHub releases of the repos in `PACK_GIT`
  (`src/lib/freshness.ts`; the list comes from `local-mods/README.md` of github.com/GranniXXie/TerraFirmaRebirth — add
  a repo there when the devs add one). One `GET /repos/{repo}/releases?per_page=30` per repo (9 now). A mod matches a
  repo when a release asset has the same jar «shape» (lowercase, digits → `#`, separators unified — GitHub turns `+`
  into `.`); current = the release holding our exact file (else compared by version from the file name), latest = the
  newest non-prerelease, a newer prerelease is the beta. Version from the asset name (`fileVersion`). Without a token
  GitHub allows 60 requests/hour per IP; the script takes `GITHUB_TOKEN` (env / `.env.local`) or `gh auth token`.
  The site rechecks git live from the browser; on a GitHub error the report's git rows are kept. Changelog for MCP —
  release bodies between our release date and the newest. Result 2026-10-22: all 5 hand-built jars found.

## Version comparison

Version strings differ between our `mods.toml` and the platforms (`1.21.1-8.39-fabric+forge+neo`), so we compare the
platform's own strings (current file vs newest file). Minecraft version (`1.21`, `1.21.1`, `mc1.21.1`), loader names
and a leading `v` are removed, then the first `\d+(.\d+)*` is taken. Equal numbers but a different file (beta.1 →
release, `b2` → `b7`) — yellow, level `pre`. Newest smaller than current (scheme changed) — `unknown`. Colour is
counted against the newest **release**; a newer beta is shown next to it.

Known quirk: mods whose first numbers are the MC version (JEI `19.x`, Puzzles Lib `21.1.x`) shift the real "major"
one place right. Not special-cased.

## Parts

1. `src/lib/freshness.ts` — shared (site and Node): fingerprint, version parsing, Modrinth/CurseForge checks, report
   assembly and sort (red → orange → yellow → unknown → missing → own → ok).
2. `scripts/freshness.mjs` (`npm run freshness`) → `public/pack-freshness.json`. Runs in `prebuild` with
   `--if-older 6h --soft`: network or key problems never stop the build. Without a CurseForge key — CurseForge marked
   `skipped`.
3. Page `/freshness` (link from «Обновления»): the static report, filter by colour, search, «Перепроверить Modrinth и
   гит» (live, CurseForge rows kept from the report), «Скачать отчёт (JSON)».
4. MCP `mods_freshness(status, mod, refresh, format)` — the same report live (10 min cache); with `mod` — changelogs
   between our and the newest version.
5. Skill `update-plan` (`.claude/skills/update-plan/SKILL.md`, «план обновления»): scope (pack / colour / list) →
   `mods_freshness mod=…` changelogs → `mods_check`, `mod_get`, one `kubejs_search` regex, `datapacks_list`,
   `kubejs_site_list`, `addons_list`, `mixins`, configs, site code that reads the mod's data → risk groups
   (безопасно / проверить / рискованно / не сейчас), order (libraries with dependents), in-game checks → shown to the
   user, then a site task (`task_create`) + plan doc (`artifact_put`). Tried 2026-10-22 on the 5 red mods: found the
   Collective config move (`.json5` → `config/serilum/*.json`, affects the pending World Border edit), Moonlight 3.x vs
   Burning Block built for 2.x, Liquid Fuel mixins sharing `BlazeBurnerBlockEntity.tick` with woodencog, Deep Seas
   newest only beta.

## Tool gaps (from the part 5 trial) — closed 2026-10-22 (`deps=true`, `beta=true`, oldest-first paging)

- The **new** version's dependency ranges aren't shown (only newly required mods): e.g. which Collective World Border
  5.0 needs. Wanted: `mods_freshness mod=… deps=true` — download the new jar (cached), read its `neoforge.mods.toml`,
  check against the pack like `mods_check`.
- Changelogs are cut at 20 000 chars with betas first, so the oldest releases disappear (Deep Seas cut at 3.4.1,
  CurseForge returns Moonlight only from 3.6.0). Wanted: releases only by default, oldest-first paging.
- Modrinth changelogs from Serilum come as raw HTML — convert like CurseForge.
