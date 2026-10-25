import { useState } from 'react';
import { deviceTick, machineRates, type IeDevice, type IeMachine, type PowerData, type Setting } from '@/lib/power';
import { ItemIcon } from '@/shared/pack-data';
import { Button, Input, Select } from '@/shared/ui';

/**
 * Потребители IE и Advanced TFC Tech: таблицы (вкладка «Сеть IE») и набор нагрузки для расчёта генератора (гайд
 * «Оптимальный режим генератора»). Расход машин — по рецептам сборки, приборов — по конфигу (сервер поверх кода).
 */

type Get = (key: string) => Setting | null;

const num = (v: number | null, digits = 0) =>
  v !== null && Number.isFinite(v)
    ? (Math.round(v * 10 ** digits) / 10 ** digits).toLocaleString('ru-RU', { maximumFractionDigits: digits })
    : '—';
const watts = (w: number) => (Math.abs(w) >= 10000 ? `${num(w / 1000, 1)} кВт` : `${num(w)} Вт`);
const fe = (v: number | null) => (v === null ? '—' : `${num(v, v < 10 ? 1 : 0)}`);

const MOD_LABEL = { ie: 'IE', att: 'Advanced TFC Tech' };

const KIND_UNIT = { tick: 'FE/t', max: 'FE/t, до', action: 'FE' };

export function IeConsumers({ data, ie, att, rate }: { data: PowerData; ie: Get; att: Get; rate: number | null }) {
  const c = data.ie?.consumers;
  if (!c) return null;
  const getFor = (m: IeMachine) => (m.mod === 'att' ? att : ie);
  const hvWire = data.ie?.wires.find((w) => w.name === 'hv');
  const hv =
    ie('wires.hv.wireConnectorInput')?.value ??
    (hvWire && data.ie?.connectorDivisor ? hvWire.transferRate / data.ie.connectorDivisor : null);
  return (
    <>
      <section className="ref-card">
        <h2 className="power-h">Потребители: машины с рецептами</h2>
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>Машина</th>
                <th className="num">Одна операция, FE/t</th>
                <th className="num">Одновременно</th>
                <th className="num">Обычно, FE/t</th>
                <th className="num">Пик, FE/t</th>
                {rate && <th className="num">Пик в ваттах EE</th>}
              </tr>
            </thead>
            <tbody>
              {c.machines.map((m) => {
                const r = machineRates(m, getFor(m));
                const peak = r.max !== null && m.parallel ? r.max * m.parallel : null;
                const usual = r.median !== null && m.parallel ? r.median * m.parallel : null;
                return (
                  <tr key={m.id}>
                    <td>
                      <span className="power-name">
                        <ItemIcon id={m.block} size={20} />
                        {m.name}
                      </span>{' '}
                      <span className="faint small">
                        {MOD_LABEL[m.mod]}
                        {m.single ? ', один блок' : ''} · рецептов {m.recipes}
                      </span>
                    </td>
                    <td className="num">
                      {r.min === r.max ? fe(r.min) : `${fe(r.min)}–${fe(r.max)}`}
                      {r.min !== r.max && <span className="faint small"> (обычно {fe(r.median)})</span>}
                    </td>
                    <td className="num">{m.parallel ?? '?'}</td>
                    <td className="num">{usual !== null ? fe(usual) : '—'}</td>
                    <td className="num">{peak !== null ? fe(peak) : '—'}</td>
                    {rate && <td className="num">{peak !== null ? watts(peak * rate) : '—'}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="faint small">
          Расход операции по коду IE — энергия рецепта / его время, каждый тик, пока операция идёт; если в машине идут
          сразу несколько операций, расход складывается. Числа — по рецептам модов сборки (удаления и замены KubeJS не
          учтены) с множителями энергии и времени из конфига сервера. «Одновременно» — сколько операций машина ведёт
          разом (по коду; у лесопилки — предметов на ленте). «Обычно» — все места заняты обычным рецептом, «пик» — самым
          тяжёлым. Один коннектор IE пропускает не больше своего предела (HV — {hv ? num(hv) : '—'} FE/t), поэтому
          дуговой печи на пике одного ввода не хватит.
        </p>
      </section>
      <section className="ref-card">
        <h2 className="power-h">Потребители: приборы и мультиблоки без рецептов</h2>
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>Прибор</th>
                <th>Потребление</th>
                <th className="num">В работе, FE/t</th>
                {rate && <th className="num">В ваттах EE</th>}
              </tr>
            </thead>
            <tbody>
              {c.devices.map((d) => {
                const t = deviceTick(d, ie);
                return (
                  <tr key={d.id}>
                    <td>
                      <span className="power-name">
                        <ItemIcon id={d.block} size={20} />
                        {d.name}
                      </span>
                      {d.multiblock && <span className="faint small"> мультиблок</span>}
                    </td>
                    <td className="small">
                      {d.draws.map((x) => (
                        <div key={x.key}>
                          {num(ie(x.key)?.value ?? null)} {KIND_UNIT[x.kind]}
                          {x.note ? ` — ${x.note}` : ''}
                        </div>
                      ))}
                    </td>
                    <td className="num">{t ? fe(t) : '—'}</td>
                    {rate && <td className="num">{t ? watts(t * rate) : '—'}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="faint small">
          «В работе» — всё, что прибор берёт каждый тик, сложенное (у нагревателя — поддержание и ускорение, у турели —
          наблюдение и стрельба, у зарядной станции — наибольшая скорость зарядки). Расход «за действие» (насос, разряд
          катушки, предмет сборщика) в эту сумму не входит. Значения — конфиг сервера поверх кода IE.
        </p>
      </section>
    </>
  );
}

type Mode = 'typical' | 'peak' | 'one';
const MODES: { id: Mode; label: string }[] = [
  { id: 'typical', label: 'Обычный рецепт, все места заняты' },
  { id: 'peak', label: 'Самый тяжёлый рецепт, все места заняты' },
  { id: 'one', label: 'Обычный рецепт, одна операция' },
];

/** Набор нагрузки: сколько каких машин и приборов → FE/t и ватты для расчёта генератора */
export function IeLoadPicker({
  data,
  ie,
  att,
  rate,
  onApply,
}: {
  data: PowerData;
  ie: Get;
  att: Get;
  rate: number | null;
  onApply?: (watts: number) => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<Mode>('typical');
  const c = data.ie?.consumers;
  if (!c || !rate) return null;
  const machineLoad = (m: IeMachine) => {
    const r = machineRates(m, m.mod === 'att' ? att : ie);
    const per = mode === 'peak' ? r.max : r.median;
    const slots = mode === 'one' ? 1 : (m.parallel ?? 1);
    return (per ?? 0) * slots;
  };
  const rows: { id: string; block: string; name: string; load: number; item: IeMachine | IeDevice }[] = [
    ...c.machines.map((m) => ({ id: m.id, block: m.block, name: m.name, load: machineLoad(m), item: m })),
    ...c.devices
      .map((d) => ({ id: d.id, block: d.block, name: d.name, load: deviceTick(d, ie), item: d }))
      .filter((d) => d.load > 0),
  ];
  const total = rows.reduce((a, r) => a + r.load * (counts[r.id] ?? 0), 0);
  return (
    <section className="power-calc">
      <h3>Нагрузка из машин IE</h3>
      <label className="power-field">
        <span className="faint small">Как считать машины</span>
        <Select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="power-picker">
        {rows.map((r) => (
          <label key={r.id} className="power-picker-row">
            <ItemIcon id={r.block} size={20} />
            <span className="grow small">{r.name}</span>
            <span className="faint small">{fe(r.load)} FE/t</span>
            <Input
              type="number"
              min={0}
              max={999}
              value={counts[r.id] ?? 0}
              onChange={(e) => {
                const v = Math.max(0, Math.min(999, Math.round(Number(e.target.value) || 0)));
                setCounts((x) => ({ ...x, [r.id]: v }));
              }}
            />
          </label>
        ))}
      </div>
      <div className="power-outs">
        <div className="power-out">
          <span className="faint small">Всего</span>
          <b>{num(total)} FE/t</b>
          <span className="faint small">
            {watts(total * rate)} в сети EE (1 FE/t = {num(rate)} Вт)
          </span>
        </div>
        {onApply && (
          <div className="power-out">
            <Button className="small" disabled={!total} onClick={() => onApply(total * rate)}>
              Подставить в калькулятор
            </Button>
            <span className="faint small">потери в преобразователе и проводах IE не учтены</span>
          </div>
        )}
      </div>
    </section>
  );
}
