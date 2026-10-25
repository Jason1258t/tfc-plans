import { CookingPot, Package, Tags } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cx } from '@/shared/lib';
import styles from './PackNav.module.css';

const SECTIONS = [
  { to: '/datapacks', label: 'Датапаки', icon: Package },
  { to: '/recipes', label: 'Рецепты', icon: CookingPot },
  { to: '/tags', label: 'Теги', icon: Tags },
];

/** Выбор вкладки общего раздела «Датапаки»: сами датапаки, каталог рецептов, теги */
export function PackNav() {
  return (
    // глобальное имя `pack-nav` на <nav> — точка поиска онбординга и подсветки в списке датапаков
    <nav className={cx(styles.nav, 'pack-nav')} aria-label="Раздел">
      {SECTIONS.map((s) => (
        <NavLink key={s.to} to={s.to} className={({ isActive }) => cx(styles.link, isActive && styles.active)}>
          <s.icon size={16} />
          {s.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Страница раздела без своей боковой колонки: слева только выбор вкладки */
export function PackSection({ children }: { children: ReactNode }) {
  return (
    <div className={styles.layout}>
      <aside className={styles.side}>
        <PackNav />
      </aside>
      {children}
    </div>
  );
}
