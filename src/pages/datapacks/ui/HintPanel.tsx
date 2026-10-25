import { Lightbulb, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import { ErrorBox } from '@/shared/ui';
import { useEffect, useState } from 'react';
import { useNick } from '@/entities/user';
import { generateRecipeHint, geminiEnabled, geminiErrorText } from '@/shared/api';
import { getHint, hintsEnabled, saveHint, type RecipeHint } from '../model/recipeHints';
import { typeFieldStats, type RecipeCatalog } from '@/shared/pack-data';
import { cx, timeAgo } from '@/shared/lib';
import { Markdown } from '@/components/Markdown';
import { MarkdownField } from '@/components/MarkdownField';
import { Button } from '@/shared/ui';
import styles from './HintPanel.module.css';

const SOURCE_LABEL: Record<RecipeHint['source'], string> = {
  claude: 'первичное наполнение',
  agent: 'агент',
  manual: 'правка',
};

/** Подсказка по заполнению рецептов типа: из Firestore, с генерацией/обновлением агентом и ручной правкой */
export function HintPanel({ type, catalog }: { type: string | undefined; catalog: RecipeCatalog | null }) {
  const nick = useNick();
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

  if (!type)
    return (
      <div className={cx(styles.hintBox, 'faint', 'small')}>Тип рецепта не определён — укажи поле «type» в JSON.</div>
    );
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
    <div className={styles.hintBox}>
      <div className={styles.hintHead}>
        <Lightbulb size={15} />
        <span className={cx('grow', styles.hintTitle)}>{hint?.title ?? type}</span>
        {hint && !editing && (
          <Button
            variant="ghost"
            size="sm"
            icon
            onClick={() => (setDraft(hint.body), setEditing(true))}
            aria-label="Править подсказку"
            title="Править"
          >
            <Pencil size={13} />
          </Button>
        )}
      </div>
      <code className={styles.hintType}>
        {type}
        {count > 0 && <span className="faint"> · {count} рецептов в сборке</span>}
      </code>

      {hint === undefined ? (
        <div className="faint small">Загружаю подсказку…</div>
      ) : editing ? (
        <>
          <MarkdownField autoFocus rows={12} value={draft} onChange={setDraft} />
          <div className="row">
            <span className="grow" />
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Отмена
            </Button>
            <Button variant="primary" size="sm" onClick={saveManual} disabled={busy || !draft.trim()}>
              Сохранить
            </Button>
          </div>
        </>
      ) : hint ? (
        <>
          <Markdown source={hint.body} className={styles.hintBody} />
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
        <Button variant="ai" size="sm" onClick={generate} disabled={busy || !catalog}>
          {hint ? <RefreshCw size={13} /> : <Sparkles size={13} />}
          {busy ? 'Агент изучает рецепты…' : hint ? 'Обновить агентом' : 'Составить агентом'}
        </Button>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}
