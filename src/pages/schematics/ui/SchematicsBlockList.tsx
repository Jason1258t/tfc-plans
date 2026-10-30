import { ArrowRight, Sparkles, Star, Trash2, X } from 'lucide-react';
import { ItemIcon, ItemPicker, blockEntry, isBlock, itemName, type ItemIndex } from '@/shared/pack-data';
import { REMOVE } from '@/entities/schematic';
import type { ReplaceFavorite } from '@/entities/schematic';
import { cx } from '@/shared/lib';
import { Button, Tag } from '@/shared/ui';
import section from '../SchematicsSection.module.css';
import styles from '../SchematicsPage/SchematicsPage.module.css';

/** Мод предмета — у одноимённых предметов (TFC и ванильный «Медный люк») различается только он */
const modOf = (id: string) => id.split(':')[0];

interface Props {
  shown: { id: string; count: number }[];
  replace: Map<string, string>;
  items: ItemIndex | null;
  /** id блока, у которого открыт выбор замены */
  picking: string | null;
  /** Пояснения агента к выбранным им заменам */
  reasons: Map<string, string>;
  /** Запасные варианты агента: переключение в один клик */
  alts: Map<string, string[]>;
  favorites: ReplaceFavorite[] | null;
  onPick: (id: string | null) => void;
  onTarget: (id: string, to: string | null) => void;
  onSwapAlt: (id: string, alt: string) => void;
  onToggleFavorite: (id: string, to: string) => void;
}

/** Список блоков схем с заменами: исходник, стрелка, цель (выбор, удаление, избранное, запасные варианты) */
export function SchematicsBlockList({
  shown,
  replace,
  items,
  picking,
  reasons,
  alts,
  favorites,
  onPick,
  onTarget,
  onSwapAlt,
  onToggleFavorite,
}: Props) {
  return (
    <ul className={styles.blocks}>
      {shown.map(({ id, count }) => {
        const known = blockEntry(items, id);
        const to = replace.get(id);
        return (
          <li key={id} className={cx(styles.row, to && styles.replaced, to === REMOVE && styles.removed)}>
            <div className={styles.src}>
              <ItemIcon id={id} size={28} />
              <span className={cx('grow', section.names)}>
                <span className={cx(section.name, to === REMOVE && styles.nameStruck)}>
                  {known ? itemName(known) : id.split(':').pop()}
                </span>
                <code className={section.id}>{id}</code>
              </span>
              {!known && <Tag>нет в сборке</Tag>}
              <span className={styles.count}>×{count}</span>
            </div>
            <ArrowRight size={16} className={cx(section.arrow, to && section.arrowAccent)} />
            <div className={styles.dst}>
              {picking === id ? (
                <div className="row grow">
                  <div className="grow">
                    <ItemPicker
                      small
                      blocksOnly
                      autoFocus
                      placeholder="На что заменить…"
                      onPick={(it) => {
                        onTarget(id, it.i);
                        onPick(null);
                      }}
                    />
                  </div>
                  <Button variant="ghost" size="sm" icon onClick={() => onPick(null)} aria-label="Отмена">
                    <X size={15} />
                  </Button>
                </div>
              ) : to === REMOVE ? (
                <>
                  <span className={cx(styles.target, styles.removed)}>
                    <Trash2 size={18} className="faint" />
                    <span className={cx('grow', section.names)}>
                      <span className={section.name}>Удалён из схемы</span>
                      <span className="faint small">принтер не будет ставить этот блок</span>
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    onClick={() => onTarget(id, null)}
                    aria-label="Вернуть блок"
                    title="Вернуть блок"
                  >
                    <X size={15} />
                  </Button>
                </>
              ) : to ? (
                <>
                  <button
                    className={styles.target}
                    onClick={() => onPick(id)}
                    title={reasons.get(id) ? `Агент: ${reasons.get(id)}` : 'Выбрать другой'}
                  >
                    <ItemIcon id={to} size={28} />
                    <span className={cx('grow', section.names)}>
                      <span className={section.name}>{itemName(blockEntry(items, to), to)}</span>
                      <code className={section.id}>{to}</code>
                    </span>
                    <Tag className={cx(styles.modTag, modOf(to) !== modOf(id) && styles.modChanged)}>{modOf(to)}</Tag>
                    {reasons.get(id) && <Sparkles size={13} className="ai-ico" aria-label="Выбрано агентом" />}
                  </button>
                  {(() => {
                    const fav = favorites?.find((f) => f.from === id && f.to === to);
                    return (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon
                        onClick={() => onToggleFavorite(id, to)}
                        aria-label={fav ? 'Убрать из избранного' : 'В избранное'}
                        title={fav ? 'В избранном — нажмите, чтобы убрать' : 'В избранное (с умным дополнением)'}
                      >
                        <Star size={15} className={cx(styles.favStar, fav && styles.on)} />
                      </Button>
                    );
                  })()}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    onClick={() => onTarget(id, null)}
                    aria-label="Отменить замену"
                    title="Отменить замену"
                  >
                    <X size={15} />
                  </Button>
                  {(alts.get(id)?.length ?? 0) > 0 && (
                    <div className={styles.alts}>
                      <span className="faint small">ещё:</span>
                      {alts.get(id)!.map((alt) => (
                        <button
                          key={alt}
                          className={styles.altChip}
                          onClick={() => onSwapAlt(id, alt)}
                          title={`Заменить на ${alt}`}
                        >
                          <ItemIcon id={alt} size={16} tip={false} />
                          <span>{itemName(blockEntry(items, alt), alt)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {(() => {
                    const opts = [...new Set((favorites ?? []).filter((f) => f.from === id).map((f) => f.to))].filter(
                      (t) => isBlock(items, t),
                    );
                    return opts.length > 0 ? (
                      <span className={styles.favChips}>
                        {opts.map((t) => (
                          <button
                            key={t}
                            className={styles.favChip}
                            onClick={() => onTarget(id, t)}
                            title={`Из избранного: ${t}`}
                          >
                            <Star size={12} className={cx(styles.favStar, styles.on)} />
                            <ItemIcon id={t} size={18} tip={false} />
                            <span>{itemName(blockEntry(items, t), t)}</span>
                          </button>
                        ))}
                      </span>
                    ) : null;
                  })()}
                  <Button variant="ghost" size="sm" className={styles.choose} onClick={() => onPick(id)}>
                    Выбрать замену…
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    onClick={() => onTarget(id, REMOVE)}
                    aria-label="Убрать блок из схемы"
                    title="Убрать блок из схемы"
                  >
                    <Trash2 size={15} />
                  </Button>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
