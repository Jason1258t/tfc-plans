/**
 * Модели GeckoLib (assets/<ns>/geo/*.geo.json, формат Bedrock 1.12+: minecraft:geometry[0].bones[].cubes[]) —
 * в грани для renderModel (поле quads, как у entityModels.mjs). Перенесено из GeckoLib 4.8.3 (geckolib-neoforge-1.21.1):
 *   BakedModelFactory.Builtin — x зеркалится (origin.x → −(origin.x + size.x)), pivot.x → −pivot.x, повороты
 *     костей и кубов (−x, −y, z); inflate куба, а нет его — кости, /16;
 *   VertexSet / buildQuad — вершины граней, mirror куба (запад ↔ восток; при UV по граням ещё верх ↔ низ), box UV
 *     (uv — массив: развёртка как у ModelPart, размеры округляются вниз);
 *   GeoQuad.build — u0/u1 меняются местами без mirror, uv_rotation по часовой, отрицательный uv_size — отражение;
 *   RenderUtil.prepMatrixForBone / rotateMatrixAroundCube — поворот вокруг pivot: Z, потом Y, потом X.
 * Покой — без анимаций: положение костей из файла. Сущность и броня в игре — поворот 180° по Y (GeoEntityRenderer;
 * у брони GeoArmorRenderer.actuallyRender scale(−1, −1, 1) гасит такой же переворот HumanoidModel): модель смотрит на
 * юг (+z), левая сторона (+x Bedrock) — восток. Броня: кости armorHead/armorBody/… в покое стоят там же, где части
 * игрока (applyBaseTransformations) — силуэт игрока рисуется в координатах шаблона GeckoLib.
 */
import { Pose, apply, applyDir } from './entityModels.mjs';
import { findResource, resLoc, texturePath } from './resources.mjs';

const DEG = Math.PI / 180;
const DIRS = ['west', 'east', 'north', 'south', 'up', 'down'];
const STEP = {
  west: [-1, 0, 0],
  east: [1, 0, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

/** Кости брони GeckoLib → часть игрока (GeoArmorRenderer: getHeadBone… — имена по умолчанию) */
const ARMOR_BONES = {
  armorHead: 'head',
  armorBody: 'body',
  armorRightArm: 'arms',
  armorLeftArm: 'arms',
  armorRightLeg: 'legs',
  armorLeftLeg: 'legs',
  armorRightBoot: 'legs',
  armorLeftBoot: 'legs',
};
/** Части игрока в координатах шаблона брони GeckoLib (Bedrock, пиксели): [origin, size] */
const PLAYER = {
  head: [
    [
      [-4, 24, -4],
      [8, 8, 8],
    ],
  ],
  body: [
    [
      [-4, 12, -2],
      [8, 12, 4],
    ],
  ],
  arms: [
    [
      [-8, 12, -2],
      [4, 12, 4],
    ],
    [
      [4, 12, -2],
      [4, 12, 4],
    ],
  ],
  legs: [
    [
      [-4, 0, -2],
      [4, 12, 4],
    ],
    [
      [0, 0, -2],
      [4, 12, 4],
    ],
  ],
};
const SILHOUETTE = 0x70a0b4c8; // 0xAARRGGBB: полупрозрачный серо-голубой

/** Путь файла модели: ns:geo/x.geo.json, ns:geo/x, assets/ns/geo/… или ns:x (→ geo/x.geo.json) */
export function geoPath(id) {
  let s = String(id ?? '').trim();
  const a = s.match(/^assets\/([^/]+)\/(.+)$/);
  if (a) s = `${a[1]}:${a[2]}`;
  const { ns, path: p0 } = resLoc(s);
  let p = p0.startsWith('geo/') ? p0 : `geo/${p0}`;
  if (!/\.json$/.test(p)) p += '.geo.json';
  return `assets/${ns}/${p}`;
}

/** Похоже на модель GeckoLib: путь geo/… или .geo.json */
export const isGeoId = (id) => /(^|[:/])geo\/|\.geo\.json$/.test(String(id ?? '').trim());

/** id текстуры (ns:models/armor/x) из ns:textures/….png, assets/ns/textures/….png или ns:path */
export function geoTextureId(t) {
  let s = String(t ?? '').trim();
  const a = s.match(/^assets\/([^/]+)\/textures\/(.+)$/);
  if (a) s = `${a[1]}:${a[2]}`;
  const { ns, path: p } = resLoc(s);
  return `${ns}:${p.replace(/^textures\//, '').replace(/\.png$/, '')}`;
}

/** Модели GeckoLib во всех слоях (для подсказки, если файла нет): пути assets/…/geo/… */
function geoFiles(layers, ns) {
  const out = new Set();
  for (const l of layers)
    for (const p of l.list?.(ns ? `assets/${ns}/geo/` : 'assets/') ?? []) if (/\/geo\/.+\.json$/.test(p)) out.add(p);
  return [...out].sort();
}

/**
 * Текстура без параметра: по имени файла модели в привычных папках; из найденных — с пропорциями развёртки
 * (иконка предмета 16×16 с тем же именем — не она), а ровно такого размера — лучше всего.
 */
function guessTexture(layers, file, tw, th, loadTexture) {
  const m = file.match(/^assets\/([^/]+)\/geo\/(?:(.+)\/)?([^/]+?)(?:\.geo)?\.json$/);
  if (!m) return null;
  const [, ns, sub, name] = m;
  const dirs = [sub, sub && `entity/${sub}`, 'entity', 'models/armor', 'armor', 'item', 'block', ''].filter(
    (d) => d != null,
  );
  const found = [];
  for (const d of [...new Set(dirs)]) {
    const id = `${ns}:${d ? `${d}/` : ''}${name}`;
    const t = findResource(layers, texturePath(id)) ? loadTexture(layers, id) : null;
    if (t && !t.error) found.push({ id, score: t.w === tw && t.h === th ? 2 : t.w * th === t.h * tw ? 1 : 0 });
  }
  return found.sort((a, b) => b.score - a.score)[0]?.id ?? null;
}

/** Куб в пространстве GeckoLib (пиксели): 6 граней { dir, P[4], uv[4][2] (0–1), N, src } (null — грань не задана) */
function cubeFaces(cube, boneInflate, tw, th) {
  const size = cube.size ?? [0, 0, 0];
  const org = cube.origin ?? [0, 0, 0];
  const g = cube.inflate ?? boneInflate ?? 0;
  const mirror = cube.mirror === true;
  const o = [-(org[0] + size[0]), org[1], org[2]];
  const x0 = o[0] - g;
  const y0 = o[1] - g;
  const z0 = o[2] - g;
  const x1 = o[0] + size[0] + g;
  const y1 = o[1] + size[1] + g;
  const z1 = o[2] + size[2] + g;
  // VertexSet: Left/Right — по z, Back/Front — по x (так названо в GeckoLib)
  const blb = [x0, y0, z0];
  const brb = [x0, y0, z1];
  const tlb = [x0, y1, z0];
  const trb = [x0, y1, z1];
  const tlf = [x1, y1, z0];
  const trf = [x1, y1, z1];
  const blf = [x1, y0, z0];
  const brf = [x1, y0, z1];
  const Q = {
    west: [trb, tlb, blb, brb],
    east: [tlf, trf, brf, blf],
    north: [tlb, tlf, blf, blb],
    south: [trf, trb, brb, brf],
    up: [trb, trf, tlf, tlb],
    down: [blb, blf, brf, brb],
  };
  const box = Array.isArray(cube.uv);
  const out = [];
  for (const dir of DIRS) {
    let uv;
    let us;
    let rot = 0;
    if (box) {
      const [u, v] = cube.uv;
      const [sx, sy, sz] = size.map(Math.floor);
      [uv, us] = {
        west: [
          [u + sz + sx, v + sz],
          [sz, sy],
        ],
        east: [
          [u, v + sz],
          [sz, sy],
        ],
        north: [
          [u + sz, v + sz],
          [sx, sy],
        ],
        south: [
          [u + sz + sx + sz, v + sz],
          [sx, sy],
        ],
        up: [
          [u + sz, v],
          [sx, sz],
        ],
        down: [
          [u + sz + sx, v + sz],
          [sx, -sz],
        ],
      }[dir];
    } else {
      const f = cube.uv?.[dir];
      if (!f) {
        out.push({ dir, missing: true });
        continue;
      }
      if (!Array.isArray(f.uv) || !Array.isArray(f.uv_size)) {
        out.push({ dir, missing: true, bad: true });
        continue;
      }
      uv = f.uv;
      us = f.uv_size;
      rot = (((f.uv_rotation ?? 0) % 360) + 360) % 360;
    }
    // verticesForQuad: mirror — запад ↔ восток, при UV по граням ещё верх ↔ низ
    let vd = dir;
    if (mirror && (dir === 'west' || dir === 'east')) vd = dir === 'west' ? 'east' : 'west';
    if (mirror && !box && (dir === 'up' || dir === 'down')) vd = dir === 'up' ? 'down' : 'up';
    // GeoQuad.build
    let uW = (uv[0] + us[0]) / tw;
    const vH = (uv[1] + us[1]) / th;
    let u = uv[0] / tw;
    const v = uv[1] / th;
    const N = [...STEP[dir]];
    if (!mirror) [u, uW] = [uW, u];
    else N[0] = -N[0];
    const r = rot / 90;
    const uvs = [
      [u, v, uW, v, uW, vH, u, vH],
      [uW, v, uW, vH, u, vH, u, v],
      [uW, vH, u, vH, u, v, uW, v],
      [u, vH, u, v, uW, v, uW, vH],
    ][r];
    // Вершина с (u, v) — начало, с (uW, v) — конец по u, с (u, vH) — конец по v
    const [iO, iU, iV] = [
      [0, 1, 3],
      [3, 0, 2],
      [2, 3, 1],
      [1, 2, 0],
    ][r];
    const P = Q[vd];
    out.push({
      dir,
      P: [P[iO], P[iU], P[iV]],
      uv: [uvs[2 * iO], uvs[2 * iO + 1], uvs[2 * iU], uvs[2 * iV + 1]],
      N,
      px: { u: uv[0], v: uv[1], us: us[0], vs: us[1] },
    });
  }
  return out;
}

/** Матрица вокруг pivot (GeckoLib: pivot.x зеркалится, углы −x, −y, z; порядок Z, Y, X) */
function pivotRot(pose, pivot = [0, 0, 0], rotation = [0, 0, 0]) {
  const p = [-pivot[0], pivot[1], pivot[2]];
  pose.t(...p);
  if (rotation[2]) pose.r('z', rotation[2] * DEG);
  if (rotation[1]) pose.r('y', -rotation[1] * DEG);
  if (rotation[0]) pose.r('x', -rotation[0] * DEG);
  return pose.t(-p[0], -p[1], -p[2]);
}

/** Из пространства GeckoLib в координаты рисунка: поворот 180° по Y, центр блока — (8, ·, 8) */
const toWorld = ([x, y, z]) => [8 - x, y, 8 - z];
const toWorldDir = ([x, y, z]) => [-x, y, -z];

/**
 * Модель GeckoLib для renderModel. opts: texture — id текстуры (как geoTextureId), bones — только эти кости с
 * дочерними, silhouette — auto (части игрока под кубами костей брони) | all | none.
 * Возвращает { model, lines } или { error, lines }.
 */
export function geoModel(layers, id, { texture, bones, silhouette = 'auto', loadTexture } = {}) {
  const file = geoPath(id);
  const r = findResource(layers, file);
  if (!r) {
    const ns = resLoc(String(id).replace(/^assets\/([^/]+)\//, '$1:')).ns;
    const all = geoFiles(layers, ns);
    return {
      error: true,
      lines: [
        `Модели ${file} нет ни в одном слое (ресурспаки, KubeJS, аддоны, jar, Minecraft).`,
        all.length
          ? `Модели GeckoLib в ${ns}: ${all.slice(0, 30).join(', ')}${all.length > 30 ? ` … ещё ${all.length - 30}` : ''}`
          : `В namespace ${ns} моделей GeckoLib (assets/${ns}/geo/) нет.`,
      ],
    };
  }
  let json;
  try {
    json = JSON.parse(r.data.toString('utf8'));
  } catch (e) {
    return { error: true, lines: [`${file} (${r.from}): JSON не разобрался — ${e.message}`] };
  }
  const geo = json['minecraft:geometry']?.[0];
  if (!geo)
    return {
      error: true,
      lines: [
        `${file} (${r.from}): нет minecraft:geometry — формат ${json.format_version ?? '?'} (GeckoLib 4 читает 1.12+)`,
      ],
    };
  const desc = geo.description ?? {};
  const tw = desc.texture_width ?? 64;
  const th = desc.texture_height ?? 64;
  const lines = [
    `модель GeckoLib ${file} (${r.from}); формат ${json.format_version ?? '?'}, ${desc.identifier ?? 'без identifier'}, развёртка ${tw}×${th}`,
  ];
  const warns = [];

  // Текстура
  let texId = texture ? geoTextureId(texture) : guessTexture(layers, file, tw, th, loadTexture);
  let tex = null;
  if (texId) {
    tex = loadTexture(layers, texId);
    if (!tex || tex.error) {
      warns.push(`нет текстуры ${texturePath(texId)}${tex?.error ? ` (${tex.error})` : ''} — грани в клетку`);
      tex = null;
    } else {
      lines.push(
        `текстура ${texturePath(texId)} (${tex.from}) ${tex.w}×${tex.h}${texture ? '' : ' — не указана, взята по имени модели (texture=…)'}`,
      );
      if (Math.abs(tex.w / tex.h - tw / th) > 1e-6)
        warns.push(`пропорции текстуры ${tex.w}×${tex.h} не как у развёртки ${tw}×${th} — UV растянуты`);
    }
  } else warns.push('текстура не указана и по имени модели не нашлась — грани в клетку (texture=ns:textures/….png)');

  // Дерево костей
  const list = Array.isArray(geo.bones) ? geo.bones : [];
  const byName = new Map(list.map((b) => [b.name, b]));
  const kids = new Map();
  const roots = [];
  for (const b of list) {
    if (b.parent && !byName.has(b.parent)) warns.push(`кость ${b.name}: родителя ${b.parent} нет — считается корнем`);
    if (b.parent && byName.has(b.parent)) (kids.get(b.parent) ?? kids.set(b.parent, []).get(b.parent)).push(b);
    else roots.push(b);
  }
  const only = bones
    ? new Set(
        String(bones)
          .split(/[,\s]+/)
          .filter(Boolean),
      )
    : null;
  if (only) for (const n of only) if (!byName.has(n)) warns.push(`кости ${n} в модели нет`);
  const subtreeCubes = (b) =>
    (b.cubes?.length ?? 0) + (kids.get(b.name) ?? []).reduce((s, c) => s + subtreeCubes(c), 0);

  // Грани
  const quads = [];
  const stats = { bones: 0, cubes: 0, faces: 0, missing: 0, transparent: [], outside: [] };
  const drawn = [];
  const isClear = (px) => {
    if (!tex) return false;
    const kx = tex.w / tw;
    const ky = tex.h / th;
    const ua = Math.min(px.u, px.u + px.us) * kx;
    const ub = Math.max(px.u, px.u + px.us) * kx;
    const va = Math.min(px.v, px.v + px.vs) * ky;
    const vb = Math.max(px.v, px.v + px.vs) * ky;
    const x0 = Math.max(0, Math.floor(ua));
    const x1 = Math.min(tex.w - 1, Math.max(x0, Math.ceil(ub) - 1));
    const y0 = Math.max(0, Math.floor(va));
    const y1 = Math.min(tex.h - 1, Math.max(y0, Math.ceil(vb) - 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (tex.a[y * tex.w + x]) return false;
    return true;
  };
  const walk = (b, pose, on, path) => {
    if (b.neverRender === true || b.never_render === true) return;
    const ps = pivotRot(pose.copy(), b.pivot, b.rotation);
    const show = on || !only || only.has(b.name);
    if (show) stats.bones++;
    for (const [ci, c] of (show ? (b.cubes ?? []) : []).entries()) {
      stats.cubes++;
      const cp = pivotRot(ps.copy(), c.pivot, c.rotation);
      for (const f of cubeFaces(c, b.inflate, tw, th)) {
        const where = `${b.name} куб ${ci + 1} ${f.dir}`;
        if (f.missing) {
          stats.missing++;
          if (f.bad) warns.push(`${where}: нет uv или uv_size — грань не строится`);
          continue;
        }
        stats.faces++;
        const { u, v, us, vs } = f.px;
        const [ua, ub] = [Math.min(u, u + us), Math.max(u, u + us)];
        const [va, vb] = [Math.min(v, v + vs), Math.max(v, v + vs)];
        if (ua < -1e-6 || va < -1e-6 || ub > tw + 1e-6 || vb > th + 1e-6)
          stats.outside.push(`${where}: UV [${ua}–${ub}]×[${va}–${vb}] за краем ${tw}×${th}`);
        else if (isClear(f.px)) stats.transparent.push(`${where} [${u}, ${v}] ${us}×${vs}`);
        quads.push({
          P: f.P.map((x) => toWorld(apply(cp.m, x))),
          uv: f.uv.map((x) => x * 16),
          N: toWorldDir(applyDir(cp.m, f.N)),
          tex: tex ? texId : null,
          tint: null,
          overlay: false,
        });
      }
    }
    drawn.push({ name: b.name, depth: path, cubes: show ? (b.cubes?.length ?? 0) : 0, shown: show });
    for (const c of kids.get(b.name) ?? []) walk(c, ps, show && Boolean(only), path + 1);
  };
  for (const b of roots) walk(b, new Pose(), false, 0);
  if (!quads.length) warns.push(only ? 'у выбранных костей нет граней' : 'в модели нет кубов');

  // Силуэт игрока: части под костями брони с кубами
  const armor = list.filter((b) => ARMOR_BONES[b.name]);
  const sil = new Set();
  if (silhouette === 'all') Object.keys(PLAYER).forEach((k) => sil.add(k));
  else if (silhouette !== 'none' && silhouette !== false)
    for (const b of armor) if ((!only || only.has(b.name)) && subtreeCubes(b)) sil.add(ARMOR_BONES[b.name]);
  for (const part of sil)
    for (const [origin, size] of PLAYER[part])
      for (const f of cubeFaces({ origin, size, uv: [0, 0] }, 0, 64, 64))
        quads.push({
          P: f.P.map(toWorld),
          uv: [0, 0, 16, 16],
          N: toWorldDir(f.N),
          tex: null,
          color: SILHOUETTE,
          cull: true,
          tint: null,
          overlay: false,
        });

  // Текст: дерево костей (кости без кубов во всём поддереве — одной строкой в конце)
  const tree = drawn.filter((d) => d.cubes || subtreeCubes(byName.get(d.name)));
  lines.push(
    `кости: ${list.length}, нарисовано кубов ${stats.cubes}, граней ${stats.faces}${stats.missing ? ` (не заданы ещё ${stats.missing})` : ''}`,
  );
  for (const d of tree)
    lines.push(
      `  ${'  '.repeat(d.depth)}${d.name}${d.cubes ? ` — кубов ${d.cubes}` : ''}${d.shown ? '' : ' (не выбрана)'}`,
    );
  const empty = list.filter((b) => !subtreeCubes(b)).map((b) => b.name);
  if (empty.length) lines.push(`  без кубов: ${empty.join(', ')}`);
  if (armor.length)
    lines.push(
      `броня: кости ${armor.map((b) => `${b.name}${subtreeCubes(b) ? ` (${subtreeCubes(b)})` : ''}`).join(', ')}${sil.size ? `; силуэт игрока: ${[...sil].join(', ')}` : ''}`,
    );
  if (stats.outside.length)
    warns.push(
      `UV за краем текстуры (${stats.outside.length}): ${stats.outside.slice(0, 12).join('; ')}${stats.outside.length > 12 ? ' …' : ''}`,
    );
  if (stats.transparent.length)
    warns.push(
      `грани с полностью прозрачной областью текстуры — в игре не видны (${stats.transparent.length}): ${stats.transparent.slice(0, 12).join('; ')}${stats.transparent.length > 12 ? ' …' : ''}`,
    );
  return {
    model: {
      id: file,
      chain: [{ id: file, from: r.from }],
      textures: {},
      elements: null,
      // Вид gui — сверху спереди и с правого бока модели (видны юг и запад; модель смотрит на юг)
      display: { gui: { rotation: [30, 45, 0] } },
      generated: false,
      entity: false,
      missing: [],
      errors: [],
      loader: null,
      quads,
    },
    lines,
    warnings: warns,
  };
}
