---
name: addon-dev
description: Develop a pack addon (NeoForge mod in tools/<mod>) — decide addon vs KubeJS/datapack/mixin, research the target mod's API by bytecode via MCP, scaffold from the closest existing addon, write code and resources (ru_ru, models, loot, recipe), verify on the dev server with a devtest mod, then hand off to addon-release. Use for «сделай аддон», «новый блок в аддон», «добавь в аддон», «миксин для мода X», a new addon or a new block/mechanic in an existing one.
---

# Addon development: task → route → API by bytecode → scaffold → resources → dev server → release

Details live in [docs/addons.md](../../../docs/addons.md) (environment, versions, devtest, EE device blocks, graphics);
`tools/AGENTS.md` has the short rules. This skill is the order of work. Releasing (card, icons, site page) — skill
`addon-release`; merge/deploy/push — skill `ship`. Everything players see (lang, page, commits, report) — Russian.

## 1. Task and worktree

- Site task in group «Разработка» (`tasks_list group=Разработка query=…`, else `task_create`), status `doing`,
  assignee `Claude`. Bigger features — a plan doc on the task (`artifact_put`), or skill `integration-plan` first
  when the idea is "borrow X from mod Y".
- Own worktree and branch (`feat/<addon>-<short>`), never the main checkout. Another session may be editing the same
  addon — check `git -C /Users/ivan/vscodeProjects/tfc-taskmanager branch` / `worktree list`; don't touch its folder.

## 2. Is it an addon at all?

Pick the lightest route (docs/addons.md «Когда нужен аддон»):

| Need | Route |
| --- | --- |
| recipe, tag, removal, TFC data (heat, food, fuel) | site datapack or KubeJS — no addon |
| pack config value | `config_get` → `config_propose` |
| change a number/condition in someone's code | mixin addon (`ee-overheat`, `stress-fix`, `rw-host-fix`) — breaks on target-mod updates |
| new block/item with logic | full addon (`ee-extras`, `small-diesel`, `miner-tools`) — server **and** every player |

Before a mixin, look for a public hook of the target mod — an event, registry, capability or static helper (e.g. TFC
`HeatCapability.provideHeatTo(Level, BlockPos, Direction, float)` heats a block below without touching TFC code). A
hook survives updates; a mixin needs `mixins target=<class>` for conflicts and the dedicated-server warning.

## 3. Target-mod API — from bytecode, never memory

MCP `tfc-pack` over the pack's actual jars:

- `class_find` (`*Heater*`, `kind=mixin`, `platform=true` for Minecraft/NeoForge) → `class_info` (ancestors, fields with
  constants, method signatures) → `decompile class=… method=…`.
- `code_refs` — who calls/writes it (`Owner#method`, `access=write`); `event_listeners`; `mixins` — what else patches
  the class; `config_get` — the live config values your formulas depend on.
- Copy how the target mod builds its own similar block (base class, block entity, capability registration, network)
  and repeat it. Write the facts you relied on (class, method, version) into the addon README and the report.

## 4. Scaffold (new addon)

Copy the closest addon (`small-diesel-mod` — Create/EE block with optional dependency; `miner-tools-mod` — items,
Curios, IE; `stress-fix-mod` — mixin-only with Gradle) without `build/ run/ libs/ .gradle/` and jars:
`build.gradle settings.gradle gradle.properties gradlew gradle/ libs.sh rcon.py test-server.sh release.sh addon.json
art/gen_assets.py art/png.py src/main src/devtest README.md`. Rename `modId`, package, `archivesName`, devtest mod id
and command, jar names in `release.sh`.

- **Versions from the pack's `mods/`, not "latest".** NeoForge = the max of what the dependency mods require
  (`jar_grep query='modId = "neoforge"' path=META-INF/neoforge.mods.toml jar=<mod> context=3`; e.g. TFC 4.2.9 needs
  21.1.234, Create 6.0.10 — 21.1.219) → `neo_version` in `gradle.properties` and `[x,)` in `neoforge.mods.toml`;
  dependency ranges from the jars' versions. Optional dependencies — separate package + `ModList.isLoaded` +
  `neoforge:mod_loaded` conditions (docs/addons.md).
- `libs.sh` lists the dependency jars (`compileOnly`, plus their `META-INF/jarjar/*.jar`). In a worktree `mods/` is
  absent: `MODS=/Users/ivan/vscodeProjects/tfc-taskmanager/mods ./libs.sh`.
- JDK 21: scripts set `JAVA_HOME=$HOME/.gradle/local-tools/jdk21/Contents/Home`; `./gradlew build` (first run
  downloads NeoForge ~400 MB; maven handshake errors — retry).
- `test-server.sh`: own `rcon.port`/`server-port` — taken: 25596–25599, 25571–25572 (grep `tools/*/test-server.sh`).

## 5. Code and resources

- Lang: every key in `en_us` **and** `ru_ru` (players see Russian); keys from code need `./gradlew compileJava` before
  checking.
- Models/textures in the target mod's style: look at its similar blocks (`model_render`, `texture_get`), reuse its
  textures by reference (`"texture": "<mod>:block/…"`) where they fit, draw the rest with `art/gen_assets.py` in its
  palette. Blockstates cover every property combination/orientation.
- `data/<mod>/loot_table/blocks/*.json`, `minecraft:mineable/<tool>` tag (+ TFC/needs-tool tags if relevant),
  recipe from pack items only — check ids and that the inputs are obtainable (`items_search`, `recipes_for`,
  `tag_members`; KubeJS removals are applied in their answers).
- Check: `resources_check addon=<worktree>/tools/<mod>` — no errors; `model_render addon=<path> id=<block>` for each
  `state=` variant/facing, not just the default.

## 6. Verify without the game

- `./gradlew build`, then `./test-server.sh '<mod>test …' 'sleep N' '<mod>test report'` — dev server with the real
  dependency jars, flat world, RCON. It catches load failures (versions!), registration crashes, placement.
- Devtest mod (`src/devtest`, not in the jar): commands that build the setup (place blocks, connect wires, creative
  source/load) and print measured numbers — energy/heat/stress/rpm per tick, against what the formula says. Test the
  edge cases: no dependency (`NO_<MOD>=1`), restart with `KEEP=1`, old world migration (`OLD_JAR=…`), every orientation.
  Make the check fail once on purpose to prove it catches something.
- Mixins: confirm they apply (`-Dmixin.debug.export=true`, log line); client-only mixins can't be checked on the
  server — say so.
- `log_analyze path=run/logs/latest.log` for errors.
- Report and site page always separate: **checked by code** (bytecode/MCP), **on the dev server** (which command, what
  numbers), **«в игре не проверялось»** (models seen by a client, feel, multiplayer).

## 7. Hand-off

- README of the addon: what it does, how it works, what's verified.
- Release — skill `addon-release` (version, `./release.sh`, `addon.json`, guide `addon-<mod>`, `addon_check`).
- Update `docs/state/addons.md` (version, what changed, how verified) and the table row in `docs/addons.md` (new
  addon — new row); new findings about a target mod's internals — the relevant section of docs/addons.md.
- Commit `Аддоны: <мод> <версия> — …`, skill `ship`; site task → `done` with a short Russian note; what waits for the
  host or an in-game check → `docs/state/pending.md`.
