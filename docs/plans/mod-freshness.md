# Plan: pack freshness (how far behind each mod is)

Status: parts 1–4 done (2026-10-22). Next: the pack devs' git as a third source for hand-built jars (link pending
from the user), then part 5 (skill).

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
3. Page `/freshness` (link from «Обновления»): the static report, filter by colour, search, «Перепроверить Modrinth»
   (live, CurseForge rows kept from the report), «Скачать отчёт (JSON)».
4. MCP `mods_freshness(status, mod, refresh, format)` — the same report live (10 min cache); with `mod` — changelogs
   between our and the newest version.
5. Next: skill «план обновления» — reads `mods_freshness`, then `mods_check` (dependencies), KubeJS and site datapacks
   that touch the mod, addons that depend on it, changelogs; writes the plan into a site task.
