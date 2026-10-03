import { BookOpen, Columns2, Eye, Maximize2, Minimize2, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useData } from '../data/DataContext';
import { artifactsStore } from '../data/store';
import { cx, timeAgo } from '../lib/util';
import type { Artifact } from '../types';
import { AgentPanel } from './AgentPanel';
import './ArtifactPane.css';
import { ItemPicker } from './ItemPicker';
import { Markdown, itemToken } from './Markdown';

type View = 'edit' | 'split' | 'preview';

interface Props {
  artifactId: string;
  /** side — панель справа от списка задач, full — отдельная страница */
  variant: 'side' | 'full';
  onClose?: () => void;
  onToggleSize?: () => void;
  onOpenTask?: (taskId: string) => void;
  onDeleted?: () => void;
}

export function ArtifactPane(props: Props) {
  const { artifacts, loading } = useData();
  const artifact = artifacts.find((a) => a.id === props.artifactId);
  if (!artifact) {
    return (
      <section className={cx('apane', props.variant)}>
        <div className="apane-head">
          <span className="grow faint">{loading ? 'Загрузка…' : 'Документ не найден — возможно, его удалили.'}</span>
          {props.onClose && (
            <button className="btn ghost icon" onClick={props.onClose} aria-label="Закрыть">
              <X size={18} />
            </button>
          )}
        </div>
      </section>
    );
  }
  return <Editor key={artifact.id} artifact={artifact} {...props} />;
}

const SAVE_DELAY = 800;

function Editor({ artifact, variant, onClose, onToggleSize, onOpenTask, onDeleted }: Props & { artifact: Artifact }) {
  const { tasks, nick } = useData();
  const task = tasks.find((t) => t.id === artifact.taskId);

  const [view, setView] = useState<View>(() => (artifact.content ? 'preview' : 'edit'));
  const [content, setContent] = useState(artifact.content);
  const [title, setTitle] = useState(artifact.title);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState<[number, number]>([artifact.content.length, artifact.content.length]);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  // Чужие правки подтягиваем, пока у нас нет несохранённых изменений
  useEffect(() => {
    if (!dirty) setContent(artifact.content);
  }, [artifact.content, dirty]);
  useEffect(() => {
    if (document.activeElement?.id !== 'apane-title') setTitle(artifact.title);
  }, [artifact.title]);

  const flush = async (value: string) => {
    window.clearTimeout(saveTimer.current);
    setSaving(true);
    try {
      await artifactsStore.update(artifact.id, { content: value, updatedBy: nick });
    } finally {
      setSaving(false);
      setDirty(false);
    }
  };

  const change = (value: string) => {
    setContent(value);
    setDirty(true);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flush(value), SAVE_DELAY);
  };

  // Не теряем правки при закрытии панели
  const latest = useRef({ content, dirty });
  useEffect(() => {
    latest.current = { content, dirty };
  }, [content, dirty]);
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      if (latest.current.dirty)
        artifactsStore.update(artifact.id, { content: latest.current.content, updatedBy: nick });
    },
    [artifact.id, nick],
  );

  const trackSelection = () => {
    const el = textRef.current;
    if (el) setSelection([el.selectionStart, el.selectionEnd]);
  };

  /** Вставка в позицию курсора или замена выделения */
  const insertAt = (text: string, range: [number, number] = selection) => {
    const [s, e] = range;
    const next = content.slice(0, s) + text + content.slice(e);
    change(next);
    const pos = s + text.length;
    setSelection([pos, pos]);
    if (view !== 'preview')
      requestAnimationFrame(() => {
        textRef.current?.focus();
        textRef.current?.setSelectionRange(pos, pos);
      });
  };

  const append = (text: string) => change(`${content.trimEnd()}${content.trim() ? '\n\n' : ''}${text.trim()}\n`);

  const remove = async () => {
    if (!confirm(`Удалить документ «${artifact.title}»?`)) return;
    await artifactsStore.remove(artifact.id);
    onDeleted?.();
  };

  const selectedText = view === 'preview' ? '' : content.slice(selection[0], selection[1]);

  return (
    <section className={cx('apane', variant)} aria-label="Документ">
      <header className="apane-head">
        <BookOpen size={18} className="apane-book" />
        <input
          id="apane-title"
          className="apane-title"
          value={title}
          placeholder="Название документа"
          aria-label="Название документа"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() =>
            title.trim() !== artifact.title &&
            artifactsStore.update(artifact.id, { title: title.trim(), updatedBy: nick })
          }
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {onToggleSize && (
          <button
            className="btn ghost sm icon"
            onClick={onToggleSize}
            aria-label={variant === 'full' ? 'Свернуть в панель' : 'Открыть на всю страницу'}
            title={variant === 'full' ? 'Свернуть в панель' : 'На всю страницу'}
          >
            {variant === 'full' ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        )}
        {onClose && (
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Закрыть документ">
            <X size={17} />
          </button>
        )}
      </header>

      <div className="apane-sub">
        {task ? (
          <button className="apane-task" onClick={() => onOpenTask?.(task.id)} title="Открыть задачу">
            ↳ {task.title}
          </button>
        ) : (
          <span className="faint small">Без задачи</span>
        )}
        <span className="grow" />
        <span className="faint small save-state">
          {saving ? 'Сохраняю…' : dirty ? 'Изменено' : `${artifact.updatedBy}, ${timeAgo(artifact.updatedAt)}`}
        </span>
      </div>

      <div className="apane-toolbar">
        <div className="seg" role="group" aria-label="Режим">
          <button aria-pressed={view === 'edit'} onClick={() => setView('edit')} title="Текст">
            <Pencil size={13} />
            <span className="hide-narrow">Текст</span>
          </button>
          {variant === 'full' && (
            <button aria-pressed={view === 'split'} onClick={() => setView('split')} title="Текст и просмотр">
              <Columns2 size={13} />
              <span className="hide-narrow">Оба</span>
            </button>
          )}
          <button aria-pressed={view === 'preview'} onClick={() => setView('preview')} title="Просмотр">
            <Eye size={13} />
            <span className="hide-narrow">Просмотр</span>
          </button>
        </div>
        {view !== 'preview' && (
          <div className="apane-insert">
            <ItemPicker small placeholder="Вставить предмет…" onPick={(it) => insertAt(itemToken(it.i))} />
          </div>
        )}
        <span className="grow" />
        <button className="btn ghost sm icon danger" onClick={remove} aria-label="Удалить документ" title="Удалить">
          <Trash2 size={15} />
        </button>
      </div>

      <div className={cx('apane-doc', `view-${view}`)}>
        {view !== 'preview' && (
          <textarea
            ref={textRef}
            className="apane-text"
            value={content}
            spellCheck
            placeholder={
              '# План\n\nMarkdown: заголовки, списки, таблицы, - [ ] чекбоксы.\nПредметы: [[tfc:metal/ingot/bronze|4]] — или «Вставить предмет».\n\nИли попросите агента ниже составить план.'
            }
            onChange={(e) => {
              change(e.target.value);
              trackSelection();
            }}
            onSelect={trackSelection}
            onBlur={() => dirty && flush(content)}
          />
        )}
        {view !== 'edit' && (
          <div className="apane-preview" onDoubleClick={() => setView(variant === 'full' ? 'split' : 'edit')}>
            {content.trim() ? (
              <Markdown source={content} />
            ) : (
              <div className="empty">Пусто. Начните писать или попросите агента.</div>
            )}
          </div>
        )}
      </div>

      <AgentPanel
        artifact={{ ...artifact, content }}
        task={task}
        selectedText={selectedText}
        onInsert={(text) => insertAt(text, [selection[1], selection[1]])}
        onAppend={append}
        onReplaceSelection={(original, text) => {
          const i = content.indexOf(original);
          if (i >= 0) insertAt(text, [i, i + original.length]);
          else append(text);
        }}
        onReplaceAll={(text) => change(text.trim() + '\n')}
      />
    </section>
  );
}
