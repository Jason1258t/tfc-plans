import { AlertTriangle, Braces, CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { typeOfContent } from '../lib/datapack';
import { itemName, useItems } from '../lib/items';
import { itemRefsOf, type RecipeCatalog } from '../lib/recipes';
import type { DatapackEntry } from '../types';
import './EntryEditor.css';
import { HintPanel } from './HintPanel';
import { ItemIcon } from './ItemIcon';
import { ItemIdSearch } from './ItemIdSearch';
import { Modal } from './Modal';

const KIND_LABEL: Record<DatapackEntry['kind'], string> = {
  add: 'Новый рецепт',
  replace: 'Замена рецепта сборки',
  remove: 'Удаление рецепта сборки',
  file: 'Файл',
};

/** Позиция ошибки JSON → «строка N» */
function jsonError(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const pos = Number(msg.match(/position (\d+)/)?.[1]);
    if (!Number.isFinite(pos)) return msg;
    const line = text.slice(0, pos).split('\n').length;
    return `${msg.replace(/ in JSON at position \d+.*/, '')} — строка ${line}`;
  }
}

interface Props {
  entry: DatapackEntry;
  catalog: RecipeCatalog | null;
  onSave: (entry: DatapackEntry) => void;
  onClose: () => void;
}

/** Правка файла датапака: JSON от шаблона + подсказка по типу + поиск id предметов */
export function EntryEditor({ entry, catalog, onSave, onClose }: Props) {
  const items = useItems();
  const [path, setPath] = useState(entry.path);
  const [content, setContent] = useState(entry.content);
  const [note, setNote] = useState(entry.note ?? '');
  const isJson = path.endsWith('.json') || path.endsWith('.mcmeta');
  const error = isJson ? jsonError(content) : null;
  const type = isJson && !error ? typeOfContent(content) : entry.recipeType;

  /** id предметов в значениях JSON (без ключей, типов и условий): есть ли такой в сборке */
  const refs = useMemo(() => {
    if (!isJson || error) return [] as [string, boolean][];
    return itemRefsOf(JSON.parse(content)).map((id) => [id, Boolean(items?.byId.has(id))] as [string, boolean]);
  }, [content, items, isJson, error]);
  const unknown = refs.filter(([, ok]) => !ok);

  const save = () => onSave({ ...entry, path: path.trim(), content, note: note.trim() || undefined, recipeType: type });

  return (
    <Modal
      onClose={onClose}
      wide
      title={KIND_LABEL[entry.kind]}
      footer={
        <>
          <span className="faint small grow">
            {entry.sourceRecipe && (
              <>
                {entry.kind === 'add' ? 'Шаблон' : 'Оригинал'}: <code>{entry.sourceRecipe}</code>
              </>
            )}
          </span>
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={save} disabled={!path.trim() || Boolean(error)}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="ee-layout">
        <div className="ee-main">
          <label className="label" htmlFor="ee-path">
            Путь в zip
          </label>
          <input
            id="ee-path"
            className="input mono-input"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            disabled={entry.kind === 'replace' || entry.kind === 'remove'}
            title={
              entry.kind === 'replace' || entry.kind === 'remove'
                ? 'Путь совпадает с оригиналом — так датапак его перекрывает'
                : undefined
            }
          />
          <div className="ee-editor-head">
            <span className="label" style={{ margin: 0 }}>
              Содержимое
            </span>
            <span className="grow" />
            {isJson && (
              <button
                className="btn ghost sm"
                disabled={Boolean(error)}
                onClick={() => setContent(JSON.stringify(JSON.parse(content), null, 2))}
              >
                <Braces size={13} /> Форматировать
              </button>
            )}
          </div>
          <textarea
            className="input mono ee-text"
            value={content}
            spellCheck={false}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              // Tab вставляет отступ, а не уводит фокус
              if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: s, selectionEnd: en } = el;
                setContent(content.slice(0, s) + '  ' + content.slice(en));
                requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
              }
            }}
          />
          {isJson &&
            (error ? (
              <div className="error-box">JSON с ошибкой: {error}</div>
            ) : (
              <div className="ee-ok small">
                <CheckCircle2 size={14} /> JSON корректен{type ? ` · тип ${type}` : ''}
              </div>
            ))}
          {refs.length > 0 && (
            <div className="ee-refs">
              {refs.map(([id, ok]) => (
                <span
                  key={id}
                  className={ok ? 'ee-ref' : 'ee-ref unknown'}
                  title={ok ? id : `${id} — нет в библиотеке предметов`}
                >
                  {ok ? <ItemIcon id={id} size={16} tip={false} /> : <AlertTriangle size={13} />}
                  {ok ? itemName(items?.byId.get(id), id) : id}
                </span>
              ))}
            </div>
          )}
          {unknown.length > 0 && (
            <div className="faint small">
              Жёлтые — id, которых нет среди предметов сборки: это может быть опечатка, а может быть жидкость, блок без
              предмета или служебный id — проверьте.
            </div>
          )}
          <label className="label" htmlFor="ee-note" style={{ marginTop: 6 }}>
            Заметка (не попадает в zip)
          </label>
          <input
            id="ee-note"
            className="input"
            value={note}
            placeholder="Зачем этот файл"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <aside className="ee-side">
          <HintPanel type={type} catalog={catalog} />
          <div className="ee-id-search">
            <div className="label">Найти id предмета</div>
            <ItemIdSearch compact limit={25} />
          </div>
        </aside>
      </div>
    </Modal>
  );
}
