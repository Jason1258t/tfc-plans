/**
 * Инструменты MCP: раздел «map» — карта мира TFC Real World.
 *
 * Проекция — тот же модуль, что у сайта (src/lib/projection.ts, перенос ProjectionManager мода). Разбор координат,
 * поиск городов, ближайшие города, направление и параметры мира повторяют src/lib/geo.ts (он тянет Firebase и React):
 * parseCoords, searchWaypoints, nearestWaypoints, placePath, bearing, worldFromConfig, worldProjection, pointFromGeo.
 * Настройки мира — из импортированного конфига сервера tfc_real_world/server.toml (Firestore config), без него —
 * профиль «Весь мир» и масштаб профиля, как на сайте. Карты профиля — из jar мода (как читает игра), запасной путь —
 * public/geo/. Климат — tools/map-climate.mjs, PNG — tools/map-png.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { blockToGeo, geoToBlock, greatCircleKm, insideMap } from '../../../src/lib/projection.ts';
import { PUBLIC, mods, readJson, reference } from '../data.mjs';
import { configDocs } from '../firestore.mjs';
import { dateOf, named, norm, page, paging, str } from '../fmt.mjs';
import { jarList, readEntry, resolveJar } from '../jars.mjs';
import { KOPPEN_RU, buildClimate, climateAt, tempAtY } from './map-climate.mjs';
import { decodePng } from './map-png.mjs';

const numIn = (description) => ({ type: 'number', description });
const DEFAULT_PROFILE = 'default:full_equal_earth';
const CONFIG_PATH = 'tfc_real_world/server.toml';
const LAYER_ORDER = ['world', 'server', 'config'];

// ---------------------------------------------------------------- мир: профиль, масштаб, спавн

function geo() {
  const g = readJson('geo.json', null);
  if (!g?.profiles) throw new Error('нет public/geo.json — соберите данные модов (npm run mods)');
  return g;
}

/** Параметры мира: конфиг сервера (как worldFromConfig в geo.ts) поверх профиля из geo.json */
async function world() {
  const g = geo();
  let cfg = null;
  let warn = '';
  try {
    cfg =
      (await configDocs())
        .filter((d) => d.path === CONFIG_PATH)
        .sort((a, b) => LAYER_ORDER.indexOf(a.scope) - LAYER_ORDER.indexOf(b.scope))[0] ?? null;
  } catch (e) {
    warn = `конфиг сервера из Firestore не прочитан (${e.message})`;
  }
  const get = (k) => k.split('.').reduce((o, p) => o?.[p], cfg?.values);
  const numOr = (k) => (typeof get(k) === 'number' ? get(k) : null);
  const id = String(get('map_settings.map_profile') ?? DEFAULT_PROFILE).toLowerCase();
  const base = g.profiles[id] ?? Object.values(g.profiles).sort((a, b) => a.index - b.index)[0];
  const p = {
    ...base,
    horizontalScale: numOr('generation_modes.horizontal_scale') ?? base.horizontalScale,
    verticalScale: numOr('generation_modes.vertical_scale') ?? base.verticalScale,
  };
  const mode = get('spawn_settings.spawn_mode');
  let spawn;
  let spawnFrom;
  if (mode === 'GEOGRAPHIC' && numOr('spawn_settings.spawn_center_latitude') !== null) {
    spawn = pointFromGeo(p, get('spawn_settings.spawn_center_latitude'), get('spawn_settings.spawn_center_longitude'));
    spawnFrom = 'конфиг: spawn_mode GEOGRAPHIC';
  } else if (mode === 'CLASSIC' && numOr('tfc_spawn_settings.spawn_center_x') !== null) {
    spawn = pointFromBlock(p, get('tfc_spawn_settings.spawn_center_x'), get('tfc_spawn_settings.spawn_center_z'));
    spawnFrom = 'конфиг: spawn_mode CLASSIC';
  } else if (p.spawnLatitude !== null) {
    spawn = pointFromGeo(p, p.spawnLatitude, p.spawnLongitude);
    spawnFrom = 'центр спавна профиля';
  } else {
    spawn = pointFromBlock(p, 0, 0);
    spawnFrom = 'нет данных — взят 0, 0';
  }
  const source = cfg
    ? `конфиг сервера ${CONFIG_PATH} (${cfg.scope}, импорт ${dateOf(cfg.importedAt)}${cfg.importedBy ? `, ${cfg.importedBy}` : ''})`
    : `значения профиля по умолчанию${warn ? `; ${warn}` : ' (конфиг сервера не импортирован)'}`;
  return { g, p, cfg: cfg?.values ?? {}, spawn, spawnFrom, source };
}

const pointFromBlock = (p, x, z) => ({ x, z, ...blockToGeo(p, x, z), outside: !insideMap(p, x, z) });

function pointFromGeo(p, lat, lon) {
  const b = geoToBlock(p, lon, lat);
  const back = blockToGeo(p, b.x, b.z);
  const off = Math.abs(back.lat - lat) > 0.01 || Math.abs(((back.lon - lon + 540) % 360) - 180) > 0.01;
  return { x: b.x, z: b.z, lat, lon, outside: off || !insideMap(p, b.x, b.z) };
}

const geoName = (n, fallback = '?') => n?.ru ?? n?.en ?? fallback;

function placePath(g, w) {
  const out = [];
  let id = w.parent;
  for (let i = 0; id && i < 4; i++) {
    const pl = g.places[id];
    if (!pl) break;
    out.push(geoName(pl.name));
    id = pl.parent;
  }
  return out;
}

const DIRS = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];
function bearing(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const angle = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return { blocks: Math.hypot(dx, dz), dir: DIRS[Math.round((((angle % 360) + 360) % 360) / 45) % 8] };
}

/** Разбор строки координат — как parseCoords в geo.ts (F3, «x z», «x y z», «51.5N 0.12W», «51.5 -0.12») */
function parseCoords(text) {
  const t = text
    .trim()
    .replace(',', ' ')
    .replace(/\s*\/\s*/g, ' ');
  const ll = t.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSСЮ])\s+(-?\d+(?:\.\d+)?)\s*°?\s*([EWВЗ])$/i);
  if (ll) {
    const lat = Number(ll[1]) * (/[SЮ]/i.test(ll[2]) ? -1 : 1);
    const lon = Number(ll[3]) * (/[WЗ]/i.test(ll[4]) ? -1 : 1);
    return { kind: 'geo', lat, lon };
  }
  const nums = (t.replace(/^[a-zа-я ]*:\s*/i, '').match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nums.length === 3) return { kind: 'block', x: nums[0], y: nums[1], z: nums[2] };
  if (nums.length === 2) {
    const [a, b] = nums;
    const looksGeo = /\./.test(t) && Math.abs(a) <= 90 && Math.abs(b) <= 180;
    return looksGeo ? { kind: 'geo', lat: a, lon: b } : { kind: 'block', x: a, z: b };
  }
  return null;
}

/** Точка из аргументов: x/z, lat/lon или text */
function pointOf(p, a) {
  let y = typeof a.y === 'number' ? a.y : null;
  if (typeof a.x === 'number' && typeof a.z === 'number') return { pt: pointFromBlock(p, a.x, a.z), y };
  if (typeof a.lat === 'number' && typeof a.lon === 'number') return { pt: pointFromGeo(p, a.lat, a.lon), y };
  if (a.text) {
    const c = parseCoords(String(a.text));
    if (!c) throw new Error(`не разобрал координаты «${a.text}»: нужно «x z», «x y z», строка F3 или «51.5 -0.12»`);
    if (c.kind === 'geo') return { pt: pointFromGeo(p, c.lat, c.lon), y };
    return { pt: pointFromBlock(p, c.x, c.z), y: y ?? c.y ?? null };
  }
  throw new Error('укажите x и z (блоки), lat и lon (градусы) или text (строка координат)');
}

const fmtNum = (n, d = 0) => n.toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d });
const latStr = (lat) => `${fmtNum(Math.abs(lat), 3)}° ${lat >= 0 ? 'с.ш.' : 'ю.ш.'}`;
const lonStr = (lon) => `${fmtNum(Math.abs(lon), 3)}° ${lon >= 0 ? 'в.д.' : 'з.д.'}`;
const blockStr = (pt) => `X=${Math.round(pt.x)}, Z=${Math.round(pt.z)}`;

const worldLine = (w) =>
  `Мир: профиль ${geoName(w.p.name)} (${w.p.id}), масштаб ${w.p.horizontalScale} × ${w.p.verticalScale} блоков — ${w.source}.`;

function spawnLine(w, pt) {
  const b = bearing(w.spawn, pt);
  const km = greatCircleKm(w.spawn, pt);
  return `Спавн ${blockStr(w.spawn)} (${w.spawnFrom}): до него ${fmtNum(b.blocks)} блоков (≈${fmtNum(b.blocks / 1000, 1)} км в игре), точка от спавна на ${b.dir}; по карте Земли ≈${fmtNum(km)} км`;
}

const profileWaypoints = (w) => {
  const ids = new Set(w.p.waypoints ?? []);
  return ids.size ? w.g.waypoints.filter((x) => ids.has(x.id)) : w.g.waypoints;
};

// ---------------------------------------------------------------- карты профиля

const mapCache = new Map();
/** PNG карты профиля: из jar мода (data/<ns>/profiles/<пак>/<профиль>/maps), иначе public/geo/ */
function profileMap(p, name) {
  const key = `${p.id}|${name}`;
  if (mapCache.has(key)) return mapCache.get(key);
  const [pack, prof] = p.id.split(':');
  let buf = null;
  let from = '';
  try {
    const jars = [mods().get('tfc_real_world')?.jar, ...jarList().filter((j) => /real.?world/i.test(j))].filter(
      Boolean,
    );
    for (const jar of new Set(jars)) {
      const e = readEntry(jar, `data/tfc_real_world/profiles/${pack}/${prof}/maps/${name}.png`);
      if (e) {
        buf = e.data;
        from = jar;
        break;
      }
    }
  } catch {
    // нет папки mods/ — берём public/geo
  }
  if (!buf) {
    const rel = p.maps?.[name] ?? `geo/${pack}_${prof}/${name}.png`;
    const file = path.join(PUBLIC, rel);
    if (fs.existsSync(file)) {
      buf = fs.readFileSync(file);
      from = `public/${rel}`;
    }
  }
  const img = buf ? { ...decodePng(buf), from } : null;
  mapCache.set(key, img);
  return img;
}

/** Пиксель карты для блока — по формуле BasePNGNoise.fillTileImageCoords (с зеркалом тайлов) */
function pixelOf(p, img, x, z) {
  const rx = p.horizontalScale / 128;
  const rz = p.verticalScale / 128;
  const one = (g, r, size) => {
    const t = Math.floor((g + r) / (2 * r));
    let l = g - t * 2 * r;
    if (((t % 2) + 2) % 2) l = -l;
    l = Math.min(r, Math.max(-r, l));
    return Math.round(Math.min(size - 1, Math.max(0, size / 2 + l * (size / (2 * r)))));
  };
  return one(z / 128, rz, img.height) * img.width + one(x / 128, rx, img.width);
}

const climateCache = new Map();
function climate(p) {
  const key = `${p.id}|${p.horizontalScale}|${p.verticalScale}`;
  if (!climateCache.has(key)) {
    const maps = { koppen: profileMap(p, 'koppen'), temperature: profileMap(p, 'temperature') };
    maps.rainfall = profileMap(p, 'rainfall');
    const miss = Object.entries(maps).filter(([, v]) => !v);
    climateCache.set(
      key,
      miss.length
        ? { error: `нет карт ${miss.map(([k]) => k).join(', ')} профиля ${p.id}` }
        : { c: buildClimate(maps, p.horizontalScale, p.verticalScale), from: maps.koppen.from },
    );
  }
  return climateCache.get(key);
}

/** Суша/море по continent.png и высота по altitude.png (сырые значения, как BasePNGNoise без цветового профиля) */
function surface(p, pt) {
  const cont = profileMap(p, 'continent');
  const alt = profileMap(p, 'altitude');
  const out = {};
  if (cont) out.land = (cont.rgb[pixelOf(p, cont, pt.x, pt.z)] & 255) > 127;
  if (alt) {
    out.alt = alt.v[pixelOf(p, alt, pt.x, pt.z)];
    out.altHigh = landPercentile(p, cont, alt, 0.85);
  }
  return out;
}

const pctCache = new Map();
/** Порог высоты суши по перцентилю (для подсказки «горы — возможен uplift») */
function landPercentile(p, cont, alt, q) {
  const key = `${p.id}|${q}`;
  if (pctCache.has(key)) return pctCache.get(key);
  const vals = [];
  for (let i = 0; i < alt.v.length; i++) if (!cont || (cont.rgb[i] & 255) > 127) vals.push(alt.v[i]);
  vals.sort((a, b) => a - b);
  const v = vals[Math.floor(vals.length * q)] ?? 255;
  pctCache.set(key, v);
  return v;
}

const blockPx = (p, img) => Math.round((2 * p.horizontalScale) / img.width);

// ---------------------------------------------------------------- map_point

async function mapPoint(a) {
  const w = await world();
  const { pt, y } = pointOf(w.p, a);
  const out = [worldLine(w)];
  out.push(
    `Точка: блок ${blockStr(pt)} ↔ ${latStr(pt.lat)}, ${lonStr(pt.lon)}${pt.outside ? ' — вне основной карты профиля (зеркальный повтор мира или за краем профиля)' : ''}`,
  );
  const near = profileWaypoints(w)
    .map((x) => ({ x, km: greatCircleKm(pt, x) }))
    .sort((m, n) => m.km - n.km)
    .slice(0, 4);
  if (near.length) {
    const [first, ...rest] = near;
    const pth = placePath(w.g, first.x);
    out.push(
      `Место: ближайший город ${geoName(first.x.name)}${pth.length ? ` (${pth.join(' › ')})` : ''} — ≈${fmtNum(first.km)} км по Земле; рядом: ${rest.map((r) => `${geoName(r.x.name)} ${fmtNum(r.km)} км`).join(', ')}. Границ стран в данных мода нет — регион назван по ближайшему городу.`,
    );
  }
  const s = surface(w.p, pt);
  if (s.land !== undefined)
    out.push(
      `Карта: ${s.land ? 'суша' : 'море'} (continent.png)${s.alt !== undefined ? `, высота по altitude.png ${s.alt}/255` : ''}; клетка карты ≈${blockPx(w.p, profileMap(w.p, 'continent'))} блоков, у берегов возможна ошибка.`,
    );
  const kfm = w.cfg.generation_modes?.koppen_from_map;
  const cl = climate(w.p);
  if (kfm === false)
    out.push(
      'Климат: на сервере koppen_from_map = false — температуру и осадки считает шум TFC от сида, по картам не посчитать.',
    );
  else if (cl.error) out.push(`Климат: ${cl.error}.`);
  else {
    const k = climateAt(cl.c, pt.x, pt.z);
    const kp = cl.c.koppen(pt.x / 128, pt.z / 128);
    out.push(
      `Климат TFC (средний за год, на уровне моря y=63): ${fmtNum(k.t, 1)} °C, осадки ${fmtNum(k.r)} мм, разброс осадков ${fmtNum(k.v, 2)} (−1 — сухое лето, +1 — сухая зима); Кёппен по карте: ${kp} — ${KOPPEN_RU[kp] ?? '?'}.`,
    );
    if (y !== null)
      out.push(
        `  на высоте y=${y}: ${fmtNum(tempAtY(k.t, y), 1)} °C (TFC: −0,16225 °C на блок выше 63, не больше −17,8).`,
      );
    out.push(
      '  Счёт — код TFC Real World 4.1.4 (koppen_from_map) и TFC 4.2.9, повторён по байткоду; сезонные колебания и погода не учтены; в игре не проверялось.',
    );
  }
  out.push(`${spawnLine(w, pt)}.`);
  return out.join('\n');
}

// ---------------------------------------------------------------- map_rocks

let presetCache = null;
/** rock_layer_settings пресета TFC (data/tfc/worldgen/world_preset/overworld.json) и сырьё пород (rock_settings) */
function rockPreset() {
  if (presetCache) return presetCache;
  const jar = mods().get('tfc')?.jar ?? resolveJar('TerraFirmaCraft');
  const e = readEntry(jar, 'data/tfc/worldgen/world_preset/overworld.json');
  if (!e) throw new Error(`в ${jar} нет data/tfc/worldgen/world_preset/overworld.json`);
  const preset = JSON.parse(e.data.toString('utf8'));
  const s = preset.dimensions?.['minecraft:overworld']?.generator?.tfc_settings?.rock_layer_settings;
  if (!s) throw new Error('в пресете TFC нет rock_layer_settings');
  const raw = {};
  for (const [name, id] of Object.entries(s.rocks)) {
    const [ns, p] = id.split(':');
    const r = readEntry(jar, `data/${ns}/tfc/worldgen/rock_settings/${p}.json`);
    raw[name] = r ? JSON.parse(r.data.toString('utf8')).raw : `${ns}:rock/raw/${p}`;
  }
  presetCache = { s, raw, jar };
  return presetCache;
}

/**
 * Доли пород по глубине для типа области (RockLayerSettings.sampleAtLayer: равновероятный выбор из списка
 * слоёв типа, каждый слой — его породы; ниже — равновероятно из «next» этой породы; «bottom» — список bottom).
 */
function rockDepths(s, type, depth = 6) {
  const layerRocks = (id) => {
    if (id === 'bottom') return s.bottom.map((r) => [r, 'bottom']);
    const l = s.layers.find((x) => x.id === id);
    return l ? Object.entries(l.layers) : [];
  };
  let cur = new Map();
  const start = s[type === 'ocean' ? 'ocean_floor' : type].flatMap(layerRocks);
  for (const [rock, next] of start) {
    const k = `${rock}|${next}`;
    cur.set(k, (cur.get(k) ?? 0) + 1 / start.length);
  }
  const levels = [];
  for (let d = 0; d < depth; d++) {
    const byRock = new Map();
    for (const [k, pr] of cur) byRock.set(k.split('|')[0], (byRock.get(k.split('|')[0]) ?? 0) + pr);
    levels.push(byRock);
    const next = new Map();
    for (const [k, pr] of cur) {
      const opts = layerRocks(k.split('|')[1]);
      for (const [rock, nx] of opts) {
        const kk = `${rock}|${nx}`;
        next.set(kk, (next.get(kk) ?? 0) + pr / opts.length);
      }
    }
    cur = next;
    if ([...cur.keys()].every((k) => k.endsWith('|bottom')) && levels.length > 1 && d >= 3) break;
  }
  return levels;
}

const rockName = (raw) => {
  const n = named(raw);
  return n === raw ? raw.split('/').pop() : n.replace(/^[^«]*«(.*)»$/, '$1');
};

/** Горячая точка по hotspots.png (яркость цвета палитры, как getRGB в BasePNGNoise) в пределах 2 клеток сетки — окрестность ChooseRocks.findClosestType */
function hotspotNear(p, pt) {
  const img = profileMap(p, 'hotspots');
  if (!img) return null;
  let best = 0;
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++)
      if (Math.abs(dx) + Math.abs(dz) <= 2)
        best = Math.max(best, img.rgb[pixelOf(p, img, pt.x + dx * 128, pt.z + dz * 128)] & 255);
  return best;
}

async function mapRocks(a) {
  const w = await world();
  const { pt } = pointOf(w.p, a);
  const { s, raw, jar } = rockPreset();
  const out = [worldLine(w), `Точка: блок ${blockStr(pt)} ↔ ${latStr(pt.lat)}, ${lonStr(pt.lon)}`];
  const surf = surface(w.p, pt);
  const hot = hotspotNear(w.p, pt);
  const types = [];
  if (surf.land === false) types.push(['ocean', 'море (continent.png) → ocean_floor']);
  else types.push(['land', `${surf.land ? 'суша (continent.png)' : 'суша/море неизвестно'} → land`]);
  // ChooseRocks: горячая точка рядом делает область вулканической и в море, и на суше
  if (hot !== null && hot >= 32)
    types.push(['volcanic', `рядом горячая точка (hotspots.png ${hot}/255 ≥ 32) → volcanic возможен`]);
  if (surf.land !== false) {
    if (surf.alt !== undefined && surf.alt >= surf.altHigh)
      types.push([
        'uplift',
        `высоко (altitude.png ${surf.alt}/255 ≥ 85-й перцентиль суши ${surf.altHigh}) → uplift, если это горы`,
      ]);
  }
  out.push(
    `Тип области по картам: ${types.map((t) => t[1]).join('; ')}${hot !== null && hot < 32 ? `; горячих точек рядом нет (hotspots.png ${hot}/255)` : ''}.`,
    'Точную породу выбирает шум от сида мира (TFC ChooseRocks: rockArea + тип области; uplift — горы из тектоники, volcanic — ещё и вулканические биомы), по картам её не определить: ниже — варианты с долями при равновероятном выборе.',
    `Слои — пресет TFC (${jar}: data/tfc/worldgen/world_preset/overworld.json); если мир создавали с другими слоями, ответ неточен. Тип области — оценка по картам, в игре не проверялось.`,
  );
  const all = new Map();
  for (const [type] of types) {
    const levels = rockDepths(s, type);
    out.push(`${type}:`);
    levels.forEach((m, i) => {
      const list = [...m].sort((x, y) => y[1] - x[1]);
      for (const [r] of list) all.set(raw[r], [...new Set([...(all.get(raw[r]) ?? []), type])]);
      out.push(
        `  ${i === 0 ? 'верхний слой' : i === levels.length - 1 ? `слой ${i + 1} и глубже` : `слой ${i + 1}`}: ${list.map(([r, pr]) => `${rockName(raw[r])} ${fmtNum(pr * 100)}%`).join(', ')}`,
      );
    });
  }
  const veins = reference()
    .veins.filter((v) => v.kind !== 'rock' && v.rocks?.some((r) => all.has(r)))
    .sort((x, y) => x.id.localeCompare(y.id));
  const minerals = (v) =>
    [...new Set(v.minerals.flatMap((m) => m.items.map((i) => rockName(i.item))))].slice(0, 4).join(', ');
  out.push(
    `Жилы в этих породах (reference_get section=ores id=… — подробно; породы — сырой камень, не галька/гравий):`,
    page(veins, a, (v) => {
      const rocks = v.rocks.filter((r) => all.has(r)).map(rockName);
      return [
        `• ${v.id} — ${minerals(v)}; y ${v.minY}…${v.maxY}; редкость ${v.rarity}; в: ${rocks.length > 6 ? `${rocks.slice(0, 6).join(', ')} и ещё ${rocks.length - 6}` : rocks.join(', ')}`,
      ];
    }),
  );
  return out.join('\n');
}

// ---------------------------------------------------------------- map_find

function mapFind(w, a) {
  const q = norm(String(a.query ?? '')).trim();
  if (q.length < 2) throw new Error('query — хотя бы 2 буквы названия города, страны или региона');
  const score = (n) => {
    const ru = norm(n?.ru ?? '');
    const en = norm(n?.en ?? '');
    return ru === q || en === q
      ? 0
      : ru.startsWith(q) || en.startsWith(q)
        ? 1
        : ru.includes(q) || en.includes(q)
          ? 2
          : -1;
  };
  // Регионы — по совпадению с начала названия; по подстроке — только если иначе пусто («рим» ≠ «Приморье»)
  const scored = Object.entries(w.g.places)
    .map(([id, pl]) => ({ id, pl, s: score(pl.name) }))
    .filter((x) => x.s >= 0)
    .sort((x, y) => x.s - y.s);
  const strong = scored.some((x) => x.s <= 1) || w.g.waypoints.some((wp) => score(wp.name) >= 0 && score(wp.name) <= 1);
  const places = strong ? scored.filter((x) => x.s <= 1) : scored;
  const under = (wp, id) => {
    let cur = wp.parent;
    for (let i = 0; cur && i < 4; i++) {
      if (cur === id) return true;
      cur = w.g.places[cur]?.parent;
    }
    return false;
  };
  const found = new Map();
  for (const wp of w.g.waypoints) {
    const s = score(wp.name);
    if (s >= 0) found.set(wp.id, { wp, s: s + (wp.capital ? 0 : 0.5) });
  }
  for (const { id, s } of places)
    for (const wp of w.g.waypoints)
      if (!found.has(wp.id) && under(wp, id)) found.set(wp.id, { wp, s: 3 + s + (wp.capital ? 0 : 0.5) });
  const list = [...found.values()].sort(
    (x, y) => x.s - y.s || geoName(x.wp.name).localeCompare(geoName(y.wp.name), 'ru'),
  );
  const inProfile = new Set(w.p.waypoints ?? []);
  const head = [worldLine(w)];
  if (places.length)
    head.push(
      `Регионы по запросу: ${places
        .slice(0, 8)
        .map(
          (x) =>
            `${geoName(x.pl.name)} (${{ continent: 'континент', region: 'регион', subregion: 'страна/подрегион' }[x.pl.kind] ?? x.pl.kind})`,
        )
        .join(', ')} — их города ниже, после прямых совпадений. Границ у регионов в данных нет, только города.`,
    );
  head.push(
    page(list, a, ({ wp }) => {
      const pt = pointFromGeo(w.p, wp.lat, wp.lon);
      const b = bearing(w.spawn, pt);
      const pth = placePath(w.g, wp);
      return [
        `• ${geoName(wp.name)}${wp.name.en && wp.name.en !== wp.name.ru ? ` / ${wp.name.en}` : ''}${wp.capital ? ', столица' : ''}${pth.length ? ` (${pth.join(' › ')})` : ''} — ${latStr(wp.lat)}, ${lonStr(wp.lon)} → блок ${blockStr(pt)}${pt.outside ? ' (вне карты профиля)' : ''}${inProfile.size && !inProfile.has(wp.id) ? ' (не отмечен в профиле)' : ''}; от спавна ${fmtNum(b.blocks)} бл. на ${b.dir}`,
      ];
    }),
  );
  return head.join('\n');
}

// ---------------------------------------------------------------- регионы мира

/** Папка измерения в сохранении: overworld — корень, ад — DIM-1, энд — DIM1, остальные — dimensions/<ns>/<путь> */
function dimFolder(dim) {
  const d = String(dim ?? 'overworld')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '');
  if (['overworld', 'верхний', 'мир', ''].includes(d)) return { id: 'minecraft:overworld', dir: [] };
  if (['the_nether', 'nether', 'ад', 'незер'].includes(d)) return { id: 'minecraft:the_nether', dir: ['DIM-1'] };
  if (['the_end', 'end', 'энд', 'край'].includes(d)) return { id: 'minecraft:the_end', dir: ['DIM1'] };
  const [ns, ...rest] = d.includes(':') ? d.split(':') : ['minecraft', d];
  return { id: `${ns}:${rest.join(':')}`, dir: ['dimensions', ns, ...rest.join(':').split('/')] };
}

const KINDS = ['region', 'entities', 'poi'];
const psq = (s) => `'${String(s).replaceAll("'", "''")}'`;

function mapRegions(a) {
  let x1;
  let z1;
  let x2;
  let z2;
  const nums = a.text ? (String(a.text).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number) : [];
  if (typeof a.x1 === 'number' && typeof a.z1 === 'number') {
    [x1, z1] = [a.x1, a.z1];
    [x2, z2] = [a.x2 ?? a.x1, a.z2 ?? a.z1];
  } else if (nums.length === 4) [x1, z1, x2, z2] = nums;
  else if (typeof a.x === 'number' && typeof a.z === 'number') {
    const r = Math.abs(Number(a.radius ?? 0));
    [x1, z1, x2, z2] = [a.x - r, a.z - r, a.x + r, a.z + r];
  } else if (nums.length === 2 || nums.length === 3) {
    const [x, z] = nums.length === 3 ? [nums[0], nums[2]] : nums;
    const r = Math.abs(Number(a.radius ?? 0));
    [x1, z1, x2, z2] = [x - r, z - r, x + r, z + r];
  } else
    throw new Error('укажите x1, z1, x2, z2 (углы прямоугольника, блоки), или x, z и radius, или text «x1 z1 x2 z2»');
  const [bx1, bx2] = [Math.floor(Math.min(x1, x2)), Math.floor(Math.max(x1, x2))];
  const [bz1, bz2] = [Math.floor(Math.min(z1, z2)), Math.floor(Math.max(z1, z2))];
  const rx = [Math.floor(bx1 / 512), Math.floor(bx2 / 512)];
  const rz = [Math.floor(bz1 / 512), Math.floor(bz2 / 512)];
  const count = (rx[1] - rx[0] + 1) * (rz[1] - rz[0] + 1);
  if (count > 400) throw new Error(`прямоугольник задевает ${count} регионов — слишком много, сузьте`);
  const dim = dimFolder(a.dim);
  const kinds = a.kinds
    ? String(a.kinds)
        .split(/[\s,]+/)
        .filter((k) => KINDS.includes(k))
    : KINDS;
  const regions = [];
  for (let x = rx[0]; x <= rx[1]; x++) for (let z = rz[0]; z <= rz[1]; z++) regions.push({ x, z });
  const files = [];
  for (const k of kinds) for (const r of regions) files.push([...dim.dir, k, `r.${r.x}.${r.z}.mca`]);
  const out = [
    `Блоки X ${bx1}…${bx2}, Z ${bz1}…${bz2} (${dim.id}) → чанки X ${Math.floor(bx1 / 16)}…${Math.floor(bx2 / 16)}, Z ${Math.floor(bz1 / 16)}…${Math.floor(bz2 / 16)} → регионов ${regions.length} (регион — 512×512 блоков, 32×32 чанка).`,
  ];
  if (dim.id === 'minecraft:the_nether') out.push('Координаты — адские (в верхнем мире X и Z в 8 раз больше).');
  out.push('Регионы и их блоки:');
  for (const r of regions.slice(0, 60))
    out.push(`  r.${r.x}.${r.z}.mca — X ${r.x * 512}…${r.x * 512 + 511}, Z ${r.z * 512}…${r.z * 512 + 511}`);
  if (regions.length > 60) out.push(`  … ещё ${regions.length - 60}`);
  out.push(
    `Файлы (${kinds.join(', ')}; region — блоки, entities — существа, poi — порталы, кровати, рабочие места жителей): ${files.length}.`,
  );
  const world = a.world ? String(a.world) : 'C:\\путь\\к\\saves\\Мир';
  const list = files.map((f) => psq(f.join('\\'))).join(', ');
  out.push(
    '',
    `PowerShell (ПК игрока или хоста; игра/сервер выключены, иначе файл занят или перезапишется)${a.world ? '' : ' — подставьте путь к миру в $w'}:`,
    '```powershell',
    `$w = ${psq(world)}`,
    `$f = @(${list})`,
    '# посмотреть: какие есть, размер, время изменения',
    "$f | ForEach-Object { Get-Item -LiteralPath (Join-Path $w $_) -ErrorAction SilentlyContinue } | Format-Table @{n='Файл';e={$_.FullName.Substring($w.Length+1)}}, Length, LastWriteTime",
    '# копия рядом с миром (сначала всегда копия)',
    "$b = Join-Path (Split-Path $w) ((Split-Path $w -Leaf) + '-regions-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))",
    '$f | ForEach-Object { $s = Join-Path $w $_; if (Test-Path -LiteralPath $s) { $d = Join-Path $b $_; New-Item -ItemType Directory -Force -Path (Split-Path $d) | Out-Null; Copy-Item -LiteralPath $s -Destination $d } }; "копия: $b"',
    '# удалить (мир пересоздаст эти места заново — постройки и вещи там пропадут)',
    '# $f | ForEach-Object { Remove-Item -LiteralPath (Join-Path $w $_) -ErrorAction SilentlyContinue }',
    '```',
    'Linux (сервер сборки), из папки мира:',
    '```bash',
    `ls -la ${files.map((f) => f.join('/')).join(' ')} 2>/dev/null`,
    '```',
  );
  return out.join('\n');
}

const pointProps = {
  x: numIn('block X'),
  z: numIn('block Z'),
  lat: numIn('latitude, degrees (north +)'),
  lon: numIn('longitude, degrees (east +)'),
  text: str('coordinates as a string: «x z», «x y z», F3 line (XYZ: …), «51.5 -0.12» or «51.5N 0.12W»'),
};

export const TOOLS = [
  {
    name: 'map_point',
    description:
      'TFC Real World world point: block X/Z ↔ latitude/longitude (same projection as the site), nearest cities and region (by geo.json cities), land/sea, average TFC climate (temperature, rainfall, variation, Köppen class — mod code koppen_from_map, from bytecode), altitude correction for y, distance and direction from spawn. Scale, profile and spawn — from the server config.',
    inputSchema: {
      type: 'object',
      properties: { ...pointProps, y: numIn('block height — temperature at this altitude') },
    },
    handler: mapPoint,
  },
  {
    name: 'map_rocks',
    description:
      'Which rocks and ore veins are possible at a point: area type from mod maps (sea/land, hotspots, elevation) → TFC preset rock layers by depth with shares → veins (reference ores) in those rocks. The world seed picks the exact rock — the tool gives options, not an answer.',
    inputSchema: { type: 'object', properties: { ...pointProps, ...paging } },
    handler: mapRocks,
  },
  {
    name: 'map_find',
    description:
      "Find a place: city, country, region or continent (Russian/English name from the mod's geo.json) → latitude/longitude and block X/Z in our world, region path, distance and direction from spawn. For a country/region — its cities.",
    inputSchema: {
      type: 'object',
      properties: { query: str('city, country or region name'), ...paging },
      required: ['query'],
    },
    handler: async (a) => mapFind(await world(), a),
  },
  {
    name: 'map_regions',
    description:
      'Block rectangle → save region files r.X.Z.mca (region — blocks, entities — entities, poi — portals/beds) with the dimension folder (DIM-1, DIM1, dimensions/…) and ready PowerShell commands: list, copy, delete (delete commented out). For resetting an area or moving a piece of the world.',
    inputSchema: {
      type: 'object',
      properties: {
        x1: numIn('corner 1: block X'),
        z1: numIn('corner 1: block Z'),
        x2: numIn('corner 2: block X'),
        z2: numIn('corner 2: block Z'),
        x: numIn('or centre: X'),
        z: numIn('or centre: Z'),
        radius: numIn('with x/z: half the square side, in blocks'),
        text: str('or as a string: «x1 z1 x2 z2», «x z» (+ radius), F3 line'),
        dim: str(
          'dimension: overworld (default), the_nether (nether — nether coordinates), the_end, rocketnautics:moon…',
        ),
        kinds: str('which folders: region,entities,poi (default all)'),
        world: str('path to the world folder on the PC — substituted into the commands'),
      },
    },
    handler: mapRegions,
  },
];
