# src/ — the site

Where code goes and how it is imported. Light FSD is established (dev task #75). Not every layer is mandatory; **when in
doubt put the file next to its main user**, not where the scheme says it "should" be. `src/components`, `src/lib` and
`src/data` retain shared UI, adapters and intentional Node entry points; their existence is not a request for another
mass move. Put new code by the rules below and migrate existing code only when its owner actually changes.

## Layers

`app → pages → widgets → features → entities → shared`. A layer imports only from itself and those to its right:
`features` — `features/entities/shared`, `widgets` — `widgets/features/entities/shared`, pages —
`pages/widgets/features/entities/shared`, `app` — anything. `features` and `widgets` follow these simplified rules and
exist only for code several pages really need: code for one page stays in `pages/<x>/`. Check — `npm run ui:boundaries`.

| Code is needed by                                                                    | Goes to                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| one page                                                                             | `pages/<x>/` (`ui/` components, `model/` logic), page file `<X>Page.tsx` |
| two or more pages, has domain knowledge (tasks, schematics, guides, items…)          | `entities/<name>/` (UI optional)                                         |
| two or more pages: user action/flow (guide editor, task comparison, datapack upload) | `features/<name>/`                                                       |
| two or more pages: composite UI block (header, agent panel, recipe catalogue, intro) | `widgets/<name>/`                                                        |
| any page, no domain knowledge (Modal, Button, util, firebase wrapper)                | `shared/ui`, `shared/lib`, `shared/api`                                  |
| any page, shared pack reference (items, recipes, tags, search)                       | `shared/pack-data`                                                       |
| app shell, providers, theme                                                          | `app/`                                                                   |
| site **and** Node (scripts, MCP, cli, server): data formats, parsers, pure rules     | `packages/core/src/` (`@tfc/core/<module>`), not `src/`                  |

## Modules and imports

- Every module folder has an `index.ts` with only its **public** part (not `export *`); import from outside through it:
  `@/entities/schematic`, not `@/entities/schematic/lib/schematicMesh`. All page slices, including `pages/doc`, expose a
  public `index.ts`. A component with its own styles lives in its own folder (`X/index.ts`, `X/X.tsx`,
  `X/X.module.css`); simple components without styles may stay flat files.
- Import alias `@/…` = `src/…` (`vite.config.ts` + `tsconfig.app.json`). Inside one folder use relative `./x`; across
  folders `@/…`. CSS imports stay relative (`./X.module.css`).
- **Code that both the site and Node (`scripts/`, MCP, `cli/`, `server/`) run lives in `packages/core`** (`@tfc/core`,
  npm workspace; rules — [packages/core/AGENTS.md](../packages/core/AGENTS.md)): `import { readNbt } from
'@tfc/core/nbt'` from both `src/` and `.mjs`. Node must not import `src/` — Node doesn't know `@/`, and the site is
  going to be its own package (dev task #138). Check with `grep -rn "src/" scripts cli server`.
- Harmful (avoid): `shared` importing upward, import cycles, the same code in several places. Everything else is a
  recommendation; exceptions are fine if they are noted in the code.

## Styles

Page/component styles use CSS Modules (migration — skill `css-modules`). Global CSS stays in `app/theme` for tokens, base
styles, generated Markdown, third-party markup and shared utilities. Keep our component classes local; use semantic
attributes or explicit public styles when several consumers share a pattern. Onboarding targets use tags/ARIA rather
than hashed classes.

## Pitfalls already hit

- The item library is **items**, not blocks, without tag members.
- Server world: `horizontal_scale = 100000`, `vertical_scale = 50000` (not mod defaults), ~200 m/block.
- Gemini free tier: limit is requests per minute — pack big jobs into one request.
