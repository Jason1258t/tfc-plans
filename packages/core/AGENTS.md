# packages/core — `@tfc/core`

Shared core: formats and pure functions run by **both** the site (Vite) and Node (`scripts/`, MCP, `cli/`). First
stage of splitting the repo (dev task #138, plan doc 23).

- Import from outside as `@tfc/core/<module>` (`exports` maps `./*` → `./src/*.ts`): `import { readNbt } from
'@tfc/core/nbt'`. Works from `.mjs` too: Node 24 strips types, and the workspace symlink resolves to
  `packages/core/src`, outside `node_modules`.
- **Erasable TS only** (`erasableSyntaxOnly`: no enums, no parameter properties), no `@/` alias, no React, no DOM-only
  or Node-only APIs (`node:*`, `window`, `document`). Web APIs present in both (`CompressionStream`, `Blob`,
  `TextEncoder`) are fine.
- Imports inside the package are relative **with the extension**: `./nbt.ts`. Only external dependency —
  `firestore-files` (for `files.config.ts`); add new ones to `package.json` here.
- What belongs here: a format or a rule that two of {site, scripts, MCP, cli, server} must agree on. Site-only code
  stays in `src/`, Node-only code — in `scripts/`.
- `cli` bundles these files into the `tfc` binary: `scripts/tfc-dist.mjs` (`buildVersion`) lists the ones that change
  the app version — update that list when cli starts using a new module.
- Pack-server helpers (`server/pack-server/lib/{paths,datapacks,schematic-nbt}.mjs`) are not here yet: the server is
  installed by copying only `server/pack-server` to the VPS (`deploy/install.sh`), see plan stage 4.
