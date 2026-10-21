/**
 * Рисунок модели блока/предмета в PNG без клиента — перенос tools/ee-extras-mod/art/iso.py на Node и дополнения:
 * parent (resources.mjs), поворот элемента (rotation: origin/axis/angle/rescale), поворот варианта блокстейта
 * (x, y), uv по умолчанию, rotation грани, display.gui из цепочки, предметы item/generated (слои), multipart.
 *
 * Проекция ортографическая, свой буфер глубины, затенение граней как в игре (верх 1.0, низ 0.5, север/юг 0.8,
 * запад/восток 0.6) — по нормали после поворотов. Не рисуется: окраска tintindex (трава, листья — серые), ambient
 * occlusion, эмиссия, анимация (берётся первый кадр), модели с loader (obj и т. п.) — о них предупреждение.
 */
import { decodePng, encodePng } from './tools/map-png.mjs';
import { findResource, resolveTexture, texturePath } from './resources.mjs';

const SHADE = { up: 1.0, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };
const DEG = Math.PI / 180;

/** Как iso.py: вокруг Y на −ry, затем вокруг X на rx — поворот display.gui [x, y, 0] (север слева при 225°) */
function viewRot([x, y, z], rx, ry) {
  const a = -ry * DEG;
  const x1 = x * Math.cos(a) + z * Math.sin(a);
  const z1 = -x * Math.sin(a) + z * Math.cos(a);
  const b = rx * DEG;
  return [x1, y * Math.cos(b) - z1 * Math.sin(b), y * Math.sin(b) + z1 * Math.cos(b)];
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

// ---------------------------------------------------------------- 3D

/**
 * Рисунок: parts — [{ model (loadModel), x, y }], view — gui | top | bottom | north | south | east | west.
 * Возвращает { png, warnings, textures: Map(id → откуда | null) }.
 */
export function renderModel(layers, parts, { view = 'gui', size = 256 } = {}) {
  const warnings = new Set();
  const used = new Map();
  const texCache = new Map();
  let rx;
  let ry;
  if (view === 'gui') {
    const gui = parts.find((p) => p.model.display.gui)?.model.display.gui;
    [rx, ry] = gui?.rotation ?? [30, 225, 0];
    if (!gui) warnings.add('нет display.gui в цепочке parent — взят поворот [30, 225, 0] (как у block/block)');
  } else
    [rx, ry] = { top: [90, 0], bottom: [-90, 0], south: [0, 0], north: [0, 180], east: [0, 90], west: [0, -90] }[
      view
    ] ?? [30, 225];

  // Грани в пространстве вида (до масштаба): [{ O, U, V (3D), tex, uv, rot, shade }]
  const quads = [];
  for (const part of parts) {
    const m = part.model;
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
        // Вариант блокстейта: сначала x, потом y, оба — по часовой (отрицательный угол правой тройки)
        let d = [v[0] - 8, v[1] - 8, v[2] - 8];
        if (part.x) d = axisRot(d, 'x', -part.x);
        if (part.y) d = axisRot(d, 'y', -part.y);
        return d;
      };
      const normalOf = (n) => {
        let v = n;
        if (er && er.angle) v = axisRot(v, er.axis, er.angle);
        if (part.x) v = axisRot(v, 'x', -part.x);
        if (part.y) v = axisRot(v, 'y', -part.y);
        return v;
      };
      for (const [name, face] of Object.entries(el.faces ?? {})) {
        if (!NORMALS[name]) continue;
        const [o, pu, pv] = faceQuad(from, to, name);
        const texId = resolveTexture(m.textures, face.texture);
        if (!texId) warnings.add(`${m.id}: текстура ${face.texture} не задана`);
        if (face.tintindex != null && face.tintindex >= 0)
          warnings.add('tintindex: окраску задаёт код — грань без неё');
        quads.push({
          O: viewRot(toBlock(o), rx, ry),
          U: viewRot(toBlock(pu), rx, ry),
          V: viewRot(toBlock(pv), rx, ry),
          tex: texId,
          uv: face.uv ?? defaultUv(from, to, name),
          rot: ((face.rotation ?? 0) % 360) / 90,
          shade: el.shade === false ? 1 : shadeOf(normalOf(NORMALS[name])),
        });
      }
    }
  }
  if (!quads.length) warnings.add('в модели нет элементов');

  // Масштаб: как iso.py (куб 16³ с полем), но целиком уместить, если модель больше блока
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const q of quads)
    for (const p of [q.O, q.U, q.V, [q.U[0] + q.V[0] - q.O[0], q.U[1] + q.V[1] - q.O[1]]]) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  let scale = size / (16 * 1.75);
  let cx = 0;
  let cy = 0;
  if (quads.length) {
    const span = Math.max(maxX - minX, maxY - minY);
    if (span * scale > size * 0.94) scale = (size * 0.94) / span;
    // Не влезает по центру блока — центрируем по рамке
    if (Math.max(-minX, maxX, -minY, maxY) * scale > size * 0.47) {
      cx = (minX + maxX) / 2;
      cy = (minY + maxY) / 2;
    }
  }
  const proj = (p) => [size / 2 + (p[0] - cx) * scale, size / 2 - (p[1] - cy) * scale, p[2]];

  const img = new Uint8Array(size * size * 4);
  const depth = new Float32Array(size * size).fill(-Infinity);
  for (const q of quads) {
    const O = proj(q.O);
    const U = proj(q.U);
    const V = proj(q.V);
    const du = [U[0] - O[0], U[1] - O[1], U[2] - O[2]];
    const dv = [V[0] - O[0], V[1] - O[1], V[2] - O[2]];
    const det = du[0] * dv[1] - du[1] * dv[0];
    // Видна, если смотрит на зрителя (+z после поворота): u × v в экранных координатах (y вниз)
    if (Math.abs(det) < 1e-9 || det < 0) continue;
    let tex = null;
    if (q.tex) {
      tex = loadTexture(layers, q.tex, texCache);
      used.set(q.tex, tex ? (tex.error ? `${tex.from}: ${tex.error}` : tex.from) : null);
      if (tex?.error) tex = null;
    }
    const [u0, v0, u1, v1] = q.uv;
    const xs = [O[0], U[0], V[0], U[0] + dv[0]];
    const ys = [O[1], U[1], V[1], U[1] + dv[1]];
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(size - 1, Math.floor(Math.max(...ys)));
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const x1 = Math.min(size - 1, Math.floor(Math.max(...xs)));
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const qx = px + 0.5 - O[0];
        const qy = py + 0.5 - O[1];
        const s = (qx * dv[1] - qy * dv[0]) / det;
        const t = (du[0] * qy - du[1] * qx) / det;
        if (s < 0 || s >= 1 || t < 0 || t >= 1) continue;
        const z = O[2] + s * du[2] + t * dv[2];
        const k = py * size + px;
        if (z <= depth[k]) continue;
        let a = s;
        let b = t;
        for (let i = 0; i < q.rot; i++) [a, b] = [b, 1 - a]; // поворот текстуры грани по часовой
        let r;
        let g;
        let bl;
        let al;
        if (tex) {
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
        r *= q.shade;
        g *= q.shade;
        bl *= q.shade;
        if (al < 255) {
          // Полупрозрачное — смешиваем поверх, глубину не пишем
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
  for (const [id, from] of used) if (!from) warnings.add(`нет текстуры ${id}`);
  return { png: encodePng(size, size, img), warnings: [...warnings], textures: used };
}

// ---------------------------------------------------------------- плоское: предметы item/generated, текстуры

/** Слои layer0… предмета item/generated — один рисунок по сетке самой крупной текстуры, увеличенный без сглаживания */
export function renderGenerated(layers, model, size = 256) {
  const warnings = [];
  const used = new Map();
  const texs = [];
  for (let i = 0; i < 16; i++) {
    const ref = model.textures[`layer${i}`];
    if (!ref) break;
    const id = resolveTexture(model.textures, ref);
    const t = id ? loadTexture(layers, id) : null;
    used.set(id ?? ref, t ? t.from : null);
    if (!t || t.error) warnings.push(`нет текстуры ${id ?? ref}`);
    else texs.push(t);
  }
  if (!texs.length) {
    warnings.push('у предмета нет слоёв layer0…');
    return { png: encodePng(1, 1, new Uint8Array(4)), warnings, textures: used };
  }
  const n = Math.max(...texs.map((t) => t.w));
  const k = Math.max(1, Math.floor(size / n));
  const W = n * k;
  const img = new Uint8Array(W * W * 4);
  for (const t of texs)
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const tx = Math.floor((x / W) * t.w);
        const ty = Math.floor((y / W) * t.h);
        const al = t.a[ty * t.w + tx];
        if (!al) continue;
        const c = t.rgb[ty * t.w + tx];
        const i4 = (y * W + x) * 4;
        const f = al / 255;
        img[i4] = (c >> 16) * f + img[i4] * (1 - f);
        img[i4 + 1] = ((c >> 8) & 255) * f + img[i4 + 1] * (1 - f);
        img[i4 + 2] = (c & 255) * f + img[i4 + 2] * (1 - f);
        img[i4 + 3] = Math.max(img[i4 + 3], al);
      }
  if (Object.keys(model.textures).some((x) => /^layer[1-9]/.test(x)))
    warnings.push('слои выше layer0 часто окрашиваются кодом (tint) — здесь без окраски');
  return { png: encodePng(W, W, img), warnings, textures: used };
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
