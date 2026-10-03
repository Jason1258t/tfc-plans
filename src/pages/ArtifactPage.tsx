import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GeminiPanel } from '../components/GeminiPanel';
import { ItemIcon } from '../components/ItemIcon';
import { ItemPicker } from '../components/ItemPicker';
import { Markdown, itemToken } from '../components/Markdown';
import { useData } from '../data/DataContext';
import { artifactsStore } from '../data/store';
import { geminiEnabled } from '../lib/gemini';
import { cx, timeAgo } from '../lib/util';
import type { Artifact } from '../types';
import './ArtifactPage.css';

type View = 'edit' | 'split' | 'preview';

export function ArtifactPage() {
  const { id } = useParams();
  const { artifacts, loading } = useData();
  const artifact = artifacts.find((a) => a.id === id);

  if (!artifact) {
    return (
      <div className="artifact-page">
        <div className="mc-panel">{loading ? 'Загрузка…' : 'Артефакт не найден — возможно, его удалили.'}</div>
      </div>
    );
  }
  return <ArtifactEditor key={artifact.id} artifact={artifact} />;
}

const SAVE_DELAY = 800;

function ArtifactEditor({ artifact }: { artifact: Artifact }) {
  const { tasks, nick } = useData();
  const navigate = useNavigate();
  const task = tasks.find((t) => t.id === artifact.taskId);

  const [view, setView] = useState<View>(() => (artifact.content ? 'preview' : 'split'));
  const [content, setContent] = useState(artifact.content);
  const [title, setTitle] = useState(artifact.title);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiOpen, setAiOpen] = useState(geminiEnabled && !artifact.content);
  const [selection, setSelection] = useState<[number, number]>([0, 0]);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  // Чужие правки подтягиваем, пока у нас нет несохранённых изменений
  useEffect(() => {
    if (!dirty) setContent(artifact.content);
  }, [artifact.content, dirty]);
  useEffect(() => {
    if (document.activeElement?.id !== 'artifact-title') setTitle(artifact.title);
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

  // Сохраняем при уходе со страницы
  const latest = useRef({ content, dirty });
  useEffect(() => {
    latest.current = { content, dirty };
  }, [content, dirty]);
  useEffect(
    () => () => {
      if (latest.current.dirty)
        artifactsStore.update(artifact.id, { content: latest.current.content, updatedBy: nick });
    },
    [artifact.id, nick],
  );

  const trackSelection = () => {
    const el = textRef.current;
    if (el) setSelection([el.selectionStart, el.selectionEnd]);
  };

  /** Вставка в позицию курсора (или замена выделения) */
  const insertAt = (text: string, range: [number, number] = selection) => {
    const [s, e] = range;
    const next = content.slice(0, s) + text + content.slice(e);
    change(next);
    const pos = s + text.length;
    setSelection([pos, pos]);
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const remove = async () => {
    if (!confirm(`Удалить артефакт «${artifact.title}»?`)) return;
    await artifactsStore.remove(artifact.id);
    navigate(task ? `/?task=${task.id}` : '/artifacts');
  };

  const selectedText = content.slice(selection[0], selection[1]);

  return (
    <div className={cx('artifact-page', aiOpen && 'with-ai')}>
      <div className="artifact-main">
        <div className="mc-panel artifact-head">
          <div className="row wrap">
            {task ? (
              <Link to={`/?task=${task.id}`} className="mc-btn sm">
                ← {task.title.length > 30 ? `${task.title.slice(0, 30)}…` : task.title}
              </Link>
            ) : (
              <Link to="/artifacts" className="mc-btn sm">
                ← Артефакты
              </Link>
            )}
            <span className="grow" />
            <span className="muted save-state">
              {saving
                ? 'Сохраняю…'
                : dirty
                  ? 'Есть изменения'
                  : `Сохранено · ${artifact.updatedBy}, ${timeAgo(artifact.updatedAt)}`}
            </span>
          </div>
          <div className="row">
            <ItemIcon texture="minecraft/item/written_book" size={32} tip={false} />
            <input
              id="artifact-title"
              className="mc-input artifact-title"
              value={title}
              placeholder="Название"
              aria-label="Название артефакта"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() =>
                title.trim() !== artifact.title &&
                artifactsStore.update(artifact.id, { title: title.trim(), updatedBy: nick })
              }
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </div>
          <div className="row wrap toolbar">
            <div className="seg" role="group" aria-label="Режим">
              {(
                [
                  ['edit', 'Текст'],
                  ['split', 'Оба'],
                  ['preview', 'Просмотр'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} className={cx('mc-btn sm', view === v && 'active')} onClick={() => setView(v)}>
                  {label}
                </button>
              ))}
            </div>
            {view !== 'preview' && (
              <div className="insert-item">
                <ItemPicker placeholder="Вставить предмет…" onPick={(it) => insertAt(itemToken(it.i))} />
              </div>
            )}
            <span className="grow" />
            {geminiEnabled && (
              <button className={cx('mc-btn sm', aiOpen && 'active')} onClick={() => setAiOpen((v) => !v)}>
                <ItemIcon texture="minecraft/item/nether_star" size={18} tip={false} />
                Gemini
              </button>
            )}
            <button className="mc-btn sm red" onClick={remove}>
              Удалить
            </button>
          </div>
        </div>

        <div className={cx('artifact-body', `view-${view}`)}>
          {view !== 'preview' && (
            <textarea
              ref={textRef}
              className="mc-input artifact-text"
              value={content}
              spellCheck
              placeholder={
                '# План\n\nMarkdown: заголовки, списки, таблицы, - [ ] чекбоксы.\nПредметы: [[tfc:metal/ingot/bronze|4]] — или кнопкой «Вставить предмет».'
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
            <div className="mc-panel artifact-preview">
              {content.trim() ? (
                <Markdown source={content} />
              ) : (
                <div className="muted">Пусто. Начните писать или попросите Gemini.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {aiOpen && (
        <GeminiPanel
          artifact={{ ...artifact, content }}
          task={task}
          selectedText={selectedText}
          onInsert={(text) => insertAt(text, [selection[1], selection[1]])}
          onAppend={(text) => change(`${content.trimEnd()}${content.trim() ? '\n\n' : ''}${text}\n`)}
          onReplaceSelection={selectedText ? (text) => insertAt(text) : undefined}
          onReplaceAll={(text) => change(text)}
          onClose={() => setAiOpen(false)}
        />
      )}
    </div>
  );
}
