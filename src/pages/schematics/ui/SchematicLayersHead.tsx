import { Layers, Redo2, RotateCcw, Undo2, X } from 'lucide-react';
import { Button } from '@/shared/ui';
import styles from './SchematicLayers/SchematicLayers.module.css';

interface Props {
  fileName: string;
  sx: number;
  sy: number;
  sz: number;
  undoCount: number;
  redoCount: number;
  canRevert: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRevert: () => void;
  onClose: () => void;
}

/** Шапка редактора слоёв: имя и размер схемы, отмена/повтор, сброс правок, закрытие */
export function SchematicLayersHead({
  fileName,
  sx,
  sy,
  sz,
  undoCount,
  redoCount,
  canRevert,
  onUndo,
  onRedo,
  onRevert,
  onClose,
}: Props) {
  return (
    <div className={styles.head}>
      <Layers size={18} className="faint" />
      <h2 className="grow">
        {fileName}
        <span className="faint small">
          {' '}
          · {sx}×{sy}×{sz}
        </span>
      </h2>
      <Button size="sm" onClick={onUndo} disabled={!undoCount} title="Отменить (Ctrl+Z)">
        <Undo2 size={14} />
        Отменить
      </Button>
      <Button size="sm" onClick={onRedo} disabled={!redoCount} title="Повторить отменённое (Ctrl+Shift+Z или Ctrl+Y)">
        <Redo2 size={14} />
        Повторить
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRevert}
        disabled={!canRevert}
        title="Вернуть схему к виду до правок по слоям"
      >
        <RotateCcw size={14} />
        Сбросить правки
      </Button>
      <Button variant="ghost" icon onClick={onClose} aria-label="Закрыть">
        <X size={18} />
      </Button>
    </div>
  );
}
