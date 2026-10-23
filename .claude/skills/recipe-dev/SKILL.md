---
name: recipe-dev
description: Add or change a recipe so it canonically fits the pack — realistic industrial process (Create/IE/EE and addons first after the electric era, TFC only pre-electric), pick the lightest route and the right recipe type, draft plausible inputs, check conflicts with recipe_conflicts, verify without the game. Use for «сделай рецепт», «добавь рецепт для X», «как получить X», «поменяй рецепт», «убери рецепт».
---

# Recipe development: item → canon → route → type → plausible inputs → conflict check → verify

Canon rules (eras, materials, plausibility, «не вписывается») — [docs/recipe-canon.md](../../../docs/recipe-canon.md).
The field reference for all 40 recipe types is [scripts/recipe-hints.json](../../../scripts/recipe-hints.json) (shown on
the site as the recipe-editor hint panel). MCP answers already include KubeJS and site-datapack layers. This skill is the
order of work. Releasing an addon — `addon-release`; merge/deploy/push — `ship`. Everything players see (lang, report,
commit) — Russian.

## 1. Task and worktree

- Site task in «Разработка» (`tasks_list group=Разработка query=…` or `task_create`), status `doing`, assignee —
  your own agent name (`TFC_AGENT_NICK`; `DeepSeek` here).
- Own worktree and branch (`feat/recipe-<short>`), never the main checkout.

## 2. Locate the item and what already exists

- `items_search query=…` / `item_get id=…` — confirm id, mod, tags; same Russian name → show mod/id.
- `recipes_for output=… status=active` — how it's obtained now; `recipes_using input=…` — where it's used.
- `tags_of id=…` / `tag_members tag=…` — which `c:*` / `tfc:*` tags fit (membership after KubeJS).

## 3. Canon — does it fit at all?

- Read [docs/recipe-canon.md](../../../docs/recipe-canon.md): pick the era/mod by the item's nature (industrial first,
  TFC only pre-electric), and check the process is plausible against reality.
- **If it doesn't fit** (mod missing with no plausible analogue, breaks progression, no sensible Minecraft
  simplification) — tell the player directly and stop; offer the closest fitting alternative.
- Otherwise decide inputs that mirror the real process with Minecraft simplifications and pack conventions.

## 4. Route (lightest first)

| Need | Route |
| --- | --- |
| recipe / tag / removal / TFC data (heat, food, fuel) | site datapack or KubeJS — no addon |
| pack config value | `config_get` → `config_propose` |
| new block/item with logic | addon — skill `addon-dev` |

- Site datapack: Firestore `datapacks` (`datapacks_list` / `datapack_get`), installed into the world by the tfc app.
- Site KubeJS script: `kubejs_site_list` / `kubejs_site_get`.
- Pack KubeJS/datapack files: `npm run tfc -- admin propose <overlay dir> --note …` (host pulls and approves).
- Pack config: `config_propose`.

## 5. Recipe type

- From the item's nature — the era table in docs/recipe-canon.md. The exact fields for that type — its hint in
  [scripts/recipe-hints.json](../../../scripts/recipe-hints.json) (40 types: vanilla, TFC, Create, IE, Firmalife,
  Diesel Generators).
- Template: `recipe_get id=<similar item's recipe>` — copy its structure and material palette (same mod/material).

## 6. Draft

- Only pack items and `c:*`/`tfc:*` tags; every input reachable (`recipes_for <input> status=active`); whole counts;
  output id in the right namespace; `ru_ru` name exists.
- No duplicate output: `recipes_for output=<the new item>` should not already have an active recipe of the same kind.

## 7. Conflict check (recipe_conflicts)

- `recipe_conflicts type=<t> recipe=<JSON or inputs/outputs>` — same-type recipes with the same inputs/grid (tags
  considered, mirror for shaped) and the same-id replacement. Iterate on inputs until clean, or justify a deliberate
  override (e.g. a tag recipe that intentionally specialises one input).

## 8. Write

- The chosen route (datapack / KubeJS / `tfc admin propose`). Keep the id unique (`<ns>:<path>`); check with
  `recipe_get` which KubeJS rules might touch the namespace.

## 9. Verify without the game

- `recipe_get id=<new>` — parses, status «работает», no unexpected KubeJS removal/replacement.
- `recipe_conflicts` (step 7) clean; `recipes_using` on the new inputs — nothing important was shadowed.
- Mark «в игре не проверялось» (real machine behaviour, feel, multiplayer).

## 10. Report

- Commit `Рецепты: <что> — …`; skill `ship`. Site task → `done` with a short Russian note; anything waiting for the
  host or an in-game check → `docs/state/pending.md`.
