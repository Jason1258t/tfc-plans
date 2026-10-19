/**
 * Итоговый вид мультиблока — модель собранной машины (scripts/mods/multiblocks.mjs → public/multiblocks/formed/).
 *
 * Как устроено в IE (проверено по jar 12.4): блок машины (immersiveengineering:crusher) в blockstate ссылается на
 * модель с загрузчиком immersiveengineering:basic_split. В ней inner_model — OBJ-модель (neoforge:obj или ie_obj,
 * файл .obj / .obj.ie) с материалами .mtl, а split_parts — какие клетки занимает машина относительно блока,
 * где лежит модель. Координаты OBJ — в блоках от угла этого блока. Зеркальный вариант — тот же OBJ через
 * загрузчик immersiveengineering:mirror, поэтому сайт зеркалит модель сам. Каменные печи — тоже OBJ
 * (cube_three.obj) с переменными текстур #front / #side.
 *
 * Совмещение с постройкой: split_parts поворачиваем по Y (4 варианта) и сдвигаем так, чтобы они совпали с
 * клетками шаблона — это и есть поворот r и сдвиг t модели (без догадок о том, куда «смотрит» facing=north).
 *
 *   { obj, r: 0..3, t: [x,y,z], flipV, mats: { имя: { tex?, frames?, color?, alpha? } } }
 *   r — поворот (x, z) → r=1: (−z, x), r=2: (−x, −z), r=3: (z, −x) вокруг центра клетки модели.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Поиск файла ассетов: jar в порядке «поздний перекрывает», потом ванильный кеш */
export function assetLookup(zips, vanillaAssets) {
  return (rel) => {
    for (let i = zips.length - 1; i >= 0; i--) {
      const e = zips[i].getEntry(rel);
      if (e) return e.getData();
    }
    if (vanillaAssets && rel.startsWith('assets/minecraft/')) {
      const f = path.join(vanillaAssets, rel.slice('assets/'.length));
      if (fs.existsSync(f)) return fs.readFileSync(f);
    }
    return null;
  };
}

const split = (ref, def = 'minecraft') => (ref.includes(':') ? ref.split(':', 2) : [def, ref]);
const json = (buf) => {
  try {
    return buf ? JSON.parse(buf.toString('utf8')) : null;
  } catch {
    return null;
  }
};

export const ROT = [(x, z) => [x, z], (x, z) => [-z, x], (x, z) => [-x, -z], (x, z) => [z, -x]];

/** Поворот и сдвиг, при которых части модели совпадают с клетками шаблона; null — не совпали */
function align(parts, blocks) {
  const want = new Set(blocks.map((b) => `${b[0]},${b[1]},${b[2]}`));
  let best = null;
  for (let r = 0; r < 4; r++) {
    const rp = parts.map(([x, y, z]) => {
      const [a, c] = ROT[r](x, z);
      return [a, y, c];
    });
    const min = (k, arr) => Math.min(...arr.map((p) => p[k]));
    const t = [0, 1, 2].map((k) => min(k, blocks) - min(k, rp));
    const hit = rp.filter((p) => want.has(`${p[0] + t[0]},${p[1] + t[1]},${p[2] + t[2]}`)).length;
    const score = hit - Math.abs(rp.length - want.size);
    if (!best || score > best.score) best = { r, t, score, exact: hit === want.size && rp.length === want.size };
  }
  return best;
}

/** Материалы .mtl: newmtl → map_Kd (с подстановкой #переменных из textures модели), Kd, d */
function readMtl(text, textures) {
  const out = {};
  let cur = null;
  const deref = (v, n = 0) => (v?.startsWith('#') && n < 8 ? deref(textures?.[v.slice(1)], n + 1) : v);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const [k, ...rest] = line.split(/\s+/);
    const v = rest.join(' ');
    if (k === 'newmtl') out[(cur = v)] = {};
    else if (!cur) continue;
    else if (k === 'map_Kd') out[cur].map = deref(v);
    else if (k === 'Kd') out[cur].color = rest.map(Number);
    else if (k === 'd') out[cur].alpha = Number(v);
  }
  return out;
}

/** PNG: ширина и высота из заголовка IHDR */
const pngSize = (buf) => (buf?.length > 24 ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : [16, 16]);

export function formedModel(get, blockId, structure, outDir, name, warnings) {
  const [ns, p] = split(blockId);
  const bs = json(get(`assets/${ns}/blockstates/${p}.json`));
  const variants = bs?.variants ?? {};
  const keys = Object.keys(variants);
  // Обычный (не зеркальный) вариант, печи — выключенные, сторона — север (поворот потом найдём по частям)
  const key =
    keys.find((k) => /facing=north/.test(k) && !/mirrored=true/.test(k) && !/active=true/.test(k)) ??
    keys.find((k) => !/mirrored=true/.test(k));
  const ref = key !== undefined ? variants[key]?.model : null;
  if (!ref) return null;
  const [mns, mp] = split(ref);
  let model = json(get(`assets/${mns}/models/${mp}.json`));
  let parts = null;
  for (let i = 0; model && i < 4 && model.loader === 'immersiveengineering:basic_split'; i++) {
    parts = model.split_parts;
    model = model.inner_model;
  }
  if (model?.loader === 'immersiveengineering:mirror') model = model.inner_model;
  if (!model?.model || !Array.isArray(parts)) {
    warnings.push(`${blockId}: модель собранной машины не разобрана (${model?.loader ?? 'нет модели'})`);
    return null;
  }
  const [ons, op] = split(model.model);
  const objBuf = get(`assets/${ons}/${op}`);
  if (!objBuf) {
    warnings.push(`${blockId}: нет файла ${model.model}`);
    return null;
  }
  const obj = objBuf.toString('utf8');
  const mtlName = obj.match(/^mtllib\s+(.+)$/m)?.[1]?.trim();
  const mtlBuf = mtlName ? get(`assets/${ons}/${path.posix.join(path.posix.dirname(op), mtlName)}`) : null;
  const raw = mtlBuf ? readMtl(mtlBuf.toString('utf8'), model.textures) : {};
  const mats = {};
  for (const [m, def] of Object.entries(raw)) {
    const e = {};
    if (def.map && !def.map.startsWith('#')) {
      const [tns, tp] = split(def.map);
      const png = get(`assets/${tns}/textures/${tp}.png`);
      if (png) {
        const rel = `tex/${tns}/${tp}.png`;
        fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
        fs.writeFileSync(path.join(outDir, rel), png);
        e.tex = rel;
        const [w, h] = pngSize(png);
        // Анимированная текстура (кадры столбиком, .mcmeta) — сайт берёт первый кадр
        if (h > w && get(`assets/${tns}/textures/${tp}.png.mcmeta`)) e.frames = Math.round(h / w);
      } else warnings.push(`${blockId}: нет текстуры ${def.map}`);
    }
    if (def.color && !e.tex) e.color = def.color;
    if (def.alpha !== undefined && def.alpha < 1) e.alpha = def.alpha;
    mats[m] = e;
  }
  const a = align(parts, structure.blocks);
  if (!a?.exact)
    warnings.push(`${blockId}: части модели (${parts.length}) не совпали с постройкой (${structure.blocks.length})`);
  const rel = `formed/${ns}/${name}.obj`;
  fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
  fs.writeFileSync(path.join(outDir, rel), obj);
  return {
    obj: rel,
    r: a.r,
    t: a.t,
    ...(model.flip_v ? { flipV: true } : {}),
    mats,
    ...(a.exact ? {} : { rough: true }),
  };
}
