import { ArrowDown } from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { CONFIG_ORIGIN_LABEL } from '../lib/config';
import {
  alternator,
  type AlternatorParams,
  IE_WIRE,
  motor,
  POWER_SUBS,
  resistive,
  usePower,
  useSettings,
  type PowerData,
  type PowerSub,
  type Setting,
} from '../lib/power';
import { cx } from '../lib/util';
import { ItemIcon } from './ItemIcon';
import { IeConsumers } from './PowerIeLoads';
import './PowerTab.css';

const PowerGuidesSection = lazy(() => import('./guides/PowerGuidesSection'));

/**
 * Справочник → «Электричество». Три вида энергии сборки и переходы между ними:
 * вращение Create (SU) ↔ электричество Electro Energetics (В, А, Вт) ↔ энергия Immersive Engineering (FE/t).
 * Формулы и коэффициенты — из кода модов (scripts/mods/power.mjs), настройки — сервера, если импортированы.
 */

const num = (v: number, digits = 0) =>
  Number.isFinite(v)
    ? (Math.round(v * 10 ** digits) / 10 ** digits).toLocaleString('ru-RU', { maximumFractionDigits: digits })
    : '—';
/** Ватты с приставкой: 98 304 Вт → «98,3 кВт» */
const watts = (w: number) => (Math.abs(w) >= 10000 ? `${num(w / 1000, 1)} кВт` : `${num(w)} Вт`);

const EE_BLOCK = {
  rotor: 'electroenergetics:alternator_rotor',
  stator: 'electroenergetics:stator',
  brushes: 'electroenergetics:alternator_brushes',
  converter: 'electroenergetics:converter',
  motor: 'electroenergetics:gray_electric_motor',
  heater: 'electroenergetics:resistive_heater',
  pump: 'electroenergetics:electric_pump',
  bulb: 'electroenergetics:bulb',
  indicator: 'electroenergetics:indicator_bulb',
  transformer: 'electroenergetics:transformer',
};

export function PowerTab({
  sub,
  onSub,
  guide,
  onGuide,
}: {
  sub: PowerSub;
  onSub: (s: PowerSub) => void;
  guide: string | null;
  onGuide: (id: string | null) => void;
}) {
  const data = usePower();
  return (
    <div className="botany">
      <nav className="botany-nav" aria-label="Разделы электричества">
        {POWER_SUBS.map((s) => (
          <button key={s.id} className={cx(sub === s.id && 'active')} onClick={() => onSub(s.id)}>
            <span>{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="botany-main power">
        {data === undefined ? (
          <div className="empty">Загружаю…</div>
        ) : data === null ? (
          <div className="empty">Данные по электричеству не собраны — выполните npm run mods</div>
        ) : (
          <Body data={data} sub={sub} guide={guide} onGuide={onGuide} />
        )}
      </div>
    </div>
  );
}

/** Все настройки обоих модов — один раз, дальше по разделам */
function Body({
  data,
  sub,
  guide,
  onGuide,
}: {
  data: PowerData;
  sub: PowerSub;
  guide: string | null;
  onGuide: (id: string | null) => void;
}) {
  const ee = useSettings(data.ee?.file, data.ee?.keys);
  const ie = useSettings(data.ie?.file, data.ie?.keys);
  const att = useSettings(data.att?.file, data.att?.keys);
  if (sub === 'ee') return <EeLoads data={data} s={ee.get} />;
  if (sub === 'ie') return <IeNet data={data} s={ie.get} ee={ee.get} att={att.get} />;
  if (sub === 'guides')
    return (
      <Suspense fallback={<div className="empty">Загружаю гайды…</div>}>
        <PowerGuidesSection data={data} ee={ee.get} ie={ie.get} att={att.get} guide={guide} onGuide={onGuide} />
      </Suspense>
    );
  return <Link_ data={data} ee={ee.get} ie={ie.get} />;
}

type Get = (key: string) => Setting | null;

/** Значение настройки с подсказкой, откуда оно и чем отличается от мода */
function Cfg({ s, unit, digits = 0 }: { s: Setting | null; unit?: string; digits?: number }) {
  if (!s) return <span className="faint">нет в коде</span>;
  const changed = s.origin !== 'default' && s.default !== null && s.default !== s.value;
  return (
    <span
      className={cx('power-cfg', changed && 'changed')}
      title={CONFIG_ORIGIN_LABEL[s.origin] + (changed ? `; в моде по умолчанию ${num(s.default!, 4)}` : '')}
    >
      {num(s.value, digits)}
      {unit ? ` ${unit}` : ''}
      {changed && <sup>сервер</sup>}
    </span>
  );
}

function Field({
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

function Out({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="power-out">
      <span className="faint small">{label}</span>
      <b>{children}</b>
      {note && <span className="faint small">{note}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- как связаны

function Link_({ data, ee, ie }: { data: PowerData; ee: Get; ie: Get }) {
  const rate = ee('wattFeTConversionRate');
  const powerMult = ee('rotor.rotorPowerMultiplier');
  const stressMult = ee('rotor.rotorStressMultiplier');
  const fullLoad = ee('rotor.rotorFullLoadCurrent');
  const motorR = ee('Resistances.motorResistance');
  const motorMinV = ee('Voltages.motorMinVoltage');
  const convKw = ee('converterMaxPower');
  const maxRpm = 256;
  const rotor = data.ee?.rotor;
  const m = data.ee?.motor;
  const conv = data.ee?.converter;
  // Сколько ватт даёт 1 SU у генератора (ротор с полным набором статоров) и сколько стоит 1 SU у двигателя
  const fullRotor = rotor ? rotor.sides * rotor.magnetsPerStator : 0;
  const wPerSuGen = rotor && stressMult ? fullRotor / ((fullRotor + rotor.baseMagnets) * stressMult.value) : null;
  const wPerSuMotor = m ? 1 / m.loadedFactor : null;

  return (
    <>
      <section className="ref-card">
        <h2 className="power-h">Три вида энергии</h2>
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>Система</th>
                <th>Чем меряется</th>
                <th>Как устроена</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <b>Create</b> — вращение
                </td>
                <td>SU (нагрузка) = влияние × об/мин</td>
                <td>
                  Источник даёт запас SU, механизмы его забирают. Энергия не копится; не хватает — встаёт вся сеть
                  валов.
                </td>
              </tr>
              <tr>
                <td>
                  <b>Electro Energetics</b> — электричество Create
                </td>
                <td>вольты, амперы, ватты, омы</td>
                <td>
                  Цепь считается по законам электротехники: ток = напряжение / сопротивление, мощность = U × I. Провода
                  греются и рвутся от тока, изоляция пробивается напряжением. Есть трансформаторы.
                </td>
              </tr>
              <tr>
                <td>
                  <b>Immersive Engineering</b>
                </td>
                <td>FE за тик (FE/t)</td>
                <td>
                  Энергия-«жидкость»: генератор кладёт FE в сеть, машины берут. Провода — с пределом пропускной
                  способности и потерей процента на длине.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="faint small">
          Других мостов между системами в сборке нет: Create и IE напрямую не соединяются, только через электричество
          EE. Вращение TFC (его ветряки, водяные колёса, жернова) — отдельная система: из Create в неё переводит
          преобразователь c2tfc; в этот раздел пока не входит.
        </p>
      </section>

      <section className="ref-card">
        <h2 className="power-h">Переходы и курсы</h2>
        <div className="power-chain">
          <ChainStep icons={[EE_BLOCK.rotor, EE_BLOCK.stator, EE_BLOCK.brushes]} title="Вал Create → электричество">
            Генератор: роторы, вокруг каждого до {rotor?.sides ?? 4} статоров, на конце щёточный узел (собирает до{' '}
            {rotor?.maxRotors ?? '—'} роторов подряд). Каждый статор даёт{' '}
            {rotor && powerMult ? num(rotor.magnetsPerStator * powerMult.value) : '—'} Вт за 1 об/мин (
            {rotor?.magnetsPerStator ?? '—'} × <Cfg s={powerMult} unit="Вт" />
            ), вал нагружается на столько же SU и ещё{' '}
            {rotor && powerMult && stressMult ? num(rotor.baseMagnets * powerMult.value * stressMult.value, 2) : '—'} SU
            за 1 об/мин на каждый ротор — <b>1 SU ≈ {wPerSuGen ? num(wPerSuGen, 2) : '—'} Вт</b>. Напряжение без
            нагрузки = выработка / <Cfg s={fullLoad} unit="А" />.
          </ChainStep>
          <ArrowDown size={16} className="faint" />
          <ChainStep icons={[EE_BLOCK.converter]} title="Электричество ↔ FE (Immersive Engineering)">
            Преобразователь:{' '}
            <b>
              1 FE/t = <Cfg s={rate} unit="Вт" />
            </b>
            . Режим (приём FE или отдача) переключается ключом Create по боковой грани; FE-сторона — блок за его задней
            гранью. Буфер — <Cfg s={convKw} unit="кВт" /> (в ватт-тиках), отдавая в сеть EE, держит выставленное
            напряжение (0–
            {num(conv?.voltageMax ?? 0)} В, шаг {conv?.voltageStep ?? '—'}, по умолчанию {conv?.voltageDefault ?? '—'}{' '}
            В). Принимая из сети EE, ведёт себя как сопротивление не меньше {conv?.minResistance ?? '—'} Ом.
          </ChainStep>
          <ArrowDown size={16} className="faint" />
          <ChainStep icons={[EE_BLOCK.motor]} title="Электричество → вал Create">
            Двигатель: даёт U² / <Cfg s={motorR} unit="Ом" /> SU, пока напряжение выше <Cfg s={motorMinV} unit="В" />.
            На полной нагрузке потребляет в {m ? num(1 / m.loadedFactor, 2) : '—'} раза больше ватт, чем выдаёт SU:{' '}
            <b>1 SU ≈ {wPerSuMotor ? num(wPerSuMotor, 2) : '—'} Вт</b>; без нагрузки — в{' '}
            {m ? num(m.loadedFactor * m.idleFactor, 1) : '—'} раза меньше (U² / ({m ? num(m.loadedFactor, 2) : '—'} ×{' '}
            {m?.idleFactor ?? '—'} × R)).
          </ChainStep>
        </div>
        {wPerSuGen && wPerSuMotor && (
          <p className="power-note">
            Генератор даёт около {num(wPerSuGen, 2)} Вт с 1 SU, а двигатель берёт {num(wPerSuMotor, 2)} Вт за 1 SU —
            цепочка «вал → генератор → двигатель → вал» возвращает не больше {num((wPerSuGen / wPerSuMotor) * 100)} %
            SU, вечного двигателя нет. Электричество выгодно для передачи на расстояние и в IE, а не для умножения
            вращения. Проверено на тестовом сервере (генератор) и по коду (двигатель); в игре не проверялось.
          </p>
        )}
      </section>

      {rotor && powerMult && stressMult && fullLoad && (
        <GeneratorCalc
          maxRpm={maxRpm}
          p={{
            powerMult: powerMult.value,
            stressMult: stressMult.value,
            fullLoadCurrent: fullLoad.value,
            magnetsPerStator: rotor.magnetsPerStator,
            baseMagnets: rotor.baseMagnets,
          }}
          maxRotors={rotor.maxRotors}
          rate={rate?.value ?? null}
          motorR={motorR?.value ?? null}
          bufferTicks={data.ee?.generator?.bufferTicks ?? null}
        />
      )}
      {m && motorR && motorMinV && <MotorCalc p={{ ...m, resistance: motorR.value, minVoltage: motorMinV.value }} />}
      <ConverterCalc data={data} ee={ee} ie={ie} />
    </>
  );
}

function ChainStep({ icons, title, children }: { icons: string[]; title: string; children: ReactNode }) {
  return (
    <div className="power-step">
      <div className="power-step-icons">
        {icons.map((id) => (
          <ItemIcon key={id} id={id} size={28} />
        ))}
      </div>
      <div>
        <b>{title}</b>
        <p>{children}</p>
      </div>
    </div>
  );
}

function GeneratorCalc({
  p,
  maxRpm,
  maxRotors,
  rate,
  motorR,
  bufferTicks,
}: {
  p: AlternatorParams;
  maxRpm: number;
  maxRotors: number | null;
  rate: number | null;
  motorR: number | null;
  bufferTicks: number | null;
}) {
  const [stators, setStators] = useState(8);
  const [rotorsIn, setRotors] = useState(2);
  const [rpm, setRpm] = useState(128);
  const rotors = Math.max(rotorsIn, Math.ceil(stators / 4));
  const g = alternator(stators, rpm, p, rotors);
  // Двигатель прямо на генераторе: U = ЭДС, пока его потребление не превышает выработку
  const motorSu = motorR ? (g.emf * g.emf) / motorR : null;
  return (
    <section className="ref-card">
      <h2 className="power-h">Калькулятор генератора</h2>
      <div className="power-form">
        <Field label="Статоров всего (по всем роторам)" value={stators} onChange={setStators} min={1} max={400} />
        <Field label="Роторов" value={rotors} onChange={setRotors} min={1} max={400} />
        <Field label="Скорость вала" value={rpm} onChange={setRpm} min={1} max={maxRpm} unit="об/мин" />
      </div>
      <div className="power-outs">
        <Out label="Выработка">{watts(g.power)}</Out>
        <Out label="Напряжение без нагрузки">{num(g.emf, 1)} В</Out>
        <Out label="Нагрузка на вал">{num(g.stress)} SU</Out>
        <Out label="Полная мощность — при нагрузке" note="меньше сопротивление — напряжение проседает">
          ≥ {num(g.minLoad, 2)} Ом
        </Out>
        {rate && <Out label="Через преобразователь">{num(g.power / rate)} FE/t</Out>}
        {motorSu !== null && (
          <Out label="Двигатель прямо на генераторе" note="без трансформатора, на полной нагрузке">
            {num(motorSu)} SU
          </Out>
        )}
      </div>
      <p className="faint small">
        Генератор — источник напряжения с запасом энергии на {bufferTicks ?? '—'} тиков выработки; ток больше{' '}
        {num(p.fullLoadCurrent)} А не держит — напряжение проседает, отдаёт он не больше выработки. Вал нагружается
        одинаково, сколько бы ни потребляли. На один щёточный узел — до {maxRotors ?? '—'} роторов подряд, больше —
        второй генератор. Поднять напряжение без потери мощности — трансформатором.
      </p>
    </section>
  );
}

function MotorCalc({ p }: { p: Parameters<typeof motor>[2] }) {
  const [volts, setVolts] = useState(300);
  const [load, setLoad] = useState(100);
  const r = motor(volts, load / 100, p);
  return (
    <section className="ref-card">
      <h2 className="power-h">Калькулятор двигателя</h2>
      <div className="power-form">
        <Field label="Напряжение на двигателе" value={volts} onChange={setVolts} min={0} max={50000} unit="В" />
        <Field label="Нагрузка (доля выданных SU)" value={load} onChange={setLoad} min={0} max={100} unit="%" />
      </div>
      {r.running ? (
        <div className="power-outs">
          <Out label="Отдаёт в сеть Create">{num(r.capacity)} SU</Out>
          <Out label="Потребляет">{watts(r.power)}</Out>
          <Out label="Ток">{num(r.current, 1)} А</Out>
          <Out label="Сопротивление сейчас">{num(r.resistance, 1)} Ом</Out>
        </div>
      ) : (
        <p className="power-note">Напряжение не выше {p.minVoltage} В — двигатель стоит.</p>
      )}
      <p className="faint small">
        Обычно скорость вала выставляется на самом двигателе, а от напряжения зависит только запас SU. В режиме
        «плавающей» скорости обороты = запас SU / число на шкале, то есть растут с напряжением (по коду, в игре не
        проверялось).
      </p>
    </section>
  );
}

function ConverterCalc({ data, ee, ie }: { data: PowerData; ee: Get; ie: Get }) {
  const rate = ee('wattFeTConversionRate');
  const convKw = ee('converterMaxPower');
  const [fe, setFe] = useState(256);
  const div = data.ie?.connectorDivisor;
  if (!rate) return null;
  return (
    <section className="ref-card">
      <h2 className="power-h">Ватты ↔ FE</h2>
      <div className="power-form">
        <Field label="Энергия IE" value={fe} onChange={setFe} min={0} max={1_000_000} unit="FE/t" />
      </div>
      <div className="power-outs">
        <Out label="Это в ваттах">{watts(fe * rate.value)}</Out>
        {convKw && <Out label="Предел одного преобразователя">{num((convKw.value * 1000) / rate.value)} FE/t</Out>}
        {data.ie?.wires.map((w) => {
          const t = ie(`wires.${w.name}.wireConnectorInput`)?.value ?? (div ? w.transferRate / div : null);
          return t ? (
            <Out key={w.name} label={`Ввод коннектора ${IE_WIRE[w.name]?.short ?? w.name}`}>
              {num(t)} FE/t = {watts(t * rate.value)}
            </Out>
          ) : null;
        })}
      </div>
      <p className="faint small">
        Коннектор IE принимает от соседнего блока (в том числе от преобразователя) не больше своего ввода за тик — для
        преобразователя это обычно узкое место.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- нагрузки EE

function EeLoads({ data, s }: { data: PowerData; s: Get }) {
  const [volts, setVolts] = useState(230);
  const rows: { id: string; name: string; r: Setting | null; note?: string }[] = [
    { id: EE_BLOCK.heater, name: 'Электрический нагреватель', r: s('Resistances.resistiveHeaterResistance') },
    { id: EE_BLOCK.pump, name: 'Электрическая помпа', r: s('Resistances.pumpResistance') },
    { id: EE_BLOCK.bulb, name: 'Лампа накаливания', r: s('Resistances.bulbResistance') },
    { id: EE_BLOCK.indicator, name: 'Светодиод', r: s('Resistances.indicatorBulbResistance') },
  ];
  const motorR = s('Resistances.motorResistance');
  const m = data.ee?.motor;
  const motorMinV = s('Voltages.motorMinVoltage');
  return (
    <>
      <section className="ref-card">
        <h2 className="power-h">Потребители при напряжении</h2>
        <div className="power-form">
          <Field label="Напряжение" value={volts} onChange={setVolts} min={0} max={50000} unit="В" />
        </div>
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>Устройство</th>
                <th className="num">Сопротивление</th>
                <th className="num">Ток</th>
                <th className="num">Мощность</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const r = x.r ? resistive(volts, x.r.value) : null;
                return (
                  <tr key={x.id}>
                    <td>
                      <span className="power-name">
                        <ItemIcon id={x.id} size={20} />
                        {x.name}
                      </span>
                    </td>
                    <td className="num">
                      <Cfg s={x.r} unit="Ом" digits={1} />
                    </td>
                    <td className="num">{r ? `${num(r.current, 2)} А` : '—'}</td>
                    <td className="num">{r ? watts(r.power) : '—'}</td>
                  </tr>
                );
              })}
              {m && motorR && (
                <tr>
                  <td>
                    <span className="power-name">
                      <ItemIcon id={EE_BLOCK.motor} size={20} />
                      Электродвигатель, полная нагрузка
                    </span>
                  </td>
                  <td className="num">
                    {num(m.loadedFactor * motorR.value, 1)} Ом{' '}
                    <span className="faint small">
                      ({num(m.loadedFactor, 2)} × <Cfg s={motorR} />)
                    </span>
                  </td>
                  <td className="num">{num(volts / (m.loadedFactor * motorR.value), 2)} А</td>
                  <td className="num">
                    {motorMinV && volts <= motorMinV.value
                      ? 'стоит'
                      : watts((volts * volts) / (m.loadedFactor * motorR.value))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="faint small">
          Нагреватель, помпа и лампы — постоянное сопротивление: мощность растёт как квадрат напряжения (вдвое больше
          вольт — вчетверо больше ватт). Значок «сервер» — значение изменено в конфиге сервера относительно мода.
        </p>
      </section>
      <section className="ref-card">
        <h2 className="power-h">Пределы</h2>
        <div className="power-outs">
          <Out label="Вариак, не больше">
            <Cfg s={s('Ratings.variacMaxPower')} unit="Вт" />
          </Out>
          <Out label="Потенциометр, не больше">
            <Cfg s={s('Ratings.potentiometerMaxPower')} unit="Вт" />
          </Out>
          <Out label="Резистор, не больше">
            <Cfg s={s('Ratings.resistorMaxPower')} unit="Вт" />
          </Out>
          <Out label="Конденсатор / высоковольтный">
            <Cfg s={s('Voltages.capacitorVoltage')} unit="В" /> /{' '}
            <Cfg s={s('Voltages.highVoltageCapacitorVoltage')} unit="В" />
          </Out>
          <Out label="Индуктор">
            <Cfg s={s('Voltages.inductorVoltage')} unit="В" />
          </Out>
          <Out label="Аккумулятор, заряд">
            <Cfg s={s('Voltages.maxAccumulatorCharge')} unit="Кл" />
          </Out>
          <Out label="Вольтметр / амперметр, шкала">
            <Cfg s={s('Voltages.maxVoltmeterVoltage')} unit="В" /> /{' '}
            <Cfg s={s('Voltages.maxAmmeterCurrent')} unit="А" />
          </Out>
          <Out label="Предохранитель, самый большой">
            <Cfg s={s('maxFuseAmperage')} unit="А" />
          </Out>
        </div>
        <p className="faint small">
          Что бывает при превышении (перегорание, порча) — пока не разобрано по коду; провода EE (нагрев, пробой
          изоляции) — следующий шаг раздела.
        </p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- сеть IE

function IeNet({ data, s, ee, att }: { data: PowerData; s: Get; ee: Get; att: Get }) {
  const rate = ee('wattFeTConversionRate');
  const div = data.ie?.connectorDivisor;
  return (
    <>
      <section className="ref-card">
        <h2 className="power-h">Провода и коннекторы IE</h2>
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>Провод</th>
                <th className="num">Пропускает</th>
                <th className="num">Ввод коннектора</th>
                <th className="num">Пролёт до</th>
                <th className="num">Потери на полном пролёте</th>
              </tr>
            </thead>
            <tbody>
              {data.ie?.wires.map((w) => {
                const k = (x: string) => s(`wires.${w.name}.${x}`);
                const rateS = k('transferRate');
                const len = k('maxLength');
                const loss = k('distanceLoss');
                const input = k('wireConnectorInput');
                const meta = IE_WIRE[w.name];
                return (
                  <tr key={w.name}>
                    <td>
                      <span className="power-name">
                        {meta && <ItemIcon id={meta.coil} size={20} />}
                        {meta && <ItemIcon id={meta.connector} size={20} />}
                        {meta?.short ?? w.name}
                      </span>
                    </td>
                    <td className="num">
                      <Cfg s={rateS} unit="FE/t" />
                    </td>
                    <td className="num">
                      {input ? <Cfg s={input} unit="FE/t" /> : div && rateS ? `${num(rateS.value / div)} FE/t` : '—'}
                    </td>
                    <td className="num">
                      <Cfg s={len} unit="бл." />
                    </td>
                    <td className="num">{loss ? `${num(loss.value * 100, 2)} %` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="faint small">
          Потери по коду IE: доля = потери провода × длина пролёта / наибольшая длина, по пути суммируются. Ввод
          коннектора — сколько он берёт от соседнего блока за тик (по коду: пропускная способность / {div ?? '—'}).
          Перегруженный провод IE сгорает (в коде есть, порог не разбирали).
        </p>
      </section>
      <section className="ref-card">
        <h2 className="power-h">Генераторы IE</h2>
        <div className="power-outs">
          <Out label="Дизельный генератор">
            <Cfg s={s('machines.dieselGen_output')} unit="FE/t" />
          </Out>
          <Out label="Кинетический динамо" note="множитель выработки от водяного колеса / ветряка IE">
            × <Cfg s={s('machines.dynamo_output')} digits={2} />
          </Out>
          <Out label="Термоэлектрический генератор" note="множитель выработки">
            × <Cfg s={s('machines.thermoelectric_output')} digits={2} />
          </Out>
          {rate && (
            <Out label="Дизельный генератор в ваттах EE">
              {watts((s('machines.dieselGen_output')?.value ?? 0) * rate.value)}
            </Out>
          )}
        </div>
        <p className="faint small">
          Сколько вращения дают колесо и ветряк IE и как термоэлектрический генератор считает температуру — следующий
          шаг раздела. В сборке к источникам тепла для термоэлектрического генератора добавлена магма TFC (1300 K,
          датапак сборки).
        </p>
      </section>
      <IeConsumers data={data} ie={s} att={att} rate={rate?.value ?? null} />
    </>
  );
}
