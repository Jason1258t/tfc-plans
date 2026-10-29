/**
 * Свежесть сборки: насколько каждый мод отстаёт от новейшей версии под Minecraft 1.21.1 + NeoForge.
 * Общий модуль сайта и Node (scripts/freshness.mjs, MCP mods_freshness): без React и без ключей в коде.
 * Источники — Modrinth по sha1 jar, CurseForge по отпечатку (murmur2) и релизы GitHub разработчиков сборки (по имени
 * jar), план — docs/plans/mod-freshness.md.
 * Цвет — по первой отличающейся цифре x.y.z: x — красный, y — оранжевый, z и дальше — жёлтый.
 */

export const GAME = { mc: '1.21.1', loader: 'neoforge' } as const;

export type FreshStatus = 'red' | 'orange' | 'yellow' | 'unknown' | 'missing' | 'own' | 'ok';
export type FreshLevel = 'major' | 'minor' | 'patch' | 'pre';
export type FreshSource = 'modrinth' | 'curseforge' | 'git' | 'own';
export type ReleaseType = 'release' | 'beta' | 'alpha';

/** Мод из pack-manifest.json (cf — отпечаток CurseForge, есть у снимков после этого изменения) */
export interface ManifestMod {
  id: string;
  name: string;
  version: string;
  jar: string;
  sha1?: string;
  cf?: number;
}

export interface FreshVersion {
  version: string;
  /** id версии Modrinth, файла CurseForge или тег релиза GitHub — по нему MCP достаёт ченджлоги */
  id?: string;
  date?: string;
  type?: ReleaseType;
  url?: string;
  file?: string;
}

export interface FreshDep {
  name: string;
  url?: string;
}

export interface FreshMod {
  id: string;
  name: string;
  jar: string;
  /** Версия из mods.toml — как её видит игра */
  version: string;
  sha1?: string;
  cf?: number;
  status: FreshStatus;
  level?: FreshLevel;
  source?: FreshSource;
  project?: { id: string; url?: string; title?: string };
  current?: FreshVersion;
  /** Новейший релиз (или новейшая версия вообще, если релизов нет) */
  latest?: FreshVersion;
  /** Бета/альфа новее релиза */
  beta?: FreshVersion;
  /** Обязательные зависимости новой версии, которых нет у текущей и нет в сборке */
  newDeps?: FreshDep[];
  note?: string;
}

export interface SourceState {
  state: 'ok' | 'error' | 'skipped';
  note?: string;
  found?: number;
  checkedAt?: number;
}

export interface FreshReport {
  version: 1;
  generatedAt: number;
  manifestBuiltAt?: number;
  game: { mc: string; loader: string };
  /** git — нет в отчётах до появления этого источника */
  sources: { modrinth: SourceState; curseforge: SourceState; git?: SourceState };
  counts: Record<FreshStatus, number>;
  mods: FreshMod[];
}

export const STATUS_ORDER: FreshStatus[] = ['red', 'orange', 'yellow', 'unknown', 'missing', 'own', 'ok'];

export const STATUS_LABEL: Record<FreshStatus, string> = {
  red: 'отстаёт по x',
  orange: 'отстаёт по y',
  yellow: 'отстаёт по z',
  unknown: 'не сравнить',
  missing: 'не найден',
  own: 'наш аддон',
  ok: 'актуален',
};

const LEVEL_STATUS: Record<FreshLevel, FreshStatus> = { major: 'red', minor: 'orange', patch: 'yellow', pre: 'yellow' };

// ---------------------------------------------------------------- отпечаток CurseForge

/** Отпечаток файла CurseForge: murmur2 (seed 1) по байтам без пробелов, табов и переводов строк */
export function cfFingerprint(bytes: Uint8Array): number {
  let len = 0;
  const b = new Uint8Array(bytes.length);
  for (const x of bytes) if (x !== 9 && x !== 10 && x !== 13 && x !== 32) b[len++] = x;
  const m = 0x5bd1e995;
  let h = (1 ^ len) >>> 0;
  let i = 0;
  for (; i + 4 <= len; i += 4) {
    let k = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
    k = Math.imul(k, m);
    k ^= k >>> 24;
    k = Math.imul(k, m);
    h = Math.imul(h, m) ^ k;
  }
  const rest = len - i;
  if (rest === 3) h ^= b[i + 2] << 16;
  if (rest >= 2) h ^= b[i + 1] << 8;
  if (rest >= 1) {
    h ^= b[i];
    h = Math.imul(h, m);
  }
  h ^= h >>> 13;
  h = Math.imul(h, m);
  h ^= h >>> 15;
  return h >>> 0;
}

// ---------------------------------------------------------------- сравнение версий

/** Числа версии без версии Minecraft, загрузчиков и префикса v: «1.21.1-8.39-fabric+forge+neo» → [8, 39] */
export function versionParts(v: string): number[] {
  const s = v
    .toLowerCase()
    .replace(/\.jar$/, '')
    .replace(/(?:mc|minecraft)?(?<![\d.])1\.21(?:\.\d+|\.x)?(?![\d])/g, ' ')
    .replace(/neoforge|forge|fabric|quilt|neo|universal/g, ' ');
  return (
    s
      .match(/\d+(?:\.\d+)*/)?.[0]
      .split('.')
      .map(Number) ?? []
  );
}

/**
 * Уровень отставания cur от next: major/minor/patch по первой отличающейся цифре, pre — числа те же, файл другой
 * (beta.1 → релиз, b2 → b7). null — next не новее (схема версий сменилась) или чисел нет.
 */
export function lagLevel(cur: string, next: string): FreshLevel | null {
  const a = versionParts(cur);
  const b = versionParts(next);
  if (!a.length || !b.length) return null;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x === y) continue;
    if (y < x) return null;
    return i === 0 ? 'major' : i === 1 ? 'minor' : 'patch';
  }
  return cur === next ? null : 'pre';
}

/** Версия из имени файла CurseForge (у файлов там нет поля версии): «ftb-quests-neoforge-2101.1.30.jar» → «2101.1.30» */
export function fileVersion(fileName: string): string {
  const base = fileName.replace(/\.jar$/i, '');
  const parts = base.match(/v?\d+(?:\.\d+)+(?:[-+.]?(?:alpha|beta|pre|rc|build|b)[.-]?\d*)?/gi) ?? [];
  const own = parts.filter((p) => !/^(?:mc)?1\.21(?:\.\d+)?$/i.test(p));
  return own[0] ?? parts[0] ?? base;
}

/**
 * Хвосты имён файлов после общего начала (до последнего - или +): версия в имени встречается дважды
 * («forgified-fabric-api-0.116.15+2.3.2+1.21.1.jar»), а меняется вторая.
 */
function fileTails(a: string, b: string): [string, string] {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const cut = Math.max(a.lastIndexOf('-', i - 1), a.lastIndexOf('+', i - 1)) + 1;
  return [a.slice(cut), b.slice(cut)];
}

// ---------------------------------------------------------------- сеть

type Fetch = typeof fetch;
interface CheckOpts {
  fetch?: Fetch;
  userAgent?: string;
  /** Сколько запросов в полёте одновременно (по проектам) */
  concurrency?: number;
}

async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>) {
  const queue = [...list];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift() as T);
    }),
  );
}

/** Что источник знает о моде: всё, кроме полей манифеста и статуса */
export type Found = Pick<FreshMod, 'source' | 'project' | 'current' | 'latest' | 'beta' | 'newDeps' | 'note'>;

// ---------------------------------------------------------------- Modrinth

const MODRINTH = 'https://api.modrinth.com/v2';

interface MrVersion {
  id: string;
  project_id: string;
  version_number: string;
  version_type: ReleaseType;
  date_published: string;
  loaders: string[];
  files?: { filename: string; primary: boolean }[];
  dependencies?: { project_id: string | null; dependency_type: string }[];
}

const mrVer = (v: MrVersion, slug: string): FreshVersion => ({
  version: v.version_number,
  id: v.id,
  date: v.date_published,
  type: v.version_type,
  url: `https://modrinth.com/mod/${slug}/version/${v.id}`,
  file: (v.files?.find((f) => f.primary) ?? v.files?.[0])?.filename,
});

const mrRequired = (v: MrVersion) =>
  new Set(
    (v.dependencies ?? [])
      .filter((d) => d.dependency_type === 'required' && d.project_id)
      .map((d) => d.project_id as string),
  );

/** Моды с Modrinth по sha1: текущая версия, новейший релиз и бета под 1.21.1 с теми же загрузчиками */
export async function checkModrinth(mods: ManifestMod[], opts: CheckOpts = {}): Promise<Map<string, Found>> {
  const f = opts.fetch ?? fetch;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // В браузере User-Agent задать нельзя — Modrinth тогда смотрит на Origin
  if (opts.userAgent) headers['User-Agent'] = opts.userAgent;
  const json = async <T>(url: string, body?: unknown): Promise<T> => {
    const r = await f(url, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
    if (!r.ok) throw new Error(`Modrinth ${r.status} ${url.replace(MODRINTH, '')}`);
    return r.json() as Promise<T>;
  };

  const hashes = mods.map((m) => m.sha1).filter((h): h is string => !!h);
  const out = new Map<string, Found>();
  if (!hashes.length) return out;
  const cur = await json<Record<string, MrVersion>>(`${MODRINTH}/version_files`, { hashes, algorithm: 'sha1' });

  // Новейшая версия — отдельно для каждого набора загрузчиков (fabric-моды через Connector сравниваем с fabric)
  const byLoaders = new Map<string, string[]>();
  for (const h of hashes) {
    const v = cur[h];
    if (!v) continue;
    const key = [...v.loaders].sort().join(',');
    byLoaders.set(key, [...(byLoaders.get(key) ?? []), h]);
  }
  const newest: Record<string, MrVersion> = {};
  for (const [key, list] of byLoaders)
    Object.assign(
      newest,
      await json<Record<string, MrVersion>>(`${MODRINTH}/version_files/update`, {
        hashes: list,
        algorithm: 'sha1',
        loaders: key.split(','),
        game_versions: [GAME.mc],
      }),
    );

  const projectIds = [...new Set(Object.values(cur).map((v) => v.project_id))];
  const projects = new Map<string, { id: string; slug: string; title: string }>();
  for (let i = 0; i < projectIds.length; i += 400) {
    const ids = encodeURIComponent(JSON.stringify(projectIds.slice(i, i + 400)));
    for (const p of await json<{ id: string; slug: string; title: string }[]>(`${MODRINTH}/projects?ids=${ids}`))
      projects.set(p.id, p);
  }

  // Новейшая версия — бета или альфа: ищем новейший релиз в списке версий проекта
  const release = new Map<string, MrVersion | null>();
  const needRelease = hashes.filter((h) => cur[h] && newest[h] && newest[h].version_type !== 'release');
  await pool(needRelease, opts.concurrency ?? 6, async (h) => {
    const c = cur[h];
    const q = `loaders=${encodeURIComponent(JSON.stringify(c.loaders))}&game_versions=${encodeURIComponent(JSON.stringify([GAME.mc]))}`;
    try {
      const list = await json<MrVersion[]>(`${MODRINTH}/project/${c.project_id}/version?${q}`);
      release.set(h, list.find((v) => v.version_type === 'release') ?? null);
    } catch {
      release.set(h, null);
    }
  });

  const packProjects = new Set(Object.values(cur).map((v) => v.project_id));
  const depIds = new Set<string>();
  const pending: { mod: ManifestMod; found: Found; deps: string[] }[] = [];

  for (const mod of mods) {
    const c = mod.sha1 ? cur[mod.sha1] : undefined;
    if (!c) continue;
    const p = projects.get(c.project_id);
    const slug = p?.slug ?? c.project_id;
    const n = newest[mod.sha1 as string] ?? c;
    let latest = n;
    let beta: MrVersion | undefined;
    if (n.version_type !== 'release') {
      const r = release.get(mod.sha1 as string);
      // Есть релиз новее нашего файла — цвет по нему, бета рядом; иначе цвет по бете
      if (r && Date.parse(r.date_published) >= Date.parse(c.date_published)) {
        latest = r;
        if (r.id !== n.id) beta = n;
      }
    }
    const found: Found = {
      source: 'modrinth',
      project: { id: c.project_id, url: `https://modrinth.com/mod/${slug}`, title: p?.title },
      current: mrVer(c, slug),
      latest: mrVer(latest, slug),
      ...(beta ? { beta: mrVer(beta, slug) } : {}),
    };
    const had = mrRequired(c);
    const deps = [...mrRequired(latest)].filter((d) => !had.has(d) && !packProjects.has(d));
    deps.forEach((d) => depIds.add(d));
    pending.push({ mod, found, deps });
  }

  if (depIds.size) {
    const ids = encodeURIComponent(JSON.stringify([...depIds]));
    for (const p of await json<{ id: string; slug: string; title: string }[]>(`${MODRINTH}/projects?ids=${ids}`))
      projects.set(p.id, p);
  }
  for (const { mod, found, deps } of pending) {
    if (deps.length)
      found.newDeps = deps.map((d) => {
        const p = projects.get(d);
        return { name: p?.title ?? d, url: `https://modrinth.com/mod/${p?.slug ?? d}` };
      });
    out.set(mod.id, found);
  }
  return out;
}

// ---------------------------------------------------------------- CurseForge

const CURSEFORGE = 'https://api.curseforge.com/v1';
const CF_NEOFORGE = 6;
const CF_TYPES: Record<number, ReleaseType> = { 1: 'release', 2: 'beta', 3: 'alpha' };

interface CfFile {
  id: number;
  modId: number;
  displayName: string;
  fileName: string;
  releaseType: number;
  fileDate: string;
  gameVersions: string[];
  fileFingerprint: number;
  dependencies?: { modId: number; relationType: number }[];
}
interface CfMod {
  id: number;
  name: string;
  slug: string;
  links?: { websiteUrl?: string };
  latestFilesIndexes?: {
    gameVersion: string;
    fileId: number;
    filename: string;
    releaseType: number;
    modLoader?: number | null;
  }[];
}

const cfVer = (f: CfFile, mod?: CfMod): FreshVersion => ({
  version: fileVersion(f.fileName),
  id: String(f.id),
  date: f.fileDate,
  type: CF_TYPES[f.releaseType] ?? 'release',
  url: mod?.links?.websiteUrl ? `${mod.links.websiteUrl}/files/${f.id}` : undefined,
  file: f.fileName,
});

/** Моды с CurseForge по отпечатку jar (поле cf манифеста); нужен ключ API */
export async function checkCurseForge(
  mods: ManifestMod[],
  apiKey: string,
  opts: CheckOpts = {},
): Promise<Map<string, Found>> {
  const f = opts.fetch ?? fetch;
  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' };
  const post = async <T>(p: string, body: unknown): Promise<T> => {
    const r = await f(`${CURSEFORGE}${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`CurseForge ${r.status} ${p}${r.status === 403 ? ' (ключ API не принят)' : ''}`);
    return ((await r.json()) as { data: T }).data;
  };

  const out = new Map<string, Found>();
  const withFp = mods.filter((m) => m.cf !== undefined);
  if (!withFp.length) return out;
  const match = await post<{ exactMatches: { id: number; file: CfFile }[] }>('/fingerprints/432', {
    fingerprints: withFp.map((m) => m.cf),
  });
  const byFp = new Map((match.exactMatches ?? []).map((e) => [e.file.fileFingerprint, e.file]));

  const modIds = [...new Set([...byFp.values()].map((x) => x.modId))];
  if (!modIds.length) return out;
  const cfMods = new Map((await post<CfMod[]>('/mods', { modIds })).map((m) => [m.id, m]));

  // Новейший файл каждого типа под 1.21.1 NeoForge (или без указания загрузчика) — по fileId: он растёт со временем
  const newestIds = new Map<number, { release?: number; any?: number }>();
  for (const m of cfMods.values()) {
    const idx = (m.latestFilesIndexes ?? []).filter(
      (x) => x.gameVersion === GAME.mc && (x.modLoader == null || x.modLoader === 0 || x.modLoader === CF_NEOFORGE),
    );
    const max = (list: typeof idx) =>
      list.reduce<number | undefined>((a, x) => (a === undefined || x.fileId > a ? x.fileId : a), undefined);
    newestIds.set(m.id, { release: max(idx.filter((x) => x.releaseType === 1)), any: max(idx) });
  }
  const fileIds = [
    ...new Set([...newestIds.values()].flatMap((x) => [x.release, x.any]).filter((x): x is number => !!x)),
  ];
  const files = new Map((fileIds.length ? await post<CfFile[]>('/mods/files', { fileIds }) : []).map((x) => [x.id, x]));

  const packMods = new Set(modIds);
  const depIds = new Set<number>();
  const pending: { mod: ManifestMod; found: Found; deps: number[] }[] = [];
  for (const mod of withFp) {
    const c = byFp.get(mod.cf as number);
    if (!c) continue;
    const m = cfMods.get(c.modId);
    const ids = newestIds.get(c.modId) ?? {};
    const any = (ids.any && files.get(ids.any)) || c;
    const rel = ids.release ? files.get(ids.release) : undefined;
    // Наш файл новее индекса (индекс бывает неполным) — считаем текущий новейшим
    const latest = rel && rel.id >= c.id ? rel : any.id >= c.id ? any : c;
    const beta = any.id > latest.id ? any : undefined;
    const found: Found = {
      source: 'curseforge',
      project: { id: String(c.modId), url: m?.links?.websiteUrl, title: m?.name },
      current: cfVer(c, m),
      latest: cfVer(latest, m),
      ...(beta ? { beta: cfVer(beta, m) } : {}),
    };
    const req = (x: CfFile) => new Set((x.dependencies ?? []).filter((d) => d.relationType === 3).map((d) => d.modId));
    const had = req(c);
    const deps = [...req(latest)].filter((d) => !had.has(d) && !packMods.has(d));
    deps.forEach((d) => depIds.add(d));
    pending.push({ mod, found, deps });
  }
  const depMods = depIds.size
    ? new Map((await post<CfMod[]>('/mods', { modIds: [...depIds] })).map((m) => [m.id, m]))
    : new Map<number, CfMod>();
  for (const { mod, found, deps } of pending) {
    if (deps.length)
      found.newDeps = deps.map((d) => ({
        name: depMods.get(d)?.name ?? `CurseForge #${d}`,
        url: depMods.get(d)?.links?.websiteUrl,
      }));
    out.set(mod.id, found);
  }
  return out;
}

// ---------------------------------------------------------------- гит сборки

/**
 * Репозитории разработчиков сборки с собственными сборками модов (их нет на Modrinth и CurseForge), список —
 * local-mods/README.md в репозитории сборки. Мод сопоставляется с репозиторием по имени jar в релизах.
 */
export const PACK_GIT = {
  pack: 'https://github.com/GranniXXie/TerraFirmaRebirth',
  repos: [
    'GranniXXie/tfcr-fixes',
    'GranniXXie/woodencog-TFCR',
    'GranniXXie/tfcbetterbf-TFCR',
    'GranniXXie/tfc-ability-fix',
    'GranniXXie/kaleidoscopetfctavern-TFCR',
    'GranniXXie/electroenergetics-TFCR',
    'GranniXXie/firmalife-TFCR',
    'GranniXXie/cosmo-return-clamp',
    'GranniXXie/Friendship',
  ],
};

const GITHUB = 'https://api.github.com';

export interface GhRelease {
  tag_name: string;
  name?: string | null;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
  body?: string | null;
  assets: { name: string }[];
}

/**
 * Форма имени jar без чисел и разделителей: «tfcr-fixes-1.7.7.jar» и «tfcr-fixes-1.7.12.jar» совпадают. GitHub
 * заменяет «+» в именах файлов на «.», поэтому все разделители одинаковы.
 */
export const jarShape = (name: string) =>
  name
    .toLowerCase()
    .replace(/\.jar$/, '')
    .replace(/\d+/g, '#')
    .replace(/[^a-z#]+/g, '-');

const sameFile = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z0-9]+/g, '-') === b.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const ghVer = (r: GhRelease, file: string): FreshVersion => ({
  version: fileVersion(file),
  id: r.tag_name,
  date: r.published_at ?? undefined,
  type: r.prerelease ? 'beta' : 'release',
  url: r.html_url,
  file,
});

/**
 * Моды из релизов GitHub (PACK_GIT): по одному запросу на репозиторий. Без токена у GitHub 60 запросов в час с адреса.
 */
export async function checkGit(
  mods: ManifestMod[],
  opts: CheckOpts & { githubToken?: string; repos?: string[] } = {},
): Promise<Map<string, Found>> {
  const f = opts.fetch ?? fetch;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (opts.userAgent) headers['User-Agent'] = opts.userAgent;
  if (opts.githubToken) headers.Authorization = `Bearer ${opts.githubToken}`;
  const out = new Map<string, Found>();
  if (!mods.length) return out;
  const byShape = new Map<string, ManifestMod[]>();
  for (const m of mods) byShape.set(jarShape(m.jar), [...(byShape.get(jarShape(m.jar)) ?? []), m]);

  await pool(opts.repos ?? PACK_GIT.repos, opts.concurrency ?? 6, async (repo) => {
    const r = await f(`${GITHUB}/repos/${repo}/releases?per_page=30`, { headers });
    if (!r.ok)
      throw new Error(
        `GitHub ${r.status} ${repo}${r.status === 403 || r.status === 429 ? ' (лимит запросов — задайте GITHUB_TOKEN)' : ''}`,
      );
    const releases = ((await r.json()) as GhRelease[])
      .filter((x) => !x.draft && x.published_at)
      .sort((a, b) => Date.parse(b.published_at as string) - Date.parse(a.published_at as string));
    const jarOf = (x: GhRelease, shape: string) =>
      x.assets.find((a) => /\.jar$/i.test(a.name) && jarShape(a.name) === shape)?.name;
    for (const [shape, list] of byShape) {
      const withJar = releases.filter((x) => jarOf(x, shape));
      if (!withJar.length) continue;
      const rel = withJar.find((x) => !x.prerelease);
      const newest = withJar[0];
      const latest = rel ?? newest;
      const beta = rel && newest !== rel ? newest : undefined;
      for (const mod of list) {
        const cur = releases.find((x) => x.assets.some((a) => sameFile(a.name, mod.jar)));
        out.set(mod.id, {
          source: 'git',
          project: { id: repo, url: `https://github.com/${repo}`, title: repo.split('/')[1] },
          current: cur ? ghVer(cur, jarOf(cur, shape) as string) : { version: fileVersion(mod.jar), file: mod.jar },
          latest: ghVer(latest, jarOf(latest, shape) as string),
          ...(beta ? { beta: ghVer(beta, jarOf(beta, shape) as string) } : {}),
          ...(cur ? {} : { note: 'нашего файла нет среди релизов — сравнение по номеру версии' }),
        });
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------- отчёт

/** Статус мода по найденным версиям; сравниваются строки платформы (наш файл и новый), не mods.toml */
export function classify(mod: ManifestMod, found: Found | undefined, own = false): FreshMod {
  const base: FreshMod = { id: mod.id, name: mod.name, jar: mod.jar, version: mod.version, status: 'missing' };
  if (mod.sha1) base.sha1 = mod.sha1;
  if (mod.cf !== undefined) base.cf = mod.cf;
  if (own) return { ...base, status: 'own', source: 'own' };
  if (!found?.current || !found.latest) return base;
  const r: FreshMod = { ...base, ...found };
  if (found.latest.file && found.latest.file === found.current.file) return { ...r, status: 'ok' };
  if (found.latest.version === found.current.version && found.latest.date === found.current.date)
    return { ...r, status: 'ok' };
  const level =
    found.current.version === found.latest.version && found.current.file && found.latest.file
      ? lagLevel(...fileTails(found.current.file, found.latest.file))
      : lagLevel(found.current.version, found.latest.version);
  if (!level) {
    const newer = Date.parse(found.latest.date ?? '') > Date.parse(found.current.date ?? '');
    return newer
      ? { ...r, status: 'unknown', note: 'схема версий сменилась — сравнить по номерам нельзя, новая версия свежее' }
      : { ...r, status: 'ok' };
  }
  return { ...r, status: LEVEL_STATUS[level], level };
}

const levelRank = (m: FreshMod) => (m.level ? ['major', 'minor', 'patch', 'pre'].indexOf(m.level) : 9);

export function sortMods(mods: FreshMod[]): FreshMod[] {
  return [...mods].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      levelRank(a) - levelRank(b) ||
      a.name.localeCompare(b.name, 'ru'),
  );
}

export function countStatuses(mods: FreshMod[]): Record<FreshStatus, number> {
  const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<FreshStatus, number>;
  for (const m of mods) c[m.status]++;
  return c;
}

export interface BuildOpts extends CheckOpts {
  /** Ключ CurseForge; без него CurseForge пропускается */
  curseforgeKey?: string;
  /** id модов-аддонов из tools/ — статус «наш аддон» */
  ownIds?: Iterable<string>;
  /** Уже известные находки CurseForge (сайт перепроверяет только Modrinth) */
  curseforgeKnown?: Map<string, Found>;
  curseforgeState?: SourceState;
  /** Токен GitHub (необязателен: без него 60 запросов в час) */
  githubToken?: string;
  /** Находки гита из прошлого отчёта — на случай, если GitHub сейчас не ответил */
  gitKnown?: Map<string, Found>;
  manifestBuiltAt?: number;
}

/**
 * Отчёт целиком: Modrinth по sha1, CurseForge — для тех, кого нет на Modrinth, гит сборки — для оставшихся.
 * Ошибка источника не роняет отчёт.
 */
export async function buildReport(mods: ManifestMod[], opts: BuildOpts = {}): Promise<FreshReport> {
  const own = new Set(opts.ownIds ?? []);
  const sources: FreshReport['sources'] = {
    modrinth: { state: 'ok', checkedAt: Date.now() },
    curseforge: opts.curseforgeState ?? { state: 'skipped', note: 'нет ключа CURSE_FORGE_API_KEY' },
  };
  let mr = new Map<string, Found>();
  try {
    mr = await checkModrinth(mods, opts);
    sources.modrinth.found = mr.size;
  } catch (e) {
    sources.modrinth = { state: 'error', note: (e as Error).message, checkedAt: Date.now() };
  }
  let cf = opts.curseforgeKnown ?? new Map<string, Found>();
  if (opts.curseforgeKey) {
    try {
      cf = await checkCurseForge(
        mods.filter((m) => !mr.has(m.id) && !own.has(m.id)),
        opts.curseforgeKey,
        opts,
      );
      sources.curseforge = { state: 'ok', found: cf.size, checkedAt: Date.now() };
    } catch (e) {
      sources.curseforge = { state: 'error', note: (e as Error).message, checkedAt: Date.now() };
    }
  }
  let git = new Map<string, Found>();
  try {
    git = await checkGit(
      mods.filter((m) => !mr.has(m.id) && !cf.has(m.id) && !own.has(m.id)),
      opts,
    );
    sources.git = { state: 'ok', found: git.size, checkedAt: Date.now() };
  } catch (e) {
    git = opts.gitKnown ?? git;
    sources.git = { state: 'error', note: (e as Error).message, checkedAt: Date.now() };
  }
  const list = sortMods(mods.map((m) => classify(m, mr.get(m.id) ?? cf.get(m.id) ?? git.get(m.id), own.has(m.id))));
  return {
    version: 1,
    generatedAt: Date.now(),
    ...(opts.manifestBuiltAt ? { manifestBuiltAt: opts.manifestBuiltAt } : {}),
    game: { ...GAME },
    sources,
    counts: countStatuses(list),
    mods: list,
  };
}

/** Находки источника из готового отчёта — чтобы сайт перепроверял Modrinth, не теряя CurseForge (ключ не в браузере) */
export function sourceFound(report: FreshReport, source: FreshSource): Map<string, Found> {
  const out = new Map<string, Found>();
  for (const m of report.mods)
    if (m.source === source)
      out.set(m.id, {
        source: m.source,
        project: m.project,
        current: m.current,
        latest: m.latest,
        beta: m.beta,
        newDeps: m.newDeps,
        note: m.note,
      });
  return out;
}
