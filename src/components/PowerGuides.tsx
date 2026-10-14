import { useState } from 'react';
import { CONFIG_ORIGIN_LABEL } from '../lib/config';
import {
  alternator,
  degreesPerStep,
  diodeDrop,
  diodesInPath,
  pumpSpeed,
  pumpVolts,
  rectified,
  useSettings,
  type PowerData,
  type Rectifier,
  type Setting,
} from '../lib/power';
import { cx } from '../lib/util';
import { ItemIcon } from './ItemIcon';

/**
 * Справочник → Электричество → Гайды. Статья — компонент: в ней калькуляторы на тех же формулах, что и
 * в остальном разделе (src/lib/power.ts). Список статей — GUIDES; адрес статьи — ?tab=power&sub=guides&g=<id>.
 */

const GUIDES = [{ id: 'ac-pump', title: 'Помпа на переменном токе: выпрямитель', Body: AcPumpGuide }];

type Get = (key: string) => Setting | null;

const num = (v: number, digits = 0) =>
  Number.isFinite(v)
    ? (Math.round(v * 10 ** digits) / 10 ** digits).toLocaleString('ru-RU', { maximumFractionDigits: digits })
    : '—';
const watts = (w: number) => (Math.abs(w) >= 10000 ? `${num(w / 1000, 1)} кВт` : `${num(w)} Вт`);

export function PowerGuides({
  data,
  ee,
  guide,
  onGuide,
}: {
  data: PowerData;
  ee: Get;
  guide: string | null;
  onGuide: (id: string | null) => void;
}) {
  const g = GUIDES.find((x) => x.id === guide);
  if (g)
    return (
      <>
        <button className="btn ghost small power-back" onClick={() => onGuide(null)}>
          ← Все гайды
        </button>
        <g.Body data={data} ee={ee} />
      </>
    );
  return (
    <section className="ref-card">
      <h2 className="power-h">Гайды</h2>
      <p className="faint small">
        Как собрать типовые схемы. Числа — по коду модов и настройкам сервера; в игре схемы не проверялись, если не
        сказано обратное.
      </p>
      <ul className="power-guides">
        {GUIDES.map((x) => (
          <li key={x.id}>
            <button className="power-link" onClick={() => onGuide(x.id)}>
              {x.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- переменный ток → помпа

const PUMP_IMPACT_KEY = 'kinetics.stressValues.v2.impact.mechanical_pump';

const SCHEMES: { id: Rectifier; label: string }[] = [
  { id: 'dc', label: 'Обычный щёточный узел (постоянный ток)' },
  { id: 'raw', label: 'Фаза и нейтраль напрямую, без выпрямителя' },
  { id: 'bridge3', label: 'Трёхфазный мост, 6 диодов' },
  { id: 'bridge1', label: 'Однофазный мост, 4 диода' },
  { id: 'bridge1cap', label: 'Однофазный мост + конденсатор' },
];

function AcPumpGuide({ data, ee }: { data: PowerData; ee: Get }) {
  const create = useSettings(data.create?.file, [{ key: PUMP_IMPACT_KEY, default: data.create?.pumpImpact ?? null }]);
  const impact = create.get(PUMP_IMPACT_KEY);
  const pumpR = ee('Resistances.pumpResistance');
  const capV = ee('Voltages.capacitorVoltage');
  const hvCapV = ee('Voltages.highVoltageCapacitorVoltage');
  const micro = ee('simulation.microTicks');
  const ac = data.ee?.ac;
  const pump = data.ee?.pump;
  const pp =
    pumpR && impact && pump ? { resistance: pumpR.value, impact: impact.value, maxSpeed: pump.maxSpeed } : null;
  const full = pp ? pumpVolts(256, pp) : null;

  return (
    <article className="ref-card power-article">
      <h2 className="power-h">Помпа на переменном токе: выпрямитель</h2>
      <div className="power-note">
        <b>Коротко.</b> Электропомпе нужен постоянный ток: от переменного её скорость скачет. Проще всего запитать помпы
        от <b>обычного</b> щёточного узла. Если сеть трёхфазная — поставить мост из <b>6 диодов</b> на три фазы, он даёт
        почти ровное напряжение и без конденсатора. Для 256 об/мин помпе нужно около <b>{full ? num(full) : '—'} В</b>{' '}
        постоянного.
      </div>

      <h3>Откуда переменный ток</h3>
      <p>
        <span className="power-name">
          <ItemIcon id="electroenergetics:alternator_brushes" size={20} />
          Обычный щёточный узел
        </span>{' '}
        даёт постоянное напряжение. <ItemIcon id="electroenergetics:three_phase_alternator_brushes" size={20} />{' '}
        <b>Трёхфазный</b> — переменное: три синусоиды со сдвигом {ac?.phaseShift ?? 120}°. У него четыре контакта:
        нейтраль и три фазы (звезда). Амплитуда фазы равна напряжению обычного узла с теми же роторами (выработка / ток
        полной нагрузки), частота — {ac ? num(ac.hzPerRpm, 5) : '—'} Гц на 1 об/мин (при 256 об/мин —{' '}
        {ac ? num(ac.hzPerRpm * 256) : '—'} Гц).
      </p>

      <h3>Что происходит с помпой</h3>
      <p>
        Помпа на каждом расчёте цепи берёт напряжение <i>в этот момент</i> и крутится со скоростью U² /{' '}
        <Val s={pumpR} unit="Ом" /> / <Val s={impact} unit="SU" /> (нагрузка механической помпы Create), не больше{' '}
        {pump?.maxSpeed ?? '—'}. Усреднения нет: на переменном токе скорость то максимальная, то ноль. Направление
        качания от полярности не зависит.
      </p>
      <p>
        Цепь на сервере считается <Val s={micro} /> раз за тик, то есть 20 раз в секунду, а фаза за тик поворачивается
        на {ac ? num(degreesPerStep(1, ac.hzPerRpm, micro?.value ?? 1), 4) : '—'}° × об/мин. Из-за этого помпа видит не
        синусоиду, а её редкие «снимки»: при 128 об/мин фаза делает ровно оборот за тик, и помпа каждый раз видит одно и
        то же напряжение — какое выпадет, хоть ноль. Посмотреть можно на графике в калькуляторе ниже.
      </p>

      <h3>Кому выпрямлять не нужно</h3>
      <ul>
        <li>
          <b>Двигатель</b> усредняет напряжение (среднеквадратичное) и на переменном токе работает ровно. Но действующее
          напряжение синусоиды — амплитуда / 1,41, поэтому запас SU у него вдвое меньше, чем на постоянном с той же
          амплитудой.
        </li>
        <li>
          <b>Трансформатор</b> в этом моде — идеальное соотношение витков без индуктивности: постоянный ток он повышает
          и понижает так же, как переменный. Ради передачи на расстояние переменный ток не нужен.
        </li>
      </ul>

      <h3>Способ 1. Отдельный генератор постоянного тока</h3>
      <p>
        На тот же вал — ещё ротор со статорами и <b>обычный</b> щёточный узел, от него — отдельная линия к помпам.
        Ничего выпрямлять не нужно. Нагрузка на вал — по калькулятору генератора во вкладке «Как связаны».
      </p>

      <h3>Способ 2. Трёхфазный мост (6 диодов)</h3>
      <BridgeDiagram legs={3} />
      <ol>
        <li>Поставьте шесть диодов парами — по паре на фазу.</li>
        <li>
          В каждой паре: нижний диод — анодом к шине «−», верхний — катодом к шине «+»; середину пары соедините с фазой.
          Ток идёт через диод от анода (больший потенциал) к катоду — так в понде мода.
        </li>
        <li>Нейтраль не подключайте.</li>
        <li>Помпы — между шинами «+» и «−», параллельно.</li>
      </ol>
      <p>
        На выходе — разность самой высокой и самой низкой фазы: от 1,5 до 1,73 амплитуды, без провалов в ноль, при любом
        угле ротора. Поэтому «снимки» раз в тик здесь не мешают. Падение на диодах — около 1 В на каждом, на пути тока
        их два.
      </p>

      <h3>Способ 3. Однофазный мост с конденсатором</h3>
      <BridgeDiagram legs={1} cap />
      <p>
        Фаза и нейтраль на мост из четырёх диодов, конденсатор — параллельно выходу. Без конденсатора напряжение падает
        до нуля дважды за период. Обычный конденсатор выдерживает <Val s={capV} unit="В" />, высоковольтный —{' '}
        <Val s={hvCapV} unit="В" />. Насколько ровно сгладит — зависит от ёмкости; это пока не считали.
      </p>

      {pp && ac && <AcPumpCalc data={data} ee={ee} pump={pp} hzPerRpm={ac.hzPerRpm} microTicks={micro?.value ?? 1} />}

      <h3>Что проверено</h3>
      <ul className="faint small">
        <li>
          По коду мода: обычный узел — постоянный, трёхфазный — синусоиды, нейтраль и три фазы; частота; формула помпы и
          её предел; помпа без усреднения, двигатель с усреднением; модель диода (Шокли); трансформатор без
          индуктивности; пределы конденсаторов.
        </li>
        <li>
          Не проверено: в игре — ничего; с какой стороны у блока диода анод (смотрите понд, клавиша W по блоку); сколько
          раз за тик фаза поворачивается, если в цепи есть диоды (решатель может считать их в несколько проходов); как
          генератор проседает под нагрузкой на каждой фазе.
        </li>
      </ul>
    </article>
  );
}

function Val({ s, unit }: { s: Setting | null; unit?: string }) {
  if (!s) return <>—</>;
  return (
    <span title={CONFIG_ORIGIN_LABEL[s.origin]}>
      {num(s.value, 2)}
      {unit ? ` ${unit}` : ''}
    </span>
  );
}

function AcPumpCalc({
  data,
  ee,
  pump,
  hzPerRpm,
  microTicks,
}: {
  data: PowerData;
  ee: Get;
  pump: { resistance: number; impact: number; maxSpeed: number };
  hzPerRpm: number;
  microTicks: number;
}) {
  const [stators, setStators] = useState(8);
  const [rpm, setRpm] = useState(64);
  const [ratio, setRatio] = useState(1);
  const [pumps, setPumps] = useState(1);
  const [kind, setKind] = useState<Rectifier>('bridge3');
  const [start, setStart] = useState(30);
  const powerMult = ee('rotor.rotorPowerMultiplier');
  const stressMult = ee('rotor.rotorStressMultiplier');
  const fullLoad = ee('rotor.rotorFullLoadCurrent');
  const rotor = data.ee?.rotor;
  const diode = data.ee?.diode;
  if (!powerMult || !stressMult || !fullLoad || !rotor) return null;
  const g = alternator(stators, rpm, {
    powerMult: powerMult.value,
    stressMult: stressMult.value,
    fullLoadCurrent: fullLoad.value,
    stressFactor: rotor.stressFactor,
  });
  const amp = g.emf * ratio;
  const step = degreesPerStep(rpm, hzPerRpm, microTicks);
  // Напряжение на помпе в момент расчёта: схема минус падение на диодах при токе всех помп
  const atAngle = (theta: number) => {
    const v = rectified(kind, amp, theta);
    const n = diodesInPath(kind);
    if (!n || !diode) return v;
    const current = (Math.abs(v) / pump.resistance) * pumps;
    return Math.max(0, Math.abs(v) - n * diodeDrop(current, diode));
  };
  const samples = Array.from({ length: 20 }, (_, i) => atAngle(start + i * step));
  const speeds = samples.map((v) => pumpSpeed(v, pump));
  const vMin = Math.min(...samples.map(Math.abs));
  const vMax = Math.max(...samples.map(Math.abs));
  const sMin = Math.min(...speeds);
  const sMax = Math.max(...speeds);
  const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const draw = (vMax * vMax * pumps) / pump.resistance;
  // Однофазные схемы берут мощность только одной фазы
  const available = kind === 'dc' ? g.power : kind === 'bridge3' ? g.power : g.power / 3;

  return (
    <section className="power-calc">
      <h3>Калькулятор</h3>
      <div className="power-form">
        <label className="power-field">
          <span className="faint small">Схема</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Rectifier)}>
            {SCHEMES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <NumField label="Статоров всего" value={stators} onChange={setStators} min={1} max={400} />
        <NumField label="Скорость вала" value={rpm} onChange={setRpm} min={1} max={256} unit="об/мин" />
        <NumField
          label="Трансформатор: выход / вход"
          value={ratio}
          onChange={setRatio}
          min={0.01}
          max={100}
          step={0.1}
          unit="×"
        />
        <NumField label="Помп параллельно" value={pumps} onChange={setPumps} min={1} max={64} />
        <NumField label="Угол ротора в начале" value={start} onChange={setStart} min={0} max={359} unit="°" />
      </div>
      <div className="power-outs">
        <div className="power-out">
          <span className="faint small">{kind === 'dc' ? 'Напряжение' : 'Амплитуда фазы'}</span>
          <b>{num(amp, 1)} В</b>
          {kind !== 'dc' && <span className="faint small">частота {num(hzPerRpm * rpm, 1)} Гц</span>}
        </div>
        <div className="power-out">
          <span className="faint small">На помпе за секунду</span>
          <b>{num(vMin, 1) === num(vMax, 1) ? `${num(vMax, 1)} В` : `${num(vMin, 1)}–${num(vMax, 1)} В`}</b>
        </div>
        <div className="power-out">
          <span className="faint small">Скорость помпы</span>
          <b>{num(sMin) === num(sMax) ? num(sMax) : `${num(sMin)}–${num(sMax)}`}</b>
          <span className="faint small">в среднем {num(avg)}</span>
        </div>
        <div className="power-out">
          <span className="faint small">Помпы потребляют, до</span>
          <b>{watts(draw)}</b>
          <span className={cx('small', draw > available ? 'power-bad' : 'faint')}>
            {draw > available
              ? 'больше, чем даёт генератор — напряжение просядет'
              : `генератор даёт ${watts(available)}`}
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Для 256 об/мин нужно</span>
          <b>{num(pumpVolts(256, pump))} В</b>
          <span className="faint small">постоянного на помпе</span>
        </div>
      </div>
      <TickChart speeds={speeds} max={pump.maxSpeed} step={step} />
    </section>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="power-field">
      <span className="faint small">{label}</span>
      <span>
        <input
          className="input"
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
        {unit && <span className="faint small"> {unit}</span>}
      </span>
    </label>
  );
}

/** Скорость помпы на каждом из 20 тиков секунды */
function TickChart({ speeds, max, step }: { speeds: number[]; max: number; step: number }) {
  const w = 400;
  const h = 90;
  const bw = w / speeds.length;
  return (
    <figure className="power-figure">
      <svg viewBox={`0 0 ${w} ${h + 16}`} role="img" aria-label="Скорость помпы по тикам">
        <line x1={0} y1={h} x2={w} y2={h} className="power-axis" />
        {speeds.map((s, i) => {
          const bh = (s / max) * h;
          return (
            <rect key={i} x={i * bw + 2} y={h - bh} width={bw - 4} height={Math.max(bh, 0.5)} className="power-bar">
              <title>
                тик {i + 1}: {num(s)}
              </title>
            </rect>
          );
        })}
        <text x={0} y={h + 13} className="power-svg-text">
          1 тик
        </text>
        <text x={w} y={h + 13} textAnchor="end" className="power-svg-text">
          20 тиков = 1 с
        </text>
      </svg>
      <figcaption className="faint small">
        Скорость помпы на каждом тике секунды (столбик во всю высоту — {max}). Фаза за тик поворачивается на{' '}
        {num(step % 360, 1)}°{step >= 360 ? ` (ещё ${Math.floor(step / 360)} полных оборота)` : ''}.
      </figcaption>
    </figure>
  );
}

/** Схема моста: legs = 3 — трёхфазный (6 диодов), 1 — однофазный (фаза и нейтраль, 4 диода) */
function BridgeDiagram({ legs, cap = false }: { legs: 3 | 1; cap?: boolean }) {
  const inputs = legs === 3 ? ['A', 'B', 'C'] : ['фаза', 'N'];
  const cols = inputs.map((_, i) => 80 + i * 90);
  const top = 30;
  const bottom = 190;
  const mid = (top + bottom) / 2;
  const right = cols[cols.length - 1] + 80;
  const pumpX = right + (cap ? 70 : 0);
  const width = pumpX + 70;
  const diode = (x: number, y: number) => (
    <g className="power-diode">
      <polygon points={`${x - 8},${y + 7} ${x + 8},${y + 7} ${x},${y - 7}`} />
      <line x1={x - 9} y1={y - 7} x2={x + 9} y2={y - 7} />
    </g>
  );
  return (
    <figure className="power-figure">
      <svg
        viewBox={`0 0 ${width} 220`}
        role="img"
        aria-label={legs === 3 ? 'Схема трёхфазного моста' : 'Схема однофазного моста с конденсатором'}
      >
        <line x1={cols[0]} y1={top} x2={pumpX} y2={top} className="power-wire" />
        <line x1={cols[0]} y1={bottom} x2={pumpX} y2={bottom} className="power-wire" />
        <text x={pumpX + 8} y={top + 4} className="power-svg-text">
          +
        </text>
        <text x={pumpX + 8} y={bottom + 4} className="power-svg-text">
          −
        </text>
        {cols.map((x, i) => (
          <g key={x}>
            <line x1={x} y1={top} x2={x} y2={bottom} className="power-wire" />
            {diode(x, (top + mid) / 2)}
            {diode(x, (mid + bottom) / 2)}
            <line x1={x - 28} y1={mid} x2={x} y2={mid} className="power-wire" />
            <circle cx={x} cy={mid} r={3} className="power-dot" />
            <circle cx={x - 28} cy={mid} r={3} className="power-term" />
            <text x={x - 34} y={mid + 4} textAnchor="end" className="power-svg-text">
              {inputs[i]}
            </text>
          </g>
        ))}
        {cap && (
          <g className="power-cap">
            <line x1={right} y1={top} x2={right} y2={mid - 5} className="power-wire" />
            <line x1={right} y1={mid + 5} x2={right} y2={bottom} className="power-wire" />
            <line x1={right - 14} y1={mid - 5} x2={right + 14} y2={mid - 5} />
            <line x1={right - 14} y1={mid + 5} x2={right + 14} y2={mid + 5} />
            <text x={right + 18} y={mid + 4} className="power-svg-text">
              C
            </text>
          </g>
        )}
        <line x1={pumpX} y1={top} x2={pumpX} y2={mid - 18} className="power-wire" />
        <line x1={pumpX} y1={mid + 18} x2={pumpX} y2={bottom} className="power-wire" />
        <rect x={pumpX - 26} y={mid - 18} width={52} height={36} rx={4} className="power-load" />
        <text x={pumpX} y={mid + 4} textAnchor="middle" className="power-svg-text">
          помпа
        </text>
      </svg>
      <figcaption className="faint small">
        {legs === 3
          ? 'Каждая фаза — в середину пары диодов. Треугольник диода смотрит по направлению тока: снизу вверх, от «−» к «+».'
          : 'Фаза и нейтраль — каждая в середину своей пары диодов; конденсатор параллельно помпе.'}
      </figcaption>
    </figure>
  );
}
