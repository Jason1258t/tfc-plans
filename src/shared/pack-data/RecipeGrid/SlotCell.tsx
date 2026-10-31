import { type ReactNode } from 'react';
import { cx } from '@/shared/lib';
import { tooltipHandlers } from '@/shared/ui';
import { ItemIcon } from '../ItemIcon';
import { itemName, type ItemIndex } from '../items';
import type { GridSlot } from '../craftGrid';
import type { TagCatalog } from '../tags';
import styles from './RecipeGrid.module.css';

/** Ведро (или другая ёмкость) с этой жидкостью: у TFC — tfc:bucket/<жидкость>, у ванили и модов — <жидкость>_bucket */
function fluidIcon(id: string, items: ItemIndex | null): string {
  if (id.startsWith('#')) return 'minecraft:bucket';
  const [ns, path] = id.includes(':') ? id.split(':') : ['minecraft', id];
  return (
    [`${ns}:bucket/${path}`, `${ns}:${path}_bucket`, `minecraft:${path}_bucket`, `tfc:bucket/${path}`].find((c) =>
      items?.byId.has(c),
    ) ?? 'minecraft:bucket'
  );
}

/** Название жидкости; нет в списке жидкостей (молоко NeoForge) — по названию её ведра */
const fluidName = (id: string, tags: TagCatalog, bucket: string | null) => {
  if (id.startsWith('#')) return `любая из #${id.slice(1)}`;
  const f = tags.fluidById.get(id);
  return f ? (f.r ?? f.e) : (bucket ?? id);
};

const fmtAmount = (mb: number) => (mb >= 1000 && mb % 100 === 0 ? `${mb / 1000}B` : String(mb));

/**
 * Клетка рецепта: предмет (варианты тега листаются, состав — в подсказке), жидкость или особый ингредиент мода.
 * Общая для сетки крафта и раскладок станций.
 */
export function SlotCell({
  slot,
  tick,
  tags,
  items,
  count,
  chance,
  role,
  note,
  out,
  fluidInSlot,
}: {
  slot: GridSlot | null;
  tick: number;
  tags: TagCatalog;
  items: ItemIndex | null;
  count?: number;
  chance?: number;
  /** Подпись под клеткой: «форма», «в руке» */
  role?: string;
  /** Пояснение в подсказке: «тот же предмет, что на входе» */
  note?: string;
  /** Клетка результата: крупнее */
  out?: boolean;
  /** Жидкость сама по себе (станция), а не ёмкость с ней в сетке крафта */
  fluidInSlot?: boolean;
}) {
  const name = (id: string) => itemName(items?.byId.get(id), id);
  const extra = [
    count && count > 1 ? `×${count}` : '',
    chance !== undefined ? `шанс ${Math.round(chance * 1000) / 10} %` : '',
    role ?? '',
  ]
    .filter(Boolean)
    .join(', ');
  const wrap = (cell: ReactNode) =>
    role ? (
      <span className={styles.slotWrap}>
        {cell}
        <span className={styles.role}>{role}</span>
      </span>
    ) : (
      cell
    );
  const badges = (
    <>
      {count !== undefined && count > 1 && <span className={styles.count}>{count}</span>}
      {chance !== undefined && <span className={styles.chance}>{Math.round(chance * 100) || '<1'}%</span>}
    </>
  );
  if (!slot) {
    if (note) {
      return wrap(
        <div
          className={cx(styles.cell, out && styles.out)}
          role="img"
          aria-label={note}
          {...tooltipHandlers(note, extra || undefined)}
        >
          <span className={styles.note}>{note.split(' ').slice(0, 2).join(' ')}</span>
          {badges}
        </div>,
      );
    }
    return <div className={cx(styles.cell, styles.empty)} aria-label="пусто" role="img" />;
  }
  const id = slot.options.length ? slot.options[tick % slot.options.length] : undefined;
  if (slot.fluid) {
    const f = slot.fluid;
    const icon = fluidIcon(f.id, items);
    const bucket = icon !== 'minecraft:bucket' ? `${name(icon)} (${f.id})` : null;
    const what = fluidName(f.id, tags, bucket);
    const text = `${fluidInSlot ? 'Жидкость' : 'Ёмкость с жидкостью'}: ${what}${f.amount ? `, ${f.amount} мБ` : ''}`;
    return wrap(
      <div
        className={cx(styles.cell, styles.many, styles.fluid, out && styles.out)}
        role="img"
        aria-label={text}
        {...tooltipHandlers(
          text,
          [fluidInSlot ? f.id : 'ведро, кувшин или другая ёмкость с этой жидкостью', extra].filter(Boolean).join(' · '),
        )}
      >
        <ItemIcon id={icon} size={32} tip={false} />
        {f.amount !== undefined && <span className={styles.count}>{fmtAmount(f.amount)}</span>}
        {chance !== undefined && <span className={styles.chance}>{Math.round(chance * 100) || '<1'}%</span>}
      </div>,
    );
  }
  const label = slot.tag
    ? `Любой из #${slot.tag}${slot.options.length ? ` (${slot.options.length})` : ''}`
    : slot.options.length > 1
      ? `Любой из ${slot.options.length}: ${slot.options.slice(0, 6).map(name).join(', ')}`
      : id
        ? name(id)
        : `Особый ингредиент мода: ${slot.unknown}`;
  const sub =
    slot.tag && slot.options.length
      ? slot.options.slice(0, 8).map(name).join(', ')
      : !id
        ? slot.tag
          ? 'состав тега сайт не знает — смотрите JEI в игре'
          : 'подходящие предметы задаёт код мода — смотрите JEI в игре'
        : id;
  return wrap(
    <div
      className={cx(styles.cell, (slot.tag || slot.options.length > 1) && styles.many, out && styles.out)}
      role="img"
      aria-label={[label, extra].filter(Boolean).join(', ')}
      {...tooltipHandlers(label, [sub, extra, note].filter(Boolean).join(' · '))}
    >
      {id ? (
        <ItemIcon id={id} size={32} tip={false} />
      ) : (
        // Тег без известного состава или особый ингредиент мода — подписываем хвостом id
        <span className={styles.unknown}>{(slot.tag ?? slot.unknown ?? '?').split(/[/:]/).pop()}</span>
      )}
      {slot.tag && <span className={styles.tagMark}>#</span>}
      {badges}
    </div>,
  );
}
