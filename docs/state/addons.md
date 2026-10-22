# State: pack addons

Part of [STATE.md](../STATE.md). How to build addons — [docs/addons.md](../addons.md). Site page `/addons` (since
2026-10-16; old `/reference?tab=addons` redirects; jars for download in `/addons/`). Since 2026-10-22 each addon has a
page `/addons/<mod>`: card `tools/<mod>/addon.json` (+ jar, `icons/`) in git, description — Firestore guide
`addon-<mod>` (section `addon`, widget `::addon-block`), editable on the site; release — skill `addon-release`, MCP
`addons_list` / `addon_check`. Texts moved from the former `src/lib/addons.ts` as is (signed Claude). What still waits for the host or a
game check — [pending.md](pending.md).

## EE Extras (`tools/ee-extras-mod`)

Before 2.0 — EE Rectifiers, `ee_rectifier`; old blocks migrate to new ids via aliases.

- **1.1**: three- and single-phase rectifiers without diodes — stable at any rpm (solves the microTicks = 1 diode
  instability). Verified on the dev server with a real generator.
- **2.0** (2026-10-21): bidirectional EE ↔ FE converter (4 terminals: charging and discharging an IE capacitor
  simultaneously), laying EE two-wire cable (in EE 1.1.2 the spool doesn't lay cable — checked in bytecode), four-core
  cable, L1/L2/L3/N connector, insulators for two- and four-core cable; four-core can attach to the EE two-wire
  connector (neutral + phase, wrench switches phase). Verified on the dev server (with IE): electrics, cable integrity,
  restart, world migration from 1.1, terminals 216/216. **Not checked in game with a player; models not loaded by a
  client.** The host snapshot of 2026-10-20 still has ee_rectifier (1.x).
- **2.0.2**: own two-core cable model (EE 1.1.2 lacks the model its wire references — was purple/black), spool
  highlight and «dashed» preview (written in EE but never called) + cable terminal label under the crosshair; rubber
  terminal drawn for the EE connector (its models overridden); both connectors — 4 wrench positions instead of 2,
  placed terminal-towards-player (on walls — up); EE connector with wires is not rotated by wrench. Dev server
  (`rectest orient`, terminals 300/300).
- **2.1**: power-line and heavy-current wires — copper busbar, power cable, M, AC, A, bronze, PS (own resistance,
  current, span up to 256 blocks, sag), tension clamp (tension up to material limit), EE iron wire sags less; phase tap
  (four-core → phase + neutral, wrench picks phase). Dev server (`rectest lines`, `tap`).
- **2.2** (2026-10-22; tasks «Сделать выпрямители разной мощности», «Добавить инверторы разной мощности», group
  «Разработка»): rectifier rating and heating like the EE variac (light — 6 kW, smoke above, burn from ~135 %; double
  headroom in oil), heavy rectifiers 48 kW (full block with radiators and bushings), grid inverters three- and
  single-phase, light and heavy (lock to generator phase, feed when DC voltage × 1.05 / 1.57 exceeds the grid; without
  a grid — own 1 Hz AC). Dev server with a real generator (8 and 100 rpm).
- **2.3** (2026-10-22; task «Сделать компактные генераторы», group «Разработка»): compact generator — one block, Create
  shaft in the back face → DC terminals on top; 6 W and 0.5 V per rpm (256 rpm — 1.5 kW at 128 V), 8 SU per rpm
  (efficiency 75 %; EE generator ~99 % by bytecode: 48 × magnets × rpm W vs 48 × (magnets + 0.125) SU/rpm), heating
  rating 1.2 kW (smokes above ~200 rpm at full load, doesn't burn). Dev server from a creative motor
  (`rectest kgen|krpm|kreport`): U²/R exact, cap at 1 536 W, stress 8 SU/rpm; terminals 720/720.
- **Insulator-string «fan» — fixed in 2.3.3 (closed)**: the host's `/eeextras wires` showed 971 segments in
  the one garland's visual. EE 1.1.2 `QuadraticWireHelper.wirePointsRaw` (used only by `WireVisual.recreateInstances`
  for wire types without `shouldScaleLast`, i.e. hanging insulators) appends to the reused `WirePoints` buffer without
  `clear()` (unlike `wirePoints`), so every move/light update keeps the old points. `WirePointsRawMixin` (common)
  clears it at HEAD; dev server: 3 recomputes 27 points without the fix, 9 with it. **Host confirmed in game
  2026-10-22: no more fan.** The earlier
  thread lock and sweep (below) stay — harmless. `WireDiag` counted every segment as orphan on the indirect backend
  (`isVisible()` is false for page states) — fixed.
- Earlier attempts: a swinging EE hanging glass insulator string leaves frozen copies until relog.
  2.1.0 wrapped `WireVisual.recreateInstances` (Flywheel calls it from frame and light plans in parallel); 2.1.2
  wraps `beginFrame`/`updateLight`/`delete` + sweeps segments dropped from the visual's lists, logs «исправление …
  применено». Host log 2026-10-22: mixin applied, fan still there — so the cause is elsewhere. **2.3.2**: client
  command `/eeextras wires` (`WireDiag`) compares EE client wire list, Flywheel wire visuals (orphan / duplicate /
  not updated > 2 s) and Flywheel instance counts per model; waiting for the host's log with it. Also ask whether
  F3+A (full Flywheel reset + EE `recreateVisuals`) clears the fan. Host plays a host world (integrated server) with
  Sodium, Iris (shaders off), Sable, Liubai (Flywheel limiter), Voxy.
- Finding: EE 1.1.2 lacks model `block/duplex_wire_segment` (used by `CEEPartialModels.DUPLEX_WIRE_SEGMENT` and by the
  EE Extras two-core cable shell) — from jar, not checked in game.
- Site icons are drawn by the shared generator `scripts/mcp/render.mjs` (4× AA, no seams), called by
  `tools/ee-extras-mod/release.sh`; `art/iso.py` removed. Icons redrawn in 2.3.1 (no longer mirrored).
- **2.3.1** (2026-10-22, user's request «ближе к реальным приборам»): looks only. Compact generator — foot-mounted
  TEFC-style machine, axis along FACING, terminal box on the −Z side of the model (up when the shaft is horizontal):
  `Layout.COMPACT_GENERATOR` moved to {6.5, 0.5}, {9.5, 0.5} at height 8.5 (placed wires re-render to the new spot).
  Light rectifiers/inverters — power module on a finned heatsink with terminal strips; heavy — floor cabinet (door,
  louvres or fan, heatsink, bushings). Models built by `art/machines.py` on `art/kit.py` (per-face materials, auto
  atlas, roll transform; same kit in small-diesel-mod). Terminals 720/720, resources_check clean; not checked in game.

## Small Diesel (`tools/small-diesel-mod`, 2026-10-22)

Addon to Create Diesel Generators (a separate mod at the user's request; same task as EE Extras 2.3). Fuels and their
numbers come from the CDG registry `createdieselgenerators:fuel_type` (`normal` engine: 1 mB = strength / burn_rate
SU·tick, by CDG 1.3.8 bytecode).

- **1.0.0**: small diesel engine — CDG engine speed, ¼ of its capacity (diesel 1 536 SU at 96 rpm), fuel burned by
  network load (load = network stress / capacity × capacity × ticks), nothing when idle; small diesel generator (only
  with EE, optional dependency) — DC 100 V, up to 1.5 kW, 75 % efficiency (same as engine + compact generator), heating
  rating 1.2 kW. Dev server (`./test-server.sh`, `/sdtest`): burned fuel = load × capacity × time to the SU·tick at
  12.5 % and 37.5 % load, 0 mB idle, stops on empty tank, tank rejects water; generator burned = delivered (≤0.3 %),
  cap 1 500 W; loads without EE (engine only); terminals 24/24. No engine sound. Not checked in game.
- **1.0.1** (2026-10-22): looks only — engine as a horizontal single-cylinder diesel (S195-like: radiator at the
  cylinder end, tank, filter, muffler, flywheel at the shaft, skids; hitbox height 13 → 15), generator as a genset on a
  frame (diesel + alternator + terminal box): `Terminals` moved to {12.25, 6}, {12.25, 10} at height 14. User rejected
  a coarse brass radiator grille — now dark core with fine fins. Terminals 24/24; not checked in game.

## Miner Tools (`tools/miner-tools-mod`, 2026-10-21)

One mod for all miner gear.

- **1.0.0** — miner belt: don't pick up pebbles/gravel/dirt, 9-sample filter via RMB, Shift+RMB toggles, Curios «belt»
  slot added to the player, Sophisticated Backpacks don't grab them either. 31 checks on the dev server; not in game.
- **1.1.0** — miner helmet: steel helmet (head slot or Curios «head»), 100 000 FE battery (FE capability like IE items:
  IE charging station and power pack charge it), lamp 2 FE/t (Shift+RMB / key H), light via LambDynamicLights by
  component `miner_tools:lit`, falling-block hits (`#minecraft:damages_helmet`; TFC collapse is the same
  `falling_block`) −50 %. GeckoLib model from Mining Helmet (CysticTurtle85, MIT), own texture. 28 dev-server checks
  (with IE: station charged to full); **not in game** (model, light, key).

## Create: Stress Fix (`tools/stress-fix-mod`, 2026-10-22)

After relog water wheels stopped and the network showed millions of SU load: Create accumulates an «unloaded part»
remainder from totals that blocks saved. The addon zeroes it when the whole network is in ticking chunks, logs it;
`/stressfix [recalc]`. Bug reproduced and fix verified on the dev server; **not in game or with the full pack**; the
source of the group's mismatch is not established from their logs.

## TFC Real World: Host Fix (`tools/rw-host-fix-mod`, 2026-10-21)

Bug: after the host's death/nether trip everyone is teleported to one point every tick, new chunks are ocean, host
relog helps. Cause (bytecode + host logs): TFC Real World 4.1.4 on client world unload clears static map settings
shared with the integrated server → map 80 000 × 40 000, Eratosthenes computes the base «beyond the pole»
(`northPolarPushback` every tick → Z ≈ −20 100). Mixin on `TFCRealWorldConfig.clearServerConfig` (don't clear while the
server runs); also nether exit beyond the map edge instead of the KubeJS script `eratosthenes_portal_clamp.js` (its ±19 500
limit was for a foreign map and it re-triggered itself). Verified on dev server NeoForge 21.1.251 + TFC + TFC RW
(`test-server.sh`, `/rwtest`).

## EE Heater Overheat (`tools/ee-overheat-mod`)

Mixin on `ResistiveHeaterBlockEntity.calculateHeatLevel` — at heat ≥ 0.9 (~6.8 kW) returns SEETHING, so superheated
Create recipes run on the EE heater. Built against stubs (`./build.sh`, JDK only). **Not checked in game.** Goes into
`mods/` of server and clients. With it `steel_heated.js` is unnecessary (but harmless).

## TP Trace (`tools/tp-trace-mod`)

Diagnostics, not for the pack: logs player position jumps and teleports with a stack trace. Verified on the dev server;
only the jar on the site (`/addons/tp-trace-1.0.0.jar`), not in the addon list. Found the World Border nether limit (see
[pending.md](pending.md)).
