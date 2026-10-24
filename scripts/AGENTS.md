# scripts/ — data builders

Pipeline overview — [docs/architecture.md](../docs/architecture.md). MCP server — `scripts/mcp/AGENTS.md`.

- Parsers are a library: input, output (instead of `public/`) and cache dirs are parameters (`buildMods`,
  `buildKubejs`, `configDocs`, `worldDocs`, `packRelease`, `runPack`); repo-root paths are only `npm run …` defaults.
  New paths — as parameters too, not `ROOT`.
- `src/shared/pack-data/recipeFilter.ts`, `recipeRefs.ts`, `nbt.ts`, `datapackFiles.ts`, `addonVersions.ts`, `schematicFile.ts` (imports only
  `./nbt.ts`, with the extension) — **no imports, erasable TS syntax only**: both the site and Node run them
  (`import '../src/lib/x.ts'` from `.mjs`, Node 24). `tsconfig` has `erasableSyntaxOnly` — no enums, no parameter
  properties.
- What a mod defines in code (enums, constants) — read via `scripts/mods/classfile.mjs`, don't hardcode: site data must
  rebuild from the current pack's jars. Example — `scripts/mods/botany.mjs`.
- Per-mod rules (icons drawn by code, hidden items) — one module per mod in a registry, soft failure, conditions from
  bytecode; no `if` on mod names in the engine.
- `kubejs/data` is a datapack: it overrides data too (`tfc/food` etc.). Anything the site shows from mod data needs a
  merge with `kubejs-data.json` or at least a warning in `kubejs.mjs` (`MOD_ONLY_DATA`).
- When the jar cache format changes, bump the `.done-vN` marker in `mods.mjs`, or the old cache won't rebuild.
- Pack jars live outside the repo — the snapshot cache (`scripts/pack-cache.mjs`: `~/.cache/tfc-plans/pack`,
  `TFC_PACK_CACHE`; jars `TFC_MODS_DIR`), filled by `npm run pack:fetch`. There is no `<repo>/mods/`; don't add one.
  Mod data reaches the site only via the pack server (see the `ship` skill).
