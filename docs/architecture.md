# Architecture: code map, data pipeline, Firestore

Agent reference, read on demand (linked from AGENTS.md). Data-builder rules — also in `scripts/AGENTS.md`.

## Commands

```bash
npm run mods          # rebuild the library from mods/ (slow, cache in .cache/)
npm run serverconfig -- <zip|folder>             # server configs (TOML and <mod>.json5) → Firestore config
npm run kubejs -- <zip|folder> [--layer world]   # KubeJS scripts → public/kubejs.json, own items → kubejs-items.json
npm run world -- <world|world/data|tfc_calendar.dat|zip>  # world save → Firestore config (scope world)
npm run pack -- <version folder|zip> [--world …] [--only …] [--out …] [--dry-run]  # all of the above + instance/sources.json
npm run guides -- pull <folder> | push <file.md|folder>   # guides ↔ Markdown files (author — TFC_NICK)
npm run pack:fetch [-- --kubejs] [--data|--data-only]     # current pack from the pack server → instance/pack/ + mods/ (and data)
npm run pack:publish -- <data folder> --dry-run           # what would be published (Hosting diff, config, packUpdates)
npm run freshness [-- --if-older 6h --soft]              # mod freshness (Modrinth + CurseForge) → public/pack-freshness.json
```

Pack data on Hosting (`scripts/data-roots.mjs`) is published only by the pack server (`publish-data.mjs`, which also runs
`pack-release.mjs`); both build a fresh Hosting version (`hosting-rest.mjs`: `createVersion` + `populateFiles` of
all paths, the other side's files carried over by hash, list check before FINALIZED — never `versions:clone`, which
lost 47 site files on 2026-10-23); `npm run deploy:site` (`deploy-site.mjs`) keeps it from the live release; plain
`firebase deploy --only hosting` is blocked by predeploy (`ALLOW_FULL_HOSTING_DEPLOY=1`). `prebuild`/`predev` run `freshness.mjs
--if-older 6h --soft` (network or key problems only warn). `CURSE_FORGE_API_KEY` in `.env.local` (no `VITE_` — never
in the bundle).

## Data: where it comes from

Scripts are organised **by the source they parse**, not by site section: `scripts/mods.mjs` (+ parts in
`scripts/mods/`) — `mods/`; `scripts/serverconfig.mjs` — configs (`config/`, `serverconfig/`); `scripts/kubejs.mjs` —
`kubejs/`; `scripts/world.mjs` — world save. A new site section = a new part in `scripts/mods/`, not a new command. Old
`npm run items` / `config` are aliases.

The site is a static SPA. All "pack knowledge" is built locally by scripts and deployed as static files from `public/`
(not in git); live data is in Firestore.

| Source (not in git) | Script | Output |
| --- | --- | --- |
| `mods/*.jar` (+ mods nested in `META-INF/jarjar/`) | `mods.mjs` (+ `reference`, `manifest`, `geo`, `tags`, `botany`, `meals`, `cuisine`, `power`, `multiblocks`, `icons3d`) | `public/items.json` (`b` — also a block), `blocks.json` (blocks without an item + item from their loot, `mods/blocks.mjs`), `icons/` (+ `icons/<ns>/render/` — 3D block icons), `recipes.json`, `reference.json`, `pack-manifest.json`, `geo.json`, `geo/`, `tags.json`, `botany.json`, `meals.json`, `power.json`, `multiblocks.json`, `multiblocks/` |
| `instance/kubejs/<layer>/` | `kubejs.mjs` | `public/kubejs.json`, `kubejs-items.json`, `icons-kubejs/` (pack items from startup_scripts + assets), `kubejs-data.json` (food and skillet from `kubejs/data` — the site replaces mod data with them) |
| world save (`<world>/data/`) | `world.mjs` | Firestore `config/world__{file}` — TFC calendar (month length set by command) |
| server config zip/folder | `serverconfig.mjs` | Firestore `config/{scope}__{path}` |
| manifest diff at publish | `pack-release.mjs` (from `publish-data.mjs` on the pack server) | Firestore `packUpdates/{id}` |
| manifest + Modrinth/CurseForge | `freshness.mjs` (prebuild) + `src/lib/freshness.ts` | `public/pack-freshness.json` |

- Scripts write Firestore via REST as `firebase login` or a service key (`GOOGLE_APPLICATION_CREDENTIALS`)
  (`scripts/firestore-rest.mjs`); rules don't apply. Same way is handy to read the DB from node.

## Firestore

Collections: `tasks`, `groups`, `artifacts`, `files` (+`chunks`, package `firestore-files`), `datapacks`,
`kubejsScripts`, `schematics`, `recipeHints`, `guides` (+`revisions`), `packUpdates`, `settings/world`, `config`,
`configChanges` (agent config edits; closed to the site), `onboarding/{uid}`, `replaceFavorites`. Fields — README,
«Модель данных».

- No real auth: anonymous sign-in + nick cookie. Rules check data shape and `nick(...)`, not ownership.
- `config` and creating `packUpdates` are closed to the site — only scripts write them.
- The `files` block in `firestore.rules` is generated: `npm run rules:files`, don't edit between the markers.
- Shared CRUD — `src/data/store.ts` (`make<T, N>('collection')`), with a localStorage fallback without Firebase.

## Code map

```
src/pages/        TasksPage (+ docs section DocsSection), DocPage, FilesPage, SchematicsPage, AddonsPage (AddonsTab),
                  DatapacksPage/RecipesPage/TagsPage (one section, PackNav on the left), ReferencePage (tabs: «Гайды» —
                  GuidesTab, «Карта» — MapPage, «Мультиблоки» — MultiblocksTab), UpdatesPage
src/components/   Onboarding (texts — lib/onboarding.ts), Modal, ItemPicker/ItemIcon, FileBadge (kinds — lib/fileKinds.ts),
                  RecipeCatalog (RecipeBrowser), KubejsConstructor, SchematicLibrary, WorldMap, …
src/lib/
  items.ts fuzzy.ts            item library, search (fuse.js — only for schematic replacement suggestions)
  recipes.ts recipeFilter.ts   recipe catalogue + KubeJS: statuses, filters
  recipeRefs.ts kubejsFix.ts   recipe inputs/outputs; KubeJS-removal workaround builder
  tags.ts                      tags: merging sources and KubeJS, search, datapack edit file (UI — TagEditor)
  datapack.ts datapackFiles.ts datapack records, zip, checks; datapack files (shared with Node)
  kubejsScripts.ts             site KubeJS scripts (collection kubejsScripts, UI — components/KubejsScripts)
  nbt.ts schematic.ts materials.ts schematicLibrary.ts   .nbt schematics: replace/remove blocks, materials, library
  schematicFile.ts             schematic file with replacements and shape (shared with Node; suggestions — schematic.ts)
  reference.ts meals.ts        reference (ores, fuel, liquid fuel, food, metals); composite meals and calculators
  multiblocks.ts               IE multiblocks: templates, tag substitutes (UI — MultiblocksTab, CSS 3D)
  power.ts                     electricity: Create SU ↔ EE (V/A/W) ↔ IE FE/t, formulas from code (UI — PowerTab)
  calcExpr.ts guideFormat.ts   guide formulas (own parser, no eval/imports) and number format {{x | 1 В}}
  guideScope.ts powerGuideScope.ts   names for formulas: shared functions + section (settings, power.json, power.ts)
  projection.ts geo.ts atlas.ts config.ts   TFC Real World map, world settings from server config
  packUpdates.ts gemini.ts     pack updates, Gemini requests (model chains with fallbacks, 90 s timeout)
  files.ts files.config.ts     attachments: wrapper over fileStorage/ (Firestore or own server — VITE_FILES_SERVER)
src/components/guides/  GuidesSection, GuideEditor/History/Help, CalcBlock (```calc), GuideBody (Markdown + {{…}} +
                  «::name» widgets), powerWidgets; format — docs/plans/guides.md
server/file-server/  file server for Ubuntu (Node, no deps); migration — scripts/files-migrate.mjs
server/pack-server/  pack server (snapshots, keys); on the VPS — docs/pack-server.md
cli/              `tfc` PC app (npm run tfc -- …): sync/publish; docs/tfc-app.md, cli/README.md
tools/            pack addons — docs/addons.md; card tools/<mod>/addon.json + jar + icons/ → public/addons/ and
                  /addons/index.json for tfc (scripts/addons-index.mjs, pre dev/build); site — lib/addons.ts (glob of
                  cards), AddonsTab (list), pages/AddonPage + guides/AddonArticle (/addons/<mod>, Firestore guide
                  addon-<mod>, section addon, widget ::addon-block)
scripts/mcp/      agent MCP (stdio) — docs/mcp.md
scripts/mods/visibility/  hidden items (not visible in game): per-mod rule from mod code (field h in items.json)
scripts/          mods.mjs + mods/{reference,tags,botany,meals,cuisine,power,multiblocks,geo,manifest,classfile,
                  config-defaults}.mjs, serverconfig.mjs, kubejs.mjs, pack-release.mjs, pack.mjs; firestore-rest.mjs
docs/plans/       feature plans with statuses; docs/STATE.md — current state
```
