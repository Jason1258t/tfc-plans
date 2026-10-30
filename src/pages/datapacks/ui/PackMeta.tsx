import { useState } from 'react';
import { sanitizeNamespace } from '@/lib/datapack';
import type { Datapack, DatapackDeployment } from '@/entities/datapack';
import { InstallToggle } from './KubejsScripts';
import { Input, Label } from '@/shared/ui';
import styles from '../DatapacksPage/DatapacksPage.module.css';

interface Props {
  pack: Datapack;
  deployment?: DatapackDeployment;
  /** Записать правку в стор; родитель добавляет «кто изменил» */
  onUpdate: (patch: Partial<Datapack>) => void;
}

/** Паспорт датапака: название, namespace, описание и отметка «Ставить в мир» */
export function PackMeta({ pack, deployment, onUpdate }: Props) {
  const [name, setName] = useState(pack.name);
  const [namespace, setNamespace] = useState(pack.namespace);
  const [description, setDescription] = useState(pack.description);

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
            Путь: <code>{deployment.path}</code>. Отметка ниже не снимает подтверждение.
          </div>
          {pack.updatedAt !== deployment.sourceUpdatedAt && (
            <div>После подтверждения карточка менялась. В сборке остаётся проверенная версия.</div>
          )}
          <div>
            Для проверки новой версии хост сначала выполняет <code>tfc datapacks unconfirm {pack.id}</code>.
          </div>
        </div>
      )}
      <InstallToggle
        checked={!!pack.install}
        label="Предлагать установку в мир"
        where="в мир, если он ещё не включён в сборку"
        onChange={(install) => onUpdate({ install })}
      />
    </section>
  );
}
