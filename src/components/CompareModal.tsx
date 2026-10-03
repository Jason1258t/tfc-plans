import { useMemo, useState } from 'react';
import { tasksStore } from '../data/store';
import { elo, pickPair, sortTasks } from '../lib/tasks';
import { PRIORITIES, type Task } from '../types';
import { ItemIcon } from './ItemIcon';
import { Modal } from './Modal';
import './CompareModal.css';

interface Props {
  /** Задачи, участвующие в сравнении (текущий фильтр, без готовых) */
  tasks: Task[];
  onClose: () => void;
}

/**
 * «Что важнее?» — попарное сравнение задач. Каждый выбор двигает Elo-рейтинг,
 * и через пару десятков сравнений сортировка «По рейтингу» отражает общее мнение.
 */
export function CompareModal({ tasks, onClose }: Props) {
  const [pairIds, setPairIds] = useState<[string, string] | null>(() => {
    const p = pickPair(tasks);
    return p ? [p[0].id, p[1].id] : null;
  });
  const [count, setCount] = useState(0);

  // Берём актуальные версии задач (рейтинги обновляются в реальном времени)
  const pair = pairIds ? (pairIds.map((id) => tasks.find((t) => t.id === id)) as [Task?, Task?]) : null;
  const ranking = useMemo(() => sortTasks(tasks, 'rating').slice(0, 10), [tasks]);

  const next = (prev: [string, string]) => {
    const p = pickPair(tasks, prev);
    setPairIds(p ? [p[0].id, p[1].id] : null);
  };

  const choose = async (winner: Task, loser: Task) => {
    const [w, l] = elo(winner.rating, loser.rating);
    next([winner.id, loser.id]);
    setCount((c) => c + 1);
    await Promise.all([tasksStore.update(winner.id, { rating: w }), tasksStore.update(loser.id, { rating: l })]);
  };

  return (
    <Modal onClose={onClose} label="Что важнее?">
      <div className="mc-panel stack compare">
        <button className="close-x" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
        <h2>Что важнее сделать сейчас?</h2>
        {!pair || !pair[0] || !pair[1] ? (
          <div className="muted">Нужно хотя бы две незавершённые задачи в текущем фильтре.</div>
        ) : (
          <>
            <div className="compare-pair">
              {[pair[0], pair[1]].map((t, i) => (
                <button key={t.id} className="compare-option" onClick={() => choose(t, pair[1 - i]!)}>
                  <span className="mc-slot compare-slot">
                    {t.icon ? (
                      <ItemIcon id={t.icon} size={48} tip={false} />
                    ) : (
                      <ItemIcon texture="minecraft/item/paper" size={48} tip={false} />
                    )}
                  </span>
                  <span className="compare-title" style={{ color: PRIORITIES[t.priority].color }}>
                    {t.title}
                  </span>
                  <span className="muted">
                    {PRIORITIES[t.priority].label} · {t.rating}
                  </span>
                </button>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">Сравнений за сессию: {count}</span>
              <button className="mc-btn sm" onClick={() => next(pairIds!)}>
                Не могу решить — дальше
              </button>
            </div>
          </>
        )}
        {ranking.length > 0 && (
          <div>
            <h3>Топ по рейтингу</h3>
            <ol className="compare-ranking">
              {ranking.map((t) => (
                <li key={t.id}>
                  <span className="grow" style={{ overflowWrap: 'anywhere' }}>
                    {t.title}
                  </span>
                  <span className="rank-score">{t.rating}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Modal>
  );
}
