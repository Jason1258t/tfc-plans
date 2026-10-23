/**
 * Модели блоков для схем (3D и редактор слоёв): blockstate → модели с элементами, как их печёт игра, — в
 * public/block-models/<ns>.json, по файлу на namespace (сайт грузит только моды блоков текущей схемы).
 *
 *   { v: 1,
 *     tex: ["create/block/andesite_casing", …]           — текстуры граней (пути внутри icons/, файлы копируются туда),
 *     geo: [[{ f, t, r?, sh?, faces: { up: { s, uv?, r?, c?, i? }, … } }, …], …]
 *                                                         — геометрия: элементы (from/to в пикселях, rotation
 *                                                           { o, a, g, rs } — origin/axis/angle/rescale, sh: 0 — shade
 *                                                           false); грань: s — номер слота текстуры, uv, r — rotation,
 *                                                           c — cullface, i — tintindex,
 *     m: [[geo, [tex по слотам]], …]                      — модель = геометрия + текстуры слотов (общая геометрия
 *                                                           у всех cube_all, у ступенек всех пород и т. п.),
 *     b: { "<путь блока>": { v: [["facing=north,half=top", [[m, x, y, uvlock?], …]], …] }
 *                        | { mp: [[when | null, [[m, x, y, uvlock?], …]], …] } } }
 *
 * Модель OBJ (neoforge:obj, ie_obj) — элементы-треугольники { o: [x, y, z, u, v] × 3 (пиксели модели, uv 0–16 от
 * верха текстуры), s }. Загрузчик-обёртка (листва и растения TFC, полки Firmalife) — его базовая модель.
 * m = -1 — модель без элементов: рисует код (BlockEntityRenderer: сундуки, ремень Create) или загрузчик, которого
 * здесь нет (части машин IE, теплицы Firmalife), — тогда сайт берёт запасную форму по имени (src/lib/schematicMesh.ts).
 * Вариант со списком моделей (случайный выбор с весами) — первая, как и в превью модели (scripts/mcp/render.mjs).
 * Не переносится: окраска кодом (tintindex сайт красит сам по типу блока), ambient occlusion, анимация, эмиссия.
 */
import fs from 'node:fs';
import path from 'node:path';
import { encodePng } from '../mcp/tools/map-png.mjs';
import { loadTexture, objTriangles } from '../mcp/render.mjs';
import { loadModel, readJsonRes, resolveTexture, resLoc } from '../mcp/resources.mjs';

export const BLOCK_MODELS_VERSION = 1;

const DIRS = new Set(['up', 'down', 'north', 'south', 'east', 'west']);

/** Части составной модели (neoforge:composite): children — ссылка или встроенная модель с parent/elements */
function compositeParts(layers, m) {
  const out = [];
  for (const c of Object.values(m.children ?? {})) {
    if (typeof c === 'string') out.push(loadModel(layers, c));
    else if (c && typeof c === 'object') {
      const par = typeof c.parent === 'string' ? loadModel(layers, c.parent) : null;
      out.push({
        id: m.id,
        textures: { ...(par?.textures ?? {}), ...(m.textures ?? {}), ...(c.textures ?? {}) },
        elements: Array.isArray(c.elements) ? c.elements : (par?.elements ?? null),
      });
    }
  }
  // Текстуры самой составной модели доступны частям (#переменные из родителя)
  for (const p of out) p.textures = { ...(m.textures ?? {}), ...p.textures };
  return out;
}

/** Поля загрузчика, в которых не модель */
const NOT_MODEL = new Set(['textures', 'display', 'parent', 'loader', 'render_type', 'gui_light', 'overrides']);

/**
 * Загрузчик-обёртка: код выбирает одну из вложенных обычных моделей по состоянию (листва и растения TFC — по сезону:
 * dense_leaves, blooming…; полки Firmalife — base + содержимое кодом). Берём base, а нет — первую вложенную модель.
 */
function wrapped(layers, m) {
  const j = m.loaderJson ?? {};
  const keys = Object.keys(j).filter(
    (k) => !NOT_MODEL.has(k) && j[k] && typeof j[k] === 'object' && (j[k].parent || j[k].elements),
  );
  const k = keys.includes('base') ? 'base' : keys[0];
  if (!k) return null;
  const c = j[k];
  const par = typeof c.parent === 'string' ? loadModel(layers, c.parent) : null;
  const elements = Array.isArray(c.elements) ? c.elements : (par?.elements ?? null);
  return elements
    ? { id: m.id, textures: { ...(par?.textures ?? {}), ...(m.textures ?? {}), ...(c.textures ?? {}) }, elements }
    : null;
}

/**
 * writeBlockModels({ layers, blockstates, outDir, iconsDir, copyTexture, log }):
 *   layers — слои ресурсов (scripts/mcp/resources.mjs), blockstates — [{ ns, path }] всех блоков сборки,
 *   copyTexture(id) → путь в icons/ или null (файл текстуры из распакованных jar); нет файла (атлас TFC:
 *   paletted_permutations) — рисуем текстуру сами в iconsDir.
 * Возвращает { blocks, models, geometry, textures, noModel, kb, warnings }.
 */
export function writeBlockModels({ layers, blockstates, outDir, iconsDir, copyTexture, log = () => {} }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const warnings = [];
  const texCache = new Map();
  /** id текстуры → путь в icons/ (или null) — общий для всех namespace */
  const texRel = new Map();
  const textureRel = (id) => {
    const key = id.includes(':') ? id : `minecraft:${id}`;
    if (texRel.has(key)) return texRel.get(key);
    let rel = copyTexture(key);
    if (!rel) {
      const t = loadTexture(layers, key, texCache);
      if (t?.rgb) {
        const { ns, path: p } = resLoc(key);
        rel = `${ns}/${p}`;
        const rgba = new Uint8Array(t.w * t.h * 4);
        for (let i = 0; i < t.w * t.h; i++) {
          const c = t.rgb[i];
          rgba[i * 4] = c >> 16;
          rgba[i * 4 + 1] = (c >> 8) & 255;
          rgba[i * 4 + 2] = c & 255;
          rgba[i * 4 + 3] = t.a[i];
        }
        const file = path.join(iconsDir, `${rel}.png`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, encodePng(t.w, t.h, rgba));
      }
    }
    texRel.set(key, rel ?? null);
    return rel ?? null;
  };

  /** Разобранные модели по id: { geoKey, geo, tex: [id текстуры по слотам] } или null */
  const modelCache = new Map();
  const bake = (ref) => {
    if (modelCache.has(ref)) return modelCache.get(ref);
    const m = loadModel(layers, ref);
    let parts = [m];
    if (!m.elements && /(^|:)composite$/.test(m.loader ?? '')) parts = compositeParts(layers, m);
    else if (!m.elements && m.loader) {
      const w = wrapped(layers, m);
      if (w) parts = [w];
    }
    const slots = [];
    const geo = [];
    for (const p of parts)
      for (const el of p.elements ?? []) {
        const faces = {};
        for (const [dir, face] of Object.entries(el.faces ?? {})) {
          if (!DIRS.has(dir) || !face) continue;
          // Текстура грани — переменная модели, «#» необязателен (BlockModel.getMaterial)
          const bare = typeof face.texture === 'string' && !face.texture.startsWith('#') && face.texture in p.textures;
          const tex = resolveTexture(p.textures, bare ? `#${face.texture}` : face.texture);
          let s = slots.indexOf(tex ?? '');
          if (s < 0) s = slots.push(tex ?? '') - 1;
          const f = { s };
          if (Array.isArray(face.uv) && face.uv.length === 4) f.uv = face.uv;
          if (face.rotation) f.r = face.rotation;
          if (face.cullface && DIRS.has(face.cullface)) f.c = face.cullface;
          if (face.tintindex != null && face.tintindex >= 0) f.i = face.tintindex;
          faces[dir] = f;
        }
        if (!Object.keys(faces).length) continue;
        const e = { f: el.from ?? [0, 0, 0], t: el.to ?? [16, 16, 16], faces };
        const r = el.rotation;
        if (r && r.angle) e.r = { o: r.origin ?? [8, 8, 8], a: r.axis, g: r.angle, ...(r.rescale ? { rs: 1 } : {}) };
        if (el.shade === false) e.sh = 0;
        geo.push(e);
      }
    // OBJ (neoforge:obj, ie_obj): треугольники в пикселях модели, uv 0–1 (v сверху) → { o: [x, y, z, u, v ×3], s }
    if (!m.elements && /(^|:)(ie_)?obj$/.test(m.loader ?? '')) {
      const r3 = (v) => Math.round(v * 1000) / 1000;
      for (const t of objTriangles(layers, m, new Set())) {
        let s = slots.indexOf(t.tex ?? '');
        if (s < 0) s = slots.push(t.tex ?? '') - 1;
        geo.push({ o: t.P.flatMap((p, i) => [...p.map(r3), r3(t.UV[i][0] * 16), r3(t.UV[i][1] * 16)]), s });
      }
    }
    const out = geo.length ? { geoKey: JSON.stringify(geo), geo, tex: slots } : null;
    modelCache.set(ref, out);
    return out;
  };

  const byNs = new Map();
  for (const b of blockstates) (byNs.get(b.ns) ?? byNs.set(b.ns, []).get(b.ns)).push(b.path);
  let blocks = 0;
  let models = 0;
  let geometry = 0;
  let noModel = 0;
  let bytes = 0;
  const textures = new Set();
  for (const [ns, paths] of [...byNs].sort((a, b) => a[0].localeCompare(b[0]))) {
    const tex = [];
    const texIdx = new Map();
    const geo = [];
    const geoIdx = new Map();
    const mods = [];
    const modIdx = new Map();
    const modelOf = (ref) => {
      if (typeof ref !== 'string') return -1;
      const b = bake(ref.includes(':') ? ref : `minecraft:${ref}`);
      if (!b) return -1;
      let g = geoIdx.get(b.geoKey);
      if (g == null) {
        g = geo.push(b.geo) - 1;
        geoIdx.set(b.geoKey, g);
      }
      const t = b.tex.map((id) => {
        const rel = id ? textureRel(id) : null;
        if (!rel) return -1;
        let i = texIdx.get(rel);
        if (i == null) {
          i = tex.push(rel) - 1;
          texIdx.set(rel, i);
          textures.add(rel);
        }
        return i;
      });
      const key = `${g}|${t.join(',')}`;
      let i = modIdx.get(key);
      if (i == null) {
        i = mods.push([g, t]) - 1;
        modIdx.set(key, i);
      }
      return i;
    };
    const part = (v) => {
      const one = Array.isArray(v) ? v[0] : v;
      if (!one || typeof one !== 'object') return null;
      const m = modelOf(one.model);
      if (m < 0) noModel++;
      const out = [m, Number(one.x) || 0, Number(one.y) || 0];
      if (one.uvlock) out.push(1);
      return out;
    };
    const b = {};
    for (const p of paths.sort()) {
      const bs = readJsonRes(layers, `assets/${ns}/blockstates/${p}.json`)?.json;
      if (!bs) continue;
      if (bs.variants && typeof bs.variants === 'object') {
        const v = [];
        for (const [key, val] of Object.entries(bs.variants)) {
          const pt = part(val);
          if (pt) v.push([key, [pt]]);
        }
        if (v.length) b[p] = { v };
      } else if (Array.isArray(bs.multipart)) {
        const mp = [];
        for (const c of bs.multipart) {
          const pts = [c.apply]
            .flat()
            .slice(0, 1)
            .map(part)
            .filter((x) => x);
          if (pts.length) mp.push([c.when ?? null, pts]);
        }
        if (mp.length) b[p] = { mp };
      }
      if (b[p]) blocks++;
    }
    if (!Object.keys(b).length) continue;
    const text = JSON.stringify({ v: BLOCK_MODELS_VERSION, tex, geo, m: mods, b });
    fs.writeFileSync(path.join(outDir, `${ns}.json`), text);
    bytes += text.length;
    models += mods.length;
    geometry += geo.length;
  }
  log(
    `модели блоков: ${blocks} блоков, ${models} моделей, ${geometry} геометрий, ${textures.size} текстур, без элементов ${noModel} — block-models/ ${Math.round(bytes / 1024)}KB`,
  );
  return { blocks, models, geometry, textures: textures.size, noModel, kb: Math.round(bytes / 1024), warnings };
}
