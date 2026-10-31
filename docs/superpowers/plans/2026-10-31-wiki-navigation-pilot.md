# Wiki Navigation Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Сделать главную TFC Studio с плитками, перенести рабочий адрес задач на `/tasks` без потери старых ссылок и собрать первый смысловой раздел справочника «Мир и ресурсы».

**Architecture:** Существующие страницы и вкладки остаются без изменений. Новые маршруты и редиректы находятся в `app/App.tsx`; главная — отдельный page slice; «Мир и ресурсы» использует существующие `OresTab`, `GeologyTab`, `MapPage` и `SectionShell`.

**Tech Stack:** React 19, TypeScript, React Router 7, CSS Modules, lucide-react, Vite.

## Global Constraints

- Работа только в `.claude/worktrees/wiki-navigation`, ветка `feat/wiki-navigation`.
- Не менять содержимое гайдов, игровые данные, токены темы и `src/entities/schematic/ui/SchematicView3D/`.
- Сохранить все существующие URL и query-параметры; редиректы выполняются с `replace`.
- UI и комментарии — на русском; новые стили используют существующие токены #178.
- Полная перекомпоновка справочника и гайдов не входит в пилот; после подтверждения рецепты, предметы и теги становятся справочными разделами, без перестройки вкладок других страниц.

---

### Task 1: Главная и совместимый адрес задач

**Files:**

- Create: `src/pages/home/index.ts`
- Create: `src/pages/home/HomePage.tsx`
- Create: `src/pages/home/HomePage.module.css`
- Modify: `src/app/App.tsx`
- Modify: `src/widgets/header/Header/Header.tsx`

**Interfaces:**

- Produces: `HomePage` как публичный экспорт `@/pages/home`.
- Produces: `/` без query → главная; `/` с query → `/tasks` с тем же query; `/tasks` → существующий `TasksPage`.
- Consumes: существующие `Header`, `TasksPage`, `Search` и токены темы.

- [x] **Step 1: Создать статический навигационный указатель главной**

Каждая запись содержит `to`, `title`, `description`, `icon`, `group` и `keywords`. Основные адреса: `/reference?tab=world`, `/reference?tab=guides`, `/reference?tab=world&sub=map`, `/addons`, `/tasks`, `/schematics`, `/datapacks`, `/docs`. Вторичные: `/builder`, `/updates`, `/dev`.

- [x] **Step 2: Создать главную с поиском по указателю**

`HomePage` хранит query в локальном state, нормализует `ё` → `е`, фильтрует по названию, описанию и ключевым словам. Поле имеет `aria-label="Поиск по разделам"`; Enter переводит на первый результат через `useNavigate`. Результаты остаются настоящими `Link`, сгруппированными по `group`; пустой результат показывает «Раздел не найден».

- [x] **Step 3: Добавить спокойные адаптивные стили**

CSS Module использует `--surface`, `--surface-2`, `--border`, `--border-strong`, `--text-*`, `--accent-soft`, `--radius`. Сетка: `repeat(3, minmax(0, 1fr))`, от 900 px две колонки, от 600 px одна. Карточка — целая ссылка без тени.

- [x] **Step 4: Подключить маршруты**

В `App.tsx` добавить `RootPage`: пустой `location.search` возвращает `<HomePage />`, непустой — `<Navigate to={`/tasks${search}`} replace />`. Добавить `/tasks` с `TasksPage`; `/` использует `RootPage`.

- [x] **Step 5: Обновить активный раздел шапки**

Ссылка бренда получает `end`; «Задачи» ведёт на `/tasks`. Остальные пункты и поиск id предмета не меняются.

- [x] **Step 6: Проверить типы**

Run: `npx tsc -b`  
Expected: exit 0, без ошибок в новых файлах и маршрутах.

### Task 2: Прямые внутренние ссылки на задачи

**Files:**

- Modify: `src/pages/map/MapPage/MapPage.tsx`
- Modify: `src/pages/doc/DocPage.tsx`
- Modify: `src/pages/datapacks/ui/AttachDialog.tsx`
- Modify: `src/pages/files/FilesPage.tsx`
- Modify: `src/pages/dev/ui/ReportList.tsx`

**Interfaces:**

- Consumes: `/tasks?task=…`, `/tasks?doc=…`, `/tasks?view=docs…` из Task 1.
- Produces: новые внутренние переходы без промежуточного редиректа; внешние старые ссылки продолжает поддерживать Task 1.

- [x] **Step 1: Заменить только генерируемые приложением адреса**

Заменить `/?task=` → `/tasks?task=`, `/?doc=` → `/tasks?doc=`. Не менять чтение параметров и поведение окон.

- [x] **Step 2: Проверить отсутствие старых генераторов**

Run: поиск `/?task=` и `/?doc=` в `src`.  
Expected: совпадений в TS/TSX нет; внешняя совместимость обеспечивается `RootPage`.

- [x] **Step 3: Проверить типы**

Run: `npx tsc -b`  
Expected: exit 0.

### Task 3: Раздел «Мир и ресурсы»

**Files:**

- Modify: `src/pages/reference/ReferencePage/ReferencePage.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**

- Produces: `/reference?tab=world&sub=ores|geology|map`; без `sub` открываются руды.
- Consumes: существующие `OresTab`, `GeologyTab`, `MapPage`, `SectionShell`, `useReference`, `useItems`.
- Compatibility: `tab=ores`, `tab=geology`, `tab=map`, `?rock=`, `/map?…` сохраняют остальные query-параметры.

- [x] **Step 1: Добавить канонизацию старых адресов**

В `ReferencePage` до рендера `Reference` преобразовать `ores|geology|map` в `tab=world&sub=<старое>`. Для `?rock=` без `tab` установить `tab=world&sub=ores`. Создавать новый `URLSearchParams`, удалять старое `tab`, устанавливать новые `tab/sub`, использовать `<Navigate replace />`.

- [x] **Step 2: Добавить `world` в тип и верхние вкладки**

`Tab` начинается с `world`; `TABS` начинается с `{ id: 'world', label: 'Мир и ресурсы' }`. Убрать из верхнего списка `ores`, `geology`, `map`. Значение по умолчанию — `world`; переключатель верхних вкладок сохраняет `tab` явно.

- [x] **Step 3: Собрать подразделы через `SectionShell`**

Добавить `worldSub` со значениями `ores|geology|map`. Кнопки: «Руды», «Геология», «Карта мира», каждая с `aria-pressed`. При выборе записывать `tab=world` и соответствующий `sub`, не перенося чужие параметры.

В содержимом вызвать прежние компоненты:

- `ores`: `OresTab key={rock} initialRock={rock}`;
- `geology`: `GeologyTab veins={ref.veins} items={items}`;
- `map`: `MapPage` без ожидания `useReference`.

- [x] **Step 4: Сохранить широкий режим карты**

`pageWide` применяется при `tab === 'world' && worldSub === 'map'`. Прежние ветки `map`, `ores`, `geology` удалить из общего conditional после переноса, не меняя сами компоненты.

- [x] **Step 5: Канонизировать `/map`**

`MapRedirect` устанавливает `tab=world`, `sub=map`, сохраняет `x`, `z`, `bx`, `bz` и другие параметры.

- [x] **Step 6: Проверить типы**

Run: `npx tsc -b`  
Expected: exit 0.

### Task 4: Браузерная проверка и сценарии снимков

**Files:**

- Modify: `scripts/ui/scenarios.json`
- Update only at closeout: `docs/state/site.md`

**Interfaces:**

- Consumes: все маршруты Tasks 1–3.
- Produces: воспроизводимые screenshot-сценарии главной, задач и «Мира и ресурсов».

- [x] **Step 1: Обновить адреса сценариев задач**

Все сценарии `tasks.*` перевести с `/` на `/tasks`; добавить `home`, `home.dark`, `reference.world`, `reference.world.dark` и `reference.world-map`. Не менять действия существующих сценариев.

- [x] **Step 2: Запустить отдельный dev-сервер**

Run: `npm run dev -- --port 5176 --strictPort`; если порт занят, использовать 5177.  
Expected: Vite сообщает выбранный локальный адрес; сервер остановить перед завершением/ship.

- [x] **Step 3: Проверить desktop и mobile в обеих темах**

Проверить `/`, `/tasks`, `/reference?tab=world`, `sub=geology`, `sub=map`. Убедиться в отсутствии наложений и горизонтального переполнения, проверить активные состояния, видимый фокус, Enter в поиске, Tab по карточкам и кнопку «Назад».

- [x] **Step 4: Проверить старые ссылки**

Открыть `/?view=docs`, `/?task=<существующий id>`, `/reference?tab=ores&rock=<id>`, `/reference?tab=geology`, `/reference?tab=map&x=0&z=0`, `/map?x=0&z=0`, `/reference?tab=food&sub=meals&q=…`, `/reference?tab=guides&g=…`, `/addons` и `/addons/:id`.  
Expected: прежний контент и параметры сохранены, редиректы не зацикливаются.

- [x] **Step 5: Выполнить проверки пилота**

Run: `npx prettier --write <изменённые файлы>`, `npm run lint`, `npx tsc -b`, `npm run boundaries`, `npm run ui:boundaries`, `npm run build`.  
Expected: все команды exit 0; существующие предупреждения lint не исправлять вне задачи.

- [ ] **Step 6: Остановиться для подтверждения**

Показать пользователю пилот и спецификацию. Не переносить остальные категории и не создавать `/guides` до явного подтверждения. Production deploy и закрытие #179 на этом этапе не выполнять.
