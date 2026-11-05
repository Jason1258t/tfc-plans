# State: pack addons

Part of [STATE.md](../STATE.md). How to build addons — [docs/addons.md](../addons.md). Sources since 2026-10-29 — repo
[tfc-addons](https://github.com/Jason1258t/tfc-addons), the `tools/` submodule here (dev #138). Site page `/addons` (since
2026-10-16; old `/reference?tab=addons` redirects; jars for download in `/addons/`). Since 2026-10-22 each addon has a
page `/addons/<mod>`: card `tools/<mod>/addon.json` (+ jar, `icons/`) in git, description — Firestore guide
`addon-<mod>` (section `addon`, widget `::addon-block`), editable on the site; development — skill `addon-dev` (2026-10-22), release — skill `addon-release`, MCP
`addons_list` / `addon_check`. Texts moved from the former `src/lib/addons.ts` as is (signed Claude). What still waits for the host or a
game check — [pending.md](pending.md).

## In development

- **Destroy Extras 0.7.0, dev #212**: 18 pure metal and alloy dusts and a pack overlay for five briquette sizes,
  crushing, arc furnace and TFC heating. The full dedicated stand registered all 543 audited recipes, with the old
  crushing and 1:1 smelting recipes absent. Candidate `u20261105-181849-3fa9` includes both the jar and recipes and
  awaits test-profile acceptance. The Destroy update already on acceptance (#199) keeps its own version.

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

## Destroy Bridge + Destroy Extras (`tools/destroy-bridge-mod`, `tools/destroy-extras-mod`)

2026-11-03 (dev #209, #208): **Destroy Extras 0.3.0** — Cl₂ also from the bottom of the controller (the south port is behind the 3×3×2 shell), H₂/Cl₂ as `destroy:mixture` (the Vat refuses `destroy:gas`; old stacks convert on load), EMI shows all Destroy categories via two mixins. Earlier checks put mixtures into the Vat by code and missed this; `M10Test` runs the route through real ports up to an L1 board, client stand uses JEI 19.55 + EMI (centrifuge 3 recipes). Full-pack client, flows through Create pumps and in-game not checked.

Dev #22, plans 37–38. Destroy Bridge remains the 0.1.0 development dependency; **Destroy Extras 0.2.0 and EE Extras
2.6.0 are the released M6 vertical slice**. The owner selected the Destroy hybrid: Destroy owns molecules/mixtures/reactions,
Bridge owns only the TFC/EE/Create boundary, Extras owns missing machines, and PCBs stay in EE Extras. The owner moved the compact EE process from
240 V to **300 V / 8 A** (37.5 Ω, working zone 270–330 V) on 2026-10-31.

- M0: JDK 21 / NeoForge 21.1.251 projects, exact pack jars plus Destroy 0.4.6-eligibbs and Petrolpark 1.5.11 with
  checked SHA-256, compile-only jar-in-jar dependencies, `minimal|thermal|sable`, RCON assertions and deliberate-fail
  handling. Environment checks pass 2/2 in all three profiles; the real Destroy `destroy/reactions` datapack listener
  loads the test reaction, and Castner remains loaded. Thermal still has baseline Wooden Cog/TFC/Create item errors and
  is not a full-pack audit.
- M1: main-code `ProcessPowerDevice` (no world/block/recipe access in simulation methods), `SaltWaterAdapter` (1:1 TFC →
  Destroy mixture, caller-supplied concentrations) and `AtomicFluidOperation` (all outputs simulated before execution).
  Devtest-only blocks use a finite source tank, real NeoForge fluid transfer, EE creative battery and real wires; they
  are absent from the release jar. M1 itself contained only the devtest controller; the production machine arrived in M2.
- Dedicated-server M1 results: 299.827 V / 7.995 A, one 1000 mB batch → 250 mB H₂ + 250 mB Cl₂ + 500 mB NaOH with exact
  components and mass balance (12/12); 200 V sag stops progress after at most one transitional EE tick (7/7); each full
  output blocks the whole operation without partial products (5/5 each); full restart preserves progress, all tanks and
  an exact pre-restart mixture NBT snapshot without repeating output (6/6). Commands and logs are documented in the
  Bridge README.
- M2: Extras now has the production membrane electrolyzer and 64-batch membrane, a datapack-driven three-output recipe,
  directional fluid/item capabilities, five translated status states and JEI integration. It uses the real RecipeManager,
  restores the recipe after reload by id or saved mixture, and executes each batch through Bridge's atomic operation.
  Destroy 0.4.6's gas fluid id is `destroy:gas` (`DestroyFluids.GAS_MIXTURE`), not `destroy:gas_mixture`.
- Dedicated-server M2 results: environment 4/4 and ports 5/5; normal batch 13/13 at 299.827 V / 7.995 A with exact
  products, membrane wear and mass balance; missing/worn membrane 3/3 each; 200 V sag 6/6; each blocked output 6/6;
  restart 6/6. The deliberate-fail scenario exits nonzero. Build and resources/models pass. Client/JEI was not launched.
- M3: the stock 27 000 mB netherite Destroy Vat passes UV HCl synthesis with 1:1:2 stoichiometry (4/4), no-UV control
  (2/2), and direct iron-powder dissolution to Fe(III) (5/5; 9 Fe(III), 13.5 H₂ and 27 H⁺ per powder within Destroy's
  3% numerical drift). No FeCl₂ stage or new machine is needed. HCl synthesis requires UV and thermostat-controlled
  cooling: continuous cooling condenses the gases, while no cooling destroys the Vat by pressure.
- Free Vat absorption in Destroy 0.4.6-eligibbs failed mole conservation, including for an already dissociated
  H⁺/Cl⁻/H₂O mixture. M3 therefore adds Bridge's atomic pure-HCl + water adapter instead: 25 mB HCl + 250 mB water →
  275 mB stock H⁺/Cl⁻/H₂O, exact mole/volume balance (3/3). M4 must use this boundary and not return the acid to free
  Vat simulation. No new fluids or molecules were added.
- M4: Extras adds the no-FE etching bath, a narrow two-item + one-fluid JSON recipe type and JEI category. EE Extras
  owns the development L1 blank/mask/board items and the `pcb_topology` compound component. The bath consumes 250 mB of
  the actual stock Destroy mixture over 400 ticks, transforms 3 Cu with 6 Fe(III) into 3 Cu(II) + 6 Fe(II), preserves
  volume, temperature and all other components, and copies the actual mask topology. Inputs/outputs are atomic; restart
  and block-entity-data loot/replacement preserve tanks, items, recipe and progress. No new fluids or molecules.
- Dedicated-server M4 results: environment 6/6; devtest and real L1 cycles 10/10 each; blocked output 3/3; insufficient
  Fe(III) 2/2; break/replacement 6/6; restart 5/5 at 100 ticks followed by a completed L1 cycle 10/10. M2 normal/ports
  and all M3 regression scenarios still pass. Both addons build; resource and model checks pass. Client/JEI not launched.
- M5: the electrolyzer is now a 3×3×2 industrial assembly of Create fluid tanks and copper casing with the controller
  and a real mechanical pump (≥16 RPM) in the divider. Structure and recipe checks run once per 20 ticks; goggles expose
  status, power, structure and pump speed. Breaking and repairing the assembly stops/resumes safely, and controller loot
  retains the complete block-entity state. A Create mixer above the etching bath (≥16 RPM) shortens L1 from 400 to 200
  ticks. The approved chemistry, fluids and mole balances are unchanged.
- M5 dedicated-server results: shell/RPM 4/4, RPM boundaries 4/4, break/repair 3/3 and controller break 6/6; minimal
  production batch 3/3; thermal M5 3/3 plus mixed etching 11/11. Sable assembly passes 6/6: EE, Create rotation, tanks,
  membrane and production survive the move to a plot. (`shatter` creates sub-levels rather than restoring the original
  world assembly, so it is not an inverse-placement check.)
- M5 load, three 200-second segments with two restarts each: 8 units — 20.018 TPS, MSPT mean/p50/p95
  0.637/0.345/1.453 ms, 472 batches (59 each), 968 status-transition syncs and 641400 NBT bytes; 32 units — 20.008 TPS,
  1.027/0.512/2.247 ms, 1920 batches (60 each), 3840 syncs and 2544160 NBT bytes. Both retain ≥299.752 V and ≤7.993 A;
  no membrane replacement was needed. Sync figures are server transition counts and update-tag NBT payload sizes, not
  measured client network packets (RCON, no players).
- Real dev client passes with JEI 19.56.0.441 (required by Petrolpark 1.5.11, instead of the incompatible pack JEI),
  EMI/Jemi and Ponder: both recipe categories open with recipes in JEI and EMI, and the industrial Ponder opens with
  Russian text. Full-pack production boot passes on NeoForge 21.1.251 with 230 mods: KubeJS startup 6/6 and server 84/84,
  zero script errors; remaining recipe/loot/client-class errors are the known baseline, not M5 regressions.
- M6 adds the installable site datapack `Destroy — Survival-цепочка M6` (`yyMKqD6lIHRQreNWHw6q`) with five recipes:
  electrolyzer, membrane, bath, L1 blank and L1 mask. Conflict audit is clean among 5389 shaped, 128 pressing,
  73 compacting and 1994 shapeless recipes. The bath now has dedicated pure-HCl (south) and water (east) tanks; every
  tick the Bridge atomically converts 25 + 250 mB into 275 mB of stock mixture. North remains spent output and the
  remaining sides the FeCl3 input. No new fluids or molecules.
- M6 checks: recipes 6/6 and absorption 6/6; real old-code/old-world migrations preserve M2 state 6/6 and M4 tanks,
  items and topology 5/5. M2–M5 regression, minimal/thermal/sable, automated real client/JEI/EMI/Ponder and full-pack
  boot pass. Full pack: 230 mods, NeoForge 21.1.251, startup 6/6, server 84/84; known baseline errors remain.
- Released Destroy Extras 0.2.0 and EE Extras 2.6.0 with jars, changelogs, cards, icons and `addon-destroy-extras` /
  `addon-ee-extras` guides; both `addon_check` reports are clean. Manual player-driven Survival playthrough remains
  unverified; later #22 milestones have not started.
- M7 (only #22 checklist item 11) adds the installable site datapack `Destroy — центрифуга: масла и молоко`
  (`Z960zeYuX8oBCtmSR6Na`), using the stock Destroy centrifuge without production-code or addon-version changes. Recipes:
  250 mB olive/canola oil-water → 200 mB water + 50 mB oil; 1000 mB milk → 500 mB cream + 500 mB skimmed milk;
  2000 mB skimmed milk + rennet → 2000 mB curdled milk in a sealed barrel over 4000 ticks; olive paste + 200 mB water →
  200 mB olive oil-water by Create mixing over 100 ticks. Skimmed milk joins `#tfc:usable_in_barrel`, deliberately not
  `#firmalife:milks`, avoiding a cream loop. Centrifugation uses `processing_time: 500` (about 125 ticks at the test's
  64 RPM), Create rotation only and no electricity; input/output volumes balance exactly.
- M7 server checks pass in minimal, thermal and sable: JSON 3/3, olive 5/5, canola 5/5, milk 4/4, mixture 5/5 and light
  output 3/3. Restart preserves two 500 mB outputs and their moles without duplication. M2–M6 regressions and old M2/M4
  world migration pass, including completion of an unfinished M4 batch. Conflict audit is clean.
- M7 real-client check passes and inspected screenshots show the stock centrifuge category with three recipes. Automatic
  Destroy JEI discovery and EMI display are supplied only by a devtest plugin and a test Jemi adapter, not by the release
  jar. Full-pack boot on NeoForge 21.1.251 loads the datapack and 20712 recipes without parse errors in the new files;
  known pack baseline errors remain. No manual Survival playthrough or pack-wide datapack confirmation was performed.
- M8 (only #22 checklist item 12) adds the installable site datapack `Destroy — азотная кислота на никеле`
  (`o7S7tKNgJ18FBdlQBumG`) with one stock Destroy reaction, `tfc_plans:ostwald_process_nickel`. It preserves the faster
  rhodium Ostwald reaction and adds `#c:dusts/nickel` (including IE nickel dust) at preexponential factor 1000 versus 10000. Catalysts are not consumed. No production code, addon version, items, fluids, blocks or machines changed.
- Jar audit: an open Vat vent supplies 78.084% N2 + 21.916% O2 without an air-separation machine; sulfur oxidation,
  platinum-catalysed contact process (not zeolite), SO3 hydration and iron-catalysed Haber are already stock Destroy.
  AFC latex + TFC sulfur already makes rubber bars, and EE already uses them for insulated/heavily insulated wires, so
  no rubber recipe changes were needed. Plan 29's zeolite/extra-machine assumptions do not match the candidate jar.
- M8 dedicated-server checks pass in minimal and thermal: air 2/2, sulfur at 750 K 3/3, contact at 700 K 4/4,
  hydration 3/3, Haber at 700 K 4/4, rhodium and nickel Ostwald at 400 K 4/4 each (nickel in thermal), no-catalyst
  controls and restart. M2–M7 regressions, build, devtest compilation and resource checks pass. Destroy phase changes
  cause numerical mole drift: contact allows 5%, Ostwald is compared with a same-phase no-catalyst control, and restart
  compares restored substance amounts rather than exact temperature components. No manual Survival playthrough or
  pack-wide datapack confirmation was performed.
- M9 (only #22 checklist item 13) adds the installable site datapack `Destroy — нефтехимия и полимеры`
  (`7IHNTyYMc046lNeC0anS`) with two tags and five Create/EE consumer recipes. Stock Destroy distillation, styrene/cumene
  chemistry and Vat precipitation produce PE, PP, PVC and SBR; no production code, machines, molecules, fluids, items or
  addon versions changed. SBR joins `#tfc:rubber`; all four polymers join `#tfc:insulation`; AFC entries are optional.
  Create belts/hose pulley use rubber and both EE insulated wires use insulation. Fuel fractions and epoxy are out of this
  slice. IE keeps only its existing acetaldehyde + creosote phenolic-resin route because stock Destroy mixtures cannot be
  passed losslessly into IE Refinery by plain JSON.
- M9 dedicated-server checks pass in minimal and thermal: stock chemistry 9/9, consumers 11/11, each polymer 2/2,
  no-AIBN control 2/2, styrene and cumene 2/2 each. The fixture fills the 27 000 mB Vat: a single bucket dilutes the
  reaction below Destroy's synchronization threshold and does not produce a reliable assertion. No manual Survival
  playthrough or pack-wide datapack confirmation was performed.
- M11 (#22 checklist item 15) releases **Destroy Extras 0.4.0** with L2/L3 etching in the existing bath. A prepared
  blank and a valid reusable design of the matching level are required; the design is not consumed and the full
  topology/vias are preserved. Each batch uses 250 mB FeCl3, 800 ticks (400 with a mixer at ≥16 RPM), 6 Cu moles for L2
  and 9 for L3; the old L1 route and stock Destroy chemistry are unchanged, with no new fluids or molecules. Draft
  datapack `Nh1ATmqCY92Hao48hOAQ` now contains the twelve M11 recipes and remains unconfirmed with `install=false`.
- M11 dedicated-server checks pass for complete L2/L3 cycles, invalid/missing inputs, blocked outputs, voltage sag,
  break/replacement and two-stage restart. L1/M4/M10 regressions, old-world migration, both release builds and resource
  checks pass. No manual Survival playthrough or live pack-wide datapack confirmation was performed.

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
- **2.4** (2026-10-29; dev task #143 «Доработка ie фонариков»): the IE electric lantern joins the EE grid — clicking a
  placed IE lantern with the EE duplex spool replaces it with `ee_extras:electric_lantern` (IE models by reference,
  drops the IE lantern, no own item; refused while IE wires are attached) and lays the cable on. For the cable it is a
  duplex insulator (all cables joined core to core → lanterns in a line), plus a 1000 Ω load between the cores; lit
  from 50 V with a 40-tick hold (no AC flicker), EE spawn prevention (20 blocks), no burnout; wrench flips stand/hang.
  IE is now in `libs.sh` (compile only; the mod loads without IE). `test-server.sh` takes `RCON_PORT`/`SERVER_PORT`
  (another worktree's server on 25599 took this session's RCON commands once). Dev server with IE
  (`rectest lanterns|lanternpower|lanternreport|lanterncut|lanternie`, `KEEP=1`): real click path, 230 V lit
  52.9 W, 30 V dark, 60 V AC lit, cut — IE lantern dropped and the tail dark, IE-wired refused, restart kept. Not in
  game: looks, light, flicker on a real generator.
- **2.10.0** (2026-11-04; dev #22, item 55 / M12): thirty CC/CCBR components built on the L1/L2/L3 PCB chain, a magnetic disk medium and industrial recipes for all stock CC devices and both CCBR circuits. Device and circuit ids, Lua/API, TFC turtle tools, components, disk contents and saved world data remain compatible; upgrades copy data components. A targeted upgrade-manager compatibility fix restores CC peripheral attachment under TFC stack-size changes without altering explicit turtle-tool checks. Draft datapacks: M10 `Nh1ATmqCY92Hao48hOAQ`, M11 `cbH7wTaHOr5vQMs4Usgb`, M12 `tcegd3kspq62oHuM3YmF` (69 entries, `install=false`). Dedicated-server audit passes 68/68 recipes: 265 checks in a new world and 275 after restart, including computers, disks, peripherals, turtle inventory/tools/fuel and migration. Full production-pack boot passes with 226 mods, the new jar and `file/cc-cbr`; conflict audit is clean. Manual Survival playthrough and live datapack confirmation remain pending.
- **2.9.0** (2026-11-03; dev #22, item 15 / M11): industrial L2/L3 PCB production with a photolithographer and via
  metallizer plus the Destroy Extras 0.4.0 bath. Photolithography consumes one photoresist and reuses a valid design;
  metallization consumes copper foil. L2 uses 240 V / 4 A and 300 ticks per machine, L3 uses 600 V / 8 A and 450 ticks;
  the working zone is 80–105%. Prepared/etched/final L2/L3 items preserve exact topology, vias and pins. Inputs,
  progress and recipe state survive blocked outputs, undervoltage, break/replacement and restart. Dedicated-server
  L2/L3 cycles and error paths, L1/M10 regressions, automated client PCB checks (zero errors), resources/models,
  release builds and 1344/1344 terminals pass. Manual Survival and live datapack confirmation remain pending.
- **2.8.0** (2026-11-03; dev #22, item 14 / M10): PCB editor (16×16, up to three layers, traces, components,
  vias and pins; design item; L1 remains compatible with `l1_mask`), base laminate/foil/solder materials and electronic
  components, L2/L3 blanks, 240 W / 48 V solar panel (rain 35%, thunder 10%) and optional TFC thermometer
  (0–1600 °C → 0–15 V, 1000 Ω). Draft site datapack `Nh1ATmqCY92Hao48hOAQ` (`EE Extras — электроника M10`)
  supplies the recipes; it is not confirmed or installed automatically. Industrial production was added in 2.9.0.
  Gradle check/build and 1344/1344 terminals pass. Dedicated server: PCB 15/15; thermometer 800 °C → 7.493 V
  (7.500 V EMF), including restart; solar day 47.75 V / 50.61 W at the test load, night/roof zero. Automated client:
  previous nine floodlight checks plus editor/status/design/L2/via checks pass with zero errors and inspected
  screenshots. Resources/models checked. No manual Survival playthrough or world confirmation of the datapack.
- **2.7** (2026-11-03; dev task #198): IE floodlight on the EE duplex cable (`ee_extras:floodlight`, click with the spool;
  subclass of the IE block, IE block entity, `lantern/EeFloodlight*`; 440 Ω while lit, open otherwise; from 50 V; beam
  rotation and redstone inversion kept; refused with IE wires; drops the IE floodlight) and `ee_extras:cable_converter`
  (one duplex cable → FE into the block behind, chainable, same formulas as the bidirectional converter's charge half,
  floor 20 Ω; recipe: EE converter + duplex termination). Dev server with IE (`rectest floods|floodpower|floodreport|
floodoff|floodcut|floodie`, `KEEP=1`): 230 V lit 117–119 W, 30 V dark, no redstone no load, heater filled to
  32000 FE then 0.01 W, capacitor charged at 2.6 kW, cut drops the IE floodlight and the tail goes dark, restart kept,
  no IE loads. Real dev client (`test-client.sh`, 9 checks, screenshots): conversion by a real click, state and rotation
  sync, IE model and beam. Not checked: IE multiblock power ports, an IE wire on a converted floodlight, computers.
- **2.5.1** (2026-10-29; dev task #142): grid inverters (2.2) rebuilt on `ac/Meter` + `ac/Sine` — the 2.2 sync read
  `getVoltageAt` (rms, unsigned at the pack's microTicks = 8) and set the EMF once per tick, so it never locked on the
  server. Now: GRID follows the measured phase (`predict(0)`, signed step — any phase order), ISLAND 1 Hz (3-phase with
  EE generator order, step < 0), DC side = signed per-microtick mean; DC side, rating, 10 % impedance unchanged.
  `release.sh` had leftover conflict markers from the 2.5 merge — resolved. Dev server (`rectest grid|dc|pwatch|preport|
island`, now with EE frequency meters): microTicks 8, 64 rpm — 3-phase off below grid, 640 V → 0.63 kW, 670 V →
  5.2 kW, 1-phase 240 V → 0.14 kW, 250 V → 3.3 kW, phase error 0.0°; island 1.00 Hz on EE meters, kept after restart;
  microTicks 1, 8 rpm — same picture (< 0.5°). Not in game.
- **2.5** (2026-10-29; dev task #139 «Новые блоки для EE extras», plan doc 21): frequency converters (any AC/DC in →
  sine of the set 1–40 Hz out, same rms line voltage; Create value box; parallel units lock to each other, foreign
  frequency on the output — stays off) and synchronizers (generator breaker with auto-synchronizing: closes at
  |Δf| < 0.1 Hz, |ΔU| < 10 %, |Δφ| < 10°, same phase order; dead bus — closes at once; redstone «faster/slower» on the
  ±X side faces for EE brushes, keeps +0.06 Hz slip; trips on reverse power and > 1.5 × rating; mode Auto/Off), light
  6 kW / heavy 48 kW, 1- and 3-phase, plus industrial 3-phase two-block cabinets (`Tier.INDUSTRIAL`, 120 kW × EE
  transformer cooling factor: radiators tag, oil; device in the upper half — EE takes node clicks only from the
  clicked block). Code in `ac/`: `Meter` (phasor from per-microtick samples), `Sine` (`MicroTickingElectricalProperties`
  source, like EE alternator windings). Pack has `simulation.microTicks = 8`, so `getVoltageAt` is rms. Dev server with real EE generators, `MICROTICKS=8`
  (`rectest fc|fchz|fcpar|fcorder|fcrad|fcbreak|fcreport`, `sy|syrpm|symode|syreport|syfaces`): EE frequency meter =
  set Hz, two in parallel share 5.4/5.3 kW, synchronizer closed at 9.7° / 0.044 Hz with no surge, reverse-power and
  overload trips, dead bus, industrial 58.8 → 281 kW with 4 panels, restart kept, terminals 1344/1344. Not in game:
  looks, value boxes, goggles, real redstone wiring to brushes, single-phase synchronizer.
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
  `art/sources/` and `art/modules.md`; generator preserves finished item PNGs. Released as 1.0.1 (2026-10-29);
  build, resource/model checks, 24/24 terminals and default dev-server scenario passed. Client appearance not checked in game. Onboard-computer modules approved by the user; Pyrofuel sources described below.

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
- **1.1.0** (2026-10-29, dev #113): Create basin heating with WoodenCog 1.2.18. WoodenCog only reads the block under
  the basin (charcoal forge, blaze burner, firepit, CCA/CLH/CMB burners) → EE heater, IE external heater and the analog
  heater gave 0 °C (no item heating, no heated WoodenCog recipes, no goggle line). Mixin on `BasinBlockEntity`
  (priority 1100, only with create + woodencog): injects into WoodenCog's merged `getHeatSourceTemperature` and Create's
  `getHeatLevel` — IE external heater from any side (`IExternalHeatable` on `create:basin`, 20 FE/t, 2000 °C, redstone
  turns it off, like the TFC-IE Crossover crucible), analog heater under the basin facing up, any block whose Create heat
  level isn't NONE (EE heater) → WoodenCog level temperature 750/1350/2000. Config section `basin`. Dev server (Create,
  WoodenCog, EE + ee-overheat added to `libs.sh`), `/ietest basin none|ie|ie_rs|analog|ee <heat>`: all values as
  expected (README). Not in game: goggle line on the client, real basin recipes, basin on a Sable ship.

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
  preserves item PNGs. Released as 1.0.1 (2026-10-29); build, resource/model checks and default dev-server scenario passed
  (briquette SPECIAL, heat=2.0 with pump/pipes, bucket/tank and empty shutdown). Not checked in game.

## Item texture workflow (dev #132, 2026-10-28)

`addon-dev` now routes new item artwork through image generation with inspected pack references, a detailed source,
transparent output and a separately prepared runtime PNG. Instructions live in
`.claude/skills/addon-dev/references/item-textures.md`; procedural asset scripts remain for technical patterns and
assembly. Native-size and inventory previews are required; no fixed 16×16 limit. This updates agent instructions
only; existing addon textures and in-game appearance were not changed or tested.

Dev #135 (2026-10-29) records the user preference in the skill: simple pixel shapes matching the parent mod or host
block, flat planes and restrained palette, functional material cues instead of simulated rounded forms, decorative
highlights or noise. Approved visual example: onboard-computer cassettes in `tools/create-aeronautics-extra-mod/art/`.

## Builder Tools (`tools/builder-tools-mod`, 2026-10-29)

Dev #103, **1.0.1**: builder belt `builder_tools:builder_belt` in Curios belt slot. After the last block is placed,
refills either hand from the 36 normal inventory slots, matching all item components; main hand is never used as an
offhand refill source. On attack input at a block only, swaps a suitable tool into the selected slot via the standard
inventory SWAP packet (old stack goes into the tool slot, works with a full valid inventory). Tool choice prefers
correct drops where required, then base destroy speed; ignores efficiency enchants and tools with one use left.
No auto-restore after mining, no backpack access. Sneak + RMB with belt in hand toggles its persistent component.
Recipe: five leather + one jute fibre; requires TFC for the recipe, NeoForge 21.1.251+ and Curios 9+ for the mod.

Verified: MCP platform sources for attack events and placement, build, resource/model checks, 23/23 standalone
Curios server checks, 26/26 with TFC 4.2.9 + Patchouli 93 (real placement, TFC tools, recipe), deliberate failing
assertion followed by a clean run; dev client checks ordinary inventory swap and server synchronization.
ImageGen source and 16×16 runtime texture based on Create goggles in the addon; release jar uploaded to pack server, card/page/version on site.
Not checked in game: real mouse input, long construction, remote multiplayer and full-pack inventory-mod interactions.
