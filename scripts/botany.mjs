/**
 * Ботаника → public/botany.json: климатические диапазоны культур, ягодных кустов и фруктовых деревьев.
 * Источник — data/<ns>/tfc/climate_range/{crop,plant}/<имя>.json (TFC и аддоны, которые кладут туда свои растения).
 * Поля диапазона берутся как есть (в файлах бывают не все): min/max_temperature, min/max_hydration.
 *
 *   { entries: [{ i: "tfc:wheat", k: "crop|bush|tree|plant", n: "wheat", src, r: { minT, maxT, minH, maxH },
 *                 product?: id предмета, seed?: id семян, plant?: id блока-предмета куста }] }
 */
import fs from 'node:fs';
import path from 'node:path';

const FIELDS = { min_temperature: 'minT', max_temperature: 'maxT', min_hydration: 'minH', max_hydration: 'maxH' };

export function buildBotany(dataDirs, parse, items) {
  const have = new Set(items.map((i) => i.i));
  const first = (...ids) => ids.find((id) => have.has(id));
  const out = new Map();
  for (const { dir, source } of dataDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ns of fs.readdirSync(dir)) {
      for (const group of ['crop', 'plant']) {
        const base = path.join(dir, ns, 'tfc', 'climate_range', group);
        if (!fs.existsSync(base)) continue;
        for (const file of fs.readdirSync(base)) {
          if (!file.endsWith('.json')) continue;
          const j = parse(fs.readFileSync(path.join(base, file), 'utf8'));
          if (!j || typeof j !== 'object') continue;
          const name = file.slice(0, -5);
          const r = {};
          for (const [from, to] of Object.entries(FIELDS)) if (typeof j[from] === 'number') r[to] = j[from];
          const kind =
            group === 'crop' ? 'crop' : name.endsWith('_bush') ? 'bush' : name.endsWith('_tree') ? 'tree' : 'plant';
          const n = name.replace(/_(bush|tree)$/, '');
          out.set(`${ns}:${name}`, {
            i: `${ns}:${name}`,
            k: kind,
            n,
            src: source,
            r,
            product: first(`${ns}:food/${n}`, `${ns}:${n}`),
            seed: group === 'crop' ? first(`${ns}:seeds/${n}`) : undefined,
            plant: kind === 'bush' ? first(`${ns}:plant/${name}`) : undefined,
          });
        }
      }
    }
  }
  return { entries: [...out.values()].sort((a, b) => a.i.localeCompare(b.i)) };
}

export function writeBotany(dataDirs, parse, items, outFile) {
  const data = buildBotany(dataDirs, parse, items);
  fs.writeFileSync(outFile, JSON.stringify(data));
  const by = (k) => data.entries.filter((e) => e.k === k).length;
  return { crops: by('crop'), bushes: by('bush'), trees: by('tree'), other: by('plant') };
}
