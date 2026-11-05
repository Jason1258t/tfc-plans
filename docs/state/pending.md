# State: waiting for the host or an in-game check

- Host (dev #211): accept Destroy Extras 0.6.0 on a test-world copy. Rotate both machines, rebuild the electrolyzer shell, verify fluid flow through the rotated ports and the goggles tooltip.

Part of [STATE.md](../STATE.md). The agent can't check anything in game. When an item is resolved, remove it here and
its one-liner in STATE.md.

## Host actions

- **Polymer names** (2026-11-04, dev #218): translation update `u20261104-203745-9a77` supplies full Russian names for four Destroy polymers and fixes «Полиропилен». Host: subscribe a profile with Destroy, reload client resources, check the four names, then approve. The three guides are already live. JSON/jar keys checked; full-pack MCP run exceeded the caller’s 180-second timeout and was stopped, so no successful server/client verification is claimed.
- **Going Nuclear M0** (2026-11-05, dev #202, plan doc 50): the gameplay decisions are settled — reactor automation
  after L3, realistic physics without random failures, radiation enabled, destructive accidents and fallout disabled on
  the live world. The first slice is the boiling-water reactor, turbines, spent-fuel pool and dry cask; RBMK/reprocessing/MOX
  are a separate later stage. Jar inspection confirms NeoForge ≥ 21.1.256 is required and the license is All Rights
  Reserved. Host: update NeoForge on a test profile and obtain the author's written permission for the pack server to
  redistribute the jar before integration and release. Static dependency checking of the pack against 21.1.256 found no
  conflicts; runtime and Survival acceptance have not been performed.
- **Fluid tank recipe without a barrel** (2026-11-05, dev #233 item 1): card `2csvwoHPHBhlpqiZTQ4c` is confirmed for the
  whole pack at the host's request in snapshot `20261104-223757-c5b3`, without an in-game check: 8
  `#c:plates/copper` around 1 `#c:glass_panes` → 2 tanks. The 4-tank version loaded on the pack stand; only the count
  changed after that. Host: craft it once in game. The old route stays: Create: Connected vessel (2 sheets + barrel)
  converts to a tank.

- **Transformer oil duplicate** (2026-11-04, dev #215): source card `9FCAF769A0A2ODuhbgxU`
  (`transformer_oil`, revision `2026-11-04T20:35:20.733425Z`) now disables only
  `tfc_plans:transformer_oil` with a `neoforge:false` condition. Its malformed fluid ingredient duplicated
  `electroenergetics:mixing/transformer_oil`: the mod JAR uses 250 mB `#c:plantoil` + 250 mB water →
  125 mB transformer oil, heated; the tag includes IE plant oil. The user sees the standard mixing recipe
  during client acceptance; production itself and this new draft have not been checked in game.
  Checked: exact live ZIP, mod JAR recipe, expanded fluid tag, overlapping inputs, MCP dry-run and readback
  (duplicate disabled; standard recipe remains). The writer's “recipe absent” warning reflects stale static
  pack metadata; the live inventory confirms the old ZIP is pinned in snapshot `20261101-190800-fdd3`.
  Source editing does not replace that ZIP. Host: `tfc datapacks unconfirm 9FCAF769A0A2ODuhbgxU`,
  then `tfc datapacks pull 9FCAF769A0A2ODuhbgxU` into the selected test world, restart and check that
  the parse error is gone and standard heated mixing produces oil; only then confirm the new version.

- **Бензин из ароматических фракций Destroy** (2026-11-04, dev #223): карточка `7IHNTyYMc046lNeC0anS`
  («Destroy — нефтехимия и полимеры», revision `2026-11-04T21:12:27.294657Z`) содержит рецепт
  `tfc_plans:create/gasoline_from_destroy_aromatics`: отдельно 50 мБ толуольной смеси с толуолом ≥ 9 M и
  50 мБ ксилольной смеси с этилбензолом ≥ 1.9 M → 100 мБ бензина CDG в Create-мешалке без нагрева.
  JSON, чтение рецепта, отсутствие конфликтов и поддержка ингредиента `destroy:mixture_with_molecule` проверены;
  полный производственный цикл в игре не проверялся. Предупреждение редактора об отсутствующих ID ожидаемо:
  основной snapshot ещё без Destroy, а молекулы — не предметы. Хост: включить «В мир», выполнить
  `tfc datapacks pull 7IHNTyYMc046lNeC0anS` в выбранный тестовый мир с Destroy + CDG, перезапустить,
  проверить оба входа и выход 100 мБ, отказ неподходящих смесей и затем `confirm`.

- **Destroy slice as one update** (2026-11-03, dev #203, acceptance #199): `u20261103-164054-6977` adds Destroy,
  Petrolpark, Destroy Bridge, Destroy Extras 0.3.0 and five datapacks (confirmed by approve); updates EE Extras 2.7.0, JEI 19.55.0.431,
  LDLib 2.2.45, Create Aeronautics 1.3.2. Replaces `u20261103-104332-a97a` (Destroy Extras 0.2.0: Cl₂ port blocked, Vat refused the gases, EMI hid Destroy recipes); the host still has to reject that one. Host: subscribe a separate profile
  on a world copy, run #199, then approve or reject. Bridge jar was rebuilt from source: its sha differs from the stale
  `addon.json` card. Ores: card `mQcIl1urw15ReBw5Xrwh` turns off Destroy nickel and fluorite biome modifiers
  (`neoforge:none`, because `disableWorldGen` is read by nothing in 0.4.6) and adds a TFC fluorite vein; crocoite stays
  in the Nether. Checked: class and mixin links by jar, full-pack server boot, vein registered, ore in
  `#tfc:prospectable`. Not checked: client of the full pack, Survival, veins actually generating in a TFC world,
  override of the biome modifiers taking effect. Polymorph's JEI integration is expected to disable itself.

- **Building generator colours** (2026-10-30, dev #166): builder `block-colors.json` added to `npm run mods`; reaches
  the site after `tfc admin rebuild --pull` + `tfc admin publish --live`. Until then the generator page (stage 4)
  computes colours in the browser.

- **KubeJS 18 errors** (dev #157): 16 concrete errors fixed by overlay `u20261029-202841-ca8c`
  (`fluid_stack` → `neoforge:single` for water). Host: `tfc admin updates pull u20261029-202841-ca8c`, restart,
  check all 16 cement recipes and KubeJS log, then approve that update. Two other errors are bundled Flight
  Control recipes referencing absent Create Addition: site draft **Ионные двигатели — аккумулятор сборки**,
  `CTZcQBggNXDuugbtIReO`, uses the available EE accumulator instead.
  Host: `tfc datapacks pull CTZcQBggNXDuugbtIReO` into the selected world; check both ion thrusters, then confirm
  only after game verification. Smooth-stone datapack does not appear in these errors. Static checks only;
  full-pack reload and machines not checked in game. Details: [concrete patch](../../pack-patches/concrete-lime/README.md).

- **Euphoria Patcher missing shader** (dev #150): popup-suppression update `u20261029-193554-dd27`
  rejected on 2026-10-29. Do not apply it in bulk; investigate installing matching Complementary r5.8.1 instead.
  The rejected proposal remains available by explicit ID for inspection.

- **Гладкий камень на камнерезе и в прессе** (2026-10-29, dev #151): site datapack `wbgmlRWP5X9h8pWQb5bQ`
  (ns `tfc_plans_smooth`, built by `npm run datapack:smooth -- --upload`). Recipes: stonecutter 1:1 for every
  `tfc:chisel` smooth-mode stone block (smooth rocks from raw/hardened, chiseled bricks, smooth/cut sandstone, polished
  alabaster, Firmalife sealed bricks), plus slab ×2 / stairs ×1 / wall ×1 from each such block that has a crafting-table
  shape (smooth rocks, smooth and cut sandstone; 185 recipes in all); Create compacting `heated`: raw rock → smooth
  rock, no fluid (a single input no other basin recipe uses, so Create never has to pick between recipes).
  `recipe_conflicts` clean. Host: flag «ставить», `tfc datapacks install`, check in game, then `confirm`. Not
  checked in game.

- **Кирпичи в прессе и известь из флюса** (2026-11-03, dev #210): site datapack `YHGvlo1ukbFQ5TQAUS3W`
  (ns `tfc_plans_factory`, built by `npm run datapack:bricks -- --upload`). Every crafting-table 3×3 mortar brick block
  now also comes out of a Create press over a basin at the hand recipe ratio — 5 bricks + 4 mortar → 4 blocks
  (Firmalife tile bricks 5 + 4 → 1): 21 TFC rock bricks, clay, fire, alabaster, Firmalife tile, Beneath polished
  blackstone and nether bricks, 28 recipes, so a factory line no longer needs nine mechanical crafters. Plus Create
  mixing 500 mB water + 1 flux → 500 mB limewater, the same «flux or lime» input the TFC barrel and the IE mixer use
  (Create only knew lime). `recipe_conflicts` clean; recipes read as «Прессование в чаше» in JEI. The site editor warns
  «нет в сборке: tfc:limewater» — a false positive: the checker only knows items, and limewater is a fluid (the same
  wording appears for any fluid output). Host: flag «ставить» is on, `tfc datapacks install`, check a press cycle and a
  flux-only mix in game, then `confirm`. Not checked in game.

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
  сохранён; возврат 25% порошка Diesel Generators убран. Обновление одобрено хостом; ошибки цветных жидкостей исправляются накладкой dev #157 выше.
  Проверка рецептов/бочек/смесителя/дорог и журнала KubeJS в игре остаётся за хостом. Проверены 52 рецепта и 36 удалений, конфликты MCP, код IE/RnR/CDG;
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
- **Better Fluids 1.3.0** (dev #253): install on the server and clients. In survival, check the fluid tap's model
  and filling an IE jerrycan from a Create tank.

- **Small Diesel 1.0.3** (dev #243): install on the server and clients. Check refueling both blocks by
  right-clicking with a partly filled IE jerrycan, then check withdrawal from a full tank and the client tooltip.

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
- **EE Extras 2.7** (2026-11-03, `ee-extras-2.7.0.jar`, IE floodlight on the duplex cable, cable converter): host runs
  `tfc pull addons` (server and players) and `tfc publish`. In game: a converter on an IE multiblock power port.
- **M11 industrial PCBs** (2026-11-03, dev #22): host installs EE Extras 2.9.0 with `tfc pull addons` and Destroy
  Extras 0.4.0 with `tfc addons install destroy_extras` on server and players, then runs `tfc publish`. Test complete
  manual Survival L2/L3 lines with reusable designs and the required EE power. Draft datapack `Nh1ATmqCY92Hao48hOAQ`
  remains `install=false`: test it in a selected world before live confirmation; no pack-wide confirm was performed.
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

## EE Extras 2.12.0 — питание CC: Tweaked (dev #247)

Host: install on the server and clients with `tfc pull addons ee_extras@2.12.0`, then publish the pack snapshot.
Verify the cable inlet on an existing computer and the charging station with both pocket tiers using the live
pack profile. Existing desktops need an inlet and existing pocket computers start with an empty battery.

## EE Extras 2.11.0 — пластики и цветной дисплей CC (dev #246)

Host: install Destroy 0.4.6 + Petrolpark 1.5.11 and EE Extras 2.11.0 on the server and clients, pull the current M12
datapack `tcegd3kspq62oHuM3YmF` into a test world and check the heated ABS/PET processes, the 450 K Vat PET reaction,
RGB phosphor and the updated computer/case/display recipes in Survival. Only then confirm the datapack for the pack.
The reduced dedicated-server stand passed 73/73 recipes, 280 CC checks and produced 7 PET; it was not a full pack boot.

## EE Extras 2.10.1 — внешний вид электроники (dev #216)

Host: install `ee_extras@2.10.1` on the server and clients; inspect the 28 item textures and five block models in the client. Dedicated-server behavior, resources and offline renders were checked. No recipe or gameplay changes.

- Dev #221: install EE Extras 2.10.2 on the server and all clients; check steel PS and stranded copper M wire appearance, including existing tensioned lines.

- Better Fluids 1.2.0 (dev #233.2–3, #233.5): host installs the jar on the server and clients, checks connected textures,
  the shapes and slab orientations in the client, wrench interactions and stonecutting in the pack, then publishes a pack snapshot.

## ComputerCraft components (dev #248)

Host: install EE Extras 2.13.0 on the server and clients. Pull M12 (`tfc datapacks pull tcegd3kspq62oHuM3YmF`) into a
test world with Destroy 0.4.6, Petrolpark 1.5.11 and M6/M10/M11. Test the magnetizing coil, cone, sulfuric acid dilution
and filling, battery and cartridge in Survival before confirming the pack version. The missing insulation tag for the
pre-existing cable and storage bay is tracked in #259.
