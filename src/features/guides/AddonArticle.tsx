import { BookOpen, History, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { guidesEnabled, saveGuide, subscribeGuide } from '@/data/guides';
import { ADDONS, ADDON_GUIDE_SECTION, addonGuideId, type Addon } from '@/lib/addons';
import { BASE_DOCS, BASE_VALUES } from '@/lib/guideScope';
import { readNick } from '@/shared/lib/nick';
import { cx } from '@/shared/lib';
import { Button, Card, contentStyles as content } from '@/shared/ui';
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

/** Сколько пунктов списка в тексте (строки, начинающиеся с «- » / «* ») */
function countBullets(text: string): number {
  const n = text.split('\n').filter((l) => /^\s*[-*+]\s+/.test(l)).length;
  return n > 0 ? n : text.trim() ? 1 : 0;
}

/** Вырезает из тела статьи аддона разделы «Проверено» и «Не проверено», чтобы показать их отдельно, свёрнуто */
function splitAddonChecked(body: string): { mainBody: string; checkedBody: string; uncheckedBody: string } {
  const lines = body.split('\n');
  const sections: { title: string; content: string[] }[] = [{ title: '', content: [] }];
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      sections.push({ title: m[1].trim(), content: [] });
    } else {
      sections[sections.length - 1].content.push(line);
    }
  }
  const checked = sections.find((s) => s.title === 'Проверено');
  const unchecked = sections.find((s) => s.title === 'Не проверено');
  const mainSections = sections.filter((s) => s.title !== 'Проверено' && s.title !== 'Не проверено');
  const mainBody = mainSections
    .map((s) => (s.title ? `## ${s.title}\n${s.content.join('\n')}` : s.content.join('\n')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    mainBody,
    checkedBody: checked ? checked.content.join('\n').trim() : '',
    uncheckedBody: unchecked ? unchecked.content.join('\n').trim() : '',
  };
}

/** Разбивает текст раздела на отдельные пункты списка (каждый — от «- » до следующего «- ») */
function splitBullets(text: string): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (/^\s*[-*+]\s+/.test(line)) {
      if (cur.length) out.push(cur.join('\n').trim());
      cur = [line];
    } else if (cur.length) {
      cur.push(line);
    }
  }
  if (cur.length) out.push(cur.join('\n').trim());
  return out.filter((b) => b.trim());
}

/** Пересобирает тело статьи с новыми текстами разделов «Проверено» / «Не проверено» */
function rebuildBody(body: string, newChecked: string, newUnchecked: string): string {
  const lines = body.split('\n');
  const sections: { title: string; content: string[] }[] = [{ title: '', content: [] }];
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) sections.push({ title: m[1].trim(), content: [] });
    else sections[sections.length - 1].content.push(line);
  }
  const result: string[] = [];
  for (const s of sections) {
    if (s.title === 'Проверено') {
      if (newChecked.trim()) result.push(`## Проверено\n${newChecked.trim()}`);
    } else if (s.title === 'Не проверено') {
      if (newUnchecked.trim()) result.push(`## Не проверено\n${newUnchecked.trim()}`);
    } else if (s.title) {
      result.push(`## ${s.title}\n${s.content.join('\n').trim()}`);
    } else {
      const t = s.content.join('\n').trim();
      if (t) result.push(t);
    }
  }
  return result
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
  const [moving, setMoving] = useState(false);

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

  // Списки «Проверено» / «Не проверено» вынесены из основного текста — у больших аддонов с историей они
  // занимали больше, чем само описание. Показываем их свёрнутыми блоками в конце статьи.
  const { mainBody, checkedBody, uncheckedBody } = splitAddonChecked(guide.body);

  const markChecked = async (bullet: string) => {
    const nick = readNick();
    if (!nick) {
      alert('Сначала укажите ник (вверху справа) — им подписываются правки');
      return;
    }
    if (moving) return;
    setMoving(true);
    try {
      const { checkedBody: curChecked, uncheckedBody: curUnchecked } = splitAddonChecked(guide.body);
      const remaining = splitBullets(curUnchecked).filter((b) => b !== bullet);
      const newChecked = curChecked ? `${curChecked}\n\n${bullet}` : bullet;
      const newUnchecked = remaining.join('\n\n');
      const newBody = rebuildBody(guide.body, newChecked, newUnchecked);
      await saveGuide(guide.id, {
        section: guide.section,
        title: guide.title,
        summary: guide.summary,
        body: newBody,
        icon: guide.icon,
        group: guide.group,
        order: guide.order,
        checked: guide.checked,
        hidden: guide.hidden,
        updatedBy: nick,
      });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setMoving(false);
    }
  };

  return (
    <>
      <Card as="article" className={styles.guideArticle}>
        <header className={styles.guideHead}>
          <span className={styles.guideHeadIcon}>
            <BookOpen size={24} />
          </span>
          <div className="grow">
            <h2 className={content.heading}>Подробно</h2>
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
          <div className={cx(content.note, styles.guideSummary)}>
            <GuideBody source={`**Коротко.** ${guide.summary}`} kit={KIT} onGuide={onGuide} />
          </div>
        )}
        <GuideBody source={mainBody} kit={KIT} onGuide={onGuide} />
        {checkedBody && (
          <details className={styles.addonChecked}>
            <summary className={styles.addonCheckedSummary}>Проверено ({countBullets(checkedBody)})</summary>
            <div className={styles.addonCheckedBody}>
              <GuideBody source={checkedBody} kit={KIT} onGuide={onGuide} />
            </div>
          </details>
        )}
        {uncheckedBody && (
          <details className={styles.addonChecked}>
            <summary className={styles.addonCheckedSummary}>Не проверено ({countBullets(uncheckedBody)})</summary>
            <div className={styles.addonCheckedBody}>
              <ul className={styles.addonCheckedList}>
                {splitBullets(uncheckedBody).map((b, i) => (
                  <li key={i} className={styles.addonCheckedItem}>
                    <div className={styles.addonCheckedText}>
                      <GuideBody source={b} kit={KIT} onGuide={onGuide} />
                    </div>
                    <Button
                      variant="ghost"
                      className="small"
                      disabled={moving}
                      onClick={() => markChecked(b)}
                      title="Перенести в «Проверено»"
                    >
                      Отметить проверенным
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}
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
