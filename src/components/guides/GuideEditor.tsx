import { HelpCircle, X } from 'lucide-react';
import { useDeferredValue, useRef, useState } from 'react';
import { saveGuide, type GuideDraft } from '../../data/guides';
import { readNick } from '@/shared/lib/nick';
import type { Guide, GuideChecked } from '@/entities/guide';
import { ItemIcon, ItemPicker } from '@/shared/pack-data';
import type { LiveMarkdownHandle } from '../LiveMarkdown';
import { MarkdownField } from '../MarkdownField';
import { GuideBody, type GuideKit } from './GuideBody';
import { GuideHelp } from './GuideHelp';
import { GuideEditingContext } from './guideLinks';
import { CHECKED } from './guideMeta';

const NEW_BODY = `## Что понадобится

- [[electroenergetics:stator]] …

## Как собрать

1. …

## Калькулятор

\`\`\`calc
title: Калькулятор
inputs:
  rpm: { label: Обороты вала, default: 64, min: 1, max: 256, unit: об/мин }
let:
  g: alternator(4, rpm)
outputs:
  - { label: Напряжение, value: g.emf, fmt: 1 В }
\`\`\`

## Почему так

…

## Что проверено

- По коду мода: …
- Не проверено: в игре — ничего.
`;

/** Правка гайда: поля, текст со вставками и живой предпросмотр */
export function GuideEditor({
  section,
  id,
  kit,
  guide,
  started,
  restore,
  nextOrder,
  groups,
  onClose,
  onGuide,
}: {
  section: string;
  /** Id новой статьи (статья аддона — addon-<мод>); без него id выдаст Firestore */
  id?: string;
  kit: GuideKit;
  /** Актуальная версия из базы (null — новый гайд) */
  guide: Guide | null;
  /** Какой статья была, когда начали править, — чтобы заметить чужую правку */
  started: Guide | null;
  /** Версия из истории, которую возвращают */
  restore: Pick<Guide, 'title' | 'summary' | 'body'> | null;
  nextOrder: number;
  groups: string[];
  onClose: (savedId: string | null) => void;
  onGuide: (id: string) => void;
}) {
  const base = started ?? guide;
  const [title, setTitle] = useState(restore?.title ?? base?.title ?? '');
  const [summary, setSummary] = useState(restore?.summary ?? base?.summary ?? '');
  const [body, setBody] = useState(restore?.body ?? base?.body ?? NEW_BODY);
  const [icon, setIcon] = useState<string | null>(base?.icon ?? null);
  const [group, setGroup] = useState(base?.group ?? '');
  const [order, setOrder] = useState(base?.order ?? nextOrder);
  const [checked, setChecked] = useState<GuideChecked>(base?.checked ?? 'none');
  const [hidden, setHidden] = useState(base?.hidden ?? false);
  const [help, setHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<LiveMarkdownHandle>(null);
  const selection = useRef<[number, number]>([0, 0]);
  const preview = useDeferredValue(body);
  const previewSummary = useDeferredValue(summary);

  const changed =
    !base ||
    title !== base.title ||
    summary !== base.summary ||
    body !== base.body ||
    icon !== base.icon ||
    group !== base.group ||
    order !== base.order ||
    checked !== base.checked ||
    hidden !== base.hidden;

  const insert = (text: string) => {
    const el = area.current;
    if (!el) return setBody((b) => b + text);
    const [a, b] = selection.current;
    setBody(body.slice(0, a) + text + body.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.select(a + text.length);
    });
  };

  const save = async () => {
    const nick = readNick();
    if (!nick) return setError('Нет ника — укажите его вверху справа');
    if (!title.trim()) return setError('Нужен заголовок');
    if (
      started &&
      guide &&
      guide.updatedAt !== started.updatedAt &&
      !confirm(
        `Пока вы правили, статью сохранил ${guide.updatedBy}. Сохранить вашу версию поверх? Его правка останется в истории.`,
      )
    )
      return;
    const draft: GuideDraft = {
      section,
      title: title.trim(),
      summary: summary.trim(),
      body,
      icon,
      group: group.trim(),
      order,
      checked,
      hidden,
      updatedBy: nick,
    };
    setSaving(true);
    setError(null);
    try {
      onClose(await saveGuide(guide?.id ?? id ?? null, draft, guide?.createdAt));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <section className="guide-editor">
      <header className="guide-list-head">
        <h2 className="power-h">{guide ? `Правка: ${guide.title}` : 'Новый гайд'}</h2>
        <div className="guide-head-actions">
          <button className="btn ghost small" onClick={() => setHelp(!help)}>
            <HelpCircle size={14} /> Справка
          </button>
          <button
            className="btn ghost small"
            onClick={() => (!changed || confirm('Выйти без сохранения?')) && onClose(null)}
            disabled={saving}
          >
            Отмена
          </button>
          <button className="btn small" onClick={save} disabled={saving || !changed}>
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </header>
      {restore && <div className="power-note small">Это версия из истории — сохраните, чтобы вернуть её.</div>}
      {error && <div className="guide-errors small">{error}</div>}
      {help && <GuideHelp kit={kit} onClose={() => setHelp(false)} />}

      <div className="guide-fields">
        <label className="guide-field guide-field-wide">
          <span className="faint small">Заголовок</span>
          <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="guide-field guide-field-wide">
          <span className="faint small">Коротко — 1–3 предложения: в списке и плашкой наверху; можно {'{{…}}'}</span>
          <textarea
            className="input"
            rows={2}
            value={summary}
            maxLength={1000}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        <div className="guide-field">
          <span className="faint small">Значок</span>
          <span className="guide-icon-field">
            {icon ? (
              <>
                <ItemIcon id={icon} size={24} />
                <button className="btn ghost small" onClick={() => setIcon(null)} title="Убрать значок">
                  <X size={12} />
                </button>
              </>
            ) : (
              <ItemPicker small onPick={(it) => setIcon(it.i)} placeholder="Предмет…" />
            )}
          </span>
        </div>
        <label className="guide-field">
          <span className="faint small">Группа в списке</span>
          <input
            className="input"
            list="guide-groups"
            value={group}
            maxLength={80}
            onChange={(e) => setGroup(e.target.value)}
          />
          <datalist id="guide-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>
        <label className="guide-field">
          <span className="faint small">Порядок</span>
          <input
            className="input guide-order"
            type="number"
            value={order}
            onChange={(e) => Number.isFinite(Number(e.target.value)) && setOrder(Number(e.target.value))}
          />
        </label>
        <label className="guide-field">
          <span className="faint small">Насколько проверено</span>
          <select className="input" value={checked} onChange={(e) => setChecked(e.target.value as GuideChecked)}>
            {Object.entries(CHECKED).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="guide-field guide-check">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          <span className="small">снят с публикации</span>
        </label>
      </div>

      <div className="guide-split">
        <div className="guide-source">
          <div className="guide-source-bar">
            <span className="faint small">Текст (Markdown)</span>
            <ItemPicker small dropUp={false} onPick={(it) => insert(`[[${it.i}]]`)} placeholder="Вставить предмет…" />
          </div>
          <MarkdownField
            ref={area}
            rows={30}
            maxRows={60}
            value={body}
            onChange={setBody}
            onSelect={(range) => (selection.current = range)}
          />
        </div>
        <GuideEditingContext.Provider value>
          <div className="guide-preview">
            <span className="faint small">Предпросмотр — калькуляторы работают</span>
            <article className="ref-card power-article guide-article">
              <h2 className="power-h">{title || 'Без заголовка'}</h2>
              {previewSummary && (
                <div className="power-note guide-summary">
                  <GuideBody source={`**Коротко.** ${previewSummary}`} kit={kit} onGuide={onGuide} />
                </div>
              )}
              <GuideBody source={preview} kit={kit} onGuide={onGuide} />
            </article>
          </div>
        </GuideEditingContext.Provider>
      </div>
    </section>
  );
}
