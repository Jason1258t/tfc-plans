import { CookingPot, Package, Tags } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import './PackNav.css';

const SECTIONS = [
  { to: '/datapacks', label: 'Датапаки', icon: Package },
  { to: '/recipes', label: 'Рецепты', icon: CookingPot },
  { to: '/tags', label: 'Теги', icon: Tags },
];

/** Выбор вкладки общего раздела «Датапаки»: сами датапаки, каталог рецептов, теги */
export function PackNav() {
  return (
    <nav className="pack-nav" aria-label="Раздел">
      {SECTIONS.map((s) => (
        <NavLink key={s.to} to={s.to}>
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
    <div className="pack-layout">
      <aside className="pack-side">
        <PackNav />
      </aside>
      {children}
    </div>
  );
}
