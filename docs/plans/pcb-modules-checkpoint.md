# PCB modules — continuation checkpoint, 2026-11-08

Resumed at the owner's request on 2026-11-08. Task #301 is doing under Codex and remains incomplete.
Authoritative requirements: server plan doc:59, especially 2.1, 2.2 and 6.1. Do not replace the scope with this checkpoint.

## Onboard transformer milestone

L1 now has a 3×3 onboard transformer with a direct two-core 300 V RMS cable inlet on its body and only two
secondary pads. Unique per board, including group paste. Uses native EE TransformerBehaviour; adjustable 1–48 V AC
no-load output, passive secondary current/power limiting, input protection, DC rejection, persisted cooldown.
Primary nodes 8192–8194 do not occupy user edge terminals. Empty-hand interaction reports measured input/output.
Thin spool input dispatch and cable preview distinguish the body inlet from ordinary edge leads.

- `/pcbonboard`: 48 inlet poses across six faces, rotations/reflections; loaded 12 V setting gives 11.717600 V on
  1 kohm, input 0.141511 W, total losses 0.004209 W including primary sensing. Independent energy balance passes.
  Short circuit 0.01 ohm: 0.497713 A, board intact. DC/zero/400 V protection, write/read and full server restart pass.
- `/pcbmodules` now checks 224 variants. Mechanical recipe loads; inputs checked with active KubeJS, no conflict
  among 104 mechanical recipes. Resource checker: 141 items, 58 code-selected models, no errors, seven known warnings.
- Full client `20261108-110658-a5e1`, 250 mods, normal exit: actual clicks select inlet then connect/power the board;
  DC gives zero output. Three screenshots inspected. No client run remains active.
- Owner chose AC for the future L1 high-voltage transformer; use ~A/~B labels, no hidden rectification (doc:59 rev19).
  The vibrator was removed by the owner; LC/antenna feasibility is a separate optional research task #313.
  High-voltage AC transformer is now a buildable, untested candidate (below); L2 regulated supply remains unimplemented.

## Current editor milestone

- Prototype format **9**, no migration. Undo/redo (64 steps per open menu), base-X reflection F, translucent other
  layers H, region selection V+Shift+drag, atomic region move/copy/paste with all layers, shape, parameters and manual
  cuts. Moves preserve IDs; copies create fresh IDs. One group operation is one undo step. Concurrent changes clear
  history; an outdated group move is rejected. Automatic pin cuts are now rebuilt separately from manual cuts.
- The owner's follow-up asks for contact outlines comparable to the actual pads. PCB pad bounds are transformed for
  all six faces, with 0.002 block margin and 0.003 line width. A client-only EE tick mixin preserves EE colors and
  restores the original line width for other devices. Hit selection remains independent of visual node size.
- Server checks: 216 geometry/rotation/reflection variants, exact reflected pin coordinates, 240 slider placements,
  24 pad bounds on six faces, history and region semantics. A physically loaded mirrored register writes word 5 and
  all four outputs match. Build, lint, resource checks and diff-check pass; resource checker from current main covers
  140 items / 57 code-selected models and reports no errors (7 known warnings).
- Client `20261108-093616-e34c`: completed with normal exit, 21 screenshots; L2 bodies visible but close camera collided
  with boards. `20261108-095444-348b`: 24 screenshots, readable large L2 bodies including mirrored register; UI tests
  failed because the player was still far from the table. Fixed by returning to the table before opening it.
- Client `20261108-100220-3d46`: all trace undo/redo and group-copy/undo assertions pass. Raw client.log and 24 screenshots
  recovered to the local results folder. No automatic summary: stand.json contains the controller PID, not Java PID;
  SIGTERM interrupted the controller while it was unnecessarily waiting for a static editor image to change. No
  process from that run remains. Never stop a run by stand.json PID. For ready=DONE use load=0.
- Client `20261108-101517-7569`: visible hover outline matches the pad, full editor scenario passes. The selected-outline
  assertion was invalid because finishing a wire clears SELECTED_NODE. Fixed the test by explicitly selecting a pad.
- Client `20261108-102319-9a02`: short contact scenario, all assertions pass (selected PCB line width and restoring
  the original width on an ordinary device), normal exit, 243 seconds. The owner's outline request is verified.
- The title and undo/redo row now sit below the pack's global toolbar. A new full client scenario checks the buttons
  through native Java Robot mouse input rather than directly calling the screen handler; it is running.
- Added Gradle `devtestJar` to package a complete test mod after compilation. Do not manually jar a classes directory
  concurrently with another Gradle compilation (run `20261108-094734-6298` caught missing Power.class). General
  automation candidate logged as dev #311.

- Do not close checklist item 3 from a direct screen-method test alone: global overlays may intercept input.
  The native mouse scenario above specifically covers dispatch through those overlays.

Next: finish the active native-input client run and inspect its screenshots, then onboard power, sensors/interfaces and remaining catalogue, followed by L3. Do not release the prototype as 2.21.2.
The older sections below describe the previous checkpoint and should be read with this milestone's updates.

## Checkout and saved state

- Worktree: `.claude/worktrees/pcb-modules`; parent branch `feat/pcb-modules`.
- Editor/contact checkpoint in addon repo: `3b052ac` (2026-11-08). No release or merge performed.
- Addon repository: this worktree's `tools/`, also branch `feat/pcb-modules`.
- Earlier addon checkpoints: `021ea8c` (palette / relay), `ba074b9` (latch / selector / mechanical winding),
  `5f20975` (powered comparator / clock). Latest L2 checkpoint: `a8791bc` (flip-flop / counter / register / decoder).
- Prototype format **9**, no migration. Current jar name still `ee-extras-2.21.2.jar`; this is not a release.
- No merge, deployment or release was performed for #301. Keep the worktree for continuation.

## Implemented

Multi-cell footprints, four rotations, independent external pads, mounting on layer 0 and up to three trace layers;
parameter values entered numerically; stable module instance IDs checked by the server. Fullscreen editor with wide
left palette, search/categories, dim future tiers, cursor zoom, pan, trace dragging, via continuation, network highlight,
BOM and clickable diagnostics. Larger button/switch overlays, EE-inspired LED glow and Power Grid light modules.

L1: resistor, relay with changeover contact, button, SPDT and three-position switches, lamps/LEDs, 2×2 light panel,
2×5 five-section strip, rheostat, slider potentiometer, SET/RESET mechanically latched flag, three-pin mechanical timer.
L2: capacitor, diode, transistor, meters, powered comparator, 2×2 clock, D flip-flop, four-bit counter, four-bit register,
2→4 decoder. Not the complete requested catalogue.

All new L2 logic has explicit P/G pins, 3–6 V operation, high-impedance inputs and real 100-ohm output drivers to
supply/ground. Sequential state clears without valid power. Rising-edge sampling does not repeat on a held signal or
invent an edge on power restoration. The compiled Part now owns a defensively copied pin array and persists it.
Register footprint stays 3×2 with eleven external pads; dense packages use the full outer perimeter including corners.

## Evidence and limits

- Build / devtest compilation, lint, formatting and resource checks pass; existing warnings remain.
- `/pcbmodules`: 108 module/rotation variants, six faces, 120 slider positions, eleven register pads.
- `/pcblatch`: real server restart retains an unpowered flag; 23.9987 V from 24 V after restoring load power.
- `/pcbtimers`: mechanical winding edge/hold/reset/manual winding without power; clock enable, lost/invalid power,
  write/read; 4–5 transitions in 100 ticks with 40-tick period.
- `/pcblogic`: comparator 4.54527 V and 0.0252253 W into 1 kohm at 5 V, against 4.54545 V / 0.0252273 W calculation;
  equal inputs, threshold changes, reload, absent/low/high power.
- `/pcbseq`: compiled pads plus explicit test-only bridges, real source and one loaded electrical probe per output.
  Flip-flop write/hold/reset/reload/power loss; counter 0→1→2/hold/reset; decoder all four input combinations;
  register write 5/hold despite changed data/reload. Full register restart retains word 5 with write held high and changed data; a new edge writes 15, power loss clears to 0.
- New item models rendered and inspected; recipes checked for conflicts, known input reachability verified.
- Last successful photo scenario: `20261107-210409-6c96`, 19 images, 250-mod profile without Voxy. Latch on/off and
  unpowered state confirmed, but thick wires obscure its body. Exit exceeded the stand's deadline and was killed.
- `20261107-211440-f54e` terminated during world loading, no scenario images. Thin-wire/closer-camera code compiles,
  but has no new visual proof. No client run is left active. New L2 chips have not been viewed in the full client.
- Resource checker misses dynamically registered item coverage (separate task #302); explicit model renders supplement it.

## Next work

1. Re-read task #301 / doc:59 and inspect both git repositories before editing. Resume the preserved worktree.
2. Validate new L2 chips and thin-wire fixture in the full client; use longer world-load allowance (e.g. load=600),
   poll the same process handle until terminal, and avoid concurrent full-pack runs on test1a. SSH authorization was restored.
3. Finish editor requirements: undo/redo, mirror F, group selection/move/copy/paste, translucent other layers,
   named L3 buses/program view and probe mode. Do not call the current editor complete.
4. Implement remaining onboard power, HV transformer, sensors, remaining controls and interfaces/Create integration.
   Onboard PSU has only two outputs; no half-board inlet/guard zone. HV only accepts AC; no vibrator is planned.
5. Finish L2 catalogue and then L3 CPU/memory/display and the agreed restricted Python-like language in doc:59 §6.1.
   Addressable L3 versions of strip/knob/button are separate modules with bus/power/ground, not hidden access to L1 parts.
6. Run tier demos, finish recipes/guide/version, use addon-release and ship only when the full task is ready.

## Useful commands

Run from the preserved parent worktree. JDK: `$HOME/.gradle/local-tools/jdk21/Contents/Home`.

```sh
JAVA_HOME="$HOME/.gradle/local-tools/jdk21/Contents/Home" tools/ee-extras-mod/gradlew -p tools/ee-extras-mod build compileDevtestJava
RCON_PORT=25649 SERVER_PORT=25648 tools/ee-extras-mod/test-server.sh 'pcbmodules'
node scripts/mcp-call.mjs tfc-plans-dev dev_get '{"id":301}'
```

Full-pack devtest jar must include optional PetTest classes (build libraries with `DESTROY=1 ./libs.sh` when needed).
Do not publish the prototype jar under the existing release number.

## Remaining session goal while the stand is occupied

Plan doc:59 rev22 removes the vibrator and separates optional LC/antenna research into #313. Main goal #301.13:
prepare the 3×3 four-pad step-up AC transformer, including power/current limits and interaction with L1 trace
protection, native EE coupling, DC rejection, resources/recipe and buildable main/devtest jars. Use local compilation,
static resource/model/recipe checks and calculations only. Do not use or alter test1a while occupied.

Success for this session means a saved buildable candidate and a prepared measurement scenario, not electrical or
client acceptance. #301.14 remains open for loaded/AC/DC/short/overload/rotation/reflection/restart and client checks
once the stand is free. Optional spare-time work: #313 jar/API feasibility analysis only, no promised radio features.
Do not pull L3 CPU/VM/display, all sensors or Create integration into this bounded session goal; keep the full scope
in the parent plan. No release or completion of #301 before the required acceptance.

## Step-up candidate prepared without the stand

#301.13 now has a 3×3 four-pad fixed ×10 transformer, native EE coupling, cold-DC rejection, separate per-instance
nodes/state, persisted 100-tick cooldown. Input up to 48 V RMS; open secondary up to 480 V AC. 20 kohm secondary
ballast limits short current below 24 mA and primary below 0.24 A at maximum input; winding/ballast/bleed losses count
once toward board heat. Useful matched-load power is approximately 2.88 W at maximum input, not a machine supply.

Only the transformer's secondary insulation gets the 480 V exception. Ordinary connected parts and primary networks
retain tier voltage/current/heat limits. A second connected-network graph checks secondary networks between edge
terminals against 480 V, including series secondaries. No global L1 voltage-rating increase.

`build devtestJar` succeeds. Resources: 142 items, 59 code-selected models, no errors (seven known warnings). Item
render inspected; recipe inputs checked with active KubeJS and no conflicts among 104 mechanical recipes. An external
30-case calculation validates nominal power balance and limits, but is not an EE measurement.

Prepared `/pcbstepup geometry/ac/dc/short/open/ordinary/overload/overvoltage/report/expect/reload/cooldown/off/burnt`.
README gives the ordered commands, cooldown/read-write and separate full-restart pass. Geometry covers 48 poses and
ordinary/HV graph separation. External resistor and native 1 Mohm voltmeter are separate devices: at 24 V input,
100 kohm load expects 196.703 V, voltmeter-only expects 235.292 V. Tolerance includes small wire losses. These commands
have NOT been run. #301.14 remains open; no stand processes/profile/world were touched, no release/version bump.

Optional #313 initial research completed: plan doc:60, checklist 1/2 done. Native reactive timestep is 0.05/N; N=8 means
6.25 ms. Implicit Euler numerically damps LC oscillations well below Nyquist. Preliminary fit is a slow wired filter;
antennas require a separate bounded game channel model. Minimal energy/decay/selectivity/persistence experiment is
specified, not executed. No radio module or range/frequency promise has been added to #301.

Saved addon milestone: `01abd8c` on `origin/feat/pcb-modules`. Frozen unreleased jars and SHA-256 manifest:
`/var/folders/x6/3d5mczwn1hsgl2mnzkk_cs7h0000gn/T/pcb-301-stepup-final-lsygxh2u/candidate.json`.
Main jar SHA-256: `7753c8a122e90dc768c61b7dacaa7f6ae025af3938cf35782c564f4842326af0`;
devtest: `e19bb8568c5895164df6041643f847a344997d045fcb4b4ec69e754eba69002e`.
Do not upload these as the existing 2.21.2 release; names retain the prototype version only.

## Stand verification completed after the owner's release

The owner released test1a. #301.14 now passes on the full dedicated server (232 mods) and full client (250 mods).
Server evidence: `/tmp/pcb301-remote-server-verified.log`; remote `~/tfc-stand/pcb301-result-verified.json`;
local detailed copy `/tmp/pcb301-verified-server/`. All positive commands pass, with one deliberate `expect 100`
negative control. Actual restart into the saved world restores 196.695295 V at nominal 24 V input / 100 kohm load
plus the native 1 Mohm meter. At 48 V input: 393.390589 V loaded. 1-ohm short at 48 V: 23.981659 mA secondary,
239.865035 mA primary, 0.025039 V output, 11.510557 W heat, board intact. Meter-only output: 235.289954 V.
DC/zero, NBT, cooldown and recovery, ordinary low-voltage part on HV, primary overload and 60 V all behave as specified.

Runtime fixes: use ResistorBlockEntity.setResistance in the fixture (direct device assignment is overwritten);
allow 1e-6 V numerical tolerance on the inclusive 48 V input boundary. Native Network.seriesOptimize may remove
coupled branches including their regularization resistance: getHeatLoss on the original properties then overcounts.
Heat now uses sampled active input minus sampled active output, bounded below by actual winding/ballast losses;
input sensing bleed counts once. Independent physical-loss bounds and 1e-5 W balance checks pass including meter-only.

Client `20261108-141312-5bdb`: normal exit, all six powered faces/eight poses/DC passed, but exposed the meter-only
heat error; wires obscured the model. Superseded by **20261108-142522-2510**: normal exit, 264 seconds, all 17 EECLIENT
assertions pass. Eight screenshots under the local client-stand results folder; inspected UP, NORTH and mirrored pose.
For clear model frames a separate unpowered copy stands beside the powered measurement fixture. No missing textures.
All eight powered rotation/reflection variants and six mounting faces were tested on the real fixture, not that copy.

The scoped session goal is achieved after final commits; full #301 still needs remaining catalogue/editor/L2 power,
sensors, Create interfaces and L3 VM/memory/display. #313 initial jar research and experiment plan are doc:60; no LC
experiment was run. Release/version bump/merge/deploy remain outside this scoped session.

Verified unreleased artifacts superseding the earlier untested snapshot: `/var/folders/x6/3d5mczwn1hsgl2mnzkk_cs7h0000gn/T/pcb-301-stepup-verified-1biubt00/verified.json`.
Main SHA-256: `f8d7361949f4a631efb317e9ff073b06e47dce2a32d61dcfac0ff84386bb399d`;
devtest: `a20953d1f29404cc9469410dd5fce6d21d1134a12469adc591d636afbf0208fd`.

## L2 bridge session (#301.15), 2026-11-08

New type 29: L2 3×3 bridge, pins ~A/~B/+/−, four native EE DiodeProperties with 1-ohm lead/sense resistors.
Integrated catalogue, multi-cell geometry, assembly/salvage, item/model/lang, recipe and ordinary L2 protection.
Part validation permits a real output short; all four pads remain in the ordinary voltage graph.

Native EE 1.1.2 only performs one diode Newton step per sample. Raw native AC produced negative output spikes.
The new network mixin converges only networks with a bridge marker, without reticking capacitors/sources. It uses
half-step damping, 0.1 V maximum update, 64 iterations, 1e-6 V tolerance and fails closed on unresolved/nonfinite results.
A helper record must live outside the mixin package (run 175345-df09 caught the initial IllegalClassLoadError).
The onboard transformer's reactive-load heat now counts native regularization via actual active input/output power.

Server 175820-a46b: 240 geometry variants, eight bridge poses, AC/DC and overload/overvoltage pass;
capacitor convergence failure was correctly detected and superseded. Server 180305-67b1 passes all its commands:
5 V AC + 1 kohm + 10 mF gives 5.277–5.289 V; demo after write holds word5 at 3.583–3.592 V, four outputs loaded by
1 kohm; after source removal the capacitor keeps powering it, then below 3 V the register resets. Bridge power
balance tolerance is 1e-5 W. A 0.01-ohm short from 5 V AC is safe: 0.280 A RMS, 1.394 W input, output 2.801 mV RMS.
Higher source voltage/current triggers ordinary board protection; direct 300 V bridge input is forbidden.

The demo is a real two-layer editor project: onboard transformer, bridge, separate 100 mF capacitor, write switch,
register, four 1 kohm output resistors. Nine nets are routed through 174 cells, with manual separation cuts; no hidden
fixture bridges are added to the compiled circuit. Commands /pcbbridge demo, write, demo-hold, off, demo-reset;
/pcbbridge export writes a flushed world copy outside the ephemeral queue stage. /pcbbridge resume restores fixture
coordinates for a dedicated-server restart. The client scenario marker is pcb-bridge-photos.

Final acceptance jobs: server 20261108-180811-db7f (restored world + all electrical checks + one deliberate expect100
negative control), client 20261108-180816-04a8 (full demo, six powered faces, eight bridge poses, editor, world export).
Frozen input jars and SHA-256 manifest: /tmp/pcb-bridge-final-candidate/candidate.json. These are unreleased prototype
artifacts, not the existing 2.21.2 release. Acceptance is still pending; do not mark #301.15 done from this paragraph.

Final server 180811-db7f confirms the real saved-world restart (word5, capacitor charge, four loaded outputs),
NBT reload, whole-chain sampled power balance within 1e-5 W, delayed power-loss reset, AC/raw/capacitor, short/hard
short, overload and overvoltage. The deliberate expect100 negative control fails as intended. A new signed-input
assertion also caught that setting a negative CreativeBatteryDevice voltage is overwritten by its block entity;
that old "reverse" fixture did not actually reverse DC. The fixture now physically swaps its two source wires.
Production jar is unchanged; follow-up polarity job 20261108-181252-a69f must prove negative input and positive output.

Polarity server 181252-a69f passes all commands: physical wire swap gives -4.999855 V input and +3.486443 V output;
normal wiring gives +4.999855 V input and the same positive output. Whole-chain balance and loaded word5 pass.
Client 181127-fd06 has 17 OK / 0 FAIL, six faces, eight poses, ten screenshots, normal exit in 287 s. Manual image
inspection still caught a weak test: the editor was open but its client block entity was not ready, so the grid was
empty. Test-only fix delays opening until after client BE synchronization, checks all nine modules on both sides,
and delays the search screenshot by a frame. Final client queue job: 20261108-181841-f81a. Do not accept the empty
editor screenshots from the earlier client run. Close-up bridge model itself is visible and has correct textures.

## L2 bridge final acceptance completed

#301.15 is accepted. Final client 20261108-181843-1485 / queue 20261108-181841-f81a passes **19 OK, zero FAIL**:
six powered mounting faces, eight bridge rotation/reflection poses, actual word5 and four loaded outputs, server
and client editor both contain nine modules. Ten screenshots inspected, including nonempty editor and bridge search;
normal SIGTERM exit in 293 s. The real cabled fixture is partly occluded by its thick inlet; the separate close-up
bridge frame and editor view clearly show the model/pads without missing textures. No stand run is left by this session.

Electrical acceptance: 180811-db7f (full saved-world restart/NBT/load/discharge/AC/raw/capacitor/short/hard short/
overload/overvoltage/whole-chain energy balance) plus 181252-a69f (physically reversed DC source). Both bridge and
transformer-to-bridge active-power balance pass with 1e-5 W tolerance. At -4.999855 V input, output is +3.486443 V;
the normal polarity gives the same positive output. Deliberate expect100 fails; the signed-input assertion caught
and led to fixing the old test source setting before final acceptance. No production source was synthesized.

Deliverable folder: `/Users/ivan/.codex/visualizations/2026/11/08/01a1bc3d-4e07-78c3-aa28-9094b47a8cc5/pcb-bridge`.
It contains prototype jars + manifest, final TFC world, ten screenshots, client-check log, sampled server measurements,
README and verification.json. Final world PCB:20744,300,-11683; design table:20741,300,-11683. Source snapshot
20261106-194903-3047, NeoForge21.1.251; the test jar is optional for loading the saved world.
Main SHA-256: `7394327dce08b001b120306b5fe9c62a7a04e83f5999181423c2a8f34ee3f440`.
Devtest SHA-256: `54b70a5ee2e44288ea8de51d2bc39b381b924c9ecf5a1efe074725269a6a4f34`.

Build/devtestJar, lint (zero errors, existing warnings), formatting, resources (143 items/60 code-selected models,
no errors/seven existing warnings), recipe input reachability/no mechanical-crafting conflict all pass. Prototype
format stays9; no version bump, release, merge or deploy. Keep both feat/pcb-modules branches/worktree for the
remaining #301 catalogue/editor/L2 power/sensors/Create/L3 scope; #301.5 and the parent task stay open.

Saved addon acceptance commit: `dfaed18` on `feat/pcb-modules`; branch pushed for continuation, no release.

## L2 regulator session (#301.16), 2026-11-08

Scope: regulator + actual transformer → bridge → external capacitor → regulator → L2 register demo;
load/ripple/dropout/power cycling/short/overload/persistence/full restart/client. No other modules, L3, LC or release.
Keep pcb-modules worktree and both feat/pcb-modules branches; the parent task remains incomplete.

New type30:3×3 shunt regulator, four pads Vin+/Vin−/Vout+/Vout−, common ground through0.01ohm;
150ohm ballast, passive5V shunt with0.2ohm dynamic resistance and0.01ohm series sense.
Working input8–12V DC, useful output15mA(75mW). No synthetic supply or hidden capacitor.
Thermal model2J/K,0.02W/K to20°C; disconnect90°C, recover60°C; persisted temperature/trip state.
Editor/model/item/recipe/assembly/status integrated; prototype format9/version unchanged.

EE1.1.2 CircuitBuilder.connect(int,int,ElectricalProperties) uses adjacency.put: later parallel stamps replace earlier
ones. The initial direct shunt was replaced by the register idle resistor; earlier demo attempts were rejected.
All regulator branches now have private nodes12000+3*partIndex; actual shunt current is measured across its sense
resistor. The Newton solve also handles the shunt, without reticking the capacitor. Wider shunt bounds/256iteration
limit apply only to networks with a shunt; bridge-only networks retain64iterations.

Electrical acceptance:194548-0a2c + final195604-16b8. At333⅓ohm load,8/10/12V input gives
5.001046/5.003840/5.006633V. Dropout4V→2.758326V;100ohm overload→3.999176V.
0.01ohm short:66.639343mA,0.666mV output; direct trace short:66.643784mA,0V output,0.666253516W heat;
both confirmed at real9.997V input, board intact. The original trace-short fixture picked the first compiled TRACE
instead of the regulator; fixed in final devtest and retested. Main production SHA unchanged.

Real24V heating trips, cooling below60°C recovers. Trip/temperature NBT round-trip passes.
The ten-module demo has actual routed nets, external100mF capacitor,9V~ onboard transformer, word5 and four1kohm
output loads; no hidden fixture bridges. It passes independent register/load power and full chain balance including
capacitor port power (10µW tolerance).100ticks:5.002286089–5.002528173V,0.242mV range.
After source removal it still holds5V/word5 at2seconds; later it discharges and resets. Restoration with write held
produces no false write; a new write edge stores5. Deliberate expect100 fails as intended.

Actual new-server restart from exported world1794167598336 passes: charge and word5 retained, four loaded outputs
correct, supply5.002410586–5.002430812V; another100ticks remain5.002415046–5.002590442V.
Bridge cap and physical reverse-DC regressions pass. Final server world export1794167956788.
248 geometry variants, menu/history/region regressions, build/devtestJar, lint0errors, resources144items/61code
models no errors(7existing warnings), recipe reachability/no conflict, item model inspection pass.

Frozen final candidate:/tmp/pcb-regulator-final-candidate (released=false).
Main SHA256:224d4bb4b59a64e81b7ef957b07fa7df3d9d13ea135d8e94f3bfdec525abf3aa.
Devtest SHA256:4c4664efbb4fab5e52fc45632f3de0accac7354e9ed3cbcc0c6d37b807a057d7.
Final client195652-e955 / run195919-138b passes19OK/0FAIL, six powered faces/eight poses, actual word5 and
four loaded outputs, server/client editor both have ten modules. All ten screenshots inspected: model and project
visible without missing textures; thick inlet partly obscures some views. Search-specific UI is not proven by the
search screenshot, so no separate search acceptance is claimed. Normal exit,298s,252profile mods with Voxy excluded.
The client exported a real TFC demo world1794168242773; board20741,300,-11681; table20738,300,-11681.
No stand run remains. #301.16 is accepted; overall #301 and #301.5 remain open. No release/merge/deploy.
Deliverable:/Users/ivan/.codex/visualizations/2026/11/08/01a1bc9d-f268-7971-829d-b48d7bed0a8d/pcb-regulator.
Commands:/pcbregulator; client marker:pcb-regulator-photos.

Saved addon acceptance commit: `be4e080` on `feat/pcb-modules`; no release or merge.

## L2 sensor session (#301.17), 2026-11-09 — in progress

Scope from owner: temperature/light L2 only, actual powered models/recipes/editor,
regulator-fed sensor→comparator→indicator demos, changed readings/threshold/load,
power loss/recovery, NBT, full restart and full client inspection. No release/L3/LC.
Stand availability was checked before tests. Existing Codex worktree/branches reused.

Candidate adds types31/32, 2×2 three pads output/power/ground; 3–6V DC, passive10kohm
divider +100ohm output,0.5–4.5V unloaded at5V,0.5mA idle; impedance1–2.6kohm.
Invalid supply disconnects upper leg and pulls output down via10.1kohm; one-tick gate.
Temperature−40…160°C reads TFC heat capability behind mounting face, otherwise TFC
instant climate; light0…15 uses max local raw brightness at front neighbor with skyDarken.
Jar API checked TFC4.2.9 / Minecraft+NeoForge21.1.251. Item renders inspected, resource
check no errors/seven existing warnings; build/devtest and lint pass, recipes no conflicts.

First server101511-7771 (233mods, snapshot20261108-192710-4c28) was not acceptance:
isolated fixtures lacked pin traces; reused crucible could not cool from explicit heat setter;
dark box leaked light from below; comparator OPEN input overwrote pot lower leg because
EE builder replaces parallel edges. Fixed fixtures and powered-logic input private nodes.
Chip-input version of the same issue is separately logged #315, outside this session.
Actual demo supply~5.004V and sensor sampled passive power balance10µW already passed.

Second server102027-3ebb queued behind Claude #267 client (do not interrupt that job).
Wait process session15717 was for first server and has completed; second wait not started.
Second server candidates were uploaded before subsequent devtest expect-reading addition;
production is unchanged since. Final client class PcbSensorPhotos exists, marker pcb-sensor-photos,
but not yet submitted. It builds two TFC boards at player Y300 and checks thresholds/editor;
needs final server fixes and image inspection. Main/devtest jar still unreleased2.21.2.
No commit/release/merge/deploy. #301.17 and goal remain open.

### Current frozen sensor candidate, 09.11.2026

Second server102027-3ebb completed, not accepted wholesale. Actual demos pass:
20→150°C gives1.701351→4.302735V; light0→14 gives0.500398→4.236024V;
5V rail~5.003…5.004V, passive balance10µW; real temperature-demo power loss at150s
leaves rail2.72169V and sensor output27µV, lamp off, restoration returns4.30258V/lamp on.
But isolated fixture had no physical edge terminals and never got supply; old off2/7V checks
were false positives because they did not assert actual supply. Threshold command95 meant
raw slider95 (5% output), so those unlit checks failed. Fixed: expose real edge terminals,
assert actual supplied voltage, invert voltage-percentage command to slider position.
A stale global load estimate no longer contaminates reports after switching back to demo boards.

Main sensor now returns RMS voltage to ordinary L2 protection (signed AC average can be zero),
rejects nonfinite source data, and exposes compact body PKM status via Module.input().
Existing regulator PKM flag defect is logged separately #317; no change to that module.
PcbBridgeTest assertion failures now use the logger so they survive into stand log artifacts.

CURRENT jobs (all earlier queued sensor clients/last candidate server jobs were cancelled before running):

- server **20261109-110749-ab69**, wait session23435, stdout /tmp/pcb-sensor-server-final-summary.txt;
- client **20261109-110752-c403**, wait session7314, stdout /tmp/pcb-sensor-client-final-summary.txt.
  Both queue behind Claude #267 client104713-4a22 (started10:51:47UTC, GC/6GB measurement).
  Do not interrupt other jobs or bypass queue. Current candidate frozen in /tmp/pcb-sensor-final-candidate:
  mainSHA a6969917b09877761d2a7047568c9347495549718a072e0b99eaf43dfdd52921;
  devtestSHA ddf54a2f93a015ea4baaff16d8bb54c4a98fc53d383bd560e67f7202dfaf5453.
  Do not change candidate files while queued.

Server final overlay /tmp/pcb-sensor-restart/world was rsynced from real completed save
/home/master/tfc-stand/pcb301-bridge-save-1794221505205. Restore two demos32,-60,32 and64,-60,32;
measure stable5V and both power cycles, thresholds, bright→dark return; isolated tests at96,-60,32
have real edge terminals and check loads1G/1k/0.01ohm, actual0/2/5/7V, NBT, air and highAC protection.
Last expect-output100 is the ONLY expected negative control; every other unexpected RCON error rejects acceptance.
Server submit args (306 entries) stored in /tmp/pcb-sensor-server-job.json, remapped paths by last submit script.

Client uses final same frozen jars, new realTFC world, marker /tmp/pcb-sensor-client-overlay/pcb-sensor-photos.
It tests both demos, high/low thresholds,8-module server/client editor; opens light chamber for model screenshot.
Once complete: inspect EECLIENT OK/FAIL and all PNGs; copy exported TFC world (login coordinate gives temperature
board at Y300, light board east16), prepare deliverable jar/world/photos/measurements/SHA, verify current resources/lint
and formatting, update task17/checkpoint/state/README/plan59, commit+push BOTH feature branches. Do NOT merge/release/deploy.
Task #301 stays open; dev_note(report=true) for scoped completion, not dev_finish (that would close the parent).
Current branches still uncommitted. Earlier loop session9149 timed out then58111 collected server2; those are done.

### Electrical/restart accepted, final native editor check pending (09.11.2026)

Final physical server110749-ab69: every scenario passes except the FIRST immediate resume probe,
which sampled the one-tick sensor startup (supply valid but previous open-divider output still50µV).
A separate NEW-server restart113413-a904 waits3s, restores BOTH saved boards correctly, toggles both thresholds,
and samples100ticks each:5.003452958…5.003476543V and5.003461072…5.003480463V, ripple0.024/0.019mV.
Each server intentionally ends with expect-output100 failure. All actual load/short/source0/2/5/7V,
NBT/both real power cycles/dark return/air/highAC protection checks pass with maina6969917.
Independent /tmp/verify-pcb-sensors.py checks30 real measurements against EXTERNAL scale/Thevenin/load/input-power
math and10µW balance; /tmp/pcb-sensor-measurements.json accepted=true includes explicit startup-probe recheck provenance.

Full client110752-c403 / run112709-0a47:20OK/0FAIL,252mods, normal285s exit. Four PNGs inspected:
both sensor bodies and actual lit demos visible (thick inlet partly covers power modules); editor contains8modules.
Palette screenshot was taken closed (query applied to a hidden field), so not accepted as palette evidence.
TFC world exported /home/master/tfc-stand/pcb301-bridge-save-1794223901402 and already rsynced to deliverable/world.
Temperature board21148,300,-11703; light21164,300,-11703; demo table21161,300,-11703.

Added DEVTEST-ONLY PcbSensorEditorPhotos + marker pcb-sensor-editor-photos, content coordinates21148 300 -11703.
It loads that actual TFC save, GUIscale2, creates empty L2 design at table21158,300,-11703, uses Java Robot K/mouse
for palette selection and placement of BOTH sensors; CtrlZ removes light sensor; repeat should use header BUTTON.
First native UI job114241-2220:10OK/1FAIL. Palette and both placements/Undo pass. CtrlY is intercepted by EMI
(the final frame is its recipe screen), so no redo reaches editor. Separate unrelated issue #318 logged, no production
fix in this bounded session. Final helper now clicks Repeat at screen.width-169,y18 instead of CtrlY.

CURRENT LAST JOB **20261109-115736-656b**, client, queued behind Claude #267 ModernFix/6GB GC run115651-45b3
(start11:56:53UTC, world181s + settle1300s). Wait session79626 writes /tmp/pcb-sensor-editor-final-summary.txt.
Main jar is STILL frozen /tmp/pcb-sensor-final-candidate/ee-extras-2.21.2.jar, SHAa6969917… unchanged.
Latest optional devtest jar is DIFFERENT: /tmp/pcb-sensor-editor-candidate/ee-extras-2.21.2-devtest.jar
(source ClientTest dispatcher + new native editor scenario; existing physics helpers unchanged).
Do NOT overwrite the old frozen physics devtestddf54a2f…; provenance must list both verification jars.

Deliverable prepared at
/Users/ivan/.codex/visualizations/2026/11/09/01a1bfb2-da1d-7033-8878-2c53604e13a3/pcb-sensors:

- jars currently main+OLD physics devtest+candidate.json; replace user-facing optional devtest with FINAL native one after pass;
- verification has30 measurements, two server reports, demo-client report/checks, independent script, lint/resources;
- screenshots has original4frames; models has2inspected item renders;
- world is ORIGINAL demo-client TFC save; replace with LAST successful native-client exported save after result;
- README Russian is drafted, still says Repeat button pending; update it. No manifest.json/ZIP yet.

Remaining: await115736-656b; require11OK/0FAIL and inspect palette/two-sensor/restored PNGs. Capture extra-world path
from client.log, rsync --delete world, copy final UI logs/frames and optional test jar, hashes/manifest/ZIP.
Update README/state/checkpoint/doc59, dev_check301 done[17], scoped dev_note(report=true) (NOT dev_finish parent).
Log repeatable automation additions in existing #311. Commit+push addon feat/pcb-modules, then parent docs+tools pointer
feat/pcb-modules. Keep worktree, do NOT merge/deploy/release or close overall301. Verify both git trees clean,
mark goal complete ONLY after actual required work is done and deliver result. Known CtrlY conflict#318 remains with
Repeat-button workaround once verified; other findings#315/#317 intentionally not implemented.

## Sensor acceptance completed (#301.17), 09.11.2026

All scoped requirements are accepted; no required work remains for the two sensors.
Physical110749-ab69 + clean full restart113413-a904 pass30 independent matrix measurements,
real source0/2/5/7V,1G/1k/0.01ohm loads/short, both power cycles, changing readings/thresholds,
air/NBT/RMS protection and stable5V. Startup race of first immediate probe was explicitly rechecked after settling.
Demo client110752-c403:20OK/0FAIL, both bodies/lamps/eight-module editor, four inspected frames.
FINAL native editor115736-656b:11OK/0FAIL, actual window K/mouse selection and placement of BOTH sensors,
CtrlZ and Repeat BUTTON, three inspected screenshots, normal245s exit. The prior CtrlY failure was EMI interception,
separately logged #318; do not claim CtrlY works. Both main/editor runs use productionSHAa6969917… unchanged.
Physics helper classes are byte-identical in the extended optional editor-test jar; provenance JSON is in deliverable.

Final TFC export1794227134676, boards21148,300,-11703 (temperature) and21164,300,-11703 (light);
eight-module demo table21161,300,-11703; native two-sensor placement table21158,300,-11703.
Deliverable path above contains world, main jar, stand-only devtest, seven inspected game frames,
two item renders, independent30-measurement proof, original server/client reports, manifest and Russian README.
Only the main jar belongs in a normal game profile: devtest has automatic client scenarios and is stand-only.
#301.17 is accepted; parent301/remaining catalogue/L3/LC/release remain outside this session.
Keep both feature branches/worktree for continuation, no merge/deploy/release. Final scoped report must preserve
known separate issues#315/#317/#318. Last native job is done; do not restart earlier/cancelled jobs.

Saved sensor addon acceptance commit: `3ae5caf` on `origin/feat/pcb-modules`. No release or merge.
