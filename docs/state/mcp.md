# State: pack MCP (`tfc-pack`) history

Part of [STATE.md](../STATE.md). What each tool does and how to add one — [docs/mcp.md](../mcp.md); wishlist —
[plans/mcp-next.md](../plans/mcp-next.md). This file only records what was verified and how.

- **2026-10-20, base** (`scripts/mcp/`, `.mcp.json`): local stdio server without deps — items, recipes with KubeJS and
  kubejs/data, tags, reference, layered configs (Firestore `config`, read-only), guides (read and `guide_put` with
  revision check — Firestore precondition on `updateTime`), jar search/read, javap. Verified by a stdio node script
  (54 checks against direct JSON, jar, javap and Firestore reads); guide writes tested only for refusals.
- **2026-10-20, +24 tools** (40 total, `scripts/mcp/tools/*.mjs`): pack overview (`mods_list`, `mod_get`,
  `pack_updates`); KubeJS sources; books (TFC manual 173 entries, 139 in Russian, with addon and KubeJS entries; IE
  manual 133, no own Russian); translations and loot (`lang_search` ~53k keys, `block_get`, `loot_for`,
  `loot_sources`, kubejs/data overrides jars); site content read-only; map (`map_point` uses `projection.ts`, climate
  reimplemented from TFC Real World 4.1.4 / TFC 4.2.9 bytecode; `map_rocks` gives rock variants with shares — the
  seed picks the exact rock; `map_find`). **Climate and rocks not compared with the game.**
- **2026-10-21, code debugging** (49 tools, `tools/code.mjs`, `logs.mjs`): index of all classes (~66k mod classes incl.
  nested jar-in-jar, + ~9.8k Minecraft/NeoForge with Mojang names from the addon build cache) in ~3.5 s;
  `class_find`/`class_info`/`class_hierarchy`, `code_refs` (~2–6 s over the pack), `mixins`, `decompile`, `jar_grep`,
  `mods_check` (FML 4 rules, checked against `ModSorter`/`VersionSupportMatrix` bytecode; 0 problems now, pack minimum
  NeoForge 21.1.248), `log_analyze`. Mixin behaviour checked against Mixin 0.8.7 bytecode. Not tested on a real player
  crash at the time.
- **2026-10-21, after the first real debugging** (51 tools): `log_analyze` handles Windows CRLF crash reports,
  Connector/Sable header, thread, mods in the stack, top-frame mixins, section details, system and mod-list diff;
  `level=timeline`. Regexes accept `(?i)`; non-regex search supports «a|b». New `event_listeners` (incl. KubeJS bridges
  like `PlayerEvents.loggedIn`, names from `<clinit>` of KubeJS event classes); `code_refs` field write/read and code
  side; ⚠ client-class references in `class_info`/`mixins target`; `map_regions`. Minecraft sources — NeoForge 21.1.251
  (`tools/rw-host-fix-mod/devserver`). Verified on three player `latest.log`s and an FTB Quests crash report.
- **2026-10-21, site datapacks in recipes + client resources** (54 tools; order ① from mcp-next): recipe tools layer
  flagged site datapacks over mods; `model_render`, `texture_get`, `resources_check`. EE Extras — no errors; a
  corrupted copy — all planted errors found.
- **2026-10-21, translation keys and worktree addons**: `resources_check` finds keys passed to `Component.translatable`
  with any prefix and via ternaries (Miner Tools: 0 → 15 from code + name); `model_render`/`texture_get` accept
  `addon=<path>`.
- **2026-10-21, tasks and plans with writes** (62 tools): `groups_list`, `task_create`, `task_update`,
  `artifacts_list`/`artifact_get`/`artifact_put`. Write shape matches the site (rating 1000, `completedAt`, checklist
  ids), signed `Claude`. Verified on temporary task and doc in prod (created, stale-revision refusal, edit, deleted);
  not opened on the site.
- **2026-10-22, GeckoLib in `model_render`**: bones and cubes as in GeckoLib 4.8.3 (checked in bytecode), armour over a
  player silhouette, bone tree, UV/transparency warnings. Miner Tools helmet renders; no other GeckoLib models in pack
  jars.
- Config edits by agent (`config_propose` → host) — see [infra.md](infra.md#agent-config-edits-2026-10-21).
- **2026-10-22, `mods_freshness`**: report from `src/lib/freshness.ts` (shared with the site), changelogs of newer
  versions (Modrinth deduped by version, CurseForge HTML → text). Verified via stdio script: filters, paging, json,
  Modrinth mod (JEI), CurseForge mods (Sophisticated Backpacks, FTB Quests), hand-built mod (`tfcr_fixes`). First call
  ~11 s while the manifest has no `cf` fingerprints (reads all jars), then cached. Same day: git source (pack devs'
  GitHub releases), changelog = release bodies; checked via stdio (`tfcr_fixes` 1.7.7 → 1.7.12 with 5 release notes,
  `woodencog` current).
- **2026-10-22, `mods_freshness deps/beta`**: `deps=true` downloads the newest jar (Modrinth file / CurseForge
  downloadUrl or CDN path / GitHub asset) into `.cache/mcp/fresh/`, reads `neoforge.mods.toml` + jar-in-jar
  (`archiveMods` in `code-index.mjs`) and checks it with `depContext` from `tools/code.mjs` (the `mods_check` logic,
  pack jar swapped for the new one) + dependents whose ranges break. Changelogs: releases only unless `beta=true`,
  oldest first, paged by version, 10 000 chars per version; Modrinth HTML (Serilum) → text; CurseForge files paged
  back to ours. Verified via stdio: World Border 5.0 needs Collective [8.40,) (pack 8.39 ✗), Liquid Fuel 3.0.0 needs
  Create [6.0.4,) (ok), Deep Seas 3.0.0→3.3.0 (4 releases; with betas 10, `offset=5` → 3.4.1), Moonlight on CurseForge
  from 2.29.8 (67 releases), Collective HTML → text; `mods_check` unchanged.
- **2026-10-22, candidate jars** (66 tools, `tools/candidates.mjs`): `candidate_get` registers a jar that is not in the
  pack (local path, Modrinth slug/version with sha1 check, or a direct Modrinth CDN / forgecdn / GitHub link; download
  only with `download=true`) into `.cache/mcp/candidates/` and summarises it: mods, license, deps via `depContext`
  (as a swap if the mod is already in the pack), jar-in-jar, content by lang keys with ru_ru, recipes by type, tags
  (pack overlap via `tags()`), worldgen/biome modifiers, `ModConfigSpec` classes, mixin targets × pack mixins.
  `jar=candidate:<file>` (and `candidate:<file>!<nested>`) works in `jar_find`/`jar_read`/`jar_grep`/`jar_javap`/
  `class_find`/`class_info`/`class_hierarchy`/`decompile`; candidate classes live in a separate index
  (`candidateIndex`), not in the pack's. Verified via stdio on Create: Power Grid 0.6.2 (Modrinth): counts match
  `unzip -l`/lang (113 recipes, 37 tags, 77 blocks, 1057 classes, 3 mixin configs / 18+5+6 mixins), deps ok against
  the pack, `decompile CThermal`, pack `class_find` doesn't see candidate classes. Going Nuclear isn't on Modrinth
  under NeoForge 1.21.1 and Destroy has no 1.21.1 NeoForge build there — for them `path=` or `url=`.
- **2026-10-23, token refresh**: `api()` in `scripts/mcp/firestore.mjs` retries once on 401 with a fresh token
  (`token({ fresh: true })` also skips the service-key cache in `firestore-rest.mjs`); before, the MCP process kept a
  revoked token for its 45-min cache (`ACCESS_TOKEN_TYPE_UNSUPPORTED` on every site tool). All MCP Firestore calls go
  through `api()`. Env `TFC_MCP_TEST_BAD_TOKEN=1` starts with a dead token — verified via stdio: `tasks_list` +
  `task_get` succeed with it.
- **2026-10-23, MCP service key**: `.mcp.json` passes `TFC_FIRESTORE_KEY` (default `~/.config/tfc/mcp-firestore.json`);
  `scripts/mcp/firestore.mjs` sets it as the process's `GOOGLE_APPLICATION_CREDENTIALS` if the file exists, else falls
  back to `firebase login` with a stderr note. Setup/explanation for humans — `scripts/mcp/firestore-key.example.md`.
  Host's key is in place.
- **2026-10-23, `bytecode`** (`tools/disasm.mjs`): compact bytecode reader instead of `javap` in a shell — after 85 past
  sessions showed ~25 shell `javap` calls a day (external jars, addon build output, classes after mixins, version
  comparison) and `decompile` of whole classes for navigation. Own instruction decoder (signed branch offsets, switch
  tables, wide); `parseClassFull` now keeps `locals` (LocalVariableTable) and `handlers`. Verified via scratchpad
  script: instruction offsets and call counts equal to `javap -c` on 377 random classes / 2814 methods (TFC, EE, IE,
  Create, KubeJS, Firmalife, Minecraft); outline/method on TFC `HeatCapability`, Minecraft `FarmBlock`/`Direction`
  (switch, loops), `tools/ee-extras-mod/build/classes` and `libs/create-*.jar`; `diff` Collective 8.39 → 8.64 (262
  classes, ~5 s; method line diff of `LivingEntityMixin.dropAllDeathLoot`). Size: one method ≈ `decompile method=`
  (−10…+25%); class outline 35–55% smaller than whole-class `decompile`. `decompile` of a truncated whole class now hints
  `method=` / `bytecode`.
- **2026-10-24, `recipe_conflicts`** (71 tools, `tools/recipes.mjs`; order ③ from mcp-next): would a new recipe be
  intercepted by an existing one of the same type — shapeless: same input set (exact bipartite matching, tags expanded
  via `tag_members`; a tag absent from the index matches nothing), shaped: same grid with mirror; same id → «заменит».
  Sources: mods, kubejs/data, KubeJS scripts, site datapacks (KubeJS removals applied). Verified via stdio: exact
  duplicate → 1 conflict, unrelated inputs → none, `#c:ingots/copper` → matches recipes using that tag, id-only lookup
  works. Skill `recipe-dev` and [recipe-canon.md](../recipe-canon.md) added in the same pass.
- **2026-10-24, Windows + инструменты тестирования аддонов** (73 tools): `decompile` чинится на Windows
  (tmpdir при пустом окружении — fallback в .cache/mcp; javaBin знает Windows/Linux пути JDK 21; rmSync с retry и
  нефатально); новый `addon_devserver` — прогон сервера разработки аддона (gradlew runServer + RCON + ошибки из
  лога) без python и test-server.sh, кросс-платформенно; `findPlatform` ищет кеш сборки аддонов ещё и в
  .claude/worktrees/_/tools/_ — ванильные модели/исходники Minecraft теперь находятся при работе в ворктри
  (resources_check/model_render/decompile). Проверено прямым вызовом: decompile даёт исходник, resources_check
  аддона — без ошибок (36 состояний блока), addon_devserver ловит падение сервера и отдаёт ошибки из лога.
- **2026-10-25, players' reports** (`tools/reports.mjs`, task BDoIffX3jFbb4laaIr5N): `reports_list` (kind/author/query,
  one runQuery on `report.source`) and `report_get` (bare id, `tfc-report:<id>` or `?report=` link → cache
  `~/.cache/tfc-plans/reports/<id>`, unzip zip/gz, `log_analyze` on the main file, `mode=text|none`, `file=`);
  `logAnalyze` exported from `tools/logs.mjs`. Verified over stdio against three uploaded test reports: list, analysis
  of a crash report and a log, raw text of a file inside a zip, 3-chunk file identical to the source; second call — 0 reads.

- Dev #125 (2026-10-29): datapack list/get show pinned pack deployment from published `kubejs.json.datapacks`,
  including snapshot ZIPs without a source card. Recipe tools exclude the entire pinned card from the live-site
  layer (later new recipe ids remain unconfirmed); ZIP recipes/data and loot respect KubeJS order. Verified via
  stdio list/get and a static pinned recipe fixture against read-only live source cards, with no Firestore writes.
- **2026-10-29, `datapack_put`** (dev #153): agents create and edit site datapacks (whole entries or upsert/remove/
  rename by path) with `baseRevision`, signed with `TFC_AGENT_NICK`; structural checks shared with the site
  (`datapackIssues`), pack checks repeat the editor's warnings; pinned-version notice. `scripts/smooth-stone-datapack.mjs`
  and `pellet-arc-datapack.mjs --upload` use the same module (and now sign with the agent nick, not git user.name);
  pellet-arc reads `public/` of the main checkout so it runs from a worktree. Verified over stdio on live Firestore
  with a temporary datapack (create, refusals on bad JSON/path and stale revision, upsert/rename/remove, dry_run,
  pinned notice via a fixture `kubejs.json`), then deleted it; scripts' `--upload` not run against Firestore.

- Dev #154 (2026-10-29): audited datapack_put (dev #153): revision CAS, author preservation, draft/pin distinction
  and cache invalidation are present. Added read-only `datapacks_inventory` (live server, optional source refresh)
  and `datapack_pack_get` (exact snapshot ZIP/files + SHA256, including legacy ZIPs without cards). Draft editing
  keeps using current `datapack_get` revision. Fixed shared path validation (`..`, empty segments), own block-tags
  masking missing item/fluid warnings, and outdated duplicate-name wording. Checks: stdio against a temporary pack
  server plus validator fixtures; no production source cards modified. Authoring guide: `docs/agents-datapacks.md`.

- **2026-11-02, dev links** (dev #194): refs in dev texts are indexed by temp triggers + a queue flushed on read, and all
  sources are re-indexed at startup; `dev_open`, `dev_link`, `dev_unlink`, `item` in `dev_note` / `dev_doc_put`, links in
  `dev_get`, clickable refs and a links block on `/dev` (`?ref=` in the page address).
- **2026-10-29, dev attachments** (dev #155): `dev_get` queries Firestore files bound to `dev:<id>`;
  `dev_file_get` returns verified local files and inline images. The dev MCP transport now supports image content.
  Verified over stdio against task #150 (WebP screenshot), an attachment-free task, ownership refusal, and
  repeated downloads from cache. No game/config changes.

- Dev #158 (2026-10-29): `log_analyze` accepts standalone KubeJS `[time] [LEVEL]` logs (including INIT and
  optional `!`), gzip and game-folder discovery in `logs/kubejs` / `kubejs/logs`. Custom recipe failures with
  the same source location and missing registry entries are grouped by cause; registry/id hints survive
  long JSON clipping. Verified through MCP stdio against #157 server.log: all 18 ERROR, groups ×16 and ×2,
  script path/line and both missing registry causes; filters, levels, timeline and existing log formats checked.

- Dev #162 (2026-10-30): Create schematics moved to `tools/schematics.mjs`. `schematics_list` searches metadata and
  block contents (ids + Russian names), gives `/schematics?id=` links (the site now opens the card from `?id=`).
  `schematic_get` reads the .nbt: palette, block positions, text layers, block-entity SNBT, root/entities, the
  downloaded (edited) file and `save=`. `schematic_render` — iso/top/layer PNG by block-model colours.
  `schematic_put` — upload (pack server, duplicate check by content hash), fields via Firestore with revision,
  cell edits → new source via the pack server. Verified over stdio on oil_pump_small/big (read, render, duplicate
  refusal, stale-revision refusal, dryRun of fields and block edits); real writes not made (no test record allowed
  in the shared library).

- Dev #174 (2026-10-31): `blockstate_check` (`tools/blockstates.mjs`) — block states against `block-models/<ns>.json`
  (variants and multipart, local `public/` or the live site, honest «нет данных» for a missing mod). Replaces the
  script download used for #166 stage checks. Verified over stdio: all 26 844 variant states of minecraft + tfc → ✓,
  wrong value / combination / missing block → ✗, waterlogged/natural → note, glass pane parts, missing mod → «нет
  данных», bad input → error; both sources (TFC_PUBLIC_DIR copy and the site).
- Dev #193 (2026-11-02): tracker log and docs without whole-text round trips — `dev_log` (pages, filters), `dev_find` (tasks, log,
  docs; JS scan, no dependencies: 3000 entries + 30 docs in about 30 ms), `dev_doc_edit`, `dev_doc_append`, `dev_doc_list`,
  `dev_doc_get heading` + outline; `dev_get` compact (5 entries, all reports, `note:<id>`). Unknown fields are errors. Verified on a
  temporary `openDev` copy through the real MCP server, then live on #193.
- **2026-11-02, dev checklists** (dev #192): checklist items moved to the `checks` table with stable per-task numbers
  (`server/pack-server/lib/dev-checks.mjs`); new tools `dev_check`, `dev_start`, `dev_finish` need no `baseRev`; the
  `tfc-plans-dev` dispatcher rejects unknown arguments. Open tasks migrated on server start (snapshot
  `dev-backup/dev-before-checks-*.db`); closed ones keep the JSON, read-only, and migrate on reopen or a `dev_check`.
  `PATCH checklist` stays for stale clients, matching by `num` or text so marks survive.
- **2026-11-05, recipe and tag gaps** (dev #235): `collectRefs` (`@tfc/core/recipeRefs`) now reads KubeJS argument strings
  «4x mod:item» and «#tag», which brought back outputs of 222 script recipes (`create:milling`, `create:cutting`,
  `tfc:quern`, `kubejs:shaped`…). `kubejs:shaped`/`kubejs:shapeless` are built as normal `pattern`/`key`/`result` JSON, so
  they get a crafting grid on the site and grid comparison in `recipe_conflicts`; `stackJson` splits a count out of the id.
  Nested jars follow `META-INF/jarjar/metadata.json` (Forgified Fabric API keeps its modules in `META-INF/jars`), adding
  `fabric-convention-tags-v2`. `recipe_conflicts` no longer crashes on a grid cell with alternatives. Verified by a
  scratch rebuild from the pack jars and the real MCP server over stdio.
- Dev #240 (2026-11-05): `scripts/mcp-call.mjs` (`npm run mcp`) — one call of a `.mcp.json` server tool from a shell with
  JSON arguments and `--timeout`, instead of temporary JSON-RPC clients (Codex in #218). Verified on both real servers
  (lists, schema, calls, unknown argument/tool, `@file`, stdin) and on a fake server: crash, missing command, hang
  (exit 124, process gone), 5 MB answer through a pipe, images, env priority.
- Dev #255 (2026-11-05): test servers stop with the process that started them (`stopWithProcess` in `mc-server.mjs`), so a
  broken MCP call no longer leaves a stand running. Not covered: SIGKILL of the MCP server itself.
- Dev #257 (2026-11-05): `addon_devserver` watches the gradle process: a failed build returns at once with the failed task,
  deduplicated javac errors and a `libs.sh` hint; a server crash = process exit or an explicit failure line, so `Exception`
  in a mixin warning no longer stops a healthy server. Verified on `ee-extras-mod` through `mcp-call`: no libs (16 s),
  boot + RCON (31 s), missing mod dependency (13 s), `timeout=10` (no processes left). Not verified: Windows.
- Dev #266 (2026-11-05): `addon_devserver` picks mods from the `cp` lines of `test-server.sh` under `env` (simple `if` on a
  variable, `else`, `$MODS`, `$OLD_JAR`); what it can't parse or run (`for` loops, `PROFILE`, datapack copies, `MICROTICKS`)
  is listed in the answer. `ee-extras-mod` devtest builds without Destroy jars. Verified on it: plain, `IE=1 TFC=1`, `CC=1`,
  `DESTROY=1 TFC=1` (`rectest petprepare` registered), `DESTROY=1` alone (missing deps shown), `OLD_JAR`; the parser dry-run
  on 8 more addons. Not verified: Windows. Not run: `destroy-bridge-mod`, `destroy-extras-mod` still need `./test-server.sh`.
- Dev #303 (2026-11-07): `schematic_print_check` — library schematics printed by the Create schematicannon on the
  whole-pack stand (KubeJS harness `scripts/mcp/print-check.kubejs.js`, from the manual one of #196), problems sorted
  by cause into the #305 status groups (ok / not_in_pack / broken / unclear) with codes, block, cells, example; JSON via
  `json`/`save`. `printCheckPrepare` + `npm run stand -- --until …` + `printCheckReport` run it on another host. The
  stand got a lock (`stand.lock`), `waitFor`/`--until`, and one retry after the mod-loading race «An uncaught parallel
  processing error». Verified on test1a (snapshot `20261106-194903-3047`, survival + restart) with «постройка» and
  oil_facory: «постройка» ok both ways; oil_facory — restart re-places and spends 380 createdeco catwalks without
  `schematic-fix`, 0 with it (as found by hand in #196); 7 entities without an item, catwalks `bottom` differs from the
  schematic either way. A stand-boot failure shows as `stand_error` with the summary. The MCP path itself (`printCheck`
  with `runStand` on the Mac) was checked only up to input errors and the lock: the Mac stand was busy with another
  session's run and has 8 GB. Not verified: `creative`, `reset`, `prefill`, `not_loaded` (#304), `lost_data` on a
  schematic that has it.
- **2026-11-13, quest book** (dev #343, `tools/quests.mjs`): `quests_list`, `quest_chapter`, `quest_chapter_put` over
  `config/ftbquests/quests` of the snapshot with an optional overlay. Verified: all 45 pack SNBT files parse and write
  back (41 byte-exact, 4 differ only by hand-made indentation in lang files, same data); all 36 chapters go
  `format=spec` → `quest_chapter_put` byte-identical with no lang change; a new chapter with refs, tags, `or()` filter,
  advancement and cross-chapter dependency written and read back; formats of item task (`count` long) and item reward
  (`count` int) checked against FTB Quests 2101.1.30 bytecode; lang storage — one file per locale (`TranslationManager`).
