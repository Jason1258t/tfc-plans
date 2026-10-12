/**
 * Теги сборки → public/tags.json: из каких источников (vanilla, jar) собран каждый тег предметов, жидкостей,
 * блоков и сущностей. Слияние как в игре делает сайт (src/lib/tags.ts): источники идут в порядке загрузки,
 * replace обнуляет накопленное, remove (расширение NeoForge) убирает значения.
 *
 *   { tags: [{ i: "c:plantoil", k: "fluid", s: [{ s: "jar", v: ["tfc:olive_oil", "#c:x"], r?: 1, x?: [...] }] }],
 *     fluids: [{ i, e, r? }] }    — известные жидкости с именами (для добавления в теги жидкостей)
 */
import fs from 'node:fs';
import path from 'node:path';

export const TAG_KINDS = ['item', 'fluid', 'block', 'entity_type'];

const entryId = (v) => (typeof v === 'string' ? v : typeof v?.id === 'string' ? v.id : null);

export function buildTags(dataDirs, parse, fluidNames) {
  const tags = new Map();
  for (const { dir, source } of dataDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ns of fs.readdirSync(dir)) {
      for (const kind of TAG_KINDS) {
        const base = path.join(dir, ns, 'tags', kind);
        if (!fs.existsSync(base)) continue;
        for (const rel of fs.readdirSync(base, { recursive: true })) {
          if (!String(rel).endsWith('.json')) continue;
          const j = parse(fs.readFileSync(path.join(base, rel), 'utf8'));
          if (!j || typeof j !== 'object') continue;
          const id = `${ns}:${String(rel).slice(0, -5).split(path.sep).join('/')}`;
          const v = (Array.isArray(j.values) ? j.values : []).map(entryId).filter(Boolean);
          const x = (Array.isArray(j.remove) ? j.remove : []).map(entryId).filter(Boolean);
          const key = `${kind}|${id}`;
          const t = tags.get(key) ?? { i: id, k: kind, s: [] };
          t.s.push({ s: source, v, ...(j.replace === true ? { r: 1 } : {}), ...(x.length ? { x } : {}) });
          tags.set(key, t);
        }
      }
    }
  }
  const fluids = [...fluidNames]
    .filter(([id]) => !/(^|[:/_])flowing(_|$)/.test(id))
    .map(([i, n]) => ({ i, e: n.en ?? n.ru ?? i, ...(n.ru && n.ru !== n.en ? { r: n.ru } : {}) }))
    .sort((a, b) => a.i.localeCompare(b.i));
  return { tags: [...tags.values()].sort((a, b) => a.i.localeCompare(b.i)), fluids };
}

export function writeTags(dataDirs, parse, fluidNames, outFile) {
  const data = buildTags(dataDirs, parse, fluidNames);
  fs.writeFileSync(outFile, JSON.stringify(data));
  return {
    tags: data.tags.length,
    entries: data.tags.reduce((n, t) => n + t.s.reduce((m, s) => m + s.v.length, 0), 0),
    fluids: data.fluids.length,
    kb: Math.round(fs.statSync(outFile).size / 1024),
  };
}
