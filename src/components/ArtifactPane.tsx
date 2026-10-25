import { BookOpen, Columns2, Eye, ImagePlus, Maximize2, Minimize2, Pencil, Trash2, X } from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useNick } from '@/entities/user';
import { useArtifacts } from '@/entities/artifact';
import { useFiles } from '@/entities/file';
import { useTasks } from '@/entities/task';
import { artifactsStore } from '@/entities/artifact';
import { filesEnabled } from '../lib/files';
import { removeOrphanImages } from '../lib/planImages';
import { cx, timeAgo } from '@/shared/lib';
import type { Artifact } from '@/entities/artifact';
import { AgentPanel } from './AgentPanel';
import styles from './ArtifactPane.module.css';
import { ItemPicker } from '@/shared/pack-data';
import type { LiveMarkdownHandle } from './LiveMarkdown';
import { Markdown, itemToken, toggleTaskLine } from './Markdown';
import { useTextImages } from './useTextImages';

const LiveMarkdown = lazy(() => import('./LiveMarkdown'));

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

/** Класс варианта панели: side — справа от списка задач, full — отдельная страница */
const VARIANT_CLASS: Record<Props['variant'], string> = { side: styles.side, full: styles.full };

export function ArtifactPane(props: Props) {
  const { items: artifacts, loading } = useArtifacts();
  const artifact = artifacts.find((a) => a.id === props.artifactId);
  if (!artifact) {
    return (
      <section className={cx(styles.apane, VARIANT_CLASS[props.variant])}>
        <div className={styles.apaneHead}>
          <span className="grow faint">{loading ? 'Загрузка…' : 'План не найден — возможно, его удалили.'}</span>
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
const PLACEHOLDER =
  '# План\n\nMarkdown: заголовки, списки, таблицы, - [ ] чекбоксы.\nПредметы: [[tfc:metal/ingot/bronze|4]] — или «Вставить предмет».\n\nИли попросите агента ниже составить план.';

function Editor({ artifact, variant, onClose, onToggleSize, onOpenTask, onDeleted }: Props & { artifact: Artifact }) {
  const { items: tasks } = useTasks();
  const nick = useNick();
  const { items: files } = useFiles();
  const { items: artifacts } = useArtifacts();
  const task = tasks.find((t) => t.id === artifact.taskId);

  // Открытие — только чтение; редактор подключается, когда правку включили явно («Текст»)
  const [view, setView] = useState<View>(() => (artifact.content ? 'preview' : 'edit'));
  const [content, setContent] = useState(artifact.content);
  const [title, setTitle] = useState(artifact.title);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<[number, number]>([artifact.content.length, artifact.content.length]);
  const liveRef = useRef<LiveMarkdownHandle>(null);
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
      // Пока сохранялось, могли напечатать ещё: тогда правки не сохранены, и подтягивать из базы
      // старый текст нельзя — иначе удалённое на мгновение «возвращается» и смешивается с новым вводом
      if (latest.current.content === value) setDirty(false);
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

  /** Вставка в позицию курсора или замена выделения */
  const insertAt = (text: string, range: [number, number] = selection) => {
    const [s, e] = range;
    const next = content.slice(0, s) + text + content.slice(e);
    change(next);
    const pos = s + text.length;
    setSelection([pos, pos]);
    if (view !== 'preview')
      requestAnimationFrame(() => {
        liveRef.current?.focus();
        liveRef.current?.select(pos);
      });
  };

  const images = useTextImages({
    owner: { kind: 'plan', id: artifact.id },
    taskId: artifact.taskId,
    initial: artifact.content,
    content,
    setContent: change,
    insert: (text, pos) => insertAt(text, [pos, pos]),
  });

  const append = (text: string) => change(`${content.trimEnd()}${content.trim() ? '\n\n' : ''}${text.trim()}\n`);

  const remove = async () => {
    if (!confirm(`Удалить план «${artifact.title}»?`)) return;
    await artifactsStore.remove(artifact.id);
    // Картинки плана уходят вместе с ним (кроме скопированных в другие планы и задачи)
    removeOrphanImages({ kind: 'plan', id: artifact.id }, '', { files, artifacts, tasks });
    onDeleted?.();
  };

  const selectedText = view === 'preview' ? '' : content.slice(selection[0], selection[1]);

  return (
    <section className={cx(styles.apane, VARIANT_CLASS[variant])} aria-label="План">
      <header className={styles.apaneHead}>
        <BookOpen size={18} className={styles.apaneBook} />
        <input
          id="apane-title"
          className={styles.apaneTitle}
          value={title}
          placeholder="Название плана"
          aria-label="Название плана"
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
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Закрыть план">
            <X size={17} />
          </button>
        )}
      </header>

      <div className={styles.apaneSub}>
        {task ? (
          <button className={styles.apaneTask} onClick={() => onOpenTask?.(task.id)} title="Открыть задачу">
            ↳ {task.title}
          </button>
        ) : (
          <span className="faint small">Без задачи</span>
        )}
        <span className="grow" />
        <span className={cx('faint small', styles.saveState)}>
          {images.uploading
            ? 'Загружаю картинку…'
            : saving
              ? 'Сохраняю…'
              : dirty
                ? 'Изменено'
                : `${artifact.updatedBy}, ${timeAgo(artifact.updatedAt)}`}
        </span>
      </div>

      <div className={styles.apaneToolbar}>
        <div className="seg" role="group" aria-label="Режим">
          <button aria-pressed={view === 'edit'} onClick={() => setView('edit')} title="Текст">
            <Pencil size={13} />
            <span className={styles.hideNarrow}>Текст</span>
          </button>
          {variant === 'full' && (
            <button aria-pressed={view === 'split'} onClick={() => setView('split')} title="Текст и просмотр">
              <Columns2 size={13} />
              <span className={styles.hideNarrow}>Оба</span>
            </button>
          )}
          <button aria-pressed={view === 'preview'} onClick={() => setView('preview')} title="Просмотр">
            <Eye size={13} />
            <span className={styles.hideNarrow}>Просмотр</span>
          </button>
        </div>
        {view !== 'preview' && (
          <div className={styles.apaneInsert}>
            <ItemPicker small placeholder="Вставить предмет…" onPick={(it) => insertAt(itemToken(it.i))} />
          </div>
        )}
        {view !== 'preview' && filesEnabled && (
          <>
            <button
              className="btn ghost sm icon"
              onClick={() => fileInput.current?.click()}
              aria-label="Вставить картинку"
              title="Картинка (можно вставить из буфера или перетащить в текст)"
            >
              <ImagePlus size={15} />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                images.add([...(e.target.files ?? [])], selection[1]);
                e.target.value = '';
              }}
            />
          </>
        )}
        <span className="grow" />
        <button className="btn ghost sm icon danger" onClick={remove} aria-label="Удалить план" title="Удалить">
          <Trash2 size={15} />
        </button>
      </div>

      <div className={cx(styles.apaneDoc, view === 'split' && styles.viewSplit)}>
        {view !== 'preview' && (
          <Suspense fallback={<div className={cx(styles.apaneText, 'faint')}>Загрузка редактора…</div>}>
            <LiveMarkdown
              ref={liveRef}
              className={styles.apaneText}
              value={content}
              placeholder={PLACEHOLDER}
              onChange={change}
              onSelect={setSelection}
              onBlur={() => latest.current.dirty && flush(latest.current.content)}
              onImages={filesEnabled ? images.add : undefined}
              onMediaChange={images.noteMedia}
            />
          </Suspense>
        )}
        {view !== 'edit' && (
          <div className={styles.apanePreview} onDoubleClick={() => setView(variant === 'full' ? 'split' : 'edit')}>
            {content.trim() ? (
              <Markdown
                source={content}
                onToggleTask={(line) => {
                  const next = toggleTaskLine(content, line);
                  if (next !== null) change(next);
                }}
              />
            ) : (
              <div className="empty">Пусто. Начните писать или попросите агента.</div>
            )}
          </div>
        )}
      </div>

      <AgentPanel
        className={variant === 'full' ? styles.agentFull : undefined}
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
