import { useState } from 'react';
import { X } from 'lucide-react';
import { canHoldMaterial, pairKey } from '@tfc/core/copycatPairs';
import { replaceName } from '@/entities/schematic';
import { ItemIcon, ItemPicker, type ItemIndex } from '@/shared/pack-data';
import { Button } from '@/shared/ui';
import { suggestMaterial } from '../model/replaceFavorites';
import styles from '../SchematicsPage/SchematicsPage.module.css';

interface Props {
  /** Что заменяем: блок или пара */
  source: string;
  items: ItemIndex | null;
  replace: Map<string, string>;
  onTarget: (target: string) => void;
  onCancel: () => void;
}

/** Выбор замены: блок, а если он заполняемый — вторым шагом материал (получается пара) */
export function TargetPicker({ source, items, replace, onTarget, onCancel }: Props) {
  const [copycat, setCopycat] = useState<string | null>(null);
  const cancel = (
    <Button variant="ghost" size="sm" icon onClick={onCancel} aria-label="Отмена">
      <X size={15} />
    </Button>
  );
  if (!copycat)
    return (
      <div className="row grow">
        <div className="grow">
          <ItemPicker
            small
            blocksOnly
            autoFocus
            placeholder="На что заменить…"
            onPick={(it) => (canHoldMaterial(it.i) ? setCopycat(it.i) : onTarget(it.i))}
          />
        </div>
        {cancel}
      </div>
    );
  const suggested = suggestMaterial(source, items, replace);
  return (
    <div className="grow">
      <div className="row grow">
        <ItemIcon id={copycat} size={22} tip={false} />
        <div className="grow">
          <ItemPicker
            small
            blocksOnly
            autoFocus
            placeholder={`${replaceName(items, copycat)}: чем заполнить…`}
            onPick={(it) => onTarget(pairKey(copycat, it.i))}
          />
        </div>
        {cancel}
      </div>
      <div className={styles.pairActions}>
        {suggested && (
          <Button variant="ghost" size="sm" onClick={() => onTarget(pairKey(copycat, suggested))}>
            <ItemIcon id={suggested} size={16} tip={false} />
            {replaceName(items, suggested)}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => onTarget(copycat)}>
          Без материала
        </Button>
      </div>
    </div>
  );
}
