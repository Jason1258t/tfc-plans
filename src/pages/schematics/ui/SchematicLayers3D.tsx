import type { Schematic, Vec } from '@/entities/schematic';
import { SchematicView3D } from '@/widgets/schematic-view';
import { cx } from '@/shared/lib';
import styles from './SchematicLayers/SchematicLayers.module.css';

interface Props {
  schematic: Schematic;
  replace: Map<string, string>;
  /** Срез: слои выше не показываются */
  maxY?: number;
  textured: boolean;
  selected: Vec[];
  onPick: (pos: Vec | null, e: { shiftKey: boolean; timeStamp: number }) => void;
  onHover: (pos: Vec | null) => void;
  onFrame: (inFrame: (pos: Vec) => boolean, e: { shiftKey: boolean }) => void;
}

/** 3D-вид схемы (three.js отдельным куском) и подсказка управления; пока грузится — надпись */
export function SchematicLayers3D({ schematic, replace, maxY, textured, selected, onPick, onHover, onFrame }: Props) {
  return (
    <>
      <SchematicView3D
        schematic={schematic}
        replace={replace}
        maxY={maxY}
        textured={textured}
        selected={selected}
        onPick={onPick}
        onHover={onHover}
        onFrame={onFrame}
      />
      <div className={cx(styles.hint, 'faint', 'small')}>
        Клик — выделить блок · двойной клик — группу · рамка ЛКМ — выделить объект (без пола и стен) · Shift — добавить,
        повторно — снять · Delete — убрать · зажатое колесо (или Alt+ЛКМ) — вращать вокруг точки под курсором · ПКМ —
        сдвигать · колесо — масштаб · ↑↓ — слой среза · блоки по моделям из сборки, у части блоков — упрощённая форма
      </div>
    </>
  );
}
