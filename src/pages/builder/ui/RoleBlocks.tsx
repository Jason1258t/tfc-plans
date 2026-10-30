import { ArrowUp, Plus, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Has } from '@tfc/core/building/families';
import { mixWeights } from '@tfc/core/building/fill';
import { GROUP_NAMES, rankSimilar, type GroupId, type Need } from '@tfc/core/building/similar';
import type { FillPattern, RoleFill } from '@tfc/core/building/spec';
import { ItemIcon, blockEntry, isBlock, itemName, searchItems, type ItemIndex } from '@/shared/pack-data';
import { Button, Input, Search, Select } from '@/shared/ui';
import { cx } from '@/shared/lib';
import type { ColorsState } from '../model/blockColors';
import styles from '../BuilderPage/BuilderPage.module.css';

interface Props {
  fill: RoleFill;
  degree: number;
  need?: Need[];
  items: ItemIndex;
  has: Has;
  colors: ColorsState;
  onChange: (fill: RoleFill) => void;
}

const PATTERNS: { value: FillPattern; label: string }[] = [
  { value: 'patches', label: 'пятнами' },
  { value: 'mix', label: 'вразброс' },
  { value: 'rows', label: 'рядами' },
];

/**
 * Блоки роли: выбранные (первый — основной, порядок задаёт доли), поиск любого блока и подборщик похожих.
 * Подборщик только предлагает — в роль попадает то, что отмечено «+».
 */
export function RoleBlocks({ fill, degree, need, items, has, colors, onChange }: Props) {
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const blocks = fill.blocks;
  const ids = new Set(blocks.map((b) => b.id));
  const shares = mixWeights(fill, fill.degree ?? degree);
  const found = useMemo(
    () =>
      q.trim().length >= 2
        ? searchItems(items, q, 40)
            .filter((it) => !it.h && isBlock(items, it.i))
            .slice(0, 12)
        : [],
    [items, q],
  );
  const groups = useMemo(
    () =>
      picking && colors.colors && blocks[0]
        ? rankSimilar(blocks[0].id, colors.colors, has, { need, limit: 10, exclude: new Set(blocks.map((b) => b.id)) })
        : null,
    [picking, colors.colors, blocks, has, need],
  );

  const set = (next: RoleFill['blocks']) => onChange({ ...fill, blocks: next });
  const add = (id: string) => !ids.has(id) && set([...blocks, { id }]);

  return (
    <div className={styles.roleBlocks}>
      <ul className={styles.chosen}>
        {blocks.map((b, i) => (
          <li key={b.id}>
            <ItemIcon id={b.id} size={22} />
            <span className={cx('grow', styles.blockName)}>
              {itemName(blockEntry(items, b.id), b.id)}
              <span className="faint small"> {b.id}</span>
            </span>
            <span className="faint small" title="Доля в смеси при текущей степени текстурирования">
              {i < shares.length ? `${Math.round(shares[i] * 100)}%` : 'не в смеси'}
            </span>
            <Input
              className={styles.weight}
              type="number"
              min={0}
              placeholder="вес"
              title="Вес вручную (пусто — по степени текстурирования)"
              value={b.w ?? ''}
              onChange={(e) =>
                set(
                  blocks.map((x, k) =>
                    k === i ? { id: x.id, ...(e.target.value ? { w: Number(e.target.value) } : {}) } : x,
                  ),
                )
              }
            />
            <Button
              variant="ghost"
              size="sm"
              icon
              disabled={i === 0}
              aria-label="Выше"
              title="Выше (первый — основной)"
              onClick={() => set(blocks.map((x, k) => (k === i - 1 ? blocks[i] : k === i ? blocks[i - 1] : x)))}
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label="Убрать"
              onClick={() => set(blocks.filter((_, k) => k !== i))}
            >
              <X size={14} />
            </Button>
          </li>
        ))}
        {!blocks.length && <li className="faint small">Блоков нет — роль берёт блоки родителя</li>}
      </ul>

      <div className={styles.roleTools}>
        <Search className="grow">
          <input
            value={q}
            placeholder="Добавить блок: название или id…"
            onChange={(e) => setQ(e.target.value)}
            aria-label="Поиск блока"
          />
        </Search>
        <Select
          value={fill.pattern ?? 'patches'}
          onChange={(e) => onChange({ ...fill, pattern: e.target.value as FillPattern })}
          aria-label="Как смешивать"
          title="Как смешивать блоки роли"
        >
          {PATTERNS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={!blocks.length} onClick={() => setPicking((v) => !v)} aria-pressed={picking}>
          <Sparkles size={14} />
          Подобрать
        </Button>
      </div>

      {found.length > 0 && (
        <ul className={styles.suggest}>
          {found.map((it) => (
            <li key={it.i}>
              <Button variant="ghost" size="sm" disabled={ids.has(it.i)} onClick={() => add(it.i)} title={it.i}>
                <ItemIcon id={it.i} size={20} tip={false} />
                {itemName(it)}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {picking && (
        <div className={styles.picker}>
          {!colors.colors && colors.needCompute && !colors.progress && (
            <p className="small">
              Цвета блоков ещё не выложены сервером сборки.{' '}
              <Button size="sm" onClick={colors.start}>
                Посчитать в браузере
              </Button>{' '}
              <span className="faint">(несколько тысяч маленьких текстур, один раз за сессию)</span>
            </p>
          )}
          {colors.progress && (
            <p className="small faint">
              Считаю цвета: {colors.progress.done} из {colors.progress.total}…
            </p>
          )}
          {!colors.colors && !colors.needCompute && <p className="small faint">Загружаю цвета блоков…</p>}
          {groups &&
            (Object.keys(groups) as GroupId[]).map((g) =>
              groups[g].length ? (
                <div key={g}>
                  <div className={cx('small', styles.groupName)}>{GROUP_NAMES[g]}</div>
                  <ul className={styles.suggest}>
                    {groups[g].map((s) => (
                      <li key={s.id}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => add(s.id)}
                          title={`${s.id} · разница цвета ${s.dE.toFixed(1)}, светлее на ${s.dL.toFixed(0)}`}
                        >
                          <Plus size={12} />
                          <ItemIcon id={s.id} size={20} tip={false} />
                          {itemName(blockEntry(items, s.id), s.id)}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          {groups && Object.values(groups).every((l) => !l.length) && (
            <p className="small faint">Для первого блока роли цвета не нашлось — выберите другой основной блок.</p>
          )}
        </div>
      )}
    </div>
  );
}
