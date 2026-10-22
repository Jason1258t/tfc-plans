---
name: integration-plan
description: Analyse the pack for an integration («анализ интеграции», «план интеграции») — a candidate mod to add (Going Nuclear, Destroy, Create Chemistry), mechanics to borrow from another mod into our addon (Power Grid → EE Extras), a new production branch (химия, ядерка) or a tie between pack mods (IE ↔ TFC): what the pack already has, what the candidate really contains (by jar, not by its page), overlaps and conflicts with TFC, routes (config / KubeJS / datapack / own addon / don't install), stages with checks; then a plan doc on the site task. Use for "рассмотри мод X", "что взять из X", "стоит ли добавлять X", "как вписать X в сборку", "проверь отчёт/план по интеграции".
---

# Integration analysis: pack inventory → candidate by jar → overlaps → routes → plan → site task

The result is advice and a staged plan, not an installation: the agent never adds jars to the pack. Pack file changes
go through the host (`config_propose`, `npm run tfc -- admin propose`), new jars — the host's own update
(docs/pack-server.md), own code — an addon in `tools/` (docs/addons.md) in a separate session. Nothing is checked in
game — every in-game step is marked «в игре не проверялось».

All pack facts from MCP `tfc-pack` (CLAUDE.md), candidate facts from its jar. Everything the user sees — in Russian.

## 0. Scope and inputs

Input — one of:

- **candidate mod(s)** not in the pack («стоит ли ставить Destroy»);
- **mechanics from another mod** to rebuild in our addon or KubeJS («что взять из Power Grid»);
- **a production branch** without a chosen mod («химия», «ядерка») — then candidates are part of the work;
- **a tie between pack mods** («IE и TFC металлы», «дизель и нефть») — skip step 2;
- **someone's report or plan** (often a task doc written from mod pages / a chatbot) — the job is to check its claims
  against the pack and jars and say which hold.

First `tasks_list query=<words>` (and group «Разработка» if the user points to «задачи ниже»): the task and its docs
(`task_get`, `artifacts_list task=<id>`) are the brief. Also `docs/plans/*.md` on the topic (`nuclear.md`,
`electricity.md`, …) and `docs/state/pending.md` — earlier decisions are not reopened without a reason.

Big topics (a whole chemistry branch, several candidates): agree with the user on the depth — which candidates, which
questions matter (rarity of ores, energy, danger, server load) — before reading jars.

## 1. Pack inventory for the area

What the pack already has, cheap first, one call per question:

| Question | Tool |
| --- | --- |
| mods of the area (by name/id) | `mods_list query=…`; per mod `mod_get <id>` (items, recipe types, configs) |
| items and fluids of the area (uranium, nitric acid, plastic, steam) | `items_search query=…` — English word or id first (`acid`, `uranium`); Russian matches the exact word form («кислота» misses «кислоты») |
| how they're made / used, with KubeJS status | `recipes_for` / `recipes_using` (tags with `#`) — for key items only |
| tags that tie mods (`c:ingots/…`, `c:dusts/…`, fluids) | `tag_members`, `tags_of` |
| ores, metals, smelting chains, fuels, energy formulas | `reference_get section=ores|metals|chains|fuels|liquid|power` |
| where in the world (rocks, veins) | `map_rocks`, `reference_get section=ores` |
| pack KubeJS touching it | `kubejs_search query="<id1>|<id2>|…" context=0` — one regex |
| site datapacks / site KubeJS | `datapacks_list`, `kubejs_site_list` once each |
| our addons | `addons_list` once; `docs/state/addons.md` |
| configs that switch features (worldgen, explosions) | `config_get mod=<id>` |
| players' guides on the topic | `guide_search query=…` |
| code-level: who implements an API, event, capability | `class_find`, `class_hierarchy`, `code_refs`, `event_listeners` |

Write down what's **missing** (no consumer for uranium, no acid, no plastic) — that's what the integration is for —
and what's **already there** (a second radiation, a second electricity model, a second steel would duplicate it).

## 2. The candidate — by jar

Pages, changelogs and reports say what the author or a chatbot claims; the plan relies on the jar.

1. **Ask before downloading** (CLAUDE.md safety: name the file, source, size). Official source only: Modrinth /
   CurseForge / the author's GitHub release, the build for NeoForge 1.21.1. Put it in its own empty folder in the
   scratchpad, never into `mods/`.
2. **MCP tools only see pack jars** (`resolveJar` reads `mods/` and nested jars). Until there's a tool for candidate
   jars, read it directly: `unzip -l`, `unzip -p <jar> META-INF/neoforge.mods.toml`, `unzip -p … <path>` for data and
   lang, `javap -p -classpath <jar> <class>` for code. Don't run the jar. Then propose the MCP tool (see 7).
3. What to get from it:

| Question | Where in the jar |
| --- | --- |
| mod id, version, Minecraft/NeoForge ranges, required deps and their ranges vs the pack (Create, Flywheel, Ponder, Architectury…) | `META-INF/neoforge.mods.toml`, `META-INF/jarjar/metadata.json`; pack versions — `mods_list` / `mods_check mod=<dep>` |
| license and redistribution (the pack server hands jars to players) | `license` in the toml, LICENSE file, the project page; closed license → «уточнить у автора» |
| client/server side | `side` of deps, `displayTest`, client-only classes |
| content: blocks, items, fluids, entities | `assets/<id>/lang/en_us.json` (+ `ru_ru.json` — is there Russian?), `assets/<id>/blockstates/` |
| recipes and recipe types — data or hardcoded | `data/<id>/recipe/`, `data/<id>/recipe_type`, registries in code |
| tags it provides and expects (`c:` vs own) | `data/*/tags/` |
| worldgen (ores, structures, biomes) — can it be switched off | `data/<id>/worldgen/`, `neoforge/biome_modifier/`, config classes |
| configs: what's tunable (explosions, fallout, rates) | config classes (`ModConfigSpec` builders) / default toml |
| mixins and their targets — clashes with pack mods | `*.mixins.json` + `javap`; then `mixins target=<class>` on the pack for each target |
| extension points for our addon (registries, events, data-driven fuels) | public API packages, events it posts |

Mark every fact by source: «по jar», «по странице мода», «по отчёту (не проверено)».

For **mechanics to borrow** (no install), look at how the mod implements them only to describe the mechanic and its
numbers; we don't copy code of mods with closed or incompatible licenses — our addon re-implements on top of pack mods.

## 3. Overlaps and conflicts with the pack

Go through each — a short verdict and the evidence:

- **Duplicate content**: second ore/metal/ingot (same `c:` tag?), second fluid of the same substance, second energy
  unit or radiation system. Prefer the pack's (TFC/IE) item and retag or remove the candidate's.
- **TFC rules**: ores — TFC veins by rock (`map_rocks`), not random features; metals — TFC heating/melting/anvil data
  (`reference_get section=metals`, `kubejs/data` overrides); items — size/weight, heat, food decay; fuels and fluids —
  TFC containers and temperatures. What exactly the candidate needs for each — from its data, not assumed.
- **Energy**: which carrier (SU, EE, FE) and where the bridge is (`reference_get section=power`,
  docs/plans/electricity.md). A new carrier without a bridge is an island.
- **Create version and Create addons**: same Create range as ours, Flywheel/Ponder versions, overlapping Create
  addons (`mods_list query=create`).
- **Mixins and events**: shared targets with pack mods (`mixins target=…`), event handlers that cancel others
  (`event_listeners`).
- **Server load and world safety**: big multiblocks, per-tick simulations, terrain-changing accidents — what can be
  limited by config.
- **Players**: new danger (radiation, explosions), progression stage, Russian translation.

## 4. Routes

For each piece of the integration pick the cheapest route (docs/addons.md «Когда нужен аддон»):

| Route | When | How |
| --- | --- | --- |
| **Config** | switch off worldgen, explosions; tune rates | `config_propose` after install (keys from the jar's config classes) |
| **KubeJS / datapack** | recipes, tags, removals, TFC data (veins, heat, melting) | pack KubeJS → `npm run tfc -- admin propose`; site datapack — section «Датапаки» |
| **Mixin addon** | change a number or condition in someone's code | small addon like `ee-overheat`; breaks on target updates |
| **Own addon** | new block/mechanic, or a borrowed mechanic | `tools/<mod>` per docs/addons.md, separate session per addon |
| **Don't install** | duplicates the pack, closed license blocks distribution, version mismatch | say what would change the answer |

## 5. The plan text (Russian)

Show it to the user **before** writing to the site. Structure:

```markdown
# Интеграция: <тема>

Источники: jar <file> (<version>), MCP по сборке от <date>; страницы модов — где помечено. В игре ничего не проверялось.

## Итог
Ставить / не ставить / взять механики — одним абзацем, с главной причиной.

## Что уже есть в сборке
## Кандидат(ы) по jar
| Что | Факт | Источник |
## Пересечения и конфликты
| Что | С чем в сборке | Решение |
## Маршрут
| Часть | Как (конфиг / KubeJS / датапак / аддон) | Кто делает (агент → propose / хост / отдельная сессия) |
## Этапы
### Этап 0. … — что сделать, чем проверить («в игре не проверялось»), что решить с игроками
## Проверка отчёта (если был)
| Утверждение | Верно? | Чем проверено |
## Открытые вопросы и что не проверено агентом
```

## 6. Write to the site (after the user's yes)

1. The task from step 0 — or `groups_list query=разработка` + `task_create` («Интеграция: <тема>», group
   «Разработка», status `todo`, checklist = stages).
2. Someone else's doc on the task (the user's report) is **not overwritten**: add a new doc
   `artifact_put task=<id> title="Анализ интеграции: <тема>" content=<plan>`. Your own earlier doc — update it
   (`artifact_get` → `artifact_put id=… baseRevision=…`).
3. Short task description: verdict, link to the doc, what's waiting on whom. `task_update` with `baseRevision`.
4. Repo notes only if the decision is long-lived (like `docs/plans/nuclear.md`) — then a worktree and `ship`.

## 7. Missing tools

Reading a candidate jar by `unzip`/`javap` is a workaround: MCP has no tool for jars outside the pack. Finish the
analysis, then propose a separate session per CLAUDE.md «If a needed tool is missing» (branch `feat/mcp-<short>`,
docs/mcp.md «Adding a tool») — unless one is already proposed or done (check docs/state/mcp.md).
