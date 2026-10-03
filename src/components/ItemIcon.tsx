import { iconUrl, itemName, textureUrl, useItems } from '../lib/items';
import { cx } from '../lib/util';
import { tooltipHandlers } from './Tooltip';

interface Props {
  /** id предмета (tfc:metal/ingot/copper) */
  id?: string;
  /** Либо прямой путь к текстуре внутри /icons (minecraft/item/book) */
  texture?: string;
  size?: number;
  /** Показывать подсказку с названием при наведении */
  tip?: boolean;
  className?: string;
}

export function ItemIcon({ id, texture, size = 32, tip = true, className }: Props) {
  const items = useItems();
  const item = id ? items?.byId.get(id) : undefined;
  const url = texture ? textureUrl(texture) : iconUrl(item);
  const handlers = tip && id ? tooltipHandlers(itemName(item, id), id) : {};
  return (
    <span
      className={cx('item-icon', !url && items && 'missing', className)}
      style={{ width: size, height: size, backgroundImage: url ? `url(${url})` : undefined }}
      role="img"
      aria-label={id ? itemName(item, id) : undefined}
      {...handlers}
    />
  );
}
