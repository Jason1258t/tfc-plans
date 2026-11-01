import type { CellInfo } from '@/entities/schematic';
import { cx } from '@/shared/lib';
import styles from './SchematicLayers/SchematicLayers.module.css';

interface Props {
  info: CellInfo;
  /** Что стоит в клетке с учётом общей замены */
  target: string;
  label: (id: string) => string;
}

/** Подсказка над клеткой: что за блок (с учётом общей замены), координаты и свойства */
export function SchematicHoverInfo({ info, target, label }: Props) {
  return (
    <div className={cx(styles.hover, 'small')}>
      <b>{label(target)}</b>
      <code>{target}</code>
      {target !== info.key && <span className="faint">в исходнике: {info.key}</span>}
      <span className="faint">
        x {info.pos[0]}, y {info.pos[1]}, z {info.pos[2]}
        {info.props.length > 0 && ` · ${info.props.map(([k, v]) => `${k}=${v}`).join(', ')}`}
      </span>
    </div>
  );
}
