import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { sanitizeNamespace } from '@/lib/datapack';
import {
  datapackInstallMode,
  datapackInstallPatch,
  publishTemporaryDatapack,
  type Datapack,
  type DatapackDeployment,
  type DatapackInstallMode,
} from '@/entities/datapack';
import { useNick } from '@/entities/user';
import { requestKey, useAccess } from '@/shared/api';
import { cx } from '@/shared/lib';
import { Button, Input, Label, Segmented, type SegmentedOption } from '@/shared/ui';
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

/** Подсказки про tfc pull неверны для датапака из снимка: кнопки заблокированы, выбор не действует */
const LOCKED_OPTIONS = INSTALL_OPTIONS.map((o) => ({ ...o, title: 'Датапак в снимке сборки, выбор заблокирован' }));
/** Без ключа игрока место установки не меняется: временный датапак вообще не ставится, общий правят игроки */
const GUEST_OPTIONS = INSTALL_OPTIONS.map((o) => ({ ...o, title: 'Нужен ключ игрока' }));

/** Паспорт датапака: название, namespace, описание и выбор места установки («Не ставить / В мир / В сборку») */
export function PackMeta({ pack, deployment, onUpdate }: Props) {
  const [name, setName] = useState(pack.name);
  const [namespace, setNamespace] = useState(pack.namespace);
  const [description, setDescription] = useState(pack.description);
  // В снимке сборки решает снимок, а не отметка на карточке; значение только для показа, в карточку не пишем
  const mode: DatapackInstallMode = deployment ? 'pack' : pack.temporary ? 'none' : datapackInstallMode(pack);
  const player = useAccess() === 'player';
  const nick = useNick();
  const [, setParams] = useSearchParams();
  const [publishing, setPublishing] = useState<string | null>(null);
  const locked = !!deployment || !!pack.temporary || !player;

  const publish = async () => {
    setPublishing('');
    try {
      setParams({ pack: await publishTemporaryDatapack(pack, nick) });
    } catch (e) {
      setPublishing(e instanceof Error ? e.message : String(e));
    }
  };

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
      {pack.temporary && (
        <div className={styles.dpDeployment} role="status">
          <strong>Временный датапак</strong> · хранится только в этом браузере. Его можно править и скачать ZIP, но
          программа <code>tfc pull</code> его не видит.
          <div>
            {player ? (
              <>
                <Button size="sm" variant="primary" disabled={publishing === ''} onClick={publish}>
                  {publishing === '' ? 'Сохраняю…' : 'Сохранить на сайте'}
                </Button>{' '}
                {publishing && <span className="small">Не сохранилось: {publishing}</span>}
              </>
            ) : (
              <>
                Чтобы сохранить его на сайте и выбрать установку —{' '}
                <Button size="sm" onClick={() => requestKey('Сохранить датапак на сайте')}>
                  войдите с ключом игрока
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {deployment && (
        <div className={styles.dpDeployment} role="status">
          <strong>В сборке</strong> · по опубликованному снимку. Подтвердил {deployment.confirmedBy}, версия{' '}
          <code>{deployment.contentHash.slice(0, 12)}</code>.
          <div>
            Путь: <code>{deployment.path}</code>. Переключатель ниже заблокирован, пока датапак в снимке.
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
            {pack.temporary ? (
              <>Временный датапак не ставится — только скачать ZIP</>
            ) : !player && !deployment ? (
              <>Менять место установки можно только с ключом игрока</>
            ) : deployment ? (
              <>
                Подтверждён в снимке сборки: <code>tfc pull</code> ставит проверенную версию в <code>kubejs/data/</code>{' '}
                для всех миров. Снять можно только командой <code>tfc datapacks unconfirm {pack.id}</code>
              </>
            ) : mode === 'pack' ? (
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
          options={deployment ? LOCKED_OPTIONS : locked ? GUEST_OPTIONS : INSTALL_OPTIONS}
          value={mode}
          disabled={locked}
          onChange={(next) => onUpdate(datapackInstallPatch(next))}
          label="Куда ставить датапак"
        />
      </div>
    </section>
  );
}
