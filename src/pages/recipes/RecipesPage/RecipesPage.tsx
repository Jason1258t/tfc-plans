import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KubejsConstructor } from '@/components/KubejsConstructor';
import { Modal, Segmented } from '@/shared/ui';
import { PackSection } from '@/widgets/pack-nav';
import { recipeActions, RecipeBrowser } from '@/widgets/recipe-browser';
import { useNick } from '@/entities/user';
import { datapacksStore } from '@/entities/datapack';
import { entryFromRecipe, entryWithId } from '@/lib/datapack';
import { useRecipes, type Recipe } from '@/shared/pack-data';
import { cx, timeAgo } from '@/shared/lib';
import type { Datapack, DatapackEntry } from '@/entities/datapack';
import styles from './RecipesPage.module.css';

export type Pending = (pack: Pick<Datapack, 'namespace' | 'entries'>) => DatapackEntry;

/** Каталог рецептов сборки отдельной страницей: с учётом KubeJS, без лимита выдачи */
export function RecipesPage({ embedded = false }: { embedded?: boolean }) {
  const catalog = useRecipes();
  const [mode, setMode] = useState<'template' | 'existing'>('template');
  /** Рецепт выбран — осталось выбрать датапак */
  const [pending, setPending] = useState<Pending | null>(null);
  const [constructing, setConstructing] = useState<Recipe | null>(null);
  const kubejs = catalog?.kubejs;
  // Старые /recipes ведут сюда же через канонический адрес справочника
  const [params] = useSearchParams();
  const Container = embedded ? 'section' : 'main';

  const page = (
    <Container className={cx(styles.recipesPage, embedded && styles.embedded)}>
      <div className={styles.recipesHead}>
        <div className="grow">
          <h1>Рецепты сборки</h1>
          <p className="faint small">
            Рецепты из модов, датапака <code>kubejs/data</code> и скриптов KubeJS. Удалённые и изменённые скриптами
            отмечены — по ним можно открыть конструктор.
          </p>
        </div>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'template', label: 'Шаблон' },
            { value: 'existing', label: 'Заменить / удалить' },
          ]}
        />
      </div>

      {kubejs ? (
        <p className={cx(styles.recipesKjs, 'faint', 'small')}>
          KubeJS:{' '}
          {kubejs.layers
            .map((l) => `${l.name} — ${l.scripts} скриптов, ${l.rules} удалений/замен, +${l.added} рецептов`)
            .join('; ')}
          . Импорт {timeAgo(kubejs.generatedAt)}
          {kubejs.errors.length > 0 && `, не выполнились: ${kubejs.errors.map((e) => e.file).join(', ')}`}.
        </p>
      ) : (
        catalog && (
          <p className={cx(styles.recipesKjs, 'faint', 'small')}>
            Скрипты KubeJS не импортированы — удаления сборки не учитываются: <code>npm run kubejs -- kubejs.zip</code>.
          </p>
        )
      )}

      <RecipeBrowser
        catalog={catalog}
        autoFocus
        initial={{
          query: params.get('q') ?? undefined,
          type: params.get('type') ?? undefined,
          itemId: params.get('item') ?? undefined,
          usage: params.get('usage') === '1',
        }}
        actions={recipeActions(mode, (kind, r) =>
          setPending(() => (pack: Parameters<Pending>[0]) => entryFromRecipe(kind, r, pack)),
        )}
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
    </Container>
  );

  return embedded ? page : <PackSection>{page}</PackSection>;
}

/** Куда положить рецепт: существующий датапак или новый */
export function PackPicker({ make, onClose }: { make: Pending; onClose: () => void }) {
  const nick = useNick();
  const navigate = useNavigate();
  const [packs, setPacks] = useState<Datapack[] | null>(null);
  useEffect(
    () => datapacksStore.subscribe((list) => setPacks([...list].sort((a, b) => b.updatedAt - a.updatedAt))),
    [],
  );

  const put = async (pack: Datapack | null) => {
    if (pack) {
      // Файл с тем же путём (повторная правка тега) заменяется, а не дублируется
      const entry = make(pack);
      const rest = pack.entries.filter((e) => e.path !== entry.path);
      await datapacksStore.update(pack.id, { entries: [...rest, entry], updatedBy: nick });
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
        <ul className={styles.recipesPacks}>
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
