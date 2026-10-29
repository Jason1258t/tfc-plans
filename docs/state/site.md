# State: site sections

Part of [STATE.md](../STATE.md). Everything here is deployed. UI labels are quoted in Russian as they appear in the code.

## Concrete washing templates (2026-10-27)

- The recipe catalogue includes Create's 16 runtime-generated vanilla concrete washing recipes. The builder reads
  the powder → hardened block relations from the current Minecraft client bytecode using official class mappings,
  checks Create's runtime generator, and preserves its recipe ids. No colour list is hardcoded. They are searchable
  by concrete name/id and `create:splashing`, usable as datapack templates, and labelled «создаётся при запуске».
- Only vanilla concrete washing is reconstructed so far; other runtime recipes (including Create wood cutting and
  modded concrete powder registrations) are not reconstructed. Ordinary JSON recipes retain priority over the
  generated layer; the existing KubeJS merge/filter logic applies to it.
- The file editor validates paths before saving: recipes require `.json` and the 1.21.1 `recipe/` directory.
  Existing invalid paths also get a specific warning in the pack's file list.
- Verified against Minecraft 1.21.1 and Create 6.0.10 jars, the real catalogue search (all 16 active templates),
  lint and TypeScript. Browser access was denied by the permission gate; not checked in game.

## Dev section improvements (2026-10-28, #114)

- Game reports (`tfc report`): «Краш-репорты» and «Логи» moved from Documents into `/dev`; old report links redirect.
  Stored files and report ids are unchanged. CLI/MCP generate `/dev?report=…` links.
- Task list keeps an in-memory cache across navigation and refreshes every 10 seconds while visible. Open tasks
  refresh without replacing unsaved edits. Sending operations show progress; errors retain the draft.
- Description uses the shared live Markdown editor with bounded height. New descriptions have a 2400-character
  limit on client and server; detailed plans go into attached documents. Existing long tasks and imports still work.
- Checklist and journal collapse; only the last five completed checklist entries are shown initially, with a toggle
  for the rest. Journal has its own scroll area, keeping the form manageable.

## Dev task indicators (2026-10-28, #131)

- Every priority has a coloured dot: low blue, normal green, high yellow, urgent red; its Russian label is available
  through a tooltip and accessibility text. The task editor shows the same indicator beside «Важность».
- Checklist progress in task rows and the editor uses a circular indicator, percentage and completed/total count.
  Empty checklists have no indicator. Verified with TypeScript, lint, layer boundaries and desktop/mobile browser
  captures; isolated fixtures cover 0%, partial and complete progress in light/dark themes. No game changes.

## Structure (reworked 2026-10-13)

- Header: Задачи · Документы (file storage) · Схемы · Датапаки · Справочник; on the right — pack-update bell.
- Markdown plans (formerly «Документы») are the «Планы» section of the tasks page (`/?view=docs`, left, above groups).
- Datapacks, recipes and tags are one section with a tab chooser on the left (`/datapacks`, `/recipes`, `/tags` unchanged).
- Map is a reference tab (`/reference?tab=map`). Full-page doc — `/doc/{id}` (old `/docs/{id}` and `/map?x=…` redirect).

## Styles (CSS Modules migration completed 2026-10-28)

**Migration status (28 October 2026).** The FSD and CSS Modules migration is complete: every page, including
`pages/doc`, has a public slice API; component styles are local. `ReferenceShared.css` and `PowerShared.css` are
removed. Header/sync, file and recipe-status badges, tables, nutrition cells, section menus and guide headers no
longer publish transitional component classes. Theme utilities, generated Markdown and third-party markup remain
global intentionally. `contentStyles` and `tableStyles` share neutral local patterns without extra DOM wrappers.

The five entity lists subscribe on demand through `shared/api/liveList.ts`, share one source between consumers,
and unsubscribe after the last consumer; StrictMode handoffs preserve the connection. The app hook only updates
presence. The schematic engine is already in `entities/schematic`, with the heavy renderer separately imported
from `entities/schematic/render`. `nbt.ts`, `schematicFile.ts` and `files.config.ts` deliberately retain their
Node-compatible locations/imports.

Closeout checks: TypeScript, lint (no errors), CSS module keys, FSD boundaries, changed-file formatting and production
build. Before/after matrices covered desktop/mobile and light/dark: electricity/guides/addons (26 pairs), header
and sync states (34), file badges (16), tables/nutrition (22), menus/tour targets (24), recipe statuses (8), statistics
(12), responsive thresholds (14) and the document route (2). Deterministic layouts matched; the table suite had seven
changed icon pixels in one frame and file-badge fixtures at most 0.001%. Entity-list page snapshots additionally
reflected live task updates; differences were inspected instead of treated as style changes. Lifecycle checks covered
first/last consumers, StrictMode, stale callbacks, errors and route handoffs. Large matrices used local fixtures/Firebase-off
rather than shared test records. Safari/Firefox, full-height long-page captures and real offline/auth-UID changes were not
exhaustively checked.

- Plan and rules — skill `css-modules`: tokens/base in `src/app/theme`, repeated UI in `src/shared/ui`, page styles in
  `X.module.css` (`localsConvention: 'camelCaseOnly'` in `vite.config.ts`). Tools: `scripts/ui/classes.mjs` (class
  usages, dead/library classes, duplicates, module key check), `scripts/ui/shots.mjs` + `scenarios.json` (desktop and
  mobile screenshots, before/after diff via installed Chrome).
- Done: foundation — `src/index.css` split into `src/app/theme/` (tokens, base, legacy-ui, markdown, utilities) under
  `@layer theme`; screenshots of all pages (desktop/mobile, light/dark) unchanged. Then the pilot page «Документы»
  (`src/pages/files/FilesPage.module.css`, 2026-10-24, задача PfzufKyhwWCUYYhBs9K5) — first page on a module: own
  classes local, the three others' overrides (`.search`, `.seg`, `.fbadge`) through `:global` until shared/ui exists.
  Onboarding tour targets for that page moved to tags and roles (`main button` + text, `main [role=search]`), not
  classes.
- 2026-10-25 — page branches (each with before/after screenshots 0.000%): «Задачи» (whole page and its components,
  23 files; tour targets moved to `data-tour`/roles, so «Что важнее?» is highlighted on mobile too), «Схемы» (page,
  library, favourites, layers split into section modules; own `.search` — the global one flashed on load), «Справочник»
  (page, 8 tabs, shared parts in `ReferenceShared.css`/`PowerShared.css`; own search classes now, no dependency on the
  tasks page). Global through `:global` only where other pages use the class (`.toggle`, `.hide-sm`, `.imp-pill`);
  states (`active`, `selected`, …) local.
- 2026-10-25: `shared/ui` started — `Search` (replaces the global `.search`; used by the header id search, the recipe
  catalogue and «Документы») and `Modal.module.css` (the window's background, card, head, body and foot left
  `legacy-ui.css`; the onboarding looks for `[role="dialog"]`). `shared/ui` comes before page modules in the cascade
  (`@layer ui`), so a page can still override.
- 2026-10-25 (вторая волна): компоненты без страницы — шапка, значок файла, панель плана и панель агента (ветка
  `css-components-a`), гайды, markdown-поле, LiveMarkdown и знакомство (`css-components-b`), выбор предмета, меню
  разделов и мультиблоки (`css-components-c`), поиск по id предмета (`css-item-id-search`). Динамические варианты
  (`guide-badge-*`, `nut-*`) переведены на `data-*`.
- 2026-10-25 (третья волна): конструктор KubeJS и каталог рецептов (`css-kubejs-catalog`); `shared/ui` пополнился
  `Button`, `Input`, `Select`, `Textarea`, `Tooltip` (модули), первые потребители — модалка, «Статистика»,
  «Свежесть», редактор тегов.
- 2026-10-25 (четвёртая волна): `Segmented` в `shared/ui` (значения строка/число/булево/null, значки, счётчики,
  режим вкладок) заменил глобальный `.seg` в 15 местах — задачи, файлы, статистика, рецепты, теги, карта, вкладки
  справочника, мультиблоки, каталог рецептов, панель плана, «Свежесть»; переопределения потребителей переехали с
  `:global(.seg)` на свои классы. Тогда же: шапка/знакомство/панели/каталог/меню разделов — в `widgets/`, гайды и
  вкладки справочника — в `features/`; `TaskDialog`, `SchematicsPage`, `SchematicLayers`, `DatapacksPage` разбиты на
  части (самый большой файл — 394 строки вместо 1206).
- 2026-10-26 (ночь, кнопки и поля): все кнопки переведены на `Button` (`shared/ui`) — страницы задач, схем, датапаков, карты, тегов, обновлений, документов, гайды, вкладки справочника, шапка, панель плана, знакомство, общие компоненты; `.btn` остался только на ссылках (`<a>`/`<Link>`), которым нужен режим ссылки у компонента. Где было сочетание `btn ghost danger`, добавлены локальные `.dangerGhost` в модулях страниц. Появилась `ErrorBox` (бывший `.error-box`). Дальше — `.input/.label` → `Input/Select/Textarea` и `.tag`/важность.
- 2026-10-25 (ночь): кнопки и поля ввода переехали на компоненты `shared/ui` — `Button` заменил глобальный `.btn`
  примерно на 150 местах во всех страницах и виджетах (по ветке на страницу, снимки 0,000%), `Input`/`Select`/
  `Textarea` — `.input` (сначала «Задачи», дальше справочник и остальное). Плашка ошибки — `ErrorBox` (16 мест), `.error-box`
  убран из темы. Компонент без каскадного слоя попадает в отдельный CSS-чанк, поэтому переопределения
  `.foo :global(.btn)`/`:global(.input)` переводились на локальные классы или элементные селекторы. Заготовки для следующего шага влиты: `Tag`, `ImpDot`/`ImpPill`, `Label` и `ButtonLink` — ссылка, которая выглядит
  кнопкой (`to`/`href`, `download`/`target`, варианты и размеры как у `Button`); на нём уже кнопка «Обновления» в шапке
  и «На карте» в поле места. Глобальные `.btn`/`.input` пока в теме — их добирают по страницам.
- 2026-10-26 (ночь, поля ввода): `.input` в справочнике и гайдах → `Input`/`Select`/`Textarea` (`refactor/input-reference`):
  вкладки справочника (руды, еда и её подразделы, ботаника, электричество, набор нагрузки IE) и гайды (редактор,
  справка, калькуляторы статей). Переопределения потребителей переехали с `:global(.input)`/`select.input` на
  селекторы с тегом (`.filters > select`, `.row > input`, `.guideFieldWide > input`) и `.guideFields .guideOrder`:
  `Field.module.css` лежит без каскадного слоя, поэтому на равной специфичности решал бы порядок чанков. `.input`
  пока остался у `ItemPicker` (`shared/pack-data`) и на страницах, которые ещё не переведены.
- 2026-10-26: `.label` → `Label` в трёх компонентах страницы задач (группа, место, сравнение); снимки до/после — без
  визуальных отличий на desktop/mobile. Осталось 15 разметок.
- 2026-10-26: `.label` → `Label` в редакторах датапаков и KubeJS-скриптов. Снимки страницы до/после — 0,000%; сценарий
  редактора не прошёл, потому что в общей Firestore нет датапака, а создавать тестовую запись нельзя. Осталось 6
  разметок.
- 2026-10-26: `.label` → `Label` в настройках профиля и масштаба карты. Снимки до/после — 0,000% после повторного
  baseline на одинаковых данных; исходный diff поймал обновление настроек мира из Firestore. Осталось 3 разметки.
- 2026-10-26: `.label` → `Label` в редакторе нового тега; desktop/mobile — 0,000%. Остались 2 общих компонента.
- 2026-10-26: `.label` → `Label` в NickDialog и KubejsConstructor; три состояния (новый тег, смена ника, KubeJS) desktop/mobile — 0,000%. В разметке `.label` больше нет, правило удалено; снимки всех затронутых состояний desktop/mobile — 0,000%, `:global(.label)` не найден.
- 2026-10-26: бейджи ленты обновлений переведены на `Tag`, включая ссылку на аддон; `updates` desktop/mobile — 0,000%. Остаются три глобальных употребления: Freshness, каталог рецептов, список схем.
- 2026-10-26: бейдж типа версии на странице «Свежесть» переведён на `Tag`, глобальное переопределение снято; `freshness` desktop/mobile — 0,000%. Осталось 2 прямых употребления `.tag`.
- 2026-10-26: метка типа рецепта в каталоге переведена на `Tag`, responsive-правило стало локальным; desktop/mobile — 0,000%. Остался один `.tag` в списке блоков схем.
- 2026-10-26: бейдж мода в списке замен схем переведён на `Tag`; открытая схема с заменами — desktop/mobile 0,000%. Разметка `.tag` нулевая, глобальное правило удалено; статус `в работе` переведён на локальный селектор, `:global(.tag)` не осталось. Одноимённые `.tag` в MealsTab остаются локальными CSS Modules.
- 2026-10-28 (#112): dev tasks now share attachments and screenshot galleries with player tasks via
  `features/task-files` (picker, drop, clipboard paste, compression, progress/errors, download/delete, 25 MiB limit).
  Dev file ownership uses `taskId = dev:<id>` in the existing site file store (currently Firestore; tracker data stays
  in SQLite). New-task files upload after creation; deleting a task removes its files first, with file-list/upload
  readiness checks. Added live Markdown with preview and inline task toggles, bug/addon description templates,
  editable checklist text and progress count, close protection for pending files and unsent notes.
  Checked: TypeScript, lint, FSD boundaries, desktop/mobile browser; real file upload/read/reload/delete on #112
  (test file removed), draft attachment and screenshot paste, size rejection, create failure preserves draft.
- 2026-10-26: CSS-аудит страницы «Разработка» исправлен: удалён несуществующий `styles.when`, динамические классы статуса и записей журнала перечислены явно. `ui:classes --check` теперь проходит. Снимки dev/окна задачи/журнала — без визуальных изменений; небольшая разница только в обновившейся подписи «N мин. назад».
- 2026-10-26: flex-spacer в подвале окна задачи разработки перенесён с глобального `.grow` в локальный `DevTaskDialog.module.css`; общее правило остаётся для остальных потребителей.
- 2026-10-26: общий индикатор `.progress` переехал в `shared/ui/Progress`; его используют строка задачи и загрузка вложений. Глобальное правило удалено из темы.
- 2026-10-26: значок предмета получил `ItemIcon.module.css`; стили React-компонента и Markdown-чипов локальны, глобальные `.item-icon/.smooth/.missing` удалены.
- 2026-10-27: `shared/ui` пополнился `Card`/`CardHead` и `Table`/`TableWrap` (бывшие `.ref-card`/`.ref-card-head` и `.ref-table-wrap`/`.ref-table` из `ReferenceShared.css`); мигрированы все вкладки справочника, мультиблоки, IE-нагрузки, аддоны и гайды; снимки `reference.*` и `addons` desktop/mobile — 0,000%. `.ref-card` оставлен глобальным алиасом в `Card.module.css` до переезда `AddonVersions.tsx` (#98).
- 2026-10-27: `PowerShared.css` разобран: правила одного владельца переехали в `PowerTab.module.css`, новый `AddonsTab.module.css`, `Guides.module.css` и новый `powerWidgets.module.css`; общие `.power-*` остались глобальными. Снимки `reference.power*`, `reference.guides.*` и `addons` desktop/mobile — 0,000%.
- 2026-10-27: остатки глобальных классов разобраны: `.toggle` переехал в `utilities.css`, `.hide-sm` удалён из разметки справочника, где для него не было CSS, `.imp-pill` уже жил в `shared/ui/Importance`. Снимки задач, схем, обновлений и справочника desktop/mobile — 0,000% (schematics.dark — 0,009% из-за живых данных).
- 2026-10-27: последний глобальный `.ref-card` у версий аддонов заменён на `shared/ui/Card`; алиасы
  `.ref-card`/`.ref-card-head` удалены. Пустой `ReferenceShared.css` и все его импорты удалены. До/после: 18 пар снимков аддонов, версий
  (светлая/тёмная тема) и шести разделов справочника desktop/mobile — 0,000%; длинные разделы проверены в пределах
  видимой области. TypeScript, lint (без ошибок), CSS-классы, границы FSD и production build прошли.
- 2026-10-28 closeout: no global CSS files remain outside `app/theme`. Shared helpers (`.empty`, `.row`, `.grow`,
  `.hide-sm` and text helpers) remain in utilities; `legacy-ui.css` only owns the shared `fade-in` animation.
  Mobile label hiding keeps its effective 600 px threshold; importance pills keep 560 px. Onboarding selectors
  use tags/ARIA and selected menu state uses semantic attributes rather than global component classes.
- 2026-10-26: `MultiblockFormed` перемещён в `features/reference-tabs`, его CSS — в `MultiblockFormed.module.css`;
  renderer и зависимая цепочка уже перенесены в `entities/schematic`; рендер загружается отдельно через
  `entities/schematic/render`.

## Documents (file storage)

`/docs` (`/files` points there): whole storage in one list — search by name, author, task and schematic, filter by
kind, upload without a task, download, delete (schematic-library sources cannot be deleted from here).

- **Service reports** (2026-10-25, moved to `/dev` on 2026-10-28, #114): tabs «Краш-репорты» · «Логи»
  (`?section=crash|log`). Reports are `files` docs with a `report` field (`FileReport` in `entities/file`), uploaded by
  `tfc report` through the pack server; «Файлы» no longer lists them. Row: type label, size, author, time, file count,
  note, inner file names, task link; buttons copy-for-agent (`Отчёт «…» — tfc-report:<id> — …/dev?report=<id>`),
  download, delete. `?report=<id>` opens the right tab, highlights and scrolls to the row. Checked on the dev server
  (desktop and 375 px) with three real test reports uploaded via a local pack server, then deleted.

## Tasks and plans

- Tasks: list, priority, Elo comparison («Что важнее?»: full ranking list, ⇅ between neighbour rows swaps their
  ratings, equal ratings → the raised one gets +1; 2026-10-23), groups (drag in the left list to reorder — writes `order`; desktop only, HTML5 DnD), resource checklist, attachments and gallery, place on the map.
- **Листинг пользователей** (2026-10-24, задача zPIOFYQZqIM0Qf72CgL3 «Листинг пользователей сайта»): справочник ников
  users/{ник} — пишется при каждом заходе (firstSeen/lastSeen, uid). В левом меню задач — раздел «Люди»: участники с их
  открытыми задачами, клик фильтрует список по человеку. «Исполнитель» в задаче — поле с подсказкой известных ников
  (можно вписать любой) плюс «Взять себя»/«Отказаться». Позволяет назначить задачу любому игроку/агенту, а потом сказать
  «запусти работу по назначенным задачам» (MCP tasks_list assignee=… уже умеет; users_list показывает участников).
- **Окно задачи** (2026-10-24, задача QZr1Mq4EVCDWIgndD7Zg «Переработка окна создания задачи»): важность, статус,
  группа, исполнитель и «Где» — одной компактной строкой без подписей (значки внутри полей). «Где» больше не занимает
  отдельный блок: в строке меты видно поле «Где: x z или город», у заданного места — чип с координатами, ссылка на
  карту значком; на узком экране важность уходит на свою строку и переносится по кнопкам. Порядок окна: название →
  мета → описание → планы → файлы → «Ресурсы и чеклист» (чеклист последним). В новом окне тоже есть «Планы»: кнопка
  «Новый план» ставит план в очередь (строка-предпросмотр «План: <название>», крестик отменяет), а кнопка в подвале
  меняет подпись на «Создать с планом» — прежняя отдельная кнопка в подвале убрана, план выбирается в самом окне.
  Проверено на дев-сервере 1440 и 390 px (создание и правка существующей задачи; создание задачи с планом — план
  открылся, тестовые записи удалены).
- **Разделитель списка как в исходнике** (2026-10-24, задача yLwV1gkgTGNWeLmVaJFo): план или описание, набранное
  «1)», в просмотре рисуется со скобкой (у ol ставится data-delim по строке исходника, CSS-счётчик добавляет «)»),
  «1.» — с точкой, вложенные — «2.1)». Правка живого редактора — в пакете cm-live-markdown 0.1.4 (маркер вне курсора
  берёт разделитель из исходника, на это есть тесты в пакете); на сайте версия поднимается после публикации в npm.
- **Task image gallery** (2026-10-24, task wLnZtM8UKnm1aNIlAyYn): saved images and images of a new-task draft are one
  list, so a draft thumbnail also opens the full-screen view (no zoom cursor that does nothing any more; the view says
  «не загружено — появится после создания задачи»). Hovering a thumbnail shows a cross that deletes the image after a
  confirmation (the view's trash does the same); on touch screens the cross is always visible. Checked in the browser
  on the dev server: draft open/Esc, draft delete with cancel and confirm, saved task with two images, cross on hover.
- Sync status (2026-10-23, `src/shared/api/sync.ts` + `SyncBadge`): Firestore uses a persistent local cache, so a browser
  that can't reach the server (seen: reCAPTCHA/App Check failing on a PC) silently shows its own copy. Subscriptions
  now listen with metadata: header badge «нет связи» (fromCache > 6 s or `navigator.onLine` false, with unsent count),
  «отправка» (pending > 1.5 s), «ошибка сохранения» (rejected write, dismissable); a clock on a task card while its
  write is pending. Checked on the dev server via `disableNetwork`/`enableNetwork`; the PC root cause isn't diagnosed.
- Copy-for-agent button on each task row (2026-10-23, `TaskRow`, small, faint until row hover): copies
  `Задача «title» — id <id> — <origin>/?task=<id>`. MCP `resolve` (task_get/artifact_get etc.) extracts the id from
  such a string or a `?task=`/`?doc=` link.
- Plans (Markdown docs) with items and a Gemini agent; `- [ ]` checkboxes toggle by click in view mode (plans and task
  descriptions).
- **Images in plans** (2026-10-23): paste / drop / «Картинка» button → `prepareFile` (WebP ≤ 2560 px, as task
  attachments) → firestore-files with the plan's `taskId` (so they also show in the task gallery; deleting there breaks
  the plan image). Markdown `![подпись](file:<id>)`, placeholder `uploading:<key>` while loading (`src/lib/planImages.ts`);
  `Markdown` renders `file:` images everywhere. Works in both the textarea and the live editor.
  Cleanup (2026-10-23): uploads carry meta `artifactId` (owner plan). On closing the plan (unmount / `pagehide`) files
  this editor saw and whose links are gone are deleted — not on every autosave, so Ctrl+Z can't resurrect a link to a
  deleted file. On opening, owned files without links older than 10 min are swept (crash, removal by another player).
  Deleting a plan deletes its images. Links in other plans and task descriptions keep a file (copied text); schematic
  descriptions and guides are not checked. If a plan with an image copied elsewhere is deleted, that image loses its
  owner and is never cleaned.
- **Live editor probe** (Obsidian-style, task «В редактор планов попытаться сделать "обсидиан"», 2026-10-23): CodeMirror 6
  `LiveMarkdown` (lazy chunk ~100 KB gzip — `markdown()` is avoided, it pulls HTML/CSS/JS highlighting, +70 KB) replaces
  the plan textarea only with flag `?live=1` (localStorage `tfc_live_md`, `?live=0` off). Hides marks outside the
  cursor: headings, emphasis, links, items `[[id]]` (chips), checkboxes (clickable), bullets, quotes, hr, images; Enter
  continues lists. Checked in the browser: typing, items, checkboxes, undo, item picker, agent-free paths, phone width,
  light/dark. Not tried: real IME and mobile keyboards. Plan doc on the task.
  - Stage 3 (2026-10-23): tables render as a block widget (`StateField`, React `Markdown` inside) outside the cursor;
    click → raw row. Commands (now in the package): Tab/Shift+Tab nest/outdent list items with their children
    (ordered renumbering of the first item; Shift+Tab at top level removes the marker), Tab/Shift+Tab move between
    table cells, Backspace right after a marker removes it (CM's default turned it into spaces), Ctrl+B/I/E,
    Ctrl+Shift+X, Ctrl+K link, Ctrl+Enter checkbox.
  - **Package `cm-live-markdown`** (2026-10-23, task W3i4MxesJZIwoBcyI50w): the editor lives in the user's repo
    https://github.com/Jason1258t/cm-live-markdown (sibling folder `../cm-live-markdown`): core `liveMarkdown(options)`
    without React, `cm-live-markdown/react` wrapper, `@codemirror/*` as peers, 29 node checks of the commands on CM
    states, demo (`npm run demo`), Russian README. Site side — `src/components/LiveMarkdown.tsx` only passes options:
    item token `[[id|4]]` (redrawn by `refreshLivePreview` after `loadItems`), images `file:`/`uploading:` via
    `imageSrc`, tables via our `Markdown`, Russian phrases; colours/fonts — `--lmd-*` variables in `markdown.css`.
    From the npm registry `^0.1.2` (published 2026-10-23; the account has 2FA — `npm publish --otp=…` is the user's
    step, and npm stages the release until it is approved on npmjs.com, leaving a `0.0.0-stage` placeholder version).
    New release: bump in the package, tag, push, user publishes, then `npm i cm-live-markdown@^x` here. Fixed on the way (0.1.2): the image widget replaced its own root on «not found», CM read it as typing and
    wrote «Картинка не найдена: …» into the text instead of `![…](file:…)`.
  - Live formatting (2026-10-28, dev #130): prepared cm-live-markdown 0.1.5 — a standalone line
    `--- Label ---` renders a labeled divider; a standalone `--` renders an em dash outside the cursor.
    Source stays unchanged; code, links, tables and custom tokens are excluded from dash replacement.
    Browser demo checked: divider with/without surrounding blank lines, click to reveal source, dash, code/link
    exclusions, existing horizontal rule. Package build/typecheck, 33 existing checks, oxlint and formatting passed.
    Published to npm by the owner; the site now uses ^0.1.5. Site typecheck, lint and deployment checks passed.
  - Nested list markers (2026-10-23): ordered items show outline numbers «3.1.», «3.2.1.», bullets repeat the dot per
    level «• •» — in `Markdown` (CSS counters, `ol start` → `counter-reset` in the component; applies to every Markdown
    view on the site) and in `LiveMarkdown` (widget from the syntax tree). Source stays plain `1.` / `-`.
  - Save race fixed in `ArtifactPane` (also for the textarea): a finished autosave used to clear «dirty» even if newer
    edits were pending, so the old text was pulled back from Firestore for ~0.6 s and could merge with new typing
    (deleted list items «came back»). `LiveMarkdown` also ignores its own echoed value.
  - Enabled for everyone (2026-10-23), flag removed. Rule: the editor only where editing is switched on explicitly —
    read-only views stay `Markdown` (plans still open in «Просмотр», guides open read-only). `MarkdownField` (lazy
    `LiveMarkdown` in a bordered field) is used in: plan «Текст», task description «Править» (autosave after 800 ms,
    like plans), guide editor form, schematic description, pack update notes, recipe hints. `onMediaChange` reports
    image srcs; `useTextImages` shares upload + cleanup for plans (meta `artifactId`) and task descriptions (meta
    `descTaskId`, files also carry `taskId` → shown in the task gallery). Task deletion keeps images of plans that were
    detached earlier. Packaging the editor — site task «Выделить живой Markdown-редактор в отдельный пакет».

## Create schematics (.nbt)

- Block replacement manually / by rules / by agent, removing a block, id check against the library, importing
  materials into a task checklist, shared **schematic library** (source + replacements + shape).
- Layout (2026-10-21): sticky toolbar above the block list (smart replace + «Применить», favourites + «Подставить»,
  filter); smart-replace and favourites panels collapse (one open, remembered); shape is behind the «Форма» button.
- Block list order (2026-10-22): blocks missing from the pack library (not air) and without a replacement go first,
  removed ones last; checked in the browser on a test schematic with a fake block.
- Shape on download: crop to outermost blocks, margins (sides/bottom/top), «очистить пространство» = explicit air in
  all free cells (not for multi-palette schematics, up to 2M cells). Platform: N layers of a chosen block under the
  schematic (below the bottom margin); «пустая» — solid top layer, below only the perimeter without a floor.
- **Blocks without an item** (2026-10-23, task GiAd4ombssZTQL3l26WL): `public/blocks.json` (`scripts/mods/blocks.mjs`:
  blockstate files of all jars + vanilla, item from `loot_table/blocks/…`, fallback without `wall_`) — create:belt,
  belt funnels, powered shaft, glass/encased pipes, piston head, wall torches/signs, potted plants are recognised (name +
  icon of the placing item, `blockEntry`/`placedBy` in `shared/pack-data/items.ts`) and counted as that item in task materials.
  Replacement targets must be blocks (`isBlock`: block-only or item with `b`): pickers in the editor and layers show
  only blocks, the agent gets only blocks, download refuses non-block targets, favourites mark them «не блок» (the
  shared favourite `create:belt → create:belt_connector` turned belts into nothing). Old data without `b` — no check.
  Browser-checked on library schematic ore2dust_compact with a local build; in game not checked.
- **Favourite replacements** (`replaceFavorites`, shared): ★ on a replacement, smart completion — stairs/slabs/fences
  by name `<base>_<kind>` (`lib/replaceFavorites.ts`), batch apply with a choice when a block has several variants.
  Not checked in game.
- **Layer editor** («Слои», 2026-10-19, `pages/schematics/ui/SchematicLayers.tsx`, `entities/schematic/schematicEdit.ts`): top view of one
  layer with icons and facing arrows, wheel zoom, drag pan, ↑↓ layers, layer below shown pale; LMB — replace (this
  block / same on layer / global), RMB drag — remove; Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo (physical key, works in
  Russian layout; global replacements from the dialog are undoable too). **Selection** (2026-10-22, item 1 of task
  «Улучшения редактора схем крупные»): a set of block indices shared by the layer view and 3D, dropped on any
  schematic edit; entry points so far — «Выделить» / «Выделить группу» in the cell dialog (group = edge-connected
  blocks of the same effective id on the layer, `connectedGroup` in `entities/schematic/schematicEdit.ts`, can also search in 3D);
  panel «Выбрано N блоков» (top right): replace / «Убрать» as one undoable edit, «Сбросить», Esc clears. 3D shows
  selected blocks as translucent accent cubes (respects the slice). Browser-tested on a library schematic (group of 36,
  remove, replace, undo, 3D highlight on the slice); nothing saved to the library. Layer view clicks (item 2):
  double-click — select the group (replaces the selection), Shift+click / Shift+double-click — add the block / group,
  Ctrl/Cmd+click — remove; click on an empty cell closes the dialog, else clears the selection; plain click still opens
  the dialog. Browser-tested (36 → 72 → 71 → 72, empty-click behaviour). Area (item 3): Shift+drag — dashed frame adds the
  layer's blocks inside it (explicit air skipped); the frame may go past the edge; plain drag still pans. Shift is a
  **toggle** (user's wish, no Ctrl/Cmd variants): Shift+click on a selected block unselects it, Shift+double-click
  unselects the group if the block was selected before, a frame whose blocks are all selected turns red and unselects
  them. Toggle tested with synthetic events: 1→0, frame 84→0, group 19→0. **3D picking** (item 4): raycast against the
  schematic mesh (hit point nudged 0.01 along the ray, floored → block cell); click — select the block, double-click —
  volume group, Shift — toggle, click past the model — clear; hover shows a wire box and the same block tooltip as the
  layer view. Groups (layer and 3D) count face, edge and corner neighbours — curved shells step diagonally (airship
  envelope: 106 face-connected → 3904 with diagonals). Browser-tested on cargoairship: group 3904, Shift −1/+1, clear,
  remove (7250→3346 blocks) and undo. Delete / Backspace removes the selection (one undoable
  edit; ignored while typing in a field) — browser-tested in 3D: 3904 removed, Ctrl+Z restored. **3D object by frame** (2026-10-23, task «Вторая волна доработок редактора», rules from Jason's plan doc):
  Alt+drag in 3D draws a frame (captured before OrbitControls; Shift+Alt toggles); `frameObject` in
  `entities/schematic/schematicEdit.ts` takes every block whose centre projects into the frame at any depth (respects the slice) minus
  background: air, schematic edges and planes. A plane = the frame-crossing blocks (in frame with a neighbour outside)
  assigned to their most-populated axis plane, spread 2D, ≥70 % made of 1–2 materials, and continuing outside the frame
  in ≥2 in-plane directions (a chimney wall continues only down); background = those materials flood-filled in that
  plane. The object's own material doesn't matter; crossing non-planar things (shafts, belts, a clipped chimney) stay in
  the object, cut by the frame. Known limit: a part flush with a background wall (right chimney of kinematic_factory)
  is eaten as wall. Selection panel got «Умная замена» (page rules or agent, as configured) and «Из избранного» (first
  favourite per id); `editCells` accepts a per-id mapping. Browser-tested: synthetic scenes (machine on mixed floor,
  same-stone machine, brick barrel at brick wall, clipped frame), ore2dust_compact (137 machine blocks, floor and walls
  left; Delete → 265 blocks, Ctrl+Z back; favourites 49, smart 94, undone), kinematic_factory left chimney. Frame
  drawn with synthetic pointer events; not tried with a real mouse. Gotcha: after HMR the 3D
  view kept the old instance without listeners — reload the page when testing 3D changes. Tested with synthetic pointer events
  (the browser tool can't hold Shift while dragging): +80, −11, +50 → replace 119 with stone, undo. Next: picking in 3D. Cell edits change the source itself:
  «В библиотеку» uploads a new file and deletes the old one (saving edits to the library not browser-tested — shared
  collection). Adding blocks into empty cells is not supported.
- **3D** («Слой / 3D», 2026-10-19, three.js as a separate chunk): simplified block shapes (`entities/schematic/schematicMesh.ts` —
  slabs, stairs, trapdoors, doors, fences, walls, panes, Create shafts and cogs, small stuff as cubes), hidden faces
  skipped, textures from an `/icons` atlas (block texture by id path, else item icon) or average colour; slice at the
  current layer. **Camera** (2026-10-23): middle-drag (or Alt+LMB for trackpads) orbits around the point under the
  cursor (raycast hit; on a miss — the cursor ray at the old target depth, clamped to the mesh bbox; green dot while
  orbiting), own orbit code with pitch clamp, then OrbitControls target moved onto the view axis at the pivot depth;
  plain LMB — click picks, drag frames (Alt no longer needed); RMB pan and wheel zoom stay in OrbitControls
  (`zoomToCursor`, `zoomSpeed` 2.5). Tested with synthetic pointer/wheel events and a real click; not tried with a
  real middle button or trackpad.
- **3D view restored** (2026-10-27, task Uv5OpDxSyWdxEAiGGAzc): CSS Modules `camelCaseOnly` exports `.view3d`/`.view3dStats` as `view3D`/`view3DStats`; the old lowercase property accesses returned `undefined`, leaving the WebGL canvas only 17 px tall over the still-visible layer canvas. Updated the lazy view and loading fallback to use the exported keys. Reproduced on the live site with `ore2dust_compact`; after deployment checked both view modes and confirmed the 3D canvas fills the viewport, with no app runtime errors.
- **Block shapes and icons** (2026-10-23, task «в отрисовке схем и по слоям и в 3д проблемы с текстурами»): 3D —
  stairs with inner/outer corners (`shape`), ladders as a 1 px plate on the wall behind (`facing` — where it looks;
  IE scaffolding ladders stay cubes), Create funnels (wall/vertical — on the face they're attached to, belt funnel —
  at its belt edge), depot, belt, chutes, Simulated rope connector (knot at the attached face), TFC rope anchor
  (post), chests; invisible blocks (IE `fake_light`, barrier, light, structure_void) are not drawn. Sizes taken from
  models in jars (Create 6.0.10, Simulated 1.3.1, TFC 4.2.9). Layer view: flat texture only for a full cube with
  its own texture; other shapes or a borrowed `t` (Create gearbox → shaft texture, stairs → planks) — the rendered
  model `g`. Browser-checked on ore2dust_compact (431 → 390 blocks: fake_light gone, gearboxes/slabs/chests
  recognisable) and BeloDacha roofs. Since the next entry these name rules are only the fallback.
- **Real block models** (2026-10-23, task «Схемы: 3D и слои по настоящим моделям блоков из jar»): builder
  `scripts/mods/block-models.mjs` (run by `mods.mjs`, jar cache `.done-v23` now unpacks `blockstates/`, vanilla
  `.done-v5`) writes `public/block-models/<ns>.json` — blockstate variants/multipart → models (geometry deduplicated
  separately from texture slots), elements with from/to, rotation, faces (uv, rotation, cullface, tintindex); OBJ
  models (Create blaze burner, valve handles, crushing wheel; IE `ie_obj`) as triangles; wrapper loaders (TFC leaves
  and plants, Firmalife shelves) → their base model; `composite` children. Face textures are copied into `icons/`
  (paletted TFC textures drawn by the engine). Size: 11.3k blocks, ~11 MB raw / ~1.06 MB gzip in all, TFC file
  190 KB gz, Create 80 KB; +4.3k textures (~4 MB) in `icons/`; build ~36 s with a warm cache. Site
  `entities/schematic/blockModels.ts` loads only the namespaces of the schematic's blocks and bakes faces like `FaceBakery`
  (variant x/y, element rotation + rescale, face uv rotation, uvlock approximated as world-aligned default uv,
  cullface after rotation); `schematicMesh.ts` uses them and falls back to `shapeOf` when a block has no model
  (BE-rendered: chests, Create belt; IE machine parts, Firmalife greenhouse panels) or the model is known to be
  incomplete (`CODE_DRAWN`: Create fluid pipe — the jar model is only walls, rims are code). Layer editor: top view
  baked from the model's up-facing faces (`blockTopView`, lower faces darker), else the old icon. Fixed in passing:
  `FLUID` matched «fluid_pipe» (pipes were flat 14 px boxes). Browser-checked: ore2dust_compact (390 blocks, 3052
  faces, 24 ms first / 9 ms rebuilt), cargoairshipforsamb1y (7250 blocks, 41.5k faces, 162 / 42 ms), a synthetic
  test schematic (gearbox, funnels, belt funnel, tunnels, rope connectors, shaft, cogwheels, blaze burner, valve
  handle, crushing wheel, stairs, fence, depot, press, pipe, chest, TFC leaves). Not done: tint colours are guessed
  by block name (code decides in game), no AO/emissive/animation, weighted random variants take the first.
- **Create fluid pipe in 3D** (2026-10-24, task «Все еще порблемы с отрисовкой»): the jar core walls (multipart) plus
  the parts the game adds in code — `fluid_pipe/{connection,rim_connector,rim,drain}/north.json` copied into
  `entities/schematic/schematicMesh.ts` (`PIPE_PARTS`), turned to each connected side; which part by the neighbour as in
  `StandardPipeFluidTransportBehaviour.getRenderedRimAttachment` (Create 6.0.10, decompiled): straight pipe → pipe
  = connection, bend → rim_connector, empty/glass/encased/non-connecting pipe → rim, pump facing it → nothing, other
  pipes/valves/pumps → rim_connector, anything else → drain (fluid capability assumed). Layer view unchanged (icon).
  Browser-checked on cargoairshipforsamb1y with only pipes/tanks/pumps left: solid pipes with flanges instead of
  loose plates; not compared with the game side by side.
- **Copycats in 3D** (2026-10-24, task «Отрисовка create»): copycat blockstates point at `block/air`, the game cuts
  the shape out of the material's model. `entities/schematic/copycats.ts` — registry of shapes by block id from mod code (Create
  6.0.10 `AllShapes` STEP_BOTTOM/TOP, CASING_3PX; Copycats+ 3.0.8 `CCShapes`: slab, byte, byte panel, half panel,
  layer, slice, corner/vertical slice, vertical step, beam, board, slope as an 8-step staircase, stairs) and materials
  from the schematic block nbt (`Material`, or `material_data.<part>.material` for multi-part Copycats+); the
  schematic's replacements apply to materials too, none — `copycat_base`. Each box face gets the material model's
  largest face texture from that side, uv by position. Browser-checked on old_brick_factory (2004 copycats: cornices
  of steps, girder panels); not compared with the game. Not done: layer view still shows the icon, Create: Connected
  copycats, doors/trapdoors/fences/walls of Copycats+ (they have vanilla-like models? not checked).
- **Create parts drawn by code** (2026-10-24, task «Отрисовка create»): builder `block-models.mjs` adds `pm` (path →
  model) with every `models/block/**` of mods in `PARTIAL_NAMESPACES` (Create: 1887 incl. 444 never referenced by
  blockstates; create.json ~140 → ~230 KB gz). Site `partialQuads(ref, turns)` (blockModels.ts) bakes one with turns
  around the centre; `entities/schematic/createParts.ts` — registry by block id from Create 6.0.10 visuals/renderers: belt
  (BeltRenderer: start/middle/end + bottom, diagonal, pulley), gearbox halves, encased shafts/chain drive/adjustable
  gearshift/speed controller/pistons (shaft), clutch/gearshift/sequenced (split halves), creative motor, cuckoo
  clock, encased fan (half + propeller), drill head, pump cog, millstone inner, crushing wheel, powered shaft,
  crafter cog, press (shaft + head), mixer (cog, pole, head), deployer (shaft, pole, pointing hand), encased cogs
  (shaftless cog + halves by top/bottom_shaft). Machines at rest (press head up, deployer retracted). Missing `pm`
  (old data) → the old look. Published by the pack server 2026-10-24 (agent ran `tfc admin rebuild --pull` +
  `publish --live`); live site checked: ore2dust_compact 5108 faces. Not done: mechanical arm, steam engine, flywheel, hand crank, saw, water
  wheels, bearings, gauges, funnels/tunnels flaps.
- **Chests in schematics** (2026-10-24, Jason: «сундуки просто обгрызанным блоком досок»): vanilla and TFC chests
  have no block model (ChestRenderer). The item-icon registry `scripts/mcp/models/` handlers got an optional
  `block(id)` → `{ rotate: 'facing', variants(ctx) }` (`chestBlock` in `minecraft.mjs`: single + double halves
  `createDoubleBodyLeft/RightLayer`, textures `*_left`/`*_right`); `codeBlockModel` (index.mjs) → `codeBlock`
  (render.mjs) → `icons3d.blockCode` → `writeBlockModels({ codeBlock })` turns the quads into OBJ triangles and
  writes variants `facing=…,type=…` (south = y 0, ChestRenderer −facing.toYRot). 75 blocks; entity chest textures
  copied into `icons/`. Browser-checked on ore2dust_compact (21 chests, doubles join); not compared with the game.
- **Library preview** (`entities/schematic/schematicRender.ts`): on save the browser draws a 480×320 webp (~15–20 KB) with
  replacements into the `preview` field (rule: ≤300k chars); old records have a «нарисовать превью» button. Tested in
  the browser on two library schematics (8.6k blocks → 27k faces, 80 ms); saving with preview via the button not
  tested. Both library schematics got previews on 2026-10-19.
- Library is a plain list; clicking opens a right panel: preview (draw/redraw), title and description (Markdown,
  `description` ≤ 4000 chars), edited in place, saved on blur.

## Datapacks, KubeJS scripts, recipes, tags

- **Datapacks**: template / replace / remove recipes, arbitrary files, zip, «К задаче», «Сохранить как файл» (zip in
  Documents without a task, replaces a file with the same name), checks (stale source, missing items, **«KubeJS
  удалит»**), export as a KubeJS script. «Ставить в мир» flag (`install`, «в мир» badge) — for the `tfc` app; test
  packs are not flagged. Files are built by `src/lib/datapackFiles.ts`, shared with Node (2026-10-20).
- **KubeJS scripts** (`kubejsScripts`, list under datapacks, 2026-10-20): file name, text, «Ставить на сервер»; edit,
  download, delete; the «KubeJS удалит» builder saves a script via «На сайт». Installed by `tfc pull kubejs`
  (datapacks — `tfc pull datapacks`, schematics — `tfc pull schematics`). Schematic replacements and shape — shared
  Node module `src/lib/schematicFile.ts`.
- **Recipes**: full catalogue without limit, statuses including KubeJS, **builder** to work around removals.
- **Tags**: members by mod and KubeJS, search by id and content, datapack edit editor (add / remove / replace). The
  `remove` format was not checked against NeoForge code or in game. Tag kind is a coloured label (items / blocks /
  fluids / entities); same id in another kind links to it. Datapack check warns when a recipe references a tag absent
  from items and fluids (block tag or non-existent) — the slot would be empty in game.

## Reference

- Tabs: Руды · Топливо · Металлы · Еда · Ботаника · Карта (+ Мультиблоки, Электричество, Гайды below).
- Metals and food respect the pack datapack (`kubejs/data`): a record with the same id replaces mod data (aluminium
  1550 °C instead of 1740), metals table shows a «kubejs/data» badge.
- Ore smelting and chains are recomputed by `npm run kubejs` from recipes that remain in game (mods + `kubejs/data` −
  KubeJS removals + script additions; input/output replacements and tag edits by scripts are not counted). All 48
  graded ores smelt directly, 10/20/30 mB (`ore.js`); the old powder chains on the site were wrong.
- `event.recipes.tfc.heating(...)` from scripts is parsed fully (ingredient, temperature, fluid) per the schema in the
  KubeJS TFC jar; other mod helpers — still without full JSON.
- Pack oddity: aluminium as a metal is 1550 °C (`fluid_heat`), bauxite melts by recipe at 650 °C
  (`metal_temperature.aluminum` in `const/tfc.js`).
- Fuel is one tab with sub-sections: solid (no wood) and liquid with oil (`?tab=fuel&sub=liquid`; old `tab=liquid`
  redirects).
- 2026-10-28 (#126): liquid fuel separates CDG burner and the ordinary blaze burner (Create Liquid Fuel).
  The comparison lists concrete fluid IDs, modes, consumption and time per bucket, with a simulated CDG valve.
  CLF `compat` resources from any namespace are merged with KubeJS by resource ID in shared `liquidFuel.ts`,
  used by both the site and MCP; a shared tag never extends CLF compatibility to other fluids. Source is preserved.
  Fuel namespaces are checked against installed jar mod IDs; compatibility folders do not imply an installed mod.
  Jar extraction includes `data/<ns>/compat`; cache marker v24 invalidates the old incomplete extraction.
  Reference and KubeJS JSON requests revalidate the browser cache, so a data publication is visible on reload.
  CDG heat uses Java float arithmetic (ethanol 0.9 does not reach the double 1.8 threshold); consumption counts
  drain events over its 40000-tick cycle. CLF consumption is the long-term average; initial buffering is explained.
  TFC/Wooden Cog temperature is explicitly outside the comparison. Checked: one-off merge/default/float checks,
  real KubeJS compat records, MCP merge, desktop and 390 px browser, search and closed valve. Not checked in game.
- Food section closed (`docs/plans/food.md`): products, composite meals with calculators, cooked meals by method.
  Leftovers listed in the plan («Сознательно не сделано»). CSS вкладки `MealsTab` переведён на локальные классы
  `MealsTab.module.css`; остаточных зависимостей от `ReferenceShared.css` и `:global` в ней нет (2026-10-26).

### Botany

Reference tab, side menu: crops / bushes / trees. Climate ranges, fruits and seeds, T/humidity filter; from mod code —
N/P/K use, crop type, monthly season calendar, sapling growth, ripening time (growth multiplier from server config),
month length from the world save, crop yield from loot tables, where the plant spawns naturally, fruit per harvest,
server sapling timings, calendar in game hours, light and soils, where the harvest goes (without composite meals),
death of overripe crops. «Теплица» sub-tab (Firmalife): 63 plants, bed, wall material by tier, fertilisers. Grapes:
seasons, growth speed and harvest quality conditions from code. Greenhouse ripening time. Card redesigned: range bars,
fertiliser blocks, calendar with month labels. `.class` parsing — `scripts/mods/classfile.mjs`. Remaining —
`docs/plans/botany.md`.

### Multiblocks (2026-10-19)

- `?tab=multiblocks&mb=<name>`: 24 IE structures and 4 Advanced TFC Tech from jar templates
  (`scripts/mods/multiblocks.mjs` → `public/multiblocks.json`, `public/multiblocks/*.nbt`).
- 3D view (CSS 3D, mouse rotate) and top layer view with slider, mirrored variant, hammer-strike block (from code,
  checked against book text for crusher and excavator), materials with IE tag substitutes (scaffolding, sheet metal,
  storage; hopper and tank — any sheet metal), energy use from `power.json`, recipe links, book text (IE — English as
  in game; Advanced TFC Tech and TFC-IE Crossover — Russian), .nbt download. Arc furnace — TFC-IE Crossover variant
  (TFC fire bricks). **Not checked in game**, including loading .nbt into Create.
- «Постройка | Итог» toggle: finished-machine model from jar (OBJ + textures, three.js,
  `scripts/mods/multiblock-models.mjs`), aligned with the build cells (exact for all 27). Missing for the excavator
  bucket (drawn by code); moving parts not shown; animated textures — first frame.
  Texture V (2026-10-23 fix): every model reads V the standard OBJ way (both `neoforge:obj` with `flip_v` and
  `ie_obj` take `1 − v`, checked in ObjModel / PolygonUtils), so the viewer always keeps `flipY = true`; the
  `flipV` field in data is ignored. Before the fix 24 of 27 models had textures upside down.
- Guides section «Мультиблоки» (`?tab=guides&sub=multiblocks`, `section: multiblocks`): widget `::multiblock id=…
[full] [materials]`; articles mb-assembly, mb-tfc (what changed: arc furnace from fire bricks, IE blast bricks not
  craftable in the pack, smelter via KubeJS), mb-coke-oven, mb-excavator.
- Since 2026-10-19 group «Добыча Create» (Create Ore Excavation): coe-prospecting — veins (chunk, «one per square»,
  infinite, Chinese names from the pack script), detector, atlas, sampling drill, table of all veins; coe-drilling —
  setup, iron drill suffices, 30 rpm steps, 256 SU per rpm, calculator. From mod code and pack scripts, not checked in
  game. Noticed: the gem vein drops all 7 gems per cycle (script expects «one of seven»); the script removes the water
  vein — the pump rig is useless.

### Electricity (started 2026-10-14, plan — `docs/plans/electricity.md`)

- CSS Modules (2026-10-26): `PowerIeLoads` (таблицы «Сеть IE» и набор нагрузки для калькулятора гайда) использует `PowerIeLoads.module.css`; правила `PowerShared.css` остаются для остальных потребителей.
- CSS Modules (2026-10-26): каркас `PowerTab` (`.power` и отступы его абзацев) локален в `PowerTab.module.css`; общие `.power-*` остаются в `PowerShared.css`, поскольку нужны гайдам, аддонам и загрузкам IE.
- How Create (SU), Electro Energetics (V/A/W) and IE (FE/t) relate: conversion rates and calculators for generator,
  motor, W ↔ FE; EE loads under voltage and device limits; IE wires and generators. Formulas and defaults from bytecode
  (`scripts/mods/power.mjs` → `public/power.json`), settings from server config («сервер» badge on changed ones).
- EE generator: stator = 3 «magnets» for the rotor, 144 W per rpm, shaft pays ≈ 1 SU per 1 W (+6 SU/rpm per rotor) —
  verified on the dev server (`/rectest gen`). The old «8 W per SU, loop in profit» was a parsing error, fixed
  2026-10-14: generator → motor loop loses ~21 %.
- Rectifiers (and any EE diode bridge) on a generator are unstable at `simulation.microTicks = 1` (server): the diode is
  linearised from the previous solve. Verified on the dev server; site guide about the pump. Solved by the addon
  (diode-free rectifiers, now EE Extras).
- EE diode above ~9 mA — 0.8 V + ~5.6 Ω (code + simulation); pump guide fixed (used to say «~1 V»).

## Guides

- Since 2026-10-16 a separate reference tab «Гайды» (`?tab=guides`), sections «Электричество», «Аддоны»
  (`&sub=addons`, same articles as on `/addons`), «Мультиблоки», «О сайте»; old URLs redirect.
- Section `addon` (2026-10-22) — addon pages `/addons/<mod>` (guide id `addon-<mod>`), not listed under «Гайды»;
  see [addons.md](addons.md).
- Since 2026-10-15 articles live in Firestore `guides`, editable on the site by anyone, with revision history;
  calculators are described in the article as ```calc blocks, see [docs/plans/guides.md](../plans/guides.md);
  `npm run guides -- pull|push` — files ↔ database.
- Electricity articles: first generator (assembly, stator orientation, sizing calculator); optimal generator mode
  (load model from code, checked on dev server; ~100 A optimum; sizing and check calculators, load set from IE
  machines); «Сеть IE» tab — IE and Advanced TFC Tech consumer tables (multiblocks by pack recipes, devices by config);
  rectification (who needs DC, schemes, EE diodes and microTicks, rectifier calculator); AC pump (pump speed by
  ticks); long-distance line (wires with allowed current, transformers, grounding, line calculator); EE ↔ IE
  (converter: FE only through the back face, pulls/pushes itself, limit U²/20, IE connector, calculator); electric
  motor (U²/R SU headroom at any rpm, «🔓» mode, idle ≈ 21 % of draw; on raw AC with microTicks = 1 the SU headroom
  wobbles — averaged over only 3 solves); heater (Create basin — heated only, Farmer's Delight; always 45 Ω in the grid
  but heats by setting — server 15 Ω makes it 3× «hotter» than it draws); battery (cell 24 V / 0.1 Ω / 10 Ah ≈ 214 Wh,
  calculator; vs IE capacitors — HV ≈ 1333 Wh per block vs ≈ 428, but via converter); protection (fuse and breaker
  heat like a wire: rating below the wire's continuous current; breaker also trips instantly above 5× rating; arc on
  break above 1000 V); «Горят провода у генератора» (`wire-burn`: generator 100 A at full load, up to 200 A when
  overloaded, insulated copper burns from 121 A; second cause — lower-voltage consumers without a step-down
  transformer). Not checked in game.
- «Аддоны» has two sub-sections: «Аддоны сборки» and «Как написать свой» — six from-scratch articles for programmers
  who never wrote mods (jar and loading, JDK 21 + IDEA + MDK, first block with resources, compileOnly on jars from
  `mods/` and the TFC calendar, mixins, testing and release). Code verified with a trial MDK mod (scratchpad, not
  committed): everything compiles (with TFC 4.2.9 via compileOnly); on `runServer` the block registers and places,
  drops work, recipe loads, mixin changes the result, wrong method name with `defaultRequire: 1` crashes startup.
  Built on NeoForge 21.1.219 (maven.neoforged.net was down; 21.1.248 — pack minimum, recommended by the articles —
  didn't download), so **running together with TFC is not verified** (TFC needs ≥ 21.1.234). Client (texture,
  in-game translation) not checked. Dev environment — `~/.gradle/local-tools` (JDK 21, Gradle 8.14.3).
- «О сайте» (2026-10-19, `?tab=guides&sub=site`, section `site`): eight `site-*` articles (overview, tasks/plans/files,
  schematics, datapacks/recipes/tags, item search, reference and map, updates and addons, how to edit guides). The
  «проверено в игре» badge is hidden in this section. `[[id]]` inside code spans/blocks is shown literally, not as an
  icon — across all site Markdown.

## Onboarding hints (2026-10-19)

First visit — «Знакомство с сайтом» (header), then on first entry into each section 1–4 steps with highlighted
elements (`lib/onboarding.ts` — texts and selectors, `widgets/onboarding/Onboarding.tsx`). Skippable (Esc, «Пропустить»),
«Больше не показывать подсказки» disables all; «?» in the header — show again, toggle, reset. Shown state — Firestore
`onboarding/{uid}` (anonymous uid, i.e. per browser) + localStorage copy. If a step's target isn't found in 2.5 s —
the step is centred.

## Site analytics (2026-10-23, task «Аналитика действий на сайте», group «Разработка»)

- Own log in Firestore, no Google Analytics. `src/shared/api/analytics.ts`: events buffered in memory, one batch every 30 s
  and on tab hide → `visits/{id}` (one doc per tab visit: uid, nick, device, `events[]` ≤ 400, `expireAt`) +
  `visitDays/{YYYY-MM-DD}` counters via `increment` (visits, views by section, actions, searches incl. `<where>:пусто`,
  events per nick).
- What is recorded: section views (`VisitTracker`, path + `?tab=`), `?task=` / `?g=` opens, all store writes
  (`tasks.status` with target status, `tasks.assignee/checklist/rating`, `<collection>.create/edit/delete`), file
  upload, any `a[download]` click, guide save, Gemini calls (no text), search text + result count in tasks, plans,
  schematics, recipes (+ recipe by item), tags, item search, ores/fuel/food/metals (`useSearchTrack`, 1.5 s debounce).
  Not yet: botany, meals, map, guide search.
- Not recorded: dev server, nick `ClaudeTest`, browsers with «не считать меня» (localStorage `tfc-analytics-off`).
  Dev check: localStorage `tfc-analytics-dev=1` → visits marked `dev`, day counters in `dev-YYYY-MM-DD`; console
  `__analytics.analyticsDebug()` / `.flush()`.
- `/stats` — hidden route (not in the menu): period today/7/30, tiles, visits per day, sections (views, people, time
  from view→next view/hide, idle capped at 30 min), actions, «искали и не нашли», frequent searches, people → visit
  timeline. Reads: one doc per day + visits of the period.
- Retention: `visits.expireAt` = start + 90 days. TTL policy needs Blaze (deploy got 403 «billing disabled»), so
  `/stats` deletes expired visits on open (`purgeExpired`, ≤ 200 per open; rules allow deleting any expired visit).
  `events` excluded from indexing (`firestore.indexes.json`).
  Rules: visit written only by its uid; day docs — only known keys (increments themselves are not enforced).

## World map and pack updates

- TFC Real World map: projection from the mod, normal view and layers, click → coordinates, cities, distances, spawn;
  world parameters from the imported server config.
- Pack updates: a record on deploy + model-written patch notes.
- Pack freshness `/freshness` (switch «Лента обновлений / Свежесть модов» on both pages, 2026-10-22): static report
  from the build, filter by colour, search, «Перепроверить Modrinth» (live from the browser, CurseForge rows kept),
  «Скачать отчёт (JSON)». First run: 234 mods — Modrinth 175, CurseForge 54, not found 5 (hand-built: `tfcr-fixes`,
  `woodencog-…-TFCR`, `TFCBetterBlastFurnace-TFCR`, `tfc_ability_fix`, `kaleidoscopetfctavern`); red 5, orange 31,
  yellow 62. Checked in the browser (desktop + 375 px) and the recheck button. Version parsing checked on 11 cases.
  2026-10-22, third source «Гит сборки»: GitHub releases of the pack devs (`PACK_GIT` in `src/lib/freshness.ts`,
  repos from `local-mods/README.md` of github.com/GranniXXie/TerraFirmaRebirth), only for mods still not found; all
  5 hand-built jars matched (tfcr-fixes 1.7.7 → 1.7.12 yellow, other 4 current). The recheck button now rechecks
  Modrinth and git live; on a GitHub error git rows are kept from the report. Checked: script, browser, fallback with
  GitHub 403. 2026-10-22: skill `update-plan` («план обновления», `.claude/skills/update-plan/`) turns the report
  into a plan; tried on the 5 red mods (plan shown to the user; site task — see the plan doc, part 5).
- Integration analysis (2026-10-22, task «Разработать скилл для анализа сборки и интеграций», group «Разработка»):
  skill `integration-plan` (`.claude/skills/integration-plan/`) — pack inventory by MCP → candidate mod by its jar →
  overlaps with TFC/energy/Create → routes (config / KubeJS / datapack / addon / don't install) → plan doc on the
  task (someone else's report is not overwritten, a new doc «Анализ интеграции: …» is added). MCP can't read jars
  outside `mods/` — candidates are read by `unzip`/`javap` for now (skill step 7). Step 1 tried on «химия»; not yet run
  end to end on a real candidate.

## Firebase diagnostics

- Dev #137 (2026-10-29): `?firebaseDebug=1` opts into console diagnostics of anonymous Auth, forced App Check
  refresh, and a read of the same reserved schematic document via Firestore SDK and REST. No writes, token values,
  document content or user identifiers are logged. Normal links do not load the diagnostic module. An isolated SDK
  probe uses the same account and App Check token with an in-memory cache, then closes its resources.
- Production rules match the repository; anonymous Auth is enabled. At the first IAB failure (10:10 UTC), App Check
  metrics show Auth VALID/ALLOW and four Firestore INVALID/DENY requests. Production diagnostics confirmed that
  REST and an isolated SDK connection work with the same credentials while the shared persistent SDK fails.
- Firestore uses the single-tab persistence manager: the first tab keeps disk persistence and additional tabs fall
  back to memory. This avoids using a frozen primary tab with stale credentials. After five minutes hidden, return
  from bfcache, or reconnecting, Auth/App Check refresh together. Failed live lists resubscribe without a page reload;
  credential errors also trigger one coalesced recovery attempt, throttled to once per 30 seconds.
- Checked: TypeScript, lint, format; one-off checks for shared consumers, recovery, cancellation and a simulated
  five-minute idle. Actual hours-long browser suspension is not yet verified.
