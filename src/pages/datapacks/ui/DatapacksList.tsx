import { FileTerminal, Package, Plus } from 'lucide-react';
import { PackNav } from '@/widgets/pack-nav';
import { cx, timeAgo } from '@/shared/lib';
import { datapackInstallMode, type Datapack, type DatapackDeployment, type KubejsScript } from '@/entities/datapack';
import { Button } from '@/shared/ui';
import styles from '../DatapacksPage/DatapacksPage.module.css';

interface Props {
  packs: Datapack[] | null;
  deployments: DatapackDeployment[] | null;
  scripts: KubejsScript[] | null;
  selectedId: string | null;
  scriptId: string | null;
  onCreatePack: () => void;
  onCreateScript: () => void;
  onSelectPack: (id: string) => void;
  onSelectScript: (id: string) => void;
}

/** Левое меню раздела: датапаки, ниже — скрипты KubeJS */
export function DatapacksList({
  packs,
  deployments,
  scripts,
  selectedId,
  scriptId,
  onCreatePack,
  onCreateScript,
  onSelectPack,
  onSelectScript,
}: Props) {
  return (
    <aside className={styles.dpList}>
      <PackNav className={styles.sectionNav} />
      <div className={styles.dpListHead} data-tour="dp-list-head">
        <span>Датапаки</span>
        <Button variant="ghost" size="sm" icon onClick={onCreatePack} aria-label="Новый датапак" title="Новый датапак">
          <Plus size={15} />
        </Button>
      </div>
      {!packs ? (
        <div className="faint small" style={{ padding: 8 }}>
          Загрузка…
        </div>
      ) : packs.length === 0 ? (
        <Button onClick={onCreatePack} style={{ margin: 8 }}>
          <Plus size={15} /> Первый датапак
        </Button>
      ) : (
        <ul>
          {packs.map((p) => {
            const inSnapshot = deployments?.some((d) => d.id === p.id);
            const mode = datapackInstallMode(p);
            const badge = inSnapshot ? 'в сборке' : mode === 'pack' ? 'в сборку' : mode === 'world' ? 'в мир' : null;
            const badgeTitle = inSnapshot
              ? 'Закреплён в опубликованном снимке сборки (kubejs/data/)'
              : mode === 'pack'
                ? 'Отмечен «В сборку»: программа tfc поставит его в kubejs/data/'
                : 'Отмечен «В мир»: программа tfc поставит его в world/datapacks/';
            return (
              <li key={p.id}>
                <button
                  className={cx(styles.dpItem, p.id === selectedId && styles.active)}
                  onClick={() => onSelectPack(p.id)}
                >
                  <Package size={15} className="faint" />
                  <span className="grow">
                    <span className={styles.dpItemName}>{p.name}</span>
                    <span className="faint small">
                      {p.temporary ? 'временный · ' : ''}
                      {p.entries.length} файл(ов) · {p.updatedBy}, {timeAgo(p.updatedAt)}
                    </span>
                  </span>
                  {badge && (
                    <span className={styles.dpBadge} title={badgeTitle}>
                      {badge}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className={cx(styles.dpListHead, styles.dpListHeadNext)}>
        <span>Скрипты KubeJS</span>
        <Button
          variant="ghost"
          size="sm"
          icon
          onClick={onCreateScript}
          disabled={!scripts}
          aria-label="Новый скрипт KubeJS"
          title="Новый скрипт KubeJS"
        >
          <Plus size={15} />
        </Button>
      </div>
      {scripts?.length === 0 && (
        <div className="faint small" style={{ padding: '0 8px' }}>
          Пока нет. Сохраняются из конструктора «KubeJS удалит» или кнопкой +.
        </div>
      )}
      {!!scripts?.length && (
        <ul>
          {scripts.map((s) => (
            <li key={s.id}>
              <button
                className={cx(styles.dpItem, s.id === scriptId && styles.active)}
                onClick={() => onSelectScript(s.id)}
              >
                <FileTerminal size={15} className="faint" />
                <span className="grow">
                  <span className={cx(styles.dpItemName, styles.mono)}>{s.fileName}</span>
                  <span className="faint small">
                    {s.updatedBy}, {timeAgo(s.updatedAt)}
                  </span>
                </span>
                {s.install && (
                  <span className={styles.dpBadge} title="Отмечен «Ставить на сервер»: программа tfc поставит его">
                    на сервер
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
