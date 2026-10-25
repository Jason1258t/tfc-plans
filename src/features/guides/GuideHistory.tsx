import { useEffect, useState } from 'react';
import { guideRevisions } from '@/data/guides';
import { cx } from '@/shared/lib';
import type { Guide, GuideRevision } from '@/entities/guide';
import { Modal } from '@/shared/ui';
import { GuideBody, type GuideKit } from './GuideBody';
import styles from './Guides.module.css';

/** Прошлые версии гайда: посмотреть и вернуть (через редактор — возврат тоже становится версией) */
export function GuideHistory({
  guide,
  kit,
  onClose,
  onRestore,
}: {
  guide: Guide;
  kit: GuideKit;
  onClose: () => void;
  onRestore: (r: Pick<Guide, 'title' | 'summary' | 'body'>) => void;
}) {
  const [list, setList] = useState<GuideRevision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  useEffect(() => {
    guideRevisions(guide.id)
      .then(setList)
      .catch((e) => setError(e.message));
  }, [guide.id]);
  const r = list?.[pick];
  return (
    <Modal title={`История: ${guide.title}`} onClose={onClose} wide>
      {error ? (
        <div className={cx(styles.guideErrors, 'small')}>{error}</div>
      ) : !list ? (
        <div className="empty">Загружаю…</div>
      ) : !list.length ? (
        <div className="empty">Версий нет — статья сохранена до того, как появилась история</div>
      ) : (
        <div className={styles.guideHistory}>
          <ul className={styles.guideHistoryList}>
            {list.map((x, i) => (
              <li key={x.id}>
                <button className={cx(styles.guideHistoryItem, i === pick && styles.active)} onClick={() => setPick(i)}>
                  <b>{new Date(x.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</b>
                  <span className="faint small">
                    {x.updatedBy}
                    {i === 0 ? ' · сейчас' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {r && (
            <div className={styles.guideHistoryView}>
              {pick > 0 && (
                <button className="btn small" onClick={() => onRestore(r)}>
                  Вернуть эту версию…
                </button>
              )}
              <article className={cx('power-article', styles.guideArticle)}>
                <h2 className="power-h">{r.title}</h2>
                {r.summary && (
                  <div className="power-note">
                    <GuideBody source={`**Коротко.** ${r.summary}`} kit={kit} onGuide={() => {}} />
                  </div>
                )}
                <GuideBody source={r.body} kit={kit} onGuide={() => {}} />
              </article>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
