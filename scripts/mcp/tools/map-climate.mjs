/**
 * Климат TFC Real World при koppen_from_map = true — повтор кода мода (TFC-Real-World 4.1.4, сверено по байткоду):
 *  - world/climate/RealKoppenClimateClassification.classify — класс Кёппена по (температура, осадки, разброс осадков);
 *  - world/noise/koppen/KoppenParameterCache — для каждого класса все сочетания параметров с шагом 1 °C / 10 мм / 0,1,
 *    сетка 64×64 «яркость температуры × яркость осадков → ближайшее сочетание» (с ошибкой мода: максимум
 *    начинается с Float.MIN_VALUE, а не с −∞ — повторена);
 *  - world/noise/koppen/SmoothedKoppenParameterMaps — по пикселям koppen/temperature/rainfall.png параметры, затем
 *    сглаживание очередью (соседи различаются не больше чем на 2 °C, 20 мм, 0,5) и билинейная выборка;
 *  - world/noise/png/BasePNGNoise.fillTileImageCoords — клетка сетки (128 блоков) → пиксель карты с зеркалом тайлов.
 * Серые карты мод при этом читает через BufferedImage.getRGB, а Java переводит линейный серый в sRGB (128 → 188):
 * таблица JAVA_GRAY снята с Java 26 (BufferedImage TYPE_BYTE_GRAY), без неё температура уходит на градусы.
 * Дальше TFC (RegionChunkDataGenerator) билинейно смешивает 4 соседние точки сетки — так же и здесь.
 * Арифметика float — через Math.fround там, где в моде float.
 */
const f = Math.fround;

const TEMP_MIN = -25;
const TEMP_MAX = 30;
const RAIN_MAX = 500;
const DEFAULT = { t: 2.5, r: 250, v: 0 };
const GRID = 64;
const F_MAX = f(3.4028235e38);
const F_MIN_VALUE = f(1.4e-45);
const F_EPS = f(0.001);

// prettier-ignore
const JAVA_GRAY = [0,13,22,28,34,38,42,46,50,53,56,59,61,64,66,69,71,73,75,77,79,81,83,85,86,88,90,92,93,95,96,98,99,101,102,104,105,106,108,109,110,112,113,114,115,117,118,119,120,121,122,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,148,149,150,151,152,153,154,155,155,156,157,158,159,159,160,161,162,163,163,164,165,166,167,167,168,169,170,170,171,172,173,173,174,175,175,176,177,178,178,179,180,180,181,182,182,183,184,185,185,186,187,187,188,189,189,190,190,191,192,192,193,194,194,195,196,196,197,197,198,199,199,200,200,201,202,202,203,203,204,205,205,206,206,207,208,208,209,209,210,210,211,212,212,213,213,214,214,215,215,216,216,217,218,218,219,219,220,220,221,221,222,222,223,223,224,224,225,226,226,227,227,228,228,229,229,230,230,231,231,232,232,233,233,234,234,235,235,236,236,237,237,238,238,238,239,239,240,240,241,241,242,242,243,243,244,244,245,245,246,246,246,247,247,248,248,249,249,250,250,251,251,251,252,252,253,253,254,254,255,255];

/** Цвет карты koppen.png → класс (PNGKoppenNoise.COLOR_TO_CLIMATE) */
// prettier-ignore
const COLORS = [
  [0, 0, 220, 'AF'], [0, 100, 240, 'AS'], [0, 150, 220, 'AW'], [40, 80, 200, 'AM'],
  [210, 0, 0, 'BWH'], [210, 120, 0, 'BSH'], [200, 80, 80, 'BWK'], [200, 120, 60, 'BSK'],
  [250, 250, 0, 'CSA'], [180, 180, 0, 'CSB'], [120, 120, 0, 'CSC'],
  [100, 240, 130, 'CWA'], [80, 210, 120, 'CWB'], [70, 160, 110, 'CWC'],
  [170, 240, 90, 'CFA'], [140, 200, 80, 'CFB'], [110, 170, 70, 'CFC'],
  [190, 20, 190, 'DSA'], [160, 20, 180, 'DSB'], [130, 20, 170, 'DSC'], [100, 20, 160, 'DSD'],
  [40, 190, 190, 'DFA'], [30, 170, 170, 'DFB'], [20, 150, 140, 'DFC'], [10, 130, 110, 'DFD'],
  [80, 80, 220, 'DWA'], [70, 70, 190, 'DWB'], [60, 60, 160, 'DWC'], [60, 60, 130, 'DWD'],
  [190, 190, 190, 'ET'], [80, 80, 80, 'EF'],
];
const BY_RGB = new Map(COLORS.map(([r, g, b, k]) => [(r << 16) | (g << 8) | b, k]));

export const KOPPEN_RU = {
  AF: 'тропический влажный',
  AM: 'тропический муссонный',
  AW: 'саванна, сухая зима',
  AS: 'саванна, сухое лето',
  BWH: 'жаркая пустыня',
  BWK: 'холодная пустыня',
  BSH: 'жаркая степь',
  BSK: 'холодная степь',
  CSA: 'средиземноморский, жаркое лето',
  CSB: 'средиземноморский, тёплое лето',
  CSC: 'средиземноморский, прохладное лето',
  CWA: 'субтропический, сухая зима, жаркое лето',
  CWB: 'субтропический, сухая зима, тёплое лето',
  CWC: 'субтропический, сухая зима, прохладное лето',
  CFA: 'влажный субтропический',
  CFB: 'умеренный морской',
  CFC: 'субполярный морской',
  DSA: 'континентальный, сухое жаркое лето',
  DSB: 'континентальный, сухое тёплое лето',
  DSC: 'субарктический, сухое лето',
  DSD: 'субарктический, сухое лето, очень холодная зима',
  DFA: 'влажный континентальный, жаркое лето',
  DFB: 'влажный континентальный, тёплое лето',
  DFC: 'субарктический',
  DFD: 'субарктический, очень холодная зима',
  DWA: 'континентальный, сухая зима, жаркое лето',
  DWB: 'континентальный, сухая зима, тёплое лето',
  DWC: 'субарктический, сухая зима',
  DWD: 'субарктический, сухая зима, очень холодная зима',
  ET: 'тундра',
  EF: 'ледяной',
};

/** PNGKoppenNoise.getClimateFromRgb: точный цвет или ближайший по сумме квадратов */
export function koppenOf(rgb) {
  const k = BY_RGB.get(rgb & 0xffffff);
  if (k) return k;
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  let best = 'EF';
  let dist = 2147483647;
  for (const [cr, cg, cb, kk] of COLORS) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < dist) [dist, best] = [d, kk];
  }
  return best;
}

// ---------------------------------------------------------------- RealKoppenClimateClassification.classify(t, r, v, true)

function temperate(v, r, w, s, fw) {
  if (v > 0.5 && r > 315) return w;
  if (v < -0.5 && r < 175) return s;
  if (v <= 0.5 && v >= -0.5 && r <= 315 && r >= 175) return fw;
  return null;
}

export function classify(t, r, v) {
  if (t < -17 + 0.006 * r) return 'EF';
  if (t <= -12) return 'ET';
  if (r < 75) return t > 18 ? 'BWH' : 'BWK';
  if (r < 150) return t > 18 ? 'BSH' : 'BSK';
  if (t > 21) {
    if (f(r * f(1 + v)) > 600) return 'AM';
    if (v > 0.5) return 'AW';
    if (v < -0.5) return 'AS';
    return 'AF';
  }
  if (t > 8) {
    if (t > 17) return temperate(v, r, 'CWA', 'CSA', 'CFA');
    if (t > 12) return temperate(v, r, 'CWB', 'CSB', 'CFB');
    return temperate(v, r, 'CWC', 'CSC', 'CFC');
  }
  if (t > 3) return temperate(v, r, 'DWA', 'DSA', 'DFA');
  if (t > -2) return temperate(v, r, 'DWB', 'DSB', 'DFB');
  if (t > -8) return temperate(v, r, 'DWC', 'DSC', 'DFC');
  return temperate(v, r, 'DWD', 'DSD', 'DFD');
}

// ---------------------------------------------------------------- KoppenParameterCache

function range(lo, hi, step) {
  const n = Math.ceil(f(f(hi - lo) / step)) + 1;
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.min(f(lo + f(i * step)), hi));
  return out;
}

function stats(arr) {
  const s = { t: [F_MAX, F_MIN_VALUE], r: [F_MAX, F_MIN_VALUE], v: [F_MAX, F_MIN_VALUE] };
  for (const c of arr)
    for (const k of ['t', 'r', 'v']) {
      if (c[k] < s[k][0]) s[k][0] = c[k];
      if (c[k] > s[k][1]) s[k][1] = c[k];
    }
  return s;
}

let cache = null;
function parameterGrids() {
  if (cache) return cache;
  const temps = range(TEMP_MIN, TEMP_MAX, 1);
  const rains = range(0, RAIN_MAX, 10);
  const vars = range(-1, 1, f(0.1));
  const combos = new Map();
  for (const t of temps)
    for (const r of rains)
      for (const v of vars) {
        const k = classify(t, r, v);
        if (!k) continue;
        if (!combos.has(k)) combos.set(k, []);
        combos.get(k).push({ t, r, v });
      }
  const grids = new Map();
  for (const [k, arr] of combos) {
    // sortParameterArray: по сумме нормированных параметров ×100, устойчиво
    const s = stats(arr);
    const span = (x) => Math.max(f(x[1] - x[0]), F_EPS);
    const [st, sr, sv] = [span(s.t), span(s.r), span(s.v)];
    const key = (c) => f(f(c.t - s.t[0]) / st) * 100 + f(f(c.r - s.r[0]) / sr) * 100 + f(f(c.v - s.v[0]) / sv) * 100;
    const sorted = arr.map((c) => [key(c), c]).sort((a, b) => a[0] - b[0]);
    const list = sorted.map((x) => x[1]);
    // computeStatistics + buildParameterGrid + findClosestCombination
    const g = stats(list);
    const it = f(1 / Math.max(f(g.t[1] - g.t[0]), F_EPS));
    const ir = f(1 / Math.max(f(g.r[1] - g.r[0]), F_EPS));
    const grid = [];
    for (let i = 0; i < GRID; i++) {
      const tt = f(g.t[0] + f(f(f(g.t[1] - g.t[0]) * i) / 63));
      for (let j = 0; j < GRID; j++) {
        const rr = f(g.r[0] + f(f(f(g.r[1] - g.r[0]) * j) / 63));
        let best = 0;
        let bd = F_MAX;
        for (let n = 0; n < list.length; n++) {
          const dt = f(f(list[n].t - tt) * it);
          const dr = f(f(list[n].r - rr) * ir);
          const d = f(f(dt * dt) + f(dr * dr));
          if (d < bd) [bd, best] = [d, n];
        }
        grid[i * GRID + j] = list[best];
      }
    }
    grids.set(k, grid);
  }
  cache = grids;
  return grids;
}

/** KoppenParameterCache.getParametersFromGrayscale */
function paramsFromGray(k, tg, rg) {
  const grid = parameterGrids().get(k);
  if (!grid) return DEFAULT;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const i = Math.min(GRID - 1, Math.max(0, Math.floor(clamp01(tg / 255) * (GRID - 1) + 0.5)));
  const j = Math.min(GRID - 1, Math.max(0, Math.floor(clamp01(rg / 255) * (GRID - 1) + 0.5)));
  return grid[i * GRID + j] ?? DEFAULT;
}

// ---------------------------------------------------------------- SmoothedKoppenParameterMaps

const MAXD = { t: 2, r: 2, v: 5 }; // TEMP/RAIN/RAINVAR_TOLERANCE ÷ шаг
const unT = (p) => p & 63;
const unR = (p) => (p >> 6) & 63;
const unV = (p) => (p >> 12) & 31;
const pack = (t, r, v) => (t & 63) | ((r & 63) << 6) | ((v & 31) << 12);
const clampI = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function relaxPair(a, b, hi, maxDiff) {
  const d = b - a;
  const ad = Math.abs(d);
  if (ad <= maxDiff) return null;
  const ex = ad - maxDiff;
  const half = Math.trunc(ex / 2);
  const rem = ex - half * 2;
  if (d > 0) [a, b] = [a + half + rem, b - half];
  else [a, b] = [a - half, b + half + rem];
  return [clampI(a, 0, hi), clampI(b, 0, hi)];
}

function violates(p, i, j) {
  const a = p[i];
  const b = p[j];
  return Math.abs(unT(a) - unT(b)) > MAXD.t || Math.abs(unR(a) - unR(b)) > MAXD.r || Math.abs(unV(a) - unV(b)) > MAXD.v;
}

function relax(p, i, j) {
  let [t1, t2, r1, r2, v1, v2] = [unT(p[i]), unT(p[j]), unR(p[i]), unR(p[j]), unV(p[i]), unV(p[j])];
  let changed = false;
  const t = relaxPair(t1, t2, 55, MAXD.t);
  if (t) [changed, t1, t2] = [true, ...t];
  const r = relaxPair(r1, r2, 50, MAXD.r);
  if (r) [changed, r1, r2] = [true, ...r];
  const v = relaxPair(v1, v2, 20, MAXD.v);
  if (v) [changed, v1, v2] = [true, ...v];
  if (!changed) return false;
  p[i] = pack(t1, r1, v1);
  p[j] = pack(t2, r2, v2);
  return true;
}

function smooth(p, w, h) {
  const n = w * h;
  if (n <= 1) return;
  const inQ = new Uint8Array(n);
  const q = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let size = 0;
  const push = (i) => {
    if (inQ[i]) return;
    inQ[i] = 1;
    q[tail] = i;
    tail = (tail + 1) % n;
    size++;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      if (violates(p, i, i + 1)) {
        push(i);
        push(i + 1);
      }
    }
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (violates(p, i, i + w)) {
        push(i);
        push(i + w);
      }
    }
  const maxDeq = n * 64;
  let deq = 0;
  while (size > 0 && deq < maxDeq) {
    const c = q[head];
    head = (head + 1) % n;
    size--;
    inQ[c] = 0;
    deq++;
    const x = c % w;
    const y = (c - x) / w;
    for (const [ok, nb] of [
      [x > 0, c - 1],
      [x < w - 1, c + 1],
      [y > 0, c - w],
      [y < h - 1, c + w],
    ])
      if (ok && relax(p, c, nb)) {
        push(c);
        push(nb);
      }
  }
  // Запасной путь мода: полные проходы, пока что-то меняется (не больше 256)
  for (let it = 0; it < 256; it++) {
    let changed = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) changed = relax(p, y * w + x, y * w + x + 1) || changed;
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w; x++) changed = relax(p, y * w + x, y * w + x + w) || changed;
    if (!changed) break;
  }
}

/** Яркость пикселя, как её видит SmoothedKoppenParameterMaps.brightness(getRGB): серый — через JAVA_GRAY */
function brightness(img, i) {
  if (img.type === 0 || img.type === 4) {
    const g = JAVA_GRAY[img.v[i]];
    return 0.299 * g + 0.587 * g + 0.114 * g;
  }
  const c = img.rgb[i];
  return 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);
}

/**
 * Сглаженные карты параметров профиля (пиксели koppen/temperature/rainfall.png одного размера).
 * Возвращает sample(gridX, gridZ) → { t, r, v } в точке сетки TFC и koppen(gridX, gridZ) — класс пикселя.
 */
export function buildClimate({ koppen, temperature, rainfall }, hScale, vScale) {
  const { width: w, height: h } = koppen;
  if (temperature.width !== w || rainfall.width !== w || temperature.height !== h || rainfall.height !== h)
    throw new Error('карты koppen/temperature/rainfall разного размера');
  const n = w * h;
  const p = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const c = paramsFromGray(koppenOf(koppen.rgb[i]), brightness(temperature, i), brightness(rainfall, i));
    p[i] = pack(
      clampI(Math.floor(f(c.t + 25) + 0.5), 0, 55),
      clampI(Math.floor(f(c.r / 10) + 0.5), 0, 50),
      clampI(Math.floor(f(f(c.v + 1) / f(0.1)) + 0.5), 0, 20),
    );
  }
  smooth(p, w, h);

  // BasePNGNoise.fillTileImageCoords: клетка сетки → координаты пикселя (с зеркалом тайлов)
  const rx = hScale / 128;
  const rz = vScale / 128;
  const toImage = (gx, gz) => {
    const tx = Math.floor((gx + rx) / (2 * rx));
    const tz = Math.floor((gz + rz) / (2 * rz));
    let lx = gx - tx * 2 * rx;
    let lz = gz - tz * 2 * rz;
    if (((tx % 2) + 2) % 2) lx = -lx;
    if (((tz % 2) + 2) % 2) lz = -lz;
    lx = Math.min(rx, Math.max(-rx, lx));
    lz = Math.min(rz, Math.max(-rz, lz));
    return [
      Math.min(w - 1, Math.max(0, w / 2 + lx * (w / (2 * rx)))),
      Math.min(h - 1, Math.max(0, h / 2 + lz * (h / (2 * rz)))),
    ];
  };
  const bilinear = (x, y, un) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, w - 1);
    const y1 = Math.min(y0 + 1, h - 1);
    const fx = x - x0;
    const fy = y - y0;
    const a = un(p[y0 * w + x0]) * (1 - fx) + un(p[y0 * w + x1]) * fx;
    const b = un(p[y1 * w + x0]) * (1 - fx) + un(p[y1 * w + x1]) * fx;
    return a * (1 - fy) + b * fy;
  };
  const sample = (gx, gz) => {
    const [x, y] = toImage(gx, gz);
    return {
      t: f(bilinear(x, y, unT) + TEMP_MIN),
      r: Math.min(RAIN_MAX, Math.max(0, f(bilinear(x, y, unR) * 10))),
      v: Math.min(1, Math.max(-1, f(-1 + bilinear(x, y, unV) * 0.1))),
    };
  };
  const pixel = (gx, gz) => {
    const [x, y] = toImage(gx, gz);
    return { x: Math.round(x), y: Math.round(y) };
  };
  return {
    toImage,
    pixel,
    sample,
    koppen: (gx, gz) => {
      const { x, y } = pixel(gx, gz);
      return koppenOf(koppen.rgb[y * w + x]);
    },
  };
}

/** Средний климат блока: 4 точки сетки TFC (128 блоков) и билинейное смешение, как в RegionChunkDataGenerator */
export function climateAt(c, x, z) {
  const gx = x / 128;
  const gz = z / 128;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx = gx - x0;
  const fz = gz - z0;
  const s = [c.sample(x0, z0), c.sample(x0 + 1, z0), c.sample(x0, z0 + 1), c.sample(x0 + 1, z0 + 1)];
  const mix = (k) => (s[0][k] * (1 - fx) + s[1][k] * fx) * (1 - fz) + (s[2][k] * (1 - fx) + s[3][k] * fx) * fz;
  return { t: mix('t'), r: mix('r'), v: mix('v') };
}

/** Helpers.adjustAverageTemperatureByElevation: выше уровня моря (63) холоднее на 0,16225 °C/блок, не больше 17,822 */
export const tempAtY = (t, y) => t - Math.min(17.822, Math.max(0, (y - 63) * 0.16225));
