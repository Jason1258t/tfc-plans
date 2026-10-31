# TFC Studio Calm Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Развернуть подтверждённый пилот спокойной темы на весь сайт, убрать декоративный неон и лишние контуры, сохранить сетку, поведение и 3D-редактор.

**Architecture:** Пилотные токены уже являются единым источником палитры. Оставшаяся работа выполняется в CSS Modules и глобальных стилях темы: сначала семантические токены и общие компоненты, затем страницы небольшими группами с визуальной проверкой после каждой. Компоненты, маршруты и данные не меняются.

**Tech Stack:** CSS Modules, глобальный CSS, React/TypeScript без изменения логики, Vite, существующий `scripts/ui/shots.mjs` с headless Chrome.

## Global Constraints

- Работа выполняется только в `.claude/worktrees/tfc-studio-calm-theme`, ветка `feat/tfc-studio-calm-theme`.
- Палитра и значения контраста берутся из `docs/superpowers/specs/2026-10-31-tfc-studio-calm-theme-design.md`; новые HEX без повторного расчёта контраста не вводить.
- Основные действия — `var(--accent)`; успех — только `var(--success)` и `var(--success-soft)`; информация и ссылки — `var(--diamond)`; фокус — `var(--focus)`.
- Статические карточки не получают рамки и тени. Рамки сохраняются у полей, кнопок и интерактивных контролов; тени — только у слоёв над содержимым.
- Не менять сетку, отступы страниц, размеры контролов, маршруты, логотип, DOM и поведение.
- Не изменять `src/entities/schematic/ui/SchematicView3D/`, игровые иконки, текстуры, карту и содержимое схем.
- Не реализовывать главную с плитками, перекомпоновку справочника или вкладки гайдов: это отдельная задача #179.
- Новых функций и зависимостей нет. Для CSS используется визуальная проверка; unit-TDD здесь неприменим, пилот как визуальный прототип уже подтверждён пользователем.
- Перед каждым коммитом: `npx prettier --write <изменённые файлы>`, `git diff --check`, `npm run lint`; ожидается `0 errors`, существующие 30 warnings не исправлять в этой работе.

## File Map

- `src/app/theme/` — глобальные токены, фокус, утилиты, Markdown и legacy-совместимость.
- `src/shared/ui/`, `src/components/`, `src/shared/pack-data/` — повторяемые поверхности, поля, статусы и индикаторы.
- `src/pages/`, `src/widgets/`, `src/features/`, `src/entities/block-structure/` — точечное удаление локальных рамок, теней, градиентов и неверной семантики цвета.
- `src/entities/schematic/ui/SchematicView3D/` — запрещённая к изменению область.
- `docs/state/site.md` — короткая запись о завершённой теме после проверки.

---

### Task 1: Семантика общих компонентов

**Files:**

- Modify: `src/app/theme/utilities.css`
- Modify: `src/app/theme/markdown.css`
- Modify: `src/shared/ui/Field.module.css`
- Modify: `src/shared/ui/Content.module.css`
- Modify: `src/shared/ui/Progress/Progress.module.css`
- Modify: `src/shared/ui/Button/Button.module.css`
- Modify: `src/shared/pack-data/RecipeStatusBadge/RecipeStatusBadge.module.css`
- Modify: `src/components/SyncBadge/SyncBadge.module.css`
- Modify: `src/components/LiveMarkdown/LiveMarkdown.module.css`

**Interfaces:**

- Consumes: готовые `--accent`, `--success`, `--danger`, `--diamond`, `--focus` и поверхности из `tokens.css`.
- Produces: общие CSS-правила, которые остальные задачи используют без локальных дублирований.

- [ ] **Step 1: Зафиксировать красные примеры до изменения**

Выполнить:

```bash
node - <<'NODE'
const fs = require('node:fs');
const checks = [
  ['src/shared/pack-data/RecipeStatusBadge/RecipeStatusBadge.module.css', /color:\s*var\(--accent\)/],
  ['src/app/theme/utilities.css', /var\(--accent\)/],
];
for (const [file, pattern] of checks) {
  if (pattern.test(fs.readFileSync(file, 'utf8'))) console.log(`Нужна семантическая проверка: ${file}`);
}
NODE
```

Ожидается список мест, где нынешний `--accent` мог означать успех. Проверить каждое по имени класса и компоненту, а не заменять все вхождения подряд.

- [ ] **Step 2: Применить общие правила**

Использовать следующие конкретные правила:

```css
/* Успешные статусы */
.statusOk,
.recipeStatusOk {
  color: var(--success);
  background: var(--success-soft);
  border-color: color-mix(in srgb, var(--success) 35%, transparent);
}

/* Тонкий прогресс без свечения */
.progress > span {
  background: var(--accent);
  box-shadow: none;
}

/* Единый клавиатурный фокус */
.input:focus-visible,
.search:focus-within {
  border-color: var(--focus);
  outline-color: var(--focus);
  box-shadow: none;
}

/* Отправка — информация, ошибка — опасность */
.badge[data-state='sending'] {
  color: var(--diamond);
  background: color-mix(in srgb, var(--diamond) 10%, var(--surface));
}
.badge[data-state='error'],
.badge[data-state='offline'] {
  color: var(--danger);
  background: var(--danger-soft);
}
```

Имена существующих классов сохранить; показанные `.statusOk` и `.recipeStatusOk` обозначают соответствующие существующие селекторы, а не новые классы в DOM. У статичных content-поверхностей убрать декоративный `border` и `box-shadow`; у `Button` не менять размеры и варианты.

- [ ] **Step 3: Проверить общие компоненты в браузере**

На `http://localhost:5182/` открыть задачи, поиск, модальное окно новой задачи и справочник. Через computed styles проверить:

```js
({
  accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  success: getComputedStyle(document.documentElement).getPropertyValue('--success').trim(),
  focus: getComputedStyle(document.documentElement).getPropertyValue('--focus').trim(),
});
```

Ожидание в светлой теме: `#925735`, `#4f7356`, `#356d8a`; в тёмной: `#ce966f`, `#8faf92`, `#83afc7`. Проверить `Tab` на поле и кнопке: видимый outline без свечения.

- [ ] **Step 4: Отформатировать, проверить и закоммитить**

```bash
npx prettier --write src/app/theme/utilities.css src/app/theme/markdown.css src/shared/ui/Field.module.css src/shared/ui/Content.module.css src/shared/ui/Progress/Progress.module.css src/shared/ui/Button/Button.module.css src/shared/pack-data/RecipeStatusBadge/RecipeStatusBadge.module.css src/components/SyncBadge/SyncBadge.module.css src/components/LiveMarkdown/LiveMarkdown.module.css
npm run lint
git diff --check
git add src/app/theme src/shared/ui src/shared/pack-data/RecipeStatusBadge src/components/SyncBadge src/components/LiveMarkdown
git commit -m "Тема: семантика общих компонентов"
```

### Task 2: Задачи, документы, разработка и панель агента

**Files:**

- Modify: `src/widgets/header/Header/Header.module.css`
- Modify: `src/widgets/onboarding/Onboarding/Onboarding.module.css`
- Modify: `src/widgets/agent-panel/AgentPanel/AgentPanel.module.css`
- Modify: `src/widgets/agent-panel/ArtifactPane/ArtifactPane.module.css`
- Modify: `src/pages/tasks/TasksPage/TasksPage.module.css`
- Modify: `src/pages/tasks/ui/TaskRow/TaskRow.module.css`
- Modify: `src/pages/tasks/ui/Checklist/Checklist.module.css`
- Modify: `src/pages/tasks/ui/DocsSection/DocsSection.module.css`
- Modify: `src/pages/tasks/ui/CompareDialog/CompareDialog.module.css`
- Modify: `src/pages/tasks/ui/TaskDialog/TaskDialog.module.css`
- Modify: `src/pages/tasks/ui/GroupDialog/GroupDialog.module.css`
- Modify: `src/pages/tasks/ui/SchematicImport/SchematicImport.module.css`
- Modify: `src/pages/dev/DevPage/DevPage.module.css`
- Modify: `src/pages/dev/ui/DevProgress/DevProgress.module.css`
- Modify: `src/pages/dev/ui/DevPriority/DevPriority.module.css`
- Modify: `src/pages/dev/ui/ReportList/ReportList.module.css`
- Modify: `src/pages/dev/ui/DevTaskDialog/DevTaskDialog.module.css`
- Modify: `src/pages/dev/ui/CopyRef/CopyRef.module.css`
- Modify: `src/features/task-files/Attachments/Attachments.module.css`
- Modify: `src/features/task-files/Gallery/Gallery.module.css`

**Interfaces:**

- Consumes: `--success`, `--accent-soft`, `--amethyst-soft`, поверхности и тени из Task 1.
- Produces: спокойные списки, диалоги и статусы без изменения их DOM/API.

- [ ] **Step 1: Снять исходные экраны**

```bash
npm run ui:shots -- capture before-tasks --url http://localhost:5182 --only tasks,tasks.dark,docs,docs.dark,dev,dev.dialog --out .claude/shots
```

Ожидание: снимки созданы; data-dependent сценарии не считать ошибкой темы, если элемент отсутствует и в основной ветке.

- [ ] **Step 2: Убрать локальный визуальный шум**

Применить конкретные правила к существующим селекторам:

```css
/* Выполненные пункты и завершённый прогресс */
.checkDone,
.progressDone {
  color: var(--success);
  background: var(--success-soft);
}
.devProgressFill {
  stroke: var(--success);
}

/* Выбранные строки — медь, агент — нейтральный графит */
.taskRow.selected {
  background: var(--accent-soft);
  box-shadow: inset 3px 0 0 var(--accent);
}
.agentHeader {
  background: var(--surface);
  color: var(--amethyst);
}

/* Статичные списки */
.taskList,
.peopleList,
.reportCard,
.attachmentCard {
  border: 0;
  box-shadow: none;
  background: var(--surface);
}

/* Только overlay-слои сохраняют тень */
.dialog,
.popover {
  box-shadow: var(--shadow-lg);
}
```

Не вводить показанные новые классы в TSX: сопоставить правила с фактическими существующими селекторами. У `Header .nav-dot` убрать внешнее свечение; у `Segmented` и статусных бейджей теней быть не должно. Фиолетовые градиенты агента заменить на `var(--surface)` или `var(--amethyst-soft)` без gradient.

- [ ] **Step 3: Проверить сценарии и состояния**

```bash
npm run ui:shots -- capture after-tasks --url http://localhost:5182 --only tasks,tasks.dark,docs,docs.dark,dev,dev.dialog --out .claude/shots
```

Проверить активные и выполненные задачи, выбранную строку, «в работе», важность 0–3, документы, диалог задачи, прогресс разработки и панель агента. Ожидание: нет неона и декоративных теней; успех зелёный, текущее действие медное, агент нейтральный; сетка совпадает с исходными снимками.

- [ ] **Step 4: Закоммитить группу**

```bash
npx prettier --write src/widgets/header/Header/Header.module.css src/widgets/onboarding/Onboarding/Onboarding.module.css src/widgets/agent-panel/AgentPanel/AgentPanel.module.css src/widgets/agent-panel/ArtifactPane/ArtifactPane.module.css src/pages/tasks src/pages/dev src/features/task-files
npm run lint
git diff --check
git add src/widgets/header src/widgets/onboarding src/widgets/agent-panel src/pages/tasks src/pages/dev src/features/task-files
git commit -m "Тема: спокойные задачи и разработка"
```

### Task 3: Датапаки, рецепты, обновления, теги, статистика и файлы

**Files:**

- Modify: `src/pages/datapacks/DatapacksPage/DatapacksPage.module.css`
- Modify: `src/pages/datapacks/ui/EntryEditor/EntryEditor.module.css`
- Modify: `src/pages/datapacks/ui/HintPanel/HintPanel.module.css`
- Modify: `src/pages/recipes/RecipesPage/RecipesPage.module.css`
- Modify: `src/widgets/recipe-browser/RecipeCatalog/RecipeCatalog.module.css`
- Modify: `src/shared/pack-data/RecipeGrid/RecipeGrid.module.css`
- Modify: `src/shared/pack-data/ItemPicker/ItemPicker.module.css`
- Modify: `src/shared/pack-data/ItemIdSearch/ItemIdSearch.module.css`
- Modify: `src/pages/updates/UpdatesPage/UpdatesPage.module.css`
- Modify: `src/pages/updates/UpdatesSection.module.css`
- Modify: `src/pages/updates/FreshnessPage/FreshnessPage.module.css`
- Modify: `src/pages/updates/ui/TfcDownload/TfcDownload.module.css`
- Modify: `src/pages/tags/TagsPage/TagsPage.module.css`
- Modify: `src/pages/tags/ui/TagEditor/TagEditor.module.css`
- Modify: `src/pages/stats/StatsPage/StatsPage.module.css`
- Modify: `src/pages/files/FilesPage/FilesPage.module.css`
- Modify: `src/widgets/pack-nav/PackNav/PackNav.module.css`
- Modify: `src/components/KubejsConstructor/KubejsConstructor.module.css`
- Modify: `src/components/MarkdownField/MarkdownField.module.css`
- Modify: `src/components/FileBadge/FileBadge.module.css`

**Interfaces:**

- Consumes: семантические цвета и общие поверхности из Task 1.
- Produces: единый вид рабочих каталогов без изменения фильтров и данных.

- [ ] **Step 1: Отделить действие от результата**

Для существующих классов применить:

```css
/* Подтверждено, свежее, совместимо */
.confirmed,
.freshOk {
  color: var(--success);
  background: var(--success-soft);
  border-color: color-mix(in srgb, var(--success) 35%, transparent);
}

/* Выбранный фильтр или действие */
.activeFilter {
  color: var(--accent);
  background: var(--accent-soft);
}

/* Предупреждение и ошибка остаются различимыми */
.warning {
  color: var(--imp-2);
  background: color-mix(in srgb, var(--imp-2) 10%, var(--surface));
}
.error {
  color: var(--danger);
  background: var(--danger-soft);
}
```

Сопоставить с фактическими классами; успешные статусы датапаков, рецептов и freshness больше не должны использовать `--accent`.

- [ ] **Step 2: Очистить поверхности**

У статичных карточек датапаков, рецептов, обновлений, статистики и файлов удалить внешний `border` и `box-shadow`, оставив `background: var(--surface)` и текущий `border-radius`. У `ItemPicker`, dropdown, Tooltip и editor overlay оставить `box-shadow: var(--shadow-md)` или `var(--shadow-lg)`. Поля, drag-and-drop контуры, кнопки и выбранные фильтры не лишать функциональных границ.

- [ ] **Step 3: Проверить группу**

```bash
npm run ui:shots -- capture catalogs --url http://localhost:5182 --only datapacks,datapacks.editor,recipes,recipes.tag,recipes.kubejs-constructor,tags,tags.editor,updates,freshness,stats --out .claude/shots
```

Проверить light/dark вручную на `datapacks`, `recipes`, `updates` и `freshness`. Ожидание: успешные статусы зелёные, предупреждения охристые, ошибки красные; карточки без лишнего контура; длинные таблицы и фильтры не налезают друг на друга.

- [ ] **Step 4: Закоммитить группу**

```bash
npx prettier --write src/pages/datapacks src/pages/recipes src/widgets/recipe-browser src/shared/pack-data src/pages/updates src/pages/tags src/pages/stats src/pages/files src/widgets/pack-nav src/components/KubejsConstructor src/components/MarkdownField src/components/FileBadge
npm run lint
git diff --check
git add src/pages/datapacks src/pages/recipes src/widgets/recipe-browser src/shared/pack-data src/pages/updates src/pages/tags src/pages/stats src/pages/files src/widgets/pack-nav src/components/KubejsConstructor src/components/MarkdownField src/components/FileBadge
git commit -m "Тема: спокойные каталоги и статусы"
```

### Task 4: Схемы и конструктор без изменения 3D-редактора

**Files:**

- Modify: `src/pages/schematics/SchematicsPage/SchematicsPage.module.css`
- Modify: `src/pages/schematics/SchematicsSection.module.css`
- Modify: `src/pages/schematics/ui/SchematicLayers/SchematicLayers.module.css`
- Modify: `src/pages/schematics/ui/SchematicLibrary/SchematicLibrary.module.css`
- Modify: `src/pages/schematics/ui/SchematicFavorites/SchematicFavorites.module.css`
- Modify: `src/pages/builder/BuilderPage/BuilderPage.module.css`
- Modify: `src/entities/block-structure/BlockStructureViewer/BlockStructureViewer.module.css`
- Verify unchanged: `src/entities/schematic/ui/SchematicView3D/SchematicView3D.module.css`
- Verify unchanged: `src/entities/schematic/ui/SchematicView3D/SchematicView3D.tsx`

**Interfaces:**

- Consumes: спокойные поверхности и цвета выбора из предыдущих задач.
- Produces: обновлённый UI вокруг схем; 3D API и стили остаются byte-identical основной ветке.

- [ ] **Step 1: Зафиксировать запретную область**

```bash
git diff main -- src/entities/schematic/ui/SchematicView3D/
```

Ожидание: пустой вывод. Если не пусто — остановиться и убрать изменение из этой работы.

- [ ] **Step 2: Обновить только интерфейс вокруг 3D**

```css
.libraryCard,
.favoriteCard,
.layerPanel,
.builderPanel {
  border: 0;
  box-shadow: none;
  background: var(--surface);
}

.dropTarget {
  border: 2px dashed var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.selectedLayer {
  background: var(--accent-soft);
  box-shadow: none;
}
```

Сопоставить с фактическими классами, не добавляя их в TSX. Градиенты в шапках библиотеки заменить однородной поверхностью. Фиолетовые настройки перевести на нейтральный `--amethyst`; drop/focus сохранить заметными. Canvas, размеры viewer и его локальные стили не трогать.

- [ ] **Step 3: Проверить схемы и неизменность 3D**

```bash
npm run ui:shots -- capture schematics --url http://localhost:5182 --only schematics,schematics.dark,schematics.block-replacements --out .claude/shots
git diff main -- src/entities/schematic/ui/SchematicView3D/
```

Ожидание: скриншоты созданы, diff запретной области пуст. Визуально проверить, что 3D-canvas и его контролы не изменились, а библиотека и панели стали спокойнее.

- [ ] **Step 4: Закоммитить группу**

```bash
npx prettier --write src/pages/schematics src/pages/builder src/entities/block-structure
npm run lint
git diff --check
git add src/pages/schematics src/pages/builder src/entities/block-structure
git commit -m "Тема: спокойные панели схем"
```

### Task 5: Справочник, гайды, аддоны и карта

**Files:**

- Modify: `src/pages/reference/ReferencePage/ReferencePage.module.css`
- Modify: `src/pages/reference/NutritionTable.module.css`
- Modify: `src/pages/reference/tabs/GeologyTab/GeologyTab.module.css`
- Modify: `src/pages/reference/tabs/BotanyTab/BotanyTab.module.css`
- Modify: `src/pages/reference/tabs/PowerTab/PowerTab.module.css`
- Modify: `src/pages/reference/tabs/MealsTab/MealsTab.module.css`
- Modify: `src/features/reference-tabs/MultiblocksTab/MultiblocksTab.module.css`
- Modify: `src/features/reference-tabs/MultiblockFormed/MultiblockFormed.module.css`
- Modify: `src/features/reference-tabs/PowerIeLoads/PowerIeLoads.module.css`
- Modify: `src/features/reference-tabs/AddonsTab/AddonsTab.module.css`
- Modify: `src/features/guides/Guides.module.css`
- Modify: `src/features/guides/AddonVersions/AddonVersions.module.css`
- Modify: `src/features/guides/powerWidgets/powerWidgets.module.css`
- Modify: `src/pages/map/MapPage/MapPage.module.css`
- Modify: `src/pages/map/ui/WorldMap/WorldMap.module.css`

**Interfaces:**

- Consumes: обновлённые shared `Card`, `Table`, `SectionShell`, цвета питания и статусов.
- Produces: спокойный справочник без навигационной перекомпоновки и без перекрашивания доменного содержимого.

- [ ] **Step 1: Обновить UI-поверхности справочника**

```css
.referenceCard,
.guideCard,
.addonCard {
  border: 0;
  box-shadow: none;
  background: var(--surface);
}

.infoNote {
  color: var(--diamond);
  background: color-mix(in srgb, var(--diamond) 8%, var(--surface));
}

.successNote {
  color: var(--success);
  background: var(--success-soft);
}
```

Сопоставить с существующими классами. Декоративные градиенты гайдов убрать. Цвета `--nutrient-*` не заменять на медь: они уже приглушены в токенах и обозначают категории еды.

- [ ] **Step 2: Сохранить карту и доменную графику**

В `WorldMap` менять только рамки панелей и overlay-тени. Не менять inline-цвета маркеров, тайлы, проекцию, canvas, SVG-диаграммы электричества и цвета игровых предметов. У картографических overlay оставить читаемый фон и `var(--shadow-md)`.

- [ ] **Step 3: Проверить репрезентативные экраны**

```bash
npm run ui:shots -- capture reference --url http://localhost:5182 --only reference.food,reference.food.dark,reference.botany,reference.power,reference.multiblocks,reference.guides,reference.guides.dark,addons,addons.versions,addons.versions.dark,reference.map --out .claude/shots
```

Ожидание: основные сценарии созданы. Проверить desktop/mobile, light/dark, карточки гайдов, версии аддонов и панели карты. Data-dependent действия, которым не хватает production-данных, отметить отдельно и не выдавать за проверенные.

- [ ] **Step 4: Закоммитить группу**

```bash
npx prettier --write src/pages/reference src/features/reference-tabs src/features/guides src/pages/map
npm run lint
git diff --check
git add src/pages/reference src/features/reference-tabs src/features/guides src/pages/map
git commit -m "Тема: спокойный справочник и гайды"
```

### Task 6: Полная визуальная и техническая проверка

**Files:**

- Modify if needed: только CSS из Tasks 1–5 для исправления обнаруженных дефектов.
- Modify: `docs/state/site.md`
- Verify unchanged: `src/entities/schematic/ui/SchematicView3D/`

**Interfaces:**

- Consumes: все предыдущие изменения.
- Produces: проверенная ветка, готовая к `ship`, и обновлённая запись состояния сайта.

- [ ] **Step 1: Проверить отсутствие запрещённых приёмов**

```bash
git diff main -- src/entities/schematic/ui/SchematicView3D/
git diff --check
```

Ожидание: diff 3D пуст, whitespace-ошибок нет. Через поиск по изменённым CSS проверить оставшиеся `box-shadow`, `text-shadow`, `linear-gradient`, `radial-gradient`: каждое оставшееся должно относиться к overlay, читаемости изображения/карты или внутреннему маркеру выбора.

- [ ] **Step 2: Снять финальный набор**

```bash
npm run ui:shots -- capture final --url http://localhost:5182 --only tasks,tasks.dark,tasks.new-dialog,tasks.new-dialog.dark,docs,docs.dark,schematics,schematics.dark,datapacks,recipes,updates,freshness,stats,dev,reference.food,reference.food.dark,reference.guides,reference.guides.dark,addons.versions,addons.versions.dark --out .claude/shots
```

Проверить все полученные desktop/mobile снимки. Ожидание: нет наложений, обрезанного текста, потерянных границ полей, нечитаемых статусов или случайных изменений сетки. Отличия оформления от `main` ожидаемы.

- [ ] **Step 3: Проверить клавиатуру и семантику**

На задачах, справочнике и датапаках пройти `Tab` по кнопке, полю, вкладке и интерактивной карточке. Проверить done/success, sending/info, warning, danger и importance 0–3 в обеих темах. Цвет должен дублироваться текстом, иконкой или формой; контраст палитры не ниже значений спецификации.

- [ ] **Step 4: Выполнить технические проверки**

```bash
npm run lint
npx tsc -b
npm run boundaries
npm run ui:boundaries
npm run build
```

Ожидание: все команды завершаются с exit code 0; у lint допустимы только существующие warnings, errors = 0.

- [ ] **Step 5: Обновить состояние и закоммитить проверку**

В `docs/state/site.md` записать, что спокойная тема применена ко всему сайту, 3D-редактор сохранён, проверены desktop/mobile и light/dark. Затем:

```bash
npx prettier --write docs/state/site.md
git diff --check
git add docs/state/site.md
git commit -m "Документация: состояние спокойной темы"
```

- [ ] **Step 6: Выпустить**

Остановить dev-сервер этой ветки перед удалением worktree. Вызвать `ship`: merge в `main`, deploy сайта, push, cleanup. После возврата проверить production `https://tfc-plans-fd2c.web.app`, закрыть dev-задачу #178 русским отчётом. Задачу #179 не закрывать и не включать в изменения.
