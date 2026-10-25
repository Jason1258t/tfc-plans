import { Package, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { freeScriptName, NEW_SCRIPT_TEXT } from '@/lib/kubejsScripts';
import { useNick } from '@/entities/user';
import { datapacksStore, kubejsScriptsStore } from '@/entities/datapack';
import type { Datapack, KubejsScript } from '@/entities/datapack';
import { DatapacksList } from './ui/DatapacksList';
import { PackEditor } from './ui/PackEditor';
import { ScriptEditor } from './ui/KubejsScripts';
import styles from './DatapacksPage.module.css';

/** Страница «Датапаки»: каркас раздела — меню слева, выбранный датапак или скрипт справа */
export function DatapacksPage() {
  const nick = useNick();
  const [params, setParams] = useSearchParams();
  const [packs, setPacks] = useState<Datapack[] | null>(null);
  const [scripts, setScripts] = useState<KubejsScript[] | null>(null);
  const selectedId = params.get('pack');
  const scriptId = params.get('script');

  useEffect(
    () => datapacksStore.subscribe((list) => setPacks([...list].sort((a, b) => b.updatedAt - a.updatedAt))),
    [],
  );
  useEffect(
    () =>
      kubejsScriptsStore.subscribe((list) =>
        setScripts([...list].sort((a, b) => a.fileName.localeCompare(b.fileName))),
      ),
    [],
  );

  const pack = packs?.find((p) => p.id === selectedId) ?? null;
  const script = scripts?.find((s) => s.id === scriptId) ?? null;

  const createScript = async () => {
    const id = await kubejsScriptsStore.add({
      fileName: freeScriptName('tfc_plans.js', scripts ?? []),
      text: NEW_SCRIPT_TEXT,
      install: false,
      author: nick,
      updatedBy: nick,
    });
    setParams({ script: id });
  };

  const create = async () => {
    const id = await datapacksStore.add({
      name: 'Новый датапак',
      namespace: 'tfc_plans',
      description: '',
      entries: [],
      install: false,
      author: nick,
      updatedBy: nick,
    });
    setParams({ pack: id });
  };

  return (
    <div className={styles.dpLayout}>
      <DatapacksList
        packs={packs}
        scripts={scripts}
        selectedId={selectedId}
        scriptId={scriptId}
        onCreatePack={create}
        onCreateScript={createScript}
        onSelectPack={(id) => setParams({ pack: id })}
        onSelectScript={(id) => setParams({ script: id })}
      />
      <main className={styles.dpMain}>
        {script && scripts ? (
          <ScriptEditor key={script.id} script={script} scripts={scripts} onDeleted={() => setParams({})} />
        ) : pack ? (
          <PackEditor key={pack.id} pack={pack} onDeleted={() => setParams({})} />
        ) : (
          <div className={styles.dpEmpty}>
            <Package size={36} className="faint" />
            <h2>Датапаки</h2>
            <p className="muted">
              Новые рецепты по шаблону из сборки, замена и удаление существующих, произвольные файлы. Экспорт в zip —
              его можно сразу приложить к задаче, чтобы хост сервера закинул в <code>world/datapacks/</code>.
            </p>
            <button className="btn primary" data-tour="dp-new" onClick={create}>
              <Plus size={16} /> Новый датапак
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
