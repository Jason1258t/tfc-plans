import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KubejsConstructor } from '../components/KubejsConstructor';
import { Modal } from '../components/Modal';
import { recipeActions, RecipeBrowser } from '../components/RecipeCatalog';
import { useData } from '../data/DataContext';
import { datapacksStore } from '../data/store';
import { entryFromRecipe, entryWithId } from '../lib/datapack';
import { useRecipes, type Recipe } from '../lib/recipes';
import { timeAgo } from '../lib/util';
import type { Datapack, DatapackEntry } from '../types';
import './RecipesPage.css';

type Pending = (pack: Pick<Datapack, 'namespace' | 'entries'>) => DatapackEntry;

/** Каталог рецептов сборки отдельной страницей: с учётом KubeJS, без лимита выдачи */
export function RecipesPage() {
  const catalog = useRecipes();
  const [mode, setMode] = useState<'template' | 'existing'>('template');
  /** Рецепт выбран — осталось выбрать датапак */
  const [pending, setPending] = useState<Pending | null>(null);
  const [constructing, setConstructing] = useState<Recipe | null>(null);
  const kubejs = catalog?.kubejs;

  return (
    <main className="recipes-page">
      <div className="recipes-head">
        <div className="grow">
          <h1>Рецепты сборки</h1>
          <p className="faint small">
            Рецепты из модов, датапака <code>kubejs/data</code> и скриптов KubeJS. Удалённые и изменённые скриптами
            отмечены — по ним можно открыть конструктор.
          </p>
        </div>
        <span className="seg">
          <button aria-pressed={mode === 'template'} onClick={() => setMode('template')}>
            Шаблон
          </button>
          <button aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>
            Заменить / удалить
          </button>
        </span>
      </div>

      {kubejs ? (
        <p className="recipes-kjs faint small">
          KubeJS:{' '}
          {kubejs.layers
            .map((l) => `${l.name} — ${l.scripts} скриптов, ${l.rules} удалений/замен, +${l.added} рецептов`)
            .join('; ')}
          . Импорт {timeAgo(kubejs.generatedAt)}
          {kubejs.errors.length > 0 && `, не выполнились: ${kubejs.errors.map((e) => e.file).join(', ')}`}.
        </p>
      ) : (
        catalog && (
          <p className="recipes-kjs faint small">
            Скрипты KubeJS не импортированы — удаления сборки не учитываются: <code>npm run kubejs -- kubejs.zip</code>.
          </p>
        )
      )}

      <RecipeBrowser
        catalog={catalog}
        autoFocus
        actions={recipeActions(mode, (kind, r) => setPending(() => (pack: Parameters<Pending>[0]) => entryFromRecipe(kind, r, pack)))}
        onConstructor={setConstructing}
      />

      {constructing && kubejs && (
        <KubejsConstructor
          recipeId={constructing.i}
          json={constructing.j}
          rules={kubejs.rules}
          namespace="tfc_plans"
          onNewEntry={(id, json) => {
            setConstructing(null);
            setPending(() => () => entryWithId(JSON.stringify(json, null, 2), id, constructing.i));
          }}
          onClose={() => setConstructing(null)}
        />
      )}
      {pending && <PackPicker make={pending} onClose={() => setPending(null)} />}
    </main>
  );
}

/** Куда положить рецепт: существующий датапак или новый */
function PackPicker({ make, onClose }: { make: Pending; onClose: () => void }) {
  const { nick } = useData();
  const navigate = useNavigate();
  const [packs, setPacks] = useState<Datapack[] | null>(null);
  useEffect(
    () => datapacksStore.subscribe((list) => setPacks([...list].sort((a, b) => b.updatedAt - a.updatedAt))),
    [],
  );

  const put = async (pack: Datapack | null) => {
    if (pack) {
      await datapacksStore.update(pack.id, { entries: [...pack.entries, make(pack)], updatedBy: nick });
      navigate(`/datapacks?pack=${pack.id}`);
      return;
    }
    const base = { namespace: 'tfc_plans', entries: [] as DatapackEntry[] };
    const id = await datapacksStore.add({
      name: 'Новый датапак',
      namespace: base.namespace,
      description: '',
      entries: [make(base)],
      author: nick,
      updatedBy: nick,
    });
    navigate(`/datapacks?pack=${id}`);
  };

  return (
    <Modal onClose={onClose} title="В какой датапак?" narrow>
      {!packs ? (
        <p className="faint">Загружаю…</p>
      ) : (
        <ul className="recipes-packs">
          {packs.map((p) => (
            <li key={p.id}>
              <button onClick={() => put(p)}>
                <b>{p.name}</b>
                <span className="faint small">
                  {p.namespace} · файлов {p.entries.length} · {timeAgo(p.updatedAt)}
                </span>
              </button>
            </li>
          ))}
          <li>
            <button onClick={() => put(null)}>
              <b>+ Новый датапак</b>
            </button>
          </li>
        </ul>
      )}
    </Modal>
  );
}
