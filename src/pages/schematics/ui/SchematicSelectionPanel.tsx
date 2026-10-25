import { Sparkles, SquareDashedMousePointer, Star, Trash2, X } from 'lucide-react';
import { ItemPicker } from '@/shared/pack-data';
import { cx } from '@/shared/lib';
import { plural } from '../model/layerSelection';
import styles from './SchematicLayers.module.css';

interface Props {
  selectedCount: number;
  selectedOnLayer: number;
  selNote: string | null;
  smartBusy: boolean;
  favoritesCount: number;
  onDismissNote: () => void;
  onClear: () => void;
  onPick: (id: string) => void;
  onRemove: () => void;
  onSmart: () => void;
  onFavorites: () => void;
}

/** Панель выделения: сколько выбрано, замена, удаление, умная замена и избранное; строка итога */
export function SchematicSelectionPanel({
  selectedCount,
  selectedOnLayer,
  selNote,
  smartBusy,
  favoritesCount,
  onDismissNote,
  onClear,
  onPick,
  onRemove,
  onSmart,
  onFavorites,
}: Props) {
  return (
    <>
      {selectedCount === 0 && selNote && (
        <div className={cx(styles.selection, 'small')} role="status">
          <div className="row">
            <span className="grow faint">{selNote}</span>
            <button className="btn ghost sm icon" onClick={onDismissNote} aria-label="Скрыть">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {selectedCount > 0 && (
        <div className={cx(styles.selection, 'small')} role="region" aria-label="Выделение">
          <div className="row">
            <SquareDashedMousePointer size={15} className="faint" />
            <span className="grow">
              Выбрано <b>{selectedCount}</b> {plural(selectedCount)}
              {selectedOnLayer !== selectedCount && <span className="faint"> · на слое {selectedOnLayer}</span>}
            </span>
            <button className="btn ghost sm" onClick={onClear} title="Снять выделение (Esc)">
              Сбросить
            </button>
          </div>
          <div className="row">
            <span className="grow">
              <ItemPicker small blocksOnly placeholder="Заменить выбранные на…" onPick={(it) => onPick(it.i)} />
            </span>
            <button className="btn sm danger" onClick={onRemove} title="Убрать выбранные (Delete)">
              <Trash2 size={14} />
              Убрать
            </button>
          </div>
          <div className="row">
            <button
              className="btn ghost sm"
              onClick={onSmart}
              disabled={smartBusy}
              title="Подобрать замены для выбранных блоков — правилами или агентом, как настроена умная замена на странице"
            >
              <Sparkles size={14} />
              {smartBusy ? 'Подбираю…' : 'Умная замена'}
            </button>
            <button
              className="btn ghost sm"
              onClick={onFavorites}
              disabled={!favoritesCount}
              title="Поставить избранные замены в выбранные блоки (если вариантов несколько — первый)"
            >
              <Star size={14} />
              Из избранного
            </button>
          </div>
          {selNote && <div className="faint">{selNote}</div>}
        </div>
      )}
    </>
  );
}
