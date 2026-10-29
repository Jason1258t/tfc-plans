# TFC Планы — agent notes

Source of truth for every coding agent (Claude Code, Codex, Gemini CLI, Cursor, OpenCode, …). Tool-specific additions
live next to it: Claude Code — [CLAUDE.md](CLAUDE.md); setup for other agents — [docs/agents.md](docs/agents.md).

Planner site for a group playing the TerraFirmaCraft RealWorld pack (Minecraft 1.21.1, NeoForge): tasks, docs, Create
schematics, datapacks, recipes, reference, world map, pack updates.

- Site https://tfc-plans-fd2c.web.app · repo https://github.com/Jason1258t/tfc-plans · Firebase `tfc-plans-fd2c`
  (Firestore eur3, anonymous auth, App Check reCAPTCHA Enterprise, AI Logic/Gemini).
- **State:** [docs/STATE.md](docs/STATE.md) is a short index — read it; open `docs/state/<topic>.md` only for the topic
  at hand. Update the topic file when done.
- More, on demand: code map and data pipeline — [docs/architecture.md](docs/architecture.md); MCP tools —
  [docs/mcp.md](docs/mcp.md); addons — [docs/addons.md](docs/addons.md) (+ `tools/AGENTS.md`); pack server —
  [docs/pack-server.md](docs/pack-server.md); `tfc` app — [docs/tfc-app.md](docs/tfc-app.md); feature plans —
  `docs/plans/`; human docs — README.md.
- Folders with their own short rules: `scripts/AGENTS.md`, `scripts/mcp/AGENTS.md`, `server/AGENTS.md`,
  `tools/AGENTS.md` — read the one for the folder you edit.

## Language

Agent docs are in English. **Everything the user or players see is Russian:** replies to the user, UI text, code
comments, commit messages, guides, MCP tool output. Keep Russian UI labels verbatim when quoting them.

## Workflow

- Done = **verified, merged into `main`, deployed, pushed** — no separate question needed. Use the **`ship` skill**
  for merge → deploy → push → cleanup.
- **Every session works in its own git worktree** — several agents (of any kind) run in parallel and clobber each
  other otherwise. Before the first edit: `git worktree add .claude/worktrees/<short> -b feat/<short> main`, then work
  only inside it. Branches: `feat/`, `refactor/`, `fix/` + latin kebab-case. The main folder
  `/Users/ivan/vscodeProjects/tfc-taskmanager` stays on `main`: never edit or switch branches there. Without a worktree
  — read and answer only. Before editing shared agent files (`AGENTS.md`, skills, `docs/mcp.md`) check
  `git worktree list` / `git log main..<branch>` of other worktrees for the same files.
- **Lint and format are mandatory** before commit: `npm run lint` (zero errors) and format your changed files
  with `npx prettier --write <files>` (or `npm run format -- <files>`). The `ship` tool (tfc-plans-dev) refuses to merge if the
  branch changed files fail `oxlint` or `prettier --check`; CI (`.github/workflows/ci.yml`) repeats `oxlint`, `tsc` and a changed-file `prettier --check` on every push to `main`.
- **Work log — dev tracker on the pack server** (site page «Разработка» `/dev`, MCP `tfc-plans-dev` `dev_*`; not
  Firestore — zero reads, [docs/plans/dev-tracker.md](docs/plans/dev-tracker.md)): at the start find the task
  (`dev_list query=…`) or create one (`dev_create`, kind `fix` for fixes), set `doing` + assignee = **your own agent
  name** (= `TFC_AGENT_NICK`; never `Claude` unless you are Claude — `Codex`, `Gemini`, `Cursor`, `DeepSeek`…; see
  [docs/agents.md](docs/agents.md)) + `branch`; progress — `dev_note`; at the end — `dev_update status=done
report=…`: a short Russian report — what changed for players, what was checked, what wasn't. Plan docs —
  `dev_doc_put`. A task already `doing` under another agent — don't take it, ask the user. Found a separate problem
  along the way — a new dev task. Players' tasks and pack plans (update/integration plans) stay on the site
  (`tfc-pack` `task_*`).
- Deploy only from clean `main` after the merge, never from a feature branch (use the dev server to check).
- Commit message: `Раздел: что сделано`, one line; merge commit `Слияние feat/<short>: что сделано`. Co-author
  trailer — the one your harness uses.
- Firestore rules change with the code: deploy `firestore:rules` first, then hosting.
- Report to the user (not a frontend dev): what changed for players, what was checked and how, what wasn't. No internal
  function names unless needed for an action.
- Game facts (mod mechanics, KubeJS filters, map projection) — **verify in jars** (MCP first), not from memory. Say what
  was checked in code and what wasn't. The agent can't check anything in game: mark recipes, scripts, coordinates
  «в игре не проверялось».
- Cheap delegation: broad "where is X / how does Y work" searches → a read-only subagent if your harness has one; when
  one session is about to span several unrelated features, finish and start a new session instead of growing the
  context.

## Where code goes (`src/`)

Light FSD is established (dev task #75): layers `app → pages → widgets → features → entities → shared`.
A layer imports only from itself and those to its right (`features`/`widgets` use the simplified rules below).
Not every layer is mandatory; **when in doubt put the file next to its main user**, not where the scheme says it
"should" be. `src/components`, `src/lib` and `src/data` retain shared UI, adapters and intentional Node entry points;
their existence is not a request for another mass move. Put new code by the rules below and migrate existing code
only when its owner actually changes. All page slices, including `pages/doc`, expose a public `index.ts`.

Page/component styles use CSS Modules. Global CSS stays in `app/theme` for tokens, base styles, generated Markdown,
third-party markup and shared utilities. Keep our component classes local; use semantic attributes or explicit
public styles when several consumers share a pattern. Onboarding targets use tags/ARIA rather than hashed classes.

| Code is needed by                                                                          | Goes to                                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| one page                                                                                   | `pages/<x>/` (`ui/` components, `model/` logic), page file `<X>Page.tsx` |
| two or more pages, has domain knowledge (tasks, schematics, guides, items…)                | `entities/<name>/` (UI optional)                                         |
| two or more pages: user action/flow (редактор гайда, сравнение задач, загрузка датапака)   | `features/<name>/`                                                       |
| two or more pages: composite UI block (шапка, панель агента, каталог рецептов, знакомство) | `widgets/<name>/`                                                        |
| any page, no domain knowledge (Modal, Button, util, firebase wrapper)                      | `shared/ui`, `shared/lib`, `shared/api`                                  |
| any page, общий справочник пакета (предметы, рецепты, теги, поиск)                         | `shared/pack-data`                                                       |
| app shell, providers, theme                                                                | `app/`                                                                   |

- Слои (справа налево): `app → pages → widgets → features → entities → shared`. Слой берёт только себя и то, что
  справа: `features` — `features/entities/shared`, `widgets` — `widgets/features/entities/shared`, страницы —
  `pages/widgets/features/entities/shared`, `app` — что угодно. `features` и `widgets` — по упрощённым правилам и
  только когда код действительно нужен нескольким страницам: одну страницу оставляем в `pages/<x>/`. Если сомневаешься,
  кладём рядом с главным потребителем, а не «по схеме». Проверка — `npm run ui:boundaries`.
- Every module folder has an `index.ts` with only its **public** part (not `export *`); import from outside through it:
  `@/entities/schematic`, not `@/entities/schematic/lib/schematicMesh`. One component = one flat file
  (`Button.tsx` + `Button.module.css`), a folder only for multi-file ones — no `Button/Button.tsx`.
- Import alias `@/…` = `src/…` (`vite.config.ts` + `tsconfig.app.json`). Inside one folder use relative `./x`; across
  folders `@/…`. CSS imports stay relative (`./X.module.css`).
- **Files that Node scripts import directly** (`scripts/`, `cli/`, `server/`: `lib/addonVersions`, `datapackFiles`,
  `freshness`, `projection`, `shared/pack-data/recipeRefs`, `shared/pack-data/recipeFilter`, `nbt`, `schematicFile`,
  `files.config`, `shared/lib/hash`) must keep **relative** imports — Node doesn't know `@/`. Check with `grep -rn "src/" scripts cli server` before moving
  them.
- Harmful (avoid): `shared` importing upward, import cycles, the same code in several places. Everything else is a
  recommendation; exceptions are fine if they are noted in the code.

## Skills

Step-by-step procedures in `.claude/skills/<name>/SKILL.md` (standard `SKILL.md` format; `.agents/skills` is a symlink
to the same folder for Codex and other agents that look there): `ship`, `addon-dev`, `addon-release`,
`integration-plan`, `update-plan`, `recipe-dev`, `dev-session`, `deploy`, `css-modules`. If your harness doesn't load skills, open the `SKILL.md` and follow it. Edit skills
only in `.claude/skills/`.

## Commands

```bash
npm run dev            # Vite; mod data from the pack server first (scripts/ensure-mods.mjs, no jars needed)
npm run dev -- --port 5176 --strictPort   # preview port for agents (5177 if busy); offline — TFC_KEEP_MODS=1
npm run pack:fetch     # pack jars → ~/.cache/tfc-plans/pack (outside the repo) for MCP, npm run mods, addons
npx tsc -b             # types (part of build)
npx oxlint src scripts # lint; old set-state-in-effect / only-export-components warnings — don't fix in passing
npx prettier --write <files>   # singleQuote, printWidth 120; don't run on all of src
npm run deploy:site    # deploy the site; pack data on Hosting stays as the pack server published it (no jars; works from a worktree)
# npx firebase deploy --only hosting — blocked (would upload local pack data); pack data → pack server, see docs/pack-server.md
npx firebase deploy --only firestore:rules
npm run ui:classes -- --css <file>   # where CSS classes are used (own / shared / dead / library) — skill css-modules
npm run ui:boundaries                # FSD layer imports: shared must not import pages/entities, pages must not import app
npm run ui:shots -- capture before --only <page>   # desktop+mobile screenshots; then `capture after`, `diff before after`
npm run mods | serverconfig | kubejs | world | pack | guides | pack:fetch | pack:publish | freshness   # see docs/architecture.md
```

No tests. Verification — in the browser (below) and one-off node scripts in a temp folder outside the repo.

## MCP `tfc-pack`

Local stdio server (`scripts/mcp/server.mjs`; registered in `.mcp.json`, other agents — [docs/agents.md](docs/agents.md);
in a worktree it reads `public/` of the main checkout; pack jars — from the snapshot cache `~/.cache/tfc-plans/pack/mods`,
filled by `npm run pack:fetch`; there is no `mods/` in the repo).
**For game facts, recipes, tags, configs, mod code, logs, guides and site content use it first**, not grep over
`public/*.json` (recipes.json is 7.7 MB) or unzipping jars. Mod code: `decompile method=` to read, `bytecode` instead of
`javap` in a shell — method outline, any jar or classes folder on disk (addon `libs/`, `build/classes`, `.mixin.out`),
`diff` of two mod versions. Crash / "what broke" → start with `log_analyze`. A mod
not in the pack (integration analysis) → `candidate_get`, then jar tools with `jar=candidate:<file>`. Editing addon
resources → `resources_check` + `model_render`; developing an addon (new addon, block, mixin) → skill `addon-dev`;
releasing an addon to the site → skill `addon-release`
(`addon_check`). Pack config changes → `config_propose`, not "edit the file". Other pack file changes
(KubeJS scripts, lang, resources, whole files) → `npm run tfc -- admin propose <overlay dir> --note …` (agent key in
the `tfc` app settings — `%APPDATA%\tfc\config.json` on Windows, `~/.config/tfc/config.json` on macOS/Linux, see
`cli/lib/config.mjs`; base on the current snapshot, `tfc admin updates` to see status); the host pulls and approves. Site
tasks/plans/guides → its write tools (signed with `TFC_AGENT_NICK`, default `Claude`, with `baseRevision`), not ad-hoc
scripts. Site-content tools cost Firestore reads — don't loop them. Tool reference — [docs/mcp.md](docs/mcp.md).

If a needed tool is missing or answers wrongly and you had to fall back to grep/unzip/a script — finish the current
task by the workaround, then propose a separate session (own worktree, branch `feat/mcp-<short>`) to add the tool per
"Adding a tool" in docs/mcp.md; in the brief say what you looked for, the workaround, and the desired answer. Bigger
things — [docs/plans/mcp-next.md](docs/plans/mcp-next.md).

## Datapack deployment levels

- Shared fixes can be confirmed for the whole pack as ZIP files in `kubejs/data/` (installed KubeJS loads them).
  Source of truth: the current pack-server snapshot's `datapacks` records, including content/archive hashes and source
  revision. Site `install` is a world-test opt-in, not confirmation or permission to replace the pinned pack version.
- Inspect `tfc datapacks list` / `files`; `install all|<id/name/filename>` puts unconfirmed packs into the selected
  world. Host `confirm all|<id/name/filename>` promotes matching world ZIPs after verification in game;
  `unconfirm` returns a pinned version to world scope for retesting. Use `--dry-run` to inspect first.
- An agent cannot verify in game. Do not declare a version tested or run live `confirm` on the host's behalf without
  their explicit confirmation that those versions were checked. Ship the tooling normally; record the game check
  separately. Changed/unknown world copies must be preserved, with backups for managed removals.
- Local `undo` does not revert the server's confirmation; server `admin rollback` reverts the entire snapshot.
  Published site/MCP deployment labels follow the snapshot's `kubejs.json`, so can lag a queued rebuild/publish.
  Details and migration — [docs/plans/datapacks-pack.md](docs/plans/datapacks-pack.md).

## Browser checks

- Dev server on port 5176 (5177 if busy), see Commands; it needs no jars.
- The dev server talks to **production Firestore**. Don't leave test records in shared collections. Preview nick is
  `ClaudeTest` (cookie `tfc_nick`) for every agent; deliberate writes on the user's request are signed with your agent
  name.
- Site modules are importable from the page: `await import('/src/shared/pack-data/recipes.ts')`. Prefer element refs or page JS
  over clicking screenshot coordinates. Local file into the page: put it in `public/__test.*`, `fetch` +
  `DataTransfer` into `input[type=file]`, then delete.
- A hidden browser pane freezes the page — long operations look like hangs.

## Pitfalls already hit

- Same Russian names for items of different mods («Медный люк» in TFC and vanilla) — show mod/id.
- The item library is **items**, not blocks, without tag members. KubeJS filter `output: 'x'` matches only an explicit
  `x` in the recipe.
- KubeJS removes recipes from datapacks (including ours) but not script-added ones (checked in bytecode).
  `replaceInput({mod: 'electroenergetics'})` applies to recipes with ids in that namespace.
- Server world: `horizontal_scale = 100000`, `vertical_scale = 50000` (not mod defaults), ~200 m/block.
- Gemini free tier: limit is requests per minute — pack big jobs into one request.
- Firestore free tier: 50k reads/day. Heavy stuff (icons, maps, catalogues) — static only.
- Pack data (items, recipes, icons, KubeJS) on the site is published **only by the pack server** after `tfc publish`
  (`docs/plans/vps-publish.md`); a Mac deploy used to roll it back to a stale local `public/`. Builder changes reach the
  site via `tfc admin rebuild --pull` + `tfc admin publish --live`.
- Guides live only in Firestore: `npm run guides -- pull` before `push`, or use MCP `guide_get`/`guide_put`. In calc
  YAML the short `{ … }` form splits values on commas — quote formulas with commas.
