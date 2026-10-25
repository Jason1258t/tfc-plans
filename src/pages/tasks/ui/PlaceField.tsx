import { ExternalLink, MapPin, X } from 'lucide-react';
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
} from '@/lib/geo';
import { cx } from '@/shared/lib';
import { Button, Input } from '@/shared/ui';
import type { TaskPlace } from '@/entities/task';
import styles from './TaskDialog.module.css';

interface Props {
  value: TaskPlace | null | undefined;
  onChange: (place: TaskPlace | null) => void;
  /** В одну строку с важностью и статусом: без подписи «Где», значок внутри поля */
  compact?: boolean;
}

/** «Где»: координаты блока (x z) или город из TFC Real World — пересчитывается в блоки по проекции мира */
export function PlaceField({ value, onChange, compact }: Props) {
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
    <div className={cx(styles.tfPlace, compact && styles.compact)}>
      {!compact && <span className="label">Где</span>}
      {value ? (
        <div className={cx('row', styles.tfPlaceSet)}>
          <MapPin size={14} className="faint" />
          <code>
            {value.x} {value.z}
          </code>
          <Input
            className="grow"
            aria-label="Подпись места"
            placeholder="Подпись: база, шахта…"
            defaultValue={value.label ?? ''}
            maxLength={60}
            onBlur={(e) =>
              e.target.value !== (value.label ?? '') && onChange({ ...value, label: e.target.value || undefined })
            }
          />
          <Link
            className={cx('btn sm', compact && 'icon')}
            to={`/reference?tab=map&x=${value.x}&z=${value.z}`}
            aria-label="На карте"
            title="На карте"
          >
            {compact ? <ExternalLink size={14} /> : 'На карте'}
          </Link>
          <Button variant="ghost" size="sm" icon aria-label="Убрать место" onClick={() => onChange(null)}>
            <X size={14} />
          </Button>
        </div>
      ) : (
        <div className={styles.tfPlaceInput}>
          {compact && <MapPin size={14} className={cx('faint', styles.tfFieldIcon)} />}
          <Input
            className={cx(compact && styles.withIcon)}
            aria-label="Где"
            placeholder={compact ? 'Где: x z или город' : 'x z, «51.5 -0.12» или город — Enter'}
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
            <ul className={styles.tfPlaceSuggest} role="listbox">
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
          {error && <div className={cx('faint', 'small', styles.tfPlaceErr)}>{error}</div>}
        </div>
      )}
    </div>
  );
}
