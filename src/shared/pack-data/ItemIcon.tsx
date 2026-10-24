import { blockEntry, guiIcon, itemName, textureUrl, useItems } from './items';
import { cx } from '@/shared/lib';
import { tooltipHandlers } from '@/shared/ui';

interface Props {
  /** id предмета (tfc:metal/ingot/copper) или блока без предмета (create:belt — иконкой предмета, которым ставят) */
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
  const item = id ? blockEntry(items, id) : undefined;
  const icon = texture ? { url: textureUrl(texture), smooth: false } : guiIcon(item);
  const url = icon?.url;
  const handlers = tip && id ? tooltipHandlers(itemName(item, id), id) : {};
  return (
    <span
      className={cx('item-icon', icon?.smooth && 'smooth', !url && items && 'missing', className)}
      style={{ width: size, height: size, backgroundImage: url ? `url(${url})` : undefined }}
      role="img"
      aria-label={id ? itemName(item, id) : undefined}
      {...handlers}
    />
  );
}
