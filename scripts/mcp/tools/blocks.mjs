/**
 * Инструменты MCP: раздел «blocks» — переводы всех источников (блоки без предмета, существа, жидкости, эффекты),
 * блок по id и таблицы добычи (прямой и обратный поиск, с глобальными модификаторами NeoForge).
 * Формат таблиц проверен по jar: обычные minecraft:* плюс условия TFC (net.dries007.tfc.util.loot).
 */
import { getTag, flattenTag, directMembers, itemName, items, modLabel, mods, tags, tagsOf } from '../data.mjs';
import { named, norm, page, paging, short, str } from '../fmt.mjs';
import { blockIds, fileSources, lang, loot, readFile } from './blocks-data.mjs';

const bare = (s) => String(s ?? '').replace(/^minecraft:/, '');
const pct = (x) => (typeof x === 'number' ? `${+(x * 100).toFixed(2)}%` : numText(x));

// ---------------------------------------------------------------- названия

function langName(kind, id) {
  const [ns, p = ''] = id.split(':');
  const e = lang().get(`${kind}.${ns}.${p.replaceAll('/', '.')}`);
  return e ? (e.ru ?? e.en) : null;
}

/** id с названием: предмет/жидкость (как named), иначе перевод блока или существа */
function label(id) {
  if (typeof id !== 'string') return '?';
  const n = named(id);
  if (n !== id || id.startsWith('#')) return n;
  const alt = langName('block', id) ?? langName('entity', id);
  return alt ? `${id} «${alt}»` : id;
}

// ---------------------------------------------------------------- текст таблицы добычи

function numText(n) {
  if (typeof n === 'number') return String(+n.toFixed(3));
  if (!n || typeof n !== 'object') return '?';
  const t = bare(n.type ?? ('min' in n || 'max' in n ? 'uniform' : 'constant'));
  if (t === 'constant') return numText(n.value);
  if (t === 'uniform') return `${numText(n.min)}–${numText(n.max)}`;
  if (t === 'binomial') return `биномиально n=${numText(n.n)}, p=${numText(n.p)}`;
  // TFC: lerp(min, max) по урожайности посева (CropBlockEntity.getYield) и по животному (размер, приручённость, урон)
  if (t === 'tfc:crop_yield_uniform') return `${numText(n.min)}…${numText(n.max)} по урожайности посева`;
  if (t === 'tfc:animal_yield') return `${numText(n.min)}…${numText(n.max)} по животному (размер, приручённость)`;
  return short(JSON.stringify(n), 80);
}

function toolText(p) {
  const out = [];
  if (p?.items) out.push([].concat(p.items).join('|'));
  const en = p?.predicates?.['minecraft:enchantments'] ?? p?.enchantments;
  if (en)
    out.push(
      `с чарами ${[]
        .concat(en)
        .map((x) =>
          []
            .concat(x.enchantments ?? '?')
            .map(bare)
            .join('|'),
        )
        .join(', ')}`,
    );
  return out.join(' + ') || short(JSON.stringify(p ?? {}), 80);
}

const COND = {
  survives_explosion: null,
  'tfc:always_true': null,
  killed_by_player: 'убит игроком',
  location_check: 'по месту (location_check)',
  'tfc:is_isolated': 'порода отвалилась без опоры',
  'tfc:not_predated': 'убит не хищником',
  'tfc:is_male': 'самец',
  'tfc:is_sluice': 'в шлюзе',
  'tfc:is_burnt_out': 'догорел',
};

function condText(c) {
  if (!c || typeof c !== 'object') return null;
  const t = bare(c.condition);
  if (t in COND) return COND[t];
  switch (t) {
    case 'random_chance':
      return `шанс ${pct(c.chance)}`;
    case 'random_chance_with_enchanted_bonus':
      return `шанс ${pct(c.unenchanted_chance)}, больше с ${bare(c.enchantment)}`;
    case 'table_bonus':
      return `шанс ${(c.chances ?? []).map(pct).join('/')} по уровню ${bare(c.enchantment)}`;
    case 'match_tool':
      return `инструмент ${toolText(c.predicate)}`;
    case 'inverted': {
      const s = condText(c.term);
      return s ? `не ${s.startsWith('(') ? s : `(${s})`}` : null;
    }
    case 'any_of':
    case 'alternative':
      return `(${(c.terms ?? []).map((x) => condText(x) ?? 'всегда').join(' или ')})`;
    case 'all_of':
      return condsText(c.terms);
    case 'block_state_property':
      return [
        typeof c.block === 'string' ? `блок ${c.block}` : '',
        ...Object.entries(c.properties ?? {}).map(([k, v]) => `${k}=${typeof v === 'object' ? numText(v) : v}`),
      ]
        .filter(Boolean)
        .join(' ');
    case 'entity_properties':
      return `${c.entity ?? 'this'}: ${c.predicate?.type ? `существо ${c.predicate.type}` : short(JSON.stringify(c.predicate ?? {}), 100)}`;
    case 'neoforge:loot_table_id':
      return `таблица ${c.loot_table_id}`;
    case 'neoforge:can_item_perform_ability':
      return `инструмент умеет ${c.ability}`;
    default:
      return c.condition ?? short(JSON.stringify(c), 80);
  }
}

const condsText = (list) => (Array.isArray(list) ? list : []).map(condText).filter(Boolean).join(', ');

const FN = {
  explosion_decay: null,
  copy_components: null,
  copy_name: null,
  copy_state: null,
  set_components: 'свои компоненты',
  set_damage: 'износ',
  enchant_randomly: 'случайные чары',
  enchant_with_levels: 'чары по уровню',
  'tfc:rotten': 'гнилое',
  'tfc:copy_fluid': 'с жидкостью блока',
  'tfc:apply_stack_size': 'вес по размеру TFC',
};

/** «×1–4; гнилое» — количество и заметные функции предмета */
function itemFx(e) {
  let count = '×1';
  const fx = [];
  for (const f of e.functions ?? []) {
    const fn = bare(f.function);
    const when = condsText(f.conditions);
    let s;
    if (fn === 'set_count') {
      if (!when && !f.add) {
        count = `×${numText(f.count)}`;
        continue;
      }
      s = `${f.add ? '+' : '×'}${numText(f.count)}`;
    } else if (fn === 'apply_bonus') s = `больше с ${bare(f.enchantment)}`;
    else if (fn === 'enchanted_count_increase' || fn === 'looting_enchant')
      s = `+${numText(f.count)} за уровень ${bare(f.enchantment ?? 'looting')}`;
    else if (fn === 'limit_count') s = `предел ${short(JSON.stringify(f.limit), 60)}`;
    else s = fn in FN ? FN[fn] : fn;
    if (s) fx.push(when ? `${s} если ${when}` : s);
  }
  return [count, ...fx].join('; ');
}

const GROUPS = { alternatives: 'первое подходящее из', sequence: 'по порядку, пока срабатывает', group: 'все сразу' };

function entryLines(e, ind, depth, total) {
  const t = bare(e.type);
  const c = condsText(e.conditions);
  const tail = [total ? `вес ${e.weight ?? 1} из ${total}` : '', c && `если ${c}`].filter(Boolean).join('; ');
  const suf = tail ? ` — ${tail}` : '';
  if (t === 'item') return [`${ind}• ${label(e.name)} ${itemFx(e)}${suf}`];
  if (t === 'tag')
    return [`${ind}• тег #${e.name} (${e.expand ? 'один предмет тега' : 'все предметы тега'}) ${itemFx(e)}${suf}`];
  if (t === 'empty') return [`${ind}• ничего${suf}`];
  if (t === 'loot_table') {
    const ref = e.value ?? e.name;
    if (typeof ref !== 'string')
      return [`${ind}• встроенная таблица${suf}:`, ...tablePools(ref, `${ind}    `, depth + 1)];
    const sub = loot().tables.get(ref);
    const out = [`${ind}• таблица ${ref}${suf}${sub ? '' : ' (такой таблицы нет)'}`];
    if (sub && depth < 2) out.push(...tablePools(sub.json, `${ind}    `, depth + 1));
    return out;
  }
  if (t in GROUPS)
    return [`${ind}• ${GROUPS[t]}${suf}:`, ...(e.children ?? []).flatMap((ch) => entryLines(ch, `${ind}  `, depth, 0))];
  return [`${ind}• ${e.type}${suf}`];
}

function tablePools(json, ind, depth) {
  const out = [];
  (json?.pools ?? []).forEach((pool, i) => {
    const head = [`пул ${i + 1}`];
    const rolls = numText(pool.rolls ?? 1);
    if (rolls !== '1') head.push(`бросков ${rolls}`);
    if (pool.bonus_rolls && pool.bonus_rolls !== 0) head.push(`+${numText(pool.bonus_rolls)} за удачу`);
    const c = condsText(pool.conditions);
    out.push(`${ind}${head.join(', ')}${c ? ` — если ${c}` : ''}:`);
    const entries = pool.entries ?? [];
    const total = entries.length > 1 ? entries.reduce((n, e) => n + (e.weight ?? 1), 0) : 0;
    for (const e of entries) out.push(...entryLines(e, `${ind}  `, depth, total));
  });
  return out;
}

// ---------------------------------------------------------------- вид таблицы и модификаторы

const TYPE_RU = {
  chest: 'сундук',
  fishing: 'рыбалка',
  barter: 'обмен',
  gift: 'подарок',
  archaeology: 'археология',
  advancement_reward: 'награда',
  empty: 'вызывается кодом мода',
  block: 'блок',
  entity: 'существо',
};

function tableKind(t) {
  const p = t.id.split(':')[1];
  if (p.startsWith('blocks/')) return 'block';
  if (p.startsWith('entities/')) return 'entity';
  if (p.startsWith('chests/')) return 'chest';
  const ty = bare(t.json?.type);
  return ['block', 'entity', 'chest'].includes(ty) ? ty : 'other';
}

/** Блок или существо, чья это таблица по имени: tfc:blocks/x → tfc:x */
function subjectOf(t) {
  const [ns, p] = t.id.split(':');
  const m = /^(blocks|entities)\/(.+)$/.exec(p);
  return m ? { kind: m[1] === 'blocks' ? 'block' : 'entity', id: `${ns}:${m[2]}` } : null;
}

function tableLabel(t) {
  const s = subjectOf(t);
  let what;
  if (s?.kind === 'block') {
    const n = langName('block', s.id) ?? itemName(s.id);
    what = `блок${n ? ` «${n}»` : ''}`;
  } else if (s?.kind === 'entity') {
    const n = langName('entity', s.id);
    what = `существо${n ? ` «${n}»` : ''}`;
  } else what = TYPE_RU[bare(t.json?.type)] ?? (bare(t.json?.type) || 'без типа');
  return `${t.id} (${what})${t.disabled ? ' — отключена' : ''}`;
}

const REMOVE_KEYS = new Set(['removals', 'targets', 'remove']);
const SKIP_KEYS = new Set(['conditions', 'type', 'target']);

/** Что модификатор добавляет/убирает и на что нацелен (по условиям) */
function glmInfo(m) {
  if (m.info) return m.info;
  const i = {
    tables: new Set(),
    blocks: new Set(),
    entities: new Set(),
    adds: new Set(),
    addTables: new Set(),
    removes: new Set(),
  };
  const walkC = (c) => {
    if (Array.isArray(c)) return c.forEach(walkC);
    if (!c || typeof c !== 'object') return;
    const t = bare(c.condition);
    if (t === 'inverted') return;
    if (typeof c.loot_table_id === 'string') i.tables.add(c.loot_table_id);
    if (typeof c.block === 'string') i.blocks.add(c.block);
    if (t === 'entity_properties' && (c.entity ?? 'this') === 'this' && typeof c.predicate?.type === 'string')
      i.entities.add(c.predicate.type);
    if (t === 'any_of' || t === 'alternative' || t === 'all_of') walkC(c.terms);
  };
  walkC(m.json?.conditions);
  const walkA = (o, key) => {
    if (typeof o === 'string') {
      if (key === 'table') i.addTables.add(o);
      else if (items().byId.has(o)) (REMOVE_KEYS.has(key) ? i.removes : i.adds).add(o);
    } else if (Array.isArray(o)) o.forEach((x) => walkA(x, key));
    else if (o && typeof o === 'object')
      for (const [k, v] of Object.entries(o)) if (!SKIP_KEYS.has(k)) walkA(v, REMOVE_KEYS.has(key) ? key : k);
  };
  walkA(m.json, '');
  m.info = i;
  return i;
}

function glmHits(t) {
  const s = subjectOf(t);
  const out = [];
  for (const m of loot().modifiers.values()) {
    const i = glmInfo(m);
    let hit = i.tables.has(t.id);
    if (!hit && s?.kind === 'block') hit = i.blocks.has(s.id);
    if (!hit && s?.kind === 'entity')
      hit =
        i.entities.has(s.id) ||
        [...i.entities].some((e) => e.startsWith('#') && tagsOf('entity_type', s.id).includes(e.slice(1)));
    if (hit) out.push(m);
  }
  return out;
}

function glmText(m) {
  const i = glmInfo(m);
  const parts = [];
  if (i.adds.size) parts.push(`добавляет ${[...i.adds].map(label).join(', ')}`);
  if (i.addTables.size) parts.push(`добавляет таблицу ${[...i.addTables].join(', ')}`);
  if (i.removes.size) parts.push(`убирает ${[...i.removes].map(label).join(', ')}`);
  const c = condsText(m.json?.conditions);
  return (
    `модификатор ${m.id} [${m.json?.type ?? '?'}; ${m.src}]${m.active ? '' : ' — НЕ подключён в global_loot_modifiers.json, не действует'}: ` +
    `${parts.join('; ') || 'меняет добычу'}${c ? `; если ${c}` : ''}`
  );
}

function tableLines(t, raw) {
  const out = [`Таблица ${tableLabel(t)} [${t.json?.type ?? 'без типа'}] — ${t.src}: ${t.file}`];
  if (t.over.length) out.push(`перекрывает тот же файл из: ${t.over.join(', ')}`);
  if (t.disabled) out.push('отключена (neoforge:false или пустая) — ничего не выпадает');
  else if (!t.json) out.push('файл не разбирается как JSON');
  else out.push(...tablePools(t.json, '', 0));
  if (!t.disabled && t.json && !t.json.pools?.length) out.push('пулов нет — ничего не выпадает');
  const glm = glmHits(t);
  if (glm.length) out.push('глобальные модификаторы добычи:', ...glm.map((m) => `  ${glmText(m)}`));
  if (raw) out.push('JSON:', short(JSON.stringify(t.json), 8000));
  return out;
}

// ---------------------------------------------------------------- обратный индекс

/** Все выпадения таблицы: предмет, тег (#…) или вложенная таблица (@…) с условиями по пути */
function walkDrops(json, emit, conds = []) {
  for (const pool of json?.pools ?? []) {
    const visit = (e, up) => {
      const c = [...up, ...(e.conditions ?? [])];
      const t = bare(e.type);
      if (t === 'item' && typeof e.name === 'string') emit({ ref: e.name, e, conds: c });
      else if (t === 'tag' && typeof e.name === 'string') emit({ ref: `#${e.name}`, e, conds: c });
      else if (t === 'loot_table') {
        const ref = e.value ?? e.name;
        if (typeof ref === 'string') emit({ ref: `@${ref}`, e, conds: c });
        else walkDrops(ref, emit, c);
      }
      for (const ch of e.children ?? []) visit(ch, c);
    };
    for (const e of pool.entries ?? []) visit(e, [...conds, ...(pool.conditions ?? [])]);
  }
}

function reverse() {
  const L = loot();
  if (L.rev) return L.rev;
  const rev = new Map();
  for (const t of L.tables.values())
    walkDrops(t.json, (d) => {
      const hit = { table: t.id, ...d };
      const l = rev.get(d.ref);
      if (l) l.push(hit);
      else rev.set(d.ref, [hit]);
    });
  L.rev = rev;
  return rev;
}

const dropDesc = (h) => {
  const c = condsText(h.conds);
  return `${h.ref.startsWith('@') ? `таблица ${h.ref.slice(1)}` : `${label(h.ref)} ${itemFx(h.e)}`}${c ? ` — если ${c}` : ''}`;
};

// ---------------------------------------------------------------- инструменты

const REG = new Set([
  'block',
  'item',
  'entity',
  'fluid',
  'fluid_type',
  'effect',
  'biome',
  'enchantment',
  'attribute',
  'painting',
  'jukebox_song',
  'trim_material',
  'trim_pattern',
]);

const entriesCache = new WeakMap();
/** Записи переводов для поиска: вид (первая часть ключа), id для записей реестра, нормализованный текст */
function langEntries() {
  const L = lang();
  let list = entriesCache.get(L);
  if (list) return list;
  const blocks = blockIds();
  const itemIds = items().byId;
  list = [];
  for (const [key, e] of L) {
    const parts = key.split('.');
    const kind = parts[0];
    let id = null;
    let sub = '';
    if (REG.has(kind) && parts.length >= 3) {
      const ns = parts[1];
      const rest = parts.slice(2);
      id = `${ns}:${rest.join('/')}`;
      const known = kind === 'block' ? blocks : kind === 'item' ? itemIds : null;
      if (known && !known.has(id))
        for (let n = rest.length - 1; n > 0; n--) {
          const c = `${ns}:${rest.slice(0, n).join('/')}`;
          if (known.has(c)) {
            id = c;
            sub = rest.slice(n).join('.');
            break;
          }
        }
    }
    list.push({
      key,
      kind,
      ns: id ? id.split(':')[0] : (parts[1] ?? ''),
      id: sub ? null : id,
      e,
      hay: [norm(e.ru ?? ''), norm(e.en ?? ''), key.toLowerCase(), id ?? ''],
    });
  }
  entriesCache.set(L, list);
  return list;
}

function langLine(x) {
  const text = [x.e.ru, x.e.en && x.e.en !== x.e.ru ? x.e.en : null]
    .filter(Boolean)
    .map((s) => short(s.replace(/\s+/g, ' '), 160))
    .join(' / ');
  const head = x.id ? `${x.kind} ${x.id}` : x.key;
  const notes = [];
  if (x.id) notes.push(modLabel(x.id));
  if (x.kind === 'block' && x.id && !items().byId.has(x.id)) notes.push('без предмета');
  const src = x.e.ruSrc ?? x.e.enSrc;
  if (src && (src.startsWith('kubejs') || src.startsWith('ресурспак'))) notes.push(`перевод: ${src}`);
  if (!x.e.ru) notes.push('нет ru');
  return `${head} — ${text}${notes.length ? ` [${notes.join('; ')}]` : ''}`;
}

function langSearch(a) {
  const q = norm(a.query ?? '').trim();
  const ws = q.split(/\s+/).filter(Boolean);
  if (!ws.length) return 'Пустой запрос.';
  const scored = [];
  for (const x of langEntries()) {
    if (a.kind && x.kind !== a.kind) continue;
    if (a.mod && x.ns !== a.mod) continue;
    let score = 0;
    let ok = true;
    for (const w of ws) {
      let best = -1;
      for (const h of x.hay) {
        const pos = h.indexOf(w);
        if (pos === -1) continue;
        best = Math.max(best, pos === 0 ? 30 : /[\s/:_.]/.test(h[pos - 1]) ? 20 : 8);
      }
      if (best < 0) {
        ok = false;
        break;
      }
      score += best;
    }
    if (!ok) continue;
    if (x.hay.includes(q)) score += 50;
    if (x.id) score += 15;
    if (x.ns !== 'minecraft') score += 4;
    score -= (x.e.ru ?? x.e.en ?? '').length / 20;
    scored.push({ x, score });
  }
  scored.sort((p, r) => r.score - p.score);
  return page(
    scored.map((s) => s.x),
    a,
    (x) => [langLine(x)],
  );
}

function blockGet(a) {
  const id = String(a.id ?? '').trim();
  if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)) return 'Нужен id блока вида ns:path, например tfc:rock/raw/granite.';
  const [ns, p] = id.split(':');
  const out = [];
  const L = lang().get(`block.${ns}.${p.replaceAll('/', '.')}`);
  const it = items().byId.get(id);
  const names = [L?.ru ?? it?.r, L?.en ?? it?.e].filter(Boolean);
  out.push(`${id} — ${[...new Set(names)].join(' / ') || 'перевода нет'} [${modLabel(id)}]`);
  const m = mods().get(ns);
  if (m) out.push(`мод: ${m.name} ${m.version}, ${m.jar}`);
  out.push(
    it
      ? `предмет: есть — ${it.r ?? it.e} (item_get id=${id})`
      : 'предмет: в библиотеке предметов нет (блок без предмета или предмет с другим id)',
  );
  const bt = tagsOf('block', id);
  out.push(`теги блока (${bt.length}): ${bt.length ? bt.map((x) => `#${x}`).join(', ') : '—'}`);
  const bsName = `assets/${ns}/blockstates/${p}.json`;
  const bs = readFile(bsName);
  if (bs) {
    const models = new Set();
    const walk = (o) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') {
        if (typeof o.model === 'string') models.add(o.model);
        for (const v of Object.values(o)) if (typeof v === 'object') walk(v);
      }
    };
    walk(bs.json);
    const missing = [...models].filter((mm) => {
      const [mns, mp] = mm.includes(':') ? mm.split(':') : ['minecraft', mm];
      return !fileSources(`assets/${mns}/models/${mp}.json`).length;
    });
    const all = fileSources(bsName);
    out.push(
      `blockstate: ${bsName} (${bs.src}${all.length > 1 ? `; перекрывает ${all.slice(0, -1).join(', ')}` : ''}); ` +
        `моделей ${models.size}: ${short([...models].slice(0, 6).join(', '), 400)}${models.size > 6 ? ' …' : ''}` +
        (missing.length ? `; не найдены в источниках: ${short(missing.slice(0, 5).join(', '), 300)}` : ''),
    );
  } else
    out.push(
      ns === 'minecraft'
        ? 'blockstate: в jar модов нет (ванильные blockstate в кеше не хранятся)'
        : `blockstate: ${bsName} не найден`,
    );
  const t = loot().tables.get(`${ns}:blocks/${p}`);
  if (t) out.push('добыча:', ...tableLines(t, false).map((l) => `  ${l}`));
  else
    out.push(
      `добыча: таблицы ${ns}:blocks/${p} нет — блок ничего не роняет или таблица задана в коде (loot_for с другим id)`,
    );
  if (!L && !it && !bs && !t)
    out.push('Ничего не найдено: ни перевода, ни blockstate, ни таблицы. Поищите lang_search.');
  return out.join('\n');
}

function lootFor(a) {
  const id = String(a.id ?? '').trim();
  const tables = loot().tables;
  const [ns, p = ''] = id.split(':');
  const kinds = { block: 'blocks', entity: 'entities', chest: 'chests' };
  let found = [];
  if (tables.has(id) && (!a.kind || tableKind(tables.get(id)) === a.kind)) found = [tables.get(id)];
  else
    for (const [k, dir] of Object.entries(kinds)) {
      if (a.kind && a.kind !== k) continue;
      const t = tables.get(`${ns}:${dir}/${p}`);
      if (t) found.push(t);
    }
  if (found.length) return found.flatMap((t, i) => [...(i ? [''] : []), ...tableLines(t, a.raw)]).join('\n');
  const q = norm(id);
  const like = [...tables.values()].filter((t) => t.id.includes(q) && (!a.kind || tableKind(t) === a.kind));
  const out = [`Таблицы ${id} нет (искал как есть и как blocks/, entities/, chests/).`];
  if (ns === 'minecraft')
    out.push('Ванильные таблицы в кеше не хранятся — видны только те, что перекрыли моды или KubeJS.');
  const glm = [...loot().modifiers.values()].filter((m) => glmInfo(m).tables.has(id));
  if (glm.length) out.push('глобальные модификаторы этой таблицы:', ...glm.map((m) => `  ${glmText(m)}`));
  out.push(`Похожие:\n${page(like, a, (t) => [tableLabel(t)])}`);
  return out.join('\n');
}

function lootSources(a) {
  const id = String(a.item ?? '').trim();
  const rev = reverse();
  const L = loot();
  /** Прямые попадания с пояснением «как» */
  const hits = [];
  const direct = (ref, how) => {
    for (const h of rev.get(ref) ?? []) hits.push({ ...h, how });
  };
  if (id.startsWith('#')) {
    direct(id, 'тег в таблице');
    const tag = getTag('item', id);
    for (const v of flattenTag(tags(), 'item', directMembers(tag))) direct(v, `состоит в ${id}`);
  } else {
    direct(id, '');
    for (const t of tagsOf('item', id)) direct(`#${t}`, `через тег #${t}`);
  }
  // Вложенные таблицы: родитель роняет таблицу, где есть предмет
  const seen = new Set(hits.map((h) => h.table));
  let frontier = [...seen];
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next = [];
    for (const child of frontier)
      for (const h of rev.get(`@${child}`) ?? []) {
        hits.push({ ...h, how: `через таблицу ${child}` });
        if (!seen.has(h.table)) {
          seen.add(h.table);
          next.push(h.table);
        }
      }
    frontier = next;
  }
  // Глобальные модификаторы: добавляют предмет или таблицу с ним
  const glm = [];
  for (const m of L.modifiers.values()) {
    const i = glmInfo(m);
    const viaTable = [...i.addTables].find((t) => seen.has(t));
    const tagHit = id.startsWith('#') ? [...i.adds].some((x) => tagsOf('item', x).includes(id.slice(1))) : false;
    if (i.adds.has(id) || viaTable || tagHit) glm.push({ m, viaTable });
  }
  const groups = new Map();
  for (const h of hits) {
    const g = groups.get(h.table) ?? { t: L.tables.get(h.table), lines: new Set() };
    g.lines.add(`${h.how ? `${h.how}: ` : ''}${dropDesc(h)}`);
    groups.set(h.table, g);
  }
  const order = { block: 0, entity: 1, chest: 2, other: 3 };
  let list = [...groups.values()];
  if (a.kind) list = list.filter((g) => tableKind(g.t) === a.kind);
  list.sort(
    (x, y) =>
      Number(x.t.disabled) - Number(y.t.disabled) ||
      order[tableKind(x.t)] - order[tableKind(y.t)] ||
      Number(x.t.id.startsWith('minecraft:')) - Number(y.t.id.startsWith('minecraft:')) ||
      (x.t.id < y.t.id ? -1 : 1),
  );
  const head = `Откуда выпадает ${label(id)}: таблиц ${list.length} (по всем jar, kubejs/data; поздний файл перекрывает ранний)`;
  const glmLines = glm.length
    ? [
        `глобальные модификаторы (${glm.length}):`,
        ...glm.map(({ m, viaTable }) => `  ${glmText(m)}${viaTable ? ` (предмет — в таблице ${viaTable})` : ''}`),
      ]
    : [];
  return [
    head,
    page(list, a, (g) => [`• ${tableLabel(g.t)}`, ...[...g.lines].map((l) => `    ${short(l, 500)}`)]),
    ...glmLines,
  ].join('\n');
}

const kindOpt = (d) => ({ type: 'string', enum: ['block', 'entity', 'chest', 'other'], description: d });

export const TOOLS = [
  {
    name: 'lang_search',
    description:
      'Поиск по переводам (ru_ru/en_us) всех jar, ванили, KubeJS сборки и ресурспаков: по ключу, id или тексту. Возвращает вид записи (block, item, entity, fluid/fluid_type, effect, biome, enchantment, …), id и мод; у блоков — пометка «без предмета». Так находятся блоки без предмета, существа, жидкости, эффекты, которых нет в items_search.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('слова текста, ключ или id'),
        kind: str('вид записи — первая часть ключа: block, item, entity, fluid (у TFC), fluid_type, effect, biome, …'),
        mod: str('namespace мода'),
        ...paging,
      },
      required: ['query'],
    },
    handler: langSearch,
  },
  {
    name: 'block_get',
    description:
      'Блок по id: названия, мод, есть ли предмет, теги блока (с KubeJS), blockstate и модели (из какого источника), что выпадает (таблица добычи blocks/… с глобальными модификаторами).',
    inputSchema: {
      type: 'object',
      properties: { id: str('id блока, например tfc:rock/raw/granite') },
      required: ['id'],
    },
    handler: blockGet,
  },
  {
    name: 'loot_for',
    description:
      'Что выпадает: таблица добычи по id (tfc:blocks/…, tfc:entities/deer) или по id блока/существа/сундука. Источник с учётом перекрытия (поздний jar, kubejs/data), пулы с количествами и условиями кратко, вложенные таблицы, глобальные модификаторы NeoForge. raw — ещё и JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('id таблицы или блока/существа'),
        kind: kindOpt('искать только таблицы этого вида'),
        raw: { type: 'boolean', description: 'показать JSON таблицы' },
        ...paging,
      },
      required: ['id'],
    },
    handler: lootFor,
  },
  {
    name: 'loot_sources',
    description:
      'Откуда выпадает предмет: все таблицы добычи (блоки, существа, сундуки, шлюз и др.), где он есть напрямую, через тег, через вложенную таблицу или глобальный модификатор. Тег «#…» — таблицы с этим тегом и с любым его предметом.',
    inputSchema: {
      type: 'object',
      properties: {
        item: str('id предмета или тег «#c:…»'),
        kind: kindOpt('только таблицы этого вида'),
        ...paging,
      },
      required: ['item'],
    },
    handler: lootSources,
  },
];
