import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AttachDialog } from './AttachDialog';
import { EntryEditor } from './EntryEditor';
import { PackEntries } from './PackEntries';
import { PackMeta } from './PackMeta';
import { PackToolbar } from './PackToolbar';
import { KubejsConstructor } from '@/components/KubejsConstructor';
import { RecipeCatalog } from '@/widgets/recipe-browser';
import { useNick } from '@/entities/user';
import { useFiles } from '@/entities/file';
import { datapacksStore } from '@/entities/datapack';
import {
  buildZip,
  entryFromRecipe,
  entryWithId,
  kubejsIssues,
  PACK_FORMAT,
  staleIssues,
  validatePack,
  zipName,
} from '@/lib/datapack';
import { filesEnabled, removeFile, uploadFile } from '@/entities/file';
import { useItems, useRecipes, type Recipe, tagFromPath, tagKey, useTags } from '@/shared/pack-data';
import { entryRecipeId, kubejsScript, scriptFileName } from '@/lib/kubejsFix';
import { downloadScript } from '@/lib/kubejsScripts';
import { cx, timeAgo, uid } from '@/shared/lib';
import type { Datapack, DatapackEntry, DatapackDeployment } from '@/entities/datapack';
import { Button } from '@/shared/ui';
import { download } from '../model/download';
import styles from '../DatapacksPage/DatapacksPage.module.css';

/** Один датапак: паспорт, кнопки, файлы и окна — каталог рецептов, конструктор KubeJS, правка записи */
export function PackEditor({
  pack,
  deployment,
  onDeleted,
}: {
  pack: Datapack;
  deployment?: DatapackDeployment;
  onDeleted: () => void;
}) {
  const nick = useNick();
  const { items: files } = useFiles();
  const navigate = useNavigate();
  const catalog = useRecipes();
  const [catalogMode, setCatalogMode] = useState<'template' | 'existing' | null>(null);
  const [editing, setEditing] = useState<DatapackEntry | null>(null);
  const [attaching, setAttaching] = useState(false);
  /** «Сохранить как файл»: идёт загрузка / готово (имя файла) / ошибка */
  const [saving, setSaving] = useState<{ busy: boolean; done?: string; error?: string } | null>(null);
  /** Конструктор для рецепта, который режет KubeJS; entryId — рецепт этого датапака */
  const [constructing, setConstructing] = useState<{
    recipeId: string;
    json: Record<string, unknown>;
    entryId?: string;
  } | null>(null);

  const items = useItems();
  const tags = useTags();
  const kjsHits = useMemo(() => kubejsIssues(pack, catalog), [pack, catalog]);
  const issues = useMemo(
    () => [...validatePack(pack), ...staleIssues(pack, catalog, items, tags)],
    [pack, catalog, items, tags],
  );
  const update = (patch: Partial<Datapack>) => datapacksStore.update(pack.id, { ...patch, updatedBy: nick });

  const saveEntry = (entry: DatapackEntry) => {
    const exists = pack.entries.some((e) => e.id === entry.id);
    update({ entries: exists ? pack.entries.map((e) => (e.id === entry.id ? entry : e)) : [...pack.entries, entry] });
    setEditing(null);
  };

  const pickRecipe = (kind: 'add' | 'replace' | 'remove', r: Recipe) => {
    setCatalogMode(null);
    const entry = entryFromRecipe(kind, r, pack);
    // Удаление не требует правки — добавляем сразу; остальное открываем в редакторе
    if (kind === 'remove') update({ entries: [...pack.entries, entry] });
    else setEditing(entry);
  };

  const remove = async () => {
    if (!confirm(`Удалить датапак «${pack.name}» со всеми файлами?`)) return;
    await datapacksStore.remove(pack.id);
    onDeleted();
  };

  const exportZip = () => download(buildZip(pack), zipName(pack));

  /** zip в «Документы» без привязки к задаче; прежний такой же файл (то же имя, без задачи) заменяется */
  const saveAsFile = async () => {
    const name = zipName(pack);
    const old = files.filter((f) => f.name === name && !f.taskId);
    if (old.length && !confirm(`В «Документах» уже есть ${name} — заменить его текущей версией датапака?`)) return;
    setSaving({ busy: true });
    try {
      await uploadFile(new File([buildZip(pack) as BlobPart], name, { type: 'application/zip' }), {
        taskId: null,
        author: nick,
      });
      for (const f of old) await removeFile(f);
      setSaving({ busy: false, done: name });
    } catch (e) {
      setSaving({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  /** Рецепты датапака одним KubeJS-скриптом (event.custom) — их удаления KubeJS не трогают */
  const recipeEntries = pack.entries.filter((e) => (e.kind === 'add' || e.kind === 'replace') && entryRecipeId(e.path));
  const exportScript = () => {
    const recipes = recipeEntries.flatMap((e) => {
      try {
        return [{ id: entryRecipeId(e.path)!, json: JSON.parse(e.content) }];
      } catch {
        return [];
      }
    });
    downloadScript(kubejsScript(recipes, `Рецепты датапака «${pack.name}»`), scriptFileName(pack.namespace));
  };

  const openConstructor = (e: DatapackEntry) => {
    try {
      setConstructing({ recipeId: entryRecipeId(e.path)!, json: JSON.parse(e.content), entryId: e.id });
    } catch {
      /* битый JSON — сначала поправить в редакторе */
    }
  };

  /** Из конструктора: рецепт с новым id — переименовать свой или создать по рецепту сборки */
  const newEntryFromConstructor = (id: string, json: Record<string, unknown>) => {
    const c = constructing;
    setConstructing(null);
    if (!c) return;
    const fresh = entryWithId(JSON.stringify(json, null, 2), id, c.recipeId);
    if (c.entryId)
      update({
        entries: pack.entries.map((e) => (e.id === c.entryId ? { ...e, kind: 'add', path: fresh.path } : e)),
      });
    else setEditing(fresh);
  };

  /** Открыть тег записи в редакторе тегов */
  const openTag = (e: DatapackEntry) => {
    const t = tagFromPath(e.path)!;
    navigate(`/tags?pack=${pack.id}&kind=${t.kind}&tag=${encodeURIComponent(tagKey(t.kind, t.id))}`);
  };

  /** Новая произвольная запись — файл в namespace датапака */
  const addFile = () => setEditing({ id: uid(), kind: 'file', path: `data/${pack.namespace}/`, content: '{\n  \n}\n' });

  return (
    <div className={styles.dpEditor}>
      <PackMeta pack={pack} deployment={deployment} onUpdate={update} />

      <PackToolbar
        canExportScript={Boolean(recipeEntries.length)}
        canExportZip={Boolean(pack.entries.length)}
        canAttach={Boolean(pack.entries.length) && filesEnabled}
        canSaveAsFile={Boolean(pack.entries.length) && filesEnabled}
        savingBusy={Boolean(saving?.busy)}
        onTemplate={() => setCatalogMode('template')}
        onExisting={() => setCatalogMode('existing')}
        onOpenTags={() => navigate(`/tags?pack=${pack.id}`)}
        onAddFile={addFile}
        onExportScript={exportScript}
        onAttach={() => setAttaching(true)}
        onSaveAsFile={saveAsFile}
        onExportZip={exportZip}
      />

      {saving && !saving.busy && (
        <div className={cx(styles.dpSaved, saving.error && styles.error)}>
          <span>
            {saving.error ? (
              <>Не сохранилось: {saving.error}</>
            ) : (
              <>
                <b>{saving.done}</b> лежит в <Link to="/docs">«Документах»</Link>. Это снимок текущей версии — после
                правок датапака сохраните заново.
              </>
            )}
          </span>
          <Button variant="ghost" size="sm" className={styles.dpSavedBtn} onClick={() => setSaving(null)}>
            Скрыть
          </Button>
        </div>
      )}

      <PackEntries
        pack={pack}
        issues={issues}
        catalog={catalog}
        kjsHits={kjsHits}
        onEdit={setEditing}
        onRemove={(id) => update({ entries: pack.entries.filter((x) => x.id !== id) })}
        onOpenTag={openTag}
        onOpenConstructor={openConstructor}
      />

      <footer className={cx(styles.dpFoot, 'faint', 'small')}>
        <span className="grow">
          pack_format {PACK_FORMAT} (Minecraft 1.21.1) · создал {pack.author}, изменено {timeAgo(pack.updatedAt)}.
          Проверка: zip в <code>world/datapacks/</code>; подтверждённые фиксы — в <code>kubejs/data/</code>. После
          переноса перезапустите игру и сервер.
        </span>
        <Button size="sm" className={styles.dpDanger} onClick={remove}>
          Удалить датапак
        </Button>
      </footer>

      {catalogMode && (
        <RecipeCatalog
          catalog={catalog}
          mode={catalogMode}
          onPick={pickRecipe}
          onConstructor={(r) => (setCatalogMode(null), setConstructing({ recipeId: r.i, json: r.j }))}
          onClose={() => setCatalogMode(null)}
        />
      )}
      {constructing && catalog?.kubejs && (
        <KubejsConstructor
          recipeId={constructing.recipeId}
          json={constructing.json}
          rules={catalog.kubejs.rules}
          namespace={pack.namespace}
          onNewEntry={newEntryFromConstructor}
          onClose={() => setConstructing(null)}
        />
      )}
      {editing && <EntryEditor entry={editing} catalog={catalog} onSave={saveEntry} onClose={() => setEditing(null)} />}
      {attaching && <AttachDialog pack={pack} onClose={() => setAttaching(false)} />}
    </div>
  );
}
