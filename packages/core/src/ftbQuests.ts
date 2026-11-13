/**
 * Книга квестов FTB Quests (config/ftbquests/quests/): главы *.snbt + тексты lang/<язык>.snbt → вид для сайта и MCP.
 * Тексты FTB Quests 2101.x хранит отдельно от глав, по одному файлу на язык, ключи «quest.<id>.title»;
 * чего нет в выбранном языке — берётся из en_us (как в игре).
 */
import { snbtNum, type SnbtCompound, type SnbtValue } from './snbt.ts';

export interface QuestRef {
  /** предмет «mod:id» или тег «#c:ingots/copper» */
  id: string;
  count?: number;
}

export interface QuestTask {
  id: string;
  type: string;
  title?: string;
  /** item: подходящие предметы и теги (из фильтра FTB Filter System — все варианты из or(…)) */
  items?: QuestRef[];
  /** текст фильтра, если он сложнее перечня предметов и тегов */
  filter?: string;
  count?: number;
  optional?: boolean;
  /** advancement, kill, observation, dimension… — главное поле задачи */
  target?: string;
}

export interface QuestReward {
  id: string;
  type: string;
  item?: QuestRef;
  xp?: number;
  title?: string;
}

export interface Quest {
  id: string;
  x: number;
  y: number;
  size?: number;
  shape?: string;
  title: string;
  subtitle?: string;
  desc: string[];
  /** предмет-иконка (свой или первого предмета задачи) */
  icon?: string;
  deps: string[];
  tasks: QuestTask[];
  rewards: QuestReward[];
  optional?: boolean;
  invisible?: boolean;
  /** «one_completed» — хватит любой из зависимостей */
  depMode?: string;
}

export interface QuestChapter {
  id: string;
  filename: string;
  group: string;
  order: number;
  title: string;
  subtitle?: string;
  icon?: string;
  quests: Quest[];
}

export interface QuestBook {
  locale: string;
  groups: { id: string; title: string }[];
  chapters: QuestChapter[];
}

export interface QuestFiles {
  /** chapter_groups.snbt */
  groups?: SnbtValue;
  /** chapters/*.snbt */
  chapters: SnbtValue[];
  /** lang/<язык>.snbt по языкам */
  lang: Record<string, SnbtValue>;
}

/**
 * Прочтёт ли FTB Quests id: мод берёт Long.parseLong(hex), и 16 цифр с первой 8–F переполняют long — тогда он молча
 * выдаёт объекту случайный id при каждой загрузке, а тексты lang и зависимости по старому id теряются. 0 и 1 заняты.
 */
export const isQuestIdReadable = (s: string) =>
  /^[0-9A-F]{1,16}$/i.test(s) && (s.length < 16 || s[0] <= '7') && !/^0*[01]$/.test(s);

/** Новый id объекта квестов: 16 шестнадцатеричных цифр, как у FTB Quests (первая 0–7, см. isQuestIdReadable) */
export function newQuestId(taken: Set<string> = new Set()): string {
  for (;;) {
    let s = '01234567'[Math.floor(Math.random() * 8)];
    for (let i = 1; i < 16; i++) s += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
    if (isQuestIdReadable(s) && !taken.has(s)) {
      taken.add(s);
      return s;
    }
  }
}

/** Ключ текста: chapter.<id>.title, quest.<id>.quest_desc, task.<id>.title, chapter_group.<id>.title */
export const langKey = (kind: string, id: string, field: string) => `${kind}.${id}.${field}`;

/** Коды форматирования Minecraft (&a, &l, &r) и экранированный амперсанд «\&» → чистый текст */
export function plainQuestText(s: string): string {
  return s
    .replace(/(^|[^\\])&[0-9a-fk-or]/gi, '$1')
    .replace(/(^|[^\\])&[0-9a-fk-or]/gi, '$1')
    .replace(/\\&/g, '&')
    .replace(/\{@pagebreak\}/g, '')
    .replace(/\{image:[^}]*\}/g, '')
    .trimEnd();
}

const obj = (v: unknown): SnbtCompound | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as SnbtCompound) : null;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const list = (v: unknown): SnbtValue[] => (Array.isArray(v) ? v : []);

/**
 * Фильтр FTB Filter System → перечень предметов и тегов, если он из одних item()/item_tag(), соединённых or().
 * Иначе — null (фильтр показывается текстом).
 */
export function filterRefs(filter: string): QuestRef[] | null {
  const out: QuestRef[] = [];
  const rest = filter.replace(/\b(item|item_tag)\(([a-z0-9_.-]+:[a-z0-9_./-]+)\)/g, (_m, kind, id) => {
    out.push({ id: kind === 'item_tag' ? `#${id}` : id });
    return '';
  });
  return out.length && /^[\sor()]*$/.test(rest) ? out : null;
}

/** Стек предмета из задачи или награды: «mod:id», { id, count, components } или умный фильтр */
export function stackRefs(v: unknown): { refs: QuestRef[]; filter?: string } {
  if (typeof v === 'string') return { refs: [{ id: v }] };
  const o = obj(v);
  if (!o) return { refs: [] };
  const id = str(o.id) ?? '';
  const count = snbtNum(o.count, 1);
  const comps = obj(o.components);
  const filter = str(comps?.['ftbfiltersystem:filter']);
  if (id === 'ftbfiltersystem:smart_filter' && filter) {
    const refs = filterRefs(filter);
    return refs ? { refs } : { refs: [], filter };
  }
  return { refs: id ? [{ id, ...(count !== 1 ? { count } : {}) }] : [] };
}

/** Иконка объекта: предмет или null (свои картинки ftbquests:custom_icon сайт не показывает) */
function iconOf(v: unknown): string | undefined {
  const { refs } = stackRefs(v);
  const id = refs[0]?.id;
  return id && !id.startsWith('#') && id !== 'ftbquests:custom_icon' ? id : undefined;
}

/** Тексты: выбранный язык поверх en_us */
export function questTexts(lang: Record<string, SnbtValue>, locale: string) {
  const fallback = obj(lang.en_us) ?? {};
  const main = obj(lang[locale]) ?? {};
  const get = (k: string): SnbtValue | undefined => main[k] ?? fallback[k];
  return {
    text: (k: string) => {
      const v = get(k);
      return typeof v === 'string' ? plainQuestText(v) : Array.isArray(v) ? plainQuestText(v.join('\n')) : undefined;
    },
    lines: (k: string) => {
      const v = get(k);
      const arr = typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
      return arr.map((x) => plainQuestText(x as string));
    },
  };
}

const TASK_TARGET: Record<string, string> = {
  advancement: 'advancement',
  kill: 'entity',
  dimension: 'dimension',
  biome: 'biome',
  structure: 'structure',
  observation: 'to_observe',
  block: 'block',
  fluid: 'fluid',
  stat: 'stat',
  gamestage: 'stage',
};

function taskOf(t: SnbtCompound, text: ReturnType<typeof questTexts>['text']): QuestTask {
  const id = str(t.id) ?? '';
  const type = str(t.type) ?? '?';
  const out: QuestTask = { id, type };
  const title = text(langKey('task', id, 'title'));
  if (title) out.title = title;
  if (type === 'item') {
    const { refs, filter } = stackRefs(t.item);
    if (refs.length) out.items = refs;
    if (filter) out.filter = filter;
    const count = snbtNum(t.count, 1);
    if (count !== 1) out.count = count;
  } else if (type === 'fluid') {
    const f = obj(t.fluid);
    if (f && str(f.id)) out.target = str(f.id);
    const amount = snbtNum(t.amount, 0);
    if (amount) out.count = amount;
  } else if (TASK_TARGET[type]) {
    const v = t[TASK_TARGET[type]];
    if (typeof v === 'string') out.target = v;
    const count = snbtNum(t.value ?? t.count, 0);
    if (count > 1) out.count = count;
  }
  if (t.optional_task === true) out.optional = true;
  return out;
}

function rewardOf(r: SnbtCompound, text: ReturnType<typeof questTexts>['text']): QuestReward {
  const id = str(r.id) ?? '';
  const type = str(r.type) ?? '?';
  const out: QuestReward = { id, type };
  const title = text(langKey('reward', id, 'title'));
  if (title) out.title = title;
  if (type === 'item') {
    const ref = stackRefs(r.item).refs[0];
    if (ref) out.item = { ...ref, ...(snbtNum(r.count, 1) > 1 ? { count: snbtNum(r.count, 1) } : {}) };
  } else if (type === 'xp' || type === 'xp_levels') out.xp = snbtNum(r.xp ?? r.xp_levels, 0);
  return out;
}

/** Одна глава в вид для сайта */
export function chapterOf(raw: SnbtValue, texts: ReturnType<typeof questTexts>): QuestChapter | null {
  const c = obj(raw);
  const id = str(c?.id);
  if (!c || !id) return null;
  const { text, lines } = texts;
  const quests: Quest[] = [];
  for (const qv of list(c.quests)) {
    const q = obj(qv);
    const qid = str(q?.id);
    if (!q || !qid) continue;
    const tasks = list(q.tasks)
      .map(obj)
      .filter((t): t is SnbtCompound => !!t)
      .map((t) => taskOf(t, text));
    const rewards = list(q.rewards)
      .map(obj)
      .filter((r): r is SnbtCompound => !!r)
      .map((r) => rewardOf(r, text));
    const firstItem = tasks.find((t) => t.items?.length && !t.items[0].id.startsWith('#'))?.items?.[0].id;
    const quest: Quest = {
      id: qid,
      x: snbtNum(q.x),
      y: snbtNum(q.y),
      title: text(langKey('quest', qid, 'title')) ?? tasks[0]?.title ?? '',
      desc: lines(langKey('quest', qid, 'quest_desc')),
      deps: list(q.dependencies).filter((d): d is string => typeof d === 'string'),
      tasks,
      rewards,
    };
    const size = snbtNum(q.size, 0);
    if (size) quest.size = size;
    if (str(q.shape)) quest.shape = str(q.shape);
    const subtitle = text(langKey('quest', qid, 'quest_subtitle'));
    if (subtitle) quest.subtitle = subtitle;
    const icon = iconOf(q.icon) ?? firstItem;
    if (icon) quest.icon = icon;
    if (q.optional === true) quest.optional = true;
    if (q.invisible === true) quest.invisible = true;
    if (str(q.dependency_requirement)) quest.depMode = str(q.dependency_requirement);
    quests.push(quest);
  }
  const chapter: QuestChapter = {
    id,
    filename: str(c.filename) ?? id,
    group: str(c.group) ?? '',
    order: snbtNum(c.order_index),
    title: text(langKey('chapter', id, 'title')) ?? str(c.filename) ?? id,
    quests,
  };
  const subtitle = texts.lines(langKey('chapter', id, 'chapter_subtitle')).join('\n');
  if (subtitle) chapter.subtitle = subtitle;
  const icon = iconOf(c.icon);
  if (icon) chapter.icon = icon;
  return chapter;
}

/** Вся книга: группы по порядку из chapter_groups.snbt, главы по order_index */
export function buildQuestBook(files: QuestFiles, locale = 'ru_ru'): QuestBook {
  const texts = questTexts(files.lang, locale);
  const groups = list(obj(files.groups)?.chapter_groups)
    .map((g) => str(obj(g)?.id))
    .filter((id): id is string => !!id)
    .map((id) => ({ id, title: texts.text(langKey('chapter_group', id, 'title')) ?? id }));
  const chapters = files.chapters
    .map((c) => chapterOf(c, texts))
    .filter((c): c is QuestChapter => !!c)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  // Главы без группы (или с удалённой) — в начале книги, как в игре
  for (const c of chapters) if (!groups.some((g) => g.id === c.group)) c.group = '';
  if (chapters.some((c) => !c.group)) groups.unshift({ id: '', title: '' });
  return { locale, groups, chapters };
}
