# State: waiting for the host or an in-game check

Part of [STATE.md](../STATE.md). The agent can't check anything in game. When an item is resolved, remove it here and
its one-liner in STATE.md.

## Host actions

- **TFC Pyrofuel 1.0.0** (2026-10-27, dev #104): install with `tfc pull addons` on server and all players, then
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
  several per grid; grid sync only at microTicks = 1. Details — [addons.md](addons.md).
- **EE Extras 2.3.1 + Small Diesel 1.0.1** (2026-10-22, `ee-extras-2.3.1.jar`, `small-diesel-1.0.1.jar`; 2.3.1/1.0.1
  — new looks only): host installs both and `tfc publish` (EE Extras 2.3.1 includes 2.2–2.3). In game: new models of the
  generator, rectifiers, inverters, small engine and genset (terminals of both generators moved into terminal boxes —
  placed wires should follow), rotating half-shaft, bucket by hand and Create pipes into the tank, JEI/EMI recipes, a real CDG engine driving
  compact generators, fuels other than diesel. Details — [addons.md](addons.md).
- **Create Aeronautics Extra 1.0.0** (2026-10-24, `create-aeronautics-extra-1.0.0.jar`, onboard computer): host
  installs (`tfc pull addons`, server and players) and `tfc publish`. In game: block looks and rotating half-shaft,
  goggles and tooltips, module insert/remove by hand, JEI/EMI recipes, the block on a flying Aeronautics ship with
  propellers. Details — [addons.md](addons.md).
- **IE Extras 1.0.0** (2026-10-23, `ie-extras-1.0.0.jar`, analog heater): host installs (`tfc pull addons`, server and
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
