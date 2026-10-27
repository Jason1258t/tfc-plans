import { BookOpen, History, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { guidesEnabled, subscribeGuide } from '@/data/guides';
import { ADDONS, ADDON_GUIDE_SECTION, addonGuideId, type Addon } from '@/lib/addons';
import { BASE_DOCS, BASE_VALUES } from '@/lib/guideScope';
import { readNick } from '@/shared/lib/nick';
import { cx } from '@/shared/lib';
import { Button, Card } from '@/shared/ui';
import type { Guide } from '@/entities/guide';
import { AddonBlockCard } from '@/features/reference-tabs';
import { CalcErrors } from './CalcBlock';
import { GuideBody, type GuideKit } from './GuideBody';
import { GuideEditor } from './GuideEditor';
import { GuideHistory } from './GuideHistory';
import { CheckedBadge } from './GuidesSection';
import styles from './Guides.module.css';

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
      <Card>
        {error && <div className={cx(styles.guideErrors, 'small')}>Не удалось загрузить: {error}</div>}
        <div className="empty">Подробного описания пока нет</div>
        <Button className="small" onClick={() => startEdit('new')}>
          <Plus size={14} /> Написать описание
        </Button>
      </Card>
    );

  return (
    <>
      <Card as="article" className={cx('power-article', styles.guideArticle)}>
        <header className={styles.guideHead}>
          <span className={styles.guideHeadIcon}>
            <BookOpen size={24} />
          </span>
          <div className="grow">
            <h2 className="power-h">Подробно</h2>
            <div className={cx('faint small', styles.guideMeta)}>
              <CheckedBadge c={guide.checked} />
              <span>
                правил {guide.updatedBy}, {date(guide.updatedAt)}
              </span>
            </div>
          </div>
          <div className={styles.guideHeadActions}>
            <Button variant="ghost" className="small" onClick={() => setHistory(true)} title="Прошлые версии">
              <History size={14} /> История
            </Button>
            <Button className="small" onClick={() => startEdit(guide)}>
              <Pencil size={14} /> Править
            </Button>
          </div>
        </header>
        {guide.summary && (
          <div className={cx('power-note', styles.guideSummary)}>
            <GuideBody source={`**Коротко.** ${guide.summary}`} kit={KIT} onGuide={onGuide} />
          </div>
        )}
        <GuideBody source={guide.body} kit={KIT} onGuide={onGuide} />
      </Card>
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
      <p className={cx('faint small', styles.guideFoot)}>
        Описание и ченджлоги версий правят все игроки: кнопка «Править», каждая правка сохраняется в истории. Файл и
        рецепты — в карточке аддона рядом с исходниками и меняются с выпуском новой версии.
      </p>
    </>
  );
}
