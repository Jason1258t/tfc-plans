import { Copy, Check, Settings, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { WorldMap, type MapMarker } from '../components/WorldMap';
import { useData } from '../data/DataContext';
import {
  bearing,
  geoName,
  nearestWaypoints,
  parseCoords,
  placePath,
  pointFromBlock,
  pointFromGeo,
  saveWorldSettings,
  searchWaypoints,
  useGeo,
  useWorldSettings,
  worldProjection,
  type GeoData,
  type GeoProfile,
  type MapLayer,
  type Point,
  type WorldSettings,
} from '../lib/geo';
import { cx } from '../lib/util';
import './MapPage.css';

const LAYER_KEY = 'tfc-tm:map-layer';

const LAYERS: { id: MapLayer; label: string }[] = [
  { id: 'atlas', label: 'Обычная' },
  { id: 'continent', label: 'Суша' },
  { id: 'altitude', label: 'Высоты' },
  { id: 'koppen', label: 'Климат (Кёппен)' },
  { id: 'temperature', label: 'Температура' },
  { id: 'rainfall', label: 'Осадки' },
];

/** Карта мира TFC Real World: координаты ↔ города, расстояния, места задач */
export function MapPage() {
  const geo = useGeo();
  const world = useWorldSettings();
  const profile = useMemo(() => (geo ? worldProjection(geo, world) : null), [geo, world]);

  return (
    <main className="map-page">
      {geo === undefined ? (
        <div className="empty">Загружаю географию…</div>
      ) : !geo || !profile ? (
        <div className="empty">Данных TFC Real World нет — нужен jar мода в mods/ и npm run items</div>
      ) : (
        <MapView geo={geo} profile={profile} world={world} />
      )}
    </main>
  );
}

function MapView({ geo, profile, world }: { geo: GeoData; profile: GeoProfile; world: WorldSettings }) {
  const { tasks, groups } = useData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [layer, setLayerState] = useState<MapLayer>(() => {
    try {
      return (localStorage.getItem(LAYER_KEY) as MapLayer | null) ?? 'atlas';
    } catch {
      return 'atlas';
    }
  });
  const setLayer = (l: MapLayer) => {
    setLayerState(l);
    try {
      localStorage.setItem(LAYER_KEY, l);
    } catch {
      /* приватный режим — слой просто не запомнится */
    }
  };
  const [showTasks, setShowTasks] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Точки A и B живут в адресе: ссылку можно переслать
  const num = (k: string) => (params.get(k) !== null ? Number(params.get(k)) : null);
  const ax = num('x');
  const az = num('z');
  const bx = num('bx');
  const bz = num('bz');
  const a = ax !== null && az !== null ? pointFromBlock(profile, ax, az) : null;
  const b = bx !== null && bz !== null ? pointFromBlock(profile, bx, bz) : null;
  const setPoint = (which: 'a' | 'b', p: { x: number; z: number } | null) => {
    const next = new URLSearchParams(params);
    const [kx, kz] = which === 'a' ? ['x', 'z'] : ['bx', 'bz'];
    if (p) {
      next.set(kx, String(Math.round(p.x)));
      next.set(kz, String(Math.round(p.z)));
    } else {
      next.delete(kx);
      next.delete(kz);
    }
    setParams(next, { replace: true });
  };

  const waypoints = useMemo(() => {
    const allowed = new Set(profile.waypoints);
    return allowed.size ? geo.waypoints.filter((w) => allowed.has(w.id)) : geo.waypoints;
  }, [geo, profile]);
  const cityPos = useMemo(() => {
    const m = new Map<string, { x: number; z: number }>();
    for (const w of waypoints) {
      const p = pointFromGeo(profile, w.lat, w.lon);
      if (!p.outside) m.set(w.id, p);
    }
    return m;
  }, [waypoints, profile]);

  const markers: MapMarker[] = [];
  if (showTasks)
    for (const t of tasks)
      if (t.place && t.status !== 'done')
        markers.push({ id: t.id, x: t.place.x, z: t.place.z, label: t.place.label || t.title, kind: 'task' });
  if (b) markers.push({ id: 'b', x: b.x, z: b.z, label: 'B', kind: 'b' });
  if (a) markers.push({ id: 'a', x: a.x, z: a.z, label: 'A', kind: 'a' });

  const placedTasks = tasks.filter((t) => t.place && t.status !== 'done');

  return (
    <div className="map-layout">
      <aside className="map-side">
        <div className="map-title">
          <h1>Карта мира</h1>
          <button className="btn ghost sm" onClick={() => setSettingsOpen(true)} title="Профиль и масштаб мира">
            <Settings size={14} /> {geoName(profile.name)}
          </button>
        </div>
        {!world.verified && (
          <p className="map-warn small">
            Параметры мира — по умолчанию из мода, со скриншотами сервера не сверены. Если координаты не сходятся с
            игрой, проверьте профиль и масштаб в настройках.
          </p>
        )}

        <PointPanel
          title="Точка A"
          color="a"
          geo={geo}
          profile={profile}
          point={a}
          onSet={(p) => setPoint('a', p)}
          waypoints={waypoints}
        />
        <PointPanel
          title="Точка B — расстояние от A"
          color="b"
          geo={geo}
          profile={profile}
          point={b}
          onSet={(p) => setPoint('b', p)}
          waypoints={waypoints}
          compact
        />
        {a && b && <Distance a={a} b={b} />}

        <div className="map-hint faint small">
          Клик по карте — координаты точки; оттуда же её можно сделать точкой A или B. Ссылку на страницу можно
          переслать: точки в адресе.
        </div>

        {placedTasks.length > 0 && (
          <div className="map-tasks">
            <label className="row small">
              <input type="checkbox" checked={showTasks} onChange={(e) => setShowTasks(e.target.checked)} /> Места задач
              ({placedTasks.length})
            </label>
            {showTasks && (
              <ul>
                {placedTasks.map((t) => (
                  <li key={t.id}>
                    <button className="btn ghost sm" onClick={() => setPoint('a', t.place!)}>
                      {t.place!.label || t.title}
                    </button>
                    <span className="faint small">{groups.find((g) => g.id === t.groupId)?.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>

      <section className="map-main">
        <div className="seg map-layers">
          {LAYERS.filter((l) =>
            l.id === 'atlas' ? profile.maps.altitude && profile.maps.continent : profile.maps[l.id],
          ).map((l) => (
            <button key={l.id} aria-pressed={layer === l.id} onClick={() => setLayer(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        <WorldMap
          profile={profile}
          layer={layer}
          waypoints={waypoints}
          cityPos={cityPos}
          markers={markers}
          renderPopup={(pt, close) => (
            <PointPopup
              point={pointFromBlock(profile, pt.x, pt.z)}
              profile={profile}
              waypoints={waypoints}
              onClose={close}
              onSet={(which) => {
                setPoint(which, pt);
                close();
              }}
            />
          )}
          onMarker={(m) => m.kind === 'task' && navigate(`/?task=${m.id}`)}
          focus={a ? { x: a.x, z: a.z, key: `${a.x}:${a.z}` } : null}
        />
      </section>

      {settingsOpen && <WorldSettingsDialog geo={geo} world={world} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- точка: ввод и сведения

function PointPanel({
  title,
  color,
  geo,
  profile,
  point,
  onSet,
  waypoints,
  compact,
}: {
  title: string;
  color: 'a' | 'b';
  geo: GeoData;
  profile: GeoProfile;
  point: Point | null;
  onSet: (p: { x: number; z: number } | null) => void;
  waypoints: GeoData['waypoints'];
  compact?: boolean;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const parsed = parseCoords(text);
  const suggestions = text.trim() && !parsed ? searchWaypoints(waypoints, text, 7) : [];

  const submit = () => {
    if (parsed?.kind === 'block') onSet(parsed);
    else if (parsed?.kind === 'geo') onSet(pointFromGeo(profile, parsed.lat, parsed.lon));
    else if (suggestions[0]) onSet(pointFromGeo(profile, suggestions[0].lat, suggestions[0].lon));
    else return setError('Введите «x z», строку из F3, «широта долгота» или город');
    setError(null);
    setText('');
  };

  const near = point ? nearestWaypoints(waypoints, point, compact ? 1 : 4) : [];
  return (
    <div className={cx('map-point', `map-point-${color}`)}>
      <div className="row map-point-head">
        <span className={cx('map-dot', color)} />
        <b className="grow">{title}</b>
        {point && (
          <button className="btn ghost sm icon" aria-label="Сбросить точку" onClick={() => onSet(null)}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="map-input">
        <input
          className="input"
          placeholder="Город, x z, F3 или широта долгота"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {suggestions.length > 0 && (
          <ul className="map-suggest" role="listbox">
            {suggestions.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSet(pointFromGeo(profile, w.lat, w.lon));
                    setText('');
                  }}
                >
                  <span>{geoName(w.name)}</span>
                  <span className="faint small">{placePath(geo, w).slice(0, 2).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <div className="faint small">{error}</div>}
      {point && (
        <div className="map-point-info">
          <div className="map-coords">
            <code>
              x {Math.round(point.x)} · z {Math.round(point.z)}
            </code>
            <CopyButton text={`${Math.round(point.x)} ${Math.round(point.z)}`} label="x z" />
            <CopyButton text={`/tp @s ${Math.round(point.x)} ~ ${Math.round(point.z)}`} label="/tp" />
          </div>
          <div className="faint small">
            {fmtLat(point.lat)}, {fmtLon(point.lon)}
            {point.outside && ' · вне основной карты (зеркальный повтор или за краем профиля)'}
          </div>
          {!compact && near.length > 0 && (
            <ul className="map-near">
              {near.map(({ w, km }) => {
                const pos = pointFromGeo(profile, w.lat, w.lon);
                const br = bearing(point, pos);
                return (
                  <li key={w.id}>
                    <button className="btn ghost sm" onClick={() => onSet(pos)}>
                      {geoName(w.name)}
                    </button>
                    <span className="faint small">
                      {Math.round(br.blocks).toLocaleString('ru-RU')} бл. на {br.dir} · {Math.round(km)} км
                    </span>
                  </li>
                );
              })}
              <li className="faint small">{placePath(geo, near[0].w).join(' · ')}</li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Карточка точки по клику на карту */
function PointPopup({
  point,
  profile,
  waypoints,
  onClose,
  onSet,
}: {
  point: Point;
  profile: GeoProfile;
  waypoints: GeoData['waypoints'];
  onClose: () => void;
  onSet: (which: 'a' | 'b') => void;
}) {
  const near = nearestWaypoints(waypoints, point, 1)[0];
  const br = near ? bearing(point, pointFromGeo(profile, near.w.lat, near.w.lon)) : null;
  return (
    <div className="map-popup">
      <div className="row map-popup-head">
        <code className="grow">
          {point.x} {point.z}
        </code>
        <button className="btn ghost sm icon" aria-label="Закрыть" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="faint small">
        {fmtLat(point.lat)}, {fmtLon(point.lon)}
        {point.outside && ' · вне основной карты'}
      </div>
      {near && br && (
        <div className="small">
          Ближайший город — {geoName(near.w.name)}: {Math.round(br.blocks).toLocaleString('ru-RU')} бл. на {br.dir}
        </div>
      )}
      <div className="map-popup-actions">
        <CopyButton text={`${point.x} ${point.z}`} label="x z" />
        <CopyButton text={`/tp @s ${point.x} ~ ${point.z}`} label="/tp" />
        <button className="btn sm" onClick={() => onSet('a')}>
          <span className="map-dot a" /> A
        </button>
        <button className="btn sm" onClick={() => onSet('b')}>
          <span className="map-dot b" /> B
        </button>
      </div>
    </div>
  );
}

function Distance({ a, b }: { a: Point; b: Point }) {
  const br = bearing(b, a);
  const dx = Math.round(a.x - b.x);
  const dz = Math.round(a.z - b.z);
  return (
    <div className="map-distance">
      От B до A: <b>{Math.round(br.blocks).toLocaleString('ru-RU')} блоков</b> на {br.dir}
      <div className="faint small">
        Δx {dx > 0 ? '+' : ''}
        {dx}, Δz {dz > 0 ? '+' : ''}
        {dz} · пешком ≈ {Math.round(br.blocks / 4.3 / 60)} мин, на лошади ≈ {Math.round(br.blocks / 9 / 60)} мин
      </div>
    </div>
  );
}

const fmtLat = (v: number) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? 'с. ш.' : 'ю. ш.'}`;
const fmtLon = (v: number) => {
  const l = ((v + 540) % 360) - 180;
  return `${Math.abs(l).toFixed(3)}° ${l >= 0 ? 'в. д.' : 'з. д.'}`;
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn sm"
      title={`Копировать: ${text}`}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />} {label}
    </button>
  );
}

// ---------------------------------------------------------------- настройки мира

function WorldSettingsDialog({ geo, world, onClose }: { geo: GeoData; world: WorldSettings; onClose: () => void }) {
  const { nick } = useData();
  const [draft, setDraft] = useState(world);
  const [busy, setBusy] = useState(false);
  const profiles = Object.values(geo.profiles).sort((a, b) => a.index - b.index);
  const base = geo.profiles[draft.profile];
  const intOrNull = (s: string) => (s.trim() ? Math.max(1, Math.round(Number(s))) || null : null);

  return (
    <Modal
      onClose={onClose}
      title="Параметры мира"
      narrow
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await saveWorldSettings(draft, nick);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            Сохранить
          </button>
        </>
      }
    >
      <p className="faint small" style={{ margin: 0 }}>
        Берутся из серверного конфига TFC Real World (папка мира): профиль карты и масштабы. Пустое поле масштаба — как
        в профиле.
      </p>
      <label className="map-form-row">
        <span className="label">Профиль</span>
        <select
          className="input"
          value={draft.profile}
          onChange={(e) => setDraft({ ...draft, profile: e.target.value })}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {geoName(p.name)} — {p.id}
            </option>
          ))}
        </select>
      </label>
      <div className="map-form-grid">
        <label className="map-form-row">
          <span className="label">horizontal_scale</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder={String(base?.horizontalScale ?? '')}
            value={draft.horizontalScale ?? ''}
            onChange={(e) => setDraft({ ...draft, horizontalScale: intOrNull(e.target.value) })}
          />
        </label>
        <label className="map-form-row">
          <span className="label">vertical_scale</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder={String(base?.verticalScale ?? '')}
            value={draft.verticalScale ?? ''}
            onChange={(e) => setDraft({ ...draft, verticalScale: intOrNull(e.target.value) })}
          />
        </label>
      </div>
      <label className="row small">
        <input
          type="checkbox"
          checked={draft.verified}
          onChange={(e) => setDraft({ ...draft, verified: e.target.checked })}
        />
        Сверено с игрой (координаты городов совпадают)
      </label>
      {world.updatedBy && (
        <p className="faint small" style={{ margin: 0 }}>
          Последнее изменение: {world.updatedBy}
        </p>
      )}
    </Modal>
  );
}
