/**
 * Правка главы FTB Quests по спецификации (JSON от агента или редактора) → узел главы SNBT и строки языков.
 * Чистая функция: файлы читает и пишет вызывающий (MCP quest_chapter_put). Поля, которых спецификация не касается
 * (фоны Quest Enhance, флаги скрытия, свои иконки), у существующих квестов и задач сохраняются.
 */
import { isQuestIdReadable, langKey, newQuestId, stackRefs } from './ftbQuests.ts';
import { snbtDouble, snbtInline, snbtLong, snbtNum, type SnbtCompound, type SnbtValue } from './snbt.ts';

/** Текст на языке: строка — русский; { ru, en } — оба */
export type SpecText = string | { ru?: string; en?: string };
export type SpecLines = string | string[] | { ru?: string | string[]; en?: string | string[] };

export interface SpecTask {
  /** существующая задача: только id — оставить как есть */
  id?: string;
  type?: string;
  /** предмет «mod:id» или тег «#c:…» */
  item?: string;
  /** любой из предметов/тегов (фильтр or(…)) */
  items?: string[];
  count?: number;
  title?: SpecText;
  optional?: boolean;
  /** advancement: id достижения; criterion — необязательно */
  advancement?: string;
  criterion?: string;
}

export interface SpecReward {
  id?: string;
  type?: string;
  xp?: number;
  item?: string;
  count?: number;
}

export interface SpecQuest {
  /** существующий квест */
  id?: string;
  /** метка нового квеста для ссылок в deps (в файл не попадает) */
  ref?: string;
  title?: SpecText;
  subtitle?: SpecText;
  desc?: SpecLines;
  x?: number;
  y?: number;
  size?: number;
  shape?: string;
  /** предмет-иконка; '' — убрать */
  icon?: string;
  /** id квестов (из любой главы) или ref квестов этой спецификации */
  deps?: string[];
  /** all (по умолчанию) или one — хватит любой зависимости */
  depMode?: 'all' | 'one';
  optional?: boolean;
  tasks?: SpecTask[];
  rewards?: SpecReward[];
}

export interface ChapterSpec {
  /** имя файла главы (chapters/<filename>.snbt), латиница */
  filename?: string;
  title?: SpecText;
  subtitle?: SpecLines;
  /** id группы глав */
  group?: string;
  icon?: string;
  order?: number;
  /** merge (по умолчанию) — перечисленные квесты добавить/обновить, остальные оставить; replace — глава ровно такая */
  mode?: 'merge' | 'replace';
  quests?: SpecQuest[];
  /** id квестов на удаление (merge) */
  remove?: string[];
}

export interface EditContext {
  /** все id объектов книги (квесты, задачи, награды, главы) — новые не совпадут */
  takenIds: Set<string>;
  /** id квестов всей книги — для проверки зависимостей между главами */
  questIds: Set<string>;
  /** есть ли предмет или тег («#…»); нет функции — не проверяется */
  knownItem?: (id: string) => boolean;
  /** группы глав: id → название */
  groups?: Map<string, string>;
}

export interface EditResult {
  chapter: SnbtCompound;
  /** изменённые таблицы языков: ru_ru, en_us */
  lang: Record<string, SnbtCompound>;
  /** ref → новый id */
  refs: Record<string, string>;
  added: string[];
  updated: string[];
  removed: string[];
  warnings: string[];
}

const obj = (v: unknown): SnbtCompound | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as SnbtCompound) : null;

/** id предмета стека («mod:id» или { id }) */
const stackId = (v: unknown) => (typeof v === 'string' ? v : obj(v)?.id);

/** Ключи по алфавиту — так пишет FTB Quests */
function sorted(o: SnbtCompound): SnbtCompound {
  const out: SnbtCompound = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

function texts(v: SpecText | SpecLines | undefined): { ru?: string | string[]; en?: string | string[] } {
  if (v === undefined) return {};
  if (typeof v === 'string' || Array.isArray(v)) return { ru: v };
  return v;
}

/** Стек для задачи «item»: один предмет — как есть, тег или несколько — умный фильтр FTB Filter System */
export function itemStack(refs: string[]): SnbtCompound {
  if (refs.length === 1 && !refs[0].startsWith('#')) return snbtInline({ count: 1, id: refs[0] });
  const parts = refs.map((r) => (r.startsWith('#') ? `item_tag(${r.slice(1)})` : `item(${r})`));
  const filter = parts.length === 1 ? parts[0] : `or(${parts.join(' ')})`;
  return snbtInline({
    components: snbtInline({ 'ftbfiltersystem:filter': filter }),
    count: 1,
    id: 'ftbfiltersystem:smart_filter',
  });
}

/**
 * Заменить в главе id, которые FTB Quests не прочтёт (isQuestIdReadable): глава, квесты, задачи, награды, ссылки на
 * квесты. Зависимости внутри главы и ключи текстов переписываются; возвращает старый id → новый.
 */
function repairIds(
  chapter: SnbtCompound,
  lang: Record<string, SnbtCompound>,
  taken: Set<string>,
  touched: Set<string>,
): Map<string, string> {
  const fixed = new Map<string, string>();
  const fix = (v: unknown) => {
    const id = String(v);
    if (isQuestIdReadable(id)) return id;
    if (!fixed.has(id)) fixed.set(id, newQuestId(taken));
    return fixed.get(id)!;
  };
  chapter.id = fix(chapter.id);
  const quests = (Array.isArray(chapter.quests) ? chapter.quests : []).map(obj).filter((q): q is SnbtCompound => !!q);
  const each = (list: unknown) => (Array.isArray(list) ? list.map(obj).filter((x): x is SnbtCompound => !!x) : []);
  // Сначала все id (зависимость может ссылаться на квест ниже по файлу), потом ссылки
  for (const q of quests) {
    fix(q.id);
    for (const t of each(q.tasks)) fix(t.id);
    for (const r of each(q.rewards)) fix(r.id);
  }
  for (const l of each(chapter.quest_links)) fix(l.id);
  if (!fixed.size) return fixed;
  const to = (v: unknown) => (typeof v === 'string' ? (fixed.get(v) ?? v) : v);
  const relist = (list: unknown) => each(list).map((x) => sorted({ ...x, id: to(String(x.id)) as string }));
  chapter.quests = quests.map((q) => {
    const n: SnbtCompound = {
      ...q,
      id: to(String(q.id)) as string,
      tasks: relist(q.tasks),
      rewards: relist(q.rewards),
    };
    if (Array.isArray(q.dependencies)) n.dependencies = q.dependencies.map(to) as SnbtValue[];
    return sorted(n);
  });
  if (Array.isArray(chapter.quest_links))
    chapter.quest_links = each(chapter.quest_links).map((l) =>
      sorted({ ...l, id: to(String(l.id)) as string, linked_quest: to(l.linked_quest) as SnbtValue }),
    );
  // Ключи текстов kind.<id>.field — на месте, порядок строк файла сохраняется
  for (const loc of Object.keys(lang)) {
    const out: SnbtCompound = {};
    for (const [k, v] of Object.entries(lang[loc])) {
      const [kind, id, ...rest] = k.split('.');
      const renamed = fixed.has(id) && rest.length;
      if (renamed) touched.add(loc);
      out[renamed ? [kind, fixed.get(id), ...rest].join('.') : k] = v;
    }
    lang[loc] = out;
  }
  return fixed;
}

/** Спецификация с id, заменёнными repairIds */
function remapSpec(spec: ChapterSpec, fixed: Map<string, string>): ChapterSpec {
  if (!fixed.size) return spec;
  const to = (id: string | undefined) => (id === undefined ? id : (fixed.get(id) ?? id));
  return {
    ...spec,
    remove: spec.remove?.map((id) => to(id)!),
    quests: spec.quests?.map((q) => ({
      ...q,
      id: to(q.id),
      deps: q.deps?.map((d) => to(d)!),
      tasks: q.tasks?.map((t) => ({ ...t, id: to(t.id) })),
      rewards: q.rewards?.map((r) => ({ ...r, id: to(r.id) })),
    })),
  };
}

export function applyChapterSpec(
  base: SnbtCompound | null,
  langIn: Record<string, SnbtCompound>,
  spec: ChapterSpec,
  ctx: EditContext,
): EditResult {
  const warnings: string[] = [];
  const lang: Record<string, SnbtCompound> = { ru_ru: { ...(langIn.ru_ru ?? {}) }, en_us: { ...(langIn.en_us ?? {}) } };
  const touched = new Set<string>();
  const setText = (key: string, v: SpecText | SpecLines | undefined, asList = false) => {
    const t = texts(v);
    for (const [loc, val] of [
      ['ru_ru', t.ru],
      ['en_us', t.en],
    ] as const) {
      if (val === undefined) continue;
      const was = lang[loc][key];
      const next = asList ? (Array.isArray(val) ? val : val.split('\n')) : Array.isArray(val) ? val.join('\n') : val;
      const empty = Array.isArray(val) ? !val.length : !val;
      if (empty ? was === undefined : JSON.stringify(was) === JSON.stringify(next)) continue;
      touched.add(loc);
      if (empty) delete lang[loc][key];
      else lang[loc][key] = next;
    }
  };
  const dropTexts = (kind: string, id: string) => {
    for (const loc of Object.keys(lang))
      for (const k of Object.keys(lang[loc]))
        if (k.startsWith(`${kind}.${id}.`)) {
          delete lang[loc][k];
          touched.add(loc);
        }
  };
  const checkItem = (id: string, where: string) => {
    if (ctx.knownItem && !ctx.knownItem(id)) warnings.push(`${where}: нет предмета/тега ${id}`);
  };

  // ---- глава
  const isNew = !base;
  const chapter: SnbtCompound = base
    ? { ...base }
    : {
        default_hide_dependency_lines: false,
        default_quest_shape: '',
        filename: spec.filename ?? '',
        group: '',
        id: newQuestId(ctx.takenIds),
        images: [],
        order_index: 0,
        quest_links: [],
        quests: [],
      };
  // id, которые игра не прочтёт (сделанные старым newQuestId), — заменить; spec мог ссылаться на старые
  const fixed = isNew ? new Map<string, string>() : repairIds(chapter, lang, ctx.takenIds, touched);
  if (fixed.size) {
    const oldId = String(base?.id);
    const head = fixed.get(oldId);
    warnings.push(
      `заменено id: ${fixed.size}${head ? ` (глава ${oldId} → ${head})` : ''} — FTB Quests не читает id с первой цифрой 8–F: ` +
        'выдаёт случайный при каждой загрузке, тексты и зависимости по старому id теряются. Зависимости из других глав на старые id — поправить вручную',
    );
  }
  spec = remapSpec(spec, fixed);
  const chapterId = String(chapter.id);
  if (isNew && !spec.filename) throw new Error('новой главе нужен filename (латиница: chemistry)');
  if (spec.filename !== undefined) {
    if (!/^[A-Za-z0-9_]+$/.test(spec.filename))
      throw new Error(`filename «${spec.filename}»: только латиница, цифры, _`);
    chapter.filename = spec.filename;
  }
  if (spec.group !== undefined) {
    if (spec.group && ctx.groups && !ctx.groups.has(spec.group))
      warnings.push(`группы ${spec.group} нет; есть: ${[...ctx.groups].map(([id, t]) => `${id} «${t}»`).join(', ')}`);
    chapter.group = spec.group;
  }
  if (spec.order !== undefined) chapter.order_index = spec.order;
  if (spec.icon !== undefined) {
    if (spec.icon && spec.icon === stackId(chapter.icon)) {
      /* тот же предмет — стек с компонентами не трогаем */
    } else if (spec.icon) {
      checkItem(spec.icon, 'иконка главы');
      chapter.icon = snbtInline({ count: 1, id: spec.icon });
    } else delete chapter.icon;
  }
  if (isNew && spec.title === undefined) throw new Error('новой главе нужен title');
  setText(langKey('chapter', chapterId, 'title'), spec.title);
  setText(langKey('chapter', chapterId, 'chapter_subtitle'), spec.subtitle, true);

  // ---- квесты
  const oldQuests = (Array.isArray(chapter.quests) ? chapter.quests : [])
    .map(obj)
    .filter((q): q is SnbtCompound => !!q);
  const byId = new Map(oldQuests.map((q) => [String(q.id), q]));
  const refs: Record<string, string> = {};
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  const specQuests = spec.quests ?? [];

  // id новых квестов — заранее, чтобы deps могли ссылаться вперёд
  const newIds = new Map<SpecQuest, string>();
  for (const sq of specQuests) {
    if (sq.id) {
      if (!byId.has(sq.id)) throw new Error(`квеста ${sq.id} нет в главе; новый — без id (можно с ref)`);
      continue;
    }
    const id = newQuestId(ctx.takenIds);
    if (sq.ref) {
      if (refs[sq.ref]) throw new Error(`ref «${sq.ref}» повторяется`);
      refs[sq.ref] = id;
    }
    newIds.set(sq, id);
  }
  const chapterQuestIds = new Set([...byId.keys(), ...Object.values(refs)]);

  const result = new Map<string, SnbtCompound>();
  for (const sq of specQuests) {
    const id = sq.id ?? newIds.get(sq)!;
    const label = `квест ${sq.ref ?? id}`;
    const q: SnbtCompound = sq.id
      ? { ...byId.get(id)! }
      : { id, rewards: [], tasks: [], x: snbtDouble(0), y: snbtDouble(0) };
    if (sq.x !== undefined) q.x = snbtDouble(sq.x);
    if (sq.y !== undefined) q.y = snbtDouble(sq.y);
    if (!sq.id && (sq.x === undefined || sq.y === undefined)) warnings.push(`${label}: нет x/y — поставлен в 0,0`);
    if (sq.size !== undefined) q.size = snbtDouble(sq.size);
    if (sq.shape !== undefined) {
      if (sq.shape) q.shape = sq.shape;
      else delete q.shape;
    }
    if (sq.icon !== undefined) {
      if (sq.icon && sq.icon === stackId(q.icon)) {
        /* тот же предмет */
      } else if (sq.icon) {
        checkItem(sq.icon, `${label}, иконка`);
        q.icon = snbtInline({ count: 1, id: sq.icon });
      } else delete q.icon;
    }
    if (sq.optional !== undefined) {
      if (sq.optional) q.optional = true;
      else delete q.optional;
    }
    if (sq.depMode !== undefined) {
      if (sq.depMode === 'one') q.dependency_requirement = 'one_completed';
      else delete q.dependency_requirement;
    }
    if (sq.deps !== undefined) {
      const deps = sq.deps.map((d) => refs[d] ?? d);
      for (const d of deps)
        if (!chapterQuestIds.has(d) && !ctx.questIds.has(d)) warnings.push(`${label}: зависимость ${d} не найдена`);
      if (deps.includes(id)) throw new Error(`${label} зависит сам от себя`);
      if (deps.length) q.dependencies = deps;
      else delete q.dependencies;
    }
    if (sq.tasks !== undefined && !(sq.tasks.length === 0 && q.tasks === undefined)) {
      const oldTasks = new Map(
        (Array.isArray(q.tasks) ? q.tasks : [])
          .map(obj)
          .filter((t): t is SnbtCompound => !!t)
          .map((t) => [String(t.id), t]),
      );
      const tasks: SnbtCompound[] = [];
      for (const st of sq.tasks) {
        const old = st.id ? oldTasks.get(st.id) : undefined;
        if (st.id && !old) throw new Error(`${label}: задачи ${st.id} нет`);
        const tid = st.id ?? newQuestId(ctx.takenIds);
        const t: SnbtCompound = old
          ? { ...old }
          : { id: tid, type: st.type ?? (st.item || st.items ? 'item' : 'checkmark') };
        if (st.type && old && st.type !== old.type)
          throw new Error(`${label}: тип задачи ${tid} не меняется — новая задача без id`);
        const type = String(t.type);
        if (type === 'item' && (st.item || st.items)) {
          const list = st.items ?? [st.item!];
          // Тот же набор предметов — стек не трогаем (умный фильтр item(x) остаётся фильтром)
          const was = old ? stackRefs(old.item).refs.map((r) => r.id) : [];
          if (was.join(' ') !== list.join(' ')) {
            for (const r of list) checkItem(r, label);
            t.item = itemStack(list);
          }
        } else if (type === 'item' && !old) throw new Error(`${label}: задаче item нужен item или items`);
        if (type === 'advancement') {
          if (st.advancement) t.advancement = st.advancement;
          if (st.criterion !== undefined) t.criterion = st.criterion;
          if (!t.advancement) throw new Error(`${label}: задаче advancement нужен advancement`);
        }
        if (st.count !== undefined) {
          // у задачи item количество — long («16L»)
          if (st.count > 1) t.count = snbtLong(st.count);
          else delete t.count;
        }
        if (st.optional !== undefined) {
          if (st.optional) t.optional_task = true;
          else delete t.optional_task;
        }
        if (!['item', 'checkmark', 'advancement'].includes(type) && !old)
          throw new Error(`${label}: новая задача — item, checkmark или advancement; другие типы правьте в игре`);
        setText(langKey('task', tid, 'title'), st.title);
        tasks.push(sorted(t));
      }
      for (const tid of oldTasks.keys()) if (!tasks.some((t) => t.id === tid)) dropTexts('task', tid);
      if (!tasks.length) warnings.push(`${label}: без задач квест выполняется сам собой`);
      q.tasks = tasks;
    } else if (!sq.id) throw new Error(`${label}: новому квесту нужны tasks`);
    if (sq.rewards !== undefined && !(sq.rewards.length === 0 && q.rewards === undefined)) {
      const oldRewards = new Map(
        (Array.isArray(q.rewards) ? q.rewards : [])
          .map(obj)
          .filter((r): r is SnbtCompound => !!r)
          .map((r) => [String(r.id), r]),
      );
      q.rewards = sq.rewards.map((sr) => {
        const old = sr.id ? oldRewards.get(sr.id) : undefined;
        if (sr.id && !old) throw new Error(`${label}: награды ${sr.id} нет`);
        if (old && Object.keys(sr).length === 1) return old;
        const type = old ? String(old.type) : (sr.type ?? (sr.item ? 'item' : 'xp'));
        const r: SnbtCompound = old ? { ...old } : { id: newQuestId(ctx.takenIds), type };
        if (type === 'xp') r.xp = sr.xp ?? snbtNum(r.xp, 10);
        else if (type === 'item') {
          if (sr.item && sr.item !== stackId(r.item)) {
            checkItem(sr.item, `${label}, награда`);
            r.item = snbtInline({ count: 1, id: sr.item });
          } else if (!old) throw new Error(`${label}: награде item нужен item`);
          if (sr.count !== undefined) {
            if (sr.count > 1) r.count = sr.count;
            else delete r.count;
          }
        } else if (!old) throw new Error(`${label}: новая награда — xp или item`);
        return sorted(r);
      });
    }
    if (!sq.id && sq.title === undefined && !(sq.tasks ?? []).some((t) => t.item || t.items))
      warnings.push(`${label}: нет title — в книге будет пусто`);
    setText(langKey('quest', id, 'title'), sq.title);
    setText(langKey('quest', id, 'quest_subtitle'), sq.subtitle);
    setText(langKey('quest', id, 'quest_desc'), sq.desc, true);
    result.set(id, sorted(q));
    (sq.id ? updated : added).push(id);
  }

  // Порядок: старые на своих местах, новые — в конце
  const drop = new Set(
    spec.mode === 'replace' ? [...byId.keys()].filter((id) => !result.has(id)) : (spec.remove ?? []),
  );
  for (const id of spec.remove ?? []) if (!byId.has(id)) warnings.push(`удалить: квеста ${id} нет в главе`);
  const quests: SnbtValue[] = [];
  for (const q of oldQuests) {
    const id = String(q.id);
    if (drop.has(id)) {
      removed.push(id);
      dropTexts('quest', id);
      for (const t of Array.isArray(q.tasks) ? q.tasks : []) dropTexts('task', String(obj(t)?.id));
      continue;
    }
    quests.push(result.get(id) ?? q);
  }
  for (const id of added) quests.push(result.get(id)!);
  chapter.quests = quests;

  // Ссылки на удалённые квесты
  for (const qv of quests) {
    const q = obj(qv)!;
    const deps = Array.isArray(q.dependencies) ? q.dependencies : [];
    for (const d of deps)
      if (typeof d === 'string' && removed.includes(d)) warnings.push(`квест ${q.id} зависит от удалённого ${d}`);
  }

  // Наложение: два квеста в одной точке
  const at = new Map<string, string>();
  for (const qv of quests) {
    const q = obj(qv)!;
    const k = `${snbtNum(q.x)},${snbtNum(q.y)}`;
    if (at.has(k)) warnings.push(`квесты ${at.get(k)} и ${q.id} в одной точке (${k})`);
    else at.set(k, String(q.id));
  }

  const outLang: Record<string, SnbtCompound> = {};
  // Порядок строк языка — как в файле, новые в конце: правка не пересортировывает чужие строки
  for (const loc of touched) outLang[loc] = lang[loc];
  return { chapter: sorted(chapter), lang: outLang, refs, added, updated, removed, warnings };
}
