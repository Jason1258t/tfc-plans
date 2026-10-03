import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  ListPlus,
  Replace,
  Sparkles,
  Square,
  TextCursorInput,
  Trash,
  WrapText,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { tasksStore } from '../data/store';
import { askGemini, describeTask, extractResources, geminiEnabled, geminiErrorText } from '../lib/gemini';
import { useItems } from '../lib/items';
import { mergeResources } from '../lib/resources';
import { cx } from '../lib/util';
import type { Artifact, Task } from '../types';
import './AgentPanel.css';
import { Markdown } from './Markdown';

interface Msg {
  id: number;
  role: 'user' | 'model';
  text: string;
  /** Выделенный фрагмент, с которым работал запрос — для «Заменить выделенное» */
  selection?: string;
  error?: boolean;
  pending?: boolean;
  note?: string;
}

interface Props {
  artifact: Artifact;
  task?: Task;
  selectedText: string;
  onInsert: (text: string) => void;
  onAppend: (text: string) => void;
  onReplaceSelection: (original: string, text: string) => void;
  onReplaceAll: (text: string) => void;
}

const SUGGESTIONS = [
  {
    label: 'Составь пошаговый план',
    prompt: 'Составь пошаговый план выполнения задачи: этапы, инструменты, постройки.',
  },
  {
    label: 'Таблица ресурсов',
    prompt: 'Составь таблицу всех нужных ресурсов: предмет, количество, где взять или как сделать.',
  },
  { label: 'Что я упускаю?', prompt: 'Проверь план: какие шаги, риски или подготовительные этапы TFC здесь упущены?' },
  {
    label: 'Структурировать',
    prompt: 'Перепиши документ: структурируй заголовками и списками, убери повторы, ничего не теряя.',
  },
];

/** Переписка с агентом живёт, пока открыта вкладка, — отдельно для каждого документа */
const threads = new Map<string, Msg[]>();
let nextId = 1;

export function AgentPanel(p: Props) {
  const items = useItems();
  const [messages, setMessages] = useState<Msg[]>(() => threads.get(p.artifact.id) ?? []);
  const [input, setInput] = useState('');
  const [useSelection, setUseSelection] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    threads.set(p.artifact.id, messages);
  }, [p.artifact.id, messages]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const hasSelection = Boolean(p.selectedText.trim());
  const withSelection = useSelection && hasSelection;

  const patchMsg = (id: number, patch: Partial<Msg>) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const send = async (text: string) => {
    const instruction = text.trim();
    if (!instruction || busy) return;
    const selection = withSelection ? p.selectedText : undefined;
    const history = messages.filter((m) => !m.error && !m.pending).map((m) => ({ role: m.role, text: m.text }));
    const userMsg: Msg = { id: nextId++, role: 'user', text: instruction, selection };
    const reply: Msg = { id: nextId++, role: 'model', text: '', pending: true, selection };
    setMessages((list) => [...list, userMsg, reply]);
    setInput('');
    setExpanded(true);
    setBusy(true);
    abort.current = new AbortController();
    try {
      await askGemini(
        {
          instruction,
          history,
          taskContext: p.task ? describeTask(p.task, items) : undefined,
          document: `# ${p.artifact.title}\n\n${p.artifact.content}`,
          selection,
        },
        (full) => patchMsg(reply.id, { text: full }),
        abort.current.signal,
      );
      patchMsg(reply.id, { pending: false });
    } catch (e) {
      const aborted = abort.current?.signal.aborted;
      setMessages((list) =>
        list.map((m) =>
          m.id === reply.id
            ? aborted
              ? { ...m, pending: false, note: 'Остановлено' }
              : { ...m, pending: false, error: true, text: geminiErrorText(e) }
            : m,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const toChecklist = async (msg: Msg) => {
    if (!p.task) return;
    patchMsg(msg.id, { note: 'Ищу ресурсы…' });
    try {
      const found = await extractResources(msg.text);
      await tasksStore.update(p.task.id, { checklist: mergeResources(p.task.checklist, found, items) });
      patchMsg(msg.id, { note: found.length ? `В чеклист задачи добавлено: ${found.length}` : 'Ресурсов не нашлось' });
    } catch (e) {
      patchMsg(msg.id, { note: `Ошибка: ${geminiErrorText(e)}` });
    }
  };

  if (!geminiEnabled) {
    return (
      <div className="agent disabled">
        <div className="agent-head">
          <Sparkles size={15} />
          <span className="grow">Агент Gemini</span>
        </div>
        <div className="faint small" style={{ padding: '0 14px 12px' }}>
          Доступен, когда подключён Firebase (см. README).
        </div>
      </div>
    );
  }

  return (
    <div className={cx('agent', expanded && messages.length > 0 && 'expanded')}>
      <div className="agent-head">
        <Sparkles size={15} />
        <span className="grow">Агент Gemini</span>
        {messages.length > 0 && (
          <>
            <button
              className="btn ghost sm icon"
              onClick={() => setMessages([])}
              disabled={busy}
              aria-label="Очистить переписку"
              title="Очистить переписку"
            >
              <Trash size={14} />
            </button>
            <button
              className="btn ghost sm icon"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Свернуть переписку' : 'Развернуть переписку'}
            >
              {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </button>
          </>
        )}
      </div>

      {expanded && messages.length > 0 && (
        <div className="agent-thread" ref={threadRef} aria-live="polite">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="msg user">
                {m.selection && <div className="msg-sel">Выделение: «{clip(m.selection, 80)}»</div>}
                {m.text}
              </div>
            ) : (
              <div key={m.id} className={cx('msg model', m.error && 'error')}>
                {m.pending && !m.text ? (
                  <div className="typing">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : m.error ? (
                  m.text
                ) : (
                  <Markdown source={m.text} />
                )}
                {!m.pending && !m.error && m.text && (
                  <div className="msg-actions">
                    <button className="btn sm" onClick={() => p.onAppend(m.text)} title="Добавить в конец документа">
                      <WrapText size={13} /> В конец
                    </button>
                    <button
                      className="btn ghost sm"
                      onClick={() => p.onInsert(m.text)}
                      title="Вставить в позицию курсора"
                    >
                      <TextCursorInput size={13} /> В курсор
                    </button>
                    {m.selection && (
                      <button
                        className="btn ghost sm"
                        onClick={() => p.onReplaceSelection(m.selection!, m.text)}
                        title="Заменить выделенный фрагмент"
                      >
                        <Replace size={13} /> Заменить фрагмент
                      </button>
                    )}
                    <button
                      className="btn ghost sm"
                      onClick={() => confirm('Заменить весь документ этим ответом?') && p.onReplaceAll(m.text)}
                    >
                      <Replace size={13} /> Заменить всё
                    </button>
                    {p.task && (
                      <button
                        className="btn ghost sm"
                        onClick={() => toChecklist(m)}
                        title="Добавить ресурсы в чеклист задачи"
                      >
                        <ListPlus size={13} /> В чеклист
                      </button>
                    )}
                    <button
                      className="btn ghost sm icon"
                      onClick={() => navigator.clipboard.writeText(m.text)}
                      aria-label="Копировать"
                      title="Копировать"
                    >
                      <ClipboardCopy size={13} />
                    </button>
                  </div>
                )}
                {m.note && <div className="msg-note">{m.note}</div>}
              </div>
            ),
          )}
        </div>
      )}

      {messages.length === 0 && (
        <div className="agent-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s.label} className="chip" onClick={() => send(s.prompt)} disabled={busy}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {hasSelection && (
          <label className={cx('ctx-chip', withSelection && 'on')} onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={withSelection} onChange={(e) => setUseSelection(e.target.checked)} />
            Только выделенное · {p.selectedText.length} симв.
          </label>
        )}
        <div className="composer-row">
          <textarea
            ref={inputRef}
            className="composer-input"
            rows={1}
            value={input}
            placeholder={p.task ? `Спросите агента про «${clip(p.task.title, 40)}»…` : 'Спросите агента про этот план…'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            aria-label="Сообщение агенту"
          />
          {busy ? (
            <button type="button" className="send stop" onClick={() => abort.current?.abort()} aria-label="Остановить">
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button className="send" disabled={!input.trim()} aria-label="Отправить">
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
        <div className="composer-hint faint">
          Агент видит документ{p.task ? ' и задачу' : ''}. Enter — отправить, Shift+Enter — новая строка.
        </div>
      </form>
    </div>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
