# TFC Планы — памятка агенту

Сайт-планировщик для группы, играющей в сборку TerraFirmaCraft RealWorld (Minecraft 1.21.1, NeoForge):
задачи, документы, схемы Create, датапаки, рецепты, справочник, карта мира, обновления сборки.

- Сайт: https://tfc-plans-fd2c.web.app · репозиторий: https://github.com/Jason1258t/tfc-plans
- Firebase-проект `tfc-plans-fd2c`: Firestore (eur3), анонимный вход, App Check (reCAPTCHA Enterprise), AI Logic (Gemini)
- Что уже сделано и что висит — в [docs/STATE.md](docs/STATE.md). **Обновляй его в конце работы**, если состояние изменилось.
- Устройство и инструкции для людей — в [README.md](README.md); планы крупных фич — в `docs/plans/`.
- Свои моды сборки (аддоны) — `tools/<мод>-mod/`; как их собирать и проверять без игры — [docs/addons.md](docs/addons.md).
- Сервер сборки (VPS, обслуживание, публикация на сайт) — [docs/pack-server.md](docs/pack-server.md); программа `tfc`
  (скачать, команды игрока и хоста) — [docs/tfc-app.md](docs/tfc-app.md).

## Как работаем

- Общение и весь текст интерфейса, комментарии в коде, сообщения коммитов — **по-русски**.
- Задача считается законченной, когда она **проверена, задеплоена и запушена** — пользователь обычно просит именно так
  («пусти в деплой по готовности»). Порядок: ветка → коммиты → проверка → слияние в `main` → `firebase deploy` из `main`
  → `git push`.
- **Ветки (git-flow):** работа идёт не в `main`, а в ветке от свежего `main`: `feat/<кратко>` — новая возможность,
  `refactor/<кратко>` — переделка без изменения поведения, `fix/<кратко>` — исправление. Имя латиницей через дефис
  (`feat/power-guides`). Готовую проверенную ветку вливаем в `main` локально (`git merge --no-ff`), ветку удаляем.
  PR не используются.
- **Деплоится только `main`:** `firebase deploy` запускай, стоя на `main`, с чистым рабочим деревом, после слияния.
  Из `feat/`/`refactor/`/`fix/` не деплой — даже «на минутку проверить», для этого есть dev-сервер.
- Сообщение коммита: «Раздел: что сделано», одной строкой; коммит слияния — `Слияние feat/<кратко>: что сделано`.
- Правила Firestore меняются вместе с кодом: сначала `npx firebase deploy --only firestore:rules`, потом хостинг.
- Пользователь не программист-фронтендер: в отчёте — что изменилось для игрока, что проверено и как, что не проверено.
  Без внутренних имён функций, если они не нужны для действия.
- Игровые факты (механика модов, фильтры KubeJS, проекция карты) **проверяй по jar** в `mods/` (`unzip`, `javap -c -p`),
  а не по памяти: несколько раз именно это меняло решение. В отчёте говори, что проверено по коду, а что — нет.
- В игре агент ничего проверить не может. Рецепты, скрипты и координаты всегда помечай «в игре не проверялось».

## Команды

```bash
npm run dev            # Vite; перед стартом сам дособерёт библиотеку (scripts/ensure-mods.mjs)
npx tsc -b             # типы (в build входит)
npx oxlint src scripts # линтер; предупреждения set-state-in-effect и only-export-components — старые, не чинить попутно
npx prettier --write <файлы>   # singleQuote, printWidth 120; не запускай на весь src без нужды — шум в диффе
npx firebase deploy --only hosting           # сборка + pack-release + выкладка
npm run deploy:site   # то же без пересборки данных модов (jar не нужны) — для правок сайта, в т. ч. из worktree
npx firebase deploy --only firestore:rules
npm run mods          # пересобрать библиотеку из mods/ (долго, кеш в .cache/)
npm run serverconfig -- <zip|папка>                # конфиги сервера → Firestore config
npm run kubejs -- <zip|папка> [--layer world]  # скрипты KubeJS → public/kubejs.json, свои предметы → kubejs-items.json
npm run world -- <мир|world/data|tfc_calendar.dat|zip>  # сохранение мира → Firestore config (scope world)
npm run pack -- <папка версии|zip> [--world …] [--only …] [--out …] [--dry-run]  # всё сразу + instance/sources.json
npm run guides -- pull <папка> | push <файл.md|папка>   # гайды справочника ↔ файлы Markdown (подпись — TFC_NICK)
npm run pack:fetch [-- --kubejs] [--data|--data-only]  # текущая сборка с сервера сборки → instance/pack/ + mods/ (и данные)
npm run pack:publish -- <папка данных> --dry-run   # что выложилось бы на сайт (Hosting по разнице, config, packUpdates)
```

Тестов нет. Проверка — руками в браузере (см. ниже) и разовыми node-скриптами в scratchpad.

## MCP сборки (`tfc-pack`)

Локальный MCP-сервер `scripts/mcp/` (stdio, подключён в `.mcp.json`; в worktree данные берёт из `public/` и `mods/`
основной копии). **Для игровых фактов и гайдов сначала он, а не grep** по `public/recipes.json` (7,7 МБ), `items.json`,
`tags.json` и не распаковка jar: ответы короткие, постраничные и уже учитывают KubeJS (удаления, replaceInput/Output,
рецепты скриптов, kubejs/data), вложенные теги и слои конфигов.
Полное описание (инструменты, откуда данные, лимиты, как добавить инструмент) — [docs/mcp.md](docs/mcp.md).

- Предметы и рецепты: `items_search`, `item_get`, `recipes_for` (как получить), `recipes_using` (где нужен, в т. ч.
  через теги), `recipe_get` (статус, какое правило KubeJS удаляет/меняет — файл:строка, JSON).
- Теги: `tag_members`, `tags_of`. Справочник: `reference_get` (руды, плавка, металлы, топливо, еда, ботаника, блюда,
  сковорода, мультиблоки, power). Настройки: `config_get` (мир > serverconfig > config > значение из кода; только чтение).
- Код модов: `jar_find` (путь, класс через точки, glob), `jar_read` (по строкам, grep), `jar_javap` (метод; jar можно не
  указывать). Вложенные jar-in-jar и Minecraft+NeoForge («minecraft») — тоже.
- Отладка сборки: `class_find`, `class_info` (сигнатуры, строки исходника для стека), `class_hierarchy`, `code_refs`
  (кто вызывает/использует — по байткоду, `Owner#method`, `"строка"`), `mixins` (на класс по методам, конфликты, мод,
  обзор), `decompile` (Vineflower; Minecraft — исходники), `jar_grep` (текст в файлах jar), `mods_check`
  (зависимости по правилам FML), `log_analyze` (лог/краш-репорт → моды, миксины, расшифровка ошибок).
  **Краш или «что сломалось» — начинай с `log_analyze`**, потом `class_info`/`decompile`/`mixins target=…`.
- Гайды: `guides_list`, `guide_search`, `guide_get` → правка → `guide_put` с `baseRevision` из `guide_get`
  (отказ, если статью изменили после чтения; подпись `Claude`, версия — в историю). Это запись в общую базу.
- Сборка: `mods_list`, `mod_get` (версия, предметы, рецепты по статусам), `pack_updates` (история обновлений).
- Исходники KubeJS: `kubejs_files`, `kubejs_search`, `kubejs_read` (с пометками, что разобрано как правило/рецепт/тег).
- Книги: `books_list`, `book_search`, `book_entry` — руководство TFC (со статьями аддонов и KubeJS) и справочник IE.
- Не предметы: `lang_search` (переводы всех jar — блоки, существа, жидкости, эффекты), `block_get`,
  `loot_for` (что выпадает), `loot_sources` (откуда выпадает предмет).
- Карта: `map_point` (блок ↔ широта/долгота, города, климат TFC), `map_rocks` (породы и жилы), `map_find` (место → блок).
- Контент сайта, только чтение: `tasks_list`/`task_get`, `datapacks_list`/`datapack_get`, `kubejs_site_list`/`kubejs_site_get`,
  `schematics_list`/`schematic_get` — тратят чтения Firestore (пишут сколько), не дёргай в цикле.
- Инструменты раздела — `scripts/mcp/tools/<раздел>.mjs` (`export const TOOLS`), общие помощники — `fmt.mjs`.
- grep и `unzip` — когда инструмента нет (сырьё, которого нет в данных сайта) или нужно проверить сам MCP.
  Данные MCP — это то, что собрали `npm run mods` / `kubejs`: устарели сборщики — устарел и ответ.
- После правки `scripts/mcp/` сервер нужно перезапустить (`/mcp` в Claude Code); данные `public/` он перечитывает сам.

## Проверка в браузере

- Сервер превью: конфигурация **`dev-alt`** (порт 5176) из `.claude/launch.json`. Порт 5173 часто занят другой сессией;
  если занят и 5176 — `dev-alt2` (5177). В git worktree без jar — **`dev-wt`** (5179, `TFC_KEEP_MODS=1`: данные модов
  из основной копии).
- Dev-сервер ходит в **боевой Firestore** (App Check debug-токен из `.env.local`). Тестовые записи в общих коллекциях
  не оставляй: либо удаляй за собой, либо проверяй логику без записи.
- В браузере превью ник — `ClaudeTest` (кука `tfc_nick`). Если пишешь данные от своего имени осознанно
  (датапак по просьбе пользователя) — подписывай ником `Claude`.
- Удобный приём: модули сайта доступны из страницы — `await import('/src/lib/recipes.ts')`. Так можно проверить логику
  на реальном каталоге или сделать действие тем же кодом, что и кнопка (создать датапак, приложить файл к задаче).
- Клик по координатам со скриншота иногда промахивается (масштаб) — надёжнее `find` + `ref` или `javascript_tool`.
- Локальный файл в страницу: временно положить в `public/__test.*`, `fetch` + `DataTransfer` в `input[type=file]`, потом удалить.

## Данные: что откуда берётся

Скрипты разложены **по источнику, который разбирают**, а не по разделам сайта: `scripts/mods.mjs` (+ части в
`scripts/mods/`) — папка `mods/`; `scripts/serverconfig.mjs` — конфиги (`config/`, `serverconfig/`); `scripts/kubejs.mjs` — папка `kubejs/`;
`scripts/world.mjs` — сохранение мира.
Новый раздел сайта = новая часть в `scripts/mods/`, а не отдельная команда. Старые `npm run items` / `config` — синонимы.

Сайт — статический SPA. Всё «знание о сборке» собирается локально скриптами и деплоится как статика из `public/`
(в git не хранится), живые данные — в Firestore.

| Источник (не в git)           | Скрипт                                               | Результат                                                                                                 |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `mods/*.jar`                  | `mods.mjs` (+ `reference`, `manifest`, `geo`, `tags`, `botany`, `meals`, `cuisine`, `power`, `multiblocks`) | `public/items.json`, `icons/`, `recipes.json`, `reference.json`, `pack-manifest.json`, `geo.json`, `geo/`, `tags.json`, `botany.json`, `meals.json`, `power.json`, `multiblocks.json`, `multiblocks/` |
| `instance/kubejs/<слой>/`     | `kubejs.mjs`                                         | `public/kubejs.json`, `kubejs-items.json`, `icons-kubejs/` (свои предметы сборки из startup_scripts + assets), `kubejs-data.json` (еда и сковорода из `kubejs/data` — сайт заменяет ими данные модов) |
| сохранение мира (`<мир>/data/`) | `world.mjs`                                        | Firestore `config/world__{файл}` — календарь TFC (длина месяца, заданная командой)                          |
| zip/папка конфигов сервера    | `serverconfig.mjs`                                  | Firestore `config/{scope}__{путь}`                                                                        |
| разница манифестов при деплое | `pack-release.mjs` (predeploy)                       | Firestore `packUpdates/{id}`                                                                              |

- Разборщики — библиотека: папки входа, выхода (вместо `public/`) и кеша передаются параметрами (`buildMods`,
  `buildKubejs`, `configDocs`, `worldDocs`, `packRelease`, `runPack`); пути от корня репозитория — только значения
  по умолчанию для `npm run …`. Новые пути в разборщиках — тоже параметром, не `ROOT`.
- Запись в Firestore из скриптов — REST от имени `firebase login` или сервисного ключа (`GOOGLE_APPLICATION_CREDENTIALS`)
  (`scripts/firestore-rest.mjs`), правила на неё не действуют.
  Этим же способом удобно читать базу из node, когда нужно найти задачу или датапак.
- `src/lib/recipeFilter.ts`, `recipeRefs.ts`, `nbt.ts`, `datapackFiles.ts`, `addons.ts` и `schematicFile.ts` (импортирует только `./nbt.ts` —
  с расширением) — **без импортов, только стираемый синтаксис TS**: их запускает и сайт, и Node
  (`import '../src/lib/x.ts'` из `.mjs`, Node 24). В `tsconfig` включён `erasableSyntaxOnly` — никаких enum и parameter properties.
- То, что мод задаёт кодом (перечисления, константы), читай скриптом через `scripts/mods/classfile.mjs`, а не вписывай руками:
  данные сайта должны пересобираться из jar текущей сборки. Пример — `scripts/mods/botany.mjs`.
- `kubejs/data` — датапак: он переопределяет не только рецепты, но и данные (`tfc/food` и т. п.). Что сайт показывает
  из данных модов, должно иметь слияние с `kubejs-data.json` или хотя бы предупреждение в `kubejs.mjs` (`MOD_ONLY_DATA`).
- При изменении формата кеша jar поднимай маркер `.done-vN` в `mods.mjs`, иначе старый кеш не пересоберётся.

## Firestore

`tasks`, `groups`, `artifacts`, `files` (+`chunks`, пакет `firestore-files`), `datapacks`, `kubejsScripts`, `schematics`, `recipeHints`, `guides` (+`revisions`),
`packUpdates`, `settings/world`, `config`, `onboarding/{uid}` (какие подсказки знакомства показаны). Поля — в README, «Модель данных».

- Авторизации нет: анонимный вход + ник в куке. Правила проверяют форму данных и `nick(...)`, а не владельца.
- `config` и создание `packUpdates` закрыты для сайта — пишут только скрипты.
- Блок `files` в `firestore.rules` генерируется: `npm run rules:files`, руками между маркерами не править.
- Общий CRUD — `src/data/store.ts` (`make<T, N>('коллекция')`), есть запасной режим на localStorage без Firebase.

## Карта кода

```
src/pages/        TasksPage (+ раздел документов DocsSection), DocPage, FilesPage, SchematicsPage, AddonsPage (AddonsTab),
                  DatapacksPage/RecipesPage/TagsPage (один раздел, слева PackNav), ReferencePage (вкладки «Гайды» — GuidesTab, «Карта» — MapPage,
                  «Мультиблоки» — MultiblocksTab), UpdatesPage
src/components/   Onboarding (подсказки при первом входе в раздел, тексты — lib/onboarding.ts), Modal, ItemPicker/ItemIcon, FileBadge (значок вида файла + имя; виды — lib/fileKinds.ts), RecipeCatalog (RecipeBrowser), KubejsConstructor, SchematicLibrary, WorldMap, …
src/lib/
  items.ts fuzzy.ts            библиотека предметов, поиск (fuse.js — только подбор замен в схемах)
  recipes.ts recipeFilter.ts   каталог рецептов + KubeJS: статусы, фильтры
  recipeRefs.ts kubejsFix.ts   входы/выходы рецепта; конструктор обхода удалений KubeJS
  tags.ts                      теги: слияние источников и KubeJS, поиск, файл правки датапака (UI — TagEditor)
  datapack.ts datapackFiles.ts записи датапака, zip, проверки; файлы датапака (общие с Node)
  kubejsScripts.ts             скрипты KubeJS на сайте (коллекция kubejsScripts, UI — components/KubejsScripts)
  nbt.ts schematic.ts materials.ts schematicLibrary.ts   схемы .nbt: замена/удаление блоков, материалы, библиотека;
  schematicFile.ts             файл схемы с заменами и формой (общий с Node; подбор замен — в schematic.ts)
  reference.ts meals.ts        справочник (руды, топливо, жидкое топливо, еда, металлы); сборные блюда и калькуляторы
  multiblocks.ts               мультиблоки IE: шаблоны, замены по тегам-заменителям (UI — MultiblocksTab, CSS 3D)
  power.ts                     электричество: Create SU ↔ Electro Energetics (В/А/Вт) ↔ IE FE/t, формулы из кода (UI — PowerTab)
  calcExpr.ts guideFormat.ts   формулы гайдов (свой разборщик, без eval и импортов) и формат чисел {{x | 1 В}}
  guideScope.ts powerGuideScope.ts   имена для формул: общие функции + раздел (настройки, power.json, формулы power.ts)
  projection.ts geo.ts atlas.ts config.ts   карта TFC Real World, настройки мира из конфига сервера
  packUpdates.ts gemini.ts     обновления сборки, запросы к Gemini (цепочки моделей с запасными, таймаут 90 с)
  files.ts files.config.ts     вложения: обёртка над fileStorage/ (интерфейс; Firestore или свой сервер — VITE_FILES_SERVER)
src/components/guides/  гайды справочника: GuidesSection (карточки, статья), GuideEditor/History/Help, CalcBlock (```calc),
                  GuideBody (Markdown + {{…}} + виджеты «::имя»), powerWidgets — рисунки раздела; формат — docs/plans/guides.md
server/file-server/  сервер файлов для Ubuntu (Node без зависимостей); переезд — scripts/files-migrate.mjs
server/pack-server/  сервер сборки (снимки, ключи); стоит на VPS — docs/pack-server.md
cli/              программа tfc для ПК (npm run tfc -- …): sync/publish сборки; инструкция — docs/tfc-app.md, cli/README.md
tools/            аддоны сборки — docs/addons.md; на сайте — lib/addons.ts, AddonsTab; для tfc — /addons/index.json (scripts/addons-index.mjs)
scripts/mcp/      MCP сборки для агента (stdio): data.mjs — слияние данных как на сайте, jars.mjs, firestore.mjs, tools.mjs
scripts/          mods.mjs + mods/{reference,tags,botany,meals,cuisine,power,multiblocks,geo,manifest,classfile,config-defaults}.mjs, serverconfig.mjs,
                  kubejs.mjs, pack-release.mjs, pack.mjs (вся папка сборки); firestore-rest.mjs — общий доступ к Firestore
docs/plans/       планы фич со статусами; docs/STATE.md — текущее состояние
```

## Грабли, на которые уже наступали

- Одинаковые русские названия у предметов разных модов («Медный люк» в TFC и в ванили) — показывай мод/id.
- Библиотека предметов — это **предметы**, не блоки и без составов тегов. Фильтр KubeJS `output: 'x'` сопоставляется
  только с явным `x` в рецепте.
- KubeJS удаляет рецепты из датапаков (включая наши), но не трогает добавленные скриптом — проверено по байткоду.
  `replaceInput({mod: 'electroenergetics'})` применяется к рецептам с id в этом namespace.
- Мир сервера: `horizontal_scale = 100000`, `vertical_scale = 50000` (не значения мода по умолчанию), ~200 м/блок.
- Gemini на бесплатном тарифе: лимит — запросы в минуту; большие задачи пакуй в один запрос, не дроби.
- Firestore на бесплатном тарифе: 50 тыс. чтений в сутки. Тяжёлое (иконки, карты, каталоги) — только статикой.
- Скрытая панель браузера замораживает страницу — долгие операции в ней выглядят как зависание.
- `predeploy` хостинга запускает `pack-release.mjs`; пропустить: `SKIP_PACK_RELEASE=1`.
- Деплой из git worktree: jar, `.env.local` и данные `public/` в git не хранятся. Без jar сборка собирала каталог
  из одной ванили и TFC, а `pack-release` писал «убраны все моды» (дважды 2026-10-19). Теперь так:
  - данные модов не менялись (правка сайта) — **`npm run deploy:site`** (`TFC_KEEP_MODS=1`): готовые данные модов
    берутся из `public/` основной копии, jar не нужны;
  - данные модов менялись (`scripts/mods/…`) — сначала `ln -s /Users/ivan/vscodeProjects/tfc-taskmanager/mods/*.jar mods/`,
    потом обычный деплой.
  - jar нет, а в `.env.local` есть `TFC_PACK_URL` / `TFC_PACK_TOKEN` — данные модов текущего снимка сборка сайта
    берёт с сервера сборки (только изменённые файлы).
  Остальное (`.env.local`, аддоны, ресурспаки, разбор KubeJS) сборка в worktree сама берёт из основной копии.
  Без jar и без флага сборка останавливается; `pack-release` — при 0 модов или потере больше половины
  (обход — `TFC_ALLOW_NO_MODS=1` и `ALLOW_MODS_DROP=1`, только если моды правда убраны); `predeploy-check` — если
  сайт собран без настроек Firebase.
- Гайды хранятся только в Firestore. Правишь статью — сначала `npm run guides -- pull`, потом `push` (иначе затрёшь
  правку игрока; старая версия останется в истории). В YAML калькулятора короткая запись `{ … }` режет значения по
  запятым: формулу с запятой — в кавычки или отдельной строкой (калькулятор покажет «неизвестное поле»).
