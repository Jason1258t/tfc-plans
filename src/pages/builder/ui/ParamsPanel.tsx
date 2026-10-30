import { Dices, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { FORMS, STYLES, TYPES, makeSpec } from '@tfc/core/building/presets';
import type { BuildingSpec, RoofSpec, Side, Volume } from '@tfc/core/building/spec';
import { Button, Input, Segmented, Select } from '@/shared/ui';
import { cx } from '@/shared/lib';
import styles from '../BuilderPage/BuilderPage.module.css';

interface Props {
  spec: BuildingSpec;
  onChange: (spec: BuildingSpec) => void;
}

function Num({
  label,
  value,
  min,
  max,
  onChange,
  title,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  title?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className={styles.num} title={title}>
      <span className="faint small">{label}</span>
      <Input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

const SIDES: { value: Side; label: string }[] = [
  { value: 'south', label: 'юг' },
  { value: 'north', label: 'север' },
  { value: 'east', label: 'восток' },
  { value: 'west', label: 'запад' },
];

const ROOFS: { value: RoofSpec['kind']; label: string }[] = [
  { value: 'gable', label: 'двускатная' },
  { value: 'hip', label: 'вальмовая' },
  { value: 'shed', label: 'односкатная' },
  { value: 'flat', label: 'плоская' },
];

const DEGREES = [
  { value: 0, label: '0', title: 'один блок' },
  { value: 1, label: '1', title: '2 блока, крупные пятна' },
  { value: 2, label: '2', title: '3 блока, средние пятна' },
  { value: 3, label: '3', title: '4 блока, мелкие пятна, градиент' },
  { value: 4, label: '4', title: 'все выбранные, пятна разного размера' },
];

/** Параметры постройки: пресет, объёмы, проёмы, отделка, степень текстурирования */
export function ParamsPanel({ spec, onChange }: Props) {
  const [preset, setPreset] = useState({ form: spec.form, style: spec.style, type: spec.type });
  const vol = (i: number, patch: Partial<Volume>) =>
    onChange({ ...spec, volumes: spec.volumes.map((v, k) => (k === i ? { ...v, ...patch } : v)) });
  const roof = (i: number, patch: Partial<RoofSpec>) => vol(i, { roof: { ...spec.volumes[i].roof, ...patch } });
  const open = spec.openings;
  const det = spec.details;

  return (
    <div className={styles.params}>
      <Group title="Пресет">
        <div className={styles.row}>
          <Select
            value={preset.form}
            onChange={(e) => setPreset({ ...preset, form: e.target.value })}
            aria-label="Форма плана"
          >
            {Object.entries(FORMS).map(([id, f]) => (
              <option key={id} value={id}>
                {f.name}
              </option>
            ))}
          </Select>
          <Select
            value={preset.style}
            onChange={(e) => setPreset({ ...preset, style: e.target.value })}
            aria-label="Стиль"
          >
            {Object.entries(STYLES).map(([id, s]) => (
              <option key={id} value={id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select
            value={preset.type}
            onChange={(e) => setPreset({ ...preset, type: e.target.value })}
            aria-label="Тип здания"
          >
            {Object.entries(TYPES).map(([id, t]) => (
              <option key={id} value={id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <Button
          size="sm"
          onClick={() => onChange(makeSpec({ ...preset, seed: spec.seed, degree: spec.texture.degree }))}
          title="Объёмы, проёмы, отделка и блоки ролей — заново из пресета"
        >
          Применить пресет
        </Button>
      </Group>

      <Group title="Объёмы">
        {spec.volumes.map((v, i) => (
          <div key={v.id} className={styles.volume}>
            <div className={styles.volumeHead}>
              <b>{v.id}</b>
              <span className="faint small grow">
                {v.w}×{v.d}, {v.floors} эт.
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon
                disabled={spec.volumes.length < 2}
                aria-label={`Удалить объём ${v.id}`}
                onClick={() => onChange({ ...spec, volumes: spec.volumes.filter((_, k) => k !== i) })}
              >
                <Trash2 size={14} />
              </Button>
            </div>
            <div className={styles.nums}>
              <Num label="x" value={v.x} min={-96} max={96} onChange={(x) => vol(i, { x })} />
              <Num label="z" value={v.z} min={-96} max={96} onChange={(z) => vol(i, { z })} />
              <Num label="ширина" value={v.w} min={3} max={96} onChange={(w) => vol(i, { w })} />
              <Num label="глубина" value={v.d} min={3} max={96} onChange={(d) => vol(i, { d })} />
              <Num label="этажей" value={v.floors} min={1} max={12} onChange={(floors) => vol(i, { floors })} />
              <Num
                label="высота эт."
                value={v.floorH}
                min={3}
                max={12}
                onChange={(floorH) => vol(i, { floorH })}
                title="Пол + воздух"
              />
              <Num
                label="основание"
                value={v.y}
                min={0}
                max={96}
                onChange={(y) => vol(i, { y })}
                title="Высота фундамента"
              />
            </div>
            <div className={styles.row}>
              <Select
                value={v.roof.kind}
                onChange={(e) => roof(i, { kind: e.target.value as RoofSpec['kind'] })}
                aria-label="Крыша"
              >
                {ROOFS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
              <Select
                value={v.roof.pitch}
                onChange={(e) => roof(i, { pitch: Number(e.target.value) as RoofSpec['pitch'] })}
                aria-label="Уклон"
              >
                <option value={1}>45°</option>
                <option value={0.5}>пологая</option>
              </Select>
              <Select
                value={v.roof.axis}
                onChange={(e) => roof(i, { axis: e.target.value as RoofSpec['axis'] })}
                aria-label="Конёк вдоль"
              >
                <option value="auto">конёк по длинной</option>
                <option value="x">конёк вдоль x</option>
                <option value="z">конёк вдоль z</option>
              </Select>
              <Num
                label="свес"
                value={v.roof.overhang}
                min={0}
                max={2}
                onChange={(overhang) => roof(i, { overhang })}
              />
            </div>
          </div>
        ))}
        <Button
          size="sm"
          onClick={() => {
            const last = spec.volumes[spec.volumes.length - 1];
            const id = String.fromCharCode(65 + spec.volumes.length);
            onChange({
              ...spec,
              volumes: [
                ...spec.volumes,
                { ...last, id, x: last.x + last.w - 1, w: Math.max(5, Math.round(last.w / 2)) | 1 },
              ],
            });
          }}
        >
          <Plus size={14} />
          Объём
        </Button>
      </Group>

      <Group title="Окна и вход">
        <div className={styles.nums}>
          <Num
            label="ширина окна"
            value={open.windowW}
            min={0}
            max={8}
            onChange={(windowW) => onChange({ ...spec, openings: { ...open, windowW } })}
            title="0 — без окон"
          />
          <Num
            label="высота окна"
            value={open.windowH}
            min={1}
            max={10}
            onChange={(windowH) => onChange({ ...spec, openings: { ...open, windowH } })}
          />
          <Num
            label="шаг окон"
            value={open.windowEvery}
            min={2}
            max={16}
            onChange={(windowEvery) => onChange({ ...spec, openings: { ...open, windowEvery } })}
            title="Расстояние между центрами"
          />
          <Num
            label="подоконник"
            value={open.sillH}
            min={0}
            max={6}
            onChange={(sillH) => onChange({ ...spec, openings: { ...open, sillH } })}
            title="Высота над полом"
          />
          <Num
            label="ширина входа"
            value={open.door.w}
            min={0}
            max={8}
            onChange={(w) => onChange({ ...spec, openings: { ...open, door: { ...open.door, w } } })}
            title="0 — без входа; 1–2 — дверь, шире — проём"
          />
          <Num
            label="высота входа"
            value={open.door.h}
            min={2}
            max={10}
            onChange={(h) => onChange({ ...spec, openings: { ...open, door: { ...open.door, h } } })}
          />
        </div>
        <Select
          value={open.door.side}
          onChange={(e) =>
            onChange({ ...spec, openings: { ...open, door: { ...open.door, side: e.target.value as Side } } })
          }
          aria-label="Сторона входа"
        >
          {SIDES.map((s) => (
            <option key={s.value} value={s.value}>
              вход: {s.label}
            </option>
          ))}
        </Select>
      </Group>

      <Group title="Отделка">
        <div className={styles.nums}>
          <Num
            label="рядов цоколя"
            value={det.plinthH}
            min={0}
            max={4}
            onChange={(plinthH) => onChange({ ...spec, details: { ...det, plinthH } })}
          />
          <Num
            label="шаг каркаса"
            value={det.frameEvery}
            min={0}
            max={12}
            onChange={(frameEvery) => onChange({ ...spec, details: { ...det, frameEvery } })}
            title="Фахверк: стойки через столько клеток; 0 — без каркаса"
          />
        </div>
        {(
          [
            ['quoins', 'русты на углах'],
            ['openingExt', 'перемычки и подоконники шире проёма'],
            ['chimney', 'труба'],
            ['clearInside', 'воздух внутри (очистить место)'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className={cx('small', styles.check)}>
            <input
              type="checkbox"
              checked={det[k]}
              onChange={(e) => onChange({ ...spec, details: { ...det, [k]: e.target.checked } })}
            />
            {label}
          </label>
        ))}
      </Group>

      <Group title="Текстурирование">
        <Segmented
          label="Степень текстурирования"
          options={DEGREES.map((d) => ({ value: d.value, label: d.label, title: d.title }))}
          value={spec.texture.degree}
          onChange={(degree) => onChange({ ...spec, texture: { degree } })}
        />
        <p className="faint small">
          Насколько смешан материал внутри роли: 0 — один блок, 4 — все выбранные блоки пятнами разного размера и с
          градиентом к земле.
        </p>
        <div className={styles.row}>
          <Num
            label="зерно"
            value={spec.seed}
            min={0}
            max={2 ** 31 - 1}
            onChange={(seed) => onChange({ ...spec, seed })}
            title="Одинаковое зерно — одинаковая раскладка"
          />
          <Button size="sm" onClick={() => onChange({ ...spec, seed: Math.floor(Math.random() * 1e6) })}>
            <Dices size={14} />
            Перемешать
          </Button>
        </div>
      </Group>
    </div>
  );
}
