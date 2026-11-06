import { Bell, KeyRound, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { firebaseEnabled, requestKey, useAccess } from '@/shared/api';
import { lastSeenUpdate, usePackUpdates } from '@/entities/pack-update';
import styles from './Header.module.css';
import { OnboardingMenu } from '@/widgets/onboarding';
import { ItemIdSearch } from '@/shared/pack-data';
import { BrandLogo } from './BrandLogo';
import { Modal, tooltipHandlers, Button, ButtonLink } from '@/shared/ui';
import { SyncBadge } from '@/components/SyncBadge';

interface Props {
  nick: string;
  onChangeNick: () => void;
}

export function Header({ nick, onChangeNick }: Props) {
  const [searching, setSearching] = useState(false);
  // Рецепты и теги — справка; активный редактор датапаков — только на своей странице
  const inPacks = /^\/datapacks\b/.test(useLocation().pathname);
  const updates = usePackUpdates();
  // Задачи, документы и разработка — только с ключом игрока (dev #281)
  const player = useAccess() === 'player';
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
    <header className={styles.appHeader}>
      <NavLink to="/" end className={styles.brand} aria-label="TFC Studio — на главную">
        <BrandLogo />
      </NavLink>
      <nav className={styles.nav} aria-label="Основные разделы">
        {player && <NavLink to="/tasks">Задачи</NavLink>}
        {player && <NavLink to="/docs">Документы</NavLink>}
        <NavLink to="/schematics">Схемы</NavLink>
        <NavLink to="/datapacks" data-active={inPacks || undefined}>
          Датапаки
        </NavLink>
        <NavLink to="/reference">Справочник</NavLink>
        <NavLink to="/addons">Аддоны</NavLink>
        {player && <NavLink to="/dev">Разработка</NavLink>}
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
        className={styles.idSearchBtn}
        aria-label="Найти id предмета"
        onClick={() => setSearching(true)}
        {...tooltipHandlers('Найти id предмета', 'Ctrl/Cmd+K')}
      >
        <Search size={15} />
        <span className={styles.searchLabel}>id предмета</span>
      </Button>
      {searching && (
        <Modal onClose={() => setSearching(false)} title="Поиск id предмета">
          <ItemIdSearch autoFocus />
        </Modal>
      )}
      {!player && firebaseEnabled && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => requestKey()}
          {...tooltipHandlers('Войти с ключом игрока', 'Открывает задачи, документы, разработку и правки')}
        >
          <KeyRound size={15} />
          <span className={styles.searchLabel}>Ключ</span>
        </Button>
      )}
      <OnboardingMenu />
      <ButtonLink
        to="/updates"
        variant="ghost"
        size="sm"
        icon
        className={styles.updatesBtn}
        aria-label="Обновления сборки"
        {...tooltipHandlers('Обновления сборки', fresh ? 'Есть новое обновление' : undefined)}
      >
        <Bell size={16} />
        {fresh && <span className={styles.navDot} aria-label="новое" />}
      </ButtonLink>
      <button
        className={styles.nick}
        aria-label="Ник и ключ игрока"
        onClick={onChangeNick}
        {...tooltipHandlers('Ник и ключ игрока', player ? 'Вошли с ключом игрока' : 'Без ключа — только просмотр')}
      >
        <span className={styles.avatar} aria-hidden>
          {nick.slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.nickName}>{nick}</span>
      </button>
    </header>
  );
}
