# State: waiting for the host or an in-game check

Part of [STATE.md](../STATE.md). The agent can't check anything in game. When an item is resolved, remove it here and
its one-liner in STATE.md.

## Host actions

- **EE Extras 2.2** (`ee-extras-2.2.0.jar`, replaces ee-rectifier-*.jar — `tfc pull addons` removes the old one): host
  installs and `tfc publish`. Warn players: existing rectifiers carrying more than 6 kW will smoke and burn — replace
  with heavy ones. In game: blocks look, cable and «dashed» spool, two/four-core laying, wrench on the two-wire
  connector (phase), converter on an IE capacitor (input/output face by hammer), JEI/EMI recipes, placed rectifiers
  survive; 2.0.2 — cable, EE connector terminal, highlight and label, wrench rotation; 2.1 — wires and spools, sag and
  rendering of spans > 128 blocks, clamp by click, spool tooltips, recipes; 2.2 — blocks, JEI, inverters with motors and
  several per grid; grid sync only at microTicks = 1. Details — [addons.md](addons.md).
- **EE Extras 2.3 + Small Diesel 1.0.0** (2026-10-22, `ee-extras-2.3.0.jar`, `small-diesel-1.0.0.jar`): host installs
  both and `tfc publish` (EE Extras 2.3 includes 2.2). In game: compact generator look and rotating half-shaft, small
  engine and generator look, bucket by hand and Create pipes into the tank, JEI/EMI recipes, a real CDG engine driving
  compact generators, fuels other than diesel. Details — [addons.md](addons.md).
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
- Addons Miner Tools, Stress Fix — see [addons.md](addons.md).
- `tfc` app on Windows/Linux and with the real launcher folder — see [infra.md](infra.md#tfc-app-cli-stage-3).
