/**
 * Рисунок модели блока/предмета в PNG без клиента — перенос tools/ee-extras-mod/art/iso.py на Node и дополнения:
 * parent (resources.mjs), поворот элемента (rotation: origin/axis/angle/rescale), поворот варианта блокстейта
 * (x, y), uv по умолчанию, rotation грани, display.gui из цепочки, предметы item/generated (слои), multipart; загрузчики
 * neoforge:obj и immersiveengineering:ie_obj (файлы .obj/.obj.ie с .mtl, flip_v), composite, separate_transforms
 * (вид в инвентаре), conf_sides IE (куб из текстур <base_name>_<сторона>_none).
 *
 * Проекция ортографическая, свой буфер глубины, затенение граней как в игре (верх 1.0, низ 0.5, север/юг 0.8,
 * запад/восток 0.6) — по нормали после поворотов. Не рисуется: окраска tintindex (трава, листья — серые), ambient
 * occlusion, эмиссия, анимация (берётся первый кадр), builtin/entity и прочие загрузчики — о них предупреждение. У OBJ
 * рисуются все группы файла: что из них показывает код (инструменты IE), генератор не знает.
 *
 * Один генератор картинок для MCP (model_render) и иконок аддонов (сайт, выпуск) — запуск из командной строки:
 *   node scripts/mcp/render.mjs <папка ресурсов> <id…> --out <папка> [--size 256] [--kind icon|block|item|model]
 *        [--state facing=north] [--view gui] [--aa 4]
 * Ресурсы — папка с assets/ (tools/<мод>/src/main/resources), чужие parent и текстуры — из jar mods/ и Minecraft.
 */
import { decodePng, encodePng } from './tools/map-png.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mods } from './data.mjs';
import { codeBlockParts, entityItemModel } from './entityModels.mjs';
import { fluidLook } from './fluids.mjs';
import {
  blockstatePath,
  findResource,
  loadModel,
  modelPath,
  parseState,
  pickVariant,
  readJsonRes,
  resLoc,
  resolveTexture,
  resourceLayers,
  statePropsOf,
  texturePath,
} from './resources.mjs';

const SHADE = { up: 1.0, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };
const DEG = Math.PI / 180;

/**
 * Поворот display.gui [x, y, z] — как у игры: ItemTransform.apply → Quaternionf.rotationXYZ (сначала z, потом y,
 * потом x, правая тройка), экран GuiGraphics.renderItem — scale(16, −16, 16): x вправо, y вверх, ближе — больше z.
 * При [30, 225, 0] видны верх, север (справа) и восток (слева) — как на иконке печи в Minecraft Wiki
 * (Invicon_Furnace: топка справа). До 2026-10-21 здесь был −y (как в iso.py) — иконки выходили зеркальными.
 */
function viewRot(p, rx, ry, rz = 0) {
  return axisRot(axisRot(axisRot(p, 'z', rz), 'y', ry), 'x', rx);
}

/** Поворот вокруг оси (правая тройка, градусы) */
function axisRot([x, y, z], axis, deg) {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  if (axis === 'x') return [x, y * c - z * s, y * s + z * c];
  if (axis === 'y') return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}

/** Углы грани: начало uv (u0, v0), конец по u, конец по v — по правилам UV Minecraft (как face_quad в iso.py) */
function faceQuad([x0, y0, z0], [x1, y1, z1], name) {
  return {
    up: [
      [x0, y1, z0],
      [x1, y1, z0],
      [x0, y1, z1],
    ],
    down: [
      [x0, y0, z1],
      [x1, y0, z1],
      [x0, y0, z0],
    ],
    north: [
      [x1, y1, z0],
      [x0, y1, z0],
      [x1, y0, z0],
    ],
    south: [
      [x0, y1, z1],
      [x1, y1, z1],
      [x0, y0, z1],
    ],
    west: [
      [x0, y1, z0],
      [x0, y1, z1],
      [x0, y0, z0],
    ],
    east: [
      [x1, y1, z1],
      [x1, y1, z0],
      [x1, y0, z1],
    ],
  }[name];
}

/** uv по умолчанию (BlockElement.uvsByFace) */
function defaultUv([x0, y0, z0], [x1, y1, z1], name) {
  return {
    down: [x0, 16 - z1, x1, 16 - z0],
    up: [x0, z0, x1, z1],
    north: [16 - x1, 16 - y1, 16 - x0, 16 - y0],
    south: [x0, 16 - y1, x1, 16 - y0],
    west: [z0, 16 - y1, z1, 16 - y0],
    east: [16 - z1, 16 - y1, 16 - z0, 16 - y0],
  }[name];
}

const NORMALS = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};

/** Затенение по нормали: ближайшая сторона света (для повёрнутых элементов — смесь по осям) */
function shadeOf([nx, ny, nz]) {
  const ax = nx * nx;
  const ay = ny * ny;
  const az = nz * nz;
  return ax * SHADE.east + ay * (ny > 0 ? SHADE.up : SHADE.down) + az * SHADE.north;
}

// ---------------------------------------------------------------- текстуры

/** Текстура: { w, h, rgb, a, frames, from } или null; анимированная — первый кадр (квадрат по ширине) */
export function loadTexture(layers, id, cache = new Map()) {
  if (cache.has(id)) return cache.get(id);
  let t = null;
  const r = findResource(layers, texturePath(id));
  if (r) {
    try {
      const png = decodePng(r.data);
      const meta = findResource(layers, `${texturePath(id)}.mcmeta`);
      let h = png.height;
      let frames = 1;
      if (meta || png.height > png.width) {
        let anim = null;
        try {
          anim = meta ? JSON.parse(meta.data.toString('utf8')).animation : null;
        } catch {
          /* битый mcmeta — как без него */
        }
        const fw = anim?.width ?? png.width;
        const fh = anim?.height ?? (anim ? fw : png.width);
        if (png.height > fh && png.height % fh === 0) {
          frames = png.height / fh;
          h = fh;
        }
      }
      t = { w: png.width, h, fullH: png.height, rgb: png.rgb, a: png.a, frames, from: r.from };
    } catch (e) {
      t = { error: e.message, from: r.from };
    }
  }
  cache.set(id, t);
  return t;
}

// ---------------------------------------------------------------- модели с загрузчиком

/** Загрузчики, которые генератор рисует сам (остальные — предупреждение) */
export const DRAWN_LOADERS = new Set([
  'neoforge:obj',
  'forge:obj',
  'immersiveengineering:ie_obj',
  'neoforge:composite',
  'forge:composite',
  'neoforge:separate_transforms',
  'forge:separate_transforms',
  'immersiveengineering:conf_sides',
  'sophisticatedbackpacks:backpack',
]);

/**
 * Рюкзак Sophisticated Backpacks (BackpackDynamicModel): части block/backpack_<часть> с текстурой clips из модели
 * предмета. Без улучшений (как в JEI и творческом) — основа, карманы слева, справа и спереди, лямки (лямок нет только
 * на спине игрока). Цвета ткани и окантовки по умолчанию — BackpackWrapper.DEFAULT_MAIN_COLOR / DEFAULT_ACCENT_COLOR.
 */
const BACKPACK_PARTS = ['base', 'left_pouch', 'right_pouch', 'front_pouch', 'straps'];
const BACKPACK_TINTS = { 0: 0xcc613a, 1: 0x622e1a };

/** Ссылка на модель из поля загрузчика: строка или { parent, textures } — модель с подставленными текстурами */
function inlineModel(layers, ref) {
  const id = typeof ref === 'string' ? ref : ref?.parent;
  // Встроенная модель без parent (часть composite с loader obj или своими elements)
  if (typeof id !== 'string' && ref && typeof ref === 'object' && (ref.loader || ref.elements))
    return {
      id: '(встроенная часть)',
      chain: [{ id: '(встроенная часть)', from: 'модель' }],
      textures: { ...(ref.textures ?? {}) },
      elements: Array.isArray(ref.elements) ? ref.elements : null,
      display: { ...(ref.display ?? {}) },
      generated: false,
      entity: false,
      missing: [],
      errors: [],
      loader: ref.loader ?? null,
      loaderJson: ref,
      children: ref.children ?? null,
    };
  if (typeof id !== 'string') return null;
  const m = loadModel(layers, id);
  if (ref && typeof ref === 'object' && ref.textures) m.textures = { ...m.textures, ...ref.textures };
  return m;
}

/**
 * Модель для вида в инвентаре: separate_transforms (NeoForge) — модель perspectives.gui, а нет её — base.
 * display исходной модели сохраняется, если у выбранной своего нет.
 */
export function guiModel(layers, m) {
  // Модель без своей геометрии, только с overrides: у предмета по умолчанию все свойства 0 — подходит override, чьи
  // предикаты ≤ 0, последний из подходящих (ItemOverrides.resolve)
  if (!m.elements && !m.loader && !m.generated && !m.entity && m.overrides?.length) {
    const hit = m.overrides.filter((o) => Object.values(o.predicate ?? {}).every((v) => Number(v) <= 0)).at(-1);
    if (hit && typeof hit.model === 'string') {
      const o = loadModel(layers, hit.model);
      if (o.chain.length && !o.missing.length) {
        o.display = { ...m.display, ...o.display };
        m = o;
      }
    }
  }
  for (let i = 0; i < 4 && /separate_transforms$/.test(m.loader ?? ''); i++) {
    const j = m.loaderJson ?? {};
    const g = inlineModel(layers, j.perspectives?.gui ?? j.base);
    if (!g || !g.chain.length) break;
    g.display = { ...m.display, ...g.display };
    m = g;
  }
  return m;
}

/** Части рисунка с раскрытыми загрузчиками: composite — дочерние модели, conf_sides IE — куб из текстур по имени */
function expandParts(layers, parts, warnings) {
  const out = [];
  for (const part of parts) {
    const m = part.model;
    const loader = m.loader ?? '';
    if (/composite$/.test(loader) && !m.elements) {
      for (const [name, ref] of Object.entries(m.loaderJson?.children ?? m.children ?? {})) {
        const c = inlineModel(layers, ref);
        if (c?.chain.length) {
          c.display = { ...m.display, ...c.display };
          out.push(...expandParts(layers, [{ ...part, model: c }], warnings));
        } else warnings.add(`${m.id}: часть «${name}» composite не нашлась`);
      }
      continue;
    }
    if (loader === 'sophisticatedbackpacks:backpack' && !m.elements) {
      const clips = resolveTexture(m.textures, '#clips');
      for (const name of BACKPACK_PARTS) {
        const c = loadModel(layers, `sophisticatedbackpacks:block/backpack_${name}`);
        if (!c.chain.length || c.missing.length) {
          warnings.add(`${m.id}: нет части рюкзака backpack_${name}`);
          continue;
        }
        if (clips) c.textures = { ...c.textures, clips };
        c.display = { ...c.display, ...m.display };
        c.tints = BACKPACK_TINTS;
        out.push({ ...part, model: c });
      }
      continue;
    }
    if (loader === 'immersiveengineering:conf_sides' && !m.elements) {
      // Конденсаторы IE и т. п.: <base_name>_<сторона>_none (по коду IE — side_top_bottom, side_top, all_same…)
      const base = m.loaderJson?.base_name;
      const has = (id) => Boolean(findResource(layers, texturePath(id)));
      const pick = (...ids) => ids.find(has) ?? ids[ids.length - 1];
      const side = pick(`${base}_side_none`, `${base}_none`);
      const textures = {
        up: pick(`${base}_up_none`, `${base}_top_none`, side),
        down: pick(`${base}_down_none`, `${base}_bottom_none`, side),
        side,
      };
      const faces = Object.fromEntries(
        ['north', 'south', 'east', 'west', 'up', 'down'].map((f) => [
          f,
          { texture: f === 'up' ? '#up' : f === 'down' ? '#down' : '#side' },
        ]),
      );
      out.push({
        ...part,
        model: {
          ...m,
          textures: { ...m.textures, ...textures },
          elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces }],
        },
      });
      continue;
    }
    out.push(part);
  }
  return out;
}

/**
 * Инструменты IE (ie_obj с полем callbacks): какие группы OBJ видны у предмета без улучшений и насадок — как в JEI
 * и творческом. Перенесено из shouldRenderGroup / getTextureReplacement / getRenderColor классов
 * blusunrize.immersiveengineering.client.models.obj.callback.item.*Callbacks (IE 1.21.1-12.4.2).
 */
const IE_ITEM_CALLBACKS = {
  // DrillCallbacks: без головки — только рама и рукоять
  'immersiveengineering:drill': { show: (g) => g === 'drill_frame' || g === 'drill_grip' },
  // ChemthrowerCallbacks: base, grip, cage, tanks, tank; large_tank и multi_tank — с улучшениями
  'immersiveengineering:chemthrower': { show: (g) => ['base', 'grip', 'cage', 'tanks', 'tank'].includes(g) },
  // RailgunCallbacks: всё, кроме прицела и ускорителя (barrel_top виден без ускорителя)
  'immersiveengineering:railgun': { show: (g) => g !== 'upgrade_scope' && g !== 'upgrade_speed' },
  // RevolverCallbacks: frame, cylinder, barrel, cosmetic_compensator; все материалы — текстура item/revolvers/revolver
  'immersiveengineering:revolver': {
    show: (g) => ['frame', 'cylinder', 'barrel', 'cosmetic_compensator'].includes(g),
    texture: 'immersiveengineering:item/revolvers/revolver',
  },
  // ShieldCallbacks: всё, кроме вспышки и электрошока
  'immersiveengineering:shield': { show: (g) => g !== 'flash' && g !== 'shock' },
  // BuzzsawCallbacks: без диска и улучшений — корпус и прочее, что не перечислено
  'immersiveengineering:buzzsaw': {
    show: (g) =>
      !['blade', 'upgrade_lube', 'upgrade_launcher', 'upgrade_waterproof'].includes(g) && !/^upgrade_blades\d$/.test(g),
  },
  // PowerpackCallbacks (проход 0): без знамён, антенны, индукции и катушки Теслы
  'immersiveengineering:powerpack': {
    show: (g) =>
      !['banner', 'big_banner', 'banner_post', 'antenna', 'induction', 'induction_tubes', 'tesla_coil'].includes(g),
  },
  // FluorescentTubeCallbacks: трубка — белый × 0.3 (не горит), остальное — 0.067
  'immersiveengineering:fluorescent_tube': { show: () => true, tint: (g) => (g === 'tube' ? 0x4d4d4d : 0x111111) },
};

/** ie_obj рисуем, если видимость групп не задаёт код (нет callbacks) или её код перенесён в IE_ITEM_CALLBACKS */
export const ieObjDrawable = (m) => !m.loaderJson?.callbacks || Boolean(IE_ITEM_CALLBACKS[m.loaderJson.callbacks]);

/**
 * Геометрия OBJ (neoforge:obj, ie_obj): треугольники в пикселях модели (0–16 = блок) с uv 0–1 (v сверху, как у
 * картинки; flip_v — как в ObjLoader NeoForge) и текстурой материала (map_Kd: id текстуры или #переменная модели).
 */
function objTriangles(layers, m, warnings) {
  const j = m.loaderJson ?? {};
  const ref = typeof j.model === 'string' ? j.model : null;
  if (!ref) {
    warnings.add(`${m.id}: у загрузчика ${m.loader} нет поля model`);
    return [];
  }
  const { ns, path: p } = resLoc(ref);
  const file = `assets/${ns}/${p}`;
  const r = findResource(layers, file);
  if (!r) {
    warnings.add(`${m.id}: нет файла ${file}`);
    return [];
  }
  const dir = file.slice(0, file.lastIndexOf('/') + 1);
  const materials = new Map();
  const vs = [];
  const vts = [];
  const vns = [];
  const tris = [];
  let mat = null;
  let group = null;
  // ie_obj переворачивает v всегда (PolygonUtils.toBakedQuad IE: sprite.getV(1 − v)), NeoForge — по flip_v
  const flipV = j.flip_v === true || m.loader === 'immersiveengineering:ie_obj';
  // Инструменты IE: какие группы видны и чем перекрашены — по коду их ItemCallback (IE_ITEM_CALLBACKS)
  const cb = m.loader === 'immersiveengineering:ie_obj' ? IE_ITEM_CALLBACKS[j.callbacks] : null;
  for (const raw of r.data.toString('utf8').split(/\r?\n/)) {
    const line = raw.trim();
    const [cmd, ...a] = line.split(/\s+/);
    if (cmd === 'v') vs.push(a.slice(0, 3).map(Number));
    else if (cmd === 'vt') vts.push(a.slice(0, 2).map(Number));
    else if (cmd === 'vn') vns.push(a.slice(0, 3).map(Number));
    else if (cmd === 'usemtl') mat = a.join(' ');
    else if (cmd === 'o' || cmd === 'g') group = a.join(' ');
    else if (cmd === 'mtllib') {
      const mr = findResource(layers, dir + a.join(' '));
      if (!mr) warnings.add(`${m.id}: нет материалов ${dir}${a.join(' ')}`);
      let cur = null;
      for (const ml of mr ? mr.data.toString('utf8').split(/\r?\n/) : []) {
        const [mc, ...ma] = ml.trim().split(/\s+/);
        if (mc === 'newmtl') cur = ma.join(' ');
        else if (mc === 'map_Kd' && cur) materials.set(cur, ma.join(' '));
      }
    } else if (cmd === 'f' && a.length >= 3) {
      const idx = (n, len) => (n < 0 ? len + n : n - 1);
      const pts = a.map((t) => {
        const [vi, ti, ni] = t.split('/');
        return {
          v: vs[idx(Number(vi), vs.length)],
          t: ti ? vts[idx(Number(ti), vts.length)] : null,
          n: ni ? vns[idx(Number(ni), vns.length)] : null,
        };
      });
      if (pts.some((x) => !x.v)) continue;
      if (cb && group != null && !cb.show(group)) continue;
      // Текстура материала: map_Kd — id текстуры (ns:block/x) или #переменная модели; нет — #материал / particle
      const kd = materials.get(mat);
      const tex =
        cb?.texture ??
        resolveTexture(m.textures, kd && !kd.startsWith('#') ? kd : (kd ?? `#${mat}`)) ??
        resolveTexture(m.textures, `#${mat}`) ??
        resolveTexture(m.textures, '#particle');
      for (let i = 1; i + 1 < pts.length; i++) {
        const tri = [pts[0], pts[i], pts[i + 1]];
        tris.push({
          P: tri.map((x) => [x.v[0] * 16, x.v[1] * 16, x.v[2] * 16]),
          UV: tri.map((x) => (x.t ? [x.t[0], flipV ? 1 - x.t[1] : x.t[1]] : [0, 0])),
          N: tri.every((x) => x.n) ? tri.map((x) => x.n).reduce((s, n) => s.map((c, k) => c + n[k]), [0, 0, 0]) : null,
          tex,
          tint: cb?.tint?.(group) ?? null,
        });
      }
    }
  }
  if (!tris.length) warnings.add(`${m.id}: в ${file} нет граней`);
  return tris;
}

// ---------------------------------------------------------------- 3D

/**
 * Рисунок: parts — [{ model (loadModel), x, y }], view — gui | top | bottom | north | south | east | west,
 * aa — суперсэмплинг (4: рисуем 4× и усредняем; 1 — без сглаживания).
 * Возвращает { png, warnings, textures: Map(id → откуда | null) }.
 */
export function renderModel(layers, parts, { view = 'gui', size = 256, aa = 4 } = {}) {
  const warnings = new Set();
  const used = new Map();
  const texCache = new Map();
  let rx;
  let ry;
  let rz = 0;
  if (view === 'gui') {
    const gui = parts.find((p) => p.model.display.gui)?.model.display.gui;
    [rx, ry, rz = 0] = gui?.rotation ?? [30, 225, 0];
    if (!gui) warnings.add('нет display.gui в цепочке parent — взят поворот [30, 225, 0] (как у block/block)');
  } else
    [rx, ry] = { top: [90, 0], bottom: [-90, 0], south: [0, 0], north: [0, 180], east: [0, 90], west: [0, -90] }[
      view
    ] ?? [30, 225];

  parts = expandParts(layers, parts, warnings);
  // Грани в пространстве вида (до масштаба): [{ O, U, V (3D), tex, uv, rot, shade }]; OBJ — треугольники
  const quads = [];
  const tris = [];
  for (const part of parts) {
    const m = part.model;
    // Вариант блокстейта: сначала x, потом y, оба — по часовой (отрицательный угол правой тройки); затем mat —
    // поворот, который добавляет код предмета (рендерер ящиков Functional Storage)
    const orient = (v) => {
      let d = v;
      if (part.x) d = axisRot(d, 'x', -part.x);
      if (part.y) d = axisRot(d, 'y', -part.y);
      const M = part.mat;
      if (M)
        d = [
          M[0] * d[0] + M[1] * d[1] + M[2] * d[2],
          M[3] * d[0] + M[4] * d[1] + M[5] * d[2],
          M[6] * d[0] + M[7] * d[1] + M[8] * d[2],
        ];
      return d;
    };
    const place = (p) => orient([p[0] - 8, p[1] - 8, p[2] - 8]);
    if (/(^|:)(ie_)?obj$/.test(m.loader ?? '') && !m.elements) {
      for (const t of objTriangles(layers, m, warnings)) {
        const P = t.P.map(place);
        // Нормаль: из vn файла, а нет — по треугольнику; затенение — как у граней блока
        let n = t.N && orient(t.N);
        if (!n) {
          const e1 = P[1].map((c, k) => c - P[0][k]);
          const e2 = P[2].map((c, k) => c - P[0][k]);
          n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        }
        const len = Math.hypot(...n) || 1;
        tris.push({
          P: P.map((v) => viewRot(v, rx, ry, rz)),
          UV: t.UV,
          tex: t.tex,
          tint: t.tint,
          shade: shadeOf(n.map((c) => c / len)),
        });
        if (!t.tex) warnings.add(`${m.id}: у материала OBJ нет текстуры`);
      }
      continue;
    }
    // Грани моделей сущностей (entityModels.mjs): уже в пикселях блока, с uv по вершинам; без отсечения задних
    // граней (кубы замкнуты — видимое решает буфер глубины), наложение (узор знамени) — поверх той же грани
    if (m.quads) {
      for (const fq of m.quads) {
        const [O, U, V] = fq.P.map((x) => viewRot(place(x), rx, ry, rz));
        const n = orient(fq.N);
        const len = Math.hypot(...n) || 1;
        quads.push({
          O,
          U,
          V,
          tex: fq.tex,
          uv: fq.uv,
          rot: 0,
          shade: shadeOf(n.map((c) => c / len)),
          tint: fq.tint,
          overlay: fq.overlay,
          nocull: true,
        });
      }
      continue;
    }
    if (m.loader && !m.elements)
      warnings.add(`${m.id}: loader ${m.loader} — геометрию задаёт код или файл, не рисуется`);
    if (m.entity) warnings.add(`${m.id}: builtin/entity — рисуется кодом (BlockEntityRenderer), не рисуется`);
    for (const el of m.elements ?? []) {
      const from = el.from ?? [0, 0, 0];
      const to = el.to ?? [16, 16, 16];
      const er = el.rotation;
      const toBlock = (p) => {
        let v = p;
        if (er && er.angle) {
          const o = er.origin ?? [8, 8, 8];
          let d = [v[0] - o[0], v[1] - o[1], v[2] - o[2]];
          d = axisRot(d, er.axis, er.angle);
          if (er.rescale) {
            const k = 1 / Math.cos(Math.abs(er.angle) * DEG);
            d = d.map((c, i) => ('xyz'[i] === er.axis ? c : c * k));
          }
          v = [d[0] + o[0], d[1] + o[1], d[2] + o[2]];
        }
        return place(v);
      };
      const normalOf = (n) => orient(er && er.angle ? axisRot(n, er.axis, er.angle) : n);
      for (const [name, face] of Object.entries(el.faces ?? {})) {
        if (!NORMALS[name]) continue;
        const [o, pu, pv] = faceQuad(from, to, name);
        // Текстура грани — имя переменной модели, «#» необязателен (BlockModel.getMaterial)
        const ref = typeof face.texture === 'string' && !face.texture.startsWith('#') && face.texture in m.textures;
        const texId = resolveTexture(m.textures, ref ? `#${face.texture}` : face.texture);
        if (!texId) warnings.add(`${m.id}: текстура ${face.texture} не задана`);
        const tint = face.tintindex != null && face.tintindex >= 0 ? (m.tints?.[face.tintindex] ?? null) : null;
        if (face.tintindex != null && face.tintindex >= 0 && tint == null)
          warnings.add('tintindex: окраску задаёт код — грань без неё');
        quads.push({
          O: viewRot(toBlock(o), rx, ry, rz),
          U: viewRot(toBlock(pu), rx, ry, rz),
          V: viewRot(toBlock(pv), rx, ry, rz),
          tex: texId,
          uv: face.uv ?? defaultUv(from, to, name),
          rot: ((face.rotation ?? 0) % 360) / 90,
          shade: el.shade === false ? 1 : shadeOf(normalOf(NORMALS[name])),
          tint,
        });
      }
    }
  }
  if (!quads.length && !tris.length) warnings.add('в модели нет элементов');

  // Масштаб: как iso.py (куб 16³ с полем), но целиком уместить, если модель больше блока
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const corners = [
    ...quads.flatMap((q) => [q.O, q.U, q.V, [q.U[0] + q.V[0] - q.O[0], q.U[1] + q.V[1] - q.O[1]]]),
    ...tris.flatMap((t) => t.P),
  ];
  for (const p of corners) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  // Суперсэмплинг: рисуем в ss раз крупнее и усредняем — ровные края, альфа по покрытию
  const ss = Math.max(1, Math.min(8, aa | 0));
  const S = size * ss;
  let scale = (size / (16 * 1.75)) * ss;
  let cx = 0;
  let cy = 0;
  if (corners.length) {
    const span = Math.max(maxX - minX, maxY - minY);
    if (span * scale > S * 0.94) scale = (S * 0.94) / span;
    // Не влезает по центру блока — центрируем по рамке
    if (Math.max(-minX, maxX, -minY, maxY) * scale > S * 0.47) {
      cx = (minX + maxX) / 2;
      cy = (minY + maxY) / 2;
    }
  }
  const proj = (p) => [S / 2 + (p[0] - cx) * scale, S / 2 - (p[1] - cy) * scale, p[2]];

  const img = new Uint8Array(S * S * 4);
  const depth = new Float32Array(S * S).fill(-Infinity);
  for (const q of quads) {
    const O = proj(q.O);
    const U = proj(q.U);
    const V = proj(q.V);
    const du = [U[0] - O[0], U[1] - O[1], U[2] - O[2]];
    const dv = [V[0] - O[0], V[1] - O[1], V[2] - O[2]];
    const det = du[0] * dv[1] - du[1] * dv[0];
    // Видна, если смотрит на зрителя (+z после поворота): u × v в экранных координатах (y вниз)
    if (Math.abs(det) < 1e-9 || (det < 0 && !q.nocull)) continue;
    let tex = null;
    if (q.tex) {
      tex = loadTexture(layers, q.tex, texCache);
      used.set(q.tex, tex ? (tex.error ? `${tex.from}: ${tex.error}` : tex.from) : null);
      if (tex?.error) tex = null;
    }
    const [u0, v0, u1, v1] = q.uv;
    // Грань с краями включительно и запасом в полпикселя: на стыках граней нет щелей
    const es = 0.5 / Math.max(1e-6, Math.hypot(du[0], du[1]));
    const et = 0.5 / Math.max(1e-6, Math.hypot(dv[0], dv[1]));
    const xs = [O[0], U[0], V[0], U[0] + dv[0]];
    const ys = [O[1], U[1], V[1], U[1] + dv[1]];
    const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
    const y1 = Math.min(S - 1, Math.floor(Math.max(...ys)) + 1);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1);
    const x1 = Math.min(S - 1, Math.floor(Math.max(...xs)) + 1);
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const qx = px + 0.5 - O[0];
        const qy = py + 0.5 - O[1];
        let s = (qx * dv[1] - qy * dv[0]) / det;
        let t = (du[0] * qy - du[1] * qx) / det;
        if (s < -es || s > 1 + es || t < -et || t > 1 + et) continue;
        s = Math.min(0.99999, Math.max(0, s));
        t = Math.min(0.99999, Math.max(0, t));
        const z = O[2] + s * du[2] + t * dv[2];
        const k = py * S + px;
        // Наложение рисуется на своей же грани: глубина та же (с допуском), её не пишет
        if (q.overlay ? z < depth[k] - 0.05 : z <= depth[k]) continue;
        let a = s;
        let b = t;
        for (let i = 0; i < q.rot; i++) [a, b] = [b, 1 - a]; // поворот текстуры грани по часовой
        let r;
        let g;
        let bl;
        let al;
        if (tex) {
          // Ближайший пиксель текстуры, как в игре
          const tx = Math.min(tex.w - 1, Math.max(0, Math.floor(((u0 + (u1 - u0) * a) / 16) * tex.w)));
          const ty = Math.min(tex.h - 1, Math.max(0, Math.floor(((v0 + (v1 - v0) * b) / 16) * tex.h)));
          const c = tex.rgb[ty * tex.w + tx];
          al = tex.a[ty * tex.w + tx];
          r = c >> 16;
          g = (c >> 8) & 255;
          bl = c & 255;
        } else {
          // Нет текстуры — пурпурно-чёрная клетка, как в игре
          const odd = (Math.floor(a * 2) + Math.floor(b * 2)) % 2;
          [r, g, bl, al] = odd ? [0, 0, 0, 255] : [248, 0, 248, 255];
        }
        if (al === 0) continue;
        const i4 = k * 4;
        // Окраска кодом (tintindex), если она известна: умножение, как у игры
        const tr = q.tint == null ? 1 : 1 / 255;
        r *= q.shade * (q.tint == null ? 1 : (q.tint >> 16) * tr);
        g *= q.shade * (q.tint == null ? 1 : ((q.tint >> 8) & 255) * tr);
        bl *= q.shade * (q.tint == null ? 1 : (q.tint & 255) * tr);
        if (al < 255 || q.overlay) {
          // Полупрозрачное и наложение — смешиваем поверх, глубину не пишем
          const f = al / 255;
          img[i4] = r * f + img[i4] * (1 - f);
          img[i4 + 1] = g * f + img[i4 + 1] * (1 - f);
          img[i4 + 2] = bl * f + img[i4 + 2] * (1 - f);
          img[i4 + 3] = Math.max(img[i4 + 3], al);
          continue;
        }
        depth[k] = z;
        img[i4] = r;
        img[i4 + 1] = g;
        img[i4 + 2] = bl;
        img[i4 + 3] = 255;
      }
  }
  // Треугольники OBJ: барицентрические координаты, uv по вершинам; без отсечения задних граней (в файлах OBJ
  // порядок обхода бывает любой) — видимое решает буфер глубины
  for (const tr of tris) {
    const [A, B, C] = tr.P.map(proj);
    const det = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    if (Math.abs(det) < 1e-9) continue;
    let tex = null;
    if (tr.tex) {
      tex = loadTexture(layers, tr.tex, texCache);
      used.set(tr.tex, tex ? (tex.error ? `${tex.from}: ${tex.error}` : tex.from) : null);
      if (tex?.error) tex = null;
    }
    // Запас в полпикселя по краям, как у граней блока: без щелей между треугольниками
    const pad = 0.5 / Math.max(1e-6, Math.sqrt(Math.abs(det)));
    const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])) - 1);
    const y1 = Math.min(S - 1, Math.floor(Math.max(A[1], B[1], C[1])) + 1);
    const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])) - 1);
    const x1 = Math.min(S - 1, Math.floor(Math.max(A[0], B[0], C[0])) + 1);
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const qx = px + 0.5;
        const qy = py + 0.5;
        const wb = ((qx - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (qy - A[1])) / det;
        const wc = ((B[0] - A[0]) * (qy - A[1]) - (qx - A[0]) * (B[1] - A[1])) / det;
        const wa = 1 - wb - wc;
        if (wa < -pad || wb < -pad || wc < -pad) continue;
        const z = wa * A[2] + wb * B[2] + wc * C[2];
        const k = py * S + px;
        if (z <= depth[k]) continue;
        let r;
        let g;
        let bl;
        let al;
        if (tex) {
          const u = wa * tr.UV[0][0] + wb * tr.UV[1][0] + wc * tr.UV[2][0];
          const v = wa * tr.UV[0][1] + wb * tr.UV[1][1] + wc * tr.UV[2][1];
          const tx = Math.min(tex.w - 1, Math.max(0, Math.floor(u * tex.w)));
          const ty = Math.min(tex.h - 1, Math.max(0, Math.floor(v * tex.h)));
          const c = tex.rgb[ty * tex.w + tx];
          al = tex.a[ty * tex.w + tx];
          r = c >> 16;
          g = (c >> 8) & 255;
          bl = c & 255;
        } else [r, g, bl, al] = [248, 0, 248, 255];
        if (al < 128) continue;
        const i4 = k * 4;
        depth[k] = z;
        const tt = tr.tint;
        img[i4] = r * tr.shade * (tt == null ? 1 : (tt >> 16) / 255);
        img[i4 + 1] = g * tr.shade * (tt == null ? 1 : ((tt >> 8) & 255) / 255);
        img[i4 + 2] = bl * tr.shade * (tt == null ? 1 : (tt & 255) / 255);
        img[i4 + 3] = 255;
      }
  }
  for (const [id, from] of used) if (!from) warnings.add(`нет текстуры ${id}`);
  return { png: encodePng(size, size, downsample(img, S, ss)), warnings: [...warnings], textures: used };
}

/** Уменьшение в ss раз: цвет — среднее с весом альфы, альфа — доля покрытия */
function downsample(src, S, ss) {
  if (ss === 1) return src;
  const size = S / ss;
  const out = new Uint8Array(size * size * 4);
  const n = ss * ss;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          const k = ((y * ss + j) * S + x * ss + i) * 4;
          const al = src[k + 3];
          r += src[k] * al;
          g += src[k + 1] * al;
          b += src[k + 2] * al;
          a += al;
        }
      const o = (y * size + x) * 4;
      if (!a) continue;
      out[o] = Math.round(r / a);
      out[o + 1] = Math.round(g / a);
      out[o + 2] = Math.round(b / a);
      out[o + 3] = Math.round(a / n);
    }
  return out;
}

// ---------------------------------------------------------------- плоское: предметы item/generated, текстуры

/** Слои layer0… предмета item/generated — один рисунок по сетке самой крупной текстуры, увеличенный без сглаживания */
export function renderGenerated(layers, model, size = 256) {
  const specs = [];
  for (let i = 0; i < 16; i++) {
    const ref = model.textures[`layer${i}`];
    if (!ref) break;
    specs.push({ id: resolveTexture(model.textures, ref) ?? ref });
  }
  const r = renderFlat(layers, specs, size);
  if (!specs.length) r.warnings.push('у предмета нет слоёв layer0…');
  if (specs.length > 1) r.warnings.push('слои выше layer0 часто окрашиваются кодом (tint) — здесь без окраски');
  return r;
}

/** DyedItemColor.LEATHER_COLOR Minecraft 1.21.1 — кожаная броня без окраски */
const LEATHER_COLOR = 0xffa06540;

/**
 * Плоские предметы с загрузчиком (как их видно в JEI и творческом):
 *   neoforge:fluid_container — base, маска fluid, залитая текстурой still жидкости с её окраской (fluids.mjs), cover
 *     (cover_is_mask, по умолчанию да, — base по форме cover); жидкость не определилась — пустое ведро (base);
 *   tfc:fluid_container (ContainedFluidModel) — сосуд пустой: base;
 *   tfc:trim (TrimmedItemModel) — без отделки: armor и overlay, оба с tintindex 0 (кожаная броня — LEATHER_COLOR).
 * Возвращает null, если это не такой загрузчик.
 */
export function flatLoaderSpecs(layers, model, itemId, look) {
  const tex = (k) => resolveTexture(model.textures, `#${k}`);
  const j = model.loaderJson ?? {};
  if (/^(neoforge|forge):fluid_container$/.test(model.loader ?? '')) {
    const specs = [];
    if (tex('base')) specs.push({ id: tex('base') });
    const f = typeof j.fluid === 'string' && look ? look(j.fluid) : null;
    if (f && tex('fluid')) specs.push({ id: f.still, mask: tex('fluid'), tint: f.tint });
    const cover = tex('cover');
    if (cover && j.cover_is_mask !== false) {
      if (tex('base')) specs.push({ id: tex('base'), mask: cover });
    } else if (cover) specs.push({ id: cover });
    return { specs, fluid: f ? j.fluid : null, wanted: j.fluid ?? null };
  }
  if (model.loader === 'tfc:fluid_container') return { specs: tex('base') ? [{ id: tex('base') }] : [] };
  if (model.loader === 'tfc:trim') {
    const tint = /^minecraft:leather_/.test(itemId ?? '') ? LEATHER_COLOR : undefined;
    return { specs: ['armor', 'overlay'].filter(tex).map((k) => ({ id: tex(k), tint })) };
  }
  return null;
}

/**
 * Слои плоского предмета: [{ id — текстура, mask — форма из этой текстуры (цвет берётся из id в той же точке),
 * tint — 0xAARRGGBB, умножение }] — снизу вверх, с прозрачностью, по сетке самой крупной текстуры.
 */
export function renderFlat(layers, specs, size = 256) {
  const warnings = [];
  const used = new Map();
  const ready = [];
  const load = (id) => {
    const t = loadTexture(layers, id);
    used.set(id, t && !t.error ? t.from : null);
    if (!t || t.error) warnings.push(`нет текстуры ${id}`);
    return t && !t.error ? t : null;
  };
  for (const sp of specs) {
    const t = load(sp.id);
    const m = sp.mask ? load(sp.mask) : null;
    if (t && (!sp.mask || m)) ready.push({ t, m, tint: sp.tint });
  }
  if (!ready.length) return { png: encodePng(1, 1, new Uint8Array(4)), warnings, textures: used };
  // Целый масштаб (пиксели текстуры — квадраты одного размера), по центру картинки size×size
  const n = Math.max(...ready.map((r) => (r.m ?? r.t).w));
  const k = Math.max(1, Math.floor(size / n));
  const W = n * k;
  const C = Math.max(size, W);
  const off = (C - W) >> 1;
  const img = new Uint8Array(C * C * 4);
  for (const { t, m, tint } of ready) {
    const tr = tint == null ? 255 : (tint >>> 16) & 255;
    const tg = tint == null ? 255 : (tint >>> 8) & 255;
    const tb = tint == null ? 255 : tint & 255;
    const ta = tint == null ? 255 : tint >>> 24;
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const tx = Math.floor((x / W) * t.w);
        const ty = Math.floor((y / W) * t.h);
        let al = t.a[ty * t.w + tx];
        if (m) {
          const mi = Math.floor((y / W) * m.h) * m.w + Math.floor((x / W) * m.w);
          if (!m.a[mi]) continue;
        }
        al = (al * ta) / 255;
        if (!al) continue;
        const c = t.rgb[ty * t.w + tx];
        const i4 = ((y + off) * C + x + off) * 4;
        const f = al / 255;
        img[i4] = (((c >> 16) * tr) / 255) * f + img[i4] * (1 - f);
        img[i4 + 1] = ((((c >> 8) & 255) * tg) / 255) * f + img[i4 + 1] * (1 - f);
        img[i4 + 2] = (((c & 255) * tb) / 255) * f + img[i4 + 2] * (1 - f);
        img[i4 + 3] = Math.max(img[i4 + 3], al);
      }
  }
  return { png: encodePng(C, C, img), warnings, textures: used };
}

/** Текстура как есть (весь лист, вкл. все кадры), увеличенная без сглаживания до ~size по большей стороне */
export function textureImage(t, size = 256) {
  const k = Math.max(1, Math.floor(size / Math.max(t.w, t.fullH)));
  const W = t.w * k;
  const H = t.fullH * k;
  const img = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = Math.floor(y / k) * t.w + Math.floor(x / k);
      const c = t.rgb[i];
      const i4 = (y * W + x) * 4;
      img[i4] = c >> 16;
      img[i4 + 1] = (c >> 8) & 255;
      img[i4 + 2] = c & 255;
      img[i4 + 3] = t.a[i];
    }
  return encodePng(W, H, img);
}

// ---------------------------------------------------------------- по id: блок, предмет, модель

function chainText(m) {
  const head = m.chain.map((c) => `${c.id} (${c.from})`).join(' → ');
  const miss = m.missing.length ? ` → ❌ нет ${m.missing.join(', ')}` : '';
  return `${head}${miss}`;
}

/**
 * Рисунок по id: kind — block (блокстейт → вариант state), item (models/item/…), model (ns:block/…),
 * icon (как в инвентаре: модель предмета, а нет её — блок); без kind — блок, иначе предмет, иначе модель.
 * Возвращает { png | null, lines (что нарисовано, откуда, предупреждения) }.
 */
export function renderId(layers, id, { kind, state, view = 'gui', size = 256, aa = 4 } = {}) {
  if (!id) return { png: null, lines: ['Укажите id блока или предмета (ns:path) или модели (ns:block/…).'] };
  const { ns, path: p } = resLoc(id);
  const hasItem = () => Boolean(findResource(layers, modelPath(`${ns}:item/${p}`)));
  let k = kind;
  if (k === 'icon') k = hasItem() ? 'item' : 'block';
  if (!k) k = findResource(layers, blockstatePath(id)) ? 'block' : hasItem() ? 'item' : 'model';
  const lines = [];
  let parts;
  if (k === 'block') {
    const bs = readJsonRes(layers, blockstatePath(id));
    if (!bs)
      return {
        png: null,
        lines: [`Блокстейта ${blockstatePath(id)} нет ни в одном слое (ресурспаки, KubeJS, аддоны, jar, Minecraft).`],
      };
    if (!bs.json) return { png: null, lines: [`${blockstatePath(id)} (${bs.from}): JSON не разобрался — ${bs.error}`] };
    const v = pickVariant(bs.json, parseState(state));
    lines.push(`блокстейт ${blockstatePath(id)} (${bs.from}); вариант «${v.key}»`);
    parts = v.parts.map((x) => ({ model: loadModel(layers, x.model), x: x.x ?? 0, y: x.y ?? 0, uvlock: x.uvlock }));
    for (const [i, x] of v.parts.entries())
      lines.push(
        `модель${v.parts.length > 1 ? ` ${i + 1}` : ''}: ${chainText(parts[i].model)}${x.x || x.y ? `; x=${x.x ?? 0} y=${x.y ?? 0}` : ''}`,
      );
    const props = statePropsOf(bs.json);
    if (props.size)
      lines.push(`свойства в блокстейте: ${[...props].map(([key, s]) => `${key}=${[...s].join('|')}`).join('; ')}`);
  } else {
    const mid = k === 'item' ? `${ns}:item/${p}` : `${ns}:${p}`;
    let m = loadModel(layers, mid);
    lines.push(`модель: ${chainText(m)}`);
    const gm = guiModel(layers, m);
    if (gm !== m) {
      lines.push(`вид в инвентаре (separate_transforms): ${chainText(gm)}`);
      m = gm;
    }
    if (!m.chain.length) return { png: null, lines: [...lines, `Модели ${modelPath(mid)} нет.`] };
    const flat = flatLoaderSpecs(layers, m, k === 'item' ? `${ns}:${p}` : null, fluidLook);
    if (flat) {
      const r = renderFlat(layers, flat.specs, size);
      lines.push(`плоский предмет, загрузчик ${m.loader}: слои ${flat.specs.map((x) => (x.mask ? `${x.id} по форме ${x.mask}` : x.id)).join(', ')}`);
      if (flat.wanted && !flat.fluid) lines.push(`⚠ жидкость ${flat.wanted}: текстуру и цвет из кода определить не вышло — ведро пустое`);
      for (const [t, from] of r.textures) lines.push(`  текстура ${t}: ${from ?? '❌ нет'}`);
      for (const w of r.warnings) lines.push(`⚠ ${w}`);
      return { png: r.png, lines };
    }
    const cb = m.entity ? codeBlockParts(layers, `${ns}:${p}`, m) : null;
    if (cb) {
      lines.push(`рисуется кодом (builtin/entity) — ${cb.drawnBy}`);
      const r = renderModel(layers, cb.parts, { view, size, aa });
      for (const [t, from] of r.textures) lines.push(`  текстура ${t}: ${from ?? '❌ нет'}`);
      for (const w of r.warnings) lines.push(`⚠ ${w}`);
      return { png: r.png, lines };
    }
    const em = m.entity ? entityItemModel(layers, `${ns}:${p}`, m) : null;
    if (em) {
      lines.push(`рисуется кодом (builtin/entity) — перенесённая модель: ${em.drawnBy}`);
      m = em;
    }
    if (m.generated) {
      const r = renderGenerated(layers, m, size);
      lines.push(
        `предмет item/generated: слои ${Object.keys(m.textures)
          .filter((x) => x.startsWith('layer'))
          .join(', ')}`,
      );
      for (const [t, from] of r.textures) lines.push(`  текстура ${t}: ${from ?? '❌ нет'}`);
      for (const w of r.warnings) lines.push(`⚠ ${w}`);
      return { png: r.png, lines };
    }
    parts = [{ model: m, x: 0, y: 0 }];
  }
  const r = renderModel(layers, parts, { view, size, aa });
  for (const [t, from] of r.textures) lines.push(`  текстура ${t}: ${from ?? '❌ нет'}`);
  for (const pm of parts) for (const e of pm.model.errors) lines.push(`❌ ${e}`);
  for (const w of r.warnings) lines.push(`⚠ ${w}`);
  lines.push(`вид: ${view}, ${size}×${size}${aa > 1 ? `, сглаживание ${aa}×` : ''}`);
  return { png: r.png, lines };
}

// ---------------------------------------------------------------- командная строка

function cli(argv) {
  const opts = { out: '.', size: 256, kind: 'icon', view: 'gui', aa: 4, state: undefined };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(out|size|kind|view|aa|state)(?:=(.*))?$/);
    if (m) opts[m[1]] = m[2] ?? argv[++i];
    else pos.push(argv[i]);
  }
  const [res, ...ids] = pos;
  if (!res || !ids.length) {
    console.error(
      'node scripts/mcp/render.mjs <папка ресурсов> <id…> --out <папка> [--size 256] [--kind icon|block|item|model] [--state …] [--view gui] [--aa 4]',
    );
    process.exit(2);
  }
  const dir = fs.existsSync(path.join(res, 'src/main/resources/assets')) ? path.join(res, 'src/main/resources') : res;
  if (!fs.existsSync(path.join(dir, 'assets'))) {
    console.error(`${res}: нет папки assets/`);
    process.exit(2);
  }
  // Старая сборка этого же мода в mods/ не подставляет файлы, которых нет в папке
  const own = new Set(fs.readdirSync(path.join(dir, 'assets')));
  const skip = new Set([...mods().values()].filter((m) => own.has(m.id)).map((m) => m.jar));
  const layers = resourceLayers({ addon: path.resolve(dir) }, true, skip);
  fs.mkdirSync(opts.out, { recursive: true });
  let failed = 0;
  for (const id of ids) {
    const r = renderId(layers, id, { ...opts, size: Number(opts.size), aa: Number(opts.aa) });
    const file = path.join(opts.out, `${resLoc(id).path.replaceAll('/', '_')}.png`);
    if (r.png) fs.writeFileSync(file, r.png);
    else failed++;
    const warn = r.lines.filter((l) => /^(⚠|❌)|❌ нет/.test(l.trim()));
    console.log(`${r.png ? '✓' : '✗'} ${id}${r.png ? ` → ${file}` : `: ${r.lines.at(-1)}`}`);
    for (const l of warn) console.log(`    ${l.trim()}`);
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  cli(process.argv.slice(2));
