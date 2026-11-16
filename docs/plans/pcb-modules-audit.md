# PCB requirement audit — 2026-11-10

Owner resumed implementation in a new goal session. Source: task301, plan59 rev44,
plan62 rev2, both repositories, late raw logs and preserved kits. Runtime work below is
separate from the historical evidence audit. Original marks retained; concrete gaps21–28 added.
No release/version/merge/deploy; preserve both prototype branches.

| Item | Implemented / verified                                                                                              | Remaining / tracked by                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Catalogue and owner overrides; actual footprint/pin definitions                                                     | Synchronize accepted vs missing rows:21; buzzer22, knob23, seven-segment24, open logic assembly25 (owner confirmed)                 |
| 2    | Multicell identities, transforms, placement, compilation, persistence; geometry tests and late real boards/restarts | New-module regressions; original mark justified                                                                                     |
| 3    | Editor, search/parameters/diagnostics/BOM/history/groups/layers; native mouse and six mounting faces                | Probe/library explicitly stage2; bus/program L3. Project-name input implemented, acceptance29; explicitly deferred stage2 tracked30 |
| 4    | Panel2×2, strip2×5, five independent pairs; masks21/31/reverse27, assembly and persistence                          | Original mark justified; new seven-segment24 is separate                                                                            |
| 5    | Power, slider/rheostat, sensors, optocoupler, physical connector accepted                                           | Rotary23, Create26 and integrated acceptance27/28; parent remains open                                                              |
| 6    | Latching flag/timer/transistor/powered logic; loaded outputs, edges, state/restart                                  | Input-branch integration risk315→28; original isolated evidence retained                                                            |
| 7    | No RAM/CPU/language catalogue entries                                                                               | L3 parent open                                                                                                                      |
| 8    | Accepted L1/L2 demos, load/power/restart/client evidence                                                            | Integrated L1/L2 subpart27; parent stays open until L3                                                                              |
| 9    | Prototype kits only                                                                                                 | Release open, outside current goal                                                                                                  |
| 10   | No L3 display                                                                                                       | L3 parent open                                                                                                                      |
| 11   | Rotation input and old meter display source exist                                                                   | Hardware state/value interface26; later software L3; parent stays open                                                              |
| 12   | button model has no missing reference; late resource checks                                                         | Run resources after new changes                                                                                                     |
| 13   | Step-up contract/model/recipe/main+test jars                                                                        | Preparation mark justified; electrical evidence14 separate                                                                          |
| 14   | AC/DC/load/short/protection/state/restart/client17OK0FAIL                                                           | Original mark justified                                                                                                             |
| 15   | Bridge AC/both DC polarities/discharge/cap/load/balance/restart/client19/0                                          | Original mark justified                                                                                                             |
| 16   | Regulator5V15mA/load/ripple/dropout/thermal/short/restart/client19/0                                                | Original mark justified                                                                                                             |
| 17   | Temperature/light30independent measurements/power/load/NBT/restart; client20/0+native11/0                           | Original mark justified; EMI shortcut318 separate                                                                                   |
| 18   | Rotation signed speed/stop/reverse/missing mechanism24measurements/restart/client17/0                               | Original mark justified; does not replace11                                                                                         |
| 19   | Optocoupler49measurements/current/hysteresis/isolation/common-mode24V/power/restart/client18/0                      | Original mark justified                                                                                                             |
| 20   | Nine native wires/eight signals/independent supplies/loads/open/short/backfeed/NBT/cold restart/native editor       | Original mark justified                                                                                                             |

## Historical evidence actually checked

All six kits15–20 contain main/test jars, level.dat, images and logs/measurements.
Main jar SHA values match the plans. Full manifest verification: sensors107, rotation113,
opto112, connector133 files; no missing or changed files. Raw client assertions match claimed
counts. Connector EECLIENT lines are in client-latest.log, not client-output.log.
Step-up raw server folder /tmp/pcb301-verified-server and client result20261108-142522-2510 exist.
Kit locations are retained in checkpoint/history and the addon README.
These are historical checks, not newly repeated runtime acceptance.

## Explicit editor concept remainder

Project-name editing from concept2.1 is now implemented with a bounded/stale-safe server packet,
undo/redo and topology/item metadata. Server/client/cold acceptance remains open as29.
Probe/section library is explicitly stage2; L3 bus/program/addressed controls remain L3.

## Implementation and acceptance

- #315 / #301.28 accepted on 2026-11-15. The external divider and eight parallel-input circuits passed;
  the server / cold restart / client chain recorded 45 checks (tracker note:1447).
- The rotary knob, buzzer, seven-segment indicator and quad NAND are under separate acceptance.
  -Rotary knob2×2: separate3-pin10k variable resistor, angle hit testing and pointer model.
  -Buzzer2×2: passive1kohm, positive3–6V DC enables a repeated local bell tone.
  -Seven-segment2×3: seven actual LED branches, independent anodes and shared cathode.

Owner confirmed the separate logic module: four independent NAND gates,14pins.
Catalogue count40=19L1+21L2; future Create adapter41. Edge terminal is a tool,
LED panel is separate from lamp; capacitor is nonpolar A/B.

No new module is marked complete before full electrical/restart/client acceptance.

## 2026-11-16 acceptance

- #301.22–25 accepted with full server load/power checks, a cold restart and native editor actions.
- #301.29: server, clipboard and network submission, rejection, undo/redo and saved board name
  passed. The latest screenshot showed an empty name field. Client display remains open.
- #301.26: Create 6.0.10 API and selected lamp behaviour verified from the pack jars.
  The hardware interface remains to be implemented.
