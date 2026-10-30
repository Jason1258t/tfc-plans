import { alternatorLoad } from '@/lib/power';
import { num } from '@/lib/guideFormat';
import type { Widget } from '../GuideBody';
import pw from './powerWidgets.module.css';
import { cx } from '@/shared/lib';

/**
 * Виджеты гайдов «Электричества» — рисунки, которые разметкой не описать. В статье: строка «::имя параметры».
 */

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
    <g className={pw.powerDiode}>
      <polygon points={`${x - 8},${y + 7} ${x + 8},${y + 7} ${x},${y - 7}`} />
      <line x1={x - 9} y1={y - 7} x2={x + 9} y2={y - 7} />
    </g>
  );
  return (
    <figure className={pw.figure}>
      <svg
        viewBox={`0 0 ${width} 220`}
        role="img"
        aria-label={legs === 3 ? 'Схема трёхфазного моста' : 'Схема однофазного моста с конденсатором'}
      >
        <line x1={cols[0]} y1={top} x2={pumpX} y2={top} className={pw.powerWire} />
        <line x1={cols[0]} y1={bottom} x2={pumpX} y2={bottom} className={pw.powerWire} />
        <text x={pumpX + 8} y={top + 4} className={pw.svgText}>
          +
        </text>
        <text x={pumpX + 8} y={bottom + 4} className={pw.svgText}>
          −
        </text>
        {cols.map((x, i) => (
          <g key={x}>
            <line x1={x} y1={top} x2={x} y2={bottom} className={pw.powerWire} />
            {diode(x, (top + mid) / 2)}
            {diode(x, (mid + bottom) / 2)}
            <line x1={x - 28} y1={mid} x2={x} y2={mid} className={pw.powerWire} />
            <circle cx={x} cy={mid} r={3} className={pw.powerDot} />
            <circle cx={x - 28} cy={mid} r={3} className={pw.powerTerm} />
            <text x={x - 34} y={mid + 4} textAnchor="end" className={pw.svgText}>
              {inputs[i]}
            </text>
          </g>
        ))}
        {cap && (
          <g className={pw.powerCap}>
            <line x1={right} y1={top} x2={right} y2={mid - 5} className={pw.powerWire} />
            <line x1={right} y1={mid + 5} x2={right} y2={bottom} className={pw.powerWire} />
            <line x1={right - 14} y1={mid - 5} x2={right + 14} y2={mid - 5} />
            <line x1={right - 14} y1={mid + 5} x2={right + 14} y2={mid + 5} />
            <text x={right + 18} y={mid + 4} className={pw.svgText}>
              C
            </text>
          </g>
        )}
        <line x1={pumpX} y1={top} x2={pumpX} y2={mid - 18} className={pw.powerWire} />
        <line x1={pumpX} y1={mid + 18} x2={pumpX} y2={bottom} className={pw.powerWire} />
        <rect x={pumpX - 32} y={mid - 18} width={64} height={36} rx={4} className={pw.powerLoad} />
        <text x={pumpX} y={mid + 4} textAnchor="middle" className={pw.svgText}>
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

function LineDiagram() {
  const box = (x: number, label: string, sub?: string) => (
    <g>
      <rect x={x} y={30} width={96} height={40} rx={5} className={pw.powerLoad} />
      <text x={x + 48} y={sub ? 47 : 54} textAnchor="middle" className={pw.svgText}>
        {label}
      </text>
      {sub && (
        <text x={x + 48} y={62} textAnchor="middle" className={cx(pw.svgText, pw.powerSvgSub)}>
          {sub}
        </text>
      )}
    </g>
  );
  return (
    <figure className={cx(pw.figure, pw.powerFigureWide)}>
      <svg
        viewBox="0 0 640 100"
        role="img"
        aria-label="Схема линии: генератор, повышающий трансформатор, линия, понижающий трансформатор, потребители"
      >
        <line x1={96} y1={50} x2={140} y2={50} className={pw.powerWire} />
        <line x1={236} y1={50} x2={404} y2={50} className={cx(pw.powerWire, pw.powerHv)} />
        <line x1={500} y1={50} x2={544} y2={50} className={pw.powerWire} />
        {box(0, 'генератор', '300 В')}
        {box(140, 'повышающий', '1:10')}
        <text x={320} y={42} textAnchor="middle" className={pw.svgText}>
          линия, 3000 В, ток ÷10
        </text>
        <text x={320} y={68} textAnchor="middle" className={cx(pw.svgText, pw.powerSvgSub)}>
          потери ÷100
        </text>
        {box(404, 'понижающий', '10:1')}
        {box(544, 'потребители', '300 В')}
      </svg>
    </figure>
  );
}

/** Вид сбоку: вал → роторы со статорами → щёточный узел → провода */
function GeneratorDiagram() {
  const cell = 40;
  const y = 50;
  const rotors = [1, 2, 3];
  return (
    <figure className={pw.figure}>
      <svg viewBox="0 0 420 130" role="img" aria-label="Схема генератора сбоку">
        <line x1={10} y1={y + cell / 2} x2={80} y2={y + cell / 2} className={pw.powerWire} />
        <text x={10} y={y + cell / 2 - 8} className={pw.svgText}>
          вал Create
        </text>
        {rotors.map((i) => {
          const x = 40 + i * cell;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y - cell}
                width={cell - 2}
                height={cell - 4}
                className={cx(pw.powerBox, pw.powerBoxSoft)}
              />
              <rect x={x} y={y} width={cell - 2} height={cell - 2} className={pw.powerBox} />
              <rect
                x={x}
                y={y + cell + 2}
                width={cell - 2}
                height={cell - 4}
                className={cx(pw.powerBox, pw.powerBoxSoft)}
              />
              <text x={x + cell / 2 - 1} y={y + cell / 2 + 4} textAnchor="middle" className={pw.svgText}>
                Р
              </text>
              <text x={x + cell / 2 - 1} y={y - cell / 2 + 2} textAnchor="middle" className={pw.svgText}>
                С
              </text>
              <text x={x + cell / 2 - 1} y={y + cell * 1.5 + 2} textAnchor="middle" className={pw.svgText}>
                С
              </text>
            </g>
          );
        })}
        <rect x={40 + 4 * cell} y={y} width={cell - 2} height={cell - 2} className={pw.powerBox} />
        <text x={40 + 4.5 * cell - 1} y={y + cell / 2 + 4} textAnchor="middle" className={pw.svgText}>
          Щ
        </text>
        <line x1={40 + 5 * cell} y1={y + 10} x2={400} y2={y + 10} className={pw.powerWire} />
        <line x1={40 + 5 * cell} y1={y + 28} x2={400} y2={y + 28} className={pw.powerWire} />
        <text x={400} y={y + 4} textAnchor="end" className={pw.svgText}>
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
    <figure className={pw.figure}>
      <svg viewBox={`0 0 ${w} ${h + 18}`} role="img" aria-label="Отдача и напряжение генератора от нагрузки">
        <rect x={x(4)} y={10} width={x(maxD) - x(4)} height={h - 30} className={pw.powerZoneBad} />
        <line x1={46} y1={y(1)} x2={w - 26} y2={y(1)} className={pw.axis} />
        <line x1={46} y1={h - 20} x2={w - 26} y2={h - 20} className={pw.axis} />
        <line x1={x(1)} y1={10} x2={x(1)} y2={h - 20} className={pw.axis} strokeDasharray="3 3" />
        <path d={path('out')} className={pw.powerLine} />
        <path d={path('v')} className={cx(pw.powerLine, pw.powerLine2)} />
        <text x={42} y={y(1) + 4} textAnchor="end" className={pw.svgText}>
          100 %
        </text>
        {[0, 1, 2, 3, 4, 5].map((d) => (
          <text key={d} x={x(d)} y={h - 6} textAnchor="middle" className={pw.svgText}>
            {d * 100} %
          </text>
        ))}
        <text x={x(4.5)} y={y(0.15)} textAnchor="middle" className={pw.svgText}>
          вне модели
        </text>
      </svg>
      <figcaption className="faint small">
        По горизонтали — сколько взяли бы потребители при полном напряжении, в % выработки (100 % — ток {num(fullLoad)}{' '}
        А). <span className={pw.powerKey}>Сплошная</span> — сколько генератор реально отдаёт, в % выработки;{' '}
        <span className={cx(pw.powerKey, pw.powerKey2)}>пунктир</span> — напряжение, в % ЭДС. Лучшая точка — у 100 %:
        отдаёт всё, напряжение около 97 %. Левее — SU впустую, правее — просадка напряжения.
      </figcaption>
    </figure>
  );
}

export const POWER_WIDGETS: Record<string, { doc: string; render: Widget }> = {
  'bridge-diagram': {
    doc: 'схема диодного моста: legs=3 — трёхфазный, legs=1 — однофазный; cap — с конденсатором',
    render: ({ params }) => <BridgeDiagram legs={params.legs === 1 ? 1 : 3} cap={Boolean(params.cap)} />,
  },
  'generator-diagram': {
    doc: 'генератор сбоку: вал, роторы со статорами, щёточный узел',
    render: () => <GeneratorDiagram />,
  },
  'line-diagram': {
    doc: 'линия: генератор → повышающий → линия → понижающий → потребители',
    render: () => <LineDiagram />,
  },
  'load-chart': {
    doc: 'отдача и напряжение генератора от нагрузки (по модели EE)',
    render: ({ scope }) => (
      <LoadChart
        buffer={Number(scope.bufferTicks) || 10}
        fullLoad={Number((scope.gen as { fullLoadCurrent?: number } | null)?.fullLoadCurrent) || 100}
      />
    ),
  },
};
