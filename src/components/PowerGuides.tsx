import { useState } from 'react';
import { CONFIG_ORIGIN_LABEL } from '../lib/config';
import {
  alternator,
  alternatorLoad,
  type AlternatorLoad,
  IE_WIRE,
  statorsFor,
  type AlternatorParams,
  degreesPerStep,
  maxSteadyHeat,
  steadyTemp,
  stepsToTemp,
  transformerRatios,
  wireValue,
  type EeWire,
  type HeatModel,
  diodeDrop,
  diodeResistance,
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
import { IeLoadPicker } from './PowerIeLoads';

/**
 * Справочник → Электричество → Гайды. Статья — компонент: в ней калькуляторы на тех же формулах, что и
 * в остальном разделе (src/lib/power.ts). Список статей — GUIDES; адрес статьи — ?tab=power&sub=guides&g=<id>.
 */

const GUIDES = [
  { id: 'generator', title: 'Первый генератор: статоры, обороты, напряжение', Body: GeneratorGuide },
  { id: 'optimal', title: 'Оптимальный режим генератора: обороты, напряжение, мощность', Body: OptimalGuide },
  { id: 'rectify', title: 'Выпрямление: из переменного тока в постоянный', Body: RectifyGuide },
  { id: 'ac-pump', title: 'Помпа на переменном токе', Body: AcPumpGuide },
  { id: 'line', title: 'Линия на дальнее расстояние через трансформаторы', Body: LineGuide },
  { id: 'converter', title: 'Из EE в IE и обратно: преобразователь', Body: ConverterGuide },
];

type Get = (key: string) => Setting | null;

const num = (v: number, digits = 0) =>
  Number.isFinite(v)
    ? (Math.round(v * 10 ** digits) / 10 ** digits).toLocaleString('ru-RU', { maximumFractionDigits: digits })
    : '—';
const watts = (w: number) => (Math.abs(w) >= 10000 ? `${num(w / 1000, 1)} кВт` : `${num(w)} Вт`);

export function PowerGuides({
  data,
  ee,
  ie,
  att,
  guide,
  onGuide,
}: {
  data: PowerData;
  ee: Get;
  ie: Get;
  att: Get;
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
        <g.Body data={data} ee={ee} ie={ie} att={att} />
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

// ---------------------------------------------------------------- выпрямление и помпа на переменном токе

const PUMP_IMPACT_KEY = 'kinetics.stressValues.v2.impact.mechanical_pump';

const SCHEMES: { id: Rectifier; label: string }[] = [
  { id: 'dc', label: 'Обычный щёточный узел (постоянный ток)' },
  { id: 'raw', label: 'Фаза и нейтраль напрямую, без выпрямителя' },
  { id: 'bridge3', label: 'Трёхфазный мост, 6 диодов' },
  { id: 'bridge1', label: 'Однофазный мост, 4 диода' },
  { id: 'bridge1cap', label: 'Однофазный мост + конденсатор' },
];

function RectifyGuide({ data, ee }: { data: PowerData; ee: Get }) {
  const capV = ee('Voltages.capacitorVoltage');
  const hvCapV = ee('Voltages.highVoltageCapacitorVoltage');
  const micro = ee('simulation.microTicks');
  const ac = data.ee?.ac;

  return (
    <article className="ref-card power-article">
      <h2 className="power-h">Выпрямление: из переменного тока в постоянный</h2>
      <div className="power-note">
        <b>Коротко.</b> Переменный ток даёт только трёхфазный щёточный узел. Двигателям, нагревателям и трансформаторам
        он не мешает; помпам, лампам, реле и аккумуляторам нужен постоянный. Самый надёжный постоянный ток — с{' '}
        <b>обычного</b> щёточного узла. Выпрямить переменный можно мостом из диодов EE (шесть на три фазы, четыре на
        одну) или блоком-выпрямителем аддона, но <b>диоды EE успевают за фазой только на малых оборотах</b>, пока на
        сервере не поднята настройка microTicks (сейчас <Val s={micro} />
        ), — подробно ниже.
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
      <FrequencyMeterNote micro={micro} hzPerRpm={ac?.hzPerRpm ?? null} />

      <h3>Кому нужен постоянный ток</h3>
      <p>
        Устройства EE по-разному берут напряжение (по коду мода): одни — мгновенное на каждом расчёте, другие —
        усреднённое или накопленное. Первым переменный ток мешает.
      </p>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>Устройство</th>
              <th>Как берёт напряжение</th>
              <th>На переменном токе</th>
            </tr>
          </thead>
          <tbody>
            {AC_DEVICES.map((d) => (
              <tr key={d.id}>
                <td>
                  <span className="power-name">
                    <ItemIcon id={d.id} size={20} />
                    {d.name}
                  </span>
                </td>
                <td className="small">{d.how}</td>
                <td className={cx('small', d.bad && 'power-bad')}>{d.ac}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Способ 1. Отдельный генератор постоянного тока</h3>
      <p>
        На тот же вал — ещё ротор со статорами и <b>обычный</b> щёточный узел, от него — отдельная линия к потребителям
        постоянного тока. Ничего выпрямлять не нужно. Нагрузка на вал — по калькулятору генератора во вкладке «Как
        связаны».
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
        <li>Потребители — между шинами «+» и «−», параллельно.</li>
      </ol>
      <p>
        На выходе — разность самой высокой и самой низкой фазы: от 1,5 до 1,73 амплитуды, без провалов в ноль, при любом
        угле ротора. Поэтому «снимки» раз в тик здесь не мешают — <b>если диоды успевают переключаться</b> (ниже).
      </p>
      <DiodeNote data={data} />
      <DiodeLagNote micro={micro} hzPerRpm={ac?.hzPerRpm ?? null} />

      <h3>Способ 3. Однофазный мост с конденсатором</h3>
      <BridgeDiagram legs={1} cap />
      <p>
        Фаза и нейтраль на мост из четырёх диодов, конденсатор — параллельно выходу. Без конденсатора напряжение падает
        до нуля дважды за период. Обычный конденсатор выдерживает <Val s={capV} unit="В" />, высоковольтный —{' '}
        <Val s={hvCapV} unit="В" />. Насколько ровно сгладит — зависит от ёмкости; это пока не считали.
      </p>

      <h3>Способ 4. Готовый блок-выпрямитель (аддон сборки)</h3>
      <div className="power-addon-row">
        <img src="/addons/three_phase_rectifier.png" alt="Трёхфазный выпрямитель" className="power-pixel" />
        <img src="/addons/single_phase_rectifier.png" alt="Однофазный выпрямитель" className="power-pixel" />
        <p>
          <b>Трёхфазный выпрямитель</b> и <b>однофазный выпрямитель</b> — блоки нашего аддона «EE Rectifiers». С версии
          1.1 внутри <b>нет диодов</b>: блок берёт с сети мощность как обычная нагрузка и отдаёт постоянное напряжение
          как генератор EE — среднее идеального моста: трёхфазный — 0,955 амплитуды линейного напряжения (1,65 амплитуды
          фазы), однофазный — 0,64 амплитуды. Поэтому трёхфазный выпрямитель даёт{' '}
          <b>ровное напряжение на любых оборотах</b> и при microTicks = 1, без потерь на диодах. Однофазный усредняет
          вход за 2 секунды; на оборотах, кратных 64 (фаза за тик — ровно 180° или 360°), он видит одну и ту же точку
          синусоиды и ошибается — для однофазной сети это неизбежно. Медные клеммы — входы, красная — «+», синяя — «−».
          Где скачать — в разделе <a href="/reference?tab=addons">Справочник → Аддоны</a>.
        </p>
      </div>

      {ac && <RectifierCalc data={data} ee={ee} hzPerRpm={ac.hzPerRpm} serverMicro={micro?.value ?? 1} />}

      <h3>Что проверено</h3>
      <ul className="faint small">
        <li>
          По коду мода: обычный узел — постоянный, трёхфазный — синусоиды, нейтраль и три фазы; частота; как каждое
          устройство из таблицы берёт напряжение; модель диода (Шокли, линеаризация по прошлому расчёту, не выше 0,8 В);
          трансформатор без индуктивности; пределы конденсаторов.
        </li>
        <li>
          На тестовом сервере (без игрока): от батарей переменного тока 100 В (1 Гц) на нагреватель 45 Ом трёхфазный
          выпрямитель дал 125 В, однофазный 79 В; с настоящим трёхфазным генератором при microTicks 1, 8 и 32 — таблица
          «Диоды EE не успевают»; блоки аддона и мост из отдельных диодов EE дали одинаковые числа.
        </li>
        <li>
          Не проверено: в игре — ничего (игрок увидел нестабильное напряжение — это и разобрали); с какой стороны у
          блока диода анод (смотрите понд, клавиша W по блоку); как сглаживает конденсатор; цена большого microTicks для
          TPS; мигание ламп и дребезг реле на переменном токе — вывод по коду.
        </li>
      </ul>
    </article>
  );
}

/** Кому мешает переменный ток — по тому, как устройство EE читает напряжение (postTick / свойства, по коду) */
const AC_DEVICES = [
  {
    id: 'electroenergetics:electric_pump',
    name: 'Электропомпа',
    how: 'мгновенное, каждый расчёт',
    ac: 'скорость скачет от нуля до максимума',
    bad: true,
  },
  {
    id: 'electroenergetics:bulb',
    name: 'Лампа',
    how: 'мгновенное, каждый расчёт',
    ac: 'яркость меняется каждый тик — мигает',
    bad: true,
  },
  {
    id: 'electroenergetics:relay',
    name: 'Реле',
    how: 'мгновенное на катушке, порог',
    ac: 'размыкается, когда синусоида проходит через ноль — дребезг',
    bad: true,
  },
  {
    id: 'electroenergetics:accumulator',
    name: 'Аккумулятор',
    how: 'ток со знаком: заряд и разряд',
    ac: 'заряжается и тут же разряжается — копить не будет',
    bad: true,
  },
  {
    id: 'electroenergetics:gray_electric_motor',
    name: 'Двигатель',
    how: 'среднеквадратичное за несколько расчётов',
    ac: 'работает ровно; запас SU — по действующему напряжению (амплитуда / 1,41)',
    bad: false,
  },
  {
    id: 'electroenergetics:resistive_heater',
    name: 'Нагреватель',
    how: 'копит тепло от U² / R',
    ac: 'работает по среднему: как на постоянном с амплитудой / 1,41',
    bad: false,
  },
  {
    id: 'electroenergetics:transformer',
    name: 'Трансформатор',
    how: 'идеальное соотношение витков',
    ac: 'работает одинаково на любом токе',
    bad: false,
  },
  {
    id: 'electroenergetics:converter',
    name: 'Преобразователь (из EE в FE)',
    how: 'мгновенная мощность в буфер',
    ac: 'работает: буфер сглаживает',
    bad: false,
  },
];

/** Калькулятор выпрямителя: напряжение на выходе по тикам, падение на диодах, успевают ли диоды */
function RectifierCalc({
  data,
  ee,
  hzPerRpm,
  serverMicro,
}: {
  data: PowerData;
  ee: Get;
  hzPerRpm: number;
  serverMicro: number;
}) {
  const [stators, setStators] = useState(4);
  const [rpm, setRpm] = useState(16);
  const [ratio, setRatio] = useState(1);
  const [ohms, setOhms] = useState(45);
  const [micro, setMicro] = useState(serverMicro);
  const [kind, setKind] = useState<Rectifier>('bridge3');
  const [start, setStart] = useState(30);
  const p = useAlternatorParams(data, ee);
  const diode = data.ee?.diode;
  if (!p) return null;
  const g = alternator(stators, rpm, p);
  const amp = g.emf * ratio;
  const perTick = degreesPerStep(rpm, hzPerRpm, 1);
  const perCalc = degreesPerStep(rpm, hzPerRpm, micro);
  const at = (theta: number) => {
    const v = Math.abs(rectified(kind, amp, theta));
    const n = diodesInPath(kind);
    if (!n || !diode) return v;
    // Падение на диодах при токе нагрузки: пара итераций, ток зависит от напряжения
    let out = v;
    for (let i = 0; i < 4; i++) out = Math.max(0, v - n * diodeDrop(out / ohms, diode));
    return out;
  };
  const volts = Array.from({ length: 20 }, (_, i) => at(start + i * perTick));
  const vMin = Math.min(...volts);
  const vMax = Math.max(...volts);
  const avg = volts.reduce((a, b) => a + b, 0) / volts.length;
  const verdict = !kind.startsWith('bridge')
    ? null
    : perCalc <= GOOD_STEP
      ? 'диоды успевают — выход как на графике'
      : perCalc <= OK_STEP
        ? 'на грани — возможна просадка или разброс в несколько процентов'
        : 'диоды не успевают — на деле выход будет скакать, график ниже — идеальный мост';
  return (
    <section className="power-calc">
      <h3>Калькулятор выпрямителя</h3>
      <div className="power-form">
        <label className="power-field">
          <span className="faint small">Схема</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Rectifier)}>
            {SCHEMES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
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
        <NumField label="Нагрузка" value={ohms} onChange={setOhms} min={0.1} max={100000} step={1} unit="Ом" />
        <NumField label="microTicks" value={micro} onChange={setMicro} min={1} max={MAX_MICRO} />
        <NumField label="Угол ротора в начале" value={start} onChange={setStart} min={0} max={359} unit="°" />
      </div>
      <div className="power-outs">
        <div className="power-out">
          <span className="faint small">{kind === 'dc' ? 'Напряжение узла' : 'Амплитуда фазы'}</span>
          <b>{num(amp, 1)} В</b>
          {kind !== 'dc' && <span className="faint small">частота {num(hzPerRpm * rpm, 1)} Гц</span>}
        </div>
        <div className="power-out">
          <span className="faint small">На выходе за секунду</span>
          <b>{num(vMin, 1) === num(vMax, 1) ? `${num(vMax, 1)} В` : `${num(vMin, 1)}–${num(vMax, 1)} В`}</b>
          <span className="faint small">
            в среднем {num(avg, 1)} В, ток до {num(vMax / ohms, 1)} А
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Нагрузка берёт</span>
          <b>{watts((avg * avg) / ohms)}</b>
          <span className={cx('small', (vMax * vMax) / ohms > g.power ? 'power-bad' : 'faint')}>
            {(vMax * vMax) / ohms > g.power
              ? 'больше выработки — напряжение просядет'
              : `генератор даёт ${watts(g.power)}`}
          </span>
        </div>
        {verdict && (
          <div className="power-out">
            <span className="faint small">Фаза за расчёт</span>
            <b>{num(perCalc, 1)}°</b>
            <span className={cx('small', perCalc > OK_STEP ? 'power-bad' : 'faint')}>
              {verdict}
              {perCalc > GOOD_STEP ? `; нужно microTicks ≥ ${microTicksFor(rpm, hzPerRpm)}` : ''}
            </span>
          </div>
        )}
      </div>
      <TickChart speeds={volts} max={Math.max(vMax, 1)} step={perTick} what="Напряжение на выходе" unit=" В" />
      <p className="faint small">
        Модель — идеальный мост с падением на диодах EE (0,8 В + ~5,6 Ом на каждый из двух на пути тока); просадку
        генератора под нагрузкой и запаздывание диодов график не учитывает. microTicks на сервере — <b>{serverMicro}</b>
        ; поле выше — чтобы посмотреть, что даст другое значение.
      </p>
    </section>
  );
}

function AcPumpGuide({ data, ee }: { data: PowerData; ee: Get }) {
  const create = useSettings(data.create?.file, [{ key: PUMP_IMPACT_KEY, default: data.create?.pumpImpact ?? null }]);
  const impact = create.get(PUMP_IMPACT_KEY);
  const pumpR = ee('Resistances.pumpResistance');
  const micro = ee('simulation.microTicks');
  const ac = data.ee?.ac;
  const pump = data.ee?.pump;
  const pp =
    pumpR && impact && pump ? { resistance: pumpR.value, impact: impact.value, maxSpeed: pump.maxSpeed } : null;
  const full = pp ? pumpVolts(256, pp) : null;

  return (
    <article className="ref-card power-article">
      <h2 className="power-h">Помпа на переменном токе</h2>
      <div className="power-note">
        <b>Коротко.</b> Электропомпе нужен постоянный ток: от переменного её скорость скачет. Проще всего запитать помпы
        от <b>обычного</b> щёточного узла; если сеть трёхфазная — выпрямить (гайд{' '}
        <a href="/reference?tab=power&sub=guides&g=rectify">«Выпрямление»</a>), помня, что диоды EE успевают только на
        малых оборотах при microTicks = <Val s={micro} />. Для 256 об/мин помпе нужно около{' '}
        <b>{full ? num(full) : '—'} В</b> постоянного.
      </div>

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

      <h3>Чем питать</h3>
      <ol>
        <li>
          <b>Обычный щёточный узел</b> на том же валу и отдельная линия к помпам — ничего выпрямлять не нужно.
        </li>
        <li>
          <b>Трёхфазный мост</b> из шести диодов или блок «Трёхфазный выпрямитель» — почти ровное напряжение, если диоды
          успевают за фазой.
        </li>
        <li>
          <b>Однофазный мост с конденсатором</b> — без конденсатора помпа дважды за период стоит.
        </li>
      </ol>
      <p>
        Схемы, кому ещё нужен постоянный ток, свойства диодов EE и настройка microTicks — в гайде{' '}
        <a href="/reference?tab=power&sub=guides&g=rectify">«Выпрямление: из переменного тока в постоянный»</a>.
      </p>

      {pp && ac && <AcPumpCalc data={data} ee={ee} pump={pp} hzPerRpm={ac.hzPerRpm} microTicks={micro?.value ?? 1} />}

      <h3>Что проверено</h3>
      <ul className="faint small">
        <li>
          По коду мода: формула помпы и её предел, помпа без усреднения; нагрузка механической помпы Create — из кода
          Create и конфига сервера; частота трёхфазного узла.
        </li>
        <li>Выпрямители — см. «Что проверено» в гайде «Выпрямление».</li>
        <li>Не проверено: в игре — ничего.</li>
      </ul>
    </article>
  );
}

/**
 * Частотомер EE считает период по переходам напряжения через ноль — по одному отсчёту на расчёт цепи (microTicks × 20
 * в секунду). Быстрее четверти частоты отсчётов он врёт, выше половины — показывает «отражённую» частоту.
 * По коду FrequencyMeterDevice и замерам на сервере разработки (/rectest ac + частотомер на фазе и нейтрали).
 */
function FrequencyMeterNote({ micro, hzPerRpm }: { micro: Setting | null; hzPerRpm: number | null }) {
  const m = micro?.value ?? 1;
  const rate = 20 * m;
  const rows: [number, string, string][] = [
    [16, '2,50 — верно', '—'],
    [32, '5,00 — верно', '—'],
    [48, '7,14–8,32 — скачет', '7,50 — верно'],
    [64, '10,00 — верно (совпадение)', '—'],
    [80, '6,88–8,48', '—'],
    [100, '4,29–4,46', '15,50–15,71'],
    [128, '0,15–0,39', '20,00 — верно'],
    [160, '4,92–5,09', '—'],
    [200, '7,04–10,52', '26,48–40,22 — скачет'],
    [256, '0,18–0,60', '40,00 — верно'],
  ];
  return (
    <div className="power-note">
      <p>
        <ItemIcon id="electroenergetics:frequency_meter" size={20} />{' '}
        <b>Частотомеру EE на больших оборотах не верьте.</b> По коду он ищет переходы напряжения через ноль, а
        напряжение видит только в моменты расчёта цепи — {num(rate)} раз в секунду при microTicks = <Val s={micro} />.
        Частоту выше половины этого ({num(rate / 2)} Гц) по таким отсчётам отличить нельзя: прибор показывает
        «отражённую» — разницу с ближайшим кратным {num(rate)} Гц (как колёса в кино крутятся назад). Уже с четверти (
        {num(rate / 4)} Гц) показания скачут. Обновляется раз в 10 расчётов и молчит, если амплитуда меньше 8 В.
      </p>
      <p>
        Надёжно — до <b>{hzPerRpm ? num(rate / 4 / hzPerRpm) : '—'} об/мин</b> при нынешнем microTicks. Выше считайте
        частоту по оборотам: {hzPerRpm ? num(hzPerRpm, 5) : '—'} Гц × об/мин (точно по коду ротора). Это та же причина,
        что у диодов ниже: один расчёт за тик — мало для быстрого переменного тока.
      </p>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th className="num">об/мин</th>
              <th className="num">на самом деле, Гц</th>
              <th>частотомер, microTicks = 1</th>
              <th>microTicks = 4</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([rpm, a, b]) => (
              <tr key={rpm}>
                <td className="num">{rpm}</td>
                <td className="num">{hzPerRpm ? num(hzPerRpm * rpm, 2) : '—'}</td>
                <td>{a}</td>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small faint">
        Замер на сервере разработки: ротор с 4 статорами, трёхфазный узел, частотомер на фазе и нейтрали, показания
        каждый тик, 80 тиков. Те же числа даёт расчёт по коду прибора. В игре не проверялось.
      </p>
    </div>
  );
}

/** Сколько расчётов за тик нужно, чтобы диоды EE успевали за переменным током: шаг фазы ≤ GOOD_STEP градусов */
const GOOD_STEP = 10;
const OK_STEP = 25;
const MAX_MICRO = 32;
const microTicksFor = (rpm: number, hzPerRpm: number) =>
  Math.min(MAX_MICRO, Math.max(1, Math.ceil(degreesPerStep(rpm, hzPerRpm, 1) / GOOD_STEP)));

/**
 * Главная находка проверки в «боевом» режиме: диод EE линеаризуется по своему напряжению на прошлом расчёте
 * (DiodeProperties.lastVoltage), а расчёт по умолчанию один за тик. Если фаза за расчёт уходит далеко, диоды
 * открываются и закрываются невпопад. Замеры — сервер разработки, /rectest ac (tools/ee-rectifier-mod).
 */
function DiodeLagNote({ micro, hzPerRpm }: { micro: Setting | null; hzPerRpm: number | null }) {
  const rows: [string, string, string, string, string][] = [
    ['4', '25–31 В — ровно', '—', '—', '≈ 30 В'],
    ['16', '12–68 В', '119–123 В', '119–123 В', '≈ 120 В'],
    ['37', 'от −180 до +66 В', '—', '—', '—'],
    ['64', '460 В (совпадение: ровно 180° за тик)', '413–420 В', '479 В', '≈ 479 В'],
    ['100', 'от −421 до +535 В', '390–498 В', '735–742 В', '≈ 737 В'],
    ['256', '—', '298–864 В', '1321–1443 В', '≈ 1380 В'],
  ];
  return (
    <div className="power-note">
      <p>
        <b>Диоды EE не успевают за быстрым переменным током.</b> По коду диод на каждом расчёте ведёт себя так, будто
        напряжение на нём такое же, как на прошлом расчёте, а цепь на сервере считается{' '}
        <b>
          <Val s={micro} />
        </b>{' '}
        раз за тик (настройка <code>simulation.microTicks</code>). Пока фаза между расчётами сдвигается мало, всё
        хорошо; если сильно — диоды открываются невпопад, и напряжение на выходе скачет и даже меняет знак. Это свойство
        самих диодов EE (проверено: блоки аддона версии 1.0 и мост из шести отдельных диодов EE дали одинаковые числа до
        вольта). Блоки аддона с версии 1.1 диодов не содержат и этим не страдают (способ 4).
      </p>
      <p>
        Сдвиг фазы за расчёт = {hzPerRpm ? num(degreesPerStep(1, hzPerRpm, 1), 4) : '—'}° × об/мин / microTicks. До{' '}
        {GOOD_STEP}° — выход ровный, до {OK_STEP}° — терпимо (просадка или разброс в несколько процентов), больше —
        выпрямитель не работает. Например, 64 об/мин требуют microTicks ≥ {hzPerRpm ? microTicksFor(64, hzPerRpm) : '—'}
        , 256 об/мин — максимум {MAX_MICRO} (тогда {hzPerRpm ? num(degreesPerStep(256, hzPerRpm, MAX_MICRO), 1) : '—'}°,
        терпимо).
      </p>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th className="num">об/мин</th>
              <th>microTicks = 1 (сейчас на сервере)</th>
              <th>8</th>
              <th>32</th>
              <th>как должно быть</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]}>
                {r.map((c, i) => (
                  <td key={i} className={i === 0 ? 'num' : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        Замер: ротор с 4 статорами, трёхфазный узел, трёхфазный выпрямитель, нагреватель 45 Ом; напряжение на выходе
        каждый тик, 60 тиков. Что делать:
      </p>
      <ul className="small">
        <li>
          <b>Хосту</b> — поднять <code>microTicks</code> в <code>serverconfig/electroenergetics-server.toml</code>{' '}
          (раздел <code>[simulation]</code>, 1–32). Мод помечает настройку как экспериментальную: вся электросеть EE
          считается во столько раз чаще, это нагрузка на сервер (TPS) — поднимать постепенно и смотреть.
        </li>
        <li>
          <b>Без настройки</b> — постоянный ток брать с обычного щёточного узла (способ 1), а трёхфазный узел держать на
          малых оборотах (до ~4 об/мин при microTicks = 1).
        </li>
        <li>
          Однофазный мост пульсирует и при большом microTicks — это не сбой, а сама схема (дважды за период до нуля);
          вольтметр EE усредняет всего два последних расчёта, поэтому прыгает и он. Нужен конденсатор.
        </li>
      </ul>
    </div>
  );
}

/** Как ведёт себя открытый диод EE при токе — по коду (точка линеаризации не выше clamp) и по симуляции */
function DiodeNote({ data }: { data: PowerData }) {
  const d = data.ee?.diode;
  if (!d?.clamp) return null;
  const r = diodeResistance(d);
  return (
    <p className="power-note">
      <b>Диоды EE — не идеальные.</b> До ~{num(d.saturation * (Math.exp(d.clamp / d.thermal) - 1) * 1000, 0)} мА —
      обычный диод, а дальше мод не сдвигает рабочую точку выше {num(d.clamp, 1)} В, и диод ведёт себя как{' '}
      {num(d.clamp, 1)} В плюс резистор около <b>{num(r, 1)} Ом</b>. На пути тока в мосте два диода — около{' '}
      {num(2 * r, 0)} Ом последовательно: помпе (2–3 А) это 25–35 В потерь, а мощной нагрузке (десятки ампер) мост из
      диодов EE не годится. Проверено и по коду, и в симуляции EE (2,78 А → 16,4 В на диоде).
    </p>
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
  const [stators, setStators] = useState(2);
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
    magnetsPerStator: rotor.magnetsPerStator,
    baseMagnets: rotor.baseMagnets,
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
      {kind.startsWith('bridge') && step > GOOD_STEP && (
        <p className={cx('small', step > OK_STEP ? 'power-bad' : 'faint')}>
          Фаза за расчёт сдвигается на {num(step, 1)}° —{' '}
          {step > OK_STEP
            ? 'диоды EE не успевают, на деле выход будет скакать (см. выше), график ниже — идеальный мост'
            : 'на грани, возможна просадка на несколько процентов'}
          . Нужно microTicks ≥ {microTicksFor(rpm, hzPerRpm)}.
        </p>
      )}
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
function TickChart({
  speeds,
  max,
  step,
  what = 'Скорость помпы',
  unit = '',
}: {
  speeds: number[];
  max: number;
  step: number;
  what?: string;
  unit?: string;
}) {
  const w = 400;
  const h = 90;
  const bw = w / speeds.length;
  return (
    <figure className="power-figure">
      <svg viewBox={`0 0 ${w} ${h + 16}`} role="img" aria-label={`${what} по тикам`}>
        <line x1={0} y1={h} x2={w} y2={h} className="power-axis" />
        {speeds.map((s, i) => {
          const bh = max > 0 ? (Math.max(0, s) / max) * h : 0;
          return (
            <rect key={i} x={i * bw + 2} y={h - bh} width={bw - 4} height={Math.max(bh, 0.5)} className="power-bar">
              <title>
                тик {i + 1}: {num(s)}
                {unit}
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
        {what} на каждом тике секунды (столбик во всю высоту — {num(max)}
        {unit}). Фаза за тик поворачивается на {num(step % 360, 1)}°
        {step >= 360 ? ` (ещё ${Math.floor(step / 360)} полных оборота)` : ''}.
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
  const width = pumpX + 76;
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
        <rect x={pumpX - 32} y={mid - 18} width={64} height={36} rx={4} className="power-load" />
        <text x={pumpX} y={mid + 4} textAnchor="middle" className="power-svg-text">
          нагрузка
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

// ---------------------------------------------------------------- линия через трансформаторы

/** Названия видов проводов EE; декоративные и творческий в статью не идут */
const WIRE_LABEL: Record<string, string> = {
  standard: 'Изолированный медный',
  copper: 'Медный голый',
  heavily_insulated: 'Высокоизолированный',
  bundle_conductor: 'Двухпроводной кабель (жила)',
  electrum: 'Электрумовый голый',
  iron: 'Железный кабель',
  iron_bus: 'Железная шина',
  iron_rail: 'Контактный рельс',
};

interface WireRow {
  w: EeWire;
  label: string;
  ohmPerM: number | null;
  insulation: number;
  maxTemp: number;
  span: number | null;
  /** Длительный ток: дольше — сгорит; с warn — начнёт искрить */
  maxI: number;
  warnI: number;
}

function wireRows(data: PowerData, ee: Get, h: HeatModel): WireRow[] {
  const d = data.ee?.wireDefault ?? {};
  return (data.ee?.wires ?? [])
    .filter((w) => WIRE_LABEL[w.name] && !w.decorative)
    .map((w) => {
      const maxTemp = wireValue(w.maxTemperature, ee, d.maxTemperature) ?? 0;
      const infinite = !Number.isFinite(maxTemp) || maxTemp > 1e12;
      return {
        w,
        label: WIRE_LABEL[w.name],
        ohmPerM: wireValue(w.resistance, ee),
        insulation: wireValue(w.maxInsulationVoltage, ee, d.maxInsulationVoltage) ?? 0,
        maxTemp,
        // У жилы кабеля длину пролёта задаёт оболочка (кабель двухпроводной) — у жилы её нет
        span: w.name === 'bundle_conductor' ? (ee('bundledWireLength')?.value ?? null) : wireValue(w.maxLength, ee),
        maxI: infinite ? Infinity : Math.min(h.maxCurrent, maxSteadyHeat(maxTemp, h)),
        warnI: infinite ? Infinity : Math.min(h.maxCurrent, maxSteadyHeat(maxTemp * h.warn, h)),
      };
    });
}

function LineGuide({ data, ee }: { data: PowerData; ee: Get }) {
  const h = data.ee?.wireHeat;
  const tr = data.ee?.transformer;
  const core = data.ee?.core;
  const rod = data.ee?.groundRod;
  if (!h) return <div className="empty">Данные о проводах не собраны — выполните npm run mods</div>;
  const rows = wireRows(data, ee, h);
  const trMax = tr ? Math.min(tr.heatCap, tr.heatDivisor * maxSteadyHeat(tr.breakTemp, h)) : null;
  const coreLoad = core ? maxSteadyHeat(core.breakTemp, h) / core.heatPerLoad : null;
  const ratios = tr ? transformerRatios(tr.ratios) : [];
  const fmtLimit = (v: number) => (Number.isFinite(v) ? `${num(v)} А` : 'не греется');

  return (
    <article className="ref-card power-article">
      <h2 className="power-h">Линия на дальнее расстояние через трансформаторы</h2>
      <div className="power-note">
        <b>Коротко.</b> Потери в проводе растут как квадрат тока, а провод греется и рвётся тоже от тока. Поэтому
        мощность далеко везут на высоком напряжении: у генератора — повышающий трансформатор, у потребителей —
        понижающий. Поднять напряжение в k раз — ток падает в k раз, потери в k² раз. Выше{' '}
        <Val s={ee('Voltages.wireMaxVoltage')} unit="В" /> обычный изолированный провод не годится: нужен
        высокоизолированный (до <Val s={ee('Voltages.heavilyInsulatedWireMaxVoltage')} unit="В" />) или голый на опорах.
      </div>

      <LineDiagram />

      <h3>Почему ток, а не напряжение</h3>
      <p>
        Мощность = напряжение × ток. Провод — это сопротивление: на нём теряется I² × R ватт и падает I × R вольт.
        Сопротивление провода — Ом на метр × длина, а у линии из двух проводов (туда и обратно) — вдвое больше. Та же
        мощность на вдесятеро большем напряжении идёт вдесятеро меньшим током и теряет в сто раз меньше.
      </p>

      <h3>Провода</h3>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>Провод</th>
              <th className="num">Ом на 100 м</th>
              <th className="num">Изоляция до</th>
              <th className="num">Пролёт до</th>
              <th className="num">Искрит с</th>
              <th className="num">Длительно до</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.w.name}>
                <td>
                  <span className="power-name">
                    {(r.w.spool || r.w.item) && <ItemIcon id={(r.w.spool || r.w.item)!} size={20} />}
                    {r.label}
                  </span>
                </td>
                <td className="num">{r.ohmPerM !== null ? num(r.ohmPerM * 100, 2) : '—'}</td>
                <td className="num">{r.insulation > 0 ? `${num(r.insulation)} В` : 'голый'}</td>
                <td className="num">{r.span !== null ? `${num(r.span)} м` : '—'}</td>
                <td className="num">{fmtLimit(r.warnI)}</td>
                <td className="num">{fmtLimit(r.maxI)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="small">
        <li>
          <b>Греется провод только от тока</b> — длина и сопротивление на нагрев не влияют. С {num(h.warn * 100)} %
          предела температуры провод искрит, на пределе сгорает. Изолированный медный, перегревшись, превращается в
          голый медный (изоляция сгорает), высокоизолированный — тоже.
        </li>
        <li>
          <b>Изоляция</b> защищает от удара током, пока напряжение не выше её предела; выше — провод бьёт током так же,
          как голый. Голый бьёт всегда. От перенапряжения провод не рвётся. Поражение током на сервере включено
          (настройка enableElectrocution).
        </li>
        <li>
          Жила двухпроводного кабеля по коду не перегревается вообще (предел не задан), но изоляция у неё как у обычного
          изолированного. В игре не проверялось.
        </li>
        <li>Параллельные провода делят ток: два провода вместо одного — каждому вдвое меньше.</li>
      </ul>

      <h3>Возврат через землю</h3>
      <p>
        Заземляющий стержень соединяет контакт с общей землёй через {rod ? num(rod.resistance) : '—'} Ом. Можно вести
        один провод, а обратно ток пойдёт через землю: стержень у генератора и стержень у потребителей. Это вдвое меньше
        провода, но добавляет {rod ? num(rod.resistance * 2) : '—'} Ом на двух стержнях. По коду; в игре не проверялось.
      </p>

      <h3>Трансформаторы</h3>
      <div className="power-outs">
        <div className="power-out">
          <span className="power-name">
            <ItemIcon id="electroenergetics:transformer" size={20} />
            <b>Трансформатор (один блок)</b>
          </span>
          <span className="small">
            Соотношение — шкалой, от {ratios[0]?.label ?? '—'} до {ratios.at(-1)?.label ?? '—'}. Длительно держит около{' '}
            <b>{trMax ? watts(trMax) : '—'}</b>, больше — греется и в итоге сгорает (пропадает).
          </span>
        </div>
        <div className="power-out">
          <span className="power-name">
            <ItemIcon id="electroenergetics:transformer_core" size={20} />
            <b>Магнитопровод (два блока лицом друг к другу)</b>
          </span>
          <span className="small">
            У каждой катушки {core?.turnsMin ?? '—'}–{core?.turnsMax ?? '—'} витков (по умолчанию{' '}
            {core?.turnsDefault ?? '—'}), напряжения относятся как витки. Мощность задаёт охлаждение:{' '}
            {core ? watts(core.base) : '—'} × (1 + охладители), × {core ? num(core.noOil, 1) : '—'} за каждую сторону
            без трансформаторного масла. Выше этого (с запасом {coreLoad ? num((coreLoad - 1) * 100, 1) : '—'} %) —
            греется и <b>взрывается</b> (сила взрыва {core?.explosion ?? '—'}).
          </span>
        </div>
      </div>
      {core && (
        <p className="small">
          Охладители — блоки в радиусе {core.radius} блоков, связанные с магнитопроводом через воду или масло:
          радиаторная панель, промышленное и выветренное железо Create, листовые панели CDG, блоки железа, стали, цинка
          и андезитового сплава (тег из мода). Каждый добавляет 1 / √расстояние: вплотную — +1, через блок — около +0,7.
          Пример: в масле с обеих сторон и без радиаторов — {watts(core.base)}; без масла —{' '}
          {watts(core.base * core.noOil * core.noOil)}.
        </p>
      )}

      <h3>Как собрать</h3>
      <ol>
        <li>У генератора — повышающий трансформатор: вход к щёточному узлу, выход — на линию.</li>
        <li>
          Линию — проводом, который выдержит и напряжение (изоляция), и ток (таблица выше). Длинную — через опоры:
          пролёт не длиннее предела провода.
        </li>
        <li>У потребителей — понижающий трансформатор с обратным соотношением.</li>
        <li>
          Каждый трансформатор пропускает всю мощность линии: если нужно больше {trMax ? watts(trMax) : '—'} —
          магнитопровод с маслом и радиаторами.
        </li>
        <li>
          Предохранитель на линию — с током срабатывания ниже предела провода, чтобы при перегрузке сгорел он, а не
          линия (как предохранитель считает ток, по коду ещё не разбирали).
        </li>
      </ol>

      <LineCalc rows={rows} data={data} h={h} trMax={trMax} coreLoad={coreLoad} />

      <h3>Что проверено</h3>
      <ul className="faint small">
        <li>
          По коду мода: сопротивление, пределы изоляции, длины пролётов и пределы температуры каждого провода; нагрев
          провода током и общая формула нагрева; перегретый провод заменяется голым; поражение током выше предела
          изоляции; шкала и нагрев одноблочного трансформатора; витки, охлаждение (масло, охладители, радиус) и взрыв
          магнитопровода; заземляющий стержень 1 Ом.
        </li>
        <li>
          Не проверено: в игре — ничего; какая сторона одноблочного трансформатора вход (смотрите понд); точная формула
          опасного расстояния у голого провода (по коду от 0,1 до 3 блоков, растёт с напряжением); что нагревом проводов
          управляет один расчёт за тик, как у остальной цепи.
        </li>
      </ul>
    </article>
  );
}

function LineCalc({
  rows,
  data,
  h,
  trMax,
  coreLoad,
}: {
  rows: WireRow[];
  data: PowerData;
  h: HeatModel;
  trMax: number | null;
  coreLoad: number | null;
}) {
  const [power, setPower] = useState(20);
  const [volts, setVolts] = useState(300);
  const [length, setLength] = useState(1000);
  const [wire, setWire] = useState('heavily_insulated');
  const [ground, setGround] = useState(false);
  const [k, setK] = useState(10);
  const core = data.ee?.core;
  const rod = data.ee?.groundRod;
  const row = rows.find((r) => r.w.name === wire) ?? rows[0];
  if (!row || row.ohmPerM === null) return null;

  const p = power * 1000;
  const calc = (kk: number) => {
    const u = volts * kk;
    const r = length * row.ohmPerM! * (ground ? 1 : 2) + (ground && rod ? rod.resistance * 2 : 0);
    const i = p / u;
    const loss = i * i * r;
    return { u, r, i, loss, drop: i * r };
  };
  const c = calc(k);
  const flat = calc(1);
  const temp = Number.isFinite(row.maxTemp) && row.maxTemp < 1e12 ? steadyTemp(Math.min(h.maxCurrent, c.i), h) : 0;
  const burn = row.maxI < Infinity ? stepsToTemp(Math.min(h.maxCurrent, c.i), row.maxTemp, h) : null;
  const spans = row.span ? Math.ceil(length / row.span) : null;
  // Наименьшее k: ток без искр, потери ≤ 5 %, напряжение в пределах изоляции (если провод изолирован)
  const best = (() => {
    for (let kk = 1; kk <= 100; kk += kk < 10 ? 0.5 : 1) {
      const x = calc(kk);
      if (x.i <= row.warnI && x.loss <= p * 0.05 && (row.insulation <= 0 || x.u <= row.insulation)) return kk;
    }
    return null;
  })();
  const coreNeed = core && coreLoad ? p / (core.base * coreLoad) : null;
  const overInsulation = row.insulation > 0 && c.u > row.insulation;

  return (
    <section className="power-calc">
      <h3>Калькулятор линии</h3>
      <div className="power-form">
        <NumField
          label="Мощность потребителей"
          value={power}
          onChange={setPower}
          min={0.1}
          max={10000}
          step={1}
          unit="кВт"
        />
        <NumField
          label="Напряжение генератора и потребителей"
          value={volts}
          onChange={setVolts}
          min={1}
          max={20000}
          unit="В"
        />
        <NumField label="Длина линии" value={length} onChange={setLength} min={1} max={100000} unit="м" />
        <label className="power-field">
          <span className="faint small">Провод</span>
          <select className="input" value={row.w.name} onChange={(e) => setWire(e.target.value)}>
            {rows.map((r) => (
              <option key={r.w.name} value={r.w.name}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="power-field">
          <span className="faint small">Обратный путь</span>
          <select
            className="input"
            value={ground ? 'ground' : 'wire'}
            onChange={(e) => setGround(e.target.value === 'ground')}
          >
            <option value="wire">Второй провод</option>
            <option value="ground">Земля (два стержня)</option>
          </select>
        </label>
        <NumField label="Повышение напряжения" value={k} onChange={setK} min={1} max={100} step={0.5} unit="×" />
      </div>
      <div className="power-outs">
        <div className="power-out">
          <span className="faint small">Напряжение линии</span>
          <b className={cx(overInsulation && 'power-bad')}>{num(c.u)} В</b>
          <span className={cx('small', overInsulation ? 'power-bad' : 'faint')}>
            {row.insulation <= 0
              ? 'голый провод — бьёт током при касании'
              : overInsulation
                ? `выше изоляции (${num(row.insulation)} В) — бьёт током`
                : `изоляция до ${num(row.insulation)} В`}
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Ток в проводе</span>
          <b className={cx(c.i > row.maxI && 'power-bad')}>{num(c.i, 1)} А</b>
          <span className={cx('small', c.i > row.warnI ? 'power-bad' : 'faint')}>
            {c.i > row.maxI
              ? `сгорит${burn ? ` через ~${num(burn / 20)} с` : ''}`
              : c.i > row.warnI
                ? 'искрит, но держит'
                : row.maxI < Infinity
                  ? `нагрев ${num((temp / row.maxTemp) * 100)} % предела`
                  : 'не перегревается'}
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Потери в линии</span>
          <b className={cx(c.loss > p * 0.1 && 'power-bad')}>{watts(c.loss)}</b>
          <span className="faint small">
            {num((c.loss / (p + c.loss)) * 100, 1)} % · сопротивление {num(c.r, 2)} Ом
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Падение напряжения</span>
          {/* Больше U² / 4R через сопротивление R не передать: напряжение у потребителей падает до нуля */}
          {p > (c.u * c.u) / (4 * c.r) ? (
            <>
              <b className="power-bad">не передаст</b>
              <span className="small power-bad">
                линия пропустит не больше {watts((c.u * c.u) / (4 * c.r))} — поднимите напряжение
              </span>
            </>
          ) : (
            <>
              <b>{num(c.drop, 1)} В</b>
              <span className="faint small">у потребителей ≈ {num((c.u - c.drop) / k)} В</span>
            </>
          )}
        </div>
        <div className="power-out">
          <span className="faint small">Без трансформаторов было бы</span>
          <b>{num(flat.i, 1)} А</b>
          <span className="faint small">
            потери {watts(flat.loss)} ({num((flat.loss / (p + flat.loss)) * 100, 1)} %)
          </span>
        </div>
        {spans !== null && (
          <div className="power-out">
            <span className="faint small">Пролётов (опор)</span>
            <b>{num(spans)}</b>
            <span className="faint small">пролёт до {num(row.span!)} м</span>
          </div>
        )}
        <div className="power-out">
          <span className="faint small">Трансформаторы на {watts(p)}</span>
          <b>{trMax && p <= trMax ? 'хватит одноблочных' : 'нужен магнитопровод'}</b>
          <span className="faint small">
            {trMax && p <= trMax
              ? `одноблочный держит ~${watts(trMax)}`
              : coreNeed
                ? `охлаждение ≥ ${num(coreNeed, 2)} (в масле с обеих сторон без радиаторов — 1)`
                : ''}
            {k > 50 ? '; повышение больше 50 — только магнитопроводом' : ''}
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Подходит повышение</span>
          <b>{best !== null ? `от ${num(best, 1)}×` : 'не подобрать'}</b>
          <span className="faint small">
            {best !== null
              ? 'без искр, потери ≤ 5 %, в пределах изоляции'
              : 'этот провод не выдержит — возьмите другой или второй параллельно'}
          </span>
        </div>
      </div>
      <p className="faint small">
        Трансформаторы считаются идеальными (по коду у них нет потерь), нагрузка — постоянной мощностью. Падение
        напряжения на линии потребители почувствуют: двигатель отдаёт меньше SU, помпа крутится медленнее.
      </p>
    </section>
  );
}

function LineDiagram() {
  const box = (x: number, label: string, sub?: string) => (
    <g>
      <rect x={x} y={30} width={96} height={40} rx={5} className="power-load" />
      <text x={x + 48} y={sub ? 47 : 54} textAnchor="middle" className="power-svg-text">
        {label}
      </text>
      {sub && (
        <text x={x + 48} y={62} textAnchor="middle" className="power-svg-text power-svg-sub">
          {sub}
        </text>
      )}
    </g>
  );
  return (
    <figure className="power-figure power-figure-wide">
      <svg
        viewBox="0 0 640 100"
        role="img"
        aria-label="Схема линии: генератор, повышающий трансформатор, линия, понижающий трансформатор, потребители"
      >
        <line x1={96} y1={50} x2={140} y2={50} className="power-wire" />
        <line x1={236} y1={50} x2={404} y2={50} className="power-wire power-hv" />
        <line x1={500} y1={50} x2={544} y2={50} className="power-wire" />
        {box(0, 'генератор', '300 В')}
        {box(140, 'повышающий', '1:10')}
        <text x={320} y={42} textAnchor="middle" className="power-svg-text">
          линия, 3000 В, ток ÷10
        </text>
        <text x={320} y={68} textAnchor="middle" className="power-svg-text power-svg-sub">
          потери ÷100
        </text>
        {box(404, 'понижающий', '10:1')}
        {box(544, 'потребители', '300 В')}
      </svg>
    </figure>
  );
}

// ---------------------------------------------------------------- первый генератор

function useAlternatorParams(data: PowerData, ee: Get): AlternatorParams | null {
  const powerMult = ee('rotor.rotorPowerMultiplier');
  const stressMult = ee('rotor.rotorStressMultiplier');
  const fullLoad = ee('rotor.rotorFullLoadCurrent');
  const rotor = data.ee?.rotor;
  if (!powerMult || !stressMult || !fullLoad || !rotor) return null;
  return {
    powerMult: powerMult.value,
    stressMult: stressMult.value,
    fullLoadCurrent: fullLoad.value,
    magnetsPerStator: rotor.magnetsPerStator,
    baseMagnets: rotor.baseMagnets,
  };
}

function GeneratorGuide({ data, ee }: { data: PowerData; ee: Get }) {
  const p = useAlternatorParams(data, ee);
  const rotor = data.ee?.rotor;
  const powerMult = ee('rotor.rotorPowerMultiplier');
  const fullLoad = ee('rotor.rotorFullLoadCurrent');
  const perStator = p ? p.magnetsPerStator * p.powerMult : null;
  const one = p ? alternator(4, 1, p, 1) : null;

  return (
    <article className="ref-card power-article">
      <h2 className="power-h">Первый генератор: статоры, обороты, напряжение</h2>
      <div className="power-note">
        <b>Коротко.</b> Вал Create крутит роторы, вокруг каждого ротора до {rotor?.sides ?? 4} статоров, на конце —
        щёточный узел с контактами. Каждый статор даёт <b>{perStator ? num(perStator) : '—'} Вт за 1 об/мин</b>, а вал
        платит за это примерно <b>1 SU за 1 Вт</b> — всегда, даже если ничего не подключено. Напряжение без нагрузки =
        выработка / <Val s={fullLoad} unit="А" />: например, ротор с четырьмя статорами на 64 об/мин —{' '}
        {p ? num(alternator(4, 64, p, 1).emf) : '—'} В и {p ? watts(alternator(4, 64, p, 1).power) : '—'}.
      </div>

      <GeneratorDiagram />

      <h3>Как собрать</h3>
      <ol>
        <li>
          <span className="power-name">
            <ItemIcon id="electroenergetics:alternator_rotor" size={20} />
            Роторы
          </span>{' '}
          — на одну ось, вплотную друг к другу, как валы. Вращение подаётся на крайний ротор валом Create.
        </li>
        <li>
          <span className="power-name">
            <ItemIcon id="electroenergetics:stator" size={20} />
            Статоры
          </span>{' '}
          — по четырём сторонам ротора поперёк оси (сверху, снизу, по бокам), каждый должен <b>смотреть на ротор</b> и
          быть повёрнут под его ось. По коду статор при установке смотрит в ту сторону, грань которой вы кликнули, —
          поэтому удобнее ставить его снаружи (кликом по опоре за ним) или доворачивать ключом Create; ключ по той же
          оси меняет крен. Когда все четыре статора вокруг ротора встали правильно, они меняют вид на сплошной кожух.
          Неправильно повёрнутый статор ничего не даёт.
        </li>
        <li>
          <span className="power-name">
            <ItemIcon id="electroenergetics:alternator_brushes" size={20} />
            Щёточный узел
          </span>{' '}
          — на конце ряда роторов, той же осью. Он собирает до {rotor?.maxRotors ?? '—'} роторов подряд за собой; ротор
          с другой осью обрывает ряд. Второй узел на другом конце ряда по коду объединяется с первым — те же роторы, ещё
          одна пара контактов, выработка не удваивается. Трёхфазный узел ставится так же и считает выработку так же.
        </li>
        <li>Контакты узла (два у обычного, четыре у трёхфазного) — провода к потребителям.</li>
      </ol>

      <h3>От чего зависит</h3>
      <ul>
        <li>
          <b>Выработка</b> = статоры × {rotor?.magnetsPerStator ?? '—'} × <Val s={powerMult} unit="Вт" /> × об/мин.
          Статоры можно делить между роторами как угодно — важна сумма. Обороты — сколько даёт вал (до 256 у Create).
        </li>
        <li>
          <b>Нагрузка на вал</b> — почти столько же SU, сколько ватт выработки, плюс{' '}
          {p ? num(p.baseMagnets * p.powerMult * p.stressMult, 2) : '—'} SU за 1 об/мин на каждый ротор, даже пустой. От
          потребления не зависит: генератор без потребителей грузит вал так же. Не хватает SU у источника — вал встаёт,
          и генератор не даёт ничего.
        </li>
        <li>
          <b>Напряжение</b> = выработка / <Val s={fullLoad} unit="А" /> — то есть генератор рассчитан на ток{' '}
          <Val s={fullLoad} unit="А" />. Потребители берут меньше — напряжение держится. Больше — генератор отдаёт не
          больше своей выработки, и напряжение проседает: на тестовом сервере короткое замыкание опустило 17,3 В до 8,1
          В.
        </li>
        <li>
          Нужно напряжение выше, а мощности хватает — не добавляйте статоры, поставьте повышающий трансформатор (гайд
          «Линия на дальнее расстояние»). Нужна мощность — больше статоров или оборотов.
        </li>
      </ul>
      {one && (
        <p className="power-note">
          Вечного двигателя нет: генератор отдаёт около {num(one.power / one.stress, 2)} Вт с 1 SU, а двигатель EE на
          полной нагрузке берёт {data.ee?.motor ? num(1 / data.ee.motor.loadedFactor, 2) : '—'} Вт за 1 SU — цепочка
          «вал → генератор → двигатель → вал» теряет около{' '}
          {data.ee?.motor ? num((1 - (one.power / one.stress) * data.ee.motor.loadedFactor) * 100) : '—'} %.
        </p>
      )}

      {p && <GeneratorPlanner p={p} maxRotors={rotor?.maxRotors ?? null} />}

      <h3>Что проверено</h3>
      <ul className="faint small">
        <li>
          На тестовом сервере (без игрока, сборка Create 6.0.10 и Electro Energetics 1.1.2): два ротора, у первого 4
          статора, у второго 2, творческий мотор 64 об/мин — узел показал 552,96 В и 55 296 Вт, роторы — 582 и 294 SU на
          1 об/мин, ровно по формулам выше. Под нагрузкой 45 Ом напряжение почти не просело (551 В); короткое замыкание
          на 2 об/мин — 17,3 → 8,1 В.
        </li>
        <li>
          По коду мода: статор считается, только если смотрит на ротор и повёрнут под его ось; узел собирает до{' '}
          {rotor?.maxRotors ?? '—'} роторов; второй узел на другом конце объединяется с первым; трёхфазный узел считает
          так же; как ставится статор.
        </li>
        <li>Не проверено: в игре — ничего, в том числе как удобнее ставить статоры.</li>
      </ul>
    </article>
  );
}

/** Подбор генератора: нужное напряжение и мощность при оборотах вала → статоры, роторы, SU */
function GeneratorPlanner({ p, maxRotors }: { p: AlternatorParams; maxRotors: number | null }) {
  const [volts, setVolts] = useState(240);
  const [rpm, setRpm] = useState(64);
  const [load, setLoad] = useState(5);
  const need = load * 1000;
  // Статоров — чтобы хватило и напряжения, и мощности (мощность при токе полной нагрузки)
  const byVolts = statorsFor(volts, rpm, p);
  const byPower = Math.ceil(need / (p.magnetsPerStator * p.powerMult * Math.max(1, rpm)));
  const stators = Math.max(byVolts, byPower, 1);
  const rotors = Math.ceil(stators / 4);
  const g = alternator(stators, rpm, p, rotors);
  const brushes = maxRotors ? Math.ceil(rotors / maxRotors) : 1;
  const current = g.emf > 0 ? need / g.emf : 0;
  // Если по мощности статоров больше, чем по напряжению, — напряжение выше нужного: понизить трансформатором
  const k = g.emf / volts;
  return (
    <section className="power-calc">
      <h3>Калькулятор: какой генератор нужен</h3>
      <div className="power-form">
        <NumField label="Нужное напряжение" value={volts} onChange={setVolts} min={1} max={50000} unit="В" />
        <NumField
          label="Потребители берут"
          value={load}
          onChange={setLoad}
          min={0}
          max={100000}
          step={0.5}
          unit="кВт"
        />
        <NumField label="Обороты вала" value={rpm} onChange={setRpm} min={1} max={256} unit="об/мин" />
      </div>
      <div className="power-outs">
        <div className="power-out">
          <span className="faint small">Статоров</span>
          <b>{num(stators)}</b>
          <span className="faint small">
            на {num(rotors)} {rotors === 1 ? 'роторе' : 'роторах'}
            {brushes > 1 ? ` — это ${brushes} генератора: на узел до ${maxRotors} роторов` : ''}
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Напряжение без нагрузки</span>
          <b>{num(g.emf, 1)} В</b>
          {k > 1.05 && (
            <span className="faint small">
              {byPower > byVolts
                ? `выше нужного: статоров столько ради мощности — понизьте трансформатором примерно ${num(k, 1)}:1`
                : `статоров — целое число; ровно ${num(volts)} В даст вал на ${num((volts * p.fullLoadCurrent) / (stators * p.magnetsPerStator * p.powerMult), 1)} об/мин`}
            </span>
          )}
        </div>
        <div className="power-out">
          <span className="faint small">Выработка</span>
          <b>{watts(g.power)}</b>
          <span className="faint small">
            ток потребителей {num(current, 1)} А из {num(p.fullLoadCurrent)}
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Нагрузка на вал</span>
          <b>{num(g.stress)} SU</b>
          <span className="faint small">всегда, даже без потребителей</span>
        </div>
      </div>
    </section>
  );
}

/** Вид сбоку: вал → роторы со статорами → щёточный узел → провода */
function GeneratorDiagram() {
  const cell = 40;
  const y = 50;
  const rotors = [1, 2, 3];
  return (
    <figure className="power-figure">
      <svg viewBox="0 0 420 130" role="img" aria-label="Схема генератора сбоку">
        <line x1={10} y1={y + cell / 2} x2={80} y2={y + cell / 2} className="power-wire" />
        <text x={10} y={y + cell / 2 - 8} className="power-svg-text">
          вал Create
        </text>
        {rotors.map((i) => {
          const x = 40 + i * cell;
          return (
            <g key={i}>
              <rect x={x} y={y - cell} width={cell - 2} height={cell - 4} className="power-box power-box-soft" />
              <rect x={x} y={y} width={cell - 2} height={cell - 2} className="power-box" />
              <rect x={x} y={y + cell + 2} width={cell - 2} height={cell - 4} className="power-box power-box-soft" />
              <text x={x + cell / 2 - 1} y={y + cell / 2 + 4} textAnchor="middle" className="power-svg-text">
                Р
              </text>
              <text x={x + cell / 2 - 1} y={y - cell / 2 + 2} textAnchor="middle" className="power-svg-text">
                С
              </text>
              <text x={x + cell / 2 - 1} y={y + cell * 1.5 + 2} textAnchor="middle" className="power-svg-text">
                С
              </text>
            </g>
          );
        })}
        <rect x={40 + 4 * cell} y={y} width={cell - 2} height={cell - 2} className="power-box" />
        <text x={40 + 4.5 * cell - 1} y={y + cell / 2 + 4} textAnchor="middle" className="power-svg-text">
          Щ
        </text>
        <line x1={40 + 5 * cell} y1={y + 10} x2={400} y2={y + 10} className="power-wire" />
        <line x1={40 + 5 * cell} y1={y + 28} x2={400} y2={y + 28} className="power-wire" />
        <text x={400} y={y + 4} textAnchor="end" className="power-svg-text">
          к потребителям
        </text>
      </svg>
      <figcaption className="faint small">
        Р — ротор, С — статоры (ещё по одному с каждой стороны, на рисунке не видны), Щ — щёточный узел. Статоры смотрят
        на ротор.
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- преобразователь EE ↔ FE

function ConverterGuide({ data, ee, ie }: { data: PowerData; ee: Get; ie: Get }) {
  const rate = ee('wattFeTConversionRate');
  const convKw = ee('converterMaxPower');
  const conv = data.ee?.converter;
  const m = data.ee?.motor;
  const p = useAlternatorParams(data, ee);
  const one = p ? alternator(4, 1, p, 1) : null;
  const suPerFe = rate && one ? (rate.value * one.stress) / one.power : null;
  const suFromFe = rate && m ? rate.value * m.loadedFactor : null;

  return (
    <article className="ref-card power-article">
      <h2 className="power-h">Из EE в IE и обратно: преобразователь</h2>
      <div className="power-note">
        <b>Коротко.</b>{' '}
        <span className="power-name">
          <ItemIcon id="electroenergetics:converter" size={20} />
          Преобразователь электроэнергии
        </span>{' '}
        — единственный мост между электричеством EE и FE Immersive Engineering. Курс на сервере:{' '}
        <b>
          1 FE/t = <Val s={rate} unit="Вт" />
        </b>
        . Провода EE — к двум его контактам, FE — <b>только через заднюю грань</b>, и туда удобнее всего ставить
        коннектор IE. Режим (из EE в FE или из FE в EE) переключается ключом Create по <b>боковой</b> грани; ключ по
        передней или задней грани поворачивает блок.
      </div>

      <h3>Как он работает с FE</h3>
      <ul>
        <li>
          Преобразователь сам <b>забирает</b> FE из блока за задней гранью (режим «из IE в EE») или сам <b>отдаёт</b> в
          него (режим «из EE в IE»). Блоки, которые сами толкают энергию соседям — генераторы IE и т. п., — в него
          ничего не положат: по коду он не принимает энергию, которую ему отдают.
        </li>
        <li>
          Поэтому за задней гранью — <b>коннектор IE</b> (LV, MV или HV), повешенный на преобразователь: из него
          преобразователь может и брать, и в него класть. Подходит и конденсатор IE — стороной, настроенной молотом на
          выход (брать) или на вход (класть). Машина IE прямо за задней гранью тоже будет получать FE.
        </li>
        <li>
          Буфер — <Val s={convKw} unit="кВт" /> за тик: больше этого один преобразователь не пропускает. Коннектор IE
          пропускает меньше (калькулятор ниже) — обычно узкое место он.
        </li>
      </ul>

      <h3>Из EE в IE (генератор Create → машины IE)</h3>
      <ol>
        <li>Генератор → провода EE → два контакта преобразователя.</li>
        <li>Ключом по боковой грани — режим, в котором он берёт энергию из сети EE.</li>
        <li>На заднюю грань — коннектор IE, от него — провод IE к машинам или конденсатору.</li>
      </ol>
      <p>
        В сети EE преобразователь — нагрузка с сопротивлением не меньше {conv?.minResistance ?? '—'} Ом, поэтому{' '}
        <b>мощность ограничена напряжением</b>: не больше U² / {conv?.minResistance ?? '—'}. При 240 В — не больше{' '}
        {conv ? watts((240 * 240) / conv.minResistance) : '—'}, для полного буфера{' '}
        {convKw && conv ? watts(convKw.value * 1000) : '—'} нужно{' '}
        {convKw && conv ? num(Math.sqrt(convKw.value * 1000 * conv.minResistance)) : '—'} В. Мало напряжения —
        повышающий трансформатор перед преобразователем. Когда IE не забирает FE, буфер заполняется, и преобразователь
        перестаёт брать ток.
      </p>

      <h3>Из IE в EE (генератор IE → электричество Create)</h3>
      <ol>
        <li>Сеть IE → коннектор на задней грани преобразователя.</li>
        <li>
          Ключом по боковой грани — режим, в котором он отдаёт энергию в сеть EE; шкалой на преобразователе —
          напряжение, 0–{num(conv?.voltageMax ?? 0)} В.
        </li>
        <li>Контакты преобразователя → провода EE → двигатели, нагреватели, помпы.</li>
      </ol>
      <p>
        Преобразователь держит выставленное напряжение, пока в буфере есть энергия, а буфер пополняет из IE не больше,
        чем пропускает коннектор. Потребители берут больше — буфер пустеет, и напряжение проседает.
      </p>

      {(suPerFe || suFromFe) && (
        <p className="power-note">
          Через всю цепочку: <b>Create → IE</b> — около {suPerFe ? num(suPerFe, 1) : '—'} SU на вал генератора за 1
          FE/t; <b>IE → Create</b> — двигатель EE на полной нагрузке даёт около {suFromFe ? num(suFromFe, 1) : '—'} SU
          за 1 FE/t (берёт {m ? num(1 / m.loadedFactor, 2) : '—'} Вт за 1 SU).
        </p>
      )}

      {rate && <ConverterPlanner data={data} ie={ie} rate={rate.value} conv={conv} convKw={convKw?.value ?? null} />}

      <h3>Что проверено</h3>
      <ul className="faint small">
        <li>
          По коду EE: курс FE и буфер — настройки сервера; FE только через заднюю грань, сам забирает или сам отдаёт,
          чужую отдачу не принимает; режим — ключом по боковой грани (по передней и задней — поворот); сопротивление
          потребителя не меньше {conv?.minResistance ?? '—'} Ом и растёт, когда буфер полон; источник — шкала 0–
          {num(conv?.voltageMax ?? 0)} В шагом {conv?.voltageStep ?? '—'}.
        </li>
        <li>
          По коду IE: коннектор отдаёт из своего запаса тому, кто забирает, и принимает от соседа не больше своего
          предела за тик; конденсатор отдаёт только стороной «выход», принимает — стороной «вход».
        </li>
        <li>
          Не проверено: в игре — ничего; в симуляции на тестовом сервере преобразователь не запускали (там нет IE);
          какая подсказка у режимов на самом блоке.
        </li>
      </ul>
    </article>
  );
}

function ConverterPlanner({
  data,
  ie,
  rate,
  conv,
  convKw,
}: {
  data: PowerData;
  ie: Get;
  rate: number;
  conv: NonNullable<PowerData['ee']>['converter'] | undefined;
  convKw: number | null;
}) {
  const [dir, setDir] = useState<'toIe' | 'toEe'>('toIe');
  const [kw, setKw] = useState(10);
  const [volts, setVolts] = useState(1000);
  const [wire, setWire] = useState('electrum');
  const div = data.ie?.connectorDivisor;
  const wires = data.ie?.wires ?? [];
  const w = wires.find((x) => x.name === wire) ?? wires[0];
  const connector = w ? (ie(`wires.${w.name}.wireConnectorInput`)?.value ?? (div ? w.transferRate / div : null)) : null;
  const p = kw * 1000;
  const fe = p / rate;
  const perConv = convKw ? convKw * 1000 : Infinity;
  // Из EE: ещё и предел U² / minR; в EE — напряжение задаёт сам преобразователь (до voltageMax)
  const vLimit = dir === 'toIe' && conv ? (volts * volts) / conv.minResistance : Infinity;
  const perOne = Math.min(perConv, vLimit, connector ? connector * rate : Infinity);
  const count = perOne > 0 ? Math.ceil(p / perOne) : Infinity;
  const vMax = conv?.voltageMax ?? Infinity;
  const tooHigh = dir === 'toEe' && volts > vMax;
  return (
    <section className="power-calc">
      <h3>Калькулятор</h3>
      <div className="power-form">
        <label className="power-field">
          <span className="faint small">Направление</span>
          <select className="input" value={dir} onChange={(e) => setDir(e.target.value as 'toIe' | 'toEe')}>
            <option value="toIe">Из EE в IE (преобразователь — потребитель)</option>
            <option value="toEe">Из IE в EE (преобразователь — источник)</option>
          </select>
        </label>
        <NumField label="Мощность" value={kw} onChange={setKw} min={0.1} max={100000} step={0.5} unit="кВт" />
        <NumField
          label={dir === 'toIe' ? 'Напряжение сети EE' : 'Напряжение на шкале'}
          value={volts}
          onChange={setVolts}
          min={10}
          max={50000}
          step={10}
          unit="В"
        />
        <label className="power-field">
          <span className="faint small">Коннектор IE</span>
          <select className="input" value={wire} onChange={(e) => setWire(e.target.value)}>
            {wires.map((x) => (
              <option key={x.name} value={x.name}>
                {IE_WIRE[x.name]?.short ?? x.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="power-outs">
        <div className="power-out">
          <span className="faint small">Это в FE</span>
          <b>{num(fe)} FE/t</b>
        </div>
        <div className="power-out">
          <span className="faint small">Один преобразователь с коннектором</span>
          <b>{watts(perOne)}</b>
          <span className="faint small">
            {perOne === vLimit
              ? `упирается в напряжение: U² / ${conv?.minResistance} Ом`
              : connector && perOne === connector * rate
                ? `упирается в коннектор: ${num(connector)} FE/t`
                : 'упирается в буфер преобразователя'}
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Нужно преобразователей</span>
          <b>{Number.isFinite(count) ? num(count) : '—'}</b>
          <span className="faint small">параллельно, у каждого свой коннектор</span>
        </div>
        <div className="power-out">
          <span className="faint small">Ток в проводах EE</span>
          <b>{num(p / volts, 1)} А</b>
          <span className={cx('small', tooHigh ? 'power-bad' : 'faint')}>
            {tooHigh
              ? `шкала преобразователя — до ${num(vMax)} В: выше — повышающим трансформатором`
              : 'по нему выбирайте провод (гайд про линию)'}
          </span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- оптимальный режим генератора

const REGIME: Record<AlternatorLoad['regime'], string> = {
  idle: 'без нагрузки',
  normal: 'нормальный: напряжение почти полное',
  overload: 'перегрузка: отдаёт всю выработку, напряжение просело',
  unstable: 'ток больше двух полных: режим вне модели, считать нельзя',
};

/** Подобрать трансформатор: соотношение «выход / вход», при котором потребители получат нужное напряжение */
function matchRatio(emf: number, power: number, consumerR: number, want: number, buffer: number) {
  let k = want / emf;
  for (let i = 0; i < 30; i++) {
    const l = alternatorLoad(emf, power, consumerR / (k * k), buffer);
    if (l.volts <= 0) break;
    k = want / l.volts;
  }
  return k;
}

function OptimalGuide({ data, ee, ie, att }: { data: PowerData; ee: Get; ie: Get; att: Get }) {
  const [kw, setKw] = useState(20);
  const [want, setWant] = useState(400);
  const convMinR = data.ee?.converter?.minResistance ?? null;
  const p = useAlternatorParams(data, ee);
  const fullLoad = ee('rotor.rotorFullLoadCurrent');
  const buffer = data.ee?.generator?.bufferTicks ?? 10;
  const I = fullLoad?.value ?? 100;
  const perRotor = [1, 2, 3, 4].map((n) => {
    const g = p ? alternator(n, 1, p, 1) : null;
    return { n, wPerSu: g ? g.power / g.stress : null };
  });

  return (
    <article className="ref-card power-article">
      <h2 className="power-h">Оптимальный режим генератора: обороты, напряжение, мощность</h2>
      <div className="power-note">
        <b>Коротко.</b>
        <ol>
          <li>
            Вал платит за <b>всю выработку</b>, даже если её никто не берёт. Генератор подбирают под потребление, а не
            «с запасом»: лишние статоры — впустую потраченные SU.
          </li>
          <li>
            <b>Обороты на КПД не влияют</b>: 1 SU ≈ 1 Вт на любой скорости. Чем быстрее вал, тем меньше статоров нужно
            на ту же мощность. Берите быстрый вал и подгоняйте обороты под потребление: статор целый, а обороты
            выставляются любые (до 256).
          </li>
          <li>
            <b>Напряжение отдельно не выбирается</b>: ЭДС = выработка / <Val s={fullLoad} unit="А" />. Та же мощность —
            то же напряжение на любых оборотах. Нужно другое — трансформатор.
          </li>
          <li>
            <b>Лучшая нагрузка — ток около {num(I)} А</b> на стороне генератора: он отдаёт почти всю выработку при 97 %
            напряжения. Меньше тока — недогруз, до {num(2 * I)} А — отдаёт всю выработку, но напряжение проседает;
            больше {num(2 * I)} А — не рассчитывайте.
          </li>
        </ol>
      </div>

      <h3>Как генератор держит нагрузку</h3>
      <p>
        По коду щёточный узел — источник с внутренним сопротивлением, которое зависит от запаса энергии: запас — до{' '}
        {buffer} тиков выработки, каждый тик пополняется на выработку и тратится на то, что забрали потребители. Пока
        берут меньше выработки, запас полный и внутреннее сопротивление крошечное (1/{4 * buffer} от «согласованной»
        нагрузки ЭДС² / выработку) — напряжение почти не проседает. Берут больше — запас садится, сопротивление растёт,
        и генератор отдаёт ровно выработку при напряжении √(выработка × R).
      </p>
      <LoadChart buffer={buffer} fullLoad={I} />

      <h3>Обороты</h3>
      <p>
        Выработка и нагрузка на вал растут с оборотами одинаково, поэтому SU за ватт от скорости не зависит. В Create
        шестерни и коробки меняют обороты, не меняя запаса SU источника (SU = влияние × об/мин), значит быстрее — всегда
        выгоднее по статорам. Ограничения: 256 об/мин у Create; на трёхфазном узле частота растёт с оборотами, и для
        помп на 128 об/мин есть «одинаковые снимки» (гайд про помпу).
      </p>
      <h3>Статоры на роторе</h3>
      <p>
        Каждый ротор, даже без статоров, берёт {p ? num(p.baseMagnets * p.powerMult * p.stressMult, 2) : '—'} SU за 1
        об/мин. Полный ротор (4 статора) почти не теряет, одиночный статор на роторе — заметно:
      </p>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>Статоров на роторе</th>
              {perRotor.map((r) => (
                <th key={r.n} className="num">
                  {r.n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Вт с 1 SU</td>
              {perRotor.map((r) => (
                <td key={r.n} className="num">
                  {r.wPerSu ? num(r.wPerSu, 3) : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Напряжение и трансформатор</h3>
      <p>
        Генератор на 20 кВт даёт {p ? num(20000 / p.fullLoadCurrent) : '—'} В, на 200 кВт —{' '}
        {p ? num(200000 / p.fullLoadCurrent) : '—'} В, на каких бы оборотах ни крутился. Потребителям нужно своё:
        двигателю — больше <Val s={ee('Voltages.motorMinVoltage')} unit="В" />, обычной изоляции — не больше{' '}
        <Val s={ee('Voltages.wireMaxVoltage')} unit="В" />. Трансформатор между генератором и потребителями заодно{' '}
        <b>согласует нагрузку</b>: повышая напряжение для потребителей в k раз, он делает их для генератора в k² раз
        «тяжелее» — так маленькую нагрузку можно довести до тока {num(I)} А на стороне генератора.
      </p>

      <h3>Сколько берут потребители</h3>
      <p>
        Для машин IE (через преобразователь EE → FE) нагрузку можно набрать ниже: сколько каких машин и приборов — и
        подставить в калькулятор. Таблица расхода каждой машины — во вкладке «Сеть IE». Напряжение подтянется до
        минимума преобразователя: из сети EE он берёт не больше U² / {convMinR ?? '—'} Ом (гайд «Из EE в IE»).
      </p>
      <IeLoadPicker
        data={data}
        ie={ie}
        att={att}
        rate={ee('wattFeTConversionRate')?.value ?? null}
        onApply={(w) => {
          setKw(Math.round(w / 100) / 10);
          // Преобразователь как потребитель — не меньше minResistance Ом: мощность P он возьмёт от √(P × R) вольт
          if (convMinR) setWant((v) => Math.max(v, Math.ceil(Math.sqrt(w * convMinR) / 10) * 10));
        }}
      />
      {p && <OptimalPlanner p={p} data={data} buffer={buffer} kw={kw} setKw={setKw} want={want} setWant={setWant} />}
      {p && <LoadCheck p={p} buffer={buffer} />}

      <h3>Что проверено</h3>
      <ul className="faint small">
        <li>
          По коду EE: щёточный узел — источник с запасом энергии (до {buffer} тиков выработки) и внутренним
          сопротивлением ЭДС² / (4 × запас); нагрузка ротора на вал не зависит от потребления.
        </li>
        <li>
          На тестовом сервере (4 + 2 статора, творческий мотор): 64 об/мин, 45 Ом — 551,27 В при ЭДС 552,96 В (модель:
          551,27); 256 об/мин, 45 Ом — 2185,0 В (модель 2185,0); 15 Ом (перегрузка) — 1822,6 В и запас 381 тыс. (модель
          1821,5 В и 380 тыс.). На 5 Ом (ток больше двух полных) — 1193 В и около 285 кВт при выработке 221 кВт: учёт
          мода уходит в плюс, модель здесь не работает, полагаться на это не стоит.
        </li>
        <li>
          Не проверено: в игре — ничего; потери в проводах и трансформаторах калькулятор не считает (их — в гайде про
          линию); двигатели EE меняют сопротивление от нагрузки — считайте их по потреблению на полной нагрузке.
        </li>
      </ul>
    </article>
  );
}

/** Отдача и напряжение генератора в зависимости от того, сколько хотят взять потребители */
function LoadChart({ buffer, fullLoad }: { buffer: number; fullLoad: number }) {
  const w = 420;
  const h = 150;
  const maxD = 5;
  const emf = 100;
  const power = emf * fullLoad;
  const pts = Array.from({ length: 101 }, (_, i) => {
    const d = (i / 100) * maxD + 1e-6;
    const l = alternatorLoad(emf, power, (emf * emf) / power / d, buffer);
    return { d, out: l.delivered / power, v: l.volts / emf };
  });
  const x = (d: number) => 46 + (d / maxD) * (w - 72);
  const y = (f: number) => 10 + (1 - Math.min(f, 1.1) / 1.1) * (h - 30);
  const path = (k: 'out' | 'v') =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  return (
    <figure className="power-figure">
      <svg viewBox={`0 0 ${w} ${h + 18}`} role="img" aria-label="Отдача и напряжение генератора от нагрузки">
        <rect x={x(4)} y={10} width={x(maxD) - x(4)} height={h - 30} className="power-zone-bad" />
        <line x1={46} y1={y(1)} x2={w - 26} y2={y(1)} className="power-axis" />
        <line x1={46} y1={h - 20} x2={w - 26} y2={h - 20} className="power-axis" />
        <line x1={x(1)} y1={10} x2={x(1)} y2={h - 20} className="power-axis" strokeDasharray="3 3" />
        <path d={path('out')} className="power-line" />
        <path d={path('v')} className="power-line power-line-2" />
        <text x={42} y={y(1) + 4} textAnchor="end" className="power-svg-text">
          100 %
        </text>
        {[0, 1, 2, 3, 4, 5].map((d) => (
          <text key={d} x={x(d)} y={h - 6} textAnchor="middle" className="power-svg-text">
            {d * 100} %
          </text>
        ))}
        <text x={x(4.5)} y={y(0.15)} textAnchor="middle" className="power-svg-text">
          вне модели
        </text>
      </svg>
      <figcaption className="faint small">
        По горизонтали — сколько взяли бы потребители при полном напряжении, в % выработки (100 % — ток {num(fullLoad)}{' '}
        А). <span className="power-key">Сплошная</span> — сколько генератор реально отдаёт, в % выработки;{' '}
        <span className="power-key power-key-2">пунктир</span> — напряжение, в % ЭДС. Лучшая точка — у 100 %: отдаёт
        всё, напряжение около 97 %. Левее — SU впустую, правее — просадка напряжения.
      </figcaption>
    </figure>
  );
}

/** Подбор генератора под потребителей */
function OptimalPlanner({
  p,
  data,
  buffer,
  kw,
  setKw,
  want,
  setWant,
}: {
  p: AlternatorParams;
  data: PowerData;
  buffer: number;
  kw: number;
  setKw: (v: number) => void;
  want: number;
  setWant: (v: number) => void;
}) {
  const [rpm, setRpm] = useState(256);
  const [su, setSu] = useState(0);
  const need = kw * 1000;
  const per = p.magnetsPerStator * p.powerMult;
  const stators = Math.max(1, Math.ceil(need / (per * rpm)));
  const rotors = Math.ceil(stators / 4);
  const maxRotors = data.ee?.rotor?.maxRotors ?? null;
  const g = alternator(stators, rpm, p, rotors);
  const consumerR = (want * want) / need;
  const k = matchRatio(g.emf, g.power, consumerR, want, buffer);
  const ratios = data.ee?.transformer ? transformerRatios(data.ee.transformer.ratios) : [];
  const best = ratios.length
    ? ratios.reduce((a, b) => (Math.abs(Math.log(b.k / k)) < Math.abs(Math.log(a.k / k)) ? b : a))
    : null;
  const withBest = best ? alternatorLoad(g.emf, g.power, consumerR / (best.k * best.k), buffer) : null;
  const suShort = su > 0 && g.stress > su;
  const suMax = su > 0 ? (su * g.power) / g.stress : null;
  // Статоров целое число: обороты, при которых выработка ровно равна потреблению
  const exactRpm = need / (per * stators);
  return (
    <section className="power-calc">
      <h3>Калькулятор: подобрать генератор</h3>
      <div className="power-form">
        <NumField label="Потребители берут" value={kw} onChange={setKw} min={0.1} max={100000} step={0.5} unit="кВт" />
        <NumField label="при напряжении" value={want} onChange={setWant} min={1} max={50000} step={10} unit="В" />
        <NumField label="Обороты вала" value={rpm} onChange={setRpm} min={1} max={256} unit="об/мин" />
        <NumField label="Запас SU источника (0 — не знаю)" value={su} onChange={setSu} min={0} max={1e9} step={100} />
      </div>
      <div className="power-outs">
        <div className="power-out">
          <span className="faint small">Статоров</span>
          <b>{num(stators)}</b>
          <span className="faint small">
            на {num(rotors)} {rotors === 1 ? 'роторе' : 'роторах'}
            {stators >= 4 ? ' по 4' : ''}
            {maxRotors && rotors > maxRotors
              ? ` — ${Math.ceil(rotors / maxRotors)} генератора (до ${maxRotors} роторов на узел)`
              : ''}
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Выработка и ЭДС</span>
          <b>{watts(g.power)}</b>
          <span className="faint small">
            {num(g.emf)} В; потребители займут {num((need / g.power) * 100)} %
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Нагрузка на вал</span>
          <b>{num(g.stress)} SU</b>
          <span className={cx('small', suShort ? 'power-bad' : 'faint')}>
            {suShort
              ? `источник не потянет: с ${num(su)} SU — не больше ${watts(suMax!)}`
              : su > 0
                ? `из ${num(su)} SU`
                : 'всегда, даже без потребителей'}
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Трансформатор (выход / вход)</span>
          <b>{Math.abs(k - 1) < 0.03 ? 'не нужен' : `≈ ${num(k, 2)}×`}</b>
          {best && withBest && Math.abs(k - 1) >= 0.03 && (
            <span className="faint small">
              ближайшее на одноблочном {best.label}: у потребителей {num(withBest.volts * best.k)} В
            </span>
          )}
        </div>
      </div>
      {need / g.power < 0.9 && (
        <p className="power-note small">
          Статор — целый: на {num(rpm)} об/мин {num(stators)} {stators === 1 ? 'статор даёт' : 'статора дают'} больше,
          чем нужно. Замедлите вал до <b>{num(Math.ceil(exactRpm))} об/мин</b> (регулятор скорости вращения Create) — та
          же мощность, вал не переплачивает.
        </p>
      )}
      <p className="faint small">
        Сколько статоров нужно на других оборотах:{' '}
        {[32, 64, 128, 256].map((r) => `${r} об/мин — ${Math.max(1, Math.ceil(need / (per * r)))}`).join(', ')}.
      </p>
    </section>
  );
}

/** Проверка готового генератора с нагрузкой */
function LoadCheck({ p, buffer }: { p: AlternatorParams; buffer: number }) {
  const [stators, setStators] = useState(8);
  const [rpm, setRpm] = useState(64);
  const [kw, setKw] = useState(20);
  const [nominal, setNominal] = useState(400);
  const [k, setK] = useState(1);
  const g = alternator(stators, rpm, p);
  const consumerR = (nominal * nominal) / (kw * 1000);
  const l = alternatorLoad(g.emf, g.power, consumerR / (k * k), buffer);
  const atConsumers = l.volts * k;
  const used = g.power > 0 ? l.delivered / g.power : 0;
  const over = atConsumers > nominal * 1.1;
  const fix = over ? matchRatio(g.emf, g.power, consumerR, nominal, buffer) : null;
  // С правильным напряжением потребители возьмут свою мощность — по ней и судим о загрузке вала
  const share = over ? Math.min(1, (kw * 1000) / g.power) : used;
  return (
    <section className="power-calc">
      <h3>Калькулятор: как работает мой генератор</h3>
      <div className="power-form">
        <NumField label="Статоров" value={stators} onChange={setStators} min={1} max={400} />
        <NumField label="Обороты" value={rpm} onChange={setRpm} min={1} max={256} unit="об/мин" />
        <NumField
          label="Потребители: мощность"
          value={kw}
          onChange={setKw}
          min={0.01}
          max={100000}
          step={0.5}
          unit="кВт"
        />
        <NumField label="при напряжении" value={nominal} onChange={setNominal} min={1} max={50000} step={10} unit="В" />
        <NumField
          label="Трансформатор: выход / вход"
          value={k}
          onChange={setK}
          min={0.02}
          max={50}
          step={0.1}
          unit="×"
        />
      </div>
      <div className="power-outs">
        <div className="power-out">
          <span className="faint small">Режим</span>
          <b className={cx(l.regime === 'unstable' && 'power-bad')}>{REGIME[l.regime]}</b>
        </div>
        <div className="power-out">
          <span className="faint small">Напряжение</span>
          <b>{num(l.volts)} В</b>
          <span className="faint small">
            ЭДС {num(g.emf)} В{k !== 1 ? `; у потребителей ${num(atConsumers)} В` : ''}
          </span>
          {over && fix && (
            <span className="small power-bad">
              выше номинала потребителей — трансформатор ≈ {num(fix, 2)}× (выход / вход), тогда они возьмут свои{' '}
              {num(kw, 1)} кВт
            </span>
          )}
        </div>
        <div className="power-out">
          <span className="faint small">Отдаёт</span>
          <b>{watts(l.delivered)}</b>
          <span className="faint small">
            из {watts(g.power)} — {num(used * 100)} %; ток {num(l.current, 1)} А
          </span>
        </div>
        <div className="power-out">
          <span className="faint small">Вал</span>
          <b>{num(g.stress)} SU</b>
          <span className={cx('small', share < 0.7 ? 'power-bad' : 'faint')}>
            {share < 0.7
              ? `${over ? 'при номинальном напряжении ' : ''}впустую около ${num(g.stress * (1 - share))} SU — генератор великоват`
              : 'загружен хорошо'}
          </span>
        </div>
      </div>
    </section>
  );
}
