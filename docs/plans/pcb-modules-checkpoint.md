# PCB modules — current continuation checkpoint

Updated 2026-11-10. **Implementation is paused at the owner’s request.** This session only
cleaned documentation and prepared the next session. No module code changed and no new stand jobs were submitted.

## Authoritative state

- Task #301:14/20 checked; overall incomplete. The checklist was not changed during this preliminary audit.
- Main requirements and owner decisions: doc:59. Preliminary requirement-by-requirement audit and future goal: doc:62.
- Worktree: `.claude/worktrees/pcb-modules`; both repositories use `feat/pcb-modules`.
- Last implementation commits: addon `4c45ab1`, parent `c8177151`. Later documentation commits do not change the tested binary.
- Prototype format9,36catalogue module types. No migration of old designs. Jar name2.21.2 is a prototype name, not a release.
- No release, version bump, merge or deployment. Preserve this worktree for the next session.

## Verified implementation

| Area                        | Current evidence                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multicell geometry/editor   | Rotations/reflections,64-step history, groups/copy/paste, other layers, parameters, footprint/pad outlines; server checks and actual native client input, six mounting faces |
| L1 controls/light           | Buttons, switches, slider/rheostat, SET/RESET flag, mechanical timer, panel2×2 and five-section strip2×5; physical operation and persistence recorded in the history         |
| Onboard transformer         | 3×3, native EE coupling, two secondary pads and direct300V AC inlet; loaded output, short/DC/overvoltage, restart and client accepted                                        |
| Step-up transformer #13/#14 | 3×3,four pads,AC only; final client20261108-142522-2510 and real saved-world restart, independent power balance accepted                                                     |
| L2 logic #6                 | Powered comparator/clock/D-flip-flop/counter/register/decoder, real loaded outputs and state/restart tests exist; **integration risk #315 remains open**, see below          |
| Bridge #15                  | 3×3,four pads,actual EE diode bridge; server/restart/client accepted, addon dfaed18                                                                                          |
| 5V regulator #16            | 3×3,four pads,8–12V DC input,15mA useful output; load/ripple/dropout/thermal protection/restart/client accepted, addon be4e080                                               |
| Temperature/light #17       | Two2×2 analog modules;30independent measurements, full restart, native editor client115736-656b accepted; addon3ae5caf                                                       |
| Rotation #18                | 2×2,Create API speed−256…+256rpm;24measurements, restart and client162500-e1ff accepted; addon226bb90                                                                        |
| Optocoupler #19             | 3×3,five pads,separate input/output circuits;49measurements, graph isolation/common-mode test, restart174316-ca76 and client173732-6343 accepted                             |
| Connector #20               | 2×9,eight signals+common; final physical/current/cache/thermal/restart/client checks accepted, detailed evidence below                                                       |

No old “candidate”, “not yet viewed” or “currently queued” paragraph supersedes these accepted results.
Detailed intermediate records, old hashes and stopped job handles are preserved in
[historical notes](pcb-modules-history.md). Do not rerun their old jobs from a historical instruction.

## Remaining requirements and next session

The preliminary audit is doc:62; do not treat this summary as a replacement for doc:59.

1. Verify the20checklist entries against their actual acceptance scope. Keep closed results with evidence;
   expose false/partial closure and untracked requirements as concrete child items with stable numbering.
2. #301.5 is the first open composite item: onboard power, slider/rheostat, sensors and connector exist;
   agreed L2 communication, particularly Create information output, remains incomplete.
3. #315 is still unverified/unfixed: logic chips stamp input→ground directly, and EE adjacency.put can
   replace another branch on the same nodes. Reproduce with actual external circuits before relying on #301.6
   as complete integration evidence. No fix or regression was performed in the cleanup session.
4. Missing catalogue entries include buzzer, rotary knob, seven-segment display, logic assembly and Create
   adapter; reconcile mandatory versus undecided entries with owner decisions and track them explicitly.
5. #301.8/#301.11 have separate L1/L2 and L3 acceptance; record completed subparts without closing the parents.
   CPU/RAM/language/display/L3 interfaces and release remain open. Probe/library are explicitly editor stage2;
   bus/program UI depends on L3 and must not be silently counted as implemented.

The future goal is prepared in [next-session brief](pcb-modules-next-session.md) and doc:62.
**Do not start it merely because this checkpoint is read.** The owner requested a different session for implementation.
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
