import { useMemo, useState } from 'react';
import { Card, CardHead, Table, TableWrap } from '@/shared/ui';
import { burnerHeat, burnerMode, burnerRate } from '@/shared/pack-data';
import type { LiquidFamily } from '@/lib/reference';
import styles from './BurnerComparison.module.css';

const number = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
const bucketTime = (rate: number) => {
  if (rate <= 0) return '—';
  const seconds = Math.round(1000 / rate);
  return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
};

export function BurnerComparison({
  families,
  nameOf,
}: {
  families: LiquidFamily[];
  nameOf: (fluid: LiquidFamily['fluids'][number]) => string;
}) {
  const [valve, setValve] = useState(1);
  const rate = useMemo(() => burnerRate(valve), [valve]);
  const rows = families.flatMap((family) =>
    family.burner || family.blazeFuels?.length
      ? family.fluids.map((fluid) => ({ family, fluid, fuel: family.blazeFuels?.find((f) => f.fluid === fluid.id) }))
      : [],
  );
  return (
    <Card>
      <CardHead>
        <div className="grow">
          <h2>Бурнер и горелка всполоха</h2>
          <div className="faint small">Режимы рецептов Create · расчёт при 20 TPS · в игре не проверялось</div>
        </div>
      </CardHead>
      <label className={styles.valve}>
        Расчётное открытие вентиля CDG: {Math.round(valve * 100)}%
        <input
          aria-label="Открытие вентиля бурнера"
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(valve * 100)}
          onChange={(e) => setValve(Number(e.target.value) / 100)}
        />
      </label>
      <TableWrap>
        <Table className={styles.burn}>
          <thead>
            <tr>
              <th>Жидкость</th>
              <th>Бурнер CDG: режим</th>
              <th>Расход · ведро</th>
              <th>Горелка всполоха: режим</th>
              <th>Расход · ведро</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ family, fluid, fuel }) => {
              const cdg = family.burner != null && family.burner > 0;
              const heat = cdg && valve > 0 ? burnerHeat(family.burner ?? 0, valve) : 0;
              const blazeRate = fuel ? (20 * fuel.perTick) / fuel.burnTime : 0;
              return (
                <tr key={`${family.tag}/${fluid.id}`}>
                  <td>
                    <div>{nameOf(fluid)}</div>
                    <code className="faint small">{fluid.id}</code>
                  </td>
                  <td>{cdg ? burnerMode(heat) : 'Не топливо'}</td>
                  <td>{cdg && valve > 0 ? `${number(rate)} mB/с · ${bucketTime(rate)}` : '—'}</td>
                  <td title={fuel ? `${fuel.source} · ${fuel.id}` : undefined}>
                    {fuel ? (fuel.superHeat ? 'перегрев' : 'нагрев') : 'Не топливо'}
                  </td>
                  <td>{fuel ? `${number(blazeRate)} mB/с · ${bucketTime(blazeRate)}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>
      {rows.length === 0 && <p className="faint small">Для выбранных жидкостей данных о топливе горелок нет.</p>}
      <ul className={styles.facts}>
        <li>
          Ведро — 1000 mB. Бурнер CDG расходует жидкость в зависимости от вентиля; топливо определяет силу нагрева.
          Тление не подходит для рецептов с нагревом. На полностью открытом вентиле расход — 2 mB/с.
        </li>
        <li>
          У горелки всполоха жидкость работает через Create Liquid Fuel. Расход — средний после набора запаса горения:
          при запуске бак может опустошаться быстрее. Время из ведра рассчитано по запасу тиков.
        </li>
        <li>
          Горелка принимает конкретные жидкости, указанные в таблице. Общий тег не гарантирует взаимозаменяемость.
          Источник настройки горелки виден при наведении на её режим.
        </li>
        <li>Этанол в бурнере CDG даже при 100% вентиля не достигает перегрева из-за округления в коде мода.</li>
        <li>
          Температура для TFC через Wooden Cog рассчитывается отдельно: визуальный режим жидкой горелки может с ней не
          совпадать. Нагрев TFC этим сравнением не подтверждён.
        </li>
      </ul>
    </Card>
  );
}
