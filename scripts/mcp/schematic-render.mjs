/**
 * Картинка схемы Create без браузера: каждый блок — кубик двух цветов (верх и бок), цвета берутся из рисунка
 * блока model_render (render.mjs) по его блокстейту. Виды: iso — изометрия целиком, top — сверху (цвет —
 * верхний блок столбца, ярче выше), layer — один слой по Y клетками. Это обзор, а не точный рендер: форма
 * неполных блоков (ступени, плиты, механизмы Create) не рисуется — точный 3D-вид на сайте.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { T } from '@tfc/core/nbt';
import { copycatSlots } from '@tfc/core/schematicBlockFixes';
import { renderId } from './render.mjs';
import { resourceLayers } from './resources.mjs';
import { decodePng, encodePng } from './tools/map-png.mjs';

const CACHE = path.join(os.homedir(), '.cache', 'tfc-plans', 'schematics');
const COLORS_FILE = path.join(CACHE, 'colors.json');
const COLORS_VERSION = 1;

let colorCache = null;
let layers = null;

function colors() {
  if (colorCache) return colorCache;
  colorCache = new Map();
  try {
    const j = JSON.parse(fs.readFileSync(COLORS_FILE, 'utf8'));
    if (j.version === COLORS_VERSION) for (const [k, v] of Object.entries(j.colors)) colorCache.set(k, v);
  } catch {
    // нет файла — посчитаем заново
  }
  return colorCache;
}

function saveColors() {
  try {
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(COLORS_FILE, JSON.stringify({ version: COLORS_VERSION, colors: Object.fromEntries(colorCache) }));
  } catch {
    // кеш цветов необязателен
  }
}

/** Цвет из id, когда блок не нарисовался (нет блокстейта, рисуется кодом) — стабильный, чтобы различать блоки */
function hashColor(id) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  // Приглушённый серый с лёгким оттенком: не спорит с настоящими цветами, но соседние блоки различимы
  const r = 115 + ((h >>> 0) % 40);
  const g = 115 + ((h >>> 8) % 40);
  const b = 115 + ((h >>> 16) % 40);
  return { top: [r, g, b], side: [r * 0.8, g * 0.8, b * 0.8], alpha: 255, drawn: false };
}

/** Средний цвет непрозрачных пикселей в строках [y0, y1); img — decodePng: rgb (0xRRGGBB) и a по пикселям */
function average(img, y0, y1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < img.width; x++) {
      const k = y * img.width + x;
      if (img.a[k] < 128) continue;
      const c = img.rgb[k];
      r += c >> 16;
      g += (c >> 8) & 255;
      b += c & 255;
      n++;
    }
  return n ? { rgb: [r / n, g / n, b / n], n } : null;
}

/**
 * Цвет блока: { top, side, alpha, drawn }. Рисунок блока в инвентарном ракурсе 24×24: верх кубика — верхние 40 %
 * картинки, бок — нижние 45 %. Мало закрашенных пикселей (стекло, факел, решётка) — полупрозрачный.
 */
export function blockColor(name, props) {
  const state = [...props].map(([k, v]) => `${k}=${v}`).join(',');
  const key = `${name}[${state}]`;
  const cache = colors();
  if (cache.has(key)) return cache.get(key);
  let c = null;
  try {
    layers ??= resourceLayers();
    const r = renderId(layers, name, { kind: 'block', state, size: 24, aa: 1 });
    if (r.png) {
      const img = decodePng(r.png);
      const w = img.width;
      const h = img.height;
      const all = average(img, 0, h);
      const top = average(img, 0, Math.round(h * 0.4)) ?? all;
      const side = average(img, Math.round(h * 0.55), h) ?? all;
      if (all)
        c = {
          top: top.rgb.map(Math.round),
          side: side.rgb.map(Math.round),
          alpha: all.n < w * h * 0.15 ? 150 : 255,
          drawn: true,
        };
    }
  } catch {
    // нет ресурсов или модель не разобралась — цвет из id
  }
  c ??= hashColor(name);
  cache.set(key, c);
  return c;
}

function blend(img, k, rgb, a) {
  if (a >= 255) {
    img[k] = rgb[0];
    img[k + 1] = rgb[1];
    img[k + 2] = rgb[2];
    img[k + 3] = 255;
    return;
  }
  const f = a / 255;
  const ba = img[k + 3] / 255;
  const oa = f + ba * (1 - f);
  for (let i = 0; i < 3; i++) img[k + i] = (rgb[i] * f + img[k + i] * ba * (1 - f)) / (oa || 1);
  img[k + 3] = oa * 255;
}

const shade = (rgb, f) => rgb.map((v) => Math.max(0, Math.min(255, v * f)));

/**
 * Изометрия. Проекция 2:1: экран x = (X − Z)·s, y = (X + Z)·s/2 − Y·s; видны грани +X, +Y, +Z. Порядок
 * отрисовки — по X + Y + Z (дальние раньше), рисуем только блоки с открытой видимой гранью.
 */
function renderIso(m, max) {
  const [X, Y, Z] = m.size;
  const s = Math.max(1, Math.min(16, Math.floor(max / Math.max(X + Z, (X + Z) / 2 + Y))));
  const W = (X + Z) * s;
  const H = Math.ceil(((X + Z) * s) / 2 + Y * s);
  const img = new Uint8Array(W * H * 4);
  // Спрайт кубика: для каждого пикселя — грань (1 верх, 2 левая +Z, 3 правая +X) и край (обводка)
  const proj = (x, y, z) => [(x - z) * s, ((x + z) * s) / 2 - y * s];
  const face = (pts) => pts.map(([x, y, z]) => proj(x, y, z));
  const faces = [
    face([
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
      [0, 1, 1],
    ]),
    face([
      [0, 1, 1],
      [1, 1, 1],
      [1, 0, 1],
      [0, 0, 1],
    ]),
    face([
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
      [1, 0, 0],
    ]),
  ];
  const inside = (poly, px, py) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const sprite = [];
  for (let py = -s * 1.5; py <= s * 1.5; py++)
    for (let px = -s; px <= s; px++) {
      const f = faces.findIndex((poly) => inside(poly, px + 0.5, py + 0.5));
      if (f < 0) continue;
      const edge =
        s >= 4 &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => !inside(faces[f], px + 0.5 + dx, py + 0.5 + dy));
      sprite.push([px, py, f, edge]);
    }
  const ox = Z * s;
  const oy = Y * s;
  const tones = new Map();
  const toneOf = (c) => {
    if (!tones.has(c))
      tones.set(
        c,
        [c.top, shade(c.side, 0.82), shade(c.side, 0.66)].map((rgb) => [rgb, shade(rgb, 0.8)]),
      );
    return tones.get(c);
  };
  const occupied = new Set(m.cells.filter((c) => c.col.alpha === 255).map((c) => key(c.pos, m.size)));
  const open = (p) =>
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ].some(([dx, dy, dz]) => !occupied.has(key([p[0] + dx, p[1] + dy, p[2] + dz], m.size)));
  const shown = m.cells.filter((c) => open(c.pos));
  shown.sort((a, b) => a.pos[0] + a.pos[1] + a.pos[2] - (b.pos[0] + b.pos[1] + b.pos[2]));
  for (const c of shown) {
    const [bx, by] = proj(...c.pos);
    const t = toneOf(c.col);
    const a = c.col.alpha;
    for (const [px, py, f, edge] of sprite) {
      const x = Math.floor(ox + bx + px);
      const y = Math.floor(oy + by + py);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      blend(img, (y * W + x) * 4, t[f][edge ? 1 : 0], a);
    }
  }
  return { w: W, h: H, img, scale: s, drawn: shown.length };
}

const key = (p, size) =>
  p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= size[0] || p[1] >= size[1] || p[2] >= size[2]
    ? -1
    : (p[1] * size[2] + p[2]) * size[0] + p[0];

/** Вид сверху: клетка — верхний непустой блок столбца, чем ниже, тем темнее */
function renderTop(m, max) {
  const [X, Y, Z] = m.size;
  const c = Math.max(1, Math.min(24, Math.floor(max / Math.max(X, Z))));
  const top = new Map();
  for (const b of m.cells) {
    const k = b.pos[2] * X + b.pos[0];
    const was = top.get(k);
    if (!was || was.pos[1] < b.pos[1]) top.set(k, b);
  }
  const W = X * c;
  const H = Z * c;
  const img = new Uint8Array(W * H * 4);
  for (const b of top.values()) {
    const col = b.col;
    const rgb = shade(col.top, 0.55 + (0.45 * (b.pos[1] + 1)) / Math.max(1, Y));
    fillCell(img, W, b.pos[0], b.pos[2], c, rgb, col.alpha);
  }
  return { w: W, h: H, img, scale: c, drawn: top.size };
}

function fillCell(img, W, cx, cy, c, rgb, a, grid = c >= 6) {
  for (let y = 0; y < c; y++)
    for (let x = 0; x < c; x++) {
      const edge = grid && (x === 0 || y === 0);
      blend(img, ((cy * c + y) * W + cx * c + x) * 4, edge ? shade(rgb, 0.75) : rgb, a);
    }
}

/** Слой Y: клетки x → вправо, z → вниз; пустые — светлая сетка */
function renderLayer(m, y, max) {
  const [X, , Z] = m.size;
  const c = Math.max(2, Math.min(32, Math.floor(max / Math.max(X, Z))));
  const W = X * c;
  const H = Z * c;
  const img = new Uint8Array(W * H * 4);
  for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) fillCell(img, W, x, z, c, [200, 200, 200], 60);
  let drawn = 0;
  for (const b of m.cells) {
    if (b.pos[1] !== y) continue;
    fillCell(img, W, b.pos[0], b.pos[2], c, b.col.top, Math.max(200, b.col.alpha));
    drawn++;
  }
  return { w: W, h: H, img, scale: c, drawn };
}

/** Материал копиката (первая часть) из данных блока: { name, props } или null */
function copycatMaterial(nbt) {
  const slot = nbt ? copycatSlots(nbt.value)[0] : null;
  const name = slot?.material.get('Name');
  if (name?.type !== T.String || name.value === 'create:copycat_base') return null;
  const p = slot.material.get('Properties');
  const props = new Map();
  if (p?.type === T.Compound) for (const [k, v] of p.value) if (v.type === T.String) props.set(k, v.value);
  return { name: name.value, props };
}

/**
 * m — { size, states: [{ name, props, empty }], cells: [{ pos, state, nbt }] }. view: iso | top | layer (y).
 * Копикаты красятся цветом материала. Возвращает { png, w, h, scale, drawn, undrawn: [id…] — блоки без рисунка }.
 */
export function renderSchematic(m, { view = 'iso', y = 0, max = 768 } = {}) {
  if (!m.size || m.size.some((v) => !(v > 0))) throw new Error('у схемы нет габаритов');
  const before = colors().size;
  const cols = m.states.map((s) => (s.empty ? null : blockColor(s.name, s.props)));
  const cells = [];
  for (const c of m.cells) {
    let col = cols[c.state];
    if (!col) continue;
    const mat = c.nbt && copycatMaterial(c.nbt);
    if (mat) col = blockColor(mat.name, mat.props);
    cells.push({ pos: c.pos, col });
  }
  if (colors().size !== before) saveColors();
  const mm = { size: m.size, cells };
  const r = view === 'top' ? renderTop(mm, max) : view === 'layer' ? renderLayer(mm, y, max) : renderIso(mm, max);
  const undrawn = [
    ...new Set(m.states.filter((s, i) => cols[i] && !cols[i].drawn && !/copycat/.test(s.name)).map((s) => s.name)),
  ];
  return { png: encodePng(r.w, r.h, r.img), w: r.w, h: r.h, scale: r.scale, drawn: r.drawn, undrawn };
}
