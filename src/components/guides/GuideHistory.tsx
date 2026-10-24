import { useEffect, useState } from 'react';
import { guideRevisions } from '../../data/guides';
import { cx } from '@/shared/lib';
import type { Guide, GuideRevision } from '../../types';
import { Modal } from '@/shared/ui';
import { GuideBody, type GuideKit } from './GuideBody';

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
        <div className="guide-errors small">{error}</div>
      ) : !list ? (
        <div className="empty">Загружаю…</div>
      ) : !list.length ? (
        <div className="empty">Версий нет — статья сохранена до того, как появилась история</div>
      ) : (
        <div className="guide-history">
          <ul className="guide-history-list">
            {list.map((x, i) => (
              <li key={x.id}>
                <button className={cx('guide-history-item', i === pick && 'active')} onClick={() => setPick(i)}>
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
            <div className="guide-history-view">
              {pick > 0 && (
                <button className="btn small" onClick={() => onRestore(r)}>
                  Вернуть эту версию…
                </button>
              )}
              <article className="power-article guide-article">
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
