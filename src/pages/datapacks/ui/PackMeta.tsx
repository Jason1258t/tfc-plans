import { useState } from 'react';
import { sanitizeNamespace } from '@/lib/datapack';
import { cx } from '@/shared/lib';
import type { Datapack } from '@/entities/datapack';
import { InstallToggle } from './KubejsScripts';
import styles from '../DatapacksPage.module.css';

interface Props {
  pack: Datapack;
  /** Записать правку в стор; родитель добавляет «кто изменил» */
  onUpdate: (patch: Partial<Datapack>) => void;
}

/** Паспорт датапака: название, namespace, описание и отметка «Ставить в мир» */
export function PackMeta({ pack, onUpdate }: Props) {
  const [name, setName] = useState(pack.name);
  const [namespace, setNamespace] = useState(pack.namespace);
  const [description, setDescription] = useState(pack.description);

  return (
    <section className={styles.dpMeta}>
      <div className={styles.dpMetaRow}>
        <div className="grow">
          <label className="label" htmlFor="dp-name">
            Название
          </label>
          <input
            id="dp-name"
            className={cx('input', styles.dpName)}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== pack.name && onUpdate({ name: name.trim() })}
          />
        </div>
        <div style={{ width: 200 }}>
          <label className="label" htmlFor="dp-ns" title="Папка для новых рецептов: data/<namespace>/recipe/…">
            Namespace
          </label>
          <input
            id="dp-ns"
            className="input mono-input"
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
        <label className="label" htmlFor="dp-desc">
          Описание (в pack.mcmeta)
        </label>
        <input
          id="dp-desc"
          className="input"
          value={description}
          placeholder="Что чинит / добавляет"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== pack.description && onUpdate({ description })}
        />
      </div>
      <InstallToggle
        checked={!!pack.install}
        label="Ставить в мир"
        where="в мир"
        onChange={(install) => onUpdate({ install })}
      />
    </section>
  );
}
