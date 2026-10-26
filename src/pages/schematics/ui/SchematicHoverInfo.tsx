import type { CellInfo } from '@/entities/schematic';
import { cx } from '@/shared/lib';
import styles from './SchematicLayers.module.css';

interface Props {
  info: CellInfo;
  effective: (name: string) => string;
  label: (id: string) => string;
}

/** Подсказка над клеткой: что за блок (с учётом общей замены), координаты и свойства */
export function SchematicHoverInfo({ info, effective, label }: Props) {
  return (
    <div className={cx(styles.hover, 'small')}>
      <b>{label(effective(info.name))}</b>
      <code>{effective(info.name)}</code>
      {effective(info.name) !== info.name && <span className="faint">в исходнике: {info.name}</span>}
      <span className="faint">
        x {info.pos[0]}, y {info.pos[1]}, z {info.pos[2]}
        {info.props.length > 0 && ` · ${info.props.map(([k, v]) => `${k}=${v}`).join(', ')}`}
      </span>
    </div>
  );
}
