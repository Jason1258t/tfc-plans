# PCB modules — current continuation checkpoint

Updated 2026-11-16.
Audit of all20original items completed against code, late logs and artifact hashes.
Checklist expanded to 30 items: concrete catalogue/acceptance work21–29, explicitly deferred editor stage2 is30.
Four catalogue additions and project naming are implemented; acceptance is in progress.
See [all-item audit](pcb-modules-audit.md); do not treat compilation as runtime acceptance.

## Authoritative state

- Task #301: 16/30 checked at the beginning of the 2026-11-16 session. #315 and #301.28 accepted.
- Main requirements and owner decisions: doc:59. Preliminary requirement-by-requirement audit and future goal: doc:62.
- Worktree: `.claude/worktrees/pcb-modules`; both repositories use `feat/pcb-modules`.
- Input isolation accepted at addon `b195a4c` / parent `2f0d43ff`. The four modules and name input are in addon `7aa79dc`, the NAND demo routing fix in `a61882a`, and the client fixture fix in `87811a3`.
- Prototype format9,40catalogue module types (19L1/21L2; four new candidates not yet accepted). No migration of old designs. Jar name2.21.2 is a prototype name, not a release.
- No release, version bump, merge or deployment. Preserve this worktree for the next session.

## Verified implementation

| Area                        | Current evidence                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multicell geometry/editor   | Rotations/reflections,64-step history, groups/copy/paste, other layers, parameters, footprint/pad outlines; server checks and actual native client input, six mounting faces                              |
| L1 controls/light           | Buttons, switches, slider/rheostat, SET/RESET flag, mechanical timer, panel2×2 and five-section strip2×5; physical operation and persistence recorded in the history                                      |
| Onboard transformer         | 3×3, native EE coupling, two secondary pads and direct300V AC inlet; loaded output, short/DC/overvoltage, restart and client accepted                                                                     |
| Step-up transformer #13/#14 | 3×3,four pads,AC only; final client20261108-142522-2510 and real saved-world restart, independent power balance accepted                                                                                  |
| L2 logic #6                 | Powered comparator/clock/D-flip-flop/counter/register/decoder, real loaded outputs and state/restart tests exist; #315 and #301.28 accepted: 45 checks, server → cold restart → client, tracker note:1447 |
| Bridge #15                  | 3×3,four pads,actual EE diode bridge; server/restart/client accepted, addon dfaed18                                                                                                                       |
| 5V regulator #16            | 3×3,four pads,8–12V DC input,15mA useful output; load/ripple/dropout/thermal protection/restart/client accepted, addon be4e080                                                                            |
| Temperature/light #17       | Two2×2 analog modules;30independent measurements, full restart, native editor client115736-656b accepted; addon3ae5caf                                                                                    |
| Rotation #18                | 2×2,Create API speed−256…+256rpm;24measurements, restart and client162500-e1ff accepted; addon226bb90                                                                                                     |
| Optocoupler #19             | 3×3,five pads,separate input/output circuits;49measurements, graph isolation/common-mode test, restart174316-ca76 and client173732-6343 accepted                                                          |
| Connector #20               | 2×9,eight signals+common; final physical/current/cache/thermal/restart/client checks accepted, detailed evidence below                                                                                    |

No old “candidate”, “not yet viewed” or “currently queued” paragraph supersedes these accepted results.
Detailed intermediate records, old hashes and stopped job handles are preserved in
[historical notes](pcb-modules-history.md). Do not rerun their old jobs from a historical instruction.

## Remaining requirements and next session

The preliminary audit is doc:62; do not treat this summary as a replacement for doc:59.

1. Verify the20checklist entries against their actual acceptance scope. Keep closed results with evidence;
   expose false/partial closure and untracked requirements as concrete child items with stable numbering.
2. #301.5 is the first open composite item: onboard power, slider/rheostat, sensors and connector exist;
   agreed L2 communication, particularly Create information output, remains incomplete.
3. #315 reproduced with originalJAR: register after external10kpot gives4.999929V instead2.5V; reverse order2.499931V. Private split1Gohm input branches fix it. Final standalone regression completed on 2026-11-15, see #315 note:1447.
4. Buzzer/rotary knob/seven-segment/quadNAND are candidates in code (36–39); only Create adapter is absent. Owner confirmed quadNAND as mandatory. Catalogue/table/README distinguish checked results from candidates; edge terminal is toolG, LED panel separate from lamp, capacitor nonpolarA/B. Project name is implemented, acceptance pending (29); probe/library explicitly later30.
5. #301.8/#301.11 have separate L1/L2 and L3 acceptance; record completed subparts without closing the parents.
   CPU/RAM/language/display/L3 interfaces and release remain open. Probe/library are explicitly editor stage2;
   bus/program UI depends on L3 and must not be silently counted as implemented.

The future goal is prepared in [next-session brief](pcb-modules-next-session.md) and doc:62.
The owner explicitly started that different implementation session on2026-11-10.
No stand is reserved. Recheck access/queue when that session actually starts; use the queue, not old PID/lock files.
Known independent follow-ups include #315,#317,#318,#327,#328,#329; check their live status before taking one.

## Practical continuation

- Use the absolute main `scripts/mcp-call.mjs` for current stand tools; this preserved worktree may have older tools.
- Trusted stand route used in prior tests: `TFC_CLIENT_HOST=master@192.168.0.101`; normal host-key checking stays enabled.
- Large stand JSON output can truncate (#328); inspect authoritative job state and recover raw results by rsync.
  An observer timeout does not justify restarting the job.
- On the CPU stand, native EE basic wire rendering was used; Flywheel issue #329 is separate.
- JDK21: `$HOME/.gradle/local-tools/jdk21/Contents/Home`. Build from `tools/ee-extras-mod` with
  `./gradlew build devtestJar --offline`; lint/format from the parent worktree before commits.

## L2 eight-line connector — verified, 2026-11-10

Item #301.20 is verified. Overall #301 remains open; no release/version bump/merge/deploy.
Only the connector milestone is completed: no Create adapters, L3, LC or other modules added.

- 2×9 cells,8signals+explicit green common,9real EE leads and0.01ohm contacts. Nominal0–5V DC,
  limit6V relative to common,10mA signal/80mA common, RMS board protection. No logical copying,
  source or implicit ground. Model, recipe, catalogue, rotations/reflections and native editor history.

- Demo TX21230,300,−11477 / RX21233,300,−11477:8switches→9leads→8comparator/LED channels.
  Independent transformer→bridge→100mF→regulated5V supply per board,3blocks north.
- Final server `20261110-083455-ba20`:269commands/392seconds,33positive words,
  32unique18-contact/cache checks,32nine-wire independent-RMS/zero-heat checks,5×81pair audits,
  each1kohm/all8×4700ohm loads, short/open/common, both power cuts/restores,NBT,100samples,
  real EE thermal destruction positive control. Only intentional expect100 fails.
  TX5.0047321917…5.0047507173V; RX5.0013664815…5.0013850234V.
  Loaded8signals5.002459V,1.064mA each/8.515mA common. Off RX rail2.1e-15V with5V inputs/5nA,
  LEDs off. Open common at85 gives±2.502V via other input paths: not isolation.
- Final client `20261110-083505-8b73`:9native spool connections,81/81,255/85,17-module project,
  native mouse placement/Undo/Redo,8screenshots inspected. Completed normally by stand SIGTERM.
  Native EE basic renderer used on CPU stand; general Flywheel problem is separate #329.
- Cold server `20261110-083958-ff8a`: new process from client-exported world1794264010270,
  no demo/rebuild.17positive words,15unique/cache checks,16wire-RMS/temperature checks,
  3×81audits; all loads, full unplug/replug,NBT,100samples pass, no failed assertions.
  Final world export1794300707108 downloaded:~34MB, valid level.dat, no symlinks.
- Fixed root cause: connector builder.node redundantly recreated external EE nodes. addInternalNode
  unconditionally adds a duplicate; stale wire cache then read5V instead of actual16microvolt and
  burned second lead. Removed duplicate creation; native resistor stamp creates only missing nodes.
  EE getNodeID now resolves canonical map ordinal; formulas/thermal destruction unchanged.
  Earlier failed runs are diagnostic evidence, not accepted tests.
- Main SHA256 `b06f5e3d102dfaa597c29ec52f32c63d934917ea364f9987ef8633c8468c5569`;
  devtest `216b038021438765a5133dc731cdb0155b3d0401d24c25599be2dda439579169`.
  Gradle build/devtestJar, lint0errors, changed docs format and git diff checks pass.
- Working kit/report/screenshots/evidence:
  `/Users/ivan/.codex/visualizations/2026/11/09/01a1c187-7451-7990-8f01-21e1cd7b1246/pcb-connector/kit`.
  Access: trusted LAN `TFC_CLIENT_HOST=master@192.168.0.101`; owner confirmed Tailscale auth too.
  Tool truncated large JSON worked around by raw rsync (#328); routing automation candidate #327.

## Current goal acceptance work, 2026-11-10

- Full historical audit: original20marks reviewed; late raw logs, jarSHA15–20 and
  complete manifests sensors107/rotation113/opto112/connector133 verified without gaps.
- New server100331-8eb1:320geometryvariants; rotary loaded endpoints/25%/50%, power/NBT;
  buzzer0/2/3/5/6/7V and realpower; all7individualsegments/digits/NBT; independentquadNAND
  inputs/loadedoutputs/power/NBT pass. Initial sevensegment pin isolation bug fixed and rerun.
- Client151224-251c:22positive native assertions,0FAIL; allfourmodules searched/selected/placed
  by nativeK/mouse, Undo/Repeat; 9images available but inspection/restart/final naming pending.
  Earlier100352-f96c failed because player remained too far from table; fixed by teleport before opening.
- Runtime evidence root:
  `/Users/ivan/.codex/visualizations/2026/11/10/01a1c4d6-2109-7403-8e80-6e4cf676c1b7/pcb-audit`.
- Coldserver151648-23a6 submitted from exported flatworld1794305230608, no initial rebuild;
  checks saved7segment/NAND, angular hit240poses, naming/serialization, new knobloadtests.
  Observe through stand_wait; do not rerun solely on observer timeout.
- Final client scene now also includes physicalquadNAND, actualsoundevent and nativeprojectname packet.
  New submission handle to be recorded after stand_submit returns.
- No prototype commit/push in this goal yet. Both repositories have local candidate changes.
  Finish acceptance, synchronize docs/tracker, lint/format, then preserve/push bothfeat/pcb-modules;
  current goal explicitly excludes release/version/merge/deploy and overall301 closure.

## Resumed acceptance — 2026-11-16

The four catalogue modules already present in the worktree are the buzzer (22), rotary knob
(23), seven-segment indicator (24) and quad NAND (25). The name field now sends the value shown
when editing began, so a concurrent rename is rejected by the server's existing comparison.
The server restart scenario builds and saves the four reference boards, then opens that same
world in a new process and checks the saved name of an assembled and installed board.

- Client rerun `20261116-164846-3baf`: catalogue, mouse placement, undo/redo, real name packet,
  buzzer sound event and models. Initial run `20261116-162841-c157` saw both addon versions,
  so later runs exclude the pack JAR by filename. Run `20261116-163916-ee5f` received the
  buzzer event but the player fell and the menu did not stay open. The rerun uses ground level
  and teleports the player onto solid ground before opening the editor. It logged 26 OK, no FAIL:
  native placement, undo/redo, sound event and a real rename packet. The final screenshot still
  showed an empty client-side field and grid, and the world shots did not show the boards.
  Item #301.29 stays open until the client reflects the server name. First reproduce using a
  prebuilt world with the editor present before joining, then inspect client entity and topology
  synchronization if needed. #301.27 also stays open.
- Server save `20261116-163848-2ead` → cold restart `20261116-163903-f804`.
  Initial save `20261116-163012-7bd4` stopped at the NAND demo: its four load placements blocked the
  prescribed router. The new layout routes all 14 nets and four visible loads in a known order.
  Both final server stages passed. Cold restart restored all four circuits and the editor/installed
  board name. Items #301.22–25 are checked (20/30 total).
- Gradle build, resource validation and all four recipe conflict checks passed.
- The prototype is based on 2.21.2. The pack now includes EE Extras 2.22.1. Before release, the
  PCB branch needs integration with the newer addon main and validation of the merged build.

### Create interface (26) — API findings

Create 6.0.10's split-flap board accepts flap text and requires kinetic speed. The ordinary
`acceptText` method on `DisplayBoardTarget` is empty. `DisplayLinkBlockEntity` transfers from
the adjacent source to its own bound target, checks both positions are loaded, and suppresses
periodic refresh while redstone-powered. Keep the screen link away from the PCB's lamp signal.
On loss of PCB power, send a blank flap line explicitly while the board and link are loaded.
Removing the source or targeting an unloaded block stops transfer and therefore cannot clear
a receiver immediately.

The rose quartz lamp consumes normal redstone but its render model follows `POWERING`,
the short pulse, rather than sustained `POWERED`. A constant level is unsuitable for a
persistent indicator with this lamp. Lamp state and screen value will need distinct outputs.

Create Deco 2.1.3's cage lamp has a sustained input at its mounting side and supports an
inversion setting. Linear Bearing 1.2.6's andesite lamp tracks the strongest neighboring
redstone signal. Both are candidates for a persistent indicator in the pack. Create's nixie
tube receives Display Link text through its own target and can display a short state/value.

The candidate 3×2 design has distinct analogue and binary inputs, shared ground and a
3–6 V DC supply input. Use separate EE branches for the two signal inputs to preserve
external divider resistances (#315). The binary signal drives the board's oriented
redstone output. The analogue signal uses a dedicated Create display source, selected
independently by each attached Display Link. The old first-meter display source stays
available for existing boards. Demonstrate at least two simultaneous links, a lamp on a
separate redstone route, loaded and unloaded recipients, power loss and a cold restart.

## Project name acceptance — 2026-11-17

The saved-world client run `20261117-134016-b687` showed the saved design and initial title,
but still displayed the old title after edit and redo. The open editor now receives the
authoritative topology from its server menu whenever it changes. The grid, selection parameters,
parts list and project name all use this snapshot. Block-entity updates remain available for
clients observing the world.

The server chain `pcb-name-restart` checks the rename, rejects a foreign menu ID and an out-of-date
previous name, verifies undo and redo, saves the drawing, assembles and places the board, and checks
the editor and installed board after a new server process starts. Save `20261117-134812-9b3e` and
restart `20261117-134815-25a0` passed on the same main JAR (`f3ded6f6…`).

Client run `20261117-134727-d043` verified the native name input and all three server transitions.
The original name, undo and redo appeared in the editor. The first post-Enter screenshot still
showed the previous value. Rerun `20261117-144252-7119` allows five seconds for each editor transition
and checks each server-side value independently.

### Create display transport (26)

In Create 6.0.10, a Display Link with an active source refreshes every 100 ticks by default.
The source can select a shorter interval via `getPassiveRefreshTicks`; each configured link
polls its own target, so the adapter can use passive updates without keeping a receiver list.
The base transfer calls both the flap-specific and plain-text APIs. A blank display should
send a line with an empty component and no label. The split-flap target keeps a single-line
source's previous text when the input contains no line. Expect the target's next eligible
refresh when it loads, reaches operating speed or the link resumes after a redstone pause.

Client `20261117-155622-9b3d` confirmed the stale value was in the menu snapshot itself.
Calling `broadcastChanges` from `finishEdit` sends the committed change immediately.
Final client `20261117-163340-8692` passed 9 assertions with no failures and exited normally.
Four screenshots were inspected, including the new name, undo and redo. Native AWT keyboard input
uses a single Robot; two earlier repeats aborted in native code with a double-free error.
The final cold-restart chain uses the exact client JARs, main SHA256
`b7c13571c606b9c3e5b926632166ccd001392768661c14fde66bdf1ab653cf86`.
Its jobs are `20261117-163722-bd9c` → `20261117-163724-c633`.

The final save job `20261117-163722-bd9c` passed. Its scheduled restart
`20261117-163724-c633` failed in the queue worker before server startup, with no RCON
transcript. Repeat `20261117-165523-6f9d` uses that save through `worldJob` and the same
frozen main and devtest JARs. Attachment `r4DBxEYEQiC2l7DnlWyW` records the failed chain.

Cold restart `20261117-165523-6f9d` passed from the final save, using the matching frozen
main/devtest hashes. RCON confirmed the editor and installed board name. #301.29 is checked,
21/30 complete. Addon commit `9d798a7` is pushed to `origin/feat/pcb-modules`.
The next active catalogue gap is the powered Create L2 adapter (#301.26).

## Isolated local work — 2026-11-18

The owner confirmed that another chat owns the original `pcb-modules` worktree. Do not edit it from this chat.
The local continuation is in `pcb-create-local` / `feat/pcb-create-local` in both repos, based on parent
`c6167c6c` and addon `9d798a7`, with a snapshot of the uncommitted Create candidate. Reconcile this branch
with the owning chat before transferring changes. The stand is rebooting; no new runtime jobs were submitted
after the owner's instruction to work only on code and textures.

Local additions: per-Display-Link adapter selection; adapter numbers in installed component feedback; editor
help explains scan order (top to bottom, left to right) and the shared OR lamp output. The second demo knob at
25% produces 3.75 V, not 1.25 V: its supply-to-wiper resistance is 2.5 kohm and wiper-to-ground is 7.5 kohm.
The client assertion was corrected accordingly; runtime acceptance remains pending. The shared Scene scaffold
from main is included for the `pcb-create` scene.

The new generated top-face panel is 32×32, 16 colours, opaque, with analogue/digital channel marks. Original,
preparation notes, enlarged texture and inspected item render live in `tools/ee-extras-mod/art/pcb-create/`.
Only the top lid face uses it; other faces retain EE/Create textures. Local build/devtestJar, lint and resource
validation pass (existing warnings remain). No release, merge or deploy; #301.26 is still open.
