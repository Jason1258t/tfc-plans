import { SquareDashedMousePointer, Trash2, X } from 'lucide-react';
import { ItemIcon, ItemPicker } from '@/shared/pack-data';
import type { CellInfo } from '@/lib/schematicEdit';
import { cx } from '@/shared/lib';
import styles from './SchematicLayers.module.css';

export type Scope = 'cell' | 'layer' | 'all';
const SCOPES: [Scope, string][] = [
  ['cell', 'Этот блок'],
  ['layer', 'Такие же на слое'],
  ['all', 'Все такие (общая замена)'],
];

interface Props {
  menu: { left: number; top: number };
  info: CellInfo;
  effective: (name: string) => string;
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
  effective,
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
        <ItemIcon id={effective(info.name)} size={28} />
        <span className={cx('grow', styles.menuNames)}>
          <span>{label(effective(info.name))}</span>
          <code>{effective(info.name)}</code>
        </span>
        <button className="btn ghost sm icon" onClick={onClose} aria-label="Закрыть окно">
          <X size={15} />
        </button>
      </div>
      <div className="faint small">
        x {info.pos[0]}, y {info.pos[1]}, z {info.pos[2]}
        {effective(info.name) !== info.name && <> · в исходнике {info.name}</>}
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
      <ItemPicker small blocksOnly autoFocus placeholder="Заменить на…" onPick={(it) => onPick(it.i)} />
      <div className={cx('row', styles.menuSelect)}>
        <button className="btn ghost sm" onClick={onToggleSelect}>
          <SquareDashedMousePointer size={14} />
          {menuSelected ? 'Снять выделение' : 'Выделить'}
        </button>
        <button
          className="btn ghost sm"
          onClick={onSelectGroup}
          title="Соединённые блоки этого вида на слое — добавить к выделению"
        >
          Выделить группу <span className="faint">({menuGroupLength})</span>
        </button>
      </div>
      <div className="row">
        <button className="btn sm danger" onClick={onRemove}>
          <Trash2 size={14} />
          Убрать
        </button>
        {scope === 'all' && replace.has(info.name) && (
          <button className="btn ghost sm" onClick={onClearGlobal}>
            Отменить общую замену
          </button>
        )}
      </div>
      {scope === 'all' && (
        <p className={cx('faint', 'small', styles.note)}>
          Общая замена — как в списке блоков: для всех открытых схем, по id {info.name}.
        </p>
      )}
    </div>
  );
}
