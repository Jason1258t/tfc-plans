# Aggregate L1/L2 acceptance — #301.27

## Supplementary acceptance and attached worlds — 2026-11-19

Lamp/LED/panel chain153504-e578→153507-22fd is accepted on mainf74a20df:
actual cold voltages8.263640/7.472305/8.263640V, power0.179332W, mask7;
power0 produces mask0 and negligible watts, restoration24V restores mask7.
Actual unload/load and Circuit equality were inspected in raw replies. This adds a23rd
lifecycle case to the22 initial cases.

Three immutable world/JAR/log archives are attached to301:

| File                        | Attachment           | SHA256                                                           |
| --------------------------- | -------------------- | ---------------------------------------------------------------- |
| pcb-lifecycle-worlds-01.zip | n9IgoTFpodL56DdzcrWv | ab709dd6d9469b151da629be8c2f488e515cfc3da678e088f46f14195a0e7bda |
| pcb-lifecycle-worlds-02.zip | UYusy4sOCzG0SrlOMJoc | f578c31e6ae4f408ea54083463436e11e821ad30214c6ba26a899d5aaee824b5 |
| pcb-lifecycle-worlds-03.zip | j20WmFWFIo5QckTCEFsy | c91e7ca5385a477705a921af9bda66ae7a2f0673f09b24b74d1c33643f14776c |

All3323 archived files were re-read from the ZIPs and matched their per-file SHA256.
These parts contain working lifecycle worlds, not destructive fault worlds; final instructions,
coverage matrix, historical views and supplementary fault evidence will be separate indexed parts.

Positive fault verdicts already observed: pot153618-775f, rheostat153632-a64b,
latch winding153642-628c and timer winding153652-9d61. The first three raw transcripts
were inspected: at60V they change Burnt0→1; watts3.59970/2.39987/3.59956 respectively.
Timer raw inspection remains pending. Earlier latch-short failed because the fixture omitted
its expected-voltage argument; timer-short asserted before its configured delay elapsed.
Corrected jobs154558-f152/154612-4d18 are pending; these were fixture failures, not
accepted fault tests or demonstrated production defects.

The original strip fixture was L2. Plan59 explicitly requires the strip on L1, including
polarity/off/overload: a new three-step chain154247-ea21→154250-bacf→154253-755c
is prepared and queued with devtestbe813d9e. It uses the same productionf74a20df,
five actual voltage/current readings and a separate destructive copy after cold acceptance.
No acceptance is claimed until its raw results return. Other logic/short jobs are indexed
in artifact `logic-protection-jobs.json` and `supplemental-jobs.json`.

## Latest evidence — 2026-11-19, continuation

All22 initially prepared lifecycle cases now have inspected positive raw evidence.
Regulator152212-0963→152220-6960 and temperature152332-2ec2→152337-1e82 passed.
The latter reports actual Loaded=0/1, Circuit/Positions Equal=1 and cold19°C,
supply5.0044216V→output1.6814817V with indicator off. No production patch was needed.
The isolated earlier retention remains unattributed; it was not reproduced by the three
diagnostics or by the full lifecycle repeat. All22 working-world sets are preserved under
`kit-staging/lifecycle` in the acceptance artifact root (still not the final attached kit).

The goal's aggregate completion gate is still unproven. A further raw-coverage audit found
missing explicit invalid-power/short/overload evidence for early logic and missing numeric
lifecycle evidence for lamp/LED/panel. Supplemental fixtures are committed, not accepted:
addon18fe11e/833fe85/1eb7cbe. The first D protection job152850-abf6 had a terminal
`fetch failed` before Minecraft; its repeat and the other fault/lamp jobs must be observed.
Do not count their prepared assertions as runtime evidence. Production remains f74a20df.

Nine final viewed client frames plus logs/SHA are attached to301 as
`BhaAWA9vK8Ssm9EiwjGA` (`current-client.zip`,2.3MB). No mark27 was changed.

## Current status — 2026-11-19

Twenty of the twenty-two lifecycle cases now have inspected positive evidence on the
unchanged production JAR f74a20df. In addition to the ten cases below, bridge, light,
rotation, optocoupler, connector, onboard supply, section strip, potentiometer, rheostat
and the four-module catalogue have passed actual unload/load and a new server process.
The six first family chains were audited against all twelve raw scenario/transcript/world
sets: 54 numeric checks, nine actual Loaded=0 and nine Loaded=1 responses, 24 Equal=1
responses; both frozen JARs were independently rehashed. Later repeat cases are indexed
in `observed-revived-families.json` in the artifact directory.

Final client 20261119-111732-096b passed with mainf74a20df/devtest17fce742 and all nine
frames were actually viewed: full boards are centred, effects do not obscure them, and
the overview shows the complete powered stage. This supersedes the cropped client frames.

Remaining: regulator full chain152212-0963 → 152220-6960 and temperature full chain
152332-2ec2 → 152337-1e82. Earlier network failures were confirmed terminal before retry.
The regulator's original source world had been pruned remotely by the queue; its local
copy remains, and the new full chain avoids an unavailable worldJob.

Temperature diagnostics111707-2311 (intact),111706-6103 (PCB removed),111706-0d57
(crucible replaced by stone) all passed on unchanged mainf74a20df. Each reports no_ticket,
Loaded=0 and BlockTicking=0 after40seconds; intact remained unloaded at120 and180seconds.
The previous retention is therefore not attributed to a production defect. No production
patch or relaxed assertion was introduced; full lifecycle confirmation remains required.

#301.27 remains open pending the last cases, coverage audit and attached indexed kit.
The following sections preserve earlier evidence and chronological execution history;
old connectivity and pending-job statements do not describe the current stand.

## First ten lifecycle cases — inspected evidence

The ten prepared lifecycle cases now have inspected positive evidence on unchanged
production SHA f74a20df7b0d34bbdf090f265fdd8d03d6511c143dfccf640c5c3e8acb18cb9c:

| Case             | Save/unload job → accepted cold restart | Inspected cold result                                                                                                      |
| ---------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| L1 flag          | 181319-e675 → 194527-5902               | Unpowered Latched retained; restore23.9987V under load, RESET works                                                        |
| Mechanical timer | 184550-69bc → 194533-c842               | Absolute deadline/winding input retained;23.999V, cancellation does not retrigger while winding stays high; new edge works |
| D flip-flop      | 192514-ebfe → 194542-48d4               | Word1 retained, two actual outputs; new edge writes0                                                                       |
| Counter          | 192523-1728 → 192528-8713               | Word1 retained without a fabricated edge, next real edge gives2                                                            |
| Register         | 192506-816c → 192510-0674               | Held write retains5; next real write gives15, four loaded outputs                                                          |
| Decoder          | 192531-8b4c → 192535-6e59               | Word4 retained, input3 produces8                                                                                           |
| Quad NAND        | 192539-bb34 → 192543-f29f               | Word14 retained, input255 produces0, four loaded outputs                                                                   |
| Comparator       | 192548-de64 → 192551-5d0b               | 4.54527V/0.0252252W, low0V/0.0025W, power-off0, restoration works                                                          |
| Clock            | 192555-96f4 → 192558-3614               | Saved phase retained;100samples46/54 with5transitions, stop and restart then58/42 with5transitions                         |
| Step-up          | 192603-0885 → 192606-cf23               | External loaded196.6952947V, power-off0, restoration196.696022V; balance/current assertions pass                           |

All job IDs above have prefix20261118-. Seven complete native chain verdicts are true.
The flag/timer/flip use their original successful save plus a separately submitted cold
retry after the scheduled step's confirmed infrastructure failure. Original failed verdicts
remain as history; they are not relabelled as successful. Each accepted retry has inspected
raw RCON, scenario0failures, the original source world and both actual SHA values in its summary.

Actual Loaded=0/Loaded=1 response lines (not echoed commands), complete numeric scenario
checks and raw transcript hashes are indexed in artifact files `observed-chain-checks.json`
and `observed-cold-repeats.json`.

Client 182756-7370 passed with 9 frames; all were viewed and show the six powered boards.
Cleaner client 20261119-102157-3f4c also passed with devtest 44b72da5 and all 9 frames
were viewed: knob, buzzer, lit seven-segment, loaded NAND, mechanical timer and all three
selector positions are visible without effect particles. The enlarged view cuts off some
board-edge contacts, so the final framing is being centred; this is a fixture-only change.

#301.27 is still open. Remaining family coverage is being checked against the actual
legacy demos (supply/bridge/regulator/sensors/opto/connector/lights), before creating the
final indexed kit. The older status sections below are chronological history, not current blockers.

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

## First runtime results and current handles — 2026-11-18

The stand briefly became reachable. The previously unobserved receiver-only job
`20261118-130942-2a85` is terminal `done`: raw latest.log lines 14229/14230 confirm
RECEIVER_UNLOADED and SOURCE_LOADED. Subsequent lamp/power-loss/blank/restore assertions
passed. This supplements accepted #26 without reopening it.

The flag chain now has actual evidence:

- `20261118-181319-e675` passed: actual Loaded=0 then Loaded=1, unchanged Latched/Circuit,
  zero output while unpowered, 23.9987 V under load after power restoration, SET/RESET and
  three successful negative controls (opposite loaded state, missing reference, changed flag).
- Scheduled cold restart `20261118-181322-abc7` is terminal `error`, reason `fetch failed`,
  before Minecraft started. It is not an electrical or state regression result.
- Repeat `20261118-181835-c221` uses that same saved world and frozen f74a20df/1bd05cbf
  JARs. Its result is unknown: the observer lost SSH, which is not a terminal job result.
- Timer `181910-0686` → `181913-7818` and register `181909-b7f6` → `181912-b5f4` were
  submitted with the same frozen JARs. Observation timed out after connectivity vanished;
  reobserve those exact handles, do not infer failure or create duplicates.

Interim attachment `tu7JONG5aPxbhQSB5mTY`, `pcb-l1-latch-partial.zip` (2.2 MB), contains
the automatic chain evidence/world, frozen JARs, full checksums, explicit failed-restart
status and the additional receiver-only logs. It is not the final aggregate acceptance kit.

Two additional chains, `pcb-l2-comparator-lifecycle` and `pcb-l2-clock-lifecycle`, are
prepared but not submitted. They check real loaded output/power or 100 sampled ticks,
plus actual chunk lifecycle and saved circuit/phase across a cold process.

Read-only visual audit found useful old frames in client run `20261108-103726-b348`
(23 OK/0 FAIL) and `20261110-152618-3e9f` (25 OK/0 FAIL). Exact loaded JAR hashes for
those two runs remain unproven. The former shows the flag, lights and L2 packages; the
latter shows the knob/buzzer/seven-segment and four modules together in the editor,
but its installed NAND frame shows sky. Mechanical timer and three-position switch
are missing from that older catalogue gallery. The 16 November world frames show grass.
Do not claim these runs visually cover every installed module.

New scene `pcb-acceptance` builds six real powered boards for those visual gaps, including
all three selector positions. It uses the shared Scene camera and tests measured outputs
before photos. A static placement audit checked 31 distinct board/source/probe positions;
the timer uses a separate row so its winding battery cannot overwrite a NAND input.
The scene compiles, but has no runtime or viewed-frame result yet.
An initial submission attempt froze candidate `pcb-acceptance-20261118-182118`, then
lost SSH; its local candidate has no job ID. Before resubmitting, inspect the remote queue
for that exact attempt/note/hash once reachable. The subsequently corrected layout was
rebuilt as devtest SHA `a37da5ccc0a1443e39ed90bf0ec83fa6cf2e52cff4185f05f202c6028e04b846`;
main remains f74a20df. Neither client candidate has been accepted.

Tailscale reported test1a offline after last seen 18:20 UTC; both known SSH routes timed
out. This blocks result observation and additional runs, not proof that queued jobs stopped.

## Reconciled queue state — 2026-11-18, 18:29 UTC

Connectivity returned again. The timer/register first steps above are now confirmed
terminal errors, both `fetch failed` before Minecraft startup; their dependent restarts
are cancelled. They can be retried without duplicating live work.

Flag repeat181835-c221 booted the copied world, but did not load either addon: its broad
manual exclusion `ee-extras-` removed the frozen main/devtest as well as the snapshot JAR.
The resulting unknown command is a fixture error, not an accepted restart or a PCB defect.
Corrected repeat182851-45cc uses the original save181319-e675, the original frozen JARs
and only excludes the exact snapshot filename `ee-extras-2.22.1.jar`. Its result is pending.

The initial client attempt182118 had no job and was absent from the authoritative queue.
The corrected, committed client scene was successfully submitted as182756-7370 with
mainf74a20df/devtesta37da5cc; observe this handle rather than resubmitting.

Prototype branches are preserved: addond0c8c33, parent3afd8d81 before this status note.
The main JAR remains unchanged. #301.27 is still open.

## Latest authoritative continuation state

- Corrected flag restart182851-45cc is terminal error: `fetch failed` before boot.
  Cold restart of the flag is still unaccepted. Source save181319-e675 remains intact.
- Original timer/register chains are terminal infrastructure failures as above. Later
  resubmission attempts lost SSH or hit the CLI180-second timeout before returning IDs.
  Reconcile the remote queue by their notes and frozen hashes before any new submission.
- Client182756-7370 was successfully submitted; its observer ended on broken SSH.
  Its remote terminal state is unknown, so reobserve that same ID first.
- Prepared chains now total10: the prior nine plus `pcb-l1-stepup-lifecycle` (not submitted).
  The latter uses the real external loaded voltmeter/balance, a running-world chunk cycle,
  cold restart and a power cycle; its purpose is to restore the missing cold-server raw proof.
- [Historical raw evidence index](pcb-l1-l2-evidence-index.md) preserves numeric results
  and distinguishes old failures from later corrected cases. It does not claim current
  runtime/chunk acceptance. Thirteen raw source files were copied with an exact path/hash index.
- Tooling follow-up#393 records the manual immutable-step retry procedure and the broad
  exclusion mistake, so a future retry command can preserve the correct JARs/world safely.

Next dependent work requires the stand: reconcile the uncertain submissions, inspect the
client result and retry only confirmed terminal infrastructure failures. Do not add acceptance
marks or release the prototype while those results and the remaining family checks are absent.

## Remaining-family execution — 2026-11-19

Twelve additional family chains (24 server steps) were submitted; the durable job index is
`family-submissions/index.json` in the acceptance artifact directory. Bridge, light sensor,
rotation sensor, optocoupler and connector now have positive native lifecycle verdicts.
The regulator save/unload step passed (word5, output5.0027185–5.0027371V over101samples);
its scheduled cold process failed before boot with `fetch failed`. Frozen-JAR retry
20261119-110233-2321 uses the same source world103357-8fb8.

The temperature case103404-f662 failed the actual unload assertion: after removing all
forced chunks and40seconds the target was still loaded. Its electrical checks were valid
(19°C, supply5.00399V, output1.68134V, indicator off). Its dependent cold step was correctly
cancelled. No acceptance condition was relaxed. Linked fix#395 tracks attribution: three
diagnostic jobs compare the intact setup (including180-second observation), removal of
the PCB, and replacement of the TFC crucible. Their IDs are110237-7a6b,110240-c2c2 and
110243-ac2e. Devtest-only ticket/ticking-state inspection uses actual DistanceManager APIs
verified through MCP on NeoForge21.1.251. Production remains byte-identical f74a20df; no
claim about which component causes retention is made yet.

Centred final client104118-5bc5 is queued with devtestbb4624c8. The previously viewed
clean client102157-3f4c passes and has all six models, but some board edges are clipped.
Twenty-six actually viewed historical images are preserved with source paths/hashes in
`legacy-visuals/index.json`; they are explicitly not labelled with the current production SHA.
