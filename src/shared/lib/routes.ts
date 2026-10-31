const WORLD_TABS = new Set(['ores', 'geology', 'map']);

/** Старый корневой адрес задач переносим целиком, включая все query-параметры. */
export function legacyTasksTarget(search: string): string | null {
  if (!search) return null;
  return `/tasks${search.startsWith('?') ? search : `?${search}`}`;
}

/** Канонический адрес смыслового раздела «Мир и ресурсы» для прежних вкладок. */
export function legacyReferenceTarget(search: string): string | null {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  const worldSub = tab && WORLD_TABS.has(tab) ? tab : !tab && params.has('rock') ? 'ores' : null;
  if (!worldSub) return null;
  params.set('tab', 'world');
  params.set('sub', worldSub);
  return `/reference?${params}`;
}

/** Старый самостоятельный адрес карты сохраняет точки и остальные параметры. */
export function mapReferenceTarget(search: string): string {
  const params = new URLSearchParams(search);
  params.set('tab', 'world');
  params.set('sub', 'map');
  return `/reference?${params}`;
}
