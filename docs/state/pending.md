# State: waiting for the host or an in-game check

Part of [STATE.md](../STATE.md). The agent can't check anything in game. When an item is resolved, remove it here and
its one-liner in STATE.md.

## Host actions

- **Euphoria Patcher startup popup** (2026-10-29, dev #150): proposed update `u20261029-193554-dd27`
  disables `display.doPopUpLogging` in `config/euphoria_patcher/settings.toml`. The installed mod code confirms
  that this disables Sodium popups while retaining logs. Missing Complementary r5.8.1 remains a separate optional
  shader installation issue. Host: pull this update, restart the client, check the popup, then approve.
  Source and manual-client instructions: [euphoria-popup](../../pack-patches/euphoria-popup/README.md).
  Not checked in game.

- **Гладкий камень на камнерезе и в прессе** (2026-10-29, dev #151): site datapack `wbgmlRWP5X9h8pWQb5bQ`
  (ns `tfc_plans_smooth`, built by `npm run datapack:smooth -- --upload`). Recipes: stonecutter 1:1 for every
  `tfc:chisel` smooth-mode stone block (smooth rocks from raw/hardened, chiseled bricks, smooth/cut sandstone, polished
  alabaster, Firmalife sealed bricks), plus slab ×2 / stairs ×1 / wall ×1 from each such block that has a crafting-table
  shape (smooth rocks, smooth and cut sandstone; 185 recipes in all); Create compacting `heated`: raw rock → smooth
  rock, no fluid (a single input no other basin recipe uses, so Create never has to pick between recipes).
  `recipe_conflicts` clean. Host: flag «ставить», `tfc datapacks install`, check in game, then `confirm`. Not
  checked in game.

- **Create Ore Excavation veins** (2026-10-29, dev #136): proposed update `u20261029-091146-275f`, source and
  checks — [pack-patches/coe-vein-ids](../../pack-patches/coe-vein-ids/README.md). COE 1.6.8's KubeJS helper writes
  a component object, but the recipe loader expects a JSON string (`FLAT_CODEC`); all 27 custom veins now use
  explicit JSON through `event.custom`, retaining IDs, translations, generation and drilling. Reduced NeoForge
  server reproduced the old parse failure, loaded three corrected veins, and passed `/coe setvein` / `/coe locate`.
  All 27 veins and drilling recipes compared unchanged; other Create recipes compared unchanged after formatting.
  Host: `tfc admin updates pull u20261029-091146-275f`, restart, check KubeJS errors, command completion, atlas,
  finder and drilling, then `tfc admin updates approve u20261029-091146-275f`. Full-pack runtime and client UI:
  not checked in game.

- **CDG ↔ IE recipes** (2026-10-28, dev #118): proposed update `u20261028-203009-ce84`, source and checks —
  [pack-patches/cdg-ie-recipes](../../pack-patches/cdg-ie-recipes/README.md). Four same-id overrides in `kubejs/data`:
  silver/uranium hammering results, phenolic-resin casting and herbicide fluid ingredients; herbicide time corrected
  to 400 ticks. Host: `tfc admin updates pull u20261028-203009-ce84`, restart, check JEI/EMI and machines, then
  `tfc admin updates approve u20261028-203009-ce84`. All four recipes passed RecipeManager checks on a reduced
  NeoForge server. Full KubeJS scripts loaded, but the full server stopped on unrelated dedicated-side class loading;
  test-environment follow-up: dev #133. Full-pack runtime and in-game machines: not checked.

- **Бетонные смеси с известью** (2026-10-28, dev #124): обновление `u20261028-155634-36f7`, исходник и проверки —
  [pack-patches/concrete-lime](../../pack-patches/concrete-lime/README.md). Общая основа: 3 песка + 3 гравия + 2 извести
  → 8 смеси; цветные варианты с красителем, IE и RnR используют ту же смесь. Переход датапака «Бетон» TFC → IE
  сохранён; возврат 25% порошка Diesel Generators убран. Хост: `tfc admin updates pull u20261028-155634-36f7`,
  перезапуск, проверка рецептов/бочек/смесителя/дорог/цветных жидкостей и журнала KubeJS, затем
  `tfc admin updates approve u20261028-155634-36f7`. Проверены 52 рецепта и 36 удалений, конфликты MCP, код IE/RnR/CDG;
  в игре не проверялось. Распространение жидкого бетона по миру остаётся штатным, расход на площадь не унифицирован.

- **TFC Pyrofuel 1.0.1** (2026-10-29, dev #104/#135, new textures): install with `tfc pull addons` on server and all players, then
  `tfc publish` to rebuild the item/recipe library. In game: item/fluid textures in tanks, JEI/EMI chains, manual bucket
  transfer, real production lines and fluid trains. Ordinary blaze burner takes briquettes; liquid pyrogel uses the
  separate CDG burner. New cake production is disabled; old cakes can be converted 1:1. Details: [addons.md](addons.md).

- **Pack translation `pack-patches/l10n/`** (2026-10-22): Chinese player-facing text in pack KubeJS scripts → lang keys
  (`Text.translatableWithFallback`, English fallback) + `kubejs/assets/kubejs/lang/{en_us,ru_ru}.json`: item cleaner
  broadcasts, 27 Create Ore Excavation vein names (ids unchanged), engine refuel, lectern/controller, obsidian, welcome,
  tooltips. Proposed as pack update `u20261022-150945-83a0` (by `claude-agent`): host `tfc admin updates pull`,
  restart, check, `tfc admin updates approve`. In game: not checked (Rhino overloads of
  `translatableWithFallback`, vein names in finder/atlas). Mod-hardcoded Chinese left: `kaleidoscopetfctavern` grapevine
  locator, `firmalifehardcore` debug commands.
- **EE Extras 2.2** (`ee-extras-2.2.0.jar`, replaces ee-rectifier-*.jar — `tfc pull addons` removes the old one): host
  installs and `tfc publish`. Warn players: existing rectifiers carrying more than 6 kW will smoke and burn — replace
  with heavy ones. In game: blocks look, cable and «dashed» spool, two/four-core laying, wrench on the two-wire
  connector (phase), converter on an IE capacitor (input/output face by hammer), JEI/EMI recipes, placed rectifiers
  survive; 2.0.2 — cable, EE connector terminal, highlight and label, wrench rotation; 2.1 — wires and spools, sag and
  rendering of spans > 128 blocks, clamp by click, spool tooltips, recipes; 2.2 — blocks, JEI, inverters with motors and
  several per grid (grid sync at microTicks > 1 fixed in 2.5.1). Details — [addons.md](addons.md).
- **EE Extras 2.3.1 + Small Diesel 1.0.1** (2026-10-22, `ee-extras-2.3.1.jar`, `small-diesel-1.0.1.jar`; 2.3.1/1.0.1
  — new looks only): host installs both and `tfc publish` (EE Extras 2.3.1 includes 2.2–2.3). In game: new models of the
  generator, rectifiers, inverters, small engine and genset (terminals of both generators moved into terminal boxes —
  placed wires should follow), rotating half-shaft, bucket by hand and Create pipes into the tank, JEI/EMI recipes, a real CDG engine driving
  compact generators, fuels other than diesel. Details — [addons.md](addons.md).
- **EE Extras 2.4** (2026-10-29, `ee-extras-2.4.0.jar`, IE lantern on the EE duplex cable): host installs
  (`tfc pull addons`, server and players) and `tfc publish`. In game: clicking an IE lantern with the duplex spool, the
  lantern look standing and hanging, light and no flicker on a real AC generator, wrench flip, the tooltip on the IE
  lantern. Details — [addons.md](addons.md).
- **EE Extras 2.5.1** (2026-10-29, `ee-extras-2.5.1.jar`, includes 2.4–2.5; frequency converters and synchronizers;
  2.5.1 — grid inverters sync at the pack's microTicks = 8, dev #142): host
  installs (`tfc pull addons`, server and players) and `tfc publish`. In game: inverters on a real generator grid (2.5.1), block looks, the frequency / mode value
  boxes, goggle readouts, synchronizer «faster/slower» via redstone dust to real EE brushes, the two-block industrial
  cabinet placement and radiators. Details — [addons.md](addons.md).
- **Create Aeronautics Extra 1.0.1** (2026-10-29, `create-aeronautics-extra-1.0.1.jar`, new module textures): host
  installs (`tfc pull addons`, server and players) and `tfc publish`. In game: block looks and rotating half-shaft,
  goggles and tooltips, module insert/remove by hand, JEI/EMI recipes, the block on a flying Aeronautics ship with
  propellers. Details — [addons.md](addons.md).
- **IE Extras 1.1.0** (2026-10-29, `ie-extras-1.1.0.jar`; 1.0.0 — analog heater, 1.1.0 — basin heating by IE external,
  EE and analog heaters, dev #113): in game — basin temperature line in goggles, heated/superheated basin recipes (steel,
  kaolinite) on the IE external heater and the EE heater. Host installs (`tfc pull addons`, server and
  players) and `tfc publish`. In game: block looks and placement, Create analog lever, IE wires/connector feeding it,
  crucible cooling after lowering the signal (can't be seen on the dev server — TFC calendar stands without players),
  Firmalife vat/pot/oven top, JEI/EMI recipe. Details — [addons.md](addons.md).
- **`rw-host-fix`** (`rw-host-fix-1.0.0.jar`): host uploads via `tfc publish` together with deleting
  `kubejs/server_scripts/event/eratosthenes_portal_clamp.js`; check host death and portal — the map no longer «drifts».
  Corrupted chunks (Z ≈ −22 000…−18 400, created 2026-10-20/21) — delete, the world regenerates them.
- **Nether: player pushed back to Z = ±2490** (2026-10-21): found by `tp-trace` — World Border mod (Natamus),
  `config/worldborder.json5`: nether border X ±5000, Z ±2500 (foreign map ±20 000), empty messages. Host: disable
  `enableCustomNetherBorder` or set X ±12 500 / Z ±6250 and `tfc publish`; remove `tp-trace` from `mods/`. Also:
  `kubejs/server_scripts/event/worldborder.js` sets the normal border at ±42 000 (our map X ±100 000, Z ±50 000) —
  decide whether `/worldborder set 200000` is needed.
- **Crop growth** (2026-10-21): proposed change `MjQFPQkIf9SHOdEjopy4` — `cropGrowthModifier` 1 → 5,
  `cropExpiryModifier` 1 → 0.625 (fertilised bed ~60 days, bare ~120, 30 days before death; computed from `CropHelpers`
  TFC 4.2.9). Waits for `tfc admin changes pull`; not checked in game.
- **Carry On: carryable storages** (2026-10-23): proposed change `P3E9AOli90hZrXpIgFBR` (replaces cancelled
  `94as4MmQ0qA0Hj6zWX7x`) in `carryon-common.toml`. `blacklist.forbiddenTiles`: `immersiveengineering:*`,
  `firmalife:*`, `farmersdelight:*` replaced by prefix masks (Carry On matches entries by substring,
  `ListHandler`/`StringHelper.matchesWildcards`; a blacklist has no allow-exceptions), `tfc:wood/barrel/*` removed.
  Now carryable: IE `crate`, `reinforced_crate`, `wooden_barrel`, `metal_barrel`; TFC barrels; Farmer's Delight
  `*_cabinet`; Firmalife `wood/wine_shelf/*`, `wood/jarbnet/*`. `settings.placementStateExceptions` +
  `tfc:wood/barrel/oak[rack]` (the shared `TFCBlockStateProperties.RACK`, so all woods): Carry On keeps non-facing
  properties, and `BarrelBlock.onRemove` drops the rack, so without it racks duplicate (reproduced). Kept blacklisted on
  purpose: Firmalife food shelves/hangers (`climateValid` is saved in NBT; nothing resets it outside a cellar, even with
  Firmalife Hardcore's `CellarTracker`), keg (2×2), Functional Storage (drawers already drop with contents; Carry On
  removes the BE first, so `Drawer.onRemove` can't unlink the controller). Dev server (Carry On 2.2.6.13, TFC 4.2.9,
  IE 12.4.2, Firmalife 3.0.14, FD 1.3.2, fake player through `PickupHandler`/`PlacementHandler`): all opened blocks
  keep items / 4000 mB / sealed, rack drops once; refused blocks refused. Waits for `tfc admin changes pull`; not checked
  in game.
- **Server resource pack `arc-furnace-matadora`** (https://tfc-plans-fd2c.web.app/packs/arc-furnace-matadora.zip,
  source in `instance/resourcepacks/`, not in git — `public/packs/` is gitignored): IE arc furnace sound overridden via
  `sounds.json` (`replace: true`) with a track from own namespace `tfc_sounds`. Server needs `resource-pack` and
  `resource-pack-sha1` in `server.properties`; SHA-1 changes when the zip is rebuilt.
- **`ee-overheat`** (`tools/ee-overheat-mod/`): goes into `mods/` of server and clients; not checked in game.

## In-game checks

- **Two-core cable shell** (EE Extras 2.0 and EE 1.1.2 itself): `CEEPartialModels.DUPLEX_WIRE_SEGMENT` references
  `electroenergetics:block/duplex_wire_segment`, absent from all pack jars and KubeJS (`resources_check
mod=electroenergetics`, 2026-10-21). See how laid cable renders.
- **Datapack `electroenergetics_missing`** (Firestore `datapacks/JyhxDrNwnrhEPfZElEMn`, zip attached to task «датапак
  Create Electro Energetics», `tasks/V5yKUg2ghPKQDB5mg3NI`): 6 recipes missing from the mod — three-phase brush
  assembly, synchroscope, lamp and fuse from burnt ones, two-wire cable spool, two-wire connector. Recipes invented by
  analogy. A foreign `lamp_reclaim` sits next to it (lamp via IE bulb).
- **Datapack `pellet_arc_furnace`** (`npm run datapack:pellets` → `out/pellet_arc_furnace.zip`, 2026-10-19): 30 arc
  furnace recipes — pellets and briquettes of 15 tfcorewashing ores (5 pellets → 1 ingot, 5 briquettes → 4). Format as
  TFC-IE-Crossover. On the site: Firestore `datapacks/rXDDGd0p2VHItiRUwOTW` («Пеллеты и брикеты в дуговой печи», signed
  Claude; update — `TFC_NICK=Claude npm run datapack:pellets -- --upload`); zip in Documents without a task
  (`files/noDoUJg3MUaxFP7SVjxO`; after `--upload` refresh via «Сохранить как файл»). Not on the server.
- **Map scale**: one check — point from the map, `/tp`, compare lat/lon (after the radius change to 100000).
- **Pumpjack oil extraction** (CDG): marked «не проверено в игре» in the reference; after the check remove the mark
  (`src/components/LiquidFuelTab.tsx`, `PumpjackMethod`).
- **Heater script** `ee_heater_crucible.js` (EE electric heater heats a TFC crucible): user said «с этим не пошло»,
  postponed. Not doable as a datapack — KubeJS only.
- **Steel on the EE heater** (`steel_heated.js`, layer `world`): by code the EE heater only reaches KINDLED, while the
  pack steel recipe is `superheated` (SEETHING) — didn't start. Added a second recipe with `heated` (the original can't
  be removed: KubeJS doesn't touch script-added recipes). Side effect: steel also works on a normal Create burner. If
  `hot_iron_bloom` (heated) doesn't start on the EE heater, the recipe isn't the cause — check power (≳1.5 kW for
  FADING) and that the basin sits directly on it. Other `superheated` recipes (kaolin, titanium alloy, stone processing)
  still don't run on the EE heater (see `ee-overheat`).
- Addon Host Tools 1.0.1: host updates it; check with a real guest — ping right after join (tab, `/ping`), `/host stop` (guest kicked), `/host random` on Windows.
- Addons Miner Tools, Stress Fix — see [addons.md](addons.md).
- `tfc` app on Windows/Linux and with the real launcher folder — see [infra.md](infra.md#tfc-app-cli-stage-3).

## Builder Tools 1.0.1 (dev #103, 2026-10-29)

Host installs on the server and all players (`tfc pull addons builder_tools@1.0.1`), then publishes the snapshot.
In game: equip builder belt in Curios, place the last block in each hand, hold LMB across stone/dirt/wood,
check full inventory and inventory-mod interactions. Server and automated dev-client checks passed; real player
input and the full pack were not checked in game.

## Pack-wide datapacks (dev #125, 2026-10-29)

Live read during dev #154 found 13 confirmed ZIPs in snapshot `20261029-192724-29d7`; the earlier “not promoted”
note is obsolete. The agent has not checked runtime behaviour. Host: update tfc, inspect `tfc datapacks list` /
`files`; named `tfc datapacks pull <id/name/filename>` delivers a confirmed ZIP without choosing a world or opening
KubeJS folders. Test unconfirmed/changed drafts in a selected world. Preview `tfc datapacks confirm all
--dry-run`; after verifying the selected versions, confirm one/all and restart. Check both an existing and a new
world, recipe overrides and KubeJS priority. Changed world copies remain for manual review. Local `undo` does not
revert server confirmation; `tfc admin rollback` reverts the whole snapshot. Details: [datapacks-pack.md](../plans/datapacks-pack.md).
