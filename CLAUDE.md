# TFC Планы — памятка агенту

Сайт-планировщик для группы, играющей в сборку TerraFirmaCraft RealWorld (Minecraft 1.21.1, NeoForge):
задачи, документы, схемы Create, датапаки, рецепты, справочник, карта мира, обновления сборки.

- Сайт: https://tfc-plans-fd2c.web.app · репозиторий: https://github.com/Jason1258t/tfc-plans
- Firebase-проект `tfc-plans-fd2c`: Firestore (eur3), анонимный вход, App Check (reCAPTCHA Enterprise), AI Logic (Gemini)
- Что уже сделано и что висит — в [docs/STATE.md](docs/STATE.md). **Обновляй его в конце работы**, если состояние изменилось.
- Устройство и инструкции для людей — в [README.md](README.md); планы крупных фич — в `docs/plans/`.

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
npm run dev            # Vite; перед стартом сам дособерёт библиотеку (scripts/ensure-items.mjs)
npx tsc -b             # типы (в build входит)
npx oxlint src scripts # линтер; предупреждения set-state-in-effect и only-export-components — старые, не чинить попутно
npx prettier --write <файлы>   # singleQuote, printWidth 120; не запускай на весь src без нужды — шум в диффе
npx firebase deploy --only hosting           # сборка + pack-release + выкладка
npx firebase deploy --only firestore:rules
npm run items          # пересобрать библиотеку из mods/ (долго, кеш в .cache/)
npm run config -- <zip|папка>                # конфиги сервера → Firestore config
npm run kubejs -- <zip|папка> [--layer world]  # скрипты KubeJS → public/kubejs.json
```

Тестов нет. Проверка — руками в браузере (см. ниже) и разовыми node-скриптами в scratchpad.

## Проверка в браузере

- Сервер превью: конфигурация **`dev-alt`** (порт 5176) из `.claude/launch.json`. Порт 5173 часто занят другой сессией.
- Dev-сервер ходит в **боевой Firestore** (App Check debug-токен из `.env.local`). Тестовые записи в общих коллекциях
  не оставляй: либо удаляй за собой, либо проверяй логику без записи.
- В браузере превью ник — `ClaudeTest` (кука `tfc_nick`). Если пишешь данные от своего имени осознанно
  (датапак по просьбе пользователя) — подписывай ником `Claude`.
- Удобный приём: модули сайта доступны из страницы — `await import('/src/lib/recipes.ts')`. Так можно проверить логику
  на реальном каталоге или сделать действие тем же кодом, что и кнопка (создать датапак, приложить файл к задаче).
- Клик по координатам со скриншота иногда промахивается (масштаб) — надёжнее `find` + `ref` или `javascript_tool`.
- Локальный файл в страницу: временно положить в `public/__test.*`, `fetch` + `DataTransfer` в `input[type=file]`, потом удалить.

## Данные: что откуда берётся

Сайт — статический SPA. Всё «знание о сборке» собирается локально скриптами и деплоится как статика из `public/`
(в git не хранится), живые данные — в Firestore.

| Источник (не в git)           | Скрипт                                               | Результат                                                                                                 |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `mods/*.jar`                  | `build-items.mjs` (+ `reference`, `manifest`, `geo`) | `public/items.json`, `icons/`, `recipes.json`, `reference.json`, `pack-manifest.json`, `geo.json`, `geo/` |
| `instance/kubejs/<слой>/`     | `kubejs.mjs`                                         | `public/kubejs.json`                                                                                      |
| zip/папка конфигов сервера    | `import-config.mjs`                                  | Firestore `config/{scope}__{путь}`                                                                        |
| разница манифестов при деплое | `pack-release.mjs` (predeploy)                       | Firestore `packUpdates/{id}`                                                                              |

- Запись в Firestore из скриптов — REST от имени `firebase login` (`scripts/firestore-rest.mjs`), правила на неё не действуют.
  Этим же способом удобно читать базу из node, когда нужно найти задачу или датапак.
- `src/lib/recipeFilter.ts` и `recipeRefs.ts` — **без импортов, только стираемый синтаксис TS**: их запускает и сайт, и Node
  (`import '../src/lib/x.ts'` из `.mjs`, Node 24). В `tsconfig` включён `erasableSyntaxOnly` — никаких enum и parameter properties.
- При изменении формата кеша jar поднимай маркер `.done-vN` в `build-items.mjs`, иначе старый кеш не пересоберётся.

## Firestore

`tasks`, `groups`, `artifacts`, `files` (+`chunks`, пакет `firestore-files`), `datapacks`, `schematics`, `recipeHints`,
`packUpdates`, `settings/world`, `config`. Поля — в README, «Модель данных».

- Авторизации нет: анонимный вход + ник в куке. Правила проверяют форму данных и `nick(...)`, а не владельца.
- `config` и создание `packUpdates` закрыты для сайта — пишут только скрипты.
- Блок `files` в `firestore.rules` генерируется: `npm run rules:files`, руками между маркерами не править.
- Общий CRUD — `src/data/store.ts` (`make<T, N>('коллекция')`), есть запасной режим на localStorage без Firebase.

## Карта кода

```
src/pages/        TasksPage, DocsPage/DocPage, SchematicsPage, DatapacksPage, RecipesPage, ReferencePage, UpdatesPage, MapPage
src/components/   Modal, ItemPicker/ItemIcon, RecipeCatalog (RecipeBrowser), KubejsConstructor, SchematicLibrary, WorldMap, …
src/lib/
  items.ts fuzzy.ts            библиотека предметов, поиск (fuse.js — только подбор замен в схемах)
  recipes.ts recipeFilter.ts   каталог рецептов + KubeJS: статусы, фильтры
  recipeRefs.ts kubejsFix.ts   входы/выходы рецепта; конструктор обхода удалений KubeJS
  datapack.ts                  записи датапака, zip, проверки
  nbt.ts schematic.ts materials.ts schematicLibrary.ts   схемы .nbt: замена/удаление блоков, материалы, библиотека
  reference.ts                 справочник (руды, топливо, жидкое топливо, еда, металлы)
  projection.ts geo.ts atlas.ts config.ts   карта TFC Real World, настройки мира из конфига сервера
  packUpdates.ts gemini.ts     обновления сборки, запросы к Gemini (цепочки моделей с запасными, таймаут 90 с)
  files.ts files.config.ts     вложения через firestore-files
scripts/          сборщики (см. таблицу выше), firestore-rest.mjs — общий доступ к Firestore
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
