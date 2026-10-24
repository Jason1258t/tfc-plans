import { BookOpen, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useData } from '@/data/DataContext';
import { artifactsStore } from '@/entities/artifact';
import { useSearchTrack } from '@/shared/api';
import { cx, timeAgo } from '@/shared/lib';
import styles from './DocsSection.module.css';

interface Props {
  /** Документ, открытый справа */
  openId: string | null;
  onOpen: (id: string) => void;
}

/** Раздел «Планы» на странице задач: все Markdown-планы, с задачей и без */
export function DocsSection({ openId, onOpen }: Props) {
  const { artifacts, tasks, nick, loading } = useData();
  const [q, setQ] = useState('');

  const list = artifacts
    .filter((a) => !q.trim() || `${a.title}\n${a.content}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  useSearchTrack('docs', q, list.length);

  const create = async () => {
    const id = await artifactsStore.add({
      title: 'Новый план',
      content: '',
      taskId: null,
      author: nick,
      updatedBy: nick,
    });
    onOpen(id);
  };

  return (
    <>
      <div className={styles.top}>
        <label className={styles.search}>
          <Search size={15} className="faint" />
          <input
            placeholder="Поиск по планам"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Поиск по планам"
          />
        </label>
        <button className="btn primary" onClick={create}>
          <Plus size={16} />
          План
        </button>
      </div>
      <p className={cx('muted', styles.docsLead)}>
        Markdown-планы для сложных задач. Обычно создаются из задачи; здесь — все сразу, включая планы без задачи.
      </p>
      {loading ? (
        <div className="empty">Загрузка…</div>
      ) : list.length === 0 ? (
        <div className="empty">{q.trim() ? 'Ничего не найдено' : 'Планов пока нет'}</div>
      ) : (
        <ul className={styles.docsList}>
          {list.map((a) => {
            const task = tasks.find((t) => t.id === a.taskId);
            const firstLine = a.content.replace(/^#.*$/m, '').trim().split('\n')[0]?.slice(0, 140);
            return (
              <li key={a.id}>
                <button className={cx(styles.docItem, a.id === openId && styles.active)} onClick={() => onOpen(a.id)}>
                  <BookOpen size={18} className={styles.docItemIcon} />
                  <span className="grow">
                    <span className={styles.docItemTitle}>{a.title || 'Без названия'}</span>
                    {firstLine && <span className={styles.docItemPreview}>{firstLine}</span>}
                    <span className={styles.docItemMeta}>
                      {task ? `↳ ${task.title}` : 'без задачи'} · {a.updatedBy}, {timeAgo(a.updatedAt)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
