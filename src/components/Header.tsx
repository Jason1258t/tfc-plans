import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { firebaseEnabled } from '../firebase';
import { lastSeenUpdate, usePackUpdates } from '../lib/packUpdates';
import './Header.css';
import { ItemIcon } from './ItemIcon';
import { ItemIdSearch } from './ItemIdSearch';
import { Modal } from './Modal';
import { tooltipHandlers } from './Tooltip';

interface Props {
  nick: string;
  onChangeNick: () => void;
}

export function Header({ nick, onChangeNick }: Props) {
  const [searching, setSearching] = useState(false);
  const updates = usePackUpdates();
  const [seen, setSeen] = useState(lastSeenUpdate);
  useEffect(() => {
    const on = () => setSeen(lastSeenUpdate());
    window.addEventListener('tfc-updates-seen', on);
    return () => window.removeEventListener('tfc-updates-seen', on);
  }, []);
  const fresh = Boolean(updates?.length && updates[0].createdAt > seen);
  // Ctrl/Cmd+K — поиск id предмета из любого места
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="app-header">
      <NavLink to="/" className="brand">
        <ItemIcon id="tfc:metal/ingot/copper" size={22} tip={false} />
        <span className="brand-name">TFC Планы</span>
      </NavLink>
      <nav className="nav">
        <NavLink to="/" end>
          Задачи
        </NavLink>
        <NavLink to="/docs">Документы</NavLink>
        <NavLink to="/schematics">Схемы</NavLink>
        <NavLink to="/datapacks">Датапаки</NavLink>
        <NavLink to="/reference">Справочник</NavLink>
        <NavLink to="/updates" title={fresh ? 'Есть новое обновление сборки' : undefined}>
          Обновления{fresh && <span className="nav-dot" aria-label="новое" />}
        </NavLink>
      </nav>
      <span className="grow" />
      {!firebaseEnabled && (
        <span
          className="offline"
          {...tooltipHandlers('Локальный режим', 'Firebase не настроен — данные только в этом браузере')}
        >
          локально
        </span>
      )}
      <button
        className="btn ghost sm id-search-btn"
        onClick={() => setSearching(true)}
        {...tooltipHandlers('Найти id предмета', 'Ctrl/Cmd+K')}
      >
        <Search size={15} />
        <span className="hide-sm">id предмета</span>
      </button>
      {searching && (
        <Modal onClose={() => setSearching(false)} title="Поиск id предмета">
          <ItemIdSearch autoFocus />
        </Modal>
      )}
      <button className="nick" onClick={onChangeNick} {...tooltipHandlers('Сменить ник')}>
        <span className="avatar" aria-hidden>
          {nick.slice(0, 1).toUpperCase()}
        </span>
        <span className="nick-name">{nick}</span>
      </button>
    </header>
  );
}
