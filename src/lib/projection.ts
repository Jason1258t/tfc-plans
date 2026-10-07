/**
 * Проекция мира TFC Real World: перенос один в один из мода (TFC-Real-World 4.1.4,
 * util/projection/ProjectionManager + EqualEarthProjectionStrategy).
 *
 * Мир — карта Земли в проекции Equal Earth: блок (x, z) ↔ (долгота, широта).
 * horizontalScale/verticalScale — «радиус» карты в блоках: карта занимает x ∈ [−h, h), z ∈ [−v, v).
 * За краями мир повторяется зеркально (тайлы 2h × 2v, каждый нечётный отражён).
 */
export interface WorldProjection {
  horizontalScale: number;
  verticalScale: number;
  westEdgeLongitude: number;
  eastEdgeLongitude: number;
  southEdgeLatitude: number;
  northEdgeLatitude: number;
}

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const SQRT_3 = Math.sqrt(3);
const PI = Math.PI;
const TAU = 2 * Math.PI;

const rad = (d: number) => (d * PI) / 180;
const deg = (r: number) => (r * 180) / PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Java: d % 360 (знак у делимого — как в JS) */
const normalizeLongitude = (d: number) => d % 360;
/** Свести угол в [−π, π] теми же циклами, что в моде */
function wrapPi(a: number) {
  while (a > PI) a -= TAU;
  while (a < -PI) a += TAU;
  return a;
}

/** (широта, долгота) в радианах → (x, y) Equal Earth при R = 1 */
function forward(phi: number, lam: number): [number, number] {
  const theta = Math.asin((SQRT_3 / 2) * Math.sin(phi));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const t8 = t6 * t2;
  const poly = 0.034164 * t8 + 0.006251 * t6 + -0.243318 * t2 + 1.340264;
  const x = (2 * SQRT_3 * 1 * lam * Math.cos(theta)) / (3 * poly);
  const y = 1 * theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x, y];
}

function solveThetaForY(y: number): number {
  const yy = y / 1;
  let theta = Math.asin(Math.min(1, Math.max(-1, ((2 / SQRT_3) * yy) / 2.340264)));
  for (let i = 0; i < 20; i++) {
    const t2 = theta * theta;
    const t6 = t2 * t2 * t2;
    const t8 = t6 * t2;
    const f = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - yy;
    const fp = 1.340264 + -0.243318 * t2 + 0.006251 * t6 + 0.034164 * t8;
    if (Math.abs(fp) < 1e-10) break;
    const d = f / fp;
    theta -= d;
    if (Math.abs(d) < 1e-10) break;
    theta = clamp(theta, -PI / 2, PI / 2);
  }
  return theta;
}

/** (x, y) Equal Earth → [долгота, широта] в радианах */
function inverse(x: number, y: number, lam0: number): [number, number] {
  const theta = solveThetaForY(y);
  const cosT = Math.cos(theta);
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const t8 = t6 * t2;
  const poly = 0.034164 * t8 + 0.006251 * t6 + -0.243318 * t2 + 1.340264;
  const dLam = (3 * poly * x) / (2 * SQRT_3 * 1 * cosT);
  const phi = Math.asin(clamp((2 / SQRT_3) * Math.sin(theta), -1, 1));
  return [wrapPi(lam0 + dLam), phi];
}

/** Рамка карты в координатах проекции: левый/правый край по x и южный/северный по y */
function frame(p: WorldProjection) {
  const west = normalizeLongitude(p.westEdgeLongitude);
  const east = normalizeLongitude(p.eastEdgeLongitude);
  const centerLon = (west + east) / 2;
  const centerLat = (p.southEdgeLatitude + p.northEdgeLatitude) / 2;
  const lam0 = rad(centerLon);
  const phiC = rad(centerLat);
  let xW = forward(phiC, wrapPi(rad(west) - lam0))[0];
  let xE = forward(phiC, wrapPi(rad(east) - lam0))[0];
  const yS = forward(rad(p.southEdgeLatitude), 0)[1];
  const yN = forward(rad(p.northEdgeLatitude), 0)[1];
  let span = east - west;
  if (span < 0) span += 360;
  if (span >= 360) {
    xW = forward(phiC, -PI)[0];
    xE = forward(phiC, PI)[0];
  }
  return { lam0, xW, yS, width: Math.abs(xE - xW), height: Math.abs(yN - yS) };
}

/** Блок → [долгота, широта] в градусах (как ProjectionManager.classicToGeographic) */
export function blockToGeo(p: WorldProjection, x: number, z: number): { lon: number; lat: number } {
  const h = p.horizontalScale;
  const v = p.verticalScale;
  // Зеркальное повторение мира (в моде считается в единицах по 128 блоков)
  const X = x / 128;
  const Z = z / 128;
  const H = h / 128;
  const V = v / 128;
  const gx = Math.floor((X + H) / (2 * H));
  const gz = Math.floor((Z + V) / (2 * V));
  let lx = X - gx * 2 * H;
  let lz = Z - gz * 2 * V;
  if (((gx % 2) + 2) % 2 !== 0) lx = -lx;
  if (((gz % 2) + 2) % 2 !== 0) lz = -lz;
  const localX = lx * 128;
  const localZ = lz * 128;

  const f = frame(p);
  const u = (localX + h) / (2 * h);
  const t = 1 - (localZ + v) / (2 * v);
  const [lam, phi] = inverse(f.xW + u * f.width, f.yS + t * f.height, f.lam0);
  return { lon: normalizeLongitude(deg(lam)), lat: clamp(deg(phi), -90, 90) };
}

/** [долгота, широта] → блок основного (неотражённого) тайла (как ProjectionManager.geographicToClassic) */
export function geoToBlock(p: WorldProjection, lon: number, lat: number): { x: number; z: number } {
  const h = p.horizontalScale;
  const v = p.verticalScale;
  const f = frame(p);
  const [px, py] = forward(rad(clamp(lat, -90, 90)), wrapPi(rad(normalizeLongitude(lon)) - f.lam0));
  const u = (px - f.xW) / f.width;
  const t = 1 - (py - f.yS) / f.height;
  return { x: u * 2 * h - h, z: t * 2 * v - v };
}

/** Внутри основного тайла карты (без зеркальных повторов) */
export const insideMap = (p: WorldProjection, x: number, z: number) =>
  x >= -p.horizontalScale && x < p.horizontalScale && z >= -p.verticalScale && z < p.verticalScale;

/** Расстояние по большому кругу, км */
export function greatCircleKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
