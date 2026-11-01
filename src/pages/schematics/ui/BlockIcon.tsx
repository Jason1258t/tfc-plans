import { parsePair } from '@tfc/core/copycatPairs';
import { ItemIcon } from '@/shared/pack-data';
import styles from '../SchematicsPage/SchematicsPage.module.css';

/** Значок строки замен: блок или пара «копикат + материал» — два значка рядом */
export function BlockIcon({ id, size, tip }: { id: string; size: number; tip?: boolean }) {
  const pair = parsePair(id);
  if (!pair) return <ItemIcon id={id} size={size} tip={tip} />;
  return (
    <span className={styles.pairIcons}>
      <ItemIcon id={pair.block} size={size} tip={tip} />
      <ItemIcon id={pair.material} size={size} tip={tip} />
    </span>
  );
}
