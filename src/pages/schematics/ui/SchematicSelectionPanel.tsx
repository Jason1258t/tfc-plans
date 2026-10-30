import { CopyCheck, Sparkles, SquareDashedMousePointer, Star, Trash2, X } from 'lucide-react';
import { ItemIcon, ItemPicker } from '@/shared/pack-data';
import { cx } from '@/shared/lib';
import { Button } from '@/shared/ui';
import { plural } from '../model/layerSelection';
import styles from './SchematicLayers/SchematicLayers.module.css';

interface Props {
  /** Все выделенные — одного вида: его id и название */
  selectedName: { id: string; label: string } | null;
  /** Выделить все такие же блоки во всей схеме */
  onSelectSame: () => void;
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
  selectedName,
  onSelectSame,
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
            <Button variant="ghost" size="sm" icon onClick={onDismissNote} aria-label="Скрыть">
              <X size={14} />
            </Button>
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
            <Button variant="ghost" size="sm" onClick={onClear} title="Снять выделение (Esc)">
              Сбросить
            </Button>
          </div>
          {selectedName && (
            <div className="row">
              <ItemIcon id={selectedName.id} size={20} tip={false} />
              <span className="grow">
                {selectedName.label} <code className="faint">{selectedName.id}</code>
              </span>
            </div>
          )}
          <div className="row">
            <span className="grow">
              <ItemPicker small blocksOnly placeholder="Заменить выбранные на…" onPick={(it) => onPick(it.i)} />
            </span>
            <Button variant="danger" size="sm" onClick={onRemove} title="Убрать выбранные (Delete)">
              <Trash2 size={14} />
              Убрать
            </Button>
          </div>
          <div className="row">
            <Button
              variant="ghost"
              size="sm"
              onClick={onSelectSame}
              title="Выделить во всей схеме все блоки того же вида, что выбранные"
            >
              <CopyCheck size={14} />
              Все такие же
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSmart}
              disabled={smartBusy}
              title="Подобрать замены для выбранных блоков — правилами или агентом, как настроена умная замена на странице"
            >
              <Sparkles size={14} />
              {smartBusy ? 'Подбираю…' : 'Умная замена'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onFavorites}
              disabled={!favoritesCount}
              title="Поставить избранные замены в выбранные блоки (если вариантов несколько — первый)"
            >
              <Star size={14} />
              Из избранного
            </Button>
          </div>
          {selNote && <div className="faint">{selNote}</div>}
        </div>
      )}
    </>
  );
}
