---
name: integration-plan
description: Analyse the pack for an integration («анализ интеграции», «план интеграции») — a candidate mod to add (Going Nuclear, Destroy, Create Chemistry), mechanics to borrow from another mod into our addon (Power Grid → EE Extras), a new production branch (химия, ядерка) or a tie between pack mods (IE ↔ TFC): what the pack already has, what the candidate really contains (by jar, not by its page), overlaps and conflicts with TFC, routes (config / KubeJS / datapack / own addon / don't install), stages with checks; then a plan doc on the site task. Use for "рассмотри мод X", "что взять из X", "стоит ли добавлять X", "как вписать X в сборку", "проверь отчёт/план по интеграции".
---

# Integration analysis: pack inventory → candidate by jar → overlaps → routes → plan → site task

The result is advice and a staged plan, not an installation: the agent never adds jars to the pack. Pack file changes
go through the host (`config_propose`, `npm run tfc -- admin propose`), new jars — the host's own update
(docs/pack-server.md), own code — an addon in `tools/` (docs/addons.md) in a separate session. Nothing is checked in
game — in-game steps are noted as unchecked only when load-bearing.

All pack facts from MCP `tfc-pack` (AGENTS.md), candidate facts from its jar. Everything the user sees — in Russian.

## 0. Scope and inputs

Input — one of:

- **candidate mod(s)** not in the pack («стоит ли ставить Destroy»);
- **mechanics from another mod** to rebuild in our addon or KubeJS («что взять из Power Grid»);
- **a production branch** without a chosen mod («химия», «ядерка») — then candidates are part of the work;
- **a tie between pack mods** («IE и TFC металлы», «дизель и нефть») — skip step 2;
- **someone's report or plan** (often a task doc written from mod pages / a chatbot) — the job is to check its claims
  against the pack and jars and say which hold.

First `tasks_list query=<words>` (and group «Разработка» if the user points to «задачи ниже»): the task and its docs
are the brief. Also `docs/plans/*.md` on the topic (`nuclear.md`, `electricity.md`, …) and `docs/state/pending.md` —
earlier decisions are not reopened without a reason.

**Read every doc attached to the task in full before any research.** `task_get` shows only the first `doc_chars`
(4000) of each doc — that is a preview, not the doc. For each doc: `artifact_get id=<doc>` from line 0 and keep paging
(`offset` = next line, `limit=300`) until the last line; same for docs of the «задачи ниже» the user points to.
Attachments (`task_get` lists name/size/id without content) — ask the user for their content if they matter. Then
write down the doc's own outline — **every section and every proposal** (priorities P0/P1/P2, integrations with other
mods, constraints, acceptance criteria, tasks for the agent). This list is a checklist for step 5: the plan answers
each item — holds / already in the pack / take / don't take / out of scope (why) — not only the claims that happened to
come up during research. A user's report usually names the questions the user cares about; skipping its sections looks
like it wasn't read.

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

1. **Register the jar with MCP `candidate_get`** (never into `mods/`). Official source only: Modrinth / CurseForge /
   the author's GitHub release, the build for NeoForge 1.21.1:
   - Modrinth — `candidate_get modrinth=<slug> [version=…]`: without `download=true` it only reports file, source,
     size, license and sides. **Ask the user** (safety rules: name the file, source, size), then repeat with
     `download=true` (sha1 checked against Modrinth). Unknown slug → it suggests similar projects;
   - CurseForge / GitHub — a direct file link: `candidate_get url=<cdn link>` (same two steps), or download it yourself
     after the user's yes into its own empty folder in the scratchpad and `candidate_get path=<jar>`;
   - `candidate_get` with no args — candidates already registered (`.cache/mcp/candidates/`).
   Don't run the jar.
2. **Read the summary, then drill down.** The summary answers most of the table below in one call: mods, license, deps
   checked against the pack (as `mods_check`), jar-in-jar, side, content counts with ru_ru, recipes by type, tags,
   worldgen, config classes, mixin targets shared with pack mods. Full lists — `section=` one of
   `content`, `recipes`, `tags`, `worldgen`, `config`, `mixins`. Files and code — the usual jar tools with `jar="candidate:<file>"`: `jar_find`, `jar_read`,
   `jar_grep`, `class_find`, `class_info`, `decompile` (config defaults, registries), `jar_javap`. For each shared
   mixin target — `mixins target=<class>` on the pack (the summary lists them). Candidates are never in the pack index:
   `class_find`/`code_refs`/`mixins` without `jar` stay pack-only.
3. What to get from it:

| Question | Where in the jar |
| --- | --- |
| mod id, version, Minecraft/NeoForge ranges, required deps and their ranges vs the pack (Create, Flywheel, Ponder, Architectury…) | `candidate_get` summary (from `META-INF/neoforge.mods.toml` + jar-in-jar); NeoForge ranges vs the server — `mods_check neoforge=…` for pack mods |
| license and redistribution (the pack server hands jars to players) | `license` in the toml, LICENSE file, the project page; closed license → «уточнить у автора» |
| client/server side | `side` of deps, `displayTest`, client-only classes |
| content: blocks, items, fluids, entities | summary counts; names — `section=content query=block` (or `item`, `fluid_type`, …) (en / ru) |
| recipes and recipe types — data or hardcoded | `section=recipes` (by type), a file — `jar_read`; recipe type registries — `class_find jar=candidate:…` |
| tags it provides and expects (`c:` vs own) | `section=tags` (marks tags the pack already has); expected tags — `jar_grep query='"tag": "c:'` |
| worldgen (ores, structures, biomes) — can it be switched off | `section=worldgen` (biome modifiers with biomes/features), switches — `section=config` |
| configs: what's tunable (explosions, fallout, rates) | `section=config` → `decompile class=<config class> jar=candidate:…` |
| mixins and their targets — clashes with pack mods | `section=mixins` (targets mixed by pack mods first); then `mixins target=<class>` on the pack |
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
### Этап 0. … — что сделать, чем проверить, что решить с игроками
## Ответ на отчёт (если был) — по его разделам, в его порядке
### <раздел отчёта, как у автора>
| Предложение / утверждение | Ответ: верно · уже есть · берём (этап N) · не берём · вне темы | Почему, чем проверено |
## Открытые вопросы и что не проверено агентом
```

Before showing the plan, compare «Ответ на отчёт» with the outline from step 0: every section and proposal of the
report has a row. A section left out on purpose gets a row too («вне темы этой задачи — см. задачу …»).

## 6. Write to the site (after the user's yes)

1. The task from step 0 — or `groups_list query=разработка` + `task_create` («Интеграция: <тема>», group
   «Разработка», status `todo`, checklist = stages).
2. Someone else's doc on the task (the user's report) is **not overwritten**: add a new doc
   `artifact_put task=<id> title="Анализ интеграции: <тема>" content=<plan>`. Your own earlier doc — update it
   (`artifact_get` → `artifact_put id=… baseRevision=…`).
3. Short task description: verdict, link to the doc, what's waiting on whom. `task_update` with `baseRevision`.
4. Repo notes only if the decision is long-lived (like `docs/plans/nuclear.md`) — then a worktree and `ship`.

## 7. Missing tools

Candidate jars are covered by `candidate_get` + `jar=candidate:<file>`. If a question about a candidate still needs
`unzip`/`javap` by hand (a section that's missing, a wrong count), finish the analysis by the workaround, then propose
a separate session per AGENTS.md «If a needed tool is missing» (branch `feat/mcp-<short>`, docs/mcp.md «Adding a
tool») — unless one is already proposed or done (check docs/state/mcp.md).
