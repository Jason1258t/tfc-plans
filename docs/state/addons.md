# State: pack addons

Part of [STATE.md](../STATE.md). How to build addons — [docs/addons.md](../addons.md). Sources since 2026-10-29 — repo
[tfc-addons](https://github.com/Jason1258t/tfc-addons), the `tools/` submodule here (dev #138). Site page `/addons` (since
2026-10-16; old `/reference?tab=addons` redirects; jars for download in `/addons/`). Since 2026-10-22 each addon has a
page `/addons/<mod>`: card `tools/<mod>/addon.json` (+ jar, `icons/`) in git, description — Firestore guide
`addon-<mod>` (section `addon`, widget `::addon-block`), editable on the site; development — skill `addon-dev` (2026-10-22), release — skill `addon-release`, MCP
`addons_list` / `addon_check`. Texts moved from the former `src/lib/addons.ts` as is (signed Claude). What still waits for the host or a
game check — [pending.md](pending.md).

- EE Extras, dev #271 и #274: подготовлены PNG 16×16 для поверхностного и тонкого провода, распределительной коробки
  и универсальной крышки. Проверены размеры, прозрачность и повторяемость полос провода; грани и иконки отрисованы
  проверочными моделями MCP. Интеграция с моделями и просмотр в клиенте относятся к приёмке #205 и #273.

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

### Betas (since 2026-11-08, dev #308)

A version with a «-» tail (`2.7.0-beta.3`) is a beta: compared numerically (`beta.10` > `beta.2`, all < `2.7.0`),
never the latest released, skipped by patch notes unless it is the from/to version itself. `tfc addons install
<mod>@beta` stores pin `beta` — newest released beta or a newer release on every pull; `@latest` unsubscribes.
The pack server's `/site/addons` hides betas unless `beta=1` (new `tfc` sends it), so old `tfc` builds never
take a released beta for the latest; the VPS needs the update for betas to reach anyone. `tfc publish` refuses a beta jar not already in the snapshot without `--allow-beta`; `addon_check` refuses a beta in
the card; the site tab «Версии» marks betas and folds those older than the latest release. Procedure — skill
`addon-release` «Beta». Checked: core comparisons by a node script, `pickAddonVersion` cases, site on the dev server;
not checked against the live pack server with a real beta upload.

## Debug Tools (`tools/debug-tools-mod`)

2026-11-04 (dev #214, #199): **1.0.0**, manual install, no blocks. TFC 4.2.9 has no vein locate command: only
`/tfc propick scan` (radius 12) and `/tfc count`; vanilla `/locate` does not see features. Vein centres depend only on the
world seed and chunk (`VeinFeature.getVeinsAtChunk`, public), so `vein find` computes them without generating chunks;
`vein check` and `ore` generate chunks one per tick and log results as `[tfcdebug]`, because RCON misses deferred output.
Checked on the full pack stand with `--level-type tfc:overworld`, not in the client chat.

## Destroy Bridge + Destroy Extras (`tools/destroy-bridge-mod`, `tools/destroy-extras-mod`)

2026-11-05 (dev #211): **Destroy Extras 0.6.0** — Create wrench rotation for the electrolyzer and etching bath, with relative ports and rotating EE contacts. The electrolyzer shell needs rebuilding after rotation. The bath rear port takes pure HCl. Stand checks covered all four directions, pipe reconnection and migration of a 0.3.0 world with a running batch. Full-pack client and live fluid flows after rotation await host acceptance.

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
- M13 (#22 checklist item 56) releases **Destroy Extras 0.5.0** and **Destroy Bridge 0.2.0**. The configurable EE rating
  preserves the old 300 V / 8 A default and adds recipe-driven 240/600 V modes. The metallurgical processor has two item
  inputs, a reusable catalyst, two item and two fluid outputs; all inputs and output space are checked before consumption,
  and contents/progress survive restart. Its 23 datapack recipes cover roasting/leaching/electrowinning Cu/Ni/Zn (20 ore
  powders → 100 mB metal), cementation, nickel sulfide, Bayer/Hall–Héroult with reusable cryolite, tailings, FeCl3
  regeneration and electronic scrap. Draft datapack `AOCIqlJX84i1BfiWPPsh` has 20 entries and remains `install=false`;
  it disables all ten direct bauxite routes through TFC, TFC-IE, ore washing and pellet arc-furnace recipes.
- M13 dedicated-server checks: environment/ingredient matching 30/30, leaching 3/3, electrowinning 3/3, Bayer 2/2,
  Hall–Héroult 4/4, blocked output 2/2, voltage sag 2/2 and restart 2/2. The M2 regression after the Bridge change passes
  13/13 at 299.827 V / 7.995 A. No manual Survival playthrough or live pack-wide datapack confirmation was performed.

## EE Extras (`tools/ee-extras-mod`)

2026-11-06 (dev #295): **EE Extras 2.21.2** — stronger on/off contrast for PCB LEDs, plus separate craftable
pushbutton and switch caps. Existing caps retain their mounted positions and drop the corresponding new item.
The local NeoForge control circuit confirmed installation and operation of both caps.

2026-11-06 (dev #292): **EE Extras 2.21.1** — single-core insulated and decorative leads, 300 V duplex-input
PCB supply modules with selectable 3–36 V and an optional rectifier, per-component controls with attachable caps,
polarized miniature LED, and boards on all six faces with a two-pixel border. Local NeoForge tests covered
resistance persistence, controls, LED polarity, the 25 V indicator circuit and overload protection, and output
waveforms with 16 microticks. The full client on `test1a` verified both wire types and their rendering, supply
settings and output, switch caps, the 25 V legacy-lead indicator and 60 V protection, LED polarity, and placement,
aiming, and wire attachment on every face (runs `20261106-131001-fd67` and `20261106-131831-4769`).

2026-11-06 (dev #289): **EE Extras 2.20.0** — installed boards display scaled Create: Power Grid component models
(Apache-2.0), thinner visible traces and a tier-specific substrate. The editor offers direct component selection and
highlights the pins of the preview. New placements of capacitors, diodes and meters require L2, transistors L3.
The EE simulation and the existing topology format are preserved. Dev server: topology 15/15, L1–L3 placement and
removal, relay indicator at 24.00 V. Dev client: 10 PCB checks passed, including L1 palette lock and installed board.

2026-11-06 (dev #280): **EE Extras 2.19.0** — the editor takes one blank of the design tier from the inventory or table
slot. Assembled boards render their thin cuttable outline and one-pixel contacts from the design. The thin spool
connects individual contacts to another contact or EE device. The editor has a direct tool palette, and the table
has an updated inventory model. Legacy boards keep their terminal IDs. The dedicated server checked L1–L3
assembly, six positioned contacts, the cut outline, the thin lead, and item drops. The dev client checked design
saving, assembly, and the installed outline and contacts.

2026-11-06 (dev #286): **EE Extras 2.18.2** — renamed the surface wire in Russian. Routing and periodic support checks
use the outline of fence posts and rails. On the dev server, a 6.13 m line over oak fences survived the periodic
checks without drops. Removing three fence blocks dropped only the unsupported section. A separate heater circuit
with 7.25 m of surface wire held both cores and delivered 211.7 V RMS from an AC source set to 300 V peak.

2026-11-06 (dev #283): **EE Extras 2.18.1** — the duplex cable sheath between two caps uses a different EE node pair
from either conductor. EE 1.1.2 keeps one connection per pair, so the first conductor previously overwrote the sheath.
Existing links with both conductors intact regain a standard duplex sheath during the server integrity check.
The dedicated server verified fresh placement, migration of a saved cable, and removal of a cap with two attached cables.

2026-11-06 (dev #276): **EE Extras 2.18.0** — the duplex cap covers both terminals with an overhanging rim. Caps sync
with watched chunks, and the spool HUD and click prediction use the synced state. The visible duplex and thin cable
sheaths use the cap inlet in both EE client renderers. Surface wire routes use the same inlet. EE 1.1.2 still registers
the original electrical nodes, so the saved cable connections need no migration. Dedicated dev server: cap placement,
removal and persistence after restart. Dev client: cap sync, screenshots of the bulb, heater and motor, and surface wire.

2026-11-06 (dev #272): **EE Extras 2.17.0** — working L1–L3 boards with up to four EE terminals, component presets,
and rated voltage, dissipation and current. Assembling consumes parts. Overvoltage and sustained overload char
the board, which can then be salvaged at the design table. Dedicated-server coverage includes relay transfer,
RC timing, forward and reverse diode, fuse, transistor, meters and Create display source, all three item tiers,
and 16 boards at the 32-node / 64-part limit through a restart and on a shared bus. The old editor checks passed 15/15,
CC compatibility passed 83/83 recipes, and the development client assembled a board through the editor.

2026-11-06 (dev #205, plan doc:47): **EE Extras 2.16.0** — surface wire ported from Create: Power Grid 0.6.2
(Apache-2.0, `META-INF/NOTICE`, package `ee.extras.wire`): one entity per piece, axis segments on a 1/16 grid,
A* path along surfaces (`BlockTrace`), preview, branches, merge, cutters (`#electroenergetics:wire_cutters`), dye,
straight mode (left Alt), raycast mixin on `ProjectileUtil.getEntityHitResult` (client, only with wire/cutters/dye in
hand). Electrics are EE wires, not PG simulation: a piece with both ends connected = 2 EE cores of route length
(`WireData.ofLength`); a branch node = EE FIXED detached nodes (`InfrastructureSavedData.createDetachedNode`, saved by
EE), registry in `JunctionData`. Own support check (PG has none). Junction box `junction_box` (like the duplex
insulator). Thin insulated wire spool — hanging duplex cable via `CableLaying` with a 1-px sheath type
`thin_insulated_wire`; refused between two cable insulators; works with caps (#273). Config `ee_extras-server.toml`
`surface_wire.itemsPerMeter` 1, `maxLength` 16 m. Checked on the dev server (`wiretest`, `/wiretest thin`) and in the
dev client (`WIRE=1 ./test-client.sh`); not in game. The site page `addon-ee-extras` had been saved truncated at 2.15.0
(MCP `guide_get` output with «… обрезано»); restored from revision 2026-11-05T16:26 plus 2.15/2.16 texts.

2026-11-05 (dev #273): **EE Extras 2.15.0** — duplex cable cap `duplex_cable_cap`: an item, not a block (host's
decision — "a modifier of the device"). `cable/CableCap` keeps the set of capped device positions (SavedData
`ee_extras_cable_caps`); a device qualifies when it is an EE `ElectricalDeviceBlock` with exactly two accessible nodes
(`getNodePositions` + `isNodeAccessible`, EE 1.1.2; cable terminations/junctions excluded); contact 1 = lower node id.
For the cable a capped device is a `CableEnd` with `contacts`: cores go to the device contacts, the sheath to contact 1
(a foreign block can't get an extra node — EE re-syncs nodes with `getNodePositions` every tick). Cap click and cable
laying onto 2-contact devices run in a HIGH-priority listener (`CableEvents.capClick`), otherwise Create's
`ValueSettingsInputHandler` eats clicks on the voltmeter's value box. Shift + empty hand removes (cap and cable spools
back); a 10-tick check drops the cap when the device is gone. Verified on the dev server (`CapTest`, `KEEP=1`): bulb
lit, voltmeter reads the battery, core 1 → contact 1 / core 2 → contact 2, refusals (rectifier 4 contacts, connector 1,
wired contacts, second cap, cable to uncapped device, EE wire onto capped contacts), removal, drop on break, restart.
Item texture from #274 (`item/duplex_cap`); the block textures `duplex_cap_front/side` from #274 are unused.

2026-11-05 (dev #228): **EE Extras 2.14.1** — EE 1.1.2 electric pumps draw 2.4 times less power at the same
terminal voltage, preserving their original RPM curve. The patch multiplies the resistance used by the circuit solver
by 2.4 and adjusts goggles watts by the same factor. At 220 V the dev server reported 480 Ω and 60.5 RPM with the
stock 200 Ω config and mechanical pump impact 4, corresponding to about 101 W instead of 242 W. Both injections
were verified in the exported class. Config proposal `HPnhxqfnFrUSjHTYcEKG` was cancelled.

2026-11-05 (dev #249, #259): **2.14.0** — a steel whip antenna for both wireless modem tiers via the base
transceiver, a miniature colour display for direct and upgrade recipes of the advanced pocket computer, and
industrial RedRouter, Animatronic, Scroller and Source Block recipes. Source and Target still convert 1:1.
The M12 item insulation tag accepts ABS sheets and available plastics for the cable and storage bay.

2026-11-05 (dev #248): **2.13.0** — magnetized steel, a pressed-paper speaker cone, sulfuric acid electrolyte and
an ABS ink cartridge. The precision actuator gets its magnet through the motor. The lead battery uses an ABS case and
a PET separator. M12 `tcegd3kspq62oHuM3YmF` requires EE Extras 2.13.0, Destroy 0.4.6 and Petrolpark 1.5.11.
Dedicated server: 77/77 CC recipes, 303 checks after restart, reusable magnetizing coil, 125 mB of 4.5 mol/L solution
bottled by Create; 1 and 10 mol/L rejected. Resource and recipe conflict checks passed. See dev #259 for the missing
insulation tag in the pre-existing cable and storage bay recipes.

2026-11-05 (dev #247): **2.12.0** — duplex cable power inlet for CC: Tweaked desktops and a pocket computer
charging station. The inlet tests the network under load before booting and shuts down on loss of power. The
nominal input is 300 V with an operating range of 240–330 V. Normal/advanced desktops draw 80/180 W at nominal
voltage. Pocket devices store an 18 Wh battery on the item. Input damage follows the EE component damage setting.
Dedicated server: 80/180 W at 300 V, refused startup at 180 V, shutdown after cable removal, Lua disk drive and file
write, desktop and charger persistence after restart, pocket shutdown at zero charge, inlet and PC destroyed at 600 V.
Release build and resource checks passed. The reduced stand does not cover manual play on the production profile.

2026-11-05 (dev #246): **2.11.0** — five ComputerCraft materials: ABS sheets and keyboard blanks, PET film,
RGB phosphor and a steel shadow mask. Stock Destroy ABS is used directly. A stock Vat reaction converts paraxylene,
ethene and oxygen into PET and water; heated Create pressing/mixing forms the new materials. Computer/peripheral cases,
the keyboard and magnetic disk medium now use ABS/PET while retaining their metal frames and magnetite layer; the
colour display uses phosphor and shadow mask instead of dyes. M12 `tcegd3kspq62oHuM3YmF` has 74 entries and requires
EE Extras 2.11.0+, Destroy 0.4.6 and Petrolpark 1.5.11. Dedicated-server checks: 73/73 CC recipes, 280 assertions and
7 PET produced at 450 K with temperature control. Release build, 153 JSON files, resources, models, recipe conflicts
and 1344/1344 terminals pass. The reduced stand is not a full production-pack boot; host Survival acceptance and live
datapack confirmation remain pending.

2026-11-04 (dev #221): **2.10.2** — steel PS wire sag divided by three (0.4 → 0.4/3);
stranded copper M sag reduced by 40% (1 → 0.6). ACSR and other wires unchanged.
EE 1.1.2 WireData.getSag confirms linear scaling for existing wires, including tensioned ones. Temporary dev-server assertions passed 24/24 (8/60/128-block spans, automatic/normal/tensioned/long wire lengths). Existing lines test: PS sag 0.40 blocks loose and 0.08 clamped on a ~60-block span; voltages matched calculations. The reduced dependency fixture logged unrelated missing IE/TFC/CC recipes; A restart with IE/TFC/CC preserved the lines, tension and measured voltages (dependency client-class warnings remained, server ran successfully). No client visual check.

2026-11-05 (dev #224): final Survival integration enabled the existing M10/M11/M12 datapacks for installation through
`tfc pull`: `Nh1ATmqCY92Hao48hOAQ` (20 entries), `cbH7wTaHOr5vQMs4Usgb` (9) and `tcegd3kspq62oHuM3YmF` (69).
Together with the already enabled M6 pack they cover all 54 electronics materials/components: 17 M10 recipes, seven M11
recipes and 30 M12 recipes; `pcb_design` is produced by the design table rather than a crafting recipe. Active-recipe
queries pass for a resistor, L2/L3 boards, solar panel, CC computer and CCBR integrated circuit. The earlier dedicated
server checks remain valid because recipe JSON and addon code did not change. No new addon version was released; live
pack-wide confirmation and a manual Survival playthrough remain pending.

2026-11-04 (dev #216): **2.10.1** — visual refresh of 33 entries from the L1 blank through the TFC thermometer:
28 individual RGBA 64×64 item textures and materials/models for five blocks. L1/L2/L3 use yellow/green/blue edge
stickers; coating, etched traces and plated vias distinguish PCB stages. Fiberglass is a wound bobbin, fabric an
unrolled roll, capacitor upright. Generated originals, exact prompts, references and reproducible mechanical exports
are in `art/electronics-v2/`; the old electronics generator now exports those sources instead of restoring old art.
Checked at 32/64 px on light/dark backgrounds, block renders, resource validation, release build and node check.
Dedicated server with TFC/IE/CC: PCB 15/15, thermometer 799 °C → 7.483 V, solar 47.75 V / 50.61 W by day and 0 V
under a roof; photolithographer/metallizer placement and block entities. Client appearance still needs host review.
Gameplay, ids, recipes and saved PCB data are unchanged.

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

## Small Diesel (`tools/small-diesel-mod`, 2026-11-05)

- **1.0.3** (dev #243): a partly filled IE jerrycan tops up from a full tank, limited by free space in the can.
  Dev server with IE 12.4.2-194: both blocks accepted 600 mB from a partly filled can, a full can transferred
  nothing with a full tank, a can with 9,500 mB withdrew 500 mB, and an empty can withdrew the remaining 500 mB.
- **1.0.2** (dev #243): a filled IE jerrycan refuels either machine on right-click. An empty can withdraws fuel.
  Dev server with IE 12.4.2-194: 600 mB transferred into a tank with 400 mB, no transfer with the tank full,
  and 1,000 mB recovered into an empty can. IE remains optional.

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

- **1.2.0** (dev #268): IE's crafting recipe attaches its ear defenders to Create engineer's goggles and returns them
  unchanged on removal. The combined item goes in the head armor slot. Dev server: `ietest earmuffs` checks both directions
  and rejects extra ingredients or a second attachment. Client sound and rendering still need a game check.
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

- **1.2.0 (dev #244):** five pickup groups and an exact-item allow/block list that overrides group settings.
  On first opening an existing belt, generalized samples in those groups become toggles and the other samples
  remain exact blocks. The dev server passed all 34 `belttest` checks, including migration and both list modes.

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

## Perf Fix (`tools/perf-fix-mod`, 2026-11-06, dev #296)

Server performance fixes found with spark (dev #267, doc:53), each a `@Pseudo` mixin that only applies when its mod is
present. 1.0.0: JourneyMap Shared Maps 1.1.3 `RegionTileStore.writeTile` (main thread, `readAllBytes` of the whole
region for an 8200-byte header, 4 opens; regions compacted only on `ServerStoppingEvent`) → one background writer,
same format, one open, header cell write, same `LOCKS`, drain on `ServerStoppedEvent`; TFC 4.2.9
`Octopoteuthis.remove` → `IGlow.tryRemoveLight` checked the entity's chunk but read `lightPos` (far / ZERO → sync chunk
load) → skip when the light's chunk isn't loaded (`TFCLightBlock.randomTick` removes it 1/20). Dev server
(`test-server.sh`, `/pftest`): 2000 tiles 1439 ms → 71 ms on the main thread, region files read back by the mod match
memory (also after restart); far light chunk loaded without the addon, not with it. Switches
`-Dperf_fix.jmsharedmaps.disabled`, `-Dperf_fix.glow.disabled`. **Not in game**; confirm with a new spark profile on the
host. Next candidates from the profiles: pig pen (players), loaded chunk count 9–11k with render 12 (unknown ticket
holder), Sable physics.

## Create: Schematic Fix (`tools/schematic-fix-mod`, 1.0.0, 2026-11-07, dev #196)

Schematicannon «ate» blocks. Causes (bytecode Create 6.0.10, Create: Fast Schematic Cannon 1.4.1): Create re-places a
block whose world state differs from the schematic in any property (consumes the item, `setBlock` without drops) —
createdeco catwalks recompute `bottom` by tick, so every restart re-placed them; Fast Schematic Cannon checks its
`blocks_unbreak` list (all TFC/Firmalife ores, blaze burner) after items and gunpowder are taken. Mixin at HEAD of
`SchematicannonBlockEntity.shouldPlace`: same block kind in the world → skip; world block in the CFC list (reflection on
its `Config.blocks_unbreak`) → skip. Verified on the whole-pack stand with a KubeJS harness (`check/`, schematics from
the site): without the addon a restart of oil_facory broke 380 catwalks and stalled, ore under «постройка» lost 310
items; with it a restart costs 0 and consumption = schematic − ore cells. Also without the addon: 8 library schematics
(creative crate) and 1900s_workshop (survival, exact item set, mid-print reset) print completely. Not changed: blocks
without an item (piles, rope anchors) are never printed; other-kind blocks are still replaced without drops. **Not in
game.**

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

- **1.1.0** (2026-11-08, dev #314): Cold Sweat 2.4.2 crash of the host's integrated server a few seconds after joining
  (`ConcurrentModificationException` in `TempModifierRegistry.getHolder`, found by the client-stand stress run #267).
  `ClientJoinSetup.onJoin` calls `TempModifierInit.buildModifierRegistries` (flush + re-register a static `HashBiMap`)
  on the client thread while the server thread iterates it. Mixin `ColdSweatModifierInitMixin`: while a server runs,
  a call from any other thread is cancelled (the server already built it on `ServerAboutToStartEvent`, same event and
  listeners incl. KubeJS). Optional dep `cold_sweat [2.4.2,2.5)`; missing target = Mixin warning only. Not fixed in
  Cold Sweat 2.4.3–2.4.5 changelogs. Dev server `/rwtest coldsweat`: 300 off-thread rebuilds vs server-thread reads —
  0 errors; with `-Drw_host_fix.coldsweat.disabled=true` 2209 CMEs; `NO_COLDSWEAT=1` boots. `build.sh` now takes the
  classpath from `ee-extras-mod` (+ `createMinecraftArtifacts`; `ee-rectifier-mod` was renamed).

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

## Better Fluids (`tools/better-fluids-mod`)

1.0.0 (dev #233.2): an iron tank compatible with Create 6.0.10. Square base up to 3×3, 14 buckets per block,
whole-layer vertical placement, separate textures and block entity type. The dev server verified that a single
placement builds a 2×2 layer, the resulting 2×2×2 tank accepts 112 buckets through a non-controller part,
an adjacent copper tank stays separate, and the water survives a restart.

1.1.0 (dev #233.3): face-connected sections replace rectangular assembly. Layer placement follows the connected
horizontal cross-section. A side wrench click cuts existing connections at one section while leaving free faces
available for extensions. Placing against a detached group preserves its boundary with adjoining tanks. Fluids
are persisted per section, and 1.0.0 tanks migrate when all parts are loaded. The dev server checked an L-shaped
layer, a three-way split, an extension bordering the old tank, persistence after restart, and 112 buckets
migrated from 1.0.0.

1.2.0 (dev #233.5): empty iron sections can be reshaped on a stonecutter. Slabs can be placed horizontally
or vertically and hold 7 buckets, quarter sections hold 3.5, and the 45° bevel section holds 7. The dev
server checked all six slab orientations, a mixed tank holding 31.5 buckets, wrench separation and
persistence after restart.

1.3.0 (dev #253): a fluid tap attaches to any face of a Create or Better Fluids tank and fills held containers
through the NeoForge fluid capability in survival. The dev server tested a bucket and an IE jerrycan on all
six faces of both tank types, fluid accounting and detachment when the tank is broken.

1.4.0 (dev #322): lids and bottoms of one-block-wide runs (e.g. a 2×1×2 wall) were invisible — Create's RECTANGLE
CT sheets for `fluid_tank_top`/`fluid_tank_inner` leave the "neighbours on one axis only" tiles empty (Create tanks are
always square, ours are free-form). `art/gen_assets.py` now fills them from halves of the frame tiles. Windowed
sections use `WindowTankModel` (inside Create's `FluidTankModel`): lid/bottom from Create's JSON, walls rebuilt in
code — a pillar only where the straight wall ends, glass (`fluid_tank_window_wide`, 9-sliced) across seams with
windowed neighbours of the same height. `./test-client.sh` (ModDevGradle `runClient` + devtest `ClientTest`) builds
tank shapes in a flat world and saves `run/screenshots/bf-*.png`; `EXTRA="sodium-neoforge"` adds pack jars. Checked
there with and without Sodium plus the dev-server suite; the full-pack client stand did not finish loading the world
(llvmpipe), so not seen in the full pack.

1.5.0 (dev #332): sheet cladding — `white_cladding`, `aluminum_cladding` and their `_framed` variants, plain full
blocks (copycat-fillable). One ingot on the stonecutter → one block, like Create's industrial iron
(`#c:ingots/iron` / `#c:ingots/aluminum`); plain ↔ framed on the stonecutter. Textures and JSON from
`art/gen_cladding.py`.

1.5.1 (dev #332): `IronTankEntity.updateShell` compares against `level.getBlockState`, not the block entity's cached
state. The Create schematicannon (`BlockHelper.placeSchematicBlock`, flag 18) runs our neighbour update inside
`onPlace`, then `LevelChunk.setBlockState` writes the outer (schematic) state into the BE cache, so later updates saw
"already top=false" and skipped — lower sections kept `top=true` (stand print check: group 3 `wrong_state`). Devtest
`print` + `printcheck` repeats the cannon path (writeSafe data, bottom-up) on the small tanker: all 305 cells match.

Library schematics (devtest `tankers` / `tankfarm`, classes `Tanker`, `StorageTank`, `Round`): circles at half-block
resolution — a quadrant is in if >50 % of its area is inside; 3–4 quadrants → full block, 2 → `copycats:copycat_slab`
(axis by shape), 1 → `create:copycat_step` (horizontal) / `copycats:copycat_vertical_step` (vertical); the state is
picked by testing the block shape, no 45° slopes (the host rejected them). Horizontal tankers `lYdHCHToOvSC89HZLhXg`
(5×12, 1260 buckets), `u5XNxBUEqxKo0YZZ82p0` (7×16, 4116), `Zx8oz8aRkFOGNw7ONt0L` (9×22, 10 360). Vertical tank-farm
tanks, wide and low: `3cF4FPgOunTKkETbrgl0` (Ø11 h7, 5978), `qXlDmyeEkI7XVsIpXS7y` (Ø15 h9, 17 262),
`kyF6tTF2IXcjT6otMtHE` (Ø21 h12, 47 880). Each is saved to `run/*.nbt`, re-placed from the file and filled; copycat
shape and material verified after re-placement; `drops` checks nothing popped off. `BF_SHOWCASE=1 EXTRA=copycats
./test-client.sh` places the saved files in a client and shoots `bf-show-*.png` (placing the same file twice over
itself pops copycat slabs — don't). Run: `WITH_IE=1 WITH_COPYCATS=1 ./test-server.sh 'forceload add 0 32 90 220'
'betterfluidstest tankers' 'betterfluidstest print' 'betterfluidstest tankfarm' 'sleep 3' 'betterfluidstest
printcheck' 'betterfluidstest drops'`.

### Destroy Extras 0.7.1 — текстуры чистой пыли (dev #293)

18 пылей и 90 брикетов получили цветные спрайты 16 × 16. Модели пылей берут цвет из PNG.
Обновление сборки `u20261106-133656-3ca6` включает JAR и скрипт KubeJS, который выбирает спрайт брикета
по размеру и металлу. ID и рецепты сохранены. Gradle и проверка ресурсов прошли, отображение проверит хост.

1.5.2 (dev #335): all addon items were missing from creative mode — the mod never listened to
`BuildCreativeModeTabContentsEvent`. They are now appended to Create's base tab. The dev server checked the tab
contents (`betterfluidstest tab`) and a creative instant print of the small tanker through Create's
`SchematicPlacePacket` from a non-op creative player (`creativeprint` + `printcheck`): 90 of 90 tank sections, matches.
