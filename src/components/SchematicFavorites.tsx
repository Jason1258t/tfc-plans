import { ArrowRight, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { replaceFavoritesStore } from '../data/store';
import { deriveVariants } from '../lib/replaceFavorites';
import { itemName, type ItemIndex } from '../lib/items';
import type { ReplaceFavorite } from '../types';
import { ItemIcon } from './ItemIcon';
import { Modal } from './Modal';

export interface Pair {
  from: string;
  to: string;
}

/** План подстановки избранного: у блока может быть несколько вариантов — тогда выбирает человек */
export interface PlanRow {
  from: string;
  count: number;
  options: string[];
}

const Block = ({ id, items }: { id: string; items: ItemIndex | null }) => (
  <span className="fav-block">
    <ItemIcon id={id} size={22} tip={false} />
    <span className="grow schem-names">
      <span className="schem-name">{itemName(items?.byId.get(id), id)}</span>
      <code className="schem-id">{id}</code>
    </span>
  </span>
);

/** Список избранных замен и кнопка «подставить в схемы» */
export function FavoritesPanel({
  favorites,
  items,
  applicable,
  onApply,
}: {
  favorites: ReplaceFavorite[];
  items: ItemIndex | null;
  /** Сколько блоков в загруженных схемах можно заменить избранным */
  applicable: number;
  onApply: () => void;
}) {
  const sorted = [...favorites].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return (
    <details className="schem-favs">
      <summary>
        <Star size={15} className="fav-star on" />
        <span>Избранные замены</span>
        <span className="faint small">{favorites.length}</span>
        <span className="grow" />
        <button
          className="btn sm primary"
          disabled={applicable === 0}
          onClick={(e) => {
            e.preventDefault();
            onApply();
          }}
          title="Подставить избранные замены в блоки загруженных схем, где замены ещё нет"
        >
          Подставить в схемы{applicable > 0 && ` (${applicable})`}
        </button>
      </summary>
      {sorted.length === 0 ? (
        <p className="faint small">
          Пусто. Замените блок и нажмите ★ рядом с заменой — она станет доступна во всех схемах.
        </p>
      ) : (
        <ul className="fav-list">
          {sorted.map((f) => (
            <li key={f.id} className="fav-row">
              <Block id={f.from} items={items} />
              <ArrowRight size={15} className="schem-arrow" />
              <Block id={f.to} items={items} />
              <button
                className="btn ghost sm icon"
                aria-label="Убрать из избранного"
                title="Убрать из избранного"
                onClick={() => replaceFavoritesStore.remove(f.id)}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** «Умное дополнение»: по примеру из избранного найти замены ступенек, плит и т. п. */
export function SmartAddDialog({
  pair,
  items,
  present,
  replace,
  favorites,
  nick,
  onClose,
  onApply,
}: {
  pair: Pair;
  items: ItemIndex;
  /** id блоков в загруженных схемах */
  present: Set<string>;
  replace: Map<string, string>;
  favorites: ReplaceFavorite[];
  nick: string;
  onClose: () => void;
  onApply: (pairs: Pair[]) => void;
}) {
  const variants = deriveVariants(pair.from, pair.to, items, present);
  const [checked, setChecked] = useState(
    () => new Set(variants.filter((v) => v.to && v.inSchematic).map((v) => v.from)),
  );
  const toggle = (id: string) =>
    setChecked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const save = () => {
    const wanted: Pair[] = [
      pair,
      ...variants.filter((v) => v.to && checked.has(v.from)).map((v) => ({ from: v.from, to: v.to! })),
    ];
    for (const p of wanted) {
      if (!favorites.some((f) => f.from === p.from && f.to === p.to))
        replaceFavoritesStore.add({ from: p.from, to: p.to, updatedBy: nick });
    }
    // Заменяем только то, что есть в схемах и ещё не заменено вручную
    onApply(wanted.filter((p) => present.has(p.from) && !replace.has(p.from)));
    onClose();
  };

  return (
    <Modal
      onClose={onClose}
      title="Добавить в избранное"
      footer={
        <>
          <span className="faint small grow">Отмеченные замены будут добавлены в избранное и применены к схемам</span>
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={save}>
            Добавить
          </button>
        </>
      }
    >
      <div className="fav-row main">
        <Block id={pair.from} items={items} />
        <ArrowRight size={15} className="schem-arrow" />
        <Block id={pair.to} items={items} />
      </div>
      {variants.length > 0 && (
        <>
          <p className="small faint">
            Такие же замены для производных блоков. Отмечены те, что есть в загруженных схемах.
          </p>
          <ul className="fav-list">
            {variants.map((v) => {
              const exists = v.to && favorites.some((f) => f.from === v.from && f.to === v.to);
              return (
                <li key={v.from} className="fav-row">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={checked.has(v.from) && !!v.to}
                      disabled={!v.to}
                      onChange={() => toggle(v.from)}
                    />
                  </label>
                  <Block id={v.from} items={items} />
                  <ArrowRight size={15} className="schem-arrow" />
                  {v.to ? <Block id={v.to} items={items} /> : <span className="faint small">в сборке нет аналога</span>}
                  <span className="faint small fav-note">
                    {exists ? 'уже в избранном' : v.inSchematic ? 'есть в схеме' : 'нет в схемах'}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Modal>
  );
}

/** Пакетная подстановка избранного; где вариантов несколько — выбор */
export function ApplyFavoritesDialog({
  plan,
  items,
  onClose,
  onApply,
}: {
  plan: PlanRow[];
  items: ItemIndex | null;
  onClose: () => void;
  onApply: (pairs: Pair[]) => void;
}) {
  const [choice, setChoice] = useState(() => new Map<string, string | null>(plan.map((r) => [r.from, r.options[0]])));
  const picked = plan.filter((r) => choice.get(r.from));
  const multi = plan.filter((r) => r.options.length > 1).length;
  return (
    <Modal
      onClose={onClose}
      title="Подставить избранные замены"
      footer={
        <>
          <span className="faint small grow">
            {multi > 0
              ? `У ${multi} блоков несколько вариантов — выберите нужный`
              : 'Снимите галочку, чтобы пропустить блок'}
          </span>
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn primary"
            disabled={picked.length === 0}
            onClick={() => {
              onApply(picked.map((r) => ({ from: r.from, to: choice.get(r.from)! })));
              onClose();
            }}
          >
            Подставить ({picked.length})
          </button>
        </>
      }
    >
      <ul className="fav-list">
        {plan.map((r) => (
          <li key={r.from} className="fav-row stacked">
            <div className="fav-row">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={!!choice.get(r.from)}
                  onChange={(e) => setChoice((m) => new Map(m).set(r.from, e.target.checked ? r.options[0] : null))}
                />
              </label>
              <Block id={r.from} items={items} />
              <span className="faint small fav-note">×{r.count}</span>
            </div>
            <div className="fav-options">
              {r.options.map((o) => (
                <label key={o} className="fav-option">
                  <input
                    type={r.options.length > 1 ? 'radio' : 'checkbox'}
                    name={`fav-${r.from}`}
                    checked={choice.get(r.from) === o}
                    onChange={() => setChoice((m) => new Map(m).set(r.from, o))}
                  />
                  <ArrowRight size={14} className="schem-arrow" />
                  <Block id={o} items={items} />
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
