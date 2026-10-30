import { Search, Trash2 } from 'lucide-react';
import { ItemIcon } from '@/shared/pack-data';
import { REMOVE } from '@/entities/schematic';
import { cx } from '@/shared/lib';
import { Segmented } from '@/shared/ui';
import styles from './SchematicLayers/SchematicLayers.module.css';

export type LegendScope = 'layer' | 'all';

interface Props {
  entries: [string, number][];
  scope: LegendScope;
  onScope: (s: LegendScope) => void;
  query: string;
  onQuery: (q: string) => void;
  highlight: string | null;
  onHighlight: (id: string | null) => void;
  /** Выделены только блоки этого вида — строка отмечена */
  selectedId: string | null;
  /** Щелчок — выделить все такие блоки (на слое или во всей схеме) */
  onSelect: (id: string) => void;
  label: (id: string) => string;
}

/**
 * Материалы: блоки слоя или всей схемы (с общими заменами) и их количество, поиск по названию и id. Наведение
 * подсвечивает клетки слоя, щелчок выделяет все такие же блоки — их видно и в 3D.
 */
export function SchematicLayerLegend({
  entries,
  scope,
  onScope,
  query,
  onQuery,
  highlight,
  onHighlight,
  selectedId,
  onSelect,
  label,
}: Props) {
  return (
    <aside className={styles.legend} aria-label="Материалы">
      <Segmented
        label="Какие блоки"
        value={scope}
        onChange={onScope}
        options={[
          { value: 'layer', label: 'Этот слой' },
          { value: 'all', label: 'Вся схема' },
        ]}
      />
      <label className={styles.legendSearch}>
        <Search size={14} className="faint" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Найти блок…"
          aria-label="Найти блок на схеме"
        />
      </label>
      {entries.length === 0 && <p className="faint small">{query ? 'Не нашлось' : 'Пусто'}</p>}
      <ul>
        {entries.map(([id, n]) => (
          <li key={id}>
            <button
              type="button"
              className={cx(highlight === id && styles.on, selectedId === id && styles.picked)}
              aria-pressed={selectedId === id}
              onMouseEnter={() => onHighlight(id)}
              onMouseLeave={() => onHighlight(null)}
              onClick={() => onSelect(id)}
              title={`${id} — выделить все такие${scope === 'layer' ? ' на слое' : ''}`}
            >
              {id === REMOVE ? <Trash2 size={18} className="faint" /> : <ItemIcon id={id} size={20} tip={false} />}
              <span className="grow">{label(id)}</span>
              <span className="faint">×{n}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
