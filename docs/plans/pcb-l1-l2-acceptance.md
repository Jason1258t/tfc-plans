# Aggregate L1/L2 acceptance — #301.27

Audit started 2026-11-18. This document records evidence coverage, not a new runtime pass.
Accepted baseline: addon `d26c21d`, parent `84b958ed`, both `feat/pcb-modules`.
Overall #301 and #301.8 remain open. No release or merge is part of this milestone.

## Requirements and evidence

| Demonstration family                                        | Existing evidence                                                                                                         | Remaining verification for aggregate acceptance                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1 controls, panel and section strip                        | Historical module/rotation tests, loaded potentiometer/rheostat, independent section masks; doc:59 and checkpoint history | Locate raw saved worlds, power/protection transcripts and useful final client frames; verify coverage on accepted implementation                                               |
| L1 SET/RESET flag and mechanical timer                      | Historical electrical operation and flag cold restart; timer winding/hold/reset/write-read                                | Verify actual chunk unload/load, preserved mechanical state and absence of replayed ticks; identify final client evidence                                                      |
| L2 comparator, clock, flip-flop, counter, register, decoder | Individual loaded-output tests and #315/#301.28 input regression chain                                                    | Map raw evidence to each demo; check chunk lifecycle and clock pulse behaviour without catch-up                                                                                |
| Transformer, bridge, regulator                              | Accepted #14–16 electrical, protection, saved-world restart and client evidence                                           | Index original kits and confirm which lifecycle cases they cover; do not infer unload from restart                                                                             |
| Temperature, light, rotation, optocoupler and connector     | Accepted #17–20 measurements, restart and client evidence                                                                 | Index original kits and explicit chunk coverage; preserve individual accepted results                                                                                          |
| Buzzer, rotary knob, seven-segment, quad NAND               | `pcb-l1-l2` kit: server/cold restart; 91 manifest entries independently rehashed successfully                             | This kit alone is not aggregate acceptance. Its README explicitly reports missing world views and an old client name issue; use later accepted evidence for those requirements |
| Project naming                                              | Accepted #29, final native client and frozen-JAR cold restart                                                             | Reference final naming kit rather than superseded screenshots in the four-module kit                                                                                           |
| Create L2 adapter                                           | Accepted #26: frozen main SHA f74a20df…, server chain 124406-71e9 → 124409-f744 → 124414-8043; final client 130531-bc85   | Retain accepted status. Receiver-only unload run 130942-2a85 remains uncounted until its result is inspected; separate pcb-create-local additions are not accepted baseline    |

Create chunk unload and reload were independently found in the build's actual `latest.log`
at lines 14243 and 14245. RCON contains the commands but empty `say` replies: command text
alone would not establish this requirement. Restart transcript checks restored analogue
2.4999401457 V, supply 4.9998927912 V, display values and lamp state.

## Artifact identity

- Four-module kit main SHA256:
  `d1f999d67b6a4cc4edc9d841d07f436fe04326d8f7f3ad1120159a0a17aeab46`.
  It is a historical build, not the current accepted Create build.
- Create kit: all three entries listed in its SHA256SUMS match. That manifest lists JARs
  only; it does not establish integrity of every world/log/image file.
- Independent integrity results:
  `/Users/ivan/.codex/visualizations/2026/11/18/01a1efc6-77eb-7593-bee5-4999c9d73f83/pcb-l1-l2-acceptance/artifact-integrity.json`.

## Current execution constraints

Queue inspection failed over Tailscale (`100.109.147.20`, SSH timeout) and the most recently
documented LAN route (`192.168.0.102`, host down). No job was submitted or restarted.
This is not evidence that the previously submitted receiver-only job failed or vanished.
Continue local evidence mapping and prepare only the missing checks; fetch that existing
job when access returns before considering another run.

## Completion gate

Each family needs explicit evidence for applicable real power/load/protection, saved state,
cold restart, chunk unload/load and viewed editor/installed-board frames. Mark a case
not applicable only with its electrical or state contract explained. Attach the final
indexed kit (JARs/SHA, worlds, instructions, measurements, logs and images), synchronize
doc:59/checkpoint, preserve/push verified prototype changes, then mark #301.27.
No acceptance mark is changed by this preliminary audit.

## Local preparation — 2026-11-18

The sensor, rotation, optocoupler and connector manifests were independently rehashed:
107, 113, 112 and 133 entries respectively, with no missing files or hash mismatches.
Results are in `historical-integrity.json` beside the earlier integrity report.
Bridge/regulator kits have no corresponding file manifest in their roots; zero manifest
entries is **not** a successful integrity check for them.

The searched historical kits do not establish chunk unload/load for these families.
In particular, `pcbconnector unload` removes a load resistor, not a chunk. Ordinary
server shutdown messages about unloading chunks are not a running-world lifecycle test.

Seven new chains are prepared in the addon's `stand.json`:

- `pcb-l1-latch-lifecycle`: unpowered latched state, actual chunk unload/load, restoration
  under load, RESET/SET, saved reference and cold server restart.
- `pcb-l1-timer-lifecycle`: expiry during chunk absence, no new winding edge from a held
  input, manual cancellation, saved absolute deadline and cold server restart.
- `pcb-l2-{flip,counter,register,decoder,gates}-lifecycle`: all individually loaded outputs,
  saved words/input levels/circuit, actual chunk unload/load, cold restart and subsequent
  real input changes. A held register write must preserve 5 across both lifecycle events,
  then a new edge writes 15; the counter must not invent an extra edge on loading.

New devtest-only `pcblifecycle` commands verify the loaded state without requesting a chunk,
and compare an explicitly named device NBT field to a reference stored in Minecraft command
storage (which survives a new process). Missing reference/field/device and a burnt board
fail. The scenario also checks numeric `Loaded`, `Saved` and `Equal` replies, so an echoed
command is insufficient. L1 chains include negative checks for the wrong loaded state and
a missing reference; the flag also checks that resetting makes the old state comparison fail.

`./gradlew build devtestJar --offline` passed. The main JAR is byte-for-byte the accepted
Create build: SHA256 `f74a20df7b0d34bbdf090f265fdd8d03d6511c143dfccf640c5c3e8acb18cb9c`.
Prepared devtest SHA256: `1bd05cbf91dfbe0ba257bddaab597d29a00e5b746921c54d8487a700101adc76`.
**None of these seven new chains has executed.** This preparation supplies no new runtime,
protection, visual or acceptance result. Clock/comparator and other remaining family
coverage must still be completed; successful compilation does not close #301.27.
