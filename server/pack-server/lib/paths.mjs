/**
 * Какие пути можно класть в снимок сборки. Путь — относительно папки версии, через «/»; всё из папки мира —
 * под префиксом `world/` (имя мира у игроков разное, в снимке не хранится).
 * Белый список и запреты — из docs/plans/pack-cli.md («Белый список при заливке»).
 */

/** Никогда не берём: настройки сервера, списки и данные игроков, клиентские настройки */
const FORBIDDEN_NAMES = new Set([
  'server.properties',
  'ops.json',
  'whitelist.json',
  'banned-players.json',
  'banned-ips.json',
  'usercache.json',
  'usernamecache.json',
  'options.txt',
  'optionsof.txt',
  'servers.dat',
  'session.lock',
  'level.dat',
  'level.dat_old',
  'eula.txt',
]);
const FORBIDDEN_DIRS = new Set([
  'playerdata',
  'stats',
  'region',
  'entities',
  'poi',
  'advancements',
  'saves',
  'logs', // в логах сервера — адреса игроков; лог для сборки данных пойдёт отдельно, не в раздачу
  'crash-reports',
  'screenshots',
]);

/** Клиентское и личное в config/ — из docs/plans/pack-directory.md */
const CONFIG_EXCLUDED = ['fancymenu', 'jmsharedmaps', 'csc', 'voicechat', 'xaero'];

/**
 * Не настройки, а состояние модов, кеши и личное, хоть и лежат в config/. Сервер их принимает (старые версии tfc
 * заливают), но tfc их не заливает и у игрока не трогает: ни ставит, ни убирает. Найдено по истории снимков —
 * файлы, которые менялись почти при каждой заливке, и то, что видно по содержимому (docs/pack-server.md, «Шум»).
 */
const STATE_PATHS = [
  /^config\/emi-accelerator\/(reload-timings\.json|.*\.emic)$/i, // замеры загрузки и кеш стаков EMI
  /^config\/jei\/world\//i, // история поиска и закладки JEI по мирам игрока
  /^config\/spark\/(activity\.json|tmp(-client)?\/)/i, // журнал профилировщика: ник и UUID, временные файлы
  /^config\/sodium-fingerprint\.json$/i, // отпечаток железа ПК: Sodium сверяет его, чтобы заметить чужой конфиг
  /^config\/chunky\/tasks\//i, // прогресс прогрузки чанков
  /^config\/create_submarine_client_state\.json$/i, // «экран приветствия показан»
  /^config\/NoChatReports\/NCR-ServerPreferences\.json$/i, // выбор игрока по серверам
];

/** Состояние мода, а не настройка: в снимок не берём */
export const isStatePath = (p) => STATE_PATHS.some((re) => re.test(p));

/**
 * Клиентские настройки (интерфейс, клавиши, графика): у каждого игрока свои — у игрока только добавляются, если их
 * нет, а при заливке хоста версия на сервере не обновляется (до игроков она всё равно не дошла бы).
 * -client / _client в имени, в том числе vss-client-config.json.
 */
export const isClientConfig = (p) =>
  /^(config|defaultconfigs)\/.*[-_]client([-_][\w-]+)?\.(toml|json5?|cfg|properties|txt|snbt|ya?ml|ini)$/i.test(p);

const RULES = [
  { kind: 'mod', test: (p) => /^mods\/[^/]+\.jar$/i.test(p) },
  {
    kind: 'config',
    test: (p) => p.startsWith('config/') && !CONFIG_EXCLUDED.some((x) => p.split('/')[1].toLowerCase().startsWith(x)),
  },
  { kind: 'defaultconfig', test: (p) => p.startsWith('defaultconfigs/') },
  { kind: 'serverconfig', test: (p) => p.startsWith('serverconfig/') },
  { kind: 'kubejs', test: (p) => p.startsWith('kubejs/') },
  { kind: 'resourcepack', test: (p) => p.startsWith('resourcepacks/') },
  { kind: 'world-data', test: (p) => p === 'world/data/tfc_calendar.dat' },
  { kind: 'world-datapack', test: (p) => p.startsWith('world/datapacks/') },
];

export const KINDS = RULES.map((r) => r.kind);

/** Возвращает { kind } или { error } — почему путь не принят */
export function classifyPath(p) {
  if (typeof p !== 'string' || !p) return { error: 'пустой путь' };
  if (p.length > 400) return { error: 'слишком длинный путь' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\:*?"<>|]/.test(p)) return { error: 'недопустимые символы' };
  const segs = p.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..'))
    return { error: 'путь должен быть относительным, без «..»' };
  if (segs.some((s) => s.startsWith('.'))) return { error: 'скрытые файлы и папки не берём' };
  if (segs.some((s) => s.endsWith(' ') || s.endsWith('.'))) return { error: 'имя кончается пробелом или точкой' };
  const lower = segs.map((s) => s.toLowerCase());
  if (FORBIDDEN_NAMES.has(lower.at(-1))) return { error: `запрещённый файл ${segs.at(-1)}` };
  // Папки мира и сервера — только на своём месте (верх папки версии или мира): внутри датапаков и kubejs/data
  // такие имена законны (data/minecraft/loot_table/entities/, data/<ns>/advancements/)
  const dirs = lower[0] === 'world' ? lower.slice(0, 2) : lower.slice(0, 1);
  const dir = dirs.slice(0, lower.length - 1).find((s) => FORBIDDEN_DIRS.has(s));
  if (dir) return { error: `запрещённая папка ${dir}/` };
  if (lower.at(-1).endsWith('.bak')) return { error: 'резервные копии *.bak не берём' };
  const rule = RULES.find((r) => r.test(p));
  return rule ? { kind: rule.kind } : { error: 'вне белого списка' };
}
