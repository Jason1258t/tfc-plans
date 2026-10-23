# State: site sections

Part of [STATE.md](../STATE.md). Everything here is deployed. UI labels are quoted in Russian as they appear in the code.

## Structure (reworked 2026-10-13)

- Header: Задачи · Документы (file storage) · Схемы · Датапаки · Справочник; on the right — pack-update bell.
- Markdown plans (formerly «Документы») are the «Планы» section of the tasks page (`/?view=docs`, left, above groups).
- Datapacks, recipes and tags are one section with a tab chooser on the left (`/datapacks`, `/recipes`, `/tags` unchanged).
- Map is a reference tab (`/reference?tab=map`). Full-page doc — `/doc/{id}` (old `/docs/{id}` and `/map?x=…` redirect).

## Documents (file storage)

`/docs` (`/files` points there): whole storage in one list — search by name, author, task and schematic, filter by
kind, upload without a task, download, delete (schematic-library sources cannot be deleted from here).

## Tasks and plans

- Tasks: list, priority, Elo comparison, groups (drag in the left list to reorder — writes `order`; desktop only, HTML5 DnD), resource checklist, attachments and gallery, place on the map.
- Plans (Markdown docs) with items and a Gemini agent; `- [ ]` checkboxes toggle by click in view mode (plans and task
  descriptions).

## Create schematics (.nbt)

- Block replacement manually / by rules / by agent, removing a block, id check against the library, importing
  materials into a task checklist, shared **schematic library** (source + replacements + shape).
- Layout (2026-10-21): sticky toolbar above the block list (smart replace + «Применить», favourites + «Подставить»,
  filter); smart-replace and favourites panels collapse (one open, remembered); shape is behind the «Форма» button.
- Block list order (2026-10-22): blocks missing from the pack library (not air) and without a replacement go first,
  removed ones last; checked in the browser on a test schematic with a fake block.
- Shape on download: crop to outermost blocks, margins (sides/bottom/top), «очистить пространство» = explicit air in
  all free cells (not for multi-palette schematics, up to 2M cells). Platform: N layers of a chosen block under the
  schematic (below the bottom margin); «пустая» — solid top layer, below only the perimeter without a floor.
- **Favourite replacements** (`replaceFavorites`, shared): ★ on a replacement, smart completion — stairs/slabs/fences
  by name `<base>_<kind>` (`lib/replaceFavorites.ts`), batch apply with a choice when a block has several variants.
  Not checked in game.
- **Layer editor** («Слои», 2026-10-19, `components/SchematicLayers.tsx`, `lib/schematicEdit.ts`): top view of one
  layer with icons and facing arrows, wheel zoom, drag pan, ↑↓ layers, layer below shown pale; LMB — replace (this
  block / same on layer / global), RMB drag — remove; Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo (physical key, works in
  Russian layout; global replacements from the dialog are undoable too). **Selection** (2026-10-22, item 1 of task
  «Улучшения редактора схем крупные»): a set of block indices shared by the layer view and 3D, dropped on any
  schematic edit; entry points so far — «Выделить» / «Выделить группу» in the cell dialog (group = edge-connected
  blocks of the same effective id on the layer, `connectedGroup` in `lib/schematicEdit.ts`, can also search in 3D);
  panel «Выбрано N блоков» (top right): replace / «Убрать» as one undoable edit, «Сбросить», Esc clears. 3D shows
  selected blocks as translucent accent cubes (respects the slice). Browser-tested on a library schematic (group of 36,
  remove, replace, undo, 3D highlight on the slice); nothing saved to the library. Layer view clicks (item 2):
  double-click — select the group (replaces the selection), Shift+click / Shift+double-click — add the block / group,
  Ctrl/Cmd+click — remove; click on an empty cell closes the dialog, else clears the selection; plain click still opens
  the dialog. Browser-tested (36 → 72 → 71 → 72, empty-click behaviour). Area (item 3): Shift+drag — dashed frame adds the
  layer's blocks inside it (explicit air skipped); the frame may go past the edge; plain drag still pans. Shift is a
  **toggle** (user's wish, no Ctrl/Cmd variants): Shift+click on a selected block unselects it, Shift+double-click
  unselects the group if the block was selected before, a frame whose blocks are all selected turns red and unselects
  them. Toggle tested with synthetic events: 1→0, frame 84→0, group 19→0. **3D picking** (item 4): raycast against the
  schematic mesh (hit point nudged 0.01 along the ray, floored → block cell); click — select the block, double-click —
  volume group, Shift — toggle, click past the model — clear; hover shows a wire box and the same block tooltip as the
  layer view. Groups (layer and 3D) count face, edge and corner neighbours — curved shells step diagonally (airship
  envelope: 106 face-connected → 3904 with diagonals). Browser-tested on cargoairship: group 3904, Shift −1/+1, clear,
  remove (7250→3346 blocks) and undo. Delete / Backspace removes the selection (one undoable
  edit; ignored while typing in a field) — browser-tested in 3D: 3904 removed, Ctrl+Z restored. Item 5 (3D «object» by frame) postponed by the user. Gotcha: after HMR the 3D
  view kept the old instance without listeners — reload the page when testing 3D changes. Tested with synthetic pointer events
  (the browser tool can't hold Shift while dragging): +80, −11, +50 → replace 119 with stone, undo. Next: picking in 3D. Cell edits change the source itself:
  «В библиотеку» uploads a new file and deletes the old one (saving edits to the library not browser-tested — shared
  collection). Adding blocks into empty cells is not supported.
- **3D** («Слой / 3D», 2026-10-19, three.js as a separate chunk): simplified block shapes (`lib/schematicMesh.ts` —
  slabs, stairs, trapdoors, doors, fences, walls, panes, Create shafts and cogs, small stuff as cubes), hidden faces
  skipped, textures from an `/icons` atlas (block texture by id path, else item icon) or average colour; slice at the
  current layer.
- **Library preview** (`lib/schematicRender.ts`): on save the browser draws a 480×320 webp (~15–20 KB) with
  replacements into the `preview` field (rule: ≤300k chars); old records have a «нарисовать превью» button. Tested in
  the browser on two library schematics (8.6k blocks → 27k faces, 80 ms); saving with preview via the button not
  tested. Both library schematics got previews on 2026-10-19.
- Library is a plain list; clicking opens a right panel: preview (draw/redraw), title and description (Markdown,
  `description` ≤ 4000 chars), edited in place, saved on blur.

## Datapacks, KubeJS scripts, recipes, tags

- **Datapacks**: template / replace / remove recipes, arbitrary files, zip, «К задаче», «Сохранить как файл» (zip in
  Documents without a task, replaces a file with the same name), checks (stale source, missing items, **«KubeJS
  удалит»**), export as a KubeJS script. «Ставить в мир» flag (`install`, «в мир» badge) — for the `tfc` app; test
  packs are not flagged. Files are built by `src/lib/datapackFiles.ts`, shared with Node (2026-10-20).
- **KubeJS scripts** (`kubejsScripts`, list under datapacks, 2026-10-20): file name, text, «Ставить на сервер»; edit,
  download, delete; the «KubeJS удалит» builder saves a script via «На сайт». Installed by `tfc pull kubejs`
  (datapacks — `tfc pull datapacks`, schematics — `tfc pull schematics`). Schematic replacements and shape — shared
  Node module `src/lib/schematicFile.ts`.
- **Recipes**: full catalogue without limit, statuses including KubeJS, **builder** to work around removals.
- **Tags**: members by mod and KubeJS, search by id and content, datapack edit editor (add / remove / replace). The
  `remove` format was not checked against NeoForge code or in game. Tag kind is a coloured label (items / blocks /
  fluids / entities); same id in another kind links to it. Datapack check warns when a recipe references a tag absent
  from items and fluids (block tag or non-existent) — the slot would be empty in game.

## Reference

- Tabs: Руды · Топливо · Металлы · Еда · Ботаника · Карта (+ Мультиблоки, Электричество, Гайды below).
- Metals and food respect the pack datapack (`kubejs/data`): a record with the same id replaces mod data (aluminium
  1550 °C instead of 1740), metals table shows a «kubejs/data» badge.
- Ore smelting and chains are recomputed by `npm run kubejs` from recipes that remain in game (mods + `kubejs/data` −
  KubeJS removals + script additions; input/output replacements and tag edits by scripts are not counted). All 48
  graded ores smelt directly, 10/20/30 mB (`ore.js`); the old powder chains on the site were wrong.
- `event.recipes.tfc.heating(...)` from scripts is parsed fully (ingredient, temperature, fluid) per the schema in the
  KubeJS TFC jar; other mod helpers — still without full JSON.
- Pack oddity: aluminium as a metal is 1550 °C (`fluid_heat`), bauxite melts by recipe at 650 °C
  (`metal_temperature.aluminum` in `const/tfc.js`).
- Fuel is one tab with sub-sections: solid (no wood) and liquid with oil (`?tab=fuel&sub=liquid`; old `tab=liquid`
  redirects).
- Food section closed (`docs/plans/food.md`): products, composite meals with calculators, cooked meals by method.
  Leftovers listed in the plan («Сознательно не сделано»).

### Botany

Reference tab, side menu: crops / bushes / trees. Climate ranges, fruits and seeds, T/humidity filter; from mod code —
N/P/K use, crop type, monthly season calendar, sapling growth, ripening time (growth multiplier from server config),
month length from the world save, crop yield from loot tables, where the plant spawns naturally, fruit per harvest,
server sapling timings, calendar in game hours, light and soils, where the harvest goes (without composite meals),
death of overripe crops. «Теплица» sub-tab (Firmalife): 63 plants, bed, wall material by tier, fertilisers. Grapes:
seasons, growth speed and harvest quality conditions from code. Greenhouse ripening time. Card redesigned: range bars,
fertiliser blocks, calendar with month labels. `.class` parsing — `scripts/mods/classfile.mjs`. Remaining —
`docs/plans/botany.md`.

### Multiblocks (2026-10-19)

- `?tab=multiblocks&mb=<name>`: 24 IE structures and 4 Advanced TFC Tech from jar templates
  (`scripts/mods/multiblocks.mjs` → `public/multiblocks.json`, `public/multiblocks/*.nbt`).
- 3D view (CSS 3D, mouse rotate) and top layer view with slider, mirrored variant, hammer-strike block (from code,
  checked against book text for crusher and excavator), materials with IE tag substitutes (scaffolding, sheet metal,
  storage; hopper and tank — any sheet metal), energy use from `power.json`, recipe links, book text (IE — English as
  in game; Advanced TFC Tech and TFC-IE Crossover — Russian), .nbt download. Arc furnace — TFC-IE Crossover variant
  (TFC fire bricks). **Not checked in game**, including loading .nbt into Create.
- «Постройка | Итог» toggle: finished-machine model from jar (OBJ + textures, three.js,
  `scripts/mods/multiblock-models.mjs`), aligned with the build cells (exact for all 27). Missing for the excavator
  bucket (drawn by code); moving parts not shown; animated textures — first frame.
- Guides section «Мультиблоки» (`?tab=guides&sub=multiblocks`, `section: multiblocks`): widget `::multiblock id=…
  [full] [materials]`; articles mb-assembly, mb-tfc (what changed: arc furnace from fire bricks, IE blast bricks not
  craftable in the pack, smelter via KubeJS), mb-coke-oven, mb-excavator.
- Since 2026-10-19 group «Добыча Create» (Create Ore Excavation): coe-prospecting — veins (chunk, «one per square»,
  infinite, Chinese names from the pack script), detector, atlas, sampling drill, table of all veins; coe-drilling —
  setup, iron drill suffices, 30 rpm steps, 256 SU per rpm, calculator. From mod code and pack scripts, not checked in
  game. Noticed: the gem vein drops all 7 gems per cycle (script expects «one of seven»); the script removes the water
  vein — the pump rig is useless.

### Electricity (started 2026-10-14, plan — `docs/plans/electricity.md`)

- How Create (SU), Electro Energetics (V/A/W) and IE (FE/t) relate: conversion rates and calculators for generator,
  motor, W ↔ FE; EE loads under voltage and device limits; IE wires and generators. Formulas and defaults from bytecode
  (`scripts/mods/power.mjs` → `public/power.json`), settings from server config («сервер» badge on changed ones).
- EE generator: stator = 3 «magnets» for the rotor, 144 W per rpm, shaft pays ≈ 1 SU per 1 W (+6 SU/rpm per rotor) —
  verified on the dev server (`/rectest gen`). The old «8 W per SU, loop in profit» was a parsing error, fixed
  2026-10-14: generator → motor loop loses ~21 %.
- Rectifiers (and any EE diode bridge) on a generator are unstable at `simulation.microTicks = 1` (server): the diode is
  linearised from the previous solve. Verified on the dev server; site guide about the pump. Solved by the addon
  (diode-free rectifiers, now EE Extras).
- EE diode above ~9 mA — 0.8 V + ~5.6 Ω (code + simulation); pump guide fixed (used to say «~1 V»).

## Guides

- Since 2026-10-16 a separate reference tab «Гайды» (`?tab=guides`), sections «Электричество», «Аддоны»
  (`&sub=addons`, same articles as on `/addons`), «Мультиблоки», «О сайте»; old URLs redirect.
- Section `addon` (2026-10-22) — addon pages `/addons/<mod>` (guide id `addon-<mod>`), not listed under «Гайды»;
  see [addons.md](addons.md).
- Since 2026-10-15 articles live in Firestore `guides`, editable on the site by anyone, with revision history;
  calculators are described in the article as ```calc blocks, see [docs/plans/guides.md](../plans/guides.md);
  `npm run guides -- pull|push` — files ↔ database.
- Electricity articles: first generator (assembly, stator orientation, sizing calculator); optimal generator mode
  (load model from code, checked on dev server; ~100 A optimum; sizing and check calculators, load set from IE
  machines); «Сеть IE» tab — IE and Advanced TFC Tech consumer tables (multiblocks by pack recipes, devices by config);
  rectification (who needs DC, schemes, EE diodes and microTicks, rectifier calculator); AC pump (pump speed by
  ticks); long-distance line (wires with allowed current, transformers, grounding, line calculator); EE ↔ IE
  (converter: FE only through the back face, pulls/pushes itself, limit U²/20, IE connector, calculator); electric
  motor (U²/R SU headroom at any rpm, «🔓» mode, idle ≈ 21 % of draw; on raw AC with microTicks = 1 the SU headroom
  wobbles — averaged over only 3 solves); heater (Create basin — heated only, Farmer's Delight; always 45 Ω in the grid
  but heats by setting — server 15 Ω makes it 3× «hotter» than it draws); battery (cell 24 V / 0.1 Ω / 10 Ah ≈ 214 Wh,
  calculator; vs IE capacitors — HV ≈ 1333 Wh per block vs ≈ 428, but via converter); protection (fuse and breaker
  heat like a wire: rating below the wire's continuous current; breaker also trips instantly above 5× rating; arc on
  break above 1000 V); «Горят провода у генератора» (`wire-burn`: generator 100 A at full load, up to 200 A when
  overloaded, insulated copper burns from 121 A; second cause — lower-voltage consumers without a step-down
  transformer). Not checked in game.
- «Аддоны» has two sub-sections: «Аддоны сборки» and «Как написать свой» — six from-scratch articles for programmers
  who never wrote mods (jar and loading, JDK 21 + IDEA + MDK, first block with resources, compileOnly on jars from
  `mods/` and the TFC calendar, mixins, testing and release). Code verified with a trial MDK mod (scratchpad, not
  committed): everything compiles (with TFC 4.2.9 via compileOnly); on `runServer` the block registers and places,
  drops work, recipe loads, mixin changes the result, wrong method name with `defaultRequire: 1` crashes startup.
  Built on NeoForge 21.1.219 (maven.neoforged.net was down; 21.1.248 — pack minimum, recommended by the articles —
  didn't download), so **running together with TFC is not verified** (TFC needs ≥ 21.1.234). Client (texture,
  in-game translation) not checked. Dev environment — `~/.gradle/local-tools` (JDK 21, Gradle 8.14.3).
- «О сайте» (2026-10-19, `?tab=guides&sub=site`, section `site`): eight `site-*` articles (overview, tasks/plans/files,
  schematics, datapacks/recipes/tags, item search, reference and map, updates and addons, how to edit guides). The
  «проверено в игре» badge is hidden in this section. `[[id]]` inside code spans/blocks is shown literally, not as an
  icon — across all site Markdown.

## Onboarding hints (2026-10-19)

First visit — «Знакомство с сайтом» (header), then on first entry into each section 1–4 steps with highlighted
elements (`lib/onboarding.ts` — texts and selectors, `components/Onboarding.tsx`). Skippable (Esc, «Пропустить»),
«Больше не показывать подсказки» disables all; «?» in the header — show again, toggle, reset. Shown state — Firestore
`onboarding/{uid}` (anonymous uid, i.e. per browser) + localStorage copy. If a step's target isn't found in 2.5 s —
the step is centred.

## World map and pack updates

- TFC Real World map: projection from the mod, normal view and layers, click → coordinates, cities, distances, spawn;
  world parameters from the imported server config.
- Pack updates: a record on deploy + model-written patch notes.
- Pack freshness `/freshness` (switch «Лента обновлений / Свежесть модов» on both pages, 2026-10-22): static report
  from the build, filter by colour, search, «Перепроверить Modrinth» (live from the browser, CurseForge rows kept),
  «Скачать отчёт (JSON)». First run: 234 mods — Modrinth 175, CurseForge 54, not found 5 (hand-built: `tfcr-fixes`,
  `woodencog-…-TFCR`, `TFCBetterBlastFurnace-TFCR`, `tfc_ability_fix`, `kaleidoscopetfctavern`); red 5, orange 31,
  yellow 62. Checked in the browser (desktop + 375 px) and the recheck button. Version parsing checked on 11 cases.
  2026-10-22, third source «Гит сборки»: GitHub releases of the pack devs (`PACK_GIT` in `src/lib/freshness.ts`,
  repos from `local-mods/README.md` of github.com/GranniXXie/TerraFirmaRebirth), only for mods still not found; all
  5 hand-built jars matched (tfcr-fixes 1.7.7 → 1.7.12 yellow, other 4 current). The recheck button now rechecks
  Modrinth and git live; on a GitHub error git rows are kept from the report. Checked: script, browser, fallback with
  GitHub 403. 2026-10-22: skill `update-plan` («план обновления», `.claude/skills/update-plan/`) turns the report
  into a plan; tried on the 5 red mods (plan shown to the user; site task — see the plan doc, part 5).
- Integration analysis (2026-10-22, task «Разработать скилл для анализа сборки и интеграций», group «Разработка»):
  skill `integration-plan` (`.claude/skills/integration-plan/`) — pack inventory by MCP → candidate mod by its jar →
  overlaps with TFC/energy/Create → routes (config / KubeJS / datapack / addon / don't install) → plan doc on the
  task (someone else's report is not overwritten, a new doc «Анализ интеграции: …» is added). MCP can't read jars
  outside `mods/` — candidates are read by `unzip`/`javap` for now (skill step 7). Step 1 tried on «химия»; not yet run
  end to end on a real candidate.
