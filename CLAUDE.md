# TFC Планы — памятка агенту

Сайт-планировщик для группы, играющей в сборку TerraFirmaCraft RealWorld (Minecraft 1.21.1, NeoForge):
задачи, документы, схемы Create, датапаки, рецепты, справочник, карта мира, обновления сборки.

- Сайт: https://tfc-plans-fd2c.web.app · репозиторий: https://github.com/Jason1258t/tfc-plans
- Firebase-проект `tfc-plans-fd2c`: Firestore (eur3), анонимный вход, App Check (reCAPTCHA Enterprise), AI Logic (Gemini)
- Что уже сделано и что висит — в [docs/STATE.md](docs/STATE.md). **Обновляй его в конце работы**, если состояние изменилось.
- Устройство и инструкции для людей — в [README.md](README.md); планы крупных фич — в `docs/plans/`.
- Свои моды сборки (аддоны) — `tools/<мод>-mod/`; как их собирать и проверять без игры — [docs/addons.md](docs/addons.md).

## Как работаем

- Общение и весь текст интерфейса, комментарии в коде, сообщения коммитов — **по-русски**.
- Задача считается законченной, когда она **проверена, задеплоена и запушена** — пользователь обычно просит именно так
  («пусти в деплой по готовности»). Порядок: проверка → `firebase deploy` → коммит в `main` → `git push`.
- Ветка одна — `main`, PR не используются. Сообщение коммита: «Раздел: что сделано», одной строкой.
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
npx firebase deploy --only firestore:rules
npm run mods          # пересобрать библиотеку из mods/ (долго, кеш в .cache/)
npm run serverconfig -- <zip|папка>                # конфиги сервера → Firestore config
npm run kubejs -- <zip|папка> [--layer world]  # скрипты KubeJS → public/kubejs.json, свои предметы → kubejs-items.json
npm run world -- <мир|world/data|tfc_calendar.dat|zip>  # сохранение мира → Firestore config (scope world)
npm run guides -- pull <папка> | push <файл.md|папка>   # гайды справочника ↔ файлы Markdown (подпись — TFC_NICK)
```

Тестов нет. Проверка — руками в браузере (см. ниже) и разовыми node-скриптами в scratchpad.

## Проверка в браузере

- Сервер превью: конфигурация **`dev-alt`** (порт 5176) из `.claude/launch.json`. Порт 5173 часто занят другой сессией;
  если занят и 5176 — `dev-alt2` (5177).
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
| `mods/*.jar`                  | `mods.mjs` (+ `reference`, `manifest`, `geo`, `tags`, `botany`, `meals`, `cuisine`, `power`) | `public/items.json`, `icons/`, `recipes.json`, `reference.json`, `pack-manifest.json`, `geo.json`, `geo/`, `tags.json`, `botany.json`, `meals.json`, `power.json` |
| `instance/kubejs/<слой>/`     | `kubejs.mjs`                                         | `public/kubejs.json`, `kubejs-items.json`, `icons-kubejs/` (свои предметы сборки из startup_scripts + assets), `kubejs-data.json` (еда и сковорода из `kubejs/data` — сайт заменяет ими данные модов) |
| сохранение мира (`<мир>/data/`) | `world.mjs`                                        | Firestore `config/world__{файл}` — календарь TFC (длина месяца, заданная командой)                          |
| zip/папка конфигов сервера    | `serverconfig.mjs`                                  | Firestore `config/{scope}__{путь}`                                                                        |
| разница манифестов при деплое | `pack-release.mjs` (predeploy)                       | Firestore `packUpdates/{id}`                                                                              |

- Запись в Firestore из скриптов — REST от имени `firebase login` (`scripts/firestore-rest.mjs`), правила на неё не действуют.
  Этим же способом удобно читать базу из node, когда нужно найти задачу или датапак.
- `src/lib/recipeFilter.ts` и `recipeRefs.ts` — **без импортов, только стираемый синтаксис TS**: их запускает и сайт, и Node
  (`import '../src/lib/x.ts'` из `.mjs`, Node 24). В `tsconfig` включён `erasableSyntaxOnly` — никаких enum и parameter properties.
- То, что мод задаёт кодом (перечисления, константы), читай скриптом через `scripts/mods/classfile.mjs`, а не вписывай руками:
  данные сайта должны пересобираться из jar текущей сборки. Пример — `scripts/mods/botany.mjs`.
- `kubejs/data` — датапак: он переопределяет не только рецепты, но и данные (`tfc/food` и т. п.). Что сайт показывает
  из данных модов, должно иметь слияние с `kubejs-data.json` или хотя бы предупреждение в `kubejs.mjs` (`MOD_ONLY_DATA`).
- При изменении формата кеша jar поднимай маркер `.done-vN` в `mods.mjs`, иначе старый кеш не пересоберётся.

## Firestore

`tasks`, `groups`, `artifacts`, `files` (+`chunks`, пакет `firestore-files`), `datapacks`, `schematics`, `recipeHints`, `guides` (+`revisions`),
`packUpdates`, `settings/world`, `config`. Поля — в README, «Модель данных».

- Авторизации нет: анонимный вход + ник в куке. Правила проверяют форму данных и `nick(...)`, а не владельца.
- `config` и создание `packUpdates` закрыты для сайта — пишут только скрипты.
- Блок `files` в `firestore.rules` генерируется: `npm run rules:files`, руками между маркерами не править.
- Общий CRUD — `src/data/store.ts` (`make<T, N>('коллекция')`), есть запасной режим на localStorage без Firebase.

## Карта кода

```
src/pages/        TasksPage (+ раздел документов DocsSection), DocPage, FilesPage, SchematicsPage, AddonsPage (AddonsTab),
                  DatapacksPage/RecipesPage/TagsPage (один раздел, слева PackNav), ReferencePage (вкладки «Гайды» — GuidesTab, «Карта» — MapPage), UpdatesPage
src/components/   Modal, ItemPicker/ItemIcon, FileBadge (значок вида файла + имя; виды — lib/fileKinds.ts), RecipeCatalog (RecipeBrowser), KubejsConstructor, SchematicLibrary, WorldMap, …
src/lib/
  items.ts fuzzy.ts            библиотека предметов, поиск (fuse.js — только подбор замен в схемах)
  recipes.ts recipeFilter.ts   каталог рецептов + KubeJS: статусы, фильтры
  recipeRefs.ts kubejsFix.ts   входы/выходы рецепта; конструктор обхода удалений KubeJS
  tags.ts                      теги: слияние источников и KubeJS, поиск, файл правки датапака (UI — TagEditor)
  datapack.ts                  записи датапака, zip, проверки
  nbt.ts schematic.ts materials.ts schematicLibrary.ts   схемы .nbt: замена/удаление блоков, материалы, библиотека
  reference.ts meals.ts        справочник (руды, топливо, жидкое топливо, еда, металлы); сборные блюда и калькуляторы
  power.ts                     электричество: Create SU ↔ Electro Energetics (В/А/Вт) ↔ IE FE/t, формулы из кода (UI — PowerTab)
  calcExpr.ts guideFormat.ts   формулы гайдов (свой разборщик, без eval и импортов) и формат чисел {{x | 1 В}}
  guideScope.ts powerGuideScope.ts   имена для формул: общие функции + раздел (настройки, power.json, формулы power.ts)
  projection.ts geo.ts atlas.ts config.ts   карта TFC Real World, настройки мира из конфига сервера
  packUpdates.ts gemini.ts     обновления сборки, запросы к Gemini (цепочки моделей с запасными, таймаут 90 с)
  files.ts files.config.ts     вложения через firestore-files
src/components/guides/  гайды справочника: GuidesSection (карточки, статья), GuideEditor/History/Help, CalcBlock (```calc),
                  GuideBody (Markdown + {{…}} + виджеты «::имя»), powerWidgets — рисунки раздела; формат — docs/plans/guides.md
tools/            аддоны сборки (ee-rectifier-mod, ee-overheat-mod) — docs/addons.md; на сайте — lib/addons.ts, AddonsTab
scripts/          mods.mjs + mods/{reference,tags,botany,meals,cuisine,power,geo,manifest,classfile,config-defaults}.mjs, serverconfig.mjs,
                  kubejs.mjs, pack-release.mjs; firestore-rest.mjs — общий доступ к Firestore
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
- Гайды хранятся только в Firestore. Правишь статью — сначала `npm run guides -- pull`, потом `push` (иначе затрёшь
  правку игрока; старая версия останется в истории). В YAML калькулятора короткая запись `{ … }` режет значения по
  запятым: формулу с запятой — в кавычки или отдельной строкой (калькулятор покажет «неизвестное поле»).
