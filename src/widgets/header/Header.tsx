import { Bell, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { firebaseEnabled } from '@/shared/api';
import { lastSeenUpdate, usePackUpdates } from '@/entities/pack-update';
import styles from './Header.module.css';
import { OnboardingMenu } from '@/widgets/onboarding';
import { ItemIcon, ItemIdSearch } from '@/shared/pack-data';
import { Modal, tooltipHandlers, Button } from '@/shared/ui';
import { SyncBadge } from '@/components/SyncBadge';

interface Props {
  nick: string;
  onChangeNick: () => void;
}

export function Header({ nick, onChangeNick }: Props) {
  const [searching, setSearching] = useState(false);
  // Датапаки, рецепты и теги — один раздел с тремя вкладками
  const inPacks = /^\/(datapacks|recipes|tags)\b/.test(useLocation().pathname);
  const updates = usePackUpdates();
  const [seen, setSeen] = useState(lastSeenUpdate);
  useEffect(() => {
    const on = () => setSeen(lastSeenUpdate());
    window.addEventListener('tfc-updates-seen', on);
    return () => window.removeEventListener('tfc-updates-seen', on);
  }, []);
  const fresh = Boolean(updates?.length && updates[0].createdAt > seen);
  // Ctrl/Cmd+K — поиск id предмета из любого места, кроме редактора: там это вставка ссылки
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target instanceof Element && e.target.closest('.cm-editor'))) return;
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
      <NavLink to="/" className={styles.brand}>
        <ItemIcon id="tfc:metal/ingot/copper" size={22} tip={false} />
        <span className={styles.brandName}>TFC Планы</span>
      </NavLink>
      <nav className="nav">
        <NavLink to="/" end>
          Задачи
        </NavLink>
        <NavLink to="/docs">Документы</NavLink>
        <NavLink to="/schematics">Схемы</NavLink>
        <NavLink to="/datapacks" className={inPacks ? 'active' : undefined}>
          Датапаки
        </NavLink>
        <NavLink to="/reference">Справочник</NavLink>
        <NavLink to="/addons">Аддоны</NavLink>
      </nav>
      <span className="grow" />
      {!firebaseEnabled && (
        <span
          className={styles.offline}
          {...tooltipHandlers('Локальный режим', 'Firebase не настроен — данные только в этом браузере')}
        >
          локально
        </span>
      )}
      <SyncBadge />
      <Button
        variant="ghost"
        size="sm"
        className="id-search-btn"
        onClick={() => setSearching(true)}
        {...tooltipHandlers('Найти id предмета', 'Ctrl/Cmd+K')}
      >
        <Search size={15} />
        <span className="hide-sm">id предмета</span>
      </Button>
      {searching && (
        <Modal onClose={() => setSearching(false)} title="Поиск id предмета">
          <ItemIdSearch autoFocus />
        </Modal>
      )}
      <OnboardingMenu />
      <NavLink
        to="/updates"
        className="btn ghost sm icon updates-btn"
        aria-label="Обновления сборки"
        {...tooltipHandlers('Обновления сборки', fresh ? 'Есть новое обновление' : undefined)}
      >
        <Bell size={16} />
        {fresh && <span className={styles.navDot} aria-label="новое" />}
      </NavLink>
      <button className="nick" onClick={onChangeNick} {...tooltipHandlers('Сменить ник')}>
        <span className={styles.avatar} aria-hidden>
          {nick.slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.nickName}>{nick}</span>
      </button>
    </header>
  );
}
