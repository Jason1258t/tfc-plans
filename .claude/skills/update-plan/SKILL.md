---
name: update-plan
description: Build a pack update plan («план обновления») from the MCP mods_freshness report — whole pack, one lag colour (red/orange/yellow) or a list of mods: dependencies, KubeJS, site datapacks, our addons, mixins, breaking changes from changelogs, risk groups, order, in-game checks; then write it into a site task with a plan doc. Use for "план обновления", "что обновить в сборке", "обнови красные моды", "можно ли обновить <мод>".
---

# Update plan: freshness → per-mod checks → plan → site task

The plan is advice for the host, not an update: the agent never swaps jars. Pack file changes go through the host
(`tfc admin propose`, `config_propose`), the jars themselves — the host's own update (docs/pack-server.md). Nothing is
checked in game — every step the plan asks to verify is marked «в игре не проверялось».

All facts from MCP `tfc-pack` (AGENTS.md), not from memory. Everything the user sees — in Russian.

## 0. Scope

Input — one of:

- **whole pack** → `mods_freshness status=outdated` (paged, `limit=50`, `offset`), then red and orange in full,
  yellow mostly as one «безопасные» list (see 3);
- **a colour** → `mods_freshness status=red|orange|yellow`;
- **a list of mods** → `mods_freshness mod=<id>` for each.

Big scopes (yellow has ~60 mods): ask the user whether to go through all of them in detail or only those with
dependents / KubeJS / mixins. Don't call `mod=…` for 60 mods in a row without asking.

## 1. Per mod: what changed

`mods_freshness mod=<id> deps=true` — our → newest release, newer beta, source, the **new jar's dependency ranges**
checked against the pack (✗ — missing mod / version out of range / incompatible; changed ranges vs ours; pack mods
whose ranges it breaks), changelogs of newer releases, oldest first. More changelogs — the same call with the
`offset` it prints, without `deps`; betas — `beta=true` (also checks the beta
jar). Pass `neoforge=<server version>` if known, else the NeoForge range stays «не задана». Read the changelogs for:

- removed/renamed blocks, items, recipes, config options; config format or folder moved (Serilum/Collective moved
  configs to `config/serilum/*.json` in 8.54–8.57);
- Java package rename, API rewrite (breaks dependents compiled against the old one), data format / world save changes;
- minimum Minecraft / NeoForge / dependency versions; merged or split mods;
- "no functional changes" and CI-only notes → safe, even when the major number jumped.

Ranges are what FML checks, not API compatibility: a dependent compiled against the old major (Burning Block vs
Moonlight 2.x) shows «ок» by range — still «проверить в игре».

## 2. Per mod: what in the pack touches it

Cheap first, one call per question, not per item:

| Question | Tool |
| --- | --- |
| dependencies, who depends on it (and with which range), jar-in-jar, mixin configs | `mods_check mod=<id>` |
| dependents' own freshness (is there a dependent build for the new major?) | `mods_freshness mod=<dependent>` |
| items, recipes, recipes removed/changed by KubeJS, imported configs | `mod_get <id>` |
| pack KubeJS scripts and `kubejs/data` mentioning it | `kubejs_search query="<id1>\|<id2>\|…" context=0` — one regex for all mods in scope |
| site datapacks | `datapacks_list` once (9 now), then `datapack_get` only for a pack that may touch the mod (by name/namespace) |
| site KubeJS scripts | `kubejs_site_list` once |
| our addons in `tools/` | `addons_list` once (Firestore: one read per addon); a dependent addon — read its `neoforge.mods.toml` and sources for the mod's classes |
| imported configs to re-check after the update | `config_get mod=<id>` / `config_get file=…` |
| mixins of a code-heavy mod, conflicts on the same methods | `mixins mod=<id>`, then `mixins target=<class>` for its targets |
| where its items are used elsewhere (for item-removing changelogs) | `recipes_using input=<item>` — only for named items |
| site code that reads the mod's data or draws its items (reference builders, icon renderers) | `grep -rln -i "<id1>\|<id2>" src scripts` once — e.g. `scripts/mods/reference.mjs` reads `data/createliquidfuel/compat`, `scripts/mcp/models/create_submarine.mjs` draws one item by the mod's renderer code |

Also look at `docs/state/pending.md`: an open host step involving the mod (e.g. a config change waiting to be applied)
must be ordered before or merged into the update.

## 3. Risk groups

- **Безопасно** — patch/pre bumps, or major bumps whose changelog says "no functional changes"; no dependents with
  tight ranges; no KubeJS/datapack/addon ties. Can go in one batch.
- **Проверить** — new content or reworked mechanics, config format/folder changes, new required dependencies, mixins
  on the same methods as other mods, KubeJS/datapacks referencing its ids.
- **Рискованно** — API rewrites with dependents not updated, world-data or save format changes, merged/split mods,
  beta-only newest versions, mods our addons compile against. Separate step, backup of the world first.
- **Не обновлять сейчас** — when a dependent has no build for the new version or the newest is beta only; say what to
  wait for.

Libraries go with their dependents: update the library and every dependent in one step, library first.

## 4. Order

1. World backup (the host).
2. Libraries and their dependents that require the new version.
3. Safe batch.
4. "Проверить" mods one by one or in small batches, each with its own checks.
5. Risky ones last, each alone.
6. After all jars — `tfc publish` on the pack server so the site gets the new pack data; then rerun
   `mods_freshness refresh=true` and `mods_check` to confirm no missing deps.

## 5. The plan text (Russian)

Show the plan to the user **before** writing anything to the site (writes go to production Firestore). Structure:

```markdown
# План обновления: <scope>

Источник: mods_freshness от <date>, модов в плане N. Ничего в игре не проверялось.

## Итог
| Мод | Сейчас → новая | Риск | Почему |

## Порядок
1. …

## По модам
### <Name> (`<id>`) <our> → <new>
- Что нового: … (из ченджлога; «ченджлог обрезан» — если так)
- Зависимости: … / зависят от него: …
- KubeJS, датапаки сайта, аддоны: … (или «не трогают»)
- Миксины: … (если есть общие методы с другими модами)
- Что сделать: … (конфиг перенести, propose, ждать сборку зависимого мода)
- Проверить в игре: … — «в игре не проверялось»

## Не обновлять сейчас
## Что не проверено агентом
```

## 6. Write to the site (after the user's yes)

1. `groups_list query=…` — the group the user named; default «Фиксы» (pack work) — ask if unsure.
2. `tasks_list query="план обновления"` — an open plan task for the same scope → update it (`task_get` →
   `task_update` with `baseRevision`; doc via `artifacts_list task=<id>` → `artifact_get` → `artifact_put` with
   `baseRevision`) instead of a second one.
3. New: `task_create` — title «План обновления: <scope>», short description (counts by risk, link to the
   freshness page `/freshness`), checklist = the order steps (one item per step, not per mod for big batches),
   assignee — the host's nick if the user gives it, else none; status `todo`.
4. `artifact_put task=<id> title="План обновления: <scope>" content=<plan>`.
5. Report the task link. These are site records — no repo commit needed.

## 7. Missing or wrong tool answers

If you had to fall back to grep/unzip/a script (e.g. a jar the tool couldn't download, a changelog the platform doesn't give),
finish the plan with the workaround and propose a separate session per AGENTS.md «If a needed tool is missing»
(branch `feat/mcp-<short>`, docs/mcp.md «Adding a tool»).
