# State: pack addons

Part of [STATE.md](../STATE.md). How to build addons — [docs/addons.md](../addons.md). Site page `/addons` (since
2026-10-16; old `/reference?tab=addons` redirects; jars for download in `/addons/`). Since 2026-10-22 each addon has a
page `/addons/<mod>`: card `tools/<mod>/addon.json` (+ jar, `icons/`) in git, description — Firestore guide
`addon-<mod>` (section `addon`, widget `::addon-block`), editable on the site; development — skill `addon-dev` (2026-10-22), release — skill `addon-release`, MCP
`addons_list` / `addon_check`. Texts moved from the former `src/lib/addons.ts` as is (signed Claude). What still waits for the host or a
game check — [pending.md](pending.md).

## Versions (since 2026-10-23)

Task «Написание чендж логов для наших аддонов, и их поддержка в генераторе патчноута» (group «Разработка»), plan doc
`cL333UUFwvGiTEcLq8RK`. Each addon version is a Firestore doc `addonVersions/{mod}@{ver}` (`src/lib/addonVersions.ts`):
changelog for players, status draft/released/withdrawn, checked + note, jar {file, sha256, size}; players edit on the
page tab «Версии» (revisions kept; rules: site may change only text fields). Jars of all versions are pack-server blobs
(not in git anymore; the card keeps `sha256` of the current one, `scripts/addons-index.mjs` fetches it). `tfc pull addons
<mod>@<ver>` installs and pins a version (`state.addonPins`), `@latest` unpins, withdrawn versions are skipped; `tfc
addons`; `tfc admin addon upload`. `pack-release.mjs` adds addon changelogs for «from < v ≤ to» (`changelogSources:
addon`, `formerIds` for ee_rectifier → ee_extras, rollback marked); `/updates` fills old records client-side and marks
«наш аддон»; the patch-note prompt has a «## Наши аддоны» section. MCP `addon_versions`, `addon_version_get/put`;
`addon_check` checks the record.

- Migrated 2026-10-23: 21 versions with changelogs written from git history and this file (EE Extras 1.0.0–2.3.3 incl.
  EE Rectifiers 1.0/1.1 without jar, Small Diesel 1.0.0–1.0.1, Miner Tools 1.0.0–1.1.0, Stress Fix, Host Fix, EE Overheat,
  IE Extras 1.0.0); 19 jars extracted from git history and uploaded to the pack server (all present, one download
  checked by hash). **EE Extras 2.2.0 jar says 2.1.2 inside** (`neoforge.mods.toml` not bumped back then) — noted on
  the version.
- Checked: local pack server (`/site/addons`, upload refusals), `tfc` against it in a scratch folder (latest, pin 2.3.1,
  plain pull keeps the pin, `@latest`, no key → static index, explicit version without key refused), `pack-release
--dry-run` on fake previous manifests (2.3.1 → 2.3.3; ee_rectifier 1.1.0 → ee_extras), site on the dev server.
- VPS updated 2026-10-23 (`/opt/tfc-plans` git pull + `deploy/install.sh`, service restarted): live `/site/addons` lists
  all versions (401 without a key), `tfc admin addon upload` — same jar «уже записана», mismatched 2.2.0 jar refused
  (409), `tfc pull addons ee_extras@2.3.1` from the live server installed the jar with the recorded hash.

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

## Create Aeronautics Extra (`tools/create-aeronautics-extra-mod`, 2026-10-24)

Task «Бортовой компьютер» (`rgLoQS8DcOgxbm7r4401`, group «Разработка»; plan doc `3whWeABl6xVMiKF7MTPL` by DeepSeek —
its 0.1.0 code was lost, rewritten from scratch by Claude). **1.0.0**: onboard computer — Create shaft in the back,
EE «+»/«−» terminals, up to 4 modules (right-click to insert, sneak + empty hand to take the last; block drops them).
Generator module = compact generator numbers (6 W, 8 SU, 0.5 V per rpm; stress via `calculateStressApplied` +
`updateStressFor` on change). Battery module = EE `AccumulatorProperties` cell (24 V, 0.1 Ω, `maxAccumulatorCharge`
36 000 C), n cells in parallel (`BatteryPack`: R/n, current split); generators charge it directly; charge kept in the
BE, on the item as data component `charge`. Device `OnboardDevice` is stateless (reads the BE each tick).

- **Ships:** Aeronautics ships are Sable sub-levels whose blocks live in plot chunks of the same ServerLevel (sable 2.0.5
  `ServerLevelPlot`), and EE moves its nodes/wires/devices on assembly (`SubLevelAssemblyHelperMixin`) — so no
  contraption code is needed (DeepSeek's plan assumed Create contraption entities — wrong for this pack).
- Dev server (`./test-server.sh`): generation/charge/discharge match formulas (≤ 0.5 %), stress 8 SU/rpm per generator,
  battery-to-battery over wires, restart, drops. `SABLE=1` (server on NeoForge 21.1.251 + sable jar): `/sable assemble
area` of the stand — keeps working on the plot. Terminals 24/24. Not checked in game.

- **Texture sources (dev #135, 2026-10-29):** battery and generator modules are simple rectangular 32×32
  cassettes matching the onboard computer: flat graphite panels, thin brass trim, square contacts or copper windings.
  User direction: simple straight geometry, minimal shading, no rounded machines or decorative highlights.
  Each sprite uses 12 colours including transparency. ImageGen originals and prompts in
  `art/sources/` and `art/modules.md`; generator preserves finished item PNGs. Prepared for the next release;
  published 1.0.0 unchanged. Client appearance not checked in game. Onboard-computer modules approved by the user; Pyrofuel sources described below.

## IE Extras (`tools/ie-extras-mod`, 2026-10-23)

Blocks and features for Immersive Engineering (task «Аддон для блоков и функций IE», group «Разработка»; the user's first
candidate — a heater regulated by an analog lever). Depends on TFC 4.2.9 + IE 12.4.2 (both required), NeoForge 21.1.234+
(TFC's own minimum; built on 21.1.251 from the Gradle cache).

- **1.0.0**: analog heater `ie_extras:analog_heater` — FE in from any face but the grille (1024 FE/t, 32 000 buffer, no
  output), target = redstone signal / 15 × `maxTemperature` (1600), draw = `fePerTickAtMax` (32) × signal / 15 per tick;
  own temperature follows `HeatCapability.adjustTempTowards` (1 °C/t) and is pushed each tick to the block in front by
  `HeatCapability.provideHeatTo` — the charcoal forge path, so any `BlockCapabilities.HEAT` consumer works (TFC crucible;
  by bytecode also Firmalife vat, stovetop pot/grill, oven top, Cast Iron Grill — not tried). Piston-like placement,
  comparator = temperature 0–15, right click = status. Looks: IE external heater textures (grille, socket) by reference
  - own side panel; up/down use own models (no x-rotation) so the side dial stays upright. Server config
    `ie_extras-server.toml` `analogHeater`.
    Dev server (`./test-server.sh`, `/ietest`, crucible with a copper ingot, signal via comparator from a chest): signal 10
    → 1067 °C, ingot intact; 11 → 1173 °C, 100 mB copper; draw 22/24/9 FE/t; cools without energy; FE caps on 5 faces.
    Not checked in game.
- Findings: the TFC crucible accepts only temperatures above its own (`CrucibleInventory.setTemperature`) and cools via
  the TFC calendar — with no players the calendar stands (`arePlayersLoggedOn`), `checkForCalendarUpdate` calls
  `onCalendarUpdate(-1)` every tick and cancels the 1 °C/t decay, so on the dev server the crucible never cools. A
  vanilla comparator placed before its input container keeps `OutputSignal` 0 until a neighbour changes (devtest places
  the comparator first). Pack metals above 1600 °C: only tfc_alloy_ext inferior aluminum (1653); IE aluminum is
  1550 via `kubejs/data`.

## Miner Tools (`tools/miner-tools-mod`, 2026-10-21)

One mod for all miner gear.

- **1.0.0** — miner belt: don't pick up pebbles/gravel/dirt, 9-sample filter via RMB, Shift+RMB toggles, Curios «belt»
  slot added to the player, Sophisticated Backpacks don't grab them either. 31 checks on the dev server; not in game.
- **1.1.0** — miner helmet: steel helmet (head slot or Curios «head»), 100 000 FE battery (FE capability like IE items:
  IE charging station and power pack charge it), lamp 2 FE/t (Shift+RMB / key H), light via LambDynamicLights by
  component `miner_tools:lit`, falling-block hits (`#minecraft:damages_helmet`; TFC collapse is the same
  `falling_block`) −50 %. GeckoLib model from Mining Helmet (CysticTurtle85, MIT), own texture. 28 dev-server checks
  (with IE: station charged to full); **not in game** (model, light, key).

## Host Tools (`tools/host-tools-mod`, 2026-10-25)

Task «Аддон Host Tools: /host …» (group «Разработка», `T7JkNmHajlZVKrT0XAgt`). 1.0.0 released: `/host` (57016 from
config), `/host <port>`, `/host random` (random free ports 20000–45000, up to 30, one attempt per server `TickTask`,
progress in the action bar), `/host stop` / pause-menu button «Закрыть для сети» (kick guests, close the TCP channel
from `ServerConnectionListener.channels`, mixin on `IntegratedServer` resets `publishedPort`/`lanPinger`), `/host
status`, `/ping`, ping numbers in the tab (`@ModifyConstant` 13 + `@WrapOperation` around `renderPingIcon`; works with
Watut's `@Redirect` of the same call), latency rebroadcast every 100 ticks, ShareToLanScreen port preset.

- First draft attempted ports from `ServerTickEvent`: an unpublished host world on pause (menu, window unfocused)
  doesn't tick, so `/host` waited until the menu closed — moved to server tasks, which run while paused.
- First real-dev-client addon check: `test-client.sh` runs `runClient` with a devtest mod that creates a flat world,
  drives commands/screens, connects raw sockets (status ping, hanging login) and saves screenshots; `HTTEST` lines.
- **1.0.1** (2026-10-25): guest ping was 0 and the tab had no numbers in the host's game. Cause: **Packet Fixer**
  `@ModifyConstant(15000L)` in `ServerCommonPacketListenerImpl.keepConnectionAlive` → its `timeout` (120 s default)
  is the keep-alive _interval_; latency starts at 0 and is smoothed ¾ old + ¼ new, so ~0 for 2 min and ~10 min to
  converge. Fix: `PingProbe` — own `ClientboundPingPacket` (id tagged `0x4854xxxx`) every `probeTicks` (40), mixin on
  the empty `handlePong` (network thread) writes (old + sample) / 2 into `latency`; vanilla clients answer by
  themselves. Dev client with Packet Fixer + Watut: 11–13 ms on the host's own memory connection
  (`-Dhost_tools.probeOwner=true` in the test run).
- Not checked: a real guest over the network, Windows (host). Host's original complaint «по 10 раз нажимать» — cause
  not confirmed; if a port binds but friends can't connect, `random` doesn't help (network side).

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

## TFC Pyrofuel (`tools/pyrofuel-mod`)

- **1.0.0** (2026-10-27, dev #104): five materials (pyrocoke mix, soaked pyromass, raw/finished briquette,
  stabilizing additive), raw and finished pyrogel fluids with buckets. Recipes use IE coke/creosote, Create cinder
  flour, CDG diesel, TFC graphite/flux; normal heat bootstraps both branches. Briquette = 3200 ticks superheat;
  CDG liquid burner uses pyrogel, multiplier 1, superheat above 80% valve opening, full-open consumption 1 mB/10 ticks.
  Standard fluid capabilities; no world placement, sediment, spontaneous ignition or tank explosions.
- Old cake recipes disabled; existing cakes stay usable and convert 1:1 to briquettes. Cinder flour Russian name
  becomes «Незераковый порошок». CDG engine parameters provide zero useful stress capacity; finite dummy speed avoids
  CDG division by zero (fuel is intended for burners, not engines).
- API verified by MCP: Create 6.0.10 `BlazeBurnerBlockEntity.tryUpdateFuel`, CDG 1.3.8 `BurnerBlockEntity` and
  `FuelType.CODEC`, NeoForge 21.1.251 fluid/bucket API. Dedicated-server checks passed: recipes, briquette SPECIAL, heat=2.0, 84/100 mB after 8 s, actual pipes/pump
  (64 rpm imposed by the test fixture), empty shutdown, bucket transfers and 1900 mB retained across restart. Client rendering, complete factory automation and full-pack compatibility: not checked in game.
- Separate pre-existing CDG/IE recipe parse errors found during testing: dev #118.

- **Texture sources (dev #135, 2026-10-29):** all seven item sprites replaced; six at 32×32 and the user-selected finished
  briquette at 64×64 (three orange inclusions), with 15–16 colours including transparency.
  Earlier forced 16×16 conversion and fixed tiny palettes discarded contour/material details; no separate mask
  exists in their single-layer item/generated models. Alpha bounds and proportions are preserved. Native TFC/IE powders, Create fuel colours and
  CDG bucket silhouette used as references. Raw/finished fluid tiles use 4/5 colours; eight-frame still/flow
  animations assembled deterministically. Source art, prompts and palettes in `art/`; resource generation
  preserves item PNGs. Prepared for the next release; published 1.0.0 unchanged. Not checked in game.

## Item texture workflow (dev #132, 2026-10-28)

`addon-dev` now routes new item artwork through image generation with inspected pack references, a detailed source,
transparent output and a separately prepared runtime PNG. Instructions live in
`.claude/skills/addon-dev/references/item-textures.md`; procedural asset scripts remain for technical patterns and
assembly. Native-size and inventory previews are required; no fixed 16×16 limit. This updates agent instructions
only; existing addon textures and in-game appearance were not changed or tested.

Dev #135 (2026-10-29) records the user preference in the skill: simple pixel shapes matching the parent mod or host
block, flat planes and restrained palette, functional material cues instead of simulated rounded forms, decorative
highlights or noise. Approved visual example: onboard-computer cassettes in `tools/create-aeronautics-extra-mod/art/`.
