import { Lightbulb, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useData } from '../data/DataContext';
import { generateRecipeHint, geminiEnabled, geminiErrorText } from '../lib/gemini';
import { getHint, hintsEnabled, saveHint, type RecipeHint } from '../lib/recipeHints';
import { typeFieldStats, type RecipeCatalog } from '../lib/recipes';
import { timeAgo } from '../lib/util';
import { Markdown } from './Markdown';

const SOURCE_LABEL: Record<RecipeHint['source'], string> = {
  claude: 'первичное наполнение',
  agent: 'агент',
  manual: 'правка',
};

/** Подсказка по заполнению рецептов типа: из Firestore, с генерацией/обновлением агентом и ручной правкой */
export function HintPanel({ type, catalog }: { type: string | undefined; catalog: RecipeCatalog | null }) {
  const { nick } = useData();
  const [hint, setHint] = useState<RecipeHint | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setHint(undefined);
    setEditing(false);
    setError(null);
    if (!type) return;
    let alive = true;
    getHint(type).then(
      (h) => alive && setHint(h),
      (e) => alive && (setHint(null), setError(e instanceof Error ? e.message : String(e))),
    );
    return () => {
      alive = false;
    };
  }, [type]);

  if (!type) return <div className="hint-box faint small">Тип рецепта не определён — укажи поле «type» в JSON.</div>;
  if (!hintsEnabled) return null;

  const generate = async () => {
    if (!catalog) return;
    setBusy(true);
    setError(null);
    try {
      const sameType = catalog.list.filter((r) => r.t === type && !r.removed);
      // Примеры: короткий, средний и самый «полный» — чтобы агент видел разброс вариантов
      const sorted = [...sameType].sort((a, b) => JSON.stringify(a.j).length - JSON.stringify(b.j).length);
      const examples = [...new Set([sorted[0], sorted[Math.floor(sorted.length / 2)], sorted.at(-1)])]
        .filter(Boolean)
        .map((r) => r!.j);
      const g = await generateRecipeHint(type, typeFieldStats(catalog, type), examples, hint?.body);
      setHint(await saveHint({ type, title: g.title, body: g.body, source: 'agent', updatedBy: nick }));
    } catch (e) {
      setError(geminiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveManual = async () => {
    setBusy(true);
    try {
      setHint(
        await saveHint({
          type,
          title: hint?.title || type,
          body: draft,
          source: 'manual',
          updatedBy: nick,
        }),
      );
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const count = catalog?.types.find(([t]) => t === type)?.[1] ?? 0;

  return (
    <div className="hint-box">
      <div className="hint-head">
        <Lightbulb size={15} />
        <span className="grow hint-title">{hint?.title ?? type}</span>
        {hint && !editing && (
          <button
            className="btn ghost sm icon"
            onClick={() => (setDraft(hint.body), setEditing(true))}
            aria-label="Править подсказку"
            title="Править"
          >
            <Pencil size={13} />
          </button>
        )}
      </div>
      <code className="hint-type">
        {type}
        {count > 0 && <span className="faint"> · {count} рецептов в сборке</span>}
      </code>

      {hint === undefined ? (
        <div className="faint small">Загружаю подсказку…</div>
      ) : editing ? (
        <>
          <textarea className="input mono" rows={12} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="row">
            <span className="grow" />
            <button className="btn ghost sm" onClick={() => setEditing(false)}>
              Отмена
            </button>
            <button className="btn primary sm" onClick={saveManual} disabled={busy || !draft.trim()}>
              Сохранить
            </button>
          </div>
        </>
      ) : hint ? (
        <>
          <Markdown source={hint.body} className="hint-body" />
          <div className="faint small">
            {SOURCE_LABEL[hint.source] ?? hint.source} · {hint.updatedBy}, {timeAgo(hint.updatedAt)}
          </div>
        </>
      ) : (
        <div className="faint small">
          Подсказки для этого типа пока нет — например, сборка обновилась и появился новый механизм.
          {count > 0 && ' Агент может составить её по рецептам этого типа из сборки.'}
        </div>
      )}

      {geminiEnabled && !editing && hint !== undefined && count > 0 && (
        <button className="btn ai sm" onClick={generate} disabled={busy || !catalog}>
          {hint ? <RefreshCw size={13} /> : <Sparkles size={13} />}
          {busy ? 'Агент изучает рецепты…' : hint ? 'Обновить агентом' : 'Составить агентом'}
        </button>
      )}
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}
