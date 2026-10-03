import { BookOpen, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { artifactsStore } from '../data/store';
import { timeAgo } from '../lib/util';
import './DocsPage.css';

export function DocsPage() {
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
    navigate(`/docs/${id}`);
  };

  return (
    <div className="docs-page">
      <div className="docs-top">
        <h1>Документы</h1>
        <span className="grow" />
        <button className="btn primary" onClick={create}>
          <Plus size={16} />
          Документ
        </button>
      </div>
      <p className="muted docs-lead">
        Markdown-планы для сложных задач. Обычно создаются из задачи и открываются справа от списка.
      </p>
      <label className="search">
        <Search size={15} className="faint" />
        <input placeholder="Поиск по документам" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {loading ? (
        <div className="empty">Загрузка…</div>
      ) : list.length === 0 ? (
        <div className="empty">Документов пока нет</div>
      ) : (
        <ul className="docs-list">
          {list.map((a) => {
            const task = tasks.find((t) => t.id === a.taskId);
            const firstLine = a.content.replace(/^#.*$/m, '').trim().split('\n')[0]?.slice(0, 140);
            return (
              <li key={a.id}>
                <button className="doc-item" onClick={() => navigate(task ? `/?doc=${a.id}` : `/docs/${a.id}`)}>
                  <BookOpen size={18} className="doc-item-icon" />
                  <span className="grow">
                    <span className="doc-item-title">{a.title || 'Без названия'}</span>
                    {firstLine && <span className="doc-item-preview">{firstLine}</span>}
                    <span className="doc-item-meta">
                      {task ? `↳ ${task.title}` : 'без задачи'} · {a.updatedBy}, {timeAgo(a.updatedAt)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
