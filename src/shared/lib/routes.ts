const WORLD_TABS = new Set(['ores', 'geology', 'map']);
const BOTANY_SUBS = new Set(['crop', 'bush', 'tree', 'plant', 'greenhouse']);

/** Старый корневой адрес задач переносим целиком, включая все query-параметры. */
export function legacyTasksTarget(search: string): string | null {
  if (!search) return null;
  return `/tasks${search.startsWith('?') ? search : `?${search}`}`;
}

/** Канонический адрес смыслового раздела для прежних вкладок справочника. */
export function legacyReferenceTarget(search: string): string | null {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  const sub = params.get('sub');

  if (tab === 'guides' && sub === 'addons') {
    params.delete('tab');
    params.set('sub', 'guides');
    return `/addons?${params}`;
  }
  if (tab === 'guides' && params.has('g') && sub !== 'site') {
    params.set('tab', sub === 'multiblocks' ? 'multiblocks' : 'power');
    params.set('sub', 'guides');
    return `/reference?${params}`;
  }
  if (tab === 'botany') {
    params.set('tab', 'food');
    params.set('sub', sub && BOTANY_SUBS.has(sub) ? sub : 'crop');
    return `/reference?${params}`;
  }

  const itemSub =
    tab === 'liquid'
      ? 'liquid'
      : tab === 'fuel'
        ? sub === 'liquid'
          ? 'liquid'
          : 'fuel'
        : tab === 'metals'
          ? 'metals'
          : null;
  if (itemSub) {
    params.set('tab', 'items');
    params.set('sub', itemSub);
    return `/reference?${params}`;
  }

  const worldSub = tab && WORLD_TABS.has(tab) ? tab : !tab && params.has('rock') ? 'ores' : null;
  if (!worldSub) return null;
  params.set('tab', 'world');
  params.set('sub', worldSub);
  return `/reference?${params}`;
}

/** Каталог рецептов — справочный подраздел, а не вкладка редактора датапаков. */
export function recipesReferenceTarget(search: string): string {
  const params = new URLSearchParams(search);
  params.set('tab', 'items');
  params.set('sub', 'recipes');
  return `/reference?${params}`;
}

/** Теги — справочный подраздел; выбранный датапак и фильтры сохраняются. */
export function tagsReferenceTarget(search: string): string {
  const params = new URLSearchParams(search);
  params.set('tab', 'items');
  params.set('sub', 'tags');
  return `/reference?${params}`;
}

/** Старый самостоятельный адрес карты сохраняет точки и остальные параметры. */
export function mapReferenceTarget(search: string): string {
  const params = new URLSearchParams(search);
  params.set('tab', 'world');
  params.set('sub', 'map');
  return `/reference?${params}`;
}
