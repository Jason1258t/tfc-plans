# PCB modules — paused checkpoint, 2026-11-08

Paused at the owner's explicit request after completing the current L2 logic step. Task #301 remains incomplete.
Authoritative requirements: server plan doc:59, especially 2.1, 2.2 and 6.1. Do not replace the scope with this checkpoint.

## Checkout and saved state

- Worktree: `.claude/worktrees/pcb-modules`; parent branch `feat/pcb-modules`.
- Addon repository: this worktree's `tools/`, also branch `feat/pcb-modules`.
- Earlier addon checkpoints: `021ea8c` (palette / relay), `ba074b9` (latch / selector / mechanical winding),
  `5f20975` (powered comparator / clock). Latest L2 checkpoint: `a8791bc` (flip-flop / counter / register / decoder).
- Prototype format **8**, no migration. Current jar name still `ee-extras-2.21.2.jar`; this is not a release.
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
4. Implement onboard power, vibrator/HV gate, sensors, remaining controls and interfaces/Create integration.
   Onboard PSU has only two outputs; no half-board inlet/guard zone. HV only accepts AC/vibrator.
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
