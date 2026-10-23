# tools/ — pack addons (NeoForge mods)

How to build, test without the game and release — [docs/addons.md](../docs/addons.md); addon status —
[docs/state/addons.md](../docs/state/addons.md).

- Versions come from the pack (`mods/`), not "latest". Game facts about target mods — from their jars via MCP
  (`class_info`, `decompile`, `code_refs`, `mixins`), not from memory.
- Edited resources → MCP `resources_check addon=<path to the mod folder>` and look at `model_render` (pass
  `addon=<path>` when working in a git worktree). Translation keys from code need `./gradlew compileJava` first.
- Every key must exist in `ru_ru` (players see Russian).
- Site card — `addon.json`, site page — guide `addon-<mod>` (MCP `guide_get`/`guide_put`); release steps — skill
  `addon-release`, final check — MCP `addon_check`.
- Icons for the site are drawn by `node scripts/mcp/render.mjs <addon folder> <ids…>` (release scripts call it).
- Nothing can be checked in game: report what the dev server verified and mark the rest «в игре не проверялось».
