import { BookOpen, History, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { guidesEnabled, subscribeGuide } from '../../data/guides';
import { ADDONS, ADDON_GUIDE_SECTION, addonGuideId, type Addon } from '../../lib/addons';
import { BASE_DOCS, BASE_VALUES } from '../../lib/guideScope';
import { readNick } from '../../lib/nick';
import type { Guide } from '../../types';
import { AddonBlockCard } from '../AddonsTab';
import { CalcErrors } from './CalcBlock';
import { GuideBody, type GuideKit } from './GuideBody';
import { GuideEditor } from './GuideEditor';
import { GuideHistory } from './GuideHistory';
import { CheckedBadge } from './GuidesSection';
import './Guides.css';

/** Виджет статей аддонов — блок из карточки tools/<мод>/addon.json */
const KIT: GuideKit = {
  scope: { values: BASE_VALUES, docs: BASE_DOCS },
  widgets: {
    'addon-block': {
      doc: 'блок или предмет аддона из его карточки (tools/<мод>/addon.json): id=ee_extras:three_phase_rectifier — картинка, название, рецепт; описание пишите текстом после виджета',
      render: ({ params }) => {
        const id = String(params.id ?? '');
        for (const a of ADDONS) {
          const b = a.blocks.find((x) => x.id === id);
          if (b) return <AddonBlockCard a={a} b={b} />;
        }
        return <CalcErrors list={[`нет блока «${id}» в карточках аддонов`]} />;
      },
    },
  },
};

const date = (t: number) =>
  new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

/** Заготовка новой статьи аддона: виджеты всех блоков из карточки */
const template = (a: Addon) =>
  [
    ...(a.blocks.length
      ? ['## Блоки и предметы', '', ...a.blocks.flatMap((b) => [`::addon-block id=${b.id}`, '', '…', ''])]
      : []),
    '## Проверено',
    '',
    '- …',
    '',
    '## Не проверено',
    '',
    '- В игре — ничего.',
    '',
  ].join('\n');

/**
 * Подробное описание аддона — статья Firestore guides/addon-<мод> (раздел addon): правят все, история версий как у
 * гайдов. Отдельный чанк (lazy в AddonPage).
 */
export default function AddonArticle({ addon }: { addon: Addon }) {
  const id = addonGuideId(addon.id);
  const nav = useNavigate();
  const [guide, setGuide] = useState<Guide | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Guide | 'new' | null>(null);
  const [history, setHistory] = useState(false);
  const [restore, setRestore] = useState<Pick<Guide, 'title' | 'summary' | 'body'> | null>(null);

  useEffect(() => {
    setGuide(undefined);
    return subscribeGuide(id, setGuide, (e) => {
      setError(e.message);
      setGuide(null);
    });
  }, [id]);

  if (!guidesEnabled) return <div className="empty">Описания хранятся в Firestore — без Firebase их негде взять</div>;
  if (guide === undefined) return <div className="empty">Загружаю описание…</div>;

  const startEdit = (g: Guide | 'new') => {
    if (!readNick()) {
      alert('Сначала укажите ник (вверху справа) — им подписываются правки');
      return;
    }
    setRestore(g === 'new' ? { title: addon.name, summary: '', body: template(addon) } : null);
    setEditing(g);
  };

  // Ссылки [текст](guide:id) в статье аддона — на гайды «Как написать свой»
  const onGuide = (g: string | null) => nav(g ? `/addons?sub=guides&g=${g}` : '/addons?sub=guides');

  if (editing)
    return (
      <GuideEditor
        section={ADDON_GUIDE_SECTION}
        id={id}
        kit={KIT}
        guide={editing === 'new' ? null : guide}
        started={editing === 'new' ? null : editing}
        restore={restore}
        nextOrder={0}
        groups={[]}
        onClose={() => setEditing(null)}
        onGuide={() => {}}
      />
    );

  if (!guide)
    return (
      <section className="ref-card">
        {error && <div className="guide-errors small">Не удалось загрузить: {error}</div>}
        <div className="empty">Подробного описания пока нет</div>
        <button className="btn small" onClick={() => startEdit('new')}>
          <Plus size={14} /> Написать описание
        </button>
      </section>
    );

  return (
    <>
      <article className="ref-card power-article guide-article">
        <header className="guide-head">
          <span className="guide-head-icon">
            <BookOpen size={24} />
          </span>
          <div className="grow">
            <h2 className="power-h">Подробно</h2>
            <div className="faint small guide-meta">
              <CheckedBadge c={guide.checked} />
              <span>
                правил {guide.updatedBy}, {date(guide.updatedAt)}
              </span>
            </div>
          </div>
          <div className="guide-head-actions">
            <button className="btn ghost small" onClick={() => setHistory(true)} title="Прошлые версии">
              <History size={14} /> История
            </button>
            <button className="btn small" onClick={() => startEdit(guide)}>
              <Pencil size={14} /> Править
            </button>
          </div>
        </header>
        {guide.summary && (
          <div className="power-note guide-summary">
            <GuideBody source={`**Коротко.** ${guide.summary}`} kit={KIT} onGuide={onGuide} />
          </div>
        )}
        <GuideBody source={guide.body} kit={KIT} onGuide={onGuide} />
      </article>
      {history && (
        <GuideHistory
          guide={guide}
          kit={KIT}
          onClose={() => setHistory(false)}
          onRestore={(r) => {
            setHistory(false);
            setRestore(r);
            setEditing(guide);
          }}
        />
      )}
      <p className="faint small guide-foot">
        Описание правят все игроки: кнопка «Править», каждая правка сохраняется в истории. Версия, файл и рецепты — в
        карточке аддона рядом с исходниками и меняются с выпуском новой версии.
      </p>
    </>
  );
}
