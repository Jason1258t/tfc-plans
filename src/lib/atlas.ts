/**
 * «Обычная» карта из данных мода: маска суши (continent.png) + высоты (altitude.png, 8 бит серого)
 * → гипсометрическая раскраска как в атласе (вода — синяя по глубине, суша — от зелёной низменности
 * к бурым горам и снежным вершинам) с отмывкой рельефа. Считается один раз на профиль, в браузере.
 */

type RGB = [number, number, number];

const WATER: [number, RGB][] = [
  [0, [24, 52, 84]],
  [0.6, [44, 92, 136]],
  [1, [92, 146, 184]],
];
const LAND: [number, RGB][] = [
  [0, [92, 138, 74]],
  [0.25, [132, 166, 88]],
  [0.5, [196, 186, 122]],
  [0.7, [168, 134, 92]],
  [0.86, [128, 108, 92]],
  [1, [240, 240, 236]],
];

function ramp(stops: [number, RGB][], t: number): RGB {
  const v = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i];
    if (v <= t1) {
      const [t0, c0] = stops[i - 1];
      const k = (v - t0) / (t1 - t0 || 1);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`не загрузилась ${src}`));
    img.src = src;
  });

function pixels(img: HTMLImageElement, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/** Порог по перцентилю — чтобы редкие пики не съедали всю шкалу */
function percentile(values: Uint8Array, count: number, p: number) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < count; i++) hist[values[i]]++;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= count * p) return v;
  }
  return 255;
}

const cache = new Map<string, Promise<HTMLCanvasElement>>();

export function buildAtlas(altitudeSrc: string, continentSrc: string): Promise<HTMLCanvasElement> {
  const key = `${altitudeSrc}|${continentSrc}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const [altImg, contImg] = await Promise.all([load(altitudeSrc), load(continentSrc)]);
      const w = altImg.naturalWidth;
      const h = altImg.naturalHeight;
      const alt = pixels(altImg, w, h);
      const cont = pixels(contImg, w, h);
      const n = w * h;
      const height = new Uint8Array(n);
      const land = new Uint8Array(n);
      const landVals = new Uint8Array(n);
      const seaVals = new Uint8Array(n);
      let nl = 0;
      let ns = 0;
      for (let i = 0; i < n; i++) {
        height[i] = alt[i * 4];
        land[i] = cont[i * 4] > 127 ? 1 : 0;
        if (land[i]) landVals[nl++] = height[i];
        else seaVals[ns++] = height[i];
      }
      const lLo = percentile(landVals, nl, 0.02);
      const lHi = percentile(landVals, nl, 0.995);
      const sLo = percentile(seaVals, ns, 0.02);
      const sHi = percentile(seaVals, ns, 0.98);

      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d')!;
      const img = ctx.createImageData(w, h);
      const d = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const v = height[i];
          const col = land[i] ? ramp(LAND, (v - lLo) / (lHi - lLo || 1)) : ramp(WATER, (v - sLo) / (sHi - sLo || 1));
          // Отмывка: свет с северо-запада по разнице высот соседей (на суше сильнее)
          const l = height[y * w + Math.max(0, x - 1)];
          const u = height[Math.max(0, y - 1) * w + x];
          const shade = 1 + Math.max(-0.35, Math.min(0.35, ((v - l) * 0.6 + (v - u) * 0.6) / (land[i] ? 18 : 60)));
          d[i * 4] = Math.min(255, col[0] * shade);
          d[i * 4 + 1] = Math.min(255, col[1] * shade);
          d[i * 4 + 2] = Math.min(255, col[2] * shade);
          d[i * 4 + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return out;
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
