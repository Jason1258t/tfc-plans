import { NavLink } from 'react-router-dom';
import { firebaseEnabled } from '../firebase';
import './Header.css';
import { ItemIcon } from './ItemIcon';
import { tooltipHandlers } from './Tooltip';

interface Props {
  nick: string;
  onChangeNick: () => void;
}

export function Header({ nick, onChangeNick }: Props) {
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
      <button className="nick" onClick={onChangeNick} {...tooltipHandlers('Сменить ник')}>
        <span className="avatar" aria-hidden>
          {nick.slice(0, 1).toUpperCase()}
        </span>
        <span className="nick-name">{nick}</span>
      </button>
    </header>
  );
}
