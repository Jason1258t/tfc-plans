import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ItemIcon } from '../components/ItemIcon';
import { useData } from '../data/DataContext';
import { artifactsStore } from '../data/store';
import { timeAgo } from '../lib/util';
import './ArtifactsPage.css';

export function ArtifactsPage() {
  const { artifacts, tasks, nick, loading } = useData();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const list = artifacts
    .filter((a) => !q.trim() || `${a.title}\n${a.content}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const create = async () => {
    const id = await artifactsStore.add({
      title: 'Новый план',
      content: '',
      taskId: null,
      author: nick,
      updatedBy: nick,
    });
    navigate(`/a/${id}`);
  };

  return (
    <div className="artifacts-page">
      <div className="mc-panel stack">
        <div className="row wrap">
          <h2 className="grow" style={{ margin: 0 }}>
            Артефакты
          </h2>
          <input
            className="mc-input"
            style={{ maxWidth: 260 }}
            placeholder="Поиск…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="mc-btn green" onClick={create}>
            + Свободный артефакт
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Markdown-документы для сложных планов. Обычно создаются из задачи — кнопкой «Новый план».
        </p>
        {loading ? (
          <div className="empty">Загрузка…</div>
        ) : list.length === 0 ? (
          <div className="empty" style={{ color: '#6b6b6b' }}>
            Пока пусто
          </div>
        ) : (
          <ul className="artifact-grid">
            {list.map((a) => {
              const task = tasks.find((t) => t.id === a.taskId);
              return (
                <li key={a.id}>
                  <button className="artifact-tile mc-slot" onClick={() => navigate(`/a/${a.id}`)}>
                    <ItemIcon texture="minecraft/item/written_book" size={32} tip={false} />
                    <span className="grow">
                      <span className="artifact-tile-title">{a.title || 'Без названия'}</span>
                      <span className="artifact-tile-meta">
                        {task ? `к задаче «${task.title}»` : 'без задачи'} · {a.updatedBy}, {timeAgo(a.updatedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
