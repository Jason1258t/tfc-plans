import { SquareDashedMousePointer, Trash2, X } from 'lucide-react';
import type { ItemIndex } from '@/shared/pack-data';
import type { CellInfo } from '@/entities/schematic';
import { cx } from '@/shared/lib';
import { Button } from '@/shared/ui';
import { BlockIcon } from './BlockIcon';
import { TargetPicker } from './TargetPicker';
import styles from './SchematicLayers/SchematicLayers.module.css';

export type Scope = 'cell' | 'layer' | 'all';
const SCOPES: [Scope, string][] = [
  ['cell', 'Этот блок'],
  ['layer', 'Такие же на слое'],
  ['all', 'Все такие (общая замена)'],
];

interface Props {
  menu: { left: number; top: number };
  info: CellInfo;
  /** Что стоит в клетке с учётом общей замены */
  target: string;
  items: ItemIndex | null;
  label: (id: string) => string;
  replace: Map<string, string>;
  scope: Scope;
  onScope: (scope: Scope) => void;
  sameOnLayer: number;
  onPick: (id: string) => void;
  onClose: () => void;
  menuSelected: boolean;
  onToggleSelect: () => void;
  onSelectGroup: () => void;
  menuGroupLength: number;
  onRemove: () => void;
  onClearGlobal: () => void;
}

/** Окно замены блока на слое: что за блок, к чему применить, выбор предмета, выделение и удаление */
export function SchematicLayerMenu({
  menu,
  info,
  target,
  items,
  label,
  replace,
  scope,
  onScope,
  sameOnLayer,
  onPick,
  onClose,
  menuSelected,
  onToggleSelect,
  onSelectGroup,
  menuGroupLength,
  onRemove,
  onClearGlobal,
}: Props) {
  return (
    <div className={styles.menu} style={{ left: menu.left, top: menu.top }}>
      <div className="row">
        <BlockIcon id={target} size={28} />
        <span className={cx('grow', styles.menuNames)}>
          <span>{label(target)}</span>
          <code>{target}</code>
        </span>
        <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Закрыть окно">
          <X size={15} />
        </Button>
      </div>
      <div className="faint small">
        x {info.pos[0]}, y {info.pos[1]}, z {info.pos[2]}
        {target !== info.key && <> · в исходнике {info.key}</>}
        {info.props.length > 0 && <> · {info.props.map(([k, v]) => `${k}=${v}`).join(', ')}</>}
      </div>
      <div className={styles.scope} role="radiogroup" aria-label="К чему применить">
        {SCOPES.map(([k, option]) => (
          <label key={k} className="small">
            <input type="radio" name="layers-scope" checked={scope === k} onChange={() => onScope(k)} />
            {option}
            {k === 'layer' && <span className="faint"> ({sameOnLayer})</span>}
          </label>
        ))}
      </div>
      <TargetPicker source={info.key} items={items} replace={replace} placeholder="Заменить на…" onTarget={onPick} />
      <div className={cx('row', styles.menuSelect)}>
        <Button variant="ghost" size="sm" onClick={onToggleSelect}>
          <SquareDashedMousePointer size={14} />
          {menuSelected ? 'Снять выделение' : 'Выделить'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectGroup}
          title="Соединённые блоки этого вида на слое — добавить к выделению"
        >
          Выделить группу <span className="faint">({menuGroupLength})</span>
        </Button>
      </div>
      <div className="row">
        <Button variant="danger" size="sm" onClick={onRemove}>
          <Trash2 size={14} />
          Убрать
        </Button>
        {scope === 'all' && replace.has(info.key) && (
          <Button variant="ghost" size="sm" onClick={onClearGlobal}>
            Отменить общую замену
          </Button>
        )}
      </div>
      {scope === 'all' && (
        <p className={cx('faint', 'small', styles.note)}>
          Общая замена — как в списке блоков: для всех открытых схем, по {info.key}.
        </p>
      )}
    </div>
  );
}
