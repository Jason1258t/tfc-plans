import { PRINT_HINTS, PRINT_STATUS, type PrintGroup, type PrintSchematic } from '@tfc/core/printCheck';
import { blockEntry, ItemIcon, itemName, useItems } from '@/shared/pack-data';
import { cx, timeAgo } from '@/shared/lib';
import { NO_KEY, printView, usePrintChecks, type PrintRecord } from '../../model/printChecks';
import styles from './PrintCheck.module.css';

/** Короткие подписи значка */
const SHORT: Record<PrintGroup, string> = {
  1: 'печатается',
  2: 'нет в сборке',
  3: 'битое',
  4: 'неясное',
};

const groupClass = (g: PrintGroup) => styles[`g${g}`];

function waiting(state: 'queued' | 'running', position?: number) {
  return state === 'running' ? 'проверяется' : position ? `в очереди, ${position}-я` : 'в очереди';
}

/** Значок в строке библиотеки: итог проверки печати или «в проверке» */
export function PrintBadge({ id, updatedAt }: { id: string; updatedAt: number }) {
  const { data } = usePrintChecks();
  const v = printView(data, id, updatedAt);
  if (!v) return null;
  if (v.state === 'done' && v.item?.current) {
    const g = v.item.current.schematic.group;
    return (
      <span className={cx(styles.badge, groupClass(g))} title={`Проверка печати пушкой: ${PRINT_STATUS[g].text}`}>
        {SHORT[g]}
      </span>
    );
  }
  const prev = v.item?.previous?.schematic.group;
  return (
    <span
      className={styles.badge}
      title={`Проверка печати пушкой: ${waiting(v.state as 'queued' | 'running', v.item?.position)}${prev ? `; прошлая — ${PRINT_STATUS[prev].text}` : ''}`}
    >
      {waiting(v.state as 'queued' | 'running', v.item?.position)}
    </span>
  );
}

/** Блок «Проверка печати» в панели схемы */
export function PrintCheckBlock({ id, updatedAt }: { id: string; updatedAt: number }) {
  const { data, error } = usePrintChecks();
  const v = printView(data, id, updatedAt);
  return (
    <div className={styles.block}>
      <h4>Проверка печати пушкой</h4>
      {!v ? (
        <p className="faint small">
          {error && error !== NO_KEY
            ? `Сервер сборки не ответил: ${error}`
            : 'Статус виден после входа с ключом игрока.'}
        </p>
      ) : v.state === 'done' && v.item?.current ? (
        <CheckRecord rec={v.item.current} />
      ) : (
        <>
          <p className="small">
            <span className={styles.badge}>{waiting(v.state as 'queued' | 'running', v.item?.position)}</span>{' '}
            <span className="faint">
              {v.state === 'running'
                ? 'стенд сейчас печатает её на плоском мире'
                : 'схема новая, изменилась или вышла новая сборка/аддон — стенд проверит её по очереди'}
            </span>
          </p>
          {v.item?.previous && (
            <div className={styles.previous}>
              <p className="faint small">Прошлая проверка:</p>
              <CheckRecord rec={v.item.previous} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CheckRecord({ rec }: { rec: PrintRecord }) {
  const s = rec.schematic;
  const site = s.sites.find((x) => x.mode === 'survival') ?? s.sites[0];
  return (
    <>
      <p className="small">
        <span className={cx(styles.badge, groupClass(s.group))}>{PRINT_STATUS[s.group].text}</span>{' '}
        <span className="faint">
          {timeAgo(Date.parse(rec.checkedAt))}, сборка {rec.snapshot ?? '?'}
          {rec.addons.length ? ` с аддонами (${rec.addons.length})` : ''}
        </span>
      </p>
      {site?.toPlace != null && (
        <p className="faint small">
          {site.mismatch
            ? `Не совпало со схемой ${site.mismatch} из ${site.toPlace} клеток`
            : `Все ${site.toPlace} клеток совпали со схемой`}
          {site.sec != null ? `, печать ${site.sec} с` : ''}
          {site.restart
            ? site.restart.placed
              ? `; повторный запуск поставил ещё ${site.restart.placed}`
              : '; повторный запуск ничего не тратит'
            : ''}
          .
        </p>
      )}
      <Problems schematic={s} />
      {site?.spent && <Spent spent={site.spent} required={site.required ?? null} />}
    </>
  );
}

function BlockName({ id }: { id: string }) {
  const items = useItems();
  return (
    <span className={styles.spentName}>
      <ItemIcon id={id} size={18} />
      <span>
        {itemName(blockEntry(items, id), id)} <span className={styles.code}>{id}</span>
      </span>
    </span>
  );
}

/** Причины групп 2–4 по блокам; группа 2 — свёрнута (её же видно в редакторе) */
function Problems({ schematic }: { schematic: PrintSchematic }) {
  const all = schematic.sites.flatMap((x) => x.problems);
  return ([2, 3, 4] as const).map((g) => {
    const ps = all.filter((p) => p.group === g);
    if (!ps.length) return null;
    const cells = ps.reduce((n, p) => n + (p.cells || 0), 0);
    return (
      <details key={g} className={styles.group} open={g > 2}>
        <summary className={cx(styles.badge, groupClass(g))}>
          {PRINT_STATUS[g].text}: причин {ps.length}
          {cells ? `, клеток ${cells}` : ''}
        </summary>
        <ul className={styles.problems}>
          {ps.map((p, i) => (
            <li key={i} className={styles.problem}>
              <div className={styles.problemHead}>
                {p.block && <BlockName id={p.block} />}
                {p.from && (
                  <>
                    <span className="faint">на месте</span>
                    <BlockName id={p.from} />
                  </>
                )}
                {p.cells > 0 && <span className="faint small">клеток: {p.cells}</span>}
              </div>
              <span className="small">
                {p.text} <span className={styles.code}>{p.code}</span>
              </span>
              {PRINT_HINTS[p.code] && <span className="faint small">{PRINT_HINTS[p.code]}</span>}
              {p.example && <pre className={styles.example}>{p.example}</pre>}
            </li>
          ))}
        </ul>
      </details>
    );
  });
}

/** Точный расход на стенде (выживание: бочки с ровно нужными предметами) */
function Spent({ spent, required }: { spent: Record<string, number>; required: Record<string, number> | null }) {
  const rows = Object.entries(spent)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!rows.length) return null;
  const total = rows.reduce((n, [, x]) => n + x, 0);
  return (
    <details className={styles.group}>
      <summary>
        Расход материалов на печать: {total} шт., {rows.length} видов
      </summary>
      <ul className={styles.spent}>
        {rows.map(([id, n]) => (
          <li key={id}>
            <BlockName id={id} />
            <span title={required?.[id] != null && required[id] !== n ? `по схеме нужно ${required[id]}` : undefined}>
              {n}
              {required?.[id] != null && required[id] !== n ? ` (по схеме ${required[id]})` : ''}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
