import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { authReady, db } from '../firebase';
import { configValue, useModConfig, type ModConfig } from './config';
import { blockToGeo, geoToBlock, greatCircleKm, insideMap, type WorldProjection } from './projection';

/** География TFC Real World из сборки (public/geo.json, scripts/geo.mjs) */
export interface GeoName {
  ru: string | null;
  en: string | null;
}

export interface GeoProfile extends WorldProjection {
  id: string;
  index: number;
  name: GeoName;
  spawnLongitude: number | null;
  spawnLatitude: number | null;
  /** id городов, которые показывает профиль */
  waypoints: string[];
  /** слой → путь к PNG (карта во весь мир: x ∈ [−h, h), z ∈ [−v, v)) */
  maps: Partial<Record<Exclude<MapLayer, 'atlas'>, string>>;
}

/** atlas — «обычная» карта, собирается из altitude + continent (src/lib/atlas.ts) */
export type MapLayer = 'atlas' | 'continent' | 'altitude' | 'koppen' | 'temperature' | 'rainfall';

export interface Waypoint {
  id: string;
  name: GeoName;
  lat: number;
  lon: number;
  capital: boolean;
  /** «default:subregion/great_britain» */
  parent: string | null;
}

export interface GeoData {
  profiles: Record<string, GeoProfile>;
  places: Record<string, { name: GeoName; parent: string | null; kind: string }>;
  waypoints: Waypoint[];
}

let promise: Promise<GeoData | null> | null = null;
let loaded: GeoData | null = null;
export function useGeo(): GeoData | null | undefined {
  const [g, setG] = useState<GeoData | null | undefined>(loaded ?? undefined);
  useEffect(() => {
    if (g !== undefined) return;
    promise ??= fetch(`${import.meta.env.BASE_URL}geo.json`)
      .then((r) => (r.ok ? (r.json() as Promise<GeoData>) : null))
      .catch(() => null)
      .then((d) => (loaded = d));
    promise.then(setG);
  }, [g]);
  return g;
}

export const geoName = (n: GeoName | undefined, fallback = '?') => n?.ru ?? n?.en ?? fallback;

// ---------------------------------------------------------------- настройки мира (Firestore settings/world)

/**
 * Параметры нашего мира. По умолчанию — профиль «Весь мир» как в моде; если на сервере в конфиге TFC Real World
 * другие профиль/масштабы — их правят на странице карты, без деплоя.
 */
export interface WorldSettings {
  profile: string;
  /** Переопределения масштаба (null — как в профиле) */
  horizontalScale: number | null;
  verticalScale: number | null;
  /** Сверено с конфигом сервера */
  verified: boolean;
  /** Параметры взяты из импортированного конфига сервера (config/server__tfc_real_world__server.toml) */
  fromConfig?: Pick<ModConfig, 'importedAt' | 'importedBy' | 'source'>;
  /** Центр спавна из конфига: GEOGRAPHIC — широта/долгота, CLASSIC — блоки */
  spawn?: { lat: number; lon: number } | { x: number; z: number };
  note?: string;
  updatedBy?: string;
  updatedAt?: number;
}

export const DEFAULT_WORLD: WorldSettings = {
  profile: 'default:full_equal_earth',
  horizontalScale: null,
  verticalScale: null,
  verified: false,
};

/** Параметры мира из серверного конфига TFC Real World */
function worldFromConfig(c: ModConfig): WorldSettings {
  const mode = configValue(c, 'spawn_settings.spawn_mode', 'string');
  const lat = configValue(c, 'spawn_settings.spawn_center_latitude', 'number');
  const lon = configValue(c, 'spawn_settings.spawn_center_longitude', 'number');
  const x = configValue(c, 'tfc_spawn_settings.spawn_center_x', 'number');
  const z = configValue(c, 'tfc_spawn_settings.spawn_center_z', 'number');
  return {
    // В конфиге — DEFAULT:FULL_EQUAL_EARTH, в geo.json id в нижнем регистре
    profile: configValue(c, 'map_settings.map_profile', 'string')?.toLowerCase() ?? DEFAULT_WORLD.profile,
    horizontalScale: configValue(c, 'generation_modes.horizontal_scale', 'number') ?? null,
    verticalScale: configValue(c, 'generation_modes.vertical_scale', 'number') ?? null,
    verified: true,
    fromConfig: { importedAt: c.importedAt, importedBy: c.importedBy, source: c.source },
    spawn:
      mode === 'GEOGRAPHIC' && lat !== undefined && lon !== undefined
        ? { lat, lon }
        : mode === 'CLASSIC' && x !== undefined && z !== undefined
          ? { x, z }
          : undefined,
  };
}

/** Импортированный конфиг сервера главнее ручных настроек (settings/world — запасной вариант) */
export function useWorldSettings(): WorldSettings {
  const manual = useManualWorldSettings();
  const config = useModConfig('tfc_real_world/server.toml');
  return useMemo(() => (config ? worldFromConfig(config) : manual), [config, manual]);
}

function useManualWorldSettings(): WorldSettings {
  const [s, setS] = useState<WorldSettings>(DEFAULT_WORLD);
  useEffect(() => {
    if (!db) return;
    let unsub = () => {};
    let cancelled = false;
    authReady.then(() => {
      if (cancelled) return;
      unsub = onSnapshot(
        doc(db!, 'settings', 'world'),
        (snap) =>
          setS(snap.exists() ? { ...DEFAULT_WORLD, ...(snap.data() as Partial<WorldSettings>) } : DEFAULT_WORLD),
        () => {},
      );
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);
  return s;
}

export async function saveWorldSettings(s: WorldSettings, nick: string) {
  await authReady;
  await setDoc(doc(db!, 'settings', 'world'), { ...s, updatedBy: nick, updatedAt: Date.now() });
}

/** Профиль с учётом переопределений масштаба */
export function worldProjection(geo: GeoData, s: WorldSettings): GeoProfile | null {
  const p = geo.profiles[s.profile] ?? Object.values(geo.profiles).sort((a, b) => a.index - b.index)[0];
  if (!p) return null;
  return {
    ...p,
    horizontalScale: s.horizontalScale ?? p.horizontalScale,
    verticalScale: s.verticalScale ?? p.verticalScale,
  };
}

// ---------------------------------------------------------------- точки и поиск

export interface Point {
  x: number;
  z: number;
  lat: number;
  lon: number;
  /** Вне основной карты (в зеркальном повторе или за краем профиля) */
  outside: boolean;
}

export const pointFromBlock = (p: GeoProfile, x: number, z: number): Point => ({
  x,
  z,
  ...blockToGeo(p, x, z),
  outside: !insideMap(p, x, z),
});

export function pointFromGeo(p: GeoProfile, lat: number, lon: number): Point {
  const b = geoToBlock(p, lon, lat);
  // Точка за пределами профиля («Старый Свет» без Америки) проецируется, но обратно не сходится
  const back = blockToGeo(p, b.x, b.z);
  const off = Math.abs(back.lat - lat) > 0.01 || Math.abs(((back.lon - lon + 540) % 360) - 180) > 0.01;
  return { x: b.x, z: b.z, lat, lon, outside: off || !insideMap(p, b.x, b.z) };
}

/**
 * Разбор ввода: «x z», «x y z», строка из F3 («XYZ: 12.5 / 64 / -340.2» или «Block: 12 64 -341»),
 * «51.5 -0.12» / «51.5N 0.12W» — широта и долгота (дробные с точкой).
 */
export function parseCoords(
  text: string,
): { kind: 'block'; x: number; z: number } | { kind: 'geo'; lat: number; lon: number } | null {
  const t = text
    .trim()
    .replace(',', ' ')
    .replace(/\s*\/\s*/g, ' ');
  // Широта/долгота с буквами сторон света
  const ll = t.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSСЮ])\s+(-?\d+(?:\.\d+)?)\s*°?\s*([EWВЗ])$/i);
  if (ll) {
    const lat = Number(ll[1]) * (/[SЮ]/i.test(ll[2]) ? -1 : 1);
    const lon = Number(ll[3]) * (/[WЗ]/i.test(ll[4]) ? -1 : 1);
    return { kind: 'geo', lat, lon };
  }
  const nums = (t.replace(/^[a-zа-я ]*:\s*/i, '').match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nums.length === 3) return { kind: 'block', x: nums[0], z: nums[2] };
  if (nums.length === 2) {
    // Два дробных числа в пределах широты/долготы — география, иначе блоки
    const [a, b] = nums;
    const looksGeo = /\./.test(t) && Math.abs(a) <= 90 && Math.abs(b) <= 180;
    return looksGeo ? { kind: 'geo', lat: a, lon: b } : { kind: 'block', x: a, z: b };
  }
  return null;
}

const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е').trim();

export function searchWaypoints(list: Waypoint[], query: string, limit = 8): Waypoint[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const scored: [number, Waypoint][] = [];
  for (const w of list) {
    const ru = norm(w.name.ru ?? '');
    const en = norm(w.name.en ?? '');
    const score = ru.startsWith(q) || en.startsWith(q) ? 0 : ru.includes(q) || en.includes(q) ? 1 : -1;
    if (score >= 0) scored.push([score + (w.capital ? 0 : 0.5), w]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || geoName(a[1].name).localeCompare(geoName(b[1].name), 'ru'))
    .slice(0, limit)
    .map((s) => s[1]);
}

/** Ближайшие города по большому кругу */
export function nearestWaypoints(list: Waypoint[], at: { lat: number; lon: number }, n = 5) {
  return list
    .map((w) => ({ w, km: greatCircleKm(at, w) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

/** Цепочка «подрегион, регион, континент» для города */
export function placePath(geo: GeoData, w: Waypoint): string[] {
  const out: string[] = [];
  let id = w.parent;
  for (let i = 0; id && i < 4; i++) {
    const p = geo.places[id];
    if (!p) break;
    out.push(geoName(p.name));
    id = p.parent;
  }
  return out;
}

const DIRS = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];
/** Расстояние и направление в блоках (север — −z, как в игре) */
export function bearing(from: { x: number; z: number }, to: { x: number; z: number }) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const angle = (Math.atan2(dx, -dz) * 180) / Math.PI; // 0 — север, по часовой
  const dir = DIRS[Math.round((((angle % 360) + 360) % 360) / 45) % 8];
  return { blocks: Math.hypot(dx, dz), dir };
}
