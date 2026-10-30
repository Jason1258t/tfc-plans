import { Download, FileBox, ImagePlus, Library, Search, Trash2, X } from 'lucide-react';
import { Button, ErrorBox } from '@/shared/ui';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useNick } from '@/entities/user';
import { schematicsStore } from '@/entities/schematic';
import { useSearchTrack } from '@/shared/api';
import { formatSize } from '@/entities/file';
import { useItems } from '@/shared/pack-data';
import { REMOVE, type Schematic } from '@/entities/schematic';
import { openFromLibrary, refreshPreview, removeFromLibrary } from '../model/schematicLibrary';
import { cx, timeAgo } from '@/shared/lib';
import section from '../SchematicsSection.module.css';
import styles from './SchematicLibrary.module.css';
import type { SavedSchematic } from '@/entities/schematic';
import { Markdown } from '@/components/Markdown';
import { MarkdownField } from '@/components/MarkdownField';

interface Props {
  /** id записей, уже открытых в редакторе */
  openIds: Set<string>;
  onOpen: (s: Schematic, replace: Map<string, string>) => void;
  onDownload: (s: Schematic, replace: Map<string, string>) => Promise<void>;
}

/** Длина описания — как в правилах Firestore */
const MAX_DESCRIPTION = 4000;

/**
 * Общая библиотека схем: исходник + замены, файл с заменами собирается при скачивании.
 * Список — простыми строками; по клику справа панель с превью, названием и описанием.
 */
export function SchematicLibrary({ openIds, onOpen, onDownload }: Props) {
  const [list, setList] = useState<SavedSchematic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  // Выбранная схема — в адресе (?id=…): адрес страницы — ссылка на карточку (её же выдаёт MCP)
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const setSelectedId = (id: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set('id', id);
        else next.delete('id');
        return next;
      },
      { replace: true },
    );
  const items = useItems();
  const listReady = Boolean(list);

  // Пришли по ссылке — прокрутить к схеме, когда список загрузился
  useEffect(() => {
    if (!listReady || !selectedId) return;
    document.querySelector(`[data-schematic-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'center' });
    // только при загрузке списка, не при каждом выборе
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listReady]);

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
    return list.filter((s) => `${s.name} ${s.fileName} ${s.author} ${s.description ?? ''}`.toLowerCase().includes(q));
  }, [list, filter]);
  useSearchTrack('schematics', filter, list ? shown.length : undefined);

  const selected = list?.find((s) => s.id === selectedId) ?? null;

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

  const remove = async (entry: SavedSchematic) => {
    if (!confirm(`Удалить схему «${entry.name}» из библиотеки? Это нельзя отменить.`)) return;
    setBusy(entry.id);
    try {
      await removeFromLibrary(entry);
      if (selectedId === entry.id) setSelectedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const preview = async (entry: SavedSchematic) => {
    if (!items) return;
    setBusy(entry.id);
    setError(null);
    try {
      await refreshPreview(entry, items);
    } catch (e) {
      setError(`«${entry.name}»: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.library} data-tour="schem-library">
      <div className="row">
        <Library size={17} className="faint" />
        <h3 className="grow">Библиотека схем</h3>
        {list && list.length > 5 && (
          <label className={section.search}>
            <Search size={15} className="faint" />
            <input placeholder="Найти схему" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        )}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!list ? (
        <p className="faint small">Загружаю…</p>
      ) : list.length === 0 ? (
        <p className="faint small">
          Пока пусто. Откройте .nbt, настройте замены и нажмите «В библиотеку» — схема станет доступна всем.
        </p>
      ) : (
        <ul className={section.files}>
          {shown.map((entry) => {
            const isOpen = openIds.has(entry.id);
            return (
              <li
                key={entry.id}
                data-schematic-id={entry.id}
                className={cx(section.file, selectedId === entry.id && section.fileSelected)}
              >
                <button
                  className={styles.libPick}
                  onClick={() => setSelectedId(selectedId === entry.id ? null : entry.id)}
                  aria-expanded={selectedId === entry.id}
                  title="Превью и описание"
                >
                  <FileBox size={18} className="faint" />
                  <span className="grow">
                    <span className={styles.libName}>{entry.name}</span>
                    <span className="faint small">{summary(entry)}</span>
                  </span>
                </button>
                <Button
                  size="sm"
                  disabled={busy === entry.id}
                  onClick={() => run(entry, onDownload)}
                  title="Скачать .nbt с заменами"
                >
                  <Download size={14} />
                  Скачать
                </Button>
                <Button
                  size="sm"
                  disabled={busy === entry.id || isOpen}
                  onClick={() => run(entry, onOpen)}
                  title={isOpen ? 'Уже открыта выше' : 'Открыть в редакторе, чтобы поправить замены'}
                >
                  {isOpen ? 'Открыта' : 'Открыть'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  disabled={busy === entry.id}
                  onClick={() => remove(entry)}
                  aria-label={`Удалить ${entry.name}`}
                  title="Удалить из библиотеки"
                >
                  <Trash2 size={15} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {selected && (
        <SchematicPanel
          key={selected.id}
          entry={selected}
          busy={busy === selected.id}
          canRender={!!items}
          onPreview={() => preview(selected)}
          onClose={() => setSelectedId(null)}
          onError={setError}
        />
      )}
    </section>
  );
}

function summary(entry: SavedSchematic) {
  const removed = entry.replace.filter((r) => r.to === REMOVE).length;
  const replaced = entry.replace.length - removed;
  return [
    formatSize(entry.fileSize),
    entry.size?.join('×'),
    `${entry.blocks} блоков`,
    replaced > 0 && `замен ${replaced}`,
    removed > 0 && `удалено типов ${removed}`,
    `${entry.updatedBy}, ${timeAgo(entry.updatedAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

interface PanelProps {
  entry: SavedSchematic;
  busy: boolean;
  canRender: boolean;
  onPreview: () => void;
  onClose: () => void;
  onError: (e: string) => void;
}

/** Панель справа: превью, название и описание (правят все, сохраняется при уходе с поля) */
function SchematicPanel({ entry, busy, canRender, onPreview, onClose, onError }: PanelProps) {
  const nick = useNick();
  const [name, setName] = useState(entry.name);
  const [description, setDescription] = useState(entry.description ?? '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target instanceof HTMLElement && e.target.closest('input, textarea'))) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (patch: { name?: string; description?: string }) => {
    setSaving(true);
    try {
      await schematicsStore.update(entry.id, { ...patch, updatedBy: nick });
    } catch (e) {
      onError(`Не сохранено: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const saveName = () => {
    const v = name.trim().slice(0, 120);
    if (!v) return setName(entry.name);
    if (v !== entry.name) save({ name: v });
  };

  const saveDescription = () => {
    setEditing(false);
    const v = description.trim();
    if (v !== (entry.description ?? '')) save({ description: v });
  };

  return createPortal(
    <aside className={styles.panel} aria-label={`Схема ${entry.name}`}>
      <div className={styles.panelHead}>
        <input
          className={styles.panelName}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setName(entry.name);
              setTimeout(() => (document.activeElement as HTMLElement | null)?.blur());
            }
          }}
          aria-label="Название схемы"
          title="Название — можно исправить"
        />
        <Button variant="ghost" icon onClick={onClose} aria-label="Закрыть панель">
          <X size={18} />
        </Button>
      </div>

      <div className={styles.panelBody}>
        {entry.preview ? (
          <img className={styles.panelPreview} src={entry.preview} alt={`Превью ${entry.name}`} />
        ) : (
          <div className={cx(styles.panelPreview, 'empty', 'faint', 'small')}>Превью ещё нет</div>
        )}
        <div className="row">
          <span className="faint small grow">
            {entry.preview ? 'Блоки — по моделям из сборки. ' : ''}Рисуется в браузере при сохранении в библиотеку.
          </span>
          <Button size="sm" disabled={busy || !canRender} onClick={onPreview}>
            <ImagePlus size={14} />
            {busy ? 'Рисую…' : entry.preview ? 'Перерисовать' : 'Нарисовать'}
          </Button>
        </div>

        <p className={cx('faint', 'small', styles.panelMeta)}>{summary(entry)}</p>

        <div className={styles.panelDesc}>
          <div className="row">
            <h4 className="grow">Описание</h4>
            {saving && <span className="faint small">Сохраняю…</span>}
          </div>
          {editing ? (
            <MarkdownField
              autoFocus
              rows={8}
              maxLength={MAX_DESCRIPTION}
              value={description}
              placeholder="Что это, где стоит, что нужно для постройки… Markdown работает."
              onChange={setDescription}
              onBlur={saveDescription}
            />
          ) : (
            <div
              className={styles.panelDescView}
              role="button"
              tabIndex={0}
              onClick={(e) => !(e.target as HTMLElement).closest('a') && setEditing(true)}
              onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}
              title="Нажмите, чтобы править"
            >
              {entry.description ? (
                <Markdown source={entry.description} />
              ) : (
                <span className="faint">Описания нет — нажмите, чтобы добавить</span>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>,
    document.body,
  );
}
