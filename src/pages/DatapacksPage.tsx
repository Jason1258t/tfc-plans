import {
  AlertTriangle,
  Download,
  FileCode2,
  FilePen,
  FilePlus2,
  FileTerminal,
  Package,
  Paperclip,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EntryEditor } from '../components/EntryEditor';
import { KubejsConstructor } from '../components/KubejsConstructor';
import { Modal } from '../components/Modal';
import { RecipeCatalog } from '../components/RecipeCatalog';
import { useData } from '../data/DataContext';
import { datapacksStore } from '../data/store';
import {
  buildZip,
  entryFromRecipe,
  entryWithId,
  kubejsIssues,
  PACK_FORMAT,
  sanitizeNamespace,
  staleIssues,
  validatePack,
  zipName,
} from '../lib/datapack';
import { filesEnabled, uploadFile } from '../lib/files';
import { useItems } from '../lib/items';
import { entryRecipeId, kubejsScript, scriptFileName } from '../lib/kubejsFix';
import { useRecipes, type Recipe } from '../lib/recipes';
import { cx, timeAgo, uid } from '../lib/util';
import type { Datapack, DatapackEntry } from '../types';
import './DatapacksPage.css';

const KIND: Record<DatapackEntry['kind'], { label: string; cls: string }> = {
  add: { label: 'новый', cls: 'k-add' },
  replace: { label: 'замена', cls: 'k-replace' },
  remove: { label: 'удаление', cls: 'k-remove' },
  file: { label: 'файл', cls: 'k-file' },
};

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function DatapacksPage() {
  const { nick } = useData();
  const [params, setParams] = useSearchParams();
  const [packs, setPacks] = useState<Datapack[] | null>(null);
  const selectedId = params.get('pack');

  useEffect(
    () => datapacksStore.subscribe((list) => setPacks([...list].sort((a, b) => b.updatedAt - a.updatedAt))),
    [],
  );

  const pack = packs?.find((p) => p.id === selectedId) ?? null;

  const create = async () => {
    const id = await datapacksStore.add({
      name: 'Новый датапак',
      namespace: 'tfc_plans',
      description: '',
      entries: [],
      author: nick,
      updatedBy: nick,
    });
    setParams({ pack: id });
  };

  return (
    <div className="dp-layout">
      <aside className="dp-list">
        <div className="dp-list-head">
          <span>Датапаки</span>
          <button className="btn ghost sm icon" onClick={create} aria-label="Новый датапак" title="Новый датапак">
            <Plus size={15} />
          </button>
        </div>
        {!packs ? (
          <div className="faint small" style={{ padding: 8 }}>
            Загрузка…
          </div>
        ) : packs.length === 0 ? (
          <button className="btn" onClick={create} style={{ margin: 8 }}>
            <Plus size={15} /> Первый датапак
          </button>
        ) : (
          <ul>
            {packs.map((p) => (
              <li key={p.id}>
                <button
                  className={cx('dp-item', p.id === selectedId && 'active')}
                  onClick={() => setParams({ pack: p.id })}
                >
                  <Package size={15} className="faint" />
                  <span className="grow">
                    <span className="dp-item-name">{p.name}</span>
                    <span className="faint small">
                      {p.entries.length} файл(ов) · {p.updatedBy}, {timeAgo(p.updatedAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <main className="dp-main">
        {pack ? (
          <PackEditor key={pack.id} pack={pack} onDeleted={() => setParams({})} />
        ) : (
          <div className="dp-empty">
            <Package size={36} className="faint" />
            <h2>Датапаки</h2>
            <p className="muted">
              Новые рецепты по шаблону из сборки, замена и удаление существующих, произвольные файлы. Экспорт в zip —
              его можно сразу приложить к задаче, чтобы хост сервера закинул в <code>world/datapacks/</code>.
            </p>
            <button className="btn primary" onClick={create}>
              <Plus size={16} /> Новый датапак
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function PackEditor({ pack, onDeleted }: { pack: Datapack; onDeleted: () => void }) {
  const { nick } = useData();
  const catalog = useRecipes();
  const [name, setName] = useState(pack.name);
  const [namespace, setNamespace] = useState(pack.namespace);
  const [description, setDescription] = useState(pack.description);
  const [catalogMode, setCatalogMode] = useState<'template' | 'existing' | null>(null);
  const [editing, setEditing] = useState<DatapackEntry | null>(null);
  const [attaching, setAttaching] = useState(false);
  /** Конструктор для рецепта, который режет KubeJS; entryId — рецепт этого датапака */
  const [constructing, setConstructing] = useState<{
    recipeId: string;
    json: Record<string, unknown>;
    entryId?: string;
  } | null>(null);

  const items = useItems();
  const kjsHits = useMemo(() => kubejsIssues(pack, catalog), [pack, catalog]);
  const issues = useMemo(() => [...validatePack(pack), ...staleIssues(pack, catalog, items)], [pack, catalog, items]);
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
    const text = kubejsScript(recipes, `Рецепты датапака «${pack.name}»`);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = scriptFileName(pack.namespace);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
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

  return (
    <div className="dp-editor">
      <section className="dp-meta">
        <div className="dp-meta-row">
          <div className="grow">
            <label className="label" htmlFor="dp-name">
              Название
            </label>
            <input
              id="dp-name"
              className="input dp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name.trim() !== pack.name && update({ name: name.trim() })}
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
                if (ns !== pack.namespace) update({ namespace: ns });
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
            onBlur={() => description !== pack.description && update({ description })}
          />
        </div>
      </section>

      <div className="dp-toolbar">
        <button className="btn" onClick={() => setCatalogMode('template')}>
          <FilePlus2 size={15} /> Рецепт по шаблону
        </button>
        <button className="btn" onClick={() => setCatalogMode('existing')}>
          <FilePen size={15} /> Заменить / удалить рецепт
        </button>
        <button
          className="btn"
          onClick={() =>
            setEditing({ id: uid(), kind: 'file', path: `data/${pack.namespace}/`, content: '{\n  \n}\n' })
          }
        >
          <FileCode2 size={15} /> Файл
        </button>
        <span className="grow" />
        <button
          className="btn"
          onClick={exportScript}
          disabled={!recipeEntries.length}
          title="Рецепты датапака как KubeJS-скрипт (event.custom): удаления KubeJS на них не действуют"
        >
          <FileTerminal size={15} /> KubeJS-скрипт
        </button>
        <button className="btn" onClick={() => setAttaching(true)} disabled={!pack.entries.length || !filesEnabled}>
          <Paperclip size={15} /> К задаче
        </button>
        <button className="btn primary" onClick={exportZip} disabled={!pack.entries.length}>
          <Download size={15} /> Скачать .zip
        </button>
      </div>

      {issues.length > 0 && (
        <div className="dp-issues">
          {issues.map((i, n) => (
            <div key={n}>
              <AlertTriangle size={13} /> <code>{i.path}</code> — {i.message}
            </div>
          ))}
        </div>
      )}

      {pack.entries.length === 0 ? (
        <div className="empty">
          Пока пусто. Добавьте рецепт по шаблону из сборки, замените/удалите существующий или создайте произвольный
          файл.
        </div>
      ) : (
        <ul className="dp-entries">
          {pack.entries.map((e) => (
            <li key={e.id} className="dp-entry">
              <span className={cx('dp-kind', KIND[e.kind].cls)}>{KIND[e.kind].label}</span>
              <button className="dp-entry-main" onClick={() => setEditing(e)} title="Редактировать">
                <code className="dp-path">{e.path}</code>
                <span className="faint small">
                  {[e.recipeType, e.sourceRecipe && `из ${e.sourceRecipe}`, e.note].filter(Boolean).join(' · ')}
                </span>
              </button>
              {kjsHits.has(e.id) && (
                <button
                  className="btn sm dp-kjs"
                  onClick={() => openConstructor(e)}
                  title={`Удаляется KubeJS: ${kjsHits
                    .get(e.id)!
                    .map((n) => {
                      const r = catalog!.kubejs!.rules[n];
                      return `${r.file}:${r.idLine ?? r.line}`;
                    })
                    .join(', ')}`}
                >
                  <ShieldAlert size={13} /> KubeJS удалит
                </button>
              )}
              <button
                className="btn ghost sm icon danger"
                onClick={() => update({ entries: pack.entries.filter((x) => x.id !== e.id) })}
                aria-label={`Убрать ${e.path}`}
                title="Убрать из датапака"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="dp-foot faint small">
        <span className="grow">
          pack_format {PACK_FORMAT} (Minecraft 1.21.1) · создал {pack.author}, изменено {timeAgo(pack.updatedAt)}.
          Установка: zip в <code>world/datapacks/</code>; рецепты — <code>/reload</code>, реестры — перезапуск сервера.
        </span>
        <button className="btn ghost sm danger" onClick={remove}>
          Удалить датапак
        </button>
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

/** Собрать zip и приложить к задаче — хост скачает его оттуда */
function AttachDialog({ pack, onClose }: { pack: Datapack; onClose: () => void }) {
  const { tasks, groups, nick } = useData();
  const navigate = useNavigate();
  const [taskId, setTaskId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const active = tasks.filter((t) => t.status !== 'done').sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name;

  const attach = async () => {
    setBusy(true);
    setError(null);
    try {
      const file = new File([buildZip(pack) as BlobPart], zipName(pack), { type: 'application/zip' });
      await uploadFile(file, { taskId, author: nick });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      narrow
      title="Приложить zip к задаче"
      footer={
        done ? (
          <>
            <span className="grow" />
            <button className="btn" onClick={onClose}>
              Закрыть
            </button>
            <button className="btn primary" onClick={() => navigate(`/?task=${taskId}`)}>
              Открыть задачу
            </button>
          </>
        ) : (
          <>
            <span className="grow" />
            <button className="btn ghost" onClick={onClose}>
              Отмена
            </button>
            <button className="btn primary" onClick={attach} disabled={!taskId || busy}>
              {busy ? 'Загружаю…' : 'Приложить'}
            </button>
          </>
        )
      }
    >
      {done ? (
        <p style={{ margin: 0 }}>
          <b>{zipName(pack)}</b> приложен к задаче. Текущая версия датапака сохранена в файле — если поменяете его,
          приложите заново.
        </p>
      ) : (
        <>
          <label className="label" htmlFor="att-task">
            Задача
          </label>
          <select id="att-task" className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">— выберите —</option>
            {active.map((t) => (
              <option key={t.id} value={t.id}>
                {groupName(t.groupId) ? `${groupName(t.groupId)} · ` : ''}
                {t.title}
              </option>
            ))}
          </select>
          {error && <div className="error-box">{error}</div>}
        </>
      )}
    </Modal>
  );
}
