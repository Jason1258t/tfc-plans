import { Download, FileBox, Library, PencilLine, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { schematicsStore } from '../data/store';
import { formatSize } from '../lib/files';
import { REMOVE, type Schematic } from '../lib/schematic';
import { openFromLibrary, removeFromLibrary } from '../lib/schematicLibrary';
import { timeAgo } from '../lib/util';
import type { SavedSchematic } from '../types';

interface Props {
  /** id записей, уже открытых в редакторе */
  openIds: Set<string>;
  onOpen: (s: Schematic, replace: Map<string, string>) => void;
  onDownload: (s: Schematic, replace: Map<string, string>) => Promise<void>;
}

/** Общая библиотека схем: исходник + замены, файл с заменами собирается при скачивании */
export function SchematicLibrary({ openIds, onOpen, onDownload }: Props) {
  const [list, setList] = useState<SavedSchematic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(
    () =>
      schematicsStore.subscribe(
        (l) => setList([...l].sort((a, b) => b.updatedAt - a.updatedAt)),
        (e) => setError(e.message),
      ),
    [],
  );

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!list || !q) return list ?? [];
    return list.filter((s) => `${s.name} ${s.fileName} ${s.author}`.toLowerCase().includes(q));
  }, [list, filter]);

  /** Загрузка исходника из хранилища — общая для «Открыть» и «Скачать» */
  const run = async (entry: SavedSchematic, action: (s: Schematic, r: Map<string, string>) => unknown) => {
    setBusy(entry.id);
    setError(null);
    try {
      const { schematic, replace } = await openFromLibrary(entry);
      await action(schematic, replace);
    } catch (e) {
      setError(`«${entry.name}»: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };

  const rename = (entry: SavedSchematic) => {
    const name = prompt('Название схемы', entry.name)?.trim();
    if (!name || name === entry.name) return;
    schematicsStore.update(entry.id, { name: name.slice(0, 120) }).catch((e) => setError(e.message));
  };

  const remove = async (entry: SavedSchematic) => {
    if (!confirm(`Удалить схему «${entry.name}» из библиотеки? Это нельзя отменить.`)) return;
    setBusy(entry.id);
    try {
      await removeFromLibrary(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="schem-library">
      <div className="row">
        <Library size={17} className="faint" />
        <h3 className="grow">Библиотека схем</h3>
        {list && list.length > 5 && (
          <label className="search">
            <Search size={15} className="faint" />
            <input placeholder="Найти схему" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        )}
      </div>
      {error && <div className="error-box">{error}</div>}
      {!list ? (
        <p className="faint small">Загружаю…</p>
      ) : list.length === 0 ? (
        <p className="faint small">
          Пока пусто. Откройте .nbt, настройте замены и нажмите «В библиотеку» — схема станет доступна всем.
        </p>
      ) : (
        <ul className="schem-files">
          {shown.map((entry) => {
            const removed = entry.replace.filter((r) => r.to === REMOVE).length;
            const replaced = entry.replace.length - removed;
            const isOpen = openIds.has(entry.id);
            return (
              <li key={entry.id} className="schem-file">
                <FileBox size={18} className="faint" />
                <span className="grow">
                  <button className="schem-lib-name" onClick={() => rename(entry)} title="Переименовать">
                    {entry.name}
                    <PencilLine size={12} className="faint" />
                  </button>
                  <span className="faint small">
                    {formatSize(entry.fileSize)}
                    {entry.size && ` · ${entry.size.join('×')}`} · {entry.blocks} блоков
                    {replaced > 0 && ` · замен ${replaced}`}
                    {removed > 0 && ` · удалено типов ${removed}`} · {entry.updatedBy}, {timeAgo(entry.updatedAt)}
                  </span>
                </span>
                <button
                  className="btn sm"
                  disabled={busy === entry.id}
                  onClick={() => run(entry, onDownload)}
                  title="Скачать .nbt с заменами"
                >
                  <Download size={14} />
                  Скачать
                </button>
                <button
                  className="btn sm"
                  disabled={busy === entry.id || isOpen}
                  onClick={() => run(entry, onOpen)}
                  title={isOpen ? 'Уже открыта выше' : 'Открыть в редакторе, чтобы поправить замены'}
                >
                  {isOpen ? 'Открыта' : 'Открыть'}
                </button>
                <button
                  className="btn ghost sm icon"
                  disabled={busy === entry.id}
                  onClick={() => remove(entry)}
                  aria-label={`Удалить ${entry.name}`}
                  title="Удалить из библиотеки"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
