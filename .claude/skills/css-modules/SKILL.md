---
name: css-modules
description: Migrate site styles from global CSS to CSS Modules one page/component per branch — inventory classes with scripts/ui/classes.mjs (local / shared / alien / dead / library), extract repeated UI (buttons, inputs, segmented controls, containers) into src/shared/ui, theme tokens into src/app/theme, convert the page to X.module.css, prove no visual change with desktop + mobile before/after screenshots (scripts/ui/shots.mjs). Use for «переведи на css modules», «мигрируй стили страницы X», «вынеси кнопку/инпут в shared», «почисти мёртвые стили».
---

# CSS Modules migration: inventory → baseline shots → shared/ui → module → check → after shots → ship

Goal: every component owns its styles in `X.module.css` next to `X.tsx`; repeated UI lives once in `src/shared/ui`;
app-wide tokens and base styles live in `src/app/theme`. **The site must look exactly the same** — this is a refactor,
not a redesign. Visual changes only when the user asked for them.

Workflow (task, worktree, commit, ship) — skill `dev-session` / `ship`. Everything the user sees (report, commit,
comments in code) — Russian.

## Target layout

```
src/app/theme/          global, loaded once from main.tsx
  index.css             `@layer theme, ui;` + `@import './x.css' layer(theme)` for each file below (done 2026-10-24)
  tokens.css            :root variables (colors, radii, shadows, fonts, --header-h), dark theme
  base.css              reset, html/body, form font inherit, links, focus ring, selection
  legacy-ui.css         shared fade-in animation; component classes have already moved to modules
  markdown.css          .md content (rendered by react-markdown — tag selectors, must stay global)
  utilities.css         generated item chips, layout/text helpers, .empty, .sr-only, .crash and .hide-sm
src/shared/ui/          reusable UI, no business logic, no Firestore, no page knowledge
  Button.tsx  Button.module.css          flat: one component = one .tsx + its .module.css
  Input.tsx  Field.module.css  Modal.tsx  Modal.module.css  Tag.tsx …  Stack.tsx …
  Segmented/            a folder only for a multi-file component:
    Segmented.tsx  SegmentedItem.tsx  Segmented.module.css  index.ts   ← exports only Segmented
  index.ts              re-exports ONLY the public API: import { Button, Input } from '../shared/ui'
src/pages/<x>/          FSD-style page slice (when the page is moved — see FSD plan below)
  <X>Page.tsx  <X>Page.module.css
  ui/Y.tsx  ui/Y.module.css               components used only by this page
  index.ts              one export: the page
```

- Component needed by **one** page → that page's `ui/` (not `src/components/`); needed by **2+** pages → `shared/ui`
  (pure UI) or an `entities/…` slice (knows a domain object: task, schematic, item).
- `index.ts` exports only what other folders may import; internals stay unexported, so agents can read the
  `index.ts` and skip the rest.
- Until a page is moved into `src/pages/<x>/`, its module stays next to the current file
  (`src/pages/X.module.css`, `src/components/Y.module.css`).
- The FSD move plan: site task `vtRZTcm2J6nVW7IP4nuv`, doc https://tfc-plans-fd2c.web.app/doc/LlO7AQQpDzD5zsDs5tfL.
  **Moving files and converting CSS are separate branches**: first `git mv` to the new place (+ imports, `tsc`),
  then the CSS module — otherwise before/after screenshots mix two changes.

Rules that keep it predictable:

- **Cascade layers.** `app/theme/index.css` declares `@layer theme, ui` and imports the theme with `layer(theme)`.
  Existing shared UI and page/component modules are **unlayered**: preserve that cascade during a mechanical
  migration. A passed `className` does not automatically win; match the existing specificity and prove the result
  with screenshots. Moving shared UI into a separate layer is a distinct change requiring its own visual baseline;
  do not combine it with class renaming or add `!important` to hide a regression.
- **Tokens only.** Colors, radii, shadows, fonts — `var(--…)` from `tokens.css`. A new hex/rgb literal in a module is
  a smell; add a token if it is reused.
- **Class names.** kebab-case in CSS, camelCase in code: `.task-row` → `styles.taskRow`
  (`vite.config.ts`: `css.modules.localsConvention = 'camelCaseOnly'`; `styles['task-row']` is `undefined`).
  Import as `import styles from './X.module.css'`; combine with `cx` from `@/shared/lib`.
- **State and variants** — prefer attributes over extra classes: `aria-pressed`, `aria-selected`, `aria-expanded`,
  `disabled`, `data-variant="primary"`, `data-kind={kind}` → selectors `.tab[aria-selected='true']`,
  `.badge[data-kind='add']`. Template classes like `` `k-${kind}` `` don't survive modules — replace with a
  `data-*` attribute or an explicit map `{ add: styles.kAdd, … }`.
- **Third-party DOM** (CodeMirror `.cm-*`, `cm-live-markdown` `.lmd*`, remark-gfm `.task-list-item`, `.sr-only`
  from mdast): keep the class name global, scoped under a local class: `.editor :global(.cm-content) { … }`.
- **No `:global` for our own classes** except during the transition (see «Legacy globals»).

## shared/ui — when and how to extract

Extract when a visual pattern appears in **2+ places** (same class combo like `btn primary sm`, same declaration set
in the `--dupes` report, same markup shape). Used once → keep it local in the page module.

- Candidates already known from the current CSS: `Button` (`.btn` + `primary|ghost|danger|ai`, `sm`, `icon`),
  `Input`/`Select`/`Textarea` (`.input`), `Label`, `Segmented` (`.seg`), `Tag`, `ImportanceDot/Pill`
  (`.imp-dot`, `.imp-pill`), `Progress`, `Modal` (move `components/Modal.tsx`), `Tooltip`, `ItemChip`,
  `EmptyState` (`.empty`), `ErrorBox`; layout: `Stack` / `Row` (the dupes report shows 9× «flex, center, gap 8,
  wrap» and 7× «column, gap 12»), `Panel`/`Card` (surface + border + radius), `Toolbar`.
- API: semantic props (`variant`, `size`, `icon`, `block`), pass-through of native props (`...rest` onto the
  element, `ref` forwarding for inputs), and `className` merged last for local tweaks. Keep prop names close to the
  old modifiers so replacement is mechanical: `className="btn primary sm"` → `<Button variant="primary" size="sm">`.
- **No outer margins** inside shared components — spacing belongs to the parent (`Stack gap`, page module).
- Flat file `shared/ui/Button.tsx` + `Button.module.css`; a folder with its own `index.ts` only for a component made
  of several files, and that `index.ts` exports only the public part. Add the public export to
  `src/shared/ui/index.ts`. Short JSDoc in Russian on props.
- Shared component styles must reproduce the old global look **pixel for pixel** — copy declarations from the old
  rule (`node scripts/ui/classes.mjs btn` shows every rule that styles it, including page overrides).

### Legacy globals during the transition

The global `.btn`, `.input`, `.seg`… in `app/theme` stay until **the last user** is migrated — 50 files use `.btn`.
A page branch replaces usages **only in the files it migrates**. When `node scripts/ui/classes.mjs btn` shows no
code usages left, a separate cleanup branch deletes the legacy rule. Never mass-replace across unrelated pages in a
page branch.

## Order of work (whole project)

1. ✅ **Foundation** (2026-10-24, `refactor/css-theme`): `src/index.css` split into `src/app/theme/*` in the same
   order, `layer(theme)`; all 50 shot pairs (desktop + mobile, light + dark) unchanged. Layering lowered globals
   below page CSS and nothing relied on the old order. New global rules go into the matching theme file, not into
   page CSS.
2. **shared/ui core** (one branch each or together): `Button`, `Input`, `Segmented`, `Modal` — components
   plus migrating 1–2 small users each to prove them.
3. **Pages/components, smallest first** (`wc -l src/**/*.css`), one per branch. Components whose styles live in a
   page CSS (e.g. `TaskRow` styled from `TasksPage.css`) get their own module in the same branch.
4. **Cleanup**: legacy globals with no users, `classes.mjs --unused`, empty utilities.

## Current migration status (2026-10-28)

- Migration is complete. Every page/component owns its CSS Module; there are no global CSS files outside
  `src/app/theme`. `ReferenceShared.css`, `PowerShared.css` and transitional global component aliases are gone.
- `shared/ui` includes Button/ButtonLink, Input/Select/Textarea, Label, Segmented, Tag/Importance, Modal/Tooltip,
  Search, Progress, Card/CardHead, Table/TableWrap, SectionShell, EmptyState and ErrorBox. Neutral `contentStyles`
  and `tableStyles` expose explicit local class maps where an extra DOM wrapper would be unnecessary.
- Recipe status is a domain badge in `shared/pack-data`; nutrition cell styling belongs to the reference page,
  not the generic shared table. Do not reintroduce domain CSS into `shared/ui`.
- Global theme utilities, generated Markdown and third-party classes are intentional. Stack/Row wrappers are not
  required: the approved plan retains layout utilities. `hide-sm` keeps its effective 600 px threshold; importance
  pills are hidden at 560 px in their own module. Test actual breakpoints, not just desktop/390 px screenshots.
- Onboarding uses tags/ARIA instead of hashed classes. Do not restore old `.botany-nav`, `.pack-nav`, `.btn` or
  `.guide-list-head` targets. Check the tour's target geometry after changing markup or labels.
- `shots.mjs` captures the actual viewport after scrolling without a fixed document-origin clip. Open baseline
  images before accepting a zero diff: an empty image proves nothing.
- Historical steps below remain the procedure for new refactors, not a request to redo completed dev tasks #7/#41/#75.

## One page — step by step

### 1. Task, worktree, dev server

- `dev-session`: dev task («CSS Modules: <страница>», kind `refactor`), worktree `refactor/css-<page>`.
- **`npm ci` in the worktree**. Don't symlink `node_modules` from the main checkout: Vite then serves
  fonts via `/@fs/<main checkout>/…`, gets 403, and the shots use a fallback font instead of Inter.
- Copy generated pack data with source `public/.` into the worktree's `public/`, not `cp -R public public`: the
  latter can create an unignored `public/public` tree that `git add -A` would include. Inspect `git status` before commit.
- For temporary React fixtures, use a root HTML entry so Vite injects the React Refresh preamble; raw HTML served
  from `public/` does not receive it. Remove fixture files before commit. Prefer local data/fixtures for large
  screenshot matrices to conserve Firestore reads; do not create shared test records.
- Dev server on 5176 (`npm run dev -- --port 5176 --strictPort`, Claude: `preview_start dev-alt`). **Stop it before
  `ship`** — otherwise Vite recreates `node_modules/.vite` and `git worktree remove` fails with «Directory not empty».

### 2. Inventory — never delete what is used

```bash
node scripts/ui/classes.mjs --css src/pages/X.css          # every class of the file, grouped
node scripts/ui/classes.mjs --component src/pages/X.tsx    # what the component takes and from which CSS
node scripts/ui/classes.mjs <class> [<class>…]             # all rules + all usages of a class
node scripts/ui/classes.mjs --dupes --dir src/pages        # repeated declaration sets → shared/ui candidates
```

`--css` groups:

| Group                 | Meaning                                                                                 | What to do                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| свой                  | used only by files that import this CSS                                                 | move into `X.module.css`                                                                                                                                |
| ОБЩИЙ                 | used by files that don't import it (`← files`)                                          | find the real owner: a child component → its own module; repeated UI → `shared/ui`; generic state class (`.active`, `.on`) → local class in each module |
| ЧУЖОЙ                 | main definition elsewhere (`.btn` in theme), here only an override like `.toolbar .btn` | replace with a prop/variant of the shared component or a local class passed via `className`                                                             |
| НЕ НАЙДЕН             | no usage anywhere                                                                       | delete — **only this group**                                                                                                                            |
| только слово в строке | the word appears in a string (`kind = 'image'` → `` `badge ${kind}` ``)                 | read the code; usually a dynamic class → `data-*`                                                                                                       |
| шаблонный класс       | matches a `` `prefix-${…}` `` template                                                  | same as above                                                                                                                                           |
| рисует библиотека     | class comes from node_modules (CodeMirror, remark-gfm…)                                 | keep global name, `:global(...)` under a local class                                                                                                    |

`[стилизуется ещё в …]` — other CSS files style the same class: after the move, check those pages in the shots too.

**`⚠ СЕЛЕКТОРЫ В КОДЕ`** at the end of `--css` — code finds elements by these classes: onboarding tour targets
(`target:` in `src/lib/onboarding.ts`), `querySelector`/`closest`. After the move the class is a hash and the
selector silently finds nothing (the tour step falls back to the middle of the screen, no error). **Before
converting**, rewrite each to tags/roles/aria/text: `target: 'main button', text: 'Загрузить'` (`text` picks the
element containing it), `main [role=search]`, `[aria-label="…"]`; add a `role`/`aria-label` to the element if there is
no hook. Then open the tour for the page (header «?» → «Подсказки раздела …») and check every step highlights the
right element. Global classes in that list (`.btn`, `.primary`) break later, when that UI moves to `shared/ui`.

### 3. Baseline screenshots — before any edit

```bash
node scripts/ui/shots.mjs list
node scripts/ui/shots.mjs capture before --only <page>   # desktop 1440×900 + mobile 390×844, full page
```

- Scenarios are in `scripts/ui/scenarios.json`: `path`, `waitFor`, `actions` (`click`, `clickText`+`within`,
  `type`, `wait` ms|selector, `eval`), `fullPage`, `mask` (selectors painted over — live counters), `theme`
  (`dark`). **Add scenarios for every state the page has**: tabs, opened dialogs, menus, empty/error states, dark
  theme for at least the main view — `name` as `<page>.<state>` so `--only <page>` picks them all. Commit new
  scenarios with the branch.
- **Selectors in scenarios never use our class names** (`waitFor`, `click`, `within`, `mask`): after the move to a
  module `.files-bar` becomes a hash and the `after` run can't find it. Use tags and a11y: `main`, `header`,
  `[role=dialog]`, `[role=tablist]`, `input[aria-label='…']`, `clickText` (a trailing counter like «Схемы 6» is
  ignored). No stable hook → add an `aria-label` in the page code in the `before` branch state, not during the move.
- Shots land in `$TMPDIR/tfc-shots/<branch>/before`; `--out DIR` to change. Uses installed Chrome (`CHROME_PATH`
  otherwise) with a persistent profile, nick `ClaudeTest`, onboarding off, animations frozen. No admin rights or
  Keychain access needed (`--use-mock-keychain`). Profile `~/.cache/tfc-plans/shots-profile`; if another run holds
  it, the next free `shots-profile-N` is used; `~/.cache` not writable → a temp profile; `TFC_SHOTS_PROFILE=<dir>`
  forces one. An interrupted run kills its Chrome. Several captures at once are fine.
- Data is live Firestore: take `before` right before editing and `after` soon after; a diff only in a data row
  (someone edited a task, a new task appeared) is noise — say so in the report. The script waits for network quiet
  (Firestore channels and reCAPTCHA excluded; `SHOTS_DEBUG=1` prints requests that never finish).
- **Unsure whether a diff is yours?** Rebuild the baseline with the same script: temporarily restore the old files
  (`git show HEAD:<path> > <path>`, revert the import), `capture before2 --only <page>`, put your version back,
  `capture after2`, `diff before2 after2`. Never use `git stash` (shared between worktrees).

### 4. Convert

1. Create shared components the page needs (rules above) or extend existing ones.
2. `git mv src/pages/X.css src/pages/X.module.css`, `import styles from './X.module.css'`.
3. In the module: delete «НЕ НАЙДЕН» rules; rewrite «ЧУЖОЙ» overrides as local classes; descendant selectors
   that target child components (`.page .task-row`) → move into the child's module or pass `className`.
4. In TSX: `className="task-row selected"` → `className={cx(styles.taskRow, selected && styles.selected)}`;
   shared UI → components. Keep the DOM structure and element types unless needed (selectors, a11y and tests by text
   rely on them).
5. `@media` blocks move with their rules; keep the same breakpoints (no breakpoint tokens yet — custom media
   doesn't work in plain CSS).

### 5. Check

```bash
node scripts/ui/classes.mjs --check           # styles.x missing in the module = typo → exit 1; lists unused module
                                              # classes (classes inside :global(...) are not counted as the module's)
node scripts/ui/classes.mjs --css src/pages/X.module.css
npx tsc -b && npm run lint && npx prettier --write <changed files>
node scripts/ui/shots.mjs capture after --only <page>
node scripts/ui/shots.mjs diff before after   # ✓ ≤ 0.1% changed pixels and same size; ✗ writes diff PNGs
```

- **Open every ✗ diff PNG** (red = changed) and the matching before/after shots. Fix until ✓, except deliberate
  changes approved by the user. Height change («размер A → B») is always a real layout change.
- Also run the shots of pages listed in `[стилизуется ещё в …]` and of other users of any shared component you
  touched (`classes.mjs --component` / grep the component name).
- Browser console on the page — no new errors.
- Onboarding tour of the page still highlights the right elements (see «СЕЛЕКТОРЫ В КОДЕ» above).

### 6. Finish

- Remove the old global CSS import; nothing may import a deleted file (`tsc`/dev server will fail).
- Update `docs/state/site.md` (one line: which pages are on modules, which shared components exist).
- Stop the dev server, then `ship`. Task note in Russian: what was migrated, which shared components appeared, screenshot diff result
  (desktop/mobile, which states), what wasn't checked.

## Pitfalls

- `.active`, `.on`, `.selected`, `.done`, `.primary` are used in 10+ files with different meanings — never treat
  them as one class; each module gets its own.
- `Modal` renders through a portal into `body` — its children are not inside the page root; page descendant
  selectors don't reach them.
- A global rule from another file can still hit your elements while it exists (`.btn` overrides in
  `SchematicsPage.css`) — shots catch it; don't delete someone else's rule in a page branch.
- `classes.mjs` reads TS AST: classes built far from `className` (helper returning a string, object maps) show as
  «слово в строке». It never claims «НЕ НАЙДЕН» for a word that appears in any string — when in doubt, it errs to keep.
- Mobile shots use device scale 2 (780 px wide PNG) and a touch user agent — `(hover: none)` rules apply there.
