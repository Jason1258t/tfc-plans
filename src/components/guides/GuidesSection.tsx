import { ArrowLeft, BookOpen, Eye, EyeOff, History, Pencil, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { guidesEnabled, subscribeGuides } from '../../data/guides';
import { readNick } from '../../lib/nick';
import { cx } from '@/shared/lib';
import type { Guide, GuideChecked } from '../../types';
import { CHECKED } from './guideMeta';
import { ItemIcon } from '@/shared/pack-data';
import { GuideBody, type GuideKit } from './GuideBody';
import { GuideEditor } from './GuideEditor';
import { GuideHistory } from './GuideHistory';
import { expand } from './guideText';
import './Guides.css';

/**
 * Гайды раздела справочника: список карточками, статья, правка на сайте. Статьи — Firestore guides (правят все,
 * у каждой история версий), формулы и виджеты раздела — kit. Адрес статьи — ?…&g=<id>.
 */

const date = (t: number) =>
  new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

/** Текст без разметки — для карточки в списке */
const plain = (md: string) =>
  md
    .replace(/\[\[[^\]]+\]\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .trim();

export function GuidesSection({
  section,
  kit,
  guide,
  onGuide,
  intro,
  checks = true,
}: {
  section: string;
  kit: GuideKit;
  guide: string | null;
  onGuide: (id: string | null) => void;
  intro?: string;
  /** Значок «проверено в игре / по коду»; разделу про сам сайт он ни к чему */
  checks?: boolean;
}) {
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Guide | 'new' | null>(null);
  const [history, setHistory] = useState<Guide | null>(null);
  const [restore, setRestore] = useState<Pick<Guide, 'title' | 'summary' | 'body'> | null>(null);

  useEffect(
    () =>
      subscribeGuides(section, setGuides, (e) => {
        setError(e.message);
        setGuides([]);
      }),
    [section],
  );

  if (!guidesEnabled) return <div className="empty">Гайды хранятся в Firestore — без Firebase их негде взять</div>;
  if (guides === null) return <div className="empty">Загружаю гайды…</div>;

  const startEdit = (g: Guide | 'new') => {
    if (!readNick()) {
      alert('Сначала укажите ник (вверху справа) — им подписываются правки');
      return;
    }
    setRestore(null);
    setEditing(g);
  };

  if (editing) {
    const g = editing === 'new' ? null : (guides.find((x) => x.id === editing.id) ?? editing);
    return (
      <GuideEditor
        section={section}
        kit={kit}
        guide={g}
        started={editing === 'new' ? null : editing}
        restore={restore}
        nextOrder={Math.max(0, ...guides.map((x) => x.order)) + 10}
        groups={[...new Set(guides.map((x) => x.group).filter(Boolean))]}
        onClose={(id) => {
          setEditing(null);
          if (id) onGuide(id);
        }}
        onGuide={() => {}}
      />
    );
  }

  const current = guide ? guides.find((x) => x.id === guide) : null;
  if (guide)
    return (
      <>
        <button className="btn ghost small power-back" onClick={() => onGuide(null)}>
          <ArrowLeft size={14} /> Все гайды
        </button>
        {!current ? (
          error ? (
            <div className="guide-errors small">Не удалось загрузить гайды: {error}</div>
          ) : (
            <div className="empty">Гайд не найден — возможно, ссылка устарела</div>
          )
        ) : (
          <article className="ref-card power-article guide-article">
            <header className="guide-head">
              <span className="guide-head-icon">
                {current.icon ? <ItemIcon id={current.icon} size={32} /> : <BookOpen size={24} />}
              </span>
              <div className="grow">
                <h2 className="power-h">{current.title}</h2>
                <div className="faint small guide-meta">
                  {checks && <CheckedBadge c={current.checked} />}
                  {current.hidden && <span className="guide-badge guide-badge-hidden">снят с публикации</span>}
                  <span>
                    правил {current.updatedBy}, {date(current.updatedAt)}
                  </span>
                </div>
              </div>
              <div className="guide-head-actions">
                <button className="btn ghost small" onClick={() => setHistory(current)} title="Прошлые версии">
                  <History size={14} /> История
                </button>
                <button className="btn small" onClick={() => startEdit(current)}>
                  <Pencil size={14} /> Править
                </button>
              </div>
            </header>
            {current.summary && (
              <div className="power-note guide-summary">
                <GuideBody source={`**Коротко.** ${current.summary}`} kit={kit} onGuide={onGuide} />
              </div>
            )}
            <GuideBody source={current.body} kit={kit} onGuide={onGuide} />
          </article>
        )}
        {history && (
          <GuideHistory
            guide={history}
            kit={kit}
            onClose={() => setHistory(null)}
            onRestore={(r) => {
              setHistory(null);
              setRestore(r);
              setEditing(history);
            }}
          />
        )}
      </>
    );

  const visible = guides.filter((g) => !g.hidden);
  const hidden = guides.filter((g) => g.hidden);
  const byOrder = (a: Guide, b: Guide) => a.order - b.order || a.title.localeCompare(b.title, 'ru');
  const groups = new Map<string, Guide[]>();
  for (const g of [...visible].sort(byOrder)) {
    const k = g.group || 'Разное';
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }

  return (
    <section className="guide-list">
      <header className="guide-list-head">
        <div>
          <h2 className="power-h">Гайды</h2>
          {intro && <p className="faint small">{intro}</p>}
        </div>
        <button className="btn small" onClick={() => startEdit('new')}>
          <Plus size={14} /> Новый гайд
        </button>
      </header>
      {error && <div className="guide-errors small">Не удалось загрузить: {error}</div>}
      {visible.length === 0 && <div className="empty">Гайдов пока нет — напишите первый</div>}
      {[...groups].map(([name, list]) => (
        <div key={name} className="guide-group">
          {groups.size > 1 && <h3 className="guide-group-title">{name}</h3>}
          <div className="guide-cards">
            {list.map((g) => (
              <GuideCard key={g.id} g={g} kit={kit} checks={checks} onOpen={() => onGuide(g.id)} />
            ))}
          </div>
        </div>
      ))}
      {hidden.length > 0 && (
        <details className="guide-hidden">
          <summary className="faint small">
            <EyeOff size={13} /> Снятые с публикации ({hidden.length})
          </summary>
          <div className="guide-cards">
            {hidden.sort(byOrder).map((g) => (
              <GuideCard key={g.id} g={g} kit={kit} checks={checks} onOpen={() => onGuide(g.id)} />
            ))}
          </div>
        </details>
      )}
      <GuideEditorHint checks={checks} />
    </section>
  );
}

function GuideCard({ g, kit, checks, onOpen }: { g: Guide; kit: GuideKit; checks: boolean; onOpen: () => void }) {
  // Живые значения в «Коротко» — числами, как в статье
  const summary = useMemo(() => plain(expand(g.summary, [kit.scope.values])), [g.summary, kit.scope.values]);
  return (
    <button className={cx('guide-card', g.hidden && 'is-hidden')} onClick={onOpen}>
      <span className="guide-card-icon">{g.icon ? <ItemIcon id={g.icon} size={32} /> : <BookOpen size={22} />}</span>
      <span className="guide-card-text">
        <b className="guide-card-title">{g.title}</b>
        {summary && <span className="guide-card-summary small">{summary}</span>}
        <span className="guide-card-meta faint small">
          {checks && <CheckedBadge c={g.checked} />}
          <span>{date(g.updatedAt)}</span>
        </span>
      </span>
    </button>
  );
}

export function CheckedBadge({ c }: { c: GuideChecked }) {
  const v = CHECKED[c] ?? CHECKED.none;
  return (
    <span className={cx('guide-badge', `guide-badge-${c}`)} title={v.title}>
      {v.label}
    </span>
  );
}

function GuideEditorHint({ checks }: { checks: boolean }) {
  return (
    <p className="faint small guide-foot">
      <Eye size={12} /> Гайды правят все игроки: кнопка «Править» в статье, каждая правка сохраняется в истории, и любую
      прошлую версию можно вернуть.
      {checks &&
        ' Числа в статьях — по коду модов и настройкам сервера; в игре схемы не проверялись, если на карточке не сказано обратное.'}
    </p>
  );
}
