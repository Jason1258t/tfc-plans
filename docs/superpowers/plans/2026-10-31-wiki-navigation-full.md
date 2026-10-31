# Wiki Navigation Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Завершить вики-навигацию #179: собрать пять тематических разделов справочника, встроить предметы, рецепты и теги, связать профильные гайды с темами и упростить каталог мультиблоков без потери старых ссылок.

**Architecture:** Существующие компоненты данных и редакторов переиспользуются; меняются только оболочки, навигация и канонические адреса. `/recipes` и `/tags` становятся совместимыми переходами в `/reference?tab=items`, статьи сохраняют `g`, структуры — `mb`; общий каталог гайдов остаётся на `/reference?tab=guides`. По уточнению пользователя верхние вкладки тематических разделов заменены карточками на `/reference`; внутри раздела остаются сайдбар и ссылка «Все разделы».

**Tech Stack:** React 19, TypeScript, React Router 7, CSS Modules, lucide-react, Vite, Node 24 для одноразовых проверок чистых функций.

## Global Constraints

- Работа только в `.claude/worktrees/wiki-navigation`, ветка `feat/wiki-navigation`.
- Не менять содержимое гайдов, игровые данные, токены темы #178, зелёную семантику положительных статусов и `src/entities/schematic/ui/SchematicView3D/`.
- Сохранить существующие URL и query-параметры; редиректы выполняются с `replace`.
- Не перестраивать вкладки задач, документов, схем, датапаков и аддонов; меняется только структура справочника и ссылки на перенесённую справку.
- UI, комментарии и сообщения коммитов — на русском; стили используют существующие токены.
- В проекте нет постоянного test runner: чистые функции проверяются одноразовыми Node-assertion'ами, UI — браузерной матрицей и `scripts/ui/scenarios.json`.

---

### Task 1: Канонические адреса справочника

**Files:**

- Modify: `src/shared/lib/routes.ts`
- Modify: `src/shared/lib/index.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/widgets/header/Header/Header.tsx`

**Interfaces:**

- Produces: `recipesReferenceTarget(search: string): string` и `tagsReferenceTarget(search: string): string`.
- Extends: `legacyReferenceTarget(search)` канонизирует `fuel|liquid|metals|botany`, а старые ссылки `tab=guides&g=<id>` переносит в профильный раздел.
- Produces: `/recipes?…` → `/reference?tab=items&sub=recipes&…`; `/tags?…` → `/reference?tab=items&sub=tags&…`.

- [ ] **Step 1: Записать проверки преобразования адресов до реализации**

Run:

```bash
node --experimental-strip-types --input-type=module -e "
import assert from 'node:assert/strict';
import { legacyReferenceTarget, recipesReferenceTarget, tagsReferenceTarget } from './src/shared/lib/routes.ts';
const url = (fn, search) => new URL(fn(search), 'https://tfc.local');
const check = (fn, search, path, expected) => {
  const actual = url(fn, search);
  assert.equal(actual.pathname, path);
  for (const [key, value] of Object.entries(expected)) assert.equal(actual.searchParams.get(key), value);
};
check(legacyReferenceTarget, '?tab=fuel', '/reference', { tab: 'items', sub: 'fuel' });
check(legacyReferenceTarget, '?tab=liquid', '/reference', { tab: 'items', sub: 'liquid' });
check(legacyReferenceTarget, '?tab=metals', '/reference', { tab: 'items', sub: 'metals' });
check(legacyReferenceTarget, '?tab=botany&sub=tree', '/reference', { tab: 'food', sub: 'tree' });
check(legacyReferenceTarget, '?tab=guides&g=abc', '/reference', { tab: 'power', sub: 'guides', g: 'abc' });
check(legacyReferenceTarget, '?tab=guides&sub=multiblocks&g=abc', '/reference', { tab: 'multiblocks', sub: 'guides', g: 'abc' });
check(recipesReferenceTarget, '?item=tfc%3Arock&type=x', '/reference', { tab: 'items', sub: 'recipes', item: 'tfc:rock', type: 'x' });
check(tagsReferenceTarget, '?kind=item&tag=item%3Ac%3Aingots', '/reference', { tab: 'items', sub: 'tags', kind: 'item', tag: 'item:c:ingots' });
"
```

Expected: FAIL до добавления новых функций и веток.

- [ ] **Step 2: Реализовать чистые преобразования через `URLSearchParams`**

Использовать следующие правила, не пересобирая остальные параметры вручную:

```ts
const LEGACY_REFERENCE_SUBS: Record<string, [string, string]> = {
  fuel: ['items', 'fuel'],
  liquid: ['items', 'liquid'],
  metals: ['items', 'metals'],
};

export function recipesReferenceTarget(search: string): string {
  const params = new URLSearchParams(search);
  params.set('tab', 'items');
  params.set('sub', 'recipes');
  return `/reference?${params}`;
}

export function tagsReferenceTarget(search: string): string {
  const params = new URLSearchParams(search);
  params.set('tab', 'items');
  params.set('sub', 'tags');
  return `/reference?${params}`;
}
```

В `legacyReferenceTarget` сначала обработать `tab=guides&g`: `sub=multiblocks` → `tab=multiblocks&sub=guides`, `sub=site|addons` оставить общему/аддонному обработчику, остальное → `tab=power&sub=guides`. Затем применить `LEGACY_REFERENCE_SUBS`; `botany` преобразовать в `food` с прежним `sub` или `crop`. Существующую обработку `ores|geology|map|rock` сохранить.

- [ ] **Step 3: Подключить совместимые маршруты**

Добавить в `App.tsx` общий компонент:

```tsx
function ReferenceRedirect({ target }: { target: (search: string) => string }) {
  const { search } = useLocation();
  return <Navigate to={target(search)} replace />;
}
```

Назначить его `/recipes` и `/tags`; убрать ставшие ненужными импорты `RecipesPage` и `TagsPage`. В шапке `inPacks` ограничить `/datapacks`, чтобы справочные рецепты и теги активировали «Справочник», а не редактор датапаков.

- [ ] **Step 4: Повторить assertions и проверить типы**

Run: тот же Node-скрипт, затем `npx tsc -b`.  
Expected: все адреса совпадают, TypeScript exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/routes.ts src/shared/lib/index.ts src/app/App.tsx src/widgets/header/Header/Header.tsx
git commit -m "Навигация: канонические адреса разделов справочника"
```

### Task 2: «Предметы и рецепты» и «Еда и сельское хозяйство»

**Files:**

- Create: `src/pages/reference/tabs/ItemCatalogTab/index.ts`
- Create: `src/pages/reference/tabs/ItemCatalogTab/ItemCatalogTab.tsx`
- Create: `src/pages/reference/tabs/ItemCatalogTab/ItemCatalogTab.module.css`
- Modify: `src/pages/reference/ReferencePage/ReferencePage.tsx`
- Modify: `src/pages/recipes/RecipesPage/RecipesPage.tsx`
- Modify: `src/pages/recipes/RecipesPage/RecipesPage.module.css`
- Modify: `src/pages/tags/TagsPage/TagsPage.tsx`
- Modify: `src/pages/tags/TagsPage/TagsPage.module.css`
- Modify: `src/pages/home/HomePage.tsx`

**Interfaces:**

- Produces: `ItemCatalogTab({ query, selectedId, onQuery, onSelect })` с строковыми параметрами `query: string`, `selectedId: string | null` и callback'ами `(value: string) => void`, `(id: string | null) => void`.
- Extends: `RecipesPage({ embedded?: boolean })`, `TagsPage({ embedded?: boolean })`; embedded-режим убирает `PackSection`, внешний `<main>` и наружные отступы, но сохраняет поиск, фильтры, конструктор и выбор датапака.
- Produces: `tab=items&sub=items|recipes|tags|metals|fuel|liquid`; `tab=food&sub=food|meals|dishes|crop|bush|tree|plant|greenhouse`.

- [ ] **Step 1: Добавить встроенный режим существующих каталогов**

В каждой странице вынести текущее содержимое в `body`, затем вернуть:

```tsx
if (embedded) return <section className={cx(styles.recipesPage, styles.embedded)}>{body}</section>;
return (
  <PackSection>
    <main className={styles.recipesPage}>{body}</main>
  </PackSection>
);
```

Для тегов использовать соответственно `styles.tagsPage`. Добавить `.embedded { padding: 0; }`; не менять операции редактирования и переходы после сохранения в датапак.

- [ ] **Step 2: Создать каталог предметов с рабочими связями**

Компонент использует `useItems`, `searchItems`, `ItemIcon`, `itemName`, `Search`, `Button` и `Link`. Поле имеет `aria-label="Поиск предметов"`, поиск начинается с двух символов и показывает до 60 результатов. Кнопка результата вызывает `onSelect(it.i)`; выбранный предмет показывает русское/английское имя, `id`, копирование id и три настоящие ссылки:

```tsx
<Link to={`/reference?tab=items&sub=recipes&item=${encodeURIComponent(item.i)}`}>Как получить</Link>
<Link to={`/reference?tab=items&sub=recipes&item=${encodeURIComponent(item.i)}&usage=1`}>Где используется</Link>
<Link to={`/reference?tab=items&sub=tags&q=${encodeURIComponent(item.i)}`}>Теги предмета</Link>
```

CSS: список и карточка на `--surface`, активный результат на `--accent-soft`, фокус на `--focus`; на mobile список и детали складываются в одну колонку. `useSearchTrack('items', query, results.length)` сохранить для существующей аналитики поиска.

- [ ] **Step 3: Собрать смысловые верхние разделы**

Сократить `Tab` до `'world' | 'items' | 'food' | 'power' | 'multiblocks' | 'guides'`; верхние подписи: «Мир и ресурсы», «Предметы и рецепты», «Еда и сельское хозяйство», «Электричество», «Мультиблоки», «Все гайды».

Для `items` добавить `SectionShell` с кнопками «Предметы», «Рецепты», «Теги», «Металлы», «Твёрдое топливо», «Жидкое топливо». Ветки содержимого:

```tsx
sub === 'recipes' ? (
  <RecipesPage embedded />
) : sub === 'tags' ? (
  <TagsPage embedded />
) : sub === 'metals' ? (
  <MetalsTab ref_={ref} items={items} />
) : sub === 'fuel' ? (
  <FuelTab fuels={ref.fuels} items={items} />
) : sub === 'liquid' && ref.liquid ? (
  <LiquidFuelTab families={ref.liquid.families} items={items} />
) : (
  <ItemCatalogTab
    query={params.get('q') ?? ''}
    selectedId={params.get('item')}
    onQuery={(q) => {
      const next = new URLSearchParams(params);
      next.set('tab', 'items');
      next.set('sub', 'items');
      next.set('q', q);
      next.delete('item');
      setParams(next, { replace: true });
    }}
    onSelect={(item) => {
      const next = new URLSearchParams(params);
      next.set('tab', 'items');
      next.set('sub', 'items');
      if (item) next.set('item', item);
      else next.delete('item');
      setParams(next, { replace: true });
    }}
  />
);
```

Callback'и используют копию `params`, устанавливают `tab=items`, нужный `sub` и изменяемый `q|item`; нерелевантные `type`, `usage`, `kind`, `tag`, `pack` удаляются только при смене подраздела, а не при вводе поиска.

Для `food` использовать один `SectionShell`: «Продукты», «Сборные блюда», «Готовые блюда», затем существующие «Культуры», «Кусты», «Деревья», «Растения», «Теплица». Продолжить вызывать `FoodTab`, `MealsTab`, `DishesTab`, `BotanyTab`; `BotanySub` получается из тех же `crop|bush|tree|plant|greenhouse`. Не дублировать компоненты и не менять их пропсы.

- [ ] **Step 4: Добавить прямую плитку на главную**

Добавить в группу «Игра и знания» плитку «Предметы и рецепты» на `/reference?tab=items&sub=recipes` с описанием «Как получить предмет, где он используется и в какие теги входит». Поиск по словам «рецепты», «предметы», «теги» должен находить её.

- [ ] **Step 5: Проверить поведение и типы**

Run: `npx tsc -b`, `npm run ui:boundaries`.  
Expected: exit 0; в справочнике нет вложенного `PackSection` или второго `<main>`, старые фильтры рецептов/тегов работают с прежними query.

- [ ] **Step 6: Commit**

```bash
git add src/pages/reference src/pages/recipes src/pages/tags src/pages/home/HomePage.tsx
git commit -m "Справочник: предметы, рецепты, теги и сельское хозяйство"
```

### Task 3: Профильные и общие гайды

**Files:**

- Modify: `src/pages/reference/tabs/GuidesTab.tsx`
- Modify: `src/pages/reference/tabs/PowerTab/PowerTab.tsx`
- Modify: `src/pages/reference/ReferencePage/ReferencePage.tsx`
- Modify: `src/features/guides/guideMeta.ts`

**Interfaces:**

- Produces: экспорт `PowerGuidesTab({ guide, onGuide })` из `GuidesTab.tsx` для повторного использования внутри «Электричества».
- Extends: `PowerTab` принимает `sub: PowerSub | 'guides'`, `onSub: (sub: PowerSub | 'guides') => void`, `guides?: ReactNode`.
- Produces: `/reference?tab=power&sub=guides[&g=…]`; общий `/reference?tab=guides[&sub=power|multiblocks|site]` остаётся каталогом.

- [ ] **Step 1: Вынести содержимое гайдов электричества без второго каркаса**

Экспортировать существующий `PowerGuidesTab` без изменения загрузки `usePower`, `useSettings` и lazy `PowerGuidesSection`. В `PowerTab` добавить к `POWER_SUBS` кнопку:

```tsx
<button aria-pressed={sub === 'guides'} onClick={() => onSub('guides')}>
  <span>Гайды</span>
</button>
```

В содержимом при `sub === 'guides'` рендерить переданный `guides`, иначе прежний `Body`. Не оборачивать его во второй `SectionShell`.

- [ ] **Step 2: Подключить статьи к тематическому разделу**

В `ReferencePage` для `power` передавать:

```tsx
<PowerTab
  sub={params.get('sub') === 'guides' ? 'guides' : (POWER_SUBS.find((s) => s.id === params.get('sub'))?.id ?? 'link')}
  onSub={(sub) => setParams(sub === 'link' ? { tab: 'power' } : { tab: 'power', sub }, { replace: true })}
  guides={
    <PowerGuidesTab
      guide={params.get('g')}
      onGuide={(g) => setParams({ tab: 'power', sub: 'guides', ...(g ? { g } : {}) })}
    />
  }
/>
```

Удалить прежний редирект `tab=power&sub=guides` в общий каталог: теперь это канонический профильный адрес.

- [ ] **Step 3: Оставить общий каталог и убрать дублирование аддонов**

Переименовать верхнюю вкладку в «Все гайды», категорию `site` — в «TFC Studio». Категории `power` и `multiblocks` в общем каталоге продолжают фильтровать список; открытие статьи использует канонический профильный адрес. Категория «Аддоны» становится переходом на `/addons?sub=guides`, а не вторым экземпляром `AddonsGuidesSection`; старый `tab=addons` по-прежнему перенаправляется туда же.

- [ ] **Step 4: Проверить ссылки и типы**

Run: `npx tsc -b`.  
Expected: exit 0; список электрических гайдов доступен и в теме, и в общем каталоге, кнопка «Все гайды» внутри статьи снимает только `g`, не меняя тематический `tab/sub`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/reference/tabs/GuidesTab.tsx src/pages/reference/tabs/PowerTab/PowerTab.tsx src/pages/reference/ReferencePage/ReferencePage.tsx src/features/guides/guideMeta.ts
git commit -m "Гайды: профильные разделы и общий каталог"
```

### Task 4: Компоновка и фильтры мультиблоков

**Files:**

- Modify: `src/features/reference-tabs/MultiblocksTab/MultiblocksTab.tsx`
- Modify: `src/features/reference-tabs/MultiblocksTab/MultiblocksTab.module.css`
- Modify: `src/pages/reference/ReferencePage/ReferencePage.tsx`

**Interfaces:**

- Extends: `MultiblocksTab({ slug, onSlug, sub, onSub, guide, onGuide })`, где `sub: 'build' | 'materials' | 'work' | 'guides'`.
- Produces: `/reference?tab=multiblocks[&mb=<slug>][&sub=build|materials|work|guides][&g=<id>]`.
- Consumes: существующие `Materials`, `MachineInfo`, `ManualEntry`, `MbViewer`, `MultiblockEmbed`; lazy `MultiblockGuidesSection`.

- [ ] **Step 1: Добавить поиск и фильтры каталога**

Добавить локальные `query`, `mod`, `purpose`; поиск нормализует `ё` и ищет в `mbName(m)`, `m.name.en`, `m.id`. Фильтр мода использует `m.ns`. Назначение вычисляется навигационными метаданными, без изменения данных:

```ts
type MbPurpose = 'production' | 'mining' | 'energy' | 'storage' | 'other';
function mbPurpose(m: Multiblock): MbPurpose {
  const id = m.id.split(':')[1];
  if (id === 'excavator' || id === 'bucket_wheel') return 'mining';
  if (id === 'diesel_generator' || id === 'lightning_rod') return 'energy';
  if (id === 'silo' || id === 'sheetmetal_tank' || id === 'shelf') return 'storage';
  return m.recipes.length > 0 ? 'production' : 'other';
}
```

Подписи фильтра: «Все назначения», «Производство», «Добыча», «Энергия», «Хранение», «Другое». Список под фильтрами показывает только совпадения и группирует их по `MOD_LABEL`; выбранная структура остаётся открытой, пока пользователь не выбрал другую.

- [ ] **Step 2: Разделить длинную страницу структуры**

Над `MultiblockCard` добавить `Segmented` с «Обзор и постройка», «Материалы», «Работа», «Гайды». Существующий `Card` обзора целиком выделить в `MultiblockOverview({ m, full, onFull }: { m: Multiblock; full: boolean; onFull: (value: boolean) => void })`: внутри него остаются текущие вычисления `shape`, `trigger`, `triggerState`, заголовок, инструкция и `MbViewer`. Ветки карточки:

```tsx
<div className={styles.card}>
  {sub === 'build' && <MultiblockOverview m={m} full={full} onFull={setFull} />}
  {sub === 'materials' && <Materials m={m} shape={m} data={data} />}
  {sub === 'work' && (
    <>
      <MachineInfo m={m} />
      {m.manual.map((e) => (
        <ManualEntry key={`${e.ns}:${e.entry}`} e={e} m={m} />
      ))}
    </>
  )}
  {sub === 'guides' && (
    <Suspense fallback={<div className="empty">Загружаю гайды…</div>}>
      <MultiblockGuidesSection guide={guide} onGuide={onGuide} />
    </Suspense>
  )}
</div>
```

Для материалов использовать базовую форму `m`, чтобы смена вкладки не теряла таблицу и не зависела от локального «Целиком». Заголовок и `.nbt` остаются в обзоре; `full`, молот, зеркальность и `MbViewer` не переписываются.

- [ ] **Step 3: Сохранить глубокие ссылки и embed**

В `ReferencePage` распознавать четыре `sub`, по умолчанию `build`. `onSlug` сохраняет текущий `sub`; `onSub` сохраняет `mb`, а `g` оставляет только в `guides`; `onGuide` сохраняет `mb` и `sub=guides`. Ссылка `MultiblockEmbed` дополнительно содержит `sub=build`; `::multiblock`, `withMaterials` и `BlockStructureViewer` не меняются.

- [ ] **Step 4: Проверить типы и границы**

Run: `npx tsc -b`, `npm run ui:boundaries`.  
Expected: exit 0; нет статического цикла импортов — гайды мультиблоков загружаются через `lazy`, 3D-файлы не изменены.

- [ ] **Step 5: Commit**

```bash
git add src/features/reference-tabs/MultiblocksTab src/pages/reference/ReferencePage/ReferencePage.tsx
git commit -m "Справочник: понятный каталог и разделы мультиблоков"
```

### Task 5: Внутренние ссылки и полная браузерная проверка

**Files:**

- Modify: `src/features/guides/RecipeEmbed.tsx`
- Modify: `src/pages/reference/tabs/DishesTab/DishesTab.tsx`
- Modify: `src/pages/reference/tabs/MealsTab/MealsTab.tsx`
- Modify: `src/pages/datapacks/ui/PackEditor.tsx`
- Modify: `scripts/ui/scenarios.json`
- Update only at closeout: `docs/state/site.md`

**Interfaces:**

- Consumes: все канонические адреса Tasks 1–4.
- Produces: воспроизводимые сценарии новых разделов; старые внешние ссылки продолжают работать через Task 1.

- [ ] **Step 1: Обновить только генерируемые приложением ссылки**

Ссылки на рецепты перевести на `/reference?tab=items&sub=recipes&…`, на теги — `/reference?tab=items&sub=tags&…`, сохранив `item`, `usage`, `type`, `pack`, `kind`, `tag`, `q`. Не менять содержимое статей или записи Firestore. Поиском убедиться, что старые `/recipes` и `/tags` остались только в совместимых маршрутах и документации.

- [ ] **Step 2: Добавить screenshot-сценарии**

Добавить светлые и тёмные сценарии для `reference.items`, `reference.recipes`, `reference.food`, `reference.power-guides`, `reference.multiblocks`; существующие `home`, `world`, `map`, `tasks` сохранить. Каждый сценарий использует только публичный URL и существующие действия снимков, без записей в Firestore.

- [ ] **Step 3: Запустить отдельный dev-сервер**

Run: `npm run dev -- --port 5176 --strictPort`; если порт занят — 5177. Для быстрой локальной карточки превью использовать уже настроенный ignored-лаунчер без сетевого `predev`.  
Expected: HTTP 200; после проверки все запущенные процессы остановлены.

- [ ] **Step 4: Проверить матрицу и клавиатуру**

Desktop/mobile × light/dark: главная, предметы, рецепты, теги, металлы, оба топлива, еда/блюда/ботаника, электричество/гайды, мультиблоки/материалы/работа/гайды, общий каталог. Проверить Tab, Enter, видимый фокус, активные разделы, «Назад», отсутствие горизонтального переполнения, отсутствие вложенного `<main>` и неизменный 3D-просмотр.

- [ ] **Step 5: Проверить старые ссылки**

Открыть `/recipes?item=<id>&usage=1`, `/recipes?type=<type>`, `/tags?kind=item&tag=<key>`, `/reference?tab=fuel`, `tab=liquid`, `tab=metals`, `tab=botany&sub=tree`, `tab=food&sub=meals&q=…`, `tab=power&sub=guides&g=<id>`, `tab=guides&g=<id>`, `tab=guides&sub=multiblocks&g=<id>`, `tab=guides&sub=site&g=<id>`, `tab=multiblocks&mb=<slug>`, `/map?x=0&z=0`, `/addons?sub=guides&g=<id>`.  
Expected: прежний контент, фильтры и статьи открываются, `replace`-редиректы не создают циклов «Назад».

- [ ] **Step 6: Выполнить обязательные проверки и обновить состояние**

Run: `npx prettier --write <все изменённые файлы>`, `npm run lint`, `npx tsc -b`, `npm run boundaries`, `npm run ui:boundaries`, `npm run build`, `git diff --check`.  
Expected: все команды exit 0; 30 прежних lint-предупреждений не устранять вне задачи. Обновить `docs/state/site.md` фактической новой навигацией и проверками, затем закоммитировать:

```bash
git add src scripts/ui/scenarios.json docs/state/site.md
git commit -m "Навигация: ссылки и проверка вики-разделов"
```

- [ ] **Step 7: Выпустить только #179**

Вызвать проектный `ship`: merge в `main`, deploy сайта, push и удаление worktree по его проверкам. После успешного выпуска закрыть только dev-задачу #179 с русским отчётом; #178 и игровые данные не изменять.
