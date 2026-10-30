import { Box, ChevronDown, ChevronUp, Layers, Maximize, Minus, Plus } from 'lucide-react';
import { cx } from '@/shared/lib';
import { Button } from '@/shared/ui';
import section from '../SchematicsSection.module.css';
import styles from './SchematicLayers/SchematicLayers.module.css';

interface Props {
  mode: '2d' | '3d';
  onMode2d: () => void;
  onMode3d: () => void;
  layerY: number;
  sy: number;
  layerTotal: number;
  onStep: (d: number) => void;
  onLayerChange: (y: number) => void;
  ghost: boolean;
  onGhost: (v: boolean) => void;
  cut: boolean;
  onCut: (v: boolean) => void;
  textured: boolean;
  onTextured: (v: boolean) => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
}

/** Панель редактора слоёв: вид (слой/3D), выбор слоя, подсказки слоя и масштаб */
export function SchematicLayersToolbar({
  mode,
  onMode2d,
  onMode3d,
  layerY,
  sy,
  layerTotal,
  onStep,
  onLayerChange,
  ghost,
  onGhost,
  cut,
  onCut,
  textured,
  onTextured,
  onZoom,
  onFit,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.mode} role="tablist" aria-label="Вид">
        <Button
          role="tab"
          aria-selected={mode === '2d'}
          size="sm"
          className={cx(mode === '2d' && styles.on)}
          onClick={onMode2d}
        >
          <Layers size={14} />
          Слой
        </Button>
        <Button
          role="tab"
          aria-selected={mode === '3d'}
          size="sm"
          className={cx(mode === '3d' && styles.on)}
          onClick={onMode3d}
        >
          <Box size={14} />
          3D
        </Button>
      </div>
      <span className={styles.step}>
        <Button
          size="sm"
          icon
          onClick={() => onStep(-1)}
          disabled={layerY <= 0}
          aria-label="Слой ниже"
          title="Слой ниже"
        >
          <ChevronDown size={16} />
        </Button>
        <input
          type="range"
          className={styles.range}
          min={0}
          max={Math.max(0, sy - 1)}
          value={layerY}
          onChange={(e) => onLayerChange(Number(e.target.value))}
          aria-label="Слой"
        />
        <Button
          size="sm"
          icon
          onClick={() => onStep(1)}
          disabled={layerY >= sy - 1}
          aria-label="Слой выше"
          title="Слой выше"
        >
          <ChevronUp size={16} />
        </Button>
      </span>
      <span className={styles.y}>
        Слой <b>{layerY + 1}</b> из {sy}
      </span>
      <span className="faint small">{layerTotal} блоков</span>
      {mode === '2d' ? (
        <>
          <label
            className={cx('toggle', section.smToggle)}
            title="Бледно показывать блоки слоя ниже там, где на этом слое пусто"
          >
            <input type="checkbox" checked={ghost} onChange={(e) => onGhost(e.target.checked)} />
            Слой ниже
          </label>
          <span className="grow" />
          <Button variant="ghost" size="sm" icon onClick={() => onZoom(1 / 1.4)} aria-label="Мельче">
            <Minus size={15} />
          </Button>
          <Button variant="ghost" size="sm" icon onClick={() => onZoom(1.4)} aria-label="Крупнее">
            <Plus size={15} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onFit} title="Вписать схему в окно">
            <Maximize size={14} />
            Вписать
          </Button>
        </>
      ) : (
        <>
          <label className={cx('toggle', section.smToggle)} title="Скрыть слои выше выбранного — заглянуть внутрь">
            <input type="checkbox" checked={cut} onChange={(e) => onCut(e.target.checked)} />
            Срез по слою
          </label>
          <label
            className={cx('toggle', section.smToggle)}
            title="Текстуры блоков; без них — средний цвет текстуры, проще и быстрее"
          >
            <input type="checkbox" checked={textured} onChange={(e) => onTextured(e.target.checked)} />
            Текстуры
          </label>
          <span className="grow" />
        </>
      )}
    </div>
  );
}
