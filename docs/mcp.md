# Pack MCP (`tfc-pack`)

The pack MCP server is a local program the coding agent (Claude Code, Codex, …) uses to ask about the pack: items, recipes, tags,
reference, settings, mod books, map, guides and site content. Without it the agent greps large JSON
(`public/recipes.json` — 7.7 MB) and unzips jars; with it answers are short, paged and already include the pack's
KubeJS changes.

People don't use it directly. This document covers how it works, what it can do and how to extend it. Tool descriptions
and parameter descriptions are in English (the agent reads them); tool output stays in Russian.

## Connection

- Server — `scripts/mcp/server.mjs`, stdio, registered in `.mcp.json` at the project root. Claude Code starts it when
  the project is open; other agents — their own config, see [agents.md](agents.md).
- No dependencies: the MCP protocol (line-delimited JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`, `ping`) is
  implemented in the server itself, without `@modelcontextprotocol/sdk`, so it's easy to move to the pack server.
- Firestore is read with the MCP service key (`TFC_FIRESTORE_KEY` in `.mcp.json`, default
  `~/.config/tfc/mcp-firestore.json`, role Cloud Datastore User; moved into `GOOGLE_APPLICATION_CREDENTIALS` of the
  server process only — setup in `scripts/mcp/firestore-key.example.md`), else as `firebase login`, via
  `scripts/firestore-rest.mjs`. On 401 `api()` refetches the token and retries once. Without login everything works except configs, guides, pack updates and site content.
- `javap` for `jar_javap` — system JDK; decompiler for `decompile` — Vineflower from the Gradle cache
  (`~/.gradle/caches/…/org.vineflower`, put there by the addon build) or `TFC_DECOMPILER`; Java — JDK 21 from
  `~/.gradle/local-tools/jdk21` or system.
- **After editing code in `scripts/mcp/`** restart the server: `/mcp` in terminal Claude Code or a new session in the
  app. Data (`public/`, jars, KubeJS) is re-read automatically when files change.

## Data sources

The server builds nothing itself: it reads what the site scripts built. Stale site data → stale answers.

| What | From | Refresh with |
| --- | --- | --- |
| Items, recipes, tags, reference, mod manifest | `public/*.json` | `npm run mods` |
| KubeJS rules and recipes, `kubejs/data` | `public/kubejs.json`, `kubejs-data.json` | `npm run kubejs` |
| KubeJS sources | `instance/kubejs/<layer>/` | `npm run pack:fetch -- --kubejs` |
| Mod code, books, translations, loot tables | `~/.cache/tfc-plans/pack/mods/*.jar` (and nested jar-in-jar) | `npm run pack:fetch` |
| Candidate mods (not in the pack) | `<root>/.cache/mcp/candidates/*.jar` | `candidate_get` (path / Modrinth / link) |
| Minecraft + NeoForge code and sources (Mojang names) | `tools/<addon>/build/moddev/artifacts/neoforge-*.jar`, `-sources.jar` | addon build (`./gradlew build`, docs/addons.md) |
| Vanilla translations | `.cache/assets/minecraft-1.21.1/` | `npm run mods` (fills the cache) |
| Resource packs | `instance/resourcepacks/` | `npm run pack:fetch` |
| Minecraft and NeoForge resources (models, textures) | `tools/<addon>/build/moddev/artifacts/neoforge-*-client-extra-aka-minecraft-resources.jar` and `neoforge-*.jar` | addon build |
| Addon resources and classes | `tools/<mod>/src/main/resources`, `build/classes/java/main` | addon edit, `./gradlew build` |
| Server and world configs | Firestore `config` | `npm run serverconfig`, `npm run world` |
| Guides, tasks, datapacks (also as a recipe layer), schematics, site scripts | Firestore | site edits |
| Pack updates | Firestore `packUpdates` | written on deploy (`pack-release.mjs`) |

A git worktree has no `public/` or `instance/`: the server finds the main checkout
(`git rev-parse --git-common-dir`) and reads from there. Pack jars are not in the repo at all: they live in the snapshot
cache outside it (one copy per machine, `scripts/pack-cache.mjs`), filled by `npm run pack:fetch` (address and key —
`TFC_PACK_URL`/`TFC_PACK_TOKEN` or the `tfc` app login). Without it the jar tools answer «нет папки модов … npm run
pack:fetch»; data tools (items, recipes, tags) work from `public/`.

Paths can be set via env vars (for running on the pack server):

| Variable | Default |
| --- | --- |
| `TFC_PACK_ROOT` | main checkout root |
| `TFC_PUBLIC_DIR` | `<root>/public` |
| `TFC_PACK_CACHE` | `~/.cache/tfc-plans/pack` (snapshot copy from `npm run pack:fetch`) |
| `TFC_MODS_DIR` | `$TFC_PACK_CACHE/mods`; when set, `.cache/mcp`, `instance/`, `tools/` are looked up next to it (pack server) |
| `TFC_INSTANCE_DIR` | `<root>/instance` |
| `TFC_KUBEJS_DIR` | `<root>/instance/kubejs` |
| `TFC_VANILLA_DIR` | `<root>/.cache/assets/minecraft-1.21.1` |
| `TFC_PLATFORM_JAR` / `TFC_PLATFORM_SOURCES` | newest `neoforge-X.jar` / `-sources.jar` in `tools/*/build/moddev/artifacts` |
| `TFC_DECOMPILER` | newest Vineflower in the Gradle cache |
| `TFC_AGENT_NICK` | `Claude` — author / `updatedBy` of every write (tasks, docs, guides, config proposals, addon versions); set per agent, see [agents.md](agents.md) |

## Tools

71 in total. Asterisk — required parameter. Lists have `limit` and `offset`; the answer says «дальше: offset=…».

Regex queries (`query` of `log_analyze`, `regex=true` in searches, `grep`, `members`) are case-insensitive; leading
Java/PCRE flags (`(?i)…`, `(?s)…`) are accepted. Non-regex search understands «`a|b`» — any of.

### Items, recipes, tags

Merging is as on the site: recipes from `kubejs/data` and scripts replace a mod recipe with the same id; KubeJS removals
apply only to datapack recipes; `replaceInput`/`replaceOutput` are applied to inputs and outputs.

Beyond the site, `recipes_for`, `recipes_using` and `recipe_get` include **site datapacks** (Firestore `datapacks`):
flagged «ставить» (`install = true`, the `tfc` app puts them into the world) form a layer over mods (same-id recipe
replaced, source «датапак сайта <name>»), below `kubejs/data` and scripts; KubeJS removals and replacements apply to it.
The order «`kubejs/data` over world datapacks» follows the site, not checked in game. Unflagged datapacks appear as a
separate line «есть на сайте, но не ставится». Files are built by the same `src/lib/datapackFiles.ts` as the site; the
collection is read whole (~10 reads) every 10 minutes. Without Firestore login — no layer, with a warning.

| Tool | Does |
| --- | --- |
| `items_search(query*, mod)` | find an item by Russian/English name or id |
| `item_get(id*)` | item: mod, jar, tags, recipe count, food/fuel/melting/botany |
| `recipes_for(output*, status, type)` | how to obtain: recipes with the item, fluid or tag as output, with in-game status |
| `recipes_using(input*, via_tags, status, type)` | where used: directly, via tags and after KubeJS replacements |
| `recipe_get(id*)` | full recipe: source, which KubeJS rule removes or changes it (file:line), JSON |
| `recipe_conflicts(type, recipe, id, inputs, outputs)` | would a new recipe be intercepted: same type + same inputs (tags considered) or same shaped grid (mirror); same id → replaced. Sources: mods, kubejs/data, KubeJS scripts, site datapacks (KubeJS removals applied) |
| `tag_members(tag*, kind, expand)` | tag members after mods and KubeJS, nested tags expanded |
| `tags_of(id*, kind)` | tags containing an item, fluid or block |

Recipe status: «работает», «изменён KubeJS», «удалён KubeJS», «отключён заглушкой датапака» or «работает, но есть
удаление с неразборчивым фильтром».

### Reference and settings

| Tool | Does |
| --- | --- |
| `reference_get(section, filter, id)` | site reference sections: `ores`, `smelt`, `chains`, `metals`, `fuels`, `liquid`, `foods`, `botany`, `greenhouse`, `meals`, `skillet`, `multiblocks`, `power` (with `kubejs/data` corrections) |
| `config_get(file, key, mod)` | mod settings by layer: world save > `serverconfig/` > pack `config/` > value from mod code. TOML (`<mod>-server/common.toml`, `<mod>/server.toml`) and since 2026-10-21 JSON5 at the root of `config/` (`worldborder.json5` and other Collective mods; nested `*.json5` — import with `--all`). Unapplied edits marked ⏳ |
| `config_propose(note, edits)` | propose a TOML config edit: `edits: [{ file, key, value }]`, full key (`blocks.crops.cropGrowthModifier`); checks key, type and range from mod code, layer (a world-save key is refused), no pending edit of the same key. Writes Firestore `configChanges` (signed `Claude`); the host applies files — `tfc admin changes pull` (docs/tfc-app.md) |
| `config_changes(status, id, cancel)` | edits and the host's per-key result (`pending` default, `applied`, `rejected`, `cancelled`, `all`); `cancel=<id>` cancels an unapplied one |

### Pack

| Tool | Does |
| --- | --- |
| `mods_list(query, sort)` | pack mods: id, name, version, jar, item and recipe counts |
| `mod_get(id*)` | mod: sha1, items, recipes by status, recipe types, tags, configs |
| `pack_updates(id, section, kind, mod, query)` | pack update history: feed, full record, mod changelog from Modrinth, patch notes. 10 min cache |
| `mods_freshness(status, mod, deps, beta, neoforge, refresh, format)` | how far behind each mod is (Modrinth by sha1, CurseForge by fingerprint, needs `CURSE_FORGE_API_KEY`; pack devs' GitHub releases by jar name, optional `GITHUB_TOKEN` / `gh` login): colour by x/y/z lag, newer betas, new required deps; `mod` — one mod + changelogs of newer **releases**, oldest first, paged by version (`offset`/`limit`; HTML → text); `beta=true` — with betas, up to the newest beta; `deps=true` — downloads the new jar (cache `.cache/mcp/fresh/` next to `mods/`), checks its `neoforge.mods.toml` and jar-in-jar against the pack with our jar swapped out (as `mods_check`; `neoforge=` for NeoForge ranges), changed/removed ranges vs ours, pack mods whose ranges it breaks; `format=json` — raw report. Live, 10 min cache. Plan — [plans/mod-freshness.md](plans/mod-freshness.md); update plan from it — skill `update-plan` |

### KubeJS sources

Marks in answers: `−` remove, `~` replaceInput/Output, `+` recipe, `#` tag, `@` own item — what the site parsed from the
line. If files are newer than the parse, the tool warns: time for `npm run kubejs`.

| Tool | Does |
| --- | --- |
| `kubejs_files(layer, folder, path)` | files by layer (`pack`, `world`) and folder, with line and parsed-record counts |
| `kubejs_search(query*, regex, context, layer, folder, path)` | search script text and `data`/`assets` files: words, «`a|b`», or regex (`regex=true`) |
| `kubejs_read(path*, grep, notes)` | file by lines with parse marks |

### Mod code

| Tool | Does |
| --- | --- |
| `jar_find(pattern*, jar, nested)` | files and classes in jars: path part, dotted class or glob (`data/tfc/**/*.json`) |
| `jar_read(jar*, path*, grep)` | text file from a jar by lines |
| `jar_javap(class*, jar, method)` | bytecode of a class or one method; without `jar` the class is found via the index |

`jar` — file name, part of it or mod id; nested — `<jar>!<path>` (or an unambiguous part of the name); Minecraft +
NeoForge — `minecraft`.

### Candidate mods (not in the pack)

For integration analysis (skill `integration-plan`): read a mod that isn't installed without unzip/javap.

| Tool | Does |
| --- | --- |
| `candidate_get(jar, path, modrinth, version, url, download, section, query)` | registers a candidate jar into `.cache/mcp/candidates/`: `path` — local file (scratchpad), `modrinth` — slug/id (newest NeoForge 1.21.1 release or `version`; unknown slug → search hints), `url` — direct link from cdn.modrinth.com / forgecdn.net / GitHub. **Without `download=true` nothing is downloaded** — it reports file, source and size to ask the user. Summary: mods and versions, license, deps checked against the pack like `mods_check` (as a replacement if the mod is already in the pack), jar-in-jar vs pack versions, side, content by `block./item./fluid…` lang keys with ru_ru coverage, blockstates, recipes by type, tags (`c:`), worldgen and biome modifiers, other data, `ModConfigSpec` classes, mixin configs and targets also mixed by pack mods. `section=` `content`, `recipes`, `tags`, `worldgen`, `config` or `mixins` — full lists (`query` filters; tags show if the pack has the same tag). No args — registered candidates |

After `candidate_get`, `jar="candidate:<file or part>"` (nested: `candidate:<file>!META-INF/jarjar/x.jar`) works in
`jar_find`, `jar_read`, `jar_grep`, `jar_javap`, `class_find`, `class_info`, `class_hierarchy` (ancestors) and
`decompile`. Candidates never enter the pack class index, recipes or items: `class_find` without `jar`, `mixins`,
`code_refs` stay pack-only.

### Pack debugging: mod code, mixins, dependencies, logs

The class index covers all pack jars, their nested libraries (jar-in-jar via `META-INF/jarjar/metadata.json`, like
the loader, and nested-in-nested) and Minecraft + NeoForge with Mojang names from the addon build cache. Built in memory
in ~3.5 s on first request (~75k classes), then rebuilt only for changed jars. `.class` parsing is own
(`bytecode.mjs`), no JDK.

| Tool | Does |
| --- | --- |
| `class_find(query*, jar, kind, mixin, platform)` | classes by name part, full name or glob (`*Furnace*`): kind, parent, jar and mod; mixin targets |
| `class_info(class*, jar, members, synthetic)` | class from bytecode: ancestors with mods, interfaces, annotations, fields with constants, methods with signatures and source lines (`:66–89` — for crash stacks), mixins on the class, other jars with the same class; ⚠ if a common class references client-only classes (below) |
| `class_hierarchy(class*, jar, direction, depth, platform)` | ancestors and all interfaces; tree of subclasses and implementations across the pack |
| `code_refs(target*, kind, jar, subtypes, self, platform, access, side)` | who uses it — with method and line: class (`extends`, `new`, calls, signatures, annotations and mixin targets), method/field (`Owner#name`, `*#name`; `subtypes` — calls via subclasses; the owner class itself included; for a class — `self` to include it), string (`"tfc:…"`, config key). For fields — «ЗАПИСЬ»/«чтение» (`access=write` — only writers); each site shows the code side. ~2–6 s over the pack |
| `event_listeners(event*, subtypes, platform, kubejs)` | who listens to a NeoForge event: `@SubscribeEvent` with the event, its ancestors and subclasses (priority, `@EventBusSubscriber`), `addListener(…)` with lambdas and method refs; KubeJS scripts — `NativeEvents.onEvent`/`Java.loadClass` with the class and KubeJS events (`PlayerEvents.loggedIn` …) dispatched from KubeJS's own handler |
| `mixins(target, method, class, mod, platform)` | `target` — mixins on a class by method (`@Inject`/`@Redirect`/`@Overwrite`/MixinExtras, `at`, priority, config), possible conflicts and ⚠ «mixin on this class may crash a dedicated server»; `class` — one mixin; `mod` — a mod's mixins and configs; no params — overview: targets without class, undeclared configs, classes mixed by many mods |
| `bytecode(class, jar, method, query, diff)` | compact bytecode, own parser, no JDK — instead of `javap` in a shell. Without `method`: one line per method — calls, fields read/WRITTEN, strings, numbers, created classes (`query` — only methods mentioning it). `method` (regex): op stream per source line without stack noise — locals by name, constants, fields, calls, branches with target lines (`[a]` — target in the same line, `↑` — backwards = loop), `switch`, lambdas, string concat; boxing calls dropped. `jar` also takes a **path**: a `.jar`, a classes folder (`tools/<addon>/build/classes/java/main`, `run/.mixin.out/class` — class after mixins, libs from Gradle) or a `.class`. `diff=<jar or path>` — the other version: with `class` — fields/methods added/removed/changed with call/field/constant differences; with `method` — line diff; without `class` — which classes of two jars changed (byte-equal skipped, line-number-only counted separately) |
| `decompile(class*, jar, method, grep)` | source: mods — Vineflower (cache `.cache/mcp/decompile`, ~1–4 s first time), Minecraft — `-sources.jar`; `method` — one method only |
| `jar_grep(query*, regex, path, jar, nested, context)` | text in jar files (json, toml, lang, mixins.json, data/, assets/), no classes; «`a|b`» |
| `mods_check(mod, neoforge, minecraft, side)` | dependencies from `neoforge.mods.toml` of all jars and nested: missing mod, wrong version, incompatible, mod in two jars, same classes in different jars, minimum NeoForge; `mod` — one mod and who depends on it |
| `log_analyze(path, text, level, query)` | log or crash report (`latest.log`, `crash-*.txt`, `.gz`, game folder — takes the newest; or stack text): deduplicated errors, stack → mod, mixin handlers → mod, `NoSuchMethodError` decoding, missing class, mixin not applied, missing dependency, broken recipes and KubeJS scripts. Crash report: header (Connector, Sable ask to retry without them), thread, exception, mods in stack, mixins on top frames, section details (level, block, entity), system and player mod-list diff. `level=timeline` — game chronology (below). Player IPs hidden |

Verified against code, not memory:

- `mods_check` mirrors FML 4.0.42 (`ModSorter.verifyDependencyVersions`, `VersionSupportMatrix`): dependencies of the
  other side aren't checked, `optional` only if the mod is present, `discouraged` — log error without stopping; on
  Minecraft 1.21.1 a dependency counts if the range includes `1.21` (for `minecraft`) or `21.0.166` (for `neoforge`) —
  hence JEI with `[1.21, 1.21.1)` works. `dependencyOverrides` from `config/fml.toml` not handled.
- Mixins (Mixin 0.8.7): targets without a class — only WARN, mixin skipped (`@Pseudo` — silently); an apply error
  (inject didn't find the method) in a `required` config — crash, otherwise WARN (`MixinProcessor`).
- Minecraft sources — the newest NeoForge with `-sources.jar` in addon caches (`tools/*/build/moddev/artifacts` and one
  level deeper — `tools/rw-host-fix-mod/devserver/build/…`; now 21.1.251, same as the host); `decompile` prints the
  version. Minecraft line numbers in a game stack may differ (game — Mojang bytecode, here — recompiled sources). Mod
  class line numbers come from bytecode and match the stack.
- Code side (`code_refs`, `event_listeners`): «клиент» — package `client`, `@OnlyIn(CLIENT)`,
  `@EventBusSubscriber(Dist.CLIENT)` or a client-class parameter (`ClientPlayerNetworkEvent…`); «обе стороны» —
  handlers of `LevelEvent*`, `EntityJoin/LeaveLevelEvent`, `EntityTickEvent`, `LevelTickEvent`, `PlayerTickEvent`: they
  fire for the client world too. A handler is a method with `@SubscribeEvent` or a single event parameter
  (`addListener(this::onX)`). In singleplayer and «host world» client and integrated server share one process and static
  fields — that's how TFC Real World 4.1.4 wiped the server's map settings (`onLevelUnload` → `clearServerConfig`).
- "Client only" for the `class_info`/`mixins` warning: `net/minecraft/client`, `net/neoforged/neoforge/client`,
  `com/mojang/blaze3d` and mods' `…/client/…` packages. A dedicated server doesn't load them (RuntimeDistCleaner:
  «Attempted to load class … for invalid dist DEDICATED_SERVER»); a mixin that rewrote a common class with such
  references can fail on frame recomputation — that's how the first `rw-host-fix` crashed.

#### Log timeline (`log_analyze level=timeline`)

Game events only, in order: integrated/dedicated server start, join (with coordinates from `PlayerList`), leave,
dimension change (Iris «dimension change» and JourneyMap «Dimension change» — one line per change), commands
(`issued server command`) and their replies (`[Player: …]`: teleport, gamemode change), `MinecraftServer` lines — chat,
deaths, join/leave, saves (at most once per 30 s), «Can't keep up» and errors after joining (one per kind, ×N repeats).
Client chat duplicating a server line is collapsed. Noise from LOD (Voxy/Roxy), ChunkBuilder, ByePregen, recipes,
`ClientRecipeBook`, JEI/EMI, models and sounds removed. `query` adds own lines (e.g. `eratosthenes|portal`).

### Mod books

TFC field guide (Patchouli, with entries from 14 addons and pack KubeJS — 173 entries, 139 in Russian) and the IE
engineer's manual (133 entries, Russian only in addon sections). Layers: jar → KubeJS → resource packs, top wins. Index
built in memory in ~75 ms on first request.

| Tool | Does |
| --- | --- |
| `books_list(book, category, lang)` | books; with `book` — table of contents with entry ids |
| `book_search(query*, book, category, lang)` | full-text search (Russian words by stem: «крица» finds «крицы») |
| `book_entry(id*, book, lang)` | entry as readable text: no markup, recipes with pack status, climate and settings substituted |

Not indexed: IE entries built by code (deposits, shaders) and Ponder scenes.

### Blocks, entities, loot

The item library is items only. Blocks without items, entities, fluids, effects are found via translations.

| Tool | Does |
| --- | --- |
| `lang_search(query*, kind, mod)` | ru/en translations of all jars, vanilla, KubeJS and resource packs (~53k keys): entry kind, id, mod |
| `block_get(id*)` | block: names, whether it has an item, block tags, blockstate and models, drops |
| `loot_for(id*, kind, raw)` | loot table of a block, entity, chest: pools, counts, conditions, NeoForge global modifiers |
| `loot_sources(item*, kind)` | where an item drops from: directly, via tag, nested table, modifier |

Tables from `kubejs/data` override mod files with the same path.

### Client resources: models, textures, checks

The Minecraft client can't run from MCP (no display), so what it does with resources at load time is reimplemented
here. Resources are resolved by layer as in game (first that has the file): pack resource packs → KubeJS assets → addon
folders `tools/<mod>/src/main/resources` (fresher than their jars) → mod jars → Minecraft and NeoForge.

| Tool | Does |
| --- | --- |
| `model_render(id*, kind, state, view, size, addon, texture, bones, silhouette)` | **PNG image**: blockstate → variant → model with `parent` → 3D under `display.gui` rotation (or top/side view); `item/generated` items — by layers; GeckoLib model (`kind=geo` or id `ns:geo/….geo.json`) with `texture=`. Text: model chain (GeckoLib — bone tree with cube counts), where each texture comes from, warnings |
| `texture_get(path*, size, colors, addon)` | texture **image** (nearest-neighbour upscale) and palette: frequent colours with shares, size, animation frames, source |
| `resources_check(addon \| mod, props, filter, limit, verbose)` | check a pack mod or an addon from `tools/`: errors, warnings, info |

Renderer (`scripts/mcp/render.mjs`) — port of `tools/ee-extras-mod/art/iso.py` plus: `parent`, element rotation
(`rotation`, `rescale`), variant `x`/`y` rotation, default `uv`, face `rotation`, normal shading, translucency,
multipart. `display.gui` [x, y, z] rotation as in game (`rotationXYZ`, checked against Minecraft Wiki icons: furnace
mouth **right**, chest lock right; drawn mirrored before 2026-10-21). `tintindex` colouring only where the colour is
known from code (backpacks, fluid in buckets); grass and leaves grey; animation — first frame. Supports OBJ
(`neoforge:obj`, IE `ie_obj`, `.obj`/`.obj.ie` files; `ie_obj` has v flipped as in IE), `composite`,
`separate_transforms` (inventory view), IE `conf_sides`, Sophisticated Backpacks; models with only `overrides` — the
override at properties 0. Textures that exist only via the block atlas (`paletted_permutations` in
`assets/minecraft/atlases/blocks.json` of any mod — palette recolouring like Minecraft's `PalettedPermutations`) are
resolved too: TFC bookshelves, lumber, boats, signs by wood (`<texture>_<wood>`; `palettedTextures()` in render.mjs).

Drawn-by-code models — **registry `scripts/mcp/models/`**, one module per mod (ported from code, not checked in game).
A group module is `{ name, loaders, flat, items, objCallbacks }`: model-loader geometry, flat layered items,
`builtin/entity` items (item renderer in code) and visible OBJ groups; registered by a line in `GROUPS`
(`models/index.mjs`). The engine (`render.mjs`) calls the registry via `modelContext` and knows no mod names; a handler
that crashed or didn't recognise data after a mod update is «не умею»: the item stays a texture, the reason goes to
warnings, the build doesn't stop. Current groups:
- `minecraft.mjs` — chests, beds, shulkers, banners, heads (incl. dragon and piglin; mirrored cubes `mirror`), shield,
  conduit, decorated pot — Minecraft entity models (ModelPart tools — `scripts/mcp/entityModels.mjs`);
- `neoforge.mjs` — `composite`, `fluid_container` (fluid bucket: fluid texture and colour from mod classes,
  `scripts/mcp/fluids.mjs`; IE — texture from `FluidEntry.make("name", rl("…_still"))`);
- `tfc.mjs` — TFC wood chests, `tfc:fluid_container` (empty vessel), `tfc:trim` (armour without trim);
- `immersiveengineering.mjs` — `conf_sides`, `basic_split` multiblocks (whole `inner_model`, like an item without
  `SUBMODEL_OFFSET`), core sample `models/coresample` (stone column, front view unrotated: `getTransforms` =
  `NO_TRANSFORMS`), conveyors `models/conveyor` (`models/ieConveyor.mjs`: the item has no own model or picture — same
  `ModelConveyor` with defaults: north, horizontal, belt off, undyed, walls on; ported `getBaseConveyor`,
  `createBakedQuad/Box`, splitter, extractor, vertical and redstone-panel additions, GUI rotation — `TRANSFORMATION_MAP`
  matrix → `display.gui.matrix`), potion bucket `potion_bucket` (empty potion colour), tools (`ie_obj` with
  `callbacks`) — visible OBJ groups from `*Callbacks.shouldRenderGroup`;
- `functionalstorage.mjs` — drawers (block model rotated per `DrawerISTER`), framed (`framedblock` without decoration —
  child models); `computercraft.mjs` — turtle without upgrades; `sophisticatedbackpacks.mjs` — backpack;
  `cuisinedelight.mjs` — skillet (separate model `item/cuisine_skillet_base`);
- `create_submarine.mjs` — barometer-aquarium: block model + sand, stone and kelp (vanilla block models with the
  renderer pose — part field `affine`), pufferfish `PufferfishSmallModel` at rest, water (`water_still`, water tint,
  translucent); fish bobbing at t = 0.

**Empty items.** An item without data is drawn as JEI shows it — without contents: Functional Storage drawers without
items, Cuisine Delight skillet without food, IE core sample without minerals (stone), backpack without upgrades. A filled
TFC pan (`pan/filled`) isn't drawn at all — it exists only in hand while panning, always with contents; hidden on the
site (below). Not ported (stays a texture): IE feedthrough insulator (`feedthrough` — base block + connector models by
wire type).

**Hidden items** (`scripts/mods/visibility/`, field `h` in `items.json` — the reason): present in jar resources but not
visible to players. One rule module per mod from its code: Create Connected — `FeatureToggle.addCondition` conditions
(lambda bytecode, `Mods.X.isLoaded()` → is the mod installed; name from `REGISTRATE.block/item`, loop-concatenated →
template), TFC — `SelfTests.technicalItemsWithNoTab` (ore pan, snow and ice piles, bloom, melt, light, poured glass,
stone anvils). Site and MCP hide them from search; by id they're still found (schematic icons, recipes), `item_get`
gives the reason. A failing or stale rule — warning in the `npm run mods` log, not a stop.

**GeckoLib** models (`scripts/mcp/geoModels.mjs`): `assets/<ns>/geo/*.geo.json` (Bedrock 1.12+,
`minecraft:geometry[0].bones[].cubes[]`) — port of GeckoLib 4.8.3 `BakedModelFactory.Builtin`, `VertexSet`,
`GeoQuad.build` and `RenderUtil`: x mirrored, bone and cube `pivot`/`rotation` (order Z, Y, X), cube or bone
`inflate`, cube `mirror`, per-face UV (`uv`/`uv_size`, negative `uv_size` mirrors, `uv_rotation`) and box UV
(`uv: [u, v]`). Pose — rest from the file, no animations. The model faces south like entities and armour in game (180°
Y): `view=south` — front (file `north` face is the front), `gui` — from above, front and the model's right side.
- `id`: `miner_tools:geo/miner_helmet.geo.json`, `miner_tools:geo/miner_helmet` or `miner_tools:miner_helmet` with
  `kind=geo`; no file — list of GeckoLib models in that namespace.
- `texture`: `ns:textures/….png`, `assets/ns/textures/….png` or `ns:entity/x`. Without it — search by model name in
  `<geo subfolder>/`, `entity/`, `models/armor/`, `armor/`, `item/`, `block/` (preferring a matching UV size).
- Armour (GeckoLib template bones `armorHead`, `armorBody`, `armorLeftArm`…): at rest placed where the player parts are
  (`GeoArmorRenderer.applyBaseTransformations`), over a translucent player silhouette for scale: `silhouette=auto`
  (parts under armour bones with cubes), `all`, `none`. `bones=armorHead` — only these bones.
- Text: bone tree with cubes, total cubes and faces, warnings — UV outside the sheet, faces on fully transparent texture
  areas (invisible in game), texture proportions differ from the sheet, missing texture.
- Verified: Miner Tools helmet (`texture=miner_tools:textures/models/armor/miner_helmet.png`,
  `addon=tools/miner-tools-mod`) and a control model with a marked texture (head box UV — face front, mark top-left,
  right side from the west, like a player skin; negative `uv_size`). No other GeckoLib models in pack jars (2026-10-22:
  GeckoLib is there for the helmet; all 237 jars checked).

Edges are anti-aliased: the model is drawn 4× larger and averaged (alpha by coverage), faces include edges plus half a
pixel, so seams have no gaps; texture pixels are nearest as in game. `item/generated` — flat texture upscaled by an
integer factor, centred.

The same code is the **only icon generator** for addons (`tools/<mod>/icons/*.png` → site, addon release):

```bash
node scripts/mcp/render.mjs tools/ee-extras-mod ee_extras:four_core_termination ee_extras:four_core_cable_spool --out out/icons --size 256
```

First argument — addon folder (or a folder with `assets/`), then ids; file — `<id path, "/" → "_">.png`. Default
`--kind icon` (as in inventory: item model, else block), also `--state`, `--view`, `--aa` (1 — no AA). Foreign `parent`
and textures come from pack jars and Minecraft. Exit code 1 if something didn't render; warnings under the file line.

`resources_check` verifies:

- a block has a blockstate; its properties and values exist on the block; every property combination finds a variant.
  Properties from bytecode: `createBlockStateDefinition` of the class and ancestors (incl. EE and Minecraft classes),
  values from `<clinit>` (`BooleanProperty`, `IntegerProperty`, `DirectionProperty`, `EnumProperty` with
  `getSerializedName`). A property from an instance method or field (`getFluidProperty()` in TFC) — honestly «не
  разобрано», and then the blockstate isn't checked;
- block ↔ class — from registrations in code (`DeferredRegister.register`, Registrate `block/item`, a mod's own
  `register(…)` with a lambda); loop ids — by a single candidate class;
- models and `parent` exist (a foreign namespace of a mod not in the pack — warning), textures exist, `#…` variables are
  set, element coordinates within −16…32, angles −45…45 in 22.5 steps, block models have `particle`; unreferenced models
  — info (templates for children);
- an item has a model; names `block.<ns>.<id>` / `item.<ns>.<id>` ("/" → ".") and translation keys from code strings
  exist in `en_us` (missing — error) and `ru_ru` (missing — error for an addon: players see ru_ru; warning for a mod
  from pack jars). A key from code is:
  - a string passed as the first argument to `Component.translatable*`, `I18n.get/exists`, `new TranslatableContents`
    — with any prefix (`miner_belt.on`): a direct `ldc` before the call or several `ldc`s in a row (ternary branches
    `on ? "a.on" : "a.off"` converge on one call); for `translatable(key, Object...)` the key is before `anewarray`,
    string args aren't confused with the key. A key not in the mod's translations is looked up in another mod's or
    Minecraft's `en_us` (nowhere — warning for an addon);
  - any string prefixed `block.<ns>.`, `item.<ns>.`, `<ns>.`;
  - a string starting with the first segment of the mod's own keys (`miner_belt.` from its `en_us`), not passed to
    `translatable` directly (field, parameter): present in `en_us` — counted, absent — info (may not be a key).

  Keys built by code (`key + ".tooltip"`, `"ns.cable." + x`) — only counted. The «проверено» line lists all checked keys
  (incl. names) and how many came from code;
- `PartialModel.of(…)` points to an existing model; blocks have a loot table (except fluids).

For an addon it uses `src/main/resources` and `build/classes/java/main` (without compiled classes — resources only); an
older build of the same addon among pack jars doesn't substitute files. Verified on EE Extras (no errors; on a copy with a
removed blockstate variant, translation key and texture — all found), EE 1.1.2 and TFC 4.2.9 (~15 s). Miner Tools
1.0.0: 16 keys (15 from code, all via `translatable`, half via ternaries), no errors; without `miner_belt.gui.any.off`
in `ru_ru` — an error with the code location (`BeltScreen.updateLabels`).

`model_render` and `texture_get` take addon resources from `tools/` of the main checkout. Editing an addon in a git
worktree — pass `addon=<path to the mod folder>` (or a name in `tools/`): its resources become the first layer instead
of the same-named `tools/` folder; the layer is labelled with that path in the answer.

### World map

Projection — the same `src/lib/projection.ts` as the site. Climate reimplemented from TFC Real World 4.1.4 and TFC
4.2.9 bytecode (including how Java reads greyscale maps). Scale, profile and spawn — from the server config.

| Tool | Does |
| --- | --- |
| `map_point(x, z, lat, lon, text, y)` | block ↔ lat/lon (also accepts an F3 line), nearest cities, land/sea, average TFC climate, altitude correction, distance from spawn |
| `map_rocks(x, z, lat, lon, text)` | possible rocks at each depth with shares, ore veins in them |
| `map_find(query*)` | city, country or region → lat/lon and block; for a country — its cities |
| `map_regions(x1, z1, x2, z2, x, z, radius, text, dim, kinds, world)` | block rectangle → `r.X.Z.mca` files (`region`, `entities`, `poi`) in the dimension folder (`DIM-1` — nether, `DIM1` — end, `dimensions/<ns>/…`) and PowerShell commands: list, copy, delete (delete commented out); an `ls` line for the server |

The world seed picks the exact rock, so `map_rocks` gives options, not an answer. The mod data has no country borders:
a region is named by the nearest city. Climate and rocks not compared with the game.

### Reference guides

| Tool | Does |
| --- | --- |
| `guides_list(section, query)` | guides: id, title, section, verified flag, editors |
| `guide_search(query*, section)` | search guide text |
| `guide_get(id*)` | guide in `npm run guides` format and its `revision` |
| `guide_put(id*, markdown*, baseRevision*)` | **write to the shared DB**: signed `Claude`, version goes to history |

`guide_put` refuses if the article changed after `guide_get` (Firestore precondition on `updateTime`); for a new article
`baseRevision` is `"new"`.

### Pack addons

| Tool | Does |
| --- | --- |
| `addons_list(root)` | addon cards `tools/*/addon.json`: version, folder, side, blocks; flags source/jar/site version mismatch, missing page |
| `addon_check(id*, root)` | release check: card vs `gradle.properties`/`build.sh` and jar (modId, version, items, sha256), version record in `addonVersions` (changelog, status, jar uploaded and matching), block ids, recipes, `icons/`, site page `addon-<mod>` (section, `::addon-block` widgets, version mentioned, jar items not described), deployed version |
| `addon_versions(id*, full, root)` | versions of an addon (Firestore `addonVersions`): date, status, checked, jar on the pack server, changelog missing; `full` — with changelogs. One read per version |
| `addon_version_get(id*, version*)` | one version: changelog, checkedNote, revision |
| `addon_version_put(id*, version*, baseRevision*, changelog, status, checked, checkedNote, date, jar)` | create (`"new"`) or edit a version (signed Claude, revision kept); `jar` — local path, records file/sha256/size (the file itself goes up with `npm run tfc -- admin addon upload`) |

`root` — repo root to read cards from (a git worktree with the new release); default — main checkout. The page itself
is a guide: `guide_get addon-<mod>` → `guide_put`. Reads: one Firestore document per addon plus `/addons/index.json`
from the site. Release steps — skill `addon-release`.

### Site content: tasks, plan docs, datapacks, schematics

Each answer states how many Firestore reads it cost. Lists are read with a field mask and cached for minutes; a full
document is a separate request. uids, cookies and tokens never appear in answers. Only tasks and plan docs are written
(author and `updatedBy` — `Claude`); datapacks, scripts and schematics are read-only.

| Tool | Does |
| --- | --- |
| `tasks_list(query, status, assignee, group)` / `task_get(id*, doc_chars)` | tasks and groups; a task with checklist, attachments (no content), docs, site link and `revision` |
| `groups_list(query)` | task groups: id, name, icon, order — find a group by name («фиксы») |
| `task_create(title*, description, group, priority, status, checklist, icon, assignee, place)` | **write**: a task as from «Новая задача» (rating 1000, `completedAt` when `done`); `group` — id or name; `checklist` — strings, `{ text, done }` or resources `{ itemId, qty, got }` (item checked against the library) |
| `task_update(id*, baseRevision*, …task_create fields, checklist_add)` | **write**: only passed fields change; `checklist` replaces the checklist (existing item ids kept), `checklist_add` appends; a status change sets/clears `completedAt`; `"-"` clears group, icon, assignee |
| `artifacts_list(query, task)` / `artifact_get(id*, offset, limit)` | plan docs (`artifacts`): list by title and task (`"-"` — unattached); doc by lines and its `revision` |
| `artifact_put(id, baseRevision, title, content, task)` | **write**: without `id` — new doc («План: <task>» if no title), with `id` — edit passed fields; `content` — whole text |
| `datapacks_list(query, install)` / `datapack_get(id*, path)` | datapacks; zip file as the site builds it |
| `kubejs_site_list(query, install)` / `kubejs_site_get(id*)` | KubeJS scripts added on the site (not pack scripts) |
| `schematics_list(query)` / `schematic_get(id*)` | Create schematics: size, blocks, replacements |

`task_update` and `artifact_put` with `id` refuse if the task/doc changed after `task_get`/`artifact_get`:
`baseRevision` is their `revision` (Firestore `updateTime`; checked before writing and as the write's precondition). The
site also changes task revisions — e.g. the «Что важнее?» comparison edits the rating; on refusal re-read and retry.
There's no delete: remove temporary records from tests with a one-off script via `scripts/firestore-rest.mjs`. Repo
plans (`docs/plans/*.md`) have no tool — they're plain files, read them directly.

## Limits

- Answers are capped at 20 000 chars: longer ones are cut with «сузьте запрос».
- Firestore free tier — 50k reads/day for everyone. Configs cached 5 min, guides 1, pack updates 10, site content lists
  3. Don't call site-content tools in a loop.
- First recipe request — 1–3 s (catalogue load), then tens of ms.
- `resources_check` of a big mod (TFC) ~15 s, an addon < 1 s; `model_render` — fractions of a second.

## Code layout

```
scripts/mcp/
  server.mjs        MCP protocol over stdio; answers to stdout, log to stderr
  tools.mjs         base tools (items, recipes, tags, reference, guides, jars), the combined list and INSTRUCTIONS
  fmt.mjs           shared: page (paging), clip, named/nameOf (id with name), words/norm, schemas str/num/paging
  data.mjs          public/ data: merging mods and KubeJS as on the site; cache by file mtime
  jars.mjs          jar listing and reading without unzipping (nested, Minecraft + NeoForge), javap
  bytecode.mjs      .class parsing: annotations, line numbers, locals, exception handlers, instruction refs, signatures
  code-index.mjs    class index, mixin targets, neoforge.mods.toml (own mini-TOML), Maven/FML versions
  (candidates)      jars.mjs `candidate:` ids, code-index.mjs `candidateIndex`, tools/candidates.mjs `candidate_get`
  firestore.mjs     Firestore REST: api, listAll, cached; configs, config edits, guides
  site-datapacks.mjs  site datapacks as a recipe layer (recipes(site) in data.mjs)
  resources.mjs     client resource layers (resource packs, KubeJS, addons, jars, Minecraft), model with parent
  render.mjs        model rasteriser to PNG (model_render, texture_get) and CLI icon generator
  entityModels.mjs  entity model tools (ModelPart, pose); geoModels.mjs — GeckoLib models (.geo.json)
  models/           drawn-by-code registry, one module per mod (index.mjs — GROUPS; minecraft, neoforge, tfc,
                      immersiveengineering + ieConveyor, functionalstorage, computercraft, sophisticatedbackpacks,
                      cuisinedelight, create_submarine)
  tools/<section>.mjs  section tools: code (classes, mixins, decompile, deps), disasm (bytecode), logs, config (config_get,
                      config_propose, config_changes), pack, kubejs, books (+books-index), blocks (+blocks-data), site
                      (tasks, groups, plan docs with writes; datapacks, schematics, site scripts), map (+map-climate,
                      map-png — PNG read/write), resources (model_render, texture_get, resources_check), addons
                      (addons_list, addon_check, addon_versions, addon_version_get/put), candidates (candidate_get)
```

Data merging repeats the site (`src/lib/items.ts`, `recipes.ts`, `tags.ts`, `reference.ts`, `meals.ts`) — those modules
pull React and fetch. Import-free modules (`recipeFilter.ts`, `recipeRefs.ts`, `projection.ts`) are imported directly.
Changed merging on the site — change `data.mjs` too.

### Adding a tool

1. New section — file `scripts/mcp/tools/<section>.mjs` with `export const TOOLS = [{ name, description, inputSchema,
   handler }]` and an import line in `tools.mjs` (the `TOOLS` list at the end). A tool in an existing section — into its
   file.
2. `handler(args)` returns text (may be `async`) or `{ text, images: [PNG Buffer] }` — images go out as MCP `image`
   content. Lists — via `page(list, args, fmt)`, item ids — via `named(id)`. Input error — `throw new Error('…')`: the
   server returns it as `isError`.
3. Tool and parameter descriptions in English (short: what it returns and where the data comes from); answer
   text in Russian. Keep Russian UI labels and values the tool matches («дальше», «ставить») verbatim.
4. Verify with a scratchpad node script that starts `server.mjs`, sends `initialize`, `tools/list` and calls, and
   compares answers with direct reads of files, jars or Firestore. Then `npx oxlint scripts/mcp` and
   `npx prettier --write` on your files.
5. Firestore writes from MCP: only `guide_put`, `task_update`, `artifact_put` (with revision check), `task_create` and
   `config_propose` / `config_changes cancel=…` (own collection `configChanges`, host applies files). A new write needs
   the same protection against overwriting others.
6. List the new tool in this file (with parameters); if it changes the agent's usual path (like `log_analyze` for
   crashes) — also in `INSTRUCTIONS` in `tools.mjs` and the MCP paragraph of `AGENTS.md`.

## What's next

- Wishlist of new tools (EE devices, block capabilities, Ponder, recipe conflicts, addon server runs; priority ① done) —
  [plans/mcp-next.md](plans/mcp-next.md).
- Moving to the pack server (HTTP instead of stdio) so MCP works from any device without jars and `public/` — stage 4 of
  [plans/pack-cli.md](plans/pack-cli.md). Tools don't depend on transport; paths are already env-configurable.
- World generation (what spawns where) isn't indexed: in TFC it depends on climate and rocks; without running the mod
  the answer would be inaccurate.
