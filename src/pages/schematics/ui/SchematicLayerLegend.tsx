import { Trash2 } from 'lucide-react';
import { ItemIcon } from '@/shared/pack-data';
import { REMOVE } from '@/entities/schematic';
import { cx } from '@/shared/lib';
import styles from './SchematicLayers/SchematicLayers.module.css';

interface Props {
  entries: [string, number][];
  highlight: string | null;
  onHighlight: (id: string | null) => void;
  label: (id: string) => string;
}

/** Легенда текущего слоя: блоки (с общими заменами) и их количество; наведение подсвечивает клетки */
export function SchematicLayerLegend({ entries, highlight, onHighlight, label }: Props) {
  return (
    <aside className={styles.legend}>
      <h3 className="small">На этом слое</h3>
      {entries.length === 0 && <p className="faint small">Пусто</p>}
      <ul>
        {entries.map(([id, n]) => (
          <li
            key={id}
            className={cx(highlight === id && styles.on)}
            onMouseEnter={() => onHighlight(id)}
            onMouseLeave={() => onHighlight(null)}
            title={id}
          >
            {id === REMOVE ? <Trash2 size={18} className="faint" /> : <ItemIcon id={id} size={20} tip={false} />}
            <span className="grow">{label(id)}</span>
            <span className="faint">×{n}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
