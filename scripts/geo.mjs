/**
 * География TFC Real World (public/geo.json + public/geo/<профиль>/*.png): профили карты, города с координатами,
 * иерархия континент → регион → подрегион. Источник — data/<ns>/geography и data/<ns>/profiles из jar мода.
 */
import fs from 'node:fs';
import path from 'node:path';

const MAPS = ['continent', 'altitude', 'koppen', 'temperature', 'rainfall'];
const names = (lang) => ({ ru: lang?.ru_ru ?? lang?.en_us ?? null, en: lang?.en_us ?? null });

export function writeGeo(dataDirs, parse, publicDir) {
  const profiles = {};
  const places = {}; // continent/region/subregion
  const waypoints = {};
  let maps = 0;
  const outDir = path.join(publicDir, 'geo');
  fs.rmSync(outDir, { recursive: true, force: true });

  for (const { dir } of dataDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ns of fs.readdirSync(dir)) {
      // Профили: data/<ns>/profiles/<pack>/<profile>/settings.json → id «<pack>:<profile>»
      const profRoot = path.join(dir, ns, 'profiles');
      if (fs.existsSync(profRoot))
        for (const pack of fs.readdirSync(profRoot)) {
          for (const prof of fs.readdirSync(path.join(profRoot, pack))) {
            const base = path.join(profRoot, pack, prof);
            const settingsFile = path.join(base, 'settings.json');
            if (!fs.existsSync(settingsFile)) continue;
            const s = parse(fs.readFileSync(settingsFile, 'utf8'));
            if (!s) continue;
            const id = `${pack}:${prof}`;
            const mapFiles = {};
            for (const m of MAPS) {
              const src = path.join(base, 'maps', `${m}.png`);
              if (!fs.existsSync(src)) continue;
              const rel = `geo/${pack}_${prof}/${m}.png`;
              fs.mkdirSync(path.dirname(path.join(publicDir, rel)), { recursive: true });
              fs.copyFileSync(src, path.join(publicDir, rel));
              mapFiles[m] = rel;
              maps++;
            }
            profiles[id] = {
              id,
              index: s.index ?? 0,
              name: names(s.lang),
              projection: s.map_projection ?? 'EQUAL_EARTH',
              horizontalScale: s.horizontal_scale,
              verticalScale: s.vertical_scale,
              westEdgeLongitude: s.west_edge_longitude,
              eastEdgeLongitude: s.east_edge_longitude,
              southEdgeLatitude: s.south_edge_latitude,
              northEdgeLatitude: s.north_edge_latitude,
              spawnLongitude: s.spawn_center_longitude ?? null,
              spawnLatitude: s.spawn_center_latitude ?? null,
              waypoints: Array.isArray(s.waypoints) ? s.waypoints : [],
              maps: mapFiles,
            };
          }
        }

      // География: data/<ns>/geography/<pack>/{continents,regions,subregions,waypoints}/<name>.json
      const geoRoot = path.join(dir, ns, 'geography');
      if (!fs.existsSync(geoRoot)) continue;
      for (const pack of fs.readdirSync(geoRoot)) {
        for (const [kindDir, kind] of [
          ['continents', 'continent'],
          ['regions', 'region'],
          ['subregions', 'subregion'],
          ['waypoints', 'waypoint'],
        ]) {
          const d = path.join(geoRoot, pack, kindDir);
          if (!fs.existsSync(d)) continue;
          for (const f of fs.readdirSync(d)) {
            if (!f.endsWith('.json')) continue;
            const j = parse(fs.readFileSync(path.join(d, f), 'utf8'));
            if (!j) continue;
            const name = f.slice(0, -5);
            if (kind === 'waypoint') {
              if (typeof j.latitude !== 'number' || typeof j.longitude !== 'number') continue;
              waypoints[`${pack}:${name}`] = {
                id: `${pack}:${name}`,
                name: names(j.title_lang),
                lat: j.latitude,
                lon: j.longitude,
                capital: Boolean(j.capital),
                parent: j.parent ?? null,
              };
            } else {
              places[`${pack}:${kind}/${name}`] = { name: names(j.title_lang), parent: j.parent ?? null, kind };
            }
          }
        }
      }
    }
  }
  if (!Object.keys(profiles).length && !Object.keys(waypoints).length) return null;
  const out = { profiles, places, waypoints: Object.values(waypoints) };
  fs.writeFileSync(path.join(publicDir, 'geo.json'), JSON.stringify(out));
  return { profiles: Object.keys(profiles).length, waypoints: out.waypoints.length, maps };
}
