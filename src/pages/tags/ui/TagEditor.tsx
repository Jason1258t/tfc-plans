import { Droplet, Hash, Plus, Undo2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  searchItems,
  useItems,
  baseMembers,
  ID_RE,
  memberName,
  parseTagFile,
  resultMembers,
  TAG_KIND_LABEL,
  tagFileContent,
  tagKey,
  tagPath,
  type TagCatalog,
  type TagEdit,
  type TagKind,
  ItemIcon,
} from '@/shared/pack-data';
import { cx } from '@/shared/lib';
import { Input, Modal, Segmented } from '@/shared/ui';
import styles from './TagEditor.module.css';

interface Props {
  cat: TagCatalog;
  kind: TagKind;
  /** Для существующего тега — его id; пусто — создаём новый тег */
  tagId: string | null;
  /** Уже лежащий в датапаке файл этого тега (содержимое) — правим его */
  existing?: string;
  onSave: (r: { path: string; content: string; kind: TagKind; id: string }) => void;
  onClose: () => void;
  saveLabel?: string;
}

/** Значение тега: иконка, название, id; ссылка на другой тег — «#ns:tag» */
export function Member({
  cat,
  kind,
  id,
  className,
}: {
  cat: TagCatalog | null;
  kind: TagKind;
  id: string;
  className?: string;
}) {
  const items = useItems();
  const isRef = id.startsWith('#');
  const name = isRef ? null : memberName(cat, items, kind, id);
  return (
    <span className={cx(styles.tagMember, className)}>
      {isRef ? (
        <Hash size={18} className="faint" />
      ) : kind === 'fluid' ? (
        <Droplet size={18} className="faint" />
      ) : (
        <ItemIcon id={id} size={20} tip={false} />
      )}
      <span className={styles.tagMemberText}>
        {name && name !== id && <span className={styles.tagMemberName}>{name}</span>}
        <code className={styles.tagMemberId}>{id}</code>
      </span>
    </span>
  );
}

/** Поле добавления: предметы/блоки/жидкости по названию, теги по «#», либо свой id */
function MemberInput({ cat, kind, onAdd }: { cat: TagCatalog; kind: TagKind; onAdd: (id: string) => void }) {
  const items = useItems();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const suggestions = useMemo(() => {
    const text = q.trim().toLowerCase();
    if (text.length < 2) return [] as { id: string; hint?: string }[];
    if (text.startsWith('#')) {
      const w = text.slice(1);
      return cat.list
        .filter((t) => t.k === kind && t.i.includes(w))
        .slice(0, 30)
        .map((t) => ({ id: `#${t.i}`, hint: `${t.s.length + t.ops.length} ист.` }));
    }
    if (kind === 'fluid') {
      const words = text.split(/\s+/);
      return cat.fluids
        .filter((f) => words.every((w) => `${f.r ?? ''} ${f.e} ${f.i}`.toLowerCase().includes(w)))
        .slice(0, 30)
        .map((f) => ({ id: f.i, hint: f.r ?? f.e }));
    }
    if (!items) return [];
    return searchItems(items, text, 30).map((it) => ({ id: it.i, hint: it.r ?? it.e }));
  }, [cat, items, kind, q]);

  const typed = q.trim();
  const typedOk = ID_RE.test(typed) && !suggestions.some((s) => s.id === typed);

  const add = (id: string) => {
    onAdd(id);
    setQ('');
    setOpen(false);
  };

  return (
    <div className={styles.tagAdd}>
      <Input
        value={q}
        placeholder={
          kind === 'fluid'
            ? 'Жидкость по названию или id; «#» — другой тег'
            : 'Найти по названию или id; «#» — другой тег'
        }
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (suggestions[0]) add(suggestions[0].id);
          else if (typedOk) add(typed);
        }}
      />
      {open && (suggestions.length > 0 || typedOk) && (
        <ul className={styles.tagAddList}>
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(s.id);
                }}
              >
                <Member cat={cat} kind={kind} id={s.id} />
                {s.hint && <span className="faint small">{s.hint}</span>}
              </button>
            </li>
          ))}
          {typedOk && (
            <li>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(typed);
                }}
              >
                <Plus size={16} />{' '}
                <span>
                  Добавить как есть: <code>{typed}</code>
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Редактор тега для датапака: что убрать из текущего состава, что добавить; режим «дополнить» или «заменить» */
export function TagEditor({ cat, kind, tagId, existing, onSave, onClose, saveLabel = 'Сохранить' }: Props) {
  const [id, setId] = useState(tagId ?? '');
  const tag = tagId ? cat.byKey.get(tagKey(kind, tagId)) : undefined;
  const base = useMemo(
    () => baseMembers(tagId === id ? tag : cat.byKey.get(tagKey(kind, id))),
    [cat, kind, tag, tagId, id],
  );

  const [edit, setEdit] = useState<TagEdit>(
    () => (existing ? parseTagFile(existing, base) : null) ?? { replace: false, added: [], removed: [] },
  );

  const removedSet = new Set(edit.removed);
  const toggleRemoved = (m: string) =>
    setEdit((e) => ({ ...e, removed: e.removed.includes(m) ? e.removed.filter((x) => x !== m) : [...e.removed, m] }));
  const addMember = (m: string) =>
    setEdit((e) =>
      e.added.includes(m) ? e : { ...e, added: [...e.added, m], removed: e.removed.filter((x) => x !== m) },
    );

  const result = resultMembers(edit, base);
  const content = tagFileContent(edit, base);
  const idOk = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id);
  const nothing = !edit.added.length && !edit.removed.length && !edit.replace;
  // В режиме «дополнить» убирать нечего, если тег с этим id в сборке неизвестен
  const unknownRemoved = edit.removed.filter((r) => !base.includes(r));

  return (
    <Modal
      wide
      onClose={onClose}
      title={tagId ? `Тег #${tagId}` : 'Новый тег'}
      footer={
        <>
          <span className="faint small grow">
            {TAG_KIND_LABEL[kind]} · файл <code>{idOk ? tagPath(kind, id) : '—'}</code>
          </span>
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn primary"
            disabled={!idOk || nothing}
            onClick={() => onSave({ path: tagPath(kind, id), content, kind, id })}
          >
            {saveLabel}
          </button>
        </>
      }
    >
      <div className={styles.tagEditor}>
        {!tagId && (
          <div>
            <label className="label" htmlFor="te-id">
              Id нового тега
            </label>
            <Input
              id="te-id"
              className="mono-input"
              value={id}
              placeholder="c:plantoil или мой_мод:мой_тег"
              onChange={(e) => setId(e.target.value.trim().toLowerCase())}
            />
            {cat.byKey.has(tagKey(kind, id)) && <p className="faint small">Такой тег уже есть — состав ниже его.</p>}
          </div>
        )}

        <div className={styles.tagModes}>
          <Segmented
            value={edit.replace}
            onChange={(v) => setEdit((e) => ({ ...e, replace: v }))}
            options={[
              { value: false, label: 'Дополнить' },
              { value: true, label: 'Заменить целиком' },
            ]}
          />
          <p className="faint small grow">
            {edit.replace
              ? 'Файл задаёт полный состав: всё, что другие моды и датапаки добавили раньше, пропадёт. Скрипты KubeJS поверх всё равно сработают.'
              : 'К составу из сборки добавится «Добавить» и уберётся «Убрать» (поле remove — расширение NeoForge). Остальное остаётся как есть.'}
          </p>
        </div>

        <div className={styles.tagCols}>
          <section>
            <h3>
              Сейчас в сборке <span className="faint small">{base.length}</span>
            </h3>
            {base.length === 0 ? (
              <p className="faint small">Тег пуст или такого тега нет.</p>
            ) : (
              <ul className={styles.tagList}>
                {base.map((m) => (
                  <li key={m} className={cx(removedSet.has(m) && styles.removed)}>
                    <Member cat={cat} kind={kind} id={m} />
                    <button
                      className="btn ghost sm icon"
                      onClick={() => toggleRemoved(m)}
                      title={removedSet.has(m) ? 'Вернуть' : 'Убрать из тега'}
                      aria-label={removedSet.has(m) ? 'Вернуть' : 'Убрать из тега'}
                    >
                      {removedSet.has(m) ? <Undo2 size={14} /> : <X size={14} />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>
              Добавить <span className="faint small">{edit.added.length}</span>
            </h3>
            <MemberInput cat={cat} kind={kind} onAdd={addMember} />
            <ul className={styles.tagList}>
              {edit.added.map((m) => (
                <li key={m}>
                  <Member cat={cat} kind={kind} id={m} />
                  <button
                    className="btn ghost sm icon"
                    onClick={() => setEdit((e) => ({ ...e, added: e.added.filter((x) => x !== m) }))}
                    aria-label="Не добавлять"
                    title="Не добавлять"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            {edit.added.some((m) => base.includes(m)) && (
              <p className="faint small">Часть значений уже есть в составе — повтор безвреден.</p>
            )}
          </section>
        </div>

        {unknownRemoved.length > 0 && (
          <p className={cx(styles.tagWarn, 'small')}>
            Убирается то, чего нет в известном составе: {unknownRemoved.join(', ')}. Если эти значения добавит другой
            датапак или скрипт, правило всё равно сработает.
          </p>
        )}

        <details className={styles.tagPreview} open>
          <summary>Итог: {result.length} значений · файл датапака</summary>
          <pre>{content}</pre>
        </details>
      </div>
    </Modal>
  );
}
