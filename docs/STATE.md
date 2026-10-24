# Current state

Updated: 2026-10-23. "Where we are now": an index — read this file at session start, open a topic file only when the
task touches it. History — `git log`.

## Topic files (`docs/state/`)

| File                           | What's in it                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [site.md](state/site.md)       | Site sections: structure, documents, tasks/plans, analytics (`/stats`), schematics, datapacks/KubeJS/recipes/tags, reference (botany, multiblocks, electricity), guides, onboarding, map, updates |
| [addons.md](state/addons.md)   | Pack addons in `tools/`: versions, what each does, how it was verified                                                                                                                            |
| [infra.md](state/infra.md)     | Data builders, imported configs, file storage, pack server (VPS), `tfc` app, agent config edits                                                                                                   |
| [mcp.md](state/mcp.md)         | MCP `tfc-pack` history: what was added when and how it was verified                                                                                                                               |
| [icons.md](state/icons.md)     | Item icons: 3D renderer, hidden items, known gaps                                                                                                                                                 |
| [pending.md](state/pending.md) | Full details of everything waiting for the host or an in-game check                                                                                                                               |

When finishing work: update the topic file, and this index only if a line below changes.

## In progress / waiting (details — [pending.md](state/pending.md))

- Host: pack update `u20261022-150945-83a0` (Chinese KubeJS messages → ru/en): `tfc admin updates pull`, check in game,
  `tfc admin updates approve`.
- Host: install **EE Extras 2.3** (2.2 + compact generator), **Small Diesel 1.0.0**, **IE Extras 1.0.0** and **Create Aeronautics Extra 1.0.0** + `tfc publish`; warn players
  that rectifiers over 6 kW will burn.
- Host: **`rw-host-fix`** + delete `eratosthenes_portal_clamp.js`; delete corrupted chunks Z ≈ −22 000…−18 400.
- Host: **World Border** nether limit (`worldborder.json5`) → disable or widen; remove `tp-trace`.
- Host: apply crop growth config change `MjQFPQkIf9SHOdEjopy4` (`tfc admin changes pull`).
- Host: apply Carry On change `P3E9AOli90hZrXpIgFBR` — IE crates/barrels, TFC barrels, FD cabinets, Firmalife wine/jar shelves can be carried (`tfc admin changes pull`).
- Host: `arc-furnace-matadora` resource pack in `server.properties`; `ee-overheat` into `mods/`.
- In game: two-core cable shell model, datapacks `electroenergetics_missing` and `pellet_arc_furnace`, map scale,
  pumpjack, steel on EE heater, all addons (Miner Tools, Stress Fix, EE Extras 2.x, Small Diesel, IE Extras, Create Aeronautics Extra).
- `tfc` app: Windows/Linux binaries, real launcher folder, real upload — not run.
- Pack freshness: done incl. the `update-plan` skill; first plan — the 5 red mods (`docs/plans/mod-freshness.md`).

## Postponed by the user

- Attribute filter logic (broken in the check itself, not fixable by config) — «пока опустим».
- «Coal near X» search with map points — «пока без такого функционала».
- Real world map zoomable to city level and an in-game explored-map layer (needs a mini-mod or export) — discussed
  only in the abstract.
- Nuclear power (uses for uranium: Create Nuclear or Going Nuclear, TFC integration) — long-term, discuss with players
  first. Chosen: Going Nuclear + Create Nuclear mechanics in an own addon; plan — `docs/plans/nuclear.md`, task in group
  «Фиксы» (2026-10-21).

## Known limitations

- KubeJS: tag members unknown to the item filter (recipes with the item via a tag aren't found); recipes from mod
  helpers (`event.recipes.create.mixing(...)`) have no full JSON. Pack KubeJS items (`kubejs:*`, `tfcr:*`, 25) are in
  the library but only 8 have Russian names (others missing from `kubejs/assets/*/lang/ru_ru.json`).
- Schematic blocks without an item (Create belt, belt funnels, powered shaft, wall torches…) — `blocks.json` with the
  item from the block's loot table; replacement targets must be blocks (`b` in items.json). Published 2026-10-23;
  blocks with code-only placement (no loot table, no `wall_` name) still have no item.
- A repaired fuse from the datapack gets the default trip current.
- Collaborative doc editing: last write wins.
- `kubejs/data` overrides metal melting (`tfc_ie_addon/tfc/fluid_heat`) — the metals reference doesn't account for it
  yet (`npm run kubejs` warns). Food and skillet already respect the pack datapack.

## Direction (discussed, not started)

- Agent token budget: review + schemes for context indexing, query optimization and new MCP tools —
  `docs/plans/token-optimization.md` (task «Новый шаг оптимизации по токенам»).

The user plans to release the project to the community so others can deploy it without changes:

- **Workspaces**: one workspace = own pack snapshot, world-gen config, map, tasks, schematics, datapacks
  (`workspaces/{id}/…`). Today everything is flat collections and singletons (`settings/world`, `config/server__…`).
- **Pack snapshot as an artifact**, not part of the build; builders are independent steps with a common "instance
  folder" input (the pack server, `docs/plans/pack-cli.md`, already does much of this).
- **Heavy storage** (icons, maps, tiles) is the main question: Firestore doesn't fit, needs static/external storage.
- **Per-mod modules**: a parser declares needed mods, the UI hides tabs without data.
- Rule already now: no new singletons; `config` has `scope` — groundwork for workspaces.
- No plan in `docs/plans/` yet — proposed `docs/plans/community.md`.

Ideas from README: nested groups, task dependencies, item page with breakdown to raw materials, task history and
comments.
