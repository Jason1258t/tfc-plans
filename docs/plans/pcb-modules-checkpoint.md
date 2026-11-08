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
  High-voltage AC transformer and L2 regulated supply remain unimplemented.

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
