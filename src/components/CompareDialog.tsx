import { ArrowUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { tasksStore } from '@/shared/api';
import { elo, pickPair, sortTasks, swapRatings } from '../lib/tasks';
import { PRIORITIES, type Task } from '../types';
import './CompareDialog.css';
import { ItemIcon } from './ItemIcon';
import { Modal } from './Modal';

interface Props {
  /** Задачи, участвующие в сравнении (текущий фильтр, без выполненных) */
  tasks: Task[];
  onClose: () => void;
}

/**
 * «Что важнее?» — попарное сравнение. Каждый выбор двигает Elo-рейтинг,
 * и через пару десятков сравнений сортировка «По рейтингу» отражает общее мнение.
 */
export function CompareDialog({ tasks, onClose }: Props) {
  const [pairIds, setPairIds] = useState<[string, string] | null>(() => {
    const p = pickPair(tasks);
    return p ? [p[0].id, p[1].id] : null;
  });
  const [count, setCount] = useState(0);

  const a = pairIds && tasks.find((t) => t.id === pairIds[0]);
  const b = pairIds && tasks.find((t) => t.id === pairIds[1]);
  const ranking = useMemo(() => sortTasks(tasks, 'rating'), [tasks]);

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

  /** Поменять местами две соседние строки рейтинга: нижняя встаёт выше */
  const swap = async (upper: Task, lower: Task) => {
    const [u, l] = swapRatings(upper.rating, lower.rating);
    await Promise.all([tasksStore.update(upper.id, { rating: u }), tasksStore.update(lower.id, { rating: l })]);
  };

  return (
    <Modal onClose={onClose} title="Что важнее сделать сейчас?">
      {!a || !b ? (
        <div className="empty">Нужно хотя бы две активные задачи в текущем фильтре.</div>
      ) : (
        <>
          <div className="cmp-pair">
            {[a, b].map((t, i) => (
              <button key={t.id} className="cmp-option" onClick={() => choose(t, i === 0 ? b : a)}>
                {t.icon && <ItemIcon id={t.icon} size={32} tip={false} />}
                <span className="cmp-title">{t.title}</span>
                <span className="imp-pill" style={{ color: PRIORITIES[t.priority].color }}>
                  {PRIORITIES[t.priority].label}
                </span>
              </button>
            ))}
          </div>
          <div className="row">
            <span className="faint small grow">Сравнений: {count}. Выбор сразу меняет рейтинг.</span>
            <button className="btn ghost sm" onClick={() => next(pairIds!)}>
              Пропустить
            </button>
          </div>
        </>
      )}
      {ranking.length > 0 && (
        <div>
          <div className="label">Рейтинг</div>
          <div className="faint small">Наведите между строками и нажмите ⇅, чтобы поменять две задачи местами.</div>
          <ol className="cmp-rank">
            {ranking.map((t, i) => (
              <li key={t.id}>
                <span className="imp-dot" style={{ background: PRIORITIES[t.priority].color }} />
                <span className="grow">{t.title}</span>
                <span className="faint">{t.rating}</span>
                {i < ranking.length - 1 && (
                  <button
                    className="cmp-swap"
                    title="Поменять местами с задачей ниже"
                    aria-label={`Поменять местами «${t.title}» и «${ranking[i + 1].title}»`}
                    onClick={() => swap(t, ranking[i + 1])}
                  >
                    <span>
                      <ArrowUpDown size={13} />
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
}
