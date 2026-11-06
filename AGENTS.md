# TFC Studio — agent notes

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
- **Folder rules — read before editing there** (not every harness loads them itself): editing `src/` — read
  `src/AGENTS.md`; likewise `packages/core/AGENTS.md`, `scripts/AGENTS.md`, `scripts/mcp/AGENTS.md`, `cli/AGENTS.md`,
  `server/AGENTS.md`, `tools/AGENTS.md`.

## Packages (npm workspaces, dev task #138)

One repo, several packages, each with its own `package.json`. Details, `exports` and deliberate exceptions —
[docs/architecture.md](docs/architecture.md) «Packages».

| Package            | Folder               | What                                                      | Takes from             |
| ------------------ | -------------------- | --------------------------------------------------------- | ---------------------- |
| site (root)        | `src/`, root configs | the site (Vite, Firebase)                                 | core                   |
| `@tfc/core`        | `packages/core`      | formats and pure functions the site **and** Node run      | —                      |
| `@tfc/scripts`     | `scripts/`           | data builders, MCP `tfc-pack` and `tfc-plans-dev`, deploy | core, cli, pack-server |
| `@tfc/cli`         | `cli/`               | the `tfc` app                                             | core, pack-server      |
| `@tfc/pack-server` | `server/pack-server` | pack server (VPS, no npm dependencies)                    | —                      |
| `@tfc/file-server` | `server/file-server` | file server (VPS, no npm dependencies)                    | —                      |
| addons             | `tools/` (submodule) | repo tfc-addons, see below                                | —                      |

- Another package's code — only as `@tfc/<package>/<module>`, never `../other-folder/…`; a new external dependency goes
  into the `package.json` of the package that imports it. Check: `npm run boundaries`.
- `npm install` / `npm ci` — always in the repo root; never inside a package folder.

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
- **Addons are their own repo** — [tfc-addons](https://github.com/Jason1258t/tfc-addons), checked out as the `tools/`
  git submodule (all `tools/<mod>` paths stay the same). `tfc-plans-dev` `worktree_add` fills it; after a plain
  `git worktree add` run `git submodule update --init tools` (the site build does it too and stops if it can't).
  Editing an addon: branch inside `tools/` (`git -C tools switch -c feat/<short> origin/main`), commit there, push and
  get it into `main` of tfc-addons, then commit the new `tools` pointer here. `ship` refuses a pointer that is not on
  tfc-addons `origin/main` and uncommitted/unpushed work in `tools/`.
- **Lint and format are mandatory** before commit: `npm run lint` (zero errors) and format your changed files
  with `npx prettier --write <files>` (or `npm run format -- <files>`). The `ship` tool (tfc-plans-dev) refuses to merge if the
  branch changed files fail `oxlint` or `prettier --check`; CI (`.github/workflows/ci.yml`) repeats `oxlint`, `tsc` and a changed-file `prettier --check` on every push to `main`.
- **Work log — dev tracker on the pack server** (site page «Разработка» `/dev`, MCP `tfc-plans-dev` `dev_*`; not
  Firestore). Start every session with the skill **`dev-session`**: find or create the task, `dev_start`, at the end
  `dev_finish` with a short Russian report. Checklist items, reading and small edits, links between tasks — in that skill
  too. A task already `doing` under another agent — don't take it, ask the user. Found a separate problem along the way
  — a new dev task. Players' tasks and pack plans (update/integration plans) stay on the site (`tfc-pack` `task_*`).
- Deploy only from clean `main` after the merge, never from a feature branch (use the dev server to check).
- Commit message: `Раздел: что сделано`, one line; merge commit `Слияние feat/<short>: что сделано`. Co-author
  trailer — the one your harness uses.
- Firestore rules change with the code: deploy `firestore:rules` first, then hosting.
- Report to the user (not a frontend dev): what changed for players, what was checked and how, what wasn't. No internal
  function names unless needed for an action.
- Game facts (mod mechanics, KubeJS filters, map projection) — **verify in jars** (MCP first), not from memory. Say what
  was checked in code and what wasn't. The agent can't run the game, so don't append a routine «в игре не проверялось»
  note unless the in-game status is actually load-bearing for the answer.
- Cheap delegation: broad "where is X / how does Y work" searches → a read-only subagent if your harness has one; when
  one session is about to span several unrelated features, finish and start a new session instead of growing the
  context.
- **Repeatable work is a skill/MCP candidate.** Any action that may recur and needs a new skill or script prepared
  (a scratch script, a manual multi-step procedure, research you would redo) is a candidate for a skill or an MCP tool.
  Finish the task, then log the candidate as a dev task: what was done by hand and what the tool should do.

## Where code goes

Editing `src/` — read [src/AGENTS.md](src/AGENTS.md) first: layers `app → pages → widgets → features → entities →
shared`, what goes where, public `index.ts`, alias `@/…`, CSS Modules. When in doubt, put the file next to its main user.
Code that the site **and** Node (`scripts/`, MCP, `cli/`, `server/`) both run lives in `packages/core`
(`@tfc/core/<module>`); Node never imports `src/`.

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
npm run lint           # oxlint src scripts packages cli server; old set-state-in-effect / only-export-components warnings — don't fix in passing
npx prettier --write <files>   # singleQuote, printWidth 120; don't run on all of src
npm run deploy:site    # deploy the site; pack data on Hosting stays as the pack server published it (no jars; works from a worktree)
# npx firebase deploy --only hosting — blocked (would upload local pack data); pack data → pack server, see docs/pack-server.md
npx firebase deploy --only firestore:rules
npm run ui:classes -- --css <file>   # where CSS classes are used (own / shared / dead / library) — skill css-modules
npm run ui:boundaries                # FSD layer imports: shared must not import pages/entities, pages must not import app
npm run boundaries                   # package boundaries: no ../other-package imports, dependencies declared per package
npm run ui:shots -- capture before --only <page>   # desktop+mobile screenshots; then `capture after`, `diff before after`
npm run mods | serverconfig | kubejs | world | pack | guides | pack:fetch | pack:publish | freshness   # see docs/architecture.md
```

No tests. Verification — in the browser (below) and one-off node scripts in a temp folder outside the repo.

## MCP `tfc-pack`

**For game facts, recipes, tags, configs, mod code, logs, guides and site content use it first**, not grep over
`public/*.json` or unzipping jars. Which tool for what — [docs/mcp.md](docs/mcp.md) «Agent's usual path».

- Tools not connected, or the harness call timeout is shorter than the tool (`pack_devserver`) → the same tools from a
  shell: `node scripts/mcp-call.mjs <server> <tool> '<json>' [--timeout <s>]`, not a temporary JSON-RPC client —
  [docs/mcp.md](docs/mcp.md) «Calling from a shell».
- Pack config changes → `config_propose`. Other pack files (KubeJS, lang, resources) → check with
  `pack_devserver overlay=<dir>`, then `npm run tfc -- admin propose <overlay dir> --note …`; the host approves.
- Site tasks/plans/guides/datapacks → its write tools with `baseRevision`, not ad-hoc scripts; they cost Firestore reads
  — don't loop them.
- **If a needed tool is missing** or answers wrongly: finish by the workaround, then propose a separate session to add
  it — docs/mcp.md «Adding a tool».

## Datapacks

New editable fixes go to site cards via `datapack_put`; the rest, including deployment levels —
[docs/agents-datapacks.md](docs/agents-datapacks.md). An agent cannot verify in game: **do not declare a version tested
or run live `confirm` without the host's explicit confirmation.**

## Whole-pack test server

Run full-pack NeoForge checks on Ubuntu `test1a` via Tailscale to keep the Mac free for development.
See [test stand access and commands](docs/state/infra.md#remote-whole-pack-stand-dev-275) for the remote checkout,
snapshot and overlay transfer, and the smoke test. Full Minecraft client with the pack on a virtual display there:
`npm run client-stand -- prepare` once, then `npm run client-stand -- run` (title screen PNG, logs, summary) —
[client stand](docs/state/infra.md#remote-minecraft-client-stand--scripted-dev-284). AutoLab, Docker, and Ollama on that host are outside the stand.

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
- Firestore free tier: 50k reads/day. Heavy stuff (icons, maps, catalogues) — static only.
- Pack data (items, recipes, icons, KubeJS) on the site is published **only by the pack server** after `tfc publish`
  (`docs/plans/vps-publish.md`); a Mac deploy used to roll it back to a stale local `public/`. Builder changes reach the
  site via `tfc admin rebuild --pull` + `tfc admin publish --live`.
- Guides live only in Firestore: `npm run guides -- pull` before `push`, or use MCP `guide_get`/`guide_put`.
- By topic: site code — `src/AGENTS.md`; KubeJS recipe filters — skill `recipe-dev`; calc YAML — `docs/plans/guides.md`.
