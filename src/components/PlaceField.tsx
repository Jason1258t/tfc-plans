import { MapPin, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  geoName,
  parseCoords,
  pointFromGeo,
  searchWaypoints,
  useGeo,
  useWorldSettings,
  worldProjection,
} from '../lib/geo';
import type { TaskPlace } from '../types';

interface Props {
  value: TaskPlace | null | undefined;
  onChange: (place: TaskPlace | null) => void;
}

/** «Где»: координаты блока (x z) или город из TFC Real World — пересчитывается в блоки по проекции мира */
export function PlaceField({ value, onChange }: Props) {
  const geo = useGeo();
  const world = useWorldSettings();
  const profile = useMemo(() => (geo ? worldProjection(geo, world) : null), [geo, world]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const suggestions = geo && text.trim() && !parseCoords(text) ? searchWaypoints(geo.waypoints, text, 6) : [];

  const commit = (raw = text) => {
    if (!raw.trim()) return;
    const c = parseCoords(raw);
    if (c?.kind === 'block') onChange({ x: Math.round(c.x), z: Math.round(c.z), label: value?.label });
    else if (c?.kind === 'geo' && profile) {
      const p = pointFromGeo(profile, c.lat, c.lon);
      onChange({ x: Math.round(p.x), z: Math.round(p.z), label: value?.label });
    } else if (suggestions[0] && profile) {
      const w = suggestions[0];
      const p = pointFromGeo(profile, w.lat, w.lon);
      onChange({ x: Math.round(p.x), z: Math.round(p.z), label: value?.label || geoName(w.name) });
    } else {
      setError('Не понял: введите «x z» или название города');
      return;
    }
    setError(null);
    setText('');
  };

  return (
    <div className="tf-place">
      <span className="label">Где</span>
      {value ? (
        <div className="row tf-place-set">
          <MapPin size={14} className="faint" />
          <code>
            {value.x} {value.z}
          </code>
          <input
            className="input grow"
            placeholder="Подпись: база, шахта…"
            defaultValue={value.label ?? ''}
            maxLength={60}
            onBlur={(e) =>
              e.target.value !== (value.label ?? '') && onChange({ ...value, label: e.target.value || undefined })
            }
          />
          <Link className="btn sm" to={`/map?x=${value.x}&z=${value.z}`}>
            На карте
          </Link>
          <button className="btn ghost sm icon" aria-label="Убрать место" onClick={() => onChange(null)}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="tf-place-input">
          <input
            className="input"
            placeholder="x z, «51.5 -0.12» или город — Enter"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
          />
          {suggestions.length > 0 && (
            <ul className="tf-place-suggest" role="listbox">
              {suggestions.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (!profile) return;
                      const p = pointFromGeo(profile, w.lat, w.lon);
                      onChange({ x: Math.round(p.x), z: Math.round(p.z), label: geoName(w.name) });
                      setText('');
                    }}
                  >
                    {geoName(w.name)} {w.capital && <span className="faint small">столица</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <div className="faint small tf-place-err">{error}</div>}
        </div>
      )}
    </div>
  );
}
