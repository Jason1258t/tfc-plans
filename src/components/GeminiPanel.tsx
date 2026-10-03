import { useRef, useState } from 'react';
import { tasksStore } from '../data/store';
import { askGemini, describeTask, extractResources } from '../lib/gemini';
import { useItems } from '../lib/items';
import { mergeResources } from '../lib/resources';
import type { Artifact, Task } from '../types';
import { ItemIcon } from './ItemIcon';
import { Markdown } from './Markdown';
import './GeminiPanel.css';

interface Props {
  artifact: Artifact;
  task?: Task;
  selectedText: string;
  onInsert: (text: string) => void;
  onAppend: (text: string) => void;
  onReplaceSelection?: (text: string) => void;
  onReplaceAll: (text: string) => void;
  onClose: () => void;
}

const PRESETS: { label: string; prompt: string }[] = [
  {
    label: 'Пошаговый план',
    prompt: 'Составь пошаговый план выполнения задачи с этапами, нужными инструментами и постройками.',
  },
  {
    label: 'Ресурсы таблицей',
    prompt: 'Составь таблицу всех нужных ресурсов: предмет, количество, где взять/как сделать.',
  },
  { label: 'Что упускаю?', prompt: 'Проверь план: какие шаги, риски или подготовительные этапы TFC здесь упущены?' },
  {
    label: 'Структурировать',
    prompt: 'Перепиши документ: структурируй заголовками и списками, убери повторы, ничего не теряя.',
  },
];

export function GeminiPanel(p: Props) {
  const items = useItems();
  const [instruction, setInstruction] = useState('');
  const [useSelection, setUseSelection] = useState(true);
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const withSelection = useSelection && Boolean(p.selectedText.trim());

  const run = async (text: string) => {
    if (!text.trim() || busy) return;
    abort.current = new AbortController();
    setBusy(true);
    setError(null);
    setNote(null);
    setOutput('');
    try {
      await askGemini(
        {
          instruction: text,
          taskContext: p.task ? describeTask(p.task, items) : undefined,
          document: `# ${p.artifact.title}\n\n${p.artifact.content}`,
          selection: withSelection ? p.selectedText : undefined,
        },
        setOutput,
        abort.current.signal,
      );
    } catch (e) {
      if (!abort.current?.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toChecklist = async () => {
    if (!p.task) return;
    setBusy(true);
    setError(null);
    try {
      const found = await extractResources(output || p.artifact.content);
      const next = mergeResources(p.task.checklist, found, items);
      await tasksStore.update(p.task.id, { checklist: next });
      setNote(`В чеклист задачи добавлено/обновлено: ${found.length}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="gemini-panel mc-dark">
      <div className="row">
        <ItemIcon texture="minecraft/item/nether_star" size={24} tip={false} />
        <h2 className="grow shadow">Gemini</h2>
        <button className="mc-btn sm icon-only" onClick={p.onClose} aria-label="Закрыть панель Gemini">
          ✕
        </button>
      </div>

      <div className="row wrap" style={{ gap: 4 }}>
        {PRESETS.map((pr) => (
          <button key={pr.label} className="mc-btn sm" disabled={busy} onClick={() => run(pr.prompt)}>
            {pr.label}
          </button>
        ))}
      </div>

      <form
        className="stack"
        style={{ gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          run(instruction);
        }}
      >
        <textarea
          className="mc-input"
          rows={3}
          value={instruction}
          placeholder="Свой запрос: «распиши, как дойти до бронзовых инструментов»…"
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              run(instruction);
            }
          }}
        />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <label
            className="row on-dark"
            style={{ fontSize: 14, cursor: 'pointer', opacity: p.selectedText.trim() ? 1 : 0.5 }}
          >
            <input
              type="checkbox"
              checked={withSelection}
              disabled={!p.selectedText.trim()}
              onChange={(e) => setUseSelection(e.target.checked)}
            />
            Только выделенное
          </label>
          {busy ? (
            <button type="button" className="mc-btn sm red" onClick={() => abort.current?.abort()}>
              Стоп
            </button>
          ) : (
            <button className="mc-btn sm green" disabled={!instruction.trim()}>
              Спросить
            </button>
          )}
        </div>
      </form>

      {error && <div className="gemini-error">{error}</div>}
      {note && <div className="gemini-note">{note}</div>}

      {(output || busy) && (
        <div className="gemini-output">
          {output ? <Markdown source={output} /> : <div className="muted">Думаю…</div>}
        </div>
      )}

      {output && !busy && (
        <div className="row wrap" style={{ gap: 4 }}>
          <button className="mc-btn sm" onClick={() => p.onInsert(output)}>
            В курсор
          </button>
          <button className="mc-btn sm" onClick={() => p.onAppend(output)}>
            В конец
          </button>
          {p.onReplaceSelection && withSelection && (
            <button className="mc-btn sm" onClick={() => p.onReplaceSelection!(output)}>
              Заменить выделенное
            </button>
          )}
          <button
            className="mc-btn sm"
            onClick={() => confirm('Заменить весь документ ответом Gemini?') && p.onReplaceAll(output)}
          >
            Заменить всё
          </button>
          <button className="mc-btn sm" onClick={() => navigator.clipboard.writeText(output)}>
            Копировать
          </button>
        </div>
      )}

      {p.task && (
        <button
          className="mc-btn sm"
          disabled={busy}
          onClick={toChecklist}
          title="Gemini найдёт ресурсы и добавит их в чеклист задачи"
        >
          <ItemIcon texture="minecraft/item/experience_bottle" size={18} tip={false} />
          Ресурсы {output ? 'из ответа' : 'из документа'} → чеклист
        </button>
      )}
    </aside>
  );
}
