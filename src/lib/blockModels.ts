import { textureUrl } from './items';

/**
 * Модели блоков из jar (scripts/mods/block-models.mjs → /block-models/<ns>.json): blockstate → модели с элементами.
 * Для 3D схем и вида сверху в редакторе слоёв. Грани печём как игра (FaceBakery): uv, rotation грани, поворот
 * элемента (с rescale), поворот варианта x/y, uvlock (упрощённо — uv по положению грани в мире), cullface.
 * Файл грузится по namespace, только для модов блоков схемы.
 */

interface Face {
  /** Слот текстуры модели */
  s: number;
  uv?: [number, number, number, number];
  r?: number;
  c?: Dir;
  i?: number;
}
interface Element {
  /** Треугольник OBJ: x, y, z (пиксели), u, v (0–16) × 3 — вместо from/to/faces */
  o?: number[];
  s?: number;
  f: Vec3;
  t: Vec3;
  r?: { o: Vec3; a: 'x' | 'y' | 'z'; g: number; rs?: 1 };
  sh?: 0;
  faces: Partial<Record<Dir, Face>>;
}
/** [модель, x, y, uvlock?] */
type Part = [number, number, number, 1?];
type When = Record<string, string | boolean | number> | { OR: When[] } | { AND: When[] };
interface BlockFile {
  v: number;
  tex: string[];
  geo: Element[][];
  m: [number, number[]][];
  b: Record<string, { v?: [string, Part[]][]; mp?: [When | null, Part[]][] }>;
}

export type Dir = 'up' | 'down' | 'north' | 'south' | 'east' | 'west';
type Vec3 = [number, number, number];

/** Грань в долях блока (0–1): углы по кругу, uv углов в пикселях текстуры (0–16), нормаль, cullface после поворотов */
export interface Quad {
  p: [Vec3, Vec3, Vec3, Vec3];
  uv: [[number, number], [number, number], [number, number], [number, number]];
  tex: string | null;
  n: Vec3;
  cull: Dir | null;
  tint: boolean;
  shade: boolean;
  /** Треугольник OBJ: обход в файле бывает любым — рисовать с обеих сторон */
  both?: boolean;
}

export interface BlockModel {
  quads: Quad[];
  /** Целый куб 0–16 со всеми шестью гранями — закрывает соседей */
  full: boolean;
}

const files = new Map<string, Promise<BlockFile | null>>();
const ready = new Map<string, BlockFile | null>();

/** Загрузить модели модов (namespace); повторно не грузит */
export function loadBlockModels(namespaces: Iterable<string>): Promise<void> {
  const all: Promise<unknown>[] = [];
  for (const ns of namespaces) {
    let p = files.get(ns);
    if (!p) {
      p = fetch(`${import.meta.env.BASE_URL}block-models/${ns}.json`)
        .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
        .catch(() => null)
        .then((f: BlockFile | null) => {
          ready.set(ns, f?.b ? f : null);
          return f;
        });
      files.set(ns, p);
    }
    all.push(p);
  }
  return Promise.all(all).then(() => undefined);
}

// ---------------------------------------------------------------- состояние → части

const parseKey = (k: string) =>
  k && k !== 'normal'
    ? k.split(',').map((kv) => {
        const i = kv.indexOf('=');
        return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as const;
      })
    : [];

function whenMatches(w: When | null, p: Map<string, string>): boolean {
  if (!w) return true;
  if ('OR' in w && Array.isArray(w.OR)) return w.OR.some((x) => whenMatches(x, p));
  if ('AND' in w && Array.isArray(w.AND)) return w.AND.every((x) => whenMatches(x, p));
  return Object.entries(w).every(([k, v]) => {
    const s = String(v);
    const neg = s.startsWith('!');
    const ok = s
      .replace(/^!/, '')
      .split('|')
      .includes(p.get(k) ?? '');
    return neg ? !ok : ok;
  });
}

/** Части модели для состояния: null — блока нет в данных или его не загрузили */
function partsOf(id: string, props: Map<string, string>): { file: BlockFile; parts: Part[] } | null {
  const [ns, path] = id.includes(':') ? id.split(':', 2) : ['minecraft', id];
  const file = ready.get(ns);
  const b = file?.b[path];
  if (!file || !b) return null;
  if (b.v) {
    const keys = b.v.map(([k]) => parseKey(k));
    // Точное совпадение; нет свойства в палитре — любое значение; не нашлось — первый вариант
    let i = keys.findIndex((kv) => kv.every(([k, v]) => props.get(k) === v));
    if (i < 0) i = keys.findIndex((kv) => kv.every(([k, v]) => !props.has(k) || props.get(k) === v));
    return { file, parts: b.v[Math.max(0, i)][1] };
  }
  // Свойства, которых нет в палитре (замена на блок с другими свойствами), — первое упомянутое значение
  const full = new Map(props);
  const walk = (w: When | null) => {
    if (!w) return;
    if ('OR' in w && Array.isArray(w.OR)) return w.OR.forEach(walk);
    if ('AND' in w && Array.isArray(w.AND)) return w.AND.forEach(walk);
    for (const [k, v] of Object.entries(w)) if (!full.has(k)) full.set(k, String(v).replace(/^!/, '').split('|')[0]);
  };
  for (const [w] of b.mp ?? []) walk(w);
  const parts: Part[] = [];
  for (const [w, ps] of b.mp ?? []) if (whenMatches(w, full)) parts.push(...ps);
  return { file, parts };
}

// ---------------------------------------------------------------- печь грани

const DEG = Math.PI / 180;

/** Поворот вокруг оси (правая тройка, градусы) — как scripts/mcp/render.mjs */
function axisRot([x, y, z]: Vec3, axis: 'x' | 'y' | 'z', deg: number): Vec3 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  if (axis === 'x') return [x, y * c - z * s, y * s + z * c];
  if (axis === 'y') return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}

const NORMALS: Record<Dir, Vec3> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};

/** Ближайшая сторона по нормали */
function dirOf([x, y, z]: Vec3): Dir {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ay >= ax && ay >= az) return y > 0 ? 'up' : 'down';
  if (ax >= az) return x > 0 ? 'east' : 'west';
  return z > 0 ? 'south' : 'north';
}

/** Углы грани: начало uv, конец по u, конец по v (правила UV Minecraft, как faceQuad в render.mjs) */
function faceQuad([x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3, d: Dir): [Vec3, Vec3, Vec3] {
  switch (d) {
    case 'up':
      return [
        [x0, y1, z0],
        [x1, y1, z0],
        [x0, y1, z1],
      ];
    case 'down':
      return [
        [x0, y0, z1],
        [x1, y0, z1],
        [x0, y0, z0],
      ];
    case 'north':
      return [
        [x1, y1, z0],
        [x0, y1, z0],
        [x1, y0, z0],
      ];
    case 'south':
      return [
        [x0, y1, z1],
        [x1, y1, z1],
        [x0, y0, z1],
      ];
    case 'west':
      return [
        [x0, y1, z0],
        [x0, y1, z1],
        [x0, y0, z0],
      ];
    case 'east':
      return [
        [x1, y1, z1],
        [x1, y1, z0],
        [x1, y0, z1],
      ];
  }
}

/** uv по умолчанию (BlockElement.uvsByFace) */
function defaultUv([x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3, d: Dir): [number, number, number, number] {
  switch (d) {
    case 'down':
      return [x0, 16 - z1, x1, 16 - z0];
    case 'up':
      return [x0, z0, x1, z1];
    case 'north':
      return [16 - x1, 16 - y1, 16 - x0, 16 - y0];
    case 'south':
      return [x0, 16 - y1, x1, 16 - y0];
    case 'west':
      return [z0, 16 - y1, z1, 16 - y0];
    case 'east':
      return [16 - z1, 16 - y1, 16 - z0, 16 - y0];
  }
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function bakePart(file: BlockFile, [mi, rx, ry, uvlock]: Part, out: Quad[]): boolean {
  const model = file.m[mi];
  if (!model) return false;
  const [gi, slots] = model;
  // Поворот варианта: сначала x, потом y, оба по часовой (отрицательный угол правой тройки) вокруг центра
  const orient = (v: Vec3): Vec3 => {
    let d = v;
    if (rx) d = axisRot(d, 'x', -rx);
    if (ry) d = axisRot(d, 'y', -ry);
    return d;
  };
  const place = (p: Vec3): Vec3 => {
    const d = orient([p[0] - 8, p[1] - 8, p[2] - 8]);
    return [(d[0] + 8) / 16, (d[1] + 8) / 16, (d[2] + 8) / 16];
  };
  const snap = (v: number) => Math.round(v * 1e5) / 1e5;
  for (const el of file.geo[gi] ?? []) {
    if (el.o) {
      const o = el.o;
      const P = [0, 5, 10].map((i) => place([o[i], o[i + 1], o[i + 2]]).map(snap) as Vec3);
      const UV = [0, 5, 10].map((i) => [o[i + 3], o[i + 4]] as [number, number]);
      const nrm = cross(sub(P[1], P[0]), sub(P[2], P[0]));
      const len = Math.hypot(...nrm);
      if (!len) continue;
      const t = slots[el.s ?? 0];
      out.push({
        p: [P[0], P[1], P[2], P[2]],
        uv: [UV[0], UV[1], UV[2], UV[2]],
        tex: t != null && t >= 0 ? file.tex[t] : null,
        n: nrm.map((c) => c / len) as Vec3,
        cull: null,
        tint: false,
        shade: true,
        both: true,
      });
      continue;
    }
    const er = el.r;
    const elem = (p: Vec3): Vec3 => {
      if (!er?.g) return p;
      let d = sub(p, er.o);
      d = axisRot(d, er.a, er.g);
      if (er.rs) {
        const k = 1 / Math.cos(Math.abs(er.g) * DEG);
        d = d.map((c, i) => ('xyz'[i] === er.a ? c : c * k)) as Vec3;
      }
      return [d[0] + er.o[0], d[1] + er.o[1], d[2] + er.o[2]];
    };
    for (const [d, face] of Object.entries(el.faces) as [Dir, Face][]) {
      const [o, pu, pv] = faceQuad(el.f, el.t, d);
      const w: Vec3 = [pu[0] + pv[0] - o[0], pu[1] + pv[1] - o[1], pu[2] + pv[2] - o[2]];
      const pts = [o, pu, w, pv].map((p) => place(elem(p)).map(snap) as Vec3) as Quad['p'];
      const nrm = orient(er?.g ? axisRot(NORMALS[d], er.a, er.g) : NORMALS[d]);
      let uv = face.uv ?? defaultUv(el.f, el.t, d);
      let rot = ((face.r ?? 0) / 90) & 3;
      // uvlock: текстура не крутится с блоком — uv по положению грани в мире (для граней без поворота элемента)
      if (uvlock && (rx || ry) && !er?.g) {
        const lo = pts.reduce((a, p) => a.map((c, i) => Math.min(c, p[i] * 16)) as Vec3, [16, 16, 16] as Vec3);
        const hi = pts.reduce((a, p) => a.map((c, i) => Math.max(c, p[i] * 16)) as Vec3, [0, 0, 0] as Vec3);
        uv = defaultUv(lo, hi, dirOf(nrm));
        rot = 0;
      }
      // (s, t) углов O, U, W, V → поворот грани по часовой → uv
      const st: [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      const uvs = st.map(([s0, t0]) => {
        let a = s0;
        let b = t0;
        for (let i = 0; i < rot; i++) [a, b] = [b, 1 - a];
        return [uv[0] + (uv[2] - uv[0]) * a, uv[1] + (uv[3] - uv[1]) * b] as [number, number];
      }) as Quad['uv'];
      // Обход против часовой снаружи (для three.js): иначе — в обратном порядке
      if (dot(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])), nrm) < 0) {
        pts.reverse();
        uvs.reverse();
      }
      const t = slots[face.s];
      out.push({
        p: pts,
        uv: uvs,
        tex: t != null && t >= 0 ? file.tex[t] : null,
        n: nrm,
        cull: face.c ? dirOf(orient(NORMALS[face.c])) : null,
        tint: face.i != null,
        shade: el.sh !== 0,
      });
    }
  }
  return true;
}

const isFullElement = (el: Element) =>
  !el.o &&
  !el.r?.g &&
  el.f.every((c) => c === 0) &&
  el.t.every((c) => c === 16) &&
  (['up', 'down', 'north', 'south', 'east', 'west'] as Dir[]).every((d) => el.faces[d]);

const baked = new Map<string, BlockModel | null>();

/**
 * Грани блока по модели из jar. null — модели нет (блока нет в данных, рисует код: сундук, ремень Create;
 * OBJ) — тогда рисуется запасная форма. Файл мода должен быть загружен (loadBlockModels).
 */
export function blockModel(id: string, props: Map<string, string>): BlockModel | null {
  const key = `${id}[${[...props].map(([k, v]) => `${k}=${v}`).join(',')}]`;
  if (baked.has(key)) return baked.get(key)!;
  const got = partsOf(id, props);
  let res: BlockModel | null = null;
  if (got) {
    const quads: Quad[] = [];
    let full = false;
    for (const pt of got.parts) {
      if (pt[0] < 0) continue;
      if (bakePart(got.file, pt, quads) && (got.file.geo[got.file.m[pt[0]][0]] ?? []).some(isFullElement)) full = true;
    }
    if (quads.length) res = { quads, full };
  }
  // Пока файл не загружен — не запоминаем
  const [ns] = id.includes(':') ? id.split(':', 2) : ['minecraft'];
  if (ready.has(ns)) baked.set(key, res);
  return res;
}

/** Элемент модели как в JSON jar — для частей, которые игра дорисовывает кодом (отводы трубы Create) */
export interface RawElement {
  from: Vec3;
  to: Vec3;
  faces: Partial<Record<Dir, { uv: [number, number, number, number]; rotation?: number }>>;
}

/** Грани элементов с одной текстурой, повёрнутые как вариант blockstate (x, y) */
export function bakeElements(els: RawElement[], tex: string, rx = 0, ry = 0): Quad[] {
  const geo: Element[] = els.map((e) => ({
    f: e.from,
    t: e.to,
    faces: Object.fromEntries(
      Object.entries(e.faces).map(([d, f]) => [d, { s: 0, uv: f!.uv, r: f!.rotation }]),
    ) as Element['faces'],
  }));
  const out: Quad[] = [];
  bakePart({ v: 0, tex: [tex], geo: [geo], m: [[0, [0]]], b: {} }, [0, rx, ry], out);
  return out;
}

// ---------------------------------------------------------------- вид сверху (редактор слоёв)

const SIZE = 32;
const imgs = new Map<string, HTMLImageElement | 'loading' | 'failed'>();
const tops = new Map<string, HTMLCanvasElement | null>();

/**
 * Блок сверху по модели: грани, смотрящие вверх, снизу вверх по высоте (с затенением по высоте для понятности).
 * undefined — ещё грузится (onReady позовут), null — модели нет или сверху ничего не видно.
 */
export function blockTopView(
  id: string,
  props: Map<string, string>,
  onReady: () => void,
): HTMLCanvasElement | null | undefined {
  const [ns] = id.includes(':') ? id.split(':', 2) : ['minecraft'];
  if (!ready.has(ns)) {
    loadBlockModels([ns]).then(onReady);
    return undefined;
  }
  const key = `${id}[${[...props].map(([k, v]) => `${k}=${v}`).join(',')}]`;
  if (tops.has(key)) return tops.get(key)!;
  const m = blockModel(id, props);
  const up = (m?.quads ?? [])
    .filter((q) => q.n[1] > 0.7 && q.tex)
    .map((q) => ({ q, y: Math.max(...q.p.map((p) => p[1])) }))
    .sort((a, b) => a.y - b.y);
  if (!up.length) {
    tops.set(key, null);
    return null;
  }
  // Все текстуры загружены? Нет — грузим и ждём
  let wait = false;
  for (const { q } of up) {
    const t = q.tex!;
    const have = imgs.get(t);
    if (have === 'loading') wait = true;
    if (have) continue;
    wait = true;
    imgs.set(t, 'loading');
    const img = new Image();
    img.onload = () => {
      imgs.set(t, img);
      onReady();
    };
    img.onerror = () => {
      imgs.set(t, 'failed');
      onReady();
    };
    img.src = textureUrl(t);
  }
  if (wait) return undefined;
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (const { q, y } of up) {
    const img = imgs.get(q.tex!);
    if (!(img instanceof HTMLImageElement)) continue;
    const tw = img.naturalWidth;
    // Аффинное отображение текстуры (пиксели) → экран (x, z) по трём углам
    const [a, b, , d] = [0, 1, 2, 3].map((i) => ({
      u: (q.uv[i][0] / 16) * tw,
      v: (q.uv[i][1] / 16) * tw,
      x: q.p[i][0] * SIZE,
      y: q.p[i][2] * SIZE,
    }));
    const du1 = b.u - a.u;
    const dv1 = b.v - a.v;
    const du2 = d.u - a.u;
    const dv2 = d.v - a.v;
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-9) continue;
    const m11 = ((b.x - a.x) * dv2 - (d.x - a.x) * dv1) / det;
    const m12 = ((d.x - a.x) * du1 - (b.x - a.x) * du2) / det;
    const m21 = ((b.y - a.y) * dv2 - (d.y - a.y) * dv1) / det;
    const m22 = ((d.y - a.y) * du1 - (b.y - a.y) * du2) / det;
    ctx.save();
    ctx.beginPath();
    q.p.forEach((p, i) => (i ? ctx.lineTo(p[0] * SIZE, p[2] * SIZE) : ctx.moveTo(p[0] * SIZE, p[2] * SIZE)));
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(m11, m21, m12, m22, a.x - m11 * a.u - m12 * a.v, a.y - m21 * a.u - m22 * a.v);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    // Ниже — темнее: видно, где ступенька, а где плита
    if (y < 0.99) {
      ctx.save();
      ctx.beginPath();
      q.p.forEach((p, i) => (i ? ctx.lineTo(p[0] * SIZE, p[2] * SIZE) : ctx.moveTo(p[0] * SIZE, p[2] * SIZE)));
      ctx.closePath();
      ctx.clip();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(0,0,0,${(0.45 * (1 - y)).toFixed(3)})`;
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.restore();
    }
  }
  if (up.some(({ q }) => q.tint)) {
    // Окраска по биому (листва, трава) — как в 3D; прозрачное остаётся прозрачным
    const mask = document.createElement('canvas');
    mask.width = SIZE;
    mask.height = SIZE;
    mask.getContext('2d')!.drawImage(c, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(140,204,102)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  tops.set(key, c);
  return c;
}
