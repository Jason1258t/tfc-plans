# State: pack MCP (`tfc-pack`) history

Part of [STATE.md](../STATE.md). What each tool does and how to add one — [docs/mcp.md](../mcp.md); wishlist —
[plans/mcp-next.md](../plans/mcp-next.md). This file only records what was verified and how.

- **2026-10-20, base** (`scripts/mcp/`, `.mcp.json`): local stdio server without deps — items, recipes with KubeJS and
  kubejs/data, tags, reference, layered configs (Firestore `config`, read-only), guides (read and `guide_put` with
  revision check — Firestore precondition on `updateTime`), jar search/read, javap. Verified by a stdio node script
  (54 checks against direct JSON, jar, javap and Firestore reads); guide writes tested only for refusals.
- **2026-10-20, +24 tools** (40 total, `scripts/mcp/tools/*.mjs`): pack overview (`mods_list`, `mod_get`,
  `pack_updates`); KubeJS sources; books (TFC manual 173 entries, 139 in Russian, with addon and KubeJS entries; IE
  manual 133, no own Russian); translations and loot (`lang_search` ~53k keys, `block_get`, `loot_for`,
  `loot_sources`, kubejs/data overrides jars); site content read-only; map (`map_point` uses `projection.ts`, climate
  reimplemented from TFC Real World 4.1.4 / TFC 4.2.9 bytecode; `map_rocks` gives rock variants with shares — the
  seed picks the exact rock; `map_find`). **Climate and rocks not compared with the game.**
- **2026-10-21, code debugging** (49 tools, `tools/code.mjs`, `logs.mjs`): index of all classes (~66k mod classes incl.
  nested jar-in-jar, + ~9.8k Minecraft/NeoForge with Mojang names from the addon build cache) in ~3.5 s;
  `class_find`/`class_info`/`class_hierarchy`, `code_refs` (~2–6 s over the pack), `mixins`, `decompile`, `jar_grep`,
  `mods_check` (FML 4 rules, checked against `ModSorter`/`VersionSupportMatrix` bytecode; 0 problems now, pack minimum
  NeoForge 21.1.248), `log_analyze`. Mixin behaviour checked against Mixin 0.8.7 bytecode. Not tested on a real player
  crash at the time.
- **2026-10-21, after the first real debugging** (51 tools): `log_analyze` handles Windows CRLF crash reports,
  Connector/Sable header, thread, mods in the stack, top-frame mixins, section details, system and mod-list diff;
  `level=timeline`. Regexes accept `(?i)`; non-regex search supports «a|b». New `event_listeners` (incl. KubeJS bridges
  like `PlayerEvents.loggedIn`, names from `<clinit>` of KubeJS event classes); `code_refs` field write/read and code
  side; ⚠ client-class references in `class_info`/`mixins target`; `map_regions`. Minecraft sources — NeoForge 21.1.251
  (`tools/rw-host-fix-mod/devserver`). Verified on three player `latest.log`s and an FTB Quests crash report.
- **2026-10-21, site datapacks in recipes + client resources** (54 tools; order ① from mcp-next): recipe tools layer
  flagged site datapacks over mods; `model_render`, `texture_get`, `resources_check`. EE Extras — no errors; a
  corrupted copy — all planted errors found.
- **2026-10-21, translation keys and worktree addons**: `resources_check` finds keys passed to `Component.translatable`
  with any prefix and via ternaries (Miner Tools: 0 → 15 from code + name); `model_render`/`texture_get` accept
  `addon=<path>`.
- **2026-10-21, tasks and plans with writes** (62 tools): `groups_list`, `task_create`, `task_update`,
  `artifacts_list`/`artifact_get`/`artifact_put`. Write shape matches the site (rating 1000, `completedAt`, checklist
  ids), signed `Claude`. Verified on temporary task and doc in prod (created, stale-revision refusal, edit, deleted);
  not opened on the site.
- **2026-10-22, GeckoLib in `model_render`**: bones and cubes as in GeckoLib 4.8.3 (checked in bytecode), armour over a
  player silhouette, bone tree, UV/transparency warnings. Miner Tools helmet renders; no other GeckoLib models in pack
  jars.
- Config edits by agent (`config_propose` → host) — see [infra.md](infra.md#agent-config-edits-2026-10-21).
- **2026-10-22, `mods_freshness`**: report from `src/lib/freshness.ts` (shared with the site), changelogs of newer
  versions (Modrinth deduped by version, CurseForge HTML → text). Verified via stdio script: filters, paging, json,
  Modrinth mod (JEI), CurseForge mods (Sophisticated Backpacks, FTB Quests), hand-built mod (`tfcr_fixes`). First call
  ~11 s while the manifest has no `cf` fingerprints (reads all jars), then cached. Same day: git source (pack devs'
  GitHub releases), changelog = release bodies; checked via stdio (`tfcr_fixes` 1.7.7 → 1.7.12 with 5 release notes,
  `woodencog` current).
- **2026-10-22, `mods_freshness deps/beta`**: `deps=true` downloads the newest jar (Modrinth file / CurseForge
  downloadUrl or CDN path / GitHub asset) into `.cache/mcp/fresh/`, reads `neoforge.mods.toml` + jar-in-jar
  (`archiveMods` in `code-index.mjs`) and checks it with `depContext` from `tools/code.mjs` (the `mods_check` logic,
  pack jar swapped for the new one) + dependents whose ranges break. Changelogs: releases only unless `beta=true`,
  oldest first, paged by version, 10 000 chars per version; Modrinth HTML (Serilum) → text; CurseForge files paged
  back to ours. Verified via stdio: World Border 5.0 needs Collective [8.40,) (pack 8.39 ✗), Liquid Fuel 3.0.0 needs
  Create [6.0.4,) (ok), Deep Seas 3.0.0→3.3.0 (4 releases; with betas 10, `offset=5` → 3.4.1), Moonlight on CurseForge
  from 2.29.8 (67 releases), Collective HTML → text; `mods_check` unchanged.
- **2026-10-22, candidate jars** (66 tools, `tools/candidates.mjs`): `candidate_get` registers a jar that is not in the
  pack (local path, Modrinth slug/version with sha1 check, or a direct Modrinth CDN / forgecdn / GitHub link; download
  only with `download=true`) into `.cache/mcp/candidates/` and summarises it: mods, license, deps via `depContext`
  (as a swap if the mod is already in the pack), jar-in-jar, content by lang keys with ru_ru, recipes by type, tags
  (pack overlap via `tags()`), worldgen/biome modifiers, `ModConfigSpec` classes, mixin targets × pack mixins.
  `jar=candidate:<file>` (and `candidate:<file>!<nested>`) works in `jar_find`/`jar_read`/`jar_grep`/`jar_javap`/
  `class_find`/`class_info`/`class_hierarchy`/`decompile`; candidate classes live in a separate index
  (`candidateIndex`), not in the pack's. Verified via stdio on Create: Power Grid 0.6.2 (Modrinth): counts match
  `unzip -l`/lang (113 recipes, 37 tags, 77 blocks, 1057 classes, 3 mixin configs / 18+5+6 mixins), deps ok against
  the pack, `decompile CThermal`, pack `class_find` doesn't see candidate classes. Going Nuclear isn't on Modrinth
  under NeoForge 1.21.1 and Destroy has no 1.21.1 NeoForge build there — for them `path=` or `url=`.
