/**
 * Цвет текстуры для подбора похожих блоков: средний цвет непрозрачных пикселей в CIE Lab и «пестрота» —
 * разброс светлоты по пикселям. Считают одинаково сборщик (scripts/mods/block-colors.mjs) и сайт.
 */

export type Lab = [number, number, number];

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);

/** sRGB 0–255 → Lab (D65) */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const fy = f(y);
  return [116 * fy - 16, 500 * (f(x) - fy), 200 * (fy - f(z))];
}

export interface TextureStats {
  lab: Lab;
  /** Стандартное отклонение светлоты L* по пикселям: 0 — ровный цвет, 15+ — пёстрая фактура */
  spread: number;
}

/** Средний цвет и пестрота по пикселям RGBA; меньше половины непрозрачных — null (стекло, листва, решётки) */
export function textureStats(rgba: ArrayLike<number>, w: number, h: number): TextureStats | null {
  let n = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  const ls: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    n++;
    r += rgba[i * 4];
    g += rgba[i * 4 + 1];
    b += rgba[i * 4 + 2];
    ls.push(rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])[0]);
  }
  if (n < (w * h) / 2) return null;
  const mean = ls.reduce((s, v) => s + v, 0) / n;
  const spread = Math.sqrt(ls.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return { lab: rgbToLab(r / n, g / n, b / n), spread };
}

const rad = Math.PI / 180;

/** Разница цветов CIEDE2000: до 2 — не отличить, ~5 — заметно рядом, 10+ — другой цвет */
export function deltaE(a: Lab, b: Lab): number {
  const [L1, a1, b1] = a;
  const [L2, a2, b2] = b;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (y: number, x: number) => {
    if (!x && !y) return 0;
    const v = Math.atan2(y, x) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1p = h(b1, a1p);
  const h2p = h(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lm = (L1 + L2) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hm = h1p + h2p;
  if (C1p * C2p) {
    if (Math.abs(h1p - h2p) <= 180) hm = (h1p + h2p) / 2;
    else hm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hm - 30) * rad) +
    0.24 * Math.cos(2 * hm * rad) +
    0.32 * Math.cos((3 * hm + 6) * rad) -
    0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp;
  const Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
