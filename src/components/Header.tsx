import { NavLink } from 'react-router-dom';
import { firebaseEnabled } from '../firebase';
import { ItemIcon } from './ItemIcon';
import { tooltipHandlers } from './Tooltip';
import './Header.css';

interface Props {
  nick: string;
  onChangeNick: () => void;
}

export function Header({ nick, onChangeNick }: Props) {
  return (
    <header className="app-header">
      <NavLink to="/" className="brand">
        <ItemIcon id="tfc:metal/ingot/copper" size={32} tip={false} />
        <span className="brand-title">TFC&nbsp;Планы</span>
      </NavLink>
      <nav className="row">
        <NavLink to="/" end className={({ isActive }) => `mc-btn sm ${isActive ? 'active' : ''}`}>
          <ItemIcon texture="minecraft/item/chest_minecart" size={20} tip={false} />
          <span className="hide-sm">Задачи</span>
        </NavLink>
        <NavLink to="/artifacts" className={({ isActive }) => `mc-btn sm ${isActive ? 'active' : ''}`}>
          <ItemIcon texture="minecraft/item/written_book" size={20} tip={false} />
          <span className="hide-sm">Артефакты</span>
        </NavLink>
      </nav>
      <div className="grow" />
      {!firebaseEnabled && (
        <span
          className="local-badge"
          {...tooltipHandlers('Локальный режим', 'Firebase не настроен — данные только в этом браузере')}
        >
          offline
        </span>
      )}
      <button className="mc-btn sm nick" onClick={onChangeNick} {...tooltipHandlers('Сменить ник')}>
        <span className="nick-dot" />
        {nick}
      </button>
    </header>
  );
}
