import { useState } from 'react';
import { sanitizeNamespace } from '@/lib/datapack';
import {
  datapackInstallMode,
  datapackInstallPatch,
  type Datapack,
  type DatapackDeployment,
  type DatapackInstallMode,
} from '@/entities/datapack';
import { cx } from '@/shared/lib';
import { Input, Label, Segmented, type SegmentedOption } from '@/shared/ui';
import styles from '../DatapacksPage/DatapacksPage.module.css';

interface Props {
  pack: Datapack;
  deployment?: DatapackDeployment;
  /** Записать правку в стор; родитель добавляет «кто изменил» */
  onUpdate: (patch: Partial<Datapack>) => void;
}

const INSTALL_OPTIONS: SegmentedOption<DatapackInstallMode>[] = [
  { value: 'none', label: 'Не ставить', title: 'Черновик — обычный tfc pull его не ставит' },
  { value: 'world', label: 'В мир', title: 'tfc pull положит ZIP в world/datapacks/ выбранного мира' },
  { value: 'pack', label: 'В сборку', title: 'tfc pull положит ZIP в kubejs/data/ для всех миров сборки' },
];

/** Паспорт датапака: название, namespace, описание и выбор места установки («Не ставить / В мир / В сборку») */
export function PackMeta({ pack, deployment, onUpdate }: Props) {
  const [name, setName] = useState(pack.name);
  const [namespace, setNamespace] = useState(pack.namespace);
  const [description, setDescription] = useState(pack.description);
  const mode = datapackInstallMode(pack);

  return (
    <section className={styles.dpMeta}>
      <div className={styles.dpMetaRow}>
        <div className="grow">
          <Label htmlFor="dp-name">Название</Label>
          <Input
            id="dp-name"
            className={styles.dpName}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== pack.name && onUpdate({ name: name.trim() })}
          />
        </div>
        <div style={{ width: 200 }}>
          <Label htmlFor="dp-ns" title="Папка для новых рецептов: data/<namespace>/recipe/…">
            Namespace
          </Label>
          <Input
            id="dp-ns"
            className="mono-input"
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            onBlur={() => {
              const ns = sanitizeNamespace(namespace);
              setNamespace(ns);
              if (ns !== pack.namespace) onUpdate({ namespace: ns });
            }}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="dp-desc">Описание (в pack.mcmeta)</Label>
        <Input
          id="dp-desc"
          value={description}
          placeholder="Что чинит / добавляет"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== pack.description && onUpdate({ description })}
        />
      </div>
      {deployment && (
        <div className={styles.dpDeployment} role="status">
          <strong>В сборке</strong> · по опубликованному снимку. Подтвердил {deployment.confirmedBy}, версия{' '}
          <code>{deployment.contentHash.slice(0, 12)}</code>.
          <div>
            Путь: <code>{deployment.path}</code>. Переключатель ниже не снимает подтверждение в снимке.
          </div>
          {pack.updatedAt !== deployment.sourceUpdatedAt && (
            <div>После подтверждения карточка менялась. В снимке остаётся проверенная версия.</div>
          )}
          <div>
            Для проверки новой версии хост сначала выполняет <code>tfc datapacks unconfirm {pack.id}</code>.
          </div>
        </div>
      )}
      <div className={cx(styles.dpInstall, styles.dpInstallMode, mode !== 'none' && styles.on)}>
        <div className="grow">
          <b>Куда ставить датапак</b>
          <div className="faint small">
            {mode === 'pack' ? (
              <>
                Программа <code>tfc pull</code> поставит его в <code>kubejs/data/</code> (для всех миров сборки, мир
                выбирать не нужно)
              </>
            ) : mode === 'world' ? (
              <>
                Программа <code>tfc pull</code> поставит его в <code>world/datapacks/</code> выбранного мира
              </>
            ) : (
              <>
                Черновик — обычный <code>tfc pull</code> его не ставит (по имени:{' '}
                <code>tfc datapacks pull {pack.id}</code>)
              </>
            )}
          </div>
        </div>
        <Segmented
          options={INSTALL_OPTIONS}
          value={mode}
          onChange={(next) => onUpdate(datapackInstallPatch(next))}
          label="Куда ставить датапак"
        />
      </div>
    </section>
  );
}
