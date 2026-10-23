/**
 * Блоки без своего предмета → public/blocks.json. В схемах Create такие встречаются постоянно: ремень (create:belt —
 * его ставит create:belt_connector), шлюз на ремне (create:andesite_belt_funnel ← create:andesite_funnel), силовой
 * вал, трубы в корпусе; у ванили — факел на стене, табличка на стене, цветок в горшке. Библиотека сайта — предметы,
 * и без этого списка сайт считал такие блоки «нет в сборке».
 *
 *   [{ i: id блока, e: имя en, r?: имя ru, d?: [предметы, которые с него падают — ими его и ставят] }]
 *
 * Заодно помечает предметы-блоки (it.b = 1, до записи items.json): заменять блок схемы можно только на них —
 * create:belt_connector (предмет) в схеме стал бы пустотой.
 *
 * Блок — файл assets/<ns>/blockstates/<path>.json; предмет — из таблицы добычи data/<ns>/loot_table/blocks/<path>.json
 * (поздний источник перекрывает ранний, как датапаки); у «alternatives» берём первую ветку (обычно «шёлковое
 * касание» — сам блок); нет таблицы — предмет по имени без «wall_». Блоки без перевода (технические) тоже попадают — с именем по id.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Предметы из записи loot-таблицы: item, вложенные children; у alternatives — только первая ветка с предметом */
function entryItems(e, out) {
  if (!e || typeof e !== 'object') return;
  const type = String(e.type ?? '').replace(/^minecraft:/, '');
  if (type === 'item' && typeof e.name === 'string') out.push(e.name);
  if (!Array.isArray(e.children)) return;
  if (type === 'alternatives') {
    for (const c of e.children) {
      const sub = [];
      entryItems(c, sub);
      if (sub.length) return void out.push(...sub);
    }
  } else for (const c of e.children) entryItems(c, out);
}

function lootItems(json) {
  const out = [];
  for (const pool of Array.isArray(json?.pools) ? json.pools : [])
    for (const e of Array.isArray(pool.entries) ? pool.entries : []) entryItems(e, out);
  return [...new Set(out)];
}

const walk = (base) =>
  fs.existsSync(base)
    ? fs
        .readdirSync(base, { recursive: true })
        .map(String)
        .filter((r) => r.endsWith('.json'))
        .map((r) => r.slice(0, -5).split(path.sep).join('/'))
    : [];

/**
 * dataDirs — data/ источников в порядке загрузки (assets/ рядом); items — библиотека предметов;
 * name(key) → { en, ru } по ключу перевода.
 */
export function writeBlocks(dataDirs, parse, items, name, outFile) {
  const itemIds = new Set(items.map((it) => it.i));
  const blocks = new Set();
  const loot = new Map();
  for (const { dir } of dataDirs) {
    const assets = path.join(path.dirname(dir), 'assets');
    if (fs.existsSync(assets))
      for (const ns of fs.readdirSync(assets))
        for (const p of walk(path.join(assets, ns, 'blockstates'))) blocks.add(`${ns}:${p}`);
    if (fs.existsSync(dir))
      for (const ns of fs.readdirSync(dir)) {
        const base = path.join(dir, ns, 'loot_table', 'blocks');
        for (const p of walk(base)) loot.set(`${ns}:${p}`, path.join(base, `${p}.json`));
      }
  }
  for (const it of items) if (blocks.has(it.i)) it.b = 1;
  const out = [];
  let withDrop = 0;
  for (const id of [...blocks].sort()) {
    if (itemIds.has(id) || id === 'minecraft:air') continue;
    const [ns, p] = id.split(':');
    const n = name(`block.${ns}.${p.replaceAll('/', '.')}`);
    const file = loot.get(id);
    let d = file ? lootItems(parse(fs.readFileSync(file, 'utf8'))).filter((i) => itemIds.has(i)) : [];
    // Своей таблицы нет (настенный факел и таблички берут добычу у «основного» блока кодом) — предмет по имени
    if (!d.length && !file) {
      const byName = [p.replace('wall_', ''), p.replace('_wall_', '_')].find(
        (v) => v !== p && itemIds.has(`${ns}:${v}`),
      );
      if (byName) d = [`${ns}:${byName}`];
    }
    if (d.length) withDrop++;
    // Без перевода (технические блоки модов) — имя по id: блок всё равно есть в сборке
    const en = n.en ?? p.split('/').pop();
    out.push({ i: id, e: en, ...(n.ru && n.ru !== en ? { r: n.ru } : {}), ...(d.length ? { d } : {}) });
  }
  fs.writeFileSync(outFile, JSON.stringify(out));
  return { count: out.length, withDrop, kb: Math.round(fs.statSync(outFile).size / 1024) };
}
