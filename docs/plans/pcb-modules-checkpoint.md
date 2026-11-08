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
